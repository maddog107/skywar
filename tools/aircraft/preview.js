// ═══════════════════════════════════════════════════════════════
// Aircraft preview / comparison-sheet harness (dev tool, not loaded by the game).
// In a running SKYWAR tab (DevTools console or an automation tool):
//   const P = await import('/tools/aircraft/preview.js');
//   await P.loadNew({ f22: { file: 'aircraft/f22.glb', rot: [0, 0, 0] } });  // registers id 'new_f22'
//   const c = P.sheet([['F-22 old', P.views('f22')], ['F-22 new', P.views('new_f22')]]);
//   await P.save(c, 'f22_compare.png');   // POSTs a PNG to a local upload server (see UPLOAD)
// Renders with the game's own normalisation (scale to spec.length, material clamps, segmentation)
// because models come from src/models.js createAircraftModel().
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
