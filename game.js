// ═══════════════════════════════════════════════════════════════
// SKYWAR — Flight Combat Simulator
// GeoFS-inspired with dogfight combat
// ═══════════════════════════════════════════════════════════════

// ── AIRCRAFT DATABASE ──
const AIRCRAFT = {
    f22: {
        name: "F-22 Raptor", type: "Air Superiority", country: "USA",
        maxSpeed: 700, agility: 0.9, health: 100, gunDamage: 10, gunRate: 12,
        missiles: 6, missileDmg: 60, color: 0x607080, accentColor: 0x505868,
        body: { l: 6.5, w: 1.6, h: 0.7 }, wing: { span: 5, chord: 3.2, sweep: 0.5 },
        tail: { dual: true, angle: 0.45, h: 1.4 }, engine: 2
    },
    f35: {
        name: "F-35 Lightning II", type: "Multirole Stealth", country: "USA",
        maxSpeed: 620, agility: 0.8, health: 110, gunDamage: 9, gunRate: 10,
        missiles: 8, missileDmg: 55, color: 0x556070, accentColor: 0x485060,
        body: { l: 6, w: 1.5, h: 0.8 }, wing: { span: 4.5, chord: 3, sweep: 0.4 },
        tail: { dual: false, angle: 0, h: 1.5 }, engine: 1
    },
    f16: {
        name: "F-16 Falcon", type: "Light Fighter", country: "USA",
        maxSpeed: 650, agility: 0.95, health: 80, gunDamage: 8, gunRate: 14,
        missiles: 4, missileDmg: 50, color: 0x708888, accentColor: 0x607878,
        body: { l: 5.5, w: 1.2, h: 0.6 }, wing: { span: 4, chord: 2.5, sweep: 0.35 },
        tail: { dual: false, angle: 0, h: 1.6 }, engine: 1
    },
    f15: {
        name: "F-15 Eagle", type: "Air Superiority", country: "USA",
        maxSpeed: 720, agility: 0.85, health: 120, gunDamage: 11, gunRate: 10,
        missiles: 8, missileDmg: 55, color: 0x6a7585, accentColor: 0x5a6575,
        body: { l: 7, w: 1.7, h: 0.8 }, wing: { span: 5.5, chord: 3, sweep: 0.3 },
        tail: { dual: true, angle: 0.35, h: 1.5 }, engine: 2
    },
    fa18: {
        name: "F/A-18 Hornet", type: "Naval Fighter", country: "USA",
        maxSpeed: 600, agility: 0.88, health: 105, gunDamage: 9, gunRate: 11,
        missiles: 6, missileDmg: 55, color: 0x607585, accentColor: 0x506575,
        body: { l: 6, w: 1.5, h: 0.7 }, wing: { span: 5, chord: 2.8, sweep: 0.25 },
        tail: { dual: true, angle: 0.5, h: 1.3 }, engine: 2
    },
    f14: {
        name: "F-14 Tomcat", type: "Fleet Defense", country: "USA",
        maxSpeed: 690, agility: 0.82, health: 110, gunDamage: 10, gunRate: 10,
        missiles: 8, missileDmg: 65, color: 0x7a7a6a, accentColor: 0x6a6a5a,
        body: { l: 7, w: 1.7, h: 0.8 }, wing: { span: 5.5, chord: 3, sweep: 0.35 },
        tail: { dual: true, angle: 0.35, h: 1.5 }, engine: 2
    },
    a10: {
        name: "A-10 Warthog", type: "Ground Attack", country: "USA",
        maxSpeed: 380, agility: 0.6, health: 200, gunDamage: 25, gunRate: 20,
        missiles: 4, missileDmg: 70, color: 0x556655, accentColor: 0x445544,
        body: { l: 6, w: 1.8, h: 1 }, wing: { span: 6, chord: 2.5, sweep: 0 },
        tail: { dual: true, angle: 0.3, h: 1.4 }, engine: 2
    },
    su57: {
        name: "Su-57 Felon", type: "Stealth Fighter", country: "RU",
        maxSpeed: 710, agility: 0.92, health: 110, gunDamage: 10, gunRate: 11,
        missiles: 8, missileDmg: 60, color: 0x5a6878, accentColor: 0x4a5868,
        body: { l: 7, w: 1.7, h: 0.7 }, wing: { span: 5.5, chord: 3.5, sweep: 0.5 },
        tail: { dual: true, angle: 0.4, h: 1.4 }, engine: 2
    },
    su35: {
        name: "Su-35 Flanker-E", type: "Air Superiority", country: "RU",
        maxSpeed: 690, agility: 0.94, health: 115, gunDamage: 10, gunRate: 10,
        missiles: 10, missileDmg: 55, color: 0x607090, accentColor: 0x506080,
        body: { l: 7.5, w: 1.6, h: 0.8 }, wing: { span: 5.5, chord: 3.5, sweep: 0.45 },
        tail: { dual: true, angle: 0.35, h: 1.5 }, engine: 2
    },
    mig29: {
        name: "MiG-29 Fulcrum", type: "Light Fighter", country: "RU",
        maxSpeed: 660, agility: 0.93, health: 90, gunDamage: 9, gunRate: 12,
        missiles: 6, missileDmg: 50, color: 0x607888, accentColor: 0x506878,
        body: { l: 5.5, w: 1.4, h: 0.7 }, wing: { span: 4.5, chord: 3, sweep: 0.4 },
        tail: { dual: true, angle: 0.4, h: 1.3 }, engine: 2
    },
    mig31: {
        name: "MiG-31 Foxhound", type: "Interceptor", country: "RU",
        maxSpeed: 750, agility: 0.65, health: 130, gunDamage: 10, gunRate: 8,
        missiles: 6, missileDmg: 70, color: 0x5a6a7a, accentColor: 0x4a5a6a,
        body: { l: 8, w: 2, h: 0.9 }, wing: { span: 5.5, chord: 3, sweep: 0.4 },
        tail: { dual: true, angle: 0.3, h: 1.6 }, engine: 2
    },
    eurofighter: {
        name: "Eurofighter Typhoon", type: "Multirole", country: "EU",
        maxSpeed: 680, agility: 0.91, health: 100, gunDamage: 9, gunRate: 12,
        missiles: 6, missileDmg: 55, color: 0x688078, accentColor: 0x587068,
        body: { l: 6, w: 1.4, h: 0.65 }, wing: { span: 4.5, chord: 3, sweep: 0.5 },
        tail: { dual: false, angle: 0, h: 1.6 }, engine: 2
    },
    rafale: {
        name: "Dassault Rafale", type: "Multirole", country: "FR",
        maxSpeed: 640, agility: 0.89, health: 100, gunDamage: 9, gunRate: 11,
        missiles: 6, missileDmg: 55, color: 0x607070, accentColor: 0x506060,
        body: { l: 5.5, w: 1.4, h: 0.65 }, wing: { span: 4.5, chord: 3.2, sweep: 0.45 },
        tail: { dual: false, angle: 0, h: 1.5 }, engine: 2
    },
    j20: {
        name: "J-20 Mighty Dragon", type: "Stealth Fighter", country: "CN",
        maxSpeed: 700, agility: 0.86, health: 110, gunDamage: 10, gunRate: 10,
        missiles: 8, missileDmg: 60, color: 0x555f6a, accentColor: 0x454f5a,
        body: { l: 7.5, w: 1.6, h: 0.7 }, wing: { span: 5, chord: 3.5, sweep: 0.55 },
        tail: { dual: true, angle: 0.4, h: 1.4 }, engine: 2
    },
    gripen: {
        name: "JAS 39 Gripen", type: "Light Multirole", country: "SE",
        maxSpeed: 640, agility: 0.92, health: 85, gunDamage: 8, gunRate: 12,
        missiles: 6, missileDmg: 50, color: 0x6a7a6a, accentColor: 0x5a6a5a,
        body: { l: 5, w: 1.2, h: 0.6 }, wing: { span: 4, chord: 2.8, sweep: 0.45 },
        tail: { dual: false, angle: 0, h: 1.5 }, engine: 1
    },
    b2: {
        name: "B-2 Spirit", type: "Stealth Bomber", country: "USA",
        maxSpeed: 500, agility: 0.4, health: 180, gunDamage: 0, gunRate: 0,
        missiles: 12, missileDmg: 80, color: 0x2a2a2a, accentColor: 0x1a1a1a,
        body: { l: 7, w: 3, h: 0.5 }, wing: { span: 8, chord: 5, sweep: 0.6 },
        tail: { dual: false, angle: 0, h: 0 }, engine: 4
    },
    // ── CIVILIAN / TRANSPORT ──
    cessna: {
        name: "Cessna 172", type: "Civilian GA", country: "USA",
        maxSpeed: 140, agility: 0.5, health: 40, gunDamage: 0, gunRate: 0,
        missiles: 0, missileDmg: 0, color: 0xeeeeee, accentColor: 0x3355aa,
        body: { l: 3.5, w: 0.8, h: 0.7 }, wing: { span: 5, chord: 1.2, sweep: 0 },
        tail: { dual: false, angle: 0, h: 1.2 }, engine: 1
    },
    boeing737: {
        name: "Boeing 737-800", type: "Airliner", country: "USA",
        maxSpeed: 280, agility: 0.3, health: 160, gunDamage: 0, gunRate: 0,
        missiles: 0, missileDmg: 0, color: 0xf0f0f0, accentColor: 0x2255bb,
        body: { l: 10, w: 2, h: 2 }, wing: { span: 7, chord: 3, sweep: 0.3 },
        tail: { dual: false, angle: 0, h: 2.5 }, engine: 2
    },
    boeing747: {
        name: "Boeing 747", type: "Heavy Airliner", country: "USA",
        maxSpeed: 300, agility: 0.2, health: 220, gunDamage: 0, gunRate: 0,
        missiles: 0, missileDmg: 0, color: 0xf5f5f5, accentColor: 0x1144aa,
        body: { l: 14, w: 3, h: 2.8 }, wing: { span: 10, chord: 4, sweep: 0.35 },
        tail: { dual: false, angle: 0, h: 3.5 }, engine: 4
    },
    a320: {
        name: "Airbus A320", type: "Airliner", country: "EU",
        maxSpeed: 275, agility: 0.32, health: 150, gunDamage: 0, gunRate: 0,
        missiles: 0, missileDmg: 0, color: 0xf2f2f2, accentColor: 0x0044aa,
        body: { l: 9, w: 2, h: 2 }, wing: { span: 7, chord: 2.8, sweep: 0.28 },
        tail: { dual: false, angle: 0, h: 2.3 }, engine: 2
    },
    c130: {
        name: "C-130 Hercules", type: "Military Transport", country: "USA",
        maxSpeed: 200, agility: 0.35, health: 180, gunDamage: 0, gunRate: 0,
        missiles: 0, missileDmg: 0, color: 0x5a6a55, accentColor: 0x4a5a45,
        body: { l: 10, w: 2.5, h: 2.2 }, wing: { span: 8, chord: 3, sweep: 0 },
        tail: { dual: false, angle: 0, h: 3 }, engine: 4
    }
};

