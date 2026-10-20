// ═══════════════════════════════════════════════════════════════
// Dressing a Blender kit model (tools/interiors/roomkit.py: the rooms of warrooms.js, the cockpits of cockpit.js):
// shared textures by material name (models/interiors/tex, UVs in metres), the static console pictures, and every
// placard (lbl_<n> quads with their text in extras) drawn into one atlas and merged into one mesh.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const FONT = '"Share Tech Mono", ui-monospace, Menlo, monospace'; // (interiors.js FONT)
const TEX = 'models/interiors/tex/';
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();

// size: metres one texture covers (the room GLBs carry UVs in metres)
export const ROOM_MATERIALS = {
    Deck: { tex: 'deck_plate', size: 1.2, rough: 0.72, metal: 0.25 },
    DeckTile: { tex: 'floor_tile', size: 1.2, rough: 0.6, metal: 0.0 },
    Carpet: { tex: 'carpet', size: 1.0, rough: 0.95, metal: 0.0 },
    Wall: { tex: 'wall_paint', size: 2.0, rough: 0.55, metal: 0.1 },
    WallDark: { tex: 'wall_paint', size: 2.0, rough: 0.55, metal: 0.1 },
    Ceiling: { tex: 'ceiling', size: 1.2, rough: 0.8, metal: 0.0 },
    Console: { tex: 'console', size: 0.5, rough: 0.5, metal: 0.25 },
    ConsoleLight: { tex: 'console', size: 0.5, rough: 0.5, metal: 0.2 },
    ConsoleBlue: { tex: 'console', size: 0.5, rough: 0.5, metal: 0.2 },
    Panel: { tex: 'console', size: 0.4, rough: 0.6, metal: 0.2 },
    Concrete: { tex: 'concrete', size: 2.5, rough: 0.92, metal: 0.0 },
    // the cockpit kit's (tools/cockpits/cockpit_kit.py): dark gull grey paint, the tub, the seat's fabric
    CkGrey: { tex: 'console', size: 0.3, rough: 0.62, metal: 0.15 },
    CkGreyDark: { tex: 'console', size: 0.45, rough: 0.7, metal: 0.15 },
    CkSeat: { tex: 'console', size: 0.18, rough: 0.88, metal: 0.0 },
    CkCushion: { tex: 'console', size: 0.12, rough: 0.95, metal: 0.0 },
    CkStrap: { tex: 'console', size: 0.08, rough: 0.9, metal: 0.0 },
};
const texCache = new Map();
let texLoader = null;
function roomTex(name, normal = false) {
    const key = name + (normal ? '_n' : '');
    if (texCache.has(key)) return texCache.get(key);
    let t = null;
    if (typeof document !== 'undefined' && document.createElementNS && typeof window !== 'undefined' && window.WebGLRenderingContext) {
        texLoader = texLoader || new THREE.TextureLoader();
        t = texLoader.load(TEX + key + '.jpg');
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.anisotropy = 8;
    }
    texCache.set(key, t);
    return t;
}
const matCache = new Map();
let artTex = null;

