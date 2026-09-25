// ═══════════════════════════════════════════════════════════════
// Clouds: raymarched volumetric cumulus and the overcast deck
// ═══════════════════════════════════════════════════════════════
// One density field for the whole sky, marched per pixel at reduced resolution:
//   - a 2D weather map (tileable, 32 km; cloudnoise.js) says where cumulus stand, how tall they grow, where the
//     rain deck is thick and how high the cloud base sits: clustered fields of cumulus of many sizes, cloud
//     streets, stratocumulus sheets and a few towering cumulus, with clear regions between; a coverage threshold
//     from the weather turns fair-weather cumulus into broken cloud;
//   - a cumulus is where a tileable Perlin-Worley billow volume rises above what the map's cover leaves room for
//     (the coverage "remap" of the Horizon Zero Dawn / Nubis clouds), under a vertical profile with a flat base
//     and a rounded top; a finer Worley volume (two octaves near the camera, faded out by the pixel footprint)
//     carves small billows on top and frays the base into wisps;
//   - rain and storms add a broad stratus deck at DECK_Y (thin and broken in rain, closed in a storm).
// Lighting: Beer-Lambert extinction, a short light march toward the sun with a multiple-scattering
// approximation (a few octaves of weaker extinction and flatter phase), a two-lobe Henyey-Greenstein phase
// for the silver lining, sky light from above / darker bounce below, and the shared aerial perspective.
//
// Rendering: a full-screen triangle in the main scene (renderOrder 5, like the old clouds). Just before it
// draws (onBeforeRender), the opaque scene is already in the render target, so its depth texture (resolved
// first when the target is multisampled) is marched against in a nested pass into a small two-target buffer
// (half the CSS resolution on 'high'): premultiplied colour + alpha, and the distance the cloud starts at +
// the scene distance the ray stopped at. Every frame jitters the march by a sub-pixel offset and a temporal
// upsampling resolve rebuilds a history at twice that resolution from the jittered samples, reprojected by the
// cloud's mean depth and clamped to the new frame's neighbourhood. The triangle then draws the history and
// writes the cloud's entry depth to gl_FragDepth, so the hardware depth test cuts it cleanly around aircraft
// and terrain at full resolution. A cloud-shadow map, marched through the same density field along the sun,
// dims the sun on the ground, the water, buildings and ships under each cloud (installCloudShadows).
import * as THREE from 'three';
import { makeCloudNoise, sat, WEATHER_SIZE, WEATHER_RES, BASE_SIZE, BASE_RES, DETAIL_SIZE, DETAIL_RES } from './cloudnoise.js';

export const DECK_Y = 2400;          // base of the overcast deck in rain and storms (m)
const DECK_THICK = 650;              // its thickness where fully covered (m)
const SIGMA = 0.065;                 // extinction at full density (1/m)
const NO_HIT = 60000;                // "no cloud" / "sky" distance (fits a half float)
const TOWER = 2.6;                   // the tallest towering cumulus, in units of the weather's usual cloud height
const TOWER_MAX = 1400;              // ... but at most this much above the usual tops (m): a storm's are tall already

// per weather: coverage threshold on the weather map (lower = more cloud), cloud base, tallest tops above
// the base, base altitude variation, deck amount (0 = none)
const WEATHER = {
    clear:  { thr: 0.56, base: 1300, thick: 560, baseVar: 160, deck: 0 },
    cloudy: { thr: 0.42, base: 1250, thick: 800, baseVar: 200, deck: 0 },
    rain:   { thr: 0.36, base: 1050, thick: 1000, baseVar: 160, deck: 0.75 },
    storm:  { thr: 0.3, base: 950, thick: 2200, baseVar: 160, deck: 1.2 }, // (> 1: the deck closes up completely)
};

const QUALITY = {
    // scale: march buffer size relative to the CSS pixel size; up: the history (what the composite shows) is
    // that much finer again, filled in over a few frames by jittering the march (temporal upsampling);
    // steps: primary march; light: light march; detail: small billows (0 none, 1 one octave, 2 two near the
    // camera); shadowRows: rows of the cloud-shadow map redrawn per frame
    high:   { scale: 0.5, up: 2, steps: 112, light: 5, detail: 2, shadowRows: 32 },
    medium: { scale: 0.42, up: 2, steps: 88, light: 4, detail: 1, shadowRows: 32 },
    low:    { scale: 0.28, up: 1.5, steps: 56, light: 3, detail: 0, shadowRows: 16 },
};
const SHADOW_RES = 512;              // cloud-shadow map: the whole weather tile, 64 m a texel
const SHADOW_STEPS = 24;
// sub-pixel jitter of the march, frame by frame (Halton 2, 3), in march pixels
const JITTER = Array.from({ length: 8 }, (_, i) => {
    const h = (b, n) => { let f = 1, r = 0; for (n++; n > 0; n = Math.floor(n / b)) { f /= b; r += f * (n % b); } return r; };
    return [h(2, i) - 0.5, h(3, i) - 0.5];
});

