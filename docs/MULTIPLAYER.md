# SKYWAR multiplayer

Friends open the page, pick **MULTIPLAYER**, type a callsign and a room code (or leave it empty for the public room),
choose a side, and fly in the same world: they see each other's jets, can dogfight each other with guns and missiles,
see kills in the feed and on a scoreboard, and get a new jet a few seconds after being shot down. Bombs and rockets fly
and go off on everyone's screen, and a town building one pilot knocks down is down for all of them. The host of a room
can call in AI bandits for everyone to fight together.

Single-player is untouched: nothing here opens a connection unless the MULTIPLAYER mode is launched.

## For the player

| | |
|---|---|
| Mode card | **MULTIPLAYER** in the menu. Callsign (letters, digits, space, `_`, `-`; 14 characters), room code (letters and digits, 8; empty = `PUBLIC`), side BLUE / RED. Every jet and paint scheme is unlocked. |
| Time, weather | Set by whoever opens a room; everyone who joins flies in that. |
| Start | AIR, RWY (default) or TAXI. Blue flies from SKYWAR AIR BASE, red from the ENEMY AIR BASE 18 km north; each pilot has his own spot (two abreast down the runway, a row on the apron, line abreast in the air). |
| Tab (hold) | Scoreboard: pilot, side, aircraft, kills, losses, ping; ★ marks the host. (T still cycles targets.) On a touch screen the **SCORE** button (shown in this mode only) puts it up and takes it down. |
| N | The host: AI bandits on / off for the room (the dogfight mode's waves; they fly for RED). |
| Esc / P | The menu comes up, but **the world does not stop**: the jet holds its wings level and its height until you come back. |
| Enter | Stopped on the ground somewhere that isn't one of your side's pads (or belly-landed): a new jet. |
| Shot down | A new jet after 4 s, with 6 s of spawn protection (it ends when you open fire; the others see `· SAFE` on your name tag). |
| Bombs, rockets | Everyone sees them leave your jet's pylons, fly and go off (fireball, mushroom cloud, crater, sound, shake). A town building that comes down on your screen comes down on everyone's, and stays down while the room lives; someone joining later finds the ruins. The airbases' hangars and towers, and the bridges, can't be destroyed here. |
| Not there | Photo mode, ejecting and climbing out (nobody else would see the man), the carrier, wingmen, the Ready Room start. |

Name tags are the HUD's ordinary target labels: every other player is an ordinary aircraft to the HUD, the radar, the
tactical map, the lock and the missile seekers.

## Architecture

```
 browser A ──┐                       ┌── browser B
 owns: its jet (+ the AI bandits if it is the host)
             │   wss://…/ws          │
             └────►  relay.mjs  ◄────┘      rooms · ids · host · batching · validation
                   (no game logic)
```

### The relay (`relay.mjs`)
A WebSocket server written directly on `node:http` + `node:crypto` (RFC 6455: handshake, masked client frames, text
frames, fragments, 16-bit lengths, ping / pong, close), no npm packages. It never interprets game state.

- **Rooms** keyed by a short code, created by the first hello that names them and gone when empty. A room carries its
  world settings (time of day, weather: whoever opened it chose) and its switches (`ai`).
- **Ids**: every client gets a small number. Everything the relay passes on is stamped with the sender's id, so a client
  can only ever speak as itself.
- **Host**: the longest-connected client of the room; when it leaves, the next longest-connected one (told in `leave`).
- **State is batched**: the relay keeps each client's latest snapshot and sends the whole room one combined message,
  at most once every 50 ms (20 a second), with the snapshots that changed: at once when nothing has gone out to the
  room for 50 ms, otherwise when 50 ms have passed since the last message, so no snapshot waits longer than that.
  ("Latest" is normally one snapshot per client; when the relay or a client was held up for a moment and two or three
  came in between messages, the newest three go out in order rather than only the last: they are stamped, and a
  receiver draws a truer curve through all of them.) **Events** are relayed at once, in order, to the room or to one
  client (`to`).
- It attaches to `server.mjs` for development (`node server.mjs`: static files + relay at `/ws`, one port) and runs
  alone in production (below).

### Clients own their entities (`src/multiplayer.js`)
Each client simulates only what it owns with the game's normal flight model, and sends compact snapshots 20 times a
second: its own jet (entity number 0), and, on the host, the AI bandits (numbers 1…). An entity's id across the room is
(owner's client id, number); an entity's `life` goes up by one with every new airframe, so a snapshot still in the
post when a jet died can't bring it back.

Everything a client doesn't own is a **puppet**: a real `Aircraft` in `game.aircraft` with its team and callsign and
`ac.puppet` set, so the radar, HUD, targeting, missile seekers, tactical map and sounds treat it like any other
aircraft. It has no flight model and no pilot: `Aircraft.update` calls `puppet.place()` instead of `updateFlight()`.

### Interpolation (`src/netinterp.js`)
Snapshots are stamped with their sender's **frame clock** (`mp.frameNow()`: `game.time`, which advances by exactly
what the aircraft are moved by each frame, held on the wall clock by a slowly eased offset; time the simulation lost
in a frame longer than the game steps in one go is added at once). The wall clock itself, read wherever in its frame a
client happens to be, is off by milliseconds each time: a metre or more of a jet.

`ClockSync` maps a sender's clock onto ours from the quickest deliveries. A puppet is drawn **in the past**, between
two snapshots: position on a cubic Hermite curve through both positions and velocities (a turn stays an arc),
orientation by slerp.

How far in the past is per peer: the spacing of its snapshots plus how late they have been arriving lately (estimates
that go a fifth of the way up to a higher reading and creep down, so one hitch doesn't hold everyone back), never
under 0.1 s (`INTERP_DELAY`) and never over 0.25 s. It grows by at most 60 ms per second and shrinks at 20 ms per
second (while it changes, the puppet plays that much slow or fast: it must not lurch). So there is still a snapshot
either side of the moment drawn when a peer's snapshots come late, in bunches, or sparsely (a slow machine sends
fewer).

When the newest snapshot is nevertheless older than the moment drawn, the puppet coasts on its last velocity and the
turn it was in for at most 0.5 s (`EXTRAP_MAX`), then holds still; after 3 s without a snapshot (`STALE_AFTER`) it is
**stale**: hidden, `alive = false` (can't be hit, locked or chased by a missile) until snapshots resume. When they
come back after coasting, the step between where it was drawn and where it really was is eased out over ~0.15 s.

A sender whose machine can't keep up (below ~20 frames a second the game steps less time than passes, so its jet
covers less ground than its speed says) is drawn at the pace it really moves: the curve's tangents and the coasting are
scaled to the ground covered between its snapshots, so its puppet doesn't run ahead and jump back.

Measured:

| | |
|---|---|
| No network (tests/multiplayer.test.mjs), a roll and a 6 g pull at 265 m/s | the puppet is within 1 cm and 1.2° of where its owner was 100 ms earlier |
| Two browser pages through the real relay on one machine (tools/net/e2e.mjs), two rolls and two pulls at ~275 m/s, three passes | against where the owner was at the moment being drawn: 0.14–0.47 m mean, 3.8–7.2 m worst on frames drawn between two snapshots (73–91 % of them); drawn 235–270 ms behind the owner's present (the drawing delay was 175–250 ms there: both pages and the relay shared a machine that other work was loading heavily) |
| The netcode's own cost for one client in a room of 8 (node, no rendering) | 76 µs a frame: 0.5 % of a 60 fps frame |

### Damage: the shooter decides, the owner applies
- **Guns.** The shooter's rounds hit-test the puppet as they do any aircraft. `Aircraft.damage()` on a puppet does not
  touch it: it becomes a **hit claim** (`hit`: target, airframe, amount, kind, which of the shooter's aircraft) sent to
  the target's owner; a stream of cannon hits is one claim per snapshot. The shooter gets his hit marker at once. The
  owner applies the claim through the normal `damage()` path with the shooter's puppet as the source, so hit direction,
  kill credit and the game's own damage rules work; its health comes back in its snapshots. A puppet's own cannon is
  drawn (tracers, muzzle flash, sound) with rounds that do nothing.
- **Missiles.** The shooter simulates its own missile against the puppet. A launch event (`ml`) plus the missile's
  position in the shooter's snapshots let everyone else draw a **ghost** (the store's own mesh, smoke trail, motor
  flame and light, launch sound); a ghost aimed at one of our aircraft sits in its `incoming` list, so the targeted
  player gets the usual missile warning and the host's AI evades. When the shooter's seeker loses its target the ghost
  stops warning ("MISSILE DEFEATED"). The warhead is a hit claim; `mx` ends the ghost with an explosion where the
  shooter's missile ended.
  `mx` says how it ended (on its target, at the end of its flight — into the ground or the sea —, into a building, or
  quietly), and the ghost ends the way the real one did: the same burst, water spout and crater as weapons.js draws,
  and its blast on the buildings round it (below). The puppet's own rail empties as the ghost leaves it (pylons.js
  takes a store off as the aircraft's count drops). A ghost's last snapshot row, overtaken on the way by the event
  that ended it, doesn't bring it back.
- **Flares / chaff.** A drop is an event (`fl`); every client's puppet of that aircraft drops them for real
  (`weapons.dropFlares`), so the shooter's own seeker can be decoyed by them. A human's puppet decoys like a player.
- **Same side**: rounds pass through, missiles don't lock, and an owner refuses a claim from its own side.
- **Deaths are the owner's.** The normal damage path kills the aircraft on its owner's client, which sends `die`
  (naming the killer) and, when it blows up, `boom`. Puppets die with the game's own effects: they fall burning along
  their owner's snapshots and explode (airframe break-up, or a crash with its debris field and crater) where the owner's
  did. Wings shot off are mirrored (`part`).
- **Respawn**: 4 s after being shot down, on the pilot's own spot, with 6 s of spawn protection (claims refused by the
  owner; shooters see `· SAFE` and don't send any).

### Bombs and rockets (`src/netordnance.js`)
Every kind weapons.js drops or fires unguided — the plain bomb, the cluster bomb, the bunker buster, the MOAB and the
MK-84X, a guided bomb without a target, a rocket pod's salvo — flies by gravity, drag and its motor alone, so one
message is enough: `ord` carries, for everything one aircraft released in one frame (a pod's six rockets in one
message), where it is (it left the station it hung on: pylons.js), its velocity, its age and its roll on the rail. Every
other client draws a **ghost**: the store's own mesh (a rocket with its flame, smoke trail and light while the motor
burns), flown with weapons.js's own equations (updateBombs, updateMissiles) in steps of 1/60 s, in the owner's past
like his jet (the same clock and drawing delay), so it leaves the puppet's pylon as the puppet passes the release point,
and that store goes from the puppet. Measured without network (tests/multiplayer.test.mjs): a bomb ghost stays within
0.25 m of the owner's bomb over a 9 s fall, a rocket within 0.5 m. Through the real relay (tools/net/e2e.mjs): the
other page played the burst of a Mk 82 dropped on a house 0.0 m from where the owner's went off, the same 14 houses
came down on both, and a pilot who joined two minutes later had the same 14 as ruins; a six-rocket salvo was six
rockets in flight on the other page.

