// ═══════════════════════════════════════════════════════════════
// Low flybys over water: what a jet's exhaust and wing downwash, a helicopter's rotor wash, a sea-skimming
// missile's sustainer and a seaplane's propwash do to the sea under them.
//
// The air that reaches the water blows over it at some speed u, and the sea answers by speed (the same scale as
// the wind's own: Beaufort / WMO sea-state descriptions): a few m/s raise catspaws of ripples that roughen and
// darken the surface; ~10 m/s and more tear white water and spume off it; ~15 m/s and more throw spray up.
//   • a jet: its exhaust is a free turbulent jet (centre-line speed ≈ 6 D Vj / x, half-angle ~12°, momentum flux =
//     the thrust), so from h metres up it lands x = h / tan(12° + nose-up pitch) behind the nozzle, blowing over
//     the water at u ≈ 11 √(T / (ρ π)) / x (spent faster far downstream: × e^(−x / 400 m)): a fighter tears the
//     water into spray below ~20 m and ripples it up to ~60 m. Under a span or so the wing's downwash reaches the water too:
//     w = 2 m g / (ρ V π b²) (its momentum carries the weight), under the wing and its tip vortices.
//   • a helicopter: momentum theory, v = √(m g / (2 ρ π R²)) through the disc and twice that in the wake, which
//     meets the water as an outwash ring 1–2 radii out, weaker with height (as (0.8 D / h)^1.5: little left beyond
//     ~3 diameters),
//     swept back behind the rotor in forward flight.
//   • a sea-skimming missile: a small turbojet's exhaust, a few kN, 5–15 m up: a faint streak.
// What it leaves (a stamp every few metres along the path, or every 0.2 s from a hovering rotor):
//   foam (white water: bursts within seconds), milk (the cloud of fine bubbles under it: lingers), agitation
//   (ripples: roughness, a darker streak on a smooth sea), drifting with the wind's surface drift (~3 %) and
//   spreading as it ages; a rotor's rings run outward like the real rings of rotor-wash ripples. The stamps are
//   drawn into the ocean's wake map (shipfx.js WakeMap: R foam, G milk, A agitation) and laid on the displaced sea
//   by ocean.js, which also flattens the short waves under fresh agitation (the downwash's pressure) and roughens
//   the surface with ripples. Spray and mist are particles (effects.js smoke): a rooster tail where the exhaust
//   lands, a spray line under the wing tips, a ring of mist round a rotor.
// Everything that moves low over water feeds it: the player's and the AI's aircraft (gear on the water: a
// seaplane's take-off run), helicopters (softtargets.js AIR_TARGETS), cruise and anti-ship missiles
// (strikes.js). The numbers (washMarks, exhaustWash, wingWash, rotorWash, WashField) need no renderer: tests.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { waterHeight, WATER } from './water.js';
import { terrainHeight } from './terraincore.js';
import { AIR_TARGETS } from './softtargets.js';

const RHO = 1.225, G = 9.81;
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// ── The physics ──
// A jet's exhaust (or a propeller's slipstream) meeting the water from h metres up: where it lands behind the nozzle
// (x, m) and how hard it blows over the water there (u, m/s). pitch: nose up (rad); thrustN: newtons.
export function exhaustWash(h, thrustN, pitch = 0) {
    if (!(thrustN > 0) || !(h >= 0)) return { x: 0, u: 0 };
    const ang = clamp(0.21 + pitch, 0.09, 1.45);
    const x = h / Math.tan(ang);
    const k = Math.sqrt(thrustN / (RHO * Math.PI));
    // (far downstream the air's own turbulence, the crosswind and the hot plume's rise spend it faster than a free jet)
    return { x, u: 11 * k / Math.max(x, 4) * Math.exp(-x / 400) };
}
// The wing's downwash at the water (m/s): only within about a span of it (ground effect)
export function wingWash(h, massKg, speed, span) {
    if (!(span > 0) || !(massKg > 0)) return 0;
    const w = 2 * massKg * G / (RHO * Math.max(speed, 30) * Math.PI * span * span);
    return w * smooth(span * 1.6, span * 0.3, h);
}
// A rotor of radius R carrying massKg, its hub h metres over the water, moving at speed (m/s): the outwash at the
// water (u, m/s), the radius of its ring (m) and how far the wake is swept back behind the hub (m)
export function rotorWash(h, massKg, R, speed = 0) {
    if (!(R > 0) || !(massKg > 0) || !(h >= 0)) return { u: 0, ring: 0, back: 0 };
    const vi = Math.sqrt(massKg * G / (2 * RHO * Math.PI * R * R)), D = 2 * R;
    const fwd = smooth(vi, 4 * vi, speed); // in forward flight the wake streams back and spreads
    const u = 2 * vi * Math.min(1, Math.pow(0.8 * D / Math.max(h, 0.5), 1.5)) * (1 - 0.65 * fwd);
    return { u, ring: R * (1.15 + 0.5 * smooth(0, 2 * D, h)), back: h * Math.min(speed / Math.max(2 * vi, 1), 3) };
}
// What wind of u m/s over the water does to it, 0..1 per kind of mark
export function washMarks(u) {
    return {
        agit: smooth(1.2, 8, u),         // ripples, catspaws (roughness)
        foam: smooth(12, 34, u) * 0.75,  // white water, spume (a gust that passes in a moment: patches, not a sheet)
        milk: smooth(9, 26, u) * 0.5,    // the bubbles under it
        spray: smooth(10, 26, u),        // water thrown into the air
    };
}