// ═══════════════════════════════════════════════════════════════
// Shaders
// ═══════════════════════════════════════════════════════════════
// shared by the march and its light march: the density field
const FIELD_GLSL = /* glsl */`
    uniform sampler2D tWeather;
    uniform highp sampler3D tBase, tDetail;
    uniform vec3 wind;   // x, z: wind drift (m); y: slow rise of the billows (m)
    uniform vec4 cu;     // cumulus: coverage threshold, base altitude, tallest tops above the base, base variation
    uniform vec4 dk;     // deck: amount (0 = none), base altitude, thickness
    uniform vec2 slab;   // altitudes that can hold any cloud
    float pixFoot;       // metres one low-res pixel covers at the current sample (set by the march)
    // (the fine detail octave's lattice is turned against the others, so its short tile doesn't show in rows)
    const mat3 FINE_ROT = mat3(0.8, 0.6, 0.0, -0.36, 0.48, 0.8, 0.48, -0.64, 0.6);
    #define WEATHER_SIZE ${WEATHER_SIZE.toFixed(1)}
    #define BASE_SIZE ${BASE_SIZE.toFixed(1)}
    #define DETAIL_SIZE ${DETAIL_SIZE.toFixed(1)}
    #define SIGMA ${SIGMA}

    vec4 weatherAt(vec3 p) { return textureLod(tWeather, (p.xz - wind.xz) / WEATHER_SIZE, 0.0); }
    // the same, B-spline filtered (four bilinear taps): plain bilinear creases the cloud walls along every texel
    vec4 cubicW(float v) {
        vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v, s = n * n * n;
        float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
        return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
    }
    vec4 weatherSmooth(vec3 p) {
        vec2 uv = (p.xz - wind.xz) / WEATHER_SIZE * ${WEATHER_RES.toFixed(1)} - 0.5;
        vec2 f = fract(uv); uv -= f;
        vec4 xc = cubicW(f.x), yc = cubicW(f.y);
        vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
        vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
        vec4 o = (c + vec4(xc.yw, yc.yw) / s) / ${WEATHER_RES.toFixed(1)};
        vec4 s0 = textureLod(tWeather, o.xz, 0.0), s1 = textureLod(tWeather, o.yz, 0.0);
        vec4 s2 = textureLod(tWeather, o.xw, 0.0), s3 = textureLod(tWeather, o.yw, 0.0);
        float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
        return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
    }
    // A cumulus is where the billow noise (Perlin-Worley) rises above what the weather map's cover leaves room
    // for: in the core of a big cover blob almost all of it is cloud, toward its rim only the noise's strongest
    // heads (the coverage "remap" of the Horizon Zero Dawn / Nubis clouds), so its outline is the noise's own
    // cauliflower, not the 2D blob drawn upward. A vertical profile gives it a flat base and rounds its top off,
    // it is fuller low down (a cumulus is one body, its turrets are at the top), and the weather says how tall
    // it grows. Density is soft (0..1), not a hard surface: thin edges and wisps let the light through.
    float baseAlt(vec4 wm) { return cu.y + (wm.a - 0.5) * cu.w; }
    // the tallest the cumulus here can grow above its base (m)
    float cloudTop(vec4 wm) { return min(cu.z * wm.g, cu.z + ${TOWER_MAX.toFixed(1)}); }
    // cumulus before noise: returns the cover (0..1); hf: height fraction (0 base .. 1 top, unclamped),
    // prof: the vertical profile
    float cumulusShape(vec3 p, vec4 wm, out float hf, out float prof) {
        float cov = clamp((wm.r - cu.x) / (1.0 - cu.x), 0.0, 1.0);
        float h = p.y - baseAlt(wm);
        hf = h / (cloudTop(wm) * (0.35 + 0.65 * sqrt(cov)));
        prof = clamp(h * 0.035, 0.0, 1.0) * (1.0 - smoothstep(0.5, 1.0, hf));
        return cov;
    }
    // deck before noise (field units: > 0 inside the layer, thinner where its cover is patchy)
    float deckShape(vec3 p, vec4 wm, out float hf) {
        float cover = smoothstep(1.0 - dk.x, 1.35 - dk.x, wm.b);
        float h = p.y - dk.y;
        hf = clamp(h / dk.z, 0.0, 1.0);
        return cover > 0.0 ? min(h + 90.0, dk.z * cover - h) * 0.002 : -1.0;
    }
    // conservative distance (m) to where cloud could start, for skipping empty air
    float cloudGap(vec3 p, vec4 wm) {
        float h = p.y - baseAlt(wm);
        float g = max((cu.x - wm.r) * 450.0, max(-h, h - cloudTop(wm)));
        if (dk.x > 0.0) g = min(g, max(dk.y - 150.0 - p.y, p.y - dk.y - dk.z - 50.0));
        return g;
    }
    // density 0..1; amb: height within the cloud (0 base .. 1 top) for the sky light. detail: add the small
    // billows (else their average, for the light march and the shadow map)
    float cloudDensity(vec3 p, vec4 wm, float lod, bool detail, out float amb) {
        float hf, prof, hd;
        float cov = cumulusShape(p, wm, hf, prof), sd = deckShape(p, wm, hd);
        amb = clamp(hf, 0.0, 1.0);
        if (prof <= 1.0 - 1.25 * cov && sd <= 0.0) return 0.0; // (even the strongest billow wouldn't make cloud)
        vec2 n = textureLod(tBase, (p - wind) / BASE_SIZE, lod).rg;
        // the lower part fuller, so the turrets stand on one body; the slow second channel makes some clouds
        // more solid than others
        float nb = mix(smoothstep(0.06, 0.94, n.r), 1.0, 0.45 * (1.0 - smoothstep(0.05, 0.45, hf))) * prof;
        float c = cov * (0.85 + 0.4 * n.g);
        float d = clamp((nb - (1.0 - c)) / max(c, 0.05), 0.0, 1.0);
        // deck: a broad, gently undulating layer (slow noise) with softer lumps than the cumulus
        float ds = clamp(sd / 0.03, 0.0, 1.0) * clamp(n.r * 0.6 + n.g * 0.6 - 0.2, 0.0, 1.0);
        if (ds > d) { d = ds; amb = hd; }
        // small billows on the surface (30-130 m heads) and, within a kilometre or so, a finer octave (10-35 m),
        // each faded out once the pixel's footprint is too big to show it (finer than a pixel they only make fur):
        // rounded (billowy) on the sides and top, frayed into wisps at the base
        float dm = 0.17;
        #if DETAIL > 0
        if (detail && d > 0.0 && d < 0.6) {
            vec3 q = (p - wind * 1.3) / DETAIL_SIZE;
            float ld = log2(pixFoot / ${(DETAIL_SIZE / DETAIL_RES).toFixed(2)});
            float fade = 1.0 - smoothstep(0.8, 2.6, ld);
            if (fade > 0.0) {
                float nd = textureLod(tDetail, q, max(ld + 0.3, 0.0)).r;
                #if DETAIL > 1
                float lf = ld + 1.89; // the same for the finer octave (3.7 times smaller)
                float ff = 1.0 - smoothstep(0.8, 2.4, lf);
                if (ff > 0.0) nd = mix(nd, nd * 0.6 + 0.4 * textureLod(tDetail, FINE_ROT * q * 3.7 + 0.31, max(lf + 0.3, 0.0)).r, ff);
                #endif
                dm = mix(dm, mix(nd, 1.0 - nd, smoothstep(0.02, 0.15, amb)) * 0.5, fade);
            }
        }
        #endif
        d = clamp((d - dm) / (1.0 - dm), 0.0, 1.0);
        return min(d * 3.0, 1.0);
    }`;

