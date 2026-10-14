/* The chunk registry: the `chunks` map, the nearby-chunk lookup and the plaza test.
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import { CHUNK } from './utils.js';
import { ck } from './utils.js';

export const chunks = new Map();
export const _near = [];
export function nearChunks(x, z) {
  _near.length = 0; const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = chunks.get(ck(cx + i, cz + j)); if (c) _near.push(c); }
  return _near;
}
// Returns the plaza entry if (x, z) is inside any plaza's island (the grass/curb disc), or null otherwise.
// Used by civilian AI to steer around plazas: regular cars go around the island, police and the player
// are allowed to drive through (the user wanted it to feel like a real roundabout — traffic gives it
// a wide berth unless it is chasing someone).
export function plazaIn(x, z) {
  const list = nearChunks(x, z);
  for (const ch of list) for (const p of ch.plazas) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < p.radius * p.radius) return p;
  }
  return null;
}
// Parks one more car in a free bay of this block and returns it, or null when the lot is full.
// Used at night to top malls up to their 2-3 car floor without regenerating the chunk.
