// ═══════════════════════════════════════════════════════════════
// Autopilot: automatic takeoff (runway or catapult) and automatic landing on
// the nearest friendly runway or the (moving) home carrier.
// Flies the player's jet through the same controls the player would use.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { steerToward, avoidTerrain, defaultMaxBank, climbGradient } from './ai.js';
import { refSpeeds } from './aircraft.js';
import { BASES, terrainHeight, runwayInfo } from './world.js';
import { clamp, DEG } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const GLIDE = 3.5 * DEG;
export const GLIDE_SLOPE = GLIDE;
const MAX_DESCENT = Math.tan(8 * DEG); // steepest descent to a waypoint (idle, speed brake)
const MAX_FINAL_DESCENT = Math.tan(14 * DEG); // steepest catch-up dive onto the glide slope

// Landing direction and touchdown point for a runway (picks the end with clearer approach terrain)
export function runwayApproach(base, rwIndex = 0) {
    let best = null;
    const R = runwayInfo(base, base.runways[rwIndex] || base.runways[0]);
    for (const dir of [1, -1]) {
        const fwd = new THREE.Vector3(R.dirX * dir, 0, R.dirZ * dir);
        const thr = new THREE.Vector3(R.x, base.h, R.z).addScaledVector(fwd, -R.half);
        // how far out the glide slope stays clear of terrain (with a margin), and the worst intrusion
        let worst = -Infinity, clearDist = 9000;
        for (let d = 100; d <= 9000; d += 100) {
            const x = thr.x - fwd.x * d, z = thr.z - fwd.z * d;
            const glideH = d * Math.tan(GLIDE);
            const over = terrainHeight(x, z) - (base.h + glideH);
            // margin grows with height: near the threshold the glide path is only metres above the ground
            if (over > -Math.min(35, glideH * 0.5) && clearDist === 9000) clearDist = d - 100;
            worst = Math.max(worst, over * (d <= 6000 ? 1 : 0.3));
        }
        const score = worst - clearDist * 0.01;
        if (!best || score < best.score) best = { score, fwd, thr, clearDist };
    }
    return { fwd: best.fwd, touch: best.thr.clone().addScaledVector(best.fwd, 400), clearDist: best.clearDist };
}

export class Autopilot {
    constructor(game) {
        this.game = game;
        this.active = null; // 'takeoff' | 'land'
        this.phase = '';
        this.status = '';
    }

    disengage(msg) {
        if (!this.active) return;
        this.active = null;
        this.phase = '';
        this.status = '';
        const p = this.game.player;
        if (p) this.game.aimDir.copy(p.vel.lengthSq() > 1 ? p.vel : p.getForward(_v)).normalize();
        if (msg) this.game.addFeed(msg, '#5dffa0');
    }

    // ── Engage ──
    takeoff() {
        const p = this.game.player;
        if (!p.onGround) { this.game.addFeed('AUTO-TAKEOFF: ONLY ON THE GROUND', '#ffc23f'); return; }
        if (p.bellied) return;
        this.active = 'takeoff';
        this.phase = 'roll';
        this.heading = p.deck ? null : Math.atan2(-p.getForward(_v).x, -p.getForward(_v).z);
        this.climbHeading = null;
        this.game.addFeed('AUTOPILOT: TAKEOFF', '#5dffa0');
    }

    land() {
        const g = this.game, p = g.player;
        if (p.onGround) { this.game.addFeed('ALREADY ON THE GROUND', '#ffc23f'); return; }
        // nearest friendly landing spot: any friendly airfield, or the home carrier
        const home = BASES.filter(b => b.friendly).sort((a, b) => Math.hypot(p.pos.x - a.x, p.pos.z - a.z) - Math.hypot(p.pos.x - b.x, p.pos.z - b.z))[0];
        const cv = g.naval.homeCarrier && g.naval.homeCarrier.alive ? g.naval.homeCarrier : null;
        const dRunway = Math.hypot(p.pos.x - home.x, p.pos.z - home.z);
        const dCarrier = cv ? cv.pos.distanceTo(p.pos) : Infinity;
        this.target = dCarrier < dRunway ? { kind: 'carrier', ship: cv } : { kind: 'runway', base: home };
        if (this.target.kind === 'runway') this.pickRunwayEnd(home, refSpeeds(p.spec).approach);
        this.active = 'land';
        this.phase = 'transit';
        this.leg = null;
        // already lined up on final (and not far too high for it)? then just keep flying the approach
        const t = this.geometry();
        const rel = _v.subVectors(p.pos, t.touch);
        const along = -rel.dot(t.fwd), lateral = rel.x * t.fwd.z - rel.z * t.fwd.x;
        const high = p.pos.y - (t.touch.y + along * Math.tan(GLIDE));
        if (along > 300 && along < (t.fixDist || 9000) + 2000 && Math.abs(lateral) < 500 && _v2.copy(p.vel).normalize().dot(t.fwd) > 0.85 && high < along * MAX_FINAL_DESCENT + 100) this.phase = 'final';
        g.addFeed('AUTOPILOT: LANDING AT ' + (this.target.kind === 'carrier' ? 'CARRIER ' + cv.name : home.name || 'HOME AIRBASE'), '#5dffa0');
    }

