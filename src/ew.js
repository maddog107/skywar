// ═══════════════════════════════════════════════════════════════
// Electronic warfare (air support, airsupport.js), headless maths:
//  • noise jamming: a jammer raises the noise in a radar's receiver. For a radar at R looking at a target, each
//    enemy jammer J adds J/N = (K / |R − J|)² · gj · gr: K the jammer's power (the range at which its main beam
//    equals the radar's own noise), gj 1 inside the jammer's pointed sector (its pods' beams) and −17 dB outside,
//    gr 1 when the jammer sits in the radar's main lobe (within 5° of the target), −30 dB in its side lobes. The
//    radar's echo falls as 1/R⁴, so its detection (and fire-control) range shrinks to R0 · (1 + ΣJ/N)^(−1/4): a
//    target closer than that is seen anyway — BURN-THROUGH. Strong stand-off jamming (ALQ-99) blanks the sector
//    behind the jammer for tens of km and cuts every radar's range through the side lobes; a self-protection pod
//    only hides its own jet until burn-through at ~R0²/K.
//  • strobes: a jammed radar shows a noise strobe along the jammer's bearing (STROBE in brevity)
//  • emitters: which war units radiate (search radars, SAM trackers, gun-dish AAA, naval radars, AWACS) and
//    what they sound like to a SIGINT receiver; dwell turns an intercept into a CONTACT, then an identification
// War space: metres, north −z; bearings are true, radians or degrees as named.
// ═══════════════════════════════════════════════════════════════
import { clamp, DEG } from './util.js';

// jammers: K (m), the pods' half-sector (rad)
export const JAMMERS = {
    alq99: { name: 'ALQ-99', K: 2500e3, half: 45 * DEG, standoff: true },    // EA-18G: three pods, a steerable sector
    khibiny: { name: 'KHIBINY', K: 200e3, half: 70 * DEG },                  // Su-35 / Su-57 self-protection
    sorbtsiya: { name: 'SORBTSIYA', K: 160e3, half: 70 * DEG },              // Su-27 family wingtip pods
    tu95: { name: 'SPS-171', K: 150e3, half: 80 * DEG },                     // the Bear's own set
};
export const MAIN_LOBE = 5 * DEG, SIDE_LOBE = 0.001, POD_BACK = 0.02;
export const JAM_FLOOR = 0.04; // (a radar is never quite blind: a strobe still gives a bearing)

// horizontal true bearing (rad) from a to b
export const bearingRad = (a, b) => Math.atan2(b.x - a.x, -(b.z - a.z));
export const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// J/N at a radar (pos) looking at target (pos) from one jammer { pos, K, brg, half }
export function jamToNoise(radar, target, jam) {
    const jx = jam.pos.x - radar.x, jy = jam.pos.y - radar.y, jz = jam.pos.z - radar.z;
    const rj = Math.max(Math.hypot(jx, jy, jz), 50);
    // the jammer's pods toward the radar
    const toRadar = Math.atan2(radar.x - jam.pos.x, -(radar.z - jam.pos.z));
    const gj = Math.abs(angleDiff(toRadar, jam.brg)) <= jam.half ? 1 : POD_BACK;
    // the radar's lobe toward the jammer while it looks at the target
    const tx = target.x - radar.x, ty = target.y - radar.y, tz = target.z - radar.z;
    const rt = Math.max(Math.hypot(tx, ty, tz), 1);
    const c = (jx * tx + jy * ty + jz * tz) / (rj * rt);
    const gr = c >= Math.cos(MAIN_LOBE) ? 1 : SIDE_LOBE;
    return (jam.K / rj) ** 2 * gj * gr;
}

// the share of its range a radar keeps against a target through all these jammers (1: none)
export function jamFactor(radar, target, jammers) {
    let jn = 0;
    for (let i = 0; i < jammers.length; i++) jn += jamToNoise(radar, target, jammers[i]);
    return jn > 0 ? Math.max(JAM_FLOOR, (1 + jn) ** -0.25) : 1;
}

// burn-through range (m) of a radar with range R0 against a self-screening jammer of power K
export const burnThrough = (R0, K) => R0 * R0 / K;

// noise strobes on a radar: the bearings (rad) of jammers it hears above its noise in the main lobe (so it
// shows them as strobes when its beam sweeps across them), with their strength
export function strobes(radar, jammers, out = []) {
    out.length = 0;
    for (const j of jammers) {
        const jn = jamToNoise(radar, j.pos, j);
        if (jn > 1) out.push({ brg: bearingRad(radar, j.pos), jn, jam: j });
    }
    return out;
}

