// ═══════════════════════════════════════════════════════════════
// Night and weather in play (docs/WAR.md "Night and weather"): the game plug-in (systems.js) around the sky model
// (weather.js, world.wx) and the fire-light list (firelight.js). game.weather is this:
//  • the API: set(kind, { transition }), front(kind, opts), setTime(hourOrKey), timeScale, and the queries the other
//    systems use — visibility, transmittance by sensor band (eye, TV, IR, radar), irClear, ceiling, rain, storms, the
//    night level and whether the lights are on (the airbases' hook)
//  • light sources that move: missile and rocket motors (the player's, the AI's, SAMs, the strike manager's boosters
//    and rockets), flares, gun and AAA muzzle flashes, launches
//  • the Living War's sky: the clock runs (the war goes on into dusk and night) and fronts come through every so
//    often, announced on the radio
//  • telling the player: TGT OBSCURED on the HUD, WEATHER OVER TARGET on the radio, the weather on the tactical map
//    (a weather-radar picture of the rain, the storm cells, cloud and fog, the front), SANDBOX › WEATHER / TIME
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { fireLights, FIRE_COLORS } from './firelight.js';
import { WEATHER_KINDS, KEY_HOURS, rainSigma, rainRateOf, rainTop } from './weather.js';
import { clamp, rand } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _wm = [0, 0, 0, 0], _pp = {};

// motor light by weapon kind (cd); the motor burns for the weapon's own boost time
const MOTOR = { aam: 14000, lrm: 17000, sam: 24000, rkt: 6000 };
// what the radio calls each weather
const SAY = {
    clear: 'CLEARING', cloudy: 'BROKEN CLOUD', rain: 'RAIN', storm: 'A LINE OF THUNDERSTORMS', fog: 'FOG', overcast: 'LOW CLOUD AND DRIZZLE',
};
// what comes after what in the Living War (weights)
const NEXT = {
    clear: [['cloudy', 3], ['overcast', 1], ['fog', 0.6]],
    cloudy: [['rain', 2], ['clear', 2], ['storm', 1], ['overcast', 1]],
    rain: [['storm', 1.5], ['cloudy', 2], ['overcast', 1]],
    storm: [['rain', 2], ['cloudy', 1]],
    fog: [['clear', 2], ['cloudy', 1], ['overcast', 1]],
    overcast: [['cloudy', 2], ['rain', 1.5], ['clear', 1]],
};
// sensor bands: how much of each term a sensor sees (haze is the fog shader's exp² term)
const BANDS = {
    eye: { haze: 1, fog: 1, rain: 1, cloud: 1 },
    tv: { haze: 1, fog: 1, rain: 1, cloud: 1 },
    ir: { haze: 0.12, fog: 0.85, rain: 0.55, cloud: 1 },     // MWIR / LWIR: through haze, not through cloud or fog
    radar: { haze: 0, fog: 0, rain: 0.02, cloud: 0, floor: 0.55 }, // X band: clouds are nothing, heavy rain costs some range
};

export class WeatherSystem {
    constructor(game) {
        this.game = game;
        this.auto = true;          // the Living War changes the weather by itself (fronts every 15-35 min)
        this.lastTell = new Map(); // what was already said about a target (WEATHER OVER TARGET)
        this.obscured = null;      // the locked target's view: { unit, T, why, ir }
        this.checkT = 0;
        game.events.on('gunfire', (ac) => this.onGun(ac));
        game.events.on('aaaFire', (u) => this.onAAA(u));
        game.events.on('missileLaunch', (ac, d) => this.onLaunch(ac, d));
        game.events.on('flares', (ac) => this.onFlares(ac));
        game.events.on('taskAccepted', (t) => this.onTask(t));
        game.events.on('warDesignate', (d) => this.onMark(d));
    }

    get wx() { return this.game.world && this.game.world.wx; }

