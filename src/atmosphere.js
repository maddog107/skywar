// ═══════════════════════════════════════════════════════════════
// The atmosphere: one physical model of the air that the sky, the sun's colour, the sky's light and the haze over
// distant ground all take their colours from (docs/ATMOSPHERE.md).
//
// Sebastien Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR 2020), on the
// Earth of Bruneton & Neyret, "Precomputed Atmospheric Scattering" (EGSR 2008): a planet of radius 6360 km under
// 100 km of air made of
//   • molecules (Rayleigh scattering: 5.802, 13.558, 33.1 per Mm at 680, 550, 440 nm, thinning over 8 km: the blue)
//   • aerosol (Mie scattering: the weather's haze, a 1.5 km layer; forward scattering, g = 0.8: the white horizon,
//     the glow round the sun, the red of a low sun)
//   • ozone (absorption 0.650, 1.881, 0.085 per Mm in a layer 25 ± 15 km up: it takes the orange out of the long
//     paths of twilight, which is why the zenith stays blue after sunset)
// Light reaching the eye along a ray is the sun's, scattered once toward it at every point on the ray (dimmed on
// its way in and on its way out, and missing where the planet shadows the air: the Earth's shadow rising in the
// east at dusk), plus light scattered more than once (Hillaire's closed form: the second bounce, taken as isotropic,
// times the geometric series of the rest).
//
// Two implementations of the same equations:
//   • JavaScript (the first half of this file): the numbers the palette needs (the sun's transmittance, the sky's
//     irradiance, a few radiances) and what the tests check. No DOM, nothing drawn.
//   • GLSL (class Atmosphere): the lookup tables the shaders read: multiple scattering (32 × 32, redrawn when the
//     air changes) and the sky view (every direction round the camera, redrawn when the sun, the air or the camera's
//     height change). Both read the same static table of column densities, built here once on the CPU.
// Lengths are in km in here (the shaders' world is in metres: the callers convert).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

export const ATM = {
    RG: 6360, RT: 6460,                      // the ground's and the atmosphere's top's radius (km)
    HR: 8, HM: 1.5,                          // scale heights (km): molecules, aerosol (the haze layer, weather.js `haze`)
    BETA_R: [5.802e-3, 13.558e-3, 33.1e-3],  // Rayleigh scattering at sea level (per km; red, green, blue)
    BETA_O: [0.650e-3, 1.881e-3, 0.085e-3],  // ozone absorption at the middle of its layer (per km)
    O3_MID: 25, O3_HALF: 15,                 // the ozone layer: a tent 25 ± 15 km
    G: 0.8,                                  // aerosol asymmetry (Cornette-Shanks)
    ALBEDO_M: 0.94,                          // aerosol single-scattering albedo
    GROUND: 0.18,                            // the ground's albedo (land and sea together: the light it sends back up)
    WAVE: [680, 550, 440],                   // the three wavelengths (nm)
};
const { RG, RT, HR, HM, BETA_R, BETA_O, O3_MID, O3_HALF } = ATM;
const H_ATM = RT - RG, H_TOP = Math.sqrt(RT * RT - RG * RG);
const PI = Math.PI;
export const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ── The air ──
// mie: aerosol extinction at sea level at 550 nm (per km); angstrom: its wavelength exponent (1.3 a dry continental
// haze: bluish, so the low sun reddens through it; 0 for droplets: grey)
export function makeAir(mie = 0.04, angstrom = 1.3, out = {}) {
    out.mie = mie; out.angstrom = angstrom;
    const e = out.mieExt || (out.mieExt = [0, 0, 0]), s = out.mieSca || (out.mieSca = [0, 0, 0]);
    for (let i = 0; i < 3; i++) { e[i] = mie * Math.pow(ATM.WAVE[i] / 550, -angstrom); s[i] = e[i] * ATM.ALBEDO_M; }
    out.g = ATM.G;
    out.key = mie.toFixed(6) + '|' + angstrom.toFixed(3);
    return out;
}

// ── Geometry (in the height h above the ground, so nothing is lost subtracting two radii) ──
// distance along a ray from h km up, cosine of zenith angle mu, to the top of the atmosphere
function distTop(h, mu) { const r = RG + h; return -r * mu + Math.sqrt(Math.max(r * r * mu * mu + (H_ATM - h) * (RT + r), 0)); }
// ... to the ground, or -1 when it misses
function distGround(h, mu) {
    const r = RG + h, disc = r * r * mu * mu - h * (2 * RG + h);
    return mu < 0 && disc >= 0 ? -r * mu - Math.sqrt(disc) : -1;
}
// the angle from straight down to the horizon seen from h km up (rad): the horizon's zenith angle is π minus this
export const horizonBeta = (h) => Math.acos(Math.min(Math.sqrt(Math.max(h, 0) * (2 * RG + Math.max(h, 0))) / (RG + Math.max(h, 0)), 1));
// is the point h km up, with the light at cosine muL from its zenith, in the planet's shadow?
const shadowed = (h, muL) => muL < 0 && h * (2 * RG + h) < (RG + h) * (RG + h) * muL * muL;

