// Prints the sun-shadow cascade layout of every quality level (shadows.js CSM_QUALITY): half-size, texel, schedule.
//   node tools/perf/cascades.mjs
import '../../tests/helpers/setup.mjs';
const { cascadeLayout } = await import('../../src/shadows.js');
for (const q of ['low', 'medium', 'high', 'ultra']) {
    console.log(q.padEnd(7), cascadeLayout(q).map(c => `${c.R.toFixed(0)} m half-size, ${(c.texel * 100).toFixed(1)} cm texel, every ${c.every}${c.every > 1 ? ' (phase ' + c.phase + ')' : ''}, filter ${['3x3', '5x5', 'PCSS'][c.filter]}`).join('\n        '));
}
