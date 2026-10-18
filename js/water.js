/* The water: the river and the sea. No car gets into either, and one that is in all the same goes under.
 *
 * The river (riverSeg in js/flyover.js) runs along the street row RIVER_ROW: water between two bank walls, crossed at
 * every junction by a bridge whose deck has a parapet on each edge (closedStreets in js/world.js). The sea is all round
 * the island, past the seawall on the coast (seaWall in js/world.js). Those walls are solids, and a solid stops a car by
 * pushing it back out of itself the shortest way (collideSolids in js/collisions.js). Half a metre of wall is not much
 * for that. A car that gets more than half its width into one in a frame comes out on the far side, in the water: a
 * slide at speed, a frame that took 33 ms, a Juggernaut shoving it in after the walls were done with for the frame. The
 * player's car and the traffic went into the river that way, and a car rammed into the seawall ended up inside it.
 *
 * So the water's edges are kept here as well, as edges and not as solids. waterGuard runs for every car once a frame,
 * after everything that moves it. A car whose box is in a keep-out (the water and the walls round it) is put back out
 * on the side its centre was on at the end of the frame before, when it was clear. It ends up right against the wall
 * and is stopped there like a car that hits one (wallBounce in js/collisions.js). The edges hold all the way round
 * and at any height:
 *   - the river's run from one bridge's deck edge to the next, bank face to bank face; on the east coast, where it runs
 *     out under the seawall with no bridge, they run to the coast;
 *   - the sea's is the seawall's inner face.
 *
 * And a car that is over the water all the same (its centre over open water; nothing should ever get there) goes
 * under: a splash, it sinks out of sight, and a car of the traffic or the police is gone. If it is the player's, the
 * run is over: SUNK, the way WASTED ends it.
 */
import { CHUNK, rnd } from './utils.js';
import { ISLAND_R, ISLAND_MAX, SEAWALL_T } from './island.js';
import { RIVER_ROW } from './flyover.js';
import { game, cars, player } from './state.js';
import { emit } from './particles.js';
import { sfx } from './audio.js';
import { wallBounce } from './collisions.js';
import { wreckReward } from './damage.js';
import { endGame } from './flow.js';
import { removeCar } from './vehicle.js';

// The river's cross-section, as closedStreets builds it (riverSide in js/world.js). The water reaches RIVER_HALF either
// side of the row's line, and the bank walls stand on its edges, RIVER_WALL thick, so their land faces are KEEP_HALF out.
// A bridge's deck is the junction square, DECK either side of the crossing street, and its parapets stand just past its
// edges, as thick as the bank walls. water.mjs checks these against the walls the blocks build.
export const RIVER_Z = RIVER_ROW * CHUNK, RIVER_HALF = 8, RIVER_WALL = 0.5, DECK = 8;
export const KEEP_HALF = RIVER_HALF + RIVER_WALL;
export const SEA_IN = ISLAND_MAX - SEAWALL_T;                 // the seawall's inner face, on each coast

// The river's keep-out between the bridges at junctions j and j + 1 (j from -ISLAND_R to ISLAND_R - 1): from the one
// deck's edge to the next, bank face to bank face. The first starts at the half deck at the river's mouth on the west
// coast. The last runs out to the east coast, where there is no bridge at the river's mouth.
export function riverKeep(j, r = {}) {
  r.x0 = j * CHUNK + DECK;
  r.x1 = j === ISLAND_R - 1 ? ISLAND_MAX : (j + 1) * CHUNK - DECK;
  r.z0 = RIVER_Z - KEEP_HALF; r.z1 = RIVER_Z + KEEP_HALF;
  return r;
}

// What is under the point (x, z): 'sea' past the coast, 'river' over the river's open water (between its walls, off the
// decks and their parapets), and null for the land, the walls and the decks.
export function waterAt(x, z) {
  if (Math.abs(x) > ISLAND_MAX || Math.abs(z) > ISLAND_MAX) return 'sea';
  if (Math.abs(z - RIVER_Z) >= RIVER_HALF) return null;
  const j = Math.floor(x / CHUNK), off = x - j * CHUNK;         // the junction west of it, and how far past it
  if (off <= DECK + RIVER_WALL) return null;                    // that bridge's deck or parapet
  if (off >= CHUNK - DECK - RIVER_WALL && j < ISLAND_R - 1) return null;   // the next one's (none at the east coast)
  return 'river';
}