// ── GLOBALS ──
let scene, camera, renderer, clock;
let terrain, water, sunLight;
let player = null;
let enemies = [];
let bullets = [];
let missiles = [];
let particles = [];
let flares = [];
let clouds = [];
let gameState = 'menu';
let selectedAircraft = 'f22';
let selectedMode = 'dogfight';
let score = 0, kills = 0, wave = 1;
let waveSpawning = false;
let cameraMode = 0;
const cameraOffsets = [
    new THREE.Vector3(0, 15, 55),
    new THREE.Vector3(0, 4, -3),
    new THREE.Vector3(0, 35, 100)
];

const keys = {};
let lockTarget = null;
let lockProgress = 0;
const BULLET_SPEED = 800;
const MISSILE_SPEED = 400;
const MISSILE_TURN = 2.5;
const GUN_RANGE = 1200;
const LOCK_TIME = 1.5;
const GRAVITY = 50;
const TERRAIN_SIZE = 20000;

// ── WIND SYSTEM ──
const wind = new THREE.Vector3(0, 0, 0);
let windTarget = new THREE.Vector3(
    (Math.random() - 0.5) * 40,
    0,
    (Math.random() - 0.5) * 40
);
let windChangeTimer = 0;

function updateWind(dt) {
    windChangeTimer -= dt;
    if (windChangeTimer <= 0) {
        windChangeTimer = 10 + Math.random() * 20;
        windTarget.set(
            (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 60
        );
    }
    wind.lerp(windTarget, 0.01);
}

// ── PERLIN NOISE ──
const perm = new Uint8Array(512);
(function initNoise() {
    var p = [];
    for (var i = 0; i < 256; i++) p[i] = i;
    for (var i = 255; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (var i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function nlerp(t, a, b) { return a + t * (b - a); }
function grad(hash, x, y) {
    var h = hash & 3;
    var u = h < 2 ? x : y;
    var v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
function noise2d(x, y) {
    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    var xf = x - Math.floor(x), yf = y - Math.floor(y);
    var u = fade(xf), v = fade(yf);
    var a = perm[X] + Y, b = perm[X + 1] + Y;
    return nlerp(v,
        nlerp(u, grad(perm[a], xf, yf), grad(perm[b], xf - 1, yf)),
        nlerp(u, grad(perm[a + 1], xf, yf - 1), grad(perm[b + 1], xf - 1, yf - 1))
    );
}
function fbm(x, y, octaves) {
    var val = 0, amp = 1, freq = 1, max = 0;
    for (var i = 0; i < octaves; i++) {
        val += noise2d(x * freq, y * freq) * amp;
        max += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return val / max;
}

// ── TERRAIN ──
function getTerrainHeight(x, z) {
    // Multi-scale terrain: broad mountains + medium hills + fine detail
    var broad = fbm(x * 0.00015, z * 0.00015, 4) * 800;
    var medium = fbm(x * 0.0008 + 100, z * 0.0008 + 100, 4) * 120;
    var fine = fbm(x * 0.004 + 200, z * 0.004 + 200, 3) * 20;
    var h = broad + medium + fine;
    // Create valleys/rivers
    var valley = Math.abs(fbm(x * 0.0003 + 50, z * 0.0003 + 50, 3));
    h *= (0.3 + valley * 0.7);
    return Math.max(h, -8);
}

function createTerrain() {
    var segments = 300;
    var geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    var verts = geo.attributes.position.array;
    var colors = new Float32Array(verts.length);
    for (var i = 0; i < verts.length; i += 3) {
        var h = getTerrainHeight(verts[i], verts[i + 2]);
        verts[i + 1] = h;
        // Biome coloring based on height + noise for variety
        var n = fbm(verts[i] * 0.002, verts[i + 2] * 0.002, 2) * 0.5 + 0.5;
        if (h < 0) {
            // Shoreline / wet sand
            colors[i] = 0.6; colors[i + 1] = 0.55; colors[i + 2] = 0.4;
        } else if (h < 15) {
            // Beach / grassland
            colors[i] = 0.3 * n + 0.15; colors[i + 1] = 0.6 * n + 0.2; colors[i + 2] = 0.1;
        } else if (h < 80) {
            // Forest / grassland
            colors[i] = 0.12 + n * 0.15; colors[i + 1] = 0.35 + n * 0.25; colors[i + 2] = 0.08 + n * 0.08;
        } else if (h < 200) {
            // Highland
            colors[i] = 0.3 + n * 0.15; colors[i + 1] = 0.28 + n * 0.12; colors[i + 2] = 0.15 + n * 0.1;
        } else if (h < 400) {
            // Rocky mountain
            colors[i] = 0.4 + n * 0.15; colors[i + 1] = 0.38 + n * 0.12; colors[i + 2] = 0.32 + n * 0.1;
        } else {
            // Snow caps
            var snow = Math.min(1, (h - 400) / 150);
            colors[i] = 0.5 + snow * 0.45; colors[i + 1] = 0.48 + snow * 0.47; colors[i + 2] = 0.45 + snow * 0.5;
        }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    terrain = new THREE.Mesh(geo, mat);
    scene.add(terrain);

}

// ── CLOUDS ──
function createClouds() {
    for (var i = 0; i < 80; i++) {
        var cloudGroup = new THREE.Group();
        var puffCount = 3 + Math.floor(Math.random() * 5);
        for (var j = 0; j < puffCount; j++) {
            var puff = new THREE.Mesh(
                new THREE.SphereGeometry(40 + Math.random() * 60, 8, 6),
                new THREE.MeshLambertMaterial({
                    color: 0xffffff, transparent: true,
                    opacity: 0.7 + Math.random() * 0.2
                })
            );
            puff.position.set(
                (Math.random() - 0.5) * 100,
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 100
            );
            puff.scale.y = 0.4 + Math.random() * 0.3;
            cloudGroup.add(puff);
        }
        cloudGroup.position.set(
            (Math.random() - 0.5) * TERRAIN_SIZE,
            600 + Math.random() * 1500,
            (Math.random() - 0.5) * TERRAIN_SIZE
        );
        scene.add(cloudGroup);
        clouds.push(cloudGroup);
    }
}

// ── AIRCRAFT MODEL BUILDER ──
function buildAircraftModel(type) {
    var spec = AIRCRAFT[type];
    var g = new THREE.Group();
    var mat = new THREE.MeshPhongMaterial({ color: spec.color, flatShading: true });
    var accentMat = new THREE.MeshPhongMaterial({ color: spec.accentColor, flatShading: true });
    var darkMat = new THREE.MeshPhongMaterial({ color: 0x222222, flatShading: true });
    var glassMat = new THREE.MeshPhongMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6, shininess: 100 });

    var b = spec.body, w = spec.wing, t = spec.tail;

    // Fuselage - rounded cylinder for better look
    var fuseGeo = new THREE.CylinderGeometry(b.w * 0.5, b.w * 0.45, b.l, 8);
    fuseGeo.rotateX(Math.PI / 2);
    var fuse = new THREE.Mesh(fuseGeo, mat);
    g.add(fuse);

    // Fuselage belly (flatter bottom)
    var belly = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.8, b.h * 0.3, b.l * 0.7),
        mat
    );
    belly.position.y = -b.h * 0.2;
    g.add(belly);

    // Nose cone
    var noseLen = b.l * 0.4;
    var nose = new THREE.Mesh(
        new THREE.ConeGeometry(b.w * 0.4, noseLen, 8),
        accentMat
    );
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -(b.l / 2 + noseLen * 0.45);
    g.add(nose);

    // Canopy (cockpit glass)
    var canopy = new THREE.Mesh(
        new THREE.SphereGeometry(b.w * 0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
        glassMat
    );
    canopy.scale.set(1, 0.6, 2);
    canopy.position.set(0, b.h * 0.35, -b.l * 0.18);
    g.add(canopy);

    // ── WINGS ── (flat trapezoids using BufferGeometry)
    for (var side = -1; side <= 1; side += 2) {
        var halfSpan = w.span / 2;
        var sweepBack = w.sweep * halfSpan;
        var tipChord = w.chord * 0.35;
        var rootChord = w.chord;

        // Wing as a flat quad (two triangles)
        var verts = new Float32Array([
            // Triangle 1: root leading, root trailing, tip trailing
            side * b.w * 0.4,  0,  -rootChord * 0.4,     // root leading edge
            side * b.w * 0.4,  0,   rootChord * 0.6,     // root trailing edge
            side * (b.w * 0.4 + halfSpan), 0, sweepBack + tipChord * 0.6, // tip trailing
            // Triangle 2: root leading, tip trailing, tip leading
            side * b.w * 0.4,  0,  -rootChord * 0.4,     // root leading edge
            side * (b.w * 0.4 + halfSpan), 0, sweepBack + tipChord * 0.6, // tip trailing
            side * (b.w * 0.4 + halfSpan), 0, sweepBack - tipChord * 0.4, // tip leading edge
        ]);
        // Flip winding for opposite side
        if (side === -1) {
            // Reverse triangle winding so normals face up
            for (var tri = 0; tri < 2; tri++) {
                var base = tri * 9;
                var tx, ty, tz;
                tx = verts[base]; ty = verts[base+1]; tz = verts[base+2];
                verts[base] = verts[base+6]; verts[base+1] = verts[base+7]; verts[base+2] = verts[base+8];
                verts[base+6] = tx; verts[base+7] = ty; verts[base+8] = tz;
            }
        }
        var wingGeo = new THREE.BufferGeometry();
        wingGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        wingGeo.computeVertexNormals();
        // Give the wing some thickness by extruding
        var wingTop = new THREE.Mesh(wingGeo, mat);
        g.add(wingTop);
        // Bottom face
        var wingBot = new THREE.Mesh(wingGeo.clone(), mat);
        wingBot.position.y = -0.08;
        g.add(wingBot);
        // Thin box along the wing for thickness/edge visibility
        var wingThick = new THREE.Mesh(
            new THREE.BoxGeometry(halfSpan, 0.12, rootChord * 0.5),
            mat
        );
        wingThick.position.set(
            side * (b.w * 0.4 + halfSpan * 0.5),
            -0.04,
            sweepBack * 0.4
        );
        g.add(wingThick);
    }

    // ── TAIL SECTION ──
    if (t.h > 0) {
        // Vertical stabilizer(s)
        if (t.dual) {
            for (var side = -1; side <= 1; side += 2) {
                var tailVGeo = new THREE.BufferGeometry();
                var tv = new Float32Array([
                    side * b.w * 0.5, b.h * 0.2, b.l * 0.5,
                    side * b.w * 0.5, b.h * 0.2, b.l * 0.3,
                    side * b.w * 0.55, t.h + b.h * 0.2, b.l * 0.45,
                    side * b.w * 0.5, b.h * 0.2, b.l * 0.3,
                    side * b.w * 0.55, t.h + b.h * 0.2, b.l * 0.45,
                    side * b.w * 0.55, t.h + b.h * 0.2, b.l * 0.38,
                ]);
                tailVGeo.setAttribute('position', new THREE.BufferAttribute(tv, 3));
                tailVGeo.computeVertexNormals();
                g.add(new THREE.Mesh(tailVGeo, accentMat));
                // Add a visible box too for the stabilizer
                var tailBox = new THREE.Mesh(
                    new THREE.BoxGeometry(0.12, t.h, 0.8),
                    accentMat
                );
                tailBox.position.set(side * b.w * 0.55, t.h * 0.5 + b.h * 0.3, b.l * 0.4);
                tailBox.rotation.z = side * t.angle;
                g.add(tailBox);
            }
        } else {
            var tailBox = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, t.h, 1.2),
                accentMat
            );
            tailBox.position.set(0, t.h * 0.5 + b.h * 0.3, b.l * 0.4);
            g.add(tailBox);
        }
        // Horizontal stabilizers
        for (var side = -1; side <= 1; side += 2) {
            var hstab = new THREE.Mesh(
                new THREE.BoxGeometry(2, 0.08, 1),
                mat
            );
            hstab.position.set(side * (b.w * 0.3 + 1), b.h * 0.15, b.l * 0.4);
            g.add(hstab);
        }
    }

    // ── ENGINES ──
    for (var i = 0; i < spec.engine; i++) {
        var eOffset;
        if (spec.engine === 1) eOffset = 0;
        else if (spec.engine === 2) eOffset = (i - 0.5) * b.w * 0.7;
        else eOffset = (i - (spec.engine - 1) / 2) * b.w * 0.5;

        // Engine nacelle
        var nacelle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.35, 1.2, 8),
            darkMat
        );
        nacelle.rotation.x = Math.PI / 2;
        nacelle.position.set(eOffset, -b.h * 0.1, b.l * 0.4);
        g.add(nacelle);

        // Afterburner glow
        var glow = new THREE.Mesh(
            new THREE.ConeGeometry(0.25, 2, 6),
            new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.6 })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(eOffset, -b.h * 0.1, b.l * 0.4 + 1.2);
        glow.visible = false;
        glow.name = 'afterburner';
        g.add(glow);
    }

    // Scale up so aircraft are visible against the terrain
    g.scale.set(4, 4, 4);
    return g;
}