const TRI_VERT = /* glsl */`
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const marchFrag = (FOG_GLSL) => /* glsl */`
    precision highp float;
    uniform sampler2D tDepth;
    uniform float hasDepth, camNear, camFar, maxDist, sunScale, frame, pixAngle, flash;
    uniform mat4 projInv, camWorld;
    uniform vec2 lowRes, jitter;
    uniform vec3 camPos, sunDir, litColor, shadowColor, fogColor;
    layout(location = 0) out vec4 oColor;
    layout(location = 1) out vec4 oInfo;
    #include <packing>
    ${FOG_GLSL}
    ${FIELD_GLSL}
    #define NO_HIT ${NO_HIT.toFixed(1)}

    float stepAt(float t) { return 10.0 + t * 0.01; }
    // Henyey-Greenstein, scaled so an isotropic phase is 1
    float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }
    float phase(float mu, float k) { return min(0.7 * hg(mu, 0.6 * k) + 0.3 * hg(mu, -0.25 * k), 2.5); }

    // optical depth toward the sun: LIGHT_STEPS samples, each step longer than the last (~680 m in all). Every
    // frame the samples slide along the ray by a different fraction of their step, the same for every pixel (an
    // offset per pixel speckles the shading with dark grains where a sample lands in a dense spot); the resolve
    // pass averages the frames into smooth soft shadows without the banding of fixed sample positions
    // (far away, where a pixel spans more than the first step, that step is left out)
    float lightDepth(vec3 p, float lod, bool far) {
        float od = 0.0, d = 0.0, st = LIGHT_STEP0;
        for (int j = 0; j < LIGHT_STEPS; j++) {
            if (far && j == 0) { d = st; st *= LIGHT_RATIO; continue; }
            float dj = d + st * fract(frame * 0.6180339 + float(j) * 0.3819660);
            vec3 q = p + sunDir * dj;
            if (q.y > slab.y) break;
            float a;
            vec4 wq = j < 1 ? weatherSmooth(q) : weatherAt(q);
            od += cloudDensity(q, wq, lod + 0.5 + float(j) * 0.5, false, a) * st;
            d += st; st *= LIGHT_RATIO;
        }
        return od * SIGMA;
    }

    void main() {
        // (jittered within the pixel, a different spot every frame: the resolve pass builds a finer image from them)
        vec2 uv = (gl_FragCoord.xy + jitter) / lowRes;
        vec4 vp = projInv * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
        vec3 vray = vp.xyz / vp.w;
        vray /= -vray.z;                     // view-space ray through this pixel at z = -1
        float rayLen = length(vray);
        vec3 rd = normalize(mat3(camWorld) * vray);
        vec3 ro = camPos;
        // where the opaque scene stops the ray
        float limit = NO_HIT;
        if (hasDepth > 0.5) {
            // the farthest of four samples across this texel's footprint: a texel that straddles a ridge or the
            // horizon marches on into the sky (the composite's depth test then cuts the cloud at full resolution),
            // instead of leaving the sky pixels next to the ridge without their cloud (a stair-step)
            vec2 o = 0.3 / lowRes;
            float d0 = texture(tDepth, uv + vec2(-o.x, -o.y)).r, d1 = texture(tDepth, uv + vec2(o.x, -o.y)).r;
            float d2 = texture(tDepth, uv + vec2(-o.x, o.y)).r, d3 = texture(tDepth, uv + vec2(o.x, o.y)).r;
            #ifdef USE_REVERSED_DEPTH_BUFFER
            float d = min(min(d0, d1), min(d2, d3));
            bool sky = d <= 0.0;
            #else
            float d = max(max(d0, d1), max(d2, d3));
            bool sky = d >= 1.0;
            #endif
            if (!sky) limit = min(-perspectiveDepthToViewZ(d, camNear, camFar) * rayLen, NO_HIT);
        }
        oColor = vec4(0.0);
        oInfo = vec4(NO_HIT, limit, NO_HIT, 1.0);
        // the slab of air that can hold cloud, up to where the haze has swallowed everything
        float t0, t1;
        if (abs(rd.y) < 1e-5) {
            if (ro.y < slab.x || ro.y > slab.y) return;
            t0 = 0.0; t1 = NO_HIT;
        } else {
            float ta = (slab.x - ro.y) / rd.y, tb = (slab.y - ro.y) / rd.y;
            t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
        }
        float hd = length(rd.xz);
        t1 = min(t1, min(limit, maxDist / max(hd, 1e-3)));
        if (t1 <= t0) return;

        float mu = dot(rd, sunDir);
        float ph0 = phase(mu, 1.0), ph1 = phase(mu, 0.5), ph2 = phase(mu, 0.25);
        // a per-pixel start offset turns step banding into grain: interleaved gradient noise, shifted every frame
        // (evenly spread offsets that the resolve pass averages into a smooth result faster than white noise)
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + frame * 5.588238, vec2(0.06711056, 0.00583715))));
        float t = t0 + stepAt(t0) * jit;
        float T = 1.0, entry = NO_HIT, tw = 0.0, aw = 0.0, empty = 0.0;
        vec3 C = vec3(0.0);
        for (int i = 0; i < MAX_STEPS; i++) {
            if (t >= t1) break;
            vec3 p = ro + rd * t;
            float dt = stepAt(t);
            vec4 wm = weatherAt(p);
            float gap = cloudGap(p, wm);
            // (whole steps only: a skip to the estimated surface would line every ray up there and undo the jitter)
            if (gap > 0.0) { t += dt * clamp(floor(gap / dt), 1.0, 5.0); continue; }
            float lod = max(0.0, log2(dt / ${(BASE_SIZE / BASE_RES).toFixed(1)}));
            pixFoot = t * pixAngle * 2.0;
            float amb;
            // (the smooth weather lookup only where its creases could show)
            float den = cloudDensity(p, t < 8000.0 ? weatherSmooth(p) : wm, lod, t < 5000.0, amb);
            den *= smoothstep(4.0, 40.0, t); // inside a cloud, keep the first few tens of metres clear enough to see your own jet
            // came in on a double step: back up one step and take the surface at the normal spacing
            if (den > 0.0 && empty > 2.0) { t -= dt; empty = 0.0; continue; }
            if (den > 0.0) {
                float seg = min(dt, t1 - t);
                float a = 1.0 - exp(-den * SIGMA * seg);
                float od = lightDepth(p, lod, pixFoot > 20.0);
                // sun: single scattering plus two weaker, less attenuated, flatter octaves standing in for the
                // multiple scattering that makes the sunlit side of a thick cloud so bright
                float sun = exp(-od) * ph0 + 0.45 * exp(-od * 0.35) * ph1 + 0.18 * exp(-od * 0.12) * ph2;
                sun *= 1.0 - min(dk.x, 1.0) * 0.75 * step(p.y, dk.y); // under the rain deck the sun is mostly gone
                vec3 S = litColor * (sun * sunScale) + shadowColor * mix(0.2, 0.6, amb);
                S += vec3(0.75, 0.8, 1.0) * (flash * (1.6 - amb));    // lightning inside the cloud
                C += T * a * S;
                tw += T * a * t; aw += T * a;
                if (entry == NO_HIT && 1.0 - T * (1.0 - a) > 0.03) entry = t;
                T *= 1.0 - a;
                if (T < 0.015) break;
                empty = 0.0;
            } else empty += 1.0;
            // clear air inside the layer (between towers, under the deck): stride on in double steps
            t += dt * (empty > 2.0 ? 2.0 : 1.0);
        }
        float alpha = 1.0 - T;
        if (aw <= 0.0) return;
        // aerial perspective at the cloud's mean depth, and a fade before the march gives up
        vec3 ray = rd * (tw / aw);
        vec2 fg = skyFogAmount(ray, camPos.y);
        C = mix(C, skyFogColor(fogColor, ray, fg.y) * alpha, fg.x);
        float fade = 1.0 - smoothstep(maxDist * 0.8, maxDist, length(ray.xz));
        oColor = vec4(C, alpha) * fade;
        oInfo = vec4(entry, limit, tw / aw, 1.0);
    }`;

// The clamp box for the resolve: the lowest and highest value among each march sample's 3x3 neighbourhood,
// at the march's resolution (and a tent-filtered copy of the frame, for while the view moves). The resolve
// reads it bilinearly, so the box changes smoothly from pixel to pixel (a box taken per march texel would
// clamp the history in blocks while moving: a woven pattern).
const BOX_FRAG = /* glsl */`
    precision highp float;
    uniform sampler2D tCur;
    uniform vec2 lowRes;
    layout(location = 0) out vec4 oLo;
    layout(location = 1) out vec4 oHi;
    layout(location = 2) out vec4 oMean;
    void main() {
        ivec2 ip = ivec2(gl_FragCoord.xy), mx = ivec2(lowRes) - 1;
        vec4 lo = vec4(1e5), hi = vec4(-1e5), sum = vec4(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec4 v = texelFetch(tCur, clamp(ip + ivec2(x, y), ivec2(0), mx), 0);
            lo = min(lo, v); hi = max(hi, v);
            sum += v * float((2 - x * x) * (2 - y * y));
        }
        oLo = lo; oHi = hi; oMean = sum / 16.0;
    }`;

// Temporal upsampling resolve (at the history's resolution, finer than the march): rebuild this frame's
// image at each history pixel from the four jittered march samples around it (bilinear), then
// blend it into the history reprojected to where the cloud was last frame (by the cloud's mean depth), read
// with a sharp Catmull-Rom filter and clamped to this frame's neighbourhood so nothing ghosts. A sample that
// lands right on the pixel counts for more, and a moving view takes more of the new frame (less smear).
const RESOLVE_FRAG = /* glsl */`
    uniform sampler2D tCur, tInfo, tHist, tLo, tHi, tMean;
    uniform mat4 projInv, camWorld, prevViewProj;
    uniform vec3 camPos;
    uniform vec2 lowRes, histRes, jitter;
    uniform float reset, minBlend;
    // Catmull-Rom history sample in five bilinear taps (the corner taps are dropped)
    vec4 historyAt(vec2 uv) {
        vec2 sp = uv * histRes, t1 = floor(sp - 0.5) + 0.5, f = sp - t1;
        vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
        vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
        vec2 w12 = w1 + w2, t0 = (t1 - 1.0) / histRes, t3 = (t1 + 2.0) / histRes, t12 = (t1 + w2 / w12) / histRes;
        vec4 r = texture2D(tHist, vec2(t12.x, t0.y)) * (w12.x * w0.y) + texture2D(tHist, vec2(t0.x, t12.y)) * (w0.x * w12.y)
               + texture2D(tHist, t12) * (w12.x * w12.y) + texture2D(tHist, vec2(t3.x, t12.y)) * (w3.x * w12.y)
               + texture2D(tHist, vec2(t12.x, t3.y)) * (w12.x * w3.y);
        return r / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y);
    }
    vec4 rSum; float rW, rConf, rCut, rD, rDW; vec2 rX; ivec2 rC, rMx;
    // (the scene distance and the cloud's mean depth there)
    vec2 infoAt(ivec2 o) { return texelFetch(tInfo, clamp(rC + o, ivec2(0), rMx), 0).yz; }
    void tap(ivec2 o, vec2 info) {
        float lim = info.x;
        // a march sample whose ray hit something near and much nearer than its neighbours' (a jet, a hillside)
        // doesn't speak for the sky next to it: leave it out (the composite's depth test cuts the cloud at the
        // object's edge). (Far ridges keep theirs: the march already looks past them where a texel straddles one.)
        if (lim < rCut) return;
        ivec2 ip = clamp(rC + o, ivec2(0), rMx);
        vec4 v = texelFetch(tCur, ip, 0);
        vec2 d = vec2(ip) + 0.5 + jitter - rX;
        vec2 b = max(1.0 - abs(d), 0.0); // (bilinear between the jittered samples: smooth even in one frame)
        float w = b.x * b.y + 1e-4;
        rSum += v * w; rW += w; rConf = max(rConf, w);
        // the cloud's depth, interpolated the same way (for the reprojection: one depth per march texel would
        // shift the history in blocks while moving)
        if (v.a > 0.01) { rD += info.y * w; rDW += w; }
    }
    void main() {
        // the four march samples around this pixel (jittered positions; unrolled, no arrays: those end up in slow
        // memory on some GPUs)
        rX = gl_FragCoord.xy / histRes * lowRes; // this pixel, in march pixels
        // the clamp box (see BOX_FRAG), read between the march samples; nothing in it: no cloud here (the history
        // would be clamped to nothing anyway), which is most of the screen
        vec2 buv = (rX - jitter) / lowRes;
        vec4 hi = texture2D(tHi, buv);
        if (hi.a < 1e-4) { gl_FragColor = vec4(0.0); return; }
        rC = ivec2(floor(rX - 0.5 - jitter)); rMx = ivec2(lowRes) - 1;
        vec2 l0 = infoAt(ivec2(0, 0)), l1 = infoAt(ivec2(1, 0)), l2 = infoAt(ivec2(0, 1)), l3 = infoAt(ivec2(1, 1));
        rCut = min(max(max(l0.x, l1.x), max(l2.x, l3.x)) * 0.6, 3000.0);
        rSum = vec4(0.0); rW = 0.0; rConf = 0.0; rD = 0.0; rDW = 0.0;
        tap(ivec2(0, 0), l0); tap(ivec2(1, 0), l1); tap(ivec2(0, 1), l2); tap(ivec2(1, 1), l3);
        // (the box opened up a little)
        vec4 lo = texture2D(tLo, buv), ext = (hi - lo) * 0.1;
        lo -= ext; hi += ext;
        vec4 cur = rSum / max(rW, 1e-5);
        float conf = rConf;
        vec2 uv = gl_FragCoord.xy / histRes;
        vec4 vp = projInv * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
        vec3 rd = normalize(mat3(camWorld) * (vp.xyz / vp.w));
        float d = rDW > 0.0 ? rD / rDW : 20000.0;
        vec4 pc = prevViewProj * vec4(camPos + rd * min(d, 20000.0), 1.0);
        vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
        if (reset > 0.5 || pc.w <= 0.0 || puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) { gl_FragColor = cur; return; }
        vec4 h = clamp(historyAt(puv), lo, hi);
        float moved = length((puv - uv) * histRes), m = smoothstep(0.3, 2.0, moved);
        // while moving, the new frame's own grain (its dither pattern) would show: take it softened
        cur = mix(cur, texture2D(tMean, buv), 0.65 * m);
        // still: a sample right on the pixel counts for more (the finer image builds up over the jitter pattern);
        // moving: the same share of the new frame everywhere (a share that varied across the sample grid would
        // weave the grid into the picture), more of it the faster the view moves
        float a = mix(mix(0.02, 0.2, conf * conf), 0.22 + min(moved * 0.01, 0.2), m);
        a = max(a, minBlend);
        gl_FragColor = mix(h, cur, clamp(a, 0.0, 1.0));
    }`;

const COMPOSITE_VERT = /* glsl */`
    uniform mat4 projInv;
    varying vec3 vRay;
    void main() {
        vec4 p = projInv * vec4(position.xy, 0.5, 1.0);
        vRay = p.xyz / p.w;
        vRay /= -vRay.z;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }`;

// The composite: the history (bilinear: it is nearly at the screen's resolution), at the depth where the cloud
// starts, so the hardware depth test cuts it cleanly around aircraft and terrain at full resolution
const COMPOSITE_FRAG = /* glsl */`
    uniform sampler2D tCloud, tInfo;
    uniform vec2 lowRes, fullRes;
    uniform float camNear;
    uniform mat4 projMat;
    varying vec3 vRay;
    void main() {
        vec2 uv = gl_FragCoord.xy / fullRes;
        vec4 col = texture2D(tCloud, uv);
        if (col.a < 0.002) discard;
        // the nearest cloud entry among the four march texels around, leaving out any whose ray hit something much
        // nearer than the others (their cloud, if any, is behind that object anyway)
        vec2 st = uv * lowRes - 0.5;
        ivec2 i0 = ivec2(floor(st)), mx = ivec2(lowRes) - 1;
        vec2 ia = texelFetch(tInfo, clamp(i0, ivec2(0), mx), 0).xy, ib = texelFetch(tInfo, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0).xy;
        vec2 ic = texelFetch(tInfo, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0).xy, id = texelFetch(tInfo, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0).xy;
        vec4 lim = vec4(ia.y, ib.y, ic.y, id.y), ent = vec4(ia.x, ib.x, ic.x, id.x);
        float lmax = max(max(lim.x, lim.y), max(lim.z, lim.w));
        ent = mix(vec4(${NO_HIT.toFixed(1)}), ent, step(min(lmax * 0.6, 3000.0), lim));
        float entry = min(min(ent.x, ent.y), min(ent.z, ent.w));
        // (no entry in any of them: the cloud came from the history alone, e.g. while turning; far enough)
        float vz = max(min(entry, 30000.0) / length(vRay), camNear * 1.001);
        vec4 clip = projMat * vec4(vRay * vz, 1.0);
        #ifdef USE_REVERSED_DEPTH_BUFFER
        gl_FragDepth = clamp(clip.z / clip.w, 0.0, 1.0);
        #else
        gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
        #endif
        gl_FragColor = col; // premultiplied
    }`;

// The cloud-shadow map: for each point of the weather tile (in wind space: it drifts with the clouds), how
// much sunlight gets through the cloud layer along the sun's direction, marched through the same density
// field as the clouds themselves (without the finest detail), so the shadows on the ground match the clouds.
// Redrawn a band of rows per frame (the billows keep changing slowly), or whole after a change of weather.
const SHADOW_FRAG = /* glsl */`
    precision highp float;
    uniform vec3 sunDir;
    ${FIELD_GLSL}
    void main() {
        vec2 ws = gl_FragCoord.xy / ${SHADOW_RES.toFixed(1)} * WEATHER_SIZE;
        vec3 L = vec3(sunDir.x, max(sunDir.y, 0.1), sunDir.z);
        float dt = (slab.y - slab.x) / L.y / ${SHADOW_STEPS.toFixed(1)}, dl = dt * length(L);
        vec3 p0 = vec3(ws.x + wind.x, slab.x, ws.y + wind.z);
        float od = 0.0, a;
        pixFoot = 100.0;
        for (int i = 0; i < ${SHADOW_STEPS}; i++) {
            vec3 p = p0 + L * (dt * (float(i) + 0.5));
            if (cloudGap(p, weatherAt(p)) > dl) continue;
            od += cloudDensity(p, weatherSmooth(p), 1.5, false, a) * dl;
        }
        gl_FragColor = vec4(vec3(exp(-od * SIGMA * 0.35)), 1.0);
    }`;

// Mid-pass depth resolve of a multisampled render target: blit its multisampled depth into the depth texture
// of its resolve framebuffer (what three does itself when the pass ends), so the march can read the scene
// depth while the scene is still being drawn. false when that isn't possible (render-to-texture MSAA, where
// there is no separate multisampled framebuffer).
function resolveDepth(renderer, target) {
    if (renderer.extensions.has('WEBGL_multisampled_render_to_texture')) return false;
    const p = renderer.properties.get(target);
    const ms = p.__webglMultisampledFramebuffer, fb = p.__webglFramebuffer;
    if (!ms || !fb || Array.isArray(fb)) return false;
    const gl = renderer.getContext(), st = renderer.state;
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, ms);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
    gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, ms); // (the march switches targets next and restores this one after)
    return true;
}

function fullScreenTriangle() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    return g;
}

// ── Cloud shadows on the ground (and on anything else lit by the sun) ──
// Every built-in lit material gets its sun light (directional light 0) dimmed by the cloud-shadow map: the
// point is carried along the sun's direction down (or up) to the bottom of the cloud layer, where the map's
// rays start, and the light that gets through there read off the map. The parameters are typed arrays shared
// by every material's uniforms (UniformsUtils.clone keeps them by reference), switched on only while the world
// scene renders (the cockpit scene has its own coordinates). The map itself is a DataTexture (a render target's
// texture would not survive the uniform cloning), updated from the render target it is drawn into.
const SHADOW = {
    a: new Float32Array([0, 1, 0, 0]),         // sun direction (world), on
    b: new Float32Array([1000, 1500, 2600, 0.85]), // altitude the map's rays start from, fade out between two altitudes, strength
    c: new Float32Array([0, 0, 0, 0]),         // wind drift x, z
};
// (also for custom shaders, e.g. the water: include CLOUD_SHADOW_GLSL, add Clouds.shadowUniforms(), call
// cloudSunShadowAt(worldPos))
export const CLOUD_SHADOW_GLSL = /* glsl */`
uniform sampler2D cloudShadowMap;
uniform vec4 cloudShadowA, cloudShadowB, cloudShadowC;
// 1 = full sun .. less where a cloud stands between the world point wp and the sun
float cloudSunShadowAt( vec3 wp ) {
    if ( cloudShadowA.w < 0.5 ) return 1.0;
    vec3 L = cloudShadowA.xyz;
    vec2 q = wp.xz + L.xz * ( ( cloudShadowB.x - wp.y ) / max( L.y, 0.1 ) ) - cloudShadowC.xy;
    float tr = texture2D( cloudShadowMap, q / ${WEATHER_SIZE.toFixed(1)} ).r;
    // (points up in the cloud layer, like a jet, have less cloud above them than the whole column)
    return mix( 1.0, tr, cloudShadowB.w * ( 1.0 - smoothstep( cloudShadowB.y, cloudShadowB.z, wp.y ) ) );
}`;
const SHADOW_GLSL = CLOUD_SHADOW_GLSL + /* glsl */`
float cloudSunShadow( vec3 viewPos ) {
    return cloudSunShadowAt( cameraPosition + ( vec4( viewPos, 0.0 ) * viewMatrix ).xyz );
}`;
function installCloudShadows(map) {
    const C = THREE.ShaderChunk, anchor = 'getDirectionalLightInfo( directionalLight, directLight );';
    if (!C.lights_fragment_begin.includes('cloudSunShadow')) {
        if (!C.lights_fragment_begin.includes(anchor)) return false; // three.js changed: no cloud shadows
        C.lights_fragment_begin = C.lights_fragment_begin.replace(anchor, anchor + `
		#if ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= cloudSunShadow( geometryPosition );
		#endif`);
        C.lights_pars_begin += SHADOW_GLSL;
    }
    for (const k in THREE.ShaderLib) {
        const L = THREE.ShaderLib[k];
        if (!L.fragmentShader.includes('<lights_pars_begin>')) continue;
        Object.assign(L.uniforms, { cloudShadowMap: { value: map }, cloudShadowA: { value: SHADOW.a }, cloudShadowB: { value: SHADOW.b }, cloudShadowC: { value: SHADOW.c } });
    }
    return true;
}

