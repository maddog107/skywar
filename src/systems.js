// ═══════════════════════════════════════════════════════════════
// The war plug-in systems (docs/WAR.md). Each is built once with the game, becomes game[name], and may have
//   start(mode, opts) · update(dt) · clear() · onAction(a) → true when it used the action
//   drawHud(ctx, hud) · drawMap(ctx, map) · mapActions(sel) · mapInfo(sel) · mapPick(x, y, map) · commands()
//   updateCamera(cam, dt) → true when it drives the camera · flyJet(dt, jet, stick, mouse) (the last word on the
//   player's controls)
// The war core itself (war.js: registry, intel, radio, marks) is always there as game.war.
// One line per system; order matters for who sees an action first, and HUD layers draw in this order.
// ═══════════════════════════════════════════════════════════════
import { TacticalMap } from './tacmap.js';
import { CommandMenu } from './command.js';
import { StrikeManager } from './strikes.js';
import { Sensors } from './sensors.js';
import { MapKit } from './mapkit.js';

export const SYSTEMS = [
    ['tacmap', TacticalMap],
    ['sensors', Sensors],   // targeting pod, helmet sight (before the menu: its video is under it; before strikes: comma)
    ['mapkit', MapKit],     // map tools: legend, layers, ruler, coordinates, steerpoint, air tracks, imagery
    ['command', CommandMenu],
    ['strikes', StrikeManager],
];