// ── CREATE AIRCRAFT ENTITY ──
function createAircraftEntity(type, isPlayer) {
    var spec = AIRCRAFT[type];
    var mesh = buildAircraftModel(type);
    scene.add(mesh);

    return {
        mesh: mesh,
        type: type,
        spec: spec,
        velocity: new THREE.Vector3(0, 0, -spec.maxSpeed * 0.3),
        speed: spec.maxSpeed * 0.3,
        throttle: 0.3,
        health: spec.health,
        maxHealth: spec.health,
        ammo: 500,
        missileCount: spec.missiles,
        flareCount: 8,
        isPlayer: isPlayer,
        alive: true,
        pitchRate: 0,
        rollRate: 0,
        yawRate: 0,
        gForce: 1,
        lastGunFire: 0,
        lastMissileFire: 0,
        lastFlareFire: 0,
        // AI
        aiState: 'patrol',
        aiTarget: null,
        aiStateTimer: 0,
        aiPatrolAngle: Math.random() * Math.PI * 2,
        aiDifficulty: 0.5 + Math.random() * 0.5
    };
}

// ── FLIGHT PHYSICS ──
function updatePhysics(ac, dt, controls) {
    if (!ac.alive) return;
    var spec = ac.spec;
    var agility = spec.agility;
    var speedRatio = ac.speed / spec.maxSpeed;

    var controlEffect = Math.min(1, speedRatio * 2) * agility;

    ac.pitchRate = nlerp(0.08, ac.pitchRate, controls.pitch * 2.5 * controlEffect);
    ac.rollRate = nlerp(0.08, ac.rollRate, controls.roll * 3.0 * controlEffect);
    ac.yawRate = nlerp(0.08, ac.yawRate, controls.yaw * 1.5 * controlEffect);

    var q = ac.mesh.quaternion;
    var pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ac.pitchRate * dt);
    var rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ac.rollRate * dt);
    var yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ac.yawRate * dt);
    q.multiply(pitchQ).multiply(rollQ).multiply(yawQ);
    q.normalize();

    ac.throttle = Math.max(0, Math.min(1, ac.throttle + controls.throttle * dt));

    var thrust = ac.throttle * spec.maxSpeed * 2;
    var drag = ac.speed * ac.speed * 0.003;
    var accel = thrust - drag;
    ac.speed += accel * dt;
    ac.speed = Math.max(20, Math.min(spec.maxSpeed, ac.speed));

    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    ac.velocity.copy(forward).multiplyScalar(ac.speed);

    // Wind effect (stronger at altitude, weaker for heavy aircraft)
    var windFactor = Math.min(1, ac.mesh.position.y / 500) * (1 / (spec.health / 80));
    ac.velocity.x += wind.x * windFactor * dt * 10;
    ac.velocity.y += wind.y * windFactor * dt * 10;
    ac.velocity.z += wind.z * windFactor * dt * 10;

    // Lift + Gravity
    var liftFactor = Math.min(1, speedRatio * 1.5);
    var upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    var liftForce = upDir.y * liftFactor * GRAVITY;
    ac.velocity.y += (liftForce - GRAVITY) * dt;

    ac.mesh.position.add(ac.velocity.clone().multiplyScalar(dt));

    // Turbulence (light random perturbation)
    if (ac.isPlayer) {
        var turb = 0.002 * (1 + wind.length() * 0.02);
        ac.mesh.quaternion.multiply(
            new THREE.Quaternion().setFromEuler(new THREE.Euler(
                (Math.random() - 0.5) * turb,
                (Math.random() - 0.5) * turb * 0.5,
                (Math.random() - 0.5) * turb
            ))
        );
    }

    // Ground collision
    var groundH = getTerrainHeight(ac.mesh.position.x, ac.mesh.position.z) + 3;
    if (ac.mesh.position.y < groundH) {
        if (ac.speed > 80) {
            damageAircraft(ac, 999);
        } else {
            ac.mesh.position.y = groundH;
            ac.velocity.y = Math.max(0, ac.velocity.y);
        }
    }

    // World bounds
    var bounds = TERRAIN_SIZE * 0.45;
    if (Math.abs(ac.mesh.position.x) > bounds) ac.mesh.position.x *= 0.99;
    if (Math.abs(ac.mesh.position.z) > bounds) ac.mesh.position.z *= 0.99;
    if (ac.mesh.position.y > 5000) ac.velocity.y -= 20 * dt;

    // G-force
    ac.gForce = 1 + Math.abs(ac.pitchRate) * ac.speed * 0.003;

    // Afterburner
    ac.mesh.children.forEach(function(c) {
        if (c.name === 'afterburner') {
            c.visible = ac.throttle > 0.7;
            if (c.visible) {
                c.scale.z = 0.5 + Math.random() * 0.5;
                c.material.opacity = 0.3 + ac.throttle * 0.4;
            }
        }
    });

    // Stall warning
    var stalling = ac.speed < spec.maxSpeed * 0.12;
    if (ac.isPlayer) {
        document.getElementById('stallWarning').style.display = stalling ? 'block' : 'none';
    }
}

