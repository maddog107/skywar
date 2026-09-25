// ═══════════════════════════════════════════════════════════════
// AI pilots. Uses the same flight model and controls as the player.
// Skill (0..1, from the difficulty setting: rookie 0.35 · veteran 0.6 · ace 0.9, ± a little per pilot)
// sets reaction time, G tolerance, gun aim error, lead accuracy and fire discipline, how hard it
// presses the attack, missile discipline, missile/guns defence and flare timing, and how low it flies.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, rand, lerp, G } from './util.js';
import { WEAPONS } from './config.js';
import { terrainHeight } from './world.js';
import { thrustLapse } from './aircraft.js';

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _d = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), _a = new THREE.Vector3();
const _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _zero = new THREE.Vector3();
const CL_MAX = 1.65; // aircraft.js

// Turn a desired world direction (for the flight path) into stick inputs, bank-to-turn like a real pilot.
// Lift-vector steering: the path is asked to turn toward the target at a rate proportional to the angle
// still to go (capped by the G the wing can pull without stalling), plus whatever lift holds the path up
// against gravity. The jet rolls its lift onto that vector and pulls for its size, so level turns bank only
// as far as the G allows and the bank comes off as the target comes round. Gains are sized to each type's
// pitch/roll response so the path settles on the target instead of swinging through it; no state is kept,
// so it behaves the same at any frame rate.
// maxBank (rad): cap the bank of a level turn; by default AI airliners/transports/light aircraft keep to
// about 40° (bombers 50°) and everyone else, and the player's mouse-aim, can use all the G there is.
export function steerToward(ac, dir, c, aggr = 1, keepUpright = true, maxBank = null) {
    const f = ac.spec.flight;
    _f.set(0, 0, -1).applyQuaternion(ac.qv);
    _u.set(0, 1, 0).applyQuaternion(ac.qv);
    _r.set(1, 0, 0).applyQuaternion(ac.qv);
    const x = dir.dot(_r), y = dir.dot(_u), z = dir.dot(_f);
    const angle = Math.acos(clamp(z, -1, 1));
    const bank = Math.atan2(-_r.y, _u.y); // + = right wing down
    const V = Math.max(ac.speed || ac.vel.length(), 20);
    const nN = Math.max(0, _u.y); // the G that neutral stick holds (see Aircraft.updateFlight)
    const gSpan = Math.max(f.gLimit - nN, 0.5);
    const tau = ac.pitchTau || 0.15;
    const rollAuth = f.roll * clamp(V / 90, 0.12, 1); // top roll rate at this speed
    const rollGain = Math.min(4, (ac.rollResp || 5) * 0.4); // 1/s: bank error → roll rate
    // 1/s: angle error → path turn rate. Slower than the pitch response (AoA lag) and than the time it takes
    // to roll the lift vector around, or the path swings through before the wings come level again
    const rollTime = 1 / rollGain + 1 / rollAuth;
    const pathGain = Math.min(2.6, 0.24 / tau) * (0.55 + 0.45 * aggr); // in the current lift plane
    const sideGain = Math.min(pathGain, 0.8 / rollTime); // sideways (needs the lift vector rolled round)
    const rollFor = (p) => clamp(p / rollAuth, -1, 1);
    // most G available right now (G limit, or less when slow)
    const pull = ac.pullAvail ?? 1;
    const gMax = pull < 1 ? nN + pull * gSpan : f.gLimit;

    // target just below the nose: push over rather than rolling inverted
    if (y < 0 && angle < 0.5 && -y > Math.abs(x) * 1.2) {
        c.roll = rollFor(rollGain * (Math.atan(clamp(pathGain * Math.asin(clamp(x, -1, 1)) * V / G, -0.6, 0.6)) - (keepUpright ? bank : 0)));
        c.pitch = clamp(pathGain * Math.asin(clamp(y, -1, 1)) * V / G / (nN + 3), -0.8, 0);
        c.yaw = clamp(-x * 6, -1, 1);
        return angle;
    }
    // desired lift = turn toward the target + hold the path against gravity (both ⊥ to the velocity), split
    // into the vertical plane of the path (fast: pitch alone does it) and the horizontal (slow: needs a bank)
    _d.copy(dir).addScaledVector(_f, -z);
    const sinA = _d.length();
    if (sinA > 1e-4) _d.divideScalar(sinA); else _d.copy(_u); // straight behind: keep pulling the way we are
    const wUp = _b.set(0, 1, 0).addScaledVector(_f, -_f.y);
    const cg = wUp.length(); // cos(flight-path angle)
    if (cg > 0.05) wUp.divideScalar(cg); else wUp.copy(_u); // vertical flight: use the lift axis
    const wSide = _c.crossVectors(_f, wUp); // horizontal, to the right
    // target behind us: come round in a level turn (toward whichever side it's on) rather than pulling
    // through the vertical, which near the ground or in a heavy ends in a dive
    if (angle > 1.4) {
        const side = Math.sign(_d.dot(wSide)) || Math.sign(bank) || 1;
        const w = clamp((angle - 1.4) / 0.6, 0, 1);
        _d.multiplyScalar(1 - w).addScaledVector(wSide, side * w).normalize();
    }
    let av = pathGain * angle * V * _d.dot(wUp), ah = sideGain * angle * V * _d.dot(wSide);
    if (maxBank == null && !ac.isPlayer) maxBank = defaultMaxBank(ac);
    if (maxBank) ah = clamp(ah, -G * Math.tan(maxBank), G * Math.tan(maxBank));
    // no more than the G there is: scale the turn part down until |lift| fits
    const gv = G * cg, lim = gMax * G;
    if ((av + gv) ** 2 + ah * ah > lim * lim) {
        const A = av * av + ah * ah, B = 2 * av * gv, C = gv * gv - lim * lim;
        const k = A > 1e-6 ? clamp((-B + Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A), 0, 1) : 0;
        av *= k; ah *= k;
    }
    _a.copy(wUp).multiplyScalar(av + gv).addScaledVector(wSide, ah);
    const lu = _a.dot(_u), lr = _a.dot(_r);
    const rollErr = Math.atan2(lr, lu);
    const n = Math.hypot(lu, lr) / G;
    c.roll = rollFor(rollGain * rollErr);
    // pull for the lift we want once it points the right way (neutral while rolling across)
    const align = Math.cos(rollErr);
    c.pitch = clamp((n - nN) / gSpan, -0.3, 1) * clamp(align * 1.6, -0.25, 1);
    // rudder only for fine tracking; big turns are flown coordinated (a skid throws the lift away)
    const rudder = ac.spec.category === 'fighter' ? 1 : 0.25; // (heavies don't skid round the sky)
    c.yaw = angle < 0.14 ? clamp(-x * 10, -1, 1) * clamp((0.14 - angle) / 0.07, 0, 1) * rudder : 0;
    // never pull past the stall (the most G the wing has at this speed); too slow to even hold the path,
    // ease off (let the nose drop) so the speed comes back instead of mushing along at max AoA
    if (c.pitch > 0) c.pitch = Math.min(c.pitch, Math.max(pull, 0.04));
    if (ac.nAvail != null && ac.nAvail < nN * 1.05) c.pitch = Math.min(c.pitch, (ac.nAvail * 0.9 - nN) / (nN + 3));
    return angle;
}

