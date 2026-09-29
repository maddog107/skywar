// ═══════════════════════════════════════════════════════════════
// Craters in airfield pavement (docs/WAR.md, "Airbases"), drawn here rather than by craters.js (which keeps off
// runways and airbase grounds on purpose: its holes are cut into the terrain, and pavement is laid over it).
//  • the pavement's materials (runways, taxiways, aprons) are patched to cut each hole out and to paint what's
//    around it: the broken, upheaved edge, cracks running out, a scorched ring, debris and FOD scattered over the
//    surface (cleared by the repair crews) — and, once a crater has been repaired, the square repair patch that
//    stays for the rest of the war (a folded fibreglass FOD cover bolted over the fill, as USAF ADR teams lay them)
//  • the bowl is one instanced mesh drawn through the hole: each fragment finds where the view ray crosses the
//    pavement and is kept only if that point is inside the hole, and it writes that point's depth, so the bowl
//    shows through the ground it lies under (and anything in front of the hole still covers it). Broken concrete,
//    base course and subsoil in its walls; the fill rising in it as the crews dump crushed stone
//  • upheaved slabs of pavement tilted up round the rim and chunks of concrete thrown out (instanced), and yellow
//    crosses on a closed runway's ends
// Everything is in world space; one draw call each for bowls, slabs and crosses whatever the number of craters.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

export const MAX_CRATERS = 64;
const SLABS = 22;               // slab and chunk instances per crater
const XS = 12;                  // closed-runway crosses

// what every patched pavement material reads: a float texture, one column per crater — row 0: (world) x, z, hole
// radius, state (0 open, 1 filling, 2 capping, 3 repaired); row 1: seed, debris (1 → 0 as it's cleared), fill
// (0 → 1), patch rotation (world yaw). (A texture, not uniform arrays: the standard material's fragment shader is
// already close to some GPUs' uniform limits.)
const pcData = new Float32Array(MAX_CRATERS * 2 * 4);
const pcTex = new THREE.DataTexture(pcData, MAX_CRATERS, 2, THREE.RGBAFormat, THREE.FloatType);
pcTex.needsUpdate = true;
export const PAVE_U = { uPcTex: { value: pcTex }, uPcN: { value: 0 } };
const BOWL_SUN = { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() }; // (the sun's direction, for the rim's shadow)

// outline wobble (hole radii) — the same in the pavement, the bowl and the portal test
const GLSL_COMMON = /* glsl */`
    float pcWob(float a, float s) { return 1.0 + 0.11 * sin(3.0 * a + s) + 0.07 * sin(5.0 * a + 2.1 * s) + 0.045 * sin(9.0 * a + 4.3 * s) + 0.03 * sin(17.0 * a + 1.7 * s); }
    float pcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float pcNoise(vec2 p) {
        p = mod(p, 1024.0);
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(pcHash(i), pcHash(i + vec2(1.0, 0.0)), f.x), mix(pcHash(i + vec2(0.0, 1.0)), pcHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }`;

