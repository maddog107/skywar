// ═══════════════════════════════════════════════════════════════
// Blast waves you can see: the shock front of a big explosion is a shell of compressed air that bends the light
// through it, so a ring of shimmer races out from the burst at about the speed of sound (fastest at first) and
// fades as it spreads (effects.js starts them: shock(pos, size)). One full-screen pass, only while a front is out:
// each front is a sphere round its burst, projected to a circle on the screen, and the picture is pushed in and out
// across the circle's edge (the derivative of a narrow bell: one side magnified, the other shrunk), most where the
// shell is seen edge-on. Inserted before the cockpit pass (main.js), so the canopy and the instruments stay still.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const SHOCK_MAX = 8;
const SOUND = 343;

const FRAG = /* glsl */`
    uniform sampler2D tColor;
    uniform vec4 shockA[${SHOCK_MAX}];   // view-space centre, radius (m)
    uniform vec4 shockB[${SHOCK_MAX}];   // strength (uv), shell thickness (m), 0, 0
    uniform int count;
    uniform vec2 proj;                   // projectionMatrix [0][0], [1][1]
    uniform float aspect;
    varying vec2 vUv;
    void main() {
        vec2 off = vec2(0.0);
        for (int i = 0; i < ${SHOCK_MAX}; i++) {
            if (i >= count) break;
            vec4 a = shockA[i], b = shockB[i];
            float z = -a.z;
            if (z < 1.0) continue; // (behind the camera, or the camera inside it: nothing to see edge-on)
            vec2 c = vec2(a.x * proj.x, a.y * proj.y) / z * 0.5 + 0.5;
            // the shell's outline (screen units of height) and its thickness there
            float r = a.w / z * proj.y * 0.5, th = max(b.y / z * proj.y * 0.5, 0.002);
            vec2 d = (vUv - c) * vec2(aspect, 1.0);
            float l = length(d);
            if (l < 1e-5) continue;
            float u = (l - r) / th;
            if (abs(u) > 3.0) continue;
            off += d / l * (b.x * u * exp(-u * u)) / vec2(aspect, 1.0);
        }
        gl_FragColor = texture2D(tColor, vUv + off);
    }`;

export class ShockPass extends Pass {
    constructor(camera) {
        super();
        this.camera = camera;
        this.needsSwap = true;
        this.enabled = false;
        this.fronts = [];
        this.mat = new THREE.ShaderMaterial({
            uniforms: {
                tColor: { value: null }, count: { value: 0 }, proj: { value: new THREE.Vector2(1, 1) }, aspect: { value: 1 },
                shockA: { value: Array.from({ length: SHOCK_MAX }, () => new THREE.Vector4()) },
                shockB: { value: Array.from({ length: SHOCK_MAX }, () => new THREE.Vector4()) },
            },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: FRAG,
            depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
        });
        this.quad = new FullScreenQuad(this.mat);
    }

    // a blast of `size` (effects.js explosion sizes: a Mk 82 ~2.2, the MK-84X / MOAB much more) at world `pos`
    add(pos, size) {
        if (this.fronts.length >= SHOCK_MAX) this.fronts.shift();
        const k = Math.cbrt(size);
        // (it reaches out to where the overpressure is a few kPa: tens of metres for a shell, hundreds for a MOAB)
        this.fronts.push({ pos: pos.clone(), t: 0, k, maxR: 70 * k * k, strength: 0.012 * Math.min(k, 2.5) });
    }

    // the radius of a front `t` s after the burst: supersonic at first, settling to the speed of sound
    static radius(t, k) { return SOUND * t + 32 * k * (1 - Math.exp(-t * 9)); }

    update(dt) {
        const F = this.fronts;
        for (let i = F.length - 1; i >= 0; i--) {
            const f = F[i];
            f.t += dt;
            if (ShockPass.radius(f.t, f.k) > f.maxR) F.splice(i, 1);
        }
        this.enabled = F.length > 0;
    }

    // (not clear(): a Pass has a `clear` flag of its own)
    reset() { this.fronts.length = 0; this.enabled = false; }

    render(renderer, writeBuffer, readBuffer) {
        const u = this.mat.uniforms, cam = this.camera, F = this.fronts;
        u.tColor.value = readBuffer.texture;
        const e = cam.projectionMatrix.elements;
        u.proj.value.set(e[0], e[5]);
        u.aspect.value = readBuffer.width / Math.max(1, readBuffer.height);
        let n = 0;
        for (const f of F) {
            if (n >= SHOCK_MAX) break;
            const R = ShockPass.radius(f.t, f.k), fade = 1 - R / f.maxR;
            const v = u.shockA.value[n].set(f.pos.x, f.pos.y, f.pos.z, 1).applyMatrix4(cam.matrixWorldInverse);
            v.w = R;
            // weaker as it spreads (and gone at its reach), the shell thicker
            u.shockB.value[n].set(f.strength * fade / (1 + R / (120 * f.k)), 2.5 + R * 0.05, 0, 0);
            n++;
        }
        u.count.value = n;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() { this.mat.dispose(); this.quad.dispose(); }
}
