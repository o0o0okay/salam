/* Construction sites: scaffolding, the site machines and the site footprints (siteSpots).
 * Split out of js/world.js. Imports only what it uses; the chunk generator (js/world.js) imports from here. */
import * as THREE from 'three';
import { CHUNK } from './utils.js';
import { mat } from './assets.js';
import { box } from './assets.js';
import { cyl } from './assets.js';
import { segClosed } from './flyover.js';
import { segFilled } from './flyover.js';
import { nbhdJunction } from './flyover.js';
import { riverSeg } from './flyover.js';

// ---- Construction scaffolding — 4 distinct "installer styles" with randomized size/colors per instance ----
export const FRAME_COLORS = [0x8a8f96, 0x6f7a8c, 0xe8b23a, 0xb5651d];
export const NET_COLORS = [0x3fae5a, 0x2f6fb0, 0x2a2a2a, 0xdedede, 0xff8a1a];
export const PLANK_COLORS = [0xb98a4e, 0x9c7a4e, 0x8a8f96, 0xc9a06a];
export const SIGN_COLORS = [0xd64545, 0x2f6fb0, 0xe8b02a, 0x3f9e48];
export function buildScaffoldMesh(o) {
  const g = new THREE.Group();
  const steel = mat(o.frame), plank = mat(o.plank);
  const w = o.w, d = o.d, h = o.h, bays = o.bays, levels = o.levels, bayW = w / bays, lvH = h / levels;
  for (let i = 0; i <= bays; i++) { const x = -w / 2 + i * bayW; for (const sz of [-1, 1]) g.add(box(0.1, h, 0.1, steel, x, h / 2, sz * d / 2, false)); }
  for (let lv = 0; lv <= levels; lv++) {
    const y = Math.min(h, lv * lvH);
    for (const sz of [-1, 1]) g.add(box(w, 0.07, 0.07, steel, 0, y, sz * d / 2, false));
    g.add(box(0.07, 0.07, d, steel, -w / 2, y, 0, false)); g.add(box(0.07, 0.07, d, steel, w / 2, y, 0, false));
    if (lv > 0) {
      const showPlank = o.style !== 1 || lv % 2 === 1;
      if (showPlank) g.add(box(w - 0.12, 0.08, d - 0.2, plank, 0, y - lvH * 0.06, 0, false));
      if (o.style === 1) for (const sz of [-1, 1]) g.add(box(w - 0.1, 0.22, 0.05, mat(0xff7a1a), 0, y - lvH + 0.16, sz * d / 2, false));
    }
  }
  for (let i = 0; i < bays; i++) {
    if ((i + (o.style === 0 ? 0 : 1)) % 2 !== 0) continue;
    const x0 = -w / 2 + i * bayW, x1 = x0 + bayW, lvPick = 1 + (i % levels);
    const y0 = (lvPick - 1) * lvH, y1 = lvPick * lvH;
    const diag = box(Math.hypot(bayW, lvH), 0.05, 0.05, steel, (x0 + x1) / 2, (y0 + y1) / 2, d / 2, false);
    diag.rotation.z = Math.atan2(y1 - y0, x1 - x0) * (i % 2 === 0 ? 1 : -1); g.add(diag);
  }
  if (o.style === 0 || o.style === 1) {
    const lx = -w / 2 - 0.06;
    g.add(box(0.05, h, 0.3, steel, lx, h / 2, 0, false));
    for (let y = 0.4; y < h; y += 0.5) g.add(box(0.3, 0.04, 0.04, steel, lx, y, 0, false));
  }
  if (o.style === 2) {
    const net = mat(o.net, { transparent: true, opacity: 0.6 });
    g.add(box(w + 0.15, h, 0.05, net, 0, h / 2, d / 2 + 0.08, false)); g.add(box(w + 0.15, h, 0.05, net, 0, h / 2, -d / 2 - 0.08, false));
    g.add(box(0.05, h, d + 0.15, net, w / 2 + 0.08, h / 2, 0, false)); g.add(box(0.05, h, d + 0.15, net, -w / 2 - 0.08, h / 2, 0, false));
    g.add(box(Math.min(w * 0.55, 3.2), 1.1, 0.07, mat(o.sign), 0, h * 0.62, d / 2 + 0.12, false));
  } else {
    const net = mat(o.net, { transparent: true, opacity: 0.28 });
    g.add(box(w + 0.1, h, 0.04, net, 0, h / 2, d / 2 + 0.06, false));
  }
  if (o.style === 3) {
    const cz = d * 0.15, cd = d + 1.8;
    g.add(box(w + 1.1, 0.14, cd, mat(0xffcf2e), 0, 2.5, cz, false));
    g.add(box(w + 1.1, 0.1, 0.12, mat(0x2a2a2a), 0, 2.42, cz + cd / 2, false));
    for (const sx of [-1, 1]) g.add(box(0.14, 2.5, 0.14, mat(0x2a2a2a), sx * (w / 2 + 0.4), 1.25, d / 2 + 1.4, false));
  }
  return g;
}
// ---- construction machines parked on a site's bare earth (one or two per site, five kinds) ----
// Each builder returns { g, L, W }: a group whose length runs along local z (the front is +z) and its width along x.
// Built as plain boxes and cylinders, merged per block like the other stand-alone pieces (see mergeStandalone).
export const MACH_Y = 0xf2b705, MACH_D = 0x2b2f35, MACH_GL = 0x3d5566, MACH_BK = 0x1d1f22, MACH_OR = 0xf5a623, MACH_DRUM = 0xf2a33a;
export const MIXER_ORANGE = 0xe8731a;                       // the cement mixer's paint, as in the reference photo
export function siteMachine(kind) {
  const g = new THREE.Group();
  const sm = (w, h, d, c, x, y, z, rx = 0) => { const m = box(w, h, d, mat(c), x, y, z, false); m.rotation.x = rx; g.add(m); };
  const sc = (r, h, c, x, y, z, rx = 0, rz = 0, seg = 12) => { const m = cyl(r, r, h, seg, mat(c), x, y, z, false); m.rotation.x = rx; m.rotation.z = rz; g.add(m); };
  const sct = (rt, rb, h, c, x, y, z, rx = 0) => { const m = cyl(rt, rb, h, 14, mat(c), x, y, z, false); m.rotation.x = rx; g.add(m); };
  // a bar from point A to point B, both given as [y, z] in the side view (the bar lies in the y-z plane, at x)
  const seg3 = (w, c, A, B, x = 0) => { const dy = B[0] - A[0], dz = B[1] - A[1]; sm(w, Math.hypot(dy, dz), w, c, x, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, Math.atan2(dz, dy)); };
  const ray = (p, th, len) => [p[0] + len * Math.cos(th), p[1] + len * Math.sin(th)];
  const Y = MACH_Y, K = MACH_D, T = MACH_BK, GL = MACH_GL, O = MACH_OR, W_ = 0xf4f4f4;
  // Each kind is built with its length along z (front +z) and its ground at y = 0, then its centre is moved to zc.
  if (kind === 0) {                       // tracked excavator: long tracks, a yellow house, a boom and stick, a toothed bucket
    for (const x of [-1.2, 1.2]) { sm(0.85, 0.8, 6.0, T, x, 0.4, 0); sc(0.4, 0.85, 0x2e3237, x, 0.4, 3.0, 0, Math.PI / 2); sc(0.4, 0.85, 0x2e3237, x, 0.4, -3.0, 0, Math.PI / 2); }
    sm(1.9, 0.35, 4.4, K, 0, 0.95, -0.2);
    sm(2.4, 0.6, 3.2, Y, 0, 1.45, -0.6);                 // upper house
    sm(2.2, 0.9, 1.4, Y, 0, 2.0, -2.2);                  // engine deck at the back
    sm(2.0, 0.7, 0.08, 0x202326, 0, 2.0, -2.93);         // grille
    for (const x of [-1.16, 1.16]) for (const z of [-1.2, -2.0, -2.8]) sm(0.05, 0.6, 0.45, 0x3a3d42, x, 1.9, z);   // side louvres
    sm(2.5, 0.12, 4.0, Y, 0, 1.2, -0.6);                 // deck plate (lighter cover)
    sm(1.6, 1.25, 1.5, Y, 0.45, 2.45, 0.2);              // cab
    sm(1.3, 0.85, 0.06, GL, 0.45, 2.55, 0.97);           // cab front glass
    sm(0.06, 0.8, 1.2, GL, 1.27, 2.55, 0.2);             // side glass
    sm(1.7, 0.12, 1.7, K, 0.45, 3.1, 0.2);               // roof
    for (const x of [-0.4, 1.3]) sm(0.06, 1.3, 0.06, K, x, 2.45, 1.02);   // cab cage posts
    for (const y of [1.95, 2.9]) sm(1.9, 0.06, 0.06, K, 0.45, y, 1.02);   // cab cage rails
    sm(0.06, 1.2, 0.06, K, 1.3, 2.45, -0.5);             // cab rear post
    for (const z of [-0.2, 0.2, 0.6]) sm(0.05, 0.9, 0.05, 0x3a3d42, 1.25, 2.6, z); // cab side guard bars
    seg3(0.6, Y, [2.1, 0.9], [4.37, 4.43], -0.6);        // boom
    seg3(0.22, 0x2a2d31, [2.5, 0.2], [3.2, 2.2], -0.95); // boom cylinder
    seg3(0.45, Y, [4.37, 4.43], [1.9, 6.0], -0.6);       // stick
    sm(1.4, 0.95, 1.1, K, -0.6, 1.45, 6.4);              // bucket, black, with a deep shell
    sm(1.4, 0.16, 0.3, K, -0.6, 0.95, 6.9);              // bucket lip
    for (const x of [-1.2, -0.9, -0.6, -0.3, 0]) sm(0.14, 0.22, 0.2, K, x, 0.85, 7.1);               // five teeth
    return finishMachine(g, 10.4, 3.2, 2.0);
  }
  if (kind === 2) {                       // wheel loader: big black tyres with yellow hubs, a cab with glass, a scoop bucket on lift arms
    sm(2.0, 0.8, 1.9, Y, 0, 1.0, 1.4);                   // front frame
    sm(2.2, 1.3, 2.0, Y, 0, 1.3, -1.6);                  // rear body
    sm(2.0, 1.4, 1.9, Y, 0, 2.6, -0.6);                  // cab
    sm(1.8, 1.0, 0.06, GL, 0, 2.7, 0.37);                // windscreen
    for (const x of [-1.02, 1.02]) sm(0.06, 0.9, 1.4, GL, x, 2.7, -0.6);
    sm(2.1, 0.12, 2.0, K, 0, 3.35, -0.6);                // roof
    for (const x of [-0.95, 0.95]) seg3(0.22, K, [3.0, 0.1], [1.7, 3.0], x);   // lift arms
    sm(2.3, 0.9, 1.1, Y, 0, 0.75, 3.4);                  // bucket
    sm(2.3, 1.2, 0.12, Y, 0, 1.6, 2.95);                 // bucket back
    sm(2.36, 0.2, 0.25, K, 0, 0.3, 3.98);                // cutting lip
    for (const z of [1.6, -2.0]) for (const x of [-1.25, 1.25]) { sc(0.72, 0.5, T, x, 0.72, z, 0, Math.PI / 2, 16); sc(0.36, 0.52, Y, x, 0.72, z, 0, Math.PI / 2, 10); }
    return finishMachine(g, 6.7, 3.0, 0.6);
  }
  if (kind === 3) {                       // truck-mounted crane: a yellow cab, outriggers, a telescopic boom and a hook
    sm(2.2, 0.6, 9.4, K, 0, 0.9, 0.2);                   // chassis
    sm(2.4, 1.9, 2.3, Y, 0, 2.0, 4.0);                   // cab
    sm(2.2, 1.1, 0.06, GL, 0, 2.2, 5.17);                // windscreen
    for (const x of [-1.21, 1.21]) sm(0.06, 1.2, 1.1, K, x, 1.9, 4.1);   // door seams
    sm(2.5, 0.45, 0.3, K, 0, 0.7, 5.7);                  // bumper
    for (const x of [-0.85, 0.85]) sm(0.35, 0.22, 0.08, W_, x, 1.25, 5.66);
    sm(3.8, 0.35, 0.45, K, 0, 0.45, -3.8);               // outrigger beam
    for (const x of [-1.8, 1.8]) sm(0.6, 0.1, 0.6, T, x, 0.05, -3.8);   // pads
    sm(2.3, 1.1, 2.8, Y, 0, 1.9, -1.5);                  // crane body
    for (const x of [-1.16, 1.16]) sm(0.05, 0.7, 2.2, K, x, 1.9, -1.5);
    const pv = [2.6, -1.5], th = 1.2;                    // boom pivot (y, z) and its angle
    seg3(0.7, Y, pv, ray(pv, th, 4.0));                  // boom, base section
    seg3(0.55, T, ray(pv, th, 4.0), ray(pv, th, 9.0));   // boom, upper section
    seg3(0.18, 0x222222, [2.2, 0.2], ray(pv, th, 2.5));  // luffing cylinder
    const tip = ray(pv, th, 9.0);
    sc(0.3, 0.4, O, 0, tip[0], tip[1], 0, Math.PI / 2);  // head sheave
    seg3(0.04, 0x111111, tip, [3.2, tip[1]]);            // hoist cable
    sc(0.35, 0.5, O, 0, 3.0, tip[1], 0, Math.PI / 2);    // hook block
    for (const z of [4.2]) for (const x of [-1.2, 1.2]) sc(0.6, 0.5, T, x, 0.6, z, 0, Math.PI / 2);
    for (const z of [-2.4, -3.5]) for (const x of [-1.2, 1.2]) sc(0.6, 0.5, T, x, 0.6, z, 0, Math.PI / 2);
    return finishMachine(g, 9.8, 2.6, 1.0);
  }
  // road roller: a steel drum with yellow flanges under an orange frame and a glazed cab
  sc(1.05, 2.3, T, 0, 1.05, 1.5, 0, Math.PI / 2, 16);
  for (const x of [-1.2, 1.2]) sc(1.07, 0.12, Y, x, 1.05, 1.5, 0, Math.PI / 2, 16);
  sm(2.2, 0.5, 1.2, Y, 0, 1.2, 1.4);
  sm(2.3, 0.9, 2.6, O, 0, 1.7, -0.6);
  for (const x of [-1.16, 1.16]) sm(0.05, 0.6, 1.2, K, x, 1.9, -0.9);
  sm(2.1, 1.6, 2.0, O, 0, 2.9, -0.6);
  sm(1.9, 1.1, 0.06, GL, 0, 3.0, 0.42);
  for (const x of [-1.06, 1.06]) sm(0.06, 1.0, 1.6, GL, x, 3.0, -0.6);
  sm(2.2, 0.14, 2.2, K, 0, 3.8, -0.6);
  for (const x of [-1.2, 1.2]) { sc(0.7, 0.5, T, x, 0.7, -2.0, 0, Math.PI / 2); sc(0.35, 0.52, Y, x, 0.7, -2.0, 0, Math.PI / 2, 10); }
  return finishMachine(g, 5.35, 2.6, -0.03);
}
// Moves a machine's centre to zc and returns its footprint: length L along z, width W along x.
export function finishMachine(g, L, W, zc) { g.position.z = -zc; return { g, L, W }; }
// The construction sites of block (cx, cz) as footprints (the frame, and the crane base where there is one): the same
// streets and rules that generateChunk uses for the grass half of a barred street (see `site` there). A pure function of
// the street plan, so a pickup on a block's edge can ask about the site next door.
export function siteSpots(cx, cz) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, out = [];
  const segs = [['z', cx, cz], ['z', cx + 1, cz], ['x', cx, cz], ['x', cx, cz + 1]];
  const ends = [[[cx, cz], [cx, cz + 1]], [[cx + 1, cz], [cx + 1, cz + 1]], [[cx, cz], [cx + 1, cz]], [[cx, cz + 1], [cx + 1, cz + 1]]];
  const place = [[x0 + 4, z0 + 30, true], [x0 + 76, z0 + 30, false], [z0 + 4, x0 + 30, true], [z0 + 76, x0 + 30, false]];
  for (let k = 0; k < 4; k++) {
    const [a, jx, jz] = segs[k];
    if (!segClosed(a, jx, jz) || segFilled(a, jx, jz)) continue;
    if (riverSeg(a, jx, jz)) continue;                     // the river is water: no site on it (closedStreets in js/world.js)
    if (nbhdJunction(ends[k][0][0], ends[k][0][1]) || nbhdJunction(ends[k][1][0], ends[k][1][1])) continue;
    const [acr, alc, crane] = place[k];
    const ma = 22;   // the crane base stands this far past the frame's centre (see siteOn)
    if (a === 'z') { out.push({ x: acr, z: alc, hx: 3, hz: 14 }); if (crane) out.push({ x: acr, z: alc + ma, hx: 1.3, hz: 1.3 }); }
    else { out.push({ x: alc, z: acr, hx: 14, hz: 3 }); if (crane) out.push({ x: alc + ma, z: acr, hx: 1.3, hz: 1.3 }); }
  }
  return out;
}