export function swapMaterial(m) {
    if (!m || !m.name) return m;
    const name = m.name.replace(/\.\d+$/, '');
    const key = name + ':' + (m.color ? m.color.getHexString() : '');
    if (matCache.has(key)) return matCache.get(key);
    let out = m;
    const spec = ROOM_MATERIALS[name];
    if (spec) {
        const map = roomTex(spec.tex), nrm = roomTex(spec.tex, true);
        out = new THREE.MeshStandardMaterial({ name, color: m.color ? m.color.clone() : 0xffffff, roughness: spec.rough, metalness: spec.metal });
        if (map) { out.map = map; out.map.repeat.set(1 / spec.size, 1 / spec.size); out.color.multiplyScalar(1.6).setRGB(Math.min(out.color.r, 1), Math.min(out.color.g, 1), Math.min(out.color.b, 1)); }
        if (nrm) { out.normalMap = nrm; out.normalMap.repeat.set(1 / spec.size, 1 / spec.size); out.normalScale.set(0.8, 0.8); }
    } else if (name === 'Glass') {
        out = new THREE.MeshStandardMaterial({ name, color: 0xb8ccd8, roughness: 0.04, metalness: 0.4, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    } else if (name === 'Screen') {
        out = new THREE.MeshStandardMaterial({ name, color: 0x06090c, roughness: 0.12, metalness: 0.2 });
    } else if (name === 'ScreenArt') {
        out = new THREE.MeshBasicMaterial({ name, map: screenArt(), color: new THREE.Color(1.1, 1.1, 1.1) });
    } else if (/^Light/.test(name)) {
        // light fixtures: a glow, not a flood (the room's lights do the lighting)
        out = m.clone(); out.emissiveIntensity = Math.min(m.emissiveIntensity || 1, name === 'Light' ? 1.8 : 1.3);
    } else if (/^Lamp/.test(name)) {
        out = m; // (lamps are cloned and driven by their bindings)
    }
    matCache.set(key, out);
    return out;
}

// eight static console pictures (radar scope, track lists, waterfall, plots…) in one 4 × 2 atlas, drawn once
function screenArt() {
    if (artTex) return artTex;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
    const ctx = cv.getContext('2d');
    if (!ctx || !ctx.fillRect) return null;
    const r = mulberry(7);
    for (let k = 0; k < 8; k++) {
        const x0 = (k % 4) * 512, y0 = (1 - Math.floor(k / 4)) * 512; // (row 0 of the Blender UVs is the canvas's bottom half)
        ctx.save(); ctx.translate(x0, y0); ctx.beginPath(); ctx.rect(0, 0, 512, 512); ctx.clip();
        ctx.fillStyle = '#02080d'; ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = '#0a1a26'; ctx.fillRect(0, 0, 512, 34);
        ctx.fillStyle = k % 3 ? '#7fd4ff' : '#5dffa0'; ctx.font = '700 20px ' + FONT; ctx.textBaseline = 'middle';
        ctx.fillText(['TRACK MGMT', 'SURFACE PLOT', 'BROADBAND', 'COMMS', 'SYSTEM STATUS', 'TACTICAL', 'LINK 16', 'NAV DATA'][k], 12, 17);
        ctx.strokeStyle = 'rgba(127,212,255,0.25)'; ctx.lineWidth = 1;
        if (k === 0 || k === 6) { // lists
            for (let i = 0; i < 16; i++) { ctx.fillStyle = i % 2 ? '#0b1720' : '#08121a'; ctx.fillRect(8, 44 + i * 27, 496, 26); ctx.fillStyle = r() < 0.2 ? '#ffc23f' : '#dcecf8'; ctx.font = '600 15px ' + FONT; ctx.fillText(String(1000 + Math.floor(r() * 8999)) + '  ' + ['AIR', 'SURF', 'SUB', 'UNK'][Math.floor(r() * 4)] + '  ' + String(Math.floor(r() * 360)).padStart(3, '0') + '  ' + (r() * 40).toFixed(1) + ' NM', 16, 57 + i * 27); }
        } else if (k === 1 || k === 5) { // plot / scope
            ctx.strokeStyle = 'rgba(127,212,255,0.35)';
            for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.arc(256, 276, i * 52, 0, Math.PI * 2); ctx.stroke(); }
            for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(256, 276); ctx.lineTo(256 + Math.cos(a) * 210, 276 + Math.sin(a) * 210); ctx.stroke(); }
            for (let i = 0; i < 14; i++) { const a = r() * 6.28, d = r() * 200; ctx.fillStyle = r() < 0.3 ? '#ff5a4a' : r() < 0.5 ? '#ffc23f' : '#6fb4ff'; ctx.fillRect(256 + Math.cos(a) * d - 4, 276 + Math.sin(a) * d - 4, 8, 8); }
        } else if (k === 2) { // waterfall
            for (let y = 40; y < 512; y += 2) for (let x = 0; x < 512; x += 4) { const v = r() * 0.5 + (Math.abs(x - 140 - y * 0.05) < 8 ? 0.5 : 0) + (Math.abs(x - 380 + y * 0.1) < 6 ? 0.4 : 0); ctx.fillStyle = 'rgba(93,255,160,' + (v * 0.6).toFixed(2) + ')'; ctx.fillRect(x, y, 4, 2); }
        } else { // text / status blocks
            for (let i = 0; i < 12; i++) { ctx.fillStyle = r() < 0.15 ? '#ff5a4a' : r() < 0.3 ? '#ffc23f' : '#5dffa0'; ctx.fillRect(16, 52 + i * 36, 18, 18); ctx.fillStyle = '#dcecf8'; ctx.font = '600 16px ' + FONT; ctx.fillText(['PWR', 'COMMS', 'LINK', 'NAV', 'GPS', 'ESM', 'IFF', 'SAT', 'DATA', 'HVAC', 'UPS', 'NET'][i] + '  ' + ['NORMAL', 'DEGRADED', 'ONLINE', 'STBY'][Math.floor(r() * 4)], 46, 61 + i * 36); }
            ctx.strokeStyle = '#7fd4ff'; ctx.beginPath(); for (let x = 260; x < 500; x += 4) ctx.lineTo(x, 300 + Math.sin(x * 0.05 + k) * 60 * r()); ctx.stroke();
        }
        ctx.restore();
    }
    artTex = new THREE.CanvasTexture(cv);
    artTex.colorSpace = THREE.SRGBColorSpace; artTex.flipY = false; artTex.anisotropy = 4;
    return artTex;
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// every placard of the room into one atlas and one mesh (a draw call for all of them)
const LABEL_STYLES = {
    w: { bg: '#15191e', fg: '#eef2f4', border: '#3a4048' }, b: { bg: '#d8d8d2', fg: '#15181b', border: '#8a8c88' },
    y: { bg: '#e0b52a', fg: '#101010', border: '#101010' }, r: { bg: '#b3261e', fg: '#ffffff', border: '#5a100c' },
    g: { bg: '#2f7a3c', fg: '#ffffff', border: '#143a1c' }, e: { bg: '#23272c', fg: '#c9d0d6', border: null },
    big: { bg: '#1d3350', fg: '#f2efe6', border: '#e8e4d8' },
};
export function mergeLabels(root, labels) {
    if (typeof document === 'undefined' || !document.createElement) return;
    const W = 2048, cells = [];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = 2048;
    const ctx = cv.getContext('2d');
    if (!ctx || !ctx.fillRect) return;
    let x = 0, y = 0;
    const ROW = 44;
    for (const o of labels) {
        const pos = o.geometry.attributes.position;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < pos.count; i++) { x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
        const aspect = (x1 - x0) / Math.max(1e-4, y1 - y0);
        const cw = Math.min(W - 4, Math.max(8, Math.round(ROW * aspect)));
        if (x + cw > W) { x = 0; y += ROW + 2; }
        if (y + ROW > 2048) break;
        const st = LABEL_STYLES[o.userData.st] || LABEL_STYLES.w;
        ctx.fillStyle = st.bg; ctx.fillRect(x, y, cw, ROW);
        if (st.border) { ctx.strokeStyle = st.border; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ROW - 3); }
        ctx.fillStyle = st.fg; ctx.font = '700 ' + Math.round(ROW * 0.62) + 'px ' + (o.userData.st === 'big' ? 'Arial, sans-serif' : FONT);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(o.userData.lbl), x + cw / 2, y + ROW / 2 + 1, cw - 8);
        cells.push({ o, u0: x / W, u1: (x + cw) / W, v0: y / 2048, v1: (y + ROW) / 2048, x0, x1, y0, y1 });
        x += cw + 2;
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8;
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const P = [], N = [], U = [], I = [];
    for (const c of cells) {
        const o = c.o, g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal;
        _m.multiplyMatrices(inv, o.matrixWorld);
        const nm = new THREE.Matrix3().getNormalMatrix(_m);
        const base = P.length / 3;
        for (let i = 0; i < pos.count; i++) {
            _v.fromBufferAttribute(pos, i);
            const u = _v.x <= (c.x0 + c.x1) / 2 ? c.u0 : c.u1, v = _v.y >= (c.y0 + c.y1) / 2 ? c.v0 : c.v1;
            _v.applyMatrix4(_m); P.push(_v.x, _v.y, _v.z);
            if (nor) { _v2.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N.push(_v2.x, _v2.y, _v2.z); } else N.push(0, 0, 1);
            U.push(u, v);
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) I.push(base + g.index.getX(i));
        else for (let i = 0; i < pos.count; i++) I.push(base + i);
        o.visible = false;
        o.parent && o.parent.remove(o);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.setIndex(I);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    mesh.name = 'labels';
    root.add(mesh);
}

