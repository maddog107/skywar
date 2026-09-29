// ═══════════════════════════════════════════════════════════════
// Sensors (docs/WAR.md, a war plug-in): the targeting pod, the helmet sight, the radar picture and battle
// damage imagery.
//  • targeting pod (Sniper ATP / LITENING style); period brings its video up full screen. A gimballed camera
//    under the right intake becomes the main camera: slewed with the mouse or the arrow keys, WIDE 4° / MED 1.5°
//    / NARO 0.5° (wheel or +/-), white-hot, black-hot or TV (V; the grade is postfx.js's SensorPass, with the heat
//    of what's in view handed over from here). Track modes: SP (snowplow, the ground ahead), AREA (a ground point
//    held while the jet manoeuvres), POINT (a unit), RATES (space-stabilised, above the horizon) and INR (a lost
//    point track coasting on its last velocity). The airframe masks the view above the wing plane, the gimbal
//    stops 25° short of straight aft, clouds on the line of sight blind it. It identifies what it looks at far
//    beyond the eye (war.reveal … 'tgp'), comma marks what's under the cross, space fires the laser (exact range).
//    Closed, it keeps its track and the HUD shows where it looks.
//  • pod autopilot: while the video is up the jet flies itself — altitude hold, attitude hold (wings level holds
//    the heading), speed hold; A/D roll it to a new bank that is then held (a wheel around the target), W/S move
//    the held altitude, Z/Shift the held speed, H flies an orbit round the SPI. When the video goes down it keeps
//    holding until the pilot touches the controls, so nothing jumps.
//  • helmet sight (JHMCS style): with the head (or the chase camera) turned off the nose an aiming cross shows
//    what's under it; comma marks it
//  • radar picture: a track file of air contacts (heading, altitude, speed when a sensor last had them) for the
//    tactical map and the HUD's scope
//  • battle damage imagery: the pod watches pending BDA (strikes.watchers); when a result comes in while the pod
//    (or the pilot) is looking, the frame is kept as a small sensor image, shown in the tactical map
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, terrainNormal } from './world.js';
import { INTEL, INTEL_NAMES } from './war.js';
import { refSpeeds } from './aircraft.js';
import { avoidTerrain } from './ai.js';
import { clamp, damp, DEG, G, M_TO_FT, MS_TO_KTS } from './util.js';

// ═════════════ The pod, headless (tests/sensors.test.mjs) ═════════════
export const FOVS = [{ name: 'WIDE', deg: 4 }, { name: 'MED', deg: 1.5 }, { name: 'NARO', deg: 0.5 }];
export const SENSOR_MODES = ['WHOT', 'BHOT', 'TV'];
export const POD = {
    maxOffNose: 155 * DEG,  // the pitch gimbal's aft stop (the roll gimbal turns all the way round)
    slewRate: 110 * DEG,    // how fast the gimbal swings (rad/s)
    code: 1688,             // laser code
    laserRange: 25000,      // m
    spots: 24,              // heat sources handed to the IR grade (postfx.js SENSOR_SPOTS)
};
const CLEAR_WEATHER = { clear: 1, cloudy: 0.9, rain: 0.55, storm: 0.4 };

// A line of sight in the airframe's axes (x right, y up, −z the nose) → gimbal angles: az (+ right of the nose),
// el (+ above the wing plane), off (off the nose)
export function gimbalAngles(b) {
    return { az: Math.atan2(b.x, -b.z), el: Math.asin(clamp(b.y, -1, 1)), off: Math.acos(clamp(-b.z, -1, 1)) };
}

// How far below the wing plane (negative: above it) the airframe leaves the view clear, by azimuth. The pod hangs
// on the chin station under the right side of the intake, well below the wing: ahead it sees up to the nose line,
// out to the right it looks under the wing; the intake and the centreline store hide the left, the ventral fins
// and the tailplane the view aft
export function maskDepression(az) {
    const s = Math.sin(az), c = Math.cos(az);
    return (-12 * Math.max(0, s) + 15 * Math.max(0, -s) - 10 * Math.max(0, c) ** 2 + 10 * Math.max(0, -c)) * DEG;
}

// Is a line of sight (airframe axes) hidden by the airframe or past the gimbal stop? margin (rad): how far
// below the mask edge it is (negative when masked)
export function podMask(b) {
    const { az, el, off } = gimbalAngles(b);
    const margin = -el - maskDepression(az);
    return { masked: margin < 0, margin, limit: off > POD.maxOffNose, az, el, off };
}

// Keep a line of sight (airframe axes) in the gimbal's field of regard: past the aft stop it rests on the stop,
// in the same plane through the nose
export function clampGimbal(b, out = b) {
    if (Math.acos(clamp(-b.z, -1, 1)) <= POD.maxOffNose) return out.copy(b);
    let px = b.x, py = b.y;
    const L = Math.hypot(px, py);
    if (L < 1e-6) { px = 0; py = -1; } else { px /= L; py /= L; }
    const s = Math.sin(POD.maxOffNose), c = Math.cos(POD.maxOffNose);
    return out.set(px * s, py * s, -c);
}

// Swing the unit vector `cur` toward `target` by at most `maxAngle` (rad): the gimbal's slew rate
const _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion();
export function stepToward(cur, target, maxAngle) {
    const ang = Math.acos(clamp(cur.dot(target), -1, 1));
    if (ang <= maxAngle || ang < 1e-7) return cur.copy(target);
    _sq.setFromUnitVectors(cur, target);
    _sq2.identity().slerp(_sq, maxAngle / ang);
    return cur.applyQuaternion(_sq2).normalize();
}

// The pod's picture is derotated: world up is up in the image (looking straight down, the way the jet heads).
// Right and up of the image for a line of sight → (outR, outU)
export function imageBasis(los, heading, outR, outU) {
    const k = clamp((Math.abs(los.y) - 0.92) / 0.075, 0, 1);
    outU.set(0, 1, 0);
    if (k > 0) outU.set(Math.sin(heading) * k, 1 - k, -Math.cos(heading) * k);
    outR.crossVectors(los, outU);
    if (outR.lengthSq() < 1e-9) outR.set(Math.cos(heading), 0, Math.sin(heading));
    outR.normalize();
    outU.crossVectors(outR, los).normalize();
    return outR;
}

// The line of sight after slewing the cross by `right` and `up` radians in the image
const _br = new THREE.Vector3(), _bu = new THREE.Vector3();
export function slewLos(los, right, up, heading, out) {
    imageBasis(los, heading, _br, _bu);
    return out.copy(los).addScaledVector(_br, Math.tan(right)).addScaledVector(_bu, Math.tan(up)).normalize();
}