    // Use whichever runway direction has the lower terrain under its approach
    pickRunwayEnd(base, app = 70) {
        const a = runwayApproach(base);
        this.target.fwd = a.fwd;
        this.target.touch = a.touch;
        this.target.clearDist = a.clearDist; // how far out the glide slope stays clear of the hills
        // approach fix about 80 s of final out (a Cessna: 2 km, an F-16: 5 km, a 747: 6.5 km), but inside any hills that
        // poke up near the glide slope
        const tan = Math.tan(GLIDE);
        const Dmax = clamp(Math.round(app * 80 / 500) * 500, 2000, 9000), Dmin = Math.min(4000, Dmax);
        let D = Dmin;
        for (let d0 = Dmax; d0 >= Dmin; d0 -= 500) {
            let ok = true;
            for (let d = 500; d <= d0 + 1500 && ok; d += 250) {
                const x = a.touch.x - a.fwd.x * d, z = a.touch.z - a.fwd.z * d;
                if (terrainHeight(x, z) > a.touch.y + d * tan - 80) ok = false;
            }
            if (ok) { D = d0; break; }
        }
        this.target.fixDist = D;
        // past the touchdown point, how far it may still float before going around (half the runway left to stop)
        const rw = base.runways[0];
        this.target.goAround = clamp((rw.len - 400) * 0.45, 400, 1400);
    }

    // Touchdown point & landing direction (the carrier moves, so recompute each frame)
    geometry() {
        const t = this.target;
        if (t.kind === 'carrier') {
            const s = t.ship;
            t.fwd = _v3.set(-Math.sin(s.heading), 0, -Math.cos(s.heading)).clone();
            t.touch = s.toWorld(-4, s.deckY, s.def.L * 0.4);
        }
        return t;
    }

