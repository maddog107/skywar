// ═══════════════════════════════════════════════════════════════
// Vegetation: photoscanned trees, grass and ground textures (Poly Haven, CC0; see models/*/CREDITS.md)
//  - impostor atlases (models/vegetation, baked by tools/bake_impostors.py) copied on the GPU into one
//    texture array, so a whole forest tile (every species) is one draw call
//  - impostor cards: a camera-facing card showing the two nearest of the 8 baked azimuths (cross-faded),
//    plus a flat card with the top view that takes over when you look down; lit as a soft crown, swaying
//    in the wind, alpha-tested (alpha-to-coverage with MSAA), dithered in and out with distance
//  - the photo ground textures (models/ground) as texture arrays for the terrain's close-up detail
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { CRATER_GLSL, CRATER_U } from './craters.js';

// Atlas layers. Heights, crowns and frame sizes come from each atlas' json (the bake writes them).
export const SPECIES = ['fir_tree_01_a', 'fir_tree_01_b', 'fir_tree_01_c', 'fir_sapling', 'island_tree_01', 'island_tree_02', 'tree_small_02', 'grass_medium_02_e', 'fern_02_b'];
export const SP = { FIR_A: 0, FIR_B: 1, FIR_C: 2, SAPLING: 3, OAK: 4, SHRUB: 5, BIRCH: 6, GRASS: 7, FERN: 8 };
// How each species is drawn: tint (linear, the atlases were baked brighter and yellower than the terrain's
// greens), crown centre and half-height as fractions of the tree height (for the crown's normals), height
// of the top-view card (fraction), 1 to keep the crown out of its own shadow (see vegShift)
const LOOK = [
    { tint: [0.3, 0.55, 0.66], crown: [0.56, 0.44], top: 0.62, shift: 1 }, // fir a
    { tint: [0.32, 0.57, 0.66], crown: [0.56, 0.44], top: 0.62, shift: 1 }, // fir b
    { tint: [0.3, 0.54, 0.64], crown: [0.56, 0.44], top: 0.62, shift: 1 },  // fir c
    { tint: [0.3, 0.5, 0.5], crown: [0.5, 0.5], top: 0.6, shift: 1 },       // sapling
    { tint: [0.38, 0.72, 0.42], crown: [0.62, 0.38], top: 0.72, shift: 1 }, // "oak" (island tree 01)
    { tint: [0.42, 0.7, 0.4], crown: [0.55, 0.45], top: 0.7, shift: 1 },    // shrub (island tree 02)
    { tint: [0.4, 0.64, 0.36], crown: [0.62, 0.38], top: 0.72, shift: 1 },  // "birch" (tree small 02)
    { tint: [1, 1, 1], crown: [0.5, 0.5], top: 0.5, shift: 0 },               // grass
    { tint: [0.8, 0.9, 0.8], crown: [0.5, 0.5], top: 0.5, shift: 0 },         // fern
];
// Ground layers: texture, tile size (m), how much of the photo's own hue is kept, and its mean colour (per
// pixel, squared as the shader linearises it), so the shader can use it as a ratio around 1 and keep the
// terrain's own colour
export const GROUND = [
    { name: 'rocky_terrain_02', tile: 9, chroma: 0.55, mean: [0.1003, 0.0964, 0.014] },     // 0 lush meadow with pebbles
    { name: 'aerial_grass_rock', tile: 13, chroma: 0.55, mean: [0.2017, 0.1485, 0.0317] }, // 1 dry grass and moss
    { name: 'dirt_aerial_02', tile: 17, chroma: 0.5, mean: [0.2404, 0.1422, 0.0678] },      // 2 bare dirt
    { name: 'aerial_rocks_04', tile: 24, chroma: 0.2, mean: [0.1588, 0.1087, 0.0372] },    // 3 rock and scree
    { name: 'coast_sand_01', tile: 7, chroma: 0.4, mean: [0.2629, 0.2057, 0.1326] },       // 4 beach sand
    { name: 'snow_field_aerial', tile: 19, chroma: 0.3, mean: [0.2948, 0.2947, 0.3521] },   // 5 snow
];
const ATLAS = 1024; // texture array layer size (the atlases are 3x3 frames of 512 or 256 px)

