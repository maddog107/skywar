// ═══════════════════════════════════════════════════════════════
// Procedural audio (WebAudio). No sound files required.
//
//   master (volume) → compressor → speakers
//     ├─ world bus → "canopy" lowpass (muffled in the cockpit) → master
//     │    engine (per class: jet / turbofan / turboprop / piston), wind & buffet,
//     │    fly-by voices for nearby aircraft (Doppler, panned), guns, one-shots
//     └─ ui bus: warning tones, radio clicks, menu ticks (never muffled)
//
// Every one-shot disconnects itself when it ends, heavy one-shots are voice-limited,
// and nothing is scheduled while the context is suspended (or the tab is hidden).
// ═══════════════════════════════════════════════════════════════
import { clamp } from './util.js';

// real rates of fire (rounds/s) and character for the guns in config.js
function gunProfile(gun) {
    const n = (gun && gun.name) || '';
    if (/M61/.test(n)) return { rotary: true, rps: 100, band: 1100, thump: 70 };
    if (/GAU-8/.test(n)) return { rotary: true, rps: 65, band: 700, thump: 50 };
    if (/GAU-22/.test(n)) return { rotary: true, rps: 55, band: 900, thump: 60 };
    if (/GSh-30/.test(n)) return { rps: 30, band: 650, thump: 55 };
    if (/BK-27/.test(n)) return { rps: 28, band: 800, thump: 60 };
    if (/GIAT/.test(n)) return { rps: 40, band: 750, thump: 58 };
    if (/GSh-23|Type 23/.test(n)) return { rps: 55, band: 1200, thump: 75 };
    if (/M39/.test(n)) return { rps: 50, band: 1300, thump: 80 };
    if (/DEFA|ADEN/.test(n)) return { rps: 42, band: 800, thump: 60 };
    return { rps: gun ? Math.max(20, gun.rate * 2.5) : 30, band: 1000, thump: 65 };
}

function engineKind(spec) {
    if (spec.prop || (spec.proc && spec.proc.prop)) return 'piston';
    if (spec.proc && spec.proc.turboprop) return 'turboprop';
    if (spec.category === 'civil' || spec.category === 'bomber') return 'turbofan';
    return 'jet';
}

const SOUND = 343;