// ── The marks on the water ──
// e-folding times (s): white foam bursts within seconds (active whitecap foam ~3–4 s), the cloud of fine bubbles
// under it lingers, the ripples die away over several seconds; widths grow as the mark spreads
export const MARK_LIFE = { foam: 3.5, milk: 12, agit: 5.5, max: 30 };
const SPREAD = { streak: 0.6, ring: 2.2 }; // m/s: a streak widens, a rotor's ring of ripples runs outward
export const MAX_STAMPS = 4096;
// one stamp's strength `age` seconds after it was made (into out: foam, milk, agit, width / radius)
export function stampAt(f0, m0, a0, w0, ring, age, out = { foam: 0, milk: 0, agit: 0, w: 0 }) {
    // (each builds up over a moment: the blast takes a fraction of a second to whip the water up)
    out.foam = f0 * (1 - Math.exp(-age / 0.3)) * Math.exp(-age / MARK_LIFE.foam);
    out.milk = m0 * Math.min(1, 0.2 + age / 1.5) * Math.exp(-age / MARK_LIFE.milk);
    out.agit = a0 * (1 - Math.exp(-age / 0.12)) * Math.exp(-age / MARK_LIFE.agit);
    out.w = w0 + age * (ring ? SPREAD.ring : SPREAD.streak);
    return out;
}

