/* The interchange's own signage: the plated name on the bridge, the billboard on the deck and the gantry over
   each approach (built in js/world.js, one share per quarter). No browser, no WebGL, no network.

   What this proves, from the records the blocks write as they build — not from the code that writes them:

   * every flyover raises four nameplates (one per mouth: a half of the carriageway each), two billboards (one a
     bridge) and four gantry halves (a leg and half a beam each, meeting over the road's centre line);
   * each sign faces the traffic it is meant for: the plates and the gantry halves face back along the road the
     traffic approaches from, the billboard faces out across the street the bridge crosses (never at the road);
   * nothing of any of them intrudes on a lane: the plates hang below the deck's driving surface and outside the
     abutment, the billboard stands on the coping inside the parapet's own line, and the gantry's beam and panel
     stay within the structure's width, above the deck and clear of the other half's;
   * the bottom of a gantry sign is high enough for a car on the bridge to pass under (the deck's own traffic),
     and the panel never crosses the road's centre line into the other block's half;
   * the placement is deterministic: streaming a block back in gives the same records.

   node tools/sidewalk-checks/flyover-signs.mjs */

import assert from 'node:assert/strict';
import { modulePath } from './harness.mjs';

const W = await import(modulePath);
const F = W.FLY, PI = Math.PI, L = process.env.SIGNS_VERBOSE === '1';
// The coping's top: the parapet stands PH = 1.0 m on the deck's surface and its coping caps it by 0.12 m
// (js/world.js). FLY.parapet is the parapet's *thickness* across, not its height.
const COPING_TOP = F.deckH + 1.0 + 0.12;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
// The direction a sign faces, from its yaw alone (local +z turned by the yaw).
const face = r => [Math.sin(r.yaw), Math.cos(r.yaw)];

const NODES = [[0, 5], [0, -5], [5, 0], [-5, 0]];       // the first flyover each way out of the start junction
let nameplates = 0, billboards = 0, gantries = 0;
const seenFace = { plateAlong: new Set(), plateAcross: new Set(), boardAlong: new Set(), boardAway: new Set(), gantryAlong: new Set() };