// Copy images into the layers of a texture array on the GPU (keeps straight alpha and edge-padded colour
// exactly; a 2D canvas would premultiply them away), with mipmaps and anisotropic filtering.
function makeArray(renderer, urls, size, { repeat = false, onLayer, onDone } = {}) {
    const rt = new THREE.WebGLArrayRenderTarget(size, size, urls.length, { depthBuffer: false });
    const t = rt.texture;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (renderer.initRenderTarget) renderer.initRenderTarget(rt);
    const mat = new THREE.ShaderMaterial({
        uniforms: { src: { value: null } }, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D src; varying vec2 vUv; void main() { gl_FragColor = texture2D(src, vUv); }',
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(quad);
    const loader = new THREE.TextureLoader();
    let left = urls.length;
    urls.forEach((url, layer) => loader.load(url, (src) => {
        src.colorSpace = THREE.NoColorSpace; // raw bytes: the shaders decode sRGB themselves
        mat.uniforms.src.value = src;
        const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(rt, layer);
        renderer.render(scene, cam); // three regenerates the array's mipmaps after rendering into it
        renderer.setRenderTarget(prev);
        renderer.autoClear = prevAuto;
        src.dispose();
        if (onLayer) onLayer(layer);
        if (--left === 0) { mat.dispose(); quad.geometry.dispose(); if (onDone) onDone(); }
    }, undefined, () => { if (--left === 0 && onDone) onDone(); }));
    return rt.texture;
}

// ── GLSL ──
const NSP = SPECIES.length;
const VERT_PARS = /* glsl */`
    #define VEG_NSP ${NSP}
    uniform vec4 vegA[VEG_NSP]; // side frame size / height, top frame size / height, trunk base in the frame (0..1), crown radius / height
    uniform vec4 vegB[VEG_NSP]; // side crop x0, x1, y0, y1 (frame fractions, y from the bottom)
    uniform vec4 vegC[VEG_NSP]; // top crop
    uniform vec4 vegD[VEG_NSP]; // tint (linear), top card height (fraction)
    uniform vec4 vegE[VEG_NSP]; // crown centre, crown half-height, shadow lookup shift toward the sun (fractions of height)
    uniform vec4 vegFade;       // dither-fade start, end (m from the player's camera), fade-in time (s)
    uniform vec3 vegCam, vegSun, uWind;
    uniform float uTime;
    #ifndef USE_INSTANCING
    attribute vec4 iPos;  // trunk base x, y, z, height (m)
    attribute vec4 iData; // yaw, species, brightness, time the tile appeared
    #endif
    varying vec2 vUvA, vUvB;
    varying vec3 vVeg;  // atlas layer, blend toward frame B, coverage (fades)
    varying vec4 vCard; // position on the crown (x, y in crown radii), height fraction, 1 on the top card
    varying vec3 vTint, vVegUp;
    varying float vVegBias; // texture lod bias: the wide far shadow cascade reads coarser mips
    ${CRATER_GLSL}
    vec3 vegPos, vegN;
    float vegShift, vegCov;
    float vegHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void vegVertex() {
        vec3 base; float H, yaw, sp, bright, born;
        #ifdef USE_INSTANCING
            // town trees: an InstancedMesh (position, yaw and a size of about 1 in the instance matrix)
            base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            vec3 c0 = instanceMatrix[0].xyz;
            yaw = atan(-c0.z, c0.x);
            float hs = vegHash(base.xz);
            sp = hs < 0.55 ? ${SP.OAK}.0 : hs < 0.9 ? ${SP.BIRCH}.0 : ${SP.SHRUB}.0;
            H = length(c0) * (sp == ${SP.SHRUB}.0 ? 6.0 : 11.0) * (0.85 + 0.3 * fract(hs * 7.31));
            bright = 0.85 + 0.25 * fract(hs * 13.7);
            born = -1e4;
        #else
            base = (modelMatrix * vec4(iPos.xyz, 1.0)).xyz;
            H = iPos.w; yaw = iData.x; sp = iData.y; bright = iData.z; born = iData.w;
        #endif
        int s = int(sp + 0.5);
        vec4 A = vegA[s], B = vegB[s], C = vegC[s], D = vegD[s], E = vegE[s];
        // toward the viewer: the camera, or an orthographic (shadow) camera's view axis
        vec3 toCam = projectionMatrix[3][3] > 0.5 ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : cameraPosition - (base + vec3(0.0, H * 0.5, 0.0));
        float hl = length(toCam.xz);
        vec2 dh = hl > 1e-5 ? toCam.xz / hl : vec2(0.0, 1.0);
        float elev = atan(toCam.y, max(hl, 1e-5));
        float cy = cos(yaw), sy = sin(yaw);
        // the viewer's azimuth around the tree in its own (unrotated) frame: frame k was baked from k * 45 deg
        vec2 loc = vec2(dh.x * cy - dh.y * sy, dh.x * sy + dh.y * cy);
        float f = mod(atan(loc.x, loc.y) * 1.2732395 + 8.0, 8.0);
        float k0 = floor(f), k1 = mod(k0 + 1.0, 8.0);
        bool top = position.z > 0.5;
        // the upright card fades out when you look straight down; the top view (seen from above its own
        // plane) fades in from ~40 deg
        float elevTop = atan(cameraPosition.y - base.y - D.w * H, max(hl, 1e-5));
        if (projectionMatrix[3][3] > 0.5) elevTop = elev;
        float cardW = top ? smoothstep(0.7, 1.1, elevTop) : 1.0 - smoothstep(1.05, 1.45, elev);
        #ifdef VEG_DEPTH
        cardW = top == (elev > 0.9) ? 1.0 : 0.0; // shadows: one card or the other (by the sun's height), no stipple
        #endif
        float dist = length(base - vegCam);
        vegCov = cardW * (1.0 - smoothstep(vegFade.x, vegFade.y, dist)) * clamp((uTime - born) / vegFade.z, 0.0, 1.0);
        if (craterAt(base.xz).x < 1.5) vegCov = 0.0; // blown away by the blast that dug a crater here (craters.js)
        vec3 up;
        if (top) {
            float fx = mix(C.x, C.y, position.x), fy = mix(C.z, C.w, position.y);
            vec2 l = vec2(fx - 0.5, 0.5 - fy) * A.y * H; // image right = +x, image up = -z (tree frame)
            vegPos = base + vec3(l.x * cy + l.y * sy, D.w * H, -l.x * sy + l.y * cy);
            vUvA = vUvB = vec2((2.0 + fx) / 3.0, fy / 3.0);
            vCard = vec4(vec2(fx - 0.5, fy - 0.5) * A.y / A.w, D.w, 1.0);
            vegN = vec3(0.0, 1.0, 0.0);
            up = vec3(-sy, 0.0, -cy);
            vVeg = vec3(sp, 0.0, 0.0);
        } else {
            float fx = mix(B.x, B.y, position.x), fy = mix(B.z, B.w, position.y);
            float x = (fx - 0.5) * A.x * H, y = (fy - A.z) * A.x * H;
            vegPos = base + vec3(dh.y, 0.0, -dh.x) * x + vec3(0.0, y, 0.0);
            vUvA = vec2((mod(k0, 3.0) + fx) / 3.0, (2.0 - floor(k0 / 3.0) + fy) / 3.0);
            vUvB = vec2((mod(k1, 3.0) + fx) / 3.0, (2.0 - floor(k1 / 3.0) + fy) / 3.0);
            vCard = vec4(x / (A.w * H), (y - E.x * H) / (E.y * H), y / H, 0.0);
            vegN = vec3(dh.x, 0.0, dh.y);
            up = vec3(0.0, 1.0, 0.0);
            vVeg = vec3(sp, f - k0, 0.0);
        }
        vVeg.z = vegCov;
        vVegBias = projectionMatrix[3][3] > 0.5 && projectionMatrix[0][0] < 0.005 ? 2.0 : 1.0;
        // sway: bends more toward the top, gusts roll across the forest, each tree in its own phase
        float hf = clamp((vegPos.y - base.y) / H, 0.0, 1.2);
        float ph = dot(base.xz, vec2(0.071, 0.053));
        float gust = 0.55 + 0.45 * sin(uTime * 0.37 - dot(base.xz, vec2(0.004, 0.003)));
        float bend = uWind.y * 0.03 * H * hf * hf;
        vec3 wd = vec3(uWind.x, 0.0, uWind.z);
        vegPos += wd * bend * (0.55 * gust + 0.25 * sin(uTime * 1.7 + ph)) + vec3(-wd.z, 0.0, wd.x) * bend * 0.18 * sin(uTime * 2.9 + ph * 1.9);
        float hv = vegHash(base.xz + 0.37);
        vTint = D.rgb * bright * mix(vec3(1.0), vec3(1.1, 1.04, 0.78), hv * hv * 0.8);
        vVegUp = (viewMatrix * vec4(up, 0.0)).xyz;
        // shadows are looked up on the sunny side of the tree's own shadow caster (the card facing the sun, or
        // the top card when the sun is high): every point of the card slides along the sun ray onto a plane at
        // the crown's edge (linear, so it interpolates exactly). A crown is shadowed only by what stands between
        // it and the sun, taller neighbours and the terrain, not by itself.
        float sl = length(vegSun.xz);
        if (atan(vegSun.y, sl) > 0.9) vegShift = (base.y + H + 0.3 - vegPos.y) / vegSun.y;
        else vegShift = (A.w * H + 0.3 - dot(vegPos.xz - base.xz, vegSun.xz / sl)) / sl;
        vegShift *= E.z;
    }
    // clip-space position, or off screen for a card that is faded out completely
    vec4 vegProject(vec4 mv) { return vegCov > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0); }`;

const FRAG_PARS = /* glsl */`
    // a crown in the shade still gets some sun through and around the leaves (and isn't a black cut-out)
    #define SHADOW_FADE( s ) mix( 0.4, 1.0, s )
    uniform highp sampler2DArray vegAtlas;
    uniform float vegMip;
    varying vec2 vUvA, vUvB;
    varying vec3 vVeg;
    varying vec4 vCard;
    varying vec3 vTint, vVegUp;
    varying float vVegBias;
    float vegIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    // the atlas at this pixel (two frames cross-faded); alpha scaled up in the mips so crowns keep their coverage
    vec4 vegSample(float bias) {
        vec2 gx = dFdx(vUvA) * bias, gy = dFdy(vUvA) * bias;
        vec4 t = mix(textureGrad(vegAtlas, vec3(vUvA, vVeg.x), gx, gy), textureGrad(vegAtlas, vec3(vUvB, vVeg.x), gx, gy), vVeg.y);
        vec2 px = gx * ${ATLAS}.0, py = gy * ${ATLAS}.0;
        float lod = max(0.5 * log2(max(dot(px, px), dot(py, py))), 0.0);
        t.a *= 1.0 + lod * vegMip;
        return t;
    }`;

// Terrain close-up detail (world.js terrain material): one ground layer at two scales (the second rotated
// and 3.4x larger), mixed so their variance is kept (Heitz & Neyret), as a colour ratio around 1; adds the
// fine scale's normal map (tangent xy, weighted) to nrm when nearN > 0. Defines GROUND_LITE: no normal maps.
export const GROUND_GLSL = /* glsl */`
    uniform highp sampler2DArray gDiff, gNorm;
    uniform float gReady;
    uniform vec3 gMean[${GROUND.length}];
    const float gTile[${GROUND.length}] = float[${GROUND.length}](${GROUND.map(g => g.tile.toFixed(1)).join(', ')});
    const float gChroma[${GROUND.length}] = float[${GROUND.length}](${GROUND.map(g => g.chroma.toFixed(2)).join(', ')});
    // p: position in the projection plane (m), dx / dy: its screen derivatives; mixK: share of the fine scale
    // (0: coarse only, its sample is skipped)
    vec3 groundLayer(int i, vec2 p, vec2 dx, vec2 dy, float mixK, float nearN, float w, inout vec2 nrm) {
        const mat2 GR = mat2(0.8, 0.6, -0.6, 0.8);
        float sc = 1.0 / gTile[i], L = float(i), k2 = 1.0 - mixK;
        vec2 uv1 = vec2(p.x, -p.y) * sc, g1x = vec2(dx.x, -dx.y) * sc, g1y = vec2(dy.x, -dy.y) * sc;
        vec2 uv2 = GR * uv1 * 0.29 + vec2(0.37, 0.71), g2x = GR * g1x * 0.29, g2y = GR * g1y * 0.29;
        vec3 m = gMean[i];
        vec3 c2 = textureGrad(gDiff, vec3(uv2, L), g2x, g2y).rgb;
        vec3 r = (c2 * c2 / m - 1.0) * k2; // (squared: close enough to sRGB -> linear, and cheap)
        if (mixK > 0.01) {
            vec3 c1 = textureGrad(gDiff, vec3(uv1, L), g1x, g1y).rgb;
            r += (c1 * c1 / m - 1.0) * mixK;
            #ifndef GROUND_LITE
            if (nearN > 0.0) nrm += (textureGrad(gNorm, vec3(uv1, L), g1x, g1y).xy * 2.0 - 1.0) * w;
            #endif
        }
        r = r * inversesqrt(mixK * mixK + k2 * k2) + 1.0;
        // keep some of the photo's own colour variation (a grey stone in the grass), not all of its hue
        return mix(vec3(dot(r, vec3(0.3, 0.59, 0.11))), r, gChroma[i]);
    }`;

// Material patches. `depth`: the shadow caster (MeshDepthMaterial)
function patchVertex(src, depth) {
    src = src.replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', 'vegVertex();\nvec3 transformed = vegPos;')
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);\ngl_Position = vegProject(mvPosition);');
    if (!depth) {
        src = src.replace('#include <beginnormal_vertex>', 'vegVertex();\nvec3 objectNormal = vegN;')
            .replace('vegVertex();\nvec3 transformed = vegPos;', 'vec3 transformed = vegPos;')
            .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = (viewMatrix * vec4(objectNormal, 0.0)).xyz;')
            // shadows are looked up a little toward the sun, so a crown isn't shadowed by its own card
            .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed + vegSun * vegShift, 1.0);');
    }
    return src;
}

