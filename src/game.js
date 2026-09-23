// ═══════════════════════════════════════════════════════════════
// Game: modes, waves, scoring, player control, targeting, cameras
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { AIRCRAFT, ENEMY_POOL, ENEMY_EARLY, ALLY_POOL, DIFFICULTY, WEAPONS } from './config.js';
import { Aircraft } from './aircraft.js';
import { Pilot, steerToward } from './ai.js';
import { Weapons } from './weapons.js';
import { GroundForces } from './ground.js';
import { Wreckage } from './damage.js';
import { Naval } from './naval.js';
import { PilotOnFoot, spawnFallingBody } from './pilot.js';
import { Autopilot, runwayApproach, GLIDE_SLOPE } from './autopilot.js';
import { refSpeeds } from './aircraft.js';
import { MISSIONS } from './missions.js';
import { RingCourse } from './rings.js';
import { readStick } from './input.js';
import { clamp, damp, lerp, rand, pick, formatTime, G } from './util.js';
import { BASES, RUNWAY, terrainHeight, isOnRunway } from './world.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

class Events {
    constructor() { this.map = {}; }
    on(k, fn) { (this.map[k] = this.map[k] || []).push(fn); }
    emit(k, a, b) { (this.map[k] || []).forEach(fn => fn(a, b || {})); }
}

const CAMERA_MODES = ['chase', 'cockpit', 'far', 'cinematic'];
export const SLOTS = [
    { key: 'srm', label: 'SRM', name: 'IR MISSILE', ammo: 'missiles' },
    { key: 'lrm', label: 'LRM', name: 'RADAR MISSILE', ammo: 'lrm' },
    { key: 'rkt', label: 'RKT', name: 'ROCKET POD', ammo: 'rockets' },
    { key: 'bomb', label: 'BMB', name: 'MK-82 BOMB', ammo: 'bombs' },
];
const LOADOUTS = {
    balanced: { label: 'BALANCED', srm: 1, lrm: 1 / 3, rkt: 38, bomb: 4 },
    air: { label: 'AIR SUPERIORITY', srm: 1.25, lrm: 0.5, rkt: 0, bomb: 0 },
    strike: { label: 'STRIKE', srm: 0.5, lrm: 0.17, rkt: 76, bomb: 12 },
};
export const LOADOUT_KEYS = Object.keys(LOADOUTS);
export const LOADOUT_LABELS = LOADOUTS;
const CALLSIGNS = ['VIPER', 'MAVERICK', 'JESTER', 'ICEMAN', 'GHOST', 'REAPER', 'HAWK', 'NOMAD'];
const WINGMEN = ['BOLT', 'SABRE'];

export class Game {
    constructor({ scene, camera, world, effects, audio, input, hud, cockpit, settings }) {
        Object.assign(this, { scene, camera, world, effects, audio, input, hud, cockpit, settings });
        this.events = new Events();
        this.weapons = new Weapons(this);
        this.wreckage = new Wreckage(this);
        this.ground = new GroundForces(this);
        this.naval = new Naval(this);
        this.autopilot = new Autopilot(this);
        this.pilotMode = null;
        this.lives = 0;
        this.slot = 0;
        this._surf = { h: 0, ship: null, water: false, runway: null, hull: false };
        this.aircraft = [];
        this.player = null;
        this.state = 'menu';
        this.time = 0;
        this.wind = new THREE.Vector3(3, 0, -2);
        this.feed = [];
        this.banner = null;
        this.cameraMode = 'chase';
        this.camQuat = new THREE.Quaternion();
        this.camPos = new THREE.Vector3();
        this.aimDir = new THREE.Vector3(0, 0, -1);
        this.freeLook = { yaw: 0, pitch: 0, t: 0 };
        this.shake = 0;
        this.timeScale = 1;
        this.slowmoT = 0;
        this.seeker = { x: 0, y: 0, visible: false };
        this.basesInfo = BASES.map(b => ({ x: b.x, z: b.z, friendly: b.friendly }));
        this.stick = { pitch: 0, roll: 0, yaw: 0 };
        this.bindEvents();
        input.on((a) => this.onAction(a));
    }

    // Surface under a point: moving carrier decks, runways, terrain or sea
    surfaceAt(x, z, y = 1e9) {
        const d = this.naval && this.naval.ships.length ? this.naval.deckAt(x, z, y) : null;
        if (d) return d;
        const th = terrainHeight(x, z);
        const r = this._surf;
        r.runway = isOnRunway(x, z);
        r.h = Math.max(th, 0);
        r.water = th < -0.5 && !r.runway;
        r.ship = null; r.hull = false;
        return r;
    }

    get difficulty() { return DIFFICULTY[this.settings.difficulty] || DIFFICULTY.veteran; }
    clockText() { return formatTime(this.missionTime || 0); }

    // ═════════════ Setup ═════════════
    start(opts) {
        this.cleanup();
        this.lastEjectPress = -9;
        this.autopilot.warnT = -9; this.autopilot.override = 0;
        this.mission = opts.mission ? MISSIONS[opts.mission] : null;
        this.missionId = opts.mission || null;
        this.isDaily = !!opts.daily;
        this.mstate = null;
        this.mode = this.mission ? (this.mission.base === 'custom' ? 'mission' : this.mission.base) : opts.mode;
        this.aircraftId = opts.aircraft;
        this.state = 'playing';
        this.time = 0;
        this.missionTime = 0;
        this.score = 0; this.kills = 0; this.wave = 0; this.combo = 1; this.comboT = 0;
        this.shots = 0; this.hits = 0; this.missilesFired = 0; this.missileHits = 0; this.groundKills = 0;
        this.gloc = 0; this.damageFlash = 0; this.whiteout = 0;
        this.hitmarkerT = -10; this.killmarkerT = -10;
        this.feed = [];
        this.banner = null;
        this.waveBreak = 0;
        this.deathT = 0;
        this.lockTarget = null; this.lockProgress = 0;
        this.objective = '';
        this.radarRange = 8000;
        this.cameraMode = this.settings.defaultCockpit ? 'cockpit' : 'chase';

        this.callsign = pick(CALLSIGNS);
        this.slot = 0;
        this._navalWon = false; this.navalWinT = 0; this._practiceDone = false; this.spawnT = 3;
        this.gloc = 0; this.whiteout = 0; this.missileCam = null; this.pullUp = false;
        this.photo = null; this.hideHud = false;
        if (this.nvg) { this.nvg = false; this.onNvg && this.onNvg(false); }
        if (this.rings) { this.rings.remove(); this.rings = null; }
        this.navTarget = null;
        this.lives = this.mission ? (this.mission.lives ?? 0) : ['freeflight', 'sandbox', 'practice', 'rings'].includes(this.mode) ? Infinity : 2;
        if (this.mode === 'rings') this.rings = new RingCourse(this, 7);
        this.input.consumeMouse();
        this.input.spoilersOn = false;
        this.autopilot.disengage();
        this.pilotMode = null;
        this.world.setWeather(this.settings.weather || 'clear');
        const storm = this.world.weather === 'storm', rain = this.world.weather === 'rain';
        this.wind.set(storm ? 14 : rain ? 7 : 3, 0, storm ? -10 : rain ? -5 : -2);
        this.naval.spawnHomeCarrier();
        if (this.mode === 'strike' || this.mode === 'sandbox') this.ground.spawnEnemyBase();
        if (this.mode === 'naval' || this.mode === 'sandbox') this.naval.spawnEnemyGroup();
        else if (this.mode === 'freeflight') this.naval.spawnEnemyGroup(true); // unarmed target ships to shoot at for fun
        if (this.mode === 'practice' || this.mode === 'sandbox') this.spawnPractice(this.mode === 'practice' ? 16 : 10);
        const p = this.spawnPlayer();

        const enemy = BASES[1];
        if (this.mode === 'freeflight') {
            this.objective = 'FREE FLIGHT — EXPLORE';
            this.showBanner('FREE FLIGHT', p.onGround ? 'Z or 1–0: throttle · S: rotate at takeoff speed · G: gear · F: flaps' : 'Fly anywhere. The carrier and airbase are open for landing.', 6);
        } else if (this.mode === 'strike') {
            this.spawnEnemies(2, enemy);
            this.strikeCapT = 60;
            this.showBanner('OPERATION IRON HAMMER', 'Destroy the enemy airbase to the north. Beware SAMs and AAA.', 6);
            this.audio.say('Iron Hammer, you are cleared hot. Target airbase is to your front.');
        } else if (this.mode === 'naval') {
            const c = this.naval.enemyCarrier;
            const cap = this.spawnEnemies(3, { x: c.pos.x, z: c.pos.z });
            cap.forEach(e => { e.pilot.home = c.pos; e.pilot.leash = 14000; });
            this.navalLaunchT = 50;
            this.showBanner('OPERATION TRIDENT', 'Sink the enemy carrier. Its CIWS will shoot down missiles — use rockets, bombs and guns too.', 7);
            this.audio.say('Trident flight, enemy carrier group located. Weapons free.');
        } else if (this.mode === 'practice') {
            this.showBanner('TARGET PRACTICE', 'Destroy every target board and drone as fast as you can.', 5);
        } else if (this.mode === 'sandbox') {
            this.showBanner('SANDBOX', 'Unlimited everything. N spawns bandits. Bombs away!', 5);
            this.slot = 3;
        } else if (this.mode === 'mission') {
            // custom missions set themselves up below
        } else if (this.mode === 'rings') {
            this.placeAtRing();
            this.showBanner('RING RACE', this.rings.rings.length + ' rings through the valleys. Crashing respawns you at your last ring (+5 s).', 5);
        } else {
            this.waveBreak = 3;
            this.showBanner(this.mode === 'survival' ? 'SURVIVAL' : 'DOGFIGHT', this.mode === 'survival' ? 'Endless hostiles. No repairs. Good luck.' : 'Hostile fighters inbound. Weapons free.', 4);
        }
        // wingmen
        if (this.mission) {
            this.mission.setup && this.mission.setup(this);
            this.showBanner((this.isDaily ? 'DAILY: ' : 'MISSION: ') + this.mission.title, this.mission.desc, 6, '#ffc23f');
        }
        if (this.settings.wingmen > 0 && !this.mission && !['freeflight', 'practice', 'sandbox', 'rings'].includes(this.mode)) {
            for (let i = 0; i < this.settings.wingmen; i++) {
                const id = pick(ALLY_POOL);
                const w = new Aircraft(this, id, { team: 'blue', name: WINGMEN[i] });
                const off = new THREE.Vector3(i ? -70 : 70, -8, 60 + i * 30);
                if (p.onGround) w.spawnAir(new THREE.Vector3(p.pos.x + (i ? -400 : 400), 1200, p.pos.z), 0, 0.55);
                else {
                    w.spawnAir(off.clone().applyQuaternion(p.qv).add(p.pos), 0, 0.6);
                    w.qv.copy(p.qv); w.vel.copy(p.vel); w.syncBody();
                }
                const pilot = new Pilot(this, w, clamp(this.difficulty.skill + 0.1, 0.4, 0.9));
                pilot.formation = { leader: p, offset: off };
                this.aircraft.push(w);
            }
        }
        this.world.updateTerrain(p.pos, true);
        this.input.lock();
    }

