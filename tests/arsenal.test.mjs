import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const A = await src('arsenal.js');
const { ARSENAL, SLOTS, Gun, damageAt, spreadFor, materielDamage, targetClass, blastDamage, explosiveDamage, friendlyFactor, ROCKET, GRENADE, weaponDef, aimSigma, hitProbability } = A;

// run a gun for `secs` at `fps` with the trigger held (or tapped: down on alternate frames)
function run(gun, secs, fps, trigger = () => true) {
    let n = 0, frames = Math.round(secs * fps);
    for (let i = 0; i < frames; i++) n += gun.update(1 / fps, trigger(i));
    return n;
}

describe('arsenal: the weapons', () => {
    test('seven weapons on keys 1–7, each with the stats it needs', () => {
        assert.deepEqual(SLOTS, ['ak47', 'm4a1', 'm870', 'm9', 'deagle', 'rpg7', 'm67']);
        for (const [i, id] of SLOTS.entries()) {
            const w = ARSENAL[id];
            assert.equal(w.id, id); assert.equal(w.slot, i + 1);
            assert.ok(w.name && w.long && w.type && w.fire && w.model, id);
            assert.ok(w.mag >= 1 && w.reserve >= 0, id);
            assert.ok(w.spread.hip >= w.spread.ads, id + ': aiming down the sights is never less accurate');
            assert.ok(w.ads.fov > 30 && w.ads.fov < 72 && w.draw > 0, id);
            if (w.type !== 'grenade' && w.type !== 'launcher') {
                assert.ok(w.damage > 0 && w.rpm > 0 && w.velocity > 200 && w.life > 0, id);
                assert.ok(w.range[0] < w.range[1] && w.range[2] > 0 && w.range[2] < 1, id);
                assert.ok(w.head > 1, id + ': headshots hurt more');
                assert.ok(w.noise > 100, id);
            }
        }
    });

    test('real-world magazines, rates and muzzle velocities', () => {
        assert.equal(ARSENAL.ak47.mag, 30); assert.equal(ARSENAL.m4a1.mag, 30);
        assert.equal(ARSENAL.m9.mag, 15); assert.equal(ARSENAL.deagle.mag, 8); // .44 Magnum
        assert.equal(ARSENAL.m870.mag, 6); assert.equal(ARSENAL.rpg7.mag, 1);
        assert.equal(ARSENAL.m870.pellets, 9); // 00 buckshot
        assert.ok(ARSENAL.ak47.rpm >= 550 && ARSENAL.ak47.rpm <= 650);
        assert.ok(ARSENAL.m4a1.rpm >= 700 && ARSENAL.m4a1.rpm <= 950);
        assert.ok(Math.abs(ARSENAL.ak47.velocity - 715) < 30 && ARSENAL.m4a1.velocity > 850 && ARSENAL.m9.velocity < 400);
        assert.equal(ARSENAL.m9.fire, 'semi'); assert.equal(ARSENAL.deagle.fire, 'semi'); // pistols are semi-automatic
        assert.equal(ARSENAL.m870.fire, 'pump');
    });

    test('different damage: Deagle > AK > M4 > M9 per round; the shotgun hits hardest up close; explosives kill', () => {
        const d = (id) => ARSENAL[id].damage;
        assert.ok(d('deagle') > d('ak47') && d('ak47') > d('m4a1') && d('m4a1') > d('m9'));
        const shotgun = ARSENAL.m870.damage * ARSENAL.m870.pellets;
        assert.ok(shotgun > 100 && shotgun > d('deagle'), 'nine pellets point blank');
        // rounds to kill a soldier (100 hp) in the body at 10 m
        const toKill = (id) => Math.ceil(100 / damageAt(ARSENAL[id], 10));
        assert.deepEqual(['ak47', 'm4a1', 'm9', 'deagle'].map(toKill), [3, 4, 5, 2]);
        // a rifle headshot close up kills outright
        for (const id of ['ak47', 'm4a1', 'deagle']) assert.ok(damageAt(ARSENAL[id], 20) * ARSENAL[id].head >= 100, id);
        assert.ok(blastDamage(0, ROCKET.blast) >= 100 && blastDamage(0, GRENADE.blast) >= 100);
    });

    test('damage falls off with range, never below its floor', () => {
        for (const id of ['ak47', 'm4a1', 'm870', 'm9', 'deagle']) {
            const w = ARSENAL[id];
            let prev = Infinity;
            for (let d = 0; d <= 600; d += 5) {
                const v = damageAt(w, d);
                assert.ok(v <= prev + 1e-9, id + ' at ' + d);
                assert.ok(v >= w.damage * w.range[2] - 1e-9);
                prev = v;
            }
            assert.equal(damageAt(w, w.range[0]), w.damage);
            assert.ok(Math.abs(damageAt(w, w.range[1] + 100) - w.damage * w.range[2]) < 1e-9);
        }
        // the shotgun's pellets are nearly spent at 40 m, a rifle round isn't
        assert.ok(damageAt(ARSENAL.m870, 40) / ARSENAL.m870.damage < 0.2);
        assert.ok(damageAt(ARSENAL.ak47, 40) / ARSENAL.ak47.damage === 1);
    });
});