export class Vegetation {
    constructor(renderer, { uTime, uWind }) {
        this.renderer = renderer;
        const v4 = () => Array.from({ length: NSP }, () => new THREE.Vector4());
        this.uniforms = {
            vegAtlas: { value: null }, vegA: { value: v4() }, vegB: { value: v4() }, vegC: { value: v4() }, vegD: { value: v4() }, vegE: { value: v4() },
            vegCam: { value: new THREE.Vector3() }, vegSun: { value: new THREE.Vector3(0, 1, 0) }, vegMip: { value: 0.3 },
            uTime, uWind, ...CRATER_U,
        };
        LOOK.forEach((l, i) => {
            this.uniforms.vegD.value[i].set(l.tint[0], l.tint[1], l.tint[2], l.top);
            this.uniforms.vegE.value[i].set(l.crown[0], l.crown[1], l.shift, 0);
            this.uniforms.vegA.value[i].set(1, 1, 0, 0.3); this.uniforms.vegB.value[i].set(0, 1, 0, 1); this.uniforms.vegC.value[i].set(0, 1, 0, 1);
        });
        this.meta = [];
        this.ready = false;
        this.groundU = {
            gDiff: { value: null }, gNorm: { value: null }, gReady: { value: 0 },
            gMean: { value: GROUND.map(g => new THREE.Vector3(...g.mean)) },
        };
        if (typeof document === 'undefined' || !renderer) return;
        this.uniforms.vegAtlas.value = makeArray(renderer, SPECIES.map(n => `models/vegetation/${n}.webp`), ATLAS, { onDone: () => (this.ready = true) });
        SPECIES.forEach((n, i) => fetch(`models/vegetation/${n}.json`).then(r => r.json()).then(j => this.setMeta(i, j)).catch(() => {}));
    }

