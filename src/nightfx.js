// ═══════════════════════════════════════════════════════════════
// Night and weather post passes (docs/WAR.md "Night and weather"), inserted into the composer by main.js:
//   AirPass (before the cockpit is drawn):
//     • the glow of fires, motors and flares in the air round them: haze, mist, fog and rain scatter their light,
//       worst in fog (the analytic in-scatter of a point light along each pixel's view ray up to what it hits, so a
//       hill in front of a fire cuts its glow; firelight.js chooses the few brightest, weighed by the air there)
//     • rain on the canopy in the cockpit view: drops that sit and wobble when slow, streaks blown back from the
//       flight path marker when fast, each a little lens showing the view upside down; mist from flying through cloud
//   NvgPass (just before bloom): night-vision goggles — the scene's light (red / near-IR weighted, as an image
//     intensifier's photocathode sees it) amplified by an automatic gain toward a set brightness, a green P43
//     phosphor, the tube's grain (worse the harder the gain works), a soft tube resolution and the round eyepiece;
//     bright lights bloom into halos (the bloom pass is retuned while it's on)
// Both are off (no pass at all) whenever there's nothing for them to do.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { fireLights, GLOW_LIGHTS } from './firelight.js';

const VERT = /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const AIR_FRAG = /* glsl */`
    uniform sampler2D tColor, tDepth;
    uniform float cameraNear, cameraFar, hasDepth;
    uniform vec2 invProj;                 // 1 / projection[0][0], 1 / projection[1][1]
    uniform vec4 gA[${GLOW_LIGHTS}], gB[${GLOW_LIGHTS}];   // view position + extinction; colour × I + core
    uniform int gN;
    uniform float rainOn, time, aspect, speedK, wet;
    uniform vec2 flow;                    // where the airflow comes from on screen (the flight path marker), uv
    varying vec2 vUv;
    float linDepth(float d) {
        #ifdef USE_REVERSED_DEPTH_BUFFER
        return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * d + cameraNear);
        #else
        return (cameraNear * cameraFar) / (cameraFar - (cameraFar - cameraNear) * d);
        #endif
    }
    bool isSky(float d) {
        #ifdef USE_REVERSED_DEPTH_BUFFER
        return d <= 0.0;
        #else
        return d >= 1.0;
        #endif
    }
    float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
    // Henyey-Greenstein (normalised over the sphere); fog and rain scatter mostly forward
    float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

    // one layer of drops on the canopy: cells in (angle, log radius) round the airflow's centre, scrolled outward
    // with the speed (a drop blown back accelerates across the glass); returns the refraction offset and a coverage
    vec3 drops(vec2 uv, float scale, float seed, float move) {
        vec2 d = (uv - flow) * vec2(aspect, 1.0);
        float r = length(d) + 1e-4, th = atan(d.y, d.x);
        vec2 g = vec2(th * scale * 0.9, log(r) * scale * 0.5 - time * move);
        vec2 id = floor(g), f = fract(g) - 0.5;
        float h = h12(id + seed);
        if (h > wet) return vec3(0.0);
        vec2 o = (h22(id + seed * 1.7) - 0.5) * 0.45;
        float rad = mix(0.12, 0.3, h12(id + seed + 3.1));
        // blown back into a streak along the flow, sitting as a round bead when slow
        vec2 q = (f - o) / vec2(1.0, 1.0 + move * 0.35);
        float dd = length(q) / rad;
        if (dd > 1.0) return vec3(0.0);
        vec2 n = q / max(length(q), 1e-4) * sqrt(1.0 - dd * dd) * dd;
        // (the offset turned back to screen space: along the angle and the radius)
        vec2 radial = d / r, tang = vec2(-radial.y, radial.x);
        vec2 off = (tang * n.x + radial * n.y) * 0.035 / vec2(aspect, 1.0);
        return vec3(off, smoothstep(1.0, 0.8, dd));
    }

    void main() {
        vec2 uv = vUv;
        vec3 col;
        // ── rain on the canopy ──
        if (rainOn > 0.5) {
            vec3 a = drops(uv, 22.0, 1.0, speedK), b = drops(uv, 37.0, 7.3, speedK * 1.4);
            vec2 off = a.xy * a.z + b.xy * b.z;
            float cov = max(a.z, b.z);
            // each drop shows the view through it, flipped and squeezed; a thin water film softens the rest
            col = texture2D(tColor, uv - off * 1.6).rgb;
            col = mix(col, (col + texture2D(tColor, uv + vec2(0.0015, 0.0)).rgb + texture2D(tColor, uv - vec2(0.0015, 0.0)).rgb) / 3.0, wet * 0.5);
            col *= 1.0 - cov * 0.12;
            col += cov * 0.04 * dot(col, vec3(0.3, 0.59, 0.11)) + pow(cov, 8.0) * 0.06;
        } else col = texture2D(tColor, uv).rgb;
        // ── light scattered in the air round fires, motors and flares ──
        if (gN > 0) {
            float T = 20000.0;
            vec3 vd = normalize(vec3((uv * 2.0 - 1.0) * invProj, -1.0));
            if (hasDepth > 0.5) {
                float d = texture2D(tDepth, uv).x;
                if (!isSky(d)) T = linDepth(d) / max(-vd.z, 1e-3);
            }
            vec3 add = vec3(0.0);
            for (int i = 0; i < ${GLOW_LIGHTS}; i++) {
                if (i >= gN) break;
                vec4 A = gA[i], B = gB[i];
                float L2 = dot(A.xyz, A.xyz);
                float b = dot(vd, A.xyz);                  // closest approach along the ray
                float h = sqrt(max(L2 - b * b, 0.0) + B.w * B.w);
                // ∫ dt / (distance² ) from the eye to what the ray hits, in closed form
                float I = (atan((T - b) / h) - atan(-b / h)) / h;
                float c = b / sqrt(max(L2, 1e-6));
                add += B.rgb * (A.w * I * hg(c, 0.7) * exp(-A.w * sqrt(L2) * 0.7));
            }
            col += add;
        }
        gl_FragColor = vec4(col, 1.0);
    }`;

