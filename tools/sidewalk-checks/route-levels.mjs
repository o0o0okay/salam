/* The map's road route round the interchanges (js/map.js: roadRoute, currentRoute). An interchange has two roads, one
   above the other: the deck road (the main road's own carriageway, up its ramps and over the deck) and the ground road
   (the at-grade lane on each side of the structure, which crosses the street under the deck at grade). They meet only at
   the junctions beyond the ramps' feet, and the route has to keep them apart. For every interchange on both main roads
   (plain flyovers and long bridges), on both sides of the structure, from cars all round it:
   * a mark on the at-grade lane beside a ramp or the deck gets a route that ends on that lane, on the mark's own side, at
     grade: never one up the ramp or onto the deck above it (the pin beside a ramp used to be routed up onto the ramp);
   * a mark on a ramp or on the deck gets a route that ends on the deck road, up on the structure;
   * a mark on the street under the deck gets a route that ends on that street;
   * a route changes level only at grade: where one piece of it is up on the structure, so is the next, so it never steps
     sideways from a lane onto a ramp, or off the deck; and no piece at grade runs through a ramp's embankment (the only
     ground under the structure a route may use is the junction box under the deck);
   * a car up on the deck starts on the deck road; a car on the lane, or at grade under a deck, starts on the ground and
     does get a route (the lane is 15 m out from the main road's centre line, further than a car's step onto a street);
   * the route kept for a mark is given up when the car is on the other level: a car that has driven up the ramp is not
     taken to be on the route along the lane beside it, so a new route is planned from the deck;
   * away from the interchanges the route is the plain grid's: along one street it is the distance along it, and across
     the spawn district (a full grid) it is the Manhattan distance.
   Run:  node tools/sidewalk-checks/route-levels.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const F = await import('../../js/flyover.js');
const M = await import('../../js/map.js');
const { player } = await import('../../js/state.js');
const { CHUNK } = await import('../../js/utils.js');
const { CORE } = await import('../../js/island.js');
const { FLY } = F;

const UP_MIN = 0.05;                                       // as js/map.js: the last centimetres of a ramp's foot are at grade
const LANE = F.laneOffset();
const height = (x, z) => { const f = F.flyoverNear(x, z); return f ? F.bridgeHeight(f, F.alongOf(f, x, z)) : 0; };
// Is the route up on the structure at (x, z) on its piece k? Only a deck piece climbs, where the structure is.
const upAt = (r, k, x, z) => r.deck[k] && height(x, z) > UP_MIN;
const fmt = (x, z) => `(${x.toFixed(1)}, ${z.toFixed(1)})`;
let routes = 0, checks = 0;

function checkLevels(r, what) {
  assert.equal(r.deck.length, r.pts.length - 1, `${what}: one level flag per piece`);
  for (let k = 1; k < r.deck.length; k++) {
    const [x, z] = r.pts[k];
    assert.equal(upAt(r, k - 1, x, z), upAt(r, k, x, z), `${what}: the route changes level at ${fmt(x, z)}, which is not at grade`);
  }
  for (let k = 0; k < r.deck.length; k++) {
    const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 2));
    for (let s = 0; s <= n; s++) {
      const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n, h = height(x, z);
      if (!r.deck[k] && h > UP_MIN) assert(Math.abs(h - FLY.deckH) < 1e-6, `${what}: a piece at grade runs through a ramp's embankment at ${fmt(x, z)} (${h.toFixed(2)} m up)`);
    }
  }
  checks++;
}
function route(from, to, what) {
  const r = M.roadRoute(from, to);
  assert(r, `${what}: no route`);
  checkLevels(r, what);
  routes++;
  return r;
}

// Every interchange: the record, its frame, its junctions and its two ramps.
const flys = [];
for (let k = -CORE; k <= CORE; k++) {
  for (const f of [F.nodeAt(k, 0), F.nodeAt(0, k)]) if (f && !flys.includes(f)) flys.push(f);
}
assert(flys.length >= 8, `only ${flys.length} interchanges found`);
assert(flys.some(f => f.ext > 0), 'no long bridge among the interchanges');
const world = (f, u, v) => (f.axis === 'x' ? { x: u, z: v } : { x: v, z: u });   // u: the world coordinate along the main road

for (const f of flys) {
  const g = Math.sign(f.node);
  const lo = f.node + f.lo, hi = f.node + f.hi;           // the bridge's first and last junction, along the road
  const juncs = [];
  for (let k = 0; k <= f.ext; k++) juncs.push(f.node + g * k * CHUNK);
  const rampMid = [lo - (FLY.deckHalf + FLY.rampEnd) / 2, hi + (FLY.deckHalf + FLY.rampEnd) / 2];
  const deckMid = f.ext > 0 ? [(lo + hi) / 2 + CHUNK / 4] : [];
  const tag = `interchange ${f.axis}=${f.node}${f.ext ? ` (long, ${f.ext + 1} junctions)` : ''}`;
  // the cars, all at grade on streets that are always open (a main road, or a street's first block off one): out along the
  // main road two blocks beyond each ramp, and on the cross streets of the junctions beside the bridge, one each side
  const starts = [
    { ...world(f, lo - 2 * CHUNK + 10, 2), y: 0, name: 'on the main road, beyond the near ramp' },
    { ...world(f, hi + 2 * CHUNK - 10, -2), y: 0, name: 'on the main road, beyond the far ramp' },
    { ...world(f, lo - CHUNK, 50), y: 0, name: 'on the cross street beside the near ramp, + side' },
    { ...world(f, hi + CHUNK, -50), y: 0, name: 'on the cross street beside the far ramp, - side' },
  ];
  for (const s of [1, -1]) for (const u of [...rampMid, ...deckMid]) {
    const lane = world(f, u, s * 19), deck = world(f, u, s * 3);
    for (const st of starts) {
      // the mark on the lane beside the structure: the route ends on that lane, at grade, on the mark's side
      const what = `${tag}: car ${st.name}, mark on the ${s > 0 ? '+' : '-'} lane at u ${u - f.node}`;
      let r = route(st, lane, what);
      let [ex, ez] = r.pts[r.pts.length - 1], ev = F.latOf(f, ex, ez);
      assert(height(ex, ez) <= UP_MIN, `${what}: the route ends up on the structure at ${fmt(ex, ez)} (${height(ex, ez).toFixed(2)} m up)`);
      assert(!r.deck[r.deck.length - 1], `${what}: the route ends on the deck road`);
      assert(Math.sign(ev) === s && Math.abs(Math.abs(ev) - LANE) < 0.5, `${what}: the route ends at ${fmt(ex, ez)}, not on the lane the mark is beside`);
      // the mark on the ramp or the deck itself: the route ends up there, on the deck road
      const wd = `${tag}: car ${st.name}, mark on the structure at u ${u - f.node}`;
      r = route(st, deck, wd);
      [ex, ez] = r.pts[r.pts.length - 1];
      assert(height(ex, ez) > UP_MIN && r.deck[r.deck.length - 1], `${wd}: the route ends at ${fmt(ex, ez)}, not on the deck road`);
    }
  }
  // the streets under the deck: a mark on one is reached on it, at grade
  for (const J of juncs) for (const s of [1, -1]) {
    const mk = world(f, J, s * 40), what = `${tag}: mark on the street under the deck at ${J}, ${s > 0 ? '+' : '-'} side`;
    for (const st of starts) {
      const r = route(st, mk, `${what}, car ${st.name}`);
      const [ex, ez] = r.pts[r.pts.length - 1];
      assert(Math.hypot(ex - mk.x, ez - mk.z) < 0.5, `${what}: the route ends at ${fmt(ex, ez)}, not at the mark ${fmt(mk.x, mk.z)}`);
    }
  }
  // the cars round the structure, to a mark two blocks out to the side (at grade)
  const far = world(f, juncs[0] + 1.5 * CHUNK, 2 * CHUNK);
  const ground = (car, name) => {
    const what = `${tag}: car ${name}`;
    const r = route(car, far, what);
    assert(!upAt(r, 0, car.x, car.z), `${what}: the route starts up on the structure`);
    return r;
  };
  for (const s of [1, -1]) {
    // on the lane beside each ramp (15 m out from the centre line: the old route found no street near enough)
    for (const u of rampMid) ground({ ...world(f, u, s * LANE), y: 0 }, `on the ${s > 0 ? '+' : '-'} lane beside the ramp at u ${u - f.node}`);
    // at grade in the junction box under the deck
    ground({ ...world(f, juncs[0] + 3, s * 2), y: 0 }, `at grade under the deck, ${s > 0 ? '+' : '-'} side`);
    // up on the deck, over the junction: the route starts on the deck road and comes down a ramp
    const top = { ...world(f, juncs[0] + 3, s * 2.5), y: FLY.deckH }, what = `${tag}: car up on the deck, ${s > 0 ? '+' : '-'} side`;
    const r = route(top, far, what);
    assert(upAt(r, 0, top.x, top.z), `${what}: the route does not start on the deck road`);
  }
  for (const u of deckMid) ground({ ...world(f, u, 0), y: 0 }, `at grade under the long span at u ${u - f.node}`);
}

// The live route (currentRoute): planned from the car, kept while the car follows it, and given up for a new one when the car
// is on the other level. The pin beside the near ramp of the first plain flyover, the car out on the main road.
{
  const f = flys.find(q => q.ext === 0 && q.node > 0), g = Math.sign(f.node);
  const uRamp = f.node - g * (FLY.deckHalf + FLY.rampEnd) / 2;           // the middle of the ramp on the centre's side
  const pin = M.setMark(...Object.values(world(f, uRamp, -19)));
  const put = (u, v, y) => Object.assign(player, world(f, u, v), { y, h: 0 });
  put(f.node - g * 3 * CHUNK, 2, 0);
  let r = M.currentRoute();
  assert(r, 'currentRoute: no route to the pin beside the ramp');
  let e = r.base.pts[r.base.pts.length - 1];
  assert(height(e[0], e[1]) <= UP_MIN && F.latOf(f, e[0], e[1]) < -LANE + 0.5, 'currentRoute: the route to the pin beside the ramp does not end on its lane');
  const base = r.base;
  // the car drives on along the main road towards the bridge: the same route is kept
  put(f.node - g * 2 * CHUNK, 2, 0);
  assert.equal(M.currentRoute().base, base, 'currentRoute: the route was planned again while the car drove along it');
  // the car goes up the ramp instead of out into the lane: 7 m up the ramp, 5 m off the centre line, which on the map is only
  // 10 m from the route along the lane below it. That route is not its route any more, and the new one starts on the deck road
  const uUp = f.node - g * (FLY.rampEnd - 7);
  put(uUp, -5, F.bridgeHeight(f, F.alongOf(f, ...Object.values(world(f, uUp, 0)))));
  r = M.currentRoute();
  assert(r && r.base !== base, 'currentRoute: a car up on the ramp kept the route along the lane beside it');
  assert(r.base.deck[0], 'currentRoute: the new route of a car up on the ramp does not start on the deck road');
  checkLevels(r.base, 'currentRoute from the ramp');
  e = r.base.pts[r.base.pts.length - 1];
  assert(height(e[0], e[1]) <= UP_MIN, 'currentRoute: from the ramp, the route still ends up on the structure');
  M.clearMark();
  void pin;
}

// The arrows on the road (js/routeArrows.js) lie on the road the route is on: up on the structure only along the deck road,
// at grade along the lane beside a ramp and under a deck, however close that is to the structure.
{
  const A = await import('../../js/routeArrows.js');
  const { scene } = await import('../../js/renderer.js');
  const f = flys.find(q => q.ext === 0 && q.node > 0), g = Math.sign(f.node);
  const uRamp = f.node - g * (FLY.deckHalf + FLY.rampEnd) / 2;
  const arrows = () => scene.children.filter(m => m.isMesh && m.visible && m.geometry && m.geometry.type === 'PlaneGeometry' && m.renderOrder === 2);
  const show = (car, pin, what) => {
    Object.assign(player, car, { h: 0 });
    M.setMark(pin.x, pin.z);
    A.updateRouteArrows();
    const list = arrows();
    assert(list.length > 0, `arrows, ${what}: none shown`);
    M.clearMark();
    A.updateRouteArrows();                                   // hides them again
    return list.map(m => ({ x: m.position.x, y: m.position.y, z: m.position.z }));
  };
  const out = { ...world(f, f.node - g * 3 * CHUNK, 2), y: 0 };
  // the pin beside the ramp: every arrow at grade
  let list = show(out, world(f, uRamp, -19), 'to the pin beside the ramp');
  for (const a of list) assert(a.y < 0.5, `arrows, to the pin beside the ramp: an arrow is ${a.y.toFixed(2)} m up at ${fmt(a.x, a.z)}`);
  // the pin on the ramp: the arrows climb it, and only on the structure
  list = show(out, world(f, uRamp, 0), 'to the pin on the ramp');
  assert(list.some(a => a.y > 1), 'arrows, to the pin on the ramp: none of them is up on the ramp');
  for (const a of list) if (a.y > 0.5) assert(height(a.x, a.z) > UP_MIN, `arrows, to the pin on the ramp: an arrow ${a.y.toFixed(2)} m up off the structure at ${fmt(a.x, a.z)}`);
  // a car at grade under the deck, at the edge of the junction box, to a pin on the street under it, just out of the deck's
  // outline: the route runs under the deck along the main road's line before it turns, and every arrow on it is at grade
  // (the arrows used to be lifted onto the deck wherever a route ran along the flyover over its footprint)
  list = show({ ...world(f, f.node + 11.9, 0), y: 0 }, world(f, f.node, 14), 'from under the deck');
  assert(list.some(a => height(a.x, a.z) > UP_MIN), 'arrows, from under the deck: no arrow under the deck (the case is not exercised)');
  for (const a of list) assert(a.y < 0.5, `arrows, from under the deck: an arrow is ${a.y.toFixed(2)} m up at ${fmt(a.x, a.z)}`);
  checks += 3;
}

// Away from the interchanges the route is the grid's: along one street it is the distance along it, and in the spawn district
// (junctions within 3 of the centre are four-way, js/flyover.js CLOSE_CLEAR) it is the Manhattan distance between two streets.
{
  let r = route({ x: 10, z: 160, y: 0 }, { x: 70, z: 160 }, 'along one street');
  assert(Math.abs(r.len - 60) < 1e-6, `along one street: ${r.len} m, want 60 m`);
  r = route({ x: 40, z: 80, y: 0 }, { x: 160, z: 200 }, 'across the spawn district');
  assert(Math.abs(r.len - 240) < 1e-6, `across the spawn district: ${r.len} m, want 240 m`);
  r = route({ x: -200, z: 0, y: 0 }, { x: 110, z: -160 }, 'across the spawn district, the other way');
  assert(Math.abs(r.len - 470) < 1e-6, `across the spawn district, the other way: ${r.len} m, want 470 m`);
}

// The case from the screenshot: the car on the avenue just south of the cross street, the pin on the at-grade lane south of
// the near ramp of the flyover at x = -400. The route runs along the cross street, out into the lane past the nose guards,
// and ends on the lane beside the ramp, at grade.
{
  const r = route({ x: 3.7, z: -23, y: 0 }, { x: -365.5, z: -19.5 }, 'the screenshot case');
  const [ex, ez] = r.pts[r.pts.length - 1];
  assert(Math.abs(ex + 365.5) < 0.5 && Math.abs(ez + LANE) < 0.5, `the screenshot case: the route ends at ${fmt(ex, ez)}, not on the lane at (-365.5, -15)`);
  assert(!r.deck.some((d, k) => upAt(r, k, ...r.pts[k + 1])), 'the screenshot case: the route goes up onto the structure');
}

console.log(`route levels: ${flys.length} interchanges (${flys.filter(f => f.ext).length} long bridges), ${routes} routes, ${checks} level checks`);
console.log('ALL ROUTE CHECKS PASSED');
process.exit(0);
