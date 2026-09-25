// ═══════════════════════════════════════════════════════════════
// Missions: hand-built challenges layered on the game modes, plus a Daily
// Mission picked from today's date (same for everyone on a given day).
//   base:   which game mode supplies the world (strike base, naval group…)
//   lives:  spare jets (0 = one life)
//   setup:  spawn extra actors;  check: 'win' | 'lose' | null each frame
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, isOnRunway, terrainHeight } from './world.js';
import { mulberry32, clamp, rand } from './util.js';
import { AIRCRAFT } from './config.js';
import { maxMach } from './aircraft.js';
import { ConvoyOp, pickConvoyBridge } from './convoy.js';
import { HeistOp } from './heist.js';

const home = () => BASES.find(b => b.friendly);
const redsAlive = (g) => g.aircraft.filter(a => a.team === 'red' && a.alive && !a.pilotDead);
const km = (m) => (m / 1000).toFixed(1) + ' KM';

export const MISSIONS = {
    clean_sweep: {
        title: 'CLEAN SWEEP', tag: 'STRIKE',
        desc: 'Destroy the entire enemy airbase. One jet — get shot down and it\'s over.',
        base: 'strike', start: 'air', lives: 0,
        objective: (g, base) => base + ' · ONE LIFE',
    },
    five_on_one: {
        title: 'FIVE ON ONE', tag: 'DOGFIGHT',
        desc: 'Five older jets — MiG-21, F-5, MiG-29, Mirage, J-8 — jump you at once. Splash them all.',
        base: 'custom', start: 'air', lives: 0,
        setup: (g) => g.spawnEnemies(5, null, ['mig21', 'f5', 'mig29', 'mirage', 'j8']),
        check: (g) => (redsAlive(g).length === 0 ? 'win' : null),
        objective: (g) => 'SPLASH ALL FIVE — ' + redsAlive(g).length + ' LEFT',
    },
    ace_duel: {
        title: 'ACE DUEL', tag: 'DOGFIGHT',
        desc: 'One on one against an enemy ace in a top-tier fighter. No wingmen, one life.',
        base: 'custom', start: 'air', lives: 0,
        setup: (g) => g.spawnAce(),
        check: (g) => (redsAlive(g).length === 0 ? 'win' : null),
        objective: () => 'DEFEAT THE ACE',
    },
    sam_alley: {
        title: 'SAM ALLEY', tag: 'STRIKE',
        desc: 'Knock out all four SAM sites — without missiles. Guns, rockets and bombs only.',
        base: 'strike', start: 'air', lives: 1,
        loadout: (p) => { p.missiles = 0; p.lrm = 0; p.rockets = Math.max(p.rockets, 76); p.bombs = Math.max(p.bombs, 8); },
        check: (g) => (g.ground.targets.filter(t => t.type === 'sam').every(t => !t.alive) ? 'win' : null),
        objective: (g) => 'SAM SITES LEFT: ' + g.ground.targets.filter(t => t.type === 'sam' && t.alive).length + ' · NO MISSILES',
    },
    escort: {
        title: 'ESCORT', tag: 'DEFEND',
        desc: 'A C-130 is limping home with a VIP aboard. Keep it alive all the way to the airbase.',
        base: 'custom', start: 'air', lives: 1,
        setup: (g) => {
            const b = home();
            const dir = new THREE.Vector3(1, 0, 0.4).normalize();
            const start = new THREE.Vector3(b.x, 1400, b.z).addScaledVector(dir, 16000);
            const t = g.spawnFriendly('c130', start, new THREE.Vector3(b.x, 900, b.z), 'VIP TRANSPORT');
            g.mstate = { transport: t, waves: [15, 55, 95], wave: 0 };
            g.player.pos.copy(start).add(new THREE.Vector3(-300, 200, 400));
            g.player.qv.copy(t.qv); g.player.vel.copy(t.vel).multiplyScalar(1.4); g.player.syncBody();
            g.aimDir.copy(g.player.vel).normalize();
        },
        update: (g) => {
            const s = g.mstate;
            if (s.wave < s.waves.length && g.missionTime > s.waves[s.wave]) {
                s.wave++;
                const e = g.spawnEnemies(1 + s.wave, s.transport.pos);
                e.forEach(x => { x.pilot.priority = s.transport; });
                g.showBanner('BANDITS ON THE TRANSPORT', 'Wave ' + s.wave + ' of 3', 3, '#ff9f5a');
            }
        },
        check: (g) => {
            const t = g.mstate.transport;
            if (!t.alive) return 'lose';
            const b = home();
            return Math.hypot(t.pos.x - b.x, t.pos.z - b.z) < 2500 && g.mstate.wave >= 3 && redsAlive(g).length === 0 ? 'win' : null;
        },
        objective: (g) => {
            const t = g.mstate.transport, b = home();
            return 'ESCORT: ' + km(Math.hypot(t.pos.x - b.x, t.pos.z - b.z)) + ' TO BASE · TRANSPORT ' + Math.round(t.health / t.maxHealth * 100) + '%';
        },
    },
    scramble: {
        title: 'SCRAMBLE', tag: 'INTERCEPT',
        desc: 'Bombers inbound! Start cold on the runway, get airborne and stop all three before they reach the base.',
        base: 'custom', start: 'runway', lives: 0,
        setup: (g) => {
            const b = home();
            const dir = new THREE.Vector3(-0.3, 0, -1).normalize();
            const bombers = [];
            for (let i = 0; i < 3; i++) {
                const pos = new THREE.Vector3(b.x, 2200 + i * 150, b.z).addScaledVector(dir, 30000 + i * 600).add(new THREE.Vector3(i * 250 - 250, 0, 0));
                const e = g.spawnHostile('mig25', pos, new THREE.Vector3(b.x, 1800, b.z), 'BOMBER ' + (i + 1));
                bombers.push(e);
            }
            // a slow jet (A-10, trainer…) gets older escorts and bombers it can actually catch: they hold a cruise
            // under ~80% of its top speed (a Mach 2 fighter meets them at their usual 280 m/s)
            const top = g.player.spec.flight.speed;
            const slow = top < 350, cruise = clamp(top * 0.78, 170, 280);
            for (const e of bombers) e.vel.setLength(cruise);
            const esc = g.spawnEnemies(2, { x: b.x + dir.x * 26000, z: b.z + dir.z * 26000 }, slow ? ['mig21', 'f5'] : null);
            esc.forEach(e => { e.pilot.home = bombers[0].pos; e.pilot.leash = 9000; });
            g.mstate = { bombers, cruise };
            g.audio.say('Scramble, scramble! Bombers inbound!', true);
        },
        update: (g) => {
            // speed hold: nudge each bomber's throttle toward the cruise speed
            const want = g.mstate.cruise;
            for (const e of g.mstate.bombers) if (e.alive && e.pilot) e.pilot.cruise = clamp((e.pilot.cruise ?? 0.36) + (want - e.speed) * 0.0004, 0.05, 0.95);
        },
        check: (g) => {
            const b = home();
            const live = g.mstate.bombers.filter(x => x.alive && !x.pilotDead);
            if (live.some(x => Math.hypot(x.pos.x - b.x, x.pos.z - b.z) < 2500)) { g.effects.explosion(new THREE.Vector3(b.x, b.h + 20, b.z), 5); return 'lose'; }
            return live.length === 0 ? 'win' : null;
        },
        objective: (g) => {
            const b = home();
            const live = g.mstate.bombers.filter(x => x.alive && !x.pilotDead);
            const d = Math.min(...live.map(x => Math.hypot(x.pos.x - b.x, x.pos.z - b.z)));
            return 'BOMBERS LEFT: ' + live.length + (live.length ? ' · NEAREST ' + km(d) + ' FROM BASE' : '');
        },
    },
    carrier_killer: {
        title: 'CARRIER KILLER', tag: 'NAVAL',
        desc: 'Sink the enemy carrier within 10 minutes. Its CIWS will fight your missiles.',
        base: 'naval', start: 'carrier', lives: 1,
        check: (g) => (g.missionTime > 600 && g.naval.enemyCarrier && g.naval.enemyCarrier.alive ? 'lose' : null),
        objective: (g, base) => base + ' · ' + formatClock(Math.max(0, 600 - g.missionTime)) + ' LEFT',
    },
    deadstick: {
        title: 'DEADSTICK', tag: 'SKILL',
        desc: 'Both engines just quit at 2,500 m, 11 km from base. Glide it in and stop on the runway.',
        base: 'custom', start: 'air', lives: 0,
        setup: (g) => {
            const { fwd, touch } = g.runwayApproachInfo();
            const p = g.player;
            const pos = touch.clone().addScaledVector(fwd, -11000); pos.y = 2500;
            p.spawnAir(pos, Math.atan2(-fwd.x, -fwd.z), 0.4);
            p.fuel = 0; p.flameout = true; p.forcedFlameout = true; p.controls.throttle = 0;
            g.aimDir.copy(p.vel).normalize();
            g.audio.say('Double flameout! Glide to the runway.', true);
        },
        check: (g) => {
            const p = g.player;
            if (!p.alive || p.bellied) return p.bellied && p.speed < 1 ? 'lose' : !p.alive ? 'lose' : null;
            if (!p.onGround || p.speed >= 3) return null;
            return isOnRunway(p.pos.x, p.pos.z)?.friendly ? 'win' : 'lose'; // stopped anywhere else: no engine to taxi
        },
        objective: (g) => { const b = home(), p = g.player; return 'DEADSTICK — ' + km(Math.hypot(p.pos.x - b.x, p.pos.z - b.z)) + ' TO THE RUNWAY'; },
    },
    bridge_out: {
        title: 'BRIDGE OUT', tag: 'STRIKE',
        desc: 'An armoured convoy is racing for a river bridge. Bomb the bridge before it crosses, then wipe out the stranded column.',
        base: 'custom', start: 'air', lives: 1,
        loadout: (p) => { p.bombs = Math.max(p.bombs, 6); },
        setup: (g) => {
            const pick = pickConvoyBridge(g.world.towns?.bridges);
            if (!pick) { g.mstate = { op: null }; return; }
            g.mstate = { op: new ConvoyOp(g, pick) };
            g.audio.say('Convoy on the move toward the river. Bombs will drop that bridge — missiles won\'t.', true);
        },
        update: (g) => g.mstate.op && g.mstate.op.update(),
        check: (g) => (g.mstate.op ? g.mstate.op.result : 'lose'),
        objective: (g) => (g.mstate.op ? g.mstate.op.objective() : 'NO BRIDGE FOUND'),
    },
    heist: {
        title: 'GRAND THEFT AERO', tag: 'CRIME',
        desc: 'You\'re a civilian with a plan. Carjack a car, smash through the Miramar gate, steal a jet off the flight line with the MPs on your tail, then outrun the interceptors.',
        base: 'custom', start: 'heist', lives: 0, onFoot: true,
        setup: (g) => { g.mstate = { op: new HeistOp(g) }; },
        update: (g) => g.mstate.op.update(),
        check: (g) => g.mstate.op.result,
        objective: (g, base) => base,
    },
    occupied: {
        title: 'OCCUPIED', tag: 'STRIKE',
        desc: 'Enemy troops hold a city near the front. Level the three marked buildings — command post, comms centre, barracks — under SAM cover. Everything else is civilian: more than ten wrecked homes and HQ calls it off.',
        base: 'custom', start: 'air', lives: 1,
        loadout: (p) => { p.bombs = Math.max(p.bombs, 8); p.rockets = Math.max(p.rockets, 38); },
        setup: (g) => { g.mstate = { op: new OccupiedOp(g) }; },
        update: (g) => g.mstate.op.update(),
        check: (g) => g.mstate.op.check(),
        objective: (g) => g.mstate.op.objective(),
    },
    trap: {
        title: 'TRAP', tag: 'SKILL',
        desc: 'Land on the moving carrier and catch a wire. Gear, flaps and hook (H) down, on speed, don\'t float.',
        base: 'custom', start: 'air', lives: 0,
        setup: (g) => { g.placeApproach('cv_approach', 4500); },
        check: (g) => {
            const p = g.player;
            if (!p.alive || p.bellied) return 'lose';
            if (p.onGround && !p.deck) { g.showBanner('WRONG DECK', 'That was dry land — the mission was a carrier trap.', 4, '#ff4a3d'); return 'lose'; }
            return p.onGround && p.deck && p.caughtWire && p.relSpeed < 2 ? 'win' : null;
        },
        objective: (g) => {
            const p = g.player;
            return p.onGround && p.deck && !p.caughtWire ? 'NO WIRE — FULL THROTTLE TO LAUNCH OFF THE DECK, GO ROUND AND TRY AGAIN' : 'LAND ON THE CARRIER — CATCH A WIRE';
        },
    },
};

