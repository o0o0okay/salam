/* Wrecks: the vehicles that have burned out.
 *
 * A wrecked car keeps rolling on its own momentum with the handbrake on, smoking and throwing embers, which
 * is what makes a mid-chase wreck feel like a real object rather than a prop that turned black.
 *
 * `tickHulks` is for the other kind of wreck: a parked ambulance or fire appliance that burned out on its
 * bay. It became a real car entity when it caught fire (see js/collisions.js), so the game shoves it around
 * like any other wreck, but it is never cleaned up, it keeps burning, and it stays at the level of the lot
 * it was parked on.
 */
import { rnd } from './utils.js';
import { cars, player } from './state.js';
import { driveCar } from './vehicle.js';
import { emit, smoke } from './particles.js';

export function wreckTick(c, sdt) {
  driveCar(c, { throttle: 0, hand: true }, sdt); c.vx *= Math.exp(-1.2 * sdt); c.vz *= Math.exp(-1.2 * sdt);
  c.wreckT += sdt; c.smokeT -= sdt;
  if (c.smokeT <= 0) { c.smokeT = 0.08; smoke(c.x, 1.3, c.z, 1, true, 1.2); if (Math.random() < 0.5) emit(c.x + rnd(-.6, .6), 1, c.z + rnd(-.6, .6), 0, rnd(2, 4), 0, 0xff8a1a, 0.4, 0.5, 0, 0); }
}

export function tickHulks(sdt) {
  for (const c of cars) {
    if (!c.hulk || !c.wrecked) continue;
    if (Math.hypot(c.x - player.x, c.z - player.z) > 150) continue;   // nothing to see: leave it be far away
    wreckTick(c, sdt);                                                // it still burns, and it still rolls
    if (c.hulkY !== undefined) { c.y = c.hulkY; c.vy = 0; }            // a hulk stays on the lot it was parked on
    if (c.fire) { c.fire.x = c.x; c.fire.z = c.z; }                    // and its flames travel with it
  }
}
