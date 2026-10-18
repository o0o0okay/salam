/* Chase camera + menu orbit */
import * as THREE from 'three';
import { wrapAngle, lerp, rnd } from './utils.js';
import { camera } from './renderer.js';
import { game, player } from './state.js';
import { solidsNear } from './solidIndex.js';

export const camState = { h: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), menuA: 0, roofY: Infinity, duck: 0 };

// ---- under a roof ----
// A car can drive in under a roof: the first floor of a construction frame over its open ground floor (js/world.js,
// constructionSite), a solid with `headroom`. The camera rides 8 m up behind the car, so there it would look at the
// car through the floors. Under a roof it comes down under the slab instead: the line from the car up to the camera
// has to stay ROOF_GAP under the roof for as long as it is beneath it (roofLimit). That line starts lower the deeper
// the car is, so the camera comes down in front of the slab as the car drives in, and it stays down while it is
// under the roof itself, until it is out at the far end. The limit is also taken from where the car will be ROOF_LEAD
// seconds on, which starts the descent before the nose is under the slab and keeps it ahead of what the car needs;
// the camera then follows the limit down at ROOF_RATE instead of dropping onto it. Under the roof itself it is never
// let nearer the slab than ROOF_CLEAR, whatever it is following. While the car is under a roof the boom shortens by up
// to DUCK_PULL, so the car does not shrink away down the corridor of columns.
export const ROOF_GAP = 0.5, ROOF_CLEAR = 0.15, ROOF_LEAD = 0.3, ROOF_RATE = 14, DUCK_PULL = 0.3;
export const EYE = 1.5;                          // the point of the car the camera keeps in view, above its wheels
const _roofsCar = [], _roofsCam = [];
// The highest the camera at (cx, cz) may be for the line to a car's eye at (px, eyeY, pz) to pass under every roof the
// car or the camera is under: `out.y` (Infinity when there is none). `out.car`: the car itself is under one; `out.cam`:
// the underside of the lowest roof over the camera, less ROOF_CLEAR (Infinity when it is under none).
export function roofLimit(px, pz, eyeY, cx, cz, out = { y: Infinity, car: false, cam: Infinity }) {
  out.y = Infinity; out.car = false; out.cam = Infinity;
  for (const list of [solidsNear(px, pz, 1, _roofsCar), solidsNear(cx, cz, 1, _roofsCam)]) for (const r of list) {
    if (r.headroom === undefined || !(r.hx > 0)) continue;
    const carIn = Math.abs(px - r.x) <= r.hx && Math.abs(pz - r.z) <= r.hz;
    const camIn = Math.abs(cx - r.x) <= r.hx && Math.abs(cz - r.z) <= r.hz;
    if (!carIn && !camIn) continue;
    if (carIn) out.car = true;
    if (camIn) out.cam = Math.min(out.cam, r.headroom - ROOF_CLEAR);
    // t1: where the line from the car (t = 0) to the camera (t = 1) leaves the roof's footprint (1 when the camera is
    // under it). Up to there the line has to be under the roof, so the camera may be no higher than the line through it.
    let t1 = 1;
    if (!camIn) {
      const dx = cx - px, dz = cz - pz;
      if (dx > 1e-9) t1 = Math.min(t1, (r.x + r.hx - px) / dx); else if (dx < -1e-9) t1 = Math.min(t1, (r.x - r.hx - px) / dx);
      if (dz > 1e-9) t1 = Math.min(t1, (r.z + r.hz - pz) / dz); else if (dz < -1e-9) t1 = Math.min(t1, (r.z - r.hz - pz) / dz);
    }
    if (t1 > 1e-6) out.y = Math.min(out.y, eyeY + (r.headroom - ROOF_GAP - eyeY) / t1);
  }
  return out;
}
const _now = { y: Infinity, car: false, cam: Infinity }, _ahead = { y: Infinity, car: false, cam: Infinity }, _shook = { y: Infinity, car: false, cam: Infinity };

export function updateCamera(dt) {
  if (game.state === 'menu') {
    camState.menuA += dt * 0.25; const a = camState.menuA;
    camera.position.set(player.x + Math.sin(a) * 17, 7.5, player.z + Math.cos(a) * 17); camera.lookAt(player.x, 1.5, player.z); camera.fov = 60; camera.updateProjectionMatrix(); return;
  }
  const sp = player.speed;
  camState.h += wrapAngle(player.h - camState.h) * (1 - Math.exp(-dt * 3.2));
  // player.y rides a flyover deck, so the camera and its look-at climb with the car instead of sinking
  // into the deck it is standing on.
  const dist = (14 + sp * 0.11) * (1 - DUCK_PULL * camState.duck), height = player.y + 8 + sp * 0.05, sh = Math.sin(camState.h), ch = Math.cos(camState.h);
  const dx = player.x - sh * dist, dz = player.z - ch * dist;
  const a = 1 - Math.exp(-dt * 8);
  camState.pos.x = lerp(camState.pos.x, dx, a); camState.pos.z = lerp(camState.pos.z, dz, a); camState.pos.y = lerp(camState.pos.y, height, 1 - Math.exp(-dt * 3));
  // under a roof (see roofLimit): the limit for the car where it is and where it is going, followed down at ROOF_RATE
  const eye = player.y + EYE, cx = camState.pos.x, cz = camState.pos.z;
  roofLimit(player.x, player.z, eye, cx, cz, _now); roofLimit(player.x + player.vx * ROOF_LEAD, player.z + player.vz * ROOF_LEAD, eye, cx, cz, _ahead);
  const target = Math.min(_now.y, _ahead.y), from = Math.min(camState.roofY, camState.pos.y);
  camState.roofY = Math.min(target >= from ? target : lerp(from, target, 1 - Math.exp(-dt * ROOF_RATE)), _now.cam);
  if (camState.pos.y > camState.roofY) camState.pos.y = camState.roofY;
  // the boom is pulled in while the car is under a roof (or about to be), not while only the camera is: pulled in for
  // the camera's sake it would swing the camera back under the roof it has just left, and out again
  camState.duck = lerp(camState.duck, _now.car || _ahead.car ? 1 : 0, 1 - Math.exp(-dt * 4));
  camState.look.x = lerp(camState.look.x, player.x + sh * 7, 1 - Math.exp(-dt * 10)); camState.look.z = lerp(camState.look.z, player.z + ch * 7, 1 - Math.exp(-dt * 10)); camState.look.y = lerp(camState.look.y, player.y + 1.5, 1 - Math.exp(-dt * 10));
  camera.position.copy(camState.pos);
  if (game.shake > 0.01) {
    camera.position.x += rnd(-1, 1) * game.shake; camera.position.y += rnd(-1, 1) * game.shake * 0.6; camera.position.z += rnd(-1, 1) * game.shake; game.shake *= Math.exp(-dt * 6);
    // the shake moves the camera sideways too, and can carry it in under a roof's edge that roofY (taken where it was)
    // knows nothing of: it is kept ROOF_CLEAR under the slab where it has ended up as well
    roofLimit(player.x, player.z, eye, camera.position.x, camera.position.z, _shook);
    if (camera.position.y > _shook.cam) camera.position.y = _shook.cam;
  }
  if (camera.position.y > camState.roofY) camera.position.y = camState.roofY;   // a shake does not lift it into the slab
  camera.lookAt(camState.look);
  const fov = 58 + sp * 0.28 + player.boost * 9; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, 0.1); camera.updateProjectionMatrix(); }
}
