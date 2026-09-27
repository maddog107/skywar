// ═══════════════════════════════════════════════════════════════
// Rigged vehicles (vehicles.js) on the war's ground targets (ground.js GroundTarget): the target keeps its hit
// box, health, route and behaviour; its stand-in mesh is swapped for the real vehicle as soon as the models have
// loaded (they load in the background after the boot). Used by the director (TEL, convoys, our Patriot battery)
// and the front (Grad rocket batteries, APCs in the engagement zones).
//   dress(unit, 'scud', { onRig(rig, unit) })            → a rigged copy: unit.rig / unit.vehicle (it can move)
//   dress(unit, 'grad', { pose: 'aim', onRig(rig) })     → a static copy in one pose, two draw calls instead of
//        20-50: one merged model per vehicle + pose, shared by every copy (onRig poses it, once); its muzzles'
//        local positions and directions are kept in unit.vehicle.userData.muzzles
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { hasVehicle, vehiclesReady, createVehicle, staticVehicle, muzzleWorld, VEHICLES } from './vehicles.js';

const STATIC = new Map(); // 'id:pose:paint' → the merged model every static copy clones (geometry shared)

function staticModel(id, pose, paint, onRig) {
    const key = id + ':' + pose + ':' + (paint || '');
    let proto = STATIC.get(key);
    if (proto) return proto;
    const { object, rig } = createVehicle(id, paint ? { paint } : {});
    if (onRig) onRig(rig, null);
    object.updateMatrixWorld(true);
    proto = staticVehicle(object);
    // where its tubes are, in the model's own frame
    proto.userData.muzzles = rig.muzzles.map((m, i) => {
        const p = new THREE.Vector3(), d = new THREE.Vector3();
        muzzleWorld(rig, i, p, d);
        return { p, d };
    });
    STATIC.set(key, proto);
    return proto;
}

export function dress(u, id, { paint = null, onRig = null, pose = null } = {}) {
    if (!u || !u.mesh || !u.mesh.isObject3D || !VEHICLES[id]) return false;
    const apply = () => {
        if (u.vehicle || u.removed || !u.mesh || !hasVehicle(id) || !u.alive) return; // (a wreck keeps its burnt stand-in)
        let object = null, rig = null;
        try {
            if (pose !== null) { const proto = staticModel(id, pose, paint, onRig); object = proto.clone(); object.userData = proto.userData; }
            else ({ object, rig } = createVehicle(id, paint ? { paint } : {}));
        } catch (e) { return; }
        for (const c of u.mesh.children) c.visible = false;
        u.mesh.add(object);
        u.vehicle = object; u.rig = rig; u.vehicleId = id;
        u.parts = {}; // no stand-in turret, rack or dish to throw when it's destroyed
        if (rig && onRig) { try { onRig(rig, u); } catch (e) { console.warn('[dressing]', e); } }
    };
    if (hasVehicle(id)) apply();
    else { try { vehiclesReady().then(apply); } catch (e) { /* no vehicles in this build */ } }
    return true;
}
