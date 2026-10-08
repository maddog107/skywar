// ═══════════════════════════════════════════════════════════════
// SKYWAR — post-processing: MSAA scene pass, ambient occlusion, water reflections (SSR),
// camera motion blur, photo-mode depth of field, sun flare, FXAA and adaptive resolution.
//
// Every depth read here goes through DEPTH_GLSL, which handles the reversed float depth buffer
// (near = 1, far = 0, sky cleared to 0) as well as the standard one.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { terrainHeight, SKY_FOG } from './world.js';
import { WAVE_GLSL, WATER, waterHeight } from './water.js';

// ── Quality presets ──
// pr: pixel ratio with adaptive resolution off (today's values); top/floor: adaptive range
// (top is capped at devicePixelRatio). msaa: scene samples. ssr: 0 off, 1 reduced, 2 full.
// blur: motion-blur taps (0 = off; ultra only, so HIGH keeps today's look and cost). dof: photo-mode taps.
export const QUALITY = {
    low: { pr: 1, top: 1, floor: 0.6, msaa: 0, ao: false, ssr: 0, flare: false, blur: 0, dof: 0 },
    medium: { pr: 1.25, top: 1.25, floor: 0.7, msaa: 0, ao: false, ssr: 0, flare: true, blur: 0, dof: 32 },
    high: { pr: 1.75, top: 2, floor: 0.85, msaa: 0, ao: false, ssr: 1, flare: true, blur: 0, dof: 48 },
    ultra: { pr: 2, top: 2, floor: 1, msaa: 4, ao: true, ssr: 2, flare: true, blur: 8, dof: 64 },
};
const STEPS = [1, 0.875, 0.75, 0.667, 0.6, 0.5]; // adaptive resolution levels, as fractions of `top`

// ── Shared GLSL: depth → linear distance → view position ──
const DEPTH_GLSL = /* glsl */`
    uniform sampler2D tDepth;
    uniform float cameraNear, cameraFar;
    uniform vec2 invProj; // 1 / projectionMatrix[0][0], 1 / projectionMatrix[1][1]
    // where in the pixel the depth was taken: a multisampled depth buffer resolves to sample 0, which
    // isn't the centre (0.4 px off makes a grazing water plane look 0.1 m high at 400 m)
    uniform vec2 depthSampleOffset;
    vec2 pixelUv(ivec2 p, vec2 size) { return (vec2(p) + 0.5 + depthSampleOffset) / size; }
    bool isSky(float d) {
        #ifdef USE_REVERSED_DEPTH_BUFFER
        return d <= 0.0;
        #else
        return d >= 1.0;
        #endif
    }
    // distance along the view axis (positive, metres)
    float linDepth(float d) {
        #ifdef USE_REVERSED_DEPTH_BUFFER
        return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * d + cameraNear);
        #else
        return (cameraNear * cameraFar) / (cameraFar - (cameraFar - cameraNear) * d);
        #endif
    }
    vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * invProj * z, -z); }
`;

const VERT = /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fxMaterial(frag, uniforms, defines = {}) {
    return new THREE.ShaderMaterial({
        uniforms, defines, vertexShader: VERT, fragmentShader: frag,
        depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
}
const depthUniforms = () => ({
    tDepth: { value: null }, cameraNear: { value: 1 }, cameraFar: { value: 1000 }, invProj: { value: new THREE.Vector2(1, 1) },
    depthSampleOffset: { value: new THREE.Vector2() },
});
// sample 0 of the standard 4× pattern (Metal / D3D: 0.375, 0.125 from the top-left, y down) in GL pixels
export const MSAA_SAMPLE0 = { 4: new THREE.Vector2(-0.125, -0.375), 2: new THREE.Vector2(0.25, 0.25) };
function setDepthUniforms(u, camera, depthTexture, samples = 0) {
    u.tDepth.value = depthTexture;
    if (MSAA_SAMPLE0[samples]) u.depthSampleOffset.value.copy(MSAA_SAMPLE0[samples]); else u.depthSampleOffset.value.set(0, 0);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    const e = camera.projectionMatrix.elements;
    u.invProj.value.set(1 / e[0], 1 / e[5]);
}
const halfFloatTarget = (w, h, format = THREE.RGBAFormat, filter = THREE.LinearFilter) => new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format, depthBuffer: false, minFilter: filter, magFilter: filter,
});

// ═════════════ Scene pass ═════════════
// A RenderPass that can draw into its own (multisampled) target. The composite pass then reads
// colour and depth from `output`, so the depth texture survives the rest of the chain (the composer's
// ping-pong buffers get cleared by every later pass, and the cockpit pass clears their depth).
export class ScenePass extends RenderPass {
    constructor(scene, camera) {
        super(scene, camera);
        this.ownTarget = false; // true: render into this.target (set by PostFX when effects need depth)
        this.samples = 0;
        this.target = null;
        this.output = null;
        this._size = new THREE.Vector2(1, 1);
    }

    setSize(w, h) {
        this._size.set(w, h);
        if (this.target) this.target.setSize(w, h);
    }

    ensureTarget() {
        const { x: w, y: h } = this._size;
        if (this.target && this.target.samples !== this.samples) { this.target.dispose(); this.target = null; }
        if (!this.target) {
            this.target = new THREE.WebGLRenderTarget(w, h, {
                type: THREE.HalfFloatType, samples: this.samples,
                depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType),
            });
            this.target.texture.name = 'PostFX.scene';
        }
        return this.target;
    }

    render(renderer, writeBuffer, readBuffer, dt, mask) {
        const target = this.ownTarget ? this.ensureTarget() : readBuffer;
        super.render(renderer, writeBuffer, target, dt, mask);
        this.output = target;
    }

    // free the (possibly multisampled) target when the quality level never needs it
    releaseTarget() { if (this.target) { this.target.dispose(); this.target = null; } }

    dispose() { this.releaseTarget(); }
}

