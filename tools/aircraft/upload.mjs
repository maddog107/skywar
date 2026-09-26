// Dev tool for the preview harness (preview.js save()): POST a data: URL to http://localhost:8117/?name=<file>
// and it is written under OUT (default ./shots next to this file). `PORT=8117 OUT=/tmp/x node tools/aircraft/upload.mjs`
import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const OUT = process.env.OUT || new URL('./shots/', import.meta.url).pathname;
http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
    const name = new URL(req.url, 'http://x').searchParams.get('name') || 'out.png';
    let body = '';
    for await (const c of req) body += c;
    const b64 = body.slice(body.indexOf(',') + 1);
    const file = join(OUT, name.replace(/\.\./g, ''));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(b64, 'base64'));
    res.end('ok ' + file);
}).listen(process.env.PORT || 8117, () => console.log('upload server on', process.env.PORT || 8117, '→', OUT));
