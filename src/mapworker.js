// ═══════════════════════════════════════════════════════════════
// Map worker: paints the tactical map's background (tacmap.js) off the main thread — land cover from the
// terrain's own colours, hill shading from the height field, and the sea by depth.
// Message in:  { size, x0, z0, span }  (world square: x0..x0+span, z0..z0+span; north (−z) up)
// Message out: { size, x0, z0, span, pixels } (RGBA, transferred)
// ═══════════════════════════════════════════════════════════════
import { terrainHeight, colorAt } from './terraincore.js';

function paint({ size, x0, z0, span }) {
    const px = new Uint8ClampedArray(size * size * 4);
    const step = span / size;
    const H = new Float32Array((size + 1) * (size + 1));
    for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) H[j * (size + 1) + i] = terrainHeight(x0 + i * step, z0 + j * step);
    const col = new Float32Array(3);
    // light from the north-west, a map maker's convention
    const lx = -0.55, ly = 0.6, lz = -0.58;
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const h = H[j * (size + 1) + i];
            const hx = H[j * (size + 1) + i + 1] - h, hz = H[(j + 1) * (size + 1) + i] - h;
            let r, g, b;
            if (h < 0) {
                // water: shallow turquoise over sand to deep navy
                const d = Math.min(1, -h / 120);
                r = 0.18 * (1 - d) + 0.05 * d; g = 0.42 * (1 - d) + 0.11 * d; b = 0.5 * (1 - d) + 0.22 * d;
                if (h > -4) { r += 0.08; g += 0.1; b += 0.06; } // the surf line
            } else {
                // normal from the height steps, lambert shading with a floor
                const nx = -hx / step, nz = -hz / step, inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
                const ny = inv;
                colorAt(x0 + i * step, h, z0 + j * step, ny, col, 0);
                const shade = Math.max(0.35, (nx * inv * lx + ny * ly + nz * inv * lz) * 1.25 + 0.2);
                r = Math.sqrt(col[0]) * shade; g = Math.sqrt(col[1]) * shade; b = Math.sqrt(col[2]) * shade;
                // desaturate a touch (a map, not a photo)
                const l = (r + g + b) / 3;
                r = r * 0.8 + l * 0.2; g = g * 0.8 + l * 0.2; b = b * 0.8 + l * 0.2;
            }
            const o = (j * size + i) * 4;
            px[o] = r * 255; px[o + 1] = g * 255; px[o + 2] = b * 255; px[o + 3] = 255;
        }
    }
    return px;
}

function onMessage(e) {
    const m = e.data;
    const pixels = paint(m);
    self.postMessage({ ...m, pixels }, [pixels.buffer]);
}
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = onMessage;
