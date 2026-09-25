// ═══════════════════════════════════════════════════════════════
// SKYWAR — bootstrap, render pipeline, menu, main loop
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { PostFX, ScenePass } from './postfx.js'; // [postfx] AO, water SSR, motion blur, DOF, flare, FXAA, adaptive resolution
import { AIRCRAFT, MODES, DIFFICULTY, TIMES } from './config.js';
import { World, BASES, terrainHeight } from './world.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Cockpit } from './cockpit.js';
import { Game, LOADOUT_LABELS } from './game.js';
import { applyLivery, LIVERIES } from './models.js';
import { MISSIONS, dailyMission } from './missions.js';
import { Career, RANKS, MEDALS } from './career.js';
import { Music } from './music.js';
import { Towns } from './towns.js';
import { Airbases } from './airbase.js';
import { AirTraffic } from './airtraffic.js';
import { preloadProps } from './props.js';
import { preloadCharacter } from './character.js';
import { preloadShips } from './naval.js';
import { setupTouch, isTouchDevice } from './touch.js';
import { Aircraft, refSpeeds } from './aircraft.js';
import { Pilot } from './ai.js';
import { preloadModels, hasFileModel } from './models.js';
import { clamp, damp, DEPTH } from './util.js';

const $ = (id) => document.getElementById(id);

// ── Settings (persisted) ──
const DEFAULTS = {
    aircraft: 'f16', mode: 'dogfight', difficulty: 'veteran', time: 'day', wingmen: 1,
    controlMode: 'mouseaim', sensitivity: 1, stickResponse: 1, invertPitch: false, quality: 'high', volume: 0.7,
    callouts: true, gEffects: true, defaultCockpit: false, motionBlur: true, dynRes: true,
    start: 'auto', loadout: 'balanced', livery: 'default', fuel: true, weather: 'clear', unlockAll: false, music: 0.5,
};
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('skywar.settings') || '{}')); } catch (e) { /* ignore */ }
const save = () => { try { localStorage.setItem('skywar.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };
let best = {};
try { best = JSON.parse(localStorage.getItem('skywar.best') || '{}'); } catch (e) { /* ignore */ }

// ── Renderer ──
// reversed depth buffer (with a float depth target, below): far better depth precision over a 60 km view,
// so distant coastlines, roads and terrain never z-fight. Falls back quietly if EXT_clip_control is missing.
// [postfx] no MSAA on the canvas: everything is drawn through the composer, so the default framebuffer's
// multisampling only cost bandwidth. Anti-aliasing is MSAA on the scene target (ultra) + FXAA at the end.
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true });
DEPTH.reversed = !!renderer.capabilities.reversedDepthBuffer;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // soft (Vogel disk) since r182; radius set on the sun
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 60000);
camera.position.set(0, 800, 0);

