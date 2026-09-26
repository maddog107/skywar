// ═══════════════════════════════════════════════════════════════
// Preview sheets for the ship models (dev tool, not loaded by the game). In the preview page
// (tools/aircraft/preview.html, with a PNG upload server: tools/aircraft/upload.mjs):
//   const S = await import('/tools/ships/sheets.js?t=' + Date.now());
//   await S.sheets(P, ['destroyer', 'cruiser']);      // or S.sheets(P) for every vessel
// Each vessel gets naval/<type>.png: the four standard views, and close-ups of its rig posed (VLS doors open,
// masts raised, elevators down, boats from close up), rendered through naval.js exactly as the game builds them.
// ═══════════════════════════════════════════════════════════════
const openAll = (every = 1) => (m, N) => { for (let i = 0; i < m.rig.cells.length; i += every) N.openCell(m, i, 1); };
const openVent = (every = 1) => (m, N) => { for (let i = 0; i < m.rig.cells.length; i += every) { N.openCell(m, i, 1); N.ventCell(m, i, 1); } };
const masts = (m, N) => { for (const k of Object.keys(m.rig.masts)) N.raiseMast(m, k, 1); };
const all = (...f) => (m, N) => f.forEach(g => g(m, N));

// per type: extra rows of close-ups: [label, [{ at, dir, dist, pose, water, depth, fov }, ...]]
export const SPECS = {
    destroyer: () => [
        ['VLS fore / aft\n(all cells open)', [
            { at: [0, 9.2, -42], dir: [1.1, 1.3, -0.9], dist: 16, pose: openVent(1) },
            { at: [0, 11.7, 43], dir: [0.7, 1.6, 0.35], dist: 17, pose: openVent(1) },
            { at: [-1.5, 9.2, -42], dir: [0.5, 0.9, 1.0], dist: 9, pose: openVent(3) }]],
        ['details', [
            { at: [0, 17, -18], dir: [1, 0.35, -1], dist: 42 },
            { at: [0, 12, 40], dir: [-1, 0.45, 0.6], dist: 46 },
            { at: [0, 6, 0], dir: [1, 0.15, 0.1], dist: 110, water: 'clear' }]],
    ],
    cruiser: () => [
        ['VLS fore / aft\n(all cells open)', [
            { at: [0, 8.8, -38.9], dir: [1.1, 1.3, -0.9], dist: 19, pose: openVent(1) },
            { at: [0, 8.3, 66.8], dir: [1.0, 1.5, 0.6], dist: 19, pose: openVent(1) },
            { at: [-1.2, 8.8, -38.9], dir: [0.5, 0.9, 1.0], dist: 10, pose: openVent(3) }]],
        ['details', [
            { at: [0, 16, -22], dir: [1, 0.35, -1], dist: 48 },
            { at: [0, 14, 30], dir: [-1, 0.45, 0.6], dist: 52 },
            { at: [0, 6, 0], dir: [1, 0.15, 0.1], dist: 120, water: 'clear' }]],
    ],
    ssn: (L) => [
        ['surfaced', [
            { at: [0, 5, -40], dir: [1, 0.5, -1], dist: 34, water: 'clear', pose: masts },
            { at: [0, 3, -52], dir: [0.6, 1.2, -0.3], dist: 16, water: 'clear', pose: all(openAll(1), (m, N) => N.openHatch(m, 'hatch_escape', 1)) },
            { at: [0, 3, -20], dir: [0.5, 1.2, 0.4], dist: 20, water: 'clear', pose: openAll(1) }]],
        ['periscope depth\n(masts up)', [
            { at: [0, 0, -30], dir: [1, 0.22, -0.4], dist: 70, water: 'sea', depth: L.periscopeDepth, pose: masts },
            { at: [0, 0, -34], dir: [1, 0.08, 0.2], dist: 28, water: 'sea', depth: L.periscopeDepth, pose: masts },
            { at: [0, -3, 58], dir: [1, 0.3, 0.8], dist: 26, water: 'clear' }]],
    ],
    ssgn: (L) => [
        ['surfaced', [
            { at: [0, 6, -45], dir: [1, 0.5, -1], dist: 40, water: 'clear', pose: masts },
            { at: [0, 5, -10], dir: [0.8, 1.1, -0.5], dist: 30, water: 'clear', pose: openAll(7) },
            { at: [0, 5, 10], dir: [0.4, 1.3, 0.5], dist: 16, water: 'clear', pose: openAll(7) }]],
        ['periscope depth\n(masts up)', [
            { at: [0, 0, -36], dir: [1, 0.22, -0.4], dist: 80, water: 'sea', depth: L.periscopeDepth, pose: masts },
            { at: [0, 0, -40], dir: [1, 0.08, 0.2], dist: 30, water: 'sea', depth: L.periscopeDepth, pose: masts },
            { at: [0, -3, 72], dir: [1, 0.3, 0.8], dist: 30, water: 'clear' }]],
    ],
    supply: () => [
        ['RAS rigs, flight deck', [
            { at: [16, 20, -20], dir: [1, 0.45, -0.3], dist: 60 },
            { at: [0, 16, 90], dir: [-0.8, 0.6, 1], dist: 60 },
            { at: [0, 8, 0], dir: [1, 0.12, 0.1], dist: 170, water: 'clear' }]],
    ],
    rhib: () => [
        ['close-up', [
            { at: [0, 1.2, 0], dir: [1, 0.8, -0.7], dist: 9, water: 'clear' },
            { at: [0, 1.4, 0.6], dir: [-0.4, 1.0, 1.0], dist: 6.5 },
            { at: [0, 1.4, -1], dir: [0.1, 1.4, 0.2], dist: 6, pose: (m, N) => N.steerWheel(m, 1) }]],
    ],
    cb90: () => [
        ['close-up', [
            { at: [0, 1.8, 0], dir: [1, 0.7, -0.8], dist: 14, water: 'clear' },
            { at: [0, 1.6, -5], dir: [0.8, 0.9, -1.2], dist: 9, water: 'clear', pose: (m, N) => N.openHatch(m, 'door_ramp', 1) },
            { at: [0, 2.0, 3], dir: [-0.7, 1.0, 1.0], dist: 8 }]],
    ],
    slava: () => [
        ['launchers', [
            { at: [0, 12, -30], dir: [1, 0.5, -0.9], dist: 50, pose: openAll(1) },
            { at: [0, 10, 50], dir: [-1, 0.6, 0.7], dist: 50 },
            { at: [0, 6, 0], dir: [1, 0.15, 0.1], dist: 130, water: 'clear' }]],
    ],
    carrier: () => [
        ['elevators, doors,\naccommodation ladder', [
            { at: [26, 12, -89], dir: [1.2, 0.5, -0.6], dist: 45, water: 'clear', pose: (m, N) => N.setElevator(m, 0, 1) },
            { at: [22, 6, 106], dir: [1.3, 0.4, 0.3], dist: 32, water: 'clear' },
            { at: [14, 20, 25], dir: [-1, 0.5, -0.8], dist: 30, pose: (m, N) => { for (const d of Object.keys(m.rig.doors)) N.openHatch(m, 'door_' + d, 1); } }]],
    ],
};

export async function sheets(P, types = Object.keys(SPECS), opts = {}) {
    const N = await P.loadShips();
    const out = [];
    for (const type of types) {
        const m = N.shipModel(type);
        const L = m.layout || {};
        const rows = [[type + '\n' + (L.L ? L.L + ' m' : ''), await P.shipViews(type, { water: 'clear', w: 520, h: 300, ...(opts.views || {}) })]];
        for (const [label, shots] of (SPECS[type] ? SPECS[type](L) : [])) {
            const cs = [];
            for (const s of shots) cs.push(await P.shipCloseup(type, { w: 520, h: 300, ...s }));
            rows.push([label, cs]);
        }
        out.push(await P.save(P.sheet(rows, type), (opts.dir || '') + type + '.png'));
    }
    return out;
}
