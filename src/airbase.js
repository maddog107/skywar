// ═══════════════════════════════════════════════════════════════
// Airbase life: perimeter fence, main-gate checkpoint (booth, boom barriers,
// Humvees, jersey barriers), control tower with beacon, radar, windsock,
// helipads, parked aircraft, and helicopters flying circuits.
// Everything is in base-local coordinates inside a group that matches the
// runway dressing (see world.js initBases / baseToWorld).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, fenceOf, gateOf, baseToWorld, terrainHeight } from './world.js';
import { propParts } from './props.js';
import { makeBuildingMaterial } from './towns.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAircraftModel } from './models.js';
import { AIRCRAFT } from './config.js';
import { propInstance, propSize, hasProp } from './props.js';
import { makeRadialTexture, clamp, rand } from './util.js';
import { roadMaterial } from './roads.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

const MAT = {
    concrete: new THREE.MeshStandardMaterial({ color: 0xb9b5ab, roughness: 0.9 }),
    darkConcrete: new THREE.MeshStandardMaterial({ color: 0x8c8981, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2a4050, roughness: 0.08, metalness: 0.9, emissive: 0x000000 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.5, metalness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xc8c8c0, roughness: 0.8 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x5b6443, roughness: 0.8 }),
    sand: new THREE.MeshStandardMaterial({ color: 0xa8976f, roughness: 1 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc0261c, roughness: 0.6 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.7 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x5d6064, roughness: 0.9 }),
};

function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
}
function cyl(r1, r2, h, mat, x, y, z, parent, seg = 10) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
}
function canvasTex(w, h, draw, repeat = false) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
}

// Simple fixed landing gear for a parked (non-flying) aircraft model
function simpleGear(L, halfSpan, bellyY, H) {
    const g = new THREE.Group();
    const sc = clamp(L / 17, 0.8, 3.2), wheelR = 0.33 * sc;
    const strutLen = Math.max(0.4, bellyY - (-H + wheelR));
    const mainX = L > 25 ? Math.min(halfSpan * 0.25, L * 0.09) : Math.max(1, L * 0.075);
    for (const [x, z] of [[0, -0.3 * L], [-mainX, 0.04 * L], [mainX, 0.04 * L]]) {
        const s = cyl(0.07 * sc, 0.09 * sc, strutLen, MAT.steel, x, bellyY - strutLen, z, g, 6);
        s.castShadow = true;
        const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.24 * sc, 12), MAT.dark);
        w.rotation.z = Math.PI / 2; w.position.set(x, -H + wheelR, z);
        g.add(w);
    }
    return g;
}

// A parked aircraft: model + gear, origin on the ground. Returned facing -Z.
export function makeParkedModel(id) {
    const { object, rig } = createAircraftModel(id);
    const spec = AIRCRAFT[id];
    const H = -(rig.minY ?? -spec.length * 0.08) + 1.2;
    const root = new THREE.Group();
    object.position.y = H;
    root.add(object);
    const gear = simpleGear(spec.length, rig.halfSpan || spec.span / 2, rig.minY ?? -spec.length * 0.08, H);
    gear.position.y = H;
    root.add(gear);
    // chocks and a boarding ladder make it look parked
    root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return root;
}

// Rotor for helicopter models (their own rotor is static)
function makeRotor(R, blades, tail = false) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    for (let k = 0; k < blades; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(tail ? 0.12 : 0.35, 0.06, R), mat);
        b.position.z = R / 2;
        const piv = new THREE.Group(); piv.rotation.y = (k / blades) * Math.PI * 2; piv.add(b); g.add(piv);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 32), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    g.add(disc);
    g.userData.disc = disc;
    return g;
}

export function makeHelicopter(id) {
    const root = new THREE.Group();
    const m = propInstance(id);
    const size = propSize(id);
    if (m) root.add(m);
    else box(2.5, 2.5, 10, MAT.olive, 0, 0.5, 0, root);
    const rotor = makeRotor(size.z * 0.46, id === 'heli_military' ? 4 : 2);
    rotor.position.set(0, size.y * 0.98, -size.z * 0.05);
    root.add(rotor);
    root.userData.rotor = rotor;
    return root;
}

