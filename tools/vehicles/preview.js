// ═══════════════════════════════════════════════════════════════
// Vehicle preview / sheet harness (dev tool, not loaded by the game). Renders models through src/vehicles.js
// (the game's own loader, materials and rig), posed, on a ground plane with shadows, next to a humvee for scale.
//   const P = await import('/tools/vehicles/preview.js');
//   await P.init();                                   // loads every vehicle in VEHICLES + the humvee prop
//   const rows = [['stowed', await P.views('scud')], ['erected', await P.views('scud', { pose: { jack: 1, pad: 1, raise: 1 } })]];
//   await P.save(P.sheet(rows, 'SCUD'), 'vehicles/scud.png');   // PNG via the upload server (tools/aircraft/upload.mjs)
// pose: { raise, jack, pad, door, hatch: 0..1, yaw, pitch (radians), spin (seconds of antenna rotation) }
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import * as V from '/src/vehicles.js';
import { preloadProps, propInstance, hasProp } from '/src/props.js';
import { sheet, save, setUpload } from '/tools/aircraft/preview.js';
export { sheet, save, setUpload };

let R = null, envTex = null;
// The game's midday palette (src/world.js setTime): the environment is the sky dome baked into a PMREM
const SKY = { zenith: 0x2463b4, horizon: 0xb3cde4, ground: 0x5a5236, sun: 0xfff1dc, sunI: 3.3, hemiSky: 0x9cc0e4, hemiGround: 0x5a5236, hemiI: 0.5, envI: 0.62 };
function skyEnvironment(pm) {
    const scene = new THREE.Scene();
    const g = new THREE.SphereGeometry(100, 48, 24);
    const col = [], z = new THREE.Color(SKY.zenith), h = new THREE.Color(SKY.horizon), gr = new THREE.Color(SKY.ground).multiplyScalar(0.8), c = new THREE.Color();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) / 100;
        if (y >= 0) c.copy(h).lerp(z, Math.pow(y, 0.6)); else c.copy(gr);
        col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    return pm.fromScene(scene, 0.02).texture;
}
function renderer(w, h) {
    if (!R) {
        R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, reversedDepthBuffer: true });
        R.outputColorSpace = THREE.SRGBColorSpace;
        R.toneMapping = THREE.ACESFilmicToneMapping;
        R.toneMappingExposure = 1.0;
        R.shadowMap.enabled = true;
        R.shadowMap.type = THREE.PCFSoftShadowMap;
        const pm = new THREE.PMREMGenerator(R);
        envTex = skyEnvironment(pm);
    }
    R.setSize(w, h, false);
    return R;
}

export async function init(opts = {}) {
    await Promise.all([V.preloadVehicles(opts), preloadProps()]);
    await V.whenTexturesLoaded();
}

export function applyPose(rig, p = {}) {
    for (const g of ['jack', 'pad', 'raise', 'door', 'hatch']) if (p[g] != null) V.pose(rig, g, p[g]);
    if (p.yaw != null || p.pitch != null) V.aim(rig, p.yaw || 0, p.pitch || 0);
    if (p.spin) V.spin(rig, p.spin);
    if (p.steer) V.steer(rig, p.steer);
    if (p.roll) V.roll(rig, p.roll);
}

const VIEWS = {
    front34: { dir: [0.95, 0.45, -1.2], persp: true },
    rear34: { dir: [-1.0, 0.55, 1.15], persp: true },
    rear34r: { dir: [1.0, 0.5, 1.15], persp: true },
    front34l: { dir: [-0.95, 0.45, -1.2], persp: true },
    low: { dir: [1.0, 0.12, -0.9], persp: true },
    high: { dir: [0.6, 1.3, -0.8], persp: true },
    side: { dir: [-1, 0, 0] },
    sider: { dir: [1, 0, 0] },
    top: { dir: [0, 1, 0], up: [0, 0, -1] },
    front: { dir: [0, 0, -1] },
    rear: { dir: [0, 0, 1] },
};

