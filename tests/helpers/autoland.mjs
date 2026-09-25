// Headless autopilot runs: the real Aircraft + Autopilot over the real terrain and airfields, with a
// stub game shaped like game.js where the autopilot needs it (surfaceAt with runways, feed, input).
import { src } from './setup.mjs';
import { stubGame } from './flight.mjs';

const THREE = await import('three');
const { Aircraft } = await src('aircraft.js');
const { Autopilot, runwayApproach } = await src('autopilot.js');
const { BASES, terrainHeight, isOnRunway } = await src('world.js');
const { noop } = await import('./arena.mjs');

export function autolandGame() {
    const log = { touchdowns: [], feed: [], crashed: false };
    const g = stubGame({
        effects: noop(), wreckage: noop(), audio: noop(),
        world: { weather: null, towns: null },
        naval: { homeCarrier: null, ships: [] },
        input: { spoilersOn: false },
        aimDir: new THREE.Vector3(),
        events: {
            emit(name, who, data) {
                if (name === 'touchdown') log.touchdowns.push({ ...data, t: g.time, pos: who.pos.clone() });
                if (name === 'killed') log.crashed = true;
            },
        },
        addFeed: (msg) => log.feed.push({ t: g.time, msg }),
        surfaceAt(x, z) {
            const th = terrainHeight(x, z);
            const runway = isOnRunway(x, z);
            return { h: Math.max(th, 0), runway, water: th < -0.5 && !runway, ship: null, hull: false, bridge: false };
        },
    });
    g.log = log;
    g.autopilot = new Autopilot(g);
    return g;
}

// Put `typeId` in the air at `along` metres before the home runway's touchdown point on the extended
// centreline (plus `lateral` to the side), `height` metres above the field, flying `headingOff` rad off the
// landing direction, at speedFrac of its top speed; engage the autopilot's landing mode and run it.
export function runAutoland(typeId, { along = 9000, lateral = 0, height = 600, headingOff = 0, speed = null, maxT = 400, dt = 1 / 30, trace = 0 } = {}) {
    const g = autolandGame();
    const home = BASES.find(b => b.friendly);
    const a = runwayApproach(home);
    const ac = new Aircraft(g, typeId, { team: 'blue', isPlayer: true });
    g.aircraft.push(ac);
    g.player = ac;
    const side = new THREE.Vector3(a.fwd.z, 0, -a.fwd.x);
    const pos = a.touch.clone().addScaledVector(a.fwd, -along).addScaledVector(side, lateral);
    pos.y = Math.max(a.touch.y + height, Math.max(terrainHeight(pos.x, pos.z), 0) + 300);
    const dir = a.fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), headingOff);
    const V = speed ?? ac.spec.flight.speed * 0.5;
    ac.spawnAir(pos, Math.atan2(-dir.x, -dir.z), V / ac.spec.flight.speed);
    ac.controls.throttle = 0.6;
    g.autopilot.land();
    let t = 0, landed = false, minAgl = Infinity;
    for (; t < maxT; t += dt) {
        g.time += dt;
        g.autopilot.update(dt, ac);
        ac.update(dt);
        if (!ac.alive || ac.exploded) break;
        if (!ac.onGround) minAgl = Math.min(minAgl, ac.pos.y - ac.gearOffset - Math.max(terrainHeight(ac.pos.x, ac.pos.z), 0));
        if (trace && Math.abs((t / trace) - Math.round(t / trace)) < dt / trace / 2) {
            const rel = ac.pos.clone().sub(a.touch);
            console.log(`  t${t.toFixed(0)} ${g.autopilot.phase}/${g.autopilot.leg} along${(-rel.dot(a.fwd)).toFixed(0)} lat${(rel.x * a.fwd.z - rel.z * a.fwd.x).toFixed(0)} h${(ac.pos.y - a.touch.y).toFixed(0)} agl${(ac.pos.y - Math.max(terrainHeight(ac.pos.x, ac.pos.z), 0)).toFixed(0)} V${ac.speed.toFixed(0)} vs${ac.vel.y.toFixed(1)} thr${ac.controls.throttle.toFixed(2)} p${ac.controls.pitch.toFixed(2)} ab${ac.airbrake ? 1 : 0} a${(ac.alpha * 57.3).toFixed(1)} "${g.autopilot.status}"`);
        }
        if (!g.autopilot.active && ac.onGround) { landed = true; break; }
    }
    const td = g.log.touchdowns[0] || null;
    return { g, ac, t, landed, crashed: !ac.alive || g.log.crashed, td, minAgl, onRunway: !!(td && td.onRunway), goArounds: g.log.feed.filter(f => /GO AROUND/.test(f.msg)).length };
}

export { THREE, BASES };
