// ═══════════════════════════════════════════════════════════════
// Terrain shadow core: the height of the terrain's shadow on the sun over a height grid — plain arrays, no three.js,
// so the terrain-shadow worker (terrainshadowworker.js) and the tests use the same code.
//
// For a sun at elevation e (tan e = t) and a horizontal direction d toward it, the shadow top over a point p is
//     S(p) = max over r > 0 of  H(p + r d) − r t
// the highest point of the shadow volume the terrain upsun of p casts over it: anything at p below S(p) is in the
// terrain's shadow, anything above it sees the sun's centre. (A horizon map stores the horizon angle per direction
// (Max 1988; Sloan & Cohen 2000; Timonen & Westerholm 2010 sweep it along lines); for one sun direction the shadow
// top is the cheaper equivalent, and it also holds for points above the ground: jets, buildings, trees.)
// It follows a recursion along the sun's direction, one step of length L upsun at a time:
//     S(p) = max(H(q), S(q)) − L t,  q = p + L d
// so one sweep over the grid, from the sun side, costs a couple of operations per texel (the upsun point falls
// between two texels of the previous line: linear interpolation). D is the distance to the point that sets S,
// which gives the penumbra: the sun's disc (0.53°) spans D × tan(0.27°) of height either side of S.
// ═══════════════════════════════════════════════════════════════

export const NO_SHADOW = -1e4; // shadow top where nothing upsun is known (below any ground)

// heights on the grid: H[j * N + i] = heightAt(x0 + i * cell, z0 + j * cell)
export function sampleHeights(heightAt, x0, z0, cell, N, out = new Float32Array(N * N)) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out[j * N + i] = heightAt(x0 + i * cell, z0 + j * cell);
    return out;
}

// The sweep. H: N×N heights (cell metres apart); (dx, dz): horizontal unit vector toward the sun; tanEl: tangent of
// its elevation. Fills S (shadow top, m) and D (horizontal distance to what casts it, m) per texel.
export function sweepShadow(H, N, cell, dx, dz, tanEl, S, D) {
    const ax = Math.abs(dx), az = Math.abs(dz);
    const xMajor = ax >= az, major = Math.max(xMajor ? ax : az, 1e-6);
    const step = cell / major;                  // horizontal distance from one line to the next, along d
    const drop = step * Math.max(tanEl, 0);     // how far the shadow top falls over it
    const f = (xMajor ? dz : dx) / major;       // the upsun point's offset along the line (texels), -1..1
    const toward = (xMajor ? dx : dz) >= 0 ? 1 : -1;
    let pS = new Float32Array(N), pD = new Float32Array(N), cS = new Float32Array(N), cD = new Float32Array(N);
    for (let l = 0; l < N; l++) {
        const m = toward > 0 ? N - 1 - l : l;   // the line's index along the major axis, from the sun side
        for (let n = 0; n < N; n++) {
            const k = xMajor ? n * N + m : m * N + n;
            let s = NO_SHADOW, dd = 0;
            if (l > 0) {
                const q = n + f;
                if (q >= 0 && q <= N - 1) {
                    const q0 = Math.min(Math.floor(q), N - 2), t = q - q0;
                    s = pS[q0] + (pS[q0 + 1] - pS[q0]) * t - drop;
                    dd = pD[q0] + (pD[q0 + 1] - pD[q0]) * t + step;
                }
            }
            S[k] = s; D[k] = dd;
            // what this texel hands on upsun-to-downsun: its own ground if that's higher than the shadow over it
            const h = H[k];
            if (h >= s) { cS[n] = h; cD[n] = 0; } else { cS[n] = s; cD[n] = dd; }
        }
        let t = pS; pS = cS; cS = t;
        t = pD; pD = cD; cD = t;
    }
}

// bilinear S and D at world (x, z) on a grid whose texel (i, j) sits at (x0 + i cell, z0 + j cell); out = [S, D]
export function shadowAt(S, D, N, x0, z0, cell, x, z, out = [0, 0]) {
    const fx = Math.min(Math.max((x - x0) / cell, 0), N - 1.0001), fz = Math.min(Math.max((z - z0) / cell, 0), N - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, k = j * N + i;
    const bl = (A) => (A[k] * (1 - a) + A[k + 1] * a) * (1 - b) + (A[k + N] * (1 - a) + A[k + N + 1] * a) * b;
    out[0] = bl(S); out[1] = bl(D);
    return out;
}

// sunlight at height y under shadow top s cast from distance d (0 shadow .. 1 lit): the sun's disc sets the
// penumbra (tanR: tangent of its angular radius), never narrower than pwMin (the grid's own blur)
export function terrainVisibility(y, s, d, tanR, pwMin) {
    const pw = Math.max(d * tanR, pwMin);
    const t = Math.min(Math.max((y - s + pw) / (2 * pw), 0), 1);
    return t * t * (3 - 2 * t);
}

// float -> IEEE half (round to nearest), for the texture the worker hands back
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function toHalf(v) {
    _f[0] = v;
    const x = _u[0], sign = (x >>> 16) & 0x8000;
    let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
    if (e >= 31) return sign | 0x7bff;            // clamp to the largest finite half
    if (e <= 0) {
        if (e < -10) return sign;
        m = (m | 0x800000) >>> (1 - e);
        return sign | ((m + 0x1000) >>> 13);
    }
    const h = sign | (e << 10) | (m >>> 13);
    return (m & 0x1000) ? h + 1 : h;
}