function stage(object, opts) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(opts.bg ?? SKY.horizon);
    scene.environment = envTex || (renderer(8, 8), envTex);
    scene.environmentIntensity = SKY.envI;
    scene.add(new THREE.HemisphereLight(SKY.hemiSky, SKY.hemiGround, SKY.hemiI));
    const sun = new THREE.DirectionalLight(SKY.sun, SKY.sunI);
    sun.position.set(-30, 52, -24);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -22; s.right = s.top = 22; s.near = 1; s.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    if (opts.ground !== false) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: opts.groundColor ?? 0x5f6346, roughness: 0.95 }));
        g.rotation.x = -Math.PI / 2;
        g.receiveShadow = true;
        scene.add(g);
    }
    scene.add(object);
    return scene;
}

// Render one vehicle (posed) from several views → array of canvases (with .tris and .dims for sheet())
export async function views(id, opts = {}) {
    const w = opts.w ?? 560, h = opts.h ?? 340;
    const list = opts.views ?? ['front34', 'side', 'rear34', 'top'];
    const { object, rig } = V.createVehicle(id, { paint: opts.paint });
    applyPose(rig, opts.pose);
    const holder = new THREE.Group();
    holder.add(object);
    object.updateMatrixWorld(true);
    const vbox = new THREE.Box3().setFromObject(object);
    if (opts.humvee !== false && hasProp('humvee')) {
        const hv = propInstance('humvee');
        hv.position.set(vbox.min.x - 2.6, 0, vbox.max.z - 3.2);
        hv.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        holder.add(hv);
    }
    const scene = stage(holder, opts);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const rad = size.length() / 2;
    const out = [];
    for (const v of list) {
        const V_ = VIEWS[v];
        const d = new THREE.Vector3(...V_.dir).normalize();
        let cam;
        if (V_.persp) {
            cam = new THREE.PerspectiveCamera(opts.fov ?? 30, w / h, 0.1, rad * 40);
            const dist = rad / Math.sin(THREE.MathUtils.degToRad((opts.fov ?? 30) / 2)) * (opts.zoom ?? 0.72);
            cam.position.copy(center).addScaledVector(d, dist);
        } else {
            const aspect = w / h;
            let hw, hh;
            if (v === 'side' || v === 'sider') { hw = size.z / 2; hh = size.y / 2; } else if (v === 'top') { hw = size.x / 2; hh = size.z / 2; } else { hw = size.x / 2; hh = size.y / 2; }
            const s = Math.max(hw / aspect, hh) * 1.08;
            cam = new THREE.OrthographicCamera(-s * aspect, s * aspect, s, -s, 0.1, rad * 12);
            cam.position.copy(center).addScaledVector(d, rad * 5);
        }
        if (V_.up) cam.up.set(...V_.up);
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
    const vs = vbox.getSize(new THREE.Vector3());
    out.dims = 'L' + vs.z.toFixed(2) + ' W' + vs.x.toFixed(2) + ' H' + vs.y.toFixed(2);
    return out;
}

// closeup(id, { at: [x, y, z] (metres, vehicle frame), dir: [dx, dy, dz], dist, pose, w, h, fov }) → canvas
export async function closeup(id, o = {}) {
    const w = o.w ?? 640, h = o.h ?? 420;
    const { object, rig } = V.createVehicle(id, { paint: o.paint });
    applyPose(rig, o.pose);
    const scene = stage(object, o);
    const at = new THREE.Vector3(...(o.at ?? [0, 1.5, 0]));
    const cam = new THREE.PerspectiveCamera(o.fov ?? 35, w / h, 0.05, 500);
    cam.position.copy(at).addScaledVector(new THREE.Vector3(...(o.dir ?? [1, 0.5, -1])).normalize(), o.dist ?? 6);
    cam.lookAt(at);
    const r = renderer(w, h);
    r.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(r.domElement, 0, 0, w, h);
    return c;
}

// A standard sheet for one vehicle: rows of posed views. poses: [[label, pose], ...]
export async function vehicleSheet(id, poses, opts = {}) {
    const rows = [];
    for (const [label, pose, extra] of poses) rows.push([label, await views(id, { ...opts, ...(extra || {}), pose })]);
    return sheet(rows, (V.VEHICLES[id]?.name || id) + (opts.title ? ' — ' + opts.title : ''));
}