// ── COMBAT ──
function damageAircraft(ac, amount) {
    ac.health -= amount;
    if (ac.health <= 0) {
        ac.health = 0;
        ac.alive = false;
        createExplosion(ac.mesh.position.clone(), 3);
        ac.mesh.visible = false;
        if (ac.isPlayer) {
            endGame();
        } else {
            score += 100;
            kills++;
            notify(ac.spec.name + ' DESTROYED');
        }
    }
}

function fireBullet(ac) {
    if (!ac.alive || ac.ammo <= 0 || ac.spec.gunRate === 0) return;
    var now = clock.getElapsedTime();
    if (now - ac.lastGunFire < 1 / ac.spec.gunRate) return;
    ac.lastGunFire = now;
    ac.ammo--;

    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.mesh.quaternion);
    var spread = 0.01;
    forward.x += (Math.random() - 0.5) * spread;
    forward.y += (Math.random() - 0.5) * spread;
    forward.normalize();

    var mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.15),
        new THREE.MeshBasicMaterial({ color: ac.isPlayer ? 0xffff00 : 0xff4400 })
    );
    mesh.position.copy(ac.mesh.position).add(forward.clone().multiplyScalar(14));
    scene.add(mesh);

    var trailGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), forward.clone().multiplyScalar(-2)
    ]);
    var trail = new THREE.Line(trailGeo,
        new THREE.LineBasicMaterial({ color: ac.isPlayer ? 0xffff44 : 0xff6644, transparent: true, opacity: 0.6 })
    );
    mesh.add(trail);

    bullets.push({
        mesh: mesh,
        velocity: forward.multiplyScalar(BULLET_SPEED).add(ac.velocity.clone().multiplyScalar(0.3)),
        owner: ac,
        damage: ac.spec.gunDamage,
        life: 2
    });
}

