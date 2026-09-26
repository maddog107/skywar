// ═══════════════════════════════════════════════════════════════
// Military ground vehicles: rigged models for the war layer (TELs, SAMs, radars, command posts, rocket
// artillery, APCs, support trucks). Models are built in Blender by tools/vehicles/*.py (models/vehicles/*.glb,
// see models/vehicles/CREDITS.md): real size in metres, facing −Z, wheels on y = 0, moving parts as named nodes
// with their origin on the pivot. Each moving node carries its joint (userData.joint, from the glTF extras):
//   { type: 'rot' | 'slide' | 'spin', axis: [x, y, z] (parent frame), min, max, stow, deploy, group, rpm }
// and the root carries the rig description (userData.vk: wheels, rams, tracks, dimensions).
//
//   preloadVehicles({ background: true });         // main.js, right after the boot's preloads (loads once idle)
//   await vehiclesReady();
//   const { object, rig } = createVehicle('scud', { paint: 'red_green' }); // a fresh copy (geometry, materials shared)
//   for (const g of VEHICLES.scud.deploy) pose(rig, g, 1);  // travel → firing: jacks, pad, erector (0 … 1 each)
//   deployJacks(rig, k); deployPad(rig, k); raise(rig, k); openDoors(rig, k); openHatches(rig, k); stow(rig);
//   aim(rig, yaw, pitch); spin(rig, dt); roll(rig, metres); steer(rig, angle);
//   muzzleWorld(rig, i, pos, dir);                 // launch point and direction of tube / rail / canister i
//   staticVehicle(object);                         // a merged copy in its current pose (parked / distant vehicles)
//
// rig: nodes (every named node), joints / byGroup / byName, muzzles, missiles, canisters, wheels, tracks, rams,
// and shortcuts (erector, missile, pad, turret, launcher, antenna, mast, jacks.fl…rr, exhaust, seat, hatch).
// Every helper only moves nodes (no allocation); rams re-aim themselves after each pose change.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeStaticModel } from './meshmerge.js';

