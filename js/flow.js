/* Game flow: reset / start / end / pause */
import { $, fmtTime } from './utils.js';
import { scene } from './renderer.js';
import { game, cars, spikes, flying, fallingTrees, geysers, fires, player, sight, calcScore } from './state.js';
import { PLAYER_PARAMS } from './config.js';
import { createCar, removeCar } from './vehicle.js';
import { chunks, disposeChunk, updateChunks, warmTextCache } from './world.js';
import { clearParticles, explosion } from './particles.js';
import { sfx } from './audio.js';
import { resetHudCache } from './ui.js';
import { camState } from './camera.js';
import { ensureHelicopter, setHelicopterVisible } from './helicopter.js';
import { spawnCiv } from './civilians.js';
export function resetWorld() {
  for (const c of cars.slice()) if (c !== player) removeCar(c);   // cops, traffic, and any burnt hull left over
  for (const f of flying) scene.remove(f.mesh); flying.length = 0; geysers.length = 0; fires.length = 0;
  for (const f of fallingTrees) scene.remove(f.mesh); fallingTrees.length = 0;
  for (const sp of spikes) scene.remove(sp.mesh); spikes.length = 0;
  for (const ch of chunks.values()) disposeChunk(ch); chunks.clear();
  clearParticles(); $('toasts').innerHTML = '';
  Object.assign(game, { time: 0, clock: 0, dist: 0, cash: 0, takedowns: 0, hp: 100, pin: 0, shake: 0, spawnT: 2.5, slow: 1, overT: 0, overShown: false, reason: '', score: 0, wanted: 1, wantedLast: 1, tierSpawnPending: 0, civT: 0,
    nitro: 60, nitroLock: false, nitroOn: false, combo: 0, comboT: 0, nearMiss: 0, spiked: 0, spikeT: 6, roadblockT: 14, roadblockGroup: null, isNight: false });
  if (player.mesh) removeCar(player);
  Object.assign(player, createCar('player', 3, -24, 0, PLAYER_PARAMS, 0xffc21a)); cars.push(player);
  player.lastWall = -99;
  game.debugWanted = 1;
  warmTextCache();                                      // merge every sign string now, not mid-race
  updateChunks(player.x, player.z, 999);
  camState.h = 0; camState.pos.set(3, 9, -40); camState.look.set(3, 1.5, -10);
  game.civT = 0;
  sight.x = player.x; sight.z = player.z; sight.vx = sight.vz = 0; sight.t = game.t; sight.heliLock = 0; sight.heliOn = false; sight.lostFlag = false;
  ensureHelicopter();
  setHelicopterVisible(false);
  for (let i = 0; i < 8; i++) spawnCiv();
  resetHudCache();
}
export function startGame() {
  if (game.state === 'playing') return;
  sfx.init(); resetWorld();
  game.state = 'playing'; $('startScreen').classList.add('hide'); $('overScreen').classList.add('hide'); $('hud').classList.add('on');
}
export function endGame(reason) {
  if (game.state !== 'playing') return;
  game.state = 'over'; game.reason = reason; game.overT = 0; game.overShown = false; game.slow = 0.3;
  if (reason === 'WASTED') { explosion(player.x, player.z); player.mesh.visible = false; player.dead = true; player.vx = player.vz = 0; sfx.crash(45); }
  game.score = calcScore();
  game.newBest = game.score > game.best;
  if (game.newBest) { game.best = game.score; try { localStorage.setItem('escape_road_best', String(game.best)); } catch (e) {} }
}
export function showOver() {
  game.overShown = true; const t = $('overTitle'); t.textContent = game.reason; t.className = 'title ' + (game.reason === 'BUSTED' ? 'busted' : 'wasted');
  $('overSub').textContent = game.reason === 'BUSTED' ? 'Pinned against the wall — the cops cuffed you.' : 'Your ride is toast. Total wreck.';
  $('oScore').textContent = game.score.toLocaleString(); $('oBest').textContent = game.best.toLocaleString(); $('oTime').textContent = fmtTime(game.time);
  $('oDist').textContent = (game.dist / 1000).toFixed(2) + ' km'; $('oCash').textContent = '$' + game.cash; $('oTake').textContent = game.takedowns;
  $('oNear').textContent = game.nearMiss; $('oSpike').textContent = game.spiked;
  $('newBest').classList.toggle('hide', !game.newBest); $('overScreen').classList.remove('hide'); $('menuBest').textContent = game.best;
}
export function togglePause() {
  if (game.state !== 'playing') return; game.paused = !game.paused; $('pauseScreen').classList.toggle('hide', !game.paused);
  if (sfx.ctx) game.paused ? sfx.ctx.suspend() : sfx.ctx.resume();
}