A **guided bomb** with a target steers on its owner's laser spot or GPS point: it rides in the owner's snapshots as a
missile row marked 2 (by turns when there are more than fit) and is drawn between them.

When it ends, the owner says where and how (`blast`, several in one message): on the ground, in the sea, on a building
(no crater), a cluster bomb opening, a bunker buster going in (its delay fuse runs on every client), or quietly. The ghost
gets there in our picture of the owner's world and ends there with the game's own burst: weapons.js `bombBurst` with
the ghost marked `show` — the same fireball, MK-84X / MOAB mushroom cloud, bunker buster's fountain of earth, crater,
water column, sound and camera shake — which stops before the damage; a cluster bomb's bomblets scatter and burst the
same way (`show`: no damage). Rockets end as weapons.js draws them (fireball by height, crater on the ground, spout in
the sea). An end further than 3 km from where we have the ghost is played where the ghost is.

**Damage**: the owner's bomb does all the damage on the owner's client, as always: aircraft through hit claims (a
blast that reaches someone's puppet is a claim to its owner, applied once; a ghost's burst never hurts an aircraft),
buildings by the rule below.

### Town buildings (`src/networld.js`)
Every client builds the same 5,917 town building records in the same order (towns.js; tests/towns.test.mjs pins a
digest; tools/net/e2e.mjs fingerprints them on each page). A building is named on the wire by its place in that list,
with a byte of its position (`index × 256 + check`): a client whose list differed would ignore it rather than knock the
wrong one down.