// The field of marks: struct-of-arrays stamps, oldest replaced when full
export class WashField {
    constructor(max = MAX_STAMPS) {
        this.max = max;
        this.n = 0;
        this.x = new Float32Array(max); this.z = new Float32Array(max);
        this.ang = new Float32Array(max); this.len = new Float32Array(max); this.w0 = new Float32Array(max);
        this.f0 = new Float32Array(max); this.m0 = new Float32Array(max); this.a0 = new Float32Array(max);
        this.born = new Float64Array(max); this.ring = new Uint8Array(max);
        this.time = 0;
        this._s = { foam: 0, milk: 0, agit: 0, w: 0 };
    }
    // a mark: centre (x, z), heading of travel ang (rad, atan2(dx, dz)), length along it, half-width (or a ring's
    // radius), initial foam / milk / agitation (0..1)
    add(x, z, ang, len, w, foam, milk, agit, ring = false) {
        let i = this.n;
        if (i >= this.max) {
            // full: replace the oldest
            let o = 0, ob = Infinity;
            for (let k = 0; k < this.n; k++) if (this.born[k] < ob) { ob = this.born[k]; o = k; }
            i = o;
        } else this.n++;
        this.x[i] = x; this.z[i] = z; this.ang[i] = ang; this.len[i] = len; this.w0[i] = w;
        this.f0[i] = foam; this.m0[i] = milk; this.a0[i] = agit; this.born[i] = this.time; this.ring[i] = ring ? 1 : 0;
        return i;
    }
    // age everything by dt, drift with (dx, dz) m/s, drop what has faded
    update(dt, driftX = 0, driftZ = 0) {
        this.time += dt;
        const s = this._s;
        for (let i = this.n - 1; i >= 0; i--) {
            const age = this.time - this.born[i];
            stampAt(this.f0[i], this.m0[i], this.a0[i], this.w0[i], this.ring[i], age, s);
            if (age > MARK_LIFE.max || (s.foam < 0.01 && s.milk < 0.01 && s.agit < 0.01)) { this.kill(i); continue; }
            this.x[i] += driftX * dt; this.z[i] += driftZ * dt;
        }
    }
    kill(i) {
        const j = --this.n;
        if (i === j) return;
        for (const a of [this.x, this.z, this.ang, this.len, this.w0, this.f0, this.m0, this.a0, this.born, this.ring]) a[i] = a[j];
    }
    clear() { this.n = 0; }
    // the strongest mark at (x, z) now (for tests and the HUD-less checks): max over stamps of each channel
    sample(x, z, out = { foam: 0, milk: 0, agit: 0 }) {
        out.foam = out.milk = out.agit = 0;
        const s = this._s;
        for (let i = 0; i < this.n; i++) {
            const age = this.time - this.born[i];
            stampAt(this.f0[i], this.m0[i], this.a0[i], this.w0[i], this.ring[i], age, s);
            const dx = x - this.x[i], dz = z - this.z[i];
            let inside;
            if (this.ring[i]) inside = Math.hypot(dx, dz) < s.w * 1.4;
            else {
                const c = Math.cos(this.ang[i]), sn = Math.sin(this.ang[i]);
                const along = dx * sn + dz * c, across = dx * c - dz * sn;
                inside = Math.abs(along) < this.len[i] * 0.5 + s.w * 0.3 && Math.abs(across) < s.w;
            }
            if (!inside) continue;
            out.foam = Math.max(out.foam, s.foam); out.milk = Math.max(out.milk, s.milk); out.agit = Math.max(out.agit, s.agit);
        }
        return out;
    }
}

// ── What flies low: sources, read off the game each frame ──
const _f = new THREE.Vector3(), _b = new THREE.Box3(), _sz = new THREE.Vector3();
const heliRadius = new WeakMap();
function rotorRadius(t) {
    let R = heliRadius.get(t);
    if (R) return R;
    const rotor = t.mesh && t.mesh.userData && t.mesh.userData.rotor;
    R = 7;
    if (rotor) { _b.setFromObject(rotor).getSize(_sz); if (_sz.x > 1) R = Math.max(_sz.x, _sz.z) / 2; }
    heliRadius.set(t, R);
    return R;
}
// a jet's / prop's mass from its size (kg): ~60 kg per m² of span × length (an F-16 ~9 t, a C-130 ~70 t, a 747 ~270 t)
export const massOf = (spec) => 60 * (spec.span || 10) * (spec.length || 12);

// One frame's description of a source: { kind: 'jet' | 'rotor' | 'missile', x, y, z, vx, vz, speed, pitch, thrust (N),
// mass (kg), span (m) or R (m), k (strength scale) }. Returns a list of the sources low over water.
export function lowSources(game, out = []) {
    out.length = 0;
    const lowY = WATER.maxCrest + 160;
    if (game.aircraft) for (const a of game.aircraft) {
        if (!a || a.exploded || !a.pos || a.pos.y > lowY) continue;
        if (a.onGround && !a.onWater) continue; // on a deck, a runway or a beach
        if (!a.spec) continue;
        const m = massOf(a.spec), acc = a.afterburner ? a.thrustAB : (a.thrustMil || 0) * Math.min((a.throttle || 0) / 0.9, 1);
        a.getForward(_f);
        out.push({
            kind: 'jet', src: a, x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: a.vel.x, vz: a.vel.z, speed: Math.hypot(a.vel.x, a.vel.z),
            pitch: Math.asin(clamp(_f.y, -1, 1)), fx: _f.x, fz: _f.z, thrust: a.alive && !a.flameout ? m * (acc || 0) : 0, mass: m, span: a.spec.span || 10,
            k: a.onWater ? 0.45 : 1, // (a hull on the water: its own wake is shipfx's; the propwash adds a little)
        });
    }
    for (const t of AIR_TARGETS) {
        if (!t || t.alive === false || !t.mesh || !t.mesh.visible || !t.mesh.userData || !t.mesh.userData.rotor) continue;
        const p = t.mesh.position;
        if (p.y > lowY) continue;
        const v = t.vel || _f.set(0, 0, 0);
        const civil = /CIVIL/.test(t.name || '');
        out.push({ kind: 'rotor', src: t, x: p.x, y: p.y, z: p.z, vx: v.x, vz: v.z, speed: Math.hypot(v.x, v.z), R: rotorRadius(t), mass: civil ? 3200 : 9500, k: 1 });
    }
    const S = game.strikes;
    if (S && S.missiles) for (const m of S.missiles) {
        if (!m.alive || m.phase === 'launch' || m.phase === 'boost' || !m.pos || m.pos.y > 60) continue;
        if (m.kind !== 'cruise' && m.kind !== 'antiship') continue;
        const sp = Math.hypot(m.vel.x, m.vel.z) || 1;
        out.push({ kind: 'missile', src: m, x: m.pos.x, y: m.pos.y, z: m.pos.z, vx: m.vel.x, vz: m.vel.z, speed: sp, pitch: Math.atan2(m.vel.y, sp), fx: m.vel.x / sp, fz: m.vel.z / sp, thrust: 3500, k: 1 });
    }
    return out;
}

