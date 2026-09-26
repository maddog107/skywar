// ═══════════════════════════════════════════════════════════════
// The war plug-in systems (docs/WAR.md). Each is built once with the game, becomes game[name], and may have
//   start(mode, opts) · update(dt) · clear() · onAction(a) → true when it used the action
//   drawHud(ctx, hud) · drawMap(ctx, map) · mapActions(sel) · commands() · updateCamera(cam, dt) → true when it
//   drives the camera
// The war core itself (war.js: registry, intel, radio, marks) is always there as game.war.
// One line per system; order matters only for who sees an action first.
// ═══════════════════════════════════════════════════════════════
import { TacticalMap } from './tacmap.js';
import { CommandMenu } from './command.js';
import { StrikeManager } from './strikes.js';

export const SYSTEMS = [
    ['tacmap', TacticalMap],
    ['command', CommandMenu],
    ['strikes', StrikeManager],
];