// ═════════════ Emitters ═════════════
// What a unit radiates: { kind, name (what SIGINT calls it), power (m: how far out an intercept is possible),
// hot (SAM fire control, a HARM's favourite) } or null
const SIG = {
    radar: { kind: 'search', name: 'P-37 BAR LOCK', power: 260000 },
    tps75: { kind: 'search', name: 'AN/TPS-75', power: 260000 },
    'sam-radar': { kind: 'track', name: 'SAM FIRE CONTROL RADAR', power: 180000, hot: true },
    sam: { kind: 'track', name: 'SA-6 STRAIGHT FLUSH', power: 150000, hot: true },
    msam: { kind: 'track', name: 'SA-8 LAND ROLL', power: 110000, hot: true },
    spaag: { kind: 'aaa', name: 'ZSU-23-4 GUN DISH', power: 60000 },
    ship: { kind: 'naval', name: 'TOP PLATE NAVAL RADAR', power: 240000 },
    carrier: { kind: 'naval', name: 'SKY WATCH NAVAL RADAR', power: 260000 },
    awacs: { kind: 'awacs', name: 'SHMEL-M (A-50)', power: 320000 },
};
export function emitterOf(u, rec) {
    if (!u || !u.alive || u.emitting === false) return null;
    const cls = rec ? rec.cls : u.cls;
    if (u.sigint) return u.sigint; // a plug-in's own signature
    if (cls === 'radar') return u.team === 'blue' ? SIG.tps75 : SIG.radar;
    if (cls === 'sam-radar') return SIG['sam-radar'];
    if (cls === 'sam') return u.type === 'msam' ? SIG.msam : SIG.sam;
    if (cls === 'aaa' && u.type === 'spaag') return SIG.spaag;
    if ((cls === 'ship' || cls === 'carrier') && u.team !== 'neutral') return cls === 'carrier' ? SIG.carrier : SIG.ship;
    if ((cls === 'aircraft' || cls === 'awacs') && u.radarRange > 100000) return SIG.awacs;
    return null;
}

// SIGINT dwell: seconds of intercept before a fix (CONTACT) and an identification, by the emitter's strength and
// how far away it is (a strong search radar is fixed in seconds; a quiet tracker far off takes a minute)
export function sigintDwell(em, d) {
    const k = clamp(d / em.power, 0.05, 1);
    return { fix: 3 + 10 * k, ident: 14 + 40 * k };
}

// A SIGINT receiver hears an emitter: in range, above the radio horizon and not behind terrain (ground: the
// emitter's antenna ~10 m up). los(a, b) → true when nothing's in the way.
export function sigintHears(rx, em, emPos, groundAt, los) {
    const d = Math.hypot(emPos.x - rx.x, emPos.y - rx.y, emPos.z - rx.z);
    if (d > em.power) return false;
    const h1 = Math.max(rx.y - Math.max(groundAt(rx.x, rx.z), 0), 0) + 10;
    const h2 = Math.max(emPos.y - Math.max(groundAt(emPos.x, emPos.z), 0), 0) + 10;
    if (d > 4120 * (Math.sqrt(h1) + Math.sqrt(h2))) return false;
    return los(rx, emPos);
}

// the error of a SIGINT fix (m): large at first, shrinking with dwell (the bearing cuts cross as the platform moves)
export function fixError(d, dwell, need) { return clamp(d * 0.025, 300, 3000) * clamp(1 - dwell / Math.max(need, 1), 0.08, 1); }

// ═════════════ HARM ═════════════
// AGM-88 at game scale (the theatre is compressed: SAMs engage inside ~7.5 km, their radars see 60-90 km): a
// long motor, low drag, a wide seeker that homes on the emitter and flies on to where it last radiated
export const HARM = { speed: 760, boost: 7, accelBoost: 150, turnG: 18, life: 60, lockTime: 0.6, lockCone: 0.5, range: 32000, prox: 14, damage: 170, navN: 3, splash: 22, drag: 0.28, radar: true, scale: 1.45, arm: true };
// can a HARM go at this emitter from here? (range, off the nose, and it must be radiating)
export function harmShot(from, fwd, target, em, range = HARM.range) {
    if (!em) return { ok: false, why: 'NOT RADIATING' };
    const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return { ok: false, why: 'OUT OF RANGE', d };
    const off = Math.acos(clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(d, 1), -1, 1));
    if (off > 50 * DEG) return { ok: false, why: 'OFF BORESIGHT', d, off };
    return { ok: true, d, off };
}
