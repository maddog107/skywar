// ═══════════════════════════════════════════════════════════════
// Rig parts: the moving parts of an aircraft model that code animates (support aircraft, bombers), and the
// refuelling points of the receivers.
//
// A model file marks each moving part as a named node with its origin on its pivot (model space: x toward the
// right wing, y up, z aft):
//   rotodome                  radar rotodome, turns about its own +y (E-3, A-50)
//   boom                      tanker flying boom: hinge at the origin, the boom lies along its local +z (aft).
//                             setBoom() pitches it about x (down is +) and yaws it about y (right is +)
//     boom_ext                  telescoping inner tube, slides out along the boom's +z
//       boom_nozzle               (empty) the nozzle tip: where the boom plugs into a receptacle
//   drogue_l / drogue_r / drogue_c   hose-and-drogue unit (wing pod, centreline drum): origin at the hose exit,
//                             trailing along +z
//     hose_<s>                  the hose, modelled 1 m long along +z (stretched to the length trailed)
//     basket_<s>                the drogue basket; its origin is the coupling a probe plugs into
//   rig_<anything>            any other part code wants to move (doors, hatches, radars, ...)
// Node custom properties (glTF extras) arrive as userData, e.g. boom: { stow, pitchMin, pitchMax, yawMax },
// boom_ext: { travel }, drogue_*: { hose, droop }.
//
// models.js pulls these nodes out of the model before the airframe is cut into damage sections (segmentModel
// merges every mesh), bakes the file's scale into them so their positions are metres, and puts a fresh copy on
// every instance, in the airframe section it sits in (a boom goes with a shot-off tail). The instance's
// rig.parts maps every named node in them to the instance's own node (rig.parts.boom_nozzle, ...).
// A model that is frozen with freezeLocal() (util.js) must pass its rig parts as `moving`.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const PART_ROOT = /^(rotodome|boom|drogue_[lrc]|rig_.+)$/;

// ── Receivers: where a tanker plugs in (fractions of the aircraft length, model space as above) ──
// kind 'boom': the receptacle (a flying boom's nozzle goes in there); 'probe': the probe tip (extended), which
// goes into a drogue basket. Read off the models with tools/aircraft/preview.js blueprint().
export const REFUEL = {
    // support aircraft
    e3: { at: [0, -0.0229, -0.3756], kind: 'boom' },          // UARRSI on the spine behind the cockpit
};

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

// Take the rig parts out of a normalised model (models.js normaliseGLTF: `holder` is in model space, metres).
// Returns the part templates, each in model space with unit scale (models.js tags each with the airframe
// section it rides on: userData.region).
export function extractRigParts(holder) {
    holder.updateMatrixWorld(true);
    const roots = [];
    holder.traverse((o) => {
        if (o === holder || !PART_ROOT.test(o.name || '')) return;
        for (let a = o.parent; a && a !== holder; a = a.parent) if (PART_ROOT.test(a.name || '')) return; // inside another part
        roots.push(o);
    });
    const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
    return roots.map((o) => {
        _m.multiplyMatrices(inv, o.matrixWorld).decompose(_p, _q, _s);
        o.parent.remove(o);
        const k = (_s.x + _s.y + _s.z) / 3;
        if (Math.abs(_s.x - k) > 1e-3 * k || Math.abs(_s.y - k) > 1e-3 * k) console.warn('[rigparts] non-uniform scale on', o.name);
        o.position.copy(_p);
        o.quaternion.copy(_q);
        o.scale.set(1, 1, 1);
        bakeScale(o, k);
        return o;
    });
}

// Push a uniform scale k down into a subtree: every node below moves k times as far, every mesh is k times bigger
function bakeScale(root, k) {
    if (Math.abs(k - 1) < 1e-6) return;
    root.traverse((o) => {
        if (o !== root) o.position.multiplyScalar(k);
        if (o.isMesh && o.geometry) { o.geometry = o.geometry.clone(); o.geometry.scale(k, k, k); }
    });
}

// A refuelling point as a part template: an empty named 'refuel' ({ at: [x, y, z] in fractions of L, kind })
export function refuelTemplate(def, length) {
    const o = new THREE.Object3D();
    o.name = 'refuel';
    o.position.set(def.at[0] * length, def.at[1] * length, def.at[2] * length);
    o.userData.kind = def.kind;
    return o;
}

