// ═══════════════════════════════════════════════════════════════
// The airbases' installations as things you can see (docs/WAR.md, "Airbases"): the paving we add (shelter lanes,
// the alert pad, links world.js leaves out), the hardened aircraft shelters with their doors and the jets inside,
// the alert crews' building, munitions igloos, fuel tank farms in their bunds, the power plant, sirens, searchlight
// trailers, personnel bunkers and the launcher revetments. Models from models/airbases (airbasemodels.js), drawn
// instanced (one draw call per material for all the shelters of a field, one for their doors…), simple stand-ins
// where a model is missing. Wrecked states for the war (a shelter caved in, an igloo blown out, tanks burst), put
// back for the next sortie. Solid for aircraft and rounds (buildings.js records); their damage is bases.js's.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { baseToWorld, terrainHeight } from './world.js';
import { WORLD_BUILDINGS } from './buildings.js';
import { airbaseModelsReady, hasModel, modelSplit, modelParts } from './airbasemodels.js';
import { dress } from './dressing.js';
import { VEHICLES, pose } from './vehicles.js';
import { offsetUnits } from './util.js';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const JET_TYPES = { blue: ['f16', 'f15'], red: ['mig29', 'su35'] };
const FAR = 16000, NEAR_JETS = 4500;

let paveMat = null;
function pavingMaterial() {
    return paveMat || (paveMat = new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: offsetUnits(-2) }));
}
let charMat = null;
const charred = () => charMat || (charMat = new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 1 }));

// stand-in geometry (a model that didn't load)
function fallbackParts(kind) {
    const conc = new THREE.MeshStandardMaterial({ color: 0x8f8c85, roughness: 0.95 });
    const earth = new THREE.MeshStandardMaterial({ color: 0x5d6446, roughness: 1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.5, metalness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xcfd2cf, roughness: 0.6 });
    switch (kind) {
        case 'has_nato': case 'has_red': {
            const g = new THREE.CylinderGeometry(12.5, 12.5, 38, 18, 1, false, -Math.PI / 2, Math.PI);
            g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 2); g.scale(1, 0.72, 1);
            return [{ geometry: g, material: kind === 'has_red' ? earth : conc }];
        }
        case 'igloo': { const g = new THREE.CylinderGeometry(6, 6, 24, 12, 1, false, -Math.PI / 2, Math.PI); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 2); g.scale(1, 0.7, 1); return [{ geometry: g, material: earth }]; }
        case 'fueltank': { const g = new THREE.CylinderGeometry(9, 9, 11, 20); g.translate(0, 5.5, 0); return [{ geometry: g, material: white }]; }
        case 'generator': { const g = new THREE.BoxGeometry(26, 9, 18); g.translate(0, 4.5, 0); return [{ geometry: g, material: conc }]; }
        case 'qrahut': { const g = new THREE.BoxGeometry(20, 5, 12); g.translate(0, 2.5, 0); return [{ geometry: g, material: conc }]; }
        case 'siren': { const g = new THREE.CylinderGeometry(0.15, 0.2, 12, 6); g.translate(0, 6, 0); return [{ geometry: g, material: steel }]; }
        case 'searchlight': { const g = new THREE.CylinderGeometry(0.8, 0.8, 1.2, 12); g.translate(0, 1.6, 0); return [{ geometry: g, material: steel }]; }
        case 'revetment': { const g = new THREE.BoxGeometry(20, 4, 28); g.translate(0, 2, 0); return [{ geometry: g, material: conc }]; }
        default: return [];
    }
}

// instanced copies of a model (or its stand-in): one InstancedMesh per material, matrices given in world space
function instanced(parts, n, group, { color = false, shadow = true } = {}) {
    return parts.map(p => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, n));
        im.count = n;
        im.castShadow = shadow; im.receiveShadow = true;
        if (color) { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3).fill(1), 3); }
        im.frustumCulled = false;
        group.add(im);
        return im;
    });
}
const setAll = (ims, i, m) => { for (const im of ims) im.setMatrixAt(i, m); };
const touchAll = (ims) => { for (const im of ims) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } };
const colorAll = (ims, i, k) => { for (const im of ims) if (im.instanceColor) im.setColorAt(i, _c.setRGB(k, k, k)); };

