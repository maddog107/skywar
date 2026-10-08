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
//   the surface with ripples. Spray and mist are particles (splash.js's water particles, or effects.js smoke): a
//   rooster tail where the exhaust lands, a V of spray thrown up under a fast jet by its pressure field
//   (pressureWash: a transonic pass over a calm sea), a spray line under the wing tips, a ring of mist round a
//   rotor (and the cloud it pulls up round a helicopter hovering low), and a long mist trail that hangs behind.
//   How strong, for a fighter at military power and ~290 m/s (lowPassWash): a faint mist and a darker streak
//   from ~40 m, a plain trail at 30 m, a solid rooster tail below ~20 m that keeps growing below 15 m.
// Over dry land the same air raises dust instead (dust, by what the ground is: groundKind): sand off a beach, dirt
// and dry grass, leaves and grass cuttings over fields and forest, grit off rock, powder snow high up.
// Everything that moves low feeds it: the player's and the AI's aircraft (gear on the water: a seaplane's
// take-off run), helicopters (softtargets.js AIR_TARGETS), cruise and anti-ship missiles (strikes.js). The numbers
// (washMarks, exhaustWash, pressureWash, wingWash, rotorWash, lowPassWash, WashField) need no renderer: tests.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { waterHeight, WATER } from './water.js';
import { terrainHeight } from './terraincore.js';
import { fbm } from './noise.js';
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
// The aircraft's own pressure field on the water right under it (m/s of equivalent wind): the air it pushes aside
// and pulls down round the fuselage and wing, q (L / h)^2.4 of a body length L at h metres (a near field that dies
// off within a few lengths), swollen near the speed of sound (Prandtl-Glauert, 1 / sqrt(1 - M^2), held at 3.5 past
// M 0.95: the shock reaching the water). Why a fast jet low over a calm sea throws the sheet of spray seen in
// photos of transonic passes (the Hornet and Mirage "Mach wakes") even before its exhaust touches the water.
export function pressureWash(h, speed, length, mach = speed / 340) {
    if (!(speed > 0) || !(length > 0) || !(h >= 0)) return 0;
    const pg = mach < 0.95 ? 1 / Math.sqrt(1 - mach * mach) : 3.5;
    const k = Math.sqrt(PRESS_K * pg);
    // (in ground effect it can't blow harder than a fraction of the airspeed: the pressure under a wing is about q)
    return speed * Math.min(k * Math.pow(length / Math.max(h, 2), 1.2), 0.25 * Math.sqrt(pg)) * (1 - smooth(4 * length, 7 * length, h));
}
const PRESS_K = 0.006;
// What wind of u m/s over the water does to it, 0..1 per kind of mark (spray goes on growing with u: the sheet
// thrown up gets taller and thicker past the point where the water is all torn up, `power`)
export function washMarks(u) {
    return {
        agit: smooth(1.2, 8, u),         // ripples, catspaws (roughness)
        foam: smooth(12, 34, u) * 0.75,  // white water, spume (a gust that passes in a moment: patches, not a sheet)
        milk: smooth(9, 26, u) * 0.5,    // the bubbles under it
        spray: smooth(5, 36, u),         // water thrown into the air
        shade: smooth(3, 16, u) * 0.3,   // the darker, flattened streak (its glitter blown off)
        power: clamp(u / 40, 0, 2.5),    // how hard: the rooster tail's height and bulk
    };
}
// How hard a low pass blows on the water under it, all told (tests and the HUD-less checks): a jet's exhaust, its
// pressure field and (within a span) its wing's downwash, as the equivalent wind u (m/s) and the spray it throws (0..1).
// thrustN: newtons, speed m/s, size: { span, length, mass }
export function lowPassWash(h, thrustN, speed, size = {}, pitch = 0) {
    const L = size.length || 15, b = size.span || 11, m = size.mass || 60 * b * L;
    const ex = exhaustWash(h, thrustN, pitch).u, pr = pressureWash(h, speed, L), wg = wingWash(h, m, speed, b) * 2.2;
    const u = Math.sqrt(ex * ex + pr * pr + wg * wg);
    return { u, exhaust: ex, pressure: pr, wing: wg, spray: washMarks(u).spray };
}