    setMeta(i, j) {
        this.meta[i] = j;
        const H = j.height, U = this.uniforms;
        U.vegA.value[i].set(j.sideExtent / H, j.topExtent / H, 0.5 - 0.5 * H / j.sideExtent, j.radius / H);
        const c = j.sideCrop || [0, 1, 0, 1], t = j.topCrop || [0, 1, 0, 1];
        U.vegB.value[i].set(c[0], c[1], c[2], c[3]);
        U.vegC.value[i].set(t[0], t[1], t[2], t[3]);
    }

    // photo ground textures (terrain close-up detail), loaded the first time a quality level wants them
    loadGround() {
        if (this.groundLoading || !this.renderer || typeof document === 'undefined') return;
        this.groundLoading = true;
        let n = 2;
        const done = () => { if (--n === 0) this.groundU.gReady.value = 1; };
        this.groundU.gDiff.value = makeArray(this.renderer, GROUND.map(g => `models/ground/${g.name}_diffuse.webp`), 1024, { repeat: true, onDone: done });
        this.groundU.gNorm.value = makeArray(this.renderer, GROUND.map(g => `models/ground/${g.name}_nor_gl.webp`), 512, { repeat: true, onDone: done });
    }

    // Impostor card material (forests: per-instance attributes; towns: an InstancedMesh) and its shadow caster
    makeMaterial(fadeNear, fadeFar, key) {
        const fade = { value: new THREE.Vector4(fadeNear, fadeFar, 1.5, 0) };
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
        mat.envMapIntensity = 0.85;
        mat.shadowSide = THREE.DoubleSide;
        mat.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, this.uniforms, { vegFade: fade });
            sh.vertexShader = patchVertex(sh.vertexShader, false);
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                    vec4 vegTex = vegSample(1.0);
                    #ifdef VEG_A2C
                        diffuseColor.a = clamp((vegTex.a - 0.5) / max(fwidth(vegTex.a), 1e-4) + 0.5, 0.0, 1.0) * vVeg.z;
                        if (diffuseColor.a < 0.02) discard;
                    #else
                        if (vegTex.a < 0.5 || vegIGN(gl_FragCoord.xy) >= vVeg.z) discard;
                    #endif
                    // sRGB atlas -> linear, tinted; darker low in the crown and toward the trunk
                    // (the tint is for the foliage; bark, which is redder than it is green, only darkens a little)
                    float leaf = clamp((vegTex.g - vegTex.r) * 10.0 + 0.4, 0.0, 1.0);
                    diffuseColor.rgb = pow(vegTex.rgb, vec3(2.2)) * mix(vec3(0.6), vTint, leaf) * mix(0.5, 1.08, smoothstep(0.0, 0.85, vCard.z));`)
                .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
                    {   // the crown as a soft ellipsoid facing the viewer, leaning toward the sky
                        vec3 F = normalize(vNormal), U = normalize(vVegUp), R = cross(U, F);
                        vec2 c = clamp(vCard.xy, vec2(-1.2, -0.5), vec2(1.2)); // (the trunk below the crown faces sideways, not down)
                        vec3 n = R * c.x * 0.8 + U * c.y * 0.6 + F * sqrt(max(1.0 - dot(c, c) * 0.5, 0.15));
                        normal = normalize(normalize(n) + (viewMatrix * vec4(0.0, 0.55, 0.0, 0.0)).xyz);
                    }`);
        };
        mat.customProgramCacheKey = () => 'veg:' + key + (mat.alphaToCoverage ? ':a2c' : '');
        const depth = new THREE.MeshDepthMaterial();
        depth.defines = { VEG_DEPTH: '' };
        depth.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, this.uniforms, { vegFade: fade });
            sh.vertexShader = patchVertex(sh.vertexShader, true);
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                    vec4 vegTex = vegSample(vVegBias);
                    if (vegTex.a < 0.5 || vegIGN(gl_FragCoord.xy) >= vVeg.z) discard;`);
        };
        depth.customProgramCacheKey = () => 'vegdepth:' + key;
        return { mat, depth, fade };
    }

    // alpha-to-coverage where the scene is drawn multisampled
    setA2C(mat, on) {
        if (!!mat.alphaToCoverage === on) return;
        mat.alphaToCoverage = on;
        if (on) mat.defines = { ...(mat.defines || {}), VEG_A2C: '' }; else if (mat.defines) delete mat.defines.VEG_A2C;
        mat.needsUpdate = true;
    }

    // Card geometry: an upright card in three rows (so it can bend) and a flat top-view card.
    // position = (across 0..1, up 0..1, 1 on the top card). `instanced`: for per-instance attributes.
    cardGeometry(instanced) {
        const P = [0, 0, 0, 1, 0, 0, 0, 1 / 3, 0, 1, 1 / 3, 0, 0, 2 / 3, 0, 1, 2 / 3, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1];
        const I = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6, 8, 9, 10, 9, 11, 10];
        const g = instanced ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(P.length), 3)); // (set in the shader; without it three shades flat)
        g.setIndex(I);
        return g;
    }

    // town trees: an InstancedMesh-compatible card (its bounds cover a ~12 m tree at instance scale 1)
    townGeometry() {
        const g = this.cardGeometry(false);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 7, 0), 11);
        g.boundingBox = new THREE.Box3(new THREE.Vector3(-8, -1, -8), new THREE.Vector3(8, 15, 8));
        return g;
    }
}
