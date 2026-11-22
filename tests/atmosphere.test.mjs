// The atmosphere (atmosphere.js) and the palette it gives (weather.js skyPalette): the lookup tables against the
// textbook numbers, energy kept, the sun's colour by its elevation, the shape of the sky (a pale horizon under a blue
// zenith, the glow round the sun growing with haze, the twilight), the table's mapping, and the palette's values
// for every time of day and weather.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const A = await src('atmosphere.js');
const WX = await src('weather.js');
const { ATM } = A;
const D = Math.PI / 180;
const lum = A.lum;
const CLEAR = A.makeAir(WX.PALETTES.day.fogDensity * WX.MIE_PER_HAZE, 1.3); // the clear day's air
const clum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('the air: column densities and transmittance', () => {
    test('straight up from sea level: the scale heights (8 km of molecules, 1.5 km of haze, 15 km of ozone)', () => {
        const c = A.columns(0, 1, [0, 0, 0]);
        assert.ok(Math.abs(c[0] - ATM.HR) < 0.01 && Math.abs(c[1] - ATM.HM) < 0.01 && Math.abs(c[2] - 15) < 0.05, c.join(' '));
    });

    test('the textbook optical depths: Rayleigh 0.046 / 0.108 / 0.265 at 680 / 550 / 440 nm, ozone 0.028 in the green', () => {
        const c = A.columns(0, 1, [0, 0, 0]);
        const tauR = ATM.BETA_R.map(b => b * c[0]), tauO = ATM.BETA_O.map(b => b * c[2]);
        assert.ok(Math.abs(tauR[0] - 0.0464) < 0.001 && Math.abs(tauR[1] - 0.1085) < 0.001 && Math.abs(tauR[2] - 0.2648) < 0.002, 'Rayleigh ' + tauR);
        assert.ok(Math.abs(tauO[1] - 0.0282) < 0.001 && tauO[2] < 0.002, 'ozone ' + tauO);
        // a clean sky overhead passes 94 / 87 / 77 % (molecules and ozone alone)
        const T = A.transmittance(A.makeAir(0, 1.3), 0, 1, [0, 0, 0]);
        assert.ok(Math.abs(T[0] - 0.945) < 0.004 && Math.abs(T[1] - 0.872) < 0.004 && Math.abs(T[2] - 0.766) < 0.004, 'T ' + T);
        // the clear day's aerosol: an optical depth of 0.11 at 550 nm
        assert.ok(Math.abs(CLEAR.mieExt[1] * c[1] - 0.112) < 0.005);
    });

    test('air mass: 1 overhead, 2 at 30°, about 35 for the molecules along the horizon; thinner with height', () => {
        const c = [0, 0, 0], v = A.columns(0, 1, [0, 0, 0]);
        assert.ok(Math.abs(A.columns(0, 0.5, c)[0] / v[0] - 2) < 0.02);
        const hz = A.columns(0, 0, c)[0] / v[0];
        assert.ok(hz > 33 && hz < 39, 'horizon ' + hz); // (Kasten & Young give 38 with refraction)
        assert.ok(Math.abs(A.columns(8, 1, c)[0] / v[0] - Math.exp(-1)) < 0.01, 'a scale height up: 1/e of the molecules');
        assert.ok(A.columns(3, 1, c)[1] / v[1] < 0.15, '3 km up: above most of the haze');
    });

    test('the table agrees with the integral it stands for, to half a percent of the beam', () => {
        let worst = 0;
        for (const h of [0, 0.05, 0.3, 1, 3, 8, 20, 50]) for (const el of [-2, -0.5, 0, 0.5, 2, 5, 15, 40, 90]) {
            if (el * D < -(Math.PI / 2 - A.horizonBeta(h))) continue; // (below the horizon from there)
            const a = A.transmittance(CLEAR, h, Math.sin(el * D), [0, 0, 0]), b = A.transmittance(CLEAR, h, Math.sin(el * D), [0, 0, 0], true);
            for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
        }
        assert.ok(worst < 0.005, 'worst ' + worst);
    });

    test('the sun by its elevation: dimmer and redder all the way down, hidden by the ground, bluer and brighter from height', () => {
        let prev = A.sunTransmittance(CLEAR, 90, 0);
        for (let el = 89; el >= 0; el -= 1) {
            const t = A.sunTransmittance(CLEAR, el, 0);
            assert.ok(lum(t) < lum(prev) && t[0] / t[1] > prev[0] / prev[1] && t[2] / t[1] < prev[2] / prev[1], `at ${el}°`);
            prev = t;
        }
        assert.ok(lum(A.sunTransmittance(CLEAR, 0, 0)) < 0.001, 'on the horizon: all but gone');
        assert.deepEqual(A.sunTransmittance(CLEAR, -1, 0), [0, 0, 0]);
        assert.ok(lum(A.sunTransmittance(CLEAR, -1, 3)) > 0, 'still up from 3 km (the horizon dips 1.8°)');
        const lo = A.sunTransmittance(CLEAR, 3, 0), hi = A.sunTransmittance(CLEAR, 3, 3);
        assert.ok(lum(hi) > 3 * lum(lo) && hi[0] / hi[1] < lo[0] / lo[1]);
        // more haze: dimmer at every elevation
        const hazy = A.makeAir(CLEAR.mie * 2, 1.3);
        for (const el of [60, 20, 5]) assert.ok(lum(A.sunTransmittance(hazy, el, 0)) < lum(A.sunTransmittance(CLEAR, el, 0)));
    });
});

