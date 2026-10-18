/* Solid queries: solidAt and solidsNear over the per-chunk grid index of static solids.
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import { CHUNK } from './utils.js';
import { ck } from './utils.js';
import { chunks } from './chunkState.js';

export const _probeSolids = [];                                     // solidAt() never nests, so one scratch list is enough
// `skipRamp` leaves out a flyover's ramp slices: a car that is riding the structure's surface reads those as the road.
// `height` is the asking car's own height (vehicle.js): a roof (a solid with `headroom`, a construction frame's first floor
// over its open ground floor) is solid only for a car too tall to pass under it. Asked without one, the roof is open.
export function solidAt(x, z, m, y = 0, skipRamp = false, height = 0) {
  for (const s of solidsNear(x, z, m, _probeSolids)) {
    if (s.maxY !== undefined && y > s.maxY) continue;
    if (s.headroom !== undefined && y + height <= s.headroom) continue;
    if (skipRamp && s.ramp) continue;
    if (Math.abs(x - s.x) < s.hx + m && Math.abs(z - s.z) < s.hz + m) return true;
  }
  return false;
}
// ---- solid index --------------------------------------------------------------------------------------------
// The collision and AI queries used to scan every solid of the 3x3 chunks around them (about 260-290 entries a
// query, most of them street trees). Each chunk now keeps its static solids in a grid of GRID_CELL-metre cells.
// A solid goes into every cell its footprint grown by GRID_PAD reaches, so a query for a point with a reach of
// up to GRID_PAD only reads the one cell that holds the point. Parked cars are the only solids that move (a shove
// changes x/z) and they come back when woken, so they sit in a short per-chunk list that is always read live.
// Solids disabled with hx = hz = -999 are still returned where they are indexed: every caller checks the live
// extents, so the index never has to follow them. Chunks are generated whole before anything queries them, and
// ch.solids is only ever appended to, so the index catches up by counting entries (ch.gridN).
export const GRID_CELL = 10, GRID_PAD = 10;
export const cellKey = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
export function indexChunk(ch) {
  if (!ch.grid) { ch.grid = new Map(); ch.gridN = 0; ch.movers = []; }
  const S = ch.solids;
  for (; ch.gridN < S.length; ch.gridN++) {
    const s = S[ch.gridN];
    if (s.parked) { ch.movers.push(s); continue; }
    if (!(s.hx >= 0 && s.hz >= 0)) continue;                 // disabled for good (a felled tree, a burst pickup)
    const x0 = Math.floor((s.x - s.hx - GRID_PAD) / GRID_CELL), x1 = Math.floor((s.x + s.hx + GRID_PAD) / GRID_CELL);
    const z0 = Math.floor((s.z - s.hz - GRID_PAD) / GRID_CELL), z1 = Math.floor((s.z + s.hz + GRID_PAD) / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = cellKey(ix, iz);
      let cell = ch.grid.get(k);
      if (!cell) ch.grid.set(k, cell = []);
      cell.push(s);
    }
  }
}
// Every solid that could be within `reach` metres of (x, z), from the 3x3 chunks nearChunks() would scan. Callers
// still apply their own test to each one. Fills `out` (cleared first) and returns it. A caller that loops over the
// list while another query runs must give that query its own list: collideSolids() does, see collisions.js.
export function solidsNear(x, z, reach, out = []) {
  out.length = 0;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const wide = !(reach <= GRID_PAD);                         // also true for NaN: fall back to the full scan
  const k = cellKey(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const ch = chunks.get(ck(cx + i, cz + j));
    if (!ch) continue;
    indexChunk(ch);
    if (wide) { for (const s of ch.solids) out.push(s); continue; }
    const cell = ch.grid.get(k);
    if (cell) for (const s of cell) out.push(s);
    for (const s of ch.movers) out.push(s);
  }
  return out;
}
