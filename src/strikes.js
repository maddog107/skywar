// ═══════════════════════════════════════════════════════════════
// Strategic strikes (docs/WAR.md): mark a target, transmit it, request a strike — and a missile really
// launches from somewhere else in the world, flies there and hits it.
//  • launch sources: ship VLS (the cell opens, the missile climbs out vertically, pitches over), a silo
//    complex, ground launchers (TELs, rocket artillery), submarines (a missile breaks the surface); plug-ins
//    add their own with addSource()
//  • strategic missiles: cruise (booster, then terrain-following at ~60 m, pop-up and dive), anti-ship
//    (sea-skimming), ballistic (boost, pitch-over, a real ballistic arc, glowing re-entry), penetrator
//    (hardened targets), rocket artillery (ripple salvos on ballistic arcs)
//  • impact: blast, crater, damage by warhead against how hardened the target is; the result is only known
//    once someone sees it (BDA)
//  • missile camera: follow / chase / side / target / impact views, V cycles, K leaves
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, BASES } from './world.js';
import { INTEL } from './war.js';
import { Ship } from './naval.js';
import { clamp, damp, lerp, rand, G } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, -1);

// ── Missiles (game-scale: flight times of a minute or three across the theatre) ──
//   speed m/s (cruise), warhead: damage at the aim point, blast: radius (m) of full effect, hard: how well it
//   defeats hardened targets (0..1), len/dia: size (m)
export const MISSILES = {
    tlam: { kind: 'cruise', name: 'TOMAHAWK', short: 'TLAM', speed: 245, alt: 55, seaAlt: 18, boost: 9, warhead: 480, blast: 34, hard: 0.35, len: 6.25, dia: 0.52, span: 2.67, color: 0x7a7f84, nose: 0x2a2c2e },
    kalibr: { kind: 'cruise', name: 'KALIBR', short: 'KALIBR', speed: 250, alt: 45, seaAlt: 15, boost: 9, warhead: 450, blast: 32, hard: 0.35, len: 6.2, dia: 0.53, span: 3.1, color: 0x9aa39a, nose: 0x3a3d3a },
    harpoon: { kind: 'antiship', name: 'HARPOON', short: 'HARPOON', speed: 240, alt: 7, seaAlt: 7, boost: 3, warhead: 300, blast: 18, hard: 0.3, len: 4.6, dia: 0.34, span: 0.9, color: 0xd6d6d0, nose: 0x5a5a56 },
    atacms: { kind: 'ballistic', name: 'ATACMS', short: 'ATACMS', boost: 7, warhead: 420, blast: 40, hard: 0.5, len: 4.0, dia: 0.61, color: 0xe6e6e0, nose: 0x3a3a3a },
    penetrator: { kind: 'ballistic', name: 'ATACMS (HARDENED)', short: 'PENETRATOR', boost: 7, warhead: 520, blast: 18, hard: 1, len: 4.0, dia: 0.61, color: 0xcfcfc6, nose: 0x1f1f1f, dive: true },
    scud: { kind: 'ballistic', name: 'SCUD-B', short: 'SCUD', boost: 11, warhead: 700, blast: 55, hard: 0.5, len: 11.2, dia: 0.88, color: 0x55603f, nose: 0x3c4230 },
    gmlrs: { kind: 'rocket', name: 'GMLRS', short: 'GMLRS', count: 6, warhead: 150, blast: 20, hard: 0.2, len: 3.9, dia: 0.227, color: 0x6b6f5a, nose: 0x2e2f2a, spread: 45 },
    grad: { kind: 'rocket', name: '9M22 GRAD', short: 'GRAD', count: 20, warhead: 45, blast: 13, hard: 0.1, len: 2.87, dia: 0.122, color: 0x4d5a3c, nose: 0x2c3024, spread: 110 },
};

// ── Strike types (the command menu) ──
//   use: missile per team; sources: launcher kinds that can fly it; per: missiles per aim point
export const STRIKE_TYPES = {
    cruise: { label: 'CRUISE MISSILE STRIKE', use: { blue: 'tlam', red: 'kalibr' }, sources: ['ship', 'sub', 'silo', 'launcher'], per: 1 },
    naval: { label: 'NAVAL STRIKE', use: { blue: 'tlam', red: 'kalibr' }, sources: ['ship', 'sub'], per: 2 },
    hardened: { label: 'HARDENED TARGET STRIKE', use: { blue: 'penetrator', red: 'scud' }, sources: ['silo', 'launcher'], per: 2 },
    ballistic: { label: 'BALLISTIC MISSILE STRIKE', use: { blue: 'atacms', red: 'scud' }, sources: ['silo', 'launcher'], per: 1 },
    rocket: { label: 'ROCKET ARTILLERY STRIKE', use: { blue: 'gmlrs', red: 'grad' }, sources: ['artillery'], per: 1 },
    antiship: { label: 'ANTI-SHIP STRIKE', use: { blue: 'harpoon', red: 'kalibr' }, sources: ['ship', 'battery'], per: 2 },
    runway: { label: 'RUNWAY ATTACK', use: { blue: 'tlam', red: 'kalibr' }, sources: ['ship', 'sub', 'silo', 'launcher'], per: 1, pattern: 'runway' },
    multi: { label: 'MULTIPLE TARGET STRIKE', use: { blue: 'tlam', red: 'kalibr' }, sources: ['ship', 'sub', 'silo', 'launcher'], per: 1, all: true },
    air: { label: 'AIR STRIKE', aircraft: true },
};
const ORDER = ['cruise', 'naval', 'hardened', 'ballistic', 'rocket', 'antiship', 'runway', 'multi', 'air'];
const CAM_MODES = ['chase', 'follow', 'side', 'target', 'impact'];
// terrain-following lookahead (m): dense close in (a sharp ridge mustn't slip between samples), then further out
const LOOKAHEAD = [150, 300, 450, 600, 800, 1000, 1200, 1600, 2200, 3000, 4000];
const CAM_LABEL = { chase: 'REAR CHASE', follow: 'FOLLOW', side: 'SIDE TRACKING', target: 'TARGET VIEW', impact: 'IMPACT CAMERA' };

// ═════════════ Meshes ═════════════
const geoCache = new Map(), matCache = new Map();
function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...opts }));
    return matCache.get(key);
}
// A missile (nose toward −Z): body, ogive nose, tail fins; cruise missiles add pop-out wings (child 'wings'),
// and anything with a booster gets one on the tail (child 'booster', it drops off)
function missileMesh(spec) {
    const key = spec.short;
    if (!geoCache.has(key)) {
        const L = spec.len, R = spec.dia / 2;
        const noseL = spec.kind === 'cruise' || spec.kind === 'antiship' ? R * 2.2 : R * 3.2;
        const pts = [];
        const n = 10;
        for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector2(R * Math.sqrt(1 - (1 - t) * (1 - t)) + 1e-3, -L / 2 + noseL * (1 - t) - 0 * t)); }
        pts.reverse();
        // lathe profile from the tail (y = +L/2) to the tip (y = −L/2), then rotated to lie along −Z
        const prof = [new THREE.Vector2(0.001, L / 2), new THREE.Vector2(R * 0.92, L / 2), new THREE.Vector2(R, L / 2 - R * 0.3), new THREE.Vector2(R, -L / 2 + noseL)];
        for (let i = n - 1; i >= 0; i--) { const t = i / n; prof.push(new THREE.Vector2(Math.max(R * Math.sqrt(1 - (1 - t) * (1 - t)), 0.001), -L / 2 + noseL * (1 - t))); }
        const body = new THREE.LatheGeometry(prof.reverse(), 14);
        body.rotateX(-Math.PI / 2);
        const fins = [];
        const fs = spec.kind === 'rocket' ? R * 2.2 : R * 1.6, fc = spec.kind === 'ballistic' ? R * 3.5 : R * 1.6;
        for (let k = 0; k < 4; k++) {
            const f = new THREE.BoxGeometry(0.02 + R * 0.06, fs, fc);
            f.translate(0, R + fs / 2, L / 2 - fc / 2 - R * 0.1);
            f.rotateZ(k * Math.PI / 2 + (spec.kind === 'cruise' ? Math.PI / 4 : 0));
            fins.push(f);
        }
        geoCache.set(key, { body: mergeGeometries([body, ...fins]), band: new THREE.CylinderGeometry(R * 1.01, R * 1.01, noseL * 0.5, 14).rotateX(Math.PI / 2).translate(0, 0, -L / 2 + noseL * 0.75) });
        if (spec.kind === 'cruise' || spec.kind === 'antiship') {
            const w = new THREE.BoxGeometry(spec.span, 0.03, R * 1.1);
            w.translate(0, -R * 0.2, -L * 0.02);
            geoCache.get(key).wings = w;
        }
        if (spec.boost && spec.kind !== 'rocket') {
            const bl = spec.kind === 'ballistic' ? 0 : Math.max(0.7, L * 0.2);
            if (bl) geoCache.get(key).booster = new THREE.CylinderGeometry(R, R * 1.02, bl, 12).rotateX(Math.PI / 2).translate(0, 0, L / 2 + bl / 2);
        }
    }
    const g = geoCache.get(key);
    const root = new THREE.Group();
    const body = new THREE.Mesh(g.body, mat(spec.color));
    body.castShadow = true;
    root.add(body, new THREE.Mesh(g.band, mat(spec.nose)));
    if (g.wings) { const w = new THREE.Mesh(g.wings, mat(spec.color)); w.name = 'wings'; w.scale.set(0.05, 1, 1); root.add(w); }
    if (g.booster) { const b = new THREE.Mesh(g.booster, mat(0x1c1c1c, { roughness: 0.8 })); b.name = 'booster'; root.add(b); }
    return root;
}

