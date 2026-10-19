// ═══════════════════════════════════════════════════════════════
// Stores: the real weapons each type carries, by loadout
//  • CLASSES: the weapon slots X cycles through (the ones the jet carries): IR missile, radar missile, very long
//    range missile, anti-radiation, air-to-ground, anti-ship, cruise missile, rockets, guided bombs, bombs, the
//    X-100's bunker busters. Each keeps its count in its own field on the aircraft (ac.missiles, ac.lrm, ...) and
//    says what it can lock: aircraft, ground targets, ships or a radar that's transmitting.
//  • STORES: the catalogue (AIM-9X, R-73, AIM-120D, AIM-54, R-37M, Meteor, HARM, Maverick, Harpoon, GBU-12, JDAM,
//    ...): real names and sizes and how each behaves in weapons.js. Its seeker:
//      ir     heat seeker: flares can pull it off, less so a modern one (irccm); blind through cloud
//      sarh   semi-active radar (AIM-7, R-27, R-40): rides the launcher's radar — turn away and it goes dumb
//      arh    active radar (AIM-120, R-77, Meteor): fire and forget; chaff and the notch (beaming) can break it
//             (eccm: how well it resists)
//      arm    anti-radiation (HARM): homes on a transmitting radar; one that shuts down leaves it the last fix
//      tv     TV / imaging IR (Maverick, Kh-29T): fire and forget, but it can't see through cloud
//      laser  semi-active laser (Paveway, Hellfire, KAB-500L): the launcher's pod keeps the spot on the target
//             all the way down — the jet must stay alive, in sight of it, and out of the cloud
//      gps    satellite / inertial (JDAM, SDB, cruise missiles): any weather, but it flies to where the target
//             WAS when it was released
//      mmw    millimetre-wave radar (Brimstone): fire and forget in any weather
//    and how it flies (profile): straight at it; 'loft' (climbs high to go far: AIM-54, R-37M); 'skim' (an
//    anti-ship missile at wave-top height, 'popup' to dive on the ship at the end: Harpoon); 'cruise' (terrain
//    following, then a pop-up and a dive: JASSM, Storm Shadow, Kh-101); 'top' (climbs, then down onto the roof
//    of the target: Hellfire, Brimstone). Kinematics are game.js / weapons.js units (m, s, G) on the
//    WEAPONS.missile scale; warheads on the Mk 82 = 220 scale.
//  • LOADOUTS: per type, what it carries on AIR SUPERIORITY / BALANCED / STRIKE (game.js rearm), built from its
//    real stations and the weapons its air force flies with; the counts are a little generous where the real jet
//    would carry very few. The AI flies with its air-to-air load (aircraft.js).
// ═══════════════════════════════════════════════════════════════
import { WEAPONS, AIRCRAFT } from './config.js';
import { HARM } from './ew.js';

// slot classes, in the order X steps through them. kind: weapons.js fireMissile's kind (drop: a bomb, dropBomb);
// vs: what it can lock ('air' | 'ground' | 'ship' | 'emitter'; null: unguided)
export const CLASSES = [
    { key: 'srm', label: 'SRM', name: 'IR MISSILE', ammo: 'missiles', kind: 'aam', vs: 'air' },
    { key: 'lrm', label: 'LRM', name: 'RADAR MISSILE', ammo: 'lrm', kind: 'lrm', vs: 'air' },
    { key: 'xlr', label: 'XLR', name: 'LONG-RANGE MISSILE', ammo: 'xlrm', kind: 'xlr', vs: 'air' },
    { key: 'arm', label: 'ARM', name: 'ANTI-RADIATION MISSILE', ammo: 'harms', kind: 'arm', vs: 'emitter' },
    { key: 'agm', label: 'AGM', name: 'AIR-TO-GROUND MISSILE', ammo: 'agms', kind: 'agm', vs: 'ground' },
    { key: 'ashm', label: 'ASM', name: 'ANTI-SHIP MISSILE', ammo: 'ashms', kind: 'ashm', vs: 'ship' },
    { key: 'alcm', label: 'ALCM', name: 'CRUISE MISSILE', ammo: 'alcms', kind: 'alcm', vs: 'ground' },
    { key: 'rkt', label: 'RKT', name: 'ROCKET POD', ammo: 'rockets', kind: 'rkt', vs: null },
    { key: 'gbu', label: 'GBU', name: 'GUIDED BOMB', ammo: 'gbus', drop: true, vs: 'ground' },
    { key: 'bomb', label: 'BMB', name: 'BOMB', ammo: 'bombs', drop: true, vs: null },
    { key: 'buster', label: 'BBU', name: 'BUNKER BUSTER', ammo: 'busters', drop: true, vs: null },
];
export const CLASS = Object.fromEntries(CLASSES.map(c => [c.key, c]));
export const AMMO_FIELDS = CLASSES.map(c => c.ammo);
// fireMissile's kind → its class
const KIND_CLASS = { aam: 'srm', lrm: 'lrm', xlr: 'xlr', arm: 'arm', agm: 'agm', ashm: 'ashm', alcm: 'alcm', rkt: 'rkt' };
export const classOfKind = (kind) => KIND_CLASS[kind] || null;

