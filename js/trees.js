/* Destructible trees: 6 vertex-colored variants rendered via InstancedMesh */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ASSET } from './assets.js';

export const TREE_VARIANTS = [];
export const _Y = new THREE.Vector3(0, 1, 0);
const _td = new THREE.Object3D();

(function buildTreeVariants() {
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const part = (geo, color, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const g = geo.clone(); g.scale(sx, sy, sz); g.translate(x, y, z);
    const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g;
  };
  const trunk = 0x7a5230;
  for (const gc of [0x4caf50, 0x3f9e48, 0x66bb6a, 0x2e8b57]) TREE_VARIANTS.push(mergeGeometries([
    part(BOX, trunk, 0, 1.2, 0, 0.9, 2.4, 0.9),
    part(BOX, gc, 0, 3.6, 0, 3.4, 2.4, 3.4),
    part(BOX, gc === 0x4caf50 ? 0x5cc060 : 0x4caf50, 0, 5.4, 0, 2.2, 1.6, 2.2)]));
  const c1 = new THREE.CylinderGeometry(0.01, 2.2, 3.0, 6), c2 = new THREE.CylinderGeometry(0.01, 1.7, 2.4, 6);
  for (const [a, b] of [[0x2f7d46, 0x37904f], [0x2b6e40, 0x3a9455]]) TREE_VARIANTS.push(mergeGeometries([
    part(BOX, trunk, 0, 1.2, 0, 0.9, 2.4, 0.9), part(c1, a, 0, 3.4, 0), part(c2, b, 0, 5.2, 0)]));
  ASSET.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
})();

export function setTreeMatrix(t, s) {
  _td.position.set(t.x, t.y, t.z); _td.rotation.set(0, t.rot, 0); _td.scale.setScalar(s); _td.updateMatrix();
  t.im.setMatrixAt(t.i, _td.matrix);
}