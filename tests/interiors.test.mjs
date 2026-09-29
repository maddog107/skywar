// Interiors (src/interiors.js) and the logic behind their consoles (src/firecontrol.js), headless:
//  • a procedural room (def.build) turns its nodes into controls, screens, a station, the spawn and an exit; the
//    crosshair picks the control in front of it within reach; a guard covers its button until it's lifted (a click
//    is refused, the keyboard shortcut lifts it first, firing drops it again); switches, knobs and lamps follow their
//    bindings; a screen's widgets take clicks by uv, and the full path (walk up, click the screen: sit at the
//    station, then the cursor clicks a button on it) works; walk areas, steps and exits
//  • SubControl: rig for dive, dive to periscope depth with the bow down, masts only near the surface, the hatch,
//    shoal water, surfacing, speed from the bells
//  • SubFireControl: the launch checklist in order, FIRE refused until everything's done, one launch, the muzzle
//    hatch shuts after it; no data link / out of range / the wrong weapon hold it
//  • StrikeConsole and TelPanel: the order of things, the reasons they give, one launch
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const I = await src('interiors.js');
const FC = await src('firecontrol.js');

// ═════════════ a room built in code ═════════════
// a console panel 1 m in front of the spawn: a guarded FIRE button, a key switch, a mode knob, a lamp, a screen
// (a 0.5 × 0.25 m quad) and the station in front of it; the door 2 m to the right
function buildRoom(root) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const node = (name, ctl, pos, geo) => {
        const o = geo ? new THREE.Mesh(geo, mat) : new THREE.Object3D();
        o.name = name; o.userData.ctl = JSON.stringify(ctl); o.position.set(...pos);
        root.add(o);
        return o;
    };
    node('btn_fire', { t: 'button', slide: [0, 0, -1], travel: 0.005 }, [0, 1.5, -1], new THREE.BoxGeometry(0.04, 0.04, 0.02));
    // the guard hinges on its top edge (the node's origin), its cover hanging down in front of the button
    node('guard_fire', { t: 'guard', hinge: [1, 0, 0], open: -1.9 }, [0, 1.535, -0.975], new THREE.BoxGeometry(0.07, 0.07, 0.01).translate(0, -0.035, 0));
    node('sw_key', { t: 'switch', hinge: [0, 0, 1], open: -1.4 }, [0.25, 1.5, -1], new THREE.BoxGeometry(0.03, 0.05, 0.03));
    node('knob_mode', { t: 'knob', hinge: [0, 0, 1], open: -2.4, steps: 4 }, [-0.25, 1.5, -1], new THREE.CylinderGeometry(0.025, 0.025, 0.02).rotateX(Math.PI / 2));
    node('lamp_armed', { t: 'lamp', color: '#ff3a20' }, [0.12, 1.62, -1], new THREE.SphereGeometry(0.012));
    node('exit_door', { t: 'exit' }, [2, 1, 0], new THREE.BoxGeometry(0.05, 2, 1));
    const quad = new THREE.PlaneGeometry(0.5, 0.25);
    const uv = quad.attributes.uv; // (glTF's v runs down: the canvas's top is v = 0)
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    node('screen_main', { t: 'screen', w: 256, h: 128 }, [0, 1.2, -1], quad);
    node('stand_main', { t: 'station', fov: 40 }, [0, 1.3, -0.45]);
    node('spawn', { t: 'spawn' }, [0, 0, 1]);
    root.userData.room = JSON.stringify({ walk: [[-3, 3, -0.7, 3, 0], [3, 5, -0.7, 3, 0.4], [5, 7, -0.7, 3, 0.9]], holes: [[1, 1.5, 2, 2.5]], eye: 1.62 });
}

function stubGame() {
    const feed = [];
    const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.05, 100);
    camera.updateProjectionMatrix();
    return {
        feed, camera, time: 0, state: 'playing', settings: {}, scene: new THREE.Scene(),
        input: { down: () => false, mouse: { left: false }, lock() {}, locked: true },
        hud: { w: 1280, h: 720 },
        audio: { tick() {} },
        addFeed(t) { feed.push(t); },
    };
}