- **Who decides**: as with aircraft, the shooter. Whoever's bomb, rocket, missile, cannon or crash brings a building down
  on his own screen tells the room (`bld`, with his clock); everyone else brings that one down too when their picture of
  his world gets to that moment (the ghost's burst first: the building falls as the bomb hits). The outcome of
  buildings.js `explode` (which buildings are hit, by how much) has no dice in it — distance to the walls, radius,
  amount — but each client's own count of the damage to a building differs (cannon hits are the shooter's own, a
  newcomer starts with whole walls), so its count only decides what its own weapons bring down; the `bld` list is what
  makes everyone agree. (The collapse — topple or pancake, the rubble thrown — is each client's own dice.)
- **Damage adds up**: a peer's blast (its bomb's, rocket's or missile's burst, by that weapon's own splash and damage
  from our store table) still damages the buildings round it here, but never brings one down: the last blow leaves it at
  1 hp, scorched and smoking. So two pilots' bombs on one tower add up on both screens, and the one whose bomb is the
  last blow on his own count brings it down for everyone.
- **A newcomer** (or a client back after a lost connection) asks the room's host (`sync`): the answer is a bitset of the
  buildings down (and those said to have fallen and not yet drawn): 185 32-bit words in four parts (at most ~2 KB of
  JSON in all, a few hundred bytes while little is down), with the list's length and
  digest; the newcomer takes it only from the host, only while it is waiting for it (15 s), only for its very towns.
  Those are ruins at once (buildings.js `ruin`: the burnt stub of wall and the heap, no collapse, dust or fire). If the
  host leaves before answering, the newcomer asks the next one. Partial damage isn't sent: the standing ones are whole
  for the newcomer.