// ── Column densities ──
// How much of each constituent stands along the ray from (h, mu) to the top of the atmosphere, in km of sea-level
// air: molecules, aerosol, ozone. Transmittance for any air is exp(-(betaR·N.r + mieExt·N.m + betaO·N.o)): one static
// table serves every weather. Bruneton's parameterisation (x: the distance to the top between its least, straight up,
// and its most, along the horizon; y: the height), which puts its resolution where the columns change quickly.
export const COL_W = 128, COL_H = 40;
let _col = null;
export function columnsExact(h, mu, out, steps = 96) {
    // (Simpson's rule: `steps` even)
    const r = RG + h, d = distTop(h, mu), dt = d / steps;
    let nr = 0, nm = 0, no = 0;
    for (let i = 0; i <= steps; i++) {
        const t = i * dt, rr = Math.sqrt(r * r + t * t + 2 * r * mu * t);
        const hh = Math.max(h + t * (t + 2 * r * mu) / (rr + r), 0), w = i === 0 || i === steps ? 1 : i & 1 ? 4 : 2;
        nr += w * Math.exp(-hh / HR); nm += w * Math.exp(-hh / HM); no += w * Math.max(0, 1 - Math.abs(hh - O3_MID) / O3_HALF);
    }
    out[0] = nr * dt / 3; out[1] = nm * dt / 3; out[2] = no * dt / 3;
    return out;
}
export function columnLUT() {
    if (_col) return _col;
    _col = new Float32Array(COL_W * COL_H * 4);
    const c = [0, 0, 0];
    for (let j = 0; j < COL_H; j++) {
        const rho = H_TOP * j / (COL_H - 1), h = Math.sqrt(rho * rho + RG * RG) - RG, r = RG + h;
        const dMin = H_ATM - h, dMax = rho + H_TOP;
        for (let i = 0; i < COL_W; i++) {
            const d = dMin + (i / (COL_W - 1)) * (dMax - dMin);
            const mu = d > 0 ? Math.max(-1, Math.min(1, (H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d))) : 1;
            columnsExact(h, mu, c);
            _col.set(c, (j * COL_W + i) * 4);
            _col[(j * COL_W + i) * 4 + 3] = 1;
        }
    }
    return _col;
}
// the table at (h, mu), bilinear (the shaders' lookup: atmColumns)
export function columns(h, mu, out) {
    const T = columnLUT();
    const rho = Math.sqrt(Math.max(h * (2 * RG + h), 0));
    const d = distTop(h, mu), dMin = H_ATM - h, dMax = rho + H_TOP;
    const x = Math.max(0, Math.min(1, (d - dMin) / (dMax - dMin))) * (COL_W - 1), y = Math.max(0, Math.min(1, rho / H_TOP)) * (COL_H - 1);
    const x0 = Math.min(Math.floor(x), COL_W - 2), y0 = Math.min(Math.floor(y), COL_H - 2), fx = x - x0, fy = y - y0;
    const a = (y0 * COL_W + x0) * 4, b = a + 4, c = a + COL_W * 4, e = c + 4;
    for (let k = 0; k < 3; k++) out[k] = (T[a + k] * (1 - fx) + T[b + k] * fx) * (1 - fy) + (T[c + k] * (1 - fx) + T[e + k] * fx) * fy;
    return out;
}
const _c = [0, 0, 0];
// transmittance from (h, mu) to the top of the atmosphere (no ground in the way: the callers check)
export function transmittance(air, h, mu, out = [0, 0, 0], exact = false) {
    if (exact) columnsExact(h, mu, _c, 2000); else columns(h, mu, _c);
    for (let k = 0; k < 3; k++) out[k] = Math.exp(-(BETA_R[k] * _c[0] + air.mieExt[k] * _c[1] + BETA_O[k] * _c[2]));
    return out;
}
// the sun (or moon) seen from h km up, el degrees above the horizontal: what's left of its beam (red, green, blue);
// nothing once the ground hides it
export function sunTransmittance(air, el, h = 0, out = [0, 0, 0]) {
    const mu = Math.sin(el * PI / 180);
    if (distGround(Math.max(h, 0), mu) >= 0) { out[0] = out[1] = out[2] = 0; return out; }
    return transmittance(air, Math.max(h, 0), mu, out);
}

// ── Phase functions ──
export const phaseR = (c) => 3 / (16 * PI) * (1 + c * c);
// Cornette-Shanks (Henyey-Greenstein with a Rayleigh-like term): the aerosol's forward lobe
export function phaseM(c, g) {
    const g2 = g * g;
    return 3 / (8 * PI) * (1 - g2) * (1 + c * c) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * c, 1.5));
}

