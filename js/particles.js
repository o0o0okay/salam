/* Particles (single InstancedMesh) + effect helpers */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { rnd } from './utils.js';

const MAXP = 700;
export const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXP);
pMesh.frustumCulled = false; pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(pMesh);
const parts = []; const dummy = new THREE.Object3D(); const tmpCol = new THREE.Color(); let pIdx = 0, colorDirty = false;
for (let i = 0; i < MAXP; i++) {
  parts.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grav: 0, kind: 0, vis: false });
  pMesh.setColorAt(i, tmpCol.setHex(0xffffff)); dummy.scale.set(0, 0, 0); dummy.updateMatrix(); pMesh.setMatrixAt(i, dummy.matrix);
}
export function emit(x, y, z, vx, vy, vz, color, size, life, grav, kind = 0) {
  const i = pIdx; pIdx = (pIdx + 1) % MAXP; const p = parts[i];
  p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.size = size; p.life = p.max = life; p.grav = grav; p.kind = kind; p.vis = true;
  pMesh.setColorAt(i, tmpCol.setHex(color)); colorDirty = true;
}
export function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    const p = parts[i];
    if (p.life <= 0) { if (p.vis) { dummy.scale.set(0, 0, 0); dummy.updateMatrix(); pMesh.setMatrixAt(i, dummy.matrix); p.vis = false; } continue; }
    p.life -= dt; p.vy -= p.grav * dt;
    if (p.kind === 1) { const d = Math.exp(-1.5 * dt); p.vx *= d; p.vz *= d; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.kind !== 1 && p.y < 0.12) { p.y = 0.12; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
    const t = 1 - Math.max(0, p.life) / p.max; let s = p.size;
    if (p.kind === 1) s *= t < 0.2 ? 0.4 + t * 3 : Math.max(0.01, 1 - (t - 0.2) * 1.1); else s *= Math.max(0.01, 1 - t * t);
    dummy.position.set(p.x, p.y, p.z); dummy.scale.setScalar(s); dummy.rotation.set(t * 6, t * 4, 0); dummy.updateMatrix(); pMesh.setMatrixAt(i, dummy.matrix);
  }
  pMesh.instanceMatrix.needsUpdate = true;
  if (colorDirty && pMesh.instanceColor) { pMesh.instanceColor.needsUpdate = true; colorDirty = false; }
}
export function clearParticles() { for (const p of parts) p.life = 0; }
export function sparks(x, y, z, n, nx = 0, nz = 0, power = 10) {
  for (let i = 0; i < n; i++) emit(x, y, z, rnd(-1, 1) * power - nx * power * 0.3, rnd(2, 8), rnd(-1, 1) * power - nz * power * 0.3, Math.random() < 0.5 ? 0xffe14a : 0xff9a2a, rnd(0.15, 0.3), rnd(0.3, 0.7), 22);
}
export function smoke(x, y, z, n, dark = false, size = 1.4) {
  for (let i = 0; i < n; i++) { const g = dark ? rnd(0.12, 0.25) : rnd(0.65, 0.9); emit(x + rnd(-.5, .5), y, z + rnd(-.5, .5), rnd(-1.2, 1.2), rnd(1.5, 3.5), rnd(-1.2, 1.2), tmpCol.setRGB(g, g, g).getHex(), rnd(size * .6, size * 1.3), rnd(0.7, 1.4), 0, 1); }
}
export function debris(x, y, z, color, n) { for (let i = 0; i < n; i++) emit(x, y, z, rnd(-6, 6), rnd(3, 10), rnd(-6, 6), color, rnd(0.2, 0.55), rnd(0.8, 1.6), 24); }
export function explosion(x, z) {
  for (let i = 0; i < 40; i++) emit(x, 1, z, rnd(-9, 9), rnd(2, 12), rnd(-9, 9), [0xff5a1a, 0xffb21a, 0xffe14a][i % 3], rnd(0.5, 1.4), rnd(0.5, 1.1), 12);
  smoke(x, 1.5, z, 14, true, 2.4);
  for (let i = 0; i < 14; i++) emit(x, 1, z, rnd(-8, 8), rnd(3, 12), rnd(-8, 8), 0x2a2a2d, rnd(0.3, 0.7), rnd(1, 1.8), 24);
}