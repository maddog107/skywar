import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Night and weather (firelight.js, weather.js, weathersys.js) headless: the fire-light budget and its priorities,
// visibility by weather and fog height, IR locks blocked by cloud (radar not), weather transitions and fronts, the
// sky clock. The clouds are a stub with the same interface as clouds.js (weatherAt / densityAt / fieldU.slab).
const THREE = await import('three');
const FL = await src('firelight.js');
const WX = await src('weather.js');
const { WeatherSystem } = await src('weathersys.js');
const { SKY_FOG } = await src('world.js');

// a camera at `pos` looking along -z (north)
function camera(pos = [0, 100, 0]) {
    const c = new THREE.PerspectiveCamera(60, 16 / 9, 1, 60000);
    c.position.set(...pos);
    c.lookAt(pos[0], pos[1] - 10, pos[2] - 1000);
    c.updateMatrixWorld(); c.updateProjectionMatrix();
    return c;
}

// clouds.js stand-in: a weather map that's `wm` everywhere, cloud of density 1 inside a box
function stubClouds({ wm = [0.2, 0.3, 0, 0.5], box = null } = {}) {
    return {
        ready: true, enabled: true, weatherData: true,
        fieldU: { slab: { value: new THREE.Vector2(800, 3500) } },
        weatherAt: (x, z, out) => { out[0] = wm[0]; out[1] = wm[1]; out[2] = wm[2]; out[3] = wm[3]; return out; },
        densityAt: (p) => box && p.x > box[0] && p.x < box[1] && p.y > box[2] && p.y < box[3] && p.z > box[4] && p.z < box[5] ? 1 : 0,
    };
}
function stubWorld(clouds = stubClouds()) {
    const w = { SKY_FOG, clouds, lightsOn: false, setWeather(k) { w.wx.set(k); }, applySky() {} };
    w.wx = new WX.Weather(w);
    w.wx.groundH = () => 0;
    return w;
}

describe('fire lights: the budget and what gets it', () => {
    test('never more lights than the quality allows; the brightest and nearest first', () => {
        const fl = new FL.FireLights();
        fl.setQuality('medium'); fl.night = 1; fl.ambient = 0.3;
        const cam = camera();
        for (let i = 0; i < 20; i++) fl.flash(new THREE.Vector3((i - 10) * 60, 0, -600 - i * 150), 2000 + i * 10, 5, { merge: 0 });
        const big = fl.flash(new THREE.Vector3(0, 0, -3000), 400000, 5, { merge: 0 });
        fl.update(1 / 60, cam);
        assert.equal(fl.n, FL.FIRE_QUALITY.medium.n, 'the medium budget is full');
        assert.ok(big.sel, 'a huge explosion far off makes the list');
        // the nearest small ones beat the farthest small ones
        const sel = fl.pool.filter(e => e.used && e.sel && e !== big).map(e => -e.pos.z);
        const out = fl.pool.filter(e => e.used && !e.sel && e.kind === 'flash').map(e => -e.pos.z);
        assert.ok(Math.max(...sel) < Math.min(...out), 'every chosen small flash is nearer than every one left out');
        fl.setQuality('ultra'); fl.update(1 / 60, cam);
        assert.equal(fl.n, 21, 'ultra takes all 21');
    });

    test('by day a quarter of the budget; the FLIR sees none; lights behind the camera are skipped', () => {
        const fl = new FL.FireLights();
        fl.setQuality('high'); fl.ambient = 3.3; fl.night = 0;
        const cam = camera();
        for (let i = 0; i < 12; i++) fl.flash(new THREE.Vector3(i * 40, 0, -300), 60000, 5, { merge: 0 });
        fl.flash(new THREE.Vector3(0, 0, 2000), 60000, 5, { merge: 0 }); // behind
        fl.update(1 / 60, cam);
        assert.equal(fl.n, 4, 'day: 16 / 4');
        assert.equal(fl.stats.candidates, 12, 'the one behind the camera isn\'t a candidate');
        fl.off = true; fl.update(1 / 60, cam);
        assert.equal(fl.n, 0, 'the FLIR (off): none');
    });

    test('flashes decay and merge; kept lights die when not refreshed; fires build up heat and die down', () => {
        const fl = new FL.FireLights();
        fl.setQuality('high'); fl.night = 1; fl.ambient = 0.3;
        const cam = camera();
        const p = new THREE.Vector3(0, 0, -500);
        const a = fl.flash(p, 10000, 0.5);
        const b = fl.flash(p.clone().setX(10), 10000, 0.5);
        assert.equal(a, b, 'a flash 10 m away a moment later merges');
        fl.update(0.25, cam);
        assert.ok(a.I < 10000 * 0.3 && a.I > 0, 'decays quadratically');
        fl.update(0.3, cam);
        assert.ok(!a.used, 'gone after its life');
        const key = {};
        fl.keep(key, new THREE.Vector3(0, 50, -400), 14000);
        fl.update(1 / 60, cam);
        assert.equal(fl.n, 1);
        fl.update(0.2, cam);
        assert.equal(fl.n, 0, 'not refreshed: gone');
        // a fire: flames reported every 0.2 s for 4 s
        for (let t = 0; t < 4; t += 0.2) { fl.heat(new THREE.Vector3(5, 0, -300), 4); fl.update(0.2, cam); }
        const I = fl.cand[0] ? fl.cand[0].cur : 0;
        assert.ok(I > 300, 'a burning truck lights up: ' + I.toFixed(0));
        assert.ok(fl.illuminationAt(new THREE.Vector3(5, 0, -310)) > 1, 'lights the ground next to it');
        for (let t = 0; t < 20; t += 0.5) fl.update(0.5, cam);
        assert.equal(fl.cells.size, 0, 'with no more flames the cell cools and goes');
    });

    test('lights near the cloud layer go to the clouds (high), none on medium', () => {
        const fl = new FL.FireLights();
        fl.night = 1; fl.ambient = 0.3; fl.cloudSlab = [1000, 3000];
        const cam = camera([0, 1200, 0]);
        fl.keep('in', new THREE.Vector3(0, 1500, -2000), 40000, { cloud: 1.6 });
        fl.keep('deep', new THREE.Vector3(0, 0, -2000), 3000, { cloud: 1 });   // small and far below: no
        fl.setQuality('high'); fl.update(1 / 60, cam);
        assert.equal(fl.cloud.n, 1, 'the motor in the cloud layer');
        assert.equal(fl.cloud.a[1], 1500);
        fl.keep('in', new THREE.Vector3(0, 1500, -2000), 40000, { cloud: 1.6 }); fl.keep('deep', new THREE.Vector3(0, 0, -2000), 3000);
        fl.setQuality('medium'); fl.update(1 / 60, cam);
        assert.equal(fl.cloud.n, 0);
    });
});

