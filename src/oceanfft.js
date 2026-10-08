// ═══════════════════════════════════════════════════════════════
// Ocean detail: a tiling patch of small wind waves (ripples up to a few metres) simulated on the GPU with an
// FFT (Tessendorf), for the water's normals and the small-scale foam. The big waves are the Gerstner field of
// water.js (geometry, shared with the physics); this adds the part too small to matter to anything floating.
//
// Per frame: one pass evolves the spectrum to time t (h0(k) e^{iωt} + h0*(−k) e^{−iωt}, deep-water ω = √(gk)),
// packing three real fields into two complex ones (slope x + i slope z, and the surface's Laplacian), log2 N
// horizontal and log2 N vertical Stockham butterfly passes, and a final pass that writes (slope x, slope z,
// slope², Laplacian ∇²h) into a mipmapped half-float texture. slope² survives mip averaging, so
// far away the shader knows how rough the water it can no longer resolve is (glint width).
//
// The passes are plain WebGL2 calls on three.js's own textures and framebuffers (a three.js render call costs
// ~70 µs of CPU; 18 of them a frame was too much), then three's cached GL state is reset (and its reversed depth
// buffer restored: see update).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const TAU = Math.PI * 2;
const VERT = `#version 300 es
    void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;
const HEAD = `#version 300 es
    precision highp float;
    precision highp int;
    out vec4 fragColor;
    vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
