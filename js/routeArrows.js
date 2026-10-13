/* The route on the road: flashing arrows on the asphalt along the route to the marked place (js/map.js), so the way is
 * seen in the game itself and not only on the map. The arrows follow the street part of the planned route (its corners; the
 * short steps onto the street at either end get none). Only the first few arrows ahead are shown.
 *
 * Each arrow is a glowing chevron outline (blue, with a white core and a soft halo), drawn once on a canvas and laid flat on
 * the road. They light up in turn, moving towards the destination: the lit ones are bright, the others are dimmed so the
 * whole way stays visible. Hidden when there is no mark or no street route. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { currentMark, currentRoute } from './map.js';

const POOL = 24;          // arrows shown at once: about 330 m of route ahead
const STEP = 14;          // metres between arrows
const ARROW_Y = 0.09;     // just above the asphalt (the decks and the road surface are at 0.05 to 0.08)
const SIZE = 4.2;         // the arrow's square on the road, in metres (the chevron fills most of it)
const LIT_OPACITY = 1.0, DIM_OPACITY = 0.28;
let pool = null, samples = [], lastBase = null;

// The chevron, drawn once: an outline pointing along +y of the texture (the arrow's forward), with a glow.
// World metres map to the texture: x in [-SIZE/2, SIZE/2] across, z in [-SIZE/2, SIZE/2] along (up = forward).
function chevronTexture() {
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const P = (x, z) => [N / 2 + x * N / SIZE, N / 2 - z * N / SIZE];
  const shape = () => {
    g.beginPath();
    const pts = [[-1.3, -1.0], [0, 1.6], [1.3, -1.0], [0, -0.2]];
    pts.forEach(([x, z], k) => (k ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    g.closePath();
  };
  g.lineJoin = 'miter'; g.lineCap = 'round';
  // the halo: a wide blue stroke with a blur, then a thinner bright one
  g.shadowColor = '#4fb8ff'; g.shadowBlur = 26;
  g.strokeStyle = '#4fb8ff'; g.lineWidth = 20; shape(); g.stroke();
  g.shadowBlur = 12; g.shadowColor = '#bfe9ff';
  g.strokeStyle = '#9fdcff'; g.lineWidth = 12; shape(); g.stroke();
  // the core: near-white, sharp
  g.shadowBlur = 0;
  g.strokeStyle = '#ffffff'; g.lineWidth = 5; shape(); g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

let litMat = null, dimMat = null, geo = null;
function ensurePool() {
  if (pool) return;
  const tex = chevronTexture();
  geo = new THREE.PlaneGeometry(SIZE, SIZE);
  const base = { map: tex, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  litMat = new THREE.MeshBasicMaterial({ ...base, opacity: LIT_OPACITY });
  dimMat = new THREE.MeshBasicMaterial({ ...base, opacity: DIM_OPACITY });
  pool = [];
  for (let k = 0; k < POOL; k++) {
    const m = new THREE.Mesh(geo, dimMat);
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
    // the plane lies flat with its top towards +z, then turns to the street's direction (YXZ order: yaw after the lay)
    m.rotation.set(Math.PI / 2, Math.atan2(s.ux, s.uz), 0, 'YXZ');
    const isLit = ((k - lit) % 4 + 4) % 4 === 0;     // every fourth arrow is lit, the group running forward
    m.material = isLit ? litMat : dimMat;
    m.visible = true;
  }
}