    // ═════════════ API ═════════════
    // the weather everywhere: now (transition 0) or blended in over `transition` seconds
    set(kind, { transition = 0, say = false } = {}) {
        const wx = this.wx;
        if (!wx || !WEATHER_KINDS[kind]) return false;
        if (transition > 0) wx.set(kind, { transition });
        else this.game.world.setWeather(kind);
        if (say) this.radio('WEATHER: ' + SAY[kind] + (transition > 0 ? ' OVER THE NEXT ' + Math.round(transition / 60) + ' MINUTES' : ''));
        return true;
    }
    // a front: `kind` moves in behind a line. opts: heading (rad, the way it moves; default with the wind), speed (m/s,
    // default 18), width (m, the transition zone, default 16 km), eta (s until it reaches the camera) or dist (m)
    front(kind, opts = {}) {
        const wx = this.wx;
        if (!wx || !WEATHER_KINDS[kind]) return null;
        const f = wx.sendFront(kind, opts);
        if (opts.say !== false) {
            const eta = Math.max(1, Math.round(((opts.eta ?? 30000 / (opts.speed || 18))) / 60));
            this.radio('WEATHER: ' + SAY[kind] + ' MOVING IN FROM THE ' + compass(f.nx, f.nz, true) + ', ABOUT ' + eta + ' MINUTES OUT');
        }
        return f;
    }
    get kind() { return this.wx ? this.wx.kind : 'clear'; }
    // the sky clock: game seconds per second (0 = the time of day stands still)
    get timeScale() { return this.wx ? this.wx.timeScale : 0; }
    set timeScale(v) { if (this.wx) this.wx.timeScale = Math.max(0, +v || 0); }
    get hour() { return this.wx ? this.wx.hour : KEY_HOURS.day; }
    // hours (0-24) or one of the menu's times ('dawn', 'day', 'dusk', 'night')
    setTime(h) {
        const w = this.game.world;
        if (!w || !w.wx) return;
        const hour = typeof h === 'string' ? KEY_HOURS[h] ?? KEY_HOURS.day : +h;
        w.wx.setHour(hour);
        w.applySky(true);
    }
    // 0 (day) … 1 (night); lights on (the airbases' runway lights and searchlights: airbase.js decides by this)
    get night() { return this.wx ? this.wx.night : 0; }
    get lightsOn() { return !!(this.game.world && this.game.world.lightsOn); }
    // meteorological visibility (m) at a point; the lowest cloud base over it (m, Infinity: none); rain (mm/h); storm 0..1
    visibility(pos) { return this.wx ? this.wx.visibilityAt(pos) : 50000; }
    ceiling(pos) { return this.wx ? this.wx.ceilingAt(pos.x, pos.z) : Infinity; }
    rainAt(pos) { return this.wx ? this.wx.rainAt(pos.x, pos.z) : 0; }
    stormAt(pos) { return this.wx ? this.wx.stormAt(pos.x, pos.z) : 0; }

    // What a sensor sees of b from a (0..1 contrast transmittance): band 'eye' | 'tv' | 'ir' | 'radar'
    transmittance(a, b, band = 'eye') {
        const wx = this.wx;
        if (!wx) return 1;
        const B = BANDS[band] || BANDS.eye;
        let tau2 = 0, tau = 0;
        if (B.haze > 0 || B.fog > 0) { const t = wx.fogTaus(a, b, _taus); tau2 += t.haze * t.haze * B.haze; tau += t.ground * B.fog; }
        if (B.rain > 0) tau += wx.rainTau(a, b) * B.rain;
        if (B.cloud > 0) tau += wx.cloudTau(a, b) * B.cloud;
        return Math.max(B.floor || 0, Math.exp(-tau2 - tau));
    }
    // An IR seeker's line of sight: no lock through cloud or fog
    irClear(a, b) { return this.transmittance(a, b, 'ir') > 0.25; }
    // How careful the weather makes a pilot here (0..1: ai.js flies higher and gentler): night, low visibility (fog,
    // cloud, heavy rain), thunderstorm cells, turbulence
    caution(pos) {
        const wx = this.wx;
        if (!wx) return 0;
        const vis = wx.visibilityAt(pos);
        return clamp(0.3 * wx.night + (vis < 5000 ? (5000 - vis) / 5000 * 0.6 : 0) + wx.stormAt(pos.x, pos.z) * 0.6 + wx.local.turb * 0.15, 0, 1);
    }
    // what's in the way, for the cue: 'CLOUD' | 'FOG' | 'RAIN' | 'HAZE'
    obstruction(a, b) {
        const wx = this.wx;
        if (!wx) return null;
        const t = wx.fogTaus(a, b, _taus);
        const c = wx.cloudTau(a, b), r = wx.rainTau(a, b), f = t.ground, h = t.haze * t.haze;
        const m = Math.max(c, r, f, h);
        return m === c ? 'CLOUD' : m === f ? 'FOG' : m === r ? 'RAIN' : 'HAZE';
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        fireLights.clear();
        this.lastTell.clear();
        this.obscured = null;
        this.mode = mode;
        const wx = this.wx;
        if (!wx) return;
        // the Living War's clock runs (a day passes in a little over an hour); elsewhere the time stands still
        wx.timeScale = mode === 'war' ? 20 : 0;
        this.nextFront = mode === 'war' ? rand(600, 1100) : Infinity;
        this.frontSaid = false;
    }
    clear() { fireLights.clear(); if (this.wx) this.wx.timeScale = 0; }

