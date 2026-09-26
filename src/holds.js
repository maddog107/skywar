// ═══════════════════════════════════════════════════════════════
// How each weapon is held: hand positions, orientations and finger curls in weapon space (grip at the
// origin, muzzle toward -Z), shared by the first-person arms (viewmodel.js) and the third-person
// characters (character.js), plus where the view model carries the weapon (camera space) and where a
// character holds it (relative to the chest).
// ═══════════════════════════════════════════════════════════════
import { weaponDef } from './arsenal.js';

// ── How each weapon is held, in weapon space (grip at the origin, muzzle toward -Z) ──
// R / L: wrist position `at`, hand frame fwd (wrist → knuckles) and up (back of the hand), finger curl.
// L.from: 'support' | 'grip' (the offset is added to that point). hip / ads: where the weapon sits in camera
// space (grip position, and yaw / pitch / roll in rad); ads.eye: distance from the eye to the rear sight; ads.lift: how
// far the eye sits above the sight line (a shotgun's rib).
export const HOLDS = {
    rifle: {
        R: { at: [0.018, 0.005, 0.055], fwd: [-0.12, -0.28, -0.95], up: [0.93, 0.25, -0.1], curl: { thumb: 0.55, index: 0.32, middle: 0.85, ring: 0.9, pinky: 0.92 } },
        L: { from: 'support', at: [-0.03, -0.045, 0.05], fwd: [0.45, 0.5, -0.74], up: [-0.55, -0.75, -0.3], curl: { thumb: 0.45, index: 0.62, middle: 0.72, ring: 0.78, pinky: 0.82 } },
        hip: { pos: [0.125, -0.175, -0.3], rot: [0.012, 0.035, 0.0] }, ads: { eye: 0.3 }, sprint: { pos: [0.06, -0.2, -0.26], rot: [-0.35, 0.55, 0.35] },
        shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.6, -0.8, 0.2], poleL: [-0.7, -0.7, 0.2],
    },
    pistol: {
        R: { at: [0.012, -0.002, 0.058], fwd: [-0.1, -0.2, -0.97], up: [0.95, 0.2, -0.05], curl: { thumb: 0.45, index: 0.3, middle: 0.9, ring: 0.95, pinky: 0.95 } },
        L: { from: 'grip', at: [-0.03, -0.028, 0.052], fwd: [0.3, -0.15, -0.94], up: [-0.9, -0.35, 0.0], curl: { thumb: 0.35, index: 0.8, middle: 0.85, ring: 0.9, pinky: 0.9 } },
        hip: { pos: [0.075, -0.15, -0.36], rot: [0.02, 0.05, 0.0] }, ads: { eye: 0.42 }, sprint: { pos: [0.08, -0.22, -0.25], rot: [-0.7, 0.3, 0.2] },
        shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.5, -0.9, 0.1], poleL: [-0.5, -0.9, 0.1],
    },
    shotgun: {
        R: { at: [0.018, 0.005, 0.058], fwd: [-0.12, -0.3, -0.95], up: [0.93, 0.25, -0.1], curl: { thumb: 0.55, index: 0.32, middle: 0.85, ring: 0.9, pinky: 0.92 } },
        L: { from: 'support', at: [-0.03, -0.05, 0.05], fwd: [0.45, 0.5, -0.74], up: [-0.55, -0.75, -0.3], curl: { thumb: 0.45, index: 0.65, middle: 0.75, ring: 0.8, pinky: 0.84 } },
        hip: { pos: [0.13, -0.17, -0.28], rot: [0.012, 0.03, 0.0] }, ads: { eye: 0.16 }, sprint: { pos: [0.06, -0.2, -0.24], rot: [-0.35, 0.55, 0.35] },
        shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.6, -0.8, 0.2], poleL: [-0.7, -0.7, 0.2],
    },
    launcher: {
        R: { at: [0.015, 0.0, 0.058], fwd: [-0.12, -0.25, -0.96], up: [0.93, 0.25, -0.1], curl: { thumb: 0.55, index: 0.32, middle: 0.85, ring: 0.9, pinky: 0.92 } },
        L: { from: 'support', at: [-0.02, -0.01, 0.05], fwd: [0.1, -0.2, -0.97], up: [-0.95, -0.2, 0.0], curl: { thumb: 0.5, index: 0.75, middle: 0.8, ring: 0.85, pinky: 0.88 } },
        hip: { pos: [0.11, -0.28, -0.24], rot: [0.02, 0.02, 0.0] }, ads: { eye: 0.11 }, sprint: { pos: [0.12, -0.3, -0.2], rot: [-0.25, 0.3, 0.1] },
        shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.6, -0.8, 0.1], poleL: [-0.6, -0.8, 0.0],
    },
    grenade: {
        R: { at: [0.012, -0.03, 0.06], fwd: [-0.05, 0.25, -0.97], up: [0.9, 0.1, 0.2], curl: { thumb: 0.7, index: 0.7, middle: 0.75, ring: 0.8, pinky: 0.85 } },
        L: null,
        hip: { pos: [0.16, -0.17, -0.3], rot: [0.1, 0.0, -0.1] }, ads: { eye: 0.3 }, sprint: { pos: [0.16, -0.22, -0.25], rot: [-0.2, 0.2, 0.0] },
        shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.6, -0.8, 0.2], poleL: [-0.7, -0.7, 0.2],
    },
};
// per-weapon tweaks on top of the type's hold
export const HOLD_TWEAKS = {
    ak47: { ads: { eye: 0.36 } }, m4a1: { hip: { pos: [0.12, -0.17, -0.29] } }, m870: { ads: { eye: 0.3, lift: 0.02 } }, m9: {}, deagle: { hip: { pos: [0.075, -0.16, -0.37] } }, rpg7: {}, m67: {},
};
const holdType = (d) => (d.type === 'rifle' ? 'rifle' : d.type === 'shotgun' ? 'shotgun' : d.type === 'pistol' ? 'pistol' : d.type === 'launcher' ? 'launcher' : 'grenade');
export function holdFor(id) {
    const d = weaponDef(id), base = HOLDS[holdType(d)], tw = HOLD_TWEAKS[id] || {};
    return { ...base, ...tw, hip: { ...base.hip, ...(tw.hip || {}) }, ads: { ...base.ads, ...(tw.ads || {}) } };
}

// Where a character (third person, soldiers) holds the weapon: the grip relative to its chest bone, in the aim
// frame (x right, y up, -z forward; metres). When not aiming the muzzle dips `low` rad (low ready).
// blade: how far (rad) the upper body turns to the right for it (the left shoulder forward, as a rifleman stands);
// scale: the weapon's size in his hands (the character's arms are short for a full-size long gun).
export const BODY_HOLDS = {
    rifle: { grip: [0.115, -0.01, -0.25], low: 0.5, blade: 0.6, scale: 0.9 },
    shotgun: { grip: [0.115, -0.01, -0.25], low: 0.5, blade: 0.75, scale: 0.88 },
    pistol: { grip: [0.03, 0.05, -0.44], low: 0.95, blade: 0, scale: 1 },
    launcher: { grip: [0.14, 0.03, -0.36], low: 0.15, blade: 0.3, scale: 0.95 },
    grenade: { grip: [0.2, 0.06, -0.18], low: 0.3, blade: 0, scale: 1 },
};
export function bodyHoldFor(id) { return BODY_HOLDS[holdType(weaponDef(id))]; }