// ═══════════════════════════════════════════════════════════════
export class Clouds {
    constructor(scene, renderer, { FOG_GLSL, SKY_FOG }) {
        this.renderer = renderer;
        this.SKY_FOG = SKY_FOG;
        // the noise textures start as one-texel stand-ins; the real data comes from a worker (setNoise), and
        // the clouds stay hidden until it has arrived
        this.ready = false;
        this.enabled = true;
        const weather = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
        weather.wrapS = weather.wrapT = THREE.RepeatWrapping;
        weather.magFilter = THREE.LinearFilter;
        weather.minFilter = THREE.LinearFilter; // (only ever read at full resolution)
        weather.generateMipmaps = false;
        weather.needsUpdate = true;
        const base = new THREE.Data3DTexture(new Uint16Array(2), 1, 1, 1);
        base.format = THREE.RGFormat;
        base.type = THREE.HalfFloatType;
        const detail = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1);
        detail.format = THREE.RedFormat;
        detail.unpackAlignment = 1;
        for (const t of [base, detail]) {
            t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
            t.magFilter = THREE.LinearFilter;
            t.minFilter = THREE.LinearMipmapLinearFilter;
            t.generateMipmaps = true;
            t.needsUpdate = true;
        }
        this.textures = [weather, base, detail];

