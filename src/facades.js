// ═══════════════════════════════════════════════════════════════
// Facades and roofs: the materials the towns' instanced buildings are drawn with (towns.js).
// Everything is procedural, driven by a few per-instance attributes, on top of MeshStandardMaterial (so the sun's
// shadows, the haze, fire light and tone mapping come with it):
//   • walls (unit boxes): render, brick, concrete panels, stone, timber siding or a curtain wall; windows with a
//     reveal, frame, sill and lintel, curtains and blinds behind glass that reflects the sky; a ground floor of its
//     own (shop fronts with signs, front doors, garage doors, glazed entrances and lobbies); damp at the foot, streaks
//     from the parapet and under the sills; at night rooms lit from inside (seen through the glass, with parallax),
//     stair cores, office floors lit by the storey, shop windows and signs
//   • roofs (gable / hip prisms, the flat roofs' trays, spires): clay pantiles, slate, shingles, standing-seam metal,
//     gravel, bitumen felt or membrane; ridge and eave lines, moss and streaks, repairs, roof windows, solar panels
//   • details (boxes and cylinders: chimneys, plant, balconies, hedges, fences…): a kind per instance
// Detail is drawn by pixel footprint (metres of wall per pixel, from derivatives): close up the brick courses and
// window frames, further off only the windows, and from altitude a flat average, with every periodic pattern
// box-filtered so nothing shimmers. Past ~2.5 m per pixel the pattern code is skipped altogether.
// Damage: buildings.js darkens a hit building through its instance colour. The walls and roofs carry the colour
// they were built with (aInfo.x / aRoof.z), so the shader knows how burnt an instance is: soot over the windows,
// glass gone, no lights; a burnt-out stub is black.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Facade styles (aStyle.x): the window pattern
export const FACADE = { house: 0, townhouse: 1, apartment: 2, office: 3, glass: 4, church: 5, shed: 6 };
// aStyle.y flags: shop front on the ground floor; the street side is local +z / -z (doors and entrances go there);
// balconies on the +z / -z face (their bays get doors: every bay, or with balcAlt every other one, the odd ones
// with balcOdd); the +x / -x side wall is a party wall (a neighbour stands against it: no windows)
export const FLAG = { shop: 1, frontZp: 2, frontZm: 4, balcZp: 8, partyXp: 16, balcZm: 32, balcAlt: 64, balcOdd: 128, partyXm: 256 };
// Wall materials (aInfo.y)
export const WALL = { render: 0, brick: 1, concrete: 2, stone: 3, curtain: 4, siding: 5 };
// Roof coverings (aRoof.x)
export const ROOF = { pantile: 0, slate: 1, shingle: 2, metal: 3, gravel: 4, bitumen: 5, membrane: 6, spire: 7 };
// Detail kinds (aKind)
export const BIT = { plain: 0, plant: 1, chimney: 2, solar: 3, hedge: 4, timber: 5, awning: 6, glass: 7, duct: 8, housing: 9, concrete: 10, dormer: 11 };

// the bay widths and storey heights the shader lays windows out with (towns.js places balconies on the same bays)
export const BAY = { [FACADE.house]: 3.2, [FACADE.townhouse]: 2.8, [FACADE.apartment]: 3.0, [FACADE.office]: 3.0, [FACADE.glass]: 1.5, [FACADE.church]: 4.5, [FACADE.shed]: 6.0 };
export const STOREY = { [FACADE.house]: 3.0, [FACADE.townhouse]: 3.3, [FACADE.apartment]: 2.9, [FACADE.office]: 3.8, [FACADE.glass]: 3.8 };
export const SHOP_H = 4.2; // a shop front's ground floor (m)
// bays across a wall of this width, as the shader counts them (they tile the wall exactly)
export function bayCount(width, style) { return Math.max(1, Math.floor(width / BAY[style] + 0.5)); }

// ── a small tiling noise texture (mip-mapped, so it filters itself with distance) ──
//   r: soft blotches, g: finer mottling, b: streaks running down (stretched along v), a: speckle
let _noise = null;
export function noiseTexture() {
    if (_noise) return _noise;
    const N = 128, r = mulberry32(4711), data = new Uint8Array(N * N * 4);
    const lattice = (cx, cy) => {
        const g = new Float32Array(cx * cy);
        for (let i = 0; i < g.length; i++) g[i] = r();
        return (x, y) => { // x, y in 0..1, wrapping
            const fx = x * cx, fy = y * cy, ix = Math.floor(fx), iy = Math.floor(fy);
            let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
            const a = g[(iy % cy) * cx + (ix % cx)], b = g[(iy % cy) * cx + ((ix + 1) % cx)], c = g[((iy + 1) % cy) * cx + (ix % cx)], d = g[((iy + 1) % cy) * cx + ((ix + 1) % cx)];
            return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
        };
    };
    const R = [[lattice(4, 4), 0.45], [lattice(8, 8), 0.3], [lattice(16, 16), 0.15], [lattice(32, 32), 0.1]];
    const G = [[lattice(16, 16), 0.4], [lattice(32, 32), 0.35], [lattice(64, 64), 0.25]];
    const B = [[lattice(48, 3), 0.55], [lattice(96, 5), 0.3], [lattice(24, 2), 0.15]];
    const sum = (L, x, y) => { let s = 0; for (const [f, w] of L) s += f(x, y) * w; return s; };
    // stretch each channel to the full range (so 0.5 is its middle)
    const ch = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = i / N, y = j / N, k = j * N + i;
        ch[0][k] = sum(R, x, y); ch[1][k] = sum(G, x, y); ch[2][k] = sum(B, x, y);
    }
    for (let c = 0; c < 3; c++) {
        let lo = Infinity, hi = -Infinity;
        for (const v of ch[c]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        for (let k = 0; k < N * N; k++) data[k * 4 + c] = Math.round(255 * (ch[c][k] - lo) / (hi - lo));
    }
    for (let k = 0; k < N * N; k++) data[k * 4 + 3] = Math.floor(r() * 256);
    const t = _noise = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
}

// shared by the three shaders
export const FACADE_GLSL = /* glsl */`
    float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
    vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
    vec4 hash42(vec2 p) { vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
    // box-filtered repeating pulse (1 inside [a, b] of each unit period) over a footprint w: far away it averages
    // out to its duty cycle instead of shimmering
    float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
    float pulseW(float x, float a, float b, float w) { w = max(w, 1e-4); return (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w; }
    // box-filtered step pair: 1 inside [a, b]
    float boxW(float x, float a, float b, float w) { w = max(w, 1e-4); return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }
    // a thin line at x = c of half-width h
    float lineW(float x, float c, float h, float w) { return boxW(x, c - h, c + h, w); }`;

// local position (metres), unit-geometry normal and the instance's size, for every instanced unit shape
const LOCAL_VERT_PARS = 'varying vec3 vLp; varying vec3 vLn; varying vec3 vScale;';
const LOCAL_VERT = /* glsl */`
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vScale = sc; vLp = position * sc; vLn = normal;`;

