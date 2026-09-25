// ═══════════════════════════════════════════════════════════════
// Effects: instanced particle systems, ribbon trails, tracers, explosions, debris
//
// Particles are camera-facing quads drawn in one instanced call per system:
//   smoke  — lit billowing smoke (normal-mapped puff atlas, sun + sky light, drifts with the wind)
//   flame  — fire that cools into smoke: each puff starts as glowing fire (half additive) and turns
//            into lit soot as its "heat" decays, so a fireball billows into a dark smoke cloud
//   fire   — additive glows (muzzle flashes, missile motors, hit flashes)
//   sparks — additive streaks stretched along their velocity (embers, shrapnel, grinding sparks)
// Only genuinely hot things go above 1.0 (the bloom threshold): lit smoke is kept below it.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { rand, clamp, smoothstep, fbm, makeRadialTexture } from './util.js';
import { terrainHeight } from './world.js';

// Squash HDR colours from other systems (muzzle flashes of ~6) into a soft knee that tops out ~2.4:
// hot enough to bloom, not enough to blow a white halo over half the screen. Keeps the hue.
function kneeColour(src, out) {
    const m = Math.max(src[0], src[1], src[2]);
    const k = m <= 1 ? 1 : (1 + 1.4 * (1 - Math.exp(-(m - 1) / 1.4))) / m;
    out[0] = src[0] * k; out[1] = src[1] * k; out[2] = src[2] * k;
    return out;
}
const _k0 = [0, 0, 0], _k1 = [0, 0, 0];

// ── Textures ──
// 2×2 atlas of smoke puffs. RG: tangent-space normal (so puffs are lit by the real sun), B: thickness
// (hot core for fire), A: density. Built once, as linear data.
function makePuffAtlas() {
    const S = 128, N = S * 2;
    const data = new Uint8Array(N * N * 4);
    const H = new Float32Array(S * S), D = new Float32Array(S * S);
    const nk = S / 4 * 0.9; // height-field slope → normal scale
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let f = 0; f < 4; f++) {
        const ox = (f & 1) * S, oy = (f >> 1) * S;
        const sx = f * 13.7 + 3.1, sy = f * 7.3 + 11.9;
        // a cauliflower of overlapping spheres: bigger in the middle, smaller lumps round the rim
        const blobs = [[0, 0, 0.5]];
        for (let k = 0; k < 9; k++) {
            const a = rnd() * Math.PI * 2, d = 0.15 + rnd() * 0.33;
            blobs.push([Math.cos(a) * d, Math.sin(a) * d, 0.16 + rnd() * 0.2 * (1 - d)]);
        }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
            const r = Math.hypot(u, v);
            let h = 0;
            for (const [bx, by, br] of blobs) {
                const dx = u - bx, dy = v - by, q = br * br - dx * dx - dy * dy;
                if (q > 0) h = Math.max(h, Math.sqrt(q));
            }
            const fine = fbm(u * 3.2 + sy, v * 3.2 + sx, 2) + fbm(u * 9 + sx, v * 9 + sy, 2) * 0.35; // surface detail
            const win = smoothstep(1.0, 0.8, r); // nothing reaches the frame edge (no square borders)
            H[y * S + x] = Math.max(0, h + fine * 0.035 * Math.min(1, h * 6)) * win;
            D[y * S + x] = clamp(smoothstep(-0.02, 0.32, h + fine * 0.06) * (0.88 + fine * 0.3), 0, 1) * win;
        }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const hx = H[y * S + Math.min(x + 1, S - 1)] - H[y * S + Math.max(x - 1, 0)];
            const hy = H[Math.min(y + 1, S - 1) * S + x] - H[Math.max(y - 1, 0) * S + x];
            let nx = -hx * nk, ny = -hy * nk, nz = 1;
            const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l;
            const i = ((oy + y) * N + ox + x) * 4;
            data[i] = (nx * 0.5 + 0.5) * 255;
            data[i + 1] = (ny * 0.5 + 0.5) * 255;
            data[i + 2] = clamp(H[y * S + x] * 2, 0, 1) * 255;
            data[i + 3] = D[y * S + x] * 255;
        }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