// ── Class baselines (each store is one of these with its own numbers over it) ──
const IR = { ...WEAPONS.missile, seeker: 'ir', irccm: 0, len: 2.87, dia: 0.127, shape: 'aim9', color: 0xc9ccc6 };
const RADAR = { ...WEAPONS.lrm, seeker: 'arh', eccm: 0.5, len: 3.66, dia: 0.178, shape: 'aam', color: 0xd9dad4 };
const XLR = { ...RADAR, profile: 'loft', loft: 0.18, shape: 'big' };
// (a long shot is lofted: up over the hills between and down onto the radar)
const ARM = { ...HARM, seeker: 'arm', profile: 'loft', loft: 0.15, eccm: 1, len: 4.17, dia: 0.254, shape: 'sparrow', color: 0xd3d4ce };
// air-to-ground: a rocket-boosted glide to a ground target, a heavy warhead that wrecks armour
const AGM = { seeker: 'tv', speed: 300, boost: 4, accelBoost: 75, drag: 0.5, turnG: 14, life: 40, minSpeed: 110, lockTime: 1.4, lockCone: 0.9, range: 9000, prox: 5, damage: 260, splash: 18, navN: 3.5, kg: 57, len: 2.49, dia: 0.305, shape: 'agm', color: 0xc8c9bf, ground: true };
// anti-ship: a turbojet at wave-top height (profile 'skim'), radar terminal homing; ships take a missile at 2.5×
// (naval.js), so 190 sinks a destroyer, and a carrier takes three
const ASHM = { seeker: 'arh', profile: 'skim', alt: 8, terminal: 3000, popAlt: 300, cruise: 240, sustain: 45, boost: 0.6, accelBoost: 20, drag: 1, turnG: 10, life: 150, minSpeed: 90, lockTime: 2, lockCone: 0.7, range: 28000, prox: 6, damage: 190, splash: 20, navN: 3, radar: true, eccm: 0.6, kg: 220, ciws: 0.45, len: 3.84, dia: 0.343, shape: 'cruise', color: 0xd4d5cf, ground: true };
// cruise missile: terrain following at 60 m to a fixed aim point, a pop-up and a dive onto it
const ALCM = { ...ASHM, seeker: 'gps', profile: 'cruise', alt: 60, terminal: 3500, popup: true, popAlt: 380, turnG: 12, cruise: 250, range: 40000, life: 220, damage: 640, splash: 40, kg: 450, crater: 1.3, lockCone: -1, lockTime: 2.5, radar: false, ciws: 0.3, len: 4.27, dia: 0.55, color: 0x6f746f };
const ROCKET = { ...WEAPONS.rkt, salvo: 4, len: 1.06, dia: 0.07, shape: 'rocket', color: 0xd6d6cf };
// guided bombs: a bomb with fins that fly it (lift: G it can pull at 250 m/s; ld: 1 / lift-to-drag: a lower one
// glides further)
const GBU = { ...WEAPONS.bomb, unguided: false, seeker: 'laser', guided: true, lift: 1.0, ld: 0.33, lockTime: 1.2, lockCone: 0.2, range: 14000, kg: 87, fx: 2.4, len: 3.27, dia: 0.273, shape: 'pave', color: 0x5d6650 };
const BOMB = { ...WEAPONS.bomb, kg: 87, fx: 2.4, len: 2.21, dia: 0.273, shape: 'mk', color: 0x5d6650 };
// a 1000 lb / 2000 lb warhead over a 500 lb one
const W1000 = { damage: 360, splash: 70, kg: 202, fx: 2.9, crater: 1.2 };
const W2000 = { damage: 560, splash: 85, kg: 429, fx: 3.4, crater: 1.45 };
// a cluster bomb: the case opens `agl` m up and scatters `n` bomblets over a `spread` m circle
const CLUSTER = (o) => ({ ...BOMB, damage: 40, splash: 0, kg: 6, fx: 1.2, shape: 'cbu', cluster: { n: 30, dmg: 45, r: 13, spread: 55, agl: 300, ...o } });

