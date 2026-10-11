/* Estate and neighbourhood plans: curved roads, cul-de-sacs, houses and the plan memo.
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import { CHUNK } from './utils.js';
import { mulberry32 } from './utils.js';
import { hash2 } from './utils.js';
import { nbhdOf } from './flyover.js';
import { NB_BLOCKS } from './flyover.js';
import { PAD_IN } from './sidewalks.js';


/* ---- Estates ----
 * On some suburb blocks the street grid of the block gives way to a residential estate: a curved main road comes in
 * from one edge of the block's pad, bends into a loop or a hairpin and ends in a cul-de-sac, and one or two spur roads
 * branch off it (a three-way junction each), curve and end in cul-de-sacs too. Houses stand along every road, facing
 * it, and follow its curves. The estate's roads are the only roads inside the block and they join the grid at one
 * edge; no civilian or police traffic is routed onto them.
 *
 * planEstate() is pure geometry: it returns the roads (centre line in world x/z with tangents, and the cul-de-sac),
 * the house footprints and the trees, or null when no layout fits the pad after a few tries (the block then keeps its
 * ordinary house grid). Houses are registered as axis-aligned solids, each the bounding box of its rotated footprint;
 * the planner keeps every house at least 5 m from every road's centre line, so no solid sits on a road.
 */
