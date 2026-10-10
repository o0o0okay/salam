// Shops: a high street of small businesses. A shop is a facade kit (plinth, display window, door, fascia, awning) and
// buildShopParadeMesh lays a row of them; js/world.js uses both for the parades and for downtown shopfronts.
import * as THREE from 'three';
import { mat, box } from './assets.js';
import { textBlocks } from './campus.js';
import { PI } from './utils.js';

// ---- Shops: a high street of small businesses ----
// Every shop is a facade kit: plinth, a display window whose goods are silhouetted against a lit pane,
// mullions, a door with a step and an OPEN plate, a fascia carrying the shop's name, a striped awning, a
// projecting blade sign and a few outdoor props (cafe tables, produce crates, flower stands...). The window
// pane is returned as its own group so a car can smash it out (see breakShopFront in js/collisions.js).
export const SHOP_TYPES = [
  { name: 'CAFE',     kind: 'cafe',     fascia: 0x6b4a2f, sign: 0xf2e9d8, glow: 0xffcf8f, awn: [0x8c3f24, 0xf0e2c8], accent: 0x7a4a28, blade: 'CA', props: 'cafe' },
  { name: 'BAKERY',   kind: 'bakery',   fascia: 0xe6dcc4, sign: 0x8a4b12, glow: 0xffd9a0, awn: [0xd8b064, 0xfaf3e2], accent: 0xc98a3a, blade: 'BK', props: 'bread' },
  { name: 'PIZZA',    kind: 'pizza',    fascia: 0x1f6b3a, sign: 0xf7f3e8, glow: 0xffe0a0, awn: [0x1f6b3a, 0xd8452f], accent: 0xd8452f, blade: 'PZ', props: 'tavern' },
  { name: 'MARKET',   kind: 'market',   fascia: 0x2f7d5b, sign: 0xf4f7f4, glow: 0xe0ffdc, awn: [0x2f7d5b, 0xffffff], accent: 0x86c34a, blade: 'MK', props: 'produce' },
  { name: 'PHARMACY', kind: 'pharmacy', fascia: 0xf0f3f4, sign: 0x1c7a4a, glow: 0xd8ffe8, awn: [0x1c7a4a, 0xf2f5f6], accent: 0x2fbf7a, blade: 'RX', props: 'planter' },
  { name: 'BOOKS',    kind: 'books',    fascia: 0x7a2f2f, sign: 0xf6e9d0, glow: 0xffe9b8, awn: [0x7a2f2f, 0xe8d6b0], accent: 0x9a6a3a, blade: 'BO', props: 'crates' },
  { name: 'BARBER',   kind: 'barber',   fascia: 0x1f3a6b, sign: 0xf2f5f6, glow: 0xdcE8ff, awn: [0x2a5fb0, 0xffffff], accent: 0xd8452f, blade: 'BR', props: 'bench' },
  { name: 'DONUTS',   kind: 'donuts',   fascia: 0xe08bb0, sign: 0x4a2140, glow: 0xffd8ec, awn: [0xe08bb0, 0xfff3f8], accent: 0xf2a0c0, blade: 'DN', props: 'cafe' },
  { name: 'FLOWERS',  kind: 'flowers',  fascia: 0x3f7d4f, sign: 0xfdf6e3, glow: 0xe8ffdc, awn: [0x3f7d4f, 0xf0e2c8], accent: 0xd84f8a, blade: 'FL', props: 'flowers' },
  { name: 'HARDWARE', kind: 'hardware', fascia: 0x9a5a1f, sign: 0xf7efdd, glow: 0xffe3b0, awn: [0x9a5a1f, 0xd8d2c4], accent: 0x6c7580, blade: 'HW', props: 'crates' },
  { name: 'LAUNDRY',  kind: 'laundry',  fascia: 0x2f6f86, sign: 0xf2fbff, glow: 0xdcf4ff, awn: [0x2f6f86, 0xffffff], accent: 0x9fd8e8, blade: 'LD', props: 'bench' },
  { name: 'SHOES',    kind: 'shoes',    fascia: 0x3a3a44, sign: 0xf2f2f2, glow: 0xffe9c0, awn: [0x3a3a44, 0xb0b6bd], accent: 0x7a4a28, blade: 'SH', props: 'bench' },
  { name: 'ARCADE',   kind: 'arcade',   fascia: 0x2a1f4a, sign: 0x9cf0ff, glow: 0xc0baff, awn: [0x2a1f4a, 0x9cf0ff], accent: 0x6f5bd8, blade: 'AR', props: 'bench' },
  { name: 'GRILL',    kind: 'grill',    fascia: 0xb03a2a, sign: 0xfff2d8, glow: 0xffc98a, awn: [0xb03a2a, 0xf6e0b0], accent: 0x8a2f22, blade: 'GR', props: 'tavern' },
];
export const PARADE_TITLES = ['HIGH STREET', 'OLD TOWN PARADE', 'MARKET ROW', 'TRADERS ROW'];
// The sign font is a fixed 5x7 block font, so a long name has to be scaled down to fit its fascia.
function fitText(str, m, maxW, th, depth, gap) {
  const unit = 5 * th / 7 + gap;
  const total = str.length * unit - gap;
  if (total > maxW) { const k = (maxW + gap) / (str.length * unit); th *= k; gap *= k; }
  return textBlocks(str, m, th, depth, gap);
}
// One storefront, built in local coordinates: front plane at z = 0, ground at y = 0, centred on x.
export function buildShopFrontMesh(shop, w, h, rng, opts) {
  const body = new THREE.Group(), glass = new THREE.Group();
  const F = mat(shop.fascia), S = mat(shop.sign), dark = mat(0x2a2d33), frame = mat(0xe9ebe8), steel = mat(0xb6bcc2);
  const pane = new THREE.MeshBasicMaterial({ color: shop.glow });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0cf });
  const accent = mat(shop.accent);
  const B = (g, bw, bh, bd, m, x, y, z, cast = true) => g.add(box(bw, bh, bd, m, x, y, z, cast));
  const winW = w - 1.1, sill = 0.52, winH = h - 2.05;
  // ---- the shop window: a lit pane with the goods silhouetted in front of it ----
  B(glass, winW, winH, 0.07, pane, 0, sill + winH / 2, 0.03, false);
  B(body, winW + 0.5, winH + 0.5, 0.14, mat(0x22252b), 0, sill + winH / 2, -1.25, false);   // dark interior behind the pane
  B(body, 0.2, winH, 0.24, frame, -winW / 2, sill + winH / 2, 0.1, false);                  // jambs
  B(body, 0.2, winH, 0.24, frame, winW / 2, sill + winH / 2, 0.1, false);
  B(body, winW + 0.4, 0.16, 0.26, frame, 0, sill, 0.1, false);                              // sill
  B(body, winW + 0.4, 0.2, 0.26, frame, 0, sill + winH + 0.1, 0.1, false);                  // head
  B(body, w, sill, 0.24, mat(0x4a4d55), 0, sill / 2, 0.08);                                 // plinth
  // goods on show, silhouette boxes of differing height so no two windows look alike
  const goods = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < goods; i++) {
    const gw = 0.5 + rng() * 0.7, gh = 0.5 + rng() * (winH - 1.4), gd = 0.4 + rng() * 0.5;
    const gx = -winW / 2 + 0.6 + (i + 0.5) * ((winW - 1.2) / goods) + rng() * 0.2;
    B(body, gw, gh, gd, i % 2 ? accent : dark, gx, sill + 0.1 + gh / 2, -0.55 - rng() * 0.5);
  }
  B(body, winW - 1.6, 0.9, 1.1, dark, 0, sill + 0.55, -1.15, false);                        // counter at the back
  for (let i = 0; i < 3; i++) B(body, 0.16, 0.16, 0.16, lamp, -winW / 3 + i * winW / 3, h - 1.15, -0.55, false);   // ceiling lamps
  // ---- mullions ----
  const cols = Math.max(2, Math.round(winW / 2.1));
  for (let i = 1; i < cols; i++) B(body, 0.13, winH, 0.2, frame, -winW / 2 + i * (winW / cols), sill + winH / 2, 0.09, false);
  B(body, winW + 0.4, 0.12, 0.2, frame, 0, sill + winH * 0.62, 0.09, false);                // transom
  // ---- fascia with the shop's name, lamps and a blade sign ----
  B(body, w, 0.95, 0.3, F, 0, h - 0.5, 0.15);
  const name = fitText(shop.name, S, w - 1.6, 0.46, 0.12, 0.4);
  name.position.set(0, h - 0.5, 0.33); body.add(name);
  for (const sx of [-1, 1]) {
    B(body, 0.36, 0.14, 0.3, lamp, sx * (w / 2 - 0.95), h - 1.16, 0.2, false);              // shop lamps
    B(body, 0.08, 0.22, 0.08, steel, sx * (w / 2 - 0.95), h - 1.3, 0.16, false);
  }
  const bladeX = w / 2 - 1.0;
  B(body, 0.1, 0.7, 0.7, F, bladeX, h - 2.1, 0.62);
  const monoL = fitText(shop.blade, S, 0.72, 0.26, 0.06, 0.18); monoL.position.set(bladeX + 0.07, h - 2.1, 0.62); monoL.rotation.y = PI / 2; body.add(monoL);
  const monoR = fitText(shop.blade, S, 0.72, 0.26, 0.06, 0.18); monoR.position.set(bladeX - 0.07, h - 2.1, 0.62); monoR.rotation.y = -PI / 2; body.add(monoR);
  B(body, 0.07, 0.07, 0.55, steel, bladeX, h - 1.72, 0.32, false);                          // bracket
  // ---- door at the other end, with a step and an OPEN plate ----
  const dx = -(w / 2) + 1.55;
  B(body, 1.35, h - 1.7, 0.2, frame, dx, (h - 1.7) / 2 + 0.5, 0.08);
  B(body, 1.05, h - 2.2, 0.14, mat(0x2b3a44), dx, (h - 2.2) / 2 + 0.55, 0.16);
  B(body, 0.86, 0.9, 0.06, pane, dx, 1.75, 0.24, false);                                    // the door glows too
  B(body, 0.09, 0.62, 0.09, steel, dx + 0.42, 1.15, 0.25, false);                           // push bar
  B(body, 1.9, 0.16, 0.8, mat(0x6f747c), dx, 0.08, 0.4);                                    // step
  const open = fitText('OPEN', S, 1.2, 0.2, 0.06, 0.22);
  open.position.set(dx, h - 1.62, 0.25); body.add(open);
  // ---- striped awning (skipped when the shop sits too close to the pavement) ----
  if (opts.awning !== false) {
    const aw = new THREE.Group(); aw.position.set(0.3, h - 1.55, 0.12); aw.rotation.x = -0.16;
    const n = 8, sw2 = (w - 0.5) / n;
    for (let i = 0; i < n; i++) {
      const m = i % 2 ? mat(shop.awn[0]) : mat(shop.awn[1]);
      aw.add(box(sw2, 0.07, 1.7, m, -(w - 0.5) / 2 + (i + 0.5) * sw2, 0, 0.85));
      aw.add(box(sw2, 0.26, 0.06, i % 2 ? mat(shop.awn[1]) : mat(shop.awn[0]), -(w - 0.5) / 2 + (i + 0.5) * sw2, -0.18, 1.68, false));
    }
    for (const sx of [-1, 1]) aw.add(box(0.08, 0.08, 1.72, steel, sx * (w - 0.5) / 2, 0.02, 0.85, false));
    body.add(aw);
  }
  // ---- outdoor props, kept within 1.6 m of the front so parked cars clear them ----
  if (opts.outdoor !== false) {
    const P = shop.props, ox = -w / 2 + 1.2;
    const crate = (x, z, col, n2 = 3) => { for (let i = 0; i < n2; i++) B(body, 0.42, 0.28, 0.34, mat(0xb98a55), x, 0.3 + i * 0.3, z, false); B(body, 0.34, 0.16, 0.26, mat(col), x, 0.34 + n2 * 0.3, z, false); };
    if (P === 'cafe') {
      for (const [tx, tz] of [[ox + 0.4, 1.15], [ox + 2.5, 1.15]]) {
        B(body, 0.62, 0.06, 0.62, mat(0x8a8f96), tx, 0.76, tz, false);
        B(body, 0.08, 0.72, 0.08, steel, tx, 0.38, tz, false);
        for (const s2 of [-1, 1]) B(body, 0.34, 0.42, 0.34, mat(0x6f5a44), tx + s2 * 0.62, 0.22, tz, false);
      }
      B(body, 0.75, 0.95, 0.07, mat(0x2f3a33), ox + 1.6, 0.48, 1.5, false);                  // menu board
    } else if (P === 'produce') {
      crate(ox + 0.5, 1.1, 0x86c34a, 2); crate(ox + 1.5, 1.15, 0xd8452f, 2); crate(ox + 2.5, 1.1, 0xf2a93b, 1);
    } else if (P === 'bread') {
      B(body, 1.5, 0.08, 0.7, mat(0xb98a55), ox + 1.0, 0.92, 1.15, false);
      B(body, 1.5, 0.08, 0.7, mat(0xb98a55), ox + 1.0, 0.6, 1.15, false);
      for (const s2 of [-1, 1]) B(body, 0.07, 0.9, 0.07, mat(0x8a6a42), ox + 1.0 + s2 * 0.7, 0.45, 1.15, false);
      for (let i = 0; i < 4; i++) B(body, 0.34, 0.24, 0.26, mat(0xc98a3a), ox + 0.4 + i * 0.4, 1.04, 1.15, false);
    } else if (P === 'flowers') {
      for (const [fx, fz] of [[ox + 0.3, 1.1], [ox + 1.7, 1.1]]) {
        B(body, 0.7, 0.55, 0.5, mat(0x8a8f96), fx, 0.3, fz, false);
        for (let i = 0; i < 4; i++) B(body, 0.16, 0.34, 0.16, mat([0xd84f8a, 0xf2a93b, 0xe34a4a, 0x8e5bd9][i]), fx - 0.24 + (i % 2) * 0.48, 0.8, fz - 0.12 + Math.floor(i / 2) * 0.24, false);
      }
    } else if (P === 'tavern') {
      B(body, 2.0, 0.09, 0.85, mat(0x9a7a52), ox + 1.3, 0.82, 1.15, false);
      for (const s2 of [-1, 1]) B(body, 0.12, 0.8, 0.8, mat(0x7a5f3f), ox + 1.3 + s2 * 0.9, 0.42, 1.15, false);
      B(body, 0.09, 2.2, 0.09, steel, ox + 1.3, 1.1, 1.5, false);
      B(body, 2.2, 0.12, 2.0, mat(0xd8452f), ox + 1.3, 2.25, 1.5, false);
    } else if (P === 'crates') {
      crate(ox + 0.5, 1.1, 0x6c7580, 3); crate(ox + 1.4, 1.15, 0x6c7580, 1);
    } else if (P === 'bench') {
      B(body, 1.5, 0.1, 0.55, mat(0x9a7a52), ox + 1.2, 0.48, 1.15, false);
      B(body, 1.5, 0.5, 0.1, mat(0x9a7a52), ox + 1.2, 0.75, 0.95, false);
      for (const s2 of [-1, 1]) B(body, 0.11, 0.46, 0.11, mat(0x6f747c), ox + 1.2 + s2 * 0.65, 0.24, 1.15, false);
    } else {
      for (const px of [ox + 0.3, ox + 2.4]) {
        B(body, 0.9, 0.5, 0.55, mat(0x8a8f96), px, 0.28, 1.1, false);
        B(body, 0.8, 0.3, 0.45, mat(0x4e9c48), px, 0.62, 1.1, false);                          // planter greenery
      }
    }
  }
  return { body, glass };
}
// A parade: one low building whose front is a row of different shops, framed by two taller corner towers
// carrying the parade's name. Local coordinates: front plane at z = 0, body towards -z, length along x.
export function buildShopParadeMesh(shops, rng, opts = {}) {
  const shopW = opts.shopW || 9, depth = opts.depth || 8.5, h = opts.h || 4.4;
  const len = shops.length * shopW;
  const g = new THREE.Group(), glasses = [], list = [];
  const wall = mat(opts.wall || 0xc9c6bd), trim = mat(0xe4e1d7), roofM = mat(0x8b8f95), steel = mat(0xb6bcc2);
  const gate = new THREE.MeshBasicMaterial({ color: 0xffe6b0 });
  const B = (bw, bh, bd, m, x, y, z, cast = true) => g.add(box(bw, bh, bd, m, x, y, z, cast));
  B(len + 7, h, depth, wall, 0, h / 2, -depth / 2);                                  // the parade box, towers included
  B(len + 7.4, 0.42, depth + 0.5, trim, 0, h + 0.21, -depth / 2, false);             // parapet
  B(len, 0.5, 0.3, trim, 0, 0.25, 0.15, false);                                      // base course
  // Roof plant: three boxes at -len/4, 0 and +len/4 along the parade. The stride has to be len/4 — a stride of
  // len/2 put the third box at +3len/4, i.e. 7.75 m past the end of the building, so a grey box hung in mid-air
  // over the street beside every parade (reported as the box that is attached to nothing).
  for (let i = 0; i < 3; i++) B(1.9, 0.95, 1.7, roofM, (i - 1) * len / 4, h + 0.75, -depth + 1.4);   // roof plant
  for (const sx of [-1, 1]) {                                                        // corner towers
    const tx = sx * (len / 2 + 2.4);
    B(0.35, h + 2.8, depth + 0.9, trim, tx - sx * 1.45, (h + 2.8) / 2, -depth / 2 - 0.45, false);   // end pilaster
    B(2.7, 1.5, 0.16, mat(0x2b3a44), tx, h + 0.9, 0.5, false);                       // upper windows
    B(2.7, 1.5, 0.16, mat(0x2b3a44), tx, h + 0.9, -depth - 0.5, false);
    B(3.4, 1.0, 0.24, mat(0x2f343b), tx, h + 2.1, 0.55, false);                      // sign board
    const title = fitText(opts.title || 'SHOPS', mat(0xf2e9d8), 3.1, 0.42, 0.1, 0.34);
    title.position.set(tx, h + 2.1, 0.7); g.add(title);
    const side = fitText(opts.title || 'SHOPS', mat(0xf2e9d8), 3.1, 0.42, 0.1, 0.34);
    side.position.set(tx, h + 2.1, -depth - 0.7); side.rotation.y = PI; g.add(side);
    B(0.3, 0.3, 0.3, gate, tx, h + 0.15, 0.5, false);                                // door lamp
  }
  shops.forEach((shop, i) => {
    const x = -len / 2 + (i + 0.5) * shopW;
    B(0.26, h, 0.3, trim, x - shopW / 2, h / 2, 0.15, false);                        // pilaster between shops
    const kit = buildShopFrontMesh(shop, shopW - 0.3, h, rng, opts);
    kit.body.position.x = x; g.add(kit.body);
    // the kit's glass stays at its own origin: the block places each shop's pane at that shop's world
    // position below. Offsetting it here as well used to move every pane twice, which left the two end
    // windows of every parade standing out in the street as 7.6 x 2.35 m pale sheets.
    glasses.push({ group: kit.glass, x, w: shopW - 0.3, name: shop.name, kind: shop.kind });
    list.push({ name: shop.name, kind: shop.kind, x, w: shopW - 0.3 });
  });
  B(0.26, h, 0.3, trim, len / 2, h / 2, 0.15, false);                                // closing pilaster
  return { group: g, glasses, shops: list, len, depth, h, shopW };
}