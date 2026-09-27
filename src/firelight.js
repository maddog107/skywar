// ═══════════════════════════════════════════════════════════════
// Fire light: the light of fires, rocket motors, launch flashes, explosions, flares, muzzle flashes and flak bursts
// on everything around them (the night half of docs/WAR.md "Night and weather").
//
// three.js lights change every shader program when their count changes, so this is one fixed-size list instead:
// every frame the brightest few candidates (the budget: 4 / 8 / 16 / 32 by quality) go into a small float texture,
// and every built-in lit material (MeshStandard / Lambert / Phong / Physical / Toon: the terrain, buildings, trees,
// vehicles, ships, aircraft) runs them through its own BRDF (RE_Direct) in a loop bounded by a uniform count.
// Nothing recompiles when fires start or go out, and with nothing burning (daylight, or no candidates) the loop is
// a single uniform test. The same list lights the smoke over its fires (effects.js), the clouds from inside
// (clouds.js: a separate top-few), the sea (ocean.js) and the glow in haze, fog and rain (nightfx.js).
//
// The texture (FIRE_MAX × 4, RGBA float), one column per light:
//   row 0: view-space position, range (m)          (written just before the world scene renders, for its camera)
//   row 1: colour × intensity (linear, "candela"), soft-core radius (m)
//   row 2: world position, cloud gain
//   row 3: glow gain (in-scatter in haze/fog/rain), kind, 0, 0
// Irradiance at distance d: colour × I / (d² + core²) × (1 − d²/range²)², the same inverse square as a three.js
// point light, softened at the core and windowed to zero at the range.
//
// Sources:
//   flash(pos, I, life, opts)     a burst that decays (explosions, launch flashes, flak, muzzle flashes, lightning);
//                                 calls close together in space and time merge (a plume lit every frame)
//   keep(key, pos, I, opts)       a light that lives while it's refreshed every frame (a missile motor, a flare)
//   heat(pos, size)               a fire: effects.puffFire and burning smoke columns report their flames here, into
//                                 48 m cells whose heat builds up and dies away, so every burning thing — ground
//                                 targets, buildings, ships, cars, wreckage, the war's fuel dumps — lights its
//                                 surroundings without knowing about this module
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

export const FIRE_MAX = 32;          // columns in the light texture (the loop bound in every lit shader)
const ROWS = 4;
// per quality: surface lights, lights inside the clouds' march, lights for the haze glow
export const FIRE_QUALITY = {
    low: { n: 4, cloud: 0, glow: 0 },
    medium: { n: 8, cloud: 0, glow: 4 },
    high: { n: 16, cloud: 4, glow: 6 },
    ultra: { n: 32, cloud: 8, glow: 8 },
};
export const CLOUD_LIGHTS = 8;       // uniform slots in the cloud march
export const GLOW_LIGHTS = 8;        // uniform slots in the glow pass
const CELL = 48;                     // fire cell size (m)
const HEAT_TAU = 3;                  // s: how long a cell's heat lasts after its last flame
const POOL = 160;                    // flash / keep entries

export const FIRE_COLORS = {
    fire: [1, 0.42, 0.12], flash: [1, 0.66, 0.34], motor: [1, 0.72, 0.42], flare: [1, 0.88, 0.66],
    muzzle: [1, 0.74, 0.4], flak: [1, 0.6, 0.3], lightning: [0.72, 0.8, 1], burn: [1, 0.5, 0.16],
};

// ── shared GPU state ──
const texData = new Float32Array(FIRE_MAX * ROWS * 4);
const fireTex = new THREE.DataTexture(texData, FIRE_MAX, ROWS, THREE.RGBAFormat, THREE.FloatType);
fireTex.minFilter = fireTex.magFilter = THREE.NearestFilter;
fireTex.generateMipmaps = false;
fireTex.needsUpdate = true;
export const FIRE = {
    tex: fireTex,
    // x: lights in the texture while the world scene renders (0 otherwise: the cockpit scene, the FLIR's picture),
    // y: lights in it for this frame (what the particle shaders read), z: time (s), w: unused
    info: new Float32Array([0, 0, 0, 0]),
    data: texData,
};