export class Audio {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.volume = 0.7;
        this.callouts = true;
        this.lastSpeak = 0;
        this.tones = {};
        this.boomEnds = [];    // end times of the heavy one-shots still playing (voice limit)
        this.voices = [];      // fly-by voices
    }

    init() {
        if (this.ctx) { if (!document.hidden) this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 6; comp.knee.value = 8; comp.attack.value = 0.002; comp.release.value = 0.25;
        this.master.connect(comp).connect(ctx.destination);
        // the world is heard through the canopy when in the cockpit
        this.cabin = ctx.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 18000; this.cabin.Q.value = 0.5;
        this.world = ctx.createGain();
        this.world.connect(this.cabin).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.world);
        this.ui = ctx.createGain(); this.ui.gain.value = 0.5; this.ui.connect(this.master);

        // noise buffers
        const len = ctx.sampleRate * 2;
        this.white = ctx.createBuffer(1, len, ctx.sampleRate);
        this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
        this.pink = ctx.createBuffer(1, len, ctx.sampleRate);
        const w = this.white.getChannelData(0), b = this.brown.getChannelData(0), pk = this.pink.getChannelData(0);
        let last = 0, b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const r = Math.random() * 2 - 1;
            w[i] = r;
            last = (last + 0.02 * r) / 1.02;
            b[i] = last * 3.5;
            b0 = 0.99765 * b0 + r * 0.099; b1 = 0.963 * b1 + r * 0.2965; b2 = 0.57 * b2 + r * 1.0526;
            pk[i] = (b0 + b1 + b2 + r * 0.1848) * 0.2;
        }
        this.buildEngine();
        this.buildGun();
        this.buildFlyby();
        this.buildTones();
        // a hidden tab shouldn't keep droning (and must not queue up sounds to dump on return)
        document.addEventListener('visibilitychange', () => {
            if (!this.ctx) return;
            if (document.hidden) this.ctx.suspend();
            else this.ctx.resume();
        });
    }

    get running() { return !!this.ctx && this.ctx.state === 'running'; }

    // (one-shots loop too, started at a random offset and stopped explicitly: the 2 s buffers would
    // otherwise run out under a long tail)
    noiseSrc(buf = this.white, loop = true) {
        const s = this.ctx.createBufferSource();
        s.buffer = buf; s.loop = loop;
        if (loop) s.loopStart = 0;
        return s;
    }

    // start a looping noise at a random offset (so layers don't phase against each other)
    loop(buf) { const s = this.noiseSrc(buf); s.start(0, Math.random() * 1.9); return s; }

    // disconnect a one-shot's nodes once its source ends
    cleanup(src, ...nodes) {
        src.onended = () => { src.disconnect(); nodes.forEach(n => n.disconnect()); };
    }

    buildEngine() {
        const ctx = this.ctx;
        this.engine = ctx.createGain(); this.engine.gain.value = 0;
        this.engine.connect(this.world);
        // low turbine / exhaust rumble
        this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 300;
        this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0.6;
        this.loop(this.brown).connect(this.rumbleF).connect(this.rumbleG).connect(this.engine);
        // jet roar (band-passed noise)
        this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'bandpass'; this.roarF.frequency.value = 800; this.roarF.Q.value = 0.6;
        this.roarG = ctx.createGain(); this.roarG.gain.value = 0.15;
        this.loop(this.pink).connect(this.roarF).connect(this.roarG).connect(this.engine);
        // turbine whine: fundamental + a harmonic through a resonant band
        this.whine = ctx.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 900;
        this.whine2 = ctx.createOscillator(); this.whine2.type = 'sine'; this.whine2.frequency.value = 1800;
        this.whineF = ctx.createBiquadFilter(); this.whineF.type = 'bandpass'; this.whineF.frequency.value = 2000; this.whineF.Q.value = 6;
        this.whineG = ctx.createGain(); this.whineG.gain.value = 0.02;
        const w2g = ctx.createGain(); w2g.gain.value = 0.4;
        this.whine.connect(this.whineF); this.whine2.connect(w2g).connect(this.whineF);
        this.whineF.connect(this.whineG).connect(this.engine);
        this.whine.start(); this.whine2.start();
        // afterburner: deep roar with a crackle (noise amplitude-modulated by slow noise)
        this.abF = ctx.createBiquadFilter(); this.abF.type = 'lowpass'; this.abF.frequency.value = 220;
        this.abG = ctx.createGain(); this.abG.gain.value = 0;
        this.loop(this.brown).connect(this.abF).connect(this.abG).connect(this.engine);
        this.crackF = ctx.createBiquadFilter(); this.crackF.type = 'bandpass'; this.crackF.frequency.value = 600; this.crackF.Q.value = 0.8;
        this.crackG = ctx.createGain(); this.crackG.gain.value = 0;
        const crackAM = ctx.createGain(); crackAM.gain.value = 0;
        const amSrc = this.loop(this.brown); const amF = ctx.createBiquadFilter(); amF.type = 'lowpass'; amF.frequency.value = 30;
        const amK = ctx.createGain(); amK.gain.value = 1.4;
        amSrc.connect(amF).connect(amK).connect(crackAM.gain);
        this.loop(this.white).connect(this.crackF).connect(crackAM).connect(this.crackG).connect(this.engine);
        // piston / propeller: a pulsed sawtooth at the firing frequency, and the prop's buzz
        this.piston = ctx.createOscillator(); this.piston.type = 'sawtooth'; this.piston.frequency.value = 40;
        this.pistonF = ctx.createBiquadFilter(); this.pistonF.type = 'lowpass'; this.pistonF.frequency.value = 500; this.pistonF.Q.value = 2;
        this.pistonG = ctx.createGain(); this.pistonG.gain.value = 0;
        const chug = ctx.createGain(); chug.gain.value = 0.6;
        this.chugLfo = ctx.createOscillator(); this.chugLfo.type = 'square'; this.chugLfo.frequency.value = 20;
        const chugDepth = ctx.createGain(); chugDepth.gain.value = 0.4;
        this.chugLfo.connect(chugDepth).connect(chug.gain);
        this.piston.connect(this.pistonF).connect(chug).connect(this.pistonG).connect(this.engine);
        this.piston.start(); this.chugLfo.start();
        // wind over the canopy, and airframe buffet at high AoA / G
        this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 900; this.windF.Q.value = 0.5;
        this.windG = ctx.createGain(); this.windG.gain.value = 0;
        this.loop(this.pink).connect(this.windF).connect(this.windG).connect(this.world);
        this.buffetF = ctx.createBiquadFilter(); this.buffetF.type = 'lowpass'; this.buffetF.frequency.value = 90;
        this.buffetG = ctx.createGain(); this.buffetG.gain.value = 0;
        this.loop(this.brown).connect(this.buffetF).connect(this.buffetG).connect(this.world);
        // metal-on-concrete scrape for belly landings
        this.scrapeF = ctx.createBiquadFilter(); this.scrapeF.type = 'bandpass'; this.scrapeF.frequency.value = 2600; this.scrapeF.Q.value = 1.5;
        this.scrapeG = ctx.createGain(); this.scrapeG.gain.value = 0;
        this.loop(this.white).connect(this.scrapeF).connect(this.scrapeG).connect(this.sfx);
        this.engineType = null;
    }

    // The player's gun: rotary cannons are a continuous "brrrt" tone at the real rate of fire,
    // revolver / single-barrel guns are individual scheduled rounds (no node churn: envelopes only)
    buildGun() {
        const ctx = this.ctx;
        this.gunG = ctx.createGain(); this.gunG.gain.value = 0.6;
        this.gunG.connect(this.sfx);
        this.gunF = ctx.createBiquadFilter(); this.gunF.type = 'bandpass'; this.gunF.frequency.value = 900; this.gunF.Q.value = 0.9;
        this.gunEnv = ctx.createGain(); this.gunEnv.gain.value = 0;
        this.loop(this.white).connect(this.gunF).connect(this.gunEnv).connect(this.gunG);
        this.thump = ctx.createOscillator(); this.thump.type = 'sine'; this.thump.frequency.value = 60;
        this.thumpEnv = ctx.createGain(); this.thumpEnv.gain.value = 0;
        this.thump.connect(this.thumpEnv).connect(this.gunG);
        this.thump.start();
        this.gunTone = ctx.createOscillator(); this.gunTone.type = 'sawtooth'; this.gunTone.frequency.value = 100;
        this.gunToneF = ctx.createBiquadFilter(); this.gunToneF.type = 'lowpass'; this.gunToneF.frequency.value = 900;
        this.gunToneG = ctx.createGain(); this.gunToneG.gain.value = 0;
        this.gunTone.connect(this.gunToneF).connect(this.gunToneG).connect(this.gunG);
        this.gunTone.start();
        this.gunOn = false; this.nextShot = 0; this.gunSpin = 0;
    }

    // Pooled voices for nearby aircraft: turbine whine + roar, Doppler-shifted and panned
    buildFlyby() {
        const ctx = this.ctx;
        for (let i = 0; i < 3; i++) {
            const out = ctx.createGain(); out.gain.value = 0;
            const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
            const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 4000;
            const src = this.noiseSrc(this.pink); src.start(0, Math.random() * 1.9);
            const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.7;
            const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 1500;
            const oscF = ctx.createBiquadFilter(); oscF.type = 'bandpass'; oscF.frequency.value = 3000; oscF.Q.value = 5;
            const oscG = ctx.createGain(); oscG.gain.value = 0.06;
            const rum = this.noiseSrc(this.brown); rum.start(0, Math.random() * 1.9);
            const rumF = ctx.createBiquadFilter(); rumF.type = 'lowpass'; rumF.frequency.value = 160;
            const rumG = ctx.createGain(); rumG.gain.value = 0.8;
            src.connect(bp).connect(air);
            osc.connect(oscF).connect(oscG).connect(air);
            rum.connect(rumF).connect(rumG).connect(air);
            osc.start();
            if (pan) air.connect(pan).connect(out); else air.connect(out);
            out.connect(this.world);
            this.voices.push({ out, pan, air, src, bp, osc, oscF, rum, target: null, last: 0 });
        }
    }

    buildTones() {
        const ctx = this.ctx;
        const mk = (type, freq, lp = 3000) => {
            const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
            const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
            const g = ctx.createGain(); g.gain.value = 0;
            o.connect(f).connect(g).connect(this.ui);
            o.start();
            return { o, g };
        };
        // IR seeker growl: low tone frequency-modulated
        this.tones.seek = mk('square', 420, 1800);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 18;
        const lfoG = ctx.createGain(); lfoG.gain.value = 120;
        lfo.connect(lfoG).connect(this.tones.seek.o.frequency); lfo.start();
        this.tones.lock = mk('sine', 1650);
        this.tones.rwr = mk('square', 1000, 2500);
        this.tones.warn = mk('square', 700, 2000);
    }

    // ── Continuous state ──
    update(dt, p, state) {
        if (!this.running) return; // suspended: automation events would just pile up
        const t = this.ctx.currentTime;
        const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
        if (!p || !p.alive || !state.playing) {
            set(this.engine.gain, 0, 0.3); set(this.windG.gain, 0, 0.3); set(this.buffetG.gain, 0, 0.1); set(this.scrapeG.gain, 0, 0.1);
            this.gunStop(t);
            for (const k in this.tones) set(this.tones[k].g.gain, 0, 0.03);
            for (const v of this.voices) { set(v.out.gain, 0, 0.2); v.target = null; }
            return;
        }
        const inside = !!state.cockpit;
        set(this.cabin.frequency, inside ? 2400 : 18000, 0.15);
        const th = p.throttle, sp = clamp(p.speed / 400, 0, 1.3);
        const kind = engineKind(p.spec);
        const running = !p.flameout;
        const spool = running ? th : 0;
        // engine loudness: quieter from inside, louder from behind the jet in the chase view
        set(this.engine.gain, (0.22 + spool * 0.38) * (inside ? 0.6 : 1) * (running ? 1 : 0.25));
        const jet = kind === 'jet', fan = kind === 'turbofan', tprop = kind === 'turboprop', piston = kind === 'piston';
        set(this.rumbleF.frequency, piston ? 120 + spool * 200 : 160 + spool * 360);
        set(this.rumbleG.gain, piston ? 0.35 : 0.55 + spool * 0.2);
        set(this.roarF.frequency, jet ? 450 + spool * 1500 : fan ? 700 + spool * 900 : 350 + spool * 500);
        set(this.roarG.gain, jet ? 0.08 + spool * 0.24 : fan ? 0.06 + spool * 0.14 : tprop ? 0.05 + spool * 0.08 : 0.03);
        // turbine whine rises with N2; high-bypass fans add a buzz-saw, piston engines have none
        const n2 = running ? 0.55 + th * 0.45 : Math.max(0.05, 0.3 - p.speed / 1200);
        const wf = jet ? 1100 + n2 * 1900 : fan ? 700 + n2 * 1600 : tprop ? 900 + n2 * 700 : 200;
        set(this.whine.frequency, wf, 0.25); set(this.whine2.frequency, wf * 2.01, 0.25);
        set(this.whineF.frequency, wf * 1.4, 0.25);
        set(this.whineG.gain, piston ? 0 : (jet ? 0.012 + n2 * 0.025 : fan ? 0.02 + n2 * 0.04 : 0.025 + n2 * 0.03) * (inside ? 1.4 : 1));
        const ab = p.afterburner && running ? 1 : 0;
        set(this.abG.gain, ab * 1.1, 0.2);
        set(this.crackG.gain, ab * 0.22 * (inside ? 0.5 : 1), 0.15);
        // piston: firing frequency follows RPM; turboprops get the prop's beat too
        const rpm = running ? 900 + th * 1800 : 0;
        const fire = rpm / 60 * 2; // 4-stroke flat engine: ~2 pulses per revolution
        set(this.piston.frequency, Math.max(15, fire));
        set(this.chugLfo.frequency, Math.max(4, fire / 2));
        set(this.pistonF.frequency, 300 + th * 700);
        set(this.pistonG.gain, piston && running ? 0.25 + th * 0.35 : tprop && running ? 0.08 + th * 0.06 : 0);
        // wind: rises with dynamic pressure, brighter with speed; an open airbrake roars
        set(this.windG.gain, sp * sp * 0.16 * (inside ? 0.7 : 1) + (p.airbrake ? 0.08 : 0));
        set(this.windF.frequency, 400 + sp * 1600);
        const buffet = clamp((p.alpha / Math.max(p.alphaMax || 0.3, 0.1) - 0.7) * 3, 0, 1) + clamp((p.gLoad - 6) / 4, 0, 1) * 0.5;
        set(this.buffetG.gain, buffet * sp * 0.9, 0.05);
        this.updateGun(t, p, state, dt);
        set(this.scrapeG.gain, (state.scrape || 0) * 0.35 * (0.7 + Math.random() * 0.6), 0.03);
        set(this.scrapeF.frequency, 1200 + (state.scrape || 0) * 2400);
        // tones
        set(this.tones.seek.g.gain, state.seeking ? 0.05 : 0, 0.02);
        set(this.tones.lock.g.gain, state.locked ? 0.06 : 0, 0.02);
        // RWR: slow pulses when painted, a fast high warble with a missile in the air
        const beep = (t * (state.missileIncoming ? 8 : 3)) % 1 < 0.5;
        set(this.tones.rwr.g.gain, (state.missileIncoming || state.spiked) && beep ? (state.missileIncoming ? 0.06 : 0.025) : 0, 0.005);
        set(this.tones.rwr.o.frequency, state.missileIncoming ? ((t * 8) % 2 < 1 ? 1250 : 1650) : 900, 0.005);
        const warnBeep = (t * 4) % 1 < 0.4;
        set(this.tones.warn.g.gain, (state.pullUp || state.stall) && warnBeep ? 0.04 : 0, 0.005);
        this.updateFlyby(dt, p, t);
    }

    updateGun(t, p, state, dt) {
        const firing = state.firing && p.ammo > 0 && p.spec.gun;
        if (!firing) { this.gunStop(t); this.gunSpin = Math.max(0, this.gunSpin - dt * 3); return; }
        const prof = this.gunProf && this.gunProf.gun === p.spec.gun ? this.gunProf : (this.gunProf = { ...gunProfile(p.spec.gun), gun: p.spec.gun });
        this.gunF.frequency.setTargetAtTime(prof.band, t, 0.02);
        if (prof.rotary) {
            // spin-up: the barrels take a moment to reach full rate
            this.gunSpin = Math.min(1, this.gunSpin + dt * 4);
            const rps = prof.rps * (0.55 + 0.45 * this.gunSpin);
            this.gunTone.frequency.setTargetAtTime(rps, t, 0.03);
            this.gunToneF.frequency.setTargetAtTime(rps * 9, t, 0.05);
            this.gunToneG.gain.setTargetAtTime(0.32, t, 0.015);
            this.gunEnv.gain.setTargetAtTime(0.45, t, 0.015);
            this.thump.frequency.setTargetAtTime(prof.thump, t, 0.05);
            this.thumpEnv.gain.setTargetAtTime(0.35, t, 0.02);
            this.gunOn = true;
            return;
        }
        if (!this.gunOn) { this.gunOn = true; this.nextShot = t + 0.005; }
        // schedule the next ~80 ms of rounds
        const gap = 1 / prof.rps;
        while (this.nextShot < t + 0.08) {
            const ts = Math.max(this.nextShot, t);
            this.gunEnv.gain.setValueAtTime(1, ts);
            this.gunEnv.gain.setTargetAtTime(0, ts + 0.003, 0.02);
            this.thumpEnv.gain.setValueAtTime(0.9, ts);
            this.thumpEnv.gain.setTargetAtTime(0, ts + 0.004, 0.035);
            this.thump.frequency.setValueAtTime(prof.thump * 1.8, ts);
            this.thump.frequency.exponentialRampToValueAtTime(prof.thump, ts + 0.04);
            this.nextShot = ts + gap * (0.94 + Math.random() * 0.12);
        }
    }

    gunStop(t) {
        if (!this.gunOn) return;
        this.gunOn = false;
        for (const g of [this.gunEnv.gain, this.thumpEnv.gain, this.gunToneG.gain]) {
            g.cancelScheduledValues(t);
            g.setTargetAtTime(0, t, 0.03);
        }
        this.thump.frequency.cancelScheduledValues(t);
    }

    // Nearby aircraft: the three closest get a voice. Pitch follows the Doppler shift of their
    // approach speed, air absorption dulls them with distance, the panner puts them left/right.
    updateFlyby(dt, p, t) {
        const g = p.game;
        const cam = g && g.camera;
        if (!g || !cam || !g.aircraft) return;
        const lp = cam.position;
        const lv = p.vel;
        const cand = [];
        for (const a of g.aircraft) {
            if (a === p || !a.alive || a.exploded) continue;
            const d = a.pos.distanceTo(lp);
            if (d < 2500) cand.push({ a, d });
        }
        cand.sort((x, y) => x.d - y.d);
        const want = cand.slice(0, 3).map(c => c.a);
        // keep voices on the aircraft they already follow; hand free voices to new ones
        for (const v of this.voices) if (v.target && !want.includes(v.target)) v.target = null;
        for (const a of want) {
            if (this.voices.some(v => v.target === a)) continue;
            const free = this.voices.find(v => !v.target);
            if (free) free.target = a;
        }
        const camInv = cam.matrixWorldInverse;
        for (const v of this.voices) {
            const a = v.target;
            if (!a) { v.out.gain.setTargetAtTime(0, t, 0.25); continue; }
            const dx = a.pos.x - lp.x, dy = a.pos.y - lp.y, dz = a.pos.z - lp.z;
            const d = Math.max(1, Math.hypot(dx, dy, dz));
            // radial speeds (positive = moving apart)
            const vs = (a.vel.x * dx + a.vel.y * dy + a.vel.z * dz) / d;
            const vl = (lv.x * dx + lv.y * dy + lv.z * dz) / d;
            const dop = clamp((SOUND + vl) / (SOUND + vs), 0.45, 2.2);
            const th = a.throttle ?? 0.7, ab = a.afterburner ? 1 : 0;
            const kind = engineKind(a.spec);
            const base = kind === 'piston' ? 90 : kind === 'jet' ? 1300 + th * 1100 : 900 + th * 800;
            v.osc.frequency.setTargetAtTime(base * dop, t, 0.05);
            v.oscF.frequency.setTargetAtTime(base * dop * 1.5, t, 0.05);
            v.bp.frequency.setTargetAtTime((kind === 'piston' ? 300 : 650 + th * 700) * dop, t, 0.05);
            if (v.src.playbackRate) v.src.playbackRate.setTargetAtTime(clamp(dop, 0.6, 1.6), t, 0.05);
            v.air.frequency.setTargetAtTime(300 + 9000 * Math.exp(-d / 900), t, 0.1);
            const loud = (0.3 + th * 0.5 + ab * 0.6) * Math.pow(1 / (1 + d / 120), 1.3) * 2.2;
            v.out.gain.setTargetAtTime(clamp(loud, 0, 0.8), t, 0.08);
            if (v.pan) {
                // x of the source in camera space → left/right
                const cx = camInv.elements[0] * a.pos.x + camInv.elements[4] * a.pos.y + camInv.elements[8] * a.pos.z + camInv.elements[12];
                v.pan.pan.setTargetAtTime(clamp(cx / (d * 0.8), -0.9, 0.9), t, 0.05);
            }
        }
    }

    // ── One-shots ──
    // Explosion heard from `dist` metres: the sound arrives late, and far blasts lose their crack
    boom(dist = 0, size = 1) {
        if (!this.running) return;
        const ctx = this.ctx, t0 = ctx.currentTime;
        const vol = Math.min(1.1, clamp(1.4 / (1 + dist / 350), 0, 1.2) * Math.min(size, 2.5));
        if (vol < 0.02) return;
        this.boomEnds = this.boomEnds.filter(e => e > t0);
        if (this.boomEnds.length > 10 && vol < 0.4) return; // voice limit: drop the quiet ones in a big battle
        const delay = Math.min(dist / SOUND, 2.5);
        const t = t0 + delay;
        const near = Math.exp(-dist / 450);
        const cutoff = 220 + 6500 * Math.exp(-dist / 700);
        const len = 1.4 + Math.min(size, 3) * 0.6;
        this.boomEnds.push(t + len);
        // body: brown noise through a closing lowpass
        const src = this.noiseSrc(this.brown);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(70, t + len);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0); g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol * 0.8, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t + len);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(t, Math.random()); src.stop(t + len + 0.1);
        this.cleanup(src, f, g);
        // sub thump
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.55);
        const og = ctx.createGain(); og.gain.setValueAtTime(0, t0); og.gain.setValueAtTime(vol * 0.7, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.7);
        this.cleanup(o, og);
        // the crack of a close blast
        if (near > 0.08) {
            const c = this.noiseSrc(this.white);
            const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 900;
            const cg = ctx.createGain(); cg.gain.setValueAtTime(0, t0); cg.gain.setValueAtTime(vol * near * 0.5, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
            c.connect(hf).connect(cg).connect(this.sfx); c.start(t, Math.random()); c.stop(t + 0.12);
            this.cleanup(c, hf, cg);
        }
        // big blasts (and collapsing buildings) roll on in a long low rumble
        if (size >= 1.3) {
            const r = this.noiseSrc(this.brown);
            const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 140 + 200 * near;
            const rg = ctx.createGain(); const rv = vol * 0.4;
            rg.gain.setValueAtTime(0, t0); rg.gain.setValueAtTime(0, t + 0.1);
            rg.gain.linearRampToValueAtTime(rv, t + 0.5); rg.gain.setTargetAtTime(0, t + 0.9, 0.9);
            r.connect(rf).connect(rg).connect(this.sfx); r.start(t, Math.random()); r.stop(t + 4.5);
            this.cleanup(r, rf, rg);
        }
    }

    thunder(dist = 2000) {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const vol = clamp(2.2 / (1 + dist / 1500), 0.1, 1);
        const src = this.noiseSrc(this.brown);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(dist < 2500 ? 900 : 300, t); f.frequency.exponentialRampToValueAtTime(60, t + 4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + (dist < 2500 ? 0.05 : 0.4));
        g.gain.setValueAtTime(vol * 0.7, t + 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + 5);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(t); src.stop(t + 5.2);
        this.cleanup(src, f, g);
    }

    // Missile / rocket launch: the motor ignites with a bang and roars away
    whoosh(vol = 0.5) {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this.noiseSrc(this.white);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9;
        f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.25); f.frequency.exponentialRampToValueAtTime(500, t + 1.8);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.setTargetAtTime(vol * 0.5, t + 0.1, 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + 2);
        src.connect(f).connect(g).connect(this.sfx); src.start(t, Math.random()); src.stop(t + 2.1);
        this.cleanup(src, f, g);
        // motor rumble underneath
        const r = this.noiseSrc(this.brown);
        const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 400;
        const rg = ctx.createGain(); rg.gain.setValueAtTime(vol * 1.2, t); rg.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
        r.connect(rf).connect(rg).connect(this.sfx); r.start(t, Math.random()); r.stop(t + 1.4);
        this.cleanup(r, rf, rg);
    }

    tick(freq = 2400, vol = 0.12, dur = 0.03, at = 0) {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime + at;
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(this.ui); o.start(t); o.stop(t + dur + 0.02);
        this.cleanup(o, g);
    }

    thud(vol = 0.5) {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this.noiseSrc(this.brown);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        src.connect(f).connect(g).connect(this.sfx); src.start(t, Math.random()); src.stop(t + 0.3);
        this.cleanup(src, f, g);
        // metallic ping of the hit
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 700 + Math.random() * 500;
        const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.14);
        this.cleanup(o, og);
    }

    // a single rifle shot (the AK on foot)
    gunshot() {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this.noiseSrc(this.white);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        src.connect(f).connect(g).connect(this.sfx); src.start(t, Math.random()); src.stop(t + 0.16);
        this.cleanup(src, f, g);
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
        const og = ctx.createGain(); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.1);
        this.cleanup(o, og);
        // the report echoing off the ground
        const e = this.noiseSrc(this.brown);
        const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 700;
        const eg = ctx.createGain(); eg.gain.setValueAtTime(0, t); eg.gain.setValueAtTime(0.18, t + 0.09); eg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        e.connect(ef).connect(eg).connect(this.sfx); e.start(t, Math.random()); e.stop(t + 0.65);
        this.cleanup(e, ef, eg);
    }

    // flares popping out of the dispensers (scheduled on the audio clock, not timers)
    flares() {
        if (!this.running) return;
        for (let i = 0; i < 4; i++) this.tick(300 + Math.random() * 100, 0.2, 0.06, i * 0.06);
    }

    // radio squelch: a burst of band-limited static before and after a callout
    radioClick(vol = 0.12) {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this.noiseSrc(this.white);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 1.2;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        src.connect(f).connect(g).connect(this.ui); src.start(t, Math.random()); src.stop(t + 0.08);
        this.cleanup(src, f, g);
    }

    uiClick() { this.tick(1800, 0.08, 0.04); }
    uiConfirm() { this.tick(900, 0.1, 0.08); this.tick(1350, 0.1, 0.1, 0.08); }

    say(text, priority = false) {
        if (!this.callouts || !window.speechSynthesis) return;
        const now = performance.now();
        if (!priority && now - this.lastSpeak < 1800) return;
        this.lastSpeak = now;
        try {
            if (priority) speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.15; u.pitch = 0.85; u.volume = clamp(this.volume * 1.2, 0, 1);
            const voices = speechSynthesis.getVoices();
            const v = voices.find(v => /en-US/.test(v.lang) && /Alex|Daniel|Fred|Google US|Aaron/i.test(v.name)) || voices.find(v => /^en/.test(v.lang));
            if (v) u.voice = v;
            if (this.volume > 0) { this.radioClick(0.1 * this.volume + 0.04); u.onend = () => this.radioClick(0.08 * this.volume + 0.03); }
            speechSynthesis.speak(u);
        } catch (e) { /* ignore */ }
    }

    setVolume(v) {
        this.volume = v;
        if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    }
}