// ── Multiple scattering (Hillaire 2020, section 5.5) ──
// At a point h km up with the light at cosine muL: the light scattered there after two or more bounces, per unit of
// scattering coefficient and of the light's irradiance: the second bounce gathered over the sphere with an isotropic
// phase function (L2), times 1 / (1 - f), f the share of light scattered at that point that scatters again (the
// later bounces as a geometric series). out: [r, g, b] of Ψ, and out.f ([r, g, b]) for the tests
export const MS_DIRS = 8, MS_STEPS = 20;
const _t = [0, 0, 0], _thr = [0, 0, 0], _l2 = [0, 0, 0];
export function multiScatter(air, h, muL, out = [0, 0, 0], dirsSqrt = MS_DIRS, steps = MS_STEPS) {
    const h0 = Math.max(h, 0.001), r0 = RG + h0;
    const lx = Math.sqrt(Math.max(1 - muL * muL, 0));
    const F = out.f || (out.f = [0, 0, 0]);
    _l2[0] = _l2[1] = _l2[2] = 0; F[0] = F[1] = F[2] = 0;
    for (let a = 0; a < dirsSqrt; a++) for (let b = 0; b < dirsSqrt; b++) {
        // (uniform over the sphere: cosine and azimuth)
        const mu = 1 - 2 * (a + 0.5) / dirsSqrt, phi = 2 * PI * (b + 0.5) / dirsSqrt;
        const cosT = Math.sqrt(1 - mu * mu) * Math.cos(phi) * lx + mu * muL;
        const tg = distGround(h0, mu), tMax = tg >= 0 ? tg : distTop(h0, mu), dt = tMax / steps;
        _thr[0] = _thr[1] = _thr[2] = 1;
        for (let i = 0; i < steps; i++) {
            const t = (i + 0.3) * dt, r = Math.sqrt(r0 * r0 + t * t + 2 * r0 * mu * t);
            const hh = Math.max(h0 + t * (t + 2 * r0 * mu) / (r + r0), 0);
            const dR = Math.exp(-hh / HR), dM = Math.exp(-hh / HM), dO = Math.max(0, 1 - Math.abs(hh - O3_MID) / O3_HALF);
            const muS = (t * cosT + r0 * muL) / r;
            const lit = !shadowed(hh, muS);
            if (lit) transmittance(air, hh, muS, _t);
            for (let k = 0; k < 3; k++) {
                const sca = BETA_R[k] * dR + air.mieSca[k] * dM, ext = BETA_R[k] * dR + air.mieExt[k] * dM + BETA_O[k] * dO;
                const stepT = Math.exp(-ext * dt), w = _thr[k] * (1 - stepT) / Math.max(ext, 1e-9);
                if (lit) _l2[k] += w * sca * _t[k] / (4 * PI);
                F[k] += w * sca;
                _thr[k] *= stepT;
            }
        }
        // the ground at the end of the ray sends the sunlight it gets back up (Lambert)
        if (tg >= 0) {
            const muS = (tg * cosT + r0 * muL) / RG;
            if (muS > 0) {
                transmittance(air, 0, muS, _t);
                for (let k = 0; k < 3; k++) _l2[k] += _thr[k] * _t[k] * muS * ATM.GROUND / PI;
            }
        }
    }
    const n = dirsSqrt * dirsSqrt;
    for (let k = 0; k < 3; k++) { F[k] /= n; out[k] = (_l2[k] / n) / (1 - Math.min(F[k], 0.999)); }
    return out;
}

// The table of it. x: the light's cosine as mu = x |x|, x from -1 to 1 (its samples crowd round the terminator, where
// the light falls by orders of magnitude within a few degrees of sun); y: the height as h = 100 km × y² (rows where
// the haze layer is). It holds the logarithm, so that reading between two samples follows that fall instead of
// drawing a straight line over it (which, with the sun 6° down, put fifty times the light into the twilight sky).
// A coarse one here for this file's own marches (the GPU draws its own, MS_SIZE square, with the same mapping).
export const MS_SIZE = 32;
const MS_FLOOR = 1e-12;
const JS_MS_W = 13, JS_MS_H = 7;
function msTable(air) {
    if (air._ms && air._msKey === air.key) return air._ms;
    const T = air._ms || (air._ms = new Float32Array(JS_MS_W * JS_MS_H * 3));
    const o = [0, 0, 0];
    for (let j = 0; j < JS_MS_H; j++) for (let i = 0; i < JS_MS_W; i++) {
        const v = j / (JS_MS_H - 1), x = -1 + 2 * i / (JS_MS_W - 1);
        multiScatter(air, H_ATM * v * v, x * Math.abs(x), o, 4, 8);
        for (let k = 0; k < 3; k++) T[(j * JS_MS_W + i) * 3 + k] = Math.log(Math.max(o[k], MS_FLOOR));
    }
    air._msKey = air.key;
    return T;
}
function msAt(air, h, muL, out) {
    const T = msTable(air);
    const xm = Math.sign(muL) * Math.sqrt(Math.abs(muL));
    const x = Math.max(0, Math.min(1, (xm + 1) / 2)) * (JS_MS_W - 1), y = Math.sqrt(Math.max(0, Math.min(1, h / H_ATM))) * (JS_MS_H - 1);
    const x0 = Math.min(Math.floor(x), JS_MS_W - 2), y0 = Math.min(Math.floor(y), JS_MS_H - 2), fx = x - x0, fy = y - y0;
    const a = (y0 * JS_MS_W + x0) * 3, b = a + 3, c = a + JS_MS_W * 3, e = c + 3;
    for (let k = 0; k < 3; k++) out[k] = Math.exp((T[a + k] * (1 - fx) + T[b + k] * fx) * (1 - fy) + (T[c + k] * (1 - fx) + T[e + k] * fx) * fy);
    return out;
}