// the loop every lit material runs (after its own lights, before the indirect light)
const LOOP_GLSL = /* glsl */`
#if defined( RE_Direct ) && !defined( NO_FIRE_LIGHTS )
if ( fireLightInfo.x > 0.5 ) {
    int fireN = int( fireLightInfo.x );
    for ( int fi = 0; fi < ${FIRE_MAX}; fi ++ ) {
        if ( fi >= fireN ) break;
        vec4 fa = texelFetch( fireLightTex, ivec2( fi, 0 ), 0 );
        vec3 fL = fa.xyz - geometryPosition;
        float fd2 = dot( fL, fL ), fr2 = fa.w * fa.w;
        if ( fd2 >= fr2 ) continue;
        vec4 fb = texelFetch( fireLightTex, ivec2( fi, 1 ), 0 );
        float fw = 1.0 - fd2 / fr2;
        directLight.color = fb.rgb * ( fw * fw / ( fd2 + fb.w * fb.w ) );
        directLight.direction = fL * inversesqrt( max( fd2, 1e-6 ) );
        directLight.visible = true;
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
}
#endif
`;
// for custom shaders with a view-space position: the summed irradiance (no normal) and the direction it comes from
// mostly (view space, unnormalised). Include after declaring fireLightTex / fireLightInfo.
export const FIRE_VIEW_GLSL = /* glsl */`
    uniform highp sampler2D fireLightTex;
    uniform vec4 fireLightInfo;
    vec3 fireIrradiance( vec3 vp, out vec3 fdir ) {
        vec3 E = vec3( 0.0 );
        fdir = vec3( 0.0 );
        int fireN = int( fireLightInfo.y );
        for ( int fi = 0; fi < ${FIRE_MAX}; fi ++ ) {
            if ( fi >= fireN ) break;
            vec4 fa = texelFetch( fireLightTex, ivec2( fi, 0 ), 0 );
            vec3 fL = fa.xyz - vp;
            float fd2 = dot( fL, fL ), fr2 = fa.w * fa.w;
            if ( fd2 >= fr2 ) continue;
            vec4 fb = texelFetch( fireLightTex, ivec2( fi, 1 ), 0 );
            float fw = 1.0 - fd2 / fr2;
            vec3 e = fb.rgb * ( fw * fw / ( fd2 + fb.w * fb.w ) );
            E += e;
            fdir += fL * inversesqrt( max( fd2, 1e-6 ) ) * dot( e, vec3( 0.3, 0.59, 0.11 ) );
        }
        return E;
    }`;
// the same in world space (the sea, anything drawn with world coordinates)
export const FIRE_WORLD_GLSL = /* glsl */`
    uniform highp sampler2D fireLightTex;
    uniform vec4 fireLightInfo;
    // light i: world position, range; colour × intensity, core
    bool fireLightW( int i, vec3 wp, out vec3 L, out vec3 E ) {
        vec4 fa = texelFetch( fireLightTex, ivec2( i, 2 ), 0 );
        vec4 fr = texelFetch( fireLightTex, ivec2( i, 0 ), 0 );
        L = fa.xyz - wp;
        float fd2 = dot( L, L ), fr2 = fr.w * fr.w;
        if ( fd2 >= fr2 ) return false;
        vec4 fb = texelFetch( fireLightTex, ivec2( i, 1 ), 0 );
        float fw = 1.0 - fd2 / fr2;
        E = fb.rgb * ( fw * fw / ( fd2 + fb.w * fb.w ) );
        L *= inversesqrt( max( fd2, 1e-6 ) );
        return true;
    }`;

