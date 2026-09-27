// ═══════════════════════════════════════════════════════════════
// Airfield lighting (docs/WAR.md, "Airbases"): every light of every field as one set of points per field (one draw
// call), coloured and aimed like the real fixtures, on switchable circuits (power, blackout, a closed runway).
// Layout from FAA AC 150/5340-30 (Design and Installation Details for Airport Visual Aids) and ICAO Annex 14 Vol I
// ch. 5, with FAA AIM 2-1 for the beacon:
//  • runway edge lights, white, ≤ 60 m (200 ft) apart, 3 m outside the edge; yellow over the last 600 m (2000 ft)
//    toward the far end (the "caution zone") — bidirectional, so each fixture shows its own colour to each side
//  • threshold / runway end: a row across the whole width at 3 m, green toward the approach, red toward the runway
//  • centreline lights every 15 m (50 ft): white, then alternating red and white for the last 900 m, red for the
//    last 300 m (to each direction its own); touchdown-zone barrettes (3 lights) every 30 m for 900 m, two rows
//  • approach lights: ALSF-2 (730 m: 5-light barrettes every 30 m, the 150 m and 300 m crossbars, red side-row
//    barrettes in the inner 300 m, sequenced flashers from 300 m out running toward the threshold twice a
//    second), MALSR (420 m of barrettes every 60 m + the 300 m bar, RAIL flashers out to 730 m), ICAO Calvert
//    (900 m centreline, one / two / three sources by thirds, crossbars at 150 m intervals whose ends converge on
//    the centreline), or REIL strobes where there's none
//  • PAPI: four units on the pilot's left at the aiming point, inner unit 15 m from the edge, 9 m apart, transition
//    angles 3°30', 3°10', 2°50', 2°30' (white above, red below: two of each on a 3° path)
//  • taxiway edges blue (omnidirectional, ≤ 50 m apart, gaps where pavements join), red stop bars and flashing
//    yellow runway guard lights ("wig-wags") at the holding positions — lit while the runway is closed
//  • apron floodlight masts (high-pressure sodium) with their pools of light, obstruction lights on anything tall,
//    and the rotating beacon: military fields flash two quick white peaks between the green, civil ones plain
//    white and green
//  • a closed runway: its lights off, a lighted yellow X at each end
// Searchlights (war time, at night: sweeping, or coned on a raider) are drawn here too.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { baseToWorld, terrainHeight, runwayInfo, SKY_FOG } from './world.js';
import { runwayFrames, fromRunway } from './baselayout.js';

// circuits (uPower slots): per runway r (0..2): r * 8 + { EDGE 0, THR 1, CL 2, TDZ 3, ALS 4, FLASH 5, PAPI 6, X 7 }
export const RW_CIRCUIT = { EDGE: 0, THR: 1, CL: 2, TDZ: 3, ALS: 4, FLASH: 5, PAPI: 6, X: 7 };
export const CIRCUIT = { TAXI: 24, STOP: 25, GUARD: 26, FLOOD: 27, BEACON: 28, OBST: 29 };
export const rwc = (r, k) => r * 8 + RW_CIRCUIT[k];
// light kinds (shader): plain, PAPI unit, sequenced flasher / strobe, beacon (military / civil), wig-wag
const K = { PLAIN: 0, PAPI: 1, FLASH: 2, BEACON_MIL: 3, BEACON_CIV: 4, WIGWAG: 5 };

// colours (linear, HDR: bloom picks them up)
const WHITE = [2.6, 2.35, 1.9], YELLOW = [2.6, 1.7, 0.35], GREEN = [0.25, 2.4, 0.7], RED = [2.6, 0.12, 0.08], BLUE = [0.25, 0.55, 2.6];
const OFF = [0, 0, 0], STROBE = [6, 6, 6.5], SODIUM = [2.4, 1.3, 0.45], XLIGHT = [3, 2.2, 0.3];
const GS = 3 * Math.PI / 180; // the glide path the PAPI is set for

// ═════════════ Layout (pure: counts and positions are tested) ═════════════
// The approach end of runway frame F for this layout: dir = +1 lands toward −v (threshold at v = +half), −1 toward +v
function approachDir(b, F) {
    if (b.layout === 'standard') return 1;
    // as air traffic picks it (airtraffic.js): the end whose approach is clear of the hills
    const R = runwayInfo(b, F.rw);
    let best = null;
    for (const dir of [1, -1]) {
        const fx = R.dirX * dir, fz = R.dirZ * dir, thrX = R.x - fx * R.half, thrZ = R.z - fz * R.half;
        let worst = -Infinity;
        for (let d = 200; d <= 14000; d += 400) worst = Math.max(worst, terrainHeight(thrX - fx * d, thrZ - fz * d) - (b.h + d * Math.tan(GS)));
        if (!best || worst < best.worst) best = { dir, worst };
    }
    return best.dir;
}

