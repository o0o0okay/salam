/* The route on the road: flashing arrows on the asphalt along the route to the marked place (js/map.js), so the way is
 * seen in the game itself and not only on the map. The arrows follow the street part of the route (the first and the
 * last leg, across a block to its corner, are not on a street and get none). Only the first few arrows ahead are shown,
 * and they light up in turn, moving towards the destination. Hidden when there is no mark or no street route. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { currentMark, currentRoute } from './map.js';

const POOL = 24;          // arrows shown at once: about 330 m of route ahead
const STEP = 14;          // metres between arrows
const ARROW_Y = 0.09;     // just above the asphalt (the decks and the road surface are at 0.05 to 0.08)
let pool = null, samples = [], lastRoute = null;

// one chevron pointing along +z (the arrow's forward), lying flat
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute([
  0, 0, 1.6,   -1.3, 0, -1.0,   0, 0, -0.2,
  0, 0, 1.6,    0, 0, -0.2,      1.3, 0, -1.0,
], 3));
const mat = new THREE.MeshBasicMaterial({
  color: 0x4285f4, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

function ensurePool() {
  if (pool) return;
  pool = [];
  for (let k = 0; k < POOL; k++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false; m.renderOrder = 2;
    scene.add(m); pool.push(m);
  }
}

// The points every STEP metres along the street part of a route, with the direction of travel at each.
function samplesOf(pts) {
  const out = [], seg = pts.slice(1, -1);            // the junction points: the first and last are the access legs
  let next = STEP, total = 0;
  for (let k = 0; k < seg.length - 1 && out.length < POOL; k++) {
    const [ax, az] = seg[k], [bx, bz] = seg[k + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L === 0) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, start = total, end = total + L;
    while (next <= end && out.length < POOL) {
      const d = next - start;
      out.push({ x: ax + ux * d, z: az + uz * d, ux, uz });
      next += STEP;
    }
    total = end;
  }
  return out;
}

export function updateRouteArrows() {
  ensurePool();
  const route = currentMark() ? currentRoute() : null;
  if (!route) { for (const m of pool) m.visible = false; lastRoute = null; samples = []; return; }
  if (route !== lastRoute) { lastRoute = route; samples = samplesOf(route.pts); }
  const t = performance.now() / 1000;
  const lit = Math.floor(t * 5);                     // the light moves on five times a second
  for (let k = 0; k < POOL; k++) {
    const m = pool[k], s = samples[k];
    if (!s) { m.visible = false; continue; }
    m.position.set(s.x, ARROW_Y, s.z);
    m.rotation.y = Math.atan2(s.ux, s.uz);
    m.visible = ((k - lit) % 4 + 4) % 4 === 0;      // every fourth arrow is lit, the group running forward
  }
}
