// ═══════════════════════════════════════════════════════════════
// AWACS brevity (air support, airsupport.js): the maths and the words of a controller's calls, headless.
// Multi-service tactical brevity code (ATP 1-02.1 / AFTTP 3-2.5):
//  • BRAA — bearing (from the fighter, degrees, three digits), range (nautical miles), altitude (thousands of
//    feet: "20 THOUSAND"; below 1,000 ft in hundreds, "500 FEET") and aspect: HOT (target aspect 0–30° off its
//    nose toward the fighter), FLANK (31–70°), BEAM (71–120°), DRAG (121–180°); FLANK / BEAM / DRAG take the
//    cardinal direction of the group's track ("FLANK NORTHEAST"). "ANGELS" is a FRIENDLY's altitude only.
//  • BULLSEYE — the same from the briefed reference point, with TRACK <direction> instead of an aspect.
//  • GROUP — contacts within ~3 NM of each other; fill-ins: "HEAVY" (3+), "2 CONTACTS", the type once known.
//  • ID: HOSTILE (enemy, identified), BOGEY (identity unknown), FRIENDLY, NEUTRAL; DECLARE answers with these,
//    CLEAN (no sensor information) or FURBALL (friendlies and bandits mixed within 5 NM).
//  • PICTURE (all the groups, bullseye format), BOGEY DOPE (BRAA to the nearest group), THREAT (an untargeted
//    hostile inside the briefed range), MERGED (in the visual arena), POPUP, FADED, SNAP, STROBE, MAGNUM.
// World: metres, y up, north is −z (war.js), so a true bearing is atan2(dx, −dz).
// ═══════════════════════════════════════════════════════════════

export const NM = 1852, FT = 3.28084;
const RAD = 180 / Math.PI;

// true bearing (0..360, north = −z) from a to b
export function bearing(ax, az, bx, bz) {
    return ((Math.atan2(bx - ax, -(bz - az)) * RAD) + 360) % 360;
}
export const pad3 = (deg) => String(Math.round(deg) % 360).padStart(3, '0');