// ═════════════ AO and contact shadows (half resolution) ═════════════
// Ground-truth ambient occlusion (GTAO: Jimenez, Wu, Pesce, Jarabo, "Practical Realtime Strategies for Accurate
// Indirect Occlusion", 2016) on depth-reconstructed positions and normals: per slice through the view vector, the
// two horizons found by marching the depth buffer either way, weighted by the cosine of the projected normal
// (the paper's analytic inner integral), a linear falloff to the radius so far-away surfaces (a jet in front of
// the ground) never occlude (no halos), and the paper's multi-bounce fit. Slices are rotated by a 4×4 Bayer
// pattern, which the 4×4 depth-aware blur removes.
// In the same pass, screen-space contact shadows (after Bend Studio's for Days Gone, and Unreal's): a short ray
// toward the sun marched through the depth buffer catches what the shadow maps are too coarse for, wheels on the
// tarmac, crew and vehicles on a deck, a truck a kilometre away sitting on the road.
// The composite applies occlusion to the ambient light only and contact shadows to the sunlight only: each opaque
// pixel carries the sun's share of its light in its alpha (shadows.js).
// Output: (AO, linear depth for the bilateral upsample, contact shadow, -).
export const SHADING = {
    low: { slices: 0, steps: 0, contact: 0 },
    medium: { slices: 0, steps: 0, contact: 0 },
    high: { slices: 2, steps: 5, contact: 8 },
    ultra: { slices: 3, steps: 6, contact: 12 },
};
const AO_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    uniform float radiusPerM, radiusMin, radiusMax, projScale, fadeNear, fadeFar;
    uniform vec3 sunDirV;            // toward the sun, view space
    uniform float contactLen, contactFar, sunOn;
    varying vec2 vUv;
    const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    const float HALF_PI = 1.5707963;
    vec2 size;
    vec3 posAt(ivec2 p) {
        p = clamp(p, ivec2(0), ivec2(size) - 1);
        float z = linDepth(texelFetch(tDepth, p, 0).x);
        return viewPos(pixelUv(p, size), z);
    }
    void main() {
        size = vec2(textureSize(tDepth, 0));
        ivec2 p = ivec2(gl_FragCoord.xy) * 2;
        float d = texelFetch(tDepth, p, 0).x;
        float z = linDepth(d);
        if (isSky(d) || z > max(fadeFar, contactFar)) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
        vec3 P = viewPos(pixelUv(p, size), z);
        // normal from depth: on each axis use the neighbour on the same surface (smaller step)
        vec3 l = posAt(p - ivec2(1, 0)), r = posAt(p + ivec2(1, 0));
        vec3 b = posAt(p - ivec2(0, 1)), t = posAt(p + ivec2(0, 1));
        vec3 dx = abs(l.z - P.z) < abs(r.z - P.z) ? P - l : r - P;
        vec3 dy = abs(b.z - P.z) < abs(t.z - P.z) ? P - b : t - P;
        vec3 n = normalize(cross(dx, dy));
        ivec2 q = ivec2(gl_FragCoord.xy) & 3;
        float noise = BAYER[q.y * 4 + q.x] / 16.0;
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        float ao = 1.0;
        #if SLICES > 0
        // world radius grows with distance (hangars and ships read at 300 m, not just 30 m)
        float radius = clamp(z * radiusPerM, radiusMin, radiusMax);
        float ssR = min(radius * projScale / z, 80.0);
        if (z < fadeFar && ssR > 2.0) {
            vec3 V = normalize(-P);
            float vis = 0.0;
            for (int s = 0; s < SLICES; s++) {
                float phi = (float(s) + noise) * 3.14159265 / float(SLICES);
                vec2 dir = vec2(cos(phi), sin(phi));
                vec3 dir3 = vec3(dir, 0.0);
                vec3 ortho = normalize(dir3 - dot(dir3, V) * V);
                vec3 axis = normalize(cross(ortho, V));
                vec3 pn = n - axis * dot(n, axis);
                float pl = length(pn);
                float cn = clamp(dot(pn, V) / max(pl, 1e-4), -1.0, 1.0);
                float na = (dot(pn, ortho) < 0.0 ? -1.0 : 1.0) * acos(cn);
                // the horizon on each side, starting from the surface's own tangent plane
                float hc0 = cos(na + HALF_PI), hc1 = cos(na - HALF_PI);
                float low0 = hc0, low1 = hc1;
                for (int j = 0; j < STEPS; j++) {
                    float f = (float(j) + fract(ign + float(j) * 0.618034)) / float(STEPS);
                    float px = max(pow(f, 1.25) * ssR, float(j) + 1.0); // a little denser near the pixel
                    ivec2 o = ivec2(round(dir * px));
                    vec3 w0 = posAt(p + o) - P, w1 = posAt(p - o) - P;
                    float l0 = length(w0), l1 = length(w1);
                    // linear falloff over the outer 40 % of the radius: nothing beyond it occludes
                    float f0 = clamp((radius - l0) / (0.4 * radius), 0.0, 1.0), f1 = clamp((radius - l1) / (0.4 * radius), 0.0, 1.0);
                    hc0 = max(hc0, mix(low0, dot(w0, V) / max(l0, 1e-4), f0));
                    hc1 = max(hc1, mix(low1, dot(w1, V) / max(l1, 1e-4), f1));
                }
                float h0 = acos(clamp(hc0, -1.0, 1.0)), h1 = -acos(clamp(hc1, -1.0, 1.0));
                h0 = na + min(h0 - na, HALF_PI); h1 = na + max(h1 - na, -HALF_PI);
                float sn = sin(na);
                vis += pl * 0.25 * ((cn + 2.0 * h0 * sn - cos(2.0 * h0 - na)) + (cn + 2.0 * h1 * sn - cos(2.0 * h1 - na)));
            }
            ao = clamp(vis / float(SLICES), 0.0, 1.0);
            // multiple bounces off the occluders (Jimenez 2016's fit, albedo 0.3)
            ao = max(ao, ((0.2797 * ao - 0.7968) * ao + 1.5169) * ao);
            ao = mix(ao, 1.0, smoothstep(fadeNear, fadeFar, z));
        }
        #endif
        float cs = 0.0;
        #if CSTEPS > 0
        float ndl = dot(n, sunDirV);
        if (sunOn > 0.5 && ndl > 0.0 && z < contactFar) {
            // a ray toward the sun, a few dozen pixels long (longer in metres with distance), from a hair off the surface
            float len = clamp(z * 0.025, 0.2, contactLen);
            vec3 R0 = P + n * (0.01 + z * 0.001);
            float thick = max(0.3, len * 0.5), bias = 0.015 + z * 0.0012;
            for (int i = 0; i < CSTEPS; i++) {
                float f = (float(i) + ign) / float(CSTEPS);
                vec3 R = R0 + sunDirV * (len * f);
                if (-R.z < cameraNear) break;
                vec2 ru = R.xy / (-R.z * invProj) * 0.5 + 0.5;
                if (ru.x < 0.0 || ru.y < 0.0 || ru.x > 1.0 || ru.y > 1.0) break;
                float sz = linDepth(texelFetch(tDepth, ivec2(ru * size), 0).x);
                float dz = -R.z - sz; // > 0: something in front of the ray, nearer the camera
                if (dz > bias && dz < thick) { cs = 1.0 - f * f; break; }
            }
            cs *= smoothstep(0.0, 0.12, ndl) * (1.0 - smoothstep(contactFar * 0.6, contactFar, z));
        }
        #endif
        gl_FragColor = vec4(ao, z, cs, 1.0);
    }`;

const AO_BLUR_FRAG = /* glsl */`
    uniform sampler2D tAO;
    varying vec2 vUv;
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        ivec2 sz = textureSize(tAO, 0) - 1;
        vec3 c = texelFetch(tAO, p, 0).xyz;
        vec2 sum = vec2(0.0); float wsum = 0.0;
        for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
            vec3 s = texelFetch(tAO, clamp(p + ivec2(x, y), ivec2(0), sz), 0).xyz;
            float w = max(0.0, 1.0 - abs(s.y - c.y) / (c.y * 0.04 + 0.05));
            sum += s.xz * w; wsum += w;
        }
        vec2 r = wsum > 0.0 ? sum / wsum : c.xz;
        gl_FragColor = vec4(r.x, c.y, r.y, 1.0);
    }`;

// ═════════════ Water reflections (half resolution) ═════════════
// The water (ocean.js) marks its pixels in the scene's alpha: 0.1 + 0.5 × its reflection weight (Fresnel, less
// for foam and through fog); everything else is ≥ 1 (opaque) or blends toward 1 over it. The water's normal comes
// from the depth buffer (the displaced waves as drawn), nudged by a few ripples. The reflected ray is marched through
// the depth buffer in view space with exponentially growing steps, then refined by bisection. A ray that meets
// nothing on screen goes to the sky: the sky and the clouds drawn over it lie, for a mirror, along the ray's
// direction alone (no parallax), so where that direction is on screen and only sky stands there, the frame's own
// sky and clouds are what the water mirrors (away from the sun: its disc and glow are the water's own glint). Off
// screen, the water keeps its own sky (ocean.js: the dome's colours and the clouds from the cloud-shadow map).
const SSR_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    uniform sampler2D tColor;
    uniform mat3 viewRot, camRot;
    uniform vec3 camPos, sunDirW;
    uniform vec2 proj; // projectionMatrix[0][0], [1][1]
    uniform float time, fogDensity, strength, maxDist, skyOn;
    varying vec2 vUv;
    vec2 toUv(vec3 q) { return vec2(q.x * proj.x, q.y * proj.y) / -q.z * 0.5 + 0.5; }
    void main() {
        vec2 size = vec2(textureSize(tDepth, 0));
        ivec2 p = ivec2(gl_FragCoord.xy) * 2;
        vec2 uv = pixelUv(p, size);
        float d = texelFetch(tDepth, p, 0).x;
        gl_FragColor = vec4(0.0);
        if (isSky(d) || camPos.y < -1.0) return;
        float mark = texelFetch(tColor, p, 0).a;
        if (mark > 0.7) return; // not water
        float z = linDepth(d);
        vec3 P = viewPos(uv, z);
        vec3 W = camPos + camRot * P;
        // the surface as drawn: normal from the depth buffer (the neighbour on the same side of an edge), world space
        vec3 nL = viewPos(pixelUv(p - ivec2(2, 0), size), linDepth(texelFetch(tDepth, p - ivec2(2, 0), 0).x));
        vec3 nR = viewPos(pixelUv(p + ivec2(2, 0), size), linDepth(texelFetch(tDepth, p + ivec2(2, 0), 0).x));
        vec3 nB = viewPos(pixelUv(p - ivec2(0, 2), size), linDepth(texelFetch(tDepth, p - ivec2(0, 2), 0).x));
        vec3 nT = viewPos(pixelUv(p + ivec2(0, 2), size), linDepth(texelFetch(tDepth, p + ivec2(0, 2), 0).x));
        vec3 dx = abs(nL.z - P.z) < abs(nR.z - P.z) ? P - nL : nR - P;
        vec3 dy = abs(nB.z - P.z) < abs(nT.z - P.z) ? P - nB : nT - P;
        vec3 N = normalize(camRot * normalize(cross(dx, dy)));
        if (N.y < 0.0) N = -N;
        // a depth-buffer normal is noisy (worse at grazing angles): keep only part of it, and never tilted more than
        // ~14°, so reflections follow the swell without rays from every ripple finding the nearest hull
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.35 + 0.65 * smoothstep(150.0, 2000.0, z)));
        float tilt = length(N.xz);
        if (tilt > 0.25) { N.xz *= 0.25 / tilt; N.y = 1.0; N = normalize(N); }
        // ripples: a few short waves tilt it a little more (less with distance, where they'd alias)
        vec2 g = vec2(0.0);
        g += vec2(0.8, 0.6) * cos(dot(vec2(0.8, 0.6), W.xz) * 0.41 + time * 2.8);
        g += vec2(-0.47, 0.88) * cos(dot(vec2(-0.47, 0.88), W.xz) * 0.83 + time * 3.9) * 0.7;
        float amp = 0.03 * (1.0 - smoothstep(60.0, 800.0, z));
        N = normalize(N + vec3(-g.x * amp, 0.0, -g.y * amp));
        vec3 V = normalize(W - camPos);
        vec3 R = reflect(V, N);
        R.y = max(R.y, 0.01);
        R = normalize(R);
        float weight = clamp((mark - 0.1) / 0.5, 0.0, 1.0) * strength;
        if (weight < 0.01) return;
        vec3 Rv = viewRot * R;
        float t0 = max(1.0, z * 0.004);
        float tMax = maxDist;
        float grow = pow(tMax / t0, 1.0 / float(STEPS));
        float t = t0, tPrev = 0.0;
        vec2 hitUv = vec2(-1.0);
        for (int i = 0; i < STEPS; i++) {
            vec3 Q = P + Rv * t;
            if (-Q.z < cameraNear) break;
            vec2 qu = toUv(Q);
            if (qu.x < 0.0 || qu.x > 1.0 || qu.y < 0.0 || qu.y > 1.0) break;
            float sz = linDepth(textureLod(tDepth, qu, 0.0).x);
            float dz = -Q.z - sz;
            if (dz > 0.0 && dz < max((t - tPrev) * 1.5, sz * 0.02)) {
                // bisection between the last point in front and this one
                float a = tPrev, bT = t;
                for (int k = 0; k < REFINE; k++) {
                    float m = 0.5 * (a + bT);
                    vec3 M = P + Rv * m;
                    vec2 mu = toUv(M);
                    float mz = linDepth(textureLod(tDepth, mu, 0.0).x);
                    if (-M.z > mz) bT = m; else a = m;
                }
                vec2 hu = toUv(P + Rv * bT);
                // a ray above the sea can't really hit the sea: at grazing angles one pixel spans a lot of
                // depth and the test misfires, so skip water "hits" and keep marching
                if (textureLod(tColor, hu, 0.0).a > 0.7) { hitUv = hu; t = bT; break; }
            }
            tPrev = t;
            t *= grow;
        }
        if (hitUv.x < 0.0) {
            if (skyOn < 0.5) return;
            // the sky's image is far away: a gentler normal than the march's (the blur pass streaks it up and down
            // the frame like the waves' slopes do)
            vec3 Rs = reflect(V, normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5)));
            Rs.y = max(Rs.y, 0.01);
            vec3 Rsv = viewRot * normalize(Rs);
            if (Rsv.z > -0.02) return;
            vec2 su = toUv(Rsv);
            // (off the sides the sky changes little with the azimuth: the frame's edge stands in for it, fading slowly;
            // above or below the frame it changes with the elevation: there the water's own sky takes over)
            float sideOut = max(-su.x, su.x - 1.0);
            su.x = clamp(su.x, 0.005, 0.995);
            if (su.y < 0.0 || su.y > 1.0 || sideOut > 0.4) return;
            if (!isSky(texelFetch(tDepth, ivec2(su * size), 0).x)) return;
            float es = smoothstep(0.0, 0.1, su.y) * smoothstep(0.0, 0.1, 1.0 - su.y) * (1.0 - smoothstep(0.0, 0.4, sideOut));
            float sunK = 1.0 - smoothstep(0.972, 0.99, dot(normalize(Rs), normalize(sunDirW)));
            gl_FragColor = vec4(textureLod(tColor, su, 0.0).rgb, weight * es * sunK);
            return;
        }
        vec2 e = smoothstep(vec2(0.0), vec2(0.07), hitUv) * smoothstep(vec2(0.0), vec2(0.07), 1.0 - hitUv);
        float conf = e.x * e.y * (1.0 - smoothstep(tMax * 0.6, tMax, t));
        vec3 c = textureLod(tColor, hitUv, 0.0).rgb;
        gl_FragColor = vec4(c, weight * conf);
    }`;

