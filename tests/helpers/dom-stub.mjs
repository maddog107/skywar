// Minimal browser globals so modules that build canvas textures / read window at import time
// can load under Node. Everything is a no-op; nothing is rendered.
function noopProxy(extra = {}) {
    const fn = () => proxy;
    const proxy = new Proxy(fn, {
        get(t, k) {
            if (k in extra) return extra[k];
            if (k === Symbol.toPrimitive) return () => 0;
            if (k === 'then') return undefined;
            return proxy;
        },
        set() { return true; },
        apply() { return proxy; },
    });
    return proxy;
}

function makeCanvas() {
    const ctx2d = noopProxy({
        measureText: (s) => ({ width: String(s).length * 8 }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    });
    return {
        width: 300, height: 150, style: {},
        getContext: () => ctx2d,
        toDataURL: () => 'data:,',
        addEventListener() {}, removeEventListener() {},
    };
}

function makeElement(tag) {
    if (tag === 'canvas') return makeCanvas();
    const el = {
        tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild(c) { this.children.push(c); return c; }, append() {}, removeChild(c) { return c; }, remove() {},
        addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
        querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
        innerHTML: '', textContent: '',
    };
    return el;
}

export function installDomStub() {
    if (globalThis.document) return;
    const store = new Map();
    globalThis.document = {
        createElement: makeElement,
        createElementNS: (_ns, tag) => makeElement(tag),
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {},
        body: makeElement('body'), documentElement: makeElement('html'), head: makeElement('head'),
    };
    globalThis.window = globalThis;
    globalThis.addEventListener ??= () => {};
    globalThis.removeEventListener ??= () => {};
    globalThis.innerWidth ??= 1280; globalThis.innerHeight ??= 720; globalThis.devicePixelRatio ??= 1;
    globalThis.requestAnimationFrame ??= () => 0;
    // defineProperty: Node >= 25 has a built-in localStorage getter that warns when read
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true, writable: true,
        value: {
            getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k), clear: () => store.clear(),
        },
    });
    globalThis.Image ??= class { constructor() { this.width = 0; this.height = 0; } addEventListener() {} };
}
