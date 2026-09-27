// Mobile forces (forces.js, forcesunits.js, forcesgroups.js, forcesnav.js) headless: the TEL's cycle (drive, jacks,
// pad, erector, prep, a launch only once it's erect, stow, relocate), a launcher's countdown held until the vehicle
// is ready, SAM batteries that need their radars (S-300 blind without the Flap Lid, Buk short-ranged without its
// search radar, Osa on its own), radars feeding war.coverage only while emitting, shoot-and-scoot relocation,
// routing over a road network round a downed bridge, speed limits for bends and hills, a convoy that keeps its
// spacing, scatters when hit and regroups, hide sites where they should be, rocket salvos laid before they
// ripple, and abstract salvos far from the camera that still do damage.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { forcesGame, THREE, world } from './helpers/forces.mjs';
import { mulberry32 } from './helpers/arena.mjs';

const N = await src('forcesnav.js');
const U = await src('forcesunits.js');
const GR = await src('forcesgroups.js');
const { War, INTEL } = await src('war.js');

// Math.random seeded for one test (restored after)
function seeded(seed, fn) {
    const orig = Math.random;
    Math.random = mulberry32(seed);
    try { return fn(); } finally { Math.random = orig; }
}
const RED = { x: 9000, z: -21000 }; // on the enemy island
const flat2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

describe('mobile forces: TELs', () => {
    test('a TEL drives to its firing point, jacks, pad, erector, prep, fires only when erect, stows and relocates', () => seeded(11, () => {
        const g = forcesGame();
        const F = g.forces;
        const hide = { kind: 'forest', x: RED.x, z: RED.z, heading: 0, conceal: 0.85 };
        const hide2 = { kind: 'valley', x: RED.x - 1500, z: RED.z + 600, heading: 0, conceal: 0.55 };
        const fire = { kind: 'firing', x: RED.x + 550, z: RED.z + 450, heading: 0, conceal: 0.15 };
        const B = { team: 'red', hides: [hide, hide2], firing: [fire], occupied: new Set(), reload: null, tels: [] };
        const tel = F.spawnTEL('red', hide, { brigade: B, site: hide });
        assert.equal(tel.state, 'hide');
        assert.ok(tel.v.conceal > 0.8, 'hidden in the forest edge');
        assert.ok(g.war.known(tel.v) < INTEL.CONTACT, 'nobody knows it is there');
        assert.equal(g.strikes.sources.filter(s => s.team === 'red' && s.kind === 'launcher').length, 1, 'a red launch source');
        const mark = { id: 0, pos: new THREE.Vector3(0, 22, 0), fixed: new THREE.Vector3(0, 22, 0), transmitted: true, label: 'HOME' };
        const st = g.strikes.request('ballistic', [mark], 'red', true);
        assert.ok(st && st.planned === 1, 'the strike found our TEL');
        const eta = tel.prepEstimate();
        const t0 = g.war.time;
        const states = [tel.state];
        let atLaunch = null;
        for (let t = 0; t < 900 && !(states.includes('fired') && tel.state === 'hide'); t += 0.1) {
            g.step(0.1);
            if (states[states.length - 1] !== tel.state) states.push(tel.state);
            const m = g.strikes.missiles.find(x => x.source && x.source.host === tel.v);
            if (m && !atLaunch) atLaunch = { t: g.war.time - t0, raise: tel.v.state.raise, jack: tel.v.state.jack, pad: tel.v.state.pad, pos: m.pos.clone(), vel: m.vel.clone(), base: tel.v.base.clone() };
        }
        assert.deepEqual(states.slice(0, 7), ['move', 'setup', 'prep', 'ready', 'fired', 'stow', 'move'], states.join(' → '));
        assert.equal(tel.state, 'hide', 'hidden again');
        assert.ok(atLaunch, 'the missile left');
        assert.equal(atLaunch.raise, 1, 'erector up at launch'); assert.equal(atLaunch.jack, 1, 'jacks down'); assert.equal(atLaunch.pad, 1, 'pad down');
        assert.ok(atLaunch.pos.y > atLaunch.base.y + 4, 'from the erected missile, not the truck bed');
        assert.ok(atLaunch.vel.y > 0.95 * atLaunch.vel.length(), 'straight up off the pad');
        assert.ok(flat2(atLaunch.base, fire) < 30, 'fired from the surveyed firing point');
        assert.ok(Math.abs(atLaunch.t - eta) < eta * 0.2, `ETA ${eta.toFixed(0)} s vs launch at ${atLaunch.t.toFixed(0)} s`);
        assert.equal(tel.v.loaded, 0, 'the rail is empty'); assert.equal(tel.launcher.stock.scud, 0);
        assert.notEqual(tel.site, fire, 'moved off the firing point');
        assert.ok(flat2(tel.v.pos, atLaunch.base) > 800, 'relocated well away from the launch point');
        const ev = g.events.log.map(e => e.k);
        assert.ok(ev.includes('telLaunched') && ev.includes('telRelocated') && ev.includes('strategicLaunch'), ev.join(','));
    }));

    test('the launch countdown waits for the TEL to be ready; a hit during set-up calls the launch off', () => seeded(5, () => {
        const g = forcesGame();
        const F = g.forces;
        const fire = { kind: 'firing', x: RED.x + 450, z: RED.z + 300, heading: 0 };
        const B = { team: 'red', hides: [], firing: [fire], occupied: new Set(), reload: null, tels: [] };
        const tel = F.spawnTEL('red', { x: RED.x, z: RED.z }, { brigade: B });
        const st = g.strikes.request('ballistic', [{ id: 0, pos: new THREE.Vector3(0, 22, 0), fixed: new THREE.Vector3(0, 22, 0) }], 'red', true);
        const q = tel.launcher.queue[0];
        const t0 = q.t;
        g.run(20, 0.1);
        assert.equal(q.t, t0, 'no countdown while it drives and sets up');
        assert.ok(['move', 'setup'].includes(tel.state), tel.state);
        g.run(300, 0.1, () => tel.state === 'setup' && tel.v.state.jack > 0.5);
        assert.equal(tel.state, 'setup');
        tel.v.damage(tel.v.maxHp * 0.5, null, 'gun');
        assert.equal(tel.launcher.queue.length, 0, 'the launch is off');
        assert.equal(st.planned, 0, 'the strike knows it lost its missile');
        assert.equal(tel.state, 'stow');
        g.run(60, 0.1);
        assert.equal(g.strikes.missiles.length, 0, 'nothing launched');
    }));
});