const S = (base, cls, from, o) => ({ ...base, cls, from, ...o });
// from: whose weapon it is (the loadout test checks a type only carries its own side's and its allies')
export const STORES = {
    // ── IR missiles ──
    aim9p: S(IR, 'srm', 'USA', { name: 'AIM-9P SIDEWINDER', short: 'AIM-9P', range: 3400, turnG: 26, lockCone: 0.94, lockTime: 1.3, irccm: -0.3, damage: 85, len: 3.07 }),
    aim9l: S(IR, 'srm', 'USA', { name: 'AIM-9L SIDEWINDER', short: 'AIM-9L', range: 3800, turnG: 30, lockCone: 0.92, irccm: -0.1 }),
    aim9m: S(IR, 'srm', 'USA', { name: 'AIM-9M SIDEWINDER', short: 'AIM-9M', range: 4000 }),
    // the off-boresight ones: a helmet sight and thrust vectoring (tvc: it turns hard even when slow)
    aim9x: S(IR, 'srm', 'USA', { name: 'AIM-9X SIDEWINDER', short: 'AIM-9X', range: 4600, turnG: 42, lockCone: 0.5, lockTime: 0.9, irccm: 0.55, tvc: true, len: 3.02, shape: 'stub', color: 0xb9bcb8 }),
    r60: S(IR, 'srm', 'RUS', { name: 'R-60M APHID', short: 'R-60M', range: 2800, turnG: 38, lockCone: 0.92, lockTime: 0.9, irccm: -0.1, damage: 70, prox: 12, len: 2.09, dia: 0.12, shape: 'r73', color: 0xe4e4de }),
    r73: S(IR, 'srm', 'RUS', { name: 'R-73 ARCHER', short: 'R-73', range: 4400, turnG: 40, lockCone: 0.6, lockTime: 1.0, irccm: 0.3, tvc: true, len: 2.9, dia: 0.17, shape: 'r73', color: 0xe4e4de }),
    r74: S(IR, 'srm', 'RUS', { name: 'R-74M', short: 'R-74M', range: 5000, turnG: 42, lockCone: 0.45, lockTime: 0.9, irccm: 0.5, tvc: true, len: 2.9, dia: 0.17, shape: 'r73', color: 0xd8d9d3 }),
    pl8: S(IR, 'srm', 'CHN', { name: 'PL-8', short: 'PL-8', range: 4000, lockCone: 0.92, irccm: 0.05, len: 2.99, dia: 0.16, shape: 'r73', color: 0xdedfd9 }),
    pl10: S(IR, 'srm', 'CHN', { name: 'PL-10', short: 'PL-10', range: 4800, turnG: 42, lockCone: 0.5, lockTime: 0.9, irccm: 0.55, tvc: true, len: 3.0, dia: 0.16, shape: 'stub', color: 0xd2d3cd }),
    magic2: S(IR, 'srm', 'FRA', { name: 'R.550 MAGIC 2', short: 'MAGIC 2', range: 3800, turnG: 34, lockCone: 0.88, lockTime: 1.0, irccm: 0.1, len: 2.75, dia: 0.157, shape: 'r73', color: 0xe8e8e2 }),
    micair: S(IR, 'srm', 'FRA', { name: 'MICA IR', short: 'MICA IR', range: 6500, boost: 3.5, life: 18, turnG: 38, lockCone: 0.7, irccm: 0.5, tvc: true, len: 3.1, dia: 0.16, shape: 'aam', color: 0xe6e6e0 }),
    iris_t: S(IR, 'srm', 'EU', { name: 'IRIS-T', short: 'IRIS-T', range: 5000, turnG: 44, lockCone: 0.5, lockTime: 0.9, irccm: 0.6, tvc: true, len: 2.94, shape: 'aim9', color: 0xc6c9c4 }),
    aam5: S(IR, 'srm', 'JPN', { name: 'AAM-5', short: 'AAM-5', range: 4800, turnG: 42, lockCone: 0.5, lockTime: 0.9, irccm: 0.55, tvc: true, len: 3.1, shape: 'stub', color: 0xd4d5cf }),

    // ── Radar missiles ──
    aim7m: S(RADAR, 'lrm', 'USA', { name: 'AIM-7M SPARROW', short: 'AIM-7M', seeker: 'sarh', range: 7500, boost: 3.5, drag: 0.9, life: 20, turnG: 25, lockTime: 2.0, eccm: 0.3, damage: 105, dia: 0.203, shape: 'sparrow' }),
    aim120c: S(RADAR, 'lrm', 'USA', { name: 'AIM-120C AMRAAM', short: 'AIM-120C', eccm: 0.55 }),
    aim120d: S(RADAR, 'lrm', 'USA', { name: 'AIM-120D AMRAAM', short: 'AIM-120D', range: 11000, boost: 5, drag: 0.75, life: 26, eccm: 0.65 }),
    r27r: S(RADAR, 'lrm', 'RUS', { name: 'R-27ER ALAMO', short: 'R-27ER', seeker: 'sarh', range: 9500, boost: 5, drag: 0.8, life: 24, turnG: 22, lockTime: 2.2, eccm: 0.3, damage: 110, len: 4.78, dia: 0.26, shape: 'sparrow', color: 0xe4e4de }),
    r77: S(RADAR, 'lrm', 'RUS', { name: 'R-77-1 ADDER', short: 'R-77-1', range: 9000, turnG: 26, len: 3.71, dia: 0.2, shape: 'grid', color: 0xd9dad3 }),
    r77m: S(RADAR, 'lrm', 'RUS', { name: 'R-77M', short: 'R-77M', range: 12000, boost: 5.5, drag: 0.65, life: 28, turnG: 26, eccm: 0.6, len: 3.7, dia: 0.2, shape: 'grid', color: 0xcfd0c9 }),
    r40: S(RADAR, 'lrm', 'RUS', { name: 'R-40RD ACRID', short: 'R-40RD', seeker: 'sarh', range: 11000, boost: 6, drag: 0.55, life: 30, turnG: 12, lockTime: 2.8, eccm: 0.2, damage: 150, prox: 22, len: 6.2, dia: 0.31, shape: 'big', color: 0xe4e4de }),
    pl11: S(RADAR, 'lrm', 'CHN', { name: 'PL-11', short: 'PL-11', seeker: 'sarh', range: 7500, boost: 3.5, drag: 0.9, life: 20, turnG: 24, lockTime: 2.0, eccm: 0.3, damage: 100, dia: 0.208, shape: 'sparrow', color: 0xdedfd9 }),
    pl12: S(RADAR, 'lrm', 'CHN', { name: 'PL-12', short: 'PL-12', range: 9500, len: 3.85, dia: 0.203, color: 0xdedfd9 }),
    pl15: S(RADAR, 'lrm', 'CHN', { name: 'PL-15', short: 'PL-15', range: 13000, boost: 5.5, accelBoost: 155, drag: 0.6, life: 30, eccm: 0.65, len: 4.0, dia: 0.203, color: 0xd2d3cd }),
    // a throttleable ramjet: it keeps pushing (sustain) and arrives fast at long range — little room to run.
    // (no smoke trail once the booster's out)
    meteor: S(RADAR, 'lrm', 'EU', { name: 'MBDA METEOR', short: 'METEOR', range: 13000, boost: 2.5, sustain: 58, sustainT: 24, vmax: 1000, drag: 0.7, life: 35, turnG: 30, eccm: 0.75, ramjet: true, shape: 'stub', color: 0xd9dad4 }),
    aam4b: S(RADAR, 'lrm', 'JPN', { name: 'AAM-4B', short: 'AAM-4B', range: 11000, boost: 5, drag: 0.75, life: 26, eccm: 0.6, dia: 0.203, shape: 'sparrow' }),

    // ── Very long range: lofted shots at bombers, AWACS, a fighter that isn't watching ──
    aim54: S(XLR, 'xlr', 'USA', { name: 'AIM-54C PHOENIX', short: 'AIM-54C', range: 16000, boost: 6, accelBoost: 170, drag: 0.45, life: 45, turnG: 17, lockTime: 3, eccm: 0.4, damage: 140, prox: 24, len: 3.96, dia: 0.38 }),
    r37: S(XLR, 'xlr', 'RUS', { name: 'R-37M AXEHEAD', short: 'R-37M', range: 20000, boost: 7, accelBoost: 170, drag: 0.4, life: 50, turnG: 15, lockTime: 3.2, loft: 0.2, damage: 150, prox: 24, len: 4.2, dia: 0.38, color: 0xe4e4de }),

    // ── Anti-radiation ──
    agm88: S(ARM, 'arm', 'USA', { name: 'AGM-88 HARM', short: 'HARM' }),
    kh31p: S(ARM, 'arm', 'RUS', { name: 'KH-31P KRYPTON', short: 'KH-31P', boost: 3, accelBoost: 160, sustain: 55, sustainT: 22, vmax: 1000, range: 30000, life: 45, damage: 180, ramjet: true, len: 4.7, dia: 0.36, shape: 'cruise', color: 0xd6d7d0 }),

    // ── Air-to-ground missiles ──
    agm65: S(AGM, 'agm', 'USA', { name: 'AGM-65 MAVERICK', short: 'MAVERICK' }),
    hellfire: S(AGM, 'agm', 'USA', { name: 'AGM-114 HELLFIRE', short: 'HELLFIRE', seeker: 'laser', profile: 'top', range: 8000, boost: 3, accelBoost: 120, turnG: 18, damage: 170, splash: 12, kg: 9, len: 1.63, dia: 0.178, shape: 'stub', color: 0x5f6b55 }),
    brimstone: S(AGM, 'agm', 'EU', { name: 'BRIMSTONE', short: 'BRIMSTONE', seeker: 'mmw', profile: 'top', range: 10000, boost: 3, accelBoost: 120, turnG: 18, damage: 180, splash: 12, kg: 9, len: 1.8, dia: 0.178, shape: 'stub', color: 0x8e9389 }),
    kh29t: S(AGM, 'agm', 'RUS', { name: 'KH-29T KEDGE', short: 'KH-29T', range: 10000, damage: 360, splash: 26, kg: 116, len: 3.9, dia: 0.38, shape: 'r73', color: 0xd7d8d1 }),
    kh38: S(AGM, 'agm', 'RUS', { name: 'KH-38ML', short: 'KH-38ML', seeker: 'laser', range: 12000, boost: 5, damage: 300, splash: 22, kg: 80, len: 4.2, dia: 0.31, shape: 'agm', color: 0xcdcfc8 }),
    as30l: S(AGM, 'agm', 'FRA', { name: 'AS-30L', short: 'AS-30L', seeker: 'laser', range: 10000, damage: 320, splash: 22, kg: 85, len: 3.65, dia: 0.342, shape: 'agm', color: 0xd6d7cf }),

    // ── Anti-ship ──
    agm84: S(ASHM, 'ashm', 'USA', { name: 'AGM-84D HARPOON', short: 'HARPOON', popup: true }),
    am39: S(ASHM, 'ashm', 'FRA', { name: 'AM39 EXOCET', short: 'EXOCET', cruise: 300, range: 26000, damage: 170, len: 4.69, dia: 0.348 }),
    kh35: S(ASHM, 'ashm', 'RUS', { name: 'KH-35U ZVEZDA', short: 'KH-35U', cruise: 270, damage: 165, len: 3.85, dia: 0.42 }),
    asm2: S(ASHM, 'ashm', 'JPN', { name: 'TYPE 93 ASM-2', short: 'ASM-2', cruise: 285, damage: 180, len: 3.95, dia: 0.35 }),
    rbs15: S(ASHM, 'ashm', 'SWE', { name: 'RBS 15F', short: 'RBS 15', cruise: 270, range: 30000, damage: 200, len: 4.35, dia: 0.5, color: 0x8e9389 }),
    // supersonic and low: the CIWS hardly has time
    kh31a: S(ASHM, 'ashm', 'RUS', { name: 'KH-31A', short: 'KH-31A', cruise: 700, sustain: 60, boost: 3, accelBoost: 150, alt: 12, range: 25000, life: 60, damage: 150, ciws: 0.2, ramjet: true, len: 4.7, dia: 0.36 }),

    // ── Cruise missiles ──
    jassm: S(ALCM, 'alcm', 'USA', { name: 'AGM-158 JASSM', short: 'JASSM' }),
    scalp: S(ALCM, 'alcm', 'FRA', { name: 'SCALP EG', short: 'SCALP', cruise: 270, damage: 700, len: 5.1, dia: 0.48 }),
    stormshadow: S(ALCM, 'alcm', 'EU', { name: 'STORM SHADOW', short: 'STORM SHADOW', cruise: 270, damage: 700, len: 5.1, dia: 0.48 }),
    kh101: S(ALCM, 'alcm', 'RUS', { name: 'KH-101', short: 'KH-101', cruise: 230, range: 45000, life: 260, damage: 660, len: 7.45, dia: 0.74, color: 0x9a9f98 }),

    // ── Rockets ──
    hydra: S(ROCKET, 'rkt', 'USA', { name: 'HYDRA 70 (LAU-61)', short: 'HYDRA 70' }),
    zuni: S(ROCKET, 'rkt', 'USA', { name: 'ZUNI 5-IN (LAU-10)', short: 'ZUNI', damage: 70, splash: 40, salvo: 2, len: 2.79, dia: 0.127 }),
    s5: S(ROCKET, 'rkt', 'RUS', { name: 'S-5M (UB-16)', short: 'S-5', damage: 26, splash: 24, salvo: 6, len: 0.88, dia: 0.057 }),
    s8: S(ROCKET, 'rkt', 'RUS', { name: 'S-8KOM (B-8M1)', short: 'S-8', damage: 42, splash: 34, len: 1.57, dia: 0.08 }),
    sneb: S(ROCKET, 'rkt', 'FRA', { name: 'SNEB 68 MM (JL-100)', short: 'SNEB', damage: 30, splash: 28, salvo: 6, len: 0.91, dia: 0.068 }),
    crv7: S(ROCKET, 'rkt', 'EU', { name: 'CRV7 (LAU-5003)', short: 'CRV7', accelBoost: 520, damage: 40 }),
    rkt57: S(ROCKET, 'rkt', 'CHN', { name: 'TYPE 57-2 57 MM', short: '57 MM', damage: 26, splash: 24, salvo: 6, len: 0.88, dia: 0.057 }),
    rkt90: S(ROCKET, 'rkt', 'CHN', { name: 'TYPE 90-1 90 MM', short: '90 MM', damage: 40, splash: 32, len: 1.7, dia: 0.09 }),

    // ── Guided bombs ──
    gbu12: S(GBU, 'gbu', 'USA', { name: 'GBU-12 PAVEWAY II', short: 'GBU-12' }),
    gbu16: S(GBU, 'gbu', 'USA', { name: 'GBU-16 PAVEWAY II', short: 'GBU-16', ...W1000, len: 3.7, dia: 0.36 }),
    gbu10: S(GBU, 'gbu', 'USA', { name: 'GBU-10 PAVEWAY II', short: 'GBU-10', ...W2000, len: 4.32, dia: 0.46 }),
    pw2k: S(GBU, 'gbu', 'EU', { name: 'PAVEWAY II 1000 LB', short: 'PAVEWAY II', ...W1000, len: 3.7, dia: 0.36, color: 0x5f6458 }),
    // laser, falling back to GPS on the spot it last had
    pw4: S(GBU, 'gbu', 'EU', { name: 'PAVEWAY IV', short: 'PAVEWAY IV', seeker: 'laser', gpsBackup: true, damage: 230, lift: 1.3, ld: 0.25, range: 18000, color: 0x5f6458 }),
    gbu38: S(GBU, 'gbu', 'USA', { name: 'GBU-38 JDAM', short: 'GBU-38', seeker: 'gps', lift: 1.4, ld: 0.22, range: 20000, len: 2.38, shape: 'jdam' }),
    gbu32: S(GBU, 'gbu', 'USA', { name: 'GBU-32 JDAM', short: 'GBU-32', seeker: 'gps', ...W1000, lift: 1.4, ld: 0.22, range: 20000, len: 3.03, dia: 0.36, shape: 'jdam', color: 0x7d827b }),
    gbu31: S(GBU, 'gbu', 'USA', { name: 'GBU-31 JDAM', short: 'GBU-31', seeker: 'gps', ...W2000, lift: 1.4, ld: 0.22, range: 22000, len: 3.88, dia: 0.46, shape: 'jdam' }),
    // the Small Diameter Bomb: a 250 lb glider on pop-out wings; a small, precise warhead
    gbu39: S(GBU, 'gbu', 'USA', { name: 'GBU-39 SMALL DIAMETER BOMB', short: 'GBU-39 SDB', seeker: 'gps', damage: 170, splash: 24, kg: 17, fx: 1.6, lift: 2.2, ld: 0.1, range: 40000, len: 1.8, dia: 0.19, shape: 'sdb', color: 0x7d827b }),
    kab500l: S(GBU, 'gbu', 'RUS', { name: 'KAB-500L', short: 'KAB-500L', damage: 400, splash: 72, kg: 195, fx: 2.9, crater: 1.2, len: 3.05, dia: 0.4, shape: 'kab', color: 0x8c9188 }),
    kab500s: S(GBU, 'gbu', 'RUS', { name: 'KAB-500S-E', short: 'KAB-500S', seeker: 'gps', damage: 400, splash: 72, kg: 195, fx: 2.9, crater: 1.2, lift: 1.3, ld: 0.25, range: 20000, len: 3.0, dia: 0.4, shape: 'kab', color: 0x8c9188 }),
    lt2: S(GBU, 'gbu', 'CHN', { name: 'LT-2', short: 'LT-2', damage: 400, splash: 72, kg: 195, fx: 2.9, crater: 1.2, len: 3.4, dia: 0.38, shape: 'kab', color: 0x7f857b }),
    ls6: S(GBU, 'gbu', 'CHN', { name: 'LS-6', short: 'LS-6', seeker: 'gps', damage: 400, splash: 72, kg: 195, fx: 2.9, crater: 1.2, lift: 2.0, ld: 0.12, range: 40000, len: 3.6, dia: 0.38, shape: 'sdb', color: 0x7f857b }),
    // a GPS bomb with a rocket in the tail: further still
    aasm: S(GBU, 'gbu', 'FRA', { name: 'AASM HAMMER', short: 'HAMMER', seeker: 'gps', damage: 240, boost: 3, thrust: 45, lift: 1.8, ld: 0.14, range: 35000, len: 3.1, dia: 0.3, shape: 'jdam', color: 0x7d827b }),

    // ── Bombs ──
    mk82: S(BOMB, 'bomb', 'USA', { name: 'MK-82 BOMB', short: 'MK-82' }),
    mk84: S(BOMB, 'bomb', 'USA', { name: 'MK-84 BOMB', short: 'MK-84', ...W2000, drag: 0.011, len: 3.28, dia: 0.457 }),
    fab500: S(BOMB, 'bomb', 'RUS', { name: 'FAB-500M-62', short: 'FAB-500', damage: 500, splash: 80, kg: 300, fx: 3.2, crater: 1.35, len: 2.47, dia: 0.4, shape: 'fab', color: 0x8c9188 }),
    ofab250: S(BOMB, 'bomb', 'RUS', { name: 'OFAB-250-270', short: 'OFAB-250', damage: 240, splash: 58, kg: 97, fx: 2.5, len: 1.96, dia: 0.325, shape: 'fab', color: 0x8c9188 }),
    samp250: S(BOMB, 'bomb', 'FRA', { name: 'SAMP 250', short: 'SAMP 250', damage: 230, splash: 56, kg: 100, len: 2.4, dia: 0.35, color: 0x6c7062 }),
    type250: S(BOMB, 'bomb', 'CHN', { name: 'TYPE 250-3', short: '250-3', damage: 230, splash: 55, kg: 100, len: 1.95, dia: 0.32, shape: 'fab', color: 0x7f857b }),
    cbu87: S(CLUSTER(), 'bomb', 'USA', { name: 'CBU-87 CLUSTER BOMB', short: 'CBU-87', len: 2.34, dia: 0.39 }),
    bl755: S(CLUSTER({ n: 26, spread: 50, agl: 200 }), 'bomb', 'EU', { name: 'BL755 CLUSTER BOMB', short: 'BL755', len: 2.45, dia: 0.42, color: 0x5f6458 }),
    rbk500: S(CLUSTER({ n: 30, dmg: 50, r: 11, spread: 60, agl: 400 }), 'bomb', 'RUS', { name: 'RBK-500 PTAB', short: 'RBK-500', len: 2.5, dia: 0.45, color: 0x8c9188 }),
    // the X-100's own (config.js: its `bomb` and WEAPONS.buster)
    mk84x: S(BOMB, 'bomb', 'SKYWAR', { short: 'MK-84X', ...AIRCRAFT.x100.bomb, mega: true, len: 4.2, dia: 0.62, color: 0x24262a }),
    gbu57x: S(WEAPONS.buster, 'buster', 'SKYWAR', { short: 'GBU-57X', shape: 'buster', len: 6.2, dia: 0.8 }),
};
for (const [id, s] of Object.entries(STORES)) s.id = id;