- **When they come back**: they stay down while the room lives (as long as anyone who saw them fall is in it, host
  migration included: every client has the same list down). A sortie flown from the menu starts with whole towns and
  asks again. What falls on a client while its connection is down is told when it is back.
- **Scenery**: building destruction scores nothing in multiplayer and puts nothing on the feed (the kill lines must stay
  on it); the game's collateral penalty is single-player's.
- **Not destructible here**: the airbases' structures (hangars, towers, shelters: other systems run them) and the
  bridges (a downed span would need its own synchronising; they stay as they were).

### AI bandits (co-op)
The host presses N: the room's `ai` switch goes on (kept by the relay, so it survives the host). The host runs the
dogfight mode's wave spawner (`game.nextWave()`); the bandits are ordinary AI aircraft on the host, entities 1… that the
host describes to everyone (`ai`: type, side, name, health, skill) and reports in its snapshots. Everyone else has
puppets of them and shoots them with hit claims that the host applies. The AI shoots at puppets like at anyone:
its hits are the host's claims. Bandits fly for RED: for co-op, everyone picks BLUE.

**Host migration**: when the host leaves, the next host turns each of the old host's bandit puppets into a real
aircraft with an AI pilot where it is (health kept) and announces them as its own; the other clients drop the old
host's puppets and get the new host's a moment later (a missile in flight at one loses it). Switching the bandits off
clears them for everyone. Only the room's host may have AI aircraft: entities 1… from anyone else are ignored, and a
client that finds itself with bandits but no longer the host (it lost its connection and someone else took over) clears
its own.

### One world for everyone
Terrain, towns, roads, bridges and airbases are built from fixed seeds. `tools/net/e2e.mjs` fingerprints the world on
each page (terrain heights on a grid, every building record with its footprint and heading, bridges, towns, runways)
and requires them equal. What was found and done:

| | |
|---|---|
| Parked helicopters on the helipads | Their heading (and, on the enemy field, their type) came from `Math.random`: solid objects that differed between clients. **Fixed**: seeded (`airbase.js buildHelipad`). |
| The home aircraft carrier | Steams on a random course: not in multiplayer (no CVN start). |
| Airliners, airbase helicopters, the news helicopter | Fly on each client's own dice and can be flown into: removed in multiplayer (`quietWorld`), put back afterwards. |
| Town buildings | **Destructible, the same for everyone** (networld.js, above): down on everyone's screen when down on the shooter's; a newcomer gets the ruins from the host. |
| Airbase structures, bridges | **Indestructible** in multiplayer (as before): not synchronised. |
| Wingmen, AWACS / tanker, ground forces, garrisons, enemy waves, the ground war, target ships | Single-player only: not spawned. |
| Road traffic, pedestrians, base life, the tower's radio calls, lightning | Each client's own (ambience; nothing an aircraft collides with). The war layer's "INTEL: IDENTIFIED …" lines are muted: they would push the kill lines off the feed. |
| Bombs, unguided rockets, missiles | **Seen by everyone**: ghosts on the same path (netordnance.js), ending where and how the owner's did. |
| Craters | Dug on every client by the same rules from the owner's end (a bomb's, a rocket's, a missile's; a puppet's crash); never on a runway, inside an airbase fence or on a bridge (weapons.js craterSite). Right next to a building that falls in the same blast one client may dig it and another not (whether the building still stood): cosmetic. |
| Cluster bomblets, the collapse of a building | Where each bomblet lands and how a building comes down are each client's own dice (what the bomblets destroy is the owner's word). |

