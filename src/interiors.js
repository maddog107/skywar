// ═══════════════════════════════════════════════════════════════
// Interiors (docs/WAR.md "Interiors and boats"): walk up to a door, a hatch or a boat, press E, and you're in.
//  • sites: entry points in the world (a building's door, a ship's hatch, a boat's gunwale, a ladder) that show a
//    prompt when you're close on foot; E takes them
//  • rooms: first-person interiors with mouse look and walking. Their controls are real meshes — push buttons,
//    toggle switches under flip-up guards, rotary knobs, levers — picked by a ray from the crosshair (or from a
//    free cursor: Tab, or sit at a station), highlighted under the ray, and every one has a keyboard shortcut.
//    Screens are live canvas textures with their own clickable widgets (touch-screen style)
//  • a closed ("sealed") room draws only itself: the world isn't rendered while you're inside (game.indoors tells
//    the renderer, HUD and post effects); a room with windows is added to the world's scene and looks out
//  • controllers take over the player's controls while they're active (game.takeover): a room, a boat's helm, a
//    vehicle's cab — the man on foot (pilot.js) waits, carried along with them
//  • fades between places; rooms keep their state between visits
// The rooms, boats and consoles themselves live in boats.js and warrooms.js; this file is the framework.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, damp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _ax = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _ndc = new THREE.Vector2();
export const FONT = '"Share Tech Mono", ui-monospace, Menlo, monospace';
const EYE = 1.62;          // eye height over the floor (m)
const REACH = 2.6;         // how far you can reach a control while walking (m)

// ═════════════ Screens: a canvas on a mesh, with immediate-mode widgets you can click ═════════════
// draw(ctx, ui, screen) runs at the screen's rate while its room is active (and at once after a click or a hover
// change); ui.button / ui.row / ui.hit register click regions for the next click. Canvas y runs down; the mesh's
// UVs are glTF's (v down), so the texture isn't flipped.
export class ScreenUI {
    constructor(screen) { this.screen = screen; this.hits = []; this.hover = null; }
    begin() { this.hits.length = 0; }
    // a clickable rectangle (no drawing): fn(x, y) gets canvas coordinates
    hit(x, y, w, h, fn, id = null, opts = {}) { this.hits.push({ x, y, w, h, fn, id, disabled: !!opts.disabled, label: opts.label || '' }); }
    over(x, y, w, h) { const p = this.hover; return !!p && p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; }
    // a push button: label, state 'on' (lit), disabled; colour c
    button(x, y, w, h, label, fn, { on = false, disabled = false, c = '#7fd4ff', size = 0, sub = '', id = null, danger = false } = {}) {
        const ctx = this.screen.ctx, hov = !disabled && this.over(x, y, w, h);
        const col = danger ? '#ff5a4a' : c;
        ctx.fillStyle = on ? col : hov ? 'rgba(127,212,255,0.22)' : 'rgba(127,212,255,0.08)';
        if (danger && !on) ctx.fillStyle = hov ? 'rgba(255,90,74,0.3)' : 'rgba(255,90,74,0.12)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = disabled ? 'rgba(127,212,255,0.2)' : col; ctx.lineWidth = hov ? 2.5 : 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = on ? '#061018' : disabled ? 'rgba(200,225,240,0.3)' : '#e8f4ff';
        const fs = size || Math.max(11, Math.min(22, Math.round(h * 0.42)));
        ctx.font = '700 ' + fs + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + h / 2 - (sub ? fs * 0.35 : 0), w - 6);
        if (sub) { ctx.font = '600 ' + Math.round(fs * 0.62) + 'px ' + FONT; ctx.fillText(sub, x + w / 2, y + h / 2 + fs * 0.55, w - 6); }
        if (fn) this.hit(x, y, w, h, fn, id || label, { disabled, label });
        return hov;
    }
    // a selectable list row
    row(x, y, w, h, cells, fn, { sel = false, disabled = false, colors = null, id = null, label = null } = {}) {
        const ctx = this.screen.ctx, hov = !disabled && this.over(x, y, w, h);
        if (sel || hov) { ctx.fillStyle = sel ? 'rgba(127,212,255,0.28)' : 'rgba(127,212,255,0.12)'; ctx.fillRect(x, y, w, h); }
        if (sel) { ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
        ctx.font = '600 ' + Math.max(10, Math.round(h * 0.55)) + 'px ' + FONT; ctx.textBaseline = 'middle';
        let cx = x + 6;
        cells.forEach((c, i) => {
            const [t, cw, al] = Array.isArray(c) ? c : [c, (w - 12) / cells.length, 'left'];
            ctx.textAlign = al || 'left';
            ctx.fillStyle = disabled ? 'rgba(200,225,240,0.35)' : colors && colors[i] ? colors[i] : '#dcecf8';
            ctx.fillText(String(t), al === 'right' ? cx + cw - 4 : cx, y + h / 2, cw - 4);
            cx += cw;
        });
        if (fn) this.hit(x, y, w, h, fn, id, { disabled, label: label ?? String(Array.isArray(cells[0]) ? cells[0][0] : cells[0] ?? '') });
        return hov;
    }
    find(x, y) {
        for (let i = this.hits.length - 1; i >= 0; i--) { const r = this.hits[i]; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r; }
        return null;
    }
}

export class Screen {
    constructor(id, mesh, w = 1024, h = 640, def = {}) {
        this.id = id; this.mesh = mesh; this.w = w; this.h = h; this.def = def;
        this.fps = def.fps || 6;
        this.t = Math.random() / this.fps; // (staggered)
        this.dirty = true;
        this.ui = new ScreenUI(this);
        this.canvas = null; this.ctx = null; this.tex = null;
        if (typeof document !== 'undefined' && document.createElement) {
            this.canvas = document.createElement('canvas');
            this.canvas.width = w; this.canvas.height = h;
            this.ctx = this.canvas.getContext('2d');
            this.tex = new THREE.CanvasTexture(this.canvas);
            this.tex.colorSpace = THREE.SRGBColorSpace;
            this.tex.flipY = false;
            this.tex.anisotropy = 4;
        }
        if (mesh) {
            // a lit panel: the picture glows (and blooms a little where it's bright)
            const k = def.bright ?? 1.25;
            if (def.feed) {
                // a video feed (a render target) under the canvas: where the canvas is transparent the feed shows
                this.feedU = { overlay: { value: this.tex }, feed: { value: null }, has: { value: 0 }, k: { value: k } };
                mesh.material = new THREE.ShaderMaterial({
                    uniforms: this.feedU,
                    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                    fragmentShader: 'uniform sampler2D overlay, feed; uniform float has, k; varying vec2 vUv;\n' +
                        'void main() { vec4 o = texture2D(overlay, vUv); vec3 f = has > 0.5 ? texture2D(feed, vec2(vUv.x, 1.0 - vUv.y)).rgb : vec3(0.0);\n' +
                        '  gl_FragColor = vec4(mix(f, o.rgb * k, o.a), 1.0); }',
                });
            } else mesh.material = new THREE.MeshBasicMaterial({ map: this.tex, color: new THREE.Color(k, k, k) });
            mesh.userData.ctlRef = this;
        }
    }
    // (a feed screen) the render target to show under the canvas, or null
    setFeed(tex) { if (!this.feedU) return; this.feedU.feed.value = tex; this.feedU.has.value = tex ? 1 : 0; }
    get kind() { return 'screen'; }
    // canvas coordinates of a hit's uv
    toCanvas(uv, out = {}) { out.x = uv.x * this.w; out.y = uv.y * this.h; return out; }
    hoverAt(uv) {
        const p = uv ? this.toCanvas(uv, this._hp || (this._hp = {})) : null;
        const was = this.ui.hover, a = was ? this.ui.find(was.x, was.y) : null, b = p ? this.ui.find(p.x, p.y) : null;
        this.ui.hover = p ? { x: p.x, y: p.y } : null;
        if (a !== b) this.dirty = true;
        return b;
    }
    // a click: the widget under it runs (returns it), or null
    click(uv) {
        const p = this.toCanvas(uv);
        const r = this.ui.find(p.x, p.y);
        if (!r || r.disabled) return r ? { blocked: true, r } : null;
        try { r.fn(p.x, p.y); } catch (e) { console.warn('[interiors] screen click', e); }
        this.dirty = true;
        return r;
    }
    label(uv) { const p = this.toCanvas(uv); const r = this.ui.find(p.x, p.y); return r ? r.label : ''; }
    update(dt, game, room) {
        this.t += dt;
        if (!this.dirty && this.t < 1 / this.fps) return;
        this.t = 0; this.dirty = false;
        this.redraw(game, room);
    }
    redraw(game, room) {
        if (!this.ctx || !this.def.draw) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ui.begin();
        try { this.def.draw(ctx, this.ui, this, game, room); } catch (e) { if (!this._err) { this._err = true; console.warn('[interiors] screen', this.id, e); } }
        ctx.restore();
        this.tex.needsUpdate = true;
    }
}