// ── OCCUPIED: an enemy-held city. Three of its buildings are marked targets (ground targets wrapping town
// buildings, so they lock, show on the HUD and radar, and take every weapon); the rest of the town is civilian,
// and Game.buildingDestroyed counts what you knock down of it as collateral. SAM, AAA and a radar ring the town.
const COLLATERAL_LIMIT = 10;

class TownTarget {
    constructor(game, bl, b, name) {
        this.game = game; this.bl = bl; this.b = b; this.name = name;
        this.isGround = true; this.team = 'red'; this.type = 'building';
        this.def = { score: 500 };
        this.pos = new THREE.Vector3(b.x, (b.y + b.top) / 2, b.z); this.center = this.pos;
        this.radius = this.hitRadius = Math.max(b.w, b.d) / 2;
        this.vel = new THREE.Vector3(); this.incoming = [];
        b.target = this;
        b.maxHp0 = b.maxHp; b.maxHp = b.hp = Math.min(b.maxHp, 650); // a tower block would soak up a whole loadout
    }
    get alive() { return this.b.alive; }
    get health() { return Math.max(0, this.b.hp); }
    get maxHealth() { return this.b.maxHp; }
    hitTest(p) { const b = this.b; return b.alive && p.y > b.y - 1 && p.y < b.top + 1 && this.bl.inside(b, p.x, p.z, 1); }
    distTo(p) { return this.pos.distanceTo(p); }
    damage(amount, source, kind) { this.lastKind = kind; this.bl.damage(this.b, amount, this.game, source); }
    // the building came down (by whatever route — Game.buildingDestroyed tells us): score it as a ground kill
    fell(source) { if (this.down) return; this.down = true; this.game.events.emit('groundKilled', this, { source }); }
    update() {}
    remove() { const b = this.b; b.target = null; if (b.maxHp0) { b.maxHp = b.maxHp0; b.maxHp0 = 0; if (b.alive) b.hp = b.maxHp; } }
}

