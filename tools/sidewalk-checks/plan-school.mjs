/* Renders the school straight from the generator: a plan of the block (classroom wing, gym, entrance, the fenced
   yard with its playground and court, the bus and staff lot with the buses that are actually parked) and a front
   elevation of the building from the builder in js/world.js.
   Run:  node tools/sidewalk-checks/plan-school.mjs   -> plan-school.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const { chunks, updateChunks, ck, CHUNK, PAVE_IN, PAVE_OUT } = world;
const here = path.dirname(url.fileURLToPath(import.meta.url));

updateChunks(40, 120, 999);
const school = chunks.get(ck(0, 1)) || [...chunks.values()].find(ch => ch.busSlots);
if (!school) { console.log('no school block in the spawn district'); process.exit(1); }

const HALF = CHUNK / 2, S = 6.2, PAD = 12, HEAD = 26, TABLE_H = 52;
const bx = school.cx * CHUNK + HALF, bz = school.cz * CHUNK + HALF;
const PLAN = Math.round(CHUNK * S);
const W = PLAN + PAD * 2, H = PLAN + HEAD + TABLE_H + PAD;
const cv = canvas(W, H, [232, 234, 237]);
const C = {
  road: [88, 92, 100], walk: [176, 179, 183], kerb: [150, 153, 157], lot: [75, 80, 88],
  grass: [123, 201, 111], mulch: [176, 138, 92], court: [75, 80, 88], courtLine: [233, 232, 223],
  building: [200, 176, 138], gym: [194, 177, 141], edge: [150, 128, 96], entrance: [240, 236, 225],
  fence: [154, 167, 159], gate: [247, 181, 0], bus: [247, 181, 0], busDark: [190, 138, 0], steel: [154, 162, 168],
  plinth: [185, 182, 173],
  car: [176, 182, 190], bay: [108, 114, 122], ink: [26, 30, 38], white: [247, 249, 250],
  swing: [74, 143, 208], slide: [208, 90, 74], tile: [232, 195, 58], sand: [224, 207, 154],
};
const X = x => PAD + (x - (bx - HALF)) * S;
const Y = z => HEAD + (z - (bz - HALF)) * S;

// ---- the street, the paving ring and the block pad ----
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + PLAN, C.road);
const kerb = PAVE_IN * S;
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + kerb, C.walk);
cv.rect(PAD, HEAD + PLAN - kerb, PAD + PLAN, HEAD + PLAN, C.walk);
cv.rect(PAD, HEAD, PAD + kerb, HEAD + PLAN, C.walk);
cv.rect(PAD + PLAN - kerb, HEAD, PAD + PLAN, HEAD + PLAN, C.walk);
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + kerb * 0.12, C.kerb);
cv.rect(PAD, HEAD + PLAN - kerb * 0.12, PAD + PLAN, HEAD + PLAN, C.kerb);
cv.rect(PAD, HEAD, PAD + kerb * 0.12, HEAD + PLAN, C.kerb);
cv.rect(PAD + PLAN - kerb * 0.12, HEAD, PAD + PLAN, HEAD + PLAN, C.kerb);
const hex = m => (m && m.c !== undefined) ? m.c : (m && m.color ? m.color.getHex() : 0xffffff);
const rgb = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
for (const o of school.schoolPaint || []) {          // every marking on the block: bays, court, paths, mulch, tiles
  const c = rgb(hex(o.m));
  const big = o.w * o.d > 300;
  cv.rect(X(o.x - o.w / 2), Y(o.z - o.d / 2), X(o.x + o.w / 2), Y(o.z + o.d / 2), c, big ? 0.95 : 0.8);
}

// ---- the yard and the fence, exactly where the builder put them ----
if (school.schoolYard) {
  const y = school.schoolYard;
  cv.rect(X(y.x - y.hx), Y(y.z - y.hz), X(y.x + y.hx), Y(y.z + y.hz), C.grass);
}
for (const m of school.schoolPlayground || []) {
  const col = m.name === 'basketball hoop' ? C.courtLine : m.name === 'sandbox' ? C.sand
    : m.name === 'slide' ? C.slide : m.name === 'swing set' ? C.swing : m.name === 'flagpole' ? [208, 80, 63] : C.tile;
  cv.disc(X(m.x), Y(m.z), m.name === 'entrance' ? 3 : 5, col, 0.95);
}
// the fence: the runs the builder records, with the gates left open
for (const f of school.schoolFence || []) {
  cv.rect(X(f.x - f.hx), Y(f.z - f.hz), X(f.x + f.hx), Y(f.z + f.hz), C.fence, 0.85);
}
// the two gates in the front line, drawn as a bright band between the fence runs (6 m school gate, 4 m service)
const front = (school.schoolFence || []).filter(f => Math.abs(f.z - bz) < 0.3 && f.hx > f.hz).sort((a, b) => a.x - b.x);
for (let i = 1; i < front.length; i++) {
  const a = front[i - 1], b = front[i];
  const x0 = X(a.x + a.hx), x1 = X(b.x - b.hx);
  cv.rect(x0, Y(bz - 0.35), x1, Y(bz + 0.35), C.gate);
  cv.rect(x0, Y(bz - 1.1), x0 + 2, Y(bz + 1.1), C.gate);
  cv.rect(x1 - 2, Y(bz - 1.1), x1, Y(bz + 1.1), C.gate);
  drawText(cv, (x0 + x1) / 2 - 14, Y(bz) + 8, 'GATE', C.ink, 1);
}
// ---- the buildings, from the solids the block actually registered ----
for (const o of school.solids) {
  if (o.fence || o.parked || !o.kind) continue;
  if (!(o.hx > 2 && o.hz > 2)) continue;
  const gym = Math.abs(o.x - bx - 17) < 1 && Math.abs(o.z - bz + 23) < 1;
  const ent = Math.abs(o.x - bx + 10) < 1 && Math.abs(o.z - bz + 19.2) < 1;
  cv.rect(X(o.x - o.hx), Y(o.z - o.hz), X(o.x + o.hx), Y(o.z + o.hz), ent ? C.entrance : gym ? C.gym : C.building);
  cv.rect(X(o.x - o.hx), Y(o.z - o.hz), X(o.x + o.hx), Y(o.z - o.hz), C.edge);
  cv.rect(X(o.x - o.hx), Y(o.z + o.hz), X(o.x + o.hx), Y(o.z + o.hz), C.edge);
  cv.rect(X(o.x - o.hx), Y(o.z - o.hz), X(o.x - o.hx), Y(o.z + o.hz), C.edge);
  cv.rect(X(o.x + o.hx), Y(o.z - o.hz), X(o.x + o.hx), Y(o.z + o.hz), C.edge);
}
// ---- the vehicles, as they are actually parked ----
for (const o of school.solids) {
  if (!o.parked) continue;
  const bus = o.parked.kind === 'schoolbus';
  const col = bus ? C.bus : C.car;
  cv.rect(X(o.x - o.hx), Y(o.z - o.hz), X(o.x + o.hx), Y(o.z + o.hz), col);
  if (bus) {                                                           // black rub rails + the bonnet
    for (const off of [-0.55, 0, 0.55]) cv.rect(X(o.x + off * o.hx) , Y(o.z - o.hz * 0.86), X(o.x + off * o.hx) + 1.5, Y(o.z - o.hz * 0.86) + 1.5, C.ink, 0.85);
    cv.rect(X(o.x + 3.4), Y(o.z - o.hz * 0.92), X(o.x + o.hx), Y(o.z + o.hz * 0.92), C.busDark, 0.9);
    cv.rect(X(o.x - o.hx), Y(o.z - o.hz * 0.5), X(o.x + o.hx), Y(o.z), C.ink, 0.25);
    if (!o.parked.wrecked) cv.rect(X(o.x - o.hx + 0.6), Y(o.z + o.hz * 0.62), X(o.x + o.hx - 0.6), Y(o.z + o.hz * 0.86), C.ink, 0.6);
    if (o.parked.wrecked) cv.rect(X(o.x - o.hx), Y(o.z - o.hz), X(o.x + o.hx), Y(o.z + o.hz), [74, 62, 58], 0.8);
  } else {
    cv.rect(X(o.x - o.hx * 0.72), Y(o.z - o.hz * 0.72), X(o.x + o.hx * 0.72), Y(o.z + o.hz * 0.72), C.white, 0.5);
  }
}
drawText(cv, PAD + 2, 8, `SCHOOL BLOCK (${school.cx},${school.cz})  ${school.busSlots.length} SCHOOL BUSES IN THE STAND  ${school.parkingTotal} BAYS`, C.ink);
drawText(cv, PAD + 2, HEAD + PLAN + 6, `FENCED YARD ${(school.schoolYard.hx * 2)}X${(school.schoolYard.hz * 2)}M WITH ${(school.schoolPlayground || []).length} PLAYGROUND PIECES, TWO GATES IN THE FRONT LINE`, C.ink);
drawText(cv, PAD + 2, HEAD + PLAN + 20, `BUSES: ${school.busSlots.map(sl => sl.kind).join(', ')}   STAFF + VISITOR BAYS: ${school.parkingTotal - school.parkingFixed}`, C.ink);

// ---- front elevation, straight from the builder ----
const F = world.buildSchoolMesh(bx, bz, Math.random);
// The harness' stand-in objects keep their position in .pos and the box size on the geometry (w/h/d), the way
// plan-firestation.mjs reads them.
const collect = (obj, ox = 0, oy = 0, oz = 0, out = []) => {
  const px = obj.pos ? obj.pos[0] : 0, py = obj.pos ? obj.pos[1] : 0, pz = obj.pos ? obj.pos[2] : 0;
  const rx = ox + px, ry = oy + py, rz = oz + pz;
  if (obj.isMesh && obj.geometry && obj.geometry.w !== undefined) {
    const col = obj.material && obj.material.c !== undefined ? obj.material.c : ((obj.material && obj.material.color) ? obj.material.color.getHex() : 0xcccccc);
    out.push({ x: rx, y: ry, z: rz, w: obj.geometry.w || 1, h: obj.geometry.h || 1, d: obj.geometry.d || 1, c: col });
  }
  for (const c of obj.children || []) collect(c, rx, ry, rz, out);
  return out;
};
const parts = collect(F.group).filter(p => p.y > 0.6 && p.z < -16);      // the building line only
const EW = Math.min(1000, W), EH = 320;
const minX = Math.min(...parts.map(p => p.x - p.w / 2)), maxX = Math.max(...parts.map(p => p.x + p.w / 2));
const maxY = Math.max(...parts.map(p => p.y + p.h / 2));
const ew = canvas(EW, EH, [214, 226, 238]);
for (let i = 0; i < 6; i++) ew.rect(0, EH * i / 6, EW, EH * (i + 1) / 6, [208 + i * 3, 222 + i * 2, 236 + i]);
const sx = (EW - 60) / (maxX - minX), sy = Math.min((EH - 90) / maxY, sx * 1.4);
const EX = x => 30 + (x - minX) * sx, EY = y => EH - 34 - y * sy;
ew.rect(0, EH - 34, EW, EH, [120, 128, 122]);
for (const p of parts.slice().sort((a, b) => (a.z + a.d / 2) - (b.z + b.d / 2))) {
  ew.rect(EX(p.x - p.w / 2), EY(p.y + p.h / 2), EX(p.x + p.w / 2), EY(p.y - p.h / 2), [(p.c >> 16) & 255, (p.c >> 8) & 255, p.c & 255]);
}
drawText(ew, 6, 6, `SCHOOL ELEVATION  ${(maxX - minX).toFixed(0)}M WIDE  ${maxY.toFixed(0)}M TALL  (CLASSROOM WING, ENTRANCE, GYMNASIUM)`, [22, 26, 34]);
drawText(ew, 6, EH - 22, `${parts.length} PIECES FROM THE BUILDER`, [240, 242, 246]);

// ---- fence detail: how the run is put together and what a hit does to it ----
const FD = 176, fw = canvas(W, FD, [237, 239, 242]);
{
  const zLine = 58, scale = (W - 44) / 58;                       // the block-local front line runs -28 .. +28 m
  const FX = lx => 22 + (lx + 28) * scale;
  drawText(fw, 8, 8, 'THE SCHOOLYARD FENCE, FRONT LINE — 7 RUNS, 15 TEAR-OFF PANELS, 39 POSTS', C.ink, 1);
  const byRun = [];
  for (const pc of school.fencePanels || []) (byRun[pc.run] = byRun[pc.run] || []).push(pc);
  const runsF = byRun.map((pieces, i) => ({ pieces, f: (school.schoolFence || [])[i] })).filter(o => o.f && Math.abs(o.f.z - bz) < 0.3 && o.f.hx > o.f.hz);
  for (const { pieces, f } of runsF) {
    const lx0 = f.x - bx - f.hx, lx1 = f.x - bx + f.hx;
    fw.rect(FX(lx0), zLine + 12, FX(lx1), zLine + 20, C.plinth);            // the plinth stays behind
    for (const pc of pieces) {                                              // the panels that tear off
      const half = pc.hx, cx2 = pc.x - bx;
      fw.rect(FX(cx2 - half) + 1, zLine - 22, FX(cx2 + half) - 1, zLine + 8, [150, 166, 156], 0.9);
      fw.rect(FX(cx2 - half) + 1, zLine + 5, FX(cx2 + half) - 1, zLine + 8, C.steel);
      for (let ci = 3; ci < pc.group.children.length; ci++) {
        const off = pc.group.children[ci].pos[0];
        fw.rect(FX(cx2 + off) - 1, zLine - 26, FX(cx2 + off) + 1, zLine + 10, C.ink, 0.85);
      }
      drawText(fw, FX(cx2) - 10, zLine + 26, (half * 2).toFixed(1) + 'M', C.ink, 1);
    }
    drawText(fw, FX((lx0 + lx1) / 2) - 16, zLine + 44, 'RUN ' + ((f.hx * 2) | 0) + 'M / ' + pieces.length + ' PANELS', [90, 96, 104], 1);
  }
  // the gates, between the runs
  const sorted = runsF.map(o => o.f).sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const gx0 = sorted[i - 1].x + sorted[i - 1].hx, gx1 = sorted[i].x - sorted[i].hx;
    fw.rect(FX(gx0 - bx), zLine - 4, FX(gx1 - bx), zLine + 16, C.gate, 0.9);
    drawText(fw, FX((gx0 + gx1) / 2 - bx) - 14, zLine + 30, 'GATE', C.ink, 1);
  }
  drawText(fw, 8, zLine + 68, 'A HIT OVER 4 m/s (DIVIDED BY sqrt(MASS)) TEARS THE PANEL IT LANDS ON OFF ITS PLINTH: THE SOLID IS', C.ink, 1);
  drawText(fw, 8, zLine + 84, 'DROPPED, THE PANEL TUMBLES AWAY AS ITS OWN PIECE, AND THE YARD IS OPEN TO DRIVE INTO. THE REST OF THE LINE STAYS.', C.ink, 1);
  drawText(fw, 8, zLine + 100, 'THE CONCRETE PLINTH (GREY) STAYS WHERE IT WAS POURED; THE POSTS (BLACK) TRAVEL WITH THEIR PANEL.', [90, 96, 104], 1);
}

const outH = H + 8 + EH + FD + 8;
const out = canvas(W, outH, [232, 234, 237]);
const blit = (src, dx, dy) => { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
  const i = (y * src.w + x) * 3, j = ((y + dy) * W + (x + dx)) * 3;
  if (j < 0 || j + 2 >= out.buf.length) continue;
  out.buf[j] = src.buf[i]; out.buf[j + 1] = src.buf[i + 1]; out.buf[j + 2] = src.buf[i + 2];
} };
blit(cv, 0, 0); blit(ew, Math.round((W - EW) / 2), H + 8); blit(fw, 0, H + 8 + EH + 8);
const file = path.join(here, 'plan-school.png');
fs.writeFileSync(file, writePNG(W, outH, out.buf));
console.log(`school block (${school.cx},${school.cz}): ${school.busSlots.length} buses in the stand, ${school.parkingTotal} bays, yard ${school.schoolYard.hx * 2}x${school.schoolYard.hz * 2} m with ${(school.schoolPlayground || []).length} playground pieces`);
console.log(`wrote ${file} (${W}x${outH})`);
