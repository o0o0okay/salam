/* Renders the hospital block straight from the generated chunk: building footprints, painted bays, the cars
   and ambulances actually parked, plus the occupancy the live parking system will settle on at four times of
   day (shared rule `lotCars` from js/world.js).
   Run:  node tools/sidewalk-checks/plan-hospital.mjs   -> plan-hospital.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const { chunks, updateChunks, ck, CHUNK, PAVE_IN, lotCars } = world;
const here = path.dirname(url.fileURLToPath(import.meta.url));

updateChunks(0, 0, 999);
const hosp = [...chunks.values()].filter(ch => ch.parkingFixed);
const pinned = chunks.get(ck(-1, 0)) || hosp[0];
if (!pinned) { console.log('no hospital block in the spawn district'); process.exit(1); }

const HALF = CHUNK / 2, S = 6.2;                       // pixels per metre
const bx = pinned.cx * CHUNK + HALF, bz = pinned.cz * CHUNK + HALF;
const PAD = 12, HEAD = 26, PLAN = Math.round(CHUNK * S);
const TABLE_H = 9 * 14 + 14;
const W = PLAN + PAD * 2, H = PLAN + HEAD + TABLE_H + PAD;
const cv = canvas(W, H, [232, 234, 237]);

const C = {
  road: [88, 92, 100], walk: [176, 179, 183], pad: [74, 80, 92], bay: [226, 226, 218], bayTaken: [96, 100, 108],
  building: [222, 226, 228], buildingEdge: [150, 156, 160], glass: [90, 150, 200], house: [206, 210, 212],
  amb: [244, 246, 248], stripe: [212, 43, 43], ink: [26, 30, 38], helipad: [200, 204, 208],
};
const X = x => PAD + (x - (bx - HALF)) * S;
const Y = z => HEAD + (z - (bz - HALF)) * S;

// roads around the block, then the sidewalk ring
cv.rect(0, 0, W, HEAD + PLAN, [225, 227, 230]);
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + PLAN, C.road);
const kerb = PAVE_IN * S;
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + kerb, C.road);
cv.rect(PAD, HEAD + PLAN - kerb, PAD + PLAN, HEAD + PLAN, C.road);
cv.rect(PAD, HEAD, PAD + kerb, HEAD + PLAN, C.road);
cv.rect(PAD + PLAN - kerb, HEAD, PAD + PLAN, HEAD + PLAN, C.road);
cv.rect(PAD, HEAD, PAD + PLAN, HEAD + kerb * 0.5, C.road);
for (const [x0, y0, x1, y1] of [
  [PAD + kerb * 0.5, HEAD + kerb * 0.5, PAD + PLAN - kerb * 0.5, HEAD + kerb * 0.5],
  [PAD + kerb * 0.5, HEAD + PLAN - kerb * 0.5, PAD + PLAN - kerb * 0.5, HEAD + PLAN - kerb * 0.5],
]) { cv.rect(x0, y0, x1, y0, C.walk); cv.rect(x0, y1, x1, y1, C.walk); }
cv.rect(PAD + kerb * 0.5, HEAD + kerb * 0.5, PAD + kerb * 0.5, HEAD + PLAN - kerb * 0.5, C.walk);
cv.rect(PAD + PLAN - kerb * 0.5, HEAD + kerb * 0.5, PAD + PLAN - kerb * 0.5, HEAD + PLAN - kerb * 0.5, C.walk);

// the campus pad (54 x 58 around the block centre) and the buildings
cv.rect(X(bx - 27), Y(bz - 29), X(bx + 27), Y(bz + 29), C.pad);
const buildings = pinned.solids.filter(o => o.kind === 'building');
for (const b of buildings) {
  cv.rect(X(b.x - b.hx), Y(b.z - b.hz), X(b.x + b.hx), Y(b.z + b.hz), C.building);
}
for (const b of buildings) {
  cv.rect(X(b.x - b.hx), Y(b.z - b.hz), X(b.x + b.hx), Y(b.z - b.hz), C.buildingEdge);
  cv.rect(X(b.x - b.hx), Y(b.z + b.hz), X(b.x + b.hx), Y(b.z + b.hz), C.buildingEdge);
  cv.rect(X(b.x - b.hx), Y(b.z - b.hz), X(b.x - b.hx), Y(b.z + b.hz), C.buildingEdge);
  cv.rect(X(b.x + b.hx), Y(b.z - b.hz), X(b.x + b.hx), Y(b.z + b.hz), C.buildingEdge);
}
// rooftop helipad: platform drum, painted ring, the big H and the air ambulance standing on it (all read from
// the generated chunk, so the drawing follows the game whenever the pad moves)
const HXW = pinned.heli.padX, HZW = pinned.heli.padZ, PR = pinned.heli.padR;
cv.disc(X(HXW - 0), Y(HZW - 0.6), PR * S, [196, 200, 204]);
cv.disc(X(HXW), Y(HZW - 0.6), (PR - 0.3) * S, [92, 97, 103]);
cv.disc(X(HXW), Y(HZW - 0.6), 5.2 * S, [214, 218, 221]);
cv.disc(X(HXW), Y(HZW - 0.6), 4.8 * S, [92, 97, 103]);
drawText(cv, X(HXW) - 12, Y(HZW - 0.6) - 10, 'H', [240, 244, 247], 4);
if (pinned.heli) {
  const hx = X(pinned.heli.x), hz = Y(pinned.heli.z), rr = pinned.heli.rotorR * S;
  cv.rect(hx - rr, hz - 1.6, hx + rr, hz + 1.6, [40, 44, 50], 0.75);      // main rotor disc, seen edge-on
  cv.rect(hx - 1.6, hz - rr, hx + 1.6, hz + rr, [40, 44, 50], 0.75);
  cv.rect(X(pinned.heli.x - 1.15), Y(pinned.heli.z - 2.4), X(pinned.heli.x + 1.15), Y(pinned.heli.z + 3.0), [242, 245, 247]);
  cv.rect(X(pinned.heli.x - 1.15), Y(pinned.heli.z - 2.9), X(pinned.heli.x + 1.15), Y(pinned.heli.z + 3.5), C.stripe);
  cv.rect(X(pinned.heli.x - 0.25), Y(pinned.heli.z - 5.6), X(pinned.heli.x + 0.25), Y(pinned.heli.z - 2.4), [242, 245, 247]);
  cv.rect(X(pinned.heli.x - 1.1), Y(pinned.heli.z - 6.1), X(pinned.heli.x + 1.1), Y(pinned.heli.z - 5.0), [242, 245, 247]);
  cv.disc(X(HXW - 7.6), Y(HZW - 5.4), 0.5 * S, [239, 125, 26]);           // windsock
}
const markerWhere = `ROOFTOP HELIPAD - PAD R ${PR} M VS ROTOR ${pinned.heli.rotorR} M`;
drawText(cv, X(HXW) - 60, Y(HZW + PR + 2.2), markerWhere, C.ink);

// ambulance bays: red-marked, so the two or three units are obvious even when one is out on a call
for (const sl of pinned.ambulanceSlots || []) {
  cv.rect(X(sl.x - sl.hx), Y(sl.z - sl.hz), X(sl.x + sl.hx), Y(sl.z + sl.hz), [176, 66, 60], 0.55);
  if (!sl.car) {
    for (let t = 0; t < 1; t += 0.12) {                                   // empty bay: dashed outline
      const xa = X(sl.x - sl.hx) + (X(sl.x + sl.hx) - X(sl.x - sl.hx)) * t;
      const ya = Y(sl.z - sl.hz) + (Y(sl.z + sl.hz) - Y(sl.z - sl.hz)) * t;
      cv.rect(xa, Y(sl.z - sl.hz), xa + 2, Y(sl.z - sl.hz) + 2, [235, 235, 235]);
      cv.rect(xa, Y(sl.z + sl.hz), xa + 2, Y(sl.z + sl.hz) + 2, [235, 235, 235]);
      cv.rect(X(sl.x - sl.hx), ya, X(sl.x - sl.hx) + 2, ya + 2, [235, 235, 235]);
      cv.rect(X(sl.x + sl.hx), ya, X(sl.x + sl.hx) + 2, ya + 2, [235, 235, 235]);
    }
  }
}
// free bays and the cars standing in them
for (const b of pinned.parking) cv.rect(X(b.x - b.hx), Y(b.z - b.hz), X(b.x + b.hx), Y(b.z + b.hz), C.bayTaken);
for (const b of pinned.parking) {
  const dashed = (x0, y0, x1, y1) => { for (let t = 0; t < 1; t += 0.2) { const xa = x0 + (x1 - x0) * t, ya = y0 + (y1 - y0) * t; cv.rect(xa, ya, xa + 1.5, ya + 1.5, C.bay); } };
  dashed(X(b.x - b.hx), Y(b.z - b.hz), X(b.x + b.hx), Y(b.z - b.hz));
  dashed(X(b.x - b.hx), Y(b.z + b.hz), X(b.x + b.hx), Y(b.z + b.hz));
  dashed(X(b.x - b.hx), Y(b.z - b.hz), X(b.x - b.hx), Y(b.z + b.hz));
  dashed(X(b.x + b.hx), Y(b.z - b.hz), X(b.x + b.hx), Y(b.z + b.hz));
}
let ambulances = 0, cars = 0;
for (const s of pinned.solids) {
  if (!s.parked) continue;
  const isAmb = s.parked.kind === 'ambulance';
  if (isAmb) ambulances++; else cars++;
  const col = isAmb ? C.amb : [s.parked.color >> 16 & 255, s.parked.color >> 8 & 255, s.parked.color & 255];
  cv.rect(X(s.x - s.hx * 0.92), Y(s.z - s.hz * 0.92), X(s.x + s.hx * 0.92), Y(s.z + s.hz * 0.92), col);
  if (isAmb) {
    cv.rect(X(s.x - s.hx * 0.92), Y(s.z - 0.28), X(s.x + s.hx * 0.92), Y(s.z + 0.28), C.stripe);
    cv.rect(X(s.x - 0.3), Y(s.z - s.hz * 0.8), X(s.x + 0.3), Y(s.z + 0.8), C.stripe);
  }
}
// block label
drawText(cv, PAD + 2, 8, `HOSPITAL BLOCK (${pinned.cx},${pinned.cz})  ${pinned.parkingTotal} BAYS  ${ambulances} AMBULANCES  ${cars} CARS`, C.ink);

// occupancy table: the numbers the live parking system will produce during a day
const floor = pinned.parkingFloor, fixed = pinned.parkingFixed;
drawText(cv, PAD + 2, HEAD + PLAN + 6, `LIVE LOT OCCUPANCY  FLOOR ${floor} CARS  CEILING 20% OF ${pinned.parkingTotal} BAYS`, C.ink);
const times = [['00:00 NIGHT', 0.75], ['06:00 DAWN', 0.0], ['13:00 MIDDAY', 0.25], ['18:00 EVENING', 0.5]];
times.forEach(([label, ph], i) => {
  const n = lotCars(pinned.parkingTotal, fixed, ph, floor), amb = world.ambulanceTarget(ph), total = n + amb;
  const pct = (total / pinned.parkingTotal * 100).toFixed(0);
  drawText(cv, PAD + 2, HEAD + PLAN + 22 + i * 14, `${label}: ${n} CARS + ${amb} AMBULANCES = ${total} VEHICLES (${pct}%)`, C.ink);
});
drawText(cv, PAD + 2, HEAD + PLAN + 22 + 4 * 14, `AMBULANCES IN THE LOT: ${world.ambulanceTarget(0.75)} AT NIGHT, ${world.ambulanceTarget(0.25)} BY DAY (ONE ON A CALL) - NEVER OUTSIDE 2-3`, C.ink);
const out = path.join(here, 'plan-hospital.png');
fs.writeFileSync(out, writePNG(W, H, cv.buf));
console.log(`hospital block (${pinned.cx},${pinned.cz}): ${pinned.parkingTotal} bays, ${buildings.length} building volumes`);
console.log(`parked at generation time: ${ambulances} ambulances + ${cars} cars`);
for (const [label, ph] of times) console.log(`  ${label}: ${lotCars(pinned.parkingTotal, fixed, ph, floor)} cars + ${world.ambulanceTarget(ph)} ambulances`);
console.log(`wrote ${out} (${W}x${H})`);

// ---- front elevation of the same campus, straight from the builder -----------------------------------------
// Every part the builder emits is an axis-aligned box, so a painter's-algorithm orthographic view is enough
// to show what the building actually looks like from the car park: wings, glazing bands, the HOSPITAL board.
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
const R = world.buildHospitalMesh(bx, bz, Math.random);
const parts = collect(R.group);
collect(R.heliMain, R.heliMast[0], R.heliMast[1], R.heliMast[2], parts);
collect(R.heliTail, R.heliTailPos[0], R.heliTailPos[1], R.heliTailPos[2], parts);
// elevation window: auto-fit the campus footprint (parts are in block-local coordinates)
const E = { W: 420, H: 460 };
const minX = Math.min(...parts.map(p => p.x - p.w / 2)), maxX = Math.max(...parts.map(p => p.x + p.w / 2));
const maxY = Math.max(...parts.map(p => p.y + p.h / 2));
const ew = canvas(E.W, E.H, [214, 226, 238]);
const sx = (E.W - 40) / (maxX - minX), sy = Math.min((E.H - 60) / maxY, sx * 1.6);
const EX = x => 20 + (x - minX) * sx;
const EY = y => E.H - 24 - y * sy;
for (let i = 0; i < 6; i++) ew.rect(0, E.H * i / 6, E.W, E.H * (i + 1) / 6, [208 + i * 3, 222 + i * 2, 236 + i]);
ew.rect(0, E.H - 24, E.W, E.H, [110, 130, 96]);
for (const p of parts.slice().sort((a, b) => (a.z + a.d / 2) - (b.z + b.d / 2))) {
  const col = [(p.c >> 16) & 255, (p.c >> 8) & 255, p.c & 255];
  ew.rect(EX(p.x - p.w / 2), EY(p.y + p.h / 2), EX(p.x + p.w / 2), EY(p.y - p.h / 2), col);
}
drawText(ew, 6, 6, `HOSPITAL FRONT ELEVATION  ${(maxX - minX).toFixed(0)}M WIDE  ${maxY.toFixed(0)}M TALL`, [22, 26, 34]);
const outFront = path.join(here, 'plan-hospital-front.png');
fs.writeFileSync(outFront, writePNG(E.W, E.H, ew.buf));
console.log(`wrote ${outFront} (${E.W}x${E.H}) from ${parts.length} boxes`);
