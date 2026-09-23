// ═══════════════════════════════════════════════════════════════
// World: sky, lighting, streamed LOD terrain, ocean, clouds, forests, airbases
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { fbm, ridged, smoothstep, lerp, clamp, mulberry32, DEG, makeRadialTexture } from './util.js';
import { TIMES } from './config.js';

// ── Airbases (terrain is flattened around them) ──
export const BASES = [
    { id: 'home', x: 0, z: 0, h: 22, r: 1500, heading: 0, friendly: true },
    { id: 'enemy', x: 7000, z: -17000, h: 38, r: 1700, heading: 0.35, friendly: false },
];
export const RUNWAY = { length: 3000, width: 55 };

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
        const c = Math.cos(b.heading), s = Math.sin(b.heading);
        const lx = (x - b.x) * c - (z - b.z) * s;
        const lz = (x - b.x) * s + (z - b.z) * c;
        if (Math.abs(lx) < RUNWAY.width * 0.6 && Math.abs(lz) < RUNWAY.length / 2 + 40) return b;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
export class World {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.time = 0;
        this.windOffset = new THREE.Vector2();
        this.sunDir = new THREE.Vector3();
        this.fogColor = new THREE.Color();
        this.tiles = new Map();
        this.buildQueue = [];
        this.detailTex = this.makeDetailTexture();

