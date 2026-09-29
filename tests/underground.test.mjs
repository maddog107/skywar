import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { noop } from './helpers/arena.mjs';

// The underground complexes (ugsites.js, underground.js) headless: the ground they carve (continuous, local, the
// airfields, towns and roads untouched, rock over every tunnel), what the intelligence picture does with the clues,
// the blast doors, the scramble out of the mountain and the TEL's shoot and scoot, and what it takes to close them.
// (top-level await, not a root before() hook: see tests/README.md)
const THREE = await import('three');
const S = await src('ugsites.js');
const world = await src('world.js');
const W = await src('war.js');
const UG = await src('underground.js');
const ST = await src('strikes.js');
const D = await src('director.js');
const config = await src('config.js');
const { Towns } = await src('towns.js');

const H = world.terrainHeight;

// ═════════════ a stub game: a real War, a working event bus, ground targets, a strikes stand-in ═════════════
function ugGame() {
    const handlers = {};
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 60000, 250000); // far from everything
    const g = {
        time: 0, state: 'playing', mode: 'war', callsign: 'TEST', score: 0,
        difficulty: config.DIFFICULTY.veteran, settings: {},
        camera: cam, scene: new THREE.Scene(),
        world: { weather: 'clear', timeKey: 'day', towns: null, tiles: new Map(), TILE: 2048, drawnSample(x, z, o) { o.h = H(x, z); o.nx = 0; o.ny = 1; o.nz = 0; return o; } },
        events: { on(k, fn) { (handlers[k] = handlers[k] || []).push(fn); }, emit(k, a, b) { (handlers[k] || []).forEach(fn => fn(a, b || {})); } },
        audio: { say() {}, tick() {}, boom() {}, uiConfirm() {}, hydraulic() {} },
        feed: [], addFeed(t) { this.feed.push(t); },
        aircraft: [], naval: { ships: [] }, player: null, pilotMode: null, navTarget: null, lockTarget: null,
        effects: noop(), weapons: noop(), systems: [], isNeutral: () => false,
    };
    g.ground = {
        targets: [],
        addTarget(type, x, z, rot, team) {
            const mesh = new THREE.Group();
            mesh.position.set(x, H(x, z), z); mesh.rotation.y = rot;
            const u = {
                type, team, alive: true, isGround: true, radius: 7, hp: 90, maxHp: 90, health: 90, maxHealth: 90, def: { score: 100, name: type }, name: type.toUpperCase(),
                pos: new THREE.Vector3(x, H(x, z) + 3, z), vel: new THREE.Vector3(), mesh,
                damage(a, source) { if (!this.alive) return; this.hp -= a; if (this.hp <= 0) { this.alive = false; g.events.emit('groundKilled', this, { source }); } },
                remove() {},
            };
            this.targets.push(u);
            return u;
        },
    };
    // strikes: sources, and a request that fires from them (the real thing's source choice is tested elsewhere)
    g.strikes = {
        game: g, enabled: true, sources: [], nextSourceId: 1, launched: [], silo: { name: 'ROCKY FIELD MISSILE SITE', stock: { penetrator: 4 } },
        addSource(s) { this.sources.push(s); return s; }, update(dt) { for (const s of this.sources) s.update(dt); },
        removeSource(s) { const i = this.sources.indexOf(s); if (i >= 0) this.sources.splice(i, 1); },
        spawnMissile(spec, team, pos, dir, aim, source) { const m = { spec, team, pos: pos.clone(), aim, source }; this.launched.push(m); g.events.emit('strategicLaunch', m); return m; },
        audioLaunch() {},
        request(type, marks, team, quiet, opts = {}) {
            const T = ST.STRIKE_TYPES[type], key = T.use[team];
            const cand = this.sources.filter(s => (!opts.only || opts.only.includes(s)) && s.team === team && s.canFire(key));
            if (!cand.length) return null;
            const d = marks[0], aim = { pos: d.unit ? d.unit.pos : d.fixed || d.pos, unit: d.unit || null, label: d.label || 'X' };
            cand[0].fire(key, 1, aim, null);
            return { sources: new Set([cand[0]]) };
        },
    };
    g.war = new W.War(g);
    g.war.start('war');
    g.director = new D.Director(g);
    g.underground = new UG.Underground(g);
    g.systems = [g.underground, g.strikes];
    g.underground.start('war');
    g.underground.launchT = g.underground.reportT = 1e9; // (no launches or reports of its own in the tests)
    return g;
}

