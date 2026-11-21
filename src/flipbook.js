// ═══════════════════════════════════════════════════════════════
// Fireball flipbooks: pre-simulated explosions played back on a camera-facing quad.
//
// Three bursts were simulated as real fluid (Blender Mantaflow fire + smoke: tools/fx/bake_fireball.py) and looked
// at from the side, 64 frames each from the flash to thin smoke (tools/fx/render_flipbook.py):
//   air     an air burst: a ball of fire that rolls, rises and turns to smoke
//   ground  a ground burst: a hemisphere off the ground, mushrooming up on a stem
//   fuel    a fuel fireball: slower, sootier, rolling up off the ground for seconds
// The frames carry no lighting of their own. Per pixel they hold coverage, heat (what the black-body ramp of the
// particle shader turns into fire, HDR at the top so it blooms) and four numbers of light: how bright the smoke is
// under light from everywhere (b0) and how that changes with the light's direction (b), so the game's own sun, sky,
// fire light, fog and night light the cloud as b0 + b·s: the lit side toward the real sun, the far side in the
// cloud's own shadow, thin edges glowing against the light.
// Two atlases per burst (models/fx/fireball_<name>_a / _b.webp, each a 2×2 mosaic of grey tiles: one tile per
// channel, so a lossy codec's colour planes don't smear one channel into another), packed into RGBA on the GPU at
// load: A = light x, light y, heat, coverage; B = motion x, motion y, light mean, light z.
// Playback follows the particle's age in game time (slow motion slows it): two neighbouring frames are blended,
// each pushed along its motion vectors by its share of the step, so nothing pops or ghosts at any frame rate. The
// frames aren't evenly spaced (the first tenth of a second gets as many as the last seconds), and every frame is
// cropped to its content: the metadata (fireball_<name>.json) gives each frame's time and its window in the cloud.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { FIRE_VIEW_GLSL, fireUniforms } from './firelight.js';

export const FLIPBOOK_EVENTS = ['air', 'ground', 'fuel'];
export const FLIPBOOK_DIR = 'models/fx/';
// below this size (the callers' blast size) a burst stays a handful of puffs: cannon hits, flak, small arms
export const FLIPBOOK_MIN_SIZE = 0.5;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ── Frame selection ──
// times: each frame's start as a fraction of the whole flipbook (times[0] = 0, rising, the last below 1).
// u: the particle's age as that fraction. Returns the frame and the blend toward the next (0..1); the last frame
// is held (it is all but empty).
export function frameAt(times, u, out = { i: 0, f: 0 }) {
    const n = times.length;
    if (!(u > 0)) { out.i = 0; out.f = 0; return out; }
    if (u >= times[n - 1]) { out.i = n - 1; out.f = 0; return out; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= u) lo = m; else hi = m; }
    out.i = lo;
    out.f = clamp((u - times[lo]) / (times[hi] - times[lo]), 0, 1);
    return out;
}

// The window a quad between frames i and i + 1 covers (blend f): centre right / up of the burst point and edge, in
// the simulation's metres; and how frame i's and i + 1's own windows sit in it (what the shader needs to look each
// of them up): r = edge of i + 1 / edge of i, (dx, dy) = the centre's shift in frame i's edges.
export function windowAt(meta, i, f, out = { cx: 0, cy: 0, e: 1, r: 1, dx: 0, dy: 0 }) {
    const W = meta.windows, a = W[i], b = W[Math.min(i + 1, W.length - 1)];
    out.cx = a[0] + (b[0] - a[0]) * f; out.cy = a[1] + (b[1] - a[1]) * f; out.e = a[2] + (b[2] - a[2]) * f;
    out.r = b[2] / a[2]; out.dx = (b[0] - a[0]) / a[2]; out.dy = (b[1] - a[1]) / a[2];
    return out;
}

