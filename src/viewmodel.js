// ═══════════════════════════════════════════════════════════════
// First-person view model (on foot): gloved arms holding the current weapon, drawn by the cockpit's
// overlay pass (cockpit.js) with its own near-clip camera, so nothing in the world clips through them.
//   • the arms reach the weapon's grips by IK (ik.js); holds (hand positions / orientations / finger curls)
//     are data in weapon space (HOLDS), shared with the third-person characters (character.js)
//   • hip, aimed down the sights (the sight line on the camera's axis), sprinting (weapon lowered)
//   • sway, walk bob, landing dip; the kick of each shot with its moving parts: the AK's bolt carrier, the
//     pistols' slides (locked back when empty), the shotgun's pump stroke, the RPG's rocket leaving
//   • reloads: magazines out and in (rocked in on the AK), shell by shell into the shotgun, a new rocket into
//     the RPG; the charging handle / slide release after an empty magazine
//   • grenade: pin pulled, cocked back, thrown (the spoon flies off)
//   • switching (the old weapon drops out of view, the new one comes up), muzzle flash + light, brass
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { weaponModel, restParts, armsModel, caseGeometry } from './weaponmodels.js';
import { ArmIK, frameQuat, fingerChains } from './ik.js';
import { weaponDef } from './arsenal.js';
import { holdFor } from './holds.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const NO_SIGHT = new THREE.Vector3(0, 0.05, 0), NO_FRONT = new THREE.Vector3(0, 0.05, -0.3);
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
// piecewise-linear keys [[t, v], ...] (t ascending), smoothed between keys
function key(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i][0]) { const [t0, a] = keys[i - 1], [t1, b] = keys[i]; return a + (b - a) * ease((t - t0) / Math.max(t1 - t0, 1e-6)); }
    }
    return keys[keys.length - 1][1];
}

