/* Flat-shaded z-buffer snapshot of the game world, rendered in Node — no browser, no WebGL, no network.
 *
 *   node tools/sidewalk-checks/shot.mjs <out.png> eyeX eyeY eyeZ lookX lookY lookZ [fov=62] [W=1200] [H=650]
 *
 * Run it with NO_MERGE=1 so the chunk bake lists are still separate pieces: that is what lets a view show the
 * merged building detail (a parade's roof plant, the interchange's deck) instead of only the unmerged props.
 * Geometry is gathered as each block is streamed in, because updateChunks hides and then disposes whatever is
 * outside its own view ring. Options: VIEW_R (rings to stream, default 3), SHOT_CX / SHOT_CZ (centre the sweep
 * on that block instead of the origin — the only way to render anywhere far from 0,0), SHOT_MINY / SHOT_MAXY
 * (skip pieces by their height), SHOT_MATS (only these material colours, as hex).
 */
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
import fs from 'node:fs';
import { canvas, writePNG, drawText } from './png.mjs';
const world = await import('../../js/world.js');

const [out, ex, ey, ez, lx, ly, lz, fov = 62, W = 1200, H = 650] = process.argv.slice(2);
if (!out) { console.error('usage: node shot.mjs out.png eyeX eyeY eyeZ lookX lookY lookZ [fov] [W] [H]'); process.exit(2); }
const EYE = [+ex, +ey, +ez], LOOK = [+lx, +ly, +lz], FOV = +fov, R = Number(process.env.VIEW_R || 3);

// ---- camera basis: facing +z, the world's +x is on the right (a right-handed view, as the game has) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const fwd = norm(sub(LOOK, EYE));
const right = norm([-fwd[2], 0, fwd[0]]);   // three.js basis: facing +z the world's +x is on the left
const up = norm(cross(right, fwd));       // right x forward: with `right` above this is the world's own up, so the sky stays at the top
const halfH = Math.tan(FOV * Math.PI / 360), halfW = halfH * W / H;
const toCam = p => { const d = sub(p, EYE); return [d[0] * right[0] + d[1] * right[1] + d[2] * right[2], d[0] * up[0] + d[1] * up[1] + d[2] * up[2], d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]]; };

// ---- gather triangles (mostly boxes: the game builds nearly everything from scaled unit boxes) ----
const tris = [];
let CUR = '?';
const pushGeo = (geo, mat4, material) => {
  const pos = geo.attributes && geo.attributes.position; if (!pos) return;
  if (material && material.transparent && (material.opacity === undefined || material.opacity < 0.6)) return;   // snow overlay, glass, beams
  if (process.env.SHOT_MATS && material && material.color && !process.env.SHOT_MATS.includes(material.color.getHex().toString(16))) return;
  const idx = geo.index ? Array.from(geo.index.array) : null;
  const n = idx ? idx.length : pos.count;
  // Textured materials (the road, the paving) are drawn in one flat tone: their colour is white and the detail
  // lives in the map, which this renderer does not sample.
  const col = material && material.map ? 0x585d66 : (material && material.color ? material.color.getHex() : 0xcccccc);
  const basic = !!(material && material.isMeshBasicMaterial);
  const e = mat4.elements;
  const at = i => {
    const x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
    return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
  };
  for (let i = 0; i + 2 < n; i += 3) tris.push({ a: at(idx ? idx[i] : i), b: at(idx ? idx[i + 1] : i + 1), c: at(idx ? idx[i + 2] : i + 2), col, basic });
};
const seen = new Set(), harvested = new Set();
const harvestChunk = ch => {
  const key = ch.cx + ',' + ch.cz;
  if (harvested.has(key) || (!ch.mergeQ && !ch.group.children.length)) return;
  harvested.add(key);
  ch.group.updateMatrixWorld(true);
  for (const b of ch.mergeQ || []) pushGeo(b.geo, b.m, Array.isArray(b.mat) ? b.mat[0] : b.mat);
  for (const child of ch.group.children) {
    if (child.isInstancedMesh) continue;                          // trees: instanced, and not the subject here
    child.updateMatrixWorld(true);
    if (child.isMesh) pushGeo(child.geometry, child.matrixWorld, child.material);
    else if (child.isGroup) child.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !seen.has(o)) { seen.add(o); o.updateMatrixWorld(true); pushGeo(o.geometry, o.matrixWorld, o.material); } });
  }
};
// Each block is streamed in whole (a budget of 999 tells updateChunks to build the entire ring with no deferred
// merging) and harvested at once. A streaming budget of one block at a time, as the game itself uses, disposes
// and rebuilds blocks as its centre walks the ring — and a block that is disposed before it is ever harvested
// simply vanishes from the picture, which is how an earlier run of this tool managed to lose a quarter of the
// interchange. Blocks outside the ring are disposed afterwards; the triangle data is already copied out by then.
const CX = process.env.SHOT_CX ? +process.env.SHOT_CX : 0, CZ = process.env.SHOT_CZ ? +process.env.SHOT_CZ : 0;
for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
  world.updateChunks((CX + cx) * 80 + 40, (CZ + cz) * 80 + 40, 999);
  for (const ch of world.chunks.values()) harvestChunk(ch);
}

