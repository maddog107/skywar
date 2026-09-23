// ═══════════════════════════════════════════════════════════════
// Ground targets for Strike mode: SAM sites, AAA, radars, hangars, fuel, armour
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, RUNWAY, groundHeight } from './world.js';
import { rand, clamp, interceptTime, lerp } from './util.js';
import { WEAPONS } from './config.js';

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
};

const TYPES = {
    sam: { name: 'SAM SITE', hp: 110, radius: 14, score: 300, boom: 1.4 },
    aaa: { name: 'AAA', hp: 70, radius: 9, score: 150, boom: 0.9 },
    radar: { name: 'RADAR', hp: 140, radius: 16, score: 250, boom: 1.4 },
    hangar: { name: 'HANGAR', hp: 220, radius: 30, score: 200, boom: 2.2 },
    fuel: { name: 'FUEL DEPOT', hp: 60, radius: 14, score: 150, boom: 3 },
    tank: { name: 'ARMOR', hp: 90, radius: 7, score: 100, boom: 1 },
    bunker: { name: 'COMMAND', hp: 400, radius: 22, score: 500, boom: 2.6 },
    board: { name: 'TARGET', hp: 20, radius: 9, score: 150, boom: 0.6 },
};

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}
function cyl(r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}

function buildMesh(type) {
    const g = new THREE.Group();
    const parts = {};
    switch (type) {
        case 'sam': {
            g.add(box(4, 1.8, 10, M.olive, 0, 0.6, 0));
            g.add(box(3.6, 2, 3, M.olive, 0, 1.2, -4));
            const rack = new THREE.Group();
            for (let i = 0; i < 4; i++) {
                const t = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 8, 10), M.white);
                t.rotation.x = Math.PI / 2;
                t.position.set((i % 2 ? 0.55 : -0.55), (i < 2 ? 0 : 1.0), 0);
                t.castShadow = true;
                rack.add(t);
            }
            rack.position.set(0, 3.2, 1.5);
            rack.rotation.x = 0.6;
            g.add(rack);
            parts.rack = rack;
            // sandbag berm
            const berm = new THREE.Mesh(new THREE.TorusGeometry(11, 1.4, 6, 20), M.sand);
            berm.rotation.x = Math.PI / 2; berm.position.y = 0.4; berm.receiveShadow = true;
            g.add(berm);
            break;
        }
        case 'aaa': {
            g.add(cyl(3.5, 4, 1.2, M.olive));
            const tur = new THREE.Group();
            tur.add(box(3, 1.6, 3, M.olive, 0, 0, 0));
            for (const s of [-0.6, 0.6]) {
                const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), M.dark);
                b.rotation.x = Math.PI / 2; b.position.set(s, 1.1, -2.5);
                tur.add(b);
            }
            tur.position.y = 1.2;
            g.add(tur);
            parts.turret = tur;
            const berm = new THREE.Mesh(new THREE.TorusGeometry(6, 1, 6, 16), M.sand);
            berm.rotation.x = Math.PI / 2; berm.position.y = 0.3;
            g.add(berm);
            break;
        }
        case 'radar': {
            g.add(box(6, 3, 6, M.concrete));
            g.add(cyl(0.8, 1, 10, M.steel, 0, 3, 0, 8));
            const dish = new THREE.Group();
            const d = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 8, 0, Math.PI * 2, 0, 0.9), M.white);
            d.rotation.x = -Math.PI / 2 + 0.4; d.material.side = THREE.DoubleSide;
            d.castShadow = true;
            dish.add(d);
            dish.position.y = 14;
            g.add(dish);
            parts.dish = dish;
            break;
        }
        case 'hangar': {
            const h = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 50, 16, 1, false, 0, Math.PI), M.concrete);
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
            g.add(box(3.6, 1.4, 7, M.olive, 0, 0.5, 0));
            const tur = new THREE.Group();
            tur.add(box(2.6, 1, 3, M.olive));
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), M.dark);
            b.rotation.x = Math.PI / 2; b.position.set(0, 0.5, -3.5);
            tur.add(b);
            tur.position.y = 1.9;
            g.add(tur);
            parts.turret = tur;
            for (const s of [-1.6, 1.6]) g.add(box(0.8, 1.1, 7.2, M.dark, s, 0, 0));
            break;
        }
        case 'board': {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const ctx = c.getContext('2d');
            for (let r = 6; r >= 1; r--) {
                ctx.fillStyle = r % 2 ? '#e8e2d0' : '#c8321e';
                ctx.beginPath(); ctx.arc(64, 64, r * 10.5, 0, 6.28); ctx.fill();
            }
            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            const face = new THREE.Mesh(new THREE.CircleGeometry(7, 28), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
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
    constructor(sys, type, x, z, rot, team = 'red') {
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
        const { group, parts } = buildMesh(type);
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
        this.ammo = type === 'sam' ? 4 : Infinity;
    }

    damage(amount, source) {
        if (!this.alive) return;
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
            setTimeout(() => fx.explosion(_v1.copy(this.pos).add(new THREE.Vector3(10, 5, 5)), 2.5), 250);
        }
        fx.debrisBurst(this.pos, _v1.set(0, 30, 0), 6, 1.2);
        this.mesh.traverse(o => { if (o.isMesh) o.material = M.charred; });
        this.mesh.scale.y = 0.45;
        this.burnT = rand(40, 80);
        this.game.events.emit('groundKilled', this, { source });
    }

    update(dt) {
        const g = this.game;
        const fx = g.effects;
        if (!this.alive) {
            if (this.burnT > 0) {
                this.burnT -= dt;
                this.smokeT -= dt;
                if (this.smokeT <= 0) {
                    this.smokeT = 0.12;
                    _v1.set(rand(-3, 3), rand(8, 14), rand(-3, 3));
                    fx.smoke.emit(this.pos, _v1, rand(6, 10), 6, 40, [0.06, 0.06, 0.06], [0.28, 0.27, 0.26], 0.7, 0, 0.15, 6);
                    if (Math.random() < 0.5) fx.puffFire(_v2.copy(this.pos).add(_v1.set(rand(-4, 4), 0, rand(-4, 4))), _v1.set(0, 12, 0), 6, 0.6);
                }
            }
            return;
        }
        if (this.parts.dish) this.parts.dish.rotation.y += dt * 1.2;
        if (!g.player) return;
        if (this.type !== 'aaa' && this.type !== 'sam') return;
        const targets = g.aircraft.filter(a => a.alive && a.team !== this.team && !a.onGround);
        if (!targets.length) return;
        // nearest target
        let t = null, bd = Infinity;
        for (const a of targets) { const d = a.pos.distanceToSquared(this.pos); if (d < bd) { bd = d; t = a; } }
        const dist = Math.sqrt(bd);
        const agl = t.pos.y - groundHeight(t.pos.x, t.pos.z);
        const diff = g.difficulty;

        if (this.type === 'aaa' && dist < 2800) {
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

        if (this.type === 'sam' && this.ammo > 0 && dist < WEAPONS.sam.range && dist > 600 && agl > 50) {
            const radarsUp = this.sys.targets.some(x => x.alive && x.type === 'radar');
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
        } else if (this.type === 'sam') {
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
    }

    spawnEnemyBase() {
        const b = BASES.find(x => !x.friendly);
        const c = Math.cos(b.heading), s = Math.sin(b.heading);
        // local coords: x across runway, z along runway
        const place = (type, lx, lz, rot = 0) => {
            const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
            this.addTarget(type, x, z, -b.heading + rot);
        };
        place('bunker', 360, 200);
        place('radar', 420, -350);
        place('radar', -700, 600);
        for (let i = 0; i < 3; i++) place('hangar', 300, -120 + i * 70, Math.PI / 2);
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

    addTarget(type, x, z, rot = 0, team = 'red') {
        const t = new GroundTarget(this, type, x, z, rot, team);
        this.targets.push(t);
        return t;
    }

    get remaining() { return this.targets.filter(t => t.alive && !t.isShip && t.type !== 'tank' && t.type !== 'board').length; }
    get total() { return this.targets.filter(t => !t.isShip && t.type !== 'tank' && t.type !== 'board').length; }

    update(dt) { for (const t of this.targets) if (!t.isShip) t.update(dt); }

    clear() {
        this.targets.forEach(t => { if (!t.isShip) t.remove(); });
        this.targets = [];
    }
}