describe('mobile forces: SAM batteries', () => {
    const jetIn = (g, site, km, alt) => g.addJet(site.x + km * 1000, (Math.max(world.terrainHeight(site.x, site.z), 0)) + alt, site.z, -60, 0);
    const shots = (g, gr) => g.samLog.filter(m => gr.launchers.includes(m.owner)).length;

    test('an S-300 battery engages with its Flap Lid, and is blind without it', () => seeded(3, () => {
        const g = forcesGame();
        const site = { x: RED.x, z: RED.z, heading: 0 };
        const gr = g.forces.spawnSAM('red', 's300', site, { emcon: 'search' });
        assert.equal(gr.state, 'ready');
        assert.ok(gr.radar && gr.search && gr.command && gr.launchers.length === 3, 'Flap Lid, search radar, command post, three launchers');
        jetIn(g, site, 11, 4000);
        g.run(25, 0.1);
        assert.ok(shots(g, gr) >= 1, 'it fired');
        const m = g.samLog[0];
        assert.ok(m.W && m.W.prox > 0 && m.life > 20, 'its own missile (a proximity fuse, the reach for 17 km)');
        assert.ok(m.pos.y > gr.launchers[0].base.y + 2 || gr.launchers.some(l => m.pos.distanceTo(l.pos) < 20), 'from a launcher');

        const g2 = forcesGame();
        const gr2 = g2.forces.spawnSAM('red', 's300', site, { emcon: 'search' });
        gr2.radar.destroy(null);
        jetIn(g2, site, 11, 4000);
        g2.run(40, 0.1);
        assert.equal(shots(g2, gr2), 0, 'no engagement radar: the launchers are blind');
    }));

    test('a Buk battery without its search radar and command post is short-ranged; an Osa fights alone', () => seeded(4, () => {
        const site = { x: RED.x, z: RED.z, heading: 0 };
        const g = forcesGame();
        const gr = g.forces.spawnSAM('red', 'buk', site, { emcon: 'search' });
        jetIn(g, site, 10, 3000);
        g.run(20, 0.1);
        assert.ok(shots(g, gr) >= 1, 'with its search radar it reaches 10 km');
        assert.ok(gr.envelope().range > 12000);

        const g2 = forcesGame();
        const gr2 = g2.forces.spawnSAM('red', 'buk', site, { emcon: 'search' });
        gr2.search.destroy(null); gr2.command.destroy(null);
        assert.ok(gr2.envelope().range < 8000 && gr2.envelope().lock > gr.envelope().lock, 'on its own radars: shorter, slower');
        const j = g2.addJet(site.x + 10000, 3000, site.z, 0, 0); // (holding off at 10 km)
        g2.run(20, 0.1);
        assert.equal(shots(g2, gr2), 0, 'nothing at 10 km');
        j.pos.x = site.x + 6000;
        g2.run(20, 0.1);
        assert.ok(shots(g2, gr2) >= 1, 'but it still fights close in');

        const g3 = forcesGame();
        const osa = g3.forces.spawnSAM('red', 'osa', site, { emcon: 'search', launchers: 1 });
        assert.ok(!osa.radar && !osa.search, 'an Osa is its own radar');
        jetIn(g3, site, 5, 2800);
        g3.run(15, 0.1);
        assert.ok(shots(g3, osa) >= 1, 'the Osa engaged on its own');
    }));

    test('radars feed war.coverage only while they emit; locks register with the target (RWR)', () => seeded(6, () => {
        const g = forcesGame();
        const site = { x: RED.x, z: RED.z, heading: 0 };
        const gr = g.forces.spawnSAM('red', 's300', site, { emcon: 'search' });
        const jet = g.addJet(site.x + 15000, 5000, site.z, 0, 0);
        g.run(2, 0.1);
        assert.ok(gr.radarOn);
        assert.ok(g.war.coverage('red', jet.pos) > 0, 'the battery\'s radars see it');
        g.run(4, 1 / 30);
        assert.ok(jet.lockedBy && jet.lockedBy.size > 0, 'the target hears the lock');
        gr.setRadar(false);
        assert.equal(g.war.coverage('red', jet.pos), 0, 'silent radars see nothing');
    }));

    test('shoot and scoot: found (or after a few shots) it packs up, moves 5+ km in its own ground and sets up again', () => seeded(9, () => {
        const g = forcesGame();
        const site = { x: RED.x, z: RED.z, heading: 0 };
        const gr = g.forces.spawnSAM('red', 'osa', site, { emcon: 'search', launchers: 2 });
        g.run(3, 0.1);
        assert.equal(gr.moveAt, Infinity, 'nobody has found it');
        g.war.reveal(gr.launchers[0], INTEL.IDENTIFIED, 'visual');
        g.run(3, 0.1);
        assert.ok(gr.moveAt < Infinity, 'found: it will move');
        g.run(90, 0.1, () => gr.state === 'moving');
        const ev = g.events.log.find(e => e.k === 'samRelocating');
        assert.ok(ev, 'it announced the move (event)');
        const to = ev.b.to;
        assert.ok(flat2(to, site) >= 4500, 'somewhere new: ' + flat2(to, site).toFixed(0) + ' m');
        assert.equal(g.war.sideAt(to.x, to.z), 'red');
        assert.ok(gr.launchers.every(l => l.state.raise === 0 || l.moving || l.busy), 'masts down to travel');
        g.run(2400, 0.5, () => gr.state === 'ready');
        assert.equal(gr.state, 'ready', 'set up again');
        assert.ok(gr.launchers.every(l => flat2(l.pos, to) < 600), 'at the new position');

        // a busy battery moves too
        const g2 = forcesGame();
        const gr2 = g2.forces.spawnSAM('red', 'osa', site, { emcon: 'search', launchers: 2 });
        const jet = g2.addJet(site.x + 5000, 2800, site.z, 0, 0);
        // (its missiles are stubs that never arrive: clear the target's incoming now and then so it keeps shooting)
        g2.run(120, 0.1, () => { if (Math.random() < 0.02) jet.incoming.length = 0; return gr2.moveAt < Infinity; });
        assert.ok(gr2.shots >= 3 && gr2.moveAt < Infinity, 'after firing it plans to move (' + gr2.shots + ' shots)');
    }));
});