async function makeRoom() {
    const st = { fired: 0, key: false, mode: 0, clicked: [] };
    const room = new I.Room({
        id: 'test', name: 'TEST ROOM', build: buildRoom,
        bind: {
            btn_fire: { label: 'FIRE', key: 'KeyF', press: () => { st.fired++; } },
            sw_key: { label: () => (st.key ? 'KEY — ON' : 'KEY — OFF'), value: () => st.key, press: () => { st.key = !st.key; } },
            knob_mode: { label: () => 'MODE ' + st.mode, value: () => st.mode / 3, turn: (d) => { st.mode = Math.max(0, Math.min(3, st.mode + d)); } },
            lamp_armed: { lit: () => st.key },
            exit_door: { label: 'DOOR (LEAVE)' },
        },
        screens: {
            screen_main: {
                draw: (ctx, ui) => {
                    ui.button(10, 10, 100, 40, 'ALPHA', () => st.clicked.push('ALPHA'));
                    ui.row(10, 60, 200, 30, [['BRAVO ROW', 120], ['2 KM', 60, 'right']], () => st.clicked.push('BRAVO'));
                    ui.button(140, 10, 100, 40, 'OFF', () => st.clicked.push('OFF'), { disabled: true });
                },
            },
        },
        stations: { stand_main: { label: 'MAIN CONSOLE', order: 1 } },
    });
    await room.load();
    room.place();
    const game = stubGame();
    const sys = new I.Interiors(game);
    const rc = new I.RoomController(sys, room);
    return { room, game, sys, rc, st };
}

// put the controller's eye at p looking at q (room = world here: the anchor is the identity)
const _cam = new THREE.PerspectiveCamera();
function aim(rc, p, q) {
    _cam.position.set(...p); _cam.lookAt(new THREE.Vector3(...q));
    rc.camPos.copy(_cam.position); rc.camQuat.copy(_cam.quaternion);
    rc.room.place();
    rc.updateHover();
    return rc.hover;
}
const settle = (room, game, s = 1) => { for (let t = 0; t < s; t += 1 / 60) room.update(1 / 60, game); room.place(); };