Not synchronised yet (the relay lets the event name through): ejected pilots (`eject`; there is no ejecting in
multiplayer).

### No pausing the world
- **Esc / P / lost pointer lock**: the pause menu comes up over the game; the simulation goes on. The jet flies itself
  wings-level at its height, weapons are off while the menu is up. (`game.pause()` hands over to `mp.menu()`.)
- **Photo mode** is refused.
- **A hidden tab** (it stops rendering, so the jet would hang in the air): on `visibilitychange` the client says `away`
  at once; everyone hides its puppet and can't hit or lock it, and it refuses hit claims. Back after more than 3 s with
  the jet in the air, it gets a new jet at its base (no loss counted): hiding the tab is leaving the fight, not a dodge.
  On the ground it carries on where it stood.
- **A client that stops without saying so** (a stalled machine, a dropped line): its puppet coasts 0.5 s, holds, and is
  stale after 3 s; a client that finds it was frozen more than 8 s also takes a new jet. The relay drops a connection
  that hasn't answered a ping for 70 s, and frees the place of one that sent nothing for 10 minutes.
- **Connection lost**: "CONNECTION LOST — RECONNECTING" and the client flies on alone, trying again after 1.5 s, then
  every 2, 4, … 15 s, into the same room (reopened with the same world if it emptied); kills and losses are kept.

## Messages

JSON text, at most 2 KB each.

Client → relay:

| | |
|---|---|
| `{t:'hello', v, name, room, team, ac, lv, time, weather}` | first message; `v` = protocol version. `time` / `weather` only matter to a room that doesn't exist yet. |
| `{t:'s', c, e, m}` | state: `c` our clock (ms), `e` entity rows, `m` missile rows (optional) |
| `{t:'e', e:[name, …], to}` | an event for the room, or for client `to`; at most 64 long, the name included |
| `{t:'ping', n}` | answered with `pong` (the scoreboard's ping) |
| `{t:'set', ai}` | the host's: AI bandits on / off |

Relay → client:

| | |
|---|---|
| `{t:'welcome', v, id, name, room, host, set:{time, weather, ai}, peers:[[id, name, team, ac, lv]…], max}` | you are in (`name` may have been cleaned or numbered) |
| `{t:'join', p:[id, name, team, ac, lv]}` · `{t:'leave', id, host}` | the roster; `host` = the host after the leave |
| `{t:'s', s:[[id, c, e, m]…]}` | the combined state, at most 20 a second (your own comes back too: skip your id; a client may appear more than once, oldest first) |
| `{t:'e', f, e}` | an event from client `f` |
| `{t:'set', set}` · `{t:'pong', n}` | |
| `{t:'err', code, msg}` then close | `version` (reload the page), `full`, `rooms`, `busy`, `address`, `idle`; `msg` is shown to the player |

Rows (`src/netproto.js`), all plain numbers:

- entity `[n, life, x, y, z, qx, qy, qz, qw, vx, vy, vz, throttle, flags, health, g]` — position to the centimetre,
  quaternion × 32767, velocity × 10, throttle %, health × 10, g × 10; ~100 bytes. Flags: gear, firing, on the ground,
  alive, afterburner, falling, speed brake, spawn-protected, flaps (2), hook, belly-landed.
- missile `[id, x, y, z, vx, vy, vz, tracking]` — `id` 1…65535, the sender's own (one numbering with its bombs and
  rockets). `tracking` 2: a guided bomb's row, not a missile's.

Events:

| event | payload | |
|---|---|---|
| `hit` | n, life, amount, kind, shooter's n | to the target's owner: a hit claim on its entity `n` |
| `die` | n, life, killer's id (0: nobody), kind | the sender's entity was killed |
| `boom` | n, life, ground, water, x, y, z | …and blew up there |
| `gone` | n, life | …or was taken out of the game without a bang |
| `part` | n, life, region | a wing came off |
| `fl` | n | flares and chaff dropped |
| `ml` | id, n, store, kind, target's id, x, y, z, vx, vy, vz, clock | a missile launched |
| `mx` | id, x, y, z, how | that missile ended there, that way (`how`, below) |
| `ord` | n, store, kind, guided, clock, then per item: id, x, y, z, vx, vy, vz, age (ms), roll (rad × 100) | what aircraft `n` released in one frame: bombs (`kind` 0 bomb, 1 guided bomb, 2 bunker buster, 3 MOAB) or rockets (4), up to 6 a message; `store` a stores.js id of that class ('' : the plain table) |
| `blast` | clock, then per item: id, x, y, z, how | those of its bombs and rockets ended there that way (up to 12): `how` 0 on its target / a ship, 1 on the ground (a missile or rocket: the end of its flight), 2 in the sea, 3 into a building, 4 a cluster bomb opened, 5 / 6 a bunker buster went into the ground / a building, 7 quietly |
| `bld` | clock, then entries `index × 256 + check` | town buildings that fell on its screen (up to 62 a message) |
| `sync` | 0 | to the host: the buildings down so far, please |
| `sync` | 1, epoch, part, parts, count, digest, 56 words | the host's answer: a bitset of the buildings down, in parts |
| `ai` | n, type, side, name, health, skill, ace | the host describes an AI aircraft it flies |
| `st` | kills, losses, ping | the sender's own score |
| `away` | 0 / 1 | its tab is hidden |

