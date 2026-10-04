/* Day / night cycle + smooth, testable weather presets */
import * as THREE from 'three';
import { PI, clamp, lerp, smooth } from './utils.js';
import { scene, camera, hemi, sun, skyGroup, sunDisc, moonDisc, starMat } from './renderer.js';
import { ASSET } from './assets.js';
import { pMesh } from './particles.js';
import { game } from './state.js';

export const DAY_LEN = 200, DAY_START = 0.15;
export const env = { phase: DAY_START, day: 1, night: 0, dusk: 0, sx: 0.5, sy: 1 };

// Rain and fog are visual effects; wetness persists after rain and drives vehicle physics.
export const weather = {
  mode: 'clear',
  rain: 0, fog: 0, wet: 0,
  targetRain: 0, targetFog: 0, targetWet: 0,
};
const WEATHER_PRESETS = {
  clear: { rain: 0, fog: 0, wet: 0 },
  rain:  { rain: 1, fog: 0.14, wet: 1 },
  fog:   { rain: 0, fog: 1, wet: 0 },
  wet:   { rain: 0, fog: 0, wet: 1 },
};
export function setWeather(mode) {
  const preset = WEATHER_PRESETS[mode];
  if (!preset) return false;
  weather.mode = mode;
  weather.targetRain = preset.rain;
  weather.targetFog = preset.fog;
  weather.targetWet = preset.wet;
  return true;
}

const C_DAY = new THREE.Color(0x9ad5ff), C_DUSK = new THREE.Color(0xff9a62), C_NIGHT = new THREE.Color(0x070c22), _sky = new THREE.Color();
const C_WEATHER = new THREE.Color(0x94a0a7);
const H_DAY = new THREE.Color(0xffffff), H_NIGHT = new THREE.Color(0x7d8cc8), G_DAY = new THREE.Color(0x8a9a7a), G_NIGHT = new THREE.Color(0x1d2433);
const S_DAY = new THREE.Color(0xfff4e0), S_DUSK = new THREE.Color(0xffa860), S_NIGHT = new THREE.Color(0x8fa8ff);
const _sv = new THREE.Vector3();

// One lightweight line-segment system, repositioned around the player instead of allocating drops every frame.
const RAIN_COUNT = 850, RAIN_RADIUS = 42, RAIN_LENGTH = 0.8;
const rainGeometry = new THREE.BufferGeometry();
const rainPositions = new Float32Array(RAIN_COUNT * 2 * 3);
const rainAttribute = new THREE.BufferAttribute(rainPositions, 3);
rainAttribute.setUsage(THREE.DynamicDrawUsage);
rainGeometry.setAttribute('position', rainAttribute);
const rainMaterial = new THREE.LineBasicMaterial({ color: 0xc4dbea, transparent: true, opacity: 0, depthWrite: false });
const rainMesh = new THREE.LineSegments(rainGeometry, rainMaterial);
rainMesh.frustumCulled = false;
rainMesh.visible = false;
scene.add(rainMesh);
const rainDrops = Array.from({ length: RAIN_COUNT }, () => ({ x: 0, y: 0, z: 0, speed: 0 }));
function resetRainDrop(drop, initial = false) {
  drop.x = (Math.random() * 2 - 1) * RAIN_RADIUS;
  drop.y = initial ? 2 + Math.random() * 29 : 22 + Math.random() * 18;
  drop.z = (Math.random() * 2 - 1) * RAIN_RADIUS;
  drop.speed = 20 + Math.random() * 16;
}
for (let i = 0; i < RAIN_COUNT; i++) resetRainDrop(rainDrops[i], true);