function fireMissile(ac, target) {
    if (!ac.alive || ac.missileCount <= 0 || !target) return;
    var now = clock.getElapsedTime();
    if (now - ac.lastMissileFire < 1.5) return;
    ac.lastMissileFire = now;
    ac.missileCount--;

    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.mesh.quaternion);
    var missileGroup = new THREE.Group();
    var body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 1.5, 6),
        new THREE.MeshBasicMaterial({ color: 0xdddddd })
    );
    body.rotation.x = Math.PI / 2;
    missileGroup.add(body);
    var mNose = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.3, 6),
        new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    mNose.rotation.x = -Math.PI / 2;
    mNose.position.z = -0.9;
    missileGroup.add(mNose);

    missileGroup.position.copy(ac.mesh.position).add(forward.clone().multiplyScalar(10));
    missileGroup.quaternion.copy(ac.mesh.quaternion);
    scene.add(missileGroup);

    missiles.push({
        mesh: missileGroup,
        velocity: forward.multiplyScalar(MISSILE_SPEED),
        target: target,
        owner: ac,
        damage: ac.spec.missileDmg,
        life: 8,
        smokeTimer: 0
    });

    if (ac.isPlayer) notify('MISSILE AWAY');
}

function deployFlare(ac) {
    if (!ac.alive || ac.flareCount <= 0) return;
    var now = clock.getElapsedTime();
    if (now - ac.lastFlareFire < 0.5) return;
    ac.lastFlareFire = now;
    ac.flareCount--;

    for (var i = 0; i < 5; i++) {
        var flarePos = ac.mesh.position.clone().add(
            new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5 + 5
            )
        );
        var flareMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.3),
            new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true })
        );
        flareMesh.position.copy(flarePos);
        scene.add(flareMesh);
        flares.push({
            mesh: flareMesh,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 20,
                -10 + Math.random() * 5,
                (Math.random() - 0.5) * 20
            ),
            life: 3
        });
    }
}

function updateBullets(dt) {
    for (var i = bullets.length - 1; i >= 0; i--) {
        var b = bullets[i];
        b.life -= dt;
        if (b.life <= 0) {
            scene.remove(b.mesh);
            bullets.splice(i, 1);
            continue;
        }
        b.mesh.position.add(b.velocity.clone().multiplyScalar(dt));

        var targets = b.owner.isPlayer ? enemies : [player];
        for (var j = 0; j < targets.length; j++) {
            var target = targets[j];
            if (!target || !target.alive) continue;
            var dist = b.mesh.position.distanceTo(target.mesh.position);
            if (dist < 18) {
                damageAircraft(target, b.damage);
                createImpact(b.mesh.position.clone());
                scene.remove(b.mesh);
                bullets.splice(i, 1);
                if (b.owner.isPlayer) score += 5;
                break;
            }
        }
    }
}

function updateMissiles(dt) {
    for (var i = missiles.length - 1; i >= 0; i--) {
        var m = missiles[i];
        m.life -= dt;
        if (m.life <= 0) {
            scene.remove(m.mesh);
            missiles.splice(i, 1);
            continue;
        }

        if (m.target && m.target.alive) {
            // Check for flare distraction
            for (var fi = 0; fi < flares.length; fi++) {
                if (flares[fi].mesh.position.distanceTo(m.mesh.position) < 80) {
                    m.target = { mesh: flares[fi].mesh, alive: true };
                    break;
                }
            }

            var toTarget = m.target.mesh.position.clone().sub(m.mesh.position).normalize();
            var currentDir = new THREE.Vector3(0, 0, -1).applyQuaternion(m.mesh.quaternion);
            currentDir.lerp(toTarget, MISSILE_TURN * dt).normalize();
            m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), currentDir);
            m.velocity.copy(currentDir).multiplyScalar(MISSILE_SPEED);
        }

        m.mesh.position.add(m.velocity.clone().multiplyScalar(dt));

        m.smokeTimer -= dt;
        if (m.smokeTimer <= 0) {
            m.smokeTimer = 0.03;
            createSmoke(m.mesh.position.clone());
        }

        var targets = m.owner.isPlayer ? enemies : [player];
        for (var j = 0; j < targets.length; j++) {
            var target = targets[j];
            if (!target || !target.alive) continue;
            if (m.mesh.position.distanceTo(target.mesh.position) < 35) {
                damageAircraft(target, m.damage);
                createExplosion(m.mesh.position.clone(), 2);
                scene.remove(m.mesh);
                missiles.splice(i, 1);
                if (m.owner.isPlayer) score += 25;
                break;
            }
        }

        if (missiles[i] && m.mesh.position.y < getTerrainHeight(m.mesh.position.x, m.mesh.position.z)) {
            createExplosion(m.mesh.position.clone(), 1.5);
            scene.remove(m.mesh);
            missiles.splice(i, 1);
        }
    }
}

function updateFlares(dt) {
    for (var i = flares.length - 1; i >= 0; i--) {
        var f = flares[i];
        f.life -= dt;
        f.velocity.y -= 15 * dt;
        f.mesh.position.add(f.velocity.clone().multiplyScalar(dt));
        f.mesh.material.opacity = f.life / 3;
        if (f.life <= 0) {
            scene.remove(f.mesh);
            flares.splice(i, 1);
        }
    }
}

// ── PARTICLES ──
function createExplosion(pos, size) {
    var count = 30;
    var colors = [0xff4400, 0xff8800, 0xffcc00, 0xff2200];
    for (var i = 0; i < count; i++) {
        var mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.3 + Math.random() * 0.5),
            new THREE.MeshBasicMaterial({
                color: colors[Math.floor(Math.random() * colors.length)],
                transparent: true
            })
        );
        mesh.position.copy(pos);
        scene.add(mesh);
        particles.push({
            mesh: mesh,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * size * 40,
                (Math.random() - 0.5) * size * 40,
                (Math.random() - 0.5) * size * 40
            ),
            life: 0.5 + Math.random() * 1,
            maxLife: 1.5,
            type: 'explosion'
        });
    }
    var flash = new THREE.PointLight(0xff6600, 50, 200);
    flash.position.copy(pos);
    scene.add(flash);
    setTimeout(function() { scene.remove(flash); }, 200);
}

function createImpact(pos) {
    for (var i = 0; i < 5; i++) {
        var mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.15),
            new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true })
        );
        mesh.position.copy(pos);
        scene.add(mesh);
        particles.push({
            mesh: mesh,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20
            ),
            life: 0.3,
            maxLife: 0.3,
            type: 'impact'
        });
    }
}

function createSmoke(pos) {
    var mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.3),
        new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.4 })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    particles.push({
        mesh: mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2),
        life: 1.5,
        maxLife: 1.5,
        type: 'smoke'
    });
}

function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
            continue;
        }
        p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
        if (p.type === 'explosion') {
            p.velocity.multiplyScalar(0.96);
            p.mesh.material.opacity = p.life / p.maxLife;
            p.mesh.scale.multiplyScalar(1.02);
        } else if (p.type === 'smoke') {
            p.mesh.material.opacity = (p.life / p.maxLife) * 0.4;
            p.mesh.scale.multiplyScalar(1.01);
        } else {
            p.mesh.material.opacity = p.life / p.maxLife;
        }
    }
}

