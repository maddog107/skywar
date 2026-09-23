// ═══════════════════════════════════════════════════════════════
// SKYWAR — bootstrap, render pipeline, menu, main loop
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AIRCRAFT, MODES, DIFFICULTY, TIMES } from './config.js';
import { World, BASES } from './world.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Cockpit } from './cockpit.js';
import { Game, LOADOUT_LABELS } from './game.js';
import { applyLivery, LIVERIES } from './models.js';
import { Aircraft } from './aircraft.js';
import { Pilot } from './ai.js';
import { preloadModels, hasFileModel } from './models.js';
import { clamp, damp } from './util.js';

const $ = (id) => document.getElementById(id);

// ── Settings (persisted) ──
const DEFAULTS = {
    aircraft: 'f16', mode: 'dogfight', difficulty: 'veteran', time: 'day', wingmen: 1,
    controlMode: 'mouseaim', sensitivity: 1, invertPitch: false, quality: 'high', volume: 0.7,
    callouts: true, gEffects: true, defaultCockpit: false,
    start: 'auto', loadout: 'balanced', livery: 'default', fuel: true,
};
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('skywar.settings') || '{}')); } catch (e) { /* ignore */ }
const save = () => { try { localStorage.setItem('skywar.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };
let best = {};
try { best = JSON.parse(localStorage.getItem('skywar.best') || '{}'); } catch (e) { /* ignore */ }

// ── Renderer ──
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 60000);
camera.position.set(0, 800, 0);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const cockpit = new Cockpit(renderer);
const cockpitPass = new RenderPass(cockpit.scene, cockpit.camera);
cockpitPass.clear = false;
cockpitPass.clearDepth = true;
cockpitPass.enabled = false;
composer.addPass(cockpitPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function applyQuality() {
    const q = settings.quality;
    const pr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 1);
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    renderer.shadowMap.enabled = q !== 'low';
    bloom.enabled = q !== 'low';
    if (world) {
        world.VIEW_TILES = q === 'low' ? 6 : q === 'medium' ? 8 : 9;
        world.sun.castShadow = q !== 'low';
    }
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
}

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
}
window.addEventListener('resize', resize);

// ── Systems ──
let world;
const effects = new Effects(scene);
const audio = new Audio();
const input = new Input(renderer.domElement);
const hud = new HUD($('hud'));
let game;

// ── Loading ──
async function boot() {
    $('loadText').textContent = 'GENERATING TERRAIN…';
    await new Promise(r => setTimeout(r, 30));
    world = new World(scene, renderer);
    world.setTime(settings.time);
    world.updateTerrain(new THREE.Vector3(0, 0, 0), true);
    $('loadFill').style.width = '35%';
    $('loadText').textContent = 'LOADING AIRFRAMES…';
    await preloadModels((f) => { $('loadFill').style.width = (35 + f * 60) + '%'; });
    game = new Game({ scene, camera, world, effects, audio, input, hud, cockpit, settings });
    game.onGameOver = showGameOver;
    game.onPause = (on) => $('pause').classList.toggle('show', on);
    game.onHelp = () => openModal('controlsModal');
    game.applyLivery = (ac) => applyLivery(ac.model, settings.livery, ac.type);
    window.skywar = { game, settings, world, effects, cockpit, camera, Pilot, renderer };
    applyQuality();
    audio.setVolume(settings.volume);
    audio.callouts = settings.callouts;
    buildMenu();
    $('loadFill').style.width = '100%';
    // compile shaders before showing the menu (avoids first-frame hitches)
    renderer.compile(scene, camera);
    setTimeout(() => {
        $('loading').classList.remove('show');
        showMenu();
    }, 200);
    requestAnimationFrame(loop);
}

// ═════════════ Menu ═════════════
const COUNTRY = { USA: 'US', RUS: 'RU', CHN: 'CN', EU: 'EU', FRA: 'FR', SWE: 'SE', JPN: 'JP' };
let showcase = null;
let orbit = 0;

function buildMenu() {
    // aircraft list
    const groups = [
        ['FIGHTERS', k => AIRCRAFT[k].category === 'fighter'],
        ['BOMBER', k => AIRCRAFT[k].category === 'bomber'],
        ['CIVIL & TRANSPORT', k => AIRCRAFT[k].category === 'civil'],
    ];
    const list = $('acList');
    list.innerHTML = '';
    for (const [label, f] of groups) {
        const ids = Object.keys(AIRCRAFT).filter(f);
        if (!ids.length) continue;
        const g = document.createElement('div');
        g.className = 'ac-group';
        g.textContent = label;
        list.appendChild(g);
        for (const id of ids) {
            const s = AIRCRAFT[id];
            const el = document.createElement('div');
            el.className = 'ac-item' + (id === settings.aircraft ? ' sel' : '');
            el.dataset.id = id;
            const left = document.createElement('div');
            const n = document.createElement('div'); n.className = 'n'; n.textContent = s.name;
            const r = document.createElement('div'); r.className = 'r'; r.textContent = s.role.toUpperCase();
            left.append(n, r);
            const c = document.createElement('span');
            c.className = 'c' + (hasFileModel(id) ? ' m' : '');
            c.textContent = COUNTRY[s.country] || s.country;
            c.title = hasFileModel(id) ? 'Detailed 3D model' : 'Procedural model';
            el.append(left, c);
            el.addEventListener('click', () => { selectAircraft(id); audio.uiClick(); });
            list.appendChild(el);
        }
    }
    // modes
    const mc = $('modeCards');
    mc.innerHTML = '';
    for (const [k, m] of Object.entries(MODES)) {
        const b = document.createElement('button');
        b.className = 'mode-card' + (k === settings.mode ? ' sel' : '');
        const t = document.createElement('div'); t.className = 't'; t.textContent = m.label;
        const d = document.createElement('div'); d.className = 'd'; d.textContent = m.desc;
        b.append(t, d);
        b.addEventListener('click', () => {
            settings.mode = k; save();
            mc.querySelectorAll('.mode-card').forEach(x => x.classList.toggle('sel', x === b));
            audio.uiClick(); updateBest();
        });
        mc.appendChild(b);
    }
    seg('segDifficulty', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), 'difficulty', updateBest);
    seg('segTime', Object.entries(TIMES).map(([k, v]) => [k, v.label]), 'time', () => world.setTime(settings.time));
    seg('segWingmen', [[0, 'SOLO'], [1, '1'], [2, '2']], 'wingmen');
    seg('segStart', [['auto', 'AUTO'], ['air', 'AIR'], ['runway', 'RWY'], ['apron', 'TAXI'], ['carrier', 'CVN']], 'start');
    seg('segLoadout', Object.entries(LOADOUT_LABELS).map(([k, v]) => [k, v.label.split(' ')[0]]), 'loadout');
    seg('segLivery', Object.entries(LIVERIES).map(([k, v]) => [k, v.label]), 'livery', () => { if (showcase) applyLivery(showcase.model, settings.livery, showcase.type); });
    seg('setFuel', [[true, 'ON'], [false, 'OFF']], 'fuel');
    const controlOpts = [['mouseaim', 'MOUSE-AIM'], ['mousestick', 'MOUSE STICK'], ['keyboard', 'KEYS/PAD']];
    seg('segControls', controlOpts, 'controlMode', syncControlHint);
    // settings modal
    seg('setControls', controlOpts, 'controlMode', syncControlHint);
    seg('setInvert', [[false, 'OFF'], [true, 'ON']], 'invertPitch');
    seg('setQuality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']], 'quality', applyQuality);
    seg('setCallouts', [[true, 'ON'], [false, 'OFF']], 'callouts', () => (audio.callouts = settings.callouts));
    seg('setG', [[true, 'ON'], [false, 'OFF']], 'gEffects');
    seg('setCockpit', [[false, 'OFF'], [true, 'ON']], 'defaultCockpit');
    $('setSens').value = settings.sensitivity;
    $('setSens').oninput = (e) => { settings.sensitivity = +e.target.value; save(); };
    $('setVolume').value = settings.volume;
    $('setVolume').oninput = (e) => { settings.volume = +e.target.value; audio.setVolume(settings.volume); save(); };
    syncControlHint();

    $('launchBtn').onclick = launch;
    $('resumeBtn').onclick = () => game.pause(false);
    $('abortBtn').onclick = () => { $('pause').classList.remove('show'); toMenu(); };
    $('retryBtn').onclick = () => { $('over').classList.remove('show'); launch(); };
    $('menuBtn').onclick = () => { $('over').classList.remove('show'); toMenu(); };
    document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.open)));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.remove('show')));
    buildCredits();
    selectAircraft(settings.aircraft in AIRCRAFT ? settings.aircraft : 'f16');
}