// ── The sky ──
// Radiance per unit of the light's irradiance arriving at h km up from the direction with cosine mu from the zenith
// and azimuth az (rad) from the light's, the light at cosine muL: the march the sky-view table's shader does
// (quadratically spaced steps: short ones first, where the haze is). out: [r, g, b]; out.T: what's left of a
// background behind the air ([r, g, b]); out.ground: the ray ends on the ground. ms: false leaves out multiple
// scattering (for the tests)
export const SKY_STEPS = 32;
const _ts = [0, 0, 0], _ps = [0, 0, 0];
export function skyRadiance(air, h, mu, az, muL, out = [0, 0, 0], steps = SKY_STEPS, ms = true) {
    const h0 = Math.max(h, 0.001), r0 = RG + h0;
    const cosT = Math.sqrt(Math.max(1 - mu * mu, 0)) * Math.cos(az) * Math.sqrt(Math.max(1 - muL * muL, 0)) + mu * muL;
    const pR = phaseR(cosT), pM = phaseM(cosT, air.g);
    const tg = distGround(h0, mu), tMax = tg >= 0 ? tg : distTop(h0, mu);
    const T = out.T || (out.T = [1, 1, 1]);
    T[0] = T[1] = T[2] = 1; out[0] = out[1] = out[2] = 0;
    for (let i = 0; i < steps; i++) {
        const a0 = (i / steps) * (i / steps), a1 = ((i + 1) / steps) * ((i + 1) / steps);
        const t = tMax * (a0 + (a1 - a0) * 0.3), dt = tMax * (a1 - a0);
        const r = Math.sqrt(r0 * r0 + t * t + 2 * r0 * mu * t), hh = Math.max(h0 + t * (t + 2 * r0 * mu) / (r + r0), 0);
        const dR = Math.exp(-hh / HR), dM = Math.exp(-hh / HM), dO = Math.max(0, 1 - Math.abs(hh - O3_MID) / O3_HALF);
        const muS = (t * cosT + r0 * muL) / r;
        const lit = !shadowed(hh, muS);
        if (lit) transmittance(air, hh, muS, _ts);
        if (ms) msAt(air, hh, muS, _ps);
        for (let k = 0; k < 3; k++) {
            const sR = BETA_R[k] * dR, sM = air.mieSca[k] * dM, ext = sR + air.mieExt[k] * dM + BETA_O[k] * dO;
            const S = (lit ? (sR * pR + sM * pM) * _ts[k] : 0) + (ms ? (sR + sM) * _ps[k] : 0);
            const stepT = Math.exp(-ext * dt);
            out[k] += T[k] * S * (1 - stepT) / Math.max(ext, 1e-9);
            T[k] *= stepT;
        }
    }
    out.ground = tg >= 0;
    return out;
}
// What the sky-view table holds for that direction: the sky's radiance where the ray leaves the atmosphere; where it
// ends on the ground, the radiance of that air were it thick enough to hide the ground (its in-scatter over what it
// hides: the colour distant ground fades to), running into the horizon's own sky just under it (HORIZON_BLEND), so
// that the two halves meet without a step.
const _hz = [0, 0, 0];
export function skyTable(air, h, mu, az, muL, out = [0, 0, 0], steps = SKY_STEPS) {
    skyRadiance(air, h, mu, az, muL, out, steps);
    if (!out.ground) return out;
    for (let k = 0; k < 3; k++) out[k] /= Math.max(1 - out.T[k], 1e-5);
    const thH = PI - horizonBeta(Math.max(h, 0.001)), w = Math.exp(-(Math.acos(Math.max(-1, Math.min(1, mu))) - thH) / HORIZON_BLEND);
    if (w > 0.01) {
        skyRadiance(air, h, Math.cos(thH - 1e-4), az, muL, _hz, steps);
        for (let k = 0; k < 3; k++) out[k] += (_hz[k] - out[k]) * w;
    }
    return out;
}

// The light of the whole sky on level ground h km up, per unit of the light's irradiance: out.E the irradiance on a
// horizontal surface (red, green, blue), out.zenith the radiance straight up, out.horizon the radiance just above
// the horizon averaged round the compass away from the light's own glow (from 72° off it), out.toward / out.away
// the horizon under the light and opposite it.
// A small quadrature (5 elevations × 6 azimuths over half the sky, which is symmetric about the light).
const QMU = [0.04691, 0.230765, 0.5, 0.769235, 0.95309], QW = [0.118463, 0.239314, 0.284444, 0.239314, 0.118463]; // Gauss-Legendre on 0..1
const _rad = [0, 0, 0];
export function skyLight(air, h, muL, out = {}) {
    const E = out.E || (out.E = [0, 0, 0]), Z = out.zenith || (out.zenith = [0, 0, 0]), Hz = out.horizon || (out.horizon = [0, 0, 0]);
    const To = out.toward || (out.toward = [0, 0, 0]), Aw = out.away || (out.away = [0, 0, 0]);
    E[0] = E[1] = E[2] = 0; Hz[0] = Hz[1] = Hz[2] = 0;
    const NA = 6;
    for (let i = 0; i < QMU.length; i++) for (let a = 0; a < NA; a++) {
        skyRadiance(air, h, QMU[i], PI * (a + 0.5) / NA, muL, _rad, 16);
        const w = QW[i] * QMU[i] * 2 * PI / NA; // ∫ L cosθ dω = ∫∫ L mu dmu dφ
        for (let k = 0; k < 3; k++) E[k] += _rad[k] * w;
    }
    skyRadiance(air, h, 1, 0, muL, _rad, 16); Z[0] = _rad[0]; Z[1] = _rad[1]; Z[2] = _rad[2];
    const muH = 0.035; // 2° up: the bright band on the horizon
    for (let a = 0; a < NA; a += a === 0 ? 2 : 1) {
        skyRadiance(air, h, muH, PI * a / (NA - 1), muL, _rad, 16);
        if (a === 0) { To[0] = _rad[0]; To[1] = _rad[1]; To[2] = _rad[2]; continue; }
        for (let k = 0; k < 3; k++) Hz[k] += _rad[k] * (a === 2 || a === NA - 1 ? 0.5 : 1) / (NA - 3);
        if (a === NA - 1) { Aw[0] = _rad[0]; Aw[1] = _rad[1]; Aw[2] = _rad[2]; }
    }
    return out;
}

