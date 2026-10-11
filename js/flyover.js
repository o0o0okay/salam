/* Grade-separated interchanges (flyovers) — the numbers, with no three.js in sight.
 *
 * The city's two main roads carry flyovers: the avenue (the street along x = 0) and the cross street (the one
 * along z = 0). At a flyover junction the main road no longer meets the street it crosses at a light: it climbs
 * an embankment, crosses the junction on a deck 7.2 m above the ground, and comes back down on the far side,
 * while the street underneath keeps running at grade — 6.2 m of clear headroom under the slab, so the bus and
 * the fire engine pass under it without ducking. The two roads are at different levels, so nothing turns
 * from one onto the other there — main-road traffic goes over, crossing traffic goes under, and that is what
 * "grade-separated" means.
 *
 * Flyovers are spaced out at random rather than on a beat: one to the next is 5, 6 or 7 junctions (400, 480 or
 * 560 m at the block size the city uses), 450 m on average, drawn from a hash of the index so that every module —
 * and every block, however far it streams in — computes exactly the same city. The pattern is mirrored about the
 * central crossing, so both directions of a road see the same spacing, and the junction the player starts at
 * stays a plain four-way.
 *
 * Beside the structure the street gains an at-grade lane (`atGrade`, 7.0 m: `roadEdge()` from the centre line),
 * because a road that only went up would leave the frontages with no way of their own — two lanes' worth of
 * carriageway on the ground, so a car can come and go *under* the bridge beside the embankment. Where that
 * extra width comes from matters: the building line steps back by `frontage` (4.4 m) on the sides that carry
 * the lane, so the lane takes it out of the frontage and the walkway behind the kerb keeps its width —
 * buildings a little further back rather than a pavement squeezed to nothing. The lane runs the whole length of the block it appears on *and
 * through the junction* (it is the way under the deck), which is why the pavement on the sides that do not carry
 * it stops at `roadEdge()` there instead of at the road edge.
 *
 * Why the maths lives here, away from js/world.js: the concrete in world.js, the physics in js/vehicle.js, the
 * parapets in js/collisions.js, the traffic AI in js/civilians.js and the lights in js/trafficLights.js all have
 * to agree about where a deck is and who is standing on it. One module with plain numbers means they cannot
 * drift apart, and the Node suites can check the surface profile without a browser (see run.mjs section 2c-3).
 */
import { CHUNK, hash2 } from './utils.js';

export const FLY = {
  span: CHUNK,      // streets sit on multiples of the block size
  minGap: 5,        // flyovers are never closer than this many junctions (400 m) apart on one road
  deckH: 7.2,       // driving surface of the deck: how far the crossing street passes below. It stands tall
                    // enough to read as a bridge from the street (6.2 m of headroom under the slab), and the ramps
                    // are long enough to reach it at a city flyover's grade
  deckHalf: 12,     // the deck spans the junction ± 12 m: 24 m of bridge over the 16 m street and its paving
  rampEnd: 57,      // the ramps meet the ground at junction ± 57 m, so each ramp runs 45 m and climbs 1 in 6.3
  halfW: 8.0,       // half the structure's width — the whole 16 m carriageway, kerb face to kerb face
  atGrade: 14.0,    // width of the at-grade street the roads gain beside the structure: a road that only went up
                    // would leave the frontages with no way of their own, so the kerb is set back this far and
                    // traffic that is not going over the bridge keeps a street of its own on the ground. It has
                    // been widened twice now, each time to twice what it was (2.6 m read as a shoulder, 3.5 m
                    // was one lane, 7.0 m carried two, and this is 14.0 m): the ground road beside the
                    // structure is a street in its own right, wide enough for traffic in both directions and a
                    // full boulevard opening at the ramps' feet
  frontage: 11.4,   // how far the building line steps back on the sides that carry that street. It takes its
                    // width out of the frontage rather than out of the pavement, so the walkway behind the kerb
                    // keeps the 1.5 m it has (kerb + walk = 2.0 m) and the buildings on those sides sit back
                    // from the wider road instead of being squeezed against it
  slab: 0.9,        // deck/ramp slab thickness (0.08 m of wearing course on top of it)
  parapet: 0.45,    // parapet thickness: |v| <= halfW - parapet is the drivable width up there
  slices: 10,       // the embankment's body is solid in this many slices along the ramp. Ten, not five: a slice
                    // tops out just below the ramp at its *own* downhill end, so a coarse staircase leaves a
                    // stretch near the ramp's foot where the ramp still stands metres up and the solid below
                    // it has run out of height — a car at grade could turn in under the deck there
  solidDrop: 1.2,   // each slice stops this far below the ramp surface at its own downhill end: more than the
                    // longest vehicle's half length times the slope, so a bus clears the slices it straddles
  on: 0.8,          // how far below a deck/ramp surface still counts as standing on it
  chamfer: 4.0,     // the junctions before and after a flyover open out where the street beside the structure
                    // meets them: their pavement corners are cut back on the diagonal by this much, measured
                    // from the road edge along each kerb. On a plain corner that is exactly the pavement's own
                    // depth, so the cut takes the whole corner paving back to the building line; beside the lane
                    // it opens that corner's mouth out the same way. The crossings there are marked with their
                    // stripes parallel to the cut
};
// The kerb face where a flyover's street is wider: the structure's own edge plus the at-grade lane beside it.
export const roadEdge = () => FLY.halfW + FLY.atGrade;
export const RAMP_RUN = FLY.rampEnd - FLY.deckHalf;   // 45 m of ramp
export const RAMP_SLOPE = FLY.deckH / RAMP_RUN;       // 1 in 6.3 — a city flyover's approach