// ═════════════ Launch sources ═════════════
// A source keeps a stock of missiles and runs its launch sequences. kind: 'ship' | 'sub' | 'silo' | 'launcher'
// | 'artillery' | 'battery'. Subclasses give the geometry of the launch (where the missile starts, which way).
export class LaunchSource {
    constructor(mgr, { name, team, kind, stock, host = null, range = 120000 }) {
        this.mgr = mgr; this.game = mgr.game;
        this.id = mgr.nextSourceId++;
        this.name = name; this.team = team; this.kind = kind;
        this.stock = { ...stock };
        this.host = host;
        this.range = range;
        this.queue = [];      // { spec, aim, strike, t }
        this.cool = 0;
        this.fired = 0;
    }
    get alive() { return this.host ? this.host.alive !== false : true; }
    get pos() { return this.host ? this.host.pos : this.at; }
    canFire(specKey) { return this.alive && (this.stock[specKey] || 0) > 0; }
    // queue n launches of a missile at an aim; spacing: seconds between them
    fire(specKey, n, aim, strike, spacing = 2.5) {
        const k = Math.min(n, this.stock[specKey] || 0);
        for (let i = 0; i < k; i++) this.queue.push({ specKey, aim, strike, t: this.prepTime(specKey) + i * spacing });
        this.stock[specKey] -= k;
        return k;
    }
    prepTime() { return 3; }
    update(dt) {
        if (!this.alive) { this.queue.length = 0; return; }
        for (let i = this.queue.length - 1; i >= 0; i--) {
            const q = this.queue[i];
            q.t -= dt;
            if (q.t <= 0) { this.queue.splice(i, 1); this.launch(q); }
        }
    }
    // start point and direction of a launch (world)
    launchFrame(out, dir) { out.copy(this.pos); dir.set(0, 1, 0); }
    launch(q) {
        const spec = MISSILES[q.specKey];
        const p = new THREE.Vector3(), d = new THREE.Vector3();
        this.launchFrame(p, d, q);
        const m = this.mgr.spawnMissile(spec, this.team, p, d, q.aim, this, q.strike);
        this.fired++;
        if (this.host) this.host.firingT = this.mgr.game.war.time; // a launch gives the position away
        this.launchEffects(p, d, spec);
        return m;
    }
    launchEffects(p, d, spec) {
        const fx = this.game.effects;
        const big = spec.kind === 'ballistic' ? 1.6 : spec.kind === 'rocket' ? 0.45 : 1;
        fx.light(p, 90 * big, 0.9);
        fx.sprite(fx.flashTex, p, 14 * big, 0.25, 6, 0.8, [1, 0.85, 0.6]);
        // the ground cloud: exhaust blasting down and out, billowing and slowly rising
        const n = Math.round(26 * big);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = _v.set(Math.cos(a), rand(-0.05, 0.35), Math.sin(a)).multiplyScalar(rand(6, 22) * big).addScaledVector(d, -rand(2, 6));
            const c = rand(0.72, 0.86);
            fx.smoke.emit(p, v, rand(5, 11), rand(4, 8) * big, rand(22, 40) * big, [c, c, c * 0.98], [c * 0.8, c * 0.8, c * 0.78], 0.62, 0, 1.2, 0.5, 0, 0.5, 0.5);
        }
        for (let i = 0; i < 6 * big; i++) fx.fire.emit(p, _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(12), rand(0.2, 0.45), 5 * big, 12 * big, [5, 3.4, 1.4], [2.4, 0.8, 0.1], 0.8, 0, 2, 0);
        this.mgr.audioLaunch(p, spec);
    }
}

// Mk 41 VLS on a destroyer / cruiser: the missile rises out of a deck cell forward or aft, vertically
export class ShipVLS extends LaunchSource {
    constructor(mgr, ship, opts) {
        super(mgr, { kind: 'ship', host: ship, name: ship.name, team: ship.team, stock: opts.stock || { tlam: 8, harpoon: 4 }, range: 400000 });
        this.cells = opts.cells || [{ lx: 0, lz: -ship.def.L * 0.3 }, { lx: 0, lz: ship.def.L * 0.27 }];
        this.cellIx = 0;
        this.cellOpen = null; // rig hook: (i, k) opens cell i (naval plug-ins set it)
    }
    prepTime() { return 4; }
    launchFrame(out, dir) {
        const s = this.host, c = this.cells[this.cellIx++ % this.cells.length];
        s.toWorld(c.lx + rand(-1, 1), s.def.deckY + 1, c.lz + rand(-2, 2), out);
        dir.set(0, 1, 0);
        if (this.cellOpen) this.cellOpen(c, 1);
    }
}

// A missile field: concrete pads with sliding hatches; the missile is pushed out cold, then lights
export class SiloSite extends LaunchSource {
    constructor(mgr, at, opts = {}) {
        super(mgr, { kind: 'silo', name: opts.name || 'MISSILE FIELD', team: opts.team || 'blue', stock: opts.stock || { tlam: 6, atacms: 4, penetrator: 4 }, range: 400000 });
        this.at = new THREE.Vector3(at.x, terrainHeight(at.x, at.z), at.z);
        this.silos = [];
        this.buildMesh(opts.count || 4);
        this.alive_ = true;
    }
    get alive() { return this.alive_; }
    buildMesh(n) {
        const g = new THREE.Group();
        const conc = mat(0x8a8a82, { roughness: 0.95, metalness: 0 }), dark = mat(0x1d1f22, { roughness: 0.8 }), steel = mat(0x5d6166, { metalness: 0.6, roughness: 0.4 });
        const pad = new THREE.Mesh(new THREE.BoxGeometry(22 * n, 0.8, 30), conc);
        pad.position.y = 0.2; pad.receiveShadow = true; g.add(pad);
        for (let i = 0; i < n; i++) {
            const x = (i - (n - 1) / 2) * 22;
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 1.2, 20), conc);
            ring.position.set(x, 0.8, 0); g.add(ring);
            const hole = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.2, 20), dark);
            hole.position.set(x, 1.35, 0); g.add(hole);
            const lid = new THREE.Group();
            const lm = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.9, 6.4), steel); lm.castShadow = true; lid.add(lm);
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 13), dark); rail.position.set(-3.4, -0.2, 3.2); lid.add(rail.clone()); rail.position.x = 3.4; lid.add(rail);
            lid.position.set(x, 1.85, 0);
            g.add(lid);
            // antenna / sensor mast and a hardened launch control shelter at one end
            this.silos.push({ x, lid, open: 0, want: 0 });
        }
        const shelter = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 10), conc);
        shelter.position.set(-(11 * n + 12), 2.5, 0); shelter.castShadow = true; g.add(shelter);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 14, 6), steel);
        mast.position.set(-(11 * n + 12), 12, 3); g.add(mast);
        g.position.copy(this.at);
        g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
        this.game.war.addClearing(this.at.x, this.at.z, 11 * n + 40);
        this.mesh = g;
        this.game.scene.add(g);
        this.pos_ = new THREE.Vector3(this.at.x, this.at.y + 3, this.at.z);
    }
    get pos() { return this.pos_; }
    prepTime() { return 5; }
    fire(specKey, n, aim, strike) {
        const k = super.fire(specKey, n, aim, strike, 3);
        return k;
    }
    update(dt) {
        // hatches slide open before a launch and close after
        for (const s of this.silos) {
            s.open = damp(s.open, s.want, 1.6, dt);
            s.lid.position.z = s.open * 7.5;
            if (s.want && s.closeT != null) { s.closeT -= dt; if (s.closeT <= 0) { s.want = 0; s.closeT = null; } }
        }
        for (const q of this.queue) if (q.t < 3 && q.silo == null) { q.silo = this.freeSilo(); if (q.silo) q.silo.want = 1; }
        super.update(dt);
    }
    freeSilo() { return this.silos.find(s => !s.want) || this.silos[0]; }
    launchFrame(out, dir, q) {
        const s = q && q.silo ? q.silo : this.silos[0];
        out.set(this.at.x + s.x, this.at.y + 3, this.at.z);
        s.closeT = 5;
        dir.set(0, 1, 0);
    }
    remove() { this.game.scene.remove(this.mesh); }
}