// the scene renders into this target: a 32-bit float depth buffer is what makes reversed-Z pay off
const composerTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(window.innerWidth, window.innerHeight, THREE.FloatType),
});
const composer = new EffectComposer(renderer, composerTarget);
const renderPass = new ScenePass(scene, camera); // [postfx] a RenderPass that can draw into its own (MSAA) target
composer.addPass(renderPass);
const cockpit = new Cockpit(renderer);
const cockpitPass = new RenderPass(cockpit.scene, cockpit.camera);
cockpitPass.clear = false;
cockpitPass.clearDepth = true;
cockpitPass.enabled = false;
composer.addPass(cockpitPass);
// only real emitters (lights, fire, the sun's glint and disc) are bright enough to bloom; sunlit cloud tops stay under it
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.25, 1.1); // tight radius: a wide one hazes the whole night scene
composer.addPass(bloom);
composer.addPass(new OutputPass());
// a light grade on the tone-mapped image: a touch more saturation, a soft S-curve for contrast that doesn't clip
// highlights or crush shadows, and a faint vignette that pulls the eye to the middle of the screen
const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, saturation: { value: 1.1 }, contrast: { value: 0.22 }, vignette: { value: 0.16 }, aspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float saturation, contrast, vignette, aspect; varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
            c.rgb = mix(vec3(l), c.rgb, saturation);
            c.rgb = clamp(c.rgb, 0.0, 1.0);
            c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), contrast);
            vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
            c.rgb *= 1.0 - vignette * smoothstep(0.35, 1.05, length(d));
            gl_FragColor = vec4(c.rgb, c.a);
        }`,
});
composer.addPass(grade);
// [postfx] inserts the scene effects (AO / water reflections / flare, motion blur, photo DOF) before the
// cockpit pass and FXAA at the end; also owns the pixel ratio (adaptive resolution)
const postfx = new PostFX({ renderer, composer, camera, scenePass: renderPass, cockpitPass });

function applyQuality() {
    const q = settings.quality;
    postfx.setQuality(q, settings); // [postfx] pixel ratio (fixed or adaptive), MSAA, AO, SSR, blur, flare
    renderer.shadowMap.enabled = q !== 'low';
    bloom.enabled = q !== 'low';
    if (world) {
        world.VIEW_TILES = q === 'low' ? 6 : q === 'medium' ? 8 : 9;
        world.setQuality(q); // shadow cascades, tree shadows, ground detail, fog edge
    }
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
}

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    grade.uniforms.aspect.value = w / h;
}
grade.uniforms.aspect.value = window.innerWidth / window.innerHeight;
window.addEventListener('resize', resize);

// ── Systems ──
let world;
const effects = new Effects(scene);
const audio = new Audio();
const input = new Input(renderer.domElement);
const touchUI = setupTouch(input);
if (touchUI && !localStorage.getItem('skywar.settings')) settings.controlMode = 'keyboard'; // sticks, not mouse-aim, on touch screens
const hud = new HUD($('hud'));
const career = new Career();
const music = new Music();
music.setVolume(settings.music ?? 0.5);
// the first click anywhere unlocks audio (browser autoplay rules)
window.addEventListener('pointerdown', () => { music.unlock(); }, { once: true });
window.addEventListener('keydown', () => { music.unlock(); }, { once: true });
career.unlockAll = !!settings.unlockAll;
let game;

// ── Loading ──
async function boot() {
    $('loadText').textContent = 'GENERATING TERRAIN…';
    await new Promise(r => setTimeout(r, 30));
    world = new World(scene, renderer);
    world.weather = settings.weather || 'clear';
    world.setTime(settings.time);
    world.updateTerrain(new THREE.Vector3(0, 0, 0), true);
    $('loadText').textContent = 'LOADING AIRFRAMES…';
    await Promise.all([preloadModels((f) => { $('loadFill').style.width = (10 + f * 60) + '%'; }), preloadProps(), preloadCharacter(), preloadShips()]);
    $('loadText').textContent = 'BUILDING TOWNS & ROADS…';
    await new Promise(r => setTimeout(r, 20));
    world.towns = new Towns(scene, world);
    world.airbases = new Airbases(scene);
    world.airbases.addTownRoutes(world.towns.towns);
    world.airTraffic = new AirTraffic(scene);
    const night0 = world.timeKey === 'night' || world.timeKey === 'dusk';
    world.towns.setNight(night0);
    world.airbases.setNight(night0);
    world.airTraffic.setNight(night0);
    world.updateTerrain(new THREE.Vector3(0, 0, 0), true);
    $('loadFill').style.width = '95%';
    game = new Game({ scene, camera, world, effects, audio, input, hud, cockpit, settings });
    game.onGameOver = showGameOver;
    game.onNvg = (on) => { renderer.domElement.style.filter = on ? 'grayscale(1) brightness(2.3) contrast(1.35) sepia(1) hue-rotate(55deg) saturate(3.5)' : ''; };
    career.attach(game);
    career.onChange(() => { refreshLocks(); renderPilotBadge(); });
    game.onPause = (on) => {
        $('pause').classList.toggle('show', on);
        $('quickPos').classList.toggle('show', on && game.quickPositionsAllowed);
    };
    game.onHelp = () => { if (game.state === 'playing') game.pause(true); openModal('controlsModal'); };
    game.onSettingsChange = () => { save(); document.querySelectorAll('.seg').forEach(sg => { const k = sg.dataset.key; if (k) sg.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.val === String(settings[k]))); }); };
    game.applyLivery = (ac) => applyLivery(ac.model, settings.livery, ac.type);
    window.skywar = { game, settings, world, effects, cockpit, camera, Pilot, renderer, post: { composer, bloom, grade, postfx } };
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
        ['RACING & AEROBATIC', k => AIRCRAFT[k].category === 'racer'],
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
            const lock = document.createElement('span');
            lock.className = 'lock';
            el.appendChild(lock);
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
            audio.uiClick(); updateBest(); buildMissionList(); updateLaunch();
        });
        mc.appendChild(b);
    }
    buildMissionList();
    seg('segDifficulty', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), 'difficulty', updateBest);
    seg('segTime', Object.entries(TIMES).map(([k, v]) => [k, v.label]), 'time', () => world.setTime(settings.time));
    seg('segWingmen', [[0, 'SOLO'], [1, '1'], [2, '2']], 'wingmen');
    seg('segWeather', [['clear', 'CLEAR'], ['cloudy', 'CLOUDY'], ['rain', 'RAIN'], ['storm', 'STORM']], 'weather', () => world.setWeather(settings.weather));
    seg('segStart', [['auto', 'AUTO'], ['air', 'AIR'], ['runway', 'RWY'], ['apron', 'TAXI'], ['carrier', 'CVN'], ['barracks', 'BARRACKS']], 'start');
    seg('segLoadout', Object.entries(LOADOUT_LABELS).map(([k, v]) => [k, v.label.split(' ')[0]]), 'loadout');
    seg('segLivery', Object.entries(LIVERIES).map(([k, v]) => [k, v.label]), 'livery', () => { if (showcase) applyLivery(showcase.model, settings.livery, showcase.type); });
    seg('setFuel', [[true, 'ON'], [false, 'OFF']], 'fuel');
    const controlOpts = [['mouseaim', 'MOUSE-AIM'], ['mousestick', 'MOUSE STICK'], ['keyboard', 'KEYS/PAD']];
    seg('segControls', controlOpts, 'controlMode', syncControlHint);
    // settings modal
    seg('setControls', controlOpts, 'controlMode', syncControlHint);
    seg('setInvert', [[false, 'OFF'], [true, 'ON']], 'invertPitch');
    seg('setQuality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']], 'quality', applyQuality);
    seg('setMotionBlur', [[true, 'ON'], [false, 'OFF']], 'motionBlur', () => postfx.setQuality(settings.quality, settings)); // [postfx]
    seg('setDynRes', [[true, 'ON'], [false, 'OFF']], 'dynRes', () => postfx.setQuality(settings.quality, settings)); // [postfx]
    seg('setCallouts', [[true, 'ON'], [false, 'OFF']], 'callouts', () => (audio.callouts = settings.callouts));
    seg('setG', [[true, 'ON'], [false, 'OFF']], 'gEffects');
    seg('setCockpit', [[false, 'OFF'], [true, 'ON']], 'defaultCockpit');
    $('setSens').value = settings.sensitivity;
    $('setSens').oninput = (e) => { settings.sensitivity = +e.target.value; save(); };
    $('setStick').value = settings.stickResponse;
    $('setStick').oninput = (e) => { settings.stickResponse = +e.target.value; save(); };
    $('setMusic').value = settings.music ?? 0.5;
    $('setMusic').oninput = (e) => { settings.music = +e.target.value; music.setVolume(settings.music); save(); };
    $('setVolume').value = settings.volume;
    $('setVolume').oninput = (e) => { settings.volume = +e.target.value; audio.setVolume(settings.volume); save(); };
    syncControlHint();

    $('launchBtn').onclick = launch;
    $('resumeBtn').onclick = () => game.pause(false);
    document.querySelectorAll('[data-qp]').forEach(b => b.addEventListener('click', () => { audio.uiConfirm(); game.quickPosition(b.dataset.qp); }));
    $('abortBtn').onclick = () => { $('pause').classList.remove('show'); toMenu(); };
    $('retryBtn').onclick = () => { $('over').classList.remove('show'); launch(); };
    $('menuBtn').onclick = () => { $('over').classList.remove('show'); toMenu(); };
    document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { if (b.dataset.open === 'profileModal') renderProfile(); openModal(b.dataset.open); }));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.remove('show')));
    buildCredits();
    seg('setUnlocks', [[false, 'CAREER'], [true, 'ALL UNLOCKED']], 'unlockAll', () => { career.unlockAll = !!settings.unlockAll; refreshLocks(); });
    selectAircraft(settings.aircraft in AIRCRAFT ? settings.aircraft : 'f16');
    refreshLocks();
    renderPilotBadge();
}

function buildMissionList() {
    const el = $('missionList');
    el.classList.toggle('show', settings.mode === 'missions');
    if (settings.mode !== 'missions') return;
    el.innerHTML = '';
    const daily = dailyMission();
    const items = [['daily', 'DAILY — ' + daily.def.title, (AIRCRAFT[daily.aircraft].name + ' · ' + TIMES[daily.time].label + ' · ') + daily.def.desc, 'TODAY'],
        ...Object.entries(MISSIONS).map(([id, m]) => [id, m.title, m.desc, m.tag])];
    if (!settings.missionId) settings.missionId = 'daily';
    for (const [id, title, desc, tag] of items) {
        const b = document.createElement('button');
        b.className = 'mission' + (id === 'daily' ? ' daily' : '') + (settings.missionId === id ? ' sel' : '');
        const t = document.createElement('div'); t.className = 'mt';
        const tt = document.createElement('span'); tt.textContent = title;
        const tg = document.createElement('i'); tg.textContent = tag;
        t.append(tt, tg);
        const d = document.createElement('div'); d.className = 'md'; d.textContent = desc;
        b.append(t, d);
        b.addEventListener('click', () => {
            settings.missionId = id; save();
            el.querySelectorAll('.mission').forEach(x => x.classList.toggle('sel', x === b));
            audio.uiClick(); updateBest(); updateLaunch();
        });
        el.appendChild(b);
    }
}

// ── Career: locks, pilot badge, profile ──
function refreshLocks() {
    document.querySelectorAll('.ac-item').forEach(el => {
        const id = el.dataset.id, ok = career.aircraftUnlocked(id);
        el.classList.toggle('locked', !ok);
        const l = el.querySelector('.lock');
        if (l) l.textContent = ok ? '' : '🔒 ' + RANKS[career.aircraftRank(id)].name.split(' ').map(w => w[0]).join('');
    });
    document.querySelectorAll('#segLivery button').forEach(b => {
        const ok = career.liveryUnlocked(b.dataset.val);
        b.disabled = !ok; b.classList.toggle('locked', !ok);
        b.title = ok ? '' : 'Unlocks at ' + RANKS[career.liveryRank(b.dataset.val)].name;
    });
    if (!career.liveryUnlocked(settings.livery)) { settings.livery = 'default'; save(); if (showcase) applyLivery(showcase.model, 'default'); }
    updateLaunch();
}

function updateLaunch() {
    const daily = settings.mode === 'missions' && (settings.missionId === 'daily' || !settings.missionId);
    const ok = daily || career.aircraftUnlocked(settings.aircraft);
    const btn = $('launchBtn');
    btn.disabled = !ok;
    btn.classList.toggle('locked', !ok);
    btn.firstChild.textContent = ok ? 'LAUNCH ' : 'LOCKED — ' + RANKS[career.aircraftRank(settings.aircraft)].name + ' ';
}

function renderPilotBadge() {
    const el = $('pilotBadge');
    if (!el) return;
    const r = career.rank, n = career.nextRank, xp = career.data.xp;
    const frac = n ? (xp - r.xp) / (n.xp - r.xp) : 1;
    el.innerHTML = '';
    const t = document.createElement('div'); t.className = 'pb-rank'; t.textContent = r.name;
    const bar = document.createElement('div'); bar.className = 'pb-bar';
    const fill = document.createElement('i'); fill.style.width = Math.round(frac * 100) + '%'; bar.appendChild(fill);
    const x = document.createElement('div'); x.className = 'pb-xp'; x.textContent = xp.toLocaleString() + ' XP' + (n ? ' / ' + n.xp.toLocaleString() : '');
    el.append(t, bar, x);
}

function renderProfile() {
    const d = career.data, body = $('profileBody');
    body.innerHTML = '';
    const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; body.appendChild(e); return e; };
    add('div', 'pf-rank', career.rank.name);
    const n = career.nextRank;
    add('div', 'mono dim small-text', n ? (n.xp - d.xp).toLocaleString() + ' XP to ' + n.name + ' — unlocks: ' + (career.unlocksAt(career.rankIndex + 1).join(', ') || '—') : 'Maximum rank reached.');
    const stats = add('div', 'stats', null);
    const hrs = Math.floor(d.flightTime / 3600), mins = Math.floor((d.flightTime % 3600) / 60);
    for (const [k, v] of [['TOTAL XP', d.xp.toLocaleString()], ['SORTIES', d.sorties], ['KILLS', d.kills], ['GROUND KILLS', d.groundKills], ['WINS', d.wins], ['LANDINGS', d.landings], ['TRAPS', d.traps], ['LOSSES', d.deaths], ['FLIGHT TIME', hrs + 'h ' + mins + 'm']]) {
        const c = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = k; c.append(b, s); stats.appendChild(c);
    }
    add('div', 'panel-title', 'MEDALS ' + Object.keys(d.medals).length + ' / ' + Object.keys(MEDALS).length);
    const grid = add('div', 'medals', null);
    for (const [id, m] of Object.entries(MEDALS)) {
        const c = document.createElement('div'); c.className = 'medal' + (d.medals[id] ? ' got' : '');
        const b = document.createElement('b'); b.textContent = (d.medals[id] ? '🎖 ' : '· ') + m.name;
        const s = document.createElement('span'); s.textContent = m.desc;
        c.append(b, s); grid.appendChild(c);
    }
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
        GUN <b>${s.gun ? esc(s.gun.name) : 'NONE'}</b> · MISSILES <b>${s.missiles}</b> · FLARES <b>${s.flares}</b><br>
        TAKEOFF <b>~${Math.round(refSpeeds(s).takeoff * 1.944)} KT</b> · LANDING <b>~${Math.round(refSpeeds(s).approach * 1.944)} KT</b> · STALL <b>${Math.round(refSpeeds(s).stall * 1.944)} KT</b></div>`;
    spawnShowcase(id);
    updateBest();
    updateLaunch();
}

