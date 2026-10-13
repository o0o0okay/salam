/* The route on the road: flashing arrows on the asphalt along the route to the marked place (js/map.js), so the way is
 * seen in the game itself and not only on the map. The arrows follow the street part of the planned route (its corners; the short
 * steps onto the street at either end get none). Only the first few arrows ahead are shown,
 * and they light up in turn, moving towards the destination. Hidden when there is no mark or no street route. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { currentMark, currentRoute } from './map.js';

const POOL = 24;          // arrows shown at once: about 330 m of route ahead
const STEP = 14;          // metres between arrows
const ARROW_Y = 0.09;     // just above the asphalt (the decks and the road surface are at 0.05 to 0.08)
let pool = null, samples = [], lastBase = null;

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

// The arrows sit every STEP metres of the planned route, at fixed places on the road (they do not move with the car).
// Each one knows its distance `arc` along the planned route, so the ones ahead of the car can be picked out.
function samplesOf(base) {
  const out = [], st = base.street, si = base.sIdx, cum = base.cum;
  if (st.length < 2) return out;
  let k = 0;
  for (let g = Math.ceil(cum[si[0]] / STEP) * STEP; ; g += STEP) {
    while (k < st.length - 2 && g > cum[si[k + 1]]) k++;
    if (g > cum[si[k + 1]]) break;                    // past the last corner of the way
    const [ax, az] = st[k], [bx, bz] = st[k + 1];
    const L = cum[si[k + 1]] - cum[si[k]];
    if (L <= 0) continue;
    const f = (g - cum[si[k]]) / L;
    out.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f, ux: (bx - ax) / L, uz: (bz - az) / L, arc: g });
  }
  return out;
}

export function updateRouteArrows() {
  ensurePool();
  const route = currentMark() ? currentRoute() : null;
  if (!route) { for (const m of pool) m.visible = false; lastBase = null; samples = []; return; }
  if (route.base !== lastBase) { lastBase = route.base; samples = samplesOf(route.base); }
  const ahead = [];                                   // the arrows in front of the car, nearest first
  for (const s of samples) {
    if (s.arc <= route.s) continue;
    if (s.arc > route.s + POOL * STEP || ahead.length >= POOL) break;
    ahead.push(s);
  }
  const t = performance.now() / 1000;
  const lit = Math.floor(t * 5);                     // the light moves on five times a second
  for (let k = 0; k < POOL; k++) {
    const m = pool[k], s = ahead[k];
    if (!s) { m.visible = false; continue; }
    m.position.set(s.x, ARROW_Y, s.z);
    m.rotation.y = Math.atan2(s.ux, s.uz);
    m.visible = ((k - lit) % 4 + 4) % 4 === 0;      // every fourth arrow is lit, the group running forward
  }
}