// the big town nearest the front: 6–22 km out, as close to the enemy airbase as possible, plenty of buildings
export function pickOccupiedTown(towns) {
    if (!towns || !towns.buildings || !towns.towns) return null;
    const home = BASES.find(b => b.friendly), enemy = BASES.find(b => !b.friendly), list = towns.buildings.list;
    let best = null, bestS = -Infinity;
    for (const t of towns.towns) {
        const d = Math.hypot(t.x - home.x, t.z - home.z);
        if (d < 6000 || d > 22000) continue;
        const n = list.filter(b => Math.hypot(b.x - t.x, b.z - t.z) < t.radius).length;
        if (n < 25) continue;
        const sc = n * 0.05 - Math.hypot(t.x - enemy.x, t.z - enemy.z) / 2000 - Math.abs(d - 13000) / 1500;
        if (sc > bestS) { bestS = sc; best = t; }
    }
    return best;
}

class OccupiedOp {
    constructor(g) {
        this.g = g;
        this.targets = [];
        const towns = g.world.towns, t = this.town = pickOccupiedTown(towns);
        if (!t) return;
        const bl = towns.buildings;
        // the marked buildings: the biggest blocks near the centre, well apart
        const vol = (b) => (b.top - b.y) * b.w * b.d;
        const inner = bl.list.filter(b => b.alive && Math.hypot(b.x - t.x, b.z - t.z) < t.radius * 0.8).sort((a, b) => vol(b) - vol(a));
        const picks = [];
        for (const b of inner) { if (picks.every(q => Math.hypot(q.x - b.x, q.z - b.z) > 70)) picks.push(b); if (picks.length === 3) break; }
        this.targets = picks.map((b, i) => { const tt = new TownTarget(g, bl, b, ['COMMAND POST', 'COMMS CENTRE', 'BARRACKS'][i]); g.ground.targets.push(tt); return tt; });
        // air defence on open ground around the edge of town
        const place = (type, r0, a0) => {
            for (let k = 0; k < 24; k++) {
                const a = a0 + k * 0.45, r = r0 + (k % 3) * 60;
                const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r, h = terrainHeight(x, z);
                if (h < 3 || bl.at(x, h + 2, z, 12)) continue;
                return g.ground.addTarget(type, x, z, rand(0, 6.28), 'red');
            }
            return null;
        };
        const R = t.radius + 320, a0 = rand(0, 6.28);
        place('sam', R, a0); place('sam', R, a0 + Math.PI);
        place('radar', R + 200, a0 + Math.PI / 2);
        for (let i = 0; i < 3; i++) place('aaa', t.radius + 120, a0 + i * 2.1 + 0.5);
        // run in from the south-west, 12 km out
        const home = BASES.find(b => b.friendly), p = g.player;
        const dir = new THREE.Vector3(t.x - home.x, 0, t.z - home.z).normalize();
        const pos = new THREE.Vector3(t.x, 0, t.z).addScaledVector(dir, -12000);
        pos.y = Math.max(terrainHeight(pos.x, pos.z), 0) + 1600;
        p.spawnAir(pos, Math.atan2(-dir.x, -dir.z), 0.62);
        g.aimDir.copy(p.vel).normalize(); g.camQuat.copy(p.quat);
        this.center = new THREE.Vector3(t.x, t.h + 150, t.z);
        g.navTarget = { pos: this.center, label: 'OCCUPIED CITY' };
        this.capT = 45;
        g.audio.say('Precision strike. Three marked buildings. Watch your collateral.', true);
    }

