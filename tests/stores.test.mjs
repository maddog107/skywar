// Per-type stores (stores.js): every combat type carries its own real weapons on each loadout, and each kind of
// weapon behaves like itself in weapons.js — heat seekers and flares (IRCCM), semi-active radar missiles that need
// the launcher's radar, active ones that don't, chaff and the notch, HARMs on radars, Mavericks on the ground,
// sea-skimming Harpoons, terrain-following cruise missiles, laser and GPS bombs, cluster bombs — and the AI fires
// its own type's missiles.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { seeded, arenaGame } from './helpers/arena.mjs';
import { range, groundTarget, launcher, V, landLine, seaLine, terrainHeight } from './helpers/range.mjs';

const { AIRCRAFT, WEAPONS } = await src('config.js');
const S = await src('stores.js');
const { STORES, LOADOUTS, PRESETS, CLASSES, CLASS, ALLIES, loadoutOf, loadoutText, storeFor, armAircraft, canEngage, flareChance, chaffChance, notchChance, brevity } = S;
const { SLOTS, slotAvail, Game } = await src('game.js');
const { Pilot } = await src('ai.js');

// flat low land (the ground attacks), a long stretch over hills (terrain following), open sea
const land = landLine(13000, 150), hills = landLine(17000, 1500), sea = seaLine(30000);
const COMBAT = Object.entries(AIRCRAFT).filter(([, s]) => s.missiles > 0).map(([k]) => k);
const shorts = (type, pre) => loadoutOf(AIRCRAFT[type], pre).map(e => e.id);
const everywhere = (type) => new Set(PRESETS.flatMap(p => shorts(type, p)));

