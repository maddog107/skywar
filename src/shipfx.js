// ═══════════════════════════════════════════════════════════════
// Ship ↔ sea interaction: makes hulls sit IN the water instead of on it.
//  • createWake(ship)      V-shaped wake that follows the ship's real path: a long white/turquoise
//                          turbulent band from the transom (fades over ~1.5 km) + faint Kelvin arms
//                          (19.5°) that start at the bow.
//  • createFoamLine(ship)  foam where the hull meets the water, the bow wave (a crest peeling off the
//                          stem, the water piled up against it) and the churn at the transom.
//  • createHullShadow(ship) darker water / contact occlusion hugging the hull, plus the flight deck's
//                          (or main deck's) shadow projected on the sea along the sun direction.
//  • seaMotion(t, seed, amp) gentle heave / pitch / roll for naval.js to apply (deck height helper
//                          in INTEGRATION.md keeps landings consistent).
//  • ShipFX                 owns all of the above for every ship: add(ship, layout) / remove(ship) /
//                          update(dt, game) / clear().
// Everything is drawn as transparent decals just above the flat water plane (world.js, y = 0), after
// the water (renderOrder > 1), depth-tested so hulls hide them. Nothing touches the DOM at import time.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { offsetUnits, mulberry32 } from './util.js';

const TAN_KELVIN = Math.tan(19.47 * Math.PI / 180);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// ── Sea motion ──
// Sum of three incommensurate sines per axis; amplitudes: heave m, pitch / roll degrees.
export const SEA_MOTION = {
    carrier: { heave: 0.28, pitch: 0.12, roll: 0.2 },
    destroyer: { heave: 0.55, pitch: 0.45, roll: 1.4 },
};
export function seaMotion(t, seed = 0, amp = SEA_MOTION.carrier, out = { heave: 0, pitch: 0, roll: 0 }) {
    const s = seed * 12.9898;
    const D = Math.PI / 180;
    out.heave = amp.heave * (0.62 * Math.sin(t * 0.57 + s) + 0.28 * Math.sin(t * 0.353 + s * 2.1) + 0.1 * Math.sin(t * 1.07 + s * 0.7));
    out.pitch = amp.pitch * D * (0.7 * Math.sin(t * 0.49 + s * 1.3) + 0.3 * Math.sin(t * 0.83 + s * 0.4));
    out.roll = amp.roll * D * (0.65 * Math.sin(t * 0.41 + s * 0.9) + 0.35 * Math.sin(t * 0.67 + s * 1.7));
    return out;
}

// Height of a ship's (tilted, heaving) deck at ship-local lx, lz for a mesh rotated YXZ (heading, pitch x, roll z)
export function deckHeightAt(mesh, deckY, lx, lz) {
    const p = mesh.rotation.x, r = mesh.rotation.z;
    return mesh.position.y + (lx * Math.sin(r) + deckY * Math.cos(r)) * Math.cos(p) - lz * Math.sin(p);
}

