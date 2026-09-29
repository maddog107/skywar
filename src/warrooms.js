// ═══════════════════════════════════════════════════════════════
// The rooms and boats themselves (docs/WAR.md "Interiors and boats"), plugged into the interiors framework
// (interiors.js):
//  • Harbor: the small-craft pier west of the home base, the RHIB and the CB90 you drive from it (boats.js), and
//    stepping on and off boats at piers, ships' ladders and a surfaced submarine
//  • Submarine: USS Colorado (SSN-788), a Virginia-class boat lying surfaced off the pier — its casing, the escape
//    trunk hatch, the control room with ship control, photonics masts (a live view), sonar and fire control
//  • Carrier: the island's doors, the Combat Direction Center (the group's strike console) and Pri-Fly
//  • JOC: the Joint Operations Center at the home base — the video wall and the consoles
//  • TEL: a Scud-style launcher's control cabin and cab
// Room models: models/interiors/*.glb (tools/interiors/*.py, ROOMS.md); screens are drawn with screens.js; the
// console logic is firecontrol.js. `TRAVEL` in the command menu takes you to any of them on foot.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Interiors, Room, RoomController, FONT, keyName } from './interiors.js';
import { Boat, Helm, Harbor, findPierSite, BOAT_SPECS, KT } from './boats.js';
import { SubControl, SubFireControl, SUB_BELLS, SUB_RUDDER, SUB_DEPTHS, SUB_WEAPONS, MASTS, FT, StrikeConsole, TelPanel } from './firecontrol.js';
import { C, f, page, readout, text, tape, compass, bar, check, MapView, bearing, hdgDeg } from './screens.js';
import { shipsLoaded, setDepth, raiseMast, openHatch, openCell, SHIP_TYPES } from './naval.js';
import { SubLauncher, MISSILES } from './strikes.js';
import { INTEL, INTEL_NAMES } from './war.js';
import { BASES, baseToWorld } from './world.js';
import { terrainHeight } from './terraincore.js';
import { waterHeight } from './water.js';
import { clamp, damp, rand } from './util.js';

export { Interiors };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const TEX = 'models/interiors/tex/';

// ═════════════ Dressing a room model: shared textures by material name, the placards, the static screens ═════════════
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

export function dressRoom(room) {
    const root = room.model;
    const labels = [];
    root.updateMatrixWorld(true);
    root.traverse(o => {
        if (o.userData && o.userData.lbl != null && o.isMesh) labels.push(o);
    });
    root.traverse(o => {
        if (!o.isMesh || o.userData.lbl != null || o.userData.ctlRef) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const out = mats.map(m => swapMaterial(m));
        o.material = Array.isArray(o.material) ? out : out[0];
    });
    // controls keep their own (lamps were cloned by the framework); give them the swapped look too
    for (const c of room.controls.values()) for (const m of c.meshes) {
        if (c.lampMat && m.material === c.lampMat) continue;
        m.material = Array.isArray(m.material) ? m.material.map(swapMaterial) : swapMaterial(m.material);
    }
    if (labels.length) mergeLabels(root, labels);
}

function swapMaterial(m) {
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
function mergeLabels(root, labels) {
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

// ═════════════ Shared helpers ═════════════
// radio: through the director's pacing when a war runs (docs/WAR.md: other plug-ins talk through director.say)
export function say(game, from, text, opts = {}) {
    const d = game.director;
    if (d && d.enabled && d.say) return d.say(from, text, opts);
    return game.war.radio(from, text, opts);
}

// what a console can shoot at: our marks first, then known enemy units (identified or better), nearest first
export function targetList(game, from, { max = 24, sea = null } = {}) {
    const war = game.war, out = [], seen = new Set();
    for (const d of war.designations) {
        const u = d.unit, pos = u ? (u.team === war.side ? u.pos : (war.rec(u) ? war.rec(u).lastPos : u.pos)) : d.fixed || d.pos;
        if (!pos) continue;
        const cls = u ? (war.rec(u) ? war.rec(u).cls : u.cls) : 'point';
        const kind = u && (u.isShip || cls === 'ship' || cls === 'carrier' || cls === 'sub' || cls === 'boat') ? 'sea' : 'land';
        out.push({ key: 'M' + d.id, label: 'M' + d.id + ' ' + d.label, kind, pos, unit: u, mark: d, grid: d.grid, intel: u ? war.known(u) : INTEL.CONFIRMED, cls, km: from ? Math.hypot(pos.x - from.x, pos.z - from.z) / 1000 : 0 });
        if (u) seen.add(u);
    }
    const cand = [];
    for (const u of war.units) {
        if (seen.has(u) || !u.alive) continue;
        const r = war.rec(u);
        if (!r || r.team === war.side || r.team === 'neutral' || r.known < INTEL.IDENTIFIED) continue;
        if (r.cls === 'aircraft' || r.cls === 'helicopter' || r.cls === 'infantry') continue;
        const kind = u.isShip || r.cls === 'ship' || r.cls === 'carrier' || r.cls === 'sub' ? 'sea' : 'land';
        if (sea === true && kind !== 'sea') continue;
        const pos = r.lastPos;
        cand.push({ key: 'U' + r.id, label: war.label(u), kind, pos, unit: u, mark: null, grid: war.grid(pos.x, pos.z), intel: r.known, cls: r.cls, km: from ? Math.hypot(pos.x - from.x, pos.z - from.z) / 1000 : 0 });
    }
    cand.sort((a, b) => a.km - b.km);
    for (const c of cand) { if (out.length >= max) break; out.push(c); }
    return out;
}
// a target's mark (marks it now if it isn't one yet), for the strikes API
export function markFor(game, t, source = 'console') {
    if (t.mark && game.war.designations.includes(t.mark)) return t.mark;
    const d = game.war.designate(t.unit || { x: t.pos.x, z: t.pos.z, y: t.pos.y }, source);
    t.mark = d;
    return d;
}
export const clockZ = (game) => {
    const s = Math.floor((game.war ? game.war.time : game.time) || 0) + 12 * 3600 + 34 * 60;
    return String(Math.floor(s / 3600) % 24).padStart(2, '0') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + 'Z';
};

// A live camera picture for a screen (a periscope's, the carrier's deck camera): a small render target of the
// world drawn a few times a second while someone's looking — the world's shadows aren't redrawn for it and the
// clouds' ray march is left out (it's tied to the main camera's history)
export class CameraFeed {
    constructor(w = 512, h = 300, fps = 6, fov = 30) {
        this.w = w; this.h = h; this.fps = fps;
        this.rt = null; this.cam = new THREE.PerspectiveCamera(fov, w / h, 0.3, 30000);
        this.t = 0; this.live = false;
    }
    // setup(cam) aims the camera and returns true if there's a picture to take
    update(dt, game, setup) {
        const renderer = game.world && game.world.renderer;
        if (!renderer) return false;
        this.t -= dt;
        if (this.t > 0) return this.live;
        this.t = 1 / this.fps;
        this.live = !!setup(this.cam);
        if (!this.live) return false;
        if (!this.rt) { this.rt = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType }); this.rt.texture.name = 'CameraFeed'; }
        this.cam.updateMatrixWorld();
        const clouds = game.world.clouds && game.world.clouds.mesh, vis = clouds ? clouds.visible : false;
        if (clouds) clouds.visible = false;
        const auto = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(this.rt);
        renderer.render(game.scene, this.cam);
        renderer.setRenderTarget(prev);
        renderer.shadowMap.autoUpdate = auto;
        if (clouds) clouds.visible = vis;
        return true;
    }
    get texture() { return this.live && this.rt ? this.rt.texture : null; }
}

// ═════════════ Harbor: the pier, the boats, stepping on and off ═════════════
let PIER_SITE; // (the terrain doesn't change: found once per session)
export class HarborOps {
    constructor(sys) {
        this.sys = sys; this.game = sys.game;
        this.harbor = null;
        this.boats = [];
        this.docks = [];         // other places a boat can put you off: { id, label, host (a Ship), at(out) world point, step(out) where you land, ok() → true | why }
    }

    start(mode) {
        const g = this.game;
        this.clear();
        if (mode === 'rings') return;
        if (PIER_SITE === undefined) PIER_SITE = findPierSite(BASES[0]);
        if (PIER_SITE && !this.harbor) {
            this.harbor = new Harbor(g, PIER_SITE);
            this.harborShared = true;
        }
        const token = this.token = {};
        shipsLoaded().then(() => {
            if (this.token !== token || !this.harbor) return;
            for (const slot of this.harbor.slots) {
                const pose = this.harbor.slotPose(slot, BOAT_SPECS[slot.type].B);
                const b = this.addBoat(slot.type, pose.x, pose.z, pose.heading, { name: slot.type === 'rhib' ? 'RHIB SBT-12 (11 M NSW RIB)' : 'CB90 COMBAT BOAT' });
                b.moor(null, pose.x, pose.z, pose.heading);
                b.slot = slot; slot.boat = b;
            }
        });
    }

    clear() {
        for (const b of this.boats) this.removeBoat(b, true);
        this.boats = [];
        this.token = null;
        if (this.harbor) for (const s of this.harbor.slots) s.boat = null;
    }

    addBoat(type, x, z, heading, opts = {}) {
        const b = new Boat(this.game, type, x, z, heading, opts);
        b.phys.collide = (px, pz, r, ph) => this.collide(px, pz, r, ph);
        this.boats.push(b);
        this.game.war.add(b, { cls: 'boat', name: b.name });
        this.sys.addSite({
            id: 'boat:' + b.name + ':' + this.boats.length, label: () => 'TAKE THE ' + b.spec.short + ' (DRIVE)', radius: 3.4, dy: 3.5,
            at: (out) => (b.alive && !b.driver && !b.removed ? b.point('hatch_entry', out) : null),
            enter: () => this.board(b),
        });
        b._site = 'boat:' + b.name + ':' + this.boats.length;
        return b;
    }
    removeBoat(b, all = false) {
        b.remove();
        this.sys.removeSite(b._site);
        b.removed = true;
        this.game.war.remove(b);
        if (!all) { const i = this.boats.indexOf(b); if (i >= 0) this.boats.splice(i, 1); }
    }

    board(b) {
        const sys = this.sys;
        sys.fadeTo(() => {
            if (b.slot) { b.slot.boat = null; b.slot = null; }
            sys.takeControl(new Helm(sys, b, this));
            this.game.audio.tick(700, 0.1, 0.15);
        }, { out: 0.25, inn: 0.3, text: b.name });
    }

    // somewhere to step off this boat: a pier slot, a ship's ladder, a surfaced sub, a beach
    dockNear(b) {
        const p = b.phys, speed = Math.hypot(p.u, p.v);
        let best = null, bd = Infinity;
        const consider = (d) => { if (d && d.dist < bd) { bd = d.dist; best = d; } };
        if (this.harbor) for (const slot of this.harbor.slots) {
            if (slot.boat && slot.boat !== b) continue;
            const pose = this.harbor.slotPose(slot, b.spec.B);
            const dist = Math.hypot(pose.x - p.x, pose.z - p.z);
            if (dist < 16) consider({ kind: 'pier', slot, dist, label: 'TIE UP AND STEP ONTO THE PONTOON' });
        }
        for (const d of this.docks) {
            const at = d.at(_v);
            if (!at) continue;
            const dist = Math.hypot(at.x - p.x, at.z - p.z) - b.spec.B / 2;
            if (dist < 14) consider({ kind: 'ship', dock: d, dist, label: d.label });
        }
        // a beach: the bow in shallow water
        const bx = p.x - Math.sin(p.h) * b.spec.L * 0.5, bz = p.z - Math.cos(p.h) * b.spec.L * 0.5;
        if (terrainHeight(bx, bz) > -1.2) consider({ kind: 'beach', dist: 20, label: 'STEP ASHORE', at: { x: bx - Math.sin(p.h) * 2, z: bz - Math.cos(p.h) * 2 } });
        if (!best) return null;
        let rel = speed;
        if (best.kind === 'ship' && best.dock.host && best.dock.host.vel) rel = Math.hypot(b.vel.x - best.dock.host.vel.x, b.vel.z - best.dock.host.vel.z);
        const why = best.dock && best.dock.ok ? best.dock.ok() : true;
        best.ok = rel < 3 && why === true;
        best.why = why !== true ? why : rel >= 3 ? 'SLOW DOWN TO COME ALONGSIDE (' + Math.round(rel * KT) + ' KT)' : '';
        return best;
    }

