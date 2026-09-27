// ═══════════════════════════════════════════════════════════════
// On-foot weapon HUD (drawn by hud.js drawPilotMode):
//   • a crosshair for each kind of weapon, opening up with the spread (movement, bloom, hip vs sights):
//     rifle lines, a pistol's dot and ticks, the shotgun's pattern ring, the RPG-7's range stadia (worked out
//     from the rocket's own ballistics), and the grenade's throw arc with a ring where it will land
//   • hitmarkers (body, headshot, kill), red arcs toward whoever just hit you
//   • the weapon panel: name and calibre, rounds in the magazine / in reserve, the reload bar, fire mode,
//     and the 1–7 slots with the current one lit
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { SLOTS, weaponDef, spreadFor, ROCKET, stepRocket, throwVelocity, stepGrenade } from './arsenal.js';

const RED = '#ff4a3d', AMBER = '#ffc23f';
const SHORT = { ak47: 'AK-47', m4a1: 'M4A1', m870: '870', m9: 'M9', deagle: 'DEAGLE', rpg7: 'RPG-7', m67: 'M67' };
const MODE = { auto: 'AUTO', semi: 'SEMI', pump: 'PUMP', single: 'SINGLE', throw: 'THROWN' };
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = {};

// the RPG-7's drop below the line of the tube at 100…500 m (rad), from the rocket's own flight model
let rpgDrop = null;
function rpgStadia() {
    if (rpgDrop) return rpgDrop;
    const r = { pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, -ROCKET.launch), age: 0, dist: 0 };
    rpgDrop = [];
    let next = 100;
    for (let i = 0; i < 2000 && next <= 500; i++) {
        stepRocket(r, 1 / 120);
        if (-r.pos.z >= next) { rpgDrop.push([next, Math.atan2(-r.pos.y, -r.pos.z)]); next += 100; }
    }
    return rpgDrop;
}

