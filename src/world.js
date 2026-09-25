// ═══════════════════════════════════════════════════════════════
// World: sky, lighting, streamed LOD terrain, ocean, clouds, forests, airbases
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { fbm, ridged, smoothstep, lerp, clamp, mulberry32, DEG, makeRadialTexture, freezeStatic } from './util.js';
import { TIMES } from './config.js';
import { Clouds } from './clouds.js';

// ═══════════════════════════════════════════════════════════════
// Global shader patches (applied once at import, before anything compiles)
// ═══════════════════════════════════════════════════════════════
// Aerial perspective for every built-in material: exp² haze whose density thins out with altitude (clear
// air when you look down from height, hazy valleys and horizons), a low mist layer that pools over lakes
// and lowlands (denser at dawn, dusk and in rain), warm in-scatter toward the sun that matches the sky's
// horizon glow, and a fade to the horizon colour before the streamed terrain runs out.
// The parameters live in typed arrays that every material's uniforms point at: UniformsUtils.clone copies
// Colors and Vectors but keeps typed arrays by reference, so one write updates the whole scene.
export const SKY_FOG = {
    a: new Float32Array([0.00006, 1 / 1500, 13000, 18000]), // haze density at sea level, 1/scale height, edge fade start, end (m)
    b: new Float32Array([0, 1, 0, 0.25]),                    // sun direction (world), glow strength at the horizon
    c: new Float32Array([1, 0.8, 0.6, 0]),                   // glow colour (linear)
    d: new Float32Array([0, 1 / 70, 1.1, 0]),                // mist density at sea level, 1/scale height, mist brightness
};
export const FOG_GLSL = /* glsl */`
    uniform vec4 skyFogA, skyFogB, skyFogC, skyFogD;
    // optical depth of an exponential height layer along a ray from height y0 to y1 of length L
    float skyFogLayer(float dens, float k, float y0, float y1, float L) {
        float e0 = exp(-k * max(y0, 0.0)), e1 = exp(-k * max(y1, 0.0));
        float dk = k * (y1 - y0);
        return dens * L * (abs(dk) > 1e-4 ? (e0 - e1) / dk : e0);
    }
    // ray: camera -> point, world space. x: fog amount, y: how much of it is low mist
    vec2 skyFogAmount(vec3 ray, float camY) {
        float L = length(ray);
        float haze = skyFogLayer(skyFogA.x, skyFogA.y, camY, camY + ray.y, L);
        float mist = skyFogLayer(skyFogD.x, skyFogD.y, camY, camY + ray.y, L);
        float tau = haze + mist;
        float f = 1.0 - exp(-tau * tau);
        f = max(f, smoothstep(skyFogA.z, skyFogA.w, length(ray.xz)));
        return vec2(f, mist / max(tau, 1e-6));
    }
    vec3 skyFogColor(vec3 base, vec3 ray, float mistShare) {
        float sd = max(dot(normalize(ray), skyFogB.xyz), 0.0);
        vec3 c = base + skyFogC.rgb * (pow(sd, 6.0) * skyFogB.w);
        return mix(c, base * skyFogD.z + skyFogC.rgb * (pow(sd, 3.0) * skyFogB.w * 0.6), mistShare * 0.7);
    }`;
function patchFogChunks() {
    const C = THREE.ShaderChunk;
    C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogPos;\n#endif';
    C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogPos = mvPosition.xyz;\n#endif';
    C.fog_pars_fragment = `#ifdef USE_FOG
        uniform vec3 fogColor;
        varying float vFogDepth;
        varying vec3 vFogPos;
        ${FOG_GLSL}
    #endif`;
    C.fog_fragment = `#ifdef USE_FOG
        vec3 fogRay = ( vec4( vFogPos, 0.0 ) * viewMatrix ).xyz; // view -> world direction (rigid view matrix)
        vec2 fogAmt = skyFogAmount( fogRay, cameraPosition.y );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, skyFogColor( fogColor, fogRay, fogAmt.y ), fogAmt.x );
    #endif`;
    for (const k in THREE.ShaderLib) {
        const u = THREE.ShaderLib[k].uniforms;
        if (u && u.fogColor) { u.skyFogA = { value: SKY_FOG.a }; u.skyFogB = { value: SKY_FOG.b }; u.skyFogC = { value: SKY_FOG.c }; u.skyFogD = { value: SKY_FOG.d }; }
    }
}

// Two-cascade sun shadows: directional light 0 (the sun) keeps its sharp ±70 m map around the jet; light 1
// carries no light, only a wide, coarse map of the ground ahead of the camera. Light 0 reads the near map
// inside its box and blends to the far map outside it, so hangars, houses and trees kilometres away still sit
// on their shadows. Materials may #define SHADOW_FADE(s) to post-process the sun's shadow term.
function patchCascadeShadows() {
    const src = THREE.ShaderChunk.lights_fragment_begin;
    const start = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
    const end = src.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
    const line = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
    const re = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
    if (start < 0 || end < start) return false;
    let block = src.slice(start, end);
    if (!block.includes(line) || !block.includes(re)) return false; // three.js changed: keep single shadows
    const args = (k) => `directionalShadowMap[ ${k} ], directionalLightShadows[ ${k} ].shadowMapSize, directionalLightShadows[ ${k} ].shadowIntensity, directionalLightShadows[ ${k} ].shadowBias, directionalLightShadows[ ${k} ].shadowRadius, vDirectionalShadowCoord[ ${k} ]`;
    block = block.replace(line, `
        #if ( UNROLLED_LOOP_INDEX == 0 ) && ( NUM_DIR_LIGHT_SHADOWS == 2 )
            vec3 csmNear = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
            vec2 csmEdge = min( csmNear.xy, 1.0 - csmNear.xy );
            float csmW = smoothstep( 0.0, 0.15, min( csmEdge.x, csmEdge.y ) );
            float csmS = 1.0;
            if ( csmW > 0.0 ) csmS = getShadow( ${args(0)} );
            if ( csmW < 1.0 ) {
                vec3 csmFar = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
                vec2 csmEdge1 = min( csmFar.xy, 1.0 - csmFar.xy );
                float csmS1 = mix( 1.0, getShadow( ${args(1)} ), smoothstep( 0.0, 0.08, min( csmEdge1.x, csmEdge1.y ) ) );
                csmS = mix( csmS1, csmS, csmW );
            }
            directLight.color *= ( directLight.visible && receiveShadow ) ? SHADOW_FADE( csmS ) : 1.0;
        #elif ( UNROLLED_LOOP_INDEX == 1 ) && ( NUM_DIR_LIGHT_SHADOWS == 2 )
            // light 1 only holds the far cascade's map (read by light 0 above)
        #else
            ${line.replace('? getShadow(', '? SHADOW_FADE( getShadow(').replace(') : 1.0;', ') ) : 1.0;')}
        #endif`)
        .replace(re, `#if !( ( UNROLLED_LOOP_INDEX == 1 ) && ( NUM_DIR_LIGHT_SHADOWS == 2 ) )
            ${re}
        #endif`);
    THREE.ShaderChunk.lights_fragment_begin = '#ifndef SHADOW_FADE\n#define SHADOW_FADE( s ) ( s )\n#endif\n' + src.slice(0, start) + block + src.slice(end);
    return true;
}
patchFogChunks();
export const CASCADES = patchCascadeShadows();

// ── Airbases (terrain is flattened around them) ──
// Each base lists its runways in base-local metres (lx across, lz along; rot = extra rotation).
// layout picks the dressing: 'standard' (the original bases), 'miramar' (military, parallel runways),
// 'civil' (airline terminals). Runway numbers are worked out from the real compass heading.
export const BASES = [
    { id: 'home', name: 'SKYWAR AIR BASE', x: 0, z: 0, h: 22, r: 1500, heading: 0, friendly: true, layout: 'standard',
        runways: [{ lx: 0, lz: 0, len: 3000, w: 55 }] },
    { id: 'enemy', name: 'ENEMY AIR BASE', x: 7000, z: -17000, h: 38, r: 1700, heading: 0.35, friendly: false, layout: 'standard',
        runways: [{ lx: 0, lz: 0, len: 3000, w: 55 }] },
    { id: 'miramar', name: 'MCAS MIRAMAR', x: -10000, z: -19100, h: 58, r: 2800, heading: 0.698, friendly: true, layout: 'miramar',
        runways: [{ lx: -520, lz: 0, len: 3650, w: 60 }, { lx: -220, lz: 300, len: 2900, w: 46 }, { lx: -430, lz: -250, len: 1150, w: 45, rot: 0.87 }],
        fence: { x0: -900, x1: 1450, z0: -2150, z1: 2150 }, gate: { lx: 1450, lz: -300 } },
    { id: 'civil', name: 'HARBOR INTERNATIONAL', x: -13600, z: 10900, h: 14, r: 2100, heading: 0.315, friendly: true, layout: 'civil', civil: true,
        runways: [{ lx: 0, lz: 0, len: 2900, w: 60 }],
        fence: { x0: -250, x1: 900, z0: -1650, z1: 1650 }, gate: { lx: 900, lz: 0 } },
];
export const RUNWAY = { length: 3000, width: 55 };
// Perimeter fence and main gate, in base-local metres (x across the runway, toward the apron = +x; z along it)
export const FENCE = { x0: -190, x1: 570, z0: -1720, z1: 1720 };
export const GATE = { lx: 570, lz: -300 }; // between the tower and the helipads, clear of the hangars
export const fenceOf = (b) => b.fence || FENCE;
export const gateOf = (b) => b.gate || GATE;

// ── Runways ──
// world-space description: centre, unit direction toward the runway's local -z end, half length, width
export function runwayInfo(b, rw) {
    const H = b.heading + (rw.rot || 0);
    const c = baseToWorld(b, rw.lx, rw.lz);
    return { x: c.x, z: c.z, y: b.h, dirX: Math.sin(H), dirZ: -Math.cos(H), half: rw.len / 2, w: rw.w, H };
}
// compass heading (as the HUD shows it) when rolling toward the runway's -z end, and the reciprocal
export function runwayNumbers(b, rw) {
    const H = b.heading + (rw.rot || 0);
    const hdg = (((-H * 180 / Math.PI) % 360) + 360) % 360;
    const n = (d) => { let k = Math.round(d / 10) % 36; if (k === 0) k = 36; return String(k).padStart(2, '0'); };
    let a = n(hdg), bnum = n((hdg + 180) % 360);
    // parallel runways get L / R (left and right as seen by the pilot on each heading)
    const parallels = b.runways.filter(o => Math.abs((o.rot || 0) - (rw.rot || 0)) < 0.05);
    if (parallels.length > 1) {
        const sorted = [...parallels].sort((p, q) => p.lx - q.lx);
        const i = sorted.indexOf(rw), last = sorted.length - 1;
        const la = i === 0 ? 'L' : i === last ? 'R' : 'C', lb = i === 0 ? 'R' : i === last ? 'L' : 'C';
        a += la; bnum += lb;
    }
    return { toward: a, from: bnum }; // 'toward' is painted at the +z end (where you land heading -z)
}
function onRunway(b, rw, x, z) {
    const { lx, lz } = worldToBase(b, x, z);
    const dx = lx - rw.lx, dz = lz - rw.lz, r = -(rw.rot || 0);
    const c = Math.cos(r), s = Math.sin(r);
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    return Math.abs(rx) < rw.w * 0.6 && Math.abs(rz) < rw.len / 2 + 40;
}

// base-local → world (matches the dressing group's rotation.y = -heading)
export function baseToWorld(b, lx, lz) {
    const c = Math.cos(b.heading), s = Math.sin(b.heading);
    return { x: b.x + lx * c - lz * s, z: b.z + lx * s + lz * c };
}
export function worldToBase(b, x, z) {
    const c = Math.cos(b.heading), s = Math.sin(b.heading), dx = x - b.x, dz = z - b.z;
    return { lx: dx * c + dz * s, lz: -dx * s + dz * c };
}

