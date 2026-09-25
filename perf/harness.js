// Dev-only frame profiler for SKYWAR (not loaded by the game).
// Serve with `PORT=8122 node perf/server.mjs` (adds the header the JS Self-Profiling API needs; BASE=<dir> also
// serves an older copy of the game under /base/ for A/B runs). Open /perf/ctl.html and click the button: the game
// opens in a popup window (a popup keeps its own visibility, so it isn't throttled behind other tabs). Then, from
// that page's console:
//   const P = await pop.eval("import('/perf/harness.js')");
//   P.boot('free'); P.install(true); P.bench('free')          // scenes: 'free' | 'city' | 'naval'
//   P.drawsExact(30, 2); await P.fast(300, 20); await P.profile(600)
// Frames are stepped with window.skywarStep(1) + gl.finish(), so a frame's time includes the GPU.
import * as THREE from 'three';
import { terrainHeight } from '../src/world.js';
const S = () => window.skywar;

// Exact main-pass draws per owner (top-level scene child) over one frame, via onBeforeRender / onBeforeShadow
export function drawsExact(top = 30, depth = 1) {
    const s = S(), sc = s.world.scene, w = s.world;
    const owners = ownerMap();
    const tileMeshes = new Set([...w.tiles.values()].map(t => t.mesh));
    const counts = new Map();
    const key = (o, pass) => {
        let top = o, chain = [];
        while (top.parent && top.parent !== sc) { chain.push(top); top = top.parent; }
        if (top.parent !== sc) return pass + ' (not in scene)';
        let k = tileMeshes.has(top) ? 'terrain' : owners.get(top) || (top.name || top.type);
        const sub = chain.reverse().slice(0, depth - 1).map(x => x.name || x.type + (x.material ? ':' + x.material.type : ''));
        return pass + ' ' + k + (sub.length ? ' > ' + sub.join(' > ') : '') + (o.material && o.material.transparent ? ' [T' + (o.material.side === 2 ? 'x2' : '') + ']' : '');
    };
    const O = THREE.Object3D.prototype;
    const ob = O.onBeforeRender, os = O.onBeforeShadow;
    O.onBeforeRender = function () { const k = key(this, 'main'); counts.set(k, (counts.get(k) || 0) + 1); };
    O.onBeforeShadow = function () { const k = key(this, 'shadow'); counts.set(k, (counts.get(k) || 0) + 1); };
    try { window.skywarStep(1); } finally { O.onBeforeRender = ob; O.onBeforeShadow = os; }
    const rows = [...counts].sort((a, b) => b[1] - a[1]);
    let tm = 0, ts = 0;
    for (const [k, v] of rows) if (k.startsWith('main')) tm += v; else ts += v;
    return 'main ' + tm + ' shadow ' + ts + '\n' + rows.slice(0, top).map(([k, v]) => v + ' ' + k).join('\n');
}

// objects that three.js visits in updateMatrixWorld every frame (matrixWorldAutoUpdate chains), per owner
export function autoStats(top = 30) {
    const s = S(), sc = s.world.scene, owners = ownerMap();
    const counts = new Map();
    for (const c of sc.children) {
        const k = owners.get(c) || (c.name || c.type);
        const e = counts.get(k) || { n: 0, visited: 0, recompose: 0, hiddenVisited: 0 };
        e.n++;
        // updateMatrixWorld recurses into children whose matrixWorldAutoUpdate is true (visibility doesn't matter)
        const walk = (o, vis) => {
            if (!o.matrixWorldAutoUpdate) return;
            e.visited++;
            if (!vis) e.hiddenVisited++;
            if (o.matrixAutoUpdate) e.recompose++;
            for (const ch of o.children) walk(ch, vis && ch.visible);
        };
        walk(c, c.visible);
        counts.set(k, e);
    }
    return [...counts].sort((a, b) => b[1].visited - a[1].visited).slice(0, top).map(([k, e]) => `${k} x${e.n}: visited ${e.visited} (hidden ${e.hiddenVisited}) recompose ${e.recompose}`).join('\n');
}

