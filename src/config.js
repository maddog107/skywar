// ═══════════════════════════════════════════════════════════════
// Aircraft database
//   Real-world length/span are in metres and drive model scale.
//   Flight numbers are game-tuned: speed = top speed at sea level (m/s),
//   accel = full-afterburner thrust (m/s²), lift = wing-loading multiplier.
// ═══════════════════════════════════════════════════════════════

const FIGHTER = { speed: 420, accel: 14, lift: 1.0, gLimit: 9, roll: 4.2, alpha: 24 };

function jet(o) {
    return {
        category: 'fighter',
        flight: { ...FIGHTER, ...(o.flight || {}) },
        health: 100,
        gun: { damage: 9, rate: 16, ammo: 600, name: 'M61 20mm' },
        missiles: 6,
        flares: 30,
        ...o
    };
}

export const AIRCRAFT = {
    f22: jet({
        name: 'F-22 Raptor', role: 'Air Superiority', country: 'USA', length: 18.9, span: 13.6,
        desc: 'Stealth air-dominance fighter with thrust vectoring. The king of the dogfight.',
        flight: { speed: 440, accel: 16, gLimit: 9.5, roll: 4.4, alpha: 30, lift: 1.08 },
        health: 110, missiles: 8,
        proc: { body: [0.09, 0.07], wing: { rc: 0.46, tc: 0.08, sweep: 42, z: 0.12 }, tail: 'twin', cant: 28, hstab: true, engines: 2, spacing: 0.065, intake: 'side', paint: 0x6d7682, accent: 0x5a626d },
    }),
    // same jet as below, drawn with the new hand-built model (tools/f35a_model.py) for comparison
    f35n: jet({
        name: 'F-35A Lightning II (new model)', role: 'Multirole Stealth', country: 'USA', length: 15.7, span: 10.7,
        desc: 'Sensor-fused stealth multirole. Big missile load, decent in a knife fight. New Blender-built model.',
        flight: { speed: 400, accel: 13.5, gLimit: 9, roll: 3.9, alpha: 28, lift: 0.98 },
        health: 115, missiles: 8, gun: { damage: 10, rate: 14, ammo: 360, name: 'GAU-22 25mm' },
        proc: { body: [0.11, 0.09], wing: { rc: 0.44, tc: 0.1, sweep: 36, z: 0.14 }, tail: 'twin', cant: 25, hstab: true, engines: 1, intake: 'side', paint: 0x5e666e, accent: 0x4c535b },
    }),
    f35: jet({
        name: 'F-35A Lightning II', role: 'Multirole Stealth', country: 'USA', length: 15.7, span: 10.7,
        desc: 'Sensor-fused stealth multirole. Big missile load, decent in a knife fight.',
        flight: { speed: 400, accel: 13.5, gLimit: 9, roll: 3.9, alpha: 28, lift: 0.98 },
        health: 115, missiles: 8, gun: { damage: 10, rate: 14, ammo: 360, name: 'GAU-22 25mm' },
        proc: { body: [0.11, 0.09], wing: { rc: 0.44, tc: 0.1, sweep: 36, z: 0.14 }, tail: 'twin', cant: 25, hstab: true, engines: 1, intake: 'side', paint: 0x5e666e, accent: 0x4c535b },
    }),
    f16: jet({
        name: 'F-16C Fighting Falcon', role: 'Light Fighter', country: 'USA', length: 15.0, span: 9.96,
        desc: 'The Viper. Nimble, fast rolling, 9G fly-by-wire. Light on armour.',
        flight: { speed: 420, accel: 15, gLimit: 9, roll: 5.0, alpha: 25, lift: 1.02 },
        health: 90, missiles: 6,
        proc: { body: [0.085, 0.085], wing: { rc: 0.36, tc: 0.1, sweep: 40, z: 0.1 }, tail: 'single', hstab: true, engines: 1, intake: 'chin', paint: 0x7d8a96, accent: 0x6a7682 },
    }),
    f15: jet({
        name: 'F-15C Eagle', role: 'Air Superiority', country: 'USA', length: 19.4, span: 13.0,
        desc: 'Undefeated in air combat. Huge wing, twin engines, tough and very fast.',
        flight: { speed: 460, accel: 15, gLimit: 9, roll: 3.8, alpha: 24, lift: 1.05 },
        health: 125, missiles: 8,
        proc: { body: [0.1, 0.075], wing: { rc: 0.38, tc: 0.1, sweep: 38, z: 0.12 }, tail: 'twin', cant: 2, hstab: true, engines: 2, spacing: 0.08, intake: 'side', paint: 0x7a8794, accent: 0x66727e },
    }),
    fa18: jet({
        name: 'F/A-18E Super Hornet', role: 'Naval Multirole', country: 'USA', length: 18.3, span: 13.6,
        desc: 'Carrier-borne brawler. Superb high-alpha handling, slower top end.',
        flight: { speed: 380, accel: 13, gLimit: 7.5, roll: 3.9, alpha: 40, lift: 1.1 },
        health: 115, missiles: 8,
        proc: { body: [0.09, 0.08], wing: { rc: 0.3, tc: 0.12, sweep: 28, z: 0.1 }, tail: 'twin', cant: 20, hstab: true, engines: 2, spacing: 0.06, intake: 'side', lerx: true, paint: 0x7b858e, accent: 0x68727b },
    }),
    f14: jet({
        name: 'F-14 Tomcat', role: 'Fleet Defense', country: 'USA', length: 19.1, span: 16.0,
        desc: 'Swing-wing legend. Fast, heavy, packs long-range Phoenix missiles.',
        flight: { speed: 450, accel: 13, gLimit: 7.5, roll: 3.2, alpha: 26, lift: 1.0 },
        health: 120, missiles: 6,
        proc: { body: [0.09, 0.07], wing: { rc: 0.3, tc: 0.08, sweep: 50, z: 0.05 }, tail: 'twin', cant: 5, hstab: true, engines: 2, spacing: 0.14, intake: 'side', paint: 0x8f9499, accent: 0x7b8085 },
    }),
    a10: jet({
        name: 'A-10C Thunderbolt II', role: 'Close Air Support', country: 'USA', length: 16.3, span: 17.5,
        desc: 'BRRRT. Slow and ungainly, but armoured like a tank with a 30mm cannon.',
        flight: { speed: 230, accel: 8, gLimit: 7, roll: 2.6, alpha: 20, lift: 1.35 },
        health: 220, missiles: 6, gun: { damage: 26, rate: 22, ammo: 1100, name: 'GAU-8 30mm' },
        proc: { body: [0.1, 0.1], wing: { rc: 0.16, tc: 0.1, sweep: 2, z: 0.02 }, tail: 'twin', cant: 0, hstab: true, engines: 2, layout: 'tailpods', spacing: 0.12, intake: 'none', straight: true, paint: 0x5f6a60, accent: 0x4e584f },
    }),
    f4: jet({
        name: 'F-4E Phantom II', role: 'Fighter-Bomber', country: 'USA', length: 19.2, span: 11.7,
        desc: 'Cold War bruiser. Brutal power, heavy handling, and a big missile load.',
        flight: { speed: 430, accel: 13, gLimit: 7, roll: 3.0, alpha: 22, lift: 0.9 },
        health: 130, missiles: 8,
        proc: { body: [0.085, 0.075], wing: { rc: 0.34, tc: 0.1, sweep: 45, z: 0.1 }, tail: 'single', hstab: true, engines: 2, spacing: 0.05, intake: 'side', paint: 0x6c7a5c, accent: 0x55604a },
    }),
    f2: jet({
        name: 'Mitsubishi F-2A', role: 'Maritime Strike', country: 'JPN', length: 15.5, span: 11.1,
        desc: 'Enlarged Viper with a composite wing. Lots of lift, great turn rate.',
        flight: { speed: 405, accel: 14.5, gLimit: 9, roll: 4.6, alpha: 26, lift: 1.12 },
        health: 100, missiles: 6,
        proc: { body: [0.085, 0.085], wing: { rc: 0.4, tc: 0.1, sweep: 36, z: 0.1 }, tail: 'single', hstab: true, engines: 1, intake: 'chin', paint: 0x3f5f8f, accent: 0x2f4a70 },
    }),
    su57: jet({
        name: 'Su-57 Felon', role: 'Stealth Fighter', country: 'RUS', length: 20.1, span: 14.1,
        desc: 'Supermanoeuvrable 3D thrust vectoring. Extremely agile at low speed.',
        flight: { speed: 435, accel: 15.5, gLimit: 9, roll: 4.3, alpha: 32, lift: 1.08 },
        health: 110, missiles: 8, gun: { damage: 12, rate: 13, ammo: 250, name: 'GSh-30-1 30mm' },
        proc: { body: [0.08, 0.06], wing: { rc: 0.44, tc: 0.08, sweep: 48, z: 0.1 }, tail: 'twin', cant: 25, hstab: true, engines: 2, spacing: 0.1, intake: 'under', paint: 0x71818c, accent: 0x5c6a74 },
    }),
    su35: jet({
        name: 'Su-35S Flanker-E', role: 'Air Superiority', country: 'RUS', length: 21.9, span: 14.7,
        desc: 'Big, fast, and relentlessly manoeuvrable. Carries a huge missile load.',
        flight: { speed: 440, accel: 14.5, gLimit: 9, roll: 3.9, alpha: 30, lift: 1.05 },
        health: 125, missiles: 10, gun: { damage: 12, rate: 13, ammo: 250, name: 'GSh-30-1 30mm' },
        proc: { body: [0.075, 0.07], wing: { rc: 0.38, tc: 0.09, sweep: 42, z: 0.08 }, tail: 'twin', cant: 0, hstab: true, engines: 2, spacing: 0.1, intake: 'under', lerx: true, paint: 0x8098ab, accent: 0x5f7b92 },
    }),
    mig29: jet({
        name: 'MiG-29 Fulcrum', role: 'Light Fighter', country: 'RUS', length: 17.3, span: 11.4,
        desc: 'Agile point-defence fighter. Great off-boresight missiles, short legs.',
        flight: { speed: 410, accel: 15, gLimit: 9, roll: 4.1, alpha: 28, lift: 1.02 },
        health: 95, missiles: 6, gun: { damage: 12, rate: 13, ammo: 250, name: 'GSh-30-1 30mm' },
        proc: { body: [0.08, 0.07], wing: { rc: 0.36, tc: 0.1, sweep: 42, z: 0.08 }, tail: 'twin', cant: 6, hstab: true, engines: 2, spacing: 0.1, intake: 'under', lerx: true, paint: 0x8c9aa0, accent: 0x6f7f86 },
    }),
    mig31: jet({
        name: 'MiG-31 Foxhound', role: 'Interceptor', country: 'RUS', length: 22.7, span: 13.5,
        desc: 'A missile with a cockpit. Blistering top speed, turns like a bus.',
        flight: { speed: 520, accel: 16, gLimit: 5, roll: 2.6, alpha: 18, lift: 0.85 },
        health: 140, missiles: 6,
        proc: { body: [0.085, 0.075], wing: { rc: 0.3, tc: 0.12, sweep: 40, z: 0.12 }, tail: 'twin', cant: 8, hstab: true, engines: 2, spacing: 0.08, intake: 'side', paint: 0x7d8c95, accent: 0x66747c },
    }),
    typhoon: jet({
        name: 'Eurofighter Typhoon', role: 'Multirole', country: 'EU', length: 15.96, span: 10.95,
        desc: 'Unstable canard-delta. Superb acceleration and climb, excellent all-rounder.',
        flight: { speed: 430, accel: 16, gLimit: 9, roll: 4.4, alpha: 28, lift: 1.04 },
        health: 100, missiles: 6, gun: { damage: 11, rate: 14, ammo: 250, name: 'BK-27 27mm' },
        proc: { body: [0.085, 0.08], wing: { rc: 0.5, tc: 0.08, sweep: 53, z: 0.22, delta: true }, canard: true, tail: 'single', hstab: false, engines: 2, spacing: 0.055, intake: 'chin', paint: 0x818d93, accent: 0x6c787e },
    }),
    rafale: jet({
        name: 'Dassault Rafale', role: 'Omnirole', country: 'FRA', length: 15.27, span: 10.8,
        desc: 'Close-coupled canard delta. Very agile, rugged, and versatile.',
        flight: { speed: 410, accel: 15, gLimit: 9, roll: 4.3, alpha: 30, lift: 1.05 },
        health: 105, missiles: 6, gun: { damage: 11, rate: 14, ammo: 250, name: 'GIAT 30mm' },
        proc: { body: [0.09, 0.08], wing: { rc: 0.5, tc: 0.08, sweep: 48, z: 0.2, delta: true }, canard: true, tail: 'single', hstab: false, engines: 2, spacing: 0.055, intake: 'side', paint: 0x6e787e, accent: 0x5b656b },
    }),
    j20: jet({
        name: 'J-20 Mighty Dragon', role: 'Stealth Fighter', country: 'CHN', length: 20.4, span: 13.0,
        desc: 'Long-range stealth canard fighter. Fast and hard-hitting.',
        flight: { speed: 440, accel: 14.5, gLimit: 8.5, roll: 3.8, alpha: 26, lift: 0.98 },
        health: 115, missiles: 8,
        proc: { body: [0.08, 0.065], wing: { rc: 0.42, tc: 0.08, sweep: 48, z: 0.18, delta: true }, canard: true, tail: 'twin', cant: 25, hstab: false, engines: 2, spacing: 0.06, intake: 'side', paint: 0x5a6068, accent: 0x474d55 },
    }),
    gripen: jet({
        name: 'JAS 39 Gripen', role: 'Light Multirole', country: 'SWE', length: 14.1, span: 8.4,
        desc: 'Small, cheap, fast-rolling canard delta. Hard to spot, hard to hit.',
        flight: { speed: 405, accel: 14.5, gLimit: 9, roll: 4.7, alpha: 28, lift: 1.05 },
        health: 85, missiles: 6, gun: { damage: 11, rate: 14, ammo: 240, name: 'BK-27 27mm' },
        proc: { body: [0.085, 0.08], wing: { rc: 0.5, tc: 0.08, sweep: 45, z: 0.2, delta: true }, canard: true, tail: 'single', hstab: false, engines: 1, intake: 'side', paint: 0x7e8a8f, accent: 0x69757a },
    }),
    mig21: jet({
        name: 'MiG-21bis Fishbed', role: 'Interceptor', country: 'RUS', length: 14.5, span: 7.15,
        desc: 'The most-produced supersonic jet ever. Tiny delta, fast in a straight line.',
        flight: { speed: 400, accel: 13, gLimit: 7, roll: 3.8, alpha: 22, lift: 0.85 },
        health: 80, missiles: 4, gun: { damage: 10, rate: 15, ammo: 200, name: 'GSh-23L 23mm' },
        proc: { body: [0.07, 0.07], wing: { rc: 0.4, tc: 0.05, sweep: 57, z: 0.15, delta: true }, tail: 'single', hstab: true, engines: 1, intake: 'none', paint: 0x9aa3a8, accent: 0x7f878c },
    }),
    mig25: jet({
        name: 'MiG-25 Foxbat', role: 'Interceptor', country: 'RUS', length: 19.8, span: 14.0,
        desc: 'Mach 2.8 steel brick. Unmatched speed, poor turn, big missiles.',
        flight: { speed: 540, accel: 16, gLimit: 5, roll: 2.5, alpha: 18, lift: 0.8 },
        health: 140, missiles: 4, gun: null,
        proc: { body: [0.09, 0.07], wing: { rc: 0.3, tc: 0.12, sweep: 40, z: 0.12 }, tail: 'twin', cant: 8, hstab: true, engines: 2, spacing: 0.08, intake: 'side', paint: 0x8e9aa2, accent: 0x707c84 },
    }),
    j10: jet({
        name: 'J-10A Vigorous Dragon', role: 'Multirole', country: 'CHN', length: 16.9, span: 9.75,
        desc: 'Canard-delta multirole. Agile and quick to accelerate.',
        flight: { speed: 415, accel: 15, gLimit: 9, roll: 4.4, alpha: 28, lift: 1.04 },
        health: 95, missiles: 6, gun: { damage: 10, rate: 15, ammo: 200, name: 'GSh-23 23mm' },
        proc: { body: [0.08, 0.08], wing: { rc: 0.5, tc: 0.08, sweep: 50, z: 0.2, delta: true }, canard: true, tail: 'single', hstab: false, engines: 1, intake: 'chin', paint: 0x8a959c, accent: 0x6e7980 },
    }),
    j8: jet({
        name: 'J-8II Finback', role: 'Interceptor', country: 'CHN', length: 21.6, span: 9.3,
        desc: 'Twin-engine high-speed interceptor. Tough, fast, clumsy.',
        flight: { speed: 450, accel: 14, gLimit: 6.5, roll: 2.9, alpha: 20, lift: 0.85 },
        health: 120, missiles: 4, gun: { damage: 10, rate: 15, ammo: 200, name: 'Type 23-III' },
        proc: { body: [0.08, 0.08], wing: { rc: 0.4, tc: 0.05, sweep: 55, z: 0.15, delta: true }, tail: 'single', hstab: true, engines: 2, spacing: 0.05, intake: 'side', paint: 0x8c969b, accent: 0x6e787d },
    }),
    f5: jet({
        name: 'F-5E Tiger II', role: 'Light Fighter', country: 'USA', length: 14.5, span: 8.1,
        desc: 'Cheap, cheerful aggressor trainer. Light, twitchy and fun.',
        flight: { speed: 370, accel: 12.5, gLimit: 7.3, roll: 4.8, alpha: 24, lift: 1.0 },
        health: 75, missiles: 2, gun: { damage: 9, rate: 18, ammo: 560, name: '2× M39 20mm' },
        proc: { body: [0.07, 0.07], wing: { rc: 0.3, tc: 0.1, sweep: 32, z: 0.1 }, tail: 'single', hstab: true, engines: 2, spacing: 0.04, intake: 'side', paint: 0xa89a7a, accent: 0x7e7058 },
    }),
    mirage: jet({
        name: 'Mirage IIIE', role: 'Interceptor', country: 'FRA', length: 15.0, span: 8.2,
        desc: 'Classic tailless delta. Fast and elegant, bleeds energy in turns.',
        flight: { speed: 420, accel: 13, gLimit: 7, roll: 4.0, alpha: 26, lift: 0.95 },
        health: 85, missiles: 4, gun: { damage: 11, rate: 16, ammo: 250, name: '2× DEFA 30mm' },
        proc: { body: [0.075, 0.075], wing: { rc: 0.55, tc: 0.05, sweep: 60, z: 0.18, delta: true }, tail: 'single', hstab: false, engines: 1, intake: 'side', paint: 0x9aa39a, accent: 0x7a847a },
    }),
    jaguar: jet({
        name: 'SEPECAT Jaguar', role: 'Ground Attack', country: 'EU', length: 16.8, span: 8.7,
        desc: 'Low-level strike jet. Stable, sturdy, and good at bombing things.',
        flight: { speed: 370, accel: 11.5, gLimit: 7, roll: 3.4, alpha: 22, lift: 0.95 },
        health: 120, missiles: 6, gun: { damage: 12, rate: 16, ammo: 300, name: '2× ADEN 30mm' },
        proc: { body: [0.075, 0.075], wing: { rc: 0.3, tc: 0.1, sweep: 40, z: 0.1 }, tail: 'single', hstab: true, engines: 2, spacing: 0.05, intake: 'side', paint: 0x5d6a50, accent: 0x4a5540 },
    }),
    su47: jet({
        name: 'Su-47 Berkut', role: 'Experimental', country: 'RUS', length: 22.6, span: 16.7,
        desc: 'Forward-swept wing demonstrator. Insane low-speed agility.',
        flight: { speed: 425, accel: 15, gLimit: 9, roll: 4.2, alpha: 36, lift: 1.15 },
        health: 110, missiles: 8, gun: { damage: 12, rate: 13, ammo: 250, name: 'GSh-30-1 30mm' },
        proc: { body: [0.075, 0.065], wing: { rc: 0.36, tc: 0.12, sweep: -20, z: 0.18 }, canard: true, tail: 'twin', cant: 5, hstab: true, engines: 2, spacing: 0.08, intake: 'side', paint: 0x3c4a5c, accent: 0x2e3a4a },
    }),
    b2: {
        name: 'B-2 Spirit', role: 'Stealth Bomber', country: 'USA', length: 21, span: 52.4, category: 'bomber',
        desc: 'A flying wing. No gun, but it carries 12 missiles and shrugs off damage.',
        flight: { speed: 290, accel: 7, lift: 1.2, gLimit: 3, roll: 1.2, alpha: 16 },
        health: 260, gun: null, missiles: 12, flares: 40,
        proc: { flyingWing: true, engines: 4, paint: 0x2b2d31, accent: 0x222428 },
    },
    racer: {
        name: 'Unlimited Air Racer', role: 'Air Racing', country: 'USA', length: 9.0, span: 10.9, category: 'racer', prop: true,
        desc: 'A clipped-wing, hot-rodded warbird built for pylon racing: 450+ kt on the deck. Made for the Ring Race.',
        flight: { speed: 215, accel: 7.5, lift: 1.55, gLimit: 8, roll: 3.6, alpha: 18 },
        health: 55, gun: null, missiles: 0, flares: 0, fuelTime: 1800,
        proc: { prop: true, body: [0.12, 0.13], paint: 0x3f7a3a, accent: 0xe8c23a },
    },
    pitts: {
        name: 'Pitts-style Stunt Biplane', role: 'Aerobatics', country: 'USA', length: 5.0, span: 6.1, category: 'racer', prop: true,
        desc: 'Tiny, light and absurdly agile. Rolls at 400°/s — loops, snap rolls and knife-edge passes.',
        flight: { speed: 115, accel: 6, lift: 3.4, gLimit: 6, roll: 7.0, alpha: 20 },
        health: 35, gun: null, missiles: 0, flares: 0, fuelTime: 1500,
        proc: { prop: true, body: [0.13, 0.15], paint: 0xd8321e, accent: 0xf2f2f2 },
    },
    cessna: {
        name: 'Cessna 172', role: 'Civilian GA', country: 'USA', length: 8.28, span: 11.0, category: 'civil',
        desc: 'Four-seat trainer. Perfect for sightseeing in free flight.',
        flight: { speed: 75, accel: 3.2, lift: 6.0, gLimit: 3.8, roll: 1.6, alpha: 16 },
        health: 40, gun: null, missiles: 0, flares: 0,
        proc: { prop: true, highWing: true, body: [0.13, 0.17], paint: 0xf1f1ee, accent: 0x2d4f9e },
    },
    b737: {
        name: 'Boeing 737-800', role: 'Airliner', country: 'USA', length: 39.5, span: 35.8, category: 'civil',
        desc: 'The world\'s workhorse airliner. Mind the passengers.',
        flight: { speed: 250, accel: 4.5, lift: 0.82, gLimit: 2.5, roll: 0.8, alpha: 15 },
        health: 180, gun: null, missiles: 0, flares: 0,
        proc: { airliner: true, engines: 2, body: [0.1, 0.1], paint: 0xf4f4f4, accent: 0x1d4aa8 },
    },
    b747: {
        name: 'Boeing 747-400', role: 'Heavy Airliner', country: 'USA', length: 70.6, span: 64.4, category: 'civil',
        desc: 'Queen of the Skies. Four engines, zero dogfighting ability.',
        flight: { speed: 265, accel: 4, lift: 0.66, gLimit: 2.5, roll: 0.6, alpha: 14 },
        health: 260, gun: null, missiles: 0, flares: 0,
        proc: { airliner: true, engines: 4, body: [0.09, 0.1], hump: true, paint: 0xf6f6f6, accent: 0xb3202a },
    },
    c130: {
        name: 'C-130J Hercules', role: 'Tactical Transport', country: 'USA', length: 29.8, span: 40.4, category: 'civil',
        desc: 'Four-turboprop tactical airlifter. Slow, steady, surprisingly nimble.',
        flight: { speed: 170, accel: 4.5, lift: 1.6, gLimit: 3, roll: 1.0, alpha: 16 },
        health: 220, gun: null, missiles: 0, flares: 60,
        proc: { airliner: true, turboprop: true, highWing: true, engines: 4, body: [0.14, 0.14], paint: 0x5b6556, accent: 0x4a5346 },
    },
};