describe('stores: the catalogue and the loadouts', () => {
    test('every armed type has all three loadouts, each store real, in its own slot, with a count', () => {
        for (const type of COMBAT) {
            assert.ok(LOADOUTS[type], type + ' has loadouts');
            for (const pre of PRESETS) {
                const l = loadoutOf(AIRCRAFT[type], pre);
                assert.ok(l.length > 0, type + ' ' + pre);
                for (const e of l) {
                    assert.ok(STORES[e.id] && CLASS[e.cls], type + ' ' + pre + ' ' + e.id);
                    assert.equal(e.store.cls, e.cls);
                    assert.ok(Number.isInteger(e.n) && e.n > 0, type + ' ' + pre + ' ' + e.id + ' ×' + e.n);
                }
            }
        }
        for (const s of Object.values(STORES)) assert.ok(s.name && s.short && s.len > 0 && s.dia > 0, s.id);
    });

    test('each type carries only its own side\'s weapons (and its allies\')', () => {
        for (const type of Object.keys(LOADOUTS)) {
            const c = AIRCRAFT[type].country, ok = ALLIES[c] || [c];
            for (const id of everywhere(type)) assert.ok(ok.includes(STORES[id].from), `${type} (${c}) carries ${id} (${STORES[id].from})`);
        }
    });

    test('the real loadouts: Growler HARMs, Tomcat Phoenixes, Foxhound R-37Ms, Meteors, Harpoons, ASM-2s, Mavericks', () => {
        const has = (type, id) => everywhere(type).has(id);
        assert.ok(has('ea18g', 'agm88') && !PRESETS.some(p => loadoutOf(AIRCRAFT.ea18g, p).some(e => e.cls === 'srm')), 'Growler: HARMs, no Sidewinders');
        assert.ok(has('f14', 'aim54') && has('f14', 'aim7m') && has('f14', 'aim9m'), 'F-14: Phoenix, Sparrow, Sidewinder');
        assert.ok(has('mig31', 'r37'), 'MiG-31: R-37M');
        for (const t of ['rafale', 'typhoon', 'gripen']) assert.ok(has(t, 'meteor'), t + ': Meteor');
        assert.ok(has('fa18', 'agm84'), 'Super Hornet: Harpoon');
        assert.ok(has('f2', 'asm2'), 'F-2: ASM-2');
        assert.ok(has('a10', 'agm65') && has('a10', 'cbu87'), 'A-10: Maverick, CBU-87');
        assert.ok(has('b52', 'jassm') && has('tu95', 'kh101'), 'bombers: cruise missiles');
        assert.ok(has('mq9', 'hellfire'), 'Reaper: Hellfire');
        // the old jets: no radar missile at all
        for (const t of ['f5', 'mirage', 'mig21', 'jaguar']) assert.ok(!PRESETS.some(p => loadoutOf(AIRCRAFT[t], p).some(e => e.cls === 'lrm')), t + ': no radar missile');
        // Russian / Chinese jets fly Russian / Chinese missiles
        assert.equal(storeFor(AIRCRAFT.su35, 'srm').short, 'R-73');
        assert.equal(storeFor(AIRCRAFT.j20, 'lrm').short, 'PL-15');
        // the X-100's own: the mega bomb and the bunker busters, no one else's
        assert.equal(storeFor(AIRCRAFT.x100, 'bomb').name, 'MK-84X MEGA BOMB');
        for (const t of Object.keys(LOADOUTS)) if (t !== 'x100') assert.ok(!everywhere(t).has('gbu57x') && !everywhere(t).has('mk84x'), t);
        assert.equal(loadoutText(AIRCRAFT.f16, 'strike'), 'AIM-9X ×2 · AIM-120C ×2 · HARM ×2 · MAVERICK ×4 · GBU-12 ×4');
    });

    test('arming: each slot\'s count from the loadout; the AI goes up with its air-to-air load only', () => {
        const ac = { type: 'f16', spec: AIRCRAFT.f16 };
        armAircraft(ac, 'strike');
        assert.deepEqual([ac.missiles, ac.lrm, ac.harms, ac.agms, ac.gbus, ac.rockets, ac.bombs], [2, 2, 2, 4, 4, 0, 0]);
        assert.equal(ac.stores.agm, 'agm65');
        const ai = { type: 'su35', spec: AIRCRAFT.su35 };
        armAircraft(ai, 'air', { ai: true });
        assert.equal(ai.missiles, 4); assert.equal(ai.lrm, 4, 'at most 4 radar missiles for the AI');
        armAircraft(ai, 'strike', { ai: true });
        assert.equal(ai.harms + ai.ashms + ai.gbus, 0, 'no ground stores on an AI fighter');
        // the real Aircraft does it on its own
        const g = arenaGame();
        const mig = g.spawn('mig31', { team: 'red', pos: { x: 0, y: 5000, z: 0 } });
        assert.equal(mig.stores.xlr, 'r37'); assert.equal(mig.xlrm, 2);
    });

    test('the weapon slots: X steps through what this jet carries, nothing else', () => {
        const step = (type, pre) => {
            const p = { type, spec: AIRCRAFT[type] };
            armAircraft(p, pre);
            const fake = { player: p };
            const seen = [];
            let i = Game.prototype.nextSlot.call(fake, 0);
            for (let k = 0; k < 12; k++) { if (!seen.includes(SLOTS[i].key)) seen.push(SLOTS[i].key); i = Game.prototype.nextSlot.call(fake, i + 1); }
            return seen.join(' ');
        };
        assert.equal(step('f16', 'strike'), 'srm lrm arm agm gbu');
        assert.equal(step('ea18g', 'balanced'), 'lrm arm');
        assert.equal(step('f14', 'air'), 'srm lrm xlr');
        assert.equal(step('b52', 'strike'), 'alcm bomb');
        assert.equal(step('x100', 'strike'), 'srm lrm arm agm bomb buster');
        // a mission that hands it rockets (missions.js) adds the slot, with its side's pods
        const p = { type: 'f22', spec: AIRCRAFT.f22 };
        armAircraft(p, 'air');
        p.rockets = 76;
        assert.ok(slotAvail(p, CLASS.rkt));
        assert.equal(storeFor(p, 'rkt').short, 'HYDRA 70');
    });

    test('what each can lock: AAMs aircraft, ground weapons the ground, anti-ship missiles ships, HARMs a radar that\'s on', () => {
        const jet = { isGround: false }, tank = { isGround: true, type: 'tank', alive: true }, ship = { isGround: true, isShip: true, team: 'red', alive: true, def: { cls: 'ship' } };
        const radar = { isGround: true, type: 'radar', alive: true }, off = { isGround: true, type: 'radar', alive: true, emitting: false };
        assert.ok(canEngage('srm', jet) && !canEngage('srm', tank) && !canEngage('lrm', ship));
        assert.ok(canEngage('agm', tank) && canEngage('agm', ship) && !canEngage('agm', jet));
        assert.ok(canEngage('ashm', ship) && !canEngage('ashm', tank));
        assert.ok(canEngage('arm', radar) && canEngage('arm', ship) && !canEngage('arm', tank) && !canEngage('arm', off));
        assert.ok(canEngage('rkt', tank) && canEngage('bomb', jet), 'unguided: anything');
    });

    test('the launch calls: Fox one / two / three, Magnum, Rifle, Bruiser', () => {
        assert.equal(brevity(STORES.aim7m), 'Fox one!');
        assert.equal(brevity(STORES.r73), 'Fox two!');
        assert.equal(brevity(STORES.meteor), 'Fox three!');
        assert.equal(brevity(STORES.aim54), 'Fox three!');
        assert.equal(brevity(STORES.agm88), 'Magnum!');
        assert.equal(brevity(STORES.agm65), 'Rifle!');
        assert.equal(brevity(STORES.agm84), 'Bruiser!');
    });
});

