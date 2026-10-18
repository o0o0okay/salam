/* Junction rules (js/flyover.js: segClosed / closedArm / armOpen / plazaAt), checked over a field of junctions and
   against the blocks js/world.js builds for them:
   * a closed street is a grid segment between two junctions off the main roads, away from spawn and the flyovers;
   * the coast and the river take arms by design (js/island.js, riverSeg in js/flyover.js): a junction on the coast
     line (index ±CORE) loses its arm to the sea, two at a corner, and a junction on the river row loses its two arms
     along the water (the street across it is a bridge);
   * the closing rule takes at most one arm from a junction, and none from a junction on the coast or the river, so a
     three-way junction is a T, never an L or a dead end, and every bridge carries a through street. (A neighbourhood's
     inner streets are closed for good, js/flyover.js nbhdInternalSeg: one that ends on the coast leaves a straight
     along the coast street there, by design; listed, not failed);
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
import { CORE, segInCore } from '../../js/island.js';

const W = await import(modulePath);
const N = Number(process.env.JUNCTION_RANGE || CORE);           // the island's junctions are -CORE..CORE
let junctions = 0, tees = 0, plazas = 0, closedSegs = 0, coastJ = 0, riverJ = 0;
const plazaSet = new Set();
const nbCoast = [];                                             // coast junctions where a neighbourhood's inner street ends

for (let jx = -N; jx <= N; jx++) for (let jz = -N; jz <= N; jz++) {
  junctions++;
  const segs = [['x', jx, jz], ['x', jx - 1, jz], ['z', jx, jz], ['z', jx, jz - 1]];
  const arms = segs.map(s => F.segClosed(...s));
  const n = arms.filter(Boolean).length;
  // a neighbourhood's centre junction is inside it: all four of its streets are closed, and that is the design
  if (F.nbhdInterior(jx, jz)) { assert.equal(n, 4, `interior junction ${jx},${jz} has ${n} closed arms`); continue; }
  // the arms the coast and the river take (always closed), and the ones the closing rule takes
  const sea = segs.map(s => !segInCore(...s)), water = segs.map(s => F.riverSeg(...s));
  sea.forEach((s, i) => assert(!s || arms[i], `junction ${jx},${jz}: a street runs out to the sea`));
  water.forEach((w, i) => assert(!w || arms[i], `junction ${jx},${jz}: a street runs along the river`));
  const nFixed = segs.filter((s, i) => sea[i] || water[i]).length;
  const ruled = arms.filter((c, i) => c && !sea[i] && !water[i]).length;
  // of those, the ones the hash rule closes (the rest are a neighbourhood's inner streets)
  const hashed = arms.filter((c, i) => c && !sea[i] && !water[i] && !F.nbhdInternalSeg(...segs[i])).length;
  if (Math.abs(jx) === CORE || Math.abs(jz) === CORE) { coastJ++; assert(sea.filter(Boolean).length === (Math.abs(jx) === CORE && Math.abs(jz) === CORE ? 2 : 1), `coast junction ${jx},${jz} keeps an arm to the sea`); }
  if (jz === F.RIVER_ROW) { riverJ++; assert(water[0] && water[1] && !water[2] && !water[3], `river junction ${jx},${jz}: the water takes the wrong arms`); }
  assert(ruled <= 1, `junction ${jx},${jz} loses ${ruled} arms to the closing rule`);
  assert(!(water[0] && ruled), `river junction ${jx},${jz}: the bridge ends in a closed street`);
  assert(!(nFixed && hashed), `coast junction ${jx},${jz}: the closing rule takes an arm there as well`);
  if (nFixed && ruled) nbCoast.push(`${jx},${jz}`);
  assert(n <= 2, `junction ${jx},${jz} is a dead end (${n} arms closed)`);
  const arm = F.closedArm(jx, jz);
  assert((arm !== null) === (n >= 1), `closedArm disagrees with the segments at ${jx},${jz}`);
  if (arm) {
    const openOut = { e: F.armOpen(jx, jz, 'x', 1), w: F.armOpen(jx, jz, 'x', -1), n: F.armOpen(jx, jz, 'z', 1), s: F.armOpen(jx, jz, 'z', -1) };
    assert(openOut[arm] === false, `closed arm ${arm} at ${jx},${jz} is still open to a car`);
    assert(Object.values(openOut).filter(v => v).length === 4 - n, `junction ${jx},${jz} has ${Object.values(openOut).filter(v => v).length} open arms with ${n} closed`);
  }
  if (ruled) {
    tees++;
    assert(jx !== 0 && jz !== 0, `a three-way junction on a main road at ${jx},${jz}`);
    assert(!(Math.abs(jx) <= 3 && Math.abs(jz) <= 3), `a three-way junction next to spawn at ${jx},${jz}`);
  }
  if (arm) assert(F.plazaAt(jx, jz) === null, `a roundabout on the junction ${jx},${jz}, which has a closed arm`);
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
let barriers = 0, blocksChecked = 0, cranesChecked = 0, pickupsChecked = 0, machinesChecked = 0;
for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) {
  // one barricade per mouth (three props); a mouth on a neighbourhood's centre junction has none
  const mouths = (jx, jz) => F.nbhdInterior(jx, jz) ? 0 : 1;
  // a filled street (segFilled) has no barrier at either mouth: its blocks join across it; the river is water, not a
  // barred street
  const barred = (axis, jx, jz) => F.segClosed(axis, jx, jz) && !F.segFilled(axis, jx, jz) && !F.riverSeg(axis, jx, jz);
  const want = (barred('z', cx, cz) ? mouths(cx, cz) + mouths(cx, cz + 1) : 0)
    + (barred('z', cx + 1, cz) ? mouths(cx + 1, cz) + mouths(cx + 1, cz + 1) : 0)
    + (barred('x', cx, cz) ? mouths(cx, cz) + mouths(cx + 1, cz) : 0)
    + (barred('x', cx, cz + 1) ? mouths(cx, cz + 1) + mouths(cx + 1, cz + 1) : 0);
  const ch = W.generateChunk(cx, cz, true);
  blocksChecked++;
  // each open mouth is three barricade props across it (soft, breakable), not a solid
  const got = ch.props.filter(p => p.kind === 'barricade').length;
  assert.equal(got, want * 3, `block ${cx},${cz}: ${got} barricade props for ${want} open mouths (want ${want * 3})`);
  barriers += got;
  // no pickup (cash, repair, nitro) inside a construction site's frame or crane base, here or on the block next door
  const inSite = (x, z) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of W.siteSpots(cx + i, cz + j)) if (Math.abs(x - b.x) < b.hx + 1.5 && Math.abs(z - b.z) < b.hz + 1.5) return true; return false; };
  for (const pk of ch.pickups) assert(!inSite(pk.x, pk.z), `block ${cx},${cz}: a ${pk.kind} pickup at ${pk.x.toFixed(1)},${pk.z.toFixed(1)} is inside a construction site`);
  // nor on the river, between its bank walls (8.25 m either side of its line), where no car can reach it
  for (const pk of ch.pickups) assert(Math.abs(pk.z - F.RIVER_ROW * W.CHUNK) >= 8.8, `block ${cx},${cz}: a ${pk.kind} pickup at ${pk.x.toFixed(1)},${pk.z.toFixed(1)} is on the river`);
  pickupsChecked += ch.pickups.length;
  // each construction site has one or two parked machines (never more, never fewer)
  const frames = W.siteSpots(cx, cz).filter(b => b.hz === 14 || b.hx === 14).length;
  const machines = ch.solids.filter(q => q.machine !== undefined).length;
  assert(machines >= frames && machines <= 2 * frames, `block ${cx},${cz}: ${machines} machines for ${frames} sites (want one or two each)`);
  machinesChecked += machines;
  // a machine stands clear of everything else in its block: no solid of the site or the street overlaps its footprint
  for (const mc of ch.solids.filter(q => q.machine !== undefined)) {
    for (const o of ch.solids) {
      if (o === mc || o.hx === undefined || o.hz === undefined) continue;
      const overlap = Math.abs(o.x - mc.x) < o.hx + mc.hx - 0.05 && Math.abs(o.z - mc.z) < o.hz + mc.hz - 0.05;
      assert(!overlap, `block ${cx},${cz}: ${mc.machine === 1 ? 'mixer' : 'machine ' + mc.machine} at ${mc.x.toFixed(1)},${mc.z.toFixed(1)} overlaps a ${o.kind} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`);
    }
  }
  // a tower crane's base is solid: each barred, unfilled, non-neighbourhood street holds two frames side by side, one
  // on each block's half of it, and the block east or north of the street (its west street, its south street) builds
  // the crane between them (CRANE in js/sites.js): a CRANE.half square solid on the street's centre line, which is this
  // block's edge, level with the middle of the frames. It stands between the two frames (this block's and the one
  // across the line, built next door) and overlaps neither, so the lane under each stays open
  const x0 = cx * W.CHUNK, z0 = cz * W.CHUNK, CR = W.CRANE;
  const siteFree = (a, b) => !F.nbhdJunction(a[0], a[1]) && !F.nbhdJunction(b[0], b[1]);
  const cranes = [
    [barred('z', cx, cz) && !F.segFilled('z', cx, cz) && siteFree([cx, cz], [cx, cz + 1]), x0 + 4 + CR.ac, z0 + 30 + CR.al, 'z', [cx - 1, cz]],
    [barred('x', cx, cz) && !F.segFilled('x', cx, cz) && siteFree([cx, cz], [cx + 1, cz]), x0 + 30 + CR.al, z0 + 4 + CR.ac, 'x', [cx, cz - 1]],
  ];
  for (const [on, bx, bz, axis, [ox, oz]] of cranes) {
    if (!on) continue;
    const base = ch.solids.find(q => q.kind === 'building' && q.hx === CR.half && q.hz === CR.half && Math.abs(q.x - bx) < 1e-6 && Math.abs(q.z - bz) < 1e-6);
    assert(base, `block ${cx},${cz}: crane base at ${bx},${bz} is not solid`);
    assert(axis === 'z' ? bx === x0 : bz === z0, `block ${cx},${cz}: the crane at ${bx},${bz} is not on the street's centre line`);
    const pair = [...W.siteSpots(cx, cz), ...W.siteSpots(ox, oz)].filter(s => Math.max(s.hx, s.hz) === 14 && Math.abs(s.x - bx) < 8 && Math.abs(s.z - bz) < 16);
    assert.equal(pair.length, 2, `block ${cx},${cz}: the crane at ${bx},${bz} has ${pair.length} frames beside it (want the street's two)`);
    const sides = pair.map(fr => Math.sign(axis === 'z' ? fr.x - bx : fr.z - bz));
    assert(sides[0] * sides[1] === -1, `block ${cx},${cz}: the crane at ${bx},${bz} is not between the street's two frames`);
    for (const fr of pair) {
      const clear = Math.abs(fr.x - bx) >= fr.hx + CR.half || Math.abs(fr.z - bz) >= fr.hz + CR.half;
      assert(clear, `block ${cx},${cz}: the crane base at ${bx},${bz} overlaps the frame at ${fr.x},${fr.z}`);
    }
    cranesChecked++;
  }
}

// The coast (js/island.js). The street on the coast line has the sea on its far side, and it is always filled
// (coastLineSeg and segFilled in js/flyover.js): the strip along the sea is a small park behind the seawall, never a
// building site. On all four coasts, every block on them: the strip is filled, and nothing of a site stands on it
// (siteSpots has nothing there, and the block's own solids in it include no frame, column, brick, crane base or
// machine). No barricade stands across it. Its park is there: four trees and two benches at their places, 1.5 m
// further in than on a street inland. Every solid in the strip (a tree by its 0.65 m soil bed) and every prop (by
// its radius) stands clear of the 3 m seawall (seaWall in js/world.js).
let coastStrips = 0, coastTrees = 0, coastProps = 0;
const IR = W.ISLAND_R, C = W.CHUNK, WALL = 3;
for (let k = -IR; k < IR; k++) for (const [cx, cz, side] of [[-IR, k, 0], [IR - 1, k, 1], [k, -IR, 2], [k, IR - 1, 3]]) {
  const seg = [['z', cx, cz], ['z', cx + 1, cz], ['x', cx, cz], ['x', cx, cz + 1]][side];
  const at = `block ${cx},${cz}, the coast street ${seg.join(' ')}`;
  assert(F.coastLineSeg(...seg), `${at}: not taken for the coast line`);
  assert(F.segFilled(...seg), `${at}: not filled`);
  const x0 = cx * C, z0 = cz * C;
  // metres in from the coast, and along the block from its lower corner; the strip is the street's half and the
  // walkway, 12.6 m, the whole block long
  const inn = (x, z) => side === 0 ? x - x0 : side === 1 ? x0 + C - x : side === 2 ? z - z0 : z0 + C - z;
  const along = (x, z) => side < 2 ? z - z0 : x - x0;
  const inStrip = (x, z) => inn(x, z) < 12.6;
  const where = q => `${q.x.toFixed(1)},${q.z.toFixed(1)}`;
  for (const s of W.siteSpots(cx, cz)) assert(!inStrip(s.x, s.z), `${at}: a construction site at ${where(s)}`);
  const ch = W.generateChunk(cx, cz, true);
  const wall = ch.solids.filter(q => q.kind === 'building' && Math.min(q.hx, q.hz) === WALL / 2 && Math.max(q.hx, q.hz) === C / 2 && Math.abs(inn(q.x, q.z) - WALL / 2) < 1e-6);
  assert.equal(wall.length, 1, `${at}: ${wall.length} seawalls on the coast side`);
  for (const q of ch.solids) {
    if (q === wall[0] || q.hx === undefined || !inStrip(q.x, q.z)) continue;
    const site = q.headroom !== undefined ? 'frame' : q.machine !== undefined ? 'site machine' : q.kind === 'building' ? 'frame column, brick or crane base' : null;
    assert(!site, `${at}: a ${site} at ${where(q)} on the strip`);
    const depth = inn(q.x, q.z) - (side < 2 ? q.hx : q.hz);
    assert(depth >= WALL - 1e-6, `${at}: a ${q.kind} at ${where(q)} stands in the seawall (its edge ${depth.toFixed(2)} m in)`);
    if (q.kind === 'tree') coastTrees++;
  }
  for (const p of ch.props) {
    if (!inStrip(p.x, p.z)) continue;
    const a = along(p.x, p.z);
    assert(p.kind !== 'barricade' || a < 8 || a > C - 8, `${at}: a barricade across the strip at ${where(p)}`);
    assert(inn(p.x, p.z) - p.r >= WALL - 1e-6, `${at}: a ${p.kind} at ${where(p)} stands in the seawall`);
    coastProps++;
  }
  // the park: its trees 4.92 and 10.68 m in, its benches 5.16 and 10.44 m in (parkPlot in js/world.js)
  const near = (q, i, a) => Math.abs(inn(q.x, q.z) - i) < 0.01 && Math.abs(along(q.x, q.z) - a) < 0.01;
  const flip = side % 2 === 1;   // east and north: the plot's cross axis runs toward the coast
  const wantT = [[-0.6, 20], [0.6, 34], [-0.6, 48], [0.6, 62]], wantB = [[0.55, 27], [-0.55, 54]];
  const inOf = kk => 7.8 + (flip ? -kk : kk) * 4.8;
  for (const [kk, a] of wantT) assert(ch.trees.some(t => near(t, inOf(kk), a)), `${at}: no park tree ${inOf(kk).toFixed(2)} m in at ${a}`);
  for (const [kk, a] of wantB) assert(ch.props.some(p => p.kind === 'bench' && near(p, inOf(kk), a)), `${at}: no park bench ${inOf(kk).toFixed(2)} m in at ${a}`);
  coastStrips++;
  W.disposeChunk(ch);
}
assert.equal(coastStrips, 8 * IR, `${coastStrips} coast strips checked (want ${8 * IR})`);

console.log(`PASS: ${junctions} junctions, ${tees} three-way (${(share * 100).toFixed(1)}%), ${coastJ} on the coast (the sea arm closed and no other, but for ${nbCoast.length} where a neighbourhood's inner street ends: ${nbCoast.join(' ')}), ${riverJ} on the river (bridges, the street across always open), no dead end; ${filledSegs} filled streets (${(filledShare * 100).toFixed(0)}% of the hash-closed ones), ${plazas} roundabouts in ${chainLen.length} chains (sizes ${[...new Set(chainLen)].sort().join('/')}); ` +
  `${blocksChecked} blocks built, ${barriers} barricade props at the closed streets' mouths; closed arms are never roundabouts and never open to a car; ${closedSamples} closed-street midpoints refused for spawns; ${cranesChecked} crane bases solid, each between its street's two frames; ${pickupsChecked} pickups, none inside a site; ${machinesChecked} parked machines, one or two per site; ${coastStrips} strips along the four coasts, each a park with no site or barricade on it, and its ${coastTrees} trees and ${coastProps} props clear of the seawall`);
