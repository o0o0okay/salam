/* Interchange furniture: nose guards, delineators, nameboards, billboards, the gantry and the plaza island.
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import * as THREE from 'three';
import { mat } from './assets.js';
import { box } from './assets.js';
import { cyl } from './assets.js';
import { textGeometry } from "./campus.js";
import { FUEL_BRANDS } from "./campus.js";
import { textBlocks } from "./campus.js";
import { SHOP_TYPES } from './shops.js';
import { PARADE_TITLES } from './shops.js';

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
export function buildFlyoverDelineator() {
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
export function buildFlyoverNameboard() {
  const g = new THREE.Group(), cream = mat(0xf2e9d8), blue = mat(0x1d6b3f), steel = mat(0x8f959b);   // green highway plate
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
export function buildFlyoverBillboard() {
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
// Highway sign gantry, drawn the way a US interstate gantry is: a galvanised column on the parapet, a lattice
// (truss) cantilever reaching in over the carriageway, and a green panel with white lettering hung under the
// truss, a white border round it, a straight-ahead arrow on the outer end and a route shield on the inner end.
// Each of the four quarters of a bridge reads a different sign (`variant`), so the approaches are not
// identical. `legV` is the parapet's own centre line (how far the leg and the beam's root stand from the road's
// centre line) and `dir` is the way, in this local frame, that the centre line lies: the truss and the panel
// reach from the leg in by `dir`, so one block builds the half over its own side of the road and the two halves
// meet over the middle, leaving a gap of about 1 m on the centre line.
// Local heights are measured from the coping's top (0) upwards. The panel's bottom edge is at 2.42 m and its top
// at 4.42 m, and it hangs 0.04 m under the lower chord (4.46 m), so nothing pokes through the truss.
export const FLY_SIGN_TEXT = [
  { top: 'TO', main: 'DOWNTOWN', shield: '5' },
  { top: 'TO', main: 'CENTRAL', shield: '25' },
  { top: 'EXIT 12', main: 'AIRPORT', shield: null },
  { top: 'NORTH', main: 'HARBOUR', shield: '405' },
];
export function buildFlyoverGantry(legV, dir, variant = 0) {
  const g = new THREE.Group();
  const green = mat(0x1d6b3f), white = mat(0xf7f7f2), blue = mat(0x1b4f9c), steel = mat(0x8a9096), dark = mat(0x4c525a);
  const T = FLY_SIGN_TEXT[((variant % FLY_SIGN_TEXT.length) + FLY_SIGN_TEXT.length) % FLY_SIGN_TEXT.length];
  // column: four corner posts on a base plate, tied together every metre or so
  g.add(box(0.44, 0.14, 0.44, steel, 0, 0.07, 0, false));                  // base plate, on the coping
  for (const x of [-0.15, 0.15]) for (const z of [-0.15, 0.15]) g.add(box(0.1, 4.32, 0.1, steel, x, 2.30, z, false));
  for (const y of [0.9, 1.9, 2.9, 3.9]) {
    for (const z of [-0.15, 0.15]) g.add(box(0.3, 0.07, 0.07, steel, 0, y, z, false));
    for (const x of [-0.15, 0.15]) g.add(box(0.07, 0.07, 0.3, steel, x, y, 0, false));
  }
  // truss cantilever: two chords per side with a zig-zag of web members, from the leg in to the centre line
  const lowY = 4.54, upY = 5.14, n = 8, seg = legV / n;
  for (const z of [-0.2, 0.2]) {
    g.add(box(legV, 0.16, 0.12, steel, dir * legV / 2, lowY, z, false));   // lower chord (underside 4.46)
    g.add(box(legV, 0.14, 0.12, steel, dir * legV / 2, upY, z, false));    // upper chord
    for (let i = 0; i <= n; i++) g.add(box(0.08, upY - lowY, 0.08, steel, dir * i * seg, (lowY + upY) / 2, z, false));
    for (let i = 0; i < n; i++) {
      const x0 = dir * i * seg, x1 = dir * (i + 1) * seg, dy = (upY - lowY) * (i % 2 ? -1 : 1);
      const len = Math.hypot(x1 - x0, dy);
      const web = box(len, 0.1, 0.1, steel, (x0 + x1) / 2, (lowY + upY) / 2, z, false);
      web.rotation.z = Math.atan2(dy, x1 - x0);
      g.add(web);
    }
  }
  // the panel: white border, green field on both faces, hung from the lower chord by two brackets
  const C = 3.85, X = o => dir * (C - o);     // panel centre at C from the leg; +o runs outward, to the parapet
  g.add(box(6.9, 2.0, 0.14, white, X(0), 3.42, 0, false));                 // border (centred)
  g.add(box(6.6, 1.8, 0.26, green, X(0), 3.42, 0.18, false));              // field, street side
  g.add(box(6.6, 1.8, 0.26, green, X(0), 3.42, -0.18, false));             // field, back side
  for (const o of [-2.0, 2.0]) g.add(box(0.12, 0.12, 0.3, dark, X(o), 4.5, 0, false));
  // lettering: a small top line and a large main line, lettered on both faces (the back is mirrored)
  const tops = textBlocks(T.top, white, 0.36, 0.08, 0.22); tops.position.set(X(0), 3.88, 0.33); g.add(tops);
  const main = textBlocks(T.main, white, 0.62, 0.08, 0.2); main.position.set(X(0), 3.2, 0.33); g.add(main);
  const tops2 = textBlocks(T.top, white, 0.36, 0.08, 0.22, true); tops2.position.set(X(0), 3.88, -0.33); g.add(tops2);
  const main2 = textBlocks(T.main, white, 0.62, 0.08, 0.2, true); main2.position.set(X(0), 3.2, -0.33); g.add(main2);
  // straight-ahead arrow on the outer end: a shaft with a chevron head (the same on both faces)
  for (const z of [0.34, -0.34]) {
    g.add(box(0.16, 0.56, 0.06, white, X(2.6), 3.14, z, false));
    const armL = box(0.12, 0.42, 0.06, white, X(2.6) - 0.11, 3.82, z, false); armL.rotation.z = 0.6; g.add(armL);
    const armR = box(0.12, 0.42, 0.06, white, X(2.6) + 0.11, 3.82, z, false); armR.rotation.z = -0.6; g.add(armR);
  }
  // route shield on the inner end (when the sign has one): a white-edged blue shield with its number
  if (T.shield) {
    for (const side of [1, -1]) {
      const zz = side * 0.34, zf = side * 0.37, zt = side * 0.41;
      g.add(box(1.0, 1.0, 0.06, white, X(-2.6), 3.42, zz, false));
      g.add(box(0.84, 0.84, 0.06, blue, X(-2.6), 3.42, zf, false));
      const num = textBlocks(T.shield, white, 0.44, 0.06, 0.08, side < 0); num.position.set(X(-2.6), 3.42, zt); g.add(num);
    }
  }
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
export function buildPlazaIsland(radius) {
  const g = new THREE.Group();
  const concrete = mat(0xd4cfc4), grass = mat(0x3a7a2a);
  // The curb: a concrete disc, 0.3 m tall. Low enough that a car can drive over it — it's a speed bump,
  // not a wall. Cars that don't want to hit the central feature just go around.
  g.add(cyl(radius, radius, 0.3, 24, concrete, 0, 0.15, 0, false));
  // Grass: a slightly smaller disc on top of the curb, so the curb's rim stays bare concrete all round.
  g.add(cyl(radius - 0.35, radius - 0.35, 0.34, 24, grass, 0, 0.17, 0, false));
  return g;
}
