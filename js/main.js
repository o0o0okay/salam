/* Entry point: bind UI, boot the world, run the loop */
import { $ } from './utils.js';
import { renderer, scene, camera } from './renderer.js';
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

// Boot
resetWorld();
game.state = 'menu';
let lastT = performance.now();
let loopFaults = 0;
// The frame loop must survive a bad frame: an uncaught error used to end the requestAnimationFrame chain and
// freeze the whole game mid-run (the browser console keeps the stack, the run keeps going).
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (now - lastT) / 1000); lastT = now;
  try {
    update(dt);
    renderer.render(scene, camera);
  } catch (err) {
    loopFaults++;
    if (loopFaults <= 5) console.error('[ESCAPE ROAD] frame error (continuing)', err);
    game.frameFaults = loopFaults;
  }
}
requestAnimationFrame(frame);