// ═════════════ Walls ═════════════
const WALL_FRAG_PARS = /* glsl */`
    uniform float uNight;
    uniform sampler2D tFacNoise;
    varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying vec3 vViewL; varying vec4 vStyle; varying vec4 vInfo;
    ${FACADE_GLSL}
    // what the facade is at this pixel: albedo, emitted light, how much of it is glass (and the glass's reflectance,
    // roughness and the tilt of its pane), roughness of the rest
    vec3 fcAlb; vec3 fcEmit; float fcGlass; vec3 fcF0; float fcRough; vec2 fcTilt;

    // a lit room seen through its window: a box 4 m deep behind the glass, a lamp under the ceiling. p: where the
    // ray enters (x from the middle of the room, y above its floor), d: the ray into the room (z inward)
    vec3 roomLight(vec2 p, vec3 d, float rw, float rh, vec4 h) {
        d.z = max(d.z, 0.08);
        float tx = ((d.x > 0.0 ? rw * 0.5 : -rw * 0.5) - p.x) / (abs(d.x) < 1e-3 ? 1e-3 : d.x);
        float ty = ((d.y > 0.0 ? rh : 0.0) - p.y) / (abs(d.y) < 1e-3 ? 1e-3 : d.y);
        float tz = 4.0 / d.z;
        float t = min(tx, min(ty, tz));
        vec3 hit = vec3(p, 0.0) + d * t;
        float isFloor = step(ty, min(tx, tz)) * step(d.y, 0.0), isBack = step(tz, min(tx, ty));
        vec3 col = mix(vec3(0.78, 0.74, 0.66), vec3(0.42, 0.33, 0.25), isFloor);
        // the far wall: its own paint, a darker piece of furniture or a door on it
        col = mix(col, mix(vec3(0.8, 0.76, 0.66), vec3(0.55, 0.62, 0.66), h.z), isBack * 0.6);
        float fur = isBack * step(abs(hit.x - (h.x - 0.5) * rw * 0.5), 0.25 + 0.5 * h.y) * step(hit.y, 0.9 + 1.2 * h.w);
        col *= 1.0 - 0.55 * fur;
        vec3 lamp = vec3((h.w - 0.5) * rw * 0.3, rh - 0.35, 1.6 + h.x);
        float dl = length(hit - lamp);
        return col * (1.5 / (0.7 + dl * dl * 0.3));
    }

    // the coating of a curtain wall's glass (blue, green, bronze or grey), by the building's accent
    vec3 fcTint(float a) {
        return mix(mix(vec3(0.22, 0.33, 0.42), vec3(0.24, 0.36, 0.33), smoothstep(0.3, 0.5, a)), mix(vec3(0.4, 0.33, 0.24), vec3(0.34, 0.37, 0.4), smoothstep(0.75, 0.9, a)), smoothstep(0.55, 0.7, a));
    }

    void facadeEval(vec3 inCol) {
        fcEmit = vec3(0.0); fcGlass = 0.0; fcF0 = vec3(0.04); fcRough = 0.9; fcTilt = vec2(0.0);
        float seed = vStyle.w;
        // how burnt: the instance colour against the colour as built (buildings.js darkens a hit building; a stub
        // left standing is at 0.28)
        float kb = clamp(dot(inCol, vec3(1.0)) / max(vInfo.x, 1e-4), 0.0, 1.0);
        float burn = clamp((0.98 - kb) * 1.55, 0.0, 1.0);
        vec3 wc = inCol / max(kb, 0.25);
        float H = vScale.y;
        bool xF = abs(vLn.x) > 0.5;
        float u = xF ? vLp.z : vLp.x, y = vLp.y;
        float halfW = (xF ? vScale.z : vScale.x) * 0.5;
        float sg = xF ? vLn.x : vLn.z;
        float faceId = (xF ? 2.0 : 0.0) + step(0.0, sg);
        // metres of wall per pixel
        float pu = fwidth(u), py = fwidth(y), px = max(pu, py);
        if (abs(vLn.y) > 0.5) { fcAlb = wc * 0.4 * (1.0 - 0.8 * burn); return; } // the top of the box (under the roof; a ruin's floor)

        float st = floor(vStyle.x + 0.5), fl = floor(vStyle.y + 0.5);
        float shop = mod(fl, 2.0);
        float front = xF ? 0.0 : (sg > 0.0 ? mod(floor(fl * 0.5), 2.0) : mod(floor(fl * 0.25), 2.0));
        float balc = xF ? 0.0 : (sg > 0.0 ? mod(floor(fl * 0.125), 2.0) : mod(floor(fl / 32.0), 2.0));
        float party = xF ? (sg > 0.0 ? mod(floor(fl / 16.0), 2.0) : mod(floor(fl / 256.0), 2.0)) : 0.0;
        float mat = floor(vInfo.y + 0.5);
        float base = vInfo.z;
        // per style: bay width, storey height, the window's width, sill and head (m)
        float fw = 3.2, fh = 3.0, ww = 1.2, wb = 0.9, wt = 2.25;
        if (st > 0.5) { fw = 2.8; fh = 3.3; ww = 1.15; wb = 0.85; wt = 2.6; }
        if (st > 1.5) { fw = 3.0; fh = 2.9; ww = 1.7; wb = 0.9; wt = 2.3; }
        if (st > 2.5) { fw = 3.0; fh = 3.8; ww = 2.3; wb = 0.95; wt = 2.9; }
        if (st > 3.5) { fw = 1.5; fh = 3.8; ww = 1.4; wb = 0.95; wt = 3.74; }
        if (st > 4.5) { fw = 4.5; fh = max((H - base) / max(vInfo.w, 1.0), 3.0); ww = 1.1; wb = 2.0; wt = fh - 1.3; }
        if (st > 5.5) { fw = 6.0; fh = 4.5; ww = 4.4; wb = 2.9; wt = 3.9; }
        bool glassSt = st > 3.5 && st < 4.5, officeSt = st > 2.5 && st < 4.5, churchSt = st > 4.5 && st < 5.5;
        float gf = shop > 0.5 ? ${SHOP_H.toFixed(1)} : fh;
        float topB = glassSt ? 0.0 : 0.25;
        float nUp = max(0.0, floor((H - base - gf - topB) / fh + 0.05));
        // (a building on a slope has spare wall under its eaves: the storeys stretch a little to take it up)
        float fhS = nUp > 0.5 ? fh * clamp((H - base - gf - topB) / (nUp * fh), 1.0, 1.22) : fh;
        float yg = y - base;
        float up = step(gf, yg);
        float sh_ = up > 0.5 ? fhS : gf;                       // this storey's height
        float sv = up > 0.5 ? (yg - gf) / fhS : yg / gf;       // storey coordinate
        float sto = up > 0.5 ? floor(sv) + 1.0 : 0.0;
        float fy = (sv - floor(sv)) * sh_;                     // metres above this storey's floor
        float inSt = step(0.0, yg) * step(sto, nUp + 0.5);
        float nb = max(1.0, floor(2.0 * halfW / fw + 0.5)), fwS = 2.0 * halfW / nb;
        float cu = (u + halfW) / fwS, bay = floor(cu);
        float ox = (cu - bay - 0.5) * fwS;                     // metres from the bay's centre line
        ww = min(ww, fwS * 0.82);
        vec3 tint = fcTint(vStyle.z);
        if (px > 2.4) {
            // too far for a window to be a pixel: the facade's average, and nothing more is worked out
            vec3 gC = glassSt ? tint * 0.6 + 0.04 : officeSt ? tint * 0.1 + 0.02 : vec3(0.048, 0.054, 0.06);
            float cov = (ww / fwS) * ((wt - wb) / fhS) * (1.0 - party) * inSt;
            fcAlb = mix(wc, gC, cov) * (1.0 - 0.75 * burn);
            fcGlass = cov * (1.0 - burn); fcF0 = glassSt ? tint * 0.9 + 0.08 : vec3(0.09); fcRough = 0.6;
            fcEmit = vec3(1.0, 0.78, 0.5) * (uNight * cov * (officeSt ? 0.2 : churchSt ? 0.12 : 0.3) * 0.5 * (1.0 - smoothstep(0.0, 0.15, burn)));
            return;
        }
        // (the noise, at a level of detail of our own: a plain lookup's derivatives aren't defined after a branch)
        vec4 nz = textureLod(tFacNoise, vec2(u + seed * 40.0 + faceId * 13.0, y) * 0.045, log2(max(px * 5.76, 1.0)));
        vec4 nz2 = textureLod(tFacNoise, vec2(u * 0.09 + seed * 17.0 + faceId * 5.0, y * 0.03), log2(max(max(pu * 0.09, py * 0.03) * 128.0, 1.0)));
        vec4 hb = hash42(vec2(seed * 913.7 + 1.0, 3.3 + st));  // this building's own numbers
        vec4 hb2 = hash42(vec2(seed * 517.3 + 7.0, 9.1));
        vec4 hw = hash42(vec2(bay + faceId * 37.0, sto) + seed * 71.0 + 0.5); // this window's
        float age = hb.x;

        // ── the wall itself ──
        float tone = mat > 0.5 && mat < 1.5 ? 0.8 + 0.4 * nz.r : 0.89 + 0.22 * nz.r;
        wc *= tone;
        if (mat > 0.5 && mat < 1.5) wc = mix(wc, wc * vec3(0.82, 0.86, 0.95), smoothstep(0.55, 0.8, nz.g) * 0.5); // bricks fired darker
        float lum = dot(wc, vec3(0.33));
        // splashed and damp at the foot, streaks running down from the parapet
        float damp = 1.0 - smoothstep(0.0, 0.7 + 1.6 * nz.g, yg);
        wc *= 1.0 - (0.16 + 0.22 * age) * damp;
        float run = smoothstep(H - 4.0, H - 0.2, y) * smoothstep(0.35, 0.8, nz2.b);
        wc *= 1.0 - (0.05 + 0.2 * age) * run * (glassSt ? 0.0 : 1.0);
        fcRough = mat > 4.5 ? 0.72 : mat > 1.5 && mat < 2.5 ? 0.84 : 0.92;
        vec3 trim = mat > 4.5 ? vec3(0.78, 0.78, 0.75) : mix(vec3(0.6, 0.585, 0.55), vec3(0.72, 0.7, 0.66), hb2.x); // sills, lintels, bands
        vec3 frameC = hb.y < 0.58 ? vec3(0.8, 0.8, 0.78) : hb.y < 0.8 ? vec3(0.07, 0.075, 0.08) : vec3(0.2, 0.13, 0.085);
        if (officeSt) frameC = mix(vec3(0.1, 0.105, 0.11), vec3(0.42, 0.43, 0.44), hb.y);
        vec3 glassC = vec3(0.028, 0.034, 0.04);
        vec3 glassF0 = vec3(0.09, 0.095, 0.1);
        // curtain walls and office glazing are coated: a tint that reflects more
        if (glassSt) { glassC = tint * 0.6 + 0.02; glassF0 = tint * 0.9 + 0.08; }
        else if (officeSt) { glassC = tint * 0.1; glassF0 = tint * 0.4 + 0.05; }
        // lit windows: about a third of homes in the evening; offices by the storey (a floor working late)
        float pLit = 0.3;
        if (officeSt) { float fl_ = hash11(sto * 7.3 + seed * 31.0); pLit = 0.05 + 0.6 * fl_ * fl_ * fl_; }
        if (churchSt) pLit = 0.12;
        float dark = 1.0 - smoothstep(0.0, 0.15, burn); // nothing lit in a burning building
        vec3 warm = mix(vec3(1.0, 0.68, 0.36), vec3(1.0, 0.84, 0.62), hw.y);
        if (hw.z > 0.9) warm = vec3(0.72, 0.84, 1.0);
        if (officeSt) warm = mix(vec3(0.9, 0.94, 1.0), vec3(1.0, 0.88, 0.7), step(0.55, hw.y)) * (0.6 + 0.4 * hw.w);

        float d2 = 1.0 - smoothstep(0.16, 0.3, px);   // window frames, sills, curtains, doors
        float d3 = 1.0 - smoothstep(0.022, 0.05, px); // brick courses, boards, slats
        float wu = pu / fwS, wv = py / sh_;

        // the wall's own pattern, close up
        if (mat < 0.5) {
            // render: hairline staining only
            wc *= 0.97 + 0.06 * nz.a * d3;
        } else if (mat < 1.5) {
            // brick: 75 mm courses in stretcher bond, every brick its own shade
            if (d3 > 0.0) {
                float by = y / 0.075, row = floor(by), bx = u / 0.225 + 0.5 * mod(row, 2.0);
                float joint = 1.0 - pulseW(by, 0.14, 1.0, py / 0.075) * pulseW(bx, 0.045, 1.0, pu / 0.225);
                float each = hash22(vec2(floor(bx), row) + seed * 9.0).x;
                wc = mix(wc, mix(wc * (0.82 + 0.36 * each), vec3(lum * 1.25 + 0.12) * vec3(1.0, 0.98, 0.93), joint * 0.75), d3);
            }
        } else if (mat < 2.5) {
            // precast concrete panels: a joint at every bay and storey, each panel weathered its own way
            float pj = 1.0 - pulseW(cu, 0.0, 1.0 - 0.03 / fwS, wu) * (up > 0.5 ? pulseW(sv, 0.0, 1.0 - 0.03 / sh_, wv) : 1.0);
            wc *= (0.94 + 0.12 * hw.w) * (1.0 - 0.4 * pj * d2);
        } else if (mat < 3.5) {
            // ashlar stone: courses 0.3 m high
            float d3s = 1.0 - smoothstep(0.03, 0.09, px);
            if (d3s > 0.0) {
                float by = y / 0.3, row = floor(by), bx = u / 0.62 + 0.5 * mod(row, 2.0);
                float joint = 1.0 - pulseW(by, 0.05, 1.0, py / 0.3) * pulseW(bx, 0.025, 1.0, pu / 0.62);
                float each = hash22(vec2(floor(bx), row) + seed * 5.0).x;
                wc = mix(wc, wc * (0.86 + 0.26 * each) * (1.0 - 0.4 * joint), d3s);
            }
        } else if (mat > 4.5) {
            // timber siding: lapped boards, a shadow under each; corner boards
            wc *= 1.0 - 0.3 * d3 * (1.0 - pulseW(y / 0.16, 0.0, 0.84, py / 0.16));
            wc = mix(wc, trim, d2 * (1.0 - boxW(abs(u), 0.0, halfW - 0.12, pu)));
        }

        // ── the storeys: a plinth course, a band over the ground floor, a cornice under the parapet ──
        if (!glassSt) {
            float plinth = boxW(yg, -50.0, 0.45, py);
            wc = mix(wc, (mat > 0.5 && mat < 1.5 ? wc * 0.72 : mix(wc, vec3(0.36, 0.35, 0.33), 0.55)) , plinth * (st > 5.5 ? 0.3 : 0.8));
            if (st > 0.5 && st < 3.5) {
                float band = lineW(yg, gf, 0.12, py) * step(0.5, nUp);
                float corn = boxW(y, H - 0.34, H + 1.0, py);
                wc = mix(wc, trim * (0.9 + 0.2 * nz.r), max(band * (0.4 + 0.6 * shop), corn * 0.85) * step(hb2.y, 0.75));
                wc *= 1.0 - 0.3 * lineW(y, H - 0.42, 0.06, py) * d2; // its shadow
            }
        }

        // ── windows ──
        float present = inSt * (1.0 - party);
        float topSt = step(nUp - 0.5, sto);
        // (houses: the side walls have fewer; blocks: the odd blank bay)
        if (st < 0.5 && xF) present *= step(0.45, hw.w);
        if (st > 0.5 && st < 2.5 && !xF) present *= step(0.04, hw.w);
        if (st > 5.5) present *= up < 0.5 ? 1.0 : 0.0;
        // apartments: balcony bays get a door; a stair core on the back, always lit
        float bp = mod(floor(fl / 64.0), 2.0) < 0.5 ? 1.0 : 1.0 - mod(bay + mod(floor(fl / 128.0), 2.0), 2.0);
        float isB = balc * up * bp * step(1.5, st) * step(st, 2.5);
        float wbE = mix(wb, 0.06, isB), wwE = mix(ww, min(1.9, fwS * 0.8), isB), wtE = wt;
        float stair = (st > 1.5 && st < 2.5 && !xF && front < 0.5 && abs(bay - floor(nb * 0.5)) < 0.5) ? 1.0 : 0.0;
        if (stair > 0.5) { wwE = 1.0; wbE = 1.5; wtE = sh_ + 0.4; present = inSt * step(0.5, sto); }

        // the ground floor on the street side
        float gnd = (1.0 - up) * step(0.0, yg) * front;
        float doorU = 0.0, doorHalf = 0.0, doorH = 0.0;
        if (front > 0.5 && shop < 0.5) {
            if (st < 0.5) {
                // a house: the front door in one bay, a garage door at the driveway end of a wide one
                float db = floor(vInfo.w + 0.01), garage = fract(vInfo.w) > 0.25 ? 1.0 : 0.0;
                doorU = -halfW + (db + 0.5) * fwS; doorHalf = 0.5; doorH = 2.1;
                if (abs(bay - db) < 0.5 && up < 0.5) present = 0.0;
                if (garage > 0.5 && bay > nb - 1.5 && up < 0.5) {
                    present = 0.0;
                    float gd = boxW(ox, -1.25, 1.25, pu) * boxW(yg, 0.0, 2.15, py);
                    vec3 gc = mix(vec3(0.74, 0.74, 0.72), vec3(0.3, 0.24, 0.19), step(0.6, hb.w));
                    gc *= 1.0 - 0.3 * d2 * (1.0 - pulseW(yg / 0.54, 0.0, 0.93, py / 0.54)); // its panels
                    wc = mix(wc, gc, gd); fcRough = mix(fcRough, 0.55, gd);
                }
            } else if (st < 4.5) {
                // a block or a tower: a glazed entrance in the middle
                doorU = 0.0; doorHalf = st > 2.5 ? 2.6 : 1.3; doorH = st > 2.5 ? 3.1 : 2.45;
                if (abs(-halfW + (bay + 0.5) * fwS) < doorHalf + ww * 0.5 + 0.2 && up < 0.5) present = 0.0;
            } else if (churchSt) {
                doorU = 0.0; doorHalf = 1.1; doorH = 3.2; if (up < 0.5) present = 0.0;
            } else {
                doorU = 0.0; doorHalf = 2.2; doorH = 3.4; // a market hall's big doors
            }
        }
        if ((glassSt || shop > 0.5) && up < 0.5) present = 0.0; // a tower's lobby and a shop front are their own thing (below)

        float aX = 0.5 - wwE / (2.0 * fwS), win = 0.0, spandrel = 0.0, louvre = 0.0;
        if (glassSt) {
            // curtain wall: every bay a pane between mullions, a spandrel panel hiding each floor slab; the top
            // storey is plant behind louvres
            float pn = pulseW(cu, 0.035, 0.965, wu) * inSt;
            float vis = up > 0.5 ? pulseW(sv, wb / fhS, 1.0 - 0.06 / fhS, wv) : 0.0;
            louvre = topSt * step(2.5, nUp) * up;
            win = pn * vis * (1.0 - louvre);
            spandrel = pn * (1.0 - vis) * up * (1.0 - louvre) + pn * louvre * boxW(fy, 0.3, sh_ - 0.3, py);
        } else {
            win = pulseW(cu, aX, 1.0 - aX, wu) * pulseW(sv, wbE / sh_, wtE / sh_, wv) * present;
            if (shop > 0.5 && up < 0.5) win = 0.0;
        }

        vec3 alb = wc;
        float glass = win;
        vec3 emit = vec3(0.0);
        float lit = step(1.0 - pLit, hw.x);
        if (stair > 0.5) { lit = 1.0; warm = vec3(0.9, 0.9, 0.82) * 0.55; }
        float far1 = smoothstep(0.25, 0.8, px / fwS);
        lit = mix(lit, pLit, far1) * uNight * dark;
        vec3 inside = glassC;
        float pane = win;
        vec3 tv = xF ? vec3(vViewL.z, vViewL.y, vViewL.x * sg) : vec3(vViewL.x, vViewL.y, vViewL.z * sg); // to the camera: along the wall, up, out
        vec2 par = tv.xy / max(tv.z, 0.2 * length(tv));

        if (d2 > 0.0 && !glassSt && present > 0.0) {
            // close enough for the window itself: its reveal, the frame set back in it, sill and lintel
            vec2 q = vec2(ox, fy - wbE), hs = vec2(wwE * 0.5, wtE - wbE);
            if (churchSt) hs.y -= min(abs(q.x) * 1.5, 1.2); // a pointed arch
            float dep = mat > 0.5 && mat < 3.5 ? 0.16 : 0.09;
            float open = boxW(q.x, -hs.x, hs.x, pu) * boxW(q.y, 0.0, hs.y, py);
            vec2 qg = q - par * dep; // the same point on the glass's plane, set back
            float inG = boxW(qg.x, -hs.x, hs.x, pu) * boxW(qg.y, 0.0, hs.y, py);
            float fb = 0.055;
            float gp = boxW(qg.x, -hs.x + fb, hs.x - fb, pu) * boxW(qg.y, fb, hs.y - fb, py);
            // glazing bars: a centre mullion on a wide window, a transom on a tall one
            float bars = (wwE > 1.05 ? lineW(qg.x, 0.0, 0.022, pu) : 0.0) + (st > 0.5 && st < 1.5 && isB < 0.5 ? lineW(qg.y, hs.y * 0.52, 0.02, py) : 0.0);
            if (isB > 0.5) bars = lineW(qg.x, 0.0, 0.03, pu);
            if (churchSt) bars = lineW(qg.x, 0.0, 0.04, pu) + pulseW(qg.y / 0.9, 0.0, 0.06, py / 0.9);
            gp *= 1.0 - min(bars, 1.0);
            // the reveal: its head in shadow, the jambs half lit, the sill catching the light
            vec3 rev = wc * (qg.y > hs.y ? 0.5 : 0.74);
            if (qg.y < 0.0) rev = trim * 1.05;
            vec3 wcol = mix(rev, frameC, inG);
            // behind the glass: dark, or net curtains, drapes at the sides, a blind part-way down
            vec3 cur = mix(vec3(0.5, 0.48, 0.44), mix(vec3(0.42, 0.3, 0.26), vec3(0.3, 0.36, 0.42), hw.w), step(0.6, hw.z) * 0.7);
            float ck = 0.0;
            if (officeSt) { ck = step(hw.y, 0.5) * step(hs.y * (0.35 + 0.6 * hw.z), qg.y) * 0.75; cur = vec3(0.56, 0.56, 0.54) * (1.0 - 0.25 * d3 * (1.0 - pulseW(qg.y / 0.05, 0.0, 0.7, py / 0.05))); }
            else if (hw.y < 0.22) ck = 0.0;
            else if (hw.y < 0.5) ck = 0.55;
            else if (hw.y < 0.78) ck = step(hs.x * (0.3 + 0.4 * hw.z), abs(qg.x)) * 0.9;
            else ck = step(hs.y * (0.3 + 0.6 * hw.z), qg.y) * 0.85;
            if (churchSt) { vec2 sgc = floor(qg * vec2(4.0, 2.5)); vec4 hg = hash42(sgc + seed * 3.0); cur = mix(vec3(0.05, 0.1, 0.3), mix(vec3(0.4, 0.06, 0.05), vec3(0.45, 0.3, 0.05), hg.y), step(0.5, hg.x)); ck = 0.8; }
            if (stair > 0.5) ck = 0.0;
            if (!officeSt && !churchSt) cur *= 1.0 - 0.22 * d3 * (0.5 + 0.5 * sin(qg.x * 48.0 + hw.w * 6.28));
            inside = mix(glassC, cur * 0.5, ck);
            // sill and lintel on the wall round the opening
            float sill = boxW(q.x, -hs.x - 0.07, hs.x + 0.07, pu) * boxW(q.y, -0.08, 0.0, py) * (1.0 - isB);
            float sillSh = boxW(q.x, -hs.x - 0.07, hs.x + 0.07, pu) * boxW(q.y, -0.2, -0.08, py) * (1.0 - isB);
            float lintel = boxW(q.x, -hs.x - 0.12, hs.x + 0.12, pu) * boxW(q.y, hs.y, hs.y + 0.2, py) * (mat > 0.5 && mat < 1.5 ? 1.0 : mat > 2.5 && mat < 3.5 ? 0.6 : 0.0);
            // streaks down the wall under the sill, soot above the opening if it's burnt
            float under = boxW(q.x, -hs.x - 0.05, hs.x + 0.05, pu) * smoothstep(-1.3, -0.1, q.y) * step(q.y, -0.08) * smoothstep(0.3, 0.7, nz2.b);
            vec3 wall2 = wc * (1.0 - (0.05 + 0.17 * age) * under) * (1.0 - 0.25 * sillSh);
            wall2 = mix(wall2, trim, max(sill, lintel * (mat > 0.5 && mat < 1.5 ? 0.45 : 0.8)));
            // shutters beside the windows of some houses
            if (st < 1.5 && hb2.y > 0.72 && isB < 0.5 && fwS > wwE * 2.0 + 0.2) {
                float shut = boxW(abs(q.x), hs.x + 0.03, hs.x * 2.0 - 0.02, pu) * boxW(q.y, 0.0, hs.y, py);
                vec3 sc_ = hb2.x < 0.35 ? vec3(0.1, 0.19, 0.14) : hb2.x < 0.6 ? vec3(0.2, 0.25, 0.3) : hb2.x < 0.8 ? vec3(0.24, 0.1, 0.08) : vec3(0.66, 0.66, 0.62);
                sc_ *= 1.0 - 0.3 * d3 * (1.0 - pulseW(q.y / 0.07, 0.0, 0.6, py / 0.07));
                wall2 = mix(wall2, sc_, shut);
            }
            vec3 nearC = mix(wall2, mix(wcol, inside, gp), open);
            alb = mix(mix(wc, inside, win), nearC, d2);
            pane = mix(win, open * gp, d2);
            glass = pane;
            // lit from inside: the room through the glass, or its glow through the curtains
            if (lit > 0.0) {
                vec3 rl = vec3(1.0);
                if (px < 0.12 && ck < 0.5) {
                    rl = roomLight(vec2(qg.x, qg.y + wbE), vec3(-par, 1.0), fwS, sh_, hw);
                    rl = mix(vec3(1.0), rl, 1.0 - smoothstep(0.06, 0.12, px));
                }
                rl = mix(rl, cur * 1.5 + 0.1, ck);
                emit = warm * rl * (pane * lit * (0.35 + 0.65 * hw.w) * 0.85);
            }
            if (churchSt) emit *= 0.6;
            fcTilt = (hw.zw - 0.5) * 0.02 * pane;
        } else {
            alb = mix(wc, inside, win);
            emit = warm * (win * lit * (glassSt ? 0.5 : 0.6));
            if (glassSt) {
                // spandrels: opaque glass or metal panels, flatter than the vision glass; louvres on the plant floor
                vec3 sp = mix(tint * 0.5 + 0.04, wc * 0.75, step(0.5, hb2.x));
                sp *= 1.0 - 0.5 * louvre * d2 * (1.0 - pulseW(fy / 0.12, 0.0, 0.55, py / 0.12));
                alb = mix(alb, sp, spandrel);
                // every pane hangs a little out of true: the reflections break up across the wall
                fcTilt = (hw.zw - 0.5) * (0.035 * (1.0 - smoothstep(0.3, 0.9, px))) * win;
                // blinds part-way down some panes
                float bl = step(hw.y, 0.3) * step(sh_ * (0.45 + 0.5 * hw.z), fy) * win * d2;
                alb = mix(alb, vec3(0.5, 0.5, 0.48), bl * 0.55);
                glass = win * (1.0 - bl * 0.6) + spandrel * 0.45 * (1.0 - louvre);
            }
        }

        // ── the ground floor on the street: shop fronts, doors, entrances, lobbies ──
        if (glassSt && up < 0.5 && yg > 0.0) {
            // a tower's lobby: clear glass between piers every third bay, lit all night
            float pier = 1.0 - pulseW(cu / 3.0, 0.07, 0.93, wu / 3.0);
            float lg = (1.0 - pier) * boxW(yg, 0.35, sh_ - 0.5, py);
            alb = mix(mix(wc, vec3(0.2, 0.2, 0.2), 0.6), vec3(0.05, 0.055, 0.06), lg);
            glass = lg * 0.8; fcF0 = vec3(0.06);
            vec3 rl = vec3(0.8);
            if (px < 0.15) rl = roomLight(vec2(mod(u, 9.0) - 4.5, yg), vec3(-par, 1.0), 9.0, sh_, hb2);
            emit = vec3(1.0, 0.9, 0.74) * rl * (lg * uNight * dark * 0.7);
        }
        if (shop > 0.5 && up < 0.5 && yg > 0.0) {
            if (front > 0.5) {
                // shop units between piers: a stall riser, display glazing with a door, a sign over them
                float nu = max(1.0, floor(2.0 * halfW / 4.4 + 0.5)), sw = 2.0 * halfW / nu;
                float su = (u + halfW) / sw, unit = floor(su), sx = (su - unit - 0.5) * sw;
                vec4 hs4 = hash42(vec2(unit + 3.0, 7.0) + seed * 53.0);
                vec4 hs5 = hash42(vec2(unit + 11.0, 2.0) + seed * 29.0);
                float pier = 0.3, wsu = pu / sw;
                float glz = pulseW(su, pier / sw, 1.0 - pier / sw, wsu) * boxW(yg, 0.5, 2.95, py);
                float riser = pulseW(su, pier / sw, 1.0 - pier / sw, wsu) * boxW(yg, 0.0, 0.5, py);
                float signB = pulseW(su, 0.12 / sw, 1.0 - 0.12 / sw, wsu) * boxW(yg, 3.1, 3.86, py);
                // sign boards in the colours shops choose: dark greens, navy, burgundy, black, cream, the odd bright one
                vec3 sc_ = hs4.x < 0.16 ? vec3(0.05, 0.13, 0.09) : hs4.x < 0.32 ? vec3(0.06, 0.08, 0.16) : hs4.x < 0.46 ? vec3(0.22, 0.05, 0.06)
                    : hs4.x < 0.6 ? vec3(0.05, 0.05, 0.05) : hs4.x < 0.76 ? vec3(0.62, 0.58, 0.48) : hs4.x < 0.86 ? vec3(0.4, 0.4, 0.4) : hs4.x < 0.93 ? vec3(0.55, 0.07, 0.05) : vec3(0.7, 0.5, 0.06);
                float sl = dot(sc_, vec3(0.33));
                vec3 ink = sl > 0.3 ? vec3(0.06) : vec3(0.82, 0.8, 0.72);
                float txt = 0.0;
                if (d2 > 0.0) {
                    // lettering: blocks of letters with gaps, as long as the name
                    // lettering: every letter a 3 x 5 block glyph (a stem and what a hash adds to it), words with gaps
                    float lx = sx / 0.19, li = floor(lx);
                    vec2 gc = floor(vec2(fract(lx) * 4.0, (yg - 3.34) / 0.056));
                    float bitOn = max(step(gc.x, 0.5), step(0.5, hash11(li * 3.1 + gc.x * 7.3 + gc.y * 13.7 + unit * 17.0 + seed * 7.0))) * step(gc.x, 2.5);
                    float word = step(0.16, hash11(li * 5.7 + unit * 3.0 + seed * 11.0));
                    txt = boxW(yg, 3.34, 3.62, py) * step(abs(sx), sw * (0.2 + 0.24 * hs4.y)) * mix(bitOn * word, 0.4, smoothstep(0.012, 0.035, px)) * d2;
                }
                float far2 = smoothstep(0.5, 1.6, px / sw); // the units blur into one frontage
                vec3 signC = mix(mix(sc_, ink, txt), vec3(0.2, 0.19, 0.18), far2);
                vec3 frm = hs5.x < 0.5 ? vec3(0.07) : hs5.x < 0.8 ? vec3(0.5, 0.5, 0.5) : sc_;
                float dsg = hs5.y < 0.5 ? -1.0 : 1.0, dx = sx - dsg * (sw * 0.5 - pier - 0.6);
                float bars = (lineW(dx, -0.5 * dsg, 0.035, pu) + lineW(yg, 2.35, 0.03, py) + lineW(abs(sx), sw * 0.5 - pier, 0.05, pu) + lineW(yg, 0.5, 0.04, py) + lineW(yg, 2.95, 0.05, py)) * d2;
                // roller shutters come down on some at night
                float shut = uNight * step(hs5.z, 0.28) * glz;
                vec3 inS = mix(vec3(0.05, 0.055, 0.06), vec3(0.42, 0.43, 0.44) * (1.0 - 0.3 * d3 * (1.0 - pulseW(yg / 0.09, 0.0, 0.7, py / 0.09))), shut);
                alb = mix(alb, mix(wc, vec3(0.3, 0.29, 0.27), 0.6), riser);
                alb = mix(alb, mix(inS, frm, min(bars, 1.0)), glz);
                alb = mix(alb, signC, signB);
                glass = glz * (1.0 - min(bars, 1.0)) * (1.0 - shut);
                fcF0 = vec3(0.07);
                float open_ = step(0.28, hs5.z) * step(hs5.w, 0.8);
                vec3 rl = vec3(0.75);
                if (px < 0.15 && open_ > 0.0) rl = mix(rl, roomLight(vec2(sx, yg), vec3(-par, 1.0), sw, 3.6, hs4), 1.0 - smoothstep(0.08, 0.15, px));
                emit = mix(vec3(1.0, 0.93, 0.8), vec3(0.85, 0.92, 1.0), hs5.x) * rl * (glass * max(uNight * 0.8, 0.2) * dark * open_);
                // the sign lit from inside or from above
                emit += mix(sc_ * 1.6 + 0.04, ink, txt) * (signB * uNight * dark * step(hs4.w, 0.6) * 0.5 * (1.0 - far2 * 0.5));
                fcRough = mix(fcRough, 0.5, signB);
            }
        }
        if (doorH > 0.0 && gnd > 0.0) {
            float du = u - doorU;
            float dr = boxW(du, -doorHalf, doorHalf, pu) * boxW(yg, 0.0, doorH, py);
            if (dr > 0.0) {
                vec3 dc; float dg = 0.0;
                if (st < 0.5 || churchSt || st > 5.5) {
                    // a panelled front door in its frame, a light over or in it
                    dc = hb.z < 0.2 ? vec3(0.05, 0.11, 0.08) : hb.z < 0.4 ? vec3(0.06, 0.08, 0.14) : hb.z < 0.55 ? vec3(0.2, 0.05, 0.05) : hb.z < 0.7 ? vec3(0.04, 0.04, 0.045) : hb.z < 0.85 ? vec3(0.62, 0.62, 0.6) : vec3(0.25, 0.15, 0.09);
                    if (churchSt || st > 5.5) dc = vec3(0.16, 0.1, 0.065);
                    float inr = boxW(du, -doorHalf + 0.07, doorHalf - 0.07, pu) * boxW(yg, 0.04, doorH - 0.07, py);
                    float pan = (boxW(abs(du), 0.08, doorHalf - 0.16, pu) * (boxW(yg, 0.25, 0.95, py) + boxW(yg, 1.1, 1.45, py))) * d2;
                    dg = boxW(abs(du), 0.0, doorHalf - 0.2, pu) * boxW(yg, 1.6, 1.95, py) * step(0.5, hb.w) * (churchSt ? 0.0 : 1.0);
                    dc = mix(frameC, dc * (1.0 - 0.3 * pan), inr);
                    dc = mix(dc, glassC, dg);
                    emit += vec3(1.0, 0.75, 0.45) * (dg * uNight * dark * step(hb2.x, 0.5) * 0.5);
                } else {
                    // glazed doors and side lights under the canopy; the hall light is on all night
                    float bars = min(1.0, lineW(du, 0.0, 0.035, pu) + lineW(abs(du), doorHalf * 0.5, 0.03, pu) + lineW(abs(du), doorHalf, 0.06, pu) + lineW(yg, doorH, 0.07, py) + lineW(yg, 2.1, 0.03, py));
                    dg = 1.0 - bars * d2;
                    dc = mix(frameC, vec3(0.045, 0.05, 0.055), dg);
                    vec3 rl = vec3(0.7);
                    if (px < 0.15) rl = roomLight(vec2(du, yg), vec3(-par, 1.0), doorHalf * 2.0 + 2.0, 3.0, hb2);
                    emit = mix(emit, vec3(1.0, 0.86, 0.66) * rl * (dg * uNight * dark * 0.75), dr);
                }
                alb = mix(alb, dc, dr);
                glass = mix(glass, dg, dr);
            }
            if (st < 0.5 && d2 > 0.0) {
                // the lamp by the door, and its pool of light on the wall
                vec2 lp = vec2(du - (doorHalf + 0.35) * (hb2.z < 0.5 ? -1.0 : 1.0), yg - 2.0);
                float on = uNight * dark * step(hb2.y, 0.62);
                float bulb = boxW(lp.x, -0.07, 0.07, pu) * boxW(lp.y, -0.1, 0.1, py);
                alb = mix(alb, vec3(0.06), bulb * 0.8);
                emit += vec3(1.0, 0.8, 0.5) * on * (bulb * 2.2 + 0.11 * dot(alb, vec3(0.6)) / (0.15 + dot(lp, lp)) * d2);
            }
        }

        // the street lamps' light on the lower wall of the street side
        emit += alb * vec3(1.0, 0.74, 0.44) * (uNight * (0.035 + 0.1 * front) * exp(-max(yg, 0.0) * 0.2) * (1.0 - glass));

        // ── burnt: soot spreading from the openings, the glass gone, nothing lit ──
        if (burn > 0.0) {
            float lick = pulseW(cu, aX - 0.06, 1.06 - aX, wu) * smoothstep(wtE - 0.4, wtE, fy) * (1.0 - smoothstep(wtE + 0.2, sh_ + 0.9, fy)) * present;
            float sootN = nz.r * 0.55 + nz2.b * 0.3 + nz.g * 0.15 + 0.3 * win + 0.45 * lick;
            float soot = smoothstep(1.3 - burn * 1.05, 1.62 - burn * 0.95, sootN + 0.25);
            alb = mix(alb, vec3(0.022, 0.02, 0.018), max(soot, glass * 0.9) * min(1.0, burn * 1.6));
            alb *= 1.0 - 0.4 * burn * burn;
            glass *= 1.0 - min(1.0, burn * 2.0);
            emit *= dark;
        }
        fcAlb = alb; fcEmit = emit; fcGlass = glass;
        if (!(glassSt && up < 0.5) && !(shop > 0.5 && up < 0.5)) fcF0 = glassF0;
    }`;

