/* Debug overlay: frame time, the update/render split and the renderer's own counters.
   Off unless the page is opened with ?debug (e.g. http://localhost:8000/?debug). With it off, perfFrame()
   returns at once and the frame loop does not read the clock for it. */
export const PERF_ON = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

const REFRESH_MS = 500;
let el = null, acc = 0, frames = 0, updSum = 0, renSum = 0;

// Called once per frame, after renderer.render(). updMs and renMs are this frame's timings in milliseconds;
// renderer.info.render is the counters of the render that just ran (its shadow pass included), because
// three.js resets them at the start of each render() call.
export function perfFrame(frameMs, updMs, renMs, renderer, extra) {
  if (!PERF_ON) return;
  frames++; acc += frameMs; updSum += updMs; renSum += renMs;
  if (acc < REFRESH_MS) return;
  if (!el) {
    el = document.createElement('pre');
    el.id = 'perf';
    document.body.appendChild(el);
  }
  const info = renderer.info, r = info.render;
  const lines = [
    `fps ${(frames * 1000 / acc).toFixed(0)}   frame ${(acc / frames).toFixed(1)} ms`,
    `  update ${(updSum / frames).toFixed(1)} ms   render ${(renSum / frames).toFixed(1)} ms`,
    `draw calls ${r.calls}   triangles ${(r.triangles / 1000).toFixed(1)}k   (shadow pass included)`,
    `geometries ${info.memory.geometries}   textures ${info.memory.textures}   programs ${info.programs ? info.programs.length : '?'}`,
  ];
  if (extra) for (const [k, v] of Object.entries(extra())) lines.push(`${k} ${v}`);
  el.textContent = lines.join('\n');
  acc = 0; frames = 0; updSum = 0; renSum = 0;
}
