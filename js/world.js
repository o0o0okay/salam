/* Procedural city: chunk generation, streaming, spatial queries */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK, VIEW_R, PI, mulberry32, hash2, ck } from './utils.js';
import { scene } from './renderer.js';
import { mat, box, cyl, ASSET, makeBuildingGeo, facadeMat } from './assets.js';

// Paints of the brick walk-ups (red, brown, cream stone, sage, rose, teal, mustard, slate) and of the brick houses
// in the suburbs: the palette of the reference street art, where no two neighbouring fronts match.
const WALKUP_WALLS = [0xa9503a, 0x8c5a40, 0xd9c9a3, 0x7d9c73, 0xd98f9a, 0x4f9c98, 0xd6a846, 0x6f86a6];
const HOUSE_BRICK = [0xa9503a, 0x8c5a40, 0xd6c7a1, 0x9a6a58];
const IRON = 0x3b3f45;
import { buildCar, CAR_DIMS } from './carModels.js';
import { PROP_DEFS } from './props.js';
import { TREE_VARIANTS, setTreeMatrix } from './trees.js';
import { buildIntersection, removeIntersection } from './trafficLights.js';
import { FLY, RAMP_RUN, rampHeight, insideFootprint, flyoverQuadrants, atGradeSide, onAtGradeLane, roadEdge, nodeAt, besideFlyover, plazaAt } from './flyover.js';
// A coat of the road's own asphalt: the road's material with a plain patch of asphalt on it in place of the
// painted tile, so a piece that has to cover a marking the texture already drew there — the straight crossings
// the texture paints at a corner the flyover has cut — lights and reads like the surface it lies on instead of
// like a flat rectangle laid over it. Used by the crossings beside a cut corner (`FLY.chamfer`).
const ROAD_COAT = (() => {
  if (typeof document === 'undefined') return mat(0x3b3f4a);   // the audits run with assets.js stubbed and no canvas
  const c = document.createElement('canvas'); c.width = c.height = 4;
  const g = c.getContext('2d'); g.fillStyle = '#3b3f4a'; g.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = ASSET.roadMat.clone(); m.map = t;
  return m;
})();
import { env } from './environment.js';
export const chunks = new Map();
// ---- Car-park occupancy ----
// Ordinary cars standing in a car park at a given time of day. Shared by the chunk generator and the live
// parking system in traffic.js so both always agree: a lot never drops below `floorCars` ordinary cars, never
// exceeds 20% of its bays once the permanently parked vehicles (hospital ambulances) are counted in, and peaks
// in the middle of the day. env.phase: 0 = 06:00, 0.25 = noon, 0.5 = 18:00, 0.75 = midnight.
// ---- Heavy parked vehicles ----
// A parked ambulance or fire engine is not a light shell to toss around: it takes the hit like a moving
// weight — shifts a little, absorbs speed, builds up damage and finally burns where it stands. Anything at
// or above HEAVY_MASS is handled that way; lighter parked cars keep the arcade launch.
export const HEAVY_MASS = 2.5;
export const isHeavyParked = mass => (mass || 0) >= HEAVY_MASS;
// How far a heavy vehicle shifts when something hits it at `vn` m/s: a couple of centimetres at parking
// speeds, up to about a metre from a full-speed ram, less the heavier it is.
export const parkedShove = (mass, vn) => Math.min(1.6, Math.max(0, vn - 4) * 0.045) * (3.2 / Math.max(3.2, mass));
// Damage a heavy vehicle takes from that hit: heavy things shrug off light taps and need a real ram.
// Tuned against the real table — at ~34 m/s a full-speed ram wrecks an ambulance in about two hits and a
// fire engine in about three, while a 5 m/s nudge does nothing at all.
export const parkedDamage = (mass, vn) => Math.min(200, Math.max(0, vn - 4) * 5.6 / Math.pow(Math.max(0.5, mass), 0.4));
// Seconds a bay in an ordinary car park stays empty after its car is rammed away before a fresh arrival
// takes it. This is only for the public lots (mall/hospital bays for ordinary cars): the permanent roster
// bays — fire appliances and ambulances — are never refilled at all, so nothing ever respawns.
export const RELIEF_DELAY = 10;
// How many ambulances a hospital car park holds at a given time of day: three through the night and two
// during the day, when one unit is out on a call. Always inside the 2-3 range the hospital asks for.
export function ambulanceTarget(phase) {
  const hour = (phase * 24 + 6 + 24) % 24;
  return (hour >= 20 || hour < 6) ? 3 : 2;
}
export function lotCars(bays, fixed, phase, floorCars = 2) {
  if (bays <= 0) return 0;
  const max = Math.max(floorCars, Math.floor(bays * 0.2) - fixed);
  const hour = (phase * 24 + 6 + 24) % 24;
  const t = Math.max(0, 1 - Math.abs(hour - 13) / 11);       // 0 in the small hours, 1 around 13:00
  return Math.min(max, floorCars + Math.round(t * t * (max - floorCars)));
}
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
  for (const [m, geos] of byMat) mergeSlice(ch, m, geos);
  ch.bakeList = null;
}
// One merged mesh for a slice of pieces that share a material. If a single material carries an enormous number
// of pieces the work is split into slices, so no single merge call can become the frame.
const MERGE_SLICE = 400;
function mergeSlice(ch, m, geos) {
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
// A merged stand-alone piece — one street prop, one bus shelter, one scaffold, one shop window, one fuel
// dispenser — is built for one block and nobody else ever draws it again. Its merged geometry is *owned* by
// that block and has to be handed back when the block streams out: `own()` registers it. Without this the
// block's merged pieces were never disposed, so every block the player drove past left its vertex buffers in
// the GPU for the rest of the session (see the streaming notes in tools/sidewalk-checks/README.md).
function own(ch, obj) {
  obj.traverse(o => { if (o.isMesh && o.geometry) ch.owned.push(o.geometry); });
  return obj;
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
// ---- Sidewalk ----
// The sidewalk is a ring around every block: a kerb stone standing 0.16 m out of the asphalt, a stone-slab
// walking field, a slab border course against the kerb, and a low kerb wall along the building line.
// Street trees grow out of soil beds edged with kerb stone, so the planting reads as real "جدولبندی".
export const PAVE_IN = 8.0;          // road edge: 8 m each side of the centre line = a 16 m street
export const PAVE_OUT = 12.6;        // where a block's paving ends: the kerb stone stands at PAVE_IN..PAVE_IN+0.5,
                                     // the walk behind it PAVE_IN+0.5..PAVE_OUT, and the block's own ground begins
                                     // here. On a side that carries an interchange's at-grade lane the kerb steps
                                     // out by `FLY.atGrade` (that strip is carriageway: the lane) and the far side of
                                     // the paving by `FLY.frontage`, so the lane's width comes out of the frontage
                                     // and the walk behind the kerb keeps the width it has
const CURB_H = 0.16, WALK_Y = 0.18;  // kerb height above the road, top of the paving
const BORDER_W = 1.3, KERB_W = 0.35;
const BED = 0.85, BED_EDGE = 0.15;   // tree-pit soil bed (half size) and the width of its kerb edging
const PIT_IN = 9.9;                  // distance from the road centre line to the centre of a tree pit
export const PAD_IN = PAVE_OUT - 0.6;   // where a block's own ground cover (lot, grass, concrete pad) stops:
                                     // the buildings of a block stand on the outer 0.6 m of the paving's border
                                     // course, and beside an at-grade lane the whole line moves out by FLY.frontage
const CURB_TILE = 1, PAVE_TILE = 4.8, BORDER_TILE = 2.6;
// `dy` lifts two of the four strips by 2 mm: neighbouring strips overlap at the block corners, and this
// decides the winner there without any visible step (same material, same pattern).
const SIDEWALK_SIDES = [
  { along: 'z', fixed: -1, dy: 0.002 },   // west edge of the block
  { along: 'z', fixed: 1, dy: 0.002 },    // east edge
  { along: 'x', fixed: -1, dy: 0 },       // south edge
  { along: 'x', fixed: 1, dy: 0 },        // north edge
];
// ---- Sidewalk styles ----
// Four treatments, mixed across the city so neighbouring blocks never look identical:
//   slab   large pale stone slabs with a border course (the original downtown paving)
//   panel  big weathered concrete panels with hairline cracks — industrial and modern blocks
//   brick  red running-bond brick paving for shopping streets
//   verge  a grass strip with trees between kerb and walkway, suburban style
const SW_STYLES = {
  slab:  { mat: 'pavingMat',    tile: 4.8, verge: 0,   bed: true },
  panel: { mat: 'pavePanelMat', tile: 4.8, verge: 0,   bed: true },
  brick: { mat: 'paveBrickMat', tile: 2.4, verge: 0,   bed: true },
  verge: { mat: 'pavePanelMat', tile: 4.8, verge: 1.7, bed: false },
};
function pickSidewalkStyle(type, rng) {
  if (type === 'suburb') return 'verge';                                  // grass verge, suburban walk
  if (type === 'industrial') return 'panel';                              // big weathered concrete panels
  if (type === 'downtown') return rng() < 0.45 ? 'panel' : 'slab';        // modern vs classic stone
  if (type === 'commercial') return rng() < 0.55 ? 'brick' : 'slab';      // shopping streets lean brick
  if (type === 'hospital') return rng() < 0.6 ? 'panel' : 'slab';         // clean concrete panels by the campus
  if (type === 'fire') return 'panel';                                    // a fire station apron is plain concrete
  if (type === 'fuel') return 'panel';                                    // a forecourt is plain concrete too
  if (type === 'shops') return rng() < 0.5 ? 'brick' : 'slab';           // a shopping street gets brick or stone
  if (type === 'school') return rng() < 0.55 ? 'slab' : 'panel';      // a school frontage is plain paved stone
  return rng() < 0.5 ? 'slab' : 'panel';                                  // parks mix the two paved styles
}
// Empty box lists for one chunk's sidewalk ring. Each entry is then merged into a single mesh per material.
// How far a pavement strip stops short of the junction at one of its ends, and how much further the cut corner
// takes off it. `(ix, iz)` is the neighbouring block that shares that junction, `si` the side the strip runs on.
// The pavement uses this, and so does everything planted along it — trees, hedges, lights, hydrants — so a prop
// and the paving it stands on always start from one and the same answer.
function stripStops(ix, iz, cx, cz, si) {
  const lane = atGradeSide(cx, cz, si);
  const onLaneRoad = (ix === 0 && (atGradeSide(cx, cz, 0) || atGradeSide(cx, cz, 1)))
    || (iz === 0 && (atGradeSide(cx, cz, 2) || atGradeSide(cx, cz, 3)));
  const stop = (!lane && (nodeAt(ix, iz) || onLaneRoad)) ? roadEdge() : PAVE_IN;
  return { stop, cut: besideFlyover(ix, iz) ? FLY.chamfer : 0 };
}
function sidewalkPieces(cx, cz, style) {
  const bx = cx * CHUNK + 40, bz = cz * CHUNK + 40, E = CHUNK / 2, PH = CURB_H + 0.04;
  const x0 = bx - E, z0 = bz - E;                       // the block's own corners, for the chamfered ones
  const st = SW_STYLES[style] || SW_STYLES.slab;
  const out = { bx, bz, style, st, curb: [], walk: [], grass: [], border: [], kerb: [], bed: [], bedEdge: [] };
  for (let si = 0; si < SIDEWALK_SIDES.length; si++) {
    const s = SIDEWALK_SIDES[si];
    // A side that fronts a flyover gives the outer `FLY.atGrade` metres of its pavement back to the street: that
    // strip is the at-grade lane beside the structure, so the kerb (and the whole sidewalk ring) steps back here.
    // The frontage steps back with it (`FLY.frontage`): the lane takes its width out of the frontage, not out of
    // the walkway behind the kerb, so the pavement there keeps its width and the buildings sit a little further
    // back — which is what makes room for a full-width lane under the deck.
    const lane = atGradeSide(cx, cz, si), gap = lane ? FLY.atGrade : 0, edge = PAVE_IN + gap;
    const line = PAVE_OUT + (lane ? FLY.frontage : 0);
    // Strips stop PAVE_IN from each chunk edge: that is exactly where the crossing street's asphalt ends,
    // so no paving or kerb stone can stick out into an intersection. At an interchange it is not always enough:
    // the at-grade lane runs *through* the junction (that is the whole point of it — it is the way under the
    // deck), so a strip on the side that does not carry the lane has to stop `roadEdge()` out instead, or its
    // kerb and paving would lie across the lane and the lane would dead-end at a raised kerb every block.
    // The junctions at the strip's two ends: the strip faces the street its own block edge stands on, and runs
    // from one end of that edge to the other, so one end of it is always a junction with a crossing street.
    const rx = cx + (s.along === 'z' && s.fixed > 0 ? 1 : 0), rz = cz + (s.along === 'x' && s.fixed > 0 ? 1 : 0);
    const ends = s.along === 'z' ? [[rx, cz], [rx, cz + 1]] : [[cx, rz], [cx + 1, rz]];
    // ... nor where this block carries a lane along the road the end stands on: the lane runs the whole length of
    // the block, so the far end of a strip that meets the flying road has to clear it just the same (the lane
    // does not stop twenty metres short of the next junction).
    const stops = ends.map(([ix, iz]) => stripStops(ix, iz, cx, cz, si).stop);
    // A junction beside a flyover has its corners cut on the diagonal (`FLY.chamfer`): the strip stops that far
    // short of it, and the piece the cut takes off comes back as a rotated twin below (`chamferCorner`), so the
    // kerb, the paving and the border course all turn 45° together and the pavement reads as a mouth rather
    // than as a square. The cut is measured from the road edge along each kerb, i.e. from the strip's own kerb.
    const cuts = ends.map(([ix, iz]) => stripStops(ix, iz, cx, cz, si).cut);
    const a0 = (s.along === 'z' ? cz : cx) * CHUNK + stops[0] + cuts[0];
    const len = CHUNK - stops[0] - stops[1] - cuts[0] - cuts[1], mid = a0 + len / 2;
    const at = (radial, along) => s.along === 'z'
      ? { x: bx + s.fixed * radial, z: along }
      : { x: along, z: bz + s.fixed * radial };
    const C = s.along === 'z';                          // true when the strip runs along z (length on z)
    // ... and the twin itself: the strip's piece turned 45° across the corner. `radial` is the piece's own
    // offset from the block centre, `w` its thickness (its radial extent), so its outer face lands on the
    // diagonal and the piece comes back behind it by its own width. `sx`/`sz` say which side of the junction
    // this block is on, which is what turns the diagonal's own sense.
    const chamferCorner = (arr, w, h, radial, y, end) => {
      const [jx, jz] = [ends[end][0] * CHUNK, ends[end][1] * CHUNK];
      const sx = jx === x0 ? 1 : -1, sz = jz === z0 ? 1 : -1;
      const ex = PAVE_IN + (atGradeSide(cx, cz, sx > 0 ? 0 : 1) ? FLY.atGrade : 0);
      const ez = PAVE_IN + (atGradeSide(cx, cz, sz > 0 ? 2 : 3) ? FLY.atGrade : 0);
      // `place` hands radial offsets over as distances from the block centre, so the piece's own distance from
      // the road centre line — which is what the corner, and so the diagonal, is measured against — is `E - radial`.
      const edge = C ? ex : ez;                            // this strip's own kerb, in its radial direction
      const k = ((E - radial) - edge) / Math.SQRT2;        // its own offset behind the diagonal, along and across
      const R = ex + FLY.chamfer / 2 + k, A = ez + FLY.chamfer / 2 + k;   // the twin's centre, off the corner
      const L = FLY.chamfer * Math.SQRT2;                  // its length along the cut, end to end
      const x = jx + sx * R, z = jz + sz * A;
      arr.push({ w: L, h, d: w, x, y: y + s.dy, z, rot: sx * sz * PI / 4 });
    };
    const place = (arr, w, h, d, radial, y) => {
      const p = at(radial, mid);
      arr.push({ w: C ? w : len, h, d: C ? len : w, x: p.x, y: y + s.dy, z: p.z });
      for (const end of [0, 1]) if (cuts[end]) chamferCorner(arr, w, h, radial, y, end);
    };
    // `place` takes the offset from the block centre: 0 = middle of the block, CHUNK/2 = road centre line,
    // so a distance `d` measured from the road is passed as E - d.
    place(out.curb, 0.5, CURB_H, 0, E - (edge + 0.25), CURB_H / 2);                     // kerb stone out of the road
    let inner = edge + 0.5;                                                             // inner face of the kerb stone
    if (st.verge && !gap) {                                                             // grass verge, slightly proud
      place(out.grass, st.verge, 0.3, 0, E - (inner + st.verge / 2), WALK_Y + 0.015 - 0.15);
      inner += st.verge;
    }
    const walkW = line - inner;                                                         // paved walking field
    place(out.walk, walkW, PH, 0, E - (inner + walkW / 2), WALK_Y - PH / 2);
    if (!st.verge && !gap) {                                                            // stone edging only when paved to the kerb
      place(out.border, BORDER_W, 0.025, 0, E - (line - BORDER_W / 2), WALK_Y + 0.0125);
      place(out.kerb, 0.6, 0.26, 0, E - (line - BORDER_W - 0.3), WALK_Y + 0.13);
    }
  }
  return out;
}
// Soil bed + kerb edging for one street tree. The bed sits proud of the paving, so no hole has to be cut.
// `radial` is the distance from the block centre line (x for z-sides, z for x-sides), `along` the position
// along the strip. Local axes: u = radial, v = along.
function treePit(pieces, s, radial, along) {
  // radial — distance from the road centre line; for z-sides that runs along x, for x-sides along z,
  // so the block centre used for it has to follow the same axis.
  const centre = s.along === 'z' ? pieces.bx : pieces.bz;
  const u = centre + s.fixed * radial, v = along;                    // bed centre: u = radial axis, v = along axis
  const off = BED + BED_EDGE / 2, outer = 2 * (BED + BED_EDGE);
  const boxAt = (cu, cv, wu, wv) => s.along === 'z'
    ? { w: wu, h: 0.3, d: wv, x: cu, y: WALK_Y + 0.15, z: cv }
    : { w: wv, h: 0.3, d: wu, x: cv, y: WALK_Y + 0.15, z: cu };
  const bed = s.along === 'z'
    ? { w: BED * 2, h: 0.1, d: BED * 2, x: u, y: WALK_Y + 0.05, z: v }
    : { w: BED * 2, h: 0.1, d: BED * 2, x: v, y: WALK_Y + 0.05, z: u };
  pieces.bed.push(bed);
  pieces.bedEdge.push(boxAt(u, v - off, outer, BED_EDGE), boxAt(u, v + off, outer, BED_EDGE));   // across the strip
  pieces.bedEdge.push(boxAt(u - off, v, BED_EDGE, outer), boxAt(u + off, v, BED_EDGE, outer));   // along the strip
}
// Merge a box list into one mesh, scaling each box's UVs first so textures keep a constant world-space size.
function bakeRing(list, material, tile, cast, ch) {
  if (!list.length) return null;
  const geos = list.map(m => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    // A piece may carry `rot` (radians about its own centre, for the chamfered corners that turn 45°); the
    // scale has to be applied in the piece's own frame and the rotation about the piece's own centre, so the
    // matrix is T * R * S rather than the plain scale-and-translate every other piece uses.
    const M = new THREE.Matrix4().makeScale(m.w, m.h, m.d);
    if (m.rot) M.premultiply(new THREE.Matrix4().makeRotationY(m.rot));
    M.setPosition(m.x, m.y, m.z);
    g.applyMatrix4(M);
    const uv = g.attributes.uv;
    for (const f of [[0, m.d, m.h], [1, m.w, m.d], [2, m.w, m.h]]) {
      const su = Math.max(1, Math.round(f[1] / tile)), sv = Math.max(1, Math.round(f[2] / tile));
      for (let i = 0; i < 4; i++) { const idx = f[0] * 4 + i; uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv); }
    }
    uv.needsUpdate = true; return g;
  });
  const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material); mesh.castShadow = cast; mesh.receiveShadow = true;
  ch.group.add(mesh); ch.geos.push(merged);
  return mesh;
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
// ---- Hospital ----
// Box-pixel lettering: every lit pixel of a 5x7 glyph becomes one thin box, so signs are plain geometry with no
// texture work. Text is centred on the origin, runs along +x and faces +z; rotate the group for other walls.
const FONT3D = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01110,10001,10000,10000,10000,10001,01110', D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111', F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111', H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111', J: '00111,00010,00010,00010,00010,10010,01100',
  K: '10001,10010,10100,11000,10100,10010,10001', L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110', P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101', R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01111,10000,10000,01110,00001,00001,11110', T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110', V: '10001,10001,10001,10001,10001,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001', X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100', Z: '11111,00001,00010,00100,01000,10000,11111',
  '0': '01110,10001,10011,10101,11001,10001,01110', '1': '00100,01100,00100,00100,00100,00100,01110',
  '2': '01110,10001,00001,00010,00100,01000,11111', '3': '11111,00010,00100,00010,00001,10001,01110',
  '4': '00010,00110,01010,10010,11111,00010,00010', '5': '11111,10000,11110,00001,00001,10001,01110',
  '6': '00110,01000,10000,11110,10001,10001,01110', '7': '11111,00001,00010,00100,01000,01000,01000',
  '8': '01110,10001,10001,01110,10001,10001,01110', '9': '01110,10001,10001,01111,00001,00010,01100',
  ' ': '00000,00000,00000,00000,00000,00000,00000', '-': '00000,00000,00000,11111,00000,00000,00000',
};
// Sign lettering: every pixel of a glyph is a square, 5 columns by 7 rows for the classic 5x7 proportions.
// The letters are merged once per (string, size) and that merged geometry is shared by every sign that asks for
// it. A shop name used to cost the chunk builder ~150 separate little boxes and a parade of shopfronts plus its
// tower titles well over two thousand; sharing them is what keeps a shopping street from stalling the streamer.
const textGeoCache = new Map();
const TEXT_BOX = new THREE.BoxGeometry(1, 1, 1);
const _textM = new THREE.Matrix4();
function textGeometry(str, h = 1.2, depth = 0.14, gap = 0.8, mirror = false) {
  const key = h + '|' + depth + '|' + gap + '|' + str.toUpperCase() + '|' + (mirror ? 'm' : 'n');
  let geo = textGeoCache.get(key);
  if (geo === undefined) {
    const pw = h / 7, ph = h / 7;
    const total = str.length * (pw + gap) - gap;
    const geos = [];
    for (let i = 0; i < str.length; i++) {
      const rows = (FONT3D[str[i].toUpperCase()] || FONT3D[' ']).split(',');
      const x0 = mirror ? total / 2 - i * (pw + gap) : -total / 2 + i * (pw + gap);
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (rows[r][c] !== '1') continue;
        const g = TEXT_BOX.clone();
        _textM.makeScale(pw * 1.02, ph * 1.02, depth);
        _textM.setPosition(mirror ? x0 - c * pw + pw / 2 : x0 + c * pw + pw / 2, (6 - r) * ph + ph / 2, 0);
        g.applyMatrix4(_textM);
        geos.push(g);
      }
    }
    geo = geos.length ? mergeGeometries(geos, false) : null;
    geos.forEach(g => g.dispose());
    textGeoCache.set(key, geo);
  }
  return geo;
}
function textBlocks(str, m, h = 1.2, depth = 0.14, gap = 0.8, mirror = false) {
  const g = new THREE.Group();
  const geo = textGeometry(str, h, depth, gap, mirror);
  if (geo) g.add(new THREE.Mesh(geo, m));
  return g;
}
// Hospital air ambulance: a proper rescue helicopter — cabin with a glass canopy, engine deck, tapered tail
// boom, fin, horizontal stabiliser, skids and a four-blade main rotor. Generous proportions (fuselage 6 m,
// rotor 9 m) so it reads as a helicopter from the street and not as a stick on the roof. The two rotor groups
// are returned centred on their own axes so the caller can merge them and spin the merged result.
function buildAirAmbulance() {
  const body = new THREE.Group(), main = new THREE.Group(), tail = new THREE.Group();
  const white = mat(0xf2f5f7), red = mat(0xd6342c), glass = mat(0x1f3444), dark = mat(0x22252a), steel = mat(0xa9b0b6);
  const beaconB = new THREE.MeshBasicMaterial({ color: 0x2a6cff });      // roof beacon
  const beaconR = new THREE.MeshBasicMaterial({ color: 0xff2d2d });      // belly beacon
  const B = (w, h, d, m, x, y, z, cast = true) => body.add(box(w, h, d, m, x, y, z, cast));

  // ---- fuselage ----
  B(2.0, 0.5, 4.8, white, 0, 0.85, 0.1);                                // belly
  B(2.3, 1.15, 3.5, white, 0, 1.62, 0.3);                               // cabin
  B(2.34, 0.42, 4.9, red, 0, 1.06, 0.1);                                // red livery band
  B(1.95, 1.0, 1.7, glass, 0, 1.72, 2.1);                               // canopy
  B(1.75, 0.62, 1.0, white, 0, 1.32, 2.75);                             // nose
  B(1.4, 0.42, 0.6, white, 0, 1.1, 3.15);                               // nose tip
  B(1.7, 0.34, 2.9, white, 0, 2.32, 0.15);                              // cabin roof
  B(1.9, 0.62, 2.1, white, 0, 2.5, -0.5);                               // engine deck
  B(1.5, 0.22, 1.0, red, 0, 1.06, 2.9);                                 // nose stripe
  for (const sx of [-1, 1]) {
    B(0.06, 0.52, 1.6, glass, sx * 1.16, 1.72, 1.05, false);            // side windows
    B(0.06, 1.05, 0.28, red, sx * 1.17, 1.66, 0.35, false);             // flank cross, vertical
    B(0.06, 0.28, 1.05, red, sx * 1.17, 1.66, 0.35, false);             // flank cross, horizontal
    B(0.14, 0.14, 4.9, dark, sx * 1.06, 0.14, 0.05);                    // skid
    B(0.12, 0.62, 0.12, steel, sx * 0.78, 0.45, 1.35, false);           // struts
    B(0.12, 0.62, 0.12, steel, sx * 0.78, 0.45, -1.35, false);
  }
  // ---- tail ----
  B(0.66, 0.66, 3.0, white, 0, 1.78, -3.6);                             // boom
  B(0.5, 0.5, 1.3, white, 0, 1.95, -5.3);                               // boom taper
  B(0.5, 1.35, 0.62, red, 0, 2.5, -5.85);                               // fin
  B(2.1, 0.12, 0.8, white, 0, 1.78, -5.3);                              // stabiliser
  B(0.2, 0.9, 0.9, dark, 0.36, 2.55, -5.9, false);                      // tail rotor housing
  // ---- mast, beacons, light ----
  B(0.2, 0.55, 0.2, steel, 0, 2.95, -0.2);                              // mast
  B(0.4, 0.2, 0.4, beaconB, 0, 2.86, 0.75, false);                      // roof beacon
  B(0.38, 0.16, 0.38, beaconR, 0, 0.62, -1.5, false);                   // belly beacon
  B(0.4, 0.24, 0.18, ASSET.headMat, 0, 1.06, 3.4, false);               // landing light

  // ---- main rotor: four blades around the hub, origin on the mast ----
  main.add(cyl(0.42, 0.42, 0.3, 10, dark, 0, 0.1, 0, false));           // rotor head
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = 4.4, w = 0.58, t = 0.13;
    if (dx) {
      main.add(box(len, t, w, dark, dx * (len / 2 + 0.35), 0, 0, false));
      main.add(box(0.7, t + 0.02, w * 0.92, red, dx * (len + 0.1), 0, 0, false));      // painted tip
    } else {
      main.add(box(w, t, len, dark, 0, 0, dz * (len / 2 + 0.35), false));
      main.add(box(w * 0.92, t + 0.02, 0.7, red, 0, 0, dz * (len + 0.1), false));
    }
  }
  // ---- tail rotor: two broad blades turning about x ----
  tail.add(cyl(0.14, 0.14, 0.44, 8, steel, 0, 0, 0, false));
  tail.add(box(0.11, 1.65, 0.3, dark, 0, 0, 0, false));
  tail.add(box(0.11, 0.3, 1.65, dark, 0, 0, 0, false));
  tail.add(box(0.12, 0.34, 0.26, red, 0, 0.72, 0, false));
  tail.add(box(0.12, 0.34, 0.26, red, 0, -0.72, 0, false));
  return { body, main, tail, beacons: [beaconB, beaconR], mast: [0, 3.2, -0.2], tailPos: [0.36, 2.55, -5.9] };
}
// A hospital campus in the flat-illustration style of the reference art: white slab wings with blue window
// bands, a glazed tower carrying the red-cross emblem, a glass entrance under a HOSPITAL sign board, an
// emergency bay under an EMERGENCY sign and a rooftop helipad. Returns the unpositioned group plus the
// collision volumes and the painted parking bays (world coordinates).
function buildHospitalMesh(bx, bz, rng) {
  const g = new THREE.Group(), solids = [], bays = [], paint = [];
  const M = {
    white: mat(0xedf0f1), trim: mat(0xd3d8da), facade: mat(0xe3ecef), glass: mat(0x3d86c2), glassDark: mat(0x2b638f),
    frame: mat(0xf7f9fa), red: mat(0xd6342c), steel: mat(0xb3bac0), paint: mat(0xe9e8df), ambBay: mat(0xc0453c),
    doorGlass: mat(0x27455c), walk: mat(0xc9ccce),
    padDark: mat(0x5b6167), padDarkBright: mat(0xd9dde0),
  };
  const B = (w, h, d, m, x, y, z, cast) => g.add(box(w, h, d, m, x, y, z, cast));
  const Y = 0.25;                                        // lot surface height
  const solid = (x, z, hx, hz) => solids.push({ x: bx + x, z: bz + z, hx, hz });

  // ---- slab wing: the bed block, three floors of windows facing the car park ----
  const A = { x: -7, z: -19, w: 24, d: 14, h: 11.4 };
  B(A.w, A.h, A.d, M.white, A.x, Y + A.h / 2, A.z);
  for (let f = 0; f < 3; f++) {
    const y = Y + 3.1 + f * 3.1;
    B(A.w + 0.3, 1.62, 0.16, M.glass, A.x, y, A.z + A.d / 2 + 0.09);              // front glazing band
    B(A.w + 0.34, 0.2, 0.24, M.frame, A.x, y + 0.9, A.z + A.d / 2 + 0.12);
    B(A.w + 0.34, 0.2, 0.24, M.frame, A.x, y - 0.9, A.z + A.d / 2 + 0.12);
    B(0.16, 1.62, A.d + 0.3, M.glass, A.x - A.w / 2 - 0.09, y, A.z);             // west elevation
    for (let c = 0; c < 6; c++) {                                                // mullions split the band
      B(0.22, 1.62, 0.22, M.frame, A.x - A.w / 2 + 2 + c * 4, y, A.z + A.d / 2 + 0.14, false);
    }
  }
  B(A.w + 0.7, 0.5, A.d + 0.7, M.trim, A.x, Y + A.h + 0.25, A.z, false);         // roof parapet
  solid(A.x, A.z, A.w / 2, A.d / 2);

  // ---- glazed tower with the red-cross emblem on the roof ----
  const T = { x: 12, z: -20.5, w: 13, d: 13, h: 21 };
  B(T.w, T.h, T.d, M.facade, T.x, Y + T.h / 2, T.z);
  for (let f = 0; f < 6; f++) {
    const y = Y + 2.2 + f * 3.1;
    B(T.w + 0.24, 1.9, 0.16, M.glass, T.x, y, T.z + T.d / 2 + 0.08);
    B(0.16, 1.9, T.d + 0.24, M.glass, T.x + T.w / 2 + 0.08, y, T.z);
    B(0.16, 1.9, T.d + 0.24, M.glass, T.x - T.w / 2 - 0.08, y, T.z);
    for (let c = 0; c < 4; c++) {
      B(0.2, 1.9, 0.2, M.frame, T.x - T.w / 2 + 1.6 + c * 3.2, y, T.z + T.d / 2 + 0.13, false);
      B(0.2, 1.9, 0.2, M.frame, T.x + T.w / 2 + 0.13, y, T.z - T.d / 2 + 1.6 + c * 3.2, false);
    }
  }
  B(T.w + 0.8, 0.6, T.d + 0.8, M.trim, T.x, Y + T.h + 0.3, T.z, false);
  solid(T.x, T.z, T.w / 2, T.d / 2);
  const ct = Y + T.h + 0.6;
  // Blue cross emblem standing on the tower roof, facing the car park like the reference art.
  const emblem = cyl(2.7, 2.7, 0.3, 18, mat(0x3a7fd0), T.x, ct + 2.7, T.z + T.d / 2 - 0.4, false);
  emblem.rotation.x = PI / 2; g.add(emblem);
  B(2.1, 0.34, 0.34, M.white, T.x, ct + 2.7, T.z + T.d / 2 - 0.18, false);        // white cross on its face
  B(0.34, 2.1, 0.34, M.white, T.x, ct + 2.7, T.z + T.d / 2 - 0.18, false);
  B(1.0, 1.0, 0.6, M.steel, T.x, ct + 0.5, T.z + T.d / 2 - 0.4, false);           // its foot on the parapet

  // ---- west wing: emergency department with the helipad on its roof ----
  const W = { x: -20, z: -16.5, w: 11, d: 12, h: 6.6 };
  B(W.w, W.h, W.d, M.white, W.x, Y + W.h / 2, W.z);
  B(W.w + 0.3, 1.5, 0.16, M.glass, W.x, Y + 4.1, W.z + W.d / 2 + 0.09);
  B(W.w + 0.6, 0.44, W.d + 0.6, M.trim, W.x, Y + W.h + 0.22, W.z, false);
  solid(W.x, W.z, W.w / 2, W.d / 2);
  // ---- helipad ----
  // The deck sits on the roof of the tall slab wing, not the low emergency wing: the wing roof is 24x14 m,
  // so a disc wide enough for the whole 9 m rotor fits inside the parapet, and the nearest taller structure
  // (the glazed tower) is more than a rotor-radius away, so the blades never sweep into a wall.
  const hpY = Y + A.h + 0.5;
  const pad = { x: A.x, z: A.z, r: 6.2 };
  g.add(cyl(pad.r, pad.r, 0.34, 28, M.steel, pad.x, hpY + 0.17, pad.z, false));   // platform drum
  g.add(cyl(pad.r - 0.35, pad.r - 0.35, 0.36, 28, M.padDark, pad.x, hpY + 0.18, pad.z, false));
  g.add(cyl(pad.r + 0.05, pad.r + 0.05, 0.06, 28, M.white, pad.x, hpY + 0.36, pad.z, false));   // white rim lip
  g.add(cyl(5.2, 5.2, 0.03, 28, M.white, pad.x, hpY + 0.375, pad.z, false));      // painted touch-down ring
  g.add(cyl(4.8, 4.8, 0.03, 28, M.padDark, pad.x, hpY + 0.39, pad.z, false));
  const hMark = textBlocks('H', M.white, 4.2, 0.14, 0.6);                        // the big H
  hMark.rotation.x = -PI / 2; hMark.position.set(pad.x, hpY + 0.41, pad.z); g.add(hMark);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {                  // perimeter lights
    g.add(box(0.34, 0.16, 0.34, (sx * sz > 0) ? M.padDarkBright : mat(0xf0b429), pad.x + sx * (pad.r - 0.35), hpY + 0.45, pad.z + sz * (pad.r - 0.35), false));
  }
  g.add(cyl(0.07, 0.07, 2.6, 6, M.steel, pad.x - 7.6, hpY + 1.7, pad.z - 5.4, false));   // windsock pole
  for (let i = 0; i < 4; i++) {
    const w = 0.46 - i * 0.08;
    g.add(box(w, w, 0.44, i % 2 ? M.white : mat(0xef7d1a), pad.x - 7.15 + i * 0.46, hpY + 2.85 - i * 0.03, pad.z - 5.4, false));
  }
  // ---- air ambulance parked on the pad, nose towards the car park ----
  const heli = buildAirAmbulance();
  const HY = hpY + 0.37, HX = pad.x, HZ = pad.z + 0.95;  // tail points at -z, so a +z offset keeps the whole tail on the roof
  heli.body.position.set(HX, HY, HZ);
  g.add(heli.body);

  // ---- main entrance: glass lobby, canopy and the HOSPITAL board ----
  const E = { x: -1, z: -11.6, w: 11, d: 3.4, h: 4.6 };
  B(E.w, E.h, E.d, M.facade, E.x, Y + E.h / 2, E.z);
  B(E.w + 0.2, 2.5, 0.14, M.doorGlass, E.x, Y + 1.35, E.z + E.d / 2 + 0.08);      // glass doors
  B(1.8, 1.0, 0.2, M.walk, E.x, Y + 1.4, E.z + E.d / 2 + 0.16, false);
  B(E.w + 3.4, 0.42, 4.6, M.trim, E.x, Y + E.h + 0.21, E.z + 0.9, false);         // canopy slab
  for (const sx of [-1, 1]) B(0.36, E.h, 0.36, M.steel, E.x + sx * (E.w / 2 + 1.2), Y + E.h / 2, E.z + 2.9, false);
  solid(E.x, E.z, E.w / 2, E.d / 2);
  B(14.2, 2.6, 0.5, M.white, E.x, Y + E.h + 1.9, E.z + 0.7, false);               // sign board
  const sign = textBlocks('HOSPITAL', M.red, 1.65, 0.18, 0.6);
  sign.position.set(E.x, Y + E.h + 1.9, E.z + 0.98); g.add(sign);

  // ---- emergency bay: red EMERGENCY sign and the ambulance apron ----
  B(7.6, 1.15, 0.34, M.red, W.x, Y + 5.0, W.z + W.d / 2 + 0.02, false);           // red sign board
  const emerg = textBlocks('EMERGENCY', M.white, 0.62, 0.14, 0.24);
  emerg.position.set(W.x, Y + 5.0, W.z + W.d / 2 + 0.22); g.add(emerg);
  B(W.w + 2, 0.1, 6.4, M.walk, W.x, Y + 0.06, W.z + W.d / 2 + 3.4, false);        // ambulance apron

  // ---- car park: three painted rows, the last stall of the far row reserved for an ambulance ----
  const stallW = 4.5, perRow = 12, startX = -(perRow * stallW) / 2;
  const rows = [0, 9, 18];
  rows.forEach((rz, ri) => {
    for (let i = 0; i <= perRow; i++) paint.push({ w: 0.16, d: 5.0, m: M.paint, x: bx + startX + i * stallW, z: bz + rz });
    for (let i = 0; i < perRow; i++) {
      const x = startX + (i + 0.5) * stallW, z = rz;
      const ambulance = ri === rows.length - 1 && i >= perRow - 2;                 // two reserved stalls
      if (ambulance) {
        paint.push({ w: stallW, d: 5.0, m: M.ambBay, x: bx + x, z: bz + z });
        bays.push({ x: bx + x, z: bz + z, rotY: 0, hx: 1.25, hz: 2.9, ambulance: true });
      } else {
        bays.push({ x: bx + x, z: bz + z, rotY: rng() < 0.5 ? 0 : PI, hx: 1.25, hz: 2.9, ambulance: false });
      }
    }
  });
  // ambulance standing at the emergency entrance, parked crosswise to the apron
  bays.push({ x: bx + W.x + 4.6, z: bz + W.z + W.d / 2 + 3.4, rotY: PI / 2, hx: 2.9, hz: 1.25, ambulance: true, apron: true });
  paint.push({ w: 6.2, d: 5.6, m: M.ambBay, x: bx + W.x + 4.6, z: bz + W.z + W.d / 2 + 3.4 });
  // low planted islands framing the entrance walk
  for (const sx of [-1, 1]) B(3.2, 0.5, 3.2, mat(0x7ba96a), E.x + sx * 9, Y + 0.25, E.z + 1.6, false);

  return {
    group: g, solids, bays, paint,
    // campus volumes with their roof heights (block-local), used by the blade-clearance checks
    volumes: [
      { x: A.x, z: A.z, hx: A.w / 2, hz: A.d / 2, top: Y + A.h, name: 'bed wing' },
      { x: T.x, z: T.z, hx: T.w / 2, hz: T.d / 2, top: Y + T.h, name: 'tower' },
      { x: W.x, z: W.z, hx: W.w / 2, hz: W.d / 2, top: Y + W.h, name: 'emergency wing' },
      { x: E.x, z: E.z, hx: E.w / 2, hz: E.d / 2, top: Y + E.h, name: 'entrance' },
    ],
    // kept out of the merged building so the parking/ambience system can spin them around their own axes
    heliBody: heli.body, heliMain: heli.main, heliTail: heli.tail, heliBeacons: heli.beacons,
    padR: pad.r, padY: hpY, padX: pad.x, padZ: pad.z, rotorR: 4.85,   // pad centre and the aircraft position differ
    heliMast: [HX + heli.mast[0], HY + heli.mast[1], HZ + heli.mast[2]],
    heliTailPos: [HX + heli.tailPos[0], HY + heli.tailPos[1], HZ + heli.tailPos[2]],
    heliPos: [HX, HY, HZ],
  };
}
// ---- Fire station ----
// Red appliance hall with white bands, three to five open garage bays, a hose tower and a big FIRE STATION
// fascia sign (box-pixel lettering, same font the hospital signs use). The appliance apron in front of the
// bay doors is where the fleet lives: three to five appliances, always including at least one large engine
// and one small squad, on station from the first frame.
function buildFireStationMesh(bx, bz, rng) {
  const g = new THREE.Group(), solids = [], doors = [], bays = [];
  const M = {
    red: mat(0xc8342e), darkRed: mat(0xa52620), white: mat(0xf1f2f0), band: mat(0xd9dcdd), steel: mat(0xb3bac0),
    door: mat(0x2f343b), doorGlow: mat(0x3d444c), bay: mat(0x3a3f45), apron: mat(0x6d727a), roof: mat(0xa52620), glass: mat(0x2c4356),
  };
  const B = (w, h, d, m, x, y, z, cast = true) => g.add(box(w, h, d, m, x, y, z, cast));
  const Y = 0.25;
  const solid = (x, z, hx, hz) => solids.push({ x: bx + x, z: bz + z, hx, hz });

  // ---- the fleet: three to five appliances, always with a large engine and a small squad ----
  const nBays = 3 + Math.floor(rng() * 3);                     // 3, 4 or 5 bays, decided per station
  const doorW = 5.6, doorH = 4.2, midDoor = nBays >> 1;
  const spacing = nBays <= 3 ? 10.5 : (nBays === 4 ? 8.5 : 7);  // tighter door line the more bays are in service
  const doorX = [];
  for (let i = 0; i < nBays; i++) doorX.push((i - (nBays - 1) / 2) * spacing);
  const span = (nBays - 1) * spacing;                           // how much wall the doors need
  const fleet = [];
  for (let i = 0; i < nBays; i++) {
    if (i === midDoor) fleet.push('firesmall');                 // the squad sits in the middle bay
    else fleet.push(i > 0 && rng() < 0.3 ? 'firesmall' : 'firetruck');   // the rest are engines, and bay 0 always is
  }

  // ---- appliance hall: the trucks are parked in front of its bay doors ----
  const H = { x: 0, z: -11, w: Math.max(32, span + 6), d: 16, h: 8.2 };
  B(H.w, H.h, H.d, M.red, H.x, Y + H.h / 2, H.z);
  B(H.w + 0.4, 1.1, H.d + 0.4, M.white, H.x, Y + 1.35, H.z, false);            // white belly band
  B(H.w + 0.4, 0.7, H.d + 0.4, M.band, H.x, Y + 3.5, H.z, false);              // upper band
  B(H.w + 0.9, 0.6, H.d + 0.9, M.roof, H.x, Y + H.h + 0.3, H.z, false);        // roof cap
  B(H.w + 0.5, 0.35, 0.5, M.white, H.x, Y + H.h + 0.7, H.z + H.d / 2 - 0.1, false);
  solid(H.x, H.z, H.w / 2, H.d / 2);
  const frontZ = H.z + H.d / 2;                                                // the face with the bay doors

  // ---- fascia sign: FIRE STATION on the white board above the doors ----
  B(H.w - 2, 2.3, 0.5, M.white, H.x, Y + 6.6, frontZ + 0.2, false);
  const sign = textBlocks('FIRE STATION', M.red, 1.35, 0.18, 0.5);
  sign.position.set(H.x, Y + 6.6, frontZ + 0.48); g.add(sign);

  // ---- open bay doors with a dark interior and a rolled-up shutter ----
  doorX.forEach((dx, i) => {
    const open = i !== midDoor || rng() < 0.5;                                 // one bay may be shut
    doors.push({ x: dx, z: frontZ, w: doorW, open });
    B(doorW, doorH, 0.18, M.band, dx, Y + doorH / 2, frontZ + 0.06, false);    // frame
    B(doorW - 0.5, doorH - 0.4, 1.4, M.bay, dx, Y + (doorH - 0.4) / 2, frontZ - 0.7, false);   // bay interior
    B(doorW - 0.5, 0.42, 0.2, open ? M.darkRed : M.red, dx, Y + doorH - 0.42, frontZ + 0.14, false);   // rolled shutter
    if (!open) B(doorW - 0.5, doorH - 0.9, 0.1, M.darkRed, dx, Y + (doorH - 0.9) / 2, frontZ + 0.14, false);
    B(doorW - 0.7, 0.1, 1.3, M.doorGlow, dx, Y + 0.06, frontZ - 0.7, false);
  });

  // ---- hose tower at the side, with the station bell on top ----
  const T = { x: -20.5, z: -13, w: 6, d: 6, h: 15.5 };
  B(T.w, T.h, T.d, M.red, T.x, Y + T.h / 2, T.z);
  for (let f = 1; f <= 3; f++) B(T.w + 0.3, 0.5, T.d + 0.3, M.white, T.x, Y + f * 3.6, T.z, false);
  B(T.w + 0.3, 0.62, 0.16, M.glass, T.x, Y + 12.6, T.z + T.d / 2 + 0.12, false);
  B(T.w + 0.9, 0.6, T.d + 0.9, M.roof, T.x, Y + T.h + 0.3, T.z, false);
  B(1.5, 0.5, 1.5, M.white, T.x, Y + T.h + 0.85, T.z, false);
  B(0.9, 0.5, 0.9, M.red, T.x, Y + T.h + 1.35, T.z, false);
  B(0.34, 0.5, 0.34, mat(0xf4c020), T.x, Y + T.h + 1.85, T.z, false);
  solid(T.x, T.z, T.w / 2, T.d / 2);

  // ---- rear training annex with a small gear store ----
  const N = { x: 15, z: -22, w: 12, d: 8, h: 4.4 };
  B(N.w, N.h, N.d, M.band, N.x, Y + N.h / 2, N.z);
  B(N.w + 0.4, 0.4, N.d + 0.4, M.roof, N.x, Y + N.h + 0.2, N.z, false);
  for (let i = 0; i < 3; i++) B(1.5, 1.2, 0.14, M.glass, N.x - 4 + i * 4, Y + 2.6, N.z + N.d / 2 + 0.1, false);
  solid(N.x, N.z, N.w / 2, N.d / 2);

  // ---- appliance apron: the concrete pad the trucks stand on, plus a hydrant and cones ----
  const apronW = Math.max(38, span + doorW + 6);
  B(apronW, 0.12, 16, M.apron, 0, Y + 0.06, frontZ + 6.4, false);
  for (let i = 0; i <= 3; i++) B(0.16, 0.05, 15.4, M.white, -apronW / 2 + 5 + i * (apronW - 10) / 3, Y + 0.14, frontZ + 6.4, false);
  g.add(cyl(0.34, 0.38, 1.1, 8, mat(0xd93a2b), -16.5, Y + 0.55, frontZ + 9.5, false));   // hydrant
  g.add(cyl(0.42, 0.42, 0.16, 8, mat(0xd93a2b), -16.5, Y + 1.14, frontZ + 9.5, false));
  for (let i = 0; i < 3; i++) g.add(cyl(0.1, 0.34, 0.9, 8, mat(0xf47a1a), 17.5, Y + 0.45, frontZ + 2 + i * 2.2, false));

  // ---- the vehicle bays: the whole fleet, each appliance in front of its own door ----
  const truck = (x, kind, hx, hz) => bays.push({ x: bx + x, z: bz + (kind === 'firesmall' ? 1.5 : 2.6), rotY: 0, hx, hz, kind, color: 0xc8342e, y: Y - 0.05, door: x });
  doorX.forEach((dx, i) => fleet[i] === 'firesmall'
    ? truck(dx, 'firesmall', 1.05, 2.6)
    : truck(dx, 'firetruck', 1.3, 3.7));

  return {
    group: g, solids, doors, bays,
    volumes: [
      { x: H.x, z: H.z, hx: H.w / 2, hz: H.d / 2, top: Y + H.h, name: 'appliance hall' },
      { x: T.x, z: T.z, hx: T.w / 2, hz: T.d / 2, top: Y + T.h, name: 'hose tower' },
      { x: N.x, z: N.z, hx: N.w / 2, hz: N.d / 2, top: Y + N.h, name: 'annex' },
    ],
  };
}
// ---- School ----
// A neighbourhood school on its own block: a two-storey classroom wing with a glazed gym beside it, a grass
// yard behind a chain-link fence, a playground and basketball court in that yard, and a lot out front where the
// yellow school buses stand nose-out along the kerb. The fence is real geometry (posts, rails, a light mesh
// panel and a concrete plinth) and real collision, with a gate at the walkway and a service gate for the yard.
export function buildSchoolMesh(bx, bz, rng) {
  const g = new THREE.Group(), solids = [], bays = [], paint = [], fence = [], playground = [];
  const M = {
    brick: mat(0xd8c9a8), brickDark: mat(0xc2b18d), trim: mat(0xf0ece1), band: mat(0xe6e2d6),
    glass: mat(0x3f7fb5), glassDark: mat(0x2b5f8c), frame: mat(0xf7f9fa), roof: mat(0x9aa0a6),
    door: mat(0x2f4a63), steel: mat(0x9aa2a8), fenceMesh: mat(0x9aa79f, { transparent: true, opacity: 0.22 }),
    plinth: mat(0xb9b6ad), walk: mat(0xc9ccce), court: mat(0x4b5058), line: mat(0xe9e8df),
    yellow: mat(0xf7b500), red: mat(0xd6503f), blue: mat(0x3f7fd0), green: mat(0x4ca85c),
    sand: mat(0xe0cf9a), mulch: mat(0xb08a5c), playBlue: mat(0x4a8fd0), playRed: mat(0xd05a4a), playYellow: mat(0xe8c33a),
    busBay: mat(0xf7b500), pole: mat(0x6d747c),
  };
  const B = (w, h, d, m, x, y, z, cast = true) => g.add(box(w, h, d, m, x, y, z, cast));
  const R = (bw, bh, bd, m, x, y, z, rx, rz) => { const o = box(bw, bh, bd, m, x, y, z, false); if (rx) o.rotation.x = rx; if (rz) o.rotation.z = rz; g.add(o); return o; };
  const C = (rt, rb, h, seg, m, x, y, z) => { const o = cyl(rt, rb, h, seg, m, x, y, z, false); g.add(o); return o; };   // returns the cylinder: g.add() returns the group
  const Y = 0.25;                                          // yard and lot surface height
  const solid = (x, z, hx, hz) => solids.push({ x: bx + x, z: bz + z, hx, hz, kind: 'building' });
  const mark = (x, z, name) => playground.push({ name, x: bx + x, z: bz + z });

  // ================= the school building: classroom wing, gym and entrance =================
  const A = { x: -10, z: -24, w: 34, d: 8, h: 8.4 };                       // two-storey classroom wing
  B(A.w, A.h, A.d, M.brick, A.x, Y + A.h / 2, A.z);
  B(A.w + 0.5, 0.5, A.d + 0.5, M.trim, A.x, Y + A.h + 0.25, A.z, false);   // parapet
  B(A.w + 0.3, 0.9, A.d + 0.3, M.brickDark, A.x, Y + 0.45, A.z, false);    // plinth course
  for (let f = 0; f < 2; f++) {
    const y = Y + 2.3 + f * 3.2;
    B(A.w - 2, 1.5, 0.16, M.glass, A.x, y, A.z + A.d / 2 + 0.09, false);   // band of classroom windows
    B(A.w - 2, 0.16, 0.2, M.frame, A.x, y + 0.83, A.z + A.d / 2 + 0.12, false);
    B(A.w - 2, 0.16, 0.2, M.frame, A.x, y - 0.83, A.z + A.d / 2 + 0.12, false);
    for (let c = 0; c < 9; c++) B(0.22, 1.5, 0.2, M.frame, A.x - (A.w - 2) / 2 + 0.6 + c * (A.w - 3.2) / 8, y, A.z + A.d / 2 + 0.14, false);
  }
  solid(A.x, A.z, A.w / 2, A.d / 2);

  const G = { x: 17, z: -23, w: 20, d: 10, h: 10 };                        // gymnasium / hall
  B(G.w, G.h, G.d, M.brickDark, G.x, Y + G.h / 2, G.z);
  B(G.w + 0.5, 0.6, G.d + 0.5, M.trim, G.x, Y + G.h + 0.3, G.z, false);
  for (let c = 0; c < 5; c++) B(2.4, 2.2, 0.16, M.glassDark, G.x - 7 + c * 3.5, Y + 7.4, G.z + G.d / 2 + 0.09, false);   // clerestory
  B(G.w - 2, 2.6, 0.16, M.glass, G.x, Y + 1.9, G.z + G.d / 2 + 0.09, false);                                              // tall hall windows
  B(G.w, 0.8, 0.24, M.brick, G.x, Y + 5.6, G.z + G.d / 2 + 0.06, false);
  const gymSign = textBlocks('GYMNASIUM', M.trim, 1.0, 0.16, 0.35);
  gymSign.position.set(G.x, Y + 8.9, G.z + G.d / 2 + 0.4); g.add(gymSign);
  solid(G.x, G.z, G.w / 2, G.d / 2);

  // entrance: projecting lobby with a canopy, steps, a clock and the SCHOOL board
  const E = { x: -10, z: -19.2, w: 11, d: 2.6, h: 4.4 };
  B(E.w, E.h, E.d, M.trim, E.x, Y + E.h / 2, E.z);
  B(E.w - 2, 2.3, 0.14, M.door, E.x, Y + 1.25, E.z + E.d / 2 + 0.08, false);
  B(3.0, 2.3, 0.1, M.glass, E.x, Y + 1.25, E.z + E.d / 2 + 0.12, false);
  B(E.w + 4, 0.36, 4.2, M.trim, E.x, Y + E.h + 0.18, E.z + 1.2, false);    // canopy
  for (const sx of [-1, 1]) C(0.16, 0.16, E.h, 8, M.steel, E.x + sx * (E.w / 2 + 1.4), Y + E.h / 2, E.z + 3.1);
  B(E.w + 1.6, 2.4, 0.45, M.brick, E.x, Y + E.h + 1.6, E.z + 0.4, false);  // the board above the doors
  const sign = textBlocks('SCHOOL', M.trim, 1.35, 0.18, 0.5);
  sign.position.set(E.x, Y + E.h + 1.6, E.z + 0.66); g.add(sign);
  C(0.95, 0.95, 0.16, 14, M.trim, E.x + 3.6, Y + E.h + 1.7, E.z + 0.5);    // clock
  C(0.8, 0.8, 0.06, 14, M.brickDark, E.x + 3.6, Y + E.h + 1.7, E.z + 0.6);
  B(0.1, 0.42, 0.06, M.trim, E.x + 3.6, Y + E.h + 1.86, E.z + 0.62, false);
  B(0.32, 0.1, 0.06, M.trim, E.x + 3.72, Y + E.h + 1.7, E.z + 0.62, false);
  for (let i = 0; i < 2; i++) B(E.w + 3, 0.16, 0.5, M.walk, E.x, Y - 0.02 - i * 0.14, E.z + E.d / 2 + 1.1 + i * 0.5, false);   // steps
  mark(E.x, E.z, 'entrance');
  solid(E.x, E.z, E.w / 2, E.d / 2);

  // ================= yard, fence and gates =================
  const YARD_Z = 0, GATE = { a: -3, b: 3 }, SERVICE = { a: 19, b: 23 };
  // Chain-link run: posts every 3 m, two rails, a light mesh panel and a concrete plinth. The plinth is poured
  // into the block like any other concrete; the fence itself is built as separate pieces (up to 7 m each) and
  // handed to the collision system as stand-alone kits, so a real hit tears a panel off its base and the yard
  // opens up — see breakFence() in js/collisions.js.
  const fenceRuns = [];
  const fenceRun = (ax, az, bx2, bz2) => {
    const len = Math.hypot(bx2 - ax, bz2 - az), alongX = Math.abs(bx2 - ax) > Math.abs(bz2 - az);
    const cx = (ax + bx2) / 2, cz = (az + bz2) / 2;
    if (alongX) B(len, 0.22, 0.16, M.plinth, cx, Y + 0.11, cz, false);
    else B(0.16, 0.22, len, M.plinth, cx, Y + 0.11, cz, false);
    const dir = alongX ? (Math.sign(bx2 - ax) || 1) : (Math.sign(bz2 - az) || 1);   // which way the run is laid
    const segs = Math.max(1, Math.round(len / 7)), segLen = len / segs, pieces = [];
    for (let i = 0; i < segs; i++) {
      const mid = (-len / 2 + (i + 0.5) * segLen) * dir;              // the piece's centre, along the run
      const grp = new THREE.Group();
      const F = (w, h, d, m, x, y, z) => grp.add(box(w, h, d, m, x, y, z, false));
      if (alongX) {
        F(segLen, 1.8, 0.04, M.fenceMesh, 0, Y + 1.12, 0);
        F(segLen, 0.08, 0.08, M.steel, 0, Y + 2.02, 0);
        F(segLen, 0.06, 0.06, M.steel, 0, Y + 0.72, 0);
      } else {
        F(0.04, 1.8, segLen, M.fenceMesh, 0, Y + 1.12, 0);
        F(0.08, 0.08, segLen, M.steel, 0, Y + 2.02, 0);
        F(0.06, 0.06, segLen, M.steel, 0, Y + 0.72, 0);
      }
      pieces.push({ group: grp, x: bx + cx + (alongX ? mid : 0), z: bz + cz + (alongX ? 0 : mid),
        hx: alongX ? segLen / 2 : 0.12, hz: alongX ? 0.12 : segLen / 2, alongX, segLen, run: fenceRuns.length, mesh: null });
    }
    // posts every 3 m from the run's start, plus one at the far end so the run closes: each post lands in the
    // piece that stands over it, and travels with that piece when the fence comes down
    const posts = [];
    for (let d = 0; d < len - 1e-6; d += 3) posts.push(d);
    posts.push(len);
    for (const d of posts) {
      const i = Math.min(segs - 1, Math.floor(d / segLen + 1e-9));
      const off = (d - (i + 0.5) * segLen) * dir;                     // distance from that piece's own centre
      pieces[i].group.add(alongX ? box(0.1, 2.05, 0.1, M.steel, off, Y + 1.02, 0, false)
                                 : box(0.1, 2.05, 0.1, M.steel, 0, Y + 1.02, off, false));
    }
    fenceRuns.push({ pieces });
    fence.push({ x: bx + cx, z: bz + cz, hx: alongX ? len / 2 : 0.14, hz: alongX ? 0.14 : len / 2 });
  };
  fenceRun(-28, YARD_Z, GATE.a, YARD_Z);                    // front, west of the main gate
  fenceRun(GATE.b, YARD_Z, SERVICE.a, YARD_Z);              // front, between the gates
  fenceRun(SERVICE.b, YARD_Z, 28, YARD_Z);                  // front, east of the service gate
  fenceRun(-28, YARD_Z, -28, -20);                          // west side, up to the classroom wing
  fenceRun(-28, -20, -27, -20);                             // return to the wing's corner
  fenceRun(28, YARD_Z, 28, -18);                            // east side, up to the gym
  fenceRun(28, -18, 27, -18);                               // return to the gym's corner
  // gate posts and the little roofs over the gates
  for (const gx of [GATE.a, GATE.b, SERVICE.a, SERVICE.b]) { B(0.24, 2.4, 0.24, M.brick, gx, Y + 1.2, YARD_Z, false); C(0.3, 0.3, 0.14, 8, M.trim, gx, Y + 2.5, YARD_Z); }

  // ================= playground (inside the fence, east half of the yard) =================
  const play = { x: 12, z: -9 };
  paint.push({ w: 26, d: 17, m: M.mulch, x: bx + play.x, z: bz + play.z });         // soft safety surface
  for (let i = 0; i < 8; i++) {                                                      // coloured tiles around the gear
    const px = play.x - 10 + (i % 4) * 6.4, pz = play.z - 6 + Math.floor(i / 4) * 9;
    paint.push({ w: 3.2, d: 3.2, m: [M.playBlue, M.playRed, M.playYellow, M.green][i % 4], x: bx + px, z: bz + pz });
  }
  // swing set: two braced A-frames with a top bar and two hanging seats
  const SW = { x: play.x - 6, z: play.z - 3 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.12, 2.8, 0.12, M.pole, SW.x + sx * 3.1, Y + 1.4, SW.z + sz * 0.5, false);
  for (const sx of [-1, 1]) B(0.1, 0.1, 1.15, M.pole, SW.x + sx * 3.1, Y + 2.72, SW.z, false);
  C(0.08, 0.08, 6.4, 8, M.pole, SW.x, Y + 2.76, SW.z).rotation.z = PI / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) C(0.02, 0.02, 1.9, 5, M.steel, SW.x + sx * 0.8 + sz * 0.24, Y + 1.75, SW.z);
    B(0.62, 0.06, 0.26, M.playRed, SW.x + sx * 0.8, Y + 0.78, SW.z, false);
  }
  mark(SW.x, SW.z, 'swing set');
  // slide: ladder, platform, blue chute
  const SL = { x: play.x + 3, z: play.z - 4 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.12, 2.3, 0.12, M.playBlue, SL.x + sx * 0.7, Y + 1.15, SL.z + sz * 0.7, false);
  B(1.7, 0.12, 1.7, M.playYellow, SL.x, Y + 2.3, SL.z, false);
  for (const sx of [-1, 1]) B(0.08, 1.0, 0.08, M.pole, SL.x + sx * 0.7, Y + 2.8, SL.z - 0.7, false);
  B(1.5, 0.08, 0.08, M.pole, SL.x, Y + 3.25, SL.z - 0.7, false);
  for (let i = 0; i < 5; i++) B(1.3, 0.07, 0.09, M.pole, SL.x, Y + 0.4 + i * 0.42, SL.z - 1.05, false);      // ladder rungs
  for (const sx of [-1, 1]) B(0.09, 0.09, 2.9, M.playBlue, SL.x + sx * 0.55, Y + 1.5, SL.z - 1.2, false);
  R(1.0, 0.1, 3.2, M.playRed, SL.x, Y + 1.15, SL.z + 0.75, -0.52, 0);                                       // the chute
  for (const sx of [-1, 1]) R(0.09, 0.34, 3.2, M.playRed, SL.x + sx * 0.5, Y + 1.36, SL.z + 0.75, -0.52, 0);
  mark(SL.x, SL.z, 'slide');
  // climbing frame with a roof, a scramble net and a fireman's pole
  const CF = { x: play.x + 9, z: play.z - 1 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.14, 2.5, 0.14, M.green, CF.x + sx * 1.4, Y + 1.25, CF.z + sz * 1.4, false);
  B(3.1, 0.14, 3.1, M.playYellow, CF.x, Y + 2.5, CF.z, false);
  R(1.9, 0.14, 1.9, M.green, CF.x, Y + 3.35, CF.z, 0, PI / 4);                                              // roof, turned 45 degrees
  for (let i = 0; i < 4; i++) B(2.6, 0.08, 0.08, M.playBlue, CF.x, Y + 0.65 + i * 0.5, CF.z + 1.4, false);   // rungs up one side
  for (const sx of [-1, 1]) B(0.08, 0.08, 2.4, M.playBlue, CF.x + sx * 1.3, Y + 0.4, CF.z, false);
  C(0.09, 0.09, 2.4, 6, M.playRed, CF.x + 1.75, Y + 1.2, CF.z - 1.2);
  mark(CF.x, CF.z, 'climbing frame');
  // see-saw, sandbox and two spring riders
  const SS = { x: play.x - 4, z: play.z + 4 };
  B(0.3, 0.9, 0.5, M.pole, SS.x, Y + 0.45, SS.z, false);
  R(0.34, 0.1, 3.6, M.playBlue, SS.x, Y + 0.95, SS.z, 0, 0.09);
  for (const sz of [-1, 1]) { B(0.34, 0.08, 0.08, M.playRed, SS.x, Y + 1.28, SS.z + sz * 1.55, false); B(0.06, 0.36, 0.06, M.playRed, SS.x, Y + 1.12, SS.z + sz * 1.55, false); }
  mark(SS.x, SS.z, 'see-saw');
  const SB = { x: play.x + 4, z: play.z + 5 };
  for (const sx of [-1, 1]) B(4.4, 0.3, 0.3, M.brickDark, SB.x + sx * 2.05, Y + 0.15, SB.z, false);
  for (const sz of [-1, 1]) B(0.3, 0.3, 4.4, M.brickDark, SB.x, Y + 0.15, SB.z + sz * 2.05, false);
  B(3.8, 0.1, 3.8, M.sand, SB.x, Y + 0.12, SB.z, false);
  mark(SB.x, SB.z, 'sandbox');
  for (const [rx2, rz2, col] of [[play.x - 8, play.z + 6, M.playRed], [play.x - 6, play.z + 8, M.playYellow]]) {
    C(0.12, 0.12, 0.5, 8, M.steel, rx2, Y + 0.25, rz2);
    B(0.9, 0.34, 0.3, col, rx2, Y + 0.62, rz2, false);
    B(0.34, 0.3, 0.3, col, rx2, Y + 0.88, rz2 - 0.3, false);
    for (const sz of [-1, 1]) B(0.06, 0.28, 0.06, M.pole, rx2 + 0.24, Y + 0.82, rz2 + sz * 0.2, false);
    mark(rx2, rz2, 'spring rider');
  }

  // ================= basketball court (west half of the yard) =================
  const CT = { x: -18, z: -11, w: 15, d: 10 };
  paint.push({ w: CT.w + 0.6, d: CT.d + 0.6, m: M.court, x: bx + CT.x, z: bz + CT.z });
  paint.push({ w: 0.18, d: CT.d, m: M.line, x: bx + CT.x - CT.w / 2, z: bz + CT.z });
  paint.push({ w: 0.18, d: CT.d, m: M.line, x: bx + CT.x + CT.w / 2, z: bz + CT.z });
  paint.push({ w: CT.w, d: 0.18, m: M.line, x: bx + CT.x, z: bz + CT.z - CT.d / 2 });
  paint.push({ w: CT.w, d: 0.18, m: M.line, x: bx + CT.x, z: bz + CT.z + CT.d / 2 });
  paint.push({ w: 0.18, d: CT.d, m: M.line, x: bx + CT.x, z: bz + CT.z });
  C(2.6, 2.6, 0.04, 20, M.line, CT.x, Y + 0.05, CT.z, false);
  for (const [hx2, dir] of [[CT.x - CT.w / 2 - 1.1, 1], [CT.x + CT.w / 2 + 1.1, -1]]) {
    C(0.1, 0.12, 3.6, 8, M.pole, hx2, Y + 1.8, CT.z + 0.5);
    B(1.1, 0.1, 0.1, M.pole, hx2 + dir * 0.6, Y + 3.5, CT.z + 0.5, false);       // arm over the baseline
    B(0.1, 1.15, 1.85, M.trim, hx2 + dir * 1.15, Y + 3.3, CT.z + 0.5, false);    // backboard
    C(0.24, 0.24, 0.05, 10, mat(0xe8703a), hx2 + dir * 1.35, Y + 2.95, CT.z + 0.5);
    mark(hx2, CT.z + 0.5, 'basketball hoop');
  }

  // paths: gate to the entrance, along the yard, and the apron in front of the lobby
  paint.push({ w: 2.6, d: 16.5, m: M.walk, x: bx + 0, z: bz - 8.2 });
  paint.push({ w: 12.5, d: 4.2, m: M.walk, x: bx + E.x, z: bz - 17.6 });
  paint.push({ w: 21, d: 2.2, m: M.walk, x: bx + 10, z: bz - 0.9 });
  // flagpole and a couple of benches inside the yard
  C(0.09, 0.12, 8.5, 8, M.trim, -4.4, Y + 4.25, -3.6);
  C(0.5, 0.5, 0.2, 10, M.plinth, -4.4, Y + 0.1, -3.6);
  B(1.5, 0.9, 0.03, M.red, -3.65, Y + 7.8, -3.6, false);
  B(0.55, 0.35, 0.03, M.trim, -4.12, Y + 7.8, -3.6, false);
  mark(-4.4, -3.6, 'flagpole');

  // ================= the lot out front: staff rows and the bus stand =================
  // three rows of staff bays (filled by the day/night curve like any other lot) ...
  const stallW = 4.6, perRow = 10, startX = -(perRow * stallW) / 2;
  [4.2, 11.6, 19.0].forEach((rz, ri) => {
    for (let i = 0; i <= perRow; i++) paint.push({ w: 0.16, d: 5.0, m: M.line, x: bx + startX + i * stallW, z: bz + rz });
    for (let i = 0; i < perRow; i++) {
      bays.push({ x: bx + startX + (i + 0.5) * stallW, z: bz + rz, rotY: rng() < 0.5 ? 0 : PI, hx: 1.25, hz: 2.6, bus: false });
    }
  });
  // ... and the bus stand: three long yellow bays along the kerb, marked out and signed
  for (const bxp of [-16, -3, 10]) {
    paint.push({ w: 11.6, d: 3.4, m: M.busBay, x: bx + bxp, z: bz + 25.4 });
    bays.push({ x: bx + bxp, z: bz + 25.4, rotY: PI / 2, hx: 5.3, hz: 1.5, bus: true });
  }
  const busMark = textBlocks('BUS', mat(0x2b2b2b), 1.5, 0.1, 0.4);
  busMark.rotation.x = -PI / 2; busMark.position.set(bx - 7, Y + 0.045, bz + 25.4); g.add(busMark);
  B(0.9, 2.4, 0.16, M.yellow, 23.6, Y + 1.2, 25.4, false);                      // BUS STOP blade by the lane
  const busSign = textBlocks('BUS', mat(0x2b2b2b), 0.5, 0.1, 0.3);
  busSign.position.set(23.6, Y + 1.9, 25.5); g.add(busSign);

  return {
    group: g, solids, bays, paint, fence, fenceRuns, playground,
    yard: { x: bx, z: bz + (YARD_Z - 20) / 2, hx: 28, hz: 10 },                 // the fenced yard, block-local centre
    lot: { x: bx, z: bz + 13.7, hx: 28, hz: 13.7 },
  };
}
// Pre-build every sign the world can show, at boot, while nothing is moving: the first time a string is used its
// letters have to be merged, and paying for that at boot is what keeps a shopping street from hitching the frame
// the player first drives past it.
export function warmTextCache() {
  const G = ['REG', 'MID', 'PREM', 'OPEN 24', 'OPEN', 'HOSPITAL', 'EMERGENCY', 'FIRE STATION', 'H', 'SCHOOL', 'GYMNASIUM', 'BUS'];
  for (const t of SHOP_TYPES) for (const h of [0.46, 0.72, 0.82]) textGeometry(t.name, h, h * 0.22, h * 0.5);
  for (const t of SHOP_TYPES) textGeometry(t.blade, 0.26, 0.06, 0.18);
  for (const t of PARADE_TITLES) textGeometry(t, 0.42, 0.1, 0.34);
  for (const b of FUEL_BRANDS) for (const h of [0.46, 0.72, 0.82]) textGeometry(b.name, h, h * 0.22, h * 0.5);
  for (const t of G) textGeometry(t, 0.3, 0.1, 0.26);
  textGeometry('H', 4.2, 0.14, 0.6);
  textGeometry('OVERPASS', 0.42, 0.12, 0.3);          // the interchange's direction plates
  textGeometry('OVERPASS', 0.62, 0.1, 0.34);          // ... the name plated on the bridge itself
  textGeometry('OVERPASS', 0.88, 0.1, 0.5);           // ... the billboard and the gantry panels
}
// ---- Fuel station ----
// Procedural forecourt in the style of a modern filling station: a big flat canopy with a lit underside and
// the brand's colours on the fascia, two pump islands with two dispensers each, a glazed convenience store
// behind it and a tall price pylon on the kerb. Three invented brands keep the three reference looks (white
// canopy with a red band, the yellow-and-red one, and the cool blue night canopy).
//
// The dispensers are built as their own little groups so the block can register each one as a separate
// destructible solid: js/collisions.js knocks a pump over, it tumbles off the island and the spill burns.
const FUEL_BRANDS = [
  { name: 'OCTANE 66', dark: 0xd42b2b, band: 0xf4f5f3, pump: 0xd8342c, shop: 0xeceeed, glow: 0xfff3d6, trim: 0x2a2f3a },
  { name: 'SUNCO',     dark: 0xd42b2b, band: 0xf2c200, pump: 0xf2c200, shop: 0xf0b705, glow: 0xfff6cc, trim: 0x33302a },
  { name: 'BLUEWAVE',  dark: 0x1f4fd8, band: 0xeef2f8, pump: 0x2a6cff, shop: 0xe9eef6, glow: 0xdce9ff, trim: 0x22303f },
];
// One dispenser, sized like a real one: plinth, a tall white body about 1 m across, a lit top lightbox and a
// brand-coloured cap well over head height (~2.4 m), big lit displays on both faces, and a nozzle and hose on
// each side so a car can fuel from either lane.
function buildPumpMesh(brand) {
  const g = new THREE.Group();
  const body = mat(0xf2f3f1), cap = mat(brand.pump), dark = mat(0x1d2026), steel = mat(0xa9b0b6), hose = mat(0x2a2d33);
  const display = new THREE.MeshBasicMaterial({ color: 0x39e08c });       // lit price display
  const topLit = new THREE.MeshBasicMaterial({ color: brand.glow });     // lit lightbox under the cap
  g.add(box(1.14, 0.26, 1.0, steel, 0, 0.13, 0, false));                 // island plinth
  g.add(box(1.06, 0.1, 0.92, dark, 0, 0.31, 0, false));                  // skirt shadow
  g.add(box(0.94, 1.56, 0.62, body, 0, 1.14, 0));                        // tall body
  g.add(box(0.98, 0.14, 0.66, cap, 0, 1.99, 0, false));                  // brand band
  g.add(box(1.08, 0.28, 0.78, cap, 0, 2.2, 0, false));                   // top cap
  g.add(box(1.16, 0.08, 0.86, cap, 0, 2.38, 0, false));                  // cap lip
  for (const sz of [-1, 1]) {
    g.add(box(0.8, 0.2, 0.03, topLit, 0, 1.99, sz * 0.34, false));       // lit lightbox, both faces
    g.add(box(0.66, 0.5, 0.05, display, 0, 1.7, sz * 0.33, false));      // big lit displays
    g.add(box(0.72, 0.36, 0.04, dark, 0, 1.24, sz * 0.33, false));       // grade / price strips
  }
  g.add(box(0.44, 0.6, 0.06, dark, 0, 0.95, 0.34, false));               // keypad and card reader
  for (const sx of [-1, 1]) {
    g.add(box(0.2, 0.5, 0.2, steel, sx * 0.52, 1.05, 0, false));         // nozzle holster
    g.add(box(0.16, 0.32, 0.16, cap, sx * 0.55, 1.26, 0.08, false));     // nozzle head
    g.add(box(0.07, 0.95, 0.07, hose, sx * 0.56, 0.72, -0.22, false));   // hose run down the side
    g.add(box(0.07, 0.3, 0.07, hose, sx * 0.56, 0.3, -0.3, false));
  }
  return g;
}
function buildFuelStationMesh(bx, bz, rng) {
  const brand = FUEL_BRANDS[Math.floor(rng() * FUEL_BRANDS.length)];
  const g = new THREE.Group(), solids = [], pumps = [], lamps = [];
  const M = {
    band: mat(brand.band), dark: mat(brand.dark), white: mat(0xf3f4f2), steel: mat(0xb6bcc2),
    concrete: mat(0x9aa0a6), glass: mat(0x1e3140), shop: mat(brand.shop), trim: mat(brand.trim),
    lit: new THREE.MeshBasicMaterial({ color: brand.glow }),                       // canopy underside glow
    inside: new THREE.MeshBasicMaterial({ color: 0xf6e3ac }),                      // lit shop interior
  };
  const Y = 0.25;                                         // forecourt surface (the block lays the pad)
  const B = (w, h, d, m, x, y, z, cast = true) => g.add(box(w, h, d, m, x, Y + y, z, cast));
  const CYL = (rt, rb, h, m, x, y, z, cast = false) => g.add(cyl(rt, rb, h, 8, m, x, Y + y, z, cast));

  // ---- canopy: flat white roof, brand fascia on all four edges, lit underside ----
  const CAN = { w: 27, d: 18, h: 6.3, z: 8 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * 10.6, cz = CAN.z + sz * 6.4;
    B(0.64, CAN.h - 0.4, 0.64, M.steel, cx, (CAN.h - 0.4) / 2, cz);
    B(0.86, 0.24, 0.86, M.concrete, cx, 0.12, cz, false);
    solids.push({ x: bx + cx, z: bz + cz, hx: 0.45, hz: 0.45, kind: 'column' });
  }
  B(CAN.w, 0.5, CAN.d, M.white, 0, CAN.h + 0.25, CAN.z);
  for (const [w, d, dx, dz] of [[CAN.w + 0.5, 0.7, 0, CAN.d / 2], [CAN.w + 0.5, 0.7, 0, -CAN.d / 2], [0.7, CAN.d + 0.5, CAN.w / 2, 0], [0.7, CAN.d + 0.5, -CAN.w / 2, 0]])
    B(w, 0.98, d, M.dark, dx, CAN.h + 0.2, CAN.z + dz);                          // fascia band
  B(CAN.w - 1.4, 0.14, CAN.d - 1.4, M.lit, 0, CAN.h - 0.04, CAN.z, false);       // lit ceiling panel
  for (const lx of [-9.5, -3.2, 3.2, 9.5]) for (const lz of [-4.6, 0, 4.6])
    B(2.7, 0.1, 0.55, M.lit, lx, CAN.h - 0.16, CAN.z + lz, false);               // strip lights
  const canopySign = textBlocks(brand.name, M.dark, 0.72, 0.16, 0.42);
  canopySign.position.set(0, Y + CAN.h + 0.31, CAN.z + CAN.d / 2 + 0.42); g.add(canopySign);
  for (const sx of [-1, 1]) {                                                    // the sides carry the name too
    const side = textBlocks(brand.name, M.dark, 0.6, 0.16, 0.36);
    side.position.set(sx * (CAN.w / 2 + 0.42), Y + CAN.h + 0.28, CAN.z); side.rotation.y = sx * PI / 2; g.add(side);
  }

  // ---- two pump islands, two dispensers each, bollards fore and aft ----
  for (const sx of [-1, 1]) {
    const ix = sx * 4.8;
    B(2.5, 0.26, 12.4, M.concrete, ix, 0.13, CAN.z, false);
    B(2.5, 0.06, 12.8, M.white, ix, 0.28, CAN.z, false);
    for (const pz of [CAN.z - 3.4, CAN.z + 3.4]) pumps.push({ x: ix, z: pz, y: Y, rotY: 0, group: buildPumpMesh(brand) });
    for (const sz of [-1, 1]) CYL(0.15, 0.17, 0.95, M.dark, ix, 0.47, CAN.z + sz * 6.9);
  }

  // ---- convenience store: glazed front facing the pumps, brand fascia, roof plant ----
  const S = { w: 22, d: 12, h: 4.7, x: 0, z: -18 };
  const fz = S.z + S.d / 2;
  B(S.w, S.h, S.d, M.shop, S.x, S.h / 2, S.z);
  solids.push({ x: bx + S.x, z: bz + S.z, hx: S.w / 2, hz: S.d / 2, kind: 'building' });
  B(S.w - 1.6, 2.9, 0.14, M.inside, S.x, 1.95, fz - 0.08, false);               // lit interior
  B(S.w - 1.2, 3.0, 0.1, M.glass, S.x, 1.95, fz + 0.04, false);                 // shopfront glass
  for (let i = -3; i <= 3; i++) B(0.14, 3.0, 0.18, M.white, S.x + i * 3.1, 1.95, fz + 0.12, false);
  B(2.4, 3.0, 0.18, M.trim, S.x + 8.6, 1.5, fz + 0.12, false);                  // entrance
  B(2.9, 0.28, 2.2, M.dark, S.x + 8.6, 3.32, fz + 0.5, false);                  // door canopy
  for (const sx of [-1, 1]) B(0.2, 3.2, 0.2, M.white, S.x + 8.6 + sx * 1.45, 1.5, fz + 0.9, false);
  B(S.w + 0.6, 1.2, 0.55, M.band, S.x, 3.7, fz + 0.22);                          // fascia band
  const shopSign = textBlocks(brand.name, M.dark, 0.82, 0.18, 0.5);
  shopSign.position.set(S.x, Y + 3.72, fz + 0.56); g.add(shopSign);
  const openSign = textBlocks('OPEN 24', M.dark, 0.3, 0.1, 0.24);
  openSign.position.set(S.x - 6.4, Y + 2.85, fz + 0.2); g.add(openSign);
  B(S.w + 0.4, 0.36, S.d + 0.4, M.white, S.x, S.h + 0.16, S.z, false);           // parapet
  for (const ax of [-6.5, 0, 6.5]) B(2.6, 1.1, 2.2, M.steel, S.x + ax, S.h + 0.72, S.z - 1.6);

  // ---- price pylon on the kerb, brand name over three lit grade/price rows ----
  const P = { x: -23, z: 21.5 };
  B(1.0, 8.7, 0.9, M.steel, P.x, 4.35, P.z);
  B(4.9, 3.7, 0.42, M.dark, P.x, 8.35, P.z);
  B(5.1, 0.55, 0.46, M.band, P.x, 10.45, P.z, false);
  const pylonName = textBlocks(brand.name, M.white, 0.46, 0.12, 0.34);
  pylonName.position.set(P.x, Y + 9.95, P.z + 0.28); g.add(pylonName);
  [['REG', '3.79'], ['MID', '4.05'], ['PREM', '4.29']].forEach(([grade, price], i) => {
    const y = Y + 9.05 - i * 0.82;
    const gt = textBlocks(grade, M.white, 0.3, 0.1, 0.26); gt.position.set(P.x - 1.5, y, P.z + 0.28); g.add(gt);
    const pt = textBlocks(price, M.white, 0.46, 0.1, 0.2); pt.position.set(P.x + 0.95, y, P.z + 0.28); g.add(pt);
  });
  solids.push({ x: bx + P.x, z: bz + P.z, hx: 0.72, hz: 0.62, kind: 'pole' });

  // ---- forecourt fittings: lamp masts, drains, bins, an air-and-water box, painted lanes ----
  for (const sx of [-1, 1]) {
    const lx = sx * 13.5, lz = 17.5;
    CYL(0.16, 0.2, 7.4, M.steel, lx, 3.7, lz, true);
    B(1.5, 0.22, 0.7, M.lit, lx, 7.35, lz, false);
    solids.push({ x: bx + lx, z: bz + lz, hx: 0.34, hz: 0.34, kind: 'lamp' });
    B(0.4, 0.02, 12, M.white, sx * 7.8, 0.02, CAN.z, false);                     // lane markings
  }
  for (const [dx, dz] of [[0, 16.6], [-9.5, -3.4], [9.5, -3.4]]) B(2.2, 0.05, 0.9, M.trim, dx, 0.03, dz, false);
  for (const sx of [-1, 1]) { CYL(0.34, 0.36, 0.9, M.trim, sx * 8.6, 0.45, S.z + 7.4); }
  B(1.9, 1.5, 1.1, M.steel, 12.6, 0.75, S.z + 8.2);                              // air / water box
  B(2.0, 0.14, 1.2, M.dark, 12.6, 1.56, S.z + 8.2, false);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) CYL(0.13, 0.15, 0.8, M.dark, sx * 12.2, 0.4, 17.4 + i * 2.1);
  lamps.push({ x: bx - 13.5, z: bz + 17.5 }, { x: bx + 13.5, z: bz + 17.5 });

  return { group: g, solids, pumps, brand, canopy: CAN, store: S, pylon: P, lamps };
}
// ---- Shops: a high street of small businesses ----
// Every shop is a facade kit: plinth, a display window whose goods are silhouetted against a lit pane,
// mullions, a door with a step and an OPEN plate, a fascia carrying the shop's name, a striped awning, a
// projecting blade sign and a few outdoor props (cafe tables, produce crates, flower stands...). The window
// pane is returned as its own group so a car can smash it out (see breakShopFront in js/collisions.js).
const SHOP_TYPES = [
  { name: 'CAFE',     kind: 'cafe',     fascia: 0x6b4a2f, sign: 0xf2e9d8, glow: 0xffcf8f, awn: [0x8c3f24, 0xf0e2c8], accent: 0x7a4a28, blade: 'CA', props: 'cafe' },
  { name: 'BAKERY',   kind: 'bakery',   fascia: 0xe6dcc4, sign: 0x8a4b12, glow: 0xffd9a0, awn: [0xd8b064, 0xfaf3e2], accent: 0xc98a3a, blade: 'BK', props: 'bread' },
  { name: 'PIZZA',    kind: 'pizza',    fascia: 0x1f6b3a, sign: 0xf7f3e8, glow: 0xffe0a0, awn: [0x1f6b3a, 0xd8452f], accent: 0xd8452f, blade: 'PZ', props: 'tavern' },
  { name: 'MARKET',   kind: 'market',   fascia: 0x2f7d5b, sign: 0xf4f7f4, glow: 0xe0ffdc, awn: [0x2f7d5b, 0xffffff], accent: 0x86c34a, blade: 'MK', props: 'produce' },
  { name: 'PHARMACY', kind: 'pharmacy', fascia: 0xf0f3f4, sign: 0x1c7a4a, glow: 0xd8ffe8, awn: [0x1c7a4a, 0xf2f5f6], accent: 0x2fbf7a, blade: 'RX', props: 'planter' },
  { name: 'BOOKS',    kind: 'books',    fascia: 0x7a2f2f, sign: 0xf6e9d0, glow: 0xffe9b8, awn: [0x7a2f2f, 0xe8d6b0], accent: 0x9a6a3a, blade: 'BO', props: 'crates' },
  { name: 'BARBER',   kind: 'barber',   fascia: 0x1f3a6b, sign: 0xf2f5f6, glow: 0xdcE8ff, awn: [0x2a5fb0, 0xffffff], accent: 0xd8452f, blade: 'BR', props: 'bench' },
  { name: 'DONUTS',   kind: 'donuts',   fascia: 0xe08bb0, sign: 0x4a2140, glow: 0xffd8ec, awn: [0xe08bb0, 0xfff3f8], accent: 0xf2a0c0, blade: 'DN', props: 'cafe' },
  { name: 'FLOWERS',  kind: 'flowers',  fascia: 0x3f7d4f, sign: 0xfdf6e3, glow: 0xe8ffdc, awn: [0x3f7d4f, 0xf0e2c8], accent: 0xd84f8a, blade: 'FL', props: 'flowers' },
  { name: 'HARDWARE', kind: 'hardware', fascia: 0x9a5a1f, sign: 0xf7efdd, glow: 0xffe3b0, awn: [0x9a5a1f, 0xd8d2c4], accent: 0x6c7580, blade: 'HW', props: 'crates' },
  { name: 'LAUNDRY',  kind: 'laundry',  fascia: 0x2f6f86, sign: 0xf2fbff, glow: 0xdcf4ff, awn: [0x2f6f86, 0xffffff], accent: 0x9fd8e8, blade: 'LD', props: 'bench' },
  { name: 'SHOES',    kind: 'shoes',    fascia: 0x3a3a44, sign: 0xf2f2f2, glow: 0xffe9c0, awn: [0x3a3a44, 0xb0b6bd], accent: 0x7a4a28, blade: 'SH', props: 'bench' },
  { name: 'ARCADE',   kind: 'arcade',   fascia: 0x2a1f4a, sign: 0x9cf0ff, glow: 0xc0baff, awn: [0x2a1f4a, 0x9cf0ff], accent: 0x6f5bd8, blade: 'AR', props: 'bench' },
  { name: 'GRILL',    kind: 'grill',    fascia: 0xb03a2a, sign: 0xfff2d8, glow: 0xffc98a, awn: [0xb03a2a, 0xf6e0b0], accent: 0x8a2f22, blade: 'GR', props: 'tavern' },
];
const PARADE_TITLES = ['HIGH STREET', 'OLD TOWN PARADE', 'MARKET ROW', 'TRADERS ROW'];
// The sign font is a fixed 5x7 block font, so a long name has to be scaled down to fit its fascia.
function fitText(str, m, maxW, th, depth, gap) {
  const unit = 5 * th / 7 + gap;
  const total = str.length * unit - gap;
  if (total > maxW) { const k = (maxW + gap) / (str.length * unit); th *= k; gap *= k; }
  return textBlocks(str, m, th, depth, gap);
}
// One storefront, built in local coordinates: front plane at z = 0, ground at y = 0, centred on x.
function buildShopFrontMesh(shop, w, h, rng, opts) {
  const body = new THREE.Group(), glass = new THREE.Group();
  const F = mat(shop.fascia), S = mat(shop.sign), dark = mat(0x2a2d33), frame = mat(0xe9ebe8), steel = mat(0xb6bcc2);
  const pane = new THREE.MeshBasicMaterial({ color: shop.glow });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0cf });
  const accent = mat(shop.accent);
  const B = (g, bw, bh, bd, m, x, y, z, cast = true) => g.add(box(bw, bh, bd, m, x, y, z, cast));
  const winW = w - 1.1, sill = 0.52, winH = h - 2.05;
  // ---- the shop window: a lit pane with the goods silhouetted in front of it ----
  B(glass, winW, winH, 0.07, pane, 0, sill + winH / 2, 0.03, false);
  B(body, winW + 0.5, winH + 0.5, 0.14, mat(0x22252b), 0, sill + winH / 2, -1.25, false);   // dark interior behind the pane
  B(body, 0.2, winH, 0.24, frame, -winW / 2, sill + winH / 2, 0.1, false);                  // jambs
  B(body, 0.2, winH, 0.24, frame, winW / 2, sill + winH / 2, 0.1, false);
  B(body, winW + 0.4, 0.16, 0.26, frame, 0, sill, 0.1, false);                              // sill
  B(body, winW + 0.4, 0.2, 0.26, frame, 0, sill + winH + 0.1, 0.1, false);                  // head
  B(body, w, sill, 0.24, mat(0x4a4d55), 0, sill / 2, 0.08);                                 // plinth
  // goods on show, silhouette boxes of differing height so no two windows look alike
  const goods = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < goods; i++) {
    const gw = 0.5 + rng() * 0.7, gh = 0.5 + rng() * (winH - 1.4), gd = 0.4 + rng() * 0.5;
    const gx = -winW / 2 + 0.6 + (i + 0.5) * ((winW - 1.2) / goods) + rng() * 0.2;
    B(body, gw, gh, gd, i % 2 ? accent : dark, gx, sill + 0.1 + gh / 2, -0.55 - rng() * 0.5);
  }
  B(body, winW - 1.6, 0.9, 1.1, dark, 0, sill + 0.55, -1.15, false);                        // counter at the back
  for (let i = 0; i < 3; i++) B(body, 0.16, 0.16, 0.16, lamp, -winW / 3 + i * winW / 3, h - 1.15, -0.55, false);   // ceiling lamps
  // ---- mullions ----
  const cols = Math.max(2, Math.round(winW / 2.1));
  for (let i = 1; i < cols; i++) B(body, 0.13, winH, 0.2, frame, -winW / 2 + i * (winW / cols), sill + winH / 2, 0.09, false);
  B(body, winW + 0.4, 0.12, 0.2, frame, 0, sill + winH * 0.62, 0.09, false);                // transom
  // ---- fascia with the shop's name, lamps and a blade sign ----
  B(body, w, 0.95, 0.3, F, 0, h - 0.5, 0.15);
  const name = fitText(shop.name, S, w - 1.6, 0.46, 0.12, 0.4);
  name.position.set(0, h - 0.5, 0.33); body.add(name);
  for (const sx of [-1, 1]) {
    B(body, 0.36, 0.14, 0.3, lamp, sx * (w / 2 - 0.95), h - 1.16, 0.2, false);              // shop lamps
    B(body, 0.08, 0.22, 0.08, steel, sx * (w / 2 - 0.95), h - 1.3, 0.16, false);
  }
  const bladeX = w / 2 - 1.0;
  B(body, 0.1, 0.7, 0.7, F, bladeX, h - 2.1, 0.62);
  const monoL = fitText(shop.blade, S, 0.72, 0.26, 0.06, 0.18); monoL.position.set(bladeX + 0.07, h - 2.1, 0.62); monoL.rotation.y = PI / 2; body.add(monoL);
  const monoR = fitText(shop.blade, S, 0.72, 0.26, 0.06, 0.18); monoR.position.set(bladeX - 0.07, h - 2.1, 0.62); monoR.rotation.y = -PI / 2; body.add(monoR);
  B(body, 0.07, 0.07, 0.55, steel, bladeX, h - 1.72, 0.32, false);                          // bracket
  // ---- door at the other end, with a step and an OPEN plate ----
  const dx = -(w / 2) + 1.55;
  B(body, 1.35, h - 1.7, 0.2, frame, dx, (h - 1.7) / 2 + 0.5, 0.08);
  B(body, 1.05, h - 2.2, 0.14, mat(0x2b3a44), dx, (h - 2.2) / 2 + 0.55, 0.16);
  B(body, 0.86, 0.9, 0.06, pane, dx, 1.75, 0.24, false);                                    // the door glows too
  B(body, 0.09, 0.62, 0.09, steel, dx + 0.42, 1.15, 0.25, false);                           // push bar
  B(body, 1.9, 0.16, 0.8, mat(0x6f747c), dx, 0.08, 0.4);                                    // step
  const open = fitText('OPEN', S, 1.2, 0.2, 0.06, 0.22);
  open.position.set(dx, h - 1.62, 0.25); body.add(open);
  // ---- striped awning (skipped when the shop sits too close to the pavement) ----
  if (opts.awning !== false) {
    const aw = new THREE.Group(); aw.position.set(0.3, h - 1.55, 0.12); aw.rotation.x = -0.16;
    const n = 8, sw2 = (w - 0.5) / n;
    for (let i = 0; i < n; i++) {
      const m = i % 2 ? mat(shop.awn[0]) : mat(shop.awn[1]);
      aw.add(box(sw2, 0.07, 1.7, m, -(w - 0.5) / 2 + (i + 0.5) * sw2, 0, 0.85));
      aw.add(box(sw2, 0.26, 0.06, i % 2 ? mat(shop.awn[1]) : mat(shop.awn[0]), -(w - 0.5) / 2 + (i + 0.5) * sw2, -0.18, 1.68, false));
    }
    for (const sx of [-1, 1]) aw.add(box(0.08, 0.08, 1.72, steel, sx * (w - 0.5) / 2, 0.02, 0.85, false));
    body.add(aw);
  }
  // ---- outdoor props, kept within 1.6 m of the front so parked cars clear them ----
  if (opts.outdoor !== false) {
    const P = shop.props, ox = -w / 2 + 1.2;
    const crate = (x, z, col, n2 = 3) => { for (let i = 0; i < n2; i++) B(body, 0.42, 0.28, 0.34, mat(0xb98a55), x, 0.3 + i * 0.3, z, false); B(body, 0.34, 0.16, 0.26, mat(col), x, 0.34 + n2 * 0.3, z, false); };
    if (P === 'cafe') {
      for (const [tx, tz] of [[ox + 0.4, 1.15], [ox + 2.5, 1.15]]) {
        B(body, 0.62, 0.06, 0.62, mat(0x8a8f96), tx, 0.76, tz, false);
        B(body, 0.08, 0.72, 0.08, steel, tx, 0.38, tz, false);
        for (const s2 of [-1, 1]) B(body, 0.34, 0.42, 0.34, mat(0x6f5a44), tx + s2 * 0.62, 0.22, tz, false);
      }
      B(body, 0.75, 0.95, 0.07, mat(0x2f3a33), ox + 1.6, 0.48, 1.5, false);                  // menu board
    } else if (P === 'produce') {
      crate(ox + 0.5, 1.1, 0x86c34a, 2); crate(ox + 1.5, 1.15, 0xd8452f, 2); crate(ox + 2.5, 1.1, 0xf2a93b, 1);
    } else if (P === 'bread') {
      B(body, 1.5, 0.08, 0.7, mat(0xb98a55), ox + 1.0, 0.92, 1.15, false);
      B(body, 1.5, 0.08, 0.7, mat(0xb98a55), ox + 1.0, 0.6, 1.15, false);
      for (const s2 of [-1, 1]) B(body, 0.07, 0.9, 0.07, mat(0x8a6a42), ox + 1.0 + s2 * 0.7, 0.45, 1.15, false);
      for (let i = 0; i < 4; i++) B(body, 0.34, 0.24, 0.26, mat(0xc98a3a), ox + 0.4 + i * 0.4, 1.04, 1.15, false);
    } else if (P === 'flowers') {
      for (const [fx, fz] of [[ox + 0.3, 1.1], [ox + 1.7, 1.1]]) {
        B(body, 0.7, 0.55, 0.5, mat(0x8a8f96), fx, 0.3, fz, false);
        for (let i = 0; i < 4; i++) B(body, 0.16, 0.34, 0.16, mat([0xd84f8a, 0xf2a93b, 0xe34a4a, 0x8e5bd9][i]), fx - 0.24 + (i % 2) * 0.48, 0.8, fz - 0.12 + Math.floor(i / 2) * 0.24, false);
      }
    } else if (P === 'tavern') {
      B(body, 2.0, 0.09, 0.85, mat(0x9a7a52), ox + 1.3, 0.82, 1.15, false);
      for (const s2 of [-1, 1]) B(body, 0.12, 0.8, 0.8, mat(0x7a5f3f), ox + 1.3 + s2 * 0.9, 0.42, 1.15, false);
      B(body, 0.09, 2.2, 0.09, steel, ox + 1.3, 1.1, 1.5, false);
      B(body, 2.2, 0.12, 2.0, mat(0xd8452f), ox + 1.3, 2.25, 1.5, false);
    } else if (P === 'crates') {
      crate(ox + 0.5, 1.1, 0x6c7580, 3); crate(ox + 1.4, 1.15, 0x6c7580, 1);
    } else if (P === 'bench') {
      B(body, 1.5, 0.1, 0.55, mat(0x9a7a52), ox + 1.2, 0.48, 1.15, false);
      B(body, 1.5, 0.5, 0.1, mat(0x9a7a52), ox + 1.2, 0.75, 0.95, false);
      for (const s2 of [-1, 1]) B(body, 0.11, 0.46, 0.11, mat(0x6f747c), ox + 1.2 + s2 * 0.65, 0.24, 1.15, false);
    } else {
      for (const px of [ox + 0.3, ox + 2.4]) {
        B(body, 0.9, 0.5, 0.55, mat(0x8a8f96), px, 0.28, 1.1, false);
        B(body, 0.8, 0.3, 0.45, mat(0x4e9c48), px, 0.62, 1.1, false);                          // planter greenery
      }
    }
  }
  return { body, glass };
}
// A parade: one low building whose front is a row of different shops, framed by two taller corner towers
// carrying the parade's name. Local coordinates: front plane at z = 0, body towards -z, length along x.
function buildShopParadeMesh(shops, rng, opts = {}) {
  const shopW = opts.shopW || 9, depth = opts.depth || 8.5, h = opts.h || 4.4;
  const len = shops.length * shopW;
  const g = new THREE.Group(), glasses = [], list = [];
  const wall = mat(opts.wall || 0xc9c6bd), trim = mat(0xe4e1d7), roofM = mat(0x8b8f95), steel = mat(0xb6bcc2);
  const gate = new THREE.MeshBasicMaterial({ color: 0xffe6b0 });
  const B = (bw, bh, bd, m, x, y, z, cast = true) => g.add(box(bw, bh, bd, m, x, y, z, cast));
  B(len + 7, h, depth, wall, 0, h / 2, -depth / 2);                                  // the parade box, towers included
  B(len + 7.4, 0.42, depth + 0.5, trim, 0, h + 0.21, -depth / 2, false);             // parapet
  B(len, 0.5, 0.3, trim, 0, 0.25, 0.15, false);                                      // base course
  // Roof plant: three boxes at -len/4, 0 and +len/4 along the parade. The stride has to be len/4 — a stride of
  // len/2 put the third box at +3len/4, i.e. 7.75 m past the end of the building, so a grey box hung in mid-air
  // over the street beside every parade (reported as the box that is attached to nothing).
  for (let i = 0; i < 3; i++) B(1.9, 0.95, 1.7, roofM, (i - 1) * len / 4, h + 0.75, -depth + 1.4);   // roof plant
  for (const sx of [-1, 1]) {                                                        // corner towers
    const tx = sx * (len / 2 + 2.4);
    B(0.35, h + 2.8, depth + 0.9, trim, tx - sx * 1.45, (h + 2.8) / 2, -depth / 2 - 0.45, false);   // end pilaster
    B(2.7, 1.5, 0.16, mat(0x2b3a44), tx, h + 0.9, 0.5, false);                       // upper windows
    B(2.7, 1.5, 0.16, mat(0x2b3a44), tx, h + 0.9, -depth - 0.5, false);
    B(3.4, 1.0, 0.24, mat(0x2f343b), tx, h + 2.1, 0.55, false);                      // sign board
    const title = fitText(opts.title || 'SHOPS', mat(0xf2e9d8), 3.1, 0.42, 0.1, 0.34);
    title.position.set(tx, h + 2.1, 0.7); g.add(title);
    const side = fitText(opts.title || 'SHOPS', mat(0xf2e9d8), 3.1, 0.42, 0.1, 0.34);
    side.position.set(tx, h + 2.1, -depth - 0.7); side.rotation.y = PI; g.add(side);
    B(0.3, 0.3, 0.3, gate, tx, h + 0.15, 0.5, false);                                // door lamp
  }
  shops.forEach((shop, i) => {
    const x = -len / 2 + (i + 0.5) * shopW;
    B(0.26, h, 0.3, trim, x - shopW / 2, h / 2, 0.15, false);                        // pilaster between shops
    const kit = buildShopFrontMesh(shop, shopW - 0.3, h, rng, opts);
    kit.body.position.x = x; g.add(kit.body);
    // the kit's glass stays at its own origin: the block places each shop's pane at that shop's world
    // position below. Offsetting it here as well used to move every pane twice, which left the two end
    // windows of every parade standing out in the street as 7.6 x 2.35 m pale sheets.
    glasses.push({ group: kit.glass, x, w: shopW - 0.3, name: shop.name, kind: shop.kind });
    list.push({ name: shop.name, kind: shop.kind, x, w: shopW - 0.3 });
  });
  B(0.26, h, 0.3, trim, len / 2, h / 2, 0.15, false);                                // closing pilaster
  return { group: g, glasses, shops: list, len, depth, h, shopW };
}
// Compact splitter-nose protection, facing local +z (approaching traffic). Shared geometry is baked into
// the owning quarter's chunk; no textures, remote models or per-frame allocations are needed.
export function buildFlyoverNoseGuard() {
  const g = new THREE.Group();
  const yellow = mat(0xffc928), black = mat(0x252a30), white = mat(0xf5f4e9);
  const red = mat(0xe93827), blue = mat(0x1767c8), steel = mat(0x858e94);
  const B = (w, h, d, m, x, y, z) => { const b = box(w, h, d, m, x, y, z); g.add(b); return b; };
  // Yellow impact barrel with a broad foot, lid and black warning panels on its approach face.
  g.add(cyl(0.65, 0.68, 0.12, 12, black, 0, 0.06, 0));
  g.add(cyl(0.59, 0.63, 0.94, 12, yellow, 0, 0.59, 0));
  g.add(cyl(0.64, 0.64, 0.10, 12, yellow, 0, 1.10, 0));
  for (const x of [-0.31, 0.31]) B(0.17, 0.70, 0.055, black, x, 0.58, 0.56);
  B(0.11, 1.2, 0.11, steel, 0, 1.65, -0.12);
  // Red/white upward chevrons under a blue "pass either side" sign, as on a splitter island.
  B(0.80, 0.65, 0.075, white, 0, 1.53, 0.02);
  for (const y of [1.36, 1.63]) for (const side of [-1, 1]) {
    const b = B(0.43, 0.105, 0.018, red, side * 0.18, y, 0.069);
    b.rotation.z = -side * Math.PI / 6;
  }
  const disk = cyl(0.43, 0.43, 0.08, 24, white, 0, 2.25, 0.02);
  disk.rotation.x = Math.PI / 2; g.add(disk);
  const face = cyl(0.395, 0.395, 0.018, 24, blue, 0, 2.25, 0.071);
  face.rotation.x = Math.PI / 2; g.add(face);
  // Two diagonal downward arrows, made of solid geometry so they stay legible without canvas textures.
  for (const side of [-1, 1]) {
    const shaft = B(0.075, 0.38, 0.014, white, side * 0.12, 2.25, 0.087);
    shaft.rotation.z = side * Math.PI / 4;
    B(0.18, 0.065, 0.014, white, side * 0.20, 2.115, 0.087);
    B(0.065, 0.18, 0.014, white, side * 0.265, 2.175, 0.087);
  }
  return g;
}
function buildFlyoverDelineator() {
  const g = new THREE.Group(), orange = mat(0xff5824), white = mat(0xf6f4e9);
  g.add(cyl(0.18, 0.21, 0.06, 10, orange, 0, 0.03, 0));
  g.add(cyl(0.055, 0.075, 1.0, 10, orange, 0, 0.56, 0));
  for (const y of [0.64, 0.87]) g.add(cyl(0.068, 0.071, 0.13, 10, white, 0, y, 0));
  return g;
}
/* ---- The interchange's own signage ----
 * A grade-separated junction is signed three ways, and every one of the four blocks around it builds its own
 * quarter of all three, in the quarter's own frame, so no block has to know what its neighbours are doing:
 *
 *   nameboard   a plated name hung on the abutment face at each bridge mouth — the leaning concrete above the
 *               hazard boards, one board per half of the carriageway. It is read by anyone who drives along
 *               the road that flies: at grade under the deck, or climbing the ramp towards it.
 *   billboard   a lit advertising board standing on the deck's parapet coping, facing out across the ground
 *               street, so the structure is signed to the city it crosses (and to the player coming up the
 *               at-grade lane beside the embankment).
 *   gantry      a sign gantry over each approach to the deck: one leg standing on each parapet's coping, the
 *               beam reaching in over the carriageway, and a panel over each half of the road, so the traffic
 *               that has just climbed the ramp is told what it is crossing.
 *
 * Everything is plain geometry — box-pixel lettering, no textures, no HTML overlays — and baked into the block
 * that owns it, so the signs cost draw calls like any other part of the structure and stream out with it. They
 * stand above the parapet or hang on the concrete outside the drivable width, so none of them needs a solid:
 * a car on the deck is already held inside the parapets, and a car at grade never reaches them.
 *
 * Each builder works in a local frame where +z faces the reader, +x runs across the road and y = 0 is the level
 * the piece is mounted on (the plate's own centre, the panel's centre, the deck surface). The block places it
 * and turns it; the records it writes onto `ch.flyover` carry the same numbers in world terms, which is what
 * tools/sidewalk-checks/flyover-signs.mjs checks without a browser.
 */