// The aircraft whose reflection in the water is worth a planar pass (ocean.js renderPlanar): flying (not on a deck,
// a runway or the water), over the water near the camera, low enough that its mirror image is near too. Their root
// objects into out.
const _rv = new THREE.Vector3();
export function reflectorsNear(game, cam, out = []) {
    out.length = 0;
    if (!cam) return out;
    const add = (root, pos, size) => {
        if (!root || !pos || root.visible === false) return;
        const h = pos.y - Math.max(WATER.maxCrest, 0);
        if (h < 0.5 || h > 260) return;
        const d = _rv.copy(pos).sub(cam).length();
        // (its mirror image's distance: the reflection must be more than a speck)
        const dm = Math.hypot(pos.x - cam.x, pos.z - cam.z, pos.y + cam.y);
        if (d > 2500 || size / Math.max(dm, 1) < 0.004) return;
        if (terrainHeight(pos.x, pos.z) > -1) return; // over land: no water under it to mirror it
        out.push(root);
    };
    if (game.aircraft) for (const a of game.aircraft) {
        if (!a || a.exploded || (a.onGround && !a.onWater) || a.onWater || !a.root) continue;
        add(a.root, a.pos, a.spec ? a.spec.length || 12 : 12);
    }
    for (const t of AIR_TARGETS) if (t && t.alive !== false && t.mesh && t.mesh.userData && t.mesh.userData.rotor) add(t.mesh, t.mesh.position, 16);
    return out;
}

// What one source does to the water this frame: the marks to stamp and the spray to throw. Returns the strongest
// Fills `hits` with the patches of water it blows on: { kind: 'exhaust' | 'wing' | 'ring', x, z, y (the surface
// there), w (half-width or the ring's radius, m), u (m/s) }.
const water = (x, z) => terrainHeight(x, z) < -0.8;
export function washOf(s, hits) {
    hits.length = 0;
    const surf = water(s.x, s.z) ? waterHeight(s.x, s.z) : NaN;
    if (s.kind === 'rotor') {
        if (!(surf === surf)) return hits;
        const h = s.y - surf, r = rotorWash(h, s.mass, s.R, s.speed);
        if (r.u < 1) return hits;
        const sl = s.speed > 0.5 ? 1 / s.speed : 0;
        hits.push({ kind: 'ring', x: s.x - s.vx * sl * r.back, z: s.z - s.vz * sl * r.back, y: surf, w: r.ring, u: r.u * s.k });
        return hits;
    }
    // exhaust: lands x behind the nozzle along the flight path
    const h0 = s.y - (surf === surf ? surf : 0);
    const ex = exhaustWash(Math.max(h0, 0), s.thrust * s.k, s.pitch);
    if (ex.u > 1) {
        const hx = s.x - s.fx * ex.x, hz = s.z - s.fz * ex.x;
        if (water(hx, hz)) hits.push({ kind: 'exhaust', x: hx, z: hz, y: surf === surf ? surf : 0, w: clamp(Math.max(h0, 0) * 0.75 + 2.5, 2.5, 45), u: ex.u });
    }
    if (s.kind === 'jet' && s.span && surf === surf) {
        const w = wingWash(Math.max(h0, 0), s.mass, s.speed, s.span) * s.k;
        if (w > 1) {
            // the downwash sheet between the tip vortices, half a span behind the wing
            const bx = s.x - s.fx * s.span * 0.5, bz = s.z - s.fz * s.span * 0.5;
            hits.push({ kind: 'wing', x: bx, z: bz, y: surf, w: s.span * 0.55, u: w * 2.2 });
        }
    }
    return hits;
}

