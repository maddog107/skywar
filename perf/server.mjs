// Dev-only: the game's static server plus `Document-Policy: js-profiling`, so perf/harness.js can use the
// JS Self-Profiling API (sampled call stacks) in the page.  PORT=8122 node perf/server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const port = process.env.PORT || 8080;
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/markdown',
};
// BASE=/some/dir also serves that directory (e.g. an older snapshot of the game) under /base/, same origin
const base = process.env.BASE ? normalize(process.env.BASE + '/') : null;
http.createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let dir = root;
    if (base && path.startsWith('/base/')) { dir = base; path = path.slice(5); }
    const file = join(dir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    try {
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Document-Policy': 'js-profiling' });
        res.end(data);
    } catch {
        res.writeHead(404); res.end('Not found');
    }
}).listen(port, () => console.log(`SKYWAR (profiling) at http://localhost:${port}`));