    // Where the player starts: air, runway, apron (taxi) or carrier catapult
    startPoint() {
        let w = this.mission ? this.mission.start : this.settings.start || 'auto';
        if (w === 'auto') w = this.mode === 'freeflight' || this.mode === 'sandbox' ? 'runway' : this.mode === 'naval' ? 'carrier' : 'air';
        return w;
    }

    spawnPlayer(where = this.startPoint()) {
        const p = this.player = new Aircraft(this, this.aircraftId, { team: 'blue', isPlayer: true, name: this.callsign });
        this.aircraft.push(p);
        this.rearm(p);
        this.applyLivery && this.applyLivery(p);
        const home = BASES[0];
        const carrier = this.naval.homeCarrier;
        if (where === 'carrier' && carrier) {
            p.spawnDeck(carrier);
            this.addFeed('FULL POWER (9 OR 0) ON DECK TO LAUNCH', '#5dffa0');
        } else if (where === 'runway') {
            p.spawnRunway(home);
        } else if (where === 'apron') {
            // parked by the hangars: taxi out to the runway
            p.spawnRunway(home);
            p.pos.set(home.x + 290, home.h + p.gearOffset, home.z + 60);
            p.qv.setFromAxisAngle(_v.set(0, 1, 0), Math.PI / 2); // facing west toward the taxiway
            p.syncBody();
            this.addFeed('TAXI: FOLLOW THE TAXIWAY TO THE RUNWAY (A/D STEER)', '#5dffa0');
        } else {
            let pos, heading = 0;
            if (this.mode === 'strike') {
                const e = BASES[1];
                const dir = _v.set(e.x - home.x, 0, e.z - home.z).normalize();
                heading = Math.atan2(-dir.x, -dir.z);
                pos = new THREE.Vector3(home.x, 1600, home.z).addScaledVector(dir, 2500);
            } else if (this.mode === 'naval' && this.naval.enemyCarrier) {
                const e = this.naval.enemyCarrier.pos;
                const dir = _v.set(e.x, 0, e.z).normalize();
                heading = Math.atan2(-dir.x, -dir.z);
                pos = new THREE.Vector3(0, 1800, 0).addScaledVector(dir, 3000);
            } else pos = new THREE.Vector3(0, 1800, 2500);
            p.spawnAir(pos, heading, 0.62);
        }
        this.aimDir.copy(p.vel.lengthSq() > 1 && !p.onGround ? p.vel : _v.set(0, 0, -1).applyQuaternion(p.quat)).normalize();
        this.camQuat.copy(p.quat);
        this.camPos.copy(p.pos).add(_v.set(0, 6, 30).applyQuaternion(p.quat));
        this.rotateSpeed = refSpeeds(p.spec).takeoff;
        this.lockTarget = null; this.lockProgress = 0;
        this._lowHpCall = false;
        return p;
    }

    respawnPlayer() {
        if (this.lives <= 0) { this.gameOver(false); return; }
        if (this.lives !== Infinity) this.lives--;
        if (this.pilotMode) { this.removeSeat(this.pilotMode.seat); this.pilotMode = null; }
        if (this.player) {
            const old = this.player;
            old.isPlayer = false; old.abandoned = true;
            // an unmanned jet left circling forever would clutter the sky: let it go
            if (old.alive) { old.alive = false; old.explode(false); }
        }
        const w = this.startPoint();
        this.spawnPlayer(w === 'air' ? 'air' : w);
        if (this.mode === 'rings') { this.placeAtRing(); this.missionTime += 5; this.addFeed('+5 s PENALTY', '#ffc23f'); }
        this.state = 'playing';
        this.deathT = 0;
        this.autopilot.disengage();
        this.input.spoilersOn = false;
        this.gloc = 0; this.whiteout = 0; this.damageFlash = 0;
        this.cameraMode = this.settings.defaultCockpit ? 'cockpit' : 'chase';
        this.showBanner('NEW AIRFRAME', this.lives === Infinity ? '' : this.lives + ' SPARE JET' + (this.lives === 1 ? '' : 'S') + ' LEFT', 3);
        this.input.lock();
    }

    placeAtRing() {
        const pose = this.rings.spawnPose();
        const p = this.player;
        p.spawnAir(pose.pos, pose.heading, 0.55);
        this.aimDir.copy(p.vel).normalize();
        this.camQuat.copy(p.quat);
        this.ringPrev = p.pos.clone();
    }

    // ── Mission helpers ──
    spawnFriendly(id, pos, waypoint, name) {
        const a = new Aircraft(this, id, { team: 'blue', name });
        const d = _v.subVectors(waypoint, pos).setY(0).normalize();
        a.spawnAir(pos, Math.atan2(-d.x, -d.z), 0.55);
        const pl = new Pilot(this, a, 0.5);
        pl.passive = true; pl.waypoint = waypoint.clone(); pl.cruise = 0.7;
        this.aircraft.push(a);
        return a;
    }

    spawnHostile(id, pos, waypoint, name) {
        const a = new Aircraft(this, id, { team: 'red', name });
        const d = _v.subVectors(waypoint, pos).setY(0).normalize();
        a.spawnAir(pos, Math.atan2(-d.x, -d.z), 0.5);
        const pl = new Pilot(this, a, 0.5);
        pl.passive = true; pl.waypoint = waypoint.clone(); pl.cruise = 0.36;
        a.flares = 6;
        this.aircraft.push(a);
        return a;
    }

    runwayApproachInfo() { return runwayApproach(BASES.find(b => b.friendly)); }

    // ── Quick positions (Free Flight / Sandbox): jump to a landing approach or a takeoff spot ──
    get quickPositionsAllowed() { return this.mode === 'freeflight' || this.mode === 'sandbox'; }

    quickPosition(kind) {
        if (!this.quickPositionsAllowed) return;
        const cv = this.naval.homeCarrier && this.naval.homeCarrier.alive ? this.naval.homeCarrier : null;
        if (kind.startsWith('cv') && !cv) { this.addFeed('NO CARRIER AVAILABLE', '#ffc23f'); return; }
        if (this.pilotMode) { this.removeSeat(this.pilotMode.seat); this.pilotMode = null; }
        this.photo = null; this.hideHud = false; this.missileCam = null;
        const old = this.player;
        if (old) { old.remove(); const i = this.aircraft.indexOf(old); if (i >= 0) this.aircraft.splice(i, 1); }
        this.autopilot.disengage();
        this.input.spoilersOn = false;
        if (kind === 'rwy_takeoff') this.spawnPlayer('runway');
        else if (kind === 'cv_takeoff') this.spawnPlayer('carrier');
        else {
            this.spawnPlayer('air');
            this.placeApproach(kind);
        }
        this.world.updateTerrain(this.player.pos, true);
        if (this.state === 'paused') this.pause(false);
        this.state = 'playing';
    }

    placeApproach(kind, distance = null) {
        const cv = this.naval.homeCarrier;
        {
            const p = this.player;
            const app = refSpeeds(p.spec).approach;
            let fwd, touch, shipVel = new THREE.Vector3(), dist;
            if (kind === 'cv_approach') {
                fwd = new THREE.Vector3(-Math.sin(cv.heading), 0, -Math.cos(cv.heading));
                touch = cv.toWorld(-4, cv.deckY, cv.def.L * 0.3);
                shipVel.copy(cv.vel);
                dist = distance || 3000;
            } else {
                const ra = runwayApproach(BASES.find(b => b.friendly));
                fwd = ra.fwd; touch = ra.touch;
                dist = clamp(ra.clearDist - 300, 2500, 5000);
            }
            const pos = touch.clone().addScaledVector(fwd, -dist);
            pos.y = touch.y + dist * Math.tan(GLIDE_SLOPE) + p.gearOffset;
            // never start inside a hill: stay clear of the highest ground under the rest of the approach
            if (kind === 'cv_approach') {
                // the carrier can steam near a coast: start short of any land under the glide path
                for (let d = 200; d <= dist; d += 100) {
                    const gy = touch.y + d * Math.tan(GLIDE_SLOPE);
                    if (terrainHeight(touch.x - fwd.x * d, touch.z - fwd.z * d) > gy - 40) { dist = Math.max(1200, d - 300); break; }
                }
                pos.copy(touch).addScaledVector(fwd, -dist);
                pos.y = touch.y + dist * Math.tan(GLIDE_SLOPE) + p.gearOffset;
            }
            let hi = 0;
            for (let d = 0; d <= dist; d += 100) hi = Math.max(hi, terrainHeight(touch.x - fwd.x * d, touch.z - fwd.z * d));
            pos.y = Math.max(pos.y, hi + 60);
            p.spawnAir(pos, Math.atan2(-fwd.x, -fwd.z), 0.3);
            // already configured: gear and full flaps down, on speed, on the glide slope
            p.gear = true; p.gearAnim = 1; p.flaps = 2; p.flapAnim = 1; p._lastFlaps = 2; p.balloon = 0;
            p.vel.copy(fwd).multiplyScalar(app).add(shipVel);
            p.vel.y = -app * Math.tan(GLIDE_SLOPE);
            p.throttle = p.controls.throttle = 0.45;
            p.syncBody();
            this.aimDir.copy(p.vel).sub(shipVel).normalize();
            this.camQuat.copy(p.quat);
            this.addFeed(kind === 'cv_approach' ? 'CARRIER APPROACH — CATCH A WIRE' : 'RUNWAY APPROACH — ' + Math.round(app * 1.944) + ' KT ON THE GLIDE SLOPE', '#5dffa0');
        }
    }

