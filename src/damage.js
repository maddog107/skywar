// ═══════════════════════════════════════════════════════════════
// Damage & destruction:
//  • segmentModel(): cuts any aircraft model (GLB or procedural) into
//    detachable sections by triangle position: nose, outer wings, tail, centre.
//  • Wreckage: detached sections tumble, burn and explode on impact;
//    ejection seats fire, separate and float down under parachutes.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Character } from './character.js';
import { rand, clamp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

export const REGIONS = ['center', 'nose', 'wingL', 'wingR', 'tail'];

function regionOf(cx, cz, L, W, hs) {
    const wingEdge = Math.max(W * 1.7, hs * 0.42);
    if (Math.abs(cx) > wingEdge && cz > -0.3 * L && cz < 0.3 * L) return cx < 0 ? 'wingL' : 'wingR';
    if (cz < -0.24 * L) return 'nose';
    if (cz > 0.28 * L) return 'tail';
    return 'center';
}

// Split every mesh in `holder` into region groups. Returns a new Group.
export function segmentModel(holder, length) {
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const hs = Math.max(-box.min.x, box.max.x);
    const L = length;
    const W = Math.max(0.085 * L, 1.0);
    const buckets = {}; // region -> [{material, arrays}]
    const out = new THREE.Group();

    holder.traverse((mesh) => {
        if (!mesh.isMesh || mesh.isSprite || !mesh.geometry || !mesh.geometry.attributes.position) return;
        if (mesh.geometry.morphAttributes && Object.keys(mesh.geometry.morphAttributes).length) return;
        let geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        const flip = mesh.matrixWorld.determinant() < 0;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const groups = geo.groups && geo.groups.length && Array.isArray(mesh.material)
            ? geo.groups : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
        const names = Object.keys(geo.attributes);
        const sig = names.map(n => n + geo.attributes[n].itemSize).join(',');
        const pos = geo.attributes.position;
        for (const grp of groups) {
            const mat = mats[grp.materialIndex] || mats[0];
            for (let t = grp.start; t < grp.start + grp.count; t += 3) {
                const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
                const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
                const r = regionOf(cx, cz, L, W, hs);
                const key = r + '|' + mat.uuid + '|' + sig;
                let b = buckets[key];
                if (!b) {
                    b = buckets[key] = { region: r, material: mat, data: {}, sizes: {}, shadow: mesh.castShadow };
                    for (const n of names) { b.data[n] = []; b.sizes[n] = geo.attributes[n].itemSize; }
                }
                const order = flip ? [0, 2, 1] : [0, 1, 2];
                for (const n of names) {
                    const a = geo.attributes[n];
                    for (const k of order) for (let c = 0; c < a.itemSize; c++) b.data[n].push(a.array[(t + k) * a.itemSize + c]);
                }
            }
        }
        geo.dispose();
    });

    // Build region groups pivoted at their own centroid
    const regionGroups = {};
    for (const r of REGIONS) {
        const g = new THREE.Group();
        g.userData.region = r;
        regionGroups[r] = g;
    }
    const centroids = {};
    for (const b of Object.values(buckets)) {
        const p = b.data.position;
        const c = centroids[b.region] || (centroids[b.region] = { x: 0, y: 0, z: 0, n: 0 });
        for (let i = 0; i < p.length; i += 3) { c.x += p[i]; c.y += p[i + 1]; c.z += p[i + 2]; c.n++; }
    }
    for (const r of REGIONS) {
        const c = centroids[r];
        if (c && c.n) regionGroups[r].position.set(c.x / c.n, c.y / c.n, c.z / c.n);
    }
    for (const b of Object.values(buckets)) {
        const geo = new THREE.BufferGeometry();
        for (const n of Object.keys(b.data)) geo.setAttribute(n, new THREE.Float32BufferAttribute(b.data[n], b.sizes[n]));
        const pivot = regionGroups[b.region].position;
        geo.translate(-pivot.x, -pivot.y, -pivot.z);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, b.material);
        m.castShadow = true; m.receiveShadow = true;
        regionGroups[b.region].add(m);
    }
    for (const r of REGIONS) if (regionGroups[r].children.length) out.add(regionGroups[r]);
    return out;
}