// 8-point compass name for a heading in degrees
const CARD8 = ['NORTH', 'NORTHEAST', 'EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST'];
export function cardinal(deg) { return CARD8[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }

// Target aspect: the angle (0..180) between the target's track and the line from the target back to the fighter —
// 0 when it's pointing straight at him. Classified per the brevity code's bands.
export function aspectAngle(from, to, vel) {
    const tx = from.x - to.x, tz = from.z - to.z;
    const vh = Math.hypot(vel.x, vel.z), d = Math.hypot(tx, tz);
    if (vh < 1 || d < 1) return 0;
    const c = (vel.x * tx + vel.z * tz) / (vh * d);
    return Math.acos(Math.max(-1, Math.min(1, c))) * RAD;
}
export function aspectName(angle) { return angle <= 30 ? 'HOT' : angle <= 70 ? 'FLANK' : angle <= 120 ? 'BEAM' : 'DRAG'; }

// track direction (degrees) of a velocity
export function trackDeg(vel) { return ((Math.atan2(vel.x, -vel.z) * RAD) + 360) % 360; }

// the BRAA of a group (pos, vel) from a fighter at `from`: { brg, rng (NM), altFt, aspect, track (degrees),
// dir (the track's compass name) }
export function braa(from, pos, vel) {
    const brg = bearing(from.x, from.z, pos.x, pos.z);
    const rng = Math.hypot(pos.x - from.x, pos.z - from.z) / NM;
    const asp = aspectName(aspectAngle(from, pos, vel));
    const track = trackDeg(vel);
    return { brg, rng, altFt: Math.max(0, pos.y) * FT, aspect: asp, track, dir: cardinal(track) };
}

// altitude words: "20 THOUSAND", "500 FEET", "LOW" is left to the caller
export function altWords(ft) {
    if (ft < 950) return Math.max(100, Math.round(ft / 100) * 100) + ' FEET';
    return Math.round(ft / 1000) + ' THOUSAND';
}
// a friendly's altitude
export function angels(ft) { return 'ANGELS ' + Math.max(1, Math.round(ft / 1000)); }

// "BRAA 040/35, 20 THOUSAND, HOT" / "…, FLANK NORTHEAST"
export function formatBraa(b) {
    const asp = b.aspect === 'HOT' ? 'HOT' : b.aspect + ' ' + b.dir;
    return 'BRAA ' + pad3(b.brg) + '/' + Math.max(1, Math.round(b.rng)) + ', ' + altWords(b.altFt) + ', ' + asp;
}

// "BULLSEYE 230/30, 20 THOUSAND, TRACK NORTH"
export function formatBullseye(bull, pos, vel) {
    const brg = bearing(bull.x, bull.z, pos.x, pos.z);
    const rng = Math.hypot(pos.x - bull.x, pos.z - bull.z) / NM;
    const moving = Math.hypot(vel.x, vel.z) > 20;
    return 'BULLSEYE ' + pad3(brg) + '/' + Math.round(rng) + ', ' + altWords(Math.max(0, pos.y) * FT) + (moving ? ', TRACK ' + cardinal(trackDeg(vel)) : '');
}

// ── Groups: contacts within 3 NM (and 5,000 ft) of each other are one group ──
// contacts: [{ pos, vel, ... }] → [{ members, pos (centroid), vel (mean), n, hiFt, loFt }]; greedy, stable
export function groupContacts(contacts, radius = 3 * NM, dAlt = 1524) {
    const groups = [];
    for (const c of contacts) {
        let g = null;
        for (const q of groups) {
            if (Math.hypot(q.pos.x - c.pos.x, q.pos.z - c.pos.z) <= radius && Math.abs(q.pos.y - c.pos.y) <= dAlt) { g = q; break; }
        }
        if (!g) { g = { members: [], pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, n: 0, hiFt: 0, loFt: Infinity }; groups.push(g); }
        g.members.push(c);
        const k = c.n || 1;
        g.pos.x = (g.pos.x * g.n + c.pos.x * k) / (g.n + k);
        g.pos.y = (g.pos.y * g.n + c.pos.y * k) / (g.n + k);
        g.pos.z = (g.pos.z * g.n + c.pos.z * k) / (g.n + k);
        g.vel.x = (g.vel.x * g.n + c.vel.x * k) / (g.n + k);
        g.vel.y = (g.vel.y * g.n + c.vel.y * k) / (g.n + k);
        g.vel.z = (g.vel.z * g.n + c.vel.z * k) / (g.n + k);
        g.n += k;
        g.hiFt = Math.max(g.hiFt, c.pos.y * FT); g.loFt = Math.min(g.loFt, c.pos.y * FT);
    }
    return groups;
}

// fill-ins after the ID: "HEAVY, 3 CONTACTS", "2 CONTACTS", the type ("FLANKER") once it's known
export function fillIns(g) {
    const out = [];
    if (g.n >= 3) out.push('HEAVY', g.n + ' CONTACTS');
    else if (g.n === 2) out.push('2 CONTACTS');
    if (g.type) out.push(g.type);
    if (g.fast) out.push('FAST');
    return out;
}

// the whole group line: "GROUP BRAA 040/35, 20 THOUSAND, HOT, HOSTILE, 2 CONTACTS, FLANKER"
export function groupBraa(from, g, id = 'HOSTILE', label = 'GROUP') {
    return label + ' ' + formatBraa(braa(from, g.pos, g.vel)) + ', ' + id + fillIns(g).map(s => ', ' + s).join('');
}
export function groupBullseye(bull, g, id = 'HOSTILE', label = 'GROUP') {
    return label + ' ' + formatBullseye(bull, g.pos, g.vel) + ', ' + id + fillIns(g).map(s => ', ' + s).join('');
}

// Picture: "PICTURE, 2 GROUPS, NORTH GROUP BULLSEYE 010/40, 25 THOUSAND, TRACK SOUTH, HOSTILE, SOUTH GROUP …"
// (two or three groups are named by where they sit relative to each other; more are "N GROUPS" and the nearest
// three to the fighter are given). groups: as groupContacts, each with .id ('HOSTILE' | 'BOGEY')
export function pictureCall(bull, groups, from = null, max = 3) {
    if (!groups.length) return 'PICTURE CLEAN';
    if (groups.length === 1) return 'PICTURE, SINGLE GROUP ' + formatBullseye(bull, groups[0].pos, groups[0].vel) + ', ' + (groups[0].id || 'HOSTILE') + fillIns(groups[0]).map(s => ', ' + s).join('');
    let list = groups.slice();
    if (from) list.sort((a, b) => Math.hypot(a.pos.x - from.x, a.pos.z - from.z) - Math.hypot(b.pos.x - from.x, b.pos.z - from.z));
    list = list.slice(0, max);
    const names = groupNames(list);
    const parts = list.map((g, i) => names[i] + ' GROUP ' + formatBullseye(bull, g.pos, g.vel) + ', ' + (g.id || 'HOSTILE') + fillIns(g).map(s => ', ' + s).join(''));
    return 'PICTURE, ' + groups.length + ' GROUPS, ' + parts.join('; ');
}

// names for 2–3 groups by their spread: the axis they're strung out along (north–south or east–west)
export function groupNames(list) {
    if (list.length === 1) return ['SINGLE'];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const g of list) { minX = Math.min(minX, g.pos.x); maxX = Math.max(maxX, g.pos.x); minZ = Math.min(minZ, g.pos.z); maxZ = Math.max(maxZ, g.pos.z); }
    const ns = (maxZ - minZ) >= (maxX - minX);
    const order = list.map((g, i) => ({ i, k: ns ? g.pos.z : g.pos.x })).sort((a, b) => a.k - b.k);
    const words = list.length === 2 ? (ns ? ['NORTH', 'SOUTH'] : ['WEST', 'EAST']) : (ns ? ['NORTH', 'MIDDLE', 'SOUTH'] : ['WEST', 'MIDDLE', 'EAST']);
    const out = [];
    order.forEach((o, r) => { out[o.i] = words[Math.min(r, words.length - 1)]; });
    return out;
}