// ── AI ──
function updateAI(enemy, dt) {
    if (!enemy.alive || !player || !player.alive) return;

    enemy.aiStateTimer -= dt;
    var distToPlayer = enemy.mesh.position.distanceTo(player.mesh.position);
    var d = enemy.aiDifficulty;

    if (enemy.aiStateTimer <= 0) {
        if (enemy.health < enemy.maxHealth * 0.25) {
            enemy.aiState = 'evade';
            enemy.aiStateTimer = 2 + Math.random() * 3;
        } else if (distToPlayer < 1200) {
            enemy.aiState = 'attack';
            enemy.aiStateTimer = 4 + Math.random() * 3;
        } else if (distToPlayer < 3000) {
            enemy.aiState = 'pursue';
            enemy.aiStateTimer = 3 + Math.random() * 3;
        } else {
            enemy.aiState = 'patrol';
            enemy.aiStateTimer = 5 + Math.random() * 5;
        }
    }

    var controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

    if (enemy.aiState === 'patrol') {
        enemy.aiPatrolAngle += 0.3 * dt;
        var patrolTarget = new THREE.Vector3(
            Math.cos(enemy.aiPatrolAngle) * 800,
            300 + Math.sin(enemy.aiPatrolAngle * 0.5) * 100,
            Math.sin(enemy.aiPatrolAngle) * 800
        ).add(enemy.mesh.position);
        steerToward(enemy, patrolTarget, controls, 0.5);
        controls.throttle = (0.4 - enemy.throttle) * 2;

    } else if (enemy.aiState === 'pursue') {
        var lead = player.velocity.clone().multiplyScalar(distToPlayer / BULLET_SPEED * d);
        var targetPos = player.mesh.position.clone().add(lead);
        steerToward(enemy, targetPos, controls, d);
        controls.throttle = (0.7 - enemy.throttle) * 2;
        if (distToPlayer < 800 && isAligned(enemy, player.mesh.position, 0.15)) {
            enemy.aiState = 'attack';
            enemy.aiStateTimer = 2;
        }

    } else if (enemy.aiState === 'attack') {
        var lead = player.velocity.clone().multiplyScalar(distToPlayer / BULLET_SPEED * d);
        var targetPos = player.mesh.position.clone().add(lead);
        steerToward(enemy, targetPos, controls, d);
        controls.throttle = (0.6 - enemy.throttle) * 2;

        if (isAligned(enemy, player.mesh.position, 0.15) && distToPlayer < GUN_RANGE) {
            fireBullet(enemy);
        }
        if (isAligned(enemy, player.mesh.position, 0.1) && distToPlayer < 2500 && enemy.missileCount > 0 && Math.random() < 0.015 * d) {
            fireMissile(enemy, player);
        }
        if (distToPlayer > 2500) {
            enemy.aiState = 'pursue';
            enemy.aiStateTimer = 3;
        }

    } else if (enemy.aiState === 'evade') {
        var away = enemy.mesh.position.clone().sub(player.mesh.position).normalize();
        var evadeTarget = enemy.mesh.position.clone().add(away.multiplyScalar(500));
        evadeTarget.y += 200;
        evadeTarget.x += Math.sin(clock.getElapsedTime() * 3) * 300;
        steerToward(enemy, evadeTarget, controls, 0.8);
        controls.throttle = (1.0 - enemy.throttle) * 2;

        if (enemy.flareCount > 0 && Math.random() < 0.02) {
            deployFlare(enemy);
        }
    }

    // Terrain avoidance - check actual ground height, not just absolute altitude
    var groundBelow = getTerrainHeight(enemy.mesh.position.x, enemy.mesh.position.z);
    var agl = enemy.mesh.position.y - groundBelow; // above ground level
    if (agl < 150) {
        // Emergency pull up - override all other controls
        controls.pitch = -1.5;
        controls.roll *= 0.2; // flatten out
        controls.throttle = 1;
    } else if (agl < 300) {
        controls.pitch = Math.min(controls.pitch, -0.5);
    }

    // Also check terrain ahead
    var fwdCheck = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.mesh.quaternion);
    var aheadPos = enemy.mesh.position.clone().add(fwdCheck.multiplyScalar(200));
    var groundAhead = getTerrainHeight(aheadPos.x, aheadPos.z);
    if (groundAhead > enemy.mesh.position.y - 80) {
        controls.pitch = -1.5;
        controls.throttle = 1;
    }

    updatePhysics(enemy, dt, controls);
}

function steerToward(ac, targetPos, controls, intensity) {
    var toTarget = targetPos.clone().sub(ac.mesh.position).normalize();
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.mesh.quaternion);
    var right = new THREE.Vector3(1, 0, 0).applyQuaternion(ac.mesh.quaternion);
    var up = new THREE.Vector3(0, 1, 0).applyQuaternion(ac.mesh.quaternion);

    // How much the target is above/below us in local frame
    var localUp = toTarget.dot(up);
    // How much the target is left/right in local frame
    var localRight = toTarget.dot(right);
    // How much the target is in front
    var localForward = toTarget.dot(forward);

    // Pitch: pull up if target is above, push down if below
    controls.pitch = -localUp * intensity * 3;

    // If target is mostly ahead, use yaw to fine-aim; otherwise roll + pitch to turn
    if (localForward > 0.7) {
        // Target roughly ahead - fine adjustments
        controls.yaw = -localRight * intensity * 2;
        controls.roll = -localRight * intensity * 0.5;
    } else {
        // Target to the side or behind - bank and pull
        controls.roll = -localRight * intensity * 2;
        controls.yaw = -localRight * intensity;
        // Pull harder when banked toward target
        if (Math.abs(localUp) < 0.3) {
            controls.pitch = -0.8 * intensity;
        }
    }
}

function isAligned(ac, targetPos, threshold) {
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.mesh.quaternion);
    var toTarget = targetPos.clone().sub(ac.mesh.position).normalize();
    return forward.dot(toTarget) > (1 - threshold);
}

// ── LOCK-ON ──
function updateLockOn(dt) {
    if (!player || !player.alive) return;
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.mesh.quaternion);
    var bestTarget = null;
    var bestDot = 0.9;

    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (!e.alive) continue;
        var toE = e.mesh.position.clone().sub(player.mesh.position).normalize();
        var dot = forward.dot(toE);
        if (dot > bestDot) {
            bestDot = dot;
            bestTarget = e;
        }
    }

    var lockEl = document.getElementById('lockIndicator');
    if (bestTarget) {
        if (bestTarget === lockTarget) {
            lockProgress += dt;
        } else {
            lockTarget = bestTarget;
            lockProgress = 0;
        }
        lockEl.className = lockProgress >= LOCK_TIME ? 'locked' : 'locking';
    } else {
        lockTarget = null;
        lockProgress = 0;
        lockEl.className = '';
    }
}

// ── CAMERA ──
function updateCamera(dt) {
    if (!player || !player.mesh) return;
    var offset = cameraOffsets[cameraMode].clone();
    var desiredPos = new THREE.Vector3();

    if (cameraMode === 1) {
        player.mesh.localToWorld(desiredPos.copy(offset));
        camera.position.copy(desiredPos);
        var look = new THREE.Vector3(0, 0, -50);
        player.mesh.localToWorld(look);
        camera.lookAt(look);
    } else {
        player.mesh.localToWorld(desiredPos.copy(offset));
        camera.position.lerp(desiredPos, cameraMode === 0 ? 0.06 : 0.04);
        camera.lookAt(player.mesh.position);
    }
}

