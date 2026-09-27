// ═══════════════════════════════════════════════════════════════
// Drawing kit for the interiors' live screens (interiors.js Screen canvases): military console styling — a title
// bar, readouts, tapes, compasses, lists — and a tactical map drawn with the tactical map's own layers (tacmap.js)
// into any canvas at any centre and scale. Everything draws into a 2D context; nothing here allocates per call
// beyond small strings.
// ═══════════════════════════════════════════════════════════════
import { FONT } from './interiors.js';

export const C = {
    bg: '#02070b', bg2: '#061019', grid: 'rgba(90,170,220,0.14)', line: 'rgba(120,200,255,0.55)', text: '#dcecf8', dim: 'rgba(190,220,240,0.55)',
    cyan: '#7fd4ff', green: '#5dffa0', amber: '#ffc23f', red: '#ff5a4a', white: '#f2f8fc', blue: '#6fb4ff',
};
export const f = (w, px) => w + ' ' + px + 'px ' + FONT;

// a console page: background, scan lines, the title bar (title, subtitle, a clock) → the content rect's top
export function page(ctx, W, H, title, sub = '', clock = '', accent = C.cyan) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,200,255,0.025)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    const th = Math.round(H * 0.075) + 8;
    ctx.fillStyle = C.bg2; ctx.fillRect(0, 0, W, th);
    ctx.fillStyle = accent; ctx.fillRect(0, th - 3, W, 3);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = f(700, Math.round(th * 0.5)); ctx.fillStyle = C.white;
    ctx.fillText(title, 14, th / 2, W * 0.6);
    ctx.textAlign = 'right'; ctx.font = f(600, Math.round(th * 0.36)); ctx.fillStyle = C.dim;
    ctx.fillText((sub ? sub + '   ' : '') + clock, W - 12, th / 2, W * 0.45);
    ctx.textAlign = 'left';
    return th + 8;
}

// a boxed readout: label above, value big
export function readout(ctx, x, y, w, h, label, value, color = C.white, unit = '') {
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = f(600, Math.max(10, Math.round(h * 0.2))); ctx.fillStyle = C.dim;
    ctx.fillText(label, x + 8, y + h * 0.2, w - 16);
    ctx.font = f(700, Math.max(14, Math.round(h * 0.46))); ctx.fillStyle = color;
    ctx.fillText(value, x + 8, y + h * 0.62, w - 16);
    if (unit) { ctx.textAlign = 'right'; ctx.font = f(600, Math.max(10, Math.round(h * 0.2))); ctx.fillStyle = C.dim; ctx.fillText(unit, x + w - 8, y + h * 0.72); ctx.textAlign = 'left'; }
}

export function text(ctx, t, x, y, px = 16, color = C.text, weight = 600, align = 'left', maxW) {
    ctx.font = f(weight, px); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (maxW) ctx.fillText(t, x, y, maxW); else ctx.fillText(t, x, y);
}

// a vertical tape (depth / altitude): value v, the window from v − span/2 to v + span/2, ticks every `step`
export function tape(ctx, x, y, w, h, v, span, step, label, fmt = (n) => String(Math.round(n)), mark = null, down = true) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(10,30,45,0.8)'; ctx.fillRect(x, y, w, h);
    const k = h / span, mid = y + h / 2;
    const s0 = Math.floor((v - span / 2) / step) * step;
    ctx.strokeStyle = C.line; ctx.fillStyle = C.text; ctx.lineWidth = 1.2; ctx.font = f(600, 13); ctx.textBaseline = 'middle';
    for (let s = s0; s <= v + span / 2 + step; s += step) {
        const yy = mid + (down ? 1 : -1) * (s - v) * k;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 12, yy); ctx.stroke();
        ctx.textAlign = 'left'; ctx.fillText(fmt(s), x + 16, yy);
    }
    if (mark != null) {
        const yy = mid + (down ? 1 : -1) * (mark - v) * k;
        ctx.fillStyle = C.amber; ctx.beginPath(); ctx.moveTo(x + w, yy); ctx.lineTo(x + w - 12, yy - 7); ctx.lineTo(x + w - 12, yy + 7); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 2; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = C.bg; ctx.fillRect(x - 2, mid - 13, w + 4, 26);
    ctx.strokeStyle = C.white; ctx.strokeRect(x - 1.5, mid - 12.5, w + 3, 25);
    text(ctx, fmt(v), x + w / 2, mid, 16, C.white, 700, 'center');
    if (label) text(ctx, label, x + w / 2, y - 12, 12, C.dim, 600, 'center');
}

