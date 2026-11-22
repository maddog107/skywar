// ═══════════════════════════════════════════════════════════════
// Multiplayer end-to-end check: the real game in a GPU headless Chromium, two pages joined to one room through the
// real relay (docs/MULTIPLAYER.md), their own render loops running.
//
//   node server.mjs &                                    # static files + relay on :8080
//   node tools/net/e2e.mjs [--url http://localhost:8080/] [--shots <dir>] [--quality low]
//
// Asserts, and prints what it measured:
//   1. both pages join through the lobby (callsign, room, side) and each sees the other's puppet
//   2. the two pages built the same world (terrain, towns' buildings, bridges, runways: a fingerprint of each)
//   3. A flies a turn: B's puppet of A follows it (error against A's own track, at the delay that fits best)
//   4. A shoots B: B's health drops on B, and the same on A's puppet of B; a missile from A is an incoming ghost on B
//      with its launch warning, and B's flares are dropped in A's world
//   5. B dies: both show "VIPER SHOT DOWN MAVERICK", both scoreboards agree, B gets a new jet that A sees
//   6. a screenshot from A of B's jet with its name tag, and one with the scoreboard up (--shots)
//   7. B leaves: gone from A; a third page in another room sees nobody, and A doesn't see it
//   8. the third page leaves through the menu and joins A's room without a reload; a dropped connection (5b) reconnects by itself
//   9. co-op: the host turns AI bandits on, the guest sees them as puppets and shoots one down (a claim the host applies)
//  10. the host leaves: the guest becomes the host and flies what is left of the bandits
//  11. a page served without a relay: the lobby reports that the server can't be reached, and stays in the menu
// Exit code 0 when everything held. Needs playwright-core: PLAYWRIGHT_CORE=<path to its index.mjs>, a local install,
// or the copy in ~/git/flight-tool. Pages read their settings from a stubbed localStorage and never write it.
// At most two game pages are open at a time (the third opens after the second has closed).
// ═══════════════════════════════════════════════════════════════
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join as joinPath, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, s, i, all) => {
    if (s.startsWith('--')) a.push([s.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return a;
}, []));
const URL0 = args.url || 'http://localhost:8080/';
const SHOTS = typeof args.shots === 'string' ? args.shots : null;
const QUALITY = args.quality || 'low';
const ROOM = 'E2E' + Math.random().toString(36).slice(2, 6).toUpperCase();

async function loadPlaywright() {
    const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright', `${homedir()}/git/flight-tool/node_modules/playwright-core/index.mjs`].filter(Boolean);
    for (const t of tries) { try { const m = await import(t); if (m.chromium || (m.default && m.default.chromium)) return m.chromium || m.default.chromium; } catch (e) { /* next */ } }
    console.error('playwright-core not found: set PLAYWRIGHT_CORE to its index.mjs'); process.exit(2);
}

const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a);
let failed = 0;
const check = (ok, what, detail = '') => { if (!ok) failed++; log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '  — ' + detail : '')); return ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });

// a game page that joins `room` as `name` on `team` through the lobby, flying `aircraft`
async function join(name, team, aircraft, room, extra = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + String(e.stack || '').split('\n').slice(0, 4).join('\n')));
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errors.push('console: ' + m.text().slice(0, 300)); });
    const settings = { mode: 'multiplayer', aircraft, start: 'air', quality: QUALITY, time: 'day', weather: 'clear', unlockAll: false, controlMode: 'keyboard', dynRes: false, music: 0, volume: 0, callouts: false,
        mpName: name, mpRoom: room, mpTeam: team, ...extra };
    await page.addInitScript((S) => {
        const gi = Storage.prototype.getItem;
        Storage.prototype.getItem = function (k) { return k === 'skywar.settings' ? JSON.stringify(S) : gi.call(this, k); };
        Storage.prototype.setItem = () => {};
    }, settings);
    await page.goto(URL0, { timeout: 240000 });
    await page.waitForSelector('#menu.show', { timeout: 240000 });
    const P = { name, page, context, errors, ev: (fn, arg) => page.evaluate(fn, arg), close: () => context.close() };
    P.lobby = await P.ev(() => ({ name: document.getElementById('mpName').value, room: document.getElementById('mpRoom').value, shown: getComputedStyle(document.getElementById('mpLobby')).display !== 'none',
        launch: document.getElementById('launchBtn').textContent.trim(), disabled: document.getElementById('launchBtn').disabled }));
    await page.click('#launchBtn', { timeout: 240000, noWaitAfter: true });
    await page.waitForFunction(() => window.skywar && window.skywar.game.state === 'playing' && window.skywar.game.mode === 'multiplayer' && window.skywar.game.mp.link, null, { timeout: 300000 });
    // the test's hand on the stick: after the game has read the keyboard, window.__ctl (stick), __fire (trigger) and
    // __chase (stay `d` m behind an aircraft, nose on it) are applied; frames are logged for the tracking check
    await P.ev(async () => {
        const THREE = await import('three');
        const g = window.skywar.game, v = new THREE.Vector3();
        window.__track = [];
        window.__feed = [];
        const addFeed = g.addFeed.bind(g);
        g.addFeed = (text, color) => { window.__feed.push(String(text)); addFeed(text, color); };
        const orig = g.updatePlayer.bind(g);
        g.updatePlayer = (dt, m) => {
            orig(dt, m);
            const p = g.player;
            if (window.__ctl) Object.assign(p.controls, window.__ctl);
            // a flown programme on the game's clock: __prog = { t0, steps: [[seconds, stick], …] }; when it is over the
            // jet is put back straight and level, the recording stops and __progDone is set
            if (window.__prog) {
                const P = window.__prog;
                if (P.t0 == null) { P.t0 = g.time; window.__rec = true; }
                let t = g.time - P.t0, on = false;
                for (const [d, stick] of P.steps) { if (t < d) { Object.assign(p.controls, stick); on = true; break; } t -= d; }
                if (!on) { window.__prog = null; window.__rec = false; window.__progDone = true; p.spawnAir(new (p.pos.constructor)(0, 3000, 3000), 0, 0.6); }
            }
            if (window.__chase && window.__chase.ac && !window.__chase.ac.exploded) {
                const t = window.__chase.ac;
                p.qv.copy(t.quat); p.alpha = 0; p.beta = 0; p.rollRate = 0; p.syncBody();
                p.vel.copy(t.vel);
                p.pos.copy(t.pos).addScaledVector(p.getForward(v), -window.__chase.d);
            }
            if (window.__fire && p.alive) {
                const t = window.__chase && window.__chase.ac;
                if (window.__stopBelow != null && t && t.health < window.__stopBelow) window.__fire = false; // (enough: see what it did)
                else { p.ammo = 500; g.weapons.fireGun(p, g.time); }
            }
            if (window.__god && p.alive) p.health = p.maxHealth;
        };
        const upd = g.mp.update.bind(g.mp);
        g.mp.update = (dt) => {
            // (what placePuppet used this frame: read before the update moves the clock and the delay on)
            const peer0 = [...g.mp.peers.values()][0], drew = peer0 ? g.mp.frameNow() - (peer0.clock.offset ?? 0) - peer0.delay : NaN, delay = peer0 ? peer0.delay : NaN;
            upd(dt);
            if (!window.__rec) return;
            const p = g.player, peer = [...g.mp.peers.values()][0], rec = peer && peer.ents.get(0);
            window.__track.push([performance.timeOrigin + g.mp.frameNow() * 1000, p.pos.x, p.pos.y, p.pos.z, rec && rec.ac ? rec.ac.pos.x : NaN, rec && rec.ac ? rec.ac.pos.y : NaN, rec && rec.ac ? rec.ac.pos.z : NaN, rec ? rec.mode : 0, g.mp.frameNow(), drew, delay]);
        };
        document.getElementById('clickToFly').style.display = 'none';
    });
    return P;
}

// what a page knows about the room
const view = (P) => P.ev(() => {
    const g = window.skywar.game, mp = g.mp;
    const peers = [...mp.peers.values()].map(p => { const r = p.ents.get(0); return { id: p.id, name: p.name, team: p.team, ac: p.ac, away: p.away, puppet: r && r.ac ? { type: r.ac.type, team: r.ac.team, callsign: r.ac.callsign, alive: r.ac.alive, health: r.ac.health, maxHealth: r.ac.maxHealth, life: r.life, safe: r.safe, inGame: g.aircraft.includes(r.ac), visible: r.ac.root.visible } : null }; });
    const p = g.player;
    return { id: mp.me.id, name: mp.me.name, team: mp.me.team, room: mp.room.code, host: mp.room.host, set: mp.room.set, peers, aircraft: g.aircraft.length, state: g.state,
        me: p ? { alive: p.alive, health: p.health, maxHealth: p.maxHealth, type: p.type, team: p.team, callsign: p.callsign, life: mp.life } : null,
        isHost: mp.isHost, ai: [...mp.locals].filter(([, e]) => e.n > 0).map(([ac, e]) => ({ n: e.n, type: ac.type, team: ac.team, alive: ac.alive, pilot: !!ac.pilot, puppet: !!ac.puppet, x: ac.pos.x, z: ac.pos.z })),
        aiPuppets: [...mp.peers.values()].flatMap(p => [...p.ents.values()].filter(r => r.n > 0 && r.ac).map(r => ({ n: r.n, type: r.ac.type, team: r.ac.team, alive: r.ac.alive, health: r.ac.health }))),
        kills: mp.kills, deaths: mp.deaths, feed: window.__feed.slice().reverse(), score: mp.scoreRows().map(r => [r.name, r.team, r.kills, r.deaths]), ping: Math.round(mp.link ? mp.link.rtt : -1), offline: !!mp.offline, time: g.world.timeKey, weather: g.world.weather };
});
const until = async (what, fn, ms = 30000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) { check(false, what, 'timed out after ' + ms / 1000 + ' s'); return null; } await sleep(100); } };