// A ground launcher: a TEL or rocket artillery vehicle. The vehicle and its motion are someone else's (a mobile-
// forces plug-in passes the vehicle as host with an optional rig); this fires from its launcher, tilted `elev`.
export class GroundLauncher extends LaunchSource {
    constructor(mgr, host, opts) {
        super(mgr, { kind: opts.kind || 'launcher', host, name: opts.name || host.name, team: host.team, stock: opts.stock, range: opts.range || 300000 });
        this.elev = opts.elev ?? (opts.kind === 'artillery' ? 1.05 : 1.45); // rad above the horizon (rockets: high-angle, ~60°)
        this.muzzle = opts.muzzle || new THREE.Vector3(0, 3, 2);
        this.prepare = opts.prepare || null; // (k) → true when ready (erect the launcher first); a plug-in hook
    }
    prepTime(specKey) { return MISSILES[specKey].kind === 'rocket' ? 6 : 12; }
    launchFrame(out, dir, q) {
        const h = this.host, m = h.mesh || h.object;
        if (m) { m.updateMatrixWorld(); out.copy(this.muzzle).applyMatrix4(m.matrixWorld); } else out.copy(h.pos).y += 3;
        // point at the aim, elevated
        const aim = q && q.aim ? q.aim.pos : _v3.copy(out).add(FWD);
        const az = Math.atan2(aim.x - out.x, aim.z - out.z);
        dir.set(Math.sin(az) * Math.cos(this.elev), Math.sin(this.elev), Math.cos(az) * Math.cos(this.elev));
    }
    fire(specKey, n, aim, strike) {
        const spec = MISSILES[specKey];
        // a rocket salvo is one "missile" in the stock but fires its whole ripple
        if (spec.kind === 'rocket') {
            if ((this.stock[specKey] || 0) <= 0) return 0;
            this.stock[specKey]--;
            const t0 = this.prepTime(specKey);
            for (let i = 0; i < spec.count; i++) this.queue.push({ specKey, aim, strike, t: t0 + i * (spec.count > 10 ? 0.5 : 1.1), salvo: i });
            return 1;
        }
        return super.fire(specKey, n, aim, strike, 6);
    }
}

// A submarine: the missile comes out of the water in a capsule and lights just above the surface
export class SubLauncher extends LaunchSource {
    constructor(mgr, sub, opts = {}) {
        super(mgr, { kind: 'sub', host: sub, name: sub.name, team: sub.team, stock: opts.stock || { tlam: 12 }, range: 400000 });
        this.tubes = opts.tubes || [{ lx: 0, lz: -30 }];
        this.ix = 0;
    }
    prepTime() { return 6; }
    launchFrame(out, dir) {
        const s = this.host, t = this.tubes[this.ix++ % this.tubes.length];
        if (s.toWorld) s.toWorld(t.lx, 0, t.lz, out); else out.copy(s.pos);
        out.y = -4; // (under the surface: the missile broaches)
        dir.set(0, 1, 0);
    }
    launchEffects(p, d, spec) {
        const fx = this.game.effects;
        fx.waterSplash(_v.copy(p).setY(0.5), 1.6);
        this.mgr.audioLaunch(p, spec);
    }
}

// ═════════════ Strategic missiles ═════════════
class StrategicMissile {
    constructor(mgr, spec, team, pos, dir, aim, source, strike) {
        this.mgr = mgr; this.game = mgr.game;
        this.spec = spec; this.kind = spec.kind; this.team = team;
        this.source = source; this.strike = strike;
        this.aim = aim; // { pos, unit } — pos is live when a unit
        this.mesh = missileMesh(spec);
        this.pos = this.mesh.position.copy(pos);
        this.vel = new THREE.Vector3().copy(dir).multiplyScalar(spec.kind === 'rocket' ? 0 : spec.kind === 'ballistic' ? 25 : 30);
        if (source && source.host && source.host.vel) this.vel.add(source.host.vel);
        this.age = 0;
        this.alive = true;
        this.phase = 'boost';
        this.hp = 20;
        this.isStrategic = true;
        this.name = spec.short;
        this.radius = this.hitRadius = 3;
        this.incoming = [];
        this.wings = this.mesh.getObjectByName('wings');
        this.booster = this.mesh.getObjectByName('booster');
        const fx = this.game.effects;
        this.trail = fx.addTrail({ max: 400, width: spec.kind === 'rocket' ? 1.2 : spec.kind === 'ballistic' ? spec.dia * 8 : spec.dia * 4.5, life: spec.kind === 'ballistic' ? 22 : 10, color: [0.95, 0.95, 0.93], alpha: spec.kind === 'ballistic' ? 0.7 : 0.55, minDist: 6, widthGrow: spec.kind === 'ballistic' ? 6 : 4 });
        this.game.scene.add(this.mesh);
        if (spec.kind === 'rocket') this.initRocket(dir);
        this.orient();
        this.eta = mgr.estimate(spec, pos, this.aim.pos);
        this.t0 = this.game.time;
        // our ballistic missile on a marked unit: its aim point is updated in flight from the track (a datalink, like
        // PrSM's retargeting), so a TEL on the move can still be hit (forces.js). The enemy's go where they were aimed.
        this.tracked = spec.kind === 'ballistic' && !!(aim && aim.unit) && !!strike && team === (this.game.war && this.game.war.side);
    }

    get targetPos() { const u = this.aim.unit; return u && u.alive !== false && u.pos ? u.pos : this.aim.pos; }

    // Rockets: an unguided ballistic arc from the launcher's elevation, solved for this aim (+ salvo spread)
    initRocket(dir) {
        const s = this.spec, T = _v.copy(this.aim.pos);
        T.x += rand(-1, 1) * s.spread; T.z += rand(-1, 1) * s.spread;
        const dx = T.x - this.pos.x, dz = T.z - this.pos.z, x = Math.hypot(dx, dz), dy = T.y - this.pos.y;
        let th = Math.asin(clamp(dir.y, -1, 1));
        th = clamp(th, 0.5, 1.2);
        const den = 2 * Math.cos(th) ** 2 * (x * Math.tan(th) - dy);
        const v = den > 0 ? Math.sqrt(G * x * x / den) : 400;
        this.vel.set(dx / x * Math.cos(th) * v, Math.sin(th) * v, dz / x * Math.cos(th) * v);
        this.motorT = 1.6;
    }

    // Ballistic: the velocity that reaches the target from here in `tau` seconds under gravity
    ballisticVel(out, tau) {
        const T = this.targetPos;
        return out.set((T.x - this.pos.x) / tau, (T.y - this.pos.y) / tau + 0.5 * G * tau, (T.z - this.pos.z) / tau);
    }

    orient() {
        if (this.vel.lengthSq() > 1) this.mesh.quaternion.setFromUnitVectors(FWD, _v2.copy(this.vel).normalize());
    }

    update(dt) {
        if (!this.alive) return;
        this.age += dt;
        const s = this.spec, fx = this.game.effects;
        switch (this.kind) {
            case 'cruise': case 'antiship': this.flyCruise(dt); break;
            case 'ballistic': this.flyBallistic(dt); break;
            case 'rocket': this.flyRocket(dt); break;
        }
        this.pos.addScaledVector(this.vel, dt);
        this.orient();
        // exhaust
        const burning = this.phase === 'boost' || (this.kind === 'rocket' && this.motorT > 0);
        if (burning) {
            this.trail.push(this.pos, fx.now);
            const back = _v.copy(this.vel).normalize().multiplyScalar(-s.len * 0.55).add(this.pos);
            const big = this.kind === 'ballistic' ? 1.8 : this.kind === 'rocket' ? 0.8 : 1.2;
            fx.fire.emit(back, _v2.copy(this.vel).multiplyScalar(0.6), 0.07, 2.4 * big, 1.2 * big, [7, 5, 2.4], [3.5, 1.2, 0.2], 1, 0, 0, 0);
            if (Math.random() < 0.8) fx.smoke.emit(back, _v2.copy(this.vel).multiplyScalar(0.04), rand(2.5, 5), 2.2 * big, 10 * big, [0.9, 0.9, 0.88], [0.72, 0.72, 0.7], 0.45, 0, 1.2, 1);
            if (this.game.world.timeKey !== 'day' || this.kind === 'ballistic') fx.light(back, this.kind === 'ballistic' ? 55 : 30, 0.08);
        } else if (this.trail.emitting) this.trail.emitting = false;
        // ballistic re-entry: a glowing streak coming down fast
        if (this.kind === 'ballistic' && this.phase === 'fall' && this.vel.y < -250) {
            fx.fire.emit(this.pos, _v2.copy(this.vel).multiplyScalar(0.3), 0.12, 1.6, 0.6, [4, 2.6, 1.4], [2, 0.6, 0.1], 0.7, 0, 0, 0);
        }
        this.checkImpact();
    }