// ── Shared foam texture (tileable: R = cellular foam web, G = fbm, B = streaks) ──
let foamTex = null;
export function foamTexture() {
    if (foamTex) return foamTex;
    const N = 256, data = new Uint8Array(N * N * 4), rnd = mulberry32(9127);
    const lattice = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
    const vnoise = (lat, n, x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        const a = lat[y0 * n + x0], b = lat[y0 * n + x1], c = lat[y1 * n + x0], d = lat[y1 * n + x1];
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const L = [lattice(4), lattice(8), lattice(16), lattice(32), lattice(64)];
    const LS = lattice(64);
    const C = 12, cells = [];
    for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) cells.push([i + rnd(), j + rnd()]);
    const C2 = 26, cells2 = [];
    for (let j = 0; j < C2; j++) for (let i = 0; i < C2; i++) cells2.push([i + rnd(), j + rnd()]);
    const worley = (pts, n, x, y) => {
        let f1 = 9, f2 = 9;
        const cx = Math.floor(x), cy = Math.floor(y);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ci = cx + di, cj = cy + dj;
            const wi = ((ci % n) + n) % n, wj = ((cj % n) + n) % n;
            const w = pts[wj * n + wi];
            const dx = ci + (w[0] - wi) - x, dy = cj + (w[1] - wj) - y, d = Math.sqrt(dx * dx + dy * dy);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        return f2 - f1;
    };
    const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
        const u = px / N, v = py / N;
        let f = 0, amp = 0.5;
        for (let k = 0; k < 5; k++) { const n = 4 << k; f += amp * vnoise(L[k], n, u * n, v * n); amp *= 0.5; }
        f /= 0.96875;
        // lacy foam: cell borders, broken up by the fbm so the web never reads as a regular net
        let g = 0, ga = 0.5;
        for (let k = 1; k < 5; k++) { const n = 4 << k; g += ga * vnoise(L[k], n, (u + 0.37) * n, (v + 0.61) * n); ga *= 0.5; }
        const breakup = ss(0.3, 0.62, g / 0.47);
        const web = (1 - ss(0.0, 0.12, worley(cells, C, u * C, v * C))) * breakup;
        const web2 = (1 - ss(0.0, 0.1, worley(cells2, C2, u * C2, v * C2))) * (1 - breakup * 0.6);
        const foam = Math.min(1, Math.max(0, web * 0.4 + web2 * 0.3 + (f - 0.5) * 1.1 + 0.2));
        const streak = vnoise(LS, 64, u * 4, v * 64) * 0.6 + vnoise(L[4], 64, u * 8, v * 64) * 0.4;
        const i = (py * N + px) * 4;
        data[i] = foam * 255; data[i + 1] = f * 255; data[i + 2] = streak * 255; data[i + 3] = 255;
    }
    foamTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
    foamTex.magFilter = THREE.LinearFilter;
    foamTex.minFilter = THREE.LinearMipmapLinearFilter;
    foamTex.generateMipmaps = true;
    foamTex.anisotropy = 8;
    foamTex.needsUpdate = true;
    return foamTex;
}

// ── Materials ──
const COMMON_VS = /* glsl */`
    attribute vec4 aData;
    varying vec4 vData;
    varying vec3 vWorld;
    void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vData = aData;
        gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
const COMMON_FS_HEAD = /* glsl */`
    uniform sampler2D foamMap;
    uniform vec3 light, fogColor;
    uniform float time, fogDensity, fade, speedK;
    varying vec4 vData;
    varying vec3 vWorld;
    vec4 finish(vec3 col, float a) {
        float dist = length(cameraPosition - vWorld);
        float fogF = 1.0 - exp(-pow(fogDensity * dist, 2.0));
        col = mix(col, fogColor, fogF);
        return vec4(col, a * (1.0 - 0.6 * fogF));
    }`;
const TAIL = /* glsl */`
    #include <tonemapping_fragment>
    #include <colorspace_fragment>`;

function fxMaterial(fs, { order = 2, dark = false } = {}) {
    const m = new THREE.ShaderMaterial({
        uniforms: {
            foamMap: { value: foamTexture() }, light: { value: new THREE.Color(1, 1, 1) },
            fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
            time: { value: 0 }, fade: { value: 1 }, speedK: { value: 1 },
        },
        vertexShader: COMMON_VS,
        fragmentShader: COMMON_FS_HEAD + fs,
        transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(-4 - order),
    });
    m.userData.order = order;
    m.userData.dark = dark;
    return m;
}

// turbulent centre wake: aData = (s: path metres fixed to the water, lateral m, d: metres behind the transom, half width)
const WAKE_FS = /* glsl */`
    void main() {
        float s = vData.x, lat = vData.y, d = vData.z, hw = vData.w;
        float x = abs(lat) / hw;
        // ragged edges that wander slowly along the path
        float edgeN = texture2D(foamMap, vec2(s * 0.0035, lat > 0.0 ? 0.31 : 0.77)).g;
        float edge = 1.0 - smoothstep(0.35 + 0.35 * edgeN, 1.0, x);
        float near = exp(-d / 110.0);                  // churned white water right behind the transom
        float mid = exp(-d / 520.0);
        float tail = 1.0 - smoothstep(1050.0, 1750.0, d);
        vec2 uv = vec2(lat * 0.03, s * 0.006);
        float n1 = texture2D(foamMap, uv + vec2(0.0, time * 0.003)).r;
        float n2 = texture2D(foamMap, uv * vec2(2.7, 3.3) + vec2(0.41, 0.13)).r;
        float streak = texture2D(foamMap, vec2(lat * 0.016 + 0.5, s * 0.0014)).b;
        float n = n1 * 0.55 + n2 * 0.45;
        float cover = clamp(near * 0.8 + mid * 0.42 * (0.3 + streak), 0.0, 1.0);
        float foam = smoothstep(1.0 - cover, 1.3 - cover, n);
        // a milky turquoise band (bubbles under the surface) stays long after the white foam has broken up
        float milk = (0.1 + 0.14 * streak) * (0.35 + 0.65 * mid) * (1.0 - 0.5 * x);
        float a = edge * tail * (foam * 0.92 + milk * (1.0 - foam)) * fade * speedK;
        vec3 col = mix(vec3(0.4, 0.68, 0.72), vec3(0.95, 0.98, 1.0), foam) * light;
        gl_FragColor = finish(col, clamp(a, 0.0, 0.9));
        ` + TAIL + `
    }`;

