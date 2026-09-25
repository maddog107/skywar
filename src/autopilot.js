// ═══════════════════════════════════════════════════════════════
// Autopilot: automatic takeoff (runway or catapult) and automatic landing on
// the nearest friendly runway or the (moving) home carrier.
// Flies the player's jet through the same controls the player would use.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { steerToward, avoidTerrain } from './ai.js';
import { refSpeeds } from './aircraft.js';
import { BASES, terrainHeight, runwayInfo } from './world.js';
import { clamp, DEG } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const GLIDE = 3.5 * DEG;
export const GLIDE_SLOPE = GLIDE;

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
        if (this.target.kind === 'runway') this.pickRunwayEnd(home);
        this.active = 'land';
        this.phase = 'transit';
        this.leg = null;
        // already lined up on final? then just keep flying the approach
        const t = this.geometry();
        const rel = _v.subVectors(p.pos, t.touch);
        const along = -rel.dot(t.fwd), lateral = rel.x * t.fwd.z - rel.z * t.fwd.x;
        if (along > 300 && along < (t.fixDist || 9000) + 2000 && Math.abs(lateral) < 500 && _v2.copy(p.vel).normalize().dot(t.fwd) > 0.85) this.phase = 'final';
        g.addFeed('AUTOPILOT: LANDING AT ' + (this.target.kind === 'carrier' ? 'CARRIER ' + cv.name : home.name || 'HOME AIRBASE'), '#5dffa0');
    }

    // Use whichever runway direction has the lower terrain under its approach
    pickRunwayEnd(base) {
        const a = runwayApproach(base);
        this.target.fwd = a.fwd;
        this.target.touch = a.touch;
        // approach fix as far out as 9 km, but inside any hills that poke up near the glide slope
        const tan = Math.tan(GLIDE);
        let D = 4000;
        for (let d0 = 9000; d0 >= 4000; d0 -= 500) {
            let ok = true;
            for (let d = 500; d <= d0 + 1500 && ok; d += 250) {
                const x = a.touch.x - a.fwd.x * d, z = a.touch.z - a.fwd.z * d;
                if (terrainHeight(x, z) > a.touch.y + d * tan - 80) ok = false;
            }
            if (ok) { D = d0; break; }
        }
        this.target.fixDist = D;
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

        if (this.phase === 'transit') {
            // fly to the approach fix 9 km out on the extended centreline — arriving pointed at the runway.
            // From anywhere outside the 45° cone behind the fix (or heading away), first go to an outer
            // corner 14 km out and 4 km to our side of the centreline, then turn in to the fix.
            const inbound = _v3.copy(p.vel).setY(0).normalize().dot(fwd);
            const D = t.fixDist || 9000;
            if (!this.leg) this.leg = along > D + 1000 && Math.abs(lateral) < along - D && inbound > 0 ? 'fix' : 'outer';
            const wp = _v2.copy(touch).addScaledVector(fwd, -(this.leg === 'outer' ? D + 5000 : D));
            if (this.leg === 'outer') wp.add(_v3.set(fwd.z, 0, -fwd.x).multiplyScalar((lateral < 0 ? -1 : 1) * 4000));
            wp.y = touch.y + D * Math.tan(GLIDE) + (this.leg === 'outer' ? 250 : 0);
            wp.y = Math.max(wp.y, this.terrainMax(wp, 1500) + (this.leg === 'outer' ? 400 : 250));
            const to = _v3.subVectors(wp, p.pos);
            const d = Math.hypot(to.x, to.z);
            // shallow climbs and descents only (a dive at the fix leaves no room to turn in)
            to.y = clamp(to.y, -0.08 * d, 0.15 * d);
            steerToward(p, to.normalize(), c, 0.8, true);
            c.throttle = clamp(0.6 + (app * 1.7 - p.speed) * 0.03, 0.2, 0.9);
            if (d < 7000 && !p.gear) p.gear = true;
            if (avoidTerrain(p, c, 120)) { this.status = 'TERRAIN — CLIMBING'; return; }
            this.status = (this.leg === 'outer' ? 'TO OUTER FIX ' : 'TO APPROACH FIX ') + (d / 1000).toFixed(1) + ' KM';
            const aligned = along > 600 && along < D + 2000 && Math.abs(lateral) < 700 && _v.copy(p.vel).normalize().dot(fwd) > 0.8;
            if (this.leg === 'outer' && d < 2000) this.leg = 'fix';
            else if (this.leg === 'fix' && d < 1800) {
                if (inbound > 0.5) this.phase = 'final';
                else this.leg = 'outer'; // passed the fix pointing the wrong way: go round again
            }
            if (aligned) this.phase = 'final';
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
        // aim at a point ahead on the centreline at the glide-slope height (lead a moving deck)
        const look = Math.max(700, Math.min(1600, along * 0.5));
        const aim = _v2.copy(touch).addScaledVector(fwd, -(along - look)).addScaledVector(shipVel, look / Math.max(p.speed, 50));
        aim.y = touch.y + Math.max(along - look, 0) * Math.tan(GLIDE) + p.gearOffset;
        // pull back onto the glide slope when low or high
        aim.y += clamp((glideAlt + p.gearOffset - p.pos.y) * 5, -150, 200);
        // never let the glide-slope chase take us into a hill short of the field
        if (along > 1500) {
            let hT = 0;
            for (const k of [2, 5, 9]) { const x = p.pos.x + p.vel.x * k, z = p.pos.z + p.vel.z * k; hT = Math.max(hT, terrainHeight(x, z)); }
            aim.y = Math.max(aim.y, hT + 150);
        }
        let dir = aim.sub(p.pos).normalize();
        // flare in the last few metres: slow the sink rate
        if (t.kind === 'runway' && hAbove < 10 && along < 900) {
            this.phase = 'flare';
            dir = _v2.copy(fwd).addScaledVector(shipVel, 1 / Math.max(p.speed, 50));
            dir.y = -Math.max(1.6, hAbove * 0.3) / Math.max(p.speed, 40);
            dir.normalize();
        }
        steerToward(p, dir, c, 1, true);
        // don't float nose-high into a tail strike (the touchdown limit is 20°)
        if (this.phase === 'flare' && p.getForward(_v3).y > Math.sin(14 * DEG)) c.pitch = Math.min(c.pitch, -0.15);
        c.yaw = clamp(c.yaw, -0.4, 0.4);
        if (along > 2500 && avoidTerrain(p, c, 60)) { c.throttle = 0.9; this.status = 'TERRAIN — CLIMBING'; return; }
        const relSpeed = _v3.subVectors(p.vel, shipVel).length();
        // in the flare keep a little power (don't let it sink onto its belly) until the wheels are nearly down
        if (this.phase === 'flare') c.throttle = hAbove < 2 ? 0 : clamp(0.3 + (app - relSpeed) * 0.06, 0.12, 0.7);
        else c.throttle = clamp(0.45 + (app - relSpeed) * 0.06, 0, 0.9);
        if (this.phase === 'flare') p.gear = true;
        const dev = Math.round((p.pos.y - glideAlt - p.gearOffset) * 3.28);
        this.status = (this.phase === 'flare' ? 'FLARE' : 'FINAL') + ' ' + (along / 1000).toFixed(1) + ' KM · ' + Math.abs(dev) + ' FT ' + (dev >= 0 ? 'HIGH' : 'LOW');
        // went around / overshot badly → try again
        if (along < -400) { this.phase = 'transit'; this.leg = null; g.addFeed('GO AROUND', '#ffc23f'); p.gear = true; }
    }
}