// Does the car's box (centre x, z; heading h; e1 along it, e2 across) reach into the rectangle r? Tested on the four axes
// that can part them: the rectangle's two, and the box's own two.
function boxInRect(x, z, s, co, e1, e2, ex, ez, r) {
  if (x + ex <= r.x0 || x - ex >= r.x1 || z + ez <= r.z0 || z - ez >= r.z1) return false;
  const hx = (r.x1 - r.x0) / 2, hz = (r.z1 - r.z0) / 2, dx = (r.x0 + r.x1) / 2 - x, dz = (r.z0 + r.z1) / 2 - z;
  if (Math.abs(dx * s + dz * co) >= e1 + hx * Math.abs(s) + hz * Math.abs(co)) return false;      // along the heading
  if (Math.abs(dz * s - dx * co) >= e2 + hx * Math.abs(co) + hz * Math.abs(s)) return false;      // across it
  return true;
}

// Moves the car `d` metres along (mx, mz), out of the water's way towards the land, and stops it against the wall there.
// (A wreck that is out of the world's physics, the player's after WASTED, is not drawn by syncCarMesh: it is put there.)
function putBack(c, d, mx, mz) {
  c.x += mx * d; c.z += mz * d;
  if (c.box) { c.box.x = c.x; c.box.z = c.z; }
  wallBounce(c, -mx, -mz);
  if (c.dead && c.mesh) c.mesh.position.set(c.x, c.y, c.z);
}

const _r = {};
// Once a frame for every car, after everything that moves it (js/update.js). A car going under is left to it.
const STALE = 12;      // metres: a car is never this far from where it was a frame ago, unless it was put somewhere new
export function waterGuard(c) {
  if (c.sink) return;
  const e1 = c.box.e1, e2 = c.box.e2, s = Math.sin(c.h), co = Math.cos(c.h);
  const ex = e1 * Math.abs(s) + e2 * Math.abs(co), ez = e1 * Math.abs(co) + e2 * Math.abs(s);   // its half sizes along x and z
  // Its centre at the end of the last frame, on the land. A car that has just been put down somewhere (a new one, or one
  // moved there) has no such place yet: where it is stands in for it.
  let lx = c.landX, lz = c.landZ;
  if (lx === undefined || Math.abs(c.x - lx) + Math.abs(c.z - lz) > STALE) { lx = c.x; lz = c.z; }
  // The sea: the box stays inside the seawall's inner faces. A car that was on the island is put back in. (One that never
  // was, out there all along, is in the sea: it goes under, below.)
  if (Math.abs(c.x) + ex > SEA_IN || Math.abs(c.z) + ez > SEA_IN) {
    if ((Math.abs(lx) <= ISLAND_MAX && Math.abs(lz) <= ISLAND_MAX) || waterAt(c.x, c.z) !== 'sea') {
      if (c.x - ex < -SEA_IN) putBack(c, -SEA_IN + ex - c.x, 1, 0);
      if (c.x + ex > SEA_IN) putBack(c, c.x + ex - SEA_IN, -1, 0);
      if (c.z - ez < -SEA_IN) putBack(c, -SEA_IN + ez - c.z, 0, 1);
      if (c.z + ez > SEA_IN) putBack(c, c.z + ez - SEA_IN, 0, -1);
    }
  }
  // The river: the keep-outs the box reaches (one, or two at a bridge). It goes back out the way it came in, through the
  // face its centre was outside of at the end of the last frame (the nearer one, coming in at a corner): a car in off
  // the bank goes back onto the bank, one off a bridge back onto the deck, however far in it got. Only a car that was
  // already inside (it never is, once it has been on the land) leaves by the nearest face, unless it is in the water.
  if (Math.abs(c.z - RIVER_Z) < KEEP_HALF + ez) {
    for (let j = Math.max(-ISLAND_R, Math.floor((c.x - ex) / CHUNK) - 1); j <= Math.min(ISLAND_R - 1, Math.floor((c.x + ex) / CHUNK)); j++) {
      const r = riverKeep(j, _r);
      if (!boxInRect(c.x, c.z, s, co, e1, e2, ex, ez, r)) continue;
      const ways = [[lz >= r.z1, r.z1 + ez - c.z, 0, 1], [lz <= r.z0, c.z - r.z0 + ez, 0, -1], [lx <= r.x0, c.x - r.x0 + ex, -1, 0], [lx >= r.x1, r.x1 + ex - c.x, 1, 0]];
      let best = null;
      for (const w of ways) if (w[0] && (!best || w[1] < best[1])) best = w;
      if (!best) {
        if (waterAt(c.x, c.z) === 'river') continue;             // in the water: it goes under, below
        for (const w of ways) if (!best || w[1] < best[1]) best = w;
      }
      putBack(c, best[1], best[2], best[3]);
    }
  }
  // Over the water all the same (and down at it, not in the air over it): it goes under. Otherwise this is where it was
  // last on the land.
  const w = waterAt(c.x, c.z);
  if (w && c.y < 2) sinkCar(c, w);
  else if (!w) { c.landX = c.x; c.landZ = c.z; }
}

