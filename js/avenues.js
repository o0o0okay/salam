/* The diagonal avenues: a few wide roads that cut across the grid at an angle (step 2 of the road layout, the hybrid
 * approach). They are the one part of the city that is not on the grid. Their geometry lives here, and nothing else
 * decides where they are.
 *
 * What they do:
 *  - the blocks they pass through are cleared: nothing is built on the avenue (js/world.js filters every placement
 *    through inAvenue / rectInAvenue, so a building that would stand on the avenue is simply not built);
 *  - the avenue is a road for the player: a driver can go along it (js/avenueRoad.js draws it);
 *  - civilian traffic and the police keep to the grid. The avenues are not in the grid's road graph (js/map.js
 *    roadGraph), so a route to a mark does not use them. This is deliberate for this step.
 *
 * Every avenue is a straight segment between two points on the island, `w` metres wide. A diagonal avenue does not
 * meet the grid at a junction, so the grid's signals and flyovers are not placed on it (js/trafficLights.js). */

export const AVENUE_W = 16;                         // the road's width (the main roads are 16 m too)
// Removed from the game for now (to be re-added properly later). The two avenues that were here were:
//   south-west: a [-1600, -1400] -> b [-250, -120]
//   south-east: a [400, -1500]   -> b [1500, -500]
// Put them back in this list to restore them: the road, the clearing of the blocks, the map and the radar all read it.
export const AVENUES = [];

// The distance from (x, z) to the segment a-b, and the point on it that is nearest.
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
  const qx = a[0] + dx * t, qz = a[1] + dz * t;
  return Math.hypot(x - qx, z - qz);
}

// Is the point (x, z) on an avenue, `pad` metres beyond the road's edge at most?
export function inAvenue(x, z, pad = 0) {
  const half = AVENUE_W / 2 + pad;
  for (const av of AVENUES) if (segDist(x, z, av.a, av.b) <= half) return true;
  return false;
}

// Does the rectangle [x0, x1] x [z0, z1] (axis-aligned) touch an avenue (within `pad`)? Exact: the rectangle and the
// segment meet when the segment crosses the rectangle or either end of it is inside, otherwise it is the nearest
// distance between the segment and the rectangle's edges.
export function rectInAvenue(x0, z0, x1, z1, pad = 0) {
  const half = AVENUE_W / 2 + pad;
  for (const av of AVENUES) {
    if (segRectDist(av.a, av.b, x0, z0, x1, z1) <= half) return true;
  }
  return false;
}

function segRectDist(a, b, x0, z0, x1, z1) {
  // the segment inside the rectangle: Liang-Barsky clip of the segment against the box
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, a[0] - x0) && clip(dx, x1 - a[0]) && clip(-dz, a[1] - z0) && clip(dz, z1 - a[1])) return 0;
  // otherwise the nearest approach is at a rectangle corner or at a segment end
  let best = Infinity;
  for (const p of [a, b]) best = Math.min(best, pointRectDist(p[0], p[1], x0, z0, x1, z1));
  for (const c of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) best = Math.min(best, segDist(c[0], c[1], a, b));
  return best;
}
function pointRectDist(x, z, x0, z0, x1, z1) {
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}