// ── Who uses what ──
// the weapons a side's types carry besides their own (an F-2 drops US bombs, a Gripen fires a Meteor)
export const ALLIES = {
    USA: ['USA'], RUS: ['RUS'], CHN: ['CHN'], FRA: ['FRA', 'EU'], EU: ['EU', 'USA'], SWE: ['SWE', 'EU', 'USA'],
    JPN: ['JPN', 'USA'], SKYWAR: ['SKYWAR', 'USA', 'EU', 'RUS', 'CHN', 'FRA', 'SWE', 'JPN'], CAN: ['CAN', 'USA'],
};
// what a mission that hands a type stores its loadouts don't have (missions.js: rockets and bombs) gives it
const DEFAULTS = {
    USA: { srm: 'aim9m', lrm: 'aim120c', xlr: 'aim54', arm: 'agm88', agm: 'agm65', ashm: 'agm84', alcm: 'jassm', rkt: 'hydra', gbu: 'gbu12', bomb: 'mk82' },
    RUS: { srm: 'r73', lrm: 'r77', xlr: 'r37', arm: 'kh31p', agm: 'kh29t', ashm: 'kh35', alcm: 'kh101', rkt: 's8', gbu: 'kab500l', bomb: 'ofab250' },
    CHN: { srm: 'pl8', lrm: 'pl12', rkt: 'rkt90', gbu: 'lt2', bomb: 'type250' },
    FRA: { srm: 'magic2', lrm: 'meteor', agm: 'as30l', ashm: 'am39', alcm: 'scalp', rkt: 'sneb', gbu: 'aasm', bomb: 'samp250' },
    EU: { srm: 'iris_t', lrm: 'meteor', agm: 'brimstone', alcm: 'stormshadow', rkt: 'crv7', gbu: 'pw4', bomb: 'bl755' },
    SWE: { srm: 'iris_t', lrm: 'meteor', ashm: 'rbs15', gbu: 'gbu12', bomb: 'mk82' },
    JPN: { srm: 'aam5', lrm: 'aam4b', ashm: 'asm2', gbu: 'gbu38', bomb: 'mk82' },
};