// ── A helicopter flying a closed circuit ──
class Heli {
    constructor(scene, id, waypoints, alt, speed) {
        this.mesh = makeHelicopter(id);
        scene.add(this.mesh);
        const pts = waypoints.map(p => new THREE.Vector3(p.x, Math.max(terrainHeight(p.x, p.z), 0) + alt, p.z));
        // keep clear of hills between waypoints
        this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
        this.len = this.curve.getLength();
        this.u = Math.random();
        this.speed = speed;
        this.alt = alt;
        this.bank = 0;
        this.prevYaw = null;
        this.alive = true;
    }
    update(dt) {
        this.u = (this.u + this.speed * dt / this.len) % 1;
        const p = this.curve.getPointAt(this.u, _v);
        const ground = Math.max(terrainHeight(p.x, p.z), 0);
        p.y = Math.max(p.y, ground + this.alt * 0.7);
        this.mesh.position.lerp(p, this.prevYaw === null ? 1 : Math.min(1, dt * 3));
        const t = this.curve.getTangentAt(this.u, _v2);
        const yaw = Math.atan2(-t.x, -t.z);
        if (this.prevYaw !== null) {
            let dy = yaw - this.prevYaw;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            this.bank += (clamp(-dy / Math.max(dt, 1e-3) * 1.6, -0.5, 0.5) - this.bank) * Math.min(1, dt * 2);
        }
        this.prevYaw = yaw;
        _e.set(-0.1, yaw, this.bank);
        this.mesh.quaternion.setFromEuler(_e);
        this.mesh.userData.rotor.rotation.y += dt * 28;
    }
}

export class Airbases {
    constructor(scene) {
        this.scene = scene;
        this.bases = [];
        this.helis = [];
        this.beacons = [];
        this.floods = [];
        this.time = 0;
        for (const b of BASES) this.bases.push(this.buildBase(b));
        this.buildHelis();
    }

    buildBase(b) {
        const g = new THREE.Group();
        g.position.set(b.x, b.h, b.z);
        g.rotation.y = -b.heading;
        this.scene.add(g);
        const info = { base: b, group: g, parked: new THREE.Group(), arms: [], radar: null, sock: null };
        g.add(info.parked);
        this.buildFence(b, g);
        if (b.layout === 'miramar') { this.buildMiramar(b, g, info); return info; }
        if (b.layout === 'civil') { this.buildCivil(b, g, info); return info; }
        this.buildGate(b, g, info);
        this.buildAccessRoad(b, g);
        this.buildTower(g, info);
        this.buildRadar(g, info);
        this.buildWindsock(g, info);
        this.buildHelipad(b, g, info);
        this.buildParked(b, info);
        if (b.id === 'home') this.buildBarracks(b, g);
        return info;
    }

    // local height (relative to the base's flattened level)
    hAt(b, lx, lz) {
        const w = baseToWorld(b, lx, lz);
        return Math.max(terrainHeight(w.x, w.z), 0) - b.h;
    }

