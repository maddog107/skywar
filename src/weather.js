// ═══════════════════════════════════════════════════════════════
// The sky model (docs/WAR.md "Night and weather"): time of day that can run, weather that changes — everywhere at
// once over a transition, or behind a front that moves across the map — and the fog, rain and cloud that decide
// what can be seen. One set of functions answers both the shaders and the game:
//   • the fog shader (world.js FOG_GLSL) and fogAmountJS() here: haze and low mist (exponential height layers),
//     plus a ground-fog layer with a flat top (radiation / valley fog, sea fog banks)
//   • the rain: a rate (mm/h) from the clouds' weather map (under the rain deck, and much heavier under tall
//     cumulonimbus cells), extinction from the rate — the cloud march draws it as rain shafts (clouds.js), the
//     game sees through it with rainTau() / transmittance()
//   • the clouds' own density field (clouds.js densityAt, the same field the march draws)
// Visibility numbers are real ones: Koschmieder (visual range V = 3.912 / σ at a 2 % contrast threshold), fog below
// 1 km, mist 1-2 km, haze 2-5 km; rain extinction from the optical-link literature (α ≈ 1.076 R^0.67 dB/km, R in
// mm/h: light 2.5 mm/h → ~9 km, heavy 25 mm/h → ~1.8 km, a thunderstorm core 60-100 mm/h → under 1 km); radiation fog
// forms on clear, calm nights in low ground, is thickest just after sunrise and burns off a few hours later; low
// stratus is fog off the ground (a ceiling a few hundred metres up); cumulonimbus bases ~1 km with cells a few km
// across that live ~20-30 minutes; thunder travels at 343 m/s (3 s a kilometre).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

// ── Time of day ──
// Solar time (h) at a latitude of 33° N at the equinox (the map is southern California): sunrise 6:00, sunset
// 18:00. The menu's four times are these hours (the sun where the old fixed times put it).
export const LAT = 33 * Math.PI / 180;
export const DECL = 0;
export const KEY_HOURS = { dawn: 6.45, day: 11.2, dusk: 17.75, night: 23 };
const DEG = Math.PI / 180;

// the sun's elevation and azimuth (degrees; azimuth from north, clockwise) at solar time `hour`; out (optional
// Vector3) gets its direction (world: +x east, -z north, +y up)
export function sunAt(hour, out = null) {
    const H = (hour - 12) * 15 * DEG;
    const sinEl = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(DECL) * Math.cos(LAT)) + Math.PI;
    az = ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (out) out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    return { el: el / DEG, az: az / DEG };
}
// the moon: the light the night palette was made with (high in the north), steady through the night
export const MOON_DIR = new THREE.Vector3(0.12, 0.62, -0.78).normalize();

// time key for what goes by the old four times (lights on, sensors' light factors): from the sun's elevation
export function timeKeyFor(hour) {
    const { el } = sunAt(hour);
    const h = ((hour % 24) + 24) % 24;
    if (el > 12) return 'day';
    if (el > -5) return h < 12 ? 'dawn' : 'dusk';
    return 'night';
}
// darkness 0 (sun well up) … 1 (full night): civil twilight ends at -6°, it's night by -12°
export function nightOf(hour) {
    const { el } = sunAt(hour);
    return 1 - smooth(-11, 4, el);
}

