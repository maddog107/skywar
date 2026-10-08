// ═══════════════════════════════════════════════════════════════
// Ocean renderer: the sea and lakes as a displaced, camera-following grid with physically based shading.
//
// Geometry: CDLOD (Strugar 2010). One 16² or 32² grid patch, drawn instanced at every node the CPU selects from a
// quadtree around the camera: fine patches close to the camera, twice as coarse at each ring out, chosen by the
// 3D distance (so from altitude everything is coarse). Each vertex morphs toward the next coarser grid as it
// nears its level's outer range, so neighbouring levels meet without cracks. The vertex shader displaces it with
// the Gerstner field of water.js (WAVE_GLSL), fading each wave out where the grid gets too coarse for it.
//
// Shading (tiers from the quality setting):
//   low / medium   the old look on displaced water: per-vertex wave normals plus scrolling ripples, blended
//                  over the sea bed (no copy of the scene).
//   high / ultra   opaque water that does its own refraction: just before it draws, the opaque scene (colour and
//                  depth) is copied (blit, resolving MSAA), so each water pixel sees what lies under it:
//                  Beer-Lambert absorption and scattering along the path through the water (turquoise over sand,
//                  deep blue offshore, a greener, murkier lake), refraction distortion, a caustic shimmer on
//                  the bottom, foam where the water is thin (surf, around hulls and piers), whitecaps on folding
//                  crests, ship wakes (a top-down foam map, shipfx.js), sun glint sized by the unresolved roughness
//                  (the FFT detail's mip-averaged slope², oceanfft.js), sky reflection with Fresnel, and a
//                  subsurface glow through thin crests with the sun behind them. The alpha channel carries the
//                  reflection weight for the screen-space reflections (postfx.js reads it as the water mask).
//   high / ultra also mirror the aircraft flying low near the camera in a planar reflection (a half-res pass of just
//                  them from the camera mirrored in the sea: renderPlanar): a jet's belly over the water, which the
//                  screen-space reflections can't show (they only know what the camera sees).
//   From below (the camera under the surface): Snell's window onto the sky and total internal reflection.
// The grid is in the opaque queue at renderOrder 1: after every opaque object, before every transparent one.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { WATER, WAVE_GLSL, SET_DEPTH, SHORE, setSeaState, updateWaveUniforms, setSeaMap, seaFactors } from './water.js';
import { coarseJob, fineJob, runJob } from './watermap.js';
import { OceanFFT } from './oceanfft.js';
import { FIRE_WORLD_GLSL, fireUniforms } from './firelight.js'; // [night] fires, motors and flares glinting on the water

// per quality: patch grid g, finest patch size P0 (m), LOD range ratio, wave fade (in wavelengths), FFT, refraction
const TIERS = {
    low: { tier: 0, g: 8, P0: 64, ratio: 3, lod: [2.5, 3.5], fft: 0 },
    medium: { tier: 1, g: 16, P0: 16, ratio: 3, lod: [4, 6], fft: 0 },
    high: { tier: 2, g: 32, P0: 16, ratio: 3, lod: [8, 12], fft: 256, fftEvery: 2, planar: 0.5 },
    ultra: { tier: 3, g: 32, P0: 8, ratio: 3, lod: [9, 13], fft: 256, fftEvery: 1, planar: 0.5 },
};
export const PLANAR_LAYER = 30; // the objects (and lights) the planar reflection pass draws (renderPlanar)
const LEVELS = 15;       // quadtree depth: the root nodes are P0 · 2^14 across (1–2 thousand km at P0 64..8: the horizon is inside)
const MORPH_START = 0.7; // morph over the outer 30 % of each level's range
const FFT_L = 32;        // FFT patch size (m)
const HEAVES = 4;        // blasts heaving the surface at once (splash.js)

const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _box = new THREE.Box3(), _v = new THREE.Vector3();
const _pt = new THREE.Vector3(), _up = new THREE.Vector3(), _cc = new THREE.Color();
// the uniforms of WAVE_GLSL (see shareWaveUniforms)
const WAVE_UNIFORMS = ['waveA', 'waveB', 'waveN', 'waveOrigin', 'waveLod', 'setDepth', 'seaMapFine', 'seaMapCoarse', 'seaFineInfo', 'seaCoarseInfo', 'shoreInfo', 'time',
    'fftMap', 'fftInfo']; // (and the detail, for the caustics and shafts seen from under water: postfx.js)
const _sf = [0, 0, 0, 0];
const isLakeAt = (x, z) => seaFactors(x || 0, z || 0, _sf)[1] < 0; // (watermap.js: a lake's wind factor is negative)

// one grid patch: (g+1)² vertices on [0,1]² in x/z, every cell split on the same diagonal (so a fully morphed
// patch collapses onto exactly the next coarser grid's triangles)
function patchGeometry(g) {
    const pos = new Float32Array((g + 1) * (g + 1) * 3), idx = [];
    for (let j = 0; j <= g; j++) for (let i = 0; i <= g; i++) {
        const k = (j * (g + 1) + i) * 3;
        pos[k] = i / g; pos[k + 1] = 0; pos[k + 2] = j / g;
    }
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
        const a = j * (g + 1) + i, b = a + 1, c = a + g + 1, d = c + 1;
        idx.push(a, d, b, a, c, d); // (faces +y)
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
}

const VERT = /* glsl */`
    attribute vec4 iPatch; // x0, z0, size, level
    uniform float gridN, lodR0, foamJ;
    uniform sampler2D wakeMap;
    uniform vec4 wakeInfo;   // x0, z0, 1/size, on
    // the surface heaving over a blast (splash.js): x, z, age (s), the dome's height (m) / its radius (m), the waves'
    // length (m), their height (m), fade
    uniform vec4 heaveA[${HEAVES}], heaveB[${HEAVES}];
    uniform int heaveN;
    varying vec3 vWorld;
    varying vec2 vRest;
    varying vec3 vNormal;
    varying vec4 vSea;
    varying vec3 vFoam;   // whitecap now, a moment ago; surf (a breaking shore wave)
    varying float vCrest;
    ${WAVE_GLSL}
    // A charge under the water lifts the surface over it in a dome that falls back into a trough, and rings of waves
    // run out from it (gravity waves from an impulse: the crests move out through their packet at twice its speed,
    // so the rings keep coming out of it and dying ahead of it), lower the further they've run
    float heaveAt(vec2 p) {
        float h = 0.0;
        for (int i = 0; i < ${HEAVES}; i++) {
            if (i >= heaveN) break;
            vec4 A = heaveA[i], B = heaveB[i];
            float r = length(p - A.xy), t = A.z;
            float cp = sqrt(9.81 * B.y / 6.2832), cg = 0.5 * cp;
            if (r > B.x * 2.5 + cp * t + B.y * 2.0) continue;
            float x2 = r * r / (B.x * B.x);
            float dome = A.w * exp(-x2) * (1.0 - exp(-t / 0.12)) * (exp(-t / 0.9) - 0.4 * smoothstep(0.5, 1.8, t) * exp(-t / 3.5));
            float rc = cg * t + B.x * 0.4, w = B.y * 0.8 + 0.3 * cg * t;
            float env = exp(-pow((r - rc) / w, 2.0)) * B.z * sqrt(B.x / (B.x + rc)) * smoothstep(0.2, 1.4, t);
            h += (dome + env * cos(6.2832 / B.y * (r - cp * t))) * B.w;
        }
        return h;
    }
    float lodDist(vec2 p) { return length(vec3(p.x - cameraPosition.x, cameraPosition.y, p.y - cameraPosition.z)); }
    float morphK(float level, float d) {
        float r = lodR0 * exp2(level);
        return clamp((d - r * ${MORPH_START.toFixed(2)}) / (r * ${(1 - MORPH_START).toFixed(2)}), 0.0, 1.0);
    }
    void main() {
        float level = iPatch.w, cell = iPatch.z / gridN;
        vec2 gp = position.xz * gridN; // exact grid coordinates
        vec2 p = iPatch.xy + gp * cell;
        // morph odd vertices onto the next coarser grid, and on again while the next level is morphing too
        float k = morphK(level, lodDist(p));
        if (k > 0.0) {
            gp -= mod(gp, 2.0) * k;
            p = iPatch.xy + gp * cell;
            if (k >= 1.0) {
                float k1 = morphK(level + 1.0, lodDist(p));
                if (k1 > 0.0) {
                    vec2 g2 = gp * 0.5;
                    g2 -= mod(g2, 2.0) * k1;
                    gp = g2 * 2.0;
                    p = iPatch.xy + gp * cell;
                    if (k1 >= 1.0) {
                        float k2 = morphK(level + 2.0, lodDist(p));
                        vec2 g4 = gp * 0.25;
                        g4 -= mod(g4, 2.0) * k2;
                        gp = g4 * 4.0;
                        p = iPatch.xy + gp * cell;
                    }
                }
            }
        }
        float d = lodDist(p);
        vec4 sea = seaFactors(p);
        vec3 gains = setGains(sea);
        // a low flyby's downwash presses the short waves flat while it roughens them with ripples (waterwake.js)
        if (wakeInfo.w > 0.5) {
            vec2 wu = (p - wakeInfo.xy) * wakeInfo.z;
            wu.y = 1.0 - wu.y;
            if (wu.x > 0.0 && wu.y > 0.0 && wu.x < 1.0 && wu.y < 1.0) {
                float ag = textureLod(wakeMap, wu, 0.0).a;
                gains *= vec3(1.0, 1.0 - 0.3 * ag, 1.0 - 0.65 * ag);
            }
        }
        vec3 Tx, Tz; float jac; vec2 jp;
        vec3 disp = waveField(p, d, gains, Tx, Tz, jac, jp);
        // surf: the swell shoaling and breaking on a beach (height only)
        vec2 sg; float br, crest;
        float hs = shoreWave(p, sea, sg, br, crest);
        disp.y += hs; Tx.y += sg.x; Tz.y += sg.y;
        if (heaveN > 0) {
            float h0 = heaveAt(p), e = 0.75;
            disp.y += h0;
            Tx.y += (heaveAt(p + vec2(e, 0.0)) - h0) / e; Tz.y += (heaveAt(p + vec2(0.0, e)) - h0) / e;
        }
        vec3 world = vec3(p.x + disp.x, disp.y, p.y + disp.z);
        vWorld = world; vRest = p; vNormal = normalize(cross(Tz, Tx)); vSea = sea; vCrest = disp.y;
        // whitecaps where crests fold (and the foam they leave), surf on the breaker's face and in its wake
        float wc = smoothstep(foamJ, foamJ - 0.14, jac);
        float wp = max(smoothstep(foamJ, foamJ - 0.14, jp.x) * 0.75, smoothstep(foamJ, foamJ - 0.14, jp.y) * 0.45);
        vFoam = vec3(wc, wp, br * (smoothstep(0.55, 0.95, crest) + 0.35 * smoothstep(0.2, 0.9, 1.0 - crest)));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }`;