// main-pass draws under one object (e.g. towns.group), grouped by material + geometry kind
export function drawsUnder(root, top = 40) {
    const counts = new Map();
    const inside = (o) => { for (let q = o; q; q = q.parent) if (q === root) return true; return false; };
    const O = THREE.Object3D.prototype, ob = O.onBeforeRender;
    const matIds = new Map();
    O.onBeforeRender = function () {
        if (!inside(this)) return;
        const m = this.material, g = this.geometry;
        if (!matIds.has(m)) matIds.set(m, matIds.size);
        const k = `${this.isInstancedMesh ? 'IM' : this.type} mat#${matIds.get(m)}:${m.type}${m.map ? '+map' : ''}${m.color ? ' #' + m.color.getHexString() : ''}${m.transparent ? ' T' : ''}${m.name ? ' "' + m.name + '"' : ''} parent:${this.parent === root ? 'root' : this.parent.type}`;
        const e = counts.get(k) || { n: 0, cast: 0, v: 0, inst: 0, geos: new Set() };
        e.n++; if (this.castShadow) e.cast++;
        e.geos.add(g); e.v += g.attributes.position.count; if (this.isInstancedMesh) e.inst += this.count;
        counts.set(k, e);
    };
    try { window.skywarStep(1); } finally { O.onBeforeRender = ob; }
    let tot = 0; for (const [, e] of counts) tot += e.n;
    return 'total ' + tot + '\n' + [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, top).map(([k, e]) => e.n + ' (cast ' + e.cast + ', geos ' + e.geos.size + ', verts ' + e.v + (e.inst ? ', inst ' + e.inst : '') + ') ' + k).join('\n');
}

function ownerMap() {
    const s = S(), w = s.world, g0 = s.game;
    const owners = new Map();
    const tag = (o, t) => { if (o && !owners.has(o)) owners.set(o, t); };
    tag(w.skyDome, 'sky'); tag(w.water, 'water'); tag(w.stars, 'stars'); tag(w.grass, 'grass'); tag(w.rain, 'rain');
    for (const t of w.tiles.values()) { tag(t.mesh, 'terrain'); tag(t.trees, 'forest'); }
    for (const [nm, sys] of [['towns', w.towns], ['airbases', w.airbases], ['airTraffic', w.airTraffic], ['naval', g0.naval], ['ground', g0.ground], ['effects', g0.effects], ['weapons', g0.weapons], ['wreckage', g0.wreckage], ['traffic', w.towns && w.towns.traffic], ['buildings', w.towns && w.towns.buildings], ['clouds', w.clouds], ['world', w]]) {
        if (!sys) continue;
        for (const k of Object.keys(sys)) {
            const v = sys[k];
            if (v && v.isObject3D) tag(v, nm + '.' + k);
            else if (Array.isArray(v)) v.forEach((x) => { if (x && x.isObject3D) tag(x, nm + '.' + k + '[]'); else if (x && typeof x === 'object') for (const k2 of ['mesh', 'group', 'root', 'model', 'obj']) if (x[k2] && x[k2].isObject3D) tag(x[k2], nm + '.' + k + '[].' + k2); });
        }
    }
    for (const a of g0.aircraft) { tag(a.root, a.isPlayer ? 'player' : 'aircraft'); tag(a.model, a.isPlayer ? 'player' : 'aircraft'); }
    return owners;
}

