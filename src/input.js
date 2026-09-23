// ═══════════════════════════════════════════════════════════════
// Input: keyboard, mouse (aim or joystick), gamepad
// ═══════════════════════════════════════════════════════════════
import { clamp } from './util.js';

const ACTIONS = {
    KeyV: 'camera', KeyT: 'target', Tab: 'target', KeyG: 'gear', KeyH: 'help', Escape: 'pause', KeyP: 'pause',
    KeyM: 'missile', Enter: 'missile', KeyR: 'flares', KeyF: 'flaps', KeyJ: 'eject', KeyN: 'spawn', KeyL: 'loadout',
    KeyX: 'weapon', KeyK: 'missilecam', Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4',
};

export class Input {
    constructor(dom) {
        this.dom = dom;
        this.keys = {};
        this.mouse = { dx: 0, dy: 0, x: window.innerWidth / 2, y: window.innerHeight / 2, left: false, right: false, middle: false, wheel: 0, seen: false };
        this.locked = false;
        this.listeners = [];
        this.pad = null;
        this.padPrev = [];

        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
            if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
            if (!this.keys[e.code] && ACTIONS[e.code]) this.emit(ACTIONS[e.code]);
            this.keys[e.code] = true;
        });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
        window.addEventListener('blur', () => { this.keys = {}; this.mouse.left = this.mouse.right = false; this.mouse.seen = false; });
        document.addEventListener('mouseleave', () => { this.mouse.seen = false; });
        dom.addEventListener('mousedown', (e) => {
            if (e.button === 0) this.mouse.left = true;
            if (e.button === 2) { this.mouse.right = true; this.emit('missile'); }
            if (e.button === 1) { this.mouse.middle = true; e.preventDefault(); }
            this.emit('click');
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.mouse.left = false;
            if (e.button === 2) this.mouse.right = false;
            if (e.button === 1) this.mouse.middle = false;
        });
        dom.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true;
            if (this.locked || this.freeMouse) { this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; }
        });
        window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
        document.addEventListener('pointerlockchange', () => {
            const was = this.locked;
            this.locked = document.pointerLockElement === this.dom;
            // Esc while the pointer is captured only releases the lock in most browsers: treat it as pause
            if (was && !this.locked && !this.selfUnlock) this.emit('lockLost');
            this.selfUnlock = false;
        });
        window.addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; this.emit('gamepad'); });
    }

    on(fn) { this.listeners.push(fn); }
    emit(a) { this.listeners.forEach(fn => fn(a)); }

    lock() { if (!this.locked && this.dom.requestPointerLock) { try { const r = this.dom.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } } }
    unlock() { if (this.locked) { this.selfUnlock = true; document.exitPointerLock(); } }

    down(...codes) { return codes.some(c => this.keys[c]); }

    consumeMouse() {
        const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
        this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
        return d;
    }

    // Read gamepad (standard mapping); returns null if none
    readPad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const p = pads && (this.pad != null ? pads[this.pad] : [...pads].find(x => x));
        if (!p) return null;
        const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
        const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
        const bv = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
        const edge = (i, action) => { if (b(i) && !this.padPrev[i]) this.emit(action); };
        edge(0, 'missile'); edge(1, 'flares'); edge(2, 'target'); edge(3, 'camera'); edge(9, 'pause'); edge(8, 'gear'); edge(12, 'weapon'); edge(13, 'weapon');
        this.padPrev = p.buttons.map(x => x.pressed);
        return {
            roll: dz(p.axes[0]), pitch: dz(p.axes[1]), yaw: dz(p.axes[2] || 0), lookY: dz(p.axes[3] || 0),
            fire: bv(7) > 0.3, airbrake: bv(6) > 0.3,
            throttleUp: b(5), throttleDown: b(4),
        };
    }
}

// Keyboard/pad → normalized stick values. pitch +1 = pull (nose up), roll +1 = right.
export function readStick(input, settings) {
    const inv = settings.invertPitch ? -1 : 1;
    const s = { pitch: 0, roll: 0, yaw: 0, throttleDelta: 0, fire: false, airbrake: false, manual: false };
    if (input.down('KeyS', 'ArrowDown')) s.pitch += 1 * inv;
    if (input.down('KeyW', 'ArrowUp')) s.pitch -= 1 * inv;
    if (input.down('KeyA', 'ArrowLeft')) s.roll -= 1;
    if (input.down('KeyD', 'ArrowRight')) s.roll += 1;
    if (input.down('KeyQ')) s.yaw += 1;
    if (input.down('KeyE')) s.yaw -= 1;
    if (input.down('ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd')) s.throttleDelta += 1;
    if (input.down('KeyZ', 'Minus', 'NumpadSubtract')) s.throttleDelta -= 1;
    s.fire = input.down('Space') || input.mouse.left;
    s.airbrake = input.down('KeyB');
    s.manual = s.pitch !== 0 || s.roll !== 0;
    const pad = input.readPad();
    if (pad) {
        s.pitch = clamp(s.pitch + pad.pitch * inv, -1, 1);
        s.roll = clamp(s.roll + pad.roll, -1, 1);
        s.yaw = clamp(s.yaw - pad.yaw, -1, 1);
        if (pad.throttleUp) s.throttleDelta += 1;
        if (pad.throttleDown) s.throttleDelta -= 1;
        s.fire = s.fire || pad.fire;
        s.airbrake = s.airbrake || pad.airbrake;
        s.manual = s.manual || Math.abs(pad.pitch) > 0 || Math.abs(pad.roll) > 0;
        s.pad = true;
    }
    return s;
}