// Inherent optical properties of the water (per metre, at R G B ≈ 600, 550, 465 nm): absorption a, scattering b,
// backscattering bb. Clear oceanic water (Jerlov I–IB): pure water's own absorption (Pope & Fry 1997) plus a
// little particle scattering, so a sand bed shows through 10–20 m of it; coastal water (Jerlov 3–5: the surf zone,
// a storm's churned shallows): sediment that scatters and chlorophyll / CDOM that absorb the blue, greener and
// cloudier; lake water: humic CDOM, brown-green and darker. From them: the beam attenuation c = a + b (how fast the
// view through the water fades), the diffuse attenuation Kd ≈ (a + bb) / 0.8 (how fast daylight fades on its way
// down to the bed) and the backscatter albedo bb / (a + bb) (the colour of deep water).
export const OPTICS = {
    ocean: { a: [0.29, 0.06, 0.015], b: [0.012, 0.016, 0.022], bb: [0.0011, 0.0021, 0.0026] },
    coast: { a: [0.38, 0.12, 0.20], b: [0.35, 0.38, 0.40], bb: [0.007, 0.0085, 0.0095] },
    lake: { a: [0.42, 0.12, 0.24], b: [0.12, 0.13, 0.14], bb: [0.003, 0.0035, 0.0035] },
};
const v3 = (a) => `vec3(${a.map(x => x.toFixed(4)).join(', ')})`;
const OPTICS_GLSL = /* glsl */`
    struct Optics { vec3 c; vec3 kd; vec3 alb; };
    // turb: 0 clear sea .. 1 churned coastal water; lake: 0 sea .. 1 lake
    Optics waterOptics(float turb, float lake) {
        vec3 a = mix(mix(${v3(OPTICS.ocean.a)}, ${v3(OPTICS.coast.a)}, turb), ${v3(OPTICS.lake.a)}, lake);
        vec3 b = mix(mix(${v3(OPTICS.ocean.b)}, ${v3(OPTICS.coast.b)}, turb), ${v3(OPTICS.lake.b)}, lake);
        vec3 bb = mix(mix(${v3(OPTICS.ocean.bb)}, ${v3(OPTICS.coast.bb)}, turb), ${v3(OPTICS.lake.bb)}, lake);
        Optics o;
        // (the view through it: most of what the particles scatter goes on forward, so the image of the bed fades
        // with the absorption, the backscatter and a little of the forward scattering, not all of b)
        o.c = a + bb + 0.15 * b; o.kd = (a + bb) / 0.8; o.alb = bb / (a + bb);
        return o;
    }
    // The light deep water sends back: the palette's water colour sets how bright (the light of the hour), the optics
    // its hue, with a little of the palette's own and a neutral share: what a camera sees of the open sea from the air
    // also holds the skylight its surface reflects and the haze in between, so deep ocean reads dark navy to indigo in
    // photographs, not the pure blue of the water-leaving light (checked against aerial photos from 50 to 5,000 m)
    vec3 deepWater(vec3 deep, Optics o) {
        float sum = deep.r + deep.g + deep.b;
        vec3 hue = mix(mix(o.alb / dot(o.alb, vec3(1.0)), deep / max(sum, 1e-4), 0.1), vec3(1.0 / 3.0), DEEP_GREY);
        return sum * hue * DEEP_K;
    }
    // how churned the water is (0 clear .. 1 coastal) over a bed wet metres down: the surf zone stirs up sand (more
    // in rougher seas), a storm clouds the shallows, and a gale fills the open sea with bubbles (paler, greyer)
    float churn(float wet) {
        return clamp((1.0 - smoothstep(0.6, 4.5, wet)) * (0.3 + 0.7 * whitecap) + whitecap * 0.35 * (1.0 - smoothstep(6.0, 40.0, wet))
            + whitecap * whitecap * 0.25, 0.0, 1.0);
    }`;