function seg(id, options, key, cb) {
    const el = $(id);
    el.innerHTML = '';
    for (const [val, label] of options) {
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.val = String(val);
        b.classList.toggle('sel', String(settings[key]) === String(val));
        b.addEventListener('click', () => {
            settings[key] = val; save();
            // keep every segmented control bound to the same key in sync
            document.querySelectorAll('.seg').forEach(s => {
                if (s.dataset.key === key) s.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x.dataset.val === String(val)));
            });
            audio.uiClick();
            cb && cb();
        });
        el.appendChild(b);
    }
    el.dataset.key = key;
}

function syncControlHint() {
    const h = {
        mouseaim: 'MOUSE-AIM: move the mouse to where you want to go and the jet flies there (War Thunder style). Keyboard overrides at any time.',
        mousestick: 'MOUSE STICK (GeoFS style): the mouse position relative to screen centre is the control stick. Keep it near the centre for level flight.',
        keyboard: 'KEYS/PAD: fly with W/S/A/D/Q/E or a gamepad. Mouse moves the camera to look around.',
    };
    $('controlHint').textContent = h[settings.controlMode];
}

function openModal(id) { $(id).classList.add('show'); audio.uiClick(); }

function statBars(s) {
    const f = s.flight;
    const rows = [
        ['TOP SPEED', f.speed / 540],
        ['AGILITY', (f.roll / 5) * 0.5 + (f.gLimit / 9.5) * 0.3 + (f.alpha / 40) * 0.2],
        ['ACCEL', f.accel / 16],
        ['ARMOUR', s.health / 260],
        ['FIREPOWER', ((s.gun ? s.gun.damage * s.gun.rate : 0) / 572) * 0.6 + (s.missiles / 12) * 0.4],
    ];
    return rows.map(([n, v]) => {
        const pct = Math.round(clamp(v, 0.03, 1) * 100);
        return `<div class="stat"><span>${n}</span><div class="bar"><i style="width:${pct}%"></i></div><span class="v">${pct}</span></div>`;
    }).join('');
}