// `low`: the plain shader the towns had (flat walls, a grid of dark windows), for the 'low' quality preset
export function makeFacadeMaterial({ low = false } = {}) {
    if (low) return makeLowFacadeMaterial();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    mat.userData.night = { value: 0 };
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = mat.userData.night;
        sh.uniforms.tFacNoise = { value: noiseTexture() };
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
                attribute vec4 aStyle; attribute vec4 aInfo;
                ${LOCAL_VERT_PARS} varying vec3 vViewL; varying vec4 vStyle; varying vec4 vInfo;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                ${LOCAL_VERT}
                vStyle = aStyle; vInfo = aInfo;
                // the camera as this instance sees it (its own axes, metres): the windows' parallax
                vec3 fcW = (modelMatrix * (instanceMatrix * vec4(position, 1.0))).xyz;
                vec3 fcC = (cameraPosition - fcW) * mat3(modelMatrix);
                vViewL = vec3(dot(fcC, instanceMatrix[0].xyz) / sc.x, dot(fcC, instanceMatrix[1].xyz) / sc.y, dot(fcC, instanceMatrix[2].xyz) / sc.z);`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\n' + WALL_FRAG_PARS)
            .replace('#include <color_fragment>', `#include <color_fragment>
                facadeEval(diffuseColor.rgb);
                diffuseColor.rgb = fcAlb;`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = mix(fcRough, 0.07, fcGlass);`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                {
                    // each pane a little out of true
                    vec3 fcUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
                    vec3 fcT = normalize(cross(fcUp, normal));
                    normal = normalize(normal + fcT * fcTilt.x + fcUp * fcTilt.y);
                }`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                totalEmissiveRadiance += fcEmit;`)
            .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
                // glass: its own reflectance over a dark room (the sky comes from the environment map)
                material.specularColor = mix(material.specularColor, fcF0, fcGlass);
                material.specularColorBlended = mix(material.specularColorBlended, fcF0, fcGlass);`);
    };
    mat.customProgramCacheKey = () => 'facade3';
    return mat;
}

// The plain facade shader ('low' quality, and the A side of the frame-time comparison): flat walls, a grid of dark
// windows, lit at random at night. It reads the same aStyle the full shader does.
function makeLowFacadeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.04 });
    mat.userData.night = { value: 0 };
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = mat.userData.night;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec4 aStyle; varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying vec4 vStyle; varying float vInst;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
                vScale = sc; vLp = position * sc; vLn = normal; vStyle = aStyle; vInst = float(gl_InstanceID);`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform float uNight; varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying vec4 vStyle; varying float vInst;
                float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                // box-filtered repeating pulse (1 inside [a, b] of each unit period): far-away facades average out
                float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
                float pulseAA(float x, float a, float b) { float w = max(fwidth(x), 1e-4); return (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w; }
                float boxAA(float x, float a, float b) { float w = max(fwidth(x), 1e-4); return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }
                // glass (0..1), which window cell, and whether it's a shop / door / fascia
                float wGlass; vec2 wCell; float wShop; float wFascia; float wDoor;
                void facade() {
                    wGlass = 0.0; wCell = vec2(0.0); wShop = 0.0; wFascia = 0.0; wDoor = 0.0;
                    if (abs(vLn.y) > 0.5) return;
                    bool xFace = abs(vLn.x) > 0.5;
                    float u = xFace ? vLp.z : vLp.x, y = vLp.y;
                    float halfW = (xFace ? vScale.z : vScale.x) * 0.5;
                    float st = floor(vStyle.x + 0.5), fl = floor(vStyle.y + 0.5);
                    float shop = mod(fl, 2.0);
                    float front = (!xFace && ((mod(floor(fl / 2.0), 2.0) > 0.5 && vLn.z > 0.5) || (mod(floor(fl / 4.0), 2.0) > 0.5 && vLn.z < -0.5))) ? 1.0 : 0.0;
                    float fw = 3.2, fh = 3.0, x0 = 0.3, x1 = 0.7, y0 = 0.35, y1 = 0.78, base = 0.0;
                    if (st > 0.5 && st < 1.5) { fw = 2.8; fh = 3.3; x0 = 0.24; x1 = 0.76; y0 = 0.3; y1 = 0.82; }
                    else if (st > 1.5 && st < 2.5) { fw = 3.0; fh = 2.9; x0 = 0.18; x1 = 0.82; y0 = 0.32; y1 = 0.8; }
                    else if (st > 2.5 && st < 3.5) { fw = 3.0; fh = 3.7; x0 = 0.03; x1 = 0.97; y0 = 0.3; y1 = 0.86; }
                    else if (st > 3.5 && st < 4.5) { fw = 1.6; fh = 3.8; x0 = 0.06; x1 = 0.94; y0 = 0.1; y1 = 0.95; }
                    else if (st > 4.5 && st < 5.5) { fw = 4.5; fh = 20.0; x0 = 0.4; x1 = 0.6; y0 = 0.12; y1 = 0.62; }
                    else if (st > 5.5) { fw = 7.0; fh = 4.5; x0 = 0.1; x1 = 0.9; y0 = 0.6; y1 = 0.85; }
                    // a shop front fills the ground floor (4.2 m): big windows, a fascia over them
                    if (shop > 0.5 && y < 4.2) {
                        float sw = 4.0;
                        wShop = pulseAA(u / sw + 0.5, 0.06, 0.94) * boxAA(y, 0.25, 3.2) * step(abs(u), halfW - 0.5);
                        wFascia = boxAA(y, 3.35, 4.05) * step(abs(u), halfW - 0.2);
                        wCell = vec2(floor(u / sw) + (vLn.x + vLn.z) * 57.0, -1.0);
                        wGlass = wShop;
                        return;
                    }
                    if (shop > 0.5) base = 4.2 - fh; // the floors above start over the shop
                    float yy = y - base;
                    wCell = vec2(floor(u / fw) + (vLn.x + vLn.z) * 57.0, floor(yy / fh));
                    float inX = pulseAA(u / fw + 0.5, x0, x1);
                    float inY = pulseAA(yy / fh, y0, y1);
                    float edge = step(0.9, y) * step(y, vScale.y - 0.7) * step(abs(u), halfW - 0.6);
                    if (st < 4.5 && shop < 0.5) edge *= step(0.6, yy); // no windows in the plinth
                    wGlass = inX * inY * edge;
                    // the front door (houses) or a glazed entrance (blocks, towers)
                    if (front > 0.5 && shop < 0.5 && st < 4.5) {
                        float dw = st < 0.5 ? 0.55 : 1.4, dh = st < 0.5 ? 2.1 : 2.9;
                        float d = boxAA(u, -dw, dw) * boxAA(y, 0.05, dh);
                        wDoor = d;
                        wGlass = max(wGlass * (1.0 - boxAA(y, 0.0, dh + 0.4) * boxAA(u, -dw - 0.8, dw + 0.8)), st < 0.5 ? 0.0 : d);
                    }
                }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                facade();
                float hw = hash12(wCell + vInst * 1.37 + vStyle.w * 13.1);
                float st2 = floor(vStyle.x + 0.5);
                // lit at night: about a quarter of homes, more of the offices, most shops
                float litP = wShop > 0.0 ? 0.75 : st2 > 2.5 && st2 < 4.5 ? 0.38 : 0.26;
                float lit = step(1.0 - litP, hw);
                vec3 glass = st2 > 3.5 && st2 < 4.5 ? mix(vec3(0.16, 0.24, 0.32), vec3(0.3, 0.42, 0.5), vLp.y / max(vScale.y, 1.0)) : vec3(0.1, 0.12, 0.15);
                if (wShop > 0.0) glass = vec3(0.14, 0.17, 0.2);
                vec3 wallC = diffuseColor.rgb;
                // a darker plinth, a cornice line at the top
                if (abs(vLn.y) < 0.5) wallC *= mix(1.0, 0.78, step(vLp.y, 0.6)) * mix(1.0, 0.85, step(vScale.y - 0.5, vLp.y));
                diffuseColor.rgb = mix(wallC, vec3(0.2, 0.19, 0.18), wFascia);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.2, 0.14), wDoor * step(st2, 0.5));
                diffuseColor.rgb = mix(diffuseColor.rgb, glass, wGlass);`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = mix(roughnessFactor, 0.18, wGlass);`)
            .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
                metalnessFactor = mix(metalnessFactor, 0.35, wGlass);`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                // just under the bloom threshold: lit windows read as bright, not as a glowing haze
                vec3 warm = mix(vec3(1.0, 0.72, 0.4), vec3(0.75, 0.85, 1.0), step(0.93, hw));
                // (no lights in a building burnt down to a stub: its colour is well under any wall's)
                float burnt = step(dot(vColor.rgb, vec3(1.0)), 0.06);
                totalEmissiveRadiance += wGlass * lit * uNight * warm * (wShop > 0.0 ? 1.0 : 0.8) * (1.0 - burnt);`);
    };
    mat.customProgramCacheKey = () => 'facadeLow2';
    return mat;
}