// Who draws: per top-level scene child, objects traversed, visible meshes, meshes inside the camera frustum
// (main-pass draws), shadow casters inside each shadow camera
export function draws(top = 30, split = false) {
    const s = S(), sc = s.world.scene, cam = s.camera, w = s.world;
    const fr = new THREE.Frustum(), m = new THREE.Matrix4();
    cam.updateMatrixWorld(); m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(m, THREE.WebGLCoordinateSystem, s.renderer.reversedDepthBuffer);
    const sf = [w.sun, w.sunFar].map(l => { const f = new THREE.Frustum(); l.shadow.camera.updateMatrixWorld(); const mm = new THREE.Matrix4().multiplyMatrices(l.shadow.camera.projectionMatrix, l.shadow.camera.matrixWorldInverse); f.setFromProjectionMatrix(mm); return f; });
    const groups = new Map();
    const tileMeshes = new Set([...w.tiles.values()].map(t => t.mesh));
    const treeGroups = new Set([...w.tiles.values()].map(t => t.trees).filter(Boolean));
    const label = (o) => tileMeshes.has(o) ? 'terrain tiles' : treeGroups.has(o) ? 'forest trees' : (o.name || o.type) + (o.userData && o.userData.owner ? ':' + o.userData.owner : '') + '/' + (o.children.length ? o.children[0].name || o.children[0].type : (o.material && o.material.type) || '');
    const sphere = new THREE.Sphere();
    const inF = (o, f) => {
        if (!o.frustumCulled) return true;
        if (o.isSprite) { sphere.center.set(0, 0, 0).applyMatrix4(o.matrixWorld); sphere.radius = 0.7071 * o.scale.x; return f.intersectsSphere(sphere); }
        return f.intersectsObject(o);
    };
    const owners = new Map();
    const tag = (o, t) => { if (o) owners.set(o, t); };
    const g0 = s.game;
    if (w.towns) { for (const k of Object.keys(w.towns)) { const v = w.towns[k]; if (v && v.isObject3D) tag(v, 'towns.' + k); else if (v && typeof v === 'object' && !Array.isArray(v)) for (const k2 of Object.keys(v)) if (v[k2] && v[k2].isObject3D) tag(v[k2], 'towns.' + k + '.' + k2); } }
    for (const [nm, sys] of [['airbases', w.airbases], ['airTraffic', w.airTraffic], ['naval', g0.naval], ['ground', g0.ground], ['effects', g0.effects], ['weapons', g0.weapons], ['traffic', w.towns && w.towns.traffic], ['buildings', w.towns && w.towns.buildings], ['clouds', w.clouds]]) {
        if (!sys) continue;
        for (const k of Object.keys(sys)) { const v = sys[k]; if (v && v.isObject3D) tag(v, nm + '.' + k); else if (Array.isArray(v)) v.forEach((x, i) => { if (x && x.isObject3D) tag(x, nm + '.' + k + '[]'); else if (x && x.mesh && x.mesh.isObject3D) tag(x.mesh, nm + '.' + k + '[].mesh'); else if (x && x.group && x.group.isObject3D) tag(x.group, nm + '.' + k + '[].group'); }); }
    }
    for (const a of g0.aircraft) tag(a.root || a.model, a.isPlayer ? 'player' : 'aircraft');
    for (const c of sc.children) {
        const k = owners.get(c) || (split ? label(c) + '@' + Math.round(c.position.x) + ',' + Math.round(c.position.z) : label(c));
        const g = groups.get(k) || { n: 0, objs: 0, vis: 0, drawn: 0, castNear: 0, castFar: 0 };
        g.n++;
        c.traverse(o => { g.objs++; });
        c.traverseVisible(o => {
            if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
            g.vis++;
            if (inF(o, fr)) g.drawn++;
            if (o.castShadow && o.isMesh) { if (inF(o, sf[0])) g.castNear++; if (w.sunFar.castShadow && inF(o, sf[1])) g.castFar++; }
        });
        groups.set(k, g);
    }
    const rows = [...groups].sort((a, b) => b[1].drawn - a[1].drawn).slice(0, top);
    const tot = { objs: 0, vis: 0, drawn: 0, castNear: 0, castFar: 0 };
    for (const [, g] of groups) for (const k in tot) tot[k] += g[k];
    return 'label | groups | objs | visMeshes | drawn | castNear | castFar\n' + rows.map(([k, g]) => [k, g.n, g.objs, g.vis, g.drawn, g.castNear, g.castFar].join(' | ')).join('\n') + '\nTOTAL ' + JSON.stringify(tot);
}
const acc = {};      // label -> ms this frame
const hist = {};     // label -> [ms per frame]
const cnt = {};      // counters this frame
const chist = {};
let installed = false;
let phase = 'none';

function wrap(obj, name, label) {
    if (!obj || typeof obj[name] !== 'function') return;
    const f = obj[name];
    if (f.__perfOrig) return;
    const nf = function (...a) {
        const t0 = performance.now();
        try { return f.apply(this, a); } finally { acc[label] = (acc[label] || 0) + performance.now() - t0; }
    };
    nf.__perfOrig = f;
    obj[name] = nf;
}

