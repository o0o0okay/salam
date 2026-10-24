/* Professional harbor / port — multi-block quay on the coast.
 * The port is a 3×2 block complex anchored on the coast:
 *   [quay | yard | warehouse] along inland direction,
 *   3 blocks long along the coast (center ±1).
 * Each sub-block draws its own part, but the whole reads as one port.
 */
import * as THREE from 'three';
import { CHUNK, hash2 } from './utils.js';
import { mat, box, cyl } from './assets.js';
import { ISLAND_R, ISLAND_MIN, ISLAND_MAX } from './island.js';
import { FLY } from './flyover.js';

// spacing along coast between potential harbors (≈ 960 m)
const HARBOR_SPACING = 12;
const HARBOR_CHANCE = 0.52; // ~ half of the slots become a real port

// Precomputed anchor list: single harbor for the whole city
let HARBOR_ANCHORS = null;
function buildAnchors() {
  if (HARBOR_ANCHORS) return HARBOR_ANCHORS;
  HARBOR_ANCHORS = [];
  HARBOR_ANCHORS.push({ cx: -ISLAND_R, cz: 4, side: 'west', dirX: 1, dirZ: 0, ax: 'west' });
  return HARBOR_ANCHORS;
  const sides = [
    { side: 'west', cx: -ISLAND_R, czVar: true, dirX: 1, dirZ: 0, ax: 'west' },
    { side: 'east', cx: ISLAND_R - 1, czVar: true, dirX: -1, dirZ: 0, ax: 'east' },
    { side: 'south', cz: -ISLAND_R, cxVar: true, dirX: 0, dirZ: 1, ax: 'south' },
    { side: 'north', cz: ISLAND_R - 1, cxVar: true, dirX: 0, dirZ: -1, ax: 'north' },
  ];
  for (const s of sides) {
    for (let a = -20; a <= 20; a += HARBOR_SPACING) {
      let acx, acz;
      if (s.czVar) { acx = s.cx; acz = a; }
      else { acx = a; acz = s.cz; }
      const h = hash2(acx * 11 + 7, acz * 17 + 13) / 4294967296;
      if (h > HARBOR_CHANCE) continue;
      if (Math.abs(acx) < 4 && Math.abs(acz) < 4) continue;
      HARBOR_ANCHORS.push({ cx: acx, cz: acz, side: s.side, dirX: s.dirX, dirZ: s.dirZ, ax: s.ax });
    }
  }
  return HARBOR_ANCHORS;
}

// Returns harbor info for this block, or null if not part of any harbor.
// Info: { side, inland: 0=quay,1=yard,2=warehouse, along: -1|0|1, anchor, dirX, dirZ }
export function harborInfo(cx, cz) {
  const anchors = buildAnchors();
  for (const an of anchors) {
    // Harbor footprint: 1 block quay (at coast) + 2 inland blocks deep, 3 blocks long along coast
    // For west/east: along = z, inland = x
    // For north/south: along = x, inland = z
    let inland, along;
    if (an.side === 'west') { inland = cx - an.cx; along = cz - an.cz; }
    else if (an.side === 'east') { inland = an.cx - cx; along = an.cz - cz; }
    else if (an.side === 'south') { inland = cz - an.cz; along = cx - an.cx; }
    else { inland = an.cz - cz; along = an.cx - cx; }
    if (inland < 0 || inland > 2) continue;
    if (Math.abs(along) > 1) continue;
    // also allow the “sea” block just outside island for ship placement? Not a chunk, so ignore.
    return { side: an.side, inland, along, anchor: an, dirX: an.dirX, dirZ: an.dirZ, ax: an.ax };
  }
  return null;
}

export function isHarborBlock(cx, cz) { return !!harborInfo(cx, cz); }

// --- helpers ---
const CONTAINER_COLORS = [0xd64545, 0x3a7bd5, 0xf2c230, 0x2e7d6b, 0xe8e8e8, 0x8e44ad, 0xe67e22, 0x2ecc71];
const QUAY_MAT = mat(0x8e8a80), QUAY_DARK = mat(0x6b6860), BOLLARD_MAT = mat(0x3c434b), FENDER_MAT = mat(0x1a1a1a);
const CRANE_YELLOW = mat(0xf2a90e), CRANE_ORANGE = mat(0xe67e22), CRANE_GREY = mat(0x8a8d93), CRANE_BLUE = mat(0x2d5a7a);
const WATER_MAT = mat(0x2d7a9c), WATER_DARK = mat(0x1e5a7a);