    stepOff(b, dock) {
        const sys = this.sys, g = this.game;
        sys.fadeTo(() => {
            sys.releaseControl();
            sys.hideWalker(false);
            if (dock.kind === 'pier') {
                const pose = this.harbor.slotPose(dock.slot, b.spec.B);
                b.moor(null, pose.x, pose.z, pose.heading);
                b.slot = dock.slot; dock.slot.boat = b;
                const st = this.harbor.slotStep(dock.slot, _v);
                sys.placePilot(st, this.harbor.yaw);
            } else if (dock.kind === 'ship') {
                const d = dock.dock, H = d.host;
                const at = d.at(_v2);
                const l = H.toLocal(at.x, at.z);
                const side = l.lx >= 0 ? 1 : -1;
                b.moor(H, l.lx + side * (b.spec.B / 2 + 1.2), l.lz, 0);
                const st = d.step(_v3);
                sys.placePilot(st, d.yaw ? d.yaw() : H.heading);
                if (d.then) d.then();
            } else {
                sys.placePilot({ x: dock.at.x, z: dock.at.z, y: null }, b.heading);
            }
            g.audio.tick(500, 0.1, 0.12);
        }, { out: 0.3, inn: 0.35, text: dock.kind === 'ship' ? dock.dock.text || '' : '' });
    }

    // a boat brought alongside a ship's ladder for you ("the duty boat is lowered")
    boatAlongside(host, lx, lz, type = 'rhib') {
        let b = this.boats.find(x => x.moored && x.moored.host === host && !x.driver && x.alive);
        if (!b) {
            const w = host.toWorld(lx, 0, lz, _v);
            b = this.addBoat(type, w.x, w.z, host.heading, { name: type === 'rhib' ? 'DUTY BOAT (11 M RHIB)' : 'CB90 COMBAT BOAT' });
            b.moor(host, lx, lz, 0);
        }
        return b;
    }

    update(dt) {
        if (this.harbor) this.harbor.update(dt);
        for (const b of this.boats) {
            if (b.driver) continue; // (the helm ticks it)
            b.update(dt);
        }
        for (let i = this.boats.length - 1; i >= 0; i--) { const b = this.boats[i]; if (!b.alive && (b.sinkT || 0) > 20) this.removeBoat(b); }
    }

    // hull collisions for the boats: the pier, the pontoon, and every ship's hull
    collide(x, z, r, phys) {
        if (this.harbor) { const h = this.harbor.collide(x, z, r); if (h) return h; }
        const naval = this.game.naval;
        if (naval) for (const s of naval.ships) {
            if (s.gone || !s.def || s.def.L < 40 || (s.depth || 0) > 12) continue;
            const l = s.toLocal(x, z), hw = s.type === 'carrier' ? 20.6 : s.def.B * 0.48, hl = s.def.L * 0.48;
            if (Math.abs(l.lz) > hl + r || Math.abs(l.lx) > hw + r) continue;
            // (a fine bow: the half-width tapers over the forward fifth)
            const taper = l.lz < -hl * 0.6 ? Math.max(0.15, 1 - (-l.lz - hl * 0.6) / (hl * 0.4)) : 1;
            const w = hw * taper;
            const dx = Math.abs(l.lx) - w;
            if (dx > r) continue;
            const side = l.lx >= 0 ? 1 : -1, d = r - dx;
            const c = Math.cos(s.heading), sn = Math.sin(s.heading);
            return { nx: side * c, nz: -side * sn, d };
        }
        void phys;
        return null;
    }

