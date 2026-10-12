/* Districts: regions of the city a few hundred metres across, so that driving from one into the next changes what the
 * player sees. A district is a kind of ground (old town, industrial, city centre, suburb) and sets the odds of each
 * block type (pickBlockType, used by typeSelection in js/world.js).
 *
 * THE MAP is a smooth field over the neighbourhood grid: the city is cut into cells of DIST_NB x DIST_NB blocks (the
 * same grid as the neighbourhoods, NB_BLOCKS in js/flyover.js), and each cell gets a value from smooth value noise (hashed
 * lattice values, interpolated). The value is cut into four bands at quantiles, so each district takes its share of the
 * city, and a smooth field gives each band as a few large connected regions instead of a random patchwork. Nothing is
 * stored: every chunk computes the same answer from the cell's index. The map is cut on whole cells, so a neighbourhood
 * (one cell of the grid) is always in one district. The spawn's surroundings are always the city centre.
 *
 * No imports except hash2: the test harness stitches this module in front of js/flyover.js, which imports it.
 */
import { hash2 } from './utils.js';

export const DIST_NB = 3, DIST_L = 12;                    // the cell size in blocks, and the noise's lattice spacing in cells (36 blocks, about 2.9 km)
export const DISTRICTS = ['old', 'industrial', 'centre', 'suburb'];
const SHARE = [0.25, 0.2, 0.25, 0.3];                     // the share of the city in each district, in DISTRICTS order (sums to 1)

const lattice = (i, j) => hash2(i * 2654 + 91, j * 1597 + 13) / 4294967296;
// Smooth value noise in [0, 1) at cell (u, v).
function field(u, v) {
  const i = Math.floor(u / DIST_L), j = Math.floor(v / DIST_L);
  const fu = u / DIST_L - i, fv = v / DIST_L - j;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const a = lattice(i, j), b = lattice(i + 1, j), c = lattice(i, j + 1), d = lattice(i + 1, j + 1);
  const top = a + (b - a) * su, bottom = c + (d - c) * su;
  return top + (bottom - top) * sv;
}
// The band edges: the quantiles of the field over a 240 x 240 cell sample, so each district's share is about SHARE.
const EDGES = (() => {
  const vals = [];
  for (let u = -120; u < 120; u++) for (let v = -120; v < 120; v++) vals.push(field(u, v));
  vals.sort((a, b) => a - b);
  const edges = []; let acc = 0;
  for (let k = 0; k < SHARE.length - 1; k++) { acc += SHARE[k]; edges.push(vals[Math.floor(acc * vals.length)]); }
  return edges;
})();

// The district of cell (u, v).
const distCache = new Map();
export function districtOfNb(u, v) {
  if (Math.abs(u) <= 1 && Math.abs(v) <= 1) return 'centre';   // the spawn and the blocks round it
  const key = u + ',' + v;
  if (distCache.has(key)) return distCache.get(key);
  const f = field(u, v);
  let k = 0;
  while (k < EDGES.length && f >= EDGES[k]) k++;
  const kind = DISTRICTS[k];
  distCache.set(key, kind);
  return kind;
}
// The district of block (cx, cz).
export function districtOf(cx, cz) {
  return districtOfNb(Math.floor(cx / DIST_NB), Math.floor(cz / DIST_NB));
}

// The block-type mix of each district: [type, upper limit of t] in order. The last entry takes whatever is left.
const MIX = {
  old:        [['downtown', 0.45], ['bazaar', 0.6], ['shops', 0.75], ['bank', 0.8], ['park', 0.87], ['commercial', 1]],
  industrial: [['factory', 0.45], ['industrial', 0.75], ['fuel', 0.85], ['fire', 0.9], ['shops', 0.95], ['park', 1]],
  centre:     [['downtown', 0.42], ['commercial', 0.62], ['bank', 0.72], ['shops', 0.8], ['park', 0.87], ['hospital', 0.91], ['downtown', 1]],
  suburb:     [['suburb', 0.62], ['park', 0.8], ['school', 0.87], ['shops', 0.94], ['fuel', 1]],
};
// The block type for a roll t in [0, 1) in a district.
export function pickBlockType(district, t) {
  const mix = MIX[district];
  for (const [type, lim] of mix) if (t < lim) return type;
  return mix[mix.length - 1][0];
}