describe('stores: seekers and countermeasures', () => {
    test('IRCCM: a flare pulls an AIM-9P off more often than an AIM-9M, and an AIM-9X or an R-73 far less', () => {
        const c = (id) => flareChance(STORES[id], 0.35);
        assert.ok(c('aim9p') > c('aim9m') && c('aim9m') > c('r73') && c('r73') > c('aim9x'), [c('aim9p'), c('aim9m'), c('r73'), c('aim9x')].join(' '));
        assert.equal(c('aim9m'), 0.35, 'the AIM-9M is the old plain heat seeker');
        assert.ok(c('aim9x') < 0.2);
    });

    test('flares in flight: a veteran pilot decoys an AIM-9X less often than an AIM-9M', () => {
        const rate = (id) => {
            let decoyed = 0;
            for (let s = 1; s <= 40; s++) seeded(s * 11, () => {
                const g = arenaGame({ difficulty: 'veteran' });
                const T = g.spawn('mig21', { team: 'red', pos: { x: 0, y: 3000, z: 20000 }, heading: 0, skill: 0.6, speedFrac: 0.6 });
                const Sh = g.spawn('f16', { team: 'blue', pos: { x: 60, y: 3050, z: 21800 }, heading: 0, isPlayer: true, speedFrac: 0.65 });
                g.player = Sh;
                let m = null;
                const emit = g.events.emit;
                g.events.emit = (n, w, d) => { if (n === 'decoyed' && d?.missile === m) decoyed++; emit(n, w, d); };
                for (let i = 0; i < 20 * 60; i++) { if (!m && i === 30) m = g.weapons.fireMissile(Sh, T, 'aam', STORES[id]); g.step(1 / 60); if (m && !g.weapons.missiles.includes(m)) break; }
            });
            return decoyed;
        };
        const m9 = rate('aim9m'), x9 = rate('aim9x');
        assert.ok(x9 < m9, `AIM-9X decoyed ${x9}/40, AIM-9M ${m9}/40`);
    });

    test('chaff barely works head-on, a lot against a target beaming the missile; old semi-actives fall for it most', () => {
        assert.ok(chaffChance(STORES.aim120c, 0.45, 0) < 0.06);
        assert.ok(chaffChance(STORES.aim120c, 0.45, 1) > 0.25);
        assert.ok(chaffChance(STORES.aim7m, 0.45, 1) > chaffChance(STORES.aim120d, 0.45, 1));
        assert.ok(chaffChance(STORES.meteor, 0.45, 1) < chaffChance(STORES.aim120c, 0.45, 1));
        // the notch: only flying across its line of sight, and only with it looking down at you
        assert.equal(notchChance(STORES.aim120c, 0.5, true), 0);
        assert.equal(notchChance(STORES.aim120c, 1, false), 0);
        assert.ok(notchChance(STORES.aim7m, 1, true) > notchChance(STORES.aim120d, 1, true));
    });

    test('a semi-active AIM-7 goes dumb when its launcher turns away; an AMRAAM fired the same way hits', () => {
        const shot = (type, turn) => {
            const g = range();
            const L = launcher(g, type, V(0, 6000, 0), V(0, 0, -1), { preset: 'air', speed: 260 });
            const T = g.spawn('mig29', { team: 'red', pos: { x: 0, y: 6000, z: -7000 }, heading: Math.PI, speedFrac: 0.6 });
            T.missiles = T.lrm = 0; T.maxHealth = T.health = 1e6;
            const m = g.weapons.fireMissile(L, T, 'lrm');
            if (turn) L.turn = () => { if (g.time > 2 && !L.turned) { L.turned = true; L.face(V(0, 0, 1)); } };
            g.run(30, () => { for (const a of g.aircraft) a.update(1 / 60); return !g.weapons.missiles.includes(m); });
            return { W: m.W, hit: T.health < 1e6, lost: m.lost };
        };
        const held = shot('f4', false), dumb = shot('f4', true), amraam = shot('f16', true);
        assert.equal(held.W.short, 'AIM-7M');
        assert.ok(held.hit, 'supported all the way: a hit');
        assert.ok(!dumb.hit && dumb.lost, 'the F-4 turned away: no support, no hit');
        assert.equal(amraam.W.short, 'AIM-120C');
        assert.ok(amraam.hit, 'fire and forget');
    });

    test('kinematics: the Meteor runs down a fleeing jet the AIM-120C can\'t; the Phoenix and the R-37M reach 16 km', () => {
        const shot = (type, kind, dist, tail) => {
            const g = range();
            const L = launcher(g, type, V(0, 6000, 0), V(0, 0, -1), { preset: 'air', speed: 260 });
            const T = g.spawn('mig29', { team: 'red', pos: { x: 0, y: 6000, z: -dist }, heading: tail ? 0 : Math.PI, speedFrac: tail ? 0.75 : 0.6 });
            T.missiles = T.lrm = 0; T.maxHealth = T.health = 1e6;
            const m = g.weapons.fireMissile(L, T, kind);
            g.run(60, () => { for (const a of g.aircraft) a.update(1 / 60); return !g.weapons.missiles.includes(m); });
            return T.health < 1e6;
        };
        assert.ok(shot('rafale', 'lrm', 9000, true), 'Meteor: tail chase at 9 km');
        assert.ok(!shot('f16', 'lrm', 9000, true), 'AIM-120C: out of energy chasing him at 9 km');
        assert.ok(shot('f14', 'xlr', 16000, false), 'Phoenix at 16 km');
        assert.ok(shot('mig31', 'xlr', 16000, false), 'R-37M at 16 km');
        assert.ok(!shot('f4', 'lrm', 16000, false), 'a Sparrow doesn\'t get there');
    });
});