    drawMap(ctx, map) {
        if (!this.harbor) return;
        const h = this.harbor, P = map.toScreen(h.root.x, h.root.z), Q = map.toScreen(h.root.x + h.dir.x * h.len, h.root.z + h.dir.z * h.len);
        ctx.save();
        ctx.strokeStyle = '#cfd8e0'; ctx.lineWidth = Math.max(2, 8 * map.scale);
        ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
        if (map.scale > 0.004) { ctx.fillStyle = '#cfd8e0'; ctx.font = '600 10px ' + FONT; ctx.textAlign = 'left'; ctx.fillText('SMALL CRAFT PIER', Q.x + 6, Q.y); }
        for (const b of this.boats) {
            if (!b.alive) continue;
            const B = map.toScreen(b.phys.x, b.phys.z);
            ctx.fillStyle = '#6fb4ff'; ctx.beginPath(); ctx.arc(B.x, B.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
}

// ═════════════ The submarine: USS Colorado (SSN-788), surfaced off the pier ═════════════
const SUB_ROOM_OFFSET = new THREE.Vector3(0, -4.3, -40);   // the control room's origin in the boat
const TUBE_NAMES = ['VPT 1', 'VPT 2', 'VPM 3', 'VPM 4', 'VPM 5', 'VPM 6'];
export class SubOps {
    constructor(sys, harbor) {
        this.sys = sys; this.game = sys.game; this.harbor = harbor;
        this.sub = null;
        this.ctl = null; this.fc = null; this.launcher = null;
        this.contacts = [];
        this.sonarT = 0;
        this.waterfall = null;
        this.room = sys.addRoom(this.roomDef());
        this.room.state.lights = 'normal';
        this.feed = null;
    }

    get alive() { return !!(this.sub && this.sub.alive && !this.sub.gone); }

    start(mode) {
        this.clear();
        if (mode === 'rings' || mode === 'practice') return;
        const token = this.token = {};
        shipsLoaded().then(() => { if (this.token === token) this.spawn(); });
    }

    // the sub lies stopped in deep water beyond the pier head, bow along the coast
    spawn() {
        const g = this.game, H = this.harbor.harbor;
        let spot = null;
        if (H) {
            for (let d = 700; d < 3000 && !spot; d += 150) for (const side of [0, 1, -1]) {
                const x = H.root.x + H.dir.x * (H.len + d) + H.dir.z * side * 400, z = H.root.z + H.dir.z * (H.len + d) - H.dir.x * side * 400;
                let ok = terrainHeight(x, z) < -60;
                for (let k = 0; k < 12 && ok; k++) { const a = k / 12 * Math.PI * 2; if (terrainHeight(x + Math.cos(a) * 250, z + Math.sin(a) * 250) < -45 === false) ok = false; }
                if (ok) { spot = { x, z }; break; }
            }
        }
        if (!spot) spot = { x: -4200, z: 400 };
        const heading = H ? Math.atan2(-H.dir.z, H.dir.x) : 0; // along the coast
        const s = g.naval.spawn('ssn', 'blue', spot, { orbitR: 10, passive: true, name: 'USS COLORADO (SSN-788)' });
        s.mesh.position.set(spot.x, 0, spot.z); // (naval.js put her on a circle round the spot: she lies right on it)
        s.isSub = true; s.cls = 'sub';
        g.war.add(s, { cls: 'sub', name: s.name });
        this.sub = s;
        this.heading = heading;
        this.steer(0, 0);
        this.ctl = new SubControl({ draft: (s.layout && s.layout.draft) || 8.8, pd: (s.layout && s.layout.periscopeDepth) || 9.4, L: s.def.L });
        this.ctl.rigged = false; this.ctl.hatchOpen = false;
        // the payload tubes (their cells' average, ship-local) and a launcher for the strikes system
        const tubes = [];
        const rig = s.rig;
        s.mesh.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(s.mesh.matrixWorld).invert();
        for (let i = 0; i < rig.vls.length; i++) {
            const cells = rig.cells.filter(c => c.door === rig.vls[i]);
            if (!cells.length) continue;
            _v.set(0, 0, 0);
            for (const c of cells) { c.node.updateWorldMatrix(true, false); _v.add(_v2.setFromMatrixPosition(c.node.matrixWorld)); }
            _v.divideScalar(cells.length).applyMatrix4(inv);
            tubes.push({ i: tubes.length, vls: i, lx: _v.x, lz: _v.z, cells: cells.map(c => rig.cells.indexOf(c)), label: TUBE_NAMES[tubes.length] || 'TUBE ' + (tubes.length + 1), loaded: 0 });
        }
        // 12 TLAM and 4 Harpoon between the tubes (a Block V boat can carry 40 in its tubes; the rest are torpedo-room weapons)
        const load = [3, 3, 3, 3, 2, 2];
        tubes.forEach((t, i) => { t.loaded = load[i] ?? 2; });
        this.tubes = tubes;
        const st = g.strikes;
        if (st && st.enabled !== false) {
            this.launcher = st.addSource(new SubLauncher(st, s, { stock: { tlam: 12, harpoon: 4 }, tubes: tubes.map(t => ({ lx: t.lx, lz: t.lz })) }));
            this.launcher.prepTime = () => 1.4;   // (our fire control has already spun the weapon up)
        }
        this.fc = new SubFireControl(this.fcContext());
        // sites: the escape trunk hatch on the casing, the boarding point for a boat
        const sys = this.sys;
        sys.addSite({
            id: 'sub:hatch', label: 'GO BELOW — ESCAPE TRUNK (CONTROL ROOM)', radius: 2.2, dy: 2.5,
            at: (out) => (this.alive && this.ctl.surfaced ? this.hatchPos(out) : null),
            blocked: () => (!this.ctl.surfaced ? 'THE BOAT IS SUBMERGED' : null),
            enter: () => this.goBelow(),
        });
        sys.addSite({
            id: 'sub:boat', label: () => this.harbor.boats.some(b => b.moored && b.moored.host === s && !b.driver) ? 'BOARD THE BOAT ALONGSIDE' : 'SIGNAL FOR THE RHIB', radius: 2.4, dy: 2.5,
            at: (out) => (this.alive && this.ctl.surfaced ? this.entryPos(out) : null),
            enter: () => this.callBoat(),
        });
        this.harbor.docks.push(this.dock = {
            id: 'sub', host: s, label: 'STEP ACROSS ONTO THE SUB\'S CASING',
            at: (out) => (this.alive ? this.entryPos(out) : null),
            step: (out) => this.entryPos(out),
            ok: () => (!this.alive ? 'SUNK' : !this.ctl.surfaced ? 'SHE\'S SUBMERGED' : true),
            text: 'USS COLORADO (SSN-788)',
        });
        this.contacts = [];
        this.log = [];
    }

    clear() {
        this.token = null;
        if (this.dock) { const i = this.harbor.docks.indexOf(this.dock); if (i >= 0) this.harbor.docks.splice(i, 1); this.dock = null; }
        this.sys.removeSite('sub:hatch'); this.sys.removeSite('sub:boat');
        if (this.launcher && this.game.strikes) this.game.strikes.removeSource(this.launcher);
        this.sub = null; this.launcher = null; this.fc = null;
        this.room.state = { lights: 'normal' };
        if (this.feed) this.feed.cam = null;
    }

    hatchPos(out) { const h = this.sub.rig.hatches.escape; h.node.updateWorldMatrix(true, false); out.setFromMatrixPosition(h.node.matrixWorld); return out; }
    entryPos(out) { const p = this.sub.rig.points.hatch_entry; p.updateWorldMatrix(true, false); return out.setFromMatrixPosition(p.matrixWorld); }

    goBelow() {
        const sys = this.sys;
        this.ctl.openHatch(true);
        this.hatchAnim = 1;
        sys.enterRoom(this.room, { text: 'USS COLORADO (SSN-788) · CONTROL ROOM' });
        this.say('CONN', 'CAPTAIN IN CONTROL', { color: '#9fd4ff', say: false });
    }

    callBoat() {
        const s = this.sub, h = this.harbor;
        const at = this.entryPos(_v), l = s.toLocal(at.x, at.z);
        const side = l.lx >= 0 ? 1 : -1;
        const b = h.boatAlongside(s, l.lx + side * (BOAT_SPECS.rhib.B / 2 + 1.2), l.lz, 'rhib');
        h.board(b);
    }

    say(from, text, opts) { this.log.push({ t: this.game.time, from, text }); if (this.log.length > 30) this.log.shift(); say(this.game, from, text, opts); }

    // ── motion: the SubControl drives the ship (naval.js moves it round an orbit; we re-aim that orbit each frame) ──
    // naval.js moves a ship round its orbit (heading = the direction of travel): re-aim the orbit every frame so it
    // passes through where the boat is, pointing where we steer, at our speed and turn rate
    steer(speed, yawRate) { steerShip(this.sub, this.heading, speed, yawRate); }

    update(dt) {
        if (!this.alive) {
            // lost with the boat: if you were in her, that's the end of you
            if (this.sub && !this.sub.alive && this.sys.ctl && this.sys.ctl.room === this.room) {
                const pm = this.game.pilotMode;
                if (pm && pm.alive) { this.sys.releaseControl(); pm.takeHit(999, 'LOST WITH USS COLORADO'); }
            }
            return;
        }
        const s = this.sub, c = this.ctl;
        c.floor = -terrainHeight(s.mesh.position.x, s.mesh.position.z);
        c.update(dt);
        // heading from the ship (backing reverses the orbit's sense)
        this.heading += c.yawRate * dt;
        this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
        this.steer(c.speed, c.yawRate);
        setDepth(s, c.depth);
        s.trim = c.trim;
        for (const m of MASTS) raiseMast(s, m, c.masts[m]);
        this.hatchAnim = Math.max(0, (this.hatchAnim || 0) - dt / 3);
        openHatch(s, 'escape', c.hatchOpen || this.hatchAnim > 0 ? 1 : 0);
        if (c.hatchOpen && !(this.sys.ctl && this.sys.ctl.room === this.room) && this.hatchAnim <= 0 && !this.onDeck()) c.openHatch(false);
        // tubes: the fire control animates the muzzle hatches
        for (const t of this.tubes || []) { t.k = damp(t.k || 0, t.want || 0, 2.2, dt); openCell(s, t.cells[0], t.k); }
        if (this.fc) this.fc.update(dt);
        // sonar: a slow sweep of what's in the water
        this.sonarT -= dt;
        if (this.sonarT <= 0) { this.sonarT = 0.5; this.updateSonar(); }
        // alarms: the diving alarm ("aoogah") and three blasts to surface
        if (c.alarm && !c.alarm.played) {
            c.alarm.played = true;
            if (c.alarm.kind === 'dive') { this.say('CONN', 'DIVE, DIVE — MAKE YOUR DEPTH ' + c.ordered.label, { color: '#ffc23f', say: 'Dive, dive.' }); this.klaxon(2); }
            else { this.say('CONN', 'SURFACE, SURFACE, SURFACE', { color: '#ffc23f', say: 'Surface, surface, surface.' }); this.klaxon(3); }
        }
        if (this.game.audio && this.klaxonN > 0) { this.klaxonT -= dt; if (this.klaxonT <= 0) { this.klaxonN--; this.klaxonT = 1.2; this.honk(); } }
        this.updateFeed(dt);
    }

    onDeck() { const pm = this.game.pilotMode; return !!(pm && pm.deckRef && pm.deckRef.ship === this.sub); }

    klaxon(n) { this.klaxonN = n; this.klaxonT = 0; }
    honk() {
        const a = this.game.audio;
        if (!a || !a.running) return;
        const t = a.ctx.currentTime;
        a.tone(t, { type: 'sawtooth', f0: 330, f1: 220, gain: 0.22, decay: 0.8 });
        a.tone(t, { type: 'square', f0: 165, f1: 110, gain: 0.12, decay: 0.8 });
    }

    // what sonar hears: every hull in the water within range (quieter ones closer), with a bearing and a guess at range
    updateSonar() {
        const g = this.game, s = this.sub, P = s.mesh.position;
        const own = Math.abs(this.ctl.speed) * KT;
        const self = 1 + own / 12; // (flow noise at speed deafens the arrays)
        const out = [];
        const list = [...(g.naval ? g.naval.ships : []), ...this.harbor.boats];
        for (const u of list) {
            if (u === s || u.gone || u.removed || !u.alive) continue;
            const d = Math.hypot(u.mesh.position.x - P.x, u.mesh.position.z - P.z);
            const sp = u.vel ? Math.hypot(u.vel.x, u.vel.z) : 0;
            const loud = (u.type === 'carrier' ? 55 : u.type === 'supply' ? 40 : u.isBoat ? 14 + sp * 1.6 : u.cls === 'sub' || u.type === 'ssn' || u.type === 'ssgn' ? 6 : 28) * (0.6 + sp / 10);
            const range = loud * 1000 / self;
            if (d > range) continue;
            const snr = clamp(1 - d / range, 0, 1);
            const rec = g.war.rec(u);
            let c = this.contacts.find(x => x.unit === u);
            if (!c) { c = { unit: u, id: 'S' + (this.nextSierra = (this.nextSierra || 0) + 1), t0: g.time, err: rand(0.85, 1.2) }; }
            c.brg = bearing(P, u.mesh.position);
            c.range = d * c.err;
            c.snr = snr;
            c.kind = u.type === 'carrier' ? 'CARRIER' : u.isBoat ? 'SMALL CRAFT' : u.type === 'ssn' || u.type === 'ssgn' ? 'SUBMARINE' : u.type === 'supply' ? 'MERCHANT / AUX' : 'WARSHIP';
            c.team = u.team;
            c.known = rec ? rec.known : 0;
            c.label = u.team === g.war.side ? g.war.label(u) : c.known >= INTEL.IDENTIFIED ? g.war.label(u) : c.kind === 'WARSHIP' ? 'WARSHIP (UNKNOWN)' : c.kind;
            c.seen = g.time;
            out.push(c);
            // classification over time turns a contact into intel
            if (u.team !== g.war.side && g.time - c.t0 > 20 && snr > 0.3) g.war.reveal(u, INTEL.CONTACT, 'sonar', true);
            if (u.team !== g.war.side && g.time - c.t0 > 60 && snr > 0.5) g.war.reveal(u, INTEL.IDENTIFIED, 'sonar');
        }
        out.sort((a, b) => b.snr - a.snr);
        this.contacts = out;
        // the waterfall: a row of 256 bearing bins
        const W = 256;
        const row = new Float32Array(W);
        for (let i = 0; i < W; i++) row[i] = 0.08 + Math.random() * 0.12 * self;
        for (const c of out) {
            const b = c.brg / 360 * W;
            for (let k = -4; k <= 4; k++) { const i = (Math.round(b) + k + W) % W; row[i] += c.snr * Math.exp(-k * k / 3) * 0.9; }
        }
        (this.rows || (this.rows = [])).unshift(row);
        if (this.rows.length > 240) this.rows.pop();
    }

    // ── the fire control's view of the world ──
    fcContext() {
        const g = this.game;
        return {
            now: () => g.time,
            targets: () => this.targets(),
            stock: (w) => (this.launcher ? this.launcher.stock[w] || 0 : 0),
            tubes: () => (this.tubes || []).map(t => ({ i: t.i, label: t.label, cells: t.loaded })),
            link: () => this.link(),
            shipReady: () => this.shipReady(),
            range: (w, t) => {
                const P = this.sub.mesh.position, km = Math.hypot(t.pos.x - P.x, t.pos.z - P.z) / 1000;
                const max = (this.launcher ? this.launcher.range : 400000) / 1000 * (w === 'harpoon' ? 0.35 : 1);
                return { ok: km <= max && km > 2, km, max };
            },
            hatch: (tube, open) => { const t = this.tubes[tube]; if (t) t.want = open ? 1 : 0; },
            launch: (w, t, tube) => this.launch(w, t, tube),
        };
    }
    targets() {
        const P = this.sub ? this.sub.mesh.position : null;
        const list = this.link() ? targetList(this.game, P, { max: 16 }) : [];
        // sonar contacts too (the boat's own sensors)
        for (const c of this.contacts) {
            if (c.unit.team === this.game.war.side || list.some(x => x.unit === c.unit)) continue;
            list.push({ key: c.id, label: c.id + ' ' + c.label, kind: 'sea', pos: c.unit.pos, unit: c.unit, mark: null, grid: this.game.war.grid(c.unit.pos.x, c.unit.pos.z), intel: c.known, cls: 'ship', km: c.range / 1000, sonar: true });
        }
        return list;
    }
    // a target data link: a comms or SATCOM mast out of the water (or surfaced)
    link() {
        if (!this.alive) return false;
        const c = this.ctl;
        if (c.surfaced) return true;
        return (c.masts.comms > 0.95 && this.mastDry('comms')) || (c.masts.hdr > 0.95 && this.mastDry('hdr'));
    }
    mastDry(name) {
        const m = this.sub.rig.masts[name];
        if (!m) return false;
        m.node.updateWorldMatrix(true, false);
        _v.setFromMatrixPosition(m.node.matrixWorld);
        return _v.y > waterHeight(_v.x, _v.z) + 0.3;
    }
    shipReady() {
        const c = this.ctl;
        const keelFt = c.keelFt, kt = Math.abs(c.speed) * KT;
        if (keelFt > 160) return { ok: false, why: 'TOO DEEP — COME UP TO LAUNCH DEPTH (' + Math.round(keelFt) + ' FT)' };
        if (kt > 6) return { ok: false, why: 'TOO FAST — SLOW TO 5 KNOTS (' + Math.round(kt) + ' KT)' };
        if (Math.abs(c.vDepth) > 0.4) return { ok: false, why: 'HOLD YOUR DEPTH' };
        if (Math.abs(c.yawRate) > 0.004) return { ok: false, why: 'RUDDER AMIDSHIPS' };
        return { ok: true, why: '' };
    }
    launch(w, t, tube) {
        const st = this.game.strikes;
        if (!st || !this.launcher) return null;
        const T = this.tubes[tube];
        if (!T || T.loaded <= 0) return null;
        const mark = markFor(this.game, t, 'sonar');
        this.launcher.ix = tube;
        const s = st.launchFrom(this.launcher, w, [mark], { n: 1 });
        if (!s) return null;
        T.loaded--;
        this.lastLaunch = { t: this.game.time, strike: s, tube, weapon: w };
        this.say('USS COLORADO', 'UNIT AWAY — ' + SUB_WEAPONS[w].short + ' FROM ' + T.label + ', TARGET ' + (t.label || mark.label), { color: '#9fd4ff', say: 'Unit away.' });
        this.honk();
        this.game.shake = Math.max(this.game.shake, 0.5);
        this.game.audio.thud && this.game.audio.thud(0.6);
        return s;
    }

    // ── the photonics mast's picture: a small render target, drawn a few times a second while someone looks ──
    updateFeed(dt) {
        const rc = this.sys.ctl;
        if (!(rc && rc.room === this.room && !rc.view)) return;
        const F = this.feed || (this.feed = new CameraFeed(512, 300, 6, 30));
        F.mast = F.mast || 'periscope_1';
        F.update(dt, this.game, (cam) => {
            if (!(this.ctl.masts[F.mast] > 0.9 && this.mastDry(F.mast))) return false;
            this.mastCamera(cam, F.mast, this.heading, 0, 30);
            return true;
        });
    }
    // a camera at a mast's head, looking along compass heading `yaw` (rad, naval.js convention) and pitch
    mastCamera(cam, mast, yaw, pitch, fov) {
        const m = this.sub.rig.masts[mast];
        m.node.updateWorldMatrix(true, false);
        cam.position.setFromMatrixPosition(m.node.matrixWorld);
        cam.position.y += 0.15;
        cam.quaternion.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
        cam.fov = fov; cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        return cam;
    }

    // ═════════════ the control room ═════════════
    roomDef() {
        const ops = this, g = this.game;
        const bells = SUB_BELLS, rud = SUB_RUDDER;
        const dep = SUB_DEPTHS;
        const need = (fn) => () => { if (!ops.alive) return 'NO POWER'; return fn(); };
        const report = (r) => { if (r !== true) { g.addFeed(r, '#ffc23f'); g.audio.tick(260, 0.08, 0.06); } return r; };
        return {
            id: 'ssn-control', name: 'CONTROL ROOM', file: 'models/interiors/ssn_control.glb', sealed: true, exitName: 'LADDER',
            title: () => 'USS COLORADO (SSN-788) · CONTROL ROOM',
            status: () => {
                if (!ops.alive) return '';
                const c = ops.ctl;
                return 'KEEL ' + Math.round(c.keelFt) + ' FT · ORDERED ' + c.ordered.label + ' · ' + bells[c.bell].label + ' · ' + Math.round(Math.abs(c.speed) * KT) + ' KT · HDG ' + String(Math.round(hdgDeg(ops.heading))).padStart(3, '0') + (c.surfaced ? ' · SURFACED' : '');
            },
            anchor: (out) => {
                if (!ops.sub) return out.identity();
                const s = ops.sub.mesh;
                _m.compose(s.position, s.quaternion, s.scale);
                return out.makeTranslation(SUB_ROOM_OFFSET.x, SUB_ROOM_OFFSET.y, SUB_ROOM_OFFSET.z).premultiply(_m);
            },
            canExit: () => (!ops.alive ? true : !ops.ctl.surfaced ? 'SUBMERGED — SURFACE THE BOAT BEFORE GOING UP THE TRUNK' : true),
            exitTo: () => {
                ops.ctl.openHatch(true); ops.hatchAnim = 1.5;
                const p = ops.hatchPos(new THREE.Vector3());
                const l = ops.sub.toLocal(p.x, p.z);
                const w = ops.sub.toWorld(l.lx + 1.2, 0, l.lz, new THREE.Vector3());
                return { pos: { x: w.x, z: w.z, y: p.y }, yaw: ops.sub.heading + Math.PI / 2 };
            },
            onLoad: (room) => { dressRoom(room); room.lights && room.lights.forEach(l => { l.intensity *= l.name === 'amb' ? 0.8 : 0.5; l.userData.base = l.intensity; }); },
            onEnter: () => { ops.ctl.openHatch(false); },
            stations: {
                stand_scs: { label: 'SHIP CONTROL', order: 1 }, stand_cws: { label: 'COMMAND WORK STATION', order: 2 },
                stand_photon_1: { label: 'PHOTONICS 1', order: 3 }, stand_sonar2: { label: 'SONAR', order: 4 },
                stand_fc1: { label: 'FIRE CONTROL · TARGETS', order: 5 }, stand_fc2: { label: 'FIRE CONTROL · WEAPONS', order: 6 },
                stand_fc3: { label: 'LAUNCHER CONTROL', order: 7 }, stand_nav: { label: 'NAVIGATION PLOT', order: 8 },
                stand_radar: { label: 'RADAR', order: 9 },
            },
            keys: [{ code: 'KeyK', label: 'WATCH THE LAUNCH', run: () => {} }],
            actions: { missilecam: () => (ops.lastLaunch && g.time - ops.lastLaunch.t < 60 ? (ops.watchLaunch(), true) : false) },
            bind: {
                lever_speed: { label: () => 'ENGINE ORDER — ' + bells[ops.ctl.bell].label, value: () => ops.ctl.bell / (bells.length - 1), turn: (d) => ops.ctl.setBell(ops.ctl.bell + d), key: null, enabled: () => ops.alive },
                knob_rudder: { label: () => 'RUDDER — ' + rudLabel(rud[ops.ctl.rudder]), value: () => ops.ctl.rudder / (rud.length - 1), turn: (d) => ops.ctl.setRudder(ops.ctl.rudder + d), enabled: () => ops.alive },
                knob_depth: { label: () => 'ORDERED DEPTH — ' + ops.ctl.ordered.label, value: () => ops.ctl.orderedIx / (dep.length - 1), turn: (d) => report(ops.ctl.orderDepth(ops.ctl.orderedIx + d)), enabled: () => ops.alive },
                btn_dive: { label: 'DIVE (TO PERISCOPE DEPTH)', key: 'KeyZ', press: () => report(ops.ctl.dive()), enabled: need(() => true) },
                btn_surface: { label: 'SURFACE', key: 'KeyX', press: () => ops.ctl.surface() },
                btn_blow: { label: 'EMERGENCY BLOW', press: () => { ops.ctl.emergencyBlow(); ops.say('CONN', 'EMERGENCY BLOW! — BLOWING ALL MAIN BALLAST', { color: '#ff5a4a', say: 'Emergency blow!' }); ops.klaxon(3); } },
                sw_rig: { label: () => ops.ctl.rigged ? 'RIGGED FOR DIVE' : 'RIG FOR DIVE', key: 'KeyR', value: () => ops.ctl.rigged, press: () => report(ops.ctl.setRig(!ops.ctl.rigged)) },
                lamp_hull: { lit: () => ops.alive && ops.ctl.rigged && !ops.ctl.hatchOpen },
                lamp_depth: { lit: () => ops.alive && Math.abs(ops.ctl.depth - ops.ctl.depthFor(ops.ctl.orderedIx)) < 1 },
                sw_mast_esm: { label: 'ESM MAST', value: () => ops.ctl.mastWant.esm, press: () => report(ops.ctl.raiseMast('esm', !ops.ctl.mastWant.esm)) },
                sw_mast_hdr: { label: 'SATCOM MAST (DATA LINK)', value: () => ops.ctl.mastWant.hdr, press: () => report(ops.ctl.raiseMast('hdr', !ops.ctl.mastWant.hdr)) },
                sw_mast_comms: { label: 'COMMS MAST (DATA LINK)', value: () => ops.ctl.mastWant.comms, press: () => report(ops.ctl.raiseMast('comms', !ops.ctl.mastWant.comms)) },
                sw_mast_radar: { label: 'RADAR MAST', value: () => ops.ctl.mastWant.radar, press: () => report(ops.ctl.raiseMast('radar', !ops.ctl.mastWant.radar)) },
                btn_mast_1: { label: () => (ops.ctl.mastWant.periscope_1 ? 'LOWER' : 'RAISE') + ' PHOTONICS MAST 1', key: 'KeyU', press: () => report(ops.ctl.raiseMast('periscope_1', !ops.ctl.mastWant.periscope_1)) },
                btn_mast_2: { label: () => (ops.ctl.mastWant.periscope_2 ? 'LOWER' : 'RAISE') + ' PHOTONICS MAST 2', press: () => report(ops.ctl.raiseMast('periscope_2', !ops.ctl.mastWant.periscope_2)) },
                lamp_mast_1: { lit: () => ops.alive && ops.ctl.masts.periscope_1 > 0.95 },
                lamp_mast_2: { lit: () => ops.alive && ops.ctl.masts.periscope_2 > 0.95 },
                btn_view_1: { label: 'VIEW PHOTONICS 1 (FULL SCREEN)', key: 'KeyV', press: (c, rc) => ops.takeView(rc, 'periscope_1') },
                btn_view_2: { label: 'VIEW PHOTONICS 2 (FULL SCREEN)', press: (c, rc) => ops.takeView(rc, 'periscope_2') },
                sw_key: { label: () => ops.fc && ops.fc.armed ? 'WEAPON KEY — ARMED' : 'WEAPON KEY — SAFE', value: () => ops.fc && ops.fc.armed, press: () => report(ops.fc.setKey(!ops.fc.armed)) },
                btn_spinup: { label: 'SPIN UP', press: () => report(ops.fc.spinUp()) },
                btn_fpp: { label: 'FIRING POINT PROCEDURES', press: () => { report(ops.fc.orderFpp()); ops.say('CAPTAIN', 'FIRING POINT PROCEDURES, ' + SUB_WEAPONS[ops.fc.weapon].short + (ops.fc.target ? ', ' + ops.fc.target.label : ''), { color: '#e8f4ff', say: false }); } },
                btn_muzzle: { label: 'OPEN MUZZLE HATCH', press: () => report(ops.fc.openMuzzle()) },
                btn_abort: { label: 'ABORT / CHECK FIRE', press: () => ops.fc.abort() },
                btn_fire: { label: 'FIRE', press: () => { const r = ops.fc.fire(); if (r !== true) report('CAN\'T FIRE — ' + r); } },
                guard_fire: { label: 'FIRE GUARD' },
                lamp_ship: { lit: () => ops.fc && ops.fc.shipReady() },
                lamp_weapon: { lit: () => ops.fc && (ops.fc.weaponReady() ? 1 : ops.fc.spinning ? (Math.sin(g.time * 8) > 0 ? 0.6 : 0.1) : 0) },
                lamp_solution: { lit: () => ops.fc && ops.fc.solutionReady() },
                exit_ladder: { label: 'LADDER UP — ESCAPE TRUNK (LEAVE THE BOAT)' },
                sw_lights: { label: () => 'LIGHTING — ' + (ops.room.state.lights === 'night' ? 'NIGHT' : 'NORMAL'), value: () => ops.room.state.lights === 'night', press: () => ops.setLights(ops.room.state.lights === 'night' ? 'normal' : 'night') },
            },
            screens: subScreens(ops),
            update: (dt, room) => { void dt; void room; },
        };
    }

    setLights(mode) {
        this.room.state.lights = mode;
        for (const l of this.room.lights || []) {
            const base = l.userData.base ?? l.intensity;
            l.intensity = mode === 'night' ? base * (l.name === 'amb' ? 0.35 : 0.22) : base;
            if (l.color && l.name !== 'amb') l.color.set(mode === 'night' ? '#7a78c8' : '#eef3ff');
        }
    }

    // the full-screen photonics view
    takeView(rc, mast) {
        const c = this.ctl;
        if (c.masts[mast] < 0.9) { this.game.addFeed('THE MAST IS HOUSED — RAISE IT FIRST', '#ffc23f'); return; }
        rc.setView(new PeriscopeView(this, mast));
    }

    // K: watch the launch from outside (the missile breaking the surface), then the missile camera
    watchLaunch() {
        const L = this.lastLaunch;
        if (!L || this.game.time - L.t > 60) { this.game.addFeed('NO LAUNCH TO WATCH', '#9fb2c4'); return; }
        const rc = this.sys.ctl;
        if (rc && rc.setView) rc.setView(new LaunchView(this, L));
    }
}

function rudLabel(d) { return d === 0 ? 'MIDSHIPS' : (d < 0 ? 'LEFT ' : 'RIGHT ') + Math.abs(d) + '°'; }

// Drive a naval.js Ship (which steams round a circle: x = c + R (cos a, sin a), heading = its direction of travel)
// as if it had a helm: the circle is re-aimed through where it is now, so it heads `heading` (rad, + to port) at
// `speed` (m/s) turning at `yawRate` (rad/s, + to port). Stopped, it keeps its heading.
export function steerShip(ship, heading, speed, yawRate) {
    const o = ship.orbit, P = ship.mesh.position;
    const sp = Math.max(Math.abs(speed), 1e-3);
    const r = Math.abs(yawRate) < 1e-6 ? 0 : yawRate;
    const sg = r > 0 ? -1 : 1;                          // (w > 0 turns to starboard: the heading goes down)
    const R = r === 0 ? 1e7 : Math.min(1e7, Math.max(20, sp / Math.abs(r)));
    const a = sg > 0 ? Math.PI - heading : -heading;
    o.R = R; o.a = a; o.cx = P.x - R * Math.cos(a); o.cz = P.z - R * Math.sin(a);
    o.w = sg * sp / R;
}

// ═════════════ The photonics mast, full screen ═════════════
// The camera at the mast head (mouse pans, wheel zooms: WFOV 32° … NFOV 1.6°), the video graded like a
// camera (daylight colour, black-and-white or infra-red: I), a bearing tape and a reticle. LMB / comma marks what's
// under the reticle; the war's eyes look out through it (it's how you find and identify ships). Esc / RMB leaves.
class PeriscopeView {
    constructor(ops, mast) {
        this.ops = ops; this.game = ops.game; this.mast = mast;
        this.yaw = 0; this.pitch = 0; this.fov = 32;
        this.outside = true; this.near = 0.3;
        this.mode = 0; this.prevLeft = true;
    }
    enter() { this.game.audio.tick(1200, 0.06, 0.05); this.game.addFeed('PHOTONICS ' + this.mast.slice(-1) + ' — MOUSE: TRAIN · WHEEL: ZOOM · LMB: MARK · I: MODE · ESC: BACK', '#9fd4ff'); }
    leave() {}
    control(dt, mouse, rc) {
        const g = this.game;
        const k = this.fov / 60;
        this.yaw -= mouse.dx * 0.0022 * k * (g.settings.sensitivity || 1);
        this.pitch = clamp(this.pitch - mouse.dy * 0.0022 * k, -0.25, 0.6);
        if (mouse.wheel) this.fov = clamp(this.fov * (mouse.wheel > 0 ? 1.25 : 0.8), 1.6, 32);
        const left = g.input.mouse.left;
        if (left && !this.prevLeft) this.mark();
        this.prevLeft = left;
        void rc; void dt;
    }
    pose(rc, pos, quat) {
        this.ops.mastCamera(this.game.camera, this.mast, this.ops.heading + this.yaw, this.pitch, this.fov);
        pos.copy(this.game.camera.position); quat.copy(this.game.camera.quaternion);
    }
    camera(cam) {
        this.ops.mastCamera(cam, this.mast, this.ops.heading + this.yaw, this.pitch, this.fov);
        cam.near = 0.3;
    }
    wet() {
        const c = this.ops.ctl;
        return c.masts[this.mast] < 0.9 || !this.ops.mastDry(this.mast);
    }
    // mark what's under the reticle: a ship in the view, else the sea surface / ground there
    mark() {
        const g = this.game, war = g.war, cam = g.camera;
        cam.getWorldDirection(_v);
        let best = null, bd = Math.max(0.004, this.fov * Math.PI / 180 * 0.04);
        for (const u of war.units) {
            if (!u.alive || u.team === war.side) continue;
            _v2.subVectors(u.pos, cam.position);
            const d = _v2.length();
            if (d > 40000) continue;
            const ang = Math.acos(clamp(_v2.dot(_v) / d, -1, 1));
            if (ang < bd + (u.radius || 10) / d) { bd = ang; best = u; }
        }
        if (best) { war.reveal(best, INTEL.IDENTIFIED, 'periscope'); war.designate(best, 'periscope'); }
        else {
            if (_v.y >= -0.001) { g.addFeed('NOTHING UNDER THE RETICLE — AIM AT THE HORIZON OR A SHIP', '#9fb2c4'); return; }
            const t = -cam.position.y / _v.y;
            war.designate({ x: cam.position.x + _v.x * t, z: cam.position.z + _v.z * t }, 'periscope');
        }
        g.audio.tick(1500, 0.08, 0.05);
    }
    action(a, rc) {
        if (a === 'pause' || a === 'missile' || a === 'camera' || a === 'target') { rc.setView(null); return true; }
        if (a === 'designate') { this.mark(); return true; }
        if (a === 'nvg') { this.mode = (this.mode + 1) % 3; return true; }
        return ['flares', 'flaps', 'weapon', 'gear', 'hook', 'photo'].includes(a) || /^thr/.test(a);
    }
    hud(ctx, hud) {
        const g = this.game, W = hud.w, H = hud.h, ops = this.ops;
        ctx.save();
        const wet = this.wet();
        if (wet) {
            ctx.fillStyle = 'rgba(2,10,14,0.92)'; ctx.fillRect(0, 0, W, H);
            text(ctx, ops.ctl.masts[this.mast] < 0.9 ? 'MAST HOUSED — RAISE PHOTONICS ' + this.mast.slice(-1) : 'MAST WET — COME SHALLOWER', W / 2, H / 2, 22, C.amber, 700, 'center');
        }
        // the picture's mode: colour, black-and-white, infra-red (a tint over the frame)
        if (!wet && this.mode === 1) { ctx.fillStyle = 'rgba(128,128,128,0.35)'; ctx.globalCompositeOperation = 'saturation'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
        if (!wet && this.mode === 2) { ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.globalCompositeOperation = 'difference'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,1)'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
        // a round-cornered frame, the reticle with mil ticks
        const R = Math.min(W, H) * 0.46;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2, true); ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(20,20,20,0.9)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(10,10,10,0.85)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(W / 2 - R, H / 2); ctx.lineTo(W / 2 - 14, H / 2); ctx.moveTo(W / 2 + 14, H / 2); ctx.lineTo(W / 2 + R, H / 2);
        ctx.moveTo(W / 2, H / 2 - R); ctx.lineTo(W / 2, H / 2 - 14); ctx.moveTo(W / 2, H / 2 + 14); ctx.lineTo(W / 2, H / 2 + R); ctx.stroke();
        for (let i = -10; i <= 10; i++) { if (!i) continue; const x = W / 2 + i * R / 11; ctx.beginPath(); ctx.moveTo(x, H / 2 - (i % 5 ? 5 : 11)); ctx.lineTo(x, H / 2 + (i % 5 ? 5 : 11)); ctx.stroke(); }
        // bearing, zoom, the boat's depth
        const brg = (hdgDeg(ops.heading + this.yaw) + 360) % 360;
        text(ctx, 'BRG ' + String(Math.round(brg)).padStart(3, '0') + '°  ·  ' + (this.fov > 8 ? 'WFOV' : this.fov > 3 ? 'MFOV' : 'NFOV') + ' ' + this.fov.toFixed(1) + '°  ·  ' + ['COLOR', 'B/W', 'IR'][this.mode], W / 2, H / 2 + R + 26 > H - 20 ? 40 : H / 2 + R + 26, 16, '#e8f4ff', 700, 'center');
        text(ctx, 'PHOTONICS ' + this.mast.slice(-1) + ' · KEEL ' + Math.round(ops.ctl.keelFt) + ' FT · ' + Math.round(Math.abs(ops.ctl.speed) * KT) + ' KT', W / 2, 26, 14, 'rgba(232,244,255,0.8)', 600, 'center');
        text(ctx, 'MOUSE TRAIN · WHEEL ZOOM · LMB / , MARK · I MODE · ESC / RMB BACK', W / 2, H - 22, 12, 'rgba(232,244,255,0.65)', 600, 'center');
        ctx.restore();
        void g;
    }
}

// ═════════════ Watching the launch: from the water beside the boat, then the missile camera ═════════════
class LaunchView {
    constructor(ops, L) { this.ops = ops; this.game = ops.game; this.L = L; this.t = 0; this.outside = true; this.near = 0.5; }
    enter() {}
    leave() {}
    missile() { const st = this.L.strike; return st && st.missiles.find(m => m.alive) || null; }
    control(dt, mouse, rc) {
        this.t += dt;
        const m = this.missile();
        // once the missile's up and away, the strikes' missile camera takes it from here
        if (m && (m.age > 7 || this.t > 14)) { this.game.strikes.cam = { missile: m, mode: 'chase', hold: 0, t: 0 }; rc.setView(null); return; }
        if (this.t > 25) rc.setView(null);
        void mouse;
    }
    pose(rc, pos, quat) { this.camera(this.game.camera); pos.copy(this.game.camera.position); quat.copy(this.game.camera.quaternion); }
    camera(cam) {
        const s = this.ops.sub, T = this.ops.tubes[this.L.tube];
        const tube = s.toWorld(T.lx, 0, T.lz, _v); tube.y = 0;
        const side = s.toWorld(T.lx + 70, 0, T.lz + 25, _v2); side.y = 6 + Math.max(0, waterHeight(side.x, side.z));
        cam.position.copy(side);
        const m = this.missile();
        cam.lookAt(m ? _v3.copy(m.pos).lerp(tube, 0.3) : tube.setY(8));
        cam.fov = damp(cam.fov, 38, 3, 1 / 60); cam.updateProjectionMatrix();
    }
    action(a, rc) { if (a === 'pause' || a === 'missilecam' || a === 'missile') { rc.setView(null); return true; } return true; }
    hud(ctx, hud) { text(ctx, 'LAUNCH — ' + SUB_WEAPONS[this.L.weapon].short + ' · ESC: BACK TO THE CONTROL ROOM', hud.w / 2, hud.h - 30, 14, '#e8f4ff', 700, 'center'); }
}

// ═════════════ the control room's screens ═════════════
function subScreens(ops) {
    const g = ops.game;
    const dead = (ctx, W, H) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return !ops.alive; };
    const mapView = new Map();
    const mv = (s) => mapView.get(s) || (mapView.set(s, new MapView(g, s.w, s.h)), mapView.get(s));
    return {
        // ── ship control: orders (touch) and the boat's state ──
        screen_scs_l: {
            fps: 6, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const c = ops.ctl;
                const y0 = page(ctx, W, H, 'SHIP CONTROL — ORDERS', 'PILOT', clockZ(g));
                text(ctx, 'ENGINE ORDER', 20, y0 + 14, 14, C.dim);
                SUB_BELLS.forEach((b, i) => ui.button(16 + i * 142, y0 + 30, 134, 52, b.label.replace('AHEAD ', ''), () => c.setBell(i), { on: c.bell === i, sub: b.kt + ' KT', size: 15 }));
                text(ctx, 'RUDDER', 20, y0 + 104, 14, C.dim);
                SUB_RUDDER.forEach((r, i) => ui.button(16 + i * 142, y0 + 120, 134, 46, rudLabel(r).replace('MIDSHIPS', 'MID'), () => c.setRudder(i), { on: c.rudder === i, size: 15 }));
                text(ctx, 'ORDERED DEPTH', 20, y0 + 188, 14, C.dim);
                SUB_DEPTHS.forEach((d, i) => ui.button(16 + i * 166, y0 + 204, 158, 52, d.label.replace('PERISCOPE DEPTH', 'PERISCOPE'), () => { const r = c.orderDepth(i); if (r !== true) g.addFeed(r, '#ffc23f'); }, { on: c.orderedIx === i, sub: d.ft ? d.ft + ' FT KEEL' : '', size: 15 }));
                ui.button(16, y0 + 280, 230, 64, 'DIVE', () => { const r = c.dive(); if (r !== true) g.addFeed(r, '#ffc23f'); }, { c: C.green, size: 22 });
                ui.button(262, y0 + 280, 230, 64, 'SURFACE', () => c.surface(), { c: C.amber, size: 22 });
                ui.button(508, y0 + 280, 230, 64, c.rigged ? 'RIGGED FOR DIVE' : 'RIG FOR DIVE', () => { const r = c.setRig(!c.rigged); if (r !== true) g.addFeed(r, '#ffc23f'); }, { on: c.rigged, size: 18 });
                ui.button(754, y0 + 280, 250, 64, 'EMERGENCY BLOW', null, { danger: true, disabled: true, sub: 'THE GUARDED RED BUTTON', size: 16 });
                if (c.msg) text(ctx, c.msg, W / 2, H - 22, 16, C.amber, 700, 'center', W - 30);
            },
        },
        screen_scs_c1: {
            fps: 4, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const c = ops.ctl;
                const y0 = page(ctx, W, H, 'DEPTH / TRIM', 'CO-PILOT', clockZ(g));
                tape(ctx, 40, y0 + 30, 150, H - y0 - 60, c.keelFt, 300, 25, 'KEEL DEPTH FT', (n) => String(Math.round(n)), c.depthFor(c.orderedIx) / FT + c.spec.draft / FT, true);
                // the boat's attitude: a silhouette tilted by the trim
                const cx = 560, cy = y0 + 170;
                ctx.save(); ctx.translate(cx, cy); ctx.rotate(-c.trim);
                ctx.fillStyle = '#2a4a60'; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.ellipse(0, 0, 260, 34, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillRect(-150, -80, 70, 50); ctx.strokeRect(-150, -80, 70, 50);
                ctx.restore();
                ctx.strokeStyle = C.dim; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(260, cy); ctx.lineTo(W - 20, cy); ctx.stroke(); ctx.setLineDash([]);
                readout(ctx, 260, y0 + 300, 230, 90, 'TRIM', (c.trim * 57.3 >= 0 ? 'UP ' : 'DOWN ') + Math.abs(c.trim * 57.3).toFixed(1) + '°');
                readout(ctx, 500, y0 + 300, 230, 90, 'DEPTH RATE', (c.vDepth >= 0 ? '↓ ' : '↑ ') + Math.abs(c.vDepth / FT * 60).toFixed(0), c.vDepth > 0.5 ? C.amber : C.white, 'FT/MIN');
                readout(ctx, 740, y0 + 300, 260, 90, 'UNDER THE KEEL', isFinite(c.floor) ? Math.round((c.floor - c.keel) / FT) + '' : '—', (c.floor - c.keel) < 30 ? C.red : C.white, 'FT');
            },
        },
        screen_scs_c2: {
            fps: 5, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const c = ops.ctl;
                const y0 = page(ctx, W, H, 'NAVIGATION — COURSE / SPEED', '', clockZ(g));
                compass(ctx, 250, y0 + (H - y0) / 2, (H - y0) / 2 - 36, hdgDeg(ops.heading), null, 'HEADING');
                readout(ctx, 520, y0 + 30, 230, 100, 'SPEED', (c.speed * KT).toFixed(1), C.white, 'KT');
                readout(ctx, 770, y0 + 30, 230, 100, 'ORDERED', SUB_BELLS[c.bell].label.replace('AHEAD ', ''), C.cyan);
                readout(ctx, 520, y0 + 150, 230, 100, 'RUDDER', rudLabel(SUB_RUDDER[c.rudder]), C.white);
                readout(ctx, 770, y0 + 150, 230, 100, 'TURN RATE', (c.yawRate * 57.3 * 60).toFixed(0), C.white, '°/MIN');
                const P = ops.sub.mesh.position;
                readout(ctx, 520, y0 + 270, 480, 100, 'POSITION', g.war.grid(P.x, P.z), C.green);
            },
        },
        screen_scs_r: {
            fps: 3, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const c = ops.ctl;
                const y0 = page(ctx, W, H, 'BALLAST / HULL OPENINGS', 'CO-PILOT', clockZ(g));
                const rows = [
                    ['ESCAPE TRUNK HATCH', c.hatchOpen ? 'OPEN' : 'SHUT', c.hatchOpen ? C.red : C.green],
                    ['MAIN INDUCTION', c.surfaced ? 'OPEN' : 'SHUT', c.surfaced && c.rigged ? C.green : c.surfaced ? C.amber : C.green],
                    ['RIG FOR DIVE', c.rigged ? 'COMPLETE' : 'NOT RIGGED', c.rigged ? C.green : C.amber],
                    ['MAIN BALLAST TANKS', c.blow > 0 ? 'BLOWING' : c.surfaced ? 'DRY' : 'FLOODED', c.blow > 0 ? C.red : C.white],
                ];
                rows.forEach((r, i) => { text(ctx, r[0], 30, y0 + 30 + i * 44, 18, C.text, 600); text(ctx, r[1], W / 2 - 20, y0 + 30 + i * 44, 18, r[2], 700); });
                text(ctx, 'MASTS', W / 2 + 30, y0 + 30, 18, C.dim, 700);
                MASTS.forEach((m, i) => {
                    const k = c.masts[m];
                    text(ctx, { periscope_1: 'PHOTONICS 1', periscope_2: 'PHOTONICS 2', esm: 'ESM', hdr: 'SATCOM', comms: 'COMMS', radar: 'RADAR' }[m], W / 2 + 30, y0 + 66 + i * 38, 16, C.text);
                    bar(ctx, W / 2 + 200, y0 + 54 + i * 38, 180, 22, k, k > 0.95 ? C.green : C.amber, k > 0.95 ? 'RAISED' : k < 0.05 ? 'HOUSED' : 'MOVING');
                });
                text(ctx, ops.link() ? 'DATA LINK: UP — TARGETS FROM COMMAND' : 'DATA LINK: DOWN — RAISE COMMS / SATCOM AT PD', 30, H - 30, 17, ops.link() ? C.green : C.amber, 700);
            },
        },
        // ── the vertical large screen displays: the photonics picture and the tactical plot ──
        screen_vlsd_1: { fps: 6, feed: true, draw: (ctx, ui, s) => drawPhotonics(ctx, ui, s, ops, 'periscope_1') },
        screen_vlsd_2: { fps: 2, draw: (ctx, ui, s) => drawTactical(ctx, s, ops, mv(s), 'TACTICAL PLOT', 0.0025) },
        screen_photon_1: { fps: 6, feed: true, draw: (ctx, ui, s) => drawPhotonics(ctx, ui, s, ops, 'periscope_1') },
        screen_photon_2: { fps: 6, feed: true, draw: (ctx, ui, s) => drawPhotonics(ctx, ui, s, ops, 'periscope_2') },
        // ── the command work station ──
        screen_cws_1: {
            fps: 3, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const c = ops.ctl, fc = ops.fc;
                const y0 = page(ctx, W, H, 'COMMAND SUMMARY', 'CO / OOD', clockZ(g));
                readout(ctx, 20, y0 + 10, 230, 86, 'KEEL DEPTH', Math.round(c.keelFt) + '', C.white, 'FT');
                readout(ctx, 262, y0 + 10, 230, 86, 'SPEED', (c.speed * KT).toFixed(1), C.white, 'KT');
                readout(ctx, 504, y0 + 10, 230, 86, 'COURSE', String(Math.round(hdgDeg(ops.heading))).padStart(3, '0'), C.white, '°T');
                readout(ctx, 746, y0 + 10, 256, 86, 'WEAPONS', (ops.launcher ? ops.launcher.stock.tlam : 0) + ' TLAM · ' + (ops.launcher ? ops.launcher.stock.harpoon : 0) + ' HPN', C.cyan);
                text(ctx, 'SONAR CONTACTS', 20, y0 + 128, 16, C.dim, 700);
                ops.contacts.slice(0, 7).forEach((k, i) => ui.row(16, y0 + 144 + i * 34, W - 32, 32, [[k.id, 80], [k.label, 420], [String(Math.round(k.brg)).padStart(3, '0') + '°', 110, 'right'], [(k.range / 1852).toFixed(1) + ' NM', 150, 'right'], [INTEL_NAMES[k.known] || '', 200, 'right']], null, { colors: [C.cyan, k.team === 'blue' ? C.blue : k.known >= 2 ? C.red : C.amber] }));
                if (!ops.contacts.length) text(ctx, 'NO CONTACTS HELD', 30, y0 + 162, 15, C.dim);
                if (fc && fc.target) text(ctx, 'FIRE CONTROL: ' + SUB_WEAPONS[fc.weapon].short + ' → ' + fc.target.label + (fc.canFire ? ' — READY' : ' — ' + fc.blocker()), 20, H - 26, 15, fc.canFire ? C.green : C.amber, 700, 'left', W - 40);
            },
        },
        screen_cws_2: {
            fps: 4, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const c = ops.ctl;
                const y0 = page(ctx, W, H, 'PHOTONICS / MASTS', 'CONTROL', clockZ(g));
                ['periscope_1', 'periscope_2'].forEach((m, i) => {
                    const x = 20 + i * 500;
                    text(ctx, 'PHOTONICS MAST ' + (i + 1), x, y0 + 20, 20, C.white, 700);
                    bar(ctx, x, y0 + 40, 460, 28, c.masts[m], c.masts[m] > 0.95 ? C.green : C.amber, c.masts[m] > 0.95 ? (ops.mastDry(m) ? 'RAISED — DRY' : 'RAISED — WET') : c.masts[m] < 0.05 ? 'HOUSED' : 'MOVING');
                    ui.button(x, y0 + 84, 220, 64, c.mastWant[m] ? 'LOWER' : 'RAISE', () => { const r = c.raiseMast(m, !c.mastWant[m]); if (r !== true) g.addFeed(r, '#ffc23f'); }, { size: 20 });
                    ui.button(x + 240, y0 + 84, 220, 64, 'VIEW', () => { if (ops.sys.ctl && ops.sys.ctl.setView) ops.takeView(ops.sys.ctl, m); }, { c: C.green, size: 20, disabled: c.masts[m] < 0.9 });
                });
                text(ctx, 'OTHER MASTS', 20, y0 + 190, 16, C.dim, 700);
                ['esm', 'hdr', 'comms', 'radar'].forEach((m, i) => ui.button(20 + i * 248, y0 + 210, 236, 56, { esm: 'ESM', hdr: 'SATCOM', comms: 'COMMS', radar: 'RADAR' }[m] + (c.mastWant[m] ? ' ▲' : ' ▼'), () => { const r = c.raiseMast(m, !c.mastWant[m]); if (r !== true) g.addFeed(r, '#ffc23f'); }, { on: c.masts[m] > 0.95, size: 18 }));
                text(ctx, c.depth > c.spec.pd + 3 ? 'TOO DEEP FOR MASTS — COME TO PERISCOPE DEPTH (' + Math.round((c.spec.pd + c.spec.draft) / FT) + ' FT)' : 'AT PERISCOPE DEPTH THE MASTS SHOW 3–5 M ABOVE THE WATER', 20, H - 28, 15, c.depth > c.spec.pd + 3 ? C.amber : C.dim, 600, 'left', W - 40);
            },
        },
        // ── sonar ──
        screen_sonar_wf: { fps: 2, w: 1024, h: 640, draw: (ctx, ui, s) => drawWaterfall(ctx, s, ops) },
        screen_sonar_tac: {
            fps: 2, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const y0 = page(ctx, W, H, 'SONAR — CONTACTS', 'AN/BQQ-10', clockZ(g));
                const rows = ops.contacts.slice(0, 12);
                text(ctx, 'CONTACT        CLASSIFICATION                BRG      EST RANGE     SNR', 20, y0 + 12, 14, C.dim, 700);
                rows.forEach((k, i) => {
                    const mark = g.war.designations.some(d => d.unit === k.unit);
                    ui.row(16, y0 + 28 + i * 40, W - 32, 38, [[k.id, 110], [k.label, 380], [String(Math.round(k.brg)).padStart(3, '0') + '°', 110, 'right'], [(k.range / 1852).toFixed(1) + ' NM', 170, 'right'], [(k.snr * 30).toFixed(0) + ' DB', 110, 'right']], k.team !== g.war.side ? () => { g.war.designate(k.unit, 'sonar'); g.addFeed('SONAR: ' + k.id + ' DESIGNATED AS A TARGET', '#5dffa0'); } : null, { colors: [C.cyan, k.team === g.war.side ? C.blue : k.known >= 2 ? C.red : C.amber], sel: mark });
                });
                if (!rows.length) text(ctx, 'NO CONTACTS — THE SEA IS QUIET', W / 2, H / 2, 20, C.dim, 700, 'center');
                text(ctx, 'CLICK A HOSTILE CONTACT TO DESIGNATE IT FOR FIRE CONTROL', W / 2, H - 22, 14, C.dim, 600, 'center');
            },
        },
        screen_sonar_nb: {
            fps: 3, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const y0 = page(ctx, W, H, 'SONAR — NARROWBAND', 'LOFAR', clockZ(g));
                const k = ops.contacts[0];
                ctx.strokeStyle = C.grid; for (let x = 60; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, y0 + 10); ctx.lineTo(x, H - 40); ctx.stroke(); }
                if (!k) { text(ctx, 'NO CONTACT', W / 2, H / 2, 22, C.dim, 700, 'center'); return; }
                text(ctx, k.id + ' · ' + k.label, 20, y0 + 16, 16, C.white, 700);
                const lines = k.kind === 'CARRIER' ? [60, 120, 240, 410] : k.kind === 'SUBMARINE' ? [50, 75] : k.kind === 'SMALL CRAFT' ? [180, 360, 540, 720] : [90, 180, 300, 510];
                const t = g.time;
                for (let y = y0 + 40; y < H - 40; y += 3) for (let x = 60; x < W - 20; x += 3) {
                    const fr = (x - 60) / (W - 80) * 800;
                    let v = Math.random() * 0.25;
                    for (const L of lines) if (Math.abs(fr - L + Math.sin((y + t * 20) * 0.02) * 2) < 3) v += k.snr * 0.9;
                    if (v > 0.18) { ctx.fillStyle = 'rgba(93,255,160,' + Math.min(0.9, v).toFixed(2) + ')'; ctx.fillRect(x, y, 3, 3); }
                }
                text(ctx, '0 HZ', 60, H - 22, 12, C.dim); text(ctx, '400', W / 2, H - 22, 12, C.dim, 600, 'center'); text(ctx, '800 HZ', W - 30, H - 22, 12, C.dim, 600, 'right');
            },
        },
        // ── fire control ──
        screen_fc_tgt: {
            fps: 2, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const fc = ops.fc;
                const y0 = page(ctx, W, H, 'COMBAT CONTROL — TARGETS', ops.link() ? 'LINK UP' : 'NO LINK', clockZ(g), ops.link() ? C.green : C.amber);
                const list = ops.targets();
                text(ctx, 'TARGET                                  TYPE      GRID          RANGE     INTEL', 20, y0 + 12, 13, C.dim, 700);
                list.slice(0, 12).forEach((t, i) => ui.row(16, y0 + 28 + i * 38, W - 32, 36, [[t.label, 420], [t.kind === 'sea' ? 'SHIP' : 'LAND', 90], [t.grid || '', 190], [Math.round(t.km) + ' KM', 110, 'right'], [INTEL_NAMES[t.intel] || '', 150, 'right']], () => { fc.selectTarget(t); g.audio.tick(1500, 0.05, 0.04); }, { sel: fc.target && fc.target.key === t.key, colors: [t.mark ? C.green : C.text] }));
                if (!list.length) text(ctx, ops.link() ? 'NO TARGETS — MARK ONE (COMMA / THE MAP / THE PERISCOPE) OR DESIGNATE A SONAR CONTACT' : 'NO DATA LINK — RAISE THE COMMS OR SATCOM MAST AT PERISCOPE DEPTH', W / 2, y0 + 120, 15, C.amber, 700, 'center', W - 40);
                if (fc.target) text(ctx, 'SELECTED: ' + fc.target.label + ' · ' + (fc.target.kind === 'sea' ? 'SEA' : 'LAND') + ' TARGET', 20, H - 24, 16, C.green, 700, 'left', W - 40);
            },
        },
        screen_fc_wpn: {
            fps: 3, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const fc = ops.fc, L = ops.launcher;
                const y0 = page(ctx, W, H, 'COMBAT CONTROL — WEAPONS', 'VPT / VPM', clockZ(g));
                Object.entries(SUB_WEAPONS).forEach(([k, w], i) => ui.button(20 + i * 500, y0 + 16, 480, 80, w.short + '  ×' + (L ? L.stock[k] || 0 : 0), () => { const r = fc.selectWeapon(k); if (r !== true) g.addFeed(r, '#ffc23f'); }, { on: fc.weapon === k, sub: w.name + ' · VS ' + w.vs.toUpperCase(), size: 24 }));
                text(ctx, 'PAYLOAD TUBES', 20, y0 + 124, 16, C.dim, 700);
                (ops.tubes || []).forEach((t, i) => {
                    const x = 20 + (i % 3) * 330, y = y0 + 140 + Math.floor(i / 3) * 120;
                    ui.button(x, y, 316, 108, t.label + (t.k > 0.5 ? ' · OPEN' : ''), () => { const r = fc.selectTube(i); if (r !== true) g.addFeed(r, '#ffc23f'); }, { on: fc.tube === i, sub: t.loaded + ' LOADED' + (i === fc.tube && fc.spin > 0 ? ' · SPIN ' + Math.round(fc.spin * 100) + '%' : ''), size: 22, disabled: t.loaded <= 0 });
                });
                text(ctx, 'VPT: VIRGINIA PAYLOAD TUBES (BOW, 6 CELLS) · VPM: VIRGINIA PAYLOAD MODULE (7 CELLS)', 20, H - 22, 13, C.dim, 600, 'left', W - 40);
            },
        },
        screen_fc_launch: {
            fps: 5, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const fc = ops.fc;
                const y0 = page(ctx, W, H, 'LAUNCHER CONTROL — ' + SUB_WEAPONS[fc.weapon].short, fc.target ? fc.target.label : 'NO TARGET', clockZ(g), fc.canFire ? C.red : C.cyan);
                const steps = fc.steps();
                const first = steps.findIndex(x => !x.done);
                steps.forEach((st, i) => check(ctx, 16, y0 + 18 + i * 29, 660, st, i === first));
                ui.button(700, y0 + 10, 300, 60, 'SPIN UP', () => { const r = fc.spinUp(); if (r !== true) g.addFeed(r, '#ffc23f'); }, { on: fc.spin >= 1, sub: fc.spinning ? Math.round(fc.spin * 100) + '%' : '', size: 20 });
                ui.button(700, y0 + 80, 300, 60, 'FIRING POINT PROC.', () => { fc.orderFpp(); }, { on: fc.fpp, size: 17 });
                ui.button(700, y0 + 150, 300, 60, 'OPEN MUZZLE HATCH', () => { const r = fc.openMuzzle(); if (r !== true) g.addFeed(r, '#ffc23f'); }, { on: fc.hatchOpen, size: 17 });
                ui.button(700, y0 + 220, 300, 60, 'ABORT', () => fc.abort(), { size: 20 });
                ui.button(700, y0 + 290, 300, 64, fc.canFire ? 'FIRE — THE RED BUTTON' : 'NOT READY', null, { danger: fc.canFire, disabled: !fc.canFire, size: 16 });
                const log = fc.log.slice(-3);
                log.forEach((l, i) => text(ctx, l.text, 20, H - 70 + i * 22, 14, i === log.length - 1 ? C.green : C.dim, 600, 'left', W - 40));
            },
        },
        // ── navigation ──
        screen_nav: { fps: 2, wheel: (d) => { ops.navZoom = clamp((ops.navZoom || 0.01) * (d > 0 ? 0.8 : 1.25), 0.0008, 0.08); }, draw: (ctx, ui, s) => drawTactical(ctx, s, ops, mv(s), 'NAVIGATION PLOT', ops.navZoom || 0.01, ui) },
        screen_nddd: {
            fps: 2, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                if (dead(ctx, W, H)) return;
                const c = ops.ctl, P = ops.sub.mesh.position;
                const y0 = page(ctx, W, H, 'NAVIGATION DATA', 'NDDD', clockZ(g));
                readout(ctx, 20, y0 + 10, 480, 96, 'POSITION', g.war.grid(P.x, P.z), C.green);
                readout(ctx, 520, y0 + 10, 480, 96, 'SEA DEPTH', Math.round(c.floor / FT) + '', C.white, 'FT');
                readout(ctx, 20, y0 + 124, 310, 96, 'COURSE', String(Math.round(hdgDeg(ops.heading))).padStart(3, '0'), C.white, '°T');
                readout(ctx, 350, y0 + 124, 310, 96, 'SPEED', (c.speed * KT).toFixed(1), C.white, 'KT');
                readout(ctx, 680, y0 + 124, 320, 96, 'KEEL', Math.round(c.keelFt) + '', C.white, 'FT');
                const home = BASES[0];
                const br = g.war.bearingRange(P, home);
                readout(ctx, 20, y0 + 238, 480, 96, 'HOME PLATE', String(br.brg).padStart(3, '0') + '° / ' + br.km.toFixed(1) + ' KM', C.cyan);
                readout(ctx, 520, y0 + 238, 480, 96, 'NAV MODE', c.surfaced ? 'GPS' : ops.ctl.masts.hdr > 0.9 ? 'GPS (MAST)' : 'INERTIAL', C.cyan);
            },
        },
        screen_radar: { fps: 3, draw: (ctx, ui, s) => drawRadarPPI(ctx, s, ops) },
    };
}

