// ═══════════════════════════════════════════════════════════════
// SKYWAR frame-time benchmark: runs the real game in a GPU headless Chromium and times the same flights in
// several scenarios, so a change can be measured against a baseline (run it on two servers, or before and after).
//
//   node tools/perf/bench.mjs [--url http://localhost:8080/] [--scenarios dogfight,war,naval] [--quality high]
//                             [--frames 600] [--warmup 60] [--sync] [--size 1600x900] [--out bench.json]
//
// Each scenario: launch with its settings, fly `warmup` seconds of game time (the war develops, streaming
// settles), then step `frames` frames at 1/60 s while an AI pilot flies the player's jet round a fixed circle
// (invincible, so every run flies the same). Reported per scenario:
//   update  — game.update (simulation) per frame, and each war plug-in's share
//   frame   — the whole frame (update + render + HUD) p50 / p95; with --sync the GPU is waited for every frame
//             (a 1-pixel readPixels), so the time includes the GPU's work, not just its submission
//   calls / tris — draw calls and triangles per frame, every pass (shadows, scene, post) counted
//   heap    — JS heap after the run (Chrome only)
// Needs playwright-core: PLAYWRIGHT_CORE=<path to playwright-core/index.mjs>, or a local install, or the copy in
// ~/git/flight-tool. Test pages never write localStorage (the owner's saved settings are left alone).
// ═══════════════════════════════════════════════════════════════
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, s, i, all) => {
    if (s.startsWith('--')) a.push([s.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return a;
}, []));
const URL0 = args.url || 'http://localhost:8080/';
const FRAMES = +(args.frames || 600), WARMUP = +(args.warmup || 60), SYNC = !!args.sync;
const [W, H] = String(args.size || '1600x900').split('x').map(Number);

// what each scenario sets before launching (the menu's own settings keys) and where the jet circles
const SCENARIOS = {
    dogfight: { settings: { mode: 'dogfight', aircraft: 'f16', start: 'air' }, circle: [0, 2600, -4000] },
    strike: { settings: { mode: 'strike', aircraft: 'f15', start: 'air' }, circle: [6000, 1800, -14000] },
    naval: { settings: { mode: 'naval', aircraft: 'fa18', start: 'air' }, circle: null },
    war: { settings: { mode: 'war', aircraft: 'f16', start: 'air' }, circle: [2000, 2400, -9000] },
    'war-night': { settings: { mode: 'war', aircraft: 'f16', start: 'air', time: 'night' }, circle: [2000, 2400, -9000] },
    'town-low': { settings: { mode: 'freeflight', aircraft: 'f16', start: 'air' }, circle: [-13000, 450, 9000] },
    storm: { settings: { mode: 'freeflight', aircraft: 'f16', start: 'air', weather: 'storm' }, circle: [0, 1500, -4000] },
};
const names = String(args.scenarios || 'dogfight,war,naval').split(',').filter(Boolean);
for (const n of names) if (!SCENARIOS[n]) { console.error(`unknown scenario "${n}" (have: ${Object.keys(SCENARIOS).join(', ')})`); process.exit(1); }

async function loadPlaywright() {
    const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright', `${homedir()}/git/flight-tool/node_modules/playwright-core/index.mjs`].filter(Boolean);
    for (const t of tries) { try { const m = await import(t); if (m.chromium || (m.default && m.default.chromium)) return m.chromium || m.default.chromium; } catch (e) { /* next */ } }
    console.error('playwright-core not found: set PLAYWRIGHT_CORE to its index.mjs'); process.exit(1);
}

const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const results = [];
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + 's', ...a);

