/* Renders the filling station straight from the generator: a top-down plan of a block (forecourt, canopy,
   islands, dispensers, store, price pylon and the bays) and a front elevation built from the same parts
   buildFuelStationMesh() produces — the very data the renderer consumes.
   Run:  node tools/sidewalk-checks/plan-fuel.mjs   -> plan-fuel.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const here = path.dirname(url.fileURLToPath(import.meta.url));

let seed = 7;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// Flatten a station group into world-space boxes so the elevation can be drawn from the real parts.
function flatten(F) {
  const out = [];
  const walk = (o, rot, ox, oz) => {
    const r = rot + (o.rotation ? o.rotation.y : 0);
    if (o.isMesh && o.pos && o.geometry) out.push({ w: o.geometry.w, h: o.geometry.h, d: o.geometry.d, x: ox + o.pos[0], y: o.pos[1], z: oz + o.pos[2], rot: r, mat: o.material });
    for (const c of o.children || []) walk(c, r, ox, oz);
  };
  walk(F.group, 0, 0, 0);
  return out;
}
const stations = [0, 1, 2].map(() => {
  const F = world.buildFuelStationMesh(0, 0, rnd);
  return { F, parts: flatten(F) };
});

const COL_W = 480, H = 940, PAD = 18;
const cv = canvas(COL_W * stations.length, H, [24, 27, 32]);
const C = {
  ink: [238, 240, 244], dim: [148, 154, 164], pad: [116, 121, 129], padTop: [130, 135, 143],
  island: [168, 173, 180], column: [58, 62, 70], glass: [96, 158, 198], bay: [196, 200, 206],
  bayLine: [96, 101, 109], car: [86, 150, 216], carIn: [150, 196, 250], store: [152, 156, 162],
  lamp: [236, 236, 232], pylon: [255, 208, 86], canopyRoof: [232, 234, 232], lit: [255, 240, 200],
};

const M = { planTop: 78, planScale: 8.2, elevGround: 830, elevScale: 7.2 };
const bayList = F => {
  const c = F.canopy.z;
  return []
    .concat([-1, 1].flatMap(sx => [-1, 1].map(sz => ({ x: sx * 7.8, z: c + sz * 3.4, hx: 1.25, hz: 2.45 }))))
    .concat([-1, 1].flatMap(sx => [-2.5, 2.5].map(dz => ({ x: sx * 14.2, z: F.store.z + dz, hx: 1.25, hz: 2.45 }))))
    .concat([-18, -12, -6, 0, 6, 12, 18].map(dx => ({ x: dx, z: 21, hx: 2.45, hz: 1.25 })));
};

stations.forEach(({ F, parts }, si) => {
  const ox = si * COL_W, brand = F.brand, S = M.planScale, CX = ox + COL_W / 2, CZ = M.planTop + 24 * S;
  const PX = x => CX + x * S, PZ = z => CZ + z * S;

  drawText(cv, ox + PAD, 16, brand.name, C.ink, 2);
  drawText(cv, ox + PAD, 34, `FORECOURT PLAN - ${F.pumps.length} DISPENSERS, 15 BAYS`, C.dim);
  const box = (x0, z0, x1, z1, col) => cv.rect(PX(x0), PZ(z0), PX(x1), PZ(z1), col);

  box(-26, -24, 26, 24, C.pad);                       // the pad the block lays
  box(-25, -23, 25, 23, C.padTop);
  box(-F.canopy.w / 2, F.canopy.z - F.canopy.d / 2, F.canopy.w / 2, F.canopy.z + F.canopy.d / 2, [70, 76, 86]);   // canopy footprint
  for (const sx of [-1, 1]) box(sx * 4.8 - 1.25, F.canopy.z - 6.2, sx * 4.8 + 1.25, F.canopy.z + 6.2, C.island);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 10.6 - 0.45, F.canopy.z + sz * 6.4 - 0.45, sx * 10.6 + 0.45, F.canopy.z + sz * 6.4 + 0.45, C.column);
  box(F.store.x - F.store.w / 2, F.store.z - F.store.d / 2, F.store.x + F.store.w / 2, F.store.z + F.store.d / 2, C.store);
  box(F.store.x - F.store.w / 2 + 0.8, F.store.z + F.store.d / 2 - 0.25, F.store.x + F.store.w / 2 - 0.8, F.store.z + F.store.d / 2 + 0.25, C.glass);
  for (const l of F.lamps) box(l.x - 0.34, l.z - 0.34, l.x + 0.34, l.z + 0.34, C.lamp);
  box(F.pylon.x - 2.45, F.pylon.z - 0.22, F.pylon.x + 2.45, F.pylon.z + 0.22, C.pylon);
  const bays = bayList(F);
  bays.forEach((b, i) => {
    box(b.x - b.hx, b.z - b.hz, b.x + b.hx, b.z + b.hz, C.bayLine);
    box(b.x - b.hx + 0.15, b.z - b.hz + 0.15, b.x + b.hx - 0.15, b.z + b.hz - 0.15, C.bay);
    if (i < 2) { box(b.x - 0.95, b.z - 2.1, b.x + 0.95, b.z + 2.1, C.car); box(b.x - 0.6, b.z - 1.6, b.x + 0.6, b.z + 1.6, C.carIn); }
  });
  for (const p of F.pumps) {                          // the destructible dispensers, brightest on the plan
    box(p.x - 0.66, p.z - 0.52, p.x + 0.66, p.z + 0.52, [255, 96, 96]);
    box(p.x - 0.44, p.z - 0.3, p.x + 0.44, p.z + 0.3, [255, 238, 168]);
  }
  drawText(cv, ox + PAD, PZ(24) + 10, 'RED = A DISPENSER YOU CAN KNOCK OVER, BLUE = A CAR AT THE PUMPS', C.dim);
  drawText(cv, ox + PAD, PZ(24) + 24, `CANOPY ${F.canopy.w} x ${F.canopy.d} M AT ${F.canopy.h} M, UNDERSIDE LIT`, C.dim);

  // ---- front elevation: looking at the storefront from the street, drawn from the real parts ----
  const EY = M.elevGround, ES = M.elevScale, EX = x => CX + x * ES, EYY = y => EY - y * ES;
  drawText(cv, ox + PAD, EY - 8.2 * ES - 30, 'FRONT ELEVATION', C.dim);
  cv.rect(ox + PAD, EY, ox + COL_W - PAD, EY + 1, [90, 96, 106]);
  const rgb = c => c === undefined ? [128, 132, 138] : [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  // painter's order: the store wall first, then the fittings, the canopy columns, the pumps, and the roof last
  const layer = p => (p.y > F.canopy.h - 0.1 && p.y < F.canopy.h + 1.2 ? 5 : 0)      // roof slab + fascia
    + (Math.abs(p.z - F.canopy.z) < 0.3 || p.y > F.canopy.h + 1 ? 1 : 0)             // columns and roof plant
    + (p.y > 6.9 ? 2 : 0);                                                            // lamp heads on top
  const ordered = parts.slice().sort((a, b) => (layer(a) - layer(b)) || (a.z - b.z));
  for (const p of ordered) {
    if (Math.abs(p.x) > 22.5) continue;
    const sideways = Math.abs((((p.rot % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2) < 0.02;
    const across = sideways ? p.d : p.w;
    const y0 = Math.max(0, p.y - p.h / 2), y1 = p.y + p.h / 2;
    if (y1 <= 0) continue;
    let col = rgb(p.mat && p.mat.c);
    for (const ch2 of p.mat && p.mat.o ? Object.keys(p.mat.o) : []) { if (ch2 === 'color') col = rgb(p.mat.o.color); }
    cv.rect(EX(p.x - across / 2), EYY(y1), EX(p.x + across / 2), EYY(y0), col);
  }
  for (const p of F.pumps) {                                           // the real 2.42 m dispenser
    const x0 = p.x - 0.47, x1 = p.x + 0.47;
    cv.rect(EX(x0 - 0.1), EYY(0.26), EX(x1 + 0.1), EYY(0), C.column);                       // plinth
    cv.rect(EX(x0), EYY(1.92), EX(x1), EYY(0.31), [242, 243, 241]);                         // body
    cv.rect(EX(x0 - 0.02), EYY(2.34), EX(x1 + 0.02), EYY(2.06), brand.pump);                // cap
    cv.rect(EX(x0 - 0.06), EYY(2.42), EX(x1 + 0.06), EYY(2.3), brand.pump);                 // cap lip
    cv.rect(EX(p.x - 0.4), EYY(2.09), EX(p.x + 0.4), EYY(1.89), brand.glow);                // lit lightbox
    cv.rect(EX(p.x - 0.33), EYY(1.95), EX(p.x + 0.33), EYY(1.45), [57, 224, 140]);          // display
    cv.rect(EX(p.x - 0.36), EYY(1.42), EX(p.x + 0.36), EYY(1.06), [29, 32, 38]);            // price strips
    cv.rect(EX(p.x - 0.22), EYY(1.25), EX(p.x + 0.22), EYY(0.65), [29, 32, 38]);            // keypad
    cv.rect(EX(p.x - 0.63), EYY(1.42), EX(p.x - 0.45), EYY(1.1), brand.pump);               // nozzles
    cv.rect(EX(p.x + 0.45), EYY(1.42), EX(p.x + 0.63), EYY(1.1), brand.pump);
  }
  cv.rect(EX(-F.canopy.w / 2 + 0.7), EYY(F.canopy.h - 0.1), EX(F.canopy.w / 2 - 0.7), EYY(F.canopy.h - 0.24), C.lit);   // lit ceiling
  drawText(cv, ox + PAD, EY + 14, `2.4 M DISPENSERS, 4.8 M ISLANDS UNDER A ${F.canopy.h} M CANOPY`, C.dim);
});

fs.writeFileSync(path.join(here, 'plan-fuel.png'), writePNG(cv.w, cv.h, cv.buf));
fs.writeFileSync('/home/user/plan-fuel.png', writePNG(cv.w, cv.h, cv.buf));
console.log(`rendered ${stations.length} stations: ${stations.map(s => s.F.brand.name).join(', ')}`);
console.log(`pumps ${stations.map(s => s.F.pumps.length).join('/')}, solid parts ${stations.map(s => s.parts.length).join('/')}`);
