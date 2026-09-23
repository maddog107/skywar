// ═══════════════════════════════════════════════════════════════
// Naval forces: aircraft carriers and destroyers.
//  • Ships steam in large circles in open ocean.
//  • Carrier decks are real landing surfaces (moving), with catapults and
//    arresting wires.
//  • CIWS guns shoot down incoming missiles and aircraft; SAM launchers defend
//    the group. Destroyed ships burn and sink.
// Ships implement the same interface as ground targets (pos, team, damage…)
// so HUD, targeting and weapons work on them unchanged.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight } from './world.js';
import { loft, createAircraftModel } from './models.js';
import { rand, clamp, lerp, interceptTime } from './util.js';
import { WEAPONS } from './config.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const damp01 = (a, b, dt) => a + (b - a) * (1 - Math.exp(-0.5 * dt));

const TYPES = {
    carrier: { name: 'CARRIER', L: 320, B: 76, deckY: 19, hp: 1300, score: 3000, speed: 12 },
    destroyer: { name: 'DESTROYER', L: 155, B: 20, deckY: 8, hp: 450, score: 1200, speed: 13 },
};

// Find a spot of open ocean where a ship can circle
export function findOcean(nearX, nearZ, minD, maxD, orbitR) {
    for (let tries = 0; tries < 400; tries++) {
        const a = Math.random() * Math.PI * 2, d = rand(minD, maxD);
        const x = nearX + Math.cos(a) * d, z = nearZ + Math.sin(a) * d;
        if (terrainHeight(x, z) > -50) continue;
        let ok = true;
        for (let k = 0; k < 16 && ok; k++) {
            const b = (k / 16) * Math.PI * 2;
            for (const r of [orbitR * 0.6, orbitR + 400]) {
                if (terrainHeight(x + Math.cos(b) * r, z + Math.sin(b) * r) > -25) { ok = false; break; }
            }
        }
        if (ok) return { x, z };
    }
    return null;
}

function deckTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3d4044'; ctx.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 9000; i++) {
        const v = 50 + Math.random() * 25;
        ctx.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
        ctx.fillRect(Math.random() * 256, Math.random() * 1024, 2, 2);
    }
    // angled landing area (stern at bottom, bow at top)
    ctx.save();
    ctx.translate(96, 1024);
    ctx.rotate(-0.16);
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 3;
    ctx.strokeRect(-40, -620, 80, 620);
    ctx.setLineDash([22, 18]);
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -600); ctx.lineTo(0, 0); ctx.stroke();
    ctx.setLineDash([]);
    // arresting wires
    ctx.strokeStyle = '#d8d0b0'; ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-40, -120 - k * 26); ctx.lineTo(40, -120 - k * 26); ctx.stroke(); }
    ctx.restore();
    // catapult tracks at the bow
    ctx.strokeStyle = '#8a8d90'; ctx.lineWidth = 2;
    for (const x of [150, 190]) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 420); ctx.stroke(); }
    // yellow taxi lines
    ctx.strokeStyle = '#e8c23a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(200, 980); ctx.bezierCurveTo(220, 700, 170, 500, 170, 60); ctx.stroke();
    // bow number
    ctx.fillStyle = '#e8e8e8'; ctx.font = 'bold 70px Arial'; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(128, 120); ctx.rotate(Math.PI); ctx.fillText('73', 0, 0); ctx.restore();
    // elevators
    ctx.strokeStyle = 'rgba(230,230,230,0.5)'; ctx.lineWidth = 2;
    ctx.strokeRect(205, 380, 45, 70); ctx.strokeRect(205, 560, 45, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    return t;
}

const MAT = {
    hull: new THREE.MeshStandardMaterial({ color: 0x5c6369, roughness: 0.7, metalness: 0.35 }),
    hullDark: new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.7, metalness: 0.3 }),
    super: new THREE.MeshStandardMaterial({ color: 0x6d747a, roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.1, metalness: 0.9 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd8dbdc, roughness: 0.5 }),
    charred: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }),
};
let deckTex = null;

function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
}

