// ═══════════════════════════════════════════════════════════════
// The sandbox's rules (sandbox.js is the tool that uses them): what can be placed, where it may stand, which missions
// it takes, the setup format that is saved (localStorage 'skywar.sandbox', nothing else) and the one-click scenarios.
// Pure: no DOM, no game objects — the placement checks take the terrain as functions (env), so tests run headless.
//   env: { heightAt(x, z), sideAt(x, z) → 'red' | 'blue', onRunway(x, z) → truthy, inTown(x, z) → truthy }
// ═══════════════════════════════════════════════════════════════

export const SANDBOX_KEY = 'skywar.sandbox';
export const FORMAT = 1;
export const TEAMS = ['blue', 'red', 'neutral'];
export const SIM_SPEEDS = [0, 1, 2, 4];
export const SLOTS = 3;

// ── What can be placed ──
// cat: the palette's tab; domain: where it stands ('air' anywhere at an altitude, 'land', 'water', 'coast': land near
// the sea, 'road': land, then a destination); variants: the types per side (the TYPE button cycles them); n / count:
// how many (aircraft in the flight, tanks in the platoon); alt: default altitude (m); missions: what it can be told
export const ITEMS = {
    fighter: {
        label: 'FIGHTERS', cat: 'air', domain: 'air', teams: ['blue', 'red'], n: 2, count: [1, 2, 4], alt: 5000,
        variants: { blue: ['f15', 'f16', 'fa18', 'f22', 'f35', 'typhoon', 'rafale', 'f14'], red: ['su35', 'mig29', 'su57', 'j10', 'j20', 'mig31'] },
        missions: ['cap', 'patrol', 'escort', 'strike', 'sead', 'recon', 'move', 'rtb'],
    },
    attack: {
        label: 'ATTACK JETS', cat: 'air', domain: 'air', teams: ['blue', 'red'], n: 2, count: [1, 2, 4], alt: 2500,
        variants: { blue: ['a10', 'f16', 'fa18', 'jaguar'], red: ['su35', 'j8', 'mig29', 'mirage'] },
        missions: ['strike', 'sead', 'cap', 'patrol', 'recon', 'move', 'rtb'],
    },
    bomber: {
        label: 'BOMBERS', cat: 'air', domain: 'air', teams: ['blue', 'red'], n: 2, count: [1, 2], alt: 9000,
        variants: { blue: ['b52', 'b2'], red: ['tu95'] },
        missions: ['strike', 'patrol', 'cap', 'move', 'rtb'],
    },
    awacs: { label: 'AWACS', cat: 'air', domain: 'air', teams: ['blue', 'red'], n: 1, alt: 9200, variants: { blue: ['e3'], red: ['a50'] }, missions: ['cap', 'move'] },
    tanker: { label: 'TANKER', cat: 'air', domain: 'air', teams: ['blue', 'red'], n: 1, alt: 6300, variants: { blue: ['kc135'], red: ['il78'] }, missions: ['cap', 'move'] },
    // (ownSide: the air plug-in flies these for the player's side only — one of each)
    growler: { label: 'EW JAMMER', cat: 'air', domain: 'air', teams: ['blue', 'red'], ownSide: true, n: 1, alt: 7000, variants: { blue: ['ea18g'], red: ['ea18g'] }, missions: ['cap', 'escort', 'sead'] },
    drone: { label: 'DRONE', cat: 'air', domain: 'air', teams: ['blue', 'red'], ownSide: true, n: 1, alt: 5500, variants: { blue: ['mq9', 'rq4'], red: ['mq9', 'rq4'] }, missions: ['recon'] },
    heli: { label: 'HELICOPTER', cat: 'air', domain: 'air', teams: ['blue', 'red', 'neutral'], n: 1, alt: 180, variants: { blue: ['uh60'], red: ['uh60'], neutral: ['civil'] }, missions: ['patrol', 'move', 'strike'] },
    csg: { label: 'CARRIER GROUP', cat: 'naval', domain: 'water', teams: ['blue', 'red'], missions: ['move', 'patrol', 'strike', 'escort'] },
    sag: { label: 'SURFACE GROUP', cat: 'naval', domain: 'water', teams: ['blue', 'red'], missions: ['move', 'patrol', 'strike', 'escort'] },
    ddg: { label: 'DESTROYER PAIR', cat: 'naval', domain: 'water', teams: ['blue', 'red'], missions: ['move', 'patrol', 'strike', 'escort'] },
    sub: { label: 'SUBMARINE', cat: 'naval', domain: 'water', teams: ['blue', 'red'], missions: ['move', 'patrol', 'strike'] },
    tel: { label: 'MISSILE LAUNCHERS', cat: 'ground', domain: 'land', teams: ['blue', 'red'], variants: { blue: ['atacms'], red: ['scud'] }, missions: ['strike', 'move'] },
    sam: { label: 'SAM SITE', cat: 'ground', domain: 'land', teams: ['blue', 'red'], variants: { blue: ['patriot'], red: ['s300', 'buk', 'osa'] }, missions: ['move'] },
    artillery: { label: 'ROCKET ARTILLERY', cat: 'ground', domain: 'land', teams: ['blue', 'red'], variants: { blue: ['gmlrs', 'himars', 'm270'], red: ['grad', 'smerch'] }, missions: ['strike', 'move'] },
    convoy: { label: 'CONVOY', cat: 'ground', domain: 'road', teams: ['blue', 'red'], missions: ['move', 'patrol'] },
    armour: { label: 'ARMOUR PLATOON', cat: 'ground', domain: 'land', teams: ['blue', 'red'], n: 4, count: [2, 4, 6], missions: ['move', 'patrol', 'strike'] },
    infantry: { label: 'INFANTRY SQUAD', cat: 'ground', domain: 'land', teams: ['blue', 'red'], n: 6, count: [4, 6, 8], missions: ['move', 'patrol'] },
    coastal: { label: 'COASTAL BATTERY', cat: 'sites', domain: 'coast', teams: ['blue', 'red'], missions: ['strike'] },
    radar: { label: 'RADAR', cat: 'sites', domain: 'land', teams: ['blue', 'red'], missions: [] },
    fob: { label: 'FORWARD POSITION', cat: 'sites', domain: 'land', teams: ['blue', 'red'], missions: [] },
};
export const CATEGORIES = [['air', 'AIR'], ['naval', 'NAVAL'], ['ground', 'GROUND'], ['sites', 'SITES']];
export const itemsIn = (cat) => Object.keys(ITEMS).filter(k => ITEMS[k].cat === cat);