// A fresh copy of the part templates on a model instance, each hung on the airframe section it rides on.
// Returns { name: node } for every named node in them. Every node remembers its rest pose (userData.rest).
export function attachRigParts(object, templates) {
    const parts = {};
    for (const t of templates || []) {
        const c = t.clone(true);
        const g = (t.userData.region && object.children.find(ch => ch.userData.region === t.userData.region)) || object;
        if (g !== object) c.position.sub(g.position);
        g.add(c);
        c.traverse((o) => {
            o.userData.rest = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
            if (o.name) parts[o.name] = o;
        });
    }
    // a stowed drogue: hose reeled in (hidden, so a parked copy doesn't merge it)
    for (const s of ['l', 'r', 'c']) if (parts['drogue_' + s]) trailDrogue({ parts }, s, 0);
    return parts;
}

// ── Pose helpers (for the air-support systems) ──

// Turn the rotodome: rpm revolutions a minute, clockwise seen from above. An E-3's turns at 6 rpm with the radar
// on, and at 1/4 rpm with it off (to keep the bearings lubricated). Returns false if the type has none.
export function spinRotodome(rig, dt, rpm = 6) {
    const r = rig.parts?.rotodome;
    if (!r) return false;
    r.rotateY(-dt * rpm * Math.PI / 30);
    return true;
}

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
// Pose the flying boom: pitch (rad) down from the fuselage axis, yaw (rad) to the right, ext (m) of telescope
// out. The KC-135's contact envelope is about 20-40° down, ±10° (±15° at most) across and 1.8-5.6 m out
// (userData on the nodes: boom.pitchMin / pitchMax / yawMax in degrees, boom_ext.travel in m).
// Returns false if the type has no boom.
export function setBoom(rig, pitch, yaw = 0, ext = 0) {
    const b = rig.parts?.boom;
    if (!b) return false;
    b.quaternion.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    const e = rig.parts.boom_ext;
    if (e) {
        const travel = e.userData.travel ?? 5.6;
        e.position.copy(e.userData.rest.p);
        e.position.z += Math.max(0, Math.min(travel, ext));
    }
    return true;
}

// The boom back in its stowed pose (as the model file has it)
export function stowBoom(rig) {
    const b = rig.parts?.boom;
    if (!b) return false;
    b.quaternion.copy(b.userData.rest.q);
    if (rig.parts.boom_ext) rig.parts.boom_ext.position.copy(rig.parts.boom_ext.userData.rest.p);
    return true;
}

// Trail a hose-and-drogue unit: side 'l', 'r' or 'c' (centreline), k 0 (reeled in) .. 1 (fully trailed). The hose
// pays out to userData.hose metres (default 15) and, as it trails, the unit droops userData.droop degrees (the hose
// sags below the pod; default 6). Returns false if the type has no such unit.
export function trailDrogue(rig, side, k) {
    const d = rig.parts?.['drogue_' + side];
    if (!d) return false;
    k = Math.max(0, Math.min(1, k));
    const len = (d.userData.hose ?? 15) * k;
    const hose = rig.parts['hose_' + side], basket = rig.parts['basket_' + side];
    if (hose) {
        hose.visible = len > 0.05;
        hose.scale.set(1, 1, Math.max(len, 1e-3));
    }
    if (basket) {
        basket.position.set(basket.userData.rest.p.x, basket.userData.rest.p.y, basket.userData.rest.p.z + len);
        basket.visible = k > 0; // stowed, the drogue is inside its pod
    }
    _q.setFromAxisAngle(_p.set(1, 0, 0), (d.userData.droop ?? 6) * Math.PI / 180 * k);
    d.quaternion.copy(d.userData.rest.q).multiply(_q);
    return true;
}

// World position of a rig node (boom_nozzle, basket_l, refuel, ...) of an aircraft; null if it has none
export function rigPoint(ac, name, out = new THREE.Vector3()) {
    const n = ac.rig?.parts?.[name];
    if (!n) return null;
    return n.getWorldPosition(out);
}

// Per-frame upkeep of an aircraft's rig parts (Aircraft.updateVisuals): the rotodome turns while the jet is
// alive (6 rpm airborne, 1/4 rpm on the ground); ac.radarRpm overrides it.
export function updateRigParts(ac, dt) {
    const p = ac.rig.parts;
    if (p.rotodome) spinRotodome(ac.rig, dt, ac.radarRpm ?? (!ac.alive ? 0 : ac.onGround ? 0.25 : 6));
}