// The waves too small to show in the reflected ray's normal still break a reflection up and stretch it up and down
// the frame (the familiar streaks of a mirror image on water), the more the further off: a vertical, weight-aware
// blur of the half-res reflections, its reach growing with distance.
const SSR_BLUR_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    uniform sampler2D tSSR;
    uniform float blurPx;
    varying vec2 vUv;
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy), hs = textureSize(tSSR, 0) - 1;
        vec4 c0 = texelFetch(tSSR, p, 0);
        float d = texelFetch(tDepth, min(p * 2, textureSize(tDepth, 0) - 1), 0).x;
        float z = isSky(d) ? 1e5 : linDepth(d);
        float r = blurPx * (0.12 + 0.88 * smoothstep(40.0, 2500.0, z));
        vec3 sum = c0.rgb * c0.a; float wa = c0.a, ws = 1.0;
        for (int k = 1; k <= 3; k++) {
            float w = 1.0 - float(k) * 0.22, o = r * float(k) / 3.0;
            vec4 a = texelFetch(tSSR, clamp(p + ivec2(0, int(o + 0.5)), ivec2(0), hs), 0);
            vec4 b = texelFetch(tSSR, clamp(p - ivec2(0, int(o + 0.5)), ivec2(0), hs), 0);
            sum += (a.rgb * a.a + b.rgb * b.a) * w; wa += (a.a + b.a) * w; ws += 2.0 * w;
        }
        gl_FragColor = vec4(wa > 1e-4 ? sum / wa : c0.rgb, wa / ws);
    }`;

// ═════════════ Sun visibility (1×1) ═════════════
// How much of the sun disc is actually on screen and unoccluded (terrain, jets and clouds all count:
// it tests the HDR colour, not depth). Smoothed over a few frames.
const SUNVIS_FRAG = /* glsl */`
    uniform sampler2D tColor, tPrev;
    uniform vec2 sunUv, sunRadius;
    uniform float threshold, blend;
    varying vec2 vUv;
    void main() {
        float v = 0.0;
        for (int i = 0; i < 24; i++) {
            float a = (float(i) + 0.5) / 24.0;
            float ang = float(i) * 2.3999632;
            vec2 uv = sunUv + vec2(cos(ang), sin(ang)) * sqrt(a) * sunRadius;
            float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
            vec3 c = textureLod(tColor, clamp(uv, 0.0, 1.0), 0.0).rgb;
            v += inside * smoothstep(threshold * 0.5, threshold, dot(c, vec3(0.2126, 0.7152, 0.0722)));
        }
        v /= 24.0;
        float prev = texture2D(tPrev, vec2(0.5)).r;
        gl_FragColor = vec4(mix(prev, v, blend), 0.0, 0.0, 1.0);
    }`;

// ═════════════ Composite ═════════════
const COMPOSITE_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    uniform sampler2D tColor, tAO, tSSR, tSunVis;
    uniform float aoStrength, ssrOn, aoOn, contactStrength;
    uniform vec3 camPos, camRotY; // world y of a view-space position = camPos.y + dot(camRotY, P)
    uniform vec2 sunUv;
    uniform vec3 flareColor;
    uniform float aspect, flareOn;
    uniform mat4 reproj; // motion blur: previous projection × previous view × current camera world
    uniform float blurOn, blurScale, blurMaxPx, nearCut;
    uniform float debugView; // 1: AO, 2: water mask (blue) + reflection weight (white), 4: contact shadows (r), sun share (b)
    // under water (ocean.js / water.js): the camera at or below the surface
    uniform float underOn;
    uniform vec3 underColor, underExt, underKd, underSun, sunDirU;
    uniform float underScat;
    uniform sampler2D fftMap;   // the ocean's detail (oceanfft.js): its ∇²h focuses the sun into caustics and shafts
    uniform vec4 fftInfo;
    uniform mat3 camRotM;
    varying vec2 vUv;
    ${WAVE_GLSL}

    #ifdef USE_BLUR
    // Camera motion blur: velocity from depth (each pixel's view position re-projected with last frame's
    // camera). Pixels nearer than nearCut (the player's own jet in the chase view) neither blur nor get
    // smeared into their neighbours.
    float keep(float z) { return nearCut > 0.0 ? smoothstep(nearCut, nearCut * 1.4, z) : 1.0; }
    vec3 motionBlur(vec3 c, float z, vec2 size) {
        vec4 pc = reproj * vec4(viewPos(vUv, z), 1.0);
        if (pc.w <= 0.0) return c;
        vec2 v = (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * size * blurScale * keep(z);
        float len = length(v);
        if (len < 0.6) return c;
        v *= min(1.0, blurMaxPx / len) / size;
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        vec3 sum = c; float wsum = 1.0;
        for (int i = 0; i < TAPS; i++) {
            vec2 uv = vUv + v * ((float(i) + jitter) / float(TAPS) - 0.5);
            float w = nearCut > 0.0 ? keep(linDepth(texture2D(tDepth, uv).x)) : 1.0;
            sum += texture2D(tColor, uv).rgb * w; wsum += w;
        }
        return sum / wsum;
    }
    #endif

    #ifdef USE_FLARE
    float disc(vec2 uv, vec2 c, float r, float soft) { return 1.0 - smoothstep(r * (1.0 - soft), r, length((uv - c) * vec2(aspect, 1.0))); }
    vec3 flare(vec2 uv, float vis) {
        vec2 dv = (uv - sunUv) * vec2(aspect, 1.0);
        float r = length(dv);
        float ang = atan(dv.y, dv.x);
        // glare around the sun: a tight core, a wide veil, six soft spikes and a faint horizontal streak
        float glare = 0.9 * exp(-r * 40.0) + 0.12 * exp(-r * 6.0);
        float spikes = pow(abs(cos(ang * 3.0 + 0.4)), 40.0) * exp(-r * 10.0) * 0.4;
        float streak = exp(-abs(dv.y) * 260.0) * exp(-abs(dv.x) * 4.0) * 0.22;
        vec3 col = flareColor * (glare + spikes + streak);
        // ghosts on the line from the sun through the centre of the frame
        vec2 axis = vec2(0.5) - sunUv;
        float edge = 1.0 - smoothstep(0.35, 0.75, length(axis * vec2(aspect, 1.0)));
        vec3 g = vec3(0.0);
        g += vec3(1.0, 0.75, 0.45) * disc(uv, sunUv + axis * 0.45, 0.035, 0.6) * 0.10;
        g += vec3(0.45, 0.9, 0.6) * disc(uv, sunUv + axis * 0.8, 0.02, 0.5) * 0.14;
        g += vec3(0.5, 0.6, 1.0) * disc(uv, sunUv + axis * 1.25, 0.075, 0.4) * 0.05;
        g += vec3(1.0, 0.55, 0.8) * disc(uv, sunUv + axis * 1.55, 0.045, 0.3) * 0.07;
        g += vec3(0.6, 0.85, 1.0) * disc(uv, sunUv + axis * 2.1, 0.16, 0.25) * 0.025;
        // a faint ring
        float ring = length((uv - (sunUv + axis * 1.0)) * vec2(aspect, 1.0));
        g += vec3(0.7, 0.8, 1.0) * smoothstep(0.03, 0.0, abs(ring - 0.33)) * 0.018;
        col += flareColor * g * edge;
        return col * vis;
    }
    #endif

    void main() {
        vec4 c = texture2D(tColor, vUv);
        vec3 dbg = vec3(-1.0);
        #if defined(USE_AO) || defined(USE_SSR) || defined(USE_BLUR)
        vec2 size = vec2(textureSize(tDepth, 0));
        ivec2 pix = ivec2(vUv * size);
        float d = texelFetch(tDepth, pix, 0).x;
        float z = linDepth(d);
        #ifdef USE_BLUR
        if (blurOn > 0.5) c.rgb = motionBlur(c.rgb, z, size);
        #endif
        if (!isSky(d)) {
            // half-res texel (i, j) sampled full-res pixel (2i, 2j): bilinear footprint of this pixel
            vec2 hp = vec2(pix) * 0.5;
            ivec2 h0 = ivec2(floor(hp));
            vec2 f = hp - vec2(h0);
            #ifdef USE_AO
            if (aoOn > 0.5) {
                ivec2 hs = textureSize(tAO, 0) - 1;
                vec2 sum = vec2(0.0); float wsum = 0.0;
                for (int k = 0; k < 4; k++) {
                    ivec2 o = ivec2(k & 1, k >> 1);
                    vec3 s = texelFetch(tAO, min(h0 + o, hs), 0).xyz;
                    float bw = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y) + 1e-3;
                    float w = bw / (1e-3 + abs(s.y - z) / z);
                    sum += s.xz * w; wsum += w;
                }
                vec2 oc = sum / wsum; // (AO, contact shadow)
                // the sun's share of this pixel's light (shadows.js writes 1 + share / 2 into an opaque pixel's
                // alpha): occlusion dims the rest (sky and bounce light), contact shadows the sun's part
                float share = c.a >= 1.0 ? clamp((c.a - 1.0) * 2.0, 0.0, 1.0) : 0.0;
                float ao = mix(1.0, oc.x, aoStrength);
                c.rgb *= (1.0 - (1.0 - ao) * (1.0 - share)) * (1.0 - oc.y * share * contactStrength);
                if (debugView == 1.0) dbg = vec3(ao);
                if (debugView == 4.0) dbg = vec3(1.0 - oc.y * contactStrength, 1.0 - oc.y * share * contactStrength, share);
            }
            #endif
            #ifdef USE_SSR
            if (ssrOn > 0.5) {
                if (debugView == 3.0) dbg = vec3(c.a < 0.7 ? 1.0 : 0.0, z / 1000.0, 0.0);
                if (c.a < 0.7) { // water (ocean.js marks it in alpha)
                    ivec2 hs = textureSize(tSSR, 0) - 1;
                    vec3 rgb = vec3(0.0); float asum = 0.0, wsum = 0.0;
                    for (int k = 0; k < 4; k++) {
                        ivec2 o = ivec2(k & 1, k >> 1);
                        vec4 s = texelFetch(tSSR, min(h0 + o, hs), 0);
                        float bw = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y) + 1e-3;
                        rgb += s.rgb * s.a * bw; asum += s.a * bw; wsum += bw;
                    }
                    if (asum > 1e-4) c.rgb = mix(c.rgb, rgb / asum, clamp(asum / wsum, 0.0, 1.0));
                    if (debugView == 2.0) dbg = vec3(0.0, 0.0, 0.4) + asum / wsum;
                }
            }
            #endif
        }
        #endif
        // under water: every pixel whose eye (its point on the near plane) is below the waves looks through
        // water to what it sees (ocean.js underwaterPalette: the water's own optics). What it sees was lit as if
        // dry: daylight reaching it had to come down through the water first (Kd over its depth), focused into
        // caustics by the waves above it; the view back is absorbed and filled in by the light the water scatters
        // (Beer-Lambert over the path: brighter looking up toward the light, darker the deeper the camera), and the
        // sun's light through the waves hangs in it as shafts. A dark meniscus where the surface crosses the lens.
        if (underOn > 0.5) {
            vec2 usz = vec2(textureSize(tDepth, 0));
            ivec2 up = ivec2(vUv * usz);
            float ud = texelFetch(tDepth, up, 0).x;
            vec3 nearW = camPos + camRotM * viewPos(vUv, cameraNear * 1.02);
            float surf = waveHeightApprox(nearW.xz, 0.0);
            float below = nearW.y - surf;
            if (below < 0.0) {
                float dist = isSky(ud) ? 4000.0 : length(viewPos(pixelUv(up, usz), linDepth(ud)));
                vec3 dirW = normalize(camRotM * viewPos(vUv, 1.0));
                float camDepth = max(surf - camPos.y, 0.0);
                vec3 Lw = refract(-normalize(sunDirU), vec3(0.0, 1.0, 0.0), 0.75); // the sun in the water
                float sunUp = smoothstep(0.0, 0.2, sunDirU.y);
                if (!isSky(ud)) {
                    vec3 P = camPos + dirW * dist;
                    float dP = max(-P.y, 0.0);
                    if (dP > 0.0) {
                        // caustics: the curvature of the waves where its light came in (oceanfft.js: ∇²h), the
                        // Jacobian of the refracted rays at this depth
                        vec2 S = P.xz - Lw.xz * (dP / max(-Lw.y, 0.3));
                        float lod = log2(max(max(dP * 0.012, dist * 0.0012), 0.05) * fftInfo.x * float(textureSize(fftMap, 0).x));
                        float J = 1.0 + dP * 0.25 * textureLod(fftMap, S * fftInfo.x, lod).w * fftInfo.z;
                        // (bright where the ray bundle folds over, |J| → 0: the network of caustic lines)
                        float cau = (min(1.0 / max(abs(J), 0.2), 4.0) - 1.3) * (1.0 - smoothstep(10.0, 35.0, dP)) * sunUp * (1.0 - smoothstep(20.0, 80.0, dist));
                        c.rgb *= exp(-underKd * dP) * max(1.0 + cau * 0.5, 0.35);
                    }
                }
                vec3 T = exp(-underExt * min(dist, 4000.0));
                vec3 inS = underColor * exp(-underKd * camDepth) * (0.5 + 0.7 * smoothstep(-0.7, 0.9, dirW.y));
                // shafts: the sunlight in the water along the view (a few steps, jittered), bright where the waves
                // above focus it, scattered forward toward the camera (Henyey-Greenstein, g 0.8)
                vec3 shafts = vec3(0.0);
                if (sunUp > 0.0) {
                    float tMax = min(dist, 45.0), j = fract(52.98 * fract(dot(gl_FragCoord.xy, vec2(0.0671, 0.00584))));
                    float cosT = dot(dirW, -Lw), g = 0.8;
                    float ph = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.25;
                    float acc = 0.0;
                    for (int k = 0; k < 10; k++) {
                        float t = (float(k) + j) / 10.0 * tMax;
                        vec3 X = camPos + dirW * t;
                        float dx = max(surf - X.y, 0.0);
                        vec2 S = X.xz - Lw.xz * (dx / max(-Lw.y, 0.3));
                        float lap = textureLod(fftMap, S * fftInfo.x, 2.5).w * fftInfo.z;
                        float J = 1.0 + max(dx, 2.0) * 0.25 * lap * 3.0;
                        acc += (clamp(1.0 / max(J, 0.3), 0.0, 3.0) - 0.6) * exp(-dot(underExt, vec3(0.33)) * t - dot(underKd, vec3(0.33)) * dx);
                    }
                    shafts = underSun * max(acc, 0.0) / 10.0 * tMax * ph * underScat;
                }
                c.rgb = c.rgb * T + inS * (1.0 - T) + shafts;
            }
            c.rgb *= 1.0 - 0.55 * exp(-abs(below) * 40.0);
        }
        #ifdef USE_FLARE
        if (flareOn > 0.0) {
            float vis = texture2D(tSunVis, vec2(0.5)).r * flareOn;
            if (vis > 0.001) c.rgb += flare(vUv, vis);
        }
        #endif
        if (debugView > 0.0) c.rgb = dbg.x >= 0.0 ? dbg : (debugView == 1.0 ? vec3(1.0) : c.rgb * 0.25);
        gl_FragColor = c;
    }`;