function containerBox(g, x, y, z, w, h, d, color) {
  const m = box(w, h, d, mat(color), x, y + h / 2, z);
  // small corrugation lines via emissive? keep simple
  g.add(m);
  return m;
}

// Build a stack of containers: 1-3 high, 1-2 deep, with slight random colors
function containerStack(g, cx, cz, rnx, rng, rows = 2, cols = 3, maxH = 3) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = 1 + Math.floor(rng() * maxH); // 1-3 high
      const x = cx + (c - (cols - 1) / 2) * 6.4 + (rng() - 0.5) * 0.4;
      const z = cz + (r - (rows - 1) / 2) * 2.8 + (rng() - 0.5) * 0.3;
      for (let k = 0; k < h; k++) {
        const col = CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)];
        containerBox(g, x, 0.25 + k * 2.55, z, 6.0, 2.5, 2.4, col);
        if (rng() < 0.15) {
          // door detail
          const door = box(0.12, 1.8, 1.4, mat(0x222222), x + 2.95, 0.25 + k * 2.55 + 1.0, z, false);
          g.add(door);
        }
      }
    }
  }
}

// Gantry crane: spans the quay, legs on both sides, top beam, trolley
function gantryCrane(g, x, z, alongLen, side) {
  const W = 18, H = 16, D = alongLen; // span across quay
  // Two legs (A-frame style like images) — simplified to 4 pillars
  const legH = H, legW = 0.7;
  // legs sit at (±W/2, ±D/2)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = x + sx * W / 2, lz = z + sz * D / 2;
    const leg = box(legW, legH, legW, CRANE_YELLOW, lx, legH / 2 + 0.25, lz);
    g.add(leg);
    // diagonal brace
    const brace = box(0.45, Math.hypot(W, H * 0.6), 0.45, CRANE_YELLOW, lx - sx * W * 0.12, legH * 0.55, lz);
    brace.rotation.z = sx * 0.38;
    g.add(brace);
  }
  // top beams along D (two parallel)
  for (const sx of [-1, 1]) {
    const y = H + 0.25;
    const beam = box(0.6, 0.7, D + 1.2, CRANE_YELLOW, x + sx * W * 0.18, y, z);
    g.add(beam);
  }
  // cross beam spanning W at each end
  for (const sz of [-1, 1]) {
    const cross = box(W + 0.6, 0.55, 0.55, CRANE_YELLOW, x, H + 0.25, z + sz * D / 2);
    g.add(cross);
  }
  // trolley hanging from top beam
  const trolleyX = x + (Math.random() - 0.5) * W * 0.4;
  const trolley = box(2.2, 0.9, 1.8, CRANE_BLUE, trolleyX, H - 0.1, z, false);
  g.add(trolley);
  // cables + spreader
  const cableLen = H - 3.5;
  for (const dx of [-0.8, 0.8]) {
    const cable = cyl(0.06, 0.06, cableLen, 6, mat(0x1a1a1a), trolleyX + dx, H - 0.1 - cableLen / 2, z, false);
    g.add(cable);
  }
  const spreader = box(2.0, 0.18, 5.2, mat(0x111111), trolleyX, 3.8, z, false);
  g.add(spreader);
  // base rails (along quay)
  for (const sx of [-1, 1]) {
    const rail = box(D + 4, 0.15, 0.35, mat(0x4a4a4a), x + sx * W / 2, 0.32, z, false);
    g.add(rail);
  }
  return { x, z, w: W, d: D };
}

// Small RMG (rubber-tired gantry) for yard blocks — lower, spans containers
function yardCrane(g, x, z) {
  const W = 14, H = 9, D = 10;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = x + sx * W / 2, lz = z + sz * D / 2;
    g.add(box(0.5, H, 0.5, CRANE_YELLOW, lx, H / 2 + 0.25, lz));
  }
  g.add(box(W + 0.5, 0.45, 0.5, CRANE_YELLOW, x, H + 0.25, z + D / 2));
  g.add(box(W + 0.5, 0.45, 0.5, CRANE_YELLOW, x, H + 0.25, z - D / 2));
  g.add(box(0.5, 0.45, D, CRANE_YELLOW, x - W / 2, H + 0.25, z));
  g.add(box(0.5, 0.45, D, CRANE_YELLOW, x + W / 2, H + 0.25, z));
  g.add(box(1.8, 0.7, 1.2, CRANE_BLUE, x, H - 0.4, z, false));
  return { x, z };
}

