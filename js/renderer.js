import * as THREE from 'three';
import { $, PI } from './utils.js';

export const SKY = 0x9ad5ff;
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The shadow map is the single most expensive thing on screen: it draws every caster a second time, at 2048².
// Its contents only change when cars move, so the frame loop refreshes it on a cadence (see js/main.js) rather
// than every frame. On a retina display the pixel ratio is the other half of the fill cost, so it is capped and
// then driven by the frame-time controller.
renderer.shadowMap.autoUpdate = false;
$('game').appendChild(renderer.domElement);

// Quality tiers, best first: render resolution and shadow-map resolution. The frame loop walks down the list
// when frames take too long and back up when there is headroom, so a weak GPU still drives smoothly and a
// strong one gets the sharp picture back.
export const QUALITY = [
  { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadow: 2048, shadowsEvery: 2 },
  { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadow: 2048, shadowsEvery: 2 },
  { pixelRatio: 1, shadow: 1024, shadowsEvery: 3 },
  { pixelRatio: 0.85, shadow: 1024, shadowsEvery: 4 },
];
export let qualityLevel = 0;
export function applyQuality(level) {
  const q = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, level))];
  if (!q) return qualityLevel;
  qualityLevel = QUALITY.indexOf(q);
  renderer.setPixelRatio(q.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (sun.shadow.mapSize.width !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }   // three.js allocates the next one
  }
  renderer.shadowMap.needsUpdate = true;
  return qualityLevel;
}

export const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 95, 215);
export const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 400);

export const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.9); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 300;
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06;
scene.add(sun); scene.add(sun.target);

// Player headlight: created once at boot so the light count never changes (no shader recompiles)
export const headLight = new THREE.SpotLight(0xfff0c8, 0, 78, 0.55, 0.6, 1.2);
scene.add(headLight, headLight.target);

// Sky objects (follow the camera): sun disc, moon disc, stars
export const skyGroup = new THREE.Group(); scene.add(skyGroup);
export const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
export const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 12, 8), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
const starPos = new Float32Array(360 * 3);
for (let i = 0; i < 360; i++) {
  const u = Math.random() * PI * 2, v = Math.random() * 0.95 + 0.05, r = Math.sqrt(1 - v * v);
  starPos[i * 3] = Math.cos(u) * r * 330; starPos[i * 3 + 1] = v * 330; starPos[i * 3 + 2] = Math.sin(u) * r * 330;
}
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
export const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false;
sunDisc.frustumCulled = false; moonDisc.frustumCulled = false;
skyGroup.add(sunDisc, moonDisc, stars);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});