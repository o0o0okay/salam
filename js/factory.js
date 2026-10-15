/* Industrial factories: the four plant layouts (brick, concrete, plant, complex).
 * Split out of js/campus.js. */
import * as THREE from 'three';
import { mat } from './assets.js';
import { box } from './assets.js';
import { cyl } from './assets.js';
import { PI } from './utils.js';

// ---- Factory ----
// An industrial plant on a block of its own, in one of four layouts taken from the reference art: a red-brick works
// with a banded brick stack and a pipe run over the frontage; a long grey concrete hall with three tall stacks; a
// plant with a tall cylindrical tank, brick offices and twin banded stacks; and a grey complex of towers with lit
// windows, silos and striped chimneys. Every layout fits inside the block's effective bounds (about 52 m by 44 m),
// and the yard in front carries containers and drums. The builder works in block-local coordinates like the others:
// children are placed around the origin, and solids are returned in world coordinates (bx + x, bz + z).
export const FACTORY_KINDS = ['brick', 'concrete', 'plant', 'complex'];
export function buildFactoryMesh(bx, bz, rng, kind) {
  const g = new THREE.Group(), solids = [], stacks = [];
  const Y = 0.25;
  const B = (w, h, d, m, x, y, z, cast = true) => { const b = box(w, h, d, m, x, y, z, cast); g.add(b); return b; };
  const C = (rt, rb, h, seg, m, x, y, z, cast = true) => { const c = cyl(rt, rb, h, seg, m, x, y, z, cast); g.add(c); return c; };
  const solid = (x, z, hx, hz, k = 'building') => solids.push({ x: bx + x, z: bz + z, hx, hz, kind: k });
  // A pipe run along x or z at height y (the cylinder is turned to lie along the run).
  const pipeX = (x0, x1, y, z, r, m) => { C(r, r, Math.abs(x1 - x0), 8, m, (x0 + x1) / 2, y, z).rotation.z = PI / 2; };
  const pipeZ = (z0, z1, y, x, r, m) => { C(r, r, Math.abs(z1 - z0), 8, m, x, y, (z0 + z1) / 2).rotation.x = PI / 2; };
  // Glazed panels on a wall facing +z at z = zf: one row per centre height in `ys`, standing a little proud of the wall.
  const windowsZ = (x0, x1, zf, ys, m, pitch = 3.4, wdt = 1.9, hgt = 1.7) => {
    const n = Math.max(1, Math.floor((x1 - x0) / pitch));
    for (const y of ys) for (let c = 0; c < n; c++) B(wdt, hgt, 0.12, m, x0 + (c + 0.5) * (x1 - x0) / n, y, zf + 0.06, false);
  };
  // A stack with bands of a second colour every `every` metres, and an optional platform at height `platY`.
  const stack = (x, z, r, h, base, band, every, platY) => {
    C(r, r * 1.04, h, 14, base, x, Y + h / 2, z);
    for (let y = every; y < h - 1; y += every * 2) C(r * 1.07, r * 1.07, every, 14, band, x, Y + y + every / 2, z, false);
    if (platY) C(r * 1.9, r * 1.9, 0.25, 12, darkSteel, x, Y + platY, z, false);
    solid(x, z, r + 0.2, r + 0.2);
    stacks.push({ x: bx + x, z: bz + z, top: Y + h, r });    // where the smoke comes out (js/chimneySmoke.js)
  };
  // Yard: a row of containers along x at depth z (solid like the warehouse containers).
  const yard = (z, n, cx) => {
    const cc = [0xd9534f, 0x3b82c4, 0xf2b134, 0x4caf50, 0xe8e8e8];
    for (let i = 0; i < n; i++) {
      const x = cx + (i - (n - 1) / 2) * 7.2 + (rng() - 0.5);
      B(6, 2.5, 2.5, mat(cc[Math.floor(rng() * cc.length)]), x, Y + 1.25, z);
      solid(x, z, 3, 1.25, 'container');
    }
  };
  const drums = (x0, z, n, m) => { for (let i = 0; i < n; i++) C(0.55, 0.55, 1.2, 10, m, x0 + i * 1.5, Y + 0.6, z); };

  const brickM = mat(0xa8553a), brickD = mat(0x8a4331), roofM = mat(0x5f646c);
  const concM = mat(0x9a9da4), concD = mat(0x7b7f88), glass = mat(0x2c3f52), garage = mat(0x3d4149);
  const steel = mat(0xb7bec6), darkSteel = mat(0x6b727b), white = mat(0xe9e6df), red = mat(0xb03a2e);

  if (kind === 'brick') {
    // Red-brick works: a two-storey hall with a taller brick block at its end, a banded brick stack behind, and a pipe
    // run over the frontage from the works to the stack.
    B(34, 9, 14, brickM, -6, Y + 4.5, -8); B(34.4, 0.6, 14.4, roofM, -6, Y + 9.3, -8);
    solid(-6, -8, 17, 7);
    B(12, 12, 10, brickD, 14, Y + 6, -6); B(12.4, 0.5, 10.4, roofM, 14, Y + 12.25, -6);
    solid(14, -6, 6, 5);
    windowsZ(-21, 9, -1, [Y + 6.6], glass, 3.6, 1.9, 1.9);
    for (const x of [-16, -4]) B(3.6, 4.2, 0.2, garage, x, Y + 2.1, -0.95, false);       // roll doors
    windowsZ(8, 20, -11, [Y + 3.2, Y + 6.5, Y + 9.5], glass, 3.4, 1.7, 1.7);
    stack(20, -15, 1.9, 36, brickM, white, 6, 26);
    pipeX(-22, 18, 9, -0.5, 0.45, steel);
    for (let x = -21; x <= 17; x += 8) C(0.3, 0.3, 9, 6, darkSteel, x, Y + 4.5, -0.5, false);
    pipeZ(-14, -1, 9, 17, 0.4, steel);
    yard(10, 4, -4); drums(-20, 14, 5, mat(0x3a6ea5));
  } else if (kind === 'concrete') {
    // Long grey concrete hall with ribbon glazing over a ground floor of roll doors, a small office at one end, and three
    // tall stacks behind it.
    B(38, 14, 13, concM, 0, Y + 7, -6); B(38.4, 0.6, 13.4, roofM, 0, Y + 14.3, -6);
    solid(0, -6, 19, 6.5);
    windowsZ(-17, 17, 0.5, [Y + 4.2, Y + 7.3, Y + 10.4], glass, 4.6, 3.4, 1.8);
    for (let i = 0; i < 6; i++) B(3.2, 4.0, 0.2, garage, -15 + i * 6, Y + 2.0, 0.6, false);
    B(7, 9, 9, concD, 22.5, Y + 4.5, -8); B(7.4, 0.5, 9.4, roofM, 22.5, Y + 9.25, -8);
    solid(22.5, -8, 3.5, 4.5);
    stack(-13, -17, 1.9, 30, concM, concD, 5, 20);
    stack(-1, -18, 2.1, 34, concM, concD, 5, 24);
    stack(10, -17, 1.8, 28, concM, concD, 5, 18);
    drums(-19, 8, 6, mat(0x5a5f68)); drums(4, 9, 5, mat(0x3a6ea5));
    yard(16, 4, 0);
  } else if (kind === 'plant') {
    // A plant: a large cylindrical tank with its rail and cap, a brick office block, a concrete hall behind, a pipe rack along
    // the yard side, and a tall banded stack with two smaller stacks beside it.
    C(4.4, 4.4, 14, 16, mat(0xb9bcc2), -19, Y + 7, -16); C(4.6, 4.6, 0.25, 16, darkSteel, -19, Y + 14.1, -16, false);
    C(0.8, 4.2, 1.2, 16, mat(0x9ea3aa), -19, Y + 14.6, -16);
    solid(-19, -16, 4.4, 4.4);
    B(20, 8, 13, brickM, -12, Y + 4, -4); B(20.4, 0.5, 13.4, roofM, -12, Y + 8.25, -4);
    solid(-12, -4, 10, 6.5);
    windowsZ(-21, -3, 2.5, [Y + 2.6, Y + 5.8], glass, 3.4, 1.7, 1.7);
    B(22, 12, 14, concM, 10, Y + 6, -8); B(22.4, 0.5, 14.4, roofM, 10, Y + 12.25, -8);
    solid(10, -8, 11, 7);
    windowsZ(2, 18, -1, [Y + 3.0, Y + 6.5, Y + 9.5], glass, 3.4, 2.0, 2.0);
    stack(4, -21, 1.1, 22, concM, red, 3, 15); stack(12, -21, 1.1, 22, concM, red, 3, 15);
    stack(20.5, -20, 1.6, 34, white, red, 4, 28);
    pipeX(-15, 2, 7.5, 4.0, 0.45, steel);
    for (const x of [-14, -8, -2]) C(0.3, 0.3, 7.5, 6, darkSteel, x, Y + 3.75, 4.0, false);
    yard(12, 3, 4); drums(-6, 10, 4, mat(0x5a5f68));
  } else { // complex
    // A grey complex: three blocks of different heights with lit windows, two silos, two banded stacks and a tank.
    B(12, 16, 12, concM, -16, Y + 8, -6); solid(-16, -6, 6, 6);
    B(16, 12, 12, concD, 2, Y + 6, -6); solid(2, -6, 8, 6);
    B(10, 20, 10, concM, 16, Y + 10, -8); solid(16, -8, 5, 5);
    const lit = mat(0xffd98a, { emissive: 0x5a4212 });
    windowsZ(-21, -11, 0, [Y + 2.5, Y + 5.5, Y + 8.5, Y + 11.5, Y + 14.5], lit, 3.0, 1.8, 1.8);
    windowsZ(-4, 10, 0, [Y + 2.5, Y + 5.5, Y + 8.5, Y + 11.5], lit, 3.0, 1.8, 1.8);
    windowsZ(11, 21, -3, [Y + 3, Y + 6, Y + 9, Y + 12, Y + 15, Y + 18], lit, 3.0, 1.8, 1.8);
    stack(-6, -18, 1.2, 28, white, red, 2, 0);
    stack(7, -18, 1.2, 22, white, red, 2, 0);
    C(3.2, 3.2, 18, 16, concD, -22.5, Y + 9, -16); solid(-22.5, -16, 3.3, 3.3);
    C(2.4, 2.4, 12, 14, mat(0x8f96a0), 23.6, Y + 6, -17); solid(23.6, -17, 2.6, 2.6);
    yard(12, 5, -2); drums(-22, 9, 4, mat(0x3a6ea5));
  }
  return { group: g, solids, stacks };
}