// uniforms WAVE_GLSL reads, as placeholders until the ocean exists (Ocean.shareWaveUniforms fills them each frame:
// they must be on the material before it compiles, or three.js never uploads them)
const _emptyF = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
_emptyF.needsUpdate = true;
function waveUniformSlots() {
    return {
        waveA: { value: new Float32Array(96) }, waveB: { value: new Float32Array(96) }, waveN: { value: 0 },
        waveOrigin: { value: new THREE.Vector2() }, waveLod: { value: new THREE.Vector2(1e9, 1e9) }, setDepth: { value: new THREE.Vector3(1, 1, 1) },
        seaMapFine: { value: _emptyF }, seaMapCoarse: { value: _emptyF }, seaFineInfo: { value: new THREE.Vector4() }, seaCoarseInfo: { value: new THREE.Vector4() },
        shoreInfo: { value: new THREE.Vector4() }, time: { value: 0 },
    };
}

export class SceneFXPass extends Pass {
    constructor(scenePass, camera) {
        super();
        this.scenePass = scenePass;
        this.camera = camera;
        this.needsSwap = true;
        this.ao = false; this.ssr = 0; this.flare = false; this.blur = 0; // what the quality level allows
        this.aoActive = false; this.ssrActive = false; this.flareActive = false; this.blurActive = false; // this frame
        this.width = 1; this.height = 1;
        this.aoRT = halfFloatTarget(1, 1, THREE.RGBAFormat, THREE.NearestFilter);   // (AO, depth, contact shadow)
        this.aoBlurRT = halfFloatTarget(1, 1, THREE.RGBAFormat, THREE.NearestFilter);
        this.ssrRT = halfFloatTarget(1, 1, THREE.RGBAFormat, THREE.NearestFilter);
        this.ssrBlurRT = halfFloatTarget(1, 1, THREE.RGBAFormat, THREE.NearestFilter);
        this.visRT = [0, 1].map(() => halfFloatTarget(1, 1, THREE.RGBAFormat, THREE.NearestFilter));
        this.visIdx = 0;
        this.aoMat = fxMaterial(AO_FRAG, {
            ...depthUniforms(), radiusPerM: { value: 0.05 }, radiusMin: { value: 2 }, radiusMax: { value: 10 },
            projScale: { value: 500 }, fadeNear: { value: 160 }, fadeFar: { value: 650 },
            sunDirV: { value: new THREE.Vector3(0, 1, 0) }, sunOn: { value: 0 }, contactLen: { value: 2.5 }, contactFar: { value: 900 },
        }, { SLICES: 2, STEPS: 4, CSTEPS: 8 });
        this.sunDirW = new THREE.Vector3(0, 1, 0); // toward the sun (world), set by PostFX; sunUp: it's lighting the world
        this.sunUp = false;
        this.shading = SHADING.high;
        this.aoBlurMat = fxMaterial(AO_BLUR_FRAG, { tAO: { value: this.aoRT.texture } });
        this.ssrMat = fxMaterial(SSR_FRAG, {
            ...depthUniforms(), tColor: { value: null }, viewRot: { value: new THREE.Matrix3() }, camRot: { value: new THREE.Matrix3() },
            camPos: { value: new THREE.Vector3() }, proj: { value: new THREE.Vector2() }, time: { value: 0 }, fogDensity: { value: 0 },
            strength: { value: 1 }, maxDist: { value: 4000 }, sunDirW: { value: new THREE.Vector3(0, 1, 0) }, skyOn: { value: 1 },
        }, { STEPS: 24, REFINE: 5 });
        this.ssrBlurMat = fxMaterial(SSR_BLUR_FRAG, { ...depthUniforms(), tSSR: { value: this.ssrRT.texture }, blurPx: { value: 6 } });
        this.visMat = fxMaterial(SUNVIS_FRAG, {
            tColor: { value: null }, tPrev: { value: null }, sunUv: { value: new THREE.Vector2() }, sunRadius: { value: new THREE.Vector2() },
            threshold: { value: 5 }, blend: { value: 0.3 },
        });
        this.compMat = fxMaterial(COMPOSITE_FRAG, {
            ...depthUniforms(), tColor: { value: null }, tAO: { value: this.aoBlurRT.texture }, tSSR: { value: this.ssrBlurRT.texture },
            tSunVis: { value: this.visRT[0].texture }, aoStrength: { value: 0.85 }, aoOn: { value: 0 }, ssrOn: { value: 0 }, contactStrength: { value: 0.9 },
            camPos: { value: new THREE.Vector3() }, camRotY: { value: new THREE.Vector3() }, sunUv: { value: new THREE.Vector2() },
            flareColor: { value: new THREE.Color() }, aspect: { value: 1 }, flareOn: { value: 0 },
            reproj: { value: new THREE.Matrix4() }, blurOn: { value: 0 }, blurScale: { value: 0 }, blurMaxPx: { value: 20 }, nearCut: { value: 0 },
            debugView: { value: 0 },
            underOn: { value: 0 }, underColor: { value: new THREE.Color(0.012, 0.05, 0.065) }, underExt: { value: new THREE.Vector3(0.42, 0.1, 0.075) },
            underKd: { value: new THREE.Vector3(0.4, 0.09, 0.03) }, underSun: { value: new THREE.Color(0, 0, 0) }, sunDirU: { value: new THREE.Vector3(0, 1, 0) },
            underScat: { value: 0.02 }, fftMap: { value: _emptyF }, fftInfo: { value: new THREE.Vector4(1 / 32, 1 / 86, 0, 2500) },
            camRotM: { value: new THREE.Matrix3() }, ...waveUniformSlots(),
        }, { TAPS: 8 });
        this.quad = new FullScreenQuad(null);
        this.time = 0;
        this.sun = { uv: new THREE.Vector2(), on: 0, color: new THREE.Color() }; // set by PostFX each frame
        this.fogDensity = 0;
        this.groundDist = 1e9;
        this.sunDirW = new THREE.Vector3(0, 1, 0); // the sun (or the moon) in world space: the water's glint (PostFX)
    }

    configure({ ao, ssr, flare, blur, level }) {
        this.ssr = ssr | 0; this.flare = !!flare; this.blur = blur | 0;
        // ambient occlusion and contact shadows: one pass (SHADING by quality; `ao` alone turns on the ultra set)
        const sh = this.shading = SHADING[level] || (ao ? SHADING.ultra : SHADING.low);
        this.ao = sh.slices > 0 || sh.contact > 0;
        const ad = this.aoMat.defines;
        if (ad.SLICES !== sh.slices || ad.STEPS !== Math.max(1, sh.steps) || ad.CSTEPS !== sh.contact) {
            ad.SLICES = sh.slices; ad.STEPS = Math.max(1, sh.steps); ad.CSTEPS = sh.contact;
            this.aoMat.needsUpdate = true;
        }
        const defs = this.compMat.defines;
        const want = { USE_AO: this.ao, USE_SSR: this.ssr > 0, USE_FLARE: this.flare, USE_BLUR: this.blur > 0 };
        let changed = false;
        for (const [k, on] of Object.entries(want)) {
            if (!!defs[k] !== on) { changed = true; if (on) defs[k] = ''; else delete defs[k]; }
        }
        if (this.blur && defs.TAPS !== this.blur) { defs.TAPS = this.blur; changed = true; }
        if (changed) this.compMat.needsUpdate = true;
        const steps = this.ssr >= 2 ? 24 : 14, refine = this.ssr >= 2 ? 5 : 3;
        if (this.ssrMat.defines.STEPS !== steps) { this.ssrMat.defines.STEPS = steps; this.ssrMat.defines.REFINE = refine; this.ssrMat.needsUpdate = true; }
        this.setSize(this.width, this.height);
    }

    // decide what runs this frame (before the scene renders, so PostFX knows whether the scene needs
    // its own target); `blurOn` is set up by PostFX
    // the camera is under water (or its near plane is): PostFX sets this from the wave field
    get underActive() { return this.underwater > 0; }
    prepare(cam, blurOn) {
        const au = this.aoMat.uniforms;
        this.aoActive = this.ao && this.groundDist < Math.max(this.shading.slices ? au.fadeFar.value : 0, this.shading.contact && this.sunUp ? au.contactFar.value : 0);
        // (the reduced SSR of high only within ~1 km of the sea: from higher up the water mirrors little but sky and
        // cloud, which its own shader does; with a little hysteresis so it doesn't flicker at the edge)
        const near = this.ssr >= 2 || cam.position.y < (this.ssrActive ? 1100 : 1000);
        this.ssrActive = this.ssr > 0 && near && !this.noWater && cam.position.y > 0.3 && this.waterVisible(cam);
        this.flareActive = this.flare && this.sun.on > 0;
        this.blurActive = this.blur > 0 && blurOn;
        return this.aoActive || this.ssrActive || this.flareActive || this.blurActive || this.underActive;
    }

    setSize(w, h) {
        this.width = w; this.height = h;
        const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
        if (this.ao) { this.aoRT.setSize(hw, hh); this.aoBlurRT.setSize(hw, hh); }
        if (this.ssr) { this.ssrRT.setSize(hw, hh); this.ssrBlurRT.setSize(hw, hh); }
    }

    renderQuad(renderer, mat, target) {
        this.quad.material = mat;
        renderer.setRenderTarget(target);
        this.quad.render(renderer);
    }

    render(renderer, writeBuffer, readBuffer) {
        const src = this.scenePass.output || readBuffer;
        const cam = this.camera;
        const depth = src.depthTexture;
        const cm = this.compMat.uniforms;
        cm.tColor.value = src.texture;
        setDepthUniforms(cm, cam, depth, src.samples);
        const e = cam.matrixWorld.elements;
        cm.camPos.value.setFromMatrixPosition(cam.matrixWorld);
        cm.camRotY.value.set(e[1], e[5], e[9]);
        const hasDepth = !!depth;

        // ambient occlusion (half res + 4×4 bilateral blur), only with ground inside its fade distance
        cm.aoOn.value = this.aoActive && hasDepth ? 1 : 0;
        if (cm.aoOn.value) {
            const aoU = this.aoMat.uniforms;
            setDepthUniforms(aoU, cam, depth, src.samples);
            aoU.projScale.value = cam.projectionMatrix.elements[5] * 0.5 * src.height;
            aoU.sunDirV.value.copy(this.sunDirW).transformDirection(cam.matrixWorldInverse);
            aoU.sunOn.value = this.sunUp ? 1 : 0;
            this.renderQuad(renderer, this.aoMat, this.aoRT);
            this.renderQuad(renderer, this.aoBlurMat, this.aoBlurRT);
        }

        // water reflections (half res)
        cm.ssrOn.value = this.ssrActive && hasDepth ? 1 : 0;
        if (cm.ssrOn.value) {
            const su = this.ssrMat.uniforms;
            setDepthUniforms(su, cam, depth, src.samples);
            su.tColor.value = src.texture;
            su.viewRot.value.setFromMatrix4(cam.matrixWorldInverse);
            su.camRot.value.setFromMatrix4(cam.matrixWorld);
            su.camPos.value.copy(cm.camPos.value);
            su.proj.value.set(cam.projectionMatrix.elements[0], cam.projectionMatrix.elements[5]);
            su.time.value = this.time;
            su.fogDensity.value = this.fogDensity;
            su.maxDist.value = this.ssr >= 2 ? 5000 : 2500;
            su.sunDirW.value.copy(this.sunDirW);
            this.renderQuad(renderer, this.ssrMat, this.ssrRT);
            const bu = this.ssrBlurMat.uniforms;
            setDepthUniforms(bu, cam, depth, src.samples);
            bu.blurPx.value = Math.max(2, this.height / 2 / 75); // (~6 half-res pixels at 900 lines)
            this.renderQuad(renderer, this.ssrBlurMat, this.ssrBlurRT);
        }

        // sun flare: a 1×1 visibility pass, then analytic ghosts/glare in the composite
        cm.flareOn.value = this.flareActive ? this.sun.on : 0;
        if (this.flareActive) {
            const vu = this.visMat.uniforms;
            const prev = this.visRT[this.visIdx];
            this.visIdx ^= 1;
            vu.tColor.value = src.texture;
            vu.tPrev.value = prev.texture;
            vu.sunUv.value.copy(this.sun.uv);
            // the disc is ~0.027 rad across; sample a little inside it
            const p5 = cam.projectionMatrix.elements[5];
            vu.sunRadius.value.set(0.02 * p5 * 0.5 / cam.aspect, 0.02 * p5 * 0.5);
            this.renderQuad(renderer, this.visMat, this.visRT[this.visIdx]);
            cm.tSunVis.value = this.visRT[this.visIdx].texture;
            cm.sunUv.value.copy(this.sun.uv);
            cm.flareColor.value.copy(this.sun.color);
            cm.aspect.value = cam.aspect;
        }

        cm.blurOn.value = this.blurActive && hasDepth ? 1 : 0;
        cm.underOn.value = this.underActive && hasDepth ? 1 : 0;
        if (cm.underOn.value) cm.camRotM.value.setFromMatrix4(cam.matrixWorld);
        cm.blurMaxPx.value = 0.02 * src.height;
        this.renderQuad(renderer, this.compMat, this.renderToScreen ? null : writeBuffer);
    }