function buildFlyoverNameboard() {
  const g = new THREE.Group(), cream = mat(0xf2e9d8), blue = mat(0x1b4f9c), steel = mat(0x8f959b);
  // 0.78 m deep on purpose: the abutment face leans back as it rises, so with the plate's face clear of the
  // concrete at its bottom edge the back of the board is buried in the concrete at its top (see `faceAt`).
  // Two-sided: the at-grade side (z = -0.78..-0.18) and the deck side (z = +0.18..+0.78) both carry a blue
  // field and lettering, so the plate reads from the street below *and* from anyone standing on the deck.
  g.add(box(5.75, 1.5, 0.6, cream, 0, 0, -0.48, false));                 // backing, 0.15 m of border all round
  g.add(box(5.75, 1.5, 0.6, cream, 0, 0, +0.48, false));                 // ... back face
  g.add(box(5.45, 1.2, 0.5, blue, 0, 0, -0.25, false));                  // blue field (at-grade side)
  g.add(box(5.45, 1.2, 0.5, blue, 0, 0, +0.25, false));                  // blue field (deck side)
  for (const ox of [-2.79, 2.79]) for (const oy of [-0.5, 0.5]) {
    g.add(box(0.18, 0.18, 0.08, steel, ox, oy, -0.14, false));           // bolt heads (at-grade side)
    g.add(box(0.18, 0.18, 0.08, steel, ox, oy, +0.14, false));           // bolt heads (deck side)
  }
  const txt1 = textBlocks('OVERPASS', cream, 0.62, 0.1, 0.34); txt1.position.set(0, 0.01, 0.03); g.add(txt1);
  // deck side: mirror the lettering so it reads correctly from the other side of the slab
  const txt2 = textBlocks('OVERPASS', cream, 0.62, 0.1, 0.34, true);
  txt2.position.set(0, 0.01, 0.93); g.add(txt2);
  return g;
}
function buildFlyoverBillboard() {
  const g = new THREE.Group(), cream = mat(0xf2e9d8), steel = mat(0x8a9096), dark = mat(0x2b3138);
  // Lit field (lambert with an emissive tint, like the bus shelters' ad panels and the fuel canopy's
  // lightboxes), so the board reads at night without a light of its own. The panel's centre is 1.45 m above
  // the coping: its two feet are at local y = -1.45.
  // Two-sided: both the street-below side and the deck side carry a lit field and lettering.
  const lit = mat(0xc0392b, { emissive: 0x6a1712 });
  g.add(box(5.9, 2.0, 0.16, cream, 0, 0, 0, false));                    // rim (centred)
  g.add(box(5.5, 1.7, 0.26, lit, 0, 0, 0.2, false));                    // lit field (street side)
  g.add(box(5.5, 1.7, 0.26, lit, 0, 0, -0.2, false));                   // lit field (deck side)
  const txt1 = textBlocks('OVERPASS', cream, 0.88, 0.1, 0.5); txt1.position.set(0, 0.04, 0.35); g.add(txt1);
  // deck side: mirrored lettering so it reads from the other side of the board
  const txt2 = textBlocks('OVERPASS', cream, 0.88, 0.1, 0.5, true);
  txt2.position.set(0, 0.04, -0.35); g.add(txt2);
  for (const ox of [-2.0, 2.0]) {
    g.add(box(0.18, 0.45, 0.18, steel, ox, -1.225, 0, false));          // post down to the coping (centred)
    g.add(box(0.5, 0.1, 0.5, dark, ox, -1.4, 0, false));                // foot plate on the coping (centred)
  }
  return g;
}
// `legV` is the parapet's own centre line (how far the leg and the beam's root stand from the road's centre
// line) and `dir` is the way, in this local frame, that the centre line lies: the beam and the sign panel reach
// from the leg in by `dir`, so one block builds the half over its own side of the road and the two halves meet
// over the middle.
// Local heights are measured from the coping's top (0) upwards, and the panel hangs under the beam with a
// hand's width of clearance, so the sign passes under the beam instead of through it.
function buildFlyoverGantry(legV, dir) {
  const g = new THREE.Group(), cream = mat(0xf2e9d8), blue = mat(0x1b4f9c), steel = mat(0x8a9096);
  // The base plate is 0.44 m across on purpose: centred on the leg (the parapet's own centre line) it stops
  // just short of the parapet's inner face, so nothing of the gantry leans into the lane's clear width.
  // Sign panel is two-sided: both the approach-facing side and the opposite side carry a blue field and
  // lettering, so the gantry reads from traffic in both directions.
  g.add(box(0.44, 0.14, 0.44, steel, 0, 0.07, 0, false));               // base plate, on the coping
  g.add(box(0.3, 4.32, 0.3, steel, 0, 2.30, 0, false));                 // leg, up to the beam's underside
  g.add(box(legV, 0.32, 0.34, steel, dir * legV / 2, 4.62, 0, false));  // half the beam, out to the centre line
  g.add(box(6.0, 2.0, 0.14, cream, dir * 4.6, 3.42, 0, false));         // sign panel, backing (centred)
  g.add(box(5.7, 1.7, 0.26, blue, dir * 4.6, 3.42, 0.18, false));       // ... its field (front)
  g.add(box(5.7, 1.7, 0.26, blue, dir * 4.6, 3.42, -0.18, false));      // ... its field (back)
  const txt1 = textBlocks('OVERPASS', cream, 0.88, 0.1, 0.5); txt1.position.set(dir * 4.6, 3.45, 0.33); g.add(txt1);
  // back side: mirrored lettering so it reads from the opposite approach
  const txt2 = textBlocks('OVERPASS', cream, 0.88, 0.1, 0.5, true);
  txt2.position.set(dir * 4.6, 3.45, -0.33); g.add(txt2);
  return g;
}

