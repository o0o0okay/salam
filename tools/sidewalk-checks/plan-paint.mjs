/* Plan of the streets around a flyover junction (or the junction beside one), drawn the way the player sees them.
 *
 * shot.mjs draws every textured material in one flat tone, so the paint the road texture carries — the yellow
 * centre line and the crossing rows baked into the tile at js/assets.js — is invisible in a shot, and so is the
 * difference between the paint the world bakes itself and the paint the texture already had. This plan puts both
 * on one drawing: the texture's own paint is reproduced from the tile recipe (32 texels to the metre), and on top
 * go the flat boxes the world really bakes at ground level — read from the generated blocks' own bake lists, not
 * from a second copy of the numbers.
 *
 *   node tools/sidewalk-checks/plan-paint.mjs <out.png> [chunkX] [chunkZ]
 */
import { modulePath } from './harness.mjs';
import { canvas, writePNG, drawText } from './png.mjs';
import fs from 'node:fs';
const world = await import(modulePath);
const CH = world.CHUNK, F = world.FLY;

const [out = 'plan-paint.png', cxA = 0, czA = -12] = process.argv.slice(2);
const CX = +cxA, CZ = +czA;                      // the junction = the corner of this block
const JX = CX * CH, JZ = CZ * CH;
const S = 6;                                     // px per metre
const X0 = JX - 46, X1 = JX + 46, Z0 = JZ - 96, Z1 = JZ + 96;
const W = Math.round((X1 - X0) * S), H = Math.round((Z1 - Z0) * S);
const cv = canvas(W, H, [122, 126, 136]);
const gx = x => (x - X0) * S, gz = z => (z - Z0) * S;
const MPP = CH / 512;                             // the road tile: 512 px over one 80 m block
const ASPH = [59, 63, 74], YEL = [255, 207, 46], WHITE = [222, 221, 213], PAVE = [196, 198, 202], KERB = [150, 152, 156];

const blocks = [];
for (let cx = -1; cx <= 0; cx++) for (let cz = CZ - 2; cz <= CZ + 1; cz++) blocks.push([cx, cz]);

// ---- the road texture's own paint, block by block (js/assets.js bakes it into the tile) ----
for (const [cx, cz] of blocks) {
  const x0 = cx * CH, z0 = cz * CH;
  cv.rect(gx(x0), gz(z0), gx(x0 + CH), gz(z0 + CH), ASPH);
  const rect = (u0, v0, u1, v1, c) => cv.rect(gx(x0 + u0 * MPP), gz(z0 + v0 * MPP), gx(x0 + u1 * MPP), gz(z0 + v1 * MPP), c);
  for (let y = 70; y < 450; y += 40) { rect(0, y, 2.5, y + 22, YEL); rect(509.5, y, 512, y + 22, YEL); }
  for (let x = 70; x < 450; x += 40) { rect(x, 0, x + 22, 2.5, YEL); rect(x, 509.5, x + 22, 512, YEL); }
  for (let x = 2; x < 50; x += 10) for (const yy of [53, 451]) {
    rect(x, yy, x + 6, yy + 8, WHITE); rect(506 - x, yy, 512 - x, yy + 8, WHITE);
    rect(yy, x, yy + 8, x + 6, WHITE); rect(yy, 506 - x, yy + 8, 512 - x, WHITE);
  }
}
// ---- the pavement ring, from the world's own side distances and its own strip stops ----
for (const [cx, cz] of blocks) {
  const bx = cx * CH + 40, bz = cz * CH + 40;
  for (let si = 0; si < world.SIDEWALK_SIDES.length; si++) {
    const s = world.SIDEWALK_SIDES[si];
    const lane = world.atGradeSide(cx, cz, si), kerb = world.PAVE_IN + (lane ? F.atGrade : 0);
    const lineOut = world.PAVE_OUT + (lane ? F.frontage : 0);
    const rx = cx + (s.along === 'z' && s.fixed > 0 ? 1 : 0), rz = cz + (s.along === 'x' && s.fixed > 0 ? 1 : 0);
    const ends = s.along === 'z' ? [[rx, cz], [rx, cz + 1]] : [[cx, rz], [cx + 1, rz]];
    const stop = ends.map(([ix, iz]) => world.stripStops(ix, iz, cx, cz, si));
    const a0 = (s.along === 'z' ? cz : cx) * CH + stop[0].stop + stop[0].cut;
    const len = CH - stop[0].stop - stop[1].stop - stop[0].cut - stop[1].cut;
    const at = radial => s.along === 'z' ? [bx + s.fixed * radial, a0] : [a0, bz + s.fixed * radial];
    const at1 = radial => s.along === 'z' ? [bx + s.fixed * radial, a0 + len] : [a0 + len, bz + s.fixed * radial];
    const [ax, az] = at(kerb), [bx2, bz2] = at1(CH / 2 - lineOut);
    cv.rect(gx(Math.min(ax, bx2)), gz(Math.min(az, bz2)), gx(Math.max(ax, bx2)), gz(Math.max(az, bz2)), PAVE, 0.92);
    const [c1x, c1z] = at(kerb), [c2x, c2z] = at1(kerb);
    line(cv, [gx(c1x), gz(c1z)], [gx(c2x), gz(c2z)], KERB);
  }
}
// ---- the cut corners: the pavement's tip is road, with the kerb across the cut ----
if (world.besideFlyover(CX, CZ)) for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
  const bcx = sx > 0 ? CX : CX - 1, bcz = sz > 0 ? CZ : CZ - 1;
  const ex = world.PAVE_IN + (world.atGradeSide(bcx, bcz, sx > 0 ? 0 : 1) ? F.atGrade : 0);
  const ez = world.PAVE_IN + (world.atGradeSide(bcx, bcz, sz > 0 ? 2 : 3) ? F.atGrade : 0);
  const c = [JX + sx * ex, JZ + sz * ez], a = [JX + sx * ex, JZ + sz * (ez + F.chamfer)], b = [JX + sx * (ex + F.chamfer), JZ + sz * ez];
  tri(cv, [gx(c[0]), gz(c[1])], [gx(a[0]), gz(a[1])], [gx(b[0]), gz(b[1])], ASPH);
  line(cv, [gx(a[0]), gz(a[1])], [gx(b[0]), gz(b[1])], KERB);
}
// ---- the structure, only where this junction really carries one ----
// A junction beside a flyover has no deck of its own: the ramps land short of it, so drawing one here would be a
// phantom bridge over the very markings under test. `isFlyoverNode` takes world metres, not block indices.
const node = world.isFlyoverNode(JX, JZ);
if (node) {
  cv.rect(gx(JX - F.halfW), gz(JZ - F.rampEnd), gx(JX + F.halfW), gz(JZ + F.rampEnd), [150, 154, 160], 0.75);
  cv.rect(gx(JX - F.halfW), gz(JZ - F.deckHalf), gx(JX + F.halfW), gz(JZ + F.deckHalf), [186, 190, 196], 0.85);
  line(cv, [gx(JX - F.halfW), gz(JZ)], [gx(JX + F.halfW), gz(JZ)], YEL);
}