    removeSeat(seat) {
        if (!seat) return;
        this.scene.remove(seat.root);
        const i = this.wreckage.seats.indexOf(seat);
        if (i >= 0) this.wreckage.seats.splice(i, 1);
    }

    // ── Ejection & hijacking ──
    ejectPlayer() {
        const p = this.player;
        if (!p || !p.alive || this.pilotMode || p.spec.category === 'civil') return;
        this.wreckage.eject(p); // emits 'eject' → enters pilot mode
        p.abandoned = true;
        p.controls.pitch = p.controls.roll = p.controls.yaw = 0;
    }

    enterPilotMode(ac, seat) {
        ac.isPlayer = false;
        ac.abandoned = true;
        this.autopilot.disengage();
        this.pilotMode = new PilotOnFoot(this, seat, ac);
        this.state = 'playing';
        this.missileCam = null;
        this.showBanner('EJECTED', 'Mouse: look · LMB: AK-47 · R: reload · WASD: steer canopy · E: hijack a nearby jet', 5, '#ffc23f');
        this.input.lock();
    }

    killPilot(a) {
        a.pilotDead = true;
        if (a.pilot) { a.pilotAI = a.pilot; a.pilot = null; }
        a.controls.pitch = 0.05; a.controls.roll = 0; a.controls.yaw = 0;
        this.score += 200;
        this.killmarkerT = this.time;
        this.slowmoT = 0.4;
        this.addFeed('PILOT KILLED — PRESS E TO HIJACK  +200', '#ffc23f');
        this.events.emit('riflePilot', a);
        this.audio.say(pick(['Pilot is down!', 'Got him through the canopy!']));
    }

    completeHijack(a, pm) {
        if (!a || !a.alive || a.exploded) return;
        if (a.pilotDead) {
            spawnFallingBody(this, a);
            this.addFeed('SHOVED THE PILOT OUT', '#ffc23f');
            this.audio.say('Get out of my plane!', true);
        } else if (a.pilot && !a.abandoned) {
            this.wreckage.eject(a);
            this.addFeed(a.callsign + ' BAILED OUT FOR YOU', '#5ab8ff');
        }
        if (pm) this.removeSeat(pm.seat);
        this.autopilot.disengage();
        this.input.spoilersOn = false;
        if (this.player && this.player !== a) this.player.isPlayer = false;
        for (const m of a.incoming) m.target = null; // friendly missiles chasing the stolen jet go dumb
        a.incoming.length = 0;
        if (a.lockedBy) a.lockedBy.clear();
        a.pilot = null; a.pilotAI = null; a.pilotDead = false; a.abandoned = false;
        a.ejected = false; a.ejectT = -1; a.ejectSeat = null;
        a.team = 'blue'; a.isPlayer = true; a.callsign = this.callsign;
        a.lrm = a.lrm ?? 0; a.rockets = a.rockets ?? 0; a.bombs = a.bombs ?? 0;
        a.fuel = Math.max(a.fuel ?? 1, 0.6); a.flameout = false;
        if (this.mission && this.mission.loadout) this.mission.loadout(a); // mission weapon rules still apply
        this.player = a;
        this.pilotMode = null;
        this.state = 'playing';
        this.aimDir.copy(a.vel.lengthSq() > 1 && !a.onGround ? a.vel : a.getForward(_v)).normalize();
        this.rotateSpeed = refSpeeds(a.spec).takeoff;
        this.camQuat.copy(a.quat);
        this.lockTarget = null;
        this.score += 500;
        this.showBanner('HIJACKED!', a.spec.name.toUpperCase() + ' IS YOURS  +500', 3.5, '#ffc23f');
        this.events.emit('hijack', a);
    }

    pilotKilled() {
        this.addFeed('PILOT KIA', '#ff4a3d');
        this.state = 'dead';
        this.deathT = 0;
        this.audio.say('Pilot down.', true);
    }

    // ── Target practice: boards on the hills + drones ──
    spawnPractice(n) {
        let placed = 0;
        for (let t = 0; t < 600 && placed < n; t++) {
            const a = Math.random() * Math.PI * 2, d = rand(2500, 9000);
            const x = Math.cos(a) * d, z = 2000 + Math.sin(a) * d;
            const h = terrainHeight(x, z);
            if (h < 60) continue;
            this.ground.addTarget(Math.random() < 0.7 ? 'board' : 'tank', x, z, Math.random() * 6.28, 'red');
            placed++;
        }
        if (this.mode !== 'practice') return;
        for (let i = 0; i < 4; i++) {
            const d = new Aircraft(this, pick(['f5', 'mig21', 'mirage']), { team: 'red', name: 'DRONE ' + (i + 1) });
            const a = (i / 4) * Math.PI * 2;
            d.spawnAir(new THREE.Vector3(Math.cos(a) * 5000, 1300 + i * 250, 2000 + Math.sin(a) * 5000), a, 0.5);
            const pl = new Pilot(this, d, 0.3);
            pl.passive = true;
            pl.home = new THREE.Vector3(Math.cos(a) * 3000, 1300 + i * 250, 2000 + Math.sin(a) * 3000);
            d.flares = 0;
            this.aircraft.push(d);
        }
    }

    cleanup() {
        this.aircraft.forEach(a => a.remove());
        this.aircraft = [];
        this.player = null;
        this.pilotMode = null;
        this.missileCam = null;
        this.weapons.clear();
        this.wreckage.clear();
        this.effects.clear();
        this.ground.clear();
        this.naval.clear();
        if (this.rings) { this.rings.remove(); this.rings = null; }
        this.navTarget = null;
    }

    // ═════════════ Spawning ═════════════
    spawnEnemies(n, near = null, ids = null) {
        const p = this.player;
        const center = near ? _v.set(near.x, 0, near.z) : p.pos;
        const baseAngle = Math.random() * Math.PI * 2;
        const sk = this.difficulty.skill;
        const spawned = [];
        for (let i = 0; i < n; i++) {
            const pool = this.wave <= 2 && !near ? ENEMY_EARLY : ENEMY_POOL;
            const id = ids ? ids[i % ids.length] : pick(pool);
            const e = new Aircraft(this, id, { team: 'red' });
            const a = baseAngle + (i - n / 2) * 0.15;
            const dist = near ? rand(800, 2500) : rand(5500, 7500);
            const pos = new THREE.Vector3(center.x + Math.cos(a) * dist, 0, center.z + Math.sin(a) * dist);
            pos.y = Math.max(terrainHeight(pos.x, pos.z), 0) + (near ? rand(900, 1800) : clamp(p.pos.y + rand(-300, 600), 900, 4500));
            const toP = _v2.subVectors(p.pos, pos).setY(0).normalize();
            e.spawnAir(pos, Math.atan2(-toP.x, -toP.z), 0.65);
            const skill = clamp(sk + rand(-0.1, 0.1) + (this.wave || 0) * 0.02, 0.15, 1);
            new Pilot(this, e, skill);
            this.aircraft.push(e);
            spawned.push(e);
        }
        return spawned;
    }

    spawnAce() {
        const [e] = this.spawnEnemies(1);
        const names = ['KOSCHEI', 'SPECTRE', 'WRAITH', 'VORTEX', 'ZERO-ONE', 'BASILISK', 'HALCYON'];
        const id = pick(['su57', 'su47', 'su35', 'j20']);
        // swap airframe for a top-tier one
        e.remove();
        this.aircraft.splice(this.aircraft.indexOf(e), 1);
        const ace = new Aircraft(this, id, { team: 'red', name: pick(names) });
        ace.spawnAir(e.pos.clone(), Math.atan2(-(this.player.pos.x - e.pos.x), -(this.player.pos.z - e.pos.z)), 0.7);
        ace.isAce = true;
        ace.maxHealth = ace.health = ace.maxHealth * 1.5;
        ace.flares += 20;
        new Pilot(this, ace, 1);
        this.aircraft.push(ace);
        this.showBanner('ACE INBOUND: ' + ace.callsign, ace.spec.name.toUpperCase() + ' — HIGHLY DANGEROUS', 4.5, '#ffc23f');
        this.audio.say('Warning! Enemy ace ' + ace.callsign + ' has entered the area!', true);
        return ace;
    }

    nextWave() {
        this.wave++;
        const d = this.difficulty;
        const n = Math.min(Math.round((1 + this.wave * 0.8) * d.waveScale), 7);
        this.spawnEnemies(n);
        if (this.wave % 4 === 0) { this.spawnAce(); return; }
        this.showBanner('WAVE ' + this.wave, n + ' HOSTILE' + (n > 1 ? 'S' : '') + ' INBOUND', 3.5, '#ff9f5a');
        this.audio.say(pick(['Heads up, ', 'Warning, ', 'Contact, ']) + n + ' bandits inbound.');
    }