    // ═════════════ Light sources ═════════════
    onGun(ac) {
        if (!ac || !ac.pos) return;
        const fwd = ac.getForward ? ac.getForward(_v) : _v.set(0, 0, -1);
        _v2.copy(ac.pos).addScaledVector(fwd, (ac.spec ? ac.spec.length : 12) * 0.5);
        fireLights.flash(_v2, 1800, 0.07, { color: FIRE_COLORS.muzzle, core: 1.2, merge: 40, cloud: 0.4, flicker: 0.6 });
    }
    onAAA(u) {
        if (!u || !u.pos) return;
        _v.copy(u.pos); _v.y += 3;
        fireLights.flash(_v, 2600, 0.09, { color: FIRE_COLORS.muzzle, core: 1.5, merge: 30, cloud: 0.2, flicker: 0.6 });
    }
    onLaunch(ac, d) {
        const m = d && d.missile;
        if (!m || m.kind === 'rkt') return;
        fireLights.flash(m.pos, (MOTOR[m.kind] || 14000) * 1.4, 0.35, { color: FIRE_COLORS.flash, core: 2.5, merge: 20 });
    }
    onFlares(ac) {
        if (ac && ac.pos) fireLights.flash(ac.pos, 9000, 0.25, { color: FIRE_COLORS.flare, core: 3, merge: 30 });
    }

