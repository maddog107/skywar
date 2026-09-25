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
import { terrainHeight } from './world.js';

// ── Quality presets ──
// pr: pixel ratio with adaptive resolution off (today's values); top/floor: adaptive range
// (top is capped at devicePixelRatio). msaa: scene samples. ssr: 0 off, 1 reduced, 2 full.
// blur: motion-blur taps (0 = off; ultra only, so HIGH keeps today's look and cost). dof: photo-mode taps.
export const QUALITY = {
    low: { pr: 1, top: 1, floor: 0.6, msaa: 0, ao: false, ssr: 0, flare: false, blur: 0, dof: 0 },
    medium: { pr: 1.25, top: 1.25, floor: 0.7, msaa: 0, ao: false, ssr: 0, flare: true, blur: 0, dof: 48 },
    high: { pr: 1.75, top: 2, floor: 0.85, msaa: 0, ao: false, ssr: 0, flare: true, blur: 0, dof: 72 },
    ultra: { pr: 2, top: 2, floor: 1, msaa: 4, ao: true, ssr: 2, flare: true, blur: 12, dof: 96 },
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

// ═════════════ AO (half resolution) ═════════════
// Scalable ambient obscurance (McGuire et al. 2012) on depth-reconstructed positions and normals.
// 12 spiral taps rotated by a 4×4 Bayer pattern, then a 4×4 depth-aware blur removes the pattern.
// Faded out by distance so terrain seen from altitude never darkens; the output also carries the
// linear depth (G) for the bilateral upsample in the composite.
const AO_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    uniform float radiusPerM, radiusMin, radiusMax, intensity, projScale, fadeNear, fadeFar;
    varying vec2 vUv;
    const int N = 12;
    const float TURNS = 7.0;
    const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
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
        if (isSky(d) || z > fadeFar) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
        vec3 P = viewPos(pixelUv(p, size), z);
        // normal from depth: on each axis use the neighbour on the same surface (smaller step)
        vec3 l = posAt(p - ivec2(1, 0)), r = posAt(p + ivec2(1, 0));
        vec3 b = posAt(p - ivec2(0, 1)), t = posAt(p + ivec2(0, 1));
        vec3 dx = abs(l.z - P.z) < abs(r.z - P.z) ? P - l : r - P;
        vec3 dy = abs(b.z - P.z) < abs(t.z - P.z) ? P - b : t - P;
        vec3 n = normalize(cross(dx, dy));
        // world radius grows with distance (contact shadows under hangars read at 300 m, not just 30 m)
        float radius = clamp(z * radiusPerM, radiusMin, radiusMax);
        float ssR = min(radius * projScale / z, 90.0);
        if (ssR < 1.5) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
        ivec2 q = ivec2(gl_FragCoord.xy) & 3;
        float rot = BAYER[q.y * 4 + q.x] / 16.0 * 6.2831853;
        float r2 = radius * radius, sum = 0.0;
        float bias = 0.02 + z * 4e-4; // depth-reconstruction noise and terrain facets grow with distance
        for (int i = 0; i < N; i++) {
            float a = (float(i) + 0.5) / float(N);
            float ang = a * TURNS * 6.2831853 + rot;
            vec2 off = vec2(cos(ang), sin(ang)) * ssR * a;
            vec3 Q = posAt(p + ivec2(off));
            vec3 v = Q - P;
            float vv = dot(v, v), vn = dot(v, n);
            float f = max(r2 - vv, 0.0);
            sum += f * f * f * max((vn - bias) / (0.01 * r2 + vv), 0.0);
        }
        // (× radius: SAO's vn / vv term is in 1/metres, this keeps the strength independent of the radius)
        float ao = max(0.0, 1.0 - sum * intensity * radius / (r2 * r2 * r2) * (5.0 / float(N)));
        ao = mix(ao, 1.0, smoothstep(fadeNear, fadeFar, z));
        gl_FragColor = vec4(ao, z, 0.0, 1.0);
    }`;

const AO_BLUR_FRAG = /* glsl */`
    uniform sampler2D tAO;
    varying vec2 vUv;
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        ivec2 sz = textureSize(tAO, 0) - 1;
        vec2 c = texelFetch(tAO, p, 0).xy;
        float sum = 0.0, wsum = 0.0;
        for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
            vec2 s = texelFetch(tAO, clamp(p + ivec2(x, y), ivec2(0), sz), 0).xy;
            float w = max(0.0, 1.0 - abs(s.y - c.y) / (c.y * 0.04 + 0.05));
            sum += s.x * w; wsum += w;
        }
        gl_FragColor = vec4(wsum > 0.0 ? sum / wsum : c.x, c.y, 0.0, 1.0);
    }`;

// ═════════════ Water reflections (half resolution) ═════════════
// Sea and lakes are the plane y = 0. A pixel is water when its depth-reconstructed world height is
// within a few cm of 0 (the terrain mesh leaves a gap of -1.5…+0.6 m around the waterline, runways and
// decks are metres up). The reflected ray (plane normal jiggled by a few swell waves) is marched through
// the depth buffer in view space with exponentially growing steps, then refined by bisection.
const SSR_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    uniform sampler2D tColor;
    uniform mat3 viewRot, camRot;
    uniform vec3 camPos;
    uniform vec2 proj; // projectionMatrix[0][0], [1][1]
    uniform float time, fogDensity, strength, maxDist;
    varying vec2 vUv;
    vec2 toUv(vec3 q) { return vec2(q.x * proj.x, q.y * proj.y) / -q.z * 0.5 + 0.5; }
    void main() {
        vec2 size = vec2(textureSize(tDepth, 0));
        ivec2 p = ivec2(gl_FragCoord.xy) * 2;
        vec2 uv = pixelUv(p, size);
        float d = texelFetch(tDepth, p, 0).x;
        gl_FragColor = vec4(0.0);
        if (isSky(d) || camPos.y < 0.3) return;
        float z = linDepth(d);
        vec3 P = viewPos(uv, z);
        vec3 W = camPos + camRot * P;
        if (abs(W.y) > min(0.04 + z * 1.5e-4, 0.5)) return;
        // swell: a few long waves tilt the normal a little (less with distance, where they'd alias)
        vec2 g = vec2(0.0);
        g += vec2(0.8, 0.6) * cos(dot(vec2(0.8, 0.6), W.xz) * 0.045 + time * 0.9);
        g += vec2(-0.47, 0.88) * cos(dot(vec2(-0.47, 0.88), W.xz) * 0.083 + time * 1.3) * 0.7;
        g += vec2(0.21, -0.98) * cos(dot(vec2(0.21, -0.98), W.xz) * 0.19 + time * 1.9) * 0.45;
        g += vec2(-0.93, -0.37) * cos(dot(vec2(-0.93, -0.37), W.xz) * 0.41 + time * 2.8) * 0.3;
        float amp = 0.035 * (1.0 - smoothstep(150.0, 2500.0, z));
        vec3 N = normalize(vec3(-g.x * amp, 1.0, -g.y * amp));
        vec3 V = normalize(W - camPos);
        vec3 R = reflect(V, N);
        R.y = max(R.y, 0.01);
        R = normalize(R);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
        float fog = 1.0 - exp(-pow(fogDensity * length(W - camPos), 2.0));
        float weight = F * strength * (1.0 - fog);
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
                float hz = linDepth(textureLod(tDepth, hu, 0.0).x);
                float hy = camPos.y + (camRot * viewPos(hu, hz)).y;
                if (hy > min(0.04 + hz * 1.5e-4, 0.5) + 0.05) { hitUv = hu; t = bT; break; }
            }
            tPrev = t;
            t *= grow;
        }
        if (hitUv.x < 0.0) return;
        vec2 e = smoothstep(vec2(0.0), vec2(0.07), hitUv) * smoothstep(vec2(0.0), vec2(0.07), 1.0 - hitUv);
        float conf = e.x * e.y * (1.0 - smoothstep(tMax * 0.6, tMax, t));
        vec3 c = textureLod(tColor, hitUv, 0.0).rgb;
        gl_FragColor = vec4(c, weight * conf);
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
    uniform float aoStrength, ssrOn, aoOn;
    uniform vec3 camPos, camRotY; // world y of a view-space position = camPos.y + dot(camRotY, P)
    uniform vec2 sunUv;
    uniform vec3 flareColor;
    uniform float aspect, flareOn;
    uniform mat4 reproj; // motion blur: previous projection × previous view × current camera world
    uniform float blurOn, blurScale, blurMaxPx, nearCut;
    uniform float debugView; // 1: AO, 2: water mask (blue) + reflection weight (white)
    varying vec2 vUv;

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
                float sum = 0.0, wsum = 0.0;
                for (int k = 0; k < 4; k++) {
                    ivec2 o = ivec2(k & 1, k >> 1);
                    vec2 s = texelFetch(tAO, min(h0 + o, hs), 0).xy;
                    float bw = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y) + 1e-3;
                    float w = bw / (1e-3 + abs(s.y - z) / z);
                    sum += s.x * w; wsum += w;
                }
                float ao = sum / wsum;
                c.rgb *= mix(1.0, ao, aoStrength);
                if (debugView == 1.0) dbg = vec3(mix(1.0, ao, aoStrength));
            }
            #endif
            #ifdef USE_SSR
            if (ssrOn > 0.5) {
                vec3 P = viewPos(pixelUv(pix, size), z);
                float wy = camPos.y + dot(camRotY, P);
                if (debugView == 3.0) dbg = vec3(abs(wy) * 4.0, z / 1000.0, 0.0);
                if (abs(wy) < min(0.04 + z * 1.5e-4, 0.5)) {
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
        #ifdef USE_FLARE
        if (flareOn > 0.0) {
            float vis = texture2D(tSunVis, vec2(0.5)).r * flareOn;
            if (vis > 0.001) c.rgb += flare(vUv, vis);
        }
        #endif
        if (debugView > 0.0) c.rgb = dbg.x >= 0.0 ? dbg : (debugView == 1.0 ? vec3(1.0) : c.rgb * 0.25);
        gl_FragColor = c;
    }`;