const WHITE = new THREE.Color(0xffffff);
const WET_ROAD_TINT = new THREE.Color(0xa0aab1);
const WET_SIDEWALK_TINT = new THREE.Color(0xb5bbb8);
const DRY_SPECULAR = new THREE.Color(0x101419);
const WET_ROAD_SPECULAR = new THREE.Color(0x9ab8c8);
const WET_SIDEWALK_SPECULAR = new THREE.Color(0x71858e);
function updateSurfaceMaterial(material, wet, road = false) {
  material.color.copy(WHITE).lerp(road ? WET_ROAD_TINT : WET_SIDEWALK_TINT, wet);
  if (material.specular) {
    material.specular.copy(DRY_SPECULAR).lerp(road ? WET_ROAD_SPECULAR : WET_SIDEWALK_SPECULAR, wet);
    material.shininess = (road ? 5 : 3) + wet * (road ? 72 : 42);
  }
}
function updateRain(dt, playerX, playerZ) {
  rainMesh.position.set(playerX, 0, playerZ);
  rainMesh.visible = weather.rain > 0.01;
  rainMaterial.opacity = weather.rain * 0.38;
  if (!rainMesh.visible) return;

  const positions = rainAttribute.array;
  const windX = 1.8 * weather.rain, windZ = 0.65 * weather.rain;
  for (let i = 0; i < RAIN_COUNT; i++) {
    const drop = rainDrops[i];
    drop.y -= drop.speed * dt;
    drop.x += windX * dt;
    drop.z += windZ * dt;
    if (drop.y < -1 || Math.abs(drop.x) > RAIN_RADIUS || Math.abs(drop.z) > RAIN_RADIUS) resetRainDrop(drop);

    const j = i * 6;
    positions[j] = drop.x; positions[j + 1] = drop.y; positions[j + 2] = drop.z;
    positions[j + 3] = drop.x + windX * 0.035;
    positions[j + 4] = drop.y - RAIN_LENGTH;
    positions[j + 5] = drop.z + windZ * 0.035;
  }
  rainAttribute.needsUpdate = true;
}

export function updateEnvironment(dt = 0, playerX = 0, playerZ = 0) {
  // Smoothly blend the selected preset. Wet pavement dries more slowly than rain stops.
  const rainBlend = 1 - Math.exp(-dt * 2.6);
  const fogBlend = 1 - Math.exp(-dt * 1.15);
  const wetRate = weather.targetWet > weather.wet ? 0.75 : 0.075;
  const wetBlend = 1 - Math.exp(-dt * wetRate);
  weather.rain = lerp(weather.rain, weather.targetRain, rainBlend);
  weather.fog = lerp(weather.fog, weather.targetFog, fogBlend);
  weather.wet = lerp(weather.wet, weather.targetWet, wetBlend);

  env.phase = (DAY_START + game.clock / DAY_LEN) % 1;
  const a = env.phase * PI * 2, se = Math.sin(a);
  const day = smooth(-0.12, 0.3, se), dusk = clamp(1 - Math.abs(se) / 0.3, 0, 1);
  env.day = day; env.night = 1 - day; env.dusk = dusk;

  _sky.copy(C_NIGHT).lerp(C_DAY, day).lerp(C_DUSK, dusk * 0.6);
  const fogAmount = clamp(Math.max(weather.fog, weather.rain * 0.12), 0, 1);
  _sky.lerp(C_WEATHER, clamp(weather.fog * 0.62 + weather.rain * 0.11, 0, 0.72));
  scene.background.copy(_sky); scene.fog.color.copy(_sky);
  const baseNear = lerp(50, 95, day), baseFar = lerp(170, 215, day);
  scene.fog.near = lerp(baseNear, 8, fogAmount);
  scene.fog.far = lerp(baseFar, 48, fogAmount);

  const weatherDim = 1 - weather.rain * 0.16 - weather.fog * 0.08;
  hemi.intensity = lerp(0.6, 1.9, day) * weatherDim; hemi.color.copy(H_NIGHT).lerp(H_DAY, day); hemi.groundColor.copy(G_NIGHT).lerp(G_DAY, day);
  sun.intensity = lerp(0.45, 2.0, day) * (1 - weather.rain * 0.22 - weather.fog * 0.12);
  sun.color.copy(S_NIGHT).lerp(S_DAY, day).lerp(S_DUSK, dusk * 0.5);
  env.sx = se >= 0 ? Math.cos(a) : -Math.cos(a); env.sy = Math.max(0.32, Math.abs(se)); // moon takes over the light at night
  _sv.set(Math.cos(a) * 0.85, se, 0.5).normalize().multiplyScalar(320);
  sunDisc.position.copy(_sv); sunDisc.visible = _sv.y > 8; sunDisc.material.color.copy(S_DAY).lerp(S_DUSK, dusk);
  moonDisc.position.set(-_sv.x, -_sv.y, -_sv.z); moonDisc.visible = -_sv.y > 8;
  starMat.opacity = env.night * env.night;
  for (const m of ASSET.windowMats) m.emissiveIntensity = env.night * 0.95;
  ASSET.beamMat.opacity = env.night * 0.55; ASSET.beamMat.visible = env.night > 0.04;
  pMesh.material.color.setScalar(lerp(0.5, 1, day));

  updateSurfaceMaterial(ASSET.roadMat, weather.wet, true);
  for (const m of ASSET.sidewalkMats) updateSurfaceMaterial(m, weather.wet, false);
  updateRain(dt, playerX, playerZ);
  skyGroup.position.copy(camera.position);
}
