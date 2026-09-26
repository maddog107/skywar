// ═══════════════════════════════════════════════════════════════
// Ground targets for Strike mode: SAM sites, AAA, radars, hangars, fuel, armour
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, RUNWAY, groundHeight, baseToWorld } from './world.js';
import { makeParkedModel } from './airbase.js';
import { propInstance, hasProp } from './props.js';
import { rand, clamp, interceptTime, lerp } from './util.js';
import { WEAPONS } from './config.js';
import { samplePath, LANE, roadLiftAt } from './roads.js';
import { craterAdj } from './craters.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

const M = {
    olive: new THREE.MeshStandardMaterial({ color: 0x4f5a3c, roughness: 0.8, metalness: 0.2 }),
    sand: new THREE.MeshStandardMaterial({ color: 0x9a8a68, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6b7075, roughness: 0.5, metalness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6, metalness: 0.2 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.7 }),
    red: new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.7 }),
    charred: new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 1 }),
    scorched: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95, metalness: 0.2 }),
    net: new THREE.MeshStandardMaterial({ color: 0x66744c, roughness: 1, side: THREE.DoubleSide }),
    cap: new THREE.MeshStandardMaterial({ color: 0x3a3f36, roughness: 0.7 }),
};
// a camouflage net draped over a site: a flat, ragged, slightly domed disc
function netGeo(r) {
    return geo('net ' + r, () => {
        const g = new THREE.CircleGeometry(r, 14, 0, Math.PI * 2);
        const p = g.attributes.position;
        for (let i = 1; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), k = 0.8 + Math.random() * 0.35;
            p.setXYZ(i, x * k, y * k, 0);
        }
        p.setZ(0, r * 0.18);
        g.rotateX(-Math.PI / 2);
        g.computeVertexNormals();
        return g;
    });
}
M.whiteDS = M.white.clone(); M.whiteDS.side = THREE.DoubleSide; // radar dish (seen from behind too)

// Geometry shared by every target (keyed by shape + dimensions), like the materials above:
// targets are rebuilt every sortie, so nothing here is ever disposed or duplicated.
const GEO = new Map();
function geo(key, make) {
    let g = GEO.get(key);
    if (!g) GEO.set(key, g = make());
    return g;
}
const boxGeo = (w, h, d) => geo(`box ${w} ${h} ${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylGeo = (r1, r2, h, seg) => geo(`cyl ${r1} ${r2} ${h} ${seg}`, () => new THREE.CylinderGeometry(r1, r2, h, seg));
const torusGeo = (r, t, rs, ts) => geo(`torus ${r} ${t} ${rs} ${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));

// Parked jets: one template per type, cloned (clone(true) shares geometry and materials)
const parkedTemplates = {};
function parkedModel(id) {
    return (parkedTemplates[id] || (parkedTemplates[id] = makeParkedModel(id))).clone(true);
}