for (const name of names) {
    const sc = SCENARIOS[name];
    const settings = { controlMode: 'keyboard', quality: args.quality || 'high', difficulty: 'veteran', wingmen: 1, time: 'day', weather: 'clear', dynRes: false, ...sc.settings };
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    // the settings arrive through localStorage.getItem; nothing is ever written
    await page.addInitScript((s) => {
        try {
            const get = Storage.prototype.getItem;
            Storage.prototype.getItem = function (k) { return k === 'skywar.settings' ? JSON.stringify(s) : get.call(this, k); };
            Storage.prototype.setItem = function () { };
        } catch (e) { /* no storage */ }
    }, settings);
    await page.goto(URL0 + (URL0.includes('?') ? '&' : '?') + 'bench=' + Date.now(), { timeout: 600000 });
    await page.waitForSelector('#menu.show', { timeout: 600000 });
    log(name, 'menu up');
    const r = await page.evaluate(async ({ sc, WARMUP, FRAMES, SYNC }) => {
        const s = window.skywar, g = s.game, renderer = s.renderer, gl = renderer.getContext();
        const THREE = await import('three');
        document.getElementById('launchBtn').click();
        await new Promise(r => setTimeout(r, 500));
        const circle = sc.circle ? new THREE.Vector3(...sc.circle) : null;
        // the same flight in every run: an AI pilot circles the player's jet (invincible, so nothing ends it)
        const steer = () => {
            let p = g.player;
            if (g.pilotMode || (p && !p.alive)) { g.respawnPlayer(); p = g.player; }
            if (!p || !p.alive || p.benchPilot) return;
            Object.defineProperty(p, 'invincible', { value: true, configurable: true });
            const pl = new s.Pilot(g, p, 0.8);
            pl.passive = true; pl.cruise = 0.7;
            // (no circle: over the home carrier's group. A waypoint on the jet itself steers along a zero vector: NaN)
            const cv = g.naval && g.naval.homeCarrier;
            pl.waypoint = circle ? circle.clone() : cv ? new THREE.Vector3(cv.pos.x, 1500, cv.pos.z) : p.pos.clone().setY(Math.max(p.pos.y, 1500)).addScaledVector(p.getForward(new THREE.Vector3()).setY(0).normalize(), 6000);
            p.benchPilot = pl;
        };
        for (let i = 0; i < WARMUP * 20; i++) { steer(); window.skywarStep(1, 1 / 20); }
        // time it: game.update, each plug-in's update, the whole frame
        const sys = {}, wraps = [];
        for (const x of g.systems || []) {
            if (!x.update) continue;
            const o = x.update, key = x.constructor.name;
            wraps.push([x, o]);
            x.update = function (dt) { const t = performance.now(); o.call(this, dt); sys[key] = (sys[key] || 0) + performance.now() - t; };
        }
        const gu = g.update; let tu = 0;
        g.update = function (dt) { const t = performance.now(); gu.call(this, dt); tu += performance.now() - t; };
        renderer.info.autoReset = false;
        const px = new Uint8Array(4), fts = [], calls = [], tris = [];
        for (let i = 0; i < FRAMES; i++) {
            steer();
            renderer.info.reset();
            const a = performance.now();
            window.skywarStep(1, 1 / 60);
            if (SYNC) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            fts.push(performance.now() - a);
            calls.push(renderer.info.render.calls); tris.push(renderer.info.render.triangles);
        }
        renderer.info.autoReset = true;
        g.update = gu; for (const [x, o] of wraps) x.update = o;
        const q = (arr, f) => { const b = arr.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * f))]; };
        const p = g.player;
        return {
            mode: g.mode, update: tu / FRAMES, p50: q(fts, 0.5), p95: q(fts, 0.95), mean: fts.reduce((x, y) => x + y, 0) / FRAMES,
            calls: q(calls, 0.5), tris: q(tris, 0.5),
            systems: Object.fromEntries(Object.entries(sys).map(([k, v]) => [k, +(v / FRAMES).toFixed(3)])),
            aircraft: g.aircraft.length, ground: g.ground ? g.ground.targets.length : 0, warUnits: g.war ? g.war.units.length : 0,
            heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
            alive: !!(p && p.alive), alt: p ? Math.round(p.pos.y) : null,
        };
    }, { sc, WARMUP, FRAMES, SYNC }).catch(e => ({ error: String(e) }));
    r.scenario = name; r.errors = errors.slice(0, 5); r.errorCount = errors.length;
    results.push(r);
    log(name, r.error ? 'ERROR ' + r.error : `frame p50 ${r.p50.toFixed(2)} ms, update ${r.update.toFixed(2)} ms, ${r.calls} calls`);
    await page.close();
}
await browser.close();

const f = (v, d = 2) => (v == null ? '—' : (+v).toFixed(d));
console.log(`\nSKYWAR bench  ${URL0}  ${W}x${H}  quality ${args.quality || 'high'}  ${FRAMES} frames${SYNC ? ', GPU-synced' : ''}\n`);
console.log('scenario'.padEnd(11) + 'frame p50'.padStart(10) + 'p95'.padStart(8) + 'update'.padStart(9) + 'calls'.padStart(8) + 'tris'.padStart(10) + 'heap MB'.padStart(9) + '  errors');
for (const r of results) {
    if (r.error) { console.log(r.scenario.padEnd(11) + '  ' + r.error); continue; }
    console.log(r.scenario.padEnd(11) + f(r.p50).padStart(10) + f(r.p95).padStart(8) + f(r.update).padStart(9) + String(r.calls).padStart(8) + String(r.tris).padStart(10) + f(r.heapMB, 0).padStart(9) + '  ' + r.errorCount);
    const top = Object.entries(r.systems).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ');
    if (top) console.log(' '.repeat(11) + 'plug-ins: ' + top);
}
if (args.out) { writeFileSync(args.out, JSON.stringify({ url: URL0, size: [W, H], frames: FRAMES, sync: SYNC, results }, null, 2)); console.log('\nwrote', args.out); }