export function install(countGL = false) {
    if (installed) return 'already';
    installed = true;
    const s = S(), g = s.game, w = s.world, r = s.renderer, scene = w.scene;
    wrap(g, 'update', 'game.update');
    wrap(g, 'updatePlayer', ' player');
    wrap(g, 'updateTargeting', ' targeting');
    wrap(g, 'worldCollisions', ' worldCollisions');
    wrap(g, 'updateSeats', ' seats');
    wrap(g, 'updateMode', ' mode');
    wrap(g, 'updateCamera', ' camera');
    wrap(g.weapons, 'update', ' weapons');
    wrap(g.wreckage, 'update', ' wreckage');
    wrap(g.ground, 'update', ' ground');
    wrap(g.naval, 'update', ' naval');
    wrap(g.effects, 'update', ' effects');
    wrap(g.audio, 'update', ' audio');
    wrap(g.cockpit, 'update', ' cockpit');
    wrap(s.Pilot.prototype, 'update', ' ai.pilots');
    if (w.towns) { wrap(w.towns, 'update', ' towns'); wrap(w.towns.traffic, 'update', ' traffic'); }
    if (w.airbases) wrap(w.airbases, 'update', ' airbases');
    if (w.airTraffic) wrap(w.airTraffic, 'update', ' airTraffic');
    wrap(w, 'update', ' world.update');
    wrap(w, 'updateWeather', ' world.weather');
    wrap(w.clouds, 'update', '   clouds');
    wrap(w, 'updateGrass', '   grass');
    wrap(w, 'updateTerrain', '   terrain');
    wrap(g.hud, 'draw', 'hud.draw');
    wrap(s.post.postfx, 'render', 'postfx.render');
    wrap(r.shadowMap, 'render', '  shadowMap');
    const sm = r.shadowMap.render;
    r.shadowMap.render = function (...a) { const p = phase; phase = 'shadow'; try { return sm.apply(this, a); } finally { phase = p; } };
    wrap(scene, 'updateMatrixWorld', '  scene.updateMatrixWorld');
    const origRender = r.render.bind(r);
    r.render = function (sc, cam) {
        const t0 = performance.now();
        const k = sc === scene ? ' render(main)' : sc === g.cockpit.scene ? ' render(cockpit)' : ' render(other)';
        const p = phase; phase = k.trim();
        try { return origRender(sc, cam); } finally {
            phase = p;
            acc[k] = (acc[k] || 0) + performance.now() - t0;
            cnt[k + ' n'] = (cnt[k + ' n'] || 0) + 1;
        }
    };
    const aproto = g.player ? Object.getPrototypeOf(g.player) : null;
    if (aproto) wrap(aproto, 'update', ' aircraft');
    if (countGL) installGL();
    return 'installed';
}

// finer timers inside terrain / towns / traffic (for hunting spikes)
export function installDeep() {
    const s = S(), w = s.world, T = w.towns;
    wrap(w, 'finishJob', '    finishJob');
    wrap(w, 'morphFrom', '     morphFrom');
    wrap(w, 'tileGeometry', '     tileGeometry');
    if (T) {
        wrap(T, 'updatePeople', '  towns.people');
        wrap(T, 'recommit', '  towns.recommit');
        if (T.buildings) wrap(T.buildings, 'update', '  towns.buildings');
        wrap(T.traffic, 'lanes', '  traffic.lanes');
        wrap(T.traffic, 'move', '  traffic.move');
        wrap(T.traffic, 'pose', '  traffic.pose');
        wrap(T.traffic.carSet, 'commit', '  traffic.commit');
    }
    return 'deep';
}