// ── Spray: its own particles (the effects' particle system, effects.js, with a texture of fine droplets) ──
// 2×2 atlas in the smoke atlas's format (RG normal, B thickness, A density): a soft cloud of droplets, denser in the
// middle, its edge broken up, the normals from its density (so the sun lights its top)
let sprayTex = null;
function sprayAtlas() {
    if (sprayTex) return sprayTex;
    const S = 64, N = S * 2, data = new Uint8Array(N * N * 4);
    let seed = 91;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const D = new Float32Array(S * S);
    for (let f = 0; f < 4; f++) {
        const ox = (f & 1) * S, oy = (f >> 1) * S;
        // droplets: a few hundred specks of random size over a soft falloff
        D.fill(0);
        const drops = 260 + f * 60;
        for (let k = 0; k < drops; k++) {
            const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.85, px = (0.5 + Math.cos(a) * r * 0.5) * S, py = (0.5 + Math.sin(a) * r * 0.5) * S;
            const rad = 0.6 + rnd() * rnd() * 3.2, amp = 0.35 + rnd() * 0.65;
            for (let y = Math.max(0, Math.floor(py - rad - 1)); y < Math.min(S, py + rad + 1); y++) for (let x = Math.max(0, Math.floor(px - rad - 1)); x < Math.min(S, px + rad + 1); x++) {
                const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / rad;
                if (d < 1) D[y * S + x] = Math.min(1, D[y * S + x] + amp * (1 - d * d));
            }
        }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v);
            const haze = Math.max(0, 1 - r) ** 2 * 0.55, win = smooth(1, 0.75, r);
            const d = Math.min(1, (D[y * S + x] * 0.6 + haze)) * win;
            D[y * S + x] = d;
        }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const hx = D[y * S + Math.min(x + 1, S - 1)] - D[y * S + Math.max(x - 1, 0)], hy = D[Math.min(y + 1, S - 1) * S + x] - D[Math.max(y - 1, 0) * S + x];
            let nx = -hx * 2, ny = -hy * 2;
            const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
            const i = ((oy + y) * N + ox + x) * 4;
            data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255;
            data[i + 2] = D[y * S + x] * 200; data[i + 3] = D[y * S + x] * 255;
        }
    }
    sprayTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    sprayTex.generateMipmaps = true;
    sprayTex.minFilter = THREE.LinearMipmapLinearFilter;
    sprayTex.magFilter = THREE.LinearFilter;
    sprayTex.needsUpdate = true;
    return sprayTex;
}

// ── The manager: sources → stamps and spray; stamps → an instanced mesh in the wake map ──
const STAMP_VS = /* glsl */`
    attribute vec4 iA;  // x, z, heading, length
    attribute vec4 iB;  // half-width (radius), foam, milk, agitation
    attribute vec2 iC;  // ring, age
    varying vec2 vUv;
    varying vec4 vM;
    varying vec2 vW;
    varying vec2 vC;
    void main() {
        vUv = position.xy;            // -1..1
        vM = iB; vC = iC;
        float c = cos(iA.z), s = sin(iA.z);
        vec2 q = iC.x > 0.5 ? position.xy * iB.x * 1.6 : vec2(position.x * iB.x, position.y * (iA.w * 0.5 + iB.x * 0.35));
        // local x across, y along the heading (+z when heading 0)
        vec2 w = vec2(iA.x + q.x * c + q.y * s, iA.y - q.x * s + q.y * c);
        vW = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 0.0, w.y, 1.0);
    }`;