        this.initLights();
        this.initSky();
        this.initTerrainMaterial();
        this.initWater();
        this.initClouds();
        this.initTreeAssets();
        this.initBases();
        this.scene.fog = new THREE.FogExp2(0xbfd4e6, 0.00006);
    }

    // ── Time of day ──
    setTime(key) {
        const t = TIMES[key] || TIMES.day;
        this.timeKey = key;
        const el = t.elevation * DEG, az = t.azimuth * DEG;
        this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
        const night = key === 'night';
        const low = smoothstep(25, 2, t.elevation);

        const P = {
            zenith: new THREE.Color(0x1d5fb8), horizon: new THREE.Color(0xa9c9e6), sun: new THREE.Color(0xfff3e0),
            sunI: 3.2, hemiSky: new THREE.Color(0x9cc4ec), hemiGround: new THREE.Color(0x4a5a3a), hemiI: 1.1,
            fogDensity: 0.000055, glow: new THREE.Color(0xffe0b0), clouds: new THREE.Color(0xffffff), cloudShadow: new THREE.Color(0x9aa8ba),
            water: new THREE.Color(0x15506e),
        };
        if (key === 'dawn') {
            P.zenith.set(0x2b4f86); P.horizon.set(0xf2b88a); P.sun.set(0xffb070); P.sunI = 2.4;
            P.hemiSky.set(0x8aa4cc); P.hemiGround.set(0x4b3f33); P.hemiI = 0.8; P.glow.set(0xff9a50);
            P.clouds.set(0xffd6b8); P.cloudShadow.set(0x7c7390); P.fogDensity = 0.00007; P.water.set(0x183248);
        } else if (key === 'dusk') {
            P.zenith.set(0x1f3368); P.horizon.set(0xf08a4b); P.sun.set(0xff8a3c); P.sunI = 2.2;
            P.hemiSky.set(0x7f7fb0); P.hemiGround.set(0x40302a); P.hemiI = 0.75; P.glow.set(0xff6a20);
            P.clouds.set(0xffb38a); P.cloudShadow.set(0x6a5577); P.fogDensity = 0.00007; P.water.set(0x1a2a40);
        } else if (night) {
            P.zenith.set(0x02050d); P.horizon.set(0x0f1a2e); P.sun.set(0x9fb6e0); P.sunI = 0.8;
            P.hemiSky.set(0x33456b); P.hemiGround.set(0x10141a); P.hemiI = 0.7; P.glow.set(0x3a4a70);
            P.clouds.set(0x39455e); P.cloudShadow.set(0x161c28); P.fogDensity = 0.00008; P.water.set(0x040b14);
            // moonlight comes from high up
            this.sunDir.set(0.35, 0.6, -0.4).normalize();
        }
        this.palette = P;
        this.fogColor.copy(P.horizon);
        this.scene.fog.color.copy(P.horizon);
        this.scene.fog.density = P.fogDensity;
        this.scene.background = P.horizon;

        this.sun.color.copy(P.sun);
        this.sun.intensity = P.sunI;
        this.hemi.color.copy(P.hemiSky);
        this.hemi.groundColor.copy(P.hemiGround);
        this.hemi.intensity = P.hemiI;

        const su = this.skyMat.uniforms;
        su.zenith.value.copy(P.zenith);
        su.horizon.value.copy(P.horizon);
        su.sunColor.value.copy(P.sun);
        su.glowColor.value.copy(P.glow);
        su.sunDir.value.copy(night ? new THREE.Vector3(-0.3, 0.45, -0.85).normalize() : this.sunDir);
        su.night.value = night ? 1 : 0;
        su.lowSun.value = low;
        this.stars.visible = night;

        const wu = this.waterMat.uniforms;
        wu.deepColor.value.copy(P.water);
        wu.skyColor.value.copy(P.zenith);
        wu.horizonColor.value.copy(P.horizon);
        wu.sunColor.value.copy(P.sun).multiplyScalar(night ? 0.25 : 1);
        wu.sunDir.value.copy(this.sunDir);

        const cu = this.cloudMat.uniforms;
        cu.litColor.value.copy(P.clouds);
        cu.shadowColor.value.copy(P.cloudShadow);
        cu.sunDir.value.copy(this.sunDir);

        this.terrainMat.emissive = new THREE.Color(night ? 0x020306 : 0x000000);
        this.baseLights.forEach(l => (l.visible = night || key === 'dusk'));
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
        if (this.envRT) this.envRT.dispose();
        this.envRT = rt;
        this.scene.environment = rt.texture;
        this.scene.environmentIntensity = this.timeKey === 'night' ? 0.6 : 1.0;
        pmrem.dispose();
    }

    initLights() {
        this.sun = new THREE.DirectionalLight(0xffffff, 3);
        this.sun.castShadow = true;
        const sc = this.sun.shadow.camera;
        sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 1200;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.05;
        this.scene.add(this.sun);
        this.scene.add(this.sun.target);
        this.hemi = new THREE.HemisphereLight(0x9cc4ec, 0x4a5a3a, 1);
        this.scene.add(this.hemi);
    }

    // ── Sky dome ──
    initSky() {
        this.skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false,
            uniforms: {
                zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
                sunColor: { value: new THREE.Color() }, glowColor: { value: new THREE.Color() },
                sunDir: { value: new THREE.Vector3(0, 1, 0) }, camPos: { value: new THREE.Vector3() },
                night: { value: 0 }, lowSun: { value: 0 }, domeCentered: { value: 0 },
            },
            vertexShader: /* glsl */`
                varying vec3 vWorld;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorld = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                    gl_Position.z = gl_Position.w; // push to far plane
                }`,
            fragmentShader: /* glsl */`
                uniform vec3 zenith, horizon, sunColor, glowColor, sunDir, camPos;
                uniform float night, lowSun, domeCentered;
                varying vec3 vWorld;
                void main() {
                    vec3 dir = normalize(vWorld - camPos);
                    float h = dir.y;
                    float up = clamp(h, 0.0, 1.0);
                    vec3 col = mix(horizon, zenith, pow(up, 0.45));
                    // below horizon: hazy fade
                    col = mix(col, horizon * 0.9, smoothstep(0.0, -0.25, h));
                    float sd = max(dot(dir, normalize(sunDir)), 0.0);
                    // broad warm glow around the sun, stronger near the horizon at dawn/dusk
                    float horizonBand = exp(-abs(h) * 6.0);
                    col += glowColor * pow(sd, 6.0) * (0.25 + lowSun * 0.9 * horizonBand);
                    col += sunColor * pow(sd, 90.0) * 0.6;
                    // sun / moon disc
                    float disc = smoothstep(0.99955, 0.99975, sd);
                    col += sunColor * disc * mix(18.0, 2.5, night);
                    gl_FragColor = vec4(col, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), this.skyMat);
        this.skyDome.frustumCulled = false;
        this.skyDome.renderOrder = -10;
        this.scene.add(this.skyDome);

        // Stars
        const starGeo = new THREE.BufferGeometry();
        const r = mulberry32(99), pos = [];
        for (let i = 0; i < 2500; i++) {
            const u = r() * 2 - 1, th = r() * Math.PI * 2;
            const y = Math.abs(u) * 0.95 + 0.05, s = Math.sqrt(1 - y * y);
            pos.push(Math.cos(th) * s * 38000, y * 38000, Math.sin(th) * s * 38000);
        }
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
        this.stars.frustumCulled = false;
        this.stars.visible = false;
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
    initTerrainMaterial() {
        this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
        const detail = this.detailTex;
        this.terrainMat.onBeforeCompile = (shader) => {
            shader.uniforms.detailMap = { value: detail };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D detailMap;')
                .replace('#include <color_fragment>', `#include <color_fragment>
                    float d1 = texture2D(detailMap, vWPos.xz / 38.0).r;
                    float d2 = texture2D(detailMap, vWPos.xz / 460.0).r;
                    float d3 = texture2D(detailMap, vWPos.xz / 3100.0).r;
                    diffuseColor.rgb *= mix(0.72, 1.22, d1) * mix(0.82, 1.16, d2) * mix(0.85, 1.12, d3);`);
        };
        this.TILE = 2048;
        this.VIEW_TILES = 9;
    }

    lodFor(dist) {
        if (dist < 1.6) return 96;
        if (dist < 3.2) return 48;
        if (dist < 5.5) return 24;
        return 12;
    }

    buildTileGeometry(tx, tz, seg) {
        const T = this.TILE, step = T / seg, x0 = tx * T, z0 = tz * T;
        const N = seg + 3; // one extra ring on each side for normals
        const H = new Float32Array(N * N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            H[j * N + i] = terrainHeight(x0 + (i - 1) * step, z0 + (j - 1) * step);
        }
        const V = seg + 1;
        const vCount = V * V + V * 4;
        const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
        const skirt = 30 + step * 1.5;
        const cN = new THREE.Vector3();
        const setVert = (k, i, j, drop) => {
            const h = H[(j + 1) * N + (i + 1)];
            pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h - drop; pos[k * 3 + 2] = z0 + j * step;
            const hl = H[(j + 1) * N + i], hr = H[(j + 1) * N + i + 2], hd = H[j * N + i + 1], hu = H[(j + 2) * N + i + 1];
            cN.set(hl - hr, 2 * step, hd - hu).normalize();
            nor[k * 3] = cN.x; nor[k * 3 + 1] = cN.y; nor[k * 3 + 2] = cN.z;
            this.colorAt(pos[k * 3], h, pos[k * 3 + 2], cN.y, col, k * 3);
        };
        let k = 0;
        for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) setVert(k++, i, j, 0);
        // skirts: top, bottom, left, right edges
        const skirtStart = k;
        for (let i = 0; i < V; i++) setVert(k++, i, 0, skirt);
        for (let i = 0; i < V; i++) setVert(k++, i, seg, skirt);
        for (let j = 0; j < V; j++) setVert(k++, 0, j, skirt);
        for (let j = 0; j < V; j++) setVert(k++, seg, j, skirt);

        const idx = [];
        for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
            const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
            idx.push(a, c, b, b, c, d);
        }
        const s0 = skirtStart, s1 = s0 + V, s2 = s1 + V, s3 = s2 + V;
        for (let i = 0; i < seg; i++) {
            // top edge (j=0) faces -z
            idx.push(i, i + 1, s0 + i, i + 1, s0 + i + 1, s0 + i);
            // bottom edge (j=seg)
            const b0 = seg * V + i;
            idx.push(b0, s1 + i, b0 + 1, b0 + 1, s1 + i, s1 + i + 1);
            // left edge (i=0)
            const l0 = i * V, l1 = (i + 1) * V;
            idx.push(l0, s2 + i, l1, l1, s2 + i, s2 + i + 1);
            // right edge (i=seg)
            const r0 = i * V + seg, r1 = (i + 1) * V + seg;
            idx.push(r0, r1, s3 + i, r1, s3 + i + 1, s3 + i);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        return geo;
    }

    colorAt(x, h, z, ny, out, o) {
        const n = fbm(x * 0.0021, z * 0.0021, 2) * 0.5 + 0.5;
        const forest = smoothstep(0.02, 0.2, fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3));
        const slope = 1 - ny;
        let r, g, b;
        if (h < -2) {
            const t = smoothstep(-2, -60, h);
            r = lerp(0.62, 0.2, t); g = lerp(0.58, 0.36, t); b = lerp(0.42, 0.38, t);
        } else if (h < 7) {
            r = 0.76; g = 0.70; b = 0.52;
        } else {
            // lowland grass -> forest
            r = lerp(0.3, 0.42, n); g = lerp(0.46, 0.52, n); b = lerp(0.16, 0.22, n);
            r = lerp(r, 0.1, forest * 0.85); g = lerp(g, 0.24, forest * 0.85); b = lerp(b, 0.1, forest * 0.85);
            // alpine meadow / brown highland
            const hi = smoothstep(350, 800, h);
            r = lerp(r, 0.42 + n * 0.08, hi); g = lerp(g, 0.39 + n * 0.06, hi); b = lerp(b, 0.3, hi);
            // rock on steep slopes
            const rock = smoothstep(0.28, 0.5, slope + (h > 600 ? 0.1 : 0));
            r = lerp(r, 0.44 + n * 0.1, rock); g = lerp(g, 0.42 + n * 0.08, rock); b = lerp(b, 0.4 + n * 0.06, rock);
            // snow
            const snow = smoothstep(1150, 1450, h + n * 180) * (1 - smoothstep(0.45, 0.7, slope));
            r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); b = lerp(b, 1.0, snow);
            // beach blend
            const beach = smoothstep(14, 6, h);
            r = lerp(r, 0.76, beach); g = lerp(g, 0.70, beach); b = lerp(b, 0.52, beach);
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
            if (!t || t.seg !== seg) jobs.push({ tx, tz, seg, key, dist, has: !!t });
        }
        // remove tiles out of range
        for (const [key, t] of this.tiles) {
            if (!wanted.has(key)) {
                this.scene.remove(t.mesh); t.mesh.geometry.dispose();
                if (t.trees) { this.scene.remove(t.trees); t.trees.dispose(); }
                this.tiles.delete(key);
            }
        }
        // missing tiles first, then nearest
        jobs.sort((a, b) => (a.has - b.has) || (a.dist - b.dist));
        const start = performance.now();
        for (const j of jobs) {
            if (!force && performance.now() - start > 5) break;
            const geo = this.buildTileGeometry(j.tx, j.tz, j.seg);
            let t = this.tiles.get(j.key);
            if (t) {
                t.mesh.geometry.dispose();
                t.mesh.geometry = geo;
                t.seg = j.seg;
            } else {
                const mesh = new THREE.Mesh(geo, this.terrainMat);
                mesh.receiveShadow = true;
                mesh.matrixAutoUpdate = false;
                this.scene.add(mesh);
                t = { mesh, seg: j.seg, trees: null };
                this.tiles.set(j.key, t);
            }
            // trees only on close tiles
            const wantTrees = j.seg >= 48;
            if (wantTrees && !t.trees) {
                t.trees = this.buildTrees(j.tx, j.tz);
                if (t.trees) this.scene.add(t.trees);
            } else if (!wantTrees && t.trees) {
                this.scene.remove(t.trees); t.trees.dispose(); t.trees = null;
            }
        }
    }

    // ── Trees ──
    initTreeAssets() {
        const cone = new THREE.ConeGeometry(4.2, 14, 6, 1);
        cone.translate(0, 11, 0);
        const cone2 = new THREE.ConeGeometry(3.2, 9, 6, 1);
        cone2.translate(0, 16, 0);
        const trunk = new THREE.CylinderGeometry(0.6, 0.8, 5, 5);
        trunk.translate(0, 2.5, 0);
        const merge = (geos, colors) => {
            const positions = [], normals = [], cols = [];
            geos.forEach((g, gi) => {
                const ng = g.toNonIndexed();
                ng.computeVertexNormals();
                const p = ng.attributes.position.array, n = ng.attributes.normal.array;
                const c = new THREE.Color(colors[gi]);
                for (let i = 0; i < p.length; i += 3) {
                    positions.push(p[i], p[i + 1], p[i + 2]);
                    normals.push(n[i], n[i + 1], n[i + 2]);
                    cols.push(c.r, c.g, c.b);
                }
            });
            const out = new THREE.BufferGeometry();
            out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
            return out;
        };
        this.treeGeo = merge([trunk, cone, cone2], [0x4a3525, 0x1f4a26, 0x28592d]);
        this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    }

    buildTrees(tx, tz) {
        const T = this.TILE;
        const r = mulberry32((tx * 73856093) ^ (tz * 19349663));
        const mats = [];
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < 1400 && mats.length < 650; i++) {
            const x = (tx + r()) * T, z = (tz + r()) * T;
            const forest = fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3);
            if (forest < 0.05 + r() * 0.15) continue;
            const h = terrainHeight(x, z);
            if (h < 10 || h > 900) continue;
            let near = false;
            for (const b of BASES) if (Math.hypot(x - b.x, z - b.z) < b.r * 1.15) near = true;
            if (near) continue;
            const e = 8;
            const slope = Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h);
            if (slope > 7) continue;
            const sc = 0.7 + r() * 0.8;
            q.setFromAxisAngle(up, r() * 6.28);
            s.set(sc, sc * (0.85 + r() * 0.4), sc);
            p.set(x, h - 1, z);
            mats.push(m.compose(p, q, s).clone());
        }
        if (!mats.length) return null;
        const inst = new THREE.InstancedMesh(this.treeGeo, this.treeMat, mats.length);
        mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
        inst.castShadow = false;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        return inst;
    }

    // ── Ocean ──
    initWater() {
        this.waterMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: true, fog: false,
            uniforms: {
                time: { value: 0 }, sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color() },
                skyColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() }, deepColor: { value: new THREE.Color() },
                fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 }, detailMap: { value: this.detailTex },
            },
            vertexShader: /* glsl */`
                varying vec3 vWPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }`,
            fragmentShader: /* glsl */`
                uniform float time, fogDensity;
                uniform vec3 sunDir, sunColor, skyColor, horizonColor, deepColor, fogColor;
                uniform sampler2D detailMap;
                varying vec3 vWPos;
                void main() {
                    vec2 p = vWPos.xz;
                    float dist = length(cameraPosition - vWPos);
                    vec3 n = vec3(0.0, 1.0, 0.0);
                    // irregular directional swell (small slopes) + scrolling noise ripples
                    const int W = 6;
                    vec2 dirs[6]; dirs[0]=vec2(0.8,0.6); dirs[1]=vec2(-0.47,0.88); dirs[2]=vec2(0.21,-0.98); dirs[3]=vec2(-0.93,-0.37); dirs[4]=vec2(0.62,-0.79); dirs[5]=vec2(0.99,0.12);
                    float freqs[6]; freqs[0]=0.0131; freqs[1]=0.0197; freqs[2]=0.0313; freqs[3]=0.0571; freqs[4]=0.0917; freqs[5]=0.1433;
                    for (int i = 0; i < W; i++) {
                        float f = freqs[i];
                        float amp = 0.5 / (float(i) * 0.7 + 1.0);
                        vec2 q = p + vec2(sin(p.y * 0.0021 + float(i)), cos(p.x * 0.0017 - float(i))) * 60.0;
                        float ph = dot(dirs[i], q) * f + time * sqrt(9.8 * f) * 1.2;
                        n.xz -= dirs[i] * f * amp * 2.2 * cos(ph);
                    }
                    float r1 = texture2D(detailMap, p / 140.0 + vec2(time * 0.010, time * 0.006)).r;
                    float r2 = texture2D(detailMap, p / 53.0 - vec2(time * 0.014, -time * 0.009)).r;
                    float r3 = texture2D(detailMap, p / 17.0 + vec2(-time * 0.02, time * 0.017)).r;
                    n.xz += (vec2(r1 - r3, r2 - r3)) * 0.35;
                    n = normalize(mix(normalize(n), vec3(0.0, 1.0, 0.0), smoothstep(1500.0, 14000.0, dist) * 0.85));
                    vec3 v = normalize(cameraPosition - vWPos);
                    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
                    vec3 rf = reflect(-v, n);
                    vec3 sky = mix(horizonColor, skyColor, clamp(rf.y * 1.6, 0.0, 1.0));
                    vec3 col = mix(deepColor, sky, fres);
                    float sd = max(dot(rf, normalize(sunDir)), 0.0);
                    col += sunColor * (pow(sd, 900.0) * 14.0 + pow(sd, 80.0) * 0.35);
                    float alpha = mix(0.72, 0.97, clamp(fres * 2.0 + smoothstep(200.0, 3000.0, dist), 0.0, 1.0));
                    float fogF = 1.0 - exp(-pow(fogDensity * dist, 2.0));
                    col = mix(col, fogColor, fogF);
                    alpha = mix(alpha, 1.0, fogF);
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

    // ── Clouds: one instanced draw call, billboarded and wrapped in the shader ──
    initClouds() {
        const r = mulberry32(4242);
        const puffs = [];
        const CLUSTERS = 120, AREA = 30000;
        for (let c = 0; c < CLUSTERS; c++) {
            const cx = (r() - 0.5) * AREA, cz = (r() - 0.5) * AREA;
            const layer = r();
            const cy = layer < 0.7 ? 1300 + r() * 700 : 2800 + r() * 900;
            const n = 8 + Math.floor(r() * 14);
            const spread = 350 + r() * 600;
            for (let i = 0; i < n; i++) {
                const ox = (r() - 0.5) * spread * 2, oz = (r() - 0.5) * spread;
                const oy = r() * 140 * (1 - Math.abs(ox) / (spread * 1.2));
                const size = 180 + r() * 260;
                puffs.push({ x: cx + ox, y: cy + oy, z: cz + oz, size, shade: clamp(0.35 + oy / 160 + r() * 0.25, 0, 1), rot: r() * 6.28 });
            }
        }
        const base = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.setAttribute('position', base.attributes.position);
        geo.setAttribute('uv', base.attributes.uv);
        const off = new Float32Array(puffs.length * 3), sz = new Float32Array(puffs.length), sh = new Float32Array(puffs.length), rt = new Float32Array(puffs.length);
        puffs.forEach((p, i) => { off[i * 3] = p.x; off[i * 3 + 1] = p.y; off[i * 3 + 2] = p.z; sz[i] = p.size; sh[i] = p.shade; rt[i] = p.rot; });
        geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
        geo.setAttribute('size', new THREE.InstancedBufferAttribute(sz, 1));
        geo.setAttribute('shade', new THREE.InstancedBufferAttribute(sh, 1));
        geo.setAttribute('rot', new THREE.InstancedBufferAttribute(rt, 1));
        geo.instanceCount = puffs.length;

        const tex = this.makeCloudTexture();
        this.cloudMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: false,
            uniforms: {
                map: { value: tex }, camPos: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector2() },
                litColor: { value: new THREE.Color(1, 1, 1) }, shadowColor: { value: new THREE.Color(0.6, 0.65, 0.7) },
                sunDir: { value: new THREE.Vector3(0, 1, 0) }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
                area: { value: AREA },
            },
            vertexShader: /* glsl */`
                attribute vec3 offset; attribute float size; attribute float shade; attribute float rot;
                uniform vec3 camPos; uniform vec2 wind; uniform float area;
                varying vec2 vUv; varying float vShade; varying float vDist; varying float vSize; varying float vSunSide;
                uniform vec3 sunDir;
                void main() {
                    vec3 o = offset;
                    o.xz += wind;
                    o.xz = camPos.xz + mod(o.xz - camPos.xz + area * 0.5, area) - area * 0.5;
                    vec4 mv = viewMatrix * vec4(o, 1.0);
                    float c = cos(rot), s = sin(rot);
                    vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
                    mv.xy += q * size;
                    vUv = uv; vShade = shade; vDist = length(mv.xyz); vSize = size;
                    vec3 toCam = normalize(camPos - o);
                    vSunSide = dot(toCam, sunDir);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: /* glsl */`
                uniform sampler2D map; uniform vec3 litColor, shadowColor, fogColor; uniform float fogDensity;
                varying vec2 vUv; varying float vShade; varying float vDist; varying float vSize; varying float vSunSide;
                void main() {
                    vec4 t = texture2D(map, vUv);
                    float a = t.a * 0.78;
                    // fade when the camera is inside the puff so we don't see hard clipping
                    a *= smoothstep(vSize * 0.15, vSize * 0.9, vDist);
                    if (a < 0.01) discard;
                    float light = clamp(vShade * 0.75 + t.r * 0.35 + (1.0 - vSunSide) * 0.08, 0.0, 1.0);
                    vec3 col = mix(shadowColor, litColor, light);
                    // silver lining when looking toward the sun
                    col += litColor * pow(max(-vSunSide, 0.0), 6.0) * (1.0 - t.a) * 0.9;
                    float fogF = 1.0 - exp(-pow(fogDensity * 0.7 * vDist, 2.0));
                    col = mix(col, fogColor, fogF);
                    gl_FragColor = vec4(col, a * (1.0 - fogF * 0.6));
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        this.clouds = new THREE.Mesh(geo, this.cloudMat);
        this.clouds.frustumCulled = false;
        this.clouds.renderOrder = 5;
        this.scene.add(this.clouds);
        this.cloudPuffs = puffs;
    }

    makeCloudTexture() {
        const S = 128;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(S, S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const dx = x / S - 0.5, dy = y / S - 0.5;
            const d = Math.sqrt(dx * dx + dy * dy) * 2;
            const n = fbm(x * 0.05, y * 0.05, 4) * 0.5 + 0.5;
            const a = clamp((1 - d) * 1.4 - (1 - n) * 0.55, 0, 1);
            const i = (y * S + x) * 4;
            const lit = clamp(0.55 + (0.5 - y / S) * 0.9 + n * 0.2, 0, 1);
            img.data[i] = img.data[i + 1] = img.data[i + 2] = lit * 255;
            img.data[i + 3] = a * a * 255;
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        return tex;
    }

    // ── Airbase dressing: runway, taxiways, hangars, tower, lights ──
    initBases() {
        this.baseLights = [];
        const rwTex = this.makeRunwayTexture();
        for (const b of BASES) {
            const g = new THREE.Group();
            g.position.set(b.x, b.h, b.z);
            g.rotation.y = -b.heading;
            const rw = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length), new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.85 }));
            rw.rotation.x = -Math.PI / 2;
            rw.position.y = 0.15;
            rw.receiveShadow = true;
            g.add(rw);
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
                const tower = new THREE.Group();
                const tBase = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 30, 10), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 }));
                tBase.position.y = 15; tower.add(tBase);
                const cab = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 7, 10), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.8 }));
                cab.position.y = 33; tower.add(cab);
                tower.position.set(230, 0, -200);
                tower.traverse(o => { o.castShadow = true; });
                g.add(tower);
            }
            // Runway edge lights (emissive sprites that glow with bloom at night)
            const lightTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,230,180,0.8)'], [1, 'rgba(255,200,120,0)']]);
            const lightMat = new THREE.SpriteMaterial({ map: lightTex, color: 0xffd9a0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
            const lights = new THREE.Group();
            for (let z = -RUNWAY.length / 2; z <= RUNWAY.length / 2; z += 60) {
                for (const s of [-1, 1]) {
                    const sp = new THREE.Sprite(lightMat);
                    sp.position.set(s * (RUNWAY.width / 2 + 2), 1, z);
                    sp.scale.set(5, 5, 5);
                    lights.add(sp);
                }
            }
            g.add(lights);
            this.baseLights.push(lights);
            this.scene.add(g);
        }
    }

    makeRunwayTexture() {
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
        // tyre marks near ends
        ctx.fillStyle = 'rgba(15,15,15,0.35)';
        for (let i = 0; i < 60; i++) {
            ctx.fillRect(90 + Math.random() * 70, 300 + Math.random() * 500, 3, 60 + Math.random() * 120);
            ctx.fillRect(90 + Math.random() * 70, 3300 + Math.random() * 500, 3, 60 + Math.random() * 120);
        }
        ctx.fillStyle = '#e8e8e8';
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
        const wu = this.waterMat.uniforms;
        wu.time.value = this.time;
        wu.fogColor.value.copy(fog.color);
        wu.fogDensity.value = fog.density;
        const cu = this.cloudMat.uniforms;
        this.windOffset.x += wind.x * dt * 0.6;
        this.windOffset.y += wind.z * dt * 0.6;
        cu.wind.value.copy(this.windOffset);
        cu.camPos.value.copy(camera.position);
        cu.fogColor.value.copy(fog.color);
        cu.fogDensity.value = fog.density;
        // shadow camera follows the focus object
        this.sun.position.copy(focus).addScaledVector(this.sunDir, 600);
        this.sun.target.position.copy(focus);
        this.updateTerrain(focus);
    }

    // Returns 0..1: how deep inside a cloud a point is (for whiteout effect)
    cloudDensityAt(p) {
        const AREA = 30000;
        let best = 0;
        for (let i = 0; i < this.cloudPuffs.length; i += 1) {
            const c = this.cloudPuffs[i];
            if (Math.abs(p.y - c.y) > c.size * 0.5) continue;
            let dx = c.x + this.windOffset.x - p.x, dz = c.z + this.windOffset.y - p.z;
            dx = ((dx + AREA * 0.5) % AREA + AREA) % AREA - AREA * 0.5;
            dz = ((dz + AREA * 0.5) % AREA + AREA) % AREA - AREA * 0.5;
            const d = Math.sqrt(dx * dx + dz * dz + (p.y - c.y) ** 2);
            if (d < c.size * 0.45) best = Math.max(best, 1 - d / (c.size * 0.45));
        }
        return best;
    }
}
