// ═══════════════════════════════════════════════════════════════
// HUD: single 2D canvas overlay drawn every frame
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, MS_TO_KTS, M_TO_FT, DEG, interceptTime, G } from './util.js';
import { WEAPONS } from './config.js';
import { terrainHeight } from './world.js';

const GREEN = '#5dffa0';
const GREEN_DIM = 'rgba(93,255,160,0.55)';
const RED = '#ff4a3d';
const AMBER = '#ffc23f';
const BLUE = '#5ab8ff';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _h = new THREE.Vector3();

export class HUD {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
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
    }

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

        this.drawScreenEffects(game);
        if (game.hideHud) return;
        if (game.pilotMode) { this.drawPilotMode(game); return; }
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
        const vdir = _v3.copy(p.vel).normalize();
        const fpm = this.projectDir(p.speed > 5 ? p.vel.clone().normalize() : fwd.clone(), cam, {});
        const hdgDir = new THREE.Vector3(vdir.x, 0, vdir.z);
        if (hdgDir.lengthSq() < 1e-4) hdgDir.set(fwd.x, 0, fwd.z);
        hdgDir.normalize();
        const side = new THREE.Vector3(-hdgDir.z, 0, hdgDir.x);
        const up = new THREE.Vector3(0, 1, 0);
        const cx = fpm.x, cy = fpm.y;
        const inArea = (x, y) => x > area.x - 50 && x < area.x + area.w + 50 && y > area.y - 50 && y < area.y + area.h + 50;
        ctx.strokeStyle = GREEN; ctx.fillStyle = GREEN;
        const tmp1 = {}, tmp2 = {};
        const scale = Math.min(this.w, this.h) / 900;
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
        ctx.fillText((p.afterburner ? 'AB ' : 'THR ') + Math.round(p.throttle * 100) + '%', lx, ly + 48);
        // readouts under altitude
        ctx.textAlign = 'right';
        const agl = (p.pos.y - Math.max(terrainHeight(p.pos.x, p.pos.z), 0)) * M_TO_FT;
        if (agl < 2500) ctx.fillText('R ' + Math.round(agl), rx, ly);
        ctx.fillText('VS ' + Math.round(p.vel.y * 196.85), rx, ly + 16);
        if (p.gear) ctx.fillText('GEAR DN', rx, ly + 32);
        if (p.airbrake) ctx.fillText('BRAKE', rx, ly + 48);
        if (p.flaps) ctx.fillText('FLAPS ' + (p.flaps === 1 ? 'HALF' : 'FULL'), rx, ly + 64);
        if (game.settings.fuel !== false && game.mode !== 'sandbox') {
            ctx.fillStyle = p.fuel < 0.1 ? RED : p.fuel < 0.2 ? AMBER : GREEN;
            ctx.fillText('FUEL ' + Math.round(p.fuel * 100) + '%', lx + 80, ly);
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
    drawTargets(game) {
        const ctx = this.ctx, cam = game.camera;
        const p = game.pilotMode ? { pos: cam.position, team: 'blue', isProxy: true } : game.player;
        const list = [];
        for (const a of game.aircraft) if (a !== p && a !== game.player && a.alive) list.push(a);
        if (game.pilotMode && game.player && game.player.alive && game.player.abandoned) list.push(game.player);
        if (game.ground) for (const t of game.ground.targets) if (t.alive) list.push(t);
        const tmp = {};
        for (const a of list) {
            const P = this.project(a.pos, cam, tmp);
            const dist = a.pos.distanceTo(p.pos);
            const locked = a === game.lockTarget;
            const friendly = a.team === p.team;
            if (!P.front || P.x < -20 || P.x > this.w + 20 || P.y < -20 || P.y > this.h + 20) {
                if (locked || (!friendly && dist < 4000 && !a.isGround)) this.edgeArrow(P, locked ? RED : AMBER, dist);
                continue;
            }
            if (a.isGround && !a.isShip && dist > 9000 && !locked) continue;
            const size = clamp(3000 / Math.max(dist, 1) * (a.isGround ? 1.2 : 1), 10, 36);
            ctx.lineWidth = locked ? 2.2 : 1.5;
            if (friendly) {
                ctx.strokeStyle = BLUE; ctx.fillStyle = BLUE;
                ctx.beginPath();
                ctx.moveTo(P.x - size * 0.7, P.y - size * 0.4); ctx.lineTo(P.x, P.y + size * 0.4); ctx.lineTo(P.x + size * 0.7, P.y - size * 0.4);
                ctx.stroke();
                ctx.textAlign = 'center';
                ctx.fillText(a.abandoned ? 'YOUR JET' : a.callsign, P.x, P.y - size * 0.4 - 10);
                if (game.pilotMode) ctx.fillText(Math.round(dist) + 'm', P.x, P.y + size * 0.4 + 12);
                continue;
            }
            const col = locked ? RED : a.isGround ? AMBER : a.isAce ? '#ffd23f' : '#ff9f5a';
            ctx.strokeStyle = col; ctx.fillStyle = col;
            if (a.isGround) {
                ctx.beginPath();
                ctx.moveTo(P.x, P.y - size); ctx.lineTo(P.x + size, P.y); ctx.lineTo(P.x, P.y + size); ctx.lineTo(P.x - size, P.y); ctx.closePath();
                ctx.stroke();
            } else {
                // corner brackets
                const s = size, c = s * 0.45;
                ctx.beginPath();
                for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                    ctx.moveTo(P.x + sx * s, P.y + sy * (s - c)); ctx.lineTo(P.x + sx * s, P.y + sy * s); ctx.lineTo(P.x + sx * (s - c), P.y + sy * s);
                }
                ctx.stroke();
            }
            ctx.textAlign = 'center';
            const label = a.isGround ? a.name : a.isAce ? '★ ' + a.callsign : a.pilotDead ? 'NO PILOT — E' : (a.spec.name.split(' ')[0]);
            ctx.fillText(label, P.x, P.y - size - 10);
            ctx.fillText(dist < 1000 ? Math.round(dist) + 'm' : (dist / 1000).toFixed(1) + 'km', P.x, P.y + size + 11);
            // health pip
            const hp = a.health / a.maxHealth;
            if (hp < 1) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(P.x - size, P.y + size + 20, size * 2, 3);
                ctx.fillStyle = col; ctx.fillRect(P.x - size, P.y + size + 20, size * 2 * hp, 3);
            }
            if (locked) {
                const lk = game.lockProgress;
                const r = size + 10;
                if (lk >= 1) {
                    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(Math.PI / 4 + this.t * 0.8);
                    ctx.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
                    ctx.restore();
                    ctx.fillText('LOCK', P.x, P.y - size - 24);
                } else if (lk > 0) {
                    ctx.beginPath(); ctx.arc(P.x, P.y, r, -Math.PI / 2, -Math.PI / 2 + lk * Math.PI * 2); ctx.stroke();
                }
            }
        }
        // missile seeker circle drifting to the target
        if (game.seeker && game.seeker.visible && p.alive) {
            ctx.strokeStyle = game.lockProgress >= 1 ? RED : GREEN;
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(game.seeker.x, game.seeker.y, 30, 0, Math.PI * 2); ctx.stroke();
        }
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
        const W = this.w, H = this.h;
        ctx.textBaseline = 'middle';
        // bottom-left: airframe
        const hp = clamp(p.health / p.maxHealth, 0, 1);
        const col = hp > 0.5 ? GREEN : hp > 0.25 ? AMBER : RED;
        ctx.fillStyle = GREEN_DIM; ctx.textAlign = 'left';
        ctx.font = '600 11px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillText(p.spec.name.toUpperCase(), 28, H - 64);
        ctx.fillText('HULL', 28, H - 46);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(66, H - 51, 180, 9);
        ctx.fillStyle = col; ctx.fillRect(66, H - 51, 180 * hp, 9);
        ctx.strokeStyle = GREEN_DIM; ctx.lineWidth = 1; ctx.strokeRect(66, H - 51, 180, 9);
        ctx.fillStyle = col; ctx.fillText(Math.round(hp * 100) + '%', 254, H - 46);

        // bottom-right: weapons (gun + selectable stores)
        const rx = W - 28;
        const rows = [['GUN', p.spec.gun ? p.ammo : '—', p.spec.gun ? p.spec.gun.name : 'NO GUN', false]];
        const SL = [['SRM', 'missiles'], ['LRM', 'lrm'], ['RKT', 'rockets'], ['BMB', 'bombs']];
        SL.forEach(([lab, key], i) => rows.push([lab, p[key] ?? 0, '', (game.slot || 0) === i]));
        rows.push(['FLR', p.flares, '', false]);
        let yy = H - 30 - (rows.length - 1) * 26;
        for (const [lab, val, sub, sel] of rows) {
            ctx.textAlign = 'right';
            ctx.font = '700 20px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = val === 0 ? RED : sel ? AMBER : GREEN;
            ctx.fillText(String(val), rx, yy);
            ctx.font = '600 11px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = sel ? AMBER : GREEN_DIM;
            ctx.fillText((sel ? '▶ ' : '') + lab + (sub ? '  ' + sub : ''), rx - 58, yy);
            yy += 26;
        }

        // top-right: score
        ctx.textAlign = 'right';
        ctx.fillStyle = GREEN;
        ctx.font = '700 26px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillText(String(Math.floor(game.score)).padStart(6, "0"), W - 28, 34);
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = GREEN_DIM;
        let line = 'KILLS ' + game.kills;
        if (game.mode !== 'freeflight' && game.mode !== 'strike') line += '   WAVE ' + game.wave;
        ctx.fillText(line, W - 28, 58);
        if (game.combo > 1) {
            ctx.fillStyle = AMBER;
            ctx.font = '700 16px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillText('x' + game.combo + ' COMBO', W - 28, 80);
        }
        // top-left: objective
        ctx.textAlign = 'left';
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = GREEN_DIM;
        if (game.objective) ctx.fillText(game.objective, 28, 34);
        ctx.fillText('T+' + game.clockText() + (game.lives !== Infinity && game.lives != null ? '   SPARE JETS ' + game.lives : ''), 28, 52);
    }

    drawRadar(game) {
        const ctx = this.ctx;
        const pm = game.pilotMode;
        const p = pm ? { pos: pm.pos, getForward: (o) => pm.viewDir(o) } : game.player;
        const R = 78, cx = this.w / 2, cy = this.h - R - 22;
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
        if (game.ground) for (const t of game.ground.targets) if (t.alive) plot(t.pos, t.team === 'blue' ? BLUE : AMBER, 'dia', t.isShip ? 4.5 : 2.5);
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
        // kill feed (right, under score)
        ctx.textAlign = 'right';
        ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
        let y = 112;
        for (const m of game.feed) {
            const age = game.time - m.t;
            const a = clamp(1 - (age - 4) / 1, 0, 1);
            if (a <= 0) continue;
            ctx.globalAlpha = a;
            ctx.fillStyle = m.color || GREEN;
            ctx.fillText(m.text, this.w - 28, y);
            y += 18;
        }
        ctx.globalAlpha = 1;
        // centre banner
        const b = game.banner;
        if (b && game.time - b.t < b.dur) {
            const age = game.time - b.t;
            const a = clamp(Math.min(age * 4, (b.dur - age) * 2), 0, 1);
            ctx.globalAlpha = a;
            ctx.textAlign = 'center';
            ctx.fillStyle = b.color || GREEN;
            ctx.font = '700 34px "Rajdhani", "Share Tech Mono", sans-serif';
            ctx.fillText(b.text, this.w / 2, this.h * 0.1);
            if (b.sub) {
                ctx.font = '600 15px "Share Tech Mono", ui-monospace, monospace';
                ctx.fillText(b.sub, this.w / 2, this.h * 0.1 + 32);
            }
            ctx.globalAlpha = 1;
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
        ctx.font = '700 22px "Share Tech Mono", ui-monospace, monospace';
        let y = this.h * 0.68;
        const warn = (txt, col) => { ctx.fillStyle = col; ctx.fillText(txt, this.w / 2, y); y += 28; };
        if (p.incoming.length && blink) warn('▲ MISSILE ▲', RED);
        else if (p.lockedBy && p.lockedBy.size && blink) warn('LOCKED ON', AMBER);
        if (game.pullUp && blink) warn('PULL UP', RED);
        if (p.stalling && blink) warn('STALL', AMBER);
        if (p.flameout && blink) warn('FLAMEOUT — GLIDE TO BASE', RED);
        else if (p.fuel < 0.2 && game.settings.fuel !== false && game.mode !== 'sandbox' && blink) warn(p.fuel < 0.1 ? 'FUEL LOW' : 'BINGO FUEL', AMBER);
        if (!p.onGround && p.gearAnim > 0.5 && p.speed > 170 && blink) warn('GEAR OVERSPEED', AMBER);
        if (game.outOfBounds && blink) warn('RETURN TO COMBAT AREA', AMBER);
        if (p.onGround && p.speed < 4) {
            ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = GREEN;
            const msg = p.deck ? 'FULL THROTTLE (SHIFT) TO FIRE THE CATAPULT' : 'SHIFT: THROTTLE UP · ←/→: STEER · S: ROTATE AT ' + Math.round(game.rotateSpeed * MS_TO_KTS) + ' KTS · SPACE: BRAKES';
            ctx.fillText(msg, this.w / 2, this.h * 0.8);
            if (game.atFriendlyPad(p)) ctx.fillText('STOPPED ON A FRIENDLY PAD: REPAIR · REFUEL · REARM  (L: CHANGE LOADOUT)', this.w / 2, this.h * 0.8 + 20);
        }
    }

    // ── Ejected pilot HUD ──
    drawPilotMode(game) {
        const ctx = this.ctx, W = this.w, H = this.h, pm = game.pilotMode;
        ctx.font = '600 13px "Share Tech Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        this.drawTargets(game);
        this.drawRadar(game);
        this.drawMessages(game);
        // crosshair
        const cx = W / 2, cy = H / 2, gap = 6 + pm.recoil * 300;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - gap - 10, cy); ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + 10, cy);
        ctx.moveTo(cx, cy - gap - 10); ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + 10);
        ctx.stroke();
        if (game.time - game.hitmarkerT < 0.15) {
            ctx.strokeStyle = game.time - game.killmarkerT < 0.4 ? RED : '#fff';
            ctx.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx * 5, cy + sy * 5); ctx.lineTo(cx + sx * 13, cy + sy * 13); }
            ctx.stroke();
        }
        // ammo & health
        ctx.textAlign = 'right';
        ctx.font = '700 30px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = pm.mag > 5 ? '#fff' : RED;
        ctx.fillText(pm.reloadT > 0 ? 'RELOADING' : pm.mag + ' / ' + pm.reserve, W - 28, H - 40);
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('AK-47 · 7.62mm', W - 28, H - 70);
        ctx.textAlign = 'left';
        ctx.fillStyle = pm.health > 50 ? '#fff' : RED;
        ctx.font = '700 22px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillText('♥ ' + Math.max(0, Math.round(pm.health)), 28, H - 40);
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        const agl = pm.pos.y - Math.max(terrainHeight(pm.pos.x, pm.pos.z), 0);
        ctx.fillText((pm.seat.landed ? 'ON THE GROUND' : pm.seat.deployed ? 'CANOPY OPEN' : 'SEAT FIRING') + ' · ' + Math.round(agl * M_TO_FT) + ' FT', 28, H - 70);
        ctx.fillText('SCORE ' + Math.floor(game.score) + (game.lives !== Infinity ? '   SPARE JETS ' + game.lives : ''), 28, 34);
        // hint
        if (pm.hint) {
            ctx.textAlign = 'center';
            ctx.font = '700 16px "Share Tech Mono", ui-monospace, monospace';
            ctx.fillStyle = AMBER;
            ctx.fillText(pm.hint, W / 2, H * 0.66);
        }
    }

    drawScreenEffects(game) {
        const ctx = this.ctx, W = this.w, H = this.h;
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