// the mast's picture on a console (the render target drawn in, with its overlay)
function drawPhotonics(ctx, ui, s, ops, mast) {
    const g = ops.game, W = s.w, H = s.h;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!ops.alive) { s.setFeed(null); return; }
    const c = ops.ctl, F = ops.feed;
    const up = c.masts[mast] > 0.9;
    if (F && F.live && F.mast === mast && F.texture) {
        // (the render target is pasted in by the screen's material: see subFeedMaterial; here only the overlay)
        s.feed = F;
    } else s.feed = null;
    if (!up || !ops.mastDry(mast)) {
        s.setFeed(null);
        ctx.fillStyle = '#04121a'; ctx.fillRect(0, 0, W, H);
        text(ctx, !up ? 'PHOTONICS ' + mast.slice(-1) + ' — MAST HOUSED' : 'PHOTONICS ' + mast.slice(-1) + ' — MAST UNDER WATER', W / 2, H / 2 - 10, 26, C.amber, 700, 'center');
        ui.button(W / 2 - 150, H / 2 + 30, 300, 60, 'RAISE MAST', () => { const r = c.raiseMast(mast, true); if (r !== true) g.addFeed(r, '#ffc23f'); }, { size: 20, disabled: up });
        return;
    }
    if (ops.feed) ops.feed.mast = mast;
    s.setFeed(s.feed ? s.feed.texture : null);
    if (!s.feed) { // (no render target yet: a horizon so it isn't black)
        const grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#6f8fae'); grd.addColorStop(0.5, '#b8c8d6'); grd.addColorStop(0.5, '#1d3a4c'); grd.addColorStop(1, '#0b1c26');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    } else ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 60, H / 2); ctx.lineTo(W / 2 - 12, H / 2); ctx.moveTo(W / 2 + 12, H / 2); ctx.lineTo(W / 2 + 60, H / 2); ctx.moveTo(W / 2, H / 2 - 40); ctx.lineTo(W / 2, H / 2 - 12); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, 44); ctx.fillRect(0, H - 40, W, 40);
    text(ctx, 'PHOTONICS ' + mast.slice(-1) + ' · BRG ' + String(Math.round(hdgDeg(ops.heading))).padStart(3, '0') + '° · WFOV', 16, 22, 20, '#e8f4ff', 700);
    text(ctx, 'KEEL ' + Math.round(c.keelFt) + ' FT', W - 16, 22, 18, '#e8f4ff', 600, 'right');
    ui.button(W - 190, H - 38, 176, 34, 'FULL SCREEN', () => { if (ops.sys.ctl && ops.sys.ctl.setView) ops.takeView(ops.sys.ctl, mast); }, { size: 15 });
    text(ctx, 'LIVE', 16, H - 20, 16, C.red, 700);
}