describe('stores: air-to-ground', () => {
    // fire `kind` from `type` (its `preset`) `back` m short of a target on the land line, `alt` m up
    const fire = (type, preset, kind, back, alt, opts = {}) => {
        const g = range(opts.range);
        const at = opts.sea ? sea : opts.hills ? hills : land;
        const tx = at.x0 + (opts.tx ?? back + 500), tz = at.z;
        const T = groundTarget(g, tx, tz, { ship: !!opts.sea, type: opts.type || 'bunker' });
        const L = launcher(g, type, V(tx - back, Math.max(terrainHeight(tx - back, tz), 0) + alt, tz), V(1, 0, 0), { preset });
        const m = g.weapons.fireMissile(L, T, kind);
        let low = Infinity;
        g.run(opts.secs || 120, () => {
            if (m.age > 25 && Math.abs(m.pos.x - tx) > 4000) low = Math.min(low, m.pos.y - Math.max(terrainHeight(m.pos.x, m.pos.z), 0));
            if (opts.during) opts.during(g, m, T);
            return !g.weapons.missiles.includes(m);
        });
        return { T, m, low };
    };

    test('a HARM goes for a radar 12 km off and kills it; one that shuts down leaves it the last fix', () => {
        const on = fire('f16', 'strike', 'arm', 12000, 4000, { type: 'radar' });
        assert.equal(on.m.W.short, 'HARM');
        assert.ok(on.T.dmg >= STORES.agm88.damage * 0.9, 'on the radar: ' + on.T.dmg);
        // the radar goes off the air 3 s after launch: the HARM flies to where it was (and lands close)
        const offRun = fire('f16', 'strike', 'arm', 12000, 4000, { type: 'radar', during: (g, m, T) => { if (g.time > 3) T.emitting = false; } });
        assert.ok(offRun.m.memory, 'it kept the last fix');
        assert.ok(offRun.m.pos.distanceTo(offRun.T.pos) < 80, 'and came down near it: ' + Math.round(offRun.m.pos.distanceTo(offRun.T.pos)));
    });

    test('Mavericks, Hellfires, Brimstones and Kh-29s each hit a ground target from 6 km', () => {
        for (const [type, pre] of [['a10', 'strike'], ['mq9', 'strike'], ['typhoon', 'balanced'], ['su35', 'balanced']]) {
            const r = fire(type, pre, 'agm', 6000, 1500, { type: 'tank' });
            assert.ok(r.T.dmg >= r.m.W.damage, `${type} ${r.m.W.short}: ${r.T.dmg}`);
        }
    });

    test('a Harpoon skims the sea at wave height, pops up and hits the ship 20 km off; an Exocet comes in low', () => {
        assert.ok(sea, 'open sea on the map');
        let maxMid = 0;
        const hp = fire('fa18', 'balanced', 'ashm', 20000, 2500, { sea: true, secs: 150, during: (g, m) => { if (m.age > 60 && m.pos.distanceTo(g.ground.targets[0].pos) > 6000) maxMid = Math.max(maxMid, m.pos.y); } });
        assert.equal(hp.m.W.short, 'HARPOON');
        assert.ok(maxMid < 15, 'skimming at ' + maxMid.toFixed(1) + ' m');
        assert.ok(hp.T.dmg >= STORES.agm84.damage, 'on the ship: ' + hp.T.dmg);
        assert.ok(hp.m.dive, 'it popped up and dived');
        const ex = fire('rafale', 'balanced', 'ashm', 20000, 2500, { sea: true, secs: 150 });
        assert.equal(ex.m.W.short, 'EXOCET');
        assert.ok(ex.T.dmg > 0 && !ex.m.dive, 'an Exocet hits it low, no pop-up');
        // a destroyer (450 hp) takes one (naval.js: a missile ×2.5)
        assert.ok(STORES.agm84.damage * 2.5 >= 450);
    });

    test('a cruise missile follows the terrain over the hills at low level and comes down on its target 15 km off', () => {
        assert.ok(hills, 'a long stretch of land on the map');
        for (const type of ['b52', 'typhoon', 'tu95']) {
            // (the target here is in a hollow on a mountainside: within its blast is a hit)
            const r = fire(type, 'strike', 'alcm', 15000, 3000, { secs: 120, tx: 15500, hills: true });
            assert.ok(r.T.dmg >= r.m.W.damage * 0.5, `${type} ${r.m.W.short}: ${Math.round(r.T.dmg)}`);
            assert.ok(r.low > 15 && r.low < 250, `${type}: ${Math.round(r.low)} m over the ground at its lowest`);
        }
        // on open ground: right on it
        const flat = fire('rafale', 'strike', 'alcm', 12000, 3000, { secs: 120 });
        assert.equal(flat.m.W.short, 'SCALP');
        assert.ok(flat.T.dmg >= STORES.scalp.damage, 'SCALP: ' + Math.round(flat.T.dmg));
    });

    // drop `kind` from `type` `back` m short of a truck at `alt` m (moving: m/s across the run)
    const drop = (type, preset, kind, back, alt, { moving = 0, weather = null, n = 1, spacing = 0, ccip = false } = {}) => {
        const g = range({ weather });
        const tx = land.x0 + 12000, tz = land.z;
        const ts = [];
        for (let i = 0; i < n; i++) ts.push(groundTarget(g, tx + (i % 3) * spacing, tz + Math.floor(i / 3) * spacing, { type: 'truck', radius: 5, vel: moving ? V(0, 0, moving) : null }));
        const T = ts[0];
        let L = launcher(g, type, V(tx - back, Math.max(terrainHeight(tx, tz), 0) + alt, tz), V(1, 0, 0), { preset });
        if (ccip) {
            // release where the CCIP pipper is on the middle of the group (weapons.js predictBomb)
            const mid = V(tx + spacing, T.pos.y, tz + spacing * 0.5);
            for (let it = 0; it < 10; it++) { const hit = g.weapons.predictBomb(L, V(0, 0, 0), g.weapons.bombW(L, kind)); if (!hit) break; L.pos.x -= hit.x - mid.x; }
        }
        const b = g.weapons.dropBomb(L, kind, T);
        g.run(200, () => !g.weapons.bombs.includes(b) && !g.weapons.bomblets.length);
        return { b, ts, T };
    };

    test('a laser bomb steers onto a moving truck; under cloud it loses the spot and misses', () => {
        assert.equal(drop('f16', 'strike', 'gbu', 4000, 3000).T.dmg, STORES.gbu12.damage);
        assert.ok(drop('f16', 'strike', 'gbu', 4000, 3000, { moving: 12 }).T.dmg > 100, 'a truck doing 43 km/h');
        const cloud = drop('f16', 'strike', 'gbu', 4000, 3000, { weather: { irClear: () => false } });
        assert.equal(cloud.T.dmg, 0);
        assert.ok(cloud.b.spot === false);
    });

    test('a JDAM hits a fixed target in any weather — a moving one isn\'t there any more', () => {
        const fixed = drop('b2', 'strike', 'gbu', 9000, 9000, { weather: { irClear: () => false } });
        assert.equal(fixed.b.W.short, 'GBU-31');
        assert.equal(fixed.T.dmg, STORES.gbu31.damage);
        assert.equal(drop('b2', 'strike', 'gbu', 9000, 9000, { moving: 12 }).T.dmg, 0);
    });

    test('glide bombs: an LS-6 and a Hammer reach a target 20-25 km off; the release cue agrees', () => {
        for (const [type, back, alt] of [['j20', 25000, 9000], ['rafale', 20000, 8000]]) {
            const g = range();
            const tx = land.x0 + 12000, tz = land.z;
            const T = groundTarget(g, tx, tz, { type: 'truck', radius: 5 });
            const L = launcher(g, type, V(tx - back, Math.max(terrainHeight(tx, tz), 0) + alt, tz), V(1, 0, 0), { preset: 'strike' });
            const W = g.weapons.bombW(L, 'gbu');
            const cue = g.weapons.bombReach(L, W, T.pos);
            assert.ok(cue.ok, `${W.short} cue: miss ${Math.round(cue.miss)} m`);
            const b = g.weapons.dropBomb(L, 'gbu', T);
            g.run(200, () => !g.weapons.bombs.includes(b));
            assert.equal(T.dmg, W.damage, W.short);
            // and out of reach is out of reach
            L.pos.x -= 80000;
            assert.ok(!g.weapons.bombReach(L, W, T.pos).ok, W.short + ' from 100 km');
        }
    });

    test('a cluster bomb spreads its bomblets over a convoy: most of six trucks 25 m apart are hit', () => {
        const r = drop('a10', 'strike', 'bomb', 2600, 800, { n: 6, spacing: 25, ccip: true });
        assert.equal(r.b.W.short, 'CBU-87');
        const hitTrucks = r.ts.filter(t => t.dmg > 0).length;
        assert.ok(hitTrucks >= 4, `${hitTrucks} of 6 hit: ` + r.ts.map(t => Math.round(t.dmg)).join(' '));
    });
});

