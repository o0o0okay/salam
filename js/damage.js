/* Damage, wrecks, impact effects */
import { $, rnd } from './utils.js';
import { ASSET } from './assets.js';
import { game, cars, fires } from './state.js';
import { DIFF, ENV_DMG } from './config.js';
import { sparks, smoke, explosion, emit } from './particles.js';
import { sfx } from './audio.js';
import { toast } from './ui.js';
import { endGame } from './flow.js';


export function hurtPlayer(amt) {
  if (game.state !== 'playing' || amt <= 0) return;
  if (game.time < 1.5) return;
  amt *= DIFF.dmg;
  game.hp = Math.max(0, game.hp - amt);
  const f = $('flash'); f.style.transition = 'none'; f.style.opacity = String(Math.min(0.9, 0.25 + amt / 25)); void f.offsetWidth; f.style.transition = 'opacity .6s'; f.style.opacity = 0;
  if (game.hp <= 0) endGame('WASTED');
}
export function hurtCar(c, amt) {
  if (c.wrecked || amt <= 0) return;
  // Police cars are armored (less damage taken). Fuel tankers are the opposite — fragile, rupture easily.
  const armor = c.isPolice ? [1, .82, .62, .42, .28][c.tier - 1] : (c.isTanker ? 2.2 : 1);
  c.hp -= amt * armor; if (c.hp <= 0) wreckCar(c);
}
// Hits on the scenery (see ENV_DMG in config.js): the same damage, scaled down.
export function hurtPlayerEnv(amt) { hurtPlayer(amt * ENV_DMG); }
export function hurtCarEnv(c, amt) { hurtCar(c, amt * ENV_DMG); }
export function wreckCar(c) {
  c.wrecked = true; c.wreckT = 0; c.mass = Math.max(1.8, c.mass);
  c.mesh.traverse(o => { if (o.isMesh && !o.userData.beam) o.material = ASSET.burnt; });
  if (c.beam) c.beam.visible = false;
  if (c.isTanker) tankerExplode(c); else explosion(c.x, c.z);
  if (game.time - c.lastPlayerHit < 4 && game.state === 'playing') {
    if (c.isPolice) {
      const reward = 75 + c.tier * 50; game.takedowns++; game.cash += reward; toast('TAKEDOWN! +$' + reward); sfx.blip(880);
      game.nitro = Math.min(100, game.nitro + 25); if (game.nitroLock && game.nitro > 20) game.nitroLock = false;
    }
    else { game.cash += c.isTanker ? 120 : 50; toast(c.isTanker ? 'BOOM! +$120' : 'CHAOS! +$50'); sfx.blip(740); }
  }
  sfx.crash(40);
}
// Fuel tanker: severe chain-reaction explosion on destruction — big fireball, area damage, lingering fire.
function tankerExplode(c) {
  explosion(c.x, c.z);
  explosion(c.x + rnd(-2, 2), c.z + rnd(-2, 2)); // second blast wave = bigger visual fireball
  game.shake = Math.max(game.shake, 2.2);
  sfx.crash(140);
  for (let i = 0; i < 60; i++) emit(c.x, 1.3, c.z, rnd(-24, 24), rnd(8, 28), rnd(-24, 24), Math.random() < 0.5 ? 0xff5a1a : 0xffce4a, rnd(1.0, 2.6), rnd(0.8, 1.6), 13);
  const R = 24;
  for (const o of cars) {
    if (o === c) continue;
    const d = Math.hypot(o.x - c.x, o.z - c.z); if (d > R) continue;
    const f = 1 - d / R;
    if (o.isPlayer) hurtPlayer(95 * f);
    else if (!o.wrecked) hurtCar(o, 260 * f);
  }
  fires.push({ x: c.x, z: c.z, life: 10 });
  if (game.state === 'playing') toast('🔥 FUEL TANKER EXPLOSION!');
}
export function impactFx(px, pz, speed, nx, nz, isPlayerInvolved) {
  if (speed < 2.5) return;
  sparks(px, 0.9, pz, Math.min(14, Math.floor(speed * 0.45)), nx, nz, Math.min(12, speed * 0.4));
  if (speed > 10) smoke(px, 1, pz, Math.floor(speed / 8));
  if (isPlayerInvolved) { game.shake = Math.max(game.shake, Math.min(1.1, speed * 0.03)); sfx.crash(speed); }
}