export class ViewModel {
    constructor(camera) {
        this.camera = camera;
        this.root = new THREE.Group();     // follows the camera
        this.gunNode = new THREE.Group();  // the weapon's grip frame (camera space)
        this.root.add(this.gunNode);
        camera.add(this.root);
        this.models = {};
        this.cur = null;
        this.curId = null;
        this.t = 0;
        this.kick = 0; this.kickRoll = 0; this.kickYaw = 0; this.shotT = 9;
        this.bob = 0; this.swayX = 0; this.swayY = 0; this.lastYaw = null; this.lastPitch = null;
        this.sprintK = 0; this.landK = 0;
        this.throwT = -1;
        this.arms = null; // made on first use (the models load after the cockpit is built)
        // muzzle flash: two crossed additive sprites-worth of star (a camera-facing sprite and a side-on quad)
        const flashTex = makeFlashTex();
        this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 1.7, 1.1) }));
        this.flash.visible = false;
        this.flashSide = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: makeFlashTex(true), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(2, 1.5, 0.9) }));
        this.flashSide.visible = false;
        this.light = new THREE.PointLight(0xffa850, 0, 2.5, 2);
        this.root.add(this.flash, this.flashSide, this.light);
        // brass: a small pool of spent cases flying out of the ejection port (camera space)
        this.cases = [];
        this.caseKind = null;
        // a shell / magazine / rocket held in the left hand during reloads
        this.inHand = null;
        this.root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        this.root.visible = false;
    }

    // the gloved arms, scaled to a real forearm (~27 cm), with an IK chain each
    ensureArms() {
        if (this.arms || this.armsTried) return this.arms;
        const arms = armsModel();
        if (!arms) return null;
        this.armsTried = true;
        this.arms = arms;
        this.root.add(arms.root);
        this.root.updateMatrixWorld(true);
        const B = arms.bones, find = (n) => B[n];
        const fl = new THREE.Vector3().setFromMatrixPosition(B.R_elbow.matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(B.R_wrist.matrixWorld));
        arms.root.scale.multiplyScalar(0.265 / Math.max(fl, 1e-6));
        this.root.updateMatrixWorld(true);
        this.ikR = new ArmIK({ upper: B.R_arm, lower: B.R_elbow, hand: B.R_wrist, fingers: fingerChains(find, 'R', 'fp') }, 'R');
        this.ikL = new ArmIK({ upper: B.L_arm, lower: B.L_elbow, hand: B.L_wrist, fingers: fingerChains(find, 'L', 'fp') }, 'L');
        return arms;
    }

    // build every weapon now (hidden), so a shader compile pass can see them before they're first drawn
    prewarm(ids) {
        this.ensureArms();
        for (const id of ids) this.model(id);
    }

    model(id) {
        if (!this.models[id]) {
            const w = weaponModel(id, { lod: 0, shadows: false });
            w.root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
            w.root.visible = false;
            this.gunNode.add(w.root);
            // spare magazine / shell / rocket for the reload hand
            this.models[id] = w;
        }
        return this.models[id];
    }

    setWeapon(id) {
        if (id === this.curId) return;
        if (this.cur) this.cur.root.visible = false;
        this.curId = id;
        this.cur = id ? this.model(id) : null;
        if (this.cur) { this.cur.root.visible = true; restParts(this.cur); }
        this.dropInHand();
    }

    dropInHand() { if (this.inHand) { this.inHand.parent && this.inHand.parent.remove(this.inHand); this.inHand = null; this.inHandKind = null; } }

    // a copy of one of the current weapon's parts to carry in the left hand (the fresh magazine, a shell, a rocket)
    carry(kind) {
        if (this.inHandKind === kind) return this.inHand;
        this.dropInHand();
        const w = this.cur;
        let obj = null;
        if (kind === 'mag' && w.parts.mag) obj = w.parts.mag.clone(true);
        else if (kind === 'rocket' && w.parts.rocket) obj = w.parts.rocket.clone(true);
        else if (kind === 'shell') { const c = caseGeometry('shell'); obj = new THREE.Mesh(c.geo, c.mat); }
        if (!obj) return null;
        obj.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
        this.gunNode.add(obj);
        this.inHand = obj; this.inHandKind = kind;
        return obj;
    }

    // ── per frame (pm: PilotOnFoot) ──
    update(dt, game, pm) {
        const cam = this.camera;
        this.t += dt;
        this.ensureArms();
        const gun = pm.gun, id = gun ? gun.id : null;
        const sw = pm.switching;
        const showId = sw && sw.t < sw.dur / 2 ? sw.from : id;
        this.setWeapon(showId);
        this.root.visible = !!this.cur;
        if (!this.cur) return;
        const w = this.cur, def = weaponDef(w.id), H = holdFor(w.id);
        const P = w.points;
        // ── where the weapon sits (camera space): hip ↔ ADS, sprint, switch ──
        const ads = pm.adsK || 0;
        const hipPos = _v.fromArray(H.hip.pos), hipRot = H.hip.rot;
        // ADS: the rear sight on the camera axis, `eye` in front of it, the sight line straight ahead
        const sight = P.sight || P.muzzle || NO_SIGHT, front = P.sightFront || P.muzzle || NO_FRONT; // (a grenade has no sights)
        const slope = Math.atan2(front.y - sight.y, -(front.z - sight.z) || 1);
        const adsPos = _v2.set(-sight.x, -sight.y - (H.ads.lift || 0), -H.ads.eye - sight.z); // (lift: the eye a little above a flat rib)
        const pos = _v3.copy(hipPos).lerp(adsPos, ease(ads));
        let rx = hipRot[0] * (1 - ads) + slope * ads, ry = hipRot[1] * (1 - ads), rz = hipRot[2] * (1 - ads);
        // sprint: lowered and canted
        this.sprintK += ((pm.sprinting && ads < 0.1 && !gun.reloading ? 1 : 0) - this.sprintK) * Math.min(1, dt * 7);
        if (this.sprintK > 0.001) {
            const s = ease(this.sprintK);
            pos.lerp(_v4.fromArray(H.sprint.pos), s);
            rx += H.sprint.rot[0] * s; ry += H.sprint.rot[1] * s; rz += H.sprint.rot[2] * s;
        }
        // switching: down and away, then up
        if (sw) {
            const k = sw.t < sw.dur / 2 ? sw.t / (sw.dur / 2) : 1 - (sw.t - sw.dur / 2) / (sw.dur / 2);
            const e = ease(clamp01(k));
            pos.y -= e * 0.28; pos.x += e * 0.04;
            rx -= e * 0.9; rz += e * 0.35;
        }
        // sway: the weapon lags the view a little
        const yaw = pm.yaw, pitch = pm.pitch;
        if (this.lastYaw !== null) {
            let dy = yaw - this.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            const k = 1 - ads * 0.75;
            this.swayX += (-dy * 1.6 * k - this.swayX) * Math.min(1, dt * 10);
            this.swayY += ((pitch - this.lastPitch) * 1.6 * k - this.swayY) * Math.min(1, dt * 10);
        }
        this.lastYaw = yaw; this.lastPitch = pitch;
        this.swayX *= Math.exp(-6 * dt); this.swayY *= Math.exp(-6 * dt);
        ry += THREE.MathUtils.clamp(this.swayX, -0.08, 0.08); rx += THREE.MathUtils.clamp(this.swayY, -0.08, 0.08);
        pos.x += THREE.MathUtils.clamp(this.swayX, -0.08, 0.08) * 0.1;
        // walk bob (a figure-eight), breathing at rest, a dip on landing
        const sp = pm.moveSpeed || 0;
        this.bob += dt * (sp > 0.3 ? 2.2 + sp * 0.9 : 0);
        const bobA = Math.min(sp, 7) / 7 * (1 - ads * 0.8) * (pm.onGround ? 1 : 0);
        pos.x += Math.sin(this.bob) * 0.012 * bobA;
        pos.y += (Math.abs(Math.cos(this.bob)) - 0.5) * 0.016 * bobA;
        rz += Math.sin(this.bob) * 0.015 * bobA;
        const breathe = 1 - ads * 0.85;
        pos.y += Math.sin(this.t * 1.4) * 0.0018 * breathe;
        rx += Math.sin(this.t * 1.1) * 0.003 * breathe;
        if (pm.landed) this.landK = 1;
        this.landK = Math.max(0, this.landK - dt * 3);
        pos.y -= Math.sin(this.landK * Math.PI) * 0.04;
        // ── the kick of a shot ──
        if (pm.shotFlag) {
            pm.shotFlag = 0;
            this.kick = Math.min(1.4, this.kick + 1);
            this.kickRoll = (Math.random() - 0.5) * 2;
            this.kickYaw = (Math.random() - 0.5) * 2;
            this.shotT = 0;
            this.muzzleFlash(def);
            if (def.type !== 'launcher' && def.type !== 'grenade' && def.fire !== 'pump') this.ejectCase(def);
        }
        this.shotT += dt;
        const kr = def.recoil.kick;
        const kickK = this.kick;
        this.kick = Math.max(0, this.kick - dt * (def.type === 'pistol' ? 9 : 7));
        pos.z += kickK * kr * (1 - ads * 0.45);
        pos.y += kickK * kr * 0.12;
        rx += kickK * kr * (def.type === 'pistol' ? 3.2 : 1.4);
        rz += this.kickRoll * kickK * kr * 0.6;
        ry += this.kickYaw * kickK * kr * 0.25;
        // ── animation of the parts and the hands ──
        const anim = this.animate(dt, pm, w, def, H);
        pos.add(anim.dpos);
        rx += anim.drot.x; ry += anim.drot.y; rz += anim.drot.z;
        this.gunNode.position.copy(pos);
        this.gunNode.quaternion.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
        this.gunNode.updateMatrixWorld(true);
        // ── hands ──
        if (this.arms) this.solveArms(H, w, anim);
        this.updateFlash(dt, w);
        this.updateCases(dt);
        cam.updateMatrixWorld();
    }

    // Parts and hand targets for the current action. Returns { dpos, drot, L: hold | null, R: hold | null }
    animate(dt, pm, w, def, H) {
        const out = this.animOut || (this.animOut = { dpos: new THREE.Vector3(), drot: new THREE.Vector3(), L: null, R: null, Lpos: new THREE.Vector3(), Rpos: new THREE.Vector3() });
        out.dpos.set(0, 0, 0); out.drot.set(0, 0, 0); out.L = H.L; out.R = H.R; out.Lat = null; out.Rat = null;
        const gun = pm.gun, P = w.points, parts = w.parts, rest = w.rest;
        restParts(w);
        if (w.parts.mag && !gun.reloading) w.parts.mag.visible = true;
        const cycleK = this.shotT < 0.25 ? this.shotT : 1;
        // moving parts of the action
        if (parts.bolt && def.fire === 'auto') { // AK bolt carrier: back and home within the cycle
            const c = 60 / def.rpm, k = this.shotT < c ? Math.sin(Math.PI * this.shotT / c) : 0;
            parts.bolt.position.z = rest.bolt.pos.z + k * 0.085;
        }
        if (parts.slide) { // pistols: the slide recoils (and stays back on an empty magazine)
            const k = this.shotT < 0.09 ? Math.sin(Math.PI * this.shotT / 0.09) : 0;
            const locked = gun.mag === 0 && !gun.reloading;
            parts.slide.position.z = rest.slide.pos.z + (locked ? 1 : k) * (w.id === 'deagle' ? 0.045 : 0.035);
            if (parts.hammer) parts.hammer.rotation.x = rest.hammer.quat.x + 0;
        }
        if (parts.rocket) parts.rocket.visible = gun.mag > 0 && !gun.reloading;
        if (parts.pump && gun.pump > 0) { // the pump stroke: back, then home (the left hand rides it)
            const k = 1 - gun.pump / def.pump, s = Math.sin(Math.PI * clamp01(k));
            parts.pump.position.z = rest.pump.pos.z + s * 0.085;
            out.Lat = _v4.copy(P.support).add(_v.set(0, 0, s * 0.085));
        }
        void cycleK;
        // ── reloads ──
        const r = gun.reload;
        if (r) {
            const t = gun.reloadProgress;
            if (r.kind === 'mag' || r.kind === 'empty') this.reloadMag(out, w, def, H, t, r.kind === 'empty');
            else if (r.kind === 'shell') this.reloadShell(out, w, def, H, r);
            else if (r.kind === 'rocket') this.reloadRocket(out, w, def, H, t);
        } else if (this.inHand) this.dropInHand();
        // ── grenade ──
        if (def.type === 'grenade') this.grenadeAnim(out, pm, w);
        // (the targets above may sit in shared scratch vectors: keep them in our own)
        if (out.Lat) out.Lat = out.Lpos.copy(out.Lat);
        if (out.Rat) out.Rat = out.Rpos.copy(out.Rat);
        return out;
    }

    reloadMag(out, w, def, H, t, empty) {
        const P = w.points, mag = w.parts.mag;
        const pistol = def.type === 'pistol';
        // the weapon tilts toward you: roll and pitch up, a touch lower
        const tilt = key([[0, 0], [0.12, 1], [0.8, 1], [empty ? 0.86 : 0.95, empty ? 0.7 : 0], [1, 0]], t);
        out.drot.z += tilt * (pistol ? 0.35 : 0.55);
        out.drot.x += tilt * (pistol ? 0.25 : 0.18);
        out.dpos.y += tilt * 0.03; out.dpos.x -= tilt * 0.03;
        if (!mag) return;
        const magRest = w.rest.mag.pos;
        // the old magazine: out (rocked forward on the AK, straight down on the rest), away down
        const outK = key([[0, 0], [0.2, 0], [0.32, 1]], t);
        const gone = t > 0.34 && t < 0.52;
        const inK = key([[0, 1], [0.5, 1], [0.66, 0.18], [0.7, 0]], t);
        const k = t < 0.42 ? outK : inK;
        mag.visible = !gone;
        if (w.id === 'ak47') {
            mag.rotation.x = w.rest.mag.quat.x + k * 0.55;
            mag.position.set(magRest.x, magRest.y - k * 0.12, magRest.z + k * 0.02);
        } else mag.position.set(magRest.x, magRest.y - k * (pistol ? 0.13 : 0.16), magRest.z);
        // the left hand: to the magazine, down with it, off for a fresh one, back up with it, slap, and (empty)
        // to the charging handle / slide
        const magBase = _v.copy(mag.position).add(_v2.set(0, -0.06, 0.01));
        const offScreen = _v2.set(-0.06, -0.35, 0.1);
        let Lat = null, L = { ...H.L, curl: { thumb: 0.6, index: 0.75, middle: 0.8, ring: 0.85, pinky: 0.85 }, fwd: [0.35, 0.2, -0.9], up: [-0.8, -0.55, 0.0] };
        if (t < 0.1) Lat = _v3.copy(P.support || P.grip).lerp(magBase, ease(t / 0.1));
        else if (t < 0.34) Lat = _v3.copy(magBase);
        else if (t < 0.5) Lat = _v3.copy(magBase).lerp(offScreen, ease((t - 0.34) / 0.16));
        else if (t < 0.72) Lat = _v3.copy(offScreen).lerp(magBase, ease(clamp01((t - 0.5) / 0.16)));
        else if (empty && t < 0.94) {
            const handle = P.charge || _v4.set(0.03, P.eject ? P.eject.y : 0.08, P.eject ? P.eject.z : -0.1);
            const pull = key([[0.72, 0], [0.8, 0], [0.86, 1], [0.9, 0]], t);
            Lat = _v3.copy(magBase).lerp(handle, ease(clamp01((t - 0.72) / 0.08)));
            if (w.parts.bolt) { w.parts.bolt.position.z = w.rest.bolt.pos.z + pull * 0.09; Lat.z += pull * 0.09; }
            if (w.parts.slide) { w.parts.slide.position.z = w.rest.slide.pos.z + (1 - pull) * 0.035; }
            L = { ...L, fwd: [-0.3, 0.1, -0.95], up: [0.2, 0.95, 0.1] };
        } else Lat = _v3.copy(t < 0.85 ? magBase : P.support || P.grip).lerp(P.support || P.grip, ease(clamp01((t - 0.8) / 0.2)));
        // the fresh magazine rides in the hand until it seats
        if (t > 0.5 && t < 0.7) {
            const m = this.carry('mag');
            if (m) { m.position.copy(mag.position); m.quaternion.copy(mag.quaternion); m.visible = false; }
            mag.visible = true;
        } else this.dropInHand();
        out.L = L; out.Lat = Lat;
    }

    reloadShell(out, w, def, H, r) {
        const P = w.points;
        const port = P.port || P.support;
        // the weapon turns belly-up toward you while shells go in
        const k = r.stage === 'start' ? r.stageT / def.shellStart : r.stage === 'end' ? 1 - r.stageT / def.shellEnd : 1;
        const tilt = ease(clamp01(k));
        out.drot.z -= tilt * 0.55; out.drot.x += tilt * 0.12; out.dpos.y += tilt * 0.025;
        let Lat;
        if (r.stage === 'shells') {
            // each shell: hand down to the belt, up to the port, thumb it in
            const s = r.stageT / def.shell;
            const below = _v.copy(port).add(_v2.set(-0.02, -0.12, 0.08));
            Lat = s < 0.45 ? _v3.copy(below).lerp(port, ease(s / 0.45)) : _v3.copy(port).lerp(below, ease((s - 0.45) / 0.55) * 0.35);
            const sh = this.carry('shell');
            if (sh) { sh.visible = s < 0.5; sh.position.copy(Lat).add(_v2.set(0.0, 0.03, -0.03)); sh.rotation.set(0, 0, 0); }
        } else {
            this.dropInHand();
            Lat = _v3.copy(P.support).lerp(port, tilt);
        }
        out.L = { ...H.L, fwd: [0.2, 0.6, -0.77], up: [-0.3, -0.25, -0.9], curl: { thumb: 0.3, index: 0.5, middle: 0.6, ring: 0.7, pinky: 0.75 } };
        out.Lat = Lat;
    }

    reloadRocket(out, w, def, H, t) {
        const P = w.points, rocket = w.parts.rocket;
        const tilt = key([[0, 0], [0.15, 1], [0.85, 1], [1, 0]], t);
        out.drot.x -= tilt * 0.25; out.dpos.y -= tilt * 0.06; out.dpos.x -= tilt * 0.05;
        if (!rocket) return;
        const rest = w.rest.rocket.pos;
        // a fresh rocket: up from below, then slid into the muzzle
        const slide = key([[0, 1], [0.55, 1], [0.8, 0]], t);
        rocket.visible = t > 0.3;
        rocket.position.set(rest.x, rest.y + (t < 0.55 ? (0.55 - t) * 0.6 : 0), rest.z - slide * 0.55);
        const Lat = _v3.copy(rocket.position).add(_v.set(-0.02, -0.05, 0.05));
        if (t < 0.3) Lat.copy(P.support).lerp(_v.set(-0.1, -0.4, -0.2), ease(t / 0.3));
        else if (t > 0.85) Lat.lerp(P.support, ease((t - 0.85) / 0.15));
        out.L = { ...H.L, fwd: [0.2, 0.3, -0.93], up: [-0.8, -0.6, 0.0] };
        out.Lat = Lat;
    }

    grenadeAnim(out, pm, w) {
        const st = pm.throwState;
        const pin = w.parts.pin, spoon = w.parts.spoon;
        if (!st) { if (pin) pin.visible = true; if (spoon) spoon.visible = true; w.root.visible = pm.gun.mag > 0; return; }
        w.root.visible = st.phase !== 'thrown';
        // pull: the left hand takes the pin; cock: the arm back; throw: over and forward
        if (st.phase === 'pull' || st.phase === 'hold') {
            const k = st.phase === 'pull' ? clamp01(st.t / 0.35) : 1;
            if (pin) pin.visible = k < 0.6;
            out.dpos.set(0.02 * k, 0.05 * k, 0.08 * k);
            out.drot.x -= 0.5 * k;
            if (k < 0.8) {
                out.Lat = _v3.copy(w.points.grip).add(_v.set(0.01 - k * 0.12, 0.04, -0.01 + k * 0.05));
                out.L = { at: [0, 0, 0], fwd: [0.6, 0.1, -0.8], up: [-0.6, 0.7, 0.2], curl: { thumb: 0.6, index: 0.7, middle: 0.75, ring: 0.8, pinky: 0.85 } };
            }
        } else if (st.phase === 'throw') {
            const k = clamp01(st.t / 0.28);
            out.dpos.set(0.02 - k * 0.1, 0.05 + Math.sin(k * Math.PI) * 0.06, 0.08 - k * 0.45);
            out.drot.x += -0.5 + k * 1.3;
            if (spoon) spoon.visible = k < 0.4;
        }
    }

    solveArms(H, w, anim) {
        const root = this.root, gn = this.gunNode;
        root.updateMatrixWorld(true);
        // gun-space frame vectors → world
        gn.matrixWorld.decompose(_v4, _q2, _v);
        const hand = (ik, hold, at, shoulder, pole, fallbackFrom) => {
            if (!ik) return;
            // the shoulder anchors (camera space)
            const sb = ik.b.upper;
            _v.fromArray(shoulder).applyMatrix4(root.matrixWorld);
            sb.parent.updateWorldMatrix(true, false);
            sb.position.copy(sb.parent.worldToLocal(_v));
            if (!hold) { // hand down out of view
                const T = _v2.set(shoulder[0] * 0.9, -0.62, -0.05).applyMatrix4(root.matrixWorld);
                ik.solve(T, null, _v3.set(0, 0, 1).applyQuaternion(_q2), 1, 0);
                return;
            }
            const base = at ? _v2.copy(at) : _v2.copy(fallbackFrom || w.points.grip).add(_v3.fromArray(hold.at));
            if (!at && hold.from === 'support' && w.points.support) base.copy(w.points.support).add(_v3.fromArray(hold.at));
            else if (!at && hold.from === 'grip') base.copy(w.points.grip).add(_v3.fromArray(hold.at));
            const T = base.applyMatrix4(gn.matrixWorld);
            const f = _v3.fromArray(hold.fwd).normalize().applyQuaternion(_q2), u = _v4.fromArray(hold.up).normalize().applyQuaternion(_q2);
            const hq = frameQuat(f, u, _q);
            const pw = _v.fromArray(pole).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
            ik.solve(T, hq, pw, 1, 0.5);
            ik.curl(hold.curl || 0.8);
        };
        hand(this.ikR, anim.R, anim.Rat, H.shoulderR, H.poleR, w.points.grip);
        hand(this.ikL, anim.L, anim.Lat, H.shoulderL, H.poleL, w.points.support);
    }

    muzzleFlash(def) {
        const w = this.cur;
        if (!w || !def.flash) return;
        this.flashT = 0.05;
        this.flashScale = 0.09 + def.flash * 0.1;
        this.flash.material.rotation = Math.random() * 6.28;
        this.light.intensity = 2.5 * def.flash;
    }

    updateFlash(dt, w) {
        this.flashT = (this.flashT || 0) - dt;
        const on = this.flashT > 0;
        this.flash.visible = this.flashSide.visible = on;
        if (!on || !w.points.muzzle) { this.light.intensity = 0; return; }
        const m = _v.copy(w.points.muzzle).applyMatrix4(this.gunNode.matrix);
        const fwd = _v2.set(0, 0, -1).applyQuaternion(this.gunNode.quaternion);
        this.flash.position.copy(m).addScaledVector(fwd, this.flashScale * 0.35);
        this.flash.scale.setScalar(this.flashScale * (0.8 + Math.random() * 0.4));
        this.flashSide.position.copy(m).addScaledVector(fwd, this.flashScale * 0.6);
        this.flashSide.quaternion.copy(this.gunNode.quaternion);
        this.flashSide.scale.set(this.flashScale * 1.4, this.flashScale * 0.8, this.flashScale * 1.8);
        this.light.position.copy(m);
    }

    ejectCase(def) {
        const w = this.cur;
        if (!w.points.eject) return;
        const kind = def.fire === 'pump' ? 'shell' : 'case';
        let c = this.cases.find(x => x.life <= 0);
        if (!c && this.cases.length < 14) {
            const g = caseGeometry(kind);
            const m = new THREE.Mesh(g.geo, g.mat);
            m.frustumCulled = false; m.castShadow = false;
            this.root.add(m);
            c = { mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, kind };
            this.cases.push(c);
        }
        if (!c) return;
        if (c.kind !== kind) { const g = caseGeometry(kind); c.mesh.geometry = g.geo; c.mesh.material = g.mat; c.kind = kind; }
        c.mesh.position.copy(w.points.eject).applyMatrix4(this.gunNode.matrix);
        c.mesh.quaternion.copy(this.gunNode.quaternion);
        c.vel.set(1.6 + Math.random() * 0.8, 1.2 + Math.random() * 0.8, 0.4 + Math.random() * 0.5).applyQuaternion(this.gunNode.quaternion);
        c.spin.set(Math.random() * 20 - 10, Math.random() * 30 - 15, Math.random() * 20 - 10);
        c.life = 0.7;
        c.mesh.visible = true;
    }

    updateCases(dt) {
        for (const c of this.cases) {
            if (c.life <= 0) { c.mesh.visible = false; continue; }
            c.life -= dt;
            c.vel.y -= 9.81 * dt;
            c.mesh.position.addScaledVector(c.vel, dt);
            c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
        }
    }

    // a shell case's world-space start for the third-person / world brass (not used by the view model itself)
    muzzleWorld(out) {
        if (!this.cur || !this.cur.points.muzzle) return null;
        this.gunNode.updateMatrixWorld(true);
        return out.copy(this.cur.points.muzzle).applyMatrix4(this.gunNode.matrixWorld);
    }
}

function makeFlashTex(side = false) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.2, 'rgba(255,200,110,0.9)'); g.addColorStop(0.55, 'rgba(255,120,30,0.35)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    x.fillStyle = g;
    if (side) { x.save(); x.translate(64, 64); x.scale(1, 0.35); x.beginPath(); x.arc(0, 0, 64, 0, 6.29); x.restore(); x.fill(); }
    else {
        x.fillRect(0, 0, 128, 128);
        // star prongs
        x.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 5; i++) {
            const a = i / 5 * Math.PI * 2 + 0.3;
            x.save(); x.translate(64, 64); x.rotate(a);
            const gg = x.createLinearGradient(0, 0, 60, 0); gg.addColorStop(0, 'rgba(255,220,150,0.8)'); gg.addColorStop(1, 'rgba(255,140,40,0)');
            x.fillStyle = gg; x.beginPath(); x.moveTo(0, -5); x.lineTo(62, 0); x.lineTo(0, 5); x.fill(); x.restore();
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
void V; void _m;