// ═════════════ Controls: the moving, clickable meshes of a room ═════════════
// node extras "ctl" (JSON, from tools/interiors/roomkit.py):
//   { t: 'button', slide: [x,y,z], travel: m }         push button (springs back)
//   { t: 'switch', hinge: [x,y,z], open: rad }          toggle switch (two positions)
//   { t: 'guard', hinge: [x,y,z], open: rad, for: name } flip-up cover over another control
//   { t: 'knob', hinge: [x,y,z], open: rad, steps: n }  rotary selector (open = the whole arc)
//   { t: 'lever', hinge: [x,y,z], open: rad, steps: n } lever / throttle (steps 0 = continuous)
//   { t: 'lamp' }                                       an indicator (lit by the binding)
//   { t: 'exit' } / { t: 'door' }                       leave (or go somewhere else)
//   { t: 'screen', w, h }                               a canvas screen (mesh with 0..1 UVs)
//   { t: 'station', fov }                               empty: where the camera sits at a console (looks −Z)
//   { t: 'spawn' }                                      empty: where you stand on entering (looks −Z)
export class Control {
    constructor(name, node, spec) {
        this.id = name; this.node = node; this.spec = spec; this.kind = spec.t;
        this.p0 = node.position.clone(); this.q0 = node.quaternion.clone();
        this.k = 0; this.target = 0; this.value = 0;
        this.meshes = [];
        node.traverse(o => { if (o.isMesh) { this.meshes.push(o); o.userData.ctlRef = this; } });
        this.bind = null;        // behaviour (warrooms.js): { label, key, press(ctl), enabled(), lit(), value() }
        this.guard = null;       // the guard over this control
        this.guards = null;      // (a guard) the control it covers
        this.lampMat = null;
        this.pulse = 0;
        this.steps = spec.steps || (this.kind === 'knob' ? 6 : 0);
    }
    get open() { return this.kind === 'guard' ? this.target > 0.5 : false; }
    get label() { const b = this.bind; return b ? (typeof b.label === 'function' ? b.label() : b.label) || this.id : this.id; }
    enabled() { const b = this.bind; return !b || !b.enabled ? true : !!b.enabled(); }
    // the pose for k (0..1: released … pressed, off … on, closed … open, first … last step)
    pose(k) {
        const s = this.spec, o = this.node;
        this.k = k;
        if (s.hinge) o.quaternion.copy(this.q0).multiply(_q.setFromAxisAngle(_ax.fromArray(s.hinge), (s.open || 0) * k));
        if (s.slide) o.position.copy(this.p0).addScaledVector(_ax.fromArray(s.slide).applyQuaternion(this.q0), (s.travel || 0) * k);
    }
    // per frame: animate toward the target; push buttons spring back; lamps follow their binding
    update(dt) {
        const b = this.bind;
        if (this.kind === 'button') {
            this.pulse = Math.max(0, this.pulse - dt);
            this.pose(this.pulse > 0 ? 1 : damp(this.k, 0, 30, dt));
        } else if (this.kind === 'switch' || this.kind === 'guard' || this.kind === 'knob' || this.kind === 'lever') {
            if (b && b.value && this.kind !== 'guard') {
                const v = b.value();
                this.target = this.kind === 'switch' ? (v ? 1 : 0) : clamp(v, 0, 1);
            }
            const rate = this.kind === 'guard' ? 14 : 22;
            if (Math.abs(this.k - this.target) > 1e-4) this.pose(damp(this.k, this.target, rate, dt));
        }
        if (this.lampMat && b && b.lit) {
            const on = b.lit();
            const lv = on === true ? 1 : on === false || on == null ? 0 : +on;
            if (lv !== this._lv) { this._lv = lv; this.lampMat.emissiveIntensity = 0.04 + lv * 2.6; }
        }
    }
}

// ═════════════ Rooms ═════════════
// def: { id, name, file (GLB) | build(room) (procedural), sealed (default true), anchor(out Matrix4) → the room's
// world matrix, exitTo() → { pos, yaw } outside, canExit() → true | 'why not', bind: { node name: behaviour },
// screens: { node name: { fps, draw, bright } }, stations: { node name: { label } }, keys: [{ code, label, run }],
// status() → a line for the HUD, update(dt, room), onEnter(room), onExit(room), views: { name: view controller } }
const loader = { gltf: null };
const roomCache = new Map();       // file → Promise<gltf scene>
let envTex = null;

export class Room {
    constructor(def) {
        this.def = def;
        this.id = def.id;
        this.name = def.name || def.id;
        this.sealed = def.sealed !== false;
        this.group = new THREE.Group();
        this.group.name = 'room:' + this.id;
        this.group.matrixAutoUpdate = false;
        this.scene = null;                  // (sealed) the room's own scene: model, lights, environment
        this.controls = new Map();
        this.screens = new Map();
        this.stations = [];
        this.pickables = [];
        this.walk = [];                     // [x0, x1, z0, z1, floor y]
        this.spawn = { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };
        this.exits = [];
        this.state = {};                    // the room's own state (warrooms.js), kept between visits
        this.loaded = false;
        this.loading = null;
        this.visits = 0;
        this.eye = EYE;
    }

    // world matrix of the room's origin, now
    anchor(out) {
        if (this.def.anchor) return this.def.anchor(out) || out.identity();
        return out.identity();
    }
    place() {
        this.anchor(this.group.matrix);
        this.group.matrixWorldNeedsUpdate = true;
        this.group.updateMatrixWorld(true);
    }

    load() {
        if (this.loaded) return Promise.resolve(this);
        if (this.loading) return this.loading;
        const def = this.def;
        if (def.build) {
            const root = new THREE.Group();
            def.build(root, this);
            this.setModel(root);
            return (this.loading = Promise.resolve(this));
        }
        if (!roomCache.has(def.file)) {
            loader.gltf = loader.gltf || new GLTFLoader();
            roomCache.set(def.file, loader.gltf.loadAsync(def.file).then(g => g.scene));
        }
        this.loading = roomCache.get(def.file).then(scene => { this.setModel(scene.clone(true)); return this; })
            .catch(e => {
                console.warn('[interiors] room model not loaded:', def.file, e && e.message);
                roomCache.delete(def.file); this.loading = null;
                if (def.fallback) { const r = new THREE.Group(); def.fallback(r, this); this.setModel(r); }
                return this;
            });
        return this.loading;
    }

