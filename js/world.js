/* Procedural city: chunk generation, streaming, spatial queries.

   WHAT A CHUNK IS
   A chunk is one 80 m block of the city, keyed by (cx, cz) via ck(). generateChunk() builds it from a seeded
   random stream (mulberry32(hash2(cx, cz))), so the same block always comes out the same. Blocks are built ahead
   of the player and dropped when they are far away (updateChunks / disposeChunk).

   THE CHUNK RECORD (`ch`, created at the top of generateChunk)
     solids     collision footprints the cars test against:
                { x, z, hx, hz, kind, maxY?, box, ...back-references }
                  x, z         centre, in world metres
                  hx, hz       half sizes along x and z (axis-aligned)
                  kind         'building' for walls, 'shopfront' for a shop window, and the feature's own kind
                  maxY         optional: solid only for a car below this height (a wall under a flyover deck)
                  box          oriented box used by the SAT test (collideSolids)
                  tree / parked / busstop / shop / pump / scaffold / fencePiece
                               the feature that owns this solid; the collision code breaks or damages it
                               through that back-reference
     props      street furniture a car can knock over (breakProp)
     trees      street trees; each has a solid, and an instanced mesh built per chunk
     shops      shop fronts (glass pane + solid), used for smashing and for the shop list
     parking    parked-car bays; parked cars take a slot from here
     pickups, pumps, busStops, fencePanels, roadworks, signalPoles, plazas, pads, spill, lotStanding, keepouts,
     ramps, parades, insts   the other features of the block (see the code that fills each one)
     geos, owned  every geometry this block allocated; disposeChunk() frees them when the block streams out

   GEOMETRY LIFECYCLE
     add(obj)            bakes a mesh into the chunk: its geometry and world matrix go into ch.bakeList
     generateChunk()     with defer=true, the bake list is moved to ch.mergeQ and the chunk is returned at once
     flushChunk(ch)      gathers the queued pieces by material and merges them a few hundred at a time per frame,
                         so a busy block never stalls one frame
     own(ch, obj)        for a stand-alone piece that is also a breakable object: its merged geometry is owned by
                         the block and freed with it

   WHAT TO CHANGE TOGETHER
     A new feature that can be hit or walked into needs a solid (or a prop) in ch, and it must stay inside the
     block's building line. tools/sidewalk-checks/run.mjs checks both; a feature that is only drawn needs none.
*/
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK, VIEW_R, PI, mulberry32, hash2, ck } from './utils.js';
import { scene } from './renderer.js';
import { mat, box, cyl, ASSET, makeBuildingGeo, facadeMat } from './assets.js';
import { textGeometry, buildHospitalMesh, buildFireStationMesh, buildSchoolMesh, buildFuelStationMesh, buildBankMesh, buildStoreMesh, STORE_KINDS, STORE_DEFS, FUEL_BRANDS, textBlocks } from "./campus.js";
import { buildSportMesh, SPORT_KINDS, SPORT_DEFS, sportScale } from "./sports.js";
import { buildFactoryMesh, FACTORY_KINDS } from "./factory.js";
import { SHOP_TYPES, PARADE_TITLES, buildShopFrontMesh, buildShopParadeMesh } from './shops.js';
import { bake, finishChunk, flushChunk, buildTreeInstances, mergeStandalone, own } from './chunkBake.js';
import { chunks, nearChunks, plazaIn } from './chunkState.js';
import { solidAt, solidsNear } from './solidIndex.js';
import { PAVE_IN, PAVE_OUT, WALK_Y, PIT_IN, FACTORY_SHARE, PAD_IN, CURB_TILE, BORDER_TILE, SIDEWALK_SIDES, pickSidewalkStyle, stripStops, sidewalkPieces, treePit, bakeRing } from './sidewalks.js';
import { FRAME_COLORS, NET_COLORS, PLANK_COLORS, SIGN_COLORS, buildScaffoldMesh, MACH_Y, MIXER_ORANGE, siteMachine, siteSpots } from './sites.js';
import { buildFlyoverNoseGuard, buildFlyoverDelineator, buildFlyoverNameboard, buildFlyoverBillboard, buildFlyoverGantry, buildPlazaIsland, warmTextCache } from './flyoverFurniture.js';
import { ESTATE_ROAD, planEstate, utilityNbhd, nbhdPlan, nbhdClip, ESTATE_MEMO_MAX, estatePlanMemo } from './neighbourhoods.js';

