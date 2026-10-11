/* Industrial plants (buildFactoryMesh in js/factory.js, placed by generateChunk in js/world.js):
   * about FACTORY_SHARE of the ordinary blocks become a plant, and every one of the four layouts turns up;
   * a plant's solids (its buildings, stacks, tanks and containers) stand inside the block's effective bounds,
     so nothing reaches the pavement or the road;
   * a plant is the same every time its block is built (determinism).
   Run:  node tools/sidewalk-checks/factory.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { modulePath } from './harness.mjs';

const W = await import(modulePath);
const N = Number(process.env.FACTORY_RANGE || 12);
const CHUNK = 80, PAD_IN = 12;
const kinds = {};
let blocks = 0, plants = 0, solids = 0, pads = 0;

for (let cx = -N; cx < N; cx++) for (let cz = -N; cz < N; cz++) {
  const ch = W.generateChunk(cx, cz, true);
  blocks++;
  if (!ch.factory) continue;
  plants++;
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
  pads++;
}

assert(plants > 0, 'no plant in the field');
for (const k of ['brick', 'concrete', 'plant', 'complex']) assert(kinds[k], `layout ${k} never appears in ${blocks} blocks`);
const share = plants / blocks;
assert(share > 0.04 && share < 0.13, `plants are ${(share * 100).toFixed(1)}% of blocks`);

// determinism: the same block builds the same plant
for (let cx = -N; cx < N && cx < -N + 6; cx++) for (let cz = -N; cz < N && cz < -N + 6; cz++) {
  const a = W.generateChunk(cx, cz, true), b = W.generateChunk(cx, cz, true);
  assert.equal(a.factory, b.factory, `block ${cx},${cz} changes its plant between builds`);
}

console.log(`factories: ${plants} of ${blocks} blocks (${(share * 100).toFixed(1)}%), layouts ${JSON.stringify(kinds)}, ${solids} solids inside their blocks`);
console.log('FACTORY CHECKS PASSED');
