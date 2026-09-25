// ═══════════════════════════════════════════════════════════════
// Procedural audio (WebAudio). No sound files required.
//
//   master (volume) → compressor → speakers
//     ├─ world bus → "canopy" lowpass (muffled in the cockpit) → master
//     │    engine (per class: jet / turbofan / turboprop / piston, prop blade-pass buzz,
//     │    afterburner light-off thump), wind & buffet, fly-by voices for nearby aircraft and
//     │    airliners (Doppler, panned), helicopter rotor thump, sonic booms, guns, explosions
//     ├─ inner bus: sounds inside the airframe (gear, flaps, airbrake hydraulics) — not muffled
//     └─ ui bus: warning tones, radio static and clicks, menu ticks (never muffled)
//
// Every one-shot disconnects itself when it ends, heavy one-shots are voice-limited,
// and nothing is scheduled while the context is suspended (or the tab is hidden).
// ═══════════════════════════════════════════════════════════════
import { clamp } from './util.js';
import { AIRCRAFT } from './config.js';

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
        this.boomWatch = new WeakMap(); // supersonic aircraft → closing/opening state for sonic booms
        this.last = {};        // previous gear / flaps / airbrake / afterburner states
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
        this.inner = ctx.createGain(); this.inner.gain.value = 0.8; this.inner.connect(this.master);

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
        this.buildHeli();
        this.buildTones();
        this.buildRadio();
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
        // propeller blade-pass buzz (piston and turboprop)
        this.propBuzz = ctx.createOscillator(); this.propBuzz.type = 'sawtooth'; this.propBuzz.frequency.value = 80;
        this.propF = ctx.createBiquadFilter(); this.propF.type = 'bandpass'; this.propF.frequency.value = 240; this.propF.Q.value = 1.4;
        this.propG = ctx.createGain(); this.propG.gain.value = 0;
        this.propBuzz.connect(this.propF).connect(this.propG).connect(this.engine);
        this.propBuzz.start();
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

    // One voice for the nearest helicopter: the rotor's blade-slap thump over a turbine hiss
    buildHeli() {
        const ctx = this.ctx;
        const out = ctx.createGain(); out.gain.value = 0;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 3000;
        const src = this.noiseSrc(this.pink); src.start(0, Math.random() * 1.9);
        const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 500;
        const slap = ctx.createGain(); slap.gain.value = 0.15;
        const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 17;
        const depth = ctx.createGain(); depth.gain.value = 0.85;
        lfo.connect(depth).connect(slap.gain); lfo.start();
        src.connect(lf).connect(slap).connect(air);
        const tur = this.noiseSrc(this.white); tur.start(0, Math.random() * 1.9);
        const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 3200; tf.Q.value = 2;
        const tg = ctx.createGain(); tg.gain.value = 0.05;
        tur.connect(tf).connect(tg).connect(air);
        if (pan) air.connect(pan).connect(out); else air.connect(out);
        out.connect(this.world);
        this.heli = { out, pan, air, src, lfo };
    }

    // Radio static that runs under a spoken callout (speech synthesis can't be filtered, so this is
    // what makes it sound like it's coming over the radio)
    buildRadio() {
        const ctx = this.ctx;
        const src = this.noiseSrc(this.white); src.start(0, Math.random() * 1.9);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9;
        this.radioG = ctx.createGain(); this.radioG.gain.value = 0;
        src.connect(f).connect(this.radioG).connect(this.ui);
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
            if (this.heli) set(this.heli.out.gain, 0, 0.3);
            this.last = {};
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
        // lighting the burner: a deep "whump" (the reheat igniting) before the roar settles
        if (ab && this.last.ab === 0) this.abThump(inside);
        set(this.crackG.gain, ab * 0.22 * (inside ? 0.5 : 1), 0.15);
        // piston: firing frequency follows RPM; turboprops get the prop's beat too
        const rpm = running ? 900 + th * 1800 : 0;
        const fire = rpm / 60 * 2; // 4-stroke flat engine: ~2 pulses per revolution
        set(this.piston.frequency, Math.max(15, fire));
        set(this.chugLfo.frequency, Math.max(4, fire / 2));
        set(this.pistonF.frequency, 300 + th * 700);
        set(this.pistonG.gain, piston && running ? 0.25 + th * 0.35 : tprop && running ? 0.08 + th * 0.06 : 0);
        // the propeller's blade-pass buzz: RPM × blades (turboprops hold a constant prop speed)
        const blades = /racer/i.test(p.spec.name || '') ? 4 : 2;
        const bpf = piston ? rpm / 60 * blades : 1020 / 60 * 6 * (0.95 + th * 0.05);
        set(this.propBuzz.frequency, Math.max(20, bpf));
        set(this.propF.frequency, Math.max(80, bpf * 3));
        set(this.propG.gain, running && (piston || tprop) ? (piston ? 0.1 + th * 0.14 : 0.1 + th * 0.05) : 0);
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
        this.updateHeli(p, t);
        // hydraulics and mechanisms (heard inside the airframe, so not through the canopy filter)
        const L = this.last;
        if (L.gear != null && p.gear !== L.gear && !p.fixedGear) this.hydraulic(2.2, p.gear ? 1 : -1, true);
        const flaps = Math.round((p.flaps || 0) * 4);
        if (L.flaps != null && flaps !== L.flaps) this.hydraulic(0.9, flaps > L.flaps ? 1 : -1, false);
        if (L.airbrake != null && !!p.airbrake !== L.airbrake) this.hydraulic(0.7, p.airbrake ? 1 : -1, false, 0.7);
        L.gear = p.gear; L.flaps = flaps; L.airbrake = !!p.airbrake; L.ab = ab;
    }

    updateHeli(p, t) {
        const h = this.heli, g = p.game;
        const helis = g && g.world && g.world.airbases && g.world.airbases.helis;
        const cam = g && g.camera;
        if (!h || !helis || !cam) return;
        let best = null, bd = 1600;
        for (const c of helis) { if (!c.alive) continue; const d = c.pos.distanceTo(cam.position); if (d < bd) { bd = d; best = c; } }
        if (!best) { h.out.gain.setTargetAtTime(0, t, 0.3); return; }
        const lp = cam.position, d = Math.max(1, bd);
        const dx = best.pos.x - lp.x, dy = best.pos.y - lp.y, dz = best.pos.z - lp.z;
        const vs = (best.vel.x * dx + best.vel.y * dy + best.vel.z * dz) / d, vl = (p.vel.x * dx + p.vel.y * dy + p.vel.z * dz) / d;
        const dop = clamp((SOUND + vl) / (SOUND + vs), 0.6, 1.6);
        h.lfo.frequency.setTargetAtTime((best.name && /HAWK/.test(best.name) ? 17.2 : 13.5) * dop, t, 0.1);
        h.air.frequency.setTargetAtTime(250 + 7000 * Math.exp(-d / 600), t, 0.1);
        h.out.gain.setTargetAtTime(clamp(1.6 / (1 + d / 90), 0, 0.9), t, 0.1);
        if (h.pan) {
            const e = cam.matrixWorldInverse.elements;
            const cx = e[0] * best.pos.x + e[4] * best.pos.y + e[8] * best.pos.z + e[12];
            h.pan.pan.setTargetAtTime(clamp(cx / (d * 0.8), -0.9, 0.9), t, 0.05);
        }
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
        // a rotary cannon's burst ends in a rolling roar (the rounds' reports arriving from downrange)
        if (this.gunProf && this.gunProf.rotary) {
            const ctx = this.ctx;
            const r = this.noiseSrc(this.brown);
            const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = this.gunProf.band * 0.6;
            const rg = ctx.createGain(); rg.gain.setValueAtTime(0.35 * this.gunSpin, t); rg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
            r.connect(rf).connect(rg).connect(this.sfx); r.start(t, Math.random()); r.stop(t + 0.5);
            this.cleanup(r, rf, rg);
        }
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
            if (a.mach > 1 && d < 3000) this.checkBoom(a, lp, lv, d, t);
        }
        // civil and military traffic around the airports
        const fl = g.world && g.world.airTraffic && g.world.airTraffic.flights;
        if (fl) for (const f of fl) {
            if (!f.alive || !f.mesh || !f.mesh.visible || !f.pos) continue;
            const d = f.pos.distanceTo(lp);
            if (d < 2500) {
                if (!f.spec) f.spec = AIRCRAFT[f.type];
                if (f.spec) cand.push({ a: f, d });
            }
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
        // a big bass punch in the chest when it's close
        if (dist < 450) {
            const sb = ctx.createOscillator(); sb.type = 'sine';
            sb.frequency.setValueAtTime(48, t); sb.frequency.exponentialRampToValueAtTime(24, t + 1.1);
            const sg = ctx.createGain(); sg.gain.setValueAtTime(0, t0); sg.gain.setValueAtTime(vol * near * 0.9, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
            sb.connect(sg).connect(this.sfx); sb.start(t); sb.stop(t + 1.25);
            this.cleanup(sb, sg);
        }
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

    abThump(inside) {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.35);
        const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(inside ? 0.45 : 0.7, t + 0.02); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.5);
        this.cleanup(o, og);
        const n = this.noiseSrc(this.brown);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(150, t + 0.4);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        n.connect(f).connect(g).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.55);
        this.cleanup(n, f, g);
    }

    // hydraulic actuator: a motor whine rising (extending) or falling (retracting), ending in a clunk
    hydraulic(dur, dir, clunk, vol = 1) {
        if (!this.running) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const f0 = dir > 0 ? 190 : 260, f1 = dir > 0 ? 270 : 180;
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * vol, t + 0.15);
        g.gain.setValueAtTime(0.05 * vol, t + dur - 0.15); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(f).connect(g).connect(this.inner); o.start(t); o.stop(t + dur + 0.05);
        this.cleanup(o, f, g);
        const h = this.noiseSrc(this.white);
        const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 2400; hf.Q.value = 1.2;
        const hg = ctx.createGain(); hg.gain.setValueAtTime(0, t); hg.gain.linearRampToValueAtTime(0.02 * vol, t + 0.1); hg.gain.setValueAtTime(0.02 * vol, t + dur - 0.1); hg.gain.linearRampToValueAtTime(0, t + dur);
        h.connect(hf).connect(hg).connect(this.inner); h.start(t, Math.random()); h.stop(t + dur + 0.05);
        this.cleanup(h, hf, hg);
        if (clunk) {
            // the gear locking up / down
            const c = this.noiseSrc(this.brown);
            const cf = ctx.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 400;
            const cg = ctx.createGain(); cg.gain.setValueAtTime(0, t); cg.gain.setValueAtTime(0.8, t + dur); cg.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.25);
            c.connect(cf).connect(cg).connect(this.inner); c.start(t, Math.random()); c.stop(t + dur + 0.3);
            this.cleanup(c, cf, cg);
        }
    }

    // A supersonic aircraft's shock cone sweeps over us just after it passes: the double crack of
    // the N-wave, heard when the sound gets here
    checkBoom(a, lp, lv, d, t) {
        const dx = a.pos.x - lp.x, dy = a.pos.y - lp.y, dz = a.pos.z - lp.z;
        const closing = (a.vel.x - lv.x) * dx + (a.vel.y - lv.y) * dy + (a.vel.z - lv.z) * dz < 0;
        const w = this.boomWatch.get(a);
        if (w && w.closing && !closing && t - w.last > 5) {
            w.last = t;
            this.sonicBoom(d, clamp(a.mach - 1, 0, 1));
        }
        if (w) w.closing = closing; else this.boomWatch.set(a, { closing, last: -99 });
    }

    sonicBoom(dist, strength = 0.5) {
        if (!this.running) return;
        const ctx = this.ctx, t0 = ctx.currentTime, t = t0 + Math.min(dist / SOUND * 0.6, 3);
        const vol = clamp(1.3 / (1 + dist / 800), 0.1, 1) * (0.7 + strength * 0.5);
        for (const [dt, k] of [[0, 1], [0.11, 0.85]]) {
            const c = this.noiseSrc(this.white);
            const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200 * Math.exp(-dist / 3000) + 300;
            const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.setValueAtTime(vol * k, t + dt); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.09);
            c.connect(f).connect(g).connect(this.sfx); c.start(t + dt, Math.random()); c.stop(t + dt + 0.12);
            this.cleanup(c, f, g);
        }
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
        const og = ctx.createGain(); og.gain.setValueAtTime(0, t0); og.gain.setValueAtTime(vol * 0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.75);
        this.cleanup(o, og);
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
            if (this.volume > 0 && this.running) {
                // keyed mic: click, static under the voice (off at the estimated end if onend never comes), click
                this.radioClick(0.1 * this.volume + 0.04);
                const t = this.ctx.currentTime, est = 0.6 + text.length * 0.065 / u.rate;
                this.radioG.gain.cancelScheduledValues(t);
                this.radioG.gain.setTargetAtTime(0.022, t, 0.02);
                this.radioG.gain.setTargetAtTime(0, t + est, 0.05);
                u.onend = () => {
                    if (!this.ctx) return;
                    const t2 = this.ctx.currentTime;
                    this.radioG.gain.cancelScheduledValues(t2);
                    this.radioG.gain.setTargetAtTime(0, t2, 0.03);
                    this.radioClick(0.08 * this.volume + 0.03);
                };
            }
            speechSynthesis.speak(u);
        } catch (e) { /* ignore */ }
    }

    setVolume(v) {
        this.volume = v;
        if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    }
}
