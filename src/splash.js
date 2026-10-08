// ═══════════════════════════════════════════════════════════════
// Water impacts: what rounds, shells, rockets, bombs, missiles, wreckage and crashing aircraft do when they hit the
// sea or a lake.
//
// Rounds (round / spout): a thin white spout per round, sized to the calibre (spoutHeight: a rifle bullet's under a
// metre, 20 mm 3–6 m, 30 mm up to ~7 m), shooting up fast and falling back with a puff of mist, a crown of drops round
// its foot and a small ring of boiling, rippled water in the wake map; a strafing run walks a line of them. Below
// about 7° (ricochets: the critical angle of a spinning round on water, Johnson & Reid's 18°/√(ρ/ρw) for a sphere,
// ~6–9° for bullets) a round skips off the surface, a low feather of spray thrown forward, and flies on, slowed
// and tumbling up: tracers seen glancing off the sea in gun-camera film. Pooled: a frame's spouts are budgeted
// (SPLASH_QUALITY) and the far ones thinned, so hundreds of rounds a second cost a few hundred particles.
// Charges (blast): a column scaled by the charge (blastSplash: H ≈ 13.5 W^⅓ m for W kg TNT at the depth that throws it
// highest, about half that for a burst on the surface), as filmed in US Navy underwater-detonation and SINKEX
// footage: a white spray dome over a burst below the surface, then plumes of jets punching through it, a crown of
// spray, the column standing a few seconds and collapsing into a base surge of mist rolling out over the water,
// droplets raining back down for seconds after, a dark churned slick that lasts tens of seconds, a ring of shock
// racing out and the gravity waves following it, a muffled flash under the water (and its light at night), and
// the surface itself heaving up over the burst and ringing out in waves (ocean.js heave). A 500 lb bomb throws its
// column ~50 m up, a heavy cruise or ballistic missile's warhead 60–100 m, a ton under a keel ~130 m.
// Impacts (impact): things that hit the water without a charge throw a splash scaled by their energy (debris, a
// wreck, a crashing jet: a long sheet of spray thrown along its path, a fuel fire on the water and a foam patch).
// Particles: two systems of the effects' own kind (effects.js ParticleSystem): droplets (streaked along their flight,
// the spray texture of waterwake.js) and mist (the smoke's lit puffs), both thinning out at the sea surface; they're
// lent to waterwake.js for the low flybys' spray too. Marks go into the ocean's wake map (waterwake.js WashField:
// KIND splash / slick / wave), the heave into ocean.js (setHeaves), the sound into audio.js (waterSlap, waterBoom).
// The numbers (gunCalibre, spoutHeight, roundSplash, ricochets, blastSplash, impactKg, the budget) need no renderer.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { waterHeight, WATER } from './water.js';
import { terrainHeight } from './terraincore.js';
import { fbm } from './noise.js';
import { KIND, sprayAtlas, seaFade } from './waterwake.js';

const G = 9.81;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

// ── Sizes ──
// a gun's calibre (mm) from its name in config.js ('M61 20mm', '2× ADEN 30mm', 'Type 23-III': 23)
export function gunCalibre(name) {
    const s = String(name || '');
    const m = /(\d+(?:\.\d+)?)\s*mm/i.exec(s) || /\b(\d{2})-/.exec(s);
    return m ? +m[1] : 20;
}
// the on-foot weapons (arsenal.js): their rounds
export const SMALL_ARMS_CAL = { ak47: 7.62, m4a1: 5.56, m870: 8.4, m9: 9, deagle: 12.7 };
// a round in flight (weapons.js): its own calibre, a small-arms weapon's, or a heavy machine gun's
export function roundCalibre(b) {
    if (b.cal) return b.cal;
    if (b.small && b.def) return SMALL_ARMS_CAL[b.def.id] || 7.62;
    return 12.7;
}
// The real guns' rates of fire (rounds/s): config.js fires fewer, heavier rounds, so each of those stands for a few
// real ones in the water (a burst from an M61 is a 100-round-a-second sheet of spouts)
export function gunRealRate(name) {
    const n = String(name || '');
    return /M61/.test(n) ? 100 : /GAU-8/.test(n) ? 65 : /GAU-22/.test(n) ? 55 : /GSh-30/.test(n) ? 30 : /BK-27/.test(n) ? 28
        : /GIAT/.test(n) ? 40 : /GSh-23|Type 23/.test(n) ? 55 : /M39/.test(n) ? 50 : /DEFA|ADEN/.test(n) ? 42 : 0;
}
// How high (m) a round's spout stands: about 0.2 cal^1.1 for a cannon shell going in steeply at ~900 m/s (20 mm
// 5.5 m, 30 mm 8.5 m: the shell's cavity collapsing throws a jet up, an HE shell's burst more), less than that for
// rifle bullets (a slender, slow round makes a narrow, low jet: 7.62 mm ~1 m), lower and leaning over along its path
// when it goes in at a shallow angle (sinA: sine of the angle below the horizon; 20 mm ~4 m in a 12° strafe)
export function spoutHeight(cal, speed = 900, sinA = 1) {
    const c = Math.max(cal, 4);
    let h = 0.2 * Math.pow(c, 1.11) * (c < 15 ? Math.pow(c / 15, 0.8) : 1);
    h *= clamp(Math.sqrt(speed / 900), 0.45, 1.2);
    return h * (0.55 + 0.45 * smooth(0.05, 0.5, sinA));
}
export function roundSplash(cal, speed = 900, sinA = 1) {
    const h = spoutHeight(cal, speed, sinA);
    return {
        h,                                      // the spout's height (m)
        r: 0.07 * h + 0.012 * cal,              // its width (m)
        ring: 0.3 * h + 0.25,                   // the ring of disturbed water round it (m)
        lean: 1 - smooth(0.1, 0.6, sinA),       // how far it leans over along the round's path
        drops: clamp(Math.round(3 + h * 0.9), 2, 12),
        he: cal >= 20,                          // an explosive shell: a pinprick flash as it goes in
    };
}
// Does a round skip off the water? Below the critical angle (~5–9°, r01 picks where in it) a fast round ricochets
export function ricochets(sinA, speed, cal, r01 = 0.5) {
    if (cal >= 57 || !(speed > 250)) return false;
    return sinA < Math.sin((5 + 4 * r01) * Math.PI / 180);
}
// How deep a charge goes off: the column's height against the best depth (a burst on the surface spends most of
// itself in the air; a delay-fuzed bomb or a shell a few metres down throws the classic column; a torpedo or depth
// charge at its best depth the tallest; deep down only a dome and a low, wide plume)
export const DEPTH = { contact: 0.55, impact: 0.42, shell: 0.8, shallow: 0.85, optimal: 1, deep: 0.45 };
// The splash of W kg of TNT (equivalent) going off at `depth`, or `agl` metres over the water (a burst in the air only
// dimples the surface and throws a ring of spray: nothing left past a few W^⅓ metres)
export function blastSplash(kg, depth = 'contact', agl = 0) {
    const W = Math.max(kg || 0, 0.01), w3 = Math.cbrt(W);
    let f = DEPTH[depth] ?? DEPTH.contact;
    if (agl > 0) f *= Math.exp(-agl / (1.1 * w3 + 0.5));
    const H = Math.min(13.5 * w3 * f, 240);
    const R = 0.22 * H + 0.6 * w3 + 0.5;
    const under = depth === 'shallow' || depth === 'optimal' || depth === 'deep';
    return {
        kg: W, H, R,
        tTop: Math.sqrt(2 * H / G),                 // the column's rise (s)
        dome: under && agl <= 0 ? R * 1.5 : 0,      // the spray dome over a burst below the surface (its radius, m)
        surge: H > 6 ? 1.1 * H + 8 : 0,             // how far the base surge rolls out (m)
        surgeV: 0.6 * Math.sqrt(G * H * 0.5),       // and how fast it starts out (m/s)
        slick: 0.75 * H + 2 * w3 + 2,               // the churned slick's radius (m)
        slickLife: 15 + 0.5 * H,                    // s
        heave: H > 8 ? 0.05 * H : 0,                // the surface heaving up over it (m)
        flash: agl > 0 ? 0 : depth === 'contact' ? 1 : depth === 'shell' ? 0.7 : depth === 'shallow' ? 0.45 : depth === 'optimal' ? 0.25 : depth === 'deep' ? 0.12 : 0,
        fire: agl > 0 ? 0 : depth === 'contact' ? 0.6 : depth === 'shell' ? 0.35 : depth === 'shallow' ? 0.12 : 0, // how much of a fireball shows
    };
}
// a kinetic impact's energy as kg of TNT (4.184 MJ/kg): what a wreck or a crashing jet throws up
export const impactKg = (massKg, speed) => 0.5 * massKg * speed * speed / 4.184e6;
// the charges (kg TNT equivalent): a 500 lb Mk 82 (87 kg tritonal), AIM-9 / AIM-120 / SA-6 class warheads' fill, a
// Hydra rocket, a HARM, an RPG-7 grenade, an M67
export const WARHEAD_KG = { bomb: 93, aam: 8, missile: 8, lrm: 10, sam: 25, rkt: 1.2, arm: 30, rpg: 0.73, grenade: 0.18 };
// a naval or artillery shell's burster and its own energy, as kg (76 mm ~1.5, 127 mm ~7, 155 mm ~13)
export const shellKg = (cal) => 3.5 * Math.pow(cal / 100, 3);
// effects.js explosion(size) → kg (a missile's 0.8 ~3 kg, a bomb's 2.4 ~80 kg)
export const explosionKg = (size) => 6 * size * size * size;

