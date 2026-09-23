// ═══════════════════════════════════════════════════════════════
// 3D cockpit interior (GeoFS-style): rendered in its own pass on top of the
// world with a near-clip camera, lit by the real sun direction so light and
// shadow sweep across the panel while manoeuvring. Instruments are live canvas
// textures; stick and throttle follow the pilot's inputs.
// Eye point is the origin; forward is -Z.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, damp, MS_TO_KTS, M_TO_FT, DEG } from './util.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

function canvasTex(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { c, ctx: c.getContext('2d'), tex };
}

export class Cockpit {
    constructor(renderer) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.02, 20);
        this.root = new THREE.Group();   // oriented with the aircraft
        this.scene.add(this.root);
        this.head = new THREE.Vector3();
        this.headLook = { yaw: 0, pitch: 0 };
        this.gShift = 0;
        this.enabled = false;
        this.frame = 0;

        // Lighting: sun (with shadows inside the cockpit) + sky fill + panel glow
        this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        const sc = this.sun.shadow.camera;
        sc.left = -1.5; sc.right = 1.5; sc.top = 1.5; sc.bottom = -1.5; sc.near = 0.1; sc.far = 8;
        this.sun.shadow.bias = -0.001;
        this.sun.shadow.normalBias = 0.01;
        this.scene.add(this.sun, this.sun.target);
        this.hemi = new THREE.HemisphereLight(0xbcd4ee, 0x2a2a2a, 0.9);
        this.scene.add(this.hemi);
        this.panelLight = new THREE.PointLight(0x6fa8ff, 0.0, 1.5, 2);
        this.panelLight.position.set(0, -0.2, -0.45);
        this.root.add(this.panelLight);

        this.build();
        this.scene.add(this.camera);
        this.buildRifle();
    }

    // AK-47 view model (child of the overlay camera)
    buildRifle() {
        const wood = new THREE.MeshStandardMaterial({ color: 0x7a3f1c, roughness: 0.6, metalness: 0.05 });
        const steel = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.45, metalness: 0.8 });
        const g = new THREE.Group();
        const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
        add(new THREE.BoxGeometry(0.05, 0.07, 0.34), steel, 0, 0, 0);                 // receiver
        add(new THREE.BoxGeometry(0.052, 0.03, 0.3), steel, 0, 0.045, -0.02);           // dust cover
        add(new THREE.CylinderGeometry(0.009, 0.009, 0.42, 8), steel, 0, 0.02, -0.38, Math.PI / 2); // barrel
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), steel, 0, 0.05, -0.3, Math.PI / 2);   // gas tube
        add(new THREE.BoxGeometry(0.056, 0.06, 0.2), wood, 0, 0.01, -0.26);              // handguard
        add(new THREE.BoxGeometry(0.012, 0.05, 0.012), steel, 0, 0.07, -0.55);           // front sight
        add(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8), steel, 0, 0.02, -0.61, Math.PI / 2); // muzzle
        const mag = add(new THREE.BoxGeometry(0.035, 0.2, 0.07), steel, 0, -0.12, -0.06, 0.35); // curved mag (approx)
        const mag2 = add(new THREE.BoxGeometry(0.035, 0.1, 0.07), steel, 0, -0.2, -0.1, 0.6);
        void mag; void mag2;
        add(new THREE.BoxGeometry(0.04, 0.12, 0.05), wood, 0, -0.08, 0.1, -0.3);        // pistol grip
        add(new THREE.BoxGeometry(0.045, 0.08, 0.3), wood, 0, -0.03, 0.3, 0.12);         // stock
        this.flash = new THREE.PointLight(0xffa040, 0, 3, 2);
        this.flash.position.set(0, 0.03, -0.7);
        g.add(this.flash);
        const flashTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,170,60,0.8)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
        this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3, 2.5, 2) }));
        this.muzzle.position.set(0, 0.02, -0.68);
        this.muzzle.scale.setScalar(0.18);
        g.add(this.muzzle);
        g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        g.scale.setScalar(0.62);
        g.position.set(0.2, -0.2, -0.5);
        g.rotation.y = 0.05;
        g.visible = false;
        this.camera.add(g);
        this.rifle = g;
        this.rifleKick = 0;
    }

    updateRifle(dt, game, mainCamera, world, pm) {
        this.root.visible = false;
        this.rifle.visible = true;
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.copy(mainCamera.quaternion);
        this.camera.fov = mainCamera.fov; this.camera.aspect = mainCamera.aspect;
        this.camera.updateProjectionMatrix();
        this.sun.position.copy(world.sunDir).multiplyScalar(4);
        this.sun.color.copy(world.sun.color); this.sun.intensity = world.sun.intensity * 0.8;
        this.hemi.color.copy(world.hemi.color); this.hemi.intensity = world.hemi.intensity;
        this.scene.environment = world.scene.environment;
        const firing = pm.fireT > 0.05 && pm.reloadT <= 0 && game.input.mouse.left;
        if (firing) this.rifleKick = 1;
        this.rifleKick = Math.max(0, this.rifleKick - dt * 14);
        const reload = pm.reloadT > 0 ? Math.sin(Math.min(1, (2.2 - pm.reloadT) / 2.2) * Math.PI) : 0;
        this.rifle.position.set(0.2, -0.2 - reload * 0.12, -0.5 + this.rifleKick * 0.03);
        this.rifle.rotation.set(this.rifleKick * 0.06 + reload * 0.5, 0.05, reload * 0.4);
        this.muzzle.visible = this.rifleKick > 0.6;
        this.muzzle.material.rotation = Math.random() * 6;
        this.flash.intensity = this.rifleKick > 0.6 ? 2 : 0;
        // sway while hanging under the canopy
        const t = game.time;
        this.rifle.position.x += Math.sin(t * 1.3) * 0.004;
        this.rifle.position.y += Math.cos(t * 1.7) * 0.004;
    }

    build() {
        const R = this.root;
        const matPanel = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.85, metalness: 0.15 });
        const matDark = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.7, metalness: 0.2 });
        const matFrame = new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.55, metalness: 0.5 });
        const matGrip = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
        const matSeat = new THREE.MeshStandardMaterial({ color: 0x2d3320, roughness: 0.95 });
        const add = (geo, mat, x, y, z, parent = R) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, y, z);
            m.castShadow = true; m.receiveShadow = true;
            parent.add(m);
            return m;
        };

        // ── Main instrument panel (tilted back toward the pilot) ──
        const panel = new THREE.Group();
        panel.position.set(0, -0.36, -0.72);
        panel.rotation.x = -0.28;
        R.add(panel);
        add(new THREE.BoxGeometry(0.98, 0.42, 0.04), matPanel, 0, 0, 0, panel);
        // glareshield hood
        const hood = add(new THREE.BoxGeometry(0.72, 0.035, 0.26), matDark, 0, 0.235, 0.09, panel);
        hood.rotation.x = 0.28;
        // lower centre pedestal
        add(new THREE.BoxGeometry(0.26, 0.3, 0.3), matPanel, 0, -0.33, 0.06, panel);

        // MFDs + centre display as live canvases
        this.mfdL = canvasTex(256, 256);
        this.mfdR = canvasTex(256, 256);
        this.adi = canvasTex(256, 256);
        this.ufc = canvasTex(256, 96);
        const screen = (ct, w, h, x, y, glow = 1.4) => {
            const bezel = add(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.02), matDark, x, y, 0.025, panel);
            void bezel;
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: ct.tex, toneMapped: false, color: new THREE.Color(glow, glow, glow) }));
            m.position.set(x, y, 0.037);
            panel.add(m);
            return m;
        };
        screen(this.mfdL, 0.2, 0.2, -0.3, -0.02);
        screen(this.mfdR, 0.2, 0.2, 0.3, -0.02);
        screen(this.adi, 0.17, 0.17, 0, -0.04, 1.2);
        screen(this.ufc, 0.22, 0.08, 0, 0.14, 1.3);
        // buttons around MFDs
        const btnMat = new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 0.6 });
        const btnGeo = new THREE.BoxGeometry(0.018, 0.012, 0.012);
        for (const cx of [-0.3, 0.3]) for (let i = 0; i < 5; i++) {
            const o = -0.08 + i * 0.04;
            add(btnGeo, btnMat, cx + o, 0.1, 0.03, panel);
            add(btnGeo, btnMat, cx + o, -0.14, 0.03, panel);
            add(btnGeo, btnMat, cx - 0.12, o - 0.02, 0.03, panel).rotation.z = Math.PI / 2;
            add(btnGeo, btnMat, cx + 0.12, o - 0.02, 0.03, panel).rotation.z = Math.PI / 2;
        }
        // Analogue standby gauges (bottom row)
        this.gauges = [];
        const gaugeKinds = ['asi', 'alt', 'vvi', 'g'];
        gaugeKinds.forEach((k, i) => {
            const ct = canvasTex(128, 128);
            const x = -0.3 + i * 0.2 + (i >= 2 ? 0 : 0);
            const gx = [-0.36, -0.2, 0.2, 0.36][i];
            add(new THREE.CylinderGeometry(0.052, 0.056, 0.02, 24).rotateX(Math.PI / 2), matDark, gx, -0.165, 0.025, panel);
            const face = new THREE.Mesh(new THREE.CircleGeometry(0.047, 32), new THREE.MeshBasicMaterial({ map: ct.tex, toneMapped: false }));
            face.position.set(gx, -0.165, 0.036);
            panel.add(face);
            this.gauges.push({ kind: k, ...ct });
            void x;
        });

        // Warning / caution annunciators
        this.lights = {};
        const annun = (key, label, color, x, y) => {
            const ct = canvasTex(128, 48);
            ct.ctx.fillStyle = '#111'; ct.ctx.fillRect(0, 0, 128, 48);
            ct.ctx.font = 'bold 22px Arial'; ct.ctx.textAlign = 'center'; ct.ctx.textBaseline = 'middle';
            ct.ctx.fillStyle = color; ct.ctx.fillText(label, 64, 25);
            ct.tex.needsUpdate = true;
            const mat = new THREE.MeshBasicMaterial({ map: ct.tex, toneMapped: false, color: new THREE.Color(0.12, 0.12, 0.12) });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.024), mat);
            m.position.set(x, y, 0.036);
            panel.add(m);
            this.lights[key] = { mat, on: false };
        };
        annun('master', 'MASTER', '#ffb020', -0.43, 0.17);
        annun('launch', 'LAUNCH', '#ff3020', 0.43, 0.17);
        annun('lock', 'LOCK', '#ff3020', 0.43, 0.14);
        annun('stall', 'STALL', '#ffb020', -0.43, 0.14);
        annun('ab', 'A/B', '#40ff70', -0.43, 0.11);
        annun('gear', 'GEAR', '#40ff70', 0.43, 0.11);
        annun('brake', 'BRAKE', '#ffb020', -0.43, 0.08);
        annun('fuel', 'FUEL', '#ff3020', 0.43, 0.08);

        // ── Side consoles ──
        for (const s of [-1, 1]) {
            const con = add(new THREE.BoxGeometry(0.2, 0.12, 0.9), matPanel, s * 0.36, -0.5, -0.1);
            con.rotation.z = s * -0.08;
            const ct = canvasTex(128, 512);
            this.drawConsole(ct.ctx, s);
            ct.tex.needsUpdate = true;
            const top = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.88), new THREE.MeshStandardMaterial({ map: ct.tex, roughness: 0.8 }));
            top.rotation.x = -Math.PI / 2;
            top.position.set(s * 0.36, -0.438, -0.1);
            top.receiveShadow = true;
            R.add(top);
            // cockpit sill / canopy rail
            add(new THREE.BoxGeometry(0.06, 0.05, 1.6), matFrame, s * 0.46, -0.24, -0.25);
            // side wall
            const wall = add(new THREE.BoxGeometry(0.02, 0.38, 1.5), matPanel, s * 0.5, -0.44, -0.2);
            void wall;
        }
        // floor / footwell
        add(new THREE.BoxGeometry(0.9, 0.02, 1.2), matDark, 0, -0.8, -0.3);

        // ── Throttle (left console) ──
        this.throttle = new THREE.Group();
        this.throttle.position.set(-0.33, -0.44, -0.05);
        R.add(this.throttle);
        const tArm = add(new THREE.BoxGeometry(0.025, 0.12, 0.025), matFrame, 0, 0.06, 0, this.throttle);
        void tArm;
        const tHead = add(new THREE.BoxGeometry(0.06, 0.05, 0.09), matGrip, 0.01, 0.13, 0, this.throttle);
        void tHead;

        // ── Control stick (centre) ──
        this.stick = new THREE.Group();
        this.stick.position.set(0, -0.72, -0.32);
        R.add(this.stick);
        add(new THREE.CylinderGeometry(0.014, 0.018, 0.26, 10), matFrame, 0, 0.13, 0, this.stick);
        const grip = add(new THREE.CylinderGeometry(0.022, 0.026, 0.11, 12), matGrip, 0, 0.3, 0, this.stick);
        grip.rotation.x = 0.2;
        add(new THREE.BoxGeometry(0.012, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a1a12 }), 0, 0.35, -0.02, this.stick);
        const boot = add(new THREE.CylinderGeometry(0.03, 0.06, 0.08, 12), matDark, 0, 0.0, 0, this.stick);
        void boot;

        // ── HUD combiner glass ──
        const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.17), new THREE.MeshPhysicalMaterial({ color: 0x9fffd0, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, envMapIntensity: 0.6, depthWrite: false }));
        hudGlass.position.set(0, -0.06, -0.55);
        hudGlass.rotation.x = -0.35;
        R.add(hudGlass);
        const hudFrame = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.01, 0.06), matDark);
        hudFrame.position.set(0, -0.15, -0.58);
        R.add(hudFrame);
        this.hudGlass = hudGlass;

        // ── Canopy frame and glass ──
        const bow = (z, r, arc) => {
            const g = new THREE.TorusGeometry(r, 0.022, 8, 24, arc);
            const m = add(g, matFrame, 0, -0.24, z);
            m.rotation.z = (Math.PI - arc) / 2;
            return m;
        };
        // Bubble-canopy frame: a low windscreen bow ahead of the HUD, side rails, and the aft bow
        const bowGeo = new THREE.TorusGeometry(0.46, 0.018, 8, 40, Math.PI);
        const frontBow = new THREE.Mesh(bowGeo, matFrame);
        frontBow.position.set(0, -0.2, -0.86);
        frontBow.rotation.x = -1.15; // lies back along the nose so it stays low in the view
        frontBow.scale.set(1.05, 1, 1);
        frontBow.castShadow = true;
        R.add(frontBow);
        const aftBow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40, Math.PI), matFrame);
        aftBow.position.set(0, -0.24, 0.32);
        aftBow.castShadow = true;
        R.add(aftBow);
        // mirrors hang from the aft bow, angled forward
        for (const x of [-0.28, 0.28]) {
            const mir = add(new THREE.BoxGeometry(0.1, 0.03, 0.008), new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 1, roughness: 0.05 }), x, 0.14, 0.3);
            mir.rotation.y = x > 0 ? 0.5 : -0.5;
            mir.rotation.x = -0.3;
        }
        // canopy glass: faint tint + sky reflections
        const glassGeo = new THREE.SphereGeometry(0.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        glassGeo.scale(0.9, 0.85, 2.2);
        const glass = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({ color: 0xc8dcff, transparent: true, opacity: 0.05, roughness: 0.02, metalness: 0, envMapIntensity: 0.9, side: THREE.BackSide, depthWrite: false }));
        glass.position.set(0, -0.24, -0.2);
        glass.renderOrder = 10;
        R.add(glass);
        // ejection seat headbox behind
        add(new THREE.BoxGeometry(0.28, 0.36, 0.12), matSeat, 0, -0.07, 0.3);

        this.root.traverse(o => { if (o.isMesh && o.material !== glass.material && o.material !== hudGlass.material) o.receiveShadow = true; });
    }

    drawConsole(ctx, side) {
        ctx.fillStyle = '#2b2e31'; ctx.fillRect(0, 0, 128, 512);
        ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
        for (let y = 8; y < 512; y += 64) {
            ctx.strokeRect(6, y, 116, 58);
            ctx.fillStyle = '#d8d8d8'; ctx.font = '9px Arial';
            ctx.fillText(side < 0 ? ['FUEL', 'ENG', 'COMM', 'IFF', 'LIGHTS', 'EXT', 'AUX', 'O2'][y / 64 | 0] : ['NAV', 'SENSOR', 'ECS', 'ELEC', 'HYD', 'ANTI-ICE', 'RDR', 'ECM'][y / 64 | 0], 12, y + 14);
            for (let k = 0; k < 3; k++) {
                ctx.fillStyle = '#151515';
                ctx.beginPath(); ctx.arc(26 + k * 36, y + 38, 9, 0, 6.28); ctx.fill();
                ctx.fillStyle = '#888'; ctx.fillRect(24 + k * 36, y + 30, 4, 10);
            }
        }
    }

    // ── Instrument drawing ──
    drawMFDRadar(ctx, game) {
        const W = 256, p = game.player;
        ctx.fillStyle = '#020a06'; ctx.fillRect(0, 0, W, W);
        ctx.strokeStyle = '#1f7a45'; ctx.lineWidth = 1;
        const cx = W / 2, cy = W - 20, R = 210;
        for (let r = 1; r <= 4; r++) { ctx.beginPath(); ctx.arc(cx, cy, R * r / 4, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(Math.PI * 1.2) * R, cy + Math.sin(Math.PI * 1.2) * R);
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(Math.PI * 1.8) * R, cy + Math.sin(Math.PI * 1.8) * R); ctx.stroke();
        // sweep
        const sweep = Math.PI * 1.2 + (Math.sin(game.time * 1.4) * 0.5 + 0.5) * Math.PI * 0.6;
        ctx.strokeStyle = '#3dff8a'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
        ctx.fillStyle = '#3dff8a'; ctx.font = 'bold 14px monospace';
        ctx.fillText('RWS', 8, 18); ctx.fillText('20NM', W - 50, 18);
        if (!p) return;
        const range = 8000;
        const fwd = p.getForward(_v); const hdg = Math.atan2(-fwd.x, -fwd.z);
        for (const a of game.aircraft) {
            if (a === p || !a.alive) continue;
            const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
            const d = Math.hypot(dx, dz);
            if (d > range) continue;
            const brg = Math.atan2(-dx, -dz) - hdg;
            const ang = -Math.PI / 2 - brg;
            if (ang < Math.PI * -0.8 || ang > Math.PI * -0.2) continue;
            const x = cx + Math.cos(ang) * R * d / range, y = cy + Math.sin(ang) * R * d / range;
            ctx.fillStyle = a.team === 'blue' ? '#4fb4ff' : (a === game.lockTarget ? '#ff4040' : '#ffd23f');
            ctx.fillRect(x - 4, y - 4, 8, 8);
        }
    }

    drawMFDStores(ctx, game) {
        const W = 256, p = game.player;
        ctx.fillStyle = '#020a06'; ctx.fillRect(0, 0, W, W);
        ctx.strokeStyle = '#3dff8a'; ctx.fillStyle = '#3dff8a'; ctx.lineWidth = 2;
        ctx.font = 'bold 14px monospace';
        ctx.fillText('SMS', 8, 18);
        // top-down jet outline
        ctx.beginPath();
        ctx.moveTo(128, 40); ctx.lineTo(140, 90); ctx.lineTo(220, 140); ctx.lineTo(220, 152); ctx.lineTo(142, 140);
        ctx.lineTo(140, 190); ctx.lineTo(170, 205); ctx.lineTo(170, 214); ctx.lineTo(128, 205);
        ctx.lineTo(86, 214); ctx.lineTo(86, 205); ctx.lineTo(116, 190); ctx.lineTo(114, 140); ctx.lineTo(36, 152);
        ctx.lineTo(36, 140); ctx.lineTo(116, 90); ctx.closePath(); ctx.stroke();
        if (!p) return;
        const n = p.spec.missiles;
        for (let i = 0; i < n; i++) {
            const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
            const x = 128 + side * (30 + k * 18), y = 138 - k * 6;
            ctx.fillStyle = i < p.missiles ? '#3dff8a' : '#0f3a22';
            ctx.fillRect(x - 3, y - 12, 6, 22);
        }
        ctx.fillStyle = '#3dff8a';
        ctx.fillText('GUN ' + p.ammo, 8, 236);
        ctx.fillText('FLR ' + p.flares, 150, 236);
        const hp = p.health / p.maxHealth;
        ctx.fillStyle = hp > 0.5 ? '#3dff8a' : hp > 0.25 ? '#ffc23f' : '#ff4040';
        ctx.fillText('HULL ' + Math.round(hp * 100) + '%', 8, 38);
    }

    drawADI(ctx, p) {
        const W = 256, c = W / 2;
        ctx.save();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
        if (!p) { ctx.restore(); return; }
        const fwd = p.getForward(_v);
        const pitch = Math.asin(clamp(fwd.y, -1, 1));
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quat);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quat);
        const roll = Math.atan2(-right.y, up.y);
        ctx.beginPath(); ctx.arc(c, c, 118, 0, Math.PI * 2); ctx.clip();
        ctx.translate(c, c);
        ctx.rotate(-roll);
        const ppd = 3.2;
        const off = pitch / DEG * ppd;
        ctx.fillStyle = '#2d7fd6'; ctx.fillRect(-300, -600 + off, 600, 600);
        ctx.fillStyle = '#7a4a22'; ctx.fillRect(-300, off, 600, 600);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-300, off); ctx.lineTo(300, off); ctx.stroke();
        ctx.font = '14px Arial'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        for (let d = -90; d <= 90; d += 10) {
            if (!d) continue;
            const y = off - d * ppd;
            const w = d % 20 === 0 ? 40 : 22;
            ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
            if (d % 20 === 0) { ctx.fillText(Math.abs(d), -w - 16, y + 5); ctx.fillText(Math.abs(d), w + 16, y + 5); }
        }
        ctx.restore();
        // fixed aircraft symbol
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(c - 70, c); ctx.lineTo(c - 25, c); ctx.lineTo(c - 12, c + 12);
        ctx.moveTo(c + 70, c); ctx.lineTo(c + 25, c); ctx.lineTo(c + 12, c + 12); ctx.stroke();
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(c - 3, c - 3, 6, 6);
        // bank scale
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c, c, 110, Math.PI * 1.17, Math.PI * 1.83); ctx.stroke();
    }

    drawUFC(ctx, p, game) {
        ctx.fillStyle = '#061008'; ctx.fillRect(0, 0, 256, 96);
        ctx.fillStyle = '#3dff8a'; ctx.font = 'bold 22px monospace';
        if (!p) return;
        ctx.fillText('TGT ' + (game.lockTarget ? (Math.round(game.lockTarget.pos.distanceTo(p.pos) / 100) / 10).toFixed(1) + 'KM' : '---'), 10, 34);
        ctx.fillText('M' + p.mach.toFixed(2) + ' ' + p.gLoad.toFixed(1) + 'G ' + (['SRM', 'LRM', 'RKT', 'BMB'][game.slot || 0]), 10, 72);
    }

    drawGauge(g, p) {
        const ctx = g.ctx, S = 128, c = 64;
        ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = '#ddd'; ctx.fillStyle = '#ddd'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c, c, 60, 0, 6.28); ctx.stroke();
        let val = 0, max = 1, label = '', ticks = 10;
        if (!p) return;
        if (g.kind === 'asi') { val = p.speed * MS_TO_KTS; max = 900; label = 'KTS'; }
        if (g.kind === 'alt') { val = (p.pos.y * M_TO_FT) % 10000; max = 10000; label = 'ALT'; }
        if (g.kind === 'vvi') { val = clamp(p.vel.y * 196.85, -6000, 6000) + 6000; max = 12000; label = 'VVI'; ticks = 12; }
        if (g.kind === 'g') { val = clamp(p.gLoad, -3, 10) + 3; max = 13; label = 'G'; ticks = 13; }
        for (let i = 0; i < ticks; i++) {
            const a = -Math.PI / 2 + (i / ticks) * Math.PI * 2 * (g.kind === 'alt' ? 1 : 0.85) - (g.kind === 'alt' ? 0 : 0);
            ctx.beginPath();
            ctx.moveTo(c + Math.cos(a) * 52, c + Math.sin(a) * 52);
            ctx.lineTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60);
            ctx.stroke();
        }
        ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
        ctx.fillText(label, c, c + 30);
        if (g.kind === 'alt') ctx.fillText(Math.round(p.pos.y * M_TO_FT), c, c - 22);
        const frac = val / max;
        const a = -Math.PI / 2 + frac * Math.PI * 2 * (g.kind === 'alt' ? 1 : 0.85);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a) * 50, c + Math.sin(a) * 50); ctx.stroke();
        ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(c, c, 6, 0, 6.28); ctx.fill();
        g.tex.needsUpdate = true;
    }

    setLight(key, on) {
        const l = this.lights[key];
        if (!l || l.on === on) return;
        l.on = on;
        l.mat.color.setScalar(on ? 2.2 : 0.12);
    }

    // ── Per frame ──
    update(dt, game, mainCamera, world, freeLook) {
        const p = game.player;
        if (!p) return;
        this.root.visible = true;
        this.rifle.visible = false;
        this.root.quaternion.copy(p.quat);
        // head bob under G (pushed down in the seat) and buffet at high AoA
        const gk = clamp((p.gLoad - 1) / 8, -0.4, 1);
        this.gShift = damp(this.gShift, gk, 6, dt);
        const buffet = (p.alpha > p.alphaMax * 0.75 || p.afterburner ? 0.0025 : 0) + (p.speed > 380 ? 0.0012 : 0);
        this.head.set(
            (Math.random() - 0.5) * buffet * 2,
            -this.gShift * 0.05 + (Math.random() - 0.5) * buffet,
            this.gShift * 0.02
        );
        // camera = aircraft orientation + head look
        _q.setFromEuler(new THREE.Euler(this.headLook.pitch, this.headLook.yaw, 0, 'YXZ'));
        this.camera.quaternion.copy(p.quat).multiply(_q);
        this.camera.position.copy(this.head).applyQuaternion(p.quat);
        mainCamera.quaternion.copy(this.camera.quaternion);
        mainCamera.position.add(this.camera.position);
        this.camera.fov = mainCamera.fov;
        this.camera.aspect = mainCamera.aspect;
        this.camera.updateProjectionMatrix();

        // sunlight, following the real sun
        this.sun.position.copy(world.sunDir).multiplyScalar(4);
        this.sun.target.position.set(0, 0, 0);
        this.sun.color.copy(world.sun.color);
        this.sun.intensity = world.sun.intensity * 0.85;
        this.hemi.color.copy(world.hemi.color);
        this.hemi.groundColor.copy(world.hemi.groundColor).multiplyScalar(0.6);
        this.hemi.intensity = world.hemi.intensity * 0.8;
        this.scene.environment = world.scene.environment;
        const night = world.timeKey === 'night' || world.timeKey === 'dusk';
        this.panelLight.intensity = night ? 0.4 : 0;

        // controls
        const c = p.controls;
        this.stick.rotation.x = damp(this.stick.rotation.x, -c.pitch * 0.25, 12, dt);
        this.stick.rotation.z = damp(this.stick.rotation.z, -c.roll * 0.25, 12, dt);
        this.throttle.position.z = -0.05 - p.throttle * 0.16;
        this.throttle.rotation.x = -p.throttle * 0.3;

        // annunciators
        const blink = (game.time * 3) % 1 < 0.5;
        this.setLight('launch', p.incoming.length > 0 && blink);
        this.setLight('lock', !!(p.lockedBy && p.lockedBy.size));
        this.setLight('stall', p.stalling);
        this.setLight('ab', p.afterburner);
        this.setLight('gear', p.gear);
        this.setLight('brake', p.airbrake);
        this.setLight('fuel', p.fuel < 0.2 && game.settings.fuel !== false);
        this.setLight('master', (game.time - p.lastHitTime < 2 || p.health / p.maxHealth < 0.3) && blink);

        // instruments at ~20 Hz, staggered
        this.frame++;
        const f = this.frame % 3;
        if (f === 0) { this.drawADI(this.adi.ctx, p); this.adi.tex.needsUpdate = true; this.drawUFC(this.ufc.ctx, p, game); this.ufc.tex.needsUpdate = true; }
        if (f === 1) { this.drawMFDRadar(this.mfdL.ctx, game); this.mfdL.tex.needsUpdate = true; }
        if (f === 2) { this.drawMFDStores(this.mfdR.ctx, game); this.mfdR.tex.needsUpdate = true; this.gauges.forEach(g => this.drawGauge(g, p)); }
        void freeLook;
    }

    // Projected screen rect of the HUD combiner (so the 2D HUD can be clipped to it)
    hudRect(w, h) {
        const pts = [[-0.1, -0.085], [0.1, -0.085], [-0.1, 0.085], [0.1, 0.085]];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        this.hudGlass.updateMatrixWorld();
        for (const [x, y] of pts) {
            _v.set(x, y, 0).applyMatrix4(this.hudGlass.matrixWorld).project(this.camera);
            const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
            x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
}