// names the palette and the map show for a variant
export const VARIANT_NAMES = {
    f15: 'F-15C', f16: 'F-16C', fa18: 'F/A-18E', f22: 'F-22A', f35: 'F-35A', typhoon: 'TYPHOON', rafale: 'RAFALE', f14: 'F-14',
    su35: 'SU-35', mig29: 'MIG-29', su57: 'SU-57', j10: 'J-10', j20: 'J-20', mig31: 'MIG-31', a10: 'A-10C', jaguar: 'JAGUAR', j8: 'J-8', mirage: 'MIRAGE',
    b52: 'B-52H', b2: 'B-2A', tu95: 'TU-95MS', e3: 'E-3G', a50: 'A-50U', kc135: 'KC-135R', il78: 'IL-78M', ea18g: 'EA-18G', mq9: 'MQ-9A', rq4: 'RQ-4B',
    uh60: 'UH-60', civil: 'CIVIL', atacms: 'HIMARS/M270 ATACMS', scud: 'SCUD TEL', patriot: 'PATRIOT', s300: 'S-300', buk: 'BUK', osa: 'OSA',
    gmlrs: 'GMLRS BATTERY', himars: 'HIMARS', m270: 'M270', grad: 'GRAD', smerch: 'SMERCH',
};
export function variantOf(item, team, i = 0) {
    const V = ITEMS[item] && ITEMS[item].variants && ITEMS[item].variants[team];
    return V && V.length ? V[((i % V.length) + V.length) % V.length] : null;
}
export const teamsFor = (item) => (ITEMS[item] ? ITEMS[item].teams : []);

