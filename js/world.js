/* Procedural city: chunk generation, streaming, spatial queries */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK, VIEW_R, PI, mulberry32, hash2, ck } from './utils.js';
import { scene } from './renderer.js';
import { mat, box, cyl, ASSET, makeBuildingGeo } from './assets.js';
import { buildCar, CAR_DIMS } from './carModels.js';
import { PROP_DEFS } from './props.js';
import { TREE_VARIANTS, setTreeMatrix } from './trees.js';
import { buildIntersection, removeIntersection } from './trafficLights.js';
export const chunks = new Map();
function bake(ch, obj) {
  obj.updateMatrixWorld(true);
  obj.traverse(o => { if (o.isMesh) ch.bakeList.push({ geo: o.geometry, m: o.matrixWorld.clone(), mat: o.material }); });
}
function finishChunk(ch) {
  const byMat = new Map();
  for (const b of ch.bakeList) {
    const g = b.geo.clone(); g.applyMatrix4(b.m);
    if (!byMat.has(b.mat)) byMat.set(b.mat, []); byMat.get(b.mat).push(g);
  }
  for (const [m, geos] of byMat) {
    const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
    if (merged) { const mesh = new THREE.Mesh(merged, m); mesh.castShadow = true; mesh.receiveShadow = true; ch.group.add(mesh); ch.geos.push(merged); }
  }
  ch.bakeList = null;
}
function buildTreeInstances(ch) {
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
function mergeStandalone(g) {
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
// ---- Bus stop shelter (several color liveries) ----
const BUSSTOP_W = 4.4, BUSSTOP_D = 1.8;
const BUS_LIVERIES = [
  { roof: 0x2f6fb0, ad: 0x163a63, frame: 0x707782 },
  { roof: 0xd64545, ad: 0x5a1414, frame: 0x5c5f66 },
  { roof: 0x3f9e48, ad: 0x15401a, frame: 0x6b6f74 },
  { roof: 0xe8b02a, ad: 0x5a4208, frame: 0x6b6f74 },
];
function buildBusStopMesh(v) {
  const g = new THREE.Group();
  const glass = mat(0xbfe0ff, { transparent: true, opacity: 0.45 });
  const frame = mat(v.frame), roofMat = mat(v.roof), adMat = mat(v.ad, { emissive: v.ad, emissiveIntensity: 0.15 });
  const benchMat = mat(0x8a6a3a), dark = mat(0x2a2a2a), binMat = mat(0x4b5660), lidMat = mat(0x262b30);
  const W = BUSSTOP_W, D = BUSSTOP_D, postH = 2.5;
  g.add(box(W + 0.7, 0.08, D + 0.7, mat(0xb7bcc2), 0, 0.04, 0, false)); // curb slab
  g.add(box(W - 0.3, 1.9, 0.06, glass, 0, 1.05, -D / 2 + 0.05, false)); // back glass wall
  g.add(box(1.6, 1.1, 0.07, adMat, -W / 2 + 1.0, 0.75, -D / 2 + 0.1, false)); // ad panel
  g.add(box(0.06, 1.9, D - 0.3, glass, W / 2 - 0.05, 1.05, 0, false)); // side glass wall
  g.add(box(W + 0.5, 0.14, D + 0.6, roofMat, 0, postH + 0.07, -0.05, false)); // roof
  g.add(box(W + 0.5, 0.2, 0.06, frame, 0, postH - 0.02, D / 2 + 0.28, false)); // front fascia
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.1, postH, 0.1, frame, sx * (W / 2 - 0.1), postH / 2, sz * (D / 2 - 0.1), false));
  g.add(box(W - 0.1, 0.07, 0.07, frame, 0, postH, -D / 2 + 0.1, false)); g.add(box(W - 0.1, 0.07, 0.07, frame, 0, postH, D / 2 - 0.1, false));
  g.add(box(0.07, 0.07, D - 0.1, frame, -W / 2 + 0.1, postH, 0, false)); g.add(box(0.07, 0.07, D - 0.1, frame, W / 2 + 0.1 - 0.2, postH, 0, false));
  g.add(box(W - 1.0, 0.12, 0.5, benchMat, 0, 0.52, -D / 2 + 0.65, false));
  g.add(box(0.1, 0.5, 0.45, dark, -(W - 1.0) * 0.38, 0.27, -D / 2 + 0.65, false)); g.add(box(0.1, 0.5, 0.45, dark, (W - 1.0) * 0.38, 0.27, -D / 2 + 0.65, false));
  g.add(cyl(0.3, 0.26, 0.8, 10, binMat, W / 2 + 0.45, 0.4, D / 2 - 0.3, false)); g.add(cyl(0.32, 0.32, 0.06, 10, lidMat, W / 2 + 0.45, 0.8, D / 2 - 0.3, false));
  g.add(cyl(0.05, 0.05, 3.0, 6, frame, -W / 2 + 0.25, 1.5, D / 2 + 0.35, false));
  g.add(box(0.25, 0.22, 0.25, dark, -W / 2 + 0.25, 0.12, D / 2 + 0.35, false));
  g.add(box(0.6, 0.45, 0.06, adMat, -W / 2 + 0.25, 2.75, D / 2 + 0.35, false));
  g.add(box(0.6, 0.08, 0.07, mat(0xffffff), -W / 2 + 0.25, 2.75, D / 2 + 0.38, false));
  g.add(box(0.5, 0.28, 0.08, mat(0x101418, { emissive: 0x113355, emissiveIntensity: 0.3 }), 0.6, postH - 0.5, D / 2 + 0.07, false));
  return g;
}
// ---- Construction scaffolding — 4 distinct "installer styles" with randomized size/colors per instance ----
const FRAME_COLORS = [0x8a8f96, 0x6f7a8c, 0xe8b23a, 0xb5651d];
const NET_COLORS = [0x3fae5a, 0x2f6fb0, 0x2a2a2a, 0xdedede, 0xff8a1a];
const PLANK_COLORS = [0xb98a4e, 0x9c7a4e, 0x8a8f96, 0xc9a06a];
const SIGN_COLORS = [0xd64545, 0x2f6fb0, 0xe8b02a, 0x3f9e48];
function buildScaffoldMesh(o) {
  const g = new THREE.Group();
  const steel = mat(o.frame), plank = mat(o.plank);
  const w = o.w, d = o.d, h = o.h, bays = o.bays, levels = o.levels, bayW = w / bays, lvH = h / levels;
  for (let i = 0; i <= bays; i++) { const x = -w / 2 + i * bayW; for (const sz of [-1, 1]) g.add(box(0.1, h, 0.1, steel, x, h / 2, sz * d / 2, false)); }
  for (let lv = 0; lv <= levels; lv++) {
    const y = Math.min(h, lv * lvH);
    for (const sz of [-1, 1]) g.add(box(w, 0.07, 0.07, steel, 0, y, sz * d / 2, false));
    g.add(box(0.07, 0.07, d, steel, -w / 2, y, 0, false)); g.add(box(0.07, 0.07, d, steel, w / 2, y, 0, false));
    if (lv > 0) {
      const showPlank = o.style !== 1 || lv % 2 === 1;
      if (showPlank) g.add(box(w - 0.12, 0.08, d - 0.2, plank, 0, y - lvH * 0.06, 0, false));
      if (o.style === 1) for (const sz of [-1, 1]) g.add(box(w - 0.1, 0.22, 0.05, mat(0xff7a1a), 0, y - lvH + 0.16, sz * d / 2, false));
    }
  }
  for (let i = 0; i < bays; i++) {
    if ((i + (o.style === 0 ? 0 : 1)) % 2 !== 0) continue;
    const x0 = -w / 2 + i * bayW, x1 = x0 + bayW, lvPick = 1 + (i % levels);
    const y0 = (lvPick - 1) * lvH, y1 = lvPick * lvH;
    const diag = box(Math.hypot(bayW, lvH), 0.05, 0.05, steel, (x0 + x1) / 2, (y0 + y1) / 2, d / 2, false);
    diag.rotation.z = Math.atan2(y1 - y0, x1 - x0) * (i % 2 === 0 ? 1 : -1); g.add(diag);
  }
  if (o.style === 0 || o.style === 1) {
    const lx = -w / 2 - 0.06;
    g.add(box(0.05, h, 0.3, steel, lx, h / 2, 0, false));
    for (let y = 0.4; y < h; y += 0.5) g.add(box(0.3, 0.04, 0.04, steel, lx, y, 0, false));
  }
  if (o.style === 2) {
    const net = mat(o.net, { transparent: true, opacity: 0.6 });
    g.add(box(w + 0.15, h, 0.05, net, 0, h / 2, d / 2 + 0.08, false)); g.add(box(w + 0.15, h, 0.05, net, 0, h / 2, -d / 2 - 0.08, false));
    g.add(box(0.05, h, d + 0.15, net, w / 2 + 0.08, h / 2, 0, false)); g.add(box(0.05, h, d + 0.15, net, -w / 2 - 0.08, h / 2, 0, false));
    g.add(box(Math.min(w * 0.55, 3.2), 1.1, 0.07, mat(o.sign), 0, h * 0.62, d / 2 + 0.12, false));
  } else {
    const net = mat(o.net, { transparent: true, opacity: 0.28 });
    g.add(box(w + 0.1, h, 0.04, net, 0, h / 2, d / 2 + 0.06, false));
  }
  if (o.style === 3) {
    const cz = d * 0.15, cd = d + 1.8;
    g.add(box(w + 1.1, 0.14, cd, mat(0xffcf2e), 0, 2.5, cz, false));
    g.add(box(w + 1.1, 0.1, 0.12, mat(0x2a2a2a), 0, 2.42, cz + cd / 2, false));
    for (const sx of [-1, 1]) g.add(box(0.14, 2.5, 0.14, mat(0x2a2a2a), sx * (w / 2 + 0.4), 1.25, d / 2 + 1.4, false));
  }
  return g;
}
function generateChunk(cx, cz) {
  const rng = mulberry32(hash2(cx, cz) ^ 0x51ED);
  const r = (a = 0, b = 1) => a + (b - a) * rng();
  const x0 = cx * CHUNK, z0 = cz * CHUNK, bx = x0 + 40, bz = z0 + 40, bx0 = x0 + 12, bz0 = z0 + 12;
  const group = new THREE.Group();
  const ch = { cx, cz, group, solids: [], props: [], pickups: [], ramps: [], busStops: [], geos: [], bakeList: [], trees: [], insts: [] };
  const safe = (cx === 0 || cx === -1) && (cz === 0 || cz === -1);
  const add = o => bake(ch, o);
  const solid = (x, z, hx, hz, kind) => ch.solids.push({ x, z, hx, hz, kind, box: { x, z, ux: 1, uz: 0, vx: 0, vz: 1, e1: hx, e2: hz } });
  const prop = (kind, x, z, rotY = 0, y = 0.15) => {
    const d = PROP_DEFS[kind], m = d.make(); m.position.set(x, y, z); m.rotation.y = rotY; group.add(m);
    ch.props.push({ mesh: m, x, z, r: d.r, drag: d.drag, color: d.color, kind, broken: false });
  };
  const tree = (x, z, y = 0.2) => {
    const v = rng() < 0.45 ? 4 + Math.floor(rng() * 2) : Math.floor(rng() * 4), rot = rng() * PI;
    solid(x, z, 0.65, 0.65, 'tree');
    const t = { x, y, z, v, rot, broken: false, im: null, i: 0, solid: ch.solids[ch.solids.length - 1] };
    t.solid.tree = t; ch.trees.push(t);
  };
  // Parked car at the curb — registered as a solid, but linked to a destructible record (s.parked).
  // Light taps behave like a static obstacle; a hard enough hit wrecks it (see collisions.js breakParkedCar).
  const parkedCar = (x, z, hx, hz, rotY, kind, color) => {
    const dims = CAR_DIMS[kind] || CAR_DIMS.civ;
    const m = buildCar(kind, color, false);
    m.position.set(x, 0.1, z); m.rotation.y = rotY; group.add(m);
    solid(x, z, hx, hz, 'parkedcar');
    const sEntry = ch.solids[ch.solids.length - 1];
    sEntry.parked = { mesh: m, x, z, mass: dims.mass, color, broken: false, solid: sEntry };
  };
  // Bus stop shelter on the sidewalk — a real solid (destructible), and a navigation target for AI buses (see civilians.js).
  const busStop = (side, alongLocal) => {
    const axisIsZ = side < 2;
    const roadCoord = side === 0 ? x0 : side === 1 ? x0 + CHUNK : side === 2 ? z0 : z0 + CHUNK;
    const curb = side === 0 ? x0 + 9.6 : side === 1 ? x0 + CHUNK - 9.6 : side === 2 ? z0 + 9.6 : z0 + CHUNK - 9.6;
    const x = axisIsZ ? curb : x0 + alongLocal, z = axisIsZ ? z0 + alongLocal : curb;
    const rotY = side === 0 ? -PI / 2 : side === 1 ? PI / 2 : side === 2 ? PI : 0;
    const variant = BUS_LIVERIES[Math.floor(rng() * BUS_LIVERIES.length)];
    const g = mergeStandalone(buildBusStopMesh(variant)); g.position.set(x, 0, z); g.rotation.y = rotY; group.add(g);
    const halfW = BUSSTOP_W / 2 + 0.3, halfD = BUSSTOP_D / 2 + 0.3;
    const hx = axisIsZ ? halfD : halfW, hz = axisIsZ ? halfW : halfD;
    solid(x, z, hx, hz, 'busstop');
    const sEntry = ch.solids[ch.solids.length - 1];
    const rec = { mesh: g, x, z, axis: axisIsZ ? 'z' : 'x', road: roadCoord, along: axisIsZ ? z : x, broken: false, solid: sEntry };
    sEntry.busstop = rec; ch.busStops.push(rec);
  };
  // Construction scaffolding against a building — a real destructible solid, randomized size/style per instance.
  const scaffold = (x, z, rotY, o) => {
    const g = mergeStandalone(buildScaffoldMesh(o)); g.position.set(x, 0, z); g.rotation.y = rotY; group.add(g);
    const swap = Math.abs(Math.cos(rotY)) < 0.5;
    const hx = swap ? o.d / 2 + 0.3 : o.w / 2 + 0.3, hz = swap ? o.w / 2 + 0.3 : o.d / 2 + 0.3;
    solid(x, z, hx, hz, 'scaffold');
    const sEntry = ch.solids[ch.solids.length - 1];
    sEntry.scaffold = { mesh: g, x, z, broken: false, solid: sEntry };
  };
  const ramp = (x, z, tilt) => { const m = box(6.5, .7, 12, mat(0xae7438), x, .52, z, false); m.rotation.x = tilt; add(m); ch.ramps.push({ x, z, r: 6.5, last: -99 }); };
  const ground = new THREE.Mesh(ASSET.groundGeo, ASSET.roadMat); ground.position.set(bx, 0, bz); ground.receiveShadow = true; group.add(ground);
  add(box(64, 0.15, 64, mat(0xb8bcc4), bx, 0.075, bz, false));
  // Raised block apron doubles as the sidewalk; keep its textured mesh separate from the static merge
  // so its tiled UVs stay intact, and choose the paving deterministically per chunk.
  const sidewalk = new THREE.Mesh(ASSET.sidewalkGeo, ASSET.sidewalkMats[hash2(cx, cz) % ASSET.sidewalkMats.length]);
  sidewalk.position.set(bx, 0.16, bz); sidewalk.receiveShadow = true; group.add(sidewalk);
  // Traffic light set at this chunk's corner (every chunk corner = one 4-way intersection, built exactly once)
  buildIntersection(x0, z0, group);
  const t = rng();
  const type = t < 0.4 ? 'downtown' : t < 0.68 ? 'suburb' : t < 0.82 ? 'park' : 'industrial';
  if (type === 'downtown') {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const lx = bx0 + 14 + i * 28, lz = bz0 + 14 + j * 28;
      if (rng() < 0.12) { // plaza
        add(box(24, 0.1, 24, mat(0xd9d2c3), lx, 0.2, lz, false));
        tree(lx - 8, lz - 8, 0.25); tree(lx + 8, lz + 8, 0.25); if (rng() < 0.6) tree(lx + 8, lz - 8, 0.25);
        continue;
      }
      const w = r(16, 25), d = r(16, 25), h = 14 + Math.pow(rng(), 1.6) * 48;
      const geo = makeBuildingGeo(w, h, d), wm = ASSET.windowMats[Math.floor(rng() * ASSET.windowMats.length)];
      const mesh = new THREE.Mesh(geo, [wm, wm, ASSET.roofMat, ASSET.roofMat, wm, wm]);
      mesh.position.set(lx, h / 2 + 0.15, lz); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); ch.geos.push(geo);
      solid(lx, lz, w / 2, d / 2, 'building');
      // rooftop details
      if (h > 30) { add(box(w * 0.5, 5, d * 0.5, wm === ASSET.windowMats[0] ? mat(0xcfd4da) : mat(0xd9cbbd), lx, h + 2.65, lz)); add(cyl(0.12, 0.12, 7, 6, mat(0xdd3b3b), lx, h + 8.6, lz)); }
      else add(box(3.5, 1.8, 3.5, mat(0xaab0b8), lx + r(-4, 4), h + 1.05, lz + r(-4, 4)));
      // Occasional construction scaffolding against a tall building — 4 distinct styles, randomized size, with
      // reflective warning cones placed along the sidewalk line in front of it.
      if (h > 20 && rng() < 0.3) {
        const sideS = Math.floor(rng() * 4), faceLen = (sideS === 0 || sideS === 1) ? d : w;
        const sw = Math.max(4, Math.min(15, faceLen * r(0.5, 0.85)));
        const sh = Math.max(6, Math.min(h - 1.5, h * r(0.55, 0.92)));
        const sd = r(1.5, 2.2), bays = Math.max(2, Math.round(sw / r(1.8, 2.4))), levels = Math.max(3, Math.min(6, Math.round(sh / 2.6)));
        const style = Math.floor(rng() * 4);
        const o = { w: sw, d: sd, h: sh, bays, levels, style, frame: FRAME_COLORS[Math.floor(rng() * FRAME_COLORS.length)], net: NET_COLORS[Math.floor(rng() * NET_COLORS.length)], plank: PLANK_COLORS[Math.floor(rng() * PLANK_COLORS.length)], sign: SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)] };
        const dx = sideS === 0 ? w / 2 + sd / 2 + 0.6 : sideS === 1 ? -(w / 2 + sd / 2 + 0.6) : 0;
        const dz = sideS === 2 ? d / 2 + sd / 2 + 0.6 : sideS === 3 ? -(d / 2 + sd / 2 + 0.6) : 0;
        const rotS = (sideS === 0 || sideS === 1) ? PI / 2 : 0;
        const sx = lx + dx, sz = lz + dz;
        scaffold(sx, sz, rotS, o);
        const cdx = sideS === 0 ? 1 : sideS === 1 ? -1 : 0, cdz = sideS === 2 ? 1 : sideS === 3 ? -1 : 0;
        const coneCount = Math.max(3, Math.round(sw / 1.6)), step = sw / Math.max(1, coneCount - 1);
        for (let k = 0; k < coneCount; k++) {
          const off = -sw / 2 + k * step;
          const cx2 = rotS === 0 ? sx + off : sx + cdx * 1.0, cz2 = rotS === 0 ? sz + cdz * 1.0 : sz + off;
          prop('cone', cx2, cz2, rng() * PI, 0);
        }
      }
    }
  } else if (type === 'suburb') {
    add(box(56, 0.1, 56, mat(0x7bc96f), bx, 0.2, bz, false));
    const roofs = [0xc0503a, 0x8a4b38, 0x4f6d8a, 0x6b5b95, 0x9b5d3a], walls = [0xf2e4c9, 0xf7d7d0, 0xd5e8d4, 0xcfe0f0, 0xfdf0b8];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const lx = bx0 + 9.33 + i * 18.67, lz = bz0 + 9.33 + j * 18.67;
      const w = r(8, 10), d = r(7, 9), h = r(4.5, 6), ox = r(-1, 1), oz = r(-1, 1), hx = lx + ox, hz = lz + oz;
      const wc = walls[Math.floor(rng() * walls.length)], rc = roofs[Math.floor(rng() * roofs.length)];
      add(box(w, h, d, mat(wc), hx, h / 2 + 0.25, hz));
      const roof = new THREE.Mesh(ASSET.roofGeo, mat(rc)); roof.scale.set(w * 1.15, 3.2, d * 1.15); roof.position.set(hx, h + 0.25 + 1.6, hz); roof.castShadow = true; add(roof);
      add(box(1.2, 2.1, 0.12, mat(0x5a3a22), hx, 1.3, hz + d / 2 + 0.05, false));
      for (const sx of [-1, 1]) { add(box(1.5, 1.4, 0.1, mat(0x4f7fb5), hx + sx * w * 0.28, h * 0.58, hz + d / 2 + 0.04, false)); add(box(1.5, 1.4, 0.1, mat(0x4f7fb5), hx + sx * w * 0.28, h * 0.58, hz - d / 2 - 0.04, false)); }
      add(box(1.1, 2.2, 1.1, mat(0x8a5a44), hx + w * 0.3, h + 1.3, hz - d * 0.2));
      solid(hx, hz, w / 2, d / 2, 'building');
      const cs = rng() < 0.5 ? 1 : -1, cs2 = rng() < 0.5 ? 1 : -1;
      tree(lx + cs * 7.6, lz + cs2 * 7.6);
      if (rng() < 0.4) tree(lx - cs * 7.6, lz + cs2 * 7.6);
    }
    for (const side of [-1, 1]) for (let x = -25.5; x <= 26; x += 4.2) if (rng() > 0.25) prop('fence', bx + x, bz + side * 28.6, 0, 0.2);
  } else if (type === 'park') {
    add(box(56, 0.1, 56, mat(0x78c46c), bx, 0.2, bz, false));
    add(box(56, 0.04, 3.4, mat(0xe3d6b0), bx, 0.27, bz, false)); add(box(3.4, 0.04, 56, mat(0xe3d6b0), bx, 0.27, bz, false));
    const pw = r(10, 15), pd = r(8, 11), px = bx + (rng() < 0.5 ? -1 : 1) * r(10, 14), pz = bz + (rng() < 0.5 ? -1 : 1) * r(11, 16);
    add(box(pw, 0.06, pd, mat(0x58b6e8), px, 0.27, pz, false));
    const placed = [];
    for (let a = 0, n = 0; a < 70 && n < 16; a++) {
      const x = bx + r(-26, 26), z = bz + r(-26, 26);
      if (Math.abs(x - bx) < 4.5 || Math.abs(z - bz) < 4.5) continue;
      if (Math.abs(x - px) < pw / 2 + 2 && Math.abs(z - pz) < pd / 2 + 2) continue;
      if (placed.some(p => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 49)) continue;
      placed.push([x, z]); tree(x, z); n++;
    }
    prop('bench', bx - 8, bz - 2.5, 0, 0.3); prop('bench', bx + 9, bz + 2.5, PI, 0.3); prop('bench', bx - 2.5, bz + 10, PI / 2, 0.3);
    for (let i = 0; i < 10; i++) add(box(0.4, 0.3, 0.4, mat([0xff6fa5, 0xffd23b, 0xffffff, 0xb07cff][i % 4]), bx + r(-26, 26), 0.4, bz + r(-26, 26), false));
  } else { // industrial
    add(box(56, 0.1, 56, mat(0x9b9da4), bx, 0.2, bz, false));
    const wc = [0x6c8ebf, 0xb8b2a7, 0xc98a5e, 0x7fa38a];
    for (let i = 0; i < 2; i++) {
      const x = bx0 + 15 + i * 27, z = bz0 + 17, h = r(8, 13), col = wc[Math.floor(rng() * wc.length)];
      add(box(26, h, 30, mat(col), x, h / 2 + 0.25, z)); add(box(26.6, 0.8, 30.6, mat(0x5a5f68), x, h + 0.65, z));
      for (let k = -1; k <= 1; k++) add(box(6, 4.2, 0.2, mat(0x30343b), x + k * 8, 2.35, z + 15.1, false));
      add(cyl(0.6, 0.6, 3, 8, mat(0x888d96), x + r(-8, 8), h + 2.4, z + r(-8, 8)));
      solid(x, z, 13, 15, 'building');
    }
    const cc = [0xd9534f, 0x3b82c4, 0xf2b134, 0x4caf50, 0xe8e8e8];
    for (let row = 0; row < 2; row++) for (let c = 0; c < 3; c++) {
      if (rng() < 0.2) continue;
      const x = bx0 + 9 + c * 19 + r(-2, 2), z = bz0 + (row ? 52 : 39.5);
      add(box(12, 2.6, 2.5, mat(cc[Math.floor(rng() * cc.length)]), x, 1.55, z));
      if (rng() < 0.4) add(box(12, 2.6, 2.5, mat(cc[Math.floor(rng() * cc.length)]), x + r(-1, 1), 4.15, z));
      solid(x, z, 6, 1.25, 'container');
    }
    for (let i = 0; i < 6; i++) prop('barrel', bx0 + r(6, 50), bz0 + r(34.5, 37.5) + (i % 2) * 8.5, 0, 0.2);
    if (rng() < .72) ramp(bx + (rng() < .5 ? -4 : 4), bz + r(-20, 20), rng() < .5 ? .13 : -.13);
  }
  // Streetlights
  for (const s of [-1, 1]) for (const o of [-16, 16]) {
    if (rng() < 0.8) { prop('streetlight', bx + s * 30.4, bz + o, 0); prop('streetlight', bx + o, bz + s * 30.4, 0); }
    if (rng() < 0.45) prop('hydrant', bx + s * 30.6, bz - o * 0.45, 0, 0.15);
    if (rng() < 0.45) prop('hydrant', bx - o * 0.45, bz + s * 30.6, 0, 0.15);
  }
  if (!safe) {
    // Bus stops — occasional, on the sidewalk; reserves a clear zone so no car parks in front of it
    const busReserved = [];
    for (const side of [0, 1, 2, 3]) {
      if (rng() > 0.07) continue;
      const alongLocal = r(20, 60);
      busStop(side, alongLocal);
      busReserved.push({ side, along: alongLocal });
    }
    // Parked cars at the curb — destructible (see parkedCar helper above)
    const carCols = [0xe34a4a, 0x3a7bd5, 0x39b36b, 0xf2a93b, 0xeeeeee, 0x8e5bd9, 0x2f3340];
    const parkKinds = ['civ', 'hatchback', 'suv', 'oldclassic'];
    for (const side of [0, 1, 2, 3]) {
      if (rng() > 0.09) continue;
      const along = r(14, 66), alongX = side >= 2;
      if (busReserved.some(b => b.side === side && Math.abs(b.along - along) < 11)) continue;
      const x = side === 0 ? x0 + 6.4 : side === 1 ? x0 + 73.6 : x0 + along;
      const z = side === 2 ? z0 + 6.4 : side === 3 ? z0 + 73.6 : z0 + along;
      const rotY = alongX ? (rng() < 0.5 ? PI / 2 : -PI / 2) : (rng() < 0.5 ? 0 : PI);
      const kind = parkKinds[Math.floor(rng() * parkKinds.length)];
      parkedCar(x, z, alongX ? 2.1 : 1.0, alongX ? 1.0 : 2.1, rotY, kind, carCols[Math.floor(rng() * carCols.length)]);
    }
    // Roadside trash — sometimes a single can/bag, sometimes a messy cluster of cans+bags+cartons
    for (const side of [0, 1, 2, 3]) {
      if (rng() > 0.45) continue;
      const along = r(14, 66);
      const cx = side === 0 ? x0 + 10.4 : side === 1 ? x0 + 69.6 : x0 + along;
      const cz = side === 2 ? z0 + 10.4 : side === 3 ? z0 + 69.6 : z0 + along;
      const roll = rng();
      const n = roll < 0.4 ? 1 : roll < 0.72 ? 2 : roll < 0.9 ? 3 : 4;
      const mix = ['trashcan', 'trashbag', 'trashbag', 'cardboard'];
      for (let i = 0; i < n; i++) {
        const kind = n === 1 ? (rng() < 0.55 ? 'trashcan' : 'trashbag') : mix[Math.floor(rng() * mix.length)];
        const ox = i === 0 ? 0 : r(-0.85, 0.85), oz = i === 0 ? 0 : r(-0.85, 0.85);
        prop(kind, cx + ox, cz + oz, rng() * PI, kind === 'trashcan' ? 0.1 : 0.05);
      }
    }
    // Road construction — one lane closed off, picked from several distinct "site styles" so no two look alike.
    // Purely cosmetic/breakable like other props; the opposite lane always stays fully open.
    if (rng() < 0.2) {
      const side = Math.floor(rng() * 4), vert = side < 2;
      const centerline = side === 0 ? x0 : side === 1 ? x0 + CHUNK : side === 2 ? z0 : z0 + CHUNK;
      const dirSign = rng() < 0.5 ? 1 : -1, laneOff = rng() < 0.5 ? 2.5 : 6;
      const fixed = centerline + dirSign * laneOff, alongBase = vert ? z0 : x0;
      const start = r(16, 38), len = r(12, 22);
      const at = off => vert ? [fixed, alongBase + off] : [alongBase + off, fixed];
      const style = Math.floor(rng() * 4);
      const patchCol = [0x57514a, 0x6b5a46, 0x2c2e33, 0x8a8a82][style];
      const [mx, mz] = at(start + len * 0.5);
      add(box(vert ? 3.2 : len + 2, 0.05, vert ? len + 2 : 3.2, mat(patchCol), mx, 0.09, mz, false));
      const [sgx, sgz] = at(start - 3.2);
      prop('sign', sgx, sgz, vert ? 0 : PI / 2, 0);
      if (style === 0) { // simple cone taper
        for (let d = 0; d <= len; d += r(2.0, 2.6)) { const [px, pz] = at(start + d); prop('cone', px, pz, rng() * PI, 0); }
        const [b1x, b1z] = at(start - 1.4); prop('barrier', b1x, b1z, vert ? 0 : PI / 2, 0);
        const [b2x, b2z] = at(start + len + 1.4); prop('barrier', b2x, b2z, vert ? 0 : PI / 2, 0);
      } else if (style === 1) { // barrier corridor
        for (let d = 0; d <= len; d += 4.4) { const [px, pz] = at(start + d); prop('barrier', px, pz, vert ? 0 : PI / 2, 0); }
        for (let n = 0; n < 3; n++) { const [cxp, czp] = at(start + r(2, len - 2)); prop('crate', cxp + r(-0.4, 0.4), czp + r(-0.4, 0.4), rng(), 0); }
        const [c1x, c1z] = at(start - 1.6); prop('cone', c1x, c1z, 0, 0);
        const [c2x, c2z] = at(start + len + 1.6); prop('cone', c2x, c2z, 0, 0);
      } else if (style === 2) { // dig site
        const [dpx, dpz] = at(start + len * 0.5); prop('dirtpile', dpx, dpz, rng() * PI, 0);
        const [ppx, ppz] = at(start + len * 0.25); prop('pipe', ppx, ppz, vert ? PI / 2 : 0, 0);
        for (let n = 0; n < 2; n++) { const [brx, brz] = at(start + r(len * 0.5, len - 1)); prop('barrel', brx, brz, 0, 0); }
        for (let d = -1.6; d <= len + 1.6; d += r(3.2, 4)) { const [px, pz] = at(start + d); prop('cone', px, pz, rng() * PI, 0); }
      } else { // equipment yard
        const [d1x, d1z] = at(start - 1.4); prop('drum', d1x, d1z, 0, 0);
        const [d2x, d2z] = at(start + len + 1.4); prop('drum', d2x, d2z, 0, 0);
        for (let n = 0; n < 3; n++) { const [crx, crz] = at(start + r(2, len - 2)); prop(rng() < 0.5 ? 'crate' : 'barrel', crx + r(-0.5, 0.5), crz + r(-0.5, 0.5), rng(), 0); }
      }
    }
    // Pickups (cash lines, repair kits, nitro canisters)
    const nLines = rng() < 0.55 ? 1 : 0, extra = rng() < 0.2 ? 1 : 0;
    for (let n = 0; n < nLines + extra; n++) {
      const vert = rng() < 0.5, lane = (rng() < 0.5 ? -1 : 1) * 4, start = r(20, 45);
      const kr = rng();
      if (kr < 0.3) { const px = vert ? x0 + lane : x0 + start, pz = vert ? z0 + start : z0 + lane; addPickup(ch, kr < 0.12 ? 'repair' : 'nitro', px, pz); continue; }
      for (let i = 0; i < 5; i++) addPickup(ch, 'cash', vert ? x0 + lane : x0 + start + i * 4, vert ? z0 + start + i * 4 : z0 + lane);
    }
  }
  buildTreeInstances(ch);
  finishChunk(ch);
  scene.add(group);
  return ch;
}
function addPickup(ch, kind, x, z) {
  let m;
  if (kind === 'cash') m = new THREE.Mesh(ASSET.coinGeo, ASSET.coinMat);
  else if (kind === 'nitro') {
    m = new THREE.Group();
    m.add(box(1.0, 1.8, 1.0, mat(0x2a8bff, { emissive: 0x0a3a8a }), 0, 0, 0, false));
    m.add(box(1.1, 0.28, 1.1, mat(0xdfefff), 0, 0.6, 0, false));
    m.add(box(0.5, 0.5, 1.12, mat(0xffe14a, { emissive: 0x7a5a00 }), 0, -0.1, 0, false));
    m.add(box(1.12, 0.5, 0.5, mat(0xffe14a, { emissive: 0x7a5a00 }), 0, -0.1, 0, false));
  }
  else { m = new THREE.Group(); m.add(box(1.5, 1.5, 1.5, mat(0x2fbf4f, { emissive: 0x0a4a1a }), 0, 0, 0, false)); m.add(box(1.0, 0.3, 1.6, mat(0xffffff), 0, 0, 0, false)); m.add(box(0.3, 1.0, 1.6, mat(0xffffff), 0, 0, 0, false)); }
  m.position.set(x, 1.4, z); ch.group.add(m);
  ch.pickups.push({ mesh: m, x, z, kind, taken: false, ph: Math.random() * 6 });
}
export function disposeChunk(ch) {
  scene.remove(ch.group); ch.geos.forEach(g => g.dispose()); ch.insts.forEach(m => m.dispose());
  removeIntersection(ch.cx * CHUNK, ch.cz * CHUNK);
}
export function updateChunks(px, pz, budget) {
  const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
  for (const [k, ch] of chunks) if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) > VIEW_R + 1) { disposeChunk(ch); chunks.delete(k); }
  const need = [];
  for (let dx = -VIEW_R; dx <= VIEW_R; dx++) for (let dz = -VIEW_R; dz <= VIEW_R; dz++) {
    const cx = pcx + dx, cz = pcz + dz; if (!chunks.has(ck(cx, cz))) need.push({ cx, cz, d: dx * dx + dz * dz });
  }
  need.sort((a, b) => a.d - b.d);
  for (let i = 0; i < Math.min(budget, need.length); i++) chunks.set(ck(need[i].cx, need[i].cz), generateChunk(need[i].cx, need[i].cz));
}
const _near = [];
export function nearChunks(x, z) {
  _near.length = 0; const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = chunks.get(ck(cx + i, cz + j)); if (c) _near.push(c); }
  return _near;
}
export function solidAt(x, z, m) {
  const list = nearChunks(x, z);
  for (const ch of list) for (const s of ch.solids) if (Math.abs(x - s.x) < s.hx + m && Math.abs(z - s.z) < s.hz + m) return true;
  return false;
}