    flyCruise(dt) {
        const s = this.spec, T = this.targetPos;
        const dx = T.x - this.pos.x, dz = T.z - this.pos.z, hd = Math.hypot(dx, dz);
        const speed = this.vel.length();
        if (this.phase === 'boost') {
            // out of the cell vertically, climbing hard; the booster tips it over toward the target
            const climb = this.pos.y - (this.launchY ?? (this.launchY = this.pos.y));
            const want = climb < 90 ? _v.set(0, 1, 0) : _v.set(dx / hd, climb > 220 ? -0.05 : 0.12, dz / hd).normalize();
            const cur = _v2.copy(this.vel).normalize();
            cur.lerp(want, clamp(dt * (climb < 90 ? 6 : 1.4), 0, 1)).normalize();
            this.vel.copy(cur).multiplyScalar(Math.min(speed + 38 * dt, s.speed * 1.05));
            if (this.age > s.boost && climb > 60) {
                this.phase = 'cruise';
                if (this.booster) this.dropBooster();
            }
            return;
        }
        if (this.wings && this.wings.scale.x < 1) this.wings.scale.x = Math.min(1, this.wings.scale.x + dt * 2.5);
        // heading: turn toward the target at ~3 g
        const cur = Math.atan2(this.vel.x, this.vel.z), want = Math.atan2(dx, dz);
        let dh = want - cur;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        const maxTurn = (3 * G / Math.max(speed, 50)) * dt;
        const h = cur + clamp(dh, -maxTurn, maxTurn);
        // altitude: terrain-following — clear the ground here and climb early enough for what's coming in the next
        // ~4 km (a missile pitches up hard for a ridge), or skim the sea
        const land = s.kind !== 'antiship';
        const here = terrainHeight(this.pos.x, this.pos.z);
        let floor = here, climbNeed = -1e9;
        // (the sample points shift a little every frame, so over a few frames they sweep the gaps between them; and
        // what was seen is remembered, dropping slowly, so a sharp ridge between two samples isn't forgotten)
        const jit = (this.scanK = ((this.scanK || 0) + 1) % 3) * 50;
        for (const a0 of LOOKAHEAD) {
            const ahead = a0 + jit;
            const px = this.pos.x + Math.sin(h) * ahead, pz = this.pos.z + Math.cos(h) * ahead;
            const th = terrainHeight(px, pz);
            if (ahead <= 1300) floor = Math.max(floor, th);
            climbNeed = Math.max(climbNeed, (Math.max(th, 0) + s.alt - this.pos.y) / Math.max(ahead / s.speed, 1));
        }
        this.floorMem = Math.max(floor, (this.floorMem ?? floor) - 35 * dt);
        this.needMem = Math.max(climbNeed, (this.needMem ?? climbNeed) - 50 * dt);
        floor = this.floorMem; climbNeed = this.needMem;
        let alt = floor < 0 ? Math.max(floor, 0) + s.seaAlt : floor + s.alt;
        const targetOnShip = !!(this.aim.unit && this.aim.unit.isShip);
        const seaTarget = targetOnShip || s.kind === 'antiship';
        // terminal: the seeker takes over and the missile pulls hard (anti-ship missiles weave and home at up to
        // ~15 g; land-attack ones pop up and dive onto the target)
        if (hd < 2600 || this.phase === 'terminal') {
            this.phase = 'terminal';
            const aim = _v.copy(T);
            if (seaTarget) {
                aim.y = Math.max(T.y, 2) + 1;
                // a weave in the run-in, straight for the last 700 m
                if (hd > 700) { const side = _v2.set(dz / hd, 0, -dx / hd); aim.addScaledVector(side, Math.sin(this.age * 2.6) * Math.min(60, (hd - 700) * 0.05)); }
            } else if (hd > 1000 && !this.diving) aim.y = Math.max(alt, T.y + 330);
            else this.diving = true;
            const want = aim.sub(this.pos).normalize().multiplyScalar(s.speed * (this.diving ? 1.08 : 1));
            const dv = want.sub(this.vel), maxDv = 15 * G * dt;
            if (dv.length() > maxDv) dv.setLength(maxDv);
            this.vel.add(dv);
            if (seaTarget && this.pos.y < 1.5 && this.vel.y < 0) this.vel.y = 0; // (skimming, not diving into the sea)
            return;
        }
        if (seaTarget && hd < 6000) alt = Math.max(Math.max(floor, 0) + 6, T.y + 1.5);
        let vy = clamp(Math.max((alt - this.pos.y) * 0.9, climbNeed * 1.15), -35, 140);
        if (this.pos.y < Math.max(here, 0) + 25) vy = 140; // too close to the ground: pull up
        const hs = Math.max(Math.sqrt(Math.max(s.speed * s.speed - vy * vy, 100)), 60);
        this.vel.x = Math.sin(h) * hs; this.vel.z = Math.cos(h) * hs;
        this.vel.y = damp(this.vel.y, vy, vy > this.vel.y ? 6 : 3, dt);
    }

    flyBallistic(dt) {
        const s = this.spec;
        if (this.phase === 'boost') {
            // time of flight from the remaining range: a high arc (apogee ~ a third of the range, at least 4 km)
            if (!this.tof) {
                const R = Math.hypot(this.aim.pos.x - this.pos.x, this.aim.pos.z - this.pos.z);
                const H = clamp(R * 0.33, 4000, 40000);
                this.tof = Math.sqrt(8 * H / G) + s.boost;
            }
            const rem = Math.max(this.tof - this.age, 5);
            const need = this.ballisticVel(_v, rem);
            const speed = this.vel.length();
            // straight up off the rail, then pitch over toward the needed velocity while the motor pushes
            const cur = _v2.copy(this.vel).normalize();
            const k = this.age < 1.5 ? 0 : clamp(dt * 0.9, 0, 1);
            cur.lerp(_v3.copy(need).normalize(), k).normalize();
            const target = need.length();
            this.vel.copy(cur).multiplyScalar(Math.min(speed + 70 * dt, target * 1.02));
            if (this.age > s.boost) {
                this.phase = 'fall';
                this.ballisticVel(this.vel, rem); // guidance hands over to the arc
                this.mgr.boom(this.pos, 0.3);
            }
            return;
        }
        this.vel.y -= G * dt;
        if ((s.dive || this.tracked) && this.vel.y < 0) {
            // penetrator: steer to come down steeply on the aim point (a hardened target needs a vertical hit)
            const T = this.targetPos, d = _v.subVectors(T, this.pos), dist = d.length();
            if (dist < 6000) this.vel.lerp(d.normalize().multiplyScalar(Math.max(this.vel.length(), 600)), clamp(dt * 1.5, 0, 1));
        }
    }

    flyRocket(dt) {
        this.motorT -= dt;
        this.vel.y -= G * dt;
        if (this.motorT <= 0) this.phase = 'fall';
    }

    dropBooster() {
        const b = this.booster;
        this.booster = null;
        b.updateMatrixWorld();
        const w = new THREE.Mesh(b.geometry, b.material);
        b.getWorldPosition(w.position); b.getWorldQuaternion(w.quaternion);
        this.mesh.remove(b);
        this.mgr.debris.push({ mesh: w, vel: this.vel.clone().multiplyScalar(0.6), spin: rand(-3, 3), life: 20 });
        this.game.scene.add(w);
    }

    checkImpact() {
        const T = this.targetPos;
        const d2 = this.pos.distanceToSquared(T);
        const ground = terrainHeight(this.pos.x, this.pos.z);
        const unit = this.aim.unit;
        const hitUnit = unit && unit.alive !== false && ((unit.hitTest && unit.hitTest(this.pos)) || d2 < (this.kind === 'rocket' ? 25 : 64));
        if (hitUnit || (this.kind !== 'rocket' && d2 < 36) || this.pos.y < Math.max(ground, 0) + 0.5 || this.age > 400) {
            this.mgr.impact(this, this.pos.y < 0.5 && ground < 0);
        }
    }

    damage(amount) { // shot down (CIWS / SAM)
        if (!this.alive) return;
        this.hp -= amount;
        if (this.hp <= 0) this.mgr.intercepted(this);
    }

    remove() {
        this.alive = false;
        this.game.scene.remove(this.mesh);
        this.trail.emitting = false;
    }
}

