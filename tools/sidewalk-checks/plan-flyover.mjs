/* Plan + sections of the grade-separated interchange, drawn from the numbers the game actually builds with
   (js/flyover.js), including the at-grade lane the street gains beside the structure: at an interchange the kerb
   stands roadEdge() = halfW + atGrade from the centre line, so traffic that is not going over the bridge keeps a
   lane of its own on the ground, beside the embankment.

   node tools/sidewalk-checks/plan-flyover.mjs   ->  tools/sidewalk-checks/plan-flyover.png */
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const fly = await import('../../js/flyover.js');
const world = await import('../../js/world.js');
const { canvas, writePNG, drawText } = await import('./png.mjs');
const F = fly.FLY, EDGE = fly.roadEdge(), FRONT = world.PAVE_OUT + F.frontage;   // the building line beside the lane

const W = 1240, H = 980;
const cv = canvas(W, H, [244, 246, 248]);
const ink = [30, 33, 38], dim = [110, 116, 124], road = [70, 76, 86], lane2 = [148, 188, 224], conc = [176, 182, 188],
  paving = [226, 228, 231], line = [214, 200, 90], kerb = [176, 180, 184], lane = [40, 92, 150], done = [30, 120, 70];

// ================= plan: the first interchange along the avenue, in the junction's own frame =================
const node = fly.nearestNode(0, 1);                          // the first flyover out along the avenue
const HB = Math.round(node.node / F.span);                   // its junction, in blocks
const px = x => 330 + x * 3.6, pz = z => 520 + z * 3.6;      // x across the avenue, z along it
cv.rect(px(-80), pz(-80), px(80), pz(80), paving);           // the pavement the streets are cut through
// the at-grade lane: every block of the flying road that fronts this junction sets its kerb back by FLY.atGrade,
// so the strip between the structure's own edge (halfW) and roadEdge() is carriageway for the whole block.
const strip = (bx, side, sx) => {
  for (const bz0 of [HB - 1, HB]) {
    if (!fly.atGradeSide(bx, bz0, side)) continue;
    const z0 = Math.max(bz0 * F.span - node.node, -80), z1 = Math.min((bz0 + 1) * F.span - node.node, 80);
    cv.rect(px(Math.min(sx * F.halfW, sx * EDGE)), pz(z0), px(Math.max(sx * F.halfW, sx * EDGE)), pz(z1), lane2);
    cv.vline(px(sx * EDGE), pz(z0), pz(z1), kerb);
  }
};
strip(-1, 1, -1); strip(0, 0, 1);
cv.rect(px(-F.halfW), pz(-80), px(F.halfW), pz(80), road);   // the avenue: 16 m of carriageway, kerb to kerb
cv.rect(px(-80), pz(-F.halfW), px(80), pz(F.halfW), road);   // the crossing street, running at grade
// The frontage steps back with the lane: the building line beside the structure stands FLY.frontage further out
// than the city's usual one, and it is that step-back which pays for the lane's extra width, so the pavement
// behind the kerb keeps the 1.50 m it has.
for (const sx of [-1, 1]) {
  cv.vline(px(sx * world.PAVE_OUT), pz(-80), pz(80), [188, 190, 194]);   // the city's usual building line
  cv.vline(px(sx * FRONT), pz(-80), pz(80), done);                        // ... and where it stands beside the lane
}
for (const x of [-8.25, 8.25]) cv.vline(px(x), pz(-80), pz(80), kerb);          // its kerbs away from the junction
for (const z of [-8.25, 8.25]) cv.hline(px(-80), px(80), pz(z), kerb);
// the structure: ramps to ±46 m, the deck over the junction, a parapet down each edge of the lot
cv.rect(px(-F.halfW), pz(-F.rampEnd), px(F.halfW), pz(-F.deckHalf), conc, 0.85);
cv.rect(px(-F.halfW), pz(F.deckHalf), px(F.halfW), pz(F.rampEnd), conc, 0.85);
cv.rect(px(-F.halfW), pz(-F.deckHalf), px(F.halfW), pz(F.deckHalf), [198, 204, 210], 0.95);
for (const sx of [-1, 1]) cv.rect(px(sx * (F.halfW - F.parapet)), pz(-F.rampEnd), px(sx * F.halfW), pz(F.rampEnd), ink, 0.9);
cv.hline(px(-F.halfW), px(F.halfW), pz(0), line);
for (const t of [1.5, 7.75, -1.5, -7.75]) cv.rect(px(-0.12), pz(t - 1.7), px(0.12), pz(t + 1.7), line);
// labels
const H2 = (t, x, z, c = ink) => drawText(cv, px(x), pz(z), t, c, 2);
const H1 = (t, x, z, c = ink) => drawText(cv, px(x), pz(z), t, c, 1);
H2(`RAMP ${F.rampEnd - F.deckHalf} M AT 1 IN ${(1 / (F.deckH / (F.rampEnd - F.deckHalf))).toFixed(1)}`, -F.halfW - 24, -38);
H2(`DECK ${F.deckH.toFixed(2)} M`, -F.halfW - 26, 4);
  H1('OVER THE STREET BELOW', -F.halfW - 26, 8);