// ═══════════════════════════════════════════════════════════════
export class AirPass extends Pass {
    constructor(scenePass, camera) {
        super();
        this.scenePass = scenePass;
        this.camera = camera;
        this.needsSwap = true;
        this.enabled = false;
        const v4 = () => new Float32Array(GLOW_LIGHTS * 4);
        this.uniforms = {
            tColor: { value: null }, tDepth: { value: null }, cameraNear: { value: 1 }, cameraFar: { value: 1000 }, hasDepth: { value: 0 },
            invProj: { value: new THREE.Vector2(1, 1) }, gA: { value: v4() }, gB: { value: v4() }, gN: { value: 0 },
            rainOn: { value: 0 }, time: { value: 0 }, aspect: { value: 1 }, speedK: { value: 0 }, wet: { value: 0 }, flow: { value: new THREE.Vector2(0.5, 0.5) },
        };
        this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: AIR_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
        this.quad = new FullScreenQuad(this.material);
    }
    render(renderer, writeBuffer, readBuffer) {
        const u = this.uniforms, cam = this.camera;
        const src = this.scenePass.output || readBuffer;
        u.tColor.value = readBuffer.texture;
        u.tDepth.value = src.depthTexture || null;
        u.hasDepth.value = src.depthTexture ? 1 : 0;
        u.cameraNear.value = cam.near; u.cameraFar.value = cam.far;
        const e = cam.projectionMatrix.elements;
        u.invProj.value.set(1 / e[0], 1 / e[5]);
        u.aspect.value = cam.aspect;
        // the glow lights, in view space for this camera
        const G = fireLights.glow, m = cam.matrixWorldInverse.elements, A = u.gA.value, B = u.gB.value;
        for (let i = 0; i < G.n; i++) {
            const o = i * 4, x = G.a[o], y = G.a[o + 1], z = G.a[o + 2];
            A[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
            A[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
            A[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
            A[o + 3] = G.a[o + 3];
            B[o] = G.b[o]; B[o + 1] = G.b[o + 1]; B[o + 2] = G.b[o + 2]; B[o + 3] = G.b[o + 3];
        }
        u.gN.value = this.glowOn ? G.n : 0;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }
    dispose() { this.material.dispose(); this.quad.dispose(); }
}

// ── night-vision goggles ──
const NVG_STATS_FRAG = /* glsl */`
    uniform sampler2D tColor, tPrev;
    uniform float blend;
    varying vec2 vUv;
    // the mean of the tube's input (log, so a few bright lights don't set the gain) over a 16 × 16 grid, eased in
    void main() {
        float s = 0.0;
        for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++) {
            vec3 c = texture2D(tColor, (vec2(float(i), float(j)) + 0.5) / 16.0).rgb;
            s += log(max(dot(c, vec3(0.45, 0.45, 0.1)) + c.r * 0.35, 1e-5));
        }
        float cur = s / 256.0;
        float prev = texture2D(tPrev, vec2(0.5)).r;
        gl_FragColor = vec4(mix(prev, cur, blend), 0.0, 0.0, 1.0);
    }`;
const NVG_FRAG = /* glsl */`
    uniform sampler2D tColor, tStats;
    uniform float time, aspect, maxGain;
    uniform vec2 px;
    varying vec2 vUv;
    float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    // what the photocathode sees: most of the visible, and the near infrared (red here) strongly: vegetation, which
    // reflects near-IR, reads bright, and so does anything hot
    float cathode(vec3 c) { return dot(c, vec3(0.45, 0.45, 0.1)) + c.r * 0.35; }
    void main() {
        // (the tube's resolution: a little soft)
        float L = cathode(texture2D(tColor, vUv).rgb) * 0.4
            + (cathode(texture2D(tColor, vUv + vec2(px.x, 0.0)).rgb) + cathode(texture2D(tColor, vUv - vec2(px.x, 0.0)).rgb)
            + cathode(texture2D(tColor, vUv + vec2(0.0, px.y)).rgb) + cathode(texture2D(tColor, vUv - vec2(0.0, px.y)).rgb)) * 0.15;
        // automatic brightness control: toward a set mean, as hard as the tube can
        float mean = exp(texture2D(tStats, vec2(0.5)).r);
        float gain = clamp(0.2 / max(mean, 1e-5), 1.0, maxGain);
        float v = L * gain;
        v = v / (1.0 + v * 0.25);                     // the screen saturates (bright lights stay hot, for the halo)
        // scintillation: shot noise, worse the harder the gain works, finer than the screen's pixels
        float work = clamp(log2(gain) / 8.0, 0.0, 1.0);
        float n = h12(gl_FragCoord.xy * 0.73 + fract(time * 13.7) * 91.0) - 0.5;
        v += n * (0.05 + 0.3 * work) * sqrt(max(v, 0.002) * 0.6);
        v = max(v, 0.0) + work * 0.012;                // (the tube's own faint glow)
        // the round eyepiece
        vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
        float edge = smoothstep(0.62, 0.5, length(d) / max(aspect, 1.0) * 1.35);
        vec3 phosphor = vec3(0.32, 1.0, 0.36);          // P43, the green of most tubes
        gl_FragColor = vec4(phosphor * v * (0.08 + 0.92 * edge), 1.0);
    }`;

export class NvgPass extends Pass {
    constructor() {
        super();
        this.needsSwap = true;
        this.enabled = false;
        const tiny = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
        this.stat = [tiny(), tiny()];
        this.si = 0;
        this.statsMat = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null }, tPrev: { value: null }, blend: { value: 1 } }, vertexShader: VERT, fragmentShader: NVG_STATS_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
        this.uniforms = { tColor: { value: null }, tStats: { value: null }, time: { value: 0 }, aspect: { value: 1 }, px: { value: new THREE.Vector2() }, maxGain: { value: 900 } };
        this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: NVG_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
        this.quad = new FullScreenQuad(this.statsMat);
        this.fresh = true;
    }
    setSize(w, h) { this.uniforms.px.value.set(1 / w, 1 / h); this.uniforms.aspect.value = w / Math.max(h, 1); }
    render(renderer, writeBuffer, readBuffer, dt) {
        const prev = this.stat[this.si];
        this.si ^= 1;
        this.statsMat.uniforms.tColor.value = readBuffer.texture;
        this.statsMat.uniforms.tPrev.value = prev.texture;
        this.statsMat.uniforms.blend.value = this.fresh ? 1 : 1 - Math.exp(-(dt || 0.016) * 2.5);
        this.fresh = false;
        this.quad.material = this.statsMat;
        renderer.setRenderTarget(this.stat[this.si]);
        this.quad.render(renderer);
        this.uniforms.tColor.value = readBuffer.texture;
        this.uniforms.tStats.value = this.stat[this.si].texture;
        this.uniforms.time.value += dt || 0.016;
        this.quad.material = this.material;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }
    dispose() { for (const t of this.stat) t.dispose(); this.statsMat.dispose(); this.material.dispose(); this.quad.dispose(); }
}

const _v = new THREE.Vector3();

// ═══════════════════════════════════════════════════════════════
// Owns both passes: puts them into the composer and decides each frame whether they run
export class NightFX {
    constructor({ composer, camera, scenePass, cockpitPass, bloom, postfx }) {
        this.composer = composer;
        this.camera = camera;
        this.bloom = bloom;
        this.air = new AirPass(scenePass, camera);
        this.nvg = new NvgPass();
        // the air pass before the cockpit and the pod's video (both come after it); the goggles over everything
        // (the cockpit too) just before the bloom, so their bright lights bloom into halos
        const sensorAt = postfx && postfx.sensor ? composer.passes.indexOf(postfx.sensor) : -1;
        composer.insertPass(this.air, sensorAt >= 0 ? sensorAt : composer.passes.indexOf(cockpitPass));
        const bloomAt = composer.passes.indexOf(bloom);
        composer.insertPass(this.nvg, bloomAt >= 0 ? bloomAt : composer.passes.length);
        this.nvgOn = false;
        this.bloomSaved = null;
        this.quality = 'high';
    }
    setQuality(q) { this.quality = q; }
    // the goggles (game.onNvg); off by themselves while the targeting pod's video is up
    setNvg(on) { this.nvgOn = !!on; }

