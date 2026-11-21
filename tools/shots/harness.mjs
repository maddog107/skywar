// ═══════════════════════════════════════════════════════════════
// Headless screenshot harness: runs the real game in a GPU headless Chromium, with the owner's saved settings left
// alone, the game's own render loop stopped (so frames only advance when the script steps them: screenshots show
// exactly the frame stepped to) and the camera put wherever the script wants it.
//
//   import { open } from '../shots/harness.mjs';              // (or by absolute path from a scratch script)
//   const s = await open({ url: 'http://localhost:8080/', settings: { mode: 'freeflight', weather: 'cloudy' } });
//   await s.camera([0, 300, 0], [0, 320, -1000]);              // position, look-at (world metres); null = the game's
//   await s.step(60);                                          // 60 frames at 1/60 s
//   await s.eval(() => window.skywar.game.effects.megaBlast(...));   // anything, in the page
//   await s.shot('/tmp/out.png');
//   console.log(s.errors);                                     // page errors and console errors so far
//   await s.close();
//
// In the page: window.skywar = { game, world, effects, camera, renderer, post, ... } (main.js), window.skywarStep(n, dt),
// `await import('three')` works inside eval. The player's jet is game.player (pos, vel, quat; spawnAir(pos, heading,
// speedFrac)); park it far away when it's in the way.
// Needs playwright-core: PLAYWRIGHT_CORE=<path to index.mjs>, a local install, or the copy in ~/git/flight-tool.
// One browser at a time, and close it when done: the machine's memory is shared.
// ═══════════════════════════════════════════════════════════════
import { homedir } from 'node:os';

async function loadPlaywright() {
    const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright', `${homedir()}/git/flight-tool/node_modules/playwright-core/index.mjs`].filter(Boolean);
    for (const t of tries) { try { const m = await import(t); if (m.chromium || (m.default && m.default.chromium)) return m.chromium || m.default.chromium; } catch (e) { /* next */ } }
    throw new Error('playwright-core not found: set PLAYWRIGHT_CORE to its index.mjs');
}

const DEFAULTS = { mode: 'freeflight', aircraft: 'f16', start: 'air', quality: 'high', time: 'day', weather: 'clear', unlockAll: true, controlMode: 'keyboard', dynRes: false };

// opts: url, settings (the menu's own settings keys, over DEFAULTS), size [w, h], launch (false: stop at the menu),
// hud (true: leave the HUD on), browser (reuse one from a previous open: s.browser)
export async function open(opts = {}) {
    const { url = 'http://localhost:8080/', settings = {}, size = [1280, 720], launch = true, hud = false } = opts;
    const chromium = opts.browser ? null : await loadPlaywright();
    const browser = opts.browser || await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    const context = await browser.newContext({ viewport: { width: size[0], height: size[1] } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + String(e.stack || '').split('\n').slice(0, 4).join('\n')));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript((S) => {
        // the menu reads these settings; nothing is ever written (the owner's saved settings are left alone)
        const gi = Storage.prototype.getItem;
        Storage.prototype.getItem = function (k) { return k === 'skywar.settings' ? JSON.stringify(S) : gi.call(this, k); };
        Storage.prototype.setItem = () => {};
        // the game's own loop stops once __freeze is set: frames then advance only through skywarStep
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => (window.__freeze ? 0 : raf(cb));
    }, { ...DEFAULTS, ...settings });
    await page.goto(url);
    await page.waitForSelector('#menu.show', { timeout: 180000 });
    const s = {
        browser, context, page, errors,
        eval: (fn, arg) => page.evaluate(fn, arg),
        step: (n = 60, dt = 1 / 60) => page.evaluate(([n, dt]) => window.skywarStep(n, dt), [n, dt]),
        shot: (path, o = {}) => page.screenshot({ path, ...o }),
        // camera(pos, at, fov): hold the camera there from now on (after the game's own camera code each frame);
        // camera(null): back to the game's camera
        camera: (pos, at, fov = 55) => page.evaluate(([pos, at, fov]) => {
            const g = window.skywar.game;
            window.__cam = pos ? { pos, at, fov } : null;
            if (!window.__camHooked) {
                window.__camHooked = true;
                const orig = g.updateCamera.bind(g);
                g.updateCamera = (dt, m) => {
                    orig(dt, m);
                    const c = window.__cam;
                    if (!c) return;
                    const cam = g.camera;
                    cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(...c.at);
                    cam.fov = c.fov; cam.updateProjectionMatrix();
                    g.shake = 0;
                    if (g.cockpit) g.cockpit.enabled = false;
                };
            }
        }, [pos, at, fov]),
        close: async () => { await context.close(); if (!opts.browser) await browser.close(); },
    };
    if (launch) {
        await page.click('#launchBtn');
        await page.waitForFunction(() => window.skywar && window.skywar.game && window.skywar.game.state === 'playing', null, { timeout: 180000 });
        await page.evaluate((hud) => {
            window.__freeze = true;
            if (!hud) { window.skywar.game.hideHud = true; const c = document.getElementById('clickToFly'); if (c) c.style.display = 'none'; }
        }, hud);
        await s.step(30);
    }
    return s;
}

// run directly: one screenshot of a mode, e.g.
//   node tools/shots/harness.mjs out.png '{"mode":"dogfight","weather":"storm"}' [url] [frames]
if (import.meta.url === `file://${process.argv[1]}`) {
    const [out = 'shot.png', json = '{}', url = 'http://localhost:8080/', frames = '120'] = process.argv.slice(2);
    const s = await open({ url, settings: JSON.parse(json), hud: true });
    await s.step(+frames);
    await s.shot(out);
    console.log(out, s.errors.length ? s.errors : 'no errors');
    await s.close();
}
