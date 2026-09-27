// ═══════════════════════════════════════════════════════════════
// The war plug-in systems (docs/WAR.md). Each is built once with the game, becomes game[name], and may have
//   start(mode, opts) · update(dt) · clear() · onAction(a) → true when it used the action
//   drawHud(ctx, hud) · drawMap(ctx, map) · mapActions(sel) · mapInfo(sel) · mapPick(x, y, map) · commands()
//   updateCamera(cam, dt) → true when it drives the camera · flyJet(dt, jet, stick, mouse) (the last word on the
//   player's controls) · respawnPoint() → { where, base } for the player's next jet
// The war core itself (war.js: registry, intel, radio, marks) is always there as game.war.
// One line per system; order matters for who sees an action first, and HUD layers draw in this order.
// ═══════════════════════════════════════════════════════════════
import { TacticalMap } from './tacmap.js';
import { CommandMenu } from './command.js';
import { StrikeManager } from './strikes.js';
import { Sensors } from './sensors.js';
import { MapKit } from './mapkit.js';
import { FrontLine } from './front.js';
import { Director } from './director.js';
import { TaskManager } from './tasks.js';
import { Wingmen } from './wingmen.js';
import { Underground } from './underground.js';

export const SYSTEMS = [
    ['tacmap', TacticalMap],
    ['sensors', Sensors],   // targeting pod, helmet sight (before the menu: its video is under it; before strikes: comma)
    ['mapkit', MapKit],     // map tools: legend, layers, ruler, coordinates, steerpoint, air tracks, imagery
    ['command', CommandMenu],
    ['strikes', StrikeManager],
    ['front', FrontLine],        // the front line and the ground war
    ['director', Director],      // enemy and friendly activity, the Living War mode
    ['tasks', TaskManager],      // dynamic tasks
    ['wingmen', Wingmen],        // wingmen that take orders
    ['underground', Underground], // hidden mountain complexes: portals, blast doors, tunnels, intel, scrambles
];
