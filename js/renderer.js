import * as THREE from 'three';
import { $, PI } from './utils.js';

export const SKY = 0x9ad5ff;
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

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