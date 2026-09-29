// ═══════════════════════════════════════════════════════════════
// Tasks: dynamic missions from what's happening in the war (docs/WAR.md), a plug-in system (systems.js) that runs
// in the Living War and in the Sandbox.
//  • generated from the war: a SAM battery detected, the artillery shelling a sector, an enemy convoy, a TEL
//    preparing to fire, a missile launch, a raid or an unknown aircraft inbound, a friendly flight or convoy
//    calling for help, a convoy to escort, SEAD for a strike package, battle damage assessment, a re-strike,
//    an unknown contact to identify, a search area to reconnoitre, close air support where the fighting is
//  • offered on the radio ("COMMAND: NEW TASK AVAILABLE — …") and the HUD; accepted or ignored in the command
//    menu (TASKS, with a badge) or on the tactical map (the task list, or click a task's marker / target)
//  • the active task: an objective line on the HUD, brackets on its targets, a marker on the map and the steer
//    cue (game.navTarget)
//  • outcomes from the war itself (units destroyed, the raid broken up, the convoy through…), rewarded in score
//    (and so career XP) with a debrief on the radio; one finished before it was accepted pays half, and only if
//    the player (or a wingman) had a hand in it
//  • paced: a routine offer every couple of minutes at most, urgent ones (raids, launches, calls for help)
//    sooner, never more than three waiting
// Plug-ins: game.tasks.offer(spec) and game.tasks.addGenerator(fn) — the spec's fields are in docs/WAR.md.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { INTEL } from './war.js';
import { STRIKE_TYPES } from './strikes.js';
import { clamp, rand, pick } from './util.js';

const AMBER = '#ffc23f', GREEN = '#5dffa0', DIM = 'rgba(232,244,255,0.6)';
const MAX_OFFERED = 3;
const _v = new THREE.Vector3(), _p = {};
const km = (m) => (m / 1000).toFixed(1) + ' KM';
const clock = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const LIVE = (t) => t.state === 'offered' || t.state === 'active';
// the compass point of b as seen from a ('NE')
const compass = (a, b) => ['NORTH', 'NORTH-EAST', 'EAST', 'SOUTH-EAST', 'SOUTH', 'SOUTH-WEST', 'WEST', 'NORTH-WEST'][Math.round((((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI) + 360) % 360) / 45) % 8];

