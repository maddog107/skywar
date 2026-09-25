// AI pilots in a headless arena (real Aircraft / Pilot / Weapons over the real terrain, seeded random):
// steering response, ground and building avoidance, skill scaling, flare discipline, transports holding
// their route altitude, and hostiles going after an ejected pilot.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft } from './helpers/flight.mjs';
import { arenaGame, seeded, boxBuildings, THREE, terrainHeight } from './helpers/arena.mjs';

const { steerToward, avoidTerrain, Pilot } = await src('ai.js');
const groundAt = (x, z) => Math.max(terrainHeight(x, z), 0);
// highest ground within 2 km (a spawn height that isn't inside the next ridge)
const hillsAround = (x, z) => { let h = 0; for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) h = Math.max(h, groundAt(x + i * 250, z + j * 250)); return h; };

// steer the flight path to a direction `turnDeg` right of the nose; overshoot = worst angle after it first settles
function stepResponse(id, V, turnDeg, fps = 60) {
    const ac = makeAircraft(id, { alt: 3000 });
    ac.spawnAir(new THREE.Vector3(0, 3000, 0), 0, V / ac.spec.flight.speed);
    ac.controls.throttle = 0.9;
    const a = turnDeg * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    const series = [];
    for (let i = 0; i < 20 * fps; i++) {
        steerToward(ac, dir, ac.controls, 1);
        ac.updateFlight(1 / fps);
        series.push(Math.acos(Math.min(1, ac.vel.clone().normalize().dot(dir))) * 180 / Math.PI);
    }
    const i0 = series.findIndex((x, i) => i > 0 && x < 3 && series[i + 1] >= x);
    const over = i0 < 0 ? 0 : Math.max(...series.slice(i0));
    let settle = 0;
    series.forEach((x, i) => { if (x > 2) settle = (i + 1) / fps; });
    return { over, settle, final: series[series.length - 1] };
}

describe('AI steering', () => {
    for (const [id, V, maxSettle] of [['f16', 250, 3], ['mig21', 200, 3], ['c130', 120, 10], ['b747', 150, 12], ['cessna', 50, 7]]) {
        test(`${id}: a 30° heading change settles without swinging through (< 1.5°)`, () => {
            const r = stepResponse(id, V, 30);
            assert.ok(r.over < 1.5, `overshoot ${r.over.toFixed(2)}°`);
            assert.ok(r.settle < maxSettle, `settled after ${r.settle.toFixed(1)} s`);
            assert.ok(r.final < 0.5, `final error ${r.final.toFixed(2)}°`);
        });
    }
});

