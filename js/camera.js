/* Chase camera + menu orbit */
import * as THREE from 'three';
import { wrapAngle, lerp, rnd } from './utils.js';
import { camera } from './renderer.js';
import { game, player } from './state.js';

export const camState = { h: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), menuA: 0 };

export function updateCamera(dt) {
  if (game.state === 'menu') {
    camState.menuA += dt * 0.25; const a = camState.menuA;
    camera.position.set(player.x + Math.sin(a) * 17, 7.5, player.z + Math.cos(a) * 17); camera.lookAt(player.x, 1.5, player.z); camera.fov = 60; camera.updateProjectionMatrix(); return;
  }
  const sp = player.speed;
  camState.h += wrapAngle(player.h - camState.h) * (1 - Math.exp(-dt * 3.2));
  const dist = 14 + sp * 0.11, height = 8 + sp * 0.05, sh = Math.sin(camState.h), ch = Math.cos(camState.h);
  const dx = player.x - sh * dist, dz = player.z - ch * dist;
  const a = 1 - Math.exp(-dt * 8);
  camState.pos.x = lerp(camState.pos.x, dx, a); camState.pos.z = lerp(camState.pos.z, dz, a); camState.pos.y = lerp(camState.pos.y, height, 1 - Math.exp(-dt * 3));
  camState.look.x = lerp(camState.look.x, player.x + sh * 7, 1 - Math.exp(-dt * 10)); camState.look.z = lerp(camState.look.z, player.z + ch * 7, 1 - Math.exp(-dt * 10)); camState.look.y = 1.5;
  camera.position.copy(camState.pos);
  if (game.shake > 0.01) { camera.position.x += rnd(-1, 1) * game.shake; camera.position.y += rnd(-1, 1) * game.shake * 0.6; camera.position.z += rnd(-1, 1) * game.shake; game.shake *= Math.exp(-dt * 6); }
  camera.lookAt(camState.look);
  const fov = 58 + sp * 0.28 + player.boost * 9; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, 0.1); camera.updateProjectionMatrix(); }
}