for (const [ix, iz] of NODES) {
  const f = W.nodeAt(ix, iz);
  assert(f, `no flyover at ${ix},${iz}`);
  const counts = { nameplates: new Set(), billboards: new Set(), gantries: new Set() };
  for (const dx of [-1, 0]) for (const dz of [-1, 0]) {
    const ch = W.generateChunk(ix + dx, iz + dz, true);
    assert(ch.flyover, `block ${ix + dx},${iz + dz} raised nothing`);
    const key = (r, kind) => `${r.su},${r.sv}`;
    for (const r of ch.flyover.nameplates || []) {
      assert.equal(r.axis, f.axis); assert.equal(r.node, f.node);
      assert(!counts.nameplates.has(key(r)), 'two nameplates on one mouth'); counts.nameplates.add(key(r));
      // ---- the mouth: outside the abutment face, below the deck, above the hazard stripe ----
      const out = Math.abs(r.u) - F.deckHalf;
      assert(out > -0.06 && out < 1.5, `a nameplate hangs ${out.toFixed(2)} m out from the abutment face`);
      assert(r.base > 3.75 + 0.05, `a nameplate reaches down onto the hazard stripe (base ${r.base.toFixed(2)} m)`);
      assert(r.top < F.deckH - 0.2, `a nameplate reaches up to the deck (top ${r.top.toFixed(2)} m, deck ${F.deckH})`);
      assert(Math.abs(r.v) + r.w / 2 <= F.halfW + 1e-9, 'a nameplate leans out over the at-grade lane');
      assert(near(r.y, (r.base + r.top) / 2), 'nameplate record disagrees with itself about its height');
      // ---- and it faces the traffic that comes up the street towards the bridge ----
      const n = face(r);
      const lat = r.axis === 'z' ? n[0] : n[1], along = r.axis === 'z' ? n[1] : n[0];
      assert(Math.abs(lat) < 1e-9, `a nameplate is turned ${(lat * 90).toFixed(1)}° off the road it signs`);
      assert(near(along, Math.sign(r.u)), `a nameplate at u=${r.u} faces ${along}, not the approach it signs`);
      seenFace.plateAlong.add(Math.sign(r.u)); seenFace.plateAcross.add(Math.sign(r.v));
      nameplates++;
    }
    for (const r of ch.flyover.billboards || []) {
      assert.equal(r.axis, f.axis); assert.equal(r.node, f.node);
      assert(!counts.billboards.has(key(r)), 'two billboards on one deck half'); counts.billboards.add(key(r));
      // ---- it stands on the parapet's coping, within the structure's own width ----
      assert(near(r.mountY, COPING_TOP), `a billboard is mounted at ${r.mountY.toFixed(2)} m, not on the coping (${COPING_TOP.toFixed(2)})`);
      assert(r.base >= r.mountY - 1e-9, 'a billboard hangs below the coping it is bolted to');
      assert(Math.abs(r.v) + 0.13 <= F.halfW + 1e-9, `a billboard is ${Math.abs(r.v).toFixed(2)} m off the centre line — out past the parapet`);
      assert(Math.abs(r.u) + r.w / 2 <= F.deckHalf + 1e-9, 'a billboard overhangs the end of the deck');
      // ---- and it faces out across the street below, never along the road ----
      const n = face(r);
      const lat = r.axis === 'z' ? n[0] : n[1], along = r.axis === 'z' ? n[1] : n[0];
      assert(Math.abs(along) < 1e-9, `a billboard faces ${along} along the road instead of across the street`);
      assert(near(lat, Math.sign(r.v)), `a billboard faces ${lat}, not the street below on its own side`);
      seenFace.boardAlong.add(Math.sign(r.u)); seenFace.boardAway.add(Math.sign(r.v));
      billboards++;
    }
    for (const r of ch.flyover.gantries || []) {
      assert.equal(r.axis, f.axis); assert.equal(r.node, f.node);
      assert(!counts.gantries.has(key(r)), 'two gantries on one quarter'); counts.gantries.add(key(r));
      // ---- the leg stands on the coping; the beam and the panel stay inside the structure ----
      assert(near(r.base, COPING_TOP), `a gantry is based at ${r.base.toFixed(2)} m, not on the coping (${COPING_TOP.toFixed(2)})`);
      assert(r.legV >= F.halfW - F.parapet && r.legV <= F.halfW, 'a gantry leg does not stand on the parapet');
      assert(r.legV - 0.22 >= F.halfW - F.parapet, 'the gantry base plate leans into the lane past the parapet face');
      assert(!(r.spans[0] * r.spans[1] < 0), 'a gantry panel crosses the road centre line into the other block');
      assert(Math.abs(r.spans[0]) <= F.halfW - F.parapet + 1e-9 && Math.abs(r.spans[1]) <= 0.6, 'a gantry panel is not over its own half of the road');
      assert(Math.abs(r.spans[0]) - Math.abs(r.spans[1]) > 6, 'a gantry panel is too narrow to read');
      // ---- and the sign hangs under its beam, high enough for the deck's own traffic to pass ----
      assert(r.signTop < r.beamUnder + 1e-9, 'a gantry sign pokes through its own beam');
      assert(r.beamUnder - r.signTop < 0.2, 'a gantry sign floats away from its beam');
      assert(r.signBottom - r.deck >= 3.0 && r.signBottom - r.deck <= 5.5,
        `a gantry sign clears the deck by ${(r.signBottom - r.deck).toFixed(2)} m (want 3.0-5.5 m of headroom for the bridge traffic)`);
      const n = face(r);
      const lat = r.axis === 'z' ? n[0] : n[1], along = r.axis === 'z' ? n[1] : n[0];
      assert(Math.abs(lat) < 1e-9, `a gantry is turned ${(lat * 90).toFixed(1)}° off the road it signs`);
      assert(near(along, Math.sign(r.u)), `a gantry at u=${r.u} faces ${along} instead of the traffic climbing towards the deck`);
      seenFace.gantryAlong.add(Math.sign(r.u));
      gantries++;
    }
    // ---- and nothing stands in anything else's place: the billboard is set well back from the gantry leg ----
    for (const b of ch.flyover.billboards || []) for (const g of ch.flyover.gantries || []) {
      if (b.su !== g.su || b.sv !== g.sv) continue;
      const along = Math.abs(b.u - g.u);
      assert(along > b.w / 2 + 0.4, `a billboard stands only ${along.toFixed(2)} m from the gantry on the same quarter of the deck`);
    }
    // ---- streaming a block back in must give the same signs in the same places ----
    const again = W.generateChunk(ix + dx, iz + dz, true);
    assert.deepEqual(again.flyover.nameplates, ch.flyover.nameplates, 'nameplate placement changes when a block streams back in');
    assert.deepEqual(again.flyover.billboards, ch.flyover.billboards, 'billboard placement changes when a block streams back in');
    assert.deepEqual(again.flyover.gantries, ch.flyover.gantries, 'gantry placement changes when a block streams back in');
    if (L) for (const r of ch.flyover.nameplates || []) console.log(`  plate   ${r.axis}@${r.node} su${r.su} sv${r.sv} at (${r.x.toFixed(1)}, ${r.y.toFixed(2)}, ${r.z.toFixed(1)}) u=${r.u.toFixed(2)} v=${r.v.toFixed(2)} yaw=${(r.yaw * 180 / PI).toFixed(1)}°`);
    if (L) for (const r of ch.flyover.billboards || []) console.log(`  board   ${r.axis}@${r.node} su${r.su} sv${r.sv} at (${r.x.toFixed(1)}, ${r.y.toFixed(2)}, ${r.z.toFixed(1)}) u=${r.u.toFixed(2)} v=${r.v.toFixed(2)} yaw=${(r.yaw * 180 / PI).toFixed(1)}°`);
    if (L) for (const r of ch.flyover.gantries || []) console.log(`  gantry  ${r.axis}@${r.node} su${r.su} sv${r.sv} at (${r.x.toFixed(1)}, ${r.y.toFixed(2)}, ${r.z.toFixed(1)}) u=${r.u.toFixed(2)} v=${(r.legV * r.sv).toFixed(2)} yaw=${(r.yaw * 180 / PI).toFixed(1)}°`);
    W.disposeChunk(ch); W.disposeChunk(again);
  }
  assert.equal(counts.nameplates.size, 4, 'a bridge needs a nameplate at each of its four mouths');
  assert.equal(counts.billboards.size, 2, 'a bridge needs a billboard on each side of its deck');
  assert.equal(counts.gantries.size, 4, 'a bridge needs a gantry half at each quarter of the deck');
}

// Both approaches of both roads are signed, on both sides of the road, and both sides of the deck are billed.
for (const s of [1, -1]) {
  assert(seenFace.plateAlong.has(s) && seenFace.plateAcross.has(s), 'the nameplates do not cover both approaches on both sides');
  assert(seenFace.gantryAlong.has(s), 'the gantries do not cover both approaches');
}
// The billboards are one a bridge (the same half of both decks), and they face both sides of the street below.
assert(seenFace.boardAlong.size === 1 && seenFace.boardAway.size === 2, 'the billboards are not one a bridge, facing both sides of the street below');
// An ordinary four-way junction gains none of it.
const plain = W.generateChunk(0, 0, true);
for (const k of ['nameplates', 'billboards', 'gantries']) assert.equal((plain.flyover[k] || []).length, 0, `an ordinary intersection gained ${k}`);
W.disposeChunk(plain);
console.log(`PASS: ${nameplates} nameplates / ${billboards} billboards / ${gantries} gantry halves on both axes and both approaches — facing the traffic they are for, clear of every lane, deterministic when streamed back in`);