// ── Weather kinds ──
// clouds: coverage threshold, base (m), tallest tops above the base, base variation, deck amount / base / thickness
// sky: overcast (grey sky, soft shadows), sev (how far the palette greys, 0..1)
// rain: mm/h under the deck (continuous rain), mm/h in the core of a tall cumulus (a cell)
// fog: ground-fog extinction (1/m) and its top (m above sea level); banks (0 even … 1 patchy banks)
// radiation: allows dawn radiation fog in low ground after a clear night
// wind (m/s), turbulence (0..1), lightning (flashes a minute near the camera)
export const WEATHER_KINDS = {
    clear:    { thr: 0.56, base: 1300, thick: 560, baseVar: 160, deck: 0, deckY: 2400, deckThick: 650, overcast: 0, sev: 0, rain: 0, cells: 0, fog: 0, fogTop: 120, banks: 0.8, radiation: 1, wind: 3.6, turb: 0.05, lightning: 0, label: 'CLEAR' },
    cloudy:   { thr: 0.42, base: 1250, thick: 800, baseVar: 200, deck: 0, deckY: 2400, deckThick: 650, overcast: 0, sev: 0.35, rain: 0, cells: 1.5, fog: 0, fogTop: 150, banks: 0.8, radiation: 0.7, wind: 5, turb: 0.18, lightning: 0, label: 'CLOUDY' },
    rain:     { thr: 0.36, base: 1050, thick: 1000, baseVar: 160, deck: 0.75, deckY: 2400, deckThick: 650, overcast: 0.6, sev: 0.7, rain: 3, cells: 14, fog: 0, fogTop: 150, banks: 0, radiation: 0, wind: 8.6, turb: 0.45, lightning: 0, label: 'RAIN' },
    storm:    { thr: 0.3, base: 950, thick: 2200, baseVar: 160, deck: 1.2, deckY: 2400, deckThick: 650, overcast: 0.85, sev: 1, rain: 7, cells: 75, fog: 0, fogTop: 150, banks: 0, radiation: 0, wind: 17.2, turb: 1, lightning: 7, label: 'STORM' },
    // radiation / advection fog: dense fog in the low ground and over the sea, clear above it
    fog:      { thr: 0.62, base: 1500, thick: 400, baseVar: 160, deck: 0, deckY: 2400, deckThick: 650, overcast: 0, sev: 0.15, rain: 0, cells: 0, fog: 0.011, fogTop: 170, banks: 0.25, radiation: 0, wind: 1.5, turb: 0, lightning: 0, label: 'FOG' },
    // low stratus: a grey ceiling ~450 m up (the coast's marine layer), drizzle, sea fog banks under it
    overcast: { thr: 0.52, base: 1400, thick: 500, baseVar: 160, deck: 1.3, deckY: 450, deckThick: 500, overcast: 0.7, sev: 0.6, rain: 0.4, cells: 0, fog: 0.004, fogTop: 260, banks: 0.9, radiation: 0, wind: 4.5, turb: 0.15, lightning: 0, label: 'LOW CLOUD' },
};
export const KIND_NAMES = Object.keys(WEATHER_KINDS);
const NUM_KEYS = ['thr', 'base', 'thick', 'baseVar', 'deck', 'deckY', 'deckThick', 'overcast', 'sev', 'rain', 'cells', 'fog', 'fogTop', 'banks', 'radiation', 'wind', 'turb', 'lightning'];

export function copyParams(src, out = {}) { for (const k of NUM_KEYS) out[k] = src[k]; out.kind = src.kind || src.label; return out; }
export function lerpParams(a, b, t, out = {}) {
    for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
    // (a deck that comes or goes changes its amount, not its height: a rain deck doesn't slide down into a stratus)
    if (!(a.deck > 0)) { out.deckY = b.deckY; out.deckThick = b.deckThick; }
    else if (!(b.deck > 0)) { out.deckY = a.deckY; out.deckThick = a.deckThick; }
    return out;
}
export function kindParams(kind) { const K = WEATHER_KINDS[kind] || WEATHER_KINDS.clear; const p = copyParams(K); p.kind = WEATHER_KINDS[kind] ? kind : 'clear'; return p; }

// ── Visibility physics ──
// Koschmieder: visual range (m) for an extinction coefficient σ (1/m), 2 % contrast
export const KOSCHMIEDER = 3.912;
export const visualRange = (sigma) => KOSCHMIEDER / Math.max(sigma, 1e-7);
// rain extinction (1/m) for a rain rate R (mm/h): α = 1.076 R^0.67 dB/km
export function rainSigma(R) { return R > 0 ? 1.076 * Math.pow(R, 0.67) * 0.2303e-3 : 0; }
export const RAIN_SIGMA_GLSL = /* glsl */`
    float rainSigma(float R) { return R > 0.0 ? 2.478e-4 * pow(R, 0.67) : 0.0; }`;

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const smoothstep = smooth;

// optical depth of an exponential height layer (density at sea level, 1 / scale height) along a ray from height y0
// to y1 of length L (the fog shader's skyFogLayer)
export function expLayerTau(dens, k, y0, y1, L) {
    const e0 = Math.exp(-k * Math.max(y0, 0)), e1 = Math.exp(-k * Math.max(y1, 0));
    const dk = k * (y1 - y0);
    return dens * L * (Math.abs(dk) > 1e-4 ? (e0 - e1) / dk : e0);
}
// the ground fog: extinction D below a flat top H, fading out over w metres above it (a logistic profile); optical
// depth along a ray from height y0 to y1 of length L (the fog shader's groundFogTau)
const softplus = (x) => Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)));
export function groundFogTau(D, H, w, y0, y1, L) {
    if (!(D > 0) || !(L > 0)) return 0;
    const dy = y1 - y0;
    if (Math.abs(dy) < 0.01) return D * L / (1 + Math.exp(Math.min((y0 - H) / w, 80)));
    const F = (y) => y - w * softplus((y - H) / w);
    return D * L * (F(y1) - F(y0)) / dy;
}
export const FOG_W = 30; // the ground fog's top softness (m)