// Kelvin arms: aData = (s, lateral, d from the bow, arm lateral position)
const KELVIN_FS = /* glsl */`
    void main() {
        float s = vData.x, lat = abs(vData.y), d = vData.z, arm = vData.w;
        float w = 0.9 + d * 0.008;
        float line = exp(-pow((lat - arm) / w, 2.0));
        // the cusp line breaks into short white crests (fbm along the arm, a few metres long)
        float n = texture2D(foamMap, vec2(lat * 0.03, s * 0.021)).g;
        float crest = line * smoothstep(0.45, 0.7, n);
        // a faint band of short diverging waves just inside the arm
        float m = texture2D(foamMap, vec2(s * 0.017 - lat * 0.02, lat * 0.035)).g;
        float band = exp(-pow((lat - arm * 0.9) / (w * 4.0), 2.0)) * smoothstep(0.58, 0.8, m) * 0.14;
        float a = (crest + band) * exp(-d / 480.0) * smoothstep(15.0, 80.0, d) * fade * speedK * 0.55;
        vec3 col = vec3(0.92, 0.96, 0.99) * light;
        gl_FragColor = finish(col, clamp(a, 0.0, 0.6));
        ` + TAIL + `
    }`;

// hull foam line + bow wave: aData = (s 0 bow .. 1 stern, r 0 hull .. 1 outer edge, ring width m, -)
const FOAM_FS = /* glsl */`
    void main() {
        float s = vData.x, r = vData.y, width = vData.z, dist = r * width;
        float bowW = exp(-pow(s / 0.2, 2.0));
        float sternW = pow(clamp((s - 0.86) / 0.14, 0.0, 1.0), 1.5);
        float contact = exp(-dist / 1.4);                              // white water rubbing along the hull
        float crest = exp(-pow((r - 0.7) / 0.15, 2.0)) * bowW;         // the bow wave's breaking crest
        float body = (1.0 - r) * bowW;                                 // foam between the stem and the crest
        float churn = sternW * (1.0 - smoothstep(0.2, 1.0, r));        // transom churn
        float I = contact * (0.55 + 0.45 * speedK) + (crest * 1.1 + body * 0.7 + churn) * speedK;
        vec2 p = vWorld.xz;
        float n1 = texture2D(foamMap, p * 0.045 + vec2(time * 0.011, time * 0.007)).r;
        float n2 = texture2D(foamMap, p * 0.11 - vec2(time * 0.017, -time * 0.013)).r;
        float n = n1 * 0.55 + n2 * 0.45;
        float foam = smoothstep(1.0 - I, 1.25 - I, n);
        float halo = clamp(I, 0.0, 1.0) * 0.18 * (1.0 - r);
        float a = (foam + halo * (1.0 - foam)) * (1.0 - smoothstep(0.8, 1.0, r)) * fade;
        vec3 col = mix(vec3(0.4, 0.7, 0.74), vec3(0.97, 0.99, 1.0), foam) * light;
        gl_FragColor = finish(col, clamp(a, 0.0, 0.95));
        ` + TAIL + `
    }`;

// dark decals: contact occlusion ring and projected deck shadow: aData = (alpha, -, -, -)
const DARK_FS = /* glsl */`
    uniform vec3 darkColor;
    uniform float strength;
    void main() {
        float a = vData.x * strength * fade;
        gl_FragColor = finish(darkColor, clamp(a, 0.0, 0.9));
        ` + TAIL + `
    }`;

// ── Geometry helpers ──
function makeGeo(maxVerts, index) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.BufferAttribute(new Float32Array(maxVerts * 4), 4).setUsage(THREE.DynamicDrawUsage));
    if (index) g.setIndex(index);
    return g;
}
function stripIndex(nPts) {
    const idx = [];
    for (let i = 0; i < nPts - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
    }
    return idx;
}