function selectAircraft(id) {
    settings.aircraft = id; save();
    document.querySelectorAll('.ac-item').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    const s = AIRCRAFT[id];
    const d = $('acDetail');
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    d.innerHTML = `
        <div class="name">${esc(s.name)}</div>
        <div class="role">${esc(s.role.toUpperCase())} · ${esc(s.country)}</div>
        <div class="desc">${esc(s.desc)}</div>
        ${statBars(s)}
        <div class="spec-line">LENGTH <b>${s.length} m</b> · SPAN <b>${s.span} m</b> · G-LIMIT <b>${s.flight.gLimit}</b><br>
        GUN <b>${s.gun ? esc(s.gun.name) : 'NONE'}</b> · MISSILES <b>${s.missiles}</b> · FLARES <b>${s.flares}</b></div>`;
    spawnShowcase(id);
    updateBest();
}

function updateBest() {
    const k = settings.mode + ':' + settings.difficulty;
    const b = best[k];
    $('best').textContent = b ? `BEST ${MODES[settings.mode].label} (${DIFFICULTY[settings.difficulty].label}): ${b.score} PTS · ${b.kills} KILLS` : '';
}

function spawnShowcase(id) {
    if (showcase) showcase.remove();
    showcase = new Aircraft(game, id, { team: 'blue' });
    applyLivery(showcase.model, settings.livery, id);
    resetShowcase();
}
function resetShowcase() {
    // cruise along the coast near home base
    showcase.spawnAir(new THREE.Vector3(1500, 900, 2500), 0.9, 0.55);
    showcase.throttle = showcase.controls.throttle = 0.7;
    showcase.flightT = 0;
}

function showMenu() {
    game.state = 'menu';
    $('menu').classList.add('show');
    input.unlock();
}

function toMenu() {
    game.cleanup();
    game.state = 'menu';
    cockpitPass.enabled = false;
    cockpit.enabled = false;
    spawnShowcase(settings.aircraft);
    $('menu').classList.add('show');
    $('clickToFly').classList.remove('show');
    input.unlock();
}

function launch() {
    audio.init();
    audio.uiConfirm();
    if (showcase) { showcase.remove(); showcase = null; }
    world.setTime(settings.time);
    $('menu').classList.remove('show');
    game.start({ mode: settings.mode, aircraft: settings.aircraft });
    // compile every material now so ships, targets and explosions don't hitch on first sight
    try {
        game.effects.explosion(new THREE.Vector3(0, -500, 0), 0.1);
        renderer.compile(scene, camera);
        cockpit.rifle.visible = true;
        renderer.compile(cockpit.scene, cockpit.camera);
        cockpit.rifle.visible = false;
    } catch (e) { /* non-fatal */ }
}

function showGameOver(r) {
    const k = r.mode + ':' + settings.difficulty;
    const prev = best[k];
    const isBest = !prev || r.score > prev.score;
    if (isBest && r.score > 0) {
        best[k] = { score: r.score, kills: r.kills };
        try { localStorage.setItem('skywar.best', JSON.stringify(best)); } catch (e) { /* ignore */ }
    }
    $('overTitle').textContent = r.victory ? 'MISSION COMPLETE' : 'SHOT DOWN';
    $('overTitle').className = 'card-title ' + (r.victory ? 'win' : 'lose');
    $('overSub').textContent = MODES[r.mode].label + ' · ' + AIRCRAFT[r.aircraft].name.toUpperCase() + ' · ' + DIFFICULTY[settings.difficulty].label;
    const stats = [
        ['SCORE', r.score], ['KILLS', r.kills], [r.mode === 'strike' ? 'GROUND KILLS' : 'WAVE', r.mode === 'strike' ? r.groundKills : r.wave],
        ['TIME', r.time], ['GUN ACCURACY', r.accuracy + '%'], ['MISSILE HITS', r.missileHits + ' / ' + r.missiles],
    ];
    $('overStats').innerHTML = stats.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('');
    $('overBest').textContent = isBest && r.score > 0 ? '★ NEW PERSONAL BEST' : prev ? 'BEST: ' + prev.score : '';
    $('overBest').style.color = isBest ? 'var(--accent)' : 'var(--dim)';
    $('over').classList.add('show');
}

