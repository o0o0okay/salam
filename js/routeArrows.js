/* The route on the road: flashing arrows on the asphalt along the route to the marked place (js/map.js), so the way is
 * seen in the game itself and not only on the map. The arrows follow the street part of the planned route (its corners; the
 * short steps onto the street at either end get none). Only the first few arrows ahead are shown.
 *
 * Each arrow is a neon chevron: a rounded blue-white outline with a bright core and a wide soft bloom, drawn once on a canvas
 * and laid flat on the road. They are stacked closely up the road. The group lit by the flash runs forward towards the
 * destination, and the arrows further ahead are dimmer than the ones near the car. Hidden when there is no mark or no street
 * route. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { currentMark, currentRoute } from './map.js';

const POOL = 70;          // arrows shown at once: about 630 m of route ahead (the whole way to the head of the street)
const STEP = 9;           // metres between arrows (they are stacked closely, as on the reference)
const ARROW_Y = 0.09;     // just above the asphalt (the decks and the road surface are at 0.05 to 0.08)
const SIZE = 9.0;         // the arrow's square on the road, in metres; the bloom reaches to its edge
const LEVELS = 3;         // brightness steps along the route: near, middle, far
const LIT = [1.0, 0.85, 0.65], DIM = [0.42, 0.34, 0.26];   // opacity of a lit / unlit arrow in each step
let pool = null, samples = [], lastBase = null;

// The chevron, drawn once on a canvas: an outline pointing up the texture (the arrow's forward), with a bloom.
// World metres map to the texture: x in [-SIZE/2, SIZE/2] across, z in [-SIZE/2, SIZE/2] along (up = forward).
function chevronTexture() {
  const N = 512, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const k = N / SIZE;                                   // pixels per metre
  const P = (x, z) => [N / 2 + x * k, N / 2 - z * k];
  // the chevron: wings wide and low, the tip high, the notch in the middle (the reference's proportions)
  const shape = () => {
    g.beginPath();
    const pts = [[-3.4, -2.2], [0, 2.6], [3.4, -2.2], [0, -0.5]];
    pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    g.closePath();
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  // the bloom: three passes, widest and softest first, then a bright core in near-white
  const pass = (color, width, blur, alpha) => {
    g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width;
    g.shadowColor = color; g.shadowBlur = blur; shape(); g.stroke();
  };
  pass('#2f7dff', 58, 70, 0.55);
  pass('#4aa6ff', 34, 40, 0.8);
  pass('#8fd4ff', 18, 18, 1.0);
  pass('#ffffff', 7, 6, 1.0);
  g.globalAlpha = 1; g.shadowBlur = 0;
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

let mats = null, geo = null;
function ensurePool() {
  if (pool) return;
  const tex = chevronTexture();
  geo = new THREE.PlaneGeometry(SIZE, SIZE);
  const base = { map: tex, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  // one material per brightness step and per lit / unlit state (a shared material cannot have its own opacity)
  mats = { lit: [], dim: [] };
  for (let l = 0; l < LEVELS; l++) {
    mats.lit.push(new THREE.MeshBasicMaterial({ ...base, opacity: LIT[l] }));
    mats.dim.push(new THREE.MeshBasicMaterial({ ...base, opacity: DIM[l] }));
  }
  pool = [];
  for (let k = 0; k < POOL; k++) {
    const m = new THREE.Mesh(geo, mats.dim[0]);
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
  const lit = Math.floor(t * 5);                     // the flash moves on five times a second
  for (let k = 0; k < POOL; k++) {
    const m = pool[k], s = ahead[k];
    if (!s) { m.visible = false; continue; }
    m.position.set(s.x, ARROW_Y, s.z);
    // the plane lies flat with its top towards +z, then turns to the street's direction (YXZ order: yaw after the lay)
    m.rotation.set(Math.PI / 2, Math.atan2(s.ux, s.uz), 0, 'YXZ');
    const level = Math.min(LEVELS - 1, Math.floor(k / (POOL / LEVELS)));   // near, middle, far
    const isLit = ((k - lit) % 4 + 4) % 4 === 0;     // every fourth arrow is lit, the group running forward
    m.material = isLit ? mats.lit[level] : mats.dim[level];
    m.visible = true;
  }
}
