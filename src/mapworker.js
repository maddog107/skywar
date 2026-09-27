// ═══════════════════════════════════════════════════════════════
// Map worker: paints the tactical map's background (tacmap.js, maptiles.js) off the main thread — land cover from
// the terrain's own colours, hill shading from the height field, and the sea by depth.
// Message in:  { size, x0, z0, span }  (world square: x0..x0+span, z0..z0+span; north (−z) up)
//              { tile: true, key, size, x0, z0, span, level } a close-zoom tile: the terrain is sampled on a
//              31-62 m grid and interpolated (bicubic heights: a crisp coastline and smooth shading), with contour
//              lines every 100 m … 10 m by level
// Message out: { …the message, pixels } (RGBA, transferred), or { …, bitmap } for a tile (an ImageBitmap)
// ═══════════════════════════════════════════════════════════════
import { terrainHeight, colorAt } from './terraincore.js';

// light from the north-west, a map maker's convention
const LX = -0.55, LY = 0.6, LZ = -0.58;

function landShade(x, z, h, nx, nz, out, o) {
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz), ny = inv;
    const col = landShade.col || (landShade.col = new Float32Array(3));
    colorAt(x, h, z, ny, col, 0);
    const shade = Math.max(0.35, (nx * inv * LX + ny * LY + nz * inv * LZ) * 1.25 + 0.2);
    let r = Math.sqrt(col[0]) * shade, g = Math.sqrt(col[1]) * shade, b = Math.sqrt(col[2]) * shade;
    // desaturate a touch (a map, not a photo)
    const l = (r + g + b) / 3;
    out[o] = r * 0.8 + l * 0.2; out[o + 1] = g * 0.8 + l * 0.2; out[o + 2] = b * 0.8 + l * 0.2;
}

function water(h, out, o) {
    // shallow turquoise over sand to deep navy
    const d = Math.min(1, -h / 120);
    let r = 0.18 * (1 - d) + 0.05 * d, g = 0.42 * (1 - d) + 0.11 * d, b = 0.5 * (1 - d) + 0.22 * d;
    if (h > -4) { r += 0.08; g += 0.1; b += 0.06; } // the surf line
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
}

function paint({ size, x0, z0, span }) {
    const px = new Uint8ClampedArray(size * size * 4);
    const step = span / size;
    const H = new Float32Array((size + 1) * (size + 1));
    for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) H[j * (size + 1) + i] = terrainHeight(x0 + i * step, z0 + j * step);
    const c = new Float32Array(3);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const h = H[j * (size + 1) + i];
            if (h < 0) water(h, c, 0);
            else {
                const hx = H[j * (size + 1) + i + 1] - h, hz = H[(j + 1) * (size + 1) + i] - h;
                landShade(x0 + i * step, z0 + j * step, h, -hx / step, -hz / step, c, 0);
            }
            const o = (j * size + i) * 4;
            px[o] = c[0] * 255; px[o + 1] = c[1] * 255; px[o + 2] = c[2] * 255; px[o + 3] = 255;
        }
    }
    return px;
}

// Catmull-Rom weights
function cr(t, w) {
    const t2 = t * t, t3 = t2 * t;
    w[0] = -0.5 * t3 + t2 - 0.5 * t; w[1] = 1.5 * t3 - 2.5 * t2 + 1; w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t; w[3] = 0.5 * t3 - 0.5 * t2;
}

function paintTile({ size, x0, z0, span, level }) {
    const step = level <= 1 ? 62.5 : 31.25;
    const N = Math.ceil(span / step) + 1, M = N + 4, B = 2; // coarse points edge to edge, plus a border of two
    const H = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) H[j * M + i] = terrainHeight(x0 + (i - B) * step, z0 + (j - B) * step);
    // land colour and shading at the coarse points
    const C = new Float32Array(M * M * 3);
    for (let j = 1; j < M - 1; j++) for (let i = 1; i < M - 1; i++) {
        const k = j * M + i, h = H[k];
        const nx = -(H[k + 1] - H[k - 1]) / (2 * step), nz = -(H[k + M] - H[k - M]) / (2 * step);
        landShade(x0 + (i - B) * step, z0 + (j - B) * step, Math.max(h, 0), nx, nz, C, k * 3);
    }
    const px = new Uint8ClampedArray(size * size * 4);
    const hp = new Float32Array(size * size);
    const wx = new Float32Array(4), wz = new Float32Array(4), c = new Float32Array(3);
    const mpp = span / size;
    for (let y = 0; y < size; y++) {
        const fz = (y + 0.5) * mpp / step + B, j = Math.floor(fz), tz = fz - j;
        cr(tz, wz);
        for (let x = 0; x < size; x++) {
            const fx = (x + 0.5) * mpp / step + B, i = Math.floor(fx), tx = fx - i;
            cr(tx, wx);
            let h = 0;
            for (let b = 0; b < 4; b++) {
                const row = (j - 1 + b) * M + i - 1;
                h += wz[b] * (wx[0] * H[row] + wx[1] * H[row + 1] + wx[2] * H[row + 2] + wx[3] * H[row + 3]);
            }
            hp[y * size + x] = h;
            if (h < 0) water(h, c, 0);
            else {
                const k = (j * M + i) * 3, k2 = k + M * 3;
                for (let q = 0; q < 3; q++) c[q] = (C[k + q] * (1 - tx) + C[k + 3 + q] * tx) * (1 - tz) + (C[k2 + q] * (1 - tx) + C[k2 + 3 + q] * tx) * tz;
            }
            const o = (y * size + x) * 4;
            px[o] = c[0] * 255; px[o + 1] = c[1] * 255; px[o + 2] = c[2] * 255; px[o + 3] = 255;
        }
    }
    // contour lines (an index contour every fifth, darker) and the coastline
    const ci = level <= 1 ? 100 : level === 2 ? 50 : level === 3 ? 20 : 10;
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const h = hp[y * size + x], hr = hp[y * size + x + 1], hd = hp[(y + 1) * size + x];
        const o = (y * size + x) * 4;
        if ((h < 0) !== (hr < 0) || (h < 0) !== (hd < 0)) { px[o] *= 0.55; px[o + 1] *= 0.6; px[o + 2] *= 0.62; continue; }
        if (h < 0) continue;
        const a = Math.floor(h / ci), br = Math.floor(hr / ci), bd = Math.floor(hd / ci);
        if (a === br && a === bd) continue;
        const major = Math.max(a, br, bd) % 5 === 0;
        const k = major ? 0.62 : 0.8;
        px[o] *= k; px[o + 1] *= k * 0.98; px[o + 2] *= k * 0.94;
    }
    return px;
}

async function onMessage(e) {
    const m = e.data;
    if (m.tile) {
        const pixels = paintTile(m);
        if (typeof createImageBitmap === 'function' && typeof ImageData === 'function') {
            try {
                const bitmap = await createImageBitmap(new ImageData(pixels, m.size, m.size));
                self.postMessage({ ...m, bitmap }, [bitmap]);
                return;
            } catch (err) { /* fall back to the pixels */ }
        }
        self.postMessage({ ...m, pixels }, [pixels.buffer]);
        return;
    }
    const pixels = paint(m);
    self.postMessage({ ...m, pixels }, [pixels.buffer]);
}
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = onMessage;