    // every frame: the motors burning and the flares in the air
    scanLights() {
        const g = this.game, w = g.weapons;
        if (w) {
            for (const m of w.missiles) {
                const W = m.W;
                const burning = W.unguided ? m.age < W.boost + 0.1 : m.age > 0.25 && m.age < W.boost + 0.25;
                if (!burning) continue;
                // the plume just behind the missile
                const sp = m.vel.length();
                _v.copy(m.pos);
                if (sp > 1) _v.addScaledVector(m.vel, -2.2 / sp);
                fireLights.keep(m, _v, MOTOR[m.kind] || 14000, { color: FIRE_COLORS.motor, core: 2.5, cloud: 1.6, glow: 1.2, flicker: 0.12, vel: m.vel });
            }
            // a salvo of flares is one light at its middle
            const salvos = this._salvos || (this._salvos = new Map());
            salvos.clear();
            for (const f of w.flares) {
                if (!f.alive || f.life <= 0) continue;
                let s = salvos.get(f.salvo);
                if (!s) { s = this.salvoScratch(salvos.size); salvos.set(f.salvo, s); }
                s.p.add(f.pos); s.n++; s.life = Math.max(s.life, f.life);
            }
            for (const [key, s] of salvos) {
                s.p.divideScalar(s.n);
                // (they burn out over their last half second)
                fireLights.keep(key, s.p, 5200 * s.n * Math.min(1, s.life * 2), { color: FIRE_COLORS.flare, core: 3, cloud: 1.2, glow: 1.4, flicker: 0.35 });
            }
        }
        // the strike manager's missiles: boosters, rocket motors
        const st = g.strikes;
        if (st && st.missiles) {
            for (const m of st.missiles) {
                if (!m.alive) continue;
                const burning = m.phase === 'boost' || (m.kind === 'rocket' && m.motorT > 0);
                if (!burning) continue;
                const s = m.spec || {};
                _v.copy(m.vel).normalize().multiplyScalar(-(s.len || 6) * 0.55).add(m.pos);
                const I = m.kind === 'ballistic' ? 90000 : m.kind === 'rocket' ? 9000 : 42000;
                fireLights.keep(m, _v, I, { color: FIRE_COLORS.motor, core: m.kind === 'ballistic' ? 8 : 4, cloud: 1.8, glow: 1.3, flicker: 0.1, vel: m.vel });
            }
        }
    }
    // Burning fuel on the sea round a sinking ship: flames low on the water, spreading downwind from the hull as it
    // goes down (their light, like every fire's, from effects.puffFire → firelight.js; the sea reflects it: ocean.js)
    burningOil(dt) {
        const g = this.game, nv = g.naval, fx = g.effects;
        if (!nv || !nv.ships || !fx) return;
        const cam = g.camera.position;
        for (const s of nv.ships) {
            if (s.alive || !(s.sinkT > 1) || s.sinkT > 62 || !s.def) continue;
            if (s.pos.distanceToSquared(cam) > 9000 * 9000) continue;
            s._oilT = (s._oilT || 0) - dt;
            if (s._oilT > 0) continue;
            s._oilT = 0.06;
            const k = Math.min(1, s.sinkT / 25), fade = 1 - Math.max(0, (s.sinkT - 45) / 17);
            const R = s.def.L * (0.4 + 0.9 * k);
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
            // (the slick drifts downwind of the hull)
            const w = g.wind;
            _v.set(s.pos.x + Math.cos(a) * r + (w ? w.x : 0) * s.sinkT * 0.6, 0.6, s.pos.z + Math.sin(a) * r * 0.6 + (w ? w.z : 0) * s.sinkT * 0.6);
            fx.puffFire(_v, _v2.set(rand(-1, 1), rand(2, 5), rand(-1, 1)), (3 + 5 * k) * fade, 0.55);
            if (Math.random() < 0.35) fx.puffSmoke(_v, _v2.set(0, rand(4, 8), 0), 5 + 5 * k, 0.05, 6, 0.7 * fade);
        }
    }
    salvoScratch(i) {
        const pool = this._salvoPool || (this._salvoPool = []);
        const s = pool[i] || (pool[i] = { p: new THREE.Vector3(), n: 0, life: 0 });
        s.p.set(0, 0, 0); s.n = 0; s.life = 0;
        return s;
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        const g = this.game, wx = this.wx;
        this.scanLights();
        this.burningOil(dt);
        if (!wx) return;
        // the wind blows as hard as the weather here says (from the west-south-west)
        const ws = wx.local.wind;
        if (g.wind) g.wind.set(Math.cos(wx.windAngle) * ws, 0, Math.sin(wx.windAngle) * ws);
        // the glow pass's extinction (nightfx.js) and the particles' fog go by the air where things are
        fireLights.extinctionAt = this.extinctionFn || (this.extinctionFn = (x, y, z) => this.extinctionAt(x, y, z));
        // the Living War: fronts every so often
        if (this.mode === 'war' && this.auto && g.state === 'playing') {
            this.nextFront -= dt;
            if (this.nextFront <= 0 && !wx.front && !wx.tr) {
                this.nextFront = rand(900, 2100);
                const cur = wx.kind;
                const opts = NEXT[cur] || NEXT.clear;
                let total = 0; for (const [, w] of opts) total += w;
                let r = Math.random() * total, next = opts[0][0];
                for (const [k, w] of opts) { r -= w; if (r <= 0) { next = k; break; } }
                // fog only forms in the night and early morning
                const h = wx.hour;
                if (next === 'fog' && h > 9 && h < 20) next = 'cloudy';
                this.front(next, { eta: rand(240, 540), speed: rand(14, 24), width: rand(12000, 22000) });
            }
        }
        // the locked target: can it be seen, is there an IR line of sight (4 Hz)
        this.checkT -= dt;
        if (this.checkT <= 0) { this.checkT = 0.25; this.checkLock(); }
    }