describe('interiors: a room, its controls and screens', () => {
    test('a procedural room: controls, guards, screens, the station, the spawn, walk areas', async () => {
        const { room } = await makeRoom();
        assert.ok(room.loaded);
        for (const n of ['btn_fire', 'guard_fire', 'sw_key', 'knob_mode', 'lamp_armed', 'exit_door']) assert.ok(room.controls.has(n), n);
        const btn = room.controls.get('btn_fire'), guard = room.controls.get('guard_fire');
        assert.equal(guard.guards, btn, 'the guard covers FIRE (guard_fire → btn_fire)');
        assert.equal(btn.guard, guard);
        assert.equal(room.controls.get('knob_mode').steps, 4);
        assert.ok(room.controls.get('lamp_armed').lampMat, 'a lamp gets its own emissive material');
        assert.deepEqual(room.exits.map(c => c.id), ['exit_door']);
        assert.equal(room.screens.size, 1);
        assert.equal(room.stations.length, 1);
        assert.equal(room.stations[0].label, 'MAIN CONSOLE');
        assert.equal(room.stations[0].fov, 40);
        assert.deepEqual(room.spawn.pos.toArray(), [0, 0, 1]);
        assert.equal(room.walk.length, 3);
        assert.equal(btn.label, 'FIRE');
    });

    test('the crosshair picks the control in front of it, within reach; a closed guard is in the way', async () => {
        const { rc, room, game } = await makeRoom();
        let h = aim(rc, [0, 1.5, 0.2], [0, 1.5, -1]);
        assert.ok(h, 'something under the crosshair');
        assert.equal(h.ref.id, 'guard_fire', 'the closed guard hides the button');
        assert.match(h.label, /^LIFT GUARD — FIRE/);
        rc.activate(h.ref, false);                       // lift it
        settle(room, game, 0.6);
        h = aim(rc, [0, 1.5, 0.2], [0, 1.5, -1]);
        assert.equal(h.ref.id, 'btn_fire', 'with the guard up the button is there');
        assert.equal(h.label, 'FIRE  [F]', 'its label and its key');
        assert.equal(h.blocked, '');
        h = aim(rc, [0.25, 1.5, 0.2], [0.25, 1.5, -1]);
        assert.equal(h.ref.id, 'sw_key');
        assert.equal(h.label, 'KEY — OFF');
        // out of reach walking (2.6 m); a station or the cursor reaches further
        assert.equal(aim(rc, [0.25, 1.5, 3.2], [0.25, 1.5, -1]), null, 'too far to reach');
        rc.cursor = { x: 640, y: 360 };
        assert.equal(aim(rc, [0.25, 1.5, 3.2], [0.25, 1.5, -1]).ref.id, 'sw_key', 'the cursor reaches 4.5 m');
        rc.cursor = null;
        // nothing there
        assert.equal(aim(rc, [0, 1.5, 0.2], [0, 1.5, 3]), null);
    });

    test('a guarded button: a click is refused while it is closed, its key lifts it, firing drops it', async () => {
        const { rc, room, game, st } = await makeRoom();
        const btn = room.controls.get('btn_fire'), guard = room.controls.get('guard_fire');
        rc.activate(btn, false);
        assert.equal(st.fired, 0);
        assert.match(game.feed.at(-1), /GUARD CLOSED/);
        rc.activate(btn, true);                          // the keyboard shortcut: the guard goes up, nothing fires yet
        assert.equal(st.fired, 0);
        assert.equal(guard.target, 1);
        settle(room, game, 0.5);
        assert.ok(guard.open);
        rc.activate(btn, false);
        assert.equal(st.fired, 1, 'fired');
        assert.equal(guard.target, 0, 'the guard drops back after firing');
        assert.ok(btn.pulse > 0, 'the button is pressed in');
        settle(room, game, 0.5);
        assert.ok(btn.k < 0.05, 'and springs back');
    });

    test('switches, knobs and lamps follow their bindings', async () => {
        const { rc, room, game, st } = await makeRoom();
        const sw = room.controls.get('sw_key'), knob = room.controls.get('knob_mode'), lamp = room.controls.get('lamp_armed');
        rc.activate(sw, false);
        assert.equal(st.key, true);
        settle(room, game, 0.5);
        assert.ok(sw.k > 0.95, 'the switch flipped');
        assert.ok(lamp.lampMat.emissiveIntensity > 2, 'the lamp is lit');
        rc.activate(sw, false);
        settle(room, game, 0.5);
        assert.ok(sw.k < 0.05 && lamp.lampMat.emissiveIntensity < 0.1, 'off again');
        rc.turn(knob, 1); rc.turn(knob, 1);
        assert.equal(st.mode, 2);
        rc.turn(knob, 1); rc.turn(knob, 1);
        assert.equal(st.mode, 3, 'the knob stops at its last position');
        rc.activate(knob, false);                        // a click steps it too
        settle(room, game, 0.5);
        assert.ok(Math.abs(knob.k - 1) < 0.02);
        assert.equal(knob.label, 'MODE 3');
        rc.activate(lamp, false);                        // lamps don't do anything
    });

    test('screens: a click at a uv runs the widget under it; hover labels; disabled widgets refuse', async () => {
        const { room, game, st } = await makeRoom();
        const s = room.screens.get('screen_main');
        s.update(1, game, room);
        const uv = (x, y) => ({ x: x / 256, y: y / 128 });
        assert.equal(s.label(uv(50, 30)), 'ALPHA');
        assert.equal(s.label(uv(50, 75)), 'BRAVO ROW', 'a row is labelled by its first cell');
        assert.equal(s.label(uv(250, 120)), '');
        s.click(uv(50, 30));
        s.click(uv(100, 70));
        const r = s.click(uv(180, 30));
        assert.ok(r && r.blocked, 'a disabled button refuses');
        assert.equal(s.click(uv(250, 120)), null, 'nothing there');
        assert.deepEqual(st.clicked, ['ALPHA', 'BRAVO']);
    });

    test('walk up, click the screen: sit at its station; then the cursor clicks a button on it', async () => {
        const { rc, room, game, st } = await makeRoom();
        const s = room.screens.get('screen_main');
        s.update(1, game, room);
        const h = aim(rc, [0, 1.62, 0.3], [0, 1.2, -1]);
        assert.equal(h.ref, s);
        assert.equal(h.label, 'CLICK: SIT AT MAIN CONSOLE', 'walking, a console\'s screen seats you (not its widgets)');
        rc.click();
        assert.equal(rc.station && rc.station.id, 'stand_main', 'seated at the console');
        assert.ok(rc.cursor, 'with the cursor out');
        rc.updatePose(1);                                // (the move to the seat is done)
        game.camera.fov = rc.station.fov; game.camera.updateProjectionMatrix();
        // the ALPHA button's middle (60, 30 px on the 256 × 128 canvas) in the world, projected to the screen
        const p = new THREE.Vector3((60 / 256 - 0.5) * 0.5, (0.5 - 30 / 128) * 0.25, 0);
        s.mesh.localToWorld(p);
        game.camera.position.copy(rc.camPos); game.camera.quaternion.copy(rc.camQuat); game.camera.updateMatrixWorld();
        p.project(game.camera);
        rc.cursor = { x: (p.x + 1) / 2 * 1280, y: (1 - p.y) / 2 * 720 };
        rc.updateHover();
        assert.equal(rc.hover.label, 'ALPHA');
        rc.click();
        assert.deepEqual(st.clicked, ['ALPHA']);
        // Esc stands up again
        assert.equal(rc.action('pause'), true);
        assert.equal(rc.station, null);
    });

    test('number keys pick stations; flight actions are swallowed inside', async () => {
        const { rc } = await makeRoom();
        assert.equal(rc.action('thr1'), true);
        assert.equal(rc.station.id, 'stand_main');
        assert.equal(rc.action('thr1'), true);
        assert.equal(rc.station, null, 'the same key again stands up');
        for (const a of ['gear', 'flares', 'eject', 'weapon']) assert.equal(rc.action(a), true, a);
        assert.equal(rc.action('target'), true, 'Tab frees the cursor');
        assert.ok(rc.cursor);
    });

    test('walking: walk areas, steps of up to half a metre, holes; the exit in reach', async () => {
        const { rc, room } = await makeRoom();
        const W = room.walk;
        assert.equal(I.floorAt(W, 0, 0, 0), 0);
        assert.equal(I.floorAt(W, 4, 0, 0), 0.4, 'a step up');
        assert.equal(I.floorAt(W, 6, 0, 0), null, '0.9 m is a wall from the floor');
        assert.equal(I.floorAt(W, 6, 0, 0.4), 0.9, 'but a step from the middle tier');
        assert.equal(I.floorAt(W, 0, -2, 0), null, 'outside the room');
        assert.equal(I.floorAt(W, 1.2, 2.2, 0, room.holes), null, 'a hole (a hatch, a ladder well)');
        // walking into the console stops at the walk area's edge, sliding along it
        const input = { down: (...k) => k.includes('KeyW') || k.includes('KeyD') };
        rc.pos.set(0, 0, 0); rc.yaw = 0;
        for (let i = 0; i < 120; i++) rc.walk(1 / 60, input);
        assert.ok(rc.pos.z >= -0.7 && rc.pos.z < -0.6, 'stopped at the console, z ' + rc.pos.z.toFixed(2));
        assert.ok(rc.pos.x > 0.5, 'and slid sideways');
        rc.camPos.set(2, 1.6, 0.6);
        assert.equal(rc.nearExit() && rc.nearExit().id, 'exit_door');
        rc.camPos.set(-2, 1.6, 0.6);
        assert.equal(rc.nearExit(), null);
    });
});