let glInstalled = false;
export function installGL() {
    if (glInstalled) return;
    glInstalled = true;
    const gl = S().renderer.getContext();
    for (const fn of Object.getOwnPropertyNames(WebGL2RenderingContext.prototype)) {
        let d;
        try { d = gl[fn]; } catch (e) { continue; }
        if (typeof d !== 'function' || fn === 'constructor' || fn === 'getError') continue;
        const f = d.bind(gl);
        gl[fn] = (...a) => { cnt['gl.total'] = (cnt['gl.total'] || 0) + 1; return f(...a); };
    }
    for (const fn of ['bufferSubData', 'bufferData']) {
        const f = gl[fn].bind(gl);
        gl[fn] = (t, a, b, c, d) => {
            const src = fn === 'bufferSubData' ? b : a;
            const bytes = typeof src === 'number' ? 0 : src ? (d !== undefined ? d * (src.BYTES_PER_ELEMENT || 1) : src.byteLength) : 0;
            cnt['gl.' + fn + ' KB'] = (cnt['gl.' + fn + ' KB'] || 0) + bytes / 1024;
            return f(t, a, b, c, d);
        };
    }
    const fns = [['useProgram', 'gl.useProgram'], ['drawElements', 'gl.draw'], ['drawArrays', 'gl.draw'], ['drawElementsInstanced', 'gl.draw'], ['drawArraysInstanced', 'gl.draw'],
        ['bindTexture', 'gl.bindTexture'], ['bindFramebuffer', 'gl.bindFramebuffer'], ['bufferSubData', 'gl.bufferSubData'], ['bufferData', 'gl.bufferData'], ['texSubImage2D', 'gl.texSubImage2D'], ['texImage2D', 'gl.texImage2D']];
    for (const [fn, key] of fns) {
        const f = gl[fn].bind(gl);
        const perPhase = key === 'gl.draw' || key === 'gl.useProgram';
        gl[fn] = (...a) => { cnt[key] = (cnt[key] || 0) + 1; if (perPhase) { const k2 = key + '@' + phase; cnt[k2] = (cnt[k2] || 0) + 1; } return f(...a); };
    }
    // time spent in the calls that do real work up front (uploads, shader compiles)
    for (const fn of ['texImage2D', 'texSubImage2D', 'texStorage2D', 'bufferData', 'bufferSubData', 'compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'generateMipmap', 'readPixels', 'getError']) {
        const f = gl[fn];
        gl[fn] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { const k = 'glms.' + fn; cnt[k] = (cnt[k] || 0) + performance.now() - t0; } };
    }
    for (const fn of Object.getOwnPropertyNames(WebGL2RenderingContext.prototype).filter(n => n.startsWith('uniform'))) {
        const f = gl[fn].bind(gl);
        gl[fn] = (...a) => { cnt['gl.uniform*'] = (cnt['gl.uniform*'] || 0) + 1; return f(...a); };
    }
    return 'installed';
}

export function reset() { for (const k in hist) delete hist[k]; for (const k in chist) delete chist[k]; }

// the last frame's timings and counters (after step)
let lastSnap = {};
export function lastFrame() {
    const out = {};
    for (const k in lastSnap) if (lastSnap[k] >= 0.3) out[k.trim()] = +lastSnap[k].toFixed(1);
    return out;
}

function flush(total) {
    acc.FRAME = total;
    lastSnap = { ...acc, ...cnt };
    for (const k in acc) { (hist[k] || (hist[k] = [])).push(acc[k]); delete acc[k]; }
    for (const k in cnt) { (chist[k] || (chist[k] = [])).push(cnt[k]); delete cnt[k]; }
}