describe('arsenal: a carried gun', () => {
    test('an automatic holds its rate at any frame rate', () => {
        for (const id of ['ak47', 'm4a1']) {
            const want = ARSENAL[id].rpm / 60 * 2; // two seconds
            for (const fps of [30, 60, 144]) {
                const g = new Gun(id, { mag: 100, reserve: 0 });
                const n = run(g, 2, fps);
                assert.ok(Math.abs(n - want) <= 2, `${id} at ${fps} fps: ${n} rounds, want ~${want}`);
            }
        }
    });

    test('semi-automatics need a fresh pull, and can\'t outrun their action', () => {
        const g = new Gun('m9');
        assert.equal(run(g, 1, 60), 1, 'holding the trigger fires once');
        const g2 = new Gun('m9', { mag: 100 });
        const n = run(g2, 1, 60, (i) => i % 2 === 0); // a pull every other frame: 30 pulls a second
        assert.ok(n <= ARSENAL.m9.rpm / 60 + 1 && n >= 5, n + ' shots');
        const de = new Gun('deagle', { mag: 100 });
        assert.ok(run(de, 1, 60, (i) => i % 2 === 0) <= ARSENAL.deagle.rpm / 60 + 1);
    });

    test('an empty gun clicks (dry) and fires nothing; a magazine reload brings it back', () => {
        const g = new Gun('ak47', { mag: 0, reserve: 45 });
        assert.equal(g.update(1 / 60, true), 0);
        assert.ok(g.dry);
        g.update(1 / 60, false);
        assert.ok(g.startReload());
        assert.equal(g.reload.kind, 'empty');
        const events = [];
        let t = 0;
        while (g.reloading && t < 10) { g.update(1 / 60, false); events.push(...g.events); t += 1 / 60; }
        assert.ok(Math.abs(t - ARSENAL.ak47.reloadEmpty) < 0.05, 'takes the empty-reload time: ' + t.toFixed(2));
        assert.equal(g.mag, 30); assert.equal(g.reserve, 15);
        assert.deepEqual(events.filter(e => e !== 'reloaded'), ['magOut', 'magIn', 'bolt']);
        // a tactical reload (rounds left) is quicker and tops up only what's missing
        const g2 = new Gun('ak47', { mag: 12, reserve: 10 });
        g2.startReload();
        t = 0; while (g2.reloading) { g2.update(1 / 60, false); t += 1 / 60; }
        assert.ok(Math.abs(t - ARSENAL.ak47.reload) < 0.05);
        assert.equal(g2.mag, 22); assert.equal(g2.reserve, 0);
        assert.ok(!g2.startReload(), 'nothing left to load');
    });

    test('the shotgun: pump between shots, shell-by-shell reload you can interrupt', () => {
        const g = new Gun('m870');
        assert.equal(g.update(1 / 60, true), 1);
        assert.ok(!g.chambered && g.pump > 0 && g.events.includes('pump'));
        // pulling as fast as you like: the next shot waits for the pump stroke
        let t = 0, fired = 0;
        for (let i = 0; i < 120 && !fired; i++) { fired = g.update(1 / 60, i % 2 === 1); t += 1 / 60; }
        assert.equal(fired, 1);
        assert.ok(t >= ARSENAL.m870.pump && t < ARSENAL.m870.pump + 0.2, 'fires again after ' + t.toFixed(2) + ' s');
        g.update(1 / 60, false);
        // reload three shells: start + 3 × shell + end
        const g2 = new Gun('m870', { mag: 3, reserve: 10 });
        g2.startReload();
        t = 0; let shells = 0;
        while (g2.reloading && t < 10) { g2.update(1 / 60, false); shells += g2.events.filter(e => e === 'shellIn').length; t += 1 / 60; }
        const D = ARSENAL.m870;
        assert.equal(shells, 3); assert.equal(g2.mag, 6); assert.equal(g2.reserve, 7);
        assert.ok(Math.abs(t - (D.shellStart + 3 * D.shell + D.shellEnd)) < 0.05, t.toFixed(2));
        // interrupting: the trigger stops it after the shell going in
        const g3 = new Gun('m870', { mag: 1, reserve: 10 });
        g3.startReload();
        for (let i = 0; i < Math.round((D.shellStart + D.shell * 1.5) * 60); i++) g3.update(1 / 60, false);
        g3.update(1 / 60, true);
        t = 0; while (g3.reloading && t < 5) { g3.update(1 / 60, false); t += 1 / 60; }
        assert.ok(g3.mag < 6 && g3.mag >= 2, 'stopped early with ' + g3.mag);
    });

    test('the RPG: one rocket, then a reload', () => {
        const g = new Gun('rpg7');
        assert.equal(g.update(1 / 60, true), 1);
        assert.equal(g.mag, 0);
        let shots = 0, dry = false;
        for (let i = 0; i < 90; i++) { shots += g.update(1 / 60, i % 2 === 1); dry ||= g.dry; }
        assert.equal(shots, 0); assert.ok(dry, 'the trigger clicks on an empty tube');
        g.startReload();
        assert.equal(g.reload.kind, 'rocket');
        let t = 0; while (g.reloading) { g.update(1 / 60, false); t += 1 / 60; }
        assert.ok(Math.abs(t - ARSENAL.rpg7.reload) < 0.05);
        assert.equal(g.mag, 1); assert.equal(g.reserve, ARSENAL.rpg7.reserve - 1);
    });

    test('spread: sights < hip, still < walking < running; sustained fire blooms and recovers', () => {
        for (const id of ['ak47', 'm4a1', 'm9', 'deagle']) {
            const w = ARSENAL[id];
            const s = (st) => spreadFor(w, null, st);
            assert.ok(s({ ads: 1 }) < s({}), id);
            assert.ok(s({}) < s({ walk: 1 }) && s({ walk: 1 }) < s({ walk: 1, run: 1 }), id);
            assert.ok(s({ air: true }) > s({}), id);
        }
        const g = new Gun('ak47', { mag: 100 });
        const cold = spreadFor(g.def, g, {});
        run(g, 1.5, 60);
        const hot = spreadFor(g.def, g, {});
        assert.ok(hot > cold * 1.4, `bloom ${cold.toFixed(4)} → ${hot.toFixed(4)}`);
        run(g, 1, 60, () => false);
        assert.ok(spreadFor(g.def, g, {}) < cold * 1.05, 'recovered');
    });
});

