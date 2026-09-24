// ═══════════════════════════════════════════════════════════════
// Convoy operation (mission "Bridge Out"): an armoured column drives down a
// road toward a river bridge. Drop the bridge before it crosses; the convoy
// halts at the gap, waits, then turns back — destroy it before it escapes.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, terrainHeight } from './world.js';

const LINEUP = ['tank', 'spaag', 'truck', 'truck', 'fueltruck', 'msam', 'truck', 'fueltruck', 'tank', 'spaag'];
const SPACING = 32, APPROACH = 2300, CRUISE = 12;
const _v = new THREE.Vector3();

// Pick a bridge with enough road before it for the convoy's approach
export function pickConvoyBridge(bridges) {
    const home = BASES.find(b => b.friendly);
    const opts = [];
    for (const br of bridges || []) {
        if (!br.path) continue;
        for (const dir of [1, -1]) {
            const upstream = dir > 0 ? br.s0 : br.path.len - br.s1;
            const downstream = dir > 0 ? br.path.len - br.s1 : br.s0;
            if (upstream < 1200 || downstream < 300) continue;
            const dHome = Math.hypot(br.pos.x - home.x, br.pos.z - home.z);
            const score = Math.min(upstream, APPROACH + SPACING * LINEUP.length) - Math.max(0, dHome - 22000) * 0.2 - Math.abs(br.len - 350) * 0.5;
            opts.push({ br, dir, upstream, score });
        }
    }
    opts.sort((a, b) => b.score - a.score);
    return opts.length ? opts[Math.floor(Math.random() * Math.min(3, opts.length))] : null;
}

export class ConvoyOp {
    constructor(game, pick) {
        this.game = game;
        const { br, dir, upstream } = pick;
        this.bridge = br; this.dir = dir; this.path = br.path;
        br.objective = true;
        br.name = 'BRIDGE';
        const entry = dir > 0 ? br.s0 : br.s1;   // where the convoy reaches the bridge
        this.exit = dir > 0 ? br.s1 : br.s0;
        const lead = entry - dir * Math.min(APPROACH, upstream - SPACING * LINEUP.length - 20);
        this.startS = lead - dir * SPACING * LINEUP.length;
        this.vehicles = LINEUP.map((type, i) => {
            const t = game.ground.addTarget(type, 0, 0, 0, 'red');
            t.follow(this.path, lead - dir * SPACING * i, dir);
            t.route.cruise = CRUISE;
            t.convoy = true;
            return t;
        });
        this.state = 'advance';
        this.haltT = 0;
        this.result = null;
        this.capT = 70;
        this.lastT = game.time;
        game.world.towns?.traffic?.clearPath(this.path);
        this.placePlayer();
    }

    placePlayer() {
        const g = this.game, p = g.player, br = this.bridge;
        const home = BASES.find(b => b.friendly);
        const away = _v.set(home.x - br.pos.x, 0, home.z - br.pos.z).normalize();
        const pos = br.pos.clone().addScaledVector(away, 9000);
        pos.y = Math.max(1400, terrainHeight(pos.x, pos.z) + 700);
        const to = br.pos.clone().sub(pos).setY(0).normalize();
        p.spawnAir(pos, Math.atan2(-to.x, -to.z), 0.6);
        p.syncBody();
        g.aimDir.copy(p.vel).normalize();
    }

    alive() { return this.vehicles.filter(v => v.alive); }
    progress(v) { return (v.route.s - this.exit) * this.dir; } // > 0: across the river

    update() {
        const g = this.game;
        const dt = Math.min(0.1, Math.max(0, g.time - this.lastT));
        this.lastT = g.time;
        const br = this.bridge, alive = this.alive();
        if (!alive.length) { this.result = 'win'; return; }

        // bridge collapse: vehicles on the fallen span go into the river
        if (!br.alive && this.state === 'advance') {
            const g0 = br.s0 + br.gap[0], g1 = br.s0 + br.gap[1];
            for (const v of alive) if (v.route.s > g0 - 3 && v.route.s < g1 + 3) { v.sinking = true; v.destroy(g.player); }
            this.gapNear = this.dir > 0 ? g0 : g1;
            this.state = 'halt';
            this.haltT = 0;
            g.showBanner('BRIDGE DOWN', 'The convoy is trapped — destroy it before it turns back!', 5, '#5dffa0');
            g.audio.say('Good hits! The bridge is down. Now take out that convoy.', true);
        }
        if (this.state === 'halt') {
            // queue up short of the gap
            const stuck = alive.filter(v => (this.gapNear - v.route.s) * this.dir > 0).sort((a, b) => (b.route.s - a.route.s) * this.dir);
            stuck.forEach((v, i) => { v.route.stopAt = this.gapNear - this.dir * (18 + i * 26); });
            // the wait starts once the head of the column reaches the gap
            if (!stuck.length || stuck[0].route.speed < 0.5) this.haltT += dt;
            if (this.haltT > 40) {
                this.state = 'retreat';
                for (const v of stuck) { v.route.dir = -this.dir; v.route.stopAt = null; v.route.cruise = 14; v.route.speed = 0; }
                g.addFeed('CONVOY IS TURNING BACK!', '#ff9f5a');
                g.audio.say('They\'re turning around — don\'t let them get away!', true);
            }
        }
        // lose: a vehicle gets well across the river, or escapes back the way it came
        for (const v of alive) {
            if (this.progress(v) > 800) { this.result = 'lose'; this.reason = 'CONVOY CROSSED THE RIVER'; }
            if (this.state === 'retreat' && v.route.dir !== this.dir && (v.route.s - this.startS) * this.dir < 0) { this.result = 'lose'; this.reason = 'CONVOY ESCAPED'; }
            if (v.route.s <= 0.5 || v.route.s >= this.path.len - 0.5) { this.result = 'lose'; this.reason = 'CONVOY ESCAPED'; }
        }
        if (this.result === 'lose') g.showBanner(this.reason, '', 4, '#ff4a3d');

        // enemy fighters answer the call
        this.capT -= dt;
        if (this.capT <= 0 && this.capT > -1) {
            this.capT = -5;
            const e = g.spawnEnemies(g.difficulty.skill > 0.7 ? 2 : 1, { x: br.pos.x, z: br.pos.z });
            e.forEach(a => { if (a.pilot) { a.pilot.home = br.pos.clone(); a.pilot.leash = 12000; } });
            g.addFeed('ENEMY FIGHTERS COVERING THE CONVOY', '#ff9f5a');
        }
        // nav cue
        if (br.alive) g.navTarget = { pos: br.pos, label: 'BRIDGE' };
        else {
            const c = _v.set(0, 0, 0);
            alive.forEach(v => c.add(v.pos));
            c.divideScalar(alive.length);
            g.navTarget = { pos: (this.navPos = (this.navPos || new THREE.Vector3()).copy(c)), label: 'CONVOY' };
        }
    }

    objective() {
        const n = this.alive().length, br = this.bridge;
        if (br.alive) {
            const lead = this.alive().reduce((a, v) => Math.max(a, (v.route.s - (this.dir > 0 ? br.s0 : br.s1)) * this.dir), -Infinity);
            const d = Math.max(0, -lead);
            return 'DROP THE BRIDGE — CONVOY ' + (d > 0 ? (d / 1000).toFixed(1) + ' KM OUT' : 'CROSSING!') + ' · ' + n + ' VEHICLES';
        }
        return 'DESTROY THE CONVOY — ' + n + ' LEFT' + (this.state === 'retreat' ? ' · RETREATING' : '');
    }
}