// Where a ray first meets the ground (ground(x, z) → height), or null: steps that grow with the distance, then
// bisection
export function rayGround(o, d, ground, maxT = 40000, out = new THREE.Vector3()) {
    let prev = 0, t = 30;
    if (o.y < ground(o.x, o.z)) return null;
    while (t < maxT) {
        const y = o.y + d.y * t, gh = ground(o.x + d.x * t, o.z + d.z * t);
        if (y < gh) {
            let a = prev, b = t;
            for (let k = 0; k < 14; k++) {
                const m = (a + b) / 2;
                if (o.y + d.y * m < ground(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m;
            }
            out.set(o.x + d.x * b, 0, o.z + d.z * b);
            out.y = ground(out.x, out.z);
            return out;
        }
        prev = t;
        // (strides grow with the distance, but never past half the height still to go)
        t += Math.max(12, Math.min(t * 0.03, (y - gh) * 0.5 + 12));
    }
    return null;
}

// Terrain between two points, sampled finely enough (every ~150 m, 8-80 samples; the ends skipped) that a ridge
// can't slip between samples at pod ranges (war.lineOfSight takes ten)
export function terrainClear(a, b, ground = terrainHeight) {
    const n = clamp(Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 150), 8, 80);
    for (let i = 1; i < n; i++) {
        const t = i / n;
        if (ground(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) > a.y + (b.y - a.y) * t + 2) return false;
    }
    return true;
}

// Identification by the pod (m). NARO on a clear day identifies a vehicle-sized target (radius ~7 m) at about
// 25 km: pixels on target fall with the field of view (as its square root: the wide field's picture is sharper
// per pixel). The TV camera needs daylight; the FLIR doesn't, and a hot engine stands out, most at night. Rain and
// haze soak up both; camouflage nets fool the camera more than the FLIR. Detection (something's there: a contact)
// reaches twice as far.
export function podIdentRange({ fovDeg = 0.5, sensor = 'WHOT', light = 1, weather = 'clear', hot = false, size = 7, conceal = 0 } = {}) {
    const fov = clamp(fovDeg, 0.2, 10);
    let r = 25000 * Math.sqrt(0.5 / fov) * clamp(Math.sqrt(size / 7), 0.55, 1.5);
    if (sensor === 'TV') r *= light >= 0.9 ? 1 : light >= 0.5 ? 0.55 : 0.12;
    else r *= (light >= 0.9 ? 1 : light >= 0.5 ? 0.95 : 0.9) * (hot ? (light >= 0.9 ? 1.1 : 1.2) : (light >= 0.9 ? 0.96 : 0.78));
    r *= CLEAR_WEATHER[weather] ?? 1;
    r *= 1 - (sensor === 'TV' ? 0.6 : 0.35) * clamp(conceal, 0, 1);
    return { identify: Math.min(r, 25000), detect: Math.min(r * 2, 32000) };
}

// Orbit steering: the bank (rad, + right wing down) that flies a circle of radius R round c (x, z) — dir +1 with
// the centre off the right wing, −1 the left — pulling in or out toward the circle
export function orbitBank(pos, vel, c, R, dir, maxBank = 50 * DEG) {
    const rx = pos.x - c.x, rz = pos.z - c.z, d = Math.hypot(rx, rz) || 1;
    const ux = rx / d, uz = rz / d;
    const k = clamp((d - R) / R * 1.6, -0.9, 0.9);
    const wx = -uz * dir - ux * k, wz = ux * dir - uz * k;
    const V = Math.max(Math.hypot(vel.x, vel.z), 30);
    let err = Math.atan2(wx, -wz) - Math.atan2(vel.x, -vel.z);
    err = Math.atan2(Math.sin(err), Math.cos(err));
    return clamp(dir * Math.atan(V * V / (G * R)) * clamp(1.5 - Math.abs(k), 0, 1) + err * 1.8, -maxBank, maxBank);
}

// ═════════════ Scratch ═════════════
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _hit = new THREE.Vector3(), _probe = new THREE.Vector3();
const groundH = (x, z) => Math.max(terrainHeight(x, z), 0);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const byAngle = (x, y) => x.ang - y.ang;
// Where a unit is drawn: vehicles on a road ride the road's distance lift (roads.js keeps distant roads above the
// coarse terrain), which the pod's narrow field shows; everything else is where it is
export function drawnPos(u, out) {
    if (u.route && u.mesh) return out.copy(u.mesh.position).setY(u.mesh.position.y + (u.radius || 5) * 0.4);
    return out.copy(u.pos);
}
const HOT_CLS = new Set(['vehicle', 'convoy', 'tank', 'tel', 'artillery', 'aaa', 'sam', 'sam-radar', 'radar', 'command']);
const FRONT_ENGINE = new Set(['truck', 'humvee', 'fueltruck', 'tel']); // (wheeled: the engine is up front)
const FONT = '"Share Tech Mono", ui-monospace, monospace';
const SYM = '#e9f2ea', SYM_DIM = 'rgba(233,242,234,0.62)', HMD = '#5dffa0', WARN = '#ffc23f';
// what time it is on the imagery's time stamp, by the time of day (Zulu, a date-free clock)
const ZULU0 = { dawn: 6 * 3600 + 610, day: 13 * 3600 + 1800, dusk: 19 * 3600 + 2400, night: 1 * 3600 + 900 };

export class Sensors {
    constructor(game) {
        this.game = game;
        this.tracks = new Map();    // air contact → { vel, alt, speed, t } when a sensor last had it
        this.imagery = [];          // BDA imagery (newest last)
        this.pod = null;
        this.view = false;
        this.ap = null;
        this.captures = [];
        this.sv = {                 // what postfx's SensorPass renders (game.sensorView while the video is up)
            mode: 0, grain: 0.03, night: 0, masked: 0,
            spotA: new Float32Array(POD.spots * 4), spotB: new Float32Array(POD.spots * 4), spotE: new Float32Array(POD.spots * 4), nSpots: 0,
        };
        this.keysPrev = {};
        this.reset();
    }

    reset() {
        const p = this.pod;
        this.pod = {
            on: false, mode: 'SP', unit: null, spi: new THREE.Vector3(), hasSpi: false,
            rates: new THREE.Vector3(0, -0.4, -1).normalize(),
            los: new THREE.Vector3(0, -0.4, -1).normalize(),   // where the camera looks (world): swings at the gimbal's rate
            want: new THREE.Vector3(0, -0.4, -1).normalize(),  // where the pod is told to look
            pos: new THREE.Vector3(),
            fov: p ? p.fov : 0, sensor: p ? p.sensor : 0,
            lasing: false, masked: false, maskSoon: false, limit: false, cloud: false, cloudT: 0, maskK: 0,
            coast: null, lost: 0, range: 0, lrange: 0, losT: 0, terrainOk: true,
            dwell: new Map(), under: null, underT: 0, keyT: 0, bda: null,
        };
        this.ap = null;
    }

    // ═════════════ Lifecycle ═════════════
    start() {
        this.closeView(true);
        this.reset();
        this.tracks.clear();
        this.imagery.length = 0;
        this.captures.length = 0;
        const st = this.game.strikes;
        // pending BDA the pod is looking at completes quickly
        if (st) {
            st.watchers = st.watchers || [];
            if (!st.watchers.includes(this.watcher)) {
                this.watcher = this.watcher || ((pos) => this.podSees(pos));
                st.watchers.push(this.watcher);
            }
        }
        if (!this.hooked) {
            this.hooked = true;
            this.game.events.on('bda', (e) => this.onBDA(e));
        }
    }

    clear() {
        this.closeView(true);
        this.reset();
        this.tracks.clear();
        this.captures.length = 0;
    }

    get flying() {
        const g = this.game, p = g.player;
        return g.state === 'playing' && !g.pilotMode && !g.groundStart && p && p.alive && !p.exploded;
    }

    hasPod(p) { return p && p.spec && (p.spec.category === 'fighter' || p.spec.category === 'bomber'); }

    // ═════════════ Video up / down ═════════════
    openView() {
        const g = this.game, p = g.player;
        if (!this.hasPod(p)) { g.addFeed('NO TARGETING POD ON THE ' + p.spec.name.toUpperCase(), '#ffc23f'); return; }
        const pod = this.pod;
        if (!pod.on) this.powerOn();
        this.view = true;
        g.sensorView = this.sv;
        if (g.onNvg && g.nvg) g.onNvg(false); // (the goggles' tint is a CSS filter on the canvas)
        if (g.world.clouds) g.world.clouds.resetHistory = true;
        g.input.lock();
        this.engageAp();
        g.audio.tick(1600, 0.06, 0.05);
    }

    closeView(quiet = false) {
        if (!this.view) return;
        const g = this.game;
        this.view = false;
        g.sensorView = null;
        if (g.onNvg && g.nvg) g.onNvg(true);
        if (g.world && g.world.clouds) g.world.clouds.resetHistory = true;
        g.camera.up.set(0, 1, 0);
        g.camera.fov = 60; g.camera.updateProjectionMatrix();
        if (g.player && g.player.root) g.player.root.visible = true;
        if (g.settings.controlMode === 'mousestick' && !g.pilotMode) g.input.unlock();
        // the autopilot keeps holding until the pilot touches the controls
        if (this.ap && !quiet) {
            this.ap.handback = true;
            this.ap.mouse0 = { x: g.input.mouse.x, y: g.input.mouse.y };
        } else this.ap = null;
        if (!quiet) g.audio.tick(900, 0.06, 0.05);
    }

    // Where the pod looks when it comes on: the HUD's ground target, the steerpoint, the newest mark, else the
    // ground ahead (snowplow)
    powerOn() {
        const g = this.game, pod = this.pod, war = g.war, p = g.player;
        pod.on = true;
        this.podPos(p, pod.pos);
        const lt = g.lockTarget;
        const marks = war ? war.designations : [];
        const mark = marks.length ? marks[marks.length - 1] : null;
        const ahead = (pos) => _v.subVectors(pos, p.pos).normalize().dot(p.getForward(_v2)) > -0.2;
        if (lt && lt.isGround && lt.alive && ahead(lt.pos)) this.pointTrack(lt);
        else if (g.navTarget && g.navTarget.pos && ahead(g.navTarget.pos)) this.areaTrack(g.navTarget.pos);
        else if (mark && ahead(mark.unit ? mark.unit.pos : mark.pos)) { if (mark.unit && mark.unit.alive) this.pointTrack(mark.unit); else this.areaTrack(mark.fixed || mark.pos); }
        else this.snowplow();
        pod.los.subVectors(pod.hasSpi ? pod.spi : _v.copy(pod.pos).add(pod.rates), pod.pos).normalize();
        pod.want.copy(pod.los);
    }

    // Slave the pod to a point or a unit (the map, the command menu, a mark)
    slaveTo(target) {
        const pod = this.pod;
        if (!pod.on) { pod.on = true; this.podPos(this.game.player, pod.pos); }
        if (target && target.pos && target.alive !== undefined && target.alive) this.pointTrack(target);
        else if (target) this.areaTrack(target.pos || target);
        this.game.audio.tick(1250, 0.05, 0.04);
    }

    // ═════════════ Track modes ═════════════
    snowplow() { const pod = this.pod; pod.mode = 'SP'; pod.unit = null; pod.coast = null; pod.hasSpi = false; this.updateSnowplow(); }
    areaTrack(p) {
        const pod = this.pod;
        pod.mode = 'AREA'; pod.unit = null; pod.coast = null;
        pod.spi.set(p.x, p.y != null ? p.y : 0, p.z);
        if (!(p.y > -50)) pod.spi.y = this.game.surfaceAt(p.x, p.z).h;
        pod.hasSpi = true;
    }
    pointTrack(u) {
        const pod = this.pod;
        pod.mode = 'POINT'; pod.unit = u; pod.coast = null; pod.lost = 0; pod.losT = 0;
        drawnPos(u, pod.spi); pod.hasSpi = true;
    }

    // TMS up: point track what's under the cross, else hold the ground there
    trackUp() {
        const pod = this.pod;
        if (pod.under && pod.under !== pod.unit) this.pointTrack(pod.under);
        else if (pod.mode === 'RATES' || pod.mode === 'SP' || pod.mode === 'INR') {
            const hit = rayGround(pod.pos, pod.los, groundH, 40000, _hit);
            if (hit) this.areaTrack(hit);
        } else if (pod.mode === 'AREA' && !pod.under) this.game.audio.tick(400, 0.05, 0.04);
        this.game.audio.tick(1500, 0.04, 0.04);
    }

    // TMS down: a point track drops to area, area to snowplow
    trackDown() {
        const pod = this.pod;
        if (pod.mode === 'POINT' || pod.mode === 'INR') this.areaTrack(pod.spi);
        else if (pod.mode === 'AREA' || pod.mode === 'RATES') this.snowplow();
        this.game.audio.tick(1000, 0.04, 0.04);
    }

    zoom(dir) {
        const pod = this.pod, f = clamp(pod.fov + dir, 0, FOVS.length - 1);
        if (f === pod.fov) return;
        pod.fov = f;
        if (this.game.world.clouds) this.game.world.clouds.resetHistory = true;
        this.game.audio.tick(1100 + f * 150, 0.04, 0.03);
    }

    // Slew the cross: `right` and `up` radians in the image. A point track lets go (area track where the cross
    // ends up); above the horizon the pod is space-stabilised (RATES)
    slew(right, up) {
        const pod = this.pod, p = this.game.player;
        if (!right && !up) return;
        const hdg = Math.atan2(p.vel.x, -p.vel.z);
        const dir = slewLos(pod.los, right, up, hdg, _v3);
        pod.los.copy(dir); pod.want.copy(dir);
        const hit = rayGround(pod.pos, dir, groundH, 45000, _hit);
        if (hit) {
            pod.mode = 'AREA'; pod.unit = null; pod.coast = null;
            pod.spi.copy(hit); pod.spi.y = this.game.surfaceAt(hit.x, hit.z, hit.y + 5).h;
            pod.hasSpi = true;
        } else {
            pod.mode = 'RATES'; pod.unit = null; pod.coast = null; pod.hasSpi = false;
            pod.rates.copy(dir);
        }
    }

    podPos(p, out) {
        const L = Math.max(p.spec.length || 15, 8);
        return out.set(0.55, -1.15, -0.18 * L).applyQuaternion(p.quat).add(p.pos);
    }

    updateSnowplow() {
        const pod = this.pod, p = this.game.player;
        if (!p) return;
        const agl = Math.max(p.pos.y - groundH(p.pos.x, p.pos.z), 50);
        const R = clamp(agl / Math.tan(25 * DEG), 2500, 9000);
        const vh = Math.hypot(p.vel.x, p.vel.z);
        const fx = vh > 1 ? p.vel.x / vh : -Math.sin(p.heading || 0), fz = vh > 1 ? p.vel.z / vh : -Math.cos(p.heading || 0);
        const x = p.pos.x + fx * R, z = p.pos.z + fz * R;
        pod.spi.set(x, this.game.surfaceAt(x, z).h, z);
        pod.hasSpi = true;
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        const g = this.game;
        this.updateTracks();
        this.pollKeys(dt);
        const pod = this.pod;
        if (!pod.on) return;
        if (!this.flying) { this.closeView(true); pod.on = false; this.ap = null; return; }
        const p = g.player;
        this.podPos(p, pod.pos);
        // the commanded line of sight
        if (pod.mode === 'SP') this.updateSnowplow();
        else if (pod.mode === 'POINT' || pod.mode === 'INR') this.updatePoint(dt);
        if (pod.hasSpi) pod.want.subVectors(pod.spi, pod.pos).normalize();
        else pod.want.copy(pod.rates);
        // the gimbal: airframe mask, aft stop, slew rate
        _q.copy(p.quat).invert();
        const b = _v.copy(pod.want).applyQuaternion(_q);
        const m = podMask(b);
        pod.limit = m.limit;
        pod.masked = m.masked || m.limit;
        pod.maskSoon = !pod.masked && m.margin < 6 * DEG;
        clampGimbal(b, b).applyQuaternion(p.quat);
        pod.want.copy(b);
        stepToward(pod.los, pod.want, POD.slewRate * dt);
        pod.maskK = damp(pod.maskK, pod.masked ? 1 : 0, 6, dt);
        pod.range = pod.hasSpi ? pod.pos.distanceTo(pod.spi) : 0;
        // clouds on the line of sight (a few times a second)
        pod.cloudT -= dt;
        if (pod.cloudT <= 0) { pod.cloudT = 0.25; pod.cloud = pod.hasSpi && this.sightT(pod.pos, pod.spi) < 0.35; }
        // the laser: the trigger (space) with the video up
        pod.lasing = this.view && g.input.down('Space') && !pod.masked && pod.hasSpi && pod.range < POD.laserRange && !pod.cloud;
        if (pod.lasing) pod.lrange = pod.range;
        if (this.view) {
            pod.under = this.unitUnderCross();
            this.identify(dt);
            this.buildView(dt);
        }
    }

    // a point track follows its unit; hidden (masked, clouds, terrain) it coasts on the last velocity (INR) and
    // picks the unit up again if it shows within a few seconds, else settles into an area track
    updatePoint(dt) {
        const pod = this.pod, u = pod.unit;
        if (!u || u.removed) { this.areaTrack(pod.spi); return; }
        // (the terrain check ten times a second)
        pod.losT = (pod.losT || 0) - dt;
        if (pod.losT <= 0) { pod.losT = 0.1; pod.terrainOk = terrainClear(pod.pos, _v2.copy(u.pos).setY(u.pos.y + 1.5)); }
        const seen = !pod.masked && !pod.cloud && pod.terrainOk;
        if (seen) {
            if (pod.mode === 'INR') pod.mode = 'POINT';
            pod.lost = 0; pod.coast = null;
            drawnPos(u, pod.spi);
            return;
        }
        pod.lost += dt;
        if (pod.lost < 0.4) { drawnPos(u, pod.spi); return; }
        if (!pod.coast) pod.coast = { from: pod.spi.clone(), vel: (u.vel ? u.vel.clone() : new THREE.Vector3()).setY(0), t: 0, dy: 0 };
        const c = pod.coast;
        if (pod.mode !== 'INR') {
            // (the height the coast keeps above the ground: the unit's own, including any road lift it's drawn with)
            c.dy = c.from.y - this.game.surfaceAt(c.from.x, c.from.z).h;
            pod.mode = 'INR';
        }
        c.t += dt;
        pod.spi.copy(c.from).addScaledVector(c.vel, c.t);
        pod.spi.y = this.game.surfaceAt(pod.spi.x, pod.spi.z).h + c.dy;
        if (c.t > 8) this.areaTrack(pod.spi);
    }

    // keys the pod polls itself: arrows slew, +/- field of view, C slaves to the steerpoint / newest mark
    pollKeys(dt) {
        const g = this.game, inp = g.input, prev = this.keysPrev;
        const edge = (code) => { const d = inp.down(code); const e = d && !prev[code]; prev[code] = d; return e; };
        const zin = edge('Equal') | edge('NumpadAdd'), zout = edge('Minus') | edge('NumpadSubtract'), cz = edge('KeyC');
        if (!this.view || g.state !== 'playing') return;
        if (zin) this.zoom(1);
        if (zout) this.zoom(-1);
        if (cz) this.cursorZero();
        // arrow-key slew: a steady rate across the picture, faster once held
        const kx = (inp.down('ArrowRight') ? 1 : 0) - (inp.down('ArrowLeft') ? 1 : 0);
        const ky = (inp.down('ArrowUp') ? 1 : 0) - (inp.down('ArrowDown') ? 1 : 0);
        const pod = this.pod;
        if (kx || ky) {
            pod.keyT += dt;
            const rate = FOVS[pod.fov].deg * DEG * (pod.keyT > 0.7 ? 0.9 : 0.3);
            this.slew(kx * rate * dt, ky * rate * dt);
        } else pod.keyT = 0;
    }

    // CZ: back to the steerpoint, else the newest mark, else snowplow
    cursorZero() {
        const g = this.game, marks = g.war.designations;
        if (g.navTarget && g.navTarget.pos) this.areaTrack(g.navTarget.pos);
        else if (marks.length) { const m = marks[marks.length - 1]; if (m.unit && m.unit.alive) this.pointTrack(m.unit); else this.areaTrack(m.fixed || m.pos); }
        else this.snowplow();
        g.audio.tick(1250, 0.05, 0.04);
    }

    // the unit in the track gate: the nearest to the cross within a few % of the field of view (or its own size)
    unitUnderCross() {
        const g = this.game, war = g.war, pod = this.pod, p = g.player;
        const gate = FOVS[pod.fov].deg * DEG * 0.05;
        let best = null, bs = 1;
        for (const u of war.units) {
            if (u === p || u.removed) continue;
            _v.subVectors(drawnPos(u, _v4), pod.pos);
            const d = _v.length();
            if (d < 30 || d > 32000) continue;
            const ang = Math.acos(clamp(_v.dot(pod.los) / d, -1, 1));
            const lim = Math.max(gate, (u.radius || 5) / d * 1.1);
            if (ang > lim) continue;
            const s = ang / lim + (u.alive ? 0 : 0.5);
            if (s < bs && war.lineOfSight(pod.pos, _v2.copy(u.pos).setY(u.pos.y + 1.5))) { bs = s; best = u; }
        }
        return best;
    }

    // ═════════════ Identification ═════════════
    // Units in the picture are spotted (CONTACT) and identified at the pod's ranges after a short dwell; near the
    // cross twice as fast
    identify(dt) {
        const g = this.game, war = g.war, pod = this.pod;
        if (!war.enabled || pod.masked) return;
        const fovR = FOVS[pod.fov].deg * DEG, half = fovR * 0.5 * Math.max(g.camera.aspect, 1) * 1.05;
        const light = war.lightFactor(), sensor = SENSOR_MODES[pod.sensor], weather = g.weather && g.weather.wx ? 'clear' : g.world.weather; // ([weather] the line of sight carries it: losT)
        for (const u of war.units) {
            const rec = war.recs.get(u);
            if (!u.alive || rec.team === war.side || rec.team === 'neutral' || rec.known >= INTEL.IDENTIFIED) { pod.dwell.delete(u); continue; }
            _v.subVectors(u.pos, pod.pos);
            const d = _v.length();
            const ang = Math.acos(clamp(_v.dot(pod.los) / Math.max(d, 1), -1, 1));
            if (ang > half || d > 32000) { this.decay(u, dt); continue; }
            const R = podIdentRange({ fovDeg: FOVS[pod.fov].deg, sensor, light, weather, hot: this.heatOf(u, rec) > 0.4, size: u.radius || 6, conceal: rec.conceal });
            const fired = u.firingT != null && war.time - u.firingT < 3;
            if (d > R.detect && !fired) { this.decay(u, dt); continue; }
            const st = pod.dwell.get(u) || { t: 0, vis: 0, check: 0 };
            pod.dwell.set(u, st);
            // line of sight: terrain and cloud, checked a few times a second
            st.check -= dt;
            if (st.check <= 0) {
                st.check = 0.2;
                _v2.copy(u.pos).setY(u.pos.y + Math.max((u.radius || 4) * 0.3, 1.5));
                st.vis = terrainClear(pod.pos, _v2) && this.sightT(pod.pos, _v2) > 0.35 ? 1 : 0;
            }
            if (!st.vis) { st.t = Math.max(0, st.t - dt); continue; }
            st.t += dt * (ang < fovR * 0.12 ? 2 : 1);
            if (st.t > 0.9 && d < R.identify) war.reveal(u, INTEL.IDENTIFIED, 'tgp');
            else if (st.t > 0.3) war.reveal(u, INTEL.CONTACT, 'tgp');
        }
    }

    decay(u, dt) { const st = this.pod.dwell.get(u); if (st) { st.t -= dt; if (st.t <= 0) this.pod.dwell.delete(u); } }

    // [weather] What the pod's current sensor sees through between two points: with the weather model, the cloud, the
    // ground fog, the rain and (for the TV camera) the haze, the FLIR seeing through haze and some rain
    // (weathersys.js transmittance by band); without it, the clouds alone
    sightT(a, b) {
        const W = this.game.weather;
        if (W && W.wx) return W.transmittance(a, b, this.pod && this.pod.sensor === 2 ? 'tv' : 'ir');
        return this.transmittance(a, b);
    }

    // How much of the light gets through the clouds between two points (the clouds' own density field)
    transmittance(a, b) {
        const cl = this.game.world.clouds;
        if (!cl || !cl.ready || !cl.enabled || !cl.fieldU) return 1;
        const slab = cl.fieldU.slab.value;
        let t0 = 0, t1 = 1;
        const dy = b.y - a.y;
        if (Math.abs(dy) > 1e-3) {
            const ta = (slab.x - a.y) / dy, tb = (slab.y - a.y) / dy;
            t0 = clamp(Math.min(ta, tb), 0, 1); t1 = clamp(Math.max(ta, tb), 0, 1);
        } else if (a.y < slab.x || a.y > slab.y) return 1;
        if (t1 - t0 < 1e-4) return 1;
        const n = 16, dl = a.distanceTo(b) * (t1 - t0) / n;
        let tau = 0;
        for (let i = 0; i < n && tau < 5; i++) {
            _probe.lerpVectors(a, b, t0 + (t1 - t0) * (i + 0.5) / n);
            tau += cl.densityAt(_probe) * 0.065 * dl;
        }
        return Math.exp(-tau);
    }

    // ═════════════ Heat (what the FLIR sees) ═════════════
    // 0 (ambient) … 1+ (running engine, fire). Engines, exhaust and fires are hotter again (heatSpots)
    heatOf(u, rec) {
        const war = this.game.war;
        const cls = rec ? rec.cls : u.cls;
        if (!u.alive) return u.burnT > 0 || (u.sinkT > 0 && u.sinkT < 60) ? 0.9 : 0.08;
        if (u.heat != null) return u.heat; // (a unit's own: an underground complex's warm air vents, underground.js)
        let h = 0.1;
        if (cls === 'aircraft' || cls === 'helicopter') h = u.onGround ? (u.throttle > 0.08 ? 0.4 : 0.08) : 0.5;
        else if (u.isShip || cls === 'ship' || cls === 'carrier') h = 0.28;
        else if (cls === 'infantry') h = 0.6;
        else if (HOT_CLS.has(cls)) {
            const moving = (u.route && u.route.speed > 0.5) || (u.vel && u.vel.lengthSq() > 0.8);
            h = moving ? 0.45 : cls === 'radar' || cls === 'sam-radar' || cls === 'command' ? 0.26 : 0.2;
        }
        if (u.firingT != null && war.time - u.firingT < 25) h = Math.max(h, 0.6);
        return h;
    }

    // hand the heat of what's in view to the IR grade: centre + radius, ground plane, and a hotter engine spot
    buildView(dt) {
        const g = this.game, war = g.war, pod = this.pod, sv = this.sv;
        sv.mode = pod.sensor;
        sv.night = { night: 1, dusk: 0.55, dawn: 0.45 }[g.world.timeKey] || 0;
        sv.grain = pod.sensor === 2 ? 0.012 + sv.night * 0.03 : 0.024;
        sv.masked = pod.maskK;
        const fovR = FOVS[pod.fov].deg * DEG, half = fovR * 0.5 * Math.max(g.camera.aspect, 1) * 1.3;
        // the hottest things nearest the middle of the picture first (pooled: no garbage per frame)
        const list = this.spotList || (this.spotList = []), pool = this.spotPool || (this.spotPool = []);
        list.length = 0;
        if (pod.sensor !== 2) for (const u of war.units) {
            if (u === g.player || u.removed) continue;
            _v.subVectors(drawnPos(u, _v4), pod.pos);
            const d = _v.length();
            if (d > 30000) continue;
            const r = clamp((u.radius || 5) * 1.25, 2, 45);
            const ang = Math.acos(clamp(_v.dot(pod.los) / Math.max(d, 1), -1, 1));
            if (ang > half + r / Math.max(d, 1)) continue;
            const it = pool[list.length] || (pool[list.length] = {});
            it.u = u; it.ang = ang; it.rec = war.recs.get(u); it.r = r;
            list.push(it);
        }
        list.sort(byAngle);
        let n = 0;
        for (const it of list) {
            if (n >= POD.spots) break;
            const u = it.u, heat = this.heatOf(u, it.rec);
            if (heat < 0.14) continue;
            const o = n * 4, at = drawnPos(u, _v3);
            sv.spotA[o] = at.x; sv.spotA[o + 1] = at.y; sv.spotA[o + 2] = at.z; sv.spotA[o + 3] = it.r;
            // the ground it stands on (a plane through the base, the terrain's slope); aircraft in flight and
            // ships' hulls above the sea count all over
            let gy, nx = 0, nz = 0;
            const air = (it.rec && (it.rec.cls === 'aircraft' || it.rec.cls === 'helicopter')) && !u.onGround;
            if (air) gy = u.pos.y - 1e4;
            else if (u.isShip) gy = 0.4;
            else {
                gy = u.mesh ? u.mesh.position.y : groundH(u.pos.x, u.pos.z);
                terrainNormal(u.pos.x, u.pos.z, _n); nx = _n.x; nz = _n.z;
            }
            sv.spotB[o] = heat; sv.spotB[o + 1] = gy; sv.spotB[o + 2] = nx; sv.spotB[o + 3] = nz;
            // engine / exhaust / stack / fire
            const e = this.engineOf(u, it.rec, air, _v4);
            sv.spotE[o] = e.x; sv.spotE[o + 1] = e.y; sv.spotE[o + 2] = e.z; sv.spotE[o + 3] = e.w;
            n++;
        }
        sv.nSpots = n;
    }

    // where the hottest part is (xyz) and how hot (w)
    engineOf(u, rec, air, out) {
        const cls = rec ? rec.cls : u.cls;
        out.w = 0;
        if (!u.alive) { out.copy(u.pos); out.w = u.burnT > 0 ? 0.9 : 0; return out; }
        if (u.heat != null) { out.copy(u.pos); out.w = u.heat; return out; } // (its own heat, at its top)
        if (air || cls === 'aircraft' || cls === 'helicopter') {
            const L = (u.spec && u.spec.length) || 15;
            if (u.getForward) u.getForward(_a); else _a.set(0, 0, -1);
            out.copy(u.pos).addScaledVector(_a, -L * 0.45);
            out.w = air ? 1.5 : u.throttle > 0.08 ? 0.9 : 0;
            return out;
        }
        if (u.isShip) { out.copy(u.pos).setY((u.deckY || 8) + 12); out.w = u.alive ? 0.7 : 0; return out; }
        // vehicles: a tank's engine deck at the back, a truck's engine up front; a site's generator beside it
        const ry = u.mesh ? u.mesh.rotation.y : 0;
        const r = u.radius || 5, base = u.mesh ? u.mesh.position.y : u.pos.y - r * 0.4;
        const k = (FRONT_ENGINE.has(u.type) ? -0.4 : 0.35) * r; // (+: behind; the mesh faces −Z)
        out.set(u.pos.x + Math.sin(ry) * k, base + Math.min(r * 0.25, 1.8), u.pos.z + Math.cos(ry) * k);
        const moving = (u.route && u.route.speed > 0.5) || (u.vel && u.vel.lengthSq() > 0.8);
        out.w = moving ? 0.7 : HOT_CLS.has(cls) ? 0.32 : 0;
        if (u.firingT != null && this.game.war.time - u.firingT < 25) out.w = Math.max(out.w, 0.7);
        return out;
    }

    // ═════════════ Camera ═════════════
    updateCamera(cam, dt) {
        if (!this.view) return false;
        const g = this.game, p = g.player, pod = this.pod;
        if (!p || !p.alive) return false;
        p.root.visible = false;
        if (g.cockpit) g.cockpit.enabled = false;
        this.podPos(p, pod.pos);
        const hdg = Math.atan2(p.vel.x, -p.vel.z);
        imageBasis(pod.los, hdg, _a, _b);
        cam.position.copy(pod.pos);
        cam.up.copy(_b);
        cam.lookAt(_v.copy(pod.pos).add(pod.los));
        const fov = FOVS[pod.fov].deg;
        cam.fov = Math.abs(cam.fov - fov) > fov * 0.02 ? cam.fov + (fov - cam.fov) * (1 - Math.exp(-dt * 18)) : fov;
        cam.updateProjectionMatrix();
        return true;
    }

    // ═════════════ The pod's autopilot (game.js calls flyJet from updatePlayer) ═════════════
    engageAp() {
        const g = this.game, p = g.player;
        if (!p || p.onGround) { this.ap = null; return; }
        const rs = refSpeeds(p.spec);
        const up = _a.set(0, 1, 0).applyQuaternion(p.qv), right = _b.set(1, 0, 0).applyQuaternion(p.qv);
        const bank = Math.atan2(-right.y, up.y);
        const keep = this.ap && !this.ap.handback ? this.ap : null;
        this.ap = {
            mode: keep ? keep.mode : 'hold', alt: p.pos.y, bank: clamp(bank, -45 * DEG, 45 * DEG), hdg: null,
            speed: clamp(p.speed, rs.approach * 1.35, Math.max(rs.approach * 1.35, 330)), thr: p.controls.throttle,
            R: 6000, dir: 1, handback: false, status: '',
        };
        if (Math.abs(bank) < 7 * DEG) { this.ap.bank = 0; this.ap.hdg = Math.atan2(p.vel.x, -p.vel.z); }
        if (this.ap.mode === 'orbit') this.setOrbit(true);
    }

    setOrbit(on) {
        const ap = this.ap, g = this.game, p = g.player, pod = this.pod;
        if (!ap) return;
        if (on && pod.hasSpi) {
            ap.mode = 'orbit';
            // round it at about the range it's at now (the geometry the pilot set up), not too tight, not too wide
            const agl = p.pos.y - groundH(pod.spi.x, pod.spi.z);
            ap.R = clamp(Math.hypot(p.pos.x - pod.spi.x, p.pos.z - pod.spi.z), Math.max(4000, agl * 1.2), 12000);
            // right-hand, the target off the right wing: the pod's side, where the airframe masks least
            ap.dir = 1;
            g.addFeed('AUTOPILOT: ORBIT ' + (ap.R / 1000).toFixed(1) + ' KM ROUND THE SPI', '#5ab8ff');
        } else {
            ap.mode = 'hold';
            const up = _a.set(0, 1, 0).applyQuaternion(p.qv), right = _b.set(1, 0, 0).applyQuaternion(p.qv);
            ap.bank = clamp(Math.atan2(-right.y, up.y), -45 * DEG, 45 * DEG);
            ap.hdg = null;
            if (Math.abs(ap.bank) < 7 * DEG) { ap.bank = 0; ap.hdg = Math.atan2(p.vel.x, -p.vel.z); }
            ap.alt = p.pos.y;
            if (on !== undefined) g.addFeed('AUTOPILOT: ALTITUDE AND ATTITUDE HOLD', '#5ab8ff');
        }
    }

    // game.js calls this from updatePlayer after the stick has been mapped to the controls (and before the landing
    // autopilot and the guns): with the pod's video up the mouse, the wheel, the arrows and the trigger belong to
    // the pod and the pod's autopilot flies; handing back, it flies until the pilot touches the controls. `s` is
    // readStick's result, `mouse` the frame's mouse deltas.
    flyJet(dt, p, s, mouse) {
        const g = this.game, inp = g.input;
        if (!this.view && !(this.ap && this.ap.handback)) return;
        // the flight keys (the arrows and +/- are the pod's)
        const inv = g.settings.invertPitch ? -1 : 1;
        const kp = ((inp.down('KeyS') ? 1 : 0) - (inp.down('KeyW') ? 1 : 0)) * inv;
        const kr = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
        const kt = (inp.down('KeyZ') ? 1 : 0) - (inp.down('ShiftLeft', 'ShiftRight') ? 1 : 0);
        if (!this.view) {
            // handing back: the first touch of the controls takes them (the mouse where it's the stick, keys, a pad
            // or a touch stick); in keyboard mode the mouse only looks round
            const mode = g.settings.controlMode;
            const moved = mode === 'mousestick' ? Math.hypot(inp.mouse.x - this.ap.mouse0.x, inp.mouse.y - this.ap.mouse0.y) > 24
                : mode === 'mouseaim' ? Math.abs(mouse.dx) + Math.abs(mouse.dy) > 3 : false;
            const keys = kp || kr || kt || inp.down('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE') || (s.pad && s.analog) || (inp.touch && inp.touch.active);
            if (moved || keys || g.autopilot.active || p.onGround) {
                this.ap = null;
                g.addFeed('AUTOPILOT OFF — YOU HAVE CONTROL', '#5dffa0');
                return;
            }
            this.flyAp(dt, p, 0, 0, 0);
            g.aimDir.copy(p.vel).normalize(); // (mouse-aim picks up from the flight path)
            return;
        }
        // the video's up: the mouse slews the pod, the wheel zooms, the trigger lases
        const sens = FOVS[this.pod.fov].deg * DEG / Math.max(window.innerHeight, 300) * (g.settings.sensitivity || 1);
        if (mouse.dx || mouse.dy) this.slew(mouse.dx * sens, -mouse.dy * sens);
        if (mouse.wheel) this.zoom(mouse.wheel < 0 ? 1 : -1);
        mouse.dx = mouse.dy = mouse.wheel = 0;
        g.aimDir.copy(p.vel).normalize();
        g.freeLook.yaw = g.freeLook.pitch = 0;
        s.fire = false;
        s.manual = !!(kp || kr);
        if (g.autopilot.active) return; // (the landing autopilot has the jet)
        const c = p.controls;
        if (p.onGround) { c.pitch = c.roll = c.yaw = 0; return; }
        if (!this.ap) this.engageAp();
        this.flyAp(dt, p, kp, kr, kt);
    }

    // Altitude + attitude hold (or an orbit round the SPI) and speed hold, flown through the stick like a pilot:
    // bank by roll rate, the load factor that holds the altitude in that bank, throttle for the speed
    flyAp(dt, p, kp, kr, kt) {
        const ap = this.ap, c = p.controls, f = p.spec.flight, V = Math.max(p.speed, 30);
        if (!ap) return;
        const up = _a.set(0, 1, 0).applyQuaternion(p.qv), right = _b.set(1, 0, 0).applyQuaternion(p.qv);
        const bank = Math.atan2(-right.y, up.y);
        const hdg = Math.atan2(p.vel.x, -p.vel.z);
        // control stick steering: A/D roll to a new bank that's then held; W/S move the altitude; Z/Shift the speed
        if (kr) {
            if (ap.mode === 'orbit') { ap.mode = 'hold'; ap.bank = bank; }
            ap.bank = clamp(ap.bank + kr * 30 * DEG * dt, -60 * DEG, 60 * DEG);
            ap.hdg = null;
        } else if (ap.mode === 'hold' && ap.hdg == null && Math.abs(ap.bank) < 6 * DEG) { ap.bank = 0; ap.hdg = hdg; }
        if (kp) ap.alt += kp * 35 * dt;
        const rs = refSpeeds(p.spec);
        if (kt) ap.speed = clamp(ap.speed + kt * 15 * dt, rs.approach * 1.3, (f.speed || 400) * 0.95);
        const ground = groundH(p.pos.x, p.pos.z);
        ap.alt = Math.max(ap.alt, ground + 250);
        // roll
        let want = ap.bank;
        if (ap.mode === 'orbit' && this.pod.hasSpi) want = orbitBank(p.pos, p.vel, this.pod.spi, ap.R, ap.dir);
        else if (ap.hdg != null) want = clamp(wrapPi(ap.hdg - hdg) * 2.2, -30 * DEG, 30 * DEG);
        const rollAuth = f.roll * clamp(V / 90, 0.12, 1), rollGain = Math.min(4, (p.rollResp || 5) * 0.4);
        c.roll = clamp(rollGain * (want - bank) / rollAuth, -1, 1);
        c.yaw = 0;
        // pitch: the G that holds (or regains) the altitude in this bank
        const vsWant = clamp((ap.alt - p.pos.y) * 0.3, -40, 40);
        const av = clamp((vsWant - p.vel.y) * 0.8, -0.45 * G, 0.45 * G);
        const n = clamp((G + av) / (G * Math.max(Math.cos(clamp(bank, -1.35, 1.35)), 0.3)), -1, f.gLimit * 0.8);
        const nN = Math.max(0, up.y);
        c.pitch = n >= nN ? (n - nN) / Math.max(f.gLimit - nN, 0.5) : (n - nN) / (nN + 3);
        c.pitch = clamp(c.pitch, -0.6, 1);
        if (c.pitch > 0) c.pitch = Math.min(c.pitch, Math.max(p.pullAvail ?? 1, 0.04));
        // speed
        const err = ap.speed - p.speed;
        ap.thr = clamp(ap.thr + err * 0.01 * dt, 0.05, p.hasAB ? 0.9 : 1);
        c.throttle = clamp(ap.thr + err * 0.04, 0.02, p.hasAB ? 0.9 : 1);
        p.airbrake = err < -25;
        // the ground collision avoidance has the last word
        ap.status = ap.mode === 'orbit' ? 'ORBIT ' + (ap.R / 1000).toFixed(1) + ' KM' : ap.hdg != null ? 'ALT · HDG' : 'ALT · ATT';
        if (avoidTerrain(p, c, 180)) { ap.alt = Math.max(ap.alt, p.pos.y + 100); ap.status = 'TERRAIN — CLIMBING'; }
    }

    // ═════════════ Actions ═════════════
    onAction(a) {
        const g = this.game;
        if (a === 'tgp') {
            if (!this.flying) return false;
            if (this.view) this.closeView(); else this.openView();
            return true;
        }
        if (a === 'designate') {
            if (!g.war.enabled || !this.flying) return false;
            if (this.view) { this.markFromPod(); return true; }
            const h = this.helmetState();
            if (h) { this.markFromHelmet(h); return true; }
            return false;
        }
        if (!this.view) return false;
        switch (a) {
            case 'target': this.trackUp(); return true;
            case 'click':
                if (!g.input.locked) g.input.lock();
                if (g.input.mouse.left) this.trackUp();
                return true;
            case 'missile': this.trackDown(); return true;
            case 'camera': this.pod.sensor = (this.pod.sensor + 1) % SENSOR_MODES.length; g.audio.tick(1300, 0.04, 0.03); return true;
            case 'nvg': this.pod.sensor = this.pod.sensor === 0 ? 1 : 0; g.audio.tick(1300, 0.04, 0.03); return true;
            case 'hook':
                if (this.ap) this.setOrbit(this.ap.mode !== 'orbit');
                return true;
            case 'missilecam': this.closeView(); return false;
        }
        return false;
    }

    // Comma with the video up: the unit in the track gate (or the tracked one), else the SPI
    markFromPod() {
        const g = this.game, war = g.war, pod = this.pod;
        const u = pod.under || (pod.mode === 'POINT' ? pod.unit : null);
        let d = null;
        if (u) d = war.designate(u, 'tgp');
        else if (pod.hasSpi) d = war.designate({ x: pod.spi.x, y: pod.spi.y, z: pod.spi.z }, 'tgp');
        else war.radio('', 'POD: NO GROUND UNDER THE CROSS', { color: '#9fb2c4', say: false });
        if (d && pod.lasing) d.laser = true;
        return d;
    }

    // ═════════════ Helmet sight ═════════════
    // Head look off the nose (cockpit: the head; chase: the camera turned by free look or padlock)
    helmetState() {
        const g = this.game, p = g.player;
        if (!this.flying || this.view || g.missileCam || (g.strikes && g.strikes.cam) || g.photo || g.spectating) return null;
        const cockpit = g.cameraMode === 'cockpit';
        if (!cockpit && g.cameraMode !== 'chase') return null;
        const look = g.camera.getWorldDirection(this._look || (this._look = new THREE.Vector3()));
        const off = Math.acos(clamp(look.dot(p.getForward(_v)), -1, 1));
        const padlock = g.input.down('KeyC') && g.lockTarget;
        if (off < (cockpit ? 7 : 13) * DEG && !padlock) return null;
        // the jet's own HUD shows through the combiner: the helmet blanks over it
        if (cockpit && g.cockpit && off < 12 * DEG) {
            const r = g.cockpit.hudRect(g.hud.w, g.hud.h);
            if (g.hud.w / 2 > r.x && g.hud.w / 2 < r.x + r.w && g.hud.h / 2 > r.y && g.hud.h / 2 < r.y + r.h) return null;
        }
        return { look, off, cockpit, eye: g.camera.position };
    }

    // what's under the helmet's cross: a unit (one our side knows about, or close enough to see) or the ground
    helmetPick(h) {
        const g = this.game, war = g.war, p = g.player, eye = h.eye, look = h.look;
        let best = null, bs = 1;
        for (const u of war.units) {
            if (u === p || !u.alive) continue;
            const rec = war.recs.get(u);
            _v.subVectors(u.pos, eye);
            const d = _v.length();
            if (d < 20 || d > 20000 || (rec.known < INTEL.CONTACT && d > 5000)) continue;
            const ang = Math.acos(clamp(_v.dot(look) / d, -1, 1));
            // (a head is aimed less finely than a pod: a 3° gate, about the size of the cross's circle)
            const lim = Math.max(3 * DEG, (u.radius || 5) / d * 1.2);
            if (ang > lim) continue;
            if (ang / lim < bs && war.lineOfSight(eye, _v2.copy(u.pos).setY(u.pos.y + 1.5))) { bs = ang / lim; best = u; }
        }
        if (best) return { unit: best, pos: best.pos };
        const hit = rayGround(eye, look, groundH, 30000, this._hmdHit || (this._hmdHit = new THREE.Vector3()));
        return hit ? { unit: null, pos: hit } : null;
    }

    markFromHelmet(h) {
        const war = this.game.war;
        const pick = this.helmetPick(h);
        if (!pick) { war.radio('', 'HMCS: NO GROUND UNDER THE CROSS', { color: '#9fb2c4', say: false }); return null; }
        return war.designate(pick.unit || { x: pick.pos.x, y: pick.pos.y, z: pick.pos.z }, 'hmcs');
    }

    // ═════════════ Radar picture ═════════════
    // A track file for air contacts: heading, altitude and speed as they were when a sensor last had them
    updateTracks() {
        const war = this.game.war;
        if (!war || !war.enabled) return;
        for (const u of war.units) {
            const rec = war.recs.get(u);
            if (rec.cls !== 'aircraft' && rec.cls !== 'helicopter') continue;
            let t = this.tracks.get(u);
            if (!t) { t = { vel: new THREE.Vector3(), alt: 0, speed: 0, t: -1e9 }; this.tracks.set(u, t); }
            const live = rec.team === war.side;
            if (live || rec.lastSeen > t.t) {
                t.t = live ? war.time : rec.lastSeen;
                if (u.vel) t.vel.copy(u.vel);
                t.alt = u.pos.y; t.speed = u.vel ? u.vel.length() : 0;
            }
        }
        if (this.tracks.size > war.units.length + 20) for (const u of this.tracks.keys()) if (!war.recs.has(u)) this.tracks.delete(u);
    }

    // ═════════════ BDA ═════════════
    // strikes.watchers: the pod's video is on a point (in the picture, in range, nothing in the way)
    podSees(pos) {
        const pod = this.pod;
        if (!this.view || !pod.on || pod.masked) return false;
        _c.subVectors(pos, pod.pos);
        const d = _c.length();
        if (d > 22000) return false;
        const fovR = FOVS[pod.fov].deg * DEG;
        if (Math.acos(clamp(_c.dot(pod.los) / d, -1, 1)) > fovR * 0.45) return false;
        const ok = terrainClear(pod.pos, _c.copy(pos).setY(pos.y + 4)) && this.sightT(pod.pos, _c) > 0.35;
        if (ok) { pod.bda = pos; pod.bdaT = this.game.time; }
        return ok;
    }

    // A BDA result is in: if the pod (or the pilot) was looking, keep the frame (captured after this frame renders)
    onBDA(e) {
        const g = this.game, aim = e.aim;
        if (!aim) return;
        const pos = aim.unit ? aim.unit.pos : aim.pos;
        let source = null;
        if (this.view && (this.podSees(pos) || (this.pod.bda && g.time - this.pod.bdaT < 1 && this.pod.bda.distanceTo(pos) < 60))) source = 'TGP';
        else if (!this.view && this.flying) {
            const cam = g.camera, d = cam.position.distanceTo(pos);
            if (d < 9000 && _v.subVectors(pos, cam.position).dot(cam.getWorldDirection(_v2)) > d * 0.8) source = 'HUD';
        }
        if (source) this.captures.push({ source, e, pos: pos.clone(), t: g.time });
    }

    capture(cp, hud) {
        const g = this.game, war = g.war;
        const src = this.canvas3d || (this.canvas3d = document.querySelector('#app canvas'));
        if (!src || !src.width) return;
        const W = 320, H = 240;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        // crop round the point (the pod's cross; with the pilot's eyes, where it projects)
        const P = hud.project(cp.pos, g.camera, {});
        const sx = src.width / hud.w, sy = src.height / hud.h;
        const ch = src.height * (cp.source === 'TGP' ? 0.62 : 0.34), cw = ch * W / H;
        const cx = cp.source === 'TGP' || !P.front ? src.width / 2 : P.x * sx, cy = cp.source === 'TGP' || !P.front ? src.height / 2 : P.y * sy;
        const x0 = clamp(cx - cw / 2, 0, src.width - cw), y0 = clamp(cy - ch / 2, 0, src.height - ch);
        // the pilot's view is in colour: take it to the FLIR's grey
        if (cp.source !== 'TGP') ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.05)';
        try { ctx.drawImage(src, x0, y0, cw, ch, 0, 0, W, H); } catch (err) { return; }
        ctx.filter = 'none';
        // sensor texture: scan lines and grain
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1);
        for (let i = 0; i < 700; i++) { const v = Math.random() < 0.5 ? 0 : 255; ctx.fillStyle = `rgba(${v},${v},${v},0.08)`; ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
        // symbology
        const aim = cp.e.aim, st = cp.e.strike;
        const ox = cp.source === 'TGP' || !P.front ? W / 2 : W / 2 + (P.x * sx - (x0 + cw / 2)) * W / cw;
        const oy = cp.source === 'TGP' || !P.front ? H / 2 : H / 2 + (P.y * sy - (y0 + ch / 2)) * H / ch;
        ctx.strokeStyle = 'rgba(240,248,240,0.9)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox - 60, oy); ctx.lineTo(ox - 8, oy); ctx.moveTo(ox + 8, oy); ctx.lineTo(ox + 60, oy);
        ctx.moveTo(ox, oy - 60); ctx.lineTo(ox, oy - 8); ctx.moveTo(ox, oy + 8); ctx.lineTo(ox, oy + 60);
        ctx.stroke();
        ctx.font = '600 10px ' + FONT; ctx.textBaseline = 'top';
        const txt = (s, x, y, al = 'left', col = '#eef6ee') => {
            ctx.textAlign = al; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(s, x, y); ctx.fillStyle = col; ctx.fillText(s, x, y);
        };
        const pod = this.pod;
        txt(cp.source === 'TGP' ? 'TGP  ' + SENSOR_MODES[pod.sensor] + '  ' + FOVS[pod.fov].name : 'HUD VIDEO', 6, 5);
        txt('STRIKE ' + (st ? st.id : '-') + (aim.mark ? ' · M' + aim.mark.id : ''), W - 6, 5, 'right');
        const grid = war.grid(cp.pos.x, cp.pos.z);
        txt(grid + '  ' + Math.round(cp.pos.y * M_TO_FT).toLocaleString('en-US') + ' FT', 6, H - 32);
        txt(this.zulu(), W - 6, H - 32, 'right');
        const res = cp.e.result || '';
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, H - 17, W, 17);
        txt(res.split(' —')[0], W / 2, H - 14, 'center', /DESTROYED/.test(res) ? '#7dffb0' : '#ffd24a');
        const img = {
            canvas: c, pos: cp.pos.clone(), t: g.time, clock: this.zulu(), mission: g.clockText ? g.clockText() : '', result: res, label: aim.label || '',
            grid, source: cp.source, strike: st, aim, mark: aim.mark || null, unit: aim.unit || null,
        };
        aim.imagery = img;
        this.imagery.push(img);
        if (this.imagery.length > 24) this.imagery.shift();
        g.addFeed((cp.source === 'TGP' ? 'TGP' : 'HUD') + ' IMAGERY RECORDED — TACTICAL MAP (`) TO REVIEW', '#9fd4ff');
        g.events.emit('bdaImagery', img);
    }

    zulu() {
        const g = this.game;
        const s = Math.floor((ZULU0[g.world.timeKey] ?? ZULU0.day) + (g.missionTime || 0)) % 86400;
        const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
        return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0') + 'Z';
    }

    // ═════════════ Command menu ═════════════
    commands() {
        const g = this.game, war = g.war, pod = this.pod;
        if (!war.enabled || !this.hasPod(g.player)) return [];
        const P = ['TARGETING POD'];
        const out = [
            { path: P, label: this.view ? 'POD VIDEO OFF' : 'POD VIDEO ON', hint: 'PERIOD', run: () => { if (this.view) this.closeView(); else if (this.flying) this.openView(); } },
            { path: P, label: 'SLAVE TO STEERPOINT', hint: g.navTarget ? g.navTarget.label : 'NO STEERPOINT', enabled: !!(g.navTarget && g.navTarget.pos), run: () => this.slaveTo(g.navTarget.pos) },
        ];
        for (const d of war.designations.slice(-5)) out.push({ path: P, label: 'SLAVE TO MARK ' + d.id + ' — ' + d.label, run: () => this.slaveTo(d.unit && d.unit.alive ? d.unit : (d.fixed || d.pos)) });
        out.push({ path: P, label: 'SENSOR: ' + SENSOR_MODES[(pod.sensor + 1) % 3], hint: 'V', run: () => { pod.sensor = (pod.sensor + 1) % 3; }, keepOpen: true });
        out.push({ path: P, label: this.ap && this.ap.mode === 'orbit' ? 'AUTOPILOT: HOLD ALTITUDE + ATTITUDE' : 'AUTOPILOT: ORBIT THE SPI', hint: 'H', enabled: this.view && !!this.ap, run: () => this.setOrbit(!(this.ap && this.ap.mode === 'orbit')) });
        out.push({ path: P, label: 'POD OFF', enabled: pod.on, run: () => { this.closeView(); pod.on = false; } });
        out.push({ path: ['DESIGNATION'], label: 'MARK POD SPI', hint: pod.on && pod.hasSpi ? war.grid(pod.spi.x, pod.spi.z) : 'POD NOT TRACKING', enabled: pod.on && pod.hasSpi, run: () => this.markFromPod() });
        return out;
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        const g = this.game;
        // imagery to take from the frame that's just been drawn
        while (this.captures.length) this.capture(this.captures.shift(), hud);
        if (g.photo || g.hideHud || !g.player) return;
        if (this.view) { this.drawPod(ctx, hud); return; }
        if (!this.flying) return;
        if (this.pod.on && this.pod.hasSpi) this.drawPodCue(ctx, hud);
        const h = this.helmetState();
        if (h) this.drawHelmet(ctx, hud, h);
        if (this.ap && this.ap.handback) {
            ctx.font = '700 14px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#5ab8ff';
            ctx.fillText('TGP AUTOPILOT · ' + this.ap.status + ' · ' + Math.round(this.ap.alt * M_TO_FT).toLocaleString('en-US') + ' FT — MOVE THE STICK TO TAKE CONTROL', hud.w / 2, hud.h * 0.2 + (g.autopilot.active ? 48 : 0), hud.w - 30);
        }
    }

    // the pod's line of sight in the HUD while its video is down: a TD box with the track mode
    drawPodCue(ctx, hud) {
        const g = this.game, pod = this.pod;
        const P = hud.project(pod.spi, g.camera, {});
        if (!P.front || P.x < 0 || P.y < 0 || P.x > hud.w || P.y > hud.h) return;
        const cockpit = g.cameraMode === 'cockpit';
        ctx.strokeStyle = cockpit ? HMD : 'rgba(233,242,234,0.9)'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.4;
        ctx.strokeRect(P.x - 7, P.y - 7, 14, 14);
        ctx.fillRect(P.x - 1, P.y - 1, 2, 2);
        ctx.font = '600 11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('TGP ' + pod.mode, P.x + 11, P.y + 9);
    }

    // JHMCS-style symbology on the visor: the aiming cross in its circle, a target designator box on what's under
    // it, and a data block set well clear of the cross (airspeed left, altitude right, heading and how far off the
    // nose above, the target below)
    drawHelmet(ctx, hud, h) {
        // (what's under the cross, ten times a second: the ground ray is a march over the terrain)
        const c = this._hmdPick || (this._hmdPick = { t: -1, pick: null, pos: new THREE.Vector3() });
        if (this.game.time - c.t > 0.1 || this.game.time < c.t) {
            c.t = this.game.time;
            const pk = this.helmetPick(h);
            c.pick = pk ? { unit: pk.unit, pos: c.pos.copy(pk.pos) } : null;
        }
        const pick = c.pick;
        const cx = hud.w / 2, cy = hud.h / 2, g = this.game, war = g.war, p = g.player;
        const r = clamp(hud.h * 0.03 * 57.3 / g.camera.fov, 16, 40);
        ctx.lineWidth = 2; ctx.strokeStyle = HMD; ctx.fillStyle = HMD;
        // (a dark rim under the lines so they read over the HUD's own labels and bright ground)
        const cross = () => {
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.moveTo(cx - 13, cy); ctx.lineTo(cx - 4, cy); ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 13, cy);
            ctx.moveTo(cx, cy - 13); ctx.lineTo(cx, cy - 4); ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + 13);
            ctx.stroke();
        };
        ctx.strokeStyle = 'rgba(0,16,8,0.55)'; ctx.lineWidth = 4; cross();
        ctx.strokeStyle = HMD; ctx.lineWidth = 2; cross();
        ctx.textBaseline = 'middle';
        ctx.font = '700 15px ' + FONT;
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(p.speed * MS_TO_KTS) + '', cx - r - 70, cy);
        ctx.textAlign = 'left';
        ctx.fillText(Math.round(p.pos.y * M_TO_FT).toLocaleString('en-US'), cx + r + 70, cy);
        ctx.textAlign = 'center';
        const hdg = Math.round(((Math.atan2(h.look.x, -h.look.z) / DEG) + 360) % 360);
        ctx.fillText(String(hdg).padStart(3, '0'), cx, cy - r - 44);
        ctx.font = '600 12px ' + FONT;
        ctx.fillText('HMCS · ' + Math.round(h.off / DEG) + '° OFF NOSE', cx, cy - r - 26);
        if (!pick) return;
        const d = pick.pos.distanceTo(p.pos);
        let ty = cy + r + 24;
        ctx.font = '700 13px ' + FONT;
        if (pick.unit) {
            // target designator box
            const P = hud.project(pick.unit.pos, g.camera, {});
            const s = clamp(3000 / Math.max(d, 1), 9, 28);
            if (P.front) {
                ctx.strokeStyle = 'rgba(0,16,8,0.55)'; ctx.lineWidth = 4; ctx.strokeRect(P.x - s, P.y - s, s * 2, s * 2);
                ctx.strokeStyle = HMD; ctx.lineWidth = 2; ctx.strokeRect(P.x - s, P.y - s, s * 2, s * 2);
            }
            const rec = war.recs.get(pick.unit);
            ctx.fillStyle = rec && rec.team === war.side ? '#6fb4ff' : rec && rec.known >= INTEL.IDENTIFIED ? '#ff9f5a' : '#ffd24a';
            ctx.fillText('TD ' + war.label(pick.unit), cx, ty);
            ty += 18;
            ctx.fillStyle = HMD;
        }
        ctx.fillText((d / 1000).toFixed(1) + ' KM · ' + war.grid(pick.pos.x, pick.pos.z), cx, ty);
        ctx.font = '600 11px ' + FONT;
        ctx.fillStyle = 'rgba(93,255,160,0.7)';
        ctx.fillText('COMMA: MARK', cx, ty + 17);
    }

    // The pod's display over its video (Sniper / LITENING page, full screen)
    drawPod(ctx, hud) {
        const g = this.game, war = g.war, pod = this.pod, p = g.player, W = hud.w, H = hud.h;
        const cx = W / 2, cy = H / 2, S = Math.min(H * 0.84, W * 0.7), L = cx - S / 2, R = cx + S / 2, T = cy - S / 2, B = cy + S / 2;
        const blink = (hud.t * 3) % 1 < 0.55, fast = (hud.t * 5) % 1 < 0.5;
        const mono = (w, px) => (ctx.font = w + ' ' + px + 'px ' + FONT);
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = SYM; ctx.fillStyle = SYM;
        // the display area's corners
        const k = S * 0.05;
        ctx.beginPath();
        for (const [x, y, sx, sy] of [[L, T, 1, 1], [R, T, -1, 1], [R, B, -1, -1], [L, B, 1, -1]]) { ctx.moveTo(x, y + sy * k); ctx.lineTo(x, y); ctx.lineTo(x + sx * k, y); }
        ctx.stroke();
        // cross hairs: from the display's edges to a gap round the centre
        const gap = S * 0.035;
        ctx.beginPath();
        ctx.moveTo(L + S * 0.06, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(R - S * 0.06, cy);
        ctx.moveTo(cx, T + S * 0.06); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, B - S * 0.06);
        ctx.stroke();
        // (the next field of view in: corner marks)
        if (pod.fov < FOVS.length - 1) {
            const f = FOVS[pod.fov + 1].deg / FOVS[pod.fov].deg * H / 2, m = f * 0.25;
            ctx.strokeStyle = SYM_DIM;
            ctx.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx * f, cy + sy * (f - m)); ctx.lineTo(cx + sx * f, cy + sy * f); ctx.lineTo(cx + sx * (f - m), cy + sy * f); }
            ctx.stroke();
            ctx.strokeStyle = SYM;
        }
        // point track gate round the unit
        const cam = g.camera;
        if ((pod.mode === 'POINT' || pod.mode === 'INR') && pod.unit) {
            const Pp = hud.project(pod.mode === 'INR' ? pod.spi : drawnPos(pod.unit, _v3), cam, {});
            if (Pp.front) {
                const s = clamp((pod.unit.radius || 5) / Math.max(pod.range, 1) / (FOVS[pod.fov].deg * DEG) * H * 1.1, 9, S * 0.3);
                ctx.lineWidth = 1.6;
                if (pod.mode === 'INR') ctx.setLineDash([4, 4]);
                ctx.strokeRect(Pp.x - s, Pp.y - s, s * 2, s * 2);
                ctx.setLineDash([]);
                ctx.lineWidth = 1.2;
            }
        }
        // what's in the gate, and how far its identification has got
        const under = pod.under || (pod.mode === 'POINT' ? pod.unit : null);
        if (under) {
            const rec = war.recs.get(under);
            if (rec) {
                const own = rec.team === war.side;
                mono('600', 12);
                ctx.textAlign = 'center';
                ctx.fillStyle = own ? '#8fc8ff' : rec.known >= INTEL.IDENTIFIED ? '#ffb27a' : '#ffe07a';
                const st = pod.dwell.get(under);
                const id = own ? 'FRIENDLY' : rec.known >= INTEL.IDENTIFIED ? INTEL_NAMES[rec.known] : st && st.t > 0 ? 'IDENTIFYING ' + Math.min(99, Math.round(st.t / 0.9 * 100)) + '%' : INTEL_NAMES[rec.known];
                ctx.fillText(war.label(under) + (under.alive ? '' : ' (DESTROYED)') + ' · ' + id, cx, cy + gap + 30);
                ctx.fillStyle = SYM;
            }
        }
        // top: master mode, sensor, field of view, track status, laser
        mono('700', 15);
        ctx.textAlign = 'left';
        ctx.fillText('A-G', L, T - 16);
        ctx.fillText(SENSOR_MODES[pod.sensor], L + 52, T - 16);
        ctx.fillText(FOVS[pod.fov].name, L + 112, T - 16);
        mono('600', 11);
        ctx.fillStyle = SYM_DIM;
        ctx.fillText(FOVS[pod.fov].deg + '°', L + 162, T - 15);
        ctx.fillStyle = SYM;
        mono('700', 17);
        ctx.textAlign = 'center';
        ctx.fillText(pod.mode, cx, T - 16);
        mono('700', 15);
        ctx.textAlign = 'right';
        ctx.fillText('CMBT  ' + (pod.lasing ? (fast ? 'LASE' : '') : 'ARM'), R, T - 16);
        mono('600', 11);
        ctx.fillStyle = SYM_DIM;
        ctx.fillText('LSR ' + POD.code, R, T + 2);
        ctx.fillStyle = SYM;
        // warnings in the middle
        mono('700', 18);
        ctx.textAlign = 'center';
        let wy = cy - gap - 34;
        const warn = (t, col = WARN) => { ctx.fillStyle = col; ctx.fillText(t, cx, wy); wy -= 24; ctx.fillStyle = SYM; };
        if (pod.limit) warn('GIMBAL LIMIT');
        else if (pod.masked) warn('MASK');
        else if (pod.maskSoon && blink) warn('MASK');
        if (pod.cloud) warn('CLOUD');
        if (pod.mode === 'INR' && blink) warn('INR — TRACK LOST', SYM);
        if (pod.bda && g.time - pod.bdaT < 0.3) {
            const b = g.strikes && g.strikes.bda.find(x => x.pos === pod.bda || x.pos.distanceTo(pod.bda) < 1);
            warn('BDA IMAGERY ' + (b ? Math.min(99, Math.round(b.look / 2.2 * 100)) + '%' : ''), '#7dffb0');
        }
        // left: gimbal angles and the line-of-sight cue
        _q.copy(p.quat).invert();
        const bl = _v.copy(pod.los).applyQuaternion(_q);
        const ga = gimbalAngles(bl);
        mono('600', 13);
        ctx.textAlign = 'right';
        const lx = L - 14;
        ctx.fillText('AZ ' + (ga.az >= 0 ? 'R' : 'L') + String(Math.round(Math.abs(ga.az) / DEG)).padStart(3, '0'), lx, cy - 64);
        ctx.fillText('EL ' + (ga.el >= 0 ? '+' : '-') + String(Math.round(Math.abs(ga.el) / DEG)).padStart(2, '0'), lx, cy - 46);
        // the cue: the nose in the middle, 180° off it at the rim, the gimbal's aft stop dashed
        const gr = Math.min(40, S * 0.06), gx = lx - gr, gy = cy + 6;
        ctx.strokeStyle = SYM_DIM;
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(gx, gy, gr * POD.maxOffNose / Math.PI, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(gx - 6, gy); ctx.lineTo(gx + 6, gy); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx, gy + 3); ctx.stroke();
        const phi = Math.atan2(bl.x, bl.y), rr = gr * ga.off / Math.PI;
        ctx.fillStyle = pod.masked ? (blink ? WARN : 'transparent') : SYM;
        ctx.beginPath(); ctx.arc(gx + Math.sin(phi) * rr, gy - Math.cos(phi) * rr, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = SYM_DIM;
        mono('600', 10);
        ctx.textAlign = 'center';
        ctx.fillText('LOS', gx, gy + gr + 10);
        ctx.fillStyle = SYM;
        // bottom left: slant range (T: from the geometry, L: laser ranged)
        mono('700', 16);
        ctx.textAlign = 'left';
        const rng = pod.lasing ? (pod.lrange / 1000).toFixed(2) : (pod.range / 1000).toFixed(1);
        if (pod.hasSpi) ctx.fillText((pod.lasing ? (fast ? 'L' : ' ') : 'T') + ' ' + rng + ' KM', L, B + 18);
        mono('600', 12);
        ctx.fillStyle = SYM_DIM;
        if (pod.hasSpi) ctx.fillText('TGT ELEV ' + Math.round(pod.spi.y * M_TO_FT).toLocaleString('en-US') + ' FT', L, B + 36);
        ctx.fillStyle = SYM;
        // bottom centre: where the SPI is
        mono('700', 16);
        ctx.textAlign = 'center';
        if (pod.hasSpi) {
            ctx.fillText(war.grid(pod.spi.x, pod.spi.z), cx, B + 18);
            const br = war.bearingRange(p.pos, pod.spi);
            mono('600', 12);
            ctx.fillStyle = SYM_DIM;
            ctx.fillText('BRG ' + String(br.brg).padStart(3, '0') + '° · ' + br.km.toFixed(1) + ' KM', cx, B + 36);
            ctx.fillStyle = SYM;
        } else { mono('600', 13); ctx.fillText('SPACE STABILISED', cx, B + 18); }
        // bottom right: status words
        mono('700', 15);
        ctx.textAlign = 'right';
        const words = [pod.mode === 'POINT' || pod.mode === 'AREA' ? 'TRACK' : pod.mode === 'INR' ? 'COAST' : 'SLEW', 'ARM'];
        if (pod.lasing && fast) words.push('LASE');
        ctx.fillText(words.join('  '), R, B + 18);
        // right: a small attitude indicator and the flight data (the pod's picture is all the pilot sees)
        this.drawAdi(ctx, R + 16, cy - 60, Math.min(120, (W - R) - 30), p);
        // keys
        mono('600', 11);
        ctx.fillStyle = 'rgba(233,242,234,0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('. VIDEO OFF · MOUSE/ARROWS SLEW · WHEEL/+− FOV · T/LMB TRACK · RMB BREAK · C SLAVE · V SENSOR · SPACE LASE · , MARK · H ORBIT · \\ COMMAND', cx, H - 14, W - 20);
        ctx.fillStyle = SYM;
    }

    drawAdi(ctx, x, y, w, p) {
        if (w < 70) return;
        const h = w * 0.7, cxa = x + w / 2, cya = y + h / 2;
        const up = _a.set(0, 1, 0).applyQuaternion(p.quat), right = _b.set(1, 0, 0).applyQuaternion(p.quat), fwd = p.getForward(_c);
        const bank = Math.atan2(-right.y, up.y), pitch = Math.asin(clamp(fwd.y, -1, 1));
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y, w, h);
        ctx.translate(cxa, cya); ctx.rotate(-bank);
        const py = pitch / (30 * DEG) * h / 2;
        ctx.fillStyle = 'rgba(120,150,170,0.28)'; ctx.fillRect(-w, -h * 2 + py, w * 2, h * 2);
        ctx.strokeStyle = SYM; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-w, py); ctx.lineTo(w, py); ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = SYM_DIM;
        for (const pdeg of [-20, -10, 10, 20]) {
            const yy = py - pdeg / 30 * h / 2, hw = w * 0.12;
            ctx.beginPath(); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = SYM; ctx.lineWidth = 1.2;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        // the jet
        ctx.strokeStyle = WARN; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cxa - w * 0.22, cya); ctx.lineTo(cxa - w * 0.07, cya); ctx.lineTo(cxa, cya + 5); ctx.lineTo(cxa + w * 0.07, cya); ctx.lineTo(cxa + w * 0.22, cya); ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.fillStyle = SYM; ctx.textAlign = 'left';
        ctx.font = '700 14px ' + FONT;
        const hdg = Math.round(((Math.atan2(p.vel.x, -p.vel.z) / DEG) + 360) % 360);
        ctx.fillText(Math.round(p.pos.y * M_TO_FT).toLocaleString('en-US') + ' FT', x, y + h + 16);
        ctx.fillText(Math.round(p.speed * MS_TO_KTS) + ' KT', x, y + h + 34);
        ctx.fillText('HDG ' + String(hdg).padStart(3, '0'), x, y + h + 52);
        ctx.font = '600 12px ' + FONT;
        const ap = this.ap, g = this.game;
        ctx.fillStyle = '#8fc8ff';
        const apText = g.autopilot.active ? 'AP ' + g.autopilot.active.toUpperCase() : ap ? 'AP ' + ap.status : 'AP OFF';
        ctx.fillText(apText, x, y + h + 72, w + 40);
        if (ap && !g.autopilot.active) ctx.fillText('SEL ' + Math.round(ap.alt * M_TO_FT).toLocaleString('en-US') + ' · ' + Math.round(ap.speed * MS_TO_KTS) + ' KT', x, y + h + 88, w + 40);
        ctx.fillStyle = SYM;
    }
}