    // cheap CPU test: does any part of the view look down at the plane y = 0 within range?
    waterVisible(cam) {
        const e = cam.projectionMatrix.elements;
        const tx = 1 / e[0], ty = 1 / e[5];
        const m = cam.matrixWorld.elements;
        for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]]) {
            // world direction of the frustum corner
            const vx = x * tx, vy = y * ty, vz = -1;
            const dy = m[1] * vx + m[5] * vy + m[9] * vz;
            if (dy < 0) return true;
        }
        return false;
    }

    dispose() {
        for (const rt of [this.aoRT, this.aoBlurRT, this.ssrRT, this.ssrBlurRT, ...this.visRT]) rt.dispose();
        for (const m of [this.aoMat, this.aoBlurMat, this.ssrMat, this.ssrBlurMat, this.visMat, this.compMat]) m.dispose();
    }
}

// ═════════════ Depth of field (photo mode) ═════════════
// Gather bokeh (after Dennis Gustafsson): golden-angle spiral, each tap weighted by whether its own
// circle of confusion reaches this pixel; background taps can't bleed over a sharper foreground.
// Gathered at half resolution (taps in full-res pixels), then blended over the sharp full-res image
// by each pixel's own CoC, so in-focus detail stays crisp: ~4× cheaper than a full-res gather.
const DOF_COC_GLSL = /* glsl */`
    uniform float focus, focusScale, maxBlur;
    float coc(float z) { return clamp((1.0 / focus - 1.0 / z) * focusScale, -1.0, 1.0) * maxBlur; }
`;
const DOF_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    ${DOF_COC_GLSL}
    uniform sampler2D tColor;
    uniform float radScale;
    varying vec2 vUv;
    void main() {
        vec2 px = 1.0 / vec2(textureSize(tColor, 0));
        vec4 c0 = texture2D(tColor, vUv);
        float cz = linDepth(texture2D(tDepth, vUv).x);
        float cs = abs(coc(cz));
        vec3 col = c0.rgb; float tot = 1.0;
        float radius = radScale, ang = 0.0;
        for (int i = 0; i < MAX_TAPS; i++) {
            if (radius >= maxBlur) break;
            ang += 2.39996323;
            vec2 uv = vUv + vec2(cos(ang), sin(ang)) * px * radius;
            vec3 sc = texture2D(tColor, uv).rgb;
            float sz = linDepth(texture2D(tDepth, uv).x);
            float ss = abs(coc(sz));
            if (sz > cz) ss = clamp(ss, 0.0, cs * 2.0);
            float m = smoothstep(radius - 0.5, radius + 0.5, ss);
            col += mix(col / tot, sc, m);
            tot += 1.0;
            radius += radScale / radius;
        }
        gl_FragColor = vec4(col / tot, 1.0);
    }`;
const DOF_COMP_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    ${DOF_COC_GLSL}
    uniform sampler2D tColor, tBlur;
    varying vec2 vUv;
    void main() {
        vec4 sharp = texture2D(tColor, vUv);
        float cs = abs(coc(linDepth(texture2D(tDepth, vUv).x)));
        gl_FragColor = vec4(mix(sharp.rgb, texture2D(tBlur, vUv).rgb, smoothstep(0.75, 2.5, cs)), sharp.a);
    }`;

export class DofPass extends Pass {
    constructor(scenePass, camera) {
        super();
        this.scenePass = scenePass;
        this.camera = camera;
        const coc = () => ({ focus: { value: 50 }, focusScale: { value: 25 }, maxBlur: { value: 16 } });
        this.mat = fxMaterial(DOF_FRAG, { ...depthUniforms(), ...coc(), tColor: { value: null }, radScale: { value: 1 } }, { MAX_TAPS: 96 });
        this.compMat = fxMaterial(DOF_COMP_FRAG, { ...depthUniforms(), ...coc(), tColor: { value: null }, tBlur: { value: null } });
        this.halfRT = halfFloatTarget(1, 1);
        this.quad = new FullScreenQuad(this.mat);
        this.enabled = false;
        this.height = 1;
        this.taps = 96;
    }
    setTaps(n) { this.taps = n; if (this.mat.defines.MAX_TAPS !== n) { this.mat.defines.MAX_TAPS = n; this.mat.needsUpdate = true; } }
    setSize(w, h) { this.height = h; this.halfRT.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2))); }
    // focus distance (m) and CoC scale, set by PostFX from the photo camera
    setFocus(focus, focusScale) {
        for (const u of [this.mat.uniforms, this.compMat.uniforms]) { u.focus.value = focus; u.focusScale.value = focusScale; }
    }
    render(renderer, writeBuffer, readBuffer) {
        const out = this.scenePass.output;
        const maxBlur = Math.max(4, 0.014 * this.height);
        for (const m of [this.mat, this.compMat]) {
            const u = m.uniforms;
            u.tColor.value = readBuffer.texture;
            setDepthUniforms(u, this.camera, out.depthTexture, out.samples);
            u.maxBlur.value = maxBlur;
        }
        // taps ≈ maxBlur² / (2 · radScale): pick the step so the spiral ends on the tap budget
        this.mat.uniforms.radScale.value = Math.max(0.5, (maxBlur * maxBlur) / (2 * this.taps));
        this.quad.material = this.mat;
        renderer.setRenderTarget(this.halfRT);
        this.quad.render(renderer);
        this.compMat.uniforms.tBlur.value = this.halfRT.texture;
        this.quad.material = this.compMat;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }
    dispose() { this.mat.dispose(); this.compMat.dispose(); this.halfRT.dispose(); }
}

