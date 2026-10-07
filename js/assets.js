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


// Repeating stone-slab texture: a grid of slabs with mortar joints, bevel shading (lit top/left edge, shaded
// bottom/right), a per-slab tint nudge and wrapped grime, so the tile is seamless and reads as real paving.
function stoneSlabs(px, cols, rows, palette, jointColor, seed, opts = {}) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'), rr = mulberry32(seed);
  const gw = px / cols, gh = px / rows, j = opts.joint === undefined ? Math.max(1, Math.round(px / 150)) : opts.joint;
  const bevel = opts.bevel === undefined ? 0.22 : opts.bevel;
  const col = new THREE.Color();
  g.fillStyle = jointColor; g.fillRect(0, 0, px, px);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    col.setHex(palette[Math.floor(rr() * palette.length)]);
    col.offsetHSL((rr() - 0.5) * 0.02, (rr() - 0.5) * 0.05, (rr() - 0.5) * 0.05);
    const x = q * gw, y = r * gh;
    g.fillStyle = '#' + col.getHexString(); g.fillRect(x + j, y + j, gw - j * 2, gh - j * 2);
    g.fillStyle = `rgba(255,255,255,${bevel})`;
    g.fillRect(x + j, y + j, gw - j * 2, j); g.fillRect(x + j, y + j, j, gh - j * 2);
    g.fillStyle = `rgba(0,0,0,${bevel * 0.9})`;
    g.fillRect(x + j, y + gh - j * 2, gw - j * 2, j); g.fillRect(x + gw - j * 2, y + j, j, gh - j * 2);
  }
  for (let i = 0; i < px / 4; i++) {                      // grime blotches, drawn wrapped on all sides
    const x = rr() * px, y = rr() * px, rad = 1 + rr() * (px / 55);
    g.fillStyle = `rgba(0,0,0,${rr() * 0.07})`;
    for (const ox of [-px, 0, px]) for (const oy of [-px, 0, px]) {
      const bx = x + ox, by = y + oy;
      if (bx + rad < 0 || bx - rad > px || by + rad < 0 || by - rad > px) continue;
      g.beginPath(); g.arc(bx, by, rad, 0, PI * 2); g.fill();
    }
  }
  for (let i = 0; i < px * 6; i++) {                      // fine speckle
    g.fillStyle = rr() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
    g.fillRect(rr() * px, rr() * px, 1.6, 1.6);
  }
  for (let k = 0; k < (opts.cracks || 0); k++) {           // hairline cracks
    const x0 = rr() * px, y0 = rr() * px, len = px * (0.35 + rr() * 0.5);
    let x = x0, y = y0, ang = rr() * PI * 2;
    g.strokeStyle = `rgba(30,30,32,${0.18 + rr() * 0.2})`; g.lineWidth = Math.max(1, px / 220);
    g.beginPath(); g.moveTo(x, y);
    for (let seg = 0; seg < 9; seg++) { ang += (rr() - 0.5) * 0.9; x += Math.cos(ang) * len / 9; y += Math.sin(ang) * len / 9; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
// Running-bond brick paving for shopping streets: staggered courses with mortar joints, per-brick tint
// variation and relief, plus grime. Half-shifted courses are drawn three times so the tile wraps seamlessly.
function brickBond(px, cols, rows, palette, mortar, seed) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'), rr = mulberry32(seed);
  const bw = px / cols, bh = px / rows, j = Math.max(1, Math.round(px / 170));
  const col = new THREE.Color();
  g.fillStyle = mortar; g.fillRect(0, 0, px, px);
  const draw = (x, y, fill) => {
    g.fillStyle = fill; g.fillRect(x + j / 2, y + j / 2, bw - j, bh - j);
    g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x + j / 2, y + j / 2, bw - j, j);
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x + j / 2, y + bh - j * 1.5, bw - j, j);
  };
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw / 2;
    for (let q = -1; q <= cols; q++) {
      const x = q * bw + off, y = r * bh;
      col.setHex(palette[Math.floor(rr() * palette.length)]);
      col.offsetHSL((rr() - 0.5) * 0.03, (rr() - 0.5) * 0.09, (rr() - 0.5) * 0.08);
      const fill = '#' + col.getHexString();
      if (x >= 0 && x + bw <= px) draw(x, y, fill);
      else { draw(x, y, fill); draw(x - px, y, fill); draw(x + px, y, fill); }
    }
  }
  for (let i = 0; i < px / 4; i++) {                       // grime
    const x = rr() * px, y = rr() * px, rad = 1 + rr() * (px / 60);
    g.fillStyle = `rgba(0,0,0,${rr() * 0.06})`;
    for (const ox of [-px, 0, px]) for (const oy of [-px, 0, px]) { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, PI * 2); g.fill(); }
  }
  for (let i = 0; i < px * 5; i++) {
    g.fillStyle = rr() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    g.fillRect(rr() * px, rr() * px, 1.6, 1.6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
// Flat-colour noise texture: grass on the verges, and worn yellow paint on kerbs.
function noiseTex(hex, seed, opts = {}) {
  const px = opts.px || 128;
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'), rr = mulberry32(seed);
  const col = new THREE.Color(hex);
  g.fillStyle = '#' + col.getHexString(); g.fillRect(0, 0, px, px);
  const wfill = (x, y, w, h) => {                          // wrap draws across the tile edge
    const xs = [x], ys = [y];
    if (x + w > px) xs.push(x - px); if (y + h > px) ys.push(y - px);
    for (const X of xs) for (const Y of ys) g.fillRect(X, Y, w, h);
  };
  for (let i = 0; i < (opts.blotch || 0); i++) {           // soft tonal patches
    const t = col.clone().offsetHSL(0, (rr() - 0.5) * 0.1, (rr() - 0.5) * 0.16);
    g.fillStyle = '#' + t.getHexString(); g.globalAlpha = 0.5;
    g.beginPath(); g.arc(rr() * px, rr() * px, px * (0.05 + rr() * 0.13), 0, PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  for (let i = 0; i < (opts.blades || 0) * px; i++) {      // grass blades
    g.fillStyle = rr() < 0.5 ? `rgba(255,255,255,${0.06 + rr() * 0.08})` : `rgba(0,0,0,${0.07 + rr() * 0.1})`;
    wfill(rr() * px, rr() * px, 1.5, 3 + rr() * 5);
  }
  const grain = opts.grain === undefined ? 0.1 : opts.grain;
  for (let i = 0; i < px * px * 0.3; i++) {
    g.fillStyle = rr() < 0.5 ? `rgba(255,255,255,${grain * 0.5})` : `rgba(0,0,0,${grain})`;
    wfill(rr() * px, rr() * px, 1.8, 1.8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
// Damp earth for tree pits: dark soil speckled with grit and a few small stones.
function soilTex(px, seed) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'), rr = mulberry32(seed);
  g.fillStyle = '#4a3a29'; g.fillRect(0, 0, px, px);
  for (let i = 0; i < px * px; i++) {
    const v = rr();
    g.fillStyle = v < 0.45 ? `rgba(0,0,0,${0.1 + rr() * 0.3})`
      : v < 0.85 ? `rgba(120,90,60,${0.15 + rr() * 0.3})`
        : `rgba(150,140,125,${0.2 + rr() * 0.35})`;
    g.fillRect(rr() * px, rr() * px, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  t.anisotropy = 4;
  return t;
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
  ASSET.roadMat = new THREE.MeshPhongMaterial({
    map: tex,
    color: 0xffffff,
    specular: 0x101419,
    shininess: 5,
  });
  ASSET.groundGeo = new THREE.PlaneGeometry(CHUNK, CHUNK); ASSET.groundGeo.rotateX(-PI / 2);
  ASSET.snowRoadMat = new THREE.MeshBasicMaterial({
    color: 0xeaf5ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  // ---- Sidewalk surfaces ----
  // Stone paving for the sidewalk field: 0.6 m slabs, 8x8 per tile = one 4.8 m tile (see PAVE_TILE in world.js).
  ASSET.pavingMat = new THREE.MeshLambertMaterial({ map: stoneSlabs(512, 8, 8, [0xb6afa1, 0xaea797, 0xbfb8aa, 0xb1aa9b], '#6e6a5e', 21) });
  // Border course laid along the curb: same slabs, lighter and cooler so the band reads as a separate line.
  ASSET.borderMat = new THREE.MeshLambertMaterial({ map: stoneSlabs(256, 2, 2, [0xc6c9cd, 0xbfc3c7, 0xcdd0d4], '#8a8e93', 33) });
  // Curb stone top (1 m per tile, see CURB_TILE): offset slightly so it never fights with the curb body below.
  ASSET.curbTopMat = new THREE.MeshLambertMaterial({
    map: stoneSlabs(128, 1, 1, [0xc8cbcf], '#8f9398', 47, { bevel: 0.3 }),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // Heavy concrete panels for industrial / modern blocks: three big panels per tile, weathered with cracks.
  ASSET.pavePanelMat = new THREE.MeshLambertMaterial({ map: stoneSlabs(512, 3, 3, [0x9ea2a5, 0x97999c, 0xa8acaf], '#7b7e81', 61, { bevel: 0.12, joint: 3, cracks: 3 }) });
  // Red brick paving, laid in running bond, for shopping streets.
  ASSET.paveBrickMat = new THREE.MeshLambertMaterial({ map: brickBond(512, 10, 20, [0x9c4a35, 0xa8543c, 0x8e4530, 0xb05c42, 0x96503a], '#cfc7bb', 77) });
  // Grass verge between kerb and walkway — the suburban sidewalk treatment.
  ASSET.grassMat = new THREE.MeshLambertMaterial({ map: noiseTex(0x5d9a45, 88, { blotch: 24, blades: 9, grain: 0.06 }) });
  // Yellow-painted kerb top, worn by traffic.
  ASSET.curbPaintMat = new THREE.MeshLambertMaterial({
    map: noiseTex(0xd6bf4c, 44, { blotch: 14, grain: 0.09 }),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  ASSET.curbMat = mat(0xb7bbc0);      // curb bodies and the low kerb against the building line
  ASSET.soilMat = new THREE.MeshLambertMaterial({ map: soilTex(64, 55) });
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