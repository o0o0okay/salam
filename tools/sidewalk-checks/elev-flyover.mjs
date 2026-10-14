/* Elevation drawings of the grade-separated interchanges, drawn from the pieces the world records while it
 * builds them (ch.flyover.pieces — the same records run.mjs section 2c-3 checks). Each piece is drawn as its own
 * rectangle in the (distance along the road, height) plane, near pieces last, so the drawing shows exactly what
 * the game's own meshes are made of.
 *
 *   node tools/sidewalk-checks/elev-flyover.mjs   ->  tools/sidewalk-checks/elev-flyover.png
 *                                                    tools/sidewalk-checks/elev-recurrence.png
 *
 * Panel A is one interchange, close up: the ramps, the deck over the crossing street, the parapets with their
 * copings, and the hazard boards on the abutment face. Panel B is a couple of kilometres of the same avenue,
 * which is what the spacing looks like from the driver's seat: a flyover, then 400 to 560 m of plain junctions
 * before the next one — random, not a beat.
 */
import fs from 'node:fs';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const world = await import('../../js/world.js');
const fly = await import('../../js/flyover.js');
const { canvas, writePNG, drawText } = await import('./png.mjs');

const CHUNK = 80;
// The interchanges along the avenue, straight off the lattice, and then just the blocks that carry each one: the
// two blocks either side of the road that front its junction (cx = -1 and 0 for the avenue at x = 0), one on each
// side of the junction (cz = node/span - 1 and node/span). Those are the only chunks that can hold its pieces.
const nodes = [];
for (let k = 1; k <= 40; k++) if (fly.nodeBlock(k)) nodes.push(k * CHUNK);
const pieces = [], got = new Set();
for (const node of nodes) for (const cx of [-1, 0]) for (const cz of [Math.round(node / CHUNK) - 1, Math.round(node / CHUNK)]) {
  world.updateChunks(cx * CHUNK + 40, cz * CHUNK + 40, 1);
  for (const ch of world.chunks.values()) {
    const key = ch.cx + ',' + ch.cz;
    if (got.has(key)) continue; got.add(key);
    for (const p of (ch.flyover && ch.flyover.pieces) || []) if (p.axis === 'z' && p.road === 0) pieces.push(p);
  }
}
const ROLE_COLOUR = {
  'embankment': [206, 198, 178], 'approach': [58, 62, 72],
  'deck': [176, 182, 188], 'deck-wear': [58, 62, 72],
  'parapet-deck': [166, 172, 178], 'coping-deck': [226, 228, 230],
  'parapet-ramp': [166, 172, 178], 'coping-ramp': [226, 228, 230],
  'dash': [255, 207, 46], 'hazard': [30, 33, 38],
};
// One piece as a rectangle in the (u, y) plane: w/h are its cross section and rot its tilt about the across axis.
const drawPiece = (cv, p, u0, y, px, py) => {
  const col = ROLE_COLOUR[p.role] || [200, 200, 200];
  const ca = Math.cos(p.rot), sa = Math.sin(p.rot);
  const corners = [[-p.d / 2, -p.h / 2], [p.d / 2, -p.h / 2], [p.d / 2, p.h / 2], [-p.d / 2, p.h / 2]]
    .map(([a, b]) => [p.u + a * ca - b * sa, p.y + a * sa + b * ca]);
  const ys = corners.map(c => py(c[1]));
  for (let sy = Math.max(0, Math.round(Math.min(...ys))); sy <= Math.min(cv.h - 1, Math.round(Math.max(...ys))); sy++) {
    const hits = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4], ya = py(a[1]), yb = py(b[1]);
      if (((ya <= sy && yb >= sy) || (yb <= sy && ya >= sy)) && ya !== yb) hits.push(px(u0 + a[0]) + (px(u0 + b[0]) - px(u0 + a[0])) * (sy - ya) / (yb - ya));
    }
    if (hits.length > 1) cv.rect(Math.round(Math.min(...hits)), sy, Math.round(Math.max(...hits)), sy, col);
  }
};
const drawNode = (cv, node, px, py, u0 = 0) => {               // u0: where this junction sits on the sheet
  const np = pieces.filter(p => p.node === node);
  np.sort((a, b) => b.v - a.v);                               // far side first, the eye is on -x
  for (const p of np) drawPiece(cv, p, u0, 0, px, py);
};

