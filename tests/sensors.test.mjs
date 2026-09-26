import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// The sensors plug-in (sensors.js), headless: the targeting pod's gimbal geometry (aft stop, airframe masking,
// the derotated image and slewing), holding a track while the jet manoeuvres, the orbit steering, the grid
// reference parse (war.js) and the pod's identification ranges.
describe('sensors: targeting pod, grid references, identification', () => {
    let THREE, S, W, DEG;
    const flat = (h) => () => h;
    before(async () => {
        THREE = await import('three');
        S = await src('sensors.js');
        W = await src('war.js');
        DEG = Math.PI / 180;
    });

    // a line of sight in the airframe's axes from azimuth (+ right) and elevation (+ up)
    const body = (az, el) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

    test('gimbal angles read back what they were built from', () => {
        for (const [az, el] of [[0, -30], [45, -10], [-120, -60], [170, -5], [-90, 0]]) {
            const g = S.gimbalAngles(body(az * DEG, el * DEG));
            assert.ok(Math.abs(g.az - az * DEG) < 1e-9, 'azimuth ' + az);
            assert.ok(Math.abs(g.el - el * DEG) < 1e-9, 'elevation ' + el);
        }
        assert.ok(Math.abs(S.gimbalAngles(body(0, 0)).off) < 1e-9, 'straight ahead is on the nose');
        assert.ok(Math.abs(S.gimbalAngles(body(180 * DEG, 0)).off - Math.PI) < 1e-9, 'straight back is 180° off it');
    });

    test('slew limits: the gimbal stops 25° short of straight aft, in the same plane', () => {
        const aft = body(175 * DEG, -3 * DEG);
        assert.ok(S.podMask(aft).limit, 'nearly straight back is past the stop');
        const c = S.clampGimbal(aft, new THREE.Vector3());
        const off = S.gimbalAngles(c).off;
        assert.ok(Math.abs(off - S.POD.maxOffNose) < 1e-9, 'clamped onto the stop (' + (off / DEG).toFixed(2) + '°)');
        assert.ok(Math.abs(c.length() - 1) < 1e-9, 'still a unit vector');
        // the same side and the same up/down as it was
        assert.ok(c.x > 0 && c.y < 0, 'stays right and below');
        const inside = body(120 * DEG, -40 * DEG);
        assert.ok(!S.podMask(inside).limit);
        assert.ok(S.clampGimbal(inside, new THREE.Vector3()).distanceTo(inside) < 1e-12, 'inside the field of regard it is left alone');
        // straight back (no plane to keep): down onto the stop
        const back = S.clampGimbal(new THREE.Vector3(0, 0, 1), new THREE.Vector3());
        assert.ok(back.y < 0 && Math.abs(S.gimbalAngles(back).off - S.POD.maxOffNose) < 1e-9);
    });

    test('masking: the pod on the right chin station sees ahead to the nose line and under the right wing, not past the intake or aft', () => {
        assert.ok(!S.podMask(body(0, 0)).masked, 'level ahead: the horizon is in view');
        assert.ok(S.podMask(body(0, 15 * DEG)).masked, 'above the nose line');
        assert.ok(!S.podMask(body(0, -30 * DEG)).masked, '30° down ahead is clear');
        assert.ok(!S.podMask(body(90 * DEG, -10 * DEG)).masked, '10° down on the pod\'s side (right) is clear');
        assert.ok(!S.podMask(body(90 * DEG, 8 * DEG)).masked, 'out to the right it looks under the wing, a little above its plane');
        assert.ok(S.podMask(body(90 * DEG, 20 * DEG)).masked, 'but not through it');
        assert.ok(S.podMask(body(-90 * DEG, -10 * DEG)).masked, '10° down on the far side (left) is behind the intake');
        assert.ok(!S.podMask(body(-90 * DEG, -25 * DEG)).masked, 'further down on the left it clears');
        assert.ok(S.podMask(body(170 * DEG, 0)).masked, 'aft, level: the ventral fins and the tail');
        assert.ok(S.podMask(body(0, -89 * DEG)).margin > 0.5, 'straight down is well clear');
        // banked 30° toward a target 30° below the horizon off the right wing (a wheel round it): in view
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), 30 * DEG);
        const tgt = new THREE.Vector3(Math.cos(30 * DEG), -Math.sin(30 * DEG), 0).applyQuaternion(q.clone().invert());
        assert.ok(!S.podMask(tgt).masked, 'a wheel round the target keeps it in view');
        // the mask edge is continuous in azimuth
        for (let a = -180; a < 180; a += 5) assert.ok(Math.abs(S.maskDepression(a * DEG) - S.maskDepression((a + 5) * DEG)) < 3 * DEG, 'no jump at ' + a);
    });

    test('the image is derotated: the horizon stays level, up is up; slewing moves the cross the right way', () => {
        const R = new THREE.Vector3(), U = new THREE.Vector3();
        const los = new THREE.Vector3(0.3, -0.5, -1).normalize();
        S.imageBasis(los, 0, R, U);
        assert.ok(Math.abs(R.y) < 1e-9, 'image right is horizontal');
        assert.ok(U.y > 0, 'image up points up');
        assert.ok(Math.abs(R.dot(los)) < 1e-9 && Math.abs(U.dot(los)) < 1e-9 && Math.abs(R.dot(U)) < 1e-9, 'an orthonormal frame');
        // looking straight down the jet's heading is up in the picture
        S.imageBasis(new THREE.Vector3(0, -1, 0), Math.PI / 2, R, U); // heading east
        assert.ok(U.x > 0.99, 'straight down: up is the way the jet heads');
        const right = S.slewLos(los, 0.01, 0, 0, new THREE.Vector3());
        assert.ok(right.x > los.x, 'slewing right swings the line of sight right (east when looking north)');
        const up = S.slewLos(los, 0, 0.01, 0, new THREE.Vector3());
        assert.ok(up.y > los.y, 'slewing up raises it');
        assert.ok(Math.abs(right.angleTo(los) - 0.01) < 1e-4, 'by the angle asked for');
    });

    test('rayGround finds the ground under the cross (flat ground at 100 m, and a hill in the way)', () => {
        const o = new THREE.Vector3(0, 3100, 0), d = new THREE.Vector3(0, -3, -4).normalize();
        const hit = S.rayGround(o, d, flat(100), 40000, new THREE.Vector3());
        assert.ok(hit && Math.abs(hit.y - 100) < 0.5 && Math.abs(hit.z + 4000) < 3, 'meets flat ground where it should: ' + JSON.stringify(hit));
        const hill = (x, z) => (z < -2000 && z > -2400 ? 1600 : 100);
        const h2 = S.rayGround(o, d, hill, 40000, new THREE.Vector3());
        assert.ok(h2 && h2.z > -2400 && h2.z < -1990, 'stops at the hill in the way: ' + h2.z.toFixed(0));
        assert.equal(S.rayGround(o, new THREE.Vector3(0, 0.1, -1).normalize(), flat(100), 40000), null, 'above the horizon: no ground');
    });

    test('track hold: the line of sight stays on a ground point while the jet flies, rolls and turns', () => {
        const spi = new THREE.Vector3(2500, 120, -9000);
        const jet = new THREE.Vector3(0, 3000, 0), q = new THREE.Quaternion();
        const vel = new THREE.Vector3(0, 0, -220);
        const qi = new THREE.Quaternion(), los = new THREE.Vector3(), b = new THREE.Vector3(), prevB = new THREE.Vector3();
        let first = true, maxStep = 0, masked = 0, bank = 0, hdg = 0;
        for (let t = 0; t < 30; t += 0.05) {
            // a turn to the right, rolling in at 30°/s to 50° of bank, then easing to 10°
            const want = (t < 20 ? 50 : 10) * DEG;
            bank += Math.max(-0.5 * 0.05, Math.min(0.5 * 0.05, want - bank));
            hdg += 9.81 * Math.tan(bank) / 220 * 0.05;
            q.setFromEuler(new THREE.Euler(0.05, -hdg, -bank, 'YXZ'));
            vel.set(0, 0, -220).applyQuaternion(q);
            jet.addScaledVector(vel, 0.05);
            los.subVectors(spi, jet).normalize();
            // the pod commands exactly this line of sight: back in world axes it still points at the SPI
            b.copy(los).applyQuaternion(qi.copy(q).invert());
            const world = b.clone().applyQuaternion(q);
            assert.ok(world.angleTo(los) < 1e-6);
            const m = S.podMask(b);
            if (m.masked) masked++;
            // the gimbal angles describe the same line of sight
            assert.ok(body(m.az, m.el).angleTo(b) < 1e-6);
            if (!first) maxStep = Math.max(maxStep, b.angleTo(prevB));
            prevB.copy(b); first = false;
        }
        assert.ok(maxStep < 0.1, 'the line of sight moves smoothly in the airframe\'s axes (' + (maxStep / DEG).toFixed(2) + '° a step)');
        assert.ok(masked < 600, 'not masked all the time');
        // a moving unit: the gimbal's slew rate keeps up with it
        const cur = new THREE.Vector3(0, -0.3, -1).normalize(), want = new THREE.Vector3(0.4, -0.3, -1).normalize();
        S.stepToward(cur, want, 0.05);
        assert.ok(Math.abs(cur.angleTo(want) - (new THREE.Vector3(0, -0.3, -1).normalize().angleTo(want) - 0.05)) < 1e-6, 'swings at most the slew rate a step');
        for (let k = 0; k < 20; k++) S.stepToward(cur, want, 0.05);
        assert.ok(cur.angleTo(want) < 1e-6, 'and gets there');
    });

    test('orbit steering settles on the circle round the SPI', () => {
        const c = { x: 5000, z: -5000 }, R = 6000;
        const G = 9.81, V = 210;
        let x = -8000, z = 6000, hdg = 0.3, bank = 0;
        let worst = 0;
        for (let t = 0; t < 360; t += 0.1) {
            const vel = { x: Math.sin(hdg) * V, z: -Math.cos(hdg) * V };
            const want = S.orbitBank({ x, z }, vel, c, R, 1);
            bank += Math.max(-0.1 * 0.5, Math.min(0.1 * 0.5, want - bank)); // 30°/s roll rate
            hdg += G * Math.tan(bank) / V * 0.1;
            x += vel.x * 0.1; z += vel.z * 0.1;
            if (t > 200) worst = Math.max(worst, Math.abs(Math.hypot(x - c.x, z - c.z) - R));
        }
        assert.ok(worst < R * 0.12, 'stays within 12% of the radius once settled (worst ' + worst.toFixed(0) + ' m)');
        // the centre is on the right wing in a right-hand orbit
        const vel = { x: Math.sin(hdg) * V, z: -Math.cos(hdg) * V };
        const rightWing = { x: Math.cos(hdg), z: Math.sin(hdg) };
        assert.ok((c.x - x) * rightWing.x + (c.z - z) * rightWing.z > 0, 'centre off the right wing');
        void vel;
    });

    test('grid references: parse ∘ format round trip, precision, and rubbish refused', () => {
        const war = { grid: W.War.prototype.grid };
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 2000; i++) {
            const x = (rnd() - 0.5) * 220000, z = (rnd() - 0.5) * 220000;
            const ref = war.grid(x, z);
            const p = W.parseGrid(ref);
            assert.ok(p, 'parses ' + ref);
            assert.ok(Math.abs(p.x - x) <= 5.001 && Math.abs(p.z - z) <= 5.001, ref + ' → within the 10 m square of (' + x.toFixed(1) + ', ' + z.toFixed(1) + ')');
            assert.equal(war.grid(p.x, p.z), ref, 'and formats back to the same reference');
        }
        const a = W.parseGrid('KD 412 883');
        assert.deepEqual(W.parseGrid('kd412883'), a, 'case and spaces don\'t matter');
        assert.deepEqual(W.parseGrid('  KD 412883 '), a);
        const coarse = W.parseGrid('KD 41 88');
        assert.equal(coarse.size, 100);
        assert.ok(Math.abs(coarse.x - a.x) < 100 && Math.abs(coarse.z - a.z) < 100, 'a 100 m reference contains the 10 m one');
        assert.equal(W.parseGrid('KD 4 8').size, 1000);
        assert.equal(W.parseGrid('KD 4123 8834').size, 1);
        for (const bad of ['', 'KD', 'KD 412 88', 'KD 41288', 'KI 412 883', 'OK 412 883', 'K1 412 883', 'KD 412 883 1', 'KD 41234 88345', null, undefined]) assert.equal(W.parseGrid(bad), null, 'refuses ' + JSON.stringify(bad));
        // the enemy airbase is where its grid says
        const eb = W.parseGrid(war.grid(7000, -17000));
        assert.ok(Math.hypot(eb.x - 7000, eb.z + 17000) < 8);
    });

    test('identification ranges: NARO beats WIDE, heat helps the FLIR at night, TV needs daylight, weather and nets cost', () => {
        const R = (o) => S.podIdentRange(o).identify;
        const naro = R({ fovDeg: 0.5, sensor: 'TV', light: 1 });
        assert.ok(naro >= 22000 && naro <= 25000, 'a vehicle in NARO on a clear day: about 25 km (' + naro + ')');
        assert.ok(R({ fovDeg: 1.5 }) < R({ fovDeg: 0.5 }) && R({ fovDeg: 4 }) < R({ fovDeg: 1.5 }), 'narrower field, further');
        assert.ok(R({ fovDeg: 4 }) > 5000 && R({ fovDeg: 4 }) < 12000, 'WIDE identifies at several km');
        assert.ok(R({ sensor: 'TV', light: 0.25 }) < 5000, 'the TV camera is nearly blind at night');
        assert.ok(R({ sensor: 'WHOT', light: 0.25 }) > 3 * R({ sensor: 'TV', light: 0.25 }), 'the FLIR sees at night');
        assert.ok(R({ sensor: 'WHOT', light: 0.25, hot: true }) > R({ sensor: 'WHOT', light: 0.25, hot: false }) * 1.3, 'a running engine stands out at night');
        assert.ok(R({ weather: 'rain' }) < R({ weather: 'clear' }) * 0.6, 'rain soaks it up');
        assert.ok(R({ weather: 'storm' }) < R({ weather: 'rain' }));
        assert.ok(R({ conceal: 1, sensor: 'TV' }) < R({ conceal: 1, sensor: 'WHOT' }), 'nets fool the camera more than the FLIR');
        assert.ok(R({ size: 16 }) > R({ size: 4 }), 'big things are identified further out');
        for (const o of [{ size: 40, hot: true }, { size: 100, fovDeg: 0.2 }]) {
            const r = S.podIdentRange(o);
            assert.ok(r.identify <= 25000 && r.detect <= 32000, 'capped');
            assert.ok(r.detect >= r.identify, 'something is seen before it is identified');
        }
    });
});