describe('visibility by weather and fog height', () => {
    test('rain: visual range from the rain rate (light ~9 km, heavy ~2 km, a thunderstorm core under 1 km)', () => {
        const V = (R) => WX.visualRange(WX.rainSigma(R));
        assert.ok(V(2.5) > 7000 && V(2.5) < 11000, 'light ' + V(2.5).toFixed(0));
        assert.ok(V(25) > 1400 && V(25) < 2400, 'heavy ' + V(25).toFixed(0));
        assert.ok(V(75) < 1000, 'storm core ' + V(75).toFixed(0));
        assert.equal(WX.rainSigma(0), 0);
    });

    test('ground fog: thick inside, thin looking down from above its top, nothing well above it', () => {
        const D = 0.011, H = 170;
        const inside = WX.groundFogTau(D, H, WX.FOG_W, 50, 50, 1000);
        assert.ok(inside > 8, 'a kilometre across it at 50 m: gone');
        assert.ok(WX.visualRange(D) < 400, 'fog: under 400 m visibility');
        const above = WX.groundFogTau(D, H, WX.FOG_W, 900, 900, 5000);
        assert.ok(above < 1e-6, 'well above the top: clear air');
        const down = WX.groundFogTau(D, H, WX.FOG_W, 600, 0, 1200);
        assert.ok(down > 1 && down < inside, 'looking down into it: through its top ~' + down.toFixed(2));
        // the two ways of calling it agree (a level ray is the limit of a sloping one)
        assert.ok(Math.abs(WX.groundFogTau(D, H, WX.FOG_W, 120, 120.02, 300) - WX.groundFogTau(D, H, WX.FOG_W, 120, 120, 300)) < 1e-3);
    });

    test('the model: fog weather hides a low target, the same one seen from above it; rain and storms cut visibility', () => {
        const w = stubWorld();
        const wx = w.wx;
        wx.set('clear'); wx.update(0.1, camera());
        wx.pushFog(0);
        const low = new THREE.Vector3(0, 30, -3000), eye = new THREE.Vector3(0, 40, 0);
        assert.ok(wx.transmittance(eye, low, { clouds: false }) > 0.3, 'clear midday: seen');
        wx.set('fog'); wx.setHour(7); wx.update(0.1, camera());
        assert.ok(wx.visibilityAt(new THREE.Vector3(0, 30, 0)) < 500, 'in the fog: ' + wx.visibilityAt(new THREE.Vector3(0, 30, 0)).toFixed(0) + ' m');
        assert.ok(wx.visibilityAt(new THREE.Vector3(0, 800, 0)) > 10000, 'above it: clear');
        assert.ok(wx.transmittance(eye, low, { clouds: false }) < 0.01, 'a target 3 km off in the fog is hidden');
        assert.ok(wx.transmittance(new THREE.Vector3(0, 800, -2500), low, { clouds: false }) > wx.transmittance(eye, low, { clouds: false }) * 100, 'looking down through the fog top it shows');
        // rain under the deck, a storm cell
        const wr = stubWorld(stubClouds({ wm: [0.95, 0.95, 1, 0.5] }));
        wr.wx.set('rain'); wr.wx.update(0.1, camera());
        const Vr = wr.wx.visibilityAt(new THREE.Vector3(0, 100, 0));
        wr.wx.set('storm'); wr.wx.update(0.1, camera());
        const Vs = wr.wx.visibilityAt(new THREE.Vector3(0, 100, 0));
        assert.ok(Vs < Vr && Vs < 1500, 'a storm cell (' + Vs.toFixed(0) + ' m) cuts it more than rain (' + Vr.toFixed(0) + ' m)');
        assert.ok(wr.wx.stormAt(0, 0) > 0.8, 'under a cell');
    });

    test('radiation fog forms toward dawn in clear weather and burns off by mid-morning', () => {
        assert.ok(WX.radiationFog(6.5) > 0.9, 'dawn');
        assert.ok(WX.radiationFog(11) === 0, 'late morning');
        assert.ok(WX.radiationFog(15) === 0, 'afternoon');
        const w = stubWorld();
        w.wx.set('clear'); w.wx.setHour(6.5); w.wx.update(0.1, camera());
        assert.ok(WX.WX_FOG.e[0] > 0.005, 'clear dawn: ground fog in the low ground');
        w.wx.setHour(12); w.wx.update(0.1, camera());
        assert.equal(WX.WX_FOG.e[0], 0, 'midday: none');
    });
});

