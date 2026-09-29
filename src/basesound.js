// ═══════════════════════════════════════════════════════════════
// Airbase sounds (docs/WAR.md, "Airbases"), synthesised with WebAudio into the game's world bus (so the cockpit
// muffles them): the air-raid siren and the alert scramble horn.
//  • the siren is a two-rotor mechanical one (a Federal Signal Thunderbolt-like chord, the ports' buzz through a
//    horn's formant): it spins up and winds down on its own inertia. ALERT (alarm yellow) — one long rise and
//    hold; ATTACK (alarm red) — the wavering rise and fall, for as long as the attack lasts; ALL CLEAR — a steady
//    note. Heard from a few kilometres, duller and quieter with distance
//  • the QRA horn: a harsh two-tone klaxon, three long blasts, heard across the alert pad
// Nothing runs (no audio nodes exist) while a field is silent or far away.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const HEAR = 6500;     // m: a siren beyond this isn't played at all
const TOP = 520;       // Hz: the rotors' note at full speed (the second rotor a minor third up)

export class BaseSounds {
    constructor(game) {
        this.game = game;
        this.sirens = new Map(); // key → { pos, mode, t, spin, node }
        this.horns = [];
    }
    get ctx() { const a = this.game.audio; return a && a.ctx && a.ctx.state === 'running' ? a.ctx : null; }

    // mode: 'alert' | 'attack' | 'clear' | null (off: it winds down)
    siren(key, pos, mode) {
        let s = this.sirens.get(key);
        if (!s) { s = { pos: new THREE.Vector3().copy(pos), mode: null, t: 0, spin: 0, node: null }; this.sirens.set(key, s); }
        if (s.mode !== mode) { s.mode = mode; s.t = 0; }
    }
    sirenMode(key) { const s = this.sirens.get(key); return s ? s.mode : null; }

    // three blasts of the scramble horn at pos
    horn(pos, blasts = 3) { this.horns.push({ pos: new THREE.Vector3().copy(pos), t: 0, blasts, node: null }); }

    update(dt, cam) {
        for (const [k, s] of this.sirens) {
            s.t += dt;
            // the rotor speed it's driven to (0..1): spin up in ~7 s, coast down in ~12 s
            let want = 0;
            if (s.mode === 'alert') want = s.t < 45 ? 1 : 0;
            else if (s.mode === 'attack') { const c = s.t % 11; want = c < 6.5 ? 1 : 0.42; }
            else if (s.mode === 'clear') want = s.t < 30 ? 1 : 0;
            s.spin += (want - s.spin) * Math.min(1, dt * (want > s.spin ? 0.45 : 0.22));
            if (s.spin < 0.01 && !s.mode) { this.stop(s); this.sirens.delete(k); continue; }
            this.play(s, cam);
        }
        for (let i = this.horns.length - 1; i >= 0; i--) {
            const h = this.horns[i];
            h.t += dt;
            if (!h.node && this.ctx && cam && cam.distanceTo(h.pos) < 4000) h.node = this.hornNodes(h, cam);
            if (h.t > h.blasts * 1.7 + 0.5) { this.horns.splice(i, 1); if (h.node) this.stopNodes(h.node); }
        }
    }

    play(s, cam) {
        const ctx = this.ctx;
        const d = cam ? cam.distanceTo(s.pos) : 1e9;
        if (!ctx || d > HEAR || s.spin < 0.02) { this.stop(s); return; }
        if (!s.node) s.node = this.sirenNodes(ctx);
        const n = s.node, t = ctx.currentTime;
        const f = 60 + (TOP - 60) * s.spin;
        n.o1.frequency.setTargetAtTime(f, t, 0.05);
        n.o2.frequency.setTargetAtTime(f * 1.19, t, 0.05);
        // the rotating horn sweeps its beam past the listener: a slow swell on top of the distance falloff
        const sweep = 0.75 + 0.25 * Math.sin(this.game.time * 1.3 + s.pos.x * 0.01);
        const vol = 0.55 * s.spin * s.spin / (1 + d / 350) * sweep;
        n.g.gain.setTargetAtTime(vol, t, 0.08);
        n.lp.frequency.setTargetAtTime(700 + 5200 * Math.exp(-d / 1500), t, 0.1);
    }

    sirenNodes(ctx) {
        const bus = this.game.audio.sfx || this.game.audio.master;
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'sawtooth'; o2.type = 'square';
        const m2 = ctx.createGain(); m2.gain.value = 0.45;
        // the horn's formant and a little grit
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
        const sh = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 2.2); }
        sh.curve = curve;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
        const g = ctx.createGain(); g.gain.value = 0;
        o1.connect(bp); o2.connect(m2).connect(bp);
        bp.connect(sh).connect(lp).connect(g).connect(bus);
        o1.start(); o2.start();
        return { o1, o2, m2, bp, sh, lp, g };
    }

    hornNodes(h, cam) {
        const ctx = this.ctx, bus = this.game.audio.sfx || this.game.audio.master;
        const d = cam.distanceTo(h.pos);
        const vol = 0.5 / (1 + d / 220);
        const t0 = ctx.currentTime;
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'square'; o2.type = 'sawtooth';
        o1.frequency.value = 415; o2.frequency.value = 523;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800 + 6000 * Math.exp(-d / 900);
        const g = ctx.createGain(); g.gain.value = 0;
        o1.connect(bp); o2.connect(bp); bp.connect(lp).connect(g).connect(bus);
        for (let k = 0; k < h.blasts; k++) {
            const a = t0 + k * 1.7;
            g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(vol, a + 0.04);
            g.gain.setValueAtTime(vol, a + 1.2); g.gain.linearRampToValueAtTime(0, a + 1.3);
        }
        o1.start(t0); o2.start(t0);
        const end = t0 + h.blasts * 1.7 + 0.3;
        o1.stop(end); o2.stop(end);
        return { o1, o2, bp, lp, g, stopped: false };
    }

    stop(s) { if (s.node) { this.stopNodes(s.node); s.node = null; } }
    stopNodes(n) {
        if (n.stopped) return;
        n.stopped = true;
        try { n.o1.stop(); n.o2.stop(); } catch (e) { /* already stopped */ }
        for (const k of Object.keys(n)) { const x = n[k]; if (x && x.disconnect) { try { x.disconnect(); } catch (e) { /* ignore */ } } }
    }

    clear() {
        for (const s of this.sirens.values()) this.stop(s);
        this.sirens.clear();
        for (const h of this.horns) if (h.node) this.stopNodes(h.node);
        this.horns.length = 0;
    }
}
