/* Splitter-nose guard placement/streaming checks. No browser or network required. */
import assert from 'node:assert/strict';
import { modulePath } from './harness.mjs';
const W = await import(modulePath);
let guards = 0, posts = 0;
for (const [ix, iz] of [[0, 5], [0, -5], [5, 0], [-5, 0]]) {
  const f = W.nodeAt(ix, iz), seen = new Set();
  for (const dx of [-1, 0]) for (const dz of [-1, 0]) {
    const ch = W.generateChunk(ix + dx, iz + dz, true);
    const records = ch.flyover.guards || [];
    for (const g of records) {
      assert.equal(g.axis, f.axis); assert.equal(g.node, f.node);
      const key = `${g.su},${g.sv}`;
      assert(!seen.has(key), 'duplicate nose guard'); seen.add(key);
      assert(Math.abs(g.u) - g.radius > W.FLY.rampEnd, 'drum overlaps the ramp foot');
      assert(Math.abs(g.v) + g.radius <= W.FLY.halfW, 'drum intrudes into at-grade road');
      assert(Math.abs(g.v) - g.radius > 6, 'drum blocks the central ramp lanes');
      const out = f.axis === 'z' ? Math.cos(g.heading) : Math.sin(g.heading);
      assert(Math.abs(out - g.su) < 1e-8, 'sign faces away from approaching traffic');
      assert(ch.solids.some(s => s.kind === 'flyover-guard' && s.x === g.x && s.z === g.z && s.maxY === 1.15), 'missing drum collider');
      assert.equal(g.posts.length, 3);
      for (const p of g.posts) {
        assert(Math.abs(p.u) > Math.abs(g.u) + g.radius, 'post overlaps drum');
        // Across the avenue the neighbouring junction's crosswalk is 12.90625 m off its centre.
        assert(Math.abs(p.u) + 0.21 < W.CHUNK - (8 + W.FLY.chamfer + 0.90625) - 0.625, 'post reaches pedestrian crossing');
        assert(Math.abs(g.v) + 0.21 < W.FLY.halfW, 'post blocks side road');
        assert(ch.props.some(q => q.kind === 'delineator' && q.x === p.x && q.z === p.z && q.drag === 0.99 && !q.broken), 'missing breakable post');
        posts++;
      }
      guards++;
    }
    const regenerated = W.generateChunk(ix + dx, iz + dz, true);
    assert.deepEqual(regenerated.flyover.guards, ch.flyover.guards, 'nose positions change when streamed back in');
    W.disposeChunk(ch); W.disposeChunk(regenerated);
  }
  assert.equal(seen.size, 4, 'each flyover needs both noses on both approaches');
}
const ordinary = W.generateChunk(0, 0, true);
assert.equal((ordinary.flyover.guards || []).length, 0, 'ordinary intersection gained a nose guard');
W.disposeChunk(ordinary);
console.log(`PASS: ${guards} guards / ${posts} breakable posts; mirrored axes, approach-facing signs, clear lanes/crossings, deterministic streaming`);
