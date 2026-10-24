/* Wanted level + near-miss rules */
import { game, police, cars, sight, spikes } from './state.js';
import { DIFF, WANTED_AT, POLICE_TIERS } from './config.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';
import { removeCar } from './vehicle.js';
import { helicopter, setHelicopterVisible } from './helicopter.js';
import { scene } from './renderer.js';

// game.hideBonus: the seconds a hiding car has been given on top of the clock (hide.js), so the level climbs faster.
// Allow override for testing (clear stars button)
export const wantedLevel = () => game.wantedOverride !== undefined ? game.wantedOverride : Math.max(game.debugWanted, WANTED_AT.reduce((level, at, i) => game.time + (game.hideBonus || 0) >= at * DIFF.esc ? i + 1 : level, 1));
export function clearWanted() {
  game.wantedOverride = 0;
  game.debugWanted = 0;
  game.wanted = 0;
  game.wantedLast = 0;
  game.tierSpawnPending = 0;
  game.spawnT = 999;
  game.spikeT = 999;
  if (game.roadblockT !== undefined) game.roadblockT = 999;
  // despawn all police immediately
  for (const c of [...police]) removeCar(c);
  if (helicopter) setHelicopterVisible(false);
  sight.t = -999; sight.heliOn = false; sight.heliLock = 0; sight.lostFlag = false;
  // remove spikes
  for (const s of [...spikes]) { try { scene.remove(s.mesh); } catch(e){} }
  spikes.length = 0;
  toast('WANTED CLEARED ★☆☆☆☆');
}
export function restoreWanted() {
  game.wantedOverride = undefined;
  game.debugWanted = 1;
  toast('WANTED RESTORED');
}

export function updateWanted() {
  const next = wantedLevel();
  game.wanted = next;
  if (game.state !== 'playing' || next === game.wantedLast) return;
  game.wantedLast = next;
  if (next === 0) return; // cleared for testing
  game.tierSpawnPending = next; game.spawnT = -0.15;
  toast('WANTED LEVEL ' + next + ': ' + POLICE_TIERS[next - 1].name);
  sfx.blip(520 + next * 90);
  if (next === 5) toast('AIR UNIT DEPLOYED');
}

export function nearMissAward() {
  game.combo = game.comboT > 0 ? game.combo + 1 : 1; game.comboT = 3; game.nearMiss++;
  const bonus = 10 * Math.min(game.combo, 5);
  game.cash += bonus; game.nitro = Math.min(100, game.nitro + 8);
  if (game.nitroLock && game.nitro > 20) game.nitroLock = false;
  toast('NEAR MISS' + (game.combo > 1 ? ' x' + game.combo : '') + ' +$' + bonus); sfx.blip(660 + game.combo * 70);
}