// ── Parachute texture (striped canopy) ──
function chuteTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#f2f2ee' : '#e8631f';
        ctx.fillRect(i * 32, 0, 32, 64);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export class Wreckage {
    constructor(game) {
        this.game = game;
        this.parts = [];
        this.seats = [];
        const chuteTex = chuteTexture();
        this.chuteMat = new THREE.MeshStandardMaterial({ map: chuteTex, side: THREE.DoubleSide, roughness: 0.9 });
        this.seatMat = new THREE.MeshStandardMaterial({ color: 0x3b4430, roughness: 0.8 });
        this.suitMat = new THREE.MeshStandardMaterial({ color: 0x5b6b4a, roughness: 0.9 });
        this.helmetMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.4 });
        this.lineMat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 });
        // seat / canopy / rigging geometry, shared by every ejection
        this.seatGeo = new THREE.BoxGeometry(0.7, 0.9, 0.6);
        this.seatBackGeo = new THREE.BoxGeometry(0.7, 0.8, 0.15);
        this.canopyGeo = new THREE.SphereGeometry(4.2, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
        const lp = [];
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            lp.push(0, 1.2, 0, Math.cos(a) * 3.1, 6.5 + 1.1, Math.sin(a) * 3.1);
        }
        this.lineGeo = new THREE.BufferGeometry();
        this.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    }

    // take a falling section / seat out of the scene, freeing any animated character riding on it
    removeObj(obj) {
        if (obj.parent) obj.parent.remove(obj);
        const chars = [];
        obj.traverse(o => { if (o.userData.character) chars.push(o.userData.character); });
        chars.forEach(c => c.dispose()); // (dispose detaches, so not while traversing)
    }

    removeSeat(s) {
        this.removeObj(s.root);
        if (s.character) s.character.dispose();
        // a landed canopy the pilot walked away from was re-parented onto the scene
        if (s.chute && s.chute.parent === this.game.scene) this.game.scene.remove(s.chute);
    }

    // Detach a region from a live aircraft and send it tumbling
    detach(ac, region, strength = 1) {
        const g = ac.regions && ac.regions[region];
        if (!g || !g.parent) return null;
        this.game.scene.attach(g); // keeps world transform
        ac.lostRegions.add(region);
        const outward = _v.copy(g.position).sub(ac.pos);
        if (outward.lengthSq() < 0.01) outward.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
        outward.normalize();
        const vel = ac.vel.clone().multiplyScalar(0.85).addScaledVector(outward, rand(12, 30) * strength).add(_v2.set(rand(-6, 6), rand(0, 10), rand(-6, 6)));
        const part = {
            obj: g, vel, spin: new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3)).multiplyScalar(strength),
            life: rand(9, 14), smokeT: 0, burning: Math.random() < 0.8 || region === 'center', heavy: region === 'center',
            radius: region === 'center' ? ac.spec.length * 0.3 : ac.spec.length * 0.15,
        };
        this.parts.push(part);
        return part;
    }

    // Blow the whole airframe apart
    breakup(ac, strength = 1) {
        if (!ac.regions) return;
        for (const r of REGIONS) {
            if (ac.lostRegions.has(r)) continue;
            this.detach(ac, r, strength * (r === 'center' ? 0.5 : 1.2));
        }
    }

    eject(ac) {
        if (ac.ejected || ac.spec.category === 'civil') return;
        ac.ejected = true;
        const up = ac.getUp(new THREE.Vector3());
        const start = ac.rig.cockpit.clone().applyMatrix4(ac.model.matrixWorld).addScaledVector(up, 1.5);
        const root = new THREE.Group();
        const seat = new THREE.Group();
        const s1 = new THREE.Mesh(this.seatGeo, this.seatMat); s1.position.y = 0.2;
        const s2 = new THREE.Mesh(this.seatBackGeo, this.seatMat); s2.position.set(0, 0.8, 0.3);
        seat.add(s1, s2);
        // the pilot: an animated character (the root is scaled up 1.6× so it reads from the chase camera)
        const character = new Character();
        const pilot = character.root;
        pilot.scale.setScalar(1 / 1.6 * 1.15);
        pilot.position.y = -0.1;
        root.add(seat, pilot);
        root.traverse(o => { if (o.isMesh) o.castShadow = true; });
        root.position.copy(start);
        root.quaternion.copy(ac.quat);
        root.scale.setScalar(1.6); // a touch oversized so it reads from the chase camera
        this.game.scene.add(root);
        // canopy (hidden until deployment)
        const chute = new THREE.Group();
        const canopy = new THREE.Mesh(this.canopyGeo, this.chuteMat);
        canopy.scale.y = 0.6;
        canopy.position.y = 6.5;
        canopy.castShadow = true;
        chute.add(canopy);
        chute.add(new THREE.LineSegments(this.lineGeo, this.lineMat));
        chute.visible = false;
        chute.scale.setScalar(0.01);
        root.add(chute);
        const vel = ac.vel.clone().multiplyScalar(0.8).addScaledVector(up, 55);
        const seatObj = { root, seat, pilot, character, chute, vel, t: 0, deployed: false, landed: false, landT: 0, owner: ac };
        this.seats.push(seatObj);
        ac.ejectSeat = seatObj;
        this.game.events.emit('eject', ac, { seat: seatObj });
        return seatObj;
    }

    // Climbing out of a jet that's stopped on the ground: a "seat" already on the ground, no canopy
    groundSeat(ac) {
        const right = ac.getRight(new THREE.Vector3());
        const at = ac.rig.cockpit.clone().applyMatrix4(ac.model.matrixWorld).addScaledVector(right, -(ac.spec.span * 0.25 + 2.5));
        const su = this.game.surfaceAt(at.x, at.z, at.y + 3);
        at.y = su.h + 0.3;
        const root = new THREE.Group();
        root.position.copy(at);
        const seat = new THREE.Group(), pilot = new THREE.Group(), chute = new THREE.Group();
        root.add(seat, pilot, chute);
        this.game.scene.add(root);
        const s = { root, seat, pilot, chute, vel: new THREE.Vector3(), t: 10, deployed: true, landed: true, landT: 0, owner: ac, walkedOut: true };
        this.seats.push(s);
        return s;
    }

    update(dt) {
        const g = this.game, fx = g.effects;
        // ── falling sections ──
        for (let i = this.parts.length - 1; i >= 0; i--) {
            const p = this.parts[i];
            p.life -= dt;
            p.vel.y -= 9.81 * dt;
            const drag = p.heavy ? 0.12 : 0.35;
            p.vel.multiplyScalar(Math.exp(-drag * dt));
            p.obj.position.addScaledVector(p.vel, dt);
            _q.setFromEuler(new THREE.Euler(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
            p.obj.quaternion.multiply(_q);
            p.smokeT -= dt;
            if (p.smokeT <= 0) {
                p.smokeT = p.heavy ? 0.03 : 0.05;
                _v.set(rand(-2, 2), 4, rand(-2, 2));
                fx.puffSmoke(p.obj.position, _v, p.heavy ? 5 : 3, 0.07, p.heavy ? 4.5 : 3, 0.75);
                if (p.burning) fx.puffFire(p.obj.position, _v.copy(p.vel).multiplyScalar(0.2), p.heavy ? 7 : 4, 0.35);
            }
            const surf = g.surfaceAt(p.obj.position.x, p.obj.position.z, p.obj.position.y + 3);
            const h = surf.water ? -1 : surf.h;
            const gh = surf.h;
            if (p.obj.position.y < gh + 1 || p.life <= 0) {
                if (p.obj.position.y < gh + 3) {
                    if (h < 0) fx.waterSplash(p.obj.position, p.heavy ? 1.2 : 0.6);
                    else if (p.inert) fx.groundImpact(p.obj.position);
                    else {
                        fx.explosion(p.obj.position, p.heavy ? 1.4 : 0.6);
                        g.audio.boom(g.camera.position.distanceTo(p.obj.position), p.heavy ? 1 : 0.5);
                    }
                }
                this.removeObj(p.obj);
                this.parts.splice(i, 1);
            }
        }
        // ── ejection seats / parachutes ──
        for (let i = this.seats.length - 1; i >= 0; i--) {
            const s = this.seats[i];
            s.t += dt;
            const r = s.root;
            if (!s.landed) {
                if (s.t < 0.45) {
                    // rocket motor
                    fx.puffFire(r.position, _v.set(0, -30, 0), 2.2, 0.25);
                    fx.puffSmoke(r.position, _v.set(0, -5, 0), 1.5, 0.5, 2, 0.5);
                    s.vel.y += 25 * dt;
                }
                if (!s.deployed && s.t > 1.4) {
                    s.deployed = true;
                    // seat falls away
                    s.seat.visible = false;
                    const seatDrop = s.seat.clone();
                    seatDrop.visible = true;
                    seatDrop.position.copy(r.position);
                    seatDrop.quaternion.copy(r.quaternion);
                    seatDrop.scale.copy(r.scale);
                    g.scene.add(seatDrop);
                    this.parts.push({ obj: seatDrop, vel: s.vel.clone(), spin: new THREE.Vector3(2, 1, 3), life: 20, smokeT: 99, burning: false, heavy: false, radius: 1, inert: true });
                    s.chute.visible = true;
                }
                if (s.deployed) {
                    const k = clamp((s.t - 1.4) / 0.9, 0, 1);
                    s.chute.scale.setScalar(0.1 + k * 0.9);
                    // strong drag toward drift with the wind, gentle sink
                    const sink = s.dead ? -9 : s.sink != null ? -s.sink : -6.5;
                    const target = _v.set(g.wind.x * 1.5 + (s.glide ? s.glide.x : 0), sink, g.wind.z * 1.5 + (s.glide ? s.glide.z : 0));
                    s.vel.lerp(target, 1 - Math.exp(-(s.player ? 1.6 : 2.2) * dt));
                    // upright + gentle sway; a steered canopy banks into its turns
                    const sway = Math.sin(s.t * 1.3) * 0.12;
                    const yaw = s.heading != null ? s.heading : s.glide && s.glide.lengthSq() > 0.1 ? Math.atan2(-s.glide.x, -s.glide.z) : s.t * 0.15;
                    _q.setFromEuler(new THREE.Euler(sway * (s.player ? 0.4 : 1) + (s.dead ? 0.5 : 0) + (s.pitchLean || 0), yaw, (s.bank || 0) + Math.cos(s.t * 1.1) * 0.1 * (s.player ? 0.4 : 1)));
                    r.quaternion.slerp(_q, 1 - Math.exp(-2 * dt));
                } else {
                    s.vel.y -= 9.81 * dt;
                    s.vel.multiplyScalar(Math.exp(-0.6 * dt));
                    _q.setFromEuler(new THREE.Euler(dt * 2, dt * 0.5, dt * 1.5));
                    r.quaternion.multiply(_q);
                }
                r.position.addScaledVector(s.vel, dt);
                const su = g.surfaceAt(r.position.x, r.position.z, r.position.y + 2);
                const gh = su.h;
                if (r.position.y < gh + 0.3) {
                    r.position.y = gh + 0.3;
                    s.landed = true;
                    s.onShip = su.ship || null;
                    if (su.water) g.effects.waterSplash(r.position, 0.25);
                }
            } else {
                s.landT += dt;
                // canopy collapses
                s.chute.scale.y = Math.max(0.05, s.chute.scale.y - dt * 0.8);
                s.chute.position.x += dt * 2;
            }
            if (!s.player && (s.landT > 8 || s.t > 120)) {
                this.removeSeat(s);
                this.seats.splice(i, 1);
                if (s.owner) s.owner.ejectSeat = null;
            }
        }
    }

    clear() {
        this.parts.forEach(p => this.removeObj(p.obj));
        this.seats.forEach(s => this.removeSeat(s));
        this.parts = []; this.seats = [];
    }
}