const step = (g, secs, dt = 0.1, until = null) => {
    for (let t = 0; t < secs; t += dt) {
        g.time += dt; g.war.time += dt;
        for (const s of g.systems) if (s.update) s.update(dt);
        if (until && until()) return t;
    }
    return secs;
};

// ═════════════ The ground works ═════════════
describe('underground: the ground works', () => {
    test('the carve is local: away from the complexes the height function is the natural one, to the bit', () => {
        const boxes = S.carveBounds();
        let checked = 0;
        for (let x = -60000; x <= 70000; x += 997) for (let z = -80000; z <= 20000; z += 1009) {
            if (boxes.some(b => x > b.bb[0] - 1 && x < b.bb[2] + 1 && z > b.bb[1] - 1 && z < b.bb[3] + 1)) continue;
            S.setCarve(false); const h0 = H(x, z); S.setCarve(true);
            assert.equal(H(x, z), h0, `changed at ${x},${z}`);
            checked++;
        }
        assert.ok(checked > 10000, checked + ' points');
    });

    test('continuous: every apparent step in and around the complexes vanishes when looked at closer', () => {
        // march lines across each complex at 1 m; bisect every steep interval: a continuous function's difference goes
        // to nothing, a jump would stay
        let steep = 0, worst = 0;
        for (const b of S.carveBounds()) {
            const [x0, z0, x1, z1] = b.bb;
            const line = (ax, az, bx, bz) => {
                const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L);
                let px = ax, pz = az, ph = H(px, pz);
                for (let i = 1; i <= n; i++) {
                    const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n, h = H(x, z);
                    if (Math.abs(h - ph) > 2.5) {
                        steep++;
                        let lx = px, lz = pz, lh = ph, rx = x, rz = z, rh = h;
                        for (let k = 0; k < 24; k++) {
                            const mx = (lx + rx) / 2, mz = (lz + rz) / 2, mh = H(mx, mz);
                            if (Math.abs(mh - lh) > Math.abs(rh - mh)) { rx = mx; rz = mz; rh = mh; } else { lx = mx; lz = mz; lh = mh; }
                        }
                        worst = Math.max(worst, Math.abs(rh - lh));
                    }
                    px = x; pz = z; ph = h;
                }
            };
            for (let x = x0; x <= x1; x += 53) line(x, z0, x, z1);
            for (let z = z0; z <= z1; z += 53) line(x0, z, x1, z);
        }
        assert.ok(steep > 20, steep + ' steep places found (the cuttings and walls are there)');
        assert.ok(worst < 0.02, 'no jump: the largest step left after bisection is ' + worst.toFixed(4) + ' m');
    });

    test('airfields untouched: every base is flattened as before and far from every complex', () => {
        for (const b of world.BASES) {
            for (const c of S.carveBounds()) {
                const dx = Math.max(c.bb[0] - b.x, 0, b.x - c.bb[2]), dz = Math.max(c.bb[1] - b.z, 0, b.z - c.bb[3]);
                assert.ok(Math.hypot(dx, dz) > b.r * 2 + 5000, `${c.id} is ${Math.round(Math.hypot(dx, dz))} m from ${b.id}`);
            }
            for (let a = 0; a < 12; a++) for (const r of [0, b.r * 0.5, b.r * 1.5]) {
                const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
                S.setCarve(false); const h0 = H(x, z); S.setCarve(true);
                assert.equal(H(x, z), h0);
            }
            assert.ok(Math.abs(H(b.x, b.z) - b.h) < 1e-9, b.id + ' still at its height');
        }
    });

    test('towns and roads untouched: the seeded network is the same with and without the complexes', () => {
        const build = () => new Towns(new THREE.Scene(), { scene: new THREE.Scene(), refreshTrees() {}, setGroundConform() {} });
        S.setCarve(false);
        const a = build();
        S.setCarve(true);
        const b = build();
        assert.equal(b.towns.length, a.towns.length, 'the same towns');
        a.towns.forEach((t, i) => { assert.equal(b.towns[i].x, t.x); assert.equal(b.towns[i].z, t.z); });
        assert.equal(b.paths.length, a.paths.length, 'the same roads');
        a.paths.forEach((p, i) => {
            assert.equal(b.paths[i].pts.length, p.pts.length, 'road ' + i);
            p.pts.forEach((q, k) => { assert.equal(b.paths[i].pts[k].x, q.x); assert.equal(b.paths[i].pts[k].y, q.y); assert.equal(b.paths[i].pts[k].z, q.z); });
        });
        // and nothing of ours near them
        for (const t of b.towns) for (const c of S.carveBounds()) assert.ok(t.x < c.bb[0] - 2000 || t.x > c.bb[2] + 2000 || t.z < c.bb[1] - 2000 || t.z > c.bb[3] + 2000, 'a town near ' + c.id);
    });

    test('portal cuttings, aprons and the runway: flat where aircraft and TELs roll', () => {
        for (const site of S.UG_SITES) {
            for (const p of site.portals) {
                const F = S.portalFrame(site, p);
                // the floor from the facade out through the cutting
                for (const v of [0.5, 10, p.notch * 0.5]) for (const u of [-p.open[0] / 2, 0, p.open[0] / 2]) {
                    const h = H(F.x + F.ux * u + F.vx * v, F.z + F.uz * u + F.vz * v);
                    assert.ok(Math.abs(h - p.floor) < 0.05, `${p.id}: floor ${h.toFixed(2)} at u ${u} v ${v}`);
                }
                // the headwall: the ground rises over the facade
                const back = H(F.x - F.vx * (p.face[2] + 4), F.z - F.vz * (p.face[2] + 4));
                assert.ok(back > p.floor + p.face[1] - 3, `${p.id}: ground over the facade ${back.toFixed(1)}`);
            }
            if (site.runway) {
                const r = site.runway;
                for (let t = -r.len / 2; t <= r.len / 2; t += 50) for (const w of [-r.w / 2, 0, r.w / 2]) {
                    const q = S.siteToWorld(site, r.u + t, r.v + w);
                    assert.ok(Math.abs(H(q.x, q.z) - r.y) < 0.05, `runway at ${t}: ${H(q.x, q.z).toFixed(2)}`);
                }
            }
        }
    });

    test('the tunnels are inside the mountain: at least 15 m of rock over every bore beyond its portals', () => {
        for (const T of S.tubeList()) {
            const L = T.samples[T.samples.length - 1].s;
            for (const q of T.samples) {
                if (q.s < 25 || (T.tube.ends[1] && q.s > L - 25)) continue;
                const cover = H(q.x, q.z) - (q.y + q.h);
                assert.ok(cover > 15, `${T.site.id}/${T.tube.id} at ${q.s.toFixed(0)} m: ${cover.toFixed(1)} m of rock`);
            }
        }
    });

    test('inside a tunnel: its floor under the arch, nothing in the rock beside it or above it', () => {
        const T = S.tubeList().find(t => t.tube.id === 'hangar'), q = T.samples[Math.floor(T.samples.length / 2)];
        const r = S.ugTunnelAt(q.x, q.z, q.y + 2);
        assert.ok(r && Math.abs(r.floor - q.y) < 1e-9, 'the floor');
        assert.ok(r.ceil > q.y + q.h - 0.5, 'the crown overhead');
        const side = (d) => S.ugTunnelAt(q.x - q.tz * d, q.z + q.tx * d, q.y + 2);
        assert.ok(side(q.w / 2 - 1), 'near the wall: still inside');
        assert.equal(side(q.w / 2 + 2), null, 'in the rock beside it');
        assert.equal(S.ugTunnelAt(q.x, q.z, q.y + q.h + 3), null, 'in the rock above it');
        assert.equal(S.ugTunnelAt(q.x, q.z, 5000), null, 'on the mountain');
    });
});

