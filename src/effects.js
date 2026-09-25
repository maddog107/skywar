// ═══════════════════════════════════════════════════════════════
// Effects: instanced particle systems, ribbon trails, tracers, explosions, debris
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { rand, clamp, makeRadialTexture } from './util.js';

// ── Instanced billboard particle system ──
class ParticleSystem {
    constructor(scene, max, { additive = false, texture, renderOrder = 6 } = {}) {
        this.max = max;
        this.count = 0;
        // state (struct-of-arrays)
        this.p = new Float32Array(max * 3);
        this.v = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.maxLife = new Float32Array(max);
        this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
        this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
        this.a0 = new Float32Array(max); this.a1 = new Float32Array(max);
        this.drag = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.rot = new Float32Array(max); this.rotV = new Float32Array(max);

        const base = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.setAttribute('position', base.attributes.position);
        geo.setAttribute('uv', base.attributes.uv);
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('iPos', this.aPos);
        geo.setAttribute('iCol', this.aCol);
        geo.setAttribute('iSize', this.aSize);
        geo.instanceCount = 0;
        this.geo = geo;

        this.mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            uniforms: { map: { value: texture }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 }, additive: { value: additive ? 1 : 0 } },
            vertexShader: /* glsl */`
                attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSize;
                varying vec2 vUv; varying vec4 vCol; varying float vDist;
                void main() {
                    vec4 mv = viewMatrix * vec4(iPos, 1.0);
                    float c = cos(iSize.y), s = sin(iSize.y);
                    vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
                    mv.xy += q * iSize.x;
                    vUv = uv; vCol = iCol; vDist = -mv.z;
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: /* glsl */`
                uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity, additive;
                varying vec2 vUv; varying vec4 vCol; varying float vDist;
                void main() {
                    vec4 t = texture2D(map, vUv);
                    float a = t.a * vCol.a;
                    if (a < 0.003) discard;
                    vec3 col = vCol.rgb * mix(vec3(1.0), t.rgb, 0.6);
                    float fogF = 1.0 - exp(-pow(fogDensity * vDist, 2.0));
                    if (additive > 0.5) { col *= (1.0 - fogF); }
                    else { col = mix(col, fogColor, fogF); }
                    gl_FragColor = vec4(col, a);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = renderOrder;
        scene.add(this.mesh);
    }

    emit(pos, vel, life, size0, size1, col0, col1, alpha0, alpha1, drag = 0.5, grav = 0) {
        if (this.count >= this.max) return;
        const i = this.count++;
        const i3 = i * 3;
        this.p[i3] = pos.x; this.p[i3 + 1] = pos.y; this.p[i3 + 2] = pos.z;
        this.v[i3] = vel.x; this.v[i3 + 1] = vel.y; this.v[i3 + 2] = vel.z;
        this.life[i] = this.maxLife[i] = life;
        this.s0[i] = size0; this.s1[i] = size1;
        this.c0[i3] = col0[0]; this.c0[i3 + 1] = col0[1]; this.c0[i3 + 2] = col0[2];
        this.c1[i3] = col1[0]; this.c1[i3 + 1] = col1[1]; this.c1[i3 + 2] = col1[2];
        this.a0[i] = alpha0; this.a1[i] = alpha1;
        this.drag[i] = drag; this.grav[i] = grav;
        this.rot[i] = Math.random() * 6.28; this.rotV[i] = (Math.random() - 0.5) * 1.5;
    }