// ── Quality: particle budgets, the gun splashes a frame may draw in full, stamps, the heave ──
export const SPLASH_QUALITY = {
    low: { k: 0.4, drops: 2500, jets: 900, mist: 900, spouts: 14, every: 3, heave: 0 },
    medium: { k: 0.65, drops: 4500, jets: 1500, mist: 1600, spouts: 28, every: 2, heave: 2 },
    high: { k: 1, drops: 7000, jets: 2400, mist: 2600, spouts: 48, every: 1, heave: 4 },
    ultra: { k: 1.3, drops: 9000, jets: 3000, mist: 3400, spouts: 72, every: 1, heave: 4 },
};
const MAX_DROPS = 9000, MAX_JETS = 3000, MAX_MIST = 3400;
const GUN_SHARE = 0.55; // (rounds may fill this share of the droplets: a long burst never starves a bomb's column)

// (spray is a far better diffuser than smoke: brighter than white albedo under the smoke's lighting, the sunlit side
// near the bloom threshold, the shaded side a pale sky-blue grey)
const DROP0 = [1.5, 1.53, 1.58], DROP1 = [1.3, 1.35, 1.42], MIST0 = [1.58, 1.61, 1.66], MIST1 = [1.36, 1.4, 1.47];
const SURGE0 = [1.4, 1.43, 1.48], SURGE1 = [1.16, 1.2, 1.27], GLOW = [0.55, 0.85, 1], FOG0 = { color: new THREE.Color(0.75, 0.82, 0.9), density: 0 };
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _at = new THREE.Vector3();