// Explosion flash: a hot core with a few soft rays
function makeFlashTexture() {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'lighter';
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,240,210,0.9)');
    g.addColorStop(0.45, 'rgba(255,190,120,0.25)'); g.addColorStop(1, 'rgba(255,150,80,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.translate(S / 2, S / 2);
    for (let k = 0; k < 7; k++) {
        x.rotate(Math.PI * 2 / 7 + (k % 2) * 0.3);
        const r = x.createLinearGradient(0, 0, S * 0.48, 0);
        r.addColorStop(0, 'rgba(255,235,200,0.55)'); r.addColorStop(1, 'rgba(255,200,140,0)');
        x.fillStyle = r;
        x.beginPath(); x.moveTo(0, -2.5); x.lineTo(S * 0.48, 0); x.lineTo(0, 2.5); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// Shockwave: a thin bright ring
function makeRingTexture() {
    return makeRadialTexture(128, [[0, 'rgba(255,255,255,0)'], [0.62, 'rgba(255,255,255,0)'], [0.84, 'rgba(255,255,255,0.55)'],
        [0.92, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]);
}

// ── Shared shader pieces ──
const PARTICLE_VS = /* glsl */`
    attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iParams;
    #ifdef STRETCH
    attribute vec4 iVel;
    #endif
    varying vec2 vUv; varying vec4 vCol; varying float vDist; varying vec2 vRot; varying float vHeat;
    void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float size = iParams.x;
        float c = cos(iParams.y), s = sin(iParams.y);
        vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
        #ifdef STRETCH
        // motion streak: the quad is drawn along the (view-space) velocity
        vec3 vv = (viewMatrix * vec4(iVel.xyz, 0.0)).xyz;
        float sp = length(vv.xy);
        if (iVel.w > 0.0 && sp > 0.01) {
            vec2 d = vv.xy / sp;
            q = d * position.y * max(size, sp * iVel.w) + vec2(-d.y, d.x) * position.x * size;
        }
        #endif
        mv.xy += q;
        vUv = uv;
        #ifdef ATLAS
        vUv = uv * 0.5 + vec2(mod(iParams.w, 2.0), floor(iParams.w * 0.5)) * 0.5;
        #endif
        vCol = iCol; vRot = vec2(c, s); vHeat = iParams.z; vDist = -mv.z;
        // fade a puff out as the camera enters it (flying through smoke never flashes a big quad)
        vCol.a *= clamp((vDist - 0.3) / max(size * 0.6, 0.5), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
    }`;

const PARTICLE_FS = /* glsl */`
    uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity;
    uniform vec3 sunDirV, sunCol, ambTop, ambBot; uniform float addK;
    varying vec2 vUv; varying vec4 vCol; varying float vDist; varying vec2 vRot; varying float vHeat;
    // black-body-ish ramp: dull red → orange → yellow-white (linear, HDR at the top only)
    vec3 fireRamp(float h) {
        vec3 c = mix(vec3(0.25, 0.02, 0.0), vec3(0.95, 0.22, 0.02), smoothstep(0.0, 0.3, h));
        c = mix(c, vec3(1.45, 0.62, 0.12), smoothstep(0.25, 0.65, h));
        return mix(c, vec3(2.1, 1.55, 0.8), smoothstep(0.65, 1.0, h));
    }
    void main() {
        vec4 t = texture2D(map, vUv);
        float a = t.a * vCol.a;
        if (a < 0.004) discard;
        float fogF = 1.0 - exp(-pow(fogDensity * vDist, 2.0));
        #ifdef LIT
            vec2 nxy = t.rg * 2.0 - 1.0;
            nxy = vec2(vRot.x * nxy.x - vRot.y * nxy.y, vRot.y * nxy.x + vRot.x * nxy.y);
            vec3 n = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
            // wrapped diffuse: smoke scatters light around its edges; thin wisps glow when back-lit
            float wrap = clamp(dot(n, sunDirV) * 0.6 + 0.4, 0.0, 1.0);
            float back = pow(clamp(-sunDirV.z, 0.0, 1.0), 3.0) * (1.0 - t.a) * 0.9;
            vec3 amb = mix(ambBot, ambTop, n.y * 0.5 + 0.5);
            vec3 col = vCol.rgb * max(amb + sunCol * (wrap + back), vec3(0.05, 0.055, 0.07)); // (a floor so night smoke isn't a black hole)
            col = mix(col, fogColor, fogF);
        #else
            vec3 col = vCol.rgb * mix(vec3(1.0), vec3(t.b * 0.5 + 0.6), 0.6);
            #ifdef ADDITIVE
                col *= 1.0 - fogF;
            #else
                col = mix(col, fogColor, fogF);
            #endif
        #endif
        float e = 0.0;
        #ifdef HEAT
            // the thick middle of each puff burns hotter than its wisps
            float heat = clamp(vHeat * (0.65 + 0.55 * t.b), 0.0, 1.0);
            e = smoothstep(0.0, 0.35, heat) * step(0.001, vHeat);
            col = col * (1.0 - e) + fireRamp(heat) * e * (1.0 - fogF);
        #endif
        #ifdef ADDITIVE
            gl_FragColor = vec4(col, a);
        #else
            // premultiplied: a glowing puff adds light (partly), a cold one occludes like smoke
            gl_FragColor = vec4(col * a, a * (1.0 - e * addK));
        #endif
        #include <tonemapping_fragment>
    }`;

// Unit octagon (circumscribing a circle of radius 0.5) with uvs matching a unit quad
function octagonGeometry() {
    const r = 0.5 / Math.cos(Math.PI / 8);
    const pos = [0, 0, 0], uv = [0.5, 0.5], idx = [];
    for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) * Math.PI / 4;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        pos.push(x, y, 0); uv.push(x + 0.5, y + 0.5);
        idx.push(0, 1 + i, 1 + ((i + 1) % 8));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
}

// ── Instanced billboard particle system ──
class ParticleSystem {
    constructor(scene, max, { additive = false, texture, renderOrder = 6, lit = false, heat = false, atlas = false, stretch = false, knee = false, wind = 0, light = null, addK = 0.4 } = {}) {
        this.max = max;
        this.count = 0;
        this.knee = knee;
        this.windK = wind;
        this.stretch = stretch;
        // state (struct-of-arrays)
        this.p = new Float32Array(max * 3);
        this.v = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.maxLife = new Float32Array(max);
        this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
        this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
        this.a0 = new Float32Array(max); this.a1 = new Float32Array(max);
        this.drag = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.rot = new Float32Array(max); this.rotV = new Float32Array(max);
        this.h0 = new Float32Array(max); this.hT = new Float32Array(max);
        this.frame = new Uint8Array(max);
        this.st = stretch ? new Float32Array(max) : null;

        // round puffs are drawn on an octagon that just encloses the circle: ~17% fewer (transparent) pixels
        const base = atlas ? octagonGeometry() : new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.setAttribute('position', base.attributes.position);
        geo.setAttribute('uv', base.attributes.uv);
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('iPos', this.aPos);
        geo.setAttribute('iCol', this.aCol);
        geo.setAttribute('iParams', this.aPar);
        this.attrs = [[this.aPos, 3], [this.aCol, 4], [this.aPar, 4]];
        if (stretch) {
            this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
            geo.setAttribute('iVel', this.aVel);
            this.attrs.push([this.aVel, 4]);
        }
        geo.instanceCount = 0;
        this.geo = geo;

        const defines = {};
        if (lit) defines.LIT = '';
        if (heat) defines.HEAT = '';
        if (atlas) defines.ATLAS = '';
        if (stretch) defines.STRETCH = '';
        if (additive) defines.ADDITIVE = '';
        const L = light || {};
        this.mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: false, defines,
            uniforms: {
                map: { value: texture }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 }, addK: { value: addK },
                sunDirV: L.sunDirV || { value: new THREE.Vector3(0, 1, 0) }, sunCol: L.sunCol || { value: new THREE.Color(0.5, 0.5, 0.5) },
                ambTop: L.ambTop || { value: new THREE.Color(0.4, 0.4, 0.4) }, ambBot: L.ambBot || { value: new THREE.Color(0.2, 0.2, 0.2) },
            },
            vertexShader: PARTICLE_VS,
            fragmentShader: PARTICLE_FS,
        });
        if (additive) this.mat.blending = THREE.AdditiveBlending;
        else {
            this.mat.blending = THREE.CustomBlending;
            this.mat.blendSrc = THREE.OneFactor;
            this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
            this.mat.blendSrcAlpha = THREE.OneFactor;
            this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        }
        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = renderOrder;
        scene.add(this.mesh);
    }

    // heat: 0 = plain smoke, 1 = white-hot; it cools to 0 over the first heatT of the particle's life.
    // stretch: streak length per m/s of speed (sparks system only).
    emit(pos, vel, life, size0, size1, col0, col1, alpha0, alpha1, drag = 0.5, grav = 0, heat = 0, heatT = 0.5, spin = 1, stretch = 0) {
        if (this.count >= this.max) return;
        if (this.knee) { col0 = kneeColour(col0, _k0); col1 = kneeColour(col1, _k1); }
        const i = this.count++;
        const i3 = i * 3;
        this.p[i3] = pos.x; this.p[i3 + 1] = pos.y; this.p[i3 + 2] = pos.z;
        this.v[i3] = vel.x; this.v[i3 + 1] = vel.y; this.v[i3 + 2] = vel.z;
        this.life[i] = this.maxLife[i] = life;
        this.s0[i] = size0; this.s1[i] = size1;
        this.c0[i3] = col0[0]; this.c0[i3 + 1] = col0[1]; this.c0[i3 + 2] = col0[2];
        this.c1[i3] = col1[0]; this.c1[i3 + 1] = col1[1]; this.c1[i3 + 2] = col1[2];
        this.a0[i] = alpha0; this.a1[i] = alpha1;
        this.drag[i] = drag; this.grav[i] = grav;
        this.rot[i] = Math.random() * 6.28; this.rotV[i] = (Math.random() - 0.5) * 0.9 * spin;
        this.h0[i] = heat; this.hT[i] = Math.max(heatT, 0.01);
        this.frame[i] = (Math.random() * 4) | 0;
        if (this.st) this.st[i] = stretch;
    }

    kill(i) {
        const j = --this.count;
        if (i === j) return;
        const i3 = i * 3, j3 = j * 3;
        for (let k = 0; k < 3; k++) {
            this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k];
            this.c0[i3 + k] = this.c0[j3 + k]; this.c1[i3 + k] = this.c1[j3 + k];
        }
        this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
        this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
        this.a0[i] = this.a0[j]; this.a1[i] = this.a1[j];
        this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
        this.rot[i] = this.rot[j]; this.rotV[i] = this.rotV[j];
        this.h0[i] = this.h0[j]; this.hT[i] = this.hT[j]; this.frame[i] = this.frame[j];
        if (this.st) this.st[i] = this.st[j];
    }

    update(dt, fog, wind) {
        const P = this.aPos.array, C = this.aCol.array, S = this.aPar.array, Vv = this.aVel ? this.aVel.array : null;
        for (let i = this.count - 1; i >= 0; i--) {
            this.life[i] -= dt;
            if (this.life[i] <= 0) this.kill(i);
        }
        // drag relaxes a puff's velocity toward the wind (smoke drifts downwind)
        const wk = this.windK && wind ? this.windK : 0;
        const wx = wk ? wind.x * wk : 0, wz = wk ? wind.z * wk : 0;
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3, i4 = i * 4;
            const d = Math.exp(-this.drag[i] * dt);
            this.v[i3] = wx + (this.v[i3] - wx) * d;
            this.v[i3 + 1] = this.v[i3 + 1] * d + this.grav[i] * dt;
            this.v[i3 + 2] = wz + (this.v[i3 + 2] - wz) * d;
            this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
            this.rot[i] += this.rotV[i] * dt;
            const t = 1 - this.life[i] / this.maxLife[i];
            const te = 1 - (1 - t) * (1 - t); // ease-out for size
            P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
            C[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
            C[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
            C[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
            // quick fade-in over first 8% of life avoids popping
            C[i4 + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * t) * (t < 0.08 ? t * 12.5 : 1);
            S[i4] = this.s0[i] + (this.s1[i] - this.s0[i]) * te;
            S[i4 + 1] = this.rot[i];
            const hk = 1 - t / this.hT[i];
            S[i4 + 2] = hk > 0 ? this.h0[i] * hk * Math.sqrt(hk) : 0;
            S[i4 + 3] = this.frame[i];
            if (Vv) { Vv[i4] = this.v[i3]; Vv[i4 + 1] = this.v[i3 + 1]; Vv[i4 + 2] = this.v[i3 + 2]; Vv[i4 + 3] = this.st[i]; }
        }
        this.geo.instanceCount = this.count;
        for (const [a, n] of this.attrs) {
            a.needsUpdate = true;
            a.clearUpdateRanges?.();
            a.addUpdateRange?.(0, this.count * n);
        }
        this.mat.uniforms.fogColor.value.copy(fog.color);
        this.mat.uniforms.fogDensity.value = fog.density;
    }

    clear() { this.count = 0; this.geo.instanceCount = 0; }
}

// ── Ribbon trail (missile smoke, contrails, wingtip vortices) ──
// Points live in a ring buffer (no per-point allocation). The ribbon is soft across its width and
// breaks up along its length, and non-additive trails are lit like the smoke.
const trailIndex = new Map();
function trailIndexFor(max) {
    let a = trailIndex.get(max);
    if (!a) {
        const idx = new (max * 2 > 65535 ? Uint32Array : Uint16Array)((max - 1) * 6);
        for (let i = 0; i < max - 1; i++) { const v = i * 2, k = i * 6; idx[k] = v; idx[k + 1] = v + 1; idx[k + 2] = v + 2; idx[k + 3] = v + 1; idx[k + 4] = v + 3; idx[k + 5] = v + 2; }
        trailIndex.set(max, a = new THREE.BufferAttribute(idx, 1));
    }
    return a;
}

export class Trail {
    constructor(effects, { max = 120, width = 2, life = 4, color = [1, 1, 1], alpha = 0.6, additive = false, minDist = 6, widthGrow = 3 }) {
        this.fx = effects;
        this.max = max; this.width = width; this.lifeTime = life; this.alpha = alpha; this.minDist = minDist; this.widthGrow = widthGrow;
        // ring buffer of points: position, birth time, distance along the trail
        this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
        this.pt = new Float32Array(max); this.pu = new Float32Array(max);
        this.head = 0; this.n = 0; this.dist = Math.random() * 500;
        this.alive = true; this.emitting = true;
        const geo = new THREE.BufferGeometry();
        this.posArr = new Float32Array(max * 2 * 3);
        this.dataArr = new Float32Array(max * 2 * 3); // alpha, across (-1..1), along (m)
        geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('tdata', new THREE.BufferAttribute(this.dataArr, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setIndex(trailIndexFor(max));
        geo.setDrawRange(0, 0);
        this.geo = geo;
        this.mesh = new THREE.Mesh(geo, effects.trailMaterial(color, additive));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 7;
        effects.scene.add(this.mesh);
    }

    get pts() { return { length: this.n }; } // (compat: callers only ever read .length)

    // The newest point is glued to the emitter; once it is minDist from the last fixed point it is
    // left behind and a new head starts. (Comparing against the glued head itself, as this used to,
    // never let a slow emitter lay a second point: contrails were one stretched quad.)
    push(pos, now) {
        const max = this.max;
        if (this.n >= 2) {
            const h = (this.head + this.n - 1) % max, f = (this.head + this.n - 2) % max;
            const dx = pos.x - this.px[f], dy = pos.y - this.py[f], dz = pos.z - this.pz[f];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < this.minDist * this.minDist) {
                this.px[h] = pos.x; this.py[h] = pos.y; this.pz[h] = pos.z; this.pt[h] = now;
                this.pu[h] = this.pu[f] + Math.sqrt(d2);
                return;
            }
        }
        if (this.n) {
            const l = (this.head + this.n - 1) % max;
            this.dist = this.pu[l] + Math.hypot(pos.x - this.px[l], pos.y - this.py[l], pos.z - this.pz[l]);
        }
        if (this.n >= max) { this.head = (this.head + 1) % max; this.n--; }
        const k = (this.head + this.n) % max;
        this.px[k] = pos.x; this.py[k] = pos.y; this.pz[k] = pos.z; this.pt[k] = now; this.pu[k] = this.dist;
        this.n++;
    }

    update(now, camPos) {
        const max = this.max;
        while (this.n && now - this.pt[this.head] > this.lifeTime) { this.head = (this.head + 1) % max; this.n--; }
        const n = this.n;
        if (!this.emitting && n < 2) { this.alive = false; return; }
        const P = this.posArr, D = this.dataArr;
        let sx = 0, sy = 0, sz = 0;
        for (let i = 0; i < n; i++) {
            const k = (this.head + i) % max;
            const kn = (this.head + Math.min(i + 1, n - 1)) % max, kp = (this.head + Math.max(i - 1, 0)) % max;
            const cx = this.px[k], cy = this.py[k], cz = this.pz[k];
            let tx = this.px[kn] - this.px[kp], ty = this.py[kn] - this.py[kp], tz = this.pz[kn] - this.pz[kp];
            if (tx * tx + ty * ty + tz * tz < 1e-6) { tx = 0; ty = 0; tz = 1; }
            const vx = camPos.x - cx, vy = camPos.y - cy, vz = camPos.z - cz;
            // side = tangent × to-camera
            let ax = ty * vz - tz * vy, ay = tz * vx - tx * vz, az = tx * vy - ty * vx;
            const al = Math.hypot(ax, ay, az);
            if (al > 1e-6) { ax /= al; ay /= al; az /= al; sx = ax; sy = ay; sz = az; } else { ax = sx; ay = sy; az = sz; }
            const age = (now - this.pt[k]) / this.lifeTime;
            const w = this.width * (1 + age * this.widthGrow);
            const o = i * 6;
            P[o] = cx + ax * w; P[o + 1] = cy + ay * w; P[o + 2] = cz + az * w;
            P[o + 3] = cx - ax * w; P[o + 4] = cy - ay * w; P[o + 5] = cz - az * w;
            // fade at the tail end and very near the head
            const headFade = clamp((n - 1 - i) / 3, 0, 1);
            const a = this.alpha * (1 - age) * (1 - age) * headFade;
            D[o] = a; D[o + 1] = -1; D[o + 2] = this.pu[k];
            D[o + 3] = a; D[o + 4] = 1; D[o + 5] = this.pu[k];
        }
        this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
        const pa = this.geo.attributes.position, da = this.geo.attributes.tdata;
        pa.needsUpdate = da.needsUpdate = true;
        pa.clearUpdateRanges?.(); da.clearUpdateRanges?.();
        pa.addUpdateRange?.(0, n * 6); da.addUpdateRange?.(0, n * 6);
    }

    dispose() {
        this.fx.scene.remove(this.mesh);
        this.geo.dispose();
        this.alive = false;
    }
}

// ═══════════════════════════════════════════════════════════════
export class Effects {
    constructor(scene) {
        this.scene = scene;
        this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
        this._tmpV = new THREE.Vector3(); this._tmpP = new THREE.Vector3(); this._base = new THREE.Vector3();
        this.now = 0;
        this.wind = null;          // the game's wind vector (bound by the Wreckage system), smoke drifts with it
        this.groundHeight = null;  // latest ground-height function from update()

        // scene lighting, mirrored into the particle/trail shaders each frame (view space)
        this.lightU = {
            sunDirV: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0.6, 0.55, 0.5) },
            ambTop: { value: new THREE.Color(0.3, 0.35, 0.45) }, ambBot: { value: new THREE.Color(0.1, 0.1, 0.08) },
        };
        this.sunW = new THREE.Vector3(0, 1, 0);

        const puffs = makePuffAtlas();
        this.puffTex = puffs;
        const fireTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.75)'], [0.7, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
        const sparkTex = makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
        this.smoke = new ParticleSystem(scene, 8000, { texture: puffs, lit: true, atlas: true, renderOrder: 6, wind: 1, light: this.lightU });
        this.flame = new ParticleSystem(scene, 3500, { texture: puffs, lit: true, atlas: true, heat: true, renderOrder: 7, wind: 1, light: this.lightU, addK: 0.45 });
        this.fire = new ParticleSystem(scene, 4000, { additive: true, texture: fireTex, renderOrder: 8, knee: true });
        this.sparks = new ParticleSystem(scene, 3000, { additive: true, texture: sparkTex, renderOrder: 8, stretch: true, knee: true });

        this.trails = [];
        this.trailMats = new Map();
        this.debris = [];
        this.emitters = [];   // smoke columns and smoking tendrils that emit over time
        this.landed = [];     // thrown parts lying where they fell
        const bent = new THREE.BoxGeometry(2.2, 0.12, 1.4, 3, 1, 1);
        { const p = bent.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.abs(p.getX(i)) * 0.35); bent.computeVertexNormals(); }
        this.debrisGeo = [new THREE.BoxGeometry(1.2, 0.3, 2), new THREE.TetrahedronGeometry(1), bent, new THREE.CylinderGeometry(0.35, 0.45, 1.8, 6)];
        this.debrisMat = [
            new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.6, metalness: 0.5 }),
            new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.9, metalness: 0.1 }), // charred
        ];

        // Tracers: camera-facing glowing streaks, one draw call
        this.maxTracers = 2500;
        const tg = new THREE.BufferGeometry();
        this.tracerPos = new Float32Array(this.maxTracers * 4 * 3);
        this.tracerCol = new Float32Array(this.maxTracers * 4 * 3);
        const tIdx = new Uint32Array(this.maxTracers * 6);
        for (let i = 0; i < this.maxTracers; i++) {
            const v = i * 4, k = i * 6;
            tIdx[k] = v; tIdx[k + 1] = v + 1; tIdx[k + 2] = v + 2; tIdx[k + 3] = v + 1; tIdx[k + 4] = v + 3; tIdx[k + 5] = v + 2;
        }
        tg.setIndex(new THREE.BufferAttribute(tIdx, 1));
        tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
        tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
        // (additive, so one pass over both faces looks exactly like three.js's back-then-front passes, without
        // re-resolving the shader for each of them every frame)
        this.tracers = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false }));
        this.tracers.frustumCulled = false;
        this.tracers.renderOrder = 9;
        scene.add(this.tracers);

        // Pooled flash lights — fixed count so shaders never recompile mid-game
        this.lights = [];
        for (let i = 0; i < 3; i++) {
            const l = new THREE.PointLight(0xff8840, 0, 600, 1.6);
            l.userData.life = 0;
            scene.add(l);
            this.lights.push(l);
        }
        // Pooled additive sprites: explosion flashes and shockwave rings
        this.flashTex = makeFlashTexture();
        this.ringTex = makeRingTexture();
        this.sprites = [];
        for (let i = 0; i < 16; i++) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
            s.visible = false;
            s.renderOrder = 10;
            s.userData = { life: 0, max: 1, scale: 1, grow: 0, a: 1 };
            scene.add(s);
            this.sprites.push(s);
        }
    }

    trailMaterial(color, additive) {
        const key = color.join(',') + additive;
        if (this.trailMats.has(key)) return this.trailMats.get(key);
        const L = this.lightU;
        const m = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
            forceSinglePass: additive, // (additive: the draw order of its faces doesn't matter, one pass is exact)
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            defines: additive ? {} : { LIT: '' },
            uniforms: { color: { value: new THREE.Color(...color) }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 }, time: { value: 0 }, ...L },
            vertexShader: /* glsl */`
                attribute vec3 tdata; varying vec3 vD; varying float vDist;
                void main() { vD = tdata; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
            fragmentShader: /* glsl */`
                uniform vec3 color, fogColor, sunCol, ambTop, ambBot; uniform float fogDensity, time; varying vec3 vD; varying float vDist;
                float h1(float n) { return fract(sin(n) * 43758.5453); }
                float vnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
                void main() {
                    float across = vD.y;
                    // soft edges across the ribbon, puffy break-up along it
                    float edge = 1.0 - across * across;
                    float n = vnoise(vD.z * 0.045 + across * 1.3) * 0.6 + vnoise(vD.z * 0.13 - time * 0.3) * 0.4;
                    float a = vD.x * smoothstep(0.0, 0.75, edge) * (0.55 + 0.6 * n);
                    #ifdef LIT
                        vec3 c = color * (mix(ambBot, ambTop, 0.75) + sunCol * (0.7 + 0.3 * n));
                    #else
                        vec3 c = color;
                    #endif
                    float fogF = 1.0 - exp(-pow(fogDensity * vDist, 2.0));
                    gl_FragColor = vec4(mix(c, fogColor, fogF), a * (1.0 - fogF * 0.7) * smoothstep(8.0, 70.0, vDist));
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        m.userData.additive = additive;
        this.trailMats.set(key, m);
        return m;
    }

    addTrail(opts) {
        const t = new Trail(this, opts);
        this.trails.push(t);
        return t;
    }

    // true when there is open water under this point (effects then splash instead of throwing dirt)
    isWater(x, z) { return terrainHeight(x, z) < -0.5; }
    heightAt(x, z) { return this.groundHeight ? this.groundHeight(x, z) : Math.max(terrainHeight(x, z), 0); }

    // ── Composite effects ──
    explosion(pos, size = 1, vel = null) {
        const V = this._tmpV, P = this._tmpP, s = size;
        const base = this._base.set(0, 0, 0);
        if (vel) base.copy(vel).multiplyScalar(0.25);
        const gh = this.heightAt(pos.x, pos.z);
        const agl = pos.y - gh;
        const low = agl < 5 + 6 * s;
        const water = low && this.isWater(pos.x, pos.z);

        // flash + shockwave + light
        this.sprite(this.flashTex, pos, 16 * s, 0.13, 0.5, 1, [1, 0.9, 0.75]);
        if (s >= 0.7) this.sprite(this.ringTex, pos, 4 * s, 0.4, 60 * s, 0.3, [1, 0.95, 0.9]);
        this.light(pos, 40 * s, 0.6);

        // lingering smoke that rises and drifts (emitted first so the fireball draws over it)
        const nm = Math.round((3 + 3 * s) * (water ? 0.4 : 1));
        for (let i = 0; i < nm; i++) {
            V.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 12) * s).add(base);
            P.copy(pos).addScaledVector(V, 0.15);
            this.flame.emit(P, V, rand(6, 11), rand(8, 12) * s, rand(26, 40) * s, [0.16, 0.15, 0.14], [0.4, 0.39, 0.38], 0.5, 0, 1.2, 3, 0, 0.5, 0.5);
        }
        // fireball: hot billows that cool into a dark, lit smoke cloud (a ground burst mushrooms upward)
        const nf = Math.round((9 + 6 * s) * (water ? 0.6 : 1)); // water quenches a surface burst
        const lift = low ? Math.max(0, 5 * s - agl * 0.5) : 0;
        for (let i = 0; i < nf; i++) {
            V.set(rand(-1, 1), rand(low ? 0 : -0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 20) * s).add(base);
            P.copy(pos).addScaledVector(V, 0.05);
            P.y += lift;
            const life = rand(1.8, 3.2) * (0.85 + 0.15 * s);
            this.flame.emit(P, V, life, rand(7, 11) * s, rand(18, 30) * s, [0.1, 0.085, 0.075], [0.26, 0.25, 0.24], 0.95, 0, 2.6, 4, rand(0.85, 1), rand(0.22, 0.38), 1.4);
        }
        // hot core flare (brief additive pop)
        for (let i = 0; i < 3; i++) {
            V.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(4 * s).add(base);
            this.fire.emit(pos, V, rand(0.18, 0.3), 8 * s, 22 * s, [2.2, 1.5, 0.7], [1.2, 0.4, 0.08], 0.5, 0, 3, 0);
        }
        // sparks and burning fragments
        const ns = Math.round(22 * Math.min(s, 2.5));
        for (let i = 0; i < ns; i++) {
            V.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize().multiplyScalar(rand(50, 150) * Math.sqrt(s)).add(base);
            this.sparks.emit(pos, V, rand(0.5, 1.5), rand(0.5, 0.9), 0.2, [2.4, 1.5, 0.55], [1.3, 0.35, 0.05], 1, 0, 1.1, -22, 0, 0.5, 1, 0.035);
        }
        // smoking tendrils arcing out of big blasts
        if (s >= 0.9 && !water) {
            const nt = Math.round(1 + s * 0.8 + Math.random() * 1.5);
            for (let i = 0; i < nt; i++) {
                const tv = new THREE.Vector3(rand(-1, 1), rand(-0.1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(25, 80) * Math.sqrt(s)).add(base);
                this.emitters.push({ kind: 'tendril', pos: pos.clone().addScaledVector(tv, 0.08), vel: tv, life: rand(0.8, 1.9), t: 0, acc: 0, size: s * rand(0.6, 1) });
            }
        }
        if (water) this.waterSplash(P.copy(pos).setY(Math.max(gh, 0) + 0.5), Math.min(3, s * 1.2), this.flame);
        else if (low) {
            this.dustBurst(P.copy(pos).setY(gh + 0.5), s, Math.max(0, 1 - agl / (5 + 6 * s)));
            if (s >= 1.2) this.smokeColumn(P.copy(pos).setY(gh + 1), s * 0.7, 6 + s * 4);
        }
    }

    // a ring of dust blown out along the ground, plus clods of earth
    dustBurst(pos, size = 1, strength = 1) {
        const V = this._tmpV, s = size;
        const n = Math.round((8 + 6 * s) * (0.4 + 0.6 * strength));
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
            V.set(Math.cos(a), rand(0.05, 0.3), Math.sin(a)).multiplyScalar(rand(18, 40) * s);
            this.smoke.emit(pos, V, rand(2.5, 4.5), rand(3, 5) * s, rand(14, 24) * s, [0.44, 0.38, 0.3], [0.52, 0.47, 0.4], 0.7, 0, 1.6, 1, 0, 0.5, 0.7);
        }
        for (let i = 0; i < 10 * s * strength; i++) {
            V.set(rand(-1, 1), rand(0.6, 1.4), rand(-1, 1)).multiplyScalar(rand(15, 40) * Math.sqrt(s));
            this.smoke.emit(pos, V, rand(1, 1.8), rand(0.6, 1.2) * s, rand(0.4, 0.8) * s, [0.14, 0.12, 0.1], [0.2, 0.17, 0.14], 1, 0.6, 0.3, -24, 0, 0.5, 3);
        }
    }

    // a column of smoke that keeps rising from a burning spot for `duration` seconds
    smokeColumn(pos, size = 1, duration = 10) {
        this.emitters.push({ kind: 'column', pos: pos.clone(), life: duration, t: 0, acc: 0, size });
    }

    // generic pooled additive sprite (flash / ring)
    sprite(tex, pos, scale, life, grow, alpha, col) {
        let s = null, oldest = null;
        for (const x of this.sprites) {
            if (!x.visible) { s = x; break; }
            if (!oldest || x.userData.life < oldest.userData.life) oldest = x;
        }
        s = s || oldest;
        s.material.map = tex;
        s.material.color.setRGB(col[0], col[1], col[2]);
        s.material.opacity = alpha;
        s.material.rotation = Math.random() * 6.28;
        s.position.copy(pos);
        s.scale.setScalar(scale);
        s.visible = true;
        Object.assign(s.userData, { life, max: life, scale, grow, a: alpha });
        return s;
    }

    flash(pos, scale, life) { this.sprite(this.flashTex, pos, scale, life, 0.4, 1, [1, 0.9, 0.75]); }

    light(pos, intensity, life) {
        let l = this.lights.find(x => x.userData.life <= 0);
        if (!l) l = this.lights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
        l.position.copy(pos);
        l.userData.life = life; l.userData.max = life; l.userData.i = intensity * 45;
        l.intensity = l.userData.i;
    }

    debrisBurst(pos, vel, count = 8, big = 1) {
        for (let i = 0; i < count; i++) {
            const burning = Math.random() < 0.6;
            const m = new THREE.Mesh(this.debrisGeo[i % this.debrisGeo.length], this.debrisMat[burning ? 1 : 0]);
            m.position.copy(pos);
            m.scale.setScalar(rand(0.6, 1.6) * big);
            m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
            m.castShadow = true;
            this.scene.add(m);
            this.debris.push({
                mesh: m,
                vel: new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(30, 90)).addScaledVector(vel, 0.6),
                spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
                life: rand(3, 6), smokeT: 0, burning, big,
            });
        }
    }

    // Throw a piece of an existing object (a tank's turret, a radar dish, a SAM rack): it keeps its world
    // transform, tumbles and smokes, then comes to rest on the ground as wreckage (cleared with the sortie).
    throwPart(obj, vel, spin = 3, burning = true) {
        this.scene.attach(obj);
        this.debris.push({
            mesh: obj, vel: vel.clone(), spin: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spin),
            life: 15, smokeT: 0, burning, big: 1, keep: true,
        });
    }

    // bullet / shrapnel strike on something hard
    impact(pos, vel) {
        const V = this._tmpV;
        for (let i = 0; i < 6; i++) {
            V.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(45);
            if (vel) V.addScaledVector(vel, 0.3);
            this.sparks.emit(pos, V, rand(0.15, 0.4), 0.35, 0.15, [2.4, 1.8, 0.9], [1.4, 0.6, 0.15], 1, 0, 2, -10, 0, 0.5, 1, 0.03);
        }
        this.fire.emit(pos, V.set(0, 0, 0), 0.1, 2.5, 6, [2.4, 1.9, 1.3], [1.4, 0.7, 0.3], 1, 0, 0, 0);
        this.smoke.emit(pos, V.set(0, 2, 0), rand(0.8, 1.4), 1.2, 5, [0.3, 0.3, 0.3], [0.45, 0.45, 0.45], 0.5, 0, 1, 0);
    }

    groundImpact(pos) {
        const V = this._tmpV;
        if (this.isWater(pos.x, pos.z)) {
            for (let i = 0; i < 3; i++) this.smoke.emit(pos, V.set(rand(-4, 4), rand(14, 28), rand(-4, 4)), rand(0.6, 1.1), 0.8, 4, [0.85, 0.9, 0.95], [0.8, 0.85, 0.9], 0.7, 0, 1, -25);
            return;
        }
        for (let i = 0; i < 3; i++) {
            V.set(rand(-8, 8), rand(10, 30), rand(-8, 8));
            this.smoke.emit(pos, V, rand(0.8, 1.6), 1.5, 7, [0.45, 0.4, 0.33], [0.55, 0.5, 0.42], 0.6, 0, 2, -15);
        }
        for (let i = 0; i < 3; i++) {
            V.set(rand(-6, 6), rand(12, 26), rand(-6, 6));
            this.smoke.emit(pos, V, rand(0.6, 1.0), 0.35, 0.25, [0.16, 0.13, 0.1], [0.2, 0.17, 0.13], 1, 0.7, 0.2, -30, 0, 0.5, 3);
        }
    }

    // sys: the particle system to use (an explosion's splash goes in with its fireball so it isn't hidden behind it)
    waterSplash(pos, size = 1, sys = this.smoke) {
        const V = this._tmpV, s = size;
        const W0 = [0.92, 0.96, 1], W1 = [0.82, 0.87, 0.92];
        // central plume
        for (let i = 0; i < 12 * s + 4; i++) {
            V.set(rand(-1, 1) * 6, rand(30, 75), rand(-1, 1) * 6).multiplyScalar(Math.sqrt(s));
            sys.emit(pos, V, rand(1.4, 2.6), 3 * s, 14 * s, W0, W1, 0.85, 0, 0.7, -32, 0, 0.5, 0.5);
        }
        // crown thrown out sideways
        const n = Math.round(10 + 8 * s);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(-0.15, 0.15);
            V.set(Math.cos(a) * rand(10, 22), rand(14, 34), Math.sin(a) * rand(10, 22)).multiplyScalar(Math.sqrt(s));
            sys.emit(pos, V, rand(1.2, 2.2), 2.5 * s, 9 * s, W0, W1, 0.75, 0, 0.9, -30, 0, 0.5, 0.8);
        }
        // droplets
        for (let i = 0; i < 16 * s; i++) {
            V.set(rand(-1, 1) * 20, rand(25, 70), rand(-1, 1) * 20).multiplyScalar(Math.sqrt(s));
            sys.emit(pos, V, rand(1, 2), rand(0.5, 1.1) * s, 0.3 * s, W0, W0, 0.9, 0.4, 0.2, -38, 0, 0.5, 2);
        }
        // foam and mist left on the surface
        for (let i = 0; i < 6; i++) {
            V.set(rand(-1, 1) * 5, rand(0.5, 2), rand(-1, 1) * 5);
            sys.emit(pos, V, rand(4, 7), 6 * s, 24 * s, [0.88, 0.92, 0.95], [0.8, 0.84, 0.88], 0.45, 0, 0.8, 0, 0, 0.5, 0.3);
        }
    }

    // Engine exhaust / damage smoke helpers
    puffSmoke(pos, vel, size, dark = 0.2, life = 2.2, alpha = 0.55) {
        this.smoke.emit(pos, vel, life, size, size * 4, [dark, dark, dark], [dark + 0.25, dark + 0.25, dark + 0.25], alpha, 0, 1.2, 2, 0, 0.5, 0.7);
    }
    puffFire(pos, vel, size, life = 0.35) {
        // flame that cools as it trails away: yellow at the root, dull red at the tips, then soot
        this.flame.emit(pos, vel, life * 1.6, size, size * 0.9, [0.08, 0.07, 0.06], [0.14, 0.13, 0.12], 0.85, 0, 1.5, 0, rand(0.75, 0.95), 0.55, 1.6);
    }

    // ── Tracers ──
    drawTracers(bullets, camPos) {
        const P = this.tracerPos, C = this.tracerCol;
        let n = 0;
        const a = this._v1, b = this._v2, side = this._v3, toCam = this._tmpV;
        for (let i = 0; i < bullets.length && n < this.maxTracers; i++) {
            const bl = bullets[i];
            if (!bl.tracer) continue;
            a.copy(bl.pos);
            b.copy(bl.pos).addScaledVector(bl.vel, -0.03);
            toCam.subVectors(camPos, a);
            const dist = toCam.length();
            side.subVectors(a, b).cross(toCam).normalize();
            const w = Math.max(0.22, dist * 0.0021);
            const k = n * 12;
            P[k] = a.x + side.x * w; P[k + 1] = a.y + side.y * w; P[k + 2] = a.z + side.z * w;
            P[k + 3] = a.x - side.x * w; P[k + 4] = a.y - side.y * w; P[k + 5] = a.z - side.z * w;
            P[k + 6] = b.x + side.x * w * 0.4; P[k + 7] = b.y + side.y * w * 0.4; P[k + 8] = b.z + side.z * w * 0.4;
            P[k + 9] = b.x - side.x * w * 0.4; P[k + 10] = b.y - side.y * w * 0.4; P[k + 11] = b.z - side.z * w * 0.4;
            const c = bl.color;
            const fade = Math.min(1, bl.life * 2) * (dist > 6000 ? 0 : 1 - dist / 6000);
            for (let v = 0; v < 2; v++) { C[k + v * 3] = c[0] * fade; C[k + v * 3 + 1] = c[1] * fade; C[k + v * 3 + 2] = c[2] * fade; }
            for (let v = 2; v < 4; v++) { C[k + v * 3] = c[0] * 0.15 * fade; C[k + v * 3 + 1] = c[1] * 0.1 * fade; C[k + v * 3 + 2] = c[2] * 0.05 * fade; }
            n++;
        }
        const g = this.tracers.geometry;
        g.setDrawRange(0, n * 6);
        const pa = g.attributes.position, ca = g.attributes.color;
        pa.needsUpdate = ca.needsUpdate = true;
        pa.clearUpdateRanges?.(); ca.clearUpdateRanges?.();
        pa.addUpdateRange?.(0, n * 12); ca.addUpdateRange?.(0, n * 12);
    }

    // Mirror the scene's sun and sky light into the shaders (in view space), so smoke is lit like the world
    updateLighting(camera) {
        const sc = this.scene;
        if (!this.sunLight || !this.sunLight.parent) this.sunLight = sc.children.find(o => o.isDirectionalLight && o.castShadow) || sc.children.find(o => o.isDirectionalLight) || null;
        if (!this.hemiLight || !this.hemiLight.parent) this.hemiLight = sc.children.find(o => o.isHemisphereLight) || null;
        const L = this.lightU, sl = this.sunLight, hl = this.hemiLight;
        if (sl) {
            this.sunW.subVectors(sl.position, sl.target.position);
            if (this.sunW.lengthSq() < 1e-6) this.sunW.set(0, 1, 0);
            this.sunW.normalize();
            // the sun dims and reddens as it sets; below the horizon only the (moon)light's own colour is left
            L.sunCol.value.copy(sl.color).multiplyScalar(sl.intensity * 0.19);
        }
        if (hl) {
            L.ambTop.value.copy(hl.color).multiplyScalar(hl.intensity * 0.62);
            L.ambBot.value.copy(hl.groundColor).multiplyScalar(hl.intensity * 0.62);
        }
        camera.updateMatrixWorld();
        L.sunDirV.value.copy(this.sunW).transformDirection(camera.matrixWorldInverse);
    }

    updateEmitters(dt) {
        const V = this._tmpV, P = this._tmpP;
        for (let i = this.emitters.length - 1; i >= 0; i--) {
            const e = this.emitters[i];
            e.t += dt;
            if (e.kind === 'tendril') {
                e.vel.y -= 9.81 * dt;
                e.vel.multiplyScalar(Math.exp(-1.1 * dt));
                e.pos.addScaledVector(e.vel, dt);
                e.acc += dt;
                const k = e.t / e.life;
                // a puff every ~0.6 puff-widths of travel
                const step = Math.max(0.035, (1.6 + k * 1.6) * e.size / Math.max(e.vel.length(), 1));
                while (e.acc > step) {
                    e.acc -= step;
                    V.copy(e.vel).multiplyScalar(0.1);
                    const sz = (2.6 + k * 1.6) * e.size;
                    this.flame.emit(e.pos, V, rand(2.2, 3.0) - k * 1.2, sz, sz * 3.2, [0.12, 0.11, 0.1], [0.3, 0.29, 0.28], 0.6 * (1 - k * 0.6), 0, 1.4, 2, Math.max(0, 0.8 - k * 1.3), 0.3, 1);
                }
                // the burning fragment at its head
                if (k < 0.7) this.sparks.emit(e.pos, e.vel, 0.05, 0.9 * e.size, 0.7 * e.size, [2.2, 1.2, 0.4], [1.4, 0.5, 0.1], 1, 0, 0, 0, 0, 0.5, 0, 0.06);
                if (e.pos.y < this.heightAt(e.pos.x, e.pos.z)) e.t = e.life;
            } else if (e.kind === 'column') {
                const k = e.t / e.life;
                e.acc += dt * (1 - k * 0.6) * 6; // puffs per second, thinning out as it burns down
                while (e.acc > 1) {
                    e.acc -= 1;
                    const s = e.size;
                    P.set(e.pos.x + rand(-2, 2) * s, e.pos.y, e.pos.z + rand(-2, 2) * s);
                    V.set(rand(-1.5, 1.5), rand(9, 15) * Math.sqrt(s), rand(-1.5, 1.5));
                    const d = 0.05 + k * 0.1;
                    this.smoke.emit(P, V, rand(7, 11), 5 * s, 34 * s, [d, d, d], [0.3, 0.29, 0.28], 0.75, 0, 0.12, 2.5, 0, 0.5, 0.5);
                    if (k < 0.6 && Math.random() < 0.6) this.flame.emit(P, V.set(rand(-1, 1), rand(5, 9), rand(-1, 1)), rand(0.6, 1.1), 3 * s, 4 * s, [0.1, 0.09, 0.08], [0.2, 0.19, 0.18], 0.8, 0, 1, 2, rand(0.6, 0.85) * (1 - k), 0.6, 1.2);
                }
            }
            if (e.t >= e.life) this.emitters.splice(i, 1);
        }
    }

    update(dt, camera, fog, groundHeight) {
        this.now += dt;
        if (groundHeight) this.groundHeight = groundHeight;
        this.updateLighting(camera);
        this.updateEmitters(dt);
        this.smoke.update(dt, fog, this.wind);
        this.flame.update(dt, fog, this.wind);
        this.fire.update(dt, fog, null);
        this.sparks.update(dt, fog, null);
        for (const m of this.trailMats.values()) {
            m.uniforms.fogColor.value.copy(fog.color); m.uniforms.fogDensity.value = fog.density;
            m.uniforms.time.value = this.now;
        }
        for (let i = this.trails.length - 1; i >= 0; i--) {
            const t = this.trails[i];
            t.update(this.now, camera.position);
            if (!t.alive) { t.dispose(); this.trails.splice(i, 1); }
        }
        for (const s of this.sprites) {
            if (!s.visible) continue;
            const u = s.userData;
            u.life -= dt;
            if (u.life <= 0) { s.visible = false; continue; }
            const k = u.life / u.max; // 1 → 0
            const t = 1 - k;
            s.scale.setScalar(u.grow > 1 ? u.scale + (u.grow - u.scale) * (1 - (1 - t) * (1 - t)) : u.scale * (1 + t * u.grow));
            s.material.opacity = u.a * (u.grow > 1 ? k * k : Math.min(1, k * 1.6));
        }
        for (const l of this.lights) {
            if (l.userData.life > 0) {
                l.userData.life -= dt;
                const k = Math.max(0, l.userData.life / l.userData.max);
                l.intensity = l.userData.i * k * k;
            } else l.intensity = 0;
        }
        const V = this._tmpV;
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i];
            d.life -= dt;
            d.vel.y -= 9.81 * dt;
            d.vel.multiplyScalar(Math.exp(-0.3 * dt));
            d.mesh.position.addScaledVector(d.vel, dt);
            d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
            d.smokeT -= dt;
            if (d.smokeT <= 0) {
                d.smokeT = 0.05;
                V.set(0, 1, 0);
                this.puffSmoke(d.mesh.position, V, 1.6 * d.big + 0.4, 0.15, 1.6, 0.5);
                if (d.burning) this.puffFire(d.mesh.position, V, 2.2 * d.big + 0.6, 0.3);
            }
            const gh = this.heightAt(d.mesh.position.x, d.mesh.position.z);
            if (d.mesh.position.y < gh || d.life <= 0) {
                if (d.mesh.position.y < gh + 2) this.groundImpact(d.mesh.position);
                if (d.keep && !this.isWater(d.mesh.position.x, d.mesh.position.z)) {
                    // come to rest, roughly flat, half dug in
                    d.mesh.position.y = gh + 0.2;
                    d.mesh.rotation.x = rand(-0.3, 0.3); d.mesh.rotation.z = rand(-0.3, 0.3);
                    this.landed.push(d.mesh);
                } else this.scene.remove(d.mesh);
                this.debris.splice(i, 1);
            }
        }
    }

    clear() {
        this.smoke.clear(); this.fire.clear(); this.flame.clear(); this.sparks.clear();
        this.trails.forEach(t => t.dispose()); this.trails = [];
        this.debris.forEach(d => this.scene.remove(d.mesh)); this.debris = [];
        this.landed.forEach(m => this.scene.remove(m)); this.landed = [];
        this.emitters = [];
        this.sprites.forEach(s => { s.visible = false; s.userData.life = 0; });
        this.lights.forEach(l => { l.userData.life = 0; l.intensity = 0; });
        this.tracers.geometry.setDrawRange(0, 0);
    }
}