// ═════════════ Roofs ═════════════
// One material for the pitched roofs' prisms, the flat roofs' trays and the spires. Per instance: the covering's
// colour (instance colour), aRoof = (covering, seed, the colour's r+g+b as built, extras: 1 solar panels on the
// +x pitch, 2 on the -x pitch), aWallC = the colour of the walls underneath (gable ends, the tray's outer face).
const ROOF_FRAG_PARS = /* glsl */`
    uniform sampler2D tFacNoise;
    varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying vec4 vRoof; varying vec3 vWallC;
    varying vec3 vRuv; // on the roof's plane: along the eave, up the pitch from the eave (m); z: metres below the ridge
    varying vec3 vRn;  // the face's true normal in the instance's frame
    ${FACADE_GLSL}
    vec3 rfAlb; float rfRough; float rfGlass; float rfGlassR; float rfMetal;
    void roofEval(vec3 inCol) {
        rfRough = 0.86; rfGlass = 0.0; rfGlassR = 0.1; rfMetal = 0.0;
        float kind = floor(vRoof.x + 0.5), seed = vRoof.y;
        float kb = clamp(dot(inCol, vec3(1.0)) / max(vRoof.z, 1e-4), 0.0, 1.0);
        float burn = clamp((0.98 - kb) * 1.55, 0.0, 1.0);
        vec3 rc = inCol / max(kb, 0.25), wallC = vWallC;
        vec2 uv = vRuv.xy;
        float pu = fwidth(uv.x), pv = fwidth(uv.y), px = max(pu, pv);
        vec4 hr = hash42(vec2(seed * 733.1 + 2.0, 5.7 + kind));
        float ny = vRn.y, pyl = fwidth(vLp.y), pxl = fwidth(vLp.x);
        bool spire = kind > 6.5;
        if (px > 1.6) {
            // from far off: the covering in this roof's own shade (the walls' colour on a gable end), and nothing more
            bool flatRoof = kind > 3.5 && kind < 6.5;
            vec3 far_ = flatRoof ? (ny > 0.5 ? rc * (0.83 + 0.14 * hr.y) : mix(wallC, vec3(0.5), 0.4)) : (ny < 0.12 && !spire ? wallC * 0.95 : rc * (0.86 + 0.19 * hr.y));
            rfAlb = far_ * (1.0 - 0.6 * burn);
            if ((kind > 2.5 && kind < 3.5) || spire) { rfRough = 0.5; rfMetal = 0.55; }
            return;
        }
        vec4 nz = textureLod(tFacNoise, (uv + seed * 37.0) * 0.06, log2(max(px * 7.68, 1.0)));
        vec4 nz2 = textureLod(tFacNoise, vec2(uv.x * 0.11 + seed * 11.0, uv.y * 0.045), log2(max(max(pu * 0.11, pv * 0.045) * 128.0, 1.0)));
        float d2 = 1.0 - smoothstep(0.5, 1.2, px), d3 = 1.0 - smoothstep(0.05, 0.13, px);
        vec3 alb;
        if (kind < 3.5 || kind > 6.5) {
            // ── a pitched roof ──
            if (ny < -0.5) { alb = vec3(0.5, 0.49, 0.46); }                   // the soffit
            else if (ny < 0.12 && !spire) {
                // a gable end: the wall carried up under the verge, a barge board along the roof's edge
                float barge = 1.0 - boxW(abs(vLp.x) / max(vScale.x * 0.5, 0.1) + vLp.y / max(vScale.y, 0.1), -1.0, 1.0 - 0.22 / max(vScale.y, 1.0), pxl / max(vScale.x * 0.5, 0.1) + pyl / max(vScale.y, 0.1));
                alb = mix(wallC * (0.9 + 0.2 * nz.r) * (1.0 - 0.25 * smoothstep(0.4, 0.8, nz2.b)), hr.x < 0.6 ? vec3(0.74, 0.74, 0.72) : vec3(0.13, 0.12, 0.11), barge * d2);
                // an attic window in a big gable
                vec2 q = vec2(vLp.x, vLp.y - vScale.y * 0.3);
                float aw = boxW(q.x, -0.45, 0.45, px) * boxW(q.y, 0.0, 1.0, px) * step(4.2, vScale.y) * step(hr.z, 0.5) * d2;
                alb = mix(alb, vec3(0.03, 0.035, 0.04), aw); rfGlass = aw;
            } else {
                float age = hr.x;
                // every roof its own shade; patches, lichen and moss, dirt washing down the pitch
                rc *= 0.9 + 0.2 * hr.y;
                rc *= 0.84 + 0.32 * nz.r;
                float moss = smoothstep(0.62 - 0.2 * age, 0.9, nz.g * 0.6 + nz2.b * 0.4) * (kind < 2.5 ? 1.0 : 0.3);
                rc = mix(rc, vec3(0.16, 0.2, 0.1) * (0.7 + 0.6 * nz.r), moss * (0.25 + 0.45 * age));
                rc *= 1.0 - 0.22 * smoothstep(0.45, 0.85, nz2.b) * (0.4 + 0.6 * age);
                // re-laid patches: a few square metres in a newer shade
                vec2 pc = floor(uv / vec2(2.4, 1.8) + seed * 3.0);
                float patch_ = step(0.93, hash22(pc).x) * d2;
                rc = mix(rc, rc * vec3(1.14, 1.1, 1.06), patch_ * 0.6);
                if (d3 > 0.0) {
                    if (kind < 0.5) {
                        // clay pantiles: rolls running down the pitch, a shadow under every course
                        float cv = uv.y / 0.34, cu = uv.x / 0.3;
                        float each = hash22(vec2(floor(cu), floor(cv)) + seed * 7.0).x;
                        float roll = 0.5 + 0.5 * cos(cu * 6.2832);
                        float fade = 1.0 - smoothstep(0.06, 0.13, px);
                        rc *= mix(1.0, (0.9 + 0.2 * each) * (0.8 + 0.3 * roll) * (1.0 - 0.4 * (1.0 - pulseW(cv, 0.14, 1.0, pv / 0.34))), fade);
                    } else if (kind < 1.5) {
                        // slates: thin courses, staggered joints
                        float cv = uv.y / 0.22, row = floor(cv), cu = uv.x / 0.3 + 0.5 * mod(row, 2.0);
                        float each = hash22(vec2(floor(cu), row) + seed * 7.0).x;
                        rc *= mix(1.0, (0.9 + 0.2 * each) * (1.0 - 0.4 * (1.0 - pulseW(cv, 0.12, 1.0, pv / 0.22) * pulseW(cu, 0.04, 1.0, pu / 0.3))), d3);
                    } else if (kind < 2.5) {
                        // asphalt shingles: tabs in staggered courses, a gritty surface
                        float cv = uv.y / 0.14, row = floor(cv), cu = uv.x / 0.33 + 0.37 * mod(row, 3.0);
                        float each = hash22(vec2(floor(cu), row) + seed * 7.0).x;
                        rc *= mix(1.0, (0.92 + 0.16 * each) * (0.95 + 0.1 * nz.a) * (1.0 - 0.45 * (1.0 - pulseW(cv, 0.2, 1.0, pv / 0.14))), d3);
                    }
                }
                if (kind > 2.5) {
                    // standing-seam metal: a rib every 0.45 m up the pitch
                    float fade = 1.0 - smoothstep(0.1, 0.3, px);
                    rc *= 1.0 + fade * (0.25 * lineW(fract(uv.x / 0.45), 0.5, 0.06, pu / 0.45) - 0.2 * lineW(fract(uv.x / 0.45), 0.62, 0.06, pu / 0.45));
                    rfRough = 0.5; rfMetal = 0.55;
                }
                alb = rc;
                // the ridge capping, the gutter along the eaves
                float ridge = boxW(vRuv.z, -1.0, 0.16, max(pv, 0.02));
                alb = mix(alb, rc * (kind < 0.5 ? 0.8 : 0.72) + 0.02, ridge * 0.8 * d2);
                float gut = boxW(uv.y, -1.0, 0.13, pv);
                alb = mix(alb, vec3(0.2, 0.2, 0.2), gut * 0.75 * d2);
                // roof windows: one or two on some pitches
                float side = step(0.0, vRn.x) + 2.0 * step(0.0, vRn.z);
                vec4 hs = hash42(vec2(seed * 91.0 + side * 7.0, 1.5));
                float slopeL = uv.y + vRuv.z / max(ny > 0.99 ? 1.0 : sqrt(1.0 - ny * ny), 0.2);
                if (hs.x < 0.3 && slopeL > 3.4 && kind < 3.5) {
                    vec2 q = uv - vec2((hs.y - 0.5) * 3.0, slopeL * 0.45);
                    float n2 = step(0.5, hs.z);
                    q.x = abs(q.x) - 0.9 * n2;
                    float fr = boxW(q.x, -0.45, 0.45, pu) * boxW(q.y, -0.65, 0.65, pv);
                    float gl = boxW(q.x, -0.37, 0.37, pu) * boxW(q.y, -0.57, 0.57, pv);
                    alb = mix(alb, mix(vec3(0.14, 0.14, 0.14), vec3(0.03, 0.04, 0.05), gl), fr * d2);
                    rfGlass = gl * fr * d2;
                }
                // solar panels on the pitch that faces the sun: dark blue-black cells in thin frames
                float sol = floor(vRoof.w + 0.5);
                if ((sol > 0.5 && sol < 1.5 && vRn.x > 0.1) || (sol > 1.5 && vRn.x < -0.1)) {
                    float cols = max(2.0, floor(min(vScale.z * 0.62, 9.0))), rows = slopeL > 5.2 ? 2.0 : 1.0;
                    vec2 q = uv - vec2((hs.w - 0.5) * 1.5, slopeL * 0.5);
                    vec2 hsz = vec2(cols * 0.52, rows * 0.85);
                    float arr = boxW(q.x, -hsz.x, hsz.x, pu) * boxW(q.y, -hsz.y, hsz.y, pv);
                    float cell = pulseW((q.x + hsz.x) / 1.04, 0.03, 0.97, pu / 1.04) * pulseW((q.y + hsz.y) / 1.7, 0.02, 0.98, pv / 1.7);
                    float fine = 1.0 - 0.25 * d3 * (1.0 - pulseW(q.x / 0.13, 0.0, 0.9, pu / 0.13) * pulseW(q.y / 0.13, 0.0, 0.9, pv / 0.13));
                    alb = mix(alb, mix(vec3(0.5, 0.5, 0.52), vec3(0.012, 0.018, 0.045) * fine, cell), arr * d2);
                    alb = mix(alb, vec3(0.03, 0.035, 0.06), arr * (1.0 - d2));
                    rfGlass = max(rfGlass, arr * cell * 0.8); rfGlassR = mix(rfGlassR, 0.34, arr);
                }
            }
        } else {
            // ── a flat roof: a tray with a parapet round it ──
            float hx = vScale.x * 0.5, hz = vScale.z * 0.5;
            float edge = min(hx - abs(vLp.x), hz - abs(vLp.z)); // metres in from the outer edge
            float rim = min(hx, hz) * 0.05 + 0.01;              // the parapet's width (as the tray is built: 2.5% of the side)
            vec3 cope = mix(vec3(0.55, 0.54, 0.51), vec3(0.3, 0.31, 0.32), step(0.6, hr.z)) * (0.9 + 0.2 * nz.r);
            if (ny > 0.5) {
                if (vLp.y > vScale.y * 0.8) alb = cope;         // the coping
                else {
                    float age = hr.x;
                    vec3 fc = rc * (0.92 + 0.16 * hr.y) * (0.86 + 0.28 * nz.r);
                    if (kind < 4.5) {
                        // gravel ballast: speckled, darker where water stands
                        fc *= 0.9 + 0.2 * mix(0.5, nz.a, d3);
                        float pond = smoothstep(0.55, 0.75, nz.g * 0.5 + nz.r * 0.5);
                        fc = mix(fc, fc * vec3(0.62, 0.64, 0.6), pond * (0.3 + 0.5 * age));
                    } else if (kind < 5.5) {
                        // bitumen felt: laid in metre strips, patched, silvered where it's been recoated
                        float lap = 1.0 - pulseW(uv.x / 1.0 + hr.w, 0.0, 0.96, pu);
                        fc *= 1.0 + 0.5 * lap * d2;
                        vec2 pc = floor(uv / vec2(3.1, 2.3) + seed * 5.0);
                        fc = mix(fc, vec3(0.34, 0.35, 0.36), step(0.86, hash22(pc).x) * 0.7 * d2);
                        fc *= 0.85 + 0.3 * nz.g;
                    } else {
                        // a single-ply membrane: pale, seamed, dirt drifting to the outlets
                        float seam = 1.0 - pulseW(uv.y / 2.0 + hr.w, 0.0, 0.985, pv / 2.0);
                        fc *= 1.0 - 0.3 * seam * d2;
                        fc *= 1.0 - (0.2 + 0.3 * age) * smoothstep(0.4, 0.8, nz.g);
                    }
                    // dirt gathers along the upstand
                    fc *= 0.62 + 0.38 * smoothstep(rim, rim + 1.1, edge + 0.4 * nz.g);
                    alb = fc;
                }
            } else if (ny < -0.5) alb = vec3(0.3);
            else {
                // the upstand's inner face, or the outer face: the building's top course
                float outer = step(edge, rim * 0.5);
                alb = mix(cope * 0.6, mix(wallC, cope, 0.55) * (0.9 + 0.2 * nz.r) * (1.0 - 0.3 * smoothstep(0.4, 0.8, nz2.b)), outer);
                alb *= 1.0 - 0.35 * outer * boxW(vLp.y, -1.0, 0.1, pyl);
            }
        }
        if (burn > 0.0) {
            float soot = smoothstep(1.2 - burn * 1.05, 1.5 - burn * 0.95, nz.r * 0.6 + nz2.b * 0.4 + 0.25);
            alb = mix(alb, vec3(0.022, 0.02, 0.018), soot * min(1.0, burn * 1.6));
            alb *= 1.0 - 0.4 * burn * burn;
            rfGlass *= 1.0 - min(1.0, burn * 2.0);
        }
        rfAlb = alb;
    }`;