// ---- going under ----
export const SINK_T = 2.0, SINK_TO = -4.5;                    // seconds from the splash until it is gone; how deep it goes
const SURFACE = { river: 0.06, sea: -0.3 };                   // the river's water (riverSide) and the sea (ensureSea, js/world.js)
// The car goes into the water: a splash, and from now on it only sinks (updateSinking). It is out of the world's physics
// and of the AI (dead); a car of the traffic or the police is wrecked, and it counts for the player as a wreck would if he
// put it there. The player's run is over.
export function sinkCar(c, where = 'river') {
  if (c.sink) return;
  const y = SURFACE[where] ?? 0, sp = Math.hypot(c.vx, c.vz);
  c.sink = { t: 0, y0: c.y, surf: y, vx: c.vx * 0.15, vz: c.vz * 0.15, roll: rnd(-0.3, 0.3), bub: 0 };
  c.dead = true; c.vx = c.vz = c.vy = 0; c.speed = 0;
  for (let i = 0; i < 26 + Math.min(30, sp); i++) {
    emit(c.x + rnd(-1.6, 1.6), y + 0.2, c.z + rnd(-1.6, 1.6), rnd(-5, 5), rnd(5, 11), rnd(-5, 5), i % 3 ? 0xd6f0ff : 0x8fd3ff, rnd(0.25, 0.55), rnd(0.7, 1.3), 22);
  }
  const d = Math.hypot(c.x - player.x, c.z - player.z);
  sfx.splash(c.isPlayer ? 1 : Math.max(0, 1 - d / 120) * 0.8);
  if (c.isPlayer) { endGame('SUNK'); return; }
  if (!c.wrecked) wreckReward(c);
  c.wrecked = true; c.wreckT = 0; c.hp = 0;
  if (c.beam) c.beam.visible = false;
}
// Every car going under, each frame (real time, so the player's sinks before the end screen whatever the slow motion):
// it drifts on a little, its nose goes down and it sinks out of sight under the surface, bubbles coming up over it. A car
// of the traffic or the police is taken away once it is gone; the player's stays down there until the next run.
export function updateSinking(dt) {
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i], k = c.sink;
    if (!k) continue;
    k.t += dt;
    const f = Math.min(1, k.t / SINK_T);
    k.vx *= Math.exp(-3 * dt); k.vz *= Math.exp(-3 * dt);
    c.x += k.vx * dt; c.z += k.vz * dt;
    c.y = k.y0 + (SINK_TO - k.y0) * f * f;
    c.mesh.position.set(c.x, c.y, c.z);
    if (c.inner) { c.inner.rotation.x = 0.45 * f; c.inner.rotation.z = k.roll * f; }
    k.bub -= dt;
    if (k.bub <= 0 && f < 1) {
      k.bub = 0.07;
      emit(c.x + rnd(-1.2, 1.2), k.surf + 0.1, c.z + rnd(-1.2, 1.2), rnd(-0.3, 0.3), rnd(1.2, 2.4), rnd(-0.3, 0.3), 0xe6f4ff, rnd(0.12, 0.26), rnd(0.35, 0.6), 6);
    }
    if (k.t > SINK_T + 0.4 && !c.isPlayer) { removeCar(c); i--; }
  }
}
