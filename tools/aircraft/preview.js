// ═══════════════════════════════════════════════════════════════
// Aircraft preview / comparison-sheet harness (dev tool, not loaded by the game).
// In a running SKYWAR tab (DevTools console or an automation tool):
//   const P = await import('/tools/aircraft/preview.js');
//   await P.loadNew({ f22: { file: 'aircraft/f22.glb', rot: [0, 0, 0] } });  // registers id 'new_f22'
//   const c = P.sheet([['F-22 old', P.views('f22')], ['F-22 new', P.views('new_f22')]]);
//   await P.save(c, 'f22_compare.png');   // POSTs a PNG to a local upload server (see UPLOAD)
// Renders with the game's own normalisation (scale to spec.length, material clamps, segmentation)
// because models come from src/models.js createAircraftModel().
// Flaps and speed brakes (tools/aircraft/SURFACES.md): blueprint(), closeup(), posed() below.
// PNG upload server: tools/aircraft/upload.mjs.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export let UPLOAD = 'http://localhost:8117/';
export function setUpload(u) { UPLOAD = u; }

let R = null, envTex = null;
function renderer(w, h) {
    if (!R) {
        R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, reversedDepthBuffer: true });
        R.outputColorSpace = THREE.SRGBColorSpace;
        R.toneMapping = THREE.ACESFilmicToneMapping;
        R.toneMappingExposure = 1.0;
        const pm = new THREE.PMREMGenerator(R);
        envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    R.setSize(w, h, false);
    return R;
}

// Load the game's current MODEL_FILES (what the hangar shows today).
export async function loadGameModels() {
    const M = await import('/src/models.js');
    await M.preloadModels();
}

// Register GLBs under 'new_<id>' using the game's loader/normaliser, without touching the real entries.
export async function loadNew(entries, prefix = 'new_') {
    const M = await import('/src/models.js');
    const C = await import('/src/config.js');
    const saved = { ...M.MODEL_FILES };
    for (const k of Object.keys(M.MODEL_FILES)) delete M.MODEL_FILES[k];
    for (const [id, info] of Object.entries(entries)) {
        C.AIRCRAFT[prefix + id] = C.AIRCRAFT[info.as || id];   // 'as': test a variant file against another id's spec
        M.MODEL_FILES[prefix + id] = { ...info, file: info.file + '?t=' + Date.now() };
    }
    await M.preloadModels();
    for (const k of Object.keys(M.MODEL_FILES)) delete M.MODEL_FILES[k];
    Object.assign(M.MODEL_FILES, saved);
}

const VIEWS = {
    front34: { dir: [0.95, 0.5, -1.25], persp: true },
    rear34: { dir: [-1.0, 0.62, 1.2], persp: true },
    side: { dir: [-1, 0, 0] },
    top: { dir: [0, 1, 0], up: [0, 0, -1] },
    front: { dir: [0, 0, -1] },
};