// ═════════════ Intelligence ═════════════
describe('underground: intelligence', () => {
    const missile = (g) => g.underground.complexes.find(c => c.kind === 'missile');
    const clue = (c, kind, i = 0) => c.clues.filter(u => u.kind === kind)[i];

    test('the complexes start unknown; an airfield in the mountains is on pre-war imagery', () => {
        const g = ugGame(), war = g.war;
        for (const c of g.underground.complexes) {
            assert.equal(war.known(c.facility), W.INTEL.UNKNOWN);
            for (const e of c.entrances) assert.equal(war.known(e), W.INTEL.UNKNOWN);
            if (c.airfield) assert.equal(war.known(c.airfield), W.INTEL.IDENTIFIED);
        }
    });

    test('clues build it up: UNKNOWN FACILITY → POSSIBLE MISSILE STORAGE → CONFIRMED UNDERGROUND MISSILE FACILITY, TARGET IDENTIFIED', () => {
        const g = ugGame(), war = g.war, c = missile(g), f = c.facility;
        const said = () => war.radioLog.map(m => m.text).join('\n');
        war.reveal(clue(c, 'tracks'), W.INTEL.CONTACT, 'visual');
        assert.equal(war.known(f), W.INTEL.CONTACT, 'tracks into the hillside: a contact');
        assert.equal(war.label(f), 'UNKNOWN FACILITY');
        war.reveal(clue(c, 'guard'), W.INTEL.CONTACT, 'visual');
        war.reveal(clue(c, 'power'), W.INTEL.CONTACT, 'visual');
        assert.equal(war.label(f), 'POSSIBLE MISSILE STORAGE', 'a guard post on a road to nowhere and a power line into the mountain');
        // a vent is only a clue once its heat is seen (the pod's identification)
        war.reveal(clue(c, 'vent'), W.INTEL.CONTACT, 'visual');
        assert.equal(c.score, 3);
        war.reveal(clue(c, 'vent'), W.INTEL.IDENTIFIED, 'tgp');
        assert.equal(c.score, 4.5);
        assert.equal(war.known(f), W.INTEL.CONTACT);
        war.reveal(clue(c, 'substation'), W.INTEL.CONTACT, 'visual');
        war.reveal(clue(c, 'mast'), W.INTEL.CONTACT, 'visual');
        assert.equal(war.known(f), W.INTEL.IDENTIFIED);
        assert.equal(war.label(f), 'CONFIRMED UNDERGROUND MISSILE FACILITY');
        assert.equal(g.underground.callout.title, 'TARGET IDENTIFIED');
        assert.match(said(), /TARGET IDENTIFIED — CONFIRMED UNDERGROUND MISSILE FACILITY/);
        // command releases penetrators for it
        assert.ok(g.strikes.silo.stock.penetrator > 4);
    });

    test('a door seen opening gives it away at once', () => {
        const g = ugGame(), war = g.war, c = missile(g);
        const e = c.entrance('E1');
        war.reveal(e, W.INTEL.CONTACT, 'visual');   // (spotted in the hillside: the war's own sensors do this)
        assert.equal(c.stage, 1);
        c.openDoor('E1', 'test');
        step(g, 1);
        assert.equal(c.stage, 3, 'confirmed');
        assert.equal(war.known(c.facility), W.INTEL.IDENTIFIED);
    });

    test('an intel report puts a search area on the map; it resolves when the facility is identified', () => {
        const g = ugGame(), war = g.war, c = missile(g);
        const rp = c.report('HEAVY VEHICLE ACTIVITY REPORTED', 3500);
        assert.ok(rp && war.reports.includes(rp) && rp.unit === c.facility);
        assert.match(rp.text, /HEAVY VEHICLE ACTIVITY REPORTED (IN THE HILLS \d+ KM|NEAR GRID)/);
        assert.ok(rp.center.distanceTo(new THREE.Vector3(c.center.x, 0, c.center.z)) < rp.radius, 'the facility is inside the search area');
        war.reveal(c.entrance('E2'), W.INTEL.IDENTIFIED, 'tgp');
        assert.ok(rp.resolved, 'resolved');
    });
});