// Clouds of spray (a column's body and head, the base surge, the mist hanging over a burst of spouts): 2×2 atlas in the
// smoke atlas's format. Softer than the smoke's cauliflower puffs: a few overlapping lobes broken up by fine fractal
// detail, the edge going to droplets, so many of them overlapping read as one mass of spray, not a pile of balls.
let mistTex = null;
export function mistAtlas() {
    if (mistTex) return mistTex;
    const S = 128, N = S * 2, data = new Uint8Array(N * N * 4), D = new Float32Array(S * S);
    let seed = 311;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let f = 0; f < 4; f++) {
        const ox = (f & 1) * S, oy = (f >> 1) * S;
        const lobes = [];
        for (let k = 0; k < 5 + f; k++) { const a = rnd() * 6.28, d = rnd() * 0.32; lobes.push([Math.cos(a) * d, Math.sin(a) * d, 0.16 + rnd() * 0.16]); }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v);
            let b = 0;
            for (const [lx, ly, ls] of lobes) { const dx = u - lx, dy = v - ly; b += Math.exp(-(dx * dx + dy * dy) / (2 * ls * ls)); }
            b = Math.min(b, 1.4);
            const n = fbm(u * 2.6 + f * 9.1, v * 2.6 - f * 3.7, 4) * 0.5 + 0.5, fine = fbm(u * 9 + f * 5.3, v * 9 + 1.7, 2) * 0.5 + 0.5;
            let d = b * (0.5 + 0.8 * n) * (0.8 + 0.4 * fine) - 0.12;
            d = Math.max(0, Math.min(1, d * 1.15)) * smooth(1, 0.78, r);
            D[y * S + x] = d;
        }
        // droplets round the edge
        for (let k = 0; k < 140; k++) {
            const a = rnd() * 6.28, rr = 0.45 + rnd() * 0.45, px = (0.5 + Math.cos(a) * rr * 0.5) * S, py = (0.5 + Math.sin(a) * rr * 0.5) * S;
            const rad = 0.6 + rnd() * rnd() * 2.2, amp = 0.3 + rnd() * 0.6;
            for (let y = Math.max(0, Math.floor(py - rad - 1)); y < Math.min(S, py + rad + 1); y++) for (let x = Math.max(0, Math.floor(px - rad - 1)); x < Math.min(S, px + rad + 1); x++) {
                const dd = Math.hypot(x + 0.5 - px, y + 0.5 - py) / rad;
                const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
                if (dd < 1) D[y * S + x] = Math.min(1, D[y * S + x] + amp * (1 - dd * dd) * smooth(1, 0.85, Math.hypot(u, v)));
            }
        }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const hx = D[y * S + Math.min(x + 1, S - 1)] - D[y * S + Math.max(x - 1, 0)], hy = D[Math.min(y + 1, S - 1) * S + x] - D[Math.max(y - 1, 0) * S + x];
            let nx = -hx * 2.2, ny = -hy * 2.2;
            const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
            const i = ((oy + y) * N + ox + x) * 4, d = D[y * S + x];
            data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = d * 230; data[i + 3] = d * 255;
        }
    }
    mistTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    mistTex.generateMipmaps = true;
    mistTex.minFilter = THREE.LinearMipmapLinearFilter;
    mistTex.magFilter = THREE.LinearFilter;
    mistTex.needsUpdate = true;
    return mistTex;
}

// Jets of water (a spout, the plumes in a column): 2×2 atlas in the smoke atlas's format (RG normal, B thickness,
// A density). Drawn stretched along the particle's flight (tail v = 0 .. head v = 1): a few wavering strands side by
// side, thicker toward the head, breaking up into drops there; soft at both ends.
let jetTex = null;
export function jetAtlas() {
    if (jetTex) return jetTex;
    const S = 64, N = S * 2, data = new Uint8Array(N * N * 4), D = new Float32Array(S * S);
    let seed = 177;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let f = 0; f < 4; f++) {
        const ox = (f & 1) * S, oy = (f >> 1) * S;
        D.fill(0);
        // strands of water, fanning out a little toward the head, each a soft wavering line
        const strands = 7 + f * 2;
        for (let k = 0; k < strands; k++) {
            const x0 = (rnd() - 0.5) * 0.3, w0 = 0.022 + rnd() * 0.04, ph = rnd() * 6.28, amp = 0.01 + rnd() * 0.03, a0 = 0.5 + 0.5 * rnd();
            const fan = 0.4 + rnd() * 0.8, v0 = rnd() * 0.25;
            for (let y = 0; y < S; y++) {
                const v = (y + 0.5) / S;
                if (v < v0) continue;
                const cx = 0.5 + x0 * (1 + fan * v) + Math.sin(v * 7 + ph) * amp * (0.3 + v), w = w0 * (0.6 + v * 1.2);
                for (let x = 0; x < S; x++) {
                    const d = ((x + 0.5) / S - cx) / w;
                    if (d * d < 9) D[y * S + x] += Math.exp(-d * d) * a0 * (0.7 + 0.3 * rnd()) * smooth(v0, v0 + 0.2, v);
                }
            }
        }
        // drops breaking off round the head and along the sides
        for (let k = 0; k < 90; k++) {
            const px = (0.5 + (rnd() - 0.5) * (0.35 + 0.35 * rnd())) * S, py = (0.35 + rnd() * 0.62) * S, rad = 0.5 + rnd() * rnd() * 2, amp = 0.4 + rnd() * 0.6;
            for (let y = Math.max(0, Math.floor(py - rad - 1)); y < Math.min(S, py + rad + 1); y++) for (let x = Math.max(0, Math.floor(px - rad - 1)); x < Math.min(S, px + rad + 1); x++) {
                const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / rad;
                if (d < 1) D[y * S + x] += amp * (1 - d * d);
            }
        }
        // a rounded jet: soft across (no edge), the tail thinning out, the head bursting
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S - 0.5, v = (y + 0.5) / S, wa = 0.12 + 0.12 * v;
            D[y * S + x] = Math.min(1, D[y * S + x]) * Math.exp(-(u / wa) * (u / wa)) * smooth(0, 0.22, v) * smooth(1, 0.82, v) * smooth(0.5, 0.42, Math.abs(u));
        }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const hx = D[y * S + Math.min(x + 1, S - 1)] - D[y * S + Math.max(x - 1, 0)], hy = D[Math.min(y + 1, S - 1) * S + x] - D[Math.max(y - 1, 0) * S + x];
            let nx = -hx * 1.5, ny = -hy * 1.5;
            const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
            const i = ((oy + y) * N + ox + x) * 4, d = D[y * S + x];
            data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = d * 220; data[i + 3] = Math.min(1, d * 1.7) * 255;
        }
    }
    jetTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    jetTex.generateMipmaps = true;
    jetTex.minFilter = THREE.LinearMipmapLinearFilter;
    jetTex.magFilter = THREE.LinearFilter;
    jetTex.needsUpdate = true;
    return jetTex;
}

// ═══════════════════════════════════════════════════════════════
export class WaterFX {
    // fx: the Effects (effects.js); its `game` (set by game.js) gives the wake map, the ocean, the audio and the camera
    constructor(fx) {
        this.fx = fx;
        this.Q = SPLASH_QUALITY.high;
        this.quality = 'high';
        this.drops = null; this.jets = null; this.mist = null; this._built = false;
        this.events = [];        // delayed parts of a splash (rain, collapse and surge, the cloud left hanging)
        this.heaves = [];        // the surface heaving over recent blasts (ocean.js)
        this.now = 0;
        this.frameSpouts = 0;    // rounds splashed this frame (the budget)
        this.rounds = 0;         // all rounds in, ever (the stamp cadence)
        this.stats = { spouts: 0, thinned: 0, skipped: 0, skips: 0, blasts: 0, stamps: 0 };
        this.seaY = null;
    }

    setQuality(q) { this.quality = SPLASH_QUALITY[q] ? q : 'high'; this.Q = SPLASH_QUALITY[this.quality]; }