// How big and how long, from the size the callers pass (size³ goes with the charge: splash.js explosionKg = 6 size³
// kg of TNT). A fireball's width and its burning time both go with the cube root of the charge, so with `size`:
//   high explosive  ~8 m across per unit and out in ~0.45 s per unit: a 500 lb bomb (size 2.2-2.4) is a fireball
//                   18-19 m across that burns for a second; an air-to-air warhead (0.9) 7 m and under half a second
//   fuel            wider and three times as long: jet fuel burns as fast as it finds air, orange under its own soot
// (the time grows a little slower than the size, so the smallest bursts aren't over in a blink)
export function fireballSpec(size, kind = 'he') {
    const s = Math.max(size, 0.05);
    if (kind === 'fuel') return { diameter: 11 * s, burn: clamp(1.45 * Math.pow(s, 0.9), 0.6, 10) };
    return { diameter: 8 * s, burn: clamp(0.48 * Math.pow(s, 0.9), 0.15, 6) };
}

// ── Atlases ──
function checkMeta(m) {
    return m && m.frames > 1 && m.cols * m.rows >= m.frames && Array.isArray(m.times) && m.times.length === m.frames &&
        Array.isArray(m.windows) && m.windows.length === m.frames && m.fireDiameter > 0 && m.burn > 0 && m.burn < 1;
}

class Flipbooks {
    constructor() {
        this.books = {};      // name → { name, meta, texA, texB }
        this.loading = null;
        this.half = false;    // half-size atlases (low / medium quality)
    }
    get(name) { const b = this.books[name]; return b && b.meta ? b : null; }
    // metadata without textures (tests, and the first step of a load)
    setMeta(name, meta) {
        if (!checkMeta(meta)) return null;
        const b = this.books[name] || (this.books[name] = { name, meta: null, texA: null, texB: null });
        b.meta = meta;
        // how bright the fire is frame by frame (0..1), for the light it throws
        b.glow = meta.glow && meta.glow.length === meta.frames ? meta.glow : meta.times.map(t => (t < meta.burn ? 1 - t / meta.burn : 0));
        return b;
    }
    // Fetch the metadata and the two mosaics of each burst and pack them into RGBA atlases on the GPU. Resolves when
    // everything that could be loaded is; a burst that fails to load is simply not there (the effects fall back to
    // puffs). opts: { half: half-size atlases, base: url prefix }
    load(renderer, opts = {}) {
        if (this.loading) return this.loading;
        const base = opts.base || FLIPBOOK_DIR;
        this.half = !!opts.half;
        const loader = new THREE.TextureLoader();
        const image = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
        this.loading = Promise.all(FLIPBOOK_EVENTS.map(async (name) => {
            try {
                const r = await fetch(`${base}fireball_${name}.json`);
                if (!r.ok) throw new Error(r.status);
                const meta = await r.json();
                if (!checkMeta(meta)) throw new Error('metadata');
                const [a, b] = await Promise.all([image(`${base}fireball_${name}_a.webp`), image(`${base}fireball_${name}_b.webp`)]);
                const texA = packMosaic(renderer, a, this.half), texB = packMosaic(renderer, b, this.half);
                a.dispose(); b.dispose();
                const book = this.setMeta(name, meta);
                book.texA = texA; book.texB = texB;
                for (const s of this.systems) if (s.name === name) s.setBook(book);
            } catch (e) { console.warn(`fireball flipbook '${name}' not loaded:`, e && e.message ? e.message : e); }
        }));
        return this.loading;
    }
}
Flipbooks.prototype.systems = [];
export const flipbooks = new Flipbooks();
export function preloadFlipbooks(renderer, opts) { return flipbooks.load(renderer, opts); }