// Target-board face: one texture + material for every board
let boardMat = null;
function boardMaterial() {
    if (boardMat) return boardMat;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    for (let r = 6; r >= 1; r--) {
        ctx.fillStyle = r % 2 ? '#e8e2d0' : '#c8321e';
        ctx.beginPath(); ctx.arc(64, 64, r * 10.5, 0, 6.28); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return (boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
}

const TYPES = {
    sam: { name: 'SAM SITE', hp: 110, radius: 14, score: 300, boom: 1.4 },
    aaa: { name: 'AAA', hp: 70, radius: 9, score: 150, boom: 0.9 },
    radar: { name: 'RADAR', hp: 140, radius: 16, score: 250, boom: 1.4 },
    hangar: { name: 'HANGAR', hp: 220, radius: 30, score: 200, boom: 2.2 },
    fuel: { name: 'FUEL DEPOT', hp: 60, radius: 14, score: 150, boom: 3 },
    tank: { name: 'ARMOR', hp: 90, radius: 7, score: 100, boom: 1 },
    bunker: { name: 'COMMAND', hp: 400, radius: 22, score: 500, boom: 2.6 },
    board: { name: 'TARGET', hp: 20, radius: 9, score: 150, boom: 0.6 },
    parked: { name: 'PARKED JET', hp: 35, radius: 9, score: 250, boom: 1.6 },
    // convoy vehicles
    truck: { name: 'TRUCK', hp: 45, radius: 6, score: 80, boom: 0.9 },
    humvee: { name: 'HUMVEE', hp: 35, radius: 4, score: 70, boom: 0.8 },
    fueltruck: { name: 'FUEL TRUCK', hp: 40, radius: 6, score: 100, boom: 2.4 },
    spaag: { name: 'MOBILE AAA', hp: 75, radius: 7, score: 180, boom: 1.1, role: 'aaa' },
    msam: { name: 'MOBILE SAM', hp: 80, radius: 7, score: 300, boom: 1.5, role: 'sam', ammo: 3 },
};

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(boxGeo(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}
function cyl(r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 12) {
    const m = new THREE.Mesh(cylGeo(r1, r2, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}

function buildMesh(type, opts = {}) {
    const g = new THREE.Group();
    const parts = {};
    switch (type) {
        case 'parked': {
            const m = parkedModel(opts.model || 'mig29');
            m.rotation.y = opts.modelRot || 0;
            g.add(m);
            break;
        }
        case 'sam': {
            g.add(box(4, 1.8, 10, M.olive, 0, 0.6, 0));
            g.add(box(3.6, 2, 3, M.olive, 0, 1.2, -4));
            for (const z of [-3.5, 0, 3.5]) for (const x of [-1.9, 1.9]) { const w = cyl(0.6, 0.6, 0.5, M.dark, 0, 0, 0, 10); w.rotation.z = Math.PI / 2; w.position.set(x, 0.6, z); g.add(w); }
            const rack = new THREE.Group();
            for (let i = 0; i < 4; i++) {
                const t = new THREE.Mesh(cylGeo(0.45, 0.45, 8, 10), M.white);
                t.rotation.x = Math.PI / 2;
                t.position.set((i % 2 ? 0.55 : -0.55), (i < 2 ? 0 : 1.0), 0);
                t.castShadow = true;
                rack.add(t);
                const c = new THREE.Mesh(cylGeo(0.47, 0.47, 0.25, 10), M.cap);
                c.rotation.x = Math.PI / 2;
                c.position.set(t.position.x, t.position.y, -4);
                rack.add(c);
            }
            rack.position.set(0, 3.2, 1.5);
            rack.rotation.x = 0.6;
            g.add(rack);
            parts.rack = rack;
            // sandbag berm, and a camouflage net over the back of the pit
            const berm = new THREE.Mesh(torusGeo(11, 1.4, 6, 20), M.sand);
            berm.rotation.x = Math.PI / 2; berm.position.y = 0.4; berm.receiveShadow = true;
            g.add(berm);
            const net = new THREE.Mesh(netGeo(4.5), M.net);
            net.position.set(-6.5, 2.2, 4.5); net.receiveShadow = true; net.castShadow = true;
            g.add(box(0.15, 2.2, 0.15, M.dark, -6.5, 0, 4.5));
            g.add(net);
            break;
        }
        case 'aaa': {
            g.add(cyl(3.5, 4, 1.2, M.olive));
            const tur = new THREE.Group();
            tur.add(box(3, 1.6, 3, M.olive, 0, 0, 0));
            for (const s of [-0.6, 0.6]) {
                const b = new THREE.Mesh(cylGeo(0.15, 0.15, 5, 6), M.dark);
                b.rotation.x = Math.PI / 2; b.position.set(s, 1.1, -2.5);
                tur.add(b);
            }
            const fc = new THREE.Mesh(geo('aaaDish', () => new THREE.CylinderGeometry(0.9, 0.9, 0.2, 12)), M.steel);
            fc.rotation.x = Math.PI / 2 - 0.3; fc.position.set(0, 2.3, 1.2);
            tur.add(fc);
            tur.position.y = 1.2;
            g.add(tur);
            parts.turret = tur;
            for (const [x, z] of [[4.5, 1], [4.6, -0.6], [-4.4, 2]]) g.add(box(1.2, 0.6, 0.8, M.olive, x, 0, z));
            const berm = new THREE.Mesh(torusGeo(6, 1, 6, 16), M.sand);
            berm.rotation.x = Math.PI / 2; berm.position.y = 0.3;
            g.add(berm);
            break;
        }
        case 'radar': {
            g.add(box(6, 3, 6, M.concrete));
            g.add(cyl(0.8, 1, 10, M.steel, 0, 3, 0, 8));
            const dish = new THREE.Group();
            const d = new THREE.Mesh(geo('dish', () => new THREE.SphereGeometry(7, 16, 8, 0, Math.PI * 2, 0, 0.9)), M.whiteDS);
            d.rotation.x = -Math.PI / 2 + 0.4;
            d.castShadow = true;
            dish.add(d);
            dish.position.y = 14;
            g.add(dish);
            parts.dish = dish;
            break;
        }
        case 'hangar': {
            const h = new THREE.Mesh(geo('hangar', () => new THREE.CylinderGeometry(20, 20, 50, 16, 1, false, 0, Math.PI)), M.concrete);
            h.rotation.z = Math.PI / 2; h.rotation.y = Math.PI / 2;
            h.castShadow = true; h.receiveShadow = true;
            g.add(h);
            g.add(box(38, 16, 1, M.dark, 0, 0, -25));
            break;
        }
        case 'fuel': {
            for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
                g.add(cyl(5.5, 5.5, 7, M.white, x, 0, z, 16));
                g.add(cyl(5.6, 5.6, 0.8, M.red, x, 6.8, z, 16));
            }
            break;
        }
        case 'tank': {
            if (hasProp('tank')) { g.add(propInstance('tank')); break; }
            g.add(box(3.6, 1.4, 7, M.olive, 0, 0.5, 0));
            const tur = new THREE.Group();
            tur.add(box(2.6, 1, 3, M.olive));
            const b = new THREE.Mesh(cylGeo(0.15, 0.15, 5, 6), M.dark);
            b.rotation.x = Math.PI / 2; b.position.set(0, 0.5, -3.5);
            tur.add(b);
            tur.position.y = 1.9;
            g.add(tur);
            parts.turret = tur;
            for (const s of [-1.6, 1.6]) g.add(box(0.8, 1.1, 7.2, M.dark, s, 0, 0));
            break;
        }
        case 'humvee':
            if (hasProp('humvee')) { g.add(propInstance('humvee')); break; }
        // falls through (no model loaded)
        case 'truck':
            if (hasProp('m939')) { g.add(propInstance('m939')); break; }
        // falls through (no model loaded)
        case 'fueltruck': {
            g.add(box(2.6, 2.4, 2.6, M.olive, 0, 0.9, -3.2));             // cab
            g.add(box(2.7, 0.5, 8.6, M.dark, 0, 0.6, 0));                 // chassis
            if (type === 'truck') g.add(box(2.7, 2.6, 5.6, M.sand, 0, 1.1, 1.3)); // canvas cargo
            else { const t = cyl(1.3, 1.3, 5.6, M.steel, 0, 0, 0); t.rotation.x = Math.PI / 2; t.position.set(0, 2.5, 1.3); g.add(t); }
            for (const z of [-3, 1, 3]) for (const x of [-1.25, 1.25]) { const w = cyl(0.55, 0.55, 0.5, M.dark, 0, 0, 0, 10); w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w); }
            break;
        }
        case 'spaag':
            if (hasProp('tank')) { g.add(propInstance('tank')); parts.turret = null; break; }
        // falls through (no model loaded)
        case 'msam': {
            if (type === 'msam' && hasProp('m939')) {
                // truck-mounted SAM: missile rack on the cargo bed
                g.add(propInstance('m939'));
                const rack = new THREE.Group();
                for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(cylGeo(0.28, 0.28, 3.8, 8), M.white); t.rotation.x = Math.PI / 2; t.position.set(-0.9 + i * 0.6, 0, 0); t.castShadow = true; rack.add(t); }
                rack.add(box(2.6, 0.3, 3.9, M.olive, 0, -0.45, 0));
                const mount = new THREE.Group(); mount.position.set(0, 3.1, 1.8); mount.add(rack); rack.rotation.x = 0.45;
                g.add(mount);
                parts.rack = mount;
                break;
            }
            g.add(box(3.4, 1.5, 7, M.olive, 0, 0.45, 0));
            for (const x of [-1.5, 1.5]) g.add(box(0.8, 1.1, 7.2, M.dark, x, 0, 0));
            const tur = new THREE.Group();
            if (type === 'spaag') {
                tur.add(box(2.8, 1.3, 3, M.olive));
                for (const x of [-0.5, 0.5]) { const b = new THREE.Mesh(cylGeo(0.12, 0.12, 4, 6), M.dark); b.rotation.x = Math.PI / 2 - 0.5; b.position.set(x, 1.6, -1.6); tur.add(b); }
                const dish = box(1.2, 0.9, 0.2, M.steel, 0, 1.3, 1.3); tur.add(dish);
            } else {
                tur.add(box(2.4, 0.6, 2.4, M.olive));
                const rack = new THREE.Group();
                for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(cylGeo(0.3, 0.3, 4, 8), M.white); t.rotation.x = Math.PI / 2; t.position.set(-0.7 + i * 0.7, 0, 0); rack.add(t); }
                rack.position.set(0, 1.4, 0); rack.rotation.x = 0.5;
                tur.add(rack);
                parts.rack = tur;
            }
            tur.position.y = 1.95;
            g.add(tur);
            parts.turret = tur;
            break;
        }
        case 'board': {
            const face = new THREE.Mesh(geo('board', () => new THREE.CircleGeometry(7, 28)), boardMaterial());
            face.position.y = 9;
            face.castShadow = true;
            g.add(face);
            for (const x of [-4, 4]) g.add(cyl(0.3, 0.3, 9, M.dark, x, 0, 0.3, 6));
            break;
        }
        case 'bunker': {
            g.add(box(40, 10, 30, M.concrete));
            g.add(box(12, 6, 12, M.concrete, 8, 10, 4));
            g.add(cyl(0.3, 0.3, 18, M.steel, -12, 10, -8, 6));
            break;
        }
    }
    return { group: g, parts };
}

class GroundTarget {
    constructor(sys, type, x, z, rot, team = 'red', opts = {}) {
        this.sys = sys;
        this.game = sys.game;
        this.type = type;
        this.def = TYPES[type];
        this.name = this.def.name;
        this.team = team;
        this.isGround = true;
        this.alive = true;
        this.hp = this.maxHp = this.def.hp;
        this.health = this.hp; this.maxHealth = this.hp;
        this.radius = this.def.radius;
        this.hitRadius = this.def.radius;
        const y = groundHeight(x, z);
        const { group, parts } = buildMesh(type, opts);
        group.position.set(x, y, z);
        group.rotation.y = rot;
        this.mesh = group;
        this.parts = parts;
        this.pos = new THREE.Vector3(x, y + this.radius * 0.4, z);
        this.center = this.pos;
        this.vel = new THREE.Vector3();
        this.incoming = [];
        this.game.scene.add(group);
        this.fireT = rand(2, 6);
        this.lockT = 0;
        this.smokeT = 0;
        this.burnT = 0;
        this.launchDir = new THREE.Vector3(0, 1, 0);
        this.role = this.def.role || type;
        this.ammo = this.def.ammo || (type === 'sam' ? 4 : Infinity);
        this.route = null;
    }

    // Drive along a road path: route = { path, s, dir, speed, target }
    follow(path, s, dir) {
        this.route = { path, s, dir, speed: 0, cruise: 12, stopAt: null };
        this.placeOnRoute();
    }

    placeOnRoute() {
        const r = this.route;
        const p = samplePath(r.path, r.s, _v1, _v2);
        if (r.dir < 0) _v2.negate();
        const rl = Math.hypot(_v2.x, _v2.z) || 1;
        p.x += -_v2.z / rl * LANE * 0.5; p.z += _v2.x / rl * LANE * 0.5;
        // drawn with the road's distance lift so it doesn't sink into the road when seen from afar (and down into
        // any crater on the road)
        this.craterY = craterAdj(p.x, p.z);
        this.mesh.position.set(p.x, p.y + this.craterY + roadLiftAt(p.x, p.y, p.z, this.game.camera && this.game.camera.position), p.z);
        this.mesh.rotation.set(0, Math.atan2(-_v2.x, -_v2.z), 0);
        this.pos.set(p.x, p.y + this.craterY + this.radius * 0.4, p.z);
    }

    driveRoute(dt) {
        const r = this.route;
        let target = r.cruise;
        if (r.stopAt != null) {
            const d = (r.stopAt - r.s) * r.dir;
            target = d <= 0.5 ? 0 : Math.min(r.cruise, d * 0.35);
        }
        r.speed += clamp(target - r.speed, -6 * dt, 2.5 * dt);
        r.s = clamp(r.s + r.dir * r.speed * dt, 0, r.path.len);
        this.vel.set(0, 0, 0);
        this.placeOnRoute();
        if (dt > 0) this.vel.copy(_v2).multiplyScalar(r.speed);
    }

    damage(amount, source, kind) {
        if (!this.alive) return;
        this.lastKind = kind;
        this.hp -= amount;
        this.health = this.hp;
        if (this.hp <= 0) this.destroy(source);
    }

    destroy(source) {
        this.alive = false;
        this.hp = this.health = 0;
        const fx = this.game.effects;
        fx.explosion(this.pos, this.def.boom);
        if (this.type === 'fuel') {
            this.sys.later(() => fx.explosion(_v1.copy(this.pos).add(_v2.set(10, 5, 5)), 2.5), 250);
        }
        fx.debrisBurst(this.pos, _v1.set(0, 30, 0), 6, 1.2);
        // burnt out: charred all over (a few panels merely scorched)
        this.mesh.traverse(o => { if (o.isMesh) o.material = o.material === M.sand || o.material === M.concrete || Math.random() < 0.2 ? M.scorched : M.charred; });
        // turrets, launcher racks and dishes are blown off and land nearby
        const loose = this.parts.turret || this.parts.rack || this.parts.dish;
        if (loose && loose.parent && !this.sinking) {
            const up = this.type === 'radar' ? 12 : 22;
            fx.throwPart(loose, _v1.set(rand(-7, 7), rand(up, up + 12), rand(-7, 7)), 3, true);
            this.parts.turret = this.parts.rack = this.parts.dish = null;
        }
        // the wreck settles: buildings and tanks cave in, vehicles slump on burst tyres, the board falls over
        const m = this.mesh;
        switch (this.type) {
            case 'hangar': m.scale.y = 0.35; break;
            case 'bunker': m.scale.y = 0.6; break;
            case 'fuel': m.scale.y = 0.5; break;
            case 'board': m.rotation.x = -1.35; break;
            case 'radar': m.rotation.z = rand(-0.35, 0.35); m.rotation.x = rand(-0.2, 0.2); break;
            case 'parked': m.position.y -= 0.8; m.rotation.z += rand(-0.12, 0.12); m.rotation.x += rand(-0.08, 0.08); break;
            default: m.position.y -= 0.25; m.rotation.x += rand(-0.07, 0.07); m.rotation.z += rand(-0.1, 0.1);
        }
        this.burnT = rand(40, 80);
        // a column of black smoke that thins out as the fire burns down
        if (!this.sinking) fx.smokeColumn(_v1.copy(this.pos).setY(this.pos.y - this.radius * 0.2), clamp(this.radius / 13, 0.5, 1.8), this.burnT * 0.8);
        this.game.events.emit('groundKilled', this, { source });
        if (this.route) this.route.speed = 0;
    }

    update(dt) {
        const g = this.game;
        const fx = g.effects;
        if (!this.alive) {
            if (this.sinking) {
                // fell off a broken bridge
                this.sinkV = (this.sinkV || 0) + 9.8 * dt;
                if (this.mesh.position.y > -30) this.mesh.position.y -= this.sinkV * dt;
                if (!this.splashed && this.mesh.position.y < 0.5) { this.splashed = true; fx.waterSplash(_v1.copy(this.mesh.position).setY(0.5), 1.2); this.burnT = 0; }
                return;
            }
            if (this.burnT > 0) {
                // (the smoke column itself is an effects emitter): flames licking over the wreck
                this.burnT -= dt;
                this.smokeT -= dt;
                if (this.smokeT <= 0) {
                    this.smokeT = 0.15;
                    const r = this.radius * 0.4;
                    if (Math.random() < 0.6) fx.puffFire(_v2.copy(this.pos).add(_v1.set(rand(-r, r), rand(-1, 1), rand(-r, r))), _v1.set(0, rand(4, 8), 0), rand(2.5, 4.5) * clamp(this.radius / 10, 0.6, 1.8), 0.6);
                }
            }
            return;
        }
        if (this.parts.dish) this.parts.dish.rotation.y += dt * 1.2;
        if (this.route) this.driveRoute(dt);
        if (!g.player) return;
        if (this.role !== 'aaa' && this.role !== 'sam') return;
        const targets = g.aircraft.filter(a => a.alive && a.team !== this.team && !a.onGround);
        if (!targets.length) return;
        // nearest target
        let t = null, bd = Infinity;
        for (const a of targets) { const d = a.pos.distanceToSquared(this.pos); if (d < bd) { bd = d; t = a; } }
        const dist = Math.sqrt(bd);
        const agl = t.pos.y - groundHeight(t.pos.x, t.pos.z);
        const diff = g.difficulty;

        if (this.role === 'aaa' && dist < 2800) {
            // aim with lead and jitter
            const rel = _v1.subVectors(t.pos, this.pos);
            const tt = interceptTime(rel.x, rel.y, rel.z, t.vel.x, t.vel.y, t.vel.z, 900);
            if (tt > 0) {
                const aim = _v2.copy(t.pos).addScaledVector(t.vel, tt * rand(0.7, 1.15));
                aim.x += rand(-40, 40); aim.y += rand(-30, 40); aim.z += rand(-40, 40);
                const dir = aim.sub(this.pos).normalize();
                if (this.parts.turret) this.parts.turret.rotation.y = Math.atan2(-dir.x, -dir.z) - this.mesh.rotation.y;
                this.fireT -= dt;
                if (this.fireT <= 0) {
                    this.fireT = 0.09;
                    this.burst = (this.burst || 0) + 1;
                    if (this.burst > 14) { this.burst = 0; this.fireT = rand(1.5, 3.5) / Math.max(diff.enemyMissileRate, 0.4); }
                    const muzzle = _v1.copy(this.pos).setY(this.pos.y + 3);
                    g.weapons.fireFlak(muzzle, dir, this, 5 + diff.skill * 4);
                    g.events.emit('aaaFire', this);
                }
            }
        }

        if (this.role === 'sam' && this.ammo > 0 && dist < WEAPONS.sam.range && dist > 600 && agl > 50) {
            const radarsUp = this.type === 'msam' || this.sys.targets.some(x => x.alive && x.type === 'radar');
            this.lockT += dt * (radarsUp ? 1 : 0.4);
            t.lockedBy = t.lockedBy || new Set();
            t.lockedBy.add(this);
            this.fireT -= dt;
            if (this.parts.rack) this.parts.rack.rotation.y = Math.atan2(-(t.pos.x - this.pos.x), -(t.pos.z - this.pos.z)) - this.mesh.rotation.y;
            if (this.lockT > 3.2 && this.fireT <= 0 && t.incoming.length < 2) {
                this.launchDir.subVectors(t.pos, this.pos).normalize().lerp(_v1.set(0, 1, 0), 0.5).normalize();
                g.weapons.fireMissile(this, t, 'sam');
                this.ammo--;
                this.fireT = lerp(16, 9, diff.skill);
                this.lockT = 1.5;
            }
        } else if (this.role === 'sam') {
            this.lockT = Math.max(0, this.lockT - dt);
            if (t.lockedBy) t.lockedBy.delete(this);
        }
    }

    remove() { this.game.scene.remove(this.mesh); }
}

export class GroundForces {
    constructor(game) {
        this.game = game;
        this.targets = [];
        this.timers = new Set();
    }

    // setTimeout that's cancelled when the sortie ends (no explosions in the menu scene)
    later(fn, ms) {
        const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
        this.timers.add(id);
    }

    spawnEnemyBase() {
        const b = BASES.find(x => !x.friendly);
        const c = Math.cos(b.heading), s = Math.sin(b.heading);
        // local coords: x across runway, z along runway
        void c; void s;
        const place = (type, lx, lz, rot = 0, opts) => {
            const w = baseToWorld(b, lx, lz);
            return this.addTarget(type, w.x, w.z, -b.heading + rot, 'red', opts);
        };
        // jets parked on the apron, nose toward the taxiway
        for (const [id, x, z] of [['mig29', 335, 200], ['mig29', 335, 240], ['su35', 335, 285], ['su57', 335, 330], ['j20', 335, 372]]) place('parked', x, z, Math.PI / 2, { model: id });
        place('bunker', 400, 200);
        place('radar', 420, -350);
        place('radar', -700, 600);
        for (let i = 0; i < 3; i++) place('hangar', 300, -50 + i * 70, Math.PI / 2); // clear of the access road spur (ends z=-110)
        place('fuel', 520, 420);
        place('fuel', 480, -700);
        // SAM ring
        const samR = 1300;
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.4;
            place('sam', Math.cos(a) * samR, Math.sin(a) * samR * 1.2, rand(0, 6));
        }
        // AAA near the runway and the core
        for (const [x, z] of [[-150, -1200], [-150, 1200], [200, 0], [600, -200], [-400, -300], [650, 600]]) place('aaa', x, z);
        // armour column
        for (let i = 0; i < 5; i++) place('tank', -300 + i * 18, 900 + i * 25, 0.3);
        void RUNWAY;
    }

    addTarget(type, x, z, rot = 0, team = 'red', opts = {}) {
        const t = new GroundTarget(this, type, x, z, rot, team, opts);
        this.targets.push(t);
        return t;
    }

    get remaining() { return this.targets.filter(t => t.alive && !t.isShip && !t.isBridge && !t.route && t.type !== 'tank' && t.type !== 'board' && t.type !== 'parked').length; }
    get total() { return this.targets.filter(t => !t.isShip && !t.isBridge && !t.route && t.type !== 'tank' && t.type !== 'board' && t.type !== 'parked').length; }

    // Bridges live in the world; while a game runs they're (neutral) targets too
    addBridges(bridges) {
        for (const b of bridges || []) this.targets.push(b);
    }

    update(dt) { for (const t of this.targets) if (!t.isShip) t.update(dt); }

    clear() {
        this.targets.forEach(t => { if (!t.isShip) t.remove(); });
        this.targets = [];
        this.timers.forEach(clearTimeout);
        this.timers.clear();
    }
}
