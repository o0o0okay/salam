/* Breakable street props */
import { mat, box, cyl, ASSET } from './assets.js';
import * as THREE from 'three';



// The upper half of a cylinder lying along z (once turned by rotation.x = -PI/2): an arch, open at its flat side, which
// stands on whatever it tops. Cached by its size, as cyl() caches its cylinders. `open` leaves its ends off.
const halfCache = new Map();
function halfCyl(r, len, seg, open = false) {
  const key = [r, len, seg, open].join('_');
  let g = halfCache.get(key);
  if (!g) { g = new THREE.CylinderGeometry(r, r, len, seg, 1, open, -Math.PI / 2, Math.PI); halfCache.set(key, g); }
  return g;
}
// A segmental arch slab: its flat underside on y = 0 from x = -span/2 to span/2, its top a circular arc that rises `rise`
// in the middle, the whole running `depth` along z. Indexed, with normals and uvs as a box has them, so a prop's arches
// merge with its boxes into one vertex-coloured mesh (js/chunkBake.js mergeStandalone). Cached by its size.
const archCache = new Map();
function archSlab(span, rise, depth, seg = 10) {
  const key = [span, rise, depth, seg].join('_');
  let g = archCache.get(key);
  if (g) return g;
  const a = span / 2, R = (a * a + rise * rise) / (2 * rise), yc = rise - R, t0 = Math.asin(a / R), d = depth / 2;
  const pos = [], nor = [], idx = [];
  const v = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); return pos.length / 3 - 1; };
  const arc = [];
  for (let i = 0; i <= seg; i++) { const t = -t0 + 2 * t0 * i / seg; arc.push([R * Math.sin(t), yc + R * Math.cos(t), Math.sin(t), Math.cos(t)]); }
  for (const sz of [-1, 1]) {                                     // the arched ends, each a fan from its springing line's middle
    const c = v(0, 0, sz * d, 0, 0, sz), ring = arc.map(([x, y]) => v(x, y, sz * d, 0, 0, sz));
    for (let i = 0; i < seg; i++) { if (sz > 0) idx.push(c, ring[i + 1], ring[i]); else idx.push(c, ring[i], ring[i + 1]); }
  }
  for (let i = 0; i < seg; i++) {                                 // the vault over the top
    const [x0, y0, nx0, ny0] = arc[i], [x1, y1, nx1, ny1] = arc[i + 1];
    const a0 = v(x0, y0, -d, nx0, ny0, 0), b0 = v(x0, y0, d, nx0, ny0, 0), a1 = v(x1, y1, -d, nx1, ny1, 0), b1 = v(x1, y1, d, nx1, ny1, 0);
    idx.push(a0, b0, b1, a0, b1, a1);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
  g.setIndex(idx);
  archCache.set(key, g);
  return g;
}
// The telephone box's parts that are not plain colours: its glass, and the TELEPHONE sign in the frieze of each side
// (white opal glass with black capitals, as on the K6 kiosk). At night the box is lit inside, as the windows are
// (ASSET.litMats: js/environment.js drives their glow): the glass glows warm and the sign white, its letters (dark in
// the glow map) staying dark. Made once, shared by every box.
let BOOTH = null;
function boothMats() {
  if (BOOTH) return BOOTH;
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#f5f3ea'; x.fillRect(0, 0, 512, 96);
  x.fillStyle = '#151515'; x.font = 'bold 60px Georgia, "Times New Roman", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const word = 'TELEPHONE';                                       // spaced out across the panel, as the sign's letters are
  for (let i = 0; i < word.length; i++) x.fillText(word[i], 44 + i * (424 / (word.length - 1)), 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sign = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
  sign.userData.flat = 0xf5f3ea;                                  // its colour, for the snapshot tool (which does not sample maps)
  const glass = new THREE.MeshLambertMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.32, depthWrite: false, emissive: 0xffd98a, emissiveIntensity: 0 });
  ASSET.litMats.push(sign, glass);
  BOOTH = {
    glass,
    sign,
    signGeo: new THREE.PlaneGeometry(0.62, 0.116),
  };
  return BOOTH;
}

