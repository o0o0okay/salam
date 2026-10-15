/* Renders plan views of the generated sidewalk geometry straight from js/world.js (no browser):
     tools/sidewalk-checks/plan-styles.png  — one block per paving style + a close-up of the verge sidewalk
   Run:  node tools/sidewalk-checks/plan.mjs */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas } from './png.mjs';

const world = await import(modulePath);
const { chunks, updateChunks, swCapture, CHUNK, PAVE_IN, PAVE_OUT, BORDER_W, BED, BED_EDGE, SLAB } = world;
const here = path.dirname(url.fileURLToPath(import.meta.url));
const HALF = 40;

// ---- find one representative block for every style ----
updateChunks(0, 0, 999);
const found = new Map();
for (const [x, z] of [[80, 0], [0, 80], [-80, -80], [160, -160], [400, 240], [-320, 640], [400, 400], [-160, 320]]) {
  updateChunks(x, z, 999);
  for (const ch of chunks.values()) {
    const sw = swCapture.get(ch);
    if (sw && !found.has(sw.style)) found.set(sw.style, { ch, sw });
    if (found.size === 4) break;
  }
  if (found.size === 4) break;
}

const PAVE = { slab: [176, 170, 156], panel: [158, 162, 165], brick: [162, 84, 58], verge: [163, 167, 170] };
const C = {
  asphalt: [59, 63, 74], lot: [96, 100, 108], brickLot: [151, 148, 141], grass: [93, 154, 69],
  border: [194, 197, 201], kerb: [200, 203, 207], kerbPaint: [214, 191, 76], inner: [183, 187, 192],
  soil: [74, 58, 41], edge: [190, 194, 199], building: [154, 163, 173], tree: [63, 158, 72], treeAlt: [46, 139, 87],
  hedge: [63, 138, 60], mailbox: [47, 63, 107], meter: [154, 160, 166], sandwich: [244, 241, 230],
  prop: [255, 122, 26], light: [120, 200, 255], hydrant: [229, 57, 53], trash: [75, 86, 96], joint: [110, 106, 94],
};
const isZ = m => m.d > m.w;                       // a strip running along z has its radial extent on x

function drawBlock(cv, ch, sw, ox, oy, S) {
  const bx = ch.cx * CHUNK + HALF, bz = ch.cz * CHUNK + HALF;
  const X = x => ox + (x - (bx - HALF)) * S, Y = z => oy + (z - (bz - HALF)) * S;
  const rect = (m, col, a = 1) => cv.rect(X(m.x - m.w / 2), Y(m.z - m.d / 2), X(m.x + m.w / 2), Y(m.z + m.d / 2), col, a);
  // ground + roads around the block
  cv.rect(X(bx - HALF), Y(bz - HALF), X(bx + HALF), Y(bz + HALF), C.lot);
  const ROAD = 8;                                          // half the 16 m street, drawn outwards from the kerb line
  cv.rect(X(bx - HALF - ROAD), Y(bz - HALF), X(bx - HALF), Y(bz + HALF), C.asphalt);
  cv.rect(X(bx + HALF), Y(bz - HALF), X(bx + HALF + ROAD), Y(bz + HALF), C.asphalt);
  cv.rect(X(bx - HALF), Y(bz - HALF - ROAD), X(bx + HALF), Y(bz - HALF), C.asphalt);
  cv.rect(X(bx - HALF), Y(bz + HALF), X(bx + HALF), Y(bz + HALF + ROAD), C.asphalt);
  // paving + verge
  for (const m of sw.walk) rect(m, PAVE[sw.style]);
  for (const m of sw.grass) rect(m, C.grass);
  // slab joints, spaced by the tile the style actually uses
  if (sw.style !== 'verge') {
    const tile = sw.st.tile, cols = sw.style === 'panel' ? 3 : sw.style === 'brick' ? 4 : 8;
    const step = tile / cols;
    for (const m of sw.walk) {
      const x0 = m.x - m.w / 2, x1 = m.x + m.w / 2, z0 = m.z - m.d / 2, z1 = m.z + m.d / 2;
      if (isZ(m)) { for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) cv.vline(X(x), Y(z0), Y(z1), C.joint, sw.style === 'brick' ? 0.35 : 0.55); }
      else { for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) cv.hline(X(x0), X(x1), Y(z), C.joint, sw.style === 'brick' ? 0.35 : 0.55); }
    }
  }
  for (const m of sw.border) rect(m, C.border);
  for (const m of sw.kerb) rect(m, C.inner);
  for (const m of sw.curb) rect(m, C.kerb);
  for (const m of sw.bedEdge) rect(m, C.edge);
  for (const m of sw.bed) rect(m, C.soil);
  // buildings (translucent) + props + trees
  for (const s of ch.solids) {
    if (s.kind === 'tree' || s.hx <= 0) continue;
    cv.rect(X(s.x - s.hx), Y(s.z - s.hz), X(s.x + s.hx), Y(s.z + s.hz), C.building, 0.55);
  }
  for (const p of ch.props) {
    if (p.kind === 'hedge') { cv.rect(X(p.x - 1.35), Y(p.z - 0.5), X(p.x + 1.35), Y(p.z + 0.5), C.hedge, 0.9); continue; }
    const col = p.kind === 'mailbox' ? C.mailbox : p.kind === 'meter' ? C.meter : p.kind === 'sandwich' ? C.sandwich
      : p.kind === 'streetlight' ? C.light : p.kind === 'hydrant' ? C.hydrant : p.kind.startsWith('trash') ? C.trash : C.prop;
    cv.disc(X(p.x), Y(p.z), Math.max(1.4, S * 0.55), col);
  }
  for (const t of ch.trees) cv.disc(X(t.x), Y(t.z), Math.max(1.6, S * 1.5), t.v >= 4 ? C.treeAlt : C.tree);
  cv.rect(X(bx - HALF), Y(bz - HALF), X(bx + HALF), Y(bz + HALF), [255, 255, 255], 0);
}

