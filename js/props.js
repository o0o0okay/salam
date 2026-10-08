/* Breakable street props */
import { mat, box, cyl, ASSET } from './assets.js';
import * as THREE from 'three';



export const PROP_DEFS = {
  streetlight: { r: 0.85, drag: 0.9, color: 0x8a8f98, make() { const g = new THREE.Group(), m = mat(0x7d838c);
    g.add(cyl(0.14, 0.2, 7, 8, m, 0, 3.5, 0, false)); g.add(box(1.8, 0.14, 0.14, m, 0.8, 7, 0, false)); g.add(box(0.7, 0.16, 0.4, ASSET.lampMat, 1.55, 6.88, 0, false)); return g; } },
  cone: { r: 0.65, drag: 0.97, color: 0xff7a1a, make() { const g = new THREE.Group();
    g.add(cyl(0.12, 0.42, 0.95, 8, mat(0xff7a1a), 0, 0.55, 0, false)); g.add(cyl(0.2, 0.28, 0.2, 8, mat(0xffffff), 0, 0.6, 0, false)); g.add(box(0.95, 0.08, 0.95, mat(0x2a2a2a), 0, 0.04, 0, false)); return g; } },
  barrier: { r: 1.5, drag: 0.93, color: 0xf0f0f0, make() { const g = new THREE.Group();
    g.add(box(3.4, 0.9, 0.6, mat(0xf2f2f2), 0, 0.75, 0, false)); g.add(box(0.5, 0.92, 0.62, mat(0xe03a3a), -1.0, 0.75, 0, false)); g.add(box(0.5, 0.92, 0.62, mat(0xe03a3a), 0.2, 0.75, 0, false));
    g.add(box(0.15, 0.5, 0.15, mat(0x444444), -1.4, 0.25, 0, false)); g.add(box(0.15, 0.5, 0.15, mat(0x444444), 1.4, 0.25, 0, false)); return g; } },
  crate: { r: 1.1, drag: 0.94, color: 0xa87440, make() { const g = new THREE.Group();
    g.add(box(1.7, 1.7, 1.7, mat(0xa87440), 0, 0.85, 0, false)); g.add(box(1.76, 0.18, 1.76, mat(0x7b5128), 0, 0.3, 0, false)); g.add(box(1.76, 0.18, 1.76, mat(0x7b5128), 0, 1.4, 0, false)); return g; } },
  barrel: { r: 0.8, drag: 0.94, color: 0xd64545, make() { const g = new THREE.Group(); const c = Math.random() < 0.5 ? 0xd64545 : 0x3b7ddd;
    g.add(cyl(0.6, 0.6, 1.3, 10, mat(c), 0, 0.65, 0, false)); g.add(cyl(0.62, 0.62, 0.12, 10, mat(0x222222), 0, 0.9, 0, false)); return g; } },
  fence: { r: 2.1, drag: 0.96, color: 0xf6f2e7, make() { const g = new THREE.Group();
    g.add(box(4, 0.9, 0.16, mat(0xf6f2e7), 0, 0.6, 0, false)); g.add(box(4.1, 0.12, 0.22, mat(0xcfc8b4), 0, 1.1, 0, false)); g.add(box(0.2, 1.2, 0.26, mat(0xcfc8b4), -1.95, 0.6, 0, false)); return g; } },
  bench: { r: 1.2, drag: 0.95, color: 0x9a6a3a, make() { const g = new THREE.Group();
    g.add(box(2.2, 0.14, 0.7, mat(0x9a6a3a), 0, 0.55, 0, false)); g.add(box(2.2, 0.5, 0.12, mat(0x9a6a3a), 0, 0.95, -0.3, false));
    g.add(box(0.14, 0.5, 0.6, mat(0x444444), -0.9, 0.25, 0, false)); g.add(box(0.14, 0.5, 0.6, mat(0x444444), 0.9, 0.25, 0, false)); return g; } },
  hydrant: { r: 0.55, drag: 0.985, color: 0xe53935, make() { const g = new THREE.Group(), m = mat(0xe53935);
    g.add(cyl(0.28, 0.32, 1.0, 8, m, 0, 0.5, 0, false)); g.add(cyl(0.36, 0.36, 0.14, 8, m, 0, 1.05, 0, false)); g.add(box(0.95, 0.24, 0.24, m, 0, 0.7, 0, false));
    g.add(cyl(0.17, 0.17, 0.3, 6, mat(0xffd23b), 0, 1.22, 0, false)); return g; } },
  trashcan: { r: 0.5, drag: 0.95, color: 0x4b5660, make() { const g = new THREE.Group();
    const body = Math.random() < 0.5 ? 0x4b5660 : 0x3f6b4a;
    g.add(cyl(0.38, 0.32, 1.0, 10, mat(body), 0, 0.5, 0, false));
    g.add(cyl(0.42, 0.42, 0.08, 10, mat(0x262b30), 0, 1.0, 0, false));
    g.add(box(0.3, 0.3, 0.3, mat(0xd8d2c0), 0, 1.08, 0, false)); return g; } },
  trashbag: { r: 0.45, drag: 0.96, color: 0x2e3338, make() { const g = new THREE.Group();
    const c = Math.random() < 0.5 ? 0x2e3338 : 0x3a4046;
    g.add(box(0.7, 0.55, 0.65, mat(c), 0, 0.3, 0, false));
    g.add(box(0.42, 0.28, 0.4, mat(c), 0.08, 0.6, -0.05, false)); return g; } },
  cardboard: { r: 0.45, drag: 0.96, color: 0xb98a55, make() { const g = new THREE.Group();
    const c = Math.random() < 0.5 ? 0xb98a55 : 0xc9a06a;
    g.add(box(0.75, 0.5, 0.6, mat(c), 0, 0.25, 0, false));
    g.add(box(0.77, 0.06, 0.62, mat(0x9a6f3f), 0, 0.51, 0, false));
    g.add(box(0.3, 0.07, 0.62, mat(0x9a6f3f), 0, 0.42, 0.31, false)); return g; } },
  sign: { r: 0.55, drag: 0.93, color: 0xff9a1a, make() { const g = new THREE.Group(), post = mat(0x55575c), board = mat(0xff9a1a), stripe = mat(0x2a2a2a);
    g.add(box(0.1, 1.3, 0.1, post, 0, 0.65, 0, false));
    const b = box(0.95, 0.95, 0.08, board, 0, 1.5, 0, false); b.rotation.z = Math.PI / 4; g.add(b);
    const s1 = box(1.25, 0.16, 0.09, stripe, 0, 1.5, 0.002, false); s1.rotation.z = Math.PI / 4; g.add(s1);
    return g; } },
  drum: { r: 0.5, drag: 0.94, color: 0xff7a1a, make() { const g = new THREE.Group(), m = mat(0xff7a1a), w = mat(0xf0f0f0);
    g.add(cyl(0.34, 0.4, 0.9, 10, m, 0, 0.45, 0, false));
    g.add(cyl(0.345, 0.405, 0.16, 10, w, 0, 0.64, 0, false));
    g.add(cyl(0.345, 0.405, 0.16, 10, w, 0, 0.26, 0, false)); return g; } },
  mailbox: { r: 0.75, drag: 0.9, color: 0x2f3f6b, make() { const g = new THREE.Group(), body = mat(0x2f3f6b), dark = mat(0x1d2540);
    for (const sx of [-1, 1]) g.add(box(0.13, 0.55, 0.13, dark, sx * 0.34, 0.28, 0, false));
    g.add(box(0.98, 0.82, 0.78, body, 0, 0.96, 0, false));
    const lid = cyl(0.39, 0.39, 0.98, 12, body, 0, 1.37, 0, false); lid.rotation.z = Math.PI / 2; g.add(lid);
    g.add(box(1.02, 0.1, 0.82, dark, 0, 0.52, 0, false));
    g.add(box(0.44, 0.3, 0.04, mat(0xd8dde6), -0.22, 1.06, 0.4, false));
    return g; } },
  meter: { r: 0.3, drag: 0.9, color: 0x9aa0a6, make() { const g = new THREE.Group(), m = mat(0x9aa0a6), dark = mat(0x2a2d33);
    g.add(cyl(0.05, 0.06, 1.3, 6, m, 0, 0.65, 0, false));
    g.add(box(0.23, 0.36, 0.23, m, 0, 1.45, 0, false));
    g.add(box(0.17, 0.2, 0.03, dark, 0, 1.48, 0.12, false));
    g.add(box(0.32, 0.06, 0.32, dark, 0, 0.05, 0, false));
    return g; } },
  sandwich: { r: 0.7, drag: 0.97, color: 0xf4f1e6, make() { const g = new THREE.Group(), white = mat(0xf4f1e6), dark = mat(0x2a2a2a);
    for (const sz of [-1, 1]) { const b = box(0.92, 1.2, 0.07, white, 0, 0.65, sz * 0.24, false); b.rotation.x = sz * 0.2; g.add(b); }
    g.add(box(0.98, 0.08, 0.66, dark, 0, 0.05, 0, false));
    const band = box(0.7, 0.17, 0.03, mat(0xd64545), 0, 1.0, -0.33, false); band.rotation.x = -0.2; g.add(band);
    const band2 = box(0.6, 0.12, 0.03, mat(0x2a4d9c), 0, 0.74, -0.37, false); band2.rotation.x = -0.2; g.add(band2);
    return g; } },
  hedge: { r: 1.35, drag: 0.98, color: 0x3f8a3c, make() { const g = new THREE.Group(), leaf = mat(0x3f8a3c), leaf2 = mat(0x4e9c48);
    g.add(box(2.7, 1.0, 0.95, leaf, 0, 0.62, 0, false));
    g.add(box(2.3, 0.34, 1.0, leaf2, 0, 1.22, 0, false));
    g.add(box(1.3, 0.3, 0.95, leaf, 0.45, 1.46, 0, false));
    g.add(box(1.5, 0.26, 0.9, leaf2, -0.6, 1.4, 0, false));
    return g; } },
  dirtpile: { r: 0.9, drag: 0.9, color: 0x8a6a42, make() { const g = new THREE.Group();
    g.add(box(1.6, 0.5, 1.6, mat(0x8a6a42), 0, 0.25, 0, false));
    g.add(box(1.1, 0.4, 1.1, mat(0x9c7a4e), 0, 0.55, 0, false));
    g.add(box(0.6, 0.35, 0.6, mat(0xae8a5a), 0, 0.82, 0, false)); return g; } },
  pipe: { r: 0.9, drag: 0.93, color: 0x6c7580, make() { const g = new THREE.Group(), m = mat(0x6c7580);
    const mkPipe = (z, y) => { const p = cyl(0.18, 0.18, 1.7, 10, m, 0, y, z, false); p.rotation.z = Math.PI / 2; return p; };
    g.add(mkPipe(-0.2, 0.18)); g.add(mkPipe(0.2, 0.18)); g.add(mkPipe(0, 0.5)); return g; } },
  // Plaza features: each is a destructible prop — a car that drives into it knocks it down, just like a
  // hydrant or a streetlight. They live in the middle of a plaza island (js/world.js places them via prop()),
  // and the island's curb is low (0.3 m) so a car can drive over the island after smashing the centre.
  plazaFountain: { r: 1.8, drag: 0.92, color: 0x3aa8d8, make() {
    const g = new THREE.Group(), stone = mat(0xbfb7a8), water = mat(0x3aa8d8, { emissive: 0x0a3a50 });
    for (let i = 0; i < 3; i++) { const r = 1.6 - i * 0.45, y = 0.35 + i * 0.55;
      g.add(cyl(r, r, 0.22, 20, stone, 0, y, 0, false)); g.add(cyl(r - 0.08, r - 0.08, 0.1, 20, water, 0, y + 0.16, 0, false)); }
    g.add(cyl(0.12, 0.12, 1.4, 10, water, 0, 1.05, 0, false));
    g.add(cyl(0.08, 0.08, 0.5, 8, water, 0, 1.8, 0, false));
    return g; } },
  plazaStatue: { r: 1.2, drag: 0.9, color: 0xb87333, make() {
    const g = new THREE.Group(), bronze = mat(0xb87333, { emissive: 0x3a1e0a }), stone = mat(0xbfb7a8);
    g.add(cyl(1.1, 1.1, 0.5, 16, stone, 0, 0.55, 0, false));
    g.add(cyl(0.7, 0.9, 1.6, 8, bronze, 0, 1.6, 0, false));
    g.add(box(0.5, 1.0, 0.5, bronze, 0, 2.8, 0, false));
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), bronze); top.position.set(0, 3.5, 0); g.add(top);
    return g; } },
  plazaTree: { r: 1.5, drag: 0.88, color: 0x2a6a28, make() {
    const g = new THREE.Group(), trunk = mat(0x5a3a1e), leaf = mat(0x2a6a28);
    const pts = [[0, 1.1], [-0.95, -0.55], [0.95, -0.55]];
    for (const [px, pz] of pts) { g.add(cyl(0.14, 0.14, 1.4, 6, trunk, px, 0.95, pz, false));
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), leaf); top.position.set(px, 2.0, pz); g.add(top); }
    g.add(cyl(1.8, 1.8, 0.18, 16, mat(0xbfb7a8), 0, 0.39, 0, false));
    return g; } },
};