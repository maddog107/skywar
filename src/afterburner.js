// ═══════════════════════════════════════════════════════════════
// Engine exhaust flame (military power → full afterburner).
//
//   const flame = createEngineFlame(rig.nozzleR);   // place it at the nozzle; the plume runs +Z (aft)
//   model.add(flame); flame.position.copy(nozzlePos);
//   flame.update(power, ab, mach, dt, time, camera); // every frame
//   flame.dispose();
//
// Two draws per nozzle:
//  • the plume: a quad along the exhaust axis that turns about it to face the camera, shaded as a
//    soft volume (chord through a round plume, so there are no hard cone edges): a white-blue core,
//    orange-to-violet outer flame with rolling turbulence, and at afterburner a train of shock
//    diamonds (Mach disks) that pulse; length grows with throttle and shortens at high Mach;
//  • a heat glow at the nozzle lip (camera-facing), which is also what you see looking straight up
//    the tailpipe.
// Only the core, the diamonds and the afterburner glow go above 1.0 (the bloom threshold).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const SEG = 28;
let beamGeo = null, glowTex = null;

function beamGeometry() {
    if (beamGeo) return beamGeo;
    const pos = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
        const z = i / SEG;
        pos.push(-1, z, 0, 1, z, 0); // x: across (−1..1), y: along the plume (0 nozzle → 1 tip)
        if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    beamGeo.setIndex(idx);
    beamGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    return beamGeo;
}

function glowTexture() {
    if (glowTex) return glowTex;
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
}

function plumeMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
        // premultiplied: colour adds, alpha dims the background a little
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: {
            camLocal: { value: new THREE.Vector3(0, 0, 10) }, len: { value: 1 }, radius: { value: 1 },
            power: { value: 0 }, ab: { value: 0 }, time: { value: 0 }, seed: { value: Math.random() * 100 },
        },
        vertexShader: /* glsl */`
            uniform vec3 camLocal; uniform float len, radius;
            varying float vZ, vX;
            void main() {
                // a ribbon along +Z that turns about its axis to face the camera
                vec3 p = vec3(0.0, 0.0, position.y * len);
                vec3 toCam = camLocal - p;
                vec3 side = vec3(-toCam.y, toCam.x, 0.0); // cross(+Z, toCam)
                float sl = length(side);
                side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
                p += side * position.x * radius * 1.65;
                vZ = position.y; vX = position.x * 1.65;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
        fragmentShader: /* glsl */`
            uniform float power, ab, time, seed;
            varying float vZ, vX;
            float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float vnoise(vec2 p) {
                vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
                return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
            }
            // chord length through a round plume of radius r at distance x from the axis (soft volume edge)
            float chord(float x, float r) { float q = 1.0 - (x * x) / max(r * r, 1e-4); return q > 0.0 ? sqrt(q) : 0.0; }
            void main() {
                float z = vZ, x = abs(vX);
                // rolling turbulence, stronger toward the tip
                float n = vnoise(vec2(z * 7.0 - time * 11.0, vX * 2.3 + seed)) * 0.65 + vnoise(vec2(z * 17.0 - time * 23.0, vX * 5.0 - seed)) * 0.35;
                float wob = (n - 0.5) * (0.12 + 0.45 * z);
                // outer flame: swells a little past the nozzle, then burns down to a point
                float ro = mix(0.95, mix(1.1, 1.28, ab), smoothstep(0.0, 0.3, z)) * (1.0 - 0.85 * smoothstep(0.45, 1.0, z)) * (1.0 + wob);
                float outer = chord(x, ro) * (1.0 - smoothstep(0.25, 1.0, z)) * (0.65 + 0.7 * n);
                // hot core: a short, narrow white-blue cone out of the nozzle
                float cl = mix(0.22, 0.3, ab);
                float rc = 0.42 * (1.0 - z / cl);
                float core = z < cl ? chord(x, rc) * (1.0 - z / cl) : 0.0;
                // shock diamonds: a chain of lens-shaped bright cells shrinking down the plume (afterburner)
                float sp = 0.1, zd = z - 0.03;
                float k = fract(zd / sp);
                float dw = 0.5 * (1.0 - zd / 0.6) * (1.0 - abs(k * 2.0 - 1.0));
                float dia = (zd > 0.0 && zd < 0.6) ? pow(max(0.0, 1.0 - x / max(dw, 1e-3)), 1.8) * step(x, dw) : 0.0;
                dia *= ab * (1.0 - zd / 0.6) * (0.8 + 0.2 * sin(time * 37.0 + z * 31.0));
                // colours (linear): military power is a faint shimmer, the burner a yellow→orange→violet blaze
                vec3 hot = mix(vec3(0.5, 0.2, 0.05), vec3(1.3, 0.55, 0.08), ab);
                vec3 mid = mix(vec3(0.35, 0.12, 0.04), vec3(1.0, 0.24, 0.03), ab);
                vec3 tip = mix(vec3(0.12, 0.05, 0.06), vec3(0.3, 0.06, 0.22), ab);
                vec3 outerCol = mix(mix(hot, mid, smoothstep(0.08, 0.45, z)), tip, smoothstep(0.45, 0.95, z));
                vec3 coreCol = mix(vec3(0.3, 0.4, 0.85), vec3(1.15, 1.25, 1.7), ab);
                float o = outer * mix(0.4, 1.0, ab);
                vec3 col = outerCol * o + coreCol * core * mix(0.6, 1.25, ab) + vec3(1.9, 1.55, 1.15) * dia * 1.9;
                // the flame partly hides what's behind it, so it keeps its colour against a bright sky
                float occ = clamp(o * 0.62 * ab + core * 0.3, 0.0, 0.85);
                gl_FragColor = vec4(col * power, occ * power);
            }`,
    });
}

const _cam = new THREE.Vector3(), _col = new THREE.Color();
const GLOW_MIL = new THREE.Color(0.55, 0.22, 0.08), GLOW_AB = new THREE.Color(1.4, 0.95, 0.6);

export function createEngineFlame(nozzleRadius = 0.5) {
    const R = nozzleRadius;
    const root = new THREE.Group();
    const mat = plumeMaterial();
    const plume = new THREE.Mesh(beamGeometry(), mat);
    plume.renderOrder = 9;
    plume.frustumCulled = false;
    root.add(plume);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.renderOrder = 9;
    glow.position.z = R * 0.25;
    root.add(glow);
    root.userData.engineFlame = true;
    let p = 0, a = 0;

    // power: 0..1 above idle (military at 1), ab: afterburner on/off, mach: flight Mach number
    root.update = (power, ab, mach, dt, time, camera) => {
        const k = 1 - Math.exp(-10 * dt);
        p += ((power > 0 ? 0.3 + power * 0.7 : 0) - p) * k;
        a += ((ab ? 1 : 0) - a) * (1 - Math.exp(-(ab ? 7 : 4) * dt));
        const on = p > 0.02;
        root.visible = on;
        if (!on) return;
        // the plume stretches with thrust and is squeezed shorter at high speed
        const squeeze = 1 - 0.3 * Math.min(1, Math.max(0, (mach - 0.6) / 1.3));
        const flick = 1 + (Math.random() - 0.5) * 0.08 * (0.3 + a);
        const len = R * (2.2 + p * 4.5 + a * 9) * squeeze * flick;
        const u = mat.uniforms;
        u.len.value = len; u.radius.value = R * (0.95 + a * 0.12);
        u.power.value = p; u.ab.value = a; u.time.value = time;
        if (camera) {
            root.updateWorldMatrix(true, false);
            u.camLocal.value.copy(root.worldToLocal(_cam.copy(camera.position)));
        }
        // nozzle heat glow: dull red-orange at military power, white-hot in burner
        _col.copy(GLOW_MIL).lerp(GLOW_AB, a).multiplyScalar(p * (0.8 + Math.random() * 0.2));
        glow.material.color.copy(_col);
        glow.scale.setScalar(R * (2.0 + a * 1.0));
    };
    root.dispose = () => {
        mat.dispose();
        glow.material.dispose();
        root.parent && root.parent.remove(root);
    };
    return root;
}