// ---- close-up of a verge sidewalk: road -> kerb -> grass -> walkway ----
function drawCloseup(cv, ch, sw, ox, oy, S, z0 = 22, z1 = 52) {
  const bz = ch.cz * CHUNK + HALF, bx = ch.cx * CHUNK + HALF;
  // always use the west strip: x from bx-HALF (road centre) outwards, z window
  const X = x => ox + (x - (bx - HALF)) * S, Y = z => oy + (z - z0) * S;
  const rect = (m, col) => cv.rect(Math.max(X(m.x - m.w / 2), X(bx - HALF)), Y(m.z - m.d / 2), Math.min(X(m.x + m.w / 2), X(bx - HALF + 14)), Y(m.z + m.d / 2), col);
  cv.rect(X(bx - HALF), Y(z0), X(bx - HALF + 6), Y(z1), C.asphalt);
  cv.rect(X(bx - HALF + 6), Y(z0), X(bx - HALF + 14), Y(z1), C.lot);
  for (const m of sw.walk) if (!isZ(m)) continue; else rect(m, PAVE[sw.style]);
  for (const m of sw.grass) if (isZ(m)) rect(m, C.grass);
  for (const m of sw.curb) if (isZ(m)) rect(m, C.kerb);            // painted or not is a per-chunk choice
  for (const m of sw.bedEdge) if (isZ(m)) rect(m, C.edge);
  for (const m of sw.bed) if (Math.abs(m.x - (bx - HALF)) < 14) rect(m, C.soil);
  for (const t of ch.trees) if (t.x < bx - HALF + 14 && t.z > z0 && t.z < z1) cv.disc(X(t.x), Y(t.z), 3.4 * S / 2, t.v >= 4 ? C.treeAlt : C.tree);
  for (const p of ch.props) if (p.x < bx - HALF + 14 && p.z > z0 && p.z < z1) {
    const col = p.kind === 'mailbox' ? C.mailbox : p.kind === 'meter' ? C.meter : p.kind === 'sandwich' ? C.sandwich
      : p.kind === 'streetlight' ? C.light : p.kind === 'hydrant' ? C.hydrant : p.kind.startsWith('trash') ? C.trash : C.prop;
    cv.disc(X(p.x), Y(p.z), 2.6, col);
  }
  // half-metre scale bar
  cv.rect(X(bx - HALF), Y(z1) + 4, X(bx - HALF + 1), Y(z1) + 8, [40, 40, 40]);
}