    // ═════════════ Events ═════════════
    bindEvents() {
        const ev = this.events;
        ev.on('hit', (ac, { source, amount, kind }) => {
            if (ac.isPlayer) {
                this.damageFlash = Math.min(1, this.damageFlash + amount / 40);
                this.shake = Math.min(1.5, this.shake + amount / 25);
                this.audio.thud(0.5);
                if (ac.health / ac.maxHealth < 0.35 && !this._lowHpCall) { this._lowHpCall = true; this.audio.say("I'm hit! I'm hit!", true); }
            }
            if (source === this.player) {
                if (kind === 'gun') this.hits++;
                this.hitmarkerT = this.time;
                if (kind === 'gun') this.audio.tick(2600, 0.1, 0.025);
            }
        });
        ev.on('bulletHit', () => {});
        ev.on('killed', (ac, { source, kind }) => {
            if (this.state === 'over') return;
            if (ac.isPlayer) {
                this.state = 'dead';
                this.deathT = 0;
                const crashed = kind === 'crash' && (!source || this.time - ac.lastHitTime > 5);
                if (crashed) {
                    this.showBanner('CRASHED', ac.onGround || ac.pos.y < 300 ? 'Too fast, too hard, or not level — check the approach speed on the HUD' : '', 4, '#ff4a3d');
                    this.audio.say(pick(['That was not a landing.', 'Ouch.', 'Well, that was a mess.']), true);
                } else {
                    this.showBanner('SHOT DOWN', source && source.spec ? 'by ' + source.spec.name : '', 4, '#ff4a3d');
                    this.audio.say('Mayday, mayday! Ejecting!', true);
                }
                return;
            }
            if (ac.abandoned) return;
            const byPlayer = source === this.player;
            const name = ac.spec.name;
            if (ac.team === 'red') {
                if (byPlayer) {
                    this.kills++;
                    if (this.time - this.comboT < 12) this.combo = Math.min(this.combo + 1, 8); else this.combo = 1;
                    this.comboT = this.time;
                    const base = 100 + Math.round(ac.pilot ? ac.pilot.skill * 100 : 50);
                    const bonus = kind === 'gun' ? 50 : 0;
                    const pts = (base + bonus + (ac.isAce ? 1500 : 0)) * this.combo;
                    if (ac.isAce) { this.showBanner('ACE ' + ac.callsign + ' SHOT DOWN', '+' + pts, 4, '#ffc23f'); this.audio.say('You got the ace! Outstanding!', true); }
                    this.score += pts;
                    this.killmarkerT = this.time; this.hitmarkerT = this.time;
                    this.addFeed('SPLASH ' + name.toUpperCase() + (kind === 'gun' ? ' [GUNS]' : '') + '  +' + pts, '#5dffa0');
                    this.audio.say(pick(['Splash one!', 'Good kill, good kill!', 'Bandit down!', 'Target destroyed!', 'Splash!']));
                    if (this.mode === 'survival') { this.player.health = Math.min(this.player.maxHealth, this.player.health + 6); this.player.missiles = Math.min(this.player.spec.missiles, this.player.missiles + 1); }
                    this.slowmoT = 0.35;
                } else {
                    this.addFeed((source && source.callsign ? source.callsign : 'ALLY') + ' SPLASHED ' + name.toUpperCase(), '#5ab8ff');
                    this.score += 25;
                }
            } else {
                this.addFeed(ac.callsign + ' IS DOWN', '#ff4a3d');
                this.audio.say(ac.callsign + ' is down!', true);
            }
        });
        ev.on('exploded', (ac) => {
            const d = this.camera.position.distanceTo(ac.pos);
            this.audio.boom(d, 1.2);
            if (d < 500) this.shake = Math.min(1.5, this.shake + (500 - d) / 400);
        });
        ev.on('groundKilled', (t, { source }) => {
            const d = this.camera.position.distanceTo(t.pos);
            this.audio.boom(d, 1.4);
            if (source === this.player || (source && source.team === 'blue')) {
                const pts = t.def.score * (source === this.player ? this.combo : 1);
                this.score += pts;
                this.groundKills++;
                this.addFeed(t.name + ' DESTROYED  +' + pts, '#ffc23f');
                if (source === this.player) { this.killmarkerT = this.time; this.hitmarkerT = this.time; }
                if (t.type === 'sam') this.audio.say('SAM site destroyed.');
                else if (t.type === 'radar') this.audio.say('Radar is down, SAMs are blind.');
                else if (t.type === 'bunker') this.audio.say('Command bunker destroyed!');
            }
        });
        ev.on('missileLaunch', (ac, { target }) => {
            if (ac === this.player) {
                this.missilesFired++;
                this.audio.whoosh(0.5);
                this.audio.say(pick(['Fox two!', 'Fox two.', 'Missile away!']));
            } else {
                const d = this.camera.position.distanceTo(ac.pos);
                if (d < 1500) this.audio.whoosh(0.4 * (1 - d / 1500));
                if (target === this.player) {
                    this.addFeed(ac.kind === 'sam' || ac.isGround ? 'SAM LAUNCH' : 'MISSILE LAUNCH', '#ff4a3d');
                    this.audio.say(ac.isGround ? 'SAM launch! SAM launch!' : 'Missile, missile! Break!', true);
                }
            }
        });
        ev.on('missileHit', (owner, { target }) => { if (owner === this.player && !target.isFlare) this.missileHits++; });
        ev.on('decoyed', (owner, { victim }) => {
            if (victim === this.player) { this.addFeed('MISSILE DEFEATED', '#5dffa0'); this.audio.say('Missile defeated!'); }
            if (owner === this.player) this.addFeed('MISSILE DECOYED', '#ffc23f');
        });
        ev.on('eject', (ac, { seat }) => {
            if (ac.isPlayer) { this.addFeed('EJECTED', '#ffc23f'); this.enterPilotMode(ac, seat); return; }
            const d = this.player ? ac.pos.distanceTo(this.player.pos) : 1e9;
            this.addFeed((ac.team === 'red' ? 'ENEMY' : ac.callsign) + ' PILOT EJECTED', ac.team === 'red' ? '#9fb2c4' : '#5ab8ff');
            if (d < 3000 && ac.team === 'red') this.audio.say(pick(['Good chute!', 'Pilot ejected.', 'I see a chute.']));
        });
        ev.on('partLost', (ac) => {
            if (ac.isPlayer) { this.addFeed('WING DAMAGED', '#ff4a3d'); this.audio.say('Lost part of my wing!', true); this.shake = 1.5; }
            else if (this.player && ac.lastHitBy === this.player) this.addFeed('WING SHOT OFF', '#ffc23f');
        });
        ev.on('flares', (ac) => { if (ac.isPlayer) this.audio.flares(); });
        ev.on('touchdown', (ac, { vs, onRunway, onDeck, trap }) => {
            if (!ac.isPlayer) return;
            const fpm = Math.round(-vs * 196.85);
            if (onDeck) {
                this.addFeed((trap ? 'TRAP! ' : 'DECK LANDING — NO WIRE ') + fpm + ' FPM', trap ? '#5dffa0' : '#ffc23f');
                if (trap) { this.score += 400; this.showBanner('TRAP!', 'Caught the wire +400', 2.5); this.audio.say('Nice trap!'); this.shake = 0.8; }
                return;
            }
            this.addFeed('TOUCHDOWN ' + fpm + ' FPM' + (onRunway ? '' : ' (OFF-RUNWAY)'), fpm < 300 ? '#5dffa0' : '#ffc23f');
            if (fpm < 200 && onRunway) { this.score += 200; this.showBanner('BUTTER!', 'Perfect landing +200', 2.5); }
        });
        ev.on('bellyLanded', (ac, { water, collapsed, dmg }) => {
            if (!ac.isPlayer) return;
            this.shake = 1.5;
            this.showBanner(water ? 'DITCHED!' : collapsed ? 'GEAR COLLAPSED!' : 'BELLY LANDING!', 'Hull -' + Math.round(dmg) + '%', 3.5, '#ffc23f');
            this.audio.say(water ? 'Ditching, ditching!' : 'Brace, brace, brace!', true);
            this.audio.boom(0, 0.6);
        });
        ev.on('bellyStopped', (ac, { water }) => {
            if (!ac.isPlayer) return;
            const pts = this.mode === 'freeflight' || this.mode === 'sandbox' ? 150 : 0;
            this.score += pts;
            this.showBanner(water ? 'DITCHED — YOU SURVIVED' : 'CRASH LANDED — YOU SURVIVED', 'ENTER: new jet · J J: bail out' + (pts ? '  +' + pts : ''), 6, '#5dffa0');
            this.audio.say(pick(['We walked away from that one.', 'Any landing you can walk away from!', 'Well, that happened.']));
        });
        ev.on('flameout', (ac) => {
            if (!ac.isPlayer) return;
            this.showBanner('FLAMEOUT', 'Out of fuel — glide to a runway or carrier!', 5, '#ff4a3d');
            this.audio.say('Flameout! Flameout! We are out of gas!', true);
        });
        ev.on('shipSecondary', (ship, { stage }) => {
            if (ship.team === 'red') this.addFeed(ship.name + (stage === 3 ? ' IS BURNING OUT OF CONTROL' : ' — SECONDARY EXPLOSION'), '#ffc23f');
            else this.addFeed(ship.name + ' IS TAKING DAMAGE', '#ff4a3d');
        });
        ev.on('flapsBlown', (ac) => { if (ac.isPlayer) this.addFeed('FLAPS AUTO-RETRACTED — OVER 340 KT', '#ffc23f'); });
        ev.on('ciwsKill', (ship, { missile }) => {
            if (missile.owner === this.player) this.addFeed('MISSILE SHOT DOWN BY CIWS', '#ffc23f');
        });
        ev.on('bomb', (ac) => { if (ac.isPlayer) this.audio.say(pick(['Bombs away!', 'Pickle, pickle.', 'Bomb released.'])); });
    }

    rearm(p) {
        const L = LOADOUTS[this.settings.loadout] || LOADOUTS.balanced;
        const m = p.spec.missiles;
        p.missiles = Math.round(m * L.srm);
        p.lrm = m ? Math.max(L.lrm > 0.3 ? 2 : 1, Math.round(m * L.lrm)) : 0;
        p.rockets = m ? L.rkt * (p.type === 'a10' ? 2 : 1) : 0;
        p.bombs = m || p.spec.category === 'bomber' ? L.bomb * (p.spec.category === 'bomber' ? 4 : 1) : 0;
        p.flares = p.spec.flares;
        if (p.spec.gun) p.ammo = p.spec.gun.ammo;
        p.refuel(1);
        if (this.mission && this.mission.loadout) this.mission.loadout(p);
    }

    cycleLoadout() {
        const k = LOADOUT_KEYS[(LOADOUT_KEYS.indexOf(this.settings.loadout || 'balanced') + 1) % LOADOUT_KEYS.length];
        this.settings.loadout = k;
        this.onSettingsChange && this.onSettingsChange();
        this.rearm(this.player);
        this.showBanner('LOADOUT: ' + LOADOUTS[k].label, 'Reloaded on the ground', 2.5);
    }

    get slotDef() { return SLOTS[this.slot || 0]; }
    get slotW() { const k = this.slotDef.key; return k === 'lrm' ? WEAPONS.lrm : k === 'rkt' ? WEAPONS.rkt : k === 'bomb' ? WEAPONS.bomb : WEAPONS.missile; }

