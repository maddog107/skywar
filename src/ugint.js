// ═══════════════════════════════════════════════════════════════
// Underground complexes, inside (underground.js, ugworld.js): the tunnels and halls, their lamps, and the light in them.
//  • tubes are swept along their centre lines (ugsites.js tubeSamples): a shotcrete lining — vertical walls, an
//    elliptical arch — over a concrete floor with painted lines; dead ends get an end wall; the lining starts behind
//    the facade (the facade's own opening is the way in)
//  • light: nothing from the sun or the sky reaches in here, so every material in the complex is patched
//    (interiorMaterial): the scene's lights, sky light and environment reflections are replaced by the tunnel lamps
//    nearest the camera (UG_LAMPS point lights, uploaded each frame) and a light level baked into the lining at build
//    time from every lamp in the tube — so the pools of light run on down a hall, however long
//  • drawn only when it can be seen: a door open with the camera near and in front of it, or the camera inside
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { boreHeightAt, WALL_K } from './ugsites.js';

export const UG_LAMPS = 12;
export const LAMP_COLOR = new THREE.Color(1.0, 0.95, 0.86); // warm-white fluorescent tubes
// shared by every interior material: lamp positions (xyz, range) and colours (rgb × intensity, on)
export const UG_LAMP_U = {
    ugLampP: { value: new Float32Array(UG_LAMPS * 4) },
    ugLampC: { value: new Float32Array(UG_LAMPS * 4) },
    ugAmbient: { value: new THREE.Color(0.018, 0.02, 0.024) },
};

const LIGHT_GLSL = /* glsl */`
    vec3 geometryPosition = - vViewPosition;
    vec3 geometryNormal = normal;
    vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
    vec3 geometryClearcoatNormal = vec3( 0.0 );
    #ifdef STANDARD
        float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
        material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
        float EssMs = material.dfg.x + material.dfg.y;
        material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
    #endif
    IncidentLight directLight;
    for ( int i = 0; i < ${UG_LAMPS}; i ++ ) {
        vec4 lp = ugLampP[ i ], lc = ugLampC[ i ];
        if ( lc.w <= 0.0 ) continue;
        vec3 lv = ( viewMatrix * vec4( lp.xyz, 1.0 ) ).xyz - geometryPosition;
        float d2 = max( dot( lv, lv ), 1e-4 ), d = sqrt( d2 );
        float win = saturate( 1.0 - pow( d / lp.w, 4.0 ) );
        directLight.direction = lv / d;
        directLight.color = lc.rgb * ( win * win / max( d2, 0.8 ) );
        directLight.visible = true;
        #ifdef UG_BAKED
            // (the lining's diffuse light is baked in: the nearest lamps only add their highlights)
            reflectedLight.directSpecular += saturate( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
        #else
            RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
        #endif
    }
    vec3 iblIrradiance = vec3( 0.0 );
    vec3 irradiance = ugAmbient;
    #ifdef UG_BAKED
        irradiance += vUgIrr;
    #endif
    #if defined( RE_IndirectSpecular )
        vec3 radiance = irradiance * 0.35; // a dim, even "environment" for gloss and metal
        vec3 clearcoatRadiance = radiance;
        iblIrradiance = irradiance;
    #endif`;