    // the particle systems, made on first use (the effects' own class; tests stub `emit`)
    ready() {
        if (this._built) return this.drops ? this : null;
        this._built = true;
        const fx = this.fx;
        if (fx && fx.smoke && fx.scene && fx.smoke.constructor && fx.smoke.mat) {
            try {
                const PS = fx.smoke.constructor, L = fx.lightU;
                // the effects' light, except from below: over the sea the light coming up is the water's (a dim
                // blue-grey), not the land's green the hemisphere light gives the smoke
                this.lightU = { sunDirV: L.sunDirV, sunCol: L.sunCol, ambTop: L.ambTop, ambBot: { value: new THREE.Color() } };
                const light = this.lightU;
                this.drops = new PS(fx.scene, MAX_DROPS, { texture: sprayAtlas(), lit: true, atlas: true, stretch: true, renderOrder: 6, wind: 1, light });
                this.jets = new PS(fx.scene, MAX_JETS, { texture: jetAtlas(), lit: true, atlas: true, stretch: true, renderOrder: 6, wind: 0.5, light });
                this.mist = new PS(fx.scene, MAX_MIST, { texture: mistAtlas(), lit: true, atlas: true, renderOrder: 6, wind: 1, light });
                this.drops.mesh.name = 'splash:drops'; this.jets.mesh.name = 'splash:jets'; this.mist.mesh.name = 'splash:mist';
                this.seaY = [seaFade(this.drops), seaFade(this.jets), seaFade(this.mist)];
            } catch (e) { this.drops = this.jets = this.mist = null; }
        } else if (fx && fx.drops && fx.mist) { this.drops = fx.drops; this.mist = fx.mist; this.jets = fx.jets || fx.drops; } // (tests: stub systems)
        return this.drops ? this : null;
    }
    get game() { return this.fx && this.fx.game; }
    get field() { const g = this.game; return g && g.naval && g.naval.fx && g.naval.fx.flyby ? g.naval.fx.flyby.field : null; }
    camPos() { const g = this.game; return g && g.camera ? g.camera.position : null; }

    // emit into a system under its cap for this quality (rounds only up to their share of the droplets)
    put(sys, cap, pos, vel, life, s0, s1, c0, c1, a0, a1, drag, grav, spin, stretch) {
        if (!sys || sys.count >= cap) return false;
        sys.emit(pos, vel, life, s0, s1, c0, c1, a0, a1, drag, grav, 0, 0.5, spin, stretch);
        return true;
    }
    dropCap(gun) { return Math.min(MAX_DROPS, Math.round(this.Q.drops * (gun ? GUN_SHARE : 1))); }
    mistCap(gun) { return Math.min(MAX_MIST, Math.round(this.Q.mist * (gun ? GUN_SHARE : 1))); }
    jetCap(gun) { return Math.min(MAX_JETS, Math.round(this.Q.jets * (gun ? GUN_SHARE : 1))); }

    // ── Rounds ──
    // A round (weapons.js bullet) that went below the surface this step, from prev: its spout, or its skip. Returns
    // true when it skipped off and flies on (b changed: back at the surface, slowed, glancing up).
    round(b, prev) {
        const v = b.vel, speed = v.length();
        if (!(speed > 1)) return false;
        // where it crossed the surface
        const y0 = prev.y, y1 = b.pos.y, f = y0 > y1 ? clamp(y0 / (y0 - y1), 0, 1) : 1;
        const at = _at.lerpVectors(prev, b.pos, f);
        at.y = 0;
        const sinA = clamp(-v.y / speed, 0, 1), cal = roundCalibre(b);
        // shells: a small column of their own
        if (cal >= 57) { this.blast(at, { kg: shellKg(cal), depth: 'shell', vel: v, sound: 'shell' }); return false; }
        if ((b.skips || 0) < 2 && ricochets(sinA, speed, cal, Math.random())) {
            this.spout(at, v, cal, { skip: true });
            // off it goes: the vertical speed mostly lost and turned up, ~a third of the speed gone, a little yaw
            const k = rand(0.55, 0.75), yaw = rand(-0.07, 0.07), c = Math.cos(yaw), s = Math.sin(yaw);
            const vx = v.x * k, vz = v.z * k;
            v.set(vx * c - vz * s, Math.abs(v.y) * rand(0.25, 0.5) + speed * k * rand(0.01, 0.04), vx * s + vz * c);
            b.pos.copy(at).setY(0.05);
            b.skips = (b.skips || 0) + 1;
            this.stats.skips++;
            return true;
        }
        this.spout(at, v, cal, b.rep > 1 ? { rep: b.rep } : NO_OPTS);
        return false;
    }