// sedate turns for heavies and light aircraft (rad)
export function defaultMaxBank(ac) {
    const cat = ac.spec.category;
    return cat === 'civil' ? 0.7 : cat === 'bomber' ? 0.87 : null;
}

// ── Ground and building avoidance ──
const groundAt = (x, z) => Math.max(terrainHeight(x, z), 0);
const buildingsOf = (ac) => ac.game?.world?.towns?.buildings || null;

// most G the jet can pull right now (G limit, or what the wing gives when slow)
function gAvail(ac) {
    const f = ac.spec.flight;
    const nN = Math.max(0, _u.set(0, 1, 0).applyQuaternion(ac.qv).y);
    const pull = ac.pullAvail ?? 1;
    return pull < 1 ? nN + pull * (f.gLimit - nN) : f.gLimit;
}

// Steepest sustained climb (flight-path angle, rad) the type manages at full power here: thrust over weight
// minus drag over lift at the best L/D. Fighters ~0.6 (capped), a 747 ~0.15, a Cessna ~0.2.
export function climbGradient(ac) {
    const f = ac.spec.flight;
    const rho = Math.exp(-Math.max(ac.pos.y, 0) / 9000);
    const ld = 0.5 * Math.sqrt(f.lift / (Math.max(ac.cd0 || 0.05, 0.01) * 0.13));
    return clamp((f.accel * thrustLapse(rho, ac.spec) * 0.9 - G / ld) / G, 0.04, 0.6);
}

// how far the tallest building within r of (x, z) stands above the ground there (0 when there's none)
function roofsNear(bl, x, z, gy, r) {
    let top = 0;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const px = x + i * r / 3, pz = z + j * r / 3;
        const b = bl.at(px, gy + 3, pz, 30);
        if (b) top = Math.max(top, b.top - gy);
    }
    return top;
}

// highest ground (or rooftop) along a line from (x0, z0) in direction (hx, hz): samples out to dist
function ridgeAlong(x0, z0, hx, hz, dist, n = 10) {
    let top = 0;
    for (let i = 1; i <= n; i++) { const d = dist * i / n; top = Math.max(top, groundAt(x0 + hx * d, z0 + hz * d)); }
    return top;
}