// Ship: low-poly container ship moored alongside quay
function containerShip(g, x, z, len, beam, heading) {
  const hullH = 3.2, deckH = hullH + 0.5;
  // hull — bottom red, top grey
  const hullBottom = box(len, 1.2, beam, mat(0xb0302a), x, 0.35, z);
  hullBottom.rotation.y = heading; g.add(hullBottom);
  const hullTop = box(len * 0.98, 2.0, beam * 0.96, mat(0xcbd2d8), x, 1.55, z);
  hullTop.rotation.y = heading; g.add(hullTop);
  // bow taper (simplified to box)
  const bow = box(4, 2.0, beam * 0.85, mat(0xcbd2d8), x + Math.cos(heading) * len * 0.45, 1.55, z + Math.sin(heading) * len * 0.45, false);
  bow.rotation.y = heading; g.add(bow);
  // bridge / accommodation aft
  const bridge = box(8, 4.5, beam * 0.78, mat(0xe9eef2), x - Math.cos(heading) * len * 0.38, deckH + 2.0, z - Math.sin(heading) * len * 0.38, false);
  bridge.rotation.y = heading; g.add(bridge);
  const funnel = cyl(1.0, 1.2, 2.8, 8, mat(0x222222), x - Math.cos(heading) * len * 0.38, deckH + 4.2, z - Math.sin(heading) * len * 0.38, false);
  funnel.rotation.y = heading; g.add(funnel);
  // containers on deck: grid along length
  const rows = Math.floor(len / 6.5);
  const cols = Math.floor(beam / 2.6) - 1;
  for (let r = 0; r < rows; r++) {
    const along = -len * 0.32 + r * 6.2 + 3;
    for (let c = 0; c < cols; c++) {
      const across = (c - (cols - 1) / 2) * 2.6;
      // stack 1-3 high randomly but keep ship profile low
      const h = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < h; k++) {
        const cx2 = x + Math.cos(heading) * along - Math.sin(heading) * across;
        const cz2 = z + Math.sin(heading) * along + Math.cos(heading) * across;
        const col = CONTAINER_COLORS[Math.floor(Math.random() * CONTAINER_COLORS.length)];
        const b = box(5.8, 2.4, 2.4, mat(col), cx2, deckH + 0.6 + k * 2.45, cz2, false);
        b.rotation.y = heading;
        g.add(b);
      }
    }
  }
  return { x, z, len, beam };
}

// --- Block builders ---