// ── Colour rendering ──
// The three wavelengths' radiances become the display's red, green and blue with their colour pushed out from grey
// by SATURATION, as film and camera colour rendering do (a colorimetrically exact Rayleigh sky is a paler blue than
// any photograph of one). The same for everything that comes from the air: the sky, the haze, the sun's colour.
export const SATURATION = 1.35;
export function render3(c, out = c) {
    const l = lum(c);
    for (let k = 0; k < 3; k++) out[k] = Math.max(l + (c[k] - l) * SATURATION, 0);
    return out;
}

// ═══════════════════════════════════════════════════════════════
// The lookup tables (GPU)
// ═══════════════════════════════════════════════════════════════
// The sky-view table: every direction round the camera at its height. x: compass azimuth (wraps); y: the zenith
// angle, the horizon in the middle row and the rows crowded toward it from both sides (Hillaire's mapping: the sky
// changes fastest there): above, the sky's radiance; below, the colour distant ground fades to (skyTable above).
// It is drawn into a render target and copied (on the GPU) into a plain texture that exists from import, which is
// the one the shaders read: three clones a material's uniforms, and would drop a render target's texture, while
// the copies of a plain one share its source and so the one texture on the GPU (clouds.js does the same with the
// cloud-shadow map). One size on every quality: it is redrawn only when something changes, and a size per quality
// would mean a new texture for every material.
export const SKY_W = 192, SKY_H = 128;
const skyTex = new THREE.DataTexture(null, SKY_W, SKY_H, THREE.RGBAFormat, THREE.HalfFloatType);
skyTex.minFilter = skyTex.magFilter = THREE.LinearFilter;
skyTex.wrapS = THREE.RepeatWrapping; skyTex.wrapT = THREE.ClampToEdgeWrapping;
skyTex.generateMipmaps = false;
skyTex.name = 'skyLut';
// (storage only, never data from the CPU: every copy three makes of it for a new material marks the source changed,
// and an upload then would wipe what the GPU drew into it)
skyTex.source.dataReady = false;
skyTex.needsUpdate = true;
// a: the horizon's zenith angle (rad), π minus it, (rows − 1) / rows, 0.5 / rows
export const SKY_LUT_U = {
    skyLut: { value: skyTex },
    skyLutA: { value: new Float32Array([PI / 2, PI / 2, 1 - 1 / SKY_H, 0.5 / SKY_H]) },
};
// the lookup, for any shader (vertex or fragment) given SKY_LUT_U's uniforms: d a unit direction, world space
export const SKY_LUT_GLSL = /* glsl */`
    uniform sampler2D skyLut;
    uniform vec4 skyLutA;
    vec3 skyLutAt(vec3 d) {
        float th = acos(clamp(d.y, -1.0, 1.0));
        float v = th < skyLutA.x ? 0.5 - 0.5 * sqrt(1.0 - th / skyLutA.x) : 0.5 + 0.5 * sqrt(min((th - skyLutA.x) / skyLutA.y, 1.0));
        float u = abs(d.x) + abs(d.z) > 1e-6 ? atan(d.z, d.x) * 0.15915494 + 0.5 : 0.5;
        return texture2D(skyLut, vec2(u, v * skyLutA.z + skyLutA.w)).rgb;
    }`;
// the same mapping on the CPU (for the tests, and for reading the table back): direction → [u, v] in 0..1
export function skyLutUv(dx, dy, dz, h, out = [0, 0]) {
    const beta = horizonBeta(h), thH = PI - beta, th = Math.acos(Math.max(-1, Math.min(1, dy)));
    out[1] = th < thH ? 0.5 - 0.5 * Math.sqrt(1 - th / thH) : 0.5 + 0.5 * Math.sqrt(Math.min((th - thH) / beta, 1));
    out[0] = Math.abs(dx) + Math.abs(dz) > 1e-6 ? Math.atan2(dz, dx) / (2 * PI) + 0.5 : 0.5;
    return out;
}
// ... and back: [u, v] → the zenith angle and azimuth of that texel
export function skyLutDir(u, v, h, out = [0, 0]) {
    const beta = horizonBeta(h), thH = PI - beta;
    out[0] = v < 0.5 ? thH * (1 - (1 - 2 * v) * (1 - 2 * v)) : thH + beta * (2 * v - 1) * (2 * v - 1);
    out[1] = (u - 0.5) * 2 * PI;
    return out;
}