function buildCarrier(team) {
    const T = TYPES.carrier, L = T.L, g = new THREE.Group(), parts = {};
    const hull = new THREE.Mesh(loft([
        [-L * 0.5, 2, 6, T.deckY * 0.45, 2.5], [-L * 0.44, 14, 13, T.deckY * 0.4, 3], [-L * 0.3, 20, 14, T.deckY * 0.35, 4],
        [0, 21, 14, T.deckY * 0.35, 5], [L * 0.4, 20, 13, T.deckY * 0.4, 5], [L * 0.5, 18, 12, T.deckY * 0.45, 5],
    ], 20), MAT.hull);
    hull.castShadow = true; hull.receiveShadow = true;
    g.add(hull);
    // flight deck with overhang (angled deck to port)
    if (!deckTex) deckTex = deckTexture();
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, metalness: 0.1 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(T.B, 1.2, L), [MAT.hullDark, MAT.hullDark, deckMat, MAT.hullDark, MAT.hullDark, MAT.hullDark]);
    deck.position.set(-4, T.deckY - 0.6, 0);
    deck.receiveShadow = true; deck.castShadow = true;
    g.add(deck);
    // hangar walls under deck overhang
    box(T.B - 26, T.deckY - 8, L * 0.8, MAT.hullDark, -4, 8, 0, g);
    // island on the starboard side
    const ix = T.B * 0.5 - 12, iz = L * 0.08;
    box(12, 16, 36, MAT.super, ix, T.deckY, iz, g);
    box(10, 8, 22, MAT.super, ix, T.deckY + 16, iz - 2, g);
    box(10.2, 2.2, 18, MAT.glass, ix, T.deckY + 20, iz - 3, g);
    box(8, 6, 10, MAT.super, ix, T.deckY + 24, iz - 4, g);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 18, 8), MAT.super);
    mast.position.set(ix, T.deckY + 38, iz - 4);
    g.add(mast);
    const radar = new THREE.Group();
    radar.add(new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 0.5), MAT.white));
    radar.position.set(ix, T.deckY + 44, iz - 4);
    g.add(radar);
    parts.radar = radar;
    // parked jets along the bow starboard side
    for (let k = 0; k < 5; k++) {
        const { object } = createAircraftModel(k % 2 ? 'f14' : 'fa18');
        object.position.set(T.B * 0.5 - 16, T.deckY + 2.2, -L * 0.42 + k * 22);
        object.rotation.y = Math.PI / 2 + 0.5;
        object.scale.setScalar(0.95);
        g.add(object);
    }
    // CIWS and SAM mounts
    const mounts = [
        { type: 'ciws', p: new THREE.Vector3(T.B * 0.5 - 2, T.deckY - 2, -L * 0.45) },
        { type: 'ciws', p: new THREE.Vector3(-T.B * 0.5 + 2, T.deckY - 2, L * 0.44) },
        { type: 'ciws', p: new THREE.Vector3(T.B * 0.5 - 2, T.deckY - 2, L * 0.4) },
        { type: 'sam', p: new THREE.Vector3(-T.B * 0.5 + 4, T.deckY - 2, -L * 0.38) },
        { type: 'sam', p: new THREE.Vector3(T.B * 0.5 - 4, T.deckY - 2, L * 0.46) },
    ];
    mounts.forEach(m => addMount(g, m));
    void team;
    return { group: g, parts, mounts };
}

function buildDestroyer() {
    const T = TYPES.destroyer, L = T.L, g = new THREE.Group(), parts = {};
    const hull = new THREE.Mesh(loft([
        [-L * 0.5, 0.5, 2, T.deckY * 0.9, 2], [-L * 0.4, 6, 7, T.deckY * 0.5, 2.5], [-L * 0.1, 10, 8, T.deckY * 0.35, 3.5],
        [L * 0.3, 10, 8, T.deckY * 0.35, 4], [L * 0.5, 8, 6, T.deckY * 0.5, 4],
    ], 18), MAT.hull);
    hull.castShadow = true; hull.receiveShadow = true;
    g.add(hull);
    box(16, 1, L * 0.85, MAT.hullDark, 0, T.deckY - 1, 5, g);
    box(12, 10, 34, MAT.super, 0, T.deckY, -2, g);
    box(10, 6, 16, MAT.super, 0, T.deckY + 10, -6, g);
    box(10.2, 1.8, 6, MAT.glass, 0, T.deckY + 12, -12, g);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 16, 8), MAT.super);
    mast.position.set(0, T.deckY + 24, -4);
    g.add(mast);
    const radar = new THREE.Group();
    radar.add(new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 0.4), MAT.white));
    radar.position.set(0, T.deckY + 30, -4);
    g.add(radar);
    parts.radar = radar;
    box(8, 3, 14, MAT.super, 0, T.deckY, 34, g); // funnel/hangar
    box(9, 2, 10, MAT.hullDark, 0, T.deckY - 1, -44, g); // VLS
    const mounts = [
        { type: 'gun', p: new THREE.Vector3(0, T.deckY, -58) },
        { type: 'sam', p: new THREE.Vector3(0, T.deckY + 1, -44) },
        { type: 'ciws', p: new THREE.Vector3(0, T.deckY + 8, 26) },
    ];
    mounts.forEach(m => addMount(g, m));
    return { group: g, parts, mounts };
}