// ── Speech: brevity read the way a controller says it ──
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
export function digits(s) { return String(s).split('').map(c => (c >= '0' && c <= '9' ? ONES[+c] : c)).join(' '); }
// "BRAA 040/35, 20 THOUSAND, HOT, HOSTILE" → "bra, zero four zero, thirty five, twenty thousand, hot, hostile"
export function speakable(text) {
    return String(text)
        .replace(/\bBRAA\b/g, 'bra')
        .replace(/(\d{3})\/(\d+)/g, (m, b, r) => digits(b) + ', ' + r)
        .replace(/ — /g, '. ')
        .replace(/;/g, '.')
        .toLowerCase();
}

// ── DECLARE: what the controller answers for a track ──
// track: { team, known (war intel 0..3), hostileOrigin } · side: ours · friendliesNear: FURBALL
export function declare(track, side, { held = true, friendliesNear = false, neutral = false } = {}) {
    if (!held) return 'CLEAN';
    if (neutral) return 'NEUTRAL';
    if (track.team === side) return 'FRIENDLY';
    if (friendliesNear) return 'FURBALL';
    // ID criteria: identified by a sensor (type, NCTR), or no IFF answer plus a point of origin in enemy airspace
    if (track.known >= 2 || track.hostileOrigin) return 'HOSTILE';
    return 'BOGEY';
}

// NATO reporting names for the fill-in once a type is identified
export const REPORTING = {
    su35: 'FLANKER', su57: 'FELON', mig29: 'FULCRUM', mig31: 'FOXHOUND', mig25: 'FOXBAT', mig21: 'FISHBED', j20: 'FAGIN',
    j10: 'FIREBIRD', j8: 'FINBACK', su47: 'FIRKIN', a50: 'MAINSTAY', il78: 'MIDAS', tu95: 'BEAR', f5: 'TIGER', mirage: 'MIRAGE', jaguar: 'JAGUAR',
};
