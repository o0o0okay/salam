/* The marked place (js/map.js) in the world: a GTA-style column of red light standing on the spot, and round its foot a
 * circle of light on the road that grows and shrinks, breathing, so the spot reads as live and its size is seen from the
 * car. The circle is the place to drive to: once the car is on it (its centre inside the circle at its largest), the mark
 * is done. It is cleared everywhere (the map, the radar, the road arrows), and the light goes out with a short flourish:
 * the circle opens out and fades, and the column narrows and fades with it. Clearing the mark on the map, or a new game,
 * puts the light out at once (currentMark is null).
 *
 * The light stands on the mark's own level (onDeck, js/map.js). A mark up on a flyover (inside the structure's outline on
 * the map: a ramp or the deck) has its light on the structure's surface, with the circle tilted to a ramp's slope; a mark
 * anywhere else has it on the ground. The car arrives only on that level, so driving over a deck does not finish a mark on
 * the street beneath it, nor driving under the deck a mark up on it. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { currentMark, clearMark, onDeck, structureAt } from './map.js';
import { flyoverNear, alongOf, bridgeHeight } from './flyover.js';
import { player } from './state.js';

const HEIGHT = 80;                          // the column's height, in metres
const RADIUS = 1.6;                         // its radius
const RED = '#ff3b2a';
const CIRCLE_MIN = 3.2, CIRCLE_MAX = 5.6;   // the circle's radius (its outer edge), drawn in and spread out, in metres
const EDGE = 0.7;                           // the width of its bright edge when drawn in (it widens as the circle spreads)
const BREATH = 1.4;                         // seconds for one breath of the circle: out and back in
const ARRIVE_R = CIRCLE_MAX;                // the car is on the circle once its centre is within the circle at its largest
const JUMP = 30;                            // a step longer than this in one frame is a jump (a new game), not a drive
const FADE = 0.6;                           // seconds the light takes to go out once the car has arrived
const LIFT = 0.3;                           // the circle above the road (as the route's arrows): seen over kerbs and grass

let group = null, column = null, pad = null, ring = null, fill = null;
let shown = null, foot = null;              // the mark the light stands for, and its foot (footOf)
let armed = null;                           // the mark whose circle the car has been off since it was set: only then can it arrive
let last = null;                            // the car's place on the last frame
let gone = null;                            // the light going out after the car has arrived: { t0, x, z, foot, r }
const _up = new THREE.Vector3(0, 1, 0);

// The column's colour: solid at the foot and fading to nothing at the top, as in the reference.
function fadeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, cv.height, 0, 0);       // bottom (foot) to top
  grad.addColorStop(0.00, 'rgba(255,59,42,0.9)');
  grad.addColorStop(0.35, 'rgba(255,59,42,0.5)');
  grad.addColorStop(0.75, 'rgba(255,59,42,0.12)');
  grad.addColorStop(1.00, 'rgba(255,59,42,0.0)');
  g.fillStyle = grad; g.fillRect(0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

function ensure() {
  if (group) return;
  group = new THREE.Group();
  group.name = 'markBeam';
  group.visible = false;
  const colMat = new THREE.MeshBasicMaterial({ map: fadeTexture(), color: 0xffffff, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, fog: false });
  column = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 28, 1, true), colMat);
  column.position.y = HEIGHT / 2;
  column.renderOrder = 3;
  group.add(column);
  // the circle on the road: a bright edge and a soft disc inside it, on a pad that is scaled as the circle breathes (in
  // its own plane only) and tilted to a ramp's slope
  pad = new THREE.Group();
  pad.name = 'markCircle';
  ring = new THREE.Mesh(new THREE.RingGeometry(CIRCLE_MIN - EDGE, CIRCLE_MIN, 64),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = LIFT; ring.renderOrder = 3;
  fill = new THREE.Mesh(new THREE.CircleGeometry(CIRCLE_MIN - EDGE, 64),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = LIFT - 0.02; fill.renderOrder = 2;
  pad.add(ring, fill);
  group.add(pad);
  scene.add(group);
}

// The circle's radius at time t (in seconds): it breathes smoothly from CIRCLE_MIN out to CIRCLE_MAX and back.
const radiusAt = t => CIRCLE_MIN + (CIRCLE_MAX - CIRCLE_MIN) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / BREATH));

// The light's foot for a mark: its level (up: on a flyover's structure), the height it stands at (the structure's
// surface there, or the ground), and the circle's normal (on a ramp, tilted along the flyover by the ramp's slope).
function footOf(m) {
  const up = onDeck(m), n = new THREE.Vector3(0, 1, 0);
  if (!up) return { up, y: 0, n };
  const f = flyoverNear(m.x, m.z), u = alongOf(f, m.x, m.z);
  const slope = bridgeHeight(f, u + 0.5) - bridgeHeight(f, u - 0.5);     // the rise over one metre along the flyover
  if (f.axis === 'x') n.set(-slope, 1, 0); else n.set(0, 1, -slope);
  return { up, y: structureAt(m.x, m.z), n: n.normalize() };
}

// Is the car on the circle? It is on the mark's own level, and its centre is within ARRIVE_R of the mark on the map
// anywhere along the way it went since the last frame (so a fast car does not skip over the circle between two frames).
function onCircle(m, ft) {
  if (onDeck(player) !== ft.up) return false;
  let d = Math.hypot(player.x - m.x, player.z - m.z);
  if (last) {
    const dx = player.x - last.x, dz = player.z - last.z, L2 = dx * dx + dz * dz;
    if (L2 > 0 && L2 < JUMP * JUMP) {
      const s = Math.max(0, Math.min(1, ((m.x - last.x) * dx + (m.z - last.z) * dz) / L2));
      d = Math.min(d, Math.hypot(last.x + dx * s - m.x, last.z + dz * s - m.z));
    }
  }
  return d < ARRIVE_R;
}

function place(x, z, ft) {
  group.visible = true;
  group.position.set(x, ft.y, z);
  pad.quaternion.setFromUnitVectors(_up, ft.n);
}

// `now`: the time in milliseconds (performance.now(); the Node suite passes its own clock)
export function updateMarkBeam(now = performance.now()) {
  ensure();
  const t = now / 1000, m = currentMark();
  if (m && m !== shown) { shown = m; foot = footOf(m); gone = null; }
  if (m) {
    // The car on the circle: the mark is done, so it is cleared everywhere (the map, the radar, the road arrows), and the
    // light goes out. A mark set with the car already on its circle waits until the car has been off it.
    if (!onCircle(m, foot)) armed = m;
    else if (armed === m) { gone = { t0: t, x: m.x, z: m.z, foot, r: radiusAt(t) }; clearMark(); }
  }
  last = { x: player.x, z: player.z };
  if (currentMark()) {
    // the light stands, and the circle breathes: brightest drawn in, a little softer as it spreads
    const r = radiusAt(t), k = (r - CIRCLE_MIN) / (CIRCLE_MAX - CIRCLE_MIN);
    place(m.x, m.z, foot);
    pad.scale.set(r / CIRCLE_MIN, 1, r / CIRCLE_MIN);
    ring.material.opacity = 0.95 - 0.25 * k;
    fill.material.opacity = 0.26 - 0.1 * k;
    column.material.opacity = 1; column.scale.set(1, 1, 1);
    return;
  }
  shown = null;
  if (gone && t - gone.t0 < FADE) {
    // going out: the circle opens out and fades, and the column narrows and fades with it
    const e = (t - gone.t0) / FADE, s = gone.r * (1 + 0.8 * e) / CIRCLE_MIN;
    place(gone.x, gone.z, gone.foot);
    pad.scale.set(s, 1, s);
    ring.material.opacity = 0.9 * (1 - e) * (1 - e);
    fill.material.opacity = 0.22 * (1 - e);
    column.material.opacity = 1 - e; column.scale.set(1 - 0.7 * e, 1, 1 - 0.7 * e);
    return;
  }
  gone = null;
  group.visible = false;
}
