/* Clearing a block for a diagonal avenue (js/avenues.js). A block is generated exactly as it always was, and then
 * whatever stands on the avenue is taken out of it, before the block is merged (js/world.js generateChunk). That one
 * pass covers every kind of placement (buildings, pads, trees, props, parked cars, signals, sidewalks, pickups), so no
 * generator has to know about the avenues.
 *
 * What is removed: anything that stands above the avenue's surface and touches it, and any record with a position
 * that lies on it. Flat things at or below the surface (the ground, the grid's own markings) stay: the avenue is laid
 * over them, and it is higher than they are. */
import * as THREE from 'three';
import { rectInAvenue, inAvenue, AVENUES } from './avenues.js';

const AV_TOP = 0.1;                            // the avenue's surface is at 0.12 m; a thing taller than this stands over it

// Does the box touch an avenue and stand above the ground there?
function hits(b) {
  return b.max.y > AV_TOP && rectInAvenue(b.min.x, b.min.z, b.max.x, b.max.z, 0.2);
}

// Is the block's own box near an avenue at all (so the pass is worth running)?
export function blockNearAvenue(x0, z0, x1, z1) {
  return rectInAvenue(x0, z0, x1, z1, 2);
}

export function clearAvenues(ch) {
  // 1. baked geometry (everything made with add(), see chunkBake.js)
  ch.bakeList = ch.bakeList.filter(bk => {
    if (!bk.geo || typeof bk.geo.computeBoundingBox !== 'function') return true;   // (every three.js geometry has one)
    if (!bk.geo.boundingBox) bk.geo.computeBoundingBox();
    return !hits(new THREE.Box3().copy(bk.geo.boundingBox).applyMatrix4(bk.m));
  });
  // 2. loose meshes in the block's group (props, parked cars, signal heads, pickups, ...)
  for (const c of ch.group.children.slice()) {
    const b = new THREE.Box3().setFromObject(c);
    if (!b.isEmpty() && hits(b)) ch.group.remove(c);
  }
  // 3. solids (what the cars run into). A solid's extent is taken as its half-diagonal, so a rotated one is not missed.
  ch.solids = ch.solids.filter(s => {
    const R = Math.hypot(s.hx, s.hz);
    return !rectInAvenue(s.x - R, s.z - R, s.x + R, s.z + R, 0.2);
  });
  // 4. records with a position (trees, props, pickups, bus stops, ramps, ...): dropped when they are on the avenue
  for (const key of Object.keys(ch)) {
    const list = ch[key];
    if (!Array.isArray(list) || key === 'solids' || key === 'bakeList' || key === 'owned') continue;
    if (!list.length || typeof list[0] !== 'object' || list[0] === null || typeof list[0].x !== 'number' || typeof list[0].z !== 'number') continue;
    ch[key] = list.filter(r => !(typeof r.x === 'number' && typeof r.z === 'number' && inAvenue(r.x, r.z, 1)));
  }
}

export const AVENUE_COUNT = AVENUES.length;