// ═════════════ submarine ship control ═════════════
const run = (o, s, dt = 1 / 30) => { for (let t = 0; t < s; t += dt) o.update(dt); return o; };

describe('submarine ship control (SubControl)', () => {
    test('no dive without rigging for dive; an open hatch stops both', () => {
        const c = new FC.SubControl();
        assert.match(String(c.dive()), /NOT RIGGED/);
        c.openHatch(true);
        assert.match(String(c.setRig(true)), /HATCH OPEN/);
        c.openHatch(false);
        assert.equal(c.setRig(true), true);
        c.openHatch(true);
        assert.equal(c.rigged, false, 'opening a hatch un-rigs the boat');
        assert.match(String(c.orderDepth(1)), /NOT RIGGED|HATCH OPEN/);
        assert.equal(c.orderedIx, 0);
    });

    test('dives to periscope depth bow-down, holds it, surfaces again', () => {
        const c = new FC.SubControl();
        c.setRig(true);
        assert.equal(c.dive(), true);
        assert.equal(c.ordered.label, 'PERISCOPE DEPTH');
        run(c, 8);
        assert.ok(c.depth > 0.5 && c.vDepth > 0, 'going down');
        assert.ok(c.trim < -0.02, 'bow down (' + (c.trim * 57.3).toFixed(1) + '°)');
        run(c, 110);
        assert.ok(c.atPD, 'at periscope depth: ' + c.depth.toFixed(2) + ' m');
        assert.ok(Math.abs(c.keelFt - 60) < 5, 'keel ~60 ft: ' + c.keelFt.toFixed(0));
        assert.ok(Math.abs(c.trim) < 0.02, 'level again');
        assert.match(String(c.openHatch(true)), /SUBMERGED/);
        assert.match(String(c.setRig(false)), /SUBMERGED/);
        c.surface();
        run(c, 120);
        assert.ok(c.surfaced, 'surfaced: ' + c.depth.toFixed(2));
        assert.equal(c.openHatch(true), true);
    });

    test('deeper orders, the sea bed, emergency blow', () => {
        const c = new FC.SubControl();
        c.setRig(true);
        c.floor = 40;                                    // 40 m of water
        assert.match(String(c.orderDepth(3)), /SHOAL WATER/, '300 ft in 40 m of water');
        assert.equal(c.orderDepth(1), true, 'periscope depth is fine');
        c.floor = Infinity;
        c.setBell(4);                                    // ahead standard: the planes bite
        assert.equal(c.orderDepth(3), true);
        run(c, 240);
        assert.ok(Math.abs(c.keelFt - 300) < 12, 'keel ~300 ft: ' + c.keelFt.toFixed(0));
        c.emergencyBlow();
        run(c, 60);
        assert.ok(c.surfaced, 'the blow brings her up: ' + c.depth.toFixed(1));
    });

    test('masts: only near the surface; they house themselves going deep', () => {
        const c = new FC.SubControl();
        assert.equal(c.raiseMast('periscope_1', true), true);
        run(c, 7);
        assert.equal(c.masts.periscope_1, 1, 'up in 6 s');
        c.setRig(true); c.setBell(3); c.orderDepth(2);   // 150 ft
        run(c, 120);
        assert.ok(c.depth > c.spec.pd + 4);
        assert.equal(c.masts.periscope_1, 0, 'housed');
        assert.match(String(c.raiseMast('comms', true)), /TOO DEEP/);
        assert.equal(c.raiseMast('nope', true), 'NO SUCH MAST');
    });

    test('speed follows the bells; backing stops her, no sternway', () => {
        const c = new FC.SubControl();
        c.setBell(5);                                    // ahead full, 20 kt
        run(c, 200);
        assert.ok(Math.abs(c.speed * FC.KT - 20) < 0.5, (c.speed * FC.KT).toFixed(1) + ' kt');
        c.setRudder(6);                                  // right 30
        c.update(0.1);
        assert.ok(c.yawRate < 0, 'right rudder turns her right (heading down)');
        c.setBell(0);                                    // back 1/3
        run(c, 120);
        assert.equal(c.speed, 0);
    });
});