// cls: the war layer's class strings (docs/WAR.md). dims: metres (the models are built to them; rig.dims has the
// measured box). crew: seats. speed: road km/h. arm: what it carries (the launcher nodes the rig exposes).
// muzzles: how many muzzle_n empties. parts: the named rig nodes. deploy: the pose groups to run, in order, to go
// from travel to firing (pose(rig, group, 1) each; reverse order to stow).
export const VEHICLES = {
    scud: {
        name: '9P117M1 TEL, 9K72 Elbrus (SS-1C Scud-B)', short: 'SCUD TEL', cls: 'tel', team: 'red', file: 'scud.glb', paint: 'red_camo',
        chassis: 'MAZ-543A 8×8', dims: { length: 12.4, width: 3.07, height: 3.4 }, crew: 4, mass: 37.4, speed: 60,
        arm: '1 × R-17 (8K14) ballistic missile: 11.16 m, 0.88 m, 300 km, 985 kg warhead', muzzles: 0,
        // erector: rot x about the rear hinge, 0 → 90°; missile: child of the erector, origin on its base, nose along −z;
        // nozzle: empty, −z along the exhaust; pad: the launch table, swung down 90° under the erected missile
        parts: ['body', 'erector', 'missile', 'nozzle', 'pad', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'ram_l', 'ram_r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['jack', 'pad', 'raise'],
    },
    bastion: {
        name: 'K-340P launcher, K-300P Bastion-P (SSC-5 Stooge)', short: 'BASTION', cls: 'tel', team: 'red', file: 'bastion.glb', paint: 'red_green',
        chassis: 'MZKT-7930 8×8', dims: { length: 12.7, width: 3.07, height: 3.6 }, crew: 3, mass: 44, speed: 70,
        arm: '2 × P-800 Oniks (SS-N-26) supersonic anti-ship missiles in transport-launch canisters, 300 km', muzzles: 2,
        // door_l/door_r: the housing's roof halves (gull-wing, 0 → 125°); erector: the canister cradle, rot x about the
        // rear trunnions 0 → 90° (canisters vertical, bases near the ground); muzzle_n on the canisters' front covers
        parts: ['body', 'door_l', 'door_r', 'erector', 'canister_1', 'canister_2', 'muzzle_1', 'muzzle_2', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'ram_l', 'ram_r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['door', 'jack', 'raise'],
    },
    m270: {
        name: 'M270A1 Multiple Launch Rocket System', short: 'M270 MLRS', cls: 'artillery', team: 'blue', file: 'm270.glb', paint: 'blue_green',
        chassis: 'M993 carrier (lengthened Bradley), tracked', dims: { length: 6.97, width: 2.97, height: 2.59 }, crew: 3, mass: 24, speed: 64,
        arm: '2 pods × 6 GMLRS / M26 227 mm rockets (or 2 × ATACMS), 70+ km', muzzles: 12,
        // turret: the launcher-loader module, rot y (full circle); launcher: the cage, rot x about its rear pivot 0 → 60°
        // (muzzles face forwards when stowed); muzzle_1-6 left pod, 7-12 right pod (top row first); door_l/door_r: cab
        // doors; hatch_roof; road wheels wheel_1..6<l|r>, sprocket_<l|r>, idler_<l|r>; track_l/track_r scroll with roll()
        parts: ['body', 'turret', 'launcher', 'ram_l', 'ram_r', 'door_l', 'door_r', 'hatch_roof', 'track_l', 'track_r', 'sprocket_l', 'sprocket_r', 'idler_l', 'idler_r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: [],
    },
    sentinel: {
        name: 'AN/MPQ-64 Sentinel air-defence radar', short: 'SENTINEL', cls: 'radar', team: 'blue', file: 'sentinel.glb', paint: 'blue_green',
        chassis: 'two-wheel trailer (towed by a HMMWV)', dims: { length: 3.4, width: 2.2, height: 3.4 }, crew: 3, mass: 3.4, speed: 88,
        arm: 'X-band 3-D surveillance radar, 40 km instrumented range, IFF; cues short-range air defence', muzzles: 0,
        // antenna: spin about the pedestal axis at 30 rpm (spin(rig, dt)); jack_fl/fr/rl/rr: levelling jacks, jack_nose: the
        // drawbar leg with its caster (all group 'jack'); door_box: operator door; kingpin: the towing eye (−z to the tow vehicle)
        parts: ['body', 'antenna', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'jack_nose', 'door_box', 'wheel_1l', 'wheel_1r', 'kingpin', 'hatch_entry'],
        deploy: ['jack'],
    },
    osa: {
        name: '9A33BM3 TELAR, 9K33M3 Osa-AKM (SA-8 Gecko)', short: 'OSA', cls: 'sam', team: 'red', file: 'osa.glb', paint: 'red_green',
        chassis: 'BAZ-5937 6×6 amphibious', dims: { length: 9.14, width: 2.75, height: 4.2 }, crew: 5, mass: 17.5, speed: 80,
        arm: '6 × 9M33M3 missiles in two packs of three ribbed containers, 10 km; 1S51M3 search / tracking radar', muzzles: 6,
        // turret: rot y, full circle; launcher: both container packs, rot x about their rear pivots 0 → 62° (+ up, muzzles
        // face forwards when stowed); mast: the search radar, folded back when stowed (raise 0 → 90°); antenna: spins on
        // the mast (33 rpm); muzzle_1-3 left pack (outer → inner), 4-6 right pack; hatch_l/hatch_r: cab roof lids
        parts: ['body', 'turret', 'launcher', 'mast', 'antenna', 'muzzle_1', 'muzzle_6', 'hatch_l', 'hatch_r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['raise'],
    },
    s300: {
        name: '5P85S launcher, S-300PS (SA-10B Grumble)', short: 'S-300 TEL', cls: 'sam', team: 'red', file: 's300.glb', paint: 'red_camo',
        chassis: 'MAZ-543M 8×8', dims: { length: 13.11, width: 3.15, height: 3.8 }, crew: 4, mass: 42.15, speed: 60,
        arm: '4 × 5V55 missiles in transport-launch canisters, 75 km', muzzles: 4,
        // erector: the lifting frame, rot x about the rear hinge 0 → 90° (canisters vertical, bases on the ground);
        // canister_1..4 (children of the erector, origin on the base, muzzle end along −z): 1-2 upper row left/right,
        // 3-4 lower row; muzzle_n on the canister caps (−z = launch direction, straight up when erected)
        parts: ['body', 'erector', 'canister_1', 'canister_2', 'canister_3', 'canister_4', 'muzzle_1', 'muzzle_4', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'ram_l', 'ram_r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['jack', 'raise'],
    },
    grad: {
        name: 'BM-21 Grad 122 mm multiple rocket launcher (Ural-4320)', short: 'GRAD', cls: 'artillery', team: 'red', file: 'grad.glb', paint: 'red_green',
        chassis: 'Ural-4320 6×6', dims: { length: 7.35, width: 2.4, height: 3.09 }, crew: 3, mass: 13.7, speed: 75,
        arm: '40 × 122 mm 9M22U rockets (4 rows of 10 tubes, 3 m long), 20 km; full salvo in 20 s', muzzles: 40,
        // turret: the traversing base over the rear bogie, rot y, 70° right (−) … 102° left (+); launcher: the tube pack,
        // rot x about its trunnions 0 → 55° (+ = muzzles up; they face forwards over the cab when stowed); muzzle_1..40
        // row by row from the top, left to right seen from behind; ram_l/ram_r: elevation rams (turret → pack)
        parts: ['body', 'turret', 'launcher', 'muzzle_1', 'muzzle_40', 'ram_l', 'ram_r', 'wheel_1l', 'wheel_1r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: [],
    },
    ammo_red: {
        name: 'Ural-4320 cargo truck (ammunition)', short: 'URAL AMMO', cls: 'ammo', team: 'red', file: 'ammo_red.glb', paint: 'red_green',
        chassis: 'Ural-4320 6×6', dims: { length: 7.37, width: 2.5, height: 3.0 }, crew: 2, mass: 13.2, speed: 85,
        arm: 'none; 4.5 t of ammunition crates under the tilt', muzzles: 0,
        // door_tail: the tailgate, rot x about the floor's rear edge 0 → 90° (down); the tilt's rear flap is rolled up
        parts: ['body', 'door_tail', 'wheel_1l', 'wheel_1r', 'wheel_3l', 'wheel_3r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['door'],
    },
    patriot_ln: {
        name: 'M903 launching station, MIM-104 Patriot (PAC-2), on the M860A1 semi-trailer', short: 'PATRIOT LS', cls: 'sam', team: 'blue', file: 'patriot_ln.glb', paint: 'blue_tan',
        chassis: 'M860A1 semi-trailer (towed by the M983A4 HEMTT: see hemtt)', dims: { length: 12.2, width: 2.9, height: 3.9 }, crew: 3, mass: 25, speed: 80,
        arm: '4 × PAC-2 GEM-T missiles in canisters (6.1 × 1.09 × 0.99 m), 160 km; launched at a fixed 38° elevation', muzzles: 4,
        // turret: rot y ±110° about the rear turntable; launcher: the canister stack, rot x about its rear pivot 0 → 38° (the
        // canister fronts face forwards when stowed); canister_1..4 (children of the launcher: 1-2 upper left/right, 3-4 lower,
        // seen from behind) with muzzle_n on their front covers; ram_l/ram_r: elevation rams; mast: the data-link antenna mast
        // (slide up 2.4 m, group 'raise'); outrigger_fl/fr/rl/rr swing out 45° and jack_* screw down to the ground (both group
        // 'jack'); landing_gear: slide up 0.42 m for towing (group 'gear'); kingpin: empty on the gooseneck, match it to a
        // tractor's `hitch`; exhaust: the generator's
        parts: ['body', 'turret', 'launcher', 'canister_1', 'canister_2', 'canister_3', 'canister_4', 'muzzle_1', 'muzzle_4', 'ram_l', 'ram_r', 'mast',
            'outrigger_fl', 'outrigger_fr', 'outrigger_rl', 'outrigger_rr', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'landing_gear', 'kingpin', 'wheel_1l', 'wheel_2r', 'exhaust', 'hatch_entry'],
        deploy: ['jack', 'raise', 'launcher'],
    },
    smerch: {
        name: '9A52-2 BM-30 Smerch 300 mm multiple rocket launcher', short: 'SMERCH', cls: 'artillery', team: 'red', file: 'smerch.glb', paint: 'red_green',
        chassis: 'MAZ-543M 8×8', dims: { length: 12.1, width: 3.05, height: 3.05 }, crew: 4, mass: 43.7, speed: 60,
        arm: '12 × 9M55 300 mm rockets (7.6 m), 70–90 km; a full salvo in 38 s', muzzles: 12,
        // turret: the rear turntable, rot y ±30°; launcher: the tube pack, rot x about its rear trunnions 0 → 55° (muzzles
        // face forwards when stowed; elevate before traversing); muzzle_1-4 top row left → right, 5-8 middle, 9-12 bottom;
        // ram_l/ram_r: elevating rams; jack_rl/jack_rr between the last two axles
        parts: ['body', 'turret', 'launcher', 'muzzle_1', 'muzzle_12', 'ram_l', 'ram_r', 'jack_rl', 'jack_rr', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['jack', 'launcher'],
    },
    buk: {
        name: '9A310M1 TELAR, 9K37M1 Buk-M1 (SA-11 Gadfly)', short: 'BUK', cls: 'sam', team: 'red', file: 'buk.glb', paint: 'red_camo',
        chassis: 'GM-569 tracked', dims: { length: 9.3, width: 3.25, height: 3.8 }, crew: 4, mass: 32.4, speed: 65,
        arm: '4 × 9M38M1 missiles on the launcher arm, 35 km; 9S35 Fire Dome fire-control radar', muzzles: 4,
        // turret: the turntable with the 9S35 radome at its front, rot y full circle; launcher: the missile arm, rot x about its
        // rear pivot 0 → 70° (+ = noses up); missile_1..4 (children of the launcher, origin at the tail, nose −z; 1-2 upper
        // inner, 3-4 lower outer) each with nozzle_n; muzzle_n at the noses; road wheels wheel_1..6<l|r>, sprocket_<l|r> (rear
        // drive), idler_<l|r> (front); track_l/track_r scroll with roll(); hatch_driver
        parts: ['body', 'turret', 'launcher', 'missile_1', 'missile_4', 'muzzle_1', 'muzzle_4', 'track_l', 'track_r', 'sprocket_l', 'sprocket_r', 'idler_l', 'idler_r', 'hatch_driver', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['launcher'],
    },
    cmd_blue: {
        name: 'M1113 HMMWV command post with S-788 shelter', short: 'COMMAND HMMWV', cls: 'command', team: 'blue', file: 'cmd_blue.glb', paint: 'blue_tan',
        chassis: 'M1113 HMMWV 4×4 (heavy variant)', dims: { length: 4.95, width: 2.16, height: 2.65 }, crew: 4, mass: 5.2, speed: 113,
        arm: 'command post: tactical radios (whip antennas) and a telescopic antenna mast; unarmed', muzzles: 0,
        // mast / mast_2 / mast_3: telescopic mast sections (slide +y 1.35 m each, group 'raise'; mast_head = the antenna top);
        // door_l / door_r: cab doors; door_shelter: the shelter's rear door; wheels 1l/1r steer
        parts: ['body', 'mast', 'mast_2', 'mast_3', 'mast_head', 'door_l', 'door_r', 'door_shelter', 'spare', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['raise'],
    },
    patriot_radar: {
        name: 'AN/MPQ-65 radar set, MIM-104 Patriot, on the M860 semi-trailer', short: 'PATRIOT RADAR', cls: 'sam-radar', team: 'blue', file: 'patriot_radar.glb', paint: 'blue_tan',
        chassis: 'M860 semi-trailer (towed by the M983A4 HEMTT: see hemtt)', dims: { length: 12.2, width: 2.9, height: 4.1 }, crew: 0, mass: 26, speed: 80,
        arm: 'C-band passive phased-array multifunction radar (search, track, missile guidance), 150+ km; IFF; guides the launchers\' PAC-2 / PAC-3 missiles', muzzles: 0,
        // mast: the antenna, rot about −x at the hinge on the shelter's front 0 → 71.6° (flat on the roof face-up for travel →
        // leaning back 18.4° from vertical, facing forward: aim the trailer at the threat sector); outrigger_fl/fr/rl/rr swing out
        // and jack_* screw down (group 'jack'); landing_gear: slide up for towing (group 'gear'); kingpin for a tractor's hitch
        parts: ['body', 'mast', 'outrigger_fl', 'outrigger_fr', 'outrigger_rl', 'outrigger_rr', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'landing_gear', 'kingpin', 'wheel_1l', 'wheel_2r', 'hatch_entry'],
        deploy: ['jack', 'raise'],
    },
    flaplid: {
        name: '30N6E engagement / illumination radar (Flap Lid B), S-300PMU', short: 'FLAP LID', cls: 'sam-radar', team: 'red', file: 'flaplid.glb', paint: 'red_camo',
        chassis: 'MAZ-7910 8×8', dims: { length: 12.0, width: 3.1, height: 3.7 }, crew: 4, mass: 40, speed: 60,
        arm: 'X-band phased-array fire-control radar: tracks 12 targets, guides 6 missiles; the post turns a full circle, array about 3.2 × 2.9 m', muzzles: 0,
        // mast / mast_s1: the telescopic mast, slide up 2.2 / 1.1 m (group 'raise'); turret: the antenna post on top of the
        // mast, rot y full circle (aim yaw); array: the phased array, rot x about its hinge on the post's front edge 0 → 105°
        // (folded face-down over the cabin roof → leaning back 15° past vertical, facing −z at yaw 0; group 'raise')
        parts: ['body', 'mast_s1', 'mast', 'turret', 'array', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['jack', 'raise'],
    },
    p18: {
        name: 'P-18 "Spoon Rest D" VHF search radar, antenna vehicle (Ural-4320)', short: 'P-18 RADAR', cls: 'radar', team: 'red', file: 'p18.glb', paint: 'red_green',
        chassis: 'Ural-4320 6×6', dims: { length: 7.37, width: 2.5, height: 3.6 }, crew: 4, mass: 14.5, speed: 75,
        arm: 'VHF (150–170 MHz) 2-D early-warning radar, 16 Yagi antennas, 250 km, 6 rpm; the array stands about 9.7 m up', muzzles: 0,
        // mast: rot x about the hinge at the rear of the body, 0 → 90° (lies forward over the cab when stowed); antenna: spins
        // about the mast at 6 rpm (spin only when raised); array_l / array_r: the boom halves fold back along the mast,
        // post_<l|r><1-4> turn, yagi_<l|r><1-4><t|b> roll flat for travel — all in group 'raise', so raise(rig, k) unfolds it all
        parts: ['body', 'mast', 'antenna', 'array_l', 'array_r', 'post_l1', 'post_r4', 'yagi_l1t', 'yagi_r4b', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['jack', 'raise'],
    },
    stryker: {
        name: 'M1126 Stryker Infantry Carrier Vehicle', short: 'STRYKER', cls: 'vehicle', team: 'blue', file: 'stryker.glb', paint: 'blue_tan',
        chassis: 'Stryker 8×8 (LAV III family)', dims: { length: 6.95, width: 2.72, height: 2.64 }, crew: 2, troops: 9, mass: 16.5, speed: 97,
        arm: 'M151 Protector remote weapon station with a 12.7 mm M2 machine gun, smoke grenade launchers', muzzles: 1,
        // turret: the RWS, rot y full circle; launcher: the M2 cradle, rot x −20° → 60°; muzzle_1: the M2 muzzle; door_ramp: rear
        // ramp, rot x about its bottom hinge 0 → 116° (onto the ground); hatch_driver, hatch_cmd; wheels 1 and 2 steer (1.0, 0.55)
        parts: ['body', 'turret', 'launcher', 'muzzle_1', 'door_ramp', 'hatch_driver', 'hatch_cmd', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: [],
    },
    btr80: {
        name: 'BTR-80 armoured personnel carrier', short: 'BTR-80', cls: 'vehicle', team: 'red', file: 'btr80.glb', paint: 'red_green',
        chassis: 'BTR-80 8×8 amphibious', dims: { length: 7.65, width: 2.9, height: 2.41 }, crew: 3, troops: 7, mass: 13.6, speed: 80,
        arm: 'BPU-1 turret: 14.5 mm KPVT and 7.62 mm PKT machine guns; six 902V smoke-grenade launchers', muzzles: 2,
        // turret: rot y full circle; launcher: the gun mantlet, rot x −4° → 60°; muzzle_1: KPVT, muzzle_2: PKT; door_l/door_r:
        // side doors between axles 2 and 3 (rot about their front edges, 0 → 100°); hatch_l/hatch_r: driver's and commander's
        // roof hatches; hatch_turret; wheels 1 and 2 steer (1.0, 0.6)
        parts: ['body', 'turret', 'launcher', 'muzzle_1', 'muzzle_2', 'door_l', 'door_r', 'hatch_l', 'hatch_r', 'hatch_turret', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: [],
    },
    cmd_red: {
        name: 'Command-staff vehicle (KShM, Ural-4320 with a K-4320 box body)', short: 'COMMAND POST', cls: 'command', team: 'red', file: 'cmd_red.glb', paint: 'red_green',
        chassis: 'Ural-4320 6×6', dims: { length: 7.6, width: 2.5, height: 3.45 }, crew: 2, staff: 5, mass: 12.5, speed: 80,
        arm: 'none; HF/VHF radio stations, secure communications, the battalion or brigade command post', muzzles: 0,
        // mast: rot about −x at its hinge on the roof front, 0 → 90° (lies back along the roof when stowed); mast_2 / mast_3:
        // telescopic sections sliding out 2.4 m each (all 'raise': about 11 m up when raised); mast_head: empty at the top;
        // door_rear: the box body's door (rot y 0 → 100°, group 'door'); whip antennas stand on the roof corners
        parts: ['body', 'mast', 'mast_2', 'mast_3', 'mast_head', 'door_rear', 'wheel_1l', 'wheel_1r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['raise'],
    },
    fuel_red: {
        name: 'ATZ-5-4320 fuel tanker (Ural-4320)', short: 'URAL FUEL', cls: 'fuel', team: 'red', file: 'fuel_red.glb', paint: 'red_green',
        chassis: 'Ural-4320 6×6', dims: { length: 7.4, width: 2.5, height: 3.1 }, crew: 2, mass: 15.5, speed: 80,
        arm: 'none; 5,000 l of fuel, pump and dispensing hose (it burns and explodes when hit)', muzzles: 0,
        // door_l / door_r: the rear pump compartment's doors (rot y 0 → ±110°, group 'door'): pump, meter and hose reel inside
        parts: ['body', 'door_l', 'door_r', 'wheel_1l', 'wheel_1r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['door'],
    },
    crane: {
        name: 'Truck crane / Scud transloader (KS-35714-style, Ural-4320)', short: 'CRANE TRUCK', cls: 'vehicle', team: 'red', file: 'crane.glb', paint: 'red_green',
        chassis: 'Ural-4320 6×6', dims: { length: 8.0, width: 2.5, height: 3.45 }, crew: 2, mass: 17.5, speed: 60,
        arm: 'none; 16 t crane with a 10 m telescopic boom, reloads Scud / missile launchers', muzzles: 0,
        // turret: slewing, rot y full circle; boom: rot x about its foot 0 → 70° ('raise'); boom_2: the telescopic section,
        // slides out 3.6 m ('raise'); hook: counter-rotates so it hangs plumb as raise(rig, k) lifts the boom; ram_l: luffing
        // ram; outrigger_fl/fr/rl/rr slide out and jack_fl/fr/rl/rr go down (group 'jack'). Raise before slewing (the boom
        // rests over the cab when stowed)
        parts: ['body', 'turret', 'boom', 'boom_2', 'hook', 'ram_l', 'outrigger_fl', 'outrigger_rr', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['jack', 'raise'],
    },
    hemtt: {
        name: 'M983A4 HEMTT A4 tractor', short: 'HEMTT TRACTOR', cls: 'vehicle', team: 'blue', file: 'hemtt.glb', paint: 'blue_tan',
        chassis: 'Oshkosh HEMTT A4 8×8', dims: { length: 9.12, width: 2.44, height: 3.0 }, crew: 2, mass: 16.2, speed: 100,
        arm: 'none; prime mover for the Patriot launching station and radar set (fifth wheel, 9.5 t vertical load)', muzzles: 0,
        // hitch: empty on the fifth wheel (where a semi-trailer's `kingpin` goes: patriot_ln, patriot_radar — raise their
        // landing gear with pose(rig, 'gear', 1) when coupled); door_l/door_r: cab doors (group 'door'); the front tandem steers
        parts: ['body', 'hitch', 'door_l', 'door_r', 'wheel_1l', 'wheel_1r', 'wheel_4l', 'wheel_4r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: [],
    },
    fuel_blue: {
        name: 'M978A4 HEMTT A4 fuel servicing truck', short: 'HEMTT FUELER', cls: 'fuel', team: 'blue', file: 'fuel_blue.glb', paint: 'blue_tan',
        chassis: 'Oshkosh HEMTT A4 8×8', dims: { length: 10.3, width: 2.44, height: 3.0 }, crew: 2, mass: 30, speed: 100,
        arm: 'none; 2,500 US gal (9,500 L) of fuel, pump and hose reels in the rear module', muzzles: 0,
        // door_l/door_r: cab doors; door_pump: the pump module's side door (all group 'door'); the front tandem steers
        parts: ['body', 'door_l', 'door_r', 'door_pump', 'wheel_1l', 'wheel_1r', 'wheel_4l', 'wheel_4r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['door'],
    },
    himars: {
        name: 'M142 High Mobility Artillery Rocket System', short: 'HIMARS', cls: 'artillery', team: 'blue', file: 'himars.glb', paint: 'blue_green',
        chassis: 'FMTV 6×6 (M1140) with the armoured cab', dims: { length: 6.94, width: 2.44, height: 3.18 }, crew: 3, mass: 16.25, speed: 85,
        arm: '1 pod × 6 GMLRS (M30 / M31) 227 mm guided rockets, 70+ km (or 1 ATACMS / PrSM)', muzzles: 6,
        // turret: the launcher-loader module on its turntable over the tandem, rot y (full circle; raise the launcher before
        // traversing); launcher: the cage and pod, rot x about the rear pivot 0 → 60° (the pod's covered front ends face the
        // cab when stowed); muzzle_1-3 upper row left → right seen from behind, 4-6 lower row; ram_l/ram_r: elevation rams;
        // door_l/door_r: cab doors; the front axle steers
        parts: ['body', 'turret', 'launcher', 'muzzle_1', 'muzzle_6', 'ram_l', 'ram_r', 'door_l', 'door_r', 'wheel_1l', 'wheel_1r', 'wheel_3l', 'wheel_3r', 'exhaust', 'seat_driver', 'hatch_entry'],
        deploy: ['launcher'],
    },
};

// Paint schemes: models/vehicles/tex/paint_<scheme>.jpg (tools/vehicles/textures.py)
export const PAINTS = ['red_camo', 'red_green', 'blue_green', 'blue_tan'];

const BASE = 'models/vehicles/';
const cache = {};          // id → { scene, meta }
let loading = null;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix3();

// ── shared materials (one set for every vehicle) ──
let texLoader = null;
const texCache = {};
let texPending = 0, texWaiters = [];
const texDone = () => { if (--texPending <= 0) { texPending = 0; texWaiters.splice(0).forEach(f => f()); } };
// resolves once every texture requested so far has loaded (or failed)
export function whenTexturesLoaded() { return texPending ? new Promise(r => texWaiters.push(r)) : Promise.resolve(); }
function tex(name, srgb = true, repeat = false) {
    if (texCache[name]) return texCache[name];
    if (texLoader) texPending++;
    const t = !texLoader ? new THREE.Texture() : texLoader.load(BASE + 'tex/' + name, texDone, undefined, (e) => { console.warn('[vehicles] texture failed', name, e); texDone(); });
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false; // glTF UV convention (v = 0 at the top of the image), as GLTFLoader's own textures
    t.anisotropy = 8;
    t.name = name;
    return (texCache[name] = t);
}
const MATS = { paint: {}, detail: null, track: null };
export function paintMaterial(scheme) {
    if (!PAINTS.includes(scheme)) scheme = 'red_camo';
    return MATS.paint[scheme] || (MATS.paint[scheme] = new THREE.MeshStandardMaterial({
        name: 'Paint', map: tex('paint_' + scheme + '.jpg', true, true), roughness: 0.74, metalness: 0.08, envMapIntensity: 0.75,
    }));
}
function detailMaterial() {
    if (MATS.detail) return MATS.detail;
    const orm = tex('detail_orm.png', false);
    return (MATS.detail = new THREE.MeshStandardMaterial({
        name: 'Detail', map: tex('detail.png'), roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, envMapIntensity: 1,
    }));
}
function trackMaterial() {
    return MATS.track || (MATS.track = new THREE.MeshStandardMaterial({
        name: 'Track', map: tex('track.jpg', true, true), roughness: 0.8, metalness: 0.35, envMapIntensity: 0.6,
    }));
}

// ── loading ──
// opts.background: return at once and load once the page is idle (after the boot's own work), so the vehicles never
// hold up the boot; await vehiclesReady() before createVehicle(). opts.fetchBuffer(url) → ArrayBuffer lets tests
// load the files without a browser; opts.textures = false skips images; opts.ids limits the set.
const stats = { start: 0, end: 0, files: 0, bytes: 0, parseMs: 0 };
export function vehicleLoadStats() { return { ...stats }; }
let readyResolve = null;
const ready = new Promise(r => (readyResolve = r));
export function preloadVehicles(opts = {}) {
    if (loading) return opts.background ? Promise.resolve() : loading;
    loading = ready;
    const run = () => loadAll(opts).then(readyResolve);
    if (!opts.background) { run(); return loading; }
    const idle = globalThis.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(run, { timeout: 4000 });
    return Promise.resolve();
}
async function loadAll(opts) {
    if (opts.textures !== false && typeof document !== 'undefined' && document.createElementNS) texLoader = new THREE.TextureLoader();
    const loader = new GLTFLoader();
    const now = () => (globalThis.performance ? performance.now() : Date.now());
    stats.start = now();
    const ids = opts.ids || Object.keys(VEHICLES);
    await Promise.all(ids.map(async (id) => {
        try {
            const url = BASE + VEHICLES[id].file;
            const buf = opts.fetchBuffer ? await opts.fetchBuffer(url) : await (await fetch(url)).arrayBuffer();
            const t0 = now();
            const gltf = await loader.parseAsync(buf, BASE);
            cache[id] = prepare(id, gltf.scene);
            stats.parseMs += now() - t0;
            stats.files++;
            stats.bytes += buf.byteLength;
        } catch (e) {
            console.warn('[vehicles] failed to load', id, e && e.message);
        }
    }));
    stats.end = now();
}
export function vehiclesReady() { return loading || ready; }
export function hasVehicle(id) { return !!cache[id]; }

function prepare(id, scene) {
    const root = scene.getObjectByName(id) || scene.children[0] || scene;
    let meta = {};
    try { meta = JSON.parse(root.userData.vk || '{}'); } catch (e) { /* no rig metadata */ }
    const scheme = VEHICLES[id].paint;
    root.traverse((o) => {
        if (o.userData && typeof o.userData.joint === 'string') {
            try { o.userData.joint = JSON.parse(o.userData.joint); } catch (e) { delete o.userData.joint; }
        }
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const swap = (m) => m && (m.name === 'Paint' ? paintMaterial(scheme) : m.name === 'Detail' ? detailMaterial() : m.name === 'Track' ? trackMaterial() : m);
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    return { scene: root, meta };
}

// ── instances ──
// opts.paint: a scheme from PAINTS (default: the vehicle's own)
export function createVehicle(id, opts = {}) {
    const src = cache[id];
    if (!src) throw new Error('[vehicles] not loaded: ' + id);
    const object = src.scene.clone(true);
    object.name = id;
    const rig = buildRig(id, object, src.meta);
    if (opts.paint && opts.paint !== VEHICLES[id].paint) repaint(object, opts.paint);
    if (rig.tracks.length) {
        // each side's track gets its own material copy so it can scroll on its own (the image is shared)
        for (const t of rig.tracks) {
            const m = trackMaterial().clone();
            m.map = trackMaterial().map.clone();
            t.node.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(x => x.name === 'Track' ? m : x) : (o.material.name === 'Track' ? m : o.material); });
            t.material = m;
        }
    }
    return { object, rig };
}

export function repaint(object, scheme) {
    const m = paintMaterial(scheme);
    object.traverse(o => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map(x => x.name === 'Paint' ? m : x) : (o.material.name === 'Paint' ? m : o.material);
    });
}

function buildRig(id, object, meta) {
    const nodes = {};
    object.traverse(o => { if (o.name) nodes[o.name] = o; });
    const rig = {
        id, spec: VEHICLES[id], object, nodes, meta,
        dims: meta.dims || null,
        joints: [], byGroup: {}, byName: {},
        wheels: [], rams: [], tracks: [], muzzles: [], missiles: [], canisters: [],
        erector: nodes.erector || null, missile: nodes.missile || null, pad: nodes.pad || null,
        turret: nodes.turret || null, launcher: nodes.launcher || null, antenna: nodes.antenna || null, mast: nodes.mast || null,
        jacks: { fl: nodes.jack_fl || null, fr: nodes.jack_fr || null, rl: nodes.jack_rl || null, rr: nodes.jack_rr || null },
        exhaust: nodes.exhaust || null, seat: nodes.seat_driver || null, hatch: nodes.hatch_entry || null,
        state: { raise: 0, jack: 0, pad: 0, yaw: 0, pitch: 0 },
    };
    for (const o of Object.values(nodes)) {
        const j = o.userData.joint;
        if (!j || typeof j !== 'object') continue;
        const e = { node: o, j, restPos: o.position.clone(), restQuat: o.quaternion.clone(), axis: new THREE.Vector3().fromArray(j.axis), value: j.stow || 0 };
        rig.joints.push(e);
        rig.byName[o.name] = e;
        const g = j.group || j.type;
        (rig.byGroup[g] || (rig.byGroup[g] = [])).push(e);
    }
    const numbered = (prefix) => Object.keys(nodes).filter(n => new RegExp('^' + prefix + '_\\d+$').test(n))
        .sort((a, b) => +a.split('_').pop() - +b.split('_').pop()).map(n => nodes[n]);
    rig.muzzles = numbered('muzzle');
    rig.missiles = numbered('missile');
    rig.canisters = numbered('canister');
    for (const w of meta.wheels || []) {
        const node = nodes[w.node];
        if (!node) continue;
        node.rotation.reorder('YXZ'); // yaw (steering) outside, spin inside
        rig.wheels.push({ node, r: w.r, steer: w.steer || 0, side: w.side || 1, yaw0: node.rotation.y, spin: node.rotation.x });
    }
    for (const r of meta.rams || []) {
        const node = nodes[r.node], end = nodes[r.end];
        if (!node || !end) continue;
        const e = { node, end, len: r.len, restQuat: node.quaternion.clone(), stages: r.stages.map(n => ({ node: nodes[n], rest: nodes[n].position.clone() })), restDir: new THREE.Vector3() };
        // rest direction in the parent frame: base → anchor, measured in the rest pose
        object.updateMatrixWorld(true);
        e.restDir.copy(end.getWorldPosition(_v)).sub(node.getWorldPosition(_v2));
        e.restDir.applyMatrix3(_m.setFromMatrix4(node.parent.matrixWorld).invert()).normalize();
        rig.rams.push(e);
    }
    for (const t of meta.tracks || []) {
        const node = nodes[t.node];
        if (node) rig.tracks.push({ node, side: t.side || 1, tile: t.tile || 0.68, material: null, offset: 0 });
    }
    return rig;
}

// ── joints ──
// setJoint: an absolute joint value (radians for 'rot', metres for 'slide'), clamped to the joint's range
export function setJoint(rig, name, value) {
    const e = typeof name === 'string' ? rig.byName[name] : name;
    if (!e) return;
    const j = e.j;
    if (j.type !== 'spin') value = Math.min(Math.max(value, Math.min(j.min, j.max)), Math.max(j.min, j.max));
    e.value = value;
    if (j.type === 'slide') {
        e.node.position.copy(e.restPos).addScaledVector(e.axis, value);
    } else {
        e.node.quaternion.setFromAxisAngle(e.axis, value).multiply(e.restQuat);
    }
}

// pose(rig, group, k): every joint in the group to stow + (deploy − stow)·k
export function pose(rig, group, k) {
    const list = rig.byGroup[group];
    if (!list) return;
    for (const e of list) setJoint(rig, e, e.j.stow + (e.j.deploy - e.j.stow) * k);
    rig.state[group] = k;
    updateRams(rig);
}

export const raise = (rig, k) => pose(rig, 'raise', k);          // erector / mast / lifting frame: 0 stowed … 1 erected
export const deployJacks = (rig, k) => pose(rig, 'jack', k);     // stabiliser jacks down to the ground
export const deployPad = (rig, k) => pose(rig, 'pad', k);        // a TEL's launch pad swung down under the missile
export const openDoors = (rig, k) => pose(rig, 'door', k);
export const openHatches = (rig, k) => pose(rig, 'hatch', k);

// aim(rig, yaw, pitch): turret yaw (radians, + = to the left) and launcher pitch (+ = up), clamped to the joints'
// limits. Vehicles with several aiming joints (a radar head and a launcher) aim all of them.
export function aim(rig, yaw, pitch) {
    for (const e of rig.byGroup.turret || []) setJoint(rig, e, yaw);
    for (const e of rig.byGroup.launcher || []) setJoint(rig, e, pitch);
    rig.state.yaw = yaw; rig.state.pitch = pitch;
    updateRams(rig);
}

// spin(rig, dt): radar antennas turn at their own rate (joint.rpm)
export function spin(rig, dt, rate = 1) {
    for (const e of rig.byGroup.spin || []) setJoint(rig, e, (e.value + dt * rate * (e.j.rpm || 6) * Math.PI / 30) % (Math.PI * 2));
}

// roll(rig, metres): turn the wheels (and scroll the tracks) for a distance driven (+ = forwards)
export function roll(rig, dist, distRight = dist) {
    for (const w of rig.wheels) {
        const d = w.side > 0 ? distRight : dist;
        w.spin = (w.spin - d / w.r * w.side) % (Math.PI * 2);
        w.node.rotation.x = w.spin;
    }
    for (const t of rig.tracks) {
        t.offset = (t.offset + (t.side > 0 ? distRight : dist) / t.tile) % 1;
        if (t.material) t.material.map.offset.x = t.offset; // u runs forwards along the ground run (vkit track_run)
    }
}

// steer(rig, angle): steered wheels (+ = to the left); each axle turns by its own share (rig.wheels[i].steer)
export function steer(rig, angle) {
    for (const w of rig.wheels) if (w.steer) w.node.rotation.y = w.yaw0 + angle * w.steer;
}

// Re-aim the hydraulic rams at their anchors and slide their rod stages out to reach them.
export function updateRams(rig) {
    if (!rig.rams.length) return;
    rig.object.updateMatrixWorld(true);
    for (const r of rig.rams) {
        r.node.quaternion.copy(r.restQuat);
        r.node.updateMatrixWorld(true);
        _v.copy(r.end.getWorldPosition(_v)).sub(r.node.getWorldPosition(_v2));
        const len = _v.length();
        _v.applyMatrix3(_m.setFromMatrix4(r.node.parent.matrixWorld).invert()).normalize();
        _q.setFromUnitVectors(r.restDir, _v);
        r.node.quaternion.copy(_q).multiply(r.restQuat);
        const n = r.stages.length;
        for (let i = 0; i < n; i++) r.stages[i].node.position.copy(r.stages[i].rest).addScaledVector(r.restDir, (len - r.len) * (i + 1) / n);
    }
    rig.object.updateMatrixWorld(true);
}

// World position and direction (unit) of muzzle i (0-based): where a rocket / missile leaves tube, rail or canister i
export function muzzleWorld(rig, i, pos, dir) {
    const m = rig.muzzles[i];
    if (!m) return false;
    m.updateWorldMatrix(true, false);
    if (pos) pos.setFromMatrixPosition(m.matrixWorld);
    if (dir) dir.set(0, 0, -1).applyQuaternion(m.getWorldQuaternion(_q2));
    return true;
}

// A merged, static copy of a vehicle in its current pose (a few draw calls): parked / distant vehicles
export function staticVehicle(object) {
    object.updateMatrixWorld(true);
    return mergeStaticModel(object);
}

// Rest the rig: every joint stowed, wheels straight
export function stow(rig) {
    for (const e of rig.joints) setJoint(rig, e, e.j.stow || 0);
    for (const w of rig.wheels) { w.node.rotation.y = w.yaw0; }
    for (const k of Object.keys(rig.state)) rig.state[k] = 0;
    updateRams(rig);
}
