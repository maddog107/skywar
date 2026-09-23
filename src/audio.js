// ═══════════════════════════════════════════════════════════════
// Procedural audio (WebAudio). No sound files required.
// ═══════════════════════════════════════════════════════════════
import { clamp } from './util.js';

export class Audio {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.volume = 0.7;
        this.callouts = true;
        this.lastSpeak = 0;
        this.tones = {};
    }

    init() {
        if (this.ctx) { this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        this.master.connect(comp).connect(ctx.destination);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master);
        this.ui = ctx.createGain(); this.ui.gain.value = 0.5; this.ui.connect(this.master);

        // noise buffers
        const len = ctx.sampleRate * 2;
        this.white = ctx.createBuffer(1, len, ctx.sampleRate);
        this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
        const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            const r = Math.random() * 2 - 1;
            w[i] = r;
            last = (last + 0.02 * r) / 1.02;
            b[i] = last * 3.5;
        }
        this.buildEngine();
        this.buildTones();
    }

    noiseSrc(buf = this.white, loop = true) {
        const s = this.ctx.createBufferSource();
        s.buffer = buf; s.loop = loop;
        return s;
    }

    buildEngine() {
        const ctx = this.ctx;
        this.engine = ctx.createGain(); this.engine.gain.value = 0;
        this.engine.connect(this.master);
        // turbine rumble
        const rumble = this.noiseSrc(this.brown);
        this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 300;
        this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0.6;
        rumble.connect(this.rumbleF).connect(this.rumbleG).connect(this.engine);
        rumble.start();
        // jet roar (band-passed white)
        const roar = this.noiseSrc(this.white);
        this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'bandpass'; this.roarF.frequency.value = 800; this.roarF.Q.value = 0.6;
        this.roarG = ctx.createGain(); this.roarG.gain.value = 0.15;
        roar.connect(this.roarF).connect(this.roarG).connect(this.engine);
        roar.start();
        // turbine whine
        this.whine = ctx.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 900;
        this.whineF = ctx.createBiquadFilter(); this.whineF.type = 'bandpass'; this.whineF.frequency.value = 2000; this.whineF.Q.value = 8;
        this.whineG = ctx.createGain(); this.whineG.gain.value = 0.02;
        this.whine.connect(this.whineF).connect(this.whineG).connect(this.engine);
        this.whine.start();
        // afterburner crackle
        const ab = this.noiseSrc(this.brown);
        this.abF = ctx.createBiquadFilter(); this.abF.type = 'lowpass'; this.abF.frequency.value = 160;
        this.abG = ctx.createGain(); this.abG.gain.value = 0;
        ab.connect(this.abF).connect(this.abG).connect(this.engine);
        ab.start();
        // wind
        const wind = this.noiseSrc(this.white);
        this.windF = ctx.createBiquadFilter(); this.windF.type = 'highpass'; this.windF.frequency.value = 900;
        this.windG = ctx.createGain(); this.windG.gain.value = 0;
        wind.connect(this.windF).connect(this.windG).connect(this.master);
        wind.start();
        // gun loop (buzz)
        this.gunOsc = ctx.createOscillator(); this.gunOsc.type = 'square'; this.gunOsc.frequency.value = 55;
        const gunNoise = this.noiseSrc(this.white);
        this.gunF = ctx.createBiquadFilter(); this.gunF.type = 'lowpass'; this.gunF.frequency.value = 1400;
        this.gunG = ctx.createGain(); this.gunG.gain.value = 0;
        const gunMod = ctx.createGain(); gunMod.gain.value = 0.5;
        this.gunOsc.connect(gunMod).connect(this.gunF);
        gunNoise.connect(this.gunF);
        this.gunF.connect(this.gunG).connect(this.sfx);
        this.gunOsc.start(); gunNoise.start();
    }

    buildTones() {
        const ctx = this.ctx;
        const mk = (type, freq) => {
            const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
            const g = ctx.createGain(); g.gain.value = 0;
            o.connect(g).connect(this.ui);
            o.start();
            return { o, g };
        };
        // IR seeker growl: low tone amplitude-modulated
        this.tones.seek = mk('square', 420);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 18;
        const lfoG = ctx.createGain(); lfoG.gain.value = 120;
        lfo.connect(lfoG).connect(this.tones.seek.o.frequency); lfo.start();
        this.tones.lock = mk('sine', 1650);
        this.tones.rwr = mk('square', 1000);
        this.tones.warn = mk('square', 700);
    }

    // ── Continuous state ──
    update(dt, p, state) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
        if (!p || !p.alive || !state.playing) {
            set(this.engine.gain, 0, 0.3); set(this.windG.gain, 0, 0.3); set(this.gunG.gain, 0, 0.05);
            for (const k in this.tones) set(this.tones[k].g.gain, 0, 0.03);
            return;
        }
        const th = p.throttle, sp = clamp(p.speed / 400, 0, 1.3);
        const inside = state.cockpit ? 0.55 : 1;
        set(this.engine.gain, (0.25 + th * 0.35) * inside);
        set(this.rumbleF.frequency, 180 + th * 380);
        set(this.roarF.frequency, 500 + th * 1400);
        set(this.roarG.gain, 0.08 + th * 0.2);
        set(this.whine.frequency, 700 + th * 1500);
        set(this.whineG.gain, 0.01 + th * 0.03);
        set(this.abG.gain, p.afterburner ? 1.1 : 0, 0.2);
        set(this.windG.gain, sp * sp * 0.12 * (state.cockpit ? 0.6 : 1) + (p.airbrake ? 0.08 : 0));
        set(this.windF.frequency, 500 + sp * 1500);
        const firing = state.firing && p.ammo > 0 && p.spec.gun;
        set(this.gunG.gain, firing ? 0.55 : 0, firing ? 0.01 : 0.04);
        set(this.gunOsc.frequency, p.spec.gun ? p.spec.gun.rate * 3.5 : 50);

        // tones
        set(this.tones.seek.g.gain, state.seeking ? 0.05 : 0, 0.02);
        set(this.tones.lock.g.gain, state.locked ? 0.06 : 0, 0.02);
        const beep = (this.ctx.currentTime * (state.missileIncoming ? 8 : 3)) % 1 < 0.5;
        set(this.tones.rwr.g.gain, (state.missileIncoming || state.spiked) && beep ? (state.missileIncoming ? 0.06 : 0.025) : 0, 0.005);
        set(this.tones.rwr.o.frequency, state.missileIncoming ? 1200 : 900, 0.01);
        const warnBeep = (this.ctx.currentTime * 4) % 1 < 0.4;
        set(this.tones.warn.g.gain, (state.pullUp || state.stall) && warnBeep ? 0.04 : 0, 0.005);
    }

    // ── One-shots ──
    boom(dist = 0, size = 1) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const vol = clamp(1.4 / (1 + dist / 350), 0, 1.2) * size;
        if (vol < 0.02) return;
        const delay = dist / 343 * 0.5; // a hint of sound delay
        const src = this.noiseSrc(this.brown, false);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
        f.frequency.setValueAtTime(1600, t + delay); f.frequency.exponentialRampToValueAtTime(90, t + delay + 1.8);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + delay);
        g.gain.linearRampToValueAtTime(vol, t + delay + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + delay + 2.2);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(t + delay); src.stop(t + delay + 2.4);
        // low thump
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(90, t + delay); o.frequency.exponentialRampToValueAtTime(30, t + delay + 0.5);
        const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.9, t + delay); og.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.6);
        o.connect(og).connect(this.sfx); o.start(t + delay); o.stop(t + delay + 0.7);
    }

    whoosh(vol = 0.5) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this.noiseSrc(this.white, false);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.4); f.frequency.exponentialRampToValueAtTime(600, t + 1.6);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
        src.connect(f).connect(g).connect(this.sfx); src.start(t); src.stop(t + 2);
    }

    tick(freq = 2400, vol = 0.12, dur = 0.03) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(this.ui); o.start(t); o.stop(t + dur + 0.02);
    }

    thud(vol = 0.5) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this.noiseSrc(this.brown, false);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        src.connect(f).connect(g).connect(this.sfx); src.start(t); src.stop(t + 0.3);
        this.tick(700 + Math.random() * 400, vol * 0.3, 0.05);
    }

    gunshot() {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this.noiseSrc(this.white, false);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        src.connect(f).connect(g).connect(this.sfx); src.start(t); src.stop(t + 0.14);
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
        const og = ctx.createGain(); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.1);
    }

    flares() {
        if (!this.ctx) return;
        for (let i = 0; i < 4; i++) setTimeout(() => this.tick(300 + Math.random() * 100, 0.2, 0.06), i * 60);
    }

    uiClick() { this.tick(1800, 0.08, 0.04); }
    uiConfirm() { this.tick(900, 0.1, 0.08); setTimeout(() => this.tick(1350, 0.1, 0.1), 80); }

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
            speechSynthesis.speak(u);
        } catch (e) { /* ignore */ }
    }

    setVolume(v) {
        this.volume = v;
        if (this.master) this.master.gain.value = v;
    }
}