    kill(i) {
        const j = --this.count;
        if (i === j) return;
        const i3 = i * 3, j3 = j * 3;
        for (let k = 0; k < 3; k++) {
            this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k];
            this.c0[i3 + k] = this.c0[j3 + k]; this.c1[i3 + k] = this.c1[j3 + k];
        }
        this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
        this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
        this.a0[i] = this.a0[j]; this.a1[i] = this.a1[j];
        this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
        this.rot[i] = this.rot[j]; this.rotV[i] = this.rotV[j];
    }

    update(dt, fog) {
        const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array;
        for (let i = this.count - 1; i >= 0; i--) {
            this.life[i] -= dt;
            if (this.life[i] <= 0) this.kill(i);
        }
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const d = Math.exp(-this.drag[i] * dt);
            this.v[i3] *= d; this.v[i3 + 1] = this.v[i3 + 1] * d + this.grav[i] * dt; this.v[i3 + 2] *= d;
            this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
            this.rot[i] += this.rotV[i] * dt;
            const t = 1 - this.life[i] / this.maxLife[i];
            const te = 1 - (1 - t) * (1 - t); // ease-out for size
            P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
            C[i * 4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
            C[i * 4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
            C[i * 4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
            // quick fade-in over first 8% of life avoids popping
            C[i * 4 + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * t) * clamp(t * 12.5, 0, 1);
            S[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * te;
            S[i * 2 + 1] = this.rot[i];
        }
        this.geo.instanceCount = this.count;
        this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
        this.aPos.clearUpdateRanges?.(); this.aCol.clearUpdateRanges?.(); this.aSize.clearUpdateRanges?.();
        this.aPos.addUpdateRange?.(0, this.count * 3);
        this.aCol.addUpdateRange?.(0, this.count * 4);
        this.aSize.addUpdateRange?.(0, this.count * 2);
        this.mat.uniforms.fogColor.value.copy(fog.color);
        this.mat.uniforms.fogDensity.value = fog.density;
    }

    clear() { this.count = 0; this.geo.instanceCount = 0; }
}

// ── Ribbon trail (missile smoke, wingtip vortices) ──
export class Trail {
    constructor(effects, { max = 120, width = 2, life = 4, color = [1, 1, 1], alpha = 0.6, additive = false, minDist = 6, widthGrow = 3 }) {
        this.fx = effects;
        this.max = max; this.width = width; this.lifeTime = life; this.alpha = alpha; this.minDist = minDist; this.widthGrow = widthGrow;
        this.pts = []; // {p: Vector3, t: birthTime}
        this.alive = true; this.emitting = true;
        const geo = new THREE.BufferGeometry();
        this.posArr = new Float32Array(max * 2 * 3);
        this.alphaArr = new Float32Array(max * 2);
        geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
        const idx = [];
        for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        geo.setIndex(idx);
        this.geo = geo;
        this.mesh = new THREE.Mesh(geo, effects.trailMaterial(color, additive));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 7;
        effects.scene.add(this.mesh);
    }

    push(pos, now) {
        const last = this.pts[this.pts.length - 1];
        if (last && last.p.distanceToSquared(pos) < this.minDist * this.minDist) {
            // keep the head glued to the emitter
            if (this.pts.length > 1) last.p.copy(pos);
            return;
        }
        if (this.pts.length >= this.max) this.pts.shift();
        this.pts.push({ p: pos.clone(), t: now });
    }

    update(now, camPos) {
        while (this.pts.length && now - this.pts[0].t > this.lifeTime) this.pts.shift();
        const n = this.pts.length;
        if (!this.emitting && n < 2) { this.alive = false; return; }
        const side = this.fx._v1, tan = this.fx._v2, toCam = this.fx._v3;
        for (let i = 0; i < n; i++) {
            const cur = this.pts[i].p;
            const nxt = this.pts[Math.min(i + 1, n - 1)].p, prv = this.pts[Math.max(i - 1, 0)].p;
            tan.subVectors(nxt, prv);
            if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1);
            toCam.subVectors(camPos, cur);
            side.crossVectors(tan, toCam).normalize();
            const age = (now - this.pts[i].t) / this.lifeTime;
            const w = this.width * (1 + age * this.widthGrow);
            const k = i * 6;
            this.posArr[k] = cur.x + side.x * w; this.posArr[k + 1] = cur.y + side.y * w; this.posArr[k + 2] = cur.z + side.z * w;
            this.posArr[k + 3] = cur.x - side.x * w; this.posArr[k + 4] = cur.y - side.y * w; this.posArr[k + 5] = cur.z - side.z * w;
            // fade at the tail end and very near the head
            const headFade = clamp((n - 1 - i) / 3, 0, 1);
            const a = this.alpha * (1 - age) * (1 - age) * headFade;
            this.alphaArr[i * 2] = this.alphaArr[i * 2 + 1] = a;
        }
        this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
        this.geo.attributes.position.needsUpdate = true;
        this.geo.attributes.alpha.needsUpdate = true;
    }

    dispose() {
        this.fx.scene.remove(this.mesh);
        this.geo.dispose();
        this.alive = false;
    }
}

// ═══════════════════════════════════════════════════════════════
export class Effects {
    constructor(scene) {
        this.scene = scene;
        this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
        this._tmpV = new THREE.Vector3(); this._tmpP = new THREE.Vector3();
        this.now = 0;

        const smokeTex = this.makeSmokeTexture();
        const fireTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.75)'], [0.7, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
        this.smoke = new ParticleSystem(scene, 9000, { additive: false, texture: smokeTex, renderOrder: 6 });
        this.fire = new ParticleSystem(scene, 5000, { additive: true, texture: fireTex, renderOrder: 8 });
        // fireballs blend normally: dozens of overlapping additive puffs just sum to a white disc
        this.flame = new ParticleSystem(scene, 3000, { additive: false, texture: fireTex, renderOrder: 7 });

        this.trails = [];
        this.trailMats = new Map();
        this.debris = [];
        this.debrisGeo = [new THREE.BoxGeometry(1.2, 0.3, 2), new THREE.TetrahedronGeometry(1), new THREE.BoxGeometry(2.5, 0.2, 1)];
        this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8, metalness: 0.3 });

        // Tracers: camera-facing glowing streaks, one draw call
        this.maxTracers = 2500;
        const tg = new THREE.BufferGeometry();
        this.tracerPos = new Float32Array(this.maxTracers * 4 * 3);
        this.tracerCol = new Float32Array(this.maxTracers * 4 * 3);
        const tIdx = new Uint32Array(this.maxTracers * 6);
        for (let i = 0; i < this.maxTracers; i++) {
            const v = i * 4, k = i * 6;
            tIdx[k] = v; tIdx[k + 1] = v + 1; tIdx[k + 2] = v + 2; tIdx[k + 3] = v + 1; tIdx[k + 4] = v + 3; tIdx[k + 5] = v + 2;
        }
        tg.setIndex(new THREE.BufferAttribute(tIdx, 1));
        tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
        tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
        this.tracers = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        this.tracers.frustumCulled = false;
        this.tracers.renderOrder = 9;
        scene.add(this.tracers);

        // Pooled flash lights — fixed count so shaders never recompile mid-game
        this.lights = [];
        for (let i = 0; i < 3; i++) {
            const l = new THREE.PointLight(0xff8840, 0, 600, 1.6);
            l.userData.life = 0;
            scene.add(l);
            this.lights.push(l);
        }
        // Big additive flash sprites
        this.flashMat = new THREE.SpriteMaterial({ map: fireTex, color: 0xffd8a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
        this.flashes = [];
    }

    trailMaterial(color, additive) {
        const key = color.join(',') + additive;
        if (this.trailMats.has(key)) return this.trailMats.get(key);
        const m = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            uniforms: { color: { value: new THREE.Color(...color) }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
            vertexShader: /* glsl */`
                attribute float alpha; varying float vA; varying float vDist;
                void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
            fragmentShader: /* glsl */`
                uniform vec3 color, fogColor; uniform float fogDensity; varying float vA; varying float vDist;
                void main() {
                    float fogF = 1.0 - exp(-pow(fogDensity * vDist, 2.0));
                    gl_FragColor = vec4(mix(color, fogColor, fogF), vA * (1.0 - fogF * 0.7) * smoothstep(8.0, 70.0, vDist));
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        m.userData.base = new THREE.Color(...color);
        m.userData.additive = additive;
        this.trailMats.set(key, m);
        return m;
    }

    makeSmokeTexture() {
        const S = 64;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(S, S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const dx = x / S - 0.5, dy = y / S - 0.5;
            const d = Math.sqrt(dx * dx + dy * dy) * 2;
            const n = 0.75 + 0.25 * Math.sin(x * 0.7 + Math.sin(y * 0.5) * 2) * Math.cos(y * 0.6 + Math.sin(x * 0.3) * 2);
            const a = clamp(1 - d, 0, 1);
            const i = (y * S + x) * 4;
            const l = 200 + 55 * (0.5 - dy);
            img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(l, 0, 255);
            img.data[i + 3] = clamp(a * a * n * 255, 0, 255);
        }
        ctx.putImageData(img, 0, 0);
        return new THREE.CanvasTexture(c);
    }

    addTrail(opts) {
        const t = new Trail(this, opts);
        this.trails.push(t);
        return t;
    }

    // ── Composite effects ──
    explosion(pos, size = 1, vel = null) {
        const V = this._tmpV;
        const base = vel ? vel.clone().multiplyScalar(0.25) : new THREE.Vector3();
        // fireball
        for (let i = 0; i < 26 * size; i++) {
            V.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 40) * size).add(base);
            this.flame.emit(pos, V, rand(0.5, 1.1), rand(4, 8) * size, rand(16, 30) * size, [1.5, 0.55, 0.12], [0.5, 0.12, 0.03], 0.9, 0, 2.2, 4);
        }
        // hot core
        for (let i = 0; i < 6; i++) {
            V.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(6 * size).add(base);
            this.fire.emit(pos, V, rand(0.2, 0.35), 10 * size, 34 * size, [2.2, 1.3, 0.5], [1.2, 0.4, 0.1], 0.35, 0, 3, 0);
        }
        // sparks
        for (let i = 0; i < 30 * size; i++) {
            V.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(60, 160) * size).add(base);
            this.fire.emit(pos, V, rand(0.6, 1.6), 1.2, 0.3, [3.5, 2.2, 0.8], [1.6, 0.5, 0.1], 1, 0, 1.2, -30);
        }
        // smoke
        for (let i = 0; i < 18 * size; i++) {
            V.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 22) * size).add(base);
            this._tmpP.copy(pos).addScaledVector(V, 0.1);
            this.smoke.emit(this._tmpP, V, rand(3, 6), rand(8, 14) * size, rand(30, 55) * size, [0.12, 0.1, 0.09], [0.35, 0.34, 0.33], 0.85, 0, 1.1, 3);
        }
        this.flash(pos, 12 * size, 0.08); // a brief pop, not a screen-filling white-out
        this.light(pos, 40 * size, 0.5);
    }

    flash(pos, scale, life) {
        const s = new THREE.Sprite(this.flashMat);
        s.position.copy(pos);
        s.scale.setScalar(scale);
        s.renderOrder = 10;
        s.userData = { life, max: life, scale };
        this.scene.add(s);
        this.flashes.push(s);
    }

    light(pos, intensity, life) {
        let l = this.lights.find(x => x.userData.life <= 0) || this.lights[0];
        l.position.copy(pos);
        l.userData.life = life; l.userData.max = life; l.userData.i = intensity * 45;
        l.intensity = l.userData.i;
    }

    debrisBurst(pos, vel, count = 8, big = 1) {
        for (let i = 0; i < count; i++) {
            const m = new THREE.Mesh(this.debrisGeo[i % 3], this.debrisMat);
            m.position.copy(pos);
            m.scale.setScalar(rand(0.6, 1.6) * big);
            m.castShadow = true;
            this.scene.add(m);
            this.debris.push({
                mesh: m,
                vel: new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(30, 90)).addScaledVector(vel, 0.6),
                spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
                life: rand(3, 6), smokeT: 0, burning: Math.random() < 0.6,
            });
        }
    }

    impact(pos, vel) {
        const V = this._tmpV;
        for (let i = 0; i < 5; i++) {
            V.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(40);
            if (vel) V.addScaledVector(vel, 0.3);
            this.fire.emit(pos, V, rand(0.15, 0.35), 1.6, 0.4, [3.5, 2.5, 1.1], [1.6, 0.7, 0.2], 1, 0, 2, 0);
        }
        this.fire.emit(pos, V.set(0, 0, 0), 0.12, 3, 7, [4, 3, 2], [2, 0.8, 0.3], 1, 0, 0, 0);
        this.smoke.emit(pos, V.set(0, 2, 0), 0.8, 1.5, 6, [0.3, 0.3, 0.3], [0.5, 0.5, 0.5], 0.5, 0, 1, 0);
    }

    groundImpact(pos) {
        const V = this._tmpV;
        for (let i = 0; i < 3; i++) {
            V.set(rand(-8, 8), rand(10, 30), rand(-8, 8));
            this.smoke.emit(pos, V, rand(0.8, 1.4), 1.5, 7, [0.45, 0.4, 0.33], [0.55, 0.5, 0.42], 0.6, 0, 2, -15);
        }
    }

    waterSplash(pos, size = 1) {
        const V = this._tmpV;
        for (let i = 0; i < 30 * size; i++) {
            V.set(rand(-1, 1) * 15, rand(30, 80), rand(-1, 1) * 15).multiplyScalar(size);
            this.smoke.emit(pos, V, rand(1.2, 2.5), 4 * size, 18 * size, [0.9, 0.95, 1], [0.8, 0.85, 0.9], 0.8, 0, 0.6, -40);
        }
    }

    // Engine exhaust / damage smoke helpers
    puffSmoke(pos, vel, size, dark = 0.2, life = 2.2, alpha = 0.55) {
        this.smoke.emit(pos, vel, life, size, size * 4, [dark, dark, dark], [dark + 0.25, dark + 0.25, dark + 0.25], alpha, 0, 1.2, 2);
    }
    puffFire(pos, vel, size, life = 0.35) {
        this.flame.emit(pos, vel, life, size, size * 0.3, [1.5, 0.6, 0.15], [0.6, 0.15, 0.03], 0.85, 0, 1.5, 0);
    }

    // ── Tracers ──
    drawTracers(bullets, camPos) {
        const P = this.tracerPos, C = this.tracerCol;
        let n = 0;
        const a = this._v1, b = this._v2, side = this._v3, toCam = this._tmpV;
        for (let i = 0; i < bullets.length && n < this.maxTracers; i++) {
            const bl = bullets[i];
            if (!bl.tracer) continue;
            a.copy(bl.pos);
            b.copy(bl.pos).addScaledVector(bl.vel, -0.03);
            toCam.subVectors(camPos, a);
            const dist = toCam.length();
            side.subVectors(a, b).cross(toCam).normalize();
            const w = Math.max(0.22, dist * 0.0021);
            const k = n * 12;
            P[k] = a.x + side.x * w; P[k + 1] = a.y + side.y * w; P[k + 2] = a.z + side.z * w;
            P[k + 3] = a.x - side.x * w; P[k + 4] = a.y - side.y * w; P[k + 5] = a.z - side.z * w;
            P[k + 6] = b.x + side.x * w * 0.4; P[k + 7] = b.y + side.y * w * 0.4; P[k + 8] = b.z + side.z * w * 0.4;
            P[k + 9] = b.x - side.x * w * 0.4; P[k + 10] = b.y - side.y * w * 0.4; P[k + 11] = b.z - side.z * w * 0.4;
            const c = bl.color;
            const fade = Math.min(1, bl.life * 2) * (dist > 6000 ? 0 : 1 - dist / 6000);
            for (let v = 0; v < 2; v++) { C[k + v * 3] = c[0] * fade; C[k + v * 3 + 1] = c[1] * fade; C[k + v * 3 + 2] = c[2] * fade; }
            for (let v = 2; v < 4; v++) { C[k + v * 3] = c[0] * 0.15 * fade; C[k + v * 3 + 1] = c[1] * 0.1 * fade; C[k + v * 3 + 2] = c[2] * 0.05 * fade; }
            n++;
        }
        const g = this.tracers.geometry;
        g.setDrawRange(0, n * 6);
        g.attributes.position.needsUpdate = true;
        g.attributes.color.needsUpdate = true;
    }

    update(dt, camera, fog, groundHeight) {
        this.now += dt;
        this.smoke.update(dt, fog);
        this.flame.update(dt, fog);
        this.fire.update(dt, fog);
        // vapour trails are lit by the sky: bright by day, dim grey-blue at night (additive glows keep their colour)
        const shade = clamp((fog.color.r * 0.3 + fog.color.g * 0.59 + fog.color.b * 0.11) * 2.2, 0.12, 1);
        for (const m of this.trailMats.values()) {
            m.uniforms.fogColor.value.copy(fog.color); m.uniforms.fogDensity.value = fog.density;
            if (!m.userData.additive) m.uniforms.color.value.copy(m.userData.base).multiplyScalar(shade);
        }
        for (let i = this.trails.length - 1; i >= 0; i--) {
            const t = this.trails[i];
            t.update(this.now, camera.position);
            if (!t.alive) { t.dispose(); this.trails.splice(i, 1); }
        }
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const s = this.flashes[i];
            s.userData.life -= dt;
            const k = s.userData.life / s.userData.max;
            s.material.opacity = 1;
            s.scale.setScalar(s.userData.scale * (1.4 - k * 0.4));
            if (s.userData.life <= 0) { this.scene.remove(s); this.flashes.splice(i, 1); }
        }
        for (const l of this.lights) {
            if (l.userData.life > 0) {
                l.userData.life -= dt;
                l.intensity = Math.max(0, l.userData.i * (l.userData.life / l.userData.max));
            } else l.intensity = 0;
        }
        const V = this._tmpV;
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i];
            d.life -= dt;
            d.vel.y -= 9.81 * dt;
            d.vel.multiplyScalar(Math.exp(-0.3 * dt));
            d.mesh.position.addScaledVector(d.vel, dt);
            d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
            d.smokeT -= dt;
            if (d.smokeT <= 0) {
                d.smokeT = 0.05;
                V.set(0, 1, 0);
                this.puffSmoke(d.mesh.position, V, 2, 0.15, 1.6, 0.5);
                if (d.burning) this.puffFire(d.mesh.position, V, 3);
            }
            const gh = groundHeight(d.mesh.position.x, d.mesh.position.z);
            if (d.mesh.position.y < gh || d.life <= 0) {
                if (d.mesh.position.y < gh + 2) this.groundImpact(d.mesh.position);
                this.scene.remove(d.mesh);
                this.debris.splice(i, 1);
            }
        }
    }

    clear() {
        this.smoke.clear(); this.fire.clear(); this.flame.clear();
        this.trails.forEach(t => t.dispose()); this.trails = [];
        this.debris.forEach(d => this.scene.remove(d.mesh)); this.debris = [];
        this.flashes.forEach(s => this.scene.remove(s)); this.flashes = [];
        this.lights.forEach(l => { l.userData.life = 0; l.intensity = 0; });
        this.tracers.geometry.setDrawRange(0, 0);
    }
}