// A grey 2×2 mosaic (R | G over B | A) into one RGBA texture with mipmaps, on the GPU (no readback)
let _pack = null;
function packMosaic(renderer, src, half) {
    src.colorSpace = THREE.NoColorSpace; src.flipY = false; src.generateMipmaps = false;
    src.minFilter = src.magFilter = half ? THREE.LinearFilter : THREE.NearestFilter;
    src.needsUpdate = true;
    const w = src.image.width / 2 / (half ? 2 : 1), h = src.image.height / 2 / (half ? 2 : 1);
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.colorSpace = THREE.NoColorSpace;
    if (!_pack) {
        const mat = new THREE.ShaderMaterial({
            uniforms: { src: { value: null } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            // (the image's top row is v = 0 here and in the atlas: FLIPBOOK_FS counts rows from there)
            fragmentShader: `uniform sampler2D src; varying vec2 vUv;
                void main() { vec2 h = vUv * 0.5; gl_FragColor = vec4(texture2D(src, h).r, texture2D(src, h + vec2(0.5, 0.0)).r, texture2D(src, h + vec2(0.0, 0.5)).r, texture2D(src, h + vec2(0.5, 0.5)).r); }`,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        quad.frustumCulled = false;
        const scene = new THREE.Scene();
        scene.add(quad);
        _pack = { mat, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    }
    _pack.mat.uniforms.src.value = src;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(_pack.scene, _pack.cam); // (three makes the target's mipmaps after rendering into it)
    renderer.setRenderTarget(prev);
    _pack.mat.uniforms.src.value = null;
    return rt.texture;
}

// ── Shader ──
const FLIPBOOK_VS = /* glsl */`
    attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iParams; attribute vec4 iWarp; attribute vec4 iOff;
    uniform vec3 grid; // columns, rows, frames
    varying vec2 vQ; varying vec4 vCol; varying float vDist; varying vec2 vRot; varying vec3 vHB; varying vec4 vCells; varying vec3 vWarp;
    // [night] lit by the flashes and fires round it (firelight.js), as the puffs are; not while it burns itself
    // (iOff.z: its own fire's glow in its smoke is in the baked heat, and its own light sits in the middle of it)
    ${FIRE_VIEW_GLSL}
    varying vec3 vFire, vFireDir;
    void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float size = iParams.x;
        float c = cos(iParams.y), s = sin(iParams.y);
        // the frame's window sits off the burst point (a ground burst stands on it; the smoke of an air burst climbs)
        mv.xy += vec2(c * iOff.x - s * iOff.y, s * iOff.x + c * iOff.y);
        mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
        // (the quad is a grid of a few vertices so the light of a fire at its foot falls off up the cloud)
        vFire = iOff.z > 0.0 ? fireIrradiance(mv.xyz, vFireDir) * iOff.z : vec3(0.0);
        vQ = vec2(position.x * iWarp.w + 0.5, position.y + 0.5); // the flipbook's own frame (mirrored or not)
        float fr = floor(iParams.w), fb = min(fr + 1.0, grid.z - 1.0);
        vCells = vec4(mod(fr, grid.x), floor(fr / grid.x), mod(fb, grid.x), floor(fb / grid.x));
        vHB = vec3(iParams.z, iParams.w - fr, iWarp.w);
        vWarp = iWarp.xyz; vCol = iCol; vRot = vec2(c, s); vDist = -mv.z;
        // fades out as the camera flies into it (never a wall of quad across the screen)
        vCol.a *= clamp((vDist - 0.3) / max(size * 0.3, 0.5), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
    }`;

const FLIPBOOK_FS = /* glsl */`
    uniform sampler2D mapA, mapB;
    uniform vec3 grid; uniform float mvScale, addK, frameSize, sunK, footFade, heatGamma;
    uniform vec3 fogColor; uniform float fogDensity;
    uniform vec3 sunDirV, sunCol, ambTop, ambBot;
    varying vec2 vQ; varying vec4 vCol; varying float vDist; varying vec2 vRot; varying vec3 vHB; varying vec4 vCells; varying vec3 vWarp;
    varying vec3 vFire, vFireDir;
    // black-body-ish ramp, the particles' own (effects.js): dull red → orange → yellow-white, HDR at the top only
    vec3 fireRamp(float h) {
        vec3 c = mix(vec3(0.25, 0.02, 0.0), vec3(0.95, 0.22, 0.02), smoothstep(0.0, 0.3, h));
        c = mix(c, vec3(1.45, 0.62, 0.12), smoothstep(0.25, 0.65, h));
        return mix(c, vec3(2.1, 1.55, 0.8), smoothstep(0.65, 1.0, h));
    }
    // a frame's own uv (x right, y up) to the atlas (row 0 at v = 0, a frame's top row first)
    vec2 cellUV(vec2 cell, vec2 uv) { return (cell + vec2(clamp(uv.x, 0.004, 0.996), 1.0 - clamp(uv.y, 0.004, 0.996))) / grid.xy; }
    float inside(vec2 uv) { vec2 a = step(vec2(0.0), uv) * step(uv, vec2(1.0)); return a.x * a.y; }
    void main() {
        float f = vHB.y;
        // the quad covers a window between the two frames' own: where this pixel falls in each
        float r = vWarp.x, ef = 1.0 + f * (r - 1.0);
        vec2 uvA = (vQ - 0.5) * ef + 0.5 + f * vWarp.yz;
        vec2 uvB = (vQ - 0.5) * (ef / r) + 0.5 - (1.0 - f) * vWarp.yz / r;
        // (the mip level by hand, and never past the one where a frame's neighbours in the atlas would leak in)
        float lod = clamp(log2(max(length(dFdx(vQ)), length(dFdy(vQ))) * frameSize * ef), 0.0, 3.0);
        #ifdef MOTION
            // each frame slid along its own motion: the earlier one forward, the later one back
            vec2 mA = (textureLod(mapB, cellUV(vCells.xy, uvA), lod).rg * 2.0 - 1.0) * mvScale;
            vec2 mB = (textureLod(mapB, cellUV(vCells.zw, uvB), lod).rg * 2.0 - 1.0) * mvScale;
            uvA -= vec2(mA.x, -mA.y) * f;
            uvB += vec2(mB.x, -mB.y) * (1.0 - f);
        #endif
        vec4 a1 = textureLod(mapA, cellUV(vCells.xy, uvA), lod), b1 = textureLod(mapA, cellUV(vCells.zw, uvB), lod);
        vec4 a2 = textureLod(mapB, cellUV(vCells.xy, uvA), lod), b2 = textureLod(mapB, cellUV(vCells.zw, uvB), lod);
        float wa = a1.a * inside(uvA) * (1.0 - f), wb = b1.a * inside(uvB) * f;
        // (a ground burst's frame is cut off at the ground: its foot fades into the dust instead of ending in a line)
        if (footFade > 0.0) { wa *= smoothstep(0.0, footFade, uvA.y); wb *= smoothstep(0.0, footFade, uvB.y); }
        float cover = wa + wb, a = cover * vCol.a;
        if (a < 0.004) discard;
        // (light and heat are per unit of coverage: blended by how much of each frame is there)
        float inv = 1.0 / max(cover, 1e-4);
        vec3 t1 = (a1.rgb * wa + b1.rgb * wb) * inv;
        vec2 t2 = (a2.ba * wa + b2.ba * wb) * inv;
        float fogF = 1.0 - exp(-pow(fogDensity * vDist, 2.0));
        // light: b0 + b·s, b turned with the sprite (mirrored, rotated) into view space
        vec2 bxy = t1.rg * 2.0 - 1.0;
        bxy.x *= vHB.z;
        vec3 bl = vec3(vRot.x * bxy.x - vRot.y * bxy.y, vRot.y * bxy.x + vRot.x * bxy.y, t2.y * 2.0 - 1.0);
        float b0 = t2.x;
        float sun = clamp(b0 + dot(bl, sunDirV), 0.0, 1.5);
        float sky = clamp(b0 + 0.5 * bl.y, 0.0, 1.5), gnd = clamp(b0 - 0.5 * bl.y, 0.0, 1.5);
        vec3 col = vCol.rgb * max(ambTop * sky + ambBot * gnd + sunCol * (sun * sunK), vec3(0.05, 0.055, 0.07)); // (a floor so night smoke isn't a black hole)
        float fl = dot(vFire, vec3(0.3, 0.59, 0.11));
        if (fl > 1e-4) {
            vec3 fd = normalize(vFireDir + vec3(0.0, 0.0, 1e-4));
            col += vCol.rgb * vFire * (0.3 * clamp(b0 + dot(bl, fd), 0.0, 1.5));
        }
        col = mix(col, fogColor, fogF);
        // fire: the baked heat through the black-body ramp (its curve lifted for the burst simulated as high explosive:
        // in daylight only the upper two thirds of the ramp read as fire, the dull red below as brown smoke)
        float heat = clamp(pow(t1.b, heatGamma) * vHB.x, 0.0, 1.0);
        float e = smoothstep(0.0, 0.35, heat);
        col = col * (1.0 - e) + fireRamp(heat) * e * (1.0 - fogF);
        // premultiplied: bright flame adds light (partly); soot occludes, also while it still glows dull red
        gl_FragColor = vec4(col * a, a * (1.0 - addK * smoothstep(0.3, 0.8, heat)));
        #include <tonemapping_fragment>
    }`;

// ── Instanced flipbook sprites of one burst ──
const _o = { i: 0, f: 0 }, _w = { cx: 0, cy: 0, e: 1, r: 1, dx: 0, dy: 0 };
const _blank = () => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 0, 0]), 1, 1); t.needsUpdate = true; return t; };