// Look ahead along the flight path (auto-GCAS style) and work out the climb angle needed to stay clear:
//  · terrain following: the straight path must clear the ground (and any town building) by minAGL, out to
//    6 s — or as far as a type that climbs poorly needs to see a ridge coming (a heavy: several km);
//  · dive recovery: if rolling wings-level and pulling out now would only just clear the ground, pull now;
//  · a ridge too steep to out-climb: turn toward the lower side while climbing.
// Returns { climb (rad, wanted flight-path angle), urgent, turn (-1 left / +1 right / 0) } or null when clear.
function groundThreat(ac, minAGL, diving = false) {
    const V = Math.max(ac.speed, 30), f = ac.spec.flight;
    const vh = Math.hypot(ac.vel.x, ac.vel.z);
    const hx = vh > 1 ? ac.vel.x / vh : 0, hz = vh > 1 ? ac.vel.z / vh : -1;
    const gam = Math.asin(clamp(ac.vel.y / V, -1, 1));
    const x0 = ac.pos.x, y0 = ac.pos.y, z0 = ac.pos.z;
    const bl = buildingsOf(ac);
    const pad = ac.hitRadius * 0.45 + 12;
    const gMaxClimb = climbGradient(ac);
    let need = -Infinity, urgent = false, turn = 0, needNow = -Infinity;
    // 1) terrain following along the current path; samples closer together near the nose (skipped on a
    //    deliberate gun run at something on the ground: then only the pull-out below has to work)
    const D = Math.max(V * 6, Math.min(9000, 700 / gMaxClimb)), n1 = diving ? 0 : 16;
    for (let i = 1; i <= n1; i++) {
        const d = D * (i / n1) * (i / n1) * 0.7 + D * (i / n1) * 0.3;
        const t = d / V;
        const x = x0 + hx * d, z = z0 + hz * d, yPath = y0 + d * Math.tan(gam);
        const margin = minAGL * (t < 1.5 ? 0.55 : 1);
        let top = groundAt(x, z) + margin;
        if (bl && yPath < bl.maxTop + pad) { const b = bl.at(x, yPath, z, pad); if (b) top = Math.max(top, b.top + pad + 15); }
        // far ahead we can still climb later (at half our best gradient), so only ask for what that leaves
        const later = Math.max(0, d - V * 3) * gMaxClimb * 0.5;
        need = Math.max(need, Math.atan2(top - y0 - later, Math.max(d, 1)));
        if (d > V * 4) needNow = Math.max(needNow, Math.atan2(top - y0, d)); // (a ridge further out: turn-away check)
    }
    // buildings right under the nose (the samples above are tens of metres apart)
    if (bl && y0 < bl.maxTop + pad + 40) {
        for (let d = 20; d < Math.min(V * 2.5, 700); d += 20) {
            const x = x0 + hx * d, z = z0 + hz * d, y = y0 + d * Math.tan(gam);
            const b = bl.at(x, y, z, pad);
            if (b) { need = Math.max(need, Math.atan2(b.top + pad + 15 - y0, d)); urgent = urgent || d < V * 1.2; }
        }
    }
    // 2) dive recovery: react, roll wings level, pull at 85% of the available G to a 10° climb
    if (gam < -0.03) {
        const n = Math.max(1.3, gAvail(ac) * 0.85);
        _u.set(0, 1, 0).applyQuaternion(ac.qv); _r.set(1, 0, 0).applyQuaternion(ac.qv);
        const bank = Math.abs(Math.atan2(-_r.y, _u.y));
        const tLag = 0.3 + (ac.pitchTau || 0.15) + bank / Math.max(f.roll * clamp(V / 90, 0.12, 1), 0.3);
        let g2 = gam, x = x0, y = y0, z = z0, minClear = Infinity;
        for (let t = 0; t < 9; t += 0.25) {
            if (t > tLag && g2 < 0.17) g2 = Math.min(0.17, g2 + (n - Math.cos(g2)) * G / V * 0.25);
            x += hx * V * Math.cos(g2) * 0.25; z += hz * V * Math.cos(g2) * 0.25; y += V * Math.sin(g2) * 0.25;
            minClear = Math.min(minClear, y - groundAt(x, z));
            if (g2 >= 0.17 && t > tLag + 2) break;
        }
        // (on a deliberate gun run the pilot accepts a lower pull-out)
        if (minClear < minAGL * (diving ? 0.25 : 0.45)) { urgent = true; need = Math.max(need, 0.3); }
    }
    // low and sinking right now
    const agl = y0 - groundAt(x0, z0);
    if (agl < minAGL * 0.4 && ac.vel.y < 0) { urgent = true; need = Math.max(need, 0.2); }
    // 3) a ridge ahead it could only just out-climb even starting now: turn toward the lower ground as well
    //    (compare 50° either side) — early, since a heavy needs a couple of km to come round
    const ridge = needNow > gMaxClimb * 0.8;
    if (!urgent && !ridge && need < gam - 0.05) return null; // comfortably above the safe line
    if (need > gMaxClimb * 0.55 || ridge) {
        need = Math.max(need, Math.min(needNow, gMaxClimb));
        const dd = Math.min(D, V * 20), c5 = Math.cos(0.87), s5 = Math.sin(0.87);
        const left = ridgeAlong(x0, z0, hx * c5 + hz * s5, -hx * s5 + hz * c5, dd);
        const right = ridgeAlong(x0, z0, hx * c5 - hz * s5, hx * s5 + hz * c5, dd);
        turn = left < right ? -1 : 1;
        urgent = true;
    }
    return { climb: clamp(need + 0.04, 0.03, urgent ? 0.7 : 0.45), urgent, turn, below: need > gam + 0.01 };
}

// Terrain / building avoidance. Returns true if it took over the controls (climbing out, wings level).
// The look-ahead runs at ~15 Hz and is cached on the aircraft.
// diving: a deliberate gun run on a ground target — only the dive recovery (and rooftops) are checked.
export function avoidTerrain(ac, c, minAGL = 150, diving = false) {
    const now = ac.game?.time ?? 0;
    let st = ac._gcas;
    if (!st || st.minAGL !== minAGL || st.diving !== diving || now - st.t > 0.066 || now < st.t) {
        const hold = st && st.minAGL === minAGL && now >= st.t ? st.holdUntil : -1;
        st = ac._gcas = { t: now, minAGL, diving, threat: groundThreat(ac, minAGL, diving), holdUntil: hold };
        // take over when the path dips below the safe line, and keep it a moment (heavies longer) so the
        // pilot's own steering can't nose straight back down into the hill it just climbed away from
        if (st.threat && (st.threat.below || st.threat.urgent)) st.holdUntil = now + (ac.spec.category === 'fighter' ? 1.2 : 3);
    }
    const th = st.threat;
    if (!th || now > st.holdUntil) return false;
    // climb out on the current heading at the needed angle (turning away from a ridge it can't out-climb)
    const vh = Math.hypot(ac.vel.x, ac.vel.z) || 1;
    let hx = ac.vel.x / vh, hz = ac.vel.z / vh;
    if (th.turn) { const a = th.turn * 0.9, ca = Math.cos(a), sa = Math.sin(a); [hx, hz] = [hx * ca - hz * sa, hx * sa + hz * ca]; }
    _t.set(hx * Math.cos(th.climb), Math.sin(th.climb), hz * Math.cos(th.climb));
    steerToward(ac, _t, c, 1, true);
    c.throttle = 1;
    if (th.urgent) ac.airbrake = false;
    return true;
}

