// ═══════════════════════════════════════════════════════════════
// 3D cockpit interior (GeoFS-style): rendered in its own pass on top of the
// world with a near-clip camera. The cockpit turns with the aircraft while the
// sun and sky light stay put in world space, so sunlight and the canopy
// frame's shadows sweep across the panel as you manoeuvre. Instruments are live
// canvas textures; stick and throttle follow the pilot's inputs; legends are
// backlit at night; the canopy glass catches sky reflections and sun glints.
// Eye point is the origin; forward is -Z.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { buildRifleModel } from './rifle.js';
import { clamp, damp, MS_TO_KTS, M_TO_FT, DEG } from './util.js';
import { terrainHeight } from './world.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4();
const _up = new THREE.Vector3();

function canvasTex(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { c, ctx: c.getContext('2d'), tex };
}

// Painted metal panel: base colour, fine grain, seams and screws. Returns the colour canvas and a
// matching emissive canvas (only the white legends), for night backlighting.
function paintedPanel(W, H, base, draw) {
    const col = canvasTex(W, H), emi = canvasTex(W, H);
    const c = col.ctx, e = emi.ctx;
    c.fillStyle = base; c.fillRect(0, 0, W, H);
    // grain
    const img = c.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    c.putImageData(img, 0, 0);
    e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
    const api = {
        seam(x, y, w, h) {
            c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 2; c.strokeRect(x, y, w, h);
            c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.strokeRect(x + 1.5, y + 1.5, w, h);
        },
        screw(x, y, r = 3) {
            c.fillStyle = '#1b1c1e'; c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 6.28); c.fill();
            c.strokeStyle = '#0c0c0c'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - r * 0.7, y); c.lineTo(x + r * 0.7, y); c.stroke();
        },
        text(t, x, y, size = 12, align = 'center') {
            for (const g of [c, e]) { g.font = `bold ${size}px Arial, sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; }
            c.fillStyle = '#e6e6df'; c.fillText(t, x, y);
            e.fillStyle = '#ffd9a0'; e.fillText(t, x, y);
        },
        knob(x, y, r = 9) {
            c.fillStyle = '#101112'; c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill();
            c.fillStyle = '#3a3c3f'; c.beginPath(); c.arc(x, y, r * 0.7, 0, 6.28); c.fill();
            c.fillStyle = '#d8d8d0'; c.fillRect(x - 1, y - r * 0.7, 2, r * 0.6);
        },
        toggle(x, y) {
            c.fillStyle = '#16171a'; c.beginPath(); c.arc(x, y, 6, 0, 6.28); c.fill();
            c.fillStyle = '#a8aaa8'; c.fillRect(x - 2, y - 12, 4, 12);
        },
        ctx: c,
    };
    draw(api);
    col.tex.needsUpdate = true; emi.tex.needsUpdate = true;
    return { map: col.tex, emissiveMap: emi.tex };
}

// Canopy / combiner glass: clear from inside, with a Fresnel sky reflection, a sharp sun glint, and
// dust and fine scratches that light up when the sun shines through them.
function makeGlassMaterial(tint, strength = 1) {
    const S = 256, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.35})`; x.fillRect(Math.random() * S, Math.random() * S, 1, 1); }
    x.lineWidth = 0.6;
    for (let i = 0; i < 90; i++) {
        const cx = Math.random() * S, cy = Math.random() * S, a = Math.random() * 6.28, l = 6 + Math.random() * 40;
        x.strokeStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.3})`;
        x.beginPath(); x.arc(cx, cy, l * 2, a, a + l / (l * 2)); x.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: {
            sunDirV: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) },
            upV: { value: new THREE.Vector3(0, 1, 0) }, skyTop: { value: new THREE.Color(0.3, 0.45, 0.7) },
            skyHor: { value: new THREE.Color(0.6, 0.7, 0.8) }, ground: { value: new THREE.Color(0.15, 0.17, 0.12) },
            tint: { value: new THREE.Color(tint) }, scratch: { value: tex }, strength: { value: strength },
        },
        vertexShader: /* glsl */`
            varying vec3 vN, vP; varying vec2 vUv;
            void main() {
                vUv = uv * vec2(3.0, 2.0);
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vP = mv.xyz; vN = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 sunDirV, sunCol, upV, skyTop, skyHor, ground, tint; uniform sampler2D scratch; uniform float strength;
            varying vec3 vN, vP; varying vec2 vUv;
            void main() {
                vec3 v = normalize(-vP);
                vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
                float ndv = abs(dot(n, v));
                float fres = 0.025 + 0.5 * pow(1.0 - ndv, 4.0);
                vec3 r = reflect(-v, n);
                float h = dot(r, upV);
                vec3 sky = h > 0.0 ? mix(skyHor, skyTop, sqrt(h)) : mix(skyHor, ground, clamp(-h * 4.0, 0.0, 1.0));
                float glint = pow(max(dot(r, sunDirV), 0.0), 900.0) * 6.0 + pow(max(dot(r, sunDirV), 0.0), 40.0) * 0.25;
                // scratches and dust catch the light when the sun is ahead, through the glass
                float fwd = pow(max(dot(-v, sunDirV), 0.0), 3.0);
                float sc = texture2D(scratch, vUv).r * (0.05 + fwd * 0.55);
                vec3 col = sky * fres + sunCol * (glint + sc * 0.6) + tint * 0.02;
                float a = clamp((fres + sc * 0.5 + glint * 0.5) * strength, 0.0, 0.9);
                gl_FragColor = vec4(col / max(a, 0.001) * strength, a);
            }`,
    });
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
        this.t = 0;
        this.night = -1;
        this.shakeRot = new THREE.Euler();

        // Lighting: sun (with shadows inside the cockpit) + sky fill + panel flood lights at night
        this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        const sc = this.sun.shadow.camera;
        sc.left = -1.3; sc.right = 1.3; sc.top = 1.3; sc.bottom = -1.3; sc.near = 0.1; sc.far = 8;
        this.sun.shadow.bias = -0.0008;
        this.sun.shadow.normalBias = 0.008;
        this.sun.shadow.radius = 3;
        this.scene.add(this.sun, this.sun.target);
        this.hemi = new THREE.HemisphereLight(0xbcd4ee, 0x2a2a2a, 0.9);
        this.scene.add(this.hemi);
        // floodlights under the glareshield (night) and a dim console light
        this.panelLight = new THREE.PointLight(0xffd8a8, 0.0, 1.4, 2);
        this.panelLight.position.set(0, -0.2, -0.5);
        this.root.add(this.panelLight);
        this.consoleLight = new THREE.PointLight(0xffd8a8, 0.0, 1.2, 2);
        this.consoleLight.position.set(0, -0.3, 0.05);
        this.root.add(this.consoleLight);

        this.build();
        this.scene.add(this.camera);
        this.buildRifle();
    }

    // AK-47 view model (child of the overlay camera)
    buildRifle() {
        const g = buildRifleModel();
        this.flash = new THREE.PointLight(0xffa040, 0, 3, 2);
        this.flash.position.set(0, 0.03, -0.7);
        g.add(this.flash);
        const flashTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,170,60,0.8)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
        this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.8, 1.5, 1.2) }));
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
        this.syncLights(world);
        // a round went off in the last 50 ms (pilot.js stamps lastShotT; older builds only had fireT)
        const firing = pm.reloadT <= 0 && (pm.lastShotT != null ? game.time - pm.lastShotT < 0.05 : pm.fireT > 0.05 && game.input.mouse.left);
        if (firing) this.rifleKick = 1;
        this.rifleKick = Math.max(0, this.rifleKick - dt * 14);
        const reload = pm.reloadT > 0 ? Math.sin(Math.min(1, (2.2 - pm.reloadT) / 2.2) * Math.PI) : 0;
        this.rifle.position.set(0.2, -0.2 - reload * 0.12, -0.5 + this.rifleKick * 0.03);
        this.rifle.rotation.set(this.rifleKick * 0.06 + reload * 0.5, 0.05, reload * 0.4);
        this.muzzle.visible = this.rifleKick > 0.6;
        this.muzzle.material.rotation = Math.random() * 6;
        this.flash.intensity = this.rifleKick > 0.6 ? 2 : 0;
        // sway while hanging under the canopy / walking
        const t = game.time;
        this.rifle.position.x += Math.sin(t * 1.3) * 0.004;
        this.rifle.position.y += Math.cos(t * 1.7) * 0.004;
    }

    build() {
        const R = this.root;
        // Dark gull grey panels (FS 36231-ish), flat black glareshield, satin frame
        const panelTex = paintedPanel(512, 256, '#686e74', (p) => {
            p.seam(6, 6, 500, 244);
            for (const [x, y] of [[14, 14], [498, 14], [14, 242], [498, 242], [256, 14], [256, 242]]) p.screw(x, y);
        });
        const mat = (color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMapIntensity: 0.45, ...extra });
        const matPanel = mat(0xffffff, 0.78, 0.0, { map: panelTex.map });
        const matGrey = mat(0x686e74, 0.8, 0.0);
        const matDark = mat(0x1c1e21, 0.7, 0.1);
        const matBlack = mat(0x0e0f10, 0.95, 0.0, { envMapIntensity: 0.2 }); // anti-glare
        const matFrame = mat(0x2e3236, 0.5, 0.35, { envMapIntensity: 0.7 });
        const matGrip = mat(0x141414, 0.85, 0.0);
        const matSeat = mat(0x3a4128, 0.95, 0.0);
        const matCushion = mat(0x2b2f22, 1, 0.0);
        const matYellow = mat(0xd8a91c, 0.6, 0.0);
        this.mats = { matPanel, matGrey };
        const add = (geo, m, x, y, z, parent = R) => {
            const o = new THREE.Mesh(geo, m);
            o.position.set(x, y, z);
            o.castShadow = true; o.receiveShadow = true;
            parent.add(o);
            return o;
        };

        // ── Main instrument panel (tilted back toward the pilot) ──
        const panel = new THREE.Group();
        panel.position.set(0, -0.36, -0.72);
        panel.rotation.x = -0.28;
        R.add(panel);
        this.panel = panel;
        // face texture with legends (backlit at night)
        const faceTex = paintedPanel(1024, 440, '#686e74', (p) => {
            const X = (x) => (x + 0.49) / 0.98 * 1024, Y = (y) => (0.21 - y) / 0.42 * 440; // panel metres → pixels
            p.seam(X(-0.485), Y(0.205), X(0.485) - X(-0.485), Y(-0.205) - Y(0.205));
            p.seam(X(-0.42), Y(0.2), X(-0.16) - X(-0.42), Y(-0.13) - Y(0.2));
            p.seam(X(0.16), Y(0.2), X(0.42) - X(0.16), Y(-0.13) - Y(0.2));
            p.seam(X(-0.15), Y(0.2), X(0.15) - X(-0.15), Y(-0.2) - Y(0.2));
            for (const x of [-0.475, 0.475]) for (const y of [0.195, -0.195]) p.screw(X(x), Y(y), 4);
            for (const x of [-0.41, -0.17, 0.17, 0.41]) for (const y of [0.19, -0.12]) p.screw(X(x), Y(y), 3);
            p.text('LEFT MFD', X(-0.29), Y(-0.141), 12); p.text('RIGHT MFD', X(0.29), Y(-0.141), 12);
            p.text('ADI', X(0), Y(0.075), 14); p.text('UFC', X(-0.105), Y(0.175), 12, 'center');
            p.text('ASI', X(-0.124), Y(-0.115), 12); p.text('ALT', X(0.124), Y(-0.115), 12);
                        p.text('MASTER ARM', X(-0.33), Y(-0.185), 12); p.toggle(X(-0.225), Y(-0.18));
            p.text('LASER', X(0.33), Y(-0.185), 12); p.toggle(X(0.225), Y(-0.18));
                    });
        this.panelFace = add(new THREE.BoxGeometry(0.98, 0.42, 0.04), [matGrey, matGrey, matGrey, matGrey, mat(0xffffff, 0.75, 0.0, { map: faceTex.map, emissiveMap: faceTex.emissiveMap, emissive: 0x000000 }), matGrey], 0, 0, 0, panel);
        this.faceMat = this.panelFace.material[4];
        // glareshield: flat black hood with a rounded lip over the instruments
        const hood = new THREE.Group();
        hood.position.set(0, 0.215, 0.07);
        hood.rotation.x = 0.28;
        panel.add(hood);
        add(new THREE.BoxGeometry(0.8, 0.03, 0.24), matBlack, 0, 0, -0.02, hood);
        add(new THREE.CylinderGeometry(0.018, 0.018, 0.8, 14), matBlack, 0, -0.004, 0.1, hood).rotation.z = Math.PI / 2;
        // lower centre pedestal
        add(new THREE.BoxGeometry(0.26, 0.3, 0.3), matGrey, 0, -0.33, 0.06, panel);
        // panel side cheeks that sweep back to the consoles
        for (const s of [-1, 1]) {
            const ch = add(new THREE.BoxGeometry(0.04, 0.34, 0.5), matGrey, s * 0.5, -0.1, 0.18, panel);
            ch.rotation.y = s * 0.12;
        }

        // MFDs + centre display as live canvases (the MFD canvases carry their own OSB legends)
        this.mfdL = canvasTex(384, 384);
        this.mfdR = canvasTex(384, 384);
        this.adi = canvasTex(256, 256);
        this.ufc = canvasTex(320, 112);
        this.screens = [];
        const screen = (ct, w, h, x, y, bz = 0.03, glow = 1) => {
            add(new THREE.BoxGeometry(w + bz * 2, h + bz * 2, 0.024), matDark, x, y, 0.027, panel);
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: ct.tex, toneMapped: false, color: new THREE.Color(glow, glow, glow) }));
            m.position.set(x, y, 0.0395);
            m.userData.glow = glow;
            panel.add(m);
            this.screens.push(m);
            // a faint glass sheen over the screen
            const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.screenGlass || (this.screenGlass = makeGlassMaterial(0x8899aa, 0.6)));
            g.position.set(x, y, 0.041);
            g.renderOrder = 9;
            panel.add(g);
            return m;
        };
        screen(this.mfdL, 0.19, 0.19, -0.29, 0.03, 0.03);
        screen(this.mfdR, 0.19, 0.19, 0.29, 0.03, 0.03);
        screen(this.adi, 0.14, 0.14, 0, -0.01, 0.01, 0.95);
        screen(this.ufc, 0.21, 0.07, 0.03, 0.15, 0.01, 1);
        // bezel push-buttons around the MFDs
        const btnMat = mat(0x5a5d61, 0.55, 0.1);
        const btnGeo = new THREE.BoxGeometry(0.018, 0.014, 0.012);
        for (const cx of [-0.29, 0.29]) for (let i = 0; i < 5; i++) {
            const o = -0.07 + i * 0.035;
            add(btnGeo, btnMat, cx + o, 0.03 + 0.11, 0.043, panel);
            add(btnGeo, btnMat, cx + o, 0.03 - 0.11, 0.043, panel);
            add(btnGeo, btnMat, cx - 0.11, 0.03 + o, 0.043, panel).rotation.z = Math.PI / 2;
            add(btnGeo, btnMat, cx + 0.11, 0.03 + o, 0.043, panel).rotation.z = Math.PI / 2;
        }
        // UFC keypad beside the UFC display
        for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.014, 0.012, 0.01), btnMat, -0.125 + k * 0.02, 0.172 - r * 0.02, 0.025, panel);
        // Analogue standby gauges
        this.gauges = [];
        // (outboard of the MFDs the canopy sills and the glareshield hide the panel, so everything lives inside)
        [['asi', -0.124, -0.065], ['alt', 0.124, -0.065]].forEach(([k, gx, gy]) => {
            const ct = canvasTex(160, 160);
            const r = 0.034;
            add(new THREE.CylinderGeometry(r + 0.006, r + 0.009, 0.022, 28).rotateX(Math.PI / 2), matDark, gx, gy, 0.027, panel);
            const face = new THREE.Mesh(new THREE.CircleGeometry(r, 36), new THREE.MeshBasicMaterial({ map: ct.tex, toneMapped: false, color: new THREE.Color(0.85, 0.85, 0.85) }));
            face.position.set(gx, gy, 0.0385);
            face.userData.glow = 0.85;
            panel.add(face);
            this.screens.push(face);
            this.gauges.push({ kind: k, ...ct });
        });

        // Warning / caution annunciators (dark when off: you can still read the legend in daylight)
        this.lights = {};
        const annun = (key, label, color, x, y) => {
            const ct = canvasTex(128, 48);
            ct.ctx.fillStyle = '#0a0a0a'; ct.ctx.fillRect(0, 0, 128, 48);
            ct.ctx.strokeStyle = '#333'; ct.ctx.lineWidth = 3; ct.ctx.strokeRect(1, 1, 126, 46);
            ct.ctx.font = 'bold 22px Arial'; ct.ctx.textAlign = 'center'; ct.ctx.textBaseline = 'middle';
            ct.ctx.fillStyle = color; ct.ctx.fillText(label, 64, 25);
            ct.tex.needsUpdate = true;
            const m = new THREE.MeshBasicMaterial({ map: ct.tex, toneMapped: false, color: new THREE.Color(0.14, 0.14, 0.14) });
            const o = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.022), m);
            o.position.set(x, y, 0.1205);
            hood.add(o);
            this.lights[key] = { mat: m, on: false };
        };
        // "eyebrow" lights on the glareshield lip above each MFD: cautions left, warnings right
        const ay = -0.004;
        annun('master', 'MASTER', '#ffb020', -0.29 - 0.093, ay);
        annun('stall', 'STALL', '#ffb020', -0.29 - 0.031, ay);
        annun('ab', 'A/B', '#40ff70', -0.29 + 0.031, ay);
        annun('brake', 'BRAKE', '#ffb020', -0.29 + 0.093, ay);
        annun('launch', 'LAUNCH', '#ff3020', 0.29 - 0.093, ay);
        annun('lock', 'LOCK', '#ff3020', 0.29 - 0.031, ay);
        annun('gear', 'GEAR', '#40ff70', 0.29 + 0.031, ay);
        annun('fuel', 'FUEL', '#ff3020', 0.29 + 0.093, ay);

        // ── Side consoles ──
        this.consoleMats = [];
        for (const s of [-1, 1]) {
            const con = add(new THREE.BoxGeometry(0.2, 0.12, 0.9), matGrey, s * 0.36, -0.5, -0.1);
            con.rotation.z = s * -0.08;
            const tex = paintedPanel(128, 512, '#5e6369', (p) => this.drawConsole(p, s));
            const m = mat(0xffffff, 0.8, 0.0, { map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0x000000 });
            this.consoleMats.push(m);
            const top = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.88), m);
            top.rotation.x = -Math.PI / 2;
            top.position.set(s * 0.36, -0.438, -0.1);
            top.receiveShadow = true;
            R.add(top);
            // canopy sill / rail
            add(new THREE.BoxGeometry(0.07, 0.05, 1.6), matFrame, s * 0.47, -0.24, -0.25);
            // cockpit side wall
            add(new THREE.BoxGeometry(0.02, 0.38, 1.5), matGrey, s * 0.5, -0.44, -0.2);
        }
        // floor / footwell / rudder pedals
        add(new THREE.BoxGeometry(0.9, 0.02, 1.2), matDark, 0, -0.8, -0.3);
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.14, 0.02), matDark, s * 0.14, -0.73, -0.86).rotation.x = -0.4;

        // ── Throttle (left console) ──
        this.throttle = new THREE.Group();
        this.throttle.position.set(-0.33, -0.44, -0.05);
        R.add(this.throttle);
        add(new THREE.BoxGeometry(0.025, 0.12, 0.025), matFrame, 0, 0.06, 0, this.throttle);
        add(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10).rotateX(Math.PI / 2), matGrip, 0.01, 0.13, 0, this.throttle);
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), mat(0x8a1a12, 0.5, 0), 0.03, 0.155, -0.02, this.throttle);

        // ── Control stick (centre) ──
        this.stick = new THREE.Group();
        this.stick.position.set(0, -0.8, -0.24);
        R.add(this.stick);
        add(new THREE.CylinderGeometry(0.014, 0.018, 0.26, 10), matFrame, 0, 0.13, 0, this.stick);
        const grip = add(new THREE.CapsuleGeometry(0.024, 0.08, 4, 12), matGrip, 0, 0.3, 0, this.stick);
        grip.rotation.x = 0.2;
        add(new THREE.BoxGeometry(0.012, 0.02, 0.02), mat(0x8a1a12, 0.5, 0), 0, 0.36, -0.02, this.stick); // pickle button
        add(new THREE.BoxGeometry(0.01, 0.03, 0.012), matDark, 0, 0.29, -0.03, this.stick);              // trigger
        add(new THREE.CylinderGeometry(0.03, 0.06, 0.08, 12), matDark, 0, 0.0, 0, this.stick);            // boot

        // ── Ejection seat: bucket, cushions, the yellow-and-black handle between the knees ──
        add(new THREE.BoxGeometry(0.46, 0.1, 0.46), matSeat, 0, -0.66, 0.08);
        add(new THREE.BoxGeometry(0.4, 0.06, 0.4), matCushion, 0, -0.6, 0.06);
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.4, 0.5), matSeat, s * 0.25, -0.45, 0.1);
        add(new THREE.BoxGeometry(0.44, 0.7, 0.1), matSeat, 0, -0.25, 0.32);
        add(new THREE.BoxGeometry(0.28, 0.3, 0.12), matCushion, 0, 0.02, 0.28); // headbox
        const ej = add(new THREE.TorusGeometry(0.05, 0.009, 6, 16, Math.PI), matYellow, 0, -0.56, -0.2);
        ej.rotation.x = -0.3;

        // ── HUD combiner glass ──
        const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.17), makeGlassMaterial(0x9fffd0, 0.9));
        hudGlass.position.set(0, -0.06, -0.55);
        hudGlass.rotation.x = -0.35;
        hudGlass.renderOrder = 10;
        R.add(hudGlass);
        const hudFrame = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.012, 0.07), matDark);
        hudFrame.position.set(0, -0.15, -0.58);
        R.add(hudFrame);
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.008, 0.18, 0.008), matDark, s * 0.104, -0.065, -0.555).rotation.x = -0.35;
        this.hudGlass = hudGlass;

        // ── Canopy frame and glass ──
        // windscreen bow lying back along the nose (low in the view), sills (above), aft bow behind the head
        const bowGeo = new THREE.TorusGeometry(0.46, 0.014, 8, 40, Math.PI);
        const frontBow = new THREE.Mesh(bowGeo, matFrame);
        frontBow.position.set(0, -0.2, -0.86);
        frontBow.rotation.x = -1.15;
        frontBow.scale.set(1.05, 1, 1);
        frontBow.castShadow = true;
        R.add(frontBow);
        const aftBow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40, Math.PI), matFrame);
        aftBow.position.set(0, -0.24, 0.32);
        aftBow.castShadow = true;
        R.add(aftBow);
        // mirrors hang from the aft bow, angled forward
        const mirMat = mat(0x8899aa, 0.05, 1, { envMapIntensity: 1 });
        for (const x of [-0.28, 0.28]) {
            const mir = add(new THREE.BoxGeometry(0.1, 0.03, 0.008), mirMat, x, 0.14, 0.3);
            mir.rotation.y = x > 0 ? 0.5 : -0.5;
            mir.rotation.x = -0.3;
        }
        // canopy glass
        const glassGeo = new THREE.SphereGeometry(0.6, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
        glassGeo.scale(0.9, 0.85, 2.2);
        const glass = new THREE.Mesh(glassGeo, makeGlassMaterial(0xc8dcff, 1));
        glass.position.set(0, -0.24, -0.2);
        glass.renderOrder = 11;
        R.add(glass);
        this.glass = glass;
        this.glassMats = [glass.material, hudGlass.material, this.screenGlass];

        this.root.traverse(o => { if (o.isMesh && !o.material.isShaderMaterial && !o.material.isMeshBasicMaterial) o.receiveShadow = true; });
    }

    drawConsole(p, side) {
        const c = p.ctx;
        const names = side < 0 ? ['FUEL', 'ENG', 'COMM', 'IFF', 'LIGHTS', 'EXT', 'AUX', 'O2'] : ['NAV', 'SENSOR', 'ECS', 'ELEC', 'HYD', 'ANTI-ICE', 'RDR', 'ECM'];
        for (let y = 8, k = 0; y < 512; y += 63, k++) {
            p.seam(6, y, 116, 57);
            p.screw(11, y + 5, 2); p.screw(117, y + 5, 2); p.screw(11, y + 52, 2); p.screw(117, y + 52, 2);
            p.text(names[k], 64, y + 12, 10);
            for (let i = 0; i < 3; i++) {
                if ((i + k) % 2) p.knob(28 + i * 36, y + 36, 9);
                else p.toggle(28 + i * 36, y + 40);
            }
            void c;
        }
    }

    // ── Instrument drawing ──
    // OSB legends around an MFD page
    osb(ctx, W, top, bottom, left = [], right = []) {
        ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#6dffa6'; ctx.textBaseline = 'middle';
        const pos = [0.18, 0.34, 0.5, 0.66, 0.82];
        ctx.textAlign = 'center';
        top.forEach((t, i) => t && ctx.fillText(t, pos[i] * W, 14));
        bottom.forEach((t, i) => t && ctx.fillText(t, pos[i] * W, W - 12));
        ctx.textAlign = 'left'; left.forEach((t, i) => t && ctx.fillText(t, 6, pos[i] * W));
        ctx.textAlign = 'right'; right.forEach((t, i) => t && ctx.fillText(t, W - 6, pos[i] * W));
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    drawMFDRadar(ctx, game) {
        const W = 384, p = game.player;
        ctx.fillStyle = '#010805'; ctx.fillRect(0, 0, W, W);
        this.osb(ctx, W, ['CRM', 'RWS', '', 'NORM', 'OVRD'], ['SWAP', 'FCR', '', 'SMS', 'DCLT'], ['↑', '40', '↓'], ['A4', 'B2', '8']);
        const range = 8000, cx = W / 2, cy = W - 34, R = W - 72;
        ctx.strokeStyle = '#1b6b3e'; ctx.lineWidth = 1.5;
        for (let r = 1; r <= 4; r++) { ctx.beginPath(); ctx.arc(cx, cy, R * r / 4, Math.PI * 1.22, Math.PI * 1.78); ctx.stroke(); }
        for (const a of [1.22, 1.36, 1.5, 1.64, 1.78]) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(Math.PI * a) * R, cy + Math.sin(Math.PI * a) * R); ctx.stroke(); }
        // sweep
        const sweep = Math.PI * 1.22 + (Math.sin(game.time * 1.4) * 0.5 + 0.5) * Math.PI * 0.56;
        ctx.strokeStyle = '#4dff94'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
        ctx.fillStyle = '#4dff94'; ctx.font = 'bold 16px monospace';
        ctx.fillText((range / 1852 * 1.6).toFixed(0) + 'NM', 34, 48);
        if (!p) return;
        const fwd = p.getForward(_v); const hdg = Math.atan2(-fwd.x, -fwd.z);
        ctx.fillText('HDG ' + String(Math.round(((-hdg / DEG) % 360 + 360) % 360)).padStart(3, '0'), W - 140, 48);
        for (const a of game.aircraft) {
            if (a === p || !a.alive) continue;
            const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
            const d = Math.hypot(dx, dz);
            if (d > range) continue;
            const brg = Math.atan2(-dx, -dz) - hdg;
            const ang = -Math.PI / 2 - brg;
            if (ang < Math.PI * -0.78 || ang > Math.PI * -0.22) continue;
            const x = cx + Math.cos(ang) * R * d / range, y = cy + Math.sin(ang) * R * d / range;
            const locked = a === game.lockTarget;
            ctx.fillStyle = a.team === 'blue' ? '#4fb4ff' : (locked ? '#ff4040' : '#ffd23f');
            ctx.fillRect(x - 6, y - 6, 12, 12);
            if (locked) { ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 2; ctx.strokeRect(x - 11, y - 11, 22, 22); }
            ctx.font = 'bold 13px monospace';
            ctx.fillText(String(Math.round(a.pos.y * M_TO_FT / 1000)), x + 9, y + 4);
        }
    }

    drawMFDStores(ctx, game) {
        const W = 384, p = game.player;
        ctx.fillStyle = '#010805'; ctx.fillRect(0, 0, W, W);
        this.osb(ctx, W, ['A-A', '', 'INV', '', 'S-J'], ['SWAP', 'FCR', '', 'SMS', 'HSI'], [], []);
        ctx.strokeStyle = '#4dff94'; ctx.fillStyle = '#4dff94'; ctx.lineWidth = 2.5;
        // top-down jet outline
        ctx.save(); ctx.translate(0, 20); ctx.scale(1.5, 1.4);
        ctx.beginPath();
        ctx.moveTo(128, 40); ctx.lineTo(140, 90); ctx.lineTo(220, 140); ctx.lineTo(220, 152); ctx.lineTo(142, 140);
        ctx.lineTo(140, 190); ctx.lineTo(170, 205); ctx.lineTo(170, 214); ctx.lineTo(128, 205);
        ctx.lineTo(86, 214); ctx.lineTo(86, 205); ctx.lineTo(116, 190); ctx.lineTo(114, 140); ctx.lineTo(36, 152);
        ctx.lineTo(36, 140); ctx.lineTo(116, 90); ctx.closePath();
        ctx.lineWidth = 1.8; ctx.stroke();
        ctx.restore();
        if (!p) return;
        const n = p.spec.missiles;
        for (let i = 0; i < n; i++) {
            const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
            const x = 192 + side * (45 + k * 26), y = 222 - k * 9;
            ctx.fillStyle = i < p.missiles ? '#4dff94' : '#0f3a22';
            ctx.fillRect(x - 4, y - 16, 8, 30);
        }
        ctx.font = 'bold 20px monospace';
        ctx.fillStyle = '#4dff94';
        ctx.fillText('GUN ' + p.ammo, 30, W - 40);
        ctx.fillText('FLR ' + p.flares, W - 130, W - 40);
        const hp = p.health / p.maxHealth;
        ctx.fillStyle = hp > 0.5 ? '#4dff94' : hp > 0.25 ? '#ffc23f' : '#ff4040';
        ctx.fillText('HULL ' + Math.round(hp * 100) + '%', 30, 50);
        ctx.fillStyle = p.fuel > 0.2 ? '#4dff94' : '#ffc23f';
        ctx.fillText('FUEL ' + Math.round(p.fuel * 100) + '%', W - 150, 50);
    }

    drawADI(ctx, p) {
        const W = 256, c = W / 2;
        ctx.save();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
        if (!p) { ctx.restore(); return; }
        const fwd = p.getForward(_v);
        const pitch = Math.asin(clamp(fwd.y, -1, 1));
        const right = _up.set(1, 0, 0).applyQuaternion(p.quat);
        const rightY = right.y;
        const upY = _up.set(0, 1, 0).applyQuaternion(p.quat).y;
        const roll = Math.atan2(-rightY, upY);
        ctx.beginPath(); ctx.arc(c, c, 118, 0, Math.PI * 2); ctx.clip();
        ctx.translate(c, c);
        ctx.rotate(-roll);
        const ppd = 3.2;
        const off = pitch / DEG * ppd;
        ctx.fillStyle = '#2d7fd6'; ctx.fillRect(-300, -600 + off, 600, 600);
        ctx.fillStyle = '#7a4a22'; ctx.fillRect(-300, off, 600, 600);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-300, off); ctx.lineTo(300, off); ctx.stroke();
        ctx.font = 'bold 15px Arial'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        for (let d = -90; d <= 90; d += 10) {
            if (!d) continue;
            const y = off - d * ppd;
            const w = d % 20 === 0 ? 40 : 22;
            ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
            if (d % 20 === 0) { ctx.fillText(Math.abs(d), -w - 16, y + 5); ctx.fillText(Math.abs(d), w + 16, y + 5); }
        }
        ctx.restore();
        // fixed aircraft symbol
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(c - 70, c); ctx.lineTo(c - 25, c); ctx.lineTo(c - 12, c + 12);
        ctx.moveTo(c + 70, c); ctx.lineTo(c + 25, c); ctx.lineTo(c + 12, c + 12); ctx.stroke();
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(c - 4, c - 4, 8, 8);
        // bank scale + pointer
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c, c, 110, Math.PI * 1.17, Math.PI * 1.83); ctx.stroke();
        for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
            const a = -Math.PI / 2 + b * DEG, l = b % 30 === 0 ? 14 : 8;
            ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * 110, c + Math.sin(a) * 110); ctx.lineTo(c + Math.cos(a) * (110 - l), c + Math.sin(a) * (110 - l)); ctx.stroke();
        }
        const ra = -Math.PI / 2 - roll;
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.moveTo(c + Math.cos(ra) * 98, c + Math.sin(ra) * 98);
        ctx.lineTo(c + Math.cos(ra + 0.07) * 84, c + Math.sin(ra + 0.07) * 84); ctx.lineTo(c + Math.cos(ra - 0.07) * 84, c + Math.sin(ra - 0.07) * 84); ctx.fill();
    }

    drawUFC(ctx, p, game) {
        const W = 320, H = 112;
        ctx.fillStyle = '#041008'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#4dff94'; ctx.font = 'bold 26px monospace';
        if (!p) return;
        const tgt = game.lockTarget ? (Math.round(game.lockTarget.pos.distanceTo(p.pos) / 100) / 10).toFixed(1) + 'KM' : '---';
        ctx.fillText('TGT ' + tgt, 12, 38);
        ctx.fillText('M' + p.mach.toFixed(2) + ' ' + p.gLoad.toFixed(1) + 'G ' + (['SRM', 'LRM', 'RKT', 'BMB'][game.slot || 0]), 12, 86);
    }

    drawGauge(g, p) {
        const ctx = g.ctx, S = 160, c = 80;
        ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = '#e8e8e0'; ctx.fillStyle = '#e8e8e0'; ctx.lineWidth = 2.5;
        let val = 0, max = 1, label = '', ticks = 10;
        if (!p) return;
        if (g.kind === 'asi') { val = p.speed * MS_TO_KTS; max = 900; label = 'KTS'; }
        if (g.kind === 'alt') { val = (p.pos.y * M_TO_FT) % 10000; max = 10000; label = 'ALT'; }
        if (g.kind === 'vvi') { val = clamp(p.vel.y * 196.85, -6000, 6000) + 6000; max = 12000; label = 'VVI'; ticks = 12; }
        if (g.kind === 'g') { val = clamp(p.gLoad, -3, 10) + 3; max = 13; label = 'G'; ticks = 13; }
        const full = g.kind === 'alt' ? 1 : 0.85;
        for (let i = 0; i <= ticks * 2; i++) {
            if (full === 1 && i === ticks * 2) break;
            const a = -Math.PI / 2 + (i / (ticks * 2)) * Math.PI * 2 * full;
            const l = i % 2 ? 7 : 13;
            ctx.lineWidth = i % 2 ? 1.5 : 3;
            ctx.beginPath();
            ctx.moveTo(c + Math.cos(a) * (76 - l), c + Math.sin(a) * (76 - l));
            ctx.lineTo(c + Math.cos(a) * 76, c + Math.sin(a) * 76);
            ctx.stroke();
        }
        ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
        ctx.fillText(label, c, c + 36);
        if (g.kind === 'alt') { ctx.font = 'bold 20px monospace'; ctx.fillText(Math.round(p.pos.y * M_TO_FT), c, c - 26); }
        if (g.kind === 'asi') { ctx.font = 'bold 20px monospace'; ctx.fillText(Math.round(val), c, c - 26); }
        const a = -Math.PI / 2 + (val / max) * Math.PI * 2 * full;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(c - Math.cos(a) * 12, c - Math.sin(a) * 12); ctx.lineTo(c + Math.cos(a) * 64, c + Math.sin(a) * 64); ctx.stroke();
        ctx.fillStyle = '#444'; ctx.beginPath(); ctx.arc(c, c, 7, 0, 6.28); ctx.fill();
        g.tex.needsUpdate = true;
    }

    setLight(key, on) {
        const l = this.lights[key];
        if (!l || l.on === on) return;
        l.on = on;
        l.mat.color.setScalar(on ? 1.6 : 0.14);
    }

    // Copy the world's sun and sky light (and night-time instrument lighting) into the cockpit scene
    syncLights(world) {
        this.sun.position.copy(world.sunDir).multiplyScalar(4);
        this.sun.target.position.set(0, 0, 0);
        this.sun.color.copy(world.sun.color);
        this.sun.intensity = world.sun.intensity * 0.9;
        this.hemi.color.copy(world.hemi.color);
        this.hemi.groundColor.copy(world.hemi.groundColor).multiplyScalar(0.6);
        this.hemi.intensity = world.hemi.intensity * 0.8;
        this.scene.environment = world.scene.environment;
        this.scene.environmentIntensity = world.scene.environmentIntensity ?? 1;
        const night = world.timeKey === 'night' ? 1 : world.timeKey === 'dusk' || world.timeKey === 'dawn' ? 0.5 : 0;
        if (night !== this.night) {
            this.night = night;
            this.panelLight.intensity = night * 0.1;
            this.consoleLight.intensity = night * 0.07;
            // backlit legends; screens dim so they don't dazzle at night
            const e = new THREE.Color(0xffc890).multiplyScalar(night * 0.55);
            this.faceMat.emissive.copy(e);
            this.consoleMats.forEach(m => m.emissive.copy(e));
            for (const s of this.screens) s.material.color.setScalar(s.userData.glow * (1 - night * 0.45));
        }
    }

    // glass reflections: sky and sun in view space
    syncGlass(world) {
        const inv = _m.copy(this.camera.matrixWorld).invert();
        const sd = _v.copy(world.sunDir).transformDirection(inv);
        const up = _up.set(0, 1, 0).transformDirection(inv);
        const pal = world.palette;
        const sunUp = world.timeKey === 'night' ? 0.15 : 1;
        for (const m of this.glassMats) {
            if (!m) continue;
            const u = m.uniforms;
            u.sunDirV.value.copy(sd); u.upV.value.copy(up);
            u.sunCol.value.copy(world.sun.color).multiplyScalar(world.sun.intensity * 0.35 * sunUp);
            if (pal) { u.skyTop.value.copy(pal.zenith).multiplyScalar(0.9); u.skyHor.value.copy(pal.horizon).multiplyScalar(0.9); u.ground.value.copy(pal.hemiGround).multiplyScalar(0.5); }
        }
    }

    // ── Per frame ──
    update(dt, game, mainCamera, world, freeLook) {
        const p = game.player;
        if (!p) return;
        this.t += dt;
        this.root.visible = true;
        this.rifle.visible = false;
        this.root.quaternion.copy(p.quat);
        // the pilot's head: pushed down into the seat under G (and forward under negative G), a smooth
        // buffet near the stall / at high speed and low level, and hits and blasts shaking the airframe
        const gk = clamp((p.gLoad - 1) / 8, -0.4, 1);
        this.gShift = damp(this.gShift, gk, 5, dt);
        const t = this.t;
        const agl = p.pos.y - Math.max(terrainHeight(p.pos.x, p.pos.z), 0);
        const buffet = (p.alpha > p.alphaMax * 0.75 ? 0.0035 : 0) + (p.afterburner ? 0.0008 : 0)
            + clamp((p.speed - 250) / 150, 0, 1) * (agl < 300 ? 0.0025 : 0.001) + (p.onGround && p.speed > 5 ? 0.002 : 0);
        const shake = Math.min(1.5, game.shake || 0);
        const n1 = Math.sin(t * 31.7) * 0.6 + Math.sin(t * 17.3 + 1.3) * 0.4;
        const n2 = Math.sin(t * 27.1 + 0.7) * 0.6 + Math.sin(t * 13.9 + 2.1) * 0.4;
        const n3 = Math.sin(t * 23.3 + 2.9) * 0.5 + Math.sin(t * 41.1) * 0.5;
        this.head.set(n1 * buffet, -this.gShift * 0.05 + n2 * buffet, this.gShift * 0.02);
        // camera = aircraft orientation + head look (+ shake)
        _e.set(this.headLook.pitch + n2 * shake * 0.012, this.headLook.yaw + n1 * shake * 0.012, n3 * shake * 0.01, 'YXZ');
        _q.setFromEuler(_e);
        this.camera.quaternion.copy(p.quat).multiply(_q);
        this.camera.position.copy(this.head).applyQuaternion(p.quat);
        mainCamera.quaternion.copy(this.camera.quaternion);
        mainCamera.position.add(this.camera.position);
        this.camera.fov = mainCamera.fov;
        this.camera.aspect = mainCamera.aspect;
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld();

        this.syncLights(world);
        this.syncGlass(world);

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
        this.setLight('brake', p.airbrake || p.wheelBrake);
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