// Every light of a field. Returns { lights: [{ x, y, z, c1, c2, dx, dz, beam, size, circ, kind, p, back }], counts }
//   c1: colour toward (dx, dz) (the fixture's front), c2: toward the back (null: dark behind); beam: cos of the half
//   angle it's seen within (−1: all round); p: kind parameter (PAPI transition angle, flash phase)
export function lightingLayout(b, L, paved = null) {
    const out = [], counts = {};
    const cnt = (k) => { counts[k] = (counts[k] || 0) + 1; };
    const c = Math.cos(b.heading), s = Math.sin(b.heading);
    // base-local direction → world
    const dirW = (dlx, dlz) => ({ x: dlx * c - dlz * s, z: dlx * s + dlz * c });
    const put = (lx, lz, y, o) => {
        const w = baseToWorld(b, lx, lz);
        out.push({ x: w.x, y, z: w.z, c1: o.c1, c2: o.c2 ?? null, dx: o.dx ?? 0, dz: o.dz ?? 0, beam: o.beam ?? -1, size: o.size ?? 2.2, circ: o.circ, kind: o.kind ?? K.PLAIN, p: o.p ?? 0, tag: o.tag });
        cnt(o.tag);
    };
    const ground = (lx, lz) => { const w = baseToWorld(b, lx, lz); return Math.max(terrainHeight(w.x, w.z), 0); };
    const frames = runwayFrames(b);
    const cfg = (L && L.lights && L.lights.rw) || [];
    frames.forEach((F, r) => {
        const conf = cfg[r] || { alsPrimary: 'none', alsOther: 'simple', papiSide: -1 };
        const dir = approachDir(b, F);
        const H = F.half, hw = F.hw, y0 = b.h + 0.15;
        // runway-local → base-local; the runway's +v direction in the world
        const at = (u, v, y, o) => { const p = fromRunway(F, u, v); put(p.lx, p.lz, y, o); };
        const vW = dirW(F.s, F.c); // d(lx, lz)/dv
        const front = (sign) => ({ dx: vW.x * sign, dz: vW.z * sign });
        // ── edge lights ──
        const n = Math.ceil((2 * H) / 60);
        for (let i = 0; i <= n; i++) {
            const v = -H + (2 * H) * i / n;
            // seen from the +v side (landing toward −v) the last 600 m before the −v end is yellow; and vice versa
            const toMinus = v < -H + 600 ? YELLOW : WHITE, toPlus = v > H - 600 ? YELLOW : WHITE;
            for (const sd of [-1, 1]) at(sd * (hw + 3), v, y0 + 0.35, { c1: toMinus, c2: toPlus, ...front(1), beam: -1, circ: rwc(r, 'EDGE'), tag: 'edge' });
        }
        // ── threshold / end: across the width at 3 m, green outward (toward that end's approach), red inward ──
        const nt = Math.floor((2 * hw) / 3);
        for (const e of [1, -1]) for (let i = 0; i <= nt; i++) {
            const u = -hw + (2 * hw) * i / nt;
            at(u, e * (H + 0.5), y0 + 0.3, { c1: GREEN, c2: RED, ...front(e), beam: 0.0, circ: rwc(r, 'THR'), size: 2.6, tag: 'threshold' });
        }
        // ── centreline every 15 m (offset 0.6 m): colour coded by the distance left, for each direction ──
        const code = (left, i) => (left <= 300 ? RED : left <= 900 ? (i % 2 ? RED : WHITE) : WHITE);
        for (let v = -H + 7.5, i = 0; v <= H - 7.5; v += 15, i++) at(0.6, v, y0 + 0.25, { c1: code(v + H, i), c2: code(H - v, i), ...front(1), circ: rwc(r, 'CL'), size: 1.8, tag: 'centreline' });
        // the approach end is at v = dir·H; landing toward −dir
        const A = dir * H;
        const toApp = front(dir);
        // ── touchdown zone (precision end): 30 m … 900 m in, barrettes of 3 at ±11 m ──
        if (conf.alsPrimary === 'alsf2') {
            for (let d = 30; d <= 900; d += 30) for (const sd of [-1, 1]) for (const k of [-1, 0, 1]) at(sd * 11 + k * 1.5, A - dir * d, y0 + 0.25, { c1: WHITE, ...toApp, beam: 0.2, circ: rwc(r, 'TDZ'), size: 1.7, tag: 'tdz' });
        }
        // ── approach lighting beyond each end ──
        const alsAt = (d, u, e, o) => {
            const v = e * (H + d);
            const p = fromRunway(F, u, v);
            const g = ground(p.lx, p.lz);
            // on stands that keep them near the threshold's plane over low ground (≤ 2 % slope), flush on high ground
            const y = Math.max(g + 0.6, b.h + 0.4 - 0.02 * d);
            put(p.lx, p.lz, y, o);
        };
        const buildALS = (type, e) => {
            const tw = front(e);
            if (type === 'alsf2') {
                for (let d = 30; d <= 720; d += 30) {
                    for (let k = -2; k <= 2; k++) alsAt(d, k * 1.05, e, { c1: WHITE, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.4, tag: 'als' });
                    if (d <= 300) for (const sd of [-1, 1]) for (const k of [-1, 0, 1]) alsAt(d, sd * 11 + k * 1.5, e, { c1: RED, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.2, tag: 'als_side' });
                    if (d === 150) for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) alsAt(d, sd * (3.7 + k * 1.5), e, { c1: WHITE, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.4, tag: 'als_bar' });
                    if (d === 300) for (const sd of [-1, 1]) for (let k = 0; k < 8; k++) alsAt(d, sd * (3.7 + k * 1.5), e, { c1: WHITE, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.4, tag: 'als_bar' });
                }
                // sequenced flashers from 300 m out to 720 m, firing in turn toward the threshold twice a second
                const fl = []; for (let d = 300; d <= 720; d += 30) fl.push(d);
                fl.forEach((d, i) => alsAt(d, 0, e, { c1: STROBE, ...tw, beam: 0.2, circ: rwc(r, 'FLASH'), kind: K.FLASH, p: (fl.length - 1 - i) / (fl.length * 2), size: 5, tag: 'flasher' }));
            } else if (type === 'malsr') {
                for (let d = 60; d <= 420; d += 60) {
                    for (let k = -2; k <= 2; k++) alsAt(d, k * 1.05, e, { c1: WHITE, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.3, tag: 'als' });
                    if (d === 300) for (const sd of [-1, 1]) for (let k = 0; k < 5; k++) alsAt(d, sd * (3.7 + k * 1.5), e, { c1: WHITE, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.3, tag: 'als_bar' });
                }
                const fl = [480, 540, 600, 660, 720];
                fl.forEach((d, i) => alsAt(d, 0, e, { c1: STROBE, ...tw, beam: 0.2, circ: rwc(r, 'FLASH'), kind: K.FLASH, p: (fl.length - 1 - i) / (fl.length * 2), size: 5, tag: 'flasher' }));
            } else if (type === 'calvert') {
                // ICAO CAT I: 900 m of centreline at 30 m (1 / 2 / 3 sources by thirds, distance coding), crossbars every 150 m
                for (let d = 30; d <= 900; d += 30) {
                    const nsrc = d <= 300 ? 1 : d <= 600 ? 2 : 3;
                    for (let k = 0; k < nsrc; k++) alsAt(d, (k - (nsrc - 1) / 2) * 1.2, e, { c1: WHITE, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.5, tag: 'als' });
                    if (d % 150 === 0 && d <= 750) {
                        const half = 0.025 * (d + 300); // the bar ends converge on the centreline 300 m inside the threshold
                        for (let u = 2.5; u <= half + 0.01; u += 2.5) for (const sd of [-1, 1]) alsAt(d, sd * u, e, { c1: WHITE, ...tw, beam: 0.3, circ: rwc(r, 'ALS'), size: 2.4, tag: 'als_bar' });
                    }
                }
            } else if (type === 'simple') {
                // runway end identifier lights: two synchronised strobes either side of the threshold
                for (const sd of [-1, 1]) alsAt(0, sd * (hw + 12), e, { c1: STROBE, ...tw, beam: 0.1, circ: rwc(r, 'FLASH'), kind: K.FLASH, p: 0, size: 4.5, tag: 'reil' });
            }
        };
        buildALS(conf.alsPrimary, dir);
        buildALS(conf.alsOther, -dir);
        // ── PAPI at the aiming point of each end, on the landing pilot's left ──
        for (const e of [dir, -dir]) {
            const aim = e * (H - 400);
            // landing toward −e: the pilot's left is +u·e·side… for the standard field (e = +1, heading −z) it's −x
            const side = conf.papiSide * e;
            const angles = [3.5, 3 + 10 / 60, 2 + 50 / 60, 2.5].map(a => a * Math.PI / 180); // inner → outer
            angles.forEach((ang, i) => at(side * (hw + 15 + i * 9), aim, y0 + 0.9, { c1: WHITE, ...front(e), beam: 0.9, circ: rwc(r, 'PAPI'), kind: K.PAPI, p: ang, size: 3.4, tag: 'papi' }));
        }
        // ── lighted X at each end of a closed runway (and one at the middle) ──
        for (const vx of [H - 90, 0, -(H - 90)]) for (let k = -6; k <= 6; k++) for (const sd of [-1, 1]) {
            if (k === 0 && sd > 0) continue;
            at(k * 2.2, vx + sd * k * 2.2, y0 + 0.3, { c1: XLIGHT, ...front(1), c2: XLIGHT, circ: rwc(r, 'X'), size: 2.4, tag: 'closedX' });
        }
    });
    // ── taxiway and apron edges: blue, ≤ 50 m apart, 3 m out, not where another pavement (or the runway) joins ──
    const rects = paved || (L && L.paved) || [];
    const onPave = (lx, lz, self) => {
        for (const q of rects) if (q !== self && lx >= q.x0 - 1 && lx <= q.x1 + 1 && lz >= q.z0 - 1 && lz <= q.z1 + 1) return true;
        for (const F of frames) { const u = (lx - F.cx) * F.c - (lz - F.cz) * F.s, v = (lx - F.cx) * F.s + (lz - F.cz) * F.c; if (Math.abs(u) <= F.hw + 4 && Math.abs(v) <= F.half + 4) return true; }
        return false;
    };
    for (const q of rects) {
        if (q.kind === 'runway') continue;
        const edges = [[q.x0 - 3, q.z0, q.x0 - 3, q.z1], [q.x1 + 3, q.z0, q.x1 + 3, q.z1], [q.x0, q.z0 - 3, q.x1, q.z0 - 3], [q.x0, q.z1 + 3, q.x1, q.z1 + 3]];
        for (const [ax, az, bx, bz] of edges) {
            const len = Math.hypot(bx - ax, bz - az);
            // the short ends of a narrow taxiway strip are where it joins something: only light the long sides
            if (q.kind === 'taxiway' && len < Math.max(q.x1 - q.x0, q.z1 - q.z0) * 0.5) continue;
            const nn = Math.max(1, Math.ceil(len / 50));
            for (let i = 0; i <= nn; i++) {
                const lx = ax + (bx - ax) * i / nn, lz = az + (bz - az) * i / nn;
                if (onPave(lx, lz, q)) continue;
                put(lx, lz, b.h + 0.45, { c1: BLUE, circ: CIRCUIT.TAXI, size: 1.9, tag: 'taxi' });
            }
        }
    }
    // ── stop bars and runway guard lights where the connectors meet the runway (holding position ~60 m from the
    // centreline) — standard fields
    if (b.layout === 'standard') {
        for (const z0 of [-900, 0, 900]) {
            for (let k = -3; k <= 3; k++) put(88, z0 + k * 2.8, b.h + 0.3, { c1: RED, ...dirW(-1, 0), beam: 0.2, circ: CIRCUIT.STOP, size: 2, tag: 'stopbar' });
            for (const sd of [-1, 1]) put(90, z0 + sd * 12, b.h + 0.9, { c1: YELLOW, ...dirW(-1, 0), beam: 0.1, circ: CIRCUIT.GUARD, kind: K.WIGWAG, p: sd > 0 ? 0 : 0.5, size: 2.6, tag: 'guard' });
        }
        for (let k = -3; k <= 3; k++) put(55, 1485 + k * 2.8, b.h + 0.3, { c1: RED, ...dirW(-1, 0), beam: 0.2, circ: CIRCUIT.STOP, size: 2, tag: 'stopbar' });
    }
    // ── floodlight masts (sodium): a glow at the head (their pools are drawn separately) ──
    for (const f of (L && L.floods) || []) {
        const g = ground(f.lx, f.lz);
        put(f.lx, f.lz, g + 20.5, { c1: SODIUM, circ: CIRCUIT.FLOOD, size: 7, tag: 'flood' });
        put(f.lx, f.lz, g + 22.2, { c1: RED, circ: CIRCUIT.OBST, size: 1.6, tag: 'obst' });
    }
    // ── the beacon (on the control tower) and obstruction lights on the tower and radar ──
    const bc = L && L.lights && L.lights.beacon;
    if (bc) {
        const g = ground(bc.lx, bc.lz);
        const tw = L.tower ? { lx: L.tower.lx - 6, lz: L.tower.lz } : bc;
        put(tw.lx, tw.lz, (L.tower ? b.h : g) + 53.4, { c1: WHITE, circ: CIRCUIT.BEACON, kind: bc.military ? K.BEACON_MIL : K.BEACON_CIV, size: 9, tag: 'beacon' });
        if (L.tower) put(tw.lx, tw.lz, b.h + 51.3, { c1: RED, circ: CIRCUIT.OBST, size: 2.2, tag: 'obst' });
    }
    if (L && L.radar) put(L.radar.lx, L.radar.lz, ground(L.radar.lx, L.radar.lz) + 14.2, { c1: RED, circ: CIRCUIT.OBST, size: 1.8, tag: 'obst' });
    return { lights: out, counts };
}

