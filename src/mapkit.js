// ═══════════════════════════════════════════════════════════════
// Map kit (a war plug-in for the tactical map, tacmap.js): the tools a pilot's moving map has.
//  • a tool strip: the legend of symbols, a range and bearing ruler from your jet, MARK BY COORDINATES (type a grid
//    reference, "KD 412 883": war.parseGrid), and layer toggles (threat rings, intel areas, roads, units, labels)
//  • the cursor's grid reference, elevation, and bearing and range from you, always
//  • SET STEERPOINT on anything (the HUD's nav cue, game.navTarget), SLAVE TGP HERE
//  • the radar picture: air tracks with a heading vector and their altitude (thousands of feet) as the sensors last
//    had them (sensors.js track file); the targeting pod's line of sight and SPI
//  • battle damage imagery (sensors.js): a camera mark where it was taken; the picture and the result in the panel
//    when the mark, the unit or the picture is selected
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight } from './world.js';
import { INTEL } from './war.js';
import { clamp, MS_TO_KTS, M_TO_FT } from './util.js';

const FONT = '"Share Tech Mono", monospace';
const BLUE = '#6fb4ff', RED = '#ff5a4a', UNK = '#ffd24a', GREEN = '#5dffa0';
const LAYERS = [['threats', 'THREATS'], ['intel', 'INTEL'], ['roads', 'ROADS'], ['units', 'UNITS'], ['labels', 'LABELS'], ['weather', 'WEATHER']]; // (weather: weathersys.js)
const P = { x: 0, y: 0 }, Q = { x: 0, y: 0 };

export class MapKit {
    constructor(game) {
        this.game = game;
        this.legend = false;
        this.ruler = false;
        this.input = null;
        this.msg = null;
    }

    start() { this.closeCoords(); }
    clear() { this.closeCoords(); }

    update() {
        const map = this.game.tacmap;
        if (this.input && this.input.style.display !== 'none' && (!map || !map.open)) this.closeCoords();
    }

    // ═════════════ Drawing ═════════════
    drawMap(ctx, map) {
        const g = this.game;
        ctx.save();
        ctx.textBaseline = 'middle';
        if (map.layers.units) this.drawAirTracks(ctx, map);
        this.drawImageryMarks(ctx, map);
        this.drawSteerpoint(ctx, map);
        this.drawPod(ctx, map);
        if (this.ruler) this.drawRuler(ctx, map);
        this.drawCursor(ctx, map);
        this.drawTools(ctx, map);
        if (this.legend) this.drawLegend(ctx, map);
        ctx.restore();
        void g;
    }

    // air tracks: a heading vector a minute long (capped) and the altitude in thousands of feet, as last seen
    drawAirTracks(ctx, map) {
        const g = this.game, war = g.war, S = g.sensors;
        const now = war.time;
        ctx.font = '600 10px ' + FONT;
        for (const u of war.units) {
            const r = war.recs.get(u);
            if ((r.cls !== 'aircraft' && r.cls !== 'helicopter') || u === g.player || !map.visibleUnit(r)) continue;
            const own = r.team === war.side;
            if (!u.alive && !own) continue;
            const t = S && S.tracks.get(u);
            const pos = own ? u.pos : r.lastPos, vel = own || !t ? u.vel : t.vel;
            if (!vel || (!own && u.onGround)) continue;
            map.toScreen(pos.x, pos.z, P);
            if (P.x < -40 || P.y < -40 || P.x > map.w + 40 || P.y > map.h + 40) continue;
            const stale = !own && now - r.lastSeen > 20;
            const col = own ? BLUE : r.team === 'neutral' ? '#cfd8e0' : r.known >= INTEL.IDENTIFIED ? RED : UNK;
            const sp = Math.hypot(vel.x, vel.z);
            const len = clamp(sp * 60 * map.scale, 8, 70);
            ctx.globalAlpha = stale ? 0.4 : 0.9;
            ctx.strokeStyle = col; ctx.lineWidth = 1.2;
            if (sp > 5) {
                ctx.beginPath(); ctx.moveTo(P.x + vel.x / sp * 8, P.y + vel.z / sp * 8); ctx.lineTo(P.x + vel.x / sp * (8 + len), P.y + vel.z / sp * (8 + len)); ctx.stroke();
            }
            const alt = own ? u.pos.y : t ? t.alt : pos.y;
            ctx.fillStyle = col; ctx.textAlign = 'left';
            ctx.fillText(String(Math.max(0, Math.round(alt * M_TO_FT / 1000))), P.x + 9, P.y + 10);
            ctx.globalAlpha = 1;
        }
    }