// a tactical plot centred on the boat (the tactical map's own drawing, at this screen's size)
function drawTactical(ctx, s, ops, view, title, scale, ui = null) {
    const g = ops.game, W = s.w, H = s.h;
    if (!ops.alive) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    const P = ops.sub.mesh.position;
    view.w = W; view.h = H;
    view.view.cx = P.x; view.view.cz = P.z; view.view.scale = scale;
    view.draw(ctx, {
        own: (c2) => {
            const S = view.toScreen(P.x, P.z);
            // own ship and range rings
            c2.strokeStyle = 'rgba(111,180,255,0.35)'; c2.lineWidth = 1;
            for (const r of [5000, 10000, 20000, 50000]) { c2.beginPath(); c2.arc(S.x, S.y, r * scale, 0, Math.PI * 2); c2.stroke(); }
            c2.save(); c2.translate(S.x, S.y); c2.rotate(-ops.heading);
            c2.fillStyle = '#5dffa0'; c2.beginPath(); c2.moveTo(0, -12); c2.lineTo(7, 10); c2.lineTo(-7, 10); c2.closePath(); c2.fill();
            c2.restore();
            // sonar bearing lines
            c2.strokeStyle = 'rgba(255,210,74,0.5)'; c2.setLineDash([4, 6]);
            for (const k of ops.contacts) { const a = k.brg * Math.PI / 180; c2.beginPath(); c2.moveTo(S.x, S.y); c2.lineTo(S.x + Math.sin(a) * 2000, S.y - Math.cos(a) * 2000); c2.stroke(); }
            c2.setLineDash([]);
        },
    });
    ctx.fillStyle = 'rgba(2,7,11,0.8)'; ctx.fillRect(0, 0, W, 40);
    text(ctx, title + ' · ' + (1 / scale / 1000 * 100).toFixed(1) + ' KM / 100 PX', 14, 20, 18, C.white, 700);
    text(ctx, clockZ(g), W - 14, 20, 16, C.dim, 600, 'right');
    // click the plot: mark a point there
    if (ui) ui.hit(0, 40, W, H - 40, (x, y) => { const w = view.toWorld(x, y); g.war.designate({ x: w.x, z: w.z }, 'console'); }, 'plot', { label: 'CLICK: MARK A POINT HERE · WHEEL: ZOOM' });
}