// Corner speed: the slowest speed at which the jet can still pull its G limit (m/s, at this altitude)
export function cornerSpeed(ac) {
    const rho = Math.exp(-Math.max(ac.pos.y, 0) / 9000);
    return Math.sqrt(ac.spec.flight.gLimit * G / (ac.liftK * rho * CL_MAX));
}

// Gun lead: where the target will be when a round fired now reaches it (relative to us, into `out`).
// Rounds leave at bulletSpeed relative to the shooter and drop at G/2; the target keeps its velocity and
// (scaled by `accK`) its turn.
export function gunLead(ac, t, out, accK = 1) {
    const r = _b.subVectors(t.pos, ac.pos);
    const vr = _c.subVectors(t.vel || _zero, ac.vel);
    // target acceleration: lift along its lift axis minus gravity (0 for anything flying straight and level)
    const at = _e.set(0, 0, 0);
    if (t.qv && t.gLoad != null && accK > 0) at.set(0, 1, 0).applyQuaternion(t.qv).multiplyScalar(t.gLoad * G).add(_a.set(0, -G, 0)).multiplyScalar(accK);
    const Vb = WEAPONS.bulletSpeed;
    let T = r.length() / Vb;
    for (let i = 0; i < 3; i++) {
        out.copy(r).addScaledVector(vr, T).addScaledVector(at, 0.5 * T * T);
        out.y += 0.25 * G * T * T;
        T = out.length() / Vb;
    }
    return T;
}

export class Pilot {
    constructor(game, ac, skill = 0.5) {
        this.game = game;
        this.ac = ac;
        this.skill = clamp(skill, 0.1, 1);
        ac.pilot = this;
        this.target = null;
        this.state = 'engage';
        this.thinkT = rand(0, 0.5);
        this.stateT = 0;
        this.lockT = 0;
        this.missileCD = rand(3, 8);
        this.burstT = 0;
        this.jinkT = 0; this.jinkDir = new THREE.Vector3();
        this.breakDir = new THREE.Vector3();
        this.aimWobble = rand(0, 100);
        this.noticeT = 0;
        this.home = null; // patrol anchor
        this.formation = null; // {leader, offset}
        this.lead = new THREE.Vector3();
    }

    enemiesOf() {
        const out = [];
        for (const a of this.game.aircraft) if (a.alive && a.team !== this.ac.team && !a.onGround && !a.abandoned) out.push(a);
        if (this.leash && this.home) return out.filter(e => e.pos.distanceTo(this.home) < this.leash);
        return out;
    }

    // The ejected player (under the canopy or on foot) is fair game for the bad guys: one or two gun-armed
    // hostiles with nothing better close by go after him with strafing runs; the rest keep flying.
    pilotTarget(best) {
        const g = this.game, ac = this.ac, pm = g.pilotMode;
        const hunters = g._pilotHunters || (g._pilotHunters = new Set());
        for (const h of hunters) if (!h.ac.alive || h.game !== g || h.target !== g.pilotMode || !g.pilotMode?.alive) hunters.delete(h);
        if (!pm || !pm.alive || ac.team !== 'red' || !ac.spec.gun || ac.ammo <= 0 || this.passive) { hunters.delete(this); return best; }
        if (this.leash && this.home && pm.pos.distanceTo(this.home) > this.leash) { hunters.delete(this); return best; }
        const dPm = pm.pos.distanceTo(ac.pos);
        const dBest = best ? best.pos.distanceTo(ac.pos) : Infinity;
        if (dPm < 14000 && (hunters.has(this) || hunters.size < 2) && (dBest > 3000 || dPm < dBest * 0.4)) { hunters.add(this); return pm; }
        hunters.delete(this);
        return best;
    }

    pickTarget() {
        const ac = this.ac;
        if (this.passive) { this.target = null; return; }
        const fwd = ac.getForward(_f);
        let best = null, bestScore = Infinity;
        for (const e of this.enemiesOf()) {
            const d = e.pos.distanceTo(ac.pos);
            const dot = _d.subVectors(e.pos, ac.pos).normalize().dot(fwd);
            let score = d * (1.6 - dot * 0.6);
            if (e.isPlayer) score *= this.game.aggroPlayer ?? 0.8; // hostiles prefer the player a bit
            if (e.isChute) score *= 1.6;
            if (e === this.target) score *= 0.7; // stickiness
            if (score < bestScore) { bestScore = score; best = e; }
        }
        // escort missions: go for the protected aircraft most of the time (decided every few seconds)
        this.priorityT = (this.priorityT || 0) - 1;
        if (this.priorityT <= 0) { this.usePriority = Math.random() < 0.65; this.priorityT = 6 + Math.floor(Math.random() * 8); }
        if (this.priority && this.priority.alive && (this.usePriority || !best)) best = this.priority;
        best = this.pilotTarget(best);
        if (best !== this.target) { this.lockT = 0; this.strafePhase = null; }
        this.target = best;
    }

    // the incoming missile that arrives first: { m, tti (s) }
    threatMissile() {
        const ac = this.ac;
        let best = null, bestT = Infinity;
        for (const m of ac.incoming) {
            const tti = this.timeToImpact(m);
            if (tti < bestT) { bestT = tti; best = m; }
        }
        return best ? { m: best, tti: bestT } : null;
    }

    timeToImpact(m) {
        const ac = this.ac;
        const rel = _d.subVectors(ac.pos, m.pos);
        const d = rel.length();
        const closing = -_a.subVectors(ac.vel, m.vel).dot(rel.divideScalar(Math.max(d, 1)));
        return d / Math.max(60, closing);
    }

