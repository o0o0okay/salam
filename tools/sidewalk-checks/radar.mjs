/* The radar (js/radar.js): the map's picture of the city round the car, turned with it, with the chase on it.
   * the ground is the map's own picture (js/map.js paintGround), painted in tiles of one block: every building of a block
     is in its tile where the map has it, mirrored as the map is (the tile's top-left corner is its world corner (x1, z1)),
     and with no place names (they would turn with the radar);
   * the tiles land on the radar exactly where their part of the world is, for any heading: the car is at the centre and
     what is ahead of it is straight up;
   * the tiles are made a few a frame (at most TILE_MAKE, within a time budget), nearest first, until every block that reaches into the radar's
     circle has one; they are kept while the map's data under them is the same (a change elsewhere does not redraw them)
     and made again when it changes (a block the car has driven past is learnt); no more than TILE_MAX are kept;
   * the radar looks further as the car goes faster (95 m to the rim standing, 140 m flat out), easing, never beyond;
   * the chase on the rim: 'seen' while the police's last sighting is fresh (js/police.js FRESH), 'search' after it,
     'clear' with no chase (no live police, or not playing);
   * the search zone is centred where the police search (js/police.js searchCentre): the last sighting moved on along the
     car's last motion for up to 5 s, or the hiding car itself;
   * cruisers beyond the radar's edge (up to OFF_MAX) have a mark on its rim, in their direction; a blockade (a roadblock,
     a bridge checkpoint) beyond the edge has one mark of its own, not one a cruiser;
   * the canvas has as many pixels as the screen shows of it (devicePixelRatio), within 260 to 520.
   Run:  node tools/sidewalk-checks/radar.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// A 2D context that keeps the transform, and records the images drawn and the rectangles and text painted, in canvas pixels.
function recorder() {
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [], rec = { draws: [], rects: [], texts: [] };
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const api = {
    save() { stack.push(m); }, restore() { if (stack.length) m = stack.pop(); },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; }, resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    transform(a, b, c, d, e, f) { m = mul(m, [a, b, c, d, e, f]); },
    translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); }, scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); m = mul(m, [c, s, -s, c, 0, 0]); },
    drawImage(img) { rec.draws.push({ img, m }); },
    fillRect(x, y, w, h) { rec.rects.push({ x, y, w, h, m }); },
    fillText(t) { rec.texts.push(t); }, strokeText(t) { rec.texts.push(t); },
    measureText: () => ({ width: 8 }),
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
    getLineDash: () => [],
  };
  const ctx = new Proxy(api, {
    get(t, k) { if (k in t) return t[k]; return typeof k === 'string' ? (t[k] = () => {}) : undefined; },
    set(t, k, v) { t[k] = v; return true; },
  });
  const apply = (mm, x, y) => [mm[0] * x + mm[2] * y + mm[4], mm[1] * x + mm[3] * y + mm[5]];
  return { ctx, rec, apply };
}
// the radar's canvas: a recorder; the page's size 190 px; the resize listener kept, to call it
const R0 = recorder();
const radarCv = { width: 260, height: 260, clientWidth: 190, style: {}, getContext: () => R0.ctx };
const getEl = document.getElementById;
document.getElementById = id => (id === 'radar' ? radarCv : getEl(id));
const listeners = {};
window.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
// the baked map data, from the disk (the game fetches it)
globalThis.fetch = async url => {
  try { const txt = readFileSync(path.join(ROOT, String(url)), 'utf8'); return { ok: true, json: async () => JSON.parse(txt) }; }
  catch { return { ok: false, json: async () => null }; }
};

const RD = await import('../../js/radar.js');
const M = await import('../../js/map.js');
const MD = await import('../../js/mapData.js');
const W = await import('../../js/world.js');
const P = await import('../../js/police.js');
const { game, player, police, sight } = await import('../../js/state.js');
const { CHUNK, ck } = await import('../../js/utils.js');
assert(await MD.mapDataReady(), 'the baked map data did not load');
const info = RD.radarInfo();
const { R, TILE_S, TILE_PAD, TILE_MAX, TILE_MAKE, RANGE_MIN, RANGE_MAX, OFF_MAX } = info;
let checks = 0;
const near = (a, b, eps, what) => assert(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b}`);
const put = (x, z, h = 0, speed = 0) => Object.assign(player, { x, z, h, y: 0, speed, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed });
let clock = 100;
const frame = (dt = 0.05) => { clock += dt; game.t = clock; RD.drawRadar(); };
game.state = 'playing';
police.length = 0;
// where a world point is on the radar now (in the radar's own units): the car's turn (it points up) at the radar's scale
const expected = (x, z) => {
  const s = R / RD.radarInfo().range, dx = x - player.x, dz = z - player.z, co = Math.cos(player.h), si = Math.sin(player.h);
  return [R + (-co * dx + si * dz) * s, R + (-si * dx - co * dz) * s];
};
// the blocks that reach into the radar's circle (the radar draws the tiles a little beyond it: range + 2)
const inCircle = () => {
  const rr = RD.radarInfo().range + 2, out = [];
  for (let cx = Math.floor((player.x - rr) / CHUNK); cx <= Math.floor((player.x + rr) / CHUNK); cx++)
    for (let cz = Math.floor((player.z - rr) / CHUNK); cz <= Math.floor((player.z + rr) / CHUNK); cz++) {
      const nx = Math.max(cx * CHUNK, Math.min((cx + 1) * CHUNK, player.x)), nz = Math.max(cz * CHUNK, Math.min((cz + 1) * CHUNK, player.z));
      if (Math.hypot(nx - player.x, nz - player.z) <= rr) out.push(ck(cx, cz));
    }
  return out;
};

// 1. The map's picture of a block: its buildings where the map has them, mirrored, and no place names.
{
  let block = null;
  for (let cx = -6; cx <= 6 && !block; cx++) for (let cz = -6; cz <= 6 && !block; cz++) {
    const r = MD.known(ck(cx, cz));
    if (r && r.blds.length >= 3 && r.lm.length) block = { cx, cz, r };
  }
  assert(block, 'no block with buildings and a place name near the centre');
  const { cx, cz, r } = block;
  const x0 = cx * CHUNK - TILE_PAD, z0 = cz * CHUNK - TILE_PAD, x1 = (cx + 1) * CHUNK + TILE_PAD, z1 = (cz + 1) * CHUNK + TILE_PAD;
  const T = recorder();
  M.paintGround(T.ctx, x0, z0, x1, z1, TILE_S);
  const sea = T.rec.rects[0];
  near(sea.w, (x1 - x0) * TILE_S, 1e-9, 'the picture\'s width'); near(sea.h, (z1 - z0) * TILE_S, 1e-9, 'the picture\'s height');
  for (const [bx, bz, bw, bd] of r.blds) {
    // the footprint's top-left corner on the picture is its world corner (bx + bw, bz + bd), counted from (x1, z1)
    const X = (x1 - bx - bw) * TILE_S, Y = (z1 - bz - bd) * TILE_S;
    const hit = T.rec.rects.some(q => { const [px, py] = T.apply(q.m, q.x, q.y); return Math.abs(px - X) < 1e-6 && Math.abs(py - Y) < 1e-6 && Math.abs(q.w - bw * TILE_S) < 1e-6; });
    assert(hit, `the building at (${bx}, ${bz}) ${bw} x ${bd} m is not where the map has it in the radar's tile`);
  }
  assert.equal(T.rec.texts.length, 0, `the radar's picture has place names: ${T.rec.texts.join(', ')}`);
  checks += 3;
}

// 2. The tiles: a few a frame, nearest first, until the radar's circle is covered; each where its world is.
{
  put(330, 4, 0.7);
  frame();
  const tiles = RD.radarTiles();
  assert(tiles.size >= 1 && tiles.size <= TILE_MAKE, `${tiles.size} tiles made in the first frame (at most ${TILE_MAKE})`);
  assert(tiles.has(ck(Math.floor(player.x / CHUNK), Math.floor(player.z / CHUNK))), 'the car\'s own block is not among the first tiles');
  let prev = tiles.size, frames = 1;
  while (!inCircle().every(k => tiles.has(k))) {
    frame(); frames++;
    assert(tiles.size - prev <= TILE_MAKE, `${tiles.size - prev} tiles made in one frame`);
    prev = tiles.size;
    assert(frames < 40, 'the radar\'s circle is not covered after 40 frames');
  }
  checks += 3;
  // where each tile lands: its picture's corners and centre on their world points, for a car turned 0.7 rad
  R0.rec.draws.length = 0;
  frame();
  let drawn = 0;
  for (const t of tiles.values()) {
    const d = R0.rec.draws.find(q => q.img === t.cv);
    if (!d) continue;
    drawn++;
    near(t.cv.width, (CHUNK + 2 * TILE_PAD) * TILE_S, 0, 'a tile\'s width in pixels');
    for (const [u, v] of [[0, 0], [t.cv.width, 0], [0, t.cv.height], [t.cv.width, t.cv.height], [t.cv.width / 2, t.cv.height / 3]]) {
      const [X, Y] = R0.apply(d.m, u, v), [eX, eY] = expected(t.x1 - u / TILE_S, t.z1 - v / TILE_S);
      near(X, eX, 1e-6, `tile (${t.cx}, ${t.cz}) pixel (${u}, ${v}) across`); near(Y, eY, 1e-6, `tile (${t.cx}, ${t.cz}) pixel (${u}, ${v}) down`);
    }
  }
  assert(drawn >= inCircle().length, `${drawn} tiles drawn for ${inCircle().length} blocks in the circle`);
  // and the frame itself: the car at the centre, and 50 m ahead of it straight up
  const [cX, cY] = expected(player.x, player.z), [aX, aY] = expected(player.x + 50 * Math.sin(player.h), player.z + 50 * Math.cos(player.h));
  near(cX, R, 1e-9, 'the car across'); near(cY, R, 1e-9, 'the car down'); near(aX, R, 1e-9, 'ahead, across'); assert(aY < R - 30, 'ahead is not up');
  checks += 3;
}

// 3. A tile is kept while the map's data under it is the same, and made again when it changes.
{
  const tiles = RD.radarTiles(), before = new Map([...tiles].map(([k, t]) => [k, t.cv]));
  const v0 = MD.mapVersion();
  MD.forgetSeen();                                             // nothing was seen yet: the data is the same, only its count moved
  assert(MD.mapVersion() !== v0, 'forgetSeen did not count as a change');
  for (let i = 0; i < 6; i++) frame();
  for (const [k, cv] of before) assert(tiles.get(k).cv === cv, 'a tile was made again with the map\'s data under it unchanged');
  checks++;
  W.updateChunks(player.x, player.z, 999);                     // the car's surroundings are built, and learnt (as the car drives by)
  MD.learn();
  const changed = [...before.keys()].filter(k => {
    const t = tiles.get(k);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if ((MD.known(ck(t.cx + i, t.cz + j)) || null) !== t.from[(i + 1) * 3 + (j + 1)]) return true;
    return false;
  });
  assert(changed.length > 0, 'learning the car\'s surroundings changed no tile\'s data (the check is idle)');
  let prev = 0, frames = 0;
  const remade = () => changed.filter(k => tiles.get(k).cv !== before.get(k)).length;
  while (remade() < changed.length) {
    frame(); frames++;
    assert(remade() - prev <= TILE_MAKE, `${remade() - prev} tiles made again in one frame`);
    prev = remade();
    assert(frames < 40, 'the changed tiles are not made again after 40 frames');
  }
  checks += 2;
  // far away: the tiles are forgotten, the farthest first, and never more than TILE_MAX are kept
  for (let k = 0; k < 40; k++) {
    put(-900 + k * 45, -300 + k * 18, 1.2);
    for (let i = 0; i < 4; i++) { frame(); assert(tiles.size <= TILE_MAX, `${tiles.size} tiles kept (at most ${TILE_MAX})`); }
  }
  checks++;
}

// 4. The radar looks further as the car goes faster, easing; never beyond its two ranges.
{
  put(0, -24, 0, 0);
  for (let i = 0; i < 200; i++) frame();
  near(RD.radarInfo().range, RANGE_MIN, 0.01, 'the range standing');
  let last = RD.radarInfo().range, jump = 0;
  put(0, -24, 0, 60);
  for (let i = 0; i < 200; i++) { frame(); const r = RD.radarInfo().range; jump = Math.max(jump, Math.abs(r - last)); last = r; assert(r >= RANGE_MIN - 1e-9 && r <= RANGE_MAX + 1e-9, `range ${r}`); }
  near(RD.radarInfo().range, RANGE_MAX, 0.05, 'the range flat out');
  assert(jump < 4, `the range jumps ${jump.toFixed(2)} m in a frame`);
  checks += 3;
}

// 5. The chase on the rim, and where the search is.
{
  const cop = (x, z, o = {}) => Object.assign({ x, z, h: 0, wrecked: false, role: 'chaser', sees: false, parked: false, tip: { t: -99 } }, o);
  police.length = 0;
  game.state = 'playing'; game.t = clock;
  sight.t = game.t - 0.1;
  assert.equal(RD.chaseState(), 'clear', 'no police: not clear');
  police.push(cop(40, 0));
  assert.equal(RD.chaseState(), 'seen', 'a fresh sighting: not seen');
  sight.t = game.t - P.FRESH - 0.01;
  assert.equal(RD.chaseState(), 'search', 'an old sighting: not searching');
  police[0].wrecked = true;
  assert.equal(RD.chaseState(), 'clear', 'only wrecked police: not clear');
  police[0].wrecked = false; game.state = 'over';
  assert.equal(RD.chaseState(), 'clear', 'not playing: not clear');
  game.state = 'playing';
  checks += 5;
  const k = { x: 100, z: 50, vx: 10, vz: -4, t: game.t - 2 };
  game.hideT = 0;
  let c = P.searchCentre(k);
  near(c.x, 114, 1e-9, 'the search centre across'); near(c.z, 44.4, 1e-9, 'the search centre down');
  k.t = game.t - 9;                                              // the motion counts for 5 s at most
  c = P.searchCentre(k);
  near(c.x, 135, 1e-9, 'an old search centre across'); near(c.z, 36, 1e-9, 'an old search centre down');
  game.hideT = 3; put(-20, 70);                                  // a hiding car: the search comes to it
  c = P.searchCentre(k);
  near(c.x, -20, 1e-9, 'a hiding car\'s search across'); near(c.z, 70, 1e-9, 'a hiding car\'s search down');
  game.hideT = 0;
  assert.equal(P.SEARCH_R, 75, 'the search zone is not the 75 m the police patrol');
  checks += 4;
}

// 6. Cruisers beyond the edge: a mark on the rim each, in their direction; a blockade beyond it: one mark of its own.
{
  put(0, -24, 0.3, 0);
  for (let i = 0; i < 60; i++) frame();
  const s = R / RD.radarInfo().range, back = (d, side = 0) => [player.x - Math.sin(player.h) * d + Math.cos(player.h) * side, player.z - Math.cos(player.h) * d - Math.sin(player.h) * side];
  const cop = (x, z, o = {}) => Object.assign({ x, z, h: 0, wrecked: false, role: 'chaser', sees: false, parked: false, tip: { t: -99 } }, o);
  police.length = 0;
  const behind = cop(...back(200)), inside = cop(...back(50)), tooFar = cop(...back(OFF_MAX + 30)), wreck = cop(...back(180), { wrecked: true });
  police.push(behind, inside, tooFar, wreck);
  let marks = RD.offRadar(s);
  assert.equal(marks.length, 1, `${marks.length} rim marks for one cruiser beyond the edge`);
  assert.equal(marks[0].p, behind, 'the rim mark is not the cruiser beyond the edge');
  near(marks[0].x, R, 1e-6, 'a cruiser straight behind: its mark across'); assert(marks[0].y > R + R * 0.8, 'a cruiser straight behind: its mark is not at the bottom of the rim');
  // a roadblock beyond the edge: its cruisers have no marks of their own, the blockade has one
  const rb = [-5.5, 0, 5.5].map(v => cop(...back(170, v), { role: 'roadblock', h: Math.PI / 2 }));
  police.push(...rb); game.roadblockGroup = rb;
  marks = RD.offRadar(s);
  assert(marks.every(q => !rb.includes(q.p)), 'a roadblock\'s cruiser has a rim mark of its own');
  const bm = RD.offRadarBlockades(s);
  assert.equal(bm.length, 1, `${bm.length} rim marks for one roadblock beyond the edge`);
  near(bm[0].x, R, 1e-6, 'the roadblock\'s mark across');
  // once a cruiser leaves the roadblock (it chases), it is a cruiser again
  rb[0].role = 'chaser';
  assert(RD.offRadar(s).some(q => q.p === rb[0]), 'a cruiser that left the roadblock has no rim mark');
  // a checkpoint on a bridge deck: its parked cruisers are a blockade too (the ones still driving there are not)
  police.length = 0; game.roadblockGroup = null;
  const chk = [cop(...back(160, -4), { role: 'bridgeBlock', parked: true }), cop(...back(160, 4), { role: 'bridgeBlock', parked: false })];
  police.push(...chk);
  assert.equal(RD.blockades().length, 1, 'a bridge checkpoint is not a blockade');
  assert.deepEqual(RD.blockades()[0], [chk[0]], 'a checkpoint cruiser still driving to its place is in the blockade');
  police.length = 0;
  checks += 7;
}

// 7. The canvas has the screen's pixels: 190 px on the page at devicePixelRatio 2 is 380 pixels, within 260 to 520.
{
  const resized = (listeners.resize || []).filter(fn => String(fn).includes('fitDue'));   // the radar's own (other modules listen too)
  assert.equal(resized.length, 1, 'the radar does not listen for the window being resized');
  const resize = dpr => { window.devicePixelRatio = dpr; resized[0](); };
  resize(2);
  frame();
  assert.equal(radarCv.width, 380, `the radar canvas is ${radarCv.width} pixels wide at devicePixelRatio 2`);
  near(RD.radarInfo().k, 380 / 260, 1e-9, 'pixels a radar unit');
  resize(4);
  frame();
  assert.equal(radarCv.width, 520, 'the radar canvas is not held to 520 pixels');
  resize(1);
  frame();
  assert.equal(radarCv.width, 260, 'the radar canvas is not 260 pixels at devicePixelRatio 1');
  checks += 4;
}

console.log(`radar: ${checks} checks PASSED`);
process.exit(0);