function bestKey(mode, missionId, daily) {
    if (mode === 'missions') return daily ? 'daily:' + (game && game.dailyKey && game.state !== 'menu' ? game.dailyKey : dailyMission().key) : 'mission:' + missionId + ':' + settings.difficulty;
    return mode + ':' + settings.difficulty;
}

function updateBest() {
    const k = settings.mode === 'missions' ? bestKey('missions', settings.missionId, !settings.missionId || settings.missionId === 'daily') : bestKey(settings.mode);
    const b = best[k];
    const label = settings.mode === 'missions' ? (settings.missionId === 'daily' || !settings.missionId ? 'TODAY\'S DAILY' : (MISSIONS[settings.missionId] || {}).title) : MODES[settings.mode].label;
    const isDaily = settings.mode === 'missions' && (settings.missionId === 'daily' || !settings.missionId);
    $('best').textContent = b ? `BEST ${label}${isDaily ? '' : ' (' + DIFFICULTY[settings.difficulty].label + ')'}: ${b.score} PTS${b.win ? ' · ✓ COMPLETED' : ''}` : '';
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
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (game.state !== 'over' && game.state !== 'menu' && game.player) career.finishSortie({ score: Math.round(game.score), mode: game.mode }, true);
    input.freeMouse = false;
    game.cleanup();
    game.state = 'menu';
    world.setTime(settings.time);
    cockpitPass.enabled = false;
    cockpit.enabled = false;
    spawnShowcase(settings.aircraft);
    $('menu').classList.add('show');
    $('clickToFly').classList.remove('show');
    input.unlock();
}