export const ESTATE_ROAD = 3.5, ESTATE_DISC = 6;
// A coarse grid over points, so a clearance test reads only the points near it instead of every road sample. The
// query returns every point within `rad` (it may return some further away too, which callers test themselves).
export function pointGrid(points, cell) {
  const m = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const p of points) {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    let a = m.get(k); if (!a) m.set(k, a = []); a.push(p);
  }
  return (x, z, rad) => {
    const out = [];
    const i0 = Math.floor((x - rad) / cell), i1 = Math.floor((x + rad) / cell);
    const j0 = Math.floor((z - rad) / cell), j1 = Math.floor((z + rad) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = m.get(key(i, j)); if (a) for (const p of a) out.push(p); }
    return out;
  };
}
export function planEstate(lo_x, hi_x, lo_z, hi_z, side, r) {
  const mx = (lo_x + hi_x) / 2, mz = (lo_z + hi_z) / 2;
  const Du = side < 2 ? hi_x - lo_x : hi_z - lo_z;        // depth of the pad from the chosen edge, inward
  const Hv = (side < 2 ? hi_z - lo_z : hi_x - lo_x) / 2;  // half the length of that edge
  if (Du < 34 || Hv < 16) return null;
  // (u, v): u runs inward from the edge, v runs along it from the middle of the pad
  const toW = (u, v) => side === 0 ? [lo_x + u, mz + v] : side === 1 ? [hi_x - u, mz + v] : side === 2 ? [mx + v, lo_z + u] : [mx + v, hi_z - u];
  // a road in the (u, v) frame: `kind` 'main' comes in from the edge; 'spur' starts at (u0, v0) heading a0
  const road = (kind, u0, v0, a0, s) => {
    const pts = [];
    let u = u0, v = v0, a = a0;
    const line = L => { const n = Math.max(1, Math.round(L / 0.5)), st = L / n; for (let i = 0; i < n; i++) { pts.push([u, v]); u += Math.cos(a) * st; v += Math.sin(a) * st; } };
    const arc = (R, ang) => { const n = Math.max(2, Math.round(Math.abs(ang) * R / 0.5)), st = Math.abs(ang) * R / n; for (let i = 0; i < n; i++) { pts.push([u, v]); u += Math.cos(a) * st; v += Math.sin(a) * st; a += ang / n; } };
    if (kind === 'main') {
      const L1 = r(26, 34);
      line(L1); arc(r(6, 7), s * r(2.6, 3.4)); line(r(4, Math.max(4, L1 - 18))); arc(r(6, 7), -s * r(0.3, 0.7)); line(r(2, 3));
    } else {
      line(r(6, 8)); arc(r(5, 6), s * r(0.8, 1.6)); line(r(3, 5));
    }
    pts.push([u, v]);
    return pts;
  };
  // the road stays on the pad: the first 4 m of the main road run out from the edge itself; past that, 4 m off the
  // edge, the cul-de-sac centre 6.5 m (its radius is 6), and 8 m off the sides
  const onPad = (pts, from) => !pts.some(([pu, pv], i) => (i >= from && pu < (i === pts.length - 1 ? 6.5 : 4)) || pu > Du - 8 || Math.abs(pv) > Hv - 8);
  const toRoad = pts => {
    const ribbon = pts.map(([pu, pv], i) => {
      const [x, z] = toW(pu, pv), [ax, az] = toW(...pts[Math.max(0, i - 1)]), [bx2, bz2] = toW(...pts[Math.min(pts.length - 1, i + 1)]);
      const dx = bx2 - ax, dz = bz2 - az, len = Math.hypot(dx, dz) || 1;
      return { x, z, tx: dx / len, tz: dz / len };
    });
    const last = ribbon[ribbon.length - 1];
    return { ribbon, disc: { x: last.x, z: last.z, r: ESTATE_DISC } };
  };
  // distance from a rectangle (centre c, axes t and n, half sizes w/2 and d/2) to a point
  const rectDist = (cx, cz, tx, tz, w, d, px, pz) => {
    const dx = px - cx, dz = pz - cz, du = Math.abs(dx * tx + dz * tz) - w / 2, dn = Math.abs(dx * -tz + dz * tx) - d / 2;
    return Math.hypot(Math.max(du, 0), Math.max(dn, 0));
  };
  let best = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const s = r(0, 1) < 0.5 ? 1 : -1;
    const pts1 = road('main', 0, r(-4, 4), 0, s);
    if (!onPad(pts1, 9)) continue;
    const roads = [toRoad(pts1)];
    // spur roads: each branches off the main road at a point 14-26 m in, turning to one side, if the pad has room
    const spurs = r(0, 1) < 0.35 ? 1 : 2;
    for (let k = 0; k < spurs; k++) {
      // on the first straight (heading +u), 14-22 m in, leaving to the side the hairpin does not bend toward
      const cands = pts1.map((p, i) => i).filter(i => i > 2 && pts1[i][0] >= 14 && pts1[i][0] <= 22);
      if (!cands.length) break;
      const i = cands[Math.floor(r(0, cands.length))];
      const [pu, pv] = pts1[i];
      const pts2 = road('spur', pu, pv, -s * Math.PI / 2, -s);
      if (!onPad(pts2, 0)) continue;
      // a spur branches off the main road: past its first 10 m it must not run back across it
      if (!pts2.every((q, j) => j < 20 || pts1.every(p => Math.hypot(q[0] - p[0], q[1] - p[1]) >= 7))) continue;
      roads.push(toRoad(pts2));
    }
    // houses along every road, both sides, clear of every road and every cul-de-sac
    const samples = roads.flatMap(rd => rd.ribbon.filter((_, i) => i % 2 === 0));
    const discs = roads.map(rd => rd.disc);
    const nearS = pointGrid(samples, 12);
    const clearOfRoads = (cx2, cz2, tx, tz, w, d) => {
      for (const p of nearS(cx2, cz2, 12)) if (rectDist(cx2, cz2, tx, tz, w, d, p.x, p.z) < ESTATE_ROAD + 1.5) return false;
      for (const dc of discs) if (rectDist(cx2, cz2, tx, tz, w, d, dc.x, dc.z) < ESTATE_DISC + 1.5) return false;
      return true;
    };
    const houses = [];
    for (const rd of roads) {
      let acc = 0, nextAt = r(2, 5);
      const R = rd.ribbon;
      for (let i = 1; i < R.length - 1; i++) {
        acc += Math.hypot(R[i].x - R[i - 1].x, R[i].z - R[i - 1].z);
        if (acc < nextAt) continue;
        nextAt += 7;
        const p = R[i];
        for (const k of [-1, 1]) {
          const w = r(8, 9.5), d = r(6.5, 7.5), h = r(4.5, 6);
          const nx = -p.tz, nz = p.tx, dOff = ESTATE_ROAD + 2.6 + d / 2;
          const cx2 = p.x + k * nx * dOff, cz2 = p.z + k * nz * dOff;
          const ca = Math.abs(p.tx), sa = Math.abs(p.tz);
          const hxA = (w * ca + d * sa) / 2, hzA = (w * sa + d * ca) / 2;
          if (cx2 - hxA < lo_x + 1 || cx2 + hxA > hi_x - 1 || cz2 - hzA < lo_z + 1 || cz2 + hzA > hi_z - 1) continue;
          if (!clearOfRoads(cx2, cz2, p.tx, p.tz, w, d)) continue;
          if (houses.some(o => Math.abs(o.x - cx2) < o.hxA + hxA + 1.2 && Math.abs(o.z - cz2) < o.hzA + hzA + 1.2)) continue;
          houses.push({ x: cx2, z: cz2, w, d, h, tx: p.tx, tz: p.tz, k, hxA, hzA });
        }
      }
    }
    if (houses.length < 4) continue;
    const trees = [];
    for (let a2 = 0; a2 < 60 && trees.length < 9; a2++) {
      const x = r(lo_x + 2, hi_x - 2), z = r(lo_z + 2, hi_z - 2);
      let ok = discs.every(dc => Math.hypot(x - dc.x, z - dc.z) >= ESTATE_DISC + 4);
      if (ok) for (const p of nearS(x, z, ESTATE_ROAD + 4)) if (Math.hypot(x - p.x, z - p.z) < ESTATE_ROAD + 4) { ok = false; break; }
      if (ok && houses.some(o => Math.abs(o.x - x) < o.hxA + 2.5 && Math.abs(o.z - z) < o.hzA + 2.5)) ok = false;
      if (ok) trees.push({ x, z });
    }
    if (!best || houses.length > best.houses.length) best = { side, roads, houses, trees };
    if (houses.length >= 10) break;
  }
  return best;
}