export class SceneFXPass extends Pass {
    constructor(scenePass, camera) {
        super();
        this.scenePass = scenePass;
        this.camera = camera;
        this.needsSwap = true;
        this.ao = false; this.ssr = 0; this.flare = false; this.blur = 0; // what the quality level allows
        this.aoActive = false; this.ssrActive = false; this.flareActive = false; this.blurActive = false; // this frame
        this.width = 1; this.height = 1;
        this.aoRT = halfFloatTarget(1, 1, THREE.RGFormat, THREE.NearestFilter);
        this.aoBlurRT = halfFloatTarget(1, 1, THREE.RGFormat, THREE.NearestFilter);
        this.ssrRT = halfFloatTarget(1, 1, THREE.RGBAFormat, THREE.NearestFilter);
        this.visRT = [0, 1].map(() => halfFloatTarget(1, 1, THREE.RGBAFormat, THREE.NearestFilter));
        this.visIdx = 0;
        this.aoMat = fxMaterial(AO_FRAG, {
            ...depthUniforms(), radiusPerM: { value: 0.03 }, radiusMin: { value: 2.5 }, radiusMax: { value: 8 },
            intensity: { value: 1.0 }, projScale: { value: 500 }, fadeNear: { value: 160 }, fadeFar: { value: 650 },
        });
        this.aoBlurMat = fxMaterial(AO_BLUR_FRAG, { tAO: { value: this.aoRT.texture } });
        this.ssrMat = fxMaterial(SSR_FRAG, {
            ...depthUniforms(), tColor: { value: null }, viewRot: { value: new THREE.Matrix3() }, camRot: { value: new THREE.Matrix3() },
            camPos: { value: new THREE.Vector3() }, proj: { value: new THREE.Vector2() }, time: { value: 0 }, fogDensity: { value: 0 },
            strength: { value: 1 }, maxDist: { value: 4000 },
        }, { STEPS: 24, REFINE: 5 });
        this.visMat = fxMaterial(SUNVIS_FRAG, {
            tColor: { value: null }, tPrev: { value: null }, sunUv: { value: new THREE.Vector2() }, sunRadius: { value: new THREE.Vector2() },
            threshold: { value: 5 }, blend: { value: 0.3 },
        });
        this.compMat = fxMaterial(COMPOSITE_FRAG, {
            ...depthUniforms(), tColor: { value: null }, tAO: { value: this.aoBlurRT.texture }, tSSR: { value: this.ssrRT.texture },
            tSunVis: { value: this.visRT[0].texture }, aoStrength: { value: 0.75 }, aoOn: { value: 0 }, ssrOn: { value: 0 },
            camPos: { value: new THREE.Vector3() }, camRotY: { value: new THREE.Vector3() }, sunUv: { value: new THREE.Vector2() },
            flareColor: { value: new THREE.Color() }, aspect: { value: 1 }, flareOn: { value: 0 },
            reproj: { value: new THREE.Matrix4() }, blurOn: { value: 0 }, blurScale: { value: 0 }, blurMaxPx: { value: 20 }, nearCut: { value: 0 },
            debugView: { value: 0 },
        }, { TAPS: 8 });
        this.quad = new FullScreenQuad(null);
        this.time = 0;
        this.sun = { uv: new THREE.Vector2(), on: 0, color: new THREE.Color() }; // set by PostFX each frame
        this.fogDensity = 0;
        this.groundDist = 1e9;
    }