function launch() {
    if ($('launchBtn').disabled) return;
    audio.init();
    career.startSortie();
    audio.uiConfirm();
    if (showcase) { showcase.remove(); showcase = null; }
    world.setTime(settings.time);
    $('menu').classList.remove('show');
    input.consumeMouse();
    if (settings.mode === 'missions') {
        const daily = settings.missionId === 'daily' || !settings.missionId ? dailyMission() : null;
        if (daily) world.setTime(daily.time);
        game.start({ mode: 'missions', aircraft: daily ? daily.aircraft : settings.aircraft, mission: daily ? daily.id : settings.missionId, daily: !!daily });
        game.dailyKey = daily ? daily.key : null;
    } else game.start({ mode: settings.mode, aircraft: settings.aircraft });
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
    const k = bestKey(r.mode, r.missionId, r.daily);
    const prev = best[k];
    const isBest = !prev || r.score > prev.score;
    if (isBest && r.score > 0) {
        best[k] = { score: r.score, kills: r.kills, win: r.victory || (prev && prev.win) };
        try { localStorage.setItem('skywar.best', JSON.stringify(best)); } catch (e) { /* ignore */ }
    } else if (r.victory && prev && !prev.win) {
        prev.win = true;
        try { localStorage.setItem('skywar.best', JSON.stringify(best)); } catch (e) { /* ignore */ }
    }
    $('overTitle').textContent = r.victory ? 'MISSION COMPLETE' : 'SHOT DOWN';
    $('overTitle').className = 'card-title ' + (r.victory ? 'win' : 'lose');
    $('overTitle').textContent = r.mission ? (r.victory ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED') : $('overTitle').textContent;
    $('overSub').textContent = (r.mission ? (r.daily ? 'DAILY · ' : '') + r.mission : MODES[r.mode].label) + ' · ' + AIRCRAFT[r.aircraft].name.toUpperCase() + ' · ' + DIFFICULTY[settings.difficulty].label;
    const stats = [
        ['SCORE', r.score], ['KILLS', r.kills], r.mode === 'dogfight' || r.mode === 'survival' ? ['WAVE', r.wave] : ['GROUND KILLS', r.groundKills],
        ['TIME', r.time], ['GUN ACCURACY', r.accuracy + '%'], ['MISSILE HITS', r.missileHits + ' / ' + r.missiles],
    ];
    $('overStats').innerHTML = stats.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('');
    $('overBest').textContent = isBest && r.score > 0 ? '★ NEW PERSONAL BEST' : prev ? 'BEST: ' + prev.score : '';
    $('overBest').style.color = isBest ? 'var(--accent)' : 'var(--dim)';
    const cr = career.finishSortie(r);
    const xpLine = '+' + cr.xp.toLocaleString() + ' XP · ' + career.rank.name + (cr.promoted ? '  ▲ PROMOTED!' : '');
    $('overBest').textContent = [$('overBest').textContent, xpLine].filter(Boolean).join('   ·   ');
    if (cr.promoted) {
        $('overSub').textContent += '  —  PROMOTED TO ' + cr.promoted + (cr.unlocked.length ? ' · UNLOCKED: ' + cr.unlocked.join(', ') : '');
        audio.say('Congratulations, you have been promoted to ' + cr.promoted.toLowerCase() + '.', true);
    }
    $('over').classList.add('show');
}

function buildCredits() {
    const rows = [
        ['F-16C Falcon', 'Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f16-c-falcon-4bc2ff75dc584af2afd0aa6bd8b79015'],
        ['Mitsubishi F-2', 'bohmerang', 'CC BY 4.0', 'https://sketchfab.com/3d-models/mitsubishi-f-2-fighter-jet-free-d3d7244554974f499b106e6c11fe3aaf'],
        ['F-35A (new model)', 'SKYWAR / Blender', 'CC0', 'tools/f35a_model.py'],
        ['F22 Raptor (f22)', 'Njan (Jan Esch)', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f22-raptor-03a2651804344ebc930e01cc945bf07d'],
        ['Low poly 1:1 F/A-18F SuperHornet (fa18)', 'WTigerTw', 'CC BY 4.0', 'https://sketchfab.com/3d-models/low-poly-11-fa-18f-superhornet-635e68b7a0d24ac29c10f5fb9110129f'],
        ['A-10 Thunderbolt II (a10)', 'AIRMAN Magazine', 'CC BY 4.0', 'https://sketchfab.com/3d-models/a-10-thunderbolt-ii-9521ff6ba5d448958ea45a89e94ab23d'],
        ['Su 30 (su35)', 'akashritharan', 'CC BY 4.0', 'https://sketchfab.com/3d-models/su-30-fbcbe88be95e4bada5064f3f8f3893de'],
        ['JAS39 Gripen (gripen)', 'helijah', 'CC BY 4.0', 'https://sketchfab.com/3d-models/jas39-gripen-a2b70c2f92af45d18d95f02b60621dbf'],
        ['Cessna 172 Skyhawk - Stormworks (cessna)', 'ThalesMML', 'CC BY 4.0', 'https://sketchfab.com/3d-models/cessna-172-skyhawk-stormworks-49ac79d106934cb299f3c5ab645f9bda'],
        ['737 Max-8 (Free) (b737)', 'AMGP3D', 'CC BY 4.0', 'https://sketchfab.com/3d-models/737-max-8-free-197ae72ceb5441efa91b8bdc2ee37050'],
        ['Low poly 1:1 USAF F35A (f35)', 'WTigerTw', 'CC BY 4.0', 'https://sketchfab.com/3d-models/low-poly-11-usaf-f35a-dc727cb5c1404f26b3a29a7e2d50bb2b'],
        ['Boeing747 (b747)', 'kaymanv', 'CC BY 4.0', 'https://sketchfab.com/3d-models/boeing747-4eadf04e705b41a2b272ee5aed4d01d5'],
        ['NASA Airborne Science C-130 model (c130)', 'NASA', 'Public domain (NASA)', 'https://airbornescience.nasa.gov/3d-models'],
        ['F-14 Tomcat Top Gun (Gear UP) (f14)', 'dwsd', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f-14-tomcat-top-gun-gear-up-downloadable-9d2d0c87539046aa8c2198fcc47cdcf8'],
        ['F-15 Eagle (f15)', 'dashdu', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f-15-eagle-f874bffa8e314743b4a7cb9ad4b9f3a8'],
        ['F-4 Phantom II Recreation (f4)', 'jpford63', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f-4-phantom-ii-recreation-666403b893024c8c88409f9feb2277eb'],
        ['Eurofighter Typhoon Game Prop (typhoon)', 'robnewman76', 'CC BY 4.0', 'https://sketchfab.com/3d-models/eurofighter-typhoon-game-prop-01d9a26a89dc4a17a9fa4c4c1f7ac39f'],
        ['Dassault Rafale (rafale)', 'so_O', 'CC BY 4.0', 'https://sketchfab.com/3d-models/dassault-rafale-d8bbfb0970ca4128b73e7e5364828fd3'],
        ['MiG-29 Fulcrum Fighter Jet (mig29)', 'Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/mig-29-fulcrum-fighter-jet-ec6c1fcfe35f4cc8a638bd85463a34f2'],
        ['PAK FA (su57)', 'jratanatharathorn', 'CC BY 4.0', 'https://sketchfab.com/3d-models/pak-fa-245cebbc76e34a9d8b77e81a54d9cdf1'],
        ['Su-47 Berkut (su47)', 'Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/su-47-berkut-4a2b1cecf13c4c9db7933ffd7fd67339'],
        ['B-2 Spirit Bomber (b2)', 'Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/b-2-spirit-bomber-12244128967f4d93b9cac52b275c3d51'],
        ['P-51 Mustang (racer)', 'UlissesVinicios', 'CC BY 4.0', 'https://sketchfab.com/3d-models/p-51-mustang-36f0f3e71d2a4c18b479db1ae8f9e7a7'],
        ['Airplane biplane (pitts)', 'BlueHour', 'CC BY 4.0', 'https://sketchfab.com/3d-models/airplane-biplane-be48f3f906ed431b98b1bf03ab7aadd6'],
        ['MiG-31, MiG-25, J-20, J-10, J-8, F-5E, MiG-21, Mirage III, Jaguar', 'SKYWAR / Blender (tools/aircraft_kit.py)', 'CC0', 'tools/aircraft/'],
        ['Aircraft carrier and destroyer', 'SKYWAR / Blender (tools/ships)', 'CC0', 'tools/ships/'],
        ['Helicopter (military)', 'Zsky', 'CC BY 3.0', 'https://poly.pizza/m/hG2Qr0A3zR'],
        ['Helicopter (civil)', 'jeremy', 'CC BY 3.0', 'https://poly.pizza/m/eb7b31pjGtQ'],
        ['Humvee', 'madtrollstudio', 'CC BY 3.0', 'https://poly.pizza/m/Ebryot9iKM'],
        ['Buggy', 'Nick', 'CC BY 3.0', 'https://poly.pizza/m/eZ_13w7qZh7'],
        ['Cars Bundle (sedan, hatchback, SUV, sports cars, taxi, police car)', 'Quaternius', 'CC0', 'https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk'],
        ['Tank', 'Zsky', 'CC BY 3.0', 'https://poly.pizza/m/7GG1xDtc8l'],
        ['SWAT (the pilot on foot and under the parachute)', 'Quaternius', 'CC0', 'https://poly.pizza/m/Btfn3G5Xv4'],
        ['Man (the civilian in Grand Theft Aero)', 'Quaternius', 'CC0', 'https://poly.pizza/m/HMnuH5geEG'],
        ['M939 Truck', 'J-Toastie', 'CC BY 3.0', 'https://poly.pizza/m/y8lBpvMlim'],
        ['Trees, grass, ferns and ground textures (photoscans; see models/vegetation and models/ground)', 'Poly Haven', 'CC0', 'https://polyhaven.com'],
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
    const mp = document.createElement('p');
    mp.style.marginTop = '10px';
    mp.textContent = 'Music (CC0, OpenGameArt.org): "Fantasy Orchestral Theme" by Joth · "The Rush" by Thomas Bruno (tebruno99) · "Space Music: Out There" and "Pressure" by yd. See music/CREDITS.md.';
    body.appendChild(mp);
    const t = document.createElement('p');
    t.style.marginTop = '10px';
    t.textContent = 'Engine: three.js. All other models, terrain, effects, cockpit, and audio are procedurally generated.';
    body.appendChild(t);
}

// ═════════════ Loop ═════════════
const timer = new THREE.Timer();
timer.connect(document); // pauses cleanly while the tab is hidden
function loop() {
    requestAnimationFrame(loop);
    timer.update();
    frame(Math.min(timer.getDelta(), 0.05));
}
// debug/test hook: advance the simulation manually (works in background tabs)
window.skywarStep = (n = 60, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); };
function frame(dt) {
    if (game.state === 'menu') updateMenuScene(dt);
    else game.update(dt);
    if (game.state === 'menu' || game.state === 'paused' || game.state === 'over') {
        audio.update(dt, null, { playing: false });
        input.readPad(); // keep gamepad buttons (Start to unpause) alive outside flight
    } else if (game.pilotMode) input.readPad();

    cockpitPass.enabled = cockpit.enabled && !game.groundStart && game.state !== 'menu' && ((game.player && game.player.alive) || !!game.pilotMode);
    $('clickToFly').classList.toggle('show', game.state === 'playing' && !game.photo && settings.controlMode !== 'mousestick' && !input.locked);
    // Depth precision: push the near plane out as the camera climbs (the cockpit has its own camera),
    // so distant beaches and the water plane don't fight in the depth buffer.
    const agl = camera.position.y - Math.max(terrainHeight(camera.position.x, camera.position.z), 0);
    const near = clamp(agl / 80, 0.5, 6);
    if (Math.abs(camera.near - near) > 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
    postfx.render(dt, game); // [postfx] composer.render + GPU timing for adaptive resolution
    hud.draw(game, dt);
    music.update(dt, game);
    if (touchUI) touchUI.classList.toggle('show', game.state === 'playing' && !game.pilotMode);
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
        world.updateWeather(dt, camera, game);
        if (world.towns) world.towns.update(dt, camera.position); // street furniture, parked cars near the camera
        effects.update(dt, camera, scene.fog, () => 0);
    }
}

boot().catch(e => {
    console.error(e);
    $('loadText').textContent = 'ERROR: ' + e.message;
});
void BASES;