function drawWaterfall(ctx, s, ops) {
    const g = ops.game, W = s.w, H = s.h;
    if (!ops.alive) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    const y0 = page(ctx, W, H, 'SONAR — BROADBAND WATERFALL', 'TB-29 / SPHERE', clockZ(g));
    const rows = ops.rows || [];
    const x0 = 40, w = W - 60, h = H - y0 - 40;
    const bw = w / 256, rh = h / 240;
    for (let j = 0; j < rows.length; j++) {
        const r = rows[j];
        for (let i = 0; i < 256; i++) {
            const v = r[i];
            if (v < 0.14) continue;
            ctx.fillStyle = 'rgba(' + Math.round(60 * v) + ',' + Math.round(255 * Math.min(1, v * 1.2)) + ',' + Math.round(140 * v) + ',' + Math.min(1, v).toFixed(2) + ')';
            ctx.fillRect(x0 + i * bw, y0 + j * rh, bw + 0.5, rh + 0.5);
        }
    }
    ctx.strokeStyle = C.line; ctx.strokeRect(x0, y0, w, h);
    for (let d = 0; d <= 360; d += 45) { const x = x0 + d / 360 * w; text(ctx, String(d).padStart(3, '0'), x, H - 22, 12, C.dim, 600, 'center'); }
    for (const k of ops.contacts.slice(0, 6)) text(ctx, k.id, x0 + k.brg / 360 * w, y0 + 12, 12, k.team === g.war.side ? C.blue : C.amber, 700, 'center');
}