// ---- rasterise ----
const cv = canvas(W, H, [154, 213, 255]);
const zbuf = new Float64Array(W * H).fill(Infinity);
const L = norm([0.45, 0.82, 0.35]);
const MINY = process.env.SHOT_MINY ? +process.env.SHOT_MINY : -1e9;
const MAXY = process.env.SHOT_MAXY ? +process.env.SHOT_MAXY : 1e9;
const NEAR = 0.2;
// Clip against the near plane so nothing behind the camera is ever rasterised.
const clipNear = P => {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const cur = P[i], nxt = P[(i + 1) % P.length];
    const curIn = cur[2] >= NEAR, nxtIn = nxt[2] >= NEAR;
    if (curIn) out.push(cur);
    if (curIn !== nxtIn) {
      const k = (NEAR - cur[2]) / (nxt[2] - cur[2]);
      out.push([cur[0] + (nxt[0] - cur[0]) * k, cur[1] + (nxt[1] - cur[1]) * k, NEAR]);
    }
  }
  return out;
};
let drawn = 0;
for (const t of tris) {
  const cy = (t.a[1] + t.b[1] + t.c[1]) / 3;
  if (cy < MINY || cy > MAXY) continue;
  const poly = clipNear([toCam(t.a), toCam(t.b), toCam(t.c)]);
  if (poly.length < 3) continue;
  const n = norm(cross(sub(t.b, t.a), sub(t.c, t.a)));
  const lam = t.basic ? 1 : 0.52 + 0.48 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  const cr = Math.min(255, (t.col >> 16 & 255) * lam) | 0, cg = Math.min(255, (t.col >> 8 & 255) * lam) | 0, cb = Math.min(255, (t.col & 255) * lam) | 0;
  for (let f = 1; f + 1 < poly.length; f++) {
    const A = poly[0], B = poly[f], C = poly[f + 1];
    // Screen coordinates. The projection is centred on the view axis, so it has to be shifted by half the
    // frame: without the offsets the picture showed the bottom-right quadrant of the frustum, aimed half a
    // frame up and to the left of the point the camera was told to look at.
    const P = [A, B, C].map(p => [(p[0] / (p[2] * halfW)) * (W / 2) + W / 2, -(p[1] / (p[2] * halfH)) * (H / 2) + H / 2, p[2]]);
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    if (minX > maxX || minY > maxY) continue;
    const [x0, y0] = P[0], [x1, y1] = P[1], [x2, y2] = P[2];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    drawn++;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / area;
      const w1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / area;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const z = A[2] + (B[2] - A[2]) * w1 + (C[2] - A[2]) * w0;
      const i = y * W + x;
      if (z >= zbuf[i]) continue;
      zbuf[i] = z; cv.buf[i * 3] = cr; cv.buf[i * 3 + 1] = cg; cv.buf[i * 3 + 2] = cb;
    }
  }
}
const label = `EYE ${EYE.join(' ')}  LOOK ${LOOK.join(' ')}`.replace(/[^A-Za-z0-9 .,:/()-]/g, ' ');
drawText(cv, 8, 8, label, [20, 20, 20], 2);
drawText(cv, 7, 7, label, [255, 255, 255], 2);
console.error(`${tris.length} triangles, ${drawn} drawn`);
fs.writeFileSync(out, writePNG(W, H, cv.buf));
console.log('wrote ' + out);