// ---- panel A: one interchange, 70 m either side of its junction ----
const A = fly.nearestNode(0, 1);
{
  const cv = canvas(1240, 560, [247, 249, 251]);
  const px = u => 90 + (u + 70) * 7.6, py = y => 470 - (y + 0.5) * 44;   // u is the distance from the junction
  drawNode(cv, A.node, px, py);
  drawText(cv, 20, 500, `ONE INTERCHANGE ON THE AVENUE (70 M EITHER SIDE OF THE JUNCTION AT Z = ${A.node} M, 1 PX = 0.13 M)`, [30, 33, 38], 2);
  drawText(cv, 20, 518, `RAMPS ${fly.RAMP_RUN} M AT 1 IN ${(1 / fly.RAMP_SLOPE).toFixed(1)}, DECK 24 M OVER THE CROSSING STREET, PARAPETS DOWN BOTH EDGES.`, [110, 116, 124], 1);
  drawText(cv, px(-40) + 4, py(2.9), 'RAMP UP', [30, 33, 38], 2);
  drawText(cv, px(24) + 4, py(2.4), 'RAMP DOWN', [30, 33, 38], 2);
  drawText(cv, px(2) + 4, py(fly.FLY.deckH + 0.75), 'DECK', [30, 33, 38], 2);
  drawText(cv, px(2) + 4, py(fly.FLY.deckH + 1.7), 'CROSSING STREET RUNS AT GRADE UNDER IT', [60, 90, 150], 2);
  cv.hline(px(-70), px(70), py(fly.FLY.deckH), [200, 60, 60], 0.7);       // the deck surface, for reference
  drawText(cv, px(-70) + 6, py(fly.FLY.deckH) - 16, `DECK SURFACE ${fly.FLY.deckH.toFixed(2)} M ABOVE THE ROAD`, [200, 60, 60], 2);
  cv.hline(px(-70), px(70), py(0), [150, 156, 162], 0.8);
  fs.writeFileSync('tools/sidewalk-checks/elev-flyover.png', writePNG(cv.w, cv.h, cv.buf));
}
// ---- panel B: a couple of kilometres of the avenue, so the random spacing is visible ----
{
  const from = 300, to = 2400;
  const list = nodes.filter(n => n > from && n < to);
  const cv = canvas(1240, 260, [247, 249, 251]);
  const px = u => 20 + (u - from) * ((1240 - 40) / (to - from)), py = y => 205 - y * 11;
  for (const n of list) drawNode(cv, n, px, py, n);
  cv.hline(px(from), px(to), py(0), [150, 156, 162], 0.9);
  cv.hline(px(from), px(to), py(fly.FLY.deckH), [200, 60, 60], 0.5);
  drawText(cv, 20, 12, 'THE SAME AVENUE, 2.1 KM OF IT (1 PX = 1.7 M): A FLYOVER, THEN 400, 480 OR 560 M OF PLAIN JUNCTIONS', [30, 33, 38], 2);
  drawText(cv, 20, 32, 'THE SPACING IS DRAWN FROM A HASH OF THE JUNCTION INDEX - IT IS THE SAME LATTICE IN EVERY STREET AND EVERY SESSION, BUT IT IS NOT A BEAT.', [110, 116, 124], 1);
  const gaps = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i], y = 222;
    cv.rect(px(a), y, px(b), y, [110, 116, 124]);
    cv.vline(px(a), y - 4, y + 4, [110, 116, 124]); cv.vline(px(b), y - 4, y + 4, [110, 116, 124]);
    const t = `${b - a} M`;
    drawText(cv, (px(a) + px(b)) / 2 - t.length * 3, y - 6, t, [30, 33, 38], 1);
    gaps.push(b - a);
  }
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  drawText(cv, 20, 240, `GAPS ON THIS STRETCH: ${gaps.join(' M, ')} M - ${mean.toFixed(0)} M ON AVERAGE (THE OLD LATTICE WAS A FIXED 240 M).`, [30, 33, 38], 1);
  fs.writeFileSync('tools/sidewalk-checks/elev-recurrence.png', writePNG(cv.w, cv.h, cv.buf));
}
console.log(`pieces read: ${pieces.length}; interchanges on the avenue: ${nodes.join(', ')} m`);