    // take a model (GLB scene or a procedural group): controls, screens, stations, walk areas, lights
    setModel(root) {
        this.model = root;
        this.group.add(root);
        let meta = null;
        root.traverse(o => {
            const u = o.userData || {};
            if (!meta && typeof u.room === 'string') { try { meta = JSON.parse(u.room); } catch (e) { /* ignore */ } }
            else if (!meta && u.room && typeof u.room === 'object') meta = u.room;
            if (o.isMesh) { o.castShadow = !!this.def.shadows; o.receiveShadow = !!this.def.shadows; }
        });
        const nodes = [];
        root.traverse(o => {
            let spec = o.userData && o.userData.ctl;
            if (typeof spec === 'string') { try { spec = JSON.parse(spec); } catch (e) { spec = null; } }
            if (spec && typeof spec === 'object' && spec.t) { o.userData.ctlSpec = spec; nodes.push(o); }
        });
        for (const o of nodes) {
            const spec = o.userData.ctlSpec, name = o.name;
            if (spec.t === 'screen') {
                const mesh = o.isMesh ? o : o.getObjectByProperty('isMesh', true);
                const sdef = (this.def.screens && this.def.screens[name]) || {};
                const s = new Screen(name, mesh, spec.w || sdef.w || 1024, spec.h || sdef.h || 640, sdef);
                this.screens.set(name, s);
                if (mesh) this.pickables.push(mesh);
            } else if (spec.t === 'station') {
                const sd = (this.def.stations && this.def.stations[name]) || {};
                this.stations.push({ id: name, node: o, fov: sd.fov || spec.fov || 55, label: sd.label || spec.label || name.replace(/^stand_/, '').toUpperCase(), key: sd.key, order: sd.order ?? 99 });
            } else if (spec.t === 'spawn') {
                this.spawn = { pos: o.position.clone(), yaw: new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y };
            } else {
                const c = new Control(name, o, spec);
                this.controls.set(name, c);
                this.pickables.push(...c.meshes);
                if (spec.t === 'exit' || spec.t === 'door') this.exits.push(c);
                if (spec.t === 'lamp' || spec.lamp) {
                    // a lamp's own material (emissive, driven by its binding)
                    for (const m of c.meshes) {
                        const src = Array.isArray(m.material) ? m.material[0] : m.material;
                        const lm = src && src.isMeshStandardMaterial ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x222222 });
                        if (!lm.emissive || lm.emissive.getHex() === 0) lm.emissive = new THREE.Color(spec.color || '#ff3a20');
                        lm.emissiveIntensity = 0.04;
                        m.material = lm; c.lampMat = lm;
                    }
                }
            }
        }
        this.stations.sort((a, b) => a.order - b.order);
        // guards find what they cover: spec.for, else the control with the same name after the prefix
        for (const c of this.controls.values()) {
            if (c.kind !== 'guard') continue;
            const base = c.spec.for || c.id.replace(/^guard_/, '');
            const t = this.controls.get(base) || [...this.controls.values()].find(x => x !== c && x.id.replace(/^[a-z]+_/, '') === base);
            if (t) { c.guards = t; t.guard = c; }
        }
        if (meta) {
            if (meta.walk) this.walk = meta.walk.map(w => w.slice());
            if (meta.holes) this.holes = meta.holes.map(w => w.slice());
            if (meta.eye) this.eye = meta.eye;
            this.meta = meta;
        }
        if (!this.walk.length) this.walk = [[-2, 2, -2, 2, 0]];
        // bindings
        for (const [name, b] of Object.entries(this.def.bind || {})) { const c = this.controls.get(name); if (c) c.bind = b; }
        if (this.sealed) {
            this.scene = new THREE.Scene();
            this.scene.name = 'interior:' + this.id;
            this.scene.background = new THREE.Color(meta && meta.bg || '#05070a');
            this.scene.add(this.group);
            for (const L of (meta && meta.lights) || this.def.lights || [{ t: 'hemi', sky: '#c8d4e0', ground: '#303438', i: 1.2 }, { t: 'point', p: [0, 2.4, 0], c: '#fff1dd', i: 6, d: 14 }]) this.addLight(L);
        }
        this.loaded = true;
        if (this.def.onLoad) this.def.onLoad(this);
    }

    // lights of a closed room (in room coordinates; they ride along with the room's group)
    addLight(L) {
        let light;
        const col = new THREE.Color(L.c || '#ffffff');
        if (L.t === 'hemi') light = new THREE.HemisphereLight(new THREE.Color(L.sky || '#ffffff'), new THREE.Color(L.ground || '#202020'), L.i ?? 1);
        else if (L.t === 'spot') { light = new THREE.SpotLight(col, L.i ?? 10, L.d ?? 10, L.a ?? 0.8, L.pen ?? 0.6, 1.6); light.target.position.fromArray(L.to || [L.p[0], 0, L.p[2]]); this.group.add(light.target); }
        else if (L.t === 'dir') { light = new THREE.DirectionalLight(col, L.i ?? 1); light.target.position.fromArray(L.to || [0, 0, 0]); this.group.add(light.target); }
        else light = new THREE.PointLight(col, L.i ?? 5, L.d ?? 10, 1.7);
        if (L.p) light.position.fromArray(L.p);
        light.userData.base = light.intensity;
        light.name = L.name || '';
        this.group.add(light);
        (this.lights || (this.lights = [])).push(light);
        return light;
    }

    // the environment map for a closed room's reflections (one for all rooms)
    ensureEnv(renderer) {
        if (!this.scene || this.scene.environment || !renderer) return;
        if (!envTex) {
            try {
                const pm = new THREE.PMREMGenerator(renderer);
                envTex = pm.fromScene(roomEnvScene(), 0.03).texture;
                pm.dispose();
            } catch (e) { envTex = null; }
        }
        if (envTex) { this.scene.environment = envTex; this.scene.environmentIntensity = this.def.envIntensity ?? 0.55; }
    }

    // which control / screen is under a ray: { ref, hit } or null
    pick(raycaster, far = REACH) {
        raycaster.far = far;
        raycaster.near = 0;
        const hits = raycaster.intersectObjects(this.pickables, false);
        for (const h of hits) {
            const ref = h.object.userData.ctlRef;
            if (!ref) continue;
            if (!h.object.visible) continue;
            return { ref, hit: h };
        }
        return null;
    }

    update(dt, game) {
        for (const c of this.controls.values()) c.update(dt);
        for (const s of this.screens.values()) s.update(dt, game, this);
        if (this.def.update) this.def.update(dt, this, game);
    }
}

// a neutral grey box with a few bright panels: soft reflections on the consoles and screens of a closed room
function roomEnvScene() {
    const s = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), new THREE.MeshBasicMaterial({ color: 0x2a2e33, side: THREE.BackSide }));
    s.add(box);
    for (const [x, y, z, w, h, c] of [[0, 1.95, 0, 6, 0.4, 0xdfe8f0], [-4.9, 0.6, 0, 0.1, 1, 0x7fa0c0], [4.9, 0.6, 0, 0.1, 1, 0x7fa0c0], [0, 0.4, -4.9, 4, 1, 0x406080]]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.1), Math.max(h, 0.1), x === 0 && z === 0 ? 3 : 0.1), new THREE.MeshBasicMaterial({ color: c }));
        p.position.set(x, y, z);
        s.add(p);
    }
    return s;
}