    configure({ ao, ssr, flare, blur }) {
        this.ao = !!ao; this.ssr = ssr | 0; this.flare = !!flare; this.blur = blur | 0;
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
    prepare(cam, blurOn) {
        this.aoActive = this.ao && this.groundDist < this.aoMat.uniforms.fadeFar.value;
        this.ssrActive = this.ssr > 0 && cam.position.y > 0.3 && this.waterVisible(cam);
        this.flareActive = this.flare && this.sun.on > 0;
        this.blurActive = this.blur > 0 && blurOn;
        return this.aoActive || this.ssrActive || this.flareActive || this.blurActive;
    }

    setSize(w, h) {
        this.width = w; this.height = h;
        const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
        if (this.ao) { this.aoRT.setSize(hw, hh); this.aoBlurRT.setSize(hw, hh); }
        if (this.ssr) this.ssrRT.setSize(hw, hh);
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
            this.renderQuad(renderer, this.ssrMat, this.ssrRT);
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
        for (const rt of [this.aoRT, this.aoBlurRT, this.ssrRT, ...this.visRT]) rt.dispose();
        for (const m of [this.aoMat, this.aoBlurMat, this.ssrMat, this.visMat, this.compMat]) m.dispose();
    }
}

// ═════════════ Depth of field (photo mode) ═════════════
// Single-pass gather bokeh (after Dennis Gustafsson): golden-angle spiral, each tap weighted by
// whether its own circle of confusion reaches this pixel; background taps can't bleed over a
// sharper foreground.
const DOF_FRAG = /* glsl */`
    ${DEPTH_GLSL}
    uniform sampler2D tColor;
    uniform float focus, focusScale, maxBlur, radScale;
    varying vec2 vUv;
    float coc(float z) { return clamp((1.0 / focus - 1.0 / z) * focusScale, -1.0, 1.0) * maxBlur; }
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
        gl_FragColor = vec4(col / tot, c0.a);
    }`;

export class DofPass extends Pass {
    constructor(scenePass, camera) {
        super();
        this.scenePass = scenePass;
        this.camera = camera;
        this.mat = fxMaterial(DOF_FRAG, {
            ...depthUniforms(), tColor: { value: null }, focus: { value: 50 }, focusScale: { value: 25 },
            maxBlur: { value: 16 }, radScale: { value: 1 },
        }, { MAX_TAPS: 96 });
        this.quad = new FullScreenQuad(this.mat);
        this.enabled = false;
        this.height = 1;
        this.taps = 96;
    }
    setTaps(n) { this.taps = n; if (this.mat.defines.MAX_TAPS !== n) { this.mat.defines.MAX_TAPS = n; this.mat.needsUpdate = true; } }
    setSize(w, h) { this.height = h; }
    render(renderer, writeBuffer, readBuffer) {
        const u = this.mat.uniforms;
        u.tColor.value = readBuffer.texture;
        setDepthUniforms(u, this.camera, this.scenePass.output.depthTexture, this.scenePass.output.samples);
        const maxBlur = Math.max(4, 0.014 * this.height);
        u.maxBlur.value = maxBlur;
        // taps ≈ maxBlur² / (2 · radScale): pick the step so the spiral ends on the tap budget
        u.radScale.value = Math.max(0.5, (maxBlur * maxBlur) / (2 * this.taps));
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }
    dispose() { this.mat.dispose(); }
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
    // afterwards: [scenePass, sceneFX, dof, cockpitPass, bloom, OutputPass (off), OutputAAPass, grade]
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
        this.sceneFX.configure({ ao: q.ao, ssr: q.ssr, flare: q.flare, blur: q.blur });
        this.dof.setTaps(Math.max(16, q.dof));
        this.scenePass.samples = q.msaa;
        if (!q.msaa && !q.ao && !q.ssr && !q.flare && !q.blur && !q.dof) this.scenePass.releaseTarget();
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
            this.updateSun(world, cam);
        } else { fx.groundDist = 1e9; fx.sun.on = 0; }

        // depth of field: photo mode only
        this.dof.enabled = photo && q.dof > 0;
        if (this.dof.enabled) {
            const ph = game.photo;
            const f = Math.max(2, ph.dist || cam.position.distanceTo(ph.target));
            this.dof.mat.uniforms.focus.value = f;
            // like a real lens, background blur shrinks as the focus distance grows
            this.dof.mat.uniforms.focusScale.value = f * THREE.MathUtils.clamp(28 / f, 0.12, 1.2);
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
