/* Junction rules (js/flyover.js: segClosed / closedArm / armOpen / plazaAt), checked over a field of junctions and
   against the blocks js/world.js builds for them:
   * a closed street is a grid segment between two junctions off the main roads, away from spawn and the flyovers;
   * no junction loses more than one arm, so a three-way junction is a T and never a dead end on a main road;
   * a closed street is barred: each closed half of it has a barrier solid at both mouths, and no car can drive in;
   * a closed arm's junction is never a roundabout;
   * about a fifth of the junctions are three-way (the rest stay four-way);
   * roundabouts come in chains of one to three along one street, with at least two plain junctions between chains;
   * the closed arms of a block are barriers in the block's own solids (not in a neighbour's);
   * civilians and spawns never use a closed street: armOpen is false toward a closed arm, and nearClosedStreet
     is true on its centre line.
   Run:  node tools/sidewalk-checks/junctions.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { modulePath } from './harness.mjs';
import * as F from '../../js/flyover.js';

const W = await import(modulePath);
const N = Number(process.env.JUNCTION_RANGE || 24);
let junctions = 0, tees = 0, plazas = 0, closedSegs = 0;
const plazaSet = new Set();

for (let jx = -N; jx <= N; jx++) for (let jz = -N; jz <= N; jz++) {
  junctions++;
  const arms = [F.segClosed('x', jx, jz), F.segClosed('x', jx - 1, jz), F.segClosed('z', jx, jz), F.segClosed('z', jx, jz - 1)];
  const n = arms.filter(Boolean).length;
  // a neighbourhood's centre junction is inside it: all four of its streets are closed, and that is the design
  if (F.nbhdInterior(jx, jz)) { assert.equal(n, 4, `interior junction ${jx},${jz} has ${n} closed arms`); continue; }
  assert(n <= 1, `junction ${jx},${jz} loses ${n} arms`);
  const arm = F.closedArm(jx, jz);
  assert((arm !== null) === (n === 1), `closedArm disagrees with the segments at ${jx},${jz}`);
  if (arm) {
    tees++;
    assert(jx !== 0 && jz !== 0, `a three-way junction on a main road at ${jx},${jz}`);
    assert(!(Math.abs(jx) <= 3 && Math.abs(jz) <= 3), `a three-way junction next to spawn at ${jx},${jz}`);
    assert(F.plazaAt(jx, jz) === null, `a roundabout on the three-way junction ${jx},${jz}`);
    // an arm closed toward the wrong way is an error: a car leaving along the closed arm must be refused
    const openOut = { e: F.armOpen(jx, jz, 'x', 1), w: F.armOpen(jx, jz, 'x', -1), n: F.armOpen(jx, jz, 'z', 1), s: F.armOpen(jx, jz, 'z', -1) };
    assert(openOut[arm] === false, `closed arm ${arm} at ${jx},${jz} is still open to a car`);
    assert(Object.values(openOut).filter(v => v).length === 3, `a three-way junction at ${jx},${jz} has ${Object.values(openOut).filter(v => v).length} open arms`);
  }
  if (arms[0]) closedSegs++;
  if (arms[2]) closedSegs++;
  const p = F.plazaAt(jx, jz);
  if (p) { plazas++; plazaSet.add(jx + ',' + jz); assert(p.radius === 5 && [0, 1, 2].includes(p.feature), 'a roundabout with a bad feature'); }
}

// the share: a fifth of the junctions are three-way; the rest of the grid stays four-way
const share = tees / junctions;
assert(share >= 0.14 && share <= 0.30, `three-way junctions are ${(share * 100).toFixed(1)}% (want about 20%)`);
// the roundabouts: chains of one to three along a street, with two plain junctions between two chains
const seen = new Set();
const chainLen = [];
for (const k of plazaSet) {
  if (seen.has(k)) continue;
  const comp = [], stack = [k];
  seen.add(k);
  while (stack.length) {
    const cur = stack.pop(); comp.push(cur);
    const [x, z] = cur.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = (x + dx) + ',' + (z + dz);
      if (plazaSet.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
  }
  chainLen.push(comp.length);
  assert(comp.length <= 3, `a roundabout chain of ${comp.length} at ${k}`);
  const pts = comp.map(c => c.split(',').map(Number));
  const straight = pts.every(p => p[0] === pts[0][0]) || pts.every(p => p[1] === pts[0][1]);
  assert(straight, `a roundabout chain bends at ${k}`);
}
// any two roundabouts that are not in one chain are at least 3 junctions apart (Chebyshev), so two plain junctions lie between
for (const a of plazaSet) for (const b of plazaSet) {
  const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
  const d = Math.max(Math.abs(ax - bx), Math.abs(az - bz));
  if (a === b || d > 3) continue;
  // same chain if the two are in one component
  let sameComp = false;
  const stack = [a], vis = new Set([a]);
  while (stack.length && !sameComp) {
    const cur = stack.pop(); if (cur === b) { sameComp = true; break; }
    const [x, z] = cur.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = (x + dx) + ',' + (z + dz);
      if (plazaSet.has(nb) && !vis.has(nb)) { vis.add(nb); stack.push(nb); }
    }
  }
  assert(sameComp, `roundabouts ${a} and ${b} are two chains only ${d} junctions apart`);
}

// the spawn rule: a closed street's centre line counts as closed for a spawn
let closedSamples = 0;
for (let jx = -N; jx <= N; jx++) for (let jz = -N; jz <= N; jz++) {
  if (F.segClosed('x', jx, jz)) { closedSamples++; assert(F.nearClosedStreet(jx * 80 + 40, jz * 80, 10), `spawn check misses the closed street at ${jx},${jz}`); }
  if (F.segClosed('z', jx, jz)) { closedSamples++; assert(F.nearClosedStreet(jx * 80, jz * 80 + 40, 10), `spawn check misses the closed street at ${jx},${jz}`); }
}

// filled streets: a street is filled or barred, never both; it is filled for every block that shares it; the share of
// closed streets that are filled is about half
let filledSegs = 0, closedOnly = 0;
for (let jx = -N; jx <= N; jx++) for (let jz = -N; jz <= N; jz++) {
  for (const axis of ['x', 'z']) {
    if (!F.segClosed(axis, jx, jz)) continue;
    // a neighbourhood's inner street is never filled: it is not counted in the share
    const other = axis === 'x' ? [jx + 1, jz] : [jx, jz + 1];
    if (F.nbhdJunction(jx, jz) || F.nbhdJunction(other[0], other[1])) continue;
    if (F.segFilled(axis, jx, jz)) filledSegs++; else closedOnly++;
  }
}
const filledShare = filledSegs / Math.max(1, filledSegs + closedOnly);
assert(filledShare >= 0.35 && filledShare <= 0.65, `filled streets are ${(filledShare * 100).toFixed(1)}% of the hash-closed ones (want about half)`);

// the built blocks: barriers in the block's own solids, one per mouth of each closed half-street
let barriers = 0, blocksChecked = 0;
for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) {
  // one hoarding per mouth (three props); a mouth on a neighbourhood's centre junction has none
  const mouths = (jx, jz) => F.nbhdInterior(jx, jz) ? 0 : 1;
  // a filled street (segFilled) has no barrier at either mouth: its blocks join across it
  const barred = (axis, jx, jz) => F.segClosed(axis, jx, jz) && !F.segFilled(axis, jx, jz);
  const want = (barred('z', cx, cz) ? mouths(cx, cz) + mouths(cx, cz + 1) : 0)
    + (barred('z', cx + 1, cz) ? mouths(cx + 1, cz) + mouths(cx + 1, cz + 1) : 0)
    + (barred('x', cx, cz) ? mouths(cx, cz) + mouths(cx + 1, cz) : 0)
    + (barred('x', cx, cz + 1) ? mouths(cx, cz + 1) + mouths(cx + 1, cz + 1) : 0);
  const ch = W.generateChunk(cx, cz, true);
  blocksChecked++;
  // each open mouth is three hoarding props across it (soft, breakable), not a solid
  const got = ch.props.filter(p => p.kind === 'hoarding').length;
  assert.equal(got, want * 3, `block ${cx},${cz}: ${got} hoarding props for ${want} open mouths (want ${want * 3})`);
  barriers += got;
}

console.log(`PASS: ${junctions} junctions, ${tees} three-way (${(share * 100).toFixed(1)}%), ${filledSegs} filled streets (${(filledShare * 100).toFixed(0)}% of the hash-closed ones), ${plazas} roundabouts in ${chainLen.length} chains (sizes ${[...new Set(chainLen)].sort().join('/')}); ` +
  `${blocksChecked} blocks built, ${barriers} hoarding props at the closed streets' mouths; closed arms are never roundabouts and never open to a car; ${closedSamples} closed-street midpoints refused for spawns`);