// ── Loadouts: 'id count, id count, ...' per preset ──
// (sources: each type's published stores lists; the air-to-air counts are the stations' worth, rounded up a little
// where a real jet carries very few)
const L = {
    // SKYWAR's test jet: the best of everyone's, and its own mega bombs and bunker busters
    x100: {
        air: 'aim9x 12, aim120d 10',
        balanced: 'aim9x 8, aim120d 6, agm65 6, mk84x 8, gbu57x 4',
        strike: 'aim9x 4, aim120d 4, agm88 4, agm65 8, mk84x 16, gbu57x 8',
    },
    // F-22A: everything in the bays — two AIM-9X in the side bays, AMRAAMs or Small Diameter Bombs in the main one
    f22: {
        air: 'aim9x 4, aim120d 8',
        balanced: 'aim9x 2, aim120d 6, gbu39 4',
        strike: 'aim9x 2, aim120d 2, gbu39 8',
    },
    // F-35A / C: internal AMRAAMs and bombs, AIM-9X outboard, GBU-12s for the EOTS laser
    f35: {
        air: 'aim9x 2, aim120d 6',
        balanced: 'aim9x 2, aim120d 4, gbu12 4',
        strike: 'aim9x 2, aim120d 2, gbu31 4',
    },
    f35n: {
        air: 'aim9x 2, aim120d 6',
        balanced: 'aim9x 2, aim120d 4, gbu12 4',
        strike: 'aim9x 2, aim120d 2, gbu32 4',
    },
    // F-16C Block 50: the Wild Weasel's HARMs, Mavericks, Paveways
    f16: {
        air: 'aim9x 4, aim120c 6',
        balanced: 'aim9x 2, aim120c 4, agm65 2, hydra 38, mk82 4',
        strike: 'aim9x 2, aim120c 2, agm88 2, agm65 4, gbu12 4',
    },
    // F-15C: "not a pound for air-to-ground" — but it can drop iron if it has to
    f15: {
        air: 'aim9x 4, aim120c 8',
        balanced: 'aim9x 4, aim120c 6, mk82 6',
        strike: 'aim9x 2, aim120c 4, mk84 4',
    },
    // F/A-18E: Harpoons for the fleet, JDAMs, HARMs
    fa18: {
        air: 'aim9x 2, aim120d 8',
        balanced: 'aim9x 2, aim120d 4, agm84 2, gbu12 4',
        strike: 'aim9x 2, aim120d 2, agm88 2, agm84 4, gbu31 4',
    },
    // F-14: Phoenix, Sparrow and Sidewinder; the "Bombcat" with LANTIRN and Paveways
    f14: {
        air: 'aim9m 4, aim7m 2, aim54 4',
        balanced: 'aim9m 2, aim7m 2, aim54 2, gbu12 2',
        strike: 'aim9m 2, aim7m 2, gbu16 4',
    },
    // A-10C: the gun, Mavericks, rockets, CBUs and Paveways; Sidewinders for self-defence only
    a10: {
        air: 'aim9m 6, agm65 2',
        balanced: 'aim9m 2, agm65 4, hydra 76, mk82 4',
        strike: 'aim9m 2, agm65 4, hydra 76, gbu12 4, cbu87 4',
    },
    // F-4E: Sparrows, Sidewinders, Mavericks, Zunis and a lot of iron
    f4: {
        air: 'aim9m 4, aim7m 4',
        balanced: 'aim9m 2, aim7m 2, agm65 2, mk82 6',
        strike: 'aim9m 2, aim7m 2, zuni 16, gbu10 2, mk82 12',
    },
    // F-5E: two wingtip AIM-9Ps (four in the air role), rocket pods and bombs — no radar missile
    f5: {
        air: 'aim9p 4',
        balanced: 'aim9p 2, hydra 38, mk82 4',
        strike: 'aim9p 2, hydra 38, mk82 6',
    },
    // F-2A: the maritime striker — four ASM-2s, AAM-4B and AAM-5, JDAMs
    f2: {
        air: 'aam5 4, aam4b 4',
        balanced: 'aam5 2, aam4b 2, asm2 2, mk82 4',
        strike: 'aam5 2, asm2 4, gbu38 4',
    },
    // Su-57: R-77M and R-74M in the bays, Kh-38 and KAB-500 for the ground, Kh-31P for the SAMs
    su57: {
        air: 'r74 4, r77m 8',
        balanced: 'r74 2, r77m 4, kh38 2, kab500s 2',
        strike: 'r74 2, r77m 2, kh31p 2, kh38 4, kab500s 2',
    },
    // Su-35S: twelve hardpoints — R-73 / R-77-1 for the fight, Kh-29T, Kh-31P, Kh-35U, KAB-500L, FAB-500
    su35: {
        air: 'r73 4, r77 8',
        balanced: 'r73 2, r77 6, kh29t 2, fab500 4',
        strike: 'r73 2, r77 2, kh31p 2, kh35 2, kab500l 4',
    },
    // MiG-29 (9.12): R-73s and R-27s; rockets and bombs for the ground
    mig29: {
        air: 'r73 6, r27r 2',
        balanced: 'r73 2, r27r 2, s8 40, ofab250 4',
        strike: 'r73 2, r27r 2, s8 80, rbk500 4',
    },
    // MiG-31BM: four R-37Ms under the belly, R-77s and R-73s on the wings; Kh-31P on a SEAD sortie
    mig31: {
        air: 'r73 2, r77 2, r37 4',
        balanced: 'r73 2, r77 2, r37 4',
        strike: 'r73 2, r37 2, kh31p 4',
    },
    // MiG-21bis: R-60Ms, a gun pod's worth of S-5 rockets and FAB / OFAB bombs
    mig21: {
        air: 'r60 4',
        balanced: 'r60 2, s5 32, ofab250 2',
        strike: 'r60 2, s5 32, ofab250 4',
    },
    // MiG-25PD: R-40s and R-60s; the RB drops FAB-500s at Mach 2
    mig25: {
        air: 'r60 4, r40 4',
        balanced: 'r60 2, r40 2, fab500 4',
        strike: 'r60 2, fab500 8',
    },
    // Su-47 (the S-37 bay was laid out for Su-35 weapons)
    su47: {
        air: 'r73 4, r77 6',
        balanced: 'r73 2, r77 4, kh29t 2, s8 40',
        strike: 'r73 2, r77 2, kh29t 2, kab500l 4',
    },
    // J-20: PL-10s in the side bays, PL-15s in the main bay, LS-6 glide bombs
    j20: {
        air: 'pl10 4, pl15 6',
        balanced: 'pl10 2, pl15 4, ls6 4',
        strike: 'pl10 2, pl15 2, ls6 8',
    },
    // J-10A: PL-8 and PL-12, 90 mm rockets, LT-2 laser bombs and 250 kg bombs
    j10: {
        air: 'pl8 4, pl12 4',
        balanced: 'pl8 2, pl12 2, rkt90 38, type250 4',
        strike: 'pl8 2, lt2 4, rkt90 38, type250 8',
    },
    // J-8II: PL-8s and the semi-active PL-11, 57 mm rockets, bombs
    j8: {
        air: 'pl8 4, pl11 2',
        balanced: 'pl8 2, pl11 2, rkt57 36, type250 4',
        strike: 'pl8 2, rkt57 72, type250 8',
    },
    // Typhoon: IRIS-T and Meteor; Brimstone, Paveway IV, Storm Shadow
    typhoon: {
        air: 'iris_t 4, meteor 6',
        balanced: 'iris_t 2, meteor 4, brimstone 6, pw4 2',
        strike: 'iris_t 2, meteor 2, stormshadow 2, pw4 4',
    },
    // Rafale: MICA IR and Meteor; Exocet, SCALP and Hammer
    rafale: {
        air: 'micair 4, meteor 4',
        balanced: 'micair 2, meteor 2, am39 1, aasm 4',
        strike: 'micair 2, meteor 2, scalp 2, aasm 6',
    },
    // Gripen C: IRIS-T and Meteor, RBS 15F against ships, GBU-12s
    gripen: {
        air: 'iris_t 4, meteor 4',
        balanced: 'iris_t 2, meteor 4, gbu12 2',
        strike: 'iris_t 2, meteor 2, rbs15 2, gbu12 4',
    },
    // Jaguar GR3: overwing AIM-9Ls, CRV7 pods, BL755 cluster bombs, 1000 lb Paveway IIs
    jaguar: {
        air: 'aim9l 4',
        balanced: 'aim9l 2, crv7 38, bl755 4',
        strike: 'aim9l 2, crv7 38, pw2k 4, bl755 4',
    },
    // Mirage 5F: Magic 2s, SNEB pods and SAMP bombs — an honest old fighter-bomber with nothing guided on the ground
    mirage: {
        air: 'magic2 4',
        balanced: 'magic2 2, sneb 36, samp250 4',
        strike: 'magic2 2, sneb 72, samp250 8',
    },
    // EA-18G: AMRAAMs and HARMs between the ALQ-99 pods; no Sidewinders (the wingtips carry the ALQ-218)
    ea18g: {
        air: 'aim120d 4, agm88 2',
        balanced: 'aim120d 2, agm88 4',
        strike: 'aim120d 2, agm88 6',
    },
    // MQ-9A: Hellfires and GBU-12s (it lases for itself); AIM-9X was tried on it
    mq9: {
        air: 'aim9x 2, hellfire 4',
        balanced: 'hellfire 4, gbu12 2',
        strike: 'hellfire 4, gbu12 4',
    },
    // B-2A: JDAMs by the dozen, or iron bombs
    b2: {
        air: 'gbu31 8',
        balanced: 'gbu31 8, mk82 24',
        strike: 'gbu31 16, mk84 16',
    },
    // B-52H: JASSMs on the wing pylons, 51 Mk 82s
    b52: {
        air: 'jassm 12',
        balanced: 'jassm 6, mk82 40',
        strike: 'jassm 12, mk82 51',
    },
    // Tu-95MS: Kh-101s on the rotary launcher and the wings (the bay takes bombs on a conventional sortie)
    tu95: {
        air: 'kh101 8',
        balanced: 'kh101 6, fab500 12',
        strike: 'kh101 8, fab500 24',
    },
};
export const PRESETS = ['air', 'balanced', 'strike'];
// parsed: type → preset → { cls: { id, n } }
export const LOADOUTS = {};
for (const [type, P] of Object.entries(L)) {
    LOADOUTS[type] = {};
    for (const pre of PRESETS) {
        const out = {};
        for (const part of P[pre].split(',')) {
            const [id, n] = part.trim().split(/\s+/);
            const s = STORES[id];
            if (!s) throw new Error('stores.js: ' + type + ' ' + pre + ': no store ' + id);
            if (out[s.cls]) throw new Error('stores.js: ' + type + ' ' + pre + ': two ' + s.cls);
            out[s.cls] = { id, n: +n };
        }
        LOADOUTS[type][pre] = out;
    }
}

