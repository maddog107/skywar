// ═══════════════════════════════════════════════════════════════
// Touch controls (phones/tablets): virtual stick, throttle slider, buttons.
// Feeds Input.touch, which readStick() merges with keyboard/gamepad input.
// ═══════════════════════════════════════════════════════════════
export function isTouchDevice() {
    return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

export function setupTouch(input) {
    input.touch = { active: false, pitch: 0, roll: 0, fire: false, throttle: null };
    if (!isTouchDevice()) return null;
    const root = document.createElement('div');
    root.id = 'touchUI';
    root.innerHTML = `
        <div class="t-stick"><div class="t-knob"></div></div>
        <div class="t-throttle"><div class="t-thr-fill"></div><span>THR</span></div>
        <div class="t-buttons">
            <button data-hold="fire" class="big">GUN</button>
            <button data-act="missile" class="big">MSL</button>
            <button data-act="flares">FLR</button>
            <button data-act="weapon">WPN</button>
            <button data-act="camera">CAM</button>
            <button data-act="spoilers">BRK</button>
            <button data-act="flaps">FLAP</button>
            <button data-act="gear">GEAR</button>
            <button data-act="target">TGT</button>
            <button data-act="pause">II</button>
        </div>`;
    document.body.appendChild(root);
    const t = input.touch;
    const stick = root.querySelector('.t-stick'), knob = root.querySelector('.t-knob');
    let stickId = null;
    const moveStick = (e) => {
        const r = stick.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
        let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        t.roll = dx; t.pitch = dy; // pull back (down) = nose up, like a real stick
        knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); t.active = true; moveStick(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
    const release = (e) => { if (e.pointerId !== stickId) return; stickId = null; t.roll = t.pitch = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    const thr = root.querySelector('.t-throttle'), fill = root.querySelector('.t-thr-fill');
    const setThr = (e) => {
        const r = thr.getBoundingClientRect();
        const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
        t.throttle = v; t.active = true;
        fill.style.height = (v * 100) + '%';
    };
    thr.addEventListener('pointerdown', (e) => { thr.setPointerCapture(e.pointerId); setThr(e); });
    thr.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure) setThr(e); });

    root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('pointerdown', (e) => { e.preventDefault(); t.active = true; input.emit(b.dataset.act); }));
    root.querySelectorAll('[data-hold]').forEach(b => {
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); t.active = true; t.fire = true; });
        const up = () => { t.fire = false; };
        b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    });
    return root;
}