// ═════════════ Rendering ═════════════
const VERT = /* glsl */`
    attribute vec3 aC1;
    attribute vec3 aC2;
    attribute vec4 aDir;   // front (world xz), beam (cos half-angle, −1 all round), size (m)
    attribute vec4 aFx;    // circuit, kind, parameter, has a back colour
    uniform float uPower[32];
    uniform float uTime, uPx;
    varying vec3 vCol;
    varying float vA;
    #include <fog_pars_vertex>
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vec3 toCam = cameraPosition - position;
        float dist = max(length(toCam), 1.0);
        float hl = max(length(toCam.xz), 1e-3);
        vec2 h = toCam.xz / hl;
        float front = dot(h, aDir.xy);
        float k = uPower[int(aFx.x + 0.5)];
        int kind = int(aFx.y + 0.5);
        vec3 col = aC1;
        if (aDir.z > -0.99) {
            // directional: a fixture is seen within its beam from the front, the back colour (if any) from behind
            float f = smoothstep(aDir.z - 0.12, aDir.z + 0.04, front);
            float b = aFx.w > 0.5 ? smoothstep(aDir.z - 0.12, aDir.z + 0.04, -front) : 0.0;
            col = aC1 * f + aC2 * b;
        } else if (aFx.w > 0.5) col = mix(aC2, aC1, smoothstep(-0.08, 0.08, front));
        if (kind == 1) {
            // PAPI: white above the unit's transition angle, red below (a few arcminutes of pink between)
            float elev = atan(toCam.y, max(front * hl, 1.0));
            float w = smoothstep(aFx.z - 0.0012, aFx.z + 0.0012, elev);
            col = mix(vec3(2.6, 0.1, 0.07), vec3(2.6, 2.4, 2.2), w) * smoothstep(0.84, 0.9, front);
        } else if (kind == 2) {
            // sequenced flasher / strobe: a 25 ms burst at its slot of a half-second cycle
            float t = fract(uTime * 2.0 - aFx.z);
            k *= step(t, 0.05) * (1.0 - t * 12.0);
        } else if (kind == 3 || kind == 4) {
            // rotating beacon, 12 rpm: a green lamp and, opposite it, white (military: two quick white peaks)
            float a = uTime * 1.2566;
            float brg = atan(h.x, h.y);
            float g = pow(max(cos(brg - a), 0.0), 90.0);
            float w = kind == 3 ? pow(max(cos(brg - a - 3.0416), 0.0), 400.0) + pow(max(cos(brg - a - 3.2416), 0.0), 400.0) : pow(max(cos(brg - a - 3.14159), 0.0), 90.0);
            col = vec3(0.35, 3.2, 0.8) * g * 2.0 + vec3(3.4, 3.2, 3.0) * w * 2.0;
            k *= clamp(1.0 - abs(toCam.y) / dist * 1.5, 0.15, 1.0);
        } else if (kind == 5) {
            // wig-wag: the pair alternates, once a second
            k *= step(0.5, fract(uTime + aFx.z));
        }
        float px = aDir.w * uPx / dist;
        gl_PointSize = clamp(px, 1.6, 42.0);
        vA = k * clamp(sqrt(px / 1.6), 0.05, 1.0);
        vCol = col;
        if (k <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // (off: out of the clip volume)
        #include <fog_vertex>
    }`;
