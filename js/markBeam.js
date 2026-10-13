/* The marked place (js/map.js) in the world: a GTA-style column of red light, standing on the spot, with a glowing ring on the
 * ground round its foot. It is visible from a distance, so the way to the mark can be seen even before the arrows are near.
 * It stands only while there is a mark, and goes when the mark is cleared or the game restarts (currentMark is null). */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { currentMark } from './map.js';
import { player } from './state.js';

const ARRIVE_R = 15;            // within this many metres of the mark the car has arrived, and the light goes

const HEIGHT = 80;              // the column's height, in metres
const RADIUS = 1.6;             // its radius
const RED = '#ff3b2a';

let group = null, column = null, ring = null, halo = null;

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
  group.visible = false;
  const colMat = new THREE.MeshBasicMaterial({ map: fadeTexture(), color: 0xffffff, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, fog: false });
  column = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 28, 1, true), colMat);
  column.position.y = HEIGHT / 2;
  column.renderOrder = 3;
  group.add(column);
  // the ring on the ground, bright, and a soft disc inside it
  ring = new THREE.Mesh(new THREE.RingGeometry(RADIUS * 1.2, RADIUS * 2.6, 48),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; ring.renderOrder = 3;
  group.add(ring);
  halo = new THREE.Mesh(new THREE.CircleGeometry(RADIUS * 3.6, 48),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.1; halo.renderOrder = 2;
  group.add(halo);
  scene.add(group);
}

export function updateMarkBeam() {
  ensure();
  const m = currentMark();
  // the light stands until the car is on the spot; then it goes (the mark itself stays on the map and the radar)
  if (!m || Math.hypot(m.x - player.x, m.z - player.z) < ARRIVE_R) { group.visible = false; return; }
  group.visible = true;
  group.position.set(m.x, 0, m.z);
  // the ring breathes slowly, so the spot reads as live
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 3);
  ring.material.opacity = 0.55 + 0.35 * pulse;
  ring.scale.setScalar(1 + 0.08 * pulse);
}