// ---- the lattice ----
// Streets run along x = ix * span and along z = iz * span, so a junction is (ix * span, iz * span). `nodeAt`
// answers with the flyover on that junction, if it has one: a flyover sits on a *main* road (ix = 0 for the
// avenue, iz = 0 for the cross street).
//
// The spacing is random, not a beat: one flyover to the next is 5, 6 or 7 blocks (400, 480 or 560 m), drawn from
// a hash of the index. The sequence is fixed for a given index, so every module — and every block, however far
// it streams in — computes exactly the same city, and it is mirrored about the central crossing, so the two
// directions of a road see the same spacing. The junction the player starts at is never one of them, and neither
// is any junction within `minGap` of the centre.
const GAPS = [5, 6, 5, 7, 5, 6, 6, 5];                    // in blocks: the gaps are drawn from this table
const hash = n => {
  let h = (n | 0) * 2654435761 % 4294967296;
  h ^= h >>> 15; h = (h * 2246822519) % 4294967296; h ^= h >>> 13;
  return h >>> 0;
};
const nodeSeq = [0];                                      // distance of each flyover from the centre, in blocks
const nodeSet = new Set();                                // ... and the same, for fast lookup
function ensureNodes(blocks) {
  while (nodeSeq[nodeSeq.length - 1] < blocks) {
    const k = nodeSeq.length;                             // this is the k-th gap
    const gap = k === 1 ? 5 : GAPS[hash(k) % GAPS.length];   // the first one is always 400 m out
    nodeSeq.push(nodeSeq[k - 1] + gap);
    nodeSet.add(nodeSeq[nodeSeq.length - 1]);
  }
}
// The distance (in blocks) of the flyover at |block|, or 0 when that junction carries none.
export function nodeBlock(blocks) {
  if (blocks < FLY.minGap) return 0;
  ensureNodes(blocks);
  return nodeSet.has(blocks) ? blocks : 0;
}
// ---- Long bridges ----
// One flyover in three carries its deck across the next one or two junctions as well, so a long bridge covers 2 or
// 3 junctions. The bridge starts at the junction nearest the centre and runs outward. `ext` is how many blocks past
// its start the deck runs: 0 for an ordinary flyover, 1 or 2 for a long one. The junctions it passes over belong to
// the bridge: the avenue is up on the deck there, so their lights are off, and the street beside them is at grade
// exactly as it is beside the start. The next flyover is at least `minGap` blocks on, so one bridge never reaches
// the next. The extent is a hash of the block index, so every block computes the same bridges.
export const bridgeExt = b => {
  if (b < FLY.minGap) return 0;
  // About one bridge in three is long (hash2 with a fixed salt, so the layout is the same for everyone). The salt is
  // chosen so the long ones are spread through the first few junctions, not left to the far end of the city: the
  // first is at 880 m, and the flyover at the spawn-side block (5) stays a plain one, as the checks expect.
  return hash2(b, 58) % 3 === 0 ? 1 + (hash2(b, 108) & 1) : 0;
};
// The record of the flyover at `b` blocks from the centre on side `s`. `lo` and `hi` are the along-road extent of the
// deck measured from the start junction: [0, 0] for an ordinary flyover, [0, ext * span] going outward otherwise.
function recordFor(axis, b, s) {
  const ext = bridgeExt(b), F = ext * FLY.span;
  return { axis, road: 0, node: s * b * FLY.span, ext, lo: Math.min(0, s * F), hi: Math.max(0, s * F) };
}
export function nodeAt(ix, iz) {
  if (ix === 0 && iz !== 0) return nodeBlock(Math.abs(iz)) ? recordFor('z', Math.abs(iz), Math.sign(iz)) : null;
  if (iz === 0 && ix !== 0) return nodeBlock(Math.abs(ix)) ? recordFor('x', Math.abs(ix), Math.sign(ix)) : null;
  return null;
}
// Is this junction on a bridge? Returns { f, d }: `f` is the start record and `d` how many blocks out from it the
// junction is (0 is the start itself, `f.ext` is the far end), or null for any other junction.
export function bridgeAt(ix, iz) {
  let axis, k;
  if (ix === 0 && iz !== 0) { axis = 'z'; k = iz; }
  else if (iz === 0 && ix !== 0) { axis = 'x'; k = ix; }
  else return null;
  const s = Math.sign(k), b = Math.abs(k);
  for (let d = 0; d <= 2 && b - d >= FLY.minGap; d++) {
    if (!nodeBlock(b - d)) continue;
    const f = recordFor(axis, b - d, s);
    if (d <= f.ext) return { f, d };
  }
  return null;
}
// The flyover nearest a junction on a main road, out to `within` blocks: what the suites and the AI ask for when
// they want "the first one along this road".
export function nearestNode(ix, iz, within = 40) {
  for (let k = 1; k <= within; k++) {
    const f = ix === 0 ? nodeAt(0, k) : nodeAt(k, 0);
    if (f) return f;
  }
  return null;
}
// The flyover whose structure can reach (x, z) — the one whose deck or ramps cover that spot — or null. This is
// the whole-city lookup every other module goes through, so it stays cheap: outside a narrow band along the two
// main roads it answers null after two compares.
// How many blocks either side of a junction the lookup searches for a bridge whose deck or ramp reaches a point. A long
// bridge's far ramp stands ~2.7 blocks past its start, so 5 covers it with room to spare.
const REACH_SCAN = 5;
// Is the along-road coordinate `u` within a bridge's deck or its ramps, with `pad` on top?
const inReach = (f, u, pad) => u >= f.lo - FLY.rampEnd - pad && u <= f.hi + FLY.rampEnd + pad;
export function flyoverNear(x, z, pad = 0) {
  const wide = FLY.halfW + pad;
  if (Math.abs(x) > wide && Math.abs(z) > wide) return null;
  if (Math.abs(x) <= wide) {                                   // a flyover on the avenue (x = 0, runs along z)
    const iz = Math.round(z / FLY.span);
    for (let k = iz - REACH_SCAN; k <= iz + REACH_SCAN; k++) {
      const f = nodeAt(0, k);
      if (f && inReach(f, z - f.node, pad)) return f;
    }
  }
  if (Math.abs(z) <= wide) {                                   // a flyover on the cross street (z = 0, runs along x)
    const ix = Math.round(x / FLY.span);
    for (let k = ix - REACH_SCAN; k <= ix + REACH_SCAN; k++) {
      const f = nodeAt(k, 0);
      if (f && inReach(f, x - f.node, pad)) return f;
    }
  }
  return null;
}
// Signed local coordinates of a world point in a flyover's own frame: `u` out from the junction along the
// road that flies (positive is the +x/+z half), and `v` across that road from its centre line.
export const alongOf = (f, x, z) => f.axis === 'z' ? z - f.node : x - f.node;
export const latOf = (f, x, z) => f.axis === 'z' ? x - f.road : z - f.road;