export class TaskManager {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.tasks = [];
        this.generators = [];     // plug-ins' (kept across sorties: they register once)
        this.nextId = 1;
        this.doneCount = 0;
        this.recent = [];
        this.builtins();
        this.listen();
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.enabled = mode === 'war' || mode === 'sandbox';
        if (!this.enabled) return;
        const sk = (this.game.difficulty || { skill: 0.6 }).skill;
        this.gap = 165 - sk * 80;            // s between routine offers (rookie ~137, veteran ~117, ace ~93)
        this.genT = 20;                      // first look at the war
        this.lastOffer = -1e9; this.lastRoutine = -1e9;
        this.checkT = 0;
    }

    clear() {
        if (this.nav && this.game.navTarget === this.nav) this.game.navTarget = null;
        for (const t of this.tasks) if (LIVE(t)) this.end(t, 'expired');
        this.tasks.length = 0;
        this.nav = null;
        this.enabled = false;
        this.doneCount = 0;
        this.toast = null;
        this.recent = [];
    }

    get active() { return this.tasks.find(t => t.state === 'active') || null; }
    get offered() { return this.tasks.filter(t => t.state === 'offered'); }

    // ═════════════ The API for plug-ins ═════════════
    // fn(tasks, game) is called every few seconds while a war runs: it may call tasks.offer(spec) or return a spec
    addGenerator(fn) { this.generators.push(fn); return fn; }

    // would an offer be taken now? (generators check this before they set anything up)
    canOffer(urgent = false) {
        if (!this.enabled) return false;
        const now = this.game.war.time;
        if (now - this.lastOffer < (urgent ? 15 : 25)) return false;
        if (!urgent && now - this.lastRoutine < this.gap) return false;
        const open = this.offered;
        return open.length < MAX_OFFERED || (urgent && open.some(t => !t.urgent));
    }

    // spec: docs/WAR.md. Returns the task, or null if it isn't offered now (paced, full, or a duplicate)
    offer(spec, { force = false } = {}) {
        if (!this.enabled || !spec) return null;
        const war = this.game.war, now = war.time;
        const key = spec.key || spec.type + ':' + (spec.title || '');
        if (this.tasks.some(t => t.key === key && LIVE(t))) return null;
        if (!force && !this.canOffer(!!spec.urgent)) return null;
        // room for it: an urgent one pushes out the oldest routine offer
        const open = this.offered;
        if (open.length >= MAX_OFFERED) {
            const drop = open.filter(t => !t.urgent).sort((a, b) => a.t0 - b.t0)[0];
            if (!spec.urgent || !drop) return null;
            this.end(drop, 'expired');
        }
        const t = {
            id: this.nextId++, type: spec.type || 'task', key, title: spec.title || 'TASK', brief: spec.brief || '',
            from: spec.from || 'COMMAND', pos: spec.pos || null, area: spec.area || null, units: spec.units || [],
            need: spec.need ?? null, reward: spec.reward ?? 400, urgent: !!spec.urgent,
            expires: spec.expires ?? (spec.urgent ? 150 : 240), limit: spec.limit ?? 0,
            check: spec.check || null, progress: spec.progress || null, onAccept: spec.onAccept || null,
            onDone: spec.onDone || null, onFail: spec.onFail || null, onEnd: spec.onEnd || null, onKill: spec.onKill || null,
            label: spec.label || (spec.type || 'TASK').toUpperCase(), report: spec.report || null, data: spec.data || {},
            state: 'offered', t0: now, tAccept: null, isNew: true, playerHit: false,
        };
        this.tasks.push(t);
        this.lastOffer = now;
        if (!t.urgent) this.lastRoutine = now;
        this.recent = [...this.recent, t.type].slice(-3);
        if (spec.onOffer) { try { spec.onOffer(t, this.game); } catch (e) { console.warn('[tasks]', e); } }
        const where = this.where(t);
        const dist = where ? ' · ' + km(where.distanceTo(this.focus())) : '';
        this.say(t.from, 'NEW TASK AVAILABLE — ' + t.title + dist, { color: AMBER, say: (t.urgent ? 'Priority task. ' : 'New task available. ') + t.title.toLowerCase() + '.', priority: t.urgent });
        this.toast = { task: t, t: this.game.time };
        this.game.audio && this.game.audio.uiConfirm && this.game.audio.uiConfirm();
        this.game.events.emit('taskOffered', t);
        return t;
    }

    // ═════════════ Choosing ═════════════
    accept(t) {
        if (!t || t.state !== 'offered') return;
        const g = this.game, cur = this.active;
        if (cur) { cur.state = 'offered'; cur.t0 = g.war.time; } // back on the list
        t.state = 'active'; t.tAccept = g.war.time; t.isNew = false;
        const me = (g.callsign || 'VIPER') + ' 1';
        this.say(me, 'COPY — ' + t.title, { color: GREEN, say: false });
        this.say(t.from, t.brief || t.title, { color: '#9fd4ff', say: false });
        if (t.onAccept) { try { t.onAccept(t, g); } catch (e) { console.warn('[tasks]', e); } }
        this.updateNav();
        g.events.emit('taskAccepted', t);
    }

    abandon(t = this.active) {
        if (!t || t.state !== 'active') return;
        t.state = 'offered'; t.t0 = this.game.war.time; t.tAccept = null;
        this.say('COMMAND', 'COPY, TASK ON HOLD — ' + t.title, { color: DIM, say: false });
        this.updateNav();
    }

    dismissOffers() { for (const t of this.offered) this.end(t, 'expired'); }

    // ═════════════ Outcomes ═════════════
    end(t, state) {
        t.state = state;
        t.tEnd = this.game.war.time;
        if (t.onEnd) { try { t.onEnd(t, this.game); } catch (e) { console.warn('[tasks]', e); } }
    }

    complete(t, how = '') {
        if (!LIVE(t)) return;
        const g = this.game, own = t.state === 'active';
        this.end(t, 'done');
        const pts = own ? t.reward : t.playerHit ? Math.round(t.reward / 2) : 0;
        if (pts) {
            g.score = (g.score || 0) + pts;
            this.doneCount++;
            g.addFeed('TASK COMPLETE: ' + t.title + '  +' + pts, '#ffd23f');
            const who = (g.callsign || 'VIPER') + ' 1';
            this.say(t.from, (own ? pick(['GOOD WORK, ', 'NICE WORK, ', 'OUTSTANDING, ', 'WELL DONE, ']) + who + '. ' : 'TASK COMPLETE — ') + (how || t.title), { color: GREEN, say: own ? pick(['Good work.', 'Nice work.', 'Outstanding.']) + ' ' + (how || t.title).toLowerCase() : false });
        }
        if (t.onDone) { try { t.onDone(t, g); } catch (e) { console.warn('[tasks]', e); } }
        g.events.emit('taskDone', t, { points: pts, assigned: own });
        this.updateNav();
    }

    fail(t, why = '') {
        if (!LIVE(t)) return;
        const own = t.state === 'active';
        this.end(t, own ? 'failed' : 'expired');
        if (own) this.say(t.from, 'TASK FAILED — ' + (why || t.title), { color: '#ff4a3d', say: 'Task failed. ' + (why || '').toLowerCase() });
        if (t.onFail) { try { t.onFail(t, this.game); } catch (e) { console.warn('[tasks]', e); } }
        this.game.events.emit('taskFailed', t, { why, assigned: own });
        this.updateNav();
    }

    // done, failed or still going? ('done[:how]' | 'failed[:why]' | 'expired' | null)
    evaluate(t) {
        const now = this.game.war.time;
        if (t.check) {
            let r = null;
            try { r = t.check(t, this.game); } catch (e) { console.warn('[tasks]', e); }
            if (r) return r;
        }
        if (t.units.length) {
            const need = t.need ?? t.units.length;
            const dead = t.units.filter(u => !u.alive).length;
            if (dead >= need) return 'done';
            if (t.units.filter(u => u.alive && !u.removed).length + dead < need) return 'failed:THE TARGET GOT AWAY';
        }
        if (t.state === 'offered' && now - t.t0 > t.expires) return 'expired';
        if (t.state === 'active' && t.limit && now - t.tAccept > t.limit) return 'failed:OUT OF TIME';
        return null;
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        const g = this.game, war = g.war;
        if (g.state !== 'playing' && g.state !== 'dead') return;
        this.checkT -= dt;
        if (this.checkT <= 0) {
            this.checkT = 0.5;
            for (const t of this.tasks) {
                if (!LIVE(t)) continue;
                const r = this.evaluate(t);
                if (!r) continue;
                if (r === 'done') this.complete(t);
                else if (r.startsWith('done:')) this.complete(t, r.slice(5));
                else if (r === 'expired') this.end(t, 'expired');
                else this.fail(t, r.startsWith('failed:') ? r.slice(7) : '');
            }
            for (let i = this.tasks.length - 1; i >= 0; i--) {
                const t = this.tasks[i];
                if (!LIVE(t) && war.time - t.tEnd > 30) this.tasks.splice(i, 1); // old news goes
                else if (t.isNew && war.time - t.t0 > 45) t.isNew = false;
            }
            this.updateNav();
        }
        this.genT -= dt;
        if (this.genT <= 0) {
            this.genT = 5;
            for (const fn of [...this.builtin, ...this.generators]) {
                try { const spec = fn(this, g); if (spec) this.offer(spec); } catch (e) { console.warn('[tasks] generator', e); }
            }
        }
    }

    // the steer cue follows the active task (the war modes own game.navTarget while a task is active)
    updateNav() {
        const g = this.game, t = this.active;
        if (!t) { if (this.nav && g.navTarget === this.nav) g.navTarget = null; this.nav = null; return; }
        const p = this.where(t);
        if (!p) return;
        if (!this.nav) this.nav = { pos: new THREE.Vector3(), label: t.label };
        this.nav.pos.copy(p); this.nav.label = t.label;
        if (!g.navTarget || g.navTarget === this.nav) g.navTarget = this.nav;
    }

    // where a task is: its pos (a vector or a function), the centre of its living units, or its search area
    where(t) {
        if (typeof t.pos === 'function') { try { return t.pos(t, this.game); } catch (e) { return null; } }
        if (t.pos) return t.pos;
        const war = this.game.war;
        let n = 0;
        _v.set(0, 0, 0);
        for (const u of t.units) {
            if (!u.alive || u.removed) continue;
            const r = war.rec(u);
            _v.add(r && u.team !== war.side ? r.lastPos : u.pos); n++;
        }
        if (n) return _v.divideScalar(n);
        if (t.area) return t.area.center;
        return null;
    }

    focus() {
        const g = this.game;
        if (g.pilotMode) return g.pilotMode.pos;
        if (g.player) return g.player.pos;
        return g.camera.position;
    }

    say(from, text, opts) {
        const d = this.game.director;
        if (d && d.enabled && d.say) d.say(from, text, opts); else this.game.war.radio(from, text, opts);
    }

    recentHas(type) { return this.recent.slice(-2).includes(type); }

    // the player's own hand (or his wingmen's) in a kill
    mine(src) {
        const g = this.game;
        return !!src && (src === g.player || src === g.pilotMode || src.isPlayer || !!(src.pilot && src.pilot.brain && src.pilot.brain.wingman));
    }

    // ═════════════ What the war offers: built-in generators (polled) ═════════════
    builtins() {
        const self = this;
        this.builtin = [
            // the artillery shelling a sector
            () => {
                const g = self.game, fr = g.front, war = g.war;
                if (!fr || !fr.batteries || self.recentHas('artillery') || !self.canOffer()) return null;
                const P = self.focus();
                // (a battery whose offer was passed up waits a few minutes before it's offered again)
                const bts = fr.batteries.filter(b => b.units.some(u => u.alive) && !b.tasked && war.time - (b.offeredT ?? -1e9) > 420);
                if (!bts.length) return null;
                // the nearest, preferring a sector where we're losing (10 strength points ≈ 5 km)
                const score = (b) => b.at.distanceTo(P) / 1000 + (b.sector.blue - b.sector.red) * 0.5;
                bts.sort((a, b) => score(a) - score(b));
                const bt = bts[0];
                // one search area per battery, kept until it's found
                const known = bt.report && !bt.report.resolved ? bt.report : null;
                const center = known ? known.center : bt.at.clone().add(new THREE.Vector3(rand(-1300, 1300), 0, rand(-1300, 1300)));
                return {
                    type: 'artillery', key: 'artillery:' + (war.rec(bt.units[0])?.id ?? bt.sector.id), title: 'SILENCE THE ARTILLERY IN SECTOR ' + bt.sector.name,
                    brief: 'A BM-21 GRAD ROCKET BATTERY IS SHELLING ' + fr.sectorLabel(bt.sector) + '. SEARCH AREA ' + war.grid(center.x, center.z) + ' — ITS LAUNCHES GIVE IT AWAY. DESTROY ALL THREE LAUNCHERS.',
                    units: bt.units.slice(), area: { center, radius: 2600 }, reward: 700, label: 'ARTILLERY', expires: 300,
                    progress: (t) => t.units.filter(u => !u.alive).length + '/' + t.units.length + ' LAUNCHERS',
                    onOffer: (t) => {
                        bt.tasked = true; bt.offeredT = war.time;
                        if (!known) { bt.report = war.report({ text: 'ENEMY ARTILLERY SHELLING ' + fr.sectorLabel(bt.sector), center, radius: 2600, unit: bt.units[0], cls: 'artillery', say: false }); bt.report.tasked = true; }
                        t.report = bt.report;
                    },
                    onEnd: () => { bt.tasked = false; },
                    check: (t) => (t.units.every(u => !u.alive) ? 'done:THE SHELLING HAS STOPPED IN SECTOR ' + bt.sector.name : null),
                };
            },
            // SAM sites we already know about (the airbase's ring): suppress them
            () => {
                const g = self.game, war = g.war;
                if (war.time < 420 || self.recentHas('sam') || !self.canOffer()) return null;
                const sams = war.near(self.focus(), 45000, { cls: ['sam', 'sam-radar'], team: war.enemyTeam, minKnown: INTEL.CONTACT }).filter(o => !o.u.isShip && !o.u.samTasked && !o.u.convoyOf);
                return sams.length ? self.samTask(sams[0].u, false) : null;
            },
            // an unknown contact to identify
            () => {
                const g = self.game, war = g.war;
                if (self.recentHas('identify') || !self.canOffer()) return null;
                const c = war.near(self.focus(), 30000, { team: war.enemyTeam, minKnown: INTEL.CONTACT })
                    .find(o => o.rec.known < INTEL.IDENTIFIED && !['aircraft', 'helicopter'].includes(o.rec.cls) && war.time - o.rec.lastSeen < 240 && !o.u.idTasked && o.d2 > 3000 * 3000);
                if (!c) return null;
                const u = c.u, rec = c.rec;
                return {
                    type: 'identify', key: 'identify:' + rec.id, title: 'INVESTIGATE UNKNOWN CONTACT',
                    brief: rec.contactName + ' REPORTED AT GRID ' + war.grid(rec.lastPos.x, rec.lastPos.z) + '. GET EYES ON IT (OR THE TARGETING POD) AND IDENTIFY IT.',
                    pos: () => rec.lastPos, reward: 300, label: 'CONTACT', expires: 200,
                    onOffer: () => { u.idTasked = true; }, onEnd: () => { u.idTasked = false; },
                    check: () => (war.known(u) >= INTEL.IDENTIFIED ? 'done:CONTACT IDENTIFIED — ' + rec.name : !u.alive ? 'done:CONTACT DESTROYED' : null),
                };
            },
            // a search area someone reported (intel reports without a task)
            () => {
                const g = self.game, war = g.war;
                if (self.recentHas('recon') || !self.canOffer()) return null;
                const rp = war.reports.find(r => !r.resolved && !r.tasked && !self.tasks.some(t => t.report === r) && war.time - r.time > 20);
                if (!rp) return null;
                return {
                    type: 'recon', key: 'recon:' + rp.id, title: 'RECON THE SEARCH AREA', brief: rp.text + ' — SEARCH AREA ' + war.grid(rp.center.x, rp.center.z) + '. FIND IT AND IDENTIFY IT.',
                    area: { center: rp.center, radius: rp.radius }, report: rp, reward: 350, label: 'SEARCH', expires: 300,
                    onOffer: () => { rp.tasked = true; },
                    check: () => (rp.resolved ? 'done:TARGET FOUND' : null),
                };
            },
            // battle damage assessment waiting on a strike
            () => {
                const g = self.game, war = g.war, st = g.strikes;
                if (!st || !st.bda || !st.bda.length || !self.canOffer()) return null;
                const b = st.bda.find(x => !x.tasked);
                if (!b) return null;
                const label = b.aim.label || 'THE TARGET';
                return {
                    type: 'bda', key: 'bda:' + b.strike.id + ':' + label, title: 'BATTLE DAMAGE ASSESSMENT — ' + label,
                    brief: 'FLY OVER ' + label + ' AT GRID ' + war.grid(b.pos.x, b.pos.z) + ' AND LOOK AT IT FOR A FEW SECONDS (WITHIN ~6 KM) SO WE KNOW WHAT THE STRIKE DID.',
                    pos: b.pos, reward: 300, label: 'BDA', expires: 420,
                    onOffer: () => { b.tasked = true; },
                    check: (t) => {
                        if (st.bda.includes(b)) return null;
                        if (t.state === 'active') t.playerHit = true;
                        return 'done:IMAGERY RECEIVED — ' + (b.aim.result || 'ASSESSMENT COMPLETE');
                    },
                    progress: () => (b.look > 0 ? Math.round(b.look / 2.2 * 100) + '% IMAGED' : 'LOOK AT IT FROM < 6 KM'),
                };
            },
            // air support where the enemy is attacking and nobody's covering it yet
            () => {
                const g = self.game, fr = g.front;
                if (!fr || !self.canOffer()) return null;
                const s = fr.sectors.find(x => x.offensive && x.offensive.team !== g.war.side && !x.casTasked && x.offensive.t > 30);
                return s ? self.casTask(s, s.offensive.team) : null;
            },
        ];
    }

    // ═════════════ What the war offers: events ═════════════
    listen() {
        const ev = this.game.events;
        const on = (k, fn) => ev.on(k, (a, b) => { if (this.enabled) { try { fn(a, b || {}); } catch (e) { console.warn('[tasks]', e); } } });
        const war = () => this.game.war;
        const has = (u) => this.tasks.some(t => LIVE(t) && t.units.includes(u));
        // kills: who did it (for unassigned tasks), and tasks that count kills
        on('groundKilled', (u, { source }) => {
            const mine = this.mine(source);
            for (const t of this.tasks) {
                if (!LIVE(t)) continue;
                if (mine && t.units.includes(u)) t.playerHit = true;
                if (t.onKill) t.onKill(t, u, source, mine);
            }
        });
        on('killed', (ac, { source }) => {
            if (!this.mine(source)) return;
            for (const t of this.tasks) if (LIVE(t) && (t.units.includes(ac) || (ac.flight && t.data.flight === ac.flight))) t.playerHit = true;
        });
        // a new SAM site seen
        on('warContact', (u, { rec }) => { if (rec && (rec.cls === 'sam' || rec.cls === 'sam-radar') && !u.convoyOf && !u.isShip && !u.samTasked) this.offer(this.samTask(u, true)); });
        on('warIdentified', (u, { rec }) => {
            if (!rec) return;
            if ((rec.cls === 'sam' || rec.cls === 'sam-radar') && !u.convoyOf && !u.isShip && !u.samTasked) this.offer(this.samTask(u, true));
            if (rec.cls === 'tel' && !has(u)) this.offer(this.telTask(u, null), { force: true });
        });
        // an enemy launcher preparing to fire: stop it
        on('telPreparing', (u, { launchAt, target }) => this.offer(this.telTask(u, launchAt, target), { force: true }));
        // a missile launch: find the launcher
        on('strategicLaunch', (m) => {
            if (m.team === war().side || !m.strike || m.strike.launched !== 1) return;
            const host = m.source && m.source.host;
            if (!host || !host.pos || !host.isGround || has(host)) return;
            const w = war(), at = host.pos.clone();
            const center = at.clone().add(new THREE.Vector3(rand(-900, 900), 0, rand(-900, 900)));
            this.offer({
                type: 'launch', key: 'launch:' + (w.rec(host)?.id ?? 0) + ':' + Math.round(w.time), urgent: true, title: 'MISSILE LAUNCH DETECTED — FIND THE LAUNCHER',
                brief: 'THE LAUNCH CAME FROM NEAR GRID ' + w.grid(at.x, at.z) + '. GET THERE BEFORE IT RELOCATES AND DESTROY IT.',
                units: [host], area: { center, radius: 2200 }, reward: 800, label: 'LAUNCHER', expires: 180, limit: 480,
                onOffer: (t) => { t.report = w.report({ text: 'LAUNCH POINT — THE LAUNCHER WILL MOVE SOON', center, radius: 2200, unit: host, cls: 'tel', say: false }); t.report.tasked = true; },
                check: (t) => (host.relocatedAfter && host.relocatedAfter > t.t0 ? 'failed:THE LAUNCHER HAS RELOCATED' : null),
            }, { force: true });
        });
        on('telRelocated', (u) => { u.relocatedAfter = war().time; for (const rp of war().reports) if (rp.unit === u && !rp.resolved) rp.resolved = true; });
        // raids and unknown aircraft inbound
        on('raidDetected', (f) => {
            if (f.team === war().side) return;
            // (a second raid on a target that already has an intercept task is on the map and the radio, not a second task)
            const label = f.target ? f.target.label : '';
            if (this.tasks.some(t => LIVE(t) && t.type === 'raid' && t.data.label === label)) return;
            this.offer(this.raidTask(f), { force: true });
        });
        on('reconDetected', (f) => this.offer(this.reconFlightTask(f), { force: true }));
        // calls for help
        on('supportRequest', (f, { attackers }) => this.offer(this.supportTask(f, attackers), { force: true }));
        on('convoyUnderAttack', (c, { flight }) => this.offer(this.protectTask(c, flight), { force: true }));
        on('convoyStarted', (c) => { if (c.team === war().side) this.offer(this.escortTask(c)); });
        // an enemy convoy reported
        on('warReport', (rp) => { if (rp.cls === 'convoy' && rp.unit && rp.unit.convoyOf) this.offer(this.convoyTask(rp.unit.convoyOf, rp)); });
        // after a strike: a re-strike when the target's still standing
        on('bda', ({ strike, aim, result }) => {
            if (!aim || !aim.unit || !aim.unit.alive || strike.team !== war().side) return;
            if (/DAMAGED|OPERATIONAL/.test(result || '')) this.offer(this.restrikeTask(strike, aim), { force: true });
        });
        // an offensive (theirs or ours) wants air support
        on('frontOffensive', (s, { team }) => this.offer(this.casTask(s, team)));
        on('packageTasked', (f, { unit }) => {
            const w = war();
            const sams = w.near(unit.pos, 9000, { cls: ['sam', 'sam-radar', 'aaa'], team: w.enemyTeam }).filter(o => !o.u.isShip && o.u !== unit);
            if (sams.length) this.offer(this.seadTask(f, unit, sams.map(o => o.u)), { force: true });
        });
    }

    // ═════════════ Task builders ═════════════
    samTask(u, fresh) {
        const war = this.game.war;
        if (!u || !u.alive || u.samTasked) return null;
        const rec = war.rec(u);
        // the whole battery: the SAMs and radars around it
        const group = war.near(u.pos, 1500, { cls: ['sam', 'sam-radar'], team: u.team }).map(o => o.u).filter(x => !x.samTasked && !x.convoyOf);
        if (!group.includes(u)) group.unshift(u);
        const name = rec && rec.known >= INTEL.IDENTIFIED ? rec.name : 'SAM SITE';
        return {
            type: 'sam', key: 'sam:' + (rec ? rec.id : u.name), title: 'DESTROY THE ' + name,
            brief: (fresh ? 'ENEMY SAM BATTERY DETECTED' : 'KNOWN SAM SITE') + ' AT GRID ' + war.grid(u.pos.x, u.pos.z) + '. TAKE IT DOWN SO OUR STRIKE AIRCRAFT CAN GET THROUGH. STAY LOW, USE THE TERRAIN.',
            units: group, reward: 450 + 250 * group.length, label: 'SAM',
            progress: (t) => t.units.filter(x => !x.alive).length + '/' + t.units.length,
            onOffer: () => { for (const x of group) x.samTasked = true; }, onEnd: () => { for (const x of group) x.samTasked = false; },
            check: (t) => (t.units.every(x => !x.alive) ? 'done:THE SAMS ARE DOWN — THE CORRIDOR IS OPEN' : null),
        };
    }

    telTask(u, launchAt, target) {
        const war = this.game.war, d = this.game.director;
        if (!u || !u.alive) return null;
        const rec = war.rec(u);
        const rp = d && d.tel && d.tel.u === u ? d.tel.report : null;
        return {
            type: 'tel', key: 'tel:' + (rec ? rec.id : 0) + ':' + (launchAt ? Math.round(launchAt) : 'x'), urgent: true,
            title: launchAt ? 'DESTROY THE TEL BEFORE IT FIRES' : 'DESTROY THE ENEMY TEL',
            brief: (launchAt ? 'A BALLISTIC MISSILE LAUNCHER IS PREPARING TO FIRE' + (target ? ' ON ' + target.label : '') + '. ' : 'MOBILE MISSILE LAUNCHER LOCATED. ') + 'SEARCH NEAR GRID ' + war.grid((rp ? rp.center : u.pos).x, (rp ? rp.center : u.pos).z) + ' — IT HIDES AMONG THE TREES.',
            units: [u], reward: launchAt ? 1000 : 800, label: 'TEL', expires: launchAt ? Math.max(30, launchAt - war.time) : 240,
            area: launchAt && rp ? { center: rp.center, radius: rp.radius } : null, report: launchAt ? rp : null,
            progress: () => (launchAt ? 'LAUNCH IN ' + clock(launchAt - war.time) : ''),
            check: () => {
                if (!u.alive) return 'done:' + (launchAt ? 'NO LAUNCH TODAY — THE TEL IS DESTROYED' : 'THE LAUNCHER IS DESTROYED');
                if (launchAt && war.time > launchAt + 20) return 'failed:THE MISSILE IS AWAY';
                return null;
            },
        };
    }

    raidTask(f) {
        if (!f || f.done) return null;
        const label = f.target ? f.target.label : 'OUR LINES';
        const from = f.target ? ' FROM THE ' + compass(f.target.pos, f.pos) : '';
        return {
            type: 'raid', key: 'raid:' + f.id, urgent: true, title: (f.role === 'cas' ? 'STOP THE ATTACK ON ' : 'INTERCEPT THE RAID ON ') + label,
            brief: f.n + ' ENEMY ' + (f.role === 'cas' ? 'ATTACK AIRCRAFT' : 'STRIKE AIRCRAFT') + ' INBOUND ON ' + label + from + '. BREAK IT UP BEFORE THEY GET THERE — THE BOMBERS FIRST.',
            pos: () => f.pos, reward: 700, label: 'RAID', expires: 120, data: { flight: f, label },
            progress: () => f.n + ' LEFT' + (f.target ? ' · ' + km(f.pos.distanceTo(f.target.pos)) + ' TO TARGET' : ''),
            check: () => {
                if (f.n === 0) return 'done:THE RAID IS BROKEN UP';
                if (f.hitReported && f.struck !== false) return 'failed:THE RAID HIT ' + label;
                if (f.done || f.hitReported) return 'done:THE RAID TURNED BACK';
                return null;
            },
        };
    }

    reconFlightTask(f) {
        if (!f || f.done) return null;
        const label = f.target ? f.target.label : 'OUR BASES';
        return {
            type: 'intercept', key: 'recon:' + f.id, urgent: true, title: 'UNKNOWN AIRCRAFT APPROACHING ' + label,
            brief: 'A SINGLE FAST MOVER, HIGH, HEADING FOR ' + label + '. INTERCEPT IT BEFORE IT GETS A GOOD LOOK — IT WILL RUN.',
            pos: () => f.pos, reward: 600, label: 'UNKNOWN', expires: 120, data: { flight: f },
            progress: () => 'ANGELS ' + Math.round(f.pos.y * 3.281 / 1000),
            check: () => (f.n === 0 ? 'done:SPLASH — THE SPY PLANE IS DOWN' : f.done ? 'failed:IT GOT AWAY' : null),
        };
    }

    supportTask(ours, theirs) {
        if (!ours || ours.done) return null;
        return {
            type: 'support', key: 'support:' + ours.id, urgent: true, title: 'SUPPORT ' + ours.callsign + ' FLIGHT',
            brief: ours.callsign + ' IS ENGAGED WITH ' + (theirs ? theirs.n : 'SEVERAL') + ' BANDITS. GET THERE AND TAKE THE PRESSURE OFF.',
            pos: () => ours.pos, reward: 500, label: ours.callsign, expires: 90, data: { flight: theirs },
            progress: () => ours.n + ' FRIENDLIES · ' + (theirs ? theirs.n : '?') + ' BANDITS',
            check: () => {
                if (ours.n === 0) return 'failed:' + ours.callsign + ' FLIGHT IS LOST';
                if (!theirs || theirs.n === 0 || theirs.done) return 'done:' + ours.callsign + ' OWES YOU ONE';
                return null;
            },
        };
    }

    protectTask(c, f) {
        if (!c) return null;
        return {
            type: 'protect', key: 'protect:' + c.id, urgent: true, title: 'PROTECT ' + c.callsign,
            brief: c.callsign + ' IS UNDER AIR ATTACK ON THE ROAD TO ' + c.destName + '. KILL THE ATTACKERS.',
            pos: () => c.centre(new THREE.Vector3()), reward: 550, label: c.callsign, expires: 100, data: { flight: f },
            progress: () => c.alive().length + '/' + c.total + ' VEHICLES',
            check: () => {
                if (c.state === 'destroyed' || (!c.alive().length && !(c.arrived > 0))) return 'failed:' + c.callsign + ' IS DESTROYED';
                if (!f || f.n === 0) return 'done:THE ATTACKERS ARE DOWN — ' + c.callsign + ' IS SAFE';
                if (f.done || f.state === 'rtb') return 'done:THE ATTACKERS HAVE BROKEN OFF';
                return null;
            },
        };
    }

    escortTask(c) {
        if (!c) return null;
        return {
            type: 'escort', key: 'escort:' + c.id, title: 'ESCORT ' + c.callsign + ' TO ' + c.destName,
            brief: c.callsign + ', ' + c.total + ' VEHICLES WITH SUPPLIES FOR THE FRONT, ON THE ROAD TO ' + c.destName + '. KEEP ENEMY AIRCRAFT OFF THEM.',
            pos: () => c.centre(new THREE.Vector3()), reward: 600, label: c.callsign, expires: 180,
            progress: () => c.alive().length + '/' + c.total + ' VEHICLES',
            check: (t) => {
                if (c.state === 'arrived' || c.state === 'turned back') {
                    if ((c.arrived || 0) >= Math.ceil(c.total / 2)) { if (t.state === 'active') t.playerHit = true; return 'done:THE SUPPLIES GOT THROUGH'; }
                    return 'failed:TOO FEW TRUCKS GOT THROUGH';
                }
                if (c.state === 'destroyed') return 'failed:' + c.callsign + ' IS DESTROYED';
                return null;
            },
        };
    }

    convoyTask(c, rp) {
        const war = this.game.war;
        if (!c) return null;
        const need = Math.ceil(c.total * 0.7);
        return {
            type: 'convoy', key: 'convoy:' + c.id, title: 'ATTACK THE ENEMY SUPPLY CONVOY',
            brief: 'A SUPPLY CONVOY IS HEADING FOR THE FRONT, TOWARD ' + c.destName + '. FIND IT ON THE ROAD (SEARCH AREA ' + war.grid(rp.center.x, rp.center.z) + ') AND DESTROY MOST OF IT. WATCH FOR ITS AIR DEFENCES.',
            area: { center: rp.center, radius: rp.radius }, report: rp, reward: 650, label: 'CONVOY', expires: 240, units: c.vehicles.slice(), need,
            pos: () => (c.vehicles.some(v => v.alive && war.known(v) >= INTEL.CONTACT) ? c.centre(new THREE.Vector3()) : rp.center),
            progress: () => c.vehicles.filter(v => !v.alive).length + '/' + need + ' DESTROYED',
            onOffer: () => { rp.tasked = true; },
            check: () => {
                if (c.vehicles.filter(v => !v.alive).length >= need) return 'done:THE CONVOY IS DESTROYED — THEIR FRONT WILL RUN SHORT';
                if (c.state === 'arrived') return 'failed:THE CONVOY REACHED ' + c.destName;
                if (c.state === 'turned back') return 'done:THE CONVOY TURNED BACK';
                return null;
            },
        };
    }

    restrikeTask(st, aim) {
        const g = this.game, war = g.war;
        const u = aim.unit;
        const type = STRIKE_TYPES[st.type] ? st.type : 'cruise';
        return {
            type: 'restrike', key: 'restrike:' + (war.rec(u)?.id), title: 'RE-STRIKE — ' + (aim.label || war.label(u)),
            brief: 'BDA SHOWS ' + (aim.label || 'THE TARGET') + ' IS STILL STANDING. ACCEPT AND WE FIRE AGAIN (' + STRIKE_TYPES[type].label + ') — OR FINISH IT YOURSELF.',
            units: [u], reward: 400, label: 'RE-STRIKE', expires: 240,
            onAccept: (t) => {
                t.playerHit = true; // (calling it in counts)
                const d = war.designate(u, 'restrike');
                war.transmit([d]);
                if (g.strikes && !g.strikes.request(type, [d], war.side, true)) this.say('COMMAND', 'NO SHOOTER AVAILABLE — IT\'S YOURS, ' + (g.callsign || 'VIPER') + ' 1', { color: AMBER, say: false });
                else this.say('COMMAND', 'RE-STRIKE ORDERED ON ' + (aim.label || war.label(u)), { color: '#9fd4ff', say: false });
            },
            check: () => (!u.alive ? 'done:TARGET DESTROYED' : null),
        };
    }

    // destroy N enemy vehicles or guns near the line in a sector (kills are counted from acceptance)
    casTask(s, team) {
        const g = this.game, war = g.war, fr = g.front;
        if (!s || !fr || s.casTasked || typeof team !== 'string') return null;
        const need = 3 + Math.round((g.difficulty || { skill: 0.6 }).skill * 2);
        const ours = team === war.side;
        return {
            type: 'cas', key: 'cas:' + s.id + ':' + Math.round(war.time / 60), urgent: !ours,
            title: (ours ? 'SUPPORT OUR ATTACK IN SECTOR ' : 'CLOSE AIR SUPPORT IN SECTOR ') + s.name,
            brief: (ours ? 'OUR ARMOUR IS PUSHING IN ' : 'THE ENEMY IS ATTACKING IN ') + fr.sectorLabel(s) + '. DESTROY ' + need + ' ENEMY VEHICLES OR GUNS NEAR THE LINE. OUR TROOPS ARE THE BLUE ONES.',
            pos: () => s.center, reward: 600, label: 'CAS', expires: 180, limit: 600, data: { kills: 0, need },
            progress: (t) => Math.min(t.data.kills, need) + '/' + need + ' KILLS',
            onOffer: () => { s.casTasked = true; }, onEnd: () => { s.casTasked = false; },
            onAccept: (t) => { t.data.kills = 0; },
            onKill: (t, u, src, mine) => {
                if (t.state !== 'active' || !u || u.team !== war.enemyTeam || !u.pos || !mine) return;
                if (fr.sectorAt(u.pos, 12000) === s) { t.data.kills++; t.playerHit = true; }
            },
            check: (t) => {
                if (t.state === 'active' && t.data.kills >= need) return 'done:' + (ours ? 'OUR ATTACK IS GOING WELL IN SECTOR ' : 'THE ENEMY ATTACK IS STALLING IN SECTOR ') + s.name;
                if (t.state === 'offered' && !s.offensive) return 'expired';
                return null;
            },
        };
    }

    seadTask(f, unit, sams) {
        const war = this.game.war;
        if (!f || f.done || !sams.length) return null;
        return {
            type: 'sead', key: 'sead:' + f.id, title: 'SEAD FOR ' + f.callsign + ' FLIGHT',
            brief: f.callsign + ' IS ON ITS WAY TO THE ' + war.label(unit) + '. THERE ARE AIR DEFENCES AROUND IT — TAKE THEM OUT BEFORE ' + f.callsign + ' ARRIVES.',
            units: sams, reward: 350 + 150 * sams.length, label: 'SEAD', expires: 150,
            progress: (t) => t.units.filter(x => !x.alive).length + '/' + t.units.length + ' · ' + f.callsign + ' ' + km(f.pos.distanceTo(unit.pos)),
            check: (t) => {
                if (t.units.every(x => !x.alive)) return 'done:DEFENCES DOWN — ' + f.callsign + ' HAS A CLEAR RUN';
                if (f.n === 0) return 'failed:' + f.callsign + ' FLIGHT IS LOST';
                if (f.hitReported || f.done) return 'failed:' + f.callsign + ' HAD TO GO IN WITHOUT YOU';
                return null;
            },
        };
    }

    // ═════════════ Command menu ═════════════
    commands() {
        if (!this.enabled) return [];
        const out = [], P = this.focus(), a = this.active;
        const dist = (t) => { const p = this.where(t); return p ? km(p.distanceTo(P)) : ''; };
        if (a) {
            out.push({ path: ['TASKS'], label: '▶ ' + a.title, hint: (a.progress ? a.progress(a) + ' · ' : '') + dist(a), keepOpen: true, run: () => this.say(a.from, a.brief, { color: '#9fd4ff', say: false }) });
            out.push({ path: ['TASKS'], label: 'PUT ACTIVE TASK ON HOLD', run: () => this.abandon(a) });
        }
        for (const t of this.offered.sort((x, y) => (y.urgent - x.urgent) || x.t0 - y.t0)) {
            out.push({ path: ['TASKS'], label: (t.urgent ? '! ' : '') + 'ACCEPT: ' + t.title, hint: dist(t) + ' · +' + t.reward, badge: t.isNew, run: () => this.accept(t) });
        }
        if (this.offered.length) out.push({ path: ['TASKS'], label: 'IGNORE ALL OFFERS', run: () => this.dismissOffers() });
        if (!out.length) out.push({ path: ['TASKS'], label: 'NO TASKS RIGHT NOW', hint: 'STAND BY', enabled: false, run: () => {} });
        return out;
    }

    // ═════════════ Tactical map ═════════════
    mapActions(sel) {
        if (!this.enabled || !sel) return [];
        const out = [];
        const add = (t) => {
            if (out.some(o => o.task === t)) return;
            if (t.state === 'offered') out.push({ task: t, label: 'ACCEPT TASK: ' + t.title + ' (+' + t.reward + ')', run: () => this.accept(t) });
            else if (t.state === 'active') out.push({ task: t, label: 'ACTIVE TASK — PUT ON HOLD', run: () => this.abandon(t) });
        };
        const live = this.tasks.filter(LIVE);
        if (sel.kind === 'unit') for (const t of live) if (t.units.includes(sel.unit)) add(t);
        if (sel.kind === 'report') for (const t of live) if (t.report === sel.report) add(t);
        if (sel.kind === 'point' && this.game.tacmap) {
            const map = this.game.tacmap, S = map.toScreen(sel.pos.x, sel.pos.z, {});
            for (const t of live) {
                const p = this.where(t);
                if (!p) continue;
                const Q = map.toScreen(p.x, p.z, {});
                if (Math.hypot(Q.x - S.x, Q.y - S.y) < 22 || (t.area && Math.hypot(t.area.center.x - sel.pos.x, t.area.center.z - sel.pos.z) < t.area.radius)) add(t);
            }
        }
        return out;
    }

    drawMap(ctx, map) {
        if (!this.enabled) return;
        const live = this.tasks.filter(LIVE);
        const P = {}, F = this.focus();
        ctx.save();
        ctx.textBaseline = 'middle';
        for (const t of live) {
            const p = this.where(t);
            if (!p) continue;
            map.toScreen(p.x, p.z, P);
            const act = t.state === 'active', col = act ? GREEN : AMBER;
            if (t.area && !t.report) {
                const C = map.toScreen(t.area.center.x, t.area.center.z);
                ctx.strokeStyle = col; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.arc(C.x, C.y, t.area.radius * map.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
            }
            if (act) {
                const Q = map.toScreen(F.x, F.z);
                ctx.strokeStyle = 'rgba(93,255,160,0.5)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(P.x, P.y); ctx.stroke(); ctx.setLineDash([]);
            }
            ctx.strokeStyle = col; ctx.fillStyle = act ? 'rgba(93,255,160,0.25)' : 'rgba(255,194,63,0.15)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(P.x, P.y - 12); ctx.lineTo(P.x + 12, P.y); ctx.lineTo(P.x, P.y + 12); ctx.lineTo(P.x - 12, P.y); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = col; ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.textAlign = 'center';
            ctx.fillText((act ? '▶ ' : (t.urgent ? '! ' : '')) + t.label, P.x, P.y - 20);
        }
        // the task list (top left), with buttons
        const x = 16, W = 380;
        let y = map.toolsBottom || 16; // (under the map kit's tool strip and legend: it covered them)
        const rows = [];
        const act = this.active;
        if (act) rows.push({ text: '▶ ' + act.title, sub: (act.progress ? act.progress(act) + ' · ' : '') + (this.where(act) ? km(this.where(act).distanceTo(F)) : ''), col: GREEN, btn: 'HOLD', run: () => this.abandon(act) });
        for (const t of this.offered) rows.push({ text: (t.urgent ? '! ' : '') + t.title, sub: '+' + t.reward + (this.where(t) ? ' · ' + km(this.where(t).distanceTo(F)) : '') + ' · OFFER ENDS IN ' + clock(t.expires - (this.game.war.time - t.t0)), col: AMBER, btn: 'ACCEPT', run: () => this.accept(t) });
        const H = 30 + Math.max(1, rows.length) * 36;
        ctx.fillStyle = 'rgba(6,12,18,0.82)'; ctx.strokeStyle = 'rgba(255,194,63,0.45)'; ctx.lineWidth = 1;
        ctx.fillRect(x, y, W, H); ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
        ctx.textAlign = 'left'; ctx.fillStyle = AMBER; ctx.font = '700 13px "Share Tech Mono", monospace';
        ctx.fillText('TASKS' + (this.doneCount ? ' · ' + this.doneCount + ' DONE' : ''), x + 12, y + 16);
        y += 32;
        if (!rows.length) { ctx.fillStyle = DIM; ctx.font = '600 11px "Share Tech Mono", monospace'; ctx.fillText('NONE RIGHT NOW — COMMAND WILL CALL', x + 12, y + 6); }
        for (const r of rows) {
            ctx.fillStyle = r.col; ctx.font = '700 11px "Share Tech Mono", monospace';
            ctx.fillText(r.text, x + 12, y + 4, W - 100);
            ctx.fillStyle = DIM; ctx.font = '600 10px "Share Tech Mono", monospace';
            ctx.fillText(r.sub, x + 12, y + 18, W - 100);
            const bx = x + W - 78, by = y - 6, bw = 66, bh = 22;
            const hov = map.mouse && map.mouse.x >= bx && map.mouse.x <= bx + bw && map.mouse.y >= by && map.mouse.y <= by + bh;
            ctx.fillStyle = hov ? 'rgba(255,194,63,0.4)' : 'rgba(255,194,63,0.18)'; ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = '#e8f4ff'; ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.textAlign = 'center';
            ctx.fillText(r.btn, bx + bw / 2, by + bh / 2 + 1); ctx.textAlign = 'left';
            if (Array.isArray(map.buttons)) map.buttons.push({ x: bx, y: by, w: bw, h: bh, run: r.run });
            y += 36;
        }
        ctx.restore();
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        if (!this.enabled) return;
        const g = this.game;
        if (g.photo || g.hideHud || (g.tacmap && g.tacmap.open)) return;
        const C = hud.compact, M = C ? 14 : 28;
        const t = this.active, war = g.war;
        ctx.save();
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        // (in a room its title and station list have the top left: the task lines go above its key line at the bottom)
        const room = g.indoors && g.indoors.kind === 'room';
        const lines = (t ? 1 : 0) + (t && war.time - t.tAccept < 14 && t.brief ? 1 : 0) + (this.offered.length ? 1 : 0);
        let y = room ? (hud.roomBottom || hud.h - 58) - (C ? 16 : 18) * Math.max(0, lines - 1) : C ? 84 : 72;
        if (t) {
            const p = this.where(t);
            const d = p ? p.distanceTo(this.focus()) : null;
            const left = t.limit ? ' · ' + clock(t.limit - (war.time - t.tAccept)) : '';
            const line = '▶ ' + t.title + (d != null ? ' · ' + km(d) : '') + (t.progress ? ' · ' + t.progress(t) : '') + left;
            ctx.font = (C ? '700 11px' : '700 13px') + ' "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = 'rgba(0,8,6,0.35)'; ctx.fillRect(M - 4, y - 9, Math.min(ctx.measureText(line).width + 8, hud.w * 0.6), 18);
            ctx.fillStyle = AMBER; ctx.fillText(line, M, y, hud.w * 0.6);
            y += C ? 16 : 18;
            if (war.time - t.tAccept < 14 && t.brief) {
                ctx.font = (C ? '600 10px' : '600 11px') + ' "Share Tech Mono", ui-monospace, monospace';
                ctx.fillStyle = 'rgba(255,230,170,0.85)';
                ctx.fillText(t.brief, M, y, hud.w * 0.6);
                y += C ? 14 : 16;
            }
            this.markTargets(ctx, hud, t);
        }
        const n = this.offered.length;
        if (n) {
            const fresh = this.offered.some(o => o.isNew);
            const blink = !fresh || (g.time * 2) % 1 < 0.65;
            ctx.font = (C ? '600 10px' : '600 12px') + ' "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = blink ? AMBER : 'rgba(255,194,63,0.4)';
            ctx.fillText((fresh ? '● ' : '') + n + ' TASK' + (n > 1 ? 'S' : '') + ' OFFERED — \\ › TASKS TO ACCEPT', M, y, hud.w * 0.6);
        }
        // a new offer: a line under the banner for a few seconds
        const ts = this.toast;
        if (ts && g.time - ts.t < 6 && ts.task.state === 'offered') {
            const a = clamp(Math.min((g.time - ts.t) * 3, (6 - (g.time - ts.t)) * 1.5), 0, 1);
            ctx.globalAlpha = a;
            ctx.textAlign = 'center';
            ctx.font = (C ? '700 13px' : '700 16px') + ' "Share Tech Mono", ui-monospace, monospace';
            const yy = C ? hud.h * 0.24 + 58 : hud.h * 0.1 + 80;
            const txt = (ts.task.urgent ? 'PRIORITY TASK — ' : 'NEW TASK — ') + ts.task.title;
            const w = ctx.measureText(txt).width + 24;
            ctx.fillStyle = 'rgba(0,8,6,0.4)'; ctx.fillRect(hud.w / 2 - w / 2, yy - 13, w, 44);
            ctx.fillStyle = AMBER; ctx.fillText(txt, hud.w / 2, yy);
            ctx.font = (C ? '600 10px' : '600 12px') + ' "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = '#e8f4ff'; ctx.fillText('\\ › TASKS TO ACCEPT · ` MAP', hud.w / 2, yy + 20);
        }
        ctx.restore();
    }

    // brackets on the active task's targets we know about
    markTargets(ctx, hud, t) {
        const g = this.game, war = g.war, cam = g.camera, P = _p;
        for (const u of t.units) {
            if (!u.alive || u.removed) continue;
            if (u.team !== war.side && war.known(u) < INTEL.CONTACT) continue;
            const d = u.pos.distanceTo(cam.position);
            if (d > 25000) continue;
            hud.project(u.pos, cam, P);
            if (!P.front || P.x < 0 || P.x > hud.w || P.y < 0 || P.y > hud.h) continue;
            const s = clamp(2600 / Math.max(d, 1), 12, 30) + 8;
            ctx.strokeStyle = AMBER; ctx.lineWidth = 1.6;
            ctx.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                ctx.moveTo(P.x + sx * s, P.y + sy * (s - 6)); ctx.lineTo(P.x + sx * s, P.y + sy * s); ctx.lineTo(P.x + sx * (s - 6), P.y + sy * s);
            }
            ctx.stroke();
            ctx.fillStyle = AMBER; ctx.font = '600 10px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'center';
            ctx.fillText('TASK', P.x, P.y + s + 10);
            ctx.textAlign = 'left';
        }
    }
}