// ═════════════ Room controller: you, inside a room ═════════════
// Walk (WASD) and look (mouse); the crosshair picks controls within reach, LMB presses them. Tab frees a cursor
// (the view holds still; the mouse moves the cursor; LMB clicks what's under it). A station (a console's seat) puts
// the camera at the console with the cursor out: click its screen while walking, or press its number (1–9).
// E at an exit (or clicking it) leaves.
export class RoomController {
    constructor(sys, room, opts = {}) {
        this.sys = sys; this.game = sys.game; this.room = room;
        this.kind = 'room';
        const sp = opts.spawn || room.spawn;
        this.pos = sp.pos.clone();           // feet, room coordinates
        this.yaw = sp.yaw || 0; this.pitch = opts.pitch || 0;
        this.station = null;                 // focused station
        this.focusK = 0;                     // 0 walking … 1 at the station
        this.cursor = null;                  // { x, y } screen px when the cursor is out
        this.hover = null;                   // { ref, hit, label, blocked }
        this.prevLeft = true; this.prevKeys = {};
        this.view = null;                    // a view that takes over (periscope, bridge…)
        this.bob = 0;
        this.raycaster = new THREE.Raycaster();
        this.camPos = new THREE.Vector3(); this.camQuat = new THREE.Quaternion();
        this.fromPos = new THREE.Vector3(); this.fromQuat = new THREE.Quaternion();
    }

    get sealed() { return this.room.sealed && !(this.view && this.view.outside); }

    press(code) { const d = this.game.input.down(code), p = d && !this.prevKeys[code]; this.prevKeys[code] = d; return p; }

    enter() {
        const r = this.room;
        r.visits++;
        this.sys.syncCursor = true;
        if (r.def.onEnter) r.def.onEnter(r, this);
        for (const s of r.screens.values()) s.dirty = true;
    }
    exit() {
        const r = this.room;
        if (this.view && this.view.leave) this.view.leave(this);
        this.view = null;
        if (r.def.onExit) r.def.onExit(r, this);
        if (!r.sealed && r.group.parent) r.group.parent.remove(r.group); // (a room with windows was in the world's scene)
        this.sys.highlight(null);
    }

    // world position of the eye (and the camera's orientation) for the current pose
    eyeWorld(out) { return out.copy(this.camPos); }

    setView(v) {
        if (this.view && this.view.leave) this.view.leave(this);
        this.view = v || null;
        if (v && v.enter) v.enter(this);
        this.cursor = null; this.hover = null;
    }

    focus(st) {
        if (st === this.station) return;
        this.fromPos.copy(this.camPos); this.fromQuat.copy(this.camQuat);
        this.station = st;
        this.focusK = 0;
        this.cursor = st ? { x: this.game.hud.w / 2, y: this.game.hud.h * 0.55 } : null;
        this.game.audio.tick(st ? 900 : 600, 0.05, 0.04);
    }

    control(dt, mouse) {
        const g = this.game, input = g.input, r = this.room;
        if (this.view) { this.view.control(dt, mouse, this); this.updatePose(dt); return; }
        const sens = 0.0022 * (g.settings.sensitivity || 1);
        // number keys: stations (the command menu gets them first when it's open)
        if (this.cursor) {
            this.cursor.x = clamp(this.cursor.x + mouse.dx, 4, g.hud.w - 4);
            this.cursor.y = clamp(this.cursor.y + mouse.dy, 4, g.hud.h - 4);
            // at a station the view follows the cursor a little toward the edges
            if (this.station) {
                const ex = this.cursor.x / g.hud.w - 0.5, ey = this.cursor.y / g.hud.h - 0.5;
                this.lookOff = this.lookOff || { yaw: 0, pitch: 0 };
                this.lookOff.yaw = damp(this.lookOff.yaw, -Math.sign(ex) * Math.max(0, Math.abs(ex) - 0.38) * 1.6, 4, dt);
                this.lookOff.pitch = damp(this.lookOff.pitch, -Math.sign(ey) * Math.max(0, Math.abs(ey) - 0.38) * 1.2, 4, dt);
            }
        } else {
            this.yaw -= mouse.dx * sens;
            this.pitch = clamp(this.pitch - mouse.dy * sens * (g.settings.invertPitch ? -1 : 1), -1.35, 1.35);
        }
        // walking (not at a station)
        if (!this.station) this.walk(dt, input);
        else if (input.down('KeyW', 'KeyA', 'KeyS', 'KeyD') && this.focusK > 0.9 && !this.anyHeld) this.focus(null);
        this.anyHeld = input.down('KeyW', 'KeyA', 'KeyS', 'KeyD');
        this.updatePose(dt);
        // what's under the crosshair / cursor
        this.updateHover();
        const left = input.mouse.left;
        if (left && !this.prevLeft) this.click();
        this.prevLeft = left;
        if (mouse.wheel && this.hover && this.hover.ref instanceof Control) this.turn(this.hover.ref, mouse.wheel > 0 ? 1 : -1);
        else if (mouse.wheel && this.hover && this.hover.ref instanceof Screen && this.hover.ref.def.wheel) { this.hover.ref.def.wheel(mouse.wheel > 0 ? 1 : -1, this.hover.ref, g, r); this.hover.ref.dirty = true; }
        // keyboard shortcuts: every bound control with a key, and the room's own keys
        for (const c of r.controls.values()) {
            const b = c.bind;
            if (b && b.key && this.press(b.key)) this.activate(c, true);
        }
        for (const k of r.def.keys || []) if (this.press(k.code)) { try { k.run(this, g); } catch (e) { console.warn(e); } }
        // leave: E at an exit (or anywhere with the room's leave key)
        if (this.press('KeyE')) {
            const near = this.nearExit();
            if (near) this.activate(near, false);
            else if (this.hover && this.hover.ref instanceof Control) this.activate(this.hover.ref, false);
            else g.addFeed('E — WALK TO THE ' + (r.def.exitName || 'EXIT') + ' TO LEAVE', '#9fb2c4');
        }
    }

    nearExit() {
        let best = null, bd = 2.4;
        for (const c of this.room.exits) {
            c.node.getWorldPosition(_v); // (world; compare with the camera)
            const d = _v.distanceTo(this.camPos);
            if (d < bd) { bd = d; best = c; }
        }
        return best;
    }

    walk(dt, input) {
        const r = this.room;
        const f = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
        const s = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
        const speed = (input.down('ShiftLeft', 'ShiftRight') ? 2.6 : 1.5) * (f || s ? 1 : 0);
        this.moveK = damp(this.moveK || 0, speed, 10, dt);
        if (this.moveK < 0.01) return;
        let mx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s, mz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s;
        const L = Math.hypot(mx, mz) || 1;
        mx *= this.moveK * dt / L; mz *= this.moveK * dt / L;
        // slide along the walls: x and z separately; steps up/down of 0.5 m between walk areas (tiers, stairs)
        const tryMove = (nx, nz) => {
            const fl = floorAt(r.walk, nx, nz, this.pos.y, r.holes);
            if (fl == null) return false;
            this.pos.x = nx; this.pos.z = nz; this.pos.y = fl;
            return true;
        };
        if (!tryMove(this.pos.x + mx, this.pos.z + mz)) { tryMove(this.pos.x + mx, this.pos.z); tryMove(this.pos.x, this.pos.z + mz); }
        this.bob += dt * this.moveK * 5.5;
    }