// a fingerprint of the world a page built: terrain heights on a grid, every town building, the bridges, the runways
const fingerprint = (P) => P.ev(async () => {
    const { terrainHeight, BASES } = await import('./src/world.js');
    const w = window.skywar.world;
    let h = 2166136261 >>> 0;
    const add = (x) => { const n = Math.round(x * 1000) | 0; for (let i = 0; i < 4; i++) { h ^= (n >>> (i * 8)) & 255; h = Math.imul(h, 16777619) >>> 0; } };
    const out = {};
    for (let x = -60000; x <= 60000; x += 800) for (let z = -60000; z <= 60000; z += 800) add(terrainHeight(x, z));
    out.terrain = h; h = 2166136261 >>> 0;
    const bl = w.towns && w.towns.buildings ? w.towns.buildings.list : [];
    for (const b of bl) { add(b.x); add(b.z); add(b.w || 0); add(b.d || 0); add(b.top || 0); add(b.y || 0); add(b.r || 0); add(b.yaw || 0); for (const ch of String(b.kind)) add(ch.charCodeAt(0)); }
    out.buildings = bl.length + ':' + h; h = 2166136261 >>> 0;
    const br = (w.towns && w.towns.bridges) || [];
    for (const b of br) { const p = b.pos || b.center || { x: 0, y: 0, z: 0 }; add(p.x); add(p.y || 0); add(p.z); add(b.radius || 0); }
    out.bridges = br.length + ':' + h; h = 2166136261 >>> 0;
    for (const t of (w.towns && w.towns.towns) || []) { add(t.x); add(t.z); add(t.r || 0); }
    out.towns = ((w.towns && w.towns.towns) || []).length + ':' + h; h = 2166136261 >>> 0;
    for (const b of BASES) { add(b.x); add(b.z); add(b.h); add(b.heading); for (const r of b.runways) { add(r.lx); add(r.lz); add(r.len); add(r.w); } }
    out.bases = BASES.length + ':' + h;
    return out;
});