describe('multiple scattering', () => {
    test('energy: the share of scattered light that scatters again is below the scatterers\' albedo, so the series converges', () => {
        for (const air of [A.makeAir(0, 1.3), CLEAR, A.makeAir(0.4, 0.3)]) for (const h of [0, 0.5, 2, 8, 30, 80]) for (const mu of [1, 0.4, 0, -0.3]) {
            const o = A.multiScatter(air, h, mu, [0, 0, 0]);
            for (let k = 0; k < 3; k++) {
                assert.ok(o.f[k] > 0 && o.f[k] < 0.85, `f ${o.f[k]} at ${h} km`);
                assert.ok(o[k] >= 0 && Number.isFinite(o[k]) && o[k] < 0.25, `psi ${o[k]}`);
            }
        }
    });

    test('brighter with the sun up than down, gone in the planet\'s shadow; it adds to the sky, a third or so in clear air', () => {
        const up = A.multiScatter(CLEAR, 1, 1, [0, 0, 0]).slice(), low = A.multiScatter(CLEAR, 1, 0.1, [0, 0, 0]).slice(), night = A.multiScatter(CLEAR, 1, -0.5, [0, 0, 0]).slice();
        assert.ok(lum(up) > lum(low) && lum(low) > 100 * lum(night));
        const z1 = A.skyRadiance(CLEAR, 0, 1, 0, 0.8, [0, 0, 0], 32, true).slice(), z0 = A.skyRadiance(CLEAR, 0, 1, 0, 0.8, [0, 0, 0], 32, false).slice();
        const share = 1 - lum(z0) / lum(z1);
        assert.ok(share > 0.15 && share < 0.5, 'share of the zenith from multiple scattering: ' + share.toFixed(2));
    });

    test('the coarse table this file marches with agrees with the fine one within a tenth', () => {
        const a = A.skyLight(CLEAR, 0.3, 0.7, {}).E.slice();
        const fine = [0, 0, 0], c = [0, 0, 0];
        // (the same irradiance from single scattering plus the directly computed multiple scattering)
        const QMU = [0.04691, 0.230765, 0.5, 0.769235, 0.95309], QW = [0.118463, 0.239314, 0.284444, 0.239314, 0.118463];
        for (let i = 0; i < 5; i++) for (let k = 0; k < 6; k++) {
            A.skyRadiance(CLEAR, 0.3, QMU[i], Math.PI * (k + 0.5) / 6, 0.7, c, 32, true);
            for (let j = 0; j < 3; j++) fine[j] += c[j] * QW[i] * QMU[i] * 2 * Math.PI / 6;
        }
        assert.ok(Math.abs(lum(a) / lum(fine) - 1) < 0.1, `${lum(a)} vs ${lum(fine)}`);
    });
});