// Height of the ramp surface at distance |u| from the junction, and the drivable surface the world presents to
// a car at (x, z) that is currently `y` high:
//  * on the flat deck  -> the deck, but only for a car that is already up there. A car at grade underneath (the
//    crossing street's traffic, or anything driving under the bridge) is handed the ground, never the deck.
//  * on the ramps      -> the ramp surface for a car on the ramp, ground for anything at grade beside it.
//  * anywhere else     -> the ground.
// That one rule is what lets the crossing street run underneath the main road without being scooped up onto it.
export function rampHeight(t) {
  const a = Math.abs(t);
  if (a >= FLY.rampEnd) return 0;
  if (a <= FLY.deckHalf) return FLY.deckH;
  return FLY.deckH * (FLY.rampEnd - a) / RAMP_RUN;
}
// The height of a bridge's surface at u: flat from the start junction to its far end (both ends' decks are the same
// slab), with a ramp down on each outer side. For an ordinary flyover this is exactly rampHeight(u).
export function bridgeHeight(f, u) {
  let a;
  if (u < f.lo - FLY.deckHalf) a = f.lo - FLY.deckHalf - u;
  else if (u > f.hi + FLY.deckHalf) a = u - f.hi - FLY.deckHalf;
  else return FLY.deckH;
  return a >= RAMP_RUN ? 0 : FLY.deckH * (RAMP_RUN - a) / RAMP_RUN;
}
export function surfaceAt(x, z, y) {
  const f = flyoverNear(x, z);
  if (!f) return 0;
  const h = bridgeHeight(f, alongOf(f, x, z));
  return h > 0 && y > h - FLY.on ? h : 0;
}
// Where a car is in relation to a flyover, from its own height. 'deck': it is up on the structure's surface (the flat
// deck, or a ramp it is driving on). 'under': it is at grade beneath the structure (the junction box, or the underside of
// a ramp). null: it is clear of the structure, or it is on the ground beside it. A car this low is treated as being on the
// ground: a ramp's foot is at grade, and the first metres of a ramp are not yet a deck to be on.
export const UP = 2;
export function structureLevel(x, y, z) {
  const f = flyoverNear(x, z);
  if (!f) return null;
  const h = bridgeHeight(f, alongOf(f, x, z));
  if (h <= UP) return null;
  if (y > UP && y > h - FLY.on) return { f, level: 'deck' };
  if (y <= h - FLY.on) return { f, level: 'under' };
  return null;
}

