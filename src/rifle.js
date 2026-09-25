// ═══════════════════════════════════════════════════════════════
// AK-47 model (muzzle toward -Z, grip at the origin-ish; ~1.08 units long).
// Used for the first-person view model (cockpit.js) and the rifle the pilot
// carries in third person (character.js). Geometry and materials are shared.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

let parts = null;

function build() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a3f1c, roughness: 0.6, metalness: 0.05 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.45, metalness: 0.8 });
    const P = (geo, mat, x, y, z, rx = 0) => ({ geo, mat, x, y, z, rx });
    return [
        P(new THREE.BoxGeometry(0.05, 0.07, 0.34), steel, 0, 0, 0),                    // receiver
        P(new THREE.BoxGeometry(0.052, 0.03, 0.3), steel, 0, 0.045, -0.02),              // dust cover
        P(new THREE.CylinderGeometry(0.009, 0.009, 0.42, 8), steel, 0, 0.02, -0.38, Math.PI / 2), // barrel
        P(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), steel, 0, 0.05, -0.3, Math.PI / 2),   // gas tube
        P(new THREE.BoxGeometry(0.056, 0.06, 0.2), wood, 0, 0.01, -0.26),                 // handguard
        P(new THREE.BoxGeometry(0.012, 0.05, 0.012), steel, 0, 0.07, -0.55),              // front sight
        P(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8), steel, 0, 0.02, -0.61, Math.PI / 2), // muzzle
        P(new THREE.BoxGeometry(0.035, 0.2, 0.07), steel, 0, -0.12, -0.06, 0.35),         // curved mag (approx)
        P(new THREE.BoxGeometry(0.035, 0.1, 0.07), steel, 0, -0.2, -0.1, 0.6),
        P(new THREE.BoxGeometry(0.04, 0.12, 0.05), wood, 0, -0.08, 0.1, -0.3),           // pistol grip
        P(new THREE.BoxGeometry(0.045, 0.08, 0.3), wood, 0, -0.03, 0.3, 0.12),           // stock
    ];
}

export function buildRifleModel() {
    parts = parts || build();
    const g = new THREE.Group();
    for (const p of parts) {
        const m = new THREE.Mesh(p.geo, p.mat);
        m.position.set(p.x, p.y, p.z);
        m.rotation.x = p.rx;
        g.add(m);
    }
    return g;
}
