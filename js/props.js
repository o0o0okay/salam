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
  dirtpile: { r: 0.9, drag: 0.9, color: 0x8a6a42, make() { const g = new THREE.Group();
    g.add(box(1.6, 0.5, 1.6, mat(0x8a6a42), 0, 0.25, 0, false));
    g.add(box(1.1, 0.4, 1.1, mat(0x9c7a4e), 0, 0.55, 0, false));
    g.add(box(0.6, 0.35, 0.6, mat(0xae8a5a), 0, 0.82, 0, false)); return g; } },
  pipe: { r: 0.9, drag: 0.93, color: 0x6c7580, make() { const g = new THREE.Group(), m = mat(0x6c7580);
    const mkPipe = (z, y) => { const p = cyl(0.18, 0.18, 1.7, 10, m, 0, y, z, false); p.rotation.z = Math.PI / 2; return p; };
    g.add(mkPipe(-0.2, 0.18)); g.add(mkPipe(0.2, 0.18)); g.add(mkPipe(0, 0.5)); return g; } },
};