// The structure's footprint in plan: the embankments and the deck, used to keep street furniture, parked cars,
// lane pickups and roadworks out of the concrete (and spawning traffic off it).
// Which sides of a block carry the flyover's at-grade lane. `side` is the block's own side index the sidewalk
// builder uses (0 west, 1 east, 2 south, 3 north), so 0/1 face a street running along z and 2/3 one along x. A
// side carries the lane when the street it fronts is the road that flies *and* this block fronts the junction
// itself: the kerb there is set back by `FLY.atGrade` and the strip it gives up is carriageway again.
export function atGradeSide(cx, cz, side) {
  if (side < 2) {
    const X = side === 0 ? cx : cx + 1;                   // the street's own x index
    const hit = bridgeAt(X, cz) || bridgeAt(X, cz + 1);
    return !!hit && hit.f.axis === 'z';
  }
  const Z = side === 2 ? cz : cz + 1;
  const hit = bridgeAt(cx, Z) || bridgeAt(cx + 1, Z);
  return !!hit && hit.f.axis === 'x';
}
// Is (x, z) on one of those lanes? The strip beside the structure is real carriageway for the whole length of
// the block that carries it (the kerb steps back at the block's own corners, the way it does at every junction),
// so nothing is planted, parked or dropped on it: the sidewalk builder sets its kerb back here, and everything
// that would otherwise stand on the sidewalk asks before it is placed.
export function onAtGradeLane(x, z, pad = 0) {
  const bx = Math.floor(x / FLY.span), bz = Math.floor(z / FLY.span);
  const d = [x - bx * FLY.span, (bx + 1) * FLY.span - x, z - bz * FLY.span, (bz + 1) * FLY.span - z];
  const lo = FLY.halfW - 0.6 - pad, hi = roadEdge() + pad;
  for (let side = 0; side < 4; side++) if (d[side] >= lo && d[side] <= hi && atGradeSide(bx, bz, side)) return true;
  return false;
}
// The lane a car driving along the flying road holds while it is up on the structure — the same right-hand
// offsets the civilian lanes use on the flat, expressed in the flyover's own across-the-road coordinate.
export const laneOffsetOn = (axis, dir, off) => axis === 'z' ? -dir * off : dir * off;
// Where a pursuer at grade has to aim to get up onto the structure after a player who is on it: its own lane,
// `lead` metres further along the road towards the junction. The aim point is a look-ahead down the lane and not a
// fixed spot, so it always sits in front of the car: a pursuer that has already driven past the foot of a ramp
// keeps climbing instead of turning round for a point behind it (which is what left police milling about under the
// deck). Writes into `out`, returns it, or returns null when the pursuer is not in line with the road that flies
// (a car on the street below has to get there first — that is what the traffic underneath is doing, and the chase
// picks up again at the next junction).
export function rampApproach(f, x, z, off, lead, out) {
  const u = alongOf(f, x, z), v = latOf(f, x, z);
  if (Math.abs(v) > FLY.halfW + 1) return null;
  const dir = u < 0 ? 1 : -1;                             // it has to drive towards the junction to climb
  const t = u + dir * lead;
  const lv = laneOffsetOn(f.axis, dir, off);              // ... and hold the lane it is climbing in
  out.x = f.axis === 'z' ? f.road + lv : f.node + t;
  out.z = f.axis === 'z' ? f.node + t : f.road + lv;
  return out;
}

