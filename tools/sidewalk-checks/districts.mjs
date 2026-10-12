/* Districts (js/districts.js): the map and the block mix. Run without a browser, on the real modules.
 *   node tools/sidewalk-checks/districts.mjs     (exits non-zero on a failure)
 * Checks: the map is deterministic; all four districts show up in a window of the city; each district is mostly one
 * region (its largest piece holds most of its cells); each district's block types are the ones it declares, in the
 * declared shares; the spawn is in the centre; and a neighbourhood (an estate) only ever stands in a suburb. */
import { districtOf, districtOfNb, pickBlockType, DISTRICTS, DIST_NB } from '../../js/districts.js';
import { nbhdOf } from '../../js/flyover.js';

let failed = false;
const bad = msg => { failed = true; console.log('FAIL: ' + msg); };

// 1. deterministic: the same answer from a fresh look-up, and from a block of the same cell.
const W = 40, U0 = -20;                                      // a window of 40 x 40 cells (120 x 120 blocks, 4.8 km)
const grid = new Map();
for (let u = U0; u < U0 + W; u++) for (let v = U0; v < U0 + W; v++) grid.set(u + ',' + v, districtOfNb(u, v));
for (let u = U0; u < U0 + W; u++) for (let v = U0; v < U0 + W; v++) {
  if (districtOfNb(u, v) !== grid.get(u + ',' + v)) { bad(`cell ${u},${v} changes its answer`); break; }
}
for (let cx = -30; cx < 30; cx++) if (districtOf(cx, 7) !== districtOfNb(Math.floor(cx / DIST_NB), Math.floor(7 / DIST_NB))) { bad('districtOf is not the district of its cell'); break; }

// 2. all four districts, each a real share of the window, and mostly one region.
const count = {}, seen = {};
for (const d of DISTRICTS) count[d] = 0;
for (const [, d] of grid) count[d] = (count[d] || 0) + 1;
const total = W * W;
for (const d of DISTRICTS) {
  if (!count[d] || count[d] / total < 0.06) bad(`district ${d} covers ${count[d] || 0} of ${total} cells (want at least 6%)`);
}
// The largest 4-connected piece of each district, as a share of its cells.
const seenCell = new Set();
const report = [];
for (const d of DISTRICTS) {
  let best = 0, cells = 0;
  for (const [key, kind] of grid) {
    if (kind !== d || seenCell.has(key)) continue;
    let size = 0; const stack = [key];
    seenCell.add(key);
    while (stack.length) {
      const [u, v] = stack.pop().split(',').map(Number); size++;
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k2 = (u + du) + ',' + (v + dv);
        if (grid.get(k2) === d && !seenCell.has(k2)) { seenCell.add(k2); stack.push(k2); }
      }
    }
    best = Math.max(best, size); cells += size;
  }
  if (cells) report.push(`${d}: ${cells} cells, largest piece ${(100 * best / cells).toFixed(0)}%`);
  if (cells && best / cells < 0.6) bad(`district ${d} is split into many pieces (largest holds ${(100 * best / cells).toFixed(0)}%)`);
}

// 3. the block mix: only the declared types, in the declared shares (a fine grid of rolls).
const want = {
  old: { downtown: 0.6, shops: 0.15, bank: 0.05, park: 0.07, commercial: 0.13 },
  industrial: { factory: 0.45, industrial: 0.3, fuel: 0.1, fire: 0.05, shops: 0.05, park: 0.05 },
  centre: { downtown: 0.51, commercial: 0.2, bank: 0.1, shops: 0.08, park: 0.07, hospital: 0.04 },
  suburb: { suburb: 0.62, park: 0.18, school: 0.07, shops: 0.07, fuel: 0.06 },
};
const shares = [];
for (const d of DISTRICTS) {
  const got = {}, N = 20000;
  for (let i = 0; i < N; i++) { const ty = pickBlockType(d, (i + 0.5) / N); got[ty] = (got[ty] || 0) + 1; }
  for (const ty of Object.keys(got)) if (!(ty in want[d])) bad(`${d} makes ${ty} blocks, which it does not declare`);
  for (const [ty, sh] of Object.entries(want[d])) {
    const g = (got[ty] || 0) / N;
    if (Math.abs(g - sh) > 0.01) bad(`${d}: ${ty} is ${(100 * g).toFixed(1)}% of blocks, want ${(100 * sh).toFixed(0)}%`);
  }
  shares.push(`${d}: ` + Object.entries(got).map(([ty, n]) => `${ty} ${(100 * n / N).toFixed(0)}%`).join(', '));
}

// 4. the start is in the city centre.
if (districtOf(0, 0) !== 'centre') bad(`the spawn block is in ${districtOf(0, 0)}, not the centre`);

// 5. estates (neighbourhoods) only in suburbs.
let estates = 0, outside = 0;
for (let RX = -15; RX <= 15; RX++) for (let RZ = -15; RZ <= 15; RZ++) {
  if (!nbhdOf(RX, RZ)) continue;
  estates++;
  if (districtOfNb(RX, RZ) !== 'suburb') outside++;
}
if (outside) bad(`${outside} estate(s) stand outside a suburb`);
if (!estates) bad('no estate in the window at all: the suburb rule has taken them all');

console.log('districts in the window: ' + report.join('; '));
console.log('block mix: ' + shares.join(' | '));
console.log(`estates in a 31 x 31 window: ${estates}, all in suburbs: ${!outside}`);
if (failed) { console.log('DISTRICTS FAILED'); process.exit(1); }
console.log('DISTRICTS OK');
