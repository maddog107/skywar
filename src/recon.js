// ═══════════════════════════════════════════════════════════════
// Reconnaissance (air support, airsupport.js): what each platform's sensors find, and the pictures they send.
//  • MQ-9A Reaper: loiters low (≈15,000 ft) over the search area; its sensor ball (FLIR / TV) spots what's in view
//    within ~9 km slant, identifies it after a few seconds on it and confirms it (a targetable fix) after longer;
//    carries four Hellfires (bombers.js) for the strike system's air strike
//  • RQ-4B Global Hawk: high (≈55,000 ft) and wide: its radar (SAR / moving-target indicator) finds vehicles out
//    to ~26 km through cloud and at night, and identifies the big things (sites, radars, ships)
//  • U-2S: very high (≈67,000 ft) photographic runs across an area: everything in a ~28 km swath is imaged and
//    identified once the pictures are processed (cloud hides the ground)
//  • RC-135W Rivet Joint: SIGINT — radar emitters by their emissions (ew.js: fix, then identification)
// Each finding goes to the war layer as war.reveal(unit, level, 'recon' | 'sigint'); the platforms also watch
// strikes for BDA (strikes.watchers) and their imagery joins the targeting pod's (sensors.imagery).
// ═══════════════════════════════════════════════════════════════
import { terrainHeight, BASES } from './world.js';
import { colorAt } from './terraincore.js';
import { clamp, DEG } from './util.js';

export const RECON = {
    mq9: { label: 'MQ-9A REAPER', short: 'REAPER', callsign: 'REAPER', alt: 4600, agl: 2600, speed: 92, orbitR: 3400, stay: 1500, lead: 12000,
        sensor: { range: 9500, contact: 1.5, ident: 5, confirm: 12, area: 3500, clouds: true }, imagery: 'flir', hellfires: 4 },
    rq4: { label: 'RQ-4B GLOBAL HAWK', short: 'GLOBAL HAWK', callsign: 'FORTE', alt: 16800, agl: 12000, speed: 148, orbitR: 9000, stay: 2400, lead: 25000,
        sensor: { range: 26000, contact: 4, ident: 14, confirm: 0, area: 26000, bigOnly: 8, clouds: false }, imagery: 'sar' },
    u2: { label: 'U-2S DRAGON LADY', short: 'U-2', callsign: 'DRAGON', alt: 20500, agl: 16000, speed: 185, run: 22000, swath: 14000, stay: 0, lead: 30000,
        sensor: { contact: 0, ident: 0, confirm: 0, clouds: true, process: 25 }, imagery: 'photo' },
    rc135: { label: 'RC-135W RIVET JOINT', short: 'RIVET JOINT', callsign: 'JAKE', alt: 10000, agl: 8000, speed: 205, stay: 1e9, lead: 30000, sigint: true },
};

// How long (s) a sensor has to stay on a unit to spot / identify / confirm it: slower for small or concealed
// things, faster close in. null when it can't (too far, or too small for a radar's picture).
export function reconDwell(kind, d, unit, rec) {
    const R = RECON[kind];
    if (!R || !R.sensor.range) return null;
    const s = R.sensor;
    if (d > s.range) return null;
    const conceal = (rec && rec.conceal) || unit.conceal || 0;
    const size = unit.radius || 6;
    const k = (1 + 3 * conceal) * clamp(d / s.range * 1.6, 0.6, 1.6) * clamp(7 / size, 0.6, 2);
    const ident = s.bigOnly && size < s.bigOnly && d > 10000 ? null : s.ident * k;
    return { contact: s.contact * k, ident, confirm: s.confirm ? s.confirm * k : null };
}

// is a unit inside a U-2's photo swath? (its ground track from a to b, half-width w)
export function inSwath(p, a, b, w) {
    const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1;
    const t = clamp(((p.x - a.x) * vx + (p.z - a.z) * vz) / L2, 0, 1);
    return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t)) <= w;
}