    // the camera: walking pose (eye over the feet, bobbing a little) blended into the station's pose
    updatePose(dt) {
        const r = this.room;
        r.place();
        const A = r.group.matrixWorld;
        if (this.view && this.view.pose) { this.view.pose(this, this.camPos, this.camQuat); return; }
        const bob = Math.sin(this.bob) * 0.025 * clamp(this.moveK || 0, 0, 1);
        const walkPos = _v.set(this.pos.x, this.pos.y + r.eye + bob, this.pos.z).applyMatrix4(A);
        _e.set(this.pitch, this.yaw, 0, 'YXZ');
        const walkQuat = _q.setFromRotationMatrix(_m.extractRotation(A)).multiply(_q2.setFromEuler(_e));
        if (this.station) {
            this.focusK = Math.min(1, this.focusK + dt / 0.45);
            const k = this.focusK * this.focusK * (3 - 2 * this.focusK);
            const n = this.station.node;
            n.updateWorldMatrix(true, false);
            const sp = _v2.setFromMatrixPosition(n.matrixWorld);
            const sq = _q2.setFromRotationMatrix(_m2.extractRotation(n.matrixWorld));
            if (this.lookOff) sq.multiply(_q.setFromEuler(_e.set(this.lookOff.pitch, this.lookOff.yaw, 0, 'YXZ')));
            this.camPos.copy(this.fromPos).lerp(sp, k);
            this.camQuat.copy(this.fromQuat).slerp(sq, k);
            if (k >= 1) { this.camPos.copy(sp); this.camQuat.copy(sq); }
        } else if (this.focusK > 0 && this.station === null && this.fromQuat.lengthSq() > 0 && this._leaving) {
            this.camPos.copy(walkPos); this.camQuat.copy(walkQuat);
        } else { this.camPos.copy(walkPos); this.camQuat.copy(walkQuat); }
    }

    updateHover() {
        const g = this.game, cam = g.camera, r = this.room;
        cam.position.copy(this.camPos); cam.quaternion.copy(this.camQuat); cam.updateMatrixWorld();
        if (this.cursor) _ndc.set(this.cursor.x / g.hud.w * 2 - 1, -(this.cursor.y / g.hud.h * 2 - 1));
        else _ndc.set(0, 0);
        this.raycaster.setFromCamera(_ndc, cam);
        const reach = this.station || this.cursor ? 4.5 : REACH;
        const h = r.pick(this.raycaster, reach);
        const prev = this.hover && this.hover.ref;
        if (prev && prev instanceof Screen && (!h || h.ref !== prev)) prev.hoverAt(null);
        if (!h) { this.hover = null; this.sys.highlight(null); return; }
        let label = '', blocked = '';
        if (h.ref instanceof Screen) {
            // (walking, a console's screen sits you down at it: its widgets wait for the cursor)
            const st = !this.cursor && !this.station ? this.stationFor(h.ref) : null;
            h.ref.hoverAt(st ? null : h.hit.uv);
            label = st ? 'CLICK: SIT AT ' + st.label : h.ref.label(h.hit.uv);
            this.sys.highlight(null);
        } else {
            const c = h.ref;
            label = c.label;
            if (c.guard && !c.guard.open) blocked = 'GUARD CLOSED — FLIP UP THE GUARD FIRST';
            else if (!c.enabled()) blocked = (c.bind && c.bind.why && c.bind.why()) || 'NOT AVAILABLE';
            if (c.kind === 'guard') label = (c.open ? 'CLOSE ' : 'LIFT ') + 'GUARD — ' + (c.guards ? c.guards.label : '');
            if (c.bind && c.bind.key) label += '  [' + keyName(c.bind.key) + ']';
            this.sys.highlight(c.kind === 'lamp' ? null : c);
        }
        this.hover = { ref: h.ref, hit: h.hit, label, blocked };
    }

    stationFor(screen) {
        let best = null, bd = Infinity;
        screen.mesh.getWorldPosition(_v);
        for (const st of this.room.stations) {
            st.node.getWorldPosition(_v2);
            const d = _v.distanceTo(_v2);
            if (d < bd) { bd = d; best = st; }
        }
        return bd < 3 ? best : null;
    }

    click() {
        const h = this.hover, g = this.game;
        if (!h) { if (this.station && !this.cursor) this.focus(null); return; }
        if (h.ref instanceof Screen) {
            // walking: the first click on a console's screen sits you down at it
            if (!this.cursor && !this.station) {
                const st = this.stationFor(h.ref);
                if (st) { this.focus(st); return; }
            }
            const r = h.ref.click(h.hit.uv);
            if (r && r.blocked) g.audio.tick(260, 0.06, 0.05);
            else if (r) g.audio.tick(1700, 0.045, 0.03);
            return;
        }
        this.activate(h.ref, false);
    }

    // press / flip / turn a control (fromKey: a keyboard shortcut — a guarded control's key lifts the guard first)
    activate(c, fromKey) {
        const g = this.game, b = c.bind;
        if (c.kind === 'lamp') return;
        if (c.kind === 'guard') {
            c.target = c.open ? 0 : 1;
            g.audio.tick(c.open ? 700 : 520, 0.06, 0.05);
            if (b && b.press) b.press(c, this);
            return;
        }
        if (c.guard && !c.guard.open) {
            if (fromKey) { c.guard.target = 1; g.audio.tick(700, 0.06, 0.05); g.addFeed('GUARD UP — ' + c.label + ': PRESS AGAIN', '#ffc23f'); }
            else { g.audio.tick(260, 0.06, 0.05); g.addFeed('GUARD CLOSED — LIFT THE GUARD FIRST', '#ffc23f'); }
            return;
        }
        if (!c.enabled()) {
            g.audio.tick(260, 0.06, 0.05);
            const why = b && b.why ? b.why() : '';
            if (why) g.addFeed(why, '#ffc23f');
            return;
        }
        if (c.kind === 'button') { c.pulse = 0.14; g.audio.tick(1250, 0.06, 0.04); }
        else if (c.kind === 'switch') { c.target = c.target > 0.5 ? 0 : 1; g.audio.tick(380, 0.1, 0.03); g.audio.tick(1900, 0.04, 0.015, 0.02); }
        else if (c.kind === 'knob' || c.kind === 'lever') { this.turn(c, 1); return; }
        else if (c.kind === 'exit' || c.kind === 'door') { if (b && b.press) b.press(c, this); else this.sys.leave(); return; }
        if (b && b.press) { try { b.press(c, this); } catch (e) { console.warn('[interiors] control', c.id, e); } }
        if (c.guard && c.kind === 'button' && !(b && b.keepGuard)) c.guard.target = 0; // (a fired guard drops back)
    }

    // knobs and levers: one step (dir ±1) — the binding decides what the value means
    turn(c, dir) {
        const g = this.game, b = c.bind;
        if (!(c.kind === 'knob' || c.kind === 'lever')) return;
        if (!c.enabled()) { g.audio.tick(260, 0.06, 0.05); return; }
        if (b && b.turn) b.turn(dir, c, this);
        else {
            const n = Math.max(2, c.steps || 2);
            const i = clamp(Math.round(c.target * (n - 1)) + dir, 0, n - 1);
            c.target = i / (n - 1);
            if (b && b.press) b.press(c, this, i);
        }
        g.audio.tick(c.kind === 'knob' ? 1500 : 600, 0.05, 0.02);
    }

    camera(cam, dt) {
        const g = this.game;
        if (this.view && this.view.camera) return this.view.camera(cam, dt, this);
        cam.position.copy(this.camPos);
        cam.quaternion.copy(this.camQuat);
        cam.up.set(0, 1, 0);
        const fov = this.station ? this.station.fov : 70;
        cam.fov = damp(cam.fov, fov, 8, dt);
        cam.updateProjectionMatrix();
        void g;
    }

