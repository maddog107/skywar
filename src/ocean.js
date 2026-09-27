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
//   From below (the camera under the surface): Snell's window onto the sky and total internal reflection.
// The grid is in the opaque queue at renderOrder 1: after every opaque object, before every transparent one.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { WATER, WAVE_GLSL, SET_DEPTH, SHORE, setSeaState, updateWaveUniforms, setSeaMap, seaFactors } from './water.js';
import { coarseJob, fineJob, runJob } from './watermap.js';
import { OceanFFT } from './oceanfft.js';

// per quality: patch grid g, finest patch size P0 (m), LOD range ratio, wave fade (in wavelengths), FFT, refraction
const TIERS = {
    low: { tier: 0, g: 8, P0: 64, ratio: 3, lod: [2.5, 3.5], fft: 0 },
    medium: { tier: 1, g: 16, P0: 16, ratio: 3, lod: [4, 6], fft: 0 },
    high: { tier: 2, g: 32, P0: 16, ratio: 3, lod: [8, 12], fft: 256, fftEvery: 2 },
    ultra: { tier: 3, g: 32, P0: 8, ratio: 3, lod: [9, 13], fft: 256, fftEvery: 1 },
};
const LEVELS = 15;       // quadtree depth: the root nodes are P0 · 2^14 across (1–2 thousand km at P0 64..8: the horizon is inside)
const MORPH_START = 0.7; // morph over the outer 30 % of each level's range
const FFT_L = 32;        // FFT patch size (m)

