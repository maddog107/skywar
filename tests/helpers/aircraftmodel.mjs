// Load an aircraft's GLB headless the way models.js preloadModels does (no WebGL, no image decoding): the file's
// textures are stripped, the scene scaled to the type's real length (spec.length / bbox z) and centred on its
// bounding box. For the model and surface tests of real aircraft files.
//   const { holder, json } = await loadAircraft('mig25')  // holder: model space (nose −z, metres); json: the GLB's
import { readFileSync } from 'node:fs';
import { src } from './setup.mjs';

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { AIRCRAFT } = await src('config.js');
const { MODEL_FILES } = await src('models.js');

// the GLB's JSON chunk
export function glbJson(buf) {
    const len = buf.readUInt32LE(12);
    return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

// the same file with its images, textures and texture references taken out (GLTFLoader can't decode images in Node)
export function stripTextures(buf) {
    const json = glbJson(buf);
    const jsonLen = buf.readUInt32LE(12);
    delete json.images; delete json.textures; delete json.samplers;
    for (const m of json.materials || []) {
        const pbr = m.pbrMetallicRoughness || {};
        delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
        delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    }
    const js = Buffer.from(JSON.stringify(json));
    const pad = (4 - (js.length % 4)) % 4;
    const rest = buf.subarray(20 + jsonLen);
    const out = Buffer.alloc(20 + js.length + pad + rest.length);
    out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
    out.writeUInt32LE(js.length + pad, 12); out.writeUInt32LE(0x4e4f534a, 16);
    js.copy(out, 20); out.fill(0x20, 20 + js.length, 20 + js.length + pad);
    rest.copy(out, 20 + js.length + pad);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

export async function loadAircraft(id) {
    const info = MODEL_FILES[id], spec = AIRCRAFT[id];
    const buf = readFileSync(new URL(`../../models/${info.file}`, import.meta.url));
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(stripTextures(buf), '', res, rej));
    // models.js normaliseGLTF: holder ⊃ inner (rot, scale, centring) ⊃ the file's scene
    const holder = new THREE.Group(), inner = new THREE.Group();
    inner.add(gltf.scene);
    if (info.rot) inner.rotation.set(info.rot[0], info.rot[1], info.rot[2]);
    holder.add(inner);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const scale = spec.length / size.z;
    inner.position.copy(center).multiplyScalar(-scale);
    inner.scale.setScalar(scale);
    holder.updateMatrixWorld(true);
    return { holder, json: glbJson(buf), info, spec };
}

// triangles of every mesh under root (indexed or not)
export function triangleCount(root) {
    let n = 0;
    root.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return n;
}