// ── The marks on the water ──
// e-folding times (s): white foam bursts within seconds (active whitecap foam ~3–4 s), the cloud of fine bubbles
// under it lingers, the ripples die away over several seconds; widths grow as the mark spreads
export const MARK_LIFE = { foam: 3.5, milk: 12, agit: 5.5, max: 30 };
const SPREAD = { streak: 0.6, ring: 2.2 }; // m/s: a streak widens, a rotor's ring of ripples runs outward
export const MAX_STAMPS = 4096;
// The kinds of mark (WashField.ring): a streak along a path, a rotor's ring of ripples, the small ring a round leaves
// where it went in, the slick over a blast (a disc of churned, darkened water), a ring of waves running out (the
// blast's shock and the gravity waves after it). splash.js makes the last three.
export const KIND = { streak: 0, rotor: 1, splash: 2, slick: 3, wave: 4 };
// one stamp's strength `age` seconds after it was made (into out: foam, milk, agit, width / radius, shade).
// lk scales its lifetimes (a blast's slick lasts many times a gust's), sp is its spread (m/s; < 0: the kind's own),
// slowing over tau seconds when tau > 0; sh0 its shade (darker water: the flattened streak, a slick)
export function stampAt(f0, m0, a0, w0, ring, age, out = { foam: 0, milk: 0, agit: 0, w: 0, shade: 0 }, lk = 1, sp = -1, tau = 0, sh0 = 0) {
    // (each builds up over a moment: the blast takes a fraction of a second to whip the water up)
    const L = lk > 0 ? lk : 1;
    out.foam = f0 * (1 - Math.exp(-age / 0.3)) * Math.exp(-age / (MARK_LIFE.foam * L));
    out.milk = m0 * Math.min(1, 0.2 + age / 1.5) * Math.exp(-age / (MARK_LIFE.milk * L));
    out.agit = a0 * (1 - Math.exp(-age / 0.12)) * Math.exp(-age / (MARK_LIFE.agit * L));
    out.shade = sh0 ? sh0 * Math.min(1, age / 0.4) * Math.exp(-age / (MARK_LIFE.agit * 1.4 * L)) : 0;
    const v = sp >= 0 ? sp : ring ? SPREAD.ring : SPREAD.streak;
    out.w = w0 + (tau > 0 ? v * tau * (1 - Math.exp(-age / tau)) : age * v);
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
        this.born = new Float64Array(max); this.ring = new Uint8Array(max); // (the kind: KIND)
        this.lk = new Float32Array(max); this.sp = new Float32Array(max); this.tau = new Float32Array(max); this.sh = new Float32Array(max);
        this.arrays = [this.x, this.z, this.ang, this.len, this.w0, this.f0, this.m0, this.a0, this.born, this.ring, this.lk, this.sp, this.tau, this.sh];
        this.time = 0;
        this._s = { foam: 0, milk: 0, agit: 0, w: 0, shade: 0 };
    }
    // a mark: centre (x, z), heading of travel ang (rad, atan2(dx, dz)), length along it, half-width (or a ring's
    // radius), initial foam / milk / agitation (0..1); ring: true (a rotor's ring) or a KIND; o: { life (scale),
    // spread (m/s), tau (s), shade (0..1) }
    add(x, z, ang, len, w, foam, milk, agit, ring = false, o = null) {
        let i = this.n;
        if (i >= this.max) {
            // full: replace the oldest
            let k0 = 0, ob = Infinity;
            for (let k = 0; k < this.n; k++) if (this.born[k] < ob) { ob = this.born[k]; k0 = k; }
            i = k0;
        } else this.n++;
        this.x[i] = x; this.z[i] = z; this.ang[i] = ang; this.len[i] = len; this.w0[i] = w;
        this.f0[i] = foam; this.m0[i] = milk; this.a0[i] = agit; this.born[i] = this.time;
        this.ring[i] = typeof ring === 'number' ? ring : ring ? KIND.rotor : KIND.streak;
        this.lk[i] = o && o.life || 1; this.sp[i] = o && o.spread != null ? o.spread : -1; this.tau[i] = o && o.tau || 0; this.sh[i] = o && o.shade || 0;
        return i;
    }
    // stamp i now (into the scratch object)
    at(i, s = this._s) {
        return stampAt(this.f0[i], this.m0[i], this.a0[i], this.w0[i], this.ring[i] === KIND.rotor, this.time - this.born[i], s, this.lk[i], this.sp[i], this.tau[i], this.sh[i]);
    }
    // age everything by dt, drift with (dx, dz) m/s, drop what has faded
    update(dt, driftX = 0, driftZ = 0) {
        this.time += dt;
        const s = this._s;
        for (let i = this.n - 1; i >= 0; i--) {
            const age = this.time - this.born[i];
            this.at(i, s);
            if (age > MARK_LIFE.max * Math.max(this.lk[i], 0.3) || (s.foam < 0.01 && s.milk < 0.01 && s.agit < 0.01 && s.shade < 0.01)) { this.kill(i); continue; }
            this.x[i] += driftX * dt; this.z[i] += driftZ * dt;
        }
    }
    kill(i) {
        const j = --this.n;
        if (i === j) return;
        for (const a of this.arrays) a[i] = a[j];
    }
    clear() { this.n = 0; }
    // the strongest mark at (x, z) now (for tests and the HUD-less checks): max over stamps of each channel
    sample(x, z, out = { foam: 0, milk: 0, agit: 0 }) {
        out.foam = out.milk = out.agit = 0;
        const s = this._s;
        for (let i = 0; i < this.n; i++) {
            this.at(i, s);
            const dx = x - this.x[i], dz = z - this.z[i];
            let inside;
            const k = this.ring[i];
            if (k === KIND.streak) {
                const c = Math.cos(this.ang[i]), sn = Math.sin(this.ang[i]);
                const along = dx * sn + dz * c, across = dx * c - dz * sn;
                inside = Math.abs(along) < this.len[i] * 0.5 + s.w * 0.3 && Math.abs(across) < s.w;
            } else if (k === KIND.wave) inside = Math.abs(Math.hypot(dx, dz) - s.w) < Math.max(2, s.w * 0.12);
            else inside = Math.hypot(dx, dz) < s.w * (k === KIND.rotor ? 1.4 : 1);
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
// mass (kg), span (m) or R (m), length (m), mach, k (its exhaust's strength scale), kp (its pressure field's) }.
// Returns the sources flying low (over water or land: washOf tells them apart).
const isLow = (p, lowY) => p.y <= lowY || p.y - terrainHeight(p.x, p.z) < 160;
export function lowSources(game, out = []) {
    out.length = 0;
    const lowY = WATER.maxCrest + 160;
    if (game.aircraft) for (const a of game.aircraft) {
        if (!a || a.exploded || !a.pos || !isLow(a.pos, lowY)) continue;
        if (a.onGround && !a.onWater) continue; // on a deck, a runway or a beach
        if (!a.spec) continue;
        const m = massOf(a.spec), acc = a.afterburner ? a.thrustAB : (a.thrustMil || 0) * Math.min((a.throttle || 0) / 0.9, 1);
        a.getForward(_f);
        const speed = Math.hypot(a.vel.x, a.vel.z);
        out.push({
            kind: 'jet', src: a, x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: a.vel.x, vz: a.vel.z, speed,
            pitch: Math.asin(clamp(_f.y, -1, 1)), fx: _f.x, fz: _f.z, thrust: a.alive && !a.flameout ? m * (acc || 0) : 0, mass: m, span: a.spec.span || 10,
            length: a.spec.length || 12, mach: speed / 340,
            // (a propeller's slipstream is a broad, slow jet: far weaker at the water than a jet's exhaust of the same
            // thrust; a hull on the water: its own wake and spray are seaplane.js's, the propwash only ruffles it)
            k: (a.spec.prop ? 0.3 : 1) * (a.onWater ? 0.45 : 1), kp: a.onWater ? 0 : 1,
        });
    }
    for (const t of AIR_TARGETS) {
        if (!t || t.alive === false || !t.mesh || !t.mesh.visible || !t.mesh.userData || !t.mesh.userData.rotor) continue;
        const p = t.mesh.position;
        if (!isLow(p, lowY)) continue;
        const v = t.vel || _f.set(0, 0, 0);
        const civil = /CIVIL/.test(t.name || '');
        out.push({ kind: 'rotor', src: t, x: p.x, y: p.y, z: p.z, vx: v.x, vz: v.z, speed: Math.hypot(v.x, v.z), R: rotorRadius(t), mass: civil ? 3200 : 9500, k: 1, kp: 0 });
    }
    const S = game.strikes;
    if (S && S.missiles) for (const m of S.missiles) {
        if (!m.alive || m.phase === 'launch' || m.phase === 'boost' || !m.pos || m.pos.y > 60) continue;
        if (m.kind !== 'cruise' && m.kind !== 'antiship') continue;
        const sp = Math.hypot(m.vel.x, m.vel.z) || 1;
        out.push({ kind: 'missile', src: m, x: m.pos.x, y: m.pos.y, z: m.pos.z, vx: m.vel.x, vz: m.vel.z, speed: sp, pitch: Math.atan2(m.vel.y, sp), fx: m.vel.x / sp, fz: m.vel.z / sp, thrust: 3500, length: 5, mach: sp / 340, k: 1, kp: 0 });
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

// What one source does to the water (or the ground) this frame. Fills `hits` with the patches it blows on:
// { kind: 'exhaust' | 'wing' | 'ring', x, z, y (the surface there), w (half-width or the ring's radius, m), u (m/s),
// land (dry ground: dust, not spray) }. 'wing' is the patch right under a jet: its pressure field and, within about a
// span, its wing's downwash.
const _g = { water: false, y: 0 };
function under(x, z, out = _g) {
    const t = terrainHeight(x, z);
    if (t < -0.8) { out.water = true; out.y = waterHeight(x, z); } else { out.water = false; out.y = Math.max(t, 0); }
    return out;
}
export function washOf(s, hits) {
    hits.length = 0;
    under(s.x, s.z);
    const wet = _g.water, y0 = _g.y, h0 = Math.max(s.y - y0, 0);
    if (s.kind === 'rotor') {
        const r = rotorWash(h0, s.mass, s.R, s.speed);
        if (r.u < 1) return hits;
        const sl = s.speed > 0.5 ? 1 / s.speed : 0;
        hits.push({ kind: 'ring', x: s.x - s.vx * sl * r.back, z: s.z - s.vz * sl * r.back, y: y0, w: r.ring, u: r.u * s.k, land: !wet, h: h0 });
        return hits;
    }
    // exhaust: lands x behind the nozzle along the flight path
    const ex = exhaustWash(h0, s.thrust, s.pitch);
    if (ex.u * s.k > 1) {
        const hx = s.x - s.fx * ex.x, hz = s.z - s.fz * ex.x;
        under(hx, hz);
        hits.push({ kind: 'exhaust', x: hx, z: hz, y: _g.y, w: clamp(h0 * 0.75 + 2.5, 2.5, 45), u: ex.u * s.k, land: !_g.water, h: h0 });
    }
    if (s.kind === 'jet') {
        const pr = (s.kp ?? 1) * pressureWash(h0, s.speed, s.length || 15, s.mach);
        const w = s.span ? wingWash(h0, s.mass, s.speed, s.span) * 2.2 * s.k : 0;
        const u = Math.hypot(pr, w);
        if (u > 1) {
            // under the wing and just behind it, the width of the span and spreading with height
            const back = (s.length || 15) * 0.3 + (s.span || 10) * 0.3;
            const bx = s.x - s.fx * back, bz = s.z - s.fz * back;
            if (!wet) under(bx, bz);
            hits.push({ kind: 'wing', x: bx, z: bz, y: wet ? y0 : _g.y, w: (s.span || 10) * 0.55 + h0 * 0.25, u, land: !wet, h: h0 });
        }
    }
    return hits;
}

// What the ground is at (x, z), for the dust a low pass raises (the terrain shader's own cover, world.js: the beach's
// sand band just above the waterline, rock on steep slopes, snow high up, forest, dry highland and dirt patches)
export const GROUND_DUST = {
    // dust: the colour of the cloud; k: how readily it lifts; bits: what's thrown about in it and how much
    sand: { dust: [0.66, 0.57, 0.42], k: 1.0, bits: [0.55, 0.47, 0.33], bitK: 0.25, bitSize: 0.12 },
    dirt: { dust: [0.5, 0.41, 0.3], k: 0.85, bits: [0.24, 0.18, 0.12], bitK: 0.35, bitSize: 0.16 },
    grass: { dust: [0.55, 0.52, 0.42], k: 0.32, bits: [0.3, 0.38, 0.14], bitK: 0.9, bitSize: 0.22 },  // cuttings, seed heads
    forest: { dust: [0.47, 0.46, 0.38], k: 0.18, bits: [0.32, 0.36, 0.12], bitK: 1, bitSize: 0.3 },   // leaves torn off
    rock: { dust: [0.58, 0.56, 0.53], k: 0.35, bits: [0.4, 0.38, 0.35], bitK: 0.2, bitSize: 0.1 },
    snow: { dust: [0.93, 0.95, 0.99], k: 1.25, bits: [0.96, 0.97, 1], bitK: 0.5, bitSize: 0.1 },
};
export function groundKind(x, z) {
    const h = terrainHeight(x, z);
    if (h < -0.8) return 'water';
    const e = 4, hx = terrainHeight(x + e, z) - h, hz = terrainHeight(x, z + e) - h;
    const slope = 1 - e / Math.hypot(hx, e, hz);
    if (h < 2.6 && slope < 0.1) return 'sand';
    if (h > 1150 + fbm(x * 0.0021, z * 0.0021, 2) * 90 && slope < 0.45) return 'snow';
    if (slope > 0.28) return 'rock';
    if (fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3) > 0.12) return 'forest';
    if (h > 350 || fbm(x * 0.0043 + 0.61, z * 0.0043 + 0.2, 2) > 0.22) return 'dirt';
    return 'grass';
}

// ── Spray: its own particles (the effects' particle system, effects.js, with a texture of fine droplets) ──
// 2×2 atlas in the smoke atlas's format (RG normal, B thickness, A density): a soft cloud of droplets, denser in the
// middle, its edge broken up, the normals from its density (so the sun lights its top)
let sprayTex = null;
export function sprayAtlas() {
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
// The kinds (KIND): a streak along a path; a rotor's ring of ripples; a round's splash (a white boil, a ring of
// ripples running out); a blast's slick (a ragged disc of churned, darker water: boiling foam patches, milky water
// between, the roughest at its rim); a ring of waves running out (thin, rough, a little white on it).
const STAMP_VS = /* glsl */`
    attribute vec4 iA;  // x, z, heading, length
    attribute vec4 iB;  // half-width (radius), foam, milk, agitation
    attribute vec4 iC;  // kind, age, shade, -
    varying vec2 vUv;
    varying vec4 vM;
    varying vec2 vW;
    varying vec4 vC;
    void main() {
        vUv = position.xy;            // -1..1
        vM = iB; vC = iC;
        float c = cos(iA.z), s = sin(iA.z), k = iC.x;
        // (a round mark's quad spans its rim and a little more: in radii)
        float ext = k < 1.5 ? 1.6 : k < 2.5 ? 1.3 : k < 3.5 ? 1.35 : 1.15;
        vec2 q = k > 0.5 ? position.xy * iB.x * ext : vec2(position.x * iB.x, position.y * (iA.w * 0.5 + iB.x * 0.35));
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
    varying vec4 vC;
    void main() {
        float k = vC.x;
        float shape, foamShape, milkShape = -1.0;
        // broken, lacy white water (the ocean adds the fine lace), streaked along the path; ragged edges
        float n = texture2D(foamMap, vW / 23.0 + vC.y * 0.013).g * 0.6 + texture2D(foamMap, vW / 7.0).r * 0.4;
        float m = texture2D(foamMap, vW / 61.0 + 0.37).g;
        if (k < 0.5) {
            float ac = abs(vUv.x) * (0.8 + 0.45 * m), al = abs(vUv.y);
            shape = (1.0 - smoothstep(0.35, 1.0, ac)) * (1.0 - smoothstep(0.6, 1.0, al));
            foamShape = (1.0 - smoothstep(0.2, 0.85, ac)) * (1.0 - smoothstep(0.5, 1.0, al));
        } else if (k < 1.5) {
            // a rotor's ring: ripples strongest in a band round the ring radius (r = 1 / 1.6 of the quad), a calmer,
            // flattened eye under the hub, spray-whitened water at the ring's rim
            float r = length(vUv) * 1.6;
            shape = exp(-pow((r - 1.0) / 0.32, 2.0)) + 0.35 * (1.0 - smoothstep(0.0, 0.9, r));
            foamShape = exp(-pow((r - 0.95) / 0.22, 2.0));
            shape *= 1.0 - smoothstep(1.45, 1.6, r);
        } else if (k < 2.5) {
            // a round's splash: the white boil where it went in, a ring of ripples running out round it
            float r = length(vUv) * 1.3;
            foamShape = exp(-pow(r / 0.5, 2.0)) + 0.45 * exp(-pow((r - 0.9) / 0.16, 2.0));
            shape = (exp(-pow((r - 0.92) / 0.22, 2.0)) + 0.4 * (1.0 - smoothstep(0.0, 0.7, r))) * (1.0 - smoothstep(1.12, 1.3, r));
            milkShape = 1.0 - smoothstep(0.3, 1.0, r);
        } else if (k < 3.5) {
            // a blast's slick: boiling foam in patches, milky water between, darker; the rim rough and ragged
            float r = length(vUv) * 1.35 + (m - 0.5) * 0.4 + (n - 0.5) * 0.12;
            float disc = 1.0 - smoothstep(0.72, 1.02, r);
            foamShape = disc * (0.3 + 0.9 * smoothstep(0.38, 0.72, n)) * (0.75 + 0.35 * exp(-pow((r - 0.85) / 0.15, 2.0)));
            shape = disc * (0.3 + 0.7 * smoothstep(0.5, 0.95, r));
            milkShape = disc;
        } else {
            // a ring of waves running out
            float r = length(vUv) * 1.15;
            shape = exp(-pow((r - 1.0) / 0.075, 2.0));
            foamShape = shape * 0.7 * smoothstep(0.4, 0.75, n);
        }
        if (milkShape < 0.0) milkShape = shape;
        float foam = vM.y * foamShape * smoothstep(0.45, 0.8, n + vM.y * 0.25);
        // (the gusts' ripples are patchy too: catspaws)
        float agit = vM.w * shape * (0.55 + 0.6 * smoothstep(0.25, 0.75, n * 0.5 + m * 0.5));
        float shade = vC.z * (k > 2.5 && k < 3.5 ? milkShape * (0.65 + 0.55 * m) : shape);
        gl_FragColor = vec4(clamp(foam, 0.0, 1.0), clamp(vM.z * milkShape, 0.0, 1.0), clamp(shade, 0.0, 1.0), clamp(agit, 0.0, 1.0));
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
        this.roar = 0;              // the loudest spray's level near the camera (audio.js sprayRoar)
        this._s = { foam: 0, milk: 0, agit: 0, w: 0, shade: 0 };
        this._o = { shade: 0 };
    }

    // the instanced stamp mesh for the wake map (made on first use: tests never need it)
    makeMesh() {
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        const M = this.field.max;
        this.iA = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.iB = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.iC = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4).setUsage(THREE.DynamicDrawUsage);
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

    clear() { this.field.clear(); if (this.mesh) this.mesh.geometry.instanceCount = 0; if (this.sys) this.sys.clear(); this.roar = 0; }

    // the spray's particles: the effects' own particle system class (effects.js), lit like the smoke, with droplets that
    // streak along their fall (only when splash.js isn't there to lend its own)
    spraySystem(fx) {
        if (this.sys !== undefined) return this.sys;
        this.sys = null;
        try {
            const PS = fx.smoke.constructor;
            this.sys = new PS(fx.scene, 5000, { texture: sprayAtlas(), lit: true, atlas: true, stretch: true, renderOrder: 6, wind: 1, light: fx.lightU });
            this.sys.mesh.name = 'waterwake:spray';
            this.seaY = seaFade(this.sys);
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
        // splash.js's water particles when it's there (it updates them), else a system of our own
        const W = fx && fx.water && fx.water.ready ? fx.water.ready() : null;
        let sys = W ? W.drops : null;
        if (!sys && fx && fx.smoke && fx.scene) {
            sys = this.spraySystem(fx);
            if (sys) { sys.update(dt, (game.scene && game.scene.fog) || FOG0, fx.wind); if (this.seaY) this.seaY.value = WATER.maxCrest * 0.35; }
        }
        const mist = W ? W.mist : null;
        const cam = game && game.camera ? game.camera.position : null;
        this.active = 0;
        let roar = 0, roarX = 0, roarY = 0, roarZ = 0;
        for (const s of lowSources(game, this.sources)) {
            const hits = washOf(s, this.hits);
            if (!hits.length) continue;
            let st = this.state.get(s.src);
            if (!st) { st = { last: new Map(), spray: 0, mist: 0, dust: 0, t: 0, gk: null, gkT: 0 }; this.state.set(s.src, st); }
            st.t += dt;
            for (const hit of hits) {
                const mk = washMarks(hit.u);
                if (hit.land) { if (fx && fx.smoke) this.dust(fx, st, s, hit, dt, W); continue; }
                if (mk.agit < 0.02) continue;
                this.active++;
                this.stamp(st, s, hit, mk);
                // (a rotor's downwash beats straight down on the water: it lifts spray at a lower speed than a gust)
                const sp = s.kind === 'rotor' ? smooth(6, 24, hit.u) : mk.spray;
                if (sp > 0.01 && (sys || (fx && fx.smoke))) this.spray(sys || fx.smoke, mist, st, s, hit, mk, sp, dt, W);
                if (sp > 0.02 && cam) {
                    const d = Math.hypot(hit.x - cam.x, hit.y - cam.y, hit.z - cam.z);
                    const l = sp * (0.6 + 0.4 * Math.min(mk.power, 1.5)) / (1 + d / 140);
                    if (l > roar) { roar = l; roarX = hit.x; roarY = hit.y; roarZ = hit.z; }
                }
            }
        }
        // the roar of the spray (audio.js): the loudest near the camera
        this.roar = roar;
        if (game && game.audio && game.audio.sprayRoar && game.camera) game.audio.sprayRoar(roar, roarX, roarY, roarZ, game.camera);
        this.upload();
    }

    // lay marks along the patch's path: one every ~0.6 of its width, or every 0.2 s from a rotor hovering
    stamp(st, s, hit, mk) {
        const F = this.field, key = hit.kind;
        const last = st.last.get(key);
        const ring = hit.kind === 'ring';
        const step = ring ? Math.max(hit.w * 0.5, 3) : Math.max(hit.w * 0.6, 3);
        const ang = Math.atan2(s.vx, s.vz);
        const o = this._o;
        o.shade = ring ? mk.shade * 0.5 : mk.shade;
        if (last && F.time - last.t < 1.0) {
            const d = Math.hypot(hit.x - last.x, hit.z - last.z);
            if (ring ? (d < step && F.time - last.t < 0.2) : d < step) return;
            if (!ring && d < 600) {
                // fill the gap since the last mark (a fast jet covers several marks' worth in a frame)
                const n = Math.min(Math.ceil(d / step), 40);
                for (let k = 1; k <= n; k++) {
                    const f = k / n;
                    F.add(last.x + (hit.x - last.x) * f, last.z + (hit.z - last.z) * f, ang, d / n * 1.6, hit.w, mk.foam, mk.milk, mk.agit, false, o);
                }
                last.x = hit.x; last.z = hit.z; last.t = F.time;
                return;
            }
        }
        F.add(hit.x, hit.z, ang, step * 1.6, hit.w, mk.foam, mk.milk, mk.agit, ring, o);
        if (last) { last.x = hit.x; last.z = hit.z; last.t = F.time; } else st.last.set(key, { x: hit.x, z: hit.z, t: F.time });
    }

    // Spray and mist: a rooster tail where the exhaust lands (a sheet thrown up and back, its middle the highest); a V
    // of spray thrown up and out under a fast jet (its pressure field) with spray lines under the wing tips; a ring of
    // spray and mist round a rotor, and when it hovers low the cloud its wake pulls back up round it; a long trail of
    // mist that hangs on behind a fast, low pass. sm: the droplets' system, mist: the puffs' (splash.js) or null
    spray(sm, mist, st, s, hit, mk, sp, dt, W) {
        const ring = hit.kind === 'ring';
        const pw = Math.min(Math.max(mk.power, sp), 2.5), qk = W ? W.Q.k : 1;
        const ms = mist || sm, js = W && W.jets !== W.drops ? W.jets : null;
        // (as many a metre of path at any speed, ~1.3 particles a metre: a slow aircraft doesn't build a wall of mist)
        const rate = ring ? (150 + 260 * sp) : clamp(s.speed * (hit.kind === 'wing' ? 1.1 : 1.3), 25, 450);
        st.spray += rate * sp * dt * (s.kind === 'missile' ? 0.3 : 1) * qk;
        const V = _vv, P = _pp;
        const back = s.speed > 1 ? 1 / s.speed : 0;
        const cx = s.fz || 0, cz = -(s.fx || 0); // right of the flight path (in xz)
        while (st.spray >= 1) {
            st.spray -= 1;
            const r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
            if (ring) {
                const a = r1 * Math.PI * 2, rr = hit.w * (0.85 + 0.45 * r2);
                P.set(hit.x + Math.cos(a) * rr, hit.y + 0.4, hit.z + Math.sin(a) * rr);
                const out = (6 + 12 * r3) * (0.5 + 0.5 * sp);
                V.set(Math.cos(a) * out + s.vx * 0.3, 2 + 7 * r2 * sp, Math.sin(a) * out + s.vz * 0.3);
                if (r3 < 0.42) ms.emit(P, V, 3 + 3 * r1, 4, 14 + 14 * sp, MIST0, MIST1, 0.1 + 0.2 * sp, 0, 1.1, -0.2, 0, 0.5, 0.4, 0);
                else sm.emit(P, V, 1 + r1, 1.5 + sp, 4 + 2 * sp, DROP0, DROP1, 0.45 + 0.4 * sp, 0, 0.6, -8, 0, 0.5, 0.4, 0.05);
                // hovering low (under ~1.5 radii): the wake fountains back up into the rotor, a cloud of spray round it
                if (hit.h < hit.w * 1.5 && r2 < 0.25 * sp) {
                    const a2 = r3 * Math.PI * 2, r0 = hit.w * (0.6 + 0.5 * r1);
                    P.set(hit.x + Math.cos(a2) * r0, hit.y + 1, hit.z + Math.sin(a2) * r0);
                    V.set(-Math.cos(a2) * 3, 3 + 4 * r1, -Math.sin(a2) * 3);
                    ms.emit(P, V, 4 + 3 * r2, 6, 16 + 10 * sp, MIST0, MIST1, 0.12 + 0.12 * sp, 0, 0.8, 0.3, 0, 0.5, 0.3, 0);
                }
                continue;
            }
            if (hit.kind === 'wing') {
                // under the jet: a V of spray thrown up and out from the track (the higher the harder it blows: a wall of
                // it, the rooster tail, below ~15 m), spray lines under the tips
                const side = r1 < 0.5 ? -1 : 1, edge = r2 < 0.3;
                const across = side * hit.w * (edge ? 0.85 + 0.2 * r3 : 0.15 + 0.6 * r3);
                P.set(hit.x + cx * across - s.vx * back * (r2 * 8), hit.y + 0.5, hit.z + cz * across - s.vz * back * (r2 * 8));
                const up = (3 + (8 + 22 * r3 * r3) * pw) * (edge ? 0.6 : 1);
                const outV = side * (3 + 8 * pw * r1);
                V.set(s.vx * (0.05 + 0.06 * r2) + cx * outV, up, s.vz * (0.05 + 0.06 * r2) + cz * outV);
                if (r3 < 0.4) ms.emit(P, V, 2.5 + 3 * r2, 3 + 3 * sp, Math.min(10 + 18 * pw, 8 + hit.w * 2.2), MIST0, MIST1, 0.16 + 0.3 * sp, 0, 2, 0.2, 0, 0.5, 0.3, 0);
                else if (js && r3 < 0.62) js.emit(P, V, 2 * up / 9.81 * 0.6 + 0.3, 1.2 + 1.4 * pw, 2.5 + 3 * pw, DROP0, DROP1, 0.75 + 0.25 * sp, 0.2, 1.1, -9.8, 0, 0.5, 0.1, 0.28);
                else sm.emit(P, V, 1 + 1.4 * r2, 1.2 + 1.2 * sp, 3 + 3 * pw, DROP0, DROP1, 0.45 + 0.45 * sp, 0, 1.6, -9.5, 0, 0.5, 0.8, 0.06);
            } else {
                // across the patch, a little ahead/behind
                const across = (r1 - 0.5) * 2 * hit.w * 0.6;
                P.set(hit.x + cx * across - s.vx * back * (r2 * 6), hit.y + 0.5, hit.z + cz * across - s.vz * back * (r2 * 6));
                // the rooster tail: where the exhaust lands it throws a sheet of water up and back, tens of metres when it
                // blows hard (its middle the highest)
                const mid = 1 - Math.abs(r1 - 0.5) * 2;
                const up = (4 + (10 + 30 * mid * mid) * Math.pow(r3, 1.2) * sp) * (0.4 + 0.6 * sp) * (0.75 + 0.35 * Math.min(pw, 2));
                // a little of the aircraft's speed (the air its wake drags along), soon lost: the plume stays where it rose
                const drag = 0.04 + 0.08 * r2;
                V.set(s.vx * drag + cx * (r1 - 0.5) * 12, up, s.vz * drag + cz * (r1 - 0.5) * 12);
                // (the cloud of mist grows to about the size of the patch of water blown on)
                if (r3 < 0.45) ms.emit(P, V, 3 + 4 * r2, 4 + 3 * sp, Math.min(14 + 22 * sp, 6 + hit.w * 2.5), MIST0, MIST1, 0.14 + 0.24 * sp, 0, 2.6, 0.3, 0, 0.5, 0.3, 0);
                else sm.emit(P, V, 1.2 + 1.3 * r2, 1.4 + 1.2 * sp, 3 + 4 * sp, DROP0, DROP1, 0.45 + 0.4 * sp, 0, 1.7, -9.5, 0, 0.5, 0.8, 0.06);
            }
            // the trail of mist that hangs on behind (the finest spray, drifting with the wind): what shows first, from
            // 30–40 m up
            if (r2 > 0.8) {
                P.y += 1 + 3 * r3 * pw;
                V.set(s.vx * 0.03, 0.6 + r1 + 2 * pw * r3, s.vz * 0.03);
                ms.emit(P, V, 5 + 5 * r1, 5 + 4 * sp, 14 + 16 * Math.min(pw, 2), MIST0, MIST1, 0.14 + 0.2 * sp, 0, 0.9, 0.12, 0, 0.5, 0.2, 0);
            }
        }
    }

    // Over dry ground: dust (sand, dirt, dry grass, powder snow) blown up where the exhaust lands, under the jet and round
    // a rotor, with bits thrown about in it (grass cuttings and leaves over fields and forest, grit, sand)
    dust(fx, st, s, hit, dt, W) {
        st.gkT -= dt;
        if (!st.gk || st.gkT <= 0 || st.gkKind !== hit.kind) { st.gk = GROUND_DUST[groundKind(hit.x, hit.z)] || GROUND_DUST.grass; st.gkT = 0.3; st.gkKind = hit.kind; }
        const G = st.gk, ring = hit.kind === 'ring';
        // (sand starts to move at a few m/s of wind at the surface; the jet's blast raises a wall of it)
        const lift = smooth(5, 30, hit.u) * G.k;
        if (lift < 0.01) return;
        const qk = W ? W.Q.k : 1;
        const rate = (ring ? 70 + 80 * lift : clamp(s.speed * 0.6, 18, 240)) * Math.min(lift, 1.2) * qk;
        st.dust += rate * dt;
        const V = _vv, P = _pp, sm = fx.smoke, c = G.dust;
        const cx = s.fz || 0, cz = -(s.fx || 0);
        while (st.dust >= 1) {
            st.dust -= 1;
            const r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
            if (ring) {
                const a = r1 * Math.PI * 2, rr = hit.w * (0.7 + 0.6 * r2);
                P.set(hit.x + Math.cos(a) * rr, hit.y + 0.6, hit.z + Math.sin(a) * rr);
                const out = (5 + 10 * r3) * (0.5 + 0.5 * lift);
                V.set(Math.cos(a) * out + s.vx * 0.3, 1 + 4 * r2 * lift, Math.sin(a) * out + s.vz * 0.3);
            } else {
                const across = (r1 - 0.5) * 2 * hit.w * (hit.kind === 'wing' ? 1 : 0.6);
                P.set(hit.x + cx * across, hit.y + 0.6, hit.z + cz * across);
                const up = (1.5 + 9 * r3 * lift) * (hit.kind === 'exhaust' ? 1.3 : 0.8);
                V.set(s.vx * (0.03 + 0.06 * r2) + cx * (r1 - 0.5) * 10, up, s.vz * (0.03 + 0.06 * r2) + cz * (r1 - 0.5) * 10);
            }
            const k = 0.85 + 0.3 * r2;
            if (r3 < 0.75) sm.emit(P, V, 3 + 4 * r2, 2.5 + 2 * lift, (8 + 14 * Math.min(lift, 1.2)) * (ring ? 1.2 : 1), [c[0] * k, c[1] * k, c[2] * k], [c[0] * 1.1, c[1] * 1.1, c[2] * 1.1], 0.22 + 0.4 * Math.min(lift, 1), 0, 1.3, 0.35, 0, 0.5, 0.5);
            if (r1 < G.bitK * 0.5) {
                // a bit thrown about: tumbling up and falling back
                V.set(V.x * 0.8 + (r2 - 0.5) * 6, 3 + 8 * r3 * lift, V.z * 0.8 + (r3 - 0.5) * 6);
                const b = G.bits, sz = G.bitSize * (0.6 + 0.8 * r2);
                sm.emit(P, V, 1 + 1.5 * r3, sz, sz * 0.8, b, b, 1, 0.8, 0.9, -7, 0, 0.5, 3);
            }
        }
    }

    // stamps → instance buffers (age and strength resolved here, so the shader only shapes them)
    upload() {
        if (!this.mesh) return;
        const F = this.field, A = this.iA.array, B = this.iB.array, C = this.iC.array, s = this._s;
        for (let i = 0; i < F.n; i++) {
            F.at(i, s);
            A[i * 4] = F.x[i]; A[i * 4 + 1] = F.z[i]; A[i * 4 + 2] = F.ang[i]; A[i * 4 + 3] = F.len[i];
            B[i * 4] = s.w; B[i * 4 + 1] = s.foam; B[i * 4 + 2] = s.milk; B[i * 4 + 3] = s.agit;
            C[i * 4] = F.ring[i]; C[i * 4 + 1] = F.time - F.born[i]; C[i * 4 + 2] = s.shade; C[i * 4 + 3] = 0;
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

// A puff's billboard dips into the sea it rose from, and the water's depth would cut it along a hard line: a water
// particle system's puffs thin out toward the surface instead (by their height above the mean sea, a fraction of their
// size). Patches the system's material; returns its seaY uniform (set it to the mean sea's height).
export function seaFade(sys) {
    const m = sys.mat, vA = 'mv.xy += q;', fA = 'float a = t.a * vCol.a;';
    if (!m.vertexShader.includes(vA) || !m.fragmentShader.includes(fA)) return null;
    m.vertexShader = m.vertexShader.replace('void main() {', 'varying vec2 vSea;\n    void main() {')
        .replace(vA, vA + ' vSea = vec2((inverse(viewMatrix) * mv).y, size);');
    m.fragmentShader = m.fragmentShader.replace('void main() {', 'varying vec2 vSea; uniform float seaY;\n    void main() {')
        .replace(fA, fA + ' a *= smoothstep(seaY, seaY + max(1.0, vSea.y * 0.3), vSea.x);');
    return (m.uniforms.seaY = { value: 0 });
}
const _vv = new THREE.Vector3(), _pp = new THREE.Vector3();
// (brighter than white albedo under the smoke's lighting: spray scatters far more than smoke, splash.js)
const MIST0 = [1.45, 1.48, 1.53], MIST1 = [1.28, 1.32, 1.39], DROP0 = [1.45, 1.48, 1.53], DROP1 = [1.28, 1.33, 1.4];
const FOG0 = { color: new THREE.Color(0.75, 0.82, 0.9), density: 0 };