const FRAG = /* glsl */`
    varying vec3 vCol;
    varying float vA;
    #include <fog_pars_fragment>
    void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 7.0) + 0.9 * exp(-r2 * 60.0);
        gl_FragColor = vec4(vCol * a * vA, 1.0);
        #ifdef USE_FOG
            vec3 fogRay = ( vec4( vFogPos, 0.0 ) * viewMatrix ).xyz;
            vec2 fogAmt = skyFogAmount( fogRay, cameraPosition.y );
            gl_FragColor.rgb *= 1.0 - fogAmt.x * 0.8; // lights punch through the haze further than lit surfaces
        #endif
    }`;

function lightsMaterial() {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uPower: { value: new Array(32).fill(1) }, uTime: { value: 0 }, uPx: { value: 800 },
    }]);
    u.skyFogA = { value: SKY_FOG.a }; u.skyFogB = { value: SKY_FOG.b }; u.skyFogC = { value: SKY_FOG.c }; u.skyFogD = { value: SKY_FOG.d };
    return new THREE.ShaderMaterial({
        uniforms: u, vertexShader: VERT, fragmentShader: FRAG, fog: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
}

const _v = new THREE.Vector2(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// the soft radial texture for the pools of light under the floodlights
let poolTex = null;
function poolTexture() {
    if (poolTex) return poolTex;
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(0.7, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    poolTex = new THREE.CanvasTexture(c);
    return poolTex;
}

// ── searchlight beams: an open cone per lamp, instanced; soft edges, fading along the beam ──
const BEAM_VERT = /* glsl */`
    varying vec3 vN, vW;
    varying float vY;
    #include <fog_pars_vertex>
    void main() {
        vY = position.y;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }`;
const BEAM_FRAG = /* glsl */`
    uniform float uI;
    varying vec3 vN, vW;
    varying float vY;
    #include <fog_pars_fragment>
    void main() {
        vec3 V = normalize(cameraPosition - vW);
        float edge = pow(abs(dot(normalize(vN), V)), 1.6);          // brightest through the middle of the cone
        float along = pow(1.0 - vY, 1.7) * smoothstep(0.0, 0.015, vY); // fading out along the beam
        float a = edge * along * uI;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0);
        #ifdef USE_FOG
            vec3 fogRay = ( vec4( vFogPos, 0.0 ) * viewMatrix ).xyz;
            vec2 fogAmt = skyFogAmount( fogRay, cameraPosition.y );
            gl_FragColor.rgb *= 1.0 - fogAmt.x * 0.6;
        #endif
    }`;

export class AirfieldLights {
    // fields: [{ base, layout, paved }]
    constructor(scene, fields) {
        this.scene = scene;
        this.night = false;
        this.time = 0;
        this.fields = new Map();
        for (const f of fields) this.build(f);
    }

    build({ base: b, layout: L, paved }) {
        const { lights, counts } = lightingLayout(b, L, paved);
        const n = lights.length;
        const pos = new Float32Array(n * 3), c1 = new Float32Array(n * 3), c2 = new Float32Array(n * 3), dir = new Float32Array(n * 4), fx = new Float32Array(n * 4);
        lights.forEach((l, i) => {
            pos.set([l.x, l.y, l.z], i * 3);
            c1.set(l.c1, i * 3); c2.set(l.c2 || OFF, i * 3);
            const dl = Math.hypot(l.dx, l.dz) || 1;
            dir.set([l.dx / dl, l.dz / dl, l.beam, l.size], i * 4);
            fx.set([l.circ, l.kind, l.p, l.c2 ? 1 : 0], i * 4);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aC1', new THREE.BufferAttribute(c1, 3));
        g.setAttribute('aC2', new THREE.BufferAttribute(c2, 3));
        g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
        g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
        g.computeBoundingSphere();
        const mat = lightsMaterial();
        const pts = new THREE.Points(g, mat);
        pts.renderOrder = 5;
        pts.visible = false;
        pts.matrixAutoUpdate = false;
        pts.onBeforeRender = (renderer, scene, camera) => {
            const t = renderer.getRenderTarget();
            const hpx = t ? t.height : renderer.getDrawingBufferSize(_v).y;
            mat.uniforms.uPx.value = hpx / (2 * Math.tan((camera.fov || 60) * Math.PI / 360));
        };
        this.scene.add(pts);
        // power: every circuit on, the closed-runway X off
        const power = mat.uniforms.uPower.value;
        for (let r = 0; r < 3; r++) power[rwc(r, 'X')] = 0;
        power[CIRCUIT.STOP] = 0; power[CIRCUIT.GUARD] = 0;
        const F = { base: b, layout: L, points: pts, mat, power, counts, lights, main: true, blackout: false, closed: [false, false, false], pools: null, beams: null, masts: null };
        this.fields.set(b.id, F);
        this.buildPools(F);
        this.buildMasts(F);
        this.buildSearchlights(F);
        this.apply(F);
        return F;
    }

    // pools of sodium light on the ground under the floodlight masts
    buildPools(F) {
        const L = F.layout, fl = (L && L.floods) || [];
        if (!fl.length) return;
        const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: new THREE.Color(0.55, 0.32, 0.12), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -4 });
        const im = new THREE.InstancedMesh(geo, mat, fl.length);
        const b = F.base;
        fl.forEach((f, i) => {
            const w = baseToWorld(b, f.lx, f.lz);
            im.setMatrixAt(i, _m.compose(_v3.set(w.x, Math.max(terrainHeight(w.x, w.z), 0) + 0.35, w.z), _q.identity(), _s.set(95, 1, 95)));
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.frustumCulled = true;
        im.visible = false;
        im.renderOrder = 4;
        this.scene.add(im);
        F.pools = im;
    }

    // the floodlight masts, approach-light stands and PAPI boxes: one merged mesh per field (seen by day too)
    buildMasts(F) {
        const b = F.base, L = F.layout;
        const parts = [];
        const pole = new THREE.CylinderGeometry(0.18, 0.28, 1, 6); pole.translate(0, 0.5, 0);
        const head = new THREE.BoxGeometry(2.6, 0.5, 1.1);
        const add = (geo, x, y, z, sx, sy, sz, yaw = 0) => { const g = geo.clone(); g.scale(sx, sy, sz); g.rotateY(yaw); g.translate(x, y, z); parts.push(g); };
        for (const f of (L && L.floods) || []) {
            const w = baseToWorld(b, f.lx, f.lz), g = Math.max(terrainHeight(w.x, w.z), 0);
            add(pole, w.x, g, w.z, 1, 20.5, 1);
            add(head, w.x, g + 20.5, w.z, 1, 1, 1, -b.heading);
        }
        // approach lights on stands over low ground; PAPI units as boxes
        for (const l of F.lights) {
            if (l.tag === 'papi') { const box = new THREE.BoxGeometry(1.4, 0.8, 0.9); box.translate(l.x, l.y - 0.3, l.z); parts.push(box); continue; }
            if (!(l.tag === 'als' || l.tag === 'als_bar' || l.tag === 'als_side' || l.tag === 'flasher')) continue;
            const g = Math.max(terrainHeight(l.x, l.z), 0), hgt = l.y - g;
            if (hgt < 1.2) continue;
            const s = new THREE.CylinderGeometry(0.06, 0.08, hgt, 4); s.translate(l.x, g + hgt / 2, l.z); parts.push(s);
        }
        if (!parts.length) return;
        const merged = mergeParts(parts);
        const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.6, metalness: 0.5 }));
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.scene.add(mesh);
        F.masts = mesh;
    }

    // searchlights: the lamps' beams (hidden until a raid at night)
    buildSearchlights(F) {
        const L = F.layout, sl = (L && L.searchlights) || [];
        if (!sl.length) return;
        const geo = new THREE.CylinderGeometry(1, 0.012, 1, 20, 1, true); geo.translate(0, 0.5, 0); // lamp at y = 0, opening upward
        const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uI: { value: 0.16 } }]);
        u.skyFogA = { value: SKY_FOG.a }; u.skyFogB = { value: SKY_FOG.b }; u.skyFogC = { value: SKY_FOG.c }; u.skyFogD = { value: SKY_FOG.d };
        const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true });
        const im = new THREE.InstancedMesh(geo, mat, sl.length);
        im.frustumCulled = false;
        im.visible = false;
        im.renderOrder = 7;
        this.scene.add(im);
        const b = F.base;
        F.beams = im;
        F.lamps = sl.map((p, i) => {
            const w = baseToWorld(b, p.lx, p.lz);
            return { pos: new THREE.Vector3(w.x, Math.max(terrainHeight(w.x, w.z), 0) + 2.2, w.z), az: i * 1.7, el: 0.7, phase: i * 2.3, rate: 0.12 + (i % 3) * 0.05, target: null, dir: new THREE.Vector3(0, 1, 0), on: 0 };
        });
    }

    // the circuits as they should be: power (the field's generator), blackout, closed runways, night
    apply(F) {
        const p = F.power, lit = F.main && !F.blackout;
        for (let r = 0; r < 3; r++) {
            const open = lit && !F.closed[r];
            for (const k of ['EDGE', 'THR', 'CL', 'TDZ', 'ALS', 'FLASH', 'PAPI']) p[rwc(r, k)] = open ? 1 : 0;
            p[rwc(r, 'X')] = lit && F.closed[r] ? 1 : 0;
        }
        const anyClosed = F.closed.some(Boolean);
        p[CIRCUIT.TAXI] = lit ? 1 : 0;
        p[CIRCUIT.STOP] = lit && anyClosed ? 1 : 0;
        p[CIRCUIT.GUARD] = lit && anyClosed ? 1 : 0;
        p[CIRCUIT.FLOOD] = lit ? 1 : 0;
        p[CIRCUIT.BEACON] = lit ? 1 : 0;
        p[CIRCUIT.OBST] = F.main ? 1 : 0; // (obstruction lights have their own supply… not with the main power gone)
        F.points.visible = this.night;
        if (F.pools) F.pools.visible = this.night && lit;
    }

    field(id) { return this.fields.get(id) || null; }
    // the field's main power (its generator), a blackout (air raid at night), a runway closed
    setPower(id, on) { const F = this.field(id); if (F && F.main !== on) { F.main = on; this.apply(F); } }
    setBlackout(id, on) { const F = this.field(id); if (F && F.blackout !== on) { F.blackout = on; this.apply(F); } }
    setClosed(id, r, closed) { const F = this.field(id); if (F && F.closed[r] !== closed) { F.closed[r] = closed; this.apply(F); } }
    setNight(on) { this.night = on; for (const F of this.fields.values()) this.apply(F); }
    lit(id) { const F = this.field(id); return !!F && F.main && !F.blackout; }

    // searchlights on / off for a field; targets: aircraft to cone (the rest sweep)
    setSearch(id, on, targets = null) { const F = this.field(id); if (F) { F.search = on; F.targets = targets; } }

    update(dt, cam) {
        this.time += dt;
        for (const F of this.fields.values()) {
            F.mat.uniforms.uTime.value = this.time;
            if (F.beams) this.updateBeams(F, dt, cam);
        }
    }

    updateBeams(F, dt, cam) {
        const want = !!(F.search && this.night);
        const near = cam ? Math.hypot(cam.x - F.base.x, cam.z - F.base.z) < 30000 : true;
        let any = false;
        const im = F.beams;
        F.lamps.forEach((l, i) => {
            l.on = Math.max(0, Math.min(1, l.on + (want ? dt / 1.5 : -dt / 0.8))); // arc lamps strike up over a second or two
            if (l.on <= 0 || !near) { im.setMatrixAt(i, _m.makeScale(0, 0, 0)); return; }
            any = true;
            // a raider low over the field: two or three lamps cone it; the others sweep the sky in slow figures
            let tgt = null;
            if (F.targets) for (const a of F.targets) { if (a && a.alive && a.pos.distanceToSquared(l.pos) < 5500 * 5500 && (i % 3 !== 2)) { tgt = a; break; } }
            l.phase += dt * l.rate;
            let want3;
            if (tgt) want3 = _v3.subVectors(tgt.pos, l.pos).normalize();
            else {
                l.az = i * 1.7 + Math.sin(l.phase) * 1.1;
                l.el = 0.75 + Math.sin(l.phase * 1.7 + i) * 0.35;
                want3 = _v3.set(Math.sin(l.az) * Math.cos(l.el), Math.sin(l.el), Math.cos(l.az) * Math.cos(l.el));
            }
            l.dir.lerp(want3, Math.min(1, dt * (tgt ? 3 : 0.8))).normalize();
            const len = 4200 * l.on, spread = 0.028 * len;
            _q.setFromUnitVectors(UP, l.dir);
            im.setMatrixAt(i, _m.compose(l.pos, _q, _s.set(spread, len, spread)));
        });
        im.visible = any;
        if (any) im.instanceMatrix.needsUpdate = true;
    }
}

// merge plain position/normal geometries (no uv needed)
function mergeParts(parts) {
    let n = 0;
    for (const g of parts) n += (g.index ? g.index.count : g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g0 of parts) {
        const g = g0.index ? g0.toNonIndexed() : g0;
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    return out;
}