Bump `PROTOCOL` in **both** `relay.mjs` and `src/netproto.js` when a message changes shape: a client with another
number is refused with a message telling the player to reload. It is **2** since bombs, rockets and buildings (`ord`,
events up to 64 long, `mx` with `how`, missile rows marked 2): a page still on protocol 1 is told to reload.

## Security

The relay is on the public internet and the players are young.

- **No chat.** There is no free text anywhere except the callsign: letters, digits, space, `_`, `-`, 14 characters,
  upper-cased, the obvious rude words refused (also spelled with digits or spaced out), enforced by the relay. Every
  string from the network reaches the page through `textContent` or canvas text, never as HTML.
- **Origin allowlist**: an upgrade whose `Origin` isn't on the list gets `403` (default: localhost, 127.0.0.1,
  maddog107.com, www.maddog107.com; `ALLOWED_ORIGINS`). A missing Origin is refused unless `ALLOW_NO_ORIGIN=1`.
- **Caps**: 16 players a room, 64 rooms, 256 connections, 8 connections per address (an IPv6 client counts by its /64).
- **Whose address**: the socket's. Only with `TRUST_PROXY=1` **and** a peer on this machine is one header believed:
  `X-Real-IP`, which the production nginx sets itself. `CF-Connecting-IP` and `X-Forwarded-For` are never read; a value
  that isn't an address (`net.isIP`) is ignored. Without `TRUST_PROXY` (development, `node server.mjs`) no header is
  read at all.
- **Every message is validated**: a type whitelist, an event-name whitelist, finite numbers within range, strings from
  `[A-Za-z0-9_ -]` up to 24 characters, row and array limits, 2 KB. Malformed input, an unmasked or oversized frame, a
  binary frame, or more than 80 frames a second: the connection is dropped. (80 a second sustained, with up to 240
  saved up: a client that was held up for a few seconds — its machine, the network — delivers what it owed in one go,
  and cutting it off for that would be wrong. A normal client sends 21–66 a second.) A client that can't keep up with
  what it is sent (512 KB waiting) is dropped. Refused sockets are always closed.
- **Time-outs**: no hello within 10 s; no answer to pings (every 25 s, inside Cloudflare's 100 s idle limit) for 70 s;
  nothing sent for 10 minutes.
- **Nothing is logged or stored**: no message contents, no addresses. `RELAY_STATS=1` prints a line of counts a minute.

### What a cheating client can and cannot do
There is no game server: clients are trusted for **their own position** and for **their own hit claims**. That is
inherent in the design (the shooter decides) and is the price of a relay that knows nothing about the game.

A modified client **can**: fly its own jet anywhere at any speed; refuse to take damage or never die; claim hits it
didn't make (the owner checks only what it can: the right airframe, alive, not its own side, not spawn-protected, a
cannon within 4 km of where it sees the shooter, at most 5000 a claim); report any score for itself; farm kills with a
willing accomplice; drop bombs and fire rockets anywhere, as many as its share allows; **knock town buildings down
faster than fair** (any of them: a `bld` is its word) — on everyone else's screen they still come down at most 30 a
frame.