// ── Missions ── input: what the map asks for after the button ('route': waypoints, 'point', 'target': a unit or a
// point, 'unit': a unit to escort, null: nothing)
export const MISSIONS = {
    patrol: { label: 'PATROL ROUTE', input: 'route', hint: 'CLICK WAYPOINTS · RIGHT-CLICK OR ENTER: DONE · BACKSPACE: UNDO' },
    cap: { label: 'CAP ORBIT', input: 'point', hint: 'CLICK WHERE TO ORBIT' },
    strike: { label: 'STRIKE TARGET', input: 'target', hint: 'CLICK A UNIT OR A POINT TO STRIKE' },
    escort: { label: 'ESCORT', input: 'unit', hint: 'CLICK THE UNIT TO ESCORT' },
    recon: { label: 'RECON AREA', input: 'point', hint: 'CLICK THE AREA TO SEARCH' },
    sead: { label: 'SEAD', input: 'point', hint: 'CLICK THE AIR DEFENCES TO SUPPRESS' },
    move: { label: 'MOVE TO', input: 'point', hint: 'CLICK WHERE TO GO' },
    rtb: { label: 'RETURN TO BASE', input: null },
};
export function missionsFor(item) { return ((ITEMS[item] && ITEMS[item].missions) || []).filter(m => MISSIONS[m]); }
export const canTake = (item, mission) => missionsFor(item).includes(mission);

// ── Placement ──
const ring = (x, z, r, n, fn) => { for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; if (!fn(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false; } return true; };

// Can `item` stand at (x, z)? → { ok, why, y } (y: where it goes: ground or water level, or its altitude)
export function validatePlacement(item, x, z, env, opts = {}) {
    const I = ITEMS[item];
    if (!I) return { ok: false, why: 'UNKNOWN UNIT' };
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, why: 'OFF THE MAP' };
    if (Math.abs(x) > 120000 || Math.abs(z) > 120000) return { ok: false, why: 'OFF THE MAP' };
    const H = env.heightAt, h = H(x, z);
    switch (I.domain) {
        case 'air': {
            const ground = Math.max(h, 0);
            const alt = opts.alt ?? I.alt;
            const min = item === 'heli' ? 60 : 250;
            // (the altitude is above sea level; a flight asked for below the hills is lifted clear of them)
            return { ok: true, why: '', y: Math.max(alt, ground + min) };
        }
        case 'water': {
            if (h > -25) return { ok: false, why: h > 0 ? 'SHIPS NEED WATER' : 'TOO SHALLOW' };
            const r = item === 'sub' || item === 'ddg' ? 700 : 1500;
            if (!ring(x, z, r, 10, (px, pz) => H(px, pz) < -12)) return { ok: false, why: 'NOT ENOUGH OPEN WATER' };
            return { ok: true, why: '', y: 0 };
        }
        case 'land': case 'road': case 'coast': {
            if (h < 3) return { ok: false, why: h < 0 ? 'GROUND UNITS NEED LAND' : 'ON THE SHORELINE' };
            if (h > 1500) return { ok: false, why: 'TOO HIGH IN THE MOUNTAINS' };
            let steep = 0;
            for (const [ox, oz] of [[30, 0], [-30, 0], [0, 30], [0, -30]]) { const d = H(x + ox, z + oz); if (d < 1) return { ok: false, why: 'ON THE SHORELINE' }; steep = Math.max(steep, Math.abs(d - h)); }
            if (steep > 11) return { ok: false, why: 'TOO STEEP' };
            if (env.onRunway && env.onRunway(x, z)) return { ok: false, why: 'ON A RUNWAY' };
            if (env.inTown && item !== 'infantry' && env.inTown(x, z)) return { ok: false, why: 'IN A TOWN' };
            if (I.domain === 'coast') {
                let sea = false;
                for (const r of [1000, 1800, 2600, 3500]) { if (!ring(x, z, r, 16, (px, pz) => H(px, pz) > -10)) { sea = true; break; } }
                if (!sea) return { ok: false, why: 'MORE THAN 3.5 KM FROM THE SEA' };
            }
            return { ok: true, why: '', y: h };
        }
    }
    return { ok: false, why: 'UNKNOWN UNIT' };
}