H2('AVENUE', -3.4, -78);
H1('THE CROSSING STREET KEEPS RUNNING AT GRADE UNDER IT', -76, -11);
H2(`AT-GRADE LANE ${F.atGrade.toFixed(2)} M`, F.halfW + 2, -33, lane);
H1(`KERB SET BACK TO ${EDGE.toFixed(2)} M FROM THE CENTRE LINE HERE`, F.halfW + 2, -28, lane);
cv.hline(px(F.halfW), px(EDGE + 1), pz(-30.5), lane);        // leader from the strip to its label
H2(`AT-GRADE LANE ${F.atGrade.toFixed(2)} M`, -EDGE - 8.5, 34, lane);
cv.hline(px(-EDGE - 1), px(-F.halfW), pz(32.5), lane);
H1('THE SAME ON BOTH SIDES, AND IT RUNS UNBROKEN THROUGH THE JUNCTION', -EDGE - 8.5, 30, lane);
H1(`BUILDING LINE BESIDE THE STRUCTURE: ${FRONT.toFixed(2)} M — IT STEPS BACK ${F.frontage.toFixed(2)} M FROM THE CITY'S USUAL ${world.PAVE_OUT.toFixed(2)} M LINE (GREY)`, -78, 82, done);
H1(`THAT STEP-BACK IS WHAT PAYS FOR THE ${F.atGrade.toFixed(2)} M LANE: THE WALK BEHIND IT KEEPS ITS ${(FRONT - (EDGE + 0.5)).toFixed(2)} M`, -78, 76, done);
const measure = (x0, x1, z, label) => {
  cv.rect(px(x0), pz(z), px(x1), pz(z), ink);
  cv.vline(px(x0), pz(z) - 5, pz(z) + 5, ink); cv.vline(px(x1), pz(z) - 5, pz(z) + 5, ink);
  H1(label, x0, z - 2.6);
};
measure(-EDGE, EDGE, 62, `KERB TO KERB BESIDE THE STRUCTURE: ${(EDGE * 2).toFixed(2)} M`);
measure(-F.halfW, F.halfW, -62, `BETWEEN THE FLYING LANES: ${(F.halfW * 2).toFixed(2)} M`);
drawText(cv, 20, 22, `PLAN - THE INTERCHANGE ON THE AVENUE AT Z = ${node.node} M, 1 PX = 0.28 M`, ink, 3);
drawText(cv, 20, 42, 'THE ROAD THAT FLIES CLIMBS; THE STREET THE PLAYER IS DRIVING ON KEEPS A LANE ON THE GROUND.', dim, 1);
drawText(cv, 20, 56, `ONE BLOCK EITHER WAY ALONG THE AVENUE THE PAVEMENT CORNERS ARE CUT ${F.chamfer.toFixed(1)} M ON THE DIAGONAL, AND THE CROSSINGS STAND JUST PAST THE CUT, SQUARE TO THE ROAD.`, dim, 1);

// ================= section A-A: across the avenue at the deck =================
{
  const ax = x => 645 + (x + 14) * 16.5, ay = y => 430 - y * 26, topA = F.deckH + F.parapet + 0.12;
  const T2 = (t, x, y) => drawText(cv, ax(x), ay(y), t, ink, 2);
  const T1 = (t, x, y, c = ink) => drawText(cv, ax(x), ay(y), t, c, 1);
  drawText(cv, 660, 96, 'SECTION A-A - ACROSS THE AVENUE AT THE DECK', ink, 2);
  drawText(cv, 660, 118, 'THE CROSSING STREET PASSES UNDER THE DECK UNTOUCHED.', dim, 1);
  cv.rect(ax(-14), ay(topA), ax(-8.25), ay(0), [236, 238, 240]);              // the cut through the pavement
  cv.rect(ax(8.25), ay(topA), ax(14), ay(0), [236, 238, 240]);
  cv.rect(ax(-8.25), ay(0), ax(8.25), ay(-0.02), kerb);                       // the street below: kerbs, then tarmac
  cv.rect(ax(-F.halfW), ay(0), ax(F.halfW), ay(-0.5), road);
  cv.rect(ax(-F.halfW), ay(F.deckH - 0.08), ax(F.halfW), ay(F.deckH - 0.98), conc);
  cv.rect(ax(-F.halfW), ay(F.deckH), ax(F.halfW), ay(F.deckH - 0.08), road);
  for (const s of [-1, 1]) {
    cv.rect(ax(s * (F.halfW - F.parapet)), ay(F.deckH + F.parapet), ax(s * F.halfW), ay(F.deckH), conc);
    cv.rect(ax(s * (F.halfW - F.parapet)), ay(F.deckH + F.parapet + 0.12), ax(s * (F.halfW - F.parapet + 0.62)), ay(F.deckH + F.parapet), [226, 228, 230]);
  }
  T2('DECK', F.halfW + 0.8, F.deckH + 0.35);
  T2('PARAPET', -F.halfW - 8.6, F.deckH + 0.6);
  T1(`HEADROOM UNDER THE SLAB: ${(F.deckH - 0.98).toFixed(2)} M`, -F.halfW, 2.2);
  T1('THE CROSSING STREET, AT GRADE', -13.4, -2.6, dim);
  cv.rect(ax(-8.25), ay(-1.0), ax(8.25), ay(-0.95), ink);
  T1('16.00 M CARRIAGEWAY, KERB AT 8.25 M', 0.6, -2.6);
}

