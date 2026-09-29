// ═══════════════════════════════════════════════════════════════
// The interiors framework (interiors.js) with every room, boat and site of the war plugged in — the plug-in
// systems.js builds as game.interiors (docs/WAR.md "Interiors and boats"):
//  • harbor (warrooms.js): the small-craft pier, the RHIB and the CB90, stepping on and off boats
//  • sub (warrooms.js): USS Colorado surfaced off the pier, her control room
//  • carrier (commandrooms.js): the island's CIC and Pri-Fly, the accommodation ladder
//  • joc (commandrooms.js): the Joint Operations Center at the home base
//  • tel (commandrooms.js): the captured Scud TEL's launch cabin and cab
//  • travel (warrooms.js): COMMAND › TRAVEL, to any of them on foot
// ═══════════════════════════════════════════════════════════════
import { Interiors } from './interiors.js';
import { HarborOps, SubOps, TravelOps } from './warrooms.js';
import { CarrierOps, JocOps, TelOps } from './commandrooms.js';

export class WarInteriors extends Interiors {
    constructor(game) {
        super(game);
        const harbor = this.use(new HarborOps(this));
        const sub = this.use(new SubOps(this, harbor));
        const carrier = this.use(new CarrierOps(this, harbor));
        const joc = this.use(new JocOps(this));
        const tel = this.use(new TelOps(this));
        this.ops = { harbor, sub, carrier, joc, tel };
        this.use(new TravelOps(this, this.ops));
    }
}
