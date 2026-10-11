/* Procedural pieces baked into a chunk: the per-chunk bake list, merged-geometry flushing, tree instances and the own/stand-alone helpers.
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from './assets.js';
import { ASSET } from './assets.js';
import { TREE_VARIANTS } from './trees.js';
import { setTreeMatrix } from './trees.js';

export function bake(ch, obj) {
  obj.updateMatrixWorld(true);
  obj.traverse(o => { if (o.isMesh) ch.bakeList.push({ geo: o.geometry, m: o.matrixWorld.clone(), mat: o.material }); });
}
export function finishChunk(ch) {
  const byMat = new Map();
  for (const b of ch.bakeList) {
    const g = b.geo.clone(); g.applyMatrix4(b.m);
    if (!byMat.has(b.mat)) byMat.set(b.mat, []); byMat.get(b.mat).push(g);
  }
  for (const [m, geos] of byMat) mergeSlice(ch, m, geos);
  ch.bakeList = null;
}
// One merged mesh for a slice of pieces that share a material. If a single material carries an enormous number
// of pieces the work is split into slices, so no single merge call can become the frame.
export const MERGE_SLICE = 400;
export function mergeSlice(ch, m, geos) {
  if (!geos.length) return;
  const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
  if (merged) { const mesh = new THREE.Mesh(merged, m); mesh.castShadow = true; mesh.receiveShadow = true; ch.group.add(mesh); ch.geos.push(merged); }
}
// Chunk merging, spread across frames. A block with 600+ pieces (a shopping street) used to do all of the
// cloning and merging in the one frame the streamer asked for it, right as the player arrived. Instead the
// chunk is generated with its bake list intact, its group goes straight into the scene (so the road and the
// paving it draws directly are there immediately) and flushChunk() pays the rest off in slices: a few hundred
// gathers and a couple of merges per frame. The buildings catch up a few frames later, far away and behind fog.
export function flushChunk(ch, ops = 600, ms = 2.5) {
  const q = ch.mergeQ, bag = ch.materialBag, t0 = performance.now();
  let n = 0;
  while (q.length && n < ops) {
    const b = q.pop();
    const g = b.geo.clone(); g.applyMatrix4(b.m);
    let list = bag.get(b.mat); if (!list) { list = []; bag.set(b.mat, list); }
    list.push(g); n++;
    if ((n & 63) === 0 && performance.now() - t0 > ms) break;     // the gather phase has a budget too
  }
  if (q.length) return false;
  // merge slices until the budget runs out: cheap materials are drained several per frame, a huge one takes a
  // frame of its own, and the chunk lands finished either way
  for (const [m, geos] of bag) {
    if (!geos.length) continue;
    const part = geos.length > MERGE_SLICE ? geos.splice(0, MERGE_SLICE) : geos.splice(0, geos.length);
    mergeSlice(ch, m, part);
    if (performance.now() - t0 > ms) return false;
  }
  for (const geos of bag.values()) if (geos.length) return false;
  bag.clear(); ch.merged = true;
  return true;
}
export function buildTreeInstances(ch) {
  const byV = new Map();
  for (const t of ch.trees) { if (!byV.has(t.v)) byV.set(t.v, []); byV.get(t.v).push(t); }
  for (const [v, list] of byV) {
    const im = new THREE.InstancedMesh(TREE_VARIANTS[v], ASSET.treeMat, list.length);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    list.forEach((t, i) => { t.im = im; t.i = i; setTreeMatrix(t, 1); });
    im.instanceMatrix.needsUpdate = true;
    ch.group.add(im); ch.insts.push(im);
  }
}
// Merges all child meshes of a standalone (non-chunk-baked) group into a handful of meshes grouped by
// material — keeps bus stops / scaffolding (which have many small parts for visual detail) cheap to render
// while still being a single draggable/breakable Object3D (used by flying.js on destruction).
export function mergeStandalone(g) {
  g.updateMatrixWorld(true);
  const byMat = new Map();
  g.traverse(o => { if (o.isMesh) { if (!byMat.has(o.material)) byMat.set(o.material, []); const gc = o.geometry.clone(); gc.applyMatrix4(o.matrixWorld); byMat.get(o.material).push(gc); } });
  const out = new THREE.Group();
  for (const [m, geos] of byMat) {
    const merged = mergeGeometries(geos, false); geos.forEach(x => x.dispose());
    if (merged) { const mesh = new THREE.Mesh(merged, m); mesh.castShadow = true; mesh.receiveShadow = true; out.add(mesh); }
  }
  return out;
}
// A merged stand-alone piece — one street prop, one bus shelter, one scaffold, one shop window, one fuel
// dispenser — is built for one block and nobody else ever draws it again. Its merged geometry is *owned* by
// that block and has to be handed back when the block streams out: `own()` registers it. Without this the
// block's merged pieces were never disposed, so every block the player drove past left its vertex buffers in
// the GPU for the rest of the session (see the streaming notes in tools/sidewalk-checks/README.md).
export function own(ch, obj) {
  obj.traverse(o => { if (o.isMesh && o.geometry) ch.owned.push(o.geometry); });
  return obj;
}