const g = (x) => { const s = String(x); return /[.e]/.test(s) ? s : s + '.0'; };
const v3 = (a) => `vec3(${a.map(g).join(', ')})`;
// the model, as the JavaScript above has it (same names, same steps)
const ATM_GLSL = /* glsl */`
    precision highp float;
    #define PI 3.14159265359
    const float RG = ${g(RG)}, RT = ${g(RT)}, H_ATM = ${g(H_ATM)}, H_TOP = ${g(H_TOP)};
    const vec3 BETA_R = ${v3(BETA_R)}, BETA_O = ${v3(BETA_O)};
    uniform sampler2D colLut;
    uniform vec3 mieSca, mieExt;
    uniform float mieG;
    float distTop(float h, float mu) { float r = RG + h; return -r * mu + sqrt(max(r * r * mu * mu + (H_ATM - h) * (RT + r), 0.0)); }
    float distGround(float h, float mu) {
        float r = RG + h, disc = r * r * mu * mu - h * (2.0 * RG + h);
        return mu < 0.0 && disc >= 0.0 ? -r * mu - sqrt(disc) : -1.0;
    }
    bool shadowed(float h, float muL) { float r = RG + h; return muL < 0.0 && h * (2.0 * RG + h) < r * r * muL * muL; }
    vec3 atmColumns(float h, float mu) {
        float rho = sqrt(max(h * (2.0 * RG + h), 0.0)), d = distTop(h, mu), dMin = H_ATM - h, dMax = rho + H_TOP;
        vec2 x = clamp(vec2((d - dMin) / (dMax - dMin), rho / H_TOP), 0.0, 1.0);
        return texture2D(colLut, (x * vec2(${g(COL_W - 1)}, ${g(COL_H - 1)}) + 0.5) / vec2(${g(COL_W)}, ${g(COL_H)})).rgb;
    }
    vec3 transmittance(float h, float mu) { vec3 n = atmColumns(h, mu); return exp(-(BETA_R * n.x + mieExt * n.y + BETA_O * n.z)); }
    void medium(float h, out vec3 sR, out vec3 sM, out vec3 ext) {
        float dR = exp(-h / ${g(HR)}), dM = exp(-h / ${g(HM)}), dO = max(0.0, 1.0 - abs(h - ${g(O3_MID)}) / ${g(O3_HALF)});
        sR = BETA_R * dR; sM = mieSca * dM; ext = sR + mieExt * dM + BETA_O * dO;
    }`;