function drawRadarPPI(ctx, s, ops) {
    const g = ops.game, W = s.w, H = s.h;
    if (!ops.alive) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    const y0 = page(ctx, W, H, 'AN/BPS-16 RADAR', '', clockZ(g));
    const on = ops.ctl.masts.radar > 0.95 && ops.mastDry('radar');
    const cx = W / 2, cy = y0 + (H - y0) / 2, R = Math.min(W, H - y0) / 2 - 20;
    ctx.strokeStyle = 'rgba(93,255,160,0.35)';
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, R * i / 4, 0, Math.PI * 2); ctx.stroke(); }
    if (!on) { text(ctx, 'RADAR MAST HOUSED / WET', cx, cy, 20, C.amber, 700, 'center'); return; }
    const t = g.time, sweep = (t * 1.2) % (Math.PI * 2);
    const grd = ctx.createConicGradient ? ctx.createConicGradient(sweep - Math.PI / 2, cx, cy) : null;
    if (grd) { grd.addColorStop(0, 'rgba(93,255,160,0.35)'); grd.addColorStop(0.15, 'rgba(93,255,160,0)'); grd.addColorStop(1, 'rgba(93,255,160,0)'); ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); }
    const P = ops.sub.mesh.position, range = 30000;
    for (const u of [...g.naval.ships, ...ops.harbor.boats]) {
        if (u === ops.sub || u.gone || u.removed || !u.alive) continue;
        const dx = u.mesh.position.x - P.x, dz = u.mesh.position.z - P.z, d = Math.hypot(dx, dz);
        if (d > range) continue;
        ctx.fillStyle = u.team === g.war.side ? '#6fb4ff' : '#ffd24a';
        ctx.fillRect(cx + dx / range * R - 3, cy + dz / range * R - 3, 6, 6);
    }
    text(ctx, '30 KM', cx + R - 4, cy - 8, 12, C.dim, 600, 'right');
}