export function step(n = 1) {
    const gl = S().renderer.getContext();
    for (let i = 0; i < n; i++) {
        for (const k in acc) delete acc[k];
        for (const k in cnt) delete cnt[k];
        const t0 = performance.now();
        window.skywarStep(1);
        gl.finish();
        flush(performance.now() - t0);
    }
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
export function report() {
    const frames = (hist.FRAME || []).length;
    const rows = [];
    for (const k of Object.keys(hist)) {
        const a = hist[k];
        const full = a.concat(new Array(Math.max(0, frames - a.length)).fill(0));
        rows.push([k, q(full, 0.5).toFixed(2), q(full, 0.9).toFixed(2), Math.max(...full).toFixed(2)]);
    }
    const crow = [];
    for (const k of Object.keys(chist)) crow.push([k, q(chist[k], 0.5)]);
    return 'frames ' + frames + ' (label | p50 | p90 | max ms)\n' + rows.map(r => r.join(' | ')).join('\n') + '\n' + crow.map(r => r.join(': ')).join(', ');
}

export function sceneStats() {
    const s = S(), sc = s.world.scene;
    let objs = 0, vis = 0, meshes = 0, visMeshes = 0, autoMW = 0, autoM = 0, cast = 0, inst = 0, lights = 0, frust = 0;
    const stack = [[sc, true]];
    while (stack.length) {
        const [o, pv] = stack.pop();
        objs++;
        const v = pv && o.visible;
        if (v) vis++;
        if (o.matrixWorldAutoUpdate) autoMW++;
        if (o.matrixAutoUpdate) autoM++;
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite) { meshes++; if (v) { visMeshes++; if (o.castShadow) cast++; if (o.isInstancedMesh) inst++; if (o.frustumCulled) frust++; } }
        if (o.isLight) lights++;
        for (const c of o.children) stack.push([c, v]);
    }
    const r = s.renderer;
    return { objs, vis, meshes, visMeshes, visCasters: cast, visInstanced: inst, visFrustumTested: frust, autoMatrixWorld: autoMW, autoMatrix: autoM, lights, programs: r.info.programs.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
}

// start a sortie through the menu's launch button (so the menu showcase jet is removed as in play)
export function boot(kind) {
    const s = S();
    try { localStorage.setItem = () => {}; } catch (e) { /* */ }
    Object.assign(s.settings, { quality: 'high', dynRes: false, start: 'auto', weather: 'clear', time: 'day', wingmen: 1, controlMode: 'keyboard' });
    // a stray real mouse over the window must not steer the jet or swing the camera during a timing run
    const inp = s.game.input;
    if (!inp.__perfMute) { inp.__perfMute = true; inp.consumeMouse = () => ({ dx: 0, dy: 0, wheel: 0 }); inp.freeMouse = false; }
    s.settings.mode = kind === 'naval' ? 'naval' : 'freeflight';
    s.settings.aircraft = kind === 'naval' ? 'fa18' : 'f16';
    if (s.game.state !== 'menu') { s.game.cleanup(); s.game.state = 'menu'; }
    document.getElementById('launchBtn').click();
    s.post.postfx.setQuality('high', s.settings);
    if (kind === 'free' || kind === 'city') place(kind);
    return s.game.player.pos.toArray().map(Math.round);
}

// scenes: put the player somewhere (free flight / naval started beforehand)
export function place(kind) {
    const s = S(), g = s.game, V = g.player.pos.constructor;
    s.settings.dynRes = false;
    s.post.postfx.setQuality('high', s.settings);
    const p = g.player;
    if (kind === 'free') p.spawnAir(new V(2000, 1800, 6000), 0, 0.62);
    else if (kind === 'city') {
        const t = s.world.towns.towns.slice().sort((a, b) => b.radius - a.radius)[0];
        p.spawnAir(new V(t.x, t.h + 350, t.z + t.radius), 0, 0.5);
    }
    g.aimDir.copy(p.vel).normalize();
    g.camQuat.copy(p.quat);
    g.camPos.copy(p.pos);
    s.world.updateTerrain(p.pos, true);
    return p.pos.toArray().map(Math.round);
}

// repeatable scene timing: re-place, warm up, then `runs` x `n` frames; keeps the run with the lowest median
export function bench(kind, runs = 3, n = 60) {
    if (kind === 'naval') { if (S().game.mode !== 'naval') boot('naval'); } else { if (S().game.mode !== 'freeflight') boot(kind); place(kind); }
    step(60);
    let best = null;
    for (let r = 0; r < runs; r++) {
        if (kind !== 'naval') { place(kind); step(20); }
        reset(); step(n);
        const f = hist.FRAME, p50 = q(f, 0.5);
        if (!best || p50 < best.p50) best = { p50, p90: q(f, 0.9), max: Math.max(...f), rep: report() };
    }
    const lines = best.rep.split('\n');
    const pick = (k) => { const l = lines.find(x => x.startsWith(k)); return l ? l.split(' | ')[1] : '-'; };
    return { kind, p50: best.p50.toFixed(2), p90: best.p90.toFixed(2), max: best.max.toFixed(1), game: pick('game.update'), render: pick('postfx.render'), main: pick(' render(main)'), shadow: pick('  shadowMap'), umw: pick('  scene.updateMatrixWorld'), hud: pick('hud.draw'), terrain: pick('   terrain'), traffic: pick(' traffic'), towns: pick(' towns'), naval: pick(' naval'), airbases: pick(' airbases'), gl: lines[lines.length - 1], full: best.rep };
}

export async function measure(n = 60, warm = 30) {
    step(warm);
    reset();
    step(n);
    return report();
}

// Sampled profile (JS Self-Profiling API, needs perf/server.mjs): self and inclusive time per function
// Where a frame's time goes, robust to other tabs loading the GPU: sampled over n frames, the share of samples in
// JavaScript (game + three.js), in native WebGL calls (their CPU cost plus any wait for the GPU process), and idle;
// scaled by the wall time per frame. Returns ms per frame.
export async function cpuSplit(n = 600) {
    if (typeof Profiler === 'undefined') return null;
    const prof = new Profiler({ sampleInterval: 1, maxBufferSize: 200000 });
    const t0 = performance.now();
    step(n);
    const wall = (performance.now() - t0) / n;
    const tr = await prof.stop();
    let js = 0, gl = 0, idle = 0, sim = 0;
    const glNames = new Set(Object.getOwnPropertyNames(WebGL2RenderingContext.prototype));
    for (const s of tr.samples) {
        if (s.stackId == null) { idle++; continue; }
        const f = tr.frames[tr.stacks[s.stackId].frameId];
        if (f.resourceId == null && glNames.has(f.name)) gl++; else js++;
        // inside game.update (the simulation, incl. terrain / clouds bookkeeping)?
        for (let st = tr.stacks[s.stackId]; st; st = st.parentId != null ? tr.stacks[st.parentId] : null) {
            const fr = tr.frames[st.frameId];
            if (fr.name === 'update' && fr.resourceId != null && /game\.js/.test(tr.resources[fr.resourceId])) { sim++; break; }
        }
    }
    const tot = js + gl + idle || 1;
    return { wall: +wall.toFixed(2), js: +(wall * js / tot).toFixed(2), gl: +(wall * gl / tot).toFixed(2), idle: +(wall * idle / tot).toFixed(2), sim: +(wall * sim / tot).toFixed(2), samples: tot };
}

export let lastCallers = '';
export function getCallers() { return lastCallers; }
export async function profile(n = 120, top = 40, fn = null, fnFilter = null) {
    if (typeof Profiler === 'undefined') return 'no Profiler API (serve with perf/server.mjs)';
    const prof = new Profiler({ sampleInterval: 1, maxBufferSize: 200000 });
    if (fn) fn(); else step(n);
    const tr = await prof.stop();
    const name = (fi) => {
        const f = tr.frames[fi];
        const res = f.resourceId != null ? tr.resources[f.resourceId].split('/').pop().replace(/\?.*/, '') : '';
        return (f.name || '(anon)') + ' ' + res + (f.line != null ? ':' + f.line : '');
    };
    const self = {}, incl = {};
    let total = 0;
    for (const s of tr.samples) {
        if (s.stackId == null) { self['(idle/native)'] = (self['(idle/native)'] || 0) + 1; total++; continue; }
        total++;
        let st = tr.stacks[s.stackId], first = true;
        const seen = new Set();
        while (st) {
            const k = name(st.frameId);
            if (first) { self[k] = (self[k] || 0) + 1; first = false; }
            if (!seen.has(k)) { incl[k] = (incl[k] || 0) + 1; seen.add(k); }
            st = st.parentId != null ? tr.stacks[st.parentId] : null;
        }
    }
    // stacks under a given self function (e.g. a native GL call): which JS paths lead to it
    const callers = {};
    for (const s of tr.samples) {
        if (s.stackId == null) continue;
        let st = tr.stacks[s.stackId];
        if (!fnFilter || !name(st.frameId).startsWith(fnFilter)) continue;
        const path = [];
        for (let d = 0; d < 7 && st; d++) { path.push(name(st.frameId).replace(/three\.module\.js/, 'T')); st = st.parentId != null ? tr.stacks[st.parentId] : null; }
        const k = path.join(' < ');
        callers[k] = (callers[k] || 0) + 1;
    }
    lastCallers = Object.entries(callers).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => (100 * v / total).toFixed(1) + '% ' + k).join('\n');
    const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => (100 * v / total).toFixed(1) + '% ' + k).join('\n');
    return 'samples ' + total + '\n--- self ---\n' + fmt(self) + '\n--- inclusive ---\n' + fmt(incl);
}