`;
const SPECTRUM_FRAG = HEAD + `
    uniform sampler2D h0;
    uniform float time, N, L;
    void main() {
        ivec2 ij = ivec2(gl_FragCoord.xy);
        vec2 k = ${TAU.toFixed(8)} * (vec2(ij) - N * 0.5) / L;
        float kl = max(length(k), 1e-5);
        float w = sqrt(9.81 * kl);
        vec4 s = texelFetch(h0, ij, 0);
        vec2 e = vec2(cos(w * time), sin(w * time));
        vec2 H = cmul(s.xy, e) + cmul(s.zw, vec2(e.x, -e.y));
        vec2 SX = cmul(vec2(0.0, k.x), H), SZ = cmul(vec2(0.0, k.y), H);
        vec2 DV = -kl * kl * H; // the surface's Laplacian (curvature): where the ripples focus the sun (caustics)
        // two real fields per complex channel: C1 = SX + i SZ, C2 = DV (+ i 0)
        fragColor = vec4(SX.x - SZ.y, SX.y + SZ.x, DV.x, DV.y);
    }`;
// Stockham radix-2 pass (after David Li's WebGL ocean): two complex sequences at once
const FFT_FRAG = (horizontal) => HEAD + `
    uniform sampler2D src;
    uniform float N, sub;
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        float index = float(${horizontal ? 'p.x' : 'p.y'});
        float evenIndex = floor(index / sub) * (sub * 0.5) + mod(index, sub * 0.5);
        ${horizontal
        ? 'vec4 even = texelFetch(src, ivec2(int(evenIndex), p.y), 0); vec4 odd = texelFetch(src, ivec2(int(evenIndex + N * 0.5), p.y), 0);'
        : 'vec4 even = texelFetch(src, ivec2(p.x, int(evenIndex)), 0); vec4 odd = texelFetch(src, ivec2(p.x, int(evenIndex + N * 0.5)), 0);'}
        float a = ${TAU.toFixed(8)} * (index / sub);
        vec2 tw = vec2(cos(a), sin(a));
        fragColor = vec4(even.xy + cmul(tw, odd.xy), even.zw + cmul(tw, odd.zw));
    }`;
// (−1)^(x+y) undoes the centred spectrum; out: slope x, slope z, slope², ∇²h (the curvature: caustics, ocean.js)
const FINAL_FRAG = HEAD + `
    uniform sampler2D src;
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        vec4 c = texelFetch(src, p, 0) * (((p.x + p.y) & 1) == 0 ? 1.0 : -1.0);
        fragColor = vec4(c.x, c.y, c.x * c.x + c.y * c.y, c.z);
    }`;

export class OceanFFT {
    // N: grid size (power of two); L: the patch size (m)
    constructor(renderer, N = 256, L = 32) {
        this.renderer = renderer;
        this.N = N; this.L = L;
        this.passes = Math.round(Math.log2(N));
        const fl = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
        this.ping = new THREE.WebGLRenderTarget(N, N, fl);
        this.pong = new THREE.WebGLRenderTarget(N, N, fl);
        this.out = new THREE.WebGLRenderTarget(N, N, {
            type: THREE.HalfFloatType, format: THREE.RGBAFormat, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
            minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: true, anisotropy: 4,
        });
        this.out.texture.name = 'OceanFFT';
        this.h0 = new THREE.DataTexture(new Float32Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.FloatType);
        this.h0.minFilter = this.h0.magFilter = THREE.NearestFilter;
        this.h0.needsUpdate = true;
        this.slopeRms = 0;
        this.ready = false;
        this.gl = null; // raw GL objects, made on the first update
    }

    get texture() { return this.out.texture; }

    initGL() {
        const r = this.renderer, gl = r.getContext();
        const compile = (vs, fs) => {
            const p = gl.createProgram();
            for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
                const sh = gl.createShader(type);
                gl.shaderSource(sh, src); gl.compileShader(sh);
                if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('ocean FFT shader: ' + gl.getShaderInfoLog(sh));
                gl.attachShader(p, sh);
            }
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('ocean FFT program: ' + gl.getProgramInfoLog(p));
            const u = {};
            for (const n of ['h0', 'time', 'N', 'L', 'src', 'sub']) u[n] = gl.getUniformLocation(p, n);
            return { p, u };
        };
        for (const rt of [this.ping, this.pong, this.out]) r.initRenderTarget(rt);
        const P = r.properties;
        this.gl = {
            spec: compile(VERT, SPECTRUM_FRAG), fh: compile(VERT, FFT_FRAG(true)), fv: compile(VERT, FFT_FRAG(false)), fin: compile(VERT, FINAL_FRAG),
            vao: gl.createVertexArray(),
            fb: (rt) => P.get(rt).__webglFramebuffer, tex: (t) => P.get(t).__webglTexture,
        };
    }

    // Wind-wave spectrum for wind speed U (m/s) blowing along (wx, wz): Phillips, with waves longer than
    // `cut` metres faded out (the Gerstner field has those) and the RMS slope set to `slope`
    setSpectrum(U, wx, wz, cut = 12, slope = 0.12, seed = 7) {
        const N = this.N, L = this.L, data = this.h0.image.data;
        const wl = Math.hypot(wx, wz) || 1; wx /= wl; wz /= wl;
        const Lw = U * U / 9.81, small = 0.04, kc = TAU / cut;
        let a = seed >>> 0;
        const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const gauss = () => { const u = Math.max(rnd(), 1e-9), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
        const P = new Float32Array(N * N), re = new Float32Array(N * N), im = new Float32Array(N * N);
        for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
            const kx = TAU * (n - N / 2) / L, kz = TAU * (m - N / 2) / L, k = Math.hypot(kx, kz), i = m * N + n;
            if (k < 1e-6) { re[i] = im[i] = 0; continue; }
            const kk = k * k, c = (kx * wx + kz * wz) / k;
            let p = Math.exp(-1 / (kk * Lw * Lw)) / (kk * kk) * c * c * Math.exp(-kk * small * small);
            if (c < 0) p *= 0.07;                         // little travels against the wind
            p *= 1 - Math.exp(-Math.pow(k / kc, 4));       // leave the long waves to the Gerstner field
            P[i] = p;
            re[i] = gauss(); im[i] = gauss();
        }
        // scale to the RMS slope asked for: E[slope²] = Σ k² (|h0(k)|² + |h0(−k)|²), |h0|² = P/2 · E|ξ|² = P
        let s2 = 0;
        for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
            const kx = TAU * (n - N / 2) / L, kz = TAU * (m - N / 2) / L;
            s2 += (kx * kx + kz * kz) * 2 * P[m * N + n];
        }
        const A = s2 > 0 ? (slope * slope) / s2 : 0;
        for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
            const i = m * N + n, j = ((N - m) % N) * N + ((N - n) % N);
            const s = Math.sqrt(A * P[i] / 2), sj = Math.sqrt(A * P[j] / 2);
            data[i * 4] = re[i] * s; data[i * 4 + 1] = im[i] * s;
            data[i * 4 + 2] = re[j] * sj; data[i * 4 + 3] = -im[j] * sj; // conj(h0(−k))
        }
        this.h0.needsUpdate = true;
        this.slopeRms = slope;
        this.ready = true;
    }

    // evolve to time t and transform (1 + 2·log2 N + 1 passes)
    update(t) {
        if (!this.ready) return;
        const r = this.renderer;
        if (!this.gl) this.initGL();
        r.initTexture(this.h0); // (re-uploads it after setSpectrum)
        const gl = r.getContext(), G = this.gl, N = this.N;
        const reversed = r.state.buffers.depth.getReversed();
        gl.bindVertexArray(G.vao);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.viewport(0, 0, N, N);
        gl.activeTexture(gl.TEXTURE0);
        const pass = (prog, srcTex, dst) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb(dst));
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        // spectrum
        gl.useProgram(G.spec.p);
        gl.uniform1i(G.spec.u.h0, 0); gl.uniform1f(G.spec.u.time, t); gl.uniform1f(G.spec.u.N, N); gl.uniform1f(G.spec.u.L, this.L);
        pass(G.spec, G.tex(this.h0), this.ping);
        let src = this.ping, dst = this.pong;
        for (const prog of [G.fh, G.fv]) {
            gl.useProgram(prog.p);
            gl.uniform1i(prog.u.src, 0); gl.uniform1f(prog.u.N, N);
            for (let i = 0; i < this.passes; i++) {
                gl.uniform1f(prog.u.sub, Math.pow(2, i + 1));
                pass(prog, G.tex(src.texture), dst);
                const tmp = src; src = dst; dst = tmp;
            }
        }
        gl.useProgram(G.fin.p);
        gl.uniform1i(G.fin.u.src, 0);
        pass(G.fin, G.tex(src.texture), this.out);
        const outTex = G.tex(this.out.texture);
        gl.bindTexture(gl.TEXTURE_2D, outTex);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // three's cached bindings / program / viewport are stale now. Its reset also drops the reversed depth
        // buffer (clip control) and the depth clear value, which the renderer only sets up once: put both straight
        // back, before anything compiles or draws (every program would otherwise be rebuilt without it, and the
        // depth buffer cleared to the near plane, so nothing would pass the depth test)
        r.resetState();
        if (reversed) r.state.buffers.depth.setReversed(true);
        r.state.buffers.depth.setClear(1);
    }

    dispose() {
        for (const t of [this.ping, this.pong, this.out]) t.dispose();
        this.h0.dispose();
        if (this.gl) {
            const gl = this.renderer.getContext();
            for (const k of ['spec', 'fh', 'fv', 'fin']) gl.deleteProgram(this.gl[k].p);
            gl.deleteVertexArray(this.gl.vao);
            this.gl = null;
        }
    }
}