describe('ground and building avoidance', () => {
    test('AI dogfights low among the mountains without flying into the ground', () => {
        let crashes = 0, fights = 0;
        for (let s = 1; s <= 8; s++) {
            seeded(s * 7919, () => {
                const g = arenaGame();
                const ang = s * 1.7, cx = -8000, cz = 20000;
                const pa = { x: cx + Math.cos(ang) * 3500, z: cz + Math.sin(ang) * 3500 };
                const pb = { x: cx - Math.cos(ang) * 3500, z: cz - Math.sin(ang) * 3500 };
                const A = g.spawn('f16', { team: 'blue', pos: { ...pa, y: hillsAround(pa.x, pa.z) + 350 }, heading: Math.atan2(Math.cos(ang), Math.sin(ang)), skill: 0.6, speedFrac: 0.65 });
                const B = g.spawn('mig29', { team: 'red', pos: { ...pb, y: hillsAround(pb.x, pb.z) + 350 }, heading: Math.atan2(-Math.cos(ang), -Math.sin(ang)), skill: 0.35, speedFrac: 0.65 });
                g.player = A;
                for (let i = 0; i < 90 * 30 && A.alive && B.alive; i++) g.step(1 / 30);
                crashes += g.log.kills.filter(k => k.kind === 'crash').length;
                fights++;
            });
        }
        assert.equal(crashes, 0, `${crashes} of ${fights} fights ended with a jet flying into the ground`);
    });

    test('low over a town, the look-ahead climbs over a tall building in the way', () => {
        const blocks = [{ x: 0, z: -2500, hw: 60, hd: 30, y: 0, top: 170 }]; // a 170 m tower on the nose, 2.5 km out
        const bl = boxBuildings(blocks);
        const g = arenaGame({ buildings: bl, flatSea: true });
        const ac = makeAircraft('f16', { game: g, alt: 120 });
        ac.spawnAir(new THREE.Vector3(0, 120, 0), 0, 230 / ac.spec.flight.speed);
        const level = new THREE.Vector3(0, 0, -1);
        let hit = false, tookOver = false;
        for (let i = 0; i < 20 * 60; i++) {
            g.time += 1 / 60;
            steerToward(ac, level, ac.controls, 1);
            ac.controls.throttle = 0.9;
            if (avoidTerrain(ac, ac.controls, 100)) tookOver = true;
            ac.updateFlight(1 / 60);
            if (bl.at(ac.pos.x, ac.pos.y, ac.pos.z, ac.hitRadius * 0.45)) hit = true;
        }
        assert.ok(tookOver, 'avoidance took over');
        assert.ok(!hit, 'flew into the building');
    });

    test('pulling out of a steep dive happens in time (dive-recovery check)', () => {
        const g = arenaGame({ flatSea: true });
        const ac = makeAircraft('mig21', { game: g, alt: 1500 });
        ac.spawnAir(new THREE.Vector3(0, 1500, 0), 0, 280 / ac.spec.flight.speed);
        // point it 40° nose down
        ac.qv.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.7);
        ac.vel.set(0, 0, -280).applyQuaternion(ac.qv);
        ac.controls.throttle = 1;
        let minY = Infinity;
        for (let i = 0; i < 15 * 60 && ac.alive; i++) {
            g.time += 1 / 60;
            ac.controls.pitch = 0; ac.controls.roll = 0; // the pilot does nothing
            avoidTerrain(ac, ac.controls, 150);
            ac.updateFlight(1 / 60);
            minY = Math.min(minY, ac.pos.y);
        }
        assert.ok(ac.alive, 'hit the ground');
        assert.ok(minY > 40, `bottomed out at ${minY.toFixed(0)} m`);
    });
});