// the pavement: cut the holes, paint the damage and the repairs (after the texture is read)
const PAVE_FRAG = /* glsl */`
    {
        vec2 xz = vPcXZ;
        vec3 base = diffuseColor.rgb;
        for (int i = 0; i < ${MAX_CRATERS}; i++) {
            if (i >= uPcN) break;
            vec4 A = texelFetch(uPcTex, ivec2(i, 0), 0);
            vec2 d = xz - A.xy;
            float R = A.z;
            float dist = length(d);
            if (dist > R * 4.2) continue;
            vec4 B = texelFetch(uPcTex, ivec2(i, 1), 0);
            float ang = atan(d.y, d.x);
            float q = dist / (R * pcWob(ang, B.x));
            float n = pcNoise(xz * 1.7 + B.x * 13.0), n2 = pcNoise(xz * 6.3 - B.x * 7.0);
            if (A.w < 1.5) {
                if (q < 1.0) discard;
                // the broken lip: the surface torn and lifted in pieces (asphalt chunks, the concrete under it showing
                // in the gaps), a ragged width round the hole; cracks running out through the pavement
                float lipW = 1.28 + 0.22 * pcWob(ang * 1.7, B.x + 3.0) + 0.18 * n;
                float lip = 1.0 - smoothstep(1.0, lipW, q);
                float cell = pcHash(floor(xz * 1.6 + B.x));
                vec3 broken = cell > 0.55 ? vec3(0.17, 0.165, 0.15) * (0.8 + 0.4 * n2) : vec3(0.022, 0.022, 0.024) * (0.8 + 0.5 * n2);
                diffuseColor.rgb = mix(diffuseColor.rgb, broken, lip * (0.55 + 0.45 * step(0.3, n2)));
                float crack = smoothstep(0.955, 0.99, abs(sin(ang * (6.0 + floor(B.x * 3.0)) + n * 4.0 + B.x))) * (1.0 - smoothstep(1.15, 2.4 + 1.2 * n, q));
                crack += smoothstep(0.975, 0.995, abs(sin(ang * 13.0 + n2 * 6.0 + B.x * 2.0))) * (1.0 - smoothstep(1.1, 1.8, q));
                diffuseColor.rgb *= 1.0 - 0.7 * clamp(crack, 0.0, 1.0);
                // the blast mark: soot fanned out in streaks, and earth thrown over it
                float streak = 0.6 + 0.4 * sin(ang * 5.0 + B.x * 3.0 + n * 2.0);
                float sc = (1.0 - smoothstep(1.0, (1.9 + 0.9 * streak) + 0.5 * n, q)) * (0.6 + 0.4 * B.y);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.022, 0.02), sc * 0.75);
                float dirt = (1.0 - smoothstep(1.1, 2.2 + n * 1.4 + streak * 0.6, q)) * smoothstep(0.5, 0.85, n2) * B.y;
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.12, 0.085), dirt * 0.85);
            } else {
                // the repair: a square patch lined up with the runway (fibreglass mat, bolted down), and a ring of
                // grit swept off it
                float c = cos(B.w), s = sin(B.w);
                vec2 p = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
                float hs = R * 1.45; // (half side of the patch; "half" is reserved in GLSL ES 3)
                float inside = step(max(abs(p.x), abs(p.y)), hs);
                float edge = inside * (1.0 - smoothstep(0.25, 0.55, hs - max(abs(p.x), abs(p.y))));
                vec3 mat = mix(vec3(0.052, 0.06, 0.05), vec3(0.068, 0.076, 0.064), n2);
                if (A.w < 2.5) mat = mix(vec3(0.16, 0.155, 0.145), mat, B.z); // capping: fresh fill turning into the mat
                diffuseColor.rgb = mix(diffuseColor.rgb, mat, inside);
                diffuseColor.rgb *= 1.0 - 0.6 * edge;
                // bolts every metre along the edge
                vec2 bp = abs(p) - hs + 0.5;
                float bolt = inside * step(max(bp.x, bp.y), 0.25) * step(0.82, fract((abs(p.x) + abs(p.y)) * 1.0));
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.29, 0.26), bolt * 0.8);
                float grit = (1.0 - inside) * (1.0 - smoothstep(hs, hs * 1.6, max(abs(p.x), abs(p.y)))) * smoothstep(0.6, 0.9, n2);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.095, 0.085), grit * 0.4);
            }
            // FOD: chunks and grit scattered past the rim, thinning out, until the crews sweep it (debris → 0)
            float fall = 1.0 - smoothstep(1.2, 2.4 + 1.6 * n, q);
            float fod = B.y * step(1.0 - 0.14 * fall * fall, pcHash(floor(xz * 4.0) + B.x));
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.012, 0.012, 0.012), vec3(0.2, 0.19, 0.17), step(0.6, pcHash(floor(xz * 4.0) * 1.3))), fod * 0.9);
        }
    }`;

