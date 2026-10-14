/* Renders the mall carpark at four times of day, using the very same occupancy rule the game applies
   (js/traffic.js + the generator in js/world.js): a 2-3 car night floor, a 20% cap, peak at midday.
   Run:  node tools/sidewalk-checks/plan-parking.mjs   -> plan-parking.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const { chunks, updateChunks, CHUNK } = world;
const here = path.dirname(url.fileURLToPath(import.meta.url));

const FLOOR = 2, CAP = 0.2;
const curve = phase => {
  const hour = (phase * 24 + 6 + 24) % 24;
  const t = Math.max(0, 1 - Math.abs(hour - 13) / 11);
  return t * t;
};
const occupancy = (bays, phase) => {
  const max = Math.max(FLOOR, Math.floor(CAP * bays));
  return Math.min(max, FLOOR + Math.round(curve(phase) * (max - FLOOR)));
};

// find a mall block (the generator leaves parkingTotal on shopping-centre chunks)
updateChunks(0, 0, 999);
const mall = [...chunks.values()].find(ch => ch.parkingTotal);
if (!mall) { console.log('no mall block in the sample'); process.exit(1); }
const bx = mall.cx * CHUNK + 40, bz = mall.cz * CHUNK + 40;

// rebuild the bay layout exactly as world.js lays it out
const stallCount = 6, stallW = 8.8, startX = bx - (stallCount * stallW) / 2;
const rows = [{ z: bz + 15.2, rotY: Math.PI }, { z: bz + 24.2, rotY: 0 }, { z: bz - 24.3, rotY: 0 }];
const bays = [];
for (let r = 0; r < rows.length; r++) for (let i = 0; i < stallCount; i++) bays.push({ x: startX + (i + 0.5) * stallW, z: rows[r].z, mid: Math.abs(i - (stallCount - 1) / 2) });
const west = [0, 1, 2].map(i => ({ x: bx - 23.5, z: bz - 16 + (i + 0.5) * 8, mid: i }));
const allBays = bays.concat(west);

const PHASES = [
  { phase: 0.75, label: '00:00  NIGHT' },
  { phase: 0.15, label: '09:36  MORNING' },
  { phase: 0.29, label: '13:00  MIDDAY' },
  { phase: 0.46, label: '17:00  EVENING' },
];

const CELL_W = 300, CELL_H = 220, PAD = 10, HEAD = 22;
const W = CELL_W + PAD * 2, H = (CELL_H + HEAD) * PHASES.length + PAD * 2;
const cv = canvas(W, H, [236, 238, 241]);
const C = {
  lot: [96, 100, 108], paint: [233, 232, 223], mall: [226, 229, 231], roof: [180, 186, 189],
  car: [[227, 74, 74], [58, 123, 213], [57, 179, 107], [242, 169, 59], [238, 238, 238], [142, 91, 217], [47, 51, 64]],
  tex: [40, 44, 52], night: [18, 24, 40], day: [200, 214, 235],
};
const SPAN_X = 62, SPAN_Z = 44;                       // metres of lot drawn per panel
const S = Math.min((CELL_W - 20) / SPAN_X, (CELL_H - 20) / SPAN_Z);

PHASES.forEach((slot, p) => {
  const oy = PAD + p * (CELL_H + HEAD);
  // panel chrome: darker at night, brighter by day
  const night = curve(slot.phase) < 0.35;
  cv.rect(PAD, oy + HEAD, PAD + CELL_W, oy + HEAD + CELL_H, night ? C.night : C.lot);
  const X = x => PAD + 10 + (x - (bx - SPAN_X / 2)) * S;
  const Y = z => oy + HEAD + 10 + (z - (bz - SPAN_Z / 2)) * S;
  // lot surface, stall lines, mall footprint
  cv.rect(X(bx - 29), Y(bz - 29), X(bx + 29), Y(bz + 29), [74, 80, 92]);
  for (const r of rows) {
    for (let i = 0; i <= stallCount; i++) cv.rect(X(startX + i * stallW) - 0.5, Y(r.z - 3.1), X(startX + i * stallW) + 0.5, Y(r.z + 3.1), C.paint, night ? 0.5 : 0.85);
  }
  for (let i = 0; i <= 3; i++) cv.rect(X(bx - 26.4) - 0.5, Y(bz - 16 + i * 8) - 0.5, X(bx - 20.6) + 0.5, Y(bz - 16 + i * 8) + 0.5, C.paint, night ? 0.5 : 0.85);
  cv.rect(X(bx - 14.5), Y(bz - 18), X(bx + 14.5), Y(bz + 4), C.mall);
  cv.rect(X(bx + 14.2), Y(bz - 10), X(bx + 24.8), Y(bz + 10.5), C.roof);
  // cars: the number comes from the shared occupancy rule; at night they keep the stalls nearest the entrance
  const n = occupancy(mall.parkingTotal, slot.phase);
  const pool = allBays.slice();
  // at night the cars that stay are the ones nearest the mall entrance (centre bays of the middle row)
  const entrance = b => Math.abs(b.x - bx) + Math.abs(b.z - (bz + 15.2)) * 0.4;
  if (n <= 4) pool.sort((a, b) => entrance(a) - entrance(b));
  const chosen = [];
  for (let k = 0; k < n && pool.length; k++) {
    const idx = n <= 4 ? 0 : Math.floor((k + 0.5) * pool.length / n);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  chosen.forEach((b, i) => {
    const c = C.car[i % C.car.length];
    const w = 2.1 * S / 2, l = 4.4 * S / 2;
    cv.rect(X(b.x) - w, Y(b.z) - l, X(b.x) + w, Y(b.z) + l, c);
    cv.rect(X(b.x) - w * 0.7, Y(b.z) - l * 0.62, X(b.x) + w * 0.7, Y(b.z) + l * 0.62, C.tex, 0.55);   // glazing
  });
  // label
  drawText(cv, PAD + 4, oy + 7, `${slot.label} - ${n} OF ${mall.parkingTotal} BAYS (${(n / mall.parkingTotal * 100).toFixed(0)}%)`, [26, 30, 38]);
});
const out = path.join(here, 'plan-parking.png');
fs.writeFileSync(out, writePNG(W, H, cv.buf));
console.log(`mall block (${mall.cx},${mall.cz}): ${mall.parkingTotal} bays`);
for (const s of PHASES) console.log(`  ${s.label}: ${occupancy(mall.parkingTotal, s.phase)} cars`);
console.log(`wrote ${out} (${W}x${H})`);