// Simple outline for ships without a layout: pointed bow, rounded mid-body, transom
export function genericWaterline(L, halfBeam, n = 18) {
    const pts = [], zb = -L / 2, zs = L / 2;
    for (let i = 0; i <= n; i++) {
        const s = i / n;
        const z = zb + s * (zs - zb);
        const fore = 1 - Math.pow(1 - Math.min(s / 0.4, 1), 2.2);
        const aft = 1 - 0.3 * Math.pow(Math.max(0, (s - 0.8) / 0.2), 2);
        pts.push([halfBeam * fore * aft, z]);
    }
    const port = pts.slice().reverse().map(([x, z]) => [-x, z]);
    return pts.concat(port);
}

// outward unit normals of a closed (x, z) outline, with mitre scaling at sharp corners
function outlineNormals(pts) {
    const n = pts.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < n; i++) {
        const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
        let e1x = c[0] - p[0], e1z = c[1] - p[1], e2x = q[0] - c[0], e2z = q[1] - c[1];
        const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1;
        e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
        let nx = sgn * (e1z + e2z), nz = -sgn * (e1x + e2x);
        const ln = Math.hypot(nx, nz) || 1;
        nx /= ln; nz /= ln;
        const cosHalf = Math.max(0.35, nx * sgn * e1z + nz * -sgn * e1x);
        out.push([nx / cosHalf, nz / cosHalf]);
    }
    return out;
}

// resample a closed outline to roughly equal spacing
function resample(pts, step) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const k = Math.max(1, Math.round(len / step));
        for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    return out;
}

// triangulated polygon + a soft outer band (alpha 1 inside → 0 at `soft` metres outside)
function softPolygon(pts, soft, alpha = 1, y = 0.04) {
    const n = pts.length;
    const nrm = outlineNormals(pts);
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const pos = [], dat = [], idx = [];
    for (let i = 0; i < n; i++) { pos.push(pts[i][0], y, pts[i][1]); dat.push(alpha, 0, 0, 0); }
    for (let i = 0; i < n; i++) { pos.push(pts[i][0] + nrm[i][0] * soft, y, pts[i][1] + nrm[i][1] * soft); dat.push(0, 0, 0, 0); }
    for (const t of tris) idx.push(t[0], t[2], t[1]);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        idx.push(i, n + i, j, j, n + i, n + j);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.Float32BufferAttribute(dat, 4));
    g.setIndex(idx);
    fixWinding(g);
    return g;
}

// make every triangle face +y (so the decals don't depend on outline winding)
function fixWinding(g) {
    const p = g.attributes.position.array, idx = g.index.array;
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
        if (uz * vx - ux * vz < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    }
}

function applyEnv(mat, env) {
    const u = mat.uniforms;
    u.time.value = env.time;
    u.fogColor.value.copy(env.fogColor);
    u.fogDensity.value = env.fogDensity;
    u.light.value.copy(env.light);
}

// ═════════════ Wake ═════════════
class Wake {
    constructor(scene, ship, geom) {
        this.ship = ship;
        this.g = geom;
        this.seg = geom.seg || 8;
        this.maxLen = geom.maxLen || 1800;
        this.maxPts = Math.ceil(this.maxLen / this.seg) + 24;
        this.pts = [];          // recorded transom positions: { x, z, s, t }
        this.travel = 0;
        this.last = null;
        this.time = 0;
        this.matW = fxMaterial(WAKE_FS, { order: 3 });
        this.matK = fxMaterial(KELVIN_FS, { order: 2 });
        this.meshW = new THREE.Mesh(makeGeo(this.maxPts * 2, stripIndex(this.maxPts)), this.matW);
        this.meshK = new THREE.Mesh(makeGeo((this.maxPts + 8) * 2, stripIndex(this.maxPts + 8)), this.matK);
        for (const m of [this.meshW, this.meshK]) {
            m.frustumCulled = false;
            m.renderOrder = 1 + m.material.userData.order;
            m.geometry.setDrawRange(0, 0);
            scene.add(m);
        }
        this.scene = scene;
    }