export function drawWeaponHud(hud, ctx, game, pm, W, H, C, M, mono) {
    const cx = W / 2, cy = H / 2;
    const gun = pm.gun, def = gun.def;
    const fovY = (game.camera.fov || 70) * Math.PI / 180;
    const px = (ang) => Math.tan(ang) / Math.tan(fovY / 2) * (H / 2); // an angle off the centre → pixels
    const ads = pm.adsK || 0;
    const fp = !pm.thirdPerson;
    if (pm.alive && !pm.switching) {
        const spread = spreadFor(def, gun, pm.stance());
        const gap = Math.max(3, px(spread)) + pm.recoil * 200;
        const alpha = fp ? 0.9 * (1 - ads) : 0.9 - ads * 0.3; // down the sights (first person) the sights do it
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        if (alpha > 0.03) {
            if (def.type === 'shotgun') {
                ctx.beginPath(); ctx.arc(cx, cy, gap, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.fill();
            } else if (def.type === 'launcher') {
                // a chevron, and range marks below it for 100–500 m
                ctx.beginPath(); ctx.moveTo(cx - 9, cy + 7); ctx.lineTo(cx, cy); ctx.lineTo(cx + 9, cy + 7); ctx.stroke();
                ctx.font = '600 10px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'left';
                for (const [m, a] of rpgStadia()) {
                    const y = cy + px(a);
                    ctx.beginPath(); ctx.moveTo(cx - 6, y); ctx.lineTo(cx + 6, y); ctx.stroke();
                    ctx.fillText(String(m / 100), cx + 9, y);
                }
            } else if (def.type === 'grenade') {
                ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.stroke();
            } else {
                const len = def.type === 'pistol' ? 7 : 10;
                ctx.beginPath();
                ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
                ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
                ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
                if (def.type !== 'pistol') { ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap); }
                ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, def.type === 'pistol' ? 1.8 : 1.2, 0, Math.PI * 2); ctx.fill();
            }
        }
        // the grenade's arc while you hold it, and where it'll come down
        const st = pm.throwState;
        if (st && (st.phase === 'pull' || st.phase === 'hold') && game.ordnance) drawThrowArc(hud, ctx, game, pm);
    }
    // hitmarker: white on a hit, gold for the head, red on a kill
    const hm = game.time - game.hitmarkerT;
    if (hm < 0.2) {
        const kill = game.time - game.killmarkerT < 0.45;
        const head = game.hitKind === 'head';
        ctx.strokeStyle = kill ? RED : head ? '#ffd54a' : '#ffffff';
        ctx.lineWidth = kill ? 3 : 2;
        const a = kill ? 17 : 12, b = 5;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx * b, cy + sy * b); ctx.lineTo(cx + sx * a, cy + sy * a); }
        ctx.stroke();
    }
    // damage direction: an arc toward whoever hit you (fading)
    const R = Math.min(W, H) * 0.14;
    for (const h of pm.hurt || []) {
        const age = game.time - h.t;
        if (age > 1.6) continue;
        const rel = Math.atan2(Math.sin(h.bearing - pm.yaw), Math.cos(h.bearing - pm.yaw)); // + = to the left
        const ang = -Math.PI / 2 - rel; // canvas: 0 = right, -π/2 = up
        ctx.strokeStyle = `rgba(255,50,30,${0.85 * (1 - age / 1.6)})`;
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(cx, cy, R, ang - 0.28, ang + 0.28); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, R + 7, ang - 0.12, ang + 0.12); ctx.stroke();
    }
    // ── the weapon panel (bottom right) ──
    ctx.textAlign = 'right';
    const y0 = H - (C ? 26 : 40);
    const shown = pm.switching ? weaponDef(pm.switching.to) : def;
    const g = pm.switching ? pm.guns[pm.switching.to] : gun;
    mono('700', C ? 24 : 32);
    const low = g.mag <= Math.max(1, Math.round(shown.mag * 0.25));
    ctx.fillStyle = low ? RED : '#fff';
    const magTxt = shown.type === 'grenade' ? String(g.mag + g.reserve) : String(g.mag);
    const magW = ctx.measureText(magTxt).width;
    const resTxt = shown.type === 'grenade' ? '' : ' / ' + g.reserve;
    mono('600', C ? 14 : 18);
    const resW = ctx.measureText(resTxt).width;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(resTxt, W - M, y0 + 3);
    mono('700', C ? 24 : 32);
    ctx.fillStyle = low ? RED : '#fff';
    ctx.fillText(magTxt, W - M - resW, y0);
    void magW;
    mono('600', C ? 10 : 12);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(shown.long + '  ·  ' + MODE[shown.fire], W - M, y0 - (C ? 22 : 30));
    // reloading: a bar under the name
    if (g.reloading && !pm.switching) {
        const bw = C ? 110 : 150, bx = W - M - bw, by = y0 - (C ? 36 : 48);
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx, by, bw, 5);
        ctx.fillStyle = AMBER; ctx.fillRect(bx, by, bw * g.reloadProgress, 5);
        ctx.fillText(g.reload.kind === 'shell' ? 'LOADING SHELLS' : 'RELOADING', W - M, by - 9);
    } else if (g.mag === 0 && g.reserve === 0 && shown.type !== 'grenade') {
        ctx.fillStyle = RED; ctx.fillText('NO AMMO — 1–7 / WHEEL TO SWITCH', W - M, y0 - (C ? 40 : 52));
    }
    // the slots
    const sw = C ? 40 : 52, sh = C ? 16 : 19, gapS = 4;
    const sy = y0 - (C ? 64 : 82), sx0 = W - M - SLOTS.length * (sw + gapS) + gapS;
    ctx.textAlign = 'center';
    mono('600', C ? 9 : 10);
    SLOTS.forEach((id, i) => {
        const x = sx0 + i * (sw + gapS);
        const cur = id === (pm.switching ? pm.switching.to : pm.weaponId);
        const gg = pm.guns[id], empty = gg.total === 0;
        ctx.fillStyle = cur ? 'rgba(255,194,63,0.28)' : 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, sy - sh / 2, sw, sh);
        ctx.strokeStyle = cur ? AMBER : 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, sy - sh / 2 + 0.5, sw - 1, sh - 1);
        ctx.fillStyle = empty ? 'rgba(255,255,255,0.3)' : cur ? '#fff' : 'rgba(255,255,255,0.75)';
        ctx.fillText((i + 1) + ' ' + SHORT[id], x + sw / 2, sy);
    });
}

// the throw arc: the grenade's own flight from the hand, projected, and a ring on the ground where it lands
function drawThrowArc(hud, ctx, game, pm) {
    const cam = game.camera;
    const hand = pm.muzzleWorld(_v.set(0, 0, 0)) || pm.headPos(_v);
    const g = { pos: hand.clone(), vel: throwVelocity(pm.viewDir(_d), new THREE.Vector3(), pm.vel), fuse: 9, rest: false, bounces: 0 };
    const env = game.ordnance.env;
    ctx.fillStyle = 'rgba(255,230,160,0.85)';
    let last = null;
    for (let i = 0; i < 70 && !g.rest; i++) {
        const before = g.bounces || 0;
        stepGrenade(g, 1 / 30, env);
        if (i % 2) continue;
        const P = hud.project(g.pos, cam, _p);
        if (P.front) { ctx.beginPath(); ctx.arc(P.x, P.y, 2.2, 0, Math.PI * 2); ctx.fill(); }
        if ((g.bounces || 0) > before && !last) last = g.pos.clone();
    }
    const land = last || g.pos;
    // a ring on the ground (a flat circle, projected)
    ctx.strokeStyle = 'rgba(255,200,90,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
        const a = k / 24 * Math.PI * 2, P = hud.project(_v.set(land.x + Math.cos(a) * 1.2, land.y + 0.1, land.z + Math.sin(a) * 1.2), cam, _p);
        if (!P.front) { ctx.beginPath(); continue; }
        if (k === 0) ctx.moveTo(P.x, P.y); else ctx.lineTo(P.x, P.y);
    }
    ctx.stroke();
}
