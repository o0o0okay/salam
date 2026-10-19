/* The ships of js/ships.js side by side, all to one scale: every type at the biggest it comes, seen from its port
   side (bow to the right), drawn from the game's own models; a car (4.5 m) and a block (80 m) beside them, and each
   one's length, beam, height over the water and speed.
   Run:  node tools/sidewalk-checks/plan-ships.mjs [out.png]   -> plan-ships.png (not committed) */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
import { canvas, writePNG, drawText } from './png.mjs';
const THREE = await import('three');
const S = await import('../../js/ships.js');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, 'plan-ships.png');
const K = 2.2;                                   // pixels a metre
const NAMES = { sailboat: 'sailing yacht', speedboat: 'speedboat', yacht: 'motor yacht', fishing: 'trawler', tug: 'tug',
  container: 'container ship', bulk: 'bulk carrier', tanker: 'oil tanker', lng: 'lng carrier', carCarrier: 'car carrier',
  cruise: 'cruise ship', ferry: 'ferry', cargo: 'general cargo', supply: 'offshore supply', frigate: 'frigate (navy)', carrier: 'aircraft carrier (navy)' };
const types = Object.entries(S.SHIP_TYPES);
const small = types.filter(([, T]) => T.band === 'small'), big = types.filter(([, T]) => T.band === 'big');
// each model, at its biggest, as triangles on its side: (z, y) on the page, x towards the viewer
const L1 = new THREE.Vector3(0.55, 0.75, 0.37).normalize(), col = new THREE.Color();
function model(key, T) {
  const len = T.L[1], B = T.beam(len), lane = S.LANES.find(l => l.types.includes(T));
  const a = { id: 0, type: key, T, lane: lane.index, L: len, B, vWant: T.speed[1], v: T.speed[1], s: 0, lat: 0, latBase: 0, latTarget: 0, yaw: 0, x: 0, z: 0, h: 0, seed: 20261019, mesh: null };
  const m = S.buildMesh(a), tris = [];
  let top = 0;
  for (const c of m.body.children) {
    if (c === m.glow) continue;
    const g = c.geometry, p = g.attributes.position, vc = g.attributes.color;
    for (let i = 0; i + 2 < p.count; i += 3) {
      const A = [p.getX(i), p.getY(i), p.getZ(i)], Bv = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], Cv = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
      const n = new THREE.Vector3().crossVectors(new THREE.Vector3(...Bv).sub(new THREE.Vector3(...A)), new THREE.Vector3(...Cv).sub(new THREE.Vector3(...A))).normalize();
      const lam = 0.55 + 0.45 * Math.abs(n.dot(L1));
      if (vc) col.setRGB(vc.getX(i), vc.getY(i), vc.getZ(i)); else col.setHex(0x6b7a8c);
      const hex = col.getHex();
      tris.push({ v: [A, Bv, Cv], rgb: [(hex >> 16 & 255) * lam, (hex >> 8 & 255) * lam, (hex & 255) * lam] });
      top = Math.max(top, A[1], Bv[1], Cv[1]);
    }
  }
  S.dropMesh(a);
  return { key, T, len, B, top, tris };
}
const models = new Map(types.map(([k, T]) => [k, model(k, T)]));

// the page: small craft on the first row, then the ships two a row
const PAD = 26, ROWH = Math.ceil(66 * K) + 80, COLW = Math.ceil(340 * K) + 40;
const rows = [small.map(([k]) => k)];
for (let i = 0; i < big.length; i += 2) rows.push(big.slice(i, i + 2).map(([k]) => k));
const W = PAD * 2 + COLW * 2, H = 90 + rows.length * ROWH + PAD;
const cv = canvas(W, H, [232, 238, 243]);
const zb = new Float64Array(W * H).fill(-Infinity);
drawText(cv, PAD, 18, 'the ships of js/ships.js, all to one scale (' + K + ' px a metre), at the biggest each type comes', [30, 36, 44], 3);
// legend: a car and a block
const legY = 56;
cv.rect(PAD, legY, PAD + 4.5 * K, legY + 1.45 * K, [200, 40, 40]);
drawText(cv, PAD + 4.5 * K + 8, legY - 2, 'a car, 4.5 m', [30, 36, 44], 2);
cv.rect(PAD + 200, legY + 2, PAD + 200 + 80 * K, legY + 4, [30, 36, 44]);
for (const x of [PAD + 200, PAD + 200 + 80 * K]) cv.rect(x, legY - 2, x + 1, legY + 8, [30, 36, 44]);
drawText(cv, PAD + 200 + 80 * K + 10, legY - 2, 'a block, 80 m', [30, 36, 44], 2);
function draw(md, x0, wl) {
  // the sea under the waterline, the hull out of it; the model's bow to the right (+z), its port side towards us (+x)
  cv.rect(x0 - 6, wl, x0 + md.len * K + 6, wl + 8, [120, 170, 200]);
  const X = z => x0 + (z + md.len / 2) * K, Y = y => wl - y * K;
  for (const t of md.tris) {
    const P = t.v.map(v => [X(v[2]), Y(v[1]), v[0]]);
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxY = Math.min(Math.floor(wl), Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((px - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (py - P[0][1])) / area;
      const w2 = ((P[1][0] - P[0][0]) * (py - P[0][1]) - (px - P[0][0]) * (P[1][1] - P[0][1])) / area;
      if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
      const d = P[0][2] + (P[1][2] - P[0][2]) * w1 + (P[2][2] - P[0][2]) * w2, i = y * W + x;
      if (d <= zb[i]) continue;
      zb[i] = d; cv.buf[i * 3] = Math.min(255, t.rgb[0]); cv.buf[i * 3 + 1] = Math.min(255, t.rgb[1]); cv.buf[i * 3 + 2] = Math.min(255, t.rgb[2]);
    }
  }
  const kn = md.T.speed.map(v => Math.round(v / S.KNOT));
  drawText(cv, x0, wl + 16, `${NAMES[md.key] || md.key}: ${md.len.toFixed(0)} x ${md.B.toFixed(1)} m`, [30, 36, 44], 2);
  drawText(cv, x0, wl + 30, `${md.top.toFixed(0)} m high, ${kn[0]}-${kn[1]} kn`, [30, 36, 44], 2);
  drawText(cv, x0, wl + 44, `comes ${md.T.L[0]}-${md.T.L[1]} m long (${(md.len / 4.5).toFixed(0)} cars)`, [90, 98, 108], 2);
}
rows.forEach((row, r) => {
  const wl = 90 + r * ROWH + Math.ceil(64 * K);
  if (r === 0) {   // the small craft, one after another
    let x = PAD;
    for (const k of row) { const md = models.get(k); draw(md, x, wl); x += Math.max(md.len * K, 250) + 40; }
  } else row.forEach((k, c) => draw(models.get(k), PAD + c * COLW, wl));
});
fs.writeFileSync(out, writePNG(W, H, cv.buf));
console.log('wrote ' + out);