/* ---- Junction plazas ----
 * A small circular island in the middle of an eligible plain four-way junction: a curb ring in concrete and
 * a disc of grass inside. The central feature (fountain, statue, or tree grove) is a destructible prop placed
 * at the junction's centre — a car that drives into it knocks it down, just like a streetlight or a hydrant.
 * The island itself has no solid, so cars can drive over it (the curb is only 0.3 m tall — a speed bump).
 *
 * `plazaAt(jx, jz)` in js/flyover.js decides which junctions get one — it keeps plazas off the main roads
 * (where flyovers live), off junctions beside flyovers (the cut corner would swallow them), and off junctions
 * under flyover ramps. ~15% of the remaining junctions become plazas.
 *
 * The whole island is 5 m in radius. A plain junction's carriageway is 16.5 m wide, so that leaves 3.25 m of
 * lane on each side — enough for one lane each way, and enough for the traffic to go around the island.
 *
 * The builder produces only the island base (curb + grass). The central feature is placed separately as a
 * prop by generateChunk() so it gets the same breakable-prop lifecycle as everything else (collision, drag,
 * flying debris, etc.).
 */
function buildPlazaIsland(radius) {
  const g = new THREE.Group();
  const concrete = mat(0xd4cfc4), grass = mat(0x3a7a2a);
  // The curb: a concrete disc, 0.3 m tall. Low enough that a car can drive over it — it's a speed bump,
  // not a wall. Cars that don't want to hit the central feature just go around.
  g.add(cyl(radius, radius, 0.3, 24, concrete, 0, 0.15, 0, false));
  // Grass: a slightly smaller disc on top of the curb, so the curb's rim stays bare concrete all round.
  g.add(cyl(radius - 0.35, radius - 0.35, 0.34, 24, grass, 0, 0.17, 0, false));
  return g;
}