    action(a) {
        if (this.view && this.view.action && this.view.action(a, this)) return true;
        const own = this.room.def.actions && this.room.def.actions[a];
        if (own && own(this, this.game) !== false) return true;
        if (a === 'target') { // Tab / T: the cursor out (or back)
            if (this.station) { this.focus(null); return true; }
            this.cursor = this.cursor ? null : { x: this.game.hud.w / 2, y: this.game.hud.h / 2 };
            this.game.audio.tick(this.cursor ? 1100 : 800, 0.04, 0.03);
            return true;
        }
        if (a === 'pause' && (this.station || this.cursor || this.view)) {
            if (this.view) this.setView(null); else if (this.station) this.focus(null); else this.cursor = null;
            return true;
        }
        if (a === 'missile' && (this.station || this.cursor)) { if (this.station) this.focus(null); else this.cursor = null; return true; } // RMB backs out
        const m = /^thr(\d+)$/.exec(a);
        if (m) {
            const n = +m[1];
            const st = this.room.stations[n - 1];
            if (n === 10 || !st) { if (this.station) this.focus(null); return true; }
            this.focus(this.station === st ? null : st);
            return true;
        }
        if (['designate', 'camera', 'photo', 'flares', 'flaps', 'weapon', 'loadout', 'confirm', 'nvg', 'spoilers', 'gear', 'hook', 'eject', 'autoland', 'autotakeoff', 'spawn'].includes(a)) return true;
        return false;
    }