describe('IR locks and radar through weather', () => {
    const game = (clouds) => {
        const world = stubWorld(clouds);
        const g = { world, events: { on() {}, emit() {} }, weapons: null, time: 0, camera: camera() };
        return { g, sys: new WeatherSystem(g) };
    };
    test('no IR line of sight through a cloud; beside it, fine; radar ignores it', () => {
        const { sys } = game(stubClouds({ box: [-300, 300, 1400, 1800, -3500, -2500] }));
        const a = new THREE.Vector3(0, 1600, 0), through = new THREE.Vector3(0, 1600, -6000), beside = new THREE.Vector3(2000, 1600, -6000);
        assert.equal(sys.irClear(a, through), false, 'a 1 km cloud in the way');
        assert.equal(sys.irClear(a, beside), true, 'clear air beside it');
        assert.ok(sys.transmittance(a, through, 'radar') > 0.99, 'the radar sees through the cloud');
        assert.equal(sys.obstruction(a, through), 'CLOUD');
    });
    test('fog blocks an IR lock too; heavy rain dims the radar a little', () => {
        const { g, sys } = game(stubClouds({ wm: [0.95, 0.95, 1, 0.5] }));
        g.world.wx.set('fog'); g.world.wx.setHour(9); g.world.wx.update(0.1, camera());
        assert.equal(sys.irClear(new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, 30, -3000)), false, 'fog');
        g.world.wx.set('storm'); g.world.wx.update(0.1, camera());
        const r = sys.transmittance(new THREE.Vector3(0, 300, 0), new THREE.Vector3(0, 300, -20000), 'radar');
        assert.ok(r < 0.95 && r > 0.3, 'radar through 20 km of a storm cell: ' + r.toFixed(2));
    });
});

