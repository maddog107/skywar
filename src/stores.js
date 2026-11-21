// ═══════════════════════════════════════════════════════════════
// Stores: the real weapons each type carries, by loadout
//  • CLASSES: the weapon slots X cycles through (the ones the jet carries): IR missile, radar missile, very long
//    range missile, anti-radiation, air-to-ground, anti-ship, cruise missile, rockets, guided bombs, bombs, the
//    X-100's bunker busters and MOABs. Each keeps its count in its own field on the aircraft (ac.missiles, ac.lrm, ...) and
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
    { key: 'moab', label: 'MOAB', name: 'MASSIVE BOMB', ammo: 'moabs', drop: true, vs: null },
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
    // the X-100's own (config.js: its `bomb`, WEAPONS.buster and WEAPONS.moab)
    mk84x: S(BOMB, 'bomb', 'SKYWAR', { short: 'MK-84X', ...AIRCRAFT.x100.bomb, mega: true, len: 4.2, dia: 0.62, color: 0x24262a }),
    gbu57x: S(WEAPONS.buster, 'buster', 'SKYWAR', { short: 'GBU-57X', shape: 'buster', len: 6.2, dia: 0.8 }),
    gbu43x: S(WEAPONS.moab, 'moab', 'SKYWAR', { short: 'GBU-43X', shape: 'moab', len: 9.2, dia: 1.03, color: 0x4a5040 }),
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
    // SKYWAR's test jet: the best of everyone's, and its own mega bombs, bunker busters, twenty MOABs and fifty Harpoons
    x100: {
        air: 'aim9x 12, aim120d 10',
        balanced: 'aim9x 8, aim120d 6, agm65 6, agm84 50, mk84x 8, gbu57x 4, gbu43x 20',
        strike: 'aim9x 4, aim120d 4, agm88 4, agm65 8, agm84 50, mk84x 16, gbu57x 8, gbu43x 20',
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
const FALLBACK = { buster: 'gbu57x', moab: 'gbu43x' };
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

// ═══════════════════════════════════════════════════════════════
// Stations: where each type hangs its stores (pylons.js fits them to the model and draws them; weapons.js launches
// from them). Written from each type's published station map; the left and the right one of a pair share an entry.
//   TIP()            a wingtip launch rail, the missile outboard of it in the wing's plane (F-16, F/A-18, F-5)
//   WING(f)          an underwing pylon at f of the model's half span
//   FUS(x, z)        under the fuselage: x m off the centreline (0: on it), z of the length from the middle (− forward)
//   OVER(f)          an overwing launcher (Jaguar)
// options: c (where along the chord the pylon's middle is, 0 leading edge … 1; default 0.42); own (the model has
//   its own pylon / rail there: the store hangs on that); dx, dy (m: a side rail on the pylon, sideways from it (+ is
//   outboard) and up from its foot); sink (m: recessed into the skin: semi-conformal carriage); fwd (m: the store
//   further forward on the pylon); drop (m: the pylon's depth); under (a wingtip rail under the tip: Su-27); fix
//   (the model's own pylon is exactly at f, and at z of the length if given: hang from whatever is there)
// use: per class, the stations it hangs on, the preferred first:
//   '3' one store · '3*2' two side by side (a twin rack, a dual rail) · '3*3' a triple ejector rack or launcher ·
//   '3*6' two triples in tandem (a multiple ejector rack) · '3+2' two in tandem · a '!' after it: a rack built for
//   big stores (a bomber's pylon), not just the 500 lb class
// A class whose `use` isn't written hangs on the wing pylons (air-to-air from the tip in, the rest from the root out).
// bay: internal bays [[x, z], ...] (as FUS): nothing is shown, the weapons drop from them. Stores with no station
// left (the X-100's fifty Harpoons, a B-52's bombs) are carried inside too.
// ═══════════════════════════════════════════════════════════════
const TIP = (o) => ({ kind: 'tip', ...o });
const WING = (f, o) => ({ kind: 'wing', f, ...o });
const FUS = (x, z, o) => ({ kind: 'fus', x, z, ...o });
const OVER = (f, o) => ({ kind: 'over', f, ...o });

export const STATIONS = {
    // ── Internal carriage only ──
    f22: { st: {}, bay: [[0.45, -0.02], [1.35, -0.1]] },
    f35: { st: {}, bay: [[0.85, 0.0]] },
    f35n: { st: {}, bay: [[0.85, 0.0]] },
    j20: { st: {}, bay: [[0.45, 0.02], [1.45, -0.06]] },
    su57: { st: {}, bay: [[0, -0.08], [0, 0.1]] },
    b2: { st: {}, bay: [[1.7, 0.05]] },
    // the X-100: bays for nearly everything; its air-to-air missiles on six wing stations
    x100: {
        st: { 1: WING(0.86), 2: WING(0.66), 3: WING(0.47) },
        use: { srm: '1 2', lrm: '2 3', xlr: '3', arm: '3', agm: '', ashm: '', alcm: '', gbu: '', bomb: '', buster: '', moab: '', rkt: '' },
        bay: [[0.6, 0.02]],
    },

    // F-16C: nine stations. 1/9 the wingtip LAU-129s, 2/8 underwing missile rails, 3/7 and 4/6 the heavy pylons, 5 centreline
    f16: {
        st: { 1: TIP({ own: true }), 2: WING(0.84, { own: true }), 3: WING(0.64, { own: true }), 4: WING(0.38, { own: true }), 5: FUS(0, 0.04) },
        use: { lrm: '1 2 3', srm: '2 1 3', arm: '3 4', agm: '3 4*2', ashm: '4 3', alcm: '4', gbu: '4*2 3 5*2', bomb: '4*3 3*3 5*3', rkt: '4 3' },
    },
    // F-2A: the F-16's layout on a bigger wing, with a fourth pair of pylons for its anti-ship missiles
    f2: {
        st: { 1: TIP({ own: true }), 2: WING(0.86), 3: WING(0.7, { own: true }), 4: WING(0.53, { own: true }), 5: WING(0.34), 6: FUS(0, 0.04) },
        use: { lrm: '1 2 3', srm: '2 1 3', ashm: '4 5', gbu: '5*2 3 6*2', bomb: '5*3 4*3 6*3', agm: '3 4', arm: '3', rkt: '5 4' },
    },
    // F/A-18E: eleven stations. 1/11 wingtip rails, 2/10 3/9 4/8 the wing pylons, 5/7 the nacelle (cheek) stations, 6 centreline
    fa18: {
        st: { 1: TIP({ own: true }), 2: WING(0.67, { own: true }), 3: WING(0.52, { own: true }), 4: WING(0.33, { own: true }), 5: FUS(1.18, 0.05, { sink: 0.02 }), 6: FUS(0, 0.0) },
        use: { lrm: '5 2*2 3*2', srm: '1 2', arm: '3 2', ashm: '4 3', agm: '3 2', alcm: '4', gbu: '3*2 4*2 2 6', bomb: '4*2 3*2 6*2', rkt: '3 4' },
    },
    // EA-18G: the jamming pods keep 3/9 and the centreline, the tanks 4/8: HARMs on 2/10, AMRAAMs on the nacelle stations
    ea18g: {
        st: { 2: WING(0.67, { own: true }), 5: FUS(1.22, 0.05, { sink: 0.02 }) },
        use: { lrm: '5 2', arm: '2', srm: '', agm: '2', bomb: '', gbu: '', rkt: '' },
    },
    // F-15C: 2/8 the wing pylons, each with a launch rail on either side; 3 4 6 7 the fuselage corners; the tank on 5
    f15: {
        st: {
            ff: FUS(1.66, -0.085, { own: true }), fr: FUS(1.66, 0.17, { own: true }),
            ro: WING(0.4541, { fix: true, z: 0.134, dx: 0.455, dy: 0.25, fwd: 1.1 }), ri: WING(0.4541, { fix: true, z: 0.134, dx: -0.455, dy: 0.25, fwd: 1.1 }), 2: WING(0.4541, { fix: true, z: 0.134 }),
        },
        use: { lrm: 'ff fr ri ro', srm: 'ro ri', gbu: '2', bomb: '2*3', rkt: '2', agm: '2', arm: '2' },
    },
    // F-14: the Phoenix pallets in the tunnel (3-6), the glove pylons (1B/8B) with a Sidewinder rail on the shoulder (1A/8A)
    f14: {
        st: { tf: FUS(0.39, -0.04), tr: FUS(0.39, 0.19), g: WING(0.55, { c: 0.3 }), gs: WING(0.55, { c: 0.3, dx: 0.32, dy: 0.22 }) },
        use: { lrm: 'g tr', srm: 'gs', xlr: 'tr tf g', gbu: 'tf tr', bomb: 'tf*2 tr*2', rkt: 'g', agm: 'g' },
    },
    // A-10C: eleven stations. 1/11 the outboard dual rail, 2/10, 3/9 (outboard of the gear pods), 4/8, 5/7 beside the
    // centreline, 6 on it
    a10: {
        st: { o: WING(0.6475, { fix: true, z: -0.029, dx: 0.235, dy: -0.16 }), i: WING(0.6475, { fix: true, z: -0.029, dx: -0.235, dy: -0.16 }), 2: WING(0.526, { own: true }), 3: WING(0.407, { own: true }), 4: WING(0.17), 5: FUS(0.6, 0.0), 6: FUS(0, 0.0) },
        use: { srm: 'o i', agm: '3*3 4', rkt: '2 4', gbu: '4*2 5 3', bomb: '5 6 4*3 3*3', arm: '3' },
    },
    // F-4E: the four Sparrow wells, the inboard wing pylons (2/8) with a Sidewinder rail on either side, the centreline
    f4: {
        st: {
            ff: FUS(0.52, -0.138, { sink: 0.1 }), fr: FUS(1.05, 0.132, { sink: 0.1 }),
            so: WING(0.361, { fix: true, z: -0.002, dx: 0.34, dy: 0.09 }), si: WING(0.361, { fix: true, z: -0.002, dx: -0.34, dy: 0.09 }), i: WING(0.361, { fix: true, z: -0.002 }), c: FUS(0, 0.055, { own: true }),
        },
        use: { lrm: 'ff fr', srm: 'so si', agm: 'i', gbu: 'i c', bomb: 'c*6 i*3', rkt: 'i', arm: 'i' },
    },
    // F-5E: wingtip rails, two pylons under each wing, the centreline
    f5: {
        st: { 1: TIP({ own: true }), 2: WING(0.66), 3: WING(0.42), 4: FUS(0, 0.03) },
        use: { srm: '1 2', rkt: '3 2', bomb: '4*3 2 3', gbu: '3 4', agm: '3' },
    },
    // Su-35S: twelve points. Wingtips, three under each wing, one under each intake, two in tandem between the engines
    su35: {
        st: { t: TIP({ under: true, own: true }), 1: WING(0.8), 2: WING(0.63), 3: WING(0.46), n: FUS(1.62, -0.03), cf: FUS(0, -0.07), cr: FUS(0, 0.13) },
        use: { lrm: 'cf cr n 2 3 1', srm: 't 1', arm: '3 2', ashm: '3 2', agm: '3 2', alcm: '3', gbu: 'n 2 3 1', bomb: '2 n 3 cf', rkt: '2 3' },
    },
    su47: {
        st: { t: TIP({ under: true }), 1: WING(0.78), 2: WING(0.6), 3: WING(0.42), c: FUS(0, 0.05) },
        use: { lrm: '2 3 c', srm: 't 1', agm: '3 2', gbu: '3 2 c', bomb: '3 2 c', rkt: '2 3', arm: '3' },
    },
    // MiG-29 (9.12): three pylons under each wing; the inboard pair takes the R-27s
    mig29: {
        st: { 1: WING(0.676, { own: true }), 2: WING(0.549, { own: true }), 3: WING(0.409, { own: true }) },
        use: { lrm: '3', srm: '1 2 3', bomb: '2+2 3+2', rkt: '2 3', gbu: '3 2', agm: '3 2', arm: '3' },
    },
    // MiG-21bis: two pylons under each wing and the centreline
    mig21: {
        st: { 1: WING(0.74), 2: WING(0.542, { own: true }), c: FUS(0, 0.02) },
        use: { srm: '1 2', rkt: '2 1', bomb: 'c*2 2 1', gbu: '2', agm: '2' },
        order: ['lrm', 'srm', 'rkt', 'bomb', 'gbu', 'agm'],
    },
    // MiG-25PD: two pylons under each wing (the outer pair takes R-60s two by two); the RB's bombs under the belly too
    mig25: {
        st: { 1: WING(0.66, { own: true }), 2: WING(0.47, { own: true }), f: FUS(0.95, 0.02) },
        use: { lrm: '2 1', srm: '1*2 2*2', bomb: 'f+2 2+2 1', gbu: 'f 2', rkt: '2', agm: '2', arm: '2' },
    },
    // MiG-31BM: four long-range missiles in tandem pairs under the belly, two pylons under each wing
    mig31: {
        st: { bf: FUS(0.62, -0.06, { sink: 0.12 }), br: FUS(0.62, 0.14, { sink: 0.12 }), 1: WING(0.68), 2: WING(0.516, { own: true }) },
        use: { xlr: 'bf br', lrm: '2 1', srm: '1*2 2', arm: '2 bf br', bomb: '2', agm: '2', gbu: '2', rkt: '2' },
    },
    // J-10A: three pylons under each wing, the centreline and the intake sides
    j10: {
        st: { 1: WING(0.77, { own: true }), 2: WING(0.53, { own: true }), 3: WING(0.31), c: FUS(0, 0.05, { own: true }), f: FUS(0.75, 0.2) },
        use: { srm: '1 2', lrm: '2 3', rkt: '3 2', gbu: '3 c 2', bomb: '3+2 c+2 f 2', agm: '3', arm: '3' },
    },
    // J-8II: two pylons under each wing (a third inboard for bombs) and the centreline
    j8: {
        st: { 1: WING(0.75, { own: true }), 2: WING(0.52, { own: true }), 3: WING(0.34), c: FUS(0, 0.05, { own: true }) },
        use: { srm: '1 2', lrm: '2 3', rkt: '3 2', bomb: '3+2 c+2 2', gbu: '3 c', agm: '3', arm: '3' },
    },
    // Typhoon: four semi-recessed fuselage stations, four pylons under each wing (the wingtips carry the DASS pods)
    typhoon: {
        st: { ff: FUS(0.72, -0.06, { sink: 0.07 }), fr: FUS(0.72, 0.16, { sink: 0.07 }), 1: WING(0.816, { own: true }), 2: WING(0.661, { own: true }), 3: WING(0.494, { own: true }), 4: WING(0.31, { own: true }), c: FUS(0, 0.05) },
        use: { lrm: 'ff fr 2', srm: '1 2', agm: '3*3 2*3', alcm: '4 3', gbu: '2 3 4 c', bomb: '3*2 2*2 c', arm: '3', rkt: '3 2' },
    },
    // Rafale: wingtip rails, three pylons under each wing, two rear fuselage stations, the centreline
    rafale: {
        st: { t: TIP({ own: true }), 1: WING(0.76), 2: WING(0.55), 3: WING(0.36), fr: FUS(0.72, 0.2), c: FUS(0, 0.04) },
        use: { srm: 't 1', lrm: 'fr 1', ashm: 'c 3', alcm: '3 c', gbu: '2*3 3*2 c', bomb: '2*2 3*2 c', agm: '2 3', rkt: '2 3', arm: '2' },
    },
    // Gripen C: wingtip rails, two pylons under each wing, the centreline
    gripen: {
        st: { t: TIP({ own: true }), 1: WING(0.72), 2: WING(0.48), c: FUS(0, 0.03) },
        use: { srm: 't 1', lrm: '2 1', ashm: '2', gbu: '2 1 c', bomb: '2*2 1 c', agm: '2 1', rkt: '2 1', arm: '2' },
    },
    // Jaguar: the overwing Sidewinder rails, two pylons under each wing, the centreline
    jaguar: {
        st: { ov: OVER(0.6, { own: true }), 1: WING(0.68), 2: WING(0.4), c: FUS(0, 0.03) },
        use: { srm: 'ov 1', rkt: '1 2', bomb: '2+2 c+2 1', gbu: '2 c 1', agm: '2', arm: '2' },
    },
    // Mirage 5F: two pylons under each wing (the outer for Magics), two under the fuselage, the centreline
    mirage: {
        st: { 1: WING(0.7), 2: WING(0.42), f: FUS(0.55, 0.12), c: FUS(0, 0.03) },
        use: { srm: '1 2', rkt: '2 1', bomb: 'f+2 c+2 2 1', gbu: '2 c', agm: '2' },
    },
    // MQ-9A: three pylons under each wing: inboard 1500 lb (the Paveways), middle (two Hellfires on a dual rail), outboard
    mq9: {
        st: { 1: WING(0.269, { own: true }), 2: WING(0.197, { own: true }), 3: WING(0.117, { own: true }) },
        use: { agm: '2*2 1*2', gbu: '3 1', srm: '1', bomb: '3' },
    },
    // B-52H: the two big wing pylons between the fuselage and the inboard engines (six missiles each), the bomb bay
    b52: {
        st: { p: WING(0.235, { c: 0.5 }) },
        use: { alcm: 'p*6!', ashm: 'p*6!', bomb: '', gbu: '', agm: '' },
        bay: [[0, 0.02]],
    },
    // Tu-95MSM: four twin pylons for Kh-101s, between the fuselage and the inner engines and between the engines; the bay
    tu95: {
        st: { 1: WING(0.135, { c: 0.45 }), 2: WING(0.377, { c: 0.45 }) },
        use: { alcm: '1*2! 2*2!', bomb: '', gbu: '' },
        bay: [[0, 0.0]],
    },
};
// a type with no map of its own: three pylons under each wing and the centreline
const GENERIC_STATIONS = { st: { 1: WING(0.76), 2: WING(0.55), 3: WING(0.34), c: FUS(0, 0.03) } };

// Rocket pods: what a class 'rkt' store hangs in (tubes; the launcher's length and diameter, m)
export const PODS = {
    hydra: { tubes: 19, len: 1.63, dia: 0.4 },   // LAU-61
    zuni: { tubes: 4, len: 2.36, dia: 0.355 },   // LAU-10
    s5: { tubes: 16, len: 1.88, dia: 0.335 },    // UB-16-57
    s8: { tubes: 20, len: 2.76, dia: 0.52 },     // B-8M1
    sneb: { tubes: 18, len: 2.24, dia: 0.42 },   // Matra F4
    crv7: { tubes: 19, len: 1.67, dia: 0.4 },    // LAU-5003
    rkt57: { tubes: 18, len: 1.6, dia: 0.33 },   // Type 57-2
    rkt90: { tubes: 7, len: 2.1, dia: 0.34 },    // Type 90-1
};
export const podOf = (W0) => PODS[W0 && W0.id] || PODS.hydra;

// the order the classes pick their stations in, round by round (every class its first choice, then every class its
// second ...), so each kind of store shows before any takes a second pair of pylons
const PLAN_ORDER = ['lrm', 'srm', 'xlr', 'alcm', 'ashm', 'arm', 'agm', 'gbu', 'bomb', 'buster', 'moab', 'rkt'];
// small enough for a twin or triple rack (the 500 lb class, the short missiles)
const slim = (W0) => (W0.dia || 0.3) <= 0.355 && (W0.len || 3) <= 3.9;
const AIR_CLASSES = new Set(['srm', 'lrm', 'xlr']);

// a type's station map: its own, the plain one for an armed type without, null for one that carries nothing
export function stationsOf(type) { return STATIONS[type] || (LOADOUTS[type] || (AIRCRAFT[type] && AIRCRAFT[type].gun) ? GENERIC_STATIONS : null); }

// a station reference of `use`: '3' | '3*2' | '3+2' → { st, cap, tandem }
function parseRef(ref) {
    const m = /^(\w+?)(?:([*+])(\d))?(!)?$/.exec(ref);
    return m ? { st: m[1], cap: m[2] ? +m[3] : 1, tandem: m[2] === '+', big: !!m[4] } : null;
}
// the stations a class may use on a type, the preferred first
function refsFor(T0, cls) {
    const u = T0.use && T0.use[cls];
    if (u != null) return u.split(/\s+/).filter(Boolean).map(parseRef).filter(r => r && T0.st[r.st]);
    const keys = Object.keys(T0.st), wing = keys.filter(k => T0.st[k].kind === 'wing' && !T0.st[k].dx);
    if (AIR_CLASSES.has(cls)) return [...keys.filter(k => T0.st[k].kind === 'tip'), ...wing].map(k => ({ st: k, cap: 1 }));
    return [...wing.slice().reverse(), ...keys.filter(k => T0.st[k].kind === 'fus' && !T0.st[k].x)].map(k => ({ st: k, cap: 1 }));
}
// a pylon written twice (once bare, once for a bigger rack) is one pylon: two stations at the same place under the
// wing can't both be loaded (its side rails, with a dx, are separate)
function shared(T0, key, free) {
    const d = T0.st[key];
    if (d.kind !== 'wing' || d.dx) return false;
    for (const k in T0.st) { const o = T0.st[k]; if (k !== key && o.kind === 'wing' && !o.dx && o.f === d.f && !free.has(k)) return true; }
    return false;
}

// Which stores hang where. load: [{ cls, store, n }] (a rocket class's n is rockets: they hang in pods).
// Returns { places: [{ cls, store, st, def, cap, tandem, pair, n }], inside: { cls: n }, bay }: places in the order
// they were given out (a class's first is its most preferred station); n: how many hang there (both sides together
// for a pair: the right one takes the odd one; pods for rockets); inside: what no station was left for.
export function stationPlan(type, load) {
    const T0 = stationsOf(type);
    const places = [], inside = {};
    if (!T0) return { places, inside, bay: null };
    const left = {}, by = {};
    for (const e of load) {
        if (!(e.n > 0) || !e.store) continue;
        by[e.cls] = e;
        left[e.cls] = e.cls === 'rkt' ? Math.ceil(e.n / podOf(e.store).tubes) : e.n;
    }
    const free = new Set(Object.keys(T0.st));
    const order = T0.order || PLAN_ORDER;
    const classes = [...order.filter(c => by[c]), ...Object.keys(by).filter(c => !order.includes(c))];
    for (let round = 0, moved = true; moved && round < 12; round++) {
        moved = false;
        for (const cls of classes) {
            if (!(left[cls] > 0)) continue;
            const W0 = by[cls].store;
            const ref = refsFor(T0, cls).find(r => free.has(r.st) && !shared(T0, r.st, free));
            if (!ref) continue;
            const def = T0.st[ref.st], pair = !(def.kind === 'fus' && !def.x);
            let cap = ref.cap;
            if (cls === 'rkt' || (!ref.big && ((cap > 1 && !ref.tandem && !slim(W0)) || (ref.tandem && (W0.len || 3) > 3.3)))) cap = 1;
            const n = Math.min(left[cls], pair ? cap * 2 : cap);
            places.push({ cls, store: W0, st: ref.st, def, cap, tandem: !!ref.tandem && cap > 1, pair, n });
            left[cls] -= n;
            free.delete(ref.st);
            moved = true;
        }
    }
    for (const cls of classes) if (left[cls] > 0) inside[cls] = left[cls];
    return { places, inside, bay: T0.bay || null };
}