// ═════════════ Targeting pod video (sensors.js) ═════════════
// While the pod's video is up (game.sensorView) the scene becomes sensor video, in scene-linear light before
// bloom and the output pass: TV is the CCD's monochrome with its gain pulling a dim scene up (noise and all);
// white-hot / black-hot is a FLIR's picture: the scene's brightness about the frame's own mean (a two-pass
// reduction: the FLIR's automatic gain), vegetation cooler, water at its own temperature, the sky and clouds
// cold, and the heat of what sensors.js hands over (engines, exhaust, bodies, fires: spheres standing on the
// ground plane, found by rebuilding world positions from depth). Saturated white-hot spots bloom through the
// bloom pass that follows. Grain, fixed-pattern column noise. Each grey is written as the scene-linear value the
// output pass's ACES curve turns into the wanted display grey.
export const SENSOR_SPOTS = 24;
// the scene's haze (world.js FOG_GLSL: an exponential height layer plus low mist, and the fade at the edge of the
// streamed terrain), so the FLIR can see through most of it: the eye's haze is bright, the FLIR's a thin grey veil
const SENSOR_FOG_GLSL = /* glsl */`
    uniform vec4 fogA, fogD;
    uniform vec3 fogCol, camPos;
    uniform mat4 camWorld;
    float fogLayer(float dens, float k, float y0, float y1, float L) {
        float e0 = exp(-k * max(y0, 0.0)), e1 = exp(-k * max(y1, 0.0));
        float dk = k * (y1 - y0);
        return dens * L * (abs(dk) > 1e-4 ? (e0 - e1) / dk : e0);
    }
    float fogAmount(vec3 ray) {
        float L = length(ray);
        float tau = fogLayer(fogA.x, fogA.y, camPos.y, camPos.y + ray.y, L) + fogLayer(fogD.x, fogD.y, camPos.y, camPos.y + ray.y, L);
        return max(1.0 - exp(-tau * tau), smoothstep(fogA.z, fogA.w, length(ray.xz)));
    }
    // the colour before the haze was laid over it
    vec3 defog(vec3 c, float f) { return max((c - fogCol * f) / max(1.0 - f, 0.06), vec3(0.0)); }
    // the cloud layer over the scene (clouds.js composites its premultiplied history with (1, 1 − a) blending,
    // depth-tested against the cloud's entry distance): the cloud here, or none when it's behind what's in view
    uniform sampler2D tCloud, tCloudInfo;
    uniform vec2 cloudRes, cloudJitter;
    uniform float cloudOn;
    vec4 cloudAt(vec2 uv, float sceneDist) {
        if (cloudOn < 0.5) return vec4(0.0);
        vec4 cl = texture2D(tCloud, uv);
        if (cl.a < 0.002) return vec4(0.0);
        // the entry of the four march texels around (as the composite takes them: the ones with cloud; none: far)
        vec2 st = uv * cloudRes - 0.5 - cloudJitter;
        ivec2 i0 = ivec2(floor(st)), mx = ivec2(cloudRes) - 1;
        float entry = 30000.0;
        for (int k = 0; k < 4; k++) {
            float e = texelFetch(tCloudInfo, clamp(i0 + ivec2(k & 1, k >> 1), ivec2(0), mx), 0).x;
            if (e < 59000.0) entry = min(entry, e);
        }
        return entry > sceneDist * 1.03 + 40.0 ? vec4(0.0) : cl;
    }
`;
const SENSOR_STATS_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    ${SENSOR_FOG_GLSL}
    uniform sampler2D tColor;
    varying vec2 vUv;
    // 16×16 cells, 4×4 samples each: sums of log luminance (haze taken off), its square, the count and the plain
    // luminance
    void main() {
        vec2 cell = floor(gl_FragCoord.xy) / 16.0;
        vec4 acc = vec4(0.0);
        for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
            vec2 uv = cell + (vec2(float(i), float(j)) + 0.5) / 64.0;
            float d = texture2D(tDepth, uv).x;
            if (isSky(d)) continue;
            vec3 c = texture2D(tColor, uv).rgb;
            float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
            vec3 P = (camWorld * vec4(viewPos(uv, linDepth(d)), 1.0)).xyz;
            vec4 cl = cloudAt(uv, length(P - camPos));
            if (cl.a > 0.5) continue; // (the gain follows the ground, not the clouds)
            c = max((c - cl.rgb) / max(1.0 - cl.a, 0.05), vec3(0.0));
            float ll = log(max(dot(defog(c, fogAmount(P - camPos)), vec3(0.2126, 0.7152, 0.0722)), 1e-5));
            acc += vec4(ll, ll * ll, 1.0, l);
        }
        gl_FragColor = acc;
    }`;
const SENSOR_REDUCE_FRAG = /* glsl */`
    uniform sampler2D tCells, tPrev;
    uniform float blend;
    varying vec2 vUv;
    // mean log luminance, its spread, the mean luminance: eased in over time like a camera's gain
    void main() {
        vec4 a = vec4(0.0);
        for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++) a += texelFetch(tCells, ivec2(i, j), 0);
        vec3 cur = vec3(-2.3, 0.6, 0.1);
        if (a.z > 0.5) { float m = a.x / a.z; cur = vec3(m, sqrt(max(a.y / a.z - m * m, 0.0)), a.w / a.z); }
        vec3 prev = texelFetch(tPrev, ivec2(0), 0).rgb;
        gl_FragColor = vec4(mix(prev, cur, blend), 1.0);
    }`;
const SENSOR_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    ${SENSOR_FOG_GLSL}
    #define NSPOT ${SENSOR_SPOTS}
    uniform sampler2D tColor, tStats;
    uniform float mode, time, grain, expo, nightK, masked, seaBand;
    uniform int nSpots;
    uniform vec4 spotA[NSPOT], spotB[NSPOT], spotE[NSPOT];
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    // display grey (sRGB) → the scene-linear grey three's ACES curve maps to it
    float fromDisplay(float y) {
        y = clamp(y, 0.0, 0.985);
        float L = y <= 0.04045 ? y / 12.92 : pow((y + 0.055) / 1.055, 2.4);
        float A = 1.0 - 0.983729 * L, B = 0.0245786 - 0.4329510 * L, C = -(0.000090537 + 0.238081 * L);
        return (-B + sqrt(B * B - 4.0 * A * C)) / (2.0 * A) * 0.6 / expo;
    }
    void main() {
        vec3 c = texture2D(tColor, vUv).rgb;
        vec3 st = texelFetch(tStats, ivec2(0), 0).rgb;
        float lum = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
        vec2 px = gl_FragCoord.xy;
        float n = hash(px * 0.73 + fract(time * 7.13) * 97.3) - 0.5;
        if (mode > 1.5) {
            // TV: the CCD in monochrome; its gain lifts a dim scene (and its noise)
            float gain = clamp(0.16 / max(st.b, 1e-4), 0.7, 6.0);
            float g = lum * gain * (1.0 + n * grain * (0.5 + gain * 0.5) * 3.0);
            g = mix(g, 0.18, masked * 0.9);
            gl_FragColor = vec4(vec3(g), 1.0);
            return;
        }
        float d = texture2D(tDepth, vUv).x;
        vec3 ray = normalize(mat3(camWorld) * viewPos(vUv, 1.0));
        float t, eng = 0.0;
        bool sky = isSky(d);
        vec3 P = sky ? camPos + ray * 1e5 : (camWorld * vec4(viewPos(vUv, linDepth(d)), 1.0)).xyz;
        // the cloud in front, and the scene behind it
        vec4 cl = cloudAt(vUv, sky ? 1e9 : length(P - camPos));
        c = max((c - cl.rgb) / max(1.0 - cl.a, 0.05), vec3(0.0));
        if (sky) t = mix(0.26, 0.05, smoothstep(-0.03, 0.3, ray.y));
        else {
            float f = fogAmount(P - camPos);
            vec3 c0 = defog(c, f);
            float lum0 = max(dot(c0, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
            // apparent temperature: brightness about the frame's own mean (the FLIR's automatic gain); what only
            // shines (lamps, bright paint) doesn't saturate the picture — heat does, below
            float rel = (log(lum0) - st.r) / max(st.g, 0.3);
            // (at night the land has given its heat back: a flatter background, and what's running stands out)
            t = min(0.5 + 0.17 * rel * mix(1.0, 0.55, nightK), 0.96);
            float hi0 = max(c0.r, max(c0.g, c0.b)), sat0 = (hi0 - min(c0.r, min(c0.g, c0.b))) / max(hi0, 1e-5);
            // vegetation evaporates (cooler); dark bare surfaces (asphalt, rock) soak up the sun (warmer: a runway
            // shows light by day); water sits at its own temperature (cooler than the land by day, warmer at night)
            float veg = clamp((c0.g - max(c0.r, c0.b)) / lum0 * 2.5, 0.0, 1.0);
            t -= veg * mix(0.09, 0.04, nightK);
            float bare = (1.0 - smoothstep(0.06, 0.2, sat0)) * (1.0 - veg) * smoothstep(0.3, -1.2, rel);
            t = mix(t, 0.64, bare * mix(0.85, 0.3, nightK));
            float water = (1.0 - smoothstep(seaBand * 0.35, seaBand, abs(P.y))) * clamp((c0.b - c0.r) / lum0 * 2.0, 0.0, 1.0);
            t = mix(t, mix(0.3, 0.6, nightK), water);
            // heat: the spheres sensors.js hands over (what stands above their ground plane, shaded by the object's
            // own light and dark), the ground right under them a little, their engine / exhaust / fire a lot
            float body = 0.0;
            for (int i = 0; i < NSPOT; i++) {
                if (i >= nSpots) break;
                vec4 a = spotA[i];
                vec3 dp = P - a.xyz;
                float r2 = dot(dp, dp);
                if (r2 > a.w * a.w) continue;
                vec4 b = spotB[i];
                vec3 nrm = vec3(b.z, sqrt(max(1.0 - b.z * b.z - b.w * b.w, 0.0)), b.w);
                float hgt = dot(P - vec3(a.x, b.y, a.z), nrm);
                float rr = sqrt(r2) / a.w;
                float on = smoothstep(0.08, 0.4, hgt) * (1.0 - smoothstep(0.65, 1.0, rr));
                float pad = (1.0 - smoothstep(0.0, 0.6, hgt)) * (1.0 - smoothstep(0.2, 0.7, rr)) * 0.25;
                vec4 e = spotE[i];
                body += b.x * max(on, pad);
                eng += e.w * (1.0 - smoothstep(0.0, min(a.w * 0.3, 3.5), length(P - e.xyz))) * smoothstep(0.02, 0.25, hgt);
            }
            t += body * clamp(0.6 + rel * 0.35, 0.3, 1.1) + eng;
            // the FLIR's own haze: a thin grey veil where the eye's is thick
            t = mix(t, 0.46, f * 0.55);
        }
        // clouds are cold (a little texture from their own light and shade)
        if (cl.a > 0.002) {
            float cr = log(max(dot(cl.rgb / cl.a, vec3(0.2126, 0.7152, 0.0722)), 1e-4)) - st.r;
            t = mix(t, mix(0.2, 0.34, nightK) + 0.05 * clamp(cr, -1.5, 1.5), min(cl.a * 1.15, 1.0));
        }
        // sensor noise: temporal grain and the fixed pattern of the detector's columns
        t += n * grain + (hash(vec2(floor(px.x * 0.5), 3.7)) - 0.5) * 0.016;
        float y = mode < 0.5 ? t : 1.0 - t;
        // masked: the airframe's warm skin smeared across the view
        y = mix(y, mode < 0.5 ? 0.62 - 0.12 * vUv.y : 0.38 + 0.12 * vUv.y, masked * 0.92);
        float g = fromDisplay(y);
        // engines, exhaust and fires saturate white-hot and are pushed past the bloom's threshold (PostFX raises it
        // while the FLIR is up): they bloom a little, like a detector overloading
        if (mode < 0.5 && eng > 0.2 && t > 1.0) g *= 1.0 + min(t - 1.0, 0.4) * 3.0 * (1.0 - masked);
        gl_FragColor = vec4(vec3(g), 1.0);
    }`;

export class SensorPass extends Pass {
    constructor(scenePass, camera, renderer) {
        super();
        this.scenePass = scenePass;
        this.camera = camera;
        this.renderer = renderer;
        this.needsSwap = true;
        this.enabled = false;
        const tiny = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
        this.cellsRT = tiny(16, 16);
        this.statRT = [tiny(1, 1), tiny(1, 1)];
        this.statIdx = 0;
        // (the haze and cloud uniforms are shared: one update serves both materials)
        this.noCloud = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
        this.noCloud.needsUpdate = true;
        const fog = {
            fogA: { value: new THREE.Vector4() }, fogD: { value: new THREE.Vector4() }, fogCol: { value: new THREE.Color() }, camPos: { value: new THREE.Vector3() }, camWorld: { value: new THREE.Matrix4() },
            tCloud: { value: this.noCloud }, tCloudInfo: { value: this.noCloud }, cloudRes: { value: new THREE.Vector2(1, 1) }, cloudJitter: { value: new THREE.Vector2() }, cloudOn: { value: 0 },
        };
        this.statsMat = fxMaterial(SENSOR_STATS_FRAG, { ...depthUniforms(), ...fog, tColor: { value: null } });
        this.reduceMat = fxMaterial(SENSOR_REDUCE_FRAG, { tCells: { value: this.cellsRT.texture }, tPrev: { value: null }, blend: { value: 1 } });
        const vec4s = () => Array.from({ length: SENSOR_SPOTS }, () => new THREE.Vector4());
        this.mat = fxMaterial(SENSOR_FRAG, {
            ...depthUniforms(), ...fog, tColor: { value: null }, tStats: { value: null }, mode: { value: 0 }, time: { value: 0 }, grain: { value: 0.02 },
            expo: { value: 1 }, nightK: { value: 0 }, masked: { value: 0 }, seaBand: { value: 1.2 },
            nSpots: { value: 0 }, spotA: { value: vec4s() }, spotB: { value: vec4s() }, spotE: { value: vec4s() },
        });
        this.fog = fog;
        this.quad = new FullScreenQuad(null);
        this.time = 0;
        this.fresh = true;
        this.view = null;
    }

    // sv: game.sensorView (sensors.js): mode 0 white-hot, 1 black-hot, 2 TV; grain; night; masked; the heat spots
    configure(sv, dt, world) {
        const u = this.mat.uniforms;
        if (!this.enabled) this.fresh = true;
        this.view = sv;
        this.time += dt;
        u.mode.value = sv.mode; u.grain.value = sv.grain; u.nightK.value = sv.night; u.masked.value = sv.masked;
        u.seaBand.value = Math.max(1.2, WATER.maxCrest); // how far the waves reach above and below sea level
        u.time.value = this.time;
        u.expo.value = this.renderer.toneMappingExposure;
        const f = this.fog;
        f.fogA.value.fromArray(SKY_FOG.a); f.fogD.value.fromArray(SKY_FOG.d);
        if (world && world.scene && world.scene.fog) f.fogCol.value.copy(world.scene.fog.color);
        this.clouds = world ? world.clouds : null;
        const n = Math.min(sv.nSpots, SENSOR_SPOTS);
        u.nSpots.value = n;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            u.spotA.value[i].fromArray(sv.spotA, o); u.spotB.value[i].fromArray(sv.spotB, o); u.spotE.value[i].fromArray(sv.spotE, o);
        }
        // the gain settles over about half a second (at once when the video comes up)
        this.reduceMat.uniforms.blend.value = this.fresh ? 1 : 1 - Math.exp(-dt * 3);
        this.fresh = false;
    }

    render(renderer, writeBuffer, readBuffer) {
        const src = this.scenePass.output || readBuffer;
        const depth = src.depthTexture, cam = this.camera, f = this.fog;
        f.camWorld.value.copy(cam.matrixWorld);
        f.camPos.value.setFromMatrixPosition(cam.matrixWorld);
        // the cloud layer as this frame's scene pass composited it
        const cl = this.clouds, cu = cl && cl.ready && cl.enabled && cl.mesh && cl.mesh.visible && cl.compMat ? cl.compMat.uniforms : null;
        f.cloudOn.value = cu ? 1 : 0;
        f.tCloud.value = cu ? cu.tCloud.value : this.noCloud;
        f.tCloudInfo.value = cu ? cu.tInfo.value : this.noCloud;
        if (cu) { f.cloudRes.value.copy(cu.lowRes.value); f.cloudJitter.value.copy(cu.jitter.value); }
        // automatic gain: 16×16 cells → one texel, eased against last frame's
        const su = this.statsMat.uniforms;
        su.tColor.value = readBuffer.texture;
        setDepthUniforms(su, cam, depth, src.samples);
        this.quad.material = this.statsMat;
        renderer.setRenderTarget(this.cellsRT);
        this.quad.render(renderer);
        const prev = this.statRT[this.statIdx];
        this.statIdx ^= 1;
        this.reduceMat.uniforms.tPrev.value = prev.texture;
        this.quad.material = this.reduceMat;
        renderer.setRenderTarget(this.statRT[this.statIdx]);
        this.quad.render(renderer);
        // the picture
        const u = this.mat.uniforms;
        u.tColor.value = readBuffer.texture;
        u.tStats.value = this.statRT[this.statIdx].texture;
        setDepthUniforms(u, cam, depth, src.samples);
        this.quad.material = this.mat;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.cellsRT.dispose(); for (const r of this.statRT) r.dispose();
        this.statsMat.dispose(); this.reduceMat.dispose(); this.mat.dispose(); this.noCloud.dispose();
    }
}