// ---- compose the sheet: 3 block plans + verge plan + verge close-up ----
const S = 4, CELL = 80 * S + 26, W = CELL * 2 + 12, H = CELL * 2 + 12;
const cv = canvas(W, H, [236, 238, 241]);
const order = ['brick', 'panel', 'slab', 'verge'];
const pos = [[6, 6], [CELL + 6, 6], [6, CELL + 6], [CELL + 6, CELL + 6]];
order.forEach((style, i) => {
  const hit = found.get(style);
  if (!hit) { console.log(`!! style '${style}' not found in the sampled lattice`); return; }
  const [ox, oy] = pos[i];
  if (i < 3) drawBlock(cv, hit.ch, hit.sw, ox + 13, oy + 13, S);
  else { drawBlock(cv, hit.ch, hit.sw, ox + 13, oy + 13, S); }
});
// close-up panel: reuse the verge block, drawn over the bottom-right cell
const verge = found.get('verge');
if (verge) {
  const [ox, oy] = pos[3];
  const S2 = (CELL - 26) / 14;
  drawCloseup(cv, verge.ch, verge.sw, ox + 13, oy + 13, S2, 24, 24 + (CELL - 26) / S2);
}
const out = path.join(here, 'plan-styles.png');
fs.writeFileSync(out, writePNG(W, H, cv.buf));
console.log(`styles found: ${[...found.keys()].join(', ')}`);
console.log(`wrote ${out}  (${W}x${H})`);

// ---- extra: dedicated close-up sheet for the verge sidewalk, rendered large ----
{
  const hit = found.get('verge');
  if (hit) {
    const { ch, sw } = hit;
    const bx = ch.cx * CHUNK + HALF, bz = ch.cz * CHUNK + HALF;
    const zc = bz, S3 = 26, W3 = Math.round(14 * S3) + 20, H3 = Math.round(26 * S3) + 20;
    const cv3 = canvas(W3, H3, [236, 238, 241]);
    const z0 = zc - 13, z1 = zc + 13;
    const X = x => 10 + (x - (bx - HALF)) * S3, Y = z => 10 + (z - z0) * S3;
    const band = (m, col, a = 1) => {
      const x0 = Math.max(X(m.x - m.w / 2), X(bx - HALF));
      const x1 = Math.min(X(m.x + m.w / 2), X(bx - HALF + 14));
      if (x1 <= x0) return;
      cv3.rect(x0, Y(z0), x1, Y(z1), col, a);
    };
    cv3.rect(X(bx - HALF), Y(z0), X(bx - HALF + 6), Y(z1), C.asphalt);            // road
    cv3.rect(X(bx - HALF + 6), Y(z0), X(bx - HALF + 14), Y(z1), [120, 150, 110]); // yard behind
    for (const m of sw.walk) if (isZ(m) && m.x < bx) band(m, PAVE[sw.style]);
    for (const m of sw.grass) if (isZ(m)) band(m, C.grass);
    for (const m of sw.curb) if (isZ(m)) band(m, C.kerb);
    for (const m of sw.bedEdge) if (isZ(m)) band(m, C.edge);
    for (const m of sw.bed) if (isZ(m)) band(m, C.soil);
    for (const t of ch.trees) if (Math.abs(t.x - bx) < 14 && Math.abs(t.z - zc) < 12) cv3.disc(X(t.x), Y(t.z), 1.7 * S3, t.v >= 4 ? C.treeAlt : C.tree);
    for (const p of ch.props) if (Math.abs(p.x - bx) < 14 && Math.abs(p.z - zc) < 12) {
      const col = p.kind === 'mailbox' ? C.mailbox : p.kind === 'meter' ? C.meter : p.kind === 'sandwich' ? C.sandwich : C.prop;
      cv3.disc(X(p.x), Y(p.z), 0.55 * S3, col);
    }
    const p4 = path.join(here, 'plan-verge-closeup.png');
    fs.writeFileSync(p4, writePNG(W3, H3, cv3.buf));
    console.log(`wrote ${p4}  (${W3}x${H3}, ${S3} px/m)`);
    // report the measured band edges so the numbers can be eyeballed against the image
    const rows = [];
    for (const m of sw.curb) if (isZ(m)) rows.push(['kerb', (bx - HALF) - (m.x - m.w / 2) - (bx - HALF), (bx - HALF) - (m.x + m.w / 2)]);
    for (const m of sw.grass) if (isZ(m)) rows.push(['grass', (bx - HALF) - (m.x - m.w / 2), (bx - HALF) - (m.x + m.w / 2)]);
    for (const m of sw.walk) if (isZ(m) && m.x < bx) rows.push(['walk', (bx - HALF) - (m.x - m.w / 2), (bx - HALF) - (m.x + m.w / 2)]);
    console.log('distances from the road centre line (m):');
    for (const [n, a, b] of rows) console.log(`   ${n.padEnd(6)} ${Math.min(a, b).toFixed(2)} .. ${Math.max(a, b).toFixed(2)}`);
  }
}
