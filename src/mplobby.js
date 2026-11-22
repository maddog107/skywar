// ═══════════════════════════════════════════════════════════════
// The multiplayer lobby in the menu (index.html #mpLobby, docs/MULTIPLAYER.md): callsign, room code, side, and the
// connection made when LAUNCH is pressed. Nothing here touches the network until then, and nothing else in the menu
// knows about multiplayer beyond calling refresh() and join().
// Everything that came from another player or from the relay goes into the page as text (textContent), never as HTML.
// ═══════════════════════════════════════════════════════════════
import { cleanCallsign, cleanRoom } from './netproto.js';

const CALLSIGNS = ['VIPER', 'MAVERICK', 'JESTER', 'ICEMAN', 'GHOST', 'REAPER', 'HAWK', 'NOMAD', 'COBRA', 'RAVEN', 'TALON', 'BANDIT'];
const TIME_LABEL = { dawn: 'DAWN', day: 'MIDDAY', dusk: 'DUSK', night: 'NIGHT' };

// ctx: { game, settings, save, audio, seg(id, options, key, cb), onChange() }
export function setupLobby(ctx) {
    const { game, settings, save } = ctx;
    const $ = (id) => document.getElementById(id);
    const name = $('mpName'), room = $('mpRoom'), status = $('mpStatus'), hint = $('mpHint'), btn = $('launchBtn');
    let busy = false;

    if (!settings.mpName) settings.mpName = CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)];
    if (settings.mpTeam !== 'red') settings.mpTeam = 'blue';
    name.value = cleanCallsign(settings.mpName);
    room.value = cleanRoom(settings.mpRoom) === 'PUBLIC' ? '' : cleanRoom(settings.mpRoom);
    // what's typed is cleaned as it goes (the relay enforces the same rules again)
    name.addEventListener('input', () => { const v = name.value.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 14).toUpperCase(); if (v !== name.value) name.value = v; settings.mpName = cleanCallsign(v); save(); });
    room.addEventListener('input', () => { const v = room.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); if (v !== room.value) room.value = v; settings.mpRoom = v; save(); say(''); });
    for (const el of [name, room]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { el.blur(); btn.click(); } e.stopPropagation(); });
    ctx.seg('segTeam', [['blue', 'BLUE'], ['red', 'RED']], 'mpTeam');
    hint.textContent = 'Leave the room code empty for the PUBLIC room, or agree a code with friends. The time of day and the weather are set by whoever opens a room. Every jet is unlocked.';

    function say(text, err = false) { status.textContent = text; status.classList.toggle('err', !!err); }
    const on = () => settings.mode === 'multiplayer';

    return {
        get on() { return on(); },
        // the mode was (de)selected: show or hide the lobby, the single-player rows, the career locks
        refresh() {
            const mp = on();
            $('mpLobby').parentElement.classList.toggle('mp', mp);
            $('menu').classList.toggle('mp-open', mp);
            if (!mp) say('');
        },
        // LAUNCH in multiplayer: join the room first. Resolves with the room { code, time, weather, … } to launch
        // into, or null (the reason is on the screen and the menu stays up).
        async join() {
            if (busy) return null;
            const callsign = cleanCallsign(name.value) || 'PILOT';
            name.value = callsign; settings.mpName = callsign; save();
            busy = true;
            btn.classList.add('busy');
            say('CONNECTING…');
            try {
                const r = await game.mp.connect({ name: callsign, room: cleanRoom(room.value), team: settings.mpTeam, ac: settings.aircraft, lv: settings.livery || 'default', time: settings.time, weather: settings.weather });
                say('ROOM ' + r.code + ' · ' + r.players + ' PILOT' + (r.players === 1 ? '' : 'S') + ' · ' + (TIME_LABEL[r.time] || '') + ' · ' + String(r.weather).toUpperCase());
                return r;
            } catch (e) {
                say(String((e && e.message) || 'Could not connect.'), true);
                if (ctx.audio && ctx.audio.tick) ctx.audio.tick(220, 0.12, 0.15);
                return null;
            } finally { busy = false; btn.classList.remove('busy'); }
        },
    };
}