// ═════════════ submarine fire control ═════════════
function fcStub(over = {}) {
    const calls = { launch: [], hatch: [] };
    let now = 0;
    const tubes = [{ i: 0, label: 'VPT 1', cells: 0 }, { i: 1, label: 'VPT 2', cells: 6 }];
    const ctx = {
        now: () => now, tick: (dt) => { now += dt; },
        targets: () => [], stock: (w) => ({ tlam: 12, harpoon: 4 })[w] || 0, tubes: () => tubes,
        link: () => true, shipReady: () => ({ ok: true, why: '' }),
        range: (w, t) => ({ ok: t.km <= (w === 'tlam' ? 1600 : 120), km: t.km, max: w === 'tlam' ? 1600 : 120 }),
        hatch: (tube, open) => calls.hatch.push([tube, open]),
        launch: (w, t, tube) => { calls.launch.push([w, t.label, tube]); return { id: 1 }; },
        ...over,
    };
    return { ctx, calls, tubes };
}
const land = { key: 'M1', label: 'M1 BRIDGE', kind: 'land', km: 300 };
const ship = { key: 'U7', label: 'KIROV', kind: 'sea', km: 60 };
function runFc(fc, ctx, s) { for (let t = 0; t < s; t += 0.1) { ctx.tick(0.1); fc.update(0.1); } }