// ═════════════ Imagery ═════════════
// A sensor picture of the ground round `center` (size m across), made from the terrain itself (no second render
// pass: the terrain near a far-away drone isn't even built): shaded relief, water, roads and the units in view,
// in the platform's look — 'flir' (white-hot), 'sar' (radar: bright returns, dark water, speckle) or 'photo'
// (panchromatic). Returns a 320×240 canvas, or null without a DOM.
const W = 320, H = 240, GW = 64, GH = 48;
const _col = new Float32Array(3);
export function reconImage({ center, size = 3000, style = 'flir', units = [], roads = null, title = '', lines = [], look = null }) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx || !ctx.createImageData) return c;
    // relief on a coarse grid, then smoothed up to the picture
    const small = document.createElement('canvas');
    small.width = GW; small.height = GH;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(GW, GH);
    const cell = size / GW, x0 = center.x - size / 2, z0 = center.z - size * GH / GW / 2;
    const hs = new Float32Array((GW + 1) * (GH + 1));
    for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) hs[j * (GW + 1) + i] = terrainHeight(x0 + i * cell, z0 + j * cell);
    // (light from the north-west for a photo; the radar looks from `look` for SAR)
    let lx = -0.6, lz = -0.6;
    if (style === 'sar' && look) { const L = Math.hypot(look.x, look.z) || 1; lx = -look.x / L; lz = -look.z / L; }
    let seed = (Math.floor(center.x) * 73856093) ^ (Math.floor(center.z) * 19349663);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 8) & 0xffff) / 65536; };
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        const h = hs[j * (GW + 1) + i], hx = hs[j * (GW + 1) + i + 1] - h, hz = hs[(j + 1) * (GW + 1) + i] - h;
        const nx = -hx / cell, nz = -hz / cell, nl = Math.hypot(nx, 1, nz);
        const lambert = clamp((nx * lx + 1 * 0.55 + nz * lz) / nl / 1.1, 0, 1);
        // the land cover (the terrain's own colours): forest dark and cool, rock and bare ground warm and bright
        colorAt(x0 + i * cell, h, z0 + j * cell, 1 / nl, _col, 0);
        const r = Math.sqrt(_col[0]), gC = Math.sqrt(_col[1]), bC = Math.sqrt(_col[2]);
        const lum = 0.3 * r + 0.59 * gC + 0.11 * bC, green = clamp((gC - Math.max(r, bC)) * 4, 0, 1);
        let v;
        if (h < -0.5) v = style === 'sar' ? 0.04 + rnd() * 0.04 : style === 'flir' ? 0.16 : 0.2;
        else if (style === 'flir') v = 0.22 + (1 - green) * 0.28 + lambert * 0.16 + (rnd() - 0.5) * 0.04;
        else if (style === 'sar') v = clamp(0.1 + lambert * 0.5 + green * 0.25, 0, 1) * (0.55 + rnd() * 0.9);
        else v = lum * (0.45 + lambert * 0.75);
        const o = (j * GW + i) * 4, b = clamp(v, 0, 1) * 255;
        img.data[o] = b; img.data[o + 1] = b; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, W, H);
    const px = (x) => (x - x0) / size * W, pz = (z) => (z - z0) / (size * GH / GW) * H;
    // runways: warm concrete (FLIR), smooth and dark (radar), pale (photo)
    for (const b of BASES) {
        if (Math.abs(b.x - center.x) > size + 4000 || Math.abs(b.z - center.z) > size + 4000) continue;
        const c = Math.cos(b.heading), s = Math.sin(b.heading);
        ctx.fillStyle = style === 'flir' ? 'rgba(215,215,215,0.8)' : style === 'sar' ? 'rgba(8,8,8,0.9)' : 'rgba(205,205,198,0.85)';
        for (const rw of b.runways) {
            const cx = b.x + rw.lx * c + rw.lz * s, cz = b.z - rw.lx * s + rw.lz * c, hd = b.heading + (rw.rot || 0);
            ctx.save();
            ctx.translate(px(cx), pz(cz)); ctx.rotate(-hd);
            ctx.fillRect(-rw.w / 2 / size * W, -rw.len / 2 / size * W, rw.w / size * W, rw.len / size * W);
            ctx.restore();
        }
    }
    // roads
    if (roads) {
        ctx.strokeStyle = style === 'flir' ? 'rgba(200,200,200,0.5)' : style === 'sar' ? 'rgba(20,20,20,0.7)' : 'rgba(235,235,225,0.6)';
        ctx.lineWidth = Math.max(1, 8 / cell);
        for (const path of roads) {
            const pts = path.pts;
            if (!pts || pts.length < 2) continue;
            ctx.beginPath();
            let on = false;
            for (let k = 0; k < pts.length; k += 2) {
                const X = px(pts[k].x), Y = pz(pts[k].z);
                if (X < -40 || Y < -40 || X > W + 40 || Y > H + 40) { on = false; continue; }
                if (on) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); on = true; }
            }
            ctx.stroke();
        }
    }
    // units: hot engines white (FLIR), strong returns (SAR), dark shapes with shadows (photo); wrecks burn
    for (const u of units) {
        const X = px(u.pos.x), Y = pz(u.pos.z);
        if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) continue;
        const r = Math.max(2.4, (u.radius || 5) / size * W * 1.1);
        const dead = u.alive === false;
        if (style === 'flir') {
            // a hot engine / a fire: a bloom round the shape
            const gl = ctx.createRadialGradient(X, Y, 0, X, Y, r * 3);
            gl.addColorStop(0, 'rgba(255,255,255,0.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gl; ctx.fillRect(X - r * 3, Y - r * 3, r * 6, r * 6);
        }
        if (style === 'flir') ctx.fillStyle = dead ? 'rgba(255,255,255,0.95)' : 'rgba(250,250,250,0.9)';
        else if (style === 'sar') ctx.fillStyle = dead ? 'rgba(160,160,160,0.8)' : 'rgba(255,255,255,0.95)';
        else { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(X - r + 1.5, Y - r * 0.6 + 1.5, r * 2, r * 1.2); ctx.fillStyle = dead ? 'rgba(30,30,30,0.95)' : 'rgba(60,62,58,0.95)'; }
        ctx.fillRect(X - r, Y - r * 0.6, r * 2, r * 1.2);
        if (dead && style !== 'sar') { ctx.fillStyle = style === 'flir' ? 'rgba(255,255,255,0.35)' : 'rgba(20,20,20,0.35)'; ctx.beginPath(); ctx.arc(X, Y, r * 2.4, 0, Math.PI * 2); ctx.fill(); }
    }
    // the sensor's texture: scan lines, grain
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1);
    for (let i = 0; i < 500; i++) { const v = rnd() < 0.5 ? 0 : 255; ctx.fillStyle = `rgba(${v},${v},${v},0.07)`; ctx.fillRect(rnd() * W, rnd() * H, 1, 1); }
    // symbology
    ctx.strokeStyle = 'rgba(240,248,240,0.85)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 40, H / 2); ctx.lineTo(W / 2 - 8, H / 2); ctx.moveTo(W / 2 + 8, H / 2); ctx.lineTo(W / 2 + 40, H / 2);
    ctx.moveTo(W / 2, H / 2 - 40); ctx.lineTo(W / 2, H / 2 - 8); ctx.moveTo(W / 2, H / 2 + 8); ctx.lineTo(W / 2, H / 2 + 40);
    ctx.stroke();
    ctx.font = '600 10px "Share Tech Mono", ui-monospace, monospace'; ctx.textBaseline = 'top';
    const txt = (s, x, y, al = 'left') => { ctx.textAlign = al; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(s, x, y); ctx.fillStyle = '#eef6ee'; ctx.fillText(s, x, y); };
    txt(title, 6, 5);
    lines.forEach((l, i) => txt(l, i % 2 ? W - 6 : 6, H - 28 + Math.floor(i / 2) * 13, i % 2 ? 'right' : 'left'));
    // a scale bar
    const bar = size >= 8000 ? 2000 : size >= 3000 ? 1000 : 500;
    ctx.fillStyle = '#eef6ee'; ctx.fillRect(W - 12 - bar / size * W, 20, bar / size * W, 2);
    txt(bar >= 1000 ? bar / 1000 + ' KM' : bar + ' M', W - 12, 24, 'right');
    return c;
}

export { DEG };
