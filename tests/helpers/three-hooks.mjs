// Module-resolution hooks so Node can import the game's src/*.js files, which import three.js
// by bare specifier ('three', 'three/addons/...') through the browser import map in index.html.
//
// 'three'            -> tests/.cache/three@<ver>/build/three.module.js
// 'three/addons/X'   -> tests/.cache/three@<ver>/examples/jsm/X
//
// Files are downloaded from jsDelivr the first time they're needed (synchronously, via curl or a
// child Node process) and cached in tests/.cache (gitignored), so later runs work offline.
// A local node_modules/three is used instead if one exists.
import { registerHooks } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const THREE_VERSION = '0.186.1';
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const localThree = join(repo, 'node_modules', 'three');
const useLocal = existsSync(join(localThree, 'build', 'three.module.js'));
const root = useLocal ? localThree : join(repo, 'tests', '.cache', `three@${THREE_VERSION}`);
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`;

function download(url, dest) {
    mkdirSync(dirname(dest), { recursive: true });
    let body = null;
    try {
        body = execFileSync('curl', ['-fsSL', '--max-time', '60', url], { maxBuffer: 64 << 20 });
    } catch {
        // no curl (or it failed): fetch from a child Node process instead
        const script = 'fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()})' +
            '.then(b=>process.stdout.write(Buffer.from(b))).catch(e=>{console.error(String(e));process.exit(1)})';
        body = execFileSync(process.execPath, ['-e', script, url], { maxBuffer: 64 << 20 });
    }
    // write then rename, so parallel test processes never read a half-written file
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, dest);
}

function ensure(path) {
    if (existsSync(path)) return;
    if (useLocal) throw new Error(`three.js file missing from node_modules: ${path}`);
    const rel = relative(root, path).split(sep).join('/');
    try { download(CDN + rel, path); }
    catch (e) { throw new Error(`Could not fetch ${CDN + rel} (first run needs network; later runs use tests/.cache): ${e.message}`); }
}

registerHooks({
    resolve(specifier, context, next) {
        let path = null;
        if (specifier === 'three') path = join(root, 'build', 'three.module.js');
        else if (specifier.startsWith('three/addons/')) path = join(root, 'examples', 'jsm', specifier.slice('three/addons/'.length));
        else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
            // relative imports between three's own files (./three.core.js, ../utils/...)
            const parent = fileURLToPath(context.parentURL);
            if (parent.startsWith(root + sep)) path = join(dirname(parent), specifier);
        }
        if (path) { ensure(path); return { url: pathToFileURL(path).href, shortCircuit: true, format: 'module' }; }
        return next(specifier, context);
    },
    load(url, context, next) {
        if (url.startsWith('file:')) {
            const p = fileURLToPath(url);
            if (p.startsWith(root + sep)) {
                ensure(p);
                return { format: 'module', source: readFileSync(p, 'utf8'), shortCircuit: true };
            }
        }
        return next(url, context);
    },
});