export class FlipbookSystem {
    constructor(scene, name, { light = null, max = 64, renderOrder = 6.5, motion = true } = {}) {
        this.name = name;
        this.max = max;
        this.list = [];      // live sprites
        this.pool = [];
        this.order = [];
        this.book = null;
        const base = new THREE.PlaneGeometry(1, 1, 4, 4);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.setAttribute('position', base.attributes.position);
        geo.setAttribute('uv', base.attributes.uv);
        const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
        this.aPos = attr(3); this.aCol = attr(4); this.aPar = attr(4); this.aWarp = attr(4); this.aOff = attr(4);
        geo.setAttribute('iPos', this.aPos); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iParams', this.aPar);
        geo.setAttribute('iWarp', this.aWarp); geo.setAttribute('iOff', this.aOff);
        this.attrs = [[this.aPos, 3], [this.aCol, 4], [this.aPar, 4], [this.aWarp, 4], [this.aOff, 4]];
        geo.instanceCount = 0;
        this.geo = geo;
        const L = light || {};
        this.blank = _blank();
        this.mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: false, defines: motion ? { MOTION: '' } : {},
            uniforms: {
                mapA: { value: this.blank }, mapB: { value: this.blank }, grid: { value: new THREE.Vector3(8, 8, 64) },
                mvScale: { value: 0 }, addK: { value: 0.25 }, frameSize: { value: 256 }, sunK: { value: 1.7 }, footFade: { value: 0 }, heatGamma: { value: 0.7 },
                fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
                sunDirV: L.sunDirV || { value: new THREE.Vector3(0, 1, 0) }, sunCol: L.sunCol || { value: new THREE.Color(0.5, 0.5, 0.5) },
                ambTop: L.ambTop || { value: new THREE.Color(0.4, 0.4, 0.4) }, ambBot: L.ambBot || { value: new THREE.Color(0.2, 0.2, 0.2) },
                ...fireUniforms(),
            },
            vertexShader: FLIPBOOK_VS, fragmentShader: FLIPBOOK_FS,
        });
        this.mat.blending = THREE.CustomBlending;
        this.mat.blendSrc = THREE.OneFactor; this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
        this.mat.blendSrcAlpha = THREE.OneFactor; this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.name = 'flipbook:' + name;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = renderOrder;
        scene.add(this.mesh);
        flipbooks.systems.push(this);
        const b = flipbooks.get(name);
        if (b) this.setBook(b);
    }

    get count() { return this.list.length; }
    get ready() { return !!this.book; }

    setBook(book) {
        this.book = book;
        const m = book.meta, u = this.mat.uniforms;
        u.grid.value.set(m.cols, m.rows, m.frames);
        u.mvScale.value = m.mvScale || 0;
        u.frameSize.value = (m.frameSize || 256) * (flipbooks.half ? 0.5 : 1);
        u.footFade.value = m.ground ? 0.05 : 0;
        u.heatGamma.value = m.name === 'fuel' ? 0.6 : 0.7;
        if (book.texA && book.texB) { u.mapA.value = book.texA; u.mapB.value = book.texB; }
        this.times = m.times;
    }
    // plain cross-fading (two taps fewer a pixel) for the low quality setting
    setMotion(on) {
        const has = this.mat.defines.MOTION !== undefined;
        if (on === has) return;
        if (on) this.mat.defines.MOTION = ''; else delete this.mat.defines.MOTION;
        this.mat.needsUpdate = true;
    }

    // One sprite. o: {
    //   diameter   the fireball across at its hottest (m); the whole frame is sized from it
    //   burn       seconds until the fire is out; the smoke that follows takes its time from it too
    //   vel, drag  carried along (m/s), slowing (1/s); wind: how much of the wind it takes (0..1)
    //   heat       gain on the baked heat (1.25 white-hot high explosive .. 0.7 orange fuel), easing to `heat1` over
    //              the first `heatT` of the burn (a flash that goes orange)
    //   c0, c1     the soot's colour at first and at the end;  alpha
    //   mirror     ±1 (default random);  rot (rad, default a few degrees);  start: fraction of the flipbook skipped
    //   light      intensity of the light it throws while it burns (firelight.js `keep`), 0 for none
    //   hold       seconds before it appears (a string of bursts going off one after the other)
    // }
    emit(pos, o = {}) {
        if (!this.book) return null;
        let p;
        if (this.list.length >= this.max) { p = this.list.shift(); if (p.key) p.key = null; } // (the oldest makes way)
        else p = this.pool.pop() || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), c0: [0, 0, 0], c1: [0, 0, 0], lp: new THREE.Vector3() };
        const m = this.book.meta;
        p.pos.copy(pos);
        if (o.vel) p.vel.copy(o.vel); else p.vel.set(0, 0, 0);
        p.drag = o.drag ?? 1.5; p.wind = o.wind ?? (m.ground ? 0.4 : 1);
        p.scale = (o.diameter || 10) / m.fireDiameter;
        const burn = Math.max(o.burn || 1, 0.05);
        p.start = o.start ?? Math.random() * m.times[Math.min(2, m.frames - 1)];
        p.life = burn / m.burn * (1 - p.start);   // (the fire is out at `burn` seconds: the flipbook's own burn-out point)
        p.burn = burn;
        p.age = -(o.hold || 0);
        p.heat = o.heat ?? 1.1; p.heat1 = o.heat1 ?? p.heat; p.heatT = Math.max(o.heatT ?? 0.3, 1e-3) * burn;
        const c0 = o.c0 || [0.1, 0.09, 0.08], c1 = o.c1 || [0.2, 0.19, 0.185];
        p.c0[0] = c0[0]; p.c0[1] = c0[1]; p.c0[2] = c0[2]; p.c1[0] = c1[0]; p.c1[1] = c1[1]; p.c1[2] = c1[2];
        p.alpha = o.alpha ?? 1;
        p.mirror = o.mirror || (Math.random() < 0.5 ? -1 : 1);
        p.rot = o.rot ?? (Math.random() - 0.5) * (m.ground ? 0.1 : 0.5);
        p.light = o.light || 0;
        p.key = p.light > 0 ? p : null;
        p.dist = 0;
        this.list.push(p);
        return p;
    }

    // fl: firelight.js fireLights (or null)
    update(dt, camera, fog, wind, fl) {
        const L = this.list;
        if (!L.length && !this.geo.instanceCount) return;
        const book = this.book, m = book.meta, times = m.times, glow = book.glow;
        const cam = camera.position;
        const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0;
        for (let k = L.length - 1; k >= 0; k--) {
            const p = L[k];
            p.age += dt;
            if (p.age >= p.life) { L.splice(k, 1); this.pool.push(p); continue; }
            if (p.age < 0) continue;
            // carried along and slowing; taking up the wind
            const d = Math.exp(-p.drag * dt), tx = wx * p.wind, tz = wz * p.wind;
            p.vel.x = tx + (p.vel.x - tx) * d; p.vel.y *= d; p.vel.z = tz + (p.vel.z - tz) * d;
            p.pos.addScaledVector(p.vel, dt);
            p.dist = p.pos.distanceToSquared(cam);
        }
        // far ones first: they are big and they overlap
        const order = this.order;
        order.length = 0;
        for (const p of L) if (p.age >= 0) order.push(p);
        order.sort((a, b) => b.dist - a.dist);
        const P = this.aPos.array, C = this.aCol.array, S = this.aPar.array, W = this.aWarp.array, O = this.aOff.array;
        for (let k = 0; k < order.length; k++) {
            const p = order[k], k3 = k * 3, k4 = k * 4;
            const t = p.age / p.life;
            frameAt(times, p.start + (1 - p.start) * t, _o);
            windowAt(m, _o.i, _o.f, _w);
            // it swells out of a point in its first instants, and its last wisps fade
            const grow = Math.min(1, 0.3 + 0.7 * p.age / Math.max(0.03 * p.life * m.burn, 1e-3));
            const sc = p.scale * grow;
            // a ground burst stands on its burst point (the foot of its window, whatever the camera's height: the
            // quad is lifted half its own height up the screen); an air burst's window follows the cloud up, along
            // the world's up
            let rise = 0, oy = 0;
            if (m.ground) oy = _w.e * sc * 0.5; else rise = _w.cy * sc;
            P[k3] = p.pos.x; P[k3 + 1] = p.pos.y + rise; P[k3 + 2] = p.pos.z;
            // (fresh soot is black; it greys as it thins over the first half of its life)
            const tc = Math.min(1, t / 0.5);
            C[k4] = p.c0[0] + (p.c1[0] - p.c0[0]) * tc; C[k4 + 1] = p.c0[1] + (p.c1[1] - p.c0[1]) * tc; C[k4 + 2] = p.c0[2] + (p.c1[2] - p.c0[2]) * tc;
            C[k4 + 3] = p.alpha * Math.min(1, (1 - t) / 0.1);
            const heat = p.heat + (p.heat1 - p.heat) * Math.min(1, p.age / p.heatT);
            S[k4] = _w.e * sc; S[k4 + 1] = p.rot; S[k4 + 2] = heat; S[k4 + 3] = _o.i + Math.min(_o.f, 0.9999);
            W[k4] = _w.r; W[k4 + 1] = _w.dx; W[k4 + 2] = _w.dy; W[k4 + 3] = p.mirror;
            // (other fires light its smoke once its own is out)
            O[k4] = _w.cx * sc * p.mirror; O[k4 + 1] = oy; O[k4 + 2] = clamp((p.age - p.burn) / (0.4 * p.burn), 0, 1); O[k4 + 3] = 0;
            // the light it throws follows the fire as it was simulated: bright, then dying as the soot closes in
            if (p.key && fl) {
                const g = (glow[_o.i] + (glow[Math.min(_o.i + 1, glow.length - 1)] - glow[_o.i]) * _o.f) * Math.min(1, heat);
                if (g > 0.02) fl.keep(p.key, p.lp.set(p.pos.x, p.pos.y + rise + (m.ground ? _w.e * sc * 0.35 : 0), p.pos.z), p.light * g, { vel: p.vel, core: Math.max(2, _w.e * sc * 0.2), flicker: 0.25 });
                else p.key = null;
            }
        }
        this.geo.instanceCount = order.length;
        for (const [a, n] of this.attrs) {
            a.needsUpdate = true;
            a.clearUpdateRanges?.();
            a.addUpdateRange?.(0, order.length * n);
        }
        this.mat.uniforms.fogColor.value.copy(fog.color);
        this.mat.uniforms.fogDensity.value = fog.density;
    }

    // the summed area of the live quads (m²): what the tests and the bench mean by overdraw
    area() {
        let a = 0;
        const m = this.book && this.book.meta;
        if (!m) return 0;
        for (const p of this.list) {
            if (p.age < 0) continue;
            frameAt(this.times, p.start + (1 - p.start) * p.age / p.life, _o);
            const e = windowAt(m, _o.i, _o.f, _w).e * p.scale;
            a += e * e;
        }
        return a;
    }

    clear() {
        for (const p of this.list) this.pool.push(p);
        this.list.length = 0;
        this.geo.instanceCount = 0;
    }
}
