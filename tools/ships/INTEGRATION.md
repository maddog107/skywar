# Ships: integration notes for the lead

New files (commit as-is): `models/ships/carrier.glb`, `models/ships/destroyer.glb`, `models/ships/CREDITS.md`,
`src/shipfx.js`, `tools/ships/*` (Blender/texture scripts, `build.sh`, this file).

The only edits to existing files are in **`src/naval.js`** and **`src/main.js`** (sections A–K below). They are
also the last commit on this branch ("LOCAL TEST WIRING — lead: apply via INTEGRATION.md"), so
`git cherry-pick` works if naval.js hasn't moved much; otherwise apply the snippets by hand. Everything
falls back to the old procedural ships if a GLB fails to load (layout = null → old rectangle deck).

Optional extras for `src/aircraft.js` / `src/autopilot.js` are in section L (not in the wiring commit).

---

## main.js

**A. preload the ship models at boot** (next to the other preloaders):

```js
import { preloadCharacter } from './character.js';
import { preloadShips } from './naval.js';                                   // ← add
```
```js
    await Promise.all([preloadModels((f) => { $('loadFill').style.width = (10 + f * 60) + '%'; }), preloadProps(), preloadCharacter(), preloadShips()]);
    //                                                                                                                       ^^^^^^^^^^^^^^ add
```

## naval.js

**B. imports** (after the BufferGeometryUtils import):

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ShipFX, seaMotion, SEA_MOTION, deckHeightAt, foamTexture } from './shipfx.js';
```

**C. point-in-polygon helper** (anywhere at module level, e.g. above `findOcean`):

```js
function inPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < xi + (z - zi) / (zj - zi) * (xj - xi)) inside = !inside;
    }
    return inside;
}
```

**D. model loading + glTF ship builder** (insert just above `function buildCarrier()`):

```js
// Ship models (tools/ships/*.py, models/ships/CREDITS.md). Loaded once at boot; if a file is missing the
// procedural ship below is used instead.
const SHIP_FILES = { carrier: 'models/ships/carrier.glb', destroyer: 'models/ships/destroyer.glb' };
const shipGltf = {};
export async function preloadShips() {
    foamTexture(); // build the procedural foam texture now (~80 ms) rather than on the first sortie
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(SHIP_FILES).map(async ([type, file]) => {
        try { shipGltf[type] = await loader.loadAsync(file); } catch (e) { console.warn('[naval] ship model not loaded:', file, e && e.message); }
    }));
}

