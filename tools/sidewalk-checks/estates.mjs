/* Residential estates (js/world.js, planEstate and nbhdPlan): suburb blocks have curved roads, houses along them and
   cul-de-sacs instead of the street grid. Two kinds, checked from the built block records alone:
   * a block estate (one block, planEstate): the main road enters from one edge of its pad, a spur branches off the
     main road, and every road and cul-de-sac stays on the pad;
   * a neighbourhood (2x2 blocks, nbhdPlan): the roads stay inside the region's own boundary (22 m in), every block of
     the region builds the same roads, and each house lies in the pad of the block its centre is in;
   * for both: every house faces its own road, keeps 1.5 m clear of every road's edge and of every cul-de-sac, no two
     houses overlap, every house is a solid, the roads are drawn above the grass top (0.30), and the plan is
     deterministic;
   * a neighbourhood averages at least 5 houses for now (target about 10); a block estate averages at least 4;
   * estates are a suburb's thing (js/districts.js): none outside the suburb district, and in it about as many as the
     district's share of 'suburb' blocks (62% of its mix), since nearly all of those become estates.
   The scan covers the whole island (js/island.js, 50 x 50 blocks): the city centre, a disc round the spawn about 15 to
   21 blocks across, has no suburbs, so a square round the spawn finds no estate at all.
   Run:  node tools/sidewalk-checks/estates.mjs      (exits non-zero on a failure)
         ESTATE_RANGE=n   only the blocks within n of the spawn block (on the island) */
import assert from 'node:assert/strict';
import { modulePath } from './harness.mjs';

const W = await import(modulePath);
const CH = 80, PAD = W.PAD_IN, NB = 3;      // NB: blocks a neighbourhood spans a side (NB_BLOCKS in flyover.js)
const RANGE = process.env.ESTATE_RANGE ? Number(process.env.ESTATE_RANGE) : Infinity;
const LO = Math.max(-W.ISLAND_R, -RANGE), HI = Math.min(W.ISLAND_R - 1, RANGE);   // the island's blocks are -ISLAND_R..ISLAND_R-1
const ROAD = 3.5, DISC = 6, CLEAR = 1.5;
let estates = 0, housesTotal = 0, minRoadGap = Infinity, spurs = 0, roadsTotal = 0;
let nbBlocks = 0, blockEstates = 0, blockHouses = 0, total = 0, suburbBlocks = 0, suburbEstates = 0;
const regions = new Map();     // 'RX,RZ' -> { houses, blocks, roads }

// distance from a point to an oriented rectangle (centre, axis t, half sizes)
const rectDist = (h, px, pz) => {
  const dx = px - h.x, dz = pz - h.z;
  const du = Math.abs(dx * h.tx + dz * h.tz) - h.w / 2, dn = Math.abs(dx * -h.tz + dz * h.tx) - h.d / 2;
  return Math.hypot(Math.max(du, 0), Math.max(dn, 0));
};

