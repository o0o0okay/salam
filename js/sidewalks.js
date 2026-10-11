/* Sidewalk rings: kerb, paving, border course, tree-pit beds and the sidewalk styles.
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK } from './utils.js';
import { PI } from './utils.js';
import { mat } from './assets.js';
import { STORE_KINDS } from "./campus.js";
import { SPORT_KINDS } from "./sports.js";
import { FLY } from './flyover.js';
import { atGradeSide } from './flyover.js';
import { roadEdge } from './flyover.js';
import { bridgeAt } from './flyover.js';
import { besideFlyover } from './flyover.js';

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
export const CURB_H = 0.16, WALK_Y = 0.18;  // kerb height above the road, top of the paving
export const BORDER_W = 1.3, KERB_W = 0.35;
export const BED = 0.85, BED_EDGE = 0.15;   // tree-pit soil bed (half size) and the width of its kerb edging
export const PIT_IN = 9.9;                  // distance from the road centre line to the centre of a tree pit
// Share of ordinary (non-lane, non-campus) blocks that become an industrial plant (buildFactoryMesh).
export const FACTORY_SHARE = 0.08;
export const PAD_IN = PAVE_OUT - 0.6;   // where a block's own ground cover (lot, grass, concrete pad) stops:
                                     // the buildings of a block stand on the outer 0.6 m of the paving's border
                                     // course, and beside an at-grade lane the whole line moves out by FLY.frontage
export const CURB_TILE = 1, PAVE_TILE = 4.8, BORDER_TILE = 2.6;
// `dy` lifts two of the four strips by 2 mm: neighbouring strips overlap at the block corners, and this
// decides the winner there without any visible step (same material, same pattern).
export const SIDEWALK_SIDES = [
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
export const SW_STYLES = {
  slab:  { mat: 'pavingMat',    tile: 4.8, verge: 0,   bed: true },
  panel: { mat: 'pavePanelMat', tile: 4.8, verge: 0,   bed: true },
  brick: { mat: 'paveBrickMat', tile: 2.4, verge: 0,   bed: true },
  verge: { mat: 'pavePanelMat', tile: 4.8, verge: 1.7, bed: false },
};
export function pickSidewalkStyle(type, rng) {
  if (type === 'suburb') return 'verge';                                  // grass verge, suburban walk
  if (type === 'industrial') return 'panel';                              // big weathered concrete panels
  if (type === 'factory') return 'panel';                                 // a works yard is plain concrete
  if (type === 'downtown') return rng() < 0.45 ? 'panel' : 'slab';        // modern vs classic stone
  if (type === 'commercial') return rng() < 0.55 ? 'brick' : 'slab';      // shopping streets lean brick
  if (type === 'hospital') return rng() < 0.6 ? 'panel' : 'slab';         // clean concrete panels by the campus
  if (type === 'fire') return 'panel';                                    // a fire station apron is plain concrete
  if (type === 'fuel') return 'panel';                                    // a forecourt is plain concrete too
  if (type === 'shops') return rng() < 0.5 ? 'brick' : 'slab';           // a shopping street gets brick or stone
  if (type === 'school') return rng() < 0.55 ? 'slab' : 'panel';      // a school frontage is plain paved stone
  if (type === 'bank' || STORE_KINDS.includes(type) || SPORT_KINDS.includes(type)) return 'slab';     // a bank or shop forecourt is pale stone, like its steps
  return rng() < 0.5 ? 'slab' : 'panel';                                  // parks mix the two paved styles
}
// Empty box lists for one chunk's sidewalk ring. Each entry is then merged into a single mesh per material.
// How far a pavement strip stops short of the junction at one of its ends, and how much further the cut corner
// takes off it. `(ix, iz)` is the neighbouring block that shares that junction, `si` the side the strip runs on.
// The pavement uses this, and so does everything planted along it — trees, hedges, lights, hydrants — so a prop
// and the paving it stands on always start from one and the same answer.
export function stripStops(ix, iz, cx, cz, si) {
  const lane = atGradeSide(cx, cz, si);
  const onLaneRoad = (ix === 0 && (atGradeSide(cx, cz, 0) || atGradeSide(cx, cz, 1)))
    || (iz === 0 && (atGradeSide(cx, cz, 2) || atGradeSide(cx, cz, 3)));
  const stop = (!lane && (bridgeAt(ix, iz) || onLaneRoad)) ? roadEdge() : PAVE_IN;
  return { stop, cut: besideFlyover(ix, iz) ? FLY.chamfer : 0 };
}
export function sidewalkPieces(cx, cz, style, filled = []) {
  const bx = cx * CHUNK + 40, bz = cz * CHUNK + 40, E = CHUNK / 2, PH = CURB_H + 0.04;
  const x0 = bx - E, z0 = bz - E;                       // the block's own corners, for the chamfered ones
  const st = SW_STYLES[style] || SW_STYLES.slab;
  const out = { bx, bz, style, st, curb: [], walk: [], grass: [], border: [], kerb: [], bed: [], bedEdge: [] };
  for (let si = 0; si < SIDEWALK_SIDES.length; si++) {
    const s = SIDEWALK_SIDES[si];
    // A side on a filled street has no walkway and no kerb: the grass fill there runs out to the next block's pad.
    if (filled[si]) continue;
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
export function treePit(pieces, s, radial, along) {
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
export function bakeRing(list, material, tile, cast, ch) {
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