    selectSlot(i) {
        this.slot = (i + SLOTS.length) % SLOTS.length;
        this.lockProgress = 0;
        this.addFeed(this.slotDef.label + ' — ' + this.slotDef.name + ' (' + this.player[this.slotDef.ammo] + ')', '#5dffa0');
        this.audio.tick(900, 0.1, 0.05);
    }

    addFeed(text, color) {
        this.feed.unshift({ text, color, t: this.time });
        if (this.feed.length > 6) this.feed.pop();
    }

    showBanner(text, sub = '', dur = 3, color) { this.banner = { text, sub, t: this.time, dur, color }; }

    // ═════════════ Actions ═════════════
    togglePhoto() {
        if (this.photo) {
            this.photo = null; this.hideHud = false; this.addFeed('PHOTO MODE OFF', '#5dffa0');
            if (this.settings.controlMode === 'mousestick' && !this.pilotMode) this.input.unlock();
            return;
        }
        const target = this.pilotMode ? this.pilotMode.pos : this.player.pos;
        const off = _v.subVectors(this.camera.position, target);
        this.photo = { yaw: Math.atan2(off.x, off.z), pitch: Math.asin(clamp(off.y / Math.max(off.length(), 1), -0.95, 0.95)), dist: clamp(off.length(), 8, 400), target: target.clone() };
        this.hideHud = true;
        this.world.clearFlash();
        this.input.lock();
    }

    onAction(a) {
        if (a === 'photo' && (this.state === 'playing' || this.photo)) { this.togglePhoto(); return; }
        if (this.photo && a !== 'pause' && a !== 'lockLost') return; // frozen: no flying while taking pictures
        if (a === 'lockLost') {
            if (this.state === 'playing' && (this.settings.controlMode !== 'mousestick' || this.pilotMode)) this.pause(true);
            return;
        }
        if (a === 'pause') {
            if (document.querySelector('.modal.show') && this.state === 'paused') { document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show')); return; }
            if (this.state === 'playing') this.pause(true);
            else if (this.state === 'paused') this.pause(false);
            return;
        }
        if (a === 'click' && (this.state === 'playing') && (this.settings.controlMode !== 'mousestick' || this.pilotMode)) this.input.lock();
        if (this.state !== 'playing') return;
        if (this.pilotMode) {
            if (a === 'camera') this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
            return;
        }
        if (!this.player || !this.player.alive) return;
        const p = this.player;
        switch (a) {
            case 'camera': {
                const i = CAMERA_MODES.indexOf(this.cameraMode);
                this.cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
                this.cineT = 0;
                break;
            }
            case 'target': this.cycleTarget(); break;
            case 'weapon': this.selectSlot(this.slot + 1); break;
            case 'slot1': this.selectSlot(0); break;
            case 'slot2': this.selectSlot(1); break;
            case 'slot3': this.selectSlot(2); break;
            case 'slot4': this.selectSlot(3); break;
            case 'thr1': case 'thr2': case 'thr3': case 'thr4': case 'thr5':
            case 'thr6': case 'thr7': case 'thr8': case 'thr9': case 'thr10': {
                // 1 = idle … 9 = full military power, 0 (10) = afterburner
                const n = parseInt(a.slice(3), 10);
                p.controls.throttle = n >= 10 ? 1 : ((n - 1) / 8) * 0.9;
                this.throttleStep = n;
                this.throttleStepT = this.time;
                this.audio.tick(500 + n * 60, 0.06, 0.04);
                break;
            }
            case 'nvg':
                this.nvg = !this.nvg;
                this.onNvg && this.onNvg(this.nvg);
                this.addFeed(this.nvg ? 'NIGHT VISION ON' : 'NIGHT VISION OFF', '#5dffa0');
                this.audio.tick(1400, 0.08, 0.06);
                break;
            case 'autoland':
                if (this.autopilot.active === 'land') this.autopilot.disengage('AUTOPILOT OFF');
                else this.autopilot.land();
                break;
            case 'autotakeoff':
                if (this.autopilot.active === 'takeoff') this.autopilot.disengage('AUTOPILOT OFF');
                else this.autopilot.takeoff();
                break;
            case 'spoilers':
                this.input.spoilersOn = !this.input.spoilersOn;
                this.addFeed(this.input.spoilersOn ? 'SPOILERS OUT' : 'SPOILERS IN', '#5dffa0');
                this.audio.tick(250, 0.12, 0.25);
                break;
            case 'flaps':
                p.flaps = (p.flaps + 1) % 3;
                this.addFeed('FLAPS ' + ['UP', 'HALF', 'FULL'][p.flaps], '#5dffa0');
                this.audio.tick(300, 0.12, 0.3);
                break;
            case 'eject':
                if (this.time - (this.lastEjectPress || -9) < 0.6) this.ejectPlayer();
                else { this.lastEjectPress = this.time; this.addFeed('PRESS J AGAIN TO EJECT', '#ff4a3d'); }
                break;
            case 'spawn':
                if (this.mode === 'sandbox' || this.mode === 'freeflight') { this.spawnEnemies(1); this.addFeed('BANDIT SPAWNED', '#ff9f5a'); }
                break;
            case 'loadout':
                if (p.onGround && p.speed < 3 && this.atFriendlyPad(p)) this.cycleLoadout();
                break;
            case 'confirm':
                if (p.bellied && p.speed < 2) this.respawnPlayer();
                break;
            case 'missile':
                if (p.bellied) break;
                this.firePlayerMissile(); break;
            case 'flares': this.weapons.dropFlares(p, this.time); break;
            case 'gear':
                if (p.bellied) break;
                p.gear = !p.gear;
                this.addFeed(p.gear ? 'GEAR DOWN' : 'GEAR UP', '#5dffa0');
                this.audio.tick(400, 0.15, 0.2);
                break;
            case 'help': this.onHelp && this.onHelp(); break;
            case 'missilecam': {
                const mine = this.weapons.missiles.filter(m => m.owner === p && m.kind !== 'rkt');
                this.missileCam = this.missileCam ? null : mine[mine.length - 1] || null;
                if (!this.missileCam && !mine.length) this.addFeed('NO MISSILE IN FLIGHT', '#9fb2c4');
                break;
            }
        }
    }

    pause(on) {
        this.state = on ? 'paused' : 'playing';
        this.onPause && this.onPause(on);
        this.input.consumeMouse();
        if (on) {
            this.world.clearFlash();
            this.input.freeMouse = false;
            this.input.unlock();
            try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* ignore */ }
        } else {
            document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
            if (this.settings.controlMode !== 'mousestick' || this.pilotMode) this.input.lock();
        }
    }

    firePlayerMissile() {
        const p = this.player;
        const slot = this.slotDef;
        if (p[slot.ammo] <= 0) { this.audio.tick(200, 0.1, 0.1); this.addFeed('NO ' + slot.label + ' LEFT — X TO SWITCH', '#ffc23f'); return; }
        if (slot.key === 'bomb') {
            if (this.time - p.lastMissile < 0.25 || p.onGround) return;
            p.lastMissile = this.time;
            this.weapons.dropBomb(p);
            if (this.mode !== 'sandbox') p.bombs--;
            return;
        }
        if (slot.key === 'rkt') {
            if (this.time - p.lastMissile < 0.35) return;
            p.lastMissile = this.time;
            const n = Math.min(4, p.rockets);
            for (let i = 0; i < n; i++) this.weapons.fireMissile(p, null, 'rkt');
            p.rockets -= n;
            this.audio.whoosh(0.35);
            this.shake = Math.max(this.shake, 0.3);
            return;
        }
        if (this.time - p.lastMissile < 0.6) return;
        p.lastMissile = this.time;
        const t = this.lockProgress >= 1 ? this.lockTarget : null;
        this.weapons.fireMissile(p, t, slot.key === 'lrm' ? 'lrm' : 'aam');
        p[slot.ammo]--;
        if (!t) this.addFeed('NO LOCK — UNGUIDED', '#ffc23f');
        if (p[slot.ammo] === 0) this.addFeed(slot.label + ' EMPTY — PRESS X', '#ffc23f');
    }

    atFriendlyPad(p) {
        return (isOnRunway(p.pos.x, p.pos.z)?.friendly && !p.deck) || (p.deck && p.deck.team === 'blue');
    }

    candidates() {
        const out = [];
        for (const a of this.aircraft) if (a.alive && a.team !== 'blue' && !a.onGround) out.push(a);
        if (this.ground) for (const t of this.ground.targets) if (t.alive && t.team !== 'blue') out.push(t);
        return out;
    }

    cycleTarget() {
        const p = this.player;
        const fwd = p.getForward(_v);
        const list = this.candidates()
            .map(t => ({ t, d: t.pos.distanceTo(p.pos), dot: _v2.subVectors(t.pos, p.pos).normalize().dot(fwd) }))
            .filter(o => o.d < 15000)
            .sort((a, b) => b.dot - a.dot);
        if (!list.length) { this.lockTarget = null; return; }
        const i = list.findIndex(o => o.t === this.lockTarget);
        this.lockTarget = list[(i + 1) % list.length].t;
        this.lockProgress = 0;
        this.audio.tick(1200, 0.08, 0.04);
    }

    updateTargeting(dt) {
        const p = this.player;
        const fwd = p.getForward(_v);
        let t = this.lockTarget;
        if (t && (!t.alive || t.pos.distanceTo(p.pos) > 16000)) { t = this.lockTarget = null; this.lockProgress = 0; }
        if (!t) {
            // auto-select the target nearest the nose
            let best = null, bestS = -Infinity;
            for (const c of this.candidates()) {
                const d = c.pos.distanceTo(p.pos);
                if (d > 12000) continue;
                const dot = _v2.subVectors(c.pos, p.pos).normalize().dot(fwd);
                const s = dot * 2 - d / 8000 - (c.isGround ? 0.4 : 0);
                if (s > bestS) { bestS = s; best = c; }
            }
            t = this.lockTarget = best;
        }
        this.seeker.visible = false;
        if (!t) { this.lockProgress = 0; return; }
        const rel = _v2.subVectors(t.pos, p.pos);
        const dist = rel.length();
        const dot = rel.divideScalar(dist).dot(fwd);
        const W = this.slotW;
        const ammoOk = p[this.slotDef.ammo] > 0 && !W.unguided;
        const range = t.isGround ? Math.max(6000, W.range * 0.7) : W.range;
        const inCone = ammoOk && dot > W.lockCone && dist < range;
        if (inCone) this.lockProgress = Math.min(1, this.lockProgress + dt / W.lockTime);
        else this.lockProgress = Math.max(0, this.lockProgress - dt * 2);
        if (inCone || this.lockProgress > 0) {
            // seeker circle drifts from boresight toward the target
            const bs = this.hud.projectDir(fwd, this.camera, {});
            const tp = this.hud.project(t.pos, this.camera, {});
            if (bs.front && tp.front) {
                const k = Math.min(1, this.lockProgress * 1.2);
                this.seeker.x = lerp(bs.x, tp.x, k); this.seeker.y = lerp(bs.y, tp.y, k);
                this.seeker.visible = true;
            }
        }
    }