describe('arsenal: what it does to things', () => {
    test('cars: rifle rounds wear one down; a rocket or grenade wrecks it at once', () => {
        const toWreck = (id, hp = 30) => Math.ceil(hp / (materielDamage(ARSENAL[id], 'vehicle') * (ARSENAL[id].pellets || 1)));
        assert.ok(toWreck('ak47') >= 8 && toWreck('ak47') <= 20, 'AK: ' + toWreck('ak47'));
        assert.ok(toWreck('m9') > toWreck('ak47') && toWreck('deagle') < toWreck('ak47'));
        assert.ok(toWreck('m870') <= 5, 'buckshot up close');
        assert.ok(toWreck('ak47', 60) > toWreck('ak47', 30), 'a lorry takes more');
        assert.ok(ROCKET.vs.vehicle >= 60 && GRENADE.vs.vehicle >= 60);
    });

    test('small arms bounce off armour and walls; an RPG takes a tank in two, a truck in one', () => {
        assert.equal(targetClass({ type: 'tank' }), 'armor');
        assert.equal(targetClass({ type: 'bunker' }), 'armor');
        assert.equal(targetClass({ type: 'truck' }), 'soft');
        assert.equal(targetClass({ type: 'sam' }), 'soft');
        assert.equal(targetClass({ isShip: true }), 'armor');
        for (const id of ['ak47', 'm4a1', 'm870', 'm9', 'deagle']) {
            assert.equal(materielDamage(ARSENAL[id], 'armor'), 0, id);
            assert.equal(materielDamage(ARSENAL[id], 'building'), 0, id);
            assert.ok(materielDamage(ARSENAL[id], 'soft') > 0 && materielDamage(ARSENAL[id], 'aircraft') > 0, id);
        }
        const hits = (hp, cls) => Math.ceil(hp / explosiveDamage(ROCKET, cls, true));
        assert.equal(hits(90, 'armor'), 2, 'tank (90 hp)');
        assert.equal(hits(45, 'soft'), 1, 'truck (45 hp)');
        assert.equal(hits(80, 'soft'), 1, 'mobile SAM');
        // splash falls off to nothing
        assert.ok(explosiveDamage(ROCKET, 'soft', false, 1) > explosiveDamage(ROCKET, 'soft', false, 5));
        assert.equal(explosiveDamage(ROCKET, 'soft', false, ROCKET.splash), 0);
        assert.equal(explosiveDamage(GRENADE, 'armor', true), 0, 'a grenade does nothing to a tank');
    });

    test('blasts: lethal close, nothing past their radius, never growing with distance', () => {
        for (const B of [ROCKET.blast, GRENADE.blast]) {
            assert.ok(blastDamage(B.inner, B) >= 100, 'lethal inside the inner radius');
            assert.equal(blastDamage(B.R, B), 0);
            let prev = Infinity;
            for (let d = 0; d <= B.R; d += 0.25) { const v = blastDamage(d, B); assert.ok(v <= prev); prev = v; }
        }
        assert.ok(ROCKET.blast.R >= 6 && GRENADE.blast.R >= 10, 'fragments carry');
    });

    test('friendly fire stays sensible: rounds pass your own side, blasts hurt it a third as much', () => {
        assert.equal(friendlyFactor('blue', 'blue', 'gun'), 0);
        assert.equal(friendlyFactor('blue', 'red', 'gun'), 1);
        assert.ok(friendlyFactor('red', 'red', 'blast') > 0 && friendlyFactor('red', 'red', 'blast') < 0.5);
        assert.equal(friendlyFactor(null, 'red', 'blast'), 1, 'a jet crashing: everyone');
    });

    test('AI marksmanship: worse with range, better with skill, worse on the move and under fire', () => {
        const p = (o, d) => hitProbability(aimSigma(o), d, 0.3);
        assert.ok(p({ skill: 0.6 }, 20) > p({ skill: 0.6 }, 100) && p({ skill: 0.6 }, 100) > p({ skill: 0.6 }, 300));
        assert.ok(p({ skill: 0.9 }, 100) > p({ skill: 0.6 }, 100) && p({ skill: 0.6 }, 100) > p({ skill: 0.35 }, 100));
        assert.ok(p({ skill: 0.6, moving: true }, 50) < p({ skill: 0.6 }, 50));
        assert.ok(p({ skill: 0.6, suppressed: 1 }, 50) < p({ skill: 0.6 }, 50));
        assert.ok(p({ skill: 0.6, settle: 1 }, 50) < p({ skill: 0.6 }, 50));
        // sane numbers per round: a veteran hits a man at 10 m nearly always, at 30 m about every other
        // round, and hardly ever at 250 m (volume of fire still matters out there)
        assert.ok(p({ skill: 0.6 }, 10) > 0.95);
        assert.ok(p({ skill: 0.6 }, 30) > 0.35 && p({ skill: 0.6 }, 30) < 0.8);
        assert.ok(p({ skill: 0.6 }, 250) < 0.05);
        void weaponDef;
    });
});