const STAMP_FS = /* glsl */`
    uniform sampler2D foamMap;
    varying vec2 vUv;
    varying vec4 vM;
    varying vec2 vW;
    varying vec2 vC;
    void main() {
        float shape, foamShape;
        // broken, lacy white water (the ocean adds the fine lace), streaked along the path; ragged edges
        float n = texture2D(foamMap, vW / 23.0 + vC.y * 0.013).g * 0.6 + texture2D(foamMap, vW / 7.0).r * 0.4;
        float m = texture2D(foamMap, vW / 61.0 + 0.37).g;
        if (vC.x > 0.5) {
            // a rotor's ring: ripples strongest in a band round the ring radius (r = 1 / 1.6 of the quad), a calmer,
            // flattened eye under the hub, spray-whitened water at the ring's rim
            float r = length(vUv) * 1.6;
            shape = exp(-pow((r - 1.0) / 0.32, 2.0)) + 0.35 * (1.0 - smoothstep(0.0, 0.9, r));
            foamShape = exp(-pow((r - 0.95) / 0.22, 2.0));
            shape *= 1.0 - smoothstep(1.45, 1.6, r);
        } else {
            float ac = abs(vUv.x) * (0.8 + 0.45 * m), al = abs(vUv.y);
            shape = (1.0 - smoothstep(0.35, 1.0, ac)) * (1.0 - smoothstep(0.6, 1.0, al));
            foamShape = (1.0 - smoothstep(0.2, 0.85, ac)) * (1.0 - smoothstep(0.5, 1.0, al));
        }
        float foam = vM.y * foamShape * smoothstep(0.45, 0.8, n + vM.y * 0.25);
        // (the gusts' ripples are patchy too: catspaws)
        float agit = vM.w * shape * (0.55 + 0.6 * smoothstep(0.25, 0.75, n * 0.5 + m * 0.5));
        gl_FragColor = vec4(clamp(foam, 0.0, 1.0), clamp(vM.z * shape, 0.0, 1.0), 0.0, clamp(agit, 0.0, 1.0));
    }`;

export class FlybyWakes {
    constructor(foamTex = null) {
        this.field = new WashField();
        this.sources = [];
        this.hits = [];
        this.state = new WeakMap(); // per source: last stamp position, spray accumulators
        this.mesh = null;
        this.foamTex = foamTex;
        this.wind = { x: 0, z: 0 };
        this.active = 0;            // sources disturbing the water this frame
        this._s = { foam: 0, milk: 0, agit: 0, w: 0 };
    }

    // the instanced stamp mesh for the wake map (made on first use: tests never need it)
    makeMesh() {
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        const M = MAX_STAMPS;
        this.iA = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.iB = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.iC = new THREE.InstancedBufferAttribute(new Float32Array(M * 2), 2).setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('iA', this.iA); g.setAttribute('iB', this.iB); g.setAttribute('iC', this.iC);
        g.instanceCount = 0;
        const mat = new THREE.ShaderMaterial({
            uniforms: { foamMap: { value: this.foamTex } }, vertexShader: STAMP_VS, fragmentShader: STAMP_FS,
            depthTest: false, depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
            blendEquationAlpha: THREE.MaxEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
        });
        this.mesh = new THREE.Mesh(g, mat);
        this.mesh.frustumCulled = false;
        this.mesh.name = 'waterwake:stamps';
        return this.mesh;
    }

    clear() { this.field.clear(); if (this.mesh) this.mesh.geometry.instanceCount = 0; if (this.sys) this.sys.clear(); }

    // the spray's particles: the effects' own particle system class (effects.js), lit like the smoke, with droplets that
    // streak along their fall
    spraySystem(fx) {
        if (this.sys !== undefined) return this.sys;
        this.sys = null;
        try {
            const PS = fx.smoke.constructor;
            this.sys = new PS(fx.scene, 5000, { texture: sprayAtlas(), lit: true, atlas: true, stretch: true, renderOrder: 6, wind: 1, light: fx.lightU });
            this.sys.mesh.name = 'waterwake:spray';
            // A puff's billboard dips into the sea it rose from, and the water's depth would cut it along a hard line:
            // the spray thins out toward the surface instead (by its height above the mean sea, a fraction of its size)
            const m = this.sys.mat, vA = 'mv.xy += q;', fA = 'float a = t.a * vCol.a;';
            if (m.vertexShader.includes(vA) && m.fragmentShader.includes(fA)) {
                m.vertexShader = m.vertexShader.replace('void main() {', 'varying vec2 vSea;\n    void main() {')
                    .replace(vA, vA + ' vSea = vec2((inverse(viewMatrix) * mv).y, size);');
                m.fragmentShader = m.fragmentShader.replace('void main() {', 'varying vec2 vSea; uniform float seaY;\n    void main() {')
                    .replace(fA, fA + ' a *= smoothstep(seaY, seaY + max(1.0, vSea.y * 0.3), vSea.x);');
                m.uniforms.seaY = this.seaY = { value: 0 };
            }
        } catch (e) { this.sys = null; }
        return this.sys;
    }