// Which aircraft can appear as hostiles, and what they're worth
export const ENEMY_POOL = ['su57', 'su35', 'mig29', 'mig21', 'mig25', 'mig31', 'j20', 'j10', 'j8', 'su47'];
export const ENEMY_EARLY = ['mig21', 'f5', 'mig29', 'j8', 'mirage'];
export const ALLY_POOL = ['f16', 'f15', 'f14', 'f4', 'f2', 'typhoon', 'rafale'];

export const DIFFICULTY = {
    rookie: { label: 'ROOKIE', skill: 0.35, dmgTaken: 0.6, enemyMissileRate: 0.4, waveScale: 0.8 },
    veteran: { label: 'VETERAN', skill: 0.6, dmgTaken: 1.0, enemyMissileRate: 0.7, waveScale: 1.0 },
    ace: { label: 'ACE', skill: 0.9, dmgTaken: 1.4, enemyMissileRate: 1.0, waveScale: 1.25 },
};

export const MODES = {
    missions: { label: 'MISSIONS', desc: 'Hand-built challenges plus a new Daily Mission every day.' },
    dogfight: { label: 'DOGFIGHT', desc: 'Waves of hostile fighters. Resupply between waves. Wingmen available.' },
    strike: { label: 'STRIKE', desc: 'Destroy the enemy airbase: SAM sites, AAA, radar and hangars while fighters defend it.' },
    naval: { label: 'NAVAL STRIKE', desc: 'Sink an enemy carrier group. CIWS guns shoot down missiles, SAMs and fighters defend it.' },
    practice: { label: 'TARGET PRACTICE', desc: 'Timed range: shoot target boards on the hills and flying drones. Nothing shoots back.' },
    rings: { label: 'RING RACE', desc: 'Timed course of glowing rings through the valleys and canyons. Beat your best time.' },
    survival: { label: 'SURVIVAL', desc: 'Endless escalating waves. No repairs, no mercy. How long can you last?' },
    sandbox: { label: 'SANDBOX', desc: 'Just have fun: unlimited ammo & fuel, invincible, bombs, spawn bandits with N.' },
    freeflight: { label: 'FREE FLIGHT', desc: 'Taxi, take off, explore and land. Unarmed target ships offshore to sink for fun.' },
};