// ── HUD ──
function updateHUD() {
    if (!player) return;

    var speed = Math.round(player.speed * 1.2);
    var alt = Math.round(Math.max(0, player.mesh.position.y) * 3.28);
    var q = player.mesh.quaternion;
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    var heading = Math.round(((Math.atan2(-forward.x, -forward.z) * 180 / Math.PI) + 360) % 360);

    document.getElementById('speedValue').textContent = speed;
    document.getElementById('altValue').textContent = alt;
    document.getElementById('headingValue').textContent = String(heading).padStart(3, '0');
    document.getElementById('throttleFill').style.height = (player.throttle * 100) + '%';
    document.getElementById('ammoCount').textContent = player.ammo;
    document.getElementById('missileCount').textContent = player.missileCount;
    document.getElementById('scoreValue').textContent = score;
    document.getElementById('killsValue').textContent = kills;
    document.getElementById('gForceValue').textContent = player.gForce.toFixed(1);

    var hp = player.health / player.maxHealth;
    var healthFill = document.getElementById('healthFill');
    healthFill.style.width = (hp * 100) + '%';
    healthFill.style.background = hp > 0.5 ? '#00ff88' : hp > 0.25 ? '#ffaa00' : '#ff4444';

    drawRadar();
    drawAttitude();
    updateTargetIndicators();
}

function drawRadar() {
    var canvas = document.getElementById('radarCanvas');
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var cx = w / 2, cy = h / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 20, 10, 0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, cx, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#00ff8833';
    ctx.lineWidth = 0.5;
    for (var r = 15; r < cx; r += 15) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.stroke();

    if (!player) return;

    var fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.mesh.quaternion);
    var playerAngle = Math.atan2(fwd.x, fwd.z);
    var radarRange = 3000;

    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (!e.alive) continue;
        var dx = e.mesh.position.x - player.mesh.position.x;
        var dz = e.mesh.position.z - player.mesh.position.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > radarRange) continue;

        var angle = Math.atan2(dx, dz) - playerAngle;
        var rd = (dist / radarRange) * (cx - 5);
        var bx = cx + Math.sin(angle) * rd;
        var by = cy - Math.cos(angle) * rd;

        ctx.fillStyle = e === lockTarget ? '#ff4444' : '#ff8800';
        ctx.fillRect(bx - 2, by - 2, 4, 4);
    }

    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
}

function drawAttitude() {
    var canvas = document.getElementById('attitudeCanvas');
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var cx = w / 2, cy = h / 2;

    ctx.clearRect(0, 0, w, h);
    if (!player) return;

    var q = player.mesh.quaternion;
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    var right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    var up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    var pitch = Math.asin(forward.y);
    var roll = Math.atan2(right.y, up.y);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    var pitchOffset = pitch * 60;
    ctx.fillStyle = '#2244aa';
    ctx.fillRect(-w, -h + pitchOffset, w * 2, h);
    ctx.fillStyle = '#446633';
    ctx.fillRect(-w, pitchOffset, w * 2, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-w, pitchOffset);
    ctx.lineTo(w, pitchOffset);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff88';
    ctx.lineWidth = 0.5;
    for (var deg = -30; deg <= 30; deg += 10) {
        if (deg === 0) continue;
        var y = pitchOffset - deg * 2;
        ctx.beginPath();
        ctx.moveTo(-15, y);
        ctx.lineTo(15, y);
        ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy); ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 15, cy);
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = '#00ff8844';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 1, 0, Math.PI * 2);
    ctx.stroke();
}

var targetMarkers = [];
function updateTargetIndicators() {
    for (var k = 0; k < targetMarkers.length; k++) targetMarkers[k].remove();
    targetMarkers.length = 0;

    if (!player) return;

    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (!e.alive) continue;
        var screenPos = toScreen(e.mesh.position);
        if (!screenPos) continue;

        var dist = player.mesh.position.distanceTo(e.mesh.position);
        var isLocked = e === lockTarget && lockProgress >= LOCK_TIME;
        var borderColor = isLocked ? '#ff0000' : '#00ffff';
        var textColor = isLocked ? '#ff0000' : '#00ffff';

        var marker = document.createElement('div');
        marker.style.cssText = 'position:absolute;left:' + screenPos.x + 'px;top:' + screenPos.y + 'px;transform:translate(-50%,-50%);pointer-events:none;z-index:11;';

        var box = document.createElement('div');
        box.style.cssText = 'width:24px;height:24px;border:1px solid ' + borderColor + ';transform:rotate(45deg);';
        marker.appendChild(box);

        var label = document.createElement('div');
        label.style.cssText = 'color:' + textColor + ';font-size:9px;text-align:center;margin-top:6px;font-family:Courier New,monospace;text-shadow:0 0 4px rgba(0,255,255,0.5);';
        label.textContent = Math.round(dist) + 'm';
        marker.appendChild(label);

        document.getElementById('hud').appendChild(marker);
        targetMarkers.push(marker);
    }
}

function toScreen(worldPos) {
    var v = worldPos.clone().project(camera);
    if (v.z > 1) return null;
    return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight
    };
}

// ── NOTIFICATION ──
function notify(text) {
    var el = document.createElement('div');
    el.className = 'notif';
    el.textContent = text;
    document.getElementById('notifications').appendChild(el);
    setTimeout(function() { el.remove(); }, 3000);
}

// ── ENEMY SPAWNING ──
function spawnEnemies(count) {
    var types = Object.keys(AIRCRAFT).filter(function(k) {
        var t = AIRCRAFT[k].type;
        return t !== 'Civilian GA' && t !== 'Airliner' && t !== 'Heavy Airliner' && t !== 'Military Transport';
    });
    for (var i = 0; i < count; i++) {
        var type = types[Math.floor(Math.random() * types.length)];
        var ac = createAircraftEntity(type, false);
        var angle = Math.random() * Math.PI * 2;
        var dist = 1000 + Math.random() * 2000;
        var spawnX = player.mesh.position.x + Math.cos(angle) * dist;
        var spawnZ = player.mesh.position.z + Math.sin(angle) * dist;
        var groundH = getTerrainHeight(spawnX, spawnZ);
        ac.mesh.position.set(
            spawnX,
            Math.max(400, groundH + 300) + Math.random() * 400,
            spawnZ
        );
        ac.mesh.quaternion.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0));
        ac.aiDifficulty = 0.4 + Math.random() * 0.3 + wave * 0.05;
        enemies.push(ac);
    }
}

// ── INPUT ──
window.addEventListener('keydown', function(e) {
    keys[e.code] = true;
    if (e.code === 'Escape') {
        if (gameState === 'playing') {
            gameState = 'paused';
            document.getElementById('pauseOverlay').classList.add('show');
        } else if (gameState === 'paused') {
            gameState = 'playing';
            document.getElementById('pauseOverlay').classList.remove('show');
        }
    }
    if (e.code === 'KeyV' && gameState === 'playing') {
        cameraMode = (cameraMode + 1) % cameraOffsets.length;
    }
    if (e.code === 'Tab' && gameState === 'playing') {
        e.preventDefault();
        cycleTarget();
    }
});
window.addEventListener('keyup', function(e) { keys[e.code] = false; });

function getPlayerControls() {
    var c = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    if (keys['KeyW'] || keys['ArrowUp']) c.pitch = -1;
    if (keys['KeyS'] || keys['ArrowDown']) c.pitch = 1;
    if (keys['KeyA'] || keys['ArrowLeft']) c.roll = 1;
    if (keys['KeyD'] || keys['ArrowRight']) c.roll = -1;
    if (keys['KeyQ']) c.yaw = 1;
    if (keys['KeyE']) c.yaw = -1;
    if (keys['ShiftLeft'] || keys['ShiftRight']) c.throttle = 1;
    if (keys['ControlLeft'] || keys['ControlRight']) c.throttle = -1;
    return c;
}

function handlePlayerActions() {
    if (!player || !player.alive) return;
    if (keys['Space']) fireBullet(player);
    if (keys['KeyM']) {
        if (lockTarget && lockProgress >= LOCK_TIME) {
            fireMissile(player, lockTarget);
        }
    }
    if (keys['KeyF']) deployFlare(player);
}