    // dt: seconds; game: the running game (aircraft, AIR_TARGETS, strikes, effects, wind)
    update(dt, game) {
        if (!(dt > 0)) { this.upload(); return; }
        const F = this.field, wind = game && game.wind;
        // the surface drift: ~3 % of the wind (Stokes drift and the wind's own drag on the surface)
        this.wind.x = wind ? wind.x * 0.03 : 0; this.wind.z = wind ? wind.z * 0.03 : 0;
        F.update(dt, this.wind.x, this.wind.z);
        const fx = game && game.effects;
        const sys = fx && fx.smoke && fx.scene ? this.spraySystem(fx) : null;
        if (sys) { sys.update(dt, (game.scene && game.scene.fog) || FOG0, fx.wind); if (this.seaY) this.seaY.value = WATER.maxCrest * 0.35; }
        this.active = 0;
        for (const s of lowSources(game, this.sources)) {
            const hits = washOf(s, this.hits);
            if (!hits.length) continue;
            let st = this.state.get(s.src);
            if (!st) { st = { last: new Map(), spray: 0, mist: 0, t: 0 }; this.state.set(s.src, st); }
            st.t += dt;
            for (const hit of hits) {
                const mk = washMarks(hit.u);
                if (mk.agit < 0.02) continue;
                this.active++;
                this.stamp(st, s, hit, mk);
                if (mk.spray > 0.01 && (sys || (fx && fx.smoke))) this.spray(sys || fx.smoke, st, s, hit, mk, dt);
            }
        }
        this.upload();
    }

    // lay marks along the patch's path: one every ~0.6 of its width, or every 0.2 s from a rotor hovering
    stamp(st, s, hit, mk) {
        const F = this.field, key = hit.kind;
        const last = st.last.get(key);
        const ring = hit.kind === 'ring';
        const step = ring ? Math.max(hit.w * 0.5, 3) : Math.max(hit.w * 0.6, 3);
        const ang = Math.atan2(s.vx, s.vz);
        if (last && F.time - last.t < 1.0) {
            const d = Math.hypot(hit.x - last.x, hit.z - last.z);
            if (ring ? (d < step && F.time - last.t < 0.2) : d < step) return;
            if (!ring && d < 600) {
                // fill the gap since the last mark (a fast jet covers several marks' worth in a frame)
                const n = Math.min(Math.ceil(d / step), 40);
                for (let k = 1; k <= n; k++) {
                    const f = k / n;
                    F.add(last.x + (hit.x - last.x) * f, last.z + (hit.z - last.z) * f, ang, d / n * 1.6, hit.w, mk.foam, mk.milk, mk.agit, false);
                }
                st.last.set(key, { x: hit.x, z: hit.z, t: F.time });
                return;
            }
        }
        F.add(hit.x, hit.z, ang, step * 1.6, hit.w, mk.foam, mk.milk, mk.agit, ring);
        st.last.set(key, { x: hit.x, z: hit.z, t: F.time });
    }