export class FieldStructures {
    constructor(sys, F) {
        this.sys = sys; this.F = F; this.game = sys.game;
        this.b = F.base; this.L = F.L;
        this.group = new THREE.Group();
        this.group.name = 'airbase:' + F.id;
        this.jetGroup = new THREE.Group();
        this.group.add(this.jetGroup);
        this.built = false;
        this.shelters = new Map();   // sid → { i, def, M (world matrix), door: 0..1, want, wrecked, yaw, pos }
        this.recs = [];
    }

    get paveMat() { return this.paved ? pavingMaterial() : null; }

    // world matrix for base-local (lx, lz), yaw in base-local radians, on the ground (+dy)
    at(lx, lz, yaw = 0, dy = 0, out = new THREE.Matrix4(), sy = 1) {
        const w = baseToWorld(this.b, lx, lz);
        const g = Math.max(terrainHeight(w.x, w.z), 0);
        const y = Math.abs(g - this.b.h) < 3 ? this.b.h : g; // (on the field's level where it's flat)
        _q.setFromAxisAngle(UP, yaw - this.b.heading);
        return out.compose(_p.set(w.x, y + dy, w.z), _q, _s.set(1, sy, 1));
    }

    build() {
        const g = this.game;
        if (!g.scene) return;
        g.scene.add(this.group);
        this.buildPaving();
        airbaseModelsReady().then(() => {
            try { this.buildAll(); } catch (e) { console.warn('[basestructures]', e); }
        });
    }

