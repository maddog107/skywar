# Flaps and speed brakes: how they're made and how to add an aircraft's

Flaps, spoilers and speed brakes are **cut out of the model's own skin** when a type is first used
(`src/surfaces.js`), so stowed they are just part of the wing or fuselage: same paint, same texture, no seam.
Deployed, each turns about its hinge line (and slides aft, for a Fowler flap) at the speed of a real actuator
(`Aircraft.updateSurfaces`, travel times in `surfaces.js` TRAVEL or per aircraft). Where a surface was cut
out, the opening is closed off: walls along a flap's cut (a dark flap well), a floor under a skin panel (a
speed brake bay).

Each aircraft's surfaces are data in `src/surfacedefs.js`. The header there documents every field. In
short:

- **Outline:** a convex outline seen from above (`top`, with a height band `y`) or from the side (`side`,
  with a band across `x`).
- **Motion:** a `hinge` line, an `angle` at full travel, and optionally `slide` for Fowler flaps.
- **Skin:** `skin: 0` (a flap: the whole thickness) or `±1` (a panel of the upper/lower skin: spoilers,
  dorsal/ventral brakes).
- **Units:** every number is a fraction of the aircraft's length L, in model space (x toward the right
  wing, y up, nose toward −z, centred on the bounding box). Defs describe the right-hand surface; the left
  one is mirrored.

The F-15 (plain flaps, dorsal brake) and the 737 (Fowler flaps, spoilers, dihedral) are worked examples.

## Workflow

1. `node server.mjs` and a tiny PNG upload server (POST a data URL, write the file). Then open
   `/tools/aircraft/preview.html` and wait for the page title to read `READY` (the models are loaded only
   then). `window.P` is `tools/aircraft/preview.js`; call `P.setUpload(url)` for your upload server.
2. **Measure** with blueprints: an orthographic view with a grid in fractions of L.
   - `P.blueprint(id, { view: 'top' })` for the plan. Zoom with `win`: `[x0, x1, z0, z1]` for top,
     `[z0, z1, y0, y1]` for side, `[x0, x1, y0, y1]` for front.
   - `view: 'side'` for heights along the fuselage.
   - `view: 'front', cut: z` shows only what lies aft of `z`, seen from behind. Use it for the wing's
     height and thickness at the trailing edge, and for dihedral.
   - Save a canvas with `await P.save(canvas, 'name.png')` and look at the PNG. Panel lines in the texture
     often show where the real flaps are; use them.
3. **Write the def** in `src/surfacedefs.js`, reload the preview page, and render the blueprint again. It
   draws your outlines (cyan flaps, yellow brakes) and hinge lines (red) over the model.
4. **Check the motion** with close-ups: `P.closeup(id, flap, brake, { at: [x, y, z], dir: [dx, dy, dz],
   dist, w, h })` at 0, 0.5 and 1, from above, below, behind and the side. Put several in one image with
   `P.sheet([[label, [canvas, ...]], ...], title)`.
   - Stowed must look **exactly** like the original. Compare against an uncut copy:
     `await P.loadNew({ id: { file: 'aircraft/id.glb', rot: [0, 0, 0] } })` registers `new_<id>`, which
     has no defs.
   - Look for holes from below and behind (a band that took the other skin), stray pieces of other parts
     riding on a surface (missiles, pylons, stabilisers, antennas inside the outline), torn edges, and
     surfaces moving the wrong way.
5. **In the game:** launch free flight in that aircraft. Put it in the air with
   `game.player.spawnAir(new Vector3(0, 1500, 0), 0, 0.3)` (slow, or the flaps blow up at 175 m/s). Set
   `player.flaps = 2` and `game.input.spoilersOn = true`, and step with `window.skywarStep(n)`.
   `player.surfaces.length` shows how many surfaces were made. Check there are no console warnings: a
   failed cut logs `[models] could not cut surfaces`.

## Pitfalls

- **Flaps (`skin: 0`):** the band must cover the wing's whole thickness at the trailing edge, including
  flap-track fairings that hang below. It must not reach anything else inside the outline: stabilisers,
  stores, pylons, the fuselage. Keep the inboard edge just off the fuselage side.
- **Hinges:** put a plain flap's hinge on the upper skin at its front edge, so the top of the wing stays
  sealed as it drops. For a Fowler flap, add `slide` (aft along the tracks, which run roughly along +z,
  about 0.6 × the flap chord) and it opens a slot.
- **Skin panels (`skin: ±1`)** automatically take only triangles facing their way. Still keep the band
  from the wing's mid-thickness to above the skin. A wing with dihedral needs `dihedral: deg`, which tilts
  the band.