    drawImageryMarks(ctx, map) {
        const S = this.game.sensors;
        if (!S) return;
        for (const im of S.imagery) {
            map.toScreen(im.pos.x, im.pos.z, P);
            const sel = map.sel && map.sel.img === im;
            ctx.save();
            ctx.translate(P.x - 16, P.y + 12);
            // a camera
            ctx.fillStyle = sel ? '#ffffff' : 'rgba(159,212,255,0.92)'; ctx.strokeStyle = '#0b1118'; ctx.lineWidth = 1;
            ctx.fillRect(-7, -4, 14, 9); ctx.strokeRect(-7, -4, 14, 9);
            ctx.fillRect(-3, -6.5, 5, 3);
            ctx.fillStyle = '#0b1118'; ctx.beginPath(); ctx.arc(0, 0.5, 2.6, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    }

    drawSteerpoint(ctx, map) {
        const n = this.game.navTarget;
        if (!n || !n.pos) return;
        map.toScreen(n.pos.x, n.pos.z, P);
        ctx.strokeStyle = GREEN; ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; ctx[k ? 'lineTo' : 'moveTo'](P.x + Math.cos(a) * 9, P.y + Math.sin(a) * 9); }
        ctx.closePath(); ctx.stroke();
        ctx.fillStyle = GREEN; ctx.font = '700 11px ' + FONT; ctx.textAlign = 'left';
        ctx.fillText(n.label || 'STPT', P.x + 13, P.y + 12);
        // from you to it
        const f = this.game.tacmap.focusPos();
        if (f) {
            map.toScreen(f.x, f.z, Q);
            ctx.globalAlpha = 0.5; ctx.setLineDash([2, 6]);
            ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(P.x, P.y); ctx.stroke();
            ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
    }

    // the targeting pod: its line of sight to the SPI
    drawPod(ctx, map) {
        const S = this.game.sensors, p = this.game.player;
        if (!S || !S.pod || !S.pod.on || !S.pod.hasSpi || !p) return;
        const pod = S.pod;
        map.toScreen(p.pos.x, p.pos.z, Q); map.toScreen(pod.spi.x, pod.spi.z, P);
        ctx.strokeStyle = 'rgba(233,242,234,0.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(P.x, P.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(P.x, P.y - 7); ctx.lineTo(P.x + 7, P.y); ctx.lineTo(P.x, P.y + 7); ctx.lineTo(P.x - 7, P.y); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = 'rgba(233,242,234,0.9)'; ctx.font = '600 10px ' + FONT; ctx.textAlign = 'left';
        ctx.fillText('TGP ' + pod.mode, P.x + 10, P.y - 9);
    }

    drawRuler(ctx, map) {
        const m = map.mouse, f = map.focusPos();
        if (!m || !f) return;
        const w = map.toWorld(m.x, m.y);
        const br = this.game.war.bearingRange(f, w);
        map.toScreen(f.x, f.z, Q);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(m.x, m.y); ctx.stroke();
        // range rings every 5 or 10 km along it
        const step = br.km > 60 ? 20 : br.km > 25 ? 10 : 5;
        ctx.globalAlpha = 0.5;
        for (let k = step; k < br.km; k += step) {
            const t = k / br.km;
            ctx.beginPath(); ctx.arc(Q.x + (m.x - Q.x) * t, Q.y + (m.y - Q.y) * t, 2.5, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        const p = this.game.player;
        const gs = p && !this.game.pilotMode ? Math.hypot(p.vel.x, p.vel.z) : 0;
        const ete = gs > 20 ? br.km * 1000 / gs : 0;
        const txt = String(br.brg).padStart(3, '0') + '° · ' + br.km.toFixed(1) + ' KM · ' + (br.km / 1.852).toFixed(1) + ' NM' + (ete ? ' · ETE ' + Math.floor(ete / 60) + ':' + String(Math.round(ete % 60)).padStart(2, '0') : '');
        ctx.font = '700 12px ' + FONT;
        const tw = ctx.measureText(txt).width;
        const lx = clamp(m.x + 14, 8, map.w - tw - 16), ly = m.y - 16;
        ctx.fillStyle = 'rgba(6,12,18,0.85)'; ctx.fillRect(lx - 5, ly - 10, tw + 10, 20);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.fillText(txt, lx, ly);
    }

    // the cursor's grid, elevation, and bearing / range from you
    drawCursor(ctx, map) {
        const m = map.mouse, f = map.focusPos(), war = this.game.war;
        if (!m) return;
        const w = map.toWorld(m.x, m.y);
        const h = Math.max(terrainHeight(w.x, w.z), 0);
        let txt = war.grid(w.x, w.z) + ' · ' + Math.round(h * M_TO_FT).toLocaleString('en-US') + ' FT';
        if (f) { const br = war.bearingRange(f, w); txt += ' · ' + String(br.brg).padStart(3, '0') + '° ' + br.km.toFixed(1) + ' KM FROM YOU'; }
        // (top centre: between the tool strip and the panel, clear of the map's own labels at the bottom)
        ctx.font = '600 12px ' + FONT;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(6,12,18,0.8)'; ctx.fillRect(map.w / 2 - tw / 2 - 8, 14, tw + 16, 22);
        ctx.strokeStyle = 'rgba(111,180,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(map.w / 2 - tw / 2 - 7.5, 14.5, tw + 15, 21);
        ctx.fillStyle = '#cfe6ff'; ctx.textAlign = 'center';
        ctx.fillText(txt, map.w / 2, 25);
        if (this.msg && this.game.time - this.msg.t < 3) {
            ctx.font = '700 13px ' + FONT; ctx.fillStyle = this.msg.color;
            ctx.fillText(this.msg.text, map.w / 2, 50);
        }
    }

    // the tool strip (top left): tools, then the layers
    drawTools(ctx, map) {
        const L = map.layers;
        let x = 16, y = 16;
        const btn = (label, on, run, w) => {
            ctx.font = '600 11px ' + FONT;
            const bw = w || ctx.measureText(label).width + 16;
            const hov = map.mouse && map.mouse.x >= x && map.mouse.x <= x + bw && map.mouse.y >= y && map.mouse.y <= y + 22;
            ctx.fillStyle = on ? 'rgba(111,180,255,0.42)' : hov ? 'rgba(111,180,255,0.26)' : 'rgba(6,12,18,0.8)';
            ctx.fillRect(x, y, bw, 22);
            ctx.strokeStyle = on ? 'rgba(159,212,255,0.9)' : 'rgba(111,180,255,0.45)'; ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, 21);
            ctx.fillStyle = on ? '#ffffff' : '#cfe6ff'; ctx.textAlign = 'left';
            ctx.fillText(label, x + 8, y + 11.5);
            map.buttons.push({ x, y, w: bw, h: 22, run });
            x += bw + 6;
        };
        btn('LEGEND', this.legend, () => { this.legend = !this.legend; });
        btn('RULER', this.ruler, () => { this.ruler = !this.ruler; });
        btn('MARK BY COORDINATES', this.input && this.input.style.display !== 'none', () => this.openCoords(map));
        this.coordsAt = { x: x - 6, y };
        x = 16; y += 28;
        for (const [k, label] of LAYERS) btn(label, L[k], () => { L[k] = !L[k]; });
    }

    drawLegend(ctx, map) {
        const x = 16, y0 = 76, rows = LEGEND_ROWS, W = 250, lh = 19;
        ctx.fillStyle = 'rgba(6,12,18,0.86)'; ctx.fillRect(x, y0, W, rows.length * lh + 30);
        ctx.strokeStyle = 'rgba(111,180,255,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y0 + 0.5, W - 1, rows.length * lh + 29);
        ctx.font = '700 12px ' + FONT; ctx.fillStyle = '#9fd4ff'; ctx.textAlign = 'left';
        ctx.fillText('LEGEND', x + 10, y0 + 14);
        rows.forEach(([kind, text], i) => {
            const cy = y0 + 32 + i * lh, sx = x + 22;
            ctx.save();
            this.legendSymbol(ctx, map, kind, sx, cy);
            ctx.restore();
            ctx.font = '600 11px ' + FONT; ctx.fillStyle = '#dbe9f6'; ctx.textAlign = 'left';
            ctx.fillText(text, x + 46, cy);
        });
    }

    legendSymbol(ctx, map, kind, x, y) {
        ctx.lineWidth = 1.5;
        const diamond = (s) => { ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.stroke(); };
        switch (kind) {
            case 'friend': ctx.strokeStyle = BLUE; ctx.strokeRect(x - 8, y - 5.5, 16, 11); map.glyph(ctx, 'tank', x, y, 4.5); break;
            case 'hostile': ctx.strokeStyle = RED; diamond(8); map.glyph(ctx, 'sam', x, y, 4.4); break;
            case 'unknown': ctx.strokeStyle = UNK; ctx.fillStyle = UNK; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke(); ctx.font = '700 11px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('?', x, y + 0.5); break;
            case 'stale': ctx.globalAlpha = 0.45; ctx.strokeStyle = RED; diamond(8); ctx.fillStyle = RED; ctx.font = '600 9px ' + FONT; ctx.textAlign = 'left'; ctx.fillText('4 MIN', x + 10, y); break;
            case 'dead': ctx.strokeStyle = RED; ctx.globalAlpha = 0.6; diamond(8); ctx.globalAlpha = 1; ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke(); break;
            case 'air': {
                ctx.save(); ctx.translate(x - 4, y); ctx.rotate(Math.PI / 2); ctx.fillStyle = RED;
                ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
                ctx.strokeStyle = RED; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + 16, y); ctx.stroke();
                ctx.fillStyle = RED; ctx.font = '600 9px ' + FONT; ctx.textAlign = 'left'; ctx.fillText('25', x - 2, y + 9); break;
            }
            case 'mark': ctx.strokeStyle = GREEN; ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 9); ctx.stroke(); break;
            case 'sam': ctx.strokeStyle = 'rgba(255,90,74,0.8)'; ctx.fillStyle = 'rgba(255,60,40,0.12)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
            case 'radar': ctx.strokeStyle = 'rgba(255,200,80,0.7)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); break;
            case 'intel': ctx.strokeStyle = UNK; ctx.fillStyle = 'rgba(255,210,74,0.1)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
            case 'bda': ctx.strokeStyle = UNK; ctx.strokeRect(x - 6, y - 6, 12, 12); break;
            case 'photo': ctx.fillStyle = 'rgba(159,212,255,0.92)'; ctx.fillRect(x - 7, y - 4, 14, 9); ctx.fillRect(x - 3, y - 6.5, 5, 3); ctx.fillStyle = '#0b1118'; ctx.beginPath(); ctx.arc(x, y + 0.5, 2.6, 0, Math.PI * 2); ctx.fill(); break;
            case 'stpt': ctx.strokeStyle = GREEN; ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 7, y + Math.sin(a) * 7); } ctx.closePath(); ctx.stroke(); break;
            case 'tgp': ctx.strokeStyle = 'rgba(233,242,234,0.9)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 2, y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x + 7, y - 5); ctx.lineTo(x + 12, y); ctx.lineTo(x + 7, y + 5); ctx.lineTo(x + 2, y); ctx.closePath(); ctx.stroke(); break;
            case 'missile': ctx.strokeStyle = 'rgba(111,180,255,0.8)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#bfe0ff'; ctx.beginPath(); ctx.arc(x - 12, y, 3, 0, Math.PI * 2); ctx.fill(); break;
            case 'source': ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); break;
            case 'front': ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(255,90,74,0.85)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.stroke(); ctx.strokeStyle = 'rgba(111,180,255,0.7)'; ctx.lineWidth = 1.2; ctx.lineDashOffset = 5; ctx.stroke(); break;
            case 'you': ctx.fillStyle = GREEN; ctx.strokeStyle = '#0b1118'; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 6, y + 7); ctx.lineTo(x, y + 3); ctx.lineTo(x - 6, y + 7); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
        }
    }

    // ═════════════ Coordinates ═════════════
    openCoords(map) {
        if (!this.input) {
            const el = document.createElement('input');
            el.type = 'text'; el.spellcheck = false; el.autocomplete = 'off'; el.placeholder = 'GRID: KD 412 883';
            Object.assign(el.style, {
                position: 'fixed', zIndex: '41', width: '210px', padding: '5px 8px', outline: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                font: '600 14px "Share Tech Mono", ui-monospace, monospace', color: '#e8f4ff', background: 'rgba(6,12,18,0.94)', border: '1px solid rgba(111,180,255,0.8)',
            });
            el.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') this.submitCoords();
                else if (e.key === 'Escape') this.closeCoords();
            });
            document.body.appendChild(el);
            this.input = el;
        }
        const el = this.input;
        if (el.style.display !== 'none' && el.style.display !== '') { this.closeCoords(); return; }
        const at = this.coordsAt || { x: 300, y: 16 };
        el.style.left = (at.x + 6) + 'px'; el.style.top = at.y + 'px';
        el.style.display = 'block'; el.style.borderColor = 'rgba(111,180,255,0.8)';
        el.value = '';
        setTimeout(() => el.focus(), 0);
        void map;
    }

    closeCoords() {
        if (this.input) { this.input.style.display = 'none'; this.input.blur(); }
    }

    submitCoords() {
        const g = this.game, war = g.war, map = g.tacmap, el = this.input;
        const at = war.parseGrid(el.value);
        if (!at) {
            el.style.borderColor = '#ff5a4a';
            this.msg = { text: 'NOT A GRID REFERENCE — FORMAT: KD 412 883', color: '#ff9f5a', t: g.time };
            g.audio.tick(300, 0.08, 0.05);
            return;
        }
        const d = war.designate({ x: at.x, z: at.z }, 'coords');
        if (map) { map.sel = { kind: 'mark', mark: d }; map.view.cx = at.x; map.view.cz = at.z; }
        this.msg = { text: 'MARK ' + d.id + ' AT ' + d.grid, color: GREEN, t: g.time };
        this.closeCoords();
    }

    // ═════════════ Selection ═════════════
    mapPick(x, y, map) {
        const S = this.game.sensors;
        if (!S) return null;
        for (let i = S.imagery.length - 1; i >= 0; i--) {
            const im = S.imagery[i];
            map.toScreen(im.pos.x, im.pos.z, P);
            if (Math.abs(x - (P.x - 16)) < 10 && Math.abs(y - (P.y + 12)) < 8) return { kind: 'imagery', img: im };
        }
        return null;
    }

    // a point for any selection
    selPos(sel) {
        if (sel.kind === 'point') return sel.pos;
        if (sel.kind === 'unit') { const r = this.game.war.recs.get(sel.unit); return r && r.team !== this.game.war.side ? r.lastPos : sel.unit.pos; }
        if (sel.kind === 'mark') return sel.mark.unit ? sel.mark.unit.pos : sel.mark.fixed || sel.mark.pos;
        if (sel.kind === 'report') return sel.report.center;
        if (sel.kind === 'imagery') return sel.img.pos;
        return null;
    }

    mapActions(sel) {
        const g = this.game, war = g.war, out = [];
        const pos = this.selPos(sel);
        if (!pos) return out;
        const label = sel.kind === 'unit' ? war.label(sel.unit) : sel.kind === 'mark' ? 'M' + sel.mark.id : sel.kind === 'report' ? 'SEARCH AREA' : 'STPT';
        out.push({
            label: 'SET STEERPOINT', run: () => {
                const y = pos.y > 0 ? pos.y : Math.max(terrainHeight(pos.x, pos.z), 0);
                g.navTarget = { pos: new THREE.Vector3(pos.x, y, pos.z), label: 'STPT ' + label, steer: true };
                war.radio('', 'STEERPOINT: ' + label + ' — GRID ' + war.grid(pos.x, pos.z), { color: GREEN, say: false });
            },
        });
        if (g.navTarget && g.navTarget.steer) out.push({ label: 'CLEAR STEERPOINT', run: () => { g.navTarget = null; } });
        const S = g.sensors;
        if (S && S.hasPod(g.player) && !g.pilotMode && sel.kind !== 'report') {
            const unit = sel.kind === 'unit' ? sel.unit : sel.kind === 'mark' ? sel.mark.unit : null;
            out.push({ label: 'SLAVE TGP HERE', run: () => S.slaveTo(unit && unit.alive ? unit : { x: pos.x, y: pos.y > 0 ? pos.y : undefined, z: pos.z }) });
        }
        return out;
    }

    // the panel: the air track's numbers, and the BDA imagery of this unit / mark
    mapInfo(sel) {
        const g = this.game, war = g.war, S = g.sensors, out = [];
        if (!S) return out;
        if (sel.kind === 'unit') {
            const r = war.recs.get(sel.unit), t = S.tracks.get(sel.unit);
            if (t && r && (r.cls === 'aircraft' || r.cls === 'helicopter') && sel.unit.alive) {
                const own = r.team === war.side, v = own ? sel.unit.vel : t.vel, alt = own ? sel.unit.pos.y : t.alt;
                const hdg = Math.round(((Math.atan2(v.x, -v.z) * 57.2958) + 360) % 360);
                const age = own ? 0 : war.time - t.t;
                out.push({ text: 'TRACK: ' + Math.round(alt * M_TO_FT).toLocaleString('en-US') + ' FT · HDG ' + String(hdg).padStart(3, '0') + ' · ' + Math.round(Math.hypot(v.x, v.y, v.z) * MS_TO_KTS) + ' KT' + (age > 4 ? ' · ' + Math.round(age) + ' S AGO' : ''), color: '#9fd4ff' });
            }
        }
        const imgs = sel.kind === 'imagery' ? [sel.img]
            : sel.kind === 'mark' ? S.imagery.filter(im => im.mark === sel.mark || (sel.mark.unit && im.unit === sel.mark.unit))
                : sel.kind === 'unit' ? S.imagery.filter(im => im.unit === sel.unit) : [];
        const im = imgs[imgs.length - 1];
        if (im) {
            if (sel.kind === 'imagery') out.push({ text: 'BDA IMAGERY — ' + (im.label || 'STRIKE ' + (im.strike ? im.strike.id : '')), color: '#9fd4ff', font: '700 15px' });
            out.push({ text: im.result, color: /DESTROYED/.test(im.result) ? GREEN : '#ffd24a', font: '700 12px' });
            out.push({ image: im.canvas, caption: im.source + ' · ' + im.clock + ' · T+' + im.mission + ' · ' + im.grid + (imgs.length > 1 ? ' · 1 OF ' + imgs.length : '') });
        }
        return out;
    }
}

const LEGEND_ROWS = [
    ['you', 'YOUR JET'], ['friend', 'FRIENDLY UNIT'], ['hostile', 'HOSTILE, IDENTIFIED'], ['unknown', 'UNIDENTIFIED CONTACT'],
    ['stale', 'LAST KNOWN POSITION (AGE)'], ['dead', 'DESTROYED'], ['air', 'AIR TRACK · HEADING · ALT (1000 FT)'],
    ['mark', 'MARK (M1 ✓ TRANSMITTED)'], ['sam', 'SAM / AAA THREAT RING'], ['radar', 'RADAR COVERAGE'], ['intel', 'INTEL SEARCH AREA'],
    ['bda', 'BDA REQUESTED'], ['photo', 'BDA IMAGERY (CLICK)'], ['stpt', 'STEERPOINT'], ['tgp', 'TARGETING POD LINE OF SIGHT'],
    ['missile', 'MISSILE IN FLIGHT → AIM'], ['source', 'FRIENDLY LAUNCHER (STOCK)'], ['front', 'FRONT LINE'],
];
