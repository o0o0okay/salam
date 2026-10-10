/* The solid index (solidsNear in js/world.js) must return exactly the solids the old scan over the 3x3 chunks
   returned, for every query the collision and AI code makes. The old scan is written out below as the reference.
   Covers: chunks streamed in one by one, parked cars shoved (their x/z move) and disabled, a parked car woken again.
   Run:  node tools/sidewalk-checks/solid-index.mjs      (exits non-zero on a mismatch) */
import { modulePath } from './harness.mjs';

const W = await import(modulePath);
const { updateChunks, chunks, nearChunks, solidsNear, solidAt } = W;

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// reference: the scan the game used before the index, over the 3x3 chunks around the point
const refPass = (x, z, reach) => {
  const out = new Set();
  for (const ch of nearChunks(x, z)) for (const s of ch.solids) if (Math.abs(s.x - x) <= s.hx + reach && Math.abs(s.z - z) <= s.hz + reach) out.add(s);
  return out;
};
const refSolidAt = (x, z, m, y) => {
  for (const ch of nearChunks(x, z)) for (const s of ch.solids) {
    if (s.maxY !== undefined && y > s.maxY) continue;
    if (Math.abs(x - s.x) < s.hx + m && Math.abs(z - s.z) < s.hz + m) return true;
  }
  return false;
};

let checks = 0, mismatches = 0;
const note = (what, x, z, r) => { mismatches++; if (mismatches <= 5) console.log(`  x ${what} at (${x.toFixed(1)}, ${z.toFixed(1)}) reach ${r}`); };
function compare(label, px, pz, R, n) {
  for (let i = 0; i < n; i++) {
    const x = px + (rnd() - 0.5) * 2 * R, z = pz + (rnd() - 0.5) * 2 * R;
    for (const reach of [0.5, 1.2, 2.5, 4, 7, 10, 13, 25]) {                // inside and beyond the index's own reach
      const want = refPass(x, z, reach), got = new Set();
      for (const s of solidsNear(x, z, reach)) if (Math.abs(s.x - x) <= s.hx + reach && Math.abs(s.z - z) <= s.hz + reach) got.add(s);
      checks++;
      let same = want.size === got.size; if (same) for (const s of want) if (!got.has(s)) { same = false; break; }
      if (!same) note(`${label}: solids within reach differ`, x, z, reach);
      const m = reach, y = rnd() * 6;
      checks++;
      if (refSolidAt(x, z, m, y) !== solidAt(x, z, m, y)) note(`${label}: solidAt differs`, x, z, m);
    }
  }
}

for (let step = 0; step < 6; step++) {                                      // streaming: the index catches up as chunks arrive
  updateChunks(step * 30, 0, 999);
  compare(`stream ${step}`, step * 30, 0, 60, 60);
}
const all = [...chunks.values()].flatMap(c => c.solids);
const parked = all.filter(s => s.parked);
for (const p of parked.slice(0, Math.floor(parked.length / 2))) { p.x += (rnd() - 0.5) * 6; p.z += (rnd() - 0.5) * 6; p.box.x = p.x; p.box.z = p.z; }
for (const s of all.filter(s => !s.parked).filter((_, i) => i % 9 === 0)) s.hx = s.hz = -999;   // felled trees and the like
for (const p of parked.slice(parked.length - 5)) p.hx = p.hz = -999;
compare('shoved and disabled', 0, 0, 90, 200);
const woken = parked.find(p => p.hx === -999);
if (woken) { woken.hx = woken.base ? woken.base.hx : 2; woken.hz = woken.base ? woken.base.hz : 2; }
compare('woken', 0, 0, 90, 100);

if (parked.length === 0) { console.log('  x no parked cars were generated: the moving-solid path was not exercised'); mismatches++; }
console.log(mismatches ? `SOLID INDEX: ${mismatches} MISMATCH(ES) in ${checks} checks` : `SOLID INDEX OK: ${checks} queries agree with the scan (${all.length} solids, ${parked.length} parked cars)`);
process.exit(mismatches ? 1 : 0);