// Patch a pavement material (runway, taxiway, apron) so craters cut into it. Idempotent.
export function patchPaving(mat) {
    if (!mat || mat.userData.pcPatched) return mat;
    mat.userData.pcPatched = true;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(mat, sh, r);
        Object.assign(sh.uniforms, PAVE_U);
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vPcXZ;')
            .replace('#include <fog_vertex>', `#include <fog_vertex>
                {
                    vec4 pcW = vec4(transformed, 1.0);
                    #ifdef USE_INSTANCING
                    pcW = instanceMatrix * pcW;
                    #endif
                    vPcXZ = (modelMatrix * pcW).xz;
                }`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec2 vPcXZ;
                uniform highp sampler2D uPcTex;
                uniform int uPcN;
                ${GLSL_COMMON}`)
            .replace('#include <map_fragment>', '#include <map_fragment>\n' + PAVE_FRAG);
    };
    mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + ':pavecrater';
    mat.needsUpdate = true;
    return mat;
}

// ── the bowl: drawn through the hole (see the header) ──
function bowlGeometry() {
    const RINGS = [0, 0.18, 0.34, 0.48, 0.6, 0.7, 0.79, 0.86, 0.92, 0.96, 0.99, 1.0, 1.04, 1.1];
    const SEG = 36;
    const pos = [], idx = [];
    // x, z: position in hole radii (before the wobble); y: 0 at the rim … −1 at the bottom
    const prof = (r) => (r >= 1 ? 0.02 : -Math.pow(1 - Math.pow(r, 2.6), 0.85));
    pos.push(0, prof(0), 0);
    for (let k = 1; k < RINGS.length; k++) for (let j = 0; j < SEG; j++) {
        const a = j / SEG * Math.PI * 2, r = RINGS[k];
        pos.push(Math.cos(a) * r, prof(r), Math.sin(a) * r);
    }
    const ring = (k, j) => 1 + (k - 1) * SEG + (j % SEG);
    for (let j = 0; j < SEG; j++) idx.push(0, ring(1, j + 1), ring(1, j));
    for (let k = 1; k < RINGS.length - 1; k++) for (let j = 0; j < SEG; j++) {
        const a = ring(k, j), b = ring(k, j + 1), c = ring(k + 1, j), d = ring(k + 1, j + 1);
        idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

function bowlMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uCrProj = { value: new THREE.Matrix4() };
        sh.uniforms.uCrSun = BOWL_SUN;
        m.userData.shader = sh;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
                attribute vec4 aCr;   // plane y, depth, fill, seed
                attribute vec4 aCr2;  // centre x, z, radius, unused
                varying vec3 vCrW;
                varying vec4 vCrA, vCrB;
                varying float vCrFill, vCrDepth;
                ${GLSL_COMMON}`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                {
                    float a = atan(transformed.z, transformed.x);
                    transformed.xz *= pcWob(a, aCr.w);
                    // the fill: everything below its level is the flat top of the crushed stone
                    float lvl = -1.0 + aCr.z;
                    vCrFill = step(transformed.y, lvl + 1e-3) * step(0.001, aCr.z);
                    transformed.y = max(transformed.y, lvl);
                    vCrDepth = -transformed.y;
                }`)
            .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
                if (aCr.z > 0.0 && position.y <= -1.0 + aCr.z + 1e-3) objectNormal = vec3(0.0, 1.0, 0.0);`)
            .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
                vCrW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
                vCrA = aCr; vCrB = aCr2;`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform mat4 uCrProj;
                uniform vec3 uCrSun;
                varying vec3 vCrW;
                varying vec4 vCrA, vCrB;
                varying float vCrFill, vCrDepth;
                ${GLSL_COMMON}
                float crIn(vec3 P) {
                    vec2 d = P.xz - vCrB.xy;
                    return length(d) / (vCrB.z * pcWob(atan(d.y, d.x), vCrA.w));
                }`)
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                // the portal: where the view ray crosses the pavement, which must be inside the hole
                vec3 crP = vCrW;
                bool crPortal = cameraPosition.y > vCrA.x + 0.02;
                if (crPortal) {
                    vec3 rd = vCrW - cameraPosition;
                    float t = (vCrA.x - cameraPosition.y) / min(rd.y, -1e-4);
                    crP = cameraPosition + rd * clamp(t, 0.0, 1.0);
                    if (crIn(crP) >= 1.0) discard;
                }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                {
                    float below = vCrA.x - vCrW.y;
                    float n = pcNoise(vCrW.xz * 2.3 + vCrA.w * 9.0), n2 = pcNoise(vCrW.xz * 9.0 + vec2(vCrW.y * 3.0));
                    // the wall's layers: asphalt wearing course, the concrete slab under it, base course, subsoil
                    // (linear colours: the asphalt round it is ~0.035)
                    vec3 asph = vec3(0.028, 0.028, 0.03) * (0.8 + 0.4 * n2);
                    vec3 slab = mix(vec3(0.13, 0.125, 0.115), vec3(0.19, 0.18, 0.165), n2);
                    vec3 course = mix(vec3(0.07, 0.065, 0.056), vec3(0.1, 0.092, 0.078), n2);
                    vec3 soil = mix(vec3(0.045, 0.032, 0.021), vec3(0.07, 0.05, 0.032), n);
                    float l1 = 0.1 + 0.04 * n, l2 = l1 + 0.3 + 0.08 * n, l3 = l2 + 0.55 + 0.2 * n;
                    vec3 c = below < l1 ? asph : below < l2 ? slab : below < l3 ? course : soil;
                    // clods and broken lumps all over the walls, loose spoil in the bottom
                    float lump = pcHash(floor(vCrW.xz * 3.1 + vec2(floor(vCrW.y * 3.0))));
                    c *= 0.65 + 0.7 * lump * lump;
                    if (vCrDepth > 0.7) c = mix(c, vec3(0.05, 0.042, 0.034) * (0.6 + 0.8 * pcHash(floor(vCrW.xz * 2.2))), 0.65);
                    if (vCrFill > 0.5) c = mix(vec3(0.14, 0.14, 0.135), vec3(0.22, 0.22, 0.21), n2); // crushed stone fill
                    // deep in the hole is dark; and the rim shades what the sun can't reach through the opening
                    float ao = mix(0.35, 1.0, clamp(1.0 - vCrDepth * 0.9, 0.0, 1.0));
                    float lit = 1.0;
                    if (uCrSun.y > 0.05) {
                        vec3 q = vCrW + uCrSun * ((vCrA.x - vCrW.y) / uCrSun.y);
                        lit = crIn(q) < 1.0 ? 1.0 : 0.3;
                    } else lit = 0.3;
                    diffuseColor.rgb = c * ao * lit;
                }`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                // rough, lumpy walls: the normal broken up by noise (view space)
                {
                    float b1 = pcNoise(vCrW.xz * 3.7 + vCrW.y * 2.0) - 0.5, b2 = pcNoise(vCrW.zx * 4.3 - vCrW.y * 1.7 + 11.0) - 0.5;
                    normal = normalize(normal + (viewMatrix * vec4(b1 * 0.9, 0.0, b2 * 0.9, 0.0)).xyz);
                }`)
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
                {
                    vec4 clip = uCrProj * viewMatrix * vec4(crP, 1.0);
                    #ifdef USE_REVERSED_DEPTH_BUFFER
                    gl_FragDepth = crPortal ? clamp(clip.z / clip.w, 0.0, 1.0) : gl_FragCoord.z;
                    #else
                    gl_FragDepth = crPortal ? clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0) : gl_FragCoord.z;
                    #endif
                }`);
    };
    m.customProgramCacheKey = () => 'pavebowl';
    return m;
}

// a slab of broken pavement (unit size; scaled per instance): an irregular six-sided piece, the asphalt wearing
// course dark on top, the broken concrete showing light in its edges and underside
function slabGeometry() {
    const rnd = (k) => { const x = Math.sin(k * 91.7 + 13.1) * 43758.5; return x - Math.floor(x); };
    const ring = [];
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + (rnd(i) - 0.5) * 0.5, r = 0.42 + rnd(i + 7) * 0.16; ring.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const pos = [], col = [];
    const A = [0.07, 0.07, 0.075], C = [0.36, 0.35, 0.32], D = [0.3, 0.29, 0.27];
    const tri = (p, q, r, c) => { pos.push(...p, ...q, ...r); for (let k = 0; k < 3; k++) col.push(...c); };
    const top = 0.5, bot = -0.5;
    for (let i = 0; i < 6; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 6];
        tri([0, top, 0], [bx, top, bz], [ax, top, az], A);                         // top: asphalt
        tri([0, bot, 0], [ax, bot, az], [bx, bot, bz], D);                         // underside
        tri([ax, top, az], [bx, top, bz], [bx, bot, bz], C);                       // broken edge
        tri([ax, top, az], [bx, bot, bz], [ax, bot, az], C);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
}
function slabMaterial() {
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, side: THREE.DoubleSide });
}

// the yellow cross laid on a closed runway (two bars, 20 m × 2.4 m), flat on the pavement
function crossGeometry() {
    const g1 = new THREE.PlaneGeometry(2.4, 20); g1.rotateX(-Math.PI / 2); g1.rotateY(Math.PI / 4);
    const g2 = new THREE.PlaneGeometry(2.4, 20); g2.rotateX(-Math.PI / 2); g2.rotateY(-Math.PI / 4);
    const pos = new Float32Array([...g1.attributes.position.array, ...g2.attributes.position.array]);
    const nor = new Float32Array([...g1.attributes.normal.array, ...g2.attributes.normal.array]);
    const idx = [...g1.index.array, ...Array.from(g2.index.array, i => i + 4)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class PavementCraters {
    constructor(scene) {
        this.scene = scene;
        this.list = [];   // { c (logic crater), base, x, z, y, yaw }
        // bowls
        const bg = bowlGeometry();
        this.aCr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CRATERS * 4), 4);
        this.aCr2 = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CRATERS * 4), 4);
        bg.setAttribute('aCr', this.aCr); bg.setAttribute('aCr2', this.aCr2);
        this.bowlMat = bowlMaterial();
        this.bowls = new THREE.InstancedMesh(bg, this.bowlMat, MAX_CRATERS);
        this.bowls.count = 0;
        this.bowls.frustumCulled = false;
        this.bowls.receiveShadow = false; this.bowls.castShadow = false;
        this.bowls.onBeforeRender = (r, s, cam) => { const sh = this.bowlMat.userData.shader; if (sh) sh.uniforms.uCrProj.value.copy(cam.projectionMatrix); };
        scene.add(this.bowls);
        // slabs and chunks
        this.slabs = new THREE.InstancedMesh(slabGeometry(), slabMaterial(), MAX_CRATERS * SLABS);
        this.slabs.count = 0;
        this.slabs.frustumCulled = false;
        this.slabs.castShadow = true; this.slabs.receiveShadow = true;
        scene.add(this.slabs);
        // crosses on closed runways
        this.crosses = new THREE.InstancedMesh(crossGeometry(), new THREE.MeshStandardMaterial({ color: 0xe8c21e, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 }), XS);
        this.crosses.count = 0;
        this.crosses.frustumCulled = false;
        this.crosses.receiveShadow = true;
        scene.add(this.crosses);
        this.materials = new Set();
    }

    // pavement materials to cut
    patch(mat) { if (mat && !this.materials.has(mat)) { this.materials.add(mat); patchPaving(mat); } }
    // the sun's direction (world, toward the sun): the rim's shadow in the bowls
    setSun(dir) { if (dir) BOWL_SUN.value.copy(dir).normalize(); }

    // the logic's craters (bases.js hands them over with their world placement) → GPU state
    // entries: [{ c, x, z, y (pavement surface), yaw (world yaw of the runway / taxiway axis) }]
    sync(entries) {
        // unrepaired first, then the newest repairs (the uniform arrays hold MAX_CRATERS)
        const live = entries.filter(e => e.c.stage !== 'repaired'), done = entries.filter(e => e.c.stage === 'repaired');
        const list = [...live, ...done.slice(-(MAX_CRATERS - Math.min(live.length, MAX_CRATERS)))].slice(0, MAX_CRATERS);
        this.list = list;
        const st = { open: 0, clearing: 0, filling: 1, capping: 2, repaired: 3 };
        let nb = 0, ns = 0;
        list.forEach((e, i) => {
            const c = e.c, s = st[c.stage] ?? 0;
            pcData.set([e.x, e.z, c.r, s], i * 4);
            pcData.set([c.seed, c.debris, c.stage === 'capping' ? c.work : c.fill, e.yaw], (MAX_CRATERS + i) * 4);
            // the bowl while there's a hole
            if (s <= 1) {
                const k = nb++;
                _m.compose(_p.set(e.x, e.y, e.z), _q.identity(), _s.set(c.r, c.depth, c.r));
                this.bowls.setMatrixAt(k, _m);
                this.aCr.setXYZW(k, e.y, c.depth, c.fill, c.seed);
                this.aCr2.setXYZW(k, e.x, e.z, c.r, 0);
            }
            // slabs and chunks until they're cleared away
            const keep = Math.round(SLABS * c.debris);
            for (let j = 0; j < SLABS && ns < this.slabs.instanceMatrix.count; j++) {
                if (j >= keep || s >= 2) continue;
                this.slabs.setMatrixAt(ns++, this.slabMatrix(e, j));
            }
        });
        for (let i = list.length; i < MAX_CRATERS; i++) pcData.set([1e6, 1e6, 0, 0], i * 4);
        pcTex.needsUpdate = true;
        PAVE_U.uPcN.value = list.length;
        this.bowls.count = nb;
        this.slabs.count = ns;
        this.bowls.instanceMatrix.needsUpdate = true; this.aCr.needsUpdate = true; this.aCr2.needsUpdate = true;
        this.slabs.instanceMatrix.needsUpdate = true;
    }

    // slab j of a crater: the first ten tilted up round the rim, the rest chunks thrown out on the pavement
    slabMatrix(e, j) {
        const c = e.c, R = c.r, h = (k) => hash(c.seed * 97 + j * 13.1 + k);
        if (j < 10) {
            const a = (j / 10) * Math.PI * 2 + h(1) * 0.5;
            const rr = R * (1.02 + h(2) * 0.3);
            const w = 1.4 + h(3) * 1.8, d = 0.9 + h(4) * 1.1, th = 0.3 + h(5) * 0.15;
            // tilted up about the tangent (the inner edge lifted), a little twisted
            _e.set(0, -a + Math.PI / 2 + (h(6) - 0.5) * 0.5, 0, 'YXZ');
            _q.setFromEuler(_e);
            _q.multiply(_q2.setFromAxisAngle(_p.set(1, 0, 0), -(0.35 + h(7) * 0.55)));
            _p.set(e.x + Math.cos(a) * rr, e.y + 0.25 + h(8) * 0.35, e.z + Math.sin(a) * rr);
            return _m.compose(_p, _q, _s.set(w, th, d));
        }
        const a = h(1) * Math.PI * 2, rr = R * (1.35 + Math.pow(h(2), 1.5) * 2.2), sz = 0.18 + h(3) * 0.45;
        _e.set(h(4) * 3, h(5) * 6, h(6) * 3);
        _q.setFromEuler(_e);
        _p.set(e.x + Math.cos(a) * rr, e.y + sz * 0.3, e.z + Math.sin(a) * rr);
        return _m.compose(_p, _q, _s.set(sz * (1 + h(7)), sz * 0.7, sz));
    }

    // yellow crosses: [{ x, z, y, yaw }] (world) on the closed runways
    setCrosses(list) {
        const n = Math.min(list.length, XS);
        for (let i = 0; i < n; i++) {
            const c = list[i];
            _q.setFromAxisAngle(_p.set(0, 1, 0), c.yaw);
            this.crosses.setMatrixAt(i, _m.compose(_p.set(c.x, c.y + 0.05, c.z), _q, _s.set(1, 1, 1)));
        }
        this.crosses.count = n;
        this.crosses.instanceMatrix.needsUpdate = true;
    }

    clear() {
        this.sync([]);
        this.setCrosses([]);
    }
}
void HIDE;