// The nearest place `item` can stand, spiralling out from `anchor` (rMin..rMax, m); `side`: only on that side's ground
// (env.sideAt); `away`: at least `minFrom` m from that point. null if there's none.
export function findSpot(item, anchor, env, { rMin = 0, rMax = 20000, side = null, step = 500, away = null, minFrom = 0, alt } = {}) {
    for (let r = rMin; r <= rMax; r += step) {
        const n = r < 1 ? 1 : Math.max(8, Math.round(2 * Math.PI * r / step));
        for (let k = 0; k < n; k++) {
            const a = k / n * Math.PI * 2 + r * 0.0007;
            const x = anchor.x + Math.cos(a) * r, z = anchor.z + Math.sin(a) * r;
            if (side && env.sideAt && env.sideAt(x, z) !== side) continue;
            if (away && Math.hypot(x - away.x, z - away.z) < minFrom) continue;
            const v = validatePlacement(item, x, z, env, { alt });
            if (v.ok) return { x: Math.round(x), z: Math.round(z) };
        }
    }
    return null;
}

// ── The setup format (what's saved and what the scenarios are) ──
// { v, name, faction, background, weather, hour, clock, player?: { x, z, alt, heading }, view?: { follow: i },
//   units: [{ item, team, variant, n, alt, x, z, to?: { x, z } | 'auto', from?: base id, near?: { ref, along, side },
//             mission?: { type, route: [{ x, z }], at: { x, z }, target: { x, z } | { ref } } }] }
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const pt = (p) => (p && Number.isFinite(+p.x) && Number.isFinite(+p.z) ? { x: Math.round(+p.x), z: Math.round(+p.z) } : null);
const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'overcast'];

function cleanMission(m, nUnits) {
    if (!m || !MISSIONS[m.type]) return null;
    const out = { type: m.type };
    if (Array.isArray(m.route)) { const r = m.route.map(pt).filter(Boolean).slice(0, 24); if (r.length) out.route = r; }
    if (m.at) { const a = pt(m.at); if (a) out.at = a; }
    if (m.target) {
        if (Number.isInteger(m.target.ref) && m.target.ref >= 0 && m.target.ref < nUnits) out.target = { ref: m.target.ref };
        else { const t = pt(m.target); if (t) out.target = t; }
    }
    return out;
}

// a setup as it comes from storage or a preset → a clean copy, or null when it isn't one
export function normalizeSetup(s) {
    if (!s || typeof s !== 'object' || s.v !== FORMAT || !Array.isArray(s.units)) return null;
    const n = s.units.length;
    const units = [];
    for (const u of s.units.slice(0, 200)) {
        if (!u || !ITEMS[u.item]) continue;
        const team = TEAMS.includes(u.team) && ITEMS[u.item].teams.includes(u.team) ? u.team : ITEMS[u.item].teams[0];
        const c = { item: u.item, team, variant: num(u.variant) | 0, x: Math.round(num(u.x)), z: Math.round(num(u.z)) };
        if (u.n != null) c.n = Math.max(1, Math.min(8, num(u.n, 1) | 0));
        if (u.alt != null) c.alt = Math.max(0, Math.min(15000, Math.round(num(u.alt))));
        if (u.to === 'auto') c.to = 'auto'; else if (u.to) { const t = pt(u.to); if (t) c.to = t; }
        if (typeof u.from === 'string') c.from = u.from.slice(0, 24);
        if (u.near && Number.isInteger(u.near.ref)) c.near = { ref: u.near.ref, along: Math.max(0, Math.min(1, num(u.near.along, 0.5))), side: num(u.near.side, 150) };
        const m = cleanMission(u.mission, n);
        if (m) c.mission = m;
        units.push(c);
    }
    const out = {
        v: FORMAT, name: typeof s.name === 'string' ? s.name.slice(0, 48) : 'SETUP',
        faction: s.faction === 'red' ? 'red' : 'blue', background: !!s.background,
        weather: WEATHERS.includes(s.weather) ? s.weather : 'clear',
        hour: Math.max(0, Math.min(24, num(s.hour, 13))), clock: Math.max(0, Math.min(300, num(s.clock, 1))),
        units,
    };
    if (s.player && pt(s.player)) out.player = { ...pt(s.player), alt: Math.max(200, num(s.player.alt, 3000)), heading: num(s.player.heading, 0) };
    if (s.view && Number.isInteger(s.view.follow) && s.view.follow >= 0 && s.view.follow < units.length) out.view = { follow: s.view.follow };
    return out;
}