describe('mobile forces: roads and routes', () => {
    // a synthetic network: A west–east to a junction, B on east, C north from the junction, and D a longer road
    // from A's start to B's end with a bridge in the middle
    const O = { x: RED.x, z: RED.z };
    const line = (pts) => { let s = 0; const P = pts.map((p, i) => { if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); return { x: O.x + p[0], y: 30, z: O.z + p[1], g: 0, s }; }); return { pts: P, len: s, bridges: [] }; };
    const dense = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    const net = () => {
        const A = line(dense([0, 0], [2000, 0], 20)), B = line(dense([2000, 0], [4000, 0], 20)), C = line(dense([2000, 0], [2000, -2000], 20));
        const D = line([...dense([0, 0], [2000, 900], 20), ...dense([2000, 900], [4000, 0], 20).slice(1)]);
        const brD = { bridge: { alive: true, a: { x: O.x + 1800, z: O.z + 810 }, b: { x: O.x + 2200, z: O.z + 810 } }, s0: D.len / 2 - 200, s1: D.len / 2 + 200 };
        D.bridges.push(brD);
        const brB = { bridge: { alive: true, a: { x: O.x + 2800, z: O.z }, b: { x: O.x + 3200, z: O.z } }, s0: 800, s1: 1200 };
        B.bridges.push(brB);
        const J = { x: O.x + 2000, z: O.z, arms: [{ path: A, s: 2000 }, { path: B, s: 0 }, { path: C, s: 0 }] };
        return { A, B, C, D, brD, brB, net: new N.RoadNet([A, B, C, D], [J]) };
    };

    test('the shortest way through the junction, round a downed bridge, or none', () => {
        const { A, B, D, brD, brB, net: R } = net();
        const from = { path: A, s: 10 }, to = { path: B, s: B.len - 10 };
        const r1 = R.route(from, to);
        assert.ok(r1, 'a route');
        assert.deepEqual(r1.map(l => l.path), [A, B], 'straight through the junction');
        brB.bridge.alive = false;
        const r2 = R.route(from, to);
        assert.ok(r2 && r2.some(l => l.path === D), 'round by the other road when the bridge on the way is down');
        brD.bridge.alive = false;
        assert.equal(R.route(from, to), null, 'no way at all');
        const q = R.nearest(O.x + 1000, O.z - 300, 1000);
        assert.ok(q && q.path === A && Math.abs(q.s - 1000) < 1 && Math.abs(q.d - 300) < 1, 'the nearest point on a road');
    });

    test('speed limits: slower for a sharp bend and up a hill, braking room before them', () => {
        const straight = new N.Route(), bend = new N.Route(), hill = new N.Route();
        for (let i = 0; i <= 40; i++) straight.add(i * 20, 0, 0, 0, 1);
        for (let i = 0; i <= 20; i++) bend.add(i * 20, 0, 0, 0, 1);
        for (let i = 1; i <= 20; i++) bend.add(400, 0, i * 20, 0, 1);
        for (let i = 0; i <= 40; i++) hill.add(i * 20, i * 20 * 0.12, 0, 0, 1);
        for (const r of [straight, bend, hill]) r.limits(22);
        assert.ok(straight.lim[20] > 20, 'full speed on the straight');
        assert.ok(bend.lim[20] < 9, 'slow round the corner: ' + bend.lim[20].toFixed(1));
        assert.ok(bend.lim[15] < straight.lim[15], 'braking before it');
        assert.ok(hill.lim[20] < 0.45 * straight.lim[20], 'a crawl up a 12 % grade: ' + hill.lim[20].toFixed(1));
    });

    test('a convoy keeps its spacing, scatters off the road when hit, regroups and arrives', () => seeded(21, () => {
        const g = forcesGame();
        const F = g.forces;
        const { A, B, net: R } = net();
        F.net = R; F.env.net = R;
        F.env.heightAt = () => 30; F.env.solid = () => false; F.driveable = () => true;
        const cv = F.spawnConvoy('red', { x: A.pts[1].x, z: A.pts[1].z }, { x: B.pts[B.pts.length - 2].x, z: B.pts[B.pts.length - 2].z }, ['btr80', 'fuel_red', 'ammo_red', 'cmd_red']);
        assert.ok(cv, 'a convoy');
        assert.equal(cv.total, 4);
        g.run(25, 0.1);
        const s = cv.vehicles.map(v => v.route.s);
        for (let i = 1; i < s.length; i++) assert.ok(s[i - 1] - s[i] > 30, 'spacing ' + (s[i - 1] - s[i]).toFixed(0));
        assert.ok(cv.vehicles.every(v => v.route.speed > 3), 'all moving');
        // hit: off the road, both sides
        cv.vehicles[1].damage(10, null, 'gun');
        assert.equal(cv.state, 'scatter');
        g.run(40, 0.1);
        const off = cv.alive().map(v => Math.abs(v.pos.z - O.z));
        assert.ok(off.every(d => d > 30), 'off the road: ' + off.map(d => d.toFixed(0)).join(','));
        assert.ok(cv.alive().some(v => v.pos.z > O.z) && cv.alive().some(v => v.pos.z < O.z), 'to both sides');
        assert.ok(cv.vehicles[0].dismounted, 'the APC\'s troops got out (its door opened)');
        // quiet: back on the road and on
        g.run(200, 0.2, () => cv.state === 'move');
        assert.equal(cv.state, 'move', 'regrouped');
        g.run(900, 0.2, () => cv.done);
        assert.equal(cv.state, 'arrived');
        assert.ok(g.events.log.some(e => e.k === 'convoyArrived' && e.a === cv));
        assert.ok(cv.arrived >= 3, 'the others got through (the APC stayed with its troops)');
    }));
});

