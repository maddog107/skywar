// ═══════════════════════════════════════════════════════════════
// Adaptive music: crossfades between CC0 tracks (see music/CREDITS.md)
//   menu    — hangar theme
//   flight  — calm free flight / cruising
//   tension — missions, strike runs, storms, when threats are around
//   combat  — bandits close, missiles in the air
// ═══════════════════════════════════════════════════════════════
const TRACKS = {
    menu: { src: 'music/menu.mp3', gain: 0.55 },
    flight: { src: 'music/flight.mp3', gain: 1.0 }, // this one is mastered much quieter
    tension: { src: 'music/tension.mp3', gain: 0.6 },
    combat: { src: 'music/combat.mp3', gain: 0.5 },
};

export class Music {
    constructor() {
        this.volume = 0.5;
        this.players = {};
        this.current = null;
        this.combatHold = 0;
        this.started = false;
    }

    // Browsers only allow audio after a user gesture: call from a click
    unlock() {
        if (this.started) return;
        this.started = true;
        for (const [k, t] of Object.entries(TRACKS)) {
            const a = new Audio(t.src);
            a.loop = true;
            a.preload = 'auto';
            a.volume = 0;
            this.players[k] = { el: a, level: 0, base: t.gain };
        }
    }

    setVolume(v) { this.volume = v; }

    // Decide the mood from the game state, then fade toward it
    update(dt, game) {
        if (!this.started) return;
        let want = 'menu';
        if (game && game.state !== 'menu') {
            const p = game.player;
            const pm = game.pilotMode;
            let threat = false;
            if (p && (game.state === 'playing' || game.state === 'dead')) {
                const at = pm ? pm.pos : p.pos;
                threat = (p.incoming && p.incoming.length > 0)
                    || game.aircraft.some(a => a.team === 'red' && a.alive && !a.pilotDead && a.pos.distanceTo(at) < 6500)
                    || game.weapons.missiles.some(m => m.pos.distanceTo(at) < 4000);
            }
            if (threat) this.combatHold = 8;
            this.combatHold -= dt;
            const calmMode = ['freeflight', 'sandbox', 'rings'].includes(game.mode);
            const tense = game.mission || game.mode === 'strike' || game.mode === 'naval' || (game.world && game.world.weather === 'storm');
            want = this.combatHold > 0 ? 'combat' : calmMode && !tense ? 'flight' : tense ? 'tension' : 'flight';
            if (game.state === 'over') want = 'menu';
        }
        this.current = want;
        const paused = game && game.state === 'paused';
        for (const [k, pl] of Object.entries(this.players)) {
            const target = k === want ? 1 : 0;
            pl.level += (target - pl.level) * Math.min(1, dt * (target ? 0.6 : 0.9));
            const v = pl.level * pl.base * this.volume * (paused ? 0.35 : 1);
            pl.el.volume = Math.max(0, Math.min(1, v));
            if (pl.level > 0.01 && pl.el.paused) pl.el.play().catch(() => {});
            else if (pl.level <= 0.01 && !pl.el.paused) pl.el.pause();
        }
    }
}