function addMount(g, m) {
    const turret = new THREE.Group();
    if (m.type === 'ciws') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1.8, 10), MAT.white);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.white);
        dome.position.y = 1.8;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3, 6), MAT.hullDark);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.4, -1.8);
        turret.add(base, dome, barrel);
    } else if (m.type === 'gun') {
        const h = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 6), MAT.super);
        h.position.y = 1.2;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7, 8), MAT.hullDark);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.6, -5.5);
        turret.add(h, barrel);
    } else {
        const b = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3), MAT.super);
        b.position.y = 1.1;
        turret.add(b);
    }
    turret.position.copy(m.p);
    turret.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.add(turret);
    m.turret = turret;
    m.fireT = rand(0, 2);
    m.lockT = 0;
}

export class Ship {
    constructor(naval, type, team, center, orbitR, angle, dir = 1, name = null) {
        this.naval = naval;
        this.game = naval.game;
        this.type = type;
        this.def = TYPES[type];
        this.team = team;
        this.isGround = true;
        this.isShip = true;
        this.name = name || this.def.name;
        this.callsign = this.name;
        this.hp = this.health = this.maxHp = this.maxHealth = this.def.hp;
        this.alive = true;
        this.center = new THREE.Vector3();
        this.pos = this.center;
        this.vel = new THREE.Vector3();
        this.radius = this.def.B * 0.6;
        this.hitRadius = 40;
        this.incoming = [];
        this.orbit = { cx: center.x, cz: center.z, R: orbitR, a: angle, w: dir * this.def.speed / orbitR };
        const built = type === 'carrier' ? buildCarrier(team) : buildDestroyer();
        this.mesh = built.group;
        this.parts = built.parts;
        this.mounts = built.mounts;
        this.game.scene.add(this.mesh);
        this.heading = 0;
        this.deckY = this.def.deckY;
        this.sinkT = 0;
        this.wakeT = 0;
        this.ammo = { sam: type === 'carrier' ? 8 : 12 };
        this.place(0);
    }

    place(dt) {
        const o = this.orbit;
        o.a += o.w * dt * (this.alive ? 1 - 0.6 * (1 - Math.max(this.hp, 0) / this.maxHp) : 0.15);
        const x = o.cx + Math.cos(o.a) * o.R, z = o.cz + Math.sin(o.a) * o.R;
        // tangent direction of travel
        const tx = -Math.sin(o.a) * Math.sign(o.w), tz = Math.cos(o.a) * Math.sign(o.w);
        this.heading = Math.atan2(-tx, -tz);
        const sink = this.alive ? 0 : Math.min(this.sinkT / 60, 1);
        const dmgFrac = 1 - Math.max(this.hp, 0) / this.maxHp;
        const y = -sink * (this.def.deckY + 25) - dmgFrac * 1.5;
        if (dt > 0) this.vel.set((x - this.mesh.position.x) / dt, (y - this.mesh.position.y) / dt, (z - this.mesh.position.z) / dt);
        this.mesh.position.set(x, y, z);
        this.mesh.rotation.set(0, this.heading, 0);
        this.listAngle = damp01(this.listAngle || 0, (1 - Math.max(this.hp, 0) / this.maxHp) * 0.05, dt);
        this.mesh.rotation.z = this.listAngle + sink * 0.28;
        if (!this.alive) this.mesh.rotation.x = -sink * 0.08;
        this.deckY = this.def.deckY + y;
        this.center.set(x, y + this.def.deckY * 0.55, z);
    }

    // local coordinates: lx across (starboard +), lz along (bow −)
    toLocal(x, z) {
        const dx = x - this.mesh.position.x, dz = z - this.mesh.position.z;
        const c = Math.cos(this.heading), s = Math.sin(this.heading);
        return { lx: dx * c - dz * s, lz: dx * s + dz * c };
    }
    toWorld(lx, ly, lz, out = new THREE.Vector3()) {
        return out.set(lx, ly, lz).applyEuler(this.mesh.rotation).add(this.mesh.position);
    }