// a compass rose / heading dial at (cx, cy) radius r: heading in degrees (0 = north), an ordered heading mark
export function compass(ctx, cx, cy, r, hdg, ordered = null, label = 'HEADING') {
    ctx.save();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.font = f(600, Math.round(r * 0.13)); ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 10) {
        const a = (d - hdg) * Math.PI / 180 - Math.PI / 2;
        const r0 = d % 30 === 0 ? r * 0.86 : r * 0.92;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
        if (d % 30 === 0) ctx.fillText(d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10), cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    }
    if (ordered != null) {
        const a = (ordered - hdg) * Math.PI / 180 - Math.PI / 2;
        ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = C.white; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.35); ctx.lineTo(cx, cy - r * 0.55); ctx.stroke();
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.62); ctx.lineTo(cx - 7, cy - r * 0.48); ctx.lineTo(cx + 7, cy - r * 0.48); ctx.fill();
    ctx.restore();
    text(ctx, String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0') + '°', cx, cy + r * 0.62, Math.round(r * 0.18), C.white, 700, 'center');
    if (label) text(ctx, label, cx, cy - r - 12, 12, C.dim, 600, 'center');
}

// a horizontal bar 0..1
export function bar(ctx, x, y, w, h, k, color = C.green, label = '') {
    ctx.fillStyle = 'rgba(120,200,255,0.1)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (label) text(ctx, label, x + 6, y + h / 2, Math.max(10, Math.round(h * 0.6)), C.white, 700);
}

// a checklist line: ✓ / · with label and the reason when it isn't done
export function check(ctx, x, y, w, item, active = false) {
    const col = item.done ? C.green : active ? C.amber : C.dim;
    ctx.fillStyle = item.done ? 'rgba(93,255,160,0.1)' : active ? 'rgba(255,194,63,0.12)' : 'rgba(0,0,0,0)';
    ctx.fillRect(x, y - 13, w, 26);
    text(ctx, item.done ? '■' : '□', x + 8, y, 16, col, 700);
    text(ctx, item.label, x + 32, y, 16, item.done ? C.white : col, 700, 'left', w * 0.55);
    if (!item.done && active && item.why) text(ctx, item.why, x + w - 6, y, 12, C.amber, 600, 'right', w * 0.42);
}

// ═════════════ a tactical map in a screen ═════════════
// A view object that borrows the tactical map's drawing (its layers, symbols, geography, the plug-ins' drawMap)
// with its own centre, scale and canvas size. game.tacmap must exist.
export class MapView {
    constructor(game, w, h) {
        this.game = game;
        this.w = w; this.h = h;
        this.view = { cx: 0, cz: 0, scale: 0.01 };
        this.buttons = [];
        this.layers = { threats: true, intel: true, roads: true, units: true, labels: true };
        this.sel = null;
    }
    get scale() { return this.view.scale; }
    toScreen(x, z, out = {}) { out.x = this.w / 2 + (x - this.view.cx) * this.view.scale; out.y = this.h / 2 + (z - this.view.cz) * this.view.scale; return out; }
    toWorld(sx, sy) { return { x: this.view.cx + (sx - this.w / 2) / this.view.scale, z: this.view.cz + (sy - this.h / 2) / this.view.scale }; }
    // (the tactical map's methods, run with this view as `this`)
    draw(ctx, { skip = ['mapkit', 'tacmap'], own = null } = {}) {
        const g = this.game, T = g.tacmap;
        ctx.save();
        ctx.fillStyle = '#0b1118'; ctx.fillRect(0, 0, this.w, this.h);
        this.buttons.length = 0;
        if (!T) { ctx.restore(); return; }
        const call = (fn) => { try { fn.call(this, ctx); } catch (e) { if (!this._err) { this._err = true; console.warn('[screens] map', e); } } };
        if (T.bg) { const t = T.bg, a = this.toScreen(t.x0, t.z0), s = t.span * this.view.scale; ctx.imageSmoothingEnabled = true; ctx.drawImage(t.img, a.x, a.y, s, s); }
        this.bg = T.bg; this.tiles = T.tiles;
        const P = T.constructor.prototype;
        call(P.drawTerritory); call(P.drawGrid); call(P.drawGeography);
        if (this.layers.threats) call(P.drawThreats);
        if (this.layers.intel) call(P.drawReports);
        if (this.layers.units) { this.visibleUnit = P.visibleUnit; this.planeGlyph = P.planeGlyph; this.glyph = P.glyph; call(P.drawUnits); }
        call(P.drawMarks);
        for (const s of g.systems || []) {
            if (!s.drawMap || s === T || skip.some(k => g[k] === s)) continue;
            try { s.drawMap(ctx, this); } catch (e) { /* (a layer made for the big map) */ }
        }
        if (own) own(ctx, this);
        ctx.restore();
    }
    focusPos() { return this.game.tacmap ? this.game.tacmap.focusPos() : null; }
}

// the bearing (deg, 0 = north, clockwise) from a to b
export const bearing = (a, b) => ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI) + 360) % 360;
export const hdgDeg = (h) => ((-h * 180 / Math.PI) % 360 + 360) % 360; // naval.js heading (rad, + left) → compass degrees
export const clock = (g) => { const t = (g && g.world && g.world.timeOfDay != null) ? g.world.timeOfDay : null; void t; const d = new Date(); return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + ':' + String(d.getUTCSeconds()).padStart(2, '0') + 'Z'; };