// a spec's type id
const TYPE_OF = new Map(Object.entries(AIRCRAFT).map(([k, s]) => [s, k]));
const typeOf = (x) => (x && (x.type && AIRCRAFT[x.type] === x.spec ? x.type : TYPE_OF.get(x.spec || x))) || null;
const specOf = (x) => (x && (x.spec || (x.flight ? x : null))) || null;

// The loadout a type flies with on a preset ('air' | 'balanced' | 'strike'): [{ cls, id, n, store }] in slot order
export function loadoutOf(x, preset = 'balanced') {
    const t = LOADOUTS[typeOf(x)];
    const P = t && (t[preset] || t.balanced);
    if (!P) return [];
    return CLASSES.filter(c => P[c.key]).map(c => ({ cls: c.key, id: P[c.key].id, n: P[c.key].n, store: STORES[P[c.key].id] }));
}
// "AIM-9X ×2 · AIM-120C ×4 · ..." (the hangar)
export const loadoutText = (x, preset) => loadoutOf(x, preset).map(e => e.store.short + ' ×' + e.n).join(' · ');

// Does the type carry this class on any loadout?
export function carries(x, cls) {
    const t = LOADOUTS[typeOf(x)];
    return !!t && PRESETS.some(p => t[p][cls]);
}

// The store an aircraft (or a spec) uses in a class: the one it was armed with, else its type's (balanced first),
// else its country's, else the plain one. Ground launchers (no spec) have none.
export function storeFor(x, cls) {
    if (!x || !cls) return null;
    const own = x.stores && x.stores[cls];
    if (own && STORES[own]) return STORES[own];
    const spec = specOf(x);
    if (!spec) return null;
    const t = LOADOUTS[typeOf(x)];
    if (t) for (const p of ['balanced', 'strike', 'air']) if (t[p][cls]) return STORES[t[p][cls].id];
    const d = DEFAULTS[spec.country] || DEFAULTS.USA;
    return STORES[d[cls] || DEFAULTS.USA[cls] || FALLBACK[cls]] || null;
}
const FALLBACK = { buster: 'gbu57x' };
// fireMissile's kind → the store this aircraft fires for it
export const storeOfKind = (x, kind) => storeFor(x, classOfKind(kind));