describe('energy at the ground', () => {
    test('what comes down (the beam and the sky) is never more than what came in, and most of it in clear air at noon', () => {
        for (const air of [A.makeAir(0, 1.3), CLEAR, A.makeAir(0.3, 0.5)]) for (const el of [90, 55, 20, 6]) {
            const mu = Math.sin(el * D), S = A.skyLight(air, 0, mu, {}), T = A.sunTransmittance(air, el, 0);
            for (let k = 0; k < 3; k++) {
                const share = (T[k] * mu + S.E[k]) / mu;
                assert.ok(share > 0.25 && share < 1.0, `el ${el}: ${share.toFixed(3)}`);
            }
        }
        const mu = Math.sin(55 * D), S = A.skyLight(CLEAR, 0, mu, {}), T = A.sunTransmittance(CLEAR, 55, 0);
        assert.ok((T[1] * mu + S.E[1]) / mu > 0.85, 'clear noon: nine tenths of the green arrives');
        // the sky's share of it: 15-25 % of the light on level ground on a clear day
        const sky = lum(S.E) / (lum(T) * mu + lum(S.E));
        assert.ok(sky > 0.12 && sky < 0.28, 'sky share ' + sky.toFixed(3));
    });
});

describe('the sky', () => {
    const sky = (air, el, viewEl, az, h = 0.3) => A.skyRadiance(air, h, Math.sin(viewEl * D), az * D, Math.sin(el * D), [0, 0, 0]).slice();

    test('noon: a deep blue zenith over a brighter, paler horizon', () => {
        const z = sky(CLEAR, 55, 90, 0), hz = sky(CLEAR, 55, 2, 120);
        assert.ok(z[2] > 2.5 * z[0] && z[2] > 1.7 * z[1], 'zenith blue ' + z);
        assert.ok(lum(hz) > 2 * lum(z), 'horizon brighter');
        assert.ok(hz[2] / hz[0] < 0.6 * z[2] / z[0], 'and whiter');
        // the zenith's luminance against a white card in the sun: about a tenth (3-4 stops under)
        const card = (lum(A.sunTransmittance(CLEAR, 55, 0.3)) * Math.sin(55 * D) + lum(A.skyLight(CLEAR, 0.3, Math.sin(55 * D), {}).E)) / Math.PI;
        assert.ok(lum(z) / card > 0.05 && lum(z) / card < 0.2, 'zenith / white card ' + (lum(z) / card).toFixed(3));
    });

    test('the glow round the sun grows with the haze; haze whitens the zenith', () => {
        const clean = A.makeAir(0.01, 1.3), hazy = A.makeAir(0.2, 1.0);
        const g = (air) => lum(sky(air, 40, 48, 0)), far = (air) => lum(sky(air, 40, 48, 120));
        assert.ok(g(clean) < g(CLEAR) && g(CLEAR) < g(hazy));
        assert.ok(g(hazy) / far(hazy) > 2 * g(clean) / far(clean), 'a forward glow, not just a brighter sky');
        const zc = sky(clean, 55, 90, 0), zh = sky(hazy, 55, 90, 0);
        assert.ok(zh[2] / zh[0] < zc[2] / zc[0]);
    });

    test('a low sun: warm round it fading to blue overhead and away from it; a red horizon under the sun', () => {
        const toward = sky(CLEAR, 3, 2, 0), up = sky(CLEAR, 3, 90, 0), away = sky(CLEAR, 3, 30, 180), mid = sky(CLEAR, 3, 20, 0);
        assert.ok(toward[0] > 3 * toward[2], 'red-orange under the sun ' + toward);
        assert.ok(up[2] > 1.8 * up[0] && away[2] > 1.5 * away[0], 'blue overhead and opposite');
        assert.ok(lum(toward) > 20 * lum(up), 'and far brighter');
        // in between, 20° over the sun: paler (red over blue falls from the horizon up)
        assert.ok(mid[0] / mid[2] < toward[0] / toward[2] && mid[0] / mid[2] > up[0] / up[2]);
    });

    test('twilight: the zenith stays blue with the sun down (ozone), the west glows, the east is in the Earth\'s shadow', () => {
        for (const el of [-2, -4, -6]) {
            const z = sky(CLEAR, el, 90, 0), west = sky(CLEAR, el, 6, 0), east = sky(CLEAR, el, 6, 180);
            assert.ok(z[2] > 1.4 * z[0] && z[2] > 1.4 * z[1], `zenith blue at ${el}°: ${z}`);
            assert.ok(lum(west) > (el < -3 ? 10 : 4) * lum(east), `the glow where the sun went, at ${el}°: ${lum(west)} / ${lum(east)}`);
            assert.ok(west[0] > west[2], 'and it is warm');
        }
        // opposite the sun: with it up, the low sky is as bright as the sky above it; once it is down the low sky is
        // in the planet's shadow, a dark band under the still-lit sky above (which rises as the sun sinks)
        assert.ok(lum(sky(CLEAR, 3, 3, 180)) > 0.8 * lum(sky(CLEAR, 3, 20, 180)));
        assert.ok(lum(sky(CLEAR, -2, 3, 180)) < 0.5 * lum(sky(CLEAR, -2, 20, 180)));
        assert.ok(lum(sky(CLEAR, -4, 10, 180)) < 0.5 * lum(sky(CLEAR, -4, 30, 180)), 'higher at -4°');
        // and the whole sky falls a hundredfold and more by the end of civil twilight
        const e3 = lum(A.skyLight(CLEAR, 0.3, Math.sin(3 * D), {}).E), e6 = lum(A.skyLight(CLEAR, 0.3, Math.sin(-6 * D), {}).E);
        assert.ok(e6 < 0.01 * e3 && e6 > 1e-5 * e3, `${e6 / e3}`);
    });

    test('from height: the zenith darker, the horizon still bright', () => {
        const z0 = lum(sky(CLEAR, 55, 90, 0, 0)), z3 = lum(sky(CLEAR, 55, 90, 0, 3)), z10 = lum(sky(CLEAR, 55, 90, 0, 10));
        assert.ok(z3 < z0 && z10 < z3 && z10 > 0.1 * z0, `${z0} ${z3} ${z10}`);
    });
});

