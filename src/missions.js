// ═══════════════════════════════════════════════════════════════
// Missions: hand-built challenges layered on the game modes, plus a Daily
// Mission picked from today's date (same for everyone on a given day).
//   base:   which game mode supplies the world (strike base, naval group…)
//   lives:  spare jets (0 = one life)
//   setup:  spawn extra actors;  check: 'win' | 'lose' | null each frame
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, isOnRunway } from './world.js';
import { mulberry32 } from './util.js';
import { AIRCRAFT } from './config.js';
import { ConvoyOp, pickConvoyBridge } from './convoy.js';

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
            const esc = g.spawnEnemies(2, { x: b.x + dir.x * 26000, z: b.z + dir.z * 26000 });
            esc.forEach(e => { e.pilot.home = bombers[0].pos; e.pilot.leash = 9000; });
            g.mstate = { bombers };
            g.audio.say('Scramble, scramble! Bombers inbound!', true);
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
    trap: {
        title: 'TRAP', tag: 'SKILL',
        desc: 'Land on the moving carrier and catch a wire. Gear, flaps and hook (H) down, on speed, don\'t float.',
        base: 'custom', start: 'air', lives: 0,
        setup: (g) => { g.placeApproach('cv_approach', 4500); },
        check: (g) => {
            const p = g.player;
            if (!p.alive || p.bellied) return 'lose';
            return p.onGround && p.deck && p.relSpeed < 2 ? 'win' : null;
        },
        objective: () => 'LAND ON THE CARRIER — CATCH A WIRE',
    },
};

function formatClock(s) { const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

// ── Daily mission: deterministic from the date ──
export function dailyMission(date = new Date()) {
    const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const r = mulberry32(h);
    const ids = Object.keys(MISSIONS);
    const id = ids[Math.floor(r() * ids.length)];
    const fighters = Object.keys(AIRCRAFT).filter(k => AIRCRAFT[k].category === 'fighter');
    const aircraft = fighters[Math.floor(r() * fighters.length)];
    const time = ['dawn', 'day', 'day', 'dusk', 'night'][Math.floor(r() * 5)];
    return { key, id, aircraft, time, def: MISSIONS[id] };
}