    // highest ground within r of a point (coarse)
    terrainMax(c, r) {
        let h = 0;
        for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) h = Math.max(h, terrainHeight(c.x + i * r / 2, c.z + j * r / 2));
        return h;
    }

    // ── Per-frame (called from updatePlayer; overrides the stick) ──
    update(dt, p) {
        if (!this.active) return;
        if (!p.alive) { this.disengage(); return; }
        const c = p.controls;
        const rs = refSpeeds(p.spec);
        if (this.active === 'takeoff') return this.flyTakeoff(dt, p, c, rs);
        return this.flyLanding(dt, p, c, rs);
    }

    flyTakeoff(dt, p, c, rs) {
        const g = this.game;
        c.yaw = 0; c.roll = 0; c.pitch = 0;
        if (p.onGround) {
            p.airbrake = false;
            g.input.spoilersOn = false;
            p.flaps = Math.max(p.flaps, 1);
            c.throttle = p.deck ? 1 : 0.9;
            if (!p.deck && this.heading != null) {
                // hold the runway heading with the nose wheel
                const f = p.getForward(_v);
                let err = Math.atan2(-f.x, -f.z) - this.heading;
                err = Math.atan2(Math.sin(err), Math.cos(err));
                c.roll = clamp(err * 4, -1, 1);
            }
            if (p.relSpeed > rs.takeoff) c.pitch = 0.7;
            this.status = 'TAKEOFF ROLL ' + Math.round(p.relSpeed * 1.944) + ' / ' + Math.round(rs.takeoff * 1.944) + ' KT';
            return;
        }
        const agl = p.pos.y - Math.max(terrainHeight(p.pos.x, p.pos.z), 0);
        // climb out on the heading we rolled on (off a deck: the heading at launch), wings level
        if (this.climbHeading == null) this.climbHeading = this.heading ?? Math.atan2(-p.vel.x, -p.vel.z);
        // climb gradient from the speed margin, so heavies don't hang on the stall right after liftoff
        const climb = clamp((p.speed / rs.takeoff - 1) * 0.8, 0.03, 0.2);
        _v2.set(-Math.sin(this.climbHeading), climb, -Math.cos(this.climbHeading)).normalize();
        steerToward(p, _v2, c, 1, true);
        c.throttle = p.hasAB ? 0.9 : 1;
        if (agl > 40 && p.gear) { p.gear = false; g.addFeed('GEAR UP', '#5dffa0'); }
        if (agl > 250 && p.flaps) p.flaps = 0;
        this.status = 'CLIMBING ' + Math.round(agl * 3.28) + ' FT';
        if (agl > 500) this.disengage('AUTOPILOT OFF — YOU HAVE CONTROL');
    }

    flyLanding(dt, p, c, rs) {
        const g = this.game, t = this.geometry();
        const fwd = t.fwd, touch = t.touch;
        if (t.kind === 'carrier' && (!t.ship.alive)) { this.disengage('CARRIER LOST — AUTOPILOT OFF'); return; }
        const shipVel = t.kind === 'carrier' ? t.ship.vel : _v3.set(0, 0, 0);
        // along-track distance to touchdown (positive = before it), and lateral offset
        const rel = _v.subVectors(p.pos, touch);
        const along = -rel.dot(fwd);
        const lateral = rel.x * fwd.z - rel.z * fwd.x;
        const app = rs.approach;

        if (p.onGround && t.kind === 'carrier' && !p.trap && p.relSpeed > 35) {
            // missed the wires: bolter — full power and fly off the angled deck
            this.phase = 'bolter';
            c.throttle = 1; c.pitch = 0.4; c.roll = 0; c.yaw = 0;
            p.airbrake = false; g.input.spoilersOn = false;
            this.status = 'BOLTER — FULL POWER';
            return;
        }
        if (this.phase === 'bolter' && !p.onGround) { this.phase = 'transit'; g.addFeed('BOLTER — GOING AROUND', '#ffc23f'); }
        if (p.onGround) {
            this.phase = 'rollout';
            c.throttle = 0; c.pitch = 0; c.yaw = 0;
            p.airbrake = true;
            const f = p.getForward(_v2);
            let err = Math.atan2(-f.x, -f.z) - Math.atan2(-fwd.x, -fwd.z);
            err = Math.atan2(Math.sin(err), Math.cos(err));
            c.roll = clamp(err * 4 + lateral * 0.01, -1, 1);
            this.status = 'ROLLOUT ' + Math.round(p.relSpeed * 1.944) + ' KT';
            if (p.relSpeed < 2) { p.airbrake = false; g.input.spoilersOn = false; this.disengage('LANDED — AUTOPILOT OFF'); }
            return;
        }

        const bankCap = defaultMaxBank(p) ?? 1.0; // airliners and light aircraft turn gently, jets up to ~57°
        if (this.phase === 'transit') {
            // fly to the approach fix on the extended centreline (about 80 s of final out) — arriving pointed
            // at the runway. From anywhere outside the 45° cone behind the fix (or heading away), first go to an
            // outer corner further out and off to one side of the centreline, then turn in to the fix.
            const inbound = _v3.copy(p.vel).setY(0).normalize().dot(fwd);
            const D = t.fixDist || 9000;
            // (the corner stays inside the stretch of approach that's clear of hills)
            const outX = clamp(Math.min(app * 55, (t.clearDist || 9000) - D), 1500, 5000), outY = clamp(app * 45, 1200, 4000);
            // the fix sits on the glide slope (pickRunwayEnd keeps the centreline under it clear); the corner on
            // the same slope further out, above the local hills, on whichever side has the lower ground
            const fixY = touch.y + D * Math.tan(GLIDE);
            const corner = (sgn, out) => out.copy(touch).addScaledVector(fwd, -(D + outX)).add(_v3.set(fwd.z, 0, -fwd.x).multiplyScalar(sgn * outY));
            if (!this.leg) {
                this.leg = along > D + 1000 && Math.abs(lateral) < along - D && inbound > 0 ? 'fix' : 'outer';
                const mine = lateral < 0 ? -1 : 1;
                const hMine = this.terrainMax(corner(mine, _v2), 600), hOther = this.terrainMax(corner(-mine, _v2), 600);
                this.outerSide = hOther < hMine - 150 ? -mine : mine;
            }
            const outer = this.leg === 'outer' || (this.leg === 'descend' && this.prevLeg === 'outer');
            // inbound from the corner, aim at the centreline a turn radius ahead of us (not at the fix itself), so a
            // wide-turning heavy intercepts it instead of overshooting the fix and going round again
            const Rturn = p.speed * p.speed / (9.81 * Math.tan(bankCap));
            const Di = clamp(Math.min(D, along - Rturn), 1200, D);
            const wp = outer ? corner(this.outerSide || 1, _v2) : _v2.copy(touch).addScaledVector(fwd, -Di);
            wp.y = outer ? Math.max(fixY + outX * Math.tan(GLIDE), this.terrainMax(wp, 600) + 250) : touch.y + Di * Math.tan(GLIDE);
            const to = _v3.subVectors(wp, p.pos);
            const d = Math.hypot(to.x, to.z);
            const excess = -to.y; // height above this leg's waypoint
            // far too high to get down to it (≤ 8°) on the way: circle down where we are first — only over low
            // ground — then carry on with the same leg
            const floorHere = this.terrainMax(p.pos, 800 + p.speed * p.speed / (9.81 * 0.84)) + 300;
            if (this.leg !== 'descend' && excess > 300 && excess > d * MAX_DESCENT + 200 && p.pos.y > floorHere + 200) {
                this.prevLeg = this.leg; this.leg = 'descend'; this.circle = lateral < 0 ? 1 : -1;
            }
            if (this.leg === 'descend') {
                // a descending turn at ~12°, about twice the approach speed (power, then speed brake)
                const vh = Math.hypot(p.vel.x, p.vel.z) || 1;
                const a = this.circle * 0.35, ca = Math.cos(a), sa = Math.sin(a);
                const hx = p.vel.x / vh, hz = p.vel.z / vh;
                const dsc = 12 * DEG;
                _v.set((hx * ca - hz * sa) * Math.cos(dsc), -Math.sin(dsc), (hx * sa + hz * ca) * Math.cos(dsc));
                steerToward(p, _v, c, 0.8, true, bankCap);
                c.throttle = clamp(0.3 + (app * 2 - p.speed) * 0.05, 0, 0.9);
                p.airbrake = p.speed > app * 2.3;
                this.status = 'DESCENDING ' + Math.round(excess * 3.28) + ' FT HIGH';
                if (excess < d * MAX_DESCENT + 50 || p.pos.y < floorHere) { this.leg = this.prevLeg || null; p.airbrake = false; }
                if (avoidTerrain(p, c, 150)) { this.leg = this.prevLeg || null; this.status = 'TERRAIN — CLIMBING'; }
                return;
            }
            // climbs as steep as the type manages comfortably (8.5° at most), descents up to 8° (power off and the
            // speed brake when steep)
            to.y = clamp(to.y, -MAX_DESCENT * d, Math.min(0.15, climbGradient(p) * 0.6) * d);
            if (g.time - (this.terrainT ?? -99) < 8) to.y = Math.max(to.y, 0); // just climbed away from a hill: don't sink back onto it
            steerToward(p, to.normalize(), c, 0.8, true, bankCap);
            const steep = to.y < -0.05;
            c.throttle = clamp(0.6 + (app * 1.7 - p.speed) * 0.03 - (steep ? 0.3 : 0), 0.05, p.hasAB ? 0.9 : 1);
            p.airbrake = steep && p.speed > app * 2;
            if (d < 7000 && !p.gear) p.gear = true;
            if (avoidTerrain(p, c, 120)) { this.terrainT = g.time; this.status = 'TERRAIN — CLIMBING'; return; }
            this.status = (outer ? 'TO OUTER FIX ' : 'TO APPROACH FIX ') + (d / 1000).toFixed(1) + ' KM';
            const makeable = p.pos.y - (touch.y + along * Math.tan(GLIDE)) < along * MAX_FINAL_DESCENT + 100; // not too high for final
            const aligned = along > 600 && along < D + 2000 && Math.abs(lateral) < 700 && _v.copy(p.vel).normalize().dot(fwd) > 0.8 && makeable;
            if (outer && d < Math.max(2000, Rturn)) this.leg = 'fix';
            else if (this.leg === 'fix' && d < 1800 && inbound <= 0) this.leg = 'outer'; // at the fix pointing the wrong way: go round again
            else if (this.leg === 'fix' && d < 1800 && inbound > 0.5 && makeable) this.phase = 'final';
            if (aligned) { this.phase = 'final'; p.airbrake = false; }
            return;
        }

        // final approach: centreline + glide slope, configured and on speed
        if (along < 9000 && !p.gear) p.gear = true;
        if (along < 7000 && t.kind === 'carrier' && !p.hook) p.hook = true;
        if (along < 6000 && p.speed < 175) p.flaps = 2;
        g.input.spoilersOn = false;
        p.airbrake = p.speed > app * 1.25;
        const glideAlt = touch.y + Math.max(along, 0) * Math.tan(GLIDE);
        const hAbove = p.pos.y - p.gearOffset - touch.y;
        // far too high to make it down the glide slope: circle down first
        if (along > 1500 && p.pos.y - glideAlt > along * MAX_FINAL_DESCENT + 250) {
            this.phase = 'transit'; this.leg = null; g.addFeed('TOO HIGH — DESCENDING', '#ffc23f');
            return;
        }
        // aim at a point ahead on the centreline at the glide-slope height (lead a moving deck)
        const look = Math.max(700, Math.min(1600, along * 0.5));
        const aim = _v2.copy(touch).addScaledVector(fwd, -(along - look)).addScaledVector(shipVel, look / Math.max(p.speed, 50));
        aim.y = touch.y + Math.max(along - look, 0) * Math.tan(GLIDE) + p.gearOffset;
        // pull back onto the glide slope when low or high
        aim.y += clamp((glideAlt + p.gearOffset - p.pos.y) * 5, -Math.max(150, (p.pos.y - glideAlt) * 1.2), 200);
        // never let the glide-slope chase take us into a hill short of the field (the margin shrinks toward the
        // threshold, where the glide slope itself is only tens of metres up)
        if (along > 1500) {
            let hT = 0;
            for (const k of [2, 5, 9]) { const x = p.pos.x + p.vel.x * k, z = p.pos.z + p.vel.z * k; hT = Math.max(hT, terrainHeight(x, z)); }
            aim.y = Math.max(aim.y, hT + clamp((along - 500) * Math.tan(GLIDE) * 0.6, 40, 150));
        }
        let dir = aim.sub(p.pos).normalize();
        // flare: from a height that gives the jet time to answer (heavies start higher), bleed the sink rate off
        // in proportion to the height left — aiming a little below the runway so it arrives at ~1 m/s instead of
        // floating down the runway
        const vsGlide = Math.max(p.speed, 40) * Math.tan(GLIDE);
        const tFlare = 1.4 + 2 * (p.pitchTau || 0.15) / 0.24; // s: time constant of the flare (plus the path's lag)
        const hBias = tFlare * 0.9;
        if (t.kind === 'runway' && hAbove < clamp(vsGlide * tFlare - hBias, 4, 30) && along < 1500) {
            this.phase = 'flare';
            dir = _v2.copy(fwd).addScaledVector(shipVel, 1 / Math.max(p.speed, 50));
            dir.y = -((Math.max(hAbove, 0) + hBias) / tFlare) / Math.max(p.speed, 40);
            dir.normalize();
        }
        steerToward(p, dir, c, 1, true, 0.5);
        // don't float nose-high into a tail strike (the touchdown limit is 20°)
        if (this.phase === 'flare' && p.getForward(_v3).y > Math.sin(14 * DEG)) c.pitch = Math.min(c.pitch, -0.15);
        c.yaw = clamp(c.yaw, -0.4, 0.4);
        if (along > 2500 && avoidTerrain(p, c, 60)) { c.throttle = 0.9; this.status = 'TERRAIN — CLIMBING'; return; }
        const relSpeed = _v3.subVectors(p.vel, shipVel).length();
        // in the flare keep a little power (don't let it sink onto its belly) until the wheels are nearly down
        // (no afterburner: full power is fair game; draggy heavies need it to hold the speed through the flare)
        const maxThr = p.hasAB ? 0.9 : 1;
        if (this.phase === 'flare') c.throttle = hAbove < 1.5 ? 0 : clamp(0.45 + (app - relSpeed) * 0.06, 0.12, maxThr);
        else c.throttle = clamp(0.45 + (app - relSpeed) * 0.06, 0, maxThr);
        if (this.phase === 'flare') p.gear = true;
        const dev = Math.round((p.pos.y - glideAlt - p.gearOffset) * 3.28);
        this.status = (this.phase === 'flare' ? 'FLARE' : 'FINAL') + ' ' + (along / 1000).toFixed(1) + ' KM · ' + Math.abs(dev) + ' FT ' + (dev >= 0 ? 'HIGH' : 'LOW');
        // went around / overshot badly (floated past the point where it could still stop on the runway) → try again
        if (along < -(t.kind === 'runway' ? t.goAround || 400 : 400)) { this.phase = 'transit'; this.leg = null; g.addFeed('GO AROUND', '#ffc23f'); p.gear = true; }
    }
}