describe('the sky-view table', () => {
    test('the mapping: the horizon in the middle row, directions there and back', () => {
        for (const h of [0.002, 0.3, 3, 12]) {
            const beta = A.horizonBeta(h), thH = Math.PI - beta;
            assert.ok(thH >= Math.PI / 2 && thH < Math.PI / 2 + 0.07, 'the horizon dips with height');
            const uv = A.skyLutUv(Math.sin(thH), Math.cos(thH), 0, h);
            assert.ok(Math.abs(uv[1] - 0.5) < 1e-6);
            for (const el of [89, 40, 5, 0.3, -0.5, -4, -30, -89]) for (const az of [-170, -60, 10, 100]) {
                const d = [Math.cos(el * D) * Math.cos(az * D), Math.sin(el * D), Math.cos(el * D) * Math.sin(az * D)];
                const u = A.skyLutUv(d[0], d[1], d[2], h), back = A.skyLutDir(u[0], u[1], h);
                assert.ok(u[0] >= 0 && u[0] <= 1 && u[1] >= 0 && u[1] <= 1);
                assert.ok(Math.abs(back[0] - (90 - el) * D) < 1e-6 && Math.abs(back[1] - az * D) < 1e-6, `${el} ${az}`);
            }
        }
        // rows crowd toward the horizon: half the rows above it cover the lowest quarter of the sky
        assert.ok(Math.abs(A.skyLutDir(0, 0.25, 0.3)[0] - 0.75 * (Math.PI - A.horizonBeta(0.3))) < 1e-9);
    });

    test('no seam at the horizon: the sky just above it and the haze colour just below it are the same', () => {
        for (const h of [0.03, 0.3, 3, 10]) for (const el of [55, 3]) {
            const thH = Math.PI - A.horizonBeta(h);
            for (const az of [0, 1.5, 3.1]) {
                const a = A.skyTable(CLEAR, h, Math.cos(thH - 0.0005), az, Math.sin(el * D), [0, 0, 0]).slice(), b = A.skyTable(CLEAR, h, Math.cos(thH + 0.0005), az, Math.sin(el * D), [0, 0, 0]).slice();
                for (let k = 0; k < 3; k++) assert.ok(Math.abs(b[k] / a[k] - 1) < 0.03, `h ${h} az ${az}: ${a} | ${b}`);
            }
        }
    });

    test('below the horizon: the colour the air would have were it thick enough (its in-scatter over what it hides)', () => {
        const o = A.skyRadiance(CLEAR, 3, -0.3, 1, 0.8, [0, 0, 0]);
        const raw = o.slice(), T = o.T.slice();
        assert.ok(o.ground && T[1] > 0.3 && T[1] < 0.95, 'the ground shows through from 3 km: T ' + T);
        const t = A.skyTable(CLEAR, 3, -0.3, 1, 0.8, [0, 0, 0]);
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(t[k] - raw[k] / (1 - T[k])) < 1e-9);
        // about the horizon's own brightness: haze looked down on is as bright as haze looked along
        const hz = A.skyTable(CLEAR, 3, Math.cos(Math.PI - A.horizonBeta(3) + 0.001), 1, 0.8, [0, 0, 0]).slice();
        assert.ok(lum(t) / lum(hz) > 0.5 && lum(t) / lum(hz) < 1.5);
    });

    test('colour rendering: luminance kept, colour pushed out from grey, never negative', () => {
        const c = A.render3([0.02, 0.04, 0.09], [0, 0, 0]);
        assert.ok(Math.abs(lum(c) - lum([0.02, 0.04, 0.09])) < 1e-12 && c[2] / c[0] > 0.09 / 0.02);
        assert.deepEqual(A.render3([0.5, 0.5, 0.5], [0, 0, 0]), [0.5, 0.5, 0.5]);
        assert.ok(A.render3([1, 0.2, 0.001], [0, 0, 0]).every(v => v >= 0));
    });
});