    // A round's splash at `at` (on the surface): vel its velocity (or null: straight down), cal its calibre (mm).
    // o.skip: a ricochet's low feather instead of a spout; o.rep: how many real rounds it stands for (a gun's real
    // rate over the game's: the others go in round it, a cluster where the burst's dispersion spreads them)
    spout(at, vel, cal = 20, o = {}) {
        const Q = this.Q;
        this.frameSpouts++; this.rounds++; this.stats.spouts++;
        const speed = vel ? vel.length() : 600, sinA = vel && speed > 1 ? clamp(-vel.y / speed, 0, 1) : 1;
        const S = roundSplash(cal, speed, o.skip ? 0.05 : sinA);
        const cam = this.camPos();
        const dist = cam ? Math.hypot(at.x - cam.x, at.y - cam.y, at.z - cam.z) : 300;
        // the budget: past this frame's share only a token splash, well past it none (the stamp still goes in)
        let k = 1;
        if (this.frameSpouts > Q.spouts * 3) k = 0;
        else if (this.frameSpouts > Q.spouts) k = 0.3;
        // and the far ones thinner (a spout 4 km off is a pixel or two)
        k *= dist > 7000 ? 0 : dist > 3500 ? 0.3 : dist > 1500 ? 0.6 : 1;
        if (k < 1) this.stats.thinned++;
        const rep = o.skip || k < 0.6 ? 1 : clamp(Math.round(o.rep || 1), 1, 6);
        const W = this.ready();
        if (k > 0 && W) {
            const dC = this.dropCap(true), mC = this.mistCap(true), jC = this.jetCap(true);
            // the round's direction over the water (the spout leans along it)
            let hx = 0, hz = 0;
            if (vel && speed > 1) { const hs = Math.hypot(vel.x, vel.z) || 1; hx = vel.x / hs; hz = vel.z / hs; }
            const v0 = Math.sqrt(2 * G * S.h) * 1.12;
            const lean = o.skip ? 1.4 : S.lean * 0.5;
            const w = S.h * 0.16 + S.r * 0.8, spread = 0.8 + S.h * 0.35;
            for (let r = 0; r < rep; r++) {
                // (the rest of the cluster round the first, each a little smaller)
                const P = r ? _p.set(at.x + rand(-1, 1) * spread + hx * rand(-1, 1.5) * spread, at.y, at.z + rand(-1, 1) * spread + hz * rand(-1, 1.5) * spread) : at;
                const kr = r ? rand(0.6, 0.95) : 1;
                // the spout's body: a white jet of water standing up out of the sea, its head bursting into spray, falling
                // back on itself (a few strands, the fastest the tallest)
                const nb = r ? 2 : k >= 0.6 ? (o.skip ? 2 : S.h > 1.5 ? 5 : 3) : 1;
                for (let i = 0; i < nb; i++) {
                    const vu = v0 * kr * (nb === 1 ? 0.85 : 0.55 + 0.5 * i / (nb - 1)) * (o.skip ? 0.6 : 1);
                    _v.set(hx * vu * lean * 0.8 + rand(-0.05, 0.05) * vu, vu * (o.skip ? 0.6 : 1), hz * vu * lean * 0.8 + rand(-0.05, 0.05) * vu);
                    this.put(this.jets, jC, P, _v, 2 * vu / G * 0.88 + 0.2, w * kr, w * kr * 2.2, DROP0, DROP1, 1, 0.4, 0.35, -G, 0.1, 0.32);
                }
                // and the spray off it: streaks of drops flung up and out
                const n = r ? 2 : Math.max(1, Math.round(S.drops * k * Q.k * (o.skip ? 0.7 : 1)));
                for (let i = 0; i < n; i++) {
                    const u = o.skip ? rand(0.35, 0.7) : rand(0.62, 1.08), vu = v0 * u * kr;
                    _v.set(hx * vu * lean + rand(-0.11, 0.11) * vu, vu * (o.skip ? 0.55 : 1), hz * vu * lean + rand(-0.11, 0.11) * vu);
                    const sz = S.r * rand(1.2, 2);
                    this.put(this.drops, dC, P, _v, 2 * vu / G * (o.skip ? 0.7 : 0.9) + 0.15, sz, sz * 2, DROP0, DROP1, 1, 0.1, 0.3, -G, 0.4, 0.14);
                }
            }
            if (k >= 0.6 && !o.skip) {
                // the top of it, a burst of white spray hanging a moment
                const vu = v0 * 0.92;
                _v.set(hx * vu * lean * 0.8, vu, hz * vu * lean * 0.8);
                this.put(this.mist, mC, at, _v, 2 * vu / G * 0.9 + 0.3, S.h * 0.14 + S.r, S.h * 0.5 + S.r, MIST0, MIST1, 0.85, 0, 0.5, -G * 0.88, 0.2, 0);
                // a crown of drops thrown out round its foot
                const nc = Math.round((2 + S.h * 0.4) * Q.k);
                for (let i = 0; i < nc; i++) {
                    const a = Math.random() * Math.PI * 2, vu = v0 * rand(0.3, 0.5);
                    _v.set(Math.cos(a) * vu * 0.8, vu, Math.sin(a) * vu * 0.8);
                    this.put(this.drops, dC, at, _v, 2 * vu / G + 0.1, S.r * 0.9, S.r * 1.5, DROP0, DROP1, 0.8, 0, 0.4, -G, 0.4, 0.06);
                }
            }
            if (k >= 0.6) {
                // the mist it leaves hanging over the water, drifting: a burst's spouts build a cloud of it
                _p.set(at.x + hx * S.h * 0.3, at.y + S.h * 0.2, at.z + hz * S.h * 0.3);
                _v.set(hx * 1.5 * S.lean, Math.sqrt(2 * G * S.h) * 0.3, hz * 1.5 * S.lean);
                this.put(this.mist, mC, _p, _v, rand(2.2, 3.4), S.r * 3 + 0.4, Math.max(S.h * (1 + 0.15 * rep), 1), MIST0, MIST1, 0.32, 0, 1.5, -0.8, 0.3, 0);
            }
            // an explosive round: a pinprick of fire as it goes in (some of them)
            if (S.he && !o.skip && k >= 0.6 && dist < 3000 && Math.random() < 0.45 && this.fx.fire) {
                this.fx.fire.emit(at, _v.set(0, 2, 0), 0.08, 0.8 + cal * 0.04, 1.6 + cal * 0.07, [3.4, 2.4, 1.2], [1.6, 0.6, 0.15], 1, 0, 0, 0);
            }
        }
        // the ring of boiling, rippled water in the wake map (every round, or every few on lower settings)
        const F = this.field;
        if (F && (this.rounds % Q.every === 0 || cal >= 25) && this.frameSpouts <= Q.spouts * 4 && dist < 9000) {
            if (o.skip) {
                const ang = vel ? Math.atan2(vel.x, vel.z) : 0;
                F.add(at.x, at.z, ang, 3 + S.h, S.ring * 0.6, 0.55, 0.3, 0.6, KIND.streak, STAMP_SKIP);
            } else F.add(at.x, at.z, 0, 0, S.ring * (rep > 1 ? 1.4 : 1), 0.8, 0.5, 0.9, KIND.splash, STAMP_ROUND);
            this.stats.stamps++;
        }
        // the slap (the nearest few: audio.js keeps it to a few dozen a second)
        const g = this.game;
        if (g && g.audio && g.audio.waterSlap && dist < 700 && k > 0) g.audio.waterSlap(dist, cal);
    }