// ═════════════ The strike manager (a plug-in system: systems.js) ═════════════
export class StrikeManager {
    constructor(game) {
        this.game = game;
        this.sources = [];
        this.missiles = [];
        this.strikes = [];
        this.debris = [];
        this.bda = [];         // { strike, pos, unit, label } waiting for someone to look
        this.nextSourceId = 1;
        this.nextStrikeId = 1;
        this.cam = null;       // missile camera
        this.silo = null;
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.enabled = !['rings', 'practice'].includes(mode);
        if (!this.enabled) return;
        const g = this.game;
        // the player's side: an escort destroyer with the home carrier, and a missile field near the home base
        const cv = g.naval && g.naval.homeCarrier;
        if (cv) {
            const dd = this.spawnEscort(cv, 'destroyer', 'USS MASON (DDG-87)', 0.26, 700);
            if (dd) this.addSource(new ShipVLS(this, dd, { stock: { tlam: 8, harpoon: 4 } }));
        }
        const site = this.findSite(BASES[0].x + 2600, BASES[0].z + 2400, 800, 5000);
        if (site) this.addSource(this.silo = new SiloSite(this, site, { name: 'ROCKY FIELD MISSILE SITE', stock: { tlam: 6, atacms: 4, penetrator: 4 } }));
    }

    clear() {
        for (const m of this.missiles) m.remove();
        for (const s of this.sources) if (s.remove) s.remove();
        for (const d of this.debris) this.game.scene.remove(d.mesh);
        this.missiles.length = 0; this.sources.length = 0; this.strikes.length = 0; this.debris.length = 0; this.bda.length = 0;
        this.cam = null;
        this.silo = null;
    }

    addSource(src) { this.sources.push(src); return src; }
    removeSource(src) { const i = this.sources.indexOf(src); if (i >= 0) this.sources.splice(i, 1); }

    // An escort ship keeping station on a carrier (a fleet plug-in can do proper formations)
    spawnEscort(carrier, type, name, lag, out) {
        const naval = this.game.naval;
        if (!naval) return null;
        const o = carrier.orbit;
        const s = new Ship(naval, type, carrier.team, { x: o.cx, z: o.cz }, o.R + out, o.a - lag * Math.sign(o.w), Math.sign(o.w), name);
        s.orbit.w = o.w; // same angular speed: it stays on station
        s.escortOf = carrier;
        naval.ships.push(s);
        this.game.ground.targets.push(s);
        return s;
    }

