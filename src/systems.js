// ═══════════════════════════════════════════════════════════════
// The war plug-in systems (docs/WAR.md). Each is built once with the game, becomes game[name], and may have
//   start(mode, opts) · update(dt) · clear() · onAction(a) → true when it used the action
//   drawHud(ctx, hud) · drawMap(ctx, map) · mapActions(sel) · commands() · updateCamera(cam, dt) → true when it
//   drives the camera · respawnPoint() → { where, base } for the player's next jet
// The war core itself (war.js: registry, intel, radio, marks) is always there as game.war.
// One line per system; order matters only for who sees an action first.
// ═══════════════════════════════════════════════════════════════
import { TacticalMap } from './tacmap.js';
import { CommandMenu } from './command.js';
import { StrikeManager } from './strikes.js';
import { FrontLine } from './front.js';
import { Director } from './director.js';
import { TaskManager } from './tasks.js';
import { Wingmen } from './wingmen.js';

export const SYSTEMS = [
    ['tacmap', TacticalMap],
    ['command', CommandMenu],
    ['strikes', StrikeManager],
    ['front', FrontLine],        // the front line and the ground war
    ['director', Director],      // enemy and friendly activity, the Living War mode
    ['tasks', TaskManager],      // dynamic tasks
    ['wingmen', Wingmen],        // wingmen that take orders
];