// A point of a flyover's own frame turned back into world coordinates: `along` metres out from the junction along
// the road that flies (positive is the +x/+z half), `lat` metres across it from the road's centre line.
export function laneAim(f, along, lat, out) {
  out.x = f.axis === 'z' ? f.road + lat : f.node + along;
  out.z = f.axis === 'z' ? f.node + along : f.road + lat;
  return out;
}
// Where a pursuer that is up on the structure has to aim to get *off* it, chasing a player who is not up there:
// its own lane, `lead` metres further along the road towards the ramp on its own side of the junction — the
// shorter way down. Holding the lane on the way is the whole point: a car up there that steers straight at a
// target beside the road below just drives into a parapet, and its stuck-escape then shuttles it across the deck
// instead of bringing it down to the street (which is what "the police just circle beside a bridge" looked like).
// `rampApproach` above is the same aim in the other direction, for the climb.
export function rampExit(f, x, z, nose, off, lead, out) {
  const u = alongOf(f, x, z);
  // Carry on the way it is pointing (the aim must always sit in front of the car, or it turns round on the deck
  // and mules against a parapet getting nowhere); a car stopped square across the road takes the nearer end.
  // A car stopped square across the road takes the ramp nearer to it: the end on its own side of the bridge's middle
  // (for a plain flyover, the side of the junction it is on).
  const dir = Math.abs(nose) > 0.25 ? (nose > 0 ? 1 : -1) : (u - (f.lo + f.hi) / 2 > 0 ? 1 : -1);
  return laneAim(f, u + dir * lead, (latOf(f, x, z) >= 0 ? 1 : -1) * off, out);   // out to the end, in the lane it is already in
}
// How far the at-grade lane's own centre line sits from the road's centre line: the lane runs beside the
// structure, from the structure's edge (FLY.halfW) out to the kerb the widening put at roadEdge().
export const laneOffset = () => (FLY.halfW + roadEdge()) / 2;
export function insideFootprint(x, z, pad = 0) {
  return !!flyoverNear(x, z, pad);
}

// Which quarter(s) of which flyover(s) a block builds. The four blocks around a junction each raise their own
// quarter — half the carriageway on their side of the road's centre line, half the length on their side of the
// junction — exactly like the sidewalk ring and the traffic lights, so no block has to know what its neighbours
// are doing. A block can touch two junctions (the one at each end of each of the two roads it fronts), so this
// returns an array, and `su`/`sv` are the signs of the quarter in the flyover's own frame: `su` along the road
// that flies, `sv` across it.
export function flyoverQuadrants(cx, cz) {
  const x0 = cx * FLY.span, z0 = cz * FLY.span, out = [];
  for (const [cxk, czk] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const jx = (x0 / FLY.span) + cxk, jz = (z0 / FLY.span) + czk;
    const hit = bridgeAt(jx, jz);
    if (!hit) continue;
    const { f, d } = hit;
    if (f.ext > 0 && d > 0 && d < f.ext) continue;       // a junction inside a long bridge: the flat span covers it
    const g = Math.sign(f.node);                          // the way the bridge runs from its start
    const node = f.axis === 'z' ? jz * FLY.span : jx * FLY.span;
    const su = f.axis === 'z' ? (z0 >= node ? 1 : -1) : (x0 >= node ? 1 : -1);
    // A plain flyover has a ramp on both sides. A long one has its ramp on the outer side only: the start's ramp
    // faces away from the bridge, the far end's faces away from it too.
    const ramps = f.ext === 0 ? [-1, 1] : d === 0 ? [-g] : [g];
    if (!ramps.includes(su)) continue;
    const sv = f.axis === 'z' ? (x0 >= f.road ? 1 : -1) : (z0 >= f.road ? 1 : -1);
    // `midU`: the middle of the bridge, in this junction's own along-road coordinate (0 for a plain flyover).
    out.push({ axis: f.axis, road: f.road, node, su, sv, midU: f.node + (f.lo + f.hi) / 2 - node });
  }
  return out;
}
// The flat span of each bridge over this block: the stretch of the deck within its along-road extent, on this
// block's own half of the carriageway. Each block builds only its own piece, so a long bridge is built block by
// block and nothing reaches into a neighbour's chunk.
export function flyoverFlats(cx, cz) {
  const out = [];
  const z0 = cz * FLY.span, z1 = z0 + FLY.span, x0 = cx * FLY.span, x1 = x0 + FLY.span;
  if (cx === 0 || cx === -1) {                              // the avenue (x = 0) runs along the blocks at cx 0 and -1
    const sv = cx === 0 ? 1 : -1;
    for (let k = cz - REACH_SCAN; k <= cz + REACH_SCAN; k++) {
      const f = nodeAt(0, k);
      if (!f) continue;
      const a0 = Math.max(z0, f.node + f.lo - FLY.deckHalf), a1 = Math.min(z1, f.node + f.hi + FLY.deckHalf);
      if (a1 > a0) out.push({ axis: 'z', road: 0, node: f.node, sv, a0, a1 });
    }
  }
  if (cz === 0 || cz === -1) {                              // the cross street (z = 0) runs along the blocks at cz 0 and -1
    const sv = cz === 0 ? 1 : -1;
    for (let k = cx - REACH_SCAN; k <= cx + REACH_SCAN; k++) {
      const f = nodeAt(k, 0);
      if (!f) continue;
      const a0 = Math.max(x0, f.node + f.lo - FLY.deckHalf), a1 = Math.min(x1, f.node + f.hi + FLY.deckHalf);
      if (a1 > a0) out.push({ axis: 'x', road: 0, node: f.node, sv, a0, a1 });
    }
  }
  return out;
}

