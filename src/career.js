// ═══════════════════════════════════════════════════════════════
// Career: XP, ranks, aircraft/paint unlocks, medals and lifetime stats.
// Saved in localStorage. Every sortie's score becomes XP.
// ═══════════════════════════════════════════════════════════════
import { AIRCRAFT } from './config.js';

export const RANKS = [
    { name: 'CADET', xp: 0 },
    { name: 'SECOND LIEUTENANT', xp: 1000 },
    { name: 'FIRST LIEUTENANT', xp: 4000 },
    { name: 'CAPTAIN', xp: 9000 },
    { name: 'MAJOR', xp: 17000 },
    { name: 'LIEUTENANT COLONEL', xp: 28000 },
    { name: 'COLONEL', xp: 42000 },
    { name: 'BRIGADIER GENERAL', xp: 60000 },
    { name: 'ACE OF ACES', xp: 90000 },
];

// rank index required to fly each aircraft (anything not listed is rank 0)
const AIRCRAFT_RANK = {
    f15: 1, f14: 1, j8: 1, j10: 1,
    typhoon: 2, rafale: 2, gripen: 2, f2: 2,
    f35: 3, f35n: 3, su35: 3, mig25: 3, mig31: 3,
    j20: 4, b2: 4,
    su47: 5, su57: 6, f22: 7,
};
const LIVERY_RANK = { default: 0, ghost: 0, navy: 0, desert: 1, arctic: 2, orange: 3, green: 4, red: 5, black: 6 };

export const MEDALS = {
    first_blood: { name: 'FIRST BLOOD', desc: 'Shoot down your first enemy.' },
    ace_sortie: { name: 'ACE IN A DAY', desc: 'Five kills in a single sortie.' },
    guns_kill: { name: 'KNIFE FIGHT', desc: 'Get a guns kill.' },
    trap: { name: 'TAILHOOKER', desc: 'Catch a wire on the carrier.' },
    butter: { name: 'BUTTER', desc: 'Land on a runway under 200 ft/min.' },
    belly: { name: 'WALKED AWAY', desc: 'Survive a belly landing or ditching.' },
    hijack: { name: 'GRAND THEFT AERO', desc: 'Hijack an aircraft from your parachute.' },
    rifle_pilot: { name: 'SHARPSHOOTER', desc: 'Shoot a pilot through his canopy.' },
    ship_sunk: { name: 'SHIPWRECK', desc: 'Sink an enemy warship.' },
    ace_killer: { name: 'ACE KILLER', desc: 'Shoot down an enemy ace.' },
    mission_win: { name: 'MISSION ACCOMPLISHED', desc: 'Complete any mission.' },
    all_missions: { name: 'SQUADRON LEGEND', desc: 'Complete every mission.' },
    daily: { name: 'DAILY DUTY', desc: 'Complete a Daily Mission.' },
    rings_fast: { name: 'THREAD THE NEEDLE', desc: 'Finish the Ring Race in under 3:00.' },
    deadstick: { name: 'GLIDER PILOT', desc: 'Complete the Deadstick mission.' },
    bomber: { name: 'BOMBS AWAY', desc: 'Destroy a ground target with a bomb.' },
    bridge: { name: 'A BRIDGE TOO FAR', desc: 'Drop a bridge.' },
};

const DEFAULT = { xp: 0, sorties: 0, kills: 0, groundKills: 0, deaths: 0, wins: 0, traps: 0, landings: 0, flightTime: 0, medals: {}, missionsWon: {} };

export class Career {
    constructor() {
        this.data = { ...DEFAULT };
        try { Object.assign(this.data, JSON.parse(localStorage.getItem('skywar.career') || '{}')); } catch (e) { /* ignore */ }
        this.data.medals = this.data.medals || {};
        this.data.missionsWon = this.data.missionsWon || {};
        this.unlockAll = false;
        this.listeners = [];
        this.sortieKills = 0;
    }

    save() { try { localStorage.setItem('skywar.career', JSON.stringify(this.data)); } catch (e) { /* ignore */ } }
    onChange(fn) { this.listeners.push(fn); }
    changed() { this.save(); this.listeners.forEach(fn => fn()); }

    get rankIndex() {
        let r = 0;
        for (let i = 0; i < RANKS.length; i++) if (this.data.xp >= RANKS[i].xp) r = i;
        return r;
    }
    get rank() { return RANKS[this.rankIndex]; }
    get nextRank() { return RANKS[this.rankIndex + 1] || null; }

