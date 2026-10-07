/* Close-up renders of the hospital air ambulance, straight from the builder in js/world.js — three views so
   the shape can be judged without launching a browser: right side, front (from the car park) and top.
   Run:  node tools/sidewalk-checks/plan-helicopter.mjs   -> plan-helicopter.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const here = path.dirname(url.fileURLToPath(import.meta.url));

const R = world.buildHospitalMesh(0, 0, Math.random);
const bump = (min, v, max) => Math.max(min, Math.min(max, v));
const collect = (obj, ox = 0, oy = 0, oz = 0, out = []) => {
  const px = obj.pos ? obj.pos[0] : 0, py = obj.pos ? obj.pos[1] : 0, pz = obj.pos ? obj.pos[2] : 0;
  const rx = ox + px, ry = oy + py, rz = oz + pz;
  if (obj.isMesh && obj.geometry) {
    const w = obj.geometry.w || 1, h = obj.geometry.h || 1, d = obj.geometry.d || 1;
    out.push({ x: rx, y: ry, z: rz, w, h, d, c: (obj.material && obj.material.c) || 0xcccccc });
  }
  for (const c of obj.children || []) collect(c, rx, ry, rz, out);
  return out;
};
// everything that makes up the parked helicopter, in the campus's own coordinates
const parts = collect(R.heliBody);
collect(R.heliMain, R.heliMast[0], R.heliMast[1], R.heliMast[2], parts);
collect(R.heliTail, R.heliTailPos[0], R.heliTailPos[1], R.heliTailPos[2], parts);

const VIEWS = {
  // viewer on the right flank: horizontal = z (nose to the right), depth = x
  side: { u: p => p.z, v: p => p.y, uw: p => p.d, vh: p => p.h, depth: p => p.x, flip: true },
  // viewer in front of the nose: horizontal = x, depth = z
  front: { u: p => p.x, v: p => p.y, uw: p => p.w, vh: p => p.h, depth: p => p.z, flip: false },
  // viewer above: horizontal = x, vertical = z, depth = y
  top: { u: p => p.x, v: p => p.z, uw: p => p.w, vh: p => p.d, depth: p => p.y, flip: false },
};

function draw(view, W, H, pad, title, label) {
  const all = parts;
  const view2 = VIEWS[view];
  const us = all.map(p => [view2.u(p) - view2.uw(p) / 2, view2.u(p) + view2.uw(p) / 2]);
  const vs = all.map(p => [view2.v(p) - view2.vh(p) / 2, view2.v(p) + view2.vh(p) / 2]);
  const u0 = Math.min(...us.map(a => a[0])), u1 = Math.max(...us.map(a => a[1]));
  const v0 = Math.min(...vs.map(a => a[0])), v1 = Math.max(...vs.map(a => a[1]));
  const s = Math.min((W - pad * 2) / (u1 - u0), (H - pad * 2 - 14) / (v1 - v0));
  const cv = canvas(W, H, [206, 222, 238]);
  for (let i = 0; i < 6; i++) cv.rect(0, (H - 30) * i / 6, W, (H - 30) * (i + 1) / 6, [200 + i * 3, 218 + i * 2, 236 + i]);
  cv.rect(0, H - 30, W, H, [120, 128, 122]);                              // ground strip
  const UX = u => pad + (u - u0) * s;
  const VY = v => H - 30 - (v - v0) * s;
  // painter's algorithm: far parts first
  const order = all.slice().sort((a, b) => view2.flip ? view2.depth(b) - view2.depth(a) : view2.depth(a) - view2.depth(b));
  for (const p of order) {
    const col = [(p.c >> 16) & 255, (p.c >> 8) & 255, p.c & 255];
    const uu = view2.u(p), vv = view2.v(p);
    cv.rect(UX(uu - view2.uw(p) / 2), VY(vv + view2.vh(p) / 2), UX(uu + view2.uw(p) / 2), VY(vv - view2.vh(p) / 2), col);
  }
  drawText(cv, 4, 5, title, [20, 24, 32]);
  drawText(cv, 4, H - 22, label, [244, 246, 250]);
  return cv;
}

const SIDE = draw('side', 640, 300, 24, 'AIR AMBULANCE - RIGHT SIDE (NOSE RIGHT)', `ROTOR ${(9 * 1).toFixed(0)}M  FUSELAGE 6M`);
const FRONT = draw('front', 300, 260, 20, 'FRONT', 'WIDTH 2.4M');
const TOP = draw('top', 300, 260, 20, 'TOP', 'ROTOR DISC 9M');
const W = SIDE.w, H = SIDE.h + 8 + FRONT.h;
const out = canvas(W, H, [232, 234, 237]);
const blit = (src, dx, dy) => { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
  const i = (y * src.w + x) * 3, j = ((y + dy) * W + (x + dx)) * 3;
  out.buf[j] = src.buf[i]; out.buf[j + 1] = src.buf[i + 1]; out.buf[j + 2] = src.buf[i + 2];
} };
blit(SIDE, 0, 0); blit(FRONT, 0, SIDE.h + 8); blit(TOP, FRONT.w + 8, SIDE.h + 8);
const file = path.join(here, 'plan-helicopter.png');
fs.writeFileSync(file, writePNG(W, H, out.buf));
console.log(`air ambulance: ${parts.length} boxes collected for the close-up`);
console.log(`wrote ${file} (${W}x${H}) — side / front / top`);