// A ship from its glTF: static hull/superstructure, rotating radar(s) "radar"/"radar2", turrets "mount_<type>_<n>";
// root extras.skywar = the layout (deck outline, waterline, parked aircraft…) written by the Blender script.
function buildFromGltf(type, gltf) {
    const g = new THREE.Group(), parts = {};
    const root = gltf.scene.clone(true);
    g.add(root);
    let layout = null;
    root.traverse(o => { if (!layout && o.userData && typeof o.userData.skywar === 'string') { try { layout = JSON.parse(o.userData.skywar); } catch (e) { /* ignore */ } } });
    root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
            if (!m) continue;
            if (m.map) m.map.anisotropy = 16;
            // painted steel in the open: the sky (and the sea's bounce) light the shaded sides a lot
            m.envMapIntensity = m.name === 'Deck' ? 0.6 : 1.25;
        }
    });
    const radar = root.getObjectByName('radar');
    if (radar) { radar.name = 'ship:radar'; parts.radar = radar; }
    const radar2 = root.getObjectByName('radar2');
    if (radar2) { radar2.name = 'ship:radar2'; parts.radar2 = radar2; }
    const mounts = [];
    root.traverse(o => {
        const m = /^mount_(ciws|sam|gun)_\d+$/.exec(o.name);
        if (m) mounts.push({ type: m[1], p: o.position.clone(), turret: o });
    });
    // parked aircraft (kept clear of cat 1, the landing lane and the landing area)
    for (const [kind, x, z, yaw] of (layout && layout.parked) || []) {
        const { object } = createAircraftModel(kind);
        object.position.set(x, (layout.deckY || TYPES[type].deckY) + 2.2, z);
        object.rotation.y = yaw;
        object.scale.setScalar(0.95);
        g.add(object);
    }
    return { group: g, parts, mounts, layout };
}
```

**E. use it** — first line of `buildCarrier()` and of `buildDestroyer()`:

```js
function buildCarrier() {
    if (shipGltf.carrier) return buildFromGltf('carrier', shipGltf.carrier);      // ← add
    const T = TYPES.carrier, L = T.L, g = new THREE.Group(), parts = {};
```
```js
function buildDestroyer() {
    if (shipGltf.destroyer) return buildFromGltf('destroyer', shipGltf.destroyer);  // ← add
```

**F. `mergeStatic`: keep both radars moving**

```js
-    g.traverse(o => { if (o.name === 'ship:radar' || o.name.startsWith('ship:mount')) o.traverse(c => moving.add(c)); });
+    g.traverse(o => { if (o.name.startsWith('ship:radar') || o.name.startsWith('ship:mount')) o.traverse(c => moving.add(c)); });
```

**G. `makeShip`: hand out radar2 and the layout**

```js
    const group = t.group.clone(true);
    const parts = {};
    const radar = group.getObjectByName('ship:radar');
    if (radar) parts.radar = radar;
    const radar2 = group.getObjectByName('ship:radar2');
    if (radar2) parts.radar2 = radar2;
    const mounts = t.mounts.map((m, i) => ({ type: m.type, p: m.p.clone(), turret: group.getObjectByName('ship:mount' + i), fireT: rand(0, 2), lockT: 0 }));
    return { group, parts, mounts, layout: t.layout || null };
```

**H. `Ship` constructor** — after `this.mounts = built.mounts;`:

```js
        this.layout = built.layout;
        this.motionT = Math.random() * 100;
        this.motionSeed = Math.random() * 10;
        this.motion = { heave: 0, pitch: 0, roll: 0 };
        this.game.scene.add(this.mesh);
        if (naval.fx) naval.fx.add(this, this.layout);        // wake, foam line, bow wave, shadow
```

**I. `Ship.place()` — sea motion** (replaces the `const y = …` line and the rotation lines):

```js
        // gentle heave / pitch / roll with the sea (deckAt follows the tilted deck, so landings stay consistent)
        this.motionT += dt;
        const mo = seaMotion(this.motionT, this.motionSeed, SEA_MOTION[this.type] || SEA_MOTION.carrier, this.motion);
        const y = -sink * (this.def.deckY + 25) - dmgFrac * 1.5 + mo.heave;
        if (dt > 0) this.vel.set((x - this.mesh.position.x) / dt, (y - this.mesh.position.y) / dt, (z - this.mesh.position.z) / dt);
        this.mesh.position.set(x, y, z);
        this.mesh.rotation.set(0, this.heading, 0);
        this.listAngle = damp01(this.listAngle || 0, (1 - Math.max(this.hp, 0) / this.maxHp) * 0.05, dt);
        this.mesh.rotation.z = this.listAngle + sink * 0.28 + mo.roll;
        this.mesh.rotation.x = mo.pitch - (this.alive ? 0 : sink * 0.08);
```

Amplitudes live in `SEA_MOTION` (shipfx.js): carrier heave ±0.28 m, pitch ±0.12°, roll ±0.2°; destroyer
±0.55 m / ±0.45° / ±1.4°. Set them to 0 to switch motion off.

**J. `Ship.onDeck()` (modelled deck outline) + new `deckHeight()`; `hitTest()` island box**

```js
    onDeck(x, z, margin = 0) {
        const { lx, lz } = this.toLocal(x, z);
        const B = this.type === 'carrier' ? this.def.B : this.def.B * 0.8;
        const off = this.type === 'carrier' ? -4 : 0;
        if (!(Math.abs(lx - off) < B / 2 - margin && Math.abs(lz) < this.def.L / 2 - margin)) return false;
        // the modelled flight deck (angled deck, elevators, island sponson), not just its bounding rectangle
        const lay = this.layout;
        if (lay && lay.deck && this.type === 'carrier') {
            const sp = lay.islandSponson;
            return inPoly(lx, lz, lay.deck) || (lay.elevators || []).some(p => inPoly(lx, lz, p)) ||
                (!!sp && lx >= sp[0] && lx <= sp[1] && lz >= sp[2] && lz <= sp[3]);
        }
        return true;
    }
    // deck surface height at a world point (follows heave, pitch and roll)
    deckHeight(x, z) {
        const { lx, lz } = this.toLocal(x, z);
        return deckHeightAt(this.mesh, this.def.deckY, lx, lz);
    }
```
```js
    hitTest(p) {
        const { lx, lz } = this.toLocal(p.x, p.z);
        const y = p.y - this.mesh.position.y;
        const isl = this.layout && this.layout.island;
        const onIsland = isl ? lx > isl[0] && lx < isl[1] && lz > isl[2] && lz < isl[3] : Math.abs(lx - (this.def.B * 0.5 - 12)) < 8 && Math.abs(lz - this.def.L * 0.08) < 20;
        const top = this.def.deckY + (onIsland ? 30 : 2);
        return Math.abs(lx) < this.def.B / 2 && Math.abs(lz) < this.def.L / 2 && y > -6 && y < top;
    }
```

**K. `Ship.update()`, `Ship.remove()`, `Naval`**

```js
        if (this.parts.radar) this.parts.radar.rotation.y += dt * 1.6;
        if (this.parts.radar2) this.parts.radar2.rotation.y -= dt * 2.6;             // ← add
```
Delete the old `// wake & bow spray` block (the `this.wakeT` smoke puffs at stern and bow) — shipfx draws the
wake, bow wave and spray now. (`fx`/`_v` are still used by the fire code below it.)

```js
    remove() {
        this.game.scene.remove(this.mesh);
        if (this.naval.fx) this.naval.fx.remove(this);                               // ← add
        this.gone = true;
    }
```
`Naval` constructor: `this.fx = new ShipFX(game.scene);` after `this.timers = new Set();`
`Naval.deckAt()`: `r.h = s.deckHeight(x, z);` instead of `r.h = s.deckY;`
`Naval.update()`: `this.fx.update(dt, this.game);` after the ships loop.
`Naval.clear()`: `this.fx.clear();` after `this.ships.forEach(s => s.remove());`

---

## What the layout keeps (verified in the browser, headless Chrome driving the game)

Carrier frame: x starboard, y up (0 = waterline), bow −z; deck top y = 19 = `TYPES.carrier.deckY`.

| gameplay item | coordinate | model |
|---|---|---|
| walkable deck | old rectangle x −42..34, z −160..160 | modelled deck polygon + 4 elevators + island sponson, all inside it; `onDeck` now uses the polygon |
| catapult spot | `catapultSpot()` (12, −6.4) | cat 1 track x = 12 from z −2 to −157, raised JBD behind the spot; deck polygon reaches the bow at x 12 (edge 13.5) |
| autoland touchdown | (−4, 0.4 L = 128) | angled landing area (8°) centreline crosses x −4 at z ≈ 125; wires at z 138/126/114/102 |
| wire zone | `inWireZone` z −6.4..153.6 | unchanged |
| island | hitTest box | island x 13..25, z 10..46 (layout.island, used by hitTest) |
| mounts | 3 CIWS + 2 SAM | now read from the GLB: CIWS (26,15.6,−124) (−34,15.6,146) (−46,15.6,−36), SAM (−26,15.6,−114) (25.5,15.6,132) on deck-edge sponsons |
| parked jets | 5 on the bow | 6 (layout.parked): on elevators 1–3, port bow, abaft the island — clear of cat 1, the x −4 landing lane and the landing area |

Destroyer: L 155, deck edge 6.5–11 m (sheer), deckY 8 unchanged; gun (0, 9.9, −58), VLS "sam" (0, 9.0, −44),
CIWS (0, 16, 26) as before.

Tests run (new build vs an untouched copy of HEAD on another port):
- **Trap mission + autoland (Y)**, 3 runs: touchdown z 158.8–159.3, x −4.1 (old build: z 159.5, x −3.9),
  late wire at z ≈ 153, stopped at z ≈ 71 on the deck, `caughtWire`, mission won (state `over`). Jet height on
  deck = `deckHeight` + gearOffset exactly (2.85) while the ship heaves/pitches.
- **Naval-mode catapult launch** (auto-takeoff): shot from z −6 along x 11.9, left the bow at z −159.9 at
  80 m/s, climbing (655 m after 25 s).
- `node --test tests/`: 208 pass, 0 fail. `node --check` on every changed file.

---

## L. Optional (not in the wiring commit)

**L1. Cable comes out of the painted wire** (`aircraft.js`). Today the drawn cable is anchored at the hook's
z at the moment of the catch — with autoland that is z ≈ 160, i.e. behind the stern. With the modelled
carrier the anchor can snap to the painted pendant just ahead of the hook (tested in-browser by patching):

```js
    catchWire() {
        …
        this.wire = { ship: this.deck, lz, x0: -4 - B * 0.36, x1: -4 + B * 0.36, fade: 1.5 };
        // modelled carrier: the cable comes out of the painted pendant the hook is running into
        const wires = this.deck.layout && this.deck.layout.wires;
        if (wires) {
            let best = null;
            for (const [[ax, az], [bx, bz]] of wires) {
                const zc = (az + bz) / 2;
                if (zc <= lz + 3 && lz - zc < 30 && (!best || zc > best.zc)) best = { zc, ax, az, bx, bz };
            }
            if (best) Object.assign(this.wire, { x0: best.ax, z0: best.az, x1: best.bx, z1: best.bz });
        }
        …
```
and in `updateWire()` use the per-end z (and a local deck height — `toWorld` already adds the ship's y):
```js
        const deckY = w.ship.def.deckY + 0.15;
        [w.x0, w.x1].forEach((x, i) => {
            const a = w.ship.toWorld(x, deckY, i ? (w.z1 ?? w.lz) : (w.z0 ?? w.lz));
```

**L2. Hook floor on a tilting deck** (`aircraft.js settleHook`):
`const floor = (this.deck ? (this.deck.deckHeight ? this.deck.deckHeight(tip.x, tip.z) : this.deck.deckY) : …) + 0.25;`

**L3. Autoland touchdown in the wires** (`autopilot.js geometry()`): the autopilot aims at 0.4 L but its wheels
meet the deck ~30 m short, right at the ramp (old and new build alike). Aiming at `s.def.L * 0.3` (as
`placeApproach('cv_approach')` already does) puts the touchdown at z ≈ 142 with an immediate trap, stopping
at z ≈ 61 (tested). Purely cosmetic; skip if autoland behaviour must not change.

---

## Rebuilding the models

`sh tools/ships/build.sh` (python3 + Pillow + numpy for the textures, Blender ≥ 4.2 for the meshes). The
layout constants (deck outline, elevators, wires, cats, mounts, parked aircraft) are in
`tools/ships/carrier_layout.py`; the Blender script writes them into the GLB's root `extras.skywar`, which
naval.js and shipfx.js read, so the game follows any change to the layout without code edits.

Model stats: carrier 20.2k triangles (static 18.4k + 2 radars + 5 turrets), 1.6 MB (1024×4096 deck
texture); destroyer 13.9k triangles, 0.75 MB. After `mergeStatic` a carrier is ~36 draw calls including
the six parked jets.