// ================= section C-C: across the avenue on the ramp =================
{
  const cx = x => 645 + (x + 14) * 16.5, cy = y => 880 - y * 34;
  const u = F.deckHalf + Math.round(fly.RAMP_RUN / 2), top = fly.rampHeight(u);
  const T2 = (t, x, y, c = ink) => drawText(cv, cx(x), cy(y), t, c, 2);
  const T1 = (t, x, y, c = ink) => drawText(cv, cx(x), cy(y), t, c, 1);
  drawText(cv, 660, 520, `SECTION C-C - ACROSS THE AVENUE ON THE RAMP, u = ${u} M`, ink, 2);
  drawText(cv, 660, 542, `THE STREET GAINED THIS: A LANE AT GRADE ON EACH SIDE OF THE ${top.toFixed(2)} M EMBANKMENT.`, dim, 1);
  cv.rect(cx(-14), cy(top + 0.3), cx(-8.25), cy(0), [236, 238, 240]);
  cv.rect(cx(8.25), cy(top + 0.3), cx(14), cy(0), [236, 238, 240]);
  cv.rect(cx(-EDGE - 0.5), cy(0.05), cx(EDGE + 0.5), cy(-0.5), paving);
  cv.rect(cx(-EDGE), cy(0.10), cx(EDGE), cy(-0.42), road);                     // the street surface at grade
  cv.rect(cx(-EDGE), cy(0.12), cx(-F.halfW), cy(0.02), lane2);                // the at-grade lane, this side ...
  cv.rect(cx(F.halfW), cy(0.12), cx(EDGE), cy(0.02), lane2);                  // ... and the other
  for (const s of [-1, 1]) cv.rect(cx(s * EDGE), cy(0.42), cx(s * (EDGE + 0.5)), cy(0.06), kerb);
  cv.rect(cx(-F.halfW), cy(top), cx(F.halfW), cy(top - 0.08), road);           // the ramp surface on its slab
  cv.rect(cx(-F.halfW), cy(top - 0.08), cx(F.halfW), cy(-0.42), conc);
  T2('EMBANKMENT', -4.2, top / 2);
  T1(`THE RAMP SURFACE HERE IS ${top.toFixed(2)} M ABOVE THE STREET.`, -EDGE + 1, 2.6);
  for (const s of [-1, 1]) {
    const lx = s < 0 ? -EDGE - 5.4 : EDGE + 0.4;
    drawText(cv, cx(lx), cy(1.5), 'AT-GRADE LANE', lane, 2);
    drawText(cv, cx(lx), cy(1.1), `${F.atGrade.toFixed(2)} M WIDE`, lane, 2);
  }
  cv.rect(cx(-EDGE), cy(-1.2), cx(EDGE), cy(-1.15), ink);
  T1(`KERB STANDS ${EDGE.toFixed(2)} M FROM THE CENTRE LINE AT AN INTERCHANGE (8.25 M ELSEWHERE)`, -EDGE + 1, -1.9);
  T1('NOTHING IS PARKED, PLANTED OR DROPPED ON EITHER LANE: CARRIAGEWAY THE WHOLE LENGTH OF THE BLOCK.', -EDGE + 1, -2.5, done);
}

const fs = await import('fs');
fs.writeFileSync(new URL('./plan-flyover.png', import.meta.url), writePNG(W, H, cv.buf));
console.log(`wrote tools/sidewalk-checks/plan-flyover.png (interchange on the avenue at z = ${node.node} m, kerb at ${EDGE} m)`);