    hud(ctx, hud) {
        const g = this.game, r = this.room, W = hud.w, H = hud.h, C = hud.compact;
        if (this.view && this.view.hud) { this.view.hud(ctx, hud, this); return; }
        ctx.save();
        ctx.textBaseline = 'middle';
        // the crosshair or the cursor
        const h = this.hover;
        const hot = h && !h.blocked && (h.ref instanceof Control ? h.ref.kind !== 'lamp' : !!h.label);
        if (this.cursor) {
            const { x, y } = this.cursor;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 17); ctx.lineTo(x + 4.5, y + 13); ctx.lineTo(x + 11, y + 13); ctx.closePath(); ctx.stroke();
            ctx.fillStyle = hot ? '#aef3ff' : '#ffffff'; ctx.fill();
        } else {
            ctx.strokeStyle = hot ? '#aef3ff' : 'rgba(255,255,255,0.85)'; ctx.lineWidth = hot ? 2 : 1.5;
            ctx.beginPath(); ctx.arc(W / 2, H / 2, hot ? 9 : 5, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = hot ? '#aef3ff' : 'rgba(255,255,255,0.9)';
            ctx.beginPath(); ctx.arc(W / 2, H / 2, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        // what's under it
        if (h && (h.label || h.blocked)) {
            const x = this.cursor ? this.cursor.x + 16 : W / 2 + 16, y = this.cursor ? this.cursor.y + 22 : H / 2 + 20;
            ctx.font = '700 ' + (C ? 12 : 14) + 'px ' + FONT; ctx.textAlign = 'left';
            const t1 = h.label || '', t2 = h.blocked || '';
            const w = Math.max(ctx.measureText(t1).width, t2 ? ctx.measureText(t2).width : 0) + 14;
            ctx.fillStyle = 'rgba(4,10,16,0.72)'; ctx.fillRect(x - 7, y - 11, w, t2 ? 38 : 22);
            ctx.fillStyle = h.blocked ? '#ffc23f' : '#e8f4ff'; ctx.fillText(t1, x, y);
            if (t2) { ctx.fillStyle = '#ffc23f'; ctx.font = '600 ' + (C ? 11 : 12) + 'px ' + FONT; ctx.fillText(t2, x, y + 17); }
        }
        // where you are and the room's status
        const M = C ? 14 : 28;
        ctx.textAlign = 'left';
        ctx.font = '700 ' + (C ? 13 : 16) + 'px ' + FONT; ctx.fillStyle = '#e8f4ff';
        ctx.fillText(typeof r.def.title === 'function' ? r.def.title(r) : (r.def.title || r.name), M, C ? 22 : 34, W * 0.6);
        const st = r.def.status ? r.def.status(r, g) : '';
        if (st) { ctx.font = '600 ' + (C ? 11 : 13) + 'px ' + FONT; ctx.fillStyle = '#9fd4ff'; ctx.fillText(st, M, C ? 40 : 56, W * 0.7); }
        // stations
        if (r.stations.length) {
            ctx.font = '600 ' + (C ? 10 : 12) + 'px ' + FONT;
            let y = C ? 58 : 80;
            r.stations.forEach((s, i) => {
                if (i > 8) return;
                const on = s === this.station;
                ctx.fillStyle = on ? '#5dffa0' : 'rgba(232,244,255,0.62)';
                ctx.fillText((i + 1) + '  ' + s.label + (on ? '  ◂' : ''), M, y);
                y += C ? 15 : 18;
            });
        }
        ctx.font = '600 ' + (C ? 10 : 12) + 'px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,0.68)';
        const keys = this.station ? 'MOUSE: CURSOR · LMB: PRESS · WHEEL: TURN · 1–9: STATIONS · RMB / ESC / WASD: STAND UP · E: LEAVE'
            : this.cursor ? 'MOUSE: CURSOR · LMB: PRESS · WHEEL: TURN · TAB: MOUSE LOOK · E: LEAVE'
                : 'WASD: WALK · MOUSE: LOOK · LMB: PRESS · WHEEL: TURN · TAB: CURSOR · 1–9: STATIONS · E: LEAVE (AT THE ' + (r.def.exitName || 'EXIT') + ')';
        ctx.fillText(keys, M, H - (C ? 20 : 30), W - M * 2);
        const extra = r.def.keys ? r.def.keys.filter(k => k.label).map(k => keyName(k.code) + ': ' + k.label).join(' · ') : '';
        if (extra) ctx.fillText(extra, M, H - (C ? 36 : 50), W - M * 2);
        const near = !this.station && this.nearExit();
        if (near) {
            ctx.textAlign = 'center'; ctx.font = '700 ' + (C ? 13 : 16) + 'px ' + FONT; ctx.fillStyle = '#ffc23f';
            ctx.fillText('E — ' + near.label, W / 2, H * 0.68);
        }
        ctx.restore();
    }
}

export function keyName(code) {
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Space', 'SPACE').replace('Backspace', 'BKSP').replace('Enter', 'ENTER')
        .replace('BracketLeft', '[').replace('BracketRight', ']').replace('Semicolon', ';').replace('Quote', "'").replace(/^Arrow/, '').toUpperCase();
}

// the floor under (x, z) of the walk areas, reachable from height y (steps of up to 0.5 m), or null
export function floorAt(walk, x, z, y, holes = null) {
    if (holes) for (const h of holes) if (x > h[0] && x < h[1] && z > h[2] && z < h[3]) return null;
    let best = null;
    for (const w of walk) {
        if (x < w[0] || x > w[1] || z < w[2] || z > w[3]) continue;
        const fy = w[4] || 0;
        if (Math.abs(fy - y) > 0.55) continue;
        if (best === null || Math.abs(fy - y) < Math.abs(best - y)) best = fy;
    }
    return best;
}

// ═════════════ The system (systems.js): sites, transitions, controllers, the HUD ═════════════
export class Interiors {
    constructor(game) {
        this.game = game;
        this.sites = [];              // { id, label, at(out) → Vector3 | null, radius, enter(site), hidden() }
        this.rooms = new Map();       // id → Room
        this.ctl = null;              // the active controller (a RoomController, a boat's helm, a vehicle)
        this.fade = null;             // { t, out, hold, in, then, text }
        this.prompt = null;           // the site you're standing at
        this.plugins = [];            // warrooms.js / boats.js hooks: { start, clear, update, commands, drawMap }
        this.hlMat = new THREE.MeshBasicMaterial({ color: 0x55c8ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        this.hlOn = null;
        this.prevE = true;
        this.mode = null;
        // the fade to black between places: a DOM layer over the HUD (so nothing drawn after us shows through)
        this.fadeEl = null;
        if (typeof document !== 'undefined' && document.body && document.createElement) {
            const el = this.fadeEl = document.createElement('div');
            el.id = 'interiorFade';
            Object.assign(el.style || {}, { position: 'fixed', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', zIndex: '7',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e8f4ff', font: '700 22px ' + FONT, letterSpacing: '0.12em' });
            document.body.appendChild(el);
        }
    }

    // ── plug-ins (the content): each may have start(mode), clear(), update(dt), commands(), drawMap(ctx, map), mapInfo(sel)
    use(p) { this.plugins.push(p); return p; }

    addSite(s) { this.removeSite(s.id); this.sites.push({ radius: 2.2, ...s }); return s; }
    removeSite(id) { const i = this.sites.findIndex(s => s.id === id); if (i >= 0) this.sites.splice(i, 1); }
    addRoom(def) { const r = new Room(def); this.rooms.set(def.id, r); return r; }
    room(id) { return this.rooms.get(id) || null; }

    get active() { return !!this.ctl; }
    get renderer() { return this.game.world && this.game.world.renderer; }

    start(mode, opts) {
        this.clearControl(true);
        this.mode = mode;
        this.enabled = mode !== 'rings';
        for (const p of this.plugins) if (p.start) { try { p.start(mode, opts, this); } catch (e) { console.warn('[interiors] start', e); } }
    }

    clear() {
        this.clearControl(true);
        for (const p of this.plugins) if (p.clear) { try { p.clear(this); } catch (e) { console.warn('[interiors] clear', e); } }
        this.fade = null;
        this.prompt = null;
        this.showFade();
    }

    clearControl(silent) {
        const g = this.game;
        if (this.ctl) { try { this.ctl.exit && this.ctl.exit(true); } catch (e) { console.warn(e); } }
        this.ctl = null;
        if (g.takeover === this) g.takeover = null;
        this.restoreScene();
        g.indoors = null;
        g.nearPlane = null;
        this.highlight(null);
        void silent;
    }

    // ── controllers ──
    // take the player's controls (a room, a helm, a cab): ctl has control(dt, mouse), camera(cam, dt), hud(ctx, hud),
    // action(a), enter(), exit(), and `kind`
    takeControl(ctl) {
        const g = this.game;
        if (this.ctl && this.ctl !== ctl && this.ctl.exit) this.ctl.exit();
        this.ctl = ctl;
        g.takeover = this;
        if (ctl.enter) ctl.enter();
        g.input.lock();
        this.prevE = true;
    }
    releaseControl() {
        const g = this.game;
        if (this.ctl && this.ctl.exit) this.ctl.exit();
        this.ctl = null;
        if (g.takeover === this) g.takeover = null;
        this.restoreScene();
        this.highlight(null);
        this.prevE = true;
        const pm = g.pilotMode;
        if (pm) pm.prevE = true;
    }

    // called by game.update instead of the walking pilot's update while we have the controls
    control(dt, mouse) {
        if (this.fade && this.fade.block) return;
        const watching = !!(this.game.strikes && this.game.strikes.cam); // (the missile camera: nobody walks meanwhile)
        if (this.ctl && !watching) this.ctl.control(dt, mouse);
        const pm = this.game.pilotMode;
        if (pm && this.ctl && this.ctl.carry) this.ctl.carry(pm);
    }

    // ── rooms ──
    // go into a room (a fade, then you're at its spawn); opts: spawn { pos, yaw }, text (shown on the black)
    enterRoom(room, opts = {}) {
        const g = this.game;
        if (typeof room === 'string') room = this.room(room);
        if (!room) return;
        const go = () => {
            const ctl = new RoomController(this, room, opts);
            this.takeControl(ctl);
            if (g.pilotMode) this.hideWalker(true);
        };
        this.fadeTo(async () => {
            await room.load();
            if (!room.loaded) { g.addFeed('THE DOOR WON\'T OPEN', '#ffc23f'); return; }
            room.place();
            room.ensureEnv(this.renderer);
            go();
        }, { text: opts.text || room.name });
    }

    // from one room straight into another (a ladder between CIC and Pri-Fly)
    switchRoom(room, opts = {}) {
        const g = this.game;
        if (typeof room === 'string') room = this.room(room);
        if (!room) return;
        this.fadeTo(async () => {
            await room.load();
            if (!room.loaded) { g.addFeed('THE DOOR WON\'T OPEN', '#ffc23f'); return; }
            room.place();
            room.ensureEnv(this.renderer);
            if (this.ctl && this.ctl.exit) this.ctl.exit();
            this.ctl = null;
            this.takeControl(new RoomController(this, room, opts));
            if (g.pilotMode) this.hideWalker(true);
        }, { text: opts.text || room.name });
    }

    // back outside (the room's exitTo(), else where you came in)
    leave(opts = {}) {
        const c = this.ctl;
        if (!c) return;
        const room = c.room;
        if (room && room.def.canExit) {
            const ok = room.def.canExit(room, c);
            if (ok !== true) { this.game.addFeed(typeof ok === 'string' ? ok : 'CAN\'T LEAVE NOW', '#ffc23f'); this.game.audio.tick(260, 0.06, 0.05); return; }
        }
        this.fadeTo(() => {
            const to = opts.to || (room && room.def.exitTo ? room.def.exitTo(room, c) : null);
            this.releaseControl();
            this.hideWalker(false);
            if (to) this.placePilot(to.pos, to.yaw);
            if (opts.then) opts.then();
        }, { text: opts.text || '' });
    }

    // the man on foot (pilot.js) at a world position, facing yaw (on whatever surface is there)
    placePilot(pos, yaw = null) {
        const g = this.game, pm = g.pilotMode;
        if (!pm) return;
        const p = pm.seat.root.position;
        p.x = pos.x; p.z = pos.z;
        const su = g.surfaceAt(pos.x, pos.z, (pos.y ?? 1e3) + 1.5);
        p.y = (su.water ? Math.max(su.h, -0.9) : pos.y != null ? Math.max(su.h, pos.y) : su.h) + 0.3;
        if (yaw != null) { pm.yaw = yaw; if (pm.walker) pm.walker.yaw = yaw; }
        pm.pitch = 0;
        pm.deckRef = null;
        if (pm.walker) pm.placeWalker();
        pm.prevE = true;
    }

    hideWalker(hide) {
        const pm = this.game.pilotMode;
        if (!pm) return;
        if (pm.walker) pm.walker.mesh.visible = !hide && pm.thirdPerson;
        pm.hidden = hide;
    }

    // ── fades ──
    // black out, run `then` (it may be async: the black holds until it's done), fade back in
    fadeTo(then, { out = 0.35, inn = 0.4, text = '' } = {}) {
        if (this.fade) return;
        this.fade = { t: 0, phase: 'out', out, inn, then, text, block: true };
    }
    updateFade(dt) {
        const f = this.fade;
        if (!f) return;
        f.t += dt;
        if (f.phase === 'out' && f.t >= f.out) {
            f.phase = 'wait'; f.t = 0;
            let r;
            try { r = f.then && f.then(); } catch (e) { console.warn('[interiors] transition', e); }
            if (r && r.then) r.then(() => { f.phase = 'in'; f.t = 0; }, (e) => { console.warn(e); f.phase = 'in'; f.t = 0; });
            else { f.phase = 'in'; f.t = 0; }
        } else if (f.phase === 'in') {
            f.block = f.t < f.inn * 0.3;
            if (f.t >= f.inn) this.fade = null;
        }
    }
    get fadeAlpha() {
        const f = this.fade;
        if (!f) return 0;
        if (f.phase === 'out') return clamp(f.t / f.out, 0, 1);
        if (f.phase === 'wait') return 1;
        return clamp(1 - f.t / f.inn, 0, 1);
    }

    // ── the hovered control glows (an additive copy of its meshes) ──
    highlight(c) {
        if (this.hlOn === c) return;
        if (this.hlOn) for (const m of this.hlOn.hl || []) m.visible = false;
        this.hlOn = c;
        if (!c) return;
        if (!c.hl) {
            c.hl = c.meshes.map(m => {
                const h = new THREE.Mesh(m.geometry, this.hlMat);
                h.name = 'hl'; h.renderOrder = 5; h.raycast = () => {};
                m.add(h);
                return h;
            });
        }
        for (const m of c.hl) m.visible = true;
    }

    // ── the scene the renderer draws: a closed room's own, else the world's ──
    useScene(scene) {
        const sp = this.game.scenePass;
        if (sp) sp.scene = scene || this.game.scene;
    }
    restoreScene() { this.useScene(null); }

    // ═════════════ per frame ═════════════
    update(dt) {
        const g = this.game;
        g.indoors = null; g.nearPlane = null;
        this.restoreScene();
        if (!this.enabled) return;
        this.updateFade(dt);
        this.showFade();
        for (const p of this.plugins) if (p.update) { try { p.update(dt, this); } catch (e) { if (!p._err) { p._err = true; console.warn('[interiors] plugin', e); } } }
        const pm = g.pilotMode;
        // the controller's world (rooms follow their ships / vehicles)
        if (this.ctl) {
            if (!pm || !pm.alive || g.state !== 'playing') { if (g.state === 'dead' || !pm || !pm.alive) this.releaseControl(); }
            else {
                if (this.ctl.room) this.ctl.room.update(dt, g);
                if (this.ctl.tick) this.ctl.tick(dt);
            }
            this.prompt = null;
            return;
        }
        // on foot: the nearest site in reach
        this.prompt = null;
        if (!pm || !pm.alive || !pm.walker || pm.hijackT > 0 || this.fade || g.state !== 'playing') return;
        const feet = pm.feet(_v3);
        let best = null, bd = Infinity;
        for (const s of this.sites) {
            if (s.hidden && s.hidden()) continue;
            const p = s.at(_v);
            if (!p) continue;
            const dy = Math.abs(p.y - feet.y);
            if (dy > (s.dy || 3)) continue;
            const d = Math.hypot(p.x - feet.x, p.z - feet.z);
            if (d < s.radius && d < bd) { bd = d; best = s; }
        }
        // a jet in reach is the walking pilot's business (pilot.js) unless the site is nearer
        if (best && pm.candidate && pm.candidate.pos.distanceTo(feet) < bd) best = null;
        const eDown = g.input.down('KeyE'), ePress = eDown && !this.prevE;
        this.prevE = eDown;
        if (best) {
            this.prompt = best;
            const lbl = typeof best.label === 'function' ? best.label() : best.label;
            const why = best.blocked ? best.blocked() : null;
            pm.hint = why ? why : 'E — ' + lbl;
            pm.prevE = true; // (so pilot.js doesn't also take this E)
            if (ePress && !why) { g.audio.tick(900, 0.05, 0.04); try { best.enter(best); } catch (e) { console.warn('[interiors] site', best.id, e); } }
        }
    }

    // the camera, while we have the controls (a missile camera still gets its turn: strikes.js)
    updateCamera(cam, dt) {
        const g = this.game;
        if (!this.ctl) return false;
        // (watching a missile from in here: the world's view and the missile camera's display, no one's HUD)
        if (g.strikes && g.strikes.cam) { g.indoors = { sealed: false, lookout: true, kind: 'watch', name: 'MISSILE CAMERA' }; return false; }
        this.ctl.camera(cam, dt);
        const sealed = !!this.ctl.sealed;
        g.indoors = { sealed, lookout: !sealed, kind: this.ctl.kind, name: this.ctl.room ? this.ctl.room.name : this.ctl.kind };
        if (this.ctl.kind === 'room') g.nearPlane = this.ctl.view && this.ctl.view.near ? this.ctl.view.near : 0.05;
        else if (this.ctl.near) g.nearPlane = this.ctl.near;
        if (g.cockpit) g.cockpit.enabled = false;
        if (g.player && g.player.root) g.player.root.visible = !g.player.exploded;
        if (sealed && this.ctl.room && this.ctl.room.scene) this.useScene(this.ctl.room.scene);
        else if (this.ctl.room && !this.ctl.room.sealed && this.ctl.room.group.parent !== g.scene) g.scene.add(this.ctl.room.group);
        return true;
    }

    onAction(a) {
        const g = this.game;
        if (g.state !== 'playing') return false;
        if (this.fade && this.fade.block && a !== 'pause' && a !== 'lockLost') return true;
        if (!this.ctl) return false;
        // the missile camera from a room or a helm: K or Esc comes back in, V cycles its views (strikes.js)
        if (g.strikes && g.strikes.cam) { if (a === 'missilecam' || a === 'pause') { g.strikes.cam = null; return true; } return a !== 'camera'; }
        if (a === 'click' && this.ctl.kind === 'room') { if (!g.input.locked) g.input.lock(); return true; }
        return !!(this.ctl.action && this.ctl.action(a));
    }

    drawHud(ctx, hud) {
        const g = this.game;
        if (g.photo) return;
        if (this.ctl && !(g.strikes && g.strikes.cam)) this.ctl.hud(ctx, hud);
        for (const p of this.plugins) if (p.drawHud) { try { p.drawHud(ctx, hud, this); } catch (e) { if (!p._herr) { p._herr = true; console.warn(e); } } }
    }

    // the black between places (and the name of where you're going on it)
    showFade() {
        const el = this.fadeEl;
        if (!el || !el.style) return;
        const a = this.game.state === 'playing' || this.fade ? this.fadeAlpha : 0;
        const op = a.toFixed(3);
        if (el.style.opacity !== op) el.style.opacity = op;
        const txt = this.fade && a > 0.5 ? this.fade.text || '' : '';
        if (el.textContent !== txt) el.textContent = txt;
    }

    commands() {
        const out = [];
        for (const p of this.plugins) if (p.commands) { try { out.push(...(p.commands(this) || [])); } catch (e) { console.warn(e); } }
        return out;
    }
    drawMap(ctx, map) { for (const p of this.plugins) if (p.drawMap) { try { p.drawMap(ctx, map, this); } catch (e) { console.warn(e); } } }
    mapInfo(sel) { const out = []; for (const p of this.plugins) if (p.mapInfo) { try { out.push(...(p.mapInfo(sel, this) || [])); } catch (e) { console.warn(e); } } return out; }
    mapActions(sel) { const out = []; for (const p of this.plugins) if (p.mapActions) { try { out.push(...(p.mapActions(sel, this) || [])); } catch (e) { console.warn(e); } } return out; }
}