    // ═════════════ Player control ═════════════
    updatePlayer(dt, mouse) {
        const p = this.player;
        const s = readStick(this.input, this.settings);
        const c = p.controls;
        const mode = this.settings.controlMode;
        // smoothed keyboard stick for fine control
        const rate = 6;
        this.stick.pitch = damp(this.stick.pitch, s.pitch, s.pitch ? rate : rate * 1.5, dt);
        this.stick.roll = damp(this.stick.roll, s.roll, s.roll ? rate * 1.4 : rate * 2, dt);
        this.stick.yaw = damp(this.stick.yaw, s.yaw, rate, dt);
        if (s.pad) { this.stick.pitch = s.pitch; this.stick.roll = s.roll; }

        this.input.freeMouse = mode === 'mouseaim' && !this.input.locked;
        if (mode === 'mouseaim' && !this.input.locked && this.input.mouse.seen && document.hasFocus()) {
            // no pointer lock: keep turning while the cursor rests near a screen edge
            const ex = this.input.mouse.x / window.innerWidth - 0.5, ey = this.input.mouse.y / window.innerHeight - 0.5;
            if (Math.abs(ex) > 0.4) mouse.dx += Math.sign(ex) * (Math.abs(ex) - 0.4) * 4000 * dt;
            if (Math.abs(ey) > 0.4) mouse.dy += Math.sign(ey) * (Math.abs(ey) - 0.4) * 4000 * dt;
        }
        if (mode === 'mouseaim') {
            // mouse rotates the aim direction; the autopilot flies toward it
            const sens = 0.0022 * this.settings.sensitivity;
            const up = _v.set(0, 1, 0);
            _q.setFromAxisAngle(up, -mouse.dx * sens);
            this.aimDir.applyQuaternion(_q);
            const right = _v2.crossVectors(this.aimDir, up).normalize();
            const pitchDelta = -mouse.dy * sens * (this.settings.invertPitch ? -1 : 1);
            const newDir = this.aimDir.clone().applyAxisAngle(right, pitchDelta);
            if (Math.abs(newDir.y) < 0.985) this.aimDir.copy(newDir);
            this.aimDir.normalize();
            if (p.onGround) {
                c.pitch = this.stick.pitch; c.roll = this.stick.roll; c.yaw = this.stick.yaw;
                // on the runway, holding the mouse up rotates
                const fwd = p.getForward(_v3);
                if (this.aimDir.y > fwd.y + 0.08) c.pitch = Math.max(c.pitch, 1);
            } else {
                steerToward(p, this.aimDir, c, 1, true);
                if (s.manual) {
                    c.pitch = clamp(c.pitch * 0.2 + this.stick.pitch, -1, 1);
                    c.roll = clamp(c.roll * 0.2 + this.stick.roll, -1, 1);
                    // keyboard input drags the aim point along with the nose
                    this.aimDir.lerp(p.getForward(_v3), 1 - Math.exp(-4 * dt)).normalize();
                }
                c.yaw = clamp(c.yaw + this.stick.yaw, -1, 1);
            }
        } else if (mode === 'mousestick') {
            // GeoFS-style: mouse position relative to screen centre is the stick
            const w = window.innerWidth, h = window.innerHeight;
            const mx = clamp((this.input.mouse.x - w / 2) / (w * 0.3), -1, 1);
            const my = clamp((this.input.mouse.y - h / 2) / (h * 0.3), -1, 1);
            const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
            this.mouseStick = { x: mx, y: my };
            c.roll = clamp(curve(mx) + this.stick.roll, -1, 1);
            c.pitch = clamp(curve(my) * (this.settings.invertPitch ? -1 : 1) + this.stick.pitch, -1, 1);
            c.yaw = this.stick.yaw;
        } else {
            c.pitch = this.stick.pitch; c.roll = this.stick.roll; c.yaw = this.stick.yaw;
            // mouse free-look in keyboard mode
            const fs = 0.004 * this.settings.sensitivity;
            this.freeLook.yaw = clamp(this.freeLook.yaw - mouse.dx * fs, -2.6, 2.6);
            this.freeLook.pitch = clamp(this.freeLook.pitch - mouse.dy * fs, -1.2, 1.4);
            if (mouse.dx || mouse.dy) this.freeLook.t = 1.2;
            this.freeLook.t -= dt;
            if (this.freeLook.t < 0) { this.freeLook.yaw = damp(this.freeLook.yaw, 0, 3, dt); this.freeLook.pitch = damp(this.freeLook.pitch, 0, 3, dt); }
        }
        // throttle
        c.throttle = clamp(c.throttle + s.throttleDelta * dt * 0.6 - mouse.wheel * 0.05, 0, 1);
        const tc = this.input.touch;
        if (tc && tc.throttle != null) { c.throttle = tc.throttle; tc.throttle = null; }
        if (tc && tc.active && mode !== 'keyboard') { c.pitch = this.stick.pitch; c.roll = this.stick.roll; } // touch flies like a stick
        if (p.onGround) {
            // Space = wheel brakes on the ground (guns still on LMB); B = spoilers
            p.airbrake = s.airbrake;
            p.wheelBrake = this.input.down('Space');
            s.fire = this.input.mouse.left;
            if (p.deck && c.throttle >= 0.89 && p.relSpeed < 5 && p.startCatapult()) {
                this.addFeed('CATAPULT!', '#5dffa0');
                this.shake = 1.2;
                this.audio.whoosh(0.8);
            }
        } else { p.airbrake = s.airbrake; p.wheelBrake = false; }
        // autopilot flies until the pilot touches the stick
        if (this.autopilot.active) {
            // accidental bumps only warn; sustained input takes control
            const ap = this.autopilot;
            const nudge = (mode !== 'keyboard' ? Math.abs(mouse.dx) + Math.abs(mouse.dy) : 0) + (s.manual ? 900 * dt : 0);
            ap.override = Math.max(0, (ap.override || 0) + nudge - 250 * dt);
            if (nudge > 0) ap.warnT = this.time;
            if (ap.override > 450) { ap.override = 0; ap.disengage('AUTOPILOT OFF — YOU HAVE CONTROL'); }
            else ap.update(dt, p);
        }
        if (this.mode === 'sandbox') { if (p.spec.gun) p.ammo = p.spec.gun.ammo; p.fuel = 1; p.flameout = false; p.health = p.maxHealth; p.missiles = Math.max(p.missiles, 2); p.lrm = Math.max(p.lrm, 1); p.rockets = Math.max(p.rockets, 8); p.bombs = Math.max(p.bombs, 4); p.flares = Math.max(p.flares, 5); }
        this.firing = s.fire;
        if (s.fire && p.spec.gun && p.ammo > 0) {
            if (this.weapons.fireGun(p, this.time)) this.shots++;
            this.shake = Math.max(this.shake, 0.12);
        }

        // G effects
        const g = p.gLoad;
        if (g > 7.2) this.gloc = Math.min(1, this.gloc + (g - 7.2) * 0.09 * dt);
        else if (g < -2.5) { this.gloc = Math.min(1, this.gloc + (-2.5 - g) * 0.15 * dt); this.redout = true; }
        else { this.gloc = Math.max(0, this.gloc - (g < 5 ? 0.45 : 0.1) * dt); if (this.gloc < 0.05) this.redout = false; }
        if (!this.settings.gEffects) this.gloc = 0;

        // ground proximity warning
        let pull = false;
        if (!p.onGround && p.gearAnim < 0.5) {
            for (const t of [2, 4]) {
                _v.copy(p.pos).addScaledVector(p.vel, t);
                if (_v.y < Math.max(terrainHeight(_v.x, _v.z), 0) + 30) pull = true;
            }
        }
        this.pullUp = pull;

        // cloud whiteout
        this.whiteout = damp(this.whiteout, this.world.cloudDensityAt(this.camera.position) * 0.9, 4, dt);

        // repair / rearm / refuel on a friendly runway or carrier deck
        if (p.onGround && p.speed < 3 && !p.bellied && this.atFriendlyPad(p)) {
            this.rearmT = (this.rearmT || 0) + dt;
            if (this.rearmT > 1) {
                p.health = Math.min(p.maxHealth, p.health + 30 * dt);
                p.refuel(dt * 0.15);
                if (this.rearmT > 4 && !this._rearmDone) { this._rearmDone = true; this.rearm(p); this.addFeed('REARMED & REFUELLED — L: CHANGE LOADOUT', '#5ab8ff'); this.audio.say('You are rearmed and refuelled.'); }
                if (!this._rearmMsg) { this._rearmMsg = true; this.addFeed('REPAIRING, REFUELLING & REARMING…', '#5ab8ff'); }
            }
        } else { this.rearmT = 0; this._rearmMsg = false; this._rearmDone = false; }
        // fuel callouts
        if (p.fuel < 0.2 && !this._bingo && this.settings.fuel !== false && this.mode !== 'sandbox') { this._bingo = true; this.addFeed('BINGO FUEL — RETURN TO BASE', '#ffc23f'); this.audio.say('Bingo fuel. Return to base.'); }
        if (p.fuel > 0.3) this._bingo = false;
    }