// Arm an aircraft with a preset: every class's count set (0 for what it doesn't carry) and ac.stores = { cls: id }.
// opts.ai: the AI's load — air-to-air only, and at most 4 radar / 2 very long range missiles
export function armAircraft(ac, preset = 'balanced', opts = {}) {
    for (const c of CLASSES) ac[c.ammo] = 0;
    ac.stores = {};
    ac.loadCounts = {};
    ac.loadout = preset;
    for (const e of loadoutOf(ac, preset)) {
        const c = CLASS[e.cls];
        if (opts.ai && c.vs !== 'air') continue;
        ac.stores[e.cls] = e.id;
        ac[c.ammo] = opts.ai && e.cls === 'lrm' ? Math.min(e.n, 4) : opts.ai && e.cls === 'xlr' ? Math.min(e.n, 2) : e.n;
        ac.loadCounts[e.cls] = ac[c.ammo];
    }
    return ac;
}

// ── Engagement rules ──
// radars a HARM can home on: ew.js's emitters, and the plain ground targets' (ground.js) SAM sites and radars
const RADAR_TYPES = new Set(['sam', 'msam', 'radar', 'spaag']);
export function radiating(t, emitter = null) {
    if (!t || t.alive === false || t.emitting === false) return false;
    if (emitter) return true;
    if (t.isShip) return t.team !== 'neutral' && !(t.def && (t.def.cls === 'boat' || t.def.cls === 'sub'));
    return !!t.isGround && RADAR_TYPES.has(t.type) && !t.unpowered;
}
// Can a weapon of this class lock t? emitter: ew.js emitterOf(t) where the war knows it
export function canEngage(cls, t, emitter = null) {
    const c = CLASS[cls];
    if (!c || !t) return false;
    if (!c.vs) return true;
    if (c.vs === 'air') return !t.isGround;
    if (c.vs === 'ground') return !!t.isGround;
    if (c.vs === 'ship') return !!t.isShip;
    if (c.vs === 'emitter') return radiating(t, emitter);
    return false;
}