// Render one aircraft from several views → array of canvases.
// id = a game aircraft id, or 'url:<glb url>' to render a raw file (no normalisation; top view has -Z up).
export async function views(id, opts = {}) {
    const M = await import('/src/models.js');
    const w = opts.w ?? 480, h = opts.h ?? 300;
    const list = opts.views ?? ['front34', 'side', 'top', 'rear34'];
    let object, rig;
    if (id.startsWith('url:')) {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const g = await new GLTFLoader().loadAsync(id.slice(4));
        object = new THREE.Group(); object.add(g.scene);
        if (opts.rot) g.scene.rotation.set(...opts.rot);
        const b = new THREE.Box3().setFromObject(object);
        rig = { nozzles: [], wingtips: [], cockpit: new THREE.Vector3(), length: b.getSize(new THREE.Vector3()).z };
    } else if (opts.instance) {
        ({ object, rig } = opts.instance);
    } else {
        ({ object, rig } = M.createAircraftModel(id));
    }
    if (opts.livery) M.applyLivery(object, opts.livery);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(opts.bg ?? 0x9aa6b2);
    scene.environment = envTex || (renderer(w, h), envTex);
    scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x4a4540, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-30, 60, -20);
    scene.add(sun);
    scene.add(object);
    if (opts.markers) {
        const mk = (p, c, r) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false })); s.renderOrder = 99; s.position.copy(p); scene.add(s); };
        const r = rig.length * 0.012;
        rig.nozzles.forEach(p => mk(p, 0xff2020, r));
        rig.wingtips.forEach(p => mk(p, 0x2060ff, r));
        mk(rig.cockpit, 0x20ff40, r);
    }
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const rad = size.length() / 2;
    const out = [];
    for (const v of list) {
        const V = VIEWS[v];
        const d = new THREE.Vector3(...V.dir).normalize();
        let cam;
        if (V.persp) {
            cam = new THREE.PerspectiveCamera(28, w / h, rad * 0.05, rad * 20);
            const dist = rad / Math.sin(THREE.MathUtils.degToRad(28 / 2)) * (opts.zoom ?? 0.66);
            cam.position.copy(center).addScaledVector(d, dist);
        } else {
            const aspect = w / h;
            // fit the projected bbox
            let hw, hh;
            if (v === 'side') { hw = size.z / 2; hh = size.y / 2; }
            else if (v === 'top') { hw = size.x / 2; hh = size.z / 2; }
            else { hw = size.x / 2; hh = size.y / 2; }
            const s = Math.max(hw / aspect, hh) * 1.08;
            cam = new THREE.OrthographicCamera(-s * aspect, s * aspect, s, -s, 0.01, rad * 10);
            cam.position.copy(center).addScaledVector(d, rad * 4);
        }
        if (V.up) cam.up.set(...V.up);
        cam.lookAt(center);
        const r = renderer(w, h);
        r.render(scene, cam);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(r.domElement, 0, 0, w, h);
        out.push(c);
    }
    let tris = 0;
    object.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    out.tris = Math.round(tris);
    out.dims = 'x' + size.x.toFixed(1) + ' y' + size.y.toFixed(1) + ' z' + size.z.toFixed(1);
    return out;
}

// rows: [[label, canvases], ...] → one canvas
export function sheet(rows, title = '') {
    const pad = 6, labelW = 150, top = title ? 34 : 0;
    const cw = rows[0][1][0].width, ch = rows[0][1][0].height;
    const cols = Math.max(...rows.map(r => r[1].length));
    const c = document.createElement('canvas');
    c.width = labelW + cols * (cw + pad) + pad;
    c.height = top + rows.length * (ch + pad) + pad;
    const g = c.getContext('2d');
    g.fillStyle = '#1d2126'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#e8ecef'; g.font = 'bold 20px sans-serif';
    if (title) g.fillText(title, 10, 24);
    rows.forEach(([label, canv], i) => {
        const y = top + pad + i * (ch + pad);
        g.fillStyle = '#e8ecef'; g.font = 'bold 15px sans-serif';
        String(label).split('\n').forEach((ln, k) => g.fillText(ln, 8, y + 24 + k * 19));
        if (canv.tris) { g.font = '12px sans-serif'; g.fillStyle = '#9fb0bf'; g.fillText(canv.tris + ' tris', 8, y + ch - 10); }
        if (canv.dims) { g.font = '12px sans-serif'; g.fillStyle = '#9fb0bf'; g.fillText(canv.dims, 8, y + ch - 26); }
        canv.forEach((cv, j) => g.drawImage(cv, labelW + pad + j * (cw + pad), y));
    });
    return c;
}

export async function save(canvas, name, type = 'image/png') {
    const url = canvas.toDataURL(type, 0.9);
    const r = await fetch(UPLOAD + '?name=' + encodeURIComponent(name), { method: 'POST', body: url });
    return r.text();
}