describe('weather transitions, fronts and the clock', () => {
    test('set(kind, { transition }) blends everywhere over the time given', () => {
        const w = stubWorld(), wx = w.wx, cam = camera();
        wx.set('clear');
        wx.set('storm', { transition: 60 });
        wx.update(30, cam);
        const mid = wx.local;
        assert.ok(mid.deck > 0.2 && mid.deck < 1.1 && mid.wind > 4 && mid.wind < 17, 'halfway: between clear and storm');
        wx.update(31, cam);
        assert.equal(wx.kind, 'storm');
        assert.equal(wx.tr, null, 'done');
        assert.equal(wx.local.deck, WX.WEATHER_KINDS.storm.deck);
    });

    test('a front moves across: ahead of it the old weather, behind it the new, then it takes over', () => {
        const w = stubWorld(), wx = w.wx, cam = camera([0, 500, 0]);
        wx.set('clear'); wx.update(0.1, cam);
        const f = wx.sendFront('rain', { heading: Math.PI / 2, speed: 20, width: 10000, eta: 600 });
        assert.ok(f.nx > 0.99, 'moving east');
        wx.update(0.1, cam);
        assert.equal(wx.kind, 'clear', 'not here yet');
        assert.ok(wx.paramsAt(-40000, 0, {}).rain > 2.9, 'raining 40 km upwind (behind the line)');
        wx.update(600, cam);
        assert.ok(wx.frontMixAt(cam.position) > 0.4, 'arriving on time');
        wx.update(600, cam);
        assert.equal(wx.kind, 'rain', 'passed over');
        for (let i = 0; i < 6; i++) wx.update(600, cam);
        assert.equal(wx.front, null, 'far past: collapsed');
        assert.equal(wx.A.kind, 'rain');
    });

    test('the sky clock: timeScale runs the hour; the old four times are where they were', () => {
        const w = stubWorld(), wx = w.wx, cam = camera();
        wx.setHour(10); wx.timeScale = 60;
        wx.update(60, cam);
        assert.ok(Math.abs(wx.hour - 11) < 1e-6, 'a minute at ×60 is an hour');
        wx.update(3600 * 13 / 60, cam);
        assert.ok(Math.abs(wx.hour - 0) < 1e-6 || Math.abs(wx.hour - 24) < 1e-6, 'wraps at midnight');
        // the menu's times: the sun where the old fixed times had it
        const d = WX.sunAt(WX.KEY_HOURS.day), da = WX.sunAt(WX.KEY_HOURS.dawn), du = WX.sunAt(WX.KEY_HOURS.dusk);
        assert.ok(Math.abs(d.el - 55) < 1, 'day 55°: ' + d.el.toFixed(1));
        assert.ok(Math.abs(da.el - 6) < 1 && da.az > 80 && da.az < 110, 'dawn low in the east');
        assert.ok(Math.abs(du.el - 3.5) < 1 && du.az > 250 && du.az < 290, 'dusk low in the west');
        assert.equal(WX.timeKeyFor(WX.KEY_HOURS.night), 'night');
        assert.ok(WX.nightOf(WX.KEY_HOURS.night) > 0.99 && WX.nightOf(WX.KEY_HOURS.day) < 0.01);
        // the palettes land exactly on the old ones at those times
        for (const k of ['day', 'dawn', 'dusk', 'night']) {
            const P = WX.paletteAt(WX.KEY_HOURS[k]);
            assert.ok(P.zenith.equals(WX.PALETTES[k].zenith) && Math.abs(P.sunI - WX.PALETTES[k].sunI) < 1e-9, k);
        }
        // and it gets darker continuously through the evening
        let last = -1;
        for (let h = 16; h <= 21; h += 0.25) { const n = WX.nightOf(h); assert.ok(n >= last - 1e-9); last = n; }
    });

    test('turbulence: none in clear air, bumpy in a storm cell, smooth in time', () => {
        const w = stubWorld(stubClouds({ wm: [0.95, 0.95, 1, 0.5] })), wx = w.wx, cam = camera();
        const out = new THREE.Vector3(), p = new THREE.Vector3(0, 800, 0);
        wx.set('clear'); wx.update(0.1, cam);
        let m = 0; for (let t = 0; t < 30; t += 0.1) m = Math.max(m, wx.turbulence(p, t, 1, out).length());
        assert.ok(m < 0.7, 'clear: next to nothing (' + m.toFixed(2) + ')');
        wx.set('storm'); wx.update(0.1, cam);
        m = 0; let jump = 0, prev = null;
        for (let t = 0; t < 30; t += 1 / 60) {
            const v = wx.turbulence(p, t, 1, out).clone();
            m = Math.max(m, v.length());
            if (prev) jump = Math.max(jump, v.distanceTo(prev));
            prev = v;
        }
        assert.ok(m > 2 && m < 9, 'storm cell: ' + m.toFixed(1) + ' m/s² at most');
        assert.ok(jump < 0.6, 'no jolts between frames');
    });
});