const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _box = new THREE.Box3(), _v = new THREE.Vector3();
const _col = new THREE.Color(), _lakeTint = new THREE.Color(0.75, 1.15, 0.85);
// the uniforms of WAVE_GLSL (see shareWaveUniforms)
const WAVE_UNIFORMS = ['waveA', 'waveB', 'waveN', 'waveOrigin', 'waveLod', 'setDepth', 'seaMapFine', 'seaMapCoarse', 'seaFineInfo', 'seaCoarseInfo', 'shoreInfo', 'time'];
const _sf = [0, 0, 0, 0];
const seaFactorsAt = (x, z) => seaFactors(x || 0, z || 0, _sf)[0];

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
    varying vec3 vWorld;
    varying vec2 vRest;
    varying vec3 vNormal;
    varying vec4 vSea;
    varying vec3 vFoam;   // whitecap now, a moment ago; surf (a breaking shore wave)
    varying float vCrest;
    ${WAVE_GLSL}
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
        vec3 Tx, Tz; float jac; vec2 jp;
        vec3 disp = waveField(p, d, setGains(sea), Tx, Tz, jac, jp);
        // surf: the swell shoaling and breaking on a beach (height only)
        vec2 sg; float br, crest;
        float hs = shoreWave(p, sea, sg, br, crest);
        disp.y += hs; Tx.y += sg.x; Tz.y += sg.y;
        vec3 world = vec3(p.x + disp.x, disp.y, p.y + disp.z);
        vWorld = world; vRest = p; vNormal = normalize(cross(Tz, Tx)); vSea = sea; vCrest = disp.y;
        // whitecaps where crests fold (and the foam they leave), surf on the breaker's face and in its wake
        float wc = smoothstep(foamJ, foamJ - 0.14, jac);
        float wp = max(smoothstep(foamJ, foamJ - 0.14, jp.x) * 0.75, smoothstep(foamJ, foamJ - 0.14, jp.y) * 0.45);
        vFoam = vec3(wc, wp, br * (smoothstep(0.55, 0.95, crest) + 0.35 * smoothstep(0.2, 0.9, 1.0 - crest)));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }`;

function fragShader(FOG_GLSL, CLOUD_SHADOW_GLSL) {
    return /* glsl */`
    uniform float time, whitecap, windU, underwater;
    uniform vec3 sunDir, sunColor, skyColor, horizonColor, deepColor, fogColor;
    uniform sampler2D detailMap, foamMap;
    #if TIER >= 2
    uniform sampler2D fftMap, refrColor, refrDepth;
    uniform vec4 fftInfo;       // 1/L, 1/L2, slope gain, detail fade distance
    uniform float refrOn, camNear, camFar;
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
    #endif
    vec3 skyAt(vec3 R) {
        float up = clamp(R.y, 0.0, 1.0);
        vec3 c = mix(horizonColor, skyColor, pow(up, 0.5));
        float sd = max(dot(R, normalize(sunDir)), 0.0);
        return c + sunColor * pow(sd, 8.0) * 0.12;
    }
    void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 L = normalize(sunDir);
        vec2 p = vWorld.xz;
        float fp = dist * 0.0015 / max(abs(V.y), 0.06); // metres of water under a pixel (grazing angles stretch it)
        vec3 N = normalize(vNormal);
        float rough = 0.0015 + 0.00002 * dist;          // slope variance the geometry can't show at this distance
        float lake = 1.0 - smoothstep(0.08, 0.5, vSea.x); // closed water: greener, murkier, calmer
        // ── small-scale detail ──
        #if TIER >= 2
        {
            vec2 u1 = vRest * fftInfo.x, u2 = mat2(0.8, -0.6, 0.6, 0.8) * vRest * fftInfo.y;
            vec4 f1 = texture(fftMap, u1), f2 = texture(fftMap, u2);
            float det = fftInfo.z * (1.0 - smoothstep(fftInfo.w * 0.5, fftInfo.w, dist)) * mix(1.0, 0.6, lake);
            vec2 s2 = mat2(0.8, 0.6, -0.6, 0.8) * f2.xy;
            vec2 slope = (f1.xy + 0.55 * s2) * det;
            N = normalize(N - vec3(slope.x, 0.0, slope.y) * N.y);
            // what the mips averaged away (and what fades out with distance) becomes roughness for the glint
            float unres = max(f1.z - dot(f1.xy, f1.xy), 0.0) + 0.3 * max(f2.z - dot(f2.xy, f2.xy), 0.0);
            rough += unres * fftInfo.z * fftInfo.z + (1.0 - det / max(fftInfo.z, 1e-3)) * 0.012 * (0.3 + windU / 12.0);
        }
        #else
        {
            vec3 n2 = vec3(0.0, 1.0, 0.0);
            float r1 = texture2D(detailMap, p / 140.0 + vec2(time * 0.010, time * 0.006)).r;
            float r2 = texture2D(detailMap, p / 53.0 - vec2(time * 0.014, -time * 0.009)).r;
            float r3 = mix(0.5, texture2D(detailMap, p / 17.0 + vec2(-time * 0.02, time * 0.017)).r, 1.0 - smoothstep(0.6, 3.0, fp));
            vec2 rip = (vec2(r1 - r3, r2 - r3)) * 0.3 * mix(0.1, 1.0, 1.0 - smoothstep(60.0, 900.0, dist));
            N = normalize(N - vec3(rip.x, 0.0, rip.y));
            rough += 0.01 * smoothstep(200.0, 5000.0, dist);
        }
        #endif
        // far away the water flattens to its mean (only the glint's width remembers the waves)
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(1500.0, 14000.0, dist) * 0.85));
        float csh = cloudSunShadowAt(vWorld);
        vec3 col;
        float alpha = 1.0;
        if (!gl_FrontFacing) {
            // ── seen from below ──
            N = -N;
            float c = dot(V, N); // cosine to the surface normal (facing the camera)
            // Snell's window: inside ~48.6° of the normal the sky comes through (refracted); outside it the surface
            // is a mirror of the water below
            float win = smoothstep(0.62, 0.7, c);
            vec3 below = deepColor * (0.25 + 0.5 * csh);
            vec3 above = mix(horizonColor, skyColor, 0.6) * 1.1 + sunColor * pow(max(dot(-V, L), 0.0), 60.0) * 2.0 * csh;
            #if TIER >= 2
            if (refrOn > 0.5) {
                vec2 suv = gl_FragCoord.xy / vec2(textureSize(refrColor, 0));
                above = mix(above, texture(refrColor, suv + N.xz * 0.05).rgb, 0.7);
            }
            #endif
            col = mix(below, above, win);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
        }
        float NdV = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y); // a ray reflected down into the next wave sees that wave's sky instead
        vec3 sky = skyAt(R);
        // sun glint: the Cox-Munk slope distribution, as wide as the roughness left over
        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 1e-3), t2 = (1.0 - NdH * NdH) / (NdH * NdH);
        float s2 = rough;
        float Pslope = exp(-t2 / s2) / (3.14159 * s2 * NdH * NdH * NdH * NdH);
        float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
        vec3 glint = sunColor * Fh * Pslope * 0.55 / (4.0 * max(NdV, 0.08)) * step(0.0, L.y + 0.02) * csh;
        // ── the water body ──
        vec3 body = mix(deepColor, deepColor * vec3(0.75, 1.15, 0.85), lake) * (0.45 + 0.55 * csh);
        vec3 ext = mix(vec3(0.46, 0.105, 0.085), vec3(0.62, 0.3, 0.42), lake); // extinction per metre (sea, lake)
        float wet = 1.0;        // water depth under this pixel (m), for the surf
        vec3 under = body;
        #if TIER >= 2
        if (refrOn > 0.5) {
            vec2 size = vec2(textureSize(refrColor, 0));
            vec2 suv = gl_FragCoord.xy / size;
            vec3 fwd = -vec3(camWorld[2][0], camWorld[2][1], camWorld[2][2]);
            float zS = dot(vWorld - cameraPosition, fwd);
            // refraction: bend the view by the slope, more for thicker water, less far away
            vec2 off = (N.xz - vec2(0.0)) * 0.035 / (1.0 + zS * 0.004);
            ivec2 pix = ivec2((suv + off) * size);
            float d0 = texelFetch(refrDepth, clamp(pix, ivec2(0), ivec2(size) - 1), 0).r;
            float zB = isSky(d0) ? 1e6 : linDepth(d0);
            if (zB < zS) { off = vec2(0.0); pix = ivec2(gl_FragCoord.xy); d0 = texelFetch(refrDepth, pix, 0).r; zB = isSky(d0) ? 1e6 : linDepth(d0); }
            vec2 buv = suv + off;
            vec3 bottomV = vec3((buv * 2.0 - 1.0) * invProj * zB, -zB);
            vec3 bottomW = (camWorld * vec4(bottomV, 1.0)).xyz;
            float path = min(length(bottomW - vWorld), 400.0);
            wet = vWorld.y - bottomW.y;
            vec3 T = exp(-ext * path);
            vec3 bot = texture(refrColor, buv).rgb;
            // caustics: light focused by the waves dances on the bottom in the shallows
            float cau = texture(detailMap, bottomW.xz / 9.0 + vec2(time * 0.03, time * 0.021)).r * texture(detailMap, bottomW.xz / 6.3 - vec2(time * 0.025, -time * 0.018)).r;
            bot *= 1.0 + smoothstep(0.18, 0.45, cau) * 1.2 * exp(-max(wet, 0.0) * 0.35) * csh * max(L.y, 0.0) * (1.0 - lake * 0.6);
            under = mix(body, bot, T);
        }
        #else
        wet = vSea.w;
        #endif
        // subsurface: the sun through a thin crest, seen from its back
        float sss = pow(clamp(dot(V, -vec3(L.x, 0.0, L.z) / max(length(L.xz), 1e-3)) * 0.5 + 0.5, 0.0, 1.0), 4.0)
            * clamp(vCrest * 0.35 + 0.15, 0.0, 1.0) * (1.0 - F) * csh * max(L.y + 0.1, 0.0);
        under += vec3(0.05, 0.3, 0.26) * sunColor * sss * 0.35;
        col = mix(under, sky, F) + glint;
        #if TIER < 2
        alpha = mix(0.72, 0.97, clamp(F * 2.0 + smoothstep(200.0, 3000.0, dist), 0.0, 1.0));
        #endif
        // ── foam ──
        {
            // gusts: km-scale patches of rougher, whiter water drifting downwind
            float gust = texture(detailMap, p / 2600.0 - windDir * time * 0.0035).r;
            // a crest breaks in patches along its length (not all the way along), whitest where it breaks hardest
            float patchy = smoothstep(0.3, 0.6, texture(foamMap, p / 110.0 + windDir * time * 0.012).g);
            float wc = whitecap * smoothstep(0.0, 0.9, max(vFoam.x, vFoam.y)) * patchy * (0.8 + 0.4 * gust);
            // spume streaks along the wind in a gale
            vec2 wv = vec2(dot(p, windDir), dot(p, vec2(-windDir.y, windDir.x)));
            float streak = texture(foamMap, vec2(wv.y / 6.0, wv.x / 70.0 - time * 0.01)).b * texture(foamMap, vec2(wv.y / 23.0, wv.x / 240.0)).g;
            float streaks = whitecap * whitecap * smoothstep(0.3, 0.55, streak * (0.6 + 0.8 * gust)) * 0.65;
            float shore = (1.0 - smoothstep(0.1, 1.6, wet)) * 0.85 * (0.6 + 0.4 * sin(time * 0.9 + dot(p, vec2(0.05, 0.037))));
            vec4 wk = vec4(0.0);
            if (wakeInfo.w > 0.5) {
                vec2 wu = (p - wakeInfo.xy) * wakeInfo.z;
                wu.y = 1.0 - wu.y; // drawn looking straight down with -z up the image (shipfx.js WakeMap)
                if (wu.x > 0.0 && wu.y > 0.0 && wu.x < 1.0 && wu.y < 1.0) wk = texture(wakeMap, wu);
            }
            float nf = texture(foamMap, p / 23.0 + vec2(time * 0.012, time * 0.008)).r * 0.6 + texture(foamMap, p / 7.1 - vec2(time * 0.02, -time * 0.015)).r * 0.4;
            float amt = clamp(max(max(streaks, max(shore, vFoam.z)), wk.r), 0.0, 1.0);
            float near = 1.0 - smoothstep(3000.0, 9000.0, dist);
            float foam = smoothstep(1.0 - amt, 1.25 - amt, nf) * near;
            // whitecaps: billowy (the fbm more than the lace), with holes of dark water, never quite solid
            float nw = texture(foamMap, p / 14.0 - windDir * time * 0.03).g * 0.65 + nf * 0.35;
            float wcA = min(wc, 0.92);
            foam = max(foam, smoothstep(1.0 - wcA, 1.3 - wcA, nw) * near);
            amt = max(amt, wc);
            foam = max(foam, amt * smoothstep(400.0, 3000.0, dist) * 0.6); // far away: the average coverage
            // foam is a rough white diffuser: lit through the wave's own slope (so a breaking face shows its shape)
            vec3 light = sunColor * (max(L.y, 0.0) * 0.9 * csh + 0.05) + mix(horizonColor, skyColor, 0.5) * 0.55;
            vec3 flight = sunColor * (max(dot(N, L), 0.0) * 0.9 * csh * step(0.0, L.y) + 0.05) + mix(horizonColor, skyColor, 0.5) * 0.8;
            col = mix(col, vec3(0.9, 0.93, 0.95) * flight * (0.82 + 0.3 * nw), foam * 0.93);
            // under foam and in a wake: a milky turquoise of bubbles just under the surface; shade by a hull
            col = mix(col, vec3(0.35, 0.62, 0.66) * light, max(wk.g, amt * 0.35) * (1.0 - foam) * 0.6);
            col *= 1.0 - wk.b * 0.55;
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
        // the reflection weight for postfx's screen-space reflections (and < 0.7 marks water)
        alpha = 0.1 + 0.5 * clamp(F * (1.0 - fg.x), 0.0, 1.0);
        #endif
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;
}

export class Ocean {
    constructor(scene, renderer, { detailTex, foamTex, SKY_FOG, FOG_GLSL, CLOUD_SHADOW_GLSL }) {
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
        };
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
        const crest = WATER.maxCrest + 1;
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
        if (this.T.tier < 2 || !camera.isPerspectiveCamera) return;
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

    // the colour of the light in the water around an underwater camera, and how fast the water swallows light
    underwaterPalette(dst, x, z) {
        const u = this.uniforms, lake = 1 - Math.min(1, Math.max(0, (seaFactorsAt(x, z) - 0.08) / 0.42));
        dst.underColor.value.copy(u.deepColor.value).multiplyScalar(0.8).lerp(_col.copy(u.deepColor.value).multiply(_lakeTint), lake);
        dst.underExt.value.set(0.42 + 0.2 * lake, 0.1 + 0.18 * lake, 0.075 + 0.3 * lake);
    }

    dispose() {
        if (this.worker) this.worker.terminate();
        if (this.refrRT) this.refrRT.dispose();
        if (this.fft) this.fft.dispose();
        this.material.dispose(); this.mesh.geometry.dispose();
        this.scene.remove(this.mesh);
    }
}
