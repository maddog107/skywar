// ═══════════════════════════════════════════════════════════════
// The in-flight command menu (a radio menu, like a real flight's comms): \ (or F3) opens it, 1–9 choose,
// 0 goes back, Esc closes. The entries come from the plug-in systems (systems.js): each may return
//   commands() → [{ path: ['TACTICAL SUPPORT'], label, hint?, enabled? (bool | fn), run, keepOpen? }]
// so strikes, support requests, wingman orders and tasks all live in one place.
// ═══════════════════════════════════════════════════════════════
import { clamp } from './util.js';

// categories in the order they're listed (anything else follows)
const ORDER = ['TASKS', 'TACTICAL SUPPORT', 'DESIGNATION', 'SUPPORT', 'WINGMEN', 'MISSILE CAMERA', 'SANDBOX'];

export class CommandMenu {
    constructor(game) {
        this.game = game;
        this.open = false;
        this.path = [];
        this.page = 0;
        this.flash = null;
    }

    start() { this.open = false; this.path = []; }
    clear() { this.open = false; this.path = []; }

    toggle() {
        this.open = !this.open;
        this.path = []; this.page = 0;
        this.game.audio.tick(this.open ? 1100 : 700, 0.07, 0.05);
    }

    close() { this.open = false; this.path = []; }

    onAction(a) {
        if (a === 'command') { this.toggle(); return true; }
        if (!this.open) return false;
        const m = /^thr(\d+)$/.exec(a);
        if (m) {
            const n = +m[1];
            if (n === 10) this.back(); else this.choose(n - 1);
            return true;
        }
        if (a === 'pause') { this.close(); return true; }
        return false;
    }

    back() {
        if (this.page > 0) this.page--;
        else if (this.path.length) this.path.pop();
        else this.close();
        this.game.audio.tick(800, 0.05, 0.04);
    }

    // all entries from every system, fresh (their enabled state and hints change as the war goes on)
    entries() {
        const out = [];
        for (const s of this.game.systems || []) if (s.commands) { try { out.push(...(s.commands() || [])); } catch (e) { console.warn('[command]', e); } }
        return out;
    }

    // what's listed at the current path: sub-categories first, then this level's entries
    listing() {
        const all = this.entries();
        const depth = this.path.length;
        const here = all.filter(e => this.path.every((p, i) => e.path[i] === p));
        const cats = [];
        for (const e of here) if (e.path.length > depth && !cats.includes(e.path[depth])) cats.push(e.path[depth]);
        if (!depth) cats.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
        const rows = cats.map(c => {
            const inside = here.filter(e => e.path[depth] === c);
            const badge = inside.filter(e => e.badge).length;
            return { cat: c, label: c, hint: badge ? badge + ' NEW' : inside.length + '', enabled: true };
        });
        for (const e of here) if (e.path.length === depth) rows.push(e);
        return rows;
    }

    // the rows on the current page: 9 at a time, or 8 and a MORE row when there are more
    pageRows(rows = this.listing()) {
        if (rows.length <= 9) { this.page = 0; return { page: rows, pages: 1 }; }
        const pages = Math.ceil(rows.length / 8);
        this.page = clamp(this.page, 0, pages - 1);
        const page = rows.slice(this.page * 8, this.page * 8 + 8);
        if (this.page < pages - 1) page.push({ more: true, label: 'MORE', hint: 'PAGE ' + (this.page + 2) + '/' + pages, enabled: true });
        return { page, pages };
    }

    choose(i) {
        const r = this.pageRows().page[i];
        if (!r) return;
        const enabled = typeof r.enabled === 'function' ? r.enabled() : r.enabled !== false;
        if (!enabled) { this.game.audio.tick(300, 0.08, 0.05); return; }
        if (r.cat) { this.path.push(r.cat); this.page = 0; this.game.audio.tick(1300, 0.05, 0.04); return; }
        if (r.more) { this.page++; this.game.audio.tick(1300, 0.05, 0.04); return; }
        this.game.audio.tick(1500, 0.06, 0.05);
        this.flash = { label: r.label, t: this.game.time };
        try { r.run && r.run(); } catch (e) { console.warn('[command]', e); }
        if (!r.keepOpen) this.close();
    }

    drawHud(ctx, hud) {
        const g = this.game;
        if (!this.open || g.photo) return;
        const { page, pages } = this.pageRows();
        const C = hud.compact;
        const W = C ? 330 : 440, lh = C ? 19 : 23;
        const x = C ? 10 : 24, H = 58 + page.length * lh + 30;
        const y = Math.max(70, hud.h * 0.5 - H / 2);
        ctx.save();
        ctx.fillStyle = 'rgba(6,12,18,0.78)';
        ctx.strokeStyle = 'rgba(111,180,255,0.55)';
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, W, H); ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.font = (C ? '700 13px' : '700 15px') + ' "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = '#9fd4ff';
        ctx.fillText('COMMAND' + (this.path.length ? ' › ' + this.path.join(' › ') : ''), x + 12, y + 18);
        ctx.font = (C ? '600 10px' : '600 11px') + ' "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(159,212,255,0.55)';
        ctx.fillText((g.callsign || 'VIPER') + ' 1 · ' + (g.war ? g.war.designations.length : 0) + ' MARKED' + (pages > 1 ? ' · PAGE ' + (this.page + 1) + '/' + pages : ''), x + 12, y + 36);
        ctx.font = (C ? '600 12px' : '600 14px') + ' "Share Tech Mono", ui-monospace, monospace';
        page.forEach((r, i) => {
            const ry = y + 58 + i * lh;
            const enabled = typeof r.enabled === 'function' ? r.enabled() : r.enabled !== false;
            ctx.fillStyle = enabled ? '#e8f4ff' : 'rgba(232,244,255,0.35)';
            ctx.fillText((i + 1) + '  ' + r.label + (r.cat ? '  ›' : ''), x + 12, ry, W * 0.62);
            if (r.hint) {
                ctx.textAlign = 'right';
                ctx.fillStyle = enabled ? (r.cat ? 'rgba(159,212,255,0.7)' : '#9fd4ff') : 'rgba(159,212,255,0.3)';
                ctx.font = (C ? '600 10px' : '600 11px') + ' "Share Tech Mono", ui-monospace, monospace';
                ctx.fillText(r.hint, x + W - 12, ry, W * 0.36);
                ctx.font = (C ? '600 12px' : '600 14px') + ' "Share Tech Mono", ui-monospace, monospace';
                ctx.textAlign = 'left';
            }
        });
        ctx.fillStyle = 'rgba(159,212,255,0.55)';
        ctx.font = (C ? '600 10px' : '600 11px') + ' "Share Tech Mono", ui-monospace, monospace';
        ctx.fillText('1–9 SELECT · 0 BACK · ESC CLOSE', x + 12, y + H - 16);
        ctx.restore();
    }
}
