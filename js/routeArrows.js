/* The route on the road: flashing arrows on the asphalt along the route to the marked place (js/map.js), so the way is
 * seen in the game itself and not only on the map. The arrows follow the whole planned route: from the car's front, along
 * the street, round each corner (curved through the junction), to the street nearest the mark. Only the first arrows ahead
 * are shown, none of them over a building. When the car goes against the route, a chevron at the edge of the screen points
 * back to it.
 *
 * Each arrow is a neon chevron: a rounded blue-white outline with a bright core and a wide soft bloom, drawn once on a canvas
 * and laid flat on the road. They are stacked closely up the road. The group lit by the flash runs forward towards the
 * destination, and the arrows further ahead are dimmer than the ones near the car. Hidden when there is no mark or no street
 * route. */
import * as THREE from 'three';
import { scene, camera } from './renderer.js';
import { player } from './state.js';
import { currentMark, currentRoute } from './map.js';
import { known } from './mapData.js';
import { CHUNK, ck } from './utils.js';

const POOL = 70;          // arrows shown at once: about 630 m of route ahead (the whole way to the head of the street)
const STEP = 9;           // metres between arrows (they are stacked closely, as on the reference)
const ARROW_Y = 0.3;      // above the asphalt, the kerbs and the grass, so an arrow on a sidewalk or in a park is seen
const CORNER_R = 8;       // the radius, in metres, of a turn: the route is curved through a junction, not cut straight
const SIZE = 9.0;         // the arrow's square on the road, in metres; the bloom reaches to its edge
const LEVELS = 3;         // brightness steps along the route: near, middle, far
const LIT = [1.0, 0.85, 0.65], DIM = [0.42, 0.34, 0.26];   // opacity of a lit / unlit arrow in each step
let pool = null, samples = [], lastBase = null, path = [], cum = [];

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