describe('the palette from the air (weather.js skyPalette)', () => {
    const P = WX.newPalette(), S = WX.newSky();
    const at = (hour, kind) => WX.skyPalette(hour, WX.kindParams(kind), P, S);
    const KEYS = ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'clouds', 'cloudShadow', 'fogWhite', 'water'];

    test('every time of day × every weather: every colour finite and not negative, the lights in range', () => {
        for (const kind of WX.KIND_NAMES) for (let h = 0; h < 24; h += 0.5) {
            at(h, kind);
            for (const k of KEYS) for (const ch of ['r', 'g', 'b']) assert.ok(Number.isFinite(P[k][ch]) && P[k][ch] >= 0, `${kind} ${h} ${k}.${ch} = ${P[k][ch]}`);
            const sun = clum(P.sun) * P.sunI, hemi = clum(P.hemiSky) * P.hemiI;
            assert.ok(sun >= 0 && sun < 3.1, `${kind} ${h} sun ${sun}`);
            assert.ok(hemi > 0.002 && hemi < 1.2, `${kind} ${h} hemi ${hemi}`);
            assert.ok(P.envI === 1 && P.fogDensity > 5e-5 && P.fogDensity < 3e-4);
            assert.ok(clum(P.zenith) > 0.0005 && clum(P.zenith) < 0.6 && clum(P.horizon) > 0.0005 && clum(P.horizon) < 1.5, `${kind} ${h} sky ${clum(P.zenith)} ${clum(P.horizon)}`);
            // the clouds: never blown out, never black
            const lit = clum(P.clouds), sh = clum(P.cloudShadow);
            assert.ok(lit < 1.25 && lit + sh > 0.01 && sh > 0.001 && sh < 0.6, `${kind} ${h} clouds ${lit} ${sh}`);
            // the air handed to the tables
            assert.ok(S.air.mie > 0.05 && S.air.mie < 0.4 && S.veil.every(Number.isFinite) && S.veil[3] >= 0 && S.veil[3] <= 0.9);
            for (const l of S.lights) assert.ok(l.E.every(v => Number.isFinite(v) && v >= 0));
        }
    });

    test('midday, clear: the light the old palette had; a blue sky; white clouds with blue-grey shadows', () => {
        at(WX.KEY_HOURS.day, 'clear');
        assert.ok(Math.abs(clum(P.sun) * P.sunI - WX.SUN_DAY) < 0.03);
        assert.ok(P.zenith.b > 2.5 * P.zenith.r && clum(P.horizon) > 1.5 * clum(P.zenith));
        const lit = clum(P.clouds), sh = clum(P.cloudShadow);
        assert.ok(lit > 0.95 && lit < 1.2 && Math.abs(sh - 0.33) < 0.02 && P.cloudShadow.b > P.cloudShadow.r);
        // the sky's own light with its fill: about a sixth of the sun's on level ground, as measured on a clear day
        const ratio = clum(P.hemiSky) * P.hemiI * (1 + 1 / WX.FILL) / (clum(P.sun) * P.sunI * Math.sin(55 * D));
        assert.ok(ratio > 0.3 && ratio < 0.55, 'ambient / sun ' + ratio.toFixed(2));
        assert.ok(clum(P.fogWhite) > 0.5 && clum(P.fogWhite) < 1, 'fog under that light: white');
    });

    test('through the day and the night the light never jumps', () => {
        const keys = ['zenith', 'horizon', 'hemiSky', 'clouds', 'cloudShadow', 'fogWhite'];
        for (const kind of ['clear', 'storm']) {
            let prev = null;
            for (let h = 0; h <= 24.001; h += 0.02) {
                at(h, kind);
                const cur = keys.map(k => clum(P[k]) * (k === 'hemiSky' ? P.hemiI : 1));
                cur.push(clum(P.sun) * P.sunI);
                if (prev) for (let i = 0; i < cur.length; i++) {
                    const d = Math.abs(cur[i] - prev[i]);
                    assert.ok(d < 0.03 + 0.12 * Math.max(cur[i], prev[i]), `${kind} at ${h.toFixed(2)} h: ${keys[i] || 'sun'} ${prev[i].toFixed(4)} -> ${cur[i].toFixed(4)}`);
                }
                prev = cur;
            }
        }
    });

    test('weather changes the air: more haze, a greyer and dimmer light under an overcast, storms dark', () => {
        const day = WX.KEY_HOURS.day;
        at(day, 'clear');
        const clear = { sun: clum(P.sun) * P.sunI, zen: P.zenith.clone(), mie: S.air.mie, cover: S.cover, lit: clum(P.clouds), fog: P.fogDensity, sat: P.hemiSky.b / P.hemiSky.r };
        at(day, 'cloudy');
        assert.ok(S.air.mie > clear.mie && S.cover < 0.15 && P.zenith.b > 1.8 * P.zenith.r, 'cloudy: hazier, still a blue sky');
        at(day, 'storm');
        assert.ok(clum(P.sun) * P.sunI < 0.35 * clear.sun, 'storm: the sun all but out');
        assert.ok(S.cover > 0.8 && P.zenith.b < 1.3 * P.zenith.r, 'a grey sky');
        assert.ok(P.hemiSky.b / P.hemiSky.r < 0.5 * clear.sat, 'a grey light');
        assert.ok(clum(P.clouds) < 0.7 * clear.lit && clum(P.clouds) > 0.25, 'dark clouds, not black');
        assert.ok(S.air.mie > 1.9 * clear.mie && S.air.angstrom < 0.5, 'thick, grey air');
        at(day, 'grey');
        assert.ok(S.cover > 0.5 && S.coverHigh < 0.1, 'grey: overcast from under its deck, blue above it');
        // the light on level ground (the beam and the sky): a storm takes most of it at midday; at dusk and by the moon
        // the exposure opens for the sky's light, so it is about as bright as a clear dusk or night (as it was), grey
        // (the light's own height: the sun's, or the moon's once it is the light; under the storm's deck most of the
        // ground is in cloud shadow: 0.3 of the beam)
        const ground = (hour, kind) => {
            at(hour, kind);
            const y = S.el > -3 ? Math.max(Math.sin(S.el * D), 0) : WX.MOON_DIR.y;
            return clum(P.sun) * P.sunI * y * (kind === 'storm' ? 0.3 : 1) + clum(P.hemiSky) * P.hemiI * (1 + 1 / WX.FILL);
        };
        const dayRatio = ground(day, 'storm') / ground(day, 'clear');
        assert.ok(dayRatio > 0.15 && dayRatio < 0.4, 'midday storm / clear ' + dayRatio.toFixed(2));
        for (const t of ['dusk', 'night']) {
            const sat = (c) => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / Math.max(c.r, c.g, c.b);
            const g0 = ground(WX.KEY_HOURS[t], 'clear'), s0 = sat(P.hemiSky), g1 = ground(WX.KEY_HOURS[t], 'storm');
            assert.ok(g1 / g0 > 0.6 && g1 / g0 < 1.4, `${t} storm / clear ${(g1 / g0).toFixed(2)}`);
            assert.ok(sat(P.hemiSky) < s0, `${t}: greyer than the clear sky's light (${sat(P.hemiSky).toFixed(2)} against ${s0.toFixed(2)})`);
        }
    });

    test('visibility is what it was: the haze the fog shader and the game\'s eyes see through, by weather', () => {
        // (the old palette's rule, unchanged: clear 32 km at midday; × 1 + 1.8 sev, or 1 + sev where it rains)
        const want = { clear: 31.9, cloudy: 19.6, grey: 22.8, rain: 18.8, storm: 15.95, fog: 25.1, overcast: 19.9 };
        for (const kind of WX.KIND_NAMES) {
            at(WX.KEY_HOURS.day, kind);
            const km = Math.sqrt(WX.KOSCHMIEDER) / P.fogDensity / 1000;
            assert.ok(Math.abs(km - want[kind]) < 0.15, `${kind}: ${km.toFixed(2)} km`);
        }
        at(WX.KEY_HOURS.night, 'clear');
        assert.ok(Math.abs(Math.sqrt(WX.KOSCHMIEDER) / P.fogDensity / 1000 - 24.7) < 0.1);
    });

    test('exposure: opens up as the sun sinks, continuously; closes with the twilight', () => {
        let prev = WX.sunExposure(90);
        assert.ok(Math.abs(prev * lum(A.sunTransmittance(CLEAR, 90, WX.REF_H)) - WX.SUN_DAY) < 1e-6);
        for (let el = 89.75; el >= -17.5; el -= 0.25) {
            const k = WX.sunExposure(el);
            // (never closing by more than a hair as the sun sinks; opening smoothly while it is up, and by no more
            // than the sky's own collapse allows in twilight: about threefold a degree at its steepest)
            assert.ok(k >= prev * 0.99 && k < prev * (el > 1.9 ? 1.08 : 1.8), `at ${el}°: ${prev} -> ${k}`);
            prev = k;
        }
        assert.equal(WX.sunExposure(4), WX.TWILIGHT_K);
        assert.equal(WX.sunExposure(-19), 0);
        // the night: the moon's light as the old night had it, the sun's part gone
        at(WX.KEY_HOURS.night, 'clear');
        assert.equal(S.K, 0);
        assert.ok(Math.abs(lum(S.moonRGB) - lum(WX.MOON_GROUND)) < 0.01 && S.lights[1].E[2] > S.lights[1].E[0]);
        // the sky the dome draws is the palette's zenith (the same model, the same exposure)
        const z = A.skyRadiance(S.air, WX.REF_H, 1, 0, WX.MOON_DIR.y, [0, 0, 0]).map((v, i) => v * S.lights[1].E[i]);
        A.render3(z);
        assert.ok(Math.abs(lum(z) + lum(S.floor) - clum(P.zenith)) < 0.1 * clum(P.zenith), `${lum(z)} vs ${clum(P.zenith)}`);
    });
});