// Paints of the brick walk-ups (red, brown, cream stone, sage, rose, teal, mustard, slate) and of the brick houses
// in the suburbs: the palette of the reference street art, where no two neighbouring fronts match.
const WALKUP_WALLS = [0xa9503a, 0x8c5a40, 0xd9c9a3, 0x7d9c73, 0xd98f9a, 0x4f9c98, 0xd6a846, 0x6f86a6];
const HOUSE_BRICK = [0xa9503a, 0x8c5a40, 0xd6c7a1, 0x9a6a58];
const IRON = 0x3b3f45;
import { buildCar, CAR_DIMS } from './carModels.js';
import { PROP_DEFS } from './props.js';
import { TREE_VARIANTS, setTreeMatrix } from './trees.js';
import { buildIntersection, removeIntersection } from './trafficLights.js';
import { FLY, RAMP_RUN, rampHeight, insideFootprint, flyoverQuadrants, atGradeSide, onAtGradeLane, roadEdge, bridgeAt, bridgeHeight, flyoverFlats, besideFlyover, plazaAt, segClosed, segFilled, nbhdOf, nbhdInterior, nbhdJunction, NB_BLOCKS } from './flyover.js';
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
function generateChunk(cx, cz, defer = false) {
  const rng = mulberry32(hash2(cx, cz) ^ 0x51ED);
  const r = (a = 0, b = 1) => a + (b - a) * rng();
  const nShop = 5, shopW = 9;                                  // five businesses per parade, 9 m each
  const x0 = cx * CHUNK, z0 = cz * CHUNK, bx = x0 + 40, bz = z0 + 40, bx0 = x0 + 12, bz0 = z0 + 12;
  const group = new THREE.Group();
  const ch = { cx, cz, group, solids: [], props: [], pickups: [], ramps: [], busStops: [], pumps: [], fencePanels: [], shops: [], parades: [], roadworks: [], geos: [], owned: [], bakeList: [], trees: [], insts: [], keepouts: [], parking: [], pads: [], spill: [], lotStanding: [], signalPoles: [], plazas: [] };
  const safe = (cx === 0 || cx === -1) && (cz === 0 || cz === -1);
  const add = o => bake(ch, o);
  // The footprint of every suburban house in this block (grid or estate). A house's yard needs a way in from the street,
  // so the hedge and fence lines in front of it get a gap (see yardGap).
  const yards = [];
  const yardGap = (x, z, alongZ) => yards.some(y => alongZ
    ? Math.abs(z - y.z) < 2 + y.hd && Math.abs(x - y.x) < 14 + y.hw
    : Math.abs(x - y.x) < 2 + y.hw && Math.abs(z - y.z) < 14 + y.hd);
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
    ch.props.push({ mesh: m, x, z, r: d.r, drag: d.drag, color: d.color, kind, broken: false, soft: !!d.soft });
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
    const halfW = BUSSTOP_W / 2 + 0.3, halfD = BUSSTOP_D / 2 + 0.3;
    const hx = axisIsZ ? halfD : halfW, hz = axisIsZ ? halfW : halfD;
    // The flyover's at-grade lane runs through there: test the whole shelter, not just its centre, since its ends
    // are 2.5 m from it and the shelter is a solid.
    for (let ax = -hx; ax <= hx + 1e-9; ax += 0.4) for (let az = -hz; az <= hz + 1e-9; az += 0.4) if (onAtGradeLane(x + ax, z + az, 0.3)) return;
    const rotY = side === 0 ? -PI / 2 : side === 1 ? PI / 2 : side === 2 ? PI : 0;
    const variant = BUS_LIVERIES[Math.floor(rng() * BUS_LIVERIES.length)];
    const g = own(ch, mergeStandalone(buildBusStopMesh(variant))); g.position.set(x, WALK_Y, z); g.rotation.y = rotY; group.add(g);
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
  // ---- closed streets (three-way junctions, see segClosed in flyover.js) ----
  // A street closed for this block: its half of the carriageway (the side of the block's own kerb) is grass, and a
  // barrier stands across the mouth at each end, so no car drives in. The grass sits on top of the road texture, so it
  // hides the road beneath it. Side order: 0 = west, 1 = east, 2 = south, 3 = north (as in atGradeSide).
  const closed = [0, 1, 2, 3].map(si => si === 0 ? segClosed('z', cx, cz) : si === 1 ? segClosed('z', cx + 1, cz) : si === 2 ? segClosed('x', cx, cz) : segClosed('x', cx, cz + 1));
  // the mouth of a barred street: three striped road-works barricades across it (soft and breakable, like the road
  // barriers), so a hard hit breaks through and a bump does not
  const closedBarrier = (x, z, hx, hz) => {
    const alongX = hx > hz;
    for (const d of [-2.8, 0, 2.8]) prop('barricade', alongX ? x + d : x, alongX ? z : z + d, alongX ? 0 : PI / 2);
  };
  const closedGrass = (w, d, x, z, colour = 0x7bc96f) => add(box(w, 0.1, d, mat(colour), x, 0.25, z, false));   // top at 0.30, as a block's pad
  // A filled street (segFilled in flyover.js): this block's half of it, out to the block's edge, is grass, so the pads
  // either side join. It takes the walkway too, which is why the walkway side is skipped (sidewalkPieces).
  // A small park on a filled street's green: a pale path down the middle, four trees and two benches. The fill has no
  // barrier, so the park is pads and props only; it stays inside the block's own half, clear of the junction squares.
  const parkPlot = (sx, sz, alongZ, across) => {
    const at = (ac, al) => alongZ ? [sx + ac, sz + al] : [sx + al, sz + ac];
    const [px, pz] = at(0, 0);
    add(box(alongZ ? 2 : 52, 0.02, alongZ ? 52 : 2, mat(0xd8cfb8), px, 0.31, pz, false));
    const trees = [[-0.6, -20], [0.6, -6], [-0.6, 8], [0.6, 22]];
    for (const [k, al] of trees) { const [tx, tz] = at(k * across, al); tree(tx, tz, 0.3); }
    const [b1x, b1z] = at(0.55 * across, -13), [b2x, b2z] = at(-0.55 * across, 14);
    prop('bench', b1x, b1z, alongZ ? -PI / 2 : 0, 0.3);
    prop('bench', b2x, b2z, alongZ ? PI / 2 : PI, 0.3);
  };
  const fillHalf = (k, x, z, w, d) => { if (filled[k]) { closedGrass(w, d, x, z); parkPlot(x, z, k < 2, k < 2 ? w / 2 : d / 2); } };
  const filled = [0, 1, 2, 3].map(si => closed[si] && (si === 0 ? segFilled('z', cx, cz) : si === 1 ? segFilled('z', cx + 1, cz) : si === 2 ? segFilled('x', cx, cz) : segFilled('x', cx, cz + 1)));
  // a construction site (siteOn, below) sits on a barred, unfilled, non-neighbourhood street; its grass half is bare earth
  const siteFree = (j1, j2) => !nbhdJunction(j1[0], j1[1]) && !nbhdJunction(j2[0], j2[1]);
  const site = [
    closed[0] && !filled[0] && siteFree([cx, cz], [cx, cz + 1]),
    closed[1] && !filled[1] && siteFree([cx + 1, cz], [cx + 1, cz + 1]),
    closed[2] && !filled[2] && siteFree([cx, cz], [cx + 1, cz]),
    closed[3] && !filled[3] && siteFree([cx, cz + 1], [cx + 1, cz + 1]),
  ];
  const EARTH = 0xa98b64, GRASS = 0x7bc96f;
  // A neighbourhood's centre junction is inside it: the streets that meet there have no barrier at that end, and its
  // corner squares are grass (see nbhdInterior in flyover.js).
  const mouth = (jx, jz, x, z, hx, hz) => { if (!nbhdInterior(jx, jz)) closedBarrier(x, z, hx, hz); };
  if (closed[0]) { if (filled[0]) fillHalf(0, x0 + 6.3, z0 + 40, 12.6, 64); else { closedGrass(8, 64, x0 + 4, z0 + 40, site[0] ? EARTH : GRASS); mouth(cx, cz, x0 + 4, z0 + 8.2, 4, 0.3); mouth(cx, cz + 1, x0 + 4, z0 + 71.8, 4, 0.3); } }
  if (closed[1]) { if (filled[1]) fillHalf(1, x0 + CHUNK - 6.3, z0 + 40, 12.6, 64); else { closedGrass(8, 64, x0 + 76, z0 + 40, site[1] ? EARTH : GRASS); mouth(cx + 1, cz, x0 + 76, z0 + 8.2, 4, 0.3); mouth(cx + 1, cz + 1, x0 + 76, z0 + 71.8, 4, 0.3); } }
  if (closed[2]) { if (filled[2]) fillHalf(2, x0 + 40, z0 + 6.3, 64, 12.6); else { closedGrass(64, 8, x0 + 40, z0 + 4, site[2] ? EARTH : GRASS); mouth(cx, cz, x0 + 8.2, z0 + 4, 0.3, 4); mouth(cx + 1, cz, x0 + 71.8, z0 + 4, 0.3, 4); } }
  if (closed[3]) { if (filled[3]) fillHalf(3, x0 + 40, z0 + CHUNK - 6.3, 64, 12.6); else { closedGrass(64, 8, x0 + 40, z0 + 76, site[3] ? EARTH : GRASS); mouth(cx, cz + 1, x0 + 8.2, z0 + 76, 0.3, 4); mouth(cx + 1, cz + 1, x0 + 71.8, z0 + 76, 0.3, 4); } }
  for (const [kx, kz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    if (nbhdInterior(cx + kx, cz + kz)) closedGrass(8, 8, x0 + (kx ? 76 : 4), z0 + (kz ? 76 : 4));
  }
  // ---- construction site on a barred closed street ----
  // The half of a barred street between its mouths is a building site on bare earth (EARTH, not grass): a half-built concrete frame (columns,
  // slabs, brick infill on its lowest two floors and rebar stubs on top) and, on the west or south street of each
  // pair, a tower crane. Boxes only, and no solids: the barricades at the mouths keep every car out. Neighbourhood
  // streets (their curved roads run across the grass) and filled streets get no site.
  // one or two machines (a random pick of five kinds, never the same kind twice) on the bare earth past the crane, side
  // by side across the strip; they are solid, like the frame, and are marked so the checks can count them
  const siteMachines = (axis, acr, alc, seed) => {
    const n = 1 + ((seed >>> 3) & 1), k1 = (seed >>> 4) % 5, k2 = (k1 + 1 + ((seed >>> 7) % 4)) % 5;
    [k1, k2].slice(0, n).forEach((kind, i) => {
      const ac = n === 1 ? 0 : (i === 0 ? -1.9 : 1.9), al = 31;
      const px = axis === 'z' ? acr + ac : alc + al, pz = axis === 'z' ? alc + al : acr + ac;
      if (kind === 1) {
        // The cement mixer is the street's own transit-mixer truck (buildCar 'cementtruck'), the same model the traffic
        // drives, standing in its site bay with the same destructible heavy-vehicle record as the other machines.
        const m = buildCar('cementtruck', MIXER_ORANGE, false);
        m.position.set(px, 0, pz); m.rotation.y = axis === 'z' ? 0 : PI / 2; group.add(m);
        const td = CAR_DIMS.cementtruck;                  // e1 is the half length along the truck, e2 the half width
        const hx = axis === 'z' ? td.e2 + 0.2 : td.e1 + 0.2, hz = axis === 'z' ? td.e1 + 0.2 : td.e2 + 0.2;
        solid(px, pz, hx, hz, 'parkedcar');
        const sEntry = ch.solids[ch.solids.length - 1];
        const dims = CAR_DIMS.ambulance;
        const rec = { mesh: m, x: px, z: pz, kind: 'ambulance', mass: dims.mass, hp: dims.hp, len: dims.e1, wid: dims.e2, color: MIXER_ORANGE, broken: false, wrecked: false, lastHit: -99, solid: sEntry };
        sEntry.base = { hx, hz }; sEntry.parked = rec; sEntry.machine = kind;
        return;
      }
      const { g, L, W } = siteMachine(kind);
      const m = own(ch, mergeStandalone(g)); m.position.set(px, 0, pz); m.rotation.y = axis === 'z' ? 0 : PI / 2; group.add(m);
      const hx = axis === 'z' ? W / 2 : L / 2, hz = axis === 'z' ? L / 2 : W / 2;
      // A machine is a parked heavy vehicle, destructible like the ambulance: it takes rams (hitParkedHeavy), its
      // hp runs out after a few hard hits (wreckParkedHeavy), and the burnt hulk stays where it died.
      solid(px, pz, hx, hz, 'parkedcar');
      const sEntry = ch.solids[ch.solids.length - 1];
      const dims = CAR_DIMS.ambulance;
      const rec = { mesh: m, x: px, z: pz, kind: 'ambulance', mass: dims.mass, hp: dims.hp, len: dims.e1, wid: dims.e2, color: MACH_Y, broken: false, wrecked: false, lastHit: -99, solid: sEntry };
      sEntry.base = { hx, hz }; sEntry.parked = rec; sEntry.machine = kind;
    });
  };
  const siteOn = (axis, acr, alc, crane, seed) => {
    const L = 28, D = 6, H = 3.2, nF = 5 + (seed & 1) + ((seed >>> 1) & 1), top = nF * H;
    // (ac, al) are offsets across and along the street from the site's centre (acr, alc)
    const put = (ac, al, wAc, h, lAl, y, colour) => {
      const [sx, sz] = axis === 'z' ? [wAc, lAl] : [lAl, wAc];
      const [px, pz] = axis === 'z' ? [acr + ac, alc + al] : [alc + al, acr + ac];
      add(box(sx, h, sz, mat(colour), px, y, pz, true));
    };
    for (let a = -L / 2 + 0.6; a < L / 2; a += 4) for (const ac of [-D / 2 + 0.6, D / 2 - 0.6]) put(ac, a, 0.9, top, 0.9, top / 2 + 0.3, 0xbfc3c7);
    for (let f = 1; f <= nF; f++) put(0, 0, D, 0.3, L, f * H + 0.15, 0xa9adb1);
    for (let f = 0; f < 2 && f < nF; f++) put(D / 2 - 0.2, -L / 4, 0.4, H - 0.4, L / 2, 0.3 + f * H + H / 2, 0xb5583a);
    for (let a = -L / 2 + 0.6; a < L / 2; a += 8) for (const ac of [-D / 2 + 0.6, D / 2 - 0.6]) put(ac, a, 0.12, 1.2, 0.12, 0.3 + top + 0.6, 0x6b6f73);
    // the frame is solid on its footprint: a car cannot drive in under its columns
    solid(axis === 'z' ? acr : alc, axis === 'z' ? alc : acr, axis === 'z' ? D / 2 : L / 2, axis === 'z' ? L / 2 : D / 2, 'building');
    siteMachines(axis, acr, alc, seed);
    if (!crane) return;
    // tower crane: base, mast, jib, counter-jib, cab and hook; it stands past the building's far end
    const ma = L / 2 + 8, mastTop = 34;
    put(0, ma, 2.6, 0.8, 2.6, 0.7, 0x7a7f86);
    // the crane's base is solid too: the mast stands on it, so a car cannot drive through the foot of the tower
    solid(axis === 'z' ? acr : alc + ma, axis === 'z' ? alc + ma : acr, 1.3, 1.3, 'building');
    put(0, ma, 1.0, mastTop, 1.0, 0.3 + mastTop / 2, 0xe39a2b);
    put(0, ma + 10, 0.8, 0.8, 34, 0.3 + mastTop + 0.4, 0xd98a22);
    put(-1.2, ma - 2, 1.6, 1.4, 1.6, 0.3 + mastTop - 1.6, 0x3a3f47);
    // hook block: four wire ropes run from the jib end down to a yellow and black pulley block with a J hook, as on a
    // real tower crane. It hangs 15 m up, over the street past the site, so no car at grade can reach it.
    const hbTop = 0.3 + mastTop - 16, hbY = hbTop - 1.1, hbAl = ma + 24, ropeLen = 16;
    const hb = new THREE.Group();
    hb.position.set(axis === 'z' ? acr : alc + hbAl, hbY, axis === 'z' ? alc + hbAl : acr);
    hb.rotation.y = axis === 'z' ? 0 : PI / 2;                     // local x is across the street, as the machines do
    const hY = mat(0xf2c230), hK = mat(0x1d1d1d), hD = mat(0x2b2b2b), hH = mat(0x2a2d33), hR = mat(0x222222);
    hb.add(box(1.0, 2.2, 0.9, hY, 0, 0, 0));                        // yoke body, yellow
    for (const fz of [-0.46, 0.46]) for (const sx of [-0.42, 0, 0.42]) {   // black diagonal stripes on both faces
      const st = box(0.14, 1.2, 0.03, hK, sx, 0, fz); st.rotation.z = 0.9; hb.add(st);
    }
    hb.add(cyl(0.2, 0.2, 0.22, 10, hY, 0, 1.2, 0));                 // top eye / bolt cap
    for (const fz of [-0.46, 0.46]) for (const sx of [-0.42, 0.42]) hb.add(cyl(0.035, 0.035, 0.03, 4, hD, sx, 0.9, fz));   // bolt heads
    const drum = cyl(0.45, 0.45, 0.2, 14, hD, -0.6, 0.2, 0); drum.rotation.z = PI / 2; hb.add(drum);   // wire-rope drum on the side
    const hub = cyl(0.3, 0.3, 0.24, 12, hY, -0.6, 0.2, 0); hub.rotation.z = PI / 2; hb.add(hub);
    // the hook: a shank from the yoke, then a J of short cylinders on a circle of radius 0.45 about (0.45, -1.7)
    const hookSeg = (x0, y0, x1, y1) => {
      const L = Math.hypot(x1 - x0, y1 - y0), m = cyl(0.09, 0.09, L + 0.02, 6, hH, (x0 + x1) / 2, (y0 + y1) / 2, 0);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0) - PI / 2; hb.add(m);
    };
    const J = [[0, -1.1], [0, -1.7]];
    for (let i = 0; i <= 12; i++) { const a = PI + (PI + 0.7) * i / 12; J.push([0.45 + 0.45 * Math.cos(a), -1.7 + 0.45 * Math.sin(a)]); }
    for (let i = 1; i < J.length; i++) hookSeg(J[i - 1][0], J[i - 1][1], J[i][0], J[i][1]);
    hb.add(cyl(0.14, 0.14, 0.2, 8, hD, 0, -1.2, 0));                 // the nut at the top of the shank
    for (const rx of [-0.25, 0.25]) for (const rz of [-0.25, 0.25]) hb.add(cyl(0.035, 0.035, ropeLen, 4, hR, rx, 1.1 + ropeLen / 2, rz, false));
    add(hb);
  };
  const siteSeed = (cx2, cz2, k) => hash2(cx2 * 7 + k, cz2 * 11 + 3 * k + 1);
  if (site[0]) siteOn('z', x0 + 4, z0 + 30, true, siteSeed(cx, cz, 0));
  if (site[1]) siteOn('z', x0 + 76, z0 + 30, false, siteSeed(cx, cz, 1));
  if (site[2]) siteOn('x', z0 + 4, x0 + 30, true, siteSeed(cx, cz, 2));
  if (site[3]) siteOn('x', z0 + 76, x0 + 30, false, siteSeed(cx, cz, 3));
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
  // The flat span of each bridge over this block (see flyoverFlats): the deck, its wearing course, its parapets,
  // copings and centre-line dashes. Each block lays its own stretch on its own half of the carriageway.
  for (const F of flyoverFlats(cx, cz)) {
    const W = FLY.halfW, alongX = F.axis === 'x', WEAR = 0.08, PH = 1.0;
    const conc = mat(0xb4b8bc), coping = mat(0xd3d0c8), asphalt = mat(0x3b3f4a), paint = mat(0xffcf2e);
    const at = (u, y, v) => alongX ? [F.node + u, y, F.road + v] : [F.road + v, y, F.node + u];
    const P = (w, h, d, m, u, y, v, role) => {
      const p = at(u, y, v);
      const b = alongX ? box(d, h, w, m, p[0], y, p[2], false) : box(w, h, d, m, p[0], y, p[2], false);
      add(b);
      fly.pieces.push({ role, axis: F.axis, road: F.road, node: F.node, su: u < 0 ? -1 : 1, sv: F.sv, u, y, v, w, h, d, rot: 0 });
    };
    const a0 = F.a0 - F.node, a1 = F.a1 - F.node, uc = (a0 + a1) / 2, Lu = a1 - a0;
    P(W, FLY.slab, Lu, conc, uc, FLY.deckH - WEAR - FLY.slab / 2, F.sv * W / 2, 'deck');
    P(W, WEAR, Lu, asphalt, uc, FLY.deckH - WEAR / 2, F.sv * W / 2, 'deck-wear');
    const pV = F.sv * (W - FLY.parapet / 2), cV = F.sv * (W - FLY.parapet + 0.31);
    P(FLY.parapet, PH, Lu, conc, uc, FLY.deckH + PH / 2, pV, 'parapet-deck');
    P(0.62, 0.12, Lu, coping, uc, FLY.deckH + PH + 0.06, cV, 'coping-deck');
    // Centre-line dashes every 6.25 m, on both sides of the start junction (the same spacing the ramps use).
    for (let k = 0; k < 30; k++) for (const sg of [-1, 1]) {
      const t = sg * (1.5 + 6.25 * k);
      if (t >= a0 && t <= a1) P(0.39, 0.05, 3.4, paint, t, FLY.deckH + 0.03, F.sv * 0.195, 'dash');
    }
  }
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
    // The height of the parapet above the driving surface. The parapet stands on the surface (so its underside
    // is at 0 and its top at PH) and the coping caps it: its underside is at PH and its top at PH + 0.12. The
    // coping's inboard face is flush with the parapet's, so the lane keeps its whole 15.1 m of clear width and
    // nothing leans out over the road. On the ramp both ride the surface's own normal, which is what keeps the
    // top of the parapet a constant height above the asphalt all the way up.
    const PH = 1.0;
    const pV = Q.sv * (W - FLY.parapet / 2), cV = Q.sv * (W - FLY.parapet + 0.31);
    q = sunk(PH / 2); P(FLY.parapet, PH, slopeLen, conc, q[0], q[1], pV, true, 'parapet-ramp');
    q = sunk(PH + 0.06); P(0.62, 0.12, slopeLen, coping, q[0], q[1], cV, true, 'coping-ramp');
    // The centre line: the same yellow dashes the road texture paints, carried up over the approach and across
    // the bridge, so the main road reads as one road that happens to be in the air for 114 m.
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
      ch.solids.push({ x: p[0], z: p[2], hx: alongX ? slice / 2 : W / 2, hz: alongX ? W / 2 : slice / 2, kind: 'flyover', ramp: true, maxY: top,
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
    // The drum is a breakable prop like the delineators, not a solid: a car that hits it knocks it over. maxY keeps it
    // to the road: a car up on the deck above does not touch it (collideProps checks the car's height against maxY).
    const gp = at(guardU, 0, guardV), guardRot = alongX ? Q.su * PI / 2 : Q.su > 0 ? 0 : PI;
    const guard = own(ch, mergeStandalone(buildFlyoverNoseGuard()));
    guard.position.set(gp[0], 0, gp[2]); guard.rotation.y = guardRot; group.add(guard);
    ch.props.push({ mesh: guard, x: gp[0], z: gp[2], r: 0.68, drag: 0.93, color: 0xffc928, kind: 'nosedrum', broken: false, soft: true, maxY: 1.15 });
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
      const bbU = Q.midU, mountY = FLY.deckH + PH + 0.12, p = at(bbU, mountY + 1.45, Q.sv * (W - FLY.parapet + 0.31));
      const bb = buildFlyoverBillboard();
      bb.position.set(p[0], p[1], p[2]);
      bb.rotation.y = alongX ? (Q.sv > 0 ? 0 : PI) : (Q.sv > 0 ? PI / 2 : -PI / 2);
      add(bb);
      (fly.billboards = fly.billboards || []).push({
        axis: Q.axis, node: Q.node, su: Q.su, sv: Q.sv, x: p[0], z: p[2], y: p[1], yaw: bb.rotation.y,
        u: bbU, v: Q.sv * (W - FLY.parapet + 0.31), w: 5.9, h: 2.0,
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
      const variant = (Q.su > 0 ? 1 : 0) + (Q.sv > 0 ? 2 : 0);   // each quarter reads its own sign
      const gantry = buildFlyoverGantry(legV, dir, variant);
      gantry.position.set(p[0], p[1], p[2]);
      gantry.rotation.y = alongX ? (Q.su > 0 ? PI / 2 : -PI / 2) : (Q.su > 0 ? 0 : PI);
      add(gantry);
      (fly.gantries = fly.gantries || []).push({
        axis: Q.axis, node: Q.node, su: Q.su, sv: Q.sv, x: p[0], z: p[2], y: p[1], yaw: gantry.rotation.y,
        u: Q.su * 9.0, base, legV, deck: FLY.deckH,
        beamUnder: p[1] + 4.46, signBottom: p[1] + 2.42, signTop: p[1] + 4.42,
        spans: [Q.sv * (legV - 0.4), Q.sv * 0.5], mount: 'coping',   // the panel's outer and inner ends, from the centre line
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
  let type = nearSpawn ? 'commercial'
    : (cx === -1 && cz === 0) ? 'hospital'
    : (cx === 0 && cz === -1) ? 'fire'                          // the block the player starts beside
    : (cx === -1 && cz === -1) ? 'fuel'                         // the filling station across from the fire hall
    : (cx === 1 && cz === -1) ? 'downtown'                     // the north-east corner beside the start: brick walk-ups (high street, shopfronts on the walk)
    : (cx === 0 && cz === 1) ? 'school'                        // a school one block up the street the player starts on
    : (cx === -1 && cz === 1) ? 'bank'                         // a bank on the block across from the school
    : laneBlock ? (t < 0.5 ? 'downtown' : t < 0.85 ? 'suburb' : 'park')   // no campus on a lane block
    : t < FACTORY_SHARE ? 'factory'                                          // an industrial plant on its own block
    : t < 0.38 ? 'downtown' : t < 0.64 ? 'suburb' : t < 0.78 ? 'park' : t < 0.85 ? 'commercial'
    : t < 0.872 ? 'fire' : t < 0.894 ? 'fuel' : t < 0.921 ? 'shops' : t < 0.945 ? 'bank' : t < 0.965 ? 'hospital'
    : t < 0.985 ? 'school' : 'industrial';
  // Standalone shops and services (grocery, fast food, pizza, gym, car showroom, pharmacy) take about one commercial or
  // suburban block in ten. The roll comes from the block's own hash, so it is the same every time the block is built.
  // Suburb blocks become estates (see planEstate) unless they are beside a flyover lane or at spawn.
  // A neighbourhood (see nbhdOf in flyover.js): its four blocks are suburb and share one curved plan (nbhdPlan)
  const nbRX = Math.floor(cx / NB_BLOCKS), nbRZ = Math.floor(cz / NB_BLOCKS);
  const nbPlan = nbhdOf(nbRX, nbRZ) ? nbhdPlan(nbRX, nbRZ) : null;
  if (nbPlan) type = 'suburb';
  const estateNow = type === 'suburb' && !laneBlock && !nearSpawn;
  const storeRoll = hash2(cx, cz);
  if (!laneBlock && !nearSpawn && (type === 'commercial' || (type === 'suburb' && !estateNow)) && (storeRoll & 0xFF) < 26)
    type = STORE_KINDS[(storeRoll >>> 8) % STORE_KINDS.length];
  // Sports and play grounds: about 15% of park or suburban blocks, from its own hash (a different one from the shops).
  const sportRoll = hash2(cx + 31, cz - 17);
  if (!laneBlock && !nearSpawn && (type === 'park' || (type === 'suburb' && !estateNow)) && (sportRoll & 0xFF) < 40)
    type = SPORT_KINDS[(sportRoll >>> 8) % SPORT_KINDS.length];
  // ---- sidewalk for this block: style from the district, plus randomly painted kerbs ----
  const swStyle = pickSidewalkStyle(type, rng);
  const sw = sidewalkPieces(cx, cz, swStyle, filled);
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
      // reflective warning cones placed along the sidewalk line in front of it. Every downtown building has its
      // shopfront on the face that looks at the street, so the scaffolding goes on one of the other three faces,
      // and only where its whole footprint stays inside the block's building line and clear of every other solid.
      if (h > 20 && rng() < 0.3) {
        const shopSide = alongX ? (faceAxis > 0 ? 0 : 1) : (faceAxis > 0 ? 2 : 3);
        let sideS = Math.floor(rng() * 3); if (sideS >= shopSide) sideS++;
        const faceLen = (sideS === 0 || sideS === 1) ? d : w;
        const sw = Math.max(4, Math.min(15, faceLen * r(0.5, 0.85)));
        const sh = Math.max(6, Math.min(h - 1.5, h * r(0.55, 0.92)));
        const sd = r(1.5, 2.2), bays = Math.max(2, Math.round(sw / r(1.8, 2.4))), levels = Math.max(3, Math.min(6, Math.round(sh / 2.6)));
        const style = Math.floor(rng() * 4);
        const o = { w: sw, d: sd, h: sh, bays, levels, style, frame: FRAME_COLORS[Math.floor(rng() * FRAME_COLORS.length)], net: NET_COLORS[Math.floor(rng() * NET_COLORS.length)], plank: PLANK_COLORS[Math.floor(rng() * PLANK_COLORS.length)], sign: SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)] };
        const dx = sideS === 0 ? w / 2 + sd / 2 + 0.6 : sideS === 1 ? -(w / 2 + sd / 2 + 0.6) : 0;
        const dz = sideS === 2 ? d / 2 + sd / 2 + 0.6 : sideS === 3 ? -(d / 2 + sd / 2 + 0.6) : 0;
        const rotS = (sideS === 0 || sideS === 1) ? PI / 2 : 0;
        const sx = clx + dx, sz = clz + dz;
        const fhx = rotS === 0 ? sw / 2 + 0.3 : sd / 2 + 0.3, fhz = rotS === 0 ? sd / 2 + 0.3 : sw / 2 + 0.3;
        if (sx - fhx < loX || sx + fhx > hiX || sz - fhz < loZ || sz + fhz > hiZ) continue;
        const clash = ch.solids.some(q => !(q.x === clx && q.z === clz && q.kind === 'building') &&
          sx + fhx > q.x - q.hx - 0.6 && sx - fhx < q.x + q.hx + 0.6 && sz + fhz > q.z - q.hz - 0.6 && sz - fhz < q.z + q.hz + 0.6);
        if (clash) continue;
        scaffold(sx, sz, rotS, o);
        const cdx = sideS === 0 ? 1 : sideS === 1 ? -1 : 0, cdz = sideS === 2 ? 1 : sideS === 3 ? -1 : 0;
        const coneCount = Math.max(3, Math.round(sw / 1.6)), step = sw / Math.max(1, coneCount - 1);
        // The cones stand just outside the scaffold's outer face (its footprint is sd/2 + 0.3 deep), not inside its solid:
        // a cone buried in the scaffolding is one a car can never reach, so it could never be knocked over.
        const coneOut = sd / 2 + 0.3 + 0.75;
        for (let k = 0; k < coneCount; k++) {
          const off = -sw / 2 + k * step;
          const cx2 = rotS === 0 ? sx + off : sx + cdx * coneOut, cz2 = rotS === 0 ? sz + cdz * coneOut : sz + off;
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
    // ---- estate (see planEstate): a curved road, its houses on both sides and a cul-de-sac, instead of the grid ----
    let plan = null;
    if (nbPlan) plan = nbhdClip(nbPlan, cx, cz);
    else if (estateNow) {
      // A block's estate plan is a pure function of the block, so it is kept for the next time the block streams in
      // (a bounded memo). A cached plan replays the same number of random draws, so the rest of the block is unchanged.
      const key = cx + ',' + cz;
      const hit = estatePlanMemo.get(key);
      if (hit) {
        for (let k = 0; k < hit.draws; k++) rng();
        plan = hit.plan;
      } else {
        let draws = 0;
        const rc = (a, b) => { draws++; return r(a, b); };
        const sides = [0, 1, 2, 3].filter(si => !atGradeSide(cx, cz, si));
        if (sides.length) plan = planEstate(lo_x, hi_x, lo_z, hi_z, sides[Math.floor(rc(0, sides.length))], rc);
        estatePlanMemo.set(key, { plan, draws });
        if (estatePlanMemo.size > ESTATE_MEMO_MAX) estatePlanMemo.delete(estatePlanMemo.keys().next().value);
      }
      if (plan) plan.inC = () => true;
    }
    if (plan) {
      const asph = mat(0x4b5058), paint = mat(0xf2f2ee), Y = 0.33;      // the road sits 3 cm above the pad (its top is 0.30)
      for (const rd of plan.roads) {
        // the road as one continuous strip: the two kerb lines run along the path, half the width either side of it along
        // its normal, and two triangles join each step. (The old flat boxes, each turned to its own chord, left notches
        // on the outside of every bend, which read as saw-teeth along the road.)
        {
          const R = rd.ribbon, pos = [], uv = [], idx = [];
          for (let i = 0; i < R.length; i++) {
            const p = R[i], ox = -p.tz * ESTATE_ROAD, oz = p.tx * ESTATE_ROAD;
            pos.push(p.x + ox, Y + 0.04, p.z + oz, p.x - ox, Y + 0.04, p.z - oz);
            uv.push(0, i * 0.25, 1, i * 0.25);
            if (i > 0) { const a = 2 * (i - 1), b = 2 * i; idx.push(a, b, a + 1, a + 1, b, b + 1); }
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          geo.setIndex(idx); geo.computeVertexNormals();
          ch.geos.push(geo);                                                    // freed with the block
          add(new THREE.Mesh(geo, asph));
        }
        rd.ribbon.forEach((p, i) => {                                       // a dashed centre line every 4 m
          if (i % 8 === 0 && i > 2 && i < rd.ribbon.length - 4 && plan.inC(p.x, p.z)) { const dm = box(2.2, 0.03, 0.14, paint, p.x, Y + 0.02, p.z, false); dm.rotation.y = Math.atan2(-p.tz, p.tx); add(dm); }
        });
        if (plan.inC(rd.disc.x, rd.disc.z)) add(cyl(rd.disc.r, rd.disc.r, 0.04, 28, asph, rd.disc.x, Y + 0.02, rd.disc.z, false));
      }
      for (const h of plan.houses) {
        const hg = new THREE.Group();
        hg.position.set(h.x, 0, h.z); hg.rotation.y = Math.atan2(-h.tz, h.tx);   // local +x runs along the road, +z away from it
        const wc = walls[Math.floor(r(0, walls.length))], rc = roofs[Math.floor(r(0, roofs.length))];
        hg.add(box(h.w, h.h, h.d, mat(wc), 0, h.h / 2 + 0.25, 0));
        const roof = new THREE.Mesh(ASSET.roofGeo, mat(rc)); roof.scale.set(h.w * 1.15, 3.2, h.d * 1.15); roof.position.set(0, h.h + 0.25 + 1.6, 0); roof.castShadow = true; hg.add(roof);
        const front = -h.k * (h.d / 2);                                   // the front faces the road
        hg.add(box(1.2, 2.1, 0.12, mat(0x5a3a22), 0, 1.3, front - h.k * 0.05, false));
        for (const sx of [-1, 1]) hg.add(box(1.5, 1.4, 0.1, mat(0x4f7fb5), sx * h.w * 0.28, h.h * 0.58, front - h.k * 0.04, false));
        add(hg);
        solid(h.x, h.z, h.hxA, h.hzA, 'building');
        yards.push({ x: h.x, z: h.z, hw: h.hxA, hd: h.hzA });
      }
      for (const t of plan.trees) tree(t.x, t.z);
      ch.estate = {
        side: nbPlan ? -1 : plan.side, nb: nbPlan ? [nbRX, nbRZ] : null, roadY: Y,
        entrance: [plan.roads[0].ribbon[0].x, plan.roads[0].ribbon[0].z],
        roads: plan.roads.map(rd => ({ ribbon: rd.ribbon.map(p => [p.x, p.z]), disc: rd.disc })),
        houses: plan.houses.map(h => ({ x: h.x, z: h.z, w: h.w, d: h.d, tx: h.tx, tz: h.tz, k: h.k, hxA: h.hxA, hzA: h.hzA })),
        bounds: { lo_x, hi_x, lo_z, hi_z },
      };
    }
    if (!plan) {
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
      yards.push({ x: hx, z: hz, hw: w / 2, hd: d / 2 });
      const cs = rng() < 0.5 ? 1 : -1, cs2 = rng() < 0.5 ? 1 : -1;
      tree(lx + cs * 7.6, lz + cs2 * 7.6);
      if (rng() < 0.4) tree(lx - cs * 7.6, lz + cs2 * 7.6);
    }
    for (const side of [-1, 1]) for (let x = -padW/2 + 1; x <= padW/2; x += 4.2) {
      if (rng() > 0.25) {
        const fx = bx + x + padOx, fz = bz + side * (padD/2 - 0.4) + padOz;
        if (!yardGap(fx, fz, false)) prop('fence', fx, fz, 0, 0.2);      // the fence also opens at each house's entrance
      }
    }
    }
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
  } else if (type === 'bank') {
    // A bank on its own block: a neoclassical hall with a six-column portico and a gold BANK pediment, a blue-grey
    // wing, a stepped forecourt with planters and lamps. Its front is the same face the other campuses use.
    const lotSurfaceY = 0.25;
    padBox(56, 42, mat(0xb9bec5), bxo - bx, bzo - bz);                     // forecourt pad
    const K = buildBankMesh(bxo, bzo, rng);
    K.group.position.set(bxo, 0, bzo);
    bake(ch, K.group);
    for (const sv of K.solids) solid(sv.x, sv.z, sv.hx, sv.hz, 'building');
    for (const sx of [-1, 1]) tree(bxo + sx * 21, bzo + 14, lotSurfaceY + 0.02);
    prop('bench', bxo - 9, bzo + 16, 0, lotSurfaceY + 0.15);
  } else if (STORE_KINDS.includes(type)) {
    // A standalone shop or service building on its own apron. Display cars stand in the showroom bays, which
    // are destructible like any parked car.
    const lotSurfaceY = 0.25, S = STORE_DEFS[type];
    padBox(S.pad[0], S.pad[1], mat(0xb9bec5), bxo - bx, bzo - bz);
    const K = buildStoreMesh(type, bxo, bzo, rng);
    K.group.position.set(bxo, 0, bzo);
    bake(ch, K.group);
    for (const sv of K.solids) solid(sv.x, sv.z, sv.hx, sv.hz, 'building');
    for (const b of K.bays) parkedCar(b.x, b.z, b.hx, b.hz, b.rotY, PARKED_KINDS[Math.floor(rng() * PARKED_KINDS.length)], PARKED_COLORS[Math.floor(rng() * PARKED_COLORS.length)], b.y);
    for (const sx of [-1, 1]) tree(bxo + sx * (S.pad[0] / 2 - 3), bzo + S.pad[1] / 2 - 4, lotSurfaceY + 0.02);
    prop('bench', bxo - S.pad[0] / 2 + 4, bzo + S.pad[1] / 2 - 4, 0, lotSurfaceY + 0.15);
  } else if (SPORT_KINDS.includes(type)) {
    // A fenced ground with its own markings: the fences and hoops or goals are solids, so a car stops at them.
    const lotSurfaceY = 0.25, S = SPORT_DEFS[type], sc = sportScale(type), PW = S.pad[0] * sc, PD = S.pad[1] * sc;
    padBox(PW, PD, mat(S.ground), bxo - bx, bzo - bz);
    const K = buildSportMesh(type, bxo, bzo, rng);
    K.group.position.set(bxo, 0, bzo);
    bake(ch, K.group);
    for (const sv of K.solids) solid(sv.x, sv.z, sv.hx, sv.hz, sv.kind);
    // The fence panels are handed over one by one, like the schoolyard fence (see the school branch): each is its
    // own solid and its own mesh, so a hard hit takes panels down and they tumble off the pad.
    for (const pc of K.fencePieces) {
      const pm = own(ch, mergeStandalone(pc.group));
      pm.position.set(pc.x, 0, pc.z);
      group.add(pm);
      pc.mesh = pm;
      solid(pc.x, pc.z, pc.hx, pc.hz, 'fence');
      const sEntry = ch.solids[ch.solids.length - 1];
      sEntry.fence = true;
      sEntry.fencePiece = pc;
      pc.solid = sEntry;
      ch.fencePanels.push(pc);
    }
    // The elements of the ground (hoops, goals, ramps, rails and the play equipment) are breakable pieces: each is its
    // own mesh and solid, and a hard hit knocks it off its base (breakPlayPiece in js/collisions.js).
    for (const pc of K.breakable) {
      const pm = own(ch, mergeStandalone(pc.group));
      pm.position.set(bxo, 0, bzo);
      group.add(pm);
      pc.mesh = pm;
      solid(pc.x, pc.z, pc.hx, pc.hz, pc.kind);
      const sEntry = ch.solids[ch.solids.length - 1];
      if (pc.obox) sEntry.box = { x: pc.x, z: pc.z, ...pc.obox };
      sEntry.playPiece = pc;
      pc.solid = sEntry;
    }
    prop('bench', bxo + PW / 2 - 4, bzo - PD / 2 + 3, 0, lotSurfaceY + 0.15);
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
  } else if (type === 'factory') {
    // An industrial plant on a block of its own (see buildFactoryMesh in js/factory.js): one of four layouts from the
    // reference art, picked at random per block. Its solids come back in world coordinates.
    const lotSurfaceY = 0.25;
    padBox(52, 46, mat(0x6f747c), bxo - bx, bzo - bz);
    const kind = FACTORY_KINDS[Math.floor(rng() * FACTORY_KINDS.length)];
    const P = buildFactoryMesh(bxo, bzo, rng, kind);
    ch.factory = kind; ch.factorySolids = P.solids;       // the layout, and its solids (for the checks)
    ch.stacks = P.stacks;                                 // chimney tops: smoke comes out of them (js/chimneySmoke.js)
    P.group.position.set(bxo, 0, bzo);
    bake(ch, P.group);                                    // merged with the rest of the block, in slices
    for (const sv of P.solids) solid(sv.x, sv.z, sv.hx, sv.hz, sv.kind);
    for (const sx of [-1, 1]) tree(bxo + sx * 22, bzo + 21, lotSurfaceY + 0.02);
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
  // Utility poles. A line of poles stands on a pavement 20 m either side of the block's middle, 29.5 m out from its
  // centre (the paving band is 27.4 to 31.5 m). Two kinds of line:
  //  - a utility neighbourhood (utilityNbhd) has a line on all four of its sides, and it ends at the neighbourhood's edge;
  //  - the avenue (x = 0) and the cross street (z = 0) carry a line on the pavement facing them, in every block beside
  //    them, so the line runs on through the whole city along each main road.
  // Wires run between poles 40 m apart: inside the block, and across the boundary on to the next block's first pole.
  const nbLines = !!nbPlan && utilityNbhd(nbRX, nbRZ);
  const avS = cx === 0 ? -1 : cx === -1 ? 1 : 0;    // the side of this block that faces the avenue (x = 0)
  const crS = cz === 0 ? -1 : cz === -1 ? 1 : 0;    // the side that faces the cross street (z = 0)
  const zSides = nbLines ? [-1, 1] : avS ? [avS] : [];   // x-side pavements: their line runs along z
  const xSides = nbLines ? [-1, 1] : crS ? [crS] : [];   // z-side pavements: their line runs along x
  const utility = zSides.length > 0 || xSides.length > 0;
  if (utility) {
    const ix = cx - nbRX * NB_BLOCKS, iz = cz - nbRZ * NB_BLOCKS;
    const zCross = nbLines ? iz + 1 < NB_BLOCKS : true;   // the avenue runs on through every block; a neighbourhood does not
    const xCross = nbLines ? ix + 1 < NB_BLOCKS : true;
    const wireMat = mat(0x1b1b1b);
    const utilityLine = (p0, p1, along) => {               // p0, p1: [x, z] of two poles; four wires sag between them
      const SAG = 0.45, Y0 = 0.33;
      for (const yy of [8.0, 7.2]) for (const lat of [-1.1, 1.1]) {
        const pts = [];
        for (let k = 0; k <= 6; k++) {
          const t = k / 6;
          pts.push([p0[0] + (p1[0] - p0[0]) * t + (along === 'x' ? 0 : lat), Y0 + yy - 4 * SAG * t * (1 - t), p0[1] + (p1[1] - p0[1]) * t + (along === 'x' ? lat : 0)]);
        }
        for (let k = 1; k < pts.length; k++) {
          const [x0, y0, z0] = pts[k - 1], [x1, y1, z1] = pts[k];
          const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
          const seg = along === 'z' ? box(0.05, 0.05, L, wireMat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, false)
                                    : box(L, 0.05, 0.05, wireMat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, false);
          if (along === 'z') seg.rotation.x = -Math.atan2(y1 - y0, z1 - z0); else seg.rotation.z = Math.atan2(y1 - y0, x1 - x0);
          add(seg);
        }
      }
    };
    for (const s of zSides) {
      const px = bx + s * 29.5;
      prop('utilitypole', px, bz - 20, 0, 0.15); prop('utilitypole', px, bz + 20, 0, 0.15);
      utilityLine([px, bz - 20], [px, bz + 20], 'z');
      if (zCross) utilityLine([px, bz + 20], [px, bz + 60], 'z');   // on to the next block's first pole
    }
    for (const s of xSides) {
      const pz = bz + s * 29.5;
      prop('utilitypole', bx - 20, pz, PI / 2, 0.15); prop('utilitypole', bx + 20, pz, PI / 2, 0.15);
      utilityLine([bx - 20, pz], [bx + 20, pz], 'x');
      if (xCross) utilityLine([bx + 20, pz], [bx + 60, pz], 'x');
    }
  }
  // Streetlights
  for (const s of [-1, 1]) for (const o of [-16, 16]) {
    const kx = kerbIn(s < 0 ? 0 : 1), kz = kerbIn(s < 0 ? 2 : 3);      // the kerb on the side the prop is on
    // ... and none of them where a flyover has opened the corner: a light left there would stand in the mouth
    // the cut made rather than on the pavement the cut leaves.
    const lampA = [bx + s * (CHUNK / 2 - kx - 1.35), bz + o], lampB = [bx + o, bz + s * (CHUNK / 2 - kz - 1.35)];
    const lampRoll = rng() < 0.8;                                 // drawn either way, so the rest of the block is unchanged
    if (lampRoll && !nbLines && s !== avS && cutClear(lampA[0], lampA[1], 1.2) && !closed[s < 0 ? 0 : 1]) prop('streetlight', lampA[0], lampA[1], 0);
    if (lampRoll && !nbLines && s !== crS && cutClear(lampB[0], lampB[1], 1.2) && !closed[s < 0 ? 2 : 3]) prop('streetlight', lampB[0], lampB[1], 0);
    if (rng() < 0.45 && !closed[s < 0 ? 0 : 1] && cutClear(bx + s * (CHUNK / 2 - kx - 1.15), bz - o * 0.45, 1.0)) prop('hydrant', bx + s * (CHUNK / 2 - kx - 1.15), bz - o * 0.45, 0, 0.15);
    if (rng() < 0.45 && !closed[s < 0 ? 2 : 3] && cutClear(bx - o * 0.45, bz + s * (CHUNK / 2 - kz - 1.15), 1.0)) prop('hydrant', bx - o * 0.45, bz + s * (CHUNK / 2 - kz - 1.15), 0, 0.15);
  }
  if (!safe) {
    // Bus stops — occasional, on the sidewalk; reserves a clear zone so no car parks in front of it
    const busReserved = [];
    for (const side of [0, 1, 2, 3]) {
      if (rng() > 0.07 || closed[side]) continue;
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
      if (atGradeSide(cx, cz, side) || closed[side]) continue;   // no kerbside parking on a closed street either
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
      if (closed[side] || !cutClear(cx, cz, 1.0)) continue;      // never in the mouth a cut corner opened, nor on a closed street
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
    // Pickups (cash lines, repair kits, nitro canisters); none inside a construction site (its frame or crane base)
    const inSite = (x, z, pad) => {
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const b of siteSpots(cx + i, cz + j)) if (Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad) return true;
      }
      return false;
    };
    const nLines = rng() < 0.55 ? 1 : 0, extra = rng() < 0.2 ? 1 : 0;
    for (let n = 0; n < nLines + extra; n++) {
      const vert = rng() < 0.5, lane = (rng() < 0.5 ? -1 : 1) * 4, start = r(20, 45);
      const kr = rng();
      if (kr < 0.3) {
        const px = vert ? x0 + lane : x0 + start, pz = vert ? z0 + start : z0 + lane;
        if (!insideFootprint(px, pz, 1.5) && !inSite(px, pz, 1.5)) addPickup(ch, kr < 0.12 ? 'repair' : 'nitro', px, pz);
        continue;
      }
      for (let i = 0; i < 5; i++) {
        const px = vert ? x0 + lane : x0 + start + i * 4, pz = vert ? z0 + start + i * 4 : z0 + lane;
        if (!insideFootprint(px, pz, 1.5) && !inSite(px, pz, 1.5)) addPickup(ch, 'cash', px, pz);            // never inside the embankment
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
      if (closed[swi]) continue;
      const along = (s.along === 'z' ? cz : cx) * CHUNK + 16 + rng() * (CHUNK - 32);
      const d = kerbIn(swi) + (rng() < 0.55 ? 1.15 : 2.1);      // just behind the kerb of its own side
      const x = s.along === 'z' ? bx + s.fixed * (CHUNK / 2 - d) : along;
      const z = s.along === 'z' ? along : bz + s.fixed * (CHUNK / 2 - d);
      if (occupied(x, z, 1.1) || !cutClear(x, z, 1.0)) continue;
      const kind = rng() < 0.36 ? 'mailbox' : rng() < 0.62 ? 'meter' : 'sandwich';
      prop(kind, x, z, Math.atan2(s.along === 'z' ? s.fixed : 0, s.along === 'z' ? 0 : s.fixed), 0);
    }
  }
  // ---- Back-alley dumpsters: a downtown or commercial block has a bin or two in the gaps behind its buildings. A spot
  // is taken only if the building clearance test says it is free and it stands off the paving and the lanes.
  if (type === 'downtown' || type === 'commercial') {
    for (let k = 0; k < 2; k++) {
      if (rng() < (k ? 0.7 : 0.4)) continue;
      for (let t = 0; t < 14; t++) {
        const x = bx + r(-24, 24), z = bz + r(-24, 24);
        if (occupied(x, z, 2.6) || !cutClear(x, z, 1.8)) continue;
        prop('dumpster', x, z, rng() * PI, 0.2);
        break;
      }
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
        if (Math.abs(a - (edge0 + CHUNK / 2)) < 4) continue;      // and a driveway gap in the middle of every side, so the yards can be reached
        const x = s.along === 'z' ? bx + s.fixed * (CHUNK / 2 - d) : a;
        const z = s.along === 'z' ? a : bz + s.fixed * (CHUNK / 2 - d);
        if (yardGap(x, z, s.along === 'z')) continue;             // a house's own entrance from the street
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
export { flushChunk, chunks, nearChunks, plazaIn, solidAt, solidsNear, PAVE_IN, PAVE_OUT, FACTORY_SHARE, PAD_IN, siteSpots, warmTextCache, buildFlyoverNoseGuard, utilityNbhd, nbhdPlan };
