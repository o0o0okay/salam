/* Renders the fire station straight from the generator: a plan of the block (hall, tower, annex, apron and
   the appliances actually parked) and a front elevation of the building from the builder in js/world.js.
   Run:  node tools/sidewalk-checks/plan-firestation.mjs   -> plan-firestation.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const { chunks, updateChunks, ck, CHUNK, PAVE_IN } = world;
const here = path.dirname(url.fileURLToPath(import.meta.url));

updateChunks(0, 0, 999);
const station = chunks.get(ck(0, -1)) || [...chunks.values()].find(ch => ch.fireSlots);
if (!station) { console.log('no fire station block in the spawn district'); process.exit(1); }

const HALF = CHUNK / 2, S = 6.2, PAD = 12, HEAD = 26;
const bx = station.cx * CHUNK + HALF, bz = station.cz * CHUNK + HALF;
const PLAN = Math.round(CHUNK * S), TABLE_H = 40;
const W = PLAN + PAD * 2, H = PLAN + HEAD + TABLE_H + PAD;
const cv = canvas(W, H, [232, 234, 237]);
const C = {
  road: [88, 92, 100], walk: [176, 179, 183], pad: [92, 97, 105], apron: [122, 127, 134],
  building: [200, 52, 46], buildingEdge: [150, 34, 30], door: [58, 63, 70], annex: [186, 190, 192],
  truck: [200, 52, 46], truckW: [241, 242, 240], ink: [26, 30, 38], bay: [214, 218, 221],
};
const X = x => PAD + (x - (bx - HALF)) * S;
const Y = z => HEAD + (z - (bz - HALF)) * S;

// roads + sidewalk ring
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + PLAN, C.road);
const kerb = PAVE_IN * S;
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + kerb * 0.5, C.walk);
cv.rect(PAD, HEAD + PLAN - kerb * 0.5, PAD + PLAN, HEAD + PLAN, C.walk);
cv.rect(PAD, HEAD, PAD + kerb * 0.5, HEAD + PLAN, C.walk);
cv.rect(PAD + PLAN - kerb * 0.5, HEAD, PAD + PLAN, HEAD + PLAN, C.walk);
// block yard + apron
cv.rect(X(bx - 25), Y(bz - 23), X(bx + 25), Y(bz + 23), C.pad);
cv.rect(X(bx - 19), Y(bz - 2), X(bx + 19), Y(bz + 14.4), C.apron);

// building volumes from the generated solids
const walls = station.solids.filter(o => o.kind === 'building');
for (const w of walls) {
  const annex = Math.abs(w.x - bx - 15) < 0.01;
  cv.rect(X(w.x - w.hx), Y(w.z - w.hz), X(w.x + w.hx), Y(w.z + w.hz), annex ? C.annex : C.building);
  cv.rect(X(w.x - w.hx), Y(w.z - w.hz), X(w.x + w.hx), Y(w.z - w.hz), C.buildingEdge);
  cv.rect(X(w.x - w.hx), Y(w.z + w.hz), X(w.x + w.hx), Y(w.z + w.hz), C.buildingEdge);
  cv.rect(X(w.x - w.hx), Y(w.z - w.hz), X(w.x - w.hx), Y(w.z + w.hz), C.buildingEdge);
  cv.rect(X(w.x + w.hx), Y(w.z - w.hz), X(w.x + w.hx), Y(w.z + w.hz), C.buildingEdge);
}
// shower of white bands on the hall, like the building model
cv.rect(X(bx - 16), Y(bz - 19 + 1.1), X(bx + 16), Y(bz - 19 + 1.35), C.truckW, 0.8);
cv.rect(X(bx - 16), Y(bz - 19 + 3.3), X(bx + 16), Y(bz - 19 + 3.55), C.truckW, 0.8);
// bay doors
for (const d of station.fireDoors || []) {
  const wx = bx + d.x, wz = bz - 11 + 8;
  cv.rect(X(wx - d.w / 2), Y(wz - 0.6), X(wx + d.w / 2), Y(wz + 0.9), C.door);
}
// the appliances, as they are actually parked
for (const sl of station.fireSlots || []) {
  const large = sl.kind === 'firetruck';
  const col = large ? C.truck : [214, 74, 66];
  cv.rect(X(sl.x - sl.hx), Y(sl.z - sl.hz), X(sl.x + sl.hx), Y(sl.z + sl.hz), col);
  cv.rect(X(sl.x - sl.hx), Y(sl.z - sl.hz * 0.1), X(sl.x + sl.hx), Y(sl.z + sl.hz * 0.1), C.truckW, 0.85);   // white stripe
  cv.rect(X(sl.x - sl.hx * 0.75), Y(sl.z + sl.hz * 0.25), X(sl.x + sl.hx * 0.75), Y(sl.z + sl.hz * 0.62), C.door, 0.6); // cab
  if (large) cv.rect(X(sl.x - sl.hx * 0.5), Y(sl.z - sl.hz * 0.9), X(sl.x + sl.hx * 0.5), Y(sl.z - sl.hz * 0.2), [190, 196, 200], 0.9); // ladder
  if (!sl.car) drawText(cv, X(sl.x) - 10, Y(sl.z) - 4, 'EMPTY', [250, 250, 250], 1);
}
drawText(cv, PAD + 2, 8, `FIRE STATION BLOCK (${station.cx},${station.cz})  ${station.fireSlots.length} APPLIANCES ON STATION`, C.ink);
drawText(cv, PAD + 2, HEAD + PLAN + 6, 'TWO LARGE ENGINES + ONE SMALL SQUAD, STANDING IN FRONT OF THEIR BAY DOORS', C.ink);
drawText(cv, PAD + 2, HEAD + PLAN + 20, `BAYS: ${station.fireSlots.map(sl => sl.kind).join(', ')}`, C.ink);

// ---- front elevation, straight from the builder ----
const F = world.buildFireStationMesh(bx, bz, Math.random);
const collect = (obj, ox = 0, oy = 0, oz = 0, out = []) => {
  const px = obj.pos ? obj.pos[0] : 0, py = obj.pos ? obj.pos[1] : 0, pz = obj.pos ? obj.pos[2] : 0;
  const rx = ox + px, ry = oy + py, rz = oz + pz;
  if (obj.isMesh && obj.geometry) out.push({ x: rx, y: ry, z: rz, w: obj.geometry.w || 1, h: obj.geometry.h || 1, d: obj.geometry.d || 1, c: (obj.material && obj.material.c) || 0xcccccc });
  for (const c of obj.children || []) collect(c, rx, ry, rz, out);
  return out;
};
const parts = collect(F.group);
const EW = 420, EH = 300;
const minX = Math.min(...parts.map(p => p.x - p.w / 2)), maxX = Math.max(...parts.map(p => p.x + p.w / 2));
const maxY = Math.max(...parts.map(p => p.y + p.h / 2));
const ew = canvas(EW, EH, [214, 226, 238]);
const sx = (EW - 40) / (maxX - minX), sy = Math.min((EH - 70) / maxY, sx * 1.4);
const EX = x => 20 + (x - minX) * sx, EY = y => EH - 30 - y * sy;
for (let i = 0; i < 6; i++) ew.rect(0, EH * i / 6, EW, EH * (i + 1) / 6, [208 + i * 3, 222 + i * 2, 236 + i]);
ew.rect(0, EH - 30, EW, EH, [120, 128, 122]);
for (const p of parts.slice().sort((a, b) => (a.z + a.d / 2) - (b.z + b.d / 2))) {
  ew.rect(EX(p.x - p.w / 2), EY(p.y + p.h / 2), EX(p.x + p.w / 2), EY(p.y - p.h / 2), [(p.c >> 16) & 255, (p.c >> 8) & 255, p.c & 255]);
}
drawText(ew, 6, 6, `FIRE STATION FRONT ELEVATION  ${(maxX - minX).toFixed(0)}M WIDE  ${maxY.toFixed(0)}M TALL`, [22, 26, 34]);
drawText(ew, 6, EH - 20, `${parts.length} BOXES FROM THE BUILDER`, [240, 242, 246]);

const outH = H + 8 + EH;
const out = canvas(W, outH, [232, 234, 237]);
const blit = (src, dx, dy) => { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
  const i = (y * src.w + x) * 3, j = ((y + dy) * W + (x + dx)) * 3;
  if (j < 0 || j + 2 >= out.buf.length) continue;
  out.buf[j] = src.buf[i]; out.buf[j + 1] = src.buf[i + 1]; out.buf[j + 2] = src.buf[i + 2];
} };
blit(cv, 0, 0); blit(ew, Math.round((W - EW) / 2), H + 8);
const file = path.join(here, 'plan-firestation.png');
fs.writeFileSync(file, writePNG(W, outH, out.buf));
console.log(`fire station (${station.cx},${station.cz}): ${station.fireSlots.map(sl => sl.kind).join(', ')} parked in front of ${(station.fireDoors || []).length} bay doors`);
console.log(`wrote ${file} (${W}x${outH})`);
