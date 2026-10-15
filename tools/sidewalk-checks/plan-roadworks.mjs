/* Renders one road-resurfacing site straight from the generator: the closed lane in plan, the tarmac slabs the
   generator actually laid (their own colours and seams), the cones / barriers / drums / warning sign around
   them, the profile of the repair against the asphalt, and the palette this pass replaced.
   Run:  node tools/sidewalk-checks/plan-roadworks.mjs   -> plan-roadworks.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const here = path.dirname(url.fileURLToPath(import.meta.url));

for (const [x, z] of [[0, 0], [80, 0], [0, 80], [-80, -80], [160, -160]]) world.updateChunks(x, z, 999);
const sites = [];
for (const ch of world.chunks.values()) for (const s of ch.roadworks || []) sites.push({ ch, ...s });
sites.sort((a, b) => (b.vert - a.vert) * 10 + (b.slabs.length - a.slabs.length));
const site = sites[0];
if (!site) throw new Error('plan-roadworks: no resurfacing site in the sample district');

const W = 1180, H = 820;
const cv = canvas(W, H, [22, 24, 28]);
const C = {
  ink: [236, 240, 246], dim: [146, 154, 166], road: [59, 63, 74], kerb: [150, 156, 166],
  walk: [186, 182, 172], paintY: [255, 207, 46], paintW: [238, 238, 232], orange: [255, 176, 66],
  cone: [255, 122, 26], white: [242, 242, 242], crate: [185, 138, 85], sign: [255, 154, 26],
  steel: [154, 160, 168], barrel: [214, 69, 69], dirt: [138, 106, 66],
};
const rgb = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const lum = c => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);

// ---- plan geometry: the street runs left-to-right, the lateral axis runs up the sheet ----
const S = 13, CX = 330, CY = 424;
const PXA = (along, lat) => CX + (along - (site.vert ? site.z : site.x)) * S;
const PYL = (along, lat) => CY - (lat - (site.vert ? site.x : site.z)) * S;
const PX = (x, z) => site.vert ? PXA(z, x) : PXA(x, z);
const PY = (x, z) => site.vert ? PYL(z, x) : PYL(x, z);
const at = (lat, alongLen) => site.vert ? [lat, alongLen] : [alongLen, lat];      // (x, z) from (lat, along)
const rect = (latA, latB, aA, aB, col, alpha = 1) => {
  const [x0, z0] = at(latA, aA), [x1, z1] = at(latB, aB);
  cv.rect(PX(x0, z0), PY(x0, z0), PX(x1, z1), PY(x1, z1), col, alpha);
};
const mid = site.vert ? site.x : site.z;             // the road centre line (a block boundary)
const A0 = site.vert ? site.z : site.x;              // along the street: the site centre
const HALF = 30;                                     // how much street to draw each way

drawText(cv, 24, 18, 'ROAD RESURFACING - WHAT THE CLOSED LANE IS MADE OF', C.ink, 3);
drawText(cv, 24, 44, `ONE SITE FROM THE GENERATOR: ${['CONE TAPER', 'BARRIER CORRIDOR', 'DIG SITE', 'EQUIPMENT YARD'][site.style]} STYLE, ${site.slabs.length} SLABS OVER ${(site.len + 2).toFixed(0)} M`, C.dim, 1);

rect(mid - 12.6, mid + 12.6, A0 - HALF, A0 + HALF, C.walk);                   // pavements either side
rect(mid - 8.5, mid + 8.5, A0 - HALF, A0 + HALF, C.kerb);                     // kerb stones
rect(mid - 8, mid + 8, A0 - HALF, A0 + HALF, C.road);                         // the asphalt, 16 m kerb to kerb
for (let a = -HALF; a < HALF; a += 5) rect(mid - 0.09, mid + 0.09, A0 + a, A0 + a + 2.4, C.paintY, 0.85);
for (const s of [-1, 1]) for (let a = -HALF; a < HALF; a += 5) rect(mid + s * 3.95 - 0.07, mid + s * 3.95 + 0.07, A0 + a, A0 + a + 2.0, C.paintW, 0.45);

// the slabs the generator actually laid, with their seams
for (const sl of site.slabs) {
  const aC = site.vert ? sl.z : sl.x, lC = site.vert ? sl.x : sl.z;
  const aH = (site.vert ? sl.d : sl.w) / 2, lH = (site.vert ? sl.w : sl.d) / 2;
  rect(lC - lH, lC + lH, aC - aH, aC + aH, rgb(sl.col));
  rect(lC - lH, lC - lH + 0.12, aC - aH, aC + aH, [88, 94, 104]);             // seam
  rect(lC + lH - 0.12, lC + lH, aC - aH, aC + aH, [88, 94, 104]);
  rect(lC - lH, lC + lH, aC - aH, aC - aH + 0.12, [88, 94, 104]);
  rect(lC - lH, lC + lH, aC + aH - 0.12, aC + aH, [88, 94, 104]);
}

// the old single slab, as a dashed outline over the top (it used to be one filled warm-grey rectangle)
const oldLat = 1.6, oldA = site.len / 2 + 1;
for (let a = -oldA; a <= oldA; a += 0.8) {
  rect(mid - oldLat - 0.12, mid - oldLat + 0.12, A0 + a, A0 + a + 0.45, C.orange, 0.95);
  rect(mid + oldLat - 0.12, mid + oldLat + 0.12, A0 + a, A0 + a + 0.45, C.orange, 0.95);
}
for (let l = -oldLat; l <= oldLat; l += 0.8) {
  rect(mid + l, mid + l + 0.25, A0 - oldA - 0.12, A0 - oldA + 0.12, C.orange, 0.95);
  rect(mid + l, mid + l + 0.25, A0 + oldA - 0.12, A0 + oldA + 0.12, C.orange, 0.95);
}

// the works kit: only the pieces that belong to the site, and only the ones on the closed lane
const KIT = new Set(['cone', 'barrier', 'drum', 'crate', 'barrel', 'sign', 'dirtpile', 'pipe']);
for (const pr of site.ch.props) {
  if (!KIT.has(pr.kind)) continue;
  const lat = site.vert ? pr.x : pr.z;
  if (Math.abs(pr.x - site.x) > site.len + 16 || Math.abs(pr.z - site.z) > site.len + 16) continue;
  if (Math.abs(lat - mid) > 9) continue;
  const px = PX(pr.x, pr.z), py = PY(pr.x, pr.z);
  if (pr.kind === 'cone') { cv.disc(px, py, 5, C.cone); cv.disc(px, py, 2.2, C.white); }
  else if (pr.kind === 'barrier') { cv.rect(px - 11, py - 4, px + 11, py + 4, C.white); cv.rect(px - 11, py - 4, px - 4, py + 4, [224, 58, 58]); cv.rect(px + 4, py - 4, px + 11, py + 4, [224, 58, 58]); }
  else if (pr.kind === 'drum') { cv.disc(px, py, 5, C.cone); cv.disc(px, py, 2.4, C.white); }
  else if (pr.kind === 'crate') cv.rect(px - 5, py - 5, px + 5, py + 5, C.crate);
  else if (pr.kind === 'barrel') cv.disc(px, py, 5, C.barrel);
  else if (pr.kind === 'sign') { cv.rect(px - 6, py - 6, px + 6, py + 6, C.sign); drawText(cv, px - 3, py - 3, '!', [42, 42, 42], 1); }
  else if (pr.kind === 'dirtpile') cv.disc(px, py, 8, C.dirt);
  else if (pr.kind === 'pipe') cv.rect(px - 9, py - 2, px + 9, py + 2, C.steel);
}
drawText(cv, 24, 66, 'PLAN OF THE LANE AS LAID NOW - THE KIT STANDS ON THE CLOSED LANE ITSELF', C.dim, 1);
drawText(cv, 24, 700, 'ORANGE DASHED OUTLINE = THE OLD SINGLE SLAB: WARM GREY / BROWN, 5 CM THICK, 9 CM PROUD,', C.orange, 1);
drawText(cv, 24, 716, 'NO SEAMS AND NOTHING AROUND IT - WHICH IS WHY IT READ AS A BEIGE SHEET ON THE STREET.', C.orange, 1);
drawText(cv, 24, 748, `SITE: BLOCK (${site.ch.cx}, ${site.ch.cz}), LANE CENTRE ${mid.toFixed(1)} M FROM THE BLOCK LINE, STREET ALONG ${site.vert ? 'N-S' : 'E-W'}, REPAIR ${(site.len + 2).toFixed(0)} M LONG.`, C.dim, 1);
drawText(cv, 24, 764, `ASPHALT IS ${'#3B3F4A'}; THE NEW SLABS ARE ${[...new Set(site.slabs.map(s => '#' + s.col.toString(16).toUpperCase()))].join(' ')}.`, C.dim, 1);
void A0;

// ---- right: profile, palette, facts ----
const RX = 760;
drawText(cv, RX, 66, 'PROFILE OF THE REPAIR (FROM THE SIDE, EXAGGERATED)', C.ink, 2);
const baseY = 250, PPM = 900;                          // pixels per metre, vertical
cv.rect(RX, baseY, RX + 400, baseY + 60, C.road);
drawText(cv, RX + 4, baseY + 66, 'ASPHALT, Y = 0', C.dim, 1);
// now: 4 cm thick, 2 cm proud
cv.rect(RX + 20, baseY - 0.021 * PPM, RX + 180, baseY, rgb(0x33363d));
drawText(cv, RX + 20, baseY - 0.021 * PPM - 30, 'NOW: 4 CM THICK, 2 CM PROUD, FLUSH WITH THE LANE', C.ink, 1);
drawText(cv, RX + 20, baseY - 0.021 * PPM - 16, `#33363D - LUMINANCE ${lum(0x33363d).toFixed(0)}/255`, C.dim, 1);
// before: 5 cm thick, 9 cm proud
cv.rect(RX + 200, baseY - 0.115 * PPM, RX + 380, baseY - 0.09 * PPM, [214, 196, 154]);
drawText(cv, RX + 200, baseY - 0.115 * PPM - 30, 'BEFORE: 5 CM THICK, HOVERING 9 CM OVER THE STREET', C.orange, 1);
drawText(cv, RX + 200, baseY - 0.115 * PPM - 16, '#8A8A82 / #6B5A46 - LUMINANCE 138 / 94', C.orange, 1);

drawText(cv, RX, 360, 'THE PALETTE: BEFORE AND AFTER', C.ink, 2);
const nowCols = [...new Set(sites.flatMap(s => s.slabs.map(sl => sl.col)))].sort((a, b) => lum(a) - lum(b));
drawText(cv, RX, 382, 'NOW - COOL TARMAC, ALL SITES, LUMINANCE 45-58', C.dim, 1);
nowCols.forEach((c, i) => {
  cv.rect(RX + i * 66, 396, RX + i * 66 + 54, 430, rgb(c));
  drawText(cv, RX + i * 66, 436, `#${c.toString(16).toUpperCase()}`, C.ink, 1);
});
drawText(cv, RX, 462, 'BEFORE - WARM GREYS AND BROWNS, LUMINANCE 75-138', C.dim, 1);
[[0x57514a, 'DIG SITE'], [0x6b5a46, 'BARRIER'], [0x2c2e33, 'CONE TAPER'], [0x8a8a82, 'EQUIPMENT']].forEach(([c], i) => {
  cv.rect(RX + i * 66, 476, RX + i * 66 + 54, 510, rgb(c));
  for (let k = 0; k < 54; k++) cv.px(RX + i * 66 + k, 476 + k * 34 / 54, [255, 90, 90]);
  drawText(cv, RX + i * 66, 516, `#${c.toString(16).toUpperCase()}`, C.dim, 1);
});

const propKinds = new Set(site.ch.props.filter(p => KIT.has(p.kind) && Math.abs(p.x - site.x) < site.len + 16 && Math.abs(p.z - site.z) < site.len + 16).map(p => p.kind));
drawText(cv, RX, 556, 'WHAT THE CHECK SUITE ASSERTS', C.ink, 2);
const lines = [
  `LANES: ${sites.length} IN 20 BLOCKS, STYLES ${[...new Set(sites.map(s => s.style))].sort().join('/')}`,
  `SLABS: ${sites.reduce((n, s) => n + s.slabs.length, 0)} OVER ALL SITES, EVERY ONE <= 9.5 M LONG`,
  'THICKNESS <= 6 CM, PROUD <= 3 CM, DARK (<= 80/255 LUMINANCE)',
  'EVERY SITE IN A LANE (0.6..8 M FROM THE ROAD CENTRE LINE)',
  'EVERY SITE HAS A WARNING SIGN AND CONES ALONG THE REPAIR',
  `THIS SITE'S KIT: ${[...propKinds].sort().join(', ').toUpperCase()}`,
];
lines.forEach((t, i) => drawText(cv, RX, 580 + i * 17, t, i === 5 ? C.ink : C.dim, 1));

const file = path.join(here, 'plan-roadworks.png');
fs.writeFileSync(file, writePNG(W, H, cv.buf));
console.log(`wrote ${file}: block (${site.ch.cx},${site.ch.cz}), ${site.slabs.length} slabs, palette ${nowCols.map(c => '#' + c.toString(16)).join(' ')}`);