// ---- Neighbourhoods (see nbhdOf in flyover.js) ----
// A neighbourhood is a 2x2-block region with curved streets: a main road that bends, spurs that branch off it and end
// in cul-de-sacs, and about ten houses on both sides. The plan is a pure function of (RX, RZ), so each of the region's
// four blocks builds the part of it that lies in its own chunk (nbhdClip), and the blocks always agree. The region's
// inner streets are closed (grass), so the curves run across the grass and not along the grid.
export const NB_ROAD = 3.5, NB_DISC = 6, NB_IN = 22;
export const nbCache = new Map();
// Some neighbourhoods carry a line of wooden utility poles along their pavements: about half, from their own hash.
export function utilityNbhd(RX, RZ) { return (hash2(RX * 31 + 7, RZ * 17 - 5) & 3) < 2; }
export function nbhdPlan(RX, RZ) {
  const key = RX + ',' + RZ;
  if (!nbCache.has(key)) nbCache.set(key, nbhdOf(RX, RZ) ? buildNbhd(RX, RZ) : null);
  return nbCache.get(key);
}
// The pad a house must lie in: the pad of the block that holds the house centre (the same inset as a block's own pad).
export function nbPad(x, z) {
  const x0 = Math.floor(x / CHUNK) * CHUNK, z0 = Math.floor(z / CHUNK) * CHUNK;
  return [x0 + PAD_IN, x0 + CHUNK - PAD_IN, z0 + PAD_IN, z0 + CHUNK - PAD_IN];
}
// Distance from a rectangle (centre c, axes t and n, sizes w and d) to a point.
export function nbRectGap(cx, cz, tx, tz, w, d, px, pz) {
  const dx = px - cx, dz = pz - cz, du = Math.abs(dx * tx + dz * tz) - w / 2, dn = Math.abs(dx * -tz + dz * tx) - d / 2;
  return Math.hypot(Math.max(du, 0), Math.max(dn, 0));
}
export function buildNbhd(RX, RZ) {
  const r = mulberry32(hash2(RX * 977 + 3, RZ * 613 + 19) ^ 0x6e62);
  const rr = (a, b) => a + (b - a) * r();
  const X0 = RX * NB_BLOCKS * CHUNK, Z0 = RZ * NB_BLOCKS * CHUNK, X1 = X0 + NB_BLOCKS * CHUNK, Z1 = Z0 + NB_BLOCKS * CHUNK;
  const inside = pts => pts.every(([x, z]) => x >= X0 + NB_IN && x <= X1 - NB_IN && z >= Z0 + NB_IN && z <= Z1 - NB_IN);
  // a road in world coordinates: a main road bends three times (a long S-curve and sweeps); a spur bends once
  const makeRoad = (x0, z0, a0, main, s) => {
    const pts = []; let x = x0, z = z0, a = a0;
    const line = L => { const n = Math.max(1, Math.round(L / 0.5)), st = L / n; for (let i = 0; i < n; i++) { pts.push([x, z]); x += Math.cos(a) * st; z += Math.sin(a) * st; } };
    const arc = (R, ang) => {
      const n = Math.max(2, Math.round(Math.abs(ang) * R / 0.5)), st = Math.abs(ang) * R / n, da = ang / n;
      for (let i = 0; i < n; i++) { pts.push([x, z]); a += da; x += Math.cos(a) * st; z += Math.sin(a) * st; }
    };
    if (main) { line(rr(16, 24)); arc(rr(9, 11), s * rr(2.0, 2.8)); line(rr(12, 20)); arc(rr(8, 10), -s * rr(1.4, 2.2)); line(rr(12, 20)); arc(rr(9, 11), s * rr(1.0, 2.0)); line(rr(8, 14)); }
    else { line(rr(9, 13)); arc(rr(6, 8), s * rr(0.9, 1.5)); line(rr(4, 7)); }
    pts.push([x, z]);
    return pts;
  };
  const toRoad = pts => {
    const ribbon = pts.map(([x, z], i) => {
      const [ax, az] = pts[Math.max(0, i - 1)], [bx2, bz2] = pts[Math.min(pts.length - 1, i + 1)];
      const dx = bx2 - ax, dz = bz2 - az, len = Math.hypot(dx, dz) || 1;
      return { x, z, tx: dx / len, tz: dz / len };
    });
    const last = ribbon[ribbon.length - 1];
    return { ribbon, disc: { x: last.x, z: last.z, r: NB_DISC } };      // every road ends in a cul-de-sac
  };
  let best = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const s = r() < 0.5 ? 1 : -1;
    // the main road starts in the middle of one of the four block pads (the centre of the region is a junction corner)
    const pad4 = [], pz4 = [];
    for (let b = 0; b < NB_BLOCKS; b++) { pad4.push(X0 + b * CHUNK + 40); pz4.push(Z0 + b * CHUNK + 40); }
    const pts1 = makeRoad(pad4[Math.floor(r() * NB_BLOCKS)] + rr(-10, 10), pz4[Math.floor(r() * NB_BLOCKS)] + rr(-10, 10), r() * Math.PI * 2, true, s);
    if (!inside(pts1)) continue;
    const roads = [toRoad(pts1)];
    let roadNear = pointGrid(roads[0].ribbon, 10);
    for (let tries = 0, made = 0; tries < 60 && made < 6; tries++) {
      // a spur branches off the road at a random point, heading off to one side
      const i = 8 + Math.floor(r() * (pts1.length - 16));
      const [px, pz] = pts1[i], [qx, qz] = pts1[i + 1];
      const side = r() < 0.5 ? 1 : -1;
      const pts2 = makeRoad(px, pz, Math.atan2(qz - pz, qx - px) + side * Math.PI / 2, false, r() < 0.5 ? 1 : -1);
      if (!inside(pts2)) continue;
      // past its first 10 m a spur must not run back across another road
      if (!pts2.every((q, j) => j < 20 || roadNear(q[0], q[1], 10).every(p => Math.hypot(q[0] - p.x, q[1] - p.z) >= 10))) continue;
      roads.push(toRoad(pts2)); made++;
      roadNear = pointGrid(roads.flatMap(rd => rd.ribbon), 10);
    }
    // houses along every road, alternately on both sides, each in one block's pad and clear of every road
    const samples = roads.flatMap(rd => rd.ribbon.filter((_, i) => i % 2 === 0));
    const discs = roads.map(rd => rd.disc);
    const nearS = pointGrid(samples, 12);
    const clear = (cx2, cz2, tx, tz, w, d) => {
      for (const p of nearS(cx2, cz2, 12)) if (nbRectGap(cx2, cz2, tx, tz, w, d, p.x, p.z) < NB_ROAD + 1.5) return false;
      for (const dc of discs) if (nbRectGap(cx2, cz2, tx, tz, w, d, dc.x, dc.z) < NB_DISC + 1.5) return false;
      return true;
    };
    const houses = [];
    for (const rd of roads) {
      let acc = 0, nextAt = rr(2, 5);
      const R = rd.ribbon;
      for (let i = 1; i < R.length - 1; i++) {
        acc += Math.hypot(R[i].x - R[i - 1].x, R[i].z - R[i - 1].z);
        if (acc < nextAt) continue;
        nextAt += 4;
        const p = R[i];
        for (const k of [-1, 1]) {
          const w = rr(8, 9.5), d = rr(6.5, 7.5), h = rr(4.5, 6);
          const dOff = NB_ROAD + 2.6 + d / 2;
          const cx2 = p.x + k * -p.tz * dOff, cz2 = p.z + k * p.tx * dOff;
          const ca = Math.abs(p.tx), sa = Math.abs(p.tz);
          const hxA = (w * ca + d * sa) / 2, hzA = (w * sa + d * ca) / 2;
          const [a0, a1, b0, b1] = nbPad(cx2, cz2);
          if (cx2 - hxA < a0 + 0.5 || cx2 + hxA > a1 - 0.5 || cz2 - hzA < b0 + 0.5 || cz2 + hzA > b1 - 0.5) continue;
          if (!clear(cx2, cz2, p.tx, p.tz, w, d)) continue;
          if (houses.some(o => Math.abs(o.x - cx2) < o.hxA + hxA + 1.2 && Math.abs(o.z - cz2) < o.hzA + hzA + 1.2)) continue;
          houses.push({ x: cx2, z: cz2, w, d, h, tx: p.tx, tz: p.tz, k, hxA, hzA });
        }
      }
    }
    const trees = [];
    for (let a2 = 0; a2 < 80 && trees.length < 12; a2++) {
      const x = rr(X0 + NB_IN, X1 - NB_IN), z = rr(Z0 + NB_IN, Z1 - NB_IN);
      const [a0, a1, b0, b1] = nbPad(x, z);
      if (x < a0 + 2 || x > a1 - 2 || z < b0 + 2 || z > b1 - 2) continue;
      if (!discs.every(dc => Math.hypot(x - dc.x, z - dc.z) >= NB_DISC + 4)) continue;
      if (nearS(x, z, NB_ROAD + 4).some(p => Math.hypot(x - p.x, z - p.z) < NB_ROAD + 4)) continue;
      if (houses.some(o => Math.abs(o.x - x) < o.hxA + 2.5 && Math.abs(o.z - z) < o.hzA + 2.5)) continue;
      trees.push({ x, z });
    }
    if (!best || houses.length > best.houses.length) best = { roads, houses, trees };
    if (houses.length >= 10 && roads.length >= 2) break;
  }
  return best || { roads: [], houses: [], trees: [] };
}
// The part of a neighbourhood plan that lies in block (cx, cz). Roads are clipped per segment by midpoint (in the
// render loop), and houses and trees by centre point, so every piece is built by exactly one block.
export function nbhdClip(plan, cx, cz) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const inC = (x, z) => x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK;
  return { roads: plan.roads, houses: plan.houses.filter(h => inC(h.x, h.z)), trees: plan.trees.filter(t => inC(t.x, t.z)), inC };
}

export const ESTATE_MEMO_MAX = 400;
export const estatePlanMemo = new Map();