describe('submarine fire control (SubFireControl)', () => {
    test('the launch sequence in order: FIRE only when every step is done; one missile; the hatch shuts after', () => {
        const { ctx, calls } = fcStub();
        const fc = new FC.SubFireControl(ctx);
        assert.equal(fc.canFire, false);
        assert.match(fc.fire(), /TARGETS CONSOLE/, 'FIRE says what is missing first');
        assert.equal(fc.selectTarget(land), true);
        assert.equal(fc.weapon, 'tlam');
        assert.match(String(fc.spinUp()), /WEAPON KEY/);
        fc.setKey(true);
        assert.equal(fc.spinUp(), true);
        assert.equal(fc.tube, 1, 'the first loaded tube (VPT 1 is empty)');
        assert.match(fc.fire(), /SPIN UP|FIRING POINT|NOT READY/);
        assert.match(String(fc.openMuzzle()), /WEAPON NOT READY/);
        runFc(fc, ctx, 10);
        assert.equal(fc.spin, 1);
        assert.match(String(fc.openMuzzle()), /FIRING POINT PROCEDURES/);
        fc.orderFpp();
        assert.equal(fc.openMuzzle(), true);
        assert.deepEqual(calls.hatch.at(-1), [1, true]);
        assert.equal(fc.canFire, false, 'the hatch is still opening');
        runFc(fc, ctx, 4);
        assert.ok(fc.steps().every(s => s.done), fc.steps().filter(s => !s.done).map(s => s.id).join());
        assert.equal(fc.canFire, true);
        assert.equal(fc.fire(), true);
        assert.deepEqual(calls.launch, [['tlam', 'M1 BRIDGE', 1]]);
        assert.equal(fc.tube, null);
        assert.equal(fc.canFire, false, 'one missile per sequence');
        assert.notEqual(fc.fire(), true);
        runFc(fc, ctx, 7);
        assert.deepEqual(calls.hatch.at(-1), [1, false], 'the muzzle hatch shuts again');
        assert.equal(calls.launch.length, 1);
    });

    test('no data link, out of range, the wrong weapon, the ship not ready: no launch', () => {
        let link = false, ready = { ok: false, why: 'SLOW TO 6 KT' };
        const { ctx, calls } = fcStub({ link: () => link, shipReady: () => ready });
        const fc = new FC.SubFireControl(ctx);
        fc.selectTarget(ship);
        assert.equal(fc.weapon, 'harpoon', 'a ship gets a Harpoon');
        fc.setKey(true); fc.spinUp(); fc.orderFpp();
        runFc(fc, ctx, 12);
        assert.equal(fc.solution, 0, 'no data link, no solution');
        assert.match(String(fc.openMuzzle()), /SLOW TO 6 KT/);
        link = true; ready = { ok: true, why: '' };
        runFc(fc, ctx, 5);
        assert.equal(fc.solution, 1);
        assert.match(String(fc.selectWeapon('tlam')), /ABORT FIRST/, 'no weapon change once spun up');
        fc.abort();
        assert.equal(fc.spin, 0);
        assert.equal(fc.fpp, false);
        fc.selectTarget({ ...ship, km: 300 });           // beyond a Harpoon's reach
        fc.selectWeapon('harpoon');
        fc.spinUp(); fc.orderFpp();
        runFc(fc, ctx, 12);
        fc.openMuzzle();
        runFc(fc, ctx, 4);
        assert.equal(fc.canFire, false);
        assert.match(fc.blocker(), /OUT OF RANGE/);
        assert.equal(calls.launch.length, 0);
    });
});

// ═════════════ the CIC / JOC strike console ═════════════
describe('strike console (StrikeConsole)', () => {
    test('shooter, weapon, target, arm, launch — in that order, with reasons', () => {
        const launched = [];
        const mason = { key: 'S1', name: 'USS MASON', src: { id: 1 }, stock: { tlam: 8, harpoon: 4 }, rangeKm: 1600, km: (t) => t.km };
        const K = new FC.StrikeConsole({ shooters: () => [mason], launch: (src, w, t, n) => { launched.push([src.id, w, t.label, n]); return { id: 9 }; } });
        assert.equal(K.ready(), 'SELECT A TARGET');
        K.select('target', land);
        assert.equal(K.ready(), 'SELECT A SHOOTER');
        assert.equal(K.arm(), 'SELECT A SHOOTER');
        K.select('shooter', mason);
        assert.equal(K.weapon, 'tlam', 'the shooter\'s first weapon');
        K.select('n', 9);
        assert.equal(K.n, 4, 'salvo of at most four');
        K.select('n', 2);
        assert.equal(K.launch(), 'ARM FIRST');
        assert.equal(K.arm(), true);
        K.select('weapon', 'harpoon');
        assert.equal(K.armed, false, 'changing anything disarms');
        K.select('weapon', 'tlam');
        K.arm();
        assert.equal(K.launch(), true);
        assert.deepEqual(launched, [[1, 'tlam', 'M1 BRIDGE', 2]]);
        assert.equal(K.armed, false);
        K.select('target', { ...land, km: 2000 });
        assert.match(K.arm(), /OUT OF RANGE/);
        mason.stock.tlam = 0;
        K.select('target', land);
        assert.match(K.arm(), /EMPTY/);
    });
});

