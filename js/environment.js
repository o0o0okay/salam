/* Day / night cycle, blended with the weather state */
import * as THREE from 'three';
import { PI, clamp, lerp, smooth } from './utils.js';
import { scene, camera, hemi, sun, skyGroup, sunDisc, moonDisc, starMat } from './renderer.js';
import { ASSET } from './assets.js';
import { pMesh } from './particles.js';
import { game } from './state.js';
import { weatherSystem } from './weather.js';

export const DAY_LEN = 200, DAY_START = 0.15;
export const env = { phase: DAY_START, day: 1, night: 0, dusk: 0, sx: 0.5, sy: 1 };
const C_DAY = new THREE.Color(0x9ad5ff), C_DUSK = new THREE.Color(0xff9a62), C_NIGHT = new THREE.Color(0x070c22), _sky = new THREE.Color();
const C_WEATHER = new THREE.Color(0x94a0a7);
const H_DAY = new THREE.Color(0xffffff), H_NIGHT = new THREE.Color(0x7d8cc8), G_DAY = new THREE.Color(0x8a9a7a), G_NIGHT = new THREE.Color(0x1d2433);
const S_DAY = new THREE.Color(0xfff4e0), S_DUSK = new THREE.Color(0xffa860), S_NIGHT = new THREE.Color(0x8fa8ff);
const _sv = new THREE.Vector3();

export function updateEnvironment(dt = 0, playerX = 0, playerZ = 0) {
  weatherSystem.update(dt, playerX, playerZ);

  env.phase = (DAY_START + game.clock / DAY_LEN) % 1;
  const a = env.phase * PI * 2, se = Math.sin(a);
  const day = smooth(-0.12, 0.3, se), dusk = clamp(1 - Math.abs(se) / 0.3, 0, 1);
  env.day = day; env.night = 1 - day; env.dusk = dusk;

  _sky.copy(C_NIGHT).lerp(C_DAY, day).lerp(C_DUSK, dusk * 0.6);
  _sky.lerp(C_WEATHER, weatherSystem.skyTint);
  scene.background.copy(_sky); scene.fog.color.copy(_sky);
  const baseNear = lerp(50, 95, day), baseFar = lerp(170, 215, day);
  scene.fog.near = lerp(baseNear, 8, weatherSystem.visibilityFog);
  scene.fog.far = lerp(baseFar, 48, weatherSystem.visibilityFog);

  const weatherDim = 1 - weatherSystem.lightDimming;
  hemi.intensity = lerp(0.6, 1.9, day) * weatherDim; hemi.color.copy(H_NIGHT).lerp(H_DAY, day); hemi.groundColor.copy(G_NIGHT).lerp(G_DAY, day);
  sun.intensity = lerp(0.45, 2.0, day) * (1 - weatherSystem.rain * 0.22 - weatherSystem.fog * 0.12);
  sun.color.copy(S_NIGHT).lerp(S_DAY, day).lerp(S_DUSK, dusk * 0.5);
  env.sx = se >= 0 ? Math.cos(a) : -Math.cos(a); env.sy = Math.max(0.32, Math.abs(se)); // moon takes over the light at night
  _sv.set(Math.cos(a) * 0.85, se, 0.5).normalize().multiplyScalar(320);
  sunDisc.position.copy(_sv); sunDisc.visible = _sv.y > 8; sunDisc.material.color.copy(S_DAY).lerp(S_DUSK, dusk);
  moonDisc.position.set(-_sv.x, -_sv.y, -_sv.z); moonDisc.visible = -_sv.y > 8;
  starMat.opacity = env.night * env.night;
  for (const m of ASSET.windowMats) m.emissiveIntensity = env.night * 0.95;
  ASSET.beamMat.opacity = env.night * 0.55; ASSET.beamMat.visible = env.night > 0.04;
  pMesh.material.color.setScalar(lerp(0.5, 1, day));
  skyGroup.position.copy(camera.position);
}