// ── Flaps and speed brakes (src/surfaces.js, src/surfacedefs.js) ──
// blueprint(id, { view: 'top' | 'side', win: [a0, a1, b0, b1], w, flap, brake, defs }) → canvas
// An orthographic view with a grid in fractions of the aircraft length (thin every 0.01, labelled every 0.05),
// the surface outlines (cyan) and hinge lines (red) of SURFACE_DEFS[id] (or opts.defs) drawn on top.
//   top: x across (right wing to the right), z down the page (nose up); win = [x0, x1, z0, z1]
//   side: seen from the left, z across (nose to the left), y up; win = [z0, z1, y0, y1]
// flap / brake (0..1) pose the surfaces first, to check how they move.
export async function blueprint(id, opts = {}) {
    const M = await import('/src/models.js');
    const S = await import('/src/surfaces.js');
    const D = await import('/src/surfacedefs.js');
    const C = await import('/src/config.js');
    const L = C.AIRCRAFT[id].length;
    const { object } = M.createAircraftModel(id);
    S.poseSurfaces(object, opts.flap ?? 0, opts.brake ?? 0);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(opts.bg ?? 0xb4bec8);
    scene.environment = envTex || (renderer(8, 8), envTex);
    scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x4a4540, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-20, 60, -30);
    scene.add(sun, object);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const view = opts.view ?? 'top';
    const win = (opts.win ?? (view === 'top'
        ? [box.min.x / L - 0.02, box.max.x / L + 0.02, box.min.z / L - 0.02, box.max.z / L + 0.02]
        : view === 'front' ? [box.min.x / L - 0.02, box.max.x / L + 0.02, box.min.y / L - 0.03, box.max.y / L + 0.03]
        : [box.min.z / L - 0.02, box.max.z / L + 0.02, box.min.y / L - 0.03, box.max.y / L + 0.03])).map(v => v * L);
    const w = opts.w ?? 1400, h = Math.round(w * (win[3] - win[2]) / (win[1] - win[0]));
    let cam;
    if (view === 'top') {
        cam = new THREE.OrthographicCamera(win[0], win[1], -win[2], -win[3], 0.1, 400);
        cam.position.set(0, 200, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
    } else if (view === 'front') {
        // seen from behind (x to the right, as in the top view); with opts.cut (z, fractions of L) only what
        // lies aft of it is drawn (e.g. just the trailing edge, to read the height band for a flap)
        cam = new THREE.OrthographicCamera(win[0], win[1], win[3], win[2], 0.1, 400);
        cam.position.set(0, 0, 200); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
        if (opts.cut != null) cam.far = 200 - opts.cut * L;
        cam.updateProjectionMatrix();
    } else {
        cam = new THREE.OrthographicCamera(win[0], win[1], win[3], win[2], 0.1, 400);
        cam.position.set(-200, 0, 0); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    }
    const r = renderer(w, h);
    r.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(r.domElement, 0, 0, w, h);
    // model (metres) → pixels
    const px = (a) => (a - win[0]) / (win[1] - win[0]) * w;
    const py = view === 'top' ? (b) => (b - win[2]) / (win[3] - win[2]) * h : (b) => (win[3] - b) / (win[3] - win[2]) * h;
    const grid = (step, style, lw, label) => {
        g.strokeStyle = style; g.lineWidth = lw; g.fillStyle = '#10161c'; g.font = '11px monospace';
        for (let a = Math.ceil(win[0] / L / step) * step; a * L <= win[1]; a += step) {
            const x = px(a * L); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
            if (label) g.fillText(a.toFixed(2), x + 2, 11);
        }
        for (let b = Math.ceil(win[2] / L / step) * step; b * L <= win[3]; b += step) {
            const y = py(b * L); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
            if (label) g.fillText(b.toFixed(2), 2, y - 2);
        }
    };
    const span = (win[1] - win[0]) / L;
    grid(span > 0.6 ? 0.02 : 0.01, 'rgba(0,0,0,0.13)', 1, false);
    grid(0.05, 'rgba(0,0,0,0.38)', 1, true);
    g.fillStyle = '#10161c'; g.font = 'bold 13px sans-serif';
    g.fillText(`${id}  ${view}${opts.cut != null ? ' cut z=' + opts.cut : ''}  L=${L} m  (grid: fractions of L; ${view === 'top' ? 'x across, z down' : view === 'front' ? 'x across, y up, seen from behind' : 'z across, y up'})`, 8, h - 8);
    const defs = opts.defs ?? D.SURFACE_DEFS[id];
    if (defs && opts.outline !== false) {
        for (const kind of ['flaps', 'brakes']) for (const d of defs[kind] || []) {
            for (const side of d.mirror === false ? [1] : [1, -1]) {
                g.strokeStyle = kind === 'flaps' ? '#00e5ff' : '#ffd400'; g.lineWidth = 2;
                const pts = view === 'top' && d.top ? d.top.map(([x, z]) => [x * side, z]) : view === 'side' && d.side ? d.side : null;
                if (view === 'front') continue;
                if (pts) {
                    g.beginPath();
                    pts.forEach(([a, b], i) => { const X = px(a * L), Y = py(b * L); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
                    g.closePath(); g.stroke();
                }
                g.strokeStyle = '#ff2a2a'; g.lineWidth = 2;
                const hp = d.hinge.map(([x, y, z]) => view === 'top' ? [x * side, z] : [z, y]);
                g.beginPath(); g.moveTo(px(hp[0][0] * L), py(hp[0][1] * L)); g.lineTo(px(hp[1][0] * L), py(hp[1][1] * L)); g.stroke();
            }
        }
    }
    return c;
}

// posed(id, flap, brake, opts) → perspective views (front34, rear34, and a low rear view) with the surfaces posed
export async function posed(id, flap, brake, opts = {}) {
    const M = await import('/src/models.js');
    const S = await import('/src/surfaces.js');
    const list = opts.views ?? ['front34', 'rear34', 'low'];
    VIEWS.low = VIEWS.low || { dir: [-0.7, -0.35, 1.2], persp: true };
    VIEWS.above = VIEWS.above || { dir: [-0.5, 1.4, 0.9], persp: true };
    // views() builds its own model instance: pose it on the way through
    const { object, rig } = M.createAircraftModel(id);
    S.poseSurfaces(object, flap, brake);
    return views(id, { ...opts, views: list, instance: { object, rig } });
}

// closeup(id, flap, brake, { at: [x, y, z], dir: [dx, dy, dz], dist, w, h, fov }) → canvas
// A perspective close-up looking at `at` (fractions of L) from direction `dir`, `dist` (fractions of L) away.
export async function closeup(id, flap, brake, o = {}) {
    const M = await import('/src/models.js');
    const S = await import('/src/surfaces.js');
    const C = await import('/src/config.js');
    const L = C.AIRCRAFT[id].length;
    const { object } = M.createAircraftModel(id);
    S.poseSurfaces(object, flap, brake);
    const w = o.w ?? 640, h = o.h ?? 420;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(o.bg ?? 0x9aa6b2);
    scene.environment = envTex || (renderer(8, 8), envTex);
    scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x4a4540, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-30, 60, -20);
    scene.add(sun, object);
    const at = new THREE.Vector3(...(o.at ?? [0, 0, 0])).multiplyScalar(L);
    const cam = new THREE.PerspectiveCamera(o.fov ?? 35, w / h, 0.05, L * 20);
    cam.position.copy(at).addScaledVector(new THREE.Vector3(...(o.dir ?? [1, 1, 1])).normalize(), (o.dist ?? 0.3) * L);
    cam.lookAt(at);
    const r = renderer(w, h);
    r.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(r.domElement, 0, 0, w, h);
    return c;
}