export function makeRoofMaterial() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.tFacNoise = { value: noiseTexture() };
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
                attribute vec4 aRoof; attribute vec3 aWallC;
                ${LOCAL_VERT_PARS} varying vec4 vRoof; varying vec3 vWallC; varying vec3 vRuv; varying vec3 vRn;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                ${LOCAL_VERT}
                vRoof = aRoof; vWallC = aWallC;
                {
                    // the face's own axes: along the eave and up the pitch (flat faces: the instance's x and z)
                    vec3 rn = normalize(normal / sc);
                    vec3 rs = vec3(0.0, 1.0, 0.0) - rn * rn.y;
                    float rl = length(rs);
                    vRn = rn;
                    if (rl > 0.02) {
                        rs /= rl;
                        vRuv = vec3(dot(vLp, cross(rs, rn)), vLp.y / max(rs.y, 0.05), (1.0 - position.y) * sc.y);
                    } else vRuv = vec3(vLp.x, vLp.z, 0.0);
                }`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\n' + ROOF_FRAG_PARS)
            .replace('#include <color_fragment>', `#include <color_fragment>
                roofEval(diffuseColor.rgb);
                diffuseColor.rgb = rfAlb;`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = mix(rfRough, rfGlassR, rfGlass);`)
            .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
                metalnessFactor = rfMetal * (1.0 - rfGlass);`)
            .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
                material.specularColor = mix(material.specularColor, vec3(0.07), rfGlass);
                material.specularColorBlended = mix(material.specularColorBlended, vec3(0.07), rfGlass);`);
    };
    mat.customProgramCacheKey = () => 'roof3';
    return mat;
}