// Every built-in lit material gets the loop; its uniforms go into three's ShaderLib (UniformsUtils.clone copies the
// texture object, but the copies share its source, so one upload serves them all; the info array is shared as is)
function installFireLights() {
    const C = THREE.ShaderChunk;
    if (!C.lights_pars_begin.includes('fireLightTex')) C.lights_pars_begin += '\nuniform highp sampler2D fireLightTex;\nuniform vec4 fireLightInfo;\n';
    if (!C.lights_fragment_end.includes('fireLightTex')) C.lights_fragment_end = LOOP_GLSL + C.lights_fragment_end;
    for (const k in THREE.ShaderLib) {
        const L = THREE.ShaderLib[k];
        if (!L.fragmentShader.includes('<lights_pars_begin>')) continue;
        L.uniforms.fireLightTex = { value: FIRE.tex };
        L.uniforms.fireLightInfo = { value: FIRE.info };
    }
}
installFireLights();

// uniforms for a custom ShaderMaterial that includes FIRE_VIEW_GLSL / FIRE_WORLD_GLSL
export function fireUniforms() { return { fireLightTex: { value: FIRE.tex }, fireLightInfo: { value: FIRE.info } }; }

// a fire's flicker: 1 ± ~0.3, smooth, different for every phase
export function flicker(t, ph, amt = 1) {
    return 1 + amt * (0.16 * Math.sin(t * 9.1 + ph) + 0.1 * Math.sin(t * 23.7 + ph * 2.3) + 0.06 * Math.sin(t * 41.3 + ph * 3.7) + 0.08 * Math.sin(t * 3.3 + ph * 1.7));
}

const _m = new THREE.Matrix4();
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const _frustum = new THREE.Frustum(), _sphere = new THREE.Sphere();

