// ═══════════════════════════════════════════════════════════════
// Ring Race: a timed course of glowing rings threaded through the valleys.
// The course follows low ground (canyons, passes, coastline) from the home
// base; fly through each ring in order.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight } from './world.js';
import { DEG, mulberry32 } from './util.js';

const RADIUS = 40;

export class RingCourse {
    constructor(game, seed = 7) {
        this.game = game;
        this.rings = [];
        this.next = 0;
        this.group = new THREE.Group();
        game.scene.add(this.group);
        this.build(seed);
    }

    build(seed) {
        const r = mulberry32(seed);
        const pos = new THREE.Vector3(0, 0, -2600);
        let heading = 0;
        const pts = [];
        const N = 18;
        for (let i = 0; i < N; i++) {
            // choose the heading whose next leg stays over the lowest ground (valleys/canyons)
            let best = null;
            for (const turn of [-40, -20, 0, 20, 40]) {
                const h = heading + turn * DEG;
                const dir = new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h));
                let hi = 0;
                for (let s = 250; s <= 1300; s += 262) hi = Math.max(hi, terrainHeight(pos.x + dir.x * s, pos.z + dir.z * s));
                const score = hi + Math.abs(turn) * 1.5 + r() * 25;
                if (!best || score < best.score) best = { score, h, dir, hi };
            }
            heading = best.h;
            pos.addScaledVector(best.dir, 1300);
            const ground = Math.max(terrainHeight(pos.x, pos.z), 0);
            const y = Math.max(ground + 90 + r() * 80, best.hi + 70, 140);
            pts.push(new THREE.Vector3(pos.x, y, pos.z));
        }
        this.points = pts;
        const geo = new THREE.TorusGeometry(RADIUS, 2.4, 10, 48);
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const toNext = (pts[i + 1] || p.clone().add(p.clone().sub(pts[i - 1]))).clone().sub(i ? pts[i - 1] : p).normalize();
            const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.3, 0.3), transparent: true, opacity: 0.9, fog: true });
            const m = new THREE.Mesh(geo, mat);
            m.position.copy(p);
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toNext);
            this.group.add(m);
            this.rings.push({ mesh: m, pos: p, normal: toNext.clone(), passed: false });
        }
        this.refresh();
    }

    // Spawn pose for the start (or a respawn at the last ring passed)
    spawnPose() {
        const i = Math.max(0, this.next - 1);
        const at = this.next === 0 ? this.points[0].clone().addScaledVector(this.rings[0].normal, -1500) : this.points[i].clone();
        const dir = this.next === 0 ? this.rings[0].normal.clone() : this.points[this.next].clone().sub(this.points[i]).normalize();
        at.y = Math.max(at.y, Math.max(terrainHeight(at.x, at.z), 0) + 150);
        return { pos: at, heading: Math.atan2(-dir.x, -dir.z) };
    }

    refresh() {
        this.rings.forEach((r, i) => {
            r.mesh.visible = !r.passed;
            const c = r.mesh.material.color;
            if (i === this.next) c.setRGB(0.4, 3, 0.9);
            else if (i === this.next + 1) c.setRGB(2.2, 1.4, 0.35);
            else c.setRGB(1.1, 0.7, 0.2);
            r.mesh.material.opacity = i === this.next ? 0.95 : 0.6;
        });
    }

    get target() { return this.rings[this.next]; }
    get done() { return this.next >= this.rings.length; }

    // Did the aircraft fly through the next ring this frame (prev → cur)?
    check(prev, cur) {
        const r = this.target;
        if (!r) return false;
        const d0 = prev.clone().sub(r.pos).dot(r.normal), d1 = cur.clone().sub(r.pos).dot(r.normal);
        if (d0 < 0 && d1 >= 0) {
            const t = d0 / (d0 - d1);
            const hit = prev.clone().lerp(cur, t);
            if (hit.distanceTo(r.pos) < RADIUS + 4) {
                r.passed = true;
                this.next++;
                this.refresh();
                return true;
            }
        }
        return false;
    }

    update(dt) {
        const t = this.game.time;
        const r = this.target;
        if (r) r.mesh.scale.setScalar(1 + Math.sin(t * 6) * 0.04);
    }

    remove() {
        this.game.scene.remove(this.group);
        // geometry is shared by the rings, each ring has its own material (colour/opacity per state)
        if (this.rings.length) this.rings[0].mesh.geometry.dispose();
        this.rings.forEach(r => r.mesh.material.dispose());
    }
}