const DEEP_K = 0.46;    // the deep colour's brightness against the palette's water colour
const DEEP_GREY = 0.28; // its neutral share (see deepWater)
const smooth01 = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
function fragShader(FOG_GLSL, CLOUD_SHADOW_GLSL) {
    return /* glsl */`
    #define DEEP_K ${DEEP_K.toFixed(3)}
    #define DEEP_GREY ${DEEP_GREY.toFixed(3)}
    #define CAUSTIC_K 1.0
    uniform float time, whitecap, windU, underwater, geomS2;
    uniform vec3 sunDir, sunColor, skyColor, horizonColor, deepColor, fogColor;
    // the sky dome's own palette (world.js skyMat, shared): the sky the water mirrors
    uniform vec3 skyGlow, skyBelt, skyGlowDir, skySun;
    uniform float skyLowSun, skyOvercast, skyNight;
    uniform vec2 swellDir;
    uniform sampler2D detailMap, foamMap;
    #if TIER >= 2
    uniform sampler2D fftMap, refrColor, refrDepth;
    uniform vec4 fftInfo;       // 1/L, 1/L2, slope gain, detail fade distance
    uniform float refrOn, camNear, camFar, planarOn;
    uniform sampler2D planarMap;
    uniform mat4 planarVP;
    uniform vec2 invProj;
    uniform mat4 camWorld;
    #endif
    uniform sampler2D wakeMap;
    uniform vec4 wakeInfo;      // x0, z0, 1/size, on
    varying vec3 vWorld;
    varying vec2 vRest;
    varying vec3 vNormal;
    varying vec4 vSea;
    varying vec3 vFoam;
    varying float vCrest;
    uniform vec2 windDir;
    ${FOG_GLSL}
    ${CLOUD_SHADOW_GLSL}
    ${FIRE_WORLD_GLSL}
    ${OPTICS_GLSL}
    #if TIER >= 2
    float linDepth(float d) {
        #ifdef USE_REVERSED_DEPTH_BUFFER
        return (camNear * camFar) / ((camFar - camNear) * d + camNear);
        #else
        return (camNear * camFar) / (camFar - (camFar - camNear) * d);
        #endif
    }
    bool isSky(float d) {
        #ifdef USE_REVERSED_DEPTH_BUFFER
        return d <= 0.0;
        #else
        return d >= 1.0;
        #endif
    }
    // world point -> screen uv (and its view depth in w)
    vec3 toScreen(vec3 w) {
        vec3 v = (viewMatrix * vec4(w, 1.0)).xyz;
        return vec3(v.xy / (-v.z * invProj) * 0.5 + 0.5, -v.z);
    }
    #endif
    // The sky the water mirrors: the dome's gradient, the glow round the sun and the twilight belt (world.js skyMat,
    // less the sun's disc: that is the glint), then the clouds: where the mirrored ray meets the cloud base, the
    // cloud-shadow map says how much cloud stands there (its column toward the sun), drawn as the clouds' grey bases.
    vec3 skyAt(vec3 R) {
        float up = clamp(R.y, 0.0, 1.0);
        vec3 c = mix(horizonColor, skyColor, pow(up, 0.5));
        vec3 gd = normalize(skyGlowDir);
        float sdr = dot(R, gd), sd = max(sdr, 0.0);
        c += skyGlow * pow(sd, 6.0) * (0.25 + skyLowSun * 0.9 * exp(-up * 6.0)) * (1.0 - skyOvercast * 0.6);
        c += skyBelt * skyLowSun * pow(max(-sdr, 0.0), 1.5) * exp(-abs(up - 0.08) * 14.0) * (1.0 - skyNight);
        c += skySun * pow(sd, 90.0) * 0.6 * (1.0 - skyNight * 0.8) * (1.0 - skyOvercast * 0.8);
        return c;
    }
    // (Rc: the mirrored ray off a calmer normal for the clouds: a cloud base kilometres off, looked up through every
    // ripple's slope, would only come out as noise)
    vec3 skyRefl(vec3 R, vec3 Rc, vec3 P) {
        vec3 c = skyAt(R);
        if (cloudShadowA.w > 0.5 && Rc.y > 0.012 && P.y < cloudShadowB.x) {
            vec3 Q = P + Rc * ((cloudShadowB.x - P.y) / Rc.y);
            float cov = clamp((1.0 - cloudSunShadowAt(Q)) / max(cloudShadowB.w, 0.1), 0.0, 1.0);
            vec3 base = mix(horizonColor, vec3(dot(horizonColor, vec3(0.3, 0.59, 0.11))), 0.45) * (0.82 + 0.25 * skyOvercast)
                + skySun * 0.06 * (1.0 - skyNight) * (1.0 - skyOvercast);
            // (low / medium, without the screen-space reflections' real clouds, show these flat bases more gently)
            #if TIER >= 2
            c = mix(c, base, cov * smoothstep(0.012, 0.07, Rc.y) * 0.9);
            #else
            c = mix(c, base, cov * smoothstep(0.012, 0.07, Rc.y) * 0.45);
            #endif
        }
        return c;
    }
    // Smith's masking for a Beckmann surface (Walter et al. 2007's rational fit); s2: the slope variance seen along w
    float smithL(float cosT, float s2) {
        float a = cosT / sqrt(max(s2 * (1.0 - cosT * cosT), 1e-7));
        return a < 1.6 ? (1.0 - 1.259 * a + 0.396 * a * a) / (3.535 * a + 2.181 * a * a) : 0.0;
    }
    void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 L = normalize(sunDir);
        vec2 p = vWorld.xz;
        float fp = dist * 0.0015 / max(abs(V.y), 0.06); // metres of water under a pixel (grazing angles stretch it)
        vec3 N = normalize(vNormal);
        float lake = vSea.y < 0.0 ? 1.0 : 0.0; // fresh water (watermap.js: no way out to the sea): its own colour, calmer
        // slope variance the normal at this pixel doesn't carry (grows below); low / medium's few procedural ripples
        // carry far less of it than the FFT detail
        #if TIER >= 2
        float s2u = 0.00015;
        #else
        float s2u = 0.0022 + 0.00001 * dist;
        #endif
        float detLost;          // share of the small-scale detail faded out here
        // the wake map (shipfx.js): foam, milky water, hull shade, agitation (a low flyby's ripples, waterwake.js)
        vec4 wk = vec4(0.0);
        if (wakeInfo.w > 0.5) {
            vec2 wu = (p - wakeInfo.xy) * wakeInfo.z;
            wu.y = 1.0 - wu.y; // drawn looking straight down with -z up the image (shipfx.js WakeMap)
            if (wu.x > 0.0 && wu.y > 0.0 && wu.x < 1.0 && wu.y < 1.0) wk = texture(wakeMap, wu);
        }
        float agit = wk.a * (1.0 - smoothstep(4000.0, 12000.0, dist));
        // ── small-scale detail ──
        #if TIER >= 2
        {
            vec2 u1 = vRest * fftInfo.x, u2 = mat2(0.8, -0.6, 0.6, 0.8) * vRest * fftInfo.y;
            vec4 f1 = texture(fftMap, u1), f2 = texture(fftMap, u2);
            float det = fftInfo.z * (1.0 - smoothstep(fftInfo.w * 0.5, fftInfo.w, dist)) * mix(1.0, 0.6, lake);
            vec2 s2 = mat2(0.8, 0.6, -0.6, 0.8) * f2.xy;
            vec2 slope = (f1.xy + 0.55 * s2) * det;
            N = normalize(N - vec3(slope.x, 0.0, slope.y) * N.y);
            // what the mips averaged away becomes roughness for the glint
            float unres = max(f1.z - dot(f1.xy, f1.xy), 0.0) + 0.3 * max(f2.z - dot(f2.xy, f2.xy), 0.0);
            s2u += unres * det * det;
            detLost = 1.0 - det / max(fftInfo.z, 1e-3);
            // catspaws: the blown water's ripples, the detail again at a third of its scale, turned
            if (agit > 0.01) {
                vec4 f3 = texture(fftMap, mat2(0.6, 0.8, -0.8, 0.6) * vRest * fftInfo.x * 3.1 + time * 0.07);
                float ak = agit * (1.0 - smoothstep(fftInfo.w * 0.3, fftInfo.w, dist));
                N = normalize(N - vec3(f3.x, 0.0, f3.y) * 2.2 * ak * N.y);
                s2u += ak * max(f3.z - dot(f3.xy, f3.xy), 0.0) * 1.7;
            }
        }
        #else
        {
            float r1 = texture2D(detailMap, p / 140.0 + vec2(time * 0.010, time * 0.006)).r;
            float r2 = texture2D(detailMap, p / 53.0 - vec2(time * 0.014, -time * 0.009)).r;
            float r3 = mix(0.5, texture2D(detailMap, p / 17.0 + vec2(-time * 0.02, time * 0.017)).r, 1.0 - smoothstep(0.6, 3.0, fp));
            float k = mix(0.1, 1.0, 1.0 - smoothstep(60.0, 900.0, dist));
            // (calmer at grazing angles, where these few big ripples would mirror the sky as wood grain)
            vec2 rip = (vec2(r1 - r3, r2 - r3)) * 0.3 * k * (0.35 + 0.65 * smoothstep(0.04, 0.3, V.y));
            if (agit > 0.01) {
                float a1 = texture2D(detailMap, p / 5.3 + vec2(time * 0.05, -time * 0.04)).r, a2 = texture2D(detailMap, p / 3.7 - vec2(time * 0.04, time * 0.06)).r;
                rip += vec2(a1 - 0.5, a2 - 0.5) * 0.5 * agit * (1.0 - smoothstep(300.0, 1500.0, dist));
            }
            N = normalize(N - vec3(rip.x, 0.0, rip.y));
            detLost = 1.0 - k;
        }
        #endif
        // far away the water flattens to its mean (only the glint's width remembers the waves)
        float flatK = smoothstep(1500.0, 14000.0, dist) * 0.85;
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), flatK));
        // What the normal no longer carries is roughness, up to the total for this wind (Cox & Munk 1954, a clean
        // sea: mean-square slope 0.00316 U up-wind, 0.003 + 0.00192 U across it): the detail's share as it fades
        // with distance, the waves' own as the grid drops them and the normal flattens. (Lakes: young, smaller waves.)
        vec2 cm = vec2(0.00316 * windU, 0.003 + 0.00192 * windU) * mix(1.0, 0.5, lake);
        float geomLost = max(flatK / 0.85, smoothstep(250.0, 5000.0, dist));
        vec2 s2w = vec2(s2u) + cm * 0.55 * detLost + vec2(geomS2 * 0.5) * geomLost;
        s2w = min(s2w, cm + 0.004) + agit * 0.03; // (blown water: rougher than the wind's own sea)
        float csh = cloudSunShadowAt(vWorld);
        vec3 col;
        float alpha = 1.0;
        if (!gl_FrontFacing) {
            // ── seen from below ──
            N = -N;
            float c = dot(V, N); // cosine to the surface normal (facing the camera)
            // Snell's window: inside ~48.6° of the normal the whole sky comes through, squeezed (refracted out into
            // the air: the sky dome's colours along the bent ray, the sun's disc where it lines up); outside it the
            // surface is a mirror (total internal reflection) of the water below. Fresnel rises to 1 at the rim.
            vec3 Ta = refract(-V, N, 1.333);
            float win = smoothstep(0.645, 0.69, c);
            Optics o = waterOptics(0.0, lake);
            vec3 below = deepWater(deepColor, o) * (0.45 + 0.55 * csh) * 1.4;
            vec3 Tu = dot(Ta, Ta) > 0.0 ? normalize(Ta) : vec3(0.0, 1.0, 0.0);
            float cosT = max(Tu.y, 0.0);
            float Ft = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
            vec3 above = skyAt(Tu) * 1.05 + sunColor * pow(max(dot(Tu, L), 0.0), 900.0) * 8.0 * csh;
            #if TIER >= 2
            if (refrOn > 0.5) {
                // what stands above the water (a hull, a pier, the shore) through the window
                vec2 suv = gl_FragCoord.xy / vec2(textureSize(refrColor, 0));
                vec2 uvA = suv + N.xz * 0.05;
                if (!isSky(texture(refrDepth, uvA).r)) above = mix(above, texture(refrColor, uvA).rgb, 0.8);
            }
            #endif
            // the window's rim: the light grazing in from the horizon, bent and split
            col = mix(below, above * (1.0 - Ft) + below * Ft, win) + horizonColor * 0.25 * exp(-pow((c - 0.66) / 0.025, 2.0));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
        }
        float NdV = max(dot(N, V), 1e-4);
        // wind frame round the normal (for the anisotropic slopes)
        vec3 wd = vec3(windDir.x, 0.0, windDir.y);
        vec3 T1 = normalize(wd - N * dot(wd, N)), T2 = cross(N, T1);
        // Fresnel with the unresolved roughness (rough water reflects less at grazing angles: the facets tilt toward
        // the viewer; Schlick with the correction of the Atlas water talk, GDC 2019)
        vec2 vt = vec2(dot(V, T1), dot(V, T2));
        float vt2 = max(dot(vt, vt), 1e-6);
        float s2v = (s2w.x * vt.x * vt.x + s2w.y * vt.y * vt.y) / vt2;
        float av = sqrt(s2v);
        // (the damping by the rough slopes taken at ~a fifth: the sea's horizon greys with the sky it mirrors, as in photos)
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0 * exp(-2.69 * av)) / (1.0 + 4.0 * pow(av, 1.5));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y); // a ray reflected down into the next wave sees that wave's sky instead
        vec3 Rc = reflect(-V, normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.75)));
        Rc.y = abs(Rc.y);
        vec3 sky = skyRefl(R, Rc, vWorld);
        float planarA = 0.0;
        #if TIER >= 2
        if (planarOn > 0.5) {
            // the low aircraft mirrored (renderPlanar): the camera mirrored in the mean sea sees them through the
            // water point, shifted by the waves' slope (more the further off the reflected thing is)
            float dd = 1.5 + 0.004 * dist;
            vec4 pc = planarVP * vec4(vWorld.x + N.x * dd, 0.0, vWorld.z + N.z * dd, 1.0);
            vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
            if (pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) {
                vec4 pr = texture(planarMap, puv); // (premultiplied: cleared to nothing round them)
                planarA = clamp(pr.a, 0.0, 1.0);
                sky = sky * (1.0 - planarA) + pr.rgb;
            }
        }
        #endif
        // ── sun (moon) glint: an anisotropic Beckmann distribution of the slopes left over, Smith masking ──
        vec3 H = normalize(L + V);
        float hy = max(dot(H, N), 1e-3);
        vec2 hxz = vec2(dot(H, T1), dot(H, T2)) / hy;
        float D = exp(-(hxz.x * hxz.x / s2w.x + hxz.y * hxz.y / s2w.y)) / (3.14159 * sqrt(s2w.x * s2w.y) * hy * hy * hy * hy);
        vec2 lt = vec2(dot(L, T1), dot(L, T2));
        float NdL = dot(N, L);
        float s2l = (s2w.x * lt.x * lt.x + s2w.y * lt.y * lt.y) / max(dot(lt, lt), 1e-6);
        float G = NdL > 0.0 ? 1.0 / (1.0 + smithL(NdV, s2v) + smithL(NdL, s2l)) : 0.0;
        float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
        vec3 glint = sunColor * Fh * D * G * 0.55 / (4.0 * max(NdV, 0.08)) * step(0.0, L.y + 0.02) * csh;
        // ── the water body ──
        float wet = max(vSea.w, 0.0); // water depth under this pixel (m)
        float turb = churn(wet);
        Optics o = waterOptics(turb, lake);
        vec3 deep = deepWater(deepColor, o) * (0.45 + 0.55 * csh);
        vec3 under = deep;
        #if TIER >= 2
        if (refrOn > 0.5) {
            vec2 size = vec2(textureSize(refrColor, 0));
            vec2 suv = gl_FragCoord.xy / size;
            float zS = toScreen(vWorld).z;
            // Refraction: the view bent at the surface (Snell, water's index 1.333) and followed down to the bed, first
            // guessed from the sea map's depth here, then looked up in the copy of the scene (so the bed shifts by its
            // depth, never by more: no smearing at grazing angles). Something in front of the water there (a hull
            // above the waterline): the straight view instead.
            // (bent by a calmer normal than the shading's: the detail's full slope makes the bed shimmer and sparkle)
            vec3 Tr = refract(-V, normalize(mix(normalize(vNormal), N, 0.4)), 0.75);
            float d0 = clamp(wet + 0.5, 0.5, 60.0);
            vec3 sp = toScreen(vWorld + Tr * (d0 / max(-Tr.y, 0.25)));
            vec2 buv = sp.xy;
            ivec2 pix = ivec2(buv * size);
            bool ok = buv.x > 0.0 && buv.y > 0.0 && buv.x < 1.0 && buv.y < 1.0;
            float d1 = ok ? texelFetch(refrDepth, clamp(pix, ivec2(0), ivec2(size) - 1), 0).r : 0.0;
            float zB = isSky(d1) ? 1e6 : linDepth(d1);
            if (!ok || zB < zS + 0.05) {
                buv = suv;
                float dd = texelFetch(refrDepth, ivec2(gl_FragCoord.xy), 0).r;
                zB = isSky(dd) ? 1e6 : linDepth(dd);
            }
            vec3 B = (camWorld * vec4(vec3((buv * 2.0 - 1.0) * invProj * zB, -zB), 1.0)).xyz;
            // (the drawn shore steps a shallow bed 1.5 m down at the waterline, terraincore.js shore(): undone; the
            // step itself, drawn from −1.5 m up to the beach, stands for the waterline)
            if (B.y > -6.0 && B.y < 0.0 && zB < 1e5) B.y = min((B.y + 1.5) / 0.75, 0.0);
            float path = min(length(B - vWorld), 300.0);
            float dBed = clamp(vWorld.y - B.y, 0.0, 300.0);
            wet = dBed;
            turb = churn(wet);
            o = waterOptics(turb, lake);
            deep = deepWater(deepColor, o) * (0.45 + 0.55 * csh);
            vec3 bot = texture(refrColor, buv).rgb;
            // The sea bed's sand: the terrain draws it at ~0.2 albedo; a clear sea's carbonate sand is ~0.4–0.5, which
            // is what makes the shallows of the Bahamas or the Maldives glow turquoise from the air. Brightened where
            // what the refraction found is the bed itself (about as deep as the sea map says: not a hull in deep water)
            float bedK = (1.0 - lake) * smoothstep(0.2, 1.0, dBed) * (1.0 - smoothstep(2.0, 6.0, max(vSea.w, 0.0) - dBed));
            bot *= 1.0 + bedK;
            if (dBed < 40.0 && zB < 1e5) {
                // the sea bed close up: sand ripples across the swell, darker patches (weed, rock) in the shallows
                float fpB = fp + zB * 0.0008;
                vec2 sd = normalize(swellDir);
                vec2 bw = B.xz + 0.8 * vec2(texture(detailMap, B.xz / 9.0).r, texture(detailMap, B.xz / 9.0 + 0.5).r);
                float ph = dot(bw, sd) * 6.2832 / 0.55;
                vec3 Lw = refract(-L, vec3(0.0, 1.0, 0.0), 0.75);
                float rip = cos(ph) * (1.0 - smoothstep(0.03, 0.12, fpB)) * 0.22 + cos(dot(bw, sd) * 6.2832 / 2.3 + 1.7) * (1.0 - smoothstep(0.15, 0.6, fpB)) * 0.12;
                bot *= 1.0 + rip * dot(sd, -Lw.xz) * 2.0 * csh * (1.0 - smoothstep(2.0, 30.0, dBed));
                float pn = texture(detailMap, B.xz / 97.0).r * 0.7 + texture(detailMap, B.xz / 23.0 + 0.3).r * 0.3;
                float weed = smoothstep(0.62, 0.74, pn) * smoothstep(3.0, 8.0, dBed) * (1.0 - lake * 0.5);
                bot = mix(bot, bot * vec3(0.45, 0.55, 0.42), weed * 0.5);
                // caustics: the sun refracted through the ripples focuses on the bed. Where the sun's light reaching B
                // entered the surface, the curvature ∇²h of the detail (oceanfft.js) bends the bundle of rays: the
                // Jacobian of the map from the surface to a bed dBed below is 1 + dBed (1 − 1/n) ∇²h, the light on the
                // bed its inverse. Blurred with depth (the sun's disc is half a degree wide) and by the pixel's size.
                vec2 S = B.xz - Lw.xz * (dBed / max(-Lw.y, 0.3));
                float lod = log2(max(max(fpB, dBed * 0.012), 0.05) * fftInfo.x * float(textureSize(fftMap, 0).x)) + 1.5;
                float lap = textureLod(fftMap, S * fftInfo.x, lod).w * fftInfo.z;
                float J = 1.0 + dBed * 0.25 * lap * CAUSTIC_K;
                // bright where the bundle of rays folds over (|J| → 0: the network of caustic lines), a little darker
                // between; past a few metres the folds overlap and the sun's disc blurs them out
                // (the folds' sharpness limited by the pixel: a sharp line thinner than a pixel only sparkles)
                float jMin = 0.35 + 6.0 * fpB;
                float cau = min(1.0 / max(abs(J), jMin), 4.0) - 1.0 - 0.3 / (1.0 + 8.0 * fpB);
                // (too small to see from far off: the bed's average light is unchanged)
                cau *= csh * smoothstep(0.02, 0.25, L.y) * (1.0 - smoothstep(0.4, 1.0, turb)) * (1.0 - smoothstep(4.0, 16.0, dBed))
                    * (1.0 - lake * 0.5) * (1.0 - smoothstep(0.015, 0.09, fpB));
                bot *= max(1.0 + cau * 0.4, 0.45);
            }
            // Beer-Lambert both ways: daylight down to the bed (Kd over its depth), the view back up (c over the path);
            // what the water itself scatters fills in toward the deep colour
            float cosw = clamp(dBed / max(path, 1e-3), 0.0, 1.0);
            vec3 Tb = exp(-(o.c + o.kd * cosw) * path);
            under = mix(deep, bot, Tb);
        }
        #else
        // low / medium (no copy of the scene): the bed is estimated, a sandy bottom at the sea map's depth lit by the
        // daylight that gets down to it and seen back up through the water (the same Beer-Lambert both ways), so the
        // shallows go turquoise over sand; the drawn bed shows a little through the blend (alpha below)
        {
            float pathL = max(vSea.w, 0.0) * (0.6 + 0.4 / max(V.y, 0.2));
            vec3 Tl = exp(-(o.c + o.kd * 0.7) * pathL);
            vec3 Ein = sunColor * (max(L.y, 0.0) * 0.9 * csh + 0.05) + mix(horizonColor, skyColor, 0.5) * 0.55;
            under = mix(deep, vec3(0.33, 0.29, 0.19) * Ein, Tl * (1.0 - lake * 0.4) * (1.0 - smoothstep(600.0, 3000.0, dist)));
        }
        #endif
        // subsurface: the sun through a thin crest, seen from its back (the water's own colour, forward scattered)
        float sss = pow(clamp(dot(V, -vec3(L.x, 0.0, L.z) / max(length(L.xz), 1e-3)) * 0.5 + 0.5, 0.0, 1.0), 4.0)
            * clamp(vCrest * 0.35 + 0.15, 0.0, 1.0) * (1.0 - F) * csh * max(L.y + 0.1, 0.0);
        under += mix(vec3(0.05, 0.3, 0.26), vec3(0.1, 0.25, 0.08), lake) * sunColor * sss * 0.35;
        col = under * (1.0 - F) + sky * F + glint;
        // [night] fires, motors, flares and flashes on the water: a glint off the waves (the sun's slope statistics,
        // wider for a near light) and a little light in the water body (firelight.js; its first eight)
        if (fireLightInfo.x > 0.5) {
            int fn = min(int(fireLightInfo.x), 8);
            float rough = 0.5 * (s2w.x + s2w.y);
            for (int fi = 0; fi < 8; fi++) {
                if (fi >= fn) break;
                vec3 fL, fE;
                if (!fireLightW(fi, vWorld, fL, fE)) continue;
                vec3 fH = normalize(fL + V);
                float fNdH = max(dot(N, fH), 1e-3), ft2 = (1.0 - fNdH * fNdH) / (fNdH * fNdH);
                float fs2 = rough + 0.004;
                float fP = exp(-ft2 / fs2) / (3.14159 * fs2 * fNdH * fNdH * fNdH * fNdH);
                float fF = 0.02 + 0.98 * pow(1.0 - max(dot(V, fH), 0.0), 5.0);
                col += fE * (fF * fP * 0.5 / (4.0 * max(NdV, 0.08)) + (1.0 - F) * max(fL.y, 0.0) * 0.012);
            }
        }
        #if TIER < 2
        {
            // a little of the drawn bed through the water where it is shallow and clear (the waterline stays soft);
            // deep water is opaque (its bed is the estimate above: the drawn one far below would only mottle it)
            float pathL = max(vSea.w, 0.0) * (0.6 + 0.4 / max(V.y, 0.2));
            float Tl = exp(-dot(o.c + o.kd, vec3(0.25, 0.45, 0.3)) * pathL);
            alpha = 1.0 - Tl * 0.5 * (1.0 - smoothstep(300.0, 2500.0, dist));
        }
        #endif
        float foamCover = 0.0;
        // ── foam ──
        // (each kind of foam is looked up only where it can show: a calm sea pays for none of it)
        {
            vec2 wv = vec2(dot(p, windDir), dot(p, vec2(-windDir.y, windDir.x))); // along and across the wind
            float near = 1.0 - smoothstep(3000.0, 9000.0, dist);
            // (blown water: a haze of fine bubbles and flecks under the gusts' ripples)
            float foam = 0.0, nw = 0.5, bub = agit * 0.45;
            // the sea's edge (on the beach itself the swash brings its own foam, vFoam.z), a ship's or a flyby's wake
            float shore = (1.0 - smoothstep(0.1, 1.6, wet)) * 0.85 * (0.6 + 0.4 * sin(time * 0.9 + dot(p, vec2(0.05, 0.037)))) * step(0.0, vSea.w);
            float amt = wk.r;
            float gridK = 1.0 - smoothstep(250.0, 650.0, dist);
            float surf = max(vFoam.z, shore);
            if (whitecap > 0.0 || amt > 0.004 || surf > 0.004) {
                float nf = texture(foamMap, p / 23.0 + vec2(time * 0.012, time * 0.008)).r * 0.6 + texture(foamMap, p / 7.1 - vec2(time * 0.02, -time * 0.015)).r * 0.4;
                nw = texture(foamMap, p / 14.0 - windDir * time * 0.03).g * 0.65 + nf * 0.35;
                if (whitecap > 0.0) {
                    // gusts: km-scale patches of rougher, whiter water drifting downwind
                    float gust = texture(detailMap, p / 2600.0 - windDir * time * 0.0035).r;
                    // a crest breaks in patches along its length (not all the way along), whitest where it breaks hardest
                    float patchy = smoothstep(0.32, 0.62, texture(foamMap, p / 47.0 + windDir * time * 0.012).g * 0.7 + texture(foamMap, p / 130.0).g * 0.3);
                    // Whitecaps where the crests fold (the vertex Jacobian, now and a moment ago): a fresh one dense and
                    // billowy (never solid: holes of dark water, ragged edges); the foam it leaves thins into lace drawn
                    // out along the wind as it ages. Beyond the reach of the fine grid, the sea's average whitecap cover
                    // for this wind (Monahan & O'Muircheartaigh 1980: W = 3.8e-6 U^3.4, ~7 % in a gale) as small
                    // wind-streaked flecks, and far off a faint whitening
                    float fresh = smoothstep(0.0, 0.9, vFoam.x) * gridK;
                    float aged = clamp(smoothstep(0.0, 0.7, vFoam.y) - fresh * 0.6, 0.0, 1.0) * gridK;
                    float gk = patchy * (0.8 + 0.4 * gust) * whitecap;
                    float wcF = min(fresh * gk, 0.78);
                    foam = smoothstep(1.0 - wcF, 1.4 - wcF, nw) * near;
                    float wcA = min(aged * gk, 0.85);
                    if (wcA > 0.004) {
                        float lace = texture(foamMap, vec2(wv.y / 6.0, wv.x / 17.0 - time * 0.02)).r * 0.7 + texture(foamMap, vec2(wv.y / 2.3, wv.x / 6.5)).r * 0.3;
                        foam = max(foam, smoothstep(1.0 - wcA * 0.8, 1.15 - wcA * 0.8, lace) * near * 0.85);
                    }
                    float W = clamp(3.8e-6 * pow(windU, 3.4), 0.0, 0.12) * mix(1.0, 0.35, lake) * smoothstep(0.0, 0.15, whitecap);
                    float fk = (1.0 - gridK) * (1.0 - smoothstep(1500.0, 5000.0, dist));
                    if (fk > 0.0) {
                        float fl = texture(foamMap, vec2(wv.y / 11.0, wv.x / 31.0) + windDir * time * 0.006).g * 0.65 + texture(foamMap, vec2(wv.y / 4.1, wv.x / 12.0)).r * 0.35;
                        // (a fleck smaller than the pixel would only sparkle: its average cover instead)
                        float fs = smoothstep(1.0 - W * 2.6, 1.08 - W * 2.6, fl * (0.85 + 0.3 * gust));
                        foam = max(foam, mix(fs, W * 3.5, smoothstep(0.4, 1.5, fp)) * fk * 0.9 * near);
                    }
                    // far off: the average cover, fading into the haze well before the view ends
                    foam = max(foam, W * 2.8 * smoothstep(1500.0, 5000.0, dist) * (1.0 - smoothstep(5000.0, 14000.0, dist)));
                    // spume: in a gale the wind tears foam off the crests and lays it out in long thin streaks along the
                    // wind (the foam texture's streak channel: ~30 m along the wind, ~1 m across it), in bands
                    float sk = whitecap * whitecap * (1.0 - smoothstep(600.0, 2500.0, dist));
                    if (sk > 0.05) {
                        float sl = texture(foamMap, vec2(wv.x / 120.0 - time * 0.004, wv.y / 64.0)).b * 0.7 + texture(foamMap, vec2(wv.x / 47.0, wv.y / 23.0)).b * 0.3;
                        float band = smoothstep(0.35, 0.65, texture(foamMap, vec2(wv.x / 900.0, wv.y / 160.0)).g + gust * 0.3);
                        amt = max(amt, sk * smoothstep(0.6, 0.72, sl) * band * 0.8);
                    }
                    bub = (fresh + aged * 0.6) * gk;
                }
                amt = clamp(amt, 0.0, 1.0);
                foam = max(foam, smoothstep(1.0 - amt, 1.25 - amt, nf) * near);
                // the surf: a breaker's white water, the swash's leading edge, the sea's edge: churned (billows, not lace)
                float sA = min(surf, 0.82);
                if (sA > 0.004) {
                    float ns = texture(foamMap, p / 14.0 - windDir * time * 0.03).g * 0.6 + texture(foamMap, p / 4.7 + vec2(time * 0.05, -time * 0.03)).g * 0.4;
                    foam = max(foam, smoothstep(1.0 - sA, 1.45 - sA, ns) * near);
                }
                amt = max(amt, surf);
                bub = max(bub, amt); // the bubbles under the foam
            }
            // foam is a rough white diffuser: lit through the wave's own slope (so a breaking face shows its shape)
            vec3 light = sunColor * (max(L.y, 0.0) * 0.9 * csh + 0.05) + mix(horizonColor, skyColor, 0.5) * 0.55;
            vec3 flight = sunColor * (max(dot(N, L), 0.0) * 0.9 * csh * step(0.0, L.y) + 0.05) + mix(horizonColor, skyColor, 0.5) * 0.8;
            col = mix(col, vec3(0.9, 0.93, 0.95) * flight * (0.82 + 0.3 * nw), foam * 0.93);
            // under foam and in a wake: a milky turquoise of bubbles just under the surface; shade by a hull
            col = mix(col, vec3(0.35, 0.62, 0.66) * light, max(wk.g, bub * 0.35) * (1.0 - foam) * 0.6);
            col *= 1.0 - wk.b * 0.55;
            foamCover = max(foam, wk.g * 0.5);
            #if TIER < 2
            alpha = max(alpha, foam);
            #endif
        }
        vec3 ray = vWorld - cameraPosition;
        vec2 fg = skyFogAmount(ray, cameraPosition);
        col = mix(col, skyFogColor(fogColor, ray, fg.y), fg.x);
        #if TIER < 2
        alpha = mix(alpha, 1.0, fg.x);
        #else
        // the reflection weight for postfx's screen-space reflections (and < 0.7 marks water): foam doesn't mirror
        // (and where the planar pass mirrored an aircraft: it knows its underside, the screen doesn't)
        alpha = 0.1 + 0.5 * clamp(F * (1.0 - foamCover) * (1.0 - fg.x) * (1.0 - planarA), 0.0, 1.0);
        #endif
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;
}

export class Ocean {
    constructor(scene, renderer, { detailTex, foamTex, SKY_FOG, FOG_GLSL, CLOUD_SHADOW_GLSL, skyUniforms = null }) {
        this.scene = scene;
        this.renderer = renderer;
        this.quality = null;
        this.T = TIERS.high;
        const empty = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
        empty.needsUpdate = true;
        this.mapTex = [0, 1].map(() => {
            const t = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
            t.minFilter = t.magFilter = THREE.NearestFilter;
            t.needsUpdate = true;
            return t;
        });
        this.blackTex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
        this.blackTex.needsUpdate = true;
        this.uniforms = {
            // the palette world.js sets (same names as the old water)
            time: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
            skyColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() }, deepColor: { value: new THREE.Color() },
            fogColor: { value: new THREE.Color() }, detailMap: { value: detailTex }, foamMap: { value: foamTex },
            ...SKY_FOG.uniforms(), // (the haze, the mist, and the ground fog and front: world.js FOG_GLSL)
            whitecap: { value: 0 }, foamJ: { value: 0.7 }, windU: { value: 5 }, underwater: { value: 0 }, windDir: { value: new THREE.Vector2(1, 0) },
            shoreInfo: { value: new THREE.Vector4() },
            geomS2: { value: 0.01 }, swellDir: { value: new THREE.Vector2(1, 0) }, // the waves' own mean-square slope; the swell's heading
            // the sky dome's palette (world.js skyMat; its uniform objects are shared when given, so always current)
            skyGlow: { value: new THREE.Color(0, 0, 0) }, skyBelt: { value: new THREE.Color(0, 0, 0) }, skyGlowDir: { value: new THREE.Vector3(0, 1, 0) },
            skySun: { value: new THREE.Color(1, 1, 1) }, skyLowSun: { value: 0 }, skyOvercast: { value: 0 }, skyNight: { value: 0 },
            // the wave field (water.js)
            waveA: { value: WATER.gpuA }, waveB: { value: WATER.gpuB }, waveN: { value: 0 }, waveOrigin: { value: new THREE.Vector2() },
            waveLod: { value: new THREE.Vector2(8, 12) }, setDepth: { value: new THREE.Vector3(...SET_DEPTH) },
            seaMapFine: { value: this.mapTex[0] }, seaMapCoarse: { value: this.mapTex[1] },
            seaFineInfo: { value: new THREE.Vector4() }, seaCoarseInfo: { value: new THREE.Vector4() },
            // the grid
            gridN: { value: 32 }, lodR0: { value: 48 },
            // refraction, detail, wakes
            fftMap: { value: empty }, fftInfo: { value: new THREE.Vector4(1 / FFT_L, 1 / (FFT_L * 2.7), 1, 2500) },
            refrColor: { value: this.blackTex }, refrDepth: { value: empty }, refrOn: { value: 0 },
            camNear: { value: 1 }, camFar: { value: 1000 }, invProj: { value: new THREE.Vector2(1, 1) }, camWorld: { value: new THREE.Matrix4() },
            wakeMap: { value: this.blackTex }, wakeInfo: { value: new THREE.Vector4(0, 0, 1, 0) },
            heaveA: { value: Array.from({ length: HEAVES }, () => new THREE.Vector4()) }, heaveB: { value: Array.from({ length: HEAVES }, () => new THREE.Vector4(1, 1, 0, 0)) }, heaveN: { value: 0 },
            planarMap: { value: this.blackTex }, planarVP: { value: new THREE.Matrix4() }, planarOn: { value: 0 },
            ...fireUniforms(), // [night]
        };
        if (skyUniforms) {
            const u = this.uniforms, k = skyUniforms;
            if (k.glowColor) u.skyGlow = k.glowColor; if (k.beltColor) u.skyBelt = k.beltColor; if (k.sunDir) u.skyGlowDir = k.sunDir;
            if (k.sunColor) u.skySun = k.sunColor; if (k.lowSun) u.skyLowSun = k.lowSun; if (k.overcast) u.skyOvercast = k.overcast;
            if (k.night) u.skyNight = k.night;
        }
        this.FOG_GLSL = FOG_GLSL; this.CLOUD_SHADOW_GLSL = CLOUD_SHADOW_GLSL;
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms, vertexShader: VERT, fragmentShader: fragShader(FOG_GLSL, CLOUD_SHADOW_GLSL),
            defines: { TIER: 2 }, side: THREE.DoubleSide, fog: false, transparent: false, depthWrite: true,
        });
        this.maxPatches = 900;
        this.patchAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPatches * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.mesh = new THREE.Mesh(patchGeometry(32), this.material);
        this.mesh.geometry.setAttribute('iPatch', this.patchAttr);
        this.mesh.geometry.instanceCount = 0;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.matrixWorldAutoUpdate = false;
        this.mesh.name = 'ocean';
        this.mesh.onBeforeRender = (r, s, cam) => this.beforeRender(r, cam);
        scene.add(this.mesh);
        this.refrRT = null;
        this.fft = null;
        this.frame = 0;
        // sea-state maps: a worker builds them (the main thread only when there's no worker)
        this.maps = [{ cx: 1e9, cz: 1e9, pending: false }, { cx: 1e9, cz: 1e9, pending: false, wind: '' }];
        this.coarse = null;     // the last coarse map (for fine builds here)
        this.job = null;        // main-thread fallback job
        this.initWorker();
        this.setQuality('high');
        this.shipFX = null;     // shipfx.js registers its wake map here (see setWakeMap)
        this.heaveMax = 0;      // the highest heave now (splash.js, setHeaves): the patches' boxes allow for it
        // the planar reflection pass (renderPlanar): its target, the mirrored camera, the objects it draws
        this.planar = { rt: null, cam: new THREE.PerspectiveCamera(), reflectors: [], on: new Set(), lightsAt: -1e9, frame: 0 };
        this.planar.cam.layers.set(PLANAR_LAYER);
    }

    initWorker() {
        this.worker = null;
        if (typeof Worker === 'undefined' || typeof window === 'undefined') return;
        try {
            const w = new Worker(new URL('./waterworker.js', import.meta.url), { type: 'module' });
            w.onmessage = (e) => this.onMap(e.data);
            w.onerror = (e) => { console.warn('sea-state worker failed, building maps on the main thread', e.message || e); this.worker = null; };
            this.worker = w;
        } catch (e) { this.worker = null; }
    }

    onMap({ type, map, cx, cz }) {
        const level = type === 'fine' ? 0 : 1;
        const m = this.maps[level];
        m.pending = false;
        if (!map) return;
        if (level === 1) this.coarse = map;
        this.applyMap(level, map);
        void cx; void cz;
    }

    applyMap(level, map) {
        setSeaMap(level, map);
        const t = this.mapTex[level];
        if (t.image.width !== map.size) {
            t.dispose();
            const nt = new THREE.DataTexture(map.data, map.size, map.size, THREE.RGBAFormat, THREE.FloatType);
            nt.minFilter = nt.magFilter = THREE.NearestFilter;
            nt.needsUpdate = true;
            this.mapTex[level] = nt;
            this.uniforms[level ? 'seaMapCoarse' : 'seaMapFine'].value = nt;
        } else {
            t.image.data = map.data;
            t.needsUpdate = true;
        }
        this.uniforms[level ? 'seaCoarseInfo' : 'seaFineInfo'].value.set(map.x0, map.z0, map.texel, map.size);
    }

    // Build both maps around (x, z) right now (at the start of a sortie: nothing may float on lake water that
    // still thinks it's the open sea)
    prime(x, z) {
        // (already built right here, for this wind: the boot primes twice at the home base)
        const M1 = this.maps[1], M0 = this.maps[0];
        if (this.coarse && !M1.pending && !M0.pending && M1.cx === x && M1.cz === z && M0.cx === x && M0.cz === z
            && M1.wind === WATER.windX.toFixed(3) + WATER.windZ.toFixed(3)) return;
        const c = runJob(coarseJob(x, z, WATER.windX, WATER.windZ));
        this.coarse = c;
        this.applyMap(1, c);
        this.maps[1].cx = x; this.maps[1].cz = z; this.maps[1].wind = WATER.windX.toFixed(3) + WATER.windZ.toFixed(3);
        const f = runJob(fineJob(x, z, c));
        this.applyMap(0, f);
        this.maps[0].cx = x; this.maps[0].cz = z;
        if (this.worker) this.worker.postMessage({ type: 'coarse', id: 0, cx: x, cz: z, wx: WATER.windX, wz: WATER.windZ });
        this.maps[1].pending = !!this.worker;
    }

    // keep the maps around the camera (coarse within 3 km of its centre, fine within 300 m while low)
    updateMaps(cam) {
        const C = this.maps[1], Fm = this.maps[0];
        const windKey = WATER.windX.toFixed(3) + WATER.windZ.toFixed(3);
        const needC = Math.hypot(cam.x - C.cx, cam.z - C.cz) > 3000 || C.wind !== windKey;
        if (needC && !C.pending) {
            C.cx = cam.x; C.cz = cam.z; C.wind = windKey; C.pending = true;
            if (this.worker) this.worker.postMessage({ type: 'coarse', id: 1, cx: cam.x, cz: cam.z, wx: WATER.windX, wz: WATER.windZ });
            else this.job = { level: 1, it: coarseJob(cam.x, cam.z, WATER.windX, WATER.windZ) };
        }
        const low = cam.y < 2500;
        const needF = low && Math.hypot(cam.x - Fm.cx, cam.z - Fm.cz) > 300 && this.coarse;
        if (needF && !Fm.pending && !C.pending) {
            Fm.cx = cam.x; Fm.cz = cam.z; Fm.pending = true;
            if (this.worker) this.worker.postMessage({ type: 'fine', id: 2, cx: cam.x, cz: cam.z });
            else if (!this.job) this.job = { level: 0, it: fineJob(cam.x, cam.z, this.coarse) };
        }
        // main-thread fallback: ~2 ms a frame
        if (this.job) {
            const end = performance.now() + 2;
            let r;
            do { r = this.job.it.next(); } while (!r.done && performance.now() < end);
            if (r.done) { const j = this.job; this.job = null; this.onMap({ type: j.level ? 'coarse' : 'fine', map: r.value }); }
        }
    }

    setQuality(q) {
        if (!TIERS[q]) q = 'high';
        if (this.quality === q) return;
        this.quality = q;
        const T = this.T = TIERS[q];
        const m = this.material;
        m.defines.TIER = T.tier;
        m.needsUpdate = true;
        // low / medium blend over the sea bed like the old water (in the opaque queue, so custom blending)
        if (T.tier < 2) {
            m.blending = THREE.CustomBlending;
            m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
            m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
        } else m.blending = THREE.NoBlending;
        if (this.mesh.geometry.userData.g !== T.g) {
            const old = this.mesh.geometry;
            const geo = patchGeometry(T.g);
            geo.userData.g = T.g;
            geo.setAttribute('iPatch', this.patchAttr);
            geo.instanceCount = 0;
            this.mesh.geometry = geo;
            old.dispose();
        }
        this.uniforms.gridN.value = T.g;
        this.uniforms.lodR0.value = T.P0 * T.ratio;
        this.uniforms.waveLod.value.set(T.lod[0], T.lod[1]);
        if (T.fft && !this.fft) {
            try {
                this.fft = new OceanFFT(this.renderer, T.fft, FFT_L);
                this.fftSpectrum();
            } catch (e) { console.warn('ocean FFT unavailable', e); this.fft = null; }
        }
        this.uniforms.fftMap.value = T.fft && this.fft ? this.fft.texture : this.uniforms.refrDepth.value;
        if (T.tier < 2 && this.refrRT) { this.refrRT.dispose(); this.refrRT = null; }
        this.uniforms.refrOn.value = 0;
    }

    fftSpectrum() {
        if (!this.fft) return;
        // the detail's RMS slope: roughly the part of Cox & Munk's (σ² ≈ 0.003 + 0.005 U) the Gerstner waves don't carry
        const U = WATER.U, slope = Math.sqrt(0.6 * (0.003 + 0.00512 * U));
        this.fft.setSpectrum(Math.max(U, 3), WATER.windX, WATER.windZ, 10, slope);
        this.uniforms.fftInfo.value.z = 1;
    }

    // weather + wind: rebuild the waves (and the detail spectrum) when either changed
    setSea(weather, wind) {
        const changed = setSeaState(weather, wind ? wind.x : 1, wind ? wind.z : 0);
        if (changed) {
            this.fftSpectrum();
            this.uniforms.whitecap.value = WATER.whitecap;
            this.uniforms.foamJ.value = WATER.foamJ;
            this.uniforms.windU.value = WATER.U;
            this.uniforms.windDir.value.set(WATER.windX, WATER.windZ);
            this.uniforms.shoreInfo.value.set(SHORE.aSwell, SHORE.aWind, SHORE.omega, SHORE.C);
            // the Gerstner waves' mean-square slope (Σ (a k)² / 2 per axis: what the grid shows up close, and what
            // the glint has to spread over once the grid drops them far away), and the swell's heading (sand ripples)
            const Wv = WATER.waves;
            let s2 = 0, sx = 0, sz = 0;
            for (let i = 0; i < Wv.n; i++) {
                s2 += (Wv.a[i] * Wv.k[i]) ** 2 / 2;
                if (Wv.set[i] === 0) { sx += Wv.dx[i] * Wv.a[i]; sz += Wv.dz[i] * Wv.a[i]; }
            }
            this.uniforms.geomS2.value = s2;
            if (Math.hypot(sx, sz) > 1e-6) this.uniforms.swellDir.value.set(sx, sz).normalize();
        }
        this.uniforms.waveN.value = WATER.waves.n;
        return changed;
    }

    // ── per frame ──
    update(dt, camera, time, weather, wind) {
        this.setSea(weather, wind);
        WATER.t = time;
        this.uniforms.time.value = time;
        const cam = camera.position;
        const ox = Math.round(cam.x / 256) * 256, oz = Math.round(cam.z / 256) * 256;
        updateWaveUniforms(ox, oz, time);
        this.uniforms.waveOrigin.value.set(ox, oz);
        this.updateMaps(cam);
        this.select(camera);
        if (this.fft && this.T.fft) {
            this.frame++;
            if (this.frame % (this.T.fftEvery || 1) === 0) this.fft.update(time);
        }
    }

    // CDLOD node selection into the instance buffer (frustum-culled; the boxes allow for the waves' height)
    select(camera) {
        camera.updateMatrixWorld();
        _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        _frustum.setFromProjectionMatrix(_pv, camera.coordinateSystem, camera.reversedDepth);
        const T = this.T, P0 = T.P0, R0 = P0 * T.ratio, cam = camera.position;
        const top = LEVELS - 1, rootSize = P0 * Math.pow(2, top);
        const A = this.patchAttr.array;
        const crest = WATER.maxCrest + 1 + this.heaveMax;
        let n = 0;
        const camY = Math.abs(cam.y);
        const visit = (x0, z0, L) => {
            const size = P0 * Math.pow(2, L);
            _box.min.set(x0, -crest, z0); _box.max.set(x0 + size, crest, z0 + size);
            if (!_frustum.intersectsBox(_box)) return;
            const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - size), dz = Math.max(z0 - cam.z, 0, cam.z - z0 - size);
            const d = Math.sqrt(dx * dx + dz * dz + camY * camY);
            if (L > 0 && d < R0 * Math.pow(2, L - 1)) {
                const h = size / 2;
                visit(x0, z0, L - 1); visit(x0 + h, z0, L - 1); visit(x0, z0 + h, L - 1); visit(x0 + h, z0 + h, L - 1);
                return;
            }
            if (n >= this.maxPatches) return;
            A[n * 4] = x0; A[n * 4 + 1] = z0; A[n * 4 + 2] = size; A[n * 4 + 3] = L;
            n++;
        };
        const rx = Math.floor(cam.x / rootSize), rz = Math.floor(cam.z / rootSize);
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) visit((rx + i) * rootSize, (rz + j) * rootSize, top);
        this.patchAttr.clearUpdateRanges();
        this.patchAttr.addUpdateRange(0, n * 4);
        this.patchAttr.needsUpdate = true;
        this.mesh.geometry.instanceCount = n;
        this.patches = n;
    }

    // Just before the water draws: the opaque scene is in the target. Copy its colour and depth (resolving MSAA)
    // for the refraction, and hand the shader this camera's projection.
    beforeRender(renderer, camera) {
        const u = this.uniforms;
        u.refrOn.value = 0;
        u.planarOn.value = 0;
        if (this.T.tier < 2 || !camera.isPerspectiveCamera) return;
        if (this.T.planar) this.renderPlanar(renderer, camera);
        u.camNear.value = camera.near; u.camFar.value = camera.far;
        const e = camera.projectionMatrix.elements;
        u.invProj.value.set(1 / e[0], 1 / e[5]);
        u.camWorld.value.copy(camera.matrixWorld);
        const target = renderer.getRenderTarget();
        if (!target || !target.depthTexture || target.width < 8) return;
        const w = target.width, h = target.height;
        if (!this.refrRT) {
            this.refrRT = new THREE.WebGLRenderTarget(w, h, {
                type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
                depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType),
            });
            this.refrRT.texture.name = 'Ocean.refraction';
        } else if (this.refrRT.width !== w || this.refrRT.height !== h) this.refrRT.setSize(w, h);
        if (!this.copyTarget(renderer, target)) return;
        u.refrColor.value = this.refrRT.texture;
        u.refrDepth.value = this.refrRT.depthTexture;
        u.refrOn.value = 1;
    }

    // The aircraft near the camera and low over the water (waterwake.js reflectorsNear): what the planar pass draws
    setReflectors(list) { this.planar.reflectors = list || []; }

    // Planar reflection of the low aircraft: the camera mirrored in the mean sea (y = 0) draws just them (and the
    // lights) into a half-res target, cleared to nothing; the water reads it where it mirrors them. Drawn from inside the
    // main render (the ocean's onBeforeRender, after everything opaque), so every matrix is this frame's and the scene
    // needn't be updated again. Nothing below the water is drawn (an aircraft on the water or the deck isn't a
    // reflector), so no clip plane is needed.
    renderPlanar(renderer, camera) {
        const P = this.planar, list = P.reflectors, u = this.uniforms, scene = this.scene;
        const cp = camera.position;
        // what to draw: the reflectors on the layer, the rest off it
        const want = new Set();
        if (cp.y > 0.5 && cp.y < 1500) for (const r of list) if (r && r.visible !== false && r.parent) want.add(r);
        for (const r of P.on) if (!want.has(r)) { r.traverse(o => o.layers.disable(PLANAR_LAYER)); P.on.delete(r); }
        if (!want.size) return;
        for (const r of want) { r.traverse(o => o.layers.enable(PLANAR_LAYER)); P.on.add(r); }
        // the lights too (a few times a second: they come and go with the time of day)
        if (P.frame++ % 90 === 0) for (const o of scene.children) if (o.isLight) o.layers.enable(PLANAR_LAYER);
        const target = renderer.getRenderTarget();
        const W = target ? target.width : renderer.domElement.width, H = target ? target.height : renderer.domElement.height;
        const w = Math.max(8, Math.round(W * this.T.planar)), h = Math.max(8, Math.round(H * this.T.planar));
        if (!P.rt) {
            P.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false });
            P.rt.texture.name = 'Ocean.planar';
        } else if (P.rt.width !== w || P.rt.height !== h) P.rt.setSize(w, h);
        // the mirrored camera: the same lens at the camera's mirror image below the sea, looking at the mirror image of
        // what it looks at (a proper camera, so faces keep their winding; the water projects its points through it)
        const mc = P.cam;
        mc.copy(camera, false);
        mc.layers.set(PLANAR_LAYER);
        camera.getWorldDirection(_v);
        _pt.copy(cp).addScaledVector(_v, 100); _pt.y = -_pt.y;
        _up.set(0, 1, 0).applyQuaternion(camera.quaternion); _up.y = -_up.y;
        mc.position.set(cp.x, -cp.y, cp.z);
        mc.up.copy(_up);
        mc.lookAt(_pt);
        mc.updateMatrixWorld(true);
        mc.updateProjectionMatrix();
        // draw (no shadow maps redrawn, the scene's matrices as they are, no background)
        const sm = renderer.shadowMap, au = sm.autoUpdate, nu = sm.needsUpdate, bg = scene.background, mwa = scene.matrixWorldAutoUpdate;
        const ca = renderer.getClearAlpha();
        renderer.getClearColor(_cc);
        try {
            sm.autoUpdate = false; sm.needsUpdate = false;
            scene.background = null; scene.matrixWorldAutoUpdate = false;
            renderer.setRenderTarget(P.rt);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true, true, false);
            renderer.render(scene, mc);
        } finally {
            renderer.setRenderTarget(target);
            renderer.setClearColor(_cc, ca);
            sm.autoUpdate = au; sm.needsUpdate = nu;
            scene.background = bg; scene.matrixWorldAutoUpdate = mwa;
        }
        u.planarVP.value.multiplyMatrices(mc.projectionMatrix, mc.matrixWorldInverse);
        u.planarMap.value = P.rt.texture;
        u.planarOn.value = 1;
    }

    copyTarget(renderer, target) {
        if (renderer.extensions.has('WEBGL_multisampled_render_to_texture') && target.samples > 0) return false;
        renderer.initRenderTarget(this.refrRT);
        const src = renderer.properties.get(target), dst = renderer.properties.get(this.refrRT);
        const from = target.samples > 0 ? src.__webglMultisampledFramebuffer : src.__webglFramebuffer;
        const to = dst.__webglFramebuffer;
        if (!from || !to || Array.isArray(from) || Array.isArray(to)) return false;
        const gl = renderer.getContext(), st = renderer.state;
        st.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
        st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
        gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        st.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, from); // (three still has the scene's framebuffer bound for drawing)
        return true;
    }

    // splash.js: the surface heaving over recent blasts ({ x, z, born, amp, R, lam, life }, at most HEAVES)
    setHeaves(list, now) {
        const u = this.uniforms, n = Math.min(list ? list.length : 0, HEAVES);
        let mx = 0;
        for (let i = 0; i < n; i++) {
            const h = list[i], t = now - h.born, fade = 1 - smooth01(h.life * 0.6, h.life, t);
            u.heaveA.value[i].set(h.x, h.z, t, h.amp);
            u.heaveB.value[i].set(h.R, h.lam, h.amp * 0.4, fade);
            mx = Math.max(mx, h.amp);
        }
        u.heaveN.value = n;
        this.heaveMax = mx;
    }

    // shipfx.js: a top-down map of wake foam (R), milky wake water (G) and hull shade (B) over a square
    setWakeMap(tex, x0, z0, size) {
        const u = this.uniforms;
        if (!tex) { u.wakeInfo.value.w = 0; u.wakeMap.value = this.blackTex; return; }
        u.wakeMap.value = tex;
        u.wakeInfo.value.set(x0, z0, 1 / size, 1);
    }

    get tier() { return this.T.tier; }

    // another material that includes WAVE_GLSL (postfx.js's underwater composite): point its uniforms at the
    // current wave field (the typed arrays are shared; textures and vectors are replaced when the maps change)
    shareWaveUniforms(dst) {
        for (const k of WAVE_UNIFORMS) if (dst[k]) dst[k].value = this.uniforms[k].value;
    }

    // the water round an underwater camera (postfx.js composite), from the same optics as the surface: the light it
    // scatters (the deep colour), the beam attenuation c (the view), the diffuse attenuation Kd (daylight going down),
    // the sun in it and how much of it the water scatters toward the camera
    underwaterPalette(dst, x, z) {
        const u = this.uniforms, f = seaFactors(x || 0, z || 0, _sf), lake = f[1] < 0 ? 1 : 0;
        const wc = WATER.whitecap, turb = Math.min(1, (1 - smooth01(0.6, 4.5, f[3])) * (0.3 + 0.7 * wc) + wc * 0.35 * (1 - smooth01(6, 40, f[3])) + wc * wc * 0.25);
        const d = u.deepColor.value, sum = d.r + d.g + d.b;
        const opt = (k, i) => { const O = OPTICS; return (O.ocean[k][i] + (O.coast[k][i] - O.ocean[k][i]) * turb) * (1 - lake) + O.lake[k][i] * lake; };
        const alb = [0, 1, 2].map(i => opt('bb', i) / (opt('a', i) + opt('bb', i)));
        const albRef = [0, 1, 2].reduce((s, i) => s + OPTICS.ocean.bb[i] / (OPTICS.ocean.a[i] + OPTICS.ocean.bb[i]), 0);
        // (near the surface the light all round is a few times what deep water sends back up out of it)
        dst.underColor.value.setRGB(alb[0], alb[1], alb[2]).multiplyScalar(sum * DEEP_K / albRef * 3);
        dst.underExt.value.set(...[0, 1, 2].map(i => opt('a', i) + opt('b', i)));
        if (dst.underKd) dst.underKd.value.set(...[0, 1, 2].map(i => (opt('a', i) + opt('bb', i)) / 0.8));
        if (dst.underSun) dst.underSun.value.copy(u.sunColor.value);
        if (dst.sunDirU) dst.sunDirU.value.copy(u.sunDir.value);
        if (dst.underScat) dst.underScat.value = (opt('b', 0) + opt('b', 1) + opt('b', 2)) / 3 + 0.02;
    }

    dispose() {
        if (this.worker) this.worker.terminate();
        if (this.refrRT) this.refrRT.dispose();
        if (this.planar.rt) this.planar.rt.dispose();
        if (this.fft) this.fft.dispose();
        this.material.dispose(); this.mesh.geometry.dispose();
        this.scene.remove(this.mesh);
    }
}