// A material's interior twin (cached): same maps, lit by the complex's lamps. baked: it reads the `ugIrr` attribute
const twins = new WeakMap();
export function interiorMaterial(src, { baked = false } = {}) {
    const key = baked ? 'b' : 'd';
    let t = twins.get(src);
    if (t && t[key]) return t[key];
    const m = src.clone();
    m.fog = false;
    m.envMapIntensity = 0;
    if (baked) m.defines = { ...(m.defines || {}), UG_BAKED: '' };
    const prev = src.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
        if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, sh, r);
        Object.assign(sh.uniforms, UG_LAMP_U);
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
                #ifdef UG_BAKED
                    attribute vec3 ugIrr;
                    varying vec3 vUgIrr;
                #endif`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef UG_BAKED
                    vUgIrr = ugIrr;
                #endif`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform vec4 ugLampP[ ${UG_LAMPS} ];
                uniform vec4 ugLampC[ ${UG_LAMPS} ];
                uniform vec3 ugAmbient;
                #ifdef UG_BAKED
                    varying vec3 vUgIrr;
                #endif`)
            .replace('#include <lights_fragment_begin>', LIGHT_GLSL)
            .replace('#include <lights_fragment_maps>', '');
    };
    const pk = src.customProgramCacheKey ? src.customProgramCacheKey.bind(src) : null;
    m.customProgramCacheKey = () => (pk ? pk() : '') + ':ugInt' + key;
    if (!t) twins.set(src, t = {});
    t[key] = m;
    return m;
}

// Give a whole model interior materials (every mesh; a copy of the tree's materials, the geometry shared)
export function interiorize(obj) {
    obj.traverse(o => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map(x => interiorMaterial(x)) : interiorMaterial(o.material);
        o.castShadow = false; o.receiveShadow = false;
    });
    return obj;
}

// ═════════════ The lining ═════════════
// The bore's cross-section from the left floor edge, up the wall, over the arch, down to the right floor edge:
// [x (m right of the axis), y (m above the floor)], with the inward normal of each point
function profile(w, h, nArch = 18) {
    const a = w / 2, hw = h * WALL_K, pts = [];
    pts.push([-a, 0, 1, 0], [-a, hw * 0.5, 1, 0], [-a, hw, 1, 0]);
    for (let i = 1; i < nArch; i++) {
        const t = Math.PI - Math.PI * i / nArch, x = Math.cos(t) * a, y = hw + Math.sin(t) * (h - hw);
        // ellipse normal (inward): −(x / a², (y − hw) / b²)
        let nx = -x / (a * a), ny = -(y - hw) / ((h - hw) * (h - hw));
        const l = Math.hypot(nx, ny); nx /= l; ny /= l;
        pts.push([x, y, nx, ny]);
    }
    pts.push([a, hw, -1, 0], [a, hw * 0.5, -1, 0], [a, 0, -1, 0]);
    return pts;
}

// lamps along a tube: every `spacing` m; one row under the crown in a tunnel, two rows in a hall
function placeLamps(samples, from, to, spacing) {
    const out = [];
    let next = from + spacing * 0.5;
    for (const q of samples) {
        if (q.s < next || q.s > to) continue;
        next = q.s + spacing;
        const rows = q.w > 16 ? [-q.w * 0.22, q.w * 0.22] : [0];
        for (const x of rows) {
            const y = boreHeightAt(q.w, q.h, x) - 0.45;
            out.push({ x: q.x - q.tz * x, y: q.y + y, z: q.z + q.tx * x, s: q.s, tx: q.tx, tz: q.tz, hall: q.w > 16 });
        }
    }
    return out;
}