try {
    log('room ' + ROOM + ' on ' + URL0 + ' (quality ' + QUALITY + ')');
    // ── 1. two pages join through the lobby ──
    const A = await join('viper', 'blue', 'f16', ROOM);
    log('A is in');
    const B = await join('Maverick', 'red', 'f15', ROOM, { livery: 'navy' });
    log('B is in');
    check(A.lobby.shown && A.lobby.name === 'VIPER' && A.lobby.room === ROOM && !A.lobby.disabled, 'the lobby shows callsign and room, LAUNCH enabled', JSON.stringify(A.lobby));
    // (a living puppet: a page that has only just launched may still be stalling, and is hidden to the other until it flies)
    let a = await until('A sees B\'s puppet', async () => { const v = await view(A); return v.peers.length === 1 && v.peers[0].puppet && v.peers[0].puppet.alive ? v : null; }, 60000);
    let b = await until('B sees A\'s puppet', async () => { const v = await view(B); return v.peers.length === 1 && v.peers[0].puppet && v.peers[0].puppet.alive ? v : null; }, 60000);
    if (!a || !b) throw new Error('the two pages never saw each other');
    check(a.room === ROOM && b.room === ROOM && a.host === a.id && b.host === a.id, 'same room, the first one in is the host', `room ${a.room}, host ${a.host}`);
    check(a.name === 'VIPER' && b.name === 'MAVERICK' && a.team === 'blue' && b.team === 'red', 'callsigns and sides as typed', `${a.name} (${a.team}), ${b.name} (${b.team})`);
    const pa = b.peers[0].puppet, pb = a.peers[0].puppet;
    check(pb.type === 'f15' && pb.team === 'red' && pb.callsign.startsWith('MAVERICK') && pb.inGame && pb.alive, 'A has a puppet of B: an F-15, red, MAVERICK, in game.aircraft', JSON.stringify(pb));
    check(pa.type === 'f16' && pa.team === 'blue' && pa.callsign.startsWith('VIPER') && pa.inGame && pa.alive, 'B has a puppet of A: an F-16, blue, VIPER, in game.aircraft', JSON.stringify(pa));
    check(a.aircraft === 2 && b.aircraft === 2, 'nothing else in the air (no AI, no wingmen)', `${a.aircraft} and ${b.aircraft} aircraft`);
    check(a.time === b.time && a.weather === b.weather, 'both fly in the room\'s time and weather', `${a.time}, ${a.weather}`);

    // ── 2. the same world ──
    const fa = await fingerprint(A), fb = await fingerprint(B);
    check(JSON.stringify(fa) === JSON.stringify(fb), 'both pages built the same world', JSON.stringify(fa) + (JSON.stringify(fa) === JSON.stringify(fb) ? '' : ' vs ' + JSON.stringify(fb)));

    // ── 3. A flies a turn; B's puppet of A follows ──
    await A.ev(() => { const g = window.skywar.game; g.player.spawnAir(new (g.player.pos.constructor)(0, 3000, 3000), 0, 0.6); window.__ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0.85 }; });
    await B.ev(() => { const g = window.skywar.game; g.player.spawnAir(new (g.player.pos.constructor)(3000, 3000, 0), 0, 0.6); window.__ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0.85 }; });
    await sleep(1500);
    // A flies a programme on its own game clock (level, roll in, pull, roll out, pull) and records its own track; B
    // records where it draws A, and which moment of A's clock each frame was drawing (its clock offset and drawing
    // delay for that frame). The error is the puppet against A's own track at that moment: on the frames where both
    // pages were running smoothly, and of those the ones drawn between two snapshots (the rest coasted past the newest).
    // A busy machine stalls the pages, so the measurement is taken up to three times and judged on the best.
    const measure = async () => {
        await B.ev(() => { window.__track.length = 0; window.__rec = true; });
        await A.ev(() => { window.__track.length = 0; window.__god = true; window.__progDone = false; window.__prog = { t0: null, steps: [[1.0, { pitch: 0, roll: 0, yaw: 0, throttle: 1 }], [0.7, { pitch: 0, roll: 0.9, yaw: 0, throttle: 1 }], [3.0, { pitch: 0.7, roll: 0, yaw: 0, throttle: 1 }], [1.0, { pitch: 0, roll: -0.8, yaw: 0, throttle: 1 }], [3.0, { pitch: 0.35, roll: 0, yaw: 0, throttle: 1 }]] }; });
        await until('A flies its programme', () => A.ev(() => window.__progDone), 120000);
        await sleep(600);
        const ta = await A.ev(() => window.__track.splice(0)), tb = await B.ev(() => { window.__rec = false; return window.__track.splice(0); });
        if (ta.length < 10 || tb.length < 10) return null;
        // A's own track by A's frame clock (ta[i][8]); each of B's frames says which moment of A's clock it drew (tb[i][9])
        const gapA = (T) => { let i = 1; while (i < ta.length - 1 && ta[i][8] < T) i++; return (ta[i][8] - ta[i - 1][8]) * 1000; };
        const at = (T) => { let i = 1; while (i < ta.length - 1 && ta[i][8] < T) i++; const p = ta[i - 1], q = ta[i], u = (T - p[8]) / Math.max(q[8] - p[8], 1e-6); return [p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u, p[3] + (q[3] - p[3]) * u]; };
        const all = tb.filter((r, i) => i > 0 && isFinite(r[4]) && isFinite(r[9]) && r[9] > ta[0][8] + 0.3 && r[9] < ta[ta.length - 1][8] - 0.05);
        const errOf = (rows) => { let worst = 0, sum = 0; for (const r of rows) { const p = at(r[9]), e = Math.hypot(r[4] - p[0], r[5] - p[1], r[6] - p[2]); worst = Math.max(worst, e); sum += e; } return { worst, mean: sum / Math.max(rows.length, 1), n: rows.length }; };
        const index = new Map(tb.map((r, i) => [r, i]));
        // frames where both pages were running smoothly (a page that stalls doesn't fly: its jet stands still while the clock runs)
        const smooth = all.filter(r => r[0] - tb[index.get(r) - 1][0] < 45 && gapA(r[9]) < 45 && gapA(r[9] - 0.15) < 45 && gapA(r[9] + 0.15) < 45);
        const between = smooth.filter(r => r[7] === 1);
        // how far behind A's present B draws it: A's position now against the puppet (by the wall clocks of both pages)
        const nowOf = (T) => { let i = 1; while (i < ta.length - 1 && ta[i][0] < T) i++; const p = ta[i - 1], q = ta[i], u = (T - p[0]) / Math.max(q[0] - p[0], 1e-6); return [p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u, p[3] + (q[3] - p[3]) * u]; };
        const behind = all.reduce((m, r) => { const p = nowOf(r[0]); return m + Math.hypot(r[4] - p[0], r[5] - p[1], r[6] - p[2]); }, 0) / Math.max(all.length, 1);
        const delays = all.map(r => r[10] * 1000);
        const moved = ta.slice(1).reduce((m, r, i) => m + Math.hypot(r[1] - ta[i][1], r[2] - ta[i][2], r[3] - ta[i][3]), 0);
        const secs = ta[ta.length - 1][8] - ta[0][8], fps = (t) => (t.length - 1) / (t[t.length - 1][8] - t[0][8]);
        const speed = moved / secs;
        return { eb: errOf(between), es: errOf(smooth), ea: errOf(all), behind, lag: behind / speed * 1000, delay: [Math.min(...delays), Math.max(...delays)], all: all.length, smooth: smooth.length, between: between.length, moved, speed, fpsA: fps(ta), fpsB: fps(tb) };
    };
    {
        let m = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            const r = await measure();
            if (!r) { log('     attempt ' + attempt + ': no track recorded'); continue; }
            log(`     attempt ${attempt}: A flew ${(r.moved / 1000).toFixed(2)} km through two rolls and two pulls at ${r.speed.toFixed(0)} m/s (A ${r.fpsA.toFixed(0)} fps, B ${r.fpsB.toFixed(0)} fps)`);
            log(`       B draws A ${r.lag.toFixed(0)} ms behind its present (${r.behind.toFixed(0)} m; drawing delay ${r.delay[0].toFixed(0)}–${r.delay[1].toFixed(0)} ms + the network)`);
            log(`       of B's ${r.all} frames, ${r.smooth} had both pages running smoothly, ${r.between} of those with the puppet between two snapshots`);
            log(`       the puppet against where A was at the moment B was drawing: between snapshots ${r.eb.mean.toFixed(2)} m mean / ${r.eb.worst.toFixed(2)} m worst; all smooth frames (some coasting past the newest snapshot) ${r.es.mean.toFixed(2)} / ${r.es.worst.toFixed(2)} m; every frame ${r.ea.mean.toFixed(2)} / ${r.ea.worst.toFixed(2)} m`);
            if (!m || (r.between > 60 && (m.between <= 60 || r.eb.mean < m.eb.mean))) m = r;
            if (r.between > 60 && r.between > r.smooth * 0.9 && r.eb.mean < 0.5 && r.eb.worst < 3) break; // a clean measurement
        }
        check(!!m && m.between > 60, 'enough frames to compare (both pages running smoothly, the puppet between two snapshots)', m ? m.between + ' frames' : '');
        if (m) {
            check(m.lag >= 60 && m.lag <= 450, 'the puppet is drawn the drawing delay plus the network behind', m.lag.toFixed(0) + ' ms');
            check(m.eb.mean < 1 && m.eb.worst < m.speed * 0.05, 'B\'s puppet of A follows A\'s track within a small error', `mean ${m.eb.mean.toFixed(2)} m, worst ${m.eb.worst.toFixed(2)} m at ${m.speed.toFixed(0)} m/s (a twentieth of a second of flight is ${(m.speed * 0.05).toFixed(0)} m)`);
            check(m.es.mean < 5, 'also on the frames where it coasts past the newest snapshot', `mean ${m.es.mean.toFixed(2)} m, worst ${m.es.worst.toFixed(2)} m`);
        }
    }

    // ── 4. A shoots B ──
    // B flies straight and level; A sits 250 m behind B's puppet, nose on it
    await B.ev(() => { const g = window.skywar.game; g.player.spawnAir(new (g.player.pos.constructor)(0, 3500, -2000), 0, 0.6); });
    await until('spawn protection over on both', async () => { const va = await view(A), vb = await view(B); return va.peers[0].puppet && !va.peers[0].puppet.safe && vb.peers[0].puppet && !vb.peers[0].puppet.safe; }, 15000);
    await A.ev(() => { const g = window.skywar.game, peer = [...g.mp.peers.values()][0]; window.__chase = { ac: peer.ents.get(0).ac, d: 250 }; });
    await sleep(800);
    const hp0 = (await view(B)).me.health;
    await A.ev((hp) => { window.__stopBelow = hp - 4; window.__fire = true; }, hp0);
    const hurt = await until('B\'s health drops', async () => { const v = await view(B); return v.me.health < hp0 - 3 ? v : null; }, 15000);
    await A.ev(() => { window.__fire = false; window.__stopBelow = null; });
    await sleep(900);
    if (hurt) {
        const vb = await view(B), va = await view(A);
        check(vb.me.health < hp0, 'A shoots B: B\'s health drops on B', `${hp0.toFixed(1)} → ${vb.me.health.toFixed(1)}`);
        check(Math.abs(va.peers[0].puppet.health - vb.me.health) < 0.2, 'and the same on A\'s puppet of B', `${va.peers[0].puppet.health.toFixed(1)} on A, ${vb.me.health.toFixed(1)} on B`);
        check(vb.me.alive && va.kills === 0, 'B is hurt, not dead; no kill yet');
    }

    // ── 4b. A fires a missile at B: B sees it coming and is warned; B's flares are dropped in A's world too ──
    {
        await B.ev(() => { const g = window.skywar.game; g.player.health = g.player.maxHealth; });
        await A.ev(() => { window.__chase.d = 1200; }); // (back off: a missile needs room to arm)
        await sleep(700);
        const launched = await A.ev(() => { const g = window.skywar.game, m = g.weapons.fireMissile(g.player, window.__chase.ac, 'aam'); return m ? { store: m.W.short, tracked: g.mp.myMissiles.size } : null; });
        const warned = await until('B is warned of the missile', () => B.ev(() => {
            const g = window.skywar.game, gh = [...g.mp.ghosts][0];
            return gh && g.player.incoming.includes(gh) ? { store: gh.W.short, calls: window.__feed.filter(f => /MISSILE LAUNCH/.test(f)).length } : null;
        }), 6000);
        check(!!launched && launched.tracked === 1 && !!warned && warned.store === launched.store && warned.calls >= 1, 'A fires a missile: B has it as an incoming ' + (launched ? launched.store : 'missile') + ', with the launch warning', warned ? `"${warned.store}", ${warned.calls} MISSILE LAUNCH call` : '');
        const drawn = await until('B draws the missile', () => B.ev(() => { const gh = [...window.skywar.game.mp.ghosts][0]; return !gh || (gh.mesh.visible && gh.age > 0.3) ? { there: !!gh } : null; }), 6000);
        await B.ev(() => { const g = window.skywar.game; g.player.flares = 20; g.weapons.dropFlares(g.player, g.time); });
        const flares = await until('B\'s flares in A\'s world', () => A.ev(() => { const w = window.skywar.game.weapons, t = window.__chase.ac; return w.flares.length >= 4 && w.flares.every(f => f.owner === t) ? w.flares.length : 0; }), 4000);
        check(!!drawn && flares >= 4, 'B draws the missile in flight; B\'s flares are dropped by its puppet on A', flares + ' flares on A');
        const ended = await until('the missile ends on both', async () => (await A.ev(() => window.skywar.game.mp.myMissiles.size)) === 0 && (await B.ev(() => window.skywar.game.mp.ghosts.size + window.skywar.game.player.incoming.length)) === 0, 25000);
        const vb = await view(B);
        check(!!ended, 'the missile ends on both, and the warning with it', vb.me.health < vb.me.maxHealth ? `it hit: B at ${vb.me.health.toFixed(1)} / ${vb.me.maxHealth}` : 'it missed or was decoyed: B untouched');
        await B.ev(() => { const g = window.skywar.game; if (g.player.alive) g.player.health = g.player.maxHealth; });
        await A.ev(() => { if (window.__chase) window.__chase.d = 250; });
        await sleep(800);
    }

    // ── 5. B dies ──
    await A.ev(() => { window.__fire = true; });
    const dead = await until('B is shot down', async () => { const v = await view(B); return !v.me.alive || v.deaths > 0 ? v : null; }, 40000);
    await A.ev(() => { window.__fire = false; window.__chase = null; });
    await sleep(600);
    if (dead) {
        const va = await view(A), vb = await view(B);
        const line = (v) => v.feed.find(f => /VIPER SHOT DOWN MAVERICK/.test(f));
        check(!!line(va) && !!line(vb), 'both show the kill in the feed', `A: "${line(va)}"  B: "${line(vb)}"`);
        check(va.kills === 1 && va.deaths === 0 && vb.kills === 0 && vb.deaths === 1, 'kills and losses counted', `A ${va.kills}/${va.deaths}, B ${vb.kills}/${vb.deaths}`);
        const want = JSON.stringify([['VIPER', 'blue', 1, 0], ['MAVERICK', 'red', 0, 1]]);
        const sa = await until('A\'s scoreboard', async () => { const v = await view(A); return JSON.stringify(v.score) === want ? v.score : null; }, 5000);
        const sb = await until('B\'s scoreboard', async () => { const v = await view(B); return JSON.stringify(v.score) === want ? v.score : null; }, 5000);
        check(!!sa && !!sb, 'both scoreboards agree', JSON.stringify(sa));
        const re = await until('B respawns', async () => { const v = await view(B); return v.me && v.me.alive && v.me.life === 2 && v.state === 'playing' ? v : null; }, 15000);
        const np = await until('A sees B\'s new jet', async () => { const v = await view(A); const p = v.peers[0] && v.peers[0].puppet; return p && p.alive && p.life === 2 ? p : null; }, 8000);
        check(!!re && !!np, 'B respawns in a new airframe, and A sees it', np ? `life ${np.life}, health ${np.health}/${np.maxHealth}, protected: ${np.safe}` : '');
        check(!!np && np.health === np.maxHealth && np.safe, 'the new jet is whole and spawn-protected');
    }

    // ── 5b. A's connection drops: it reconnects by itself, and the two see each other again ──
    {
        const before = await view(A);
        await A.ev(() => { window.skywar.game.mp.link.ws.close(); });
        const lost = await until('A notices the lost connection', async () => { const v = await view(A); return v.offline || v.id !== before.id ? v : null; }, 5000);
        const back = await until('A is back in the room', async () => { const v = await view(A); return !v.offline && v.id !== before.id && v.peers.length === 1 && v.peers[0].puppet ? v : null; }, 20000);
        const seen = await until('B sees A again', async () => { const v = await view(B); return v.peers.length === 1 && v.peers[0].id === (back && back.id) && v.peers[0].puppet && v.peers[0].puppet.alive ? v : null; }, 10000);
        check(!!lost && !!back && !!seen, 'a dropped connection: A reconnects by itself, both see each other again', back ? `A was client ${before.id}, is ${back.id} now; room ${back.room}; score kept: ${back.kills} kill` : '');
        check(!!back && back.kills === before.kills && back.room === before.room && back.feed.some(f => /BACK IN ROOM/.test(f)), 'same room, score kept, the feed says so', back ? back.feed.slice(0, 3).join(' | ') : '');
        check(!!seen && seen.feed.some(f => f === 'VIPER LEFT') && seen.feed.some(f => /^VIPER JOINED/.test(f)), 'B saw A leave and join again', seen ? seen.feed.slice(0, 4).join(' | ') : '');
    }

    // ── 6. screenshots from A: B's jet with its name tag; the scoreboard ──
    if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await B.ev(() => { const g = window.skywar.game; g.player.spawnAir(new (g.player.pos.constructor)(600, 2600, -1500), 0.4, 0.55); window.__ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 1 }; });
        await until('B\'s spawn protection over', async () => { const v = await view(A); const p = v.peers[0] && v.peers[0].puppet; return p && p.alive && !p.safe; }, 20000);
        await B.ev(() => { const g = window.skywar.game; g.player.spawnAir(new (g.player.pos.constructor)(600, 2600, -1500), 0.4, 0.55); });
        await sleep(1200);
        await A.ev(async () => {
            const THREE = await import('three');
            const g = window.skywar.game, peer = [...g.mp.peers.values()][0], t = peer.ents.get(0).ac;
            window.__chase = { ac: t, d: 2000 }; // (our own jet out of the picture)
            const orig = g.updateCamera.bind(g), v = new THREE.Vector3(), r = new THREE.Vector3();
            g.updateCamera = (dt, m) => {
                orig(dt, m);
                if (!window.__cam || t.exploded) return;
                const cam = g.camera;
                cam.position.copy(t.pos).addScaledVector(t.getForward(v), -30).addScaledVector(t.getRight(r), 16).add(v.set(0, 8, 0));
                // (the jet a little left of the middle, clear of our own HUD's symbology)
                cam.up.set(0, 1, 0); cam.lookAt(v.copy(t.pos).addScaledVector(t.getRight(r), 13).addScaledVector(t.getForward(r), 6)); cam.fov = 50; cam.updateProjectionMatrix();
                g.shake = 0; if (g.cockpit) g.cockpit.enabled = false;
            };
            window.__cam = true;
        });
        await sleep(1500);
        await A.page.screenshot({ path: SHOTS + '/mp-nametag.png' });
        await A.page.keyboard.down('Tab');
        await sleep(400);
        await A.page.screenshot({ path: SHOTS + '/mp-scoreboard.png' });
        await A.page.keyboard.up('Tab');
        await A.ev(() => { window.__cam = false; window.__chase = null; });
        log('     screenshots: ' + SHOTS + '/mp-nametag.png, ' + SHOTS + '/mp-scoreboard.png');
    }

    // ── 7. B leaves; a third page in another room ──
    await B.close();
    const gone = await until('B is gone from A', async () => { const v = await view(A); return v.peers.length === 0 && v.aircraft === 1 ? v : null; }, 10000);
    check(!!gone && gone.feed.some(f => f === 'MAVERICK LEFT'), 'B leaves: gone from A\'s sky, and the feed says so', gone ? gone.feed.join(' | ') : '');
    const C = await join('ghost', 'blue', 'f14', ROOM + 'X');
    await sleep(2500);
    const vc = await view(C), va = await view(A);
    check(vc.room === ROOM + 'X' && vc.peers.length === 0 && vc.aircraft === 1 && vc.host === vc.id, 'a third page in another room sees nobody (and hosts its own room)', `room ${vc.room}: ${vc.peers.length} peers, ${vc.aircraft} aircraft`);
    check(va.peers.length === 0 && va.aircraft === 1, 'and the first room doesn\'t see it', `${va.peers.length} peers, ${va.aircraft} aircraft`);
    const fc = await fingerprint(C);
    check(JSON.stringify(fc) === JSON.stringify(fa), 'the third page built the same world too');
    check(va.ping >= 0 && va.ping < 500 && !va.offline, 'the connection is healthy', 'ping ' + va.ping + ' ms');

    // ── 8. C leaves its room through the menu and joins A's (no reload) ──
    await C.ev(() => window.skywar.game.pause(true));
    const menuUp = await C.ev(() => ({ shown: document.getElementById('pause').classList.contains('show'), state: window.skywar.game.state }));
    check(menuUp.shown && menuUp.state === 'playing', 'Esc in multiplayer: the menu comes up, the game goes on', JSON.stringify(menuUp));
    await C.page.click('#abortBtn', { timeout: 240000, noWaitAfter: true });
    await C.page.waitForSelector('#menu.show', { timeout: 120000 });
    const left = await C.ev(() => ({ state: window.skywar.game.state, link: !!window.skywar.game.mp.link, active: window.skywar.game.mp.active, aircraft: window.skywar.game.aircraft.length }));
    check(left.state === 'menu' && !left.link && !left.active, 'ABORT: back in the hangar, the connection closed', JSON.stringify(left));
    await C.page.fill('#mpRoom', ROOM);
    await C.page.click('#launchBtn', { timeout: 240000, noWaitAfter: true });
    await C.page.waitForFunction(() => window.skywar.game.state === 'playing' && window.skywar.game.mode === 'multiplayer' && window.skywar.game.mp.link, null, { timeout: 300000 });
    const cIn = await until('C and A see each other', async () => { const c = await view(C), a = await view(A); return c.room === ROOM && c.peers.length === 1 && c.peers[0].puppet && a.peers.length === 1 && a.peers[0].puppet ? { c, a } : null; }, 20000);
    check(!!cIn && cIn.c.host === cIn.a.id && cIn.a.isHost && !cIn.c.isHost && cIn.a.peers[0].name === 'GHOST', 'C joined A\'s room from the menu; A is its host', cIn ? `room ${cIn.c.room}, host ${cIn.c.host}` : '');

    // ── 9. co-op: the host calls in AI bandits; the guest sees them and shoots one down ──
    await A.ev(() => { const g = window.skywar.game; window.__god = true; g.player.spawnAir(new (g.player.pos.constructor)(0, 3000, 0), 0, 0.6); window.__ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0.85 }; g.mp.toggleBandits(); });
    await C.ev(() => { const g = window.skywar.game; window.__god = true; g.player.spawnAir(new (g.player.pos.constructor)(500, 3200, 2000), 0, 0.6); window.__ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0.85 }; });
    const wave = await until('the host\'s bandits arrive', async () => { const a = await view(A); return a.ai.filter(x => x.alive).length >= 1 ? a : null; }, 20000);
    // (a puppet on the guest for every bandit alive on the host)
    let lastSeen = null;
    const seenAI = wave && await until('the guest sees them', async () => { const c = await view(C), a = await view(A); lastSeen = { c, a }; const alive = a.ai.filter(x => x.alive); return alive.length >= 1 && alive.every(x => c.aiPuppets.some(p => p.n === x.n)) ? { c, a } : null; }, 25000);
    if (wave && !seenAI && lastSeen) log('     host AI: ' + JSON.stringify(lastSeen.a.ai) + ' | guest puppets: ' + JSON.stringify(lastSeen.c.aiPuppets) + ' | guest thinks the host is ' + lastSeen.c.host + ', the host is ' + lastSeen.a.id);
    check(!!wave && !!seenAI && seenAI.c.set.ai === true, 'the host turns AI bandits on: a wave spawns on the host, the guest has a puppet of each', seenAI ? `${seenAI.a.ai.length} bandit(s) on the host: ${seenAI.a.ai.map(x => x.type).join(', ')}; puppets on the guest: ${seenAI.c.aiPuppets.map(x => x.type).join(', ')}` : '');
    if (seenAI) {
        check(seenAI.a.ai.every(x => x.pilot && !x.puppet && x.team === 'red') && seenAI.c.aiPuppets.every(x => x.team === 'red'), 'they are real AI aircraft on the host, red puppets on the guest');
        // the guest sits behind one of them and fires
        const n = await C.ev(() => { const g = window.skywar.game, host = g.mp.peers.get(g.mp.room.host), rec = [...host.ents.values()].find(r => r.n > 0 && r.ac && r.ac.alive); window.__chase = { ac: rec.ac, d: 220 }; window.__fire = true; return rec.n; });
        const down = await until('the guest shoots a bandit down', async () => { const c = await view(C); return c.kills >= 1 ? c : null; }, 40000);
        await C.ev(() => { window.__fire = false; window.__chase = null; });
        await sleep(500);
        const a = await view(A), c = await view(C);
        const line = (v) => v.feed.find(f => /^GHOST SHOT DOWN /.test(f));
        check(!!down && !!line(a) && line(a) === line(c), 'the guest\'s hits were applied by the host; the kill is the guest\'s, and both say so', `"${line(c)}"`);
        check(c.kills === 1 && a.kills === 1 && !a.ai.some(x => x.n === n && x.alive), 'scores: the guest has the bandit, the host keeps its earlier kill', `guest ${c.kills}, host ${a.kills}`);
    }

    // ── 10. the host leaves: the guest is the host now and flies what is left of the bandits ──
    const remaining = (await view(A)).ai.filter(x => x.alive).length;
    await A.close();
    const mig = await until('C becomes the host', async () => { const v = await view(C); return v.isHost && v.peers.length === 0 ? v : null; }, 10000);
    check(!!mig && mig.feed.some(f => /HOST NOW/.test(f)) && mig.set.ai === true, 'the host leaves: the guest is the host, the bandits\' switch is still on', mig ? mig.feed.slice(0, 2).join(' | ') : '');
    if (remaining > 0) {
        const mine = await until('the bandits are the new host\'s', async () => { const v = await view(C); return v.ai.length >= 1 && v.aiPuppets.length === 0 ? v : null; }, 5000);
        await sleep(1500);
        const later = await view(C);
        const moved = mine && later.ai.length ? Math.hypot(later.ai[0].x - mine.ai[0].x, later.ai[0].z - mine.ai[0].z) : 0;
        check(!!mine && mine.ai.every(x => x.pilot && !x.puppet) && moved > 50, 'the bandit that was left is the new host\'s own AI aircraft now, and flying', mine ? `${mine.ai.length} bandit(s): ${mine.ai.map(x => x.type).join(', ')}; moved ${moved.toFixed(0)} m in 1.5 s` : '');
    } else {
        const next = await until('the new host\'s next wave', async () => { const v = await view(C); return v.ai.length >= 1 ? v : null; }, 25000);
        check(!!next, 'no bandit was left to hand over; the new host spawns the next wave', next ? next.ai.map(x => x.type).join(', ') : '');
    }
    const vEnd = await view(C);
    check(vEnd.ping >= 0 && !vEnd.offline, 'the connection is healthy', 'ping ' + vEnd.ping + ' ms');

    const errs = [...A.errors.map(e => 'A: ' + e), ...B.errors.map(e => 'B: ' + e), ...C.errors.map(e => 'C: ' + e)];
    check(errs.length === 0, 'no page errors or console errors', errs.slice(0, 5).join('\n'));
    await C.close();

    // ── 11. no relay to reach: the lobby says so and the menu stays ──
    {
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
        const root = fileURLToPath(new URL('../../', import.meta.url));
        // the same files, from a server with no relay behind it
        const plain = http.createServer(async (req, res) => {
            const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
            const file = joinPath(root, path === '/' ? 'index.html' : path);
            if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
            try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data); } catch (e) { res.writeHead(404); res.end(); }
        });
        await new Promise(r => plain.listen(0, '127.0.0.1', r));
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const page = await context.newPage();
        await page.addInitScript((S) => { const gi = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { return k === 'skywar.settings' ? JSON.stringify(S) : gi.call(this, k); }; Storage.prototype.setItem = () => {}; },
            { mode: 'multiplayer', aircraft: 'f16', quality: QUALITY, time: 'day', weather: 'clear', controlMode: 'keyboard', dynRes: false, music: 0, volume: 0, mpName: 'NOBODY', mpRoom: ROOM, mpTeam: 'blue' });
        await page.goto('http://127.0.0.1:' + plain.address().port + '/', { timeout: 240000 });
        await page.waitForSelector('#menu.show', { timeout: 240000 });
        await page.click('#launchBtn', { timeout: 240000, noWaitAfter: true });
        await page.waitForFunction(() => document.getElementById('mpStatus').classList.contains('err'), null, { timeout: 20000 }).catch(() => {});
        const r = await page.evaluate(() => ({ text: document.getElementById('mpStatus').textContent, err: document.getElementById('mpStatus').classList.contains('err'), menu: document.getElementById('menu').classList.contains('show'), state: window.skywar.game.state, link: !!window.skywar.game.mp.link, pending: !!window.skywar.game.mp.pending }));
        check(r.err && /can't reach the multiplayer server/i.test(r.text) && r.menu && r.state === 'menu' && !r.link && !r.pending, 'no relay to reach: the lobby says so in plain words and the menu stays up', '"' + r.text + '"');
        if (SHOTS) { await page.screenshot({ path: SHOTS + '/mp-lobby-error.png' }); log('     screenshot: ' + SHOTS + '/mp-lobby-error.png'); }
        await context.close();
        plain.close(); plain.closeAllConnections && plain.closeAllConnections();
    }
} catch (e) {
    failed++;
    log('  FAIL ' + (e && e.stack || e));
} finally {
    await browser.close();
}
log(failed ? failed + ' CHECK' + (failed === 1 ? '' : 'S') + ' FAILED' : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