export function buildHarborQuay({ bx, bz, bxo, bzo, ch, rng, solid, add, padBox }) {
  // Quay block: concrete quay top, bollards, fenders, 2 gantry cranes, ship in sea
  const info = harborInfo(ch.cx, ch.cz);
  const side = info ? info.side : 'west';
  // large quay paving
  padBox(76, 76, mat(0x9ea0a3), bxo - (ch.cx * CHUNK + 40 - bxo), bzo - (ch.cz * CHUNK + 40 - bzo));
  // extra quay apron near water
  const quayMat = mat(0x8e9196);
  // Determine quay edge position (world)
  let quayEdgeX = bxo, quayEdgeZ = bzo, shipX, shipZ, shipH;
  const half = CHUNK / 2 - 4;
  if (side === 'west') {
    quayEdgeX = ch.cx * CHUNK + 2; // west edge of island
    // quay wall 2m thick
    add(box(2.2, 1.6, 78, QUAY_MAT, quayEdgeX + 1.1, 0.85, bzo));
    solid(quayEdgeX + 1.1, bzo, 1.1, 39, 'building');
    // bollards every 10m
    for (let z = -half; z <= half; z += 10) add(cyl(0.22, 0.22, 0.55, 6, BOLLARD_MAT, quayEdgeX + 0.6, 1.05, bzo + z));
    // fenders (black rubber)
    for (let z = -half + 5; z <= half - 5; z += 12) add(box(0.5, 0.9, 0.9, FENDER_MAT, quayEdgeX + 0.35, 0.7, bzo + z, false));
    // cranes: 2 per quay block, spaced
    gantryCrane(ch.group, quayEdgeX + 12, bzo - 10, 28, side);
    gantryCrane(ch.group, quayEdgeX + 12, bzo + 14, 28, side);
    // ship moored just outside in sea (x = quayEdgeX - beam/2 - 1)
    shipX = quayEdgeX - 9; shipZ = bzo; shipH = 0;
    containerShip(ch.group, shipX, shipZ, 62, 11, 0);
    // water plane for radar
    ch.radarWater = (ch.radarWater || []).concat([[quayEdgeX - 22, bzo - 34, 22, 68, 'water']]);
  } else if (side === 'east') {
    quayEdgeX = (ch.cx + 1) * CHUNK - 2;
    add(box(2.2, 1.6, 78, QUAY_MAT, quayEdgeX - 1.1, 0.85, bzo));
    solid(quayEdgeX - 1.1, bzo, 1.1, 39, 'building');
    for (let z = -half; z <= half; z += 10) add(cyl(0.22, 0.22, 0.55, 6, BOLLARD_MAT, quayEdgeX - 0.6, 1.05, bzo + z));
    for (let z = -half + 5; z <= half - 5; z += 12) add(box(0.5, 0.9, 0.9, FENDER_MAT, quayEdgeX - 0.35, 0.7, bzo + z, false));
    gantryCrane(ch.group, quayEdgeX - 12, bzo - 10, 28, side);
    gantryCrane(ch.group, quayEdgeX - 12, bzo + 14, 28, side);
    shipX = quayEdgeX + 9; shipZ = bzo; shipH = Math.PI;
    containerShip(ch.group, shipX, shipZ, 62, 11, shipH);
    ch.radarWater = (ch.radarWater || []).concat([[quayEdgeX, bzo - 34, 22, 68, 'water']]);
  } else if (side === 'south') {
    quayEdgeZ = ch.cz * CHUNK + 2;
    add(box(78, 1.6, 2.2, QUAY_MAT, bxo, 0.85, quayEdgeZ + 1.1));
    solid(bxo, quayEdgeZ + 1.1, 39, 1.1, 'building');
    for (let x = -half; x <= half; x += 10) add(cyl(0.22, 0.22, 0.55, 6, BOLLARD_MAT, bxo + x, 1.05, quayEdgeZ + 0.6));
    for (let x = -half + 5; x <= half - 5; x += 12) add(box(0.9, 0.9, 0.5, FENDER_MAT, bxo + x, 0.7, quayEdgeZ + 0.35, false));
    gantryCrane(ch.group, bxo - 10, quayEdgeZ + 12, 28, side);
    gantryCrane(ch.group, bxo + 14, quayEdgeZ + 12, 28, side);
    shipX = bxo; shipZ = quayEdgeZ - 9; shipH = -Math.PI / 2;
    containerShip(ch.group, shipX, shipZ, 62, 11, shipH);
    ch.radarWater = (ch.radarWater || []).concat([[bxo - 34, quayEdgeZ - 22, 68, 22, 'water']]);
  } else { // north
    quayEdgeZ = (ch.cz + 1) * CHUNK - 2;
    add(box(78, 1.6, 2.2, QUAY_MAT, bxo, 0.85, quayEdgeZ - 1.1));
    solid(bxo, quayEdgeZ - 1.1, 39, 1.1, 'building');
    for (let x = -half; x <= half; x += 10) add(cyl(0.22, 0.22, 0.55, 6, BOLLARD_MAT, bxo + x, 1.05, quayEdgeZ - 0.6));
    for (let x = -half + 5; x <= half - 5; x += 12) add(box(0.9, 0.9, 0.5, FENDER_MAT, bxo + x, 0.7, quayEdgeZ - 0.35, false));
    gantryCrane(ch.group, bxo - 10, quayEdgeZ - 12, 28, side);
    gantryCrane(ch.group, bxo + 14, quayEdgeZ - 12, 28, side);
    shipX = bxo; shipZ = quayEdgeZ + 9; shipH = Math.PI / 2;
    containerShip(ch.group, shipX, shipZ, 62, 11, shipH);
    ch.radarWater = (ch.radarWater || []).concat([[bxo - 34, quayEdgeZ, 68, 22, 'water']]);
  }
  // container stacks on quay apron (behind cranes)
  const rng2 = rng; // use block rng for deterministic
  if (side === 'west') containerStack(ch.group, bxo + 14, bzo, 0, rng2, 1, 2, 2);
  else if (side === 'east') containerStack(ch.group, bxo - 14, bzo, 0, rng2, 1, 2, 2);
  else if (side === 'south') containerStack(ch.group, bxo, bzo + 14, 0, rng2, 2, 1, 2);
  else containerStack(ch.group, bxo, bzo - 14, 0, rng2, 2, 1, 2);

  // small markings on quay
  for (let i = -3; i <= 3; i++) {
    const mx = side === 'west' ? quayEdgeX + 5 : side === 'east' ? quayEdgeX - 5 : bxo + i * 11;
    const mz = side === 'south' ? quayEdgeZ + 5 : side === 'north' ? quayEdgeZ - 5 : bzo + i * 11;
    if (side === 'west' || side === 'east') add(box(0.18, 0.02, 6, mat(0xffe26a), mx + (side === 'west' ? 4 : -4), 0.26, mz, false));
    else add(box(6, 0.02, 0.18, mat(0xffe26a), mx, 0.26, mz + (side === 'south' ? 4 : -4), false));
  }
  // road marking along quay
  // keep solids minimal so cars can still drive on block's interior roads (but not into water)
}