const TRI_VERT = /* glsl */`void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MS_FRAG = /* glsl */`
    ${ATM_GLSL}
    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5) / ${g(MS_SIZE - 1)};
        float xm = uv.x * 2.0 - 1.0, muL = xm * abs(xm), h0 = max(H_ATM * uv.y * uv.y, 0.001), r0 = RG + h0;
        float lx = sqrt(max(1.0 - muL * muL, 0.0));
        vec3 L2 = vec3(0.0), F = vec3(0.0);
        for (int a = 0; a < ${MS_DIRS}; a++) for (int b = 0; b < ${MS_DIRS}; b++) {
            float mu = 1.0 - 2.0 * (float(a) + 0.5) / ${g(MS_DIRS)}, phi = 2.0 * PI * (float(b) + 0.5) / ${g(MS_DIRS)};
            float cosT = sqrt(1.0 - mu * mu) * cos(phi) * lx + mu * muL;
            float tg = distGround(h0, mu), tMax = tg >= 0.0 ? tg : distTop(h0, mu), dt = tMax / ${g(MS_STEPS)};
            vec3 thr = vec3(1.0);
            for (int i = 0; i < ${MS_STEPS}; i++) {
                float t = (float(i) + 0.3) * dt, r = sqrt(r0 * r0 + t * t + 2.0 * r0 * mu * t);
                float hh = max(h0 + t * (t + 2.0 * r0 * mu) / (r + r0), 0.0);
                float muS = (t * cosT + r0 * muL) / r;
                vec3 sR, sM, ext; medium(hh, sR, sM, ext);
                vec3 stepT = exp(-ext * dt), w = thr * (1.0 - stepT) / max(ext, 1e-9), sca = sR + sM;
                if (!shadowed(hh, muS)) L2 += w * sca * transmittance(hh, muS) * (1.0 / (4.0 * PI));
                F += w * sca;
                thr *= stepT;
            }
            if (tg >= 0.0) {
                float muS = (tg * cosT + r0 * muL) / RG;
                if (muS > 0.0) L2 += thr * transmittance(0.0, muS) * (muS * ${g(ATM.GROUND)} / PI);
            }
        }
        float n = ${g(MS_DIRS * MS_DIRS)};
        gl_FragColor = vec4(log(max((L2 / n) / (1.0 - min(F / n, 0.999)), ${g(MS_FLOOR)})), 1.0);
    }`;
// how far below the horizon the haze's colour runs into the horizon's own (rad: it is all but gone 5° down)
export const HORIZON_BLEND = 0.02;
const SKY_FRAG = /* glsl */`
    ${ATM_GLSL}
    uniform sampler2D msLut;
    uniform float camH, sat;
    uniform vec2 lutSize;
    uniform vec3 lightDir[2], lightE[2];   // the sun and the moon: world direction, irradiance (exposure included)
    uniform vec4 veil;                     // the overcast above: its radiance at the zenith, how much of the sky it covers
    uniform vec3 floorL;                   // the night's own glow
    vec3 msAt(float h, float muL) {
        vec2 x = clamp(vec2(sign(muL) * sqrt(abs(muL)) * 0.5 + 0.5, sqrt(h / H_ATM)), 0.0, 1.0);
        return exp(texture2D(msLut, (x * ${g(MS_SIZE - 1)} + 0.5) / ${g(MS_SIZE)}).rgb);
    }
    float phaseR(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
    float phaseM(float c, float g) { float g2 = g * g; return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
    // The light the air scatters toward the eye, h0 km up, along the ray with cosine mu from the zenith for tMax km
    // (the direction d: its cosines with the two lights give the phase functions); thr: what is left of a background
    vec3 march(float h0, float mu, vec3 d, float tMax, out vec3 thr) {
        float r0 = RG + h0;
        bool on0 = dot(lightE[0], vec3(1.0)) > 0.0, on1 = dot(lightE[1], vec3(1.0)) > 0.0;
        float c0 = dot(d, lightDir[0]), c1 = dot(d, lightDir[1]);
        float pR0 = phaseR(c0), pM0 = phaseM(c0, mieG), pR1 = phaseR(c1), pM1 = phaseM(c1, mieG);
        vec3 L = vec3(0.0);
        thr = vec3(1.0);
        for (int i = 0; i < ${SKY_STEPS}; i++) {
            float a0 = float(i) / ${g(SKY_STEPS)}, a1 = float(i + 1) / ${g(SKY_STEPS)};
            a0 *= a0; a1 *= a1;
            float t = tMax * (a0 + (a1 - a0) * 0.3), dt = tMax * (a1 - a0);
            float r = sqrt(r0 * r0 + t * t + 2.0 * r0 * mu * t), hh = max(h0 + t * (t + 2.0 * r0 * mu) / (r + r0), 0.0);
            vec3 sR, sM, ext; medium(hh, sR, sM, ext);
            vec3 S = vec3(0.0);
            if (on0) {
                float muS = (t * c0 + r0 * lightDir[0].y) / r;
                vec3 Ts = shadowed(hh, muS) ? vec3(0.0) : transmittance(hh, muS);
                S += lightE[0] * ((sR * pR0 + sM * pM0) * Ts + (sR + sM) * msAt(hh, muS));
            }
            if (on1) {
                float muS = (t * c1 + r0 * lightDir[1].y) / r;
                vec3 Ts = shadowed(hh, muS) ? vec3(0.0) : transmittance(hh, muS);
                S += lightE[1] * ((sR * pR1 + sM * pM1) * Ts + (sR + sM) * msAt(hh, muS));
            }
            vec3 stepT = exp(-ext * dt);
            L += thr * S * (1.0 - stepT) / max(ext, 1e-9);
            thr *= stepT;
        }
        return L;
    }
    void main() {
        vec2 uv = gl_FragCoord.xy / lutSize;
        float v = clamp((uv.y - 0.5 / lutSize.y) / (1.0 - 1.0 / lutSize.y), 0.0, 1.0);
        float h0 = max(camH, 0.001), r0 = RG + h0;
        float beta = acos(min(sqrt(h0 * (2.0 * RG + h0)) / r0, 1.0)), thH = PI - beta;
        float th = v < 0.5 ? thH * (1.0 - (1.0 - 2.0 * v) * (1.0 - 2.0 * v)) : thH + beta * (2.0 * v - 1.0) * (2.0 * v - 1.0);
        float az = (uv.x - 0.5) * 2.0 * PI, mu = cos(th), st = sin(th);
        float tg = distGround(h0, mu);
        vec3 thr;
        vec3 L = march(h0, mu, vec3(st * cos(az), mu, st * sin(az)), tg >= 0.0 ? tg : distTop(h0, mu), thr);
        if (tg >= 0.0) {
            // below the horizon: the colour of that air were it thick enough to hide the ground (see skyTable), running
            // into the horizon's own sky just under it: the table has no step where the two meet
            L /= max(1.0 - thr, 1e-5);
            float w = exp(-(th - thH) / ${g(HORIZON_BLEND)});
            if (w > 0.01) {
                float muH = cos(thH - 1e-4), sH = sin(thH - 1e-4);
                vec3 thrH;
                vec3 Hz = march(h0, muH, vec3(sH * cos(az), muH, sH * sin(az)), distTop(h0, muH), thrH);
                L = mix(L, Hz, w);
            }
        }
        // colour rendering (render3), then the overcast and the night's glow (already display colours)
        L = max(mix(vec3(dot(L, vec3(0.2126, 0.7152, 0.0722))), L, sat), 0.0);
        L = mix(L, veil.rgb * (0.5 + 0.5 * max(mu, 0.0)), veil.a) + floorL;
        gl_FragColor = vec4(L, 1.0);
    }`;

const _prevClear = new THREE.Color();
export class Atmosphere {
    constructor(renderer) {
        this.renderer = renderer;
        this.skyTex = skyTex;
        this.skyRT = new THREE.WebGLRenderTarget(SKY_W, SKY_H, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        // the static column table: half floats (linear filtering of those is in every WebGL 2)
        const C = columnLUT(), half = new Uint16Array(C.length);
        for (let i = 0; i < C.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(C[i], 65000));
        this.colTex = new THREE.DataTexture(half, COL_W, COL_H, THREE.RGBAFormat, THREE.HalfFloatType);
        this.colTex.minFilter = this.colTex.magFilter = THREE.LinearFilter;
        this.colTex.needsUpdate = true;
        this.msRT = new THREE.WebGLRenderTarget(MS_SIZE, MS_SIZE, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        const air = { colLut: { value: this.colTex }, mieSca: { value: new THREE.Vector3() }, mieExt: { value: new THREE.Vector3() }, mieG: { value: ATM.G } };
        this.airU = air;
        const mat = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms: { ...air, ...uniforms }, vertexShader: TRI_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
        this.msMat = mat(MS_FRAG, {});
        this.skyMat = mat(SKY_FRAG, {
            msLut: { value: this.msRT.texture }, camH: { value: 0.001 }, sat: { value: SATURATION }, lutSize: { value: new THREE.Vector2(SKY_W, SKY_H) },
            lightDir: { value: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)] }, lightE: { value: [new THREE.Vector3(), new THREE.Vector3()] },
            veil: { value: new THREE.Vector4() }, floorL: { value: new THREE.Vector3() },
        });
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
        this.mesh = new THREE.Mesh(tri, this.msMat);
        this.mesh.frustumCulled = false;
        this.scene = new THREE.Scene();
        this.scene.add(this.mesh);
        this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.airKey = '';
        this.dirty = true;       // the sky table needs redrawing
        this.camH = -1;          // the height it was drawn for (km)
        this.draws = 0;          // tables drawn so far (for the bench and the tests)
        // The fog's vertex shader reads the sky-view table (world.js patchFogChunks): one texture more than a
        // material's fragment shader has. WebGL 2 counts the two stages apart (16 each at the least, 32 together);
        // three counts them together against the fragment limit and warns on every draw of a material that is at it
        // (the terrain on ultra): let it count one further, which is all this adds.
        const cap = renderer && renderer.capabilities, gl = renderer && renderer.getContext && renderer.getContext();
        if (cap && gl && gl.getParameter) cap.maxTextures = Math.min(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || cap.maxTextures, cap.maxTextures + 1);
    }

    // The air and what lights it. air: makeAir(); lights: up to two { dir (unit Vector3, world), E ([r, g, b]: its
    // irradiance above the air, exposure included) }; veil: [r, g, b, cover] the overcast; floor: [r, g, b]
    set({ air, lights, veil, floor }) {
        const a = this.airU, s = this.skyMat.uniforms;
        if (air.key !== this.airKey) {
            this.airKey = air.key; this.msDirty = true;
            a.mieSca.value.fromArray(air.mieSca); a.mieExt.value.fromArray(air.mieExt); a.mieG.value = air.g;
        }
        for (let i = 0; i < 2; i++) {
            const l = lights[i];
            if (l) { s.lightDir.value[i].copy(l.dir); s.lightE.value[i].fromArray(l.E); } else s.lightE.value[i].set(0, 0, 0);
        }
        if (veil) s.veil.value.set(veil[0], veil[1], veil[2], s.veil.value.w); else s.veil.value.set(0, 0, 0, 0); // (the cover: setCover)
        s.floorL.value.fromArray(floor || [0, 0, 0]);
        this.dirty = true;
    }

    // how much of the sky the overcast covers as the camera sees it (under the weather's deck or above it)
    setCover(c) {
        const v = this.skyMat.uniforms.veil.value;
        if (Math.abs(v.w - c) < 0.003) return;
        v.w = c;
        this.dirty = true;
    }

    // Redraw what has changed: the multiple-scattering table when the air has, the sky view when anything has or the
    // camera has climbed or sunk enough to show (camY: its height in metres). Cheap enough to do in the frame it's
    // needed: a 32 × 32 and a 192 × 128 pass.
    update(camY, force = false) {
        const h = Math.max(camY, 1) / 1000;
        // (a climb or a dive redraws it every 5 m + half a percent of height: a few times a second in a dogfight, a
        // step far too small to see)
        if (!force && !this.dirty && !this.msDirty && Math.abs(h - this.camH) < 0.005 + 0.005 * this.camH) return false;
        const r = this.renderer;
        if (!r) return false;
        const prevRT = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel(), prevAuto = r.autoClear, prevXr = r.xr.enabled;
        r.getClearColor(_prevClear);
        const prevAlpha = r.getClearAlpha();
        r.autoClear = false; r.xr.enabled = false;
        if (this.msDirty) {
            this.mesh.material = this.msMat;
            r.setRenderTarget(this.msRT);
            r.render(this.scene, this.cam);
            this.msDirty = false;
        }
        this.camH = h;
        this.skyMat.uniforms.camH.value = h;
        const beta = horizonBeta(h);
        SKY_LUT_U.skyLutA.value[0] = PI - beta; SKY_LUT_U.skyLutA.value[1] = beta;
        this.mesh.material = this.skyMat;
        r.setRenderTarget(this.skyRT);
        r.render(this.scene, this.cam);
        // into the texture the shaders read, straight from the framebuffer just drawn
        const gl = r.getContext(), st = r.state;
        let tp = r.properties.get(skyTex);
        if (!tp.__webglTexture || skyTex.version !== tp.__version) { r.initTexture(skyTex); tp = r.properties.get(skyTex); }
        if (tp.__webglTexture) {
            st.activeTexture(gl.TEXTURE0);
            st.bindTexture(gl.TEXTURE_2D, tp.__webglTexture);
            gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, SKY_W, SKY_H);
            st.unbindTexture();
        } else r.copyTextureToTexture(this.skyRT.texture, skyTex);
        r.setRenderTarget(prevRT, face, mip);
        r.autoClear = prevAuto; r.xr.enabled = prevXr;
        r.setClearColor(_prevClear, prevAlpha);
        this.dirty = false;
        this.draws++;
        return true;
    }
}
