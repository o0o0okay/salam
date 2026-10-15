/* Renders a top-down view of one intersection straight from the generated geometry, with the legal asphalt
   edge (PAVE_IN from each road centre line) drawn in red. Nothing paved may cross those red lines.
   Run:  node tools/sidewalk-checks/plan-intersection.mjs */
import { modulePath } from './harness.mjs';
import { writePNG, canvas } from './png.mjs';
import fs from 'fs';
import path from 'path';
import url from 'url';
const here = path.dirname(url.fileURLToPath(import.meta.url));
const w = await import(modulePath);
const { chunks, updateChunks, swCapture, CHUNK, PAVE_IN, PAVE_OUT, WALK_Y, BORDER_W, BED, PIT_IN } = w;
// render the intersection where four blocks meet: the corner of chunks (-1,-1), (0,-1), (-1,0), (0,0)
updateChunks(0, 0, 999);
const S = 9, PAD = 10, SPAN = 46;              // 46 m across, centred on the intersection at world (0,0)
const W = Math.round(SPAN * S) + PAD * 2, H = W;
const cv = canvas(W, H, [238, 240, 243]);
const X = x => PAD + (x + SPAN / 2) * S, Y = z => PAD + (z + SPAN / 2) * S;
const PAVE = { slab: [176, 170, 156], panel: [158, 162, 165], brick: [162, 84, 58], verge: [163, 167, 170] };
const C = { asphalt: [59, 63, 74], lot: [96, 100, 108], border: [194, 197, 201], kerb: [205, 208, 212],
  kerbPaint: [214, 191, 76], inner: [183, 187, 192], grass: [93, 154, 69], soil: [74, 58, 41], edge: [190, 194, 199],
  building: [154, 163, 173], tree: [63, 158, 72], treeAlt: [46, 139, 87], line: [255, 207, 46] };
cv.rect(0, 0, W, H, C.asphalt);
cv.rect(X(-SPAN/2), Y(-SPAN/2), X(SPAN/2), Y(SPAN/2), C.lot);
const isZ = m => m.d > m.w;
for (const ch of chunks.values()) {
  if (Math.abs(ch.cx) > 1 || Math.abs(ch.cz) > 1) continue;
  const sw = swCapture.get(ch);
  const put = (m, col) => {
    const x0 = m.x - m.w/2, x1 = m.x + m.w/2, z0 = m.z - m.d/2, z1 = m.z + m.d/2;
    cv.rect(Math.max(X(x0), X(-SPAN/2)), Math.max(Y(z0), Y(-SPAN/2)), Math.min(X(x1), X(SPAN/2)), Math.min(Y(z1), Y(SPAN/2)), col);
  };
  for (const m of sw.walk) put(m, PAVE[sw.style]);
  for (const m of sw.grass) put(m, C.grass);
  for (const m of sw.border) put(m, C.border);
  for (const m of sw.kerb) put(m, C.inner);
  for (const m of sw.curb) put(m, C.kerb);
  for (const m of sw.bedEdge) put(m, C.edge);
  for (const m of sw.bed) put(m, C.soil);
  const bx = ch.cx*CHUNK+40, bz = ch.cz*CHUNK+40;
  for (const s of ch.solids) { if (s.kind==='tree'||s.hx<=0) continue;
    cv.rect(X(s.x-s.hx), Y(s.z-s.hz), X(s.x+s.hx), Y(s.z+s.hz), C.building, 0.5); }
  for (const t of ch.trees) cv.disc(X(t.x), Y(t.z), Math.max(2, 1.5*S), t.v>=4?C.treeAlt:C.tree);
}
// road centre lines (real road edges, for reference): at x=0 and z=0
cv.rect(X(-SPAN/2), Y(-0.15), X(SPAN/2), Y(0.15), [255,255,255], 0.35);
cv.rect(X(-0.15), Y(-SPAN/2), X(0.15), Y(SPAN/2), [255,255,255], 0.35);
// mark the legal asphalt edge at +-8 m
for (const s of [-1, 1]) {
  cv.rect(X(s*PAVE_IN-0.08), Y(-SPAN/2), X(s*PAVE_IN+0.08), Y(SPAN/2), [255, 90, 90], 0.5);
  cv.rect(X(-SPAN/2), Y(s*PAVE_IN-0.08), X(SPAN/2), Y(s*PAVE_IN+0.08), [255, 90, 90], 0.5);
}
const out = path.join(here, 'plan-intersection.png');
fs.writeFileSync(out, writePNG(W, H, cv.buf));
console.log(`wrote ${out} (${W}x${H}, ${S} px/m) — red lines = 8 m road edge (nothing paved may cross them)`);
