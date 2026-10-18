/* The open ground floor of a construction frame (js/world.js constructionSite/siteOn, js/collisions.js collideSolids,
   js/solidIndex.js solidAt, js/carModels.js carHeight, js/camera.js roofLimit/updateCamera):
   * the solids: every frame has a solid for each of its fourteen columns (the box that is drawn), one for the brick
     infill along its ground floor, and its footprint as a roof (kind 'building', `headroom` the underside of the first
     floor, 3.2 m); nothing else in it is solid. The lane between the two rows of columns is clear for a car (half width
     0.95) the length of the frame, and 3.9 m wide. The map still draws the frame as one building (the roof), and the
     baked map data (map-data/) is what the generator gives. Past the far end the lane stays clear for 10 m more,
     toward the machines. The pair's tower crane (CRANE in js/sites.js) stands between the two frames of the street, on
     its centre line, level with the middle bay: its base is solid and touches no column, brick or roof of either frame;
   * the frame that is drawn agrees: along the lane at a car's height a ray meets nothing, up from the lane it meets the
     first floor at 3.2 m, across the frame it meets a column, or the brick infill, or (between two columns on the open
     side) nothing; along the gap between the frames it meets the crane's base, across the gap its mast, and beside the
     mast the gap is open to the sky;
   * driving, with the game's own physics: a car drives in under the first floor and through, end to end, either way,
     without touching anything and without losing speed; so do the patrol cars, the van, the buses, the fire engine and
     the ambulance. A car can leave at the side between two columns, cross the alley between two frames and go on
     through the next one; a column stops a car, and so does the brick infill. The Juggernaut (police5: its light bar
     is over the slab), the fuel tanker, the cement mixer, the semis, the garbage truck and the ice cream van are too tall
     and are stopped at the mouth by the first floor;
   * the AI's probes (solidAt): the roof is a wall to a car too tall for it, open to one that fits under it, and open
     to a probe that gives no height (line of sight, hiding places); a column is a wall to every car;
   * carHeight: the top of the model (the Juggernaut's light bar), cached by kind; every car carries its own;
   * the chase camera: far from a frame it is the camera it always was. Driving through a frame, at any speed and either
     way, it comes down under the first floor without a jump, the line from the car to it never goes through the slab,
     it is no higher than the slab less ROOF_GAP while the two of them are under it (a shake does not lift it), its
     boom is pulled in while the car is under the roof, and it goes back up once it is out at the far end.
   Run:  node tools/sidewalk-checks/site-passage.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
// the world's traffic and props use Math.random: a fixed sequence makes every run the same
let seed = 20261017;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const THREE = await import('three');
const W = await import('../../js/world.js');
const S = await import('../../js/state.js');
const V = await import('../../js/vehicle.js');
const C = await import('../../js/carModels.js');
const Col = await import('../../js/collisions.js');
const SI = await import('../../js/solidIndex.js');
const { CRANE } = await import('../../js/sites.js');
const Cam = await import('../../js/camera.js');
const cfg = await import('../../js/config.js');
const { camera } = await import('../../js/renderer.js');
const { PLAYER_PARAMS } = cfg;
const { ROOF_GAP, EYE } = Cam;
const DT = 1 / 60, H = 3.2, LH = 14, DH = 3;          // the ground storey's height; the frame's half length and half depth
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(3)} (want ${b.toFixed(3)} ± ${tol})`);

// A frame as siteSpots gives it, with its axis and a map from (across, along), the offsets from its centre, to the world.
// The lane runs along `along`; +across is the side of the brick infill, -along the end it is on.
const frame = s => {
  const ax = s.hz === LH ? 'z' : 'x';
  return {
    ...s, ax,
    w: (ac, al) => (ax === 'z' ? [s.x + ac, s.z + al] : [s.x + al, s.z + ac]),
    loc: (x, z) => (ax === 'z' ? [x - s.x, z - s.z] : [z - s.z, x - s.x]),
    head: dir => (ax === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2)),        // along +/-
    headAc: dir => (ax === 'z' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI)),       // across +/-
  };
};
const framesOf = (cx, cz) => W.siteSpots(cx, cz).filter(s => Math.max(s.hx, s.hz) === LH).map(frame);
const loaded = (cx, cz) => [...W.chunks.values()].some(ch => ch.cx === cx && ch.cz === cz);
const allSolids = () => [...W.chunks.values()].flatMap(ch => ch.solids).filter(s => s.hx > 0);
const COLS = [];                                        // the fourteen columns: (across, along)
for (let a = -LH + 0.6; a < LH; a += 4) for (const ac of [-DH + 0.6, DH - 0.6]) COLS.push([ac, a]);

// ---------------------------------------------------------------------------------------------------------------
// The solids, frame by frame, over a spread of sites (both axes, with a crane and without)
// ---------------------------------------------------------------------------------------------------------------
const seen = new Map();
// (-200, 840) stands in for (-160, 610): that frame stood on the street z -2,7 across the river's bridge, which stays
// open now (segClosed in js/flyover.js), so no site is built there
const spots = [[-320, -290], [-290, 480], [-200, 840], [110, -720], [-80, -690]];
const mapTiles = new Map();
const tileOf = (cx, cz) => {
  const k = `${Math.floor((cx + 25) / 10)}_${Math.floor((cz + 25) / 10)}`;
  if (!mapTiles.has(k)) { const f = new URL(`../../map-data/${k}.json`, import.meta.url); mapTiles.set(k, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null); }
  return mapTiles.get(k);
};
const r1 = v => Math.round(v * 10) / 10;
let framesChecked = 0, withCrane = 0, alongX = 0, mapBlocks = 0;
for (const [px, pz] of spots) {
  W.updateChunks(px, pz, 999);
  const solids = allSolids();
  const pcx = Math.floor(px / 80), pcz = Math.floor(pz / 80);
  for (let cx = pcx - 1; cx <= pcx + 1; cx++) for (let cz = pcz - 1; cz <= pcz + 1; cz++) {
    if (!loaded(cx, cz)) continue;
    // the frames the generator built: siteSpots also lists a street along a river, where there is no site. A site is
    // told by its machines (marked, and not part of this change), 31 m past the frame's centre in its strip
    const fs_ = framesOf(cx, cz).filter(f => solids.some(s => s.machine !== undefined && Math.abs(f.loc(s.x, s.z)[0]) < 4 && Math.abs(f.loc(s.x, s.z)[1] - 31) < 6));
    if (!fs_.length) continue;
    // the map draws the frame as one building, the roof, as it did before the ground floor opened: the baked map data
    // is the generator's (the same rule as tools/map-data/bake.mjs)
    const ch = [...W.chunks.values()].find(c => c.cx === cx && c.cz === cz);
    const blds = ch.solids.filter(s => s.kind === 'building' && Math.min(s.hx, s.hz) >= 2)
      .map(s => [r1(s.x - s.hx), r1(s.z - s.hz), r1(2 * s.hx), r1(2 * s.hz), Math.abs(Math.round(s.x * 3 + s.z * 7)) % 7]);
    for (const f of fs_) ok(blds.filter(b => b[0] === r1(f.x - f.hx) && b[1] === r1(f.z - f.hz) && b[2] === 2 * f.hx && b[3] === 2 * f.hz).length === 1, `block ${cx},${cz}: the map draws the frame at ${f.x},${f.z} as one building`);
    const tile = tileOf(cx, cz), rec = tile && tile[`${cx},${cz}`];
    if (rec) { ok(JSON.stringify(rec.blds) === JSON.stringify(blds), `block ${cx},${cz}: the baked map data holds the generator's buildings (no new bake needed)`); mapBlocks++; }
    for (const f of fs_) {
      const key = `${f.x},${f.z}`;
      if (seen.has(key)) continue;
      seen.set(key, f);
      framesChecked++; if (f.ax === 'x') alongX++;
      const tag = `frame ${key} (${f.ax})`;
      const inside = solids.filter(s => Math.abs(s.x - f.x) < f.hx + 1e-6 && Math.abs(s.z - f.z) < f.hz + 1e-6);
      const roofs = inside.filter(s => s.headroom !== undefined);
      ok(roofs.length === 1, `${tag}: one roof (${roofs.length})`);
      const roof = roofs[0];
      ok(roof.kind === 'building' && roof.x === f.x && roof.z === f.z && roof.hx === f.hx && roof.hz === f.hz, `${tag}: the roof is the footprint, a building`);
      ok(roof.headroom === H, `${tag}: its headroom is the first floor's underside (${roof.headroom})`);
      ok(roof.maxY === undefined, `${tag}: the roof is not a wall under a deck`);
      const cols = inside.filter(s => s.hx === 0.45 && s.hz === 0.45 && s.kind === 'building');
      ok(cols.length === 14, `${tag}: fourteen column solids (${cols.length})`);
      for (const [ac, al] of COLS) {
        const [x, z] = f.w(ac, al);
        ok(cols.some(s => Math.abs(s.x - x) < 1e-9 && Math.abs(s.z - z) < 1e-9), `${tag}: a solid on the column at ${ac},${al}`);
      }
      const [bx, bz] = f.w(DH - 0.2, -LH / 2);
      const brick = inside.filter(s => s.kind === 'building' && Math.abs(s.x - bx) < 1e-9 && Math.abs(s.z - bz) < 1e-9);
      ok(brick.length === 1 && (f.ax === 'z' ? [brick[0].hx, brick[0].hz] : [brick[0].hz, brick[0].hx]).join() === '0.2,7', `${tag}: one solid on the ground floor's brick infill, 0.4 m thick and 14 m long`);
      ok(inside.length === 16, `${tag}: nothing else in the frame is solid (${inside.length} solids)`);
      // the lane: clear for a car's half width, the length of the frame and 2 m past both ends
      let blockedLow = 0, blockedPlayer = 0, blockedTall = 0, n = 0, nTall = 0;
      for (let al = -LH - 2; al <= LH + 2; al += 0.25, n++) {
        const [x, z] = f.w(0, al);
        if (SI.solidAt(x, z, 0.95, 0)) blockedLow++;
        if (SI.solidAt(x, z, 0.95, 0, false, 1.66)) blockedPlayer++;
        if (Math.abs(al) < LH) { nTall++; if (SI.solidAt(x, z, 0.95, 0, false, 3.3)) blockedTall++; }
      }
      ok(blockedLow === 0 && blockedPlayer === 0, `${tag}: the lane is clear for a car the length of the frame (${blockedLow}, ${blockedPlayer} of ${n} points blocked)`);
      ok(nTall > 100 && blockedTall === nTall, `${tag}: and walled for one too tall for the first floor (${blockedTall} of ${nTall})`);
      const inner = Math.min(...cols.map(s => Math.abs(f.loc(s.x, s.z)[0]) - 0.45));
      near(2 * inner, 3.9, 1e-9, `${tag}: the lane between the column faces is 3.9 m wide`);
      // and on past its far end, toward the machines 31 m out: 10 m more of clear lane. The pair's tower crane used to
      // stand there, in line with the lane 22 m past the frame's centre, and stopped a car that had come through
      let blockedPast = 0, nPast = 0;
      for (let al = LH + 2; al <= LH + 10; al += 0.25, nPast++) { const [x, z] = f.w(0, al); if (SI.solidAt(x, z, 0.95, 0, false, 1.66)) blockedPast++; }
      ok(blockedPast === 0, `${tag}: past its far end the lane is clear for 10 m more (${blockedPast} of ${nPast} points blocked)`);
      // The pair's tower crane, if this is the frame that builds it (siteSpots marks it): on the street's centre line,
      // between this frame and its twin across the line (built by the next block), level with the middle bay of their
      // length. Its base is solid and touches nothing else: no column, no brick infill, neither frame's roof.
      const [cwx, cwz] = f.w(CRANE.ac, CRANE.al);
      if (W.siteSpots(cx, cz).some(s => s.crane && Math.abs(s.x - cwx) < 1e-9 && Math.abs(s.z - cwz) < 1e-9)) {
        withCrane++;
        const base = solids.filter(s => s.kind === 'building' && s.hx === CRANE.half && s.hz === CRANE.half && Math.abs(s.x - cwx) < 1e-9 && Math.abs(s.z - cwz) < 1e-9);
        ok(base.length === 1, `${tag}: the crane's base between the frames is solid (${base.length})`);
        const twin = framesOf(f.ax === 'z' ? cx - 1 : cx, f.ax === 'z' ? cz : cz - 1).find(g => { const [ac, al] = f.loc(g.x, g.z); return Math.abs(ac - 2 * CRANE.ac) < 1e-9 && Math.abs(al) < 1e-9; });
        ok(twin, `${tag}: its twin stands across the street's centre line, ${-2 * CRANE.ac} m off`);
        const [bac] = f.loc(cwx, cwz);
        ok(bac < -DH && (!twin || bac > f.loc(twin.x, twin.z)[0] + DH), `${tag}: the crane stands between the two frames (${bac} across)`);
        const touch = solids.filter(s => s !== base[0] && Math.abs(s.x - cwx) < s.hx + CRANE.half + 0.1 && Math.abs(s.z - cwz) < s.hz + CRANE.half + 0.1);
        ok(touch.length === 0, `${tag}: the crane's base is clear of every other solid by 10 cm (${touch.map(s => s.kind + ' ' + s.x.toFixed(1) + ',' + s.z.toFixed(1)).join('; ')})`);
      }
    }
  }
}
ok(framesChecked >= 12 && withCrane >= 4 && alongX >= 4 && framesChecked - alongX >= 4, `a spread of frames was checked (${framesChecked}: ${alongX} along x, ${withCrane} with a crane)`);
ok(mapBlocks >= 6, `the baked map data was compared on the frames' blocks (${mapBlocks})`);

// ---------------------------------------------------------------------------------------------------------------
// The frame that is drawn agrees with its solids (rays against the chunk's own meshes), along z and along x
// ---------------------------------------------------------------------------------------------------------------
const ray = new THREE.Raycaster();
const castIn = (ch, o, d, far) => {
  ray.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize()); ray.near = 0; ray.far = far;
  const hits = ray.intersectObject(ch.group, true).filter(h => h.object.visible !== false);
  return hits.length ? hits[0] : null;
};
for (const [px, pz, cx, cz] of [[-320, -290, -4, -4], [-290, 480, -4, 6]]) {
  W.updateChunks(px, pz, 999);
  const ch = [...W.chunks.values()].find(c => c.cx === cx && c.cz === cz);
  ch.group.updateMatrixWorld(true);
  for (const f of framesOf(cx, cz)) {
    const tag = `frame ${f.x},${f.z} (${f.ax}) as drawn`;
    const dAl = f.ax === 'z' ? [0, 0, 1] : [1, 0, 0], dAc = f.ax === 'z' ? [1, 0, 0] : [0, 0, 1];
    const at = (ac, al, y) => { const [x, z] = f.w(ac, al); return [x, y, z]; };
    for (const al of [-10, -2, 6, 12]) {
      const h = castIn(ch, at(0, al, 0.5), [0, 1, 0], 10);
      ok(h && Math.abs(h.point.y - H) < 1e-3, `${tag}: up from the lane at ${al} the first thing is the first floor's underside at ${H} m (${h ? h.point.y.toFixed(3) : 'nothing'})`);
    }
    for (const y of [0.5, 1.5, 2.5, 3.1]) for (const ac of [-1.0, 0, 1.0]) {
      const h = castIn(ch, at(ac, -LH - 2, y), dAl, 2 * LH + 4);
      ok(!h, `${tag}: along the lane at ${ac} across, ${y} m up, nothing is in the way${h ? ' (hit at ' + h.point.toArray().map(v => v.toFixed(2)).join(',') + ')' : ''}`);
    }
    const hc = castIn(ch, at(-DH - 2, COLS[0][1], 1.0), dAc, 6);
    ok(hc && Math.abs(f.loc(hc.point.x, hc.point.z)[0] - (-DH + 0.6 - 0.45)) < 1e-3, `${tag}: across at a column, the column's face`);
    const hb = castIn(ch, at(0, -LH / 2, 1.0), dAc, 6);
    ok(hb && Math.abs(f.loc(hb.point.x, hb.point.z)[0] - (DH - 0.4)) < 1e-3, `${tag}: across the brick half, the brick infill's face`);
    for (const al of [0.6, 4.6, 8.6]) {
      const ho = castIn(ch, at(-DH, al, 1.0), dAc, 2 * DH);
      ok(!ho, `${tag}: across between two columns in the open half (${al}), nothing`);
    }
    // The crane as drawn, where this frame builds it, against both blocks' meshes (the twin frame is the next
    // block's): along the gap between the frames at the base's height the first thing is the base; across the gap
    // between two floors, the mast; and beside the mast the gap is open to the sky, so the mast touches neither
    // frame's slabs.
    const [cwx, cwz] = f.w(CRANE.ac, CRANE.al);
    if (W.siteSpots(cx, cz).some(s => s.crane && Math.abs(s.x - cwx) < 1e-9 && Math.abs(s.z - cwz) < 1e-9)) {
      const twinCh = [...W.chunks.values()].find(c => c.cx === (f.ax === 'z' ? cx - 1 : cx) && c.cz === (f.ax === 'z' ? cz : cz - 1));
      twinCh.group.updateMatrixWorld(true);
      const castBoth = (o, d, far) => {
        ray.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize()); ray.near = 0; ray.far = far;
        const hits = ray.intersectObjects([ch.group, twinCh.group], true).filter(h => h.object.visible !== false);
        return hits.length ? hits[0] : null;
      };
      const loc = h => h ? f.loc(h.point.x, h.point.z).map(v => v.toFixed(2)).join(',') + ' at ' + h.point.y.toFixed(2) : 'nothing';
      const hb2 = castBoth(at(CRANE.ac, -LH - 2, 0.7), dAl, 2 * LH);
      ok(hb2 && Math.abs(f.loc(hb2.point.x, hb2.point.z)[1] - (CRANE.al - CRANE.half)) < 1e-3, `${tag}: along the gap between the frames, the crane's base (${loc(hb2)})`);
      const hm = castBoth(at(-1.0, CRANE.al, 11.3), dAc.map(v => -v), 6);
      ok(hm && Math.abs(f.loc(hm.point.x, hm.point.z)[0] - (CRANE.ac + 0.5)) < 1e-3, `${tag}: across the gap, between two floors, the crane's mast (${loc(hm)})`);
      for (const side of [-1, 1]) {
        const hs = castBoth(at(CRANE.ac + side * 0.75, CRANE.al, 1.2), [0, 1, 0], 60);
        ok(!hs, `${tag}: beside the mast (${side > 0 ? 'this' : 'the twin'} frame's side) the gap is open to the sky (${loc(hs)})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Driving through, with the game's own physics (driveCar, then collideSolids and collideProps, as js/update.js does)
// ---------------------------------------------------------------------------------------------------------------
Object.assign(S.game, { state: 'playing', time: 10, t: 10, hp: 100, shake: 0 });
const car = (kind, x, z, h) => { const c = V.createCar(kind, x, z, h, PLAYER_PARAMS, 0x8899aa); if (kind.startsWith('police')) c.tier = { police1: 1, police2: 2, police3: 3, police4: 4, police5: 5 }[kind] || 1; S.cars.push(c); return c; };
// drives `kind` from (ac, al) of frame f, heading h, at v m/s with the throttle down, until `until` or `sec`
function drive(f, kind, ac, al, h, v, { sec = 4, throttle = 1, until = () => false } = {}) {
  const [x, z] = f.w(ac, al), c = car(kind, x, z, h);
  c.vx = Math.sin(h) * v; c.vz = Math.cos(h) * v; c.speed = v; c.lastWall = -99;
  const r = { walls: 0, maxDev: 0, maxAl: -1e9, minAl: 1e9, maxAc: -1e9, minAc: 1e9 };
  for (let t = 0; t < sec && !until(c, f.loc(c.x, c.z)); t += DT) {
    S.game.time += DT; S.game.t += DT;
    V.driveCar(c, { throttle, steer: 0, hand: false }, DT);
    const lw = c.lastWall;
    Col.collideSolids(c); Col.collideProps(c);
    if (c.lastWall !== lw) r.walls++;
    const [cac, cal] = f.loc(c.x, c.z);
    r.maxAl = Math.max(r.maxAl, cal); r.minAl = Math.min(r.minAl, cal); r.maxAc = Math.max(r.maxAc, cac); r.minAc = Math.min(r.minAc, cac);
  }
  [r.ac, r.al] = f.loc(c.x, c.z); r.v = Math.hypot(c.vx, c.vz); r.c = c;
  V.removeCar(c);
  return r;
}
const PASS = ['player', 'police1', 'police2', 'police3', 'police4', 'policeVan', 'policeMoto', 'policeUnmarked', 'bus', 'ambulance', 'firetruck', 'suv', 'van'];
const TALL = ['police5', 'fueltanker', 'cementtruck', 'semi', 'logtruck', 'garbage', 'icecream'];
for (const k of PASS) ok(C.CAR_DIMS[k] && carH(k) <= H, `${k} fits under the first floor (${carH(k).toFixed(2)} m)`);
for (const k of TALL) ok(C.CAR_DIMS[k] && carH(k) > H, `${k} is too tall for the first floor (${carH(k).toFixed(2)} m)`);
function carH(kind) { return C.carHeight(kind, C.buildCar(kind, 0xffffff)); }
for (const [px, pz, blocks] of [[-320, -290, [[-4, -4], [-5, -4]]], [-290, 480, [[-4, 5], [-4, 6]]]]) {
  W.updateChunks(px, pz, 999);
  for (const ch of W.chunks.values()) ch.props = ch.props.filter(p => p.kind !== 'barricade');   // the mouths' barricades, broken already
  for (const [cx, cz] of blocks) for (const f of framesOf(cx, cz)) {
    const tag = `frame ${f.x},${f.z} (${f.ax})`;
    for (const dir of [1, -1]) {
      const r = drive(f, 'player', 0, -dir * (LH + 3), f.head(dir), 20, { until: (c, [, al]) => dir * al > LH + 2 });
      ok(r.walls === 0, `${tag}: the player's car drives in under the first floor and through (${dir > 0 ? '+' : '-'}), touching nothing (${r.walls})`);
      ok(dir * r.al > LH + 2 && r.v > 20, `${tag}: and comes out at the far end faster than it went in (${r.al.toFixed(1)}, ${r.v.toFixed(1)} m/s)`);
      ok(Math.max(Math.abs(r.maxAc), Math.abs(r.minAc)) < 0.05, `${tag}: on the lane's centre line`);
    }
    for (const k of PASS.slice(1)) {
      const e1 = C.CAR_DIMS[k].e1;
      const r = drive(f, k, 0, -LH - e1 - 1, f.head(1), 16, { until: (c, [, al]) => al > LH + 1 });
      ok(r.walls === 0 && r.al > LH + 1, `${tag}: ${k} drives through (${r.walls} hits, out at ${r.al.toFixed(1)})`);
    }
    for (const k of TALL) {
      const e1 = C.CAR_DIMS[k].e1;
      const r = drive(f, k, 0, -LH - e1 - 1, f.head(1), 12, { sec: 2 });
      ok(r.walls >= 1 && r.maxAl + e1 <= -LH + 0.35 && r.v < 3, `${tag}: ${k} is stopped at the mouth by the first floor (nose at ${(r.maxAl + e1).toFixed(2)}, ${r.v.toFixed(1)} m/s, ${r.walls} hits)`);
    }
  }
}

// out at the side, across the alley and through the next frame; a column and the brick infill stop a car
{
  W.updateChunks(-320, -290, 999);
  for (const ch of W.chunks.values()) ch.props = ch.props.filter(p => p.kind !== 'barricade');
  const west = framesOf(-4, -4)[0], east = framesOf(-5, -4)[0];
  ok(west && east && west.ax === 'z' && east.x < west.x, 'the pair of frames on the street at x = -320');
  const gapAl = 4.6;                                    // between the columns at 2.6 and 6.6, past the brick infill
  let r = drive(west, 'player', 0, gapAl, west.headAc(-1), 12, { until: (c, [ac]) => ac < -DH - 1.2 });
  ok(r.walls === 0 && r.ac < -DH - 1.2, `out at the side between two columns, into the alley (${r.walls} hits)`);
  r = drive(west, 'player', 0, gapAl, west.headAc(1), 12, { until: (c, [ac]) => ac > DH + 0.9 });
  ok(r.walls === 0 && r.ac > DH + 0.9, `out at the other side, the open half (${r.walls} hits)`);
  r = drive(west, 'player', 0, gapAl, west.headAc(-1), 12, { until: (c, [ac]) => west.x + ac < east.x });
  ok(r.walls === 0 && r.c.x < east.x, `across the alley and into the next frame's lane (${r.walls} hits, at x ${r.c.x.toFixed(1)})`);
  r = drive(west, 'player', 0, -LH / 2, west.headAc(1), 12, { sec: 1.5 });
  ok(r.walls >= 1 && r.maxAc + 2.05 <= DH - 0.4 + 0.3 && r.v < 6, `the brick infill stops a car (nose at ${(r.maxAc + 2.05).toFixed(2)}, ${r.v.toFixed(1)} m/s)`);
  r = drive(west, 'player', DH - 0.6, -LH - 6, west.head(1), 15, { sec: 1.5 });
  ok(r.walls >= 1 && r.maxAl + 2.05 <= COLS[0][1] - 0.45 + 0.3 && r.v < 6, `a column stops a car (nose at ${(r.maxAl + 2.05).toFixed(2)}, ${r.v.toFixed(1)} m/s)`);
  r = drive(west, 'police5', 0, -LH - 4.7, west.head(1), 14, { sec: 1.5 });
  ok(r.walls >= 1 && r.maxAl + C.CAR_DIMS.police5.e1 <= -LH + 0.35, `the Juggernaut is stopped at the mouth at full tilt (nose at ${(r.maxAl + C.CAR_DIMS.police5.e1).toFixed(2)})`);

  // the AI's probes
  const [lx, lz] = west.w(0, 0), [colX, colZ] = west.w(DH - 0.6, COLS[6][1]);
  ok(!SI.solidAt(lx, lz, 0.95, 0), 'solidAt with no height: the roof is open (line of sight, hiding places)');
  ok(!SI.solidAt(lx, lz, 0.95, 0, false, carH('police1')) && !SI.solidAt(lx, lz, 1.45, 0, false, carH('police4')), 'solidAt for a patrol car that fits: open');
  ok(SI.solidAt(lx, lz, 1.65, 0, false, carH('police5')) && SI.solidAt(lx, lz, 1.3, 0, false, carH('garbage')), 'solidAt for the Juggernaut and the garbage truck: a wall');
  ok(SI.solidAt(lx, lz, 0.95, 0, false, H + 1e-6) && !SI.solidAt(lx, lz, 0.95, 0, false, H), 'the roof is a wall above its headroom and open up to it');
  ok(SI.solidAt(colX, colZ, 0.3, 0) && SI.solidAt(colX, colZ, 0.3, 0, false, 1.66), 'a column is a wall to every car');

  // a pursuer's look-ahead (policeAI) carries its height: heading for the mouth with the player in under the frame, a
  // patrol car drives on in, and the Juggernaut sees the first floor as a wall in its path and turns off
  const Pol = await import('../../js/police.js');
  const [plx, plz] = west.w(0, 8);
  Object.assign(S.player, V.createCar('player', plx, plz, west.head(1), PLAYER_PARAMS, 0xffc21a), { boost: 0 });
  for (const [tier, kind, avoids] of [[1, 'police1', false], [3, 'police3', false], [4, 'police4', false], [5, 'police5', true]]) {
    const [x, z] = west.w(0, -LH - 9), p = Pol.makePoliceUnit(tier, x, z, west.head(1), kind);
    p.vx = Math.sin(p.h) * 15; p.vz = Math.cos(p.h) * 15; p.vf = 15; p.steer = 0; p.navT = 9; p.stuckT = 0;
    const inp = Pol.policeAI(p, DT);
    ok(avoids ? inp.throttle < 1 : inp.throttle === 1,
      `${kind} heading for the mouth: ${avoids ? 'sees the first floor in its way and backs off' : 'drives on in'} (throttle ${inp.throttle})`);
    V.removeCar(p);
  }
}

// carHeight: the model's top, cached by kind; each car carries its own
{
  ok(Math.abs(carH('police5') - 3.25) < 1e-6, `the Juggernaut's height is its light bar's top (${carH('police5')})`);
  ok(Math.abs(carH('player') - 1.66) < 0.01, `the player's car is 1.66 m tall (${carH('player').toFixed(3)})`);
  const a = C.buildCar('police3', 0xffffff), b = C.buildCar('police3', 0xffffff);
  a.position.y = 7; b.scale.setScalar(3);
  ok(C.carHeight('police3', a) === C.carHeight('police3', b), 'carHeight is taken once a kind');
  const c = car('police5', 0, 0, 0), d = car('policeMoto', 5, 0, 0);
  ok(c.height === carH('police5') && d.height === carH('policeMoto'), 'every car carries its height (createCar)');
  V.removeCar(c); V.removeCar(d);
  for (const k of Object.keys(C.CAR_DIMS)) { const h = carH(k); ok(h > 1 && h < 4.5, `${k}: a height in reason (${h.toFixed(2)})`); }
}

// ---------------------------------------------------------------------------------------------------------------
// The chase camera
// ---------------------------------------------------------------------------------------------------------------
const P = S.player;
Object.assign(P, V.createCar('player', 0, 0, 0, PLAYER_PARAMS, 0xffc21a)); S.cars.push(P);
P.boost = 0;
const settle = (x, z, h, v) => {
  Object.assign(P, { x, z, h, y: 0, vx: Math.sin(h) * v, vz: Math.cos(h) * v, speed: v });
  Object.assign(Cam.camState, { h, roofY: Infinity, duck: 0 });
  Cam.camState.pos.set(x - Math.sin(h) * (14 + v * 0.11), 8 + v * 0.05, z - Math.cos(h) * (14 + v * 0.11));
  Cam.camState.look.set(x + Math.sin(h) * 7, 1.5, z + Math.cos(h) * 7);
  camera.position.copy(Cam.camState.pos);
};
const step = () => { P.x += P.vx * DT; P.z += P.vz * DT; S.game.time += DT; Cam.updateCamera(DT); };
{
  // far from any roof: the camera it always was (its own formula, step by step)
  W.updateChunks(3, -24, 999);
  S.game.shake = 0;
  settle(3, -40, 0.4, 18); P.h = 0.9;                   // turning: the boom swings round behind the car
  const st = { h: 0.4, pos: Cam.camState.pos.clone() };
  let worst = 0;
  for (let k = 0; k < 90; k++) {
    step();
    const sp = P.speed;
    st.h += (((P.h - st.h + Math.PI) % (2 * Math.PI)) - Math.PI) * (1 - Math.exp(-DT * 3.2));
    const dist = 14 + sp * 0.11, height = 8 + sp * 0.05, a = 1 - Math.exp(-DT * 8);
    st.pos.x += (P.x - Math.sin(st.h) * dist - st.pos.x) * a; st.pos.z += (P.z - Math.cos(st.h) * dist - st.pos.z) * a;
    st.pos.y += (height - st.pos.y) * (1 - Math.exp(-DT * 3));
    worst = Math.max(worst, st.pos.distanceTo(camera.position));
  }
  ok(worst < 1e-9, `far from a frame the camera is the chase camera it always was (off by ${worst.toExponential(1)} m)`);
  ok(Cam.camState.roofY === Infinity && Cam.camState.duck === 0, 'and nothing holds it down');
}
const roofOf = f => allSolids().find(s => s.headroom !== undefined && s.x === f.x && s.z === f.z);
// drives the player's car (moved straight down the lane, no physics) through frame f from 30 m out to 70 m past it,
// with the real camera following, and measures the camera frame by frame
function camRun(f, dir, v, { shake = 0 } = {}) {
  const roof = roofOf(f), [x0, z0] = f.w(0, -dir * (LH + 30)), h = f.head(dir);
  settle(x0, z0, h, v);
  for (let k = 0; k < 30; k++) step();                  // 0.5 s on the road before the frame
  const lim = roof.headroom - ROOF_GAP, hard = roof.headroom - Cam.ROOF_CLEAR;
  const r = { occluded: 0, worstLine: -9, worstHard: -9, worstSoft: -9, settled: 0, maxDy: 0, minY: 99, pulled: 9, nan: false, upAfter: null, ducked: false, entries: 0 };
  const flat0 = Math.hypot(camera.position.x - P.x, camera.position.z - P.z);   // the boom out on the road, lag and all
  let prev = camera.position.y, outT = null, both = 0, wasIn = false;
  for (let k = 0; k < Math.round((2 * LH + 100) / v / DT); k++) {
    S.game.shake = shake;
    step();
    const cp = camera.position, [, al] = f.loc(P.x, P.z);
    if (![cp.x, cp.y, cp.z].every(Number.isFinite)) r.nan = true;
    const carIn = Math.abs(P.x - roof.x) <= roof.hx && Math.abs(P.z - roof.z) <= roof.hz;
    const camIn = Math.abs(cp.x - roof.x) <= roof.hx && Math.abs(cp.z - roof.z) <= roof.hz;
    // the line from the car's eye to the camera: where it leaves the roof's footprint it has to be under the slab
    if (carIn) {
      let t1 = 1;
      if (!camIn) {
        const dx = cp.x - P.x, dz = cp.z - P.z;
        for (const [d, p, c0, hh] of [[dx, P.x, roof.x, roof.hx], [dz, P.z, roof.z, roof.hz]]) if (Math.abs(d) > 1e-9) t1 = Math.min(t1, ((d > 0 ? c0 + hh : c0 - hh) - p) / d);
      }
      const yLine = P.y + EYE + t1 * (cp.y - P.y - EYE);
      r.worstLine = Math.max(r.worstLine, yLine - roof.headroom);
      if (yLine > roof.headroom) r.occluded++;
      r.pulled = Math.min(r.pulled, Math.hypot(cp.x - P.x, cp.z - P.z) / flat0);
    }
    if (camIn) { r.ducked = true; r.worstHard = Math.max(r.worstHard, cp.y - hard); }
    if (camIn && !wasIn) r.entries++;
    wasIn = camIn;
    both = camIn && carIn ? both + 1 : 0;
    if (both > 18) { r.worstSoft = Math.max(r.worstSoft, cp.y - lim); r.settled++; }   // settled: 0.3 s with the two of them under it
    r.maxDy = Math.max(r.maxDy, Math.abs(cp.y - prev)); prev = cp.y;
    r.minY = Math.min(r.minY, cp.y);
    if (outT === null && r.ducked && !camIn && dir * al > LH) outT = k;
    if (outT !== null && k === outT + 60) r.upAfter = cp.y;
  }
  S.game.shake = 0;
  return r;
}
{
  W.updateChunks(-320, -290, 999);
  const west = framesOf(-4, -4)[0], east = framesOf(-5, -4)[0];
  W.updateChunks(-290, 480, 999);
  const xf = framesOf(-4, 6)[0];
  for (const [f, dirs] of [[west, [1, -1]], [east, [1]], [xf, [1, -1]]]) {
    W.updateChunks(f.x, f.z, 999);
    for (const dir of dirs) for (const v of [4, 8, 20, 40]) {
      const tag = `camera through ${f.x},${f.z} (${f.ax}, ${dir > 0 ? '+' : '-'}) at ${v} m/s`;
      const r = camRun(f, dir, v);
      ok(!r.nan, `${tag}: a number`);
      ok(r.occluded === 0, `${tag}: the line to the car never goes through the first floor (worst ${r.worstLine.toFixed(2)} m over its underside, ${r.occluded} frames)`);
      ok(r.worstHard <= 1e-9, `${tag}: under the roof, never nearer the slab than ROOF_CLEAR (${r.worstHard.toFixed(3)} over)`);
      // (at 40 m/s the car is out at the far end before the camera has been under the roof with it for 0.3 s)
      if (v <= 20) ok(r.settled > 10 && r.worstSoft <= 0.01, `${tag}: settled under it at the slab less ROOF_GAP, within a centimetre (${r.worstSoft.toFixed(3)} over, ${r.settled} frames)`);
      ok(r.minY <= H - ROOF_GAP + 1e-3 && r.ducked, `${tag}: it comes down under the first floor (lowest ${r.minY.toFixed(2)} m)`);
      ok(r.maxDy < 0.6, `${tag}: without a jump (at most ${r.maxDy.toFixed(3)} m a frame)`);
      ok(r.pulled < 0.85, `${tag}: the boom is pulled in under the roof (${(100 * r.pulled).toFixed(0)}% of its length out on the road)`);
      ok(r.upAfter !== null && r.upAfter > 6, `${tag}: back up a second after it is out (${r.upAfter === null ? 'never out' : r.upAfter.toFixed(2) + ' m'})`);
      ok(r.entries === 1, `${tag}: under the roof once, not in and out at its far end (${r.entries} times)`);
    }
  }
  W.updateChunks(west.x, west.z, 999);
  // a camera that swings in over a frame with the car beside it (in the alley) is under the first floor at once
  {
    const [ax, az] = west.w(-DH - 1, 0);
    settle(ax, az, west.head(1), 6);
    Cam.camState.pos.set(west.x, 9, az - 8); camera.position.copy(Cam.camState.pos);
    step();
    ok(camera.position.y <= H - Cam.ROOF_CLEAR + 1e-9, `a camera that swings in over a frame is under the first floor at once (${camera.position.y.toFixed(2)} m)`);
  }
  const r = camRun(west, 1, 20, { shake: 0.8 });
  ok(r.worstHard <= 1e-9 && r.occluded === 0, `a shake does not lift the camera into the slab (${r.worstHard.toFixed(3)} over)`);
  // the limit itself: nothing for a car out in the open, the slab less ROOF_GAP with the camera under the roof
  const [ox, oz] = west.w(0, -LH - 25), [ix, iz] = west.w(0, 0), [cx2, cz2] = west.w(0, -8);
  ok(Cam.roofLimit(ox, oz, EYE, ox, oz - 15).y === Infinity, 'roofLimit: Infinity in the open');
  const both = Cam.roofLimit(ix, iz, EYE, cx2, cz2);
  near(both.y, H - ROOF_GAP, 1e-9, 'roofLimit: the slab less ROOF_GAP with both under the roof');
  near(both.cam, H - Cam.ROOF_CLEAR, 1e-9, 'roofLimit: and the slab less ROOF_CLEAR over the camera');
  const [ex, ez] = west.w(0, -LH - 6), lim = Cam.roofLimit(ix, iz, EYE, ex, ez);
  near(lim.y, EYE + (H - ROOF_GAP - EYE) * (LH + 6) / LH, 1e-9, 'roofLimit: on the line through the roof\'s edge with the camera out in front');
  ok(lim.car === true && lim.cam === Infinity && Cam.roofLimit(ex, ez, EYE, ex, ez - 1).car === false, 'roofLimit tells a car under the roof from one in front of it');
}

console.log(`site passage: ${checks} checks PASSED`);
process.exit(0);