// ── Height function (metres). Shared by rendering, collisions and AI ──
export function terrainHeight(x, z) {
    let c = fbm(x * 0.000065 + 3.1, z * 0.000065 - 7.7, 4);
    let flatten = 1, flatH = 0;
    for (let i = 0; i < BASES.length; i++) {
        const b = BASES[i];
        const dx = x - b.x, dz = z - b.z;
        const d2 = dx * dx + dz * dz;
        c += 0.45 * Math.exp(-d2 / (7000 * 7000));
        if (d2 < b.r * b.r * 4) {
            const f = smoothstep(b.r, b.r * 2, Math.sqrt(d2));
            if (f < flatten) { flatten = f; flatH = b.h; }
        }
    }
    const land = smoothstep(-0.04, 0.16, c);
    const mountainMask = smoothstep(-0.05, 0.3, fbm(x * 0.00011 + 11.3, z * 0.00011 + 5.2, 3));
    const m = ridged(x * 0.00032 + 1.7, z * 0.00032 - 4.1, 5);
    const hills = fbm(x * 0.0008 + 2.2, z * 0.0008 + 9.1, 4);
    const detail = fbm(x * 0.0035, z * 0.0035, 3);
    let h = land * (32 + hills * 170 + m * m * 1900 * mountainMask + detail * 22) + (1 - land) * (-140 + detail * 20);
    if (flatten < 1) h = lerp(flatH, h, flatten);
    return h;
}

// Approximate surface normal (for AI and landing checks)
export function terrainNormal(x, z, out) {
    const e = 6;
    const hL = terrainHeight(x - e, z), hR = terrainHeight(x + e, z);
    const hD = terrainHeight(x, z - e), hU = terrainHeight(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
}

export function groundHeight(x, z) {
    return Math.max(terrainHeight(x, z), 0);
}

export function isOnRunway(x, z) {
    for (const b of BASES) {
        if (Math.hypot(x - b.x, z - b.z) > b.r * 1.6) continue;
        for (const rw of b.runways) if (onRunway(b, rw, x, z)) return b;
    }
    return null;
}

// run a build generator (see World.tileGeometryJob) to completion
function runJob(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }

// 2D gradient noise that tiles over the unit square with P cells per side (seamless textures), about -1..1
const GRAD_X = new Float32Array(256), GRAD_Y = new Float32Array(256);
for (let i = 0; i < 256; i++) { const a = (i / 256) * Math.PI * 2 + 0.37; GRAD_X[i] = Math.cos(a); GRAD_Y[i] = Math.sin(a); }
function periodicNoise(u, v, P, seed) {
    const x = u * P, y = v * P, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const g = (ix, iy, dx, dy) => {
        ix = ((ix % P) + P) % P; iy = ((iy % P) + P) % P;
        let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
        h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) & 255;
        return GRAD_X[h] * dx + GRAD_Y[h] * dy;
    };
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = g(x0, y0, fx, fy), b = g(x0 + 1, y0, fx - 1, fy), c = g(x0, y0 + 1, fx, fy - 1), d = g(x0 + 1, y0 + 1, fx - 1, fy - 1);
    return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 1.4;
}

const FAR_SHADOW = 1500; // half-size of the far shadow cascade (m)
// grass around the camera: a dense inner grid and a coarse outer one (cell size m, cells per side, blade scale);
// ground data comes from tex x tex textures, texel metres apart, refilled once the camera has moved `recentre` m
const GRASS = { layers: [{ cell: 0.5, n: 72, scale: 1 }, { cell: 1.5, n: 100, scale: 1.25 }], tex: 48, texel: 5, recentre: 20 };
const _sx = new THREE.Vector3(), _sy = new THREE.Vector3(), _sc = new THREE.Vector3(), _fc = new THREE.Vector3(), _v1 = new THREE.Vector3();

// ── Tree models ──
// Every tree shape is built here, in one place, so they can be swapped for loaded models later. Contract:
// non-indexed BufferGeometry with position / normal / color, trunk base at y = 0, roughly life size
// (pine ~18 m, broadleaf ~12 m, bush ~2.5 m) before the per-instance scale of 0.6-1.5.
export function makeTreeGeometries() {
    const col = new THREE.Color();
    // parts: { geo, color, ao: [y0, y1] (darker toward y0), radial: centre (soft blob normals) }
    const bake = (parts) => {
        const P = [], N = [], C = [];
        for (const pt of parts) {
            const g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo;
            const p = g.attributes.position.array, n = g.attributes.normal.array;
            col.set(pt.color);
            for (let i = 0; i < p.length; i += 3) {
                const x = p[i], y = p[i + 1], z = p[i + 2];
                let nx = n[i], ny = n[i + 1], nz = n[i + 2];
                if (pt.radial) {
                    nx = x - pt.radial[0]; ny = (y - pt.radial[1]) * 1.4; nz = z - pt.radial[2];
                    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
                }
                const ao = pt.ao ? lerp(0.5, 1.12, smoothstep(pt.ao[0], pt.ao[1], y)) : 1;
                P.push(x, y, z); N.push(nx, ny, nz); C.push(col.r * ao, col.g * ao, col.b * ao);
            }
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        out.computeBoundingSphere();
        return out;
    };
    const trunk = (h, r0) => { const g = new THREE.CylinderGeometry(r0 * 0.6, r0, h, 6, 1, true); g.translate(0, h / 2, 0); return g; };
    // a lumpy crown: a displaced icosphere (identical positions move alike, so it stays closed)
    const crown = (rad, detail, cx, cy, cz, sy, seed) => {
        const g = new THREE.IcosahedronGeometry(rad, detail);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const k = 1 + 0.16 * Math.sin(x * 1.3 + y * 0.8 + seed) * Math.sin(z * 1.1 - y * 0.9 + seed * 2.0) + 0.08 * Math.sin(x * 2.9 - z * 2.3 + seed);
            p.setXYZ(i, cx + x * k, cy + y * k * sy, cz + z * k);
        }
        return g;
    };
    const tiers = [[4.8, 8, 7.5], [3.9, 7, 11.5], [2.8, 6, 15.2], [1.6, 4, 18]];
    const pine = bake([
        { geo: trunk(6, 0.55), color: 0x4a3525 },
        ...tiers.map(([r, h, y], i) => {
            const c = new THREE.ConeGeometry(r, h, 8, 1, true);
            c.translate(0, y, 0);
            return { geo: c, color: i > 1 ? 0x2d5a34 : 0x234a2b, ao: [y - h / 2, y + h / 2] };
        }),
    ]);
    const broadleaf = bake([
        { geo: trunk(6.5, 0.5), color: 0x4f3a28 },
        { geo: crown(4.6, 1, 0, 8.8, 0, 0.82, 1.3), color: 0x3a5f2a, ao: [5.2, 12.5], radial: [0, 8.8, 0] },
        { geo: crown(2.8, 0, 1.9, 11.2, 0.6, 0.85, 4.1), color: 0x44692e, ao: [8.5, 13.5], radial: [1.9, 11.2, 0.6] },
    ]);
    const bush = bake([
        { geo: crown(1.9, 0, 0, 1.3, 0, 0.62, 2.7), color: 0x465f2c, ao: [0.2, 2.6], radial: [0, 0.9, 0] },
        { geo: crown(1.3, 0, 1.2, 1.0, 0.5, 0.7, 5.3), color: 0x557631, ao: [0.2, 2.2], radial: [1.2, 0.8, 0.5] },
    ]);
    return { pine, broadleaf, bush };
}

function disposeTrees(g) {
    if (!g) return;
    for (const m of g.isInstancedMesh ? [g] : g.children) m.dispose();
}

// ═══════════════════════════════════════════════════════════════
export class World {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.time = 0;
        this.sunDir = new THREE.Vector3();
        this.fogColor = new THREE.Color();
        this.tiles = new Map();
        this.buildQueue = [];
        this.uTime = { value: 0 };                           // shared by terrain (foam, LOD morph) and trees (sway)
        this.uWind = { value: new THREE.Vector3(1, 0.4, 0) }; // tree sway: wind direction (x, z) and strength (y)
        this.terrainDetail = { value: 1 };                   // 0 on 'low' quality: no close-up ground detail
        this.detailTex = this.makeDetailTexture();

