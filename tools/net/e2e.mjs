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
//   4. A shoots B: B's health drops on B, and the same on A's puppet of B
//   5. B dies: both show "VIPER SHOT DOWN MAVERICK", both scoreboards agree, B gets a new jet that A sees
//   6. a screenshot from A of B's jet with its name tag, and one with the scoreboard up (--shots)
//   7. B leaves: gone from A; a third page in another room sees nobody, and A doesn't see it
// Exit code 0 when everything held. Needs playwright-core: PLAYWRIGHT_CORE=<path to its index.mjs>, a local install,
// or the copy in ~/git/flight-tool. Pages read their settings from a stubbed localStorage and never write it.
// At most two game pages are open at a time (the third opens after the second has closed).
// ═══════════════════════════════════════════════════════════════
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

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
    await page.goto(URL0);
    await page.waitForSelector('#menu.show', { timeout: 240000 });
    const P = { name, page, context, errors, ev: (fn, arg) => page.evaluate(fn, arg), close: () => context.close() };
    P.lobby = await P.ev(() => ({ name: document.getElementById('mpName').value, room: document.getElementById('mpRoom').value, shown: getComputedStyle(document.getElementById('mpLobby')).display !== 'none',
        launch: document.getElementById('launchBtn').textContent.trim(), disabled: document.getElementById('launchBtn').disabled }));
    await page.click('#launchBtn');
    await page.waitForFunction(() => window.skywar && window.skywar.game.state === 'playing' && window.skywar.game.mode === 'multiplayer' && window.skywar.game.mp.link, null, { timeout: 120000 });
    // the test's hand on the stick: after the game has read the keyboard, window.__ctl (stick), __fire (trigger) and
    // __chase (stay `d` m behind an aircraft, nose on it) are applied; frames are logged for the tracking check
    await P.ev(async () => {
        const THREE = await import('three');
        const g = window.skywar.game, v = new THREE.Vector3();
        window.__track = [];
        const orig = g.updatePlayer.bind(g);
        g.updatePlayer = (dt, m) => {
            orig(dt, m);
            const p = g.player;
            if (window.__ctl) Object.assign(p.controls, window.__ctl);
            if (window.__chase && window.__chase.ac && !window.__chase.ac.exploded) {
                const t = window.__chase.ac;
                p.qv.copy(t.quat); p.alpha = 0; p.beta = 0; p.rollRate = 0; p.syncBody();
                p.vel.copy(t.vel);
                p.pos.copy(t.pos).addScaledVector(p.getForward(v), -window.__chase.d);
            }
            if (window.__fire && p.alive) { p.ammo = 500; g.weapons.fireGun(p, g.time); }
        };
        const upd = g.mp.update.bind(g.mp);
        g.mp.update = (dt) => {
            upd(dt);
            if (!window.__rec) return;
            const p = g.player, peer = [...g.mp.peers.values()][0], rec = peer && peer.ents.get(0);
            window.__track.push([performance.timeOrigin + performance.now(), p.pos.x, p.pos.y, p.pos.z, rec && rec.ac ? rec.ac.pos.x : NaN, rec && rec.ac ? rec.ac.pos.y : NaN, rec && rec.ac ? rec.ac.pos.z : NaN, rec ? rec.mode : 0]);
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
        kills: mp.kills, deaths: mp.deaths, feed: g.feed.map(f => f.text), score: mp.scoreRows().map(r => [r.name, r.team, r.kills, r.deaths]), ping: Math.round(mp.link ? mp.link.rtt : -1), offline: !!mp.offline, time: g.world.timeKey, weather: g.world.weather };
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
    for (const b of bl) { add(b.x); add(b.z); add(b.w || 0); add(b.d || 0); add(b.top || 0); add(b.y || 0); add(b.r || 0); }
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
    let a = await until('A sees B\'s puppet', async () => { const v = await view(A); return v.peers.length === 1 && v.peers[0].puppet ? v : null; });
    let b = await until('B sees A\'s puppet', async () => { const v = await view(B); return v.peers.length === 1 && v.peers[0].puppet ? v : null; });
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
    await A.ev(() => { window.__rec = true; }); await B.ev(() => { window.__rec = true; });
    await sleep(800);
    await A.ev(() => { window.__ctl = { pitch: 0, roll: 0.9, yaw: 0, throttle: 1 }; });
    await sleep(700);
    await A.ev(() => { window.__ctl = { pitch: 0.7, roll: 0, yaw: 0, throttle: 1 }; });
    await sleep(3000);
    const ta = await A.ev(() => { window.__rec = false; return window.__track.splice(0); }), tb = await B.ev(() => { window.__rec = false; return window.__track.splice(0); });
    await A.ev(() => { window.__ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0.85 }; });
    {
        // A's own track (ta: t, x, y, z) against B's puppet of A (tb: t, …, px, py, pz): for each of B's frames, where A
        // really was `delay` earlier; the delay that fits best is the puppet's lag (the interpolation delay + the network)
        const at = (T) => { let i = 1; while (i < ta.length - 1 && ta[i][0] < T) i++; const p = ta[i - 1], q = ta[i], u = (T - p[0]) / Math.max(q[0] - p[0], 1e-6); return [p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u, p[3] + (q[3] - p[3]) * u]; };
        const rows = tb.filter(r => isFinite(r[4]) && r[0] > ta[0][0] + 600 && r[0] < ta[ta.length - 1][0] - 50);
        const errAt = (delay) => { let worst = 0, sum = 0; for (const r of rows) { const p = at(r[0] - delay), e = Math.hypot(r[4] - p[0], r[5] - p[1], r[6] - p[2]); worst = Math.max(worst, e); sum += e; } return { worst, mean: sum / Math.max(rows.length, 1) }; };
        let best = { delay: 0, mean: Infinity, worst: Infinity };
        for (let d = 0; d <= 500; d += 2) { const e = errAt(d); if (e.mean < best.mean) best = { delay: d, ...e }; }
        const now = errAt(0), moved = Math.hypot(ta[ta.length - 1][1] - ta[0][1], ta[ta.length - 1][2] - ta[0][2], ta[ta.length - 1][3] - ta[0][3]);
        const fps = (t) => (t.length - 1) / ((t[t.length - 1][0] - t[0][0]) / 1000);
        const speed = moved / ((ta[ta.length - 1][0] - ta[0][0]) / 1000);
        const interp = rows.filter(r => r[7] === 1).length / Math.max(rows.length, 1);
        log(`     A flew ${(moved / 1000).toFixed(2)} km through a roll and a pull (${ta.length} frames at ${fps(ta).toFixed(0)} fps; B ${tb.length} at ${fps(tb).toFixed(0)} fps); ${rows.length} of B's frames compared, ${(interp * 100).toFixed(0)}% of them between two snapshots`);
        log(`     B's puppet of A lags A by ${best.delay} ms; at that lag it is ${best.mean.toFixed(2)} m (mean) / ${best.worst.toFixed(2)} m (worst) from A's own track; against A's present position: ${now.mean.toFixed(1)} m / ${now.worst.toFixed(1)} m`);
        check(rows.length > 40, 'enough frames to compare', rows.length + ' frames');
        check(best.delay >= 60 && best.delay <= 400, 'the puppet lags by the interpolation delay plus the network', best.delay + ' ms');
        check(best.mean < 3 && best.worst < 12, 'B\'s puppet of A follows A\'s track within a small error', `mean ${best.mean.toFixed(2)} m, worst ${best.worst.toFixed(2)} m at ${speed.toFixed(0)} m/s`);
        check(now.worst < speed * 0.5, 'and is never far behind where A is now', now.worst.toFixed(1) + ' m');
    }

    // ── 4. A shoots B ──
    // B flies straight and level; A sits 250 m behind B's puppet, nose on it
    await B.ev(() => { const g = window.skywar.game; g.player.spawnAir(new (g.player.pos.constructor)(0, 3500, -2000), 0, 0.6); });
    await until('spawn protection over on both', async () => { const va = await view(A), vb = await view(B); return va.peers[0].puppet && !va.peers[0].puppet.safe && vb.peers[0].puppet && !vb.peers[0].puppet.safe; }, 15000);
    await A.ev(() => { const g = window.skywar.game, peer = [...g.mp.peers.values()][0]; window.__chase = { ac: peer.ents.get(0).ac, d: 250 }; });
    await sleep(800);
    const hp0 = (await view(B)).me.health;
    await A.ev(() => { window.__fire = true; });
    const hurt = await until('B\'s health drops', async () => { const v = await view(B); return v.me.health < hp0 - 3 ? v : null; }, 15000);
    await A.ev(() => { window.__fire = false; });
    await sleep(700);
    if (hurt) {
        const vb = await view(B), va = await view(A);
        check(vb.me.health < hp0, 'A shoots B: B\'s health drops on B', `${hp0.toFixed(1)} → ${vb.me.health.toFixed(1)}`);
        check(Math.abs(va.peers[0].puppet.health - vb.me.health) < 0.2, 'and the same on A\'s puppet of B', `${va.peers[0].puppet.health.toFixed(1)} on A, ${vb.me.health.toFixed(1)} on B`);
        check(vb.me.alive && va.kills === 0, 'B is hurt, not dead; no kill yet');
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

    // ── 6. screenshots from A: B's jet with its name tag; the scoreboard ──
    if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await B.ev(() => { const g = window.skywar.game; g.player.spawnAir(new (g.player.pos.constructor)(600, 2600, -1500), 0.4, 0.55); window.__ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 1 }; });
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
                cam.position.copy(t.pos).addScaledVector(t.getForward(v), -26).addScaledVector(t.getRight(r), 14).add(v.set(0, 7, 0));
                cam.up.set(0, 1, 0); cam.lookAt(t.pos); cam.fov = 50; cam.updateProjectionMatrix();
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

    const errs = [...A.errors.map(e => 'A: ' + e), ...B.errors.map(e => 'B: ' + e), ...C.errors.map(e => 'C: ' + e)];
    check(errs.length === 0, 'no page errors or console errors', errs.slice(0, 5).join('\n'));
    await C.close(); await A.close();
} catch (e) {
    failed++;
    log('  FAIL ' + (e && e.stack || e));
} finally {
    await browser.close();
}
log(failed ? failed + ' CHECK' + (failed === 1 ? '' : 'S') + ' FAILED' : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