// The junctions that sit beside a flyover: one block along a main road from it, on either side. Those are the
// junctions whose mouths the interchange opens out — the flyover lands on the street that passes through them —
// so they are the ones whose corners are cut on the diagonal (see `FLY.chamfer`).
export function besideFlyover(ix, iz) {
  if (bridgeAt(ix, iz)) return false;                      // a bridge's own junctions are open, not chamfered
  if (ix === 0 && iz !== 0) return !!(bridgeAt(0, iz - 1) || bridgeAt(0, iz + 1));
  if (iz === 0 && ix !== 0) return !!(bridgeAt(ix - 1, 0) || bridgeAt(ix + 1, 0));
  return false;
}
// The junction itself, by world position (a traffic-light set is built per block corner, so this is how a
// corner asks whether it has anything to signal).
export function isFlyoverNode(x, z) {
  const ix = Math.round(x / FLY.span), iz = Math.round(z / FLY.span);
  if (Math.abs(x - ix * FLY.span) > 1 || Math.abs(z - iz * FLY.span) > 1) return false;
  return !!bridgeAt(ix, iz);
}

// The parapets: a car up on the structure is held inside them, while a car at grade (below the parapets, under
// the deck) is not touched by them at all. Reports how far outside the drivable width a car is, and on which
// side; the caller does the pushing and takes the speed off it.
//
// Project the oriented car box onto the road's lateral axis: a sideways car presents its length, not width.
// Pad the lookup by the body's reach plus a separation margin so a ram cannot push the centre beyond the
// lookup band and disable the wall. collideFlyover also runs after car-car separation, before mesh syncing.
export function parapetPush(x, z, y, box, out) {
  out.hit = false;
  if (y <= 0.05) return out;                                 // cars at grade belong to the retaining walls, not the parapets
  const f = flyoverNear(x, z, Math.hypot(box.e1, box.e2) + 1);
  if (!f || !inReach(f, alongOf(f, x, z), 0)) return out;
  const surface = bridgeHeight(f, alongOf(f, x, z));
  // Check height against this part of the ramp, not a fixed world height: protect the low approach too,
  // without pulling a car jumping underneath the deck onto the road above (or catching one above the coping).
  if (y < surface - FLY.on || y > surface + 1.12) return out;
  const e = f.axis === 'z' ? box.e1 * Math.abs(box.ux) + box.e2 * Math.abs(box.vx)
                           : box.e1 * Math.abs(box.uz) + box.e2 * Math.abs(box.vz);
  const v = latOf(f, x, z), lim = Math.max(0.4, FLY.halfW - FLY.parapet - e);
  if (Math.abs(v) <= lim) return out;
  out.hit = true; out.axis = f.axis; out.v = v; out.limit = lim; out.sv = v < 0 ? -1 : 1; out.depth = Math.abs(v) - lim;
  return out;
}