        this.initLights();
        this.initSky();
        this.initTerrainMaterial();
        this.initWater();
        this.clouds = new Clouds(this.scene, this.renderer, { FOG_GLSL, SKY_FOG }); // raymarched cumulus + rain deck (clouds.js)
        this.overcast = 0;
        this.initTreeAssets();
        this.initGrass();
        this.initBases();
        this.scene.fog = new THREE.FogExp2(0xbfd4e6, 0.00006);
        this.weather = 'clear';
        this.initRain();
        this.lightningT = 5;
        this.flash = 0;
    }

    // ── Weather: clear / cloudy / rain / storm ──
    setWeather(w) {
        this.weather = w || 'clear';
        if (this.timeKey) this.setTime(this.timeKey); // re-applies the palette with weather applied
    }

    applyWeather(P) {
        const w = this.weather;
        const k = w === 'cloudy' ? 0.35 : w === 'rain' ? 0.7 : w === 'storm' ? 1 : 0;
        // cloud cover and cloud heights per weather live in clouds.js; here only how overcast it gets
        P.overcast = w === 'rain' ? 0.6 : w === 'storm' ? 0.85 : 0;
        if (!k) return;
        const grey = new THREE.Color(0x6f7780), dark = new THREE.Color(0x3a4048);
        P.zenith.lerp(dark, 0.55 * k);
        P.horizon.lerp(grey, 0.6 * k);
        P.glow.lerp(grey, 0.8 * k);
        P.belt.multiplyScalar(1 - k);
        P.sunI *= 1 - 0.65 * k;
        P.hemiI *= 1 + 0.3 * k; // diffuse sky light takes over from the hidden sun
        P.fogDensity *= 1 + 1.8 * k;
        P.mist = P.mist * (1 + k) + 0.00015 * k; P.mistH += 40 * k;
        P.clouds.lerp(new THREE.Color(0x9aa2ab), 0.7 * k);
        P.cloudShadow.lerp(new THREE.Color(0x3c434c), 0.8 * k);
        P.water.lerp(new THREE.Color(0x1d2a33), 0.6 * k);
        P.sun.lerp(new THREE.Color(0xc8ccd2), 0.6 * k);
    }

    initRain() {
        const N = 4000, B = 140;
        const seeds = new Float32Array(N * 2 * 3), ends = new Float32Array(N * 2);
        for (let i = 0; i < N; i++) {
            const x = Math.random() * B, y = Math.random() * B, z = Math.random() * B;
            for (let e = 0; e < 2; e++) { seeds.set([x, y, z], (i * 2 + e) * 3); ends[i * 2 + e] = e; }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
        g.setAttribute('end', new THREE.BufferAttribute(ends, 1));
        this.rainMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: false,
            uniforms: { cam: { value: new THREE.Vector3() }, time: { value: 0 }, box: { value: B }, fall: { value: new THREE.Vector3(3, -42, -2) }, intensity: { value: 0 } },
            vertexShader: /* glsl */`
                attribute float end; uniform vec3 cam, fall; uniform float time, box, intensity;
                varying float vA;
                void main() {
                    vec3 p = position + fall * time;
                    p = cam + mod(p - cam + box * 0.5, box) - box * 0.5;
                    p -= fall * 0.035 * end; // streak length along the fall direction
                    vA = intensity * (1.0 - end * 0.7) * smoothstep(box * 0.5, box * 0.2, length(p - cam));
                    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
                }`,
            fragmentShader: /* glsl */`
                varying float vA;
                void main() { gl_FragColor = vec4(0.72, 0.78, 0.86, vA * 0.45); }`,
        });
        this.rain = new THREE.LineSegments(g, this.rainMat);
        this.rain.frustumCulled = false;
        this.rain.renderOrder = 11;
        this.rain.visible = false;
        this.scene.add(this.rain);
        // lightning bolt (re-shaped each strike)
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
        this.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: new THREE.Color(6, 6, 8), transparent: true, blending: THREE.AdditiveBlending, fog: false }));
        this.bolt.frustumCulled = false;
        this.bolt.visible = false;
        this.scene.add(this.bolt);
    }

    updateWeather(dt, camera, game) {
        const w = this.weather;
        const raining = w === 'rain' || w === 'storm';
        this.rain.visible = raining;
        if (raining) {
            const u = this.rainMat.uniforms;
            u.cam.value.copy(camera.position);
            u.time.value = this.time;
            // rain falls below the cloud base
            u.intensity.value = (w === 'storm' ? 1 : 0.7) * THREE.MathUtils.clamp((1900 - camera.position.y) / 600, 0, 1);
            u.fall.value.set(game.wind.x * (w === 'storm' ? 3 : 1.5), -42, game.wind.z * (w === 'storm' ? 3 : 1.5));
        }
        // lightning
        this.flash = Math.max(0, this.flash - dt * 6);
        this.bolt.visible = this.flash > 0.2;
        if (w === 'storm') {
            this.lightningT -= dt;
            if (this.lightningT <= 0) {
                this.lightningT = 3 + Math.random() * 9;
                this.strike(camera, game);
            }
        }
        const f = this.flash;
        this.hemi.intensity = this.baseHemi + f * 3;
        this.clouds.flash = f; // lightning lights the clouds up from inside
        this.skyMat.uniforms.zenith.value.copy(this.palette.zenith).lerp(new THREE.Color(0.8, 0.82, 0.95), f * 0.6);
    }

    clearFlash() {
        this.flash = 0;
        this.clouds.flash = 0;
        this.bolt.visible = false;
        if (this.baseHemi != null) this.hemi.intensity = this.baseHemi;
        if (this.palette) this.skyMat.uniforms.zenith.value.copy(this.palette.zenith);
    }

    strike(camera, game) {
        const a = Math.random() * Math.PI * 2, d = 1500 + Math.random() * 7000;
        const x = camera.position.x + Math.cos(a) * d, z = camera.position.z + Math.sin(a) * d;
        const top = 1700, ground = Math.max(terrainHeight(x, z), 0);
        const pos = this.bolt.geometry.attributes.position;
        let px = x, pz = z;
        for (let i = 0; i < 40; i++) {
            const t = i / 39;
            px += (Math.random() - 0.5) * 60; pz += (Math.random() - 0.5) * 60;
            pos.setXYZ(i, px, top + (ground - top) * t, pz);
        }
        pos.needsUpdate = true;
        this.flash = 1;
        const dist = camera.position.distanceTo(new THREE.Vector3(x, (top + ground) / 2, z));
        setTimeout(() => game.audio.thunder && game.audio.thunder(dist), (dist / 343) * 1000);
    }

    // ── Time of day ──
    setTime(key) {
        const t = TIMES[key] || TIMES.day;
        this.timeKey = key;
        const el = t.elevation * DEG, az = t.azimuth * DEG;
        this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
        const night = key === 'night';
        const low = smoothstep(25, 2, t.elevation);

        // hemi + environment map both add sky light: the environment carries most of it (and the jets'
        // reflections), the hemisphere light only a little, so shadowed sides stay darker than sunlit ones
        const P = {
            zenith: new THREE.Color(0x2463b4), horizon: new THREE.Color(0xb3cde4), sun: new THREE.Color(0xfff1dc),
            sunI: 3.3, hemiSky: new THREE.Color(0x9cc0e4), hemiGround: new THREE.Color(0x5a5236), hemiI: 0.5, envI: 0.62,
            fogDensity: 0.000062, glow: new THREE.Color(0xffe2b8), belt: new THREE.Color(0x000000),
            clouds: new THREE.Color(0xffffff), cloudShadow: new THREE.Color(0x8e9db2),
            water: new THREE.Color(0x14506c), mist: 0.00012, mistH: 60, haze: 1500,
        };
        if (key === 'dawn') {
            P.zenith.set(0x2d4f88); P.horizon.set(0xc8b4b4); P.sun.set(0xffb070); P.sunI = 2.5;
            P.hemiSky.set(0x8aa4cc); P.hemiGround.set(0x4b3f33); P.hemiI = 0.45; P.envI = 0.55; P.glow.set(0xff9a50); P.belt.set(0x3a2436);
            P.clouds.set(0xffd2b0); P.cloudShadow.set(0x6f6a88); P.fogDensity = 0.00007; P.water.set(0x183248);
            P.mist = 0.0005; P.mistH = 80;
        } else if (key === 'dusk') {
            P.zenith.set(0x213670); P.horizon.set(0xb49aa2); P.sun.set(0xff8a3c); P.sunI = 2.3;
            P.hemiSky.set(0x7f7fb0); P.hemiGround.set(0x40302a); P.hemiI = 0.42; P.envI = 0.55; P.glow.set(0xff6a20); P.belt.set(0x40263c);
            P.clouds.set(0xffb088); P.cloudShadow.set(0x62506e); P.fogDensity = 0.00007; P.water.set(0x1a2a40);
            P.mist = 0.00045; P.mistH = 70;
        } else if (night) {
            P.zenith.set(0x02050d); P.horizon.set(0x0f1a2e); P.sun.set(0x9fb6e0); P.sunI = 0.35;
            P.hemiSky.set(0x33456b); P.hemiGround.set(0x10141a); P.hemiI = 0.3; P.envI = 0.6; P.glow.set(0x3a4a70);
            P.clouds.set(0x39455e); P.cloudShadow.set(0x161c28); P.fogDensity = 0.00008; P.water.set(0x040b14);
            P.mist = 0.0004; P.mistH = 70;
            // moonlight comes from high up
            this.sunDir.set(0.35, 0.6, -0.4).normalize();
        }
        this.applyWeather(P);
        this.palette = P;
        this.fogColor.copy(P.horizon);
        this.scene.fog.color.copy(P.horizon);
        this.scene.fog.density = P.fogDensity;
        this.scene.background = P.horizon;
        // shared aerial-perspective parameters (see FOG_GLSL)
        const skyGlowDir = night ? _v1.set(-0.3, 0.45, -0.85).normalize() : this.sunDir;
        SKY_FOG.a[0] = P.fogDensity; SKY_FOG.a[1] = 1 / P.haze;
        SKY_FOG.b[0] = skyGlowDir.x; SKY_FOG.b[1] = skyGlowDir.y; SKY_FOG.b[2] = skyGlowDir.z;
        SKY_FOG.b[3] = (0.25 + low * 0.9) * (1 - (P.overcast || 0) * 0.6);
        SKY_FOG.c[0] = P.glow.r; SKY_FOG.c[1] = P.glow.g; SKY_FOG.c[2] = P.glow.b;
        SKY_FOG.d[0] = P.mist; SKY_FOG.d[1] = 1 / P.mistH; SKY_FOG.d[2] = night ? 1.25 : 1.12;
        this.setFogEdge();

        this.sun.color.copy(P.sun);
        this.sun.intensity = P.sunI;
        this.hemi.color.copy(P.hemiSky);
        this.hemi.groundColor.copy(P.hemiGround);
        this.hemi.intensity = P.hemiI;
        this.baseHemi = P.hemiI;

        const su = this.skyMat.uniforms;
        su.zenith.value.copy(P.zenith);
        su.horizon.value.copy(P.horizon);
        su.sunColor.value.copy(P.sun);
        su.glowColor.value.copy(P.glow);
        su.beltColor.value.copy(P.belt);
        su.sunDir.value.copy(skyGlowDir);
        su.night.value = night ? 1 : 0;
        su.lowSun.value = low;
        su.overcast.value = P.overcast || 0;
        this.stars.visible = night && (P.overcast || 0) < 0.6;

        const wu = this.waterMat.uniforms;
        wu.deepColor.value.copy(P.water);
        wu.skyColor.value.copy(P.zenith);
        wu.horizonColor.value.copy(P.horizon);
        wu.sunColor.value.copy(P.sun).multiplyScalar((night ? 0.4 : 1) * (1 - (P.overcast || 0) * 0.85)); // a moon glint on the water at night
        wu.sunDir.value.copy(this.sunDir);

        // clouds: weather-driven cover and the rain/storm deck, lit with the time-of-day palette
        this.overcast = P.overcast || 0;
        this.clouds.setWeather(this.weather, this.overcast);
        this.clouds.setPalette({ lit: P.clouds, shadow: P.cloudShadow, sunDir: this.sunDir, overcast: this.overcast });
        // under an overcast the sun's shadows go soft
        this.sun.shadow.intensity = this.sunFar.shadow.intensity = 1 - this.overcast * 0.6;

        this.terrainMat.emissive = new THREE.Color(night ? 0x020306 : 0x000000);
        this.terrainDesat.value = night ? 0.45 : 0; // moonlight washes the colour out of grass and sand
        this.envI = P.envI;
        this.baseLights.forEach(l => (l.visible = night || key === 'dusk'));
        if (this.towns) this.towns.setNight(night || key === 'dusk');
        if (this.airbases) this.airbases.setNight(night || key === 'dusk');
        if (this.airTraffic) this.airTraffic.setNight(night || key === 'dusk');
        this.updateEnvironment();
    }

    updateEnvironment() {
        // Bake the sky dome into a PMREM environment so PBR jets reflect the sky
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const envScene = new THREE.Scene();
        const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
        envScene.add(dome);
        // Ground hemisphere for the lower half of the reflection
        const ground = new THREE.Mesh(
            new THREE.SphereGeometry(90, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: this.palette.hemiGround.clone().multiplyScalar(0.8), side: THREE.BackSide })
        );
        envScene.add(ground);
        const saved = this.skyMat.uniforms.camPos.value.clone();
        this.skyMat.uniforms.camPos.value.set(0, 0, 0);
        this.skyMat.uniforms.domeCentered.value = 1;
        const rt = pmrem.fromScene(envScene, 0.02);
        this.skyMat.uniforms.camPos.value.copy(saved);
        this.skyMat.uniforms.domeCentered.value = 0;
        dome.geometry.dispose(); ground.geometry.dispose(); ground.material.dispose();
        if (this.envRT) this.envRT.dispose();
        this.envRT = rt;
        this.scene.environment = rt.texture;
        this.scene.environmentIntensity = this.envI ?? 1;
        pmrem.dispose();
    }

    // the haze thickens to the horizon colour before the streamed terrain runs out (VIEW_TILES changes with quality)
    setFogEdge() {
        const end = (this.VIEW_TILES - 0.3) * this.TILE;
        SKY_FOG.a[2] = end * 0.7; SKY_FOG.a[3] = end;
    }

    initLights() {
        this.sun = new THREE.DirectionalLight(0xffffff, 3);
        this.sun.castShadow = true;
        const sc = this.sun.shadow.camera;
        sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 1200;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.radius = 2.5; // PCFShadowMap is the soft one since r182
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.05;
        this.scene.add(this.sun);
        this.scene.add(this.sun.target);
        // Far shadow cascade (see patchCascadeShadows): no light of its own, just a wide map ahead of the camera.
        // Added after the sun so it sorts second among the shadow casters.
        this.sunFar = new THREE.DirectionalLight(0xffffff, 0);
        this.sunFar.castShadow = CASCADES;
        this.sunFar.visible = CASCADES;
        const fc = this.sunFar.shadow.camera;
        fc.left = -FAR_SHADOW; fc.right = FAR_SHADOW; fc.top = FAR_SHADOW; fc.bottom = -FAR_SHADOW; fc.near = 10; fc.far = 7000;
        this.sunFar.shadow.mapSize.set(2048, 2048);
        this.sunFar.shadow.radius = 1.6;
        this.sunFar.shadow.bias = -0.0003;
        this.sunFar.shadow.normalBias = 1.2;
        this.scene.add(this.sunFar);
        this.scene.add(this.sunFar.target);
        this.farShadowFrame = 0;
        this.hemi = new THREE.HemisphereLight(0x9cc4ec, 0x4a5a3a, 1);
        this.scene.add(this.hemi);
    }

    // Quality presets (main.js): 'low' turns every extra off and must stay at least as fast as before
    setQuality(q) {
        this.quality = q;
        const low = q === 'low';
        this.sun.castShadow = !low;
        const far = CASCADES && !low;
        this.sunFar.visible = this.sunFar.castShadow = far;
        const size = q === 'high' ? 2048 : 1024;
        if (this.sunFar.shadow.mapSize.x !== size) {
            this.sunFar.shadow.mapSize.set(size, size);
            if (this.sunFar.shadow.map) { this.sunFar.shadow.map.dispose(); this.sunFar.shadow.map = null; }
        }
        this.treeShadows = !low;
        // 'low' plants one kind of tree (one draw call per tile, as before); rebuild the tree tiles on a switch
        if (this.lowTrees !== low) { this.lowTrees = low; this.refreshTrees(); }
        this.clouds.setQuality(q); // cheaper cloud march on lower settings
        for (const t of this.tiles.values()) if (t.trees) for (const m of t.trees.children) m.castShadow = this.treeShadows && m.geometry !== this.treeGeos.bush;
        this.terrainDetail.value = low ? 0 : 1;
        // 'low' compiles the terrain without close-up detail, bump, rock strata and surf
        if (('TERRAIN_LOW' in this.terrainMat.defines) !== low) {
            if (low) this.terrainMat.defines.TERRAIN_LOW = ''; else delete this.terrainMat.defines.TERRAIN_LOW;
            this.terrainMat.needsUpdate = true;
        }
        this.grassOn = q === 'high';
        this.setFogEdge();
    }

    // Aim a shadow camera at `centre`, snapped to its own texel grid so shadow edges don't crawl as it moves
    aimShadow(light, centre, halfSize, back) {
        const s = this.sunDir, t = light.shadow.mapSize.x;
        const texel = (2 * halfSize) / t;
        _sx.set(0, 1, 0).cross(s);
        if (_sx.lengthSq() < 1e-6) _sx.set(1, 0, 0);
        _sx.normalize();
        _sy.crossVectors(s, _sx);
        const u = Math.round(centre.dot(_sx) / texel) * texel, v = Math.round(centre.dot(_sy) / texel) * texel, w = centre.dot(s);
        _sc.copy(_sx).multiplyScalar(u).addScaledVector(_sy, v).addScaledVector(s, w);
        light.target.position.copy(_sc);
        light.position.copy(_sc).addScaledVector(s, back);
    }

    // ── Sky dome ──
    initSky() {
        this.skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false,
            uniforms: {
                zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
                sunColor: { value: new THREE.Color() }, glowColor: { value: new THREE.Color() }, beltColor: { value: new THREE.Color() },
                sunDir: { value: new THREE.Vector3(0, 1, 0) }, camPos: { value: new THREE.Vector3() },
                night: { value: 0 }, lowSun: { value: 0 }, domeCentered: { value: 0 }, overcast: { value: 0 },
                skyFogA: { value: SKY_FOG.a }, skyFogB: { value: SKY_FOG.b }, skyFogC: { value: SKY_FOG.c }, skyFogD: { value: SKY_FOG.d },
            },
            vertexShader: /* glsl */`
                varying vec3 vWorld;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorld = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                    // push to the far plane (which is depth 0 with a reversed depth buffer)
                    #ifdef USE_REVERSED_DEPTH_BUFFER
                    gl_Position.z = 0.0;
                    #else
                    gl_Position.z = gl_Position.w;
                    #endif
                }`,
            fragmentShader: /* glsl */`
                uniform vec3 zenith, horizon, sunColor, glowColor, beltColor, sunDir, camPos;
                uniform float night, lowSun, domeCentered, overcast;
                varying vec3 vWorld;
                ${FOG_GLSL}
                float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
                float vnoise(vec3 p) {
                    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
                               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
                }
                void main() {
                    vec3 dir = normalize(vWorld - camPos);
                    float h = dir.y;
                    float up = clamp(h, 0.0, 1.0);
                    // deeper blue overhead, a pale band just above the horizon
                    vec3 col = mix(horizon, zenith, pow(up, 0.5));
                    vec3 sd3 = normalize(sunDir);
                    float sdr = dot(dir, sd3), sd = max(sdr, 0.0);
                    // warm glow around the sun; at the horizon it equals the fog's in-scatter (skyFogColor), so the
                    // hazy terrain edge melts into the sky
                    col += glowColor * pow(sd, 6.0) * (0.25 + lowSun * 0.9 * exp(-up * 6.0)) * (1.0 - overcast * 0.6);
                    // dawn/dusk: the pink "belt of Venus" above the horizon opposite the sun
                    col += beltColor * lowSun * pow(max(-sdr, 0.0), 1.5) * exp(-abs(up - 0.08) * 14.0) * (1.0 - night);
                    col += sunColor * (pow(sd, 90.0) * 0.6 + pow(sd, 1200.0) * 2.5) * (1.0 - night * 0.8) * (1.0 - overcast * 0.8);
                    // below the horizon: the same colour the fog gives distant ground and sea
                    if (h < 0.0) col = mix(col, skyFogColor(horizon, vec3(dir.x, 0.0, dir.z), 0.0), smoothstep(0.0, -0.04, h));
                    // sun / moon disc
                    float disc = smoothstep(0.99955, 0.99975, sd) * (1.0 - overcast * 0.9);
                    if (night > 0.5) {
                        // Milky Way: a faint, mottled band across the night sky
                        vec3 pole = normalize(vec3(0.35, 0.5, 0.79));
                        float band = exp(-pow(dot(dir, pole) * 5.0, 2.0));
                        float n = vnoise(dir * 9.0) * 0.6 + vnoise(dir * 23.0) * 0.4;
                        col += vec3(0.020, 0.022, 0.030) * band * smoothstep(0.3, 0.8, n) * smoothstep(0.0, 0.25, h);
                        // moon: limb darkened, with darker maria
                        if (disc > 0.0) {
                            vec3 t1 = normalize(cross(sd3, vec3(0.0, 1.0, 0.0))), t2 = cross(t1, sd3);
                            vec2 q = vec2(dot(dir, t1), dot(dir, t2)) / 0.028;
                            float maria = smoothstep(0.45, 0.7, vnoise(vec3(q * 2.3, 1.7)) * 0.7 + vnoise(vec3(q * 5.1, 4.2)) * 0.3);
                            col += sunColor * disc * 2.6 * (1.0 - 0.35 * maria) * (0.75 + 0.25 * sqrt(max(1.0 - dot(q, q), 0.0)));
                        }
                    } else col += sunColor * disc * 18.0;
                    gl_FragColor = vec4(col, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), this.skyMat);
        this.skyDome.frustumCulled = false;
        this.skyDome.renderOrder = -10;
        this.scene.add(this.skyDome);

        // Stars: varied brightness and colour, a slow twinkle, fading into the horizon haze
        const starGeo = new THREE.BufferGeometry();
        const r = mulberry32(99), pos = [], mag = [];
        for (let i = 0; i < 3200; i++) {
            const u = r() * 2 - 1, th = r() * Math.PI * 2;
            const y = Math.abs(u) * 0.97 + 0.03, s = Math.sqrt(1 - y * y);
            pos.push(Math.cos(th) * s * 38000, y * 38000, Math.sin(th) * s * 38000);
            mag.push(Math.pow(r(), 3.5), r(), r());
        }
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        starGeo.setAttribute('mag', new THREE.Float32BufferAttribute(mag, 3));
        this.starMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
            uniforms: { time: { value: 0 }, pr: { value: 1 } },
            vertexShader: /* glsl */`
                attribute vec3 mag; uniform float time, pr; varying vec3 vCol;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    #ifdef USE_REVERSED_DEPTH_BUFFER
                    gl_Position.z = 0.0;
                    #else
                    gl_Position.z = gl_Position.w;
                    #endif
                    float b = mag.x;
                    float tw = 0.8 + 0.2 * sin(time * (1.5 + mag.y * 3.0) + mag.z * 40.0);
                    float horizon = smoothstep(0.02, 0.2, normalize(position).y);
                    vCol = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.88, 0.72), mag.z) * (0.25 + 1.6 * b) * tw * horizon;
                    gl_PointSize = (1.2 + 1.8 * b) * pr;
                }`,
            fragmentShader: /* glsl */`
                varying vec3 vCol;
                void main() {
                    vec2 c = gl_PointCoord - 0.5;
                    float a = smoothstep(0.5, 0.15, length(c));
                    gl_FragColor = vec4(vCol * a, 1.0);
                }`,
        });
        this.stars = new THREE.Points(starGeo, this.starMat);
        this.stars.frustumCulled = false;
        this.stars.visible = false;
        this.stars.renderOrder = -9;
        this.scene.add(this.stars);
    }

    makeDetailTexture() {
        const S = 256;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(S, S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            // tileable noise via torus mapping
            const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
            const nx = Math.cos(a) * 2, ny = Math.sin(a) * 2, nz = Math.cos(b) * 2, nw = Math.sin(b) * 2;
            let v = fbm(nx + nz * 3.1, ny + nw * 2.7, 5) * 0.6 + fbm(nx * 4 + nw * 5, nz * 4 + ny * 5, 3) * 0.4;
            v = clamp(v * 0.9 + 0.5, 0, 1);
            const i = (y * S + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
            img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        return tex;
    }

    // ── Terrain ──
    // Ground shading. Vertex colours carry the broad land cover; the shader adds, per pixel:
    //  - broad light/dark and lush/dry variation, so fields aren't one flat green
    //  - the beach: a narrow band of sand just above the waterline, wet and darker at the water's edge, with
    //    surf foam on the waterline itself (per pixel, so it stays sharp at every terrain LOD)
    //  - close up (fading out by ~800 m): tiled grass / rock / sand detail and a matching bump
    //  - rock strata on steep faces, projected on the slope instead of stretched from above
    //  - a short morph when a tile switches resolution, so mountain silhouettes slide instead of popping
    initTerrainMaterial() {
        this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
        this.terrainMat.envMapIntensity = 0.8;
        const detail = this.detailTex;
        this.groundTex = this.makeGroundTexture();
        this.terrainDesat = { value: 0 };
        this.terrainMat.onBeforeCompile = (shader) => {
            shader.uniforms.detailMap = { value: detail };
            shader.uniforms.groundMap = { value: this.groundTex };
            shader.uniforms.uDesat = this.terrainDesat;
            shader.uniforms.uTime = this.uTime;
            shader.uniforms.uDetail = this.terrainDetail;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>
                    attribute vec4 morph; // previous LOD: height, normal x, normal z, start time
                    attribute float hTrue; // terrain height without the drawn waterline step
                    uniform float uTime;
                    varying vec3 vWPos, vWN;
                    varying float vTrueH;`)
                .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
                    float mk = clamp((uTime - morph.w) * 0.7, 0.0, 1.0);
                    mk = mk * mk * (3.0 - 2.0 * mk);
                    vec3 prevN = vec3(morph.y, sqrt(max(1.0 - morph.y * morph.y - morph.z * morph.z, 0.0)), morph.z);
                    objectNormal = normalize(mix(prevN, objectNormal, mk));
                    vWN = objectNormal;
                    vTrueH = hTrue;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    transformed.y = mix(morph.x, transformed.y, mk);
                    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                    varying vec3 vWPos, vWN;
                    varying float vTrueH;
                    uniform sampler2D detailMap, groundMap;
                    uniform float uDesat, uTime, uDetail;
                    // the sea bed doesn't get shadows (a ship's shadow would show through the water)
                    float seaFade(float s) { return mix(s, 1.0, smoothstep(-0.5, -4.0, vWPos.y)); }
                    #define SHADOW_FADE( s ) seaFade( s )
                    // bump from a height (m) that varies per pixel (Mikkelsen's surface gradient, unnormalised)
                    vec3 terrBump(vec3 pos, vec3 n, vec2 dH) {
                        vec3 dpx = dFdx(pos), dpy = dFdy(pos);
                        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
                        float det = dot(dpx, r1);
                        return normalize(abs(det) * n - sign(det) * (dH.x * r1 + dH.y * r2));
                    }`)
                .replace('#include <color_fragment>', `#include <color_fragment>
                    vec3 tN = normalize(vWN);
                    float tSlope = 1.0 - tN.y, tH = vWPos.y;
                    float tDist = length(vWPos - cameraPosition);
                    vec2 wxz = vWPos.xz;
                    vec3 pdx = dFdx(vWPos), pdy = dFdy(vWPos);
                    vec3 vcol = diffuseColor.rgb;
                    // broad variation
                    float d2 = texture2D(detailMap, wxz / 460.0).r;
                    float d3 = texture2D(detailMap, wxz / 3100.0).r;
                    float dm = texture2D(detailMap, wxz / 1300.0 + 0.37).r;
                    vec4 gm = texture2D(groundMap, wxz / 150.0);
                    diffuseColor.rgb *= mix(0.84, 1.14, d2) * mix(0.86, 1.1, d3) * mix(0.92, 1.08, gm.r);
                    // cover weights
                    float rockW = smoothstep(0.22, 0.4, tSlope);
                    float snowW = smoothstep(0.35, 0.7, min(min(vcol.r, vcol.g), vcol.b)) * (1.0 - rockW);
                    float grassW = (1.0 - rockW) * (1.0 - snowW) * smoothstep(-2.0, 1.0, tH);
                    // lush / dry meadow patches
                    diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(1.12, 1.05, 0.74), vec3(0.86, 1.0, 1.05), smoothstep(0.3, 0.7, dm)), grassW * 0.85);
                    // rock strata on steep faces, from the side
                    float sideX = abs(tN.x) / (abs(tN.x) + abs(tN.z) + 1e-4);
                    #ifndef TERRAIN_LOW
                    if (rockW > 0.0) {
                        float st = mix(textureGrad(groundMap, vWPos.xy / 90.0, pdx.xy / 90.0, pdy.xy / 90.0).g,
                                       textureGrad(groundMap, vWPos.zy / 90.0, pdx.zy / 90.0, pdy.zy / 90.0).g, sideX);
                        diffuseColor.rgb *= mix(1.0, mix(0.72, 1.2, st), rockW);
                    }
                    #endif
                    // beach: a narrow sand band above the waterline, wet at the water's edge
                    float edgeN = (gm.a - 0.5) * 2.0;
                    float sH = vTrueH;
                    // lake and sea bed below the true waterline
                    vec3 bedC = mix(vec3(0.62, 0.58, 0.42), vec3(0.2, 0.36, 0.38), smoothstep(-2.0, -60.0, sH));
                    diffuseColor.rgb = mix(diffuseColor.rgb, bedC * bedC * mix(0.9, 1.1, d2), smoothstep(-0.3, -2.5, sH));
                    float sandW = (1.0 - smoothstep(1.3, 2.9, sH + edgeN * 1.2)) * smoothstep(-4.5, -1.2, sH) * (1.0 - smoothstep(0.035, 0.1, tSlope));
                    vec3 sandC = vec3(0.55, 0.47, 0.29) * mix(1.0, 0.6, 1.0 - smoothstep(0.25, 1.0, sH + edgeN * 0.3));
                    diffuseColor.rgb = mix(diffuseColor.rgb, sandC * mix(0.92, 1.08, d2), sandW);
                    grassW *= 1.0 - sandW;
                    // surf on the waterline (the drawn shore steps from -1.5 m to +0.6 m there)
                    float foamBand = smoothstep(-0.9, -0.25, sH) * (1.0 - smoothstep(0.1, 0.55, sH)) * (1.0 - smoothstep(1500.0, 5000.0, tDist));
                    #ifndef TERRAIN_LOW
                    if (foamBand > 0.0) {
                        vec2 fuv = wxz / 21.0 + vec2(uTime * 0.011, uTime * 0.007);
                        float fn = textureGrad(groundMap, fuv, pdx.xz / 21.0, pdy.xz / 21.0).a;
                        float swash = sin(uTime * 0.8 + fn * 8.0 + dot(wxz, vec2(0.021, 0.017)));
                        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.85, 0.86), foamBand * smoothstep(0.35, 0.75, fn + swash * 0.22) * 0.85);
                    }
                    #endif
                    // close-up detail
                    float nearF = uDetail * (1.0 - smoothstep(350.0, 800.0, tDist));
                    float tBump = 0.0;
                    #ifndef TERRAIN_LOW
                    if (nearF > 0.0) {
                        vec4 g1 = textureGrad(groundMap, wxz / 9.0, pdx.xz / 9.0, pdy.xz / 9.0);
                        vec4 g2 = textureGrad(groundMap, wxz / 37.0, pdx.xz / 37.0, pdy.xz / 37.0);
                        float rk = mix(textureGrad(groundMap, vWPos.xy / 11.0, pdx.xy / 11.0, pdy.xy / 11.0).g,
                                       textureGrad(groundMap, vWPos.zy / 11.0, pdx.zy / 11.0, pdy.zy / 11.0).g, sideX);
                        float gr = g1.r * 0.65 + g2.r * 0.35;
                        float wr = rockW, ws = sandW, wn = snowW * (1.0 - sandW), wg = max(1.0 - wr - ws - wn, 0.0);
                        float det = (gr * wg + rk * wr + g1.b * ws + g2.b * wn) / max(wg + wr + ws + wn, 1e-3);
                        float amp = 0.36 * wg + 0.42 * wr + 0.18 * ws + 0.1 * wn;
                        diffuseColor.rgb *= mix(1.0, 1.0 + (det - 0.5) * 2.0 * amp, nearF);
                        // bump only where a texel is no bigger than a pixel: magnified, its slope steps texel by texel
                        float magF = smoothstep(0.006, 0.02, length(pdx) + length(pdy));
                        tBump = (det - 0.5) * nearF * magF * (0.09 * wg + 0.35 * wr + 0.03 * ws + 0.05 * wn);
                    }
                    #endif
                    vec2 tdH = vec2(dFdx(tBump), dFdy(tBump));
                    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), uDesat);`)
                .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                    #ifndef TERRAIN_LOW
                    normal = terrBump(-vViewPosition, normal, tdH);
                    #endif`);
        };
        this.TILE = 2048;
        this.VIEW_TILES = 9;
    }

    // Tileable ground detail (512², repeats seamlessly): r = grass, g = rock, b = sand grain, a = soft noise
    makeGroundTexture() {
        const S = 512, data = new Uint8Array(S * S * 4);
        const pn = periodicNoise;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const u = x / S, v = y / S;
            // grass: clumpy mottling with fine blades
            const clump = pn(u, v, 16, 11) * 0.55 + pn(u, v, 32, 12) * 0.3 + pn(u, v, 128, 13) * 0.35 + pn(u, v, 256, 14) * 0.25;
            // rock: ridged cracks over lumpy layers
            const lay = pn(u, v, 8, 21) * 0.5 + pn(u, v, 24, 22) * 0.3;
            const crack = 1 - Math.abs(pn(u, v, 20, 23)), crack2 = 1 - Math.abs(pn(u, v, 48, 24));
            const rock = lay + Math.pow(crack, 6) * -0.5 + Math.pow(crack2, 8) * -0.3 + pn(u, v, 128, 25) * 0.15;
            // sand: fine grain and soft ripples
            const rip = Math.sin((u * 30 + pn(u, v, 8, 31) * 1.2) * Math.PI * 2) * 0.2;
            const sand = rip + pn(u, v, 256, 32) * 0.35 + pn(u, v, 64, 33) * 0.2;
            const soft = pn(u, v, 4, 41) * 0.6 + pn(u, v, 8, 42) * 0.3 + pn(u, v, 16, 43) * 0.15;
            const k = (y * S + x) * 4;
            data[k] = clamp(clump * 0.75 + 0.5, 0, 1) * 255;
            data[k + 1] = clamp(rock * 0.8 + 0.55, 0, 1) * 255;
            data[k + 2] = clamp(sand * 0.8 + 0.5, 0, 1) * 255;
            data[k + 3] = clamp(soft * 0.9 + 0.5, 0, 1) * 255;
        }
        const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        return tex;
    }

    // Tile resolution by distance (in tiles). The far rings used to be very coarse (a vertex every
    // 170 m), which made shorelines jump by tens of metres whenever a tile switched resolution.
    lodFor(dist) {
        if (dist < 1.6) return 96;
        if (dist < 3.2) return 64;
        if (dist < 5.5) return 40;
        return 24;
    }

    buildTileGeometry(tx, tz, seg) { return runJob(this.tileGeometryJob(tx, tz, seg)); }

    // Tile builds are generators that yield every few rows, so updateTerrain can spread a big tile
    // over several frames instead of hitching for 20-60 ms.
    *tileGeometryJob(tx, tz, seg) {
        const T = this.TILE, step = T / seg, x0 = tx * T, z0 = tz * T;
        const N = seg + 3; // one extra ring on each side for normals
        const H = new Float32Array(N * N);
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step, h = terrainHeight(x, z);
                H[j * N + i] = this.groundConform ? this.groundConform.conform(x, z, h) : h;
            }
            if ((j & 3) === 3) yield;
        }
        const V = seg + 1;
        const vCount = V * V + V * 4;
        const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3), ht = new Float32Array(vCount);
        const skirt = 30 + step * 1.5;
        const cN = new THREE.Vector3();
        // Drawn height only (physics keeps the true terrain): open a ~2 m step at the waterline —
        // shallow lakebed dips a little, the first metre of beach rises a little — so the flat water plane
        // and near-flat beaches never fight in the depth buffer and flicker between sand and water.
        const shore = (h) => h < 0 ? h - 1.5 * Math.max(0, 1 + h / 6) : h + 0.6 * Math.max(0, 1 - h);
        const setVert = (k, i, j, drop) => {
            const h = shore(H[(j + 1) * N + (i + 1)]);
            ht[k] = H[(j + 1) * N + (i + 1)];
            pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h - drop; pos[k * 3 + 2] = z0 + j * step;
            const hl = H[(j + 1) * N + i], hr = H[(j + 1) * N + i + 2], hd = H[j * N + i + 1], hu = H[(j + 2) * N + i + 1];
            cN.set(hl - hr, 2 * step, hd - hu).normalize();
            nor[k * 3] = cN.x; nor[k * 3 + 1] = cN.y; nor[k * 3 + 2] = cN.z;
            this.colorAt(pos[k * 3], h, pos[k * 3 + 2], cN.y, col, k * 3);
        };
        let k = 0;
        for (let j = 0; j < V; j++) {
            for (let i = 0; i < V; i++) setVert(k++, i, j, 0);
            if (j & 1) yield;
        }
        // skirts: top, bottom, left, right edges
        const skirtStart = k;
        for (let i = 0; i < V; i++) setVert(k++, i, 0, skirt);
        for (let i = 0; i < V; i++) setVert(k++, i, seg, skirt);
        for (let j = 0; j < V; j++) setVert(k++, 0, j, skirt);
        for (let j = 0; j < V; j++) setVert(k++, seg, j, skirt);

        const idx = new (vCount > 65535 ? Uint32Array : Uint16Array)(seg * seg * 6 + seg * 24);
        let n = 0;
        const tri = (a, b, c) => { idx[n++] = a; idx[n++] = b; idx[n++] = c; };
        for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
            const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
            tri(a, c, b); tri(b, c, d);
        }
        const s0 = skirtStart, s1 = s0 + V, s2 = s1 + V, s3 = s2 + V;
        for (let i = 0; i < seg; i++) {
            // top edge (j=0) faces -z
            tri(i, i + 1, s0 + i); tri(i + 1, s0 + i + 1, s0 + i);
            // bottom edge (j=seg)
            const b0 = seg * V + i;
            tri(b0, s1 + i, b0 + 1); tri(b0 + 1, s1 + i, s1 + i + 1);
            // left edge (i=0)
            const l0 = i * V, l1 = (i + 1) * V;
            tri(l0, s2 + i, l1); tri(l1, s2 + i, s2 + i + 1);
            // right edge (i=seg)
            const r0 = i * V + seg, r1 = (i + 1) * V + seg;
            tri(r0, r1, s3 + i); tri(r1, s3 + i + 1, s3 + i);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        // LOD morph source (see morphFrom); by default no morph
        const mo = new Float32Array(vCount * 4);
        for (let q = 0; q < vCount; q++) { mo[q * 4] = pos[q * 3 + 1]; mo[q * 4 + 1] = nor[q * 3]; mo[q * 4 + 2] = nor[q * 3 + 2]; mo[q * 4 + 3] = -1e4; }
        geo.setAttribute('morph', new THREE.BufferAttribute(mo, 4));
        geo.setAttribute('hTrue', new THREE.BufferAttribute(ht, 1));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        geo.userData = { V, step, x0, z0 };
        return geo;
    }

    colorAt(x, h, z, ny, out, o) {
        const n = fbm(x * 0.0021, z * 0.0021, 2) * 0.5 + 0.5;
        const forest = smoothstep(0.02, 0.2, fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3));
        const slope = 1 - ny;
        let r, g, b;
        {
            // lowland grass -> forest
            r = lerp(0.33, 0.44, n); g = lerp(0.44, 0.49, n); b = lerp(0.2, 0.25, n);
            r = lerp(r, 0.17, forest * 0.8); g = lerp(g, 0.26, forest * 0.8); b = lerp(b, 0.13, forest * 0.8);
            // alpine meadow / brown highland
            const hi = smoothstep(350, 800, h);
            r = lerp(r, 0.42 + n * 0.08, hi); g = lerp(g, 0.39 + n * 0.06, hi); b = lerp(b, 0.3, hi);
            // rock on steep slopes
            const rock = smoothstep(0.28, 0.5, slope + (h > 600 ? 0.1 : 0));
            r = lerp(r, 0.44 + n * 0.1, rock); g = lerp(g, 0.42 + n * 0.08, rock); b = lerp(b, 0.4 + n * 0.06, rock);
            // snow
            const snow = smoothstep(1150, 1450, h + n * 180) * (1 - smoothstep(0.45, 0.7, slope));
            r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); b = lerp(b, 1.0, snow);
        }
        // base concrete aprons
        for (const base of BASES) {
            const d = Math.hypot(x - base.x, z - base.z);
            if (d < base.r * 1.05) {
                const t = smoothstep(base.r * 1.05, base.r * 0.9, d) * 0.35;
                r = lerp(r, 0.42, t); g = lerp(g, 0.46, t); b = lerp(b, 0.3, t);
            }
        }
        // convert sRGB-ish authored colours into linear for the renderer
        out[o] = r * r; out[o + 1] = g * g; out[o + 2] = b * b;
    }

    tileKey(tx, tz) { return tx + ',' + tz; }

    updateTerrain(focus, force = false) {
        const T = this.TILE;
        const ctx = Math.floor(focus.x / T), ctz = Math.floor(focus.z / T);
        const R = this.VIEW_TILES;
        const wanted = new Set();
        const jobs = [];
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
            const tx = ctx + dx, tz = ctz + dz;
            const cx = (tx + 0.5) * T, cz = (tz + 0.5) * T;
            const dist = Math.hypot(cx - focus.x, cz - focus.z) / T;
            if (dist > R + 0.5) continue;
            const key = this.tileKey(tx, tz);
            wanted.add(key);
            const seg = this.lodFor(dist);
            const t = this.tiles.get(key);
            // trees only on close tiles (built as their own job, after the ground)
            if (t && t.seg >= 48 && !t.treesDone) jobs.push({ kind: 'trees', tx, tz, key, dist, has: true });
            // hysteresis: a tile sitting right on a ring boundary keeps its resolution instead of flipping back and forth
            if (t && t.seg !== seg && (this.lodFor(dist - 0.35) === t.seg || this.lodFor(dist + 0.35) === t.seg)) continue;
            if (!t || t.seg !== seg) jobs.push({ kind: 'tile', tx, tz, seg, key, dist, has: !!t });
        }
        // remove tiles out of range
        for (const [key, t] of this.tiles) {
            if (!wanted.has(key)) {
                this.scene.remove(t.mesh); t.mesh.geometry.dispose();
                if (t.trees) { this.scene.remove(t.trees); disposeTrees(t.trees); }
                this.tiles.delete(key);
            }
        }
        // missing tiles first, then nearest
        jobs.sort((a, b) => (a.has - b.has) || (a.dist - b.dist));
        // a job part-way through carries on only if it's still wanted (the old mesh stays up meanwhile)
        const P = this.pendingJob;
        if (P && !jobs.some(j => j.kind === P.job.kind && j.key === P.job.key && j.seg === P.job.seg)) this.pendingJob = null;
        if (force) {
            this.pendingJob = null;
            for (const j of jobs) if (this.jobNeeded(j)) this.finishJob(j, runJob(this.startJob(j)), true);
            // ground that just got close enough for trees
            for (const [key, t] of this.tiles) if (t.seg >= 48 && !t.treesDone) { const [tx, tz] = key.split(',').map(Number); this.finishJob({ kind: 'trees', key, tx, tz }, runJob(this.treesJob(tx, tz))); }
            return;
        }
        // time-sliced: ~4 ms of terrain work per frame, resumed next frame
        const end = performance.now() + 4;
        let next = 0;
        while (performance.now() < end) {
            if (!this.pendingJob) {
                const j = jobs[next++];
                if (!j) break;
                if (!this.jobNeeded(j)) continue; // done earlier this frame
                this.pendingJob = { job: j, it: this.startJob(j) };
            }
            let r;
            do { r = this.pendingJob.it.next(); } while (!r.done && performance.now() < end);
            if (!r.done) break;
            const j = this.pendingJob.job;
            this.pendingJob = null;
            this.finishJob(j, r.value);
        }
    }

    jobNeeded(j) {
        const t = this.tiles.get(j.key);
        return j.kind === 'trees' ? !!t && t.seg >= 48 && !t.treesDone : !t || t.seg !== j.seg;
    }

    startJob(j) { return j.kind === 'trees' ? this.treesJob(j.tx, j.tz) : this.tileGeometryJob(j.tx, j.tz, j.seg); }

    finishJob(j, result, instant = false) {
        let t = this.tiles.get(j.key);
        if (j.kind === 'trees') {
            if (!t) { disposeTrees(result); return; }
            if (t.trees) { this.scene.remove(t.trees); disposeTrees(t.trees); }
            t.trees = result; t.treesDone = true;
            if (result) this.scene.add(result);
            return;
        }
        const geo = result;
        if (t) {
            // the new resolution grows out of the old surface instead of popping (vertex shader morph)
            if (!instant) this.morphFrom(geo, t.mesh.geometry, this.time);
            t.mesh.geometry.dispose();
            t.mesh.geometry = geo;
            t.seg = j.seg;
        } else {
            const mesh = new THREE.Mesh(geo, this.terrainMat);
            mesh.receiveShadow = true;
            mesh.matrixAutoUpdate = false;
            mesh.matrixWorldAutoUpdate = false;
            this.scene.add(mesh);
            t = { mesh, seg: j.seg, trees: null, treesDone: false };
            this.tiles.set(j.key, t);
        }
        // trees only on close tiles: far ones drop theirs
        if (j.seg < 48 && (t.trees || t.treesDone)) {
            if (t.trees) { this.scene.remove(t.trees); disposeTrees(t.trees); }
            t.trees = null; t.treesDone = false;
        }
    }

    // Fill geo's morph attribute with the old tile's surface (bilinear) at each new vertex, starting now
    morphFrom(geo, old, start) {
        const o = old.userData, n = geo.userData;
        if (!o || o.V === undefined || !geo.attributes.morph) return;
        const op = old.attributes.position.array, on = old.attributes.normal.array;
        const np = geo.attributes.position.array, mo = geo.attributes.morph.array;
        const OV = o.V, V = n.V, count = np.length / 3;
        for (let k = 0; k < count; k++) {
            const x = np[k * 3], z = np[k * 3 + 2];
            const fi = clamp((x - o.x0) / o.step, 0, OV - 1.0001), fj = clamp((z - o.z0) / o.step, 0, OV - 1.0001);
            const i0 = Math.floor(fi), j0 = Math.floor(fj), a = fi - i0, b = fj - j0;
            const k00 = (j0 * OV + i0) * 3, k10 = k00 + 3, k01 = k00 + OV * 3, k11 = k01 + 3;
            const w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
            let y = op[k00 + 1] * w00 + op[k10 + 1] * w10 + op[k01 + 1] * w01 + op[k11 + 1] * w11;
            if (k >= V * V) { // skirt vertex: keep its drop below the edge
                const i = Math.round((x - n.x0) / n.step), jj = Math.round((z - n.z0) / n.step);
                y -= np[(jj * V + i) * 3 + 1] - np[k * 3 + 1];
            } else {
                // stay on the same side of the water plane as the target, clear of it (see shore() in the tile
                // builder): a morph must never lay ground flat on the waterline, where it would flicker
                const yn = np[k * 3 + 1];
                y = yn < 0 ? Math.min(y, Math.max(yn, -1.5)) : Math.max(y, Math.min(yn, 0.6));
            }
            mo[k * 4] = y;
            mo[k * 4 + 1] = on[k00] * w00 + on[k10] * w10 + on[k01] * w01 + on[k11] * w11;
            mo[k * 4 + 2] = on[k00 + 2] * w00 + on[k10 + 2] * w10 + on[k01 + 2] * w01 + on[k11 + 2] * w11;
            mo[k * 4 + 3] = start;
        }
        geo.attributes.morph.needsUpdate = true;
    }

    // ── Trees ──
    // Shapes come from makeTreeGeometries() (module level). Forest tiles mix pines, broadleaf trees and bushes,
    // each tinted per instance; they sway in the wind and dither out with distance instead of popping.
    initTreeAssets() {
        this.treeGeos = makeTreeGeometries();
        this.forestMat = this.makeTreeMaterial(3100, 4200);
        // towns.js plants park and street trees with treeGeo / treeMat (their meshes are culled at 12 km)
        this.treeGeo = this.treeGeos.broadleaf;
        this.treeMat = this.makeTreeMaterial(9000, 11500);
        this.treeShadows = true;
        this.lowTrees = false; // set by setQuality()
    }

    makeTreeMaterial(fadeNear, fadeFar) {
        const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
        m.onBeforeCompile = (sh) => {
            sh.uniforms.uTime = this.uTime;
            sh.uniforms.uWind = this.uWind;
            sh.uniforms.uFade = { value: new THREE.Vector2(fadeNear, fadeFar) };
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    #ifdef USE_INSTANCING
                    {   // sway: bends more toward the top, gusts roll across the forest, each tree in its own phase
                        vec3 tp = instanceMatrix[3].xyz;
                        float ph = dot(tp.xz, vec2(0.071, 0.053));
                        float gust = 0.55 + 0.45 * sin(uTime * 0.37 - dot(tp.xz, vec2(0.004, 0.003)));
                        float bend = uWind.y * 0.0016 * position.y * position.y;
                        vec3 wd = vec3(uWind.x, 0.0, uWind.z);
                        vec3 disp = wd * bend * (0.55 * gust + 0.25 * sin(uTime * 1.7 + ph)) + vec3(-wd.z, 0.0, wd.x) * bend * 0.18 * sin(uTime * 2.9 + ph * 1.9);
                        mat3 im = mat3(instanceMatrix);
                        transformed += transpose(im) * disp / max(dot(im[0], im[0]), 1e-4);
                    }
                    #endif`);
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform vec2 uFade;')
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                    {   // dithered fade with distance, so trees never pop in or out with the terrain tiles
                        float fadeF = 1.0 - smoothstep(uFade.x, uFade.y, length(vViewPosition));
                        float dn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
                        if (dn > fadeF) discard;
                    }`);
        };
        m.customProgramCacheKey = () => 'tree:' + fadeNear + ':' + fadeFar;
        return m;
    }

    // Rebuild tree tiles (after towns/roads exist, so no trees grow on them): the old trees stay up until
    // Roads shape the drawn ground next to them (see RoadGround): rebuild every tile with it
    setGroundConform(g) {
        this.groundConform = g;
        for (const t of this.tiles.values()) t.seg = -1; // updateTerrain rebuilds them (time-sliced)
    }

    // updateTerrain has rebuilt each tile's set
    refreshTrees() {
        for (const t of this.tiles ? this.tiles.values() : []) t.treesDone = false;
        if (this.pendingJob && this.pendingJob.job.kind === 'trees') this.pendingJob = null;
    }

    buildTrees(tx, tz) { return runJob(this.treesJob(tx, tz)); }

    *treesJob(tx, tz) {
        const T = this.TILE;
        const r = mulberry32((tx * 73856093) ^ (tz * 19349663));
        const lists = [[], [], []]; // pine, broadleaf, bush: { m: Matrix4, c: Color }
        let total = 0;
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < 1400 && total < 650; i++) {
            if ((i & 63) === 63) yield;
            const x = (tx + r()) * T, z = (tz + r()) * T;
            const forest = fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3);
            if (forest < 0.05 + r() * 0.15) continue;
            const h = terrainHeight(x, z);
            if (h < 10 || h > 900) continue;
            if (this.blockTree && this.blockTree(x, z)) continue; // roads, streets and buildings
            let near = false;
            for (const b of BASES) if (Math.hypot(x - b.x, z - b.z) < b.r * 1.15) near = true;
            if (near) continue;
            const e = 8;
            const slope = Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h);
            if (slope > 7) continue;
            // pines take over higher up, bushes fill the thin edges of the forest
            const pineP = 0.4 + 0.55 * smoothstep(120, 520, h);
            const bushP = forest < 0.12 ? 0.4 : 0.12;
            const u = r();
            const kind = this.lowTrees ? 0 : u < bushP ? 2 : u < bushP + (1 - bushP) * pineP ? 0 : 1;
            const sc = kind === 2 ? 0.6 + r() * 0.8 : 0.7 + r() * 0.8;
            q.setFromAxisAngle(up, r() * 6.28);
            s.set(sc, sc * (0.85 + r() * 0.4), sc);
            p.set(x, h - (kind === 2 ? 0.4 : 1), z);
            // per-tree tint: brightness and a little yellowing
            const v = 0.78 + r() * 0.42, yl = r() * (kind === 0 ? 0.12 : 0.3);
            lists[kind].push({ m: m.compose(p, q, s).clone(), c: new THREE.Color(v * (1 + yl * 0.7), v * (1 + yl * 0.3), v * (1 - yl * 0.5)) });
            total++;
        }
        if (!total) return null;
        const g = new THREE.Group();
        const geos = [this.treeGeos.pine, this.treeGeos.broadleaf, this.treeGeos.bush];
        lists.forEach((list, k) => {
            if (!list.length) return;
            const inst = new THREE.InstancedMesh(geos[k], this.forestMat, list.length);
            list.forEach((o, i) => { inst.setMatrixAt(i, o.m); inst.setColorAt(i, o.c); });
            inst.castShadow = !!this.treeShadows && k !== 2;
            inst.receiveShadow = true;
            inst.computeBoundingSphere();
            inst.matrixAutoUpdate = false;
            g.add(inst);
        });
        g.matrixAutoUpdate = false;
        return g;
    }

    // ── Grass: clumps of blades in a ring around the camera when it is low (on foot, taxiing, low passes) ──
    // Two toroidal grids of instances follow the camera (a dense one close in, a coarser one out to ~90 m);
    // the vertex shader places each clump on its world cell, so blades stay put as the camera moves. Ground
    // height (the drawn terrain), a grass mask (no grass on water, sand, rock, snow, roads, buildings or
    // airfields) and the ground colour come from small textures around the camera, refreshed as it moves.
    initGrass() {
        const G = GRASS;
        const blades = [];
        const r = mulberry32(51);
        for (let b = 0; b < 7; b++) {
            const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.4, h = 0.3 + r() * 0.4, w = 0.022 + r() * 0.02, lean = (r() - 0.5) * 0.6, rot = r() * Math.PI;
            const cx = Math.cos(a) * d, cz = Math.sin(a) * d, ux = Math.cos(rot) * w, uz = Math.sin(rot) * w;
            const tx = cx + Math.cos(rot + 1.57) * lean * h, tz = cz + Math.sin(rot + 1.57) * lean * h;
            blades.push(cx - ux, 0, cz - uz, cx + ux, 0, cz + uz, tx, h, tz);
        }
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(blades.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
        const cells = [];
        G.layers.forEach((L, li) => { for (let j = 0; j < L.n; j++) for (let i = 0; i < L.n; i++) cells.push(i, j, li); });
        geo.setAttribute('gi', new THREE.InstancedBufferAttribute(new Float32Array(cells), 3));
        geo.instanceCount = cells.length / 3;
        const S = G.tex;
        this.grassH = new THREE.DataTexture(new Float32Array(S * S * 4), S, S, THREE.RGBAFormat, THREE.FloatType);
        this.grassC = new THREE.DataTexture(new Float32Array(S * S * 4), S, S, THREE.RGBAFormat, THREE.FloatType);
        this.grassU = {
            grassH: { value: this.grassH }, grassC: { value: this.grassC }, grassO: { value: new THREE.Vector3(1e9, 0, 1e9) },
            grassFade: { value: 0 }, detailMap: { value: this.detailTex },
        };
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide });
        mat.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, this.grassU, { uTime: this.uTime, uWind: this.uWind });
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', `#include <common>
                    attribute vec3 gi;
                    uniform sampler2D grassH, grassC, detailMap;
                    uniform vec3 grassO; // texture origin x, z and texel size (m)
                    uniform float grassFade, uTime;
                    uniform vec3 uWind;
                    varying vec3 vGrassCol; varying float vGrassY;
                    float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                    vec4 gTex(sampler2D t, vec2 xz) { // manual bilinear (float textures)
                        vec2 f = (xz - grassO.xz) / grassO.y - 0.5;
                        ivec2 i = ivec2(floor(f)); vec2 w = fract(f);
                        ivec2 m = ivec2(${S - 1});
                        vec4 a = texelFetch(t, clamp(i, ivec2(0), m), 0), b = texelFetch(t, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
                        vec4 c = texelFetch(t, clamp(i + ivec2(0, 1), ivec2(0), m), 0), d = texelFetch(t, clamp(i + ivec2(1, 1), ivec2(0), m), 0);
                        return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
                    }`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    {
                        vec4 L = gi.z < 0.5 ? vec4(${G.layers[0].cell.toFixed(2)}, ${G.layers[0].n.toFixed(1)}, ${G.layers[0].scale.toFixed(2)}, 0.0)
                                            : vec4(${G.layers[1].cell.toFixed(2)}, ${G.layers[1].n.toFixed(1)}, ${G.layers[1].scale.toFixed(2)}, 1.0);
                        vec2 camCell = floor(cameraPosition.xz / L.x);
                        vec2 wc = camCell + mod(gi.xy - camCell, L.y) - floor(L.y * 0.5);
                        vec2 xz = (wc + vec2(gHash(wc), gHash(wc + 17.31))) * L.x;
                        vec4 hm = gTex(grassH, xz);
                        float dist = length(xz - cameraPosition.xz);
                        float outer = L.y * 0.5 * L.x;
                        // the coarse layer thins out where the dense one takes over, both fade at their edge
                        float s = hm.g * grassFade * (1.0 - smoothstep(outer * 0.6, outer * 0.95, dist));
                        if (L.w > 0.5) s *= smoothstep(${(G.layers[0].cell * G.layers[0].n * 0.3).toFixed(1)}, ${(G.layers[0].cell * G.layers[0].n * 0.45).toFixed(1)}, dist);
                        s *= L.z * (0.7 + 0.6 * gHash(wc + 3.7));
                        float ang = gHash(wc + 9.1) * 6.2832;
                        vec2 cs = vec2(cos(ang), sin(ang));
                        vec3 p = vec3(position.x * cs.x - position.z * cs.y, position.y, position.x * cs.y + position.z * cs.x) * s;
                        // wind: tips bend with the gusts
                        float bend = p.y * p.y * (0.25 + 0.2 * uWind.y) * (0.6 + 0.4 * sin(uTime * 2.3 + dot(xz, vec2(0.21, 0.17))));
                        p.xz += vec2(uWind.x, uWind.z) * bend;
                        transformed = vec3(xz.x, hm.r - 0.05, xz.y) + p;
                        vGrassY = position.y / 0.7;
                        // the ground's own colour and broad variation, so the grass matches the terrain under it
                        vec3 gc = gTex(grassC, xz).rgb;
                        gc *= mix(0.84, 1.14, texture2D(detailMap, xz / 460.0).r) * mix(0.86, 1.1, texture2D(detailMap, xz / 3100.0).r);
                        gc *= mix(vec3(1.12, 1.05, 0.74), vec3(0.86, 1.0, 1.05), smoothstep(0.3, 0.7, texture2D(detailMap, xz / 1300.0 + 0.37).r)) * 0.85 + 0.15;
                        vGrassCol = gc * (0.85 + 0.3 * gHash(wc + 5.3));
                    }`);
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol; varying float vGrassY;')
                .replace('#include <color_fragment>', `#include <color_fragment>
                    diffuseColor.rgb *= vGrassCol * mix(0.6, 1.25, vGrassY);`)
                .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
                    normal = normalize(vNormal);`);
        };
        mat.customProgramCacheKey = () => 'grass';
        this.grass = new THREE.Mesh(geo, mat);
        this.grass.frustumCulled = false;
        this.grass.receiveShadow = true;
        this.grass.visible = false;
        this.grassOn = true;
        this.scene.add(this.grass);
        this.grassCentre = new THREE.Vector2(1e9, 1e9);
    }

    // Height and up-normal of the terrain as drawn (the tile mesh under x, z), which differs from
    // terrainHeight() by up to a metre or so between vertices; falls back to the true height off the tiles
    drawnSample(x, z, out) {
        const T = this.TILE, t = this.tiles.get(this.tileKey(Math.floor(x / T), Math.floor(z / T)));
        if (!t || !t.mesh.geometry.userData.V) { out.h = terrainHeight(x, z); out.ny = 1; return out; }
        const g = t.mesh.geometry, u = g.userData, p = g.attributes.position.array, n = g.attributes.normal.array, V = u.V;
        const fx = clamp((x - u.x0) / u.step, 0, V - 1.0001), fz = clamp((z - u.z0) / u.step, 0, V - 1.0001);
        const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
        const ka = (j * V + i) * 3, kb = ka + 3, kc = ka + V * 3, kd = kc + 3;
        // the same diagonal split as the tile's triangles
        out.h = a + b <= 1 ? p[ka + 1] + (p[kb + 1] - p[ka + 1]) * a + (p[kc + 1] - p[ka + 1]) * b
            : p[kd + 1] + (p[kc + 1] - p[kd + 1]) * (1 - a) + (p[kb + 1] - p[kd + 1]) * (1 - b);
        out.ny = (n[ka + 1] * (1 - a) + n[kb + 1] * a) * (1 - b) + (n[kc + 1] * (1 - a) + n[kd + 1] * a) * b;
        return out;
    }

    updateGrass(camera, dt) {
        const cam = camera.position;
        const agl = cam.y - Math.max(terrainHeight(cam.x, cam.z), 0);
        // camera speed: no grass on fast, low passes (it would only shimmer)
        if (dt > 0) this.grassSpeed = lerp(this.grassSpeed || 0, cam.distanceTo(this.grassLastCam || cam) / dt, 0.2);
        (this.grassLastCam || (this.grassLastCam = new THREE.Vector3())).copy(cam);
        const want = this.grassOn ? (1 - smoothstep(70, 130, agl)) * (1 - smoothstep(60, 110, this.grassSpeed || 0)) : 0;
        this.grassU.grassFade.value = want;
        this.grass.visible = want > 0.01 && this.grassReady;
        if (want <= 0.01) return;
        // refill the height / mask / colour textures around the camera (time-sliced, ~1 ms a frame)
        if (!this.grassJob && Math.hypot(cam.x - this.grassCentre.x, cam.z - this.grassCentre.y) > GRASS.recentre) this.grassJob = this.grassFill(cam.x, cam.z);
        if (this.grassJob) {
            const end = performance.now() + (this.grassReady ? 1 : 8);
            let r;
            do { r = this.grassJob.next(); } while (!r.done && performance.now() < end);
            if (r.done) this.grassJob = null;
        }
    }

    *grassFill(cx, cz) {
        const S = GRASS.tex, st = GRASS.texel;
        const H = this.grassStageH || (this.grassStageH = new Float32Array(S * S * 4));
        const C = this.grassStageC || (this.grassStageC = new Float32Array(S * S * 4));
        const ox = Math.round(cx / st) * st - (S / 2) * st, oz = Math.round(cz / st) * st - (S / 2) * st;
        const col = [0, 0, 0], ds = { h: 0, ny: 1 };
        for (let j = 0; j < S; j++) {
            for (let i = 0; i < S; i++) {
                const x = ox + (i + 0.5) * st, z = oz + (j + 0.5) * st, k = (j * S + i) * 4;
                this.drawnSample(x, z, ds);
                const h = ds.h, ny = ds.ny;
                // no grass on sand, water, rock, snow, roads, buildings or inside airfield fences
                let m = smoothstep(2.8, 4.5, h) * (1 - smoothstep(900, 1150, h)) * smoothstep(0.86, 0.95, ny);
                if (m > 0 && this.towns && this.towns.blocked(x, z)) m = 0;
                if (m > 0) for (const b of BASES) {
                    if (Math.abs(x - b.x) > b.r * 2 || Math.abs(z - b.z) > b.r * 2) continue;
                    const l = worldToBase(b, x, z), f = fenceOf(b);
                    if (l.lx > f.x0 - 10 && l.lx < f.x1 + 10 && l.lz > f.z0 - 10 && l.lz < f.z1 + 10) m = 0;
                }
                H[k] = h; H[k + 1] = m;
                this.colorAt(x, h, z, ny, col, 0);
                C[k] = col[0]; C[k + 1] = col[1]; C[k + 2] = col[2];
            }
            yield;
        }
        this.grassH.image.data.set(H); this.grassC.image.data.set(C);
        this.grassH.needsUpdate = this.grassC.needsUpdate = true;
        this.grassU.grassO.value.set(ox, st, oz);
        this.grassCentre.set(cx, cz);
        this.grassReady = true;
    }

    // ── Ocean ──
    initWater() {
        this.waterMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: true, fog: false,
            uniforms: {
                time: { value: 0 }, sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color() },
                skyColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() }, deepColor: { value: new THREE.Color() },
                fogColor: { value: new THREE.Color() }, detailMap: { value: this.detailTex },
                skyFogA: { value: SKY_FOG.a }, skyFogB: { value: SKY_FOG.b }, skyFogC: { value: SKY_FOG.c }, skyFogD: { value: SKY_FOG.d },
            },
            vertexShader: /* glsl */`
                varying vec3 vWPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }`,
            fragmentShader: /* glsl */`
                uniform float time;
                uniform vec3 sunDir, sunColor, skyColor, horizonColor, deepColor, fogColor;
                uniform sampler2D detailMap;
                varying vec3 vWPos;
                ${FOG_GLSL}
                void main() {
                    vec2 p = vWPos.xz;
                    float dist = length(cameraPosition - vWPos);
                    vec3 v = normalize(cameraPosition - vWPos);
                    // roughly how many metres of water one pixel covers (grazing angles stretch it): detail
                    // finer than that only makes sparkling noise, so it fades out
                    float fp = dist * 0.0015 / max(v.y, 0.06);
                    vec3 n = vec3(0.0, 1.0, 0.0);
                    // irregular directional swell (small slopes) + scrolling noise ripples
                    const int W = 6;
                    vec2 dirs[6]; dirs[0]=vec2(0.8,0.6); dirs[1]=vec2(-0.47,0.88); dirs[2]=vec2(0.21,-0.98); dirs[3]=vec2(-0.93,-0.37); dirs[4]=vec2(0.62,-0.79); dirs[5]=vec2(0.99,0.12);
                    float freqs[6]; freqs[0]=0.0131; freqs[1]=0.0197; freqs[2]=0.0313; freqs[3]=0.0571; freqs[4]=0.0917; freqs[5]=0.1433;
                    for (int i = 0; i < W; i++) {
                        float f = freqs[i];
                        float amp = 0.5 / (float(i) * 0.7 + 1.0) * (1.0 - smoothstep(0.08, 0.3, fp * f / 6.2832));
                        vec2 q = p + vec2(sin(p.y * 0.0021 + float(i)), cos(p.x * 0.0017 - float(i))) * 60.0;
                        float ph = dot(dirs[i], q) * f + time * sqrt(9.8 * f) * 1.2;
                        n.xz -= dirs[i] * f * amp * 2.2 * cos(ph);
                    }
                    float r1 = texture2D(detailMap, p / 140.0 + vec2(time * 0.010, time * 0.006)).r;
                    float r2 = texture2D(detailMap, p / 53.0 - vec2(time * 0.014, -time * 0.009)).r;
                    float r3 = mix(0.5, texture2D(detailMap, p / 17.0 + vec2(-time * 0.02, time * 0.017)).r, 1.0 - smoothstep(0.6, 3.0, fp));
                    n.xz += (vec2(r1 - r3, r2 - r3)) * 0.3 * mix(0.1, 1.0, 1.0 - smoothstep(60.0, 900.0, dist)); // fine ripples only up close
                    n = normalize(mix(normalize(n), vec3(0.0, 1.0, 0.0), smoothstep(1500.0, 14000.0, dist) * 0.85));
                    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
                    vec3 rf = reflect(-v, n);
                    vec3 sky = mix(horizonColor, skyColor, clamp(rf.y * 1.6, 0.0, 1.0));
                    vec3 col = mix(deepColor, sky, fres);
                    float sd = max(dot(rf, normalize(sunDir)), 0.0);
                    // the sun's glitter spreads into a broader, dimmer path with distance instead of pixel-sized spikes
                    float wide = smoothstep(200.0, 5000.0, dist);
                    col += sunColor * (pow(sd, mix(900.0, 150.0, wide)) * mix(14.0, 3.0, wide) + pow(sd, 80.0) * 0.35);
                    float alpha = mix(0.72, 0.97, clamp(fres * 2.0 + smoothstep(200.0, 3000.0, dist), 0.0, 1.0));
                    vec3 ray = vWPos - cameraPosition;
                    vec2 fg = skyFogAmount(ray, cameraPosition.y);
                    col = mix(col, skyFogColor(fogColor, ray, fg.y), fg.x);
                    alpha = mix(alpha, 1.0, fg.x);
                    gl_FragColor = vec4(col, alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        const geo = new THREE.PlaneGeometry(90000, 90000, 1, 1);
        geo.rotateX(-Math.PI / 2);
        this.water = new THREE.Mesh(geo, this.waterMat);
        this.water.renderOrder = 1;
        this.water.frustumCulled = false;
        this.scene.add(this.water);
    }

    // ── Airbase dressing: runway, taxiways, hangars, tower, lights ──
    initBases() {
        this.baseLights = [];
        for (const b of BASES) {
            const g = new THREE.Group();
            g.position.set(b.x, b.h, b.z);
            g.rotation.y = -b.heading;
            for (const r of b.runways) {
                const nums = runwayNumbers(b, r);
                const rw = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.len), new THREE.MeshStandardMaterial({ map: this.makeRunwayTexture(nums, r.len, r.w), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 }));
                rw.rotation.x = -Math.PI / 2;
                const holder = new THREE.Group();
                holder.position.set(r.lx, 0.15 + (r.rot ? 0.03 : 0), r.lz);
                holder.rotation.y = -(r.rot || 0);
                holder.add(rw);
                rw.receiveShadow = true;
                g.add(holder);
                r.holder = holder;
            }
            this.scene.add(g);
            this.buildRunwayLights(b, g);
            if (b.layout !== 'standard') { freezeStatic(g); continue; }
            const apronMat = new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 0.95 });
            const taxi = new THREE.Mesh(new THREE.PlaneGeometry(22, RUNWAY.length * 0.8), apronMat);
            taxi.rotation.x = -Math.PI / 2; taxi.position.set(140, 0.1, 0); taxi.receiveShadow = true;
            g.add(taxi);
            const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 520), apronMat);
            apron.rotation.x = -Math.PI / 2; apron.position.set(290, 0.08, 150); apron.receiveShadow = true;
            g.add(apron);
            for (let k = 0; k < 3; k++) {
                const c = new THREE.Mesh(new THREE.PlaneGeometry(90, 18), apronMat);
                c.rotation.x = -Math.PI / 2; c.position.set(95, 0.09, -900 + k * 900); g.add(c);
            }
            // Hangars (only as decoration at the home base; strike targets are spawned separately)
            if (b.friendly) {
                const hangarMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.6, metalness: 0.3 });
                for (let k = 0; k < 4; k++) {
                    const h = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 50, 16, 1, false, 0, Math.PI), hangarMat);
                    h.rotation.z = Math.PI / 2; h.rotation.y = Math.PI / 2;
                    h.position.set(380, 0, -60 + k * 70);
                    h.castShadow = true; h.receiveShadow = true;
                    g.add(h);
                }
            }
            freezeStatic(g);
        }
    }

    // Runway edge lights (emissive sprites that glow with bloom at night), every runway
    buildRunwayLights(b, g) {
        const lightTex = this.lightTex || (this.lightTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,230,180,0.8)'], [1, 'rgba(255,200,120,0)']]));
        const lightMat = this.rwLightMat || (this.rwLightMat = new THREE.SpriteMaterial({ map: lightTex, color: 0xffd9a0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
        const sprites = [];
        for (const r of b.runways) {
            for (let z = -r.len / 2; z <= r.len / 2; z += 60) {
                for (const sd of [-1, 1]) {
                    const sp = new THREE.Sprite(lightMat);
                    sp.position.set(sd * (r.w / 2 + 2), 1, z);
                    sp.scale.set(5, 5, 5);
                    r.holder.add(sp);
                    sprites.push(sp);
                }
            }
        }
        let vis = true;
        this.baseLights.push({ get visible() { return vis; }, set visible(v) { vis = v; for (const sp of sprites) sp.visible = v; } });
    }

    // Runway surface with markings and painted designators (e.g. 32L at one end, 14R at the other)
    makeRunwayTexture(nums, len = 3000, w = 55) {
        const tex = this.makeRunwayTextureBase();
        if (!nums) return tex;
        const c = tex.image;
        const ctx = c.getContext('2d');
        const pxV = 4096 / len, pxU = 256 / w;
        const drawNum = (txt, atBottom) => {
            ctx.save();
            // numbers ~18 m tall, just past the threshold piano keys
            const yCenter = atBottom ? 4096 - 180 - 22 * pxV : 180 + 22 * pxV;
            ctx.translate(128, yCenter);
            if (!atBottom) ctx.rotate(Math.PI);
            ctx.scale(pxU / 6.5, pxV * 18 / 100);
            ctx.fillStyle = '#cfcfca';
            ctx.font = 'bold 100px Arial';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const num = txt.replace(/[LRC]/, ''), letter = txt.replace(/\d/g, '');
            // the L/R/C letter sits nearest the threshold, the number further along
            ctx.fillText(num, 0, letter ? -60 : 0);
            if (letter) ctx.fillText(letter, 0, 60);
            ctx.restore();
        };
        drawNum(nums.toward, true);
        drawNum(nums.from, false);
        tex.needsUpdate = true;
        return tex;
    }

    makeRunwayTextureBase() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 4096;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#34373a';
        ctx.fillRect(0, 0, 256, 4096);
        // grain
        for (let i = 0; i < 40000; i++) {
            const v = 40 + Math.random() * 30;
            ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
            ctx.fillRect(Math.random() * 256, Math.random() * 4096, 2, 2);
        }
        // tyre marks near ends: short streaks (1 px is ~0.7 m along the runway)
        ctx.fillStyle = 'rgba(20,20,20,0.2)';
        for (let i = 0; i < 140; i++) {
            ctx.fillRect(90 + Math.random() * 70, 300 + Math.random() * 500, 2, 8 + Math.random() * 20);
            ctx.fillRect(90 + Math.random() * 70, 3300 + Math.random() * 500, 2, 8 + Math.random() * 20);
        }
        ctx.fillStyle = '#c9c9c4';
        // edge lines
        ctx.fillRect(8, 0, 5, 4096); ctx.fillRect(243, 0, 5, 4096);
        // centreline dashes
        for (let y = 260; y < 3840; y += 110) ctx.fillRect(125, y, 6, 60);
        // threshold piano keys
        for (let k = 0; k < 8; k++) {
            ctx.fillRect(20 + k * 28, 30, 14, 150);
            ctx.fillRect(20 + k * 28, 4096 - 180, 14, 150);
        }
        // touchdown zones
        for (const y of [420, 3600]) { ctx.fillRect(50, y, 30, 90); ctx.fillRect(176, y, 30, 90); }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 16;
        return tex;
    }

    // ── Per-frame ──
    update(dt, camera, focus, wind) {
        this.time += dt;
        this.skyDome.position.copy(camera.position);
        this.stars.position.copy(camera.position);
        this.skyMat.uniforms.camPos.value.copy(camera.position);
        this.water.position.set(Math.round(camera.position.x / 100) * 100, 0, Math.round(camera.position.z / 100) * 100);
        const fog = this.scene.fog;
        const cam = camera.position;
        this.uTime.value = this.time;
        this.starMat.uniforms.time.value = this.time;
        this.starMat.uniforms.pr.value = this.renderer.getPixelRatio();
        const wu = this.waterMat.uniforms;
        wu.time.value = this.time;
        wu.fogColor.value.copy(fog.color);
        this.clouds.update(dt, camera, wind, fog.color);
        // trees sway with the wind, harder in a storm
        const ws = Math.hypot(wind.x, wind.z), storm = this.weather === 'storm' ? 1 : this.weather === 'rain' ? 0.5 : 0;
        this.uWind.value.set(ws > 0.1 ? wind.x / ws : 1, 0.35 + ws * 0.06 + storm * 0.9, ws > 0.1 ? wind.z / ws : 0);
        // sun shadows: the sharp near map follows the focus object; the wide far map covers the ground ahead
        this.aimShadow(this.sun, focus, 70, 600);
        // the far map is coarse and mostly static scenery: re-render it every other frame (every third on medium)
        const fs = this.sunFar.shadow;
        fs.autoUpdate = false;
        this.farShadowFrame = (this.farShadowFrame + 1) % (this.quality === 'medium' ? 3 : 2);
        if (this.sunFar.visible && this.sunFar.castShadow && (this.farShadowFrame === 0 || !fs.map)) {
            fs.needsUpdate = true;
            camera.getWorldDirection(_v1);
            const hl = Math.hypot(_v1.x, _v1.z);
            const agl = cam.y - Math.max(terrainHeight(cam.x, cam.z), 0);
            let ahead = FAR_SHADOW * 0.65;
            if (_v1.y < -0.02) ahead = Math.min(ahead, (agl / -_v1.y) * hl); // where the view ray meets the ground
            _sc.set(cam.x, 0, cam.z);
            if (hl > 0.01) { _sc.x += (_v1.x / hl) * ahead; _sc.z += (_v1.z / hl) * ahead; }
            _sc.y = Math.max(terrainHeight(_sc.x, _sc.z), 0);
            this.aimShadow(this.sunFar, _fc.copy(_sc), FAR_SHADOW, 4000);
        }
        this.updateGrass(camera, dt);
        this.updateTerrain(focus);
    }

    // Returns 0..1: how deep inside a cloud a point is (for the whiteout effect)
    cloudDensityAt(p) {
        return this.clouds.whiteoutAt(p);
    }
}