describe('mobile forces: sites', () => {
    const env = (team) => {
        const war = new War({ world: {}, events: { emit() {} } });
        return { heightAt: world.terrainHeight, sideAt: (x, z) => war.sideAt(x, z), forest: N.forestDensity, blocked: null, inTown: null, nearBase: (x, z, m) => world.BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r + m), net: null, bridges: [], rand: Math.random, team };
    };
    test('hide sites are where they say: forest edges, valley floors, open level firing points, SAM sites, in their own ground', () => seeded(31, () => {
        const E = env('red'), near = { x: 7000, z: -17000 };
        let nf = 0, nv = 0;
        for (let i = 0; i < 12; i++) {
            const f = N.forestSite(E, 'red', near, 1500, 16000);
            if (f) {
                nf++;
                assert.equal(E.sideAt(f.x, f.z), 'red');
                const d = N.forestDensity(f.x, f.z);
                assert.ok(d >= 0.5 && d <= 0.92, 'in the trees: ' + d.toFixed(2));
                assert.ok(N.forestDensity(f.approach.x, f.approach.z) < 0.35, 'backed in from the open side');
                assert.ok(f.conceal >= 0.8);
            }
            const v = N.valleySite(E, 'red', near, 1500, 16000);
            if (v) {
                nv++;
                const h = world.terrainHeight(v.x, v.z);
                let up = 0;
                for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (world.terrainHeight(v.x + Math.cos(a) * 550, v.z + Math.sin(a) * 550) - h > 35) up++; }
                assert.ok(up >= 5, 'hills round it on ' + up + ' sides');
            }
            const p = N.firingSite(E, 'red', near, 1500, 16000);
            if (p) {
                assert.ok(N.forestDensity(p.x, p.z) <= 0.12, 'nothing overhead');
                assert.ok(N.slopeAt(world.terrainHeight, p.x, p.z, 20) <= 0.07, 'level');
                assert.equal(E.sideAt(p.x, p.z), 'red');
            }
            const s = N.samSite(E, 'red', near, 2000, 14000, 60, [{ x: 7000, z: -17000 }]);
            if (s) { assert.ok(flat2(s, near) >= 2500, 'kept away from the old site'); assert.ok(N.forestDensity(s.x, s.z) <= 0.3); }
        }
        assert.ok(nf >= 6 && nv >= 3, `found forest edges (${nf}/12) and valleys (${nv}/12)`);
        const B = env('blue');
        const b = N.firingSite(B, 'blue', { x: 0, z: 0 }, 2000, 12000);
        assert.ok(b && B.sideAt(b.x, b.z) === 'blue', 'ours in our ground');
    }));
});

