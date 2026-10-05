/* Shared materials, geometries and textures */
import * as THREE from 'three';
import { CHUNK, PI, mulberry32 } from './utils.js';


const matCache = new Map();
export function mat(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, opts || {})); matCache.set(key, m); }
  return m;
}
const UNIT = new THREE.BoxGeometry(1, 1, 1);
export function box(w, h, d, material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(UNIT, material); m.scale.set(w, h, d); m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true; return m;
}
const geoCache = new Map();
export function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0, cast = true) {
  const key = [rt, rb, h, seg].join('_');
  let g = geoCache.get(key); if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg); geoCache.set(key, g); }
  const m = new THREE.Mesh(g, material); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; return m;
}


export const ASSET = {};
(function buildAssets() {
  // Road texture (shared across every chunk). Lines are drawn half-width on edges so neighbours join seamlessly.
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#3b3f4a'; g.fillRect(0, 0, 512, 512);
  const rr = mulberry32(7);
  for (let i = 0; i < 2200; i++) { g.fillStyle = rr() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)'; g.fillRect(rr() * 512, rr() * 512, 3, 3); }
  g.fillStyle = '#ffcf2e';
  for (let y = 70; y < 450; y += 40) { g.fillRect(0, y, 2.5, 22); g.fillRect(509.5, y, 2.5, 22); }
  for (let x = 70; x < 450; x += 40) { g.fillRect(x, 0, 22, 2.5); g.fillRect(x, 509.5, 22, 2.5); }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let x = 2; x < 50; x += 10) { // crosswalks across the vertical road ends
    for (const yy of [53, 451]) { g.fillRect(x, yy, 6, 8); g.fillRect(506 - x, yy, 6, 8); }
    for (const yy of [53, 451]) { g.fillRect(yy, x, 8, 6); g.fillRect(yy, 506 - x, 8, 6); }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  ASSET.roadMat = new THREE.MeshLambertMaterial({ map: tex });
  ASSET.groundGeo = new THREE.PlaneGeometry(CHUNK, CHUNK); ASSET.groundGeo.rotateX(-PI / 2);
  // Window texture (4x4 windows) + emissive map (lit windows at night)
  const w = document.createElement('canvas'); w.width = w.height = 128; const wg = w.getContext('2d');
  wg.fillStyle = '#ffffff'; wg.fillRect(0, 0, 128, 128);
  const wr = mulberry32(99);
  for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) {
    const k = wr(); wg.fillStyle = k < 0.2 ? '#ffe08a' : k < 0.65 ? '#2d4261' : '#4f7fb5';
    wg.fillRect(q * 32 + 5, r * 32 + 7, 22, 18);
  }
  const wt = new THREE.CanvasTexture(w); wt.colorSpace = THREE.SRGBColorSpace; wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.anisotropy = 4;
  const e = document.createElement('canvas'); e.width = e.height = 128; const eg = e.getContext('2d');
  eg.fillStyle = '#000000'; eg.fillRect(0, 0, 128, 128);
  const er = mulberry32(99);
  for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) {
    const k = er(); if (k < 0.38) { eg.fillStyle = k < 0.2 ? '#ffd98a' : '#ffc46a'; eg.fillRect(q * 32 + 5, r * 32 + 7, 22, 18); }
  }
  const et = new THREE.CanvasTexture(e); et.colorSpace = THREE.SRGBColorSpace; et.wrapS = et.wrapT = THREE.RepeatWrapping;
  const pal = [0xe9ecef, 0xf8c8a0, 0xa8d5ff, 0xc9b6ff, 0xffd6a5, 0xb9f0c1, 0xffb3b3];
  ASSET.windowMats = pal.map(col => new THREE.MeshLambertMaterial({ color: col, map: wt, flatShading: true, emissive: 0xffffff, emissiveMap: et, emissiveIntensity: 0 }));
  ASSET.roofMat = mat(0x8b9099);
  ASSET.lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
  ASSET.coinGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.22, 12).rotateX(PI / 2);
  ASSET.coinMat = new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x7a5200, flatShading: true });
  ASSET.roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(PI / 4);
  ASSET.wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 12).rotateZ(PI / 2);
  // Cement-mixer drum: bulbous lathe-profile barrel (tapered nose -> wide belly -> flared hopper mouth)
  const mixerPts = [
    [1.18, -2.60], [1.00, -2.28], [0.88, -1.90], [1.00, -1.35], [1.20, -0.65],
    [1.30, 0.10], [1.22, 0.80], [1.00, 1.45], [0.72, 1.95], [0.30, 2.35], [0.00, 2.55],
  ].map(p => new THREE.Vector2(p[0], p[1]));
  ASSET.mixerDrumGeo = new THREE.LatheGeometry(mixerPts, 12).rotateX(PI / 2);
  ASSET.mixerCollarGeo = new THREE.CylinderGeometry(1.2, 1.42, 0.5, 12).rotateX(PI / 2);
  ASSET.mixerCapGeo = new THREE.CircleGeometry(1.1, 12);
  // diagonal "helical fin" rib texture for the mixer drum surface
  const mc = document.createElement('canvas'); mc.width = 64; mc.height = 128; const mg = mc.getContext('2d');
  mg.fillStyle = '#ffffff'; mg.fillRect(0, 0, 64, 128);
  mg.strokeStyle = 'rgba(0,0,0,0.16)'; mg.lineWidth = 7;
  for (let i = -128; i < 128; i += 22) { mg.beginPath(); mg.moveTo(i, 128); mg.lineTo(i + 128, 0); mg.stroke(); }
  mg.strokeStyle = 'rgba(255,255,255,0.4)'; mg.lineWidth = 3;
  for (let i = -117; i < 128; i += 22) { mg.beginPath(); mg.moveTo(i, 128); mg.lineTo(i + 128, 0); mg.stroke(); }
  const mixerTex = new THREE.CanvasTexture(mc); mixerTex.wrapS = mixerTex.wrapT = THREE.RepeatWrapping; mixerTex.repeat.set(4, 1); mixerTex.anisotropy = 4;
  ASSET.mixerTex = mixerTex;
  // Fuel-tanker tank (unchanged — plain smooth tank, correct for a real tanker)
  ASSET.tankGeo = new THREE.CylinderGeometry(1.15, 1.15, 6.6, 18).rotateX(PI / 2);
  ASSET.tankCapGeo = new THREE.SphereGeometry(1.15, 18, 10, 0, PI * 2, 0, PI / 2).rotateX(PI / 2);
  ASSET.burnt = mat(0x2a2a2d);
  ASSET.headMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  ASSET.tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  // Headlight beam on the ground (one shared geometry/material, opacity driven by night factor)
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1.4, 0, 2.0, 1.4, 0, 2.0, 5.5, 0, 26, -5.5, 0, 26]), 3));
  bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, .95, .7, .6, 1, .95, .7, .6, 1, .95, .7, 0, 1, .95, .7, 0]), 4));
  bg.setIndex([0, 1, 2, 0, 2, 3]);
  ASSET.beamGeo = bg;
  ASSET.beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // Spike strip parts
  ASSET.spikeGeo = new THREE.ConeGeometry(0.16, 0.7, 4);
  ASSET.spikeMat = mat(0xdfe3e8);
  ASSET.spikeLit = new THREE.MeshBasicMaterial({ color: 0xff2020 });
})();


const mixerMatCache = new Map();
export function mixerMat(color) {
  let m = mixerMatCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color, map: ASSET.mixerTex, flatShading: true }); mixerMatCache.set(color, m); }
  return m;
}


export function makeBuildingGeo(w, h, d, cell = 16) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    let su, sv;
    if (f < 2) { su = d; sv = h; } else if (f < 4) { su = w; sv = d; } else { su = w; sv = h; }
    su = Math.max(1, Math.round(su / cell)); sv = Math.max(1, Math.round(sv / cell));
    for (let i = 0; i < 4; i++) { const idx = f * 4 + i; uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv); }
  }
  uv.needsUpdate = true; return g;
}