// ═════════════ Doors, scrambles, TELs ═════════════
describe('underground: doors, scrambles and TELs', () => {
    test('a blast door opens for whoever needs it, stays open while they do, and closes after', () => {
        const g = ugGame(), c = g.underground.complexes.find(x => x.kind === 'missile'), d = c.door('E1');
        c.openDoor('E1', 'a'); c.openDoor('E1', 'b');
        step(g, 16);
        assert.equal(d.k, 1, 'open after 14 s');
        c.releaseDoor('E1', 'a');
        step(g, 20);
        assert.equal(d.k, 1, 'still open: someone still needs it');
        c.releaseDoor('E1', 'b');
        step(g, 5);
        assert.equal(d.k, 1, 'held a few seconds');
        step(g, 20);
        assert.equal(d.k, 0, 'shut');
    });

    test('scramble: fighters taxi out through the blast door to the runway, take off as a director flight; the door closes', () => {
        const g = ugGame(), ug = g.underground, c = ug.complexes.find(x => x.kind === 'air');
        const target = new THREE.Vector3(30000, 3000, -20000);
        assert.ok(ug.scrambleOrigin(target), 'it can scramble');
        const n0 = c.parked.length;
        const s = ug.scramble(['mig29', 'mig29'], target);
        assert.ok(s, 'a sortie');
        assert.equal(c.parked.length, n0 - 2, 'two jets out of the hangar');
        const d = c.door(s.portal);
        const jets = s.jets, t0 = jets.map(j => j.pos.clone());
        let opened = -1, outside = -1, flew = -1;
        step(g, 600, 0.1, () => {
            if (opened < 0 && d.k >= 1) opened = g.time;
            if (outside < 0 && jets.every(j => !S.ugTunnelAt(j.pos.x, j.pos.z, j.pos.y + 2))) outside = g.time;
            if (flew < 0 && s.flight) flew = g.time;
            return s.done && d.k === 0;
        });
        assert.ok(opened > 0 && outside > opened, `the door opened (${opened.toFixed(0)} s) before they came out (${outside.toFixed(0)} s)`);
        assert.ok(flew > outside, 'airborne after that (' + flew.toFixed(0) + ' s)');
        assert.ok(s.flight && g.director.flights.includes(s.flight), 'a director flight');
        assert.equal(s.flight.team, 'red'); assert.equal(s.flight.role, 'intercept'); assert.equal(s.flight.ugHome, c);
        assert.equal(d.k, 0, 'the door shut behind them');
        assert.ok(jets.every((j, i) => j.pos.distanceTo(t0[i]) > 1000), 'they left');
        assert.ok(!g.ground.targets.some(t => jets.some(j => j.unit === t)), 'the taxiing jets were handed over');
    });

    test('the director scrambles from it when it is the nearest red base, and stops when it is sealed', () => {
        const g = ugGame(), ug = g.underground, c = ug.complexes.find(x => x.kind === 'air');
        const near = new THREE.Vector3(c.airfield.pos.x + 8000, 3000, c.airfield.pos.z + 3000);
        const o = ug.scrambleOrigin(near);
        assert.ok(o && o.distanceTo(near) < g.director.redOrigin(near).distanceTo(near), 'nearer than the enemy airbase');
        for (const e of c.entrances) ug.impact({ spec: ST.MISSILES.penetrator }, e.pos.clone());
        assert.ok(c.sealed);
        assert.equal(ug.scrambleOrigin(near), null, 'no more scrambles');
        assert.equal(ug.scramble(['mig29'], near), null);
    });

    test('TEL: out of the garage, sets up on a pad, fires through strikes, drives back in by the other portal', () => {
        const g = ugGame(), ug = g.underground, c = ug.complexes.find(x => x.kind === 'missile');
        assert.equal(c.tels.length, 3);
        assert.ok(g.strikes.sources.filter(s => s.team === 'red' && s.kind === 'launcher').length >= 3, 'red launcher sources');
        const home = new THREE.Vector3(0, 22, 0);
        const r = g.strikes.request('ballistic', [{ id: 0, pos: home, fixed: home, label: 'HOME' }], 'red', true, { only: c.launchers });
        assert.ok(r, 'a launch order');
        const tel = c.tels.find(t => t.src.queue.length);
        const states = [];
        let firedAt = -1;
        step(g, 900, 0.1, () => {
            if (states[states.length - 1] !== tel.state) states.push(tel.state);
            if (firedAt < 0 && g.strikes.launched.length) firedAt = g.time;
            return tel.state === 'bay' && states.length > 3;
        });
        assert.deepEqual(states.filter((s, i) => states.indexOf(s) === i).slice(0, 6), ['out', 'setup', 'ready', 'stow', 'back', 'bay']);
        assert.equal(g.strikes.launched.length, 1, 'one missile');
        assert.equal(g.strikes.launched[0].spec.short, 'SCUD');
        assert.ok(!S.ugTunnelAt(g.strikes.launched[0].pos.x, g.strikes.launched[0].pos.z, g.strikes.launched[0].pos.y), 'fired outside');
        assert.ok(tel.fired);
        assert.ok(S.ugTunnelAt(tel.pos.x, tel.pos.z, tel.pos.y + 2), 'back inside');
        assert.notEqual(tel.exit, 'E1', 'in by the other portal (the garage is a drive-through loop)');
        step(g, 40);
        for (const d of c.doors) assert.equal(d.k, 0, d.p.id + ' shut again');
    });
});