// Weather-front mix: 0 = the weather ahead of it (A), 1 = behind it (B). front: { x, z, nx, nz (the way it moves),
// w (half the transition zone, m) }
export function frontMix(front, x, z) {
    if (!front || !(front.w > 0)) return front && front.done ? 1 : 0;
    const d = (x - front.x) * front.nx + (z - front.z) * front.nz;
    return 1 - smooth(-front.w, front.w, d);
}

// Fog banks: patchy fog drifting with the wind (value noise, the same lattice hash as the shader)
function hash2(x, y) {
    let px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(x * 0.1031);
    const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
    px += d; py += d; pz += d;
    return fract((px + py) * pz);
}
function fract(x) { return x - Math.floor(x); }
function vnoise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export const BANK_SCALE = 1 / 4200;
export function bankMask(x, z, amt, driftX = 0, driftZ = 0) {
    if (!(amt > 0)) return 1;
    const qx = (x - driftX) * BANK_SCALE, qz = (z - driftZ) * BANK_SCALE;
    const n = vnoise2(qx, qz) * 0.65 + vnoise2(qx * 2.7 + 5.3, qz * 2.7 + 5.3) * 0.35;
    return 1 + (smooth(0.4, 0.7, n) - 1) * amt;
}
// the GLSL twin of the above (world.js puts it in FOG_GLSL)
export const BANK_GLSL = /* glsl */`
    float wxHash2(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float wxNoise2(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        float a = wxHash2(i), b = wxHash2(i + vec2(1.0, 0.0)), c = wxHash2(i + vec2(0.0, 1.0)), d = wxHash2(i + vec2(1.0, 1.0));
        return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
    }
    float wxBank(vec2 xz, float amt) {
        if (amt <= 0.0) return 1.0;
        vec2 q = (xz - skyFogH.xy) * ${BANK_SCALE.toFixed(8)};
        float n = wxNoise2(q) * 0.65 + wxNoise2(q * 2.7 + 5.3) * 0.35;
        return mix(1.0, smoothstep(0.4, 0.7, n), amt);
    }`;

// ═══════════════════════════════════════════════════════════════
// The shared fog parameters (world.js SKY_FOG adds these to every material that fogs; the arrays are shared by
// reference): e: ground fog A density, top, B density, top; f: front x, z, nx, nz; g: front half width (0: none),
// banks A, banks B, the camera's front mix; h: bank drift x, z, 0, 0
export const WX_FOG = {
    e: new Float32Array([0, 120, 0, 120]),
    f: new Float32Array([0, 0, 1, 0]),
    g: new Float32Array([0, 0, 0, 0]),
    h: new Float32Array([0, 0, 0, 0]),
};

// the fog shader's ground-fog term, per fragment (FOG_GLSL uses it; skyFogE..H are declared there)
export const GROUND_FOG_GLSL = /* glsl */`
    float wxSoftplus(float x) { return max(x, 0.0) + log(1.0 + exp(-abs(x))); }
    float wxLayer(float D, float H, float y0, float y1, float L) {
        float dy = y1 - y0, w = ${FOG_W.toFixed(1)};
        if (abs(dy) < 0.01) return D * L / (1.0 + exp(min((y0 - H) / w, 80.0)));
        float F0 = y0 - w * wxSoftplus((y0 - H) / w), F1 = y1 - w * wxSoftplus((y1 - H) / w);
        return D * L * (F1 - F0) / dy;
    }
    float wxFront(vec2 xz) {
        if (skyFogG.x <= 0.0) return skyFogG.w;
        return 1.0 - smoothstep(-skyFogG.x, skyFogG.x, dot(xz - skyFogF.xy, skyFogF.zw));
    }
    // optical depth of the ground fog along the ray from the camera (world p0) to the point p1: its density and top
    // halfway between the camera's and the point's (the front and the banks there)
    float groundFogTau(vec3 p0, vec3 p1, float L) {
        if (skyFogE.x <= 0.0 && skyFogE.z <= 0.0) return 0.0;
        float k1 = wxFront(p1.xz), k = 0.5 * (skyFogG.w + k1);
        float D = mix(skyFogE.x, skyFogE.z, k), H = mix(skyFogE.y, skyFogE.w, k);
        if (D <= 0.0) return 0.0;
        float bank = 0.5 * (wxBank(p0.xz, mix(skyFogG.y, skyFogG.z, skyFogG.w)) + wxBank(p1.xz, mix(skyFogG.y, skyFogG.z, k1)));
        return wxLayer(D * bank, H, p0.y, p1.y, L);
    }`;

