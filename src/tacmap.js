// ═══════════════════════════════════════════════════════════════
// Tactical map (` or F2): what the player's side knows, not what's there.
//  • background: shaded relief from the terrain itself (mapworker.js), sharper tiles when zoomed in
//  • towns, roads, airfields and bridges; the front line and enemy territory
//  • units: friendly ones always; enemy ones only once detected — "?" contacts, identified units with
//    their symbols, stale contacts fading at their last known position; threat rings for known radars and
//    SAMs; intel search areas; marks; missiles in flight and BDA requests (strikes.js draws those)
//  • click a unit or the ground: a panel with what we know and what can be done — mark it, strike it,
//    and whatever the plug-in systems offer (mapActions)
// Drag to pan, wheel to zoom, F to centre on yourself, ` or Esc to close. The game keeps running.
// ═══════════════════════════════════════════════════════════════
import { BASES } from './world.js';
import { INTEL, INTEL_NAMES } from './war.js';
import { STRIKE_TYPES } from './strikes.js';
import { MapTiles } from './maptiles.js';
import { clamp } from './util.js';

const SPAN = 128000, BASE_RES = 1024; // background: 128 km square at 125 m a pixel
const BLUE = '#6fb4ff', RED = '#ff5a4a', UNK = '#ffd24a';
export const BLUE_TOWNS = ['Harrow', 'Kestrel Bay', 'Ashby', 'Millbrook', 'Coldwater', 'Fairhaven', 'Linton', 'Oakridge', 'Pinecrest', 'Redstone', 'Sheffield Cove', 'Thornton', 'Westmere', 'Brightwater', 'Easton', 'Hollow Creek', 'Marlow', 'Stanford Point', 'Wells', 'Arden'];
export const RED_TOWNS = ['Vorsk', 'Kalinovka', 'Zarechye', 'Dubrava', 'Ostrog', 'Belaya Gora', 'Tikhoye', 'Krasnodol', 'Sosnovka', 'Yarovo', 'Gorodok', 'Lesnoy', 'Mirny', 'Novoselye', 'Pechory', 'Rudnya', 'Stary Bor', 'Tula-7', 'Volkovo', 'Zlatoust'];