    // ═════════════ Main update ═════════════
    update(rawDt) {
        if (this.state === 'paused' || this.state === 'menu') return;
        if (this.photo) {
            // frozen world, free orbit camera: mouse orbits, wheel zooms
            const m = this.input.consumeMouse(), ph = this.photo, cam = this.camera;
            ph.yaw -= m.dx * 0.005; ph.pitch = clamp(ph.pitch + m.dy * 0.004, -1.4, 1.4);
            ph.dist = clamp(ph.dist * (1 + m.wheel * 0.08), 5, 1500);
            cam.position.set(Math.sin(ph.yaw) * Math.cos(ph.pitch), Math.sin(ph.pitch), Math.cos(ph.yaw) * Math.cos(ph.pitch)).multiplyScalar(ph.dist).add(ph.target);
            cam.up.set(0, 1, 0); cam.lookAt(ph.target);
            cam.fov = damp(cam.fov, 50, 4, rawDt); cam.updateProjectionMatrix();
            this.cockpit.enabled = false;
            if (this.player) this.player.root.visible = !this.player.exploded;
            this.world.update(0, cam, ph.target, this.wind);
            this.audio.update(rawDt, null, { playing: false });
            return;
        }
        // brief slow-motion on kills
        if (this.slowmoT > 0) { this.slowmoT -= rawDt; this.timeScale = damp(this.timeScale, 0.3, 20, rawDt); }
        else this.timeScale = damp(this.timeScale, 1, 6, rawDt);
        const dt = rawDt * this.timeScale;
        this.time += dt;
        if (this.state === 'playing') this.missionTime += dt;
        const mouse = this.input.consumeMouse();

        const p = this.player;
        const pm = this.pilotMode;
        if (pm && this.state === 'playing') {
            if (pm.alive) pm.update(dt, mouse);
            this.firing = false;
        } else if (this.state === 'playing' && p.alive) {
            this.updatePlayer(dt, mouse);
            this.updateTargeting(dt);
        } else if (p && p.isPlayer) {
            p.controls.throttle = 0;
            this.firing = false;
        }
        for (const a of this.aircraft) if (a.lockedBy) a.lockedBy.clear(); // lockers re-register each frame
        for (const a of this.aircraft) if (a.pilot && a.alive && !a.pilotDead) a.pilot.update(dt);
        for (const a of this.aircraft) a.update(dt);
        this.weapons.update(dt);
        this.wreckage.update(dt);
        this.ground.update(dt);
        this.naval.update(dt);
        this.updateMode(dt);

        // purge dead AI that finished exploding
        for (let i = this.aircraft.length - 1; i >= 0; i--) {
            const a = this.aircraft[i];
            if (a.exploded && a !== this.player) {
                a.remove();
                this.aircraft.splice(i, 1);
            }
        }
        for (const a of this.aircraft) if (a.lockedBy) for (const l of a.lockedBy) if (!l.alive) a.lockedBy.delete(l);

        this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
        if (pm || !p || !p.alive || this.state !== 'playing') {
            this.gloc = Math.max(0, this.gloc - rawDt * 0.8);
            this.whiteout = Math.max(0, this.whiteout - rawDt * 2);
            this.pullUp = false;
        }
        this.shake = Math.max(0, this.shake - rawDt * 2.2);
        if (this.state === 'dead') {
            this.deathT += rawDt;
            if (this.deathT > 4.5) {
                if (this.lives > 0) this.respawnPlayer();
                else this.gameOver(false);
            }
        }
        this.updateCamera(rawDt, mouse);
        this.world.update(dt, this.camera, pm ? pm.pos : p ? p.pos : this.camera.position, this.wind);
        this.world.updateWeather(rawDt, this.camera, this);
        this.effects.update(dt, this.camera, this.scene.fog, (x, z) => Math.max(terrainHeight(x, z), 0));
        if (this.cockpit && this.cockpit.enabled && pm) this.cockpit.updateRifle(rawDt, this, this.camera, this.world, pm);
        else if (this.cockpit && this.cockpit.enabled && p && p.alive) this.cockpit.update(rawDt, this, this.camera, this.world);
        this.audio.update(rawDt, pm ? null : p, {
            playing: this.state === 'playing' || this.state === 'dead',
            cockpit: this.cameraMode === 'cockpit',
            firing: this.firing,
            seeking: this.lockTarget && this.lockProgress > 0 && this.lockProgress < 1,
            locked: this.lockProgress >= 1,
            missileIncoming: p && p.incoming.length > 0,
            spiked: p && p.lockedBy && p.lockedBy.size > 0,
            pullUp: this.pullUp,
            stall: p && p.stalling,
            scrape: p && p.bellied && p.alive ? Math.min(1, p.speed / 60) : 0,
        });
    }

    updateMode(dt) {
        if (this.state !== 'playing') return;
        const p = this.pilotMode ? { pos: this.pilotMode.pos, vel: this.pilotMode.seat.vel } : this.player;
        const enemiesAlive = this.aircraft.filter(a => a.team === 'red' && a.alive && !a.pilotDead).length;
        if (this.mode === 'dogfight') {
            if (enemiesAlive === 0) {
                if (this.waveBreak <= 0 && this.wave > 0) {
                    this.waveBreak = 6;
                    const bonus = 250 * this.wave;
                    this.score += bonus;
                    this.showBanner('WAVE ' + this.wave + ' CLEAR', 'Resupplied. Bonus +' + bonus, 3.5);
                    this.audio.say('Area clear. Rearming.');
                    if (this.player.alive && !this.pilotMode) {
                        this.rearm(this.player);
                        this.player.health = Math.min(this.player.maxHealth, this.player.health + this.player.maxHealth * 0.4);
                    }
                    this._lowHpCall = false;
                }
                this.waveBreak -= dt;
                if (this.waveBreak <= 0) this.nextWave();
            }
            this.objective = 'WAVE ' + this.wave + ' — HOSTILES: ' + enemiesAlive;
        } else if (this.mode === 'survival') {
            const want = Math.min(1 + Math.floor(this.missionTime / 35), 8);
            this.wave = want;
            this.spawnT = (this.spawnT ?? 3) - dt;
            if (enemiesAlive < want && this.spawnT <= 0) {
                this.spawnEnemies(1);
                this.spawnT = 4;
            }
            this.objective = 'SURVIVE — THREAT LEVEL ' + want;
            this.score += dt * 2;
            this.score = Math.round(this.score * 10) / 10;
        } else if (this.mode === 'strike') {
            const rem = this.ground.remaining;
            this.objective = 'TARGETS REMAINING: ' + rem + ' / ' + this.ground.total;
            this.strikeCapT -= dt;
            if (this.strikeCapT <= 0 && enemiesAlive < 3) {
                this.strikeCapT = rand(50, 80);
                this.spawnEnemies(this.difficulty.skill > 0.7 ? 2 : 1, BASES[1]);
                this.addFeed('ENEMY FIGHTERS SCRAMBLING', '#ff9f5a');
            }
            if (rem === 0) {
                this.score += 2000;
                this.gameOver(true);
            }
        } else if (this.mode === 'naval') {
            const c = this.naval.enemyCarrier;
            const escorts = this.naval.ships.filter(x => x.team === 'red' && x.type === 'destroyer' && x.alive).length;
            this.objective = c && c.alive ? 'SINK THE CARRIER — HULL ' + Math.round(c.health / c.maxHealth * 100) + '% · ESCORTS ' + escorts : 'CARRIER SUNK';
            this.navalLaunchT -= dt;
            if (c && c.alive && this.navalLaunchT <= 0 && enemiesAlive < 4) {
                this.navalLaunchT = rand(55, 85);
                // deck launch: a fighter leaves the bow at flying speed
                const e = new Aircraft(this, pick(['su35', 'su57', 'mig29', 'j20']), { team: 'red' });
                const bow = c.toWorld(10, c.deckY + 12, -c.def.L * 0.55);
                e.spawnAir(bow, c.heading, 0.35);
                const pl = new Pilot(this, e, clamp(this.difficulty.skill + rand(-0.1, 0.1), 0.2, 1));
                pl.home = c.pos; pl.leash = 14000;
                this.aircraft.push(e);
                this.effects.smoke.emit(bow, _v.set(0, 5, 0), 3, 10, 30, [1, 1, 1], [0.9, 0.9, 0.9], 0.6, 0, 1, 2);
                this.addFeed('ENEMY CARRIER LAUNCHING FIGHTERS', '#ff9f5a');
            }
            if (c && !c.alive && !this._navalWon) {
                this._navalWon = true;
                this.navalWinT = 6;
                this.score += 5000;
                this.showBanner('CARRIER SUNK', '+5000', 5, '#5dffa0');
            }
            if (this._navalWon) { this.navalWinT -= dt; if (this.navalWinT <= 0) this.gameOver(true); }
        } else if (this.mode === 'practice') {
            const tg = this.ground.targets.filter(t => !t.isShip && t.team === 'red');
            const left = tg.filter(t => t.alive).length + this.aircraft.filter(a => a.team === 'red' && a.alive).length;
            const total = tg.length + 4;
            this.objective = 'TARGETS ' + (total - left) + ' / ' + total + ' · ' + this.clockText();
            if (left === 0 && !this._practiceDone) {
                this._practiceDone = true;
                this.score += Math.max(500, Math.round(10000 - this.missionTime * 25));
                this.gameOver(true);
            }
        } else if (this.mode === 'sandbox') {
            this.objective = 'SANDBOX — N: SPAWN BANDIT · X: WEAPONS · BOMBS AWAY';
        } else if (this.mode === 'rings' && this.rings && this.player.alive && !this.pilotMode) {
            const rc = this.rings;
            rc.update(dt);
            if (this.ringPrev && rc.check(this.ringPrev, p.pos)) {
                this.audio.uiConfirm();
                this.score += 100;
                if (rc.done) {
                    this.score += Math.max(500, Math.round(20000 - this.missionTime * 90));
                    this.showBanner('FINISH!', this.clockText(), 4, '#5dffa0');
                    this.gameOver(true);
                    return;
                }
                this.addFeed('RING ' + rc.next + ' / ' + rc.rings.length + ' · ' + this.clockText(), '#5dffa0');
            }
            this.ringPrev = (this.ringPrev || new THREE.Vector3()).copy(p.pos);
            const t = rc.target;
            this.navTarget = t ? { pos: t.pos, label: 'RING ' + (rc.next + 1) } : null;
            this.objective = 'RING ' + (rc.next + 1) + ' / ' + rc.rings.length + ' · ' + this.clockText();
        }
        if (this.mission) {
            this.mission.update && this.mission.update(this);
            if (this.mission.objective) this.objective = this.mission.objective(this, this.objective);
            let r = this.mission.check ? this.mission.check(this) : null;
            if (!r && this.lives <= 0 && this.pilotMode) r = 'lose'; // one-life missions end when you bail out
            if (r && this.state === 'playing') {
                this.gameOver(r === 'win');
                return;
            }
        }
        // soft combat boundary
        this.outOfBounds = !['freeflight', 'sandbox', 'naval'].includes(this.mode) && Math.hypot(p.pos.x, p.pos.z - (this.mode === 'strike' ? -8000 : 0)) > 30000;
        if (p.pos.y > 14000 && p.vel) p.vel.y -= 10 * dt;
    }