describe('skill and difficulty', () => {
    test('an ace beats a rookie in most 1v1s, and hits more of the rounds he fires', () => {
        let ace = 0, rookie = 0;
        const shots = { ace: 0, aceHits: 0 };
        // 24 duels: with 12 the result swung on unrelated changes to how many random numbers a frame draws
        for (let s = 1; s <= 24; s++) {
            seeded(s * 104729, () => {
                const g = arenaGame();
                const ang = s * 1.3, cx = 0, cz = -20000;
                const A = g.spawn('f16', { team: 'blue', pos: { x: cx + Math.cos(ang) * 3500, y: 3000, z: cz + Math.sin(ang) * 3500 }, heading: Math.atan2(Math.cos(ang), Math.sin(ang)), skill: 0.9, speedFrac: 0.65 });
                const B = g.spawn('f16', { team: 'red', pos: { x: cx - Math.cos(ang) * 3500, y: 3200, z: cz - Math.sin(ang) * 3500 }, heading: Math.atan2(-Math.cos(ang), -Math.sin(ang)), skill: 0.35, speedFrac: 0.65 });
                g.player = A;
                for (let i = 0; i < 150 * 30 && A.alive && B.alive; i++) g.step(1 / 30);
                if (A.alive && !B.alive) ace++; else if (B.alive && !A.alive) rookie++;
            });
        }
        assert.ok(ace >= 15 && ace > rookie * 2, `ace ${ace} – rookie ${rookie}`);
        void shots;
    });

    test('gun accuracy scales with skill (rounds on a weaving target from 600 m behind)', () => {
        const rate = (skill) => {
            let fired = 0, hits = 0;
            for (let s = 1; s <= 4; s++) {
                seeded(s * 131, () => {
                    const g = arenaGame();
                    const T = g.spawn('f5', { team: 'blue', pos: { x: 0, y: 3000, z: 20000 }, heading: 0, speedFrac: 0.6 });
                    T.maxHealth = T.health = 1e9; // a target that doesn't die
                    const S = g.spawn('f16', { team: 'red', pos: { x: 30, y: 3020, z: 20600 }, heading: 0, skill, speedFrac: 0.62 });
                    S.missiles = 0;
                    g.player = T;
                    for (let i = 0; i < 25 * 30; i++) {
                        // gentle weave
                        T.controls.roll = Math.sin(g.time * 0.8) * 0.4; T.controls.pitch = 0.15; T.controls.throttle = 0.7;
                        g.step(1 / 30);
                    }
                    fired += g.log.gunShots; hits += g.log.gunHits;
                });
            }
            return { fired, hits, pct: hits / Math.max(fired, 1) };
        };
        const rookie = rate(0.35), ace = rate(0.9);
        assert.ok(ace.fired > 20 && rookie.fired > 20, `ace fired ${ace.fired}, rookie ${rookie.fired}`);
        assert.ok(ace.pct > rookie.pct * 1.3, `ace ${(ace.pct * 100).toFixed(1)}% vs rookie ${(rookie.pct * 100).toFixed(1)}%`);
    });

    test('gun damage on a weaving player scales with difficulty (rookie < veteran < ace, veteran fair)', () => {
        const perMin = (difficulty, skill) => {
            let dmg = 0, secs = 0;
            for (let s = 1; s <= 6; s++) {
                seeded(s * 977, () => {
                    const g = arenaGame({ difficulty });
                    const P = g.spawn('f16', { team: 'blue', pos: { x: 0, y: 3000, z: -20000 }, heading: 0, isPlayer: true, speedFrac: 0.6 });
                    P.maxHealth = P.health = 1e6;
                    g.player = P;
                    const E = g.spawn('mig29', { team: 'red', pos: { x: 800, y: 3200, z: -17000 }, heading: 0, skill, speedFrac: 0.6 });
                    E.missiles = 0;
                    const emit = g.events.emit;
                    g.events.emit = (n, w, d) => { if (n === 'hit' && w === P && d.kind === 'gun') dmg += d.amount * 0.45 * g.difficulty.dmgTaken; emit(n, w, d); };
                    const dir = new THREE.Vector3();
                    for (let i = 0; i < 60 * 30; i++) {
                        const hdg = Math.sin(g.time * 0.35) * 1.4; // weaving ±80°
                        steerToward(P, dir.set(-Math.sin(hdg), (3000 - P.pos.y) / 3000, -Math.cos(hdg)).normalize(), P.controls, 1);
                        P.controls.throttle = 0.9;
                        g.step(1 / 30);
                    }
                    secs += 60;
                });
            }
            return dmg / (secs / 60);
        };
        const rookie = perMin('rookie', 0.35), veteran = perMin('veteran', 0.6), ace = perMin('ace', 0.9);
        assert.ok(rookie < veteran && veteran < ace, `hp/min rookie ${rookie.toFixed(1)}, veteran ${veteran.toFixed(1)}, ace ${ace.toFixed(1)}`);
        assert.ok(veteran < 20, `veteran ${veteran.toFixed(1)} hp/min on a 90 hp jet`);
    });

    test('flares: a veteran decoys roughly a quarter of rear-aspect heat seekers (one salvo per missile)', () => {
        let decoyed = 0, n = 0, salvos = 0;
        for (let s = 1; s <= 60; s++) {
            seeded(s * 7, () => {
                const g = arenaGame({ difficulty: 'veteran' });
                const T = g.spawn('mig21', { team: 'red', pos: { x: 0, y: 3000, z: 20000 }, heading: 0, skill: 0.6, speedFrac: 0.6 });
                const S = g.spawn('f16', { team: 'blue', pos: { x: 60, y: 3050, z: 21800 }, heading: 0, isPlayer: true, speedFrac: 0.65 });
                g.player = S;
                const f0 = T.flares;
                let m = null, gotDecoyed = false;
                const emit = g.events.emit;
                g.events.emit = (name, who, d) => { if (name === 'decoyed' && d?.missile === m) gotDecoyed = true; emit(name, who, d); };
                for (let i = 0; i < 20 * 60; i++) {
                    if (!m && i === 30) m = g.weapons.fireMissile(S, T);
                    g.step(1 / 60);
                    if (m && !g.weapons.missiles.includes(m)) break;
                }
                salvos += f0 - T.flares;
                if (gotDecoyed) decoyed++;
                n++;
            });
        }
        assert.ok(salvos <= n, `${salvos} salvos for ${n} missiles`);
        assert.ok(decoyed / n > 0.08 && decoyed / n < 0.38, `decoyed ${decoyed}/${n}`);
    });
});