    // the air's extinction at a point (1/m): haze + mist, the ground fog there, rain (for the glow in the air)
    extinctionAt(x, y, z) {
        const wx = this.wx, SF = this.game.world.SKY_FOG;
        let s = 0;
        if (SF) s += (SF.a[0] * Math.exp(-SF.a[1] * Math.max(y, 0)) + SF.d[0] * Math.exp(-SF.d[1] * Math.max(y, 0))) * 1.978;
        const gf = wx.groundFogAt(x, z, _gf);
        if (gf.D > 0) s += gf.D / (1 + Math.exp(Math.min((y - gf.H) / 30, 80)));
        if (wx.local.rain > 0 || wx.local.cells > 0) {
            const P = wx.paramsAt(x, z, _pp);
            if (y < rainTop(P)) s += rainSigma(wx.rainAt(x, z));
        }
        return s;
    }

    // Is the locked target visible (eye) and, for a heat seeker, in the seeker's view? (game.js reads irBlocked)
    checkLock() {
        const g = this.game, p = g.player, t = g.lockTarget;
        this.obscured = null;
        g.irBlocked = false;
        if (!p || !p.alive || !t || !t.pos || g.pilotMode) return;
        const eye = p.pos;
        const T = this.transmittance(eye, t.pos, 'eye');
        const W = g.slotW;
        const ir = W && !W.radar && !W.unguided && W !== undefined && g.slotDef && g.slotDef.key === 'srm';
        const irOk = !ir || this.irClear(eye, t.pos);
        g.irBlocked = !irOk;
        if (T < 0.12 || !irOk) this.obscured = { unit: t, T, why: this.obstruction(eye, t.pos), ir: !irOk };
    }

