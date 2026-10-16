/* Procedural pieces baked into a chunk: the per-chunk bake list, merged-geometry flushing, tree instances and the own/stand-alone helpers.
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from './assets.js';
import { ASSET } from './assets.js';
import { TREE_VARIANTS } from './trees.js';
import { setTreeMatrix } from './trees.js';

// A bake entry is one piece: its geometry, its world matrix, its material, and whether it casts a shadow.
export function bake(ch, obj) {
  obj.updateMatrixWorld(true);
  obj.traverse(o => { if (o.isMesh) ch.bakeList.push({ geo: o.geometry, m: o.matrixWorld.clone(), mat: o.material, cast: o.castShadow }); });
}

// ---- the colour of a plain piece is written into its vertices ----
// A plain piece (a flat-shaded Lambert colour with no texture, no glow, no transparency: what mat(color) makes) does not
// need its own material. Its colour is copied into a per-vertex colour attribute, and every such piece shares one
// vertex-coloured material. So the blocks of a city merge into a few meshes, not one per colour, and the picture is the same.
// Anything else (textures, glow, glass, the road and the signal lamps) keeps its own material.
const VERTEX_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
function isPlain(m) {
  return m.type === 'MeshLambertMaterial' && m.flatShading === true && !m.vertexColors && m.transparent === false &&
    m.opacity === 1 && m.emissive.getHex() === 0 && m.side === THREE.FrontSide && m.alphaTest === 0 &&
    !m.map && !m.emissiveMap && !m.lightMap && !m.aoMap && !m.envMap && !m.normalMap && !m.bumpMap && !m.alphaMap &&
    !m.specularMap && !m.displacementMap && !m.wireframe;
}
// Returns the geometry (with its colour written in) and the material it goes under.
function prepared(geo, m) {
  const g = geo.clone();
  if (!isPlain(m)) return { g, key: m };
  const n = g.attributes.position.count, arr = new Float32Array(n * 3), c = m.color;
  for (let i = 0; i < n; i++) { arr[3 * i] = c.r; arr[3 * i + 1] = c.g; arr[3 * i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return { g, key: VERTEX_MAT };
}
// ---- small props cast no shadow ----
// A small decorative piece (a bollard, a bin, a sign, a hydrant, a lamp head...) whose world-space box is under
// SMALL_PROP metres in every direction does not cast a shadow. Nobody sees its shadow at street scale, and each
// shadow caster costs the shadow pass. Buildings and anything larger keep their shadows.
export const SMALL_PROP = 1.0;
export function smallPiece(g) {
  if (!g.attributes || !g.attributes.position || typeof g.computeBoundingBox !== 'function') return false;
  g.computeBoundingBox();
  const b = g.boundingBox;
  if (!b || !b.min || !b.max) return false;
  return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) < SMALL_PROP;
}
// the bag of gathered pieces: key (material) -> { c: [geometries that cast], n: [geometries that do not] }
function gather(bag, b) {
  const { g, key } = prepared(b.geo, b.mat);
  g.applyMatrix4(b.m);
  const cast = b.cast !== false && !smallPiece(g);
  let byCast = bag.get(key);
  if (!byCast) { byCast = { c: [], n: [] }; bag.set(key, byCast); }
  byCast[cast ? 'c' : 'n'].push(g);
}
export function finishChunk(ch) {
  const bag = new Map();
  for (const b of ch.bakeList) gather(bag, b);
  for (const [m, byCast] of bag) for (const k of ['c', 'n']) mergeSlice(ch, m, byCast[k], k === 'c');
  ch.bakeList = null;
}
// One merged mesh for a slice of pieces that share a material. If a single material carries an enormous number
// of pieces the work is split into slices, so no single merge call can become the frame.
export const MERGE_SLICE = 400;
// Pieces can be merged together only when they have the same attributes. They are split by that first, so one
// odd piece cannot make the whole slice fail. (Before this, a refused merge dropped every piece in it.)
function attrKey(g) { return g.attributes ? Object.keys(g.attributes).sort().join(',') + (g.index ? '#i' : '') : ''; }
export function mergeSlice(ch, m, geos, cast = true) {
  if (!geos.length) return;
  const kinds = new Map();
  for (const g of geos) { const k = attrKey(g); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(g); }
  for (const list of kinds.values()) {
    const merged = mergeGeometries(list, false);
    if (merged) {
      list.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, m); mesh.castShadow = cast; mesh.receiveShadow = true; ch.group.add(mesh); ch.geos.push(merged);
    } else {
      // could not merge these: keep each piece as its own mesh rather than lose it
      for (const g of list) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = cast; mesh.receiveShadow = true; ch.group.add(mesh); ch.geos.push(g); }
    }
  }
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
    gather(bag, b); n++;
    if ((n & 63) === 0 && performance.now() - t0 > ms) break;     // the gather phase has a budget too
  }
  if (q.length) return false;
  // merge slices until the budget runs out: cheap materials are drained several per frame, a huge one takes a
  // frame of its own, and the chunk lands finished either way
  for (const [m, byCast] of bag) for (const k of ['c', 'n']) {
    const geos = byCast[k];
    if (!geos.length) continue;
    const part = geos.length > MERGE_SLICE ? geos.splice(0, MERGE_SLICE) : geos.splice(0, geos.length);
    mergeSlice(ch, m, part, k === 'c');
    if (performance.now() - t0 > ms) return false;
  }
  for (const byCast of bag.values()) if (byCast.c.length || byCast.n.length) return false;
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

// ---- the static sweep ----
// Many pieces of a block are added to the chunk group one at a time (a box, a lamp, a sign, a flat marking), and
// each used to be a draw call of its own. They are taken out of the group here and go into the bake list, so the
// merge above puts them in a few meshes. Kept out, because the game holds or moves them: anything reachable from
// the chunk's records (props, pumps, shops, pickups, scaffolds, the helicopter's rotor...) and everything under it,
// anything with `userData.live`, a mesh with children, an instanced mesh, a transparent mesh (its draw order
// matters), a mesh with a render order, a hidden mesh, and a geometry the chunk does not own.
const NOT_PIECES = new Set(['group', 'bakeList', 'geos', 'owned', 'insts', 'mergeQ', 'materialBag']);
function holdKept(v, keep, seen, depth) {
  if (!v || typeof v !== 'object' || depth > 8 || seen.has(v)) return;
  seen.add(v);
  if (v.isObject3D) { v.traverse(o => keep.add(o)); return; }
  if (Array.isArray(v)) { for (const x of v) holdKept(x, keep, seen, depth + 1); return; }
  for (const k of Object.keys(v)) if (!NOT_PIECES.has(k)) holdKept(v[k], keep, seen, depth + 1);
}
export function sweepStatic(ch) {
  ch.group.updateMatrixWorld(true);
  const keep = new Set(), seen = new Set();
  holdKept(ch, keep, seen, 0);
  const merged = new Set(ch.geos);
  const walk = node => {
    for (const c of [...node.children]) {
      if (keep.has(c) || c.userData.live) continue;
      if (c.isMesh) {
        const piece = c.children.length === 0 && c.visible && c.renderOrder === 0 && !Array.isArray(c.material) &&
          !c.material.transparent && !merged.has(c.geometry);
        if (piece) { ch.bakeList.push({ geo: c.geometry, m: c.matrixWorld.clone(), mat: c.material, cast: c.castShadow }); node.remove(c); }
      } else if (!c.isInstancedMesh) walk(c);
    }
  };
  walk(ch.group);
  for (const pr of ch.props) if (pr.mesh && pr.mesh.isObject3D && !pr.mesh.isMesh) mergeInside(ch, pr.mesh);
}
// A kept prop (a bollard, a nosedrum, a street lamp...) is moved or toppled as one object, so the prop itself stays. But
// the pieces inside it are not moved on their own: they are merged *inside* the prop's own group, one mesh per material,
// in the prop's local space (a plain colour goes into the vertices, so one prop is one or two meshes). Pieces with userData (beams, lights, parts the game looks up) and anything transparent,
// hidden, instanced, or with children is left as it is.
function mergeInside(ch, root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const cand = [];
  const walk = node => {
    for (const c of node.children) {
      if (c.isMesh) {
        if (c.children.length === 0 && c.visible && c.renderOrder === 0 && !Array.isArray(c.material) && !c.material.transparent &&
            Object.keys(c.userData).length === 0 && c.geometry) cand.push(c);
      } else if (!c.isInstancedMesh) walk(c);
    }
  };
  walk(root);
  if (cand.length < 2) return;
  const buckets = new Map();
  for (const c of cand) {
    const rel = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld);
    const { g, key: m } = prepared(c.geometry, c.material);   // a plain colour is written into the vertices (see above)
    g.applyMatrix4(rel);
    const cast = c.castShadow && !smallPiece(g);            // a small piece casts no shadow (see smallPiece)
    const key = m.uuid + '|' + (cast ? 1 : 0) + (c.receiveShadow ? 1 : 0);
    if (!buckets.has(key)) buckets.set(key, { m, cast, recv: c.receiveShadow, items: [] });
    buckets.get(key).items.push({ c, g });
  }
  for (const b of buckets.values()) {
    const byKind = new Map();
    for (const it of b.items) { const k = attrKey(it.g); if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(it); }
    for (const list of byKind.values()) {
      if (list.length < 2) continue;                       // a lone piece is already one draw call
      const merged = mergeGeometries(list.map(it => it.g), false);
      list.forEach(it => it.g.dispose());
      if (!merged) continue;                               // the originals stay where they are
      for (const it of list) it.c.parent.remove(it.c);
      const mesh = new THREE.Mesh(merged, b.m); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
      root.add(mesh); ch.geos.push(merged);
    }
  }
}
// A merged stand-alone piece — one street prop, one bus shelter, one scaffold, one shop window, one fuel
// dispenser — is built for one block and nobody else ever draws it again. Its merged geometry is *owned* by
// that block and has to be handed back when the block streams out: `own()` registers it. Without this the
// block's merged pieces were never disposed, so every block the player drove past left its vertex buffers in
// the GPU for the rest of the session (see the streaming notes in tools/sidewalk-checks/README.md).
// A stand-alone piece (a street prop, a bus shelter, scaffolding...) is merged on its own, so it can be knocked off and
// thrown as one. Its plain parts go into one vertex-coloured mesh, as the blocks' baked pieces do (prepared above), so a
// prop of many colours is one draw call; only its glass, glow, textures and double-sided parts keep their own meshes.
// Parts are merged only with parts of the same attributes (attrKey), so one odd part cannot make a merge fail. Glass
// casts no shadow.
export function mergeStandalone(g) {
  g.updateMatrixWorld(true);
  const byKey = new Map();
  g.traverse(o => {
    if (!o.isMesh) return;
    const { g: gc, key } = prepared(o.geometry, o.material);
    gc.applyMatrix4(o.matrixWorld);
    const k = key, a = attrKey(gc);
    if (!byKey.has(k)) byKey.set(k, new Map());
    const byAttr = byKey.get(k);
    if (!byAttr.has(a)) byAttr.set(a, []);
    byAttr.get(a).push(gc);
  });
  const out = new THREE.Group();
  for (const [m, byAttr] of byKey) for (const geos of byAttr.values()) {
    const merged = mergeGeometries(geos, false); geos.forEach(x => x.dispose());
    if (merged) { const mesh = new THREE.Mesh(merged, m); mesh.castShadow = !m.transparent; mesh.receiveShadow = true; out.add(mesh); }
  }
  return out;
}
export function own(ch, obj) {
  obj.traverse(o => { if (o.isMesh && o.geometry) ch.owned.push(o.geometry); });
  return obj;
}