    // decisions, at the pilot's reaction rate
    think() {
        const ac = this.ac, sk = this.skill;
        this.thinkT = lerp(0.9, 0.25, sk) + rand(0, 0.2);
        this.pickTarget();
        const threat = this.threatMissile();
        // rookies often don't notice missiles until late
        if (threat && threat.tti < lerp(2.5, 7, sk) && (this.state === 'defend' || Math.random() < lerp(0.55, 1, sk))) {
            this.state = 'defend';
            this.stateT = 1.5;
            this.defendMissile = threat.m;
        } else if (this.state === 'defend' && this.stateT <= 0) this.state = 'engage';
        if (this.state === 'engage' && ac.health < ac.maxHealth * 0.3 && sk > 0.45 && Math.random() < 0.3) {
            this.state = 'extend';
            this.stateT = rand(5, 9);
        }
        if (this.state === 'extend' && this.stateT <= 0) this.state = 'engage';
        if ((this.state === 'break' || this.state === 'jink') && this.stateT <= 0) {
            // skilled pilots follow a break with a few jinks before turning back in
            this.state = this.state === 'break' && Math.random() < sk ? 'jink' : 'engage';
            if (this.state === 'jink') this.stateT = rand(1, 2);
        }
        // being gunned? break into the attacker
        if (this.state === 'engage' || this.state === 'extend') {
            const fwd = ac.getForward(_f);
            for (const e of this.enemiesOf()) {
                if (e.isChute || !e.getForward) continue;
                const d = e.pos.distanceTo(ac.pos);
                if (d > 1200) continue;
                const toMe = _d.subVectors(ac.pos, e.pos).divideScalar(d);
                const behind = toMe.dot(fwd) > 0.2; // he's in our rear hemisphere
                if (behind && e.getForward(_p).dot(toMe) > 0.985 && Math.random() < lerp(0.25, 0.9, sk)) {
                    this.state = 'break';
                    this.stateT = rand(1.5, 2.8);
                    this.breakFrom = e;
                    break;
                }
            }
        }
    }

    update(dt) {
        const ac = this.ac;
        if (!ac.alive || ac.falling) return;
        const c = ac.controls;
        const g = this.game;
        const sk = this.skill;
        this.thinkT -= dt;
        this.stateT -= dt;
        this.missileCD -= dt;
        if (this.thinkT <= 0) this.think();

        if (this.waypoint) { this.flyRoute(dt); return; }
        ac.airbrake = false; // engage / strafe put it out when they want it

        const aggr = lerp(0.6, 1.0, sk);
        let wantDir = _t.set(0, 0, -1).applyQuaternion(ac.qv);
        let throttle = 0.85;
        let wantGuns = false;
        let gCap = lerp(0.72, 1, sk); // skill-limited G tolerance (share of the pull range)

        const FL = this.formation && this.formation.leader;
        if (FL && FL !== this.game.player) this.formation.leader = this.game.player; // follow whatever jet the player flies
        if (this.formation && !this.target && this.formation.leader && !this.formation.leader.onGround && this.formation.leader.alive) {
            // hold position off the leader's wing
            const L = this.formation.leader;
            _p.copy(this.formation.offset).applyQuaternion(L.qv).add(L.pos).addScaledVector(L.vel, 1.2);
            wantDir = _t.subVectors(_p, ac.pos);
            const dist = wantDir.length();
            wantDir.normalize();
            throttle = clamp(L.throttle + (dist - 20) * 0.004 - _a.subVectors(ac.vel, L.vel).dot(wantDir) * 0.01, 0, 1);
            if (dist < 60) wantDir.lerp(_d.set(0, 0, -1).applyQuaternion(L.qv), 1 - dist / 60).normalize();
        } else if (this.state === 'defend' && this.defendMissile && ac.incoming.includes(this.defendMissile)) {
            wantDir = this.defendAgainst(this.defendMissile, wantDir);
            throttle = 1;
            gCap = 1;
        } else if (this.state === 'break' && this.breakFrom && this.breakFrom.alive) {
            // guns defence: max-G turn toward the attacker's side, a little nose low to keep the speed up
            const e = this.breakFrom;
            const vhat = _f.copy(ac.vel).normalize();
            const side = _d.subVectors(e.pos, ac.pos).addScaledVector(vhat, -_d.subVectors(e.pos, ac.pos).dot(vhat));
            if (side.lengthSq() < 1) side.set(0, 1, 0).applyQuaternion(ac.qv);
            wantDir = _t.copy(side.normalize()).addScaledVector(vhat, 0.25).setY(_t.y - 0.15).normalize();
            throttle = 1;
            gCap = lerp(0.85, 1, sk);
        } else if (this.state === 'jink') {
            this.jinkT -= dt;
            if (this.jinkT <= 0) {
                this.jinkT = rand(0.5, 1.1);
                this.jinkDir.set(rand(-1, 1), rand(-0.5, 0.8), rand(-1, 1)).normalize();
            }
            wantDir = _t.copy(ac.getForward(_f)).addScaledVector(this.jinkDir, 1.8).normalize();
            throttle = 1;
        } else if (this.state === 'extend') {
            // run away from the nearest enemy, low and fast
            const t = this.target;
            if (t) wantDir = _t.subVectors(ac.pos, t.pos).setY(0).normalize().setY(-0.05).normalize();
            throttle = 1;
        } else if (this.target) {
            const r = this.target === g.pilotMode ? this.strafe(dt) : this.engage(dt);
            wantDir = r.dir; throttle = r.throttle; wantGuns = r.guns; gCap = Math.min(gCap, r.gCap);
        } else {
            // patrol: orbit the anchor
            const anchor = this.home || g.player?.pos || _p.set(0, 1500, 0);
            _p.copy(anchor);
            const rel = _d.subVectors(ac.pos, _p).setY(0);
            const tang = _a.set(-rel.z, 0, rel.x).normalize();
            wantDir = _t.copy(tang).addScaledVector(rel.normalize(), -0.4);
            wantDir.y = clamp((1600 - ac.pos.y) / 2000, -0.3, 0.3);
            wantDir.normalize();
            throttle = 0.7;
        }
        // flares against anything closing in, whatever else we're doing
        this.flares();

        // stay near the fight
        const centre = g.pilotMode?.alive ? g.pilotMode.pos : g.player?.pos;
        if (!this.leash && centre && ac.pos.distanceTo(centre) > 14000) {
            wantDir = _t.subVectors(centre, ac.pos).normalize();
        }

        steerToward(ac, wantDir, c, aggr);
        c.throttle = throttle;
        if (c.pitch > gCap) c.pitch = gCap;

        // avoid other aircraft (mid-air collisions)
        for (const o of g.aircraft) {
            if (o === ac || !o.alive) continue;
            const d = o.pos.distanceToSquared(ac.pos);
            if (d < 70 * 70) {
                _d.subVectors(ac.pos, o.pos).normalize();
                steerToward(ac, _d.add(ac.getForward(_f)).normalize(), c, 1);
            }
        }

        const minAGL = lerp(260, 120, sk);
        const gunRun = this.target && this.target === g.pilotMode && this.strafePhase === 'in' && this.target.pos.distanceTo(ac.pos) < 3500;
        if (avoidTerrain(ac, c, minAGL, gunRun)) { wantGuns = false; if (gunRun) this.strafePhase = 'out'; }

        if (wantGuns) {
            this.burstT -= dt;
            if (this.burstT > -0.6) g.weapons.fireGun(ac, g.time);
            if (this.burstT < -0.6 - (1 - sk)) this.burstT = rand(0.4, 1.2);
        } else if (this.burstT < 0) this.burstT = Math.min(this.burstT + dt, 0);
    }