describe('mobile forces: rocket artillery', () => {
    test('a Grad battery lays its launchers before the ripple, fires 20 rockets each, then scoots', () => seeded(41, () => {
        const g = forcesGame();
        const F = g.forces;
        const site = { x: RED.x, z: RED.z, heading: 0 };
        g.camera.position.set(site.x + 400, 300, site.z + 400); // (close: real rockets)
        const bt = F.spawnArtillery('red', 'grad', site, { count: 3 });
        assert.equal(bt.launchers.length, 3);
        const target = new THREE.Vector3(site.x, 0, site.z + 14000);
        const n = bt.fireMission(target, { label: 'TEST' });
        assert.equal(n, 3);
        assert.ok(bt.launchers.every(v => v.src.queue.length === 20), 'three salvos of 20 queued');
        const start = bt.launchers.map(v => v.pos.clone());
        let laid = null;
        g.run(60, 1 / 30, () => { const m = g.strikes.missiles.find(x => x.source && bt.launchers.includes(x.source.host)); if (m && !laid) laid = bt.launchers.map(v => v.aimPitch); return false; });
        assert.ok(laid && laid.every(p => p > 0.5), 'elevated before the first rocket: ' + (laid || []).map(p => p.toFixed(2)));
        const launched = g.events.log.filter(e => e.k === 'strategicLaunch' && e.a.source && bt.launchers.includes(e.a.source.host)).length;
        assert.equal(launched, 60, 'the salvos rippled out');
        assert.ok(!g.events.log.some(e => e.k === 'strategicLaunch' && e.a.strike), 'the enemy\'s salvos carry no strike record (not a "missile launch" to hunt)');
        g.run(120, 0.1);
        assert.ok(bt.launchers.every((v, i) => v.pos.distanceTo(start[i]) > 250), 'shoot and scoot: moved on');
    }));

    test('a salvo out of everyone\'s sight flies abstractly and still hits', () => seeded(43, () => {
        const g = forcesGame();
        const F = g.forces;
        const site = { x: RED.x, z: RED.z, heading: 0 };
        g.camera.position.set(-20000, 3000, 30000); // (far from both ends)
        const bt = F.spawnArtillery('red', 'grad', site, { count: 2 });
        const victim = F.spawnVehicle('hemtt', 'blue', { x: site.x, z: site.z + 12000 });
        let impacts = 0;
        const hit = F.rocketImpact.bind(F);
        F.rocketImpact = (...a) => { impacts++; return hit(...a); };
        bt.fireMission(victim, { label: 'TEST' });
        let maxFlying = 0;
        g.run(160, 0.1, () => { maxFlying = Math.max(maxFlying, g.strikes.missiles.length); return false; });
        assert.equal(maxFlying, 0, 'no missile objects');
        assert.equal(impacts, 40, 'every rocket landed');
        assert.ok(victim.hp < victim.maxHp, 'and the target felt it');
    }));
});