// ---- Closed streets (three-way junctions) ----
// A grid street can be closed for one block: the segment between two neighbouring junctions is taken out, so
// each of its two junctions has three arms instead of four (a T). `segClosed(axis, jx, jz)` answers for the
// segment that leaves junction (jx, jz) along `axis` ('x': to (jx+1, jz); 'z': to (jx, jz+1)). It is pure
// hash, so every block agrees, and it is never on a main road (junction index 0), never near spawn, a flyover
// or a ramp. Among the candidates touching either end only the lowest hash closes, so no junction ever loses
// two arms. About one candidate in five is closed.
const CLOSE_CLEAR = 3;           // junctions this close (in each axis) to the origin stay four-way
const closedCache = new Map();
const segHashOf = (axis, jx, jz) => hash2(jx * 2 + (axis === 'x' ? 0 : 1), jz * 3 + (axis === 'x' ? 17 : 91)) >>> 0;
function segsAt(ex, ez) { return [['x', ex - 1, ez], ['x', ex, ez], ['z', ex, ez - 1], ['z', ex, ez]]; }
// ---- Neighbourhoods ----
// A neighbourhood is an NB x NB block region (NB = NB_BLOCKS, chunks NB*RX..NB*RX+NB-1 by NB*RZ..) whose streets are
// curved, not the grid. Its outer streets stay open; its inner streets are closed (grass) and the curved roads
// (nbhdPlan in world.js) run across the grass. Its lattice is the (NB+1) x (NB+1) junctions from NB*RX to NB*RX+NB.
// The junctions on the edge of the lattice (not corners) are three-way: their one inner arm is closed. The inner
// junctions are inside the neighbourhood: no traffic, no lights, no island, and all their arms are closed. The
// corners stay four-way. No hash-closed street or roundabout touches a lattice junction.
// A region qualifies by hash (about one in six), never near spawn or a flyover, and never next to another region.
export const NB_BLOCKS = 3;
function nbhdBase(RX, RZ) {
  if (RX === 0 || RX === -1 || RZ === 0 || RZ === -1) return false;
  if ((hash2(RX * 13 + 5, RZ * 7 + 11) & 0xFF) >= 42) return false;
  const x0 = NB_BLOCKS * RX, z0 = NB_BLOCKS * RZ;
  for (let jx = x0; jx <= x0 + NB_BLOCKS; jx++) for (let jz = z0; jz <= z0 + NB_BLOCKS; jz++) {
    if (Math.abs(jx) <= CLOSE_CLEAR && Math.abs(jz) <= CLOSE_CLEAR) return false;
    if (jx === 0 || jz === 0) return false;
    if (besideFlyover(jx, jz)) return false;
    if (flyoverNear(jx * FLY.span, jz * FLY.span, FLY.rampEnd + 10)) return false;
  }
  return true;
}
const nbhdCache = new Map();
export function nbhdOf(RX, RZ) {
  const key = RX + ',' + RZ;
  if (nbhdCache.has(key)) return nbhdCache.get(key);
  let v = nbhdBase(RX, RZ);
  for (let dx = -1; v && dx <= 1; dx++) for (let dz = -1; v && dz <= 1; dz++) if ((dx || dz) && nbhdBase(RX + dx, RZ + dz)) v = false;
  nbhdCache.set(key, v);
  return v;
}
// The neighbourhood whose lattice holds junction (jx, jz), as [RX, RZ], or null.
const nbhdJCache = new Map();
export function nbhdJunction(jx, jz) {
  const key = jx + ',' + jz;
  if (nbhdJCache.has(key)) return nbhdJCache.get(key);
  let res = null;
  for (const RX of [Math.floor(jx / NB_BLOCKS), Math.floor(jx / NB_BLOCKS) - 1]) for (const RZ of [Math.floor(jz / NB_BLOCKS), Math.floor(jz / NB_BLOCKS) - 1]) {
    if (res) break;
    if (jx >= NB_BLOCKS * RX && jx <= NB_BLOCKS * RX + NB_BLOCKS && jz >= NB_BLOCKS * RZ && jz <= NB_BLOCKS * RZ + NB_BLOCKS && nbhdOf(RX, RZ)) res = [RX, RZ];
  }
  nbhdJCache.set(key, res);
  return res;
}
// An inner junction of a neighbourhood: inside it, with no traffic.
export function nbhdInterior(jx, jz) {
  const n = nbhdJunction(jx, jz);
  if (!n) return false;
  const ix = jx - NB_BLOCKS * n[0], iz = jz - NB_BLOCKS * n[1];
  return ix >= 1 && ix <= NB_BLOCKS - 1 && iz >= 1 && iz <= NB_BLOCKS - 1;
}
// The inner streets of a neighbourhood (closed for good; they are grass under the curved roads). An x-street runs
// from (jx, jz) to (jx + 1, jz); it is inner when its line is an inner row and it lies in the lattice.
function nbhdInternalSeg(axis, jx, jz) {
  const n = nbhdJunction(jx, jz) || nbhdJunction(axis === 'x' ? jx + 1 : jx, axis === 'x' ? jz : jz + 1);
  if (!n) return false;
  const ox = NB_BLOCKS * n[0], oz = NB_BLOCKS * n[1];
  if (axis === 'x') return jz > oz && jz < oz + NB_BLOCKS && jx >= ox && jx < ox + NB_BLOCKS;
  return jx > ox && jx < ox + NB_BLOCKS && jz >= oz && jz < oz + NB_BLOCKS;
}
function segCandidate(axis, jx, jz) {
  const ends = axis === 'x' ? [[jx, jz], [jx + 1, jz]] : [[jx, jz], [jx, jz + 1]];
  for (const [x, z] of ends) {
    if (x === 0 || z === 0) return false;                                 // main roads carry the flyovers
    if (nbhdJunction(x, z)) return false;                                 // a neighbourhood's streets are its own
    if (Math.abs(x) <= CLOSE_CLEAR && Math.abs(z) <= CLOSE_CLEAR) return false;   // the spawn district stays a normal grid
    if (besideFlyover(x, z)) return false;
    if (flyoverNear(x * FLY.span, z * FLY.span, FLY.rampEnd + 4)) return false;
  }
  return (segHashOf(axis, jx, jz) & 0xFF) < 18;
}
export function segClosed(axis, jx, jz) {
  const key = axis + jx + ',' + jz;
  let v = closedCache.get(key);
  if (v !== undefined) return v;
  v = nbhdInternalSeg(axis, jx, jz);
  if (v) { closedCache.set(key, v); return v; }
  if (segCandidate(axis, jx, jz)) {
    const h = segHashOf(axis, jx, jz);
    const ends = axis === 'x' ? [[jx, jz], [jx + 1, jz]] : [[jx, jz], [jx, jz + 1]];
    v = true;
    for (const [ex, ez] of ends) for (const [a, x, z] of segsAt(ex, ez)) {
      if (a === axis && x === jx && z === jz) continue;
      if (!segCandidate(a, x, z)) continue;
      const g = segHashOf(a, x, z);
      if (g < h || (g === h && a < axis)) { v = false; break; }
    }
  }
  closedCache.set(key, v);
  return v;
}
// Which arm of junction (jx, jz) is closed: 'e', 'w', 'n', 's', or null for a four-way junction.
export function closedArm(jx, jz) {
  if (nbhdInterior(jx, jz)) return null;
  if (segClosed('x', jx, jz)) return 'e';
  if (segClosed('x', jx - 1, jz)) return 'w';
  if (segClosed('z', jx, jz)) return 'n';
  if (segClosed('z', jx, jz - 1)) return 's';
  return null;
}
// Can a car leave junction (jx, jz) along `axis` in direction `dir` (+1 or -1)? False when that arm is closed.
export function armOpen(jx, jz, axis, dir) {
  if (axis === 'x') return !segClosed('x', dir > 0 ? jx : jx - 1, jz);
  return !segClosed('z', jx, dir > 0 ? jz : jz - 1);
}
// Is the point on a closed street (within `margin` of its centre line)? Used to keep spawns off a closed street.
export function nearClosedStreet(x, z, margin) {
  const zl = Math.round(z / CHUNK), xl = Math.round(x / CHUNK);
  if (Math.abs(z - zl * CHUNK) <= margin && segClosed('x', Math.floor(x / CHUNK), zl)) return true;
  if (Math.abs(x - xl * CHUNK) <= margin && segClosed('z', xl, Math.floor(z / CHUNK))) return true;
  return false;
}