export class TacticalMap {
    constructor(game) {
        this.game = game;
        this.open = false;
        this.view = { cx: 0, cz: -8000, scale: 0.012 };
        this.sel = null;
        this.hover = null;
        this.buttons = [];
        this.bg = null;
        this.tiles = new MapTiles(); // sharp background tiles when zoomed in (maptiles.js)
        this.layers = { threats: true, intel: true, roads: true, units: true, labels: true }; // (mapkit.js toggles them)
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'tacmap';
        Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'none', zIndex: '40', cursor: 'crosshair', background: '#0b1118' });
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this.bindInput();
        this.requestBackground();
    }

    get scale() { return this.view.scale; }

    // ═════════════ Background (worker) ═════════════
    requestBackground() {
        try {
            this.worker = new Worker(new URL('./mapworker.js', import.meta.url), { type: 'module' });
            this.worker.onmessage = (e) => this.onTile(e.data);
            this.worker.onerror = (e) => { console.warn('[tacmap] map worker failed', e.message || e); this.worker = null; };
            this.worker.postMessage({ size: BASE_RES, x0: -SPAN / 2, z0: -SPAN / 2 - 8000, span: SPAN, base: true });
        } catch (e) { this.worker = null; }
    }

    onTile(d) {
        const c = document.createElement('canvas');
        c.width = c.height = d.size;
        c.getContext('2d').putImageData(new ImageData(d.pixels, d.size, d.size), 0, 0);
        if (d.base) this.bg = { img: c, x0: d.x0, z0: d.z0, span: d.span };
    }

    // ═════════════ Open / close ═════════════
    start() { this.close(); }
    clear() { this.close(); this.sel = null; }

    toggle() { if (this.open) this.close(); else this.show(); }
    show() {
        const g = this.game;
        this.open = true;
        this.canvas.style.display = 'block';
        g.input.unlock();
        this.resize();
        const p = this.focusPos();
        if (p && !this.centred) { this.view.cx = p.x; this.view.cz = p.z; this.centred = true; }
        g.audio.tick(1000, 0.06, 0.05);
    }
    close() {
        if (!this.open) return;
        this.open = false;
        this.canvas.style.display = 'none';
        const g = this.game;
        if (g.state === 'playing' && (g.settings.controlMode !== 'mousestick' || g.pilotMode)) g.input.lock();
    }

    focusPos() {
        const g = this.game;
        if (g.pilotMode) return g.pilotMode.pos;
        if (g.player) return g.player.pos;
        return null;
    }

    onAction(a) {
        if (a === 'map') { this.toggle(); return true; }
        if (!this.open) return false;
        if (a === 'pause') { this.close(); return true; }
        if (a === 'flaps') return true; // (F centres the map)
        return false;
    }

    // ═════════════ Coordinates ═════════════
    resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth, h = window.innerHeight;
        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
        }
        this.w = w; this.h = h; this.dpr = dpr;
    }
    toScreen(x, z, out = {}) {
        out.x = this.w / 2 + (x - this.view.cx) * this.view.scale;
        out.y = this.h / 2 + (z - this.view.cz) * this.view.scale;
        return out;
    }
    toWorld(sx, sy) { return { x: this.view.cx + (sx - this.w / 2) / this.view.scale, z: this.view.cz + (sy - this.h / 2) / this.view.scale }; }

    // ═════════════ Input ═════════════
    bindInput() {
        const c = this.canvas;
        let drag = null;
        c.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
        });
        window.addEventListener('mousemove', (e) => {
            if (!this.open) return;
            this.mouse = { x: e.clientX, y: e.clientY };
            if (drag) {
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
                this.view.cx = drag.cx - dx / this.view.scale;
                this.view.cz = drag.cz - dy / this.view.scale;
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (!this.open || !drag) return;
            const d = drag; drag = null;
            if (!d.moved && e.button === 0) this.click(e.clientX, e.clientY);
        });
        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            const before = this.toWorld(e.clientX, e.clientY);
            this.view.scale = clamp(this.view.scale * Math.pow(1.0015, -e.deltaY), 0.0025, 0.6);
            const after = this.toWorld(e.clientX, e.clientY);
            this.view.cx += before.x - after.x; this.view.cz += before.z - after.z;
        }, { passive: false });
        c.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('keydown', (e) => {
            if (!this.open || (e.target && e.target.tagName === 'INPUT')) return;
            if (e.code === 'KeyF') { const p = this.focusPos(); if (p) { this.view.cx = p.x; this.view.cz = p.z; } }
            if (e.code === 'Equal' || e.code === 'NumpadAdd') this.view.scale = clamp(this.view.scale * 1.25, 0.0025, 0.6);
            if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.view.scale = clamp(this.view.scale / 1.25, 0.0025, 0.6);
        });
    }

    click(x, y) {
        for (const b of this.buttons) {
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                if (b.enabled !== false) { this.game.audio.tick(1400, 0.05, 0.04); b.run(); }
                return;
            }
        }
        // a plug-in's map tool (the sandbox's placing and route drawing, sandbox.js) takes the click first
        for (const s of this.game.systems || []) if (s.mapClick && s.mapClick(x, y, this)) return;
        const hit = this.pick(x, y);
        if (hit) { this.sel = hit; this.strikeMenu = false; return; }
        const w = this.toWorld(x, y);
        this.sel = { kind: 'point', pos: { x: w.x, y: 0, z: w.z } };
        this.strikeMenu = false;
    }

    // the thing under the cursor: a unit we know, a mark, something of a plug-in's (mapPick), an intel area
    pick(x, y) {
        const war = this.game.war;
        let best = null, bd = 14 * 14;
        const P = {};
        for (const u of war.units) {
            const r = war.recs.get(u);
            if (!this.visibleUnit(r)) continue;
            const pos = r.team === war.side ? u.pos : r.lastPos;
            this.toScreen(pos.x, pos.z, P);
            const d = (P.x - x) ** 2 + (P.y - y) ** 2;
            if (d < bd) { bd = d; best = { kind: 'unit', unit: u }; }
        }
        for (const d of war.designations) {
            const p = d.unit ? d.unit.pos : d.fixed || d.pos;
            this.toScreen(p.x, p.z, P);
            const dd = (P.x - x) ** 2 + (P.y - y) ** 2;
            if (dd < bd) { bd = dd; best = { kind: 'mark', mark: d }; }
        }
        if (!best) for (const s of this.game.systems || []) if (s.mapPick) { const h = s.mapPick(x, y, this); if (h) return h; }
        if (!best) for (const rp of war.reports) {
            if (rp.resolved) continue;
            this.toScreen(rp.center.x, rp.center.z, P);
            if (Math.hypot(P.x - x, P.y - y) < rp.radius * this.view.scale) return { kind: 'report', report: rp };
        }
        return best;
    }

    visibleUnit(r) {
        const war = this.game.war;
        if (!r || !this.layers.units) return false;
        if (r.team === war.side) return r.unit.alive || r.cls !== 'aircraft';
        // bridges only close in (or when one's down, or marked): the road network already shows where they are
        if (r.team === 'neutral') return r.cls === 'bridge' && (this.view.scale > 0.04 || !r.unit.alive || war.designations.some(d => d.unit === r.unit));
        return r.known >= INTEL.CONTACT;
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.open || this.game.subStep) return; // (once a frame, whatever the sandbox's clock)
        this.resize();
        this.draw();
        void dt;
    }

    draw() {
        const ctx = this.ctx, g = this.game, war = g.war, L = this.layers;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = '#0b1118';
        ctx.fillRect(0, 0, this.w, this.h);
        this.buttons = [];
        // background relief: the whole theatre, then sharp tiles when zoomed in
        if (this.bg) {
            const t = this.bg, a = this.toScreen(t.x0, t.z0), s = t.span * this.view.scale;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(t.img, a.x, a.y, s, s);
        }
        this.tiles.draw(ctx, this);
        if (!this.bg) {
            ctx.fillStyle = 'rgba(159,212,255,0.6)'; ctx.font = '600 14px "Share Tech Mono", monospace'; ctx.textAlign = 'center';
            ctx.fillText('PREPARING MAP…', this.w / 2, this.h / 2);
        }
        this.drawTerritory(ctx);
        this.drawGrid(ctx);
        this.drawGeography(ctx);
        if (L.threats) this.drawThreats(ctx);
        if (L.intel) this.drawReports(ctx);
        if (L.units) this.drawUnits(ctx);
        this.drawMarks(ctx);
        for (const s of g.systems || []) if (s !== this && s.drawMap) { try { s.drawMap(ctx, this); } catch (e) { console.warn('[tacmap]', e); } }
        this.drawPlayer(ctx);
        this.drawPanel(ctx);
        this.drawLegend(ctx);
        void war;
    }

    // enemy-held ground tinted, and the front line
    drawTerritory(ctx) {
        const war = this.game.war, F = war.front;
        ctx.save();
        ctx.beginPath();
        const P = {};
        this.toScreen(F[0].x - 200000, F[0].z, P); ctx.moveTo(P.x, P.y);
        for (const p of F) { this.toScreen(p.x, p.z, P); ctx.lineTo(P.x, P.y); }
        const last = F[F.length - 1];
        this.toScreen(last.x + 200000, last.z, P); ctx.lineTo(P.x, P.y);
        this.toScreen(last.x + 200000, -300000, P); ctx.lineTo(P.x, P.y);
        this.toScreen(F[0].x - 200000, -300000, P); ctx.lineTo(P.x, P.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,60,40,0.10)';
        ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < F.length; i++) { this.toScreen(F[i].x, F[i].z, P); if (i) ctx.lineTo(P.x, P.y); else ctx.moveTo(P.x, P.y); }
        ctx.strokeStyle = 'rgba(255,90,74,0.85)'; ctx.lineWidth = 2.2; ctx.setLineDash([10, 6]); ctx.stroke();
        ctx.strokeStyle = 'rgba(111,180,255,0.7)'; ctx.lineWidth = 1.2; ctx.lineDashOffset = 8; ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        ctx.restore();
    }

    // 10 km grid with the war's grid letters
    drawGrid(ctx) {
        const war = this.game.war;
        const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h);
        const step = this.view.scale < 0.006 ? 20000 : 10000;
        ctx.save();
        ctx.strokeStyle = 'rgba(200,225,255,0.13)'; ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(200,225,255,0.5)'; ctx.font = '600 10px "Share Tech Mono", monospace';
        const P = {};
        for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) {
            this.toScreen(x, 0, P);
            ctx.beginPath(); ctx.moveTo(P.x, 0); ctx.lineTo(P.x, this.h); ctx.stroke();
        }
        for (let z = Math.floor(a.z / step) * step; z <= b.z; z += step) {
            this.toScreen(0, z, P);
            ctx.beginPath(); ctx.moveTo(0, P.y); ctx.lineTo(this.w, P.y); ctx.stroke();
        }
        // square labels in the corner of each square
        if (step === 10000) {
            ctx.textAlign = 'left';
            for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) for (let z = Math.floor(a.z / step) * step; z <= b.z; z += step) {
                this.toScreen(x, z + step, P);
                ctx.fillText(war.grid(x + 1, z + step - 1).slice(0, 2), P.x + 3, P.y - 5);
            }
        }
        ctx.restore();
    }

    // towns, roads, airfields
    drawGeography(ctx) {
        const g = this.game, towns = g.world.towns, war = g.war;
        const P = {}, Q = {};
        ctx.save();
        if (towns) {
            ctx.strokeStyle = 'rgba(240,220,170,0.55)'; ctx.lineWidth = this.view.scale > 0.02 ? 2 : 1.2;
            if (this.layers.roads) for (const path of towns.paths || []) {
                const pts = path.pts;
                ctx.beginPath();
                for (let i = 0; i < pts.length; i += 2) { this.toScreen(pts[i].x, pts[i].z, P); if (i) ctx.lineTo(P.x, P.y); else ctx.moveTo(P.x, P.y); }
                ctx.stroke();
            }
            let bi = 0, ri = 0;
            (towns.towns || []).forEach((t, i) => {
                this.toScreen(t.x, t.z, P);
                if (P.x < -50 || P.y < -50 || P.x > this.w + 50 || P.y > this.h + 50) return;
                const r = Math.max(3, t.radius * this.view.scale);
                const red = war.sideAt(t.x, t.z) === 'red';
                ctx.fillStyle = red ? 'rgba(255,140,120,0.45)' : 'rgba(255,240,210,0.45)';
                ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, Math.PI * 2); ctx.fill();
                if (!t.mapName) t.mapName = red ? RED_TOWNS[ri++ % RED_TOWNS.length] : BLUE_TOWNS[bi++ % BLUE_TOWNS.length];
                else red ? ri++ : bi++;
                if (this.layers.labels && (this.view.scale > 0.005 || t.size === 'city')) {
                    ctx.fillStyle = '#f4ead8'; ctx.font = (t.size === 'city' ? '700 12px' : '600 10px') + ' "Share Tech Mono", monospace'; ctx.textAlign = 'center';
                    ctx.fillText(t.mapName.toUpperCase(), P.x, P.y - r - 5);
                }
                void i;
            });
        }
        // airfields: the runways, and the name
        for (const b of BASES) {
            const c = Math.cos(b.heading), s = Math.sin(b.heading);
            const red = !b.friendly;
            ctx.strokeStyle = red ? RED : b.civil ? '#e9e2cf' : BLUE; ctx.lineWidth = Math.max(2, 55 * this.view.scale);
            for (const rw of b.runways) {
                const cx = b.x + rw.lx * c + rw.lz * s, cz = b.z - rw.lx * s + rw.lz * c;
                const hd = b.heading + (rw.rot || 0), L = rw.len / 2;
                this.toScreen(cx - Math.sin(hd) * L, cz - Math.cos(hd) * L, P); this.toScreen(cx + Math.sin(hd) * L, cz + Math.cos(hd) * L, Q);
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
            }
            this.toScreen(b.x, b.z, P);
            ctx.fillStyle = red ? RED : b.civil ? '#e9e2cf' : BLUE; ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.textAlign = 'left';
            if (this.layers.labels) ctx.fillText(b.name, P.x + 14, P.y + 18);
        }
        ctx.restore();
    }

    // threat rings for known radars and SAM sites
    drawThreats(ctx) {
        const war = this.game.war, P = {};
        ctx.save();
        for (const u of war.units) {
            const r = war.recs.get(u);
            if (!u.alive || r.team === war.side || r.known < INTEL.IDENTIFIED) continue;
            let R = 0, col = 'rgba(255,90,74,0.55)', dash = [8, 6];
            if (r.cls === 'sam') R = u.samRange || 7500;
            else if (r.cls === 'aaa') R = 2800;
            else if (r.cls === 'radar' || r.cls === 'sam-radar') { R = u.radarRange || 90000; col = 'rgba(255,200,80,0.35)'; dash = [3, 7]; }
            if (!R) continue;
            this.toScreen(r.lastPos.x, r.lastPos.z, P);
            ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.arc(P.x, P.y, R * this.view.scale, 0, Math.PI * 2); ctx.stroke();
            if (r.cls === 'sam' || r.cls === 'aaa') { ctx.fillStyle = 'rgba(255,60,40,0.06)'; ctx.fill(); }
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    drawReports(ctx) {
        const war = this.game.war, P = {};
        ctx.save();
        for (const rp of war.reports) {
            if (rp.resolved) continue;
            this.toScreen(rp.center.x, rp.center.z, P);
            ctx.strokeStyle = UNK; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(P.x, P.y, rp.radius * this.view.scale, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = 'rgba(255,210,74,0.07)'; ctx.fill();
            ctx.setLineDash([]);
            ctx.fillStyle = UNK; ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.textAlign = 'center';
            ctx.fillText('SEARCH AREA', P.x, P.y - 6);
            ctx.font = '600 10px "Share Tech Mono", monospace';
            ctx.fillText(rp.text, P.x, P.y + 8, 260);
        }
        ctx.restore();
    }

    // units: blue rectangles (friendly), red diamonds (hostile), yellow "?" (unidentified); glyph by class
    drawUnits(ctx) {
        const g = this.game, war = g.war, P = {};
        const now = war.time;
        ctx.save();
        ctx.textBaseline = 'middle';
        for (const u of war.units) {
            const r = war.recs.get(u);
            if (!this.visibleUnit(r)) continue;
            if (u === g.player) continue;
            const own = r.team === war.side;
            const pos = own ? u.pos : r.lastPos;
            this.toScreen(pos.x, pos.z, P);
            if (P.x < -30 || P.y < -30 || P.x > this.w + 30 || P.y > this.h + 30) continue;
            const air = r.cls === 'aircraft' || r.cls === 'helicopter';
            const stale = !own && now - r.lastSeen > (air ? 20 : 180);
            ctx.globalAlpha = stale ? 0.45 : 1;
            const known = own || r.known >= INTEL.IDENTIFIED;
            const col = own ? BLUE : r.team === 'neutral' ? '#cfd8e0' : known ? RED : UNK;
            const s = air ? 7 : r.cls === 'carrier' ? 10 : 8;
            ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
            if (!u.alive) { ctx.globalAlpha *= 0.6; }
            if (air) this.planeGlyph(ctx, P.x, P.y, u, s, col);
            else if (own || r.team === 'neutral') { ctx.strokeRect(P.x - s, P.y - s * 0.7, s * 2, s * 1.4); this.glyph(ctx, r.cls, P.x, P.y, s * 0.6); }
            else if (known) {
                ctx.beginPath(); ctx.moveTo(P.x, P.y - s); ctx.lineTo(P.x + s, P.y); ctx.lineTo(P.x, P.y + s); ctx.lineTo(P.x - s, P.y); ctx.closePath(); ctx.stroke();
                this.glyph(ctx, r.cls, P.x, P.y, s * 0.55);
            } else {
                ctx.beginPath(); ctx.arc(P.x, P.y, s * 0.9, 0, Math.PI * 2); ctx.stroke();
                ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('?', P.x, P.y + 0.5);
            }
            if (!u.alive) { ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P.x - s, P.y - s); ctx.lineTo(P.x + s, P.y + s); ctx.moveTo(P.x + s, P.y - s); ctx.lineTo(P.x - s, P.y + s); ctx.stroke(); }
            // label when zoomed in (or selected)
            const selected = this.sel && this.sel.unit === u;
            if (selected || (this.layers.labels && (this.view.scale > 0.02 || (known && !air && this.view.scale > 0.008 && !own)))) {
                ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = col;
                ctx.fillText(war.label(u) + (stale ? ' (' + Math.round((now - r.lastSeen) / 60) + ' MIN)' : ''), P.x + s + 4, P.y);
            }
            if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(P.x - s - 4, P.y - s - 4, s * 2 + 8, s * 2 + 8); }
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    planeGlyph(ctx, x, y, u, s, col) {
        const v = u.vel || { x: 0, z: -1 };
        const a = Math.atan2(v.x, -v.z);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.7); ctx.lineTo(0, s * 0.3); ctx.lineTo(-s * 0.7, s * 0.7); ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    // a small symbol inside the frame for each class (simplified APP-6 style)
    glyph(ctx, cls, x, y, s) {
        ctx.save();
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        switch (cls) {
            case 'sam': case 'sam-radar': ctx.arc(x, y + s * 0.5, s * 0.9, Math.PI, 0); ctx.moveTo(x, y + s * 0.5); ctx.lineTo(x, y - s); break;
            case 'radar': ctx.arc(x - s * 0.2, y + s * 0.2, s * 0.8, -Math.PI * 0.9, -Math.PI * 0.1); ctx.moveTo(x - s * 0.2, y + s * 0.2); ctx.lineTo(x + s * 0.6, y - s * 0.6); break;
            case 'aaa': ctx.moveTo(x - s, y + s * 0.6); ctx.lineTo(x, y - s * 0.6); ctx.lineTo(x + s, y + s * 0.6); break;
            case 'tel': case 'silo': ctx.moveTo(x, y + s); ctx.lineTo(x, y - s); ctx.moveTo(x - s * 0.5, y - s * 0.4); ctx.lineTo(x, y - s); ctx.lineTo(x + s * 0.5, y - s * 0.4); break;
            case 'artillery': ctx.arc(x, y, s * 0.35, 0, Math.PI * 2); ctx.moveTo(x - s, y + s * 0.6); ctx.lineTo(x + s, y + s * 0.6); break;
            case 'tank': ctx.ellipse(x, y, s, s * 0.5, 0, 0, Math.PI * 2); break;
            case 'ship': case 'carrier': case 'sub': ctx.moveTo(x - s, y - s * 0.2); ctx.lineTo(x + s, y - s * 0.2); ctx.lineTo(x + s * 0.6, y + s * 0.5); ctx.lineTo(x - s * 0.6, y + s * 0.5); ctx.closePath(); break;
            case 'command': ctx.moveTo(x - s * 0.5, y + s); ctx.lineTo(x - s * 0.5, y - s); ctx.lineTo(x + s * 0.7, y - s * 0.6); ctx.lineTo(x - s * 0.5, y - s * 0.2); break;
            case 'infantry': ctx.moveTo(x - s, y - s * 0.6); ctx.lineTo(x + s, y + s * 0.6); ctx.moveTo(x + s, y - s * 0.6); ctx.lineTo(x - s, y + s * 0.6); break;
            case 'bridge': ctx.moveTo(x - s, y - s * 0.4); ctx.lineTo(x + s, y - s * 0.4); ctx.moveTo(x - s, y + s * 0.4); ctx.lineTo(x + s, y + s * 0.4); break;
            case 'facility': case 'entrance': case 'bunker': ctx.rect(x - s * 0.6, y - s * 0.4, s * 1.2, s * 0.8); break;
            // airbase installations (bases.js)
            case 'runway': ctx.rect(x - s * 0.22, y - s, s * 0.44, s * 2); ctx.moveTo(x, y - s * 0.7); ctx.lineTo(x, y + s * 0.7); break;
            case 'taxiway': ctx.moveTo(x - s * 0.5, y + s); ctx.lineTo(x - s * 0.5, y - s * 0.2); ctx.lineTo(x + s, y - s * 0.2); ctx.moveTo(x + s * 0.1, y + s); ctx.lineTo(x + s * 0.1, y + s * 0.4); ctx.lineTo(x + s, y + s * 0.4); break;
            case 'shelter': case 'hangar': ctx.moveTo(x - s, y + s * 0.5); ctx.arc(x, y + s * 0.5, s, Math.PI, 0); ctx.lineTo(x - s, y + s * 0.5); break;
            case 'fuel': ctx.ellipse(x, y - s * 0.5, s * 0.6, s * 0.22, 0, 0, Math.PI * 2); ctx.moveTo(x - s * 0.6, y - s * 0.5); ctx.lineTo(x - s * 0.6, y + s * 0.6); ctx.moveTo(x + s * 0.6, y - s * 0.5); ctx.lineTo(x + s * 0.6, y + s * 0.6); break;
            case 'ammo': ctx.arc(x, y - s * 0.2, s * 0.45, Math.PI, 0); ctx.lineTo(x + s * 0.45, y + s * 0.6); ctx.lineTo(x - s * 0.45, y + s * 0.6); ctx.closePath(); break;
            case 'tower': ctx.rect(x - s * 0.2, y - s * 0.3, s * 0.4, s * 1.2); ctx.rect(x - s * 0.55, y - s, s * 1.1, s * 0.7); break;
            case 'power': ctx.moveTo(x + s * 0.2, y - s); ctx.lineTo(x - s * 0.4, y + s * 0.1); ctx.lineTo(x + s * 0.3, y + s * 0.1); ctx.lineTo(x - s * 0.2, y + s); break;
            default: ctx.moveTo(x - s * 0.8, y + s * 0.4); ctx.lineTo(x + s * 0.8, y + s * 0.4); ctx.arc(x - s * 0.45, y + s * 0.4, s * 0.25, 0, Math.PI * 2); ctx.moveTo(x + s * 0.7, y + s * 0.4); ctx.arc(x + s * 0.45, y + s * 0.4, s * 0.25, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.restore();
    }

    drawMarks(ctx) {
        const war = this.game.war, P = {};
        ctx.save();
        for (const d of war.designations) {
            const p = d.unit ? (d.unit.team === war.side ? d.unit.pos : war.recs.get(d.unit)?.lastPos || d.unit.pos) : d.fixed || d.pos;
            this.toScreen(p.x, p.z, P);
            ctx.strokeStyle = '#5dffa0'; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(P.x - 12, P.y); ctx.lineTo(P.x - 4, P.y); ctx.moveTo(P.x + 4, P.y); ctx.lineTo(P.x + 12, P.y);
            ctx.moveTo(P.x, P.y - 12); ctx.lineTo(P.x, P.y - 4); ctx.moveTo(P.x, P.y + 4); ctx.lineTo(P.x, P.y + 12); ctx.stroke();
            ctx.fillStyle = '#5dffa0'; ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.textAlign = 'left';
            ctx.fillText('M' + d.id + (d.transmitted ? ' ✓' : ''), P.x + 10, P.y - 10);
        }
        ctx.restore();
    }

    drawPlayer(ctx) {
        const g = this.game;
        const p = this.focusPos();
        if (!p) return;
        const P = this.toScreen(p.x, p.z);
        const v = g.pilotMode ? { x: -Math.sin(g.pilotMode.yaw || 0), z: -Math.cos(g.pilotMode.yaw || 0) } : g.player.vel;
        ctx.save();
        ctx.translate(P.x, P.y); ctx.rotate(Math.atan2(v.x, -v.z));
        ctx.fillStyle = '#5dffa0'; ctx.strokeStyle = '#0b1118'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
    }

    // ── the selection panel (right) with its actions ──
    drawPanel(ctx) {
        const g = this.game, war = g.war, sel = this.sel;
        const W = 330, x = this.w - W - 16;
        let y = 16;
        const lines = [], actions = [];
        const add = (t, c = '#e8f4ff', f = '600 12px') => lines.push({ t, c, f });
        if (sel && sel.kind === 'unit') {
            const u = sel.unit, r = war.recs.get(u);
            if (!r) { this.sel = null; return; }
            const own = r.team === war.side;
            add(war.label(u), own ? BLUE : r.known >= INTEL.IDENTIFIED ? RED : UNK, '700 15px');
            add((own ? 'FRIENDLY' : r.team === 'neutral' ? 'NEUTRAL' : 'HOSTILE') + ' · ' + r.cls.toUpperCase());
            if (!own) add('INTEL: ' + INTEL_NAMES[r.known] + (r.source ? ' (' + r.source.toUpperCase() + ')' : ''), '#9fd4ff');
            const pos = own ? u.pos : r.lastPos;
            add('GRID ' + war.grid(pos.x, pos.z) + ' · ' + Math.round(pos.y) + ' M');
            if (!own) add('LAST SEEN ' + (war.time - r.lastSeen < 5 ? 'NOW' : Math.round(war.time - r.lastSeen) + ' S AGO'));
            if (!u.alive) add('DESTROYED', '#9fb2c4');
            else if (own || r.known >= INTEL.IDENTIFIED) { const hp = (u.hp ?? u.health), mx = (u.maxHp ?? u.maxHealth); if (hp != null && mx) add('CONDITION ' + Math.round(clamp(hp / mx, 0, 1) * 100) + '%'); }
            if (r.hardened > 0.5) add('HARDENED TARGET — USE A HARDENED STRIKE', '#ffd24a');
            if (!own && u.alive) {
                actions.push({ label: 'MARK TARGET', run: () => war.designate(u, 'map') });
                actions.push({ label: this.strikeMenu ? 'STRIKE ▾' : 'STRIKE ▸', run: () => { this.strikeMenu = !this.strikeMenu; } });
            }
        } else if (sel && sel.kind === 'mark') {
            const d = sel.mark;
            add('MARK ' + d.id + ' — ' + d.label, '#5dffa0', '700 15px');
            add('GRID ' + d.grid);
            add(d.transmitted ? 'TRANSMITTED TO COMMAND' : 'NOT YET TRANSMITTED', '#9fd4ff');
            actions.push({ label: 'TRANSMIT', enabled: !d.transmitted, run: () => war.transmit([d]) });
            actions.push({ label: this.strikeMenu ? 'STRIKE ▾' : 'STRIKE ▸', run: () => { this.strikeMenu = !this.strikeMenu; } });
            actions.push({ label: 'CLEAR MARK', run: () => { war.undesignate(d); this.sel = null; } });
        } else if (sel && sel.kind === 'report') {
            const rp = sel.report;
            add('INTELLIGENCE REPORT', UNK, '700 15px');
            add(rp.text);
            add('SEARCH AREA ' + (rp.radius / 1000).toFixed(1) + ' KM · GRID ' + war.grid(rp.center.x, rp.center.z));
        } else if (sel && sel.kind === 'point') {
            add('GRID ' + war.grid(sel.pos.x, sel.pos.z), '#e8f4ff', '700 15px');
            add(war.sideAt(sel.pos.x, sel.pos.z) === 'red' ? 'ENEMY TERRITORY' : 'FRIENDLY TERRITORY', war.sideAt(sel.pos.x, sel.pos.z) === 'red' ? RED : BLUE);
            actions.push({ label: 'MARK POINT', run: () => { const d = war.designate({ x: sel.pos.x, z: sel.pos.z }, 'map'); this.sel = { kind: 'mark', mark: d }; } });
        } else if (!sel) {
            add('TACTICAL MAP', '#9fd4ff', '700 15px');
            add('CLICK A UNIT OR THE GROUND');
            add('DRAG: PAN · WHEEL: ZOOM · F: CENTRE ON YOU');
            add('` OR ESC: CLOSE');
        }
        // what the plug-ins know about the selection (lines, and pictures: BDA imagery), and what they can do with it
        const pics = [];
        for (const s of g.systems || []) if (s.mapInfo && sel) { try { for (const it of s.mapInfo(sel) || []) { if (it.image) pics.push(it); else add(it.text, it.color, it.font); } } catch (e) { console.warn('[tacmap]', e); } }
        for (const s of g.systems || []) if (s.mapActions && sel) { try { actions.push(...(s.mapActions(sel) || [])); } catch (e) { console.warn('[tacmap]', e); } }
        // strike types for the selection (it's marked first)
        if (this.strikeMenu && sel && (sel.kind === 'unit' || sel.kind === 'mark')) {
            for (const [key, T] of Object.entries(STRIKE_TYPES)) {
                if (key === 'multi') continue;
                actions.push({
                    label: '  ' + T.label, run: () => {
                        const d = sel.kind === 'mark' ? sel.mark : war.designate(sel.unit, 'map');
                        war.transmit([d]);
                        g.strikes && g.strikes.request(key, [d]);
                        this.strikeMenu = false;
                    },
                });
            }
        }
        const picH = (p) => Math.round((W - 24) * p.image.height / p.image.width) + (p.caption ? 18 : 6);
        const H = 20 + lines.length * 18 + pics.reduce((s, p) => s + picH(p), 0) + actions.length * 26 + (actions.length ? 10 : 0);
        ctx.save();
        ctx.fillStyle = 'rgba(6,12,18,0.82)'; ctx.strokeStyle = 'rgba(111,180,255,0.45)';
        ctx.fillRect(x, y, W, H); ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        y += 18;
        for (const l of lines) { ctx.font = l.f + ' "Share Tech Mono", monospace'; ctx.fillStyle = l.c; ctx.fillText(l.t, x + 12, y, W - 24); y += 18; }
        for (const p of pics) {
            const ih = picH(p) - (p.caption ? 18 : 6);
            ctx.drawImage(p.image, x + 12, y - 6, W - 24, ih);
            ctx.strokeStyle = 'rgba(111,180,255,0.35)'; ctx.strokeRect(x + 12.5, y - 5.5, W - 25, ih - 1);
            if (p.caption) { ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.fillStyle = 'rgba(159,212,255,0.75)'; ctx.fillText(p.caption, x + 12, y + ih + 3, W - 24); }
            y += picH(p);
        }
        y += 6;
        for (const a of actions) {
            const hov = this.mouse && this.mouse.x >= x + 8 && this.mouse.x <= x + W - 8 && this.mouse.y >= y - 11 && this.mouse.y <= y + 11;
            ctx.fillStyle = a.enabled === false ? 'rgba(111,180,255,0.08)' : hov ? 'rgba(111,180,255,0.35)' : 'rgba(111,180,255,0.16)';
            ctx.fillRect(x + 8, y - 11, W - 16, 22);
            ctx.fillStyle = a.enabled === false ? 'rgba(232,244,255,0.35)' : '#e8f4ff'; ctx.font = '600 12px "Share Tech Mono", monospace';
            ctx.fillText(a.label, x + 16, y, W - 32);
            this.buttons.push({ x: x + 8, y: y - 11, w: W - 16, h: 22, run: a.run, enabled: a.enabled, label: a.label });
            y += 26;
        }
        ctx.restore();
    }

    drawLegend(ctx) {
        const g = this.game, war = g.war;
        const known = war.units.filter(u => { const r = war.recs.get(u); return r.team !== war.side && r.team !== 'neutral' && r.known >= INTEL.CONTACT && u.alive; }).length;
        ctx.save();
        ctx.font = '600 11px "Share Tech Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const lines = [
            ['TACTICAL MAP · ' + (g.clockText ? g.clockText() : ''), '#9fd4ff'],
            ['KNOWN HOSTILE CONTACTS: ' + known, RED],
            ['MARKS: ' + war.designations.length + ' · INTEL AREAS: ' + war.reports.filter(r => !r.resolved).length, '#e8f4ff'],
        ];
        const y0 = this.h - 16 - lines.length * 16;
        ctx.fillStyle = 'rgba(6,12,18,0.7)'; ctx.fillRect(12, y0 - 12, 330, lines.length * 16 + 10);
        lines.forEach(([t, c], i) => { ctx.fillStyle = c; ctx.fillText(t, 20, y0 + i * 16); });
        ctx.restore();
    }
}