    // flat dry land for an installation, away from roads, towns and runways
    findSite(cx, cz, rMin, rMax) {
        const towns = this.game.world.towns;
        for (let k = 0; k < 200; k++) {
            const a = Math.random() * Math.PI * 2, r = rand(rMin, rMax);
            const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
            const h = terrainHeight(x, z);
            if (h < 8 || h > 400) continue;
            let flat = true;
            for (const [ox, oz] of [[60, 0], [-60, 0], [0, 40], [0, -40], [45, 30], [-45, -30]]) if (Math.abs(terrainHeight(x + ox, z + oz) - h) > 5) { flat = false; break; }
            if (!flat) continue;
            if (towns && towns.blockTree && towns.blockTree(x, z)) continue;
            if (BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r * 1.2)) continue;
            return { x, z };
        }
        return null;
    }

    // ═════════════ Requests ═════════════
    // type: a STRIKE_TYPES key; marks: designations (war.js) or units; team: whose strike (the player's by default)
    request(type, marks = this.game.war.designations, team = this.game.war.side, quiet = false) {
        const T = STRIKE_TYPES[type], g = this.game, war = g.war;
        if (!T) return null;
        marks = (marks || []).filter(Boolean);
        if (!marks.length) { if (!quiet) war.radio('COMMAND', 'NO TARGET DESIGNATED — MARK A TARGET FIRST (COMMA)', { color: '#ff9f5a', say: false }); return null; }
        if (T.aircraft) return this.airStrike(marks, team, quiet);
        const specKey = T.use[team];
        const aims = [];
        for (const d of (T.all ? marks : [marks[marks.length - 1]])) {
            const unit = d.unit || (d.alive !== undefined ? d : null);
            const pos = unit ? unit.pos : d.fixed || d.pos;
            if (T.pattern === 'runway') for (const p of this.runwayPoints(pos)) aims.push({ pos: p, unit: null, label: 'RUNWAY' });
            else aims.push({ pos, unit, label: unit ? war.label(unit) : 'MARK ' + d.id, mark: d });
        }
        const strike = { id: this.nextStrikeId++, type, label: T.label, team, spec: MISSILES[specKey], aims, launched: 0, planned: 0, impacts: 0, lost: 0, missiles: [], t: g.time, sources: new Set(), done: false };
        for (const aim of aims) {
            let need = T.per;
            // nearest sources first, several if one runs short
            const cand = this.sources.filter(s => s.team === team && T.sources.includes(s.kind) && s.canFire(specKey) && s.pos.distanceTo(aim.pos) < s.range)
                .sort((a, b) => a.pos.distanceToSquared(aim.pos) - b.pos.distanceToSquared(aim.pos));
            for (const s of cand) {
                if (need <= 0) break;
                const k = s.fire(specKey, need, aim, strike);
                need -= k; strike.planned += MISSILES[specKey].kind === 'rocket' ? MISSILES[specKey].count * k : k;
                if (k) strike.sources.add(s);
            }
        }
        if (!strike.planned) {
            if (!quiet) war.radio('COMMAND', 'UNABLE — NO ' + MISSILES[specKey].name + ' SHOOTER IN RANGE', { color: '#ff9f5a', say: 'Unable. No shooters available.' });
            return null;
        }
        this.strikes.push(strike);
        for (const d of marks) if (d.transmitted === false) d.transmitted = true;
        if (!quiet && team === war.side) {
            const src = [...strike.sources][0];
            const eta = this.estimate(strike.spec, src.pos, aims[0].pos) + src.prepTime(specKey);
            const n = strike.planned, what = strike.spec.kind === 'rocket' ? n + ' ROCKETS' : n + '× ' + strike.spec.name;
            war.radio(src.name.split(' (')[0], 'COPY STRIKE ON ' + aims.map(a => a.label).filter((x, i, arr) => arr.indexOf(x) === i).join(', ') + ' — ' + what + ', TIME ON TARGET ' + this.clock(eta), { color: '#9fd4ff', say: 'Copy. ' + (strike.spec.kind === 'rocket' ? 'Rockets' : strike.spec.name.toLowerCase()) + ' inbound, time on target ' + Math.round(eta) + ' seconds.' });
        }
        g.events.emit('strikeRequested', strike);
        return strike;
    }

    // three aim points down the runway nearest a point
    runwayPoints(pos) {
        let best = null, bd = Infinity;
        for (const b of BASES) { const d = Math.hypot(b.x - pos.x, b.z - pos.z); if (d < bd) { bd = d; best = b; } }
        const out = [];
        const rw = best.runways[0], hd = best.heading + (rw.rot || 0);
        const c = Math.cos(best.heading), s = Math.sin(best.heading);
        const cx = best.x + rw.lx * c + rw.lz * s, cz = best.z - rw.lx * s + rw.lz * c;
        for (const f of [-0.3, 0, 0.3]) {
            const along = f * rw.len;
            out.push(new THREE.Vector3(cx + Math.sin(hd) * along, best.h, cz + Math.cos(hd) * along));
        }
        return out;
    }

    // An air strike: two jets from the nearest friendly airfield bomb the mark and head home (a support plug-in can
    // replace this with proper strike packages)
    airStrike(marks, team, quiet) {
        const g = this.game, war = g.war, d = marks[marks.length - 1];
        const unit = d.unit || (d.alive !== undefined ? d : null);
        const pos = unit ? unit.pos : d.fixed || d.pos;
        if (!g.spawnFriendly || team !== war.side) return null;
        const base = BASES.filter(b => b.friendly && !b.civil).sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z))[0];
        const strike = { id: this.nextStrikeId++, type: 'air', label: 'AIR STRIKE', team, spec: { name: 'GBU-31', short: 'JDAM', kind: 'air', warhead: 420, blast: 30, hard: 0.55 }, aims: [{ pos, unit, label: unit ? war.label(unit) : 'MARK ' + d.id, mark: d }], launched: 0, planned: 0, impacts: 0, lost: 0, missiles: [], t: g.time, sources: new Set(), done: false, jets: [] };
        for (let i = 0; i < 2; i++) {
            const start = new THREE.Vector3(base.x + (i ? 300 : -300), 2500, base.z + (i ? 200 : 0));
            // (the waypoint is past the target, so the run goes straight over it)
            const dx = pos.x - start.x, dz = pos.z - start.z, L = Math.hypot(dx, dz) || 1;
            const wp = new THREE.Vector3(pos.x + dx / L * 6000, 2500, pos.z + dz / L * 6000);
            const a = g.spawnFriendly(i ? 'f15' : 'f16', start, wp, (i ? 'HAMMER 2' : 'HAMMER 1'));
            if (!a) continue;
            a.bombs = 4; a.strikeRun = { aim: strike.aims[0], dropped: 0, strike };
            strike.jets.push(a); strike.planned += 4;
        }
        if (!strike.jets.length) return null;
        this.strikes.push(strike);
        if (!quiet) war.radio('HAMMER 1', 'HAMMER FLIGHT, TWO SHIPS OUT OF ' + base.name + ', PUSHING TO ' + strike.aims[0].label + ' — ' + this.clock(Math.hypot(pos.x - base.x, pos.z - base.z) / 250 + 20), { color: '#9fd4ff' });
        g.events.emit('strikeRequested', strike);
        return strike;
    }

    // ═════════════ Missiles ═════════════
    spawnMissile(spec, team, pos, dir, aim, source, strike) {
        const m = new StrategicMissile(this, spec, team, pos, dir, aim, source, strike);
        this.missiles.push(m);
        if (strike) { strike.launched++; strike.missiles.push(m); }
        this.game.events.emit('strategicLaunch', m);
        // the first launch of a strike: a call from the shooter, and the enemy sees it
        if (strike && strike.launched === 1 && team === this.game.war.side) {
            this.game.war.radio(source.name.split(' (')[0], (spec.kind === 'rocket' ? 'ROCKETS AWAY' : spec.kind === 'ballistic' ? 'MISSILE AWAY' : 'SHOT, ' + spec.short) + ' — ' + strike.aims[0].label, { color: '#9fd4ff', say: spec.kind === 'rocket' ? 'Rockets away.' : 'Missile away.' });
        }
        if (team !== this.game.war.side && spec.kind !== 'rocket') {
            const src = source.pos, br = this.game.war.describePos(src);
            if (!this._launchWarnT || this.game.time - this._launchWarnT > 8) {
                this._launchWarnT = this.game.time;
                this.game.war.radio('MAGIC', (spec.kind === 'ballistic' ? 'BALLISTIC MISSILE LAUNCH DETECTED' : 'MISSILE LAUNCH DETECTED') + ' — ' + br, { color: '#ff4a3d', say: 'Missile launch detected!', priority: true });
            }
        }
        return m;
    }

    estimate(spec, from, to) {
        const R = Math.hypot(to.x - from.x, to.z - from.z);
        if (spec.kind === 'ballistic') { const H = clamp(R * 0.33, 4000, 40000); return Math.sqrt(8 * H / G) + spec.boost; }
        if (spec.kind === 'rocket') return R / 380 + 4;
        return R / spec.speed + spec.boost + 6;
    }

    // Warhead on target: blast, crater, damage (hardened targets shrug off what can't penetrate)
    impact(m, water) {
        const g = this.game, s = m.spec, war = g.war, fx = g.effects;
        const at = m.pos.clone();
        const ground = terrainHeight(at.x, at.z);
        if (!water && at.y < ground + 1) at.y = ground + 0.5;
        const size = clamp(Math.sqrt(s.warhead / 150), 0.6, 2.4);
        fx.explosion(at, size * 1.4, m.vel);
        if (!water) {
            if (s.warhead >= 300) fx.smokeColumn(_v.copy(at).setY(Math.max(ground, 0) + 2), size, 25 + size * 10);
            const shape = { r: clamp(s.blast * 0.22, 2, 9), depth: clamp(s.warhead / 180, 1, 4), rim: 0.8, scorch: 1.2, reach: 2.6, clods: 16 };
            if (at.y - ground < 4) g.weapons.addCrater(_v.set(at.x, ground, at.z), shape, m.vel);
        } else fx.waterSplash(_v.copy(at).setY(0.5), 3);
        this.boom(at, size);
        // damage: units near the blast (war registry covers ground targets, ships, aircraft and plug-in units)
        // (big things — a 320 m carrier — can be hit far from their centre: look wider, and a hull hit is a hit)
        const hits = war.near(at, s.blast * 3 + 220);
        let hitAim = false;
        for (const { u, rec, d2 } of hits) {
            if (!u.damage) continue;
            if (u.team === m.team && u !== m.aim.unit) continue; // (friendly fire only if it was aimed there)
            const direct = u.hitTest ? u.hitTest(at) : Math.sqrt(d2) < 4;
            const d = direct ? 0 : Math.max(0, Math.sqrt(d2) - (u.radius || 0) * 0.6);
            if (!direct && d > s.blast * 3) continue;
            let dmg = s.warhead * (direct ? 1.2 : clamp(1 - Math.max(d, 0) / (s.blast * 3), 0, 1) ** 1.5);
            const hard = rec.hardened || 0;
            if (hard > s.hard) dmg *= Math.max(0.08, (1 - (hard - s.hard) * 1.4)) ** 2;
            if (dmg > 1) { u.damage(dmg, m.source && m.source.host ? m.source.host : m.source, 'strike'); if (u === m.aim.unit) hitAim = true; }
        }
        g.weapons.worldBlast(at, s.blast * 1.2, s.warhead * 3, null);
        g.weapons.blastPeople(at, s.blast * 1.6, 200, null, m.team);
        g.events.emit('strategicImpact', m, { at, hitAim });
        // bookkeeping
        const st = m.strike;
        m.remove();
        this.missiles.splice(this.missiles.indexOf(m), 1);
        if (this.cam && this.cam.missile === m) { this.cam.missile = null; this.cam.impactAt = at; this.cam.hold = 5; }
        if (st) {
            st.impacts++;
            if (!st.firstImpact) { st.firstImpact = true; if (st.team === war.side && s.kind !== 'rocket') war.radio('COMMAND', 'MISSILE IMPACT — ' + m.aim.label, { color: '#9fd4ff', say: false }); }
            this.checkStrikeDone(st);
        }
    }

    intercepted(m) {
        const g = this.game;
        g.effects.explosion(m.pos, 0.7, m.vel);
        const st = m.strike;
        m.remove();
        this.missiles.splice(this.missiles.indexOf(m), 1);
        if (st) { st.lost++; this.checkStrikeDone(st); if (st.team === g.war.side) g.war.radio('COMMAND', st.spec.short + ' INTERCEPTED', { color: '#ff9f5a', say: false }); }
    }

    // All in: what happened is only known if someone saw it — otherwise it waits for battle damage assessment
    checkStrikeDone(st) {
        if (st.done || st.impacts + st.lost < st.planned || st.queued) return;
        if (this.sources.some(s => s.queue.some(q => q.strike === st))) return;
        st.done = true;
        const war = this.game.war;
        if (st.team !== war.side) return;
        for (const aim of st.aims) {
            const seen = this.observed(aim.pos);
            if (seen) this.reportBDA(st, aim);
            else if (!this.bda.some(b => b.aim === aim)) {
                this.bda.push({ strike: st, aim, pos: aim.unit ? aim.unit.pos.clone() : aim.pos.clone(), t: this.game.time, look: 0 });
                war.radio('COMMAND', 'MISSILE IMPACT — BDA REQUESTED ON ' + aim.label + ' · GRID ' + war.grid(aim.pos.x, aim.pos.z), { color: '#ffd24a', say: 'Missile impact. Battle damage assessment requested.' });
            }
        }
        this.game.events.emit('strikeDone', st);
    }

    // is anyone on our side watching this point? (the player close enough with a line of sight; plug-ins add drones)
    observed(pos) {
        const g = this.game, eye = g.camera.position;
        const d = eye.distanceTo(pos);
        if (d < 9000 && g.war.lineOfSight(eye, _v.copy(pos).setY(pos.y + 4))) return true;
        return !!(g.events && this.watchers && this.watchers.some(w => w(pos)));
    }

    reportBDA(st, aim) {
        const war = this.game.war, u = aim.unit;
        let res;
        if (!u) res = 'POINT TARGET HIT';
        else if (!u.alive) res = 'TARGET DESTROYED';
        else if ((u.hp ?? u.health ?? 1) < (u.maxHp ?? u.maxHealth ?? 1) * 0.6) res = 'TARGET DAMAGED — RE-STRIKE RECOMMENDED';
        else res = 'TARGET STILL OPERATIONAL';
        aim.result = res;
        war.radio('COMMAND', 'MISSILE IMPACT — ' + res + (u ? ' (' + war.label(u) + ')' : ''), { color: u && !u.alive ? '#5dffa0' : '#ffd24a', say: res.split(' —')[0].toLowerCase() + '.' });
        if (u && !u.alive) { this.game.score = (this.game.score || 0) + 250; }
        this.game.events.emit('bda', { strike: st, aim, result: res });
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        for (const s of this.sources) s.update(dt);
        for (let i = this.missiles.length - 1; i >= 0; i--) this.missiles[i].update(dt);
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i];
            d.life -= dt;
            d.vel.y -= G * dt;
            d.mesh.position.addScaledVector(d.vel, dt);
            d.mesh.rotateX(d.spin * dt);
            if (d.life <= 0 || d.mesh.position.y < Math.max(terrainHeight(d.mesh.position.x, d.mesh.position.z), 0)) {
                if (d.mesh.position.y < 0.5) this.game.effects.waterSplash(d.mesh.position, 0.4);
                this.game.scene.remove(d.mesh); this.debris.splice(i, 1);
            }
        }
        this.updateAirStrikes(dt);
        this.updateBDA(dt);
    }

    // scripted bomb runs for the stand-in air strike
    updateAirStrikes() {
        const g = this.game;
        for (const st of this.strikes) {
            if (st.type !== 'air' || st.done) continue;
            let active = 0;
            for (const a of st.jets) {
                if (!a.alive || !a.strikeRun) continue;
                active++;
                const run = a.strikeRun, T = run.aim.unit && run.aim.unit.alive ? run.aim.unit.pos : run.aim.pos;
                const hd = Math.hypot(T.x - a.pos.x, T.z - a.pos.z);
                // predicted bomb impact near the aim: release
                if (hd < 2600 && run.dropped < 4 && g.weapons.predictBomb) {
                    const p = g.weapons.predictBomb(a, _v);
                    if (p && Math.hypot(p.x - T.x, p.z - T.z) < 90 + run.dropped * 30) {
                        if (!run.nextT || g.time > run.nextT) { g.weapons.dropBomb(a); run.dropped++; st.launched++; run.nextT = g.time + 0.25; }
                    }
                }
                if (run.dropped >= 4 && !run.home) {
                    run.home = true;
                    if (a.pilot) { a.pilot.waypoint = new THREE.Vector3(BASES[0].x, 3000, BASES[0].z); }
                    g.war.radio(a.callsign || 'HAMMER', 'BOMBS AWAY, OFF TARGET', { color: '#9fd4ff', say: false });
                    st.impacts += 4;
                }
            }
            if (st.impacts >= st.planned || !active) { st.done = true; setTimeout(() => this.checkAirBDA(st), 5000); }
        }
    }

    checkAirBDA(st) {
        if (!this.game.war.enabled) return;
        const aim = st.aims[0];
        if (this.observed(aim.pos)) this.reportBDA(st, aim);
        else if (!this.bda.some(b => b.aim === aim)) this.bda.push({ strike: st, aim, pos: aim.pos.clone(), t: this.game.time, look: 0 });
    }

    // BDA: fly over the target (within ~6 km, looking at it) until the sensor imagery is in
    updateBDA(dt) {
        if (!this.bda.length) return;
        const g = this.game, eye = g.camera.position, fwd = g.camera.getWorldDirection(_v3);
        for (let i = this.bda.length - 1; i >= 0; i--) {
            const b = this.bda[i];
            const d = eye.distanceTo(b.pos);
            const looking = d < 6500 && _v.subVectors(b.pos, eye).dot(fwd) > d * 0.8 && g.war.lineOfSight(eye, _v2.copy(b.pos).setY(b.pos.y + 4));
            const byWatcher = this.watchers && this.watchers.some(w => w(b.pos));
            if (looking || byWatcher) b.look += dt; else b.look = Math.max(0, b.look - dt * 0.5);
            if (b.look > 2.2) { this.bda.splice(i, 1); this.reportBDA(b.strike, b.aim); }
        }
    }

    // ═════════════ Designation (comma) ═════════════
    // Mark what the HUD has locked, else the point on the ground under the aim / crosshair (and a known unit there)
    designateFromView() {
        const g = this.game, war = g.war;
        const t = g.lockTarget;
        if (t && !g.isNeutral(t) && !g.pilotMode) return war.designate(t, 'hud');
        const cam = g.camera;
        const o = cam.position.clone(), dir = cam.getWorldDirection(new THREE.Vector3());
        // (in the chase view, look along the jet's nose from the jet, not the camera behind it)
        if (!g.pilotMode && g.player && g.player.alive && g.cameraMode !== 'cockpit') { o.copy(g.player.pos); g.player.getForward(dir); }
        const hit = this.rayGround(o, dir, 30000);
        if (!hit) { war.radio('', 'NO GROUND UNDER THE MARKER', { color: '#9fb2c4', say: false }); return null; }
        const near = war.near(hit, 80, { minKnown: INTEL.CONTACT }).find(o => o.rec.team !== war.side);
        return war.designate(near ? near.u : hit, 'hud');
    }

    rayGround(o, d, max) {
        let prev = 0;
        for (let t = 20; t < max; t *= 1.04) {
            const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
            if (y < Math.max(terrainHeight(x, z), 0)) {
                // refine between the last two steps
                let a = prev, b = t;
                for (let k = 0; k < 12; k++) { const m = (a + b) / 2; const yy = o.y + d.y * m; if (yy < Math.max(terrainHeight(o.x + d.x * m, o.z + d.z * m), 0)) b = m; else a = m; }
                return new THREE.Vector3(o.x + d.x * b, Math.max(terrainHeight(o.x + d.x * b, o.z + d.z * b), 0), o.z + d.z * b);
            }
            prev = t;
        }
        return null;
    }

    // ═════════════ Input ═════════════
    onAction(a) {
        if (!this.enabled || this.game.state !== 'playing') return false;
        if (a === 'designate') { this.designateFromView(); return true; }
        if (a === 'missilecam') {
            // own air-to-air missiles keep the old camera; strategic missiles and rockets get this one
            const mine = this.missiles.filter(m => m.team === this.game.war.side);
            if (this.cam) { this.cam = null; return true; }
            const own = this.game.weapons.missiles.some(m => m.owner === this.game.player);
            if (!mine.length || own) return false;
            this.cam = { missile: mine[mine.length - 1], mode: 'chase', hold: 0, t: 0 };
            return true;
        }
        if (a === 'camera' && this.cam) { this.cam.mode = CAM_MODES[(CAM_MODES.indexOf(this.cam.mode) + 1) % CAM_MODES.length]; this.cam.t = 0; return true; }
        return false;
    }

    // ═════════════ Missile camera ═════════════
    // Takes over the main camera while active; returns false when it isn't
    updateCamera(cam, dt) {
        const c = this.cam;
        if (!c) return false;
        const g = this.game;
        c.t += dt;
        let m = c.missile;
        if (m && !m.alive) m = c.missile = null;
        if (!m && c.hold <= 0) {
            // on to the next missile of the same strike, if any
            const next = this.missiles.find(x => x.team === g.war.side);
            if (next && c.chain !== false) { c.missile = m = next; c.t = 0; }
            else { this.cam = null; return false; }
        }
        if (g.player) g.player.root.visible = !g.player.exploded;
        if (g.cockpit) g.cockpit.enabled = false;
        cam.up.set(0, 1, 0);
        if (!m) {
            // after impact: a slow orbit round the blast
            c.hold -= dt;
            const at = c.impactAt;
            c.orbit = (c.orbit || 0) + dt * 0.25;
            cam.position.set(at.x + Math.cos(c.orbit) * 380, at.y + 120, at.z + Math.sin(c.orbit) * 380);
            const gh = Math.max(terrainHeight(cam.position.x, cam.position.z), 0) + 20;
            if (cam.position.y < gh) cam.position.y = gh;
            cam.lookAt(at);
            cam.fov = damp(cam.fov, 50, 3, dt); cam.updateProjectionMatrix();
            return true;
        }
        const dir = _v.copy(m.vel).normalize();
        const T = m.targetPos;
        let fov = 55;
        switch (c.mode) {
            case 'chase':
                cam.position.copy(m.pos).addScaledVector(dir, -22).add(_v2.set(0, 4, 0));
                cam.lookAt(_v2.copy(m.pos).addScaledVector(dir, 60));
                break;
            case 'follow':
                cam.position.copy(m.pos).addScaledVector(dir, -9).add(_v2.set(0, 1.6, 0));
                cam.lookAt(T);
                fov = 45;
                break;
            case 'side': {
                const side = _v2.crossVectors(dir, UP).normalize();
                if (side.lengthSq() < 0.1) side.set(1, 0, 0);
                cam.position.copy(m.pos).addScaledVector(side, 35).addScaledVector(dir, 6);
                cam.lookAt(m.pos);
                break;
            }
            case 'target': {
                const back = _v2.subVectors(m.pos, T).setY(0).normalize();
                cam.position.copy(T).addScaledVector(back, 60).add(_v3.set(0, 25, 0));
                cam.lookAt(m.pos);
                fov = clamp(2 * Math.atan(40 / Math.max(m.pos.distanceTo(cam.position), 1)) * 57.3, 4, 55);
                break;
            }
            case 'impact': {
                // a fixed camera off to the side of the target, waiting for it
                if (!c.fixed || c.fixedFor !== m) {
                    const back = _v2.subVectors(m.pos, T).setY(0).normalize();
                    const side = _v3.crossVectors(back, UP).normalize();
                    c.fixed = T.clone().addScaledVector(side, 320).addScaledVector(back, 120);
                    c.fixed.y = Math.max(terrainHeight(c.fixed.x, c.fixed.z), 0) + 45;
                    c.fixedFor = m;
                }
                cam.position.copy(c.fixed);
                cam.lookAt(m.pos.distanceTo(T) < 1500 ? T : m.pos);
                fov = 40;
                break;
            }
        }
        const gh = Math.max(terrainHeight(cam.position.x, cam.position.z), 0) + 3;
        if (cam.position.y < gh) cam.position.y = gh;
        cam.fov = damp(cam.fov, fov, 4, dt);
        cam.updateProjectionMatrix();
        return true;
    }

    // ═════════════ Audio ═════════════
    boom(at, size) {
        const g = this.game, d = g.camera.position.distanceTo(at);
        const delay = Math.min(d / 343, 30);
        setTimeout(() => g.audio.boom && g.audio.boom(d, size), delay * 1000);
        if (d < 3000) g.shake = Math.max(g.shake, clamp((3000 - d) / 3000 * size * 0.6, 0, 1));
    }
    audioLaunch(p, spec) {
        const g = this.game, d = g.camera.position.distanceTo(p);
        if (d > 12000) return;
        setTimeout(() => g.audio.boom && g.audio.boom(d * 1.4, spec.kind === 'rocket' ? 0.3 : 0.6), Math.min(d / 343, 30) * 1000);
    }

    clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    // ═════════════ Command menu ═════════════
    commands() {
        if (!this.enabled) return [];
        const g = this.game, war = g.war, team = war.side;
        const marks = war.designations;
        const out = [];
        for (const key of ORDER) {
            const T = STRIKE_TYPES[key];
            let hint = '', ok = marks.length > 0;
            if (T.aircraft) hint = 'F-16 + F-15 FROM THE NEAREST AIRBASE';
            else {
                const spec = MISSILES[T.use[team]];
                const avail = this.sources.filter(s => s.team === team && T.sources.includes(s.kind) && s.canFire(T.use[team]));
                const n = avail.reduce((a, s) => a + (s.stock[T.use[team]] || 0), 0);
                if (!avail.length) { ok = false; hint = 'NO ' + spec.short + ' SHOOTERS'; }
                else {
                    const tgt = marks.length ? (marks[marks.length - 1].unit ? marks[marks.length - 1].unit.pos : marks[marks.length - 1].pos) : null;
                    const near = tgt ? avail.slice().sort((a, b) => a.pos.distanceToSquared(tgt) - b.pos.distanceToSquared(tgt))[0] : avail[0];
                    hint = spec.short + ' ×' + n + ' · ' + near.name.split(' (')[0] + (tgt ? ' · TOT ' + this.clock(this.estimate(spec, near.pos, tgt) + near.prepTime(T.use[team])) : '');
                }
            }
            if (!marks.length) hint = 'MARK A TARGET FIRST (,)';
            out.push({ path: ['TACTICAL SUPPORT'], label: T.label, hint, enabled: ok, run: () => this.request(key) });
        }
        out.push({ path: ['DESIGNATION'], label: 'MARK TARGET / POINT', hint: 'COMMA', run: () => this.designateFromView() });
        out.push({ path: ['DESIGNATION'], label: 'TRANSMIT MARKS TO COMMAND', hint: marks.length + ' MARKED', enabled: marks.length > 0, run: () => war.transmit() });
        for (const d of marks) out.push({ path: ['DESIGNATION'], label: 'CLEAR MARK ' + d.id + ' — ' + d.label, run: () => war.undesignate(d) });
        out.push({ path: ['DESIGNATION'], label: 'CLEAR ALL MARKS', enabled: marks.length > 0, run: () => { marks.length = 0; } });
        const flying = this.missiles.filter(m => m.team === team).length;
        out.push({ path: ['MISSILE CAMERA'], label: 'WATCH MY MISSILES (K)', hint: flying + ' IN FLIGHT', enabled: flying > 0, run: () => { this.cam = { missile: this.missiles.filter(m => m.team === team).pop(), mode: 'chase', hold: 0, t: 0 }; } });
        return out;
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        const g = this.game, war = g.war;
        if (!this.enabled || g.photo || g.hideHud) return;
        const cam = g.camera;
        ctx.save();
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        // designation markers in the world
        for (const d of war.designations) {
            const p = hud.project(d.unit ? d.unit.pos : d.fixed || d.pos, cam, {});
            if (!p.front) continue;
            ctx.strokeStyle = '#5dffa0'; ctx.fillStyle = '#5dffa0'; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(p.x, p.y - 11); ctx.lineTo(p.x + 11, p.y); ctx.lineTo(p.x, p.y + 11); ctx.lineTo(p.x - 11, p.y); ctx.closePath(); ctx.stroke();
            ctx.textAlign = 'left'; ctx.fillText('M' + d.id, p.x + 14, p.y - 8);
        }
        // BDA requests
        for (const b of this.bda) {
            const p = hud.project(b.pos, cam, {});
            if (!p.front) continue;
            ctx.strokeStyle = '#ffd24a'; ctx.fillStyle = '#ffd24a';
            ctx.strokeRect(p.x - 9, p.y - 9, 18, 18);
            ctx.textAlign = 'left'; ctx.fillText('BDA' + (b.look > 0 ? ' ' + Math.round(b.look / 2.2 * 100) + '%' : ''), p.x + 13, p.y + 8);
        }
        // strike status (upper left, under the score panel)
        const live = this.strikes.filter(s => !s.done && s.team === war.side);
        let y = hud.compact ? 150 : 190;
        ctx.textAlign = 'left';
        for (const st of live.slice(-4)) {
            const flying = st.missiles.filter(m => m.alive);
            const eta = flying.length ? Math.max(0, Math.min(...flying.map(m => m.eta - (g.time - m.t0)))) : null;
            const txt = 'STRIKE ' + st.id + ' · ' + (st.spec.kind === 'rocket' ? 'ROCKETS' : st.planned + '× ' + st.spec.short) + ' → ' + st.aims[0].label + (eta != null ? ' · IMPACT ' + this.clock(eta) : st.launched < st.planned ? ' · LAUNCHING' : '');
            ctx.fillStyle = 'rgba(8,14,20,0.45)'; ctx.fillRect(14, y - 9, ctx.measureText(txt).width + 12, 18);
            ctx.fillStyle = '#9fd4ff'; ctx.fillText(txt, 20, y);
            y += 20;
        }
        // missile camera overlay
        const c = this.cam;
        if (c) {
            const m = c.missile;
            ctx.textAlign = 'center';
            ctx.font = '700 15px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = '#e8f4ff';
            const line1 = m ? m.spec.name + ' · ' + CAM_LABEL[c.mode] : 'IMPACT';
            ctx.fillText(line1, hud.w / 2, hud.h - 64);
            ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
            if (m) {
                const d = m.pos.distanceTo(m.targetPos);
                ctx.fillText(Math.round(m.vel.length() * 1.944) + ' KT · ' + Math.round(m.pos.y * 3.281) + ' FT · ' + (d / 1000).toFixed(1) + ' KM TO TARGET · ' + (m.phase === 'boost' ? 'BOOST' : m.phase === 'fall' ? 'BALLISTIC' : m.phase.toUpperCase()), hud.w / 2, hud.h - 44);
            }
            ctx.fillStyle = 'rgba(232,244,255,0.6)';
            ctx.fillText('V: CAMERA · K: BACK TO THE JET', hud.w / 2, hud.h - 26);
        }
        ctx.restore();
    }

    // ═════════════ Tactical map ═════════════
    drawMap(ctx, map) {
        const war = this.game.war;
        ctx.save();
        // launch sources of our side
        for (const s of this.sources) {
            if (s.team !== war.side || !s.alive) continue;
            const p = map.toScreen(s.pos.x, s.pos.z);
            ctx.fillStyle = '#6fb4ff'; ctx.strokeStyle = '#6fb4ff';
            ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
            if (map.scale > 0.004) { ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText(s.name.split(' (')[0] + ' ' + Object.entries(s.stock).filter(([, n]) => n > 0).map(([k, n]) => MISSILES[k].short + ' ' + n).join(' '), p.x + 7, p.y + 3); }
        }
        // missiles in flight: a line from launch to aim, the missile, ETA
        for (const m of this.missiles) {
            const own = m.team === war.side;
            if (!own && !m.detected) continue;
            const a = map.toScreen(m.pos.x, m.pos.z), b = map.toScreen(m.targetPos.x, m.targetPos.z);
            ctx.strokeStyle = own ? 'rgba(111,180,255,0.7)' : 'rgba(255,90,70,0.8)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = own ? '#bfe0ff' : '#ff6a5a';
            ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        // BDA requests
        for (const b of this.bda) {
            const p = map.toScreen(b.pos.x, b.pos.z);
            ctx.strokeStyle = '#ffd24a'; ctx.strokeRect(p.x - 7, p.y - 7, 14, 14);
            ctx.fillStyle = '#ffd24a'; ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText('BDA', p.x + 9, p.y - 6);
        }
        ctx.restore();
    }
}
