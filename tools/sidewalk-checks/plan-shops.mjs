/* Renders the shopping street straight from the generator: a plan of a shop block (two parades facing a
   parking court, the market square and the bays) plus a front elevation of one parade, drawn from the very
   parts buildShopParadeMesh() produces and lettered with the shop names the block registers.
   Run:  node tools/sidewalk-checks/plan-shops.mjs   -> plan-shops.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';
import { writePNG, canvas, drawText } from './png.mjs';

const world = await import(modulePath);
const here = path.dirname(url.fileURLToPath(import.meta.url));
world.updateChunks(0, 0, 999);

let seed = 11;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const CHUNK = world.CHUNK, HALF = CHUNK / 2;
const block = world.chunks.get(world.ck(1, -1));
const bx = block.cx * CHUNK + HALF, bz = block.cz * CHUNK + HALF;
const shopW = 9, h = 4.4, depth = 8.5, len = 5 * shopW, faceGap = 18;
const titles = block.parades.map(p => p.title);
const west = block.shops.filter(o => o.x < bx).sort((a, b) => a.z - b.z);

// flatten a parade group into world-space boxes, accumulating the local offsets the parts are nested inside
// (a shop front lives inside a body group placed at its own local x) and then mapping through the meshes' own
// rotation: +pi/2 for the west parade (local x runs down the parade, local z points at the court).
function flatten(g, rotY, ox, oz) {
  const out = [];
  const c = Math.cos(rotY), s2 = Math.sin(rotY);
  const walk = (o, lx, ly, lz) => {
    const px = lx + o.position.x, py = ly + o.position.y, pz = lz + o.position.z;
    if (o.isMesh && o.geometry && o.geometry.w) out.push({
      w: o.geometry.w, h: o.geometry.h, d: o.geometry.d,
      x: ox + px * c + pz * s2, y: py, z: oz - px * s2 + pz * c,
      rot: rotY, c: o.material && o.material.c,
    });
    for (const ch of o.children || []) walk(ch, px, py, pz);
  };
  walk(g, 0, 0, 0);
  return out;
}
const fullShop = sp => world.SHOP_TYPES.find(t => t.kind === sp.kind) || world.SHOP_TYPES[0];
const rebuild = world.buildShopParadeMesh(west.map(fullShop), rnd, { title: titles[0], shopW, h, depth });
const westParts = flatten(rebuild.group, Math.PI / 2, bx - faceGap, bz);

const COL_W = 1000, H = 1500, PAD = 18, S = 10.2;
const cv = canvas(COL_W, H, [24, 27, 32]);
const C = {
  ink: [238, 240, 244], dim: [150, 156, 166], road: [70, 74, 82], walk: [186, 190, 194],
  court: [96, 100, 108], apron: [178, 181, 184], grass: [90, 152, 70], bay: [204, 208, 212],
  bayLine: [120, 125, 132], car: [86, 150, 216], wall: [201, 198, 189], roof: [139, 143, 149],
  trim: [228, 225, 215], glass: [255, 226, 160], kiosk: [216, 69, 47], prop: [255, 150, 60], tree: [42, 116, 54],
  shop: [255, 96, 96],
};
const X = x => PAD + (x - (bx - HALF)) * S, Z = z => 40 + (z - (bz - HALF)) * S;
const box = (x0, z0, x1, z1, col) => cv.rect(X(x0), Z(z0), X(x1), Z(z1), col);
const rgb = c => c === undefined ? [150, 154, 160] : [(c >> 16) & 255, (c >> 8) & 255, c & 255];

drawText(cv, PAD, 14, `${titles[0]} - A SHOPPING STREET, DRAWN FROM THE GENERATOR`, C.ink, 2);
drawText(cv, PAD, 32, `${block.shops.length} STOREFRONTS IN TWO PARADES, ${block.parkingTotal} BAYS, 2 CARS AT NIGHT AND 3 AT NOON`, C.dim);

// ---- plan: the block as the generator lays it out ----
box(bx - HALF, bz - HALF, bx + HALF, bz + HALF, C.road);                       // the street all round the block
box(bx - 32, bz - 32, bx + 32, bz + 32, C.walk);                              // pavements (27.4 to 32 from the centre)
box(bx - 27.4, bz - 27.4, bx + 27.4, bz + 27.4, C.court);                     // the court pad
for (const sx of [-1, 1]) box(bx + sx * 18 - 1.8, bz - 27, bx + sx * 18 + 1.8, bz + 27, C.apron);
box(bx - 27, bz - 18 - 1.8, bx + 27, bz - 18 + 1.8, C.apron);
box(bx - 27, bz + 18 - 1.8, bx + 27, bz + 18 + 1.8, C.apron);
box(bx - 4.9, bz - 4.9, bx + 4.9, bz + 4.9, C.trim);                          // the market square
box(bx - 4.7, bz - 4.7, bx + 4.7, bz + 4.7, C.grass);
for (const [tx, tz] of [[bx - 3.1, bz - 3.1], [bx + 3.1, bz + 3.1], [bx + 3.1, bz - 3.1], [bx - 3.1, bz + 3.1]]) box(tx - 1.2, tz - 1.2, tx + 1.2, tz + 1.2, C.tree);
for (const kx of [bx - 6.6, bx + 6.6]) { box(kx - 2, bz - 1.3, kx + 2, bz + 1.3, C.kiosk); box(kx - 1.5, bz - 0.9, kx + 1.5, bz + 0.9, C.trim); }
for (const sx of [-1, 1]) {
  const rowX = bx + sx * 12.5;
  box(rowX - 2.5, bz - 22.5, rowX + 2.5, bz + 22.5, C.bayLine);               // the painted row
  for (let i = 0; i < 9; i++) {
    const bzs = bz - 20 + i * 5;
    box(rowX - 2.3, bzs - 1.1, rowX + 2.3, bzs + 1.1, C.bay);
    const standing = (block.lotStanding || []).some(o => Math.abs(o.slot.z - bzs) < 0.1 && Math.abs(o.slot.x - rowX) < 0.1);
    if (standing) box(rowX - 1.95, bzs - 0.9, rowX + 1.95, bzs + 0.9, C.car);
  }
}
for (const sp of block.shops) {                                              // the shop windows, brightest on the plan
  const sx = Math.sign(sp.x - bx);                                          // outward is +sx (away from the court)
  box(sp.x + sx * 1.2, sp.z - sp.w / 2, sp.x + sx * (1.2 + depth), sp.z + sp.w / 2, C.wall);
  box(sp.x + sx * 0.45, sp.z - sp.w / 2, sp.x - sx * 0.1, sp.z + sp.w / 2, [120, 96, 60]);
  box(sp.x + sx * 0.3, sp.z - sp.w / 2 + 0.3, sp.x + sx * 0.05, sp.z + sp.w / 2 - 0.3, C.glass);
}
for (const lx of [bx - 14.5, bx + 14.5]) for (const lz of [bz - 16, bz - 5.5, bz + 5.5, bz + 16]) box(lx - 0.4, lz - 0.4, lx + 0.4, lz + 0.4, C.prop);
block.shops.forEach((sp, i) => {                                             // a number per storefront
  const sx = Math.sign(sp.x - bx);
  drawText(cv, X(sp.x + sx * 0.75) - 3, Z(sp.z) - 2, String(i + 1), C.ink, 1);
});
const legendX = X(bx + HALF) + 26;
drawText(cv, legendX, Z(bz - HALF) + 8, 'THE SHOPS', C.ink, 1);
block.shops.forEach((sp, i) => {
  const col = world.SHOP_TYPES.find(t => t.kind === sp.kind);
  cv.rect(legendX, Z(bz - HALF) + 24 + i * 20, legendX + 10, Z(bz - HALF) + 34 + i * 20, rgb(col ? col.fascia : 0x888888));
  drawText(cv, legendX + 16, Z(bz - HALF) + 26 + i * 20, `${i + 1} ${sp.name}`, C.dim, 1);
});
drawText(cv, PAD, Z(bz + HALF) + 14, 'THE PALE BANDS ON BOTH PARADES ARE THE SHOP WINDOWS (EVERY ONE SMASHABLE); THE NAMES ARE THE GENERATED SHOPS', C.dim);
drawText(cv, PAD, Z(bz + HALF) + 30, 'TWO ROWS OF NINE BAYS FACE THE SHOPFRONTS ACROSS THE COURT, WITH THE MARKET SQUARE AND ITS STALLS BETWEEN THEM', C.dim);

// ---- elevation: the west parade, drawn from the parts the builder produced ----
const EY = 1300, ES = 18;
const EX = z => PAD + 24 + (z - (bz - len / 2 - 4.4)) * ES;                   // the elevation runs along z
const EYY = y => EY - y * ES;
drawText(cv, PAD, EY - 6.6 * ES - 34, 'ELEVATION BELOW: THE WEST PARADE, SHOP BY SHOP, DRAWN FROM THE BUILT PARTS', C.ink);
cv.rect(PAD, EY, COL_W - PAD, EY + 1, [120, 125, 132]);
for (const p of westParts.slice().sort((a, b) => b.z - a.z || a.y - b.y)) {   // back to front: the far wall first
  const y0 = p.y - p.h / 2, y1 = p.y + p.h / 2;
  if (y1 <= 0 || Math.abs(p.z - bz) > len / 2 + 6.2) continue;
  // the parade is rotated a quarter turn, so a part's local width runs along world z and its depth along world x
  const wide = p.w;
  const col = y0 > h ? C.roof : (p.y > h - 2.2 ? rgb(p.c) : rgb(p.c));
  cv.rect(EX(p.z - wide / 2), EYY(y1), EX(p.z + wide / 2), EYY(y0), col);
}
for (const sp of west) {                                                     // the lit panes and their names
  const x0 = EX(sp.z - sp.w / 2 + 0.55), x1 = EX(sp.z + sp.w / 2 - 0.55);
  cv.rect(x0, EYY(3.0), x1, EYY(0.55), C.glass);
  cv.rect(x0, EYY(3.6), x1, EYY(3.3), [90, 80, 60]);
  drawText(cv, x0 + 4, EYY(5.6), sp.name.slice(0, 10), C.ink, 1);
  drawText(cv, x0 + 4, EYY(6.5), sp.kind.toUpperCase().slice(0, 10), C.dim, 1);
}
drawText(cv, PAD, EY + 44, 'THE FASCIA NAMES, THE LIT WINDOWS, THE AWNINGS AND THE OUTDOOR PROPS ALL COME FROM THE ONE KIT THE BLOCK PLACES', C.dim);
drawText(cv, PAD, EY + 60, 'A CAR HITTING A PANE ABOVE 5 M/S TAKES THE GLASS OUT OF THE FRAME AND IT TUMBLES OFF DOWN THE STREET', C.dim);

fs.writeFileSync(path.join(here, 'plan-shops.png'), writePNG(cv.w, cv.h, cv.buf));
fs.writeFileSync('/home/user/plan-shops.png', writePNG(cv.w, cv.h, cv.buf));
console.log(`plan-shops.png drawn: block ${block.cx},${block.cz}, ${block.shops.length} shops, titles ${titles.join(' / ')}`);
console.log(`west parade: ${west.map(o => o.name).join(', ')}`);