// ── Seekers ──
// a flare's pull on a heat seeker: the side's odds, less for a modern seeker (IRCCM), more for an old one
export const flareChance = (W, base) => Math.min(0.9, Math.max(0, base * (1 - (W.irccm || 0))));
// chaff on a radar missile: little use head-on, a lot with the target beaming it (the Doppler notch hides the jet
// and leaves the chaff); `beam` 0 (nose or tail on) … 1 (flying across the missile's line of sight)
export const chaffChance = (W, base, beam) => Math.min(0.9, Math.max(0, base * (1 - (W.eccm ?? 0.5)) * (0.25 + 1.5 * beam * beam)));
// the notch: a radar missile looking down at a target flying across its line of sight loses it now and then
// (per 0.5 s check)
export const notchChance = (W, beam, lookDown) => (beam > 0.85 && lookDown ? 0.14 * (1 - (W.eccm ?? 0.5)) * (beam - 0.85) / 0.15 : 0);
// the launch call for a seeker
export function brevity(W) {
    if (!W) return 'Missile away!';
    if (W.cls === 'srm') return 'Fox two!';
    if (W.seeker === 'sarh') return 'Fox one!';
    if (W.cls === 'lrm' || W.cls === 'xlr') return 'Fox three!';
    if (W.cls === 'arm') return 'Magnum!';
    if (W.cls === 'agm') return 'Rifle!';
    if (W.cls === 'ashm') return 'Bruiser!';
    if (W.cls === 'alcm') return 'Weapon away!';
    return 'Missile away!';
}
// what the threat warning calls it (IR / RADAR / ...)
export const seekerLabel = (W) => !W ? '' : W.seeker === 'ir' ? 'IR' : W.seeker === 'sarh' || W.seeker === 'arh' ? 'RADAR' : W.seeker === 'arm' ? 'ARM' : W.seeker.toUpperCase();