// ---- what the world bakes on the ground, from the blocks' own bake lists ----
const ground = [];
for (const [cx, cz] of blocks) {
  const ch = world.generateChunk(cx, cz, true);
  for (const b of ch.mergeQ || []) {
    const g = b.geo, mt = Array.isArray(b.mat) ? b.mat[0] : b.mat;
    if (!g || g.w === undefined || g.rot) continue;                        // boxes only; the rings are the pavement
    const hex = mt ? (mt.c !== undefined ? mt.c : (mt.color ? mt.color.getHex() : 0)) : 0;
    const y = g.origin ? g.origin[1] : (b.m.t ? b.m.t[1] : 0);
    if (y > 0.36 || y + g.h < 0) continue;                                  // paint and patches on the ground only
    if (g.w > 30 || g.d > 30) continue;
    const x = g.origin ? g.origin[0] : (b.m.t ? b.m.t[0] : 0), z = g.origin ? g.origin[2] : (b.m.t ? b.m.t[2] : 0);
    ground.push({ x0: x - g.w / 2, x1: x + g.w / 2, z0: z - g.d / 2, z1: z + g.d / 2, y, hex });
  }
}
ground.sort((a, b) => a.y - b.y);
for (const g of ground) cv.rect(gx(g.x0), gz(g.z0), gx(g.x1), gz(g.z1), [(g.hex >> 16) & 255, (g.hex >> 8) & 255, g.hex & 255]);
const byHex = new Map();
for (const g of ground) byHex.set(g.hex.toString(16), (byHex.get(g.hex.toString(16)) || 0) + 1);
console.log(`ground pieces by colour: ${[...byHex].map(([h, n]) => `#${h} x${n}`).join('  ')}`);
const mine = ground.filter(g => g.hex === 0xe9e8df);
console.log(`crossing paint: ${mine.length} bars; e.g. ${mine.slice(0, 3).map(g => `x ${g.x0.toFixed(2)}..${g.x1.toFixed(2)} z ${g.z0.toFixed(2)}..${g.z1.toFixed(2)}`).join(' | ')}`);

// ---- lines and furniture ----
const what = node ? 'flyover junction' : world.besideFlyover(CX, CZ) ? 'junction beside a flyover' : 'junction';
for (const [t, x, z] of [[`${what} (${JX}, ${JZ})`, X0 + 2, Z0 + 3]]) drawText(cv, gx(x), gz(z), t, [20, 20, 20], 2);
function tri(cv, a, b, c, col) {
  const y0 = Math.min(a[1], b[1], c[1]), y1 = Math.max(a[1], b[1], c[1]);
  for (let y = Math.floor(y0); y <= y1; y++) {
    const xs = [];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if ((p[1] <= y && q[1] >= y) || (q[1] <= y && p[1] >= y)) xs.push(p[0] + (q[0] - p[0]) * (y - p[1]) / ((q[1] - p[1]) || 1e-9));
    }
    if (xs.length >= 2) cv.rect(Math.min(...xs), y, Math.max(...xs), y, col);
  }
}
function line(cv, a, b, col) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  for (let i = 0; i <= n; i++) cv.px(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, col);
}
fs.writeFileSync(out, writePNG(W, H, cv.buf));
console.log(`wrote ${out} (${W}x${H}), ${blocks.length} blocks`);