    // ═════════════ Radio ═════════════
    radio(text) {
        const g = this.game, d = g.director;
        if (d && d.enabled && d.say) d.say('WEATHER', text, { color: '#9fd4ff', say: false, ttl: 30 });
        else if (g.war) g.war.radio('WEATHER', text, { color: '#9fd4ff', say: false });
    }
    // the weather over a place, as the radio says it: "THUNDERSTORMS, CEILING 900 M, VISIBILITY 1.4 KM"
    describe(pos) {
        const wx = this.wx;
        if (!wx) return null;
        const P = wx.paramsAt(pos.x, pos.z, _pp);
        const y = Math.max(pos.y, 20) + 150;
        const vis = wx.visibilityAt(_v3.set(pos.x, y, pos.z));
        const ceil = wx.ceilingAt(pos.x, pos.z), rain = wx.rainAt(pos.x, pos.z), storm = wx.stormAt(pos.x, pos.z);
        const bad = vis < 5000 || ceil < 1200 || rain > 2 || storm > 0.25;
        const what = storm > 0.25 ? 'THUNDERSTORMS' : rain > 8 ? 'HEAVY RAIN' : rain > 0.5 ? 'RAIN' : vis < 1000 ? 'FOG' : P.deck > 0.8 ? 'OVERCAST' : P.thr < 0.45 ? 'BROKEN CLOUD' : 'CLEAR';
        const km = (m) => m >= 10000 ? Math.round(m / 1000) + ' KM' : (m / 1000).toFixed(1) + ' KM';
        return { bad, text: what + (isFinite(ceil) && ceil < 3000 ? ', CEILING ' + Math.round(ceil / 10) * 10 + ' M' : '') + ', VISIBILITY ' + km(vis), vis, ceil, rain, storm };
    }
    tellTarget(key, pos, lead = 'WEATHER OVER TARGET') {
        const now = this.game.time;
        if (this.lastTell.has(key) && now - this.lastTell.get(key) < 240) return;
        const d = this.describe(pos);
        if (!d || !d.bad) return;
        this.lastTell.set(key, now);
        this.radio(lead + ': ' + d.text + (d.vis < 3000 || d.ceil < 800 ? ' — EXPECT TO WORK UNDER THE WEATHER OR BY SENSORS' : ''));
    }
    onTask(t) { const pos = t && (typeof t.pos === 'function' ? t.pos() : t.pos); if (pos) this.tellTarget(t, pos); }
    onMark(d) { if (d && d.pos) this.tellTarget(d.unit || d, d.pos); }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        const g = this.game, o = this.obscured;
        if (!o || g.sensorView || g.pilotMode || !g.player || !g.player.alive) return;
        const u = o.unit;
        if (!u || !u.pos || u !== g.lockTarget) return;
        const P = hud.project(u.pos, g.camera, _scr);
        if (!P.front) return;
        const text = o.ir && o.T >= 0.12 ? 'NO IR — ' + o.why : 'TGT OBSCURED — ' + o.why;
        ctx.font = '700 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const y = P.y + 42;
        const w = ctx.measureText(text).width + 12;
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(P.x - w / 2, y - 9, w, 18);
        ctx.fillStyle = (hud.t * 3) % 1 < 0.7 ? '#ffc23f' : 'rgba(255,194,63,0.5)';
        ctx.fillText(text, P.x, y);
        // a dashed box: the symbol is where the target should be, not something seen
        ctx.strokeStyle = 'rgba(255,194,63,0.8)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.4;
        ctx.strokeRect(P.x - 22, P.y - 22, 44, 44); ctx.setLineDash([]);
    }

    // ═════════════ Tactical map: the weather ═════════════
    // A weather-radar picture of the rain (green, yellow, red, magenta in the storm cells), the cloud cover (a faint
    // white), fog (pale hatching) and a front's line; sampled on a grid over the view, redrawn every half second
    drawMap(ctx, map) {
        const wx = this.wx, cl = this.game.world && this.game.world.clouds;
        if (!wx || !cl || !cl.weatherData) return;
        if (map.layers && map.layers.weather === undefined) map.layers.weather = true; // (mapkit.js toggles it)
        if (map.layers && !map.layers.weather) return;
        const W = map.w, H = map.h;
        const cell = 14, nx = Math.ceil(W / cell), ny = Math.ceil(H / cell);
        const key = map.view.cx.toFixed(0) + ',' + map.view.cz.toFixed(0) + ',' + map.view.scale.toFixed(5) + ',' + W + 'x' + H;
        const now = performance.now();
        if (!this.mapCache || this.mapKey !== key || now - this.mapAt > 500) {
            this.mapKey = key; this.mapAt = now;
            const cv = this.mapCache || (this.mapCache = document.createElement('canvas'));
            if (cv.width !== nx || cv.height !== ny) { cv.width = nx; cv.height = ny; this.mapImg = cv.getContext('2d').createImageData(nx, ny); }
            const img = this.mapImg, D = img.data;
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
                const w = map.toWorld((i + 0.5) * cell, (j + 0.5) * cell);
                const P = wx.paramsAt(w.x, w.z, _pp);
                const wm = cl.weatherAt(w.x, w.z, _wm);
                const R = rainRateOf(P, wm);
                const cov = Math.max(clamp((wm[0] - P.thr) / (1 - P.thr), 0, 1), P.deck > 0 ? clamp((wm[2] - (1 - P.deck)) / 0.35, 0, 1) : 0);
                const fog = wx.groundFogAt(w.x, w.z, _gf).D;
                let r = 0, gg = 0, b = 0, a = 0;
                if (R > 0.8) {
                    // radar colours: green (light / moderate) → yellow → red → magenta (the storm cells)
                    if (R < 10) { r = 40; gg = 200; b = 70; } else if (R < 25) { r = 230; gg = 210; b = 40; } else if (R < 45) { r = 240; gg = 70; b = 40; } else { r = 230; gg = 60; b = 220; }
                    a = clamp(0.1 + Math.log10(R) * 0.2, 0.12, 0.6);
                } else if (cov > 0.3) { r = gg = b = 225; a = (cov - 0.3) * 0.25; }
                if (fog > 0.003 && a < 0.2) { r = 230; gg = 225; b = 170; a = Math.max(a, clamp(fog * 25, 0, 0.3) * (((i + j) & 1) ? 1 : 0.4)); }
                const o = (j * nx + i) * 4;
                D[o] = r; D[o + 1] = gg; D[o + 2] = b; D[o + 3] = a * 255;
            }
            cv.getContext('2d').putImageData(img, 0, 0);
        }
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.mapCache, 0, 0, nx * cell, ny * cell);
        // the front: a line with triangles (cold) or half circles (warm: fog, low cloud) toward where it's going
        const F = wx.front;
        if (F) {
            const px = -F.nz, pz = F.nx, L = 400000;
            const a = map.toScreen(F.x - px * L, F.z - pz * L), b = map.toScreen(F.x + px * L, F.z + pz * L);
            const cold = F.kind === 'storm' || F.kind === 'rain' || F.kind === 'cloudy';
            ctx.strokeStyle = cold ? 'rgba(90,150,255,0.9)' : 'rgba(255,90,90,0.9)'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
            const tx = F.nx, ty = F.nz; // screen: +x east, +y south (map.toScreen)
            for (let s = 0; s < len; s += 46) {
                const cx = a.x + ux * s, cy = a.y + uy * s;
                if (cx < -20 || cy < -20 || cx > W + 20 || cy > H + 20) continue;
                ctx.beginPath();
                if (cold) { ctx.moveTo(cx - ux * 7, cy - uy * 7); ctx.lineTo(cx + ux * 7, cy + uy * 7); ctx.lineTo(cx + tx * 10, cy + ty * 10); }
                else ctx.arc(cx, cy, 6, Math.atan2(uy, ux), Math.atan2(uy, ux) + Math.PI, Math.atan2(tx * uy - ty * ux, 1) > 0);
                ctx.fill();
            }
        }
        // a line of text: the weather where the player is
        const g = this.game, me = g.player && g.player.alive ? g.player.pos : g.camera.position;
        const d = this.describe(me);
        if (d) {
            ctx.font = '600 11px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
            const h = wx.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
            const txt = 'WX ' + d.text + ' · ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ' LOCAL' + (wx.timeScale > 0 ? ' ×' + wx.timeScale : '');
            ctx.fillStyle = 'rgba(6,12,18,0.8)'; const tw = ctx.measureText(txt).width + 14; ctx.fillRect(W - tw - 10, H - 34, tw, 20);
            ctx.fillStyle = '#cfe6ff'; ctx.fillText(txt, W - 17, H - 19);
        }
        ctx.restore();
    }
    // ═════════════ Command menu: the owner's sandbox (and Free Flight) ═════════════
    commands() {
        const g = this.game;
        if (!['sandbox', 'freeflight', 'war'].includes(g.mode)) return [];
        const out = [];
        const kinds = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'overcast'];
        for (const k of kinds) {
            out.push({ path: ['SANDBOX', 'WEATHER'], label: WEATHER_KINDS[k].label + ' (OVER 2 MIN)', hint: 'the whole sky', run: () => this.set(k, { transition: 120, say: true }) });
        }
        for (const k of ['storm', 'rain', 'fog', 'overcast', 'clear']) {
            out.push({ path: ['SANDBOX', 'WEATHER', 'FRONT'], label: WEATHER_KINDS[k].label + ' FRONT (≈6 MIN)', hint: 'moves in from upwind', run: () => this.front(k, { eta: 360 }) });
        }
        out.push({ path: ['SANDBOX', 'WEATHER'], label: 'AUTOMATIC FRONTS: ' + (this.auto ? 'ON' : 'OFF'), hint: 'the war changes the weather', keepOpen: true, run: () => { this.auto = !this.auto; this.nextFront = rand(300, 600); } });
        for (const [k, label] of [['dawn', 'DAWN'], ['day', 'MIDDAY'], ['dusk', 'DUSK'], ['night', 'NIGHT']]) {
            out.push({ path: ['SANDBOX', 'TIME'], label, hint: 'jump to ' + label.toLowerCase(), run: () => this.setTime(k) });
        }
        for (const s of [0, 1, 20, 60, 300]) {
            out.push({ path: ['SANDBOX', 'TIME'], label: s === 0 ? 'CLOCK STOPPED' : 'CLOCK ×' + s, hint: s === 20 ? 'the Living War' : '', enabled: this.timeScale !== s, keepOpen: true, run: () => { this.timeScale = s; } });
        }
        return out;
    }
}
const _taus = { haze: 0, ground: 0 }, _gf = { D: 0, H: 0 }, _scr = {};

// the direction a front comes from, as the radio says it (nx, nz: the way it moves)
function compass(nx, nz, from = false) {
    let a = Math.atan2(nx, -nz) * 180 / Math.PI;
    if (from) a += 180;
    const names = ['NORTH', 'NORTH-EAST', 'EAST', 'SOUTH-EAST', 'SOUTH', 'SOUTH-WEST', 'WEST', 'NORTH-WEST'];
    return names[Math.round((((a % 360) + 360) % 360) / 45) % 8];
}