    // Offensive BFM: pursuit geometry, energy, guns and missiles. Returns { dir, throttle, guns, gCap }.
    engage(dt) {
        const ac = this.ac, t = this.target, g = this.game, sk = this.skill;
        const V = Math.max(ac.speed, 1);
        const rel = _d.subVectors(t.pos, ac.pos);
        const dist = rel.length();
        const los = _p.copy(rel).divideScalar(Math.max(dist, 1));
        const vhat = _u.copy(ac.vel).divideScalar(V);
        const fwd = ac.getForward(_f);
        const ata = Math.acos(clamp(vhat.dot(los), -1, 1)); // target off our flight path
        const tv = t.vel || _zero;
        const closing = -_a.subVectors(tv, ac.vel).dot(los);
        const Vc = cornerSpeed(ac);
        let gCap = 1, guns = false;
        const dir = _t;

        if (dist > 2500) {
            // pure pursuit, a little high to keep energy
            dir.copy(t.pos).y += Math.min(150, dist * 0.05);
            dir.sub(ac.pos).normalize();
        } else {
            // where the rounds would meet the target (skill: how much of its turn is anticipated)
            const T = gunLead(ac, t, this.lead, lerp(0.3, 1, sk));
            _c.copy(this.lead);
            // aim error that shrinks with skill
            const wob = (1 - sk) * 26;
            this.aimWobble += dt;
            _c.x += Math.sin(this.aimWobble * 1.7) * wob;
            _c.y += Math.sin(this.aimWobble * 2.3 + 1) * wob;
            _c.z += Math.cos(this.aimWobble * 1.3) * wob;
            if (dist < 700 && closing > 90 && ata > 0.35) {
                // closing fast off to the side: lag pursuit (aim behind him) so we don't overshoot
                dir.copy(t.pos).addScaledVector(tv, -0.9).sub(ac.pos).normalize();
            } else {
                // lead pursuit, and put the nose (not the flight path) on the lead point: the rounds leave along
                // the nose, which sits above the path by the angle of attack
                dir.copy(_c).normalize();
                if (ata < 0.6) dir.sub(_b.copy(fwd).sub(vhat)).normalize();
            }
            // guns: fire when the predicted miss is inside the target (plus a skill-dependent slop)
            const miss = Math.acos(clamp(fwd.dot(_b.copy(_c).normalize()), -1, 1)) * _c.length();
            const range = lerp(700, 1150, sk);
            const tol = (t.hitRadius || 8) * lerp(2.0, 0.9, sk) + (1 - sk) * 8;
            if (ac.spec.gun && ac.ammo > 0 && miss < tol && dist < range && T < WEAPONS.bulletLife * 0.8) guns = true;
        }

        // prefer to fight with altitude in hand rather than on the deck
        const agl = ac.pos.y - groundAt(ac.pos.x, ac.pos.z);
        if (agl < 700 && dist > 600) { dir.y += (700 - agl) / 1400; dir.normalize(); }

        // energy: afterburner below corner speed or when chasing; don't pull the jet slow unless there's a shot
        let throttle = V < Vc * 1.05 || dist > 1500 ? 1 : 0.9;
        if (V < Vc * 0.7 && !guns) gCap = V < Vc * 0.5 ? 0.35 : 0.6;
        const closingFast = dist < 550 && closing > 60 && Math.acos(clamp(fwd.dot(los), -1, 1)) < 0.4;
        ac.airbrake = sk > 0.5 && (closingFast || (V > Vc * 1.5 && dist < 900 && ata > 0.5));
        if (closingFast) throttle = 0.4;
        else if (V > Vc * 1.35 && dist < 1200) throttle = 0.75;

        // missiles
        const boresightOff = Math.acos(clamp(fwd.dot(los), -1, 1));
        const maxPerTarget = t.isPlayer ? Math.max(1, Math.round(1 + g.difficulty.enemyMissileRate * 1.5)) : 3;
        if (ac.missiles > 0 && !t.isChute && boresightOff < 0.45 && dist > 500 && dist < WEAPONS.missile.range) {
            this.lockT += dt;
            t.lockedBy = t.lockedBy || new Set();
            t.lockedBy.add(ac);
            const need = WEAPONS.missile.lockTime * lerp(2.2, 1.1, sk);
            if (this.lockT > need && this.missileCD <= 0 && t.incoming.length < maxPerTarget) {
                const rate = ac.team === 'red' ? g.difficulty.enemyMissileRate : 0.8;
                if (Math.random() < rate) {
                    g.weapons.fireMissile(ac, t);
                    ac.missiles--;
                }
                this.missileCD = rand(6, 12) / Math.max(rate, 0.3);
                this.lockT = 0;
            }
        } else {
            this.lockT = Math.max(0, this.lockT - dt * 2);
            if (t.lockedBy) t.lockedBy.delete(ac);
        }
        // avoid ramming
        if (dist < 90 && closing > 0) {
            dir.copy(fwd).addScaledVector(_a.set(0, 1, 0).applyQuaternion(ac.qv), 1.5).normalize();
            guns = false;
        }
        return { dir, throttle, guns, gCap };
    }