- **Angle signs:** about a hinge running along x, a positive angle takes the aft part down. Flaps and
  lower/ventral panels are positive; spoilers and dorsal panels are negative. About a hinge along y,
  positive swings the aft part outboard (fuselage side brakes). Hinge direction doesn't matter; the axis is
  normalised.
- **Split surfaces** (A-10 decelerons, B-2 drag rudders, clamshell tail brakes): use two brake defs on the
  same outline. The upper skin gets `skin: 1` and a negative angle; the lower skin gets `skin: -1` and a
  positive angle. When the model builds the surface as two bodies meeting face to face (the B-2), add
  `split: true` to both: each half then takes the inner face turned its way too, and gets walls across its
  own section instead of a bay floor, so nothing is left between the halves when they open.
- **Parts modelled as their own solids** (the F-16's flaperons and speed-brake petals, which were separate
  meshes in its GLB; a flaperon modelled with a gap all round it): use `whole: true`. The triangles are
  taken whole by where their centre lies, never clipped, and nothing closes the opening, since the part was
  closed all round. Two parts that touch face to face (upper and lower petals) each keep their own face; a
  height band tilted with `dihedral` along the split between them tells them apart. `whole: <nudge in L>`
  lets the outline follow a curved gap loosely.
- **Single-sheet skins** (the F-14's beaver tail) and **drooped split surfaces** (the A-10's decelerons,
  modelled half open with their fittings inside): `depth: 0` closes nothing (no walls, floor or inside
  face). `clip: [[point, normal]]` adds a plane to the region, e.g. the split between the deceleron halves,
  when the halves can't be told apart by the way their faces point.
- **Stowed wells:** the walls and floors closing an opening are shown only while their surface is out of
  its stowed position, so a stowed surface can't show a dark line where its cut meets.
- **Centreline surfaces** (dorsal, ventral, beaver-tail brakes) need `mirror: false`.
- **Count:** keep it to about 6 surfaces per aircraft. Each is a couple of extra draw calls on every jet
  of that type.
- The game has two flap notches: takeoff is half the def's angle, landing the full angle.

## What each aircraft really has (starting point: check it)

| id | flaps | speed brake |
|---|---|---|
| f16, f2 | flaperons droop 20° (the F-16 model's `Aileron` parts, `whole`) | split petals beside the nozzle, 30° up and 30° down (F-16: the model's `Brake` parts, `whole`) |
| f22 | flaperons droop 25° | none dedicated (uses control surfaces): none |
| f35, f35n | flaperons droop 25° | none dedicated: none |
| fa18 | E/F: big single-slotted TE flaps, 40° with a little aft travel | the E/F has no dorsal brake (that was the legacy Hornet): LEX spoilers rise 60° |
| f14 | TE flaps, but this model's wings are fixed fully swept, where the real flaps are locked out: none | upper and lower beaver-tail panels, 60° each (`depth: 0`) |
| f4 | inboard TE flaps 60°, the ailerons droop 16.5° with them | underwing panels aft of the gear wells, 50° down |
| a10 | inboard flaps (two pieces a side) 20° | decelerons: upper half up 55°, lower half down 25° from the model's drooped pose (`clip`, `depth: 0`) |
| f5 | TE flaps root to the kink, 20° | two ventral panels ahead of the main gear, 50° |
| su35, su57, su47 | flaperons / TE flaps | Su-35: big dorsal brake behind the canopy; Su-57: none; Su-47: research |
| mig29 | TE flaps | upper and lower split panels in the tail between the engines |
| mig31, mig25 | TE flaps | ventral airbrakes (research where) |
| mig21 | plain inboard flaps | ventral airbrakes behind the nose gear |
| j20 | flaperons | none dedicated: none |
| j10 | flaperons / elevons | rear fuselage airbrakes (research) |
| j8 | TE flaps | ventral airbrakes |
| typhoon | inboard flaperons (droop for landing/takeoff) | dorsal brake behind the canopy |
| rafale | inboard elevons droop | none dedicated: none |
| gripen | elevons | rear fuselage side brakes, swinging outward |
| mirage (IIIE) | none (elevons) | small panels above and below each wing |
| jaguar | double-slotted flaps, nearly full span | ventral airbrakes under the rear fuselage |
| b2 | none | split drag rudders at the wing tips (upper and lower skin of the outboard trailing edge) |
| b747 | triple-slotted Fowler flaps inboard and outboard | spoilers ahead of the flaps |
| c130 | Fowler flaps across the trailing edge inside the ailerons | none |
| cessna | large flaps on the inboard half of the wing (30°, electric: `travel: { flap: 9 }`) | none |
| racer | split flaps if the model has them | none |
| pitts | none | none |