    buildFence(b, g) {
        const tex = canvasTex(64, 64, (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(190,195,198,0.95)'; ctx.lineWidth = 2;
            for (let i = -64; i < 128; i += 12) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 64, 64); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + 64, 0); ctx.lineTo(i, 64); ctx.stroke(); }
        }, true);
        const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 });
        const { x0, x1, z0, z1 } = fenceOf(b); const GATE = gateOf(b);
        const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
        const pos = [], uv = [], idx = [], posts = [], wire = [];
        const H = 2.6, STEP = 6;
        let u = 0;
        for (let c = 0; c < 4; c++) {
            const [ax, az] = corners[c], [bx, bz] = corners[c + 1];
            const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / STEP);
            let prev = null;
            for (let k = 0; k <= n; k++) {
                const t = k / n, lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
                // leave the gate open for the road
                if (c === 1 && Math.abs(lz - GATE.lz) < 13) { prev = null; continue; }
                const y = this.hAt(b, lx, lz);
                posts.push([lx, y, lz]);
                const base = pos.length / 3;
                pos.push(lx, y + 0.1, lz, lx, y + H, lz);
                uv.push(u / 3, 0, u / 3, H / 3);
                if (prev !== null) {
                    idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
                    const p0 = posts[posts.length - 2];
                    for (const dy of [H + 0.15, H + 0.35, H + 0.55]) wire.push(p0[0], p0[1] + dy, p0[2], lx, y + dy, lz);
                }
                prev = base;
                u += len / n;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const fence = new THREE.Mesh(geo, mat);
        fence.frustumCulled = false;
        g.add(fence);
        const postGeo = new THREE.CylinderGeometry(0.06, 0.06, H + 0.6, 5); postGeo.translate(0, (H + 0.6) / 2, 0);
        const inst = new THREE.InstancedMesh(postGeo, MAT.steel, posts.length);
        const m = new THREE.Matrix4();
        posts.forEach((p, i) => inst.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])));
        inst.computeBoundingSphere();
        g.add(inst);
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
        const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x9a9a98, transparent: true, opacity: 0.8 }));
        wl.frustumCulled = false;
        g.add(wl);
    }

    buildGate(b, g, info, signText = null) {
        const GATE = gateOf(b);
        const gx = GATE.lx, gz = GATE.lz;
        const y = this.hAt(b, gx, gz);
        const gate = new THREE.Group();
        gate.position.set(gx, y, gz);
        g.add(gate);
        // guard booth on the island between the lanes... well, beside the road
        const booth = new THREE.Group();
        box(3.4, 2.6, 3.4, MAT.white, 0, 0.2, 0, booth);
        box(3.5, 1.0, 3.5, MAT.glass, 0, 1.3, 0, booth);
        box(4.4, 0.3, 4.4, MAT.darkConcrete, 0, 2.8, 0, booth);
        box(3.6, 0.2, 3.6, MAT.concrete, 0, 0, 0, booth);
        booth.position.set(6, 0, -12);
        gate.add(booth);
        // gate canopy over both lanes
        for (const z of [-10, 10]) for (const x of [-4, 16]) cyl(0.25, 0.25, 6, MAT.steel, x, 0, z, gate, 8);
        box(22, 0.8, 22, MAT.white, 6, 6, 0, gate);
        const signTex = canvasTex(512, 64, (ctx, w, h) => {
            ctx.fillStyle = '#1d2b1a'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#f2f2e6'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(signText || (b.friendly ? 'SKYWAR AIR BASE — CHECKPOINT' : 'RESTRICTED MILITARY ZONE'), w / 2, h / 2);
        });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(20, 2.4), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7 }));
        sign.rotation.y = Math.PI / 2; sign.position.set(17.05, 6.4, 0);
        gate.add(sign);
        // boom barriers (one per lane) that lift for traffic
        const armTex = canvasTex(256, 16, (ctx, w, h) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f4f0' : '#d0201a'; ctx.fillRect(i * 32, 0, 32, h); } });
        const armMat = new THREE.MeshStandardMaterial({ map: armTex, roughness: 0.6 });
        for (const side of [-1, 1]) {
            const post = box(0.6, 1.1, 0.6, MAT.dark, 2, 0, side * 8.5, gate);
            post.castShadow = true;
            const pivot = new THREE.Group();
            pivot.position.set(2, 1.0, side * 8.5);
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 7.5), armMat);
            arm.position.z = -side * 3.75;
            pivot.add(arm);
            gate.add(pivot);
            info.arms.push({ pivot, side, open: 0 });
        }
        // STOP sign for inbound traffic
        const stop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 8), new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (ctx) => { ctx.fillStyle = '#c4161c'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STOP', 64, 64); }), roughness: 0.6 }));
        stop.rotation.z = Math.PI / 2; stop.rotation.x = Math.PI / 8;
        stop.position.set(28, 2.4, 9.5);
        gate.add(stop);
        cyl(0.05, 0.05, 2.1, MAT.steel, 28, 0, 9.5, gate, 6);
        // jersey-barrier chicane on the approach and sandbags by the booth
        for (let k = 0; k < 6; k++) {
            const jb = box(1.0, 1.0, 3.2, MAT.concrete, 34 + k * 7, 0, (k % 2 ? 1 : -1) * 4.5, gate);
            jb.castShadow = true;
        }
        for (let k = 0; k < 7; k++) box(1.2, 0.5, 0.7, MAT.sand, 1.5 + k * 1.1, 0, -16, gate);
        for (let k = 0; k < 7; k++) box(1.2, 0.5, 0.7, MAT.sand, 1.5 + k * 1.1, 0.5, -16, gate);
        // flag
        cyl(0.08, 0.1, 12, MAT.white, 12, 0, -16, gate, 8);
        const flagTex = canvasTex(96, 64, (ctx, w, h) => {
            if (b.friendly) { for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#b22234'; ctx.fillRect(0, i * h / 7, w, h / 7); } ctx.fillStyle = '#3c3b6e'; ctx.fillRect(0, 0, w * 0.42, h * 0.55); }
            else { ctx.fillStyle = '#b3261e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffd200'; ctx.beginPath(); ctx.arc(22, 20, 10, 0, 6.3); ctx.fill(); }
        });
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 2, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }));
        flag.position.set(13.5, 11, -16);
        gate.add(flag);
        info.flag = flag;
        // Humvees parked by the booth
        if (hasProp('humvee')) {
            for (const [x, z, r] of [[-6, -14, 0.3], [-6, 14, Math.PI - 0.2]]) {
                const h = propInstance('humvee');
                h.position.set(x, 0, z); h.rotation.y = r;
                gate.add(h);
            }
        }
        // floodlights
        for (const z of [-11, 11]) {
            cyl(0.12, 0.15, 9, MAT.steel, 22, 0, z, gate, 6);
            const lamp = box(0.8, 0.4, 0.6, MAT.dark, 22, 9, z, gate);
            lamp.castShadow = false;
            this.floods.push(this.glow(gate, new THREE.Vector3(22, 8.9, z), 0xfff1c8, 14));
        }
        info.gatePos = (() => { const w = baseToWorld(b, gx, gz); return new THREE.Vector3(w.x, b.h + y, w.z); })();
    }

    // Two-lane road from outside the gate, through the checkpoint, onto the apron
    buildAccessRoad(b, g, legsIn = null) {
        const GATE = gateOf(b);
        const z = GATE.lz, HW = 7;
        const pos = [], uv = [], idx = [];
        // gate road (along x) then a spur north onto the apron (along z)
        const legs = legsIn || [[[GATE.lx + 75, z], [300, z]], [[300, z - HW], [300, -110]]];
        let s = 0;
        for (const [[ax, az], [bx, bz]] of legs) {
            const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 10);
            const tx = (bx - ax) / len, tz = (bz - az) / len, rx = -tz, rz = tx;
            let prev = null;
            for (let k = 0; k <= n; k++) {
                const x = ax + (bx - ax) * k / n, zz = az + (bz - az) * k / n;
                const y = this.hAt(b, x, zz) + 0.35;
                const base = pos.length / 3;
                pos.push(x - rx * HW, y, zz - rz * HW, x + rx * HW, y, zz + rz * HW);
                uv.push(0, (s + len * k / n) / 24, 1, (s + len * k / n) / 24);
                if (prev !== null) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
                prev = base;
            }
            s += len;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const road = new THREE.Mesh(geo, roadMaterial());
        road.receiveShadow = true;
        g.add(road);
        // parking lot by the gate for the base staff
        const lot = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: 0x55585b, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
        lot.rotation.x = -Math.PI / 2; lot.position.set(480, this.hAt(b, 480, z + 40) + 0.2, z + 40);
        lot.receiveShadow = true;
        g.add(lot);
    }

    glow(parent, pos, color, size) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex || (this.glowTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']])), color, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
        sp.position.copy(pos); sp.scale.setScalar(size);
        sp.visible = false;
        parent.add(sp);
        return sp;
    }

    buildTower(g, info, x = 230, z = -200) {
        const t = new THREE.Group();
        t.position.set(x, 0, z);
        box(26, 8, 14, MAT.concrete, 0, 0, 0, t);                     // ops building
        box(26.4, 1.2, 14.4, MAT.glass, 0, 5, 0, t);                  // window band
        box(6.5, 30, 6.5, MAT.concrete, -6, 8, 0, t);                  // shaft
        for (let k = 0; k < 7; k++) box(6.7, 0.5, 6.7, MAT.darkConcrete, -6, 11 + k * 4, 0, t);
        const cabY = 38;
        const floor = cyl(7.5, 6, 2, MAT.concrete, -6, cabY, 0, t, 8);
        floor.rotation.y = Math.PI / 8;
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 6.6, 4.4, 8, 1, true), MAT.glass);
        cab.position.set(-6, cabY + 2 + 2.2, 0); cab.rotation.y = Math.PI / 8;
        t.add(cab);
        const roof = cyl(8.4, 8, 0.8, MAT.white, -6, cabY + 6.4, 0, t, 8);
        roof.rotation.y = Math.PI / 8;
        cyl(0.12, 0.12, 8, MAT.steel, -6, cabY + 7.2, 0, t, 6);
        box(3, 0.1, 0.4, MAT.steel, -6, cabY + 13, 0, t);
        info.cabLight = cab;
        const beacon = this.glow(t, new THREE.Vector3(-6, cabY + 15.4, 0), 0x6dff8a, 7);
        this.beacons.push(beacon);
        g.add(t);
    }

    buildRadar(g, info, x = 120, z = -430) {
        const r = new THREE.Group();
        r.position.set(x, 0, z);
        cyl(1.2, 1.8, 10, MAT.steel, 0, 0, 0, r, 8);
        const head = new THREE.Group();
        head.position.y = 10.5;
        const dish = new THREE.Mesh(new THREE.BoxGeometry(9, 2.8, 0.4), MAT.white);
        dish.position.z = -0.6; dish.rotation.x = -0.25;
        head.add(dish);
        box(1, 1, 1.4, MAT.steel, 0, -0.5, 0, head);
        r.add(head);
        g.add(r);
        info.radar = head;
    }

    // Dorm blocks outside the fence by the gate road (the Ready Room start)
    buildBarracks(b, g) {
        const bx = 700, bz = -225;
        const wall = new THREE.MeshStandardMaterial({ color: 0xc9b99a, roughness: 0.9 });
        const roof = new THREE.MeshStandardMaterial({ color: 0x4d5a3e, roughness: 0.8 });
        const winTex = canvasTex(128, 64, (ctx, w, h) => {
            ctx.fillStyle = '#c9b99a'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#26323a';
            for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) ctx.fillRect(8 + i * 30, 8 + j * 30, 18, 18);
        }, true);
        const face = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 });
        for (const [dx, dz] of [[-14, -14], [14, -14], [0, 14]]) {
            const y = this.hAt(b, bx + dx, bz + dz);
            const blk = new THREE.Mesh(new THREE.BoxGeometry(24, 7, 11), [face, face, wall, wall, face, face]);
            if (winTex.repeat) { winTex.repeat.set(2, 1); }
            blk.position.set(bx + dx, y + 3.5, bz + dz);
            blk.castShadow = blk.receiveShadow = true;
            g.add(blk);
            const rf = new THREE.Mesh(new THREE.BoxGeometry(25, 0.6, 12), roof);
            rf.position.set(bx + dx, y + 7.3, bz + dz);
            g.add(rf);
        }
        const y0 = this.hAt(b, bx, bz);
        const signTex = canvasTex(256, 48, (ctx, w, h) => { ctx.fillStyle = '#2b3524'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#efe9d4'; ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PILOT QUARTERS', w / 2, h / 2); });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide }));
        sign.position.set(bx - 2, y0 + 1.8, bz - 32); sign.rotation.y = Math.PI / 2 + 0.4;
        g.add(sign);
        cyl(0.06, 0.06, 1.5, MAT.steel, bx - 2, y0, bz - 32, g, 6);
        const lot = new THREE.Mesh(new THREE.PlaneGeometry(40, 26), new THREE.MeshStandardMaterial({ color: 0x55585b, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
        lot.rotation.x = -Math.PI / 2; lot.position.set(bx - 10, y0 + 0.25, bz - 45);
        g.add(lot);
        if (hasProp('humvee')) for (const [x, z, r] of [[bx - 24, bz - 40, 1.2], [bx - 18, bz - 54, 1.4]]) {
            const h = propInstance('humvee'); h.position.set(x, this.hAt(b, x, z), z); h.rotation.y = r; g.add(h);
        }
    }

    buildWindsock(g, info, x = -95, z = -1250) {
        const w = new THREE.Group();
        w.position.set(x, 0, z);
        cyl(0.08, 0.1, 7, MAT.steel, 0, 0, 0, w, 6);
        const sock = new THREE.Group();
        sock.position.y = 6.8;
        const tex = canvasTex(64, 16, (ctx) => { for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#f4f4f0' : '#ff5a10'; ctx.fillRect(i * 13, 0, 13, 16); } });
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.25, 3.2, 12, 1, true), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
        cone.rotation.x = Math.PI / 2; cone.position.z = 1.6;
        sock.add(cone);
        w.add(sock);
        g.add(w);
        info.sock = sock;
    }

    buildHelipad(b, g, info) {
        const padTex = canvasTex(256, 256, (ctx, w) => {
            ctx.fillStyle = '#55595d'; ctx.fillRect(0, 0, w, w);
            ctx.strokeStyle = '#f2f2ea'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(128, 128, 110, 0, 6.3); ctx.stroke();
            ctx.fillStyle = '#f2f2ea'; ctx.font = 'bold 150px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', 128, 138);
        });
        const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3 });
        info.parkedHelis = [];
        for (const [x, z] of [[250, -470], [250, -540], [305, -505]]) {
            const pad = new THREE.Mesh(new THREE.CircleGeometry(13, 32), padMat);
            pad.rotation.x = -Math.PI / 2; pad.position.set(x, 0.12, z);
            pad.receiveShadow = true;
            g.add(pad);
            const h = makeHelicopter(b.friendly || Math.random() < 0.5 ? 'heli_military' : 'heli_civil');
            h.position.set(x, 0.1, z);
            h.rotation.y = Math.PI / 2 + rand(-0.3, 0.3);
            g.add(h);
            info.parkedHelis.push(h);
        }
    }

    buildParked(b, info) {
        const row = b.friendly
            ? [['f16', 335, 200], ['f16', 335, 240], ['f15', 335, 285], ['fa18', 335, 330], ['f35', 335, 372], ['c130', 250, 420]]
            : [['mig29', 335, 200], ['mig29', 335, 240], ['su35', 335, 285], ['su57', 335, 330], ['j20', 335, 372], ['mig31', 250, 420]];
        for (const [id, x, z] of row) {
            if (!AIRCRAFT[id]) continue;
            const m = makeParkedModel(id);
            m.position.set(x, 0.05, z);
            m.rotation.y = Math.PI / 2; // nose toward the taxiway
            info.parked.add(m);
        }
    }

    // ── Many parked aircraft of one type as instanced meshes (a few draw calls for a whole flight line) ──
    fleetParts(id) {
        this._fleet = this._fleet || {};
        if (this._fleet[id]) return this._fleet[id];
        let root;
        if (id.startsWith('heli')) { const pp = propParts(id); this._fleet[id] = pp || []; return this._fleet[id]; }
        root = makeParkedModel(id);
        root.updateMatrixWorld(true);
        const byMat = new Map();
        root.traverse(o => {
            if (!o.isMesh || Array.isArray(o.material)) return;
            const gg = o.geometry.clone().applyMatrix4(o.matrixWorld);
            for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k);
            if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
            if (!gg.attributes.normal) gg.computeVertexNormals();
            const ng = gg.index ? gg.toNonIndexed() : gg;
            if (!byMat.has(o.material)) byMat.set(o.material, []);
            byMat.get(o.material).push(ng);
        });
        const parts = [];
        for (const [mat, geos] of byMat) { try { parts.push({ geometry: mergeGeometries(geos), material: mat }); } catch (e) { /* skip */ } }
        this._fleet[id] = parts;
        return parts;
    }

    // place: [[lx, lz, yaw], ...] in base-local coordinates
    fleet(b, g, id, place) {
        if (!AIRCRAFT[id] && !id.startsWith('heli')) return;
        const parts = this.fleetParts(id);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
        for (const pt of parts) {
            const im = new THREE.InstancedMesh(pt.geometry, pt.material, place.length);
            place.forEach(([x, z, yaw], i) => im.setMatrixAt(i, m.compose(p.set(x, this.hAt(b, x, z) + 0.05, z), q.setFromAxisAngle(up, yaw), one)));
            im.castShadow = true; im.receiveShadow = true;
            im.computeBoundingSphere();
            g.add(im);
            this.heavy(b).push(im);
        }
    }

    // big instanced groups (flight lines, airliners, base buildings) are only drawn when you're near that base
    heavy(b) { this._heavy = this._heavy || new Map(); if (!this._heavy.has(b)) this._heavy.set(b, []); return this._heavy.get(b); }

    pave(g, x, z, w, d, color = 0x7d8083, y = 0.08, rot = 0) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
        m.rotation.x = -Math.PI / 2; m.rotation.z = rot;
        m.position.set(x, y, z);
        m.receiveShadow = true;
        g.add(m);
        return m;
    }

    hangar(g, x, z, r = 26, len = 60, rot = 0) {
        const mat = this._hangarMat || (this._hangarMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.6, metalness: 0.3 }));
        const h = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16, 1, false, 0, Math.PI), mat);
        h.rotation.z = Math.PI / 2; h.rotation.y = Math.PI / 2 + rot;
        h.position.set(x, 0, z);
        h.castShadow = true; h.receiveShadow = true;
        g.add(h);
    }

    // Office / barracks blocks with lit windows, instanced
    blocks(b, g, list) {
        const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
        const mat = this._bldMat || (this._bldMat = makeBuildingMaterial('house'));
        this.buildingMats = this.buildingMats || [];
        if (!this.buildingMats.includes(mat)) this.buildingMats.push(mat);
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        const roof = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.9 }), list.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
        list.forEach(([x, z, w, d, h, col, yaw = 0], i) => {
            const y = this.hAt(b, x, z) - 0.4;
            q.setFromAxisAngle(up, yaw);
            im.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(w, h, d)));
            im.setColorAt(i, c.setHex(col));
            roof.setMatrixAt(i, m.compose(p.set(x, y + h, z), q, s.set(w + 0.6, 0.5, d + 0.6)));
        });
        for (const o of [im, roof]) { o.castShadow = true; o.receiveShadow = true; o.computeBoundingSphere(); g.add(o); this.heavy(b).push(o); }
    }

    signBoard(g, text, x, y, z, rotY, w = 22, h = 3, bg = '#1d2b1a') {
        const tex = canvasTex(1024, Math.round(1024 * h / w), (ctx, cw, ch) => {
            ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
            ctx.fillStyle = '#f2f2e6'; ctx.font = `bold ${Math.round(ch * 0.55)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(text, cw / 2, ch / 2);
        });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.rotation.y = rotY;
        g.add(m);
    }

    // ── MCAS Miramar: parallel runways 32L/32R + crosswind 09/27, a vast flight line, hangars, the base ──
    buildMiramar(b, g, info) {
        const TAXI = 0x6f7275, APRON = 0x7c7e7b;
        // parallel taxiway and connectors
        this.pave(g, -60, -100, 24, 3500, TAXI);
        for (const z of [-1500, -800, 0, 800, 1500]) this.pave(g, -140, z, 170, 22, TAXI);
        for (const z of [-1700, 1700]) this.pave(g, -370, z, 320, 22, TAXI);
        // the flight line
        this.pave(g, 310, -150, 640, 2700, APRON, 0.07);
        // rows of parked aircraft, noses toward the taxiway
        const rows = [['fa18', 60, 34], ['fa18', 170, 34], ['f35', 280, 34], ['fa18', 390, 34]];
        for (const [id, x, step] of rows) {
            const pl = [];
            for (let z = -1350; z <= 1000; z += step) pl.push([x, z, Math.PI / 2]);
            this.fleet(b, g, id, pl);
        }
        const cargo = []; for (let z = -1350; z <= -600; z += 62) cargo.push([530, z, Math.PI / 2]);
        this.fleet(b, g, 'c130', cargo);
        const helis = []; for (let z = -400; z <= 1000; z += 36) helis.push([530, z, Math.PI / 2]);
        this.fleet(b, g, 'heli_military', helis);
        // hangars along the back of the flight line
        for (let k = 0; k < 9; k++) this.hangar(g, 700, -1350 + k * 280, 30, 70);
        // the base itself: offices, barracks, workshops
        const list = [];
        const r = (n) => { let x = Math.sin(n * 91.7) * 43758.5; return x - Math.floor(x); };
        let n = 0;
        for (let x = 860; x <= 1340; x += 70) for (let z = -1950; z <= 1900; z += 90) {
            if (Math.abs(z - b.gate.lz) < 40) continue; // keep the main road clear
            if (r(++n) < 0.2) continue;
            const w = 30 + r(++n) * 25, d = 22 + r(++n) * 30, h = 6 + Math.floor(r(++n) * 4) * 3.2;
            list.push([x, z, w, d, h, [0xc9b99a, 0xb8ad97, 0xd4c7ae, 0xa9a28f][Math.floor(r(++n) * 4)]]);
        }
        this.blocks(b, g, list);
        this.buildGate(b, g, info, 'MARINE CORPS AIR STATION MIRAMAR');
        this.buildAccessRoad(b, g, [[[b.gate.lx + 75, b.gate.lz], [760, b.gate.lz]]]);
        this.buildTower(g, info, 640, -1650);
        this.buildRadar(g, info, 560, -1900);
        this.buildWindsock(g, info, -700, -1650);
        this.signBoard(g, 'MCAS MIRAMAR', 780, 3, b.gate.lz + 30, Math.PI / 2, 18, 2.6);
    }

    // ── Harbor International: one long runway, a parallel taxiway, two terminals with airliners at the gates ──
    buildCivil(b, g, info) {
        const TAXI = 0x6f7275, RAMP = 0x7a7c7b;
        this.pave(g, 180, 0, 24, 2900, TAXI);
        for (const z of [-1400, -700, 0, 700, 1400]) this.pave(g, 90, z, 180, 22, TAXI);
        this.pave(g, 335, -150, 270, 2300, RAMP, 0.07);
        const glass = this._termGlass || (this._termGlass = makeBuildingMaterial('tower'));
        this.buildingMats = this.buildingMats || [];
        if (!this.buildingMats.includes(glass)) this.buildingMats.push(glass);
        const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
        const termItems = [
            [520, -760, 70, 700, 17],   // Terminal 1
            [520, 330, 70, 620, 19],    // Terminal 2
            [430, 440, 120, 26, 12],    // Terminal 2 pier
            [720, -500, 80, 380, 16],   // parking garage
        ];
        const tm = new THREE.InstancedMesh(geo, glass, termItems.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
        termItems.forEach(([x, z, w, d, h], i) => { tm.setMatrixAt(i, m.compose(p.set(x, this.hAt(b, x, z) - 0.3, z), q, sc.set(w, h, d))); tm.setColorAt(i, c.setHex(i === 3 ? 0x9a9d9f : 0xb9c4cc)); });
        tm.castShadow = tm.receiveShadow = true; tm.computeBoundingSphere();
        g.add(tm);
        // curved white roofs over the terminals
        for (const [x, z, w, d, h] of termItems.slice(0, 2)) {
            const roof = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.75, w * 0.75, d, 24, 1, false, -0.7, 1.4), MAT.white);
            roof.rotation.x = Math.PI / 2; roof.position.set(x, h - w * 0.75 * Math.cos(0.7) + 1, z);
            roof.castShadow = true;
            g.add(roof);
        }
        // jet bridges and airliners at the gates (T1 along the front, T2 around its pier)
        const gatesT1 = [], gatesT2 = [];
        for (let z = -1070; z <= -460; z += 68) gatesT1.push([400, z, -Math.PI / 2]);
        for (let z = 60; z <= 600; z += 70) gatesT2.push([400, z, -Math.PI / 2]);
        const all = [...gatesT1, ...gatesT2];
        const bridgeGeo = new THREE.BoxGeometry(28, 3, 3.4); bridgeGeo.translate(0, 5.5, 0);
        const bim = new THREE.InstancedMesh(bridgeGeo, MAT.concrete, all.length);
        all.forEach(([x, z], i) => bim.setMatrixAt(i, m.compose(p.set(x + 58, this.hAt(b, x, z), z - 8), q.identity(), sc.set(1, 1, 1))));
        bim.castShadow = true; bim.computeBoundingSphere();
        g.add(bim);
        const big = all.filter((_, i) => i % 5 === 2), small = all.filter((_, i) => i % 5 !== 2);
        this.fleet(b, g, 'b737', small);
        this.fleet(b, g, 'b747', big.map(([x, z, y]) => [x - 12, z, y]));
        // general aviation corner and cargo
        const ga = []; for (let z = 900; z <= 1300; z += 26) ga.push([300, z, Math.PI / 2]);
        this.fleet(b, g, 'cessna', ga);
        // curbside road in front of the terminals, from the entrance
        this.buildAccessRoad(b, g, [[[b.gate.lx + 75, b.gate.lz], [620, b.gate.lz]], [[620, -1150], [620, 750]]]);
        this.buildTower(g, info, 640, 950);
        this.buildWindsock(g, info, -120, -1300);
        this.signBoard(g, 'HARBOR INTERNATIONAL AIRPORT', b.gate.lx - 10, 5, b.gate.lz - 16, Math.PI / 2, 26, 3.2, '#12324a');
        info.gatePos = null;
    }

    // Circuits: a military helicopter around the home base, civil ones between towns
    buildHelis() {
        const home = BASES.find(b => b.friendly);
        const around = [[-600, -1600], [900, -900], [1200, 600], [700, 1700], [-500, 1400], [-900, 0]].map(([lx, lz]) => baseToWorld(home, lx, lz));
        if (hasProp('heli_military')) this.helis.push(new Heli(this.scene, 'heli_military', around, 160, 55));
        this.pendingTownRoutes = true;
    }

    // Called once towns exist: civil helicopters hop between them
    addTownRoutes(towns) {
        if (!this.pendingTownRoutes || !towns || towns.length < 3) return;
        this.pendingTownRoutes = false;
        const home = BASES.find(b => b.friendly);
        const byDist = [...towns].sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z));
        const routes = [[home, byDist[0], byDist[2], byDist[1]], [byDist[3], byDist[5], byDist[4]]];
        for (const r of routes) {
            if (r.some(p => !p)) continue;
            if (hasProp('heli_civil')) this.helis.push(new Heli(this.scene, 'heli_civil', r.map(p => ({ x: p.x, z: p.z })), 220, 48));
        }
        // a news helicopter circling the biggest city
        const city = towns.find(t => t.size === 'city');
        if (city && hasProp('heli_civil')) {
            const ring = [];
            for (let k = 0; k < 6; k++) ring.push({ x: city.x + Math.cos(k / 6 * 6.283) * 700, z: city.z + Math.sin(k / 6 * 6.283) * 700 });
            this.helis.push(new Heli(this.scene, 'heli_civil', ring, 260, 35));
        }
    }

    // Enemy parked jets become real targets in Strike/Sandbox, so hide the decoration then
    setEnemyParkedVisible(on) {
        for (const i of this.bases) if (!i.base.friendly) i.parked.visible = on;
    }

    setNight(on) {
        this.night = on;
        for (const m of this.buildingMats || []) m.userData.night.value = on ? 1 : 0;
        for (const s of this.floods) s.visible = on;
        for (const i of this.bases) if (i.cabLight) i.cabLight.material.emissive.setHex(on ? 0x3a5a44 : 0x000000);
    }

    update(dt, traffic, wind, cam) {
        this.time += dt;
        const t = this.time;
        if (cam && this._heavy) for (const [b, list] of this._heavy) {
            const near = (cam.x - b.x) ** 2 + (cam.z - b.z) ** 2 < 11000 * 11000;
            if (list.near !== near) { list.near = near; for (const o of list) o.visible = near; }
        }
        for (const h of this.helis) h.update(dt);
        const blink = Math.floor(t * 1.2) % 2 === 0;
        for (const b of this.beacons) { b.visible = !!this.night; b.material.color.setHex(blink ? 0x6dff8a : 0xffffff); }
        for (const info of this.bases) {
            if (info.radar) info.radar.rotation.y += dt * 1.6;
            if (info.sock) {
                const wx = wind ? wind.x : 3, wz = wind ? wind.z : -2;
                const yawW = Math.atan2(wx, wz) + info.base.heading;
                info.sock.rotation.y += (yawW - info.sock.rotation.y) * Math.min(1, dt) + Math.sin(t * 3) * 0.004;
                info.sock.rotation.x = -0.35 + Math.sin(t * 2.3) * 0.05;
            }
            if (info.flag) {
                const p = info.flag.geometry.attributes.position;
                for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 2.2 - t * 5) * 0.18 * (x + 1.5) / 3); }
                p.needsUpdate = true;
            }
            // lift the barriers when a vehicle is close to the gate
            let near = !!(this.gateOpen && info.base.friendly);
            if (!near && traffic && info.gatePos) {
                for (const c of traffic.cars) if (!c.dead && c.pos && c.pos.distanceToSquared(info.gatePos) < 45 * 45) { near = true; break; }
            }
            for (const a of info.arms) {
                a.open += ((near ? 1 : 0) - a.open) * Math.min(1, dt * 2.5);
                a.pivot.rotation.x = a.side * a.open * 1.35;
            }
        }
    }
}
