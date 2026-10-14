/* The diagonal avenues as road: the asphalt, a kerb on each side and a dashed centre line (js/avenues.js).
 * Built once, when the city first starts, and kept for the whole run: the avenue is part of the map, not of a block. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';
import { AVENUES, AVENUE_W } from './avenues.js';

const AV_DASH = 3, AV_GAP = 8, AV_KERB_W = 0.5, AV_KERB_H = 0.12;   // centre dashes 3 m long, one every 11 m; kerbs half a metre wide
let built = false;

export function buildAvenueRoad() {
  if (built) return;
  built = true;
  const group = new THREE.Group();
  const paint = new THREE.MeshBasicMaterial({ color: 0xf2f1ea });
  const kerbMat = ASSET.curbMat || new THREE.MeshBasicMaterial({ color: 0xb7bbc0 });
  for (const av of AVENUES) {
    const [ax, az] = av.a, [bx, bz] = av.b;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);                       // a box whose length runs along +z, turned to the avenue
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    // the lateral direction (the box's own x axis after the turn)
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    // the asphalt: a flat slab, its top at 0.12 m, above the grid's ground and markings
    const road = new THREE.Mesh(new THREE.BoxGeometry(AVENUE_W, 0.04, L), ASSET.roadMat);
    road.position.set(cx, 0.1, cz); road.rotation.y = yaw; road.receiveShadow = true;
    group.add(road);
    // a kerb on each side
    for (const side of [-1, 1]) {
      const off = side * (AVENUE_W / 2 + AV_KERB_W / 2);
      const k = new THREE.Mesh(new THREE.BoxGeometry(AV_KERB_W, AV_KERB_H, L), kerbMat);
      k.position.set(cx + lx * off, AV_KERB_H / 2, cz + lz * off); k.rotation.y = yaw; k.castShadow = true;
      group.add(k);
    }
    // the dashed centre line
    for (let s = AV_DASH / 2 + 2; s < L - AV_DASH / 2 - 2; s += AV_DASH + AV_GAP) {
      const t = s / L - 0.5;
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, AV_DASH), paint);
      dash.position.set(cx + dx * t, 0.14, cz + dz * t); dash.rotation.y = yaw;
      group.add(dash);
    }
  }
  scene.add(group);
}
