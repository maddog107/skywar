// Lets `node --test tests/` work: Node doesn't expand a directory argument into test files, it
// runs the directory's index.js. This imports every tests/*.test.mjs into one test process.
// (`node --test` with no arguments, or `npm test`, runs each file in its own process instead.)
import './helpers/setup.mjs';
import { readdirSync } from 'node:fs';

const here = new URL('./', import.meta.url);
for (const f of readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort()) await import(new URL(f, here).href);
