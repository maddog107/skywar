// Tiny static file server: `node server.mjs` then open http://localhost:8080
// (and the multiplayer relay at /ws on the same port: relay.mjs, docs/MULTIPLAYER.md)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRelay } from './relay.mjs';

const root = new URL('.', import.meta.url).pathname;
const port = process.env.PORT || 8080;
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/markdown',
};
const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, path === '/' ? 'index.html' : path);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try {
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
    } catch {
        res.writeHead(404); res.end('Not found');
    }
});
// multiplayer (docs/MULTIPLAYER.md): the relay answers WebSocket upgrades at /ws on the same port
createRelay({ path: '/ws', ...(process.env.ALLOWED_ORIGINS ? { origins: process.env.ALLOWED_ORIGINS.split(',') } : {}) }).attach(server);
server.listen(port, () => console.log(`SKYWAR running at http://localhost:${port}`));