It **cannot** (checked by the relay or by every other client, with tests in tests/multiplayer.test.mjs "a peer is not
trusted" and tests/relay.test.mjs): speak as someone else (the relay stamps the sender); move, hurt-proof, kill or
respawn anyone else's aircraft (an event only ever concerns the sender's own entities; a `die` is accepted once, for a
living airframe the receiver has a picture of, and gives a kill only to someone in the room — to us only if we did
claim a hit on it); touch another peer's missiles (ids are per peer); pose as the host (only the room's host may have
AI aircraft); add to anyone's score but its own; put text or markup on anyone's screen; make a client build without
limit (puppets: 48 in all, 14 a peer, a new airframe a second; ghost missiles: 64 / 16; launch warnings: 3 a second;
flares: a salvo per 0.25 s; ghost bombs and rockets: 192 in all, 64 a peer, 24 launches a second with 48 saved up,
gone 5 s past a rocket's life or 2 minutes past a bomb's release without an end; cluster bombs opening: 4 a second a
peer; buildings waiting to fall: one entry each, so never more than the list); crash a client with a strange type name
(`constructor`…: tables are read by own keys), a NaN, an id that doesn't exist or a message repeated a thousand times.

Bombs, rockets and buildings, checked on receipt (tests in "a peer is not trusted"): a launch names a store of the
stores table's own entries **of the class it claims** (a missile can't come as a bomb, nor a bomb as a rocket), or the
plain table of that kind; from its own jet (entities 1… only from the host); a place inside the world and a speed under
2.5 km/s; ids 1…65535, each peer's own (one peer can't end another's ghost; an end is played once). A blast's radius and
strength are never taken from the wire: they are the store's own (so at most a MOAB's), and a peer's blast never brings
a building down. An end further than 3 km from the ghost is played where the ghost is. A building entry must be a whole
number naming one of our town buildings with the right check byte (not an airbase structure, nothing out of range).
The buildings' state (`sync`) is taken only from the room's host, only while we asked for it, and only for a list of our
length and digest; a host answers a peer's question twice at once and then once in 5 s.

## Running it

### Locally, two tabs
```bash
node server.mjs            # static files and the relay (at /ws) on http://localhost:8080
```
Open http://localhost:8080 in two tabs (or two browsers), choose MULTIPLAYER in both, the same room code, different
callsigns, LAUNCH. Keep both tabs visible (side by side): a hidden tab stops rendering and is "away".
From another machine on the network, open `http://<your-ip>:8080` and add that host to the allowlist:
`ALLOWED_ORIGINS=localhost,192.168.1.20 node server.mjs`.

### Tests
```bash
node --test tests/relay.test.mjs          # the relay: handshake, framing, rooms, host, batching, caps, origin, addresses, malformed input
node --test tests/multiplayer.test.mjs    # wire format, interpolation, two / three headless games through a stand-in relay
node tools/net/e2e.mjs --url http://localhost:8080/ --shots /tmp/mp   # two real pages through the real relay
```

### Production (https://maddog107.com/skywar/)
The page finds the relay from its own address: `new URL('ws', document.baseURI)` with ws / wss to match
(`netproto.js relayUrl`), i.e. `wss://maddog107.com/skywar/ws`. The static files are served by nginx; the relay is one
file, `relay.mjs`, run by Node 18+ (written for Node 20; no global WebSocket needed, no packages to install):

```bash
TRUST_PROXY=1 SOCKET=/run/skywar-relay/relay.sock node relay.mjs      # as it runs in production: a Unix socket, no TCP port
TRUST_PROXY=1 HOST=127.0.0.1 PORT=8377 node relay.mjs                 # or on a loopback port
```