// ═════════════ Travel: COMMAND › TRAVEL takes you (on foot) to any of the places above ═════════════
export class TravelOps {
    constructor(sys, ops) { this.sys = sys; this.game = sys.game; this.ops = ops; }
    // can the player go now? on foot, or in a jet stopped on the ground (he climbs out); in the free modes also from
    // the air (the jet is parked back at the home base)
    can() {
        const g = this.game, pm = g.pilotMode, p = g.player;
        if (this.sys.ctl) return 'LEAVE THE ' + (this.sys.ctl.kind === 'boat' ? 'BOAT' : 'ROOM') + ' FIRST';
        if (pm) return pm.walker && pm.alive ? true : 'LAND FIRST';
        if (!p || !p.alive) return 'NOT NOW';
        if (p.onGround && (p.deck ? p.relSpeed : p.speed) < 1) return true;
        if (['freeflight', 'sandbox', 'war'].includes(g.mode)) return true;
        return 'LAND AND STOP FIRST';
    }
    places() {
        const o = this.ops, out = [];
        const H = o.harbor.harbor;
        if (H) out.push({ label: 'SMALL CRAFT PIER (BOATS)', at: () => { const w = H.toWorld(0, 30, new THREE.Vector3()); w.y = H.deckY; return { pos: w, yaw: H.yaw + Math.PI }; } });
        if (o.sub) out.push({ label: 'USS COLORADO — ON DECK', ok: () => o.sub.alive && o.sub.ctl && o.sub.ctl.surfaced, at: () => ({ pos: o.sub.entryPos(new THREE.Vector3()), yaw: o.sub.sub.heading }) });
        if (o.carrier) out.push({ label: 'CARRIER FLIGHT DECK (THE ISLAND)', ok: () => !!o.carrier.cv(), at: () => o.carrier.deckSpot() });
        if (o.joc) out.push({ label: 'JOINT OPERATIONS CENTER', ok: () => !!o.joc.entry, at: () => o.joc.entrySpot() });
        if (o.tel) out.push({ label: 'TEL (CAPTURED SCUD) COMPOUND', ok: () => !!(o.tel.tel && o.tel.tel.alive), at: () => o.tel.spot() });
        return out;
    }
    commands() {
        if (!this.sys.enabled) return [];
        const can = this.can();
        return this.places().map(d => {
            const ok = !d.ok || d.ok();
            return { path: ['TRAVEL'], label: d.label, hint: can !== true ? can : ok ? 'ON FOOT' : 'NOT AVAILABLE', enabled: can === true && ok, run: () => this.go(d) };
        });
    }
    go(d) {
        const g = this.game, sys = this.sys;
        sys.fadeTo(() => {
            if (!g.pilotMode) {
                const p = g.player;
                if (!(p.onGround && (p.deck ? p.relSpeed : p.speed) < 1)) {
                    // from the air (free modes): the jet waits, parked on the home base's apron
                    const old = p; old.remove && old.remove();
                    const i = g.aircraft.indexOf(old); if (i >= 0) g.aircraft.splice(i, 1);
                    g.spawnPlayer('apron');
                }
                g.player.controls.throttle = g.player.throttle = 0;
                g.climbOut();
            }
            const to = d.at();
            sys.placePilot(to.pos, to.yaw);
        }, { text: d.label });
    }
}