export function buildHarborYard({ bx, bz, bxo, bzo, ch, rng, solid, add, padBox }) {
  // Container yard: dense stacks, yard cranes, truck lanes
  padBox(76, 76, mat(0x8a8d93), 0, 0);
  // asphalt
  add(box(72, 0.06, 72, mat(0x3a3d42), bxo, 0.26, bzo, false));
  // lane markings (yellow)
  for (let z = -30; z <= 30; z += 8) {
    add(box(12, 0.02, 0.18, mat(0xffe26a), bxo, 0.29, bzo + z, false));
  }
  // container stacks: 3 big blocks
  containerStack(ch.group, bxo - 16, bzo - 10, 0, rng, 3, 4, 3);
  containerStack(ch.group, bxo + 14, bzo + 12, 0, rng, 3, 3, 3);
  containerStack(ch.group, bxo, bzo - 22, 0, rng, 2, 2, 2);
  // yard cranes (RMG)
  yardCrane(ch.group, bxo - 10, bzo - 10);
  yardCrane(ch.group, bxo + 10, bzo + 12);
  // solids for stacks (simplified bounding boxes)
  solid(bxo - 16, bzo - 10, 13, 5, 'container');
  solid(bxo + 14, bzo + 12, 10, 4.5, 'container');
  solid(bxo, bzo - 22, 7, 3.5, 'container');
  // small office / reefer
  add(box(10, 3.5, 6, mat(0xd8dde3), bxo + 18, 2.0, bzo - 18, false));
  add(box(8, 2.8, 5, mat(0x2b8a5a), bxo - 20, 1.65, bzo + 20, false));
}

export function buildHarborWarehouse({ bx, bz, bxo, bzo, ch, rng, solid, add, padBox }) {
  // Warehouse / logistics zone: 2 large sheds, truck docks, parking
  padBox(76, 76, mat(0x9aa0a8), 0, 0);
  // sheds
  const shedMat = mat(0xc7cbd1), roofMat = mat(0x8a919a), doorMat = mat(0x3d4149);
  // shed A
  add(box(36, 6.5, 16, shedMat, bxo - 10, 3.5, bzo - 8));
  add(box(36.4, 0.5, 16.4, roofMat, bxo - 10, 6.9, bzo - 8));
  solid(bxo - 10, bzo - 8, 18, 8, 'building');
  for (let x = -26; x <= 6; x += 6) add(box(2.8, 3.2, 0.2, doorMat, bxo + x, 1.7, bzo, false));
  // shed B
  add(box(28, 5.8, 14, shedMat, bxo + 12, 3.15, bzo + 14));
  add(box(28.4, 0.5, 14.4, roofMat, bxo + 12, 6.2, bzo + 14));
  solid(bxo + 12, bzo + 14, 14, 7, 'building');
  // truck docks (yellow markings)
  for (let i = -2; i <= 2; i++) add(box(0.18, 0.02, 3.5, mat(0xffe26a), bxo - 10 + i * 6.8, 0.27, bzo + 1.2, false));
  // parked trucks
  const truckMat = mat(0x245a8a);
  for (let i = 0; i < 3; i++) {
    const tx = bxo - 10 + (i - 1) * 7.5, tz = bzo + 4.2;
    add(box(3.2, 2.4, 7.5, truckMat, tx, 1.45, tz));
    solid(tx, tz, 1.6, 3.8, 'container');
  }
  // rail spur (optional)
  add(box(36, 0.12, 1.0, mat(0x4a4a4a), bxo, 0.32, bzo + 28, false));
  add(box(36, 0.12, 1.0, mat(0x4a4a4a), bxo, 0.32, bzo + 26.5, false));
  // containers scattered
  containerStack(ch.group, bxo - 18, bzo + 22, 0, rng, 1, 2, 2);
  // small office
  add(box(8, 2.8, 8, mat(0xe8e8e8), bxo - 18, 1.65, bzo + 18, false));
}
