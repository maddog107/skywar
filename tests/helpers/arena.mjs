// Headless combat arena: real Aircraft, Pilot (AI) and Weapons (guns, missiles, flares) over the real
// terrain, with no-op effects / wreckage / audio. Math.random is seeded per run so AI statistics are
// reproducible. Used by the AI tests to measure kill/loss, gun accuracy, flare decoys, terrain crashes.
import { src } from './setup.mjs';
import { stubGame } from './flight.mjs';

const THREE = await import('three');
const { Aircraft } = await src('aircraft.js');
const { Pilot } = await src('ai.js');
const { Weapons } = await src('weapons.js');
const { terrainHeight } = await src('world.js');
const { DIFFICULTY } = await src('config.js');

// Anything goes: every property is a function returning the same proxy (effects, wreckage, trails...)
export function noop() {
    const fn = () => proxy;
    const proxy = new Proxy(fn, {
        get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined; return proxy; },
        set() { return true; },
        apply() { return proxy; },
    });
    return proxy;
}

export function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Run fn with Math.random seeded (restored afterwards, even on throw)
export function seeded(seed, fn) {
    const orig = Math.random;
    Math.random = mulberry32(seed);
    try { return fn(); } finally { Math.random = orig; }
}

export function arenaGame({ difficulty = 'veteran', buildings = null, flatSea = false } = {}) {
    const log = { events: [], kills: [], decoyed: 0, missileHits: 0, missiles: 0, gunShots: 0, gunHits: 0, crashes: [] };
    const g = stubGame({
        effects: noop(), wreckage: noop(), audio: noop(),
        world: { weather: null, towns: buildings ? { buildings } : null },
        difficulty: DIFFICULTY[difficulty],
        pilotMode: null,
        player: null,
        camera: { position: new THREE.Vector3() },
        ground: null,
        events: {
            emit(name, who, data) {
                if (name === 'killed') log.kills.push({ victim: who, source: data?.source, kind: data?.kind, t: g.time });
                else if (name === 'decoyed') log.decoyed++;
                else if (name === 'missileHit') log.missileHits++;
                else if (name === 'missileLaunch') log.missiles++;
                else if (name === 'gunfire') log.gunShots++;
                else if (name === 'bulletHit') log.gunHits++;
            },
        },
        surfaceAt: (x, z) => {
            const h = flatSea ? -1 : terrainHeight(x, z);
            return h < 0 ? { h: 0, water: true } : { h };
        },
    });
    g.log = log;
    g.weapons = new Weapons(g);
    g.spawn = (typeId, { team = 'red', pos, heading = 0, speedFrac = 0.6, skill = null, isPlayer = false, PilotClass = Pilot } = {}) => {
        const ac = new Aircraft(g, typeId, { team, isPlayer });
        ac.spawnAir(new THREE.Vector3(pos.x, pos.y, pos.z), heading, speedFrac);
        g.aircraft.push(ac);
        if (skill != null) new PilotClass(g, ac, skill);
        return ac;
    };
    g.step = (dt) => {
        g.time += dt;
        for (const a of g.aircraft) if (a.lockedBy) a.lockedBy.clear();
        for (const a of g.aircraft) if (a.pilot && a.alive && !a.pilotDead) a.pilot.update(dt);
        for (const a of g.aircraft) a.update(dt);
        if (buildings) for (const a of g.aircraft) {
            if (!a.alive || a.falling || a.onGround) continue;
            const r = a.hitRadius * 0.45;
            if (a.pos.y < buildings.maxTop + r && buildings.at(a.pos.x, a.pos.y, a.pos.z, r)) { log.crashes.push({ ac: a, what: 'building', t: g.time }); a.crash(); }
        }
        g.weapons.update(dt);
    };
    return g;
}

// A block of box "buildings" with the same at(x, y, z, pad) interface as src/buildings.js
export function boxBuildings(boxes) {
    return {
        maxTop: Math.max(...boxes.map(b => b.top)),
        at(x, y, z, pad = 0) {
            for (const b of boxes) if (b.alive !== false && y < b.top + pad && y > b.y - pad && Math.abs(x - b.x) < b.hw + pad && Math.abs(z - b.z) < b.hd + pad) return b;
            return null;
        },
        damage() {}, explode() {},
    };
}

export { THREE, terrainHeight };