describe('mobile forces: search and destroy', () => {
    test('a TEL drives in with an escort; the report narrows when the drone finds it; the countdown is the TEL\'s own', () => seeded(51, () => {
        const g = forcesGame({ mode: 'test' });
        const F = g.forces;
        F.full = true;
        const op = F.startSearch();
        assert.ok(op && op.ok, 'the operation started');
        assert.ok(op.tel.order, 'the TEL has its launch order');
        assert.ok(op.escort && op.escort.launchers[0].vid === 'osa', 'an SA-8 escort');
        assert.ok(op.rp && op.rp.radius > 5000 && g.war.reports.includes(op.rp), 'a wide search area');
        assert.ok(op.eta() > 90, 'minutes to find it: ' + op.eta().toFixed(0) + ' s');
        g.run(3000, 0.5, () => op.droneDone); // (no roads here: the drive is all across country)
        assert.ok(op.droneDone, 'the drone found a possible convoy');
        assert.equal(op.rp.radius, 1600, 'the area narrowed');
        assert.ok(flat2(op.rp.center, op.tel.v.pos) < 1200, 'round where the TEL is');
        assert.ok(g.war.known(op.tel.v) >= INTEL.CONTACT, 'a contact now');
        assert.ok(g.war.known(op.tel.v) < INTEL.IDENTIFIED, 'but not identified: the player has to look');
        op.tel.v.destroy(null);
        g.run(2, 0.25);
        assert.ok(op.done && op.why === 'killed', 'over once the TEL is dead');
    }));
});