// ═════════════ Details ═════════════
// Boxes and cylinders on and round the buildings; aKind says what each is (BIT).
const BIT_FRAG_PARS = /* glsl */`
    uniform sampler2D tFacNoise;
    varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying float vKind;
    ${FACADE_GLSL}
    vec3 btAlb; float btRough; float btMetal; float btGlass;
    void bitEval(vec3 c) {
        btRough = 0.8; btMetal = 0.0; btGlass = 0.0;
        float kind = floor(vKind + 0.5);
        bool top = vLn.y > 0.5, xF = abs(vLn.x) > 0.5;
        // on this face: across and up (m)
        vec2 uv = top || vLn.y < -0.5 ? vLp.xz : vec2(xF ? vLp.z : vLp.x, vLp.y);
        vec2 hs = top || vLn.y < -0.5 ? vScale.xz * 0.5 : vec2((xF ? vScale.z : vScale.x) * 0.5, vScale.y);
        float pu = fwidth(uv.x), pv = fwidth(uv.y), px = max(pu, pv);
        float sd = hash11(dot(vScale, vec3(13.1, 7.7, 3.3)));
        float ln = vScale.x > vScale.z ? vLp.x : vLp.z, pn = fwidth(ln);
        vec4 nz = texture2D(tFacNoise, (uv + sd * 31.0) * 0.11);
        float d2 = 1.0 - smoothstep(0.15, 0.4, px), d3 = 1.0 - smoothstep(0.03, 0.07, px);
        c *= 0.9 + 0.2 * nz.r;
        if (vLp.y < -0.001) { c = vec3(0.5, 0.49, 0.46) * (0.85 + 0.3 * nz.r); kind = 0.0; } // a balcony's slab
        if (kind < 0.5) { /* plain */ }
        else if (kind < 1.5) {
            // rooftop plant: condenser fans on top, louvred sides, a galvanised case
            btRough = 0.55; btMetal = 0.35;
            if (top) {
                float n = max(1.0, floor(vScale.x / max(vScale.z, 0.3) + 0.5));
                vec2 q = vec2(fract((uv.x + hs.x) / (2.0 * hs.x) * n) - 0.5, uv.y / (2.0 * hs.x) * n);
                float r = length(q);
                float fan = (1.0 - smoothstep(0.34, 0.36 + px, r)) * d2;
                c = mix(c, vec3(0.05) + 0.12 * step(0.5, fract(atan(q.y, q.x) * 1.2732)) * step(0.08, r), fan);
            } else c *= 1.0 - 0.4 * d2 * boxW(uv.y, 0.12 * hs.y, 0.88 * hs.y, pv) * (1.0 - pulseW(uv.y / 0.08, 0.0, 0.5, pv / 0.08)) * step(sd, 0.7);
        } else if (kind < 2.5) {
            // a brick chimney stack: courses, soot at the top, a lighter capping
            if (!top) {
                float by = uv.y / 0.075, row = floor(by), bx = uv.x / 0.225 + 0.5 * mod(row, 2.0);
                c *= 1.0 - 0.3 * d3 * (1.0 - pulseW(by, 0.14, 1.0, pv / 0.075) * pulseW(bx, 0.045, 1.0, pu / 0.225));
                c = mix(c, vec3(0.5, 0.48, 0.45), boxW(uv.y, hs.y - 0.14, hs.y + 1.0, pv) * 0.8);
                c *= 1.0 - 0.45 * smoothstep(hs.y - 1.0, hs.y, uv.y) * nz.g;
            } else c = vec3(0.05);
            btRough = 0.92;
        } else if (kind < 3.5) {
            // a solar panel
            if (top) {
                float cell = pulseW((uv.x + hs.x) / 1.04, 0.03, 0.97, pu / 1.04) * pulseW((uv.y + hs.y) / 1.7, 0.02, 0.98, pv / 1.7);
                c = mix(vec3(0.45, 0.45, 0.47), vec3(0.012, 0.018, 0.045), mix(0.9, cell, d2));
                btGlass = 0.8; btRough = 0.34;
            } else c = vec3(0.3);
        } else if (kind < 4.5) {
            // a clipped hedge: leaves and the dark between them
            c *= 0.62 + 0.76 * mix(0.5, nz.a * 0.5 + nz.g * 0.5, d2);
            c *= top ? 1.08 : 0.78 + 0.3 * smoothstep(0.0, hs.y, uv.y);
            btRough = 0.95;
        } else if (kind < 5.5) {
            // timber: boards with gaps between them
            float n = top ? uv.y : uv.x;
            c *= 1.0 - 0.35 * d3 * (1.0 - pulseW(n / 0.14, 0.0, 0.9, (top ? pv : pu) / 0.14));
            c *= 0.85 + 0.3 * nz.g;
            btRough = 0.9;
        } else if (kind < 6.5) {
            // an awning: canvas, striped on some
            float str = step(sd, 0.45) * (1.0 - pulseW(uv.x / 0.5, 0.0, 0.5, pu / 0.5));
            c = mix(c, vec3(0.72, 0.7, 0.64), str * 0.8);
            c *= 0.85 + 0.25 * nz.g;
            btRough = 0.95;
        } else if (kind < 7.5) {
            // a glass balustrade
            c = mix(c * 0.25, vec3(0.5, 0.5, 0.5), lineW(uv.y, hs.y - 0.03, 0.03, pv) * d2);
            btGlass = 0.7; btRough = 0.1;
        } else if (kind < 8.5) {
            // ducts and tanks: galvanised sheet, a joint every metre or so
            btRough = 0.45; btMetal = 0.6;
            c *= 1.0 - 0.3 * d2 * (1.0 - pulseW(ln / 1.2, 0.0, 0.96, pn / 1.2));
        } else if (kind < 9.5) {
            // a stair or lift housing: rendered walls, a door, a felt top
            if (top) c = vec3(0.16, 0.16, 0.165) * (0.8 + 0.4 * nz.r);
            else {
                c *= 1.0 - 0.2 * smoothstep(0.4, 0.8, nz.b);
                float door = boxW(uv.x, -0.5, 0.5, pu) * boxW(uv.y, 0.0, 2.05, pv) * (xF && vLn.x > 0.0 ? 1.0 : 0.0) * d2;
                c = mix(c, vec3(0.2, 0.22, 0.24), door);
            }
        } else if (kind < 10.5) {
            // concrete: stained
            c *= 1.0 - 0.25 * smoothstep(0.4, 0.8, nz.b);
            btRough = 0.9;
        } else {
            // a dormer: its window, cheeks in the wall's finish, a leaded cap
            if (vLp.y > 0.66 * vScale.y || top) c = vec3(0.17, 0.175, 0.185) * (0.8 + 0.4 * nz.r);
            else if (vLn.z > 0.5) {
                float fr = boxW(uv.x, -hs.x + 0.16, hs.x - 0.16, pu) * boxW(uv.y, 0.22, 0.65 * hs.y - 0.12, pv);
                float gl = boxW(uv.x, -hs.x + 0.22, hs.x - 0.22, pu) * boxW(uv.y, 0.28, 0.65 * hs.y - 0.18, pv) * (1.0 - lineW(uv.x, 0.0, 0.025, pu));
                c = mix(c, mix(vec3(0.78), vec3(0.03, 0.035, 0.04), gl), fr);
                btGlass = gl * fr; btRough = mix(btRough, 0.1, btGlass);
            }
        }
        btAlb = c;
    }`;

