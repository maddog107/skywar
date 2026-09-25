// Child process for the smoke test: import one src module and report the outcome as JSON.
//   node tests/helpers/import-one.mjs <module.js> [--dom]
import './three-hooks.mjs';
import { installDomStub } from './dom-stub.mjs';
const [name, flag] = process.argv.slice(2);
if (flag === '--dom') installDomStub();
try {
    const m = await import(new URL(`../../src/${name}`, import.meta.url).href);
    process.stdout.write(JSON.stringify({ ok: true, exports: Object.keys(m) }));
} catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: `${e?.name}: ${e?.message}`, stack: String(e?.stack || '').split('\n').slice(0, 4).join('\n') }));
}
