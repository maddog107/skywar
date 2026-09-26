// Dev tool for the preview harness (preview.js save()): POST a data: URL to http://localhost:8117/?name=<file>
// and it is written under OUT (default ./shots next to this file). `PORT=8117 OUT=/tmp/x node tools/aircraft/upload.mjs`
// Only pages served from localhost may use it (other sites can't write files through it), only images are
// accepted, and every file lands inside OUT.
import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const OUT = resolve(process.env.OUT || new URL('./shots/', import.meta.url).pathname);
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX = 64 * 1024 * 1024;

http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (origin && !LOCAL.test(origin)) { res.writeHead(403); return res.end('forbidden origin'); }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const name = new URL(req.url, 'http://x').searchParams.get('name') || 'out.png';
    const file = resolve(OUT, name);
    if (!file.startsWith(OUT + sep) || !/\.(png|jpe?g|webp)$/i.test(file)) { res.writeHead(400); return res.end('bad name'); }
    let body = '';
    for await (const c of req) { body += c; if (body.length > MAX) { res.writeHead(413); return res.end(); } }
    const m = /^data:image\/(png|jpeg|webp);base64,/.exec(body);
    if (!m) { res.writeHead(400); return res.end('expected an image data: URL'); }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(body.slice(m[0].length), 'base64'));
    res.end('ok ' + file);
}).listen(process.env.PORT || 8117, 'localhost', () => console.log('upload server on', process.env.PORT || 8117, '→', OUT));