function cycleTarget() {
    var alive = enemies.filter(function(e) { return e.alive; });
    if (alive.length === 0) { lockTarget = null; return; }
    var idx = alive.indexOf(lockTarget);
    lockTarget = alive[(idx + 1) % alive.length];
    lockProgress = 0;
}

// ── GAME FLOW ──
function startGame() {
    cleanupGame();
    gameState = 'playing';
    score = 0;
    kills = 0;
    wave = 1;

    document.getElementById('menu').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('gameover').classList.remove('show');

    player = createAircraftEntity(selectedAircraft, true);
    player.mesh.position.set(0, 300, 0);
    player.throttle = 0.5;

    waveSpawning = false;
    if (selectedMode === 'dogfight') {
        spawnEnemies(2);
    } else if (selectedMode === 'survival') {
        spawnEnemies(1);
    }

    notify('AIRBORNE - ' + AIRCRAFT[selectedAircraft].name.toUpperCase());
    if (wind.length() > 5) {
        var windSpeed = Math.round(wind.length());
        var windDir = Math.round(((Math.atan2(-wind.x, -wind.z) * 180 / Math.PI) + 360) % 360);
        notify('WIND ' + windDir + '/' + windSpeed + ' KTS');
    }
}

function endGame() {
    gameState = 'gameover';
    document.getElementById('gameover').classList.add('show');
    document.getElementById('finalScore').textContent = 'SCORE: ' + score;
    document.getElementById('finalKills').textContent = 'KILLS: ' + kills;
}

function cleanupGame() {
    if (player) { scene.remove(player.mesh); player = null; }
    enemies.forEach(function(e) { scene.remove(e.mesh); });
    enemies = [];
    bullets.forEach(function(b) { scene.remove(b.mesh); });
    bullets = [];
    missiles.forEach(function(m) { scene.remove(m.mesh); });
    missiles = [];
    particles.forEach(function(p) { scene.remove(p.mesh); });
    particles = [];
    flares.forEach(function(f) { scene.remove(f.mesh); });
    flares = [];
    targetMarkers.forEach(function(m) { m.remove(); });
    targetMarkers.length = 0;
    lockTarget = null;
    lockProgress = 0;
}

function returnToMenu() {
    cleanupGame();
    gameState = 'menu';
    document.getElementById('menu').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('gameover').classList.remove('show');
}

// ── WAVE LOGIC ──
function checkWaveComplete() {
    if (selectedMode !== 'survival' && selectedMode !== 'dogfight') return;
    if (waveSpawning) return; // Prevent spawning thousands of enemies
    var alive = enemies.filter(function(e) { return e.alive; });
    if (alive.length === 0) {
        waveSpawning = true;
        wave++;
        var count = selectedMode === 'survival' ? Math.min(wave + 1, 6) : Math.min(2 + wave, 5);
        notify('WAVE ' + wave + ' - ' + count + ' HOSTILES INCOMING');
        setTimeout(function() {
            spawnEnemies(count);
            waveSpawning = false;
        }, 2000);
        score += wave * 50;
    }
}

// ── MAIN LOOP ──
function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);

    if (gameState === 'playing') {
        updateWind(dt);

        if (player && player.alive) {
            var controls = getPlayerControls();
            updatePhysics(player, dt, controls);
            handlePlayerActions();
            updateLockOn(dt);
        }

        for (var i = 0; i < enemies.length; i++) {
            if (enemies[i].alive) updateAI(enemies[i], dt);
        }

        updateBullets(dt);
        updateMissiles(dt);
        updateFlares(dt);
        updateParticles(dt);
        updateCamera(dt);
        updateHUD();
        checkWaveComplete();

        // Move clouds with wind
        for (var i = 0; i < clouds.length; i++) {
            clouds[i].position.x += wind.x * dt * 0.5;
            clouds[i].position.z += wind.z * dt * 0.5;
            // Wrap clouds
            if (clouds[i].position.x > TERRAIN_SIZE / 2) clouds[i].position.x -= TERRAIN_SIZE;
            if (clouds[i].position.x < -TERRAIN_SIZE / 2) clouds[i].position.x += TERRAIN_SIZE;
            if (clouds[i].position.z > TERRAIN_SIZE / 2) clouds[i].position.z -= TERRAIN_SIZE;
            if (clouds[i].position.z < -TERRAIN_SIZE / 2) clouds[i].position.z += TERRAIN_SIZE;
        }

        // Dynamic sky
        if (player && player.alive) {
            var altRatio = Math.min(1, player.mesh.position.y / 3000);
            var skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0x87CEEB),
                new THREE.Color(0x1a1a3e),
                altRatio
            );
            scene.background = skyColor;
            scene.fog.color = skyColor;
        }
    }

    renderer.render(scene, camera);
}

// ── INIT ──
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 2000, 10000);

    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 15000);
    camera.position.set(0, 300, 50);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0x668899, 0.6));
    sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
    sunLight.position.set(500, 1000, 500);
    scene.add(sunLight);
    scene.add(new THREE.HemisphereLight(0x88bbdd, 0x445533, 0.4));

    createTerrain();
    createClouds();

    clock = new THREE.Clock();

    window.addEventListener('resize', function() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    buildMenu();
    animate();
}

// ── MENU BUILDER (safe DOM methods) ──
function buildMenu() {
    var grid = document.getElementById('aircraftGrid');
    var keys = Object.keys(AIRCRAFT);

    for (var k = 0; k < keys.length; k++) {
        (function(key) {
            var spec = AIRCRAFT[key];
            var card = document.createElement('div');
            card.className = 'ac-card' + (key === selectedAircraft ? ' selected' : '');
            card.dataset.type = key;

            var nameEl = document.createElement('div');
            nameEl.className = 'ac-name';
            nameEl.textContent = spec.name;
            card.appendChild(nameEl);

            var typeEl = document.createElement('div');
            typeEl.className = 'ac-type';
            typeEl.textContent = spec.type + ' \u00B7 ' + spec.country;
            card.appendChild(typeEl);

            var statsEl = document.createElement('div');
            statsEl.className = 'ac-stats';

            var statData = [
                ['SPD', Math.round((spec.maxSpeed / 750) * 100)],
                ['AGI', Math.round(spec.agility * 100)],
                ['ARM', Math.round((spec.health / 220) * 100)],
                ['GUN', spec.gunRate > 0 ? Math.round((spec.gunRate / 20) * 100) : 0]
            ];

            for (var s = 0; s < statData.length; s++) {
                var row = document.createElement('div');
                row.appendChild(document.createTextNode(statData[s][0] + ' '));
                var bar = document.createElement('div');
                bar.className = 'stat-bar';
                var fill = document.createElement('div');
                fill.className = 'stat-fill';
                fill.style.width = statData[s][1] + '%';
                bar.appendChild(fill);
                row.appendChild(bar);
                statsEl.appendChild(row);
            }

            var mslRow = document.createElement('div');
            mslRow.textContent = 'MSL: ' + spec.missiles;
            statsEl.appendChild(mslRow);

            card.appendChild(statsEl);

            card.addEventListener('click', function() {
                var cards = document.querySelectorAll('.ac-card');
                for (var c = 0; c < cards.length; c++) cards[c].classList.remove('selected');
                card.classList.add('selected');
                selectedAircraft = key;
            });

            grid.appendChild(card);
        })(keys[k]);
    }

    // Mode buttons
    var modeBtns = document.querySelectorAll('.mode-btn');
    for (var i = 0; i < modeBtns.length; i++) {
        modeBtns[i].addEventListener('click', function() {
            for (var j = 0; j < modeBtns.length; j++) modeBtns[j].classList.remove('selected');
            this.classList.add('selected');
            selectedMode = this.dataset.mode;
        });
    }

    document.getElementById('startBtn').addEventListener('click', startGame);
    document.getElementById('restartBtn').addEventListener('click', returnToMenu);
}

// ── GO ──
init();