// ── Storage (only the sandbox's own key: the game's settings and best scores are someone else's) ──
export function readStore(storage) {
    try {
        const raw = storage && storage.getItem(SANDBOX_KEY);
        const o = raw ? JSON.parse(raw) : null;
        const slots = [];
        for (let i = 0; i < SLOTS; i++) slots.push(o && Array.isArray(o.slots) ? normalizeSetup(o.slots[i]) : null);
        return { v: FORMAT, slots };
    } catch (e) { return { v: FORMAT, slots: new Array(SLOTS).fill(null) }; }
}
export function writeStore(storage, store) {
    try { storage.setItem(SANDBOX_KEY, JSON.stringify({ v: FORMAT, slots: store.slots.map(s => s || null) })); return true; } catch (e) { return false; }
}

// ── One-click scenarios ── build(env) → a setup (spots found on the real terrain: a preset never lands a ship on a
// hill). env also carries bases: [{ id, x, z, friendly }]
const need = (p, what) => { if (!p) throw new Error('no spot for ' + what); return p; };

export const PRESETS = [
    {
        id: 'coastal', label: 'CARRIER GROUP VS COASTAL DEFENCE',
        desc: 'A carrier group closes a defended coast: Bastion anti-ship missiles, a Buk and their fighters against its screen, its CAP and a strike on the battery.',
        build(env) {
            const coast = need(findSpot('coastal', { x: 12500, z: -15000 }, env, { rMax: 14000, side: 'red' }), 'the battery');
            const csg = need(findSpot('csg', coast, env, { rMin: 16000, rMax: 34000, step: 1000 }), 'the carrier group');
            const buk = need(findSpot('sam', { x: coast.x - 2500, z: coast.z - 2500 }, env, { rMax: 8000, side: 'red' }), 'the Buk');
            const radar = need(findSpot('radar', { x: coast.x - 4000, z: coast.z }, env, { rMax: 8000, side: 'red' }), 'the radar');
            const mid = { x: (coast.x + csg.x) / 2, z: (coast.z + csg.z) / 2 };
            return {
                v: FORMAT, name: 'CARRIER GROUP VS COASTAL DEFENCE', faction: 'blue', background: false, weather: 'cloudy', hour: 11, clock: 1,
                units: [
                    { item: 'csg', team: 'blue', x: csg.x, z: csg.z, mission: { type: 'move', at: { x: Math.round(csg.x + (coast.x - csg.x) * 0.4), z: Math.round(csg.z + (coast.z - csg.z) * 0.4) } } },
                    { item: 'coastal', team: 'red', x: coast.x, z: coast.z, mission: { type: 'strike', target: { ref: 0 } } },
                    { item: 'sam', team: 'red', variant: 1, x: buk.x, z: buk.z },
                    { item: 'radar', team: 'red', x: radar.x, z: radar.z },
                    { item: 'fighter', team: 'blue', variant: 2, n: 2, alt: 5500, x: csg.x, z: csg.z, mission: { type: 'cap', at: { x: Math.round(mid.x), z: Math.round(mid.z) } } },
                    { item: 'attack', team: 'blue', variant: 2, n: 2, alt: 3000, x: csg.x + 1500, z: csg.z, mission: { type: 'strike', target: { ref: 1 } } },
                    { item: 'fighter', team: 'red', variant: 0, n: 2, alt: 6000, x: coast.x - 6000, z: coast.z - 4000, mission: { type: 'cap', at: { x: coast.x, z: coast.z } } },
                ],
                view: { follow: 5 },
            };
        },
    },
    {
        id: 'sead', label: 'SEAD PACKAGE VS S-300 AND BUK',
        desc: 'Vipers go after the radars while Eagles strike the S-300, Raptors escort, a Growler jams; a Flanker CAP defends.',
        build(env) {
            const s300 = need(findSpot('sam', { x: 12000, z: -30000 }, env, { rMax: 12000, side: 'red' }), 'the S-300');
            const buk = need(findSpot('sam', { x: 5000, z: -23000 }, env, { rMax: 9000, side: 'red', away: s300, minFrom: 5000 }), 'the Buk');
            const radar = need(findSpot('radar', { x: s300.x + 2500, z: s300.z - 1500 }, env, { rMax: 6000, side: 'red' }), 'the radar');
            const fob = findSpot('fob', { x: s300.x - 3000, z: s300.z + 2000 }, env, { rMax: 6000, side: 'red' });
            // (the package forms up south of the home field, out of the S-300's reach: the SEAD pair leads, low; the
            // strike follows 8 km behind with its escort; the Growler stands off)
            const start = { x: 0, z: 6000 };
            const units = [
                { item: 'sam', team: 'red', variant: 0, x: s300.x, z: s300.z },
                { item: 'sam', team: 'red', variant: 1, x: buk.x, z: buk.z },
                { item: 'radar', team: 'red', x: radar.x, z: radar.z },
                { item: 'fighter', team: 'blue', variant: 1, n: 2, alt: 1500, x: start.x - 1500, z: start.z, mission: { type: 'sead', at: { x: buk.x, z: buk.z } } },
                { item: 'attack', team: 'blue', variant: 1, n: 2, alt: 6000, x: start.x, z: start.z + 8000, mission: { type: 'strike', target: { ref: 0 } } },
                { item: 'fighter', team: 'blue', variant: 3, n: 2, alt: 8000, x: start.x + 1500, z: start.z + 9000, mission: { type: 'escort', target: { ref: 4 } } },
                { item: 'growler', team: 'blue', x: start.x, z: start.z + 2000, mission: { type: 'sead', at: { x: s300.x, z: s300.z } } },
                { item: 'fighter', team: 'red', variant: 0, n: 2, alt: 7000, x: s300.x, z: s300.z - 4000, mission: { type: 'cap', at: { x: Math.round((s300.x + buk.x) / 2), z: Math.round((s300.z + buk.z) / 2) } } },
            ];
            if (fob) units.push({ item: 'fob', team: 'red', x: fob.x, z: fob.z });
            return { v: FORMAT, name: 'SEAD PACKAGE VS S-300 AND BUK', faction: 'blue', background: false, weather: 'clear', hour: 14, clock: 1, units, view: { follow: 3 } };
        },
    },
    {
        id: 'scud', label: 'SCUD HUNT AT NIGHT',
        desc: 'Two Scud TELs hide in the enemy rear, one ordered to fire on the home base. A Reaper searches; you hunt. Night, clock running.',
        build(env) {
            const t1 = need(findSpot('tel', { x: 14000, z: -34000 }, env, { rMax: 12000, side: 'red' }), 'TEL 1');
            const t2 = need(findSpot('tel', { x: 2000, z: -40000 }, env, { rMax: 14000, side: 'red', away: t1, minFrom: 6000 }), 'TEL 2');
            const osa = need(findSpot('sam', { x: t1.x + 1500, z: t1.z + 1000 }, env, { rMax: 5000, side: 'red' }), 'the Osa');
            const home = (env.bases || []).find(b => b.id === 'home') || { x: 0, z: 0 };
            const area = { x: Math.round((t1.x + t2.x) / 2), z: Math.round((t1.z + t2.z) / 2) };
            return {
                v: FORMAT, name: 'SCUD HUNT AT NIGHT', faction: 'blue', background: false, weather: 'clear', hour: 23, clock: 1,
                player: { x: home.x + 2000, z: home.z - 9000, alt: 4500, heading: 0 },
                units: [
                    { item: 'tel', team: 'red', x: t1.x, z: t1.z, mission: { type: 'strike', target: { x: home.x, z: home.z } } },
                    { item: 'tel', team: 'red', x: t2.x, z: t2.z },
                    { item: 'sam', team: 'red', variant: 2, x: osa.x, z: osa.z },
                    { item: 'drone', team: 'blue', x: area.x, z: area.z + 20000, mission: { type: 'recon', at: area } },
                    { item: 'fighter', team: 'blue', variant: 0, n: 2, alt: 7000, x: home.x, z: home.z - 12000, mission: { type: 'cap', at: { x: home.x, z: home.z - 16000 } } },
                    { item: 'fighter', team: 'red', variant: 1, n: 2, alt: 6000, x: area.x, z: area.z, mission: { type: 'cap', at: area } },
                ],
            };
        },
    },
    {
        id: 'air', label: 'AIR BATTLE: 4V4 WITH AWACS',
        desc: 'Four Eagles and four Flankers on CAP stations 12 km apart, each side with its AWACS. Spectate and watch it go.',
        build(env) {
            void env;
            const blue = { x: 2000, z: -12000 }, red = { x: 6000, z: -24000 };
            return {
                v: FORMAT, name: 'AIR BATTLE: 4V4 WITH AWACS', faction: 'blue', background: false, weather: 'cloudy', hour: 15, clock: 1,
                units: [
                    { item: 'awacs', team: 'blue', alt: 9200, x: -6000, z: 14000 },
                    { item: 'awacs', team: 'red', alt: 9000, x: 12000, z: -52000 },
                    { item: 'fighter', team: 'blue', variant: 0, n: 4, alt: 7000, x: blue.x, z: blue.z + 6000, mission: { type: 'cap', at: blue } },
                    { item: 'fighter', team: 'red', variant: 0, n: 4, alt: 7500, x: red.x, z: red.z - 6000, mission: { type: 'cap', at: red } },
                ],
                view: { follow: 2 },
            };
        },
    },
    {
        id: 'ambush', label: 'CONVOY AMBUSH',
        desc: 'A supply column leaves the enemy airfield; an armour platoon and a squad wait by the road, A-10s on call.',
        build(env) {
            const gate = need(findSpot('convoy', { x: 7700, z: -17300 }, env, { rMax: 3000, step: 150 }), 'the convoy');
            return {
                v: FORMAT, name: 'CONVOY AMBUSH', faction: 'blue', background: false, weather: 'clear', hour: 17, clock: 1,
                units: [
                    { item: 'convoy', team: 'red', from: 'enemy', to: 'auto', x: gate.x, z: gate.z },
                    { item: 'armour', team: 'blue', n: 4, near: { ref: 0, along: 0.55, side: 260 }, x: 0, z: 0, mission: { type: 'strike', target: { ref: 0 } } },
                    { item: 'infantry', team: 'blue', n: 6, near: { ref: 0, along: 0.5, side: -120 }, x: 0, z: 0 },
                    { item: 'attack', team: 'blue', variant: 0, n: 2, alt: 2500, x: 2000, z: -6000, mission: { type: 'strike', target: { ref: 0 } } },
                ],
                view: { follow: 0 },
            };
        },
    },
];