    // Gun runs on a slow target near the ground (the ejected player, under the canopy or on foot): extend out
    // and up, turn in, dive on it firing short aimed bursts, and pull off with room to spare above the ground
    // and the rooftops. Returns { dir, throttle, guns, gCap }.
    strafe(dt) {
        const ac = this.ac, t = this.target, sk = this.skill;
        const V = Math.max(ac.speed, 1);
        // the target's velocity from its track (a seat's own velocity isn't kept up to date on the ground)
        if (!this.tgt || this.tgt.of !== t) this.tgt = { of: t, prev: t.pos.clone(), vel: new THREE.Vector3(), pos: new THREE.Vector3(), hitRadius: 2 };
        const tr = this.tgt;
        if (dt > 0) tr.vel.lerp(_a.subVectors(t.pos, tr.prev).divideScalar(dt), 1 - Math.exp(-2 * dt));
        tr.prev.copy(t.pos);
        if (t.headPos) t.headPos(tr.pos); else tr.pos.copy(t.pos); // aim for the man, not his boots
        const rel = _d.subVectors(t.pos, ac.pos);
        const dist = rel.length(), dh = Math.hypot(rel.x, rel.z);
        const los = _p.copy(rel).divideScalar(Math.max(dist, 1));
        const vhat = _u.copy(ac.vel).divideScalar(V);
        const fwd = ac.getForward(_f);
        const ata = Math.acos(clamp(vhat.dot(los), -1, 1));
        const gT = groundAt(t.pos.x, t.pos.z);
        const bl = buildingsOf(ac);
        // in a town, mind the rooftops around him (looked up now and then: the pilot doesn't move far)
        if (!tr.roofsT || this.game.time - tr.roofsT > 3) { tr.roofsT = this.game.time; tr.roofs = bl && Math.abs(t.pos.y - gT) < 60 ? roofsNear(bl, t.pos.x, t.pos.z, gT, 400) : 0; }
        const roofs = tr.roofs;
        const onGround = t.pos.y - gT < 30;
        // on the ground: dive in from high (steeper pass, rounds land closer together); a chute: a flatter pass
        const runAlt = Math.max(t.pos.y, gT) + (onGround ? lerp(850, 650, sk) : lerp(350, 220, sk)) + roofs * 0.5;
        const dir = _t;
        let guns = false, throttle = 1;
        if (!this.strafePhase) this.strafePhase = dh < 1800 ? 'out' : 'turn';
        const holdAlt = Math.max(runAlt, groundAt(ac.pos.x, ac.pos.z) + 300);
        if (this.strafePhase === 'out' || this.strafePhase === 'turn') {
            // extend away climbing to the run-in height, then come round level toward him; dive when lined up
            const away = this.strafePhase === 'out';
            dir.set(away ? -rel.x : rel.x, 0, away ? -rel.z : rel.z).normalize();
            const gam = clamp((holdAlt - ac.pos.y) / (V * 5), -0.1, 0.4);
            dir.multiplyScalar(Math.cos(gam)).setY(Math.sin(gam));
            if (away && dh > (onGround ? 2500 : 2800) && ac.pos.y > holdAlt - 150) this.strafePhase = 'turn';
            const hAta = Math.acos(clamp((vhat.x * rel.x + vhat.z * rel.z) / Math.max(Math.hypot(vhat.x, vhat.z) * dh, 1e-6), -1, 1));
            if (!away && hAta < 0.3) this.strafePhase = dh > 1200 ? 'in' : 'out';
        } else {
            // run in: nose on the lead point (slow target: its drift plus the rounds' drop)
            gunLead(ac, tr, this.lead, 0);
            _c.copy(this.lead);
            const wob = (1 - sk) * 10;
            this.aimWobble += dt;
            _c.x += Math.sin(this.aimWobble * 1.7) * wob;
            _c.z += Math.cos(this.aimWobble * 1.3) * wob;
            dir.copy(_c).normalize();
            if (ata < 0.6) dir.sub(_b.copy(fwd).sub(vhat)).normalize();
            // slow down for a longer firing pass
            throttle = V > cornerSpeed(ac) * 0.8 ? 0.4 : 0.8;
            ac.airbrake = V > cornerSpeed(ac) * 1.05;
            const miss = Math.acos(clamp(fwd.dot(_b.copy(_c).normalize()), -1, 1)) * _c.length();
            if (ac.ammo > 0 && dist < (onGround ? 1100 : 1200) && miss < (onGround ? 5 : 3) + (1 - sk) * 7) guns = true;
            // pull off: close in, overshot, or the dive needs the room that's left to recover above the ground/roofs
            const gam = Math.asin(clamp(ac.vel.y / V, -1, 1));
            const n = Math.max(1.5, gAvail(ac) * 0.8);
            const hPull = gam < 0 ? V * V * (1 - Math.cos(gam)) / (G * (n - 1)) + V * 0.6 * -Math.sin(gam) : 0;
            const agl = ac.pos.y - groundAt(ac.pos.x, ac.pos.z);
            if (dist < Math.max(300, V * 1.2) || ata > 1.4 || agl < hPull + 70 + roofs) { this.strafePhase = 'out'; ac.airbrake = false; }
        }
        return { dir, throttle, guns, gCap: 1 };
    }

