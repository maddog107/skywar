// Every src/*.js module must import without throwing. Each module is imported in a fresh child
// process: first with no browser globals at all, then (if that fails on document/window) with the
// no-op DOM stub from helpers/dom-stub.mjs. Modules that need the DOM at import time are listed.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './helpers/three-hooks.mjs'; // prime the three.js cache once, before the children run
await import('three');
await import('three/addons/loaders/GLTFLoader.js');

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const child = fileURLToPath(new URL('./helpers/import-one.mjs', import.meta.url));
const modules = readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();

// main.js is the browser entry point: it creates a WebGLRenderer and starts the game on import.
const ENTRY_POINTS = { 'main.js': 'browser entry point (creates a WebGLRenderer at import)' };

const run = (name, dom) => new Promise((resolve) => {
    execFile(process.execPath, [child, name, ...(dom ? ['--dom'] : [])], { timeout: 60000 }, (err, stdout) => {
        try { resolve(JSON.parse(stdout.slice(stdout.lastIndexOf('{"ok"')))); }
        catch { resolve({ ok: false, error: String(err || 'no output') }); }
    });
});

const needsDom = [];
after(() => {
    if (needsDom.length) console.log(`\nModules that touch document/window at import time (load fine with the DOM stub): ${needsDom.join(', ')}\n`);
});

describe('every src module imports', { concurrency: 8 }, () => {
    for (const name of modules) {
        test(name, { skip: ENTRY_POINTS[name] || false }, async () => {
            const bare = await run(name, false);
            if (bare.ok) return;
            assert.match(bare.error, /\b(document|window|navigator|localStorage|requestAnimationFrame)\b/, `import failed:\n${bare.error}\n${bare.stack || ''}`);
            needsDom.push(name);
            const stubbed = await run(name, true);
            assert.ok(stubbed.ok, `import failed even with the DOM stub:\n${stubbed.error}\n${stubbed.stack || ''}`);
        });
    }
});