// Is the place inside a building (the real footprints of the block, from the map data)? No arrow is drawn there.
function onBuilding(x, z) {
  const k = known(ck(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  if (!k) return false;
  for (const [bx, bz, w, d] of k.blds) if (x >= bx && x <= bx + w && z >= bz && z <= bz + d) return true;
  return false;
}

// The planned way as a smooth path. Each corner (a junction, or the step on or off a street) is rounded into a short
// curve of CORNER_R metres, so an arrow that goes round a corner bends with the road.
function smoothPath(P) {
  const out = [P[0]];
  for (let k = 1; k + 1 < P.length; k++) {
    const [px, pz] = P[k - 1], [x, z] = P[k], [nx, nz] = P[k + 1];
    const l1 = Math.hypot(x - px, z - pz), l2 = Math.hypot(nx - x, nz - z);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const d1x = (x - px) / l1, d1z = (z - pz) / l1, d2x = (nx - x) / l2, d2z = (nz - z) / l2;
    if (d1x * d2x + d1z * d2z > 0.97) { out.push([x, z]); continue; }        // (almost) straight on: no curve
    const r = Math.min(CORNER_R, 0.45 * l1, 0.45 * l2);
    const ax = x - d1x * r, az = z - d1z * r, bx = x + d2x * r, bz = z + d2z * r;
    for (let t = 0; t <= 1.0001; t += 0.25) {                               // a quadratic curve a -> corner -> b
      out.push([(1 - t) * (1 - t) * ax + 2 * (1 - t) * t * x + t * t * bx, (1 - t) * (1 - t) * az + 2 * (1 - t) * t * z + t * t * bz]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

// The arrows sit every STEP metres along the smoothed route, at fixed places on the road (they do not move with the car).
// The distance along the path is the arc; the car's own place on the path is found from its position, so the arrows
// ahead of the car are the ones with a larger arc.
function prepare(base) {
  path = smoothPath(base.pts);
  cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
  const out = [];
  let k = 0;
  for (let g = 0; g <= cum[cum.length - 1]; g += STEP) {
    while (k < path.length - 2 && g > cum[k + 1]) k++;
    const L = cum[k + 1] - cum[k];
    if (L <= 1e-9) continue;
    const f = (g - cum[k]) / L;
    const [ax, az] = path[k], [bx, bz] = path[k + 1];
    const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    out.push({ x, z, ux: (bx - ax) / L, uz: (bz - az) / L, arc: g, blocked: onBuilding(x, z) });
  }
  return out;
}
// the arc along the path of the car: the point of the path nearest to the car, looked for near the car's last place
// (a route can pass near the car at two places; the place it has reached is the one it follows, unless it is far off)
let carArcLast = 0;
function arcOfCar(x, z) {
  let best = null, near = null;
  for (let k = 0; k + 1 < path.length; k++) {
    const [ax, az] = path[k], [bx, bz] = path[k + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
    const cand = { d, arc: cum[k] + Math.hypot(qx - ax, qz - az) };
    if (!best || d < best.d) best = cand;
    if (Math.abs(cand.arc - carArcLast) <= 150 && (!near || d < near.d)) near = cand;
  }
  const pick = near && best && near.d < best.d + 15 ? near : best;
  carArcLast = pick ? pick.arc : 0;
  return carArcLast;
}

// The pointer: a chevron at the edge of the screen, turned to the route, shown only when the car faces away from it.
let hud = null;
function ensureHUD() {
  if (hud) return hud;
  hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:5;display:none';
  hud.innerHTML = '<svg width="46" height="34" viewBox="-23 -17 46 34" style="position:absolute;left:-23px;top:-17px;overflow:visible">'
    + '<path d="M-14,-12 L14,0 L-14,12 L-7,0 Z" fill="#8fd4ff" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" '
    + 'style="filter:drop-shadow(0 0 6px #2f7dff)"/></svg>';
  document.body.appendChild(hud);
  return hud;
}
// The pointer aims at a point this far along the route ahead of the car: a point a little way on gives a steady direction
const POINTER_AHEAD = 20;
let pointerTarget = null;                             // the arrow the pointer aims at (for the tests)
const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _b = new THREE.Vector3();
// The direction of the target as the camera sees it: its right, up and back axes (the camera looks along -back).
// Behind the camera the direction is turned round. This is the direction on the screen, from its middle, to the target.
function updateHUD(target) {
  const h = ensureHUD();
  pointerTarget = target;
  // shown only when the car goes against the route: the target is behind the car (the car's forward is (sin h, cos h))
  const behindCar = !!target && Math.sin(player.h) * (target.x - player.x) + Math.cos(player.h) * (target.z - player.z) < 0;
  if (!behindCar) { h.style.display = 'none'; return; }
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  _r.set(e[0], e[1], e[2]); _u.set(e[4], e[5], e[6]); _b.set(e[8], e[9], e[10]);
  _v.set(target.x - camera.position.x, ARROW_Y - camera.position.y, target.z - camera.position.z);
  let dx = _v.dot(_r), dy = _v.dot(_u);
  if (_v.dot(_b) > 0) { dx = -dx; dy = -dy; }          // behind the camera
  const W = window.innerWidth, H = window.innerHeight;
  const th = Math.atan2(-dy, dx);                      // the screen angle (y goes down the screen)
  const R = Math.min(W, H) / 2 - 70;
  h.style.display = 'block';
  h.style.transform = `translate(${W / 2 + Math.cos(th) * R}px, ${H / 2 + Math.sin(th) * R}px) rotate(${th}rad)`;
}

export function updateRouteArrows() {
  ensurePool();
  const route = currentMark() ? currentRoute() : null;
  if (!route) { for (const m of pool) m.visible = false; lastBase = null; samples = []; updateHUD(null); return; }
  if (route.base !== lastBase) { lastBase = route.base; samples = prepare(route.base); carArcLast = 0; }
  const carArc = arcOfCar(player.x, player.z);
  const ahead = [];                                   // the arrows in front of the car, nearest first (not inside a building)
  for (const s of samples) {
    if (s.arc <= carArc || s.blocked) continue;
    if (ahead.length >= POOL) break;
    ahead.push(s);
  }
  // the pointer: the first arrow ahead that is at least POINTER_AHEAD metres on along the route (or the last one ahead)
  updateHUD(ahead.find(q => q.arc >= carArc + POINTER_AHEAD) || ahead[ahead.length - 1] || null);
  const t = performance.now() / 1000;
  const lit = Math.floor(t * 5);                     // the flash moves on five times a second
  for (let k = 0; k < POOL; k++) {
    const m = pool[k], s = ahead[k];
    if (!s) { m.visible = false; continue; }
    m.position.set(s.x, ARROW_Y, s.z);
    // the plane lies flat with its top towards +z, then turns to the road's direction (YXZ order: yaw after the lay)
    m.rotation.set(Math.PI / 2, Math.atan2(s.ux, s.uz), 0, 'YXZ');
    const level = Math.min(LEVELS - 1, Math.floor(k / (POOL / LEVELS)));   // near, middle, far
    const isLit = ((k - lit) % 4 + 4) % 4 === 0;     // every fourth arrow is lit, the group running forward
    m.material = isLit ? mats.lit[level] : mats.dim[level];
    m.visible = true;
  }
}
