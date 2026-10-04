/* Wanted level + near-miss rules */
import { game } from './state.js';
import { DIFF, WANTED_AT, POLICE_TIERS } from './config.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';

export const wantedLevel = () => Math.max(game.debugWanted, WANTED_AT.reduce((level, at, i) => game.time >= at * DIFF.esc ? i + 1 : level, 1));

export function updateWanted() {
  const next = wantedLevel();
  game.wanted = next;
  if (game.state !== 'playing' || next === game.wantedLast) return;
  game.wantedLast = next; game.tierSpawnPending = next; game.spawnT = -0.15;
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