    // world position of a ship-local point on the water (heading only)
    local(lx, lz, out) {
        const s = this.ship, c = Math.cos(s.heading), sn = Math.sin(s.heading);
        return out.set(s.mesh.position.x + lx * c + lz * sn, 0, s.mesh.position.z - lx * sn + lz * c);
    }

    update(dt, env) {
        const s = this.ship;
        this.time += dt;
        const stern = this.local(0, this.g.sternZ, _v);
        if (this.last) this.travel += Math.hypot(stern.x - this.last.x, stern.z - this.last.z);
        this.last = { x: stern.x, z: stern.z };
        const alive = s.alive !== false;
        if (alive && (!this.pts.length || this.travel - this.pts[0].s >= this.seg)) {
            this.pts.unshift({ x: stern.x, z: stern.z, s: this.travel, t: this.time });
        }
        while (this.pts.length > 1 && (this.travel - this.pts[this.pts.length - 1].s > this.maxLen || this.pts.length > this.maxPts - 2)) this.pts.pop();
        const speed = s.vel ? Math.hypot(s.vel.x, s.vel.z) : 10;
        const speedK = Math.min(1.2, Math.max(0.25, speed / 11));
        const fade = env.fade;
        for (const m of [this.matW, this.matK]) {
            applyEnv(m, env);
            m.uniforms.fade.value = fade;
            m.uniforms.speedK.value = speedK;
        }
        this.buildWake(stern);
        this.buildKelvin(stern);
    }

    buildWake(stern) {
        const P = [{ x: stern.x, z: stern.z, s: this.travel, t: this.time }, ...this.pts];
        const n = Math.min(P.length, this.maxPts);
        const geo = this.meshW.geometry, pos = geo.attributes.position.array, dat = geo.attributes.aData.array;
        const w0 = this.g.sternHalf;
        for (let i = 0; i < n; i++) {
            const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
            let tx = a.x - b.x, tz = a.z - b.z;
            const tl = Math.hypot(tx, tz) || 1;
            tx /= tl; tz /= tl;
            if (i === 0 && n === 1) { tx = -Math.sin(this.ship.heading); tz = -Math.cos(this.ship.heading); }
            const nx = tz, nz = -tx;
            const d = this.travel - P[i].s;
            const age = this.time - P[i].t;
            const hw = w0 * 0.85 + d * 0.03 + (1 - Math.exp(-d / 60)) * w0 * 0.5;
            const ageFade = Math.exp(-age / 200);
            for (let k = 0; k < 2; k++) {
                const sg = k ? 1 : -1, j = i * 2 + k;
                pos[j * 3] = P[i].x + nx * hw * sg;
                pos[j * 3 + 1] = 0.06;
                pos[j * 3 + 2] = P[i].z + nz * hw * sg;
                dat[j * 4] = P[i].s; dat[j * 4 + 1] = hw * sg; dat[j * 4 + 2] = d + (1 - ageFade) * 1800; dat[j * 4 + 3] = hw;
            }
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aData.needsUpdate = true;
        geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    }

    buildKelvin(stern) {
        // points along the hull from the bow to the transom, then the recorded path
        const hullLen = this.g.sternZ - this.g.bowZ;
        const P = [];
        const K = 6;
        for (let k = 0; k < K; k++) {
            const lz = this.g.bowZ + hullLen * k / K;
            const w = this.local(0, lz, _v2);
            P.push({ x: w.x, z: w.z, s: this.travel + (this.g.sternZ - lz), d: lz - this.g.bowZ, t: this.time });
        }
        for (const p of [{ x: stern.x, z: stern.z, s: this.travel, t: this.time }, ...this.pts]) {
            P.push({ x: p.x, z: p.z, s: p.s, d: hullLen + this.travel - p.s, t: p.t });
        }
        const n = Math.min(P.length, this.maxPts + 8);
        const geo = this.meshK.geometry, pos = geo.attributes.position.array, dat = geo.attributes.aData.array;
        let used = 0;
        for (let i = 0; i < n; i++) {
            if (P[i].d > 1000) break;
            const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
            let tx = a.x - b.x, tz = a.z - b.z;
            const tl = Math.hypot(tx, tz) || 1;
            tx /= tl; tz /= tl;
            const nx = tz, nz = -tx;
            const d = P[i].d;
            const arm = d * TAN_KELVIN + this.g.bowHalf;
            const hw = arm + 8 + d * 0.04;
            const ageFade = Math.exp(-(this.time - P[i].t) / 120);
            for (let k = 0; k < 2; k++) {
                const sg = k ? 1 : -1, j = i * 2 + k;
                pos[j * 3] = P[i].x + nx * hw * sg;
                pos[j * 3 + 1] = 0.05;
                pos[j * 3 + 2] = P[i].z + nz * hw * sg;
                dat[j * 4] = P[i].s; dat[j * 4 + 1] = hw * sg; dat[j * 4 + 2] = d + (1 - ageFade) * 1000; dat[j * 4 + 3] = arm;
            }
            used = i + 1;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aData.needsUpdate = true;
        geo.setDrawRange(0, Math.max(0, used - 1) * 6);
    }

    dispose() {
        for (const m of [this.meshW, this.meshK]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    }
}

// ═════════════ Hull foam line + bow wave ═════════════
class FoamLine {
    constructor(parent, outline, g) {
        const pts = resample(outline, g.step || 4);
        const nrm = outlineNormals(pts);
        let zmin = Infinity, zmax = -Infinity;
        for (const p of pts) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
        const R = [0, 0.08, 0.2, 0.4, 0.62, 0.76, 0.88, 1];
        const n = pts.length, rows = R.length;
        const pos = new Float32Array(n * rows * 3), dat = new Float32Array(n * rows * 4);
        const Lh = zmax - zmin;
        for (let i = 0; i < n; i++) {
            const [x, z] = pts[i];
            const s = (z - zmin) / Lh;
            // bow wave: a crest that leaves the stem and runs out and aft, ~ first third of the hull
            const bowW = Math.exp(-Math.pow(s / 0.22, 2));
            const sternW = Math.min(1, Math.max(0, (s - 0.86) / 0.14)) ** 1.5;
            // ring width: thin contact foam, widened by the bow wave (out to ~s 0.15, back by 0.3), a little
            // pile-up just ahead of the stem, and the churn round the transom
            const bump = s < 0.3 ? Math.sin(s / 0.3 * Math.PI) : 0;
            const width = (g.contact || 2.4) + (g.bowWave || 16) * (0.6 * bump + 0.35 * Math.exp(-s / 0.03)) + (g.sternWave || 7) * sternW;
            for (let k = 0; k < rows; k++) {
                const r = R[k], j = i * rows + k;
                const ox = x + nrm[i][0] * width * r, oz = z + nrm[i][1] * width * r;
                const pile = (g.pile || 0.7) * bowW * Math.exp(-Math.pow((r - 0.1) / 0.35, 2));
                pos[j * 3] = ox; pos[j * 3 + 1] = 0.08 + pile; pos[j * 3 + 2] = oz;
                dat[j * 4] = s; dat[j * 4 + 1] = r; dat[j * 4 + 2] = width; dat[j * 4 + 3] = 0;
            }
        }
        const idx = [];
        for (let i = 0; i < n; i++) {
            const i2 = (i + 1) % n;
            for (let k = 0; k < rows - 1; k++) {
                const a = i * rows + k, b = i2 * rows + k, c = i * rows + k + 1, d = i2 * rows + k + 1;
                idx.push(a, c, b, b, c, d);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aData', new THREE.BufferAttribute(dat, 4));
        geo.setIndex(idx);
        fixWinding(geo);
        geo.computeBoundingSphere();
        this.mat = fxMaterial(FOAM_FS, { order: 4 });
        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.renderOrder = 5;
        parent.add(this.mesh);
        // contact occlusion: darker water hugging the hull
        const occl = [];
        const R2 = [0, 1];
        const opos = [], odat = [];
        for (let i = 0; i < n; i++) {
            const [x, z] = pts[i];
            const w = g.occlusion || 9;
            for (const r of R2) {
                opos.push(x + nrm[i][0] * w * r - nrm[i][0] * 0.3 * (1 - r), 0.03, z + nrm[i][1] * w * r - nrm[i][1] * 0.3 * (1 - r));
                odat.push(Math.pow(1 - r, 1.6), 0, 0, 0);
            }
        }
        for (let i = 0; i < n; i++) {
            const i2 = (i + 1) % n;
            occl.push(i * 2, i * 2 + 1, i2 * 2, i2 * 2, i * 2 + 1, i2 * 2 + 1);
        }
        const og = new THREE.BufferGeometry();
        og.setAttribute('position', new THREE.Float32BufferAttribute(opos, 3));
        og.setAttribute('aData', new THREE.Float32BufferAttribute(odat, 4));
        og.setIndex(occl);
        fixWinding(og);
        og.computeBoundingSphere();
        this.omat = fxMaterial(DARK_FS, { order: 1, dark: true });
        this.omat.uniforms.darkColor = { value: new THREE.Color(0.006, 0.03, 0.045) };
        this.omat.uniforms.strength = { value: g.occlusionStrength || 0.5 };
        this.omesh = new THREE.Mesh(og, this.omat);
        this.omesh.renderOrder = 2;
        parent.add(this.omesh);
    }

    update(env, speedK) {
        for (const m of [this.mat, this.omat]) {
            applyEnv(m, env);
            m.uniforms.fade.value = env.fade;
            m.uniforms.speedK.value = speedK;
        }
    }

    dispose() {
        for (const m of [this.mesh, this.omesh]) { m.parent && m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); }
    }
}

// ═════════════ Projected deck shadow ═════════════
class HullShadow {
    constructor(scene, deckPoly, height, g) {
        this.height = height;
        this.mat = fxMaterial(DARK_FS, { order: 1, dark: true });
        this.mat.uniforms.darkColor = { value: new THREE.Color(0.004, 0.022, 0.035) };
        this.mat.uniforms.strength = { value: g.shadowStrength || 0.34 };
        this.mesh = new THREE.Mesh(softPolygon(deckPoly, g.shadowSoft || 5, 1, 0.035), this.mat);
        this.mesh.geometry.computeBoundingSphere();
        this.mesh.renderOrder = 2;
        this.mesh.rotation.order = 'YXZ';
        scene.add(this.mesh);
        this.scene = scene;
    }

    update(ship, env, sunDir) {
        const up = Math.max(sunDir.y, 0.12);
        const h = this.height + (ship.mesh.position.y || 0);
        let ox = -sunDir.x / up * h, oz = -sunDir.z / up * h;
        const ol = Math.hypot(ox, oz), maxL = h * 3;
        if (ol > maxL) { ox *= maxL / ol; oz *= maxL / ol; }
        this.mesh.position.set(ship.mesh.position.x + ox, 0, ship.mesh.position.z + oz);
        this.mesh.rotation.y = ship.heading;
        applyEnv(this.mat, env);
        this.mat.uniforms.fade.value = env.fade * Math.min(1, Math.max(0, (sunDir.y - 0.03) * 6)) * env.sunK;
    }

    dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ═════════════ Public factories ═════════════
function shipGeom(ship, layout) {
    const def = ship.def || { L: 150, B: 20, deckY: 8 };
    const isCarrier = ship.type === 'carrier';
    const waterline = layout && layout.waterline ? layout.waterline : genericWaterline(def.L * 0.94, (isCarrier ? 40 : def.B) * 0.5);
    let zmin = Infinity, zmax = -Infinity, sternHalf = 0, bowHalf = 0;
    for (const [, z] of waterline) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    for (const [x, z] of waterline) {
        if (z > zmax - 1.5) sternHalf = Math.max(sternHalf, Math.abs(x));
        if (z < zmin + 12) bowHalf = Math.max(bowHalf, Math.abs(x));
    }
    const deck = layout && layout.deck ? layout.deck : genericWaterline(def.L, (isCarrier ? def.B : def.B) * 0.5, 10);
    const beam = (isCarrier ? 40 : def.B);
    return {
        waterline, deck,
        deckY: (layout && (layout.shadowY || layout.deckY)) || def.deckY,
        sternZ: zmax, bowZ: zmin, sternHalf: Math.max(sternHalf, beam * 0.25), bowHalf: Math.max(bowHalf * 0.5, 2),
        bowWave: isCarrier ? 22 : 14, sternWave: isCarrier ? 10 : 7, contact: isCarrier ? 4.5 : 3.2,
        pile: isCarrier ? 1.5 : 1.1, occlusion: isCarrier ? 11 : 7,
        maxLen: isCarrier ? 1800 : 1400, seg: 8,
    };
}

export function createWake(scene, ship, layout) { return new Wake(scene, ship, shipGeom(ship, layout)); }
export function createFoamLine(parent, ship, layout) { const g = shipGeom(ship, layout); return new FoamLine(parent, g.waterline, g); }
export function createHullShadow(scene, ship, layout) { const g = shipGeom(ship, layout); return new HullShadow(scene, g.deck, g.deckY, g); }

// ═════════════ Manager ═════════════
export class ShipFX {
    constructor(scene) {
        this.scene = scene;
        this.entries = new Map();
        this.time = 0;
        this.env = { time: 0, light: new THREE.Color(1, 1, 1), fogColor: new THREE.Color(), fogDensity: 0, fade: 1, sunK: 1 };
        this.enabled = true;
    }

    add(ship, layout = null) {
        if (this.entries.has(ship)) return;
        const follow = new THREE.Group();
        follow.name = 'shipfx:follow';
        this.scene.add(follow);
        const e = {
            follow,
            wake: createWake(this.scene, ship, layout),
            foam: createFoamLine(follow, ship, layout),
            shadow: createHullShadow(this.scene, ship, layout),
            sprayT: 0,
            geom: shipGeom(ship, layout),
        };
        this.entries.set(ship, e);
    }

    remove(ship) {
        const e = this.entries.get(ship);
        if (!e) return;
        e.wake.dispose(); e.foam.dispose(); e.shadow.dispose();
        this.scene.remove(e.follow);
        this.entries.delete(ship);
    }

    clear() { for (const s of [...this.entries.keys()]) this.remove(s); }

    // light reaching an upward-facing white surface, matched to MeshStandardMaterial's diffuse term
    updateLight(world) {
        const L = this.env.light;
        if (!world || !world.sun) { L.setRGB(1, 1, 1); return; }
        const sd = world.sunDir || _v.set(0.3, 0.8, 0.2);
        const sunUp = Math.max(sd.y, 0);
        L.copy(world.sun.color).multiplyScalar(world.sun.intensity * sunUp);
        if (world.hemi) { const h = world.hemi.color, k = world.hemi.intensity; L.r += h.r * k; L.g += h.g * k; L.b += h.b * k; }
        L.multiplyScalar(1 / Math.PI * 1.05);
        this.env.sunK = Math.min(1, sunUp * 3);
    }

    update(dt, game) {
        this.time += dt;
        const env = this.env;
        env.time = this.time;
        const world = game && game.world;
        this.updateLight(world);
        const fog = game && game.scene && game.scene.fog;
        if (fog) { env.fogColor.copy(fog.color); env.fogDensity = fog.density || 0; }
        const sunDir = (world && world.sunDir) || _v.set(0.3, 0.8, 0.2);
        const fx = game && game.effects;
        for (const [ship, e] of this.entries) {
            const sinking = ship.alive === false ? Math.min(1, (ship.sinkT || 0) / 25) : 0;
            env.fade = 1 - sinking;
            e.follow.position.set(ship.mesh.position.x, 0, ship.mesh.position.z);
            e.follow.rotation.set(0, ship.heading, 0);
            e.follow.visible = env.fade > 0.01;
            const speed = ship.vel ? Math.hypot(ship.vel.x, ship.vel.z) : 10;
            const speedK = Math.min(1.2, Math.max(0.2, speed / 11));
            e.wake.update(dt, env);
            e.foam.update(env, speedK);
            e.shadow.update(ship, env, sunDir);
            // bow spray: a few puffs where the bow wave breaks (more for fast, fine-bowed escorts)
            e.sprayT -= dt;
            if (fx && fx.smoke && e.sprayT <= 0 && ship.alive !== false && speed > 4) {
                e.sprayT = ship.type === 'carrier' ? 0.35 : 0.14;
                const side = Math.random() < 0.5 ? -1 : 1;
                const lz = e.geom.bowZ + 4 + Math.random() * 10;
                const c = Math.cos(ship.heading), sn = Math.sin(ship.heading);
                const lx = side * (2 + Math.random() * 3);
                const p = _v.set(ship.mesh.position.x + lx * c + lz * sn, 0.6, ship.mesh.position.z - lx * sn + lz * c);
                const vx = side * c * 3 + (ship.vel ? ship.vel.x * 0.6 : 0), vz = -side * sn * 3 + (ship.vel ? ship.vel.z * 0.6 : 0);
                const k = ship.type === 'carrier' ? 1 : 0.8;
                fx.smoke.emit(p, new THREE.Vector3(vx, 2.5 + Math.random() * 2, vz), 1.6, 2 * k, 7 * k, [0.95, 0.97, 1], [0.9, 0.94, 0.97], 0.35, 0, 0.8, -4);
            }
        }
    }
}