    // spray and mist: a rooster tail where the exhaust lands, spray lines under the wing tips, a ring of mist round a rotor
    spray(sm, st, s, hit, mk, dt) {
        const sp = mk.spray;
        const ring = hit.kind === 'ring';
        // (a fast jet spreads its spray over more water: the rate goes with the path flown, ~1.3 particles a metre)
        const rate = ring ? 150 : Math.max(hit.kind === 'wing' ? 100 : 160, s.speed * (hit.kind === 'wing' ? 0.6 : 1.3));
        st.spray += rate * sp * dt * (s.kind === 'missile' ? 0.3 : 1);
        const V = _vv, P = _pp;
        const back = s.speed > 1 ? 1 / s.speed : 0;
        while (st.spray >= 1) {
            st.spray -= 1;
            const r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
            if (ring) {
                const a = r1 * Math.PI * 2, rr = hit.w * (0.85 + 0.45 * r2);
                P.set(hit.x + Math.cos(a) * rr, hit.y + 0.4, hit.z + Math.sin(a) * rr);
                const out = (5 + 10 * r3) * (0.5 + 0.5 * sp);
                V.set(Math.cos(a) * out + s.vx * 0.3, 1.5 + 4 * r2 * sp, Math.sin(a) * out + s.vz * 0.3);
                const big = r3 < 0.4;
                if (big) sm.emit(P, V, 3 + 3 * r1, 4, 14 + 12 * sp, MIST0, MIST1, 0.08 + 0.16 * sp, 0, 1.2, -0.3, 0, 0.5, 0.4, 0);
                else sm.emit(P, V, 1 + r1, 1.5, 4, DROP0, DROP1, 0.4 + 0.4 * sp, 0, 0.6, -8, 0, 0.5, 0.4, 0.05);
                continue;
            }
            // across the patch, a little ahead/behind
            const across = (r1 - 0.5) * 2 * hit.w * (hit.kind === 'wing' ? 1 : 0.6);
            const cx = s.fz, cz = -s.fx; // right of the flight path (in xz)
            P.set(hit.x + cx * across - s.vx * back * (r2 * 6), hit.y + 0.5, hit.z + cz * across - s.vz * back * (r2 * 6));
            // the rooster tail: where the exhaust lands it throws a sheet of water up and back, tens of metres when it
            // blows hard (its middle the highest); under the wing the downwash only lifts a low spray
            const mid = 1 - Math.abs(r1 - 0.5) * 2;
            const up = hit.kind === 'exhaust' ? (4 + (10 + 34 * mid * mid) * Math.pow(r3, 1.2) * sp) * (0.4 + 0.6 * sp) : 2 + 6 * r3 * sp;
            // a little of the aircraft's speed (the air its wake drags along), soon lost: the plume stays where it rose
            const drag = 0.04 + 0.08 * r2;
            V.set(s.vx * drag + cx * (r1 - 0.5) * 12, up, s.vz * drag + cz * (r1 - 0.5) * 12);
            const mist = r3 < 0.45;
            if (mist) sm.emit(P, V, 3 + 4 * r2, 4 + 3 * sp, 14 + 22 * sp, MIST0, MIST1, 0.14 + 0.24 * sp, 0, 2.6, 0.3, 0, 0.5, 0.3, 0);
            else sm.emit(P, V, 1.2 + 1.3 * r2, 1.4 + 1.2 * sp, 3 + 4 * sp, DROP0, DROP1, 0.45 + 0.4 * sp, 0, 1.7, -9.5, 0, 0.5, 0.8, 0.06);
        }
    }

    // stamps → instance buffers (age and strength resolved here, so the shader only shapes them)
    upload() {
        if (!this.mesh) return;
        const F = this.field, A = this.iA.array, B = this.iB.array, C = this.iC.array, s = this._s;
        for (let i = 0; i < F.n; i++) {
            const age = F.time - F.born[i];
            stampAt(F.f0[i], F.m0[i], F.a0[i], F.w0[i], F.ring[i], age, s);
            A[i * 4] = F.x[i]; A[i * 4 + 1] = F.z[i]; A[i * 4 + 2] = F.ang[i]; A[i * 4 + 3] = F.len[i];
            B[i * 4] = s.w; B[i * 4 + 1] = s.foam; B[i * 4 + 2] = s.milk; B[i * 4 + 3] = s.agit;
            C[i * 2] = F.ring[i]; C[i * 2 + 1] = age;
        }
        for (const a of [this.iA, this.iB, this.iC]) {
            a.clearUpdateRanges();
            if (F.n) { a.addUpdateRange(0, F.n * a.itemSize); a.needsUpdate = true; }
        }
        this.mesh.geometry.instanceCount = F.n;
        this.mesh.visible = F.n > 0;
    }

    dispose() {
        if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
        if (this.sys) { this.sys.mesh.removeFromParent(); this.sys.geo.dispose(); this.sys.mat.dispose(); this.sys = undefined; }
    }
}
const _vv = new THREE.Vector3(), _pp = new THREE.Vector3();
const MIST0 = [0.93, 0.95, 0.98], MIST1 = [0.86, 0.89, 0.93], DROP0 = [0.95, 0.97, 1], DROP1 = [0.88, 0.92, 0.96];
const FOG0 = { color: new THREE.Color(0.75, 0.82, 0.9), density: 0 };
