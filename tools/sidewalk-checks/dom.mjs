/* Minimal DOM + canvas stubs so the browser modules can be imported in Node. */
export function installDom() {
  const noop = () => {};
  const ctx2d = () => new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 8 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop: noop });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)) });
      if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)) });
      if (typeof k === 'string' && /^(fill|stroke|font|text|shadow|line|global|image|filter|direction|letter|word|miter|canvas)/.test(k)) return t[k] = noop;
      return t[k] = (() => {});
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const makeCanvas = () => ({
    width: 512, height: 512, style: {},
    getContext: () => ctx2d(),
    toDataURL: () => 'data:,',
    addEventListener: noop, removeEventListener: noop,
  });
  const el = () => new Proxy({
    style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, appendChild: noop, removeChild: noop,
    getContext: () => ctx2d(), setPointerCapture: noop, releasePointerCapture: noop,
    innerHTML: '', textContent: '', value: '0', children: [], dataset: {},
  }, { get(t, k) { if (k in t) return t[k]; if (k === 'width' || k === 'height') return 512; return typeof k === 'string' ? (t[k] = el._noop) : undefined; } });
  el._noop = noop;
  globalThis.window = { innerWidth: 1200, innerHeight: 650, devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop, requestAnimationFrame: cb => 0 };
  globalThis.document = {
    createElement: tag => (tag === 'canvas' ? makeCanvas() : el()),
    getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [],
    createElementNS: () => el(),
    addEventListener: noop, removeEventListener: noop, body: el(), documentElement: el(),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  globalThis.Image = class { constructor() { this.src = ''; } addEventListener() {} };
}