function generateChunk(cx, cz, defer = false) {
  const rng = mulberry32(hash2(cx, cz) ^ 0x51ED);
  const r = (a = 0, b = 1) => a + (b - a) * rng();
  const nShop = 5, shopW = 9;                                  // five businesses per parade, 9 m each
  const x0 = cx * CHUNK, z0 = cz * CHUNK, bx = x0 + 40, bz = z0 + 40, bx0 = x0 + 12, bz0 = z0 + 12;
  const group = new THREE.Group();
  const ch = { cx, cz, group, solids: [], props: [], pickups: [], ramps: [], busStops: [], pumps: [], fencePanels: [], shops: [], parades: [], roadworks: [], geos: [], owned: [], bakeList: [], trees: [], insts: [], keepouts: [], parking: [], pads: [], spill: [], lotStanding: [], signalPoles: [], plazas: [] };
  const safe = (cx === 0 || cx === -1) && (cz === 0 || cz === -1);
  const add = o => bake(ch, o);
  // `maxY` marks a solid that only exists for what is below it — the interchange's embankment walls are real
  // for a car at grade under the bridge and gone for a car standing on the deck above them.
  const solid = (x, z, hx, hz, kind, maxY) => ch.solids.push({ x, z, hx, hz, kind, maxY, box: { x, z, ux: 1, uz: 0, vx: 0, vz: 1, e1: hx, e2: hz } });
  // Sidewalk ring occupies these distances from the block centre (kerb stone up to the inner kerb).
  const WALK_LO = CHUNK / 2 - PAVE_OUT, WALK_HI = CHUNK / 2 - PAVE_IN;
  const onWalk = (x, z) => {
    const dx = Math.abs(x - bx), dz = Math.abs(z - bz);
    const inBand = a => a >= WALK_LO && a <= WALK_HI;
    return (inBand(dx) && dz <= WALK_HI) || (inBand(dz) && dx <= WALK_HI);
  };
  const prop = (kind, x, z, rotY = 0, y = 0.15) => {
    if (onAtGradeLane(x, z, 0.7)) return;                      // that strip is carriageway now, not pavement
    const d = PROP_DEFS[kind], m = own(ch, mergeStandalone(d.make())); m.position.set(x, y + (onWalk(x, z) ? WALK_Y : 0), z); m.rotation.y = rotY; group.add(m);
    ch.props.push({ mesh: m, x, z, r: d.r, drag: d.drag, color: d.color, kind, broken: false });
  };
  const tree = (x, z, y = 0.2) => {
    if (onAtGradeLane(x, z, 1.6)) return;                      // a soil bed would stand in the at-grade lane
    const v = rng() < 0.45 ? 4 + Math.floor(rng() * 2) : Math.floor(rng() * 4), rot = rng() * PI;
    solid(x, z, 0.65, 0.65, 'tree');
    const t = { x, y, z, v, rot, broken: false, im: null, i: 0, solid: ch.solids[ch.solids.length - 1] };
    t.solid.tree = t; ch.trees.push(t);
  };
  // Parked cars are registered as solids and linked to a destructible record (s.parked).
  // Light taps behave like a static obstacle; a hard enough hit wrecks one (see collisions.js breakParkedCar).
  const PARKED_KINDS = ['sedan', 'hatchback', 'suv', 'oldclassic'];
  const PARKED_COLORS = [0xe34a4a, 0x3a7bd5, 0x39b36b, 0xf2a93b, 0xeeeeee, 0x8e5bd9, 0x2f3340];
  const parkedCar = (x, z, hx, hz, rotY, kind, color, y = 0.1) => {
    const dims = CAR_DIMS[kind] || CAR_DIMS.civ;
    const m = buildCar(kind, color, false);
    m.position.set(x, y, z); m.rotation.y = rotY; group.add(m);
    solid(x, z, hx, hz, 'parkedcar');
    const sEntry = ch.solids[ch.solids.length - 1];
    sEntry.base = { hx, hz };                                     // so a car that leaves can hand its bay back
    const rec = { mesh: m, x, z, kind, mass: dims.mass, hp: dims.hp, len: dims.e1, wid: dims.e2, color, broken: false, wrecked: false, lastHit: -99, solid: sEntry };
    sEntry.parked = rec;
    return rec;
  };
  // Bus stop shelter on the sidewalk — a real solid (destructible), and a navigation target for AI buses (see civilians.js).
  const busStop = (side, alongLocal) => {
    const axisIsZ = side < 2;
    const roadCoord = side === 0 ? x0 : side === 1 ? x0 + CHUNK : side === 2 ? z0 : z0 + CHUNK;
    const curb = side === 0 ? x0 + 9.6 : side === 1 ? x0 + CHUNK - 9.6 : side === 2 ? z0 + 9.6 : z0 + CHUNK - 9.6;
    const x = axisIsZ ? curb : x0 + alongLocal, z = axisIsZ ? z0 + alongLocal : curb;
    if (onAtGradeLane(x, z, 1.2)) return;                      // the flyover's at-grade lane runs through there
    const rotY = side === 0 ? -PI / 2 : side === 1 ? PI / 2 : side === 2 ? PI : 0;
    const variant = BUS_LIVERIES[Math.floor(rng() * BUS_LIVERIES.length)];
    const g = own(ch, mergeStandalone(buildBusStopMesh(variant))); g.position.set(x, WALK_Y, z); g.rotation.y = rotY; group.add(g);
    const halfW = BUSSTOP_W / 2 + 0.3, halfD = BUSSTOP_D / 2 + 0.3;
    const hx = axisIsZ ? halfD : halfW, hz = axisIsZ ? halfW : halfD;
    solid(x, z, hx, hz, 'busstop');
    const sEntry = ch.solids[ch.solids.length - 1];
    const rec = { mesh: g, x, z, axis: axisIsZ ? 'z' : 'x', road: roadCoord, along: axisIsZ ? z : x, broken: false, solid: sEntry };
    sEntry.busstop = rec; ch.busStops.push(rec);
  };
  // Construction scaffolding against a building — a real destructible solid, randomized size/style per instance.
  const scaffold = (x, z, rotY, o) => {
    const g = own(ch, mergeStandalone(buildScaffoldMesh(o))); g.position.set(x, 0, z); g.rotation.y = rotY; group.add(g);
    const swap = Math.abs(Math.cos(rotY)) < 0.5;
    const hx = swap ? o.d / 2 + 0.3 : o.w / 2 + 0.3, hz = swap ? o.w / 2 + 0.3 : o.d / 2 + 0.3;
    solid(x, z, hx, hz, 'scaffold');
    const sEntry = ch.solids[ch.solids.length - 1];
    sEntry.scaffold = { mesh: g, x, z, broken: false, solid: sEntry };
  };
  const ramp = (x, z, tilt) => { const m = box(6.5, .7, 12, mat(0xae7438), x, .52, z, false); m.rotation.x = tilt; add(m); ch.ramps.push({ x, z, r: 6.5, last: -99 }); };
  // The block's own ground cover: the lot asphalt, the grass of a suburb or a park, a forecourt's concrete. Every
  // one of them stops at the building line, and on a side that carries an interchange's at-grade lane that line
  // stands `FLY.frontage` further out: without this the pad would lie over the pavement behind the lane (and, on
  // the wider lots, poke into the lane itself) — which is exactly the strip the lane's widening is not allowed to
  // eat. A pad that does not reach the line is left exactly where it was, so only the lane sides change.
  const padBox = (w, d, m, ox = 0, oz = 0, y = 0.2, h = 0.1) => {
    const lo = si => (si < 2 ? x0 : z0) + PAD_IN + (atGradeSide(cx, cz, si) ? FLY.frontage : 0);
    const hi = si => (si < 2 ? x0 : z0) + CHUNK - PAD_IN - (atGradeSide(cx, cz, si) ? FLY.frontage : 0);
    const a = Math.max(bx + ox - w / 2, lo(0)), b = Math.min(bx + ox + w / 2, hi(1));
    const c = Math.max(bz + oz - d / 2, lo(2)), e = Math.min(bz + oz + d / 2, hi(3));
    if (b - a < 0.2 || e - c < 0.2) return;
    ch.pads.push({ x: (a + b) / 2, z: (c + e) / 2, w: b - a, d: e - c });      // for the suite: where a block's ground stops
    add(box(b - a, h, e - c, m, (a + b) / 2, y, (c + e) / 2, false));
  };
  const ground = new THREE.Mesh(ASSET.groundGeo, ASSET.roadMat); ground.position.set(bx, 0, bz); ground.receiveShadow = true; group.add(ground);
  const snowCover = new THREE.Mesh(ASSET.groundGeo, ASSET.snowRoadMat); snowCover.position.set(bx, 0.025, bz); snowCover.renderOrder = 1; group.add(snowCover);
  // Traffic light set at this chunk's corner (every chunk corner = one 4-way intersection, built exactly once)
  buildIntersection(x0, z0, group, ch);
  // Junction plaza: the chunk that owns the corner (x0, z0) = (cx*CHUNK, cz*CHUNK) builds the plaza for the
  // junction at that corner, if plazaAt(cx, cz) says it should have one. The plaza is a circular island with a
  // curb and a central feature (fountain, statue, or tree grove) — it sits on top of the road texture, and
  // the whole junction reads as a small roundabout. Plazas are never at a flyover, never beside one, and never
  // under a ramp; the decision is deterministic, so the chunk and its audits agree.
  const p = plazaAt(cx, cz);
  if (p) {
    // The plaza island: a circular curb ring + grass inside. No solid here — cars can drive over it (the
    // curb is only 0.3 m tall, a speed-bump, and the user asked for the island to be drivable). It is still
    // a keepout so props and parked cars stay off it.
    const island = buildPlazaIsland(p.radius);
    island.position.set(x0, 0, z0);
    add(island);
    ch.keepouts.push({ x: x0, z: z0, hx: p.radius + 0.5, hz: p.radius + 0.5 });
    ch.plazas.push({ x: x0, z: z0, radius: p.radius, feature: p.feature });
    // The central feature is a destructible prop: a car that drives into it knocks it down, just like a
    // streetlight or a hydrant. The prop's collision radius matches its visual size, so cars clip it before
    // they reach the curb. The prop sits on the island's grass surface (y = 0.34).
    const featKind = ['plazaFountain', 'plazaStatue', 'plazaTree'][p.feature];
    prop(featKind, x0, z0, 0, 0.34);
  }
  // ---- Grade-separated interchanges ----
  // The city's two main roads carry flyovers every few junctions (js/flyover.js decides where): the road climbs
  // an embankment, crosses the junction it meets on a deck 7.2 m above the ground, and comes back down on the
  // far side, while the street it crosses keeps running at grade underneath it with its own signals. The blocks
  // around a junction each raise their own quarter — half the carriageway on their side of the centre line,
  // half the length on their side of the junction — so no block needs to know what its neighbours are doing. A
  // block can front two of them, hence the loop.
  const fly = ch.flyover = ch.flyover || { pieces: [] };
  for (const Q of flyoverQuadrants(cx, cz)) {
    const W = FLY.halfW, th = Math.atan2(FLY.deckH, RAMP_RUN);
    const sinT = Math.sin(th), cosT = Math.cos(th), slopeLen = Math.hypot(RAMP_RUN, FLY.deckH);
    const alongX = Q.axis === 'x';                                 // the road that flies runs along x here
    const midU = Q.su * (FLY.deckHalf + FLY.rampEnd) / 2, midH = FLY.deckH / 2;
    const conc = mat(0xb4b8bc), coping = mat(0xd3d0c8), asphalt = mat(0x3b3f4a), paint = mat(0xffcf2e), hazard = mat(0x1e2126);
    // Local (u out from the junction along the flying road, v across it from its centre line, both signed by the
    // quarter's own signs) to world coordinates.
    const at = (u, y, v) => alongX ? [Q.node + u, y, Q.road + v] : [Q.road + v, y, Q.node + u];
    // One piece of the structure: `w` across, `h` tall, `d` along, laid on the ramp when `tilt` is set. Every
    // piece is recorded as it is built, so the shape can be checked in the Node suite without a graphics device
    // (see run.mjs section 2c-3): the concrete and the contract in js/flyover.js have to stay in step.
    const P = (w, h, d, m, u, y, v, tilt, role) => {
      const p = at(u, y, v);
      const b = alongX ? box(d, h, w, m, p[0], y, p[2], false) : box(w, h, d, m, p[0], y, p[2], false);
      let rot = 0;
      if (tilt) { rot = alongX ? -Q.su * th : Q.su * th; if (alongX) b.rotation.z = rot; else b.rotation.x = rot; }
      add(b); fly.pieces.push({ role, axis: Q.axis, road: Q.road, node: Q.node, su: Q.su, sv: Q.sv, u, y, v, w, h, d, rot });
      return b;
    };
    // Points on the ramp, offset along the ramp's own normal (negative = sunk below the surface). Using the
    // normal is what keeps a sloped slab's *surface* exactly on the line js/flyover.js hands the cars.
    const WEAR = 0.08;
    const sunk = (d, u0 = midU, y0 = midH) => [u0 + Q.su * sinT * d, y0 + cosT * d];
    // The approach: an embankment slab sunk into the ground, so only its top (the ramp) and its retaining walls
    // show, with a wearing course laid on top of it.
    const SLAB_T = 8;                                              // ... deep enough that its underside stays buried
                                                                   // under a deck as tall as `FLY.deckH`
    let q = sunk(-(SLAB_T / 2 + WEAR)); P(W, SLAB_T, slopeLen, conc, q[0], q[1], Q.sv * W / 2, true, 'embankment');
    q = sunk(-WEAR / 2); P(W, WEAR, slopeLen, asphalt, q[0], q[1], Q.sv * W / 2, true, 'approach');
    // The deck over the crossing street: slab + wearing course, its parapets and copings on the outside edge.
    // This quarter builds the half between the junction's centre line and the end of the deck, so the two halves
    // meet exactly over the middle of the crossing street and there is no gap to fall through. There is no pier
    // in the middle either: the 24 m span sits on the two embankments, so the crossing street keeps its whole
    // carriageway clear underneath.
    const halfDeck = FLY.deckHalf;
    P(W, FLY.slab, halfDeck, conc, Q.su * halfDeck / 2, FLY.deckH - WEAR - FLY.slab / 2, Q.sv * W / 2, false, 'deck');
    P(W, WEAR, halfDeck, asphalt, Q.su * halfDeck / 2, FLY.deckH - WEAR / 2, Q.sv * W / 2, false, 'deck-wear');
    // The height of the parapet above the driving surface. The parapet stands on the surface (so its underside
    // is at 0 and its top at PH) and the coping caps it: its underside is at PH and its top at PH + 0.12. The
    // coping's inboard face is flush with the parapet's, so the lane keeps its whole 15.1 m of clear width and
    // nothing leans out over the road. On the ramp both ride the surface's own normal, which is what keeps the
    // top of the parapet a constant height above the asphalt all the way up.
    const PH = 1.0;
    const pV = Q.sv * (W - FLY.parapet / 2), cV = Q.sv * (W - FLY.parapet + 0.31);
    P(FLY.parapet, PH, halfDeck, conc, Q.su * halfDeck / 2, FLY.deckH + PH / 2, pV, false, 'parapet-deck');
    P(0.62, 0.12, halfDeck, coping, Q.su * halfDeck / 2, FLY.deckH + PH + 0.06, cV, false, 'coping-deck');
    q = sunk(PH / 2); P(FLY.parapet, PH, slopeLen, conc, q[0], q[1], pV, true, 'parapet-ramp');
    q = sunk(PH + 0.06); P(0.62, 0.12, slopeLen, coping, q[0], q[1], cV, true, 'coping-ramp');
    // The centre line: the same yellow dashes the road texture paints, carried up over the approach and across
    // the bridge, so the main road reads as one road that happens to be in the air for 114 m.
    for (const t of [1.5, 7.75]) P(0.39, 0.05, 3.4, paint, Q.su * t, FLY.deckH + 0.03, Q.sv * 0.195, false, 'dash');
    for (let t = FLY.deckHalf + 1.5; t < FLY.rampEnd - 1.5; t += 6.25) {
      P(0.39, 0.05, 3.4, paint, Q.su * t, rampHeight(t) + 0.03, Q.sv * 0.195, true, 'dash');
    }
    // Hazard boards across the abutment face — the face that looks back along the ramp — so a driver at grade
    // can read the closed lanes rather than a plain wall of concrete. The face leans (the embankment is a tilted
    // slab), so the boards sit just in front of where that face is at their own height.
    const lean = (FLY.deckH - 3.3) * sinT / cosT;
    for (let i = 0; i < 6; i++) P(W / 6, 0.9, 0.14, i % 2 ? paint : hazard, Q.su * (FLY.deckHalf - lean - 0.07), 3.3, Q.sv * (i + 0.5) * (W / 6), false, 'hazard');
    // Solids. Three things are solid here, and every one of them is only real below the height a car at grade
    // can reach, so a car up on the structure drives over them freely:
    //  - the embankment's body, in slices along the ramp. A slice tops out FLY.solidDrop below the ramp surface
    //    at its own downhill end: a car on the ramp rides above the slices under it, and the drop is more than
    //    the longest vehicle's half length times the ramp's slope, so even the buses clear every slice they
    //    straddle. The slices near the ramp's foot are lower than the road and stop nothing, which is right:
    //    the foot is where traffic climbs on.
    //  - the abutment's end face, which closes the flying road's own lanes at grade where the deck begins.
    const NS = FLY.slices, slice = RAMP_RUN / NS;
    for (let i = 0; i < NS; i++) {
      const u0 = FLY.deckHalf + i * slice, u1 = u0 + slice, cu = Q.su * (u0 + u1) / 2;
      const p = at(cu, 0, Q.sv * W / 2), top = rampHeight(u1) - FLY.solidDrop;
      ch.solids.push({ x: p[0], z: p[2], hx: alongX ? slice / 2 : W / 2, hz: alongX ? W / 2 : slice / 2, kind: 'flyover', maxY: top,
        box: { x: p[0], z: p[2], ux: 1, uz: 0, vx: 0, vz: 1, e1: alongX ? slice / 2 : W / 2, e2: alongX ? W / 2 : slice / 2 } });
    }
    //  - the retaining wall down each flank. It sits *inside* the structure's own edge, so the at-grade lane runs
    //    clear along its face: a car that is not going over the bridge has a lane of its own all the way.
    const side = at(Q.su * (FLY.deckHalf + RAMP_RUN / 2), 0, Q.sv * (W - 0.25));
    ch.solids.push({ x: side[0], z: side[2], hx: alongX ? RAMP_RUN / 2 + 0.5 : 0.2, hz: alongX ? 0.2 : RAMP_RUN / 2 + 0.5, kind: 'flyover', maxY: 2.0,
      box: { x: side[0], z: side[2], ux: 1, uz: 0, vx: 0, vz: 1, e1: alongX ? RAMP_RUN / 2 + 0.5 : 0.2, e2: alongX ? 0.2 : RAMP_RUN / 2 + 0.5 } });
    const ap = at(Q.su * (FLY.deckHalf - 0.5), 0, Q.sv * W / 2);
    ch.solids.push({ x: ap[0], z: ap[2], hx: alongX ? 0.5 : W / 2, hz: alongX ? W / 2 : 0.5, kind: 'flyover', maxY: 2.0,
      box: { x: ap[0], z: ap[2], ux: 1, uz: 0, vx: 0, vz: 1, e1: alongX ? 0.5 : W / 2, e2: alongX ? W / 2 : 0.5 } });
    // Nothing else is planted, parked or dropped inside the structure.
    const kp = at(Q.su * FLY.rampEnd / 2, 0, Q.sv * (W / 2 + 1.2));
    ch.keepouts.push(alongX ? { x: kp[0], z: kp[2], hx: FLY.rampEnd / 2 + 0.6, hz: W / 2 + 1.2 }
      : { x: kp[0], z: kp[2], hx: W / 2 + 1.2, hz: FLY.rampEnd / 2 + 0.6 });
    // Protect every exposed parapet nose, on both sides of both approaches. Keep the assembly on the
    // splitter line, behind the neighbouring crossing; the centre lanes and the at-grade lane remain open.
    const guardU = Q.su * (FLY.rampEnd + 1.4), guardV = Q.sv * (W - 0.70);
    const gp = at(guardU, 0, guardV), guard = buildFlyoverNoseGuard();
    guard.position.set(gp[0], 0, gp[2]);
    guard.rotation.y = alongX ? Q.su * PI / 2 : Q.su > 0 ? 0 : PI;
    add(guard);
    solid(gp[0], gp[2], 0.65, 0.65, 'flyover-guard', 1.15);
    const guardRecord = { axis: Q.axis, node: Q.node, su: Q.su, sv: Q.sv, x: gp[0], z: gp[2],
      u: guardU, v: guardV, radius: 0.68, heading: guard.rotation.y, posts: [] };
    (fly.guards = fly.guards || []).push(guardRecord);
    for (const dist of [3.0, 4.3, 5.6]) {
      const dp = at(Q.su * (FLY.rampEnd + dist), 0, guardV);
      const post = own(ch, mergeStandalone(buildFlyoverDelineator()));
      post.position.set(dp[0], 0, dp[2]); group.add(post);
      // Flexible delineators break on impact through the existing prop system, unlike the solid drum.
      ch.props.push({ mesh: post, x: dp[0], z: dp[2], r: 0.12, drag: 0.99,
        color: 0xff5824, kind: 'delineator', broken: false });
      guardRecord.posts.push({ x: dp[0], z: dp[2], u: Q.su * (FLY.rampEnd + dist) });
    }
    const protect = at(Q.su * (FLY.rampEnd + 3.2), 0, guardV);
    ch.keepouts.push({ x: protect[0], z: protect[2], hx: alongX ? 3.0 : 0.9, hz: alongX ? 0.9 : 3.0 });
    // A direction plate beside one approach, facing the traffic coming up to the junction. It stands on the
    // pavement behind the at-grade lane (`roadEdge()` + 1.3: it used to be planted 9.3 m off the centre line,
    // which was the old kerb line and is now inside the lane — a sign to hit rather than to read).
    if (Q.sv > 0) {
      const sp = at(Q.su * (FLY.rampEnd + 8), 0, roadEdge() + 1.3);
      const g = new THREE.Group(); g.position.set(sp[0], WALK_Y, sp[2]);
      g.rotation.y = alongX ? (Q.su > 0 ? PI / 2 : -PI / 2) : (Q.su > 0 ? 0 : PI);
      g.add(box(3.0, 0.95, 0.14, mat(0x1b4f9c), 0, 2.7, 0, false));
      const txt = textBlocks('OVERPASS', mat(0xf2e9d8), 0.42, 0.12, 0.3); txt.position.set(0, 2.7, 0.09); g.add(txt);
      for (const ox of [-1.1, 1.1]) g.add(box(0.14, 2.2, 0.14, mat(0x9aa1a8), ox, 1.1, 0, false));
      add(g);
      ch.keepouts.push({ x: sp[0], z: sp[2], hx: 1.9, hz: 1.9 });
      (fly.signs = fly.signs || []).push({ x: sp[0], z: sp[2] });   // for the suite: it stands on the pavement
    }
    // ---- the interchange's own signage: a plated name on the bridge, a billboard on the deck, a gantry over
    //      the approach. Each quarter builds its own share of all three (see the builders above); the numbers
    //      are recorded on the chunk so tools/sidewalk-checks/flyover-signs.mjs can check them without a
    //      graphics device.
    {
      // The nameboard hangs on the abutment face at the deck's mouth — the leaning concrete the hazard boards
      // are already screwed to — in the band between the hazard stripe (top 3.75 m) and the deck slab (7.2 m),
      // and it is read by the traffic on the road *at grade*: a car up on the ramp is above its own abutment's
      // face and cannot see it (the ramp hides it), so the plate is aimed at the driver coming up the street
      // towards the bridge — the one who has to choose the at-grade lane — and at the pavement. Its face
      // stands clear of the concrete at its own bottom edge (0.19 m at 3.85 m up) while the back of the board
      // is buried 0.59 m into the concrete at its top edge (5.35 m), because that face leans back as it rises:
      // that is what holds the plate onto the bridge, and it is why the board is 0.78 m deep.
      const u = Q.su * (FLY.deckHalf + 0.3), yM = 4.6, p = at(u, yM, Q.sv * W / 2);
      const plate = buildFlyoverNameboard();
      plate.position.set(p[0], yM, p[2]);
      plate.rotation.y = alongX ? (Q.su > 0 ? PI / 2 : -PI / 2) : (Q.su > 0 ? 0 : PI);
      add(plate);
      (fly.nameplates = fly.nameplates || []).push({
        axis: Q.axis, node: Q.node, su: Q.su, sv: Q.sv, x: p[0], z: p[2], y: yM, yaw: plate.rotation.y,
        u, v: Q.sv * W / 2, w: 5.75, h: 1.5, base: yM - 0.75, top: yM + 0.75, mount: 'abutment',
      });
    }
    // The billboard stands on the deck's coping over the carriageway that flies, facing out across the street
    // below: the structure signed to the city it crosses. One a bridge (built by the +u quarter), not one per
    // quarter, and it stands at the middle of the span — over the street the bridge crosses, which is the spot
    // it is read from, and well clear of the gantry's legs and beams at u = ±9.
    if (Q.su > 0) {
      const bbU = 0, mountY = FLY.deckH + PH + 0.12, p = at(bbU, mountY + 1.45, Q.sv * (W - FLY.parapet + 0.31));
      const bb = buildFlyoverBillboard();
      bb.position.set(p[0], p[1], p[2]);
      bb.rotation.y = alongX ? (Q.sv > 0 ? 0 : PI) : (Q.sv > 0 ? PI / 2 : -PI / 2);
      add(bb);
      (fly.billboards = fly.billboards || []).push({
        axis: Q.axis, node: Q.node, su: Q.su, sv: Q.sv, x: p[0], z: p[2], y: p[1], yaw: bb.rotation.y,
        u: 0, v: Q.sv * (W - FLY.parapet + 0.31), w: 5.9, h: 2.0,
        mountY, base: p[1] - 1.0, top: p[1] + 1.0, mount: 'coping',
      });
    }
    // The gantry stands over the bridge's own entry, a few metres in from the end of the deck: one leg on each
    // parapet's coping (the other half is the opposite block's, and the two meet over the middle of the road),
    // the beam reaching in over the carriageway and the sign over this quarter's own half of it, facing the
    // traffic that has just climbed the ramp. The panel hangs 0.04 m under the beam's underside — nothing
    // pokes through anything.
    {
      const legV = W - FLY.parapet / 2, dir = -1 / Q.sv, base = FLY.deckH + PH + 0.12;
      const p = at(Q.su * 9.0, base, Q.sv * legV);
      const gantry = buildFlyoverGantry(legV, dir);
      gantry.position.set(p[0], p[1], p[2]);
      gantry.rotation.y = alongX ? (Q.su > 0 ? PI / 2 : -PI / 2) : (Q.su > 0 ? 0 : PI);
      add(gantry);
      (fly.gantries = fly.gantries || []).push({
        axis: Q.axis, node: Q.node, su: Q.su, sv: Q.sv, x: p[0], z: p[2], y: p[1], yaw: gantry.rotation.y,
        u: Q.su * 9.0, base, legV, deck: FLY.deckH,
        beamUnder: p[1] + 4.46, signBottom: p[1] + 2.42, signTop: p[1] + 4.42,
        spans: [Q.sv * (W - FLY.parapet), Q.sv * (legV - 7.6)], mount: 'coping',
      });
    }
  }
  // Where a block's own buildings stand. On a side that carries an interchange's at-grade lane the building line
  // is `FLY.frontage` further out, and the pinned campuses (hospital, fire station, school, filling station) are
  // laid out by their own builders, which know nothing about lanes: a campus drawn from the block's geometric
  // centre would put its wall on the pavement behind the lane. The campus centre is the midpoint of the effective
  // building bounds — which shifts it toward the opposite side of the lane, keeping the whole campus (including
  // its widest wings) inside the building line on both sides. It is zero on every block that has no lane.
  const effLoX = x0 + PAD_IN + (atGradeSide(cx, cz, 0) ? FLY.frontage : 0);
  const effHiX = x0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 1) ? FLY.frontage : 0);
  const effLoZ = z0 + PAD_IN + (atGradeSide(cx, cz, 2) ? FLY.frontage : 0);
  const effHiZ = z0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 3) ? FLY.frontage : 0);
  const bxo = (effLoX + effHiX) / 2;
  const bzo = (effLoZ + effHiZ) / 2;
  const onLaneSide = bxo !== bx || bzo !== bz;
  // How far the kerb stands from the block edge (= the road's own centre line) on a side: the usual road edge,
  // or `roadEdge()` on a side that carries an interchange's at-grade street. Everything laid against a kerb —
  // parked cars, roadside trash, streetlights, hydrants, mailboxes — measures from this, so when the street
  // beside the structure widened they all moved out with the kerb instead of being left standing in the lane.
  const kerbIn = si => PAVE_IN + (atGradeSide(cx, cz, si) ? FLY.atGrade : 0);
  // The flyover opens the corners of this block where a junction beside it meets the street (`FLY.chamfer`): the
  // pavement is cut back on the diagonal there, so the corner is road now. Anything the block stands near a
  // corner — a light, a hydrant, a bin, a post-box, a hedge, a tree — has to stand behind that cut, and this is
  // the one question all of them ask before they are placed.
  const cutClear = (x, z, margin) => {
    for (const [jx, jz, sx, sz] of [
      [x0, z0, 1, 1], [x0, z0 + CHUNK, 1, -1], [x0 + CHUNK, z0, -1, 1], [x0 + CHUNK, z0 + CHUNK, -1, -1],
    ]) {
      if (!besideFlyover(jx / CHUNK, jz / CHUNK)) continue;
      const kx = kerbIn(sx > 0 ? 0 : 1), kz = kerbIn(sz > 0 ? 2 : 3);
      if ((x - jx) * sx + (z - jz) * sz < kx + kz + FLY.chamfer + margin) return false;
    }
    return true;
  };
  const t = rng();
  // Keep shopping centers near the fixed spawn so the new district is visible immediately.
  const nearSpawn = (cx === 0 && cz === 0) || (cx === 1 && cz === 0);
  // A block beside an at-grade lane gets no campus: the school's 34 m classroom wing and the fire station's
  // hose tower are too wide to fit in the narrower effective bounds, and shifting them to fit would put
  // them in the road. Downtown, suburb and park blocks handle the lane fine (their grids respect the bounds).
  const laneBlock = onLaneSide;
  // One hospital is pinned beside the spawn block (front-left of the start) so it is easy to find; the rest of
  // the city grows a few more at random, never on the two guaranteed shopping centres.
  const type = nearSpawn ? 'commercial'
    : (cx === -1 && cz === 0) ? 'hospital'
    : (cx === 0 && cz === -1) ? 'fire'                          // the block the player starts beside
    : (cx === -1 && cz === -1) ? 'fuel'                         // the filling station across from the fire hall
    : (cx === 1 && cz === -1) ? 'downtown'                     // the north-east corner beside the start: brick walk-ups (high street, shopfronts on the walk)
    : (cx === 0 && cz === 1) ? 'school'                        // a school one block up the street the player starts on
    : laneBlock ? (t < 0.5 ? 'downtown' : t < 0.85 ? 'suburb' : 'park')   // no campus on a lane block
    : t < 0.38 ? 'downtown' : t < 0.64 ? 'suburb' : t < 0.78 ? 'park' : t < 0.85 ? 'commercial'
    : t < 0.872 ? 'fire' : t < 0.894 ? 'fuel' : t < 0.921 ? 'shops' : t < 0.945 ? 'hospital'
    : t < 0.975 ? 'school' : 'industrial';
  // ---- sidewalk for this block: style from the district, plus randomly painted kerbs ----
  const swStyle = pickSidewalkStyle(type, rng);
  const sw = sidewalkPieces(cx, cz, swStyle);
  const swPainted = swStyle === 'verge' ? rng() < 0.55 : rng() < 0.2;
  if (type === 'downtown') {
    // The building grid moves out with the frontage line, so a downtown block beside a flyover keeps its whole
    // pavement: a high-street shopfront projects up to 2.5 m from its wall (awning, outdoor display, its base),
    // and without the offset that projection would stand in the at-grade lane. Effective bounds shrink the grid
    // on lane sides so buildings never encroach on the carriageway — on either side of the block.
    const loX = x0 + PAD_IN + (atGradeSide(cx, cz, 0) ? FLY.frontage : 0);
    const hiX = x0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 1) ? FLY.frontage : 0);
    const loZ = z0 + PAD_IN + (atGradeSide(cx, cz, 2) ? FLY.frontage : 0);
    const hiZ = z0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 3) ? FLY.frontage : 0);
    const walkUps = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      // Place buildings within effective bounds: centre each cell of the 2x2 grid, then clamp so the
      // building's half-extent (up to 12.5 m) stays inside [lo, hi].
      const cellW = (hiX - loX) / 2, cellD = (hiZ - loZ) / 2;
      const lx = loX + cellW * (i + 0.5), lz = loZ + cellD * (j + 0.5);
      if (rng() < 0.12) { // plaza
        add(box(24, 0.1, 24, mat(0xd9d2c3), lx, 0.2, lz, false));
        tree(lx - 8, lz - 8, 0.25); tree(lx + 8, lz + 8, 0.25); if (rng() < 0.6) tree(lx + 8, lz - 8, 0.25);
        continue;
      }
      const w = r(16, 25), d = r(16, 25), h = 14 + Math.pow(rng(), 1.6) * 48;
      // Clamp building centre so the whole footprint stays within effective bounds
      const clx = Math.max(loX + w / 2, Math.min(hiX - w / 2, lx));
      const clz = Math.max(loZ + d / 2, Math.min(hiZ - d / 2, lz));
      let hasShops = false;
      // A mid-rise under ~32 m is a walk-up in brick (brownstone / shop-house); the taller blocks keep the glass.
      const walkUp = h <= 32 && rng() < 0.85;
      const geo = makeBuildingGeo(w, h, d);
      const wm = walkUp ? facadeMat(WALKUP_WALLS[Math.floor(rng() * WALKUP_WALLS.length)])
                        : ASSET.windowMats[Math.floor(rng() * ASSET.windowMats.length)];
      const mesh = new THREE.Mesh(geo, [wm, wm, ASSET.roofMat, ASSET.roofMat, wm, wm]);
      mesh.position.set(clx, h / 2 + 0.15, clz); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); ch.geos.push(geo);
      solid(clx, clz, w / 2, d / 2, 'building');
      // Ground-floor shops on the face that looks at the street: a downtown block becomes a high street.
      const ox = clx - bx, oz = clz - bz;
      const alongX = Math.abs(ox) >= Math.abs(oz);
      const faceAxis = alongX ? Math.sign(ox || 1) : Math.sign(oz || 1);
      const faceLen = alongX ? d : w;
      const faceAt = alongX ? clx + faceAxis * (w / 2) : clz + faceAxis * (d / 2);
      const radial = alongX ? (faceAxis > 0 ? bx0 + CHUNK - faceAt : faceAt - bx0)
                            : (faceAxis > 0 ? bz0 + CHUNK - faceAt : faceAt - bz0);
      const clear = radial - PAVE_OUT;                                  // room between the wall and the paving
      const nFace = Math.max(1, Math.min(3, Math.floor(faceLen / 9)));
      const rotY = alongX ? (faceAxis > 0 ? PI / 2 : -PI / 2) : (faceAxis > 0 ? 0 : PI);
      const shopWide = Math.min(8.6, (faceLen - 0.8) / nFace);
      for (let si = 0; si < nFace; si++) {
        const shop = SHOP_TYPES[Math.floor(rng() * SHOP_TYPES.length)];
        const off = (si + 0.5 - nFace / 2) * (faceLen / nFace);
        const sx = alongX ? faceAt + faceAxis * 0.05 : clx + off;
        const sz = alongX ? clz + off : faceAt + faceAxis * 0.05;
        const kit = buildShopFrontMesh(shop, shopWide, 3.6, rng, { awning: clear > 2.0, outdoor: clear > 1.9 });
        const body = kit.body; body.position.set(sx, 0.15, sz); body.rotation.y = rotY; add(body);
        const gm = own(ch, mergeStandalone(kit.glass));
        gm.position.set(sx, 0.15, sz); gm.rotation.y = rotY; group.add(gm);
        const hx = alongX ? 0.24 : shopWide / 2 - 0.2, hz = alongX ? shopWide / 2 - 0.2 : 0.24;
        solid(sx, sz, hx, hz, 'shopfront');
        const sEntry = ch.solids[ch.solids.length - 1];
        sEntry.shop = { mesh: gm, x: sx, z: sz, w: shopWide, name: shop.name, kind: shop.kind, broken: false, solid: sEntry, downtown: true };
        ch.shops.push(sEntry.shop);
      }
      hasShops = true;
      if (walkUp) walkUps.push({ clx, clz, w, d, h, alongX, faceAxis });
      // rooftop details
      if (walkUp) {
        // a cornice round the parapet, then a wooden water tower on four legs or a brick chimney stack
        add(box(w + 0.7, 0.8, d + 0.7, mat(rng() < 0.6 ? 0xe8dfcc : 0x4a4f57), clx, h + 0.55, clz));
        if (rng() < 0.5) {
          const tx = clx + r(-w * 0.2, w * 0.2), tz = clz + r(-d * 0.2, d * 0.2);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cyl(0.1, 0.1, 3, 5, mat(IRON), tx + sx * 0.9, h + 0.15 + 1.5, tz + sz * 0.9));
          add(cyl(1.4, 1.4, 2.4, 10, mat(0x8a6a4a), tx, h + 0.15 + 3 + 1.2, tz));
          const cap = new THREE.Mesh(ASSET.roofGeo, mat(0x4a3a2c)); cap.scale.set(2.2, 1.1, 2.2);
          cap.position.set(tx, h + 0.15 + 3 + 2.4 + 0.55, tz); add(cap);
        } else {
          add(box(0.9, 2.4, 0.9, mat(0x7a4a3a), clx + r(-w * 0.3, w * 0.3), h + 0.15 + 1.2, clz + r(-d * 0.3, d * 0.3)));
        }
      } else if (h > 30) { add(box(w * 0.5, 5, d * 0.5, wm === ASSET.windowMats[0] ? mat(0xcfd4da) : mat(0xd9cbbd), clx, h + 2.65, clz)); add(cyl(0.12, 0.12, 7, 6, mat(0xdd3b3b), clx, h + 8.6, clz)); }
      else add(box(3.5, 1.8, 3.5, mat(0xaab0b8), clx + r(-4, 4), h + 1.05, clz + r(-4, 4)));
      // Occasional construction scaffolding against a tall building — 4 distinct styles, randomized size, with
      // reflective warning cones placed along the sidewalk line in front of it.
      if (h > 20 && rng() < 0.3 && !hasShops) {          // a shopfront already owns the pavement face
        const sideS = Math.floor(rng() * 4), faceLen = (sideS === 0 || sideS === 1) ? d : w;
        const sw = Math.max(4, Math.min(15, faceLen * r(0.5, 0.85)));
        const sh = Math.max(6, Math.min(h - 1.5, h * r(0.55, 0.92)));
        const sd = r(1.5, 2.2), bays = Math.max(2, Math.round(sw / r(1.8, 2.4))), levels = Math.max(3, Math.min(6, Math.round(sh / 2.6)));
        const style = Math.floor(rng() * 4);
        const o = { w: sw, d: sd, h: sh, bays, levels, style, frame: FRAME_COLORS[Math.floor(rng() * FRAME_COLORS.length)], net: NET_COLORS[Math.floor(rng() * NET_COLORS.length)], plank: PLANK_COLORS[Math.floor(rng() * PLANK_COLORS.length)], sign: SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)] };
        const dx = sideS === 0 ? w / 2 + sd / 2 + 0.6 : sideS === 1 ? -(w / 2 + sd / 2 + 0.6) : 0;
        const dz = sideS === 2 ? d / 2 + sd / 2 + 0.6 : sideS === 3 ? -(d / 2 + sd / 2 + 0.6) : 0;
        const rotS = (sideS === 0 || sideS === 1) ? PI / 2 : 0;
        const sx = clx + dx, sz = clz + dz;
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
    // Iron fire escapes on the walk-ups: one landing per floor on a side wall (never the shopfront face). Each one
    // stays inside the block's building line and clear of every other solid, so it can never reach a road.
    for (const u of walkUps) {
      if (rng() < 0.3) continue;
      const s = rng() < 0.5 ? -1 : 1, along = rng() < 0.5 ? -1 : 1, p = 1.0, tw = 2.2;
      const sideZ = u.alongX;                                   // the shop is on an x face, so this wall is a z face
      const face = sideZ ? u.clz + s * u.d / 2 : u.clx + s * u.w / 2;
      const span = sideZ ? u.w : u.d;
      const cen = (sideZ ? u.clx : u.clz) + along * (span / 2 - 1.6);      // tangent coordinate of the escape
      const nLo = Math.min(face, face + s * (p + 0.1)), nHi = Math.max(face, face + s * (p + 0.1));
      const tLo = cen - tw / 2 - 0.1, tHi = cen + tw / 2 + 0.1;
      const ex = sideZ ? [tLo, tHi] : [nLo, nHi], ez = sideZ ? [nLo, nHi] : [tLo, tHi];
      if (ex[0] < loX || ex[1] > hiX || ez[0] < loZ || ez[1] > hiZ) continue;
      const clash = ch.solids.some(q => !(q.x === u.clx && q.z === u.clz && q.kind === 'building') &&
        ex[1] > q.x - q.hx - 0.6 && ex[0] < q.x + q.hx + 0.6 && ez[1] > q.z - q.hz - 0.6 && ez[0] < q.z + q.hz + 0.6);
      if (clash) continue;
      const iron = mat(IRON), floors = Math.floor((u.h - 1) / 3.5);
      // a piece: `nC` is its coordinate across the wall, `tC` along it; `nSize` its depth out from the wall
      const piece = (nC, tC, hgt, yC, nSize, tSize) => add(sideZ
        ? box(tSize, hgt, nSize, iron, tC, yC, nC, false) : box(nSize, hgt, tSize, iron, nC, yC, tC, false));
      for (let f = 1; f < floors; f++) {
        const y = 0.15 + f * 3.5;
        piece(face + s * p / 2, cen, 0.12, y + 0.06, p, tw);                          // landing
        piece(face + s * (p - 0.05), cen, 0.05, y + 0.52, 0.08, tw);                  // top rail
        piece(face + s * (p - 0.05), cen, 0.05, y + 0.25, 0.08, tw);                  // mid rail
      }
      // two rails of the ladder that climbs the wall at one end of the landings
      const top = 0.15 + floors * 3.5;
      for (const k of [-1, 1]) piece(face + s * p * 0.6, cen + k * (tw / 2 - 0.08), top - 0.15, (top + 0.15) / 2, 0.12, 0.1);
    }
  } else if (type === 'suburb') {
    // Effective block bounds: on at-grade sides the building line steps back by FLY.frontage,
    // so the valid building area shrinks. The padBox and house grid must fit within these bounds.
    const lo_x = x0 + PAD_IN + (atGradeSide(cx, cz, 0) ? FLY.frontage : 0);
    const hi_x = x0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 1) ? FLY.frontage : 0);
    const lo_z = z0 + PAD_IN + (atGradeSide(cx, cz, 2) ? FLY.frontage : 0);
    const hi_z = z0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 3) ? FLY.frontage : 0);
    const padW = hi_x - lo_x, padD = hi_z - lo_z;
    const padOx = (lo_x + hi_x) / 2 - bx, padOz = (lo_z + hi_z) / 2 - bz;
    padBox(padW, padD, mat(0x7bc96f), padOx, padOz);
    const roofs = [0xc0503a, 0x8a4b38, 0x4f6d8a, 0x6b5b95, 0x9b5d3a], walls = [0xf2e4c9, 0xf7d7d0, 0xd5e8d4, 0xcfe0f0, 0xfdf0b8];
    // The house grid fits within the effective block bounds. On at-grade sides the grid shifts
    // and shrinks so no house wall or jitter lands in the carriageway.
    const houseSpanX = Math.max(0, padW - 18.66), houseSpanZ = Math.max(0, padD - 18.66);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const lx = lo_x + 9.33 + (houseSpanX > 0 ? i * houseSpanX / 2 : 0);
      const lz = lo_z + 9.33 + (houseSpanZ > 0 ? j * houseSpanZ / 2 : 0);
      const w = r(8, 10), d = r(7, 9), h = r(4.5, 6), ox = r(-1, 1), oz = r(-1, 1), hx = lx + ox, hz = lz + oz;
      // Skip houses that would extend into the at-grade lane (with jitter and half-extent margin)
      if (hx - w/2 < lo_x || hx + w/2 > hi_x || hz - d/2 < lo_z || hz + d/2 > hi_z) continue;
      const wc = walls[Math.floor(rng() * walls.length)], rc = roofs[Math.floor(rng() * roofs.length)];
      // some houses are brick (a brownstone-style front) with a stone stoop up to the door
      const brick = rng() < 0.45, brickC = HOUSE_BRICK[Math.floor(rng() * HOUSE_BRICK.length)];
      if (brick) {
        const bg = makeBuildingGeo(w, h, d, 6), bm = new THREE.Mesh(bg, facadeMat(brickC, false));
        bm.position.set(hx, h / 2 + 0.25, hz); add(bm); ch.geos.push(bg);
        if (hz + d / 2 + 1.5 <= hi_z) {
          const stone = mat(0xcfc8bb);
          for (let k = 0; k < 3; k++) { const sh = 0.6 - 0.2 * k; add(box(2.4, sh, 0.42, stone, hx, 0.25 + sh / 2, hz + d / 2 + 0.21 + 0.42 * k)); }
        }
      } else add(box(w, h, d, mat(wc), hx, h / 2 + 0.25, hz));
      const roof = new THREE.Mesh(ASSET.roofGeo, mat(rc)); roof.scale.set(w * 1.15, 3.2, d * 1.15); roof.position.set(hx, h + 0.25 + 1.6, hz); roof.castShadow = true; add(roof);
      add(box(1.2, 2.1, 0.12, mat(0x5a3a22), hx, 1.3, hz + d / 2 + 0.05, false));
      for (const sx of [-1, 1]) { add(box(1.5, 1.4, 0.1, mat(0x4f7fb5), hx + sx * w * 0.28, h * 0.58, hz + d / 2 + 0.04, false)); add(box(1.5, 1.4, 0.1, mat(0x4f7fb5), hx + sx * w * 0.28, h * 0.58, hz - d / 2 - 0.04, false)); }
      add(box(1.1, 2.2, 1.1, mat(0x8a5a44), hx + w * 0.3, h + 1.3, hz - d * 0.2));
      solid(hx, hz, w / 2, d / 2, 'building');
      const cs = rng() < 0.5 ? 1 : -1, cs2 = rng() < 0.5 ? 1 : -1;
      tree(lx + cs * 7.6, lz + cs2 * 7.6);
      if (rng() < 0.4) tree(lx - cs * 7.6, lz + cs2 * 7.6);
    }
    for (const side of [-1, 1]) for (let x = -padW/2 + 1; x <= padW/2; x += 4.2) if (rng() > 0.25) prop('fence', bx + x + padOx, bz + side * (padD/2 - 0.4) + padOz, 0, 0.2);
  } else if (type === 'park') {
    // Effective block bounds for park: same logic as suburb, shrink on at-grade sides
    const lo_x = x0 + PAD_IN + (atGradeSide(cx, cz, 0) ? FLY.frontage : 0);
    const hi_x = x0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 1) ? FLY.frontage : 0);
    const lo_z = z0 + PAD_IN + (atGradeSide(cx, cz, 2) ? FLY.frontage : 0);
    const hi_z = z0 + CHUNK - PAD_IN - (atGradeSide(cx, cz, 3) ? FLY.frontage : 0);
    const padW = hi_x - lo_x, padD = hi_z - lo_z;
    const padOx = (lo_x + hi_x) / 2 - bx, padOz = (lo_z + hi_z) / 2 - bz;
    padBox(padW, padD, mat(0x78c46c), padOx, padOz);
    // Paths along the centerlines of the effective bounds
    padBox(padW, 3.4, mat(0xe3d6b0), padOx, padOz, 0.27, 0.04);
    padBox(3.4, padD, mat(0xe3d6b0), padOx, padOz, 0.27, 0.04);
    // Pond positioned within the valid bounds
    const pw = r(10, 15), pd = r(8, 11);
    const px = (lo_x + hi_x) / 2 + (rng() < 0.5 ? -1 : 1) * r(5, Math.min(14, padW/2 - pw/2 - 2));
    const pz = (lo_z + hi_z) / 2 + (rng() < 0.5 ? -1 : 1) * r(5, Math.min(16, padD/2 - pd/2 - 2));
    add(box(pw, 0.06, pd, mat(0x58b6e8), px, 0.27, pz, false));
    ch.keepouts.push({ x: px, z: pz, hx: pw / 2, hz: pd / 2 });
    const placed = [];
    for (let a = 0, n = 0; a < 70 && n < 16; a++) {
      const x = (lo_x + hi_x) / 2 + r(-padW/2 + 2, padW/2 - 2);
      const z = (lo_z + hi_z) / 2 + r(-padD/2 + 2, padD/2 - 2);
      // Keep trees away from the center path and pond
      if (Math.abs(x - (lo_x + hi_x) / 2) < 2.5 || Math.abs(z - (lo_z + hi_z) / 2) < 2.5) continue;
      if (Math.abs(x - px) < pw / 2 + 2 && Math.abs(z - pz) < pd / 2 + 2) continue;
      if (placed.some(p => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 49)) continue;
      placed.push([x, z]); tree(x, z); n++;
    }
    // Benches along the paths, within valid bounds
    const cx_p = (lo_x + hi_x) / 2, cz_p = (lo_z + hi_z) / 2;
    prop('bench', cx_p - 8, cz_p - 2.5, 0, 0.3);
    prop('bench', cx_p + 9, cz_p + 2.5, PI, 0.3);
    prop('bench', cx_p - 2.5, cz_p + 10, PI / 2, 0.3);
    // Flowers scattered within the valid area
    for (let i = 0; i < 10; i++) add(box(0.4, 0.3, 0.4, mat([0xff6fa5, 0xffd23b, 0xffffff, 0xb07cff][i % 4]), cx_p + r(-padW/2 + 2, padW/2 - 2), 0.4, cz_p + r(-padD/2 + 2, padD/2 - 2), false));
  } else if (type === 'commercial') {
    // The whole mall ensemble — the building, its wing, the lot's painted rows and the bays — stands on the
    // block's own building line, so on a side that carries a flyover's at-grade lane it steps back with it.
    const mbx = bxo, mbz = bzo;
    // A neighborhood shopping center with a glass landmark, retail wing and marked parking rows.
    const lotSurfaceY = 0.25;
    const asphalt = mat(0x4b5058), concrete = mat(0xc6c9c8), parkingPaint = mat(0xe9e8df);
    const aqua = mat(0x19b9ca), mallWhite = mat(0xe5e8e9), mallYellow = mat(0xf4c928);
    padBox(58, 58, asphalt, bxo - bx, bzo - bz);
    // Raised pedestrian walkways frame the lot and connect the entrance to the parking area.
    const walkY = lotSurfaceY + 0.07;
    padBox(58, 1.5, concrete, bxo - bx, -28.25 + (bzo - bz), walkY, 0.12);
    padBox(58, 1.5, concrete, bxo - bx, 28.25 + (bzo - bz), walkY, 0.12);
    padBox(1.5, 58, concrete, -28.25 + (bxo - bx), bzo - bz, walkY, 0.12);
    padBox(1.5, 58, concrete, 28.25 + (bxo - bx), bzo - bz, walkY, 0.12);

    const mallZ = mbz - 7, baseW = 29, baseD = 22, baseH = 4.8;
    const frontZ = mallZ + baseD / 2;
    add(box(baseW, baseH, baseD, mallWhite, mbx, lotSurfaceY + baseH / 2, mallZ));
    // Bright retail frontage, broad glass storefront and a projecting entrance canopy.
    add(box(baseW + 0.12, 0.85, 0.22, aqua, mbx, lotSurfaceY + 0.95, frontZ + 0.12, false));
    add(box(17, 2, 0.14, mat(0x263e4a), mbx, 3.3, frontZ + 0.14, false));
    add(box(4.2, 2.8, 0.18, mat(0x172a35), mbx, 1.65, frontZ + 0.2, false));
    add(box(14, 0.38, 2.8, aqua, mbx, lotSurfaceY + baseH + 0.18, frontZ + 1.15, false));
    for (const side of [-1, 1]) add(box(0.5, 4.75, 0.5, mat(0xdce1e2), mbx + side * 6.2, lotSurfaceY + baseH / 2, frontZ + 2.05, false));

    // Upper glazed floors, pale roof cap and the yellow crown visible in the reference.
    const towerW = 21.5, towerD = 17.5, towerH = 14.2;
    const towerGeo = makeBuildingGeo(towerW, towerH, towerD), glassMat = ASSET.windowMats[2];
    const tower = new THREE.Mesh(towerGeo, [glassMat, glassMat, ASSET.roofMat, ASSET.roofMat, glassMat, glassMat]);
    tower.position.set(mbx, lotSurfaceY + baseH + towerH / 2, mallZ);
    tower.castShadow = true; tower.receiveShadow = true; group.add(tower); ch.geos.push(towerGeo);
    for (let floor = 1; floor < 4; floor++) {
      add(box(towerW + 0.22, 0.18, towerD + 0.22, mat(0xb9c2c7), mbx, lotSurfaceY + baseH + floor * 3.45, mallZ, false));
    }
    const towerTop = lotSurfaceY + baseH + towerH;
    add(box(towerW + 1.1, 0.45, towerD + 1.1, mat(0xf1f2ee), mbx, towerTop + 0.225, mallZ, false));
    add(box(towerW + 1.25, 0.24, 0.28, mallYellow, mbx, towerTop + 0.36, mallZ + towerD / 2 + 0.62, false));
    add(box(0.28, 0.24, towerD + 1.25, mallYellow, mbx + towerW / 2 + 0.62, towerTop + 0.36, mallZ, false));
    add(box(3.4, 1.1, 2.6, mat(0x969da1), mbx - 4, towerTop + 0.95, mallZ - 1, false));
    add(box(2.2, 0.8, 2.1, mat(0xaeb4b7), mbx + 5, towerTop + 0.8, mallZ + 2, false));
    solid(mbx, mallZ, baseW / 2, baseD / 2, 'building');

    // Low supermarket wing to one side gives the center a stepped, multi-building silhouette.
    const wingW = 10.5, wingD = 20.5, wingH = 4.1, wingX = mbx + 19.5, wingZ = mallZ + 0.3;
    const wingFrontZ = wingZ + wingD / 2;
    add(box(wingW, wingH, wingD, mat(0xd8dcdd), wingX, lotSurfaceY + wingH / 2, wingZ));
    add(box(wingW + 0.4, 0.34, wingD + 0.4, mat(0xf3f2ed), wingX, lotSurfaceY + wingH + 0.17, wingZ, false));
    add(box(wingW + 0.1, 0.68, 0.2, aqua, wingX, 1.05, wingFrontZ + 0.11, false));
    add(box(7.5, 1.8, 0.14, mat(0x243d49), wingX, 2.35, wingFrontZ + 0.13, false));
    add(box(wingW + 0.2, 0.24, 0.18, mallYellow, wingX, 3.65, wingFrontZ + 0.12, false));
    solid(wingX, wingZ, wingW / 2, wingD / 2, 'building');

    // Pedestrian approaches and small planted islands at the front corners.
    add(box(36, 0.08, 3.2, concrete, mbx, lotSurfaceY + 0.06, mbz + 7.8, false));
    add(box(34, 0.08, 2, concrete, mbx, lotSurfaceY + 0.06, mbz - 20, false));
    for (const side of [-1, 1]) {
      const px = mbx + side * 25, pz = mbz + 8.5;
      add(box(3.8, 0.1, 3.8, mat(0x79b86d), px, lotSurfaceY + 0.05, pz, false));
      tree(px, pz, lotSurfaceY);
    }

    // Painted bays on three sides; cars use the same destructible parked-car system as curbside vehicles.
    const stallCount = 6, stallW = 8.8, startX = mbx - stallCount * stallW / 2;
    const parkingRows = [
      { z: mbz + 15.2, rotY: PI },
      { z: mbz + 24.2, rotY: 0 },
      { z: mbz - 24.3, rotY: 0 },
    ];
    const parkedColors = PARKED_COLORS, parkedKinds = PARKED_KINDS;
    // ---- Occupancy ----
    // Occupancy follows the shared day/night rule (see lotCars): a 2-3 car floor at night, the middle of the
    // day the busiest, never more than 20% of the lot. At night the cars that stay are the ones nearest the
    // entrance, so the rows empty out naturally instead of clearing from one end.
    const totalStalls = parkingRows.length * stallCount + 3;      // 18 painted bays + 3 along the west side
    const occupancy = lotCars(totalStalls, 0, env.phase);
    const freeStalls = [];
    for (let row = 0; row < parkingRows.length; row++) for (let i = 0; i < stallCount; i++) freeStalls.push({ row, i });
    const westStalls = [0, 1, 2].map(i => ({ row: -1, i }));
    // At night (occupancy 2) the cars left in the lot are the ones parked nearest the entrance.
    if (occupancy <= 4) freeStalls.sort((a, b) => Math.abs(b.i - (stallCount - 1) / 2) - Math.abs(a.i - (stallCount - 1) / 2));
    const taken = new Set();
    const occupied = new Set();
    for (let n = 0; n < occupancy; n++) {
      const pool = freeStalls.length ? freeStalls : westStalls;
      if (!pool.length) break;
      taken.add(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    for (let row = 0; row < parkingRows.length; row++) {
      const { z, rotY } = parkingRows[row];
      for (let i = 0; i <= stallCount; i++) {
        add(box(0.12, 0.035, 6.2, parkingPaint, startX + i * stallW, lotSurfaceY + 0.0275, z, false));
      }
      // Stalls left empty at generation time stay on record, so traffic.js can fill the lot at night.
      for (let i = 0; i < stallCount; i++) {
        if (occupied.has(row + ':' + i)) continue;
        ch.parking.push({ x: startX + (i + 0.5) * stallW, z, rotY, y: lotSurfaceY - 0.05, hx: 1.15, hz: 2.35 });
      }
    }
    for (const { row, i } of taken) occupied.add(row + ':' + i);
    ch.parkingTotal = totalStalls;                            // lot size, for tooling and tests
    for (const { row, i } of taken) {
      if (row < 0) continue;
      const x = startX + (i + 0.5) * stallW, z = parkingRows[row].z, rotY = parkingRows[row].rotY;
      const kind = parkedKinds[Math.floor(rng() * parkedKinds.length)];
      const color = parkedColors[Math.floor(rng() * parkedColors.length)];
      const car = parkedCar(x, z, 1.15, 2.35, rotY, kind, color, lotSurfaceY - 0.05);
      ch.lotStanding.push({ car, slot: { x, z, rotY, y: lotSurfaceY - 0.05, hx: 1.15, hz: 2.35 } });
    }
    // Extra perpendicular bays along the open west side of the mall.
    const sideParkingX = mbx - 23.5, sideStartZ = mbz - 16;
    for (let i = 0; i <= 3; i++) {
      add(box(5.8, 0.035, 0.12, parkingPaint, sideParkingX, lotSurfaceY + 0.0275, sideStartZ + i * 8, false));
    }
    for (const { row, i } of taken) {
      if (row >= 0) continue;
      const z = sideStartZ + (i + 0.5) * 8;
      const kind = parkedKinds[Math.floor(rng() * parkedKinds.length)];
      const color = parkedColors[Math.floor(rng() * parkedColors.length)];
      const car = parkedCar(sideParkingX, z, 2.35, 1.15, PI / 2, kind, color, lotSurfaceY - 0.05);
      ch.lotStanding.push({ car, slot: { x: sideParkingX, z, rotY: PI / 2, y: lotSurfaceY - 0.05, hx: 2.35, hz: 1.15 } });
    }
  } else if (type === 'hospital') {
    // A hospital campus with its own car park. The ambulance bays are occupied for good, the ordinary bays
    // follow the day/night curve exactly like the mall lots do.
    const lotSurfaceY = 0.25;
    padBox(54, 58, mat(0x4b5058), bxo - bx, bzo - bz);
    const H = buildHospitalMesh(bxo, bzo, rng);
    H.group.position.set(bxo, 0, bzo);
    bake(ch, H.group);                       // merged with the rest of the block, in slices
    // Rotors merge on their own so each one can turn about its own mast. The builder works in block-local
    // coordinates, so the chunk-level rotor meshes have to be lifted to world space by the block origin.
    const bladesMain = mergeStandalone(H.heliMain);
    bladesMain.position.set(bxo + H.heliMast[0], H.heliMast[1], bzo + H.heliMast[2]); group.add(bladesMain);
    const bladesTail = mergeStandalone(H.heliTail);
    bladesTail.position.set(bxo + H.heliTailPos[0], H.heliTailPos[1], bzo + H.heliTailPos[2]); group.add(bladesTail);
    for (const m of [...bladesMain.children, ...bladesTail.children]) ch.geos.push(m.geometry);   // freed with the chunk
    ch.heli = { rotor: bladesMain, tail: bladesTail, beacons: H.heliBeacons, padR: H.padR, rotorR: H.rotorR, padX: bxo + H.padX, padZ: bzo + H.padZ, padY: H.padY, x: bxo + H.heliPos[0], y: H.heliPos[1], z: bzo + H.heliPos[2],
      volumes: H.volumes.map(v => ({ ...v, x: bxo + v.x, z: bzo + v.z })) };
    for (const sv of H.solids) solid(sv.x, sv.z, sv.hx, sv.hz, 'building');
    for (const pt of H.paint) add(box(pt.w, 0.035, pt.d, pt.m, pt.x, lotSurfaceY + 0.028, pt.z, false));
    const ambulanceSlots = [];
    for (const b of H.bays) {
      const slot = { kind: 'ambulance', color: 0xffffff, x: b.x, z: b.z, rotY: b.rotY, y: lotSurfaceY - 0.05, hx: b.hx, hz: b.hz, apron: !!b.apron, car: null };
      if (b.ambulance) ambulanceSlots.push(slot);
      else ch.parking.push(slot);                                 // ordinary bays, filled by the day/night curve
    }
    // Two ambulances are standing in the lot from the first frame (the apron unit and one of the marked
    // bays). The third marked bay is the night unit: traffic.js keeps the lot at its time-of-day target of
    // two by day and three at night. Wrecked units are never replaced — their burnt hulk is left in place.
    ch.ambulanceSlots = ambulanceSlots;
    let ambulances = 0;
    for (const slot of ambulanceSlots) {
      if (ambulances >= 2) break;
      parkedCar(slot.x, slot.z, slot.hx, slot.hz, slot.rotY, 'ambulance', 0xffffff, slot.y);
      slot.car = ch.solids[ch.solids.length - 1].parked;
      slot.car.fade = 1;                                          // on scene from the start, no fade-in
      ambulances++;
    }
    ch.parkingTotal = H.bays.length;
    ch.parkingFixed = ambulanceSlots.length;                      // cap space reserved for all three units
    ch.parkingFloor = 3;                                          // a few ordinary cars, day and night, so the lot never looks abandoned
    const present = lotCars(ch.parkingTotal, ambulances, env.phase, ch.parkingFloor);
    for (let i = 0; i < present && ch.parking.length; i++) {
      const b = ch.parking.splice(Math.floor(rng() * ch.parking.length), 1)[0];
      const car = parkedCar(b.x, b.z, b.hx, b.hz, b.rotY, PARKED_KINDS[Math.floor(rng() * PARKED_KINDS.length)], PARKED_COLORS[Math.floor(rng() * PARKED_COLORS.length)], b.y);
      ch.lotStanding.push({ car, slot: b });
    }
    // Low planting and benches along the car-park edge.
    for (const sx of [-1, 1]) { tree(bxo + sx * 21, bzo + 24.5, lotSurfaceY + 0.02); prop('bench', bxo + sx * 8, bzo + 24, PI, lotSurfaceY + 0.15); }
  } else if (type === 'fire') {
    // Fire station with its appliance apron. The fleet stands on the apron from the first frame and is
    // never replaced: a run that wrecks an appliance leaves the burnt hulk in its bay.
    const lotSurfaceY = 0.25;
    padBox(50, 46, mat(0x5a6068), bxo - bx, bzo - bz);
    const F = buildFireStationMesh(bxo, bzo, rng);
    F.group.position.set(bxo, 0, bzo);
    bake(ch, F.group);
    for (const sv of F.solids) solid(sv.x, sv.z, sv.hx, sv.hz, 'building');
    ch.fireSlots = F.bays;
    ch.fireDoors = F.doors;
    ch.fireTotal = F.bays.length;
    for (const b of F.bays) {
      parkedCar(b.x, b.z, b.hx, b.hz, b.rotY, b.kind, b.color, b.y);
      b.car = ch.solids[ch.solids.length - 1].parked;
      b.car.fade = 1;                                            // on station from the first frame
    }
    for (const sx of [-1, 1]) tree(bxo + sx * 22, bzo + 20.5, lotSurfaceY + 0.02);
    prop('bench', bxo - 6, bzo + 19.5, 0, lotSurfaceY + 0.15);
  } else if (type === 'school') {
    // A school on its own block: classroom wing and gym at the back, a fenced grass yard with a playground and
    // a basketball court in the middle, and a lot out front where the yellow school buses stand along the kerb.
    const lotSurfaceY = 0.25;
    padBox(56, 28, mat(0x4b5058), bxo - bx, 13.7 + (bzo - bz));    // the bus and staff lot
    padBox(56, 20, mat(0x7bc96f), bxo - bx, -10 + (bzo - bz));     // the fenced yard: grass
    const S = buildSchoolMesh(bxo, bzo, rng);
    S.group.position.set(bxo, 0, bzo);
    bake(ch, S.group);
    // The schoolyard fence is handed over panel by panel: every panel is its own solid, so a hit takes down the
    // panel it lands on and leaves the rest of the line standing, and every panel is a stand-alone mesh that can
    // leave the block and tumble off on its own (breakFence() in js/collisions.js). Nothing of it is baked into
    // the block — a baked panel could never be torn off.
    for (const fr of S.fenceRuns) for (const pc of fr.pieces) {
      const pm = own(ch, mergeStandalone(pc.group));
      pm.position.set(pc.x, 0, pc.z);
      group.add(pm);
      pc.mesh = pm;
      pc.broken = false;
      solid(pc.x, pc.z, pc.hx, pc.hz, 'fence');
      const sEntry = ch.solids[ch.solids.length - 1];
      sEntry.fence = true;                                            // the yard fence, for the checks and for the map
      sEntry.fencePiece = pc;
      pc.solid = sEntry;
      ch.fencePanels.push(pc);
    }
    for (const sv of S.solids) solid(sv.x, sv.z, sv.hx, sv.hz, sv.kind);
    for (const pt of S.paint) add(box(pt.w, 0.035, pt.d, pt.m, pt.x, lotSurfaceY + 0.028, pt.z, false));
    ch.schoolYard = S.yard;
    ch.schoolPlayground = S.playground;
    ch.schoolFence = S.fence;
    ch.schoolPaint = S.paint;                      // bay markings and court lines, for the map and the checks
    const busSlots = [];
    for (const b of S.bays) {
      const slot = { kind: b.bus ? 'schoolbus' : null, color: 0xf7b500, x: b.x, z: b.z, rotY: b.rotY, y: lotSurfaceY - 0.05, hx: b.hx, hz: b.hz, bus: !!b.bus, car: null };
      if (b.bus) busSlots.push(slot); else ch.parking.push(slot);
    }
    // The bus stand is occupied from the first frame and never refilled once wrecked: a run that wrecks a bus
    // leaves the burnt hulk in its bay, exactly like the hospital's ambulances and the fire fleet.
    ch.busSlots = busSlots;
    for (const slot of busSlots) {
      parkedCar(slot.x, slot.z, slot.hx, slot.hz, slot.rotY, 'schoolbus', 0xf7b500, slot.y);
      slot.car = ch.solids[ch.solids.length - 1].parked;
      slot.car.fade = 1;
    }
    ch.parkingTotal = S.bays.length;
    ch.parkingFixed = busSlots.length;                     // room reserved for the buses, counted in the ceiling
    ch.parkingFloor = 2;                                   // a couple of staff cars, day and night
    const present = lotCars(ch.parkingTotal, busSlots.length, env.phase, ch.parkingFloor);
    for (let i = 0; i < present && ch.parking.length; i++) {
      const b = ch.parking.splice(Math.floor(rng() * ch.parking.length), 1)[0];
      const car = parkedCar(b.x, b.z, b.hx, b.hz, b.rotY, PARKED_KINDS[Math.floor(rng() * PARKED_KINDS.length)], PARKED_COLORS[Math.floor(rng() * PARKED_COLORS.length)], b.y);
      ch.lotStanding.push({ car, slot: b });
    }
    for (const sx of [-1, 1]) tree(bxo + sx * 25.5, bzo + 26.5, lotSurfaceY + 0.02);
    prop('bench', bxo + 4, bzo + 1.6, PI, lotSurfaceY + 0.15);
    prop('bench', bxo - 12, bzo + 1.6, PI, lotSurfaceY + 0.15);
  } else if (type === 'fuel') {
    // A filling station: lit canopy, two pump islands, convenience store and a price pylon on the kerb.
    // The four dispensers are registered one by one as their own destructible solids (ch.pumps), so a hit
    // knocks a pump off its island and the spill burns.
    const fuelY = 0.25;
    padBox(52, 48, mat(0x60666d), bxo - bx, bzo - bz);                      // forecourt pad
    padBox(50, 46, mat(0x74797f), bxo - bx, bzo - bz, 0.27, 0.04);          // lighter topping
    const FS = buildFuelStationMesh(bxo, bzo, rng);
    FS.group.position.set(bxo, 0, bzo);
    bake(ch, FS.group);
    for (const sv of FS.solids) solid(sv.x, sv.z, sv.hx, sv.hz, sv.kind);
    for (const p of FS.pumps) {
      const pm = own(ch, mergeStandalone(p.group));
      pm.position.set(bxo + p.x, p.y, bzo + p.z); pm.rotation.y = p.rotY; group.add(pm);
      const x = bxo + p.x, z = bzo + p.z;
      solid(x, z, 0.6, 0.52, 'pump');                       // the body, hoses and nozzles included
      const sEntry = ch.solids[ch.solids.length - 1];
      sEntry.pump = { mesh: pm, x, z, broken: false, solid: sEntry };
      ch.pumps.push(sEntry.pump);
    }
    ch.fuelBrand = FS.brand.name; ch.fuelCanopy = FS.canopy;
    // Bays: two cars can fuel at each island, four park along the side of the store, four more nose in off
    // the street. The day/night curve keeps two of them busy at every hour (ch.parkingFloor).
    const bays = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      bays.push({ x: bxo + sx * 7.8, z: bzo + FS.canopy.z + sz * 3.4, rotY: 0, y: fuelY - 0.05, hx: 1.25, hz: 2.45 });
    for (const sx of [-1, 1]) for (const dz of [-2.5, 2.5])
      bays.push({ x: bxo + sx * 14.2, z: bzo + FS.store.z + dz, rotY: 0, y: fuelY - 0.05, hx: 1.25, hz: 2.45 });
    for (const dx of [-18, -12, -6, 0, 6, 12, 18])
      bays.push({ x: bxo + dx, z: bzo + 21, rotY: PI / 2, y: fuelY - 0.05, hx: 2.45, hz: 1.25 });
    ch.parkingTotal = bays.length;
    ch.parkingFloor = 2;
    const present = lotCars(bays.length, 0, env.phase, ch.parkingFloor);
    for (let i = 0; i < bays.length; i++) {
      const b = bays[i];
      if (i < present) {                                                      // busy at generation time too
        const kind = PARKED_KINDS[Math.floor(rng() * PARKED_KINDS.length)];
        const car = parkedCar(b.x, b.z, b.hx, b.hz, b.rotY, kind, PARKED_COLORS[Math.floor(rng() * PARKED_COLORS.length)], b.y);
        ch.lotStanding.push({ car, slot: b });
      } else ch.parking.push(b);                                              // kept free for later arrivals
    }
    for (const sx of [-1, 1]) prop('trashcan', bxo + sx * 9.8, bzo + 15.6);
  } else if (type === 'shops') {
    // The parades stand on the block's own building line, so on a side that carries a flyover's at-grade lane the
    // whole shopping street steps back with it (a parade's awning projects ~2.5 m from the wall behind it).
    const sbx = bxo, sbz = bzo;
    // A shopping street: two parades of shops facing each other across a parking court, with a little green
    // square in the middle. Each parade carries five different businesses, so a drive down the block passes
    // ten shopfronts with their own names, colours, awnings and window displays.
    const lotY = 0.25;
    const asphalt = mat(0x4b5058), concrete = mat(0xc9ccca), grass = mat(0x5aa04a), parkingPaint = mat(0xe9e8df);
    padBox(54, 54, asphalt, bxo - bx, bzo - bz);                                         // the court
    for (const sx of [-1, 1]) add(box(3.6, 0.14, 54, concrete, sbx + sx * 18, lotY, sbz, false));   // aprons in front of the shops
    padBox(54, 3.6, concrete, bxo - bx, -18 + (bzo - bz), lotY, 0.14);
    padBox(54, 3.6, concrete, bxo - bx, 18 + (bzo - bz), lotY, 0.14);
    const title = PARADE_TITLES[Math.floor(rng() * PARADE_TITLES.length)];
    const faces = [sbx - 18, sbx + 18];                                                   // west and east parade fronts
    const ordered = SHOP_TYPES.slice().sort(() => rng() - 0.5);                          // shuffled once per block
    for (let side = 0; side < 2; side++) {
      const shops = ordered.slice(side * nShop, side * nShop + nShop);
      const rotY = side === 0 ? PI / 2 : -PI / 2;                                       // fronts face the court
      const P = buildShopParadeMesh(shops, rng, { title, shopW, h: 4.4, depth: 8.5, wall: side ? 0xd2cfc6 : 0xc9c6bd });
      P.group.position.set(faces[side], lotY, sbz); P.group.rotation.y = rotY;
      bake(ch, P.group);                          // the parade merges with the block, not in a pass of its own
      // The parade is built with its front at local +z, so after the rotation a shop sitting at local x
      // lands at sbz - x on the west side and sbz + x on the east side. The mesh and its collision box must
      // use that same mapping or the windows would never break where they look like they are.
      solid(faces[side] + (side === 0 ? -4.8 : 4.8), sbz, 3.7, P.len / 2 + 4.3, 'building');
      for (const gl of P.glasses) {
        const x = faces[side], z = side === 0 ? sbz - gl.x : sbz + gl.x;   // matches the mesh's own rotation
        solid(x, z, 0.24, gl.w / 2, 'shopfront');
        const sEntry = ch.solids[ch.solids.length - 1];
        const gm = own(ch, mergeStandalone(gl.group));
        gm.position.set(x, lotY, z); gm.rotation.y = rotY; group.add(gm);
        sEntry.shop = { mesh: gm, x, z, w: gl.w, name: gl.name, kind: gl.kind, broken: false, solid: sEntry };
        ch.shops.push(sEntry.shop);
      }
      ch.parades.push({ x: faces[side], z: sbz, rotY, title, shops: P.shops.map(o => o.name), len: P.len });
    }
    // the court: eighteen perpendicular bays in two rows, plus the green square with market stalls
    const bays = [];
    for (const sx of [-1, 1]) for (let i = 0; i < 9; i++)
      bays.push({ x: sbx + sx * 12.5, z: sbz - 20 + i * 5, rotY: PI / 2, y: lotY - 0.05, hx: 2.45, hz: 1.25 });
    add(box(9.4, 0.16, 9.4, grass, sbx, lotY + 0.02, sbz, false));                        // the little square
    add(box(9.8, 0.26, 9.8, mat(0x9aa0a6), sbx, lotY, sbz, false));
    add(box(9.4, 0.14, 9.4, grass, sbx, lotY + 0.1, sbz, false));
    tree(sbx - 3.1, sbz - 3.1, lotY); tree(sbx + 3.1, sbz + 3.1, lotY); tree(sbx + 3.1, sbz - 3.1, lotY); tree(sbx - 3.1, sbz + 3.1, lotY);
    for (const [kx, kz] of [[sbx - 6.6, sbz], [sbx + 6.6, sbz]]) {                          // two market stalls
      add(box(3.4, 0.9, 2.2, mat(0x9a7a52), kx, lotY + 0.45, kz));
      add(box(4.0, 1.5, 2.6, mat(0xd8452f), kx, lotY + 1.6, kz, false));
      add(box(4.2, 0.2, 2.8, mat(0xf2e9d8), kx, lotY + 2.35, kz, false));
      add(box(3.0, 0.1, 1.8, mat(0xf4f1e6), kx, lotY + 0.95, kz, false));
    }
    prop('bench', sbx - 4.4, sbz + 5.2, PI); prop('bench', sbx + 4.4, sbz - 5.2, 0);
    prop('trashcan', sbx + 5.4, sbz + 3.2); prop('trashcan', sbx - 5.4, sbz - 3.2);
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) prop('streetlight', sbx + sx * 14.5, sbz - 16 + i * 10.5);
    ch.parkingTotal = bays.length;
    ch.parkingFloor = 2;
    const present = lotCars(bays.length, 0, env.phase, ch.parkingFloor);
    for (let i = 0; i < bays.length; i++) {
      const b = bays[i];
      if (i < present) {
        const kind = PARKED_KINDS[Math.floor(rng() * PARKED_KINDS.length)];
        const car = parkedCar(b.x, b.z, b.hx, b.hz, b.rotY, kind, PARKED_COLORS[Math.floor(rng() * PARKED_COLORS.length)], b.y);
        ch.lotStanding.push({ car, slot: b });
      } else ch.parking.push(b);
    }
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++)
      add(box(4.6, 0.03, 0.14, parkingPaint, sbx + sx * 12.5, lotY + 0.03, sbz - 20 + i * 5 - 2.5, false));
  } else { // industrial
    padBox(56, 56, mat(0x9b9da4), bxo - bx, bzo - bz);
    const wc = [0x6c8ebf, 0xb8b2a7, 0xc98a5e, 0x7fa38a];
    for (let i = 0; i < 2; i++) {
      const x = bx0 + 15 + i * 27 + (bxo - bx), z = bz0 + 17 + (bzo - bz), h = r(8, 13), col = wc[Math.floor(rng() * wc.length)];
      add(box(26, h, 30, mat(col), x, h / 2 + 0.25, z)); add(box(26.6, 0.8, 30.6, mat(0x5a5f68), x, h + 0.65, z));
      for (let k = -1; k <= 1; k++) add(box(6, 4.2, 0.2, mat(0x30343b), x + k * 8, 2.35, z + 15.1, false));
      add(cyl(0.6, 0.6, 3, 8, mat(0x888d96), x + r(-8, 8), h + 2.4, z + r(-8, 8)));
      solid(x, z, 13, 15, 'building');
    }
    const cc = [0xd9534f, 0x3b82c4, 0xf2b134, 0x4caf50, 0xe8e8e8];
    for (let row = 0; row < 2; row++) for (let c = 0; c < 3; c++) {
      if (rng() < 0.2) continue;
      const x = bx0 + 9 + c * 19 + r(-2, 2) + (bxo - bx), z = bz0 + (row ? 52 : 39.5) + (bzo - bz);
      add(box(12, 2.6, 2.5, mat(cc[Math.floor(rng() * cc.length)]), x, 1.55, z));
      if (rng() < 0.4) add(box(12, 2.6, 2.5, mat(cc[Math.floor(rng() * cc.length)]), x + r(-1, 1), 4.15, z));
      solid(x, z, 6, 1.25, 'container');
    }
    for (let i = 0; i < 6; i++) prop('barrel', bx0 + r(6, 50) + (bxo - bx), bz0 + r(34.5, 37.5) + (i % 2) * 8.5 + (bzo - bz), 0, 0.2);
    if (rng() < .72) ramp(bx + (rng() < .5 ? -4 : 4), bz + r(-20, 20), rng() < .5 ? .13 : -.13);
  }
  // Streetlights
  for (const s of [-1, 1]) for (const o of [-16, 16]) {
    const kx = kerbIn(s < 0 ? 0 : 1), kz = kerbIn(s < 0 ? 2 : 3);      // the kerb on the side the prop is on
    // ... and none of them where a flyover has opened the corner: a light left there would stand in the mouth
    // the cut made rather than on the pavement the cut leaves.
    const lampA = [bx + s * (CHUNK / 2 - kx - 1.35), bz + o], lampB = [bx + o, bz + s * (CHUNK / 2 - kz - 1.35)];
    if (rng() < 0.8) {
      if (cutClear(lampA[0], lampA[1], 1.2)) prop('streetlight', lampA[0], lampA[1], 0);
      if (cutClear(lampB[0], lampB[1], 1.2)) prop('streetlight', lampB[0], lampB[1], 0);
    }
    if (rng() < 0.45 && cutClear(bx + s * (CHUNK / 2 - kx - 1.15), bz - o * 0.45, 1.0)) prop('hydrant', bx + s * (CHUNK / 2 - kx - 1.15), bz - o * 0.45, 0, 0.15);
    if (rng() < 0.45 && cutClear(bx - o * 0.45, bz + s * (CHUNK / 2 - kz - 1.15), 1.0)) prop('hydrant', bx - o * 0.45, bz + s * (CHUNK / 2 - kz - 1.15), 0, 0.15);
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
      // No kerbside parking on a side that carries an interchange's at-grade street either: that street is the
      // through route past the structure (and under the deck), so a car left standing at its kerb would be a
      // car left standing in the way — the same reason no tree pit is planted there.
      if (atGradeSide(cx, cz, side)) continue;
      const along = r(14, 66), alongX = side >= 2;
      if (busReserved.some(b => b.side === side && Math.abs(b.along - along) < 11)) continue;
      const x = side === 0 ? x0 + kerbIn(0) - 1.35 : side === 1 ? x0 + CHUNK - kerbIn(1) + 1.35 : x0 + along;   // parallel-parked along the kerb
      const z = side === 2 ? z0 + kerbIn(2) - 1.35 : side === 3 ? z0 + CHUNK - kerbIn(3) + 1.35 : z0 + along;
      // ... nor inside the interchange, nor anywhere in its at-grade street: `insideFootprint` only knows the
      // keepouts of the blocks already built, and a car parked on the crossing street beside the structure can
      // land in the lane while the block that holds the flyover's own keepout is not built yet. The lane test is
      // pure geometry, so it cannot be missed that way.
      if (insideFootprint(x, z, 2.2) || onAtGradeLane(x, z, 2.2)) continue;
      const rotY = alongX ? (rng() < 0.5 ? PI / 2 : -PI / 2) : (rng() < 0.5 ? 0 : PI);
      const kind = parkKinds[Math.floor(rng() * parkKinds.length)];
      parkedCar(x, z, alongX ? 2.1 : 1.0, alongX ? 1.0 : 2.1, rotY, kind, carCols[Math.floor(rng() * carCols.length)]);
    }
    // Roadside trash — sometimes a single can/bag, sometimes a messy cluster of cans+bags+cartons
    for (const side of [0, 1, 2, 3]) {
      if (rng() > 0.45) continue;
      const along = r(14, 66);
      const cx = side === 0 ? x0 + kerbIn(0) + 2.4 : side === 1 ? x0 + CHUNK - kerbIn(1) - 2.4 : x0 + along;
      const cz = side === 2 ? z0 + kerbIn(2) + 2.4 : side === 3 ? z0 + CHUNK - kerbIn(3) - 2.4 : z0 + along;
      if (!cutClear(cx, cz, 1.0)) continue;                      // never in the mouth a cut corner opened
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
      // The interchange's embankment stands in the avenue's inner lanes where it passes over the junction, and a
      // roadworks site laid inside it would bury its slabs and cones in the concrete: find a free lane instead.
      const midX = vert ? fixed : alongBase + start + len / 2, midZ = vert ? alongBase + start + len / 2 : fixed;
      if (!insideFootprint(midX, midZ, 4)) {
      // The resurfaced lane. This used to be one clean rectangle in warm greys and browns, 5 cm thick and 9 cm
      // proud of the asphalt: in daylight that read as a beige sheet lying on the road, with the lane markings
      // cut off at its edge and nothing to say what it was. A repair is now laid the way a real one is — a few
      // dark tarmac slabs end to end, with seams, a little sideways jitter and the ends marked by a cone taper —
      // and it sits flush (2 cm proud, 4 cm thick) so it reads as a lane that was milled and re-laid.
      const tarmac = [0x2f323a, 0x33363d, 0x2b2e35, 0x373a42];
      const slabCount = 3 + Math.floor(rng() * 3), slabLen = (len + 2) / slabCount;
      const site = { x: vert ? fixed : alongBase + start + len / 2, z: vert ? alongBase + start + len / 2 : fixed, vert, len, style, slabs: [] };
      for (let i = 0; i < slabCount; i++) {
        const seg = r(0.88, 1.04);                                  // each slab its own length: seams where they meet
        const along = start + len / 2 + (i + 0.5 - slabCount / 2) * slabLen + r(-0.45, 0.45);
        const lat = r(-0.3, 0.3);
        const [sxa, sza] = at(along);
        const w = 3.2, d = slabLen * seg, col = tarmac[Math.floor(rng() * tarmac.length)];
        const px = vert ? sxa + lat : sxa, pz = vert ? sza : sza + lat;
        add(box(vert ? w : d, 0.04, vert ? d : w, mat(col), px, 0.021, pz, false));
        site.slabs.push({ x: px, z: pz, w: vert ? w : d, d: vert ? d : w, h: 0.04, y: 0.021, col });
      }
      ch.roadworks.push(site);
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
        for (let d = -1.6; d <= len + 1.6; d += r(3.4, 4.4)) { const [px, pz] = at(start + d); prop('cone', px, pz, rng() * PI, 0); }
      }
      }
    }
    // Pickups (cash lines, repair kits, nitro canisters)
    const nLines = rng() < 0.55 ? 1 : 0, extra = rng() < 0.2 ? 1 : 0;
    for (let n = 0; n < nLines + extra; n++) {
      const vert = rng() < 0.5, lane = (rng() < 0.5 ? -1 : 1) * 4, start = r(20, 45);
      const kr = rng();
      if (kr < 0.3) {
        const px = vert ? x0 + lane : x0 + start, pz = vert ? z0 + start : z0 + lane;
        if (!insideFootprint(px, pz, 1.5)) addPickup(ch, kr < 0.12 ? 'repair' : 'nitro', px, pz);
        continue;
      }
      for (let i = 0; i < 5; i++) {
        const px = vert ? x0 + lane : x0 + start + i * 4, pz = vert ? z0 + start + i * 4 : z0 + lane;
        if (!insideFootprint(px, pz, 1.5)) addPickup(ch, 'cash', px, pz);            // never inside the embankment
      }
    }
  }
  const occupied = (x, z, rad) => ch.solids.some(o => o.hx > 0 && Math.abs(x - o.x) < o.hx + rad && Math.abs(z - o.z) < o.hz + rad)
    || ch.keepouts.some(k => Math.abs(x - k.x) < k.hx + rad && Math.abs(z - k.z) < k.hz + rad)
    || ch.props.some(pr => Math.hypot(x - pr.x, z - pr.z) < pr.r + rad);
  // ---- Street furniture on the walkway: mailboxes, parking meters and shop A-boards ----
  if (type === 'downtown' || type === 'commercial') {
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const swi = Math.floor(rng() * 4), s = SIDEWALK_SIDES[swi];
      const along = (s.along === 'z' ? cz : cx) * CHUNK + 16 + rng() * (CHUNK - 32);
      const d = kerbIn(swi) + (rng() < 0.55 ? 1.15 : 2.1);      // just behind the kerb of its own side
      const x = s.along === 'z' ? bx + s.fixed * (CHUNK / 2 - d) : along;
      const z = s.along === 'z' ? along : bz + s.fixed * (CHUNK / 2 - d);
      if (occupied(x, z, 1.1) || !cutClear(x, z, 1.0)) continue;
      const kind = rng() < 0.36 ? 'mailbox' : rng() < 0.62 ? 'meter' : 'sandwich';
      prop(kind, x, z, Math.atan2(s.along === 'z' ? s.fixed : 0, s.along === 'z' ? 0 : s.fixed), 0);
    }
  }
  // ---- Suburban front hedges, set back in the yards along the walk ----
  if (type === 'suburb') {
    for (let si = 0; si < SIDEWALK_SIDES.length; si++) {
      const s = SIDEWALK_SIDES[si];
      if (rng() > 0.6) continue;
      const d = PAVE_OUT + (atGradeSide(cx, cz, si) ? FLY.frontage : 0) + 0.35;   // in the yard strip, behind the walk
      const edge0 = (s.along === 'z' ? cz : cx) * CHUNK;
      // The hedge line starts where the pavement itself resumes at each end, so a hedge never stands in the
      // mouth a cut corner opened either.
      const ends = s.along === 'z' ? [[cx, cz - 1], [cx, cz + 1]] : [[cx - 1, cz], [cx + 1, cz]];
      const keep = ends.map(([ix, iz]) => { const t = stripStops(ix, iz, cx, cz, si); return t.stop + t.cut; });
      for (let a = edge0 + keep[0] + 6; a < edge0 + CHUNK - keep[1] - 6; a += 3.4) {
        if (rng() < 0.28) continue;                              // gaps read as driveways and gateways
        const x = s.along === 'z' ? bx + s.fixed * (CHUNK / 2 - d) : a;
        const z = s.along === 'z' ? a : bz + s.fixed * (CHUNK / 2 - d);
        if (occupied(x, z, 1.5)) continue;
        prop('hedge', x, z, s.along === 'z' ? PI / 2 : 0, 0.25);
      }
    }
  }
  // ---- Street trees ----
  // Verge blocks grow them in the grass strip; the paved styles plant them in kerb-edged soil beds.
  // A side that carries an interchange's at-grade lane gets no tree line at all: the lane took the outer strip of
  // that pavement, and a soil bed (which is what the pit is) would stand in the middle of the lane.
  if (type !== 'industrial') {
    const inVerge = sw.st.verge > 0;
    const offset = CHUNK / 2 - (inVerge ? PAVE_IN + 0.5 + sw.st.verge / 2 : PIT_IN);
    const step = inVerge ? 12.5 : 15.5;
    for (let si = 0; si < SIDEWALK_SIDES.length; si++) {
      const s = SIDEWALK_SIDES[si];
      if (atGradeSide(cx, cz, si)) continue;
      const edge = (s.along === 'z' ? cz : cx) * CHUNK;
      // Clear of both junctions, and clear again of the corner cuts a flyover opens at either end: the trees move
      // back with the pavement, so no tree pit is left standing in a mouth that is road now.
      const ends = s.along === 'z' ? [[cx, cz - 1], [cx, cz + 1]] : [[cx - 1, cz], [cx + 1, cz]];
      const keep = ends.map(([ix, iz]) => { const t = stripStops(ix, iz, cx, cz, si); return t.stop + t.cut; });
      const first = edge + keep[0] + 6, last = edge + CHUNK - keep[1] - 6;
      for (let a = first + r(-2, 2); a < last; a += step) {
        const x = s.along === 'z' ? bx + s.fixed * offset : a;
        const z = s.along === 'z' ? a : bz + s.fixed * offset;
        if (occupied(x, z, 1.6)) continue;   // never inside a building, the pond or a parked car
        // tree() refuses to plant one in the interchange's at-grade lane; the pit has to go with it, or a kerb-edged
        // soil bed would be left lying in the lane with no tree in it
        if (onAtGradeLane(x, z, 1.6)) continue;
        if (!inVerge) treePit(sw, s, offset, a);   // pits are only needed where the ground is paved
        tree(x, z, inVerge ? WALK_Y + 0.03 : WALK_Y + 0.02);
      }
    }
  }
  // ---- Sidewalk surfaces: kerb stone, paving, border course, inner kerb, planting beds ----
  bakeRing(sw.curb, swPainted ? ASSET.curbPaintMat : ASSET.curbTopMat, CURB_TILE, true, ch);
  bakeRing(sw.walk, ASSET[sw.st.mat], sw.st.tile, true, ch);
  bakeRing(sw.grass, ASSET.grassMat, 3, false, ch);
  bakeRing(sw.border, ASSET.borderMat, BORDER_TILE, false, ch);
  bakeRing(sw.kerb, ASSET.curbMat, 2, true, ch);
  bakeRing(sw.bed, ASSET.soilMat, 2, false, ch);
  bakeRing(sw.bedEdge, ASSET.curbMat, 2, true, ch);
  buildTreeInstances(ch);
  // ---- The crossings a flyover's lane needs ----
  // The road texture marks every junction the same way: a row of stripes across each arm, standing 53 texels out
  // from the junction's edge, and a yellow centre line whose dashes start 70 texels out. Both were measured for a
  // street whose kerb stands `PAVE_IN` from its centre line, and that is exactly as far as the texture's stripes
  // march — 48 texels, 7.5 m. Beside a flyover the street gains its at-grade lane (the kerb steps out by
  // `FLY.atGrade`) and the pavement corners are cut on the diagonal, so at those junctions the paint has to be
  // carried on, and where the wide carriageway has swallowed it, taken back off again, all of it in the texture's
  // own sizes, so a driver meets here the same crossing he meets anywhere else in the city:
  //   * a row is laid off the kerb across the street it crosses, and stands a step further out where that corner
  //     is cut. It reaches out along the street it crosses to that street's own kerb — the block's own kerb, not
  //     the kerb facing it across the junction, which at the mouth of a lane has not stepped out — in the
  //     texture's own stripe, size and step, so the row reads as one crossing and not a stub of stripes adrift in
  //     the middle of the carriageway;
  //   * the row the texture painted for the un-widened street — the one that now stands inside the lane — is
  //     covered first with a coat of the road's own asphalt, out to the row that moved with the kerb;
  //   * the narrow road's yellow centre line, swallowed by the lane the same way, is covered with it, out to the
  //     crossing, so the line stops at the junction's edge as it does at every other junction in the city. The
  //     coat runs on to the end of any dash it lands in, so the first dash left showing is a whole one.
  const paint = mat(0xe9e8df), tar = ROAD_COAT;
  const TX = CHUNK / 512;                                     // the road tile is 512 texels across one block
  const STRIPE = 6 * TX, STEP = 10 * TX, DEEP = 8 * TX;       // a stripe: 6 texels along the row, 8 across it, every 10
  const FIRST = 2 * TX + STRIPE / 2, TEX_END = 48 * TX;       // the centre of the texture's first stripe, and of its last
  const TEX_LINE = 53 * TX + DEEP / 2;                        // the line the texture stands its rows on
  const GAP = TEX_LINE - PAVE_IN;                             // how far a row clears the kerb it belongs to
  const DASH0 = 70 * TX, DASH_W = 2.5 * TX, DASH_LEN = 22 * TX, DASH_PITCH = 40 * TX;   // the line: first dash, its width, its length, its pitch
  const DASH1 = DASH0 + DASH_LEN;                             // ... and where that first dash ends
  const DASH_LAST = 452 * TX;                                 // the texture's dashes end 452 texels from the tile's far edge
  const COVER_OUT = 8.8, COVER_LAP = 0.4;                     // a cover spans the texture's own row: its stripes on either side
  const ROW_LEN = COVER_OUT + COVER_LAP;                      // ... and laps the junction line so the two blocks' covers meet
  for (const [jx, jz, sx, sz] of [[x0, z0, 1, 1], [x0, z0 + CHUNK, 1, -1], [x0 + CHUNK, z0, -1, 1], [x0 + CHUNK, z0 + CHUNK, -1, -1]]) {
    const kx = kerbIn(sx > 0 ? 0 : 1), kz = kerbIn(sz > 0 ? 2 : 3);      // the two kerbs that meet at this corner
    const cut = besideFlyover(jx / CHUNK, jz / CHUNK) ? FLY.chamfer : 0; // the pavement's tip is road at a junction beside a flyover
    // The row stands off the edge of the carriageway it runs along, and that edge is the wider of the two kerbs
    // that face each other there: the block across the other street has the other half of this junction's mouth,
    // and at a junction a lane opens into, one of the two has stepped out while the other has not. A row set off
    // one side's kerb alone would stand inside the lane on the other side of the junction.
    const kxWide = Math.max(kx, PAVE_IN + (atGradeSide(cx, cz + (sz > 0 ? -1 : 1), sx > 0 ? 0 : 1) ? FLY.atGrade : 0));
    const kzWide = Math.max(kz, PAVE_IN + (atGradeSide(cx + (sx > 0 ? -1 : 1), cz, sz > 0 ? 2 : 3) ? FLY.atGrade : 0));
    const line = [kzWide + cut + GAP, kxWide + cut + GAP];               // 0: over the avenue, 1: over the cross street
    for (const across of [0, 1]) {
      const k = across ? kz : kx;
      const moved = line[across] > TEX_LINE + 0.05;                      // the texture did not paint its row out here
      if (moved) add(across                                                 // so its row comes off the asphalt first
        ? box(1.6, 0.02, ROW_LEN, tar, jx + sx * TEX_LINE, 0.02, jz + sz * ((COVER_OUT - COVER_LAP) / 2), false)
        : box(ROW_LEN, 0.02, 1.6, tar, jx + sx * ((COVER_OUT - COVER_LAP) / 2), 0.02, jz + sz * TEX_LINE, false));
      // The stripes stand on the texture's own centres — half a stripe in from its first one, every step of ten
      // texels — so the row carries the texture's own stripes on in the same size and step, and stops a kerb's
      // reach short of the kerb, exactly as the texture's rows do at a plain junction.
      for (let u = FIRST; u + STRIPE / 2 <= k - 0.4; u += STEP) {
        if (!moved && u + STRIPE / 2 <= TEX_END + 0.02) continue;        // the texture's own stripes already run there
        add(across
          ? box(DEEP, 0.03, STRIPE, paint, jx + sx * line[across], 0.03, jz + sz * u, false)
          : box(STRIPE, 0.03, DEEP, paint, jx + sx * u, 0.03, jz + sz * line[across], false));
      }
    }
    // The wide street's carriageway has swallowed the other street's centre line the same way: the dashes inside
    // it come off, out to the crossing that moved out with the kerb, and the line keeps its dashes beyond that.
    // The coat is laid square over the junction's centre line — the width of a dash either way — so each block's
    // coat takes the half of the line on its own side and not a hairline of it is left lying across the street.
    for (const o of [0, 1]) {
      let far = line[o] + DEEP / 2 + 0.2;                          // out past the crossing that moved with the kerb
      if (far <= DASH0) continue;                                  // the kerb never reached the dashes: nothing to lift
      const phase = (o ? sx : sz) > 0 ? DASH0 : CHUNK - DASH_LAST; // the dashes this block paints, measured outward
      const into = (far - phase) % DASH_PITCH;
      if (into >= 0 && into < DASH_LEN) far += DASH_LEN - into;    // never stop the coat inside a dash: the stub would show
      const to = Math.max(far, DASH1);                             // the first dash comes off whole, not half of it
      add(o
        ? box(to - (DASH0 - 1.6), 0.02, DASH_W + 0.2, tar, jx + sx * ((DASH0 - 1.6 + to) / 2), 0.02, jz + sz * (DASH_W + 0.2) / 2, false)
        : box(DASH_W + 0.2, 0.02, to - (DASH0 - 1.6), tar, jx + sx * (DASH_W + 0.2) / 2, 0.02, jz + sz * ((DASH0 - 1.6 + to) / 2), false));
    }
  }  if (defer) {
    // hand the merge over to the streamer: the group goes in now (it already draws the road and the paving it
    // was given directly), the merged buildings and props follow over the next few frames
    ch.mergeQ = ch.bakeList; ch.bakeList = null; ch.materialBag = new Map(); ch.merged = false;
    scene.add(group);
    return ch;
  }
  finishChunk(ch);
  ch.merged = true;
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
  scene.remove(ch.group); ch.geos.forEach(g => g.dispose());
  for (const g of ch.owned) g.dispose();                       // the block's stand-alone pieces go with it
  ch.owned.length = 0;
  ch.insts.forEach(m => m.dispose());
  if (ch.materialBag) { for (const geos of ch.materialBag.values()) geos.forEach(g => g.dispose()); ch.materialBag.clear(); }
  if (ch.mergeQ) ch.mergeQ.length = 0;
  for (const p of ch.pumps || []) p.gone = true;               // a dismantled forecourt must not go on exploding
  for (const pc of ch.spill) scene.remove(pc.mesh);      // cars added to the lot after generation
  removeIntersection(ch.cx * CHUNK, ch.cz * CHUNK);
}
// Streaming budget. A block is expensive to build and to merge (a shopping street is 600+ pieces), so the
// streamer works to a time budget rather than a block count, and the merging is spread over frames by
// flushChunk. At 60 fps a 6 ms budget leaves the rest of the frame to physics and drawing, which is what stops
// the streamer hitching the moment the player reaches new ground. Pass a budget of 999 to build everything at
// once (boot and world reset, when there is nothing to stall).
//
// One ring beyond the view is kept built but hidden (group.visible = false, so it draws nothing): when the view
// moves, that block is already there instead of being built in the middle of the frame. The prefetch only runs
// when the view queue is empty, so a fast drive never pays for it, and it has its own small budget.
const STREAM_MS = 6, PREFETCH_MS = 4, MERGE_MS = 3;
export function updateChunks(px, pz, budget) {
  const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
  // ---- drop what is two rings out, and show/hide what is in the view ring ----
  for (const [k, ch] of chunks) if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) > VIEW_R + 2) { disposeChunk(ch); chunks.delete(k); }
  for (const ch of chunks.values()) {
    const inView = Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) <= VIEW_R;
    if (ch.group.visible !== inView) ch.group.visible = inView;
  }
  // ---- build whatever the view needs, nearest first, inside the time budget ----
  const need = [];
  for (let dx = -VIEW_R; dx <= VIEW_R; dx++) for (let dz = -VIEW_R; dz <= VIEW_R; dz++) {
    const cx = pcx + dx, cz = pcz + dz; if (!chunks.has(ck(cx, cz))) need.push({ cx, cz, d: dx * dx + dz * dz });
  }
  need.sort((a, b) => a.d - b.d);
  const all = budget >= 999;
  const t0 = all ? 0 : performance.now();
  const limit = Math.min(budget, need.length);
  for (let i = 0; i < limit; i++) {
    // the first block always goes in (there has to be ground under the car), the rest only while under budget
    if (!all && i > 0 && performance.now() - t0 > STREAM_MS) break;
    chunks.set(ck(need[i].cx, need[i].cz), generateChunk(need[i].cx, need[i].cz, !all));
  }
  // ---- finish off whatever is still merging, inside its own budget ----
  if (!all) {
    const tf = performance.now();
    for (const ch of chunks.values()) {
      if (ch.merged !== false) continue;
      flushChunk(ch);
      if (performance.now() - tf > MERGE_MS) break;
    }
  }
  // ---- nothing missing in view: build the hidden ring ahead of the player ----
  if (all || need.length > limit) return;
  const ahead = [];
  for (let dx = -VIEW_R - 1; dx <= VIEW_R + 1; dx++) for (let dz = -VIEW_R - 1; dz <= VIEW_R + 1; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== VIEW_R + 1) continue;
    const cx = pcx + dx, cz = pcz + dz;
    if (!chunks.has(ck(cx, cz))) ahead.push({ cx, cz, d: dx * dx + dz * dz });
  }
  if (!ahead.length) return;
  ahead.sort((a, b) => a.d - b.d);
  const tp = performance.now();
  for (let i = 0; i < ahead.length; i++) {
    if (i > 0 && performance.now() - tp > PREFETCH_MS) break;
    const ch = generateChunk(ahead[i].cx, ahead[i].cz, true);
    ch.group.visible = false;                                  // built ahead of the view, drawn when it arrives
    chunks.set(ck(ahead[i].cx, ahead[i].cz), ch);
  }
}
const _near = [];
export function nearChunks(x, z) {
  _near.length = 0; const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = chunks.get(ck(cx + i, cz + j)); if (c) _near.push(c); }
  return _near;
}
// Returns the plaza entry if (x, z) is inside any plaza's island (the grass/curb disc), or null otherwise.
// Used by civilian AI to steer around plazas: regular cars go around the island, police and the player
// are allowed to drive through (the user wanted it to feel like a real roundabout — traffic gives it
// a wide berth unless it is chasing someone).
export function plazaIn(x, z) {
  const list = nearChunks(x, z);
  for (const ch of list) for (const p of ch.plazas) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < p.radius * p.radius) return p;
  }
  return null;
}
// Parks one more car in a free bay of this block and returns it, or null when the lot is full.
// Used at night to top malls up to their 2-3 car floor without regenerating the chunk.
export function addParkedCarToChunk(ch, kind, color, slot) {
  if (!kind) return null;                                       // a bay with no vehicle type sits empty
  if (!slot) {
    if (!ch.parking || !ch.parking.length) return null;
    slot = ch.parking.splice(Math.floor(Math.random() * ch.parking.length), 1)[0];
  }
  const dims = CAR_DIMS[kind] || CAR_DIMS.civ;
  const mesh = buildCar(kind, color, false);
  mesh.position.set(slot.x, slot.y, slot.z); mesh.rotation.y = slot.rotY;
  scene.add(mesh);                                         // outside the chunk group so it survives rebuilds
  const parked = { mesh, x: slot.x, z: slot.z, kind, mass: dims.mass, hp: dims.hp, len: dims.e1, wid: dims.e2, color, broken: false, wrecked: false, lastHit: -99, solid: null };
  ch.spill.push(parked);
  // The bay becomes a destructible solid like any other parked car.
  // Bays carry their own extents; a car facing along z is as wide as e2 and as long as e1 (and the other way
  // round when it faces along x), which is exactly how the generator lays its own parked cars out.
  const alongZ = Math.abs(Math.cos(slot.rotY)) > 0.5;
  const hx = slot.hx !== undefined ? slot.hx : (alongZ ? dims.e2 : dims.e1) + 0.2;
  const hz = slot.hz !== undefined ? slot.hz : (alongZ ? dims.e1 : dims.e2) + 0.2;
  const entry = { x: slot.x, z: slot.z, hx, hz, kind: 'parkedcar', box: { x: slot.x, z: slot.z, ux: 1, uz: 0, vx: 0, vz: 1, e1: hx, e2: hz } };
  entry.base = { hx, hz };
  entry.parked = parked; parked.solid = entry;
  ch.solids.push(entry);
  return parked;
}
// Is there something solid at (x, z), within `m` of the point? `y` is the height the question is asked from: a
// solid that is only real for what is below it (`maxY` — the interchange's embankment walls) is skipped when the
// asker is above it. That is what lets a car up on a flyover look down the road ahead of it and see clear
// asphalt, while a car at grade beside the same spot is told the concrete is there.
export function solidAt(x, z, m, y = 0) {
  const list = nearChunks(x, z);
  for (const ch of list) for (const s of ch.solids) {
    if (s.maxY !== undefined && y > s.maxY) continue;
    if (Math.abs(x - s.x) < s.hx + m && Math.abs(z - s.z) < s.hz + m) return true;
  }
  return false;
}