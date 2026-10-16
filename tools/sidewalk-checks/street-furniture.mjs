/* The street furniture on the pavement (js/world.js, js/props.js):
   * hydrants: half as many as before. A spot is rolled as it always was, and only the lower part of that roll plants a
     hydrant (HYDRANT_KEEP, js/config.js). A spot left empty stays taken while the block is laid out, so nothing else in a
     block moves: a block built with every spot planted (as it was) is the same block in every solid, tree and other prop,
     its parking meters and phone booth included, and the hydrants it adds are the empty spots;
   * metered parking: on busy blocks, runs of two to five bays painted on the road along the kerb (BAY_L long, BAY_D out),
     with a parking meter at the head of each bay (the end a car parks nose to, driving on the right) on the pavement just
     behind the kerb stone, its face to the street; never on a closed street's side or an interchange's at-grade side, never
     in a bus stop's zone, never in a corner; the bay lines are painted under them;
   * phone booths: in as many blocks as BOOTH_P gives their types (no fewer than placement allows), one at most a block, on the pavement behind the kerb, their back to the
     street, out of a bus stop's way;
   * with the game's own props (radii, models): a meter or a booth stands clear of every other prop and of every solid; a
     meter is one mesh (its colours are vertex colours: one draw call), a telephone box three (its plain parts, the
     roof's vaults merged in with its boxes; its glass; its four TELEPHONE signs). The box is a K6, 1 m square on its
     plinth, 2.5 m high and red, with a sign on each side, and its sign and glass light up at night. A car that drives
     into either knocks it down;
   * a block is the same every time it is built.
   Run:  node tools/sidewalk-checks/street-furniture.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './dom.mjs';
import { register } from 'node:module';

// Part A runs first, with no DOM: the stitched generator takes its plain paths when there is no document (ROAD_COAT).
const { HYDRANT_KEEP, BOOTH_P } = await import('../../js/config.js');
const F = await import('../../js/flyover.js');
const CHUNK = 80;
let checks = 0;
const near = (a, b, eps, what) => assert(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b}`);
const r3 = v => Math.round(v * 1000) / 1000;

// ---- Part A: the generator as the suite builds it (js/world.js stitched with stand-ins, tools/sidewalk-checks/harness.mjs) ----
const { modulePath } = await import('./harness.mjs');
const src = fs.readFileSync(modulePath, 'utf8');
assert(new RegExp(`const HYDRANT_KEEP = ${HYDRANT_KEEP};`).test(src), 'the stitched generator does not take HYDRANT_KEEP from js/config.js');
const allFile = path.join(os.tmpdir(), 'salam-world-allhydrants.test.mjs');
fs.writeFileSync(allFile, src.replace(/const HYDRANT_KEEP = [^;]+;/, 'const HYDRANT_KEEP = 1;'));
const A = await import(pathToFileURL(modulePath).href);       // as the game is
const B = await import(pathToFileURL(allFile).href);          // every hydrant spot planted, as it was before
const { SIDEWALK_SIDES, PAVE_IN, BAY_L, BAY_D, METER_IN, BAY_BUS, BOOTH_IN } = A;
assert(BAY_L > 0 && BAY_D > 0 && METER_IN > 0 && BOOTH_IN > 0, 'the bay and booth measures are not exported');

const sig = ch => ({
  solids: ch.solids.map(s => [s.kind, r3(s.x), r3(s.z), r3(s.hx), r3(s.hz)]),
  trees: ch.trees.map(t => [r3(t.x), r3(t.z), t.v, r3(t.rot)]),
  props: ch.props.filter(p => p.kind !== 'hydrant').map(p => [p.kind, r3(p.x), r3(p.z), r3(p.mesh ? p.mesh.rotation.y : 0)]),
});
const key = p => r3(p.x) + ',' + r3(p.z);
let planted = 0, empty = 0, before = 0, gained = 0, blocks = 0, boothBlocks = 0, boothExpect = 0, bayCount = 0, runCount = 0;
const kerbIn = (cx, cz, si) => PAVE_IN + (F.atGradeSide(cx, cz, si) ? F.FLY.atGrade : 0);
const closedSide = (cx, cz, si) => si === 0 ? F.segClosed('z', cx, cz) : si === 1 ? F.segClosed('z', cx + 1, cz) : si === 2 ? F.segClosed('x', cx, cz) : F.segClosed('x', cx, cz + 1);
const HEAD = [-1, 1, 1, -1];                                  // the end a car parks nose to: -1 the low end of the side, +1 the high end
for (let cx = -9; cx < 9; cx++) for (let cz = -9; cz < 9; cz++) {
  const a = A.generateChunk(cx, cz, false), b = B.generateChunk(cx, cz, false);
  blocks++;
  // 1. halving the hydrants moves nothing else in the block
  assert.deepEqual(sig(a), sig(b), `block (${cx}, ${cz}) is laid out differently with half the hydrants`);
  const ah = a.props.filter(p => p.kind === 'hydrant'), bh = b.props.filter(p => p.kind === 'hydrant');
  const bKeys = new Set(bh.map(key));
  for (const h of ah) assert(bKeys.has(key(h)), `block (${cx}, ${cz}): a hydrant at (${h.x}, ${h.z}) that was not there before`);
  assert(bh.length - ah.length <= a.emptySpots.length, `block (${cx}, ${cz}): more hydrants were left out than there are empty spots`);
  for (const e of a.emptySpots) assert(e.kind === 'hydrant' && !ah.some(h => key(h) === key(e)), `block (${cx}, ${cz}): an empty spot has a hydrant on it`);
  planted += ah.length; empty += a.emptySpots.length; before += bh.length; gained += bh.length - ah.length;
  const bx = cx * CHUNK + 40, bz = cz * CHUNK + 40, x0 = cx * CHUNK, z0 = cz * CHUNK;
  // 2. the metered bays and their meters
  const runs = new Map();
  for (const bay of a.bays) {
    const si = bay.side, s = SIDEWALK_SIDES[si], alongZ = s.along === 'z', f = s.fixed;
    assert(!closedSide(cx, cz, si) && !F.atGradeSide(cx, cz, si), `block (${cx}, ${cz}): bays on a closed or at-grade side ${si}`);
    const K = (alongZ ? bx : bz) + f * (CHUNK / 2 - kerbIn(cx, cz, si));      // the kerb's face
    near(bay.kerb, K, 1e-9, `block (${cx}, ${cz}) side ${si}: the bays' kerb`);
    near(alongZ ? bay.x : bay.z, K + f * BAY_D / 2, 1e-9, 'a bay across the road');
    const local = bay.start - (alongZ ? z0 : x0);
    assert(local >= 16 - 1e-9 && local + BAY_L <= CHUNK - 16 + 1e-9, `block (${cx}, ${cz}): a bay in a corner (${local.toFixed(1)} m along)`);
    const m = bay.meter;
    assert(m && m.kind === 'meter' && a.props.includes(m), `block (${cx}, ${cz}): a bay without its meter`);
    near(alongZ ? m.x : m.z, K - f * METER_IN, 1e-9, 'a meter behind the kerb');
    near(alongZ ? m.z : m.x, bay.start + (HEAD[si] < 0 ? 0.5 : BAY_L - 0.5), 1e-9, 'a meter at the head of its bay');
    const face = m.mesh.rotation.y;                                            // its face (local +z) to the street
    near(Math.sin(face), alongZ ? f : 0, 1e-9, 'a meter\'s face across'); near(Math.cos(face), alongZ ? 0 : f, 1e-9, 'a meter\'s face along');
    const mid = bay.start + BAY_L / 2, road = alongZ ? (f < 0 ? x0 : x0 + CHUNK) : (f < 0 ? z0 : z0 + CHUNK);
    for (const st of a.busStops) if (st.axis === (alongZ ? 'z' : 'x') && Math.abs(st.road - road) < 1)
      assert(Math.abs(st.along - mid) >= BAY_BUS + BAY_L / 2 - 1e-9, `block (${cx}, ${cz}): a bay in a bus stop's zone`);
    if (!runs.has(bay.run)) runs.set(bay.run, []);
    runs.get(bay.run).push(bay);
    bayCount++;
  }
  for (const run of runs.values()) {
    run.sort((p, q) => p.start - q.start);
    assert(run.length >= 2 && run.length <= 5, `block (${cx}, ${cz}): a run of ${run.length} bays`);
    for (let i = 1; i < run.length; i++) near(run[i].start - run[i - 1].start, BAY_L, 1e-9, 'bays one after another');
    // the paint: the outer line along the whole run, BAY_D out, and a line at each end of each bay
    const si = run[0].side, alongZ = SIDEWALK_SIDES[si].along === 'z', f = SIDEWALK_SIDES[si].fixed, K = run[0].kerb;
    const from = run[0].start, to = run[run.length - 1].start + BAY_L;
    const across = l => (alongZ ? l.x : l.z), along = l => (alongZ ? l.z : l.x), lenAlong = l => (alongZ ? l.d : l.w), lenAcross = l => (alongZ ? l.w : l.d);
    assert(a.bayLines.some(l => Math.abs(across(l) - (K + f * BAY_D)) < 1e-6 && along(l) - lenAlong(l) / 2 <= from + 1e-6 && along(l) + lenAlong(l) / 2 >= to - 1e-6),
      `block (${cx}, ${cz}): no outer line along a run of bays`);
    for (let j = 0; j <= run.length; j++) {
      const t = from + j * BAY_L;
      assert(a.bayLines.some(l => Math.abs(along(l) - t) < 1e-6 && lenAcross(l) > BAY_D - 0.2 && Math.abs(across(l) - (K + f * BAY_D / 2)) < 0.1),
        `block (${cx}, ${cz}): no line between two bays at ${t.toFixed(1)}`);
    }
    runCount++;
  }
  // 3. the phone booth
  const booths = a.props.filter(p => p.kind === 'phonebooth');
  boothExpect += Math.min(1, BOOTH_P[a.mapType] || 0);
  assert(booths.length <= 1, `block (${cx}, ${cz}) has ${booths.length} phone booths`);
  if (booths.length) {
    boothBlocks++;
    const p = booths[0], face = p.mesh.rotation.y;
    assert((BOOTH_P[a.mapType] || 0) > 0, `a phone booth on a ${a.mapType} block`);
    const alongZ = Math.abs(Math.sin(face)) > 0.5, f = Math.sign(alongZ ? Math.sin(face) : Math.cos(face));
    const si = alongZ ? (f < 0 ? 0 : 1) : (f < 0 ? 2 : 3);
    const K = (alongZ ? bx : bz) + f * (CHUNK / 2 - kerbIn(cx, cz, si));
    near(alongZ ? p.x : p.z, K - f * BOOTH_IN, 1e-9, `block (${cx}, ${cz}): a phone booth behind the kerb`);
    assert(!closedSide(cx, cz, si), `block (${cx}, ${cz}): a phone booth on a closed street`);
    for (const st of a.busStops) assert(Math.hypot(st.x - p.x, st.z - p.z) >= 7, `block (${cx}, ${cz}): a phone booth in a bus stop's way`);
  }
  // 4. built again, the same block
  if (cx === 0 && cz >= -2 && cz <= 2) {
    const again = A.generateChunk(cx, cz, false);
    assert.deepEqual(sig(again), sig(a), `block (${cx}, ${cz}) is not the same when it is built again`);
    assert.deepEqual(again.bays.map(q => [r3(q.x), r3(q.z), q.run]), a.bays.map(q => [r3(q.x), r3(q.z), q.run]), `block (${cx}, ${cz}): its bays are not the same when it is built again`);
    A.disposeChunk(again);
  }
  A.disposeChunk(a); B.disposeChunk(b);
}
checks += 5;
const share = planted / before;
assert.equal(HYDRANT_KEEP, 0.5, 'HYDRANT_KEEP (js/config.js) is not 0.5: the hydrants were to be halved');
assert(Math.abs(share - HYDRANT_KEEP) < 0.06, `hydrants: ${planted} of the ${before} there were (${(100 * share).toFixed(1)}%), not about ${100 * HYDRANT_KEEP}%`);
assert(gained >= 0.97 * empty && gained <= empty, `the hydrants left out (${gained}) are not the empty spots (${empty})`);
checks += 3;
assert(runCount >= 20 && bayCount >= 60, `only ${runCount} runs of bays (${bayCount} bays) in ${blocks} blocks`);
const boothShare = boothBlocks / blocks;
// Each block rolls once against its type's chance, so the share follows BOOTH_P, give or take the luck of the rolls (a
// few in a hundred over this many blocks). A block that finds no free spot on any side can only lower it.
const boothWant = boothExpect / blocks;
assert(boothShare >= 0.85 * boothWant - 0.05 && boothShare <= boothWant + 0.06,
  `phone booths in ${(100 * boothShare).toFixed(1)}% of the blocks, but BOOTH_P gives these blocks ${(100 * boothWant).toFixed(1)}%`);
checks += 2 + 8;
console.log(`street furniture: ${blocks} blocks; hydrants ${planted} of ${before} (${(100 * share).toFixed(1)}%), ${empty} spots left empty; ` +
  `${bayCount} metered bays in ${runCount} runs; phone booths in ${boothBlocks} blocks (${(100 * boothShare).toFixed(1)}%, BOOTH_P gives ${(100 * boothWant).toFixed(1)}%)`);

// ---- Part B: the game's own modules (the real props, their radii and models, and the collisions) ----
installDom();
register('./hooks.mjs', import.meta.url);
const W = await import('../../js/world.js');
const { PROP_DEFS } = await import('../../js/props.js');
const { mergeStandalone } = await import('../../js/chunkBake.js');
const { collideProps } = await import('../../js/collisions.js');
{
  // the models: a meter is one vertex-coloured mesh; a telephone box is three: its plain parts (the roof's vaults are
  // indexed as the boxes are, so they merge with them), its glass and its four TELEPHONE signs
  const meter = mergeStandalone(PROP_DEFS.meter.make());
  assert.equal(meter.children.length, 1, `a parking meter is ${meter.children.length} meshes (one draw call each)`);
  assert(meter.children[0].material.vertexColors, 'a parking meter\'s colours are not vertex colours');
  const booth = mergeStandalone(PROP_DEFS.phonebooth.make());
  assert.equal(booth.children.length, 3, `a telephone box is ${booth.children.length} meshes, not 3 (its plain parts, its glass, its signs)`);
  const plainMesh = booth.children.find(c => c.material.vertexColors), signMesh = booth.children.find(c => c.material.map);
  const glassMesh = booth.children.find(c => c.material.transparent);
  assert(plainMesh && signMesh && glassMesh, 'a telephone box lacks its plain parts, its TELEPHONE signs or its glass');
  assert(!glassMesh.castShadow, 'the telephone box\'s glass casts a shadow');
  // a K6: 1 m square on its plinth (the box is 0.91 m), 2.51 m to the top of its roof, red, a sign on each of its sides
  const THREE = await import('three');
  const bb = new THREE.Box3().setFromObject(booth);
  near(bb.max.x - bb.min.x, 1.0, 0.02, 'the telephone box\'s width'); near(bb.max.z - bb.min.z, 1.0, 0.02, 'the telephone box\'s depth');
  near(bb.max.y - bb.min.y, 2.51, 0.03, 'the telephone box\'s height'); near(bb.min.y, 0, 1e-9, 'the telephone box\'s foot');
  const col = plainMesh.geometry.attributes.color;
  let redV = 0;
  for (let i = 0; i < col.count; i++) if (col.getX(i) > 0.3 && col.getY(i) < 0.08 && col.getZ(i) < 0.08) redV++;
  assert(redV / col.count > 0.5, `a telephone box is not red: ${(100 * redV / col.count).toFixed(0)}% of its plain parts`);
  assert.equal(signMesh.geometry.index.count / 6, 4, 'a telephone box has not one TELEPHONE sign on each of its four sides');
  const sb = new THREE.Box3().setFromObject(signMesh);
  assert(sb.max.x - sb.min.x > 0.9 && sb.max.z - sb.min.z > 0.9, 'the telephone box\'s signs are not on its four faces');
  const { ASSET } = await import('../../js/assets.js');
  assert(ASSET.litMats.includes(signMesh.material) && ASSET.litMats.includes(glassMesh.material), 'the telephone box is not lit at night (its sign and glass are not in ASSET.litMats)');
  const hydrant = mergeStandalone(PROP_DEFS.hydrant.make());
  assert.equal(hydrant.children.length, 1, 'a hydrant (red and yellow) is not one mesh');
  checks += 9;
  // with the real radii: a meter or a booth stands clear of every other prop and every solid
  const seen = new Set();
  let meters = 0, booths = 0;
  const hit = (s, x, z, r) => Math.abs(x - s.x) < s.hx + r && Math.abs(z - s.z) < s.hz + r;
  for (const [px, pz] of [[40, 40], [40, -160], [-120, 200], [200, 40], [-200, -120]]) {
    W.updateChunks(px, pz, 999);
    for (const ch of W.chunks.values()) {
      if (seen.has(ch.cx + ',' + ch.cz)) continue;
      seen.add(ch.cx + ',' + ch.cz);
      for (const p of ch.props) {
        if (p.kind !== 'meter' && p.kind !== 'phonebooth') continue;
        if (p.kind === 'meter') { if (!ch.bays.some(b => b.meter === p)) continue; meters++; } else booths++;
        assert(p.mesh.children.length <= (p.kind === 'meter' ? 1 : 3), `a ${p.kind} in the city is ${p.mesh.children.length} meshes`);
        for (const q of ch.props) if (q !== p) assert(Math.hypot(q.x - p.x, q.z - p.z) >= q.r + p.r - 1e-6, `a ${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) stands in a ${q.kind}`);
        for (const s of ch.solids) if (s.hx > 0) assert(!hit(s, p.x, p.z, p.r), `a ${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) stands in a ${s.kind}`);
      }
    }
  }
  assert(meters >= 20 && booths >= 2, `only ${meters} bay meters and ${booths} phone booths in ${seen.size} blocks`);
  checks += 2;
  // a car that drives into a meter or a booth knocks it down
  for (const kind of ['meter', 'phonebooth']) {
    let target = null;
    for (const ch of W.chunks.values()) { target = ch.props.find(p => p.kind === kind && !p.broken); if (target) break; }
    assert(target, `no ${kind} left to drive into`);
    const car = { x: target.x, z: target.z, y: 0, h: 0, box: { e1: 2.1, e2: 1.0 }, vx: 0, vz: 18, speed: 18, mass: 1, isPlayer: true };
    collideProps(car);
    assert(target.broken, `a car driving into a ${kind} does not knock it down`);
    checks++;
  }
}
console.log(`street furniture: ${checks} checks PASSED`);
process.exit(0);