    update() {
        const g = this.g;
        if (!this.town) return;
        if (g.navTarget && g.navTarget.pos === this.center && g.player && g.player.pos.distanceTo(this.center) < 3500) g.navTarget = null;
        if (this.capT > 0 && g.missionTime > this.capT) {
            this.capT = 0;
            const cap = g.spawnEnemies(2, { x: this.town.x, z: this.town.z }, ['mig29', 'mig21']);
            for (const e of cap) if (e.pilot) { e.pilot.home = this.center.clone(); e.pilot.leash = 9000; }
            g.addFeed('ENEMY CAP OVER THE CITY', '#ff9f5a');
        }
    }

    check() {
        const g = this.g;
        if (!this.targets.length) return 'lose';
        if (g.collateral > COLLATERAL_LIMIT) { g.showBanner('MISSION SCRUBBED', 'Too many civilian buildings destroyed.', 5, '#ff4a3d'); return 'lose'; }
        return this.targets.every(t => !t.alive) ? 'win' : null;
    }

    objective() {
        const g = this.g;
        if (!this.targets.length) return 'NO SUITABLE TOWN FOUND';
        const left = this.targets.filter(t => t.alive).length;
        const sams = g.ground.targets.filter(t => t.type === 'sam' && t.alive).length;
        return 'MARKED BUILDINGS LEFT: ' + left + ' / ' + this.targets.length + ' · SAM SITES ' + sams + ' · COLLATERAL ' + g.collateral + ' / ' + COLLATERAL_LIMIT;
    }

    dispose() {} // the targets are ground targets: GroundForces.clear() → TownTarget.remove() restores the buildings
}

function formatClock(s) { const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

// ── Daily mission: deterministic from the date ──
export function dailyMission(date = new Date()) {
    const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const r = mulberry32(h);
    const ids = Object.keys(MISSIONS);
    const id = ids[Math.floor(r() * ids.length)];
    // no comparison model (f35n); anything but a strike mission needs a real fighter (Mach 1.4+, so not the A-10)
    const tag = MISSIONS[id].tag;
    const fighters = Object.keys(AIRCRAFT).filter(k => AIRCRAFT[k].category === 'fighter' && k !== 'f35n' && (tag === 'STRIKE' || maxMach(k) >= 1.4));
    const aircraft = fighters[Math.floor(r() * fighters.length)];
    const time = ['dawn', 'day', 'day', 'dusk', 'night'][Math.floor(r() * 5)];
    return { key, id, aircraft, time, def: MISSIONS[id] };
}