export const TIMES = {
    dawn: { label: 'DAWN', elevation: 6, azimuth: 95 },
    day: { label: 'MIDDAY', elevation: 55, azimuth: 150 },
    dusk: { label: 'DUSK', elevation: 3.5, azimuth: 255 },
    night: { label: 'NIGHT', elevation: -12, azimuth: 250 },
};

// Weapons tuning
export const WEAPONS = {
    bulletSpeed: 1050,
    bulletLife: 1.9,
    missile: { speed: 640, boost: 3.0, accelBoost: 140, turnG: 32, life: 14, lockTime: 1.1, lockCone: 0.906, range: 4200, prox: 16, damage: 92, navN: 4 },
    lrm: { speed: 800, boost: 4.5, accelBoost: 150, turnG: 24, life: 22, lockTime: 2.2, lockCone: 0.94, range: 9000, prox: 18, damage: 98, navN: 4, radar: true },
    bomb: { damage: 220, splash: 55, drag: 0.012, unguided: true, lockTime: 1, lockCone: 2, range: 0 },
    rkt: { boost: 0.8, accelBoost: 420, turnG: 0, life: 5, prox: 11, damage: 38, splash: 32, unguided: true },
    sam: { speed: 820, boost: 4, accelBoost: 180, turnG: 24, life: 16, damage: 70, range: 7500, navN: 3.5 },
};
