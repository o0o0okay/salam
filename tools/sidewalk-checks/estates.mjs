/* Residential estates (js/world.js, planEstate): some suburb blocks have curved roads, houses along them and
   cul-de-sacs instead of the street grid. This builds a field of blocks and checks, from the records alone:
   * the main road enters the block from one edge of its pad, every road and cul-de-sac stays on the pad;
   * a spur road branches off the main road (it is not a separate, unconnected road);
   * every house sits on the pad, faces its own road, keeps 1.5 m clear of every road's edge and of every cul-de-sac,
     and no two houses overlap; every house is a solid;
   * the roads are drawn above the pad's grass top (0.30), so they are not hidden;
   * estates are not on the spawn blocks, they are deterministic, and they average at least 5 houses.
   Run:  node tools/sidewalk-checks/estates.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { modulePath } from './harness.mjs';

const W = await import(modulePath);
const RANGE = Number(process.env.ESTATE_RANGE || 14);
const ROAD = 3.5, DISC = 6, CLEAR = 1.5;
let estates = 0, housesTotal = 0, minRoadGap = Infinity, spurs = 0, roadsTotal = 0;

// distance from a point to an oriented rectangle (centre, axis t, half sizes)
const rectDist = (h, px, pz) => {
  const dx = px - h.x, dz = pz - h.z;
  const du = Math.abs(dx * h.tx + dz * h.tz) - h.w / 2, dn = Math.abs(dx * -h.tz + dz * h.tx) - h.d / 2;
  return Math.hypot(Math.max(du, 0), Math.max(dn, 0));
};

for (let cx = -RANGE; cx <= RANGE; cx++) for (let cz = -RANGE; cz <= RANGE; cz++) {
  const ch = W.generateChunk(cx, cz, true);
  if (!ch.estate) continue;
  estates++;
  const E = ch.estate, B = E.bounds;
  const where = `block ${cx},${cz}`;
  assert(!(cx === 0 && cz === 0) && !(cx === 1 && cz === 0), `${where}: an estate on a spawn block`);
  assert(E.roads.length >= 1 && E.roads.length <= 3, `${where}: ${E.roads.length} roads`);
  spurs += E.roads.length - 1;
  roadsTotal += E.roads.length;

  // the main road enters from its own edge of the pad
  const [ex, ez] = E.entrance;
  const onEdge = [Math.abs(ex - B.lo_x) < 1e-6, Math.abs(ex - B.hi_x) < 1e-6, Math.abs(ez - B.lo_z) < 1e-6, Math.abs(ez - B.hi_z) < 1e-6];
  assert(onEdge[E.side], `${where}: the main road does not enter from the edge it was planned for`);

  const samples = [];
  for (const rd of E.roads) {
    for (const [x, z] of rd.ribbon) {
      samples.push([x, z]);
      assert(x >= B.lo_x - 1e-6 && x <= B.hi_x + 1e-6 && z >= B.lo_z - 1e-6 && z <= B.hi_z + 1e-6, `${where}: a road leaves the pad`);
    }
    const dc = rd.disc;
    assert(dc.x - DISC >= B.lo_x && dc.x + DISC <= B.hi_x && dc.z - DISC >= B.lo_z && dc.z + DISC <= B.hi_z, `${where}: a cul-de-sac leaves the pad`);
  }
  // a spur must branch off the main road: its first point is on the main road
  for (const rd of E.roads.slice(1)) {
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
    assert(h.x - h.hxA >= B.lo_x - 1e-6 && h.x + h.hxA <= B.hi_x + 1e-6 && h.z - h.hzA >= B.lo_z - 1e-6 && h.z + h.hzA <= B.hi_z + 1e-6, `${where}: a house is off the pad`);
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
}

// the share of all blocks that are estates: suburb is about 26% of blocks and nearly all of those become estates
const total = (2 * RANGE + 1) ** 2, share = estates / total;
const perEstate = housesTotal / estates;
assert(share >= 0.18 && share <= 0.32, `estates are ${(share * 100).toFixed(1)}% of ${total} blocks (want about 26%)`);
assert(perEstate >= 5, `estates average ${perEstate.toFixed(1)} houses (want at least 5)`);
console.log(`PASS: ${estates} estates in ${total} blocks (${(share * 100).toFixed(1)}%), ${roadsTotal} roads (${spurs} spurs), ${housesTotal} houses (${perEstate.toFixed(1)} per estate); ` +
  `the closest house is ${minRoadGap.toFixed(2)} m from a road edge; every road, cul-de-sac and house stays on its pad and clear of the others; estates are deterministic`);
