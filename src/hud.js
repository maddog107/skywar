// ═══════════════════════════════════════════════════════════════
// HUD: single 2D canvas overlay drawn every frame
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, MS_TO_KTS, M_TO_FT, DEG, interceptTime, G } from './util.js';
import { WEAPONS } from './config.js';
import { terrainHeight } from './world.js';
import { refSpeeds } from './aircraft.js';
import { AIR_TARGETS } from './softtargets.js';

const GREEN = '#5dffa0';
const GREEN_DIM = 'rgba(93,255,160,0.55)';
const RED = '#ff4a3d';
const AMBER = '#ffc23f';
const BLUE = '#5ab8ff';
const NEUTRAL = '#d4dde6'; // air traffic: helicopters, airliners

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _h = new THREE.Vector3();

export class HUD {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        // every HUD string gets a thin dark outline under it, so green/amber text stays legible over clouds and snow
        const ctx = this.ctx, fill = ctx.fillText.bind(ctx), stroke = ctx.strokeText.bind(ctx);
        ctx.fillText = (text, x, y, maxW) => {
            const lw = ctx.lineWidth, ss = ctx.strokeStyle, lj = ctx.lineJoin;
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,12,6,0.45)'; ctx.lineJoin = 'round';
            if (maxW === undefined) stroke(text, x, y); else stroke(text, x, y, maxW);
            ctx.lineWidth = lw; ctx.strokeStyle = ss; ctx.lineJoin = lj;
            if (maxW === undefined) fill(text, x, y); else fill(text, x, y, maxW);
        };
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.t = 0;
    }

    resize() {
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.w = window.innerWidth; this.h = window.innerHeight;
        this.canvas.width = this.w * this.dpr;
        this.canvas.height = this.h * this.dpr;
        this.canvas.style.width = this.w + 'px';
        this.canvas.style.height = this.h + 'px';
        // small screens (phones, small windows): a compact layout — smaller radar, panels and feed
        this.compact = this.w < 900 || this.h < 560;
        const R = Math.round(78 * clamp(Math.min(this.h / 720, this.w / 1100), 0.6, 1));
        this.radarGeom = { R, cx: this.w / 2, cy: this.h - R - (this.compact ? 14 : 22) };
    }

    touchUI() { const t = document.getElementById('touchUI'); return !!(t && t.classList.contains('show')); }

    project(p, cam, out = {}) {
        _v.copy(p).project(cam);
        out.x = (_v.x * 0.5 + 0.5) * this.w;
        out.y = (-_v.y * 0.5 + 0.5) * this.h;
        out.front = _v.z < 1 && _v.z > -1;
        // behind-camera check via view-space
        _v2.copy(p).applyMatrix4(cam.matrixWorldInverse);
        out.front = _v2.z < 0;
        out.depth = -_v2.z;
        return out;
    }

    // Direction at infinity → screen
    projectDir(dir, cam, out = {}) {
        return this.project(_v3.copy(cam.position).addScaledVector(dir, 5000), cam, out);
    }

    draw(game, dt) {
        this.t += dt;
        const ctx = this.ctx;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.w, this.h);
        const p = game.player;
        if (!p || game.state === 'menu') return;
        const cam = game.camera;
        cam.updateMatrixWorld();

        if (game.photo) {
            ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'center';
            ctx.fillText('PHOTO MODE · mouse: orbit · wheel: zoom · O: exit', this.w / 2, this.h - 18);
            return;
        }
        this.drawScreenEffects(game);
        if (game.hideHud) return;
        if (game.pilotMode) { this.drawPilotMode(game); return; }
        if (game.groundStart) { this.drawGroundStart(game); return; }
        const cockpit = game.cameraMode === 'cockpit';
        ctx.lineWidth = 1.6;
        ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle';

        if (p.alive && !game.missileCam) {
            // central HUD symbology (clipped to combiner glass in the cockpit)
            ctx.save();
            let area;
            if (cockpit && game.cockpit) {
                const r = game.cockpit.hudRect(this.w, this.h);
                area = r;
                ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
            } else {
                const W = Math.min(this.w * 0.46, 620), H = Math.min(this.h * 0.62, 520);
                area = { x: this.w / 2 - W / 2, y: this.h / 2 - H / 2, w: W, h: H };
            }
            this.drawLadder(game, area, cockpit);
            this.drawTapes(game, area, cockpit);
            ctx.restore();
            this.drawGunsight(game);
        }
        if (p.alive && !game.missileCam) this.drawControlAids(game);
        this.drawTargets(game);
        this.drawNav(game);
        this.drawThreats(game);
        this.drawPanels(game);
        if (game.cameraMode !== 'cockpit') this.drawRadar(game);
        this.drawMessages(game);
        this.drawWarnings(game);
    }

    // ── Pitch ladder, flight-path marker, boresight ──
    drawLadder(game, area, cockpit) {
        const ctx = this.ctx, p = game.player, cam = game.camera;
        const fwd = p.getForward(_h.set(0, 0, 0));
        // (projectDir uses the _v3 scratch vector: take the flight-path heading before calling it)
        const hdgDir = new THREE.Vector3(p.vel.x, 0, p.vel.z);
        const fpm = this.projectDir(p.speed > 5 ? p.vel.clone().normalize() : fwd.clone(), cam, {});
        if (hdgDir.lengthSq() < 1e-4) hdgDir.set(fwd.x, 0, fwd.z);
        hdgDir.normalize();
        const side = new THREE.Vector3(-hdgDir.z, 0, hdgDir.x);
        const up = new THREE.Vector3(0, 1, 0);
        const cx = fpm.x, cy = fpm.y;
        const inArea = (x, y) => x > area.x - 50 && x < area.x + area.w + 50 && y > area.y - 50 && y < area.y + area.h + 50;
        ctx.strokeStyle = GREEN; ctx.fillStyle = GREEN;
        const tmp1 = {}, tmp2 = {};
        const scale = Math.min(this.w, this.h) / 900;
        ctx.save();
        if (!cockpit) {
            // chase view: rungs stay in the HUD area, under the heading tape, and never run through the radar scope
            ctx.beginPath(); ctx.rect(area.x - 50, area.y + 54, area.w + 100, area.h + 46); ctx.clip();
            const rg = this.radarGeom;
            ctx.beginPath(); ctx.rect(0, 0, this.w, this.h); ctx.moveTo(rg.cx + rg.R + 10, rg.cy); ctx.arc(rg.cx, rg.cy, rg.R + 10, 0, Math.PI * 2); ctx.clip('evenodd');
        }
        for (let a = -90; a <= 90; a += 5) {
            if (a % 10 !== 0 && Math.abs(a) > 30) continue;
            const r = a * DEG;
            const d = hdgDir.clone().multiplyScalar(Math.cos(r)).addScaledVector(up, Math.sin(r));
            const P = this.projectDir(d, cam, tmp1);
            if (!P.front || !inArea(P.x, P.y)) continue;
            const Q = this.projectDir(d.clone().addScaledVector(side, 0.02), cam, tmp2);
            let dx = Q.x - P.x, dy = Q.y - P.y;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            // centre the rungs laterally on the flight path marker
            const off = (cx - P.x) * dx + (cy - P.y) * dy;
            const px = P.x + dx * off, py = P.y + dy * off;
            const half = (a === 0 ? 260 : 90) * scale, gap = 36 * scale;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(Math.atan2(dy, dx));
            ctx.lineWidth = a === 0 ? 2 : 1.6;
            if (a < 0) ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(-half, 0); ctx.lineTo(-gap, 0);
            ctx.moveTo(gap, 0); ctx.lineTo(half, 0);
            if (a !== 0) {
                const tick = a > 0 ? 8 : -8;
                ctx.moveTo(-half, 0); ctx.lineTo(-half, tick);
                ctx.moveTo(half, 0); ctx.lineTo(half, tick);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            if (a !== 0) {
                ctx.textAlign = 'center';
                ctx.fillText(String(Math.abs(a)), -half - 18, 0);
                ctx.fillText(String(Math.abs(a)), half + 18, 0);
            }
            ctx.restore();
        }
        ctx.restore();
        // flight path marker
        if (fpm.front) {
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 8, 0, Math.PI * 2);
            ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 22, cy);
            ctx.moveTo(cx + 8, cy); ctx.lineTo(cx + 22, cy);
            ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 16);
            ctx.stroke();
        }
        // boresight (gun cross)
        const bs = this.projectDir(fwd, cam, {});
        if (bs.front) {
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(bs.x - 14, bs.y); ctx.lineTo(bs.x - 5, bs.y + 7); ctx.lineTo(bs.x, bs.y);
            ctx.lineTo(bs.x + 5, bs.y + 7); ctx.lineTo(bs.x + 14, bs.y);
            ctx.stroke();
        }
        this.boresight = bs;
        void cockpit;
    }

    drawTapes(game, area, cockpit) {
        const ctx = this.ctx, p = game.player;
        const kts = p.speed * MS_TO_KTS, ft = p.pos.y * M_TO_FT;
        const fwd = p.getForward(_v2);
        const hdg = ((Math.atan2(-fwd.x, -fwd.z) / DEG) + 360) % 360;
        const lx = area.x + (cockpit ? 8 : 20), rx = area.x + area.w - (cockpit ? 8 : 20);
        const my = area.y + area.h * 0.5;
        const tapeH = Math.min(area.h * 0.55, 240);
        ctx.strokeStyle = GREEN; ctx.fillStyle = GREEN;
        ctx.lineWidth = 1.4;
        // speed tape
        this.tape(lx, my, tapeH, kts, 50, 10, 'left');
        this.valueBox(lx, my, Math.round(kts), 'left');
        // altitude tape
        this.tape(rx, my, tapeH, ft, 500, 100, 'right');
        this.valueBox(rx, my, Math.round(ft), 'right');
        // readouts under speed
        ctx.textAlign = 'left';
        ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
        const ly = my + tapeH / 2 + 18;
        ctx.fillText('M ' + p.mach.toFixed(2), lx, ly);
        ctx.fillText('G ' + p.gLoad.toFixed(1), lx, ly + 16);
        ctx.fillText('α ' + (p.alpha / DEG).toFixed(0) + '°', lx, ly + 32);
        {
            const rs = refSpeeds(p.spec);
            if (!p.onGround && (p.gearAnim > 0.5 || p.flaps)) {
                const app = rs.approach * MS_TO_KTS;
                const d = kts - app;
                ctx.fillStyle = Math.abs(d) < 15 ? GREEN : d > 0 ? AMBER : RED;
                ctx.fillText('APP ' + Math.round(app) + (d > 15 ? ' ▼' : d < -15 ? ' ▲' : ' ✓'), lx, ly + 64);
                ctx.fillStyle = GREEN;
            } else if (p.onGround && !p.bellied) {
                ctx.fillText('ROT ' + Math.round(rs.takeoff * MS_TO_KTS), lx, ly + 64);
            }
        }
        const step = p.controls.throttle >= 0.95 ? 10 : Math.round(p.controls.throttle / 0.9 * 8) + 1;
        ctx.fillText((p.afterburner ? 'AB ' : 'THR ') + Math.round(p.throttle * 100) + '%  [' + (step === 10 ? '0' : step) + ']', lx, ly + 48);
        // readouts under altitude
        ctx.textAlign = 'right';
        const agl = (p.pos.y - Math.max(terrainHeight(p.pos.x, p.pos.z), 0)) * M_TO_FT;
        if (agl < 2500) ctx.fillText('R ' + Math.round(agl), rx, ly);
        ctx.fillText('VS ' + Math.round(p.vel.y * 196.85), rx, ly + 16);
        if (p.gear) ctx.fillText('GEAR DN', rx, ly + 32);
        if (p.airbrake || p.wheelBrake) ctx.fillText(p.airbrake ? 'SPOILERS' : 'BRAKES', rx, ly + 48);
        if (p.flaps) ctx.fillText('FLAPS ' + (p.flaps === 1 ? 'HALF' : 'FULL'), rx, ly + 64);
        if (p.hook) ctx.fillText(p.trap ? 'HOOK — TRAPPED' : 'HOOK DN', rx, ly + 80);
        if (game.settings.fuel !== false && game.mode !== 'sandbox') {
            ctx.fillStyle = p.fuel < 0.1 ? RED : p.fuel < 0.2 ? AMBER : GREEN;
            ctx.textAlign = 'left';
            ctx.fillText('FUEL ' + Math.round(p.fuel * 100) + '%', lx, ly + 80);
            ctx.fillStyle = GREEN;
        }
        // heading tape
        const hy = area.y + (cockpit ? 14 : 16);
        const hw = Math.min(area.w * 0.6, 300);
        const cxh = area.x + area.w / 2;
        ctx.save();
        ctx.beginPath(); ctx.rect(cxh - hw / 2, hy - 14, hw, 36); ctx.clip();
        ctx.textAlign = 'center';
        const pxPerDeg = hw / 60;
        for (let d = Math.floor((hdg - 35) / 5) * 5; d <= hdg + 35; d += 5) {
            const x = cxh + (d - hdg) * pxPerDeg;
            const dd = ((d % 360) + 360) % 360;
            ctx.beginPath(); ctx.moveTo(x, hy + 10); ctx.lineTo(x, hy + (dd % 10 === 0 ? 2 : 6)); ctx.stroke();
            if (dd % 10 === 0) ctx.fillText(dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10).padStart(2, '0'), x, hy - 6);
        }
        ctx.restore();
        ctx.beginPath(); ctx.moveTo(cxh, hy + 12); ctx.lineTo(cxh - 5, hy + 20); ctx.lineTo(cxh + 5, hy + 20); ctx.closePath(); ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.round(hdg)).padStart(3, '0'), cxh, hy + 30);
    }

    tape(x, cy, h, value, major, minor, side) {
        const ctx = this.ctx;
        const pxPer = h / (major * 4);
        const dir = side === 'left' ? 1 : -1;
        ctx.save();
        ctx.beginPath(); ctx.rect(side === 'left' ? x - 4 : x - 70, cy - h / 2, 74, h); ctx.clip();
        ctx.textAlign = side === 'left' ? 'left' : 'right';
        const start = Math.floor((value - major * 2.2) / minor) * minor;
        for (let v = start; v < value + major * 2.2; v += minor) {
            const y = cy - (v - value) * pxPer;
            const isMajor = Math.abs(v % major) < 1e-6;
            const tx = side === 'left' ? x + 62 : x - 62;
            ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(tx - dir * (isMajor ? 10 : 5), y); ctx.stroke();
            if (isMajor && Math.abs(y - cy) > 14) ctx.fillText(String(Math.round(v)), side === 'left' ? x + 6 : x - 6, y);
        }
        ctx.restore();
    }

    valueBox(x, cy, val, side) {
        const ctx = this.ctx;
        const w = 64, h = 22;
        const bx = side === 'left' ? x : x - w;
        ctx.fillStyle = 'rgba(0,20,10,0.55)';
        ctx.fillRect(bx, cy - h / 2, w, h);
        ctx.strokeRect(bx, cy - h / 2, w, h);
        ctx.fillStyle = GREEN;
        ctx.textAlign = 'center';
        ctx.font = '700 15px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillText(String(val), bx + w / 2, cy + 1);
        ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
    }

    // ── Mouse-aim circle / mouse-stick indicator ──
    drawControlAids(game) {
        const ctx = this.ctx;
        const mode = game.settings.controlMode;
        if (mode === 'mouseaim' && !game.player.onGround) {
            const A = this.projectDir(game.aimDir, game.camera, {});
            if (!A.front) return;
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(A.x, A.y, 11, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(A.x, A.y, 1.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
            const bs = this.boresight;
            if (bs && bs.front) {
                const d = Math.hypot(A.x - bs.x, A.y - bs.y);
                if (d > 26) {
                    ctx.setLineDash([3, 6]);
                    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                    ctx.beginPath(); ctx.moveTo(bs.x + (A.x - bs.x) * 14 / d, bs.y + (A.y - bs.y) * 14 / d); ctx.lineTo(A.x - (A.x - bs.x) * 11 / d, A.y - (A.y - bs.y) * 11 / d); ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        } else if (mode === 'mousestick' && game.mouseStick) {
            const cx = this.w / 2, cy = this.h / 2, R = Math.min(this.w, this.h) * 0.3 * 0.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx - 6, cy - 6, 12, 12);
            const x = cx + game.mouseStick.x * this.w * 0.3, y = cy + game.mouseStick.y * this.h * 0.3;
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
            void R;
        }
    }

    // ── Lead-computing gun pipper + missile seeker ──
    drawGunsight(game) {
        const ctx = this.ctx, p = game.player, cam = game.camera;
        if (game.slotDef && game.slotDef.key === 'bomb' && !p.onGround) {
            const hit = game.weapons.predictBomb(p, new THREE.Vector3());
            if (hit) {
                const P = this.project(hit, cam, {});
                if (P.front) {
                    const fpm = this.projectDir(p.vel.clone().normalize(), cam, {});
                    ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
                    if (fpm.front) { ctx.beginPath(); ctx.moveTo(fpm.x, fpm.y); ctx.lineTo(P.x, P.y); ctx.stroke(); }
                    ctx.beginPath(); ctx.arc(P.x, P.y, 12, 0, Math.PI * 2); ctx.stroke();
                    ctx.beginPath(); ctx.arc(P.x, P.y, 2, 0, Math.PI * 2); ctx.fillStyle = GREEN; ctx.fill();
                    ctx.textAlign = 'left';
                    ctx.fillText('CCIP ' + Math.round(hit.distanceTo(p.pos)) + 'm', P.x + 16, P.y);
                }
            }
        }
        const t = game.lockTarget;
        if (!t || !t.alive) { this.pipperOnTarget = false; return; }
        const dist = t.pos.distanceTo(p.pos);
        if (p.spec.gun && dist < 2000 && !t.isGround) {
            const rel = _v.subVectors(t.pos, p.pos);
            const rv = _v2.subVectors(t.vel, p.vel);
            const tt = interceptTime(rel.x, rel.y, rel.z, rv.x, rv.y, rv.z, WEAPONS.bulletSpeed);
            if (tt > 0) {
                // aim point where our bullets must go to meet the target (relative motion + drop)
                const aim = new THREE.Vector3().copy(t.pos).addScaledVector(rv, tt);
                aim.y += 0.5 * G * 0.5 * tt * tt;
                // pipper = where the nose must point: offset boresight by (aim - target) error
                const P = this.project(aim, cam, {});
                if (P.front) {
                    const rad = clamp(900 / dist * 18, 10, 40);
                    const bs = this.boresight;
                    const onTgt = bs && Math.hypot(bs.x - P.x, bs.y - P.y) < rad * 0.9;
                    this.pipperOnTarget = onTgt;
                    ctx.strokeStyle = onTgt ? RED : GREEN;
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.arc(P.x, P.y, rad, 0, Math.PI * 2); ctx.stroke();
                    ctx.beginPath(); ctx.arc(P.x, P.y, 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
                    // range arc
                    const frac = clamp(1 - dist / 2000, 0, 1);
                    ctx.beginPath(); ctx.arc(P.x, P.y, rad + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
                    if (onTgt && dist < 1200) {
                        ctx.fillStyle = RED; ctx.textAlign = 'center';
                        ctx.fillText('SHOOT', P.x, P.y + rad + 16);
                    }
                }
            }
        }
    }

    // ── Target boxes (helmet-mounted, not clipped) ──
    // Every contact gets its symbol. Labels (name above, range below) are placed in priority order — the locked
    // target, hostile aircraft, friendlies, ground targets and ships, then neutral air traffic, nearest first within
    // each — and one that would overprint a label already placed is merged into it ("DESTROYER ×2"), lifted a line,
    // or left off, so a close formation or a carrier group never turns into a smear of text.
    drawTargets(game) {
        const ctx = this.ctx, cam = game.camera;
        const p = game.pilotMode ? { pos: cam.position, team: 'blue', isProxy: true } : game.player;
        const lock = game.lockTarget;
        const entries = [];
        const add = (a, kind) => entries.push({ a, kind, dist: a.pos.distanceTo(p.pos) });
        for (const a of game.aircraft) if (a !== game.player && a.alive) add(a, a.team === p.team ? 'friend' : 'air');
        if (game.pilotMode && game.player && game.player.alive && game.player.abandoned) add(game.player, 'friend');
        if (game.ground) for (const t of game.ground.targets) if (t.alive && (!t.isBridge || t.objective)) add(t, t.team === p.team ? 'friend' : 'ground');
        for (const t of AIR_TARGETS) if (t.alive && !t.done) add(t, 'neutral');
        const RANK = { air: 1, friend: 2, ground: 3, neutral: 4 };
        for (const e of entries) e.rank = e.a === lock ? 0 : RANK[e.kind];
        entries.sort((x, y) => x.rank - y.rank || x.dist - y.dist);
        const labels = [];
        const free = (x0, y0, x1, y1) => !labels.some(q => x0 < q.x1 && x1 > q.x0 && y0 < q.y1 && y1 > q.y0);
        const font = (big) => (ctx.font = (big ? '700 13px' : '600 12px') + ' "Share Tech Mono", ui-monospace, monospace');
        // place a centred label at (x, y); `merge` lets an identical one nearby absorb it; `lift` lets it move up
        const place = (text, x, y, col, big, merge, lift) => {
            font(big);
            const w = ctx.measureText(text).width / 2 + 3;
            const put = (yy) => { const L = { x0: x - w, y0: yy - 8, x1: x + w, y1: yy + 8, x, y: yy, text, col, big, n: 1 }; labels.push(L); return L; };
            if (big || free(x - w, y - 8, x + w, y + 8)) return put(y);
            if (merge) {
                const twin = labels.find(q => q.text === text && q.col === col && Math.abs(q.x - x) < 110 && Math.abs(q.y - y) < 70);
                if (twin) { twin.n++; return twin; }
            }
            if (lift) for (let k = 1; k <= 2; k++) if (free(x - w, y - k * 14 - 8, x + w, y - k * 14 + 8)) return put(y - k * 14);
            return null;
        };
        const tmp = {};
        for (const e of entries) {
            const a = e.a, dist = e.dist;
            const locked = a === lock;
            if (e.kind === 'neutral' && !locked && dist > 5000) continue;
            const P = this.project(a.pos, cam, tmp);
            if (!P.front || P.x < -20 || P.x > this.w + 20 || P.y < -20 || P.y > this.h + 20) {
                if (locked || (e.kind === 'air' && dist < 4000)) this.edgeArrow(P, locked ? RED : AMBER, dist);
                continue;
            }
            if (e.kind === 'ground' && !a.isShip && dist > 9000 && !locked) continue;
            const size = clamp(3000 / Math.max(dist, 1) * (a.isGround ? 1.2 : 1), 10, 36);
            ctx.lineWidth = locked ? 2.2 : 1.5;
            const range = dist < 1000 ? Math.round(dist) + 'm' : (dist / 1000).toFixed(1) + 'km';
            if (e.kind === 'friend') {
                ctx.strokeStyle = BLUE;
                ctx.beginPath();
                ctx.moveTo(P.x - size * 0.7, P.y - size * 0.4); ctx.lineTo(P.x, P.y + size * 0.4); ctx.lineTo(P.x + size * 0.7, P.y - size * 0.4);
                ctx.stroke();
                place(a.abandoned ? 'YOUR JET' : a.callsign || a.name || 'FRIENDLY', P.x, P.y - size * 0.4 - 10, BLUE, false, true, false);
                if (game.pilotMode) place(range, P.x, P.y + size * 0.4 + 12, BLUE, false, false, false);
                continue;
            }
            const neutral = e.kind === 'neutral';
            const col = locked ? RED : neutral ? NEUTRAL : a.isGround ? AMBER : a.isAce ? '#ffd23f' : '#ff9f5a';
            ctx.strokeStyle = col;
            if (a.isGround) {
                ctx.beginPath();
                ctx.moveTo(P.x, P.y - size); ctx.lineTo(P.x + size, P.y); ctx.lineTo(P.x, P.y + size); ctx.lineTo(P.x - size, P.y); ctx.closePath();
                ctx.stroke();
            } else if (neutral && !locked) {
                ctx.beginPath(); ctx.arc(P.x, P.y, size * 0.7, 0, Math.PI * 2); ctx.stroke(); // unknown / neutral: a plain ring
            } else {
                // corner brackets
                const s = size, c = s * 0.45;
                ctx.beginPath();
                for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                    ctx.moveTo(P.x + sx * s, P.y + sy * (s - c)); ctx.lineTo(P.x + sx * s, P.y + sy * s); ctx.lineTo(P.x + sx * (s - c), P.y + sy * s);
                }
                ctx.stroke();
            }
            const label = neutral ? a.name.toUpperCase() : a.isGround ? a.name : a.isAce ? '★ ' + a.callsign : a.pilotDead ? 'NO PILOT — E' : a.callsign !== a.spec.name ? a.callsign : (a.spec.name.split(' ')[0]);
            const top = place(label, P.x, P.y - size - 10, col, locked, true, !neutral);
            const rl = place(range, P.x, P.y + size + 11, col, locked, false, false);
            // health pip (aircraft and ground targets: health/maxHealth; air traffic: hp/maxHp)
            const hp = (a.health ?? a.hp) / (a.maxHealth ?? a.maxHp);
            if (rl && hp < 1) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(P.x - size, P.y + size + 20, size * 2, 3);
                ctx.fillStyle = col; ctx.fillRect(P.x - size, P.y + size + 20, size * 2 * clamp(hp, 0, 1), 3);
            }
            if (locked) {
                const lk = game.lockProgress;
                const r = size + 10;
                if (lk >= 1) {
                    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(Math.PI / 4 + this.t * 0.8);
                    ctx.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
                    ctx.restore();
                    if (top) place(neutral ? 'LOCK · NEUTRAL' : 'LOCK', P.x, top.y - 14, col, true, false, false);
                } else if (lk > 0) {
                    ctx.beginPath(); ctx.arc(P.x, P.y, r, -Math.PI / 2, -Math.PI / 2 + lk * Math.PI * 2); ctx.stroke();
                    if (neutral && top) place('NEUTRAL', P.x, top.y - 14, col, false, false, false);
                }
            }
        }
        ctx.textAlign = 'center';
        for (const L of labels) {
            font(L.big);
            ctx.fillStyle = L.col;
            ctx.fillText(L.n > 1 ? L.text + ' ×' + L.n : L.text, L.x, L.y);
        }
        ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
        // missile seeker circle drifting to the target
        if (game.seeker && game.seeker.visible && p.alive) {
            ctx.strokeStyle = game.lockProgress >= 1 ? RED : GREEN;
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(game.seeker.x, game.seeker.y, 30, 0, Math.PI * 2); ctx.stroke();
        }
    }

    // Waypoint / next-ring marker
    drawNav(game) {
        const n = game.navTarget, p = game.player;
        if (!n || !p) return;
        const ctx = this.ctx, cam = game.camera;
        const P = this.project(n.pos, cam, {});
        const dist = n.pos.distanceTo(game.groundStart ? game.groundStart.focus : p.pos);
        if (!P.front || P.x < 0 || P.x > this.w || P.y < 0 || P.y > this.h) { this.edgeArrow(P, '#5dffa0', dist); return; }
        ctx.strokeStyle = '#5dffa0'; ctx.lineWidth = 2;
        const r = clamp(4000 / Math.max(dist, 1), 10, 60);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; ctx[k ? 'lineTo' : 'moveTo'](P.x + Math.cos(a) * r, P.y + Math.sin(a) * r); }
        ctx.closePath(); ctx.stroke();
        ctx.fillStyle = '#5dffa0'; ctx.textAlign = 'center';
        ctx.fillText(n.label + ' · ' + (dist < 1000 ? Math.round(dist) + 'm' : (dist / 1000).toFixed(1) + 'km'), P.x, P.y - r - 12);
    }

    edgeArrow(P, col, dist) {
        const ctx = this.ctx;
        const cx = this.w / 2, cy = this.h / 2;
        let dx = P.x - cx, dy = P.y - cy;
        if (!P.front) { dx = -dx; dy = -dy; }
        const a = Math.atan2(dy, dx);
        const r = Math.min(this.w, this.h) * 0.42;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = col; ctx.textAlign = 'center';
        ctx.fillText((dist / 1000).toFixed(1), x - Math.cos(a) * 22, y - Math.sin(a) * 22);
    }

    drawThreats(game) {
        const ctx = this.ctx, p = game.player, cam = game.camera;
        if (!p.alive) return;
        const tmp = {};
        for (const m of p.incoming) {
            const P = this.project(m.pos, cam, tmp);
            const dist = m.pos.distanceTo(p.pos);
            const blink = (this.t * 6) % 1 < 0.6;
            if (P.front && P.x > 0 && P.x < this.w && P.y > 0 && P.y < this.h) {
                ctx.strokeStyle = RED; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(P.x, P.y - 14); ctx.lineTo(P.x + 12, P.y + 9); ctx.lineTo(P.x - 12, P.y + 9); ctx.closePath(); ctx.stroke();
                ctx.fillStyle = RED; ctx.textAlign = 'center';
                ctx.fillText('MSL ' + (dist / 1000).toFixed(1), P.x, P.y + 24);
            } else if (blink) {
                this.edgeArrow(P, RED, dist);
            }
        }
    }

    // ── Corner panels ──
    drawPanels(game) {
        const ctx = this.ctx, p = game.player;
        const W = this.w, H = this.h, C = this.compact;
        const mono = (w, px) => (ctx.font = w + ' ' + px + 'px "Share Tech Mono", ui-monospace, monospace');
        ctx.textBaseline = 'middle';
        const M = C ? 14 : 28; // screen margin
        // airframe: bottom-left (compact: top-left, under the objective — the touch stick lives bottom-left)
        const hp = clamp(p.health / p.maxHealth, 0, 1);
        const col = hp > 0.5 ? GREEN : hp > 0.25 ? AMBER : RED;
        ctx.fillStyle = GREEN_DIM; ctx.textAlign = 'left';
        mono('600', 11);
        const hy = C ? 64 : H - 46, bw = C ? 110 : 180;
        if (!C) ctx.fillText(p.spec.name.toUpperCase(), M, H - 64);
        ctx.fillText('HULL', M, hy);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(M + 38, hy - 5, bw, 9);
        ctx.fillStyle = col; ctx.fillRect(M + 38, hy - 5, bw * hp, 9);
        ctx.strokeStyle = GREEN_DIM; ctx.lineWidth = 1; ctx.strokeRect(M + 38, hy - 5, bw, 9);
        ctx.fillStyle = col; ctx.fillText(Math.round(hp * 100) + '%', M + 46 + bw, hy);

        // weapons: gun + selectable stores, bottom-right (compact: one line top-right, under the score)
        const rows = [['GUN', p.spec.gun ? p.ammo : '—', p.spec.gun ? p.spec.gun.name : 'NO GUN', false]];
        const SL = [['SRM', 'missiles'], ['LRM', 'lrm'], ['RKT', 'rockets'], ['BMB', 'bombs']];
        SL.forEach(([lab, key], i) => rows.push([lab, p[key] ?? 0, '', (game.slot || 0) === i]));
        rows.push(['FLR', p.flares, '', false]);
        const rx = W - M;
        if (C) {
            ctx.textAlign = 'right';
            let x = rx;
            for (let i = rows.length - 1; i >= 0; i--) {
                const [lab, val, , sel] = rows[i];
                mono('700', 12);
                ctx.fillStyle = val === 0 ? RED : sel ? AMBER : GREEN;
                ctx.fillText(String(val), x, 62);
                x -= ctx.measureText(String(val)).width + 3;
                mono('600', 10);
                ctx.fillStyle = sel ? AMBER : GREEN_DIM;
                ctx.fillText((sel ? '▶' : '') + lab, x, 62);
                x -= ctx.measureText((sel ? '▶' : '') + lab).width + 9;
            }
        } else {
            let yy = H - 30 - (rows.length - 1) * 26;
            for (const [lab, val, sub, sel] of rows) {
                ctx.textAlign = 'right';
                mono('700', 20);
                ctx.fillStyle = val === 0 ? RED : sel ? AMBER : GREEN;
                ctx.fillText(String(val), rx, yy);
                mono('600', 11);
                ctx.fillStyle = sel ? AMBER : GREEN_DIM;
                ctx.fillText((sel ? '▶ ' : '') + lab + (sub ? '  ' + sub : ''), rx - 58, yy);
                yy += 26;
            }
        }

        // top-right: score
        ctx.textAlign = 'right';
        ctx.fillStyle = GREEN;
        mono('700', C ? 20 : 26);
        ctx.fillText(String(Math.floor(game.score)).padStart(6, '0'), rx, C ? 22 : 34);
        mono('600', C ? 10 : 12);
        ctx.fillStyle = GREEN_DIM;
        let line = 'KILLS ' + game.kills;
        if (game.mode === 'dogfight' || game.mode === 'survival') line += '   WAVE ' + game.wave;
        ctx.fillText(line, rx, C ? 42 : 58);
        if (game.combo > 1) {
            ctx.fillStyle = AMBER;
            mono('700', C ? 12 : 16);
            ctx.fillText('x' + game.combo + ' COMBO', C ? rx - ctx.measureText(line).width - 70 : rx, C ? 42 : 80);
        }
        // top-left: objective, clock, spare jets, collateral
        ctx.textAlign = 'left';
        mono('600', C ? 11 : 12);
        ctx.fillStyle = GREEN_DIM;
        const maxW = C ? W * 0.55 : W * 0.5;
        if (game.objective) ctx.fillText(game.objective, M, C ? 22 : 34, maxW);
        ctx.fillText('T+' + game.clockText() + (game.lives !== Infinity && game.lives != null ? '   SPARE JETS ' + game.lives : ''), M, C ? 40 : 52);
        if (game.collateral) {
            ctx.fillStyle = '#ff9f5a';
            ctx.fillText('COLLATERAL ' + game.collateral, M + (C ? 170 : 200), C ? 40 : 52);
        }
    }

    drawRadar(game) {
        const ctx = this.ctx;
        const pm = game.pilotMode;
        const p = pm ? { pos: pm.pos, getForward: (o) => pm.viewDir(o) } : game.player;
        const { R, cx, cy } = this.radarGeom;
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(2,16,10,0.55)'; ctx.fill();
        ctx.strokeStyle = GREEN_DIM; ctx.lineWidth = 1; ctx.stroke();
        ctx.clip();
        ctx.strokeStyle = 'rgba(93,255,160,0.18)';
        ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
        // sweep
        const sw = this.t * 2.2;
        const grd = ctx.createConicGradient ? ctx.createConicGradient(sw, cx, cy) : null;
        if (grd) {
            grd.addColorStop(0, 'rgba(93,255,160,0.22)'); grd.addColorStop(0.12, 'rgba(93,255,160,0)'); grd.addColorStop(1, 'rgba(93,255,160,0)');
            ctx.fillStyle = grd; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        }
        const range = game.radarRange || 8000;
        const fwd = p.getForward(_v);
        const hdg = Math.atan2(-fwd.x, -fwd.z);
        const plot = (pos, color, shape = 'sq', size = 3) => {
            const dx = pos.x - p.pos.x, dz = pos.z - p.pos.z;
            const d = Math.hypot(dx, dz);
            const rr = Math.min(d / range, 1.05) * R;
            const brg = Math.atan2(-dx, -dz) - hdg;
            const x = cx - Math.sin(brg) * rr, y = cy - Math.cos(brg) * rr;
            ctx.fillStyle = color;
            if (shape === 'sq') ctx.fillRect(x - size, y - size, size * 2, size * 2);
            else if (shape === 'dot') { ctx.beginPath(); ctx.arc(x, y, size, 0, 6.28); ctx.fill(); }
            else if (shape === 'dia') { ctx.beginPath(); ctx.moveTo(x, y - size - 1); ctx.lineTo(x + size + 1, y); ctx.lineTo(x, y + size + 1); ctx.lineTo(x - size - 1, y); ctx.fill(); }
        };
        for (const b of game.basesInfo || []) plot(b, b.friendly ? 'rgba(90,184,255,0.7)' : 'rgba(255,160,90,0.7)', 'dia', 4);
        if (game.ground) for (const t of game.ground.targets) if (t.alive && (!t.isBridge || t.objective)) plot(t.pos, t.team === 'blue' ? BLUE : AMBER, 'dia', t.isShip ? 4.5 : 2.5);
        // neutral air traffic (helicopters, airliners): small grey contacts
        for (const t of AIR_TARGETS) if (t.alive && !t.done) plot(t.pos, t === game.lockTarget ? RED : 'rgba(212,221,230,0.75)', 'sq', t === game.lockTarget ? 3.5 : 2);
        for (const a of game.aircraft) {
            if (a === p || !a.alive) continue;
            plot(a.pos, a.team === 'blue' ? BLUE : (a === game.lockTarget ? RED : '#ff9f5a'), 'sq', a === game.lockTarget ? 4 : 3);
        }
        for (const m of game.weapons.missiles) plot(m.pos, m.target === p ? RED : 'rgba(255,255,255,0.8)', 'dot', 1.8);
        ctx.restore();
        // own ship
        ctx.fillStyle = GREEN;
        ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 5, cy + 5); ctx.lineTo(cx - 5, cy + 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = GREEN_DIM; ctx.textAlign = 'center';
        ctx.font = '600 10px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillText((range / 1000) + ' KM', cx, cy + R + 12);
    }

    drawMessages(game) {
        const ctx = this.ctx;
        const C = this.compact;
        // kill feed (right, under score; compact: under the one-line weapons readout)
        ctx.textAlign = 'right';
        ctx.font = (C ? '600 11px' : '600 13px') + ' "Share Tech Mono", ui-monospace, monospace';
        let y = C ? 82 : 112, shown = 0;
        for (const m of game.feed) {
            const age = game.time - m.t;
            const a = clamp(1 - (age - 4) / 1, 0, 1);
            if (a <= 0 || (C && shown >= 4)) continue;
            ctx.globalAlpha = a;
            ctx.fillStyle = m.color || GREEN;
            ctx.fillText(m.text, this.w - (C ? 14 : 28), y, this.w * 0.6);
            y += C ? 15 : 18; shown++;
        }
        ctx.globalAlpha = 1;
        // centre banner, on a soft dark band so it reads over bright sky
        const b = game.banner;
        if (b && game.time - b.t < b.dur) {
            const age = game.time - b.t;
            const a = clamp(Math.min(age * 4, (b.dur - age) * 2), 0, 1);
            const by = C ? this.h * 0.24 : this.h * 0.1, maxW = this.w - 40;
            ctx.globalAlpha = a;
            ctx.textAlign = 'center';
            ctx.font = (C ? '700 24px' : '700 34px') + ' "Rajdhani", "Share Tech Mono", sans-serif';
            let bw = ctx.measureText(b.text).width;
            ctx.font = (C ? '600 12px' : '600 15px') + ' "Share Tech Mono", ui-monospace, monospace';
            if (b.sub) bw = Math.max(bw, Math.min(ctx.measureText(b.sub).width, maxW));
            const bh = b.sub ? (C ? 50 : 64) : (C ? 32 : 44);
            const grd = ctx.createLinearGradient(this.w / 2 - bw / 2 - 60, 0, this.w / 2 + bw / 2 + 60, 0);
            grd.addColorStop(0, 'rgba(0,8,6,0)'); grd.addColorStop(0.15, 'rgba(0,8,6,0.32)'); grd.addColorStop(0.85, 'rgba(0,8,6,0.32)'); grd.addColorStop(1, 'rgba(0,8,6,0)');
            ctx.fillStyle = grd;
            ctx.fillRect(this.w / 2 - bw / 2 - 60, by - (C ? 18 : 24), bw + 120, bh);
            ctx.fillStyle = b.color || GREEN;
            ctx.font = (C ? '700 24px' : '700 34px') + ' "Rajdhani", "Share Tech Mono", sans-serif';
            ctx.fillText(b.text, this.w / 2, by, maxW);
            if (b.sub) {
                ctx.font = (C ? '600 12px' : '600 15px') + ' "Share Tech Mono", ui-monospace, monospace';
                ctx.fillText(b.sub, this.w / 2, by + (C ? 22 : 32), maxW);
            }
            ctx.globalAlpha = 1;
        }
        // first seconds of a sortie: the essential keys, under the banner (not on touch screens: no keyboard there)
        const tip = game.tip;
        if (tip && !game.pilotMode && !game.groundStart && !this.touchUI()) {
            const age = game.time - tip.t;
            const a = clamp(Math.min(age * 2, (tip.dur - age) / 2), 0, 1) * 0.85;
            if (a > 0) {
                ctx.globalAlpha = a;
                ctx.textAlign = 'center';
                ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
                ctx.fillStyle = '#e8eef4';
                ctx.fillText(tip.text, this.w / 2, this.h * 0.1 + 56, this.w - 40);
                ctx.globalAlpha = 1;
            }
        }
        // hitmarker
        const hm = game.time - game.hitmarkerT;
        if (hm < 0.18 && !game.pilotMode) {
            const bs = this.boresight || { x: this.w / 2, y: this.h / 2 };
            const k = game.killmarkerT > game.hitmarkerT - 0.01 && game.time - game.killmarkerT < 0.5;
            ctx.strokeStyle = k ? RED : '#ffffff';
            ctx.lineWidth = k ? 3 : 2;
            const s = k ? 16 : 10, g = 5;
            ctx.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(bs.x + sx * g, bs.y + sy * g); ctx.lineTo(bs.x + sx * s, bs.y + sy * s); }
            ctx.stroke();
        }
    }

    drawWarnings(game) {
        const ctx = this.ctx, p = game.player;
        if (!p.alive) return;
        const blink = (this.t * 3) % 1 < 0.6;
        ctx.textAlign = 'center';
        const wf = this.compact ? '700 16px "Share Tech Mono", ui-monospace, monospace' : '700 22px "Share Tech Mono", ui-monospace, monospace';
        ctx.font = wf;
        let y = this.h * 0.68;
        // warnings sit on a dark plate: they must read over anything, including target labels
        const warn = (txt, col) => {
            const w = ctx.measureText(txt).width + 18;
            ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(this.w / 2 - w / 2, y - 14, w, 28);
            ctx.fillStyle = col; ctx.fillText(txt, this.w / 2, y); y += 30;
        };
        if (p.incoming.length && blink) warn('▲ MISSILE ▲', RED);
        else if (p.lockedBy && p.lockedBy.size && blink) warn('LOCKED ON', AMBER);
        if (game.pullUp && blink) warn('PULL UP', RED);
        if (game.autopilot && game.autopilot.active) {
            ctx.font = '700 15px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = BLUE;
            ctx.fillText('AUTOPILOT · ' + game.autopilot.status, this.w / 2, this.h * 0.2, this.w - 30);
            if (game.time - (game.autopilot.warnT || -9) < 1.5) {
                const k = clamp((game.autopilot.override || 0) / 450, 0, 1);
                ctx.fillStyle = AMBER;
                ctx.fillText('AUTOPILOT ON — KEEP MOVING / HOLD A KEY TO TAKE CONTROL (Y/U: OFF NOW)', this.w / 2, this.h * 0.2 + 24, this.w - 30);
                ctx.fillRect(this.w / 2 - 120, this.h * 0.2 + 38, 240 * k, 4);
                ctx.strokeStyle = AMBER; ctx.strokeRect(this.w / 2 - 120, this.h * 0.2 + 38, 240, 4);
            }
            ctx.font = wf;
        }
        if (p.stalling && blink) warn('STALL', AMBER);
        if (p.flameout && blink) warn('FLAMEOUT — GLIDE TO BASE', RED);
        else if (p.fuel < 0.2 && game.settings.fuel !== false && game.mode !== 'sandbox' && blink) warn(p.fuel < 0.1 ? 'FUEL LOW' : 'BINGO FUEL', AMBER);
        if (!p.onGround && p.gearAnim > 0.5 && p.speed > 170 && blink) warn('GEAR OVERSPEED', AMBER);
        if (game.outOfBounds && blink) warn('RETURN TO COMBAT AREA', AMBER);
        if (p.onGround && p.speed < 4) {
            ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = GREEN;
            const msg = p.bellied ? 'CRASH LANDED — E: CLIMB OUT · ENTER: ' + (game.lives > 0 ? 'NEW JET' : game.mission ? 'END (NO JETS LEFT)' : 'END THE SORTIE') : p.speed < 0.8 && p.controls.throttle < 0.06 && !p.deck ? 'E: CLIMB OUT AND WALK · Z / 1–0: THROTTLE · U: AUTO-TAKEOFF' : p.deck ? 'FULL POWER (9 or 0) TO FIRE THE CATAPULT · U: AUTO-TAKEOFF' : 'Z / 1–0: THROTTLE · ←/→: STEER · S: ROTATE AT ' + Math.round(game.rotateSpeed * MS_TO_KTS) + ' KTS · U: AUTO-TAKEOFF';
            ctx.fillText(msg, this.w / 2, this.h * 0.8, this.w - 30);
            if (game.atFriendlyPad(p) && !p.bellied) ctx.fillText('STOPPED ON A FRIENDLY PAD: REPAIR · REFUEL · REARM  (L: CHANGE LOADOUT)', this.w / 2, this.h * 0.8 + 20, this.w - 30);
        }
    }

    // ── Ready Room: driving / walking ──
    drawGroundStart(game) {
        const ctx = this.ctx, W = this.w, H = this.h, gs = game.groundStart;
        ctx.textBaseline = 'middle';
        this.drawMessages(game);
        this.drawNav && this.drawNav(game);
        ctx.textAlign = 'left';
        ctx.font = '700 14px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = AMBER;
        ctx.fillText(game.objective || '', 28, 34);
        if (gs.state === 'drive') {
            ctx.textAlign = 'right';
            ctx.font = '700 34px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = '#fff';
            ctx.fillText(Math.round(Math.abs(gs.car.v) * 3.6) + '', W - 80, H - 44);
            ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText('KM/H', W - 28, H - 40);
            ctx.fillText(gs.car.v < -0.3 ? 'R' : 'D', W - 28, H - 70);
        }
        ctx.textAlign = 'left';
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillText(gs.state === 'drive' ? 'W/S DRIVE · A/D STEER · E GET OUT · MOUSE LOOK' : 'WASD WALK · SHIFT RUN · E INTERACT · MOUSE LOOK', 28, H - 40);
        if (gs.hint) {
            ctx.textAlign = 'center';
            ctx.font = '700 17px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = AMBER;
            ctx.fillText(gs.hint, W / 2, H * 0.7);
        }
    }

    // ── Ejected pilot HUD ──
    drawPilotMode(game) {
        const ctx = this.ctx, W = this.w, H = this.h, pm = game.pilotMode, C = this.compact;
        const M = C ? 14 : 28;
        const mono = (w, px) => (ctx.font = w + ' ' + px + 'px "Share Tech Mono", ui-monospace, monospace');
        mono('600', 13);
        ctx.textBaseline = 'middle';
        this.drawTargets(game);
        this.drawRadar(game);
        this.drawMessages(game);
        const s = pm.seat, agl = pm.pos.y - Math.max(terrainHeight(pm.pos.x, pm.pos.z), 0);
        // crosshair
        const cx = W / 2, cy = H / 2, gap = 6 + pm.recoil * 300;
        if (pm.alive) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - gap - 10, cy); ctx.lineTo(cx - gap, cy);
            ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + 10, cy);
            ctx.moveTo(cx, cy - gap - 10); ctx.lineTo(cx, cy - gap);
            ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + 10);
            ctx.stroke();
        }
        if (game.time - game.hitmarkerT < 0.15) {
            ctx.strokeStyle = game.time - game.killmarkerT < 0.4 ? RED : '#fff';
            ctx.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx * 5, cy + sy * 5); ctx.lineTo(cx + sx * 13, cy + sy * 13); }
            ctx.stroke();
        }
        // ammo (a 60-round drum: "60 / 540")
        ctx.textAlign = 'right';
        mono('700', C ? 22 : 30);
        ctx.fillStyle = pm.mag > 8 ? '#fff' : RED;
        ctx.fillText(pm.reloadT > 0 ? 'RELOADING' : pm.mag + ' / ' + pm.reserve, W - M, H - (C ? 26 : 40));
        mono('600', C ? 10 : 12);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('AK-47 · 7.62mm · DRUM', W - M, H - (C ? 48 : 70));
        // health: number + bar (red and pulsing when low, flashing right after a hit)
        const hp = clamp(pm.health / 100, 0, 1), hurt = game.time - pm.lastHitT < 0.35;
        const hc = hurt ? '#fff' : hp > 0.5 ? '#fff' : hp > 0.25 ? AMBER : RED;
        ctx.textAlign = 'left';
        mono('700', C ? 18 : 22);
        ctx.fillStyle = hc;
        const hy = H - (C ? 26 : 40);
        ctx.fillText('♥ ' + Math.max(0, Math.round(pm.health)), M, hy);
        const bx = M + (C ? 62 : 78), bw = C ? 90 : 130;
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(bx, hy - 4, bw, 8);
        ctx.fillStyle = hp > 0.5 ? '#e8eef4' : hp > 0.25 ? AMBER : RED; ctx.fillRect(bx, hy - 4, bw * hp, 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(bx, hy - 4, bw, 8);
        // status: where you are, the canopy's state
        mono('600', C ? 10 : 12);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        let status = s.landed ? 'ON THE GROUND' : s.deployed ? (pm.canopyGone ? 'CANOPY SHREDDED' : 'CANOPY ' + Math.round(pm.canopyHp / 1.5) + '%') + ' · SINK ' + Math.round(-s.vel.y * 196.85) + ' FPM' : 'SEAT FIRING';
        if (!s.landed) status += ' · ' + Math.round(agl * M_TO_FT) + ' FT';
        if (s.deployed && !s.landed && pm.canopyHp < 150) ctx.fillStyle = pm.canopyHp < 60 ? RED : AMBER;
        ctx.fillText(status, M, H - (C ? 48 : 70));
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        const keys = pm.walker ? 'WASD WALK · SHIFT RUN · LMB FIRE · R RELOAD · E BOARD A JET · V VIEW'
            : s.deployed ? 'A/D TURN · W DIVE · S BRAKE · SPACE FLARE (LOW) · LMB FIRE · V VIEW' : '';
        if (pm.alive) ctx.fillText(keys, M, H - (C ? 66 : 92), W * 0.62);
        if (pm.alive && s.deployed && !s.landed && agl < 18 && !pm.flareUsed && !pm.canopyGone && Math.floor(game.time * 3) % 2) {
            ctx.textAlign = 'center'; mono('700', 18); ctx.fillStyle = GREEN;
            ctx.fillText('SPACE — FLARE!', W / 2, H * 0.6);
        }
        ctx.textAlign = 'left'; mono('600', C ? 11 : 12); ctx.fillStyle = 'rgba(255,255,255,0.7)';
        if (game.objective && game.mission) ctx.fillText(game.objective, M, C ? 22 : 34, W * 0.55);
        ctx.fillText('SCORE ' + Math.floor(game.score) + (game.lives !== Infinity ? '   SPARE JETS ' + game.lives : ''), M, game.objective && game.mission ? (C ? 40 : 52) : (C ? 22 : 34));
        // a hostile lining up on you: get out of the way (canopy) or behind something solid (on foot)
        if (pm.alive && pm.strafeT > 0 && (this.t * 4) % 1 < 0.65) {
            ctx.textAlign = 'center'; mono('700', C ? 15 : 20);
            const txt = 'BANDIT INBOUND — ' + (s.landed ? 'TAKE COVER!' : s.deployed && !pm.canopyGone ? 'STEER! (A/D)' : 'STRAFING RUN');
            const tw = ctx.measureText(txt).width + 20, ty = H * 0.3;
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(W / 2 - tw / 2, ty - 15, tw, 30);
            ctx.fillStyle = RED; ctx.fillText(txt, W / 2, ty);
        }
        // hint
        if (pm.hint && pm.alive) {
            ctx.textAlign = 'center';
            mono('700', C ? 13 : 16);
            ctx.fillStyle = AMBER;
            ctx.fillText(pm.hint, W / 2, H * 0.66, W - 30);
        }
    }

    drawScreenEffects(game) {
        const ctx = this.ctx, W = this.w, H = this.h;
        if (game.nvg) {
            // goggle tube vignette + scanlines + sensor noise
            const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.max(W, H) * 0.62);
            g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,12,0,0.9)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = 'rgba(0,40,0,0.10)';
            for (let y = (this.t * 60) % 3; y < H; y += 3) ctx.fillRect(0, y, W, 1);
            ctx.fillStyle = 'rgba(180,255,180,0.05)';
            for (let i = 0; i < 180; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
        }
        // G-induced grey-out / red-out
        const gl = game.gloc || 0;
        if (gl > 0.01) {
            const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.55 - gl * 0.45), W / 2, H / 2, Math.max(W, H) * 0.75);
            const c = game.redout ? '60,0,0' : '0,0,0';
            grd.addColorStop(0, `rgba(${c},0)`);
            grd.addColorStop(1, `rgba(${c},${clamp(gl * 1.1, 0, 0.97)})`);
            ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
            if (gl > 0.7) { ctx.fillStyle = `rgba(${c},${(gl - 0.7) * 2.6})`; ctx.fillRect(0, 0, W, H); }
        }
        // damage flash
        const df = game.damageFlash || 0;
        if (df > 0.01) {
            const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
            grd.addColorStop(0, 'rgba(255,30,10,0)');
            grd.addColorStop(1, `rgba(255,30,10,${df * 0.55})`);
            ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
        }
        // low-health pulse
        const p = game.player;
        if (p && p.alive && p.health / p.maxHealth < 0.25) {
            const a = (Math.sin(this.t * 5) * 0.5 + 0.5) * 0.18;
            ctx.strokeStyle = `rgba(255,40,20,${a})`;
            ctx.lineWidth = 40; ctx.strokeRect(0, 0, W, H);
        }
        // cloud whiteout
        if (game.whiteout > 0.01) {
            ctx.fillStyle = `rgba(235,240,245,${clamp(game.whiteout, 0, 0.85)})`;
            ctx.fillRect(0, 0, W, H);
        }
    }
}