export const PROP_DEFS = {
  streetlight: { r: 0.85, drag: 0.9, color: 0x8a8f98, soft: true, make() { const g = new THREE.Group(), m = mat(0x7d838c);
    g.add(cyl(0.14, 0.2, 7, 8, m, 0, 3.5, 0, false)); g.add(box(1.8, 0.14, 0.14, m, 0.8, 7, 0, false)); g.add(box(0.7, 0.16, 0.4, ASSET.lampMat, 1.55, 6.88, 0, false)); return g; } },
  // a steel tram pole, on the sidewalk: a round pole with a bracket arm that reaches out (local +x) over the street, and an
  // insulator at its tip. The span wire hangs from the insulator (js/tram.js tramWires). It breaks like any street prop.
  tramMast: { r: 0.3, drag: 0.9, color: 0x8a8f96, soft: true, make() { const g = new THREE.Group(), m = mat(0x8a8f96), d = mat(0x4d535b);
    g.add(cyl(0.12, 0.18, 6.2, 8, m, 0, 3.1, 0, false)); g.add(cyl(0.22, 0.22, 0.5, 8, d, 0, 0.25, 0, false));
    g.add(box(4.2, 0.12, 0.12, m, 2.1, 5.8, 0, false)); g.add(box(0.3, 0.3, 0.3, d, 4.2, 5.8, 0, false)); return g; } },
  // a wooden utility pole: a tapered pole, two crossarms across the line with insulators, braces and a transformer.
  // The wires are not part of the prop; they are laid between poles by js/world.js (utilityLine).
  utilitypole: { r: 0.3, drag: 0.9, color: 0x5a3d26, soft: true, make() { const g = new THREE.Group(), w = mat(0x4a3322), arm = mat(0x6b4a2f), ins = mat(0x1d1d1d), tr = mat(0x5d636b);
    g.add(cyl(0.13, 0.2, 8.4, 8, w, 0, 4.2, 0, false));
    for (const y of [8.0, 7.2]) {
      g.add(box(2.6, 0.16, 0.16, arm, 0, y, 0, false));
      for (const x of [-1.1, 1.1]) g.add(cyl(0.08, 0.08, 0.3, 6, ins, x, y + 0.2, 0, false));
    }
    for (const x of [-0.6, 0.6]) { const br = box(0.08, 1.2, 0.08, w, x, 7.4, 0, false); br.rotation.z = x > 0 ? -0.6 : 0.6; g.add(br); }
    g.add(box(0.8, 1.0, 0.7, tr, 0.9, 5.2, 0, false));
    return g; } },
  cone: { r: 0.65, drag: 0.97, color: 0xff7a1a, soft: true, make() { const g = new THREE.Group();
    g.add(cyl(0.12, 0.42, 0.95, 8, mat(0xff7a1a), 0, 0.55, 0, false)); g.add(cyl(0.2, 0.28, 0.2, 8, mat(0xffffff), 0, 0.6, 0, false)); g.add(box(0.95, 0.08, 0.95, mat(0x2a2a2a), 0, 0.04, 0, false)); return g; } },
  barrier: { r: 1.5, drag: 0.93, color: 0xf0f0f0, soft: true, make() { const g = new THREE.Group();
    g.add(box(3.4, 0.9, 0.6, mat(0xf2f2f2), 0, 0.75, 0, false)); g.add(box(0.5, 0.92, 0.62, mat(0xe03a3a), -1.0, 0.75, 0, false)); g.add(box(0.5, 0.92, 0.62, mat(0xe03a3a), 0.2, 0.75, 0, false));
    g.add(box(0.15, 0.5, 0.15, mat(0x444444), -1.4, 0.25, 0, false)); g.add(box(0.15, 0.5, 0.15, mat(0x444444), 1.4, 0.25, 0, false)); return g; } },
  // a road-works barricade across a barred street's mouth: two yellow boards with black diagonal stripes on white-and-
  // orange posts and concrete feet (the striped barricade of the construction sites). Soft and breakable like a barrier.
  barricade: { r: 1.5, drag: 0.93, color: 0xf2c200, soft: true, make() { const g = new THREE.Group();
    const yel = mat(0xf2c200), blk = mat(0x222222), wht = mat(0xf4f4f4), org = mat(0xf07a1a), base = mat(0xb8bcc0);
    for (const sx of [-1.25, 1.25]) { g.add(cyl(0.07, 0.07, 1.7, 6, wht, sx, 0.85, 0, false)); g.add(cyl(0.09, 0.09, 0.3, 6, org, sx, 1.72, 0, false)); g.add(box(0.6, 0.12, 0.7, base, sx, 0.06, 0, false)); }
    for (const by of [0.55, 1.15]) {
      g.add(box(2.6, 0.32, 0.1, yel, 0, by, 0, false));
      for (const bx of [-1.1, -0.55, 0, 0.55, 1.1]) { const st = box(0.2, 0.42, 0.12, blk, bx, by, 0, false); st.rotation.z = 0.9; g.add(st); }
    }
    return g; } },
  crate: { r: 1.1, drag: 0.94, color: 0xa87440, soft: true, make() { const g = new THREE.Group();
    g.add(box(1.7, 1.7, 1.7, mat(0xa87440), 0, 0.85, 0, false)); g.add(box(1.76, 0.18, 1.76, mat(0x7b5128), 0, 0.3, 0, false)); g.add(box(1.76, 0.18, 1.76, mat(0x7b5128), 0, 1.4, 0, false)); return g; } },
  barrel: { r: 0.8, drag: 0.94, color: 0xd64545, soft: true, make() { const g = new THREE.Group(); const c = Math.random() < 0.5 ? 0xd64545 : 0x3b7ddd;
    g.add(cyl(0.6, 0.6, 1.3, 10, mat(c), 0, 0.65, 0, false)); g.add(cyl(0.62, 0.62, 0.12, 10, mat(0x222222), 0, 0.9, 0, false)); return g; } },
  fence: { r: 2.1, drag: 0.96, color: 0xf6f2e7, soft: true, make() { const g = new THREE.Group();
    g.add(box(4, 0.9, 0.16, mat(0xf6f2e7), 0, 0.6, 0, false)); g.add(box(4.1, 0.12, 0.22, mat(0xcfc8b4), 0, 1.1, 0, false)); g.add(box(0.2, 1.2, 0.26, mat(0xcfc8b4), -1.95, 0.6, 0, false)); return g; } },
  bench: { r: 1.2, drag: 0.95, color: 0x9a6a3a, soft: true, make() { const g = new THREE.Group();
    g.add(box(2.2, 0.14, 0.7, mat(0x9a6a3a), 0, 0.55, 0, false)); g.add(box(2.2, 0.5, 0.12, mat(0x9a6a3a), 0, 0.95, -0.3, false));
    g.add(box(0.14, 0.5, 0.6, mat(0x444444), -0.9, 0.25, 0, false)); g.add(box(0.14, 0.5, 0.6, mat(0x444444), 0.9, 0.25, 0, false)); return g; } },
  hydrant: { r: 0.55, drag: 0.985, color: 0xe53935, soft: true, make() { const g = new THREE.Group(), m = mat(0xe53935);
    g.add(cyl(0.28, 0.32, 1.0, 8, m, 0, 0.5, 0, false)); g.add(cyl(0.36, 0.36, 0.14, 8, m, 0, 1.05, 0, false)); g.add(box(0.95, 0.24, 0.24, m, 0, 0.7, 0, false));
    g.add(cyl(0.17, 0.17, 0.3, 6, mat(0xffd23b), 0, 1.22, 0, false)); return g; } },
  // a wheeled green refuse bin with a flat lid and a yellow band, the kind kept in the back alleys of the blocks
  dumpster: { r: 1.15, drag: 0.9, color: 0x2f6b3c, soft: true, make() { const g = new THREE.Group(), gr = mat(0x2f6b3c), dk = mat(0x1f2a22), st = mat(0xf2c230), wh = mat(0x1a1a1a);
    g.add(box(2.0, 1.2, 1.3, gr, 0, 0.75, 0, false));
    g.add(box(2.06, 0.12, 1.36, dk, 0, 1.4, 0, false));
    g.add(box(2.02, 0.14, 1.32, st, 0, 0.9, 0, false));
    for (const x of [-0.8, 0.8]) for (const z of [-0.5, 0.5]) { const w = cyl(0.09, 0.09, 0.08, 6, wh, x, 0.09, z, false); w.rotation.z = Math.PI / 2; g.add(w); }
    return g; } },
  trashcan: { r: 0.5, drag: 0.95, color: 0x4b5660, soft: true, make() { const g = new THREE.Group();
    const body = Math.random() < 0.5 ? 0x4b5660 : 0x3f6b4a;
    g.add(cyl(0.38, 0.32, 1.0, 10, mat(body), 0, 0.5, 0, false));
    g.add(cyl(0.42, 0.42, 0.08, 10, mat(0x262b30), 0, 1.0, 0, false));
    g.add(box(0.3, 0.3, 0.3, mat(0xd8d2c0), 0, 1.08, 0, false)); return g; } },
  trashbag: { r: 0.45, drag: 0.96, color: 0x2e3338, soft: true, make() { const g = new THREE.Group();
    const c = Math.random() < 0.5 ? 0x2e3338 : 0x3a4046;
    g.add(box(0.7, 0.55, 0.65, mat(c), 0, 0.3, 0, false));
    g.add(box(0.42, 0.28, 0.4, mat(c), 0.08, 0.6, -0.05, false)); return g; } },
  cardboard: { r: 0.45, drag: 0.96, color: 0xb98a55, soft: true, make() { const g = new THREE.Group();
    const c = Math.random() < 0.5 ? 0xb98a55 : 0xc9a06a;
    g.add(box(0.75, 0.5, 0.6, mat(c), 0, 0.25, 0, false));
    g.add(box(0.77, 0.06, 0.62, mat(0x9a6f3f), 0, 0.51, 0, false));
    g.add(box(0.3, 0.07, 0.62, mat(0x9a6f3f), 0, 0.42, 0.31, false)); return g; } },
  sign: { r: 0.55, drag: 0.93, color: 0xff9a1a, soft: true, make() { const g = new THREE.Group(), post = mat(0x55575c), board = mat(0xff9a1a), stripe = mat(0x2a2a2a);
    g.add(box(0.1, 1.3, 0.1, post, 0, 0.65, 0, false));
    const b = box(0.95, 0.95, 0.08, board, 0, 1.5, 0, false); b.rotation.z = Math.PI / 4; g.add(b);
    const s1 = box(1.25, 0.16, 0.09, stripe, 0, 1.5, 0.002, false); s1.rotation.z = Math.PI / 4; g.add(s1);
    return g; } },
  drum: { r: 0.5, drag: 0.94, color: 0xff7a1a, soft: true, make() { const g = new THREE.Group(), m = mat(0xff7a1a), w = mat(0xf0f0f0);
    g.add(cyl(0.34, 0.4, 0.9, 10, m, 0, 0.45, 0, false));
    g.add(cyl(0.345, 0.405, 0.16, 10, w, 0, 0.64, 0, false));
    g.add(cyl(0.345, 0.405, 0.16, 10, w, 0, 0.26, 0, false)); return g; } },
  mailbox: { r: 0.75, drag: 0.9, color: 0x2f3f6b, soft: true, make() { const g = new THREE.Group(), body = mat(0x2f3f6b), dark = mat(0x1d2540);
    for (const sx of [-1, 1]) g.add(box(0.13, 0.55, 0.13, dark, sx * 0.34, 0.28, 0, false));
    g.add(box(0.98, 0.82, 0.78, body, 0, 0.96, 0, false));
    const lid = cyl(0.39, 0.39, 0.98, 12, body, 0, 1.37, 0, false); lid.rotation.z = Math.PI / 2; g.add(lid);
    g.add(box(1.02, 0.1, 0.82, dark, 0, 0.52, 0, false));
    g.add(box(0.44, 0.3, 0.04, mat(0xd8dde6), -0.22, 1.06, 0.4, false));
    return g; } },
  // A single-space parking meter, as on a city kerb: a red head on a steel post. The lower housing is the coin vault (a
  // raised door with a keyhole), then a lip, the upper housing with the chrome coin plate (slot, two buttons) and the
  // white notice under it, and on top the rounded dome with its window, seen from both sides. Its face (local +z) is the
  // side the street sees. It stands at the head of a parking bay (js/world.js meteredParking), and it breaks like any
  // street prop: knocked off its post, and the coins fly (js/collisions.js).
  meter: { r: 0.3, drag: 0.92, color: 0xd42a1e, soft: true, make() { const g = new THREE.Group();
    const red = mat(0xd42a1e), door = mat(0xb5231a), steel = mat(0xa9aeb4), chrome = mat(0xd9dde2), dark = mat(0x23262b);
    const paper = mat(0xf3f2ec), glass = mat(0xbcd2dd);
    g.add(cyl(0.09, 0.11, 0.05, 10, dark, 0, 0.025, 0, false));                  // the foot on the paving
    g.add(cyl(0.042, 0.048, 0.92, 8, steel, 0, 0.46, 0, false));                 // the post
    g.add(cyl(0.06, 0.05, 0.05, 8, steel, 0, 0.935, 0, false));                  // its collar under the head
    g.add(box(0.19, 0.07, 0.15, red, 0, 0.995, 0, false));                       // the vault narrows to the post
    g.add(box(0.25, 0.22, 0.2, red, 0, 1.14, 0, false));                         // the coin vault
    g.add(box(0.17, 0.17, 0.02, door, 0, 1.135, 0.105, false));                  // its raised door
    g.add(box(0.025, 0.025, 0.01, dark, 0, 1.16, 0.12, false));                  // the keyhole
    g.add(box(0.27, 0.035, 0.215, red, 0, 1.2675, 0, false));                    // the lip between the housings
    g.add(box(0.27, 0.22, 0.21, red, 0, 1.395, 0, false));                       // the upper housing
    g.add(box(0.16, 0.09, 0.012, chrome, 0, 1.45, 0.111, false));                // the coin plate
    g.add(box(0.012, 0.055, 0.008, dark, -0.035, 1.452, 0.119, false));          // the coin slot
    for (const y of [1.472, 1.43]) g.add(box(0.02, 0.02, 0.01, dark, 0.04, y, 0.119, false));   // the two buttons
    g.add(box(0.21, 0.07, 0.008, paper, 0, 1.335, 0.109, false));                // the notice
    for (const y of [1.35, 1.335, 1.32]) g.add(box(0.15, 0.006, 0.004, dark, 0, y, 0.114, false));   // its lines of print
    const dome = new THREE.Mesh(halfCyl(0.135, 0.21, 16), red); dome.position.y = 1.505; dome.rotation.x = -Math.PI / 2; g.add(dome);
    const win = new THREE.Mesh(halfCyl(0.105, 0.216, 16), glass); win.position.y = 1.505; win.rotation.x = -Math.PI / 2; g.add(win);
    return g; } },
  // A red telephone box, the K6 kiosk: a dark plinth; a red body with a pilaster at each corner and a solid panel at the
  // foot of each side; each side glazed in eight rows of three panes (the middle ones wider), the front side being the
  // door, with its brass handle; the white TELEPHONE sign in the frieze of all four sides, lit at night; a cornice; and
  // the domed roof, two shallow vaults crossed, with a gold crown in the arch over each side. Inside, the payphone on the
  // back wall over a shelf. Its door (local -z) faces the pavement and its back (local +z) the street. Many stand on the
  // busy pavements (js/world.js phoneBooths); it breaks like any street prop, in a shower of glass (js/collisions.js).
  phonebooth: { r: 0.65, drag: 0.86, color: 0xd61e2c, soft: true, make() { const g = new THREE.Group(), M = boothMats();
    const red = mat(0xd61e2c), moulding = mat(0xb01422), plinth = mat(0x34363a), gold = mat(0xd9a52b), black = mat(0x18191c);
    const steel = mat(0xa9aeb5), floor = mat(0x45474c);
    const W = 0.91, H = W / 2, P = 0.11;                                          // 0.91 m square; the corner pilasters
    const FOOT = 0.08, KICK = 0.38, GLZ = 1.93, TOP = 1.99, FRIEZE = 2.19, CORN = 2.25, RISE = 0.26, CW = W + 0.06;
    const OW = W - 2 * P, G0 = KICK + 0.05, GH = GLZ - G0;                       // a side's opening; its glazing, from G0 up
    g.add(box(W + 0.09, FOOT, W + 0.09, plinth, 0, FOOT / 2, 0));               // the plinth
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(P, FRIEZE - FOOT, P, red, sx * (H - P / 2), (FOOT + FRIEZE) / 2, sz * (H - P / 2)));   // the pilasters
    g.add(box(W - 0.02, FRIEZE - TOP, W - 0.02, red, 0, (TOP + FRIEZE) / 2, 0)); // the frieze
    g.add(box(CW, CORN - FRIEZE, CW, red, 0, (FRIEZE + CORN) / 2, 0));           // the cornice
    for (const ry of [0, Math.PI / 2]) {                                          // the roof: two shallow vaults, crossed
      const vault = new THREE.Mesh(archSlab(CW, RISE, CW), red); vault.position.y = CORN; vault.rotation.y = ry; g.add(vault);
    }
    g.add(box(W - 0.06, 0.02, W - 0.06, floor, 0, FOOT + 0.01, 0, false));       // inside: the floor,
    g.add(box(0.62, 0.025, 0.2, steel, 0, 1.0, H - 0.15, false));               // the shelf on the back wall,
    g.add(box(0.24, 0.34, 0.1, black, 0.1, 1.38, H - 0.1, false));               // the payphone
    g.add(box(0.05, 0.2, 0.06, black, -0.06, 1.38, H - 0.12, false));            // and its handset
    for (let side = 0; side < 4; side++) {                                        // the four sides, each built facing -z
      const s = new THREE.Group(); s.rotation.y = side * Math.PI / 2; g.add(s);
      const z = -H + 0.035;                                                       // the panels stand back from the pilasters
      s.add(box(OW, KICK - FOOT, 0.04, red, 0, (FOOT + KICK) / 2, z, false));    // the panel at the foot
      s.add(box(OW - 0.12, KICK - FOOT - 0.12, 0.012, moulding, 0, (FOOT + KICK) / 2, z - 0.025, false));   // its moulding
      s.add(box(OW, 0.05, 0.05, red, 0, KICK + 0.025, z, false));               // the glazing's bottom rail
      s.add(box(OW, TOP - GLZ, 0.05, red, 0, (GLZ + TOP) / 2, z, false));        // and its top rail
      for (const sx of [-1, 1]) {
        s.add(box(0.03, GH, 0.05, red, sx * (OW / 2 - 0.015), G0 + GH / 2, z, false));     // the stiles
        s.add(box(0.022, GH, 0.035, red, sx * 0.125, G0 + GH / 2, z, false));              // the glazing bars, upright
      }
      for (let k = 1; k < 8; k++) s.add(box(OW, 0.022, 0.035, red, 0, G0 + GH * k / 8, z, false));   // and across: eight rows
      s.add(box(OW - 0.02, GH, 0.006, M.glass, 0, G0 + GH / 2, z + 0.012, false));          // the glass
      s.add(box(0.68, 0.16, 0.012, moulding, 0, (TOP + FRIEZE) / 2, -H + 0.004, false));   // the sign's frame
      const sign = new THREE.Mesh(M.signGeo, M.sign); sign.position.set(0, (TOP + FRIEZE) / 2, -H - 0.004); sign.rotation.y = Math.PI; s.add(sign);
      const cz = -CW / 2 - 0.007;                                                 // the crown, in the arch over the side
      s.add(box(0.12, 0.022, 0.014, gold, 0, CORN + 0.06, cz, false));            // its band
      s.add(box(0.09, 0.05, 0.014, gold, 0, CORN + 0.095, cz, false));            // its cap
      for (const px of [-0.036, 0, 0.036]) s.add(box(0.018, px ? 0.03 : 0.04, 0.014, gold, px, CORN + (px ? 0.133 : 0.138), cz, false));   // its points
      s.add(box(0.018, 0.018, 0.014, gold, 0, CORN + 0.168, cz, false));          // and the orb on top
      if (side === 0) s.add(box(0.022, 0.13, 0.03, gold, OW / 2 - 0.06, 1.06, z - 0.04, false));   // the door's handle
    }
    return g; } },
  sandwich: { r: 0.7, drag: 0.97, color: 0xf4f1e6, soft: true, make() { const g = new THREE.Group(), white = mat(0xf4f1e6), dark = mat(0x2a2a2a);
    for (const sz of [-1, 1]) { const b = box(0.92, 1.2, 0.07, white, 0, 0.65, sz * 0.24, false); b.rotation.x = sz * 0.2; g.add(b); }
    g.add(box(0.98, 0.08, 0.66, dark, 0, 0.05, 0, false));
    const band = box(0.7, 0.17, 0.03, mat(0xd64545), 0, 1.0, -0.33, false); band.rotation.x = -0.2; g.add(band);
    const band2 = box(0.6, 0.12, 0.03, mat(0x2a4d9c), 0, 0.74, -0.37, false); band2.rotation.x = -0.2; g.add(band2);
    return g; } },
  hedge: { r: 1.35, drag: 0.98, color: 0x3f8a3c, soft: true, make() { const g = new THREE.Group(), leaf = mat(0x3f8a3c), leaf2 = mat(0x4e9c48);
    g.add(box(2.7, 1.0, 0.95, leaf, 0, 0.62, 0, false));
    g.add(box(2.3, 0.34, 1.0, leaf2, 0, 1.22, 0, false));
    g.add(box(1.3, 0.3, 0.95, leaf, 0.45, 1.46, 0, false));
    g.add(box(1.5, 0.26, 0.9, leaf2, -0.6, 1.4, 0, false));
    return g; } },
  dirtpile: { r: 0.9, drag: 0.9, color: 0x8a6a42, soft: true, make() { const g = new THREE.Group();
    g.add(box(1.6, 0.5, 1.6, mat(0x8a6a42), 0, 0.25, 0, false));
    g.add(box(1.1, 0.4, 1.1, mat(0x9c7a4e), 0, 0.55, 0, false));
    g.add(box(0.6, 0.35, 0.6, mat(0xae8a5a), 0, 0.82, 0, false)); return g; } },
  pipe: { r: 0.9, drag: 0.93, color: 0x6c7580, soft: true, make() { const g = new THREE.Group(), m = mat(0x6c7580);
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