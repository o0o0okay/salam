/* Entry point: bind UI, boot the world, run the loop */
import { $ } from './utils.js';
import { renderer, scene, camera, applyQuality, QUALITY } from './renderer.js';
import { game } from './state.js';
import { cfg, setDiff } from './config.js';
import { initInput } from './input.js';
import { resetWorld, startGame, togglePause } from './flow.js';
import { update } from './update.js';

$('menuBest').textContent = game.best;

// Difficulty buttons
document.querySelectorAll('#diffPick button').forEach(b => b.addEventListener('click', () => { setDiff(b.dataset.d); b.blur(); }));
setDiff(cfg.diffKey);

// Start / restart / auto-pause
$('startBtn').addEventListener('click', startGame);
$('restartBtn').addEventListener('click', startGame);
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'playing' && !game.paused) togglePause(); });

initInput();
applyQuality(0);      // start at the best tier and let the frame-time controller walk it down if needed

// Boot
resetWorld();
game.state = 'menu';
let lastT = performance.now();
let loopFaults = 0;
// ---- frame-time controller: keeps the picture moving on whatever machine this is ----
// A rolling average of the frame time decides the quality tier (see renderer.js) and how often the shadow map
// is redrawn. Changes are slow on purpose: a tier that flickers is worse than one tier too low.
let frameMs = 16.7, qLevel = 0, lastQ = 0, shadowTick = 0;
const Q_PROBE = 2000;
// The frame loop must survive a bad frame: an uncaught error used to end the requestAnimationFrame chain and
// freeze the whole game mid-run (the browser console keeps the stack, the run keeps going).
function frame(now) {
  requestAnimationFrame(frame);
  const raw = now - lastT;
  const dt = Math.min(0.033, raw / 1000); lastT = now;
  frameMs += (Math.min(raw, 80) - frameMs) * 0.08;
  // step the quality tier only when the frame time has been bad (or good) for a while
  if (now - lastQ > Q_PROBE) {
    if (frameMs > 23 && qLevel < QUALITY.length - 1) { qLevel = applyQuality(qLevel + 1); lastQ = now; }
    else if (frameMs < 14 && qLevel > 0) { qLevel = applyQuality(qLevel - 1); lastQ = now; }
  }
  try {
    update(dt);
    // shadows refresh on a cadence: every 2nd frame normally, less often when the machine is struggling
    if ((shadowTick++ % QUALITY[qLevel].shadowsEvery) === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  } catch (err) {
    loopFaults++;
    if (loopFaults <= 5) console.error('[ESCAPE ROAD] frame error (continuing)', err);
    game.frameFaults = loopFaults;
  }
}
requestAnimationFrame(frame);