    // ── Charges ──
    // A charge going off in the water (or just over it): pos where (its y the height over the water, if it's over
    // it), o: { kg (TNT), depth (DEPTH key), agl, vel, sound: 'full' | 'shell' | 'hiss' | false, fireball: false to draw
    // none (the caller's explosion did) }
    blast(pos, o = {}) {
        const x = pos.x, z = pos.z;
        const sea = waterHeight(x, z);
        const agl = o.agl ?? Math.max(0, pos.y - sea);
        const P = blastSplash(o.kg ?? 8, o.depth || 'contact', agl > 1.5 ? agl : 0);
        this.stats.blasts++; this.last = { x, z, t: this.now, H: P.H };
        if (P.H < 0.8) return P;
        const at = _at.set(x, sea, z);
        const Q = this.Q, q = Q.k, s = Math.sqrt(P.H / 50);
        const W = this.ready();
        const fx = this.fx;
        // the flash: a fireball on the surface for a contact burst (the water swallows most of it), a muffled glow
        // under it for a deeper one, and its light (firelight.js: at night it lights the column and the low cloud)
        if (P.fire > 0 && o.fireball !== false && fx.explosion) fx.explosion(_p.set(x, sea + 1.5, z), clamp(Math.cbrt(P.kg / 6) * P.fire * 0.8, 0.25, 2), null, { noWater: true, quench: true });
        if (P.flash > 0 && fx.sprite && fx.flashTex) {
            const glow = Math.cbrt(P.kg);
            fx.sprite(fx.flashTex, _p.set(x, sea + 1.2, z), P.R * 2.2, 0.22 + 0.04 * glow, 0.5, 0.35 + 0.35 * P.flash, P.fire > 0.3 ? [1, 0.9, 0.75] : GLOW);
            if (fx.light) fx.light(_p.set(x, sea - 1, z), 18 * glow * P.flash, 0.3 + 0.05 * glow, { color: P.fire > 0.3 ? undefined : GLOW, cloud: 0.8, merge: 15 });
        }
        if (W) this.column(at, P, s, q, o.vel);
        // what follows, in its own time
        if (W && P.H > 4) {
            this.events.push({ kind: 'rain', t: this.now + P.tTop * 0.55, end: this.now + P.tTop * 2.6, x, z, y: sea, P, acc: 0, n: 200 * s * q });
            this.events.push({ kind: 'hang', t: this.now + P.tTop * 0.9, x, z, y: sea, P, s, q });
            if (P.surge > 0) this.events.push({ kind: 'surge', t: this.now + P.tTop * 1.2, end: this.now + P.tTop * 1.2 + 1.2, x, z, y: sea, P, acc: 0, n: 64 * s * q, stamped: false });
        }
        if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
        // the water: a churned slick, the shock racing out, waves following it
        const F = this.field;
        if (F) {
            F.add(x, z, 0, 0, P.slick * 0.45, 1, 0.95, 0.45, KIND.slick, { life: P.slickLife / 9, spread: P.slick * 0.55 / 3.5, tau: 3.5, shade: 0.42 });
            if (P.H > 3) {
                F.add(x, z, 0, 0, P.R * 0.5, 0.45, 0.1, 1, KIND.wave, { life: 0.4, spread: 45 + P.H * 0.4, tau: 0.8 });
                const lam = 2.5 * P.R, cp = Math.sqrt(G * lam / (2 * Math.PI));
                F.add(x, z, 0, 0, P.R * 0.9, 0.25, 0.05, 0.9, KIND.wave, { life: 2.6, spread: cp, tau: 0 });
                F.add(x, z, 0, 0, P.R * 0.5, 0.15, 0.03, 0.7, KIND.wave, { life: 2.2, spread: cp * 0.7, tau: 0 });
            }
            this.stats.stamps += 4;
        }
        // the surface heaving over it (ocean.js)
        if (P.heave > 0 && Q.heave > 0) this.addHeave(x, z, P);
        // the sound: a deep, muffled whoomp (or a shell's crack), the roar of the column, the long hiss of it falling back
        const g = this.game, cam = this.camPos();
        if (g && g.audio && g.audio.waterBoom && o.sound !== false && cam) g.audio.waterBoom(Math.hypot(x - cam.x, sea - cam.y, z - cam.z), P.H / 50, o.sound || 'full', P.tTop);
        return P;
    }