// ═════════════ Striking it ═════════════
describe('underground: only penetrators close it', () => {
    const air = (g) => g.underground.complexes.find(x => x.kind === 'air');

    test('an ordinary warhead scars the facade; a penetrator brings the portal down', () => {
        const g = ugGame(), ug = g.underground, c = air(g), e = c.entrances[0];
        e.damage(2000, null, 'strike');          // what strikes.js does to units near any impact
        ug.impact({ spec: ST.MISSILES.tlam }, e.pos.clone());
        ug.impact({ spec: ST.MISSILES.scud }, e.pos.clone());
        assert.ok(e.alive, 'a cruise missile only scars it');
        assert.ok(e.scarred > 0);
        assert.equal(e.bdaResult(), 'ENTRANCE HIT — FACADE SCARRED, DOOR INTACT (PENETRATOR REQUIRED)');
        ug.impact({ spec: ST.MISSILES.penetrator }, e.pos.clone());
        assert.equal(e.alive, false, 'a penetrator doesn\'t');
        assert.equal(e.bdaResult(), 'ENTRANCE 1 OF 3 DESTROYED');
    });

    test('bombs: a fighter\'s bomb scars it — unless it goes in through the open door; a heavy bomber\'s is a penetrator', () => {
        const g = ugGame(), ug = g.underground, c = air(g);
        const fighter = { spec: config.AIRCRAFT.f16, team: 'blue' }, bomber = { spec: config.AIRCRAFT.b2, team: 'blue' };
        const [e1, e2, e3] = c.entrances;
        ug.blast(e1.pos.clone(), { owner: fighter, kind: 'bomb', amount: 880, r: 55 });
        assert.ok(e1.alive, 'on the facade: a scar');
        // through the open door
        c.openDoor(e1.portal.id, 'x'); step(g, 30);
        const F = e1.F, inDoor = new THREE.Vector3(F.x - F.vx * 3, e1.portal.floor + 2, F.z - F.vz * 3);
        ug.blast(inDoor, { owner: fighter, kind: 'bomb', amount: 880, r: 55 });
        assert.equal(e1.alive, false, 'through the door');
        ug.blast(e2.pos.clone(), { owner: bomber, kind: 'bomb', amount: 880, r: 55 });
        assert.equal(e2.alive, false, 'a B-2\'s bomb');
        ug.blast(e3.pos.clone(), { owner: fighter, kind: 'blast', amount: 3000, r: 30 });
        assert.ok(e3.alive, 'a missile or rocket: a scar');
    });

    test('every entrance down seals it: the TELs inside are trapped and it launches nothing more', () => {
        const g = ugGame(), ug = g.underground, c = g.underground.complexes.find(x => x.kind === 'missile');
        const said = () => g.war.radioLog.map(m => m.text).join('\n');
        ug.impact({ spec: ST.MISSILES.penetrator }, c.entrances[0].pos.clone());
        assert.match(said(), /ENTRANCE 1 OF 3 DESTROYED/);
        assert.equal(c.bdaFor(c.facility), '1 OF 3 ENTRANCES DESTROYED — STILL OPERATIONAL');
        ug.impact({ spec: ST.MISSILES.penetrator }, c.entrances[1].pos.clone());
        ug.impact({ spec: ST.MISSILES.penetrator }, c.entrances[2].pos.clone());
        assert.ok(c.sealed, 'sealed');
        assert.equal(c.facility.alive, false);
        assert.match(said(), /IS SEALED\. 3 LAUNCHERS TRAPPED INSIDE/);
        assert.equal(c.bdaFor(c.entrances[2]), 'ENTRANCE 3 OF 3 DESTROYED — COMPLEX SEALED');
        assert.ok(c.launchers.every(s => !s.alive && !s.canFire('scud')), 'no launcher can fire');
        assert.equal(ug.missileSortie(), null, 'no more launches');
        const home = new THREE.Vector3(0, 22, 0);
        assert.equal(g.strikes.request('ballistic', [{ id: 0, pos: home, fixed: home }], 'red', true, { only: c.launchers }), null);
    });

    test('a TEL whose way out is destroyed while it waits inside is shut in', () => {
        const g = ugGame(), ug = g.underground, c = g.underground.complexes.find(x => x.kind === 'missile');
        const home = new THREE.Vector3(0, 22, 0);
        g.strikes.request('ballistic', [{ id: 0, pos: home, fixed: home }], 'red', true, { only: c.launchers });
        const tel = c.tels.find(t => t.src.queue.length);
        step(g, 3);
        assert.equal(tel.state, 'out');
        // both vehicle portals come down before it reaches them
        for (const e of c.entrances.filter(x => x.portal.kind === 'tel')) ug.impact({ spec: ST.MISSILES.penetrator }, e.pos.clone());
        step(g, 120);
        assert.ok(tel.trapped && tel.inside, 'trapped inside');
        assert.equal(g.strikes.launched.length, 0, 'it never fired');
    });
});