    update(dt, game) {
        const g = game, w = g && g.world;
        const playing = !!g && g.state !== 'menu';
        const sv = g && g.sensorView;
        const flir = !!sv && sv.mode !== 2;
        // (the pod's FLIR sees heat, not light: no fire light on the scene while it's up)
        fireLights.off = flir;
        // ── the air: glow round lights, rain on the canopy ──
        const A = this.air, u = A.uniforms;
        A.glowOn = !flir && fireLights.glow.n > 0 && this.quality !== 'low';
        let rainOn = false;
        const p = g && g.player;
        const cockpit = playing && g.cameraMode === 'cockpit' && g.cockpit && g.cockpit.enabled && p && p.alive && !g.pilotMode && !sv;
        if (cockpit && w) {
            // wet: rain here (below the cloud base), or flying through cloud (the droplets bead on the glass)
            const wet = Math.min(1, (w.rainK || 0) * 1.1 + (g.whiteout || 0) * 1.4);
            this.wet = Math.max((this.wet || 0) - dt * 0.08, wet); // (it takes a while to blow the last drops off)
            if (this.wet > 0.02) {
                rainOn = true;
                u.wet.value = Math.min(0.75, this.wet);
                u.time.value += dt;
                u.speedK.value = Math.min(6, Math.max(0, (p.speed - 25) / 45));
                // the flow comes from the flight path marker
                _v.copy(p.vel).normalize().add(g.camera.position).project(g.camera);
                if (_v.z < 1) u.flow.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5); else u.flow.value.set(0.5, 0.5);
            }
        } else this.wet = 0;
        u.rainOn.value = rainOn ? 1 : 0;
        A.enabled = A.glowOn || rainOn;
        // ── the goggles ──
        const nvg = playing && !!g.nvg && this.nvgOn && !sv;
        if (nvg && !this.nvg.enabled) this.nvg.fresh = true;
        this.nvg.enabled = nvg;
        const b = this.bloom;
        if (b) {
            if (nvg && !this.bloomSaved) { this.bloomSaved = { threshold: b.threshold, strength: b.strength, radius: b.radius }; b.threshold = 0.95; b.strength = 0.85; b.radius = 0.55; }
            else if (!nvg && this.bloomSaved) { Object.assign(b, this.bloomSaved); this.bloomSaved = null; }
        }
    }
}