    gameOver(victory) {
        if (victory && this.mission) this.score += 1500 + (this.lives > 0 ? 500 * this.lives : 0);
        this.state = 'over';
        this.input.unlock();
        const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
        this.onGameOver && this.onGameOver({
            victory, score: Math.round(this.score), kills: this.kills, wave: this.wave, time: this.clockText(),
            accuracy: acc, missiles: this.missilesFired, missileHits: this.missileHits, groundKills: this.groundKills,
            mode: this.mission ? 'missions' : this.mode, aircraft: this.aircraftId,
            mission: this.mission ? this.mission.title : null, missionId: this.missionId, daily: this.isDaily, seconds: this.missionTime,
        });
        if (victory) this.audio.say(this.mission ? 'Mission accomplished. Outstanding work.' : 'Mission complete. All targets destroyed. Return to base.', true);
        else if (this.mission) this.audio.say('Mission failed.', true);
    }

    // ═════════════ Camera ═════════════
    updateCamera(dt, mouse) {
        const cam = this.camera, p = this.player;
        if (!p) return;
        const pm = this.pilotMode;
        if (pm) {
            p.root.visible = !p.exploded;
            this.cockpit.enabled = true;
            const head = pm.headPos(_v);
            if (pm.hijackT > 0 && pm.hijackTarget) {
                const k = 1 - pm.hijackT / 0.7;
                const tgt = _v2.copy(pm.hijackTarget.rig.cockpit).applyMatrix4(pm.hijackTarget.model.matrixWorld);
                head.lerp(tgt, k * k);
            }
            cam.position.copy(head);
            cam.quaternion.setFromEuler(new THREE.Euler(pm.pitch + pm.recoil, pm.yaw, 0, 'YXZ'));
            cam.fov = damp(cam.fov, 72, 4, dt);
            cam.updateProjectionMatrix();
            return;
        }
        const L = Math.max(p.spec.length, 12);
        let fov = 60;
        let mode = this.state === 'dead' || this.state === 'over' ? 'death' : this.cameraMode;
        if (this.missileCam) {
            const m = this.missileCam;
            if (this.weapons.missiles.includes(m)) { this.lastMissileCamPos = m.pos.clone(); mode = 'missile'; this.missileCamHold = 1.2; }
            else if (this.missileCamHold > 0) { this.missileCamHold -= dt; mode = 'missile'; }
            else this.missileCam = null;
        }
        if (mode === 'missile') {
            p.root.visible = !p.exploded;
            if (this.cockpit) this.cockpit.enabled = false;
            const m = this.missileCam;
            const alive = this.weapons.missiles.includes(m);
            const dir = alive ? _v3.copy(m.vel).normalize() : _v3.set(0, 0, -1).applyQuaternion(cam.quaternion);
            const tgt = m.target && m.target.pos ? m.target.pos : null;
            if (alive) cam.position.copy(m.pos).addScaledVector(dir, -14).add(_v.set(0, 3, 0));
            cam.up.set(0, 1, 0);
            if (tgt && alive) cam.lookAt(tgt); else cam.lookAt(_v2.copy(this.lastMissileCamPos || cam.position).addScaledVector(dir, 50));
            cam.fov = damp(cam.fov, 55, 4, dt);
            cam.updateProjectionMatrix();
            return;
        }
        p.root.visible = !p.exploded && mode !== 'cockpit';
        const holdLook = this.input.down('KeyC') && this.lockTarget;
        const lookBack = this.input.down('KeyL');

        if (mode === 'cockpit') {
            const eye = _v.copy(p.rig.cockpit).applyMatrix4(p.model.matrixWorld);
            cam.position.copy(eye);
            // head look: padlock target, mouse-aim direction, or free look
            let yaw = 0, pitch = 0;
            if (holdLook || lookBack || this.settings.controlMode === 'mouseaim' || this.settings.controlMode === 'keyboard') {
                let dirW = null;
                if (holdLook) dirW = _v2.subVectors(this.lockTarget.pos, eye).normalize();
                else if (lookBack) dirW = _v2.copy(p.getForward(_v3)).negate().add(_v3.set(0, 0.3, 0)).normalize();
                else if (this.settings.controlMode === 'mouseaim') dirW = this.aimDir;
                if (dirW) {
                    const local = _v3.copy(dirW).applyQuaternion(_q.copy(p.quat).invert());
                    yaw = Math.atan2(-local.x, -local.z);
                    pitch = Math.asin(clamp(local.y, -1, 1));
                    if (this.settings.controlMode === 'mouseaim' && !holdLook && !lookBack) { yaw *= 0.35; pitch *= 0.35; }
                } else { yaw = this.freeLook.yaw; pitch = this.freeLook.pitch; }
            }
            this.cockpit.headLook.yaw = damp(this.cockpit.headLook.yaw, clamp(yaw, -2.7, 2.7), 8, dt);
            this.cockpit.headLook.pitch = damp(this.cockpit.headLook.pitch, clamp(pitch, -0.8, 1.3), 8, dt);
            fov = 72;
            this.cockpit.enabled = true;
        } else {
            if (this.cockpit) this.cockpit.enabled = false;
            if (mode === 'death') {
                // slow orbit around the wreck
                this.deathOrbit = (this.deathOrbit || 0) + dt * 0.35;
                const chute = p.ejectSeat && this.deathT > 1.8 ? p.ejectSeat.root.position : null;
                const target = chute || p.pos;
                const r = chute ? 22 : 60 + (this.deathT || 0) * 12;
                _v.set(Math.cos(this.deathOrbit) * r, chute ? 6 : 25 + (this.deathT || 0) * 6, Math.sin(this.deathOrbit) * r).add(target);
                const gh = Math.max(terrainHeight(_v.x, _v.z), 0) + 10;
                if (_v.y < gh) _v.y = gh;
                cam.position.lerp(_v, 1 - Math.exp(-3 * dt));
                cam.up.set(0, 1, 0);
                cam.lookAt(target);
                cam.fov = damp(cam.fov, 55, 3, dt);
                cam.updateProjectionMatrix();
                return;
            }
            if (mode === 'cinematic') {
                // fly-by camera: park ahead of the jet and let it pass
                this.cineT = (this.cineT || 0) - dt;
                if (this.cineT <= 0 || cam.position.distanceTo(p.pos) > 900) {
                    this.cineT = 4.5;
                    const fwd = p.getForward(_v3);
                    this.cinePos = p.pos.clone().addScaledVector(p.vel, 2.2).add(_v2.set(rand(-40, 40), rand(-10, 25), rand(-40, 40)));
                    const gh = Math.max(terrainHeight(this.cinePos.x, this.cinePos.z), 0) + 8;
                    if (this.cinePos.y < gh) this.cinePos.y = gh;
                    void fwd;
                }
                cam.position.copy(this.cinePos);
                cam.up.set(0, 1, 0);
                cam.lookAt(p.pos);
                const dist = cam.position.distanceTo(p.pos);
                cam.fov = clamp(2 * Math.atan(L * 1.6 / dist) * 180 / Math.PI, 10, 60);
                cam.updateProjectionMatrix();
                return;
            }
            const far = mode === 'far';
            const back = far ? L * 4.2 + 30 : L * 1.55 + 14;
            const height = far ? L * 1.1 + 10 : L * 0.3 + 3.5;
            let targetQ;
            if (this.settings.controlMode === 'mouseaim' && !holdLook) {
                // camera looks along the aim direction (horizon stays level)
                _m.lookAt(_v.set(0, 0, 0), this.aimDir, _v2.set(0, 1, 0));
                targetQ = _q.setFromRotationMatrix(_m);
                this.camQuat.slerp(targetQ, 1 - Math.exp(-14 * dt));
            } else if (holdLook) {
                const to = _v2.subVectors(this.lockTarget.pos, p.pos).normalize();
                _m.lookAt(_v.set(0, 0, 0), to, _v3.set(0, 1, 0).applyQuaternion(p.quat));
                targetQ = _q.setFromRotationMatrix(_m);
                this.camQuat.slerp(targetQ, 1 - Math.exp(-8 * dt));
            } else {
                // chase with slight lag; free-look offsets
                targetQ = _q.copy(p.quat);
                if (this.freeLook.yaw || this.freeLook.pitch) {
                    targetQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.freeLook.pitch, this.freeLook.yaw, 0, 'YXZ')));
                }
                if (lookBack) targetQ.multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(0, 1, 0), Math.PI));
                this.camQuat.slerp(targetQ, 1 - Math.exp(-9 * dt));
            }
            const offset = _v.set(0, height, back).applyQuaternion(this.camQuat);
            const desired = _v2.copy(p.pos).add(offset);
            // keep above terrain
            const gh = Math.max(terrainHeight(desired.x, desired.z), 0) + 3;
            if (desired.y < gh) desired.y = gh;
            cam.position.copy(desired);
            cam.quaternion.copy(this.camQuat);
            // look slightly above the jet so it sits in the lower third
            cam.rotateX(-Math.atan2(height * 0.55, back));
            fov = 58 + clamp((p.speed - 150) / 300, 0, 1) * 14 + (p.afterburner ? 3 : 0);
        }
        // shake
        const sh = this.shake + (p.afterburner && this.cameraMode !== 'cockpit' ? 0.04 : 0) + (p.speed > 380 ? 0.03 : 0);
        if (sh > 0.001) {
            cam.rotateX((Math.random() - 0.5) * sh * 0.012);
            cam.rotateY((Math.random() - 0.5) * sh * 0.012);
        }
        cam.fov = damp(cam.fov, fov, 4, dt);
        cam.updateProjectionMatrix();
    }
}