function buildCredits() {
    const rows = [
        ['F-16C Falcon', 'Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f16-c-falcon-4bc2ff75dc584af2afd0aa6bd8b79015'],
        ['Mitsubishi F-2', 'bohmerang', 'CC BY 4.0', 'https://sketchfab.com/3d-models/mitsubishi-f-2-fighter-jet-free-d3d7244554974f499b106e6c11fe3aaf'],
        ['F-14, F-15, F-4, F-5, Typhoon, Rafale, Mirage III, Jaguar', 'Captain_Ahab_62', 'CC0', 'https://opengameart.org/content/fighter-jets'],
        ['J-20, MiG-29, MiG-21, MiG-25, J-10, J-8', 'Captain_Ahab_62', 'CC0', 'https://opengameart.org/content/adversary-aircraft'],
        ['Su-57, Su-47, B-2', 'Addmix (godot_aerodynamic_physics)', 'MIT', 'https://github.com/addmix/godot_aerodynamic_physics'],
        ['Jet (F-35 stand-in)', 'jeremy', 'CC BY 3.0', 'https://poly.pizza/m/6fyLMORhgGK'],
        ['Jumbo Jet', 'NuclearOsmosis', 'CC0', 'https://opengameart.org/content/jumbo-jetwide-body'],
        ['Airplane (C-130 stand-in)', 'Remy Tauziac', 'CC BY 3.0', 'https://poly.pizza/m/bjlICuVX1Sg'],
    ];
    const body = $('creditsBody');
    body.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = '3D aircraft models (see models/CREDITS.md):';
    body.appendChild(p);
    for (const [what, who, lic, url] of rows) {
        const d = document.createElement('div');
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = what;
        d.append(a, document.createTextNode(' — ' + who + ' — ' + lic));
        body.appendChild(d);
    }
    const t = document.createElement('p');
    t.style.marginTop = '10px';
    t.textContent = 'Engine: three.js. All other models, terrain, effects, cockpit, and audio are procedurally generated.';
    body.appendChild(t);
}

// ═════════════ Loop ═════════════
const clock = new THREE.Clock();
function loop() {
    requestAnimationFrame(loop);
    frame(Math.min(clock.getDelta(), 0.05));
}
// debug/test hook: advance the simulation manually (works in background tabs)
window.skywarStep = (n = 60, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); };
function frame(dt) {
    if (game.state === 'menu') updateMenuScene(dt);
    else game.update(dt);

    cockpitPass.enabled = cockpit.enabled && game.state !== 'menu' && ((game.player && game.player.alive) || !!game.pilotMode);
    $('clickToFly').classList.toggle('show', game.state === 'playing' && settings.controlMode !== 'mousestick' && !input.locked);
    composer.render(dt);
    hud.draw(game, dt);
}

function updateMenuScene(dt) {
    game.time += dt;
    if (showcase) {
        showcase.flightT += dt;
        const c = showcase.controls;
        // gentle banking S-turns
        c.roll = Math.sin(showcase.flightT * 0.25) * 0.08 - (showcase.getRight(new THREE.Vector3()).y) * -0.8;
        c.pitch = clamp((900 - showcase.pos.y) / 800, -0.2, 0.3) + 0.02;
        c.throttle = 0.7; c.yaw = 0;
        showcase.update(dt);
        if (showcase.exploded || showcase.flightT > 50) resetShowcase();
        orbit += dt * 0.12;
        const L = Math.max(showcase.spec.length, 12);
        const r = L * 1.9 + 8;
        const target = showcase.pos;
        const desired = new THREE.Vector3(Math.cos(orbit) * r, L * 0.35, Math.sin(orbit) * r).add(target);
        camera.position.copy(desired);
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
        camera.fov = damp(camera.fov, 45, 3, dt);
        camera.updateProjectionMatrix();
        world.update(dt, camera, target, game.wind);
        effects.update(dt, camera, scene.fog, () => 0);
    }
}

boot().catch(e => {
    console.error(e);
    $('loadText').textContent = 'ERROR: ' + e.message;
});
void BASES;