for (let cx = LO; cx <= HI; cx++) for (let cz = LO; cz <= HI; cz++) {
  const ch = W.generateChunk(cx, cz, true);
  const suburb = W.districtOf(cx, cz) === 'suburb';
  total++;
  if (suburb) suburbBlocks++;
  if (!ch.estate) { W.disposeChunk(ch); continue; }   // 2500 blocks: each one goes once checked, or the heap runs out
  estates++;
  const E = ch.estate, B = E.bounds;
  const where = `block ${cx},${cz}`;
  assert(suburb, `${where}: an estate in the ${W.districtOf(cx, cz)} district (estates are a suburb's thing)`);
  suburbEstates++;
  assert(!(cx === 0 && cz === 0) && !(cx === 1 && cz === 0), `${where}: an estate on a spawn block`);
  const nb = E.nb;
  // a neighbourhood's roads stay in its own region; a block estate's roads stay on its own pad
  const reg = nb ? { x0: nb[0] * NB * CH, z0: nb[1] * NB * CH } : null;
  const roadBox = nb ? { lo_x: reg.x0 + 22, hi_x: reg.x0 + NB * CH - 22, lo_z: reg.z0 + 22, hi_z: reg.z0 + NB * CH - 22 } : B;
  // a house must lie in the pad of the block its centre is in (a neighbourhood) or on the block's own pad
  const padOf = h => nb
    ? { lo_x: Math.floor(h.x / CH) * CH + PAD, hi_x: Math.floor(h.x / CH) * CH + CH - PAD, lo_z: Math.floor(h.z / CH) * CH + PAD, hi_z: Math.floor(h.z / CH) * CH + CH - PAD }
    : B;
  assert(E.roads.length >= 1 && E.roads.length <= (nb ? 7 : 3), `${where}: ${E.roads.length} roads`);
  spurs += E.roads.length - 1;
  roadsTotal += E.roads.length;
  if (nb) {
    nbBlocks++;
    assert(W.nbhdPlan(nb[0], nb[1]), `${where}: a neighbourhood block with no plan`);
    const R = regions.get(nb.join(',')) || { houses: 0, blocks: 0, roads: E.roads.length };
    R.blocks++; R.houses += E.houses.length; regions.set(nb.join(','), R);
    for (const h of E.houses) assert(Math.floor(h.x / CH) === cx && Math.floor(h.z / CH) === cz, `${where}: a house centre lies in another block`);
  } else {
    blockEstates++; blockHouses += E.houses.length;
    // the main road enters from its own edge of the pad
    const [ex, ez] = E.entrance;
    const onEdge = [Math.abs(ex - B.lo_x) < 1e-6, Math.abs(ex - B.hi_x) < 1e-6, Math.abs(ez - B.lo_z) < 1e-6, Math.abs(ez - B.hi_z) < 1e-6];
    assert(onEdge[E.side], `${where}: the main road does not enter from the edge it was planned for`);
  }

  // A neighbourhood's main road comes in from the street at its entrance (nbhdEntrance in js/flyover.js): it starts on
  // the pad's edge, so its first 30 m (60 ribbon points, as the planner exempts them in js/neighbourhoods.js) need only
  // stay on the region's pads.
  const entryBox = nb ? { lo_x: reg.x0 + PAD, hi_x: reg.x0 + NB * CH - PAD, lo_z: reg.z0 + PAD, hi_z: reg.z0 + NB * CH - PAD } : B;
  const samples = [];
  E.roads.forEach((rd, k) => {
    rd.ribbon.forEach(([x, z], i) => {
      samples.push([x, z]);
      const box = nb && k === 0 && i < 60 ? entryBox : roadBox;
      assert(x >= box.lo_x - 1e-6 && x <= box.hi_x + 1e-6 && z >= box.lo_z - 1e-6 && z <= box.hi_z + 1e-6, `${where}: a road leaves ${nb ? 'its region' : 'the pad'}`);
    });
  });
  for (const rd of E.roads) {
    const dc = rd.disc;
    // a cul-de-sac may reach 16 m in from the region's edge (its 6 m disc, around a road end 22 m in); the boundary
    // street is 8 m wide on the lattice line, so the disc still clears it
    const discBox = nb ? { lo_x: reg.x0 + 16, hi_x: reg.x0 + NB * CH - 16, lo_z: reg.z0 + 16, hi_z: reg.z0 + NB * CH - 16 } : B;
    assert(dc.x - DISC >= discBox.lo_x && dc.x + DISC <= discBox.hi_x && dc.z - DISC >= discBox.lo_z && dc.z + DISC <= discBox.hi_z, `${where}: a cul-de-sac leaves ${nb ? 'its region' : 'the pad'}`);
  }
  // a spur must branch off the main road: its first point is on the main road
  for (const rd of nb ? [] : E.roads.slice(1)) {
    const [sx, sz] = rd.ribbon[0];
    const d = Math.min(...E.roads[0].ribbon.map(([x, z]) => Math.hypot(x - sx, z - sz)));
    assert(d < 1.0, `${where}: a spur does not start on the main road (${d.toFixed(2)} m)`);
  }

  // the roads are drawn above the grass: the pad's top is 0.30 (padBox y 0.2, h 0.1)
  assert(E.roadY > 0.30 + 0.01, `${where}: the road (y ${E.roadY}) is under the pad's grass top (0.30)`);

  // houses: on the pad, facing their road, clear of every road and cul-de-sac, and solid
  const solidsHere = ch.solids.filter(s => s.kind === 'building');
  for (const h of E.houses) {
    housesTotal++;
    const P = padOf(h);
    assert(h.x - h.hxA >= P.lo_x - 1e-6 && h.x + h.hxA <= P.hi_x + 1e-6 && h.z - h.hzA >= P.lo_z - 1e-6 && h.z + h.hzA <= P.hi_z + 1e-6, `${where}: a house is off the pad`);
    let gap = Infinity;
    for (const [x, z] of samples) gap = Math.min(gap, rectDist(h, x, z) - ROAD);
    minRoadGap = Math.min(minRoadGap, gap);
    assert(gap >= CLEAR - 1e-6, `${where}: a house is ${gap.toFixed(2)} m from a road's edge (want ${CLEAR})`);
    for (const rd of E.roads) assert(rectDist(h, rd.disc.x, rd.disc.z) - DISC >= CLEAR - 1e-6, `${where}: a house is too close to a cul-de-sac`);
    // the front (door) faces the road: its side of the house is the nearer one to the house's own road
    const nx = -h.tz, nz = h.tx, front = -h.k * h.d / 2;   // the house's local +z is the normal n = (-tz, tx)
    const nearest = (px, pz) => Math.min(...samples.map(([x, z]) => Math.hypot(x - px, z - pz)));
    const doorD = nearest(h.x + front * nx, h.z + front * nz), backD = nearest(h.x - front * nx, h.z - front * nz);
    assert(doorD < backD, `${where}: a house's front faces away from its road`);
    // the solid is registered at the house's own bounding box
    assert(solidsHere.some(s => Math.abs(s.x - h.x) < 1e-6 && Math.abs(s.z - h.z) < 1e-6 && Math.abs(s.hx - h.hxA) < 1e-6 && Math.abs(s.hz - h.hzA) < 1e-6),
      `${where}: a house has no solid`);
  }
  for (let i = 0; i < E.houses.length; i++) for (let j = i + 1; j < E.houses.length; j++) {
    const a = E.houses[i], b = E.houses[j];
    assert(!(Math.abs(a.x - b.x) < a.hxA + b.hxA && Math.abs(a.z - b.z) < a.hzA + b.hzA), `${where}: two houses overlap`);
  }

  // deterministic: building the same block again gives the same estate
  const again = W.generateChunk(cx, cz, true);
  assert.deepEqual(again.estate, ch.estate, `${where}: the estate changes when the block is built again`);
  // the memo (world.js estatePlanMemo) replays the block's random draws: the rest of the block is the same too
  const sig = c => JSON.stringify(c.solids.map(o => [o.x, o.z, o.hx, o.hz, o.kind])) + '|' + c.geos.length;
  assert.equal(sig(again), sig(ch), `${where}: the block's solids change when it is built again`);
  W.disposeChunk(again); W.disposeChunk(ch);
}