export function makeBitMaterial() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.tFacNoise = { value: noiseTexture() };
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
                attribute float aKind;
                ${LOCAL_VERT_PARS} varying float vKind;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                ${LOCAL_VERT}
                vKind = aKind;`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\n' + BIT_FRAG_PARS)
            .replace('#include <color_fragment>', `#include <color_fragment>
                bitEval(diffuseColor.rgb);
                diffuseColor.rgb = btAlb;`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = btRough;`)
            .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
                metalnessFactor = btMetal;`)
            .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
                material.specularColor = mix(material.specularColor, vec3(0.08), btGlass);
                material.specularColorBlended = mix(material.specularColorBlended, vec3(0.08), btGlass);`);
    };
    mat.customProgramCacheKey = () => 'bit3';
    return mat;
}

// ═════════════ Geometry: unit shapes, base at y = 0, outward-facing ═════════════
// Every triangle here is drawn for every building of the map, and again in the sun's shadow passes: faces nobody
// sees are left out (a wall box has no top or bottom: a roof sits on it, and a ruin's shell stands open).
function triGeo(tris) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
    g.computeVertexNormals();
    return g;
}
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
// the four walls of a unit box (x, z: ±0.5, y: 0..1)
export function wallGeometry() {
    const P = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], tris = [];
    for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; tris.push(...quad([b[0], 0, b[1]], [a[0], 0, a[1]], [a[0], 1, a[1]], [b[0], 1, b[1]])); }
    return triGeo(tris);
}
// a unit box without its underside (things that stand on something)
export function boxGeometry() {
    const g = wallGeometry(), top = triGeo(quad([-0.5, 1, -0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]));
    return joinGeo([g, top]);
}
function joinGeo(list) {
    const pos = [], nor = [];
    for (const g of list) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
}
// Gable roof: a prism with its ridge along z: two pitches, the gable ends and the soffit (the walls under it have no
// top, and from the street one looks up under the eaves). The gutter line and the ridge are drawn by the roof shader.
export function gableGeometry() {
    const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], T = [0, 1, -0.5], T2 = [0, 1, 0.5];
    return triGeo([...quad(A, D, T2, T), ...quad(C, B, T, T2), [B, A, T], [D, C, T2], ...quad(A, B, C, D)]);
}
// Hip roof: a shorter ridge along z, the ends pitched too
export function hipGeometry() {
    const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], R0 = [0, 1, -0.22], R1 = [0, 1, 0.22];
    return triGeo([[D, C, R1], [B, A, R0], ...quad(A, D, R1, R0), ...quad(C, B, R0, R1), ...quad(A, B, C, D)]);
}
// Flat roof: a tray. The outer face up to the coping, the coping's top, the upstand's inner face down to the roof
// deck. The upstand is 2.5% of each side wide (0.3 m on a 12 m block, most of a metre on a tower).
export const TRAY = { rim: 0.025, deck: 0.45 };
export function trayGeometry() {
    const t = TRAY.rim, k = 0.5 - t, d = TRAY.deck;
    const O = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], I = [[-k, -k], [k, -k], [k, k], [-k, k]];
    const tris = [];
    for (let i = 0; i < 4; i++) {
        const a = O[i], b = O[(i + 1) % 4], ia = I[i], ib = I[(i + 1) % 4];
        tris.push(...quad([b[0], 0, b[1]], [a[0], 0, a[1]], [a[0], 1, a[1]], [b[0], 1, b[1]]));        // outer face
        tris.push(...quad([b[0], 1, b[1]], [a[0], 1, a[1]], [ia[0], 1, ia[1]], [ib[0], 1, ib[1]]));    // coping
        tris.push(...quad([ib[0], 1, ib[1]], [ia[0], 1, ia[1]], [ia[0], d, ia[1]], [ib[0], d, ib[1]])); // inner face
    }
    tris.push(...quad([-k, d, -k], [-k, d, k], [k, d, k], [k, d, -k]));                                // the deck
    return triGeo(tris);
}
// A balcony: a slab and a balustrade on three sides (the open side at -z, against the wall). x: ±0.5, z: -0.5..0.5,
// the slab's top at y = 0, the rail at y = 1 (scale: width, rail height, depth). The balustrade is a sheet seen from
// both sides.
export function balconyGeometry() {
    const s = -0.16, tris = [];
    const F = [-0.5, 0.5], L = -0.5, R = 0.5;
    // the slab: top, underside, front and side edges
    tris.push(...quad([L, 0, -0.5], [L, 0, 0.5], [R, 0, 0.5], [R, 0, -0.5]), ...quad([L, s, -0.5], [R, s, -0.5], [R, s, 0.5], [L, s, 0.5]));
    tris.push(...quad([L, s, 0.5], [R, s, 0.5], [R, 0, 0.5], [L, 0, 0.5]), ...quad([L, s, -0.5], [L, s, 0.5], [L, 0, 0.5], [L, 0, -0.5]), ...quad([R, s, 0.5], [R, s, -0.5], [R, 0, -0.5], [R, 0, 0.5]));
    // the balustrade: front and two sides, outside and inside
    const sheet = (a, b) => { tris.push(...quad([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 1, b[1]], [a[0], 1, a[1]]), ...quad([b[0], 0, b[1]], [a[0], 0, a[1]], [a[0], 1, a[1]], [b[0], 1, b[1]])); };
    sheet([L, F[1]], [R, F[1]]); sheet([L, F[0]], [L, F[1]]); sheet([R, F[1]], [R, F[0]]);
    return triGeo(tris);
}
// round things: flues, chimney pots, vent cowls, dishes (1 across, 1 high, base at y = 0; six sides and a top)
export function drumGeometry() {
    const N = 6, tris = [], P = [];
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; P.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]); }
    for (let i = 0; i < N; i++) { const a = P[i], b = P[(i + 1) % N]; tris.push(...quad([a[0], 0, a[1]], [a[0], 1, a[1]], [b[0], 1, b[1]], [b[0], 0, b[1]])); }
    for (let i = 1; i + 1 < N; i++) tris.push([[P[0][0], 1, P[0][1]], [P[i + 1][0], 1, P[i + 1][1]], [P[i][0], 1, P[i][1]]]);
    return triGeo(tris);
}
