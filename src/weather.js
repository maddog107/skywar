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
import { makeAir, sunTransmittance as atmSunT, skyLight, render3, lum as lum3 } from './atmosphere.js';

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
    // a grey day: a closed stratocumulus deck ~2 km up with a few breaks, scattered cumulus under it, the air clear
    // below (a ceiling to fly under, not fog): soft shadows, a dull flat light
    grey:     { thr: 0.54, base: 1250, thick: 500, baseVar: 220, deck: 0.9, deckY: 2100, deckThick: 700, overcast: 0.55, sev: 0.22, rain: 0, cells: 0, fog: 0, fogTop: 150, banks: 0.6, radiation: 0, wind: 6.5, turb: 0.22, lightning: 0, label: 'OVERCAST' },
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
    // (y - w softplus((y - H) / w), written so that nothing cancels far above the fog: there both ends give H exactly,
    // where the difference of two rounded 3000s gave noise of either sign)
    float wxFogInt(float y, float H, float w) { return min(y, H) - w * log(1.0 + exp(-abs(y - H) / w)); }
    float wxLayer(float D, float H, float y0, float y1, float L) {
        float dy = y1 - y0, w = ${FOG_W.toFixed(1)};
        if (abs(dy) < 0.01) return D * L / (1.0 + exp(min((y0 - H) / w, 80.0)));
        return max(D * L * (wxFogInt(y1, H, w) - wxFogInt(y0, H, w)) / dy, 0.0);
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
// The sky's palette: what the world's lights, sky, fog, clouds and sea are set from (world.js applySky).
//
// Every colour (the sky's, the sun's, the sky light's, the fog's, the clouds') follows from the air: skyPalette().
// Set by hand is only what the weather or a camera decides:
//   the air, at the old four times and blended by the sun's elevation (PALETTES): fogDensity, the haze at sea level
//   (1/m; the fog shader's exp² law: 32 km of visibility on a clear day) and `haze` its scale height (m); mist, mistH:
//   the low mist under it; water: the sea's own colour
//   the exposure (SUN_DAY, TWILIGHT_K, FILL, MOON_GROUND, MOON_SKY below): how bright a camera would draw that light.
//   It opens up as the light goes: the beam of a sun 3° up is a twentieth of noon's and its sky a tenth, and both
//   are drawn about twice as bright as that against noon's. Set so that mid-grey ground is as bright at the old
//   four times as the hand-made palettes had it.
const hex = (h) => new THREE.Color(h);
export const PALETTES = {
    day: { fogDensity: 0.000062, water: hex(0x14506c), mist: 0.00012, mistH: 60, haze: 1500 },
    dawn: { fogDensity: 0.00007, water: hex(0x183248), mist: 0.0005, mistH: 80, haze: 1500 },
    dusk: { fogDensity: 0.00007, water: hex(0x1a2a40), mist: 0.00045, mistH: 70, haze: 1500 },
    night: { fogDensity: 0.00008, water: hex(0x040b14), mist: 0.0004, mistH: 70, haze: 1500 },
};
const ANCHOR_KEYS = ['fogDensity', 'mist', 'mistH', 'haze'];
// the colours the air gives (linear, as lit: radiances and irradiances at the palette's exposure)
const COLOR_KEYS = ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'clouds', 'cloudShadow', 'fogWhite', 'water'];
export function newPalette() {
    const P = {};
    for (const k of COLOR_KEYS) P[k] = new THREE.Color();
    for (const k of ANCHOR_KEYS) P[k] = 0;
    P.sunI = 0; P.hemiI = 0; P.envI = 1; P.overcast = 0;
    return P;
}
function mixAnchors(out, a, b, t) {
    out.water.copy(a.water).lerp(b.water, t);
    for (const k of ANCHOR_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
}
// the hand-set part at solar time `hour` (before the weather): day above 22° of sun, dawn / dusk around the horizon,
// night below -11°; the four old times land exactly on their own
export function paletteAt(hour, out = newPalette()) {
    const { el } = sunAt(hour);
    const h = ((hour % 24) + 24) % 24;
    const twi = h < 12 ? PALETTES.dawn : PALETTES.dusk;
    if (el >= 6) mixAnchors(out, twi, PALETTES.day, smooth(6, 22, el));
    else if (el >= 2) mixAnchors(out, twi, twi, 0);
    else mixAnchors(out, PALETTES.night, twi, smooth(-11, 2, el));
    return out;
}
// the weather's part of it: thicker haze and mist, a greyer sea (continuous in its severity)
const WATER_GREY = hex(0x1d2a33);
export function applyWeatherToPalette(P, W) {
    const k = W.sev;
    P.overcast = W.overcast;
    if (!(k > 0)) return P;
    // (rain thickens the air itself — rainSigma — so the haze thickens less under it)
    P.fogDensity *= 1 + (W.rain > 0 || W.cells > 5 ? 1.0 : 1.8) * k;
    P.mist = P.mist * (1 + k) + 0.00015 * k; P.mistH += 40 * k;
    P.water.lerp(WATER_GREY, 0.6 * k);
    return P;
}

// ── The air and the light, from the atmosphere (atmosphere.js) ──
export const REF_H = 0.3;          // the height the ground's light is worked out for (km: the country flown over)
export const CLOUD_H = 2;          // ... and the clouds' (km)
// Aerosol extinction at 550 nm (per km) for the fog shader's haze density (per m). The shader's exp² haze has no one
// extinction coefficient (it is clearer close by than any real air of the same visual range): this takes the clear
// day's 32 km haze as an aerosol optical depth of 0.11 at 550 nm (ordinary clear continental air, Linke turbidity
// about 3: a deep blue zenith over a pale horizon, a low sun that still lights the ground), and the weathers scale
// from there.
export const MIE_PER_HAZE = 1200;
// The exposure: the factor from the sun's irradiance above the air (1) to the game's light units.
export const SUN_DAY = 2.94;       // from 22° up: whatever draws the sun's beam at this on a surface facing it in the clear day's air (the old 3.3 of warm white)
export const TWILIGHT_K = 9;       // 6° up and lower: this (noon's is 3.8; between the two the beam's brightness is blended)
export const TWILIGHT_EL = 2;      // below this the exposure opens as the light goes (deg)
export const TWILIGHT_OPEN = [2.2, -5, 1.2]; // ... e-fold for every 2.2° the sun sinks, for every 1.2° once it is 5° down
// The hemisphere light, as a multiple of the sky's own irradiance. The sky lights the materials once already through
// the environment map (the dome as drawn: envI is 1); this is the fill on top of it that the old exposure had (the
// light the surroundings bounce back, a camera's lifted shadows).
export const FILL = 0.7;
// the moon's light on the ground in clear air (the old night palette's light: a pale blue, 0.35), and how much of the
// sky it would light is drawn (the night's exposure for the sky: the old night was darker than its own moonlight)
export const MOON_GROUND = [0x9f, 0xb6, 0xe0].map(v => Math.pow((v / 255 + 0.055) / 1.055, 2.4) * 0.35);
export const MOON_SKY = 0.65;
// the night sky's own glow (airglow and starlight between the stars)
const NIGHT_FLOOR = [0.00035, 0.0005, 0.0009];
// what the old day palette gave at noon in clear air, which the model's light is scaled to there (see calib): the
// hemisphere light's ground side (the light the ground sends back up), the clouds' shaded sides
const OLD_DAY = { ground: [0.051, 0.042, 0.0185], cloudShadow: 0.33 };
const AIR0 = makeAir(PALETTES.day.fogDensity * MIE_PER_HAZE, 1.3); // the clear day's air: the exposure's reference
const MOON_EL = Math.asin(MOON_DIR.y) / DEG;
const _T = [0, 0, 0], _T2 = [0, 0, 0], _sl = {}, _slm = {}, _e = [0, 0, 0], _z = [0, 0, 0], _hz = [0, 0, 0], _u = [0, 0, 0], _amb = [0, 0, 0], _dir = [0, 0, 0];
const _grey = new THREE.Color();
let _moon0 = null; // the moon's beam through the reference air
let _L6 = 0;
// The exposure for a sun `el` degrees up. From 22° up, what draws its beam at SUN_DAY in the reference air (the sun is
// drawn equally bright all through the day); 6° up and lower, TWILIGHT_K (the beam then reddens and dims into the
// horizon as the air makes it); from TWILIGHT_EL down it opens e-fold for every 2.2° the sun sinks, which is as fast
// as the zenith darkens just after sunset (so the sky holds its brightness for the first ten minutes and then
// fades, the glow in the west faster than the sky overhead), and faster from 5° down, where the real light collapses
// by a factor of thousands: a faint glow is left on the horizon at the end of nautical twilight. Eyes and cameras
// adapt.
export function sunExposure(el) {
    if (el >= 22) return SUN_DAY / lum3(atmSunT(AIR0, el, REF_H, _T));
    if (el >= 6) {
        if (!_L6) _L6 = TWILIGHT_K * lum3(atmSunT(AIR0, 6, REF_H, _T));
        return (_L6 + (SUN_DAY - _L6) * smooth(6, 22, el)) / lum3(atmSunT(AIR0, el, REF_H, _T));
    }
    if (el >= TWILIGHT_EL) return TWILIGHT_K;
    if (el < -18) return 0;
    const [f0, deep, f1] = TWILIGHT_OPEN;
    return Math.min(TWILIGHT_K * Math.exp((TWILIGHT_EL - Math.max(el, deep)) / f0 + Math.max(deep - el, 0) / f1), 2e5);
}
// the scale of the model's light at noon in clear air against the old palette's (worked out once)
let _cal = null;
function calib() {
    if (_cal) return _cal;
    const el = sunAt(KEY_HOURS.day).el, mu = Math.sin(el * DEG), K = sunExposure(el);
    const E = render3(skyLight(AIR0, REF_H, mu, {}).E.map(v => v * K));
    const sun = render3(atmSunT(AIR0, el, REF_H, [0, 0, 0])).map(v => v * K * mu);
    _cal = { ground: OLD_DAY.ground.map((g, i) => g / (sun[i] + E[i])), cloudShadow: OLD_DAY.cloudShadow / lum3(E), cloudLit: 1 / SUN_DAY };
    return _cal;
}
// the aerosol in 2 % steps, so the multiple-scattering tables are redrawn a few times through a change of weather
// instead of every time the sky is applied
const quantMie = (m) => Math.exp(Math.round(Math.log(Math.max(m, 1e-6)) / 0.02) * 0.02);
const setC = (c, a, s = 1) => c.setRGB(a[0] * s, a[1] * s, a[2] * s);
const greyTo = (a, t, dim) => { const l = lum3(a); for (let i = 0; i < 3; i++) a[i] += (l * dim - a[i]) * t; return a; };

// what the atmosphere's tables are drawn from (world.js hands it to Atmosphere.set), and a few of the model's own
// numbers for whoever wants them: the sun's elevation, the exposure, the sun's and the moon's light on the ground,
// the clear sky's irradiance, how much of the sky the overcast covers
export function newSky() {
    return {
        air: makeAir(PALETTES.day.fogDensity * MIE_PER_HAZE, 1.3),
        lights: [{ dir: new THREE.Vector3(0, 1, 0), E: [0, 0, 0] }, { dir: MOON_DIR.clone(), E: [0, 0, 0] }], // the sun, the moon
        veil: [0, 0, 0, 0], floor: [0, 0, 0],
        el: 0, K: 0, sunRGB: [0, 0, 0], moonRGB: [0, 0, 0], skyE: [0, 0, 0], cover: 0, coverHigh: 0, sev: 0,
    };
}
// the sun's light as it arrives h km up under the sky S (skyPalette's S.sunRGB is this at the ground): from an
// aircraft the setting sun is brighter and less red than from the field below it
export function sunLightAt(S, h, out = [0, 0, 0]) {
    render3(atmSunT(S.air, S.el, h, out));
    const dim = S.K * (1 - 0.65 * S.sev);
    for (let i = 0; i < 3; i++) out[i] *= dim;
    return greyTo(out, 0.6 * S.sev, 0.67);
}

// The palette at solar time `hour` under weather W (a kind's numbers: sev, overcast, rain, cells), and the sky's
// state S for the atmosphere's tables.
//   the air      the haze as aerosol (MIE_PER_HAZE): bluish and dry in clear weather, greyer droplets as it worsens
//   the sun      its beam through that air to the ground (white at noon, orange-red at the horizon), at the exposure
//                of the time of day; dimmed and whitened by the cloud the weather puts in front of it
//   the moon     the old night's light, coming in from 3° to 7° of sun below the horizon; it lights the night sky as
//                the sun does the day's (a moonlit sky is a dim blue one)
//   the sky      its light on the ground from the same model (irradiance: the hemisphere light), the zenith's and
//                the horizon's radiance (the sea's and the canopy's reflections; the dome itself reads the table)
//   overcast     a deck over `cover` of the sky that lets 0.6 … 0.12 of the light above it through as a flat grey:
//                the dome, the haze and the sky's light go grey and dim with it
//   fog, clouds  thick fog's own colour (white droplets under that sun and sky); the clouds' sunlit and shaded sides
export function skyPalette(hour, W, P = newPalette(), S = newSky()) {
    const { el } = sunAt(hour, S.lights[0].dir);
    const k = W.sev || 0, C = calib();
    paletteAt(hour, P);
    applyWeatherToPalette(P, W);
    const mie = quantMie(P.fogDensity * MIE_PER_HAZE), ang = Math.round(1.3 * (1 - 0.75 * k) * 20) / 20;
    if (S.air.mie !== mie || S.air.angstrom !== ang) makeAir(mie, ang, S.air);
    const air = S.air, mu = Math.sin(el * DEG);
    // the exposure, and how much of the twilight is left
    const K = sunExposure(el) * smooth(-18, -10, el);
    S.el = el; S.K = K;
    // (the sky is covered by the weather's own deck, seen from under it, and by the high cloud that comes with bad
    // weather, seen from anywhere: world.js picks between the two by the camera's height for the dome)
    const cloudDim = 1 - 0.65 * k, moonFade = smooth(-3, -7, el), high = 0.9 * k * k, cover = Math.max(W.overcast || 0, high), deck = 0.6 - 0.48 * k;
    S.cover = cover; S.coverHigh = high; S.sev = k;
    // Under an overcast with the light low, the exposure opens to make up for what the deck takes, for the sky's
    // light only: the beam that still finds its way through the cloud is not drawn brighter for it. (A storm deck lets
    // an eighth of the light through: at midday that is a dark day; at dusk or by the moon it would be all but black,
    // which no eye or camera leaves it at.)
    const open = 1 + (1 / (1 - cover * (1 - deck)) - 1) * (1 - smooth(2, 22, el)), Ks = K * open;
    // the sun's beam at the ground and at the clouds
    const sun = S.sunRGB, moon = S.moonRGB, lit = _T2;
    render3(atmSunT(air, el, REF_H, sun)); render3(atmSunT(air, el, CLOUD_H, lit));
    for (let i = 0; i < 3; i++) { sun[i] *= K; lit[i] *= K; _u[i] = sun[i] * Math.max(mu, 0) * open; }
    // the sky under it: irradiance, zenith, horizon
    _e[0] = _e[1] = _e[2] = 0; _z[0] = _z[1] = _z[2] = 0; _hz[0] = _hz[1] = _hz[2] = 0;
    if (K > 0) {
        skyLight(air, REF_H, mu, _sl);
        for (let i = 0; i < 3; i++) { _e[i] = _sl.E[i] * Ks; _z[i] = _sl.zenith[i] * Ks; _hz[i] = _sl.horizon[i] * Ks; }
        render3(_e); render3(_z); render3(_hz);
    }
    S.lights[0].E[0] = S.lights[0].E[1] = S.lights[0].E[2] = Ks;
    // the moon: its irradiance above the air from what reaches the ground in the reference air (ME: what lights
    // the sky, MOON_SKY of it)
    const ME = S.lights[1].E;
    if (moonFade > 0) {
        if (!_moon0) _moon0 = render3(atmSunT(AIR0, MOON_EL, REF_H, [0, 0, 0]));
        render3(atmSunT(air, MOON_EL, REF_H, moon)); render3(atmSunT(air, MOON_EL, CLOUD_H, _T));
        if (air.key !== _slm.key) { skyLight(air, REF_H, MOON_DIR.y, _slm); _slm.key = air.key; }
        for (let i = 0; i < 3; i++) {
            const m = MOON_GROUND[i] / _moon0[i] * moonFade;
            ME[i] = m * MOON_SKY * open;
            lit[i] += _T[i] * m;
            moon[i] *= m;
            _u[i] += moon[i] * MOON_DIR.y * open;
        }
        const add = (dst, src) => { for (let i = 0; i < 3; i++) _dir[i] = src[i] * ME[i]; render3(_dir); for (let i = 0; i < 3; i++) dst[i] += _dir[i]; };
        add(_e, _slm.E); add(_z, _slm.zenith); add(_hz, _slm.horizon);
    } else { ME[0] = ME[1] = ME[2] = 0; moon[0] = moon[1] = moon[2] = 0; }
    for (let i = 0; i < 3; i++) S.skyE[i] = _e[i];
    // the overcast: what the deck lets through of the beam and the sky above it, as a flat grey of the same irradiance
    // (a radiance L (0.5 + 0.5 cos θ) over the hemisphere gives 2.618 L on the ground)
    for (let i = 0; i < 3; i++) _u[i] = (_u[i] + _e[i]) * deck;
    greyTo(_u, 0.5, 1);
    for (let i = 0; i < 3; i++) {
        S.veil[i] = _u[i] / 2.618;
        _amb[i] = _e[i] * (1 - cover) + _u[i] * cover;
        S.floor[i] = NIGHT_FLOOR[i] * (1 - cover);
        _z[i] = _z[i] * (1 - cover) + S.veil[i] * cover + S.floor[i];
        _hz[i] = _hz[i] * (1 - cover) + S.veil[i] * 0.5 * cover + S.floor[i];
    }
    S.veil[3] = cover;
    setC(P.zenith, _z); setC(P.horizon, _hz);
    // the weather's cloud in front of the sun (and the moon): dimmer, whiter
    for (let i = 0; i < 3; i++) { sun[i] *= cloudDim; moon[i] *= cloudDim; }
    greyTo(sun, 0.6 * k, 0.67); greyTo(moon, 0.6 * k, 0.67);
    // the scene's one directional light: the sun until it is 3° down (by then long gone), then the moon
    const light = el > -3 ? sun : moon, lightY = el > -3 ? Math.max(mu, 0) : MOON_DIR.y;
    const lm = Math.max(light[0], light[1], light[2]);
    P.sunI = lm;
    if (lm > 1e-9) setC(P.sun, light, 1 / lm); else P.sun.setRGB(1, 1, 1);
    // the sky's light on the ground, and the ground's back up
    P.hemiI = lum3(_amb) * FILL * 2; // (hemiI as it was: twice the luminance, the colour a mid one)
    const hk = 1 / Math.max(P.hemiI, 1e-9);
    setC(P.hemiSky, _amb, FILL * hk);
    P.envI = 1;
    P.hemiGround.setRGB((light[0] * lightY + _amb[0]) * C.ground[0] * hk, (light[1] * lightY + _amb[1]) * C.ground[1] * hk, (light[2] * lightY + _amb[2]) * C.ground[2] * hk);
    // thick fog: white droplets (albedo 0.75) under that sun and sky, lit as the ground is (the sky's light with its fill)
    const fa = 1 + FILL;
    P.fogWhite.setRGB(light[0] * lightY + _amb[0] * fa, light[1] * lightY + _amb[1] * fa, light[2] * lightY + _amb[2] * fa).multiplyScalar(0.75 / Math.PI);
    // the clouds: their sunlit sides (the beam at their height: at dusk they are still lit when the ground's light has
    // gone red), their shaded sides (the sky's light); greyed by the weather as they were
    for (let i = 0; i < 3; i++) lit[i] *= C.cloudLit;
    setC(P.clouds, lit);
    const ll = lum3(lit) * 0.36;
    P.clouds.lerp(_grey.setRGB(0.95 * ll, ll, 1.06 * ll), 0.7 * k);
    setC(P.cloudShadow, _e, C.cloudShadow / open);
    const sl = lum3(_e) * C.cloudShadow * 0.17 / open;
    P.cloudShadow.lerp(_grey.setRGB(0.9 * sl, sl, 1.1 * sl), 0.8 * k);
    // (by night the exposure that opened for the sky under an overcast shows the clouds too: a storm's clouds and its
    // rain are dim shapes under the moon, not black)
    const openC = 1 + (open - 1) * moonFade;
    P.clouds.multiplyScalar(openC); P.cloudShadow.multiplyScalar(openC);
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
            // (here too, at once: the sky is applied from `local` straight after, before the next update() gets to it,
            // and took the weather before this one)
            copyParams(to, this.local);
            this.local.kind = this.kind = to.kind;
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
        // (windAngle is the wind's angle in the x-z plane; a heading is a compass bearing: +x east, -z north)
        const hd = heading ?? Math.atan2(Math.cos(this.windAngle), -Math.sin(this.windAngle));
        const nx = Math.sin(hd), nz = -Math.cos(hd);
        // (eta: when the middle of its transition zone reaches `at`; the first cloud comes width / 2 before that)
        const back = dist ?? (eta != null ? eta * speed : 30000 + width / 2);
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