// programs that failed to compile / link (three.js keeps their diagnostics): '' when all is well
export function shaderErrors() {
    return S().renderer.info.programs.filter(p => p.diagnostics).map(p => p.name + ' ' + p.cacheKey.split(',').pop() + ': ' + ((p.diagnostics.vertexShader.log || '') + (p.diagnostics.fragmentShader.log || '')).slice(0, 160)).join('\n');
}

// a picture from the photo-mode orbit camera around (x, y, z): JPEG data URL of the canvas
export async function shot(x, y, z, yaw = 0.5, pitch = 0.3, dist = 200, frames = 4) {
    const g = S().game, V = g.player.pos.constructor;
    g.photo = { target: new V(x, y, z), yaw, pitch, dist };
    for (let i = 0; i < frames; i++) { step(1); await yieldLoop(); }
    window.skywarStep(1);
    return S().renderer.domElement.toDataURL('image/jpeg', 0.85);
}
export function unshot() { S().game.photo = null; }

// knockout: frame time with `setOff(true)` vs `setOff(false)`, alternating in short runs so load from outside
// hits both alike; returns [p10, p25, p50] ms for on / off and their difference
export function knockout(setOff, rounds = 16, n = 20) {
    const gl = S().renderer.getContext(), res = { on: [], off: [] };
    for (let r = 0; r < rounds; r++) {
        const off = r % 2 === 1;
        setOff(off);
        window.skywarStep(2);
        for (let i = 0; i < n; i++) { const t0 = performance.now(); window.skywarStep(1); gl.finish(); res[off ? 'off' : 'on'].push(performance.now() - t0); }
    }
    setOff(false);
    const ps = [0.1, 0.25, 0.5];
    const on = ps.map(p => q(res.on, p)), off = ps.map(p => q(res.off, p));
    return 'on ' + on.map(x => x.toFixed(2)).join('/') + '  off ' + off.map(x => x.toFixed(2)).join('/') + '  saves ' + on.map((x, i) => (x - off[i]).toFixed(2)).join('/');
}