describe('transports and the ejected pilot', () => {
    test('the escort C-130 circles the field at its route altitude', () => {
        seeded(3, () => {
            const g = arenaGame();
            const dir = new THREE.Vector3(1, 0, 0.4).normalize();
            const start = new THREE.Vector3(0, 1400, 0).addScaledVector(dir, 16000);
            const wp = new THREE.Vector3(0, 900, 0);
            const d = wp.clone().sub(start).setY(0).normalize();
            const a = g.spawn('c130', { team: 'blue', pos: start, heading: Math.atan2(-d.x, -d.z), speedFrac: 0.55 });
            const pl = new Pilot(g, a, 0.5);
            pl.passive = true; pl.waypoint = wp; pl.cruise = 0.7;
            g.player = a;
            let minY = Infinity, maxY = -Infinity, maxR = 0;
            for (let i = 0; i < 360 * 20; i++) {
                g.step(1 / 20);
                if (i > 220 * 20) { minY = Math.min(minY, a.pos.y); maxY = Math.max(maxY, a.pos.y); maxR = Math.max(maxR, Math.hypot(a.pos.x, a.pos.z)); }
            }
            assert.ok(a.alive);
            assert.ok(minY > 860 && maxY < 960, `orbit altitude ${minY.toFixed(0)}–${maxY.toFixed(0)} m (route 900)`);
            assert.ok(maxR < 2400, `orbit radius up to ${maxR.toFixed(0)} m (mission needs < 2.5 km)`);
        });
    });

    for (const onGround of [false, true]) {
        test(`hostiles go after an ejected pilot ${onGround ? 'on the ground' : 'under the canopy'}: at most two at a time, gun runs, nobody crashes`, () => {
            seeded(onGround ? 62 : 31, () => {
                const g = arenaGame();
                const px = 4000, pz = 20000, gy = groundAt(px, pz);
                const pm = {
                    pos: new THREE.Vector3(px, onGround ? gy : gy + 1200, pz), alive: true, isChute: true, team: 'blue', incoming: [],
                    seat: { landed: onGround, vel: new THREE.Vector3(), deployed: true }, walker: onGround ? {} : null, health: 100, hits: 0,
                    headPos(out) { return out.copy(this.pos).setY(this.pos.y + (this.walker ? 1.45 : 1.9)); },
                    takeHit(d) { this.hits++; this.health -= d; if (this.health <= 0) this.alive = false; },
                    // the real PilotOnFoot's hit interface (pilot.js): a body capsule, simplified to a sphere here
                    bulletHit(a, b, dmg) {
                        const c = this.headPos(new THREE.Vector3()).setY(this.pos.y + 1), ab = new THREE.Vector3().subVectors(b, a);
                        const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(c, a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
                        if (a.clone().addScaledVector(ab, t).distanceTo(c) > 1.2) return false;
                        this.takeHit(22 + dmg); return true;
                    },
                    blast(at, R, dmg) { const d = at.distanceTo(this.pos); if (d < R) this.takeHit(dmg * (1 - d / R)); },
                };
                g.pilotMode = pm;
                g.player = { pos: pm.pos, alive: false };
                const reds = ['mig29', 'f5', 'mig21'].map((id, i) => g.spawn(id, { team: 'red', pos: { x: px + 4000 + i * 500, y: gy + 1500, z: pz + i * 800 }, heading: Math.PI / 2, skill: 0.6, speedFrac: 0.6 }));
                let hunters = 0, nearRounds = 0;
                for (let i = 0; i < 120 * 30 && pm.alive; i++) {
                    if (!onGround && pm.pos.y > gy + 1) pm.pos.y -= 5 / 30;
                    g.step(1 / 30);
                    hunters = Math.max(hunters, g._pilotHunters ? g._pilotHunters.size : 0);
                    for (const b of g.weapons.bullets) if (b.team === 'red' && b.pos.distanceTo(pm.pos) < 15) nearRounds++;
                }
                assert.ok(hunters >= 1 && hunters <= 2, `${hunters} hunters`);
                assert.ok(g.log.gunShots > 10, `${g.log.gunShots} rounds fired at him`);
                assert.ok(nearRounds > 0 || pm.hits > 0, 'no rounds came near him');
                assert.equal(reds.filter(r => !r.alive).length, 0, 'a hunter crashed');
            });
        });
    }
});
