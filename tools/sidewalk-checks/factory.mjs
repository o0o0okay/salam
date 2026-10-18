/* Industrial plants (buildFactoryMesh in js/factory.js, placed by generateChunk in js/world.js):
   * plants stand only in the industrial and harbour districts (js/districts.js: the 'factory' entries of their block
     mixes are the only way a block becomes a plant), and about half of the industrial district's blocks are plants
     (its mix makes 45% of them 'factory', and the civic blocks that lose their place to a neighbour roll again, often
     onto a plant);
   * every one of the four layouts turns up;
   * a plant's solids (its buildings, stacks, tanks and containers) stand inside the block's effective bounds,
     so nothing reaches the pavement or the road;
   * a plant is the same every time its block is built (determinism).
   The scan covers the whole island (js/island.js, 50 x 50 blocks). The city centre, a disc round the spawn about 15 to
   21 blocks across, has no industry, so a square round the spawn finds no plant at all. (Before the districts, about
   FACTORY_SHARE, 8%, of all blocks became plants, spread everywhere; the game no longer reads that number.)
   Run:  node tools/sidewalk-checks/factory.mjs      (exits non-zero on a failure)
         FACTORY_RANGE=n   only the blocks within n of the spawn block (on the island) */
import assert from 'node:assert/strict';
import { modulePath } from './harness.mjs';

const W = await import(modulePath);
const RANGE = process.env.FACTORY_RANGE ? Number(process.env.FACTORY_RANGE) : Infinity;
const LO = Math.max(-W.ISLAND_R, -RANGE), HI = Math.min(W.ISLAND_R - 1, RANGE);   // the island's blocks are -ISLAND_R..ISLAND_R-1
const CHUNK = 80, PAD_IN = 12;
const kinds = {}, found = [];
let blocks = 0, plants = 0, solids = 0, industrial = 0, industrialPlants = 0;

for (let cx = LO; cx <= HI; cx++) for (let cz = LO; cz <= HI; cz++) {
  const ch = W.generateChunk(cx, cz, true);
  const district = W.districtOf(cx, cz);
  blocks++;
  if (district === 'industrial') industrial++;
  if (ch.factory) {
    plants++;
    found.push([cx, cz, ch.factory, JSON.stringify(ch.factorySolids.map(s => [s.x, s.z, s.hx, s.hz]))]);
    assert(district === 'industrial' || district === 'harbour', `factory ${cx},${cz}: a plant in the ${district} district`);
    if (district === 'industrial') industrialPlants++;
    kinds[ch.factory] = (kinds[ch.factory] || 0) + 1;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const lo = [x0 + PAD_IN, z0 + PAD_IN], hi = [x0 + CHUNK - PAD_IN, z0 + CHUNK - PAD_IN];
    for (const s of ch.factorySolids) {                  // the plant's own solids, not the block's barriers and trees
      solids++;
      const eps = 0.01;
      assert(s.x - s.hx >= lo[0] - eps && s.x + s.hx <= hi[0] + eps, `factory ${cx},${cz} (${ch.factory}): solid x ${s.x.toFixed(1)}±${s.hx} leaves the block`);
      assert(s.z - s.hz >= lo[1] - eps && s.z + s.hz <= hi[1] + eps, `factory ${cx},${cz} (${ch.factory}): solid z ${s.z.toFixed(1)}±${s.hz} leaves the block`);
    }
    assert(ch.stacks && ch.stacks.length >= 1, `factory ${cx},${cz} (${ch.factory}) has no chimney to smoke from`);
    for (const st of ch.stacks) {
      assert(st.top > 20, `factory ${cx},${cz}: stack top ${st.top.toFixed(1)} m is too low to read as a chimney`);
      assert(st.x > x0 + PAD_IN && st.x < x0 + CHUNK - PAD_IN && st.z > z0 + PAD_IN && st.z < z0 + CHUNK - PAD_IN, `factory ${cx},${cz}: stack outside the block`);
    }
  }
  W.disposeChunk(ch);                                    // 2500 blocks: each one goes once checked, or the heap runs out
}

assert(plants > 0, `no plant in ${blocks} blocks${RANGE < Infinity ? ' (widen FACTORY_RANGE)' : ''}`);
for (const k of ['brick', 'concrete', 'plant', 'complex']) assert(kinds[k], `layout ${k} never appears in ${blocks} blocks`);
// About half the industrial district: 499 plants in its 826 blocks (60%) on the island today.
const share = industrialPlants / Math.max(1, industrial);
if (industrial >= 40) assert(share > 0.4 && share < 0.72, `plants are ${(share * 100).toFixed(1)}% of the ${industrial} industrial blocks (want about half)`);

// determinism: the first 40 plants found build the same layout and the same solids again
for (const [cx, cz, kind, sig] of found.slice(0, 40)) {
  const again = W.generateChunk(cx, cz, true);
  assert.equal(again.factory, kind, `block ${cx},${cz} changes its plant between builds`);
  assert.equal(JSON.stringify(again.factorySolids.map(s => [s.x, s.z, s.hx, s.hz])), sig, `block ${cx},${cz}: the plant's solids change between builds`);
  W.disposeChunk(again);
}

console.log(`factories: ${plants} of ${blocks} blocks, all in the industrial and harbour districts (${(share * 100).toFixed(1)}% of the ${industrial} industrial blocks), layouts ${JSON.stringify(kinds)}, ${solids} solids inside their blocks`);
console.log('FACTORY CHECKS PASSED');