// ═════════════ Tone mapping + FXAA in one pass ═════════════
// Replaces the composer's OutputPass: FXAA (the Catlike Coding variant that three's FXAAShader uses)
// whose texture fetch tone-maps and sRGB-encodes each sample, so the edge search runs on final LDR
// values without an extra full-screen pass. The 5-tap contrast test comes first, so flat pixels (most
// of the frame) cost one pass of 5 fetches; only edges fetch the diagonals and walk the edge.
// One pass instead of SMAA's three, and it works at every pixel ratio.
const OUTPUT_AA_FRAG = /* glsl */`
    #include <tonemapping_pars_fragment>
    // (colorspace_pars_fragment is already in three's ShaderMaterial prefix)
    uniform sampler2D tDiffuse;
    uniform vec2 resolution; // 1 / size
    uniform float subpixel, aaOn;
    varying vec2 vUv;
    vec3 toDisplay(vec3 c) {
        #ifdef LINEAR_TONE_MAPPING
        c = LinearToneMapping(c);
        #elif defined(REINHARD_TONE_MAPPING)
        c = ReinhardToneMapping(c);
        #elif defined(CINEON_TONE_MAPPING)
        c = CineonToneMapping(c);
        #elif defined(ACES_FILMIC_TONE_MAPPING)
        c = ACESFilmicToneMapping(c);
        #elif defined(AGX_TONE_MAPPING)
        c = AgXToneMapping(c);
        #elif defined(NEUTRAL_TONE_MAPPING)
        c = NeutralToneMapping(c);
        #endif
        #ifdef SRGB_TRANSFER
        c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
        #endif
        return c;
    }
    vec3 tap(vec2 uv) { return toDisplay(texture2D(tDiffuse, uv).rgb); }
    // edge detection only needs a perceptual luma: tone-map the luminance alone (a scalar curve, not the
    // full colour transform per tap), then a gamma-ish sqrt
    float lumaHDR(vec3 c) {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * toneMappingExposure;
        return sqrt(l * (2.51 * l + 0.03) / (l * (2.43 * l + 0.59) + 0.14)); // Narkowicz ACES fit
    }
    float lumaAt(vec2 uv) { return lumaHDR(texture2D(tDiffuse, uv).rgb); }
    const float STEPS[6] = float[6](1.0, 1.5, 2.0, 2.0, 2.0, 4.0);
    void main() {
        vec3 hm = texture2D(tDiffuse, vUv).rgb;
        if (aaOn < 0.5) { gl_FragColor = vec4(toDisplay(hm), 1.0); return; }
        vec2 px = resolution;
        float m = lumaHDR(hm);
        float n = lumaAt(vUv + vec2(0.0, px.y)), s = lumaAt(vUv - vec2(0.0, px.y));
        float e = lumaAt(vUv + vec2(px.x, 0.0)), w = lumaAt(vUv - vec2(px.x, 0.0));
        float hi = max(max(max(max(n, e), s), w), m), lo = min(min(min(min(n, e), s), w), m);
        float contrast = hi - lo;
        if (contrast < max(0.0312, 0.063 * hi)) { gl_FragColor = vec4(toDisplay(hm), 1.0); return; }
        float ne = lumaAt(vUv + px), nw = lumaAt(vUv + vec2(-px.x, px.y));
        float se = lumaAt(vUv + vec2(px.x, -px.y)), sw = lumaAt(vUv - px);
        // sub-pixel blend factor
        float f = (2.0 * (n + e + s + w) + ne + nw + se + sw) / 12.0;
        f = clamp(abs(f - m) / contrast, 0.0, 1.0);
        f = smoothstep(0.0, 1.0, f);
        float pixelBlend = f * f * subpixel;
        // edge orientation and which side the edge is on
        float horizontal = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
        float vertical = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
        bool isH = horizontal >= vertical;
        float pL = isH ? n : e, nL = isH ? s : w;
        float pG = abs(pL - m), nG = abs(nL - m);
        float stepLen = isH ? px.y : px.x;
        float opposite = pL, gradient = pG;
        if (pG < nG) { stepLen = -stepLen; opposite = nL; gradient = nG; }
        // walk along the edge both ways until its luminance changes
        vec2 uvEdge = vUv;
        vec2 edgeStep;
        if (isH) { uvEdge.y += stepLen * 0.5; edgeStep = vec2(px.x, 0.0); }
        else { uvEdge.x += stepLen * 0.5; edgeStep = vec2(0.0, px.y); }
        float edgeL = (m + opposite) * 0.5, gThresh = gradient * 0.25;
        vec2 puv = uvEdge + edgeStep * STEPS[0];
        float pD = lumaAt(puv) - edgeL;
        bool pEnd = abs(pD) >= gThresh;
        for (int i = 1; i < 6 && !pEnd; i++) { puv += edgeStep * STEPS[i]; pD = lumaAt(puv) - edgeL; pEnd = abs(pD) >= gThresh; }
        if (!pEnd) puv += edgeStep * 8.0;
        vec2 nuv = uvEdge - edgeStep * STEPS[0];
        float nD = lumaAt(nuv) - edgeL;
        bool nEnd = abs(nD) >= gThresh;
        for (int i = 1; i < 6 && !nEnd; i++) { nuv -= edgeStep * STEPS[i]; nD = lumaAt(nuv) - edgeL; nEnd = abs(nD) >= gThresh; }
        if (!nEnd) nuv -= edgeStep * 8.0;
        float pDist = isH ? puv.x - vUv.x : puv.y - vUv.y;
        float nDist = isH ? vUv.x - nuv.x : vUv.y - nuv.y;
        bool deltaSign = pDist <= nDist ? pD >= 0.0 : nD >= 0.0;
        float edgeBlend = deltaSign == (m - edgeL >= 0.0) ? 0.0 : 0.5 - min(pDist, nDist) / (pDist + nDist);
        float blend = max(pixelBlend, edgeBlend);
        vec2 uv = vUv;
        if (isH) uv.y += stepLen * blend; else uv.x += stepLen * blend;
        gl_FragColor = vec4(tap(uv), 1.0);
    }`;

export class OutputAAPass extends OutputPass {
    constructor() {
        super();
        this.uniforms = {
            tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, resolution: { value: new THREE.Vector2() },
            subpixel: { value: 0.75 }, aaOn: { value: 1 },
        };
        this.material.dispose();
        this.material = new THREE.ShaderMaterial({
            name: 'OutputFXAA', uniforms: this.uniforms, vertexShader: VERT, fragmentShader: OUTPUT_AA_FRAG,
            depthTest: false, depthWrite: false, toneMapped: false,
        });
        this._fsQuad.material = this.material;
    }
    setSize(w, h) { this.uniforms.resolution.value.set(1 / w, 1 / h); }
}

// ═════════════ GPU frame timer ═════════════
class GpuTimer {
    constructor(gl) {
        this.gl = gl;
        this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        this.pool = []; this.inflight = []; this.active = null;
        this.enabled = !!this.ext;
    }
    begin() {
        if (!this.enabled || this.active || this.inflight.length > 6) return;
        const gl = this.gl;
        this.active = this.pool.pop() || gl.createQuery();
        gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
    }
    end() {
        if (!this.active) return;
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
        this.inflight.push(this.active);
        this.active = null;
    }
    // newest finished result in ms (or -1)
    poll() {
        const gl = this.gl;
        let ms = -1;
        while (this.inflight.length) {
            const q = this.inflight[0];
            if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
            const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
            const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
            this.inflight.shift();
            this.pool.push(q);
            if (!disjoint) ms = ns / 1e6;
        }
        return ms;
    }
}

// ═════════════ Adaptive resolution ═════════════
// Steps the pixel ratio through `levels` (high → low) to hold 60 fps. The frame interval decides (it's
// what the player sees); the GPU time of the composer frame (timer queries, when available) says whether
// the GPU is the bottleneck and predicts, by pixel count, whether the next level up fits. Timer queries
// can read high under load (ANGLE/Metal measures command buffers), so they never force a step down on
// their own. Hysteresis: a step down needs 0.5 s of late frames; a step up needs `upHold` s of on-time
// frames (3× longer as a blind probe); an up-step undone within 5 s doubles `upHold` (up to 60 s).
export class DynamicResolution {
    constructor(apply) {
        this.apply = apply;
        this.levels = [1];
        this.i = 0;
        this.enabled = true;
        this.budget = 1000 / 60;
        this.gpuEma = -1; this.frameEma = -1;
        this.overT = 0; this.underT = 0;
        this.sinceChange = 0; this.lastUpAt = -1e9; this.upHold = 3; this.lastFailAt = -1e9;
        this.t = 0;
        this.frozen = false;
        this.warm = 0;
        this.history = [];
    }
    configure(levels, startIndex, enabled) {
        this.levels = levels;
        this.enabled = enabled;
        this.i = Math.min(startIndex, levels.length - 1);
        this.reset();
        this.warm = 2; // ignore the first seconds: shader compiles and texture uploads
        this.timerRight = 0; this.blindProbe = false; this.upHold = 3; this.lastFailAt = -1e9;
        this.history.push({ t: +this.t.toFixed(1), pr: this.levels[this.i], why: 'configure' });
        this.apply(this.levels[this.i]);
    }
    get pixelRatio() { return this.levels[this.i]; }
    reset() { this.gpuEma = -1; this.frameEma = -1; this.overT = 0; this.underT = 0; this.sinceChange = 0; }
    setLevel(i, why) {
        i = Math.max(0, Math.min(this.levels.length - 1, i));
        if (i === this.i) return;
        if (i < this.i) this.lastUpAt = this.t;
        else if (this.t - this.lastUpAt < 5) { // that up-step didn't hold
            this.upHold = Math.min(this.upHold * 2, 60);
            this.lastFailAt = this.t;
            if (this.blindProbe && this.gpuEma >= 0) this.timerRight++; // the GPU timer had said it wouldn't fit
        }
        this.history.push({ t: +this.t.toFixed(1), pr: this.levels[i], why });
        if (this.history.length > 20) this.history.shift();
        this.i = i;
        this.reset();
        this.apply(this.levels[i]);
    }
    // dt: seconds since the last frame (wall clock); gpuMs: GPU time of the last finished frame or -1
    update(dt, gpuMs) {
        this.t += dt;
        if (!this.enabled || this.frozen || this.levels.length < 2) return;
        if (this.warm > 0) { this.warm -= dt; return; }
        this.sinceChange += dt;
        const B = this.budget;
        const frameMs = Math.min(dt * 1000, B * 4);
        this.frameEma = this.frameEma < 0 ? frameMs : this.frameEma + (frameMs - this.frameEma) * 0.08;
        if (gpuMs >= 0) { gpuMs = Math.min(gpuMs, B * 3); this.gpuEma = this.gpuEma < 0 ? gpuMs : this.gpuEma + (gpuMs - this.gpuEma) * 0.1; }
        if (this.sinceChange < 0.8) return; // let the new resolution settle (and the EMAs refill)
        const cur = this.levels[this.i], last = this.levels.length - 1;
        // (levels run high → low: index up = lower resolution)
        // Down: frames clearly late (under ~54 fps) and the GPU is the likely culprit (busy most of the frame,
        // or no timer to ask) — lowering the resolution doesn't help a CPU-bound frame.
        const late = this.frameEma > B * 1.12;
        const gpuBound = this.gpuEma < 0 || this.gpuEma > B * 0.75;
        if (late && gpuBound) this.overT += dt; else this.overT = Math.max(0, this.overT - dt);
        // (a probe that doesn't hold falls back twice as fast)
        if (this.overT > (this.t - this.lastUpAt < 5 ? 0.25 : 0.5) && this.i < last) {
            // one level at a time (two when far behind): the GPU timer can read high under load, so it
            // doesn't size the jump
            this.setLevel(Math.min(last, this.i + (this.frameEma > B * 2.2 ? 2 : 1)), 'frame ' + this.frameEma.toFixed(1) + 'ms gpu ' + this.gpuEma.toFixed(1) + 'ms');
            return;
        }
        // Up: holding the frame rate; straight away if the GPU time says the next level fits, otherwise
        // (no timer, or it reads high) only as an occasional probe
        const up = this.i > 0 ? this.levels[this.i - 1] : 0;
        if (up && this.frameEma < B * 1.05) this.underT += dt; else this.underT = 0;
        const fits = this.gpuEma >= 0 && this.gpuEma * (up / cur) ** 2 < B * 0.8;
        // (blind probes stop once the timer has twice been proven right)
        const blindOk = this.gpuEma < 0 || this.timerRight < 2;
        if (up && (fits || blindOk) && this.underT > (fits ? this.upHold : this.upHold * 3 + 10)) {
            this.blindProbe = !fits;
            this.setLevel(this.i - 1, fits ? 'headroom ' + this.gpuEma.toFixed(1) + 'ms' : 'probe');
        }
        // five minutes without a failed up-step: be braver again
        if (this.t - this.lastFailAt > 300 && this.upHold > 3) { this.upHold = Math.max(3, this.upHold * 0.5); this.lastFailAt = this.t; }
    }
}