// ═══════════════════════════════════════════════════════════════
// Sky palettes at the old four times, blended by the sun's elevation (world.js applies them)
const hex = (h) => new THREE.Color(h);
export const PALETTES = {
    day: {
        zenith: hex(0x2463b4), horizon: hex(0xb3cde4), sun: hex(0xfff1dc), sunI: 3.3, hemiSky: hex(0x9cc0e4), hemiGround: hex(0x5a5236), hemiI: 0.5, envI: 0.62,
        fogDensity: 0.000062, glow: hex(0xffe2b8), belt: hex(0x000000), clouds: hex(0xffffff), cloudShadow: hex(0x8e9db2), water: hex(0x14506c), mist: 0.00012, mistH: 60, haze: 1500,
    },
    dawn: {
        zenith: hex(0x2d4f88), horizon: hex(0xc8b4b4), sun: hex(0xffb070), sunI: 2.5, hemiSky: hex(0x8aa4cc), hemiGround: hex(0x4b3f33), hemiI: 0.45, envI: 0.55,
        fogDensity: 0.00007, glow: hex(0xff9a50), belt: hex(0x3a2436), clouds: hex(0xffd2b0), cloudShadow: hex(0x6f6a88), water: hex(0x183248), mist: 0.0005, mistH: 80, haze: 1500,
    },
    dusk: {
        zenith: hex(0x213670), horizon: hex(0xb49aa2), sun: hex(0xff8a3c), sunI: 2.3, hemiSky: hex(0x7f7fb0), hemiGround: hex(0x40302a), hemiI: 0.42, envI: 0.55,
        fogDensity: 0.00007, glow: hex(0xff6a20), belt: hex(0x40263c), clouds: hex(0xffb088), cloudShadow: hex(0x62506e), water: hex(0x1a2a40), mist: 0.00045, mistH: 70, haze: 1500,
    },
    night: {
        zenith: hex(0x02050d), horizon: hex(0x0f1a2e), sun: hex(0x9fb6e0), sunI: 0.35, hemiSky: hex(0x33456b), hemiGround: hex(0x10141a), hemiI: 0.3, envI: 0.6,
        fogDensity: 0.00008, glow: hex(0x3a4a70), belt: hex(0x000000), clouds: hex(0x39455e), cloudShadow: hex(0x161c28), water: hex(0x040b14), mist: 0.0004, mistH: 70, haze: 1500,
    },
};
const COLOR_KEYS = ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'glow', 'belt', 'clouds', 'cloudShadow', 'water'];
const SCALAR_KEYS = ['sunI', 'hemiI', 'envI', 'fogDensity', 'mist', 'mistH', 'haze'];
export function newPalette() { const P = {}; for (const k of COLOR_KEYS) P[k] = new THREE.Color(); for (const k of SCALAR_KEYS) P[k] = 0; P.overcast = 0; return P; }
function mixPalette(out, a, b, t) {
    for (const k of COLOR_KEYS) out[k].copy(a[k]).lerp(b[k], t);
    for (const k of SCALAR_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
}
// the palette at solar time `hour` (before the weather): day above 20° of sun, dawn / dusk around the horizon, night
// below -12°; the four old times land exactly on their own palettes
export function paletteAt(hour, out = newPalette()) {
    const { el } = sunAt(hour);
    const h = ((hour % 24) + 24) % 24;
    const twi = h < 12 ? PALETTES.dawn : PALETTES.dusk;
    if (el >= 6) mixPalette(out, twi, PALETTES.day, smooth(6, 22, el));
    else if (el >= 2) mixPalette(out, twi, twi, 0);
    else mixPalette(out, PALETTES.night, twi, smooth(-11, 2, el));
    return out;
}
// the weather's greying of a palette (the old World.applyWeather, continuous in its severity)
const GREY = hex(0x6f7780), DARK = hex(0x3a4048), CLOUD_GREY = hex(0x9aa2ab), CLOUD_SHADE = hex(0x3c434c), WATER_GREY = hex(0x1d2a33), SUN_GREY = hex(0xc8ccd2);
export function applyWeatherToPalette(P, W) {
    const k = W.sev;
    P.overcast = W.overcast;
    if (!(k > 0)) return P;
    P.zenith.lerp(DARK, 0.55 * k);
    P.horizon.lerp(GREY, 0.6 * k);
    P.glow.lerp(GREY, 0.8 * k);
    P.belt.multiplyScalar(1 - k);
    P.sunI *= 1 - 0.65 * k;
    P.hemiI *= 1 + 0.3 * k;
    // (rain now thickens the air itself — rainSigma — so the haze thickens less than it used to)
    P.fogDensity *= 1 + (W.rain > 0 || W.cells > 5 ? 1.0 : 1.8) * k;
    P.mist = P.mist * (1 + k) + 0.00015 * k; P.mistH += 40 * k;
    P.clouds.lerp(CLOUD_GREY, 0.7 * k);
    P.cloudShadow.lerp(CLOUD_SHADE, 0.8 * k);
    P.water.lerp(WATER_GREY, 0.6 * k);
    P.sun.lerp(SUN_GREY, 0.6 * k);
    return P;
}

// radiation fog through a clear night: forms after midnight in the low ground, thickest just after sunrise, gone
// by mid-morning (0..1)
export function radiationFog(hour) {
    const h = ((hour % 24) + 24) % 24;
    if (h > 12) return smooth(22, 24, h) * 0.35;
    return Math.max(smooth(0, 4, h) * 0.35, smooth(3, 6.2, h)) * (1 - smooth(7.2, 9.5, h));
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _wm = [0, 0, 0, 0];

// ═══════════════════════════════════════════════════════════════
// The model the world owns (world.wx). The game's facade is weathersys.js (game.weather).
export class Weather {
    constructor(world) {
        this.world = world;
        this.hour = KEY_HOURS.day;
        this.timeScale = 0;          // sky clock: game seconds per second (0 = the time of day stands still)
        this.A = kindParams('clear');   // the weather ahead of a front (everywhere, when there's no front)
        this.B = kindParams('clear');   // behind it
        this.front = null;           // { x, z, nx, nz, w, speed, kind } or null
        this.tr = null;              // a transition in progress: { from: {A, B}, to: {A, B}, t, T }
        this.local = kindParams('clear'); // the weather where the camera is
        this.kind = 'clear';         // its name (world.weather)
        this.P = newPalette();
        this.dirty = true;
        this.bakeT = 0;
        this.windAngle = Math.atan2(-0.55, 0.83); // the usual wind: from the west-south-west (x, z of STREET_DIR)
        this.drift = new THREE.Vector2();         // fog banks drift with the wind
        this.lightningT = 6;
        this.thunder = [];           // { at (game time), dist }
        this.gustSeed = Math.random() * 1000;
        this.camPos = new THREE.Vector3();
        this.groundH = null;         // (x, z) → ground height (world.js sets it)
    }

    // ── state ──
    get night() { return nightOf(this.hour); }
    get timeKey() { return timeKeyFor(this.hour); }

    // weather everywhere: now (transition 0) or blended in over `transition` seconds
    set(kind, { transition = 0 } = {}) {
        const to = kindParams(kind);
        if (transition > 0) {
            this.tr = { fromA: copyParams(this.A), fromB: copyParams(this.B), to, t: 0, T: transition, fromFront: this.front ? { ...this.front } : null };
            this.front = null;
            // (whatever the front was doing, the whole sky now heads for `kind`)
            const k = this.frontMixAt(this.camPos);
            lerpParams(this.tr.fromA, this.tr.fromB, k, this.tr.fromA);
            copyParams(this.tr.fromA, this.tr.fromB);
        } else {
            this.tr = null; this.front = null;
            copyParams(to, this.A); copyParams(to, this.B);
            this.A.kind = this.B.kind = to.kind;
        }
        this.dirty = true;
        return this;
    }

    // A front: `kind` moves in behind a line that crosses the map. heading: where it moves toward (rad, compass: 0
    // north, π/2 east; default: with the wind), speed (m/s), width (m, the transition zone), eta: seconds until it
    // reaches `at` (default the camera), or dist: how far out its line starts
    sendFront(kind, { heading = null, speed = 18, width = 16000, eta = null, dist = null, at = null } = {}) {
        const here = at || this.camPos;
        // settle whatever was blending first
        if (this.tr) this.finishTransition();
        if (this.front) this.collapseFront();
        const hd = heading ?? this.windAngle;
        const nx = Math.sin(hd), nz = -Math.cos(hd);
        const back = dist ?? (eta != null ? eta * speed : 30000) + width;
        this.front = { x: here.x - nx * back, z: here.z - nz * back, nx, nz, w: width / 2, speed, kind };
        copyParams(kindParams(kind), this.B);
        this.B.kind = kind;
        this.dirty = true;
        return this.front;
    }

    finishTransition() {
        const tr = this.tr;
        if (!tr) return;
        copyParams(tr.to, this.A); copyParams(tr.to, this.B);
        this.A.kind = this.B.kind = tr.to.kind;
        this.tr = null;
    }
    // the front has passed everything that matters: its weather is everywhere now
    collapseFront() {
        copyParams(this.B, this.A);
        this.A.kind = this.B.kind;
        this.front = null;
    }

    frontMixAt(p) { return frontMix(this.front, p.x, p.z); }

    // the weather at (x, z): A and B mixed by the front
    paramsAt(x, z, out = {}) {
        const k = frontMix(this.front, x, z);
        return k <= 0 ? copyParams(this.A, out) : k >= 1 ? copyParams(this.B, out) : lerpParams(this.A, this.B, k, out);
    }

    // time of day (solar hours); timeScale runs the clock
    setHour(h) {
        this.hour = ((h % 24) + 24) % 24;
        this.dirty = true;
    }

    // ── per frame ──
    update(dt, camera) {
        this.camPos.copy(camera.position);
        this.hour = (this.hour + dt * this.timeScale / 3600 + 24) % 24;
        if (this.timeScale > 0) this.dirty = true;
        // a whole-sky transition
        if (this.tr) {
            const tr = this.tr;
            tr.t += dt;
            const k = smooth(0, 1, tr.t / tr.T);
            lerpParams(tr.fromA, tr.to, k, this.A);
            copyParams(this.A, this.B);
            this.A.kind = this.B.kind = k > 0.5 ? tr.to.kind : tr.fromA.kind;
            if (tr.t >= tr.T) this.finishTransition();
            this.dirty = true;
        }
        // a front moving across
        const cam = camera.position;
        if (this.front) {
            const f = this.front;
            f.x += f.nx * f.speed * dt; f.z += f.nz * f.speed * dt;
            // once it's 60 km past the camera its weather has taken over
            if ((cam.x - f.x) * f.nx + (cam.z - f.z) * f.nz < -60000) this.collapseFront();
            this.dirty = true;
        }
        this.paramsAt(cam.x, cam.z, this.local);
        const lk = frontMix(this.front, cam.x, cam.z);
        this.local.kind = lk > 0.5 ? this.B.kind : this.A.kind;
        this.kind = this.local.kind;
        this.camFront = lk;
        // the banks drift downwind
        const ws = this.local.wind;
        this.drift.x += Math.cos(this.windAngle) * ws * dt * 0.8;
        this.drift.y += Math.sin(this.windAngle) * ws * dt * 0.8;
        this.pushFog(lk);
    }

    // what the fog shader needs this frame
    pushFog(camMix) {
        const A = this.A, B = this.B, F = this.front;
        const rad = radiationFog(this.hour);
        const fogOf = (P) => Math.max(P.fog, 0.009 * rad * P.radiation);
        WX_FOG.e[0] = fogOf(A); WX_FOG.e[1] = A.fog > 0 ? A.fogTop : Math.max(A.fogTop, 90); WX_FOG.e[2] = fogOf(B); WX_FOG.e[3] = B.fog > 0 ? B.fogTop : Math.max(B.fogTop, 90);
        if (F) { WX_FOG.f[0] = F.x; WX_FOG.f[1] = F.z; WX_FOG.f[2] = F.nx; WX_FOG.f[3] = F.nz; WX_FOG.g[0] = F.w; }
        else WX_FOG.g[0] = 0;
        WX_FOG.g[1] = A.fog > 0 ? A.banks : rad > 0 ? 0.55 : A.banks;
        WX_FOG.g[2] = B.fog > 0 ? B.banks : rad > 0 ? 0.55 : B.banks;
        WX_FOG.g[3] = camMix;
        WX_FOG.h[0] = this.drift.x; WX_FOG.h[1] = this.drift.y;
    }

    // ── what can be seen (the fog shader's own terms, on the CPU) ──
    // ground-fog extinction parameters at (x, z): { D, H }
    groundFogAt(x, z, out) {
        const k = frontMix(this.front, x, z);
        const D = WX_FOG.e[0] + (WX_FOG.e[2] - WX_FOG.e[0]) * k, H = WX_FOG.e[1] + (WX_FOG.e[3] - WX_FOG.e[1]) * k;
        const banks = WX_FOG.g[1] + (WX_FOG.g[2] - WX_FOG.g[1]) * k;
        out.D = D * bankMask(x, z, banks, WX_FOG.h[0], WX_FOG.h[1]); out.H = H;
        return out;
    }
    // the fog shader's optical depths along a → b: haze + mist (squared in the shader: its exp² fog), ground fog
    fogTaus(a, b, out = {}) {
        const SF = this.world.SKY_FOG;
        const L = a.distanceTo(b);
        out.haze = SF ? expLayerTau(SF.a[0], SF.a[1], a.y, b.y, L) + expLayerTau(SF.d[0], SF.d[1], a.y, b.y, L) : 0;
        const g0 = this.groundFogAt(a.x, a.z, _gf0), g1 = this.groundFogAt(b.x, b.z, _gf1);
        out.ground = groundFogTau((g0.D + g1.D) * 0.5, (g0.H + g1.H) * 0.5, FOG_W, a.y, b.y, L);
        return out;
    }
    // the fog shader's fog amount (0..1) for a point seen from the camera (mirror of skyFogAmount)
    fogAmount(cam, p) {
        const t = this.fogTaus(cam, p, _taus);
        return 1 - Math.exp(-(t.haze * t.haze) - t.ground);
    }

    // rain (mm/h) at (x, z): continuous under the rain deck, heavy under tall cumulus (cells). wm: the clouds'
    // weather map there (clouds.weatherAt); the shader's twin is in clouds.js (rainRate)
    rainAt(x, z) {
        const cl = this.world.clouds;
        if (!cl || !cl.weatherData) return 0;
        const P = this.paramsAt(x, z, _pp);
        if (!(P.rain > 0) && !(P.cells > 0)) return 0;
        const wm = cl.weatherAt(x, z, _wm);
        return rainRateOf(P, wm);
    }
    // 0..1: how much of a thunderstorm cell (x, z) is under
    stormAt(x, z) {
        const cl = this.world.clouds;
        if (!cl || !cl.weatherData) return 0;
        const P = this.paramsAt(x, z, _pp);
        if (!(P.cells > 20)) return 0;
        const wm = cl.weatherAt(x, z, _wm);
        return cellOf(P, wm) * Math.min(1, P.cells / 60);
    }
    // the lowest cloud base over (x, z) where there's cloud (m), or Infinity with none (cumulus: only under one)
    ceilingAt(x, z) {
        const cl = this.world.clouds;
        const P = this.paramsAt(x, z, _pp);
        let c = Infinity;
        if (cl && cl.weatherData) {
            const wm = cl.weatherAt(x, z, _wm);
            if (P.deck > 0 && smooth(1 - P.deck, 1.35 - P.deck, wm[2]) > 0.5) c = P.deckY;
            const cov = Math.max(0, Math.min(1, (wm[0] - P.thr) / (1 - P.thr)));
            if (cov > 0.35) c = Math.min(c, P.base + (wm[3] - 0.5) * P.baseVar);
        }
        return c;
    }
    // rain's optical depth along a → b (below the cloud base, where it falls), 8 samples
    rainTau(a, b) {
        const cl = this.world.clouds;
        if (!cl || !cl.weatherData) return 0;
        if (!(this.A.rain > 0 || this.B.rain > 0 || this.A.cells > 0 || this.B.cells > 0)) return 0;
        const L = a.distanceTo(b), n = 8, dl = L / n;
        let tau = 0;
        for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
            const P = this.paramsAt(x, z, _pp);
            if (y > rainTop(P)) continue; // above where it falls from
            const R = rainRateOf(P, cl.weatherAt(x, z, _wm));
            tau += rainSigma(R) * dl;
        }
        return tau;
    }
    // clouds' optical depth along a → b (the clouds' own density field; 16 samples through the cloud layer)
    cloudTau(a, b) {
        const cl = this.world.clouds;
        if (!cl || !cl.ready || !cl.enabled || !cl.fieldU) return 0;
        const slab = cl.fieldU.slab.value;
        let t0 = 0, t1 = 1;
        const dy = b.y - a.y;
        if (Math.abs(dy) > 1e-3) {
            const ta = (slab.x - a.y) / dy, tb = (slab.y - a.y) / dy;
            t0 = Math.max(0, Math.min(1, Math.min(ta, tb))); t1 = Math.max(0, Math.min(1, Math.max(ta, tb)));
        } else if (a.y < slab.x || a.y > slab.y) return 0;
        if (t1 - t0 < 1e-4) return 0;
        const n = 16, dl = a.distanceTo(b) * (t1 - t0) / n;
        let tau = 0;
        for (let i = 0; i < n && tau < 8; i++) {
            _v2.lerpVectors(a, b, t0 + (t1 - t0) * (i + 0.5) / n);
            tau += cl.densityAt(_v2) * 0.065 * dl;
        }
        return tau;
    }
    // What an eye (or a TV camera) sees of b from a: contrast transmittance 0..1 through the haze (the fog shader's
    // exp² term), the ground fog, the rain and the clouds. opts: { clouds, rain, fog } to leave terms out
    transmittance(a, b, { clouds = true, rain = true, fog = true } = {}) {
        let T = 1;
        if (fog) { const t = this.fogTaus(a, b, _taus); T *= Math.exp(-(t.haze * t.haze) - t.ground); }
        if (rain) T *= Math.exp(-this.rainTau(a, b));
        if (clouds) T *= Math.exp(-this.cloudTau(a, b));
        return T;
    }
    // meteorological visibility (m) at a point: horizontal visual range through what's there (haze + mist, ground
    // fog, rain; inside a cloud, the cloud)
    visibilityAt(p) {
        const SF = this.world.SKY_FOG;
        // haze + mist at this height, as an extinction: the shader's exp² fog reaches 2 % contrast where τ² = 3.912
        let sig = 0;
        if (SF) {
            const hz = SF.a[0] * Math.exp(-SF.a[1] * Math.max(p.y, 0)) + SF.d[0] * Math.exp(-SF.d[1] * Math.max(p.y, 0));
            const V = Math.sqrt(KOSCHMIEDER) / Math.max(hz, 1e-9);
            sig += KOSCHMIEDER / V;
        }
        const g = this.groundFogAt(p.x, p.z, _gf0);
        if (g.D > 0) sig += g.D / (1 + Math.exp(Math.min((p.y - g.H) / FOG_W, 80)));
        const P = this.paramsAt(p.x, p.z, _pp);
        if (p.y < rainTop(P)) sig += rainSigma(this.rainAt(p.x, p.z));
        const cl = this.world.clouds;
        if (cl && cl.densityAt) sig += cl.densityAt(p) * 0.065;
        return visualRange(sig);
    }

    // ── gusts and turbulence ──
    // A gust acceleration (m/s², into out) for an aircraft at p at game time t: convective turbulence in and under
    // thunderstorm cells, chop in cloud, mechanical turbulence low down in a strong wind; smooth in time and space
    // (sums of sines), the same at any frame rate. seed: per aircraft
    turbulence(p, t, seed, out) {
        out.set(0, 0, 0);
        const P = this.local;
        if (!(P.turb > 0)) return out;
        const cl = this.world.clouds;
        const storm = this.stormAt(p.x, p.z);
        const inCloud = cl && cl.densityAt ? cl.densityAt(p) : 0;
        const agl = Math.max(0, p.y - Math.max(this.groundH ? this.groundH(p.x, p.z) : 0, 0));
        const low = Math.max(0, 1 - agl / 700) * Math.min(1, P.wind / 12);
        let k = P.turb * (0.35 + 0.65 * low) + storm * 1.6 + inCloud * 0.8 * P.turb;
        if (k < 0.01) return out;
        k = Math.min(k, 2.2);
        const s = seed * 0.37 + this.gustSeed, x = p.x * 0.0021, z = p.z * 0.0019;
        // (a few incommensurate frequencies: long swells and short bumps; vertical strongest, like real turbulence)
        const f = (a, b, c) => Math.sin(t * a + s * b + x * c) + 0.6 * Math.sin(t * a * 2.37 + s * 1.3 * b + z * c * 1.7) + 0.35 * Math.sin(t * a * 5.1 + x * 3.1 + z * 2.3 + s);
        // (gentle: ~±1-2 m/s² in rain or low in a strong wind, up to ~±5 in the core of a thunderstorm cell)
        out.set(f(0.9, 1, 1) * 0.6, f(1.3, 2, 1.4) * 1.3, f(1.1, 3, 0.8) * 0.6).multiplyScalar(k);
        return out;
    }
}
const _gf0 = { D: 0, H: 0 }, _gf1 = { D: 0, H: 0 }, _taus = { haze: 0, ground: 0 }, _pp = {};

// the height rain falls from (m): the rain deck's base for its steady rain, the cumulus base (plus a little: it
// forms inside the cloud) for a cell's; 0 where it doesn't rain
export function rainTop(P) {
    if (!(P.rain > 0) && !(P.cells > 0)) return 0;
    return Math.max(P.deck > 0 && P.rain > 0 ? P.deckY : 0, P.cells > 0 ? P.base + 200 : 0);
}
// how much of a cumulonimbus (x, z) is under: dense and tall cumulus on the weather map (0..1)
export function cellOf(P, wm) {
    const cov = Math.max(0, Math.min(1, (wm[0] - P.thr) / (1 - P.thr)));
    return cov * smooth(0.55, 0.9, wm[1]);
}
// rain rate (mm/h) for weather P over the weather-map texel wm (r cover, g height, b deck, a base)
export function rainRateOf(P, wm) {
    const deck = P.deck > 0 ? smooth(1 - P.deck, 1.35 - P.deck, wm[2]) : 0;
    return P.rain * deck + P.cells * cellOf(P, wm);
}
// the GLSL twin (clouds.js): P as uniforms (cu: thr…; rainK: rain, cells)
export const RAIN_RATE_GLSL = /* glsl */`
    float wxCell(vec4 wm, float thr) { return clamp((wm.r - thr) / (1.0 - thr), 0.0, 1.0) * smoothstep(0.55, 0.9, wm.g); }
    float wxRain(vec4 wm, float thr, float deck, float rain, float cells) {
        float d = deck > 0.0 ? smoothstep(1.0 - deck, 1.35 - deck, wm.b) : 0.0;
        return rain * d + cells * wxCell(wm, thr);
    }`;