describe('stores: the AI', () => {
    test('a Su-35 takes the R-77 beyond visual range and the R-73 close in (off the nose for an ace); a MiG-21 has no long shot', () => {
        const g = arenaGame();
        const su = g.spawn('su35', { team: 'red', pos: { x: 0, y: 5000, z: 0 }, skill: 0.9 });
        const T = g.spawn('f16', { team: 'blue', pos: { x: 0, y: 5000, z: -6000 } });
        const P = su.pilot;
        assert.equal(P.missileShot(6000, 0.1, T).W.short, 'R-77-1');
        assert.equal(P.missileShot(2500, 0.1, T).W.short, 'R-73');
        assert.equal(P.missileShot(2500, 0.65, T)?.W.short, 'R-73', 'an ace off boresight with the R-73');
        const rookie = g.spawn('su35', { team: 'red', pos: { x: 0, y: 5000, z: 2000 }, skill: 0.35 });
        assert.equal(rookie.pilot.missileShot(2500, 0.65, T), null, 'a rookie needs the nose on him');
        const mig = g.spawn('mig21', { team: 'red', pos: { x: 0, y: 5000, z: 4000 }, skill: 0.9 });
        assert.equal(mig.pilot.missileShot(6000, 0.1, T), null);
        assert.equal(mig.pilot.missileShot(2000, 0.1, T).W.short, 'R-60M');
    });

    test('an enemy\'s missile is its type\'s (the warning names it), and the AI dispenses chaff at a radar missile too', () => {
        let dispensed = 0;
        for (let s = 1; s <= 5; s++) seeded(s * 31, () => {
            const g = arenaGame();
            const A = g.spawn('j20', { team: 'red', pos: { x: 0, y: 5000, z: 0 } });
            const B = g.spawn('mig29', { team: 'blue', pos: { x: 0, y: 5000, z: -5000 }, heading: Math.PI, skill: 0.9 });
            const m = g.weapons.fireMissile(A, B, 'lrm');
            assert.equal(m.W.short, 'PL-15');
            const f0 = B.flares;
            let chaff = 0;
            for (let i = 0; i < 60 * 12 && g.weapons.missiles.includes(m); i++) { g.step(1 / 60); chaff = Math.max(chaff, g.weapons.chaff.length); }
            if (B.flares < f0 && chaff > 0) dispensed++;
        });
        // (an ace notices a launch nine times in ten: ai.js)
        assert.ok(dispensed >= 3, `chaff in ${dispensed} of 5`);
    });
});