// ---- Junction plazas (roundabouts) ----
// A circular island in the middle of a plain four-way junction, with a fountain, statue or tree grove. Plazas
// never go on a main road, beside or under a flyover, or at a closed (three-way) junction. They come in chains:
// a chain starts at a junction whose priority is the lowest among the eligible junctions within six junctions,
// so two chain starts are at least seven junctions apart, and it runs on along one street for one or two more
// junctions (chosen by hash). A chain is therefore one roundabout followed by one or two more, with at least
// two plain junctions before the next chain: no lone roundabouts scattered at random, no clusters of 2-3 by
// chance. `plazaAt(jx, jz)` returns null for a plain junction or `{ feature, radius }`; feature is 0 (fountain),
// 1 (statue) or 2 (tree grove).
const plazaCache = new Map();
const plazaPrio = (jx, jz) => hash2(jx * 5 + 1, jz * 5 + 2) >>> 0;
function plazaEligible(jx, jz) {
  if (nbhdJunction(jx, jz)) return false;                        // a neighbourhood has no island
  if (jx === 0 || jz === 0) return false;                       // main roads carry flyovers: keep plazas off them
  if (besideFlyover(jx, jz)) return false;                      // the cut corner would swallow the island
  if (flyoverNear(jx * FLY.span, jz * FLY.span, FLY.rampEnd + 4)) return false; // a ramp would sweep through it
  return closedArm(jx, jz) === null;                            // a T has no island
}
function plazaStart(jx, jz) {
  if (!plazaEligible(jx, jz)) return false;
  const p = plazaPrio(jx, jz);
  for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
    if (!dx && !dz) continue;
    const x = jx + dx, z = jz + dz;
    if (plazaPrio(x, z) < p && plazaEligible(x, z)) return false;
  }
  return true;
}
function chainOf(jx, jz) {
  const p = plazaPrio(jx, jz);
  const unit = (p >>> 8) & 1 ? [1, 0] : [0, 1], len = 1 + ((p >>> 9) & 1);
  const out = [[jx, jz]];
  for (let k = 1; k <= len; k++) {
    const x = jx + unit[0] * k, z = jz + unit[1] * k;
    if (!plazaEligible(x, z)) break;
    out.push([x, z]);
  }
  return out;
}
export function plazaAt(jx, jz) {
  const key = jx + ',' + jz;
  if (plazaCache.has(key)) return plazaCache.get(key);
  let res = null;
  if (plazaEligible(jx, jz)) {
    search: for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const sx = jx + dx, sz = jz + dz;
      if (!plazaStart(sx, sz)) continue;
      if (chainOf(sx, sz).some(([x, z]) => x === jx && z === jz)) {
        res = { feature: (plazaPrio(sx, sz) >>> 12) % 3, radius: 5.0 };
        break search;
      }
    }
  }
  plazaCache.set(key, res);
  return res;
}