// ═══════════════════════════════════════════════════════════════
export class FireLights {
    constructor() {
        this.q = FIRE_QUALITY.high;
        this.time = 0;
        this.ambient = 0.1;      // irradiance of the ambient light where the camera is (weather.js sets it)
        this.night = 1;          // 0 day … 1 night (weather.js)
        this.off = false;        // true: no fire light at all this frame (the FLIR's picture)
        this.gain = 1;
        // flash / keep entries (pooled)
        this.pool = [];
        for (let i = 0; i < POOL; i++) this.pool.push({ used: false, kind: 'flash', key: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), color: [1, 1, 1], I: 0, I0: 0, life: 0, max: 1, seen: 0, core: 1, cloud: 0, glow: 1, flick: 0, ph: 0, vis: 0, sel: false, born: 0, range: 0, cur: 0 });
        this.keys = new Map();   // keep key → entry
        // fire cells (heat from flames)
        this.cells = new Map();  // cell id → cell
        this.cellPool = [];
        // this frame's candidates and choices (preallocated)
        this.cand = [];
        this.chosen = [];        // world positions of the selected lights (for the view-space row)
        this.n = 0;
        // the cloud march's lights (clouds.js reads these arrays): world position + range, colour × I × cloud gain + core
        this.cloud = { a: new Float32Array(CLOUD_LIGHTS * 4), b: new Float32Array(CLOUD_LIGHTS * 4), n: 0, change: 0 };
        // the glow pass's lights (nightfx.js): world position + extinction there, colour × I × glow gain + core
        this.glow = { a: new Float32Array(GLOW_LIGHTS * 4), b: new Float32Array(GLOW_LIGHTS * 4), n: 0 };
        this.extinctionAt = null; // (x, y, z) → 1/m of the air there (weather.js), for the glow
        this.stats = { candidates: 0, chosen: 0, cells: 0 };
    }

    setQuality(q) { this.q = FIRE_QUALITY[q] || FIRE_QUALITY.high; }

    // ── sources ──
    entry(kind) {
        let e = null, worst = null;
        for (const x of this.pool) {
            if (!x.used) { e = x; break; }
            // pool full: take the weakest flash
            if (x.kind === 'flash' && (!worst || x.I < worst.I)) worst = x;
        }
        e = e || worst;
        if (!e) return null;
        if (e.used && e.key != null) this.keys.delete(e.key);
        e.used = true; e.kind = kind; e.key = null; e.vis = 0; e.sel = false; e.born = this.time; e.ph = Math.random() * 100; e.vel.set(0, 0, 0);
        return e;
    }

    // A burst of light that decays over `life` s (quadratically). opts: color, core (m), cloud (gain in the clouds),
    // glow (gain of its halo in haze), merge (m: a flash this close that started under 0.2 s ago is topped up instead)
    flash(pos, I, life = 0.5, opts = {}) {
        if (!(I > 0) || !pos) return null;
        const merge = opts.merge ?? 25;
        if (merge > 0) {
            for (const x of this.pool) {
                if (!x.used || x.kind !== 'flash' || this.time - x.born > 0.2) continue;
                if (x.pos.distanceToSquared(pos) > merge * merge) continue;
                x.pos.copy(pos); x.I0 = Math.max(x.I0 * (x.life / x.max) ** 2, I); x.life = x.max = Math.max(life, 0.05); x.born = this.time;
                return x;
            }
        }
        const e = this.entry('flash');
        if (!e) return null;
        const c = opts.color || FIRE_COLORS.flash;
        e.pos.copy(pos); e.color[0] = c[0]; e.color[1] = c[1]; e.color[2] = c[2];
        e.I0 = I; e.life = e.max = Math.max(life, 0.05); e.core = opts.core ?? Math.max(1.5, Math.sqrt(I) * 0.06);
        e.cloud = opts.cloud ?? 1; e.glow = opts.glow ?? 1; e.flick = opts.flicker ?? 0.3; e.lightning = !!opts.lightning;
        return e;
    }

    // A light that lives while it's refreshed each frame (keyed by its object): a missile motor, a flare.
    // opts: color, core, cloud, glow, flicker, vel (m/s: the position is carried along it between refreshes)
    keep(key, pos, I, opts = {}) {
        let e = this.keys.get(key);
        if (!e || !e.used || e.key !== key) {
            e = this.entry('keep');
            if (!e) return null;
            e.key = key;
            this.keys.set(key, e);
        }
        const c = opts.color || FIRE_COLORS.motor;
        e.pos.copy(pos); e.color[0] = c[0]; e.color[1] = c[1]; e.color[2] = c[2];
        e.I0 = I; e.seen = this.time; e.core = opts.core ?? 2; e.cloud = opts.cloud ?? 1; e.glow = opts.glow ?? 1; e.flick = opts.flicker ?? 0.15;
        if (opts.vel) e.vel.copy(opts.vel); else e.vel.set(0, 0, 0);
        return e;
    }

    // Flames reported by the effects (puffFire, burning smoke columns): heat into the 48 m cell at pos
    heat(pos, size = 1) {
        const ix = Math.floor(pos.x / CELL), iz = Math.floor(pos.z / CELL);
        const id = ix * 73856093 ^ iz * 19349663;
        let c = this.cells.get(id);
        if (!c || c.ix !== ix || c.iz !== iz) {
            if (c) return; // (a hash collision: the other cell keeps it)
            if (this.cells.size >= 256) return;
            c = this.cellPool.pop() || { ix: 0, iz: 0, heat: 0, sx: 0, sy: 0, sz: 0, w: 0, ph: 0, vis: 0, sel: false, pos: new THREE.Vector3(), I: 0, born: 0 };
            c.ix = ix; c.iz = iz; c.heat = 0; c.sx = c.sy = c.sz = c.w = 0; c.ph = Math.random() * 100; c.vis = 0; c.sel = false; c.born = this.time;
            this.cells.set(id, c);
        }
        const h = Math.max(0.2, size);
        c.heat += h;
        // the flames' centre, heat-weighted and slowly forgetting (a fire that spreads carries its light along)
        const k = 0.85;
        c.sx = c.sx * k + pos.x * h; c.sy = c.sy * k + pos.y * h; c.sz = c.sz * k + pos.z * h; c.w = c.w * k + h;
    }

    // lightning: a huge, brief blue-white flash (lights the ground under the bolt; the clouds have their own flash)
    lightning(pos, I = 4e6, life = 0.35) { return this.flash(pos, I, life, { color: FIRE_COLORS.lightning, core: 60, cloud: 0, glow: 0.3, merge: 0, flicker: 0, lightning: true }); }

    clear() {
        for (const e of this.pool) { e.used = false; e.key = null; }
        this.keys.clear();
        for (const c of this.cells.values()) this.cellPool.push(c);
        this.cells.clear();
        this.n = 0; this.cloud.n = 0; this.glow.n = 0;
        FIRE.info[0] = FIRE.info[1] = 0;
    }

    // CPU: the fire light falling on a point (irradiance, same units as the shaders), for sensors and AI
    illuminationAt(p) {
        let E = 0;
        for (let i = 0; i < this.cand.length; i++) {
            const c = this.cand[i];
            const d2 = p.distanceToSquared(c.pos), r2 = c.range * c.range;
            if (d2 >= r2) continue;
            const w = 1 - d2 / r2;
            E += c.I * w * w / (d2 + c.core * c.core);
        }
        return E;
    }

    // ── per frame: decay, score, choose the budget ──
    update(dt, camera) {
        this.time += dt;
        FIRE.info[2] = this.time;
        const q = this.q, cam = camera.position, t = this.time;
        const amb = Math.max(this.ambient, 0.015);
        // what counts as lit: a tenth of the ambient light, never less than 0.002
        const eCut = Math.max(0.002, amb * 0.1);
        _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        _frustum.setFromProjectionMatrix(_m);
        const cand = this.cand;
        cand.length = 0;
        const consider = (src, pos, I, color, core, cloud, glow, cap) => {
            if (!(I > 1e-3)) return;
            const range = Math.min(cap, Math.sqrt(I / eCut));
            _sphere.center.copy(pos); _sphere.radius = range;
            if (!_frustum.intersectsSphere(_sphere)) { src.sel = false; return; }
            const d = Math.max(pos.distanceTo(cam), 25);
            // how much of the view it lights: the patch brighter than ~a third of the ambient, as a share of the view
            let score = I / (amb * 3 * d * d);
            if (score < 2e-5) { src.sel = false; return; }
            if (src.sel) score *= 1.5; // (a light already on stays on: no popping between two of similar weight)
            src.range = range; src.cur = I; src.score = score; src.core = core;
            cand.push(src);
            src._pos = pos; src._color = color; src._cloud = cloud; src._glow = glow;
        };
        // flashes and kept lights
        for (const e of this.pool) {
            if (!e.used) continue;
            let I;
            if (e.kind === 'flash') {
                e.life -= dt;
                if (e.life <= 0) { e.used = false; e.sel = false; continue; }
                const k = e.life / e.max;
                I = e.I0 * k * k * (e.flick ? flicker(t, e.ph, e.flick) : 1);
            } else {
                // not refreshed this frame: gone (a moment's grace, carried along its velocity)
                const age = t - e.seen;
                if (age > 0.12) { e.used = false; e.sel = false; if (e.key != null) this.keys.delete(e.key); e.key = null; continue; }
                if (age > 0) e.pos.addScaledVector(e.vel, dt);
                I = e.I0 * flicker(t, e.ph, e.flick) * (age > 0.05 ? 1 - (age - 0.05) / 0.07 : 1);
            }
            e.I = I;
            consider(e, e.pos, I, e.color, e.core, e.cloud, e.glow, e.lightning ? 7000 : 1500);
        }
        // fire cells: heat decays; light follows the heat through a soft saturation (one burning truck ~ 300 cd, a
        // burning block of buildings a few thousand)
        const kd = Math.exp(-dt / HEAT_TAU);
        for (const [id, c] of this.cells) {
            c.heat *= kd;
            if (c.heat < 0.15 && t - c.born > 1) { this.cells.delete(id); this.cellPool.push(c); c.sel = false; continue; }
            if (c.w <= 0) continue;
            c.pos.set(c.sx / c.w, c.sy / c.w + 2.5, c.sz / c.w);
            // (a young cell ramps up: a moving fire, like burning debris, never stays in one long enough to light up)
            const ramp = Math.min(1, (t - c.born) / 0.6);
            const target = 2600 * (1 - Math.exp(-c.heat / 30)) * ramp;
            c.I = c.I + (target - c.I) * Math.min(1, dt * 3);
            const I = c.I * flicker(t, c.ph, 1.3);
            c.color = c.color || FIRE_COLORS.fire;
            consider(c, c.pos, I, FIRE_COLORS.fire, 3 + Math.min(c.heat, 60) * 0.12, Math.min(1.6, 0.4 + c.heat / 40), 0.8, 700);
        }
        this.stats.candidates = cand.length; this.stats.cells = this.cells.size;
        // the budget: the highest scores (partial selection sort: n ≤ 32 of a few dozen). By day a fire's light hardly
        // shows next to the sun's: a quarter of the budget, for the brightest flashes
        const N = this.off ? 0 : Math.round(Math.min(q.n, FIRE_MAX) * (0.25 + 0.75 * clamp01(this.night)));
        for (const c of cand) c.sel = false;
        let n = 0;
        const data = texData, gain = this.gain;
        const chosen = this.chosen;
        chosen.length = 0;
        for (; n < N; n++) {
            let best = -1, bs = -1;
            for (let i = 0; i < cand.length; i++) { const c = cand[i]; if (!c.sel && c.score > bs) { bs = c.score; best = i; } }
            if (best < 0) break;
            const c = cand[best];
            c.sel = true;
            chosen.push(c);
            const col = c._color, I = c.cur * gain;
            let o = (FIRE_MAX + n) * 4; // row 1
            data[o] = col[0] * I; data[o + 1] = col[1] * I; data[o + 2] = col[2] * I; data[o + 3] = c.core;
            o = (FIRE_MAX * 2 + n) * 4; // row 2
            data[o] = c._pos.x; data[o + 1] = c._pos.y; data[o + 2] = c._pos.z; data[o + 3] = c._cloud;
            o = (FIRE_MAX * 3 + n) * 4; // row 3
            data[o] = c._glow; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
            o = n * 4; // row 0 (view space: filled in just before the scene renders); range now
            data[o + 3] = c.range;
        }
        this.n = n;
        this.stats.chosen = n;
        this.chooseCloud(cand);
        this.chooseGlow(cand, cam);
    }

    // the few lights the clouds' march sees: bright ones near or in the cloud layer (clouds.js reads this.cloud)
    chooseCloud(cand) {
        const C = this.cloud, K = this.off ? 0 : Math.min(this.q.cloud, CLOUD_LIGHTS);
        const slab = this.cloudSlab; // [bottom, top] of the cloud layer (clouds.js sets it)
        let n = 0, fast = 0;
        if (K > 0 && slab) {
            for (const c of cand) c._cs = 0;
            for (const c of cand) {
                if (!(c._cloud > 0)) continue;
                const below = Math.max(0, slab[0] - c._pos.y), above = Math.max(0, c._pos.y - slab[1]);
                const gap = below + above;
                const reach = Math.sqrt(c.cur * c._cloud / 0.02); // (a faint glow on a dark cloud still shows)
                if (gap > Math.min(reach, 2500)) continue;
                c._cs = c.cur * c._cloud / Math.max(gap + 60, 60) ** 2;
            }
            for (; n < K; n++) {
                let best = null, bs = 0;
                for (const c of cand) if (c._cs > bs) { bs = c._cs; best = c; }
                if (!best) break;
                best._cs = 0;
                const I = best.cur * best._cloud * this.gain, col = best._color, o = n * 4;
                C.a[o] = best._pos.x; C.a[o + 1] = best._pos.y; C.a[o + 2] = best._pos.z; C.a[o + 3] = Math.min(Math.sqrt(I / 0.004), 3000);
                C.b[o] = col[0] * I; C.b[o + 1] = col[1] * I; C.b[o + 2] = col[2] * I; C.b[o + 3] = Math.max(best.core, 6);
                // (a young flash changes fast: the clouds' temporal filter should take more of the new frame)
                if (best.kind === 'flash' && best.life > best.max * 0.3) fast = 1;
            }
        }
        C.fast = fast || (n !== C.n ? 1 : 0);
        C.n = n;
    }

    // the lights that glow in the air around them (nightfx.js): brightest halo first, weighted by the extinction there
    chooseGlow(cand, cam) {
        const G = this.glow, K = this.off ? 0 : Math.min(this.q.glow, GLOW_LIGHTS);
        let n = 0;
        if (K > 0) {
            for (const c of cand) {
                c._gs = 0;
                if (!(c._glow > 0)) continue;
                const sig = this.extinctionAt ? this.extinctionAt(c._pos.x, c._pos.y, c._pos.z) : 2e-4;
                c._sig = sig;
                const d = Math.max(c._pos.distanceTo(cam), 30);
                // the halo's brightness where it's seen: I σ / d (the in-scatter integral near the light), dimmed by the
                // air between
                c._gs = c.cur * c._glow * sig / d * Math.exp(-sig * d * 0.5);
            }
            for (; n < K; n++) {
                let best = null, bs = 1e-5 * Math.max(this.ambient, 0.02);
                for (const c of cand) if (c._gs > bs) { bs = c._gs; best = c; }
                if (!best) break;
                best._gs = 0;
                const I = best.cur * best._glow * this.gain, col = best._color, o = n * 4;
                G.a[o] = best._pos.x; G.a[o + 1] = best._pos.y; G.a[o + 2] = best._pos.z; G.a[o + 3] = best._sig;
                G.b[o] = col[0] * I; G.b[o + 1] = col[1] * I; G.b[o + 2] = col[2] * I; G.b[o + 3] = Math.max(best.core, 1);
            }
        }
        G.n = n;
    }

    // Just before the world scene renders, for the camera it renders with: view-space positions, then the upload.
    // (The FLIR's picture gets none: the pod sees heat, not light.)
    beforeRender(renderer, camera) {
        const n = this.off ? 0 : this.n;
        if (n > 0) {
            const e = camera.matrixWorldInverse.elements, data = texData, ch = this.chosen;
            for (let i = 0; i < n; i++) {
                const p = ch[i]._pos, o = i * 4;
                data[o] = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12];
                data[o + 1] = e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13];
                data[o + 2] = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
            }
            fireTex.needsUpdate = true;
            renderer.initTexture(fireTex);
        }
        FIRE.info[0] = n;
        FIRE.info[1] = n;
    }

    // hook a scene: the lights are on only while it renders (the cockpit scene and every other pass see none)
    attachScene(scene) {
        if (scene.userData.fireLights) return;
        scene.userData.fireLights = true;
        const before = scene.onBeforeRender, after = scene.onAfterRender;
        scene.onBeforeRender = (renderer, s, camera, target) => {
            if (camera && camera.isPerspectiveCamera) this.beforeRender(renderer, camera);
            before.call(scene, renderer, s, camera, target);
        };
        scene.onAfterRender = (...a) => { FIRE.info[0] = 0; FIRE.info[1] = 0; after.apply(scene, a); };
    }
}

// the one list everything shares (effects, clouds, the sea, the post passes)
export const fireLights = new FireLights();