    onDeck(x, z, margin = 0) {
        const { lx, lz } = this.toLocal(x, z);
        const B = this.type === 'carrier' ? this.def.B : this.def.B * 0.8;
        const off = this.type === 'carrier' ? -4 : 0;
        return Math.abs(lx - off) < B / 2 - margin && Math.abs(lz) < this.def.L / 2 - margin;
    }
    inWireZone(x, z) {
        const { lz } = this.toLocal(x, z);
        return this.type === 'carrier' && lz > -this.def.L * 0.02 && lz < this.def.L * 0.48;
    }
    catapultSpot() { return this.toWorld(12, this.deckY, -this.def.L * 0.02); }

    hitTest(p) {
        const { lx, lz } = this.toLocal(p.x, p.z);
        const y = p.y - this.mesh.position.y;
        const top = this.def.deckY + (Math.abs(lx - (this.def.B * 0.5 - 12)) < 8 && Math.abs(lz - this.def.L * 0.08) < 20 ? 30 : 2);
        return Math.abs(lx) < this.def.B / 2 && Math.abs(lz) < this.def.L / 2 && y > -6 && y < top;
    }

    damage(amount, source, kind) {
        if (!this.alive) return;
        const mult = kind === 'missile' ? 2.5 : kind === 'rocket' ? 1.8 : 1;
        this.hp -= amount * mult;
        this.health = this.hp;
        this.lastHitBy = source;
        const dmgFrac = 1 - Math.max(this.hp, 0) / this.maxHp;
        // fires spread as damage accumulates: one small blaze at first, a burning wreck near the end
        this.fires = this.fires || [];
        const wantFires = Math.ceil(dmgFrac * 9);
        while (this.fires.length < wantFires) {
            this.fires.push({
                p: new THREE.Vector3(rand(-this.def.B * 0.35, this.def.B * 0.35), this.def.deckY + 1, rand(-this.def.L * 0.42, this.def.L * 0.42)),
                size: 0.5 + Math.random() * 0.5, grow: 0,
            });
        }
        // secondary explosions (ammo, fuel) at 75 / 50 / 25 %
        this.stage = this.stage || 0;
        const stageNow = dmgFrac >= 0.75 ? 3 : dmgFrac >= 0.5 ? 2 : dmgFrac >= 0.25 ? 1 : 0;
        while (this.stage < stageNow && this.hp > 0) {
            this.stage++;
            const at = this.toWorld(rand(-this.def.B * 0.3, this.def.B * 0.3), this.def.deckY + 2, rand(-this.def.L * 0.4, this.def.L * 0.4));
            this.game.effects.explosion(at, 1.6 + this.stage * 0.5);
            this.game.effects.debrisBurst(at, _v.set(0, 50, 0), 6, 1.2);
            this.game.audio.boom(this.game.camera.position.distanceTo(at), 1.3);
            this.game.events.emit('shipSecondary', this, { stage: this.stage });
        }
        if (this.hp <= 0) this.destroy(source);
    }

    destroy(source) {
        this.alive = false;
        this.hp = this.health = 0;
        this.fires = this.fires || [];
        while (this.fires.length < 12) this.fires.push({ p: new THREE.Vector3(rand(-this.def.B * 0.35, this.def.B * 0.35), this.def.deckY + 1, rand(-this.def.L * 0.45, this.def.L * 0.45)), size: 1, grow: 0.5 });
        const fx = this.game.effects;
        for (let i = 0; i < 6; i++) {
            setTimeout(() => {
                const p = this.toWorld(rand(-15, 15), this.def.deckY, rand(-this.def.L * 0.4, this.def.L * 0.4));
                fx.explosion(p, 2.5 + Math.random() * 1.5);
                this.game.audio.boom(this.game.camera.position.distanceTo(p), 1.5);
            }, i * 350);
        }
        this.game.events.emit('groundKilled', this, { source });
    }