    // the column at the moment of the burst: the dome, the jets, the column's body, the crown and the skirt of spray
    column(at, P, s, q, vel) {
        const R = P.R, H = P.H, vTop = Math.sqrt(2 * G * H) * 1.12;
        const dC = this.dropCap(false), mC = this.mistCap(false), jC = this.jetCap(false);
        const D = this.drops, M = this.mist;
        // (a moving charge's splash is thrown on along its path a little: a missile into the sea at a slant)
        let lx = 0, lz = 0;
        if (vel) { const sp = vel.length(); if (sp > 1) { const hs = Math.hypot(vel.x, vel.z) / sp; lx = vel.x / sp * hs * 0.25; lz = vel.z / sp * hs * 0.25; } }
        // the spray dome: a white hemisphere of spalled water heaving up over a burst under the surface
        if (P.dome > 0) {
            const n = Math.round(34 * s * q);
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, e = rand(0.25, 1.45), c = Math.cos(e);
                const sp = Math.sqrt(2 * G * H * 0.22) * rand(0.6, 1);
                _d.set(Math.cos(a) * c, Math.sin(e), Math.sin(a) * c);
                _p.copy(at).addScaledVector(_d, R * 0.3);
                _v.copy(_d).multiplyScalar(sp);
                this.put(M, mC, _p, _v, rand(0.9, 1.6), R * 0.45, R * 1.1, MIST0, MIST1, 0.95, 0, 1.8, -G * 0.6, 0.4, 0);
            }
        }
        // the trunk: great streaks of water shooting up out of the sea side by side, drawn long along their flight (they
        // shorten and fatten as they slow at the top and stretch out again falling back)
        const nt = Math.max(4, Math.round(12 * s * Math.sqrt(q)));
        for (let i = 0; i < nt; i++) {
            const a = Math.random() * Math.PI * 2, rr = R * 0.35 * Math.sqrt(Math.random()), e = rand(0, 0.08);
            const vu = vTop * rand(0.55, 1.02);
            _p.set(at.x + Math.cos(a) * rr, at.y - R * 0.3, at.z + Math.sin(a) * rr);
            _v.set(Math.cos(a) * Math.sin(e) * vu + lx * vu, Math.cos(e) * vu, Math.sin(a) * Math.sin(e) * vu + lz * vu);
            const w = R * rand(0.4, 0.62);
            this.put(this.jets, jC, _p, _v, 2 * vu / G * 0.92, w, w * 1.6, MIST0, MIST1, 1, 0.45, 0.08, -G, 0.05, 0.55);
        }
        // the column's body: dense white spray rising, a shell of it from the surface to the top at any moment, falling
        // back on itself; the fastest of it billowing out at the head
        const nc = Math.round(60 * s * q);
        for (let i = 0; i < nc; i++) {
            const head = i % 3 === 0, u = head ? rand(0.85, 1.04) : Math.sqrt(rand(0.03, 1)), vu = vTop * u;
            const a = Math.random() * Math.PI * 2, rr = R * 0.45 * Math.sqrt(Math.random());
            _p.set(at.x + Math.cos(a) * rr, at.y + 0.5, at.z + Math.sin(a) * rr);
            const out = rr / R * vu * (head ? 0.3 : 0.16) + rand(0, 1.5);
            _v.set(Math.cos(a) * out + lx * vu, vu, Math.sin(a) * out + lz * vu);
            const life = 2 * vu / G * 0.95 + rand(0.3, 0.9);
            this.put(M, mC, _p, _v, life, R * rand(0.4, 0.6), R * (head ? rand(1, 1.4) : rand(0.8, 1.1)), MIST0, MIST1, 1, 0.35, 0.12, -G * 0.92, 0.3, 0);
        }
        // the jets punching up through it: streaks of spray, some flung out at an angle
        const nj = Math.round(170 * s * q);
        for (let i = 0; i < nj; i++) {
            const e = Math.min(rand(0, 0.45) * rand(0.3, 1.2), 0.55), a = Math.random() * Math.PI * 2;
            const vu = vTop * rand(0.5, 1.12);
            _v.set(Math.cos(a) * Math.sin(e) * vu + lx * vu, Math.cos(e) * vu, Math.sin(a) * Math.sin(e) * vu + lz * vu);
            const rr = R * 0.45 * Math.sqrt(Math.random());
            _p.set(at.x + Math.cos(a) * rr, at.y + 0.3, at.z + Math.sin(a) * rr);
            if (i % 4) { const sz = R * rand(0.12, 0.26); this.put(this.jets, jC, _p, _v, 2 * _v.y / G * 0.92 + 0.2, sz, sz * 2.2, DROP0, DROP1, 1, 0.3, 0.1, -G, 0.1, 0.36); }
            else { const sz = R * rand(0.07, 0.14); this.put(D, dC, _p, _v, 2 * _v.y / G * 0.92 + 0.2, sz, sz * 2.2, DROP0, DROP1, 0.95, 0.1, 0.1, -G, 0.2, 0.22); }
        }
        // the crown: a sheet of spray thrown up and out at 30–60° round the column's foot
        const nr = Math.round((40 + 30 * (P.crown || 0)) * s * q);
        for (let i = 0; i < nr; i++) {
            const a = (i / nr) * Math.PI * 2 + rand(-0.1, 0.1), e = rand(0.5, 1.05);
            const vu = vTop * rand(0.32, 0.6);
            _v.set(Math.cos(a) * Math.cos(e) * vu, Math.sin(e) * vu, Math.sin(a) * Math.cos(e) * vu);
            _p.set(at.x + Math.cos(a) * R * 0.6, at.y + 0.3, at.z + Math.sin(a) * R * 0.6);
            if (i % 4 === 0) this.put(M, mC, _p, _v, 2 * _v.y / G + 0.6, R * 0.3, R * 0.75, MIST0, MIST1, 0.8, 0, 0.6, -G * 0.8, 0.4, 0);
            else if (i % 4 === 1) this.put(this.jets, jC, _p, _v, 2 * _v.y / G + 0.3, R * rand(0.08, 0.13), R * 0.25, DROP0, DROP1, 1, 0.1, 0.25, -G, 0.1, 0.25);
            else this.put(D, dC, _p, _v, 2 * _v.y / G + 0.3, R * rand(0.06, 0.11), R * 0.2, DROP0, DROP1, 0.9, 0.1, 0.25, -G, 0.3, 0.16);
        }
        // the skirt: spray blown out low over the water by the blast
        const nk = Math.round(24 * s * q);
        for (let i = 0; i < nk; i++) {
            const a = Math.random() * Math.PI * 2, sp = rand(10, 24) * s;
            _v.set(Math.cos(a) * sp, rand(1, 4), Math.sin(a) * sp);
            _p.set(at.x + Math.cos(a) * R * 0.7, at.y + 0.8, at.z + Math.sin(a) * R * 0.7);
            this.put(M, mC, _p, _v, rand(2.5, 4.5), R * 0.35, R * 1.1, MIST0, SURGE1, 0.6, 0, 1.4, 0.2, 0.3, 0);
        }
    }

    // a burst's delayed parts (update)
    runEvent(e, dt) {
        const P = e.P, R = P.R, H = P.H;
        const dC = this.dropCap(false), mC = this.mistCap(false);
        if (e.kind === 'rain') {
            // the droplets still coming down out of the column long after it fell: a curtain of streaks
            e.acc += e.n * dt / Math.max(e.end - e.t, 0.1);
            while (e.acc >= 1) {
                e.acc -= 1;
                const a = Math.random() * Math.PI * 2, rr = R * 1.3 * Math.sqrt(Math.random()), y = H * rand(0.25, 0.85);
                _p.set(e.x + Math.cos(a) * rr, e.y + y, e.z + Math.sin(a) * rr);
                const vy = -rand(5, 12);
                _v.set(rand(-1, 1), vy, rand(-1, 1));
                this.put(this.drops, dC, _p, _v, y / -vy * 0.9 + 0.2, R * rand(0.03, 0.06), R * 0.07, DROP0, DROP1, 0.6, 0.35, 0.2, -G * 0.3, 0.1, 0.12);
            }
            return this.now >= e.end;
        }
        if (e.kind === 'hang') {
            // the cloud of fine spray the column leaves hanging where its top was, settling and drifting off
            const n = Math.round(20 * e.s * e.q);
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, rr = R * 0.8 * Math.random();
                _p.set(e.x + Math.cos(a) * rr, e.y + H * rand(0.35, 0.85), e.z + Math.sin(a) * rr);
                _v.set(Math.cos(a) * rand(0.5, 2), rand(-2.5, -0.5), Math.sin(a) * rand(0.5, 2));
                this.put(this.mist, mC, _p, _v, rand(6, 11), R * 0.9, R * 2.2, MIST0, SURGE1, 0.5, 0, 0.7, 0.05, 0.2, 0);
            }
            return true;
        }
        if (e.kind === 'surge') {
            // the column coming down: the base surge, a ring of mist rolling out over the water
            if (!e.stamped) {
                e.stamped = true;
                const F = this.field;
                if (F) F.add(e.x, e.z, 0, 0, P.slick * 0.7, 1, 0.7, 0.8, KIND.slick, { life: P.slickLife / 11, spread: P.slick * 0.5 / 4, tau: 4, shade: 0.3 });
            }
            e.acc += e.n * dt / Math.max(e.end - e.t, 0.1);
            while (e.acc >= 1) {
                e.acc -= 1;
                const a = Math.random() * Math.PI * 2, rr = R * rand(0.5, 1.1);
                _p.set(e.x + Math.cos(a) * rr, e.y + rand(1, R * 0.5), e.z + Math.sin(a) * rr);
                const sp = P.surgeV * rand(0.7, 1.3);
                _v.set(Math.cos(a) * sp, rand(0.5, 3), Math.sin(a) * sp);
                this.put(this.mist, mC, _p, _v, rand(9, 17), R * rand(0.5, 0.75), R * rand(1.8, 2.6), SURGE0, SURGE1, 0.62, 0, 0.32, 0.25, 0.25, 0);
            }
            return this.now >= e.end;
        }
        return true;
    }

    // ── Impacts without a charge ──
    // o: { size (the old waterSplash scale: 8 size³ kg), or mass (kg) and speed (m/s); vel; foam: true for a patch }
    impact(pos, o = {}) {
        const kg = o.size != null ? 8 * o.size * o.size * o.size : impactKg(o.mass || 100, o.speed || 30);
        return this.blast(pos, { kg, depth: 'impact', vel: o.vel, sound: o.sound ?? (kg > 2 ? 'hiss' : false), agl: 0 });
    }
    // A crashing aircraft (aircraft.js): its energy into a long sheet of spray along its path, the fuel going up on the
    // water, a foam and fuel patch left behind
    crash(ac) {
        const p = ac.pos, v = ac.vel, sp = v.length(), m = ac.spec ? 60 * (ac.spec.span || 10) * (ac.spec.length || 12) : 9000;
        const P = this.blast(_d.copy(p), { kg: impactKg(m, Math.max(sp, 40)) * 0.7, depth: 'impact', vel: v, sound: 'hiss', agl: 0 });
        const fx = this.fx;
        // the fuel: a fireball on the water if it hit hard
        if (sp > 50 && fx.explosion) fx.explosion(_p.set(p.x, waterHeight(p.x, p.z) + 2, p.z), clamp(m / 9000, 0.6, 2.2), null, { noWater: true });
        // a sheet thrown on ahead along its path
        const W = this.ready(), hs = Math.hypot(v.x, v.z);
        if (W && hs > 20) {
            const n = Math.round(60 * this.Q.k * clamp(sp / 120, 0.4, 1.5)), dC = this.dropCap(false), mC = this.mistCap(false);
            for (let i = 0; i < n; i++) {
                const side = rand(-1, 1), f = rand(0.15, 0.45);
                _v.set(v.x * f + v.z / hs * side * 12, rand(4, 18) * clamp(sp / 120, 0.5, 1.4), v.z * f - v.x / hs * side * 12);
                _p.set(p.x + rand(-3, 3), waterHeight(p.x, p.z) + 0.5, p.z + rand(-3, 3));
                if (i % 3) this.put(this.drops, dC, _p, _v, rand(1.5, 3), 0.8, 2.2, DROP0, DROP1, 0.9, 0, 0.5, -G, 0.3, 0.12);
                else this.put(this.mist, mC, _p, _v, rand(3, 6), 3, 12, MIST0, MIST1, 0.7, 0, 0.9, -1, 0.3, 0);
            }
        }
        this.slick(p.x, p.z, Math.max(P.slick, (ac.spec && ac.spec.length) || 15), 60, 0.5);
    }
    // a patch of foam and darker water (a sinking ship's, a crash's fuel and foam)
    slick(x, z, r, life = 60, shade = 0.45) {
        const F = this.field;
        if (!F) return;
        F.add(x, z, 0, 0, r * 0.6, 0.9, 1, 0.3, KIND.slick, { life: life / 10, spread: r * 0.4 / 6, tau: 6, shade });
    }

    // ── The surface heaving over a blast (ocean.js setHeaves) ──
    addHeave(x, z, P) {
        const Hv = this.heaves, max = this.Q.heave;
        const h = { x, z, born: this.now, amp: Math.min(P.heave, 8), R: P.R, lam: 2.5 * P.R, life: 18 + P.H * 0.2 };
        if (Hv.length >= max) { let o = 0; for (let i = 1; i < Hv.length; i++) if (Hv[i].born < Hv[o].born) o = i; Hv[o] = h; } else Hv.push(h);
    }

    update(dt, camera, fog) {
        this.now += dt;
        this.frameSpouts = 0;
        for (let i = this.events.length - 1; i >= 0; i--) {
            const e = this.events[i];
            if (this.now < e.t) continue;
            if (this.runEvent(e, dt)) this.events.splice(i, 1);
        }
        for (let i = this.heaves.length - 1; i >= 0; i--) if (this.now - this.heaves[i].born > this.heaves[i].life) this.heaves.splice(i, 1);
        const g = this.game, oc = g && g.world && g.world.ocean;
        if (oc && oc.setHeaves) oc.setHeaves(this.heaves, this.now);
        if (this.drops && this.drops.update) {
            const f = fog || FOG0, w = this.fx.wind;
            this.drops.update(dt, f, w); this.mist.update(dt, f, w); if (this.jets !== this.drops) this.jets.update(dt, f, w);
            if (this.seaY) for (const u of this.seaY) if (u) u.value = WATER.maxCrest * 0.35;
            if (this.lightU) { const t = this.lightU.ambTop.value; this.lightU.ambBot.value.setRGB(t.r * 0.62, t.g * 0.72, t.b * 0.82); }
        }
        void camera; void terrainHeight;
    }

    clear() {
        this.events.length = 0; this.heaves.length = 0;
        if (this.drops && this.drops.clear) { this.drops.clear(); this.mist.clear(); if (this.jets && this.jets.clear && this.jets !== this.drops) this.jets.clear(); }
        const g = this.game, oc = g && g.world && g.world.ocean;
        if (oc && oc.setHeaves) oc.setHeaves(this.heaves, this.now);
    }
}
// (a round's ring: quick, small; a skip's feather: a short streak)
const STAMP_ROUND = { life: 0.55, spread: 1.1, tau: 2.2 }, STAMP_SKIP = { life: 0.5, spread: 0.4, tau: 2 };
const NO_OPTS = {};