| variable | default | |
|---|---|---|
| `SOCKET` | none | a Unix socket path to listen on instead of a port (made mode 0666 so the proxy's user can connect) |
| `HOST`, `PORT` | `127.0.0.1`, `8377` | where it listens when there is no `SOCKET` (keep it on loopback: nginx is the way in) |
| `TRUST_PROXY` | off | `1`: behind nginx on this machine, count connections by the `X-Real-IP` it sets |
| `ALLOWED_ORIGINS` | localhost, 127.0.0.1, maddog107.com, www.maddog107.com | comma-separated host names or origins |
| `ALLOW_NO_ORIGIN` | off | `1`: accept clients that send no Origin (tools, not browsers) |
| `RELAY_STATS` | off | `1`: a line of counts a minute |

nginx (inside the site's `server` block; `X-Real-IP` must be the address nginx verified, i.e. `$remote_addr` after the
real-IP module has resolved the client from Cloudflare's ranges — without that header every player would count as one
address and the ninth would be refused; the other two headers are overwritten so nothing a client wrote gets through):

```nginx
location = /skywar/ws {
    proxy_pass http://unix:/run/skywar-relay/relay.sock;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header CF-Connecting-IP $remote_addr;
    proxy_read_timeout 300s;      # the relay pings every 25 s
    proxy_send_timeout 300s;
    proxy_buffering off;
}
# the game's files: always revalidated, so a new deploy is never mixed with cached old modules ("private" keeps
# Cloudflare from caching them and from replacing the header with its own browser-cache time)
location ^~ /skywar/ {
    add_header Cache-Control "private, no-cache";
}
```

The service: `tools/net/skywar-relay.service` (systemd), as installed on the server. The machine it runs on does
other, more important work, so the relay is boxed in: a throwaway user, **no network at all** (`PrivateNetwork=yes`:
nginx reaches it through the socket file and nothing else can; it could not open a connection to anything even if it
were taken over), the machine's data directories not visible, a read-only system, no privileges, 300 MB and half a
core at most, and it stays down rather than loop if it can't start (`systemd-analyze security` rates it 0.5, "safe").
It needs only a Node binary and `relay.mjs` in `/opt/skywar-relay/`. `tools/deploy.sh` sends a changed `relay.mjs`
there and restarts the service (see the variables at the top of that script).

`GET /health` on the relay's port or socket (`curl --unix-socket /run/skywar-relay/relay.sock http://x/health`) answers `{"ok":true,"rooms":n,"players":n}` (for a monitor); anything else that
isn't a WebSocket upgrade gets `426`. Cloudflare: WebSockets must be on for the zone (they are by default). Restarting
the relay drops everyone; their pages reconnect by themselves within a few seconds. Deploying a build with a new
`PROTOCOL`: restart the relay with the new `relay.mjs` at the same time as the files go out (pages still on the old
build are told to reload).

## Code

| file | |
|---|---|
| `relay.mjs` | the relay (and its standalone entry point) |
| `server.mjs` | development server: attaches the relay at `/ws` |
| `src/netproto.js` | wire format: constants, rows, names, the relay's URL (no three.js, no DOM) |
| `src/netinterp.js` | `ClockSync`, `InterpBuffer` |
| `src/netlink.js` | one WebSocket connection: hello / welcome, ping, send budget |
| `src/multiplayer.js` | the game's side: `game.mp` (a plug-in system, systems.js) |
| `src/netordnance.js` | bombs and rockets: ours told (`ord`, `blast`, guided bombs' rows), everyone else's drawn as ghosts (`mp.ord`) |
| `src/networld.js` | the towns' buildings: who brought one down tells the room (`bld`), the state for a newcomer (`sync`) (`mp.net`) |
| `src/mplobby.js` | the lobby in the menu |
| `tools/net/e2e.mjs` | the end-to-end check |
| `tests/relay.test.mjs`, `tests/multiplayer.test.mjs` | |

Hooks in shared code (all small):

- `config.js`: the `multiplayer` mode. `systems.js`: `['mp', Multiplayer]`.
- `game.js`: `difficulty` is `veteran` for everyone in multiplayer; `start()` takes `opts.weather`, spawns no carrier,
  garrisons or wingmen in the mode, has endless jets; `startPoint()` maps to air / runway / apron; the `killed` handler
  asks systems `onKilled(ac, source, kind)` (true: the system wrote its own kill line and score); `pause()` hands to
  `mp.menu()`; `worldCollisions()` skips puppets; `canClimbOut()` and `Aircraft.kill()` honour `game.cockpitOnly`
  (no ejecting, no climbing out); the out-of-bounds warning is off in the mode.
- `aircraft.js`: `ac.puppet` — `damage()` → `puppet.hit()`, `update()` → `puppet.place()` instead of the flight model,
  no falling logic and no ejection for a puppet.
- `weapons.js`: a puppet's cannon rounds carry no damage; a human's puppet decoys missiles like a player; how a
  missile or rocket ended is marked on it (`how`), and where and how a bomb went off (`endAt`, `endHow`: bombBurst,
  openCluster); a bomb marked `show` (another pilot's, drawn here) and its bomblets stop before their damage.
- `buildings.js`: `ruin(b)` (down already: the stub and the heap at once, no collapse); `keepStanding(b)` factored out
  of `destroy` for it. multiplayer.js / networld.js wrap the instance's `damage` and `destroy` while the mode runs (only
  the towns' buildings can be hurt; no score; tell the room) and put them back after.
- `airbase.js`: the helipads' parked helicopters are seeded.
- `main.js`, `index.html`, `style.css`: the lobby; LAUNCH in the mode connects first and launches into the room's time
  and weather; jets and paint unlocked while the mode is selected. `touch.js`, `style.css`, `main.js`: the touch
  screens' SCORE button (action `scores`, shown only while the mode runs: `#touchUI.mp`).