// yield to the event loop (worker results arrive between frames, as they do between rAF frames)
const yieldLoop = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

// fly fast (m/s) along heading for `secs` of game time at `alt` m, one frame per 1/60 s, yielding between
// frames; frame-time percentiles and the worst frames with their breakdown
export async function fast(speed = 300, secs = 20, heading = 0.6, alt = 600) {
    const s = S(), g = s.game, p = g.player, V = p.pos.constructor;
    const start = new V(p.pos.x, alt, p.pos.z);
    p.spawnAir(start, heading, 1);
    const dir = new V(-Math.sin(heading), 0, -Math.cos(heading));
    g.aimDir.copy(dir);
    reset();
    const frames = [], worst = [];
    for (let i = 0; i < secs * 60; i++) {
        // hold the jet on a straight line at a steady speed so the terrain streams at `speed`
        p.pos.copy(start).addScaledVector(dir, speed * i / 60);
        p.pos.y = Math.max(alt, terrainHeight(p.pos.x, p.pos.z) + 250);
        p.vel.copy(dir).multiplyScalar(speed); p.speed = speed;
        p.qv.setFromAxisAngle(new V(0, 1, 0), heading); p.syncBody && p.syncBody();
        step(1);
        const f = hist.FRAME[hist.FRAME.length - 1];
        frames.push(f);
        if (worst.length < 8 || f > worst[worst.length - 1].f) {
            const snap = {};
            for (const k in hist) if (hist[k].length === hist.FRAME.length && hist[k][hist[k].length - 1] > 0.5) snap[k.trim()] = +hist[k][hist[k].length - 1].toFixed(1);
            worst.push({ f, i, snap }); worst.sort((a, b) => b.f - a.f); worst.length = Math.min(worst.length, 8);
        }
        await yieldLoop();
    }
    return { p50: q(frames, 0.5).toFixed(1), p90: q(frames, 0.9).toFixed(1), p99: q(frames, 0.99).toFixed(1), max: Math.max(...frames).toFixed(1), worst: worst.map(w => w.f.toFixed(1) + ' @' + w.i + ' ' + JSON.stringify(w.snap)).join('\n') };
}