    update(dt) {
        const g = this.game, fx = g.effects;
        if (!this.alive) this.sinkT += dt;
        this.place(dt);
        if (this.parts.radar) this.parts.radar.rotation.y += dt * 1.6;
        if (!this.alive && this.sinkT > 70) { this.remove(); return 'gone'; }
        // wake & bow spray
        this.wakeT -= dt;
        if (this.wakeT <= 0 && this.alive) {
            this.wakeT = 0.12;
            const stern = this.toWorld(rand(-6, 6), 0.5, this.def.L * 0.5);
            fx.smoke.emit(stern, _v.set(rand(-2, 2), 1, rand(-2, 2)), 6, 6, 26, [0.95, 0.97, 1], [0.9, 0.93, 0.96], 0.5, 0, 0.4, 0);
            const bow = this.toWorld(rand(-3, 3), 1, -this.def.L * 0.5);
            fx.smoke.emit(bow, _v.set(rand(-5, 5), 3, 0), 1.5, 3, 9, [1, 1, 1], [0.95, 0.95, 1], 0.5, 0, 1, -3);
        }
        // fires from battle damage
        if (this.fires) {
            const dmgFrac = this.alive ? 1 - this.hp / this.maxHp : 1;
            for (const f of this.fires) {
                f.grow = Math.min(1, f.grow + dt * 0.15); // each blaze builds up over a few seconds
                const k = f.size * (0.35 + f.grow * 0.65) * (0.6 + dmgFrac * 0.8);
                if (Math.random() < 0.2 + dmgFrac * 0.5) {
                    const p = this.toWorld(f.p.x, f.p.y, f.p.z);
                    const dark = dmgFrac > 0.5 ? 0.05 : 0.18;
                    fx.smoke.emit(p, _v.set(rand(-2, 2), rand(8, 16), rand(-2, 2)), rand(5, 10) * (0.6 + k), 6 * k + 3, 40 * k + 12, [dark, dark, dark], [0.28, 0.27, 0.26], 0.75, 0, 0.1, 5);
                    fx.puffFire(p, _v.set(rand(-2, 2), 8 + k * 6, rand(-2, 2)), 4 + 6 * k, 0.4 + k * 0.3);
                }
            }
        }
        if (!this.alive || this.passive) return;
        this.updateDefenses(dt);
    }

    updateDefenses(dt) {
        const g = this.game;
        const diff = g.difficulty;
        for (const m of this.mounts) {
            const mp = this.toWorld(m.turret.position.x, m.turret.position.y + 2, m.turret.position.z, new THREE.Vector3());
            m.fireT -= dt;
            if (m.type === 'ciws') {
                // priority: incoming missiles aimed at our group
                let tgt = null, best = 1600 * 1600;
                for (const ms of g.weapons.missiles) {
                    if (ms.team === this.team || ms.kind === 'rkt') continue;
                    const d = ms.pos.distanceToSquared(mp);
                    const aimedAtUs = ms.target && ms.target.isShip && ms.target.team === this.team;
                    if (d < best && aimedAtUs) { best = d; tgt = ms; }
                }
                let isMissile = !!tgt;
                if (!tgt) tgt = this.nearestEnemyAircraft(mp, 2200);
                if (!tgt) continue;
                const dir = _v.subVectors(tgt.pos, mp);
                const dist = dir.length();
                dir.normalize();
                m.turret.rotation.y = Math.atan2(-dir.x, -dir.z) - this.heading;
                if (m.fireT <= 0) {
                    m.fireT = 0.05;
                    // lead the target
                    const tt = dist / 1100;
                    const aim = _v2.copy(tgt.pos).addScaledVector(tgt.vel, tt).sub(mp).normalize();
                    aim.x += rand(-0.012, 0.012); aim.y += rand(-0.012, 0.012); aim.z += rand(-0.012, 0.012);
                    g.weapons.fireFlak(mp, aim.normalize(), this, isMissile ? 0 : 3 + diff.skill * 3, 1100, Infinity);
                    if (isMissile && Math.random() < (this.team === 'red' ? 0.028 : 0.05)) {
                        // CIWS kill
                        g.effects.explosion(tgt.pos, 0.6);
                        g.events.emit('ciwsKill', this, { missile: tgt });
                        const idx = g.weapons.missiles.indexOf(tgt);
                        if (idx >= 0) g.weapons.removeMissile(idx);
                    }
                }
            } else if (m.type === 'gun') {
                const tgt = this.nearestEnemyAircraft(mp, 3500);
                if (!tgt) continue;
                const rel = _v.subVectors(tgt.pos, mp);
                const tt = interceptTime(rel.x, rel.y, rel.z, tgt.vel.x, tgt.vel.y, tgt.vel.z, 900);
                if (tt <= 0) continue;
                const aim = _v2.copy(tgt.pos).addScaledVector(tgt.vel, tt).sub(mp).normalize();
                m.turret.rotation.y = Math.atan2(-aim.x, -aim.z) - this.heading;
                if (m.fireT <= 0) {
                    m.fireT = lerp(1.6, 0.9, diff.skill);
                    aim.x += rand(-0.03, 0.03); aim.y += rand(-0.02, 0.03); aim.z += rand(-0.03, 0.03);
                    g.weapons.fireFlak(mp, aim.normalize(), this, 10, 900, tt * rand(0.85, 1.1));
                    g.effects.fire.emit(mp, _v.set(0, 0, 0), 0.1, 6, 3, [6, 4, 2], [2, 1, 0.3], 1, 0, 0, 0);
                }
            } else if (m.type === 'sam' && this.ammo.sam > 0) {
                const tgt = this.nearestEnemyAircraft(mp, WEAPONS.sam.range);
                if (!tgt || tgt.pos.distanceTo(mp) < 700) { m.lockT = Math.max(0, m.lockT - dt); continue; }
                m.lockT += dt;
                tgt.lockedBy = tgt.lockedBy || new Set();
                tgt.lockedBy.add(this);
                if (m.lockT > 3 && m.fireT <= 0 && tgt.incoming.length < 2) {
                    this.launchDir = _v.set(0, 1, 0).clone();
                    const launcher = { pos: mp.clone(), vel: this.vel.clone(), team: this.team, isGround: true, alive: true, launchDir: this.launchDir, name: this.name };
                    g.weapons.fireMissile(launcher, tgt, 'sam');
                    this.ammo.sam--;
                    m.fireT = lerp(18, 10, diff.skill);
                    m.lockT = 1;
                }
            }
        }
    }