// Build a tube's lining, floor, lines, end walls and lamps. start / end: metres along the tube where the lining begins
// and ends (behind the facades). → { group, lamps, bounds }
export function buildTube(samples, { start = 0, end = Infinity, cap = false, mats, lampSpacing = 14, lampPower = 60, lineColor = 0xd8b429 } = {}) {
    const S = samples.filter(q => q.s >= start - 1e-6 && q.s <= end + 1e-6);
    const nArch = 18;
    const lamps = placeLamps(samples, start, end, lampSpacing);
    const group = new THREE.Group();
    // ── the lining ──
    const P0 = profile(S[0].w, S[0].h, nArch), NP = P0.length;
    const pos = [], nor = [], uv = [], irr = [], idx = [];
    const ring = (q) => {
        const pr = profile(q.w, q.h, nArch);
        let arc = 0;
        for (let k = 0; k < NP; k++) {
            const [x, y, nx, ny] = pr[k];
            if (k) arc += Math.hypot(x - pr[k - 1][0], y - pr[k - 1][1]);
            // right = (−tz, tx): the tube's right as the samples run
            pos.push(q.x - q.tz * x, q.y + y, q.z + q.tx * x);
            nor.push(-q.tz * nx, ny, q.tx * nx);
            uv.push(arc / 4, q.s / 4);
        }
    };
    for (const q of S) ring(q);
    // (facing in: a → b runs up the profile, a → c along the tube)
    for (let i = 0; i < S.length - 1; i++) for (let k = 0; k < NP - 1; k++) {
        const a = i * NP + k, b = a + 1, c = a + NP, d = c + 1;
        idx.push(a, c, b, b, c, d);
    }
    // the end wall of a dead end: a fan over the last ring
    if (cap) {
        const q = S[S.length - 1], base = pos.length / 3;
        const pr = profile(q.w, q.h, nArch);
        pos.push(q.x, q.y + q.h * 0.45, q.z); nor.push(-q.tx, 0, -q.tz); uv.push(0, 0);
        for (const [x, y] of pr) { pos.push(q.x - q.tz * x, q.y + y, q.z + q.tx * x); nor.push(-q.tx, 0, -q.tz); uv.push(x / 4, y / 4); }
        for (let k = 0; k < NP - 1; k++) idx.push(base, base + 2 + k, base + 1 + k);
        // (and the floor edge across)
        idx.push(base, base + 1, base + NP);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    bake(g, lamps, lampPower, samples);
    const lining = new THREE.Mesh(g, mats.lining);
    group.add(lining);
    // ── the floor, with its lines ──
    const fpos = [], fnor = [], fuv = [], fidx = [];
    for (const q of S) {
        for (const x of [-q.w / 2, 0, q.w / 2]) { fpos.push(q.x - q.tz * x, q.y + 0.02, q.z + q.tx * x); fnor.push(0, 1, 0); fuv.push(x / 6, q.s / 6); }
    }
    for (let i = 0; i < S.length - 1; i++) for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = a + 1, c = a + 3, d = c + 1; fidx.push(a, b, c, b, d, c); }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(fnor, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fg.setIndex(fidx);
    bake(fg, lamps, lampPower, samples);
    group.add(new THREE.Mesh(fg, mats.floor));
    // painted lines: the yellow centre line (taxi / drive line) and white edge lines
    const lines = [];
    const strip = (off, width, dash) => {
        let on = true, run = 0;
        for (let i = 0; i < S.length - 1; i++) {
            const a = S[i], b = S[i + 1];
            run += b.s - a.s;
            if (dash) { if (run > (on ? dash[0] : dash[1])) { on = !on; run = 0; } if (!on) continue; }
            const o = lines.length / 3;
            for (const q of [a, b]) for (const e of [-width / 2, width / 2]) lines.push(q.x - q.tz * (off + e), q.y + 0.04, q.z + q.tx * (off + e));
            linesIdx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
    };
    const linesIdx = [];
    strip(0, 0.3, null);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    lg.setAttribute('normal', new THREE.Float32BufferAttribute(lines.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    lg.setIndex(linesIdx);
    bake(lg, lamps, lampPower, samples);
    const lineMat = mats.line(lineColor);
    group.add(new THREE.Mesh(lg, lineMat));
    const edgeLines = [], edgeIdx = [];
    for (const side of [-1, 1]) {
        for (let i = 0; i < S.length - 1; i++) {
            const a = S[i], b = S[i + 1], o = edgeLines.length / 3;
            for (const q of [a, b]) for (const e of [-0.1, 0.1]) { const off = side * (q.w / 2 - 1.2) + e; edgeLines.push(q.x - q.tz * off, q.y + 0.04, q.z + q.tx * off); }
            edgeIdx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgeLines, 3));
    eg.setAttribute('normal', new THREE.Float32BufferAttribute(edgeLines.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    eg.setIndex(edgeIdx);
    bake(eg, lamps, lampPower, samples);
    group.add(new THREE.Mesh(eg, mats.line(0xd9d6cc)));
    // ── the lamps: fittings under the arch (instanced), glowing ──
    const fit = new THREE.InstancedMesh(mats.lampGeo, mats.lampMat, lamps.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1);
    lamps.forEach((L, i) => {
        Q.setFromAxisAngle(V.set(0, 1, 0), Math.atan2(L.tx, L.tz));
        M.compose(V.set(L.x, L.y + 0.2, L.z), Q, SC.set(L.hall ? 1.4 : 1, 1, L.hall ? 1.4 : 1));
        fit.setMatrixAt(i, M);
    });
    fit.frustumCulled = false;
    group.add(fit);
    group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.matrixAutoUpdate = false; } });
    const box = new THREE.Box3();
    for (const q of samples) { box.expandByPoint(V.set(q.x, q.y, q.z)); box.expandByPoint(V.set(q.x, q.y + q.h, q.z)); }
    box.expandByScalar(20);
    return { group, lamps, box };
}

// Bake the lamps' light into a geometry (attribute ugIrr): Lambert from every lamp within 70 m along the tube, the
// light falling off with the square of the distance, plus a little bounce
function bake(g, lamps, power, samples) {
    const pos = g.attributes.position.array, nor = g.attributes.normal.array, n = pos.length / 3;
    const out = new Float32Array(n * 3);
    const col = LAMP_COLOR;
    for (let k = 0; k < n; k++) {
        const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2], nx = nor[k * 3], ny = nor[k * 3 + 1], nz = nor[k * 3 + 2];
        let e = 0, near = 0;
        for (const L of lamps) {
            const dx = L.x - x, dy = L.y - y, dz = L.z - z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > 90 * 90) continue;
            const d = Math.sqrt(d2) || 1;
            const lam = Math.max(0, (dx * nx + dy * ny + dz * nz) / d);
            e += power * lam / Math.max(d2, 1.5);
            near += power / Math.max(d2, 4);
        }
        // bounce: some of the light round about, whatever way this faces
        const b = e * 0.12 + near * 0.05;
        out[k * 3] = (e + b) * col.r; out[k * 3 + 1] = (e + b) * col.g; out[k * 3 + 2] = (e + b) * col.b;
    }
    g.setAttribute('ugIrr', new THREE.BufferAttribute(out, 3));
    void samples;
}

// Every frame the interior is drawn: the lamps nearest the camera become the shader's point lights, plus `extra`
// (daylight in an open door: { x, y, z, range, r, g, b })
const _sel = [];
export function uploadLamps(lamps, cam, power, extra = []) {
    const P = UG_LAMP_U.ugLampP.value, C = UG_LAMP_U.ugLampC.value;
    _sel.length = 0;
    for (const L of lamps) {
        const d = (L.x - cam.x) ** 2 + (L.y - cam.y) ** 2 + (L.z - cam.z) ** 2;
        if (_sel.length < UG_LAMPS - extra.length) { _sel.push({ L, d }); _sel.sort((a, b) => a.d - b.d); continue; }
        if (d < _sel[_sel.length - 1].d) { _sel[_sel.length - 1] = { L, d }; _sel.sort((a, b) => a.d - b.d); }
    }
    P.fill(0); C.fill(0);
    let i = 0;
    for (const { L } of _sel) {
        P[i * 4] = L.x; P[i * 4 + 1] = L.y; P[i * 4 + 2] = L.z; P[i * 4 + 3] = 45;
        C[i * 4] = power * LAMP_COLOR.r; C[i * 4 + 1] = power * LAMP_COLOR.g; C[i * 4 + 2] = power * LAMP_COLOR.b; C[i * 4 + 3] = 1;
        i++;
    }
    for (const e of extra) {
        if (i >= UG_LAMPS) break;
        P[i * 4] = e.x; P[i * 4 + 1] = e.y; P[i * 4 + 2] = e.z; P[i * 4 + 3] = e.range;
        C[i * 4] = e.r; C[i * 4 + 1] = e.g; C[i * 4 + 2] = e.b; C[i * 4 + 3] = 1;
        i++;
    }
}