        // the march buffer: premultiplied colour + alpha, and (cloud entry distance, scene distance, mean depth)
        this.rt = new THREE.WebGLRenderTarget(4, 4, { count: 2, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
        for (const t of this.rt.textures) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
        // the resolve's clamp box (lowest, highest of each march sample's neighbourhood), read bilinearly
        this.boxRT = new THREE.WebGLRenderTarget(4, 4, { count: 3, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
        for (const t of this.boxRT.textures) { t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; }
        // temporal history (ping-pong) at a finer resolution: what the composite actually shows
        this.hist = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }));
        this.histIdx = 0;
        this.frame = 0;
        this.resetHistory = true;
        this.prevViewProj = new THREE.Matrix4();
        this.prevCamPos = new THREE.Vector3(1e9, 0, 0);

        this.windOff = new THREE.Vector3(); // x, z drift; y: rise of the billows
        this.fieldU = {
            tWeather: { value: weather }, tBase: { value: base }, tDetail: { value: detail },
            wind: { value: this.windOff }, cu: { value: new THREE.Vector4() }, dk: { value: new THREE.Vector4() }, slab: { value: new THREE.Vector2() },
        };
        const tri = fullScreenTriangle();
        const pass = (mat) => { const sc = new THREE.Scene(), m = new THREE.Mesh(tri, mat); m.frustumCulled = false; sc.add(m); return sc; };
        this.marchCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.marchMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
            defines: {},
            uniforms: {
                ...this.fieldU,
                tDepth: { value: null }, hasDepth: { value: 0 }, camNear: { value: 1 }, camFar: { value: 1000 }, maxDist: { value: 18000 }, sunScale: { value: 1.0 }, frame: { value: 0 }, pixAngle: { value: 0.0025 }, flash: { value: 0 },
                projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, lowRes: { value: new THREE.Vector2(4, 4) }, jitter: { value: new THREE.Vector2() },
                camPos: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
                litColor: { value: new THREE.Color(1, 1, 1) }, shadowColor: { value: new THREE.Color(0.5, 0.55, 0.6) }, fogColor: { value: new THREE.Color() },
                skyFogA: { value: SKY_FOG.a }, skyFogB: { value: SKY_FOG.b }, skyFogC: { value: SKY_FOG.c }, skyFogD: { value: SKY_FOG.d },
            },
            vertexShader: TRI_VERT,
            fragmentShader: marchFrag(FOG_GLSL),
        });
        this.marchScene = pass(this.marchMat);
        this.boxMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
            uniforms: { tCur: { value: this.rt.textures[0] }, lowRes: { value: new THREE.Vector2(4, 4) } },
            vertexShader: TRI_VERT,
            fragmentShader: BOX_FRAG,
        });
        this.boxScene = pass(this.boxMat);
        this.resolveMat = new THREE.ShaderMaterial({
            depthTest: false, depthWrite: false, blending: THREE.NoBlending,
            uniforms: {
                tCur: { value: this.rt.textures[0] }, tInfo: { value: this.rt.textures[1] }, tHist: { value: null },
                tLo: { value: this.boxRT.textures[0] }, tHi: { value: this.boxRT.textures[1] }, tMean: { value: this.boxRT.textures[2] },
                projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, prevViewProj: { value: this.prevViewProj },
                camPos: { value: new THREE.Vector3() }, lowRes: { value: new THREE.Vector2(4, 4) }, histRes: { value: new THREE.Vector2(4, 4) },
                jitter: { value: new THREE.Vector2() }, reset: { value: 1 }, minBlend: { value: 0 },
            },
            vertexShader: TRI_VERT,
            fragmentShader: RESOLVE_FRAG,
        });
        this.resolveScene = pass(this.resolveMat);

        // the cloud-shadow map (see SHADOW_FRAG): drawn into a render target, copied into the texture the lit
        // materials read
        this.shadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
        this.shadowRT.scissorTest = true;
        const clear = new Uint8Array(SHADOW_RES * SHADOW_RES * 4).fill(255);
        this.shadowTex = new THREE.DataTexture(clear, SHADOW_RES, SHADOW_RES, THREE.RGBAFormat);
        this.shadowTex.wrapS = this.shadowTex.wrapT = THREE.RepeatWrapping;
        this.shadowTex.magFilter = this.shadowTex.minFilter = THREE.LinearFilter;
        this.shadowTex.needsUpdate = true;
        this.shadowMat = new THREE.ShaderMaterial({
            depthTest: false, depthWrite: false, blending: THREE.NoBlending,
            defines: { DETAIL: 0 }, uniforms: { ...this.fieldU, sunDir: { value: new THREE.Vector3(0, 1, 0) } },
            vertexShader: TRI_VERT,
            fragmentShader: SHADOW_FRAG,
        });
        this.shadowScene = pass(this.shadowMat);
        this.shadowRow = 0;
        this.shadowAll = true; // redraw the whole map next frame
        this._box = new THREE.Box2();
        this._pos = new THREE.Vector2();

        this.compMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, depthTest: true, fog: false,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
            uniforms: {
                tCloud: { value: this.hist[0].texture }, tInfo: { value: this.rt.textures[1] },
                lowRes: { value: new THREE.Vector2(4, 4) }, fullRes: { value: new THREE.Vector2(4, 4) },
                camNear: { value: 1 }, projInv: { value: new THREE.Matrix4() }, projMat: { value: new THREE.Matrix4() },
            },
            vertexShader: COMPOSITE_VERT,
            fragmentShader: COMPOSITE_FRAG,
        });
        this.mesh = new THREE.Mesh(tri, this.compMat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 5;
        this.mesh.raycast = () => {};
        this.mesh.onBeforeRender = (r, s, cam) => this.march(r, cam);
        this.mesh.visible = false;
        scene.add(this.mesh);

        // cloud shadows: on while the world scene renders
        this.shadows = installCloudShadows(this.shadowTex);
        const before = scene.onBeforeRender, after = scene.onAfterRender;
        this.scene = scene;
        this.unhook = () => { scene.onBeforeRender = before; scene.onAfterRender = after; SHADOW.a[3] = 0; };
        scene.onBeforeRender = (...a) => { SHADOW.a[3] = this.shadows && this.mesh.visible ? 1 : 0; before.apply(scene, a); };
        scene.onAfterRender = (...a) => { SHADOW.a[3] = 0; after.apply(scene, a); };

        this.setWeather('clear', 0);
        this.setQuality('high');
        this.compile();
        this.loadNoise();
    }

    // a few hundred ms of noise generation, off the main thread when module workers are available
    loadNoise() {
        const here = () => setTimeout(() => this.setNoise(makeCloudNoise()), 0);
        try {
            const w = new Worker(new URL('./cloudnoise.js', import.meta.url), { type: 'module' });
            w.onmessage = (e) => { w.terminate(); this.setNoise(e.data); };
            w.onerror = (e) => { e.preventDefault?.(); w.terminate(); here(); };
            w.postMessage(0);
        } catch (e) { here(); }
    }
    setNoise({ weather, weatherHalf, base, baseHalf, detail }) {
        if (this.disposed) return;
        this.weatherData = weather; this.baseData = base;
        const [tw, tb, td] = this.textures;
        tw.image = { data: weatherHalf, width: WEATHER_RES, height: WEATHER_RES };
        tb.image = { data: baseHalf, width: BASE_RES, height: BASE_RES, depth: BASE_RES };
        td.image = { data: detail, width: DETAIL_RES, height: DETAIL_RES, depth: DETAIL_RES };
        for (const t of this.textures) t.needsUpdate = true;
        this.ready = true;
        this.mesh.visible = this.enabled;
        this.resetHistory = true;
        this.shadowAll = true;
    }

    // compile the offscreen passes now rather than on the first frame that shows a cloud
    compile() {
        try {
            for (const sc of [this.marchScene, this.boxScene, this.resolveScene, this.shadowScene]) this.renderer.compile(sc, this.marchCam);
        } catch (e) { /* no GL (tests) */ }
    }

    // uniforms for a custom shader that includes CLOUD_SHADOW_GLSL (shared by reference: always current)
    shadowUniforms() {
        return { cloudShadowMap: { value: this.shadowTex }, cloudShadowA: { value: SHADOW.a }, cloudShadowB: { value: SHADOW.b }, cloudShadowC: { value: SHADOW.c } };
    }

    get visible() { return this.enabled; }
    set visible(v) { this.enabled = v; this.mesh.visible = v && this.ready; }
    // lightning (0..1): a flash lights the clouds from inside; the history would smear it, so it resets
    get flash() { return this.marchMat.uniforms.flash.value; }
    set flash(f) {
        const u = this.marchMat.uniforms.flash;
        if (f !== u.value) { if (f > u.value) this.resetHistory = true; u.value = f; }
    }

    setQuality(q) {
        const Q = QUALITY[q] || QUALITY.high;
        this.q = Q;
        const ratio = Q.light >= 5 ? 2 : Q.light === 4 ? 2.3 : 3;
        const step0 = 680 * (ratio - 1) / (Math.pow(ratio, Q.light) - 1); // the light march reaches ~680 m
        const d = { MAX_STEPS: Q.steps, LIGHT_STEPS: Q.light, LIGHT_STEP0: step0.toFixed(2), LIGHT_RATIO: ratio.toFixed(2), DETAIL: Q.detail };
        const m = this.marchMat;
        if (JSON.stringify(m.defines) !== JSON.stringify(d)) { m.defines = d; m.needsUpdate = true; if (this.resolveScene) this.compile(); }
    }

    // weather: 'clear' | 'cloudy' | 'rain' | 'storm'
    setWeather(key, overcast) {
        const W = this.weather = WEATHER[key] || WEATHER.clear;
        const f = this.fieldU;
        f.cu.value.set(W.thr, W.base, W.thick, W.baseVar);
        f.dk.value.set(W.deck, DECK_Y, DECK_THICK, 0);
        let lo = W.base - W.baseVar * 0.7 - 30, hi = W.base + W.baseVar * 0.7 + Math.min(W.thick * TOWER, W.thick + TOWER_MAX) + 60;
        if (W.deck > 0) { lo = Math.min(lo, DECK_Y - 160); hi = Math.max(hi, DECK_Y + DECK_THICK + 60); }
        f.slab.value.set(lo, hi);
        // shadows: rays from the bottom of the layer; a point up among the clouds has less of them above it
        SHADOW.b[0] = lo; SHADOW.b[1] = W.base + W.thick * 0.25; SHADOW.b[2] = W.base + W.thick * 1.2;
        this.overcast = overcast || 0;
        this.resetHistory = true;
        this.shadowAll = true;
    }

    // palette from World.setTime (colours are linear)
    setPalette({ lit, shadow, sunDir, overcast = 0 }) {
        const u = this.marchMat.uniforms;
        u.litColor.value.copy(lit).multiplyScalar(1 - overcast * 0.4);
        u.shadowColor.value.copy(shadow);
        // the HUD's white-out should be as bright as the cloud around you (dim at dusk, faint at night)
        this.whiteBright = Math.min(1, 0.3 * shadow.r + 0.59 * shadow.g + 0.11 * shadow.b + 0.6 * (0.3 * lit.r + 0.59 * lit.g + 0.11 * lit.b));
        u.sunDir.value.copy(sunDir).normalize();
        if (!this.shadowMat.uniforms.sunDir.value.equals(u.sunDir.value)) { this.shadowMat.uniforms.sunDir.value.copy(u.sunDir.value); this.shadowAll = true; }
        SHADOW.a[0] = u.sunDir.value.x; SHADOW.a[1] = u.sunDir.value.y; SHADOW.a[2] = u.sunDir.value.z;
        this.resetHistory = true;
    }

    update(dt, camera, wind, fogColor) {
        this.windOff.x += wind.x * dt * 0.6;
        this.windOff.z += wind.z * dt * 0.6;
        this.windOff.y += dt * 1.2;
        SHADOW.c[0] = this.windOff.x; SHADOW.c[1] = this.windOff.z;
        const u = this.marchMat.uniforms;
        u.fogColor.value.copy(fogColor);
        u.maxDist.value = this.SKY_FOG.a[3];
    }

    // redraw a band of the cloud-shadow map (all of it after a change), into the texture the materials read
    drawShadows(renderer) {
        const all = this.shadowAll, rows = all ? SHADOW_RES : this.q.shadowRows;
        const y0 = all ? 0 : this.shadowRow;
        this.shadowAll = false;
        this.shadowRow = (y0 + rows) % SHADOW_RES;
        this.shadowRT.viewport.set(0, y0, SHADOW_RES, rows);
        this.shadowRT.scissor.set(0, y0, SHADOW_RES, rows);
        renderer.setRenderTarget(this.shadowRT);
        renderer.render(this.shadowScene, this.marchCam);
        this._box.min.set(0, y0); this._box.max.set(SHADOW_RES, y0 + rows);
        renderer.copyTextureToTexture(this.shadowRT.texture, this.shadowTex, this._box, this._pos.set(0, y0));
    }

    // Runs just before the composite triangle draws, with the opaque scene already in the target
    march(renderer, camera) {
        if (!camera.isPerspectiveCamera) return;
        const target = renderer.getRenderTarget();
        let w, h;
        if (target) { w = target.width; h = target.height; } else { const v = renderer.getDrawingBufferSize(_size); w = v.x; h = v.y; }
        const s = this.q.scale / renderer.getPixelRatio();
        const lw = Math.max(1, Math.round(w * s)), lh = Math.max(1, Math.round(h * s));
        const hw = Math.max(1, Math.round(lw * this.q.up)), hh = Math.max(1, Math.round(lh * this.q.up));
        if (this.rt.width !== lw || this.rt.height !== lh || this.hist[0].width !== hw || this.hist[0].height !== hh) {
            this.rt.setSize(lw, lh); this.boxRT.setSize(lw, lh);
            for (const hr of this.hist) hr.setSize(hw, hh);
            this.resetHistory = true;
        }
        // the opaque scene's depth: a multisampled target (ULTRA's MSAA scene pass) only has it once resolved,
        // which three does at the end of the pass, so resolve it now (depth only)
        let depth = target && target.depthTexture ? target.depthTexture : null;
        if (depth && target.samples > 0 && !resolveDepth(renderer, target)) depth = null;
        const u = this.marchMat.uniforms;
        u.tDepth.value = depth; u.hasDepth.value = depth ? 1 : 0;
        u.projInv.value.copy(camera.projectionMatrixInverse);
        u.camWorld.value.copy(camera.matrixWorld);
        u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
        u.camNear.value = camera.near; u.camFar.value = camera.far;
        u.lowRes.value.set(lw, lh); this.boxMat.uniforms.lowRes.value.set(lw, lh);
        u.pixAngle.value = 2 / (camera.projectionMatrix.elements[5] * lh); // radians per march pixel
        this.frame = (this.frame + 1) % 64;
        u.frame.value = this.frame;
        const j = JITTER[this.frame % JITTER.length];
        u.jitter.value.set(j[0], j[1]);
        const c = this.compMat.uniforms;
        c.lowRes.value.set(lw, lh); c.fullRes.value.set(w, h);
        c.camNear.value = camera.near;
        c.projInv.value.copy(camera.projectionMatrixInverse);
        c.projMat.value.copy(camera.projectionMatrix);
        // history: reset after a jump (a respawn, a camera cut) or a change of weather / time of day
        const R = this.resolveMat.uniforms;
        if (u.camPos.value.distanceToSquared(this.prevCamPos) > 400 * 400) this.resetHistory = true;
        R.reset.value = this.resetHistory ? 1 : 0;
        R.minBlend.value = u.flash.value > 0.01 ? 0.5 : 0;
        this.resetHistory = false;
        R.projInv.value.copy(camera.projectionMatrixInverse);
        R.camWorld.value.copy(camera.matrixWorld);
        R.camPos.value.copy(u.camPos.value);
        R.lowRes.value.set(lw, lh);
        R.histRes.value.set(hw, hh);
        R.jitter.value.copy(u.jitter.value);
        R.tHist.value = this.hist[this.histIdx].texture;
        this.histIdx ^= 1;
        const out = this.hist[this.histIdx];
        c.tCloud.value = out.texture;
        const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
        if (this.shadows) this.drawShadows(renderer);
        renderer.setRenderTarget(this.rt);
        renderer.render(this.marchScene, this.marchCam);
        renderer.setRenderTarget(this.boxRT);
        renderer.render(this.boxScene, this.marchCam);
        renderer.setRenderTarget(out);
        renderer.render(this.resolveScene, this.marchCam);
        renderer.setRenderTarget(target, face, mip);
        this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.prevCamPos.copy(u.camPos.value);
    }

    // ── CPU copy of the field (no detail noise), for the whiteout ──
    weatherAt(x, z, out) {
        const N = WEATHER_RES, D = this.weatherData;
        const u = ((x - this.windOff.x) / WEATHER_SIZE) * N - 0.5, v = ((z - this.windOff.z) / WEATHER_SIZE) * N - 0.5;
        const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
        const i0 = ((i % N) + N) % N, j0 = ((j % N) + N) % N, i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
        for (let c = 0; c < 4; c++) {
            const a = D[(j0 * N + i0) * 4 + c], b = D[(j0 * N + i1) * 4 + c], d = D[(j1 * N + i0) * 4 + c], e = D[(j1 * N + i1) * 4 + c];
            out[c] = (a + (b - a) * fu) * (1 - fv) + (d + (e - d) * fu) * fv;
        }
        return out;
    }
    baseAt(x, y, z, out) {
        const N = BASE_RES, D = this.baseData;
        const u = ((x - this.windOff.x) / BASE_SIZE) * N - 0.5, v = ((y - this.windOff.y) / BASE_SIZE) * N - 0.5, w = ((z - this.windOff.z) / BASE_SIZE) * N - 0.5;
        const i = Math.floor(u), j = Math.floor(v), k = Math.floor(w), fu = u - i, fv = v - j, fw = w - k;
        let r = 0, g = 0;
        for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const wt = (dx ? fu : 1 - fu) * (dy ? fv : 1 - fv) * (dz ? fw : 1 - fw);
            const o = (((((k + dz) % N + N) % N) * N + (((j + dy) % N + N) % N)) * N + (((i + dx) % N + N) % N)) * 2;
            r += D[o] * wt; g += D[o + 1] * wt;
        }
        out[0] = r; out[1] = g;
        return r;
    }
    // 0..1: how much the HUD should white out with the camera at p. The volume already fogs the view from
    // inside a cloud, so this only adds the last bit of milkiness (and less of it when the cloud is dark).
    whiteoutAt(p) {
        return this.densityAt(p) * 0.5 * (this.whiteBright ?? 1);
    }

    // 0..1: cloud density at a world point (the same field the shader marches, minus the finest detail)
    densityAt(p) {
        if (!this.ready || !this.enabled) return 0;
        const f = this.fieldU, cu = f.cu.value, dk = f.dk.value;
        if (p.y < f.slab.value.x || p.y > f.slab.value.y) return 0;
        const wm = this.weatherAt(p.x, p.z, _wm);
        const cov = sat((wm[0] - cu.x) / (1 - cu.x));
        const h = p.y - (cu.y + (wm[3] - 0.5) * cu.w);
        const hf = h / (Math.min(cu.z * wm[1], cu.z + TOWER_MAX) * (0.35 + 0.65 * Math.sqrt(cov)));
        const prof = sat(h * 0.035) * (1 - ss(0.5, 1, hf));
        const c = dk.x > 0 ? sat((wm[2] - (1 - dk.x)) / 0.35) : 0, cover = c * c * (3 - 2 * c);
        const hdk = p.y - dk.y;
        const sd = cover > 0 ? Math.min(hdk + 90, dk.z * cover - hdk) * 0.002 : -1;
        if (prof <= 1 - 1.25 * cov && sd <= 0) return 0;
        const n0 = this.baseAt(p.x, p.y, p.z, _n), n1 = _n[1];
        const nr = ss(0.06, 0.94, n0), nb = (nr + (1 - nr) * 0.45 * (1 - ss(0.05, 0.45, hf))) * prof;
        const cc = cov * (0.85 + 0.4 * n1);
        const d = Math.max(sat((nb - (1 - cc)) / Math.max(cc, 0.05)), sat(sd / 0.03) * sat(n0 * 0.6 + n1 * 0.6 - 0.2));
        return Math.min(sat((d - 0.17) / 0.83) * 3, 1);
    }

    dispose() {
        this.disposed = true;
        this.unhook();
        this.mesh.removeFromParent();
        this.rt.dispose(); this.boxRT.dispose(); this.shadowRT.dispose(); this.shadowTex.dispose();
        for (const h of this.hist) h.dispose();
        this.marchMat.dispose(); this.compMat.dispose(); this.resolveMat.dispose(); this.shadowMat.dispose(); this.boxMat.dispose();
        this.mesh.geometry.dispose();
        for (const t of this.textures) t.dispose();
    }
}
const _size = new THREE.Vector2();
const _wm = [0, 0, 0, 0], _n = [0, 0];
const ss = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