describe('mobile forces: strikes on the move', () => {
    test('our ATACMS on a marked TEL that keeps driving follows the track and kills it; the enemy\'s missiles are not retargeted', () => seeded(71, () => {
        const g = forcesGame();
        const F = g.forces;
        const blue = F.spawnArtillery('blue', 'atacms', { x: 3000, z: -2000, heading: Math.PI });
        assert.ok(blue && blue.launchers.every(v => v.src && v.src.kind === 'launcher'), 'an ATACMS section (ballistic / hardened source)');
        // a TEL driving across country, marked by our side
        const tel = F.spawnVehicle('scud', 'red', { x: RED.x, z: RED.z });
        const r = F.plan(tel, { x: RED.x + 2500, z: RED.z + 1500 }, {});
        tel.drive(r, {});
        g.war.reveal(tel, INTEL.IDENTIFIED, 'tgp');
        const d = g.war.designate(tel, 'tgp');
        const st = g.strikes.request('ballistic', [d], 'blue', true);
        assert.ok(st && st.planned === 1, 'one ATACMS');
        g.run(40, 0.1, () => g.strikes.missiles.length > 0);
        const m = g.strikes.missiles[0];
        assert.ok(m && m.tracked, 'ours: tracked');
        const at0 = tel.pos.clone();
        g.run(300, 1 / 30, () => !tel.alive || st.impacts > 0);
        assert.ok(tel.pos.distanceTo(at0) > 150, 'it kept driving: ' + tel.pos.distanceTo(at0).toFixed(0) + ' m');
        assert.equal(tel.alive, false, 'and the strike still got it');
        // a red SCUD at a blue vehicle: where it was aimed, no datalink
        const t2 = F.spawnTEL('red', { x: RED.x - 500, z: RED.z }, { brigade: { team: 'red', hides: [], firing: [{ kind: 'firing', x: RED.x - 500, z: RED.z + 500 }], occupied: new Set(), reload: null, tels: [] } });
        const hemtt = F.spawnVehicle('hemtt', 'blue', { x: 0, z: 2000 });
        g.strikes.request('ballistic', [hemtt], 'red', true);
        g.run(400, 0.1, () => g.strikes.missiles.some(x => x.team === 'red'));
        const rm = g.strikes.missiles.find(x => x.team === 'red');
        assert.ok(rm && !rm.tracked, 'theirs: not retargeted');
        void t2;
    }));
});

// (the unit interface other systems rely on)
describe('mobile forces: unit interface', () => {
    test('a vehicle is a war unit: registered, hidden until found, damageable, a burning wreck when destroyed', () => seeded(61, () => {
        const g = forcesGame();
        const v = g.forces.spawnVehicle('scud', 'red', { x: RED.x, z: RED.z });
        assert.ok(g.war.rec(v) && g.war.rec(v).cls === 'tel');
        assert.ok(g.ground.targets.includes(v), 'weapons can hit it (ground.targets)');
        assert.equal(v.hidden, true, 'not on the HUD until found');
        assert.equal(v.name, 'UNKNOWN VEHICLE', 'our side calls it what it knows');
        g.war.reveal(v, INTEL.IDENTIFIED, 'test');
        assert.equal(v.hidden, false);
        assert.equal(v.name, 'SS-1C SCUD-B TEL');
        assert.ok(v.route && v.mesh && typeof v.damage === 'function' && v.radius > 5, 'route, mesh, damage, radius');
        v.damage(30, null, 'gun');
        assert.ok(v.alive && v.hp === v.maxHp - 30);
        v.damage(500, null, 'bomb');
        assert.equal(v.alive, false);
        assert.ok(v.burnT > 30, 'it burns');
        assert.ok(g.events.log.some(e => e.k === 'groundKilled' && e.a === v));
        assert.ok(U.UNIT.scud.carry === 'missile', 'and it went up with its missile');
    }));
});