    nearestEnemyAircraft(p, range) {
        let best = null, bd = range * range;
        for (const a of this.game.aircraft) {
            if (!a.alive || a.team === this.team || a.onGround) continue;
            const d = a.pos.distanceToSquared(p);
            if (d < bd) { bd = d; best = a; }
        }
        return best;
    }

    remove() {
        this.game.scene.remove(this.mesh);
        this.gone = true;
    }
}

export class Naval {
    constructor(game) {
        this.game = game;
        this.ships = [];
        this.homeCarrier = null;
        this._surf = { h: 0, ship: null, water: false, runway: null, hull: false };
    }

    spawnHomeCarrier() {
        const spot = findOcean(0, 0, 5000, 14000, 2600) || { x: -9000, z: 6000 };
        const s = new Ship(this, 'carrier', 'blue', spot, 2600, Math.random() * Math.PI * 2, 1, 'CVN-73');
        this.ships.push(s);
        this.game.ground.targets.push(s);
        this.homeCarrier = s;
        return s;
    }

    spawnEnemyGroup(passive = false) {
        const spot = (passive ? findOcean(0, 0, 7000, 16000, 2600) : null) || findOcean(0, 0, 20000, 32000, 3000) || findOcean(0, 0, 12000, 40000, 2200) || { x: 22000, z: 10000 };
        const a0 = Math.random() * Math.PI * 2;
        const carrier = new Ship(this, 'carrier', 'red', spot, 3000, a0, -1, 'ENEMY CARRIER');
        const d1 = new Ship(this, 'destroyer', 'red', spot, 3350, a0 + 0.09, -1, 'DESTROYER');
        const d2 = new Ship(this, 'destroyer', 'red', spot, 2650, a0 - 0.1, -1, 'DESTROYER');
        // keep escorts in formation: same angular speed as the carrier
        d1.orbit.w = d2.orbit.w = carrier.orbit.w;
        for (const s of [carrier, d1, d2]) { s.passive = passive; this.ships.push(s); this.game.ground.targets.push(s); }
        this.enemyCarrier = carrier;
        return carrier;
    }

    // Deck / hull query used by aircraft ground contact
    deckAt(x, z, y) {
        for (const s of this.ships) {
            if (s.gone) continue;
            if (!s.onDeck(x, z)) continue;
            if (y < -10) continue;
            const r = this._surf;
            r.h = s.deckY; r.ship = s.type === 'carrier' && s.alive ? s : null; r.water = false; r.runway = null;
            r.hull = y < s.deckY - 4 || s.type !== 'carrier' || !s.alive;
            if (r.hull) r.ship = null;
            return r;
        }
        return null;
    }

    update(dt) {
        for (let i = this.ships.length - 1; i >= 0; i--) {
            const s = this.ships[i];
            if (s.update(dt) === 'gone') {
                this.ships.splice(i, 1);
                const k = this.game.ground.targets.indexOf(s);
                if (k >= 0) this.game.ground.targets.splice(k, 1);
            }
        }
    }

    clear() {
        this.ships.forEach(s => s.remove());
        this.ships = [];
        this.homeCarrier = this.enemyCarrier = null;
    }
}