// ═════════════ PostFX: owns the passes and wires them into the composer ═════════════
const _q1 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class PostFX {
    // composer passes on entry: [scenePass, cockpitPass, bloom, OutputPass, grade]
    // afterwards: [scenePass, sceneFX, dof, sensor, cockpitPass, bloom, OutputPass (off), OutputAAPass, grade]
    constructor({ renderer, composer, camera, scenePass, cockpitPass }) {
        this.renderer = renderer;
        this.composer = composer;
        this.camera = camera;
        this.scenePass = scenePass;
        this.sceneFX = new SceneFXPass(scenePass, camera);
        this.dof = new DofPass(scenePass, camera);
        const at = composer.passes.indexOf(cockpitPass);
        composer.insertPass(this.dof, at);
        composer.insertPass(this.sceneFX, at);
        // the targeting pod's video (sensors.js): after the scene effects, before bloom (which it retunes while the
        // FLIR is up: only saturated hot spots bloom)
        this.sensor = new SensorPass(scenePass, camera, renderer);
        composer.insertPass(this.sensor, composer.passes.indexOf(cockpitPass));
        this.bloom = composer.passes.find(p => p.threshold !== undefined && p.strength !== undefined && p.radius !== undefined) || null;
        this.bloomSaved = null;
        // tone mapping + FXAA in one pass, in place of the plain OutputPass
        this.output = composer.passes.find(p => p.isOutputPass) || null;
        this.outputAA = new OutputAAPass();
        if (this.output) {
            composer.insertPass(this.outputAA, composer.passes.indexOf(this.output) + 1);
            this.output.enabled = false;
        } else composer.addPass(this.outputAA);
        this.timer = new GpuTimer(renderer.getContext());
        this.dyn = new DynamicResolution((pr) => this.applyPixelRatio(pr));
        this.quality = 'high';
        this.q = QUALITY.high;
        this.settings = {};
        this.prevView = new THREE.Matrix4();
        this.prevProj = new THREE.Matrix4();
        this.prevPos = new THREE.Vector3();
        this.hasPrev = false;
        this.lastT = -1;
        this.photoPr = false;
        this.stats = { gpuMs: -1, pr: 1 };
        this.dpr = window.devicePixelRatio || 1;
    }

    applyPixelRatio(pr) {
        this.stats.pr = pr;
        if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
        this.composer.setPixelRatio(pr);
    }

    // quality: 'low' | 'medium' | 'high' | 'ultra'; settings: { motionBlur, dynRes }
    setQuality(quality, settings = {}) {
        this.quality = QUALITY[quality] ? quality : 'high';
        const q = this.q = QUALITY[this.quality];
        this.settings = settings;
        const dpr = this.dpr = window.devicePixelRatio || 1;
        const dynamic = settings.dynRes !== false;
        const top = Math.min(dpr, dynamic ? q.top : q.pr);
        const levels = dynamic ? STEPS.map(f => +(top * f).toFixed(3)).filter(pr => pr >= Math.min(q.floor, top) - 1e-6) : [top];
        // start where today's fixed setting would be
        let start = 0;
        while (start < levels.length - 1 && levels[start] > Math.min(dpr, q.pr) + 1e-6) start++;
        this.sceneFX.configure({ ao: q.ao, ssr: q.ssr, flare: q.flare, blur: q.blur, level: this.quality });
        this.dof.setTaps(Math.max(16, q.dof));
        this.scenePass.samples = q.msaa;
        if (!q.msaa && !this.sceneFX.ao && !q.ssr && !q.flare && !q.blur && !q.dof) this.scenePass.releaseTarget();
        // with 4× MSAA the geometry edges are clean: FXAA only softly mops up alpha-tested foliage
        this.outputAA.uniforms.subpixel.value = q.msaa ? 0.35 : 0.75;
        this.dyn.configure(levels, start, dynamic);
        this.hasPrev = false;
    }

    // per frame, instead of composer.render(dt)
    render(dt, game) {
        if ((window.devicePixelRatio || 1) !== this.dpr) this.setQuality(this.quality, this.settings); // moved to another screen
        const now = performance.now();
        const wall = this.lastT < 0 ? dt : (now - this.lastT) / 1000;
        this.lastT = now;
        const gpu = this.timer.poll();
        if (gpu >= 0) this.stats.gpuMs = gpu;
        const photo = !!(game && game.photo);
        // photo mode: the world is frozen, so render stills at the top resolution and don't adapt
        if (photo !== this.photoPr) {
            this.photoPr = photo;
            this.dyn.frozen = photo;
            this.applyPixelRatio(photo ? this.dyn.levels[0] : this.dyn.pixelRatio);
            this.dyn.reset();
        }
        this.dyn.update(Math.min(wall, 0.25), gpu);
        this.updateEffects(dt, game, photo);
        this.timer.begin();
        this.composer.render(dt);
        this.timer.end();
    }

    updateEffects(dt, game, photo) {
        const q = this.q, cam = this.camera, fx = this.sceneFX;
        const world = game && game.world;
        const playing = !!game && (game.state === 'playing' || game.state === 'dead');
        fx.time += dt;
        cam.updateMatrixWorld();
        if (world) {
            fx.fogDensity = world.scene.fog ? world.scene.fog.density : 0;
            fx.groundDist = cam.position.y - Math.max(terrainHeight(cam.position.x, cam.position.z), 0);
            if (world.sunDir) fx.sunDirW.copy(world.sunDir);
            this.updateSun(world, cam);
            // contact shadows follow the sun (or the moon) while it lights the world
            if (world.sunDir) fx.sunDirW.copy(world.sunDir);
            fx.sunUp = !!(world.sun && world.sun.intensity > 0.05);
        } else { fx.groundDist = 1e9; fx.sun.on = 0; }

        // the targeting pod's video, while it's up (the FLIR's hot spots bloom a little; the rest doesn't)
        const sv = !photo && game && game.sensorView;
        if (sv) this.sensor.configure(sv, dt, world);
        this.sensor.enabled = !!sv;
        const b = this.bloom, flir = !!sv && sv.mode !== 2;
        if (b && flir && !this.bloomSaved) { this.bloomSaved = { threshold: b.threshold, strength: b.strength, radius: b.radius }; b.threshold = 5.4; b.strength = 0.4; b.radius = 0.05; }
        else if (b && !flir && this.bloomSaved) { Object.assign(b, this.bloomSaved); this.bloomSaved = null; }

        // depth of field: photo mode only
        this.dof.enabled = photo && q.dof > 0;
        if (this.dof.enabled) {
            const ph = game.photo;
            const f = Math.max(2, ph.dist || cam.position.distanceTo(ph.target));
            // like a real lens, background blur shrinks as the focus distance grows
            this.dof.setFocus(f, f * THREE.MathUtils.clamp(28 / f, 0.12, 1.2));
        }

        // motion blur: in flight, scaled by camera speed; never in photo mode, menus or pause
        const blurAllowed = !photo && playing && q.blur > 0 && this.settings.motionBlur !== false;
        const blurOn = blurAllowed && this.hasPrev && this.setupBlur(dt, game, cam);
        this.prevView.copy(cam.matrixWorldInverse);
        this.prevProj.copy(cam.projectionMatrix);
        this.prevPos.copy(cam.position);
        this.hasPrev = true;

        // the scene only gets its own target (a spare full-screen copy) when something reads depth
        // afterwards or it's multisampled; otherwise it renders straight into the composer's buffer
        // under water (or the near plane nearly so): the composite tints what the camera sees through the water
        fx.underwater = 0;
        const ocean = world && world.ocean;
        // inside a closed room (interiors.js: the world isn't drawn) there's no sea, no sun and no lens flare
        const walled = !!(game && game.indoors && game.indoors.sealed);
        fx.noWater = walled;
        if (walled) { fx.sun.on = 0; fx.groundDist = 1e9; } // (and no AO: its radius is made for the outdoors)
        if (ocean && !walled) {
            ocean.shareWaveUniforms(fx.compMat.uniforms);
            const cp = cam.position;
            if (cp.y < WATER.maxCrest + 2 && cp.y < waterHeight(cp.x, cp.z) + 1.5) fx.underwater = 1;
            if (fx.underwater) ocean.underwaterPalette(fx.compMat.uniforms, cp.x, cp.z);
        }
        const busy = fx.prepare(cam, blurOn);
        const own = busy || this.dof.enabled || q.msaa > 0;
        this.scenePass.ownTarget = own;
        fx.enabled = own;
    }

    // returns true when this frame should blur
    setupBlur(dt, game, cam) {
        const moved = _v1.subVectors(cam.position, this.prevPos).length();
        const speed = moved / Math.max(dt, 1e-3);
        // camera cut (respawn, view change, quick position): skip a frame
        const fwdNow = _v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
        const prevQ = _q1.setFromRotationMatrix(this.prevView).invert();
        const fwdPrev = _v2.set(0, 0, -1).applyQuaternion(prevQ);
        const turn = Math.acos(THREE.MathUtils.clamp(fwdNow.dot(fwdPrev), -1, 1));
        if (dt <= 0 || moved > Math.max(60, speed * dt * 3) || turn > 0.35) return false;
        const k = THREE.MathUtils.smoothstep(speed, 45, 230);
        if (k <= 0.01) return false;
        // shutter: half a 60 fps frame, whatever the actual frame rate
        const scale = 0.5 * k * (1 / 60) / Math.max(dt, 1 / 240);
        const h = this.sceneFX.height;
        const focal = cam.projectionMatrix.elements[5] * 0.5 * h;
        const p = game.player;
        const chase = p && !p.exploded && p.root && p.root.visible && game.cameraMode !== 'cockpit' && !game.pilotMode;
        const nearCut = chase ? cam.position.distanceTo(p.pos) + Math.max(p.spec ? p.spec.length : 15, 12) * 0.9 : 0;
        // rough upper bound of the blur in pixels: rotation everywhere, translation at the near cut
        const est = (turn * focal + moved * focal / Math.max(nearCut, 25)) * scale;
        if (est < 0.6) return false;
        const u = this.sceneFX.compMat.uniforms;
        u.blurScale.value = scale;
        u.nearCut.value = nearCut;
        // previous clip <- current view space: prevProj * prevView * currentWorld (doubles on the CPU)
        u.reproj.value.multiplyMatrices(this.prevProj, this.prevView).multiply(cam.matrixWorld);
        return true;
    }

    updateSun(world, cam) {
        const s = this.sceneFX.sun;
        s.on = 0;
        if (!this.sceneFX.flare || !world.sunDir || world.timeKey === 'night') return;
        const d = _v1.copy(world.sunDir).normalize().transformDirection(cam.matrixWorldInverse);
        if (d.z > -0.05) return; // behind the camera
        const e = cam.projectionMatrix.elements;
        const x = (d.x * e[0]) / -d.z, y = (d.y * e[5]) / -d.z;
        if (Math.abs(x) > 1.6 || Math.abs(y) > 1.6) return;
        s.uv.set(x * 0.5 + 0.5, y * 0.5 + 0.5);
        s.on = THREE.MathUtils.clamp((world.sun ? world.sun.intensity : 3) / 3.2, 0, 1);
        if (world.sun) s.color.copy(world.sun.color);
    }
}
