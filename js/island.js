/* The island. The city is not an endless plain: it is one square of blocks, an island in the sea.
 *
 * The island is the chunks cx, cz in [-ISLAND_R, ISLAND_R - 1] (50 blocks, 4 km across), so its coasts are at
 * x = ISLAND_MIN and x = ISLAND_MAX (and the same in z). Chunks outside it are never built. Beyond the coast there is
 * only the sea (js/world.js, ensureSea), and the coast is a seawall (js/world.js, seaWall).
 *
 * The streets stop short of the coast: a street is open only when both of its ends are in the core, the junctions
 * -CORE..CORE. So the outermost streets are the ones at index ±CORE (the block's own side), and nothing — no street,
 * flyover, plaza or estate — reaches the coast line itself. Used by flyover.js (segClosed, nodeBlock, plazaEligible,
 * nbhdBase) and by the spawns (police.js, civilians.js) so that nothing is put in the sea.
 */
import { CHUNK } from './utils.js';

export const ISLAND_R = 25;                                  // chunks from the centre to each coast
export const ISLAND_MIN = -ISLAND_R * CHUNK, ISLAND_MAX = ISLAND_R * CHUNK;   // -2000 and 2000 (metres)
export const CORE = ISLAND_R - 1;                            // the streets' limit: junction indices -CORE..CORE

// Is the block (cx, cz) on the island?
export function inIslandChunk(cx, cz) {
  return cx >= -ISLAND_R && cx < ISLAND_R && cz >= -ISLAND_R && cz < ISLAND_R;
}
// Is the point (x, z) on the island, at least `margin` metres in from the coast?
export function onIsland(x, z, margin = 0) {
  return x >= ISLAND_MIN + margin && x <= ISLAND_MAX - margin && z >= ISLAND_MIN + margin && z <= ISLAND_MAX - margin;
}
// Is the street segment (axis, jx, jz) on the core? A z-street runs from junction jz to jz + 1 along x = jx * CHUNK;
// an x-street runs from junction jx to jx + 1 along z = jz * CHUNK.
export function segInCore(axis, jx, jz) {
  if (axis === 'z') return Math.abs(jx) <= CORE && jz >= -CORE && jz + 1 <= CORE;
  return Math.abs(jz) <= CORE && jx >= -CORE && jx + 1 <= CORE;
}