    // our paving: the rects the layout marks as ours, one merged mesh
    buildPaving() {
        const own = (this.L.paved || []).filter(p => p.own);
        if (!own.length) return;
        const pos = [], nor = [], idx = [];
        for (const r of own) {
            const y = r.kind === 'apron' ? 0.085 : 0.105;
            const k = pos.length / 3;
            for (const [lx, lz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]) {
                const w = baseToWorld(this.b, lx, lz);
                pos.push(w.x, this.b.h + y, w.z); nor.push(0, 1, 0);
            }
            idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setIndex(idx);
        // (winding: the quads face up whatever the base's heading)
        geo.computeVertexNormals();
        const n = geo.attributes.normal;
        if (n.getY(0) < 0) { const a = geo.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } geo.computeVertexNormals(); }
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, pavingMaterial());
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.paved = mesh;
    }

    buildAll() {
        if (this.built) return;
        this.built = true;
        const F = this.F, L = this.L, b = this.b;
        const parts = (id) => (hasModel(id) ? modelParts(id) : null) || fallbackParts(id);
        // ── shelters: shells, doors, the jets inside ──
        const sh = L.shelters || [];
        if (sh.length) {
            const id = F.team === 'blue' ? 'has_nato' : 'has_red';
            const split = hasModel(id) ? modelSplit(id) : null;
            this.shellIM = instanced(split ? split.shell : fallbackParts(id), sh.length, this.group, { color: true });
            this.doorJoints = split ? split.joints.filter(j => /^door/.test(j.name)) : [];
            this.doorIM = this.doorJoints.map(j => instanced(j.parts, sh.length, this.group));
            sh.forEach((def, i) => {
                const yaw = def.face > 0 ? Math.PI : 0;
                const M = this.at(def.lx, def.lz, yaw, 0, new THREE.Matrix4());
                const w = baseToWorld(b, def.lx, def.lz);
                this.shelters.set(def.id, { i, def, M, yaw, door: def.alert ? 0 : 0, want: 0, wrecked: false, pos: new THREE.Vector3(w.x, b.h, w.z) });
                setAll(this.shellIM, i, M);
                this.placeDoors(this.shelters.get(def.id));
                this.solid('shelter', def.lx, def.lz, yaw, 26, 38, 9.4, 'HARDENED AIRCRAFT SHELTER', 'sh:' + def.id);
            });
            touchAll(this.shellIM);
            this.buildJets();
        }
        // ── the alert crews' building ──
        if (L.qraHut) {
            this.hutIM = instanced(parts('qrahut'), 1, this.group);
            setAll(this.hutIM, 0, this.at(L.qraHut.lx, L.qraHut.lz, Math.PI));
            touchAll(this.hutIM);
            this.solid('office', L.qraHut.lx, L.qraHut.lz, 0, 20, 12, 5, 'QRA CREW BUILDING');
        }
        // ── munitions igloos (doors toward +z) ──
        const am = L.ammo || [];
        if (am.length) {
            this.iglooIM = instanced(parts('igloo'), am.length, this.group, { color: true });
            am.forEach((s, i) => { setAll(this.iglooIM, i, this.at(s.lx, s.lz, Math.PI)); this.solid('bunker', s.lx, s.lz, 0, 12, 26, 6.5, 'MUNITIONS IGLOO', 'ig:' + i); });
            touchAll(this.iglooIM);
        }
        // ── the power plant ──
        if (L.power) {
            this.powerIM = instanced(parts('generator'), 1, this.group, { color: true });
            setAll(this.powerIM, 0, this.at(L.power.lx, L.power.lz, L.power.yaw || 0));
            touchAll(this.powerIM);
            this.solid('office', L.power.lx, L.power.lz, L.power.yaw || 0, 30, 20, 10, 'POWER PLANT', 'pw');
        }
        // ── fuel farms: three tanks in a bund at each POL site ──
        const fu = L.fuel || [];
        if (fu.length) {
            const T = [[-13, -9], [13, -9], [0, 13]];
            this.fuelIM = instanced(parts('fueltank'), fu.length * 3, this.group, { color: true });
            this.fuelSpots = [];
            fu.forEach((s, i) => {
                T.forEach(([dx, dz], k) => setAll(this.fuelIM, i * 3 + k, this.at(s.lx + dx, s.lz + dz, 0)));
                const w = baseToWorld(b, s.lx, s.lz);
                this.fuelSpots.push({ i, s, pos: new THREE.Vector3(w.x, b.h, w.z) });
                this.solid('radar', s.lx, s.lz, 0, 44, 44, 11, 'BULK FUEL STORAGE', 'fu:' + i);
            });
            touchAll(this.fuelIM);
            this.buildBunds(fu);
        }
        // ── sirens, searchlight trailers, personnel bunkers, revetments ──
        const si = L.sirens || [];
        if (si.length) { this.sirenIM = instanced(parts('siren'), si.length, this.group, { shadow: false }); si.forEach((s, i) => setAll(this.sirenIM, i, this.at(s.lx, s.lz, 0))); touchAll(this.sirenIM); }
        const sl = L.searchlights || [];
        if (sl.length) { this.slIM = instanced(parts('searchlight'), sl.length, this.group, { shadow: false }); sl.forEach((s, i) => setAll(this.slIM, i, this.at(s.lx, s.lz, i * 1.3))); touchAll(this.slIM); }
        this.buildBunkers(L.bunkers || []);
        const pads = L.pads || [];
        if (pads.length) {
            const rv = pads.filter(p => p.kind !== 'samradar');
            this.revIM = instanced(parts('revetment'), rv.length, this.group);
            rv.forEach((p, i) => { setAll(this.revIM, i, this.at(p.lx, p.lz, p.yaw || 0)); this.solidWalls(p); });
            touchAll(this.revIM);
        }
        if (WORLD_BUILDINGS.current) WORLD_BUILDINGS.current.index();
        // culled as a whole (the shadow cascades too) once the instances are placed
        for (const im of this.group.children) if (im.isInstancedMesh) { im.computeBoundingSphere(); im.frustumCulled = true; }
    }

    // the jets in the shelters: one InstancedMesh per part of each type the field flies (hidden when a shelter's empty)
    buildJets() {
        const ab = this.game.world && this.game.world.airbases;
        if (!ab || !ab.fleetParts) return;
        const n = this.shelters.size;
        this.jetIM = {};
        for (const id of JET_TYPES[this.F.team]) {
            const parts = ab.fleetParts(id);
            if (!parts || !parts.length) continue;
            // (inside the shelters: no shadows of their own; only as many instances drawn as there are jets of the type)
            this.jetIM[id] = instanced(parts, n, this.jetGroup, { shadow: false });
        }
        this.syncJets();
    }

    // show the jet in each shelter as the airwing has it (type; hidden while out, lost or taxiing)
    syncJets() {
        if (!this.jetIM) return;
        const aw = this.F.airwing, used = {};
        if (aw) for (const s of aw.shelters) {
            const S = this.shelters.get(s.id);
            if (!S || !s.alive || !s.jet || s.jet.state === 'lost' || S.jetOut) continue;
            const ims = this.jetIM[s.jet.type];
            if (!ims) continue;
            _m2.makeTranslation(0, 0.05, -3.5);
            const k = used[s.jet.type] = (used[s.jet.type] || 0) + 1;
            setAll(ims, k - 1, _m.multiplyMatrices(S.M, _m2));
        }
        // packed: each type draws only its jets
        for (const [id, ims] of Object.entries(this.jetIM)) for (const im of ims) { im.count = used[id] || 0; im.visible = im.count > 0; im.instanceMatrix.needsUpdate = true; if (im.count) { im.computeBoundingSphere(); im.frustumCulled = true; } }
    }
    // a shelter's jet is being taken out (life drives a real aircraft in its place) or is back in
    jetOut(sid, out) { const S = this.shelters.get(sid); if (S) { S.jetOut = out; this.syncJets(); } }
    // where a shelter's jet sits: world position and heading (the way it faces: out of the door)
    jetPose(sid, out = new THREE.Vector3()) {
        const S = this.shelters.get(sid);
        if (!S) return null;
        out.set(0, 0, -3.5).applyMatrix4(S.M);
        return { pos: out, heading: S.yaw - this.b.heading };
    }
    // a point out in front of a shelter's door (base-local), for taxiing
    doorFront(sid, dist = 30) {
        const S = this.shelters.get(sid);
        if (!S) return null;
        const f = S.def.face;
        return { lx: S.def.lx, lz: S.def.lz + f * (19 + dist) };
    }

    placeDoors(S) {
        if (!this.doorIM || !this.doorJoints.length) return;
        this.doorJoints.forEach((j, k) => {
            if (S.wrecked) { setAll(this.doorIM[k], S.i, HIDE); return; }
            const v = j.j.stow + (j.j.deploy - j.j.stow) * S.door;
            if (j.j.type === 'slide') _m2.compose(_p.copy(j.restPos).addScaledVector(j.axis, v), j.restQuat, _s.set(1, 1, 1));
            else _m2.compose(j.restPos, _q2.setFromAxisAngle(j.axis, v).multiply(j.restQuat), _s.set(1, 1, 1));
            setAll(this.doorIM[k], S.i, _m.multiplyMatrices(S.M, _m2));
        });
        for (const ims of this.doorIM) touchAll(ims);
    }
    // doors of a shelter toward open (1) / shut (0); they run at their own pace (about 25 s end to end, electric)
    setDoor(sid, want) { const S = this.shelters.get(sid); if (S) S.want = want; }
    doorOpen(sid) { const S = this.shelters.get(sid); return S ? S.door : 0; }

    // earth bunds round the fuel farms (a ring of banked earth) and the pump houses
    buildBunds(spots) {
        const earth = new THREE.MeshStandardMaterial({ color: 0x626a48, roughness: 1 });
        const pumpMat = new THREE.MeshStandardMaterial({ color: 0x9a978d, roughness: 0.9 });
        const geos = [], pumps = [];
        const bank = (x0, z0, x1, z1) => {
            const len = Math.hypot(x1 - x0, z1 - z0);
            const g = new THREE.CylinderGeometry(0.8, 2.6, 1.8, 4, 1); g.rotateY(Math.PI / 4); g.scale(1, 1, len / 3.7); g.translate(0, 0.9, 0);
            g.rotateY(Math.atan2(x1 - x0, z1 - z0));
            g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
            return g;
        };
        for (const s of spots) {
            const H = 30;
            const m = this.at(s.lx, s.lz, 0);
            for (const [a, c] of [[[-H, -H], [H, -H]], [[H, -H], [H, H]], [[H, H], [-H, H]], [[-H, H], [-H, -H]]]) { const g = bank(a[0], a[1], c[0], c[1]); g.applyMatrix4(m); geos.push(g); }
            const p = new THREE.BoxGeometry(8, 3.5, 6); p.translate(20, 1.75, 22); p.applyMatrix4(m); pumps.push(p);
        }
        const merge = (list, mat) => {
            if (!list.length) return;
            const nn = list.reduce((a, g) => a + (g.index ? g.index.count : g.attributes.position.count), 0);
            const pos = new Float32Array(nn * 3), nor = new Float32Array(nn * 3);
            let o = 0;
            for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
            const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.computeBoundingSphere();
            const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
        };
        merge(geos, earth); merge(pumps, pumpMat);
    }

    // hardened personnel shelters: a low concrete box, earth heaped on its sides, a blast wall across the entrance
    buildBunkers(list) {
        if (!list.length) return;
        const conc = new THREE.MeshStandardMaterial({ color: 0x8b8880, roughness: 0.95 });
        const body = new THREE.BoxGeometry(9, 2.6, 5); body.translate(0, 1.3, 0);
        const wall = new THREE.BoxGeometry(5, 2.2, 0.5); wall.translate(0, 1.1, -4.2);
        const merged = [body, wall].map(g => g.toNonIndexed());
        const pos = new Float32Array(merged.reduce((a, g) => a + g.attributes.position.count * 3, 0)), nor = new Float32Array(pos.length);
        let o = 0; for (const g of merged) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        this.bunkerIM = instanced([{ geometry: geo, material: conc }], list.length, this.group);
        list.forEach((s, i) => { setAll(this.bunkerIM, i, this.at(s.lx, s.lz, 0)); this.solid('booth', s.lx, s.lz, 0, 9, 5, 2.6, 'PERSONNEL SHELTER'); });
        touchAll(this.bunkerIM);
    }

    // a structure solid to aircraft and rounds (buildings.js): its damage is ours, so buildings.js can't wreck it
    solid(kind, lx, lz, yaw, w, d, ht, name, key = null) {
        const B = WORLD_BUILDINGS.current;
        if (!B) return null;
        const p = baseToWorld(this.b, lx, lz);
        const rec = B.add({ x: p.x, z: p.z, y: this.b.h, w, d, ht, yaw: yaw - this.b.heading, kind, name, friendly: this.F.team === 'blue', hp: 1e8 });
        rec.keep = true;
        if (key) this.recs.push({ key, rec });
        return rec;
    }
    // the revetment's three walls (the open side is where the launcher drives in)
    solidWalls(p) {
        const B = WORLD_BUILDINGS.current;
        if (!B) return;
        const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0);
        for (const [ox, oz, w, d] of [[-9.5, 0, 1.2, 28], [9.5, 0, 1.2, 28], [0, 13.5, 20, 1.2]]) {
            const lx = p.lx + ox * c + oz * s, lz = p.lz - ox * s + oz * c;
            this.solid('booth', lx, lz, p.yaw || 0, w, d, 4.2, 'REVETMENT');
        }
    }
    rec(key) { const r = this.recs.find(x => x.key === key); return r ? r.rec : null; }

    // ── wrecks ──
    wreckShelter(sid) {
        const S = this.shelters.get(sid);
        if (!S || S.wrecked || !this.shellIM) return;
        S.wrecked = true;
        // the arch caved in over what was inside: low, broken, burnt
        _q.setFromAxisAngle(_p.set(1, 0, 0.3).normalize(), 0.08);
        setAll(this.shellIM, S.i, _m.multiplyMatrices(S.M, _m2.compose(_p.set(0, -0.6, 0), _q, _s.set(1.03, 0.36, 0.96))));
        colorAll(this.shellIM, S.i, 0.22);
        touchAll(this.shellIM);
        this.placeDoors(S);
        this.syncJets();
        const r = this.rec('sh:' + sid);
        if (r) { r.top = r.y + 3.5; if (r.boxes) for (const q of r.boxes) q.y1 = Math.min(q.y1, r.y + 3.5); }
    }
    wreckIgloo(i) {
        if (!this.iglooIM) return;
        const s = this.L.ammo[i];
        setAll(this.iglooIM, i, this.at(s.lx, s.lz, Math.PI, -0.8, new THREE.Matrix4(), 0.45));
        colorAll(this.iglooIM, i, 0.25);
        touchAll(this.iglooIM);
    }
    wreckPower() {
        if (!this.powerIM) return;
        const p = this.L.power;
        setAll(this.powerIM, 0, this.at(p.lx, p.lz, p.yaw || 0, -0.5, new THREE.Matrix4(), 0.5));
        colorAll(this.powerIM, 0, 0.2);
        touchAll(this.powerIM);
    }
    wreckFuel(t) {
        if (!this.fuelIM || !this.fuelSpots) return;
        let best = null, bd = 60;
        for (const f of this.fuelSpots) { const d = Math.hypot(f.pos.x - t.pos.x, f.pos.z - t.pos.z); if (d < bd) { bd = d; best = f; } }
        if (!best) return;
        const T = [[-13, -9], [13, -9], [0, 13]];
        T.forEach(([dx, dz], k) => { setAll(this.fuelIM, best.i * 3 + k, this.at(best.s.lx + dx, best.s.lz + dz, k * 0.7, -0.3, new THREE.Matrix4(), 0.3 + k * 0.08)); colorAll(this.fuelIM, best.i * 3 + k, 0.15); });
        touchAll(this.fuelIM);
    }

    // the launchers on the pads wear their models: the S-300s (erected on alert), the Flap Lid, our HIMARS
    dressPad(t, p) {
        const id = p.kind === 'sam' ? 's300' : p.kind === 'samradar' ? 'flaplid' : p.kind === 'launcher' ? 'himars' : null;
        if (!id || !VEHICLES[id]) return;
        dress(t, id, { onRig: (rig) => { t.padRig = rig; t.erectK = 0; if (id === 'flaplid' || id === 'himars') for (const k of VEHICLES[id].deploy) pose(rig, k, 1); } });
    }

    // back to how it was built (a new sortie)
    reset() {
        if (!this.built) return;
        for (const S of this.shelters.values()) {
            S.wrecked = false; S.door = 0; S.want = 0; S.jetOut = false;
            setAll(this.shellIM, S.i, S.M); colorAll(this.shellIM, S.i, 1);
            this.placeDoors(S);
            const r = this.rec('sh:' + S.def.id);
            if (r) { r.top = r.y + 9.4; }
        }
        if (this.shellIM) touchAll(this.shellIM);
        (this.L.ammo || []).forEach((s, i) => { if (this.iglooIM) { setAll(this.iglooIM, i, this.at(s.lx, s.lz, Math.PI)); colorAll(this.iglooIM, i, 1); } });
        if (this.iglooIM) touchAll(this.iglooIM);
        if (this.powerIM) { const p = this.L.power; setAll(this.powerIM, 0, this.at(p.lx, p.lz, p.yaw || 0)); colorAll(this.powerIM, 0, 1); touchAll(this.powerIM); }
        if (this.fuelIM) {
            const T = [[-13, -9], [13, -9], [0, 13]];
            this.fuelSpots.forEach(f => T.forEach(([dx, dz], k) => { setAll(this.fuelIM, f.i * 3 + k, this.at(f.s.lx + dx, f.s.lz + dz, 0)); colorAll(this.fuelIM, f.i * 3 + k, 1); }));
            touchAll(this.fuelIM);
        }
        this.syncJets();
    }

    // per frame: what's drawn from here (distance), doors running, the S-300s erecting on alert
    update(dt, cam) {
        if (!cam) return;
        const d = Math.hypot(cam.x - this.b.x, cam.z - this.b.z);
        const vis = d < FAR + this.b.r;
        if (this.group.visible !== vis) this.group.visible = vis;
        const jv = d < NEAR_JETS + this.b.r;
        if (this.jetGroup.visible !== jv) this.jetGroup.visible = jv;
        if (!vis) return;
        for (const S of this.shelters.values()) {
            if (S.door === S.want || S.wrecked) continue;
            S.door = S.want > S.door ? Math.min(S.want, S.door + dt / 22) : Math.max(S.want, S.door - dt / 22);
            this.placeDoors(S);
        }
        // the launchers on the pads: erect on alert, stow when it's over (about 20 s)
        for (const t of this.F.units.pads) {
            if (!t.padRig || !t.alive || t.pad.kind !== 'sam') continue;
            const want = (t.readiness ?? 0.35) >= 1 ? 1 : 0;
            if (t.erectK === want) continue;
            t.erectK = want > t.erectK ? Math.min(1, t.erectK + dt / 20) : Math.max(0, t.erectK - dt / 25);
            const k = t.erectK;
            pose(t.padRig, 'jack', Math.min(1, k * 2)); pose(t.padRig, 'raise', Math.max(0, k * 2 - 1));
        }
    }
}