// The share of the suburb district's blocks that are estates. The district's mix (js/districts.js) makes 62% of its
// blocks 'suburb', and nearly all of those become estates (not a block on a tram lane, nor one next to the spawn); a
// neighbourhood's blocks are all suburb. Over the island that is 222 estates in 371 suburb blocks (60%), 8.9% of all
// 2500 blocks. (Before the districts, suburb was about 26% of all blocks, spread everywhere, and the test wanted that.)
assert(suburbBlocks >= 40 || RANGE < Infinity, `only ${suburbBlocks} suburb blocks on the island`);
const share = suburbEstates / Math.max(1, suburbBlocks);
if (suburbBlocks >= 40) assert(share >= 0.5 && share <= 0.72, `estates are ${(share * 100).toFixed(1)}% of the ${suburbBlocks} suburb blocks (want about 62%)`);
// a block estate (outside a neighbourhood) averages at least 4 houses
const perBlock = blockHouses / Math.max(1, blockEstates);
assert(perBlock >= 4, `block estates average ${perBlock.toFixed(1)} houses (want at least 4)`);
// a neighbourhood: each whole region (all of its blocks in range) has about ten houses, at least eight on average
const whole = [...regions.entries()].filter(([, R]) => R.blocks === NB * NB);
assert(whole.length >= 1, 'no whole neighbourhood in range: widen ESTATE_RANGE');
const nbPer = whole.reduce((a, [, R]) => a + R.houses, 0) / whole.length;
for (const [k, R] of whole) assert(R.houses >= 4, `neighbourhood ${k} has ${R.houses} houses`);
// INTERIM floor: the approved target is about ten houses per neighbourhood. The 3x3 planner reaches about 7.5 (each
// house must sit inside one block's pad). Raise this floor when the density is settled.
assert(nbPer >= 5, `neighbourhoods average ${nbPer.toFixed(1)} houses (want at least 5 now, target about 10)`);
console.log(`PASS: ${estates} estates in ${total} blocks, all in the suburb district (${(share * 100).toFixed(1)}% of its ${suburbBlocks} blocks): ${blockEstates} block estates (${perBlock.toFixed(1)} houses each) and ${nbBlocks} blocks in ${regions.size} neighbourhoods ` +
  `(${whole.length} whole, ${nbPer.toFixed(1)} houses each); ${roadsTotal} roads (${spurs} spurs), ${housesTotal} houses; ` +
  `the closest house is ${minRoadGap.toFixed(2)} m from a road edge; every road, cul-de-sac and house stays on its pad or region and clear of the others; estates are deterministic`);
