// ═══════════════════════════════════════════════════════════════
// AK-47 model (muzzle toward -Z, grip at the origin-ish; ~1.08 units long).
// Used for the first-person view model (cockpit.js) and the rifle the pilot
// carries in third person (character.js). Geometry and materials are shared.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

let parts = null;

// a flat profile in the Y/Z plane (points as [z, y]) extruded across X, centred
function profile(points, width) {
    const s = new THREE.Shape();
    points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: width * 0.12, bevelSize: width * 0.12, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2); // shape x → +z (aft), extrusion → x
    g.computeVertexNormals();
    return g;
}

// the AK's banana magazine: a slab bent forward along an arc (shape x is aft, y up)
function magazine() {
    const s = new THREE.Shape();
    s.absarc(-0.5, 0, 0.5, 0, -0.5, true);
    s.absarc(-0.5, 0, 0.44, -0.5, 0, false);
    s.closePath();
    const w = 0.03;
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 12 });
    g.translate(0, 0, -w / 2);
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
}

function build() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a3f1c, roughness: 0.55, metalness: 0.05 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x5a2d14, roughness: 0.6, metalness: 0.05 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.42, metalness: 0.8 });
    const worn = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.35, metalness: 0.9 });
    const P = (geo, mat, x, y, z, rx = 0) => ({ geo, mat, x, y, z, rx });
    const cylZ = (r1, r2, l, seg = 10) => new THREE.CylinderGeometry(r1, r2, l, seg).rotateX(Math.PI / 2);
    return [
        P(new THREE.BoxGeometry(0.05, 0.07, 0.34), steel, 0, 0, 0),                                  // receiver
        P(cylZ(0.026, 0.026, 0.3, 12).scale(1, 0.55, 1), worn, 0, 0.045, -0.02),                      // dust cover (rounded)
        P(new THREE.BoxGeometry(0.02, 0.018, 0.03), steel, 0, 0.066, -0.14),                         // rear sight block
        P(cylZ(0.009, 0.009, 0.42), steel, 0, 0.02, -0.38),                                          // barrel
        P(cylZ(0.012, 0.012, 0.3), steel, 0, 0.05, -0.3),                                            // gas tube
        P(cylZ(0.028, 0.026, 0.2, 12).scale(1, 1.05, 1), wood, 0, 0.012, -0.26),                     // lower handguard
        P(cylZ(0.017, 0.017, 0.14, 10), darkWood, 0, 0.052, -0.27),                                  // upper handguard
        P(new THREE.BoxGeometry(0.012, 0.05, 0.012), steel, 0, 0.07, -0.55),                         // front sight post
        P(new THREE.TorusGeometry(0.016, 0.004, 5, 10, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), steel, 0, 0.078, -0.55), // sight hood
        P(cylZ(0.015, 0.013, 0.055), steel, 0, 0.02, -0.615),                                         // slant muzzle brake
        P(magazine(), steel, 0, -0.03, -0.045),                                                       // curved magazine
        P(profile([[0, 0], [-0.045, 0], [-0.03, -0.12], [0.02, -0.12]], 0.036), darkWood, 0, -0.03, 0.085), // pistol grip
        P(profile([[0, 0.02], [0, -0.04], [0.29, -0.12], [0.32, -0.12], [0.32, -0.02], [0.05, 0.025]], 0.042), wood, 0, 0, 0.16), // stock
        P(new THREE.BoxGeometry(0.046, 0.008, 0.07), steel, 0, -0.04, 0.06),                         // trigger guard
        P(new THREE.BoxGeometry(0.02, 0.012, 0.03), worn, 0.03, 0.03, 0.08),                          // charging handle
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