    // Missile defence: beam it (turn to put it at 90°, a little nose low), then a max-G break across its path
    // in the last couple of seconds. Returns the direction to fly.
    defendAgainst(m, out) {
        const ac = this.ac, sk = this.skill;
        const tti = this.timeToImpact(m);
        const los = _d.subVectors(ac.pos, m.pos).setY(0);
        if (los.lengthSq() < 1) los.set(1, 0, 0);
        los.normalize();
        const perp = _p.set(-los.z, 0, los.x);
        const fwd = ac.getForward(_f);
        if (perp.dot(fwd) < 0) perp.negate();
        const agl = ac.pos.y - groundAt(ac.pos.x, ac.pos.z);
        const down = agl > 1500 ? 0.3 : agl > 600 ? 0.15 : 0;
        if (tti < lerp(1.3, 2.3, sk)) {
            // break: pull hard across the missile's line of sight (toward it a little, to spike the LOS rate)
            out.copy(perp).addScaledVector(los, -0.35).setY(-down * 0.5).normalize();
        } else out.copy(perp).setY(-down).normalize();
        return out;
    }

    // Flares: one salvo per missile, timed for the last couple of seconds (rookies often miss the launch
    // altogether). Transports and bombers use them too. With weapons.js's per-flare odds this decoys roughly
    // 15% (rookie) / 23% (veteran) / 34% (ace) of heat seekers.
    flares() {
        const ac = this.ac, g = this.game, sk = this.skill;
        if (ac.flares <= 0 || !ac.incoming.length) return;
        for (const m of ac.incoming) {
            if (!m.W || m.W.radar || m.kind === 'sam') continue; // flares only fool heat seekers
            m.flaredBy = m.flaredBy || new Map();
            const st = m.flaredBy.get(ac) || 0; // salvos dropped (or passed up) for this missile
            if (st >= 1) continue;
            // noticed it? (rookies sometimes never do)
            if (st === 0 && m.noticedBy?.get(ac) === undefined) {
                m.noticedBy = m.noticedBy || new Map();
                m.noticedBy.set(ac, Math.random() < lerp(0.5, 0.95, sk));
            }
            if (!m.noticedBy.get(ac)) continue;
            const tti = this.timeToImpact(m);
            if (tti < lerp(1.3, 2.0, sk)) {
                g.weapons.dropFlares(ac, g.time);
                m.flaredBy.set(ac, st + 1);
            }
        }
    }

    // Transports / bombers: fly the route, hold the route altitude, then circle the waypoint.
    flyRoute(dt) {
        const ac = this.ac, c = ac.controls;
        void dt;
        const wp = this.waypoint, R = 1600; // (missions count on the circle staying within ~2.5 km of the waypoint)
        const dx = ac.pos.x - wp.x, dz = ac.pos.z - wp.z, r = Math.hypot(dx, dz);
        let wantDir;
        if (r < R * 1.5) {
            // once there, circle the waypoint (no hard reversals over the field)
            if (!this.orbitDir) this.orbitDir = (ac.vel.x * dz - ac.vel.z * dx) > 0 ? 1 : -1;
            const k = clamp((r - R) / R, -0.7, 0.7); // pull in when wide, push out when tight
            wantDir = _t.set(this.orbitDir * -dz / r - k * dx / r, 0, this.orbitDir * dx / r - k * dz / r).normalize();
        } else wantDir = _t.set(-dx, 0, -dz).normalize();
        // hold the route altitude (never below 350 m over the terrain): climb/descent angle from the height
        // error, sized so the path closes it over ~8 s without overshooting
        const floor = Math.max(wp.y, groundAt(ac.pos.x, ac.pos.z) + 350);
        const err = floor - ac.pos.y;
        const gamma = clamp(err / (Math.max(ac.speed, 40) * 8), -0.1, 0.15);
        wantDir.multiplyScalar(Math.cos(gamma)).setY(Math.sin(gamma));
        steerToward(ac, wantDir, c, 0.6);
        // cruise power, more when well below the route; circling, slow down to what the circle allows at a
        // sedate bank (a transport can't fly a 1.6 km circle at cruise speed)
        let cruise = this.cruise ?? 0.75;
        if (r < R * 1.5) {
            const vCircle = Math.sqrt(R * G * Math.tan(defaultMaxBank(ac) || 1.0) / 1.15);
            cruise = clamp(cruise + (vCircle - ac.speed) * 0.02, 0.2, 1);
        }
        c.throttle = clamp(cruise + clamp(err / 400, -0.15, 0.3), 0.2, 1);
        this.flares();
        avoidTerrain(ac, c, 300);
    }
}