    aircraftRank(id) { return AIRCRAFT_RANK[id] || 0; }
    liveryRank(id) { return LIVERY_RANK[id] || 0; }
    aircraftUnlocked(id) { return this.unlockAll || this.rankIndex >= this.aircraftRank(id); }
    liveryUnlocked(id) { return this.unlockAll || this.rankIndex >= this.liveryRank(id); }

    // Hook into a game session: medals and stats from gameplay events
    attach(game) {
        this.game = game;
        const ev = game.events;
        ev.on('killed', (ac, { source, kind }) => {
            if (!source || (source !== game.player && source !== game.pilotMode) || ac.team !== 'red' || ac.isPlayer) return;
            this.data.kills++;
            this.sortieKills++;
            this.award('first_blood');
            if (kind === 'gun') this.award('guns_kill');
            if (this.sortieKills >= 5) this.award('ace_sortie');
            if (ac.isAce) this.award('ace_killer');
        });
        ev.on('groundKilled', (t, { source }) => {
            if (source !== game.player) return;
            this.data.groundKills++;
            if (t.isShip) this.award('ship_sunk');
            if (t.isBridge) this.award('bridge');
            if (t.lastKind === 'bomb') this.award('bomber');
        });
        ev.on('touchdown', (ac, { vs, onRunway, onDeck, trap, late }) => {
            if (!ac.isPlayer) return;
            if (!late) this.data.landings++; // a late trap (hook down while rolling) is the same landing
            if (trap) { this.data.traps++; this.award('trap'); }
            if (onRunway && !onDeck && -vs * 196.85 < 200) this.award('butter');
        });
        ev.on('bellyStopped', (ac) => { if (ac.isPlayer) this.award('belly'); });
        ev.on('hijack', () => this.award('hijack'));
        ev.on('riflePilot', () => this.award('rifle_pilot'));
        ev.on('killed', (ac) => { if (ac.isPlayer) this.data.deaths++; });
        ev.on('pilotKilled', () => { this.data.deaths++; }); // killed after ejecting / on foot
    }

    startSortie() { this.sortieKills = 0; this.sortieStart = performance.now(); }

    // Results from game.onGameOver (or an abort)
    finishSortie(r, aborted = false) {
        const d = this.data;
        const before = this.rankIndex;
        const xp = Math.max(0, Math.round((r.score || 0) * (aborted ? 0.5 : 1)));
        d.xp += xp;
        d.sorties++;
        if (this.sortieStart) d.flightTime += (performance.now() - this.sortieStart) / 1000;
        this.sortieStart = 0;
        if (r.victory) d.wins++;
        if (r.victory && r.missionId) {
            d.missionsWon[r.missionId] = true;
            this.award('mission_win');
            if (r.daily) this.award('daily');
            if (r.missionId === 'deadstick') this.award('deadstick');
        }
        if (r.victory && r.mode === 'rings' && r.seconds < 180) this.award('rings_fast');
        const allIds = ['clean_sweep', 'five_on_one', 'ace_duel', 'sam_alley', 'escort', 'scramble', 'carrier_killer', 'deadstick', 'trap', 'bridge_out', 'heist', 'occupied'];
        if (allIds.every(id => d.missionsWon[id])) this.award('all_missions');
        this.changed();
        const after = this.rankIndex;
        return { xp, promoted: after > before ? RANKS[after].name : null, unlocked: after > before ? this.unlocksAt(after) : [] };
    }

    unlocksAt(rank) {
        const out = [];
        for (const [id, rk] of Object.entries(AIRCRAFT_RANK)) if (rk === rank && AIRCRAFT[id]) out.push(AIRCRAFT[id].name);
        for (const [id, rk] of Object.entries(LIVERY_RANK)) if (rk === rank) out.push(id.toUpperCase() + ' PAINT');
        return out;
    }

    award(id) {
        if (this.data.medals[id]) return;
        this.data.medals[id] = Date.now();
        this.save();
        const m = MEDALS[id];
        if (this.game) {
            this.game.addFeed('🎖 MEDAL: ' + m.name, '#ffd23f');
            this.game.audio.uiConfirm();
        }
        this.listeners.forEach(fn => fn());
    }

    reset() { this.data = { ...DEFAULT, medals: {}, missionsWon: {} }; this.changed(); }
}
