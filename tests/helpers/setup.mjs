// Import this FIRST (statically) in every test file, then load src modules with dynamic import():
// static imports are all resolved before any module body runs, so the hooks must be registered
// before the src graph is resolved.
import './three-hooks.mjs';
import { installDomStub } from './dom-stub.mjs';
installDomStub();
export const src = (name) => import(new URL(`../../src/${name}`, import.meta.url).href);