// ═════════════ the TEL's launch panel ═════════════
describe('TEL launch panel (TelPanel)', () => {
    function tel(over = {}) {
        const poses = { jack: [], pad: [], raise: [] };
        let now = 0, missile = true, moving = false;
        const ctx = {
            pose: (g, k) => poses[g].push(k), missile: () => missile, targets: () => [land],
            range: (t) => ({ ok: t.km >= 20 && t.km <= 300, km: t.km, max: 300 }),
            launch: (t) => { missile = false; return { t: t.label }; }, moving: () => moving, now: () => now,
            ...over,
        };
        const p = new FC.TelPanel(ctx);
        const go = (s) => { for (let t = 0; t < s; t += 0.1) { now += 0.1; p.update(0.1); } };
        return { p, go, poses, set moving(v) { moving = v; } };
    }
    test('brake, jacks, table, erect, target, align, arm, launch — and back to driving', () => {
        const T = tel(), { p, go, poses } = T;
        assert.equal(p.canDrive, true);
        assert.match(String(p.jacks(true)), /PARKING BRAKE/);
        T.moving = true;
        assert.match(String(p.setBrake(true)), /STOP THE TRUCK/);
        T.moving = false;
        p.setBrake(true);
        assert.equal(p.canDrive, false);
        assert.match(String(p.table(true)), /JACKS NOT DOWN/);
        assert.equal(p.jacks(true), true);
        go(FC.TEL_TIMES.jack + 0.2);
        assert.equal(p.k.jack, 1);
        assert.match(String(p.erect(true)), /JACKS AND LAUNCH TABLE/);
        p.table(true);
        go(FC.TEL_TIMES.pad + 0.2);
        assert.equal(p.erect(true), true);
        assert.match(String(p.setBrake(false)), /STOW/);
        go(FC.TEL_TIMES.raise / 2);
        assert.equal(p.erected, false, 'erecting takes its time');
        go(FC.TEL_TIMES.raise / 2 + 0.3);
        assert.equal(p.erected, true);
        assert.ok(poses.raise.every((k, i) => i === 0 || k >= poses.raise[i - 1]), 'the erector only rises');
        assert.match(String(p.startAlign()), /TARGET FIRST/);
        p.selectTarget(land);
        assert.equal(p.startAlign(), true);
        assert.match(String(p.arm(true)), /NOT ALIGNED/);
        go(FC.TEL_TIMES.align + 0.2);
        assert.equal(p.align, 1);
        assert.equal(p.ready(), 'NOT ARMED');
        p.arm(true);
        assert.equal(p.ready(), true);
        assert.equal(p.launch(), true);
        assert.notEqual(p.launch(), true, 'no second launch');
        p.startAlign(); go(FC.TEL_TIMES.align + 0.2); p.arm(true);
        assert.equal(p.ready(), 'NO MISSILE', 'the rail is empty');
        // stow in the right order and drive off
        assert.match(String(p.table(false)), /LOWER THE MISSILE/);
        assert.match(String(p.jacks(false)), /LOWER THE MISSILE/);
        p.erect(false);
        go(FC.TEL_TIMES.lower + 0.2);
        p.table(false); go(FC.TEL_TIMES.pad + 0.2);
        p.jacks(false); go(FC.TEL_TIMES.jack + 0.2);
        assert.equal(p.stowed, true);
        assert.equal(p.canDrive, false, 'the brake is still on');
        p.setBrake(false);
        assert.equal(p.canDrive, true);
    });
    test('out of range, no missile: no launch', () => {
        const { p, go } = tel({ missile: () => false });
        p.setBrake(true); p.jacks(true); go(9); p.table(true); go(6);
        assert.match(String(p.erect(true)), /NO MISSILE/);
        const T2 = tel(), q = T2.p;
        q.setBrake(true); q.jacks(true); T2.go(9); q.table(true); T2.go(6); q.erect(true); T2.go(15);
        q.selectTarget({ ...land, km: 480 });
        q.startAlign(); T2.go(7); q.arm(true);
        assert.match(String(q.ready()), /OUT OF RANGE/);
        assert.match(String(q.launch()), /OUT OF RANGE/);
    });
});
