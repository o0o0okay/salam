/* The police hold a pinned player for the arrest (js/police.js pinHold and holdPin, js/update.js, js/collisions.js satGap
   and solidWithin, PIN_HOLD in js/config.js):
   * what a unit does while he is held: a unit near him comes in with whichever end is towards him (nose first, or
     backing in tail first), slower the nearer it gets, and stops right up against him; arrived, it stands, and one still
     rolling onto him pulls up without rocking back and forth (at 60 fps and at 30); one with him at its side stands where
     it is; knocked back off him it comes straight back in; one coming in fast brakes (a brake, not a reverse); the
     recoil after a hit and the stuck reverse never happen, and one already reversing stops; one further out comes for
     him no faster than it could stop on him; a unit up on a deck over him, a unit once the hold is over and a unit on
     the menu's attract mode do what they always did; the hold lasts PIN_HOLD.grace after the last pinned frame;
   * satGap and solidWithin: the gap between two boxes face to face, side by side, overlapping, turned and corner to
     corner; a solid near a car, one taken away, a roof it fits under or not, a wall under the deck it is on;
   * the bar: while he is held, a car within PIN_HOLD.gap of him counts as touching him and so does a wall within it, a
     car further off or on a deck over him does not; before he is first pinned nothing has changed (touching is touching);
   * the chase, with the game's own update loop, each in a process of its own: boxed in by three units he is busted in
     DIFF.pin, the bar never dropping, whether he sits still or throws the car back and forth; rammed into the wall and
     boxed by three patrol units, three Enforcers or two Juggernauts he is busted, not hurt once they have him and with no
     unit backing off him for another run, nearly always in DIFF.pin; a player with a way out drives out, the hold ends
     and the chase goes on.
   Run:  node tools/sidewalk-checks/pin-hold.mjs      (exits non-zero on a failure; PIN_HOLD_SHOW=1 prints each chase) */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
// The chunk baker works to a wall-clock budget, and the AI and the world draw on Math.random: a fixed clock and a fixed
// sequence (set afresh for every run) make every run the same.
performance.now = () => 0;
let seed = 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const THREE = await import('three');
const R = await import('../../js/renderer.js');
const S = await import('../../js/state.js');
const F = await import('../../js/flow.js');
const U = await import('../../js/update.js');
const PO = await import('../../js/police.js');
const V = await import('../../js/vehicle.js');
const Col = await import('../../js/collisions.js');
const W = await import('../../js/world.js');
const { wrapAngle, ck, CHUNK } = await import('../../js/utils.js');
const { chunks } = await import('../../js/chunkState.js');
const { DIFF, PIN_HOLD } = await import('../../js/config.js');
const { CAR_DIMS } = await import('../../js/carModels.js');
R.scene.background = new THREE.Color(0x9ad5ff); R.scene.fog = new THREE.Fog(0x9ad5ff, 95, 215);   // the stub scene has neither
const DT = 1 / 60, P = S.player, game = S.game, RECOIL = 0.7 / DIFF.aggr;
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
// the gap between two boxes, box to box (the test's own, so a chase can be scored on the game before this change too)
function boxGap(A, B) {
  let g = -Infinity;
  for (const [ax, az] of [[A.ux, A.uz], [A.vx, A.vz], [B.ux, B.uz], [B.vx, B.vz]]) {
    const r = C => C.e1 * Math.abs(C.ux * ax + C.uz * az) + C.e2 * Math.abs(C.vx * ax + C.vz * az);
    g = Math.max(g, Math.abs((B.x - A.x) * ax + (B.z - A.z) * az) - r(A) - r(B));
  }
  return g;
}
const gapTo = c => boxGap(V.carBox(c), V.carBox(P));
const HOLD_R = PIN_HOLD ? PIN_HOLD.hold : 5, GRACE = PIN_HOLD ? PIN_HOLD.grace : 0.6;
const held = () => (PO.pinHold ? PO.pinHold() : false);

// A new run, the traffic cleared off the street, the player's car nose on to the east face of the block at (-26,-26)
// (x = -16.5), facing west into it. `off` is how far his nose is from the wall.
let WALL = null;
function fresh(sd, off = 0.02) {
  seed = sd; game.t = 0;                                       // (a new run restarts every clock that runs on game.t)
  game.state = 'menu'; F.startGame();
  for (const c of S.civs.slice()) V.removeCar(c);
  if (!WALL) {
    WALL = W.solidsNear(-16.5, -26, 4, []).find(s => !s.headroom && Math.abs(s.x + s.hx + 16.5) < 0.05 && s.z - s.hz < -34 && s.z + s.hz > -18);
    ok(WALL, 'the block at (-26,-26) is there, its east face at x = -16.5, from z = -34 to -18 at least');
  }
  Object.assign(P, { x: WALL.x + WALL.hx + P.box.e1 + off, z: -26, h: -Math.PI / 2, vx: 0, vz: 0, speed: 0, vf: 0, vl: 0, steer: 0 });
  globalThis.__input = undefined;
}
const X0 = () => WALL.x + WALL.hx + P.box.e1;               // where his centre is when his nose is on the wall
function unit(tier, kind, role, x, z, h, v = 0, flank = 1) {
  const p = PO.makePoliceUnit(tier, x, z, h, kind);
  p.role = role; p.flank = flank; p.vx = Math.sin(h) * v; p.vz = Math.cos(h) * v; p.vf = v; p.speed = v;
  S.police.push(p); S.cars.push(p); return p;
}
// a unit placed `gap` behind the player's tail, nose on to him (or `tail`: its own tail on to him)
const behind = (tier, kind, gap, tail = false, v = 0) =>
  unit(tier, kind, 'chaser', P.x + P.box.e1 + CAR_DIMS[kind].e1 + gap, P.z, tail ? Math.PI / 2 : -Math.PI / 2, tail ? -v : v);
// one step of a unit's AI with the player held (game.pinSeen now) or not
function decide(p, isHeld = true) {
  game.pinSeen = isHeld ? game.time : -99;
  S.sight.t = game.t; S.sight.x = P.x; S.sight.z = P.z;      // the police can see him
  return PO.policeAI(p, DT);
}
function step(n = 1, each) {
  for (let i = 0; i < n; i++) {
    game.spawnT = 99; game.civT = 99; game.spikeT = 99; game.roadblockT = 99;   // nobody else joins in
    if (each && each(i) === false) return false;
    U.update(DT);
    if (game.state !== 'playing') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The chases (run further down, each in a process of its own)
// ---------------------------------------------------------------------------------------------------------------
// The update loop for up to `secs`, keeping the score: the first pinned frame, BUSTED, the bar dropping, and any unit
// holding him that is counting down a recoil or reversing out of a stuck.
function chaseRun(sd, setupUnits, secs, input) {
  fresh(sd);
  const us = setupUnits();
  const r = { first: -1, busted: -1, end: '', drops: 0, backoff: [], hp: 100 };
  let prev = 0, filled = -99;
  for (let f = 0; f < secs * 60; f++) {
    game.spawnT = 99; game.civT = 99; game.spikeT = 99; game.roadblockT = 99;
    if (input) input(f * DT);
    // the units at him as this frame starts, the bar having filled within the hold's grace: on his level and
    // PIN_HOLD.hold or nearer, box to box
    const holders = f * DT - filled < GRACE ? us.filter(u => !u.wrecked && Math.abs(u.y - P.y) <= 2 && gapTo(u) < HOLD_R) : [];
    U.update(DT);
    if (game.state !== 'playing') { r.busted = f * DT; r.end = game.reason; break; }
    if (game.pin > prev) filled = f * DT;
    if (game.pin > 0 && r.first < 0) r.first = f * DT;
    if (r.first >= 0 && game.pin < prev - 1e-9) r.drops++;
    prev = game.pin;
    for (const u of holders) {
      // carCar sets a fresh recoil after the AI has run, and the next AI step clears it: counting down is acting on it
      if ((u.recoilT > 1e-9 && u.recoilT < RECOIL - 1e-9) || u.reverseT > 0) r.backoff.push(`${u.kind} ${(f * DT).toFixed(2)}s (recoil ${u.recoilT.toFixed(2)}, reverse ${u.reverseT.toFixed(2)})`);
    }
  }
  r.hp = game.hp;
  return r;
}
// the player throws the car about once the bar is filling: back and to one side, forward and to the other, 0.7 s each
const wriggle = () => {
  let t0 = -1;
  return t => {
    if (t0 < 0 && game.pin > 0.3) t0 = t;
    globalThis.__input = t0 < 0 ? undefined : [{ throttle: -1, steer: 1 }, { throttle: 1, steer: -1 }, { throttle: -1, steer: -1 }, { throttle: 1, steer: 1 }][Math.floor((t - t0) / 0.7) % 4];
  };
};
// boxed in already: his nose on the wall, a unit on his tail and one at either side, nose on to him
const box = (tail, sides) => () => {
  const px = X0() + 0.02, half = k => CAR_DIMS[k].e1;
  const us = [unit(+tail.slice(-1) || 4, tail, 'rammer', px + P.box.e1 + half(tail) + 0.05, -26, -Math.PI / 2)];
  sides.forEach((k, i) => us.push(unit(+k.slice(-1) || 4, k, i ? 'pincer' : 'headon', px - 0.3, -26 + (i ? -1 : 1) * (P.box.e2 + half(k) + 0.05), i ? 0 : Math.PI, 0, i ? -1 : 1)));
  return us;
};
// rammed into the wall and boxed: the units come in fast from three sides (two Juggernauts from two). Each run (j = -1,
// 0, 1) comes in a little differently: further out and faster from behind, slower and wider at the sides.
const RAM = {
  ram3: j => [
    unit(3, 'police3', 'interceptor', X0() + 26 + 2 * j, -26, -Math.PI / 2, 14 + j),
    unit(3, 'policeVan', 'pit', X0() + 1 + 0.4 * j, -4, Math.PI, 11 - 0.8 * j, 1),
    unit(3, 'police3', 'blocker', X0() + 1 + 0.4 * j, -48, 0, 11 - 0.8 * j, -1)],
  ram4: j => [
    unit(4, 'police4', 'rammer', X0() + 26 + 2 * j, -26, -Math.PI / 2, 14 + j),
    unit(4, 'police4', 'pincer', X0() + 1 + 0.4 * j, -4, Math.PI, 11 - 0.8 * j, 1),
    unit(4, 'policeVan', 'pinner', X0() + 1 + 0.4 * j, -48, 0, 11 - 0.8 * j, -1)],
  jugg: j => [
    unit(5, 'police5', 'headon', X0() + 26 + 2 * j, -26, -Math.PI / 2, 14 + j),
    unit(5, 'police5', 'pincer', X0() + 1 + 0.4 * j, -6, Math.PI, 11 - 0.8 * j, 1)],
};
// a way out: one unit at his side, the wall at his other, the road ahead open. He drives off at 2.2 s.
function escapeRun(sd) {
  fresh(sd);
  Object.assign(P, { h: Math.PI, x: WALL.x + WALL.hx + P.box.e2 + 0.02, z: -20 });   // along the wall, heading south
  const u = unit(1, 'police1', 'chaser', X0() + 22, -20, -Math.PI / 2, 12);
  const r = { pinnedBy: -1, fast: -1, free: -1, empty: -1, chasing: false, state: '', far: 0 };
  for (let f = 0; f < 7 * 60; f++) {
    game.spawnT = 99; game.civT = 99; game.spikeT = 99; game.roadblockT = 99;
    globalThis.__input = f * DT > 2.2 ? { throttle: 1, steer: 0 } : undefined;
    U.update(DT);
    if (game.state !== 'playing') break;
    const t = f * DT;
    if (r.pinnedBy < 0 && game.pin > 0.5) r.pinnedBy = t;
    if (r.pinnedBy >= 0 && r.fast < 0 && P.speed > 9) r.fast = t;
    if (r.fast >= 0 && r.free < 0 && !held()) r.free = t;
    if (r.fast >= 0 && r.empty < 0 && game.pin === 0) r.empty = t;
    r.far = Math.max(r.far, Math.hypot(P.x - u.x, P.z - u.z));
    if (r.free >= 0 && !r.chasing && u.speed > 12) r.chasing = t;
  }
  r.state = game.state;
  return r;
}
const CHASES = {
  'box-j-ee': sd => chaseRun(sd, box('police5', ['police4', 'police4']), 6),
  'box-j-j': sd => chaseRun(sd, box('police5', ['police5']), 6),
  'box-e-pv-w': sd => chaseRun(sd, box('police4', ['police3', 'policeVan']), 6, wriggle()),
  'box-j-ee-w': sd => chaseRun(sd, box('police5', ['police4', 'police4']), 6, wriggle()),
  ram3: sd => chaseRun(sd, () => RAM.ram3(sd - 2), 10),
  ram4: sd => chaseRun(sd, () => RAM.ram4(sd - 2), 10),
  jugg: sd => chaseRun(sd, () => RAM.jugg(sd - 2), 10),
  escape: sd => escapeRun(sd),
};
if (process.env.PIN_HOLD_CHASE) {                               // a child: one chase, its score, and out
  const [id, sd] = process.env.PIN_HOLD_CHASE.split(':');
  console.log('RESULT ' + JSON.stringify(CHASES[id](+sd)));
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------------
// What a unit does while he is held
// ---------------------------------------------------------------------------------------------------------------
{
  fresh(11);
  // nose on to him, 3 m off
  let u = behind(4, 'police4', 3);
  ok(Math.abs(gapTo(u) - 3) < 0.01, `the unit is 3 m behind him, box to box (${gapTo(u).toFixed(3)})`);
  let o = decide(u);
  ok(o.throttle > 0 && o.throttle <= 0.5 && !o.hand, `nose on and 3 m off, stopped: it comes in, on a light throttle (${o.throttle})`);
  u.vf = 15; u.vx = -15; u.vz = 0;
  o = decide(u);
  ok(o.throttle === -1 && u.vf > 0.8, `coming in at 15 m/s from 3 m out it brakes, and over 0.8 m/s throttle -1 is a brake (${o.throttle})`);
  const arrive = PIN_HOLD.close + PIN_HOLD.snug * PIN_HOLD.closeK + 0.6;
  ok(arrive < 9, `it gets there at no more than ${arrive.toFixed(1)} m/s, under the 9 m/s hit that sets off a recoil`);
  V.removeCar(u);
  // arrived: stands
  u = behind(4, 'police4', 0.05);
  o = decide(u);
  ok(o.throttle === 0, `right up against him (5 cm) and stopped, it stands: no push (throttle ${o.throttle})`);
  // still rolling onto him: it pulls up, never rocking back and forth. At 60 fps it comes to a stand; at 30 fps the
  // brake takes 2.3 m/s off in a frame, and from under that it coasts (into him) rather than be thrown back off him.
  for (const [v, fps] of [[0.5, 60], [0.7, 60], [1.0, 60], [2.0, 60], [-0.4, 60], [-1.0, 60], [0.7, 30], [1.0, 30], [1.6, 30], [3, 30], [-0.4, 30], [-1.0, 30]]) {
    Object.assign(u, { x: P.x + P.box.e1 + u.box.e1 + 0.05, z: P.z, h: -Math.PI / 2, vx: -v, vz: 0, vf: v, steer: 0 });
    let flips = 0, last = Math.sign(v), up = 0, prevS = Math.abs(v), back = 0;
    for (let i = 0; i < fps; i++) {
      game.pinSeen = game.time; S.sight.t = game.t;
      const x0 = u.x; V.driveCar(u, PO.policeAI(u, 1 / fps), 1 / fps); u.x = x0;   // (held where it is: no collisions here)
      const sg = Math.abs(u.vf) > 0.05 ? Math.sign(u.vf) : last;
      if (sg !== last) flips++;
      up = Math.max(up, Math.abs(u.vf) - prevS); last = sg; prevS = Math.abs(u.vf); back = Math.max(back, -Math.sign(v) * u.vf);
    }
    const stood = Math.abs(u.vf) <= 0.3;
    ok(flips <= 1 && up < 0.3 && back <= 0.35 && (fps === 30 || stood) && Math.abs(u.vf) <= Math.abs(v), `arrived and rolling at ${v} m/s, at ${fps} fps: it pulls up${stood ? ' to a stand' : ''}, never thrown the other way (${u.vf.toFixed(2)} m/s after 1 s, at most ${back.toFixed(2)} m/s the other way)`);
  }
  V.removeCar(u);
  u = behind(4, 'police4', 0.5, false, -0.6);
  o = decide(u);
  ok(o.throttle > 0, `knocked half a metre back off him it comes straight back in (throttle ${o.throttle})`);
  V.removeCar(u);
  // tail on to him: backs in
  u = behind(4, 'police4', 2, true);
  ok(Math.cos(wrapAngle(Math.atan2(P.x - u.x, P.z - u.z) - u.h)) < -0.9, 'this one has its tail to him');
  o = decide(u);
  ok(o.throttle === -1, `tail on and 2 m off, it backs in on him (throttle ${o.throttle})`);
  V.removeCar(u);
  // the recoil after a hit: not while he is held
  for (const isHeld of [true, false]) {
    u = behind(4, 'police4', 0);
    u.recoilT = RECOIL;
    o = decide(u, isHeld);
    if (isHeld) ok(o.throttle >= 0 && u.recoilT === 0, `hit him at 10 m/s and touching: held, no recoil (throttle ${o.throttle}, recoilT ${u.recoilT})`);
    else ok(o.throttle === -0.7 && u.recoilT > 0, `and the hold over, the recoil it always had (throttle ${o.throttle})`);
    V.removeCar(u);
  }
  // the stuck reverse: a Juggernaut nose on to his tail is 6 m centre to centre, over the stuck test's 5 m
  for (const isHeld of [true, false]) {
    u = behind(5, 'police5', 0.02);
    const d = Math.hypot(P.x - u.x, P.z - u.z);
    u.stuckT = 0.995;
    o = decide(u, isHeld);
    if (isHeld) ok(u.reverseT === 0 && u.stuckT === 0 && o.throttle >= 0, `a Juggernaut on his tail (${d.toFixed(1)} m centre to centre), slow with its foot down for 1 s: held, no stuck reverse (reverseT ${u.reverseT})`);
    else ok(u.reverseT > 0, `and the hold over, the stuck reverse it always had (reverseT ${u.reverseT})`);
    V.removeCar(u);
  }
  // already reversing out of a stuck when he is pinned: it stops reversing
  u = behind(4, 'police4', 1);
  u.reverseT = 0.5;
  o = decide(u);
  ok(o.throttle > 0 && u.reverseT === 0, `a unit backing out of a stuck as he is pinned comes back in instead (throttle ${o.throttle}, reverseT ${u.reverseT})`);
  V.removeCar(u);
  // further out: comes for him, no faster than it could stop on him
  u = behind(4, 'police4', 10);
  const cap = PIN_HOLD.close + 10 * PIN_HOLD.closeK;
  ok(PIN_HOLD.hold < 10 && Math.hypot(P.x - u.x, P.z - u.z) < PIN_HOLD.join, 'a unit 10 m off him is on its way, not holding him yet');
  u.vf = 30; u.vx = -30;
  o = decide(u);
  ok(o.throttle === -1, `10 m off at 30 m/s it brakes (the most there: ${cap.toFixed(1)} m/s)`);
  u.recoilT = RECOIL; u.vf = 12; u.vx = -12;
  o = decide(u);
  ok(o.throttle > 0 && u.recoilT === 0, `10 m off at 12 m/s it comes on, and backs off for nobody (throttle ${o.throttle})`);
  ok(12 * 12 / (2 * u.params.brake) < 2, `and from that speed it stops in ${(12 * 12 / (2 * u.params.brake)).toFixed(1)} m`);
  V.removeCar(u);
  // a pincer 20 m off, facing him: held, it steers for him; otherwise for its flank point (8 m ahead of him, 10 m aside)
  for (const isHeld of [true, false]) {
    u = unit(4, 'police4', 'pincer', P.x + 20, P.z, -Math.PI / 2, 0, 1);
    for (let i = 0; i < 20; i++) decide(u, isHeld);
    if (isHeld) ok(Math.abs(u.steer) < 0.05, `a pincer 20 m off, facing him: held, it comes straight for him (steer ${u.steer.toFixed(2)})`);
    else ok(Math.abs(u.steer) > 0.2, `and the hold over, for its flank point (steer ${u.steer.toFixed(2)})`);
    V.removeCar(u);
  }
  // up on a deck over him: not part of the box
  u = behind(4, 'police4', 0);
  u.y = P.y + 6; u.recoilT = RECOIL;
  o = decide(u);
  ok(o.throttle === -0.7, `a unit on a deck 6 m over him is not holding him (throttle ${o.throttle})`);
  V.removeCar(u);
  // the menu's attract mode: nobody is held
  u = behind(4, 'police4', 0);
  u.recoilT = RECOIL; game.state = 'menu';
  ok(!held(), 'on the menu nobody is held');
  o = decide(u);
  ok(o.throttle === -0.7, 'and the units chase the way they always did');
  game.state = 'playing';
  V.removeCar(u);
  // the hold lasts PIN_HOLD.grace
  game.pinSeen = game.time - PIN_HOLD.grace + 0.01; ok(held(), 'held just inside PIN_HOLD.grace after the last pinned frame');
  game.pinSeen = game.time - PIN_HOLD.grace - 0.01; ok(!held(), 'and not after it');
}
// satGap and solidWithin
{
  const bx = (x, z, h, e1, e2) => ({ x, z, e1, e2, ux: Math.sin(h), uz: Math.cos(h), vx: Math.cos(h), vz: -Math.sin(h) });
  const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-9, `${msg} (${a.toFixed(4)})`);
  near(Col.satGap(bx(0, 0, 0, 2, 1), bx(0, 5, 0, 2, 1)), 1, 'satGap: nose to tail 1 m apart reads 1 m');
  near(Col.satGap(bx(0, 0, 0, 2, 1), bx(2.5, 0, 0, 2, 1)), 0.5, 'side by side 0.5 m apart reads 0.5 m');
  near(Col.satGap(bx(0, 0, 0, 2, 1), bx(1.5, 0, 0, 2, 1)), -0.5, 'overlapping by 0.5 m reads -0.5 m');
  near(Col.satGap(bx(0, 0, 0, 2, 1), bx(1 + 1.5 * Math.SQRT2 + 0.3, 0, Math.PI / 4, 1.5, 1.5)), 0.3, 'a square turned 45 degrees, its corner 0.3 m off the side, reads 0.3 m');
  const diag = Col.satGap(bx(0, 0, 0, 1, 1), bx(3, 3, 0, 1, 1));
  ok(diag <= Math.SQRT2 && diag > 0.9, `corner to corner, ${Math.SQRT2.toFixed(2)} m apart, it reads short (${diag.toFixed(2)} m), the safe side`);
  const a = bx(0.3, -0.2, 0.4, 2.2, 1), b = bx(3.1, 2.4, 1.3, 1.8, 0.9);
  ok(Math.abs(Col.satGap(a, b) - Col.satGap(b, a)) < 1e-12, 'and it reads the same either way round');
  // solidWithin, with solids of our own put into the chunk he is in
  fresh(14);
  Object.assign(P, { x: -2, z: -40, h: 0 });                    // out on the street, heading north
  ok(!Col.solidWithin(P, 1), 'out in the street there is nothing within 1 m of him');
  const ch = chunks.get(ck(Math.floor(P.x / CHUNK), Math.floor(P.z / CHUNK)));
  const add = (x, z, hx, hz, more = {}) => { const s = { x, z, hx, hz, kind: 'test', box: { x, z, ux: 1, uz: 0, vx: 0, vz: 1, e1: hx, e2: hz }, ...more }; ch.solids.push(s); return s; };
  const wall = add(P.x + P.box.e2 + 0.3 + 1, P.z, 1, 3);          // 0.3 m off his right-hand side
  ok(Col.solidWithin(P, 0.4) && !Col.solidWithin(P, 0.25), 'solidWithin: a wall 0.3 m off his side is within 0.4 m and not within 0.25 m');
  wall.hx = wall.hz = -999;                                       // (how the game takes a solid away)
  ok(!Col.solidWithin(P, 1), 'a solid taken away is not');
  const roof = add(P.x, P.z, 4, 6, { headroom: 3.2 });
  ok(!Col.solidWithin(P, 0.4), `a roof he fits under (3.2 m over a car ${P.height.toFixed(2)} m tall) is not`);
  const h0 = P.height; P.height = 3.4;
  ok(Col.solidWithin(P, 0.4), 'and is for a car too tall for it');
  P.height = h0; roof.hx = roof.hz = -999;
  const low = add(P.x + P.box.e2 + 0.2 + 1, P.z, 1, 3, { maxY: 0.8 });
  P.y = 6;
  ok(!Col.solidWithin(P, 0.4), 'a wall below him (he is up on a deck over it) is not');
  P.y = 0;
  ok(Col.solidWithin(P, 0.4), 'and is when he is down beside it');
  low.hx = low.hz = -999;
}
// a unit backing in, with the game's own physics: it arrives and stops, and never drives away from him
{
  fresh(12);
  const u = behind(4, 'police4', 2.5, true);
  let worst = 0, last = gapTo(u), moved = 0;
  step(150, () => {
    game.pinSeen = game.time;                                  // he stays held
    const g = gapTo(u); worst = Math.max(worst, g - last); last = g; moved = Math.max(moved, u.vf);
  });
  ok(gapTo(u) < PIN_HOLD.gap && gapTo(u) > -0.1, `backing in from 2.5 m it ends up right against him (${gapTo(u).toFixed(3)} m)`);
  ok(worst < 0.01, `never further from him than a moment before (worst ${worst.toFixed(3)} m)`);
  ok(moved < 0.9, `and never drove off forwards (most ${moved.toFixed(2)} m/s)`);
  ok(Math.abs(u.vf) < 0.5 && P.speed < 0.5, `it stands at the end, and so does he (${u.vf.toFixed(2)}, ${P.speed.toFixed(2)} m/s)`);
}

// ---------------------------------------------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------------------------------------------
{
  const bar = (setup, isHeld) => {
    fresh(13);
    setup();
    game.pin = 0; game.pinSeen = isHeld ? game.time : -99;
    step(1);
    return game.pin;
  };
  const tail = gap => () => behind(4, 'police4', gap);
  ok(Math.abs(bar(tail(0.2), true) - DT) < 1e-9, 'held, his nose on the wall and a unit 0.2 m off his tail: the bar fills');
  ok(bar(tail(0.2), false) === 0, 'not held, the same: the bar does not (touching is touching)');
  ok(bar(tail(PIN_HOLD.gap + 0.2), true) === 0, `held, the unit ${(PIN_HOLD.gap + 0.2).toFixed(1)} m off: it does not count`);
  ok(bar(() => { P.x += 0.6; behind(4, 'police4', 0.1); }, true) === 0, 'held, a unit on his tail but his nose 0.6 m off the wall: one car and no wall is no box');
  ok(Math.abs(bar(() => { P.x += 0.25; behind(4, 'police4', 0.1); }, true) - DT) < 1e-9, 'held, his nose 0.25 m off the wall: the wall counts');
  ok(Math.abs(bar(() => {
    P.x += 3;                                                   // off the wall: two cars instead
    behind(4, 'police4', 0.1);
    unit(3, 'police3', 'chaser', P.x, P.z + P.box.e2 + 2.4 + 0.1, Math.PI);
  }, true) - DT) < 1e-9, 'held, off the wall, a unit on his tail and one at his side: the bar fills');
  ok(bar(() => { const u = behind(4, 'police4', 0.1); u.y = P.y + 6; }, true) === 0, 'held, a unit right over him on a deck: it does not count');
  ok(PIN_HOLD.snug < PIN_HOLD.gap, 'a unit that has arrived (PIN_HOLD.snug) is well inside PIN_HOLD.gap');
}

// ---------------------------------------------------------------------------------------------------------------
// The chase
// ---------------------------------------------------------------------------------------------------------------
// Each chase runs in a process of its own: the world generator keeps caches from one run to the next, so in one process
// a run's outcome would hang on the runs before it. On its own, with its own seed, a run comes out the same every time.
const SELF = fileURLToPath(import.meta.url);
const inChild = (id, sd) => new Promise((res, rej) => execFile(process.execPath, ['--max-old-space-size=2500', SELF],
  { env: { ...process.env, PIN_HOLD_CHASE: `${id}:${sd}` }, maxBuffer: 1 << 26 }, (err, out, errOut) => {
    const line = (out || '').split('\n').find(l => l.startsWith('RESULT '));
    if (err || !line) rej(new Error(`chase ${id}:${sd} did not finish: ${err ? err.message : ''}\n${errOut}`));
    else res(JSON.parse(line.slice(7)));
  }));
const JOBS = [['box-j-ee', 21], ['box-j-j', 21], ['box-e-pv-w', 21], ['box-j-ee-w', 21], ['ram3', 1], ['ram3', 2], ['ram3', 3],
  ['ram4', 1], ['ram4', 2], ['ram4', 3], ['jugg', 1], ['jugg', 2], ['jugg', 3], ['escape', 31]];
const RES = {};
{
  let next = 0;
  await Promise.all([0, 1].map(async () => { while (next < JOBS.length) { const [id, sd] = JOBS[next++]; RES[`${id}:${sd}`] = await inChild(id, sd); } }));
}
if (process.env.PIN_HOLD_SHOW) for (const [k, r] of Object.entries(RES)) console.log(k, JSON.stringify(r).slice(0, 300));
const fmt = r => `first pinned ${r.first.toFixed(2)} s, ${r.end || 'not busted'} ${r.busted >= 0 ? r.busted.toFixed(2) + ' s' : ''}, bar dropped ${r.drops}x, hp ${r.hp.toFixed(0)}`;
for (const [id, name] of [
  ['box-j-ee', 'a Juggernaut on his tail, two Enforcers at his sides'],
  ['box-j-j', 'a Juggernaut on his tail, one at his side'],
  ['box-e-pv-w', 'an Enforcer on his tail, a patrol car and a van at his sides, and he throws the car about'],
  ['box-j-ee-w', 'a Juggernaut on his tail, two Enforcers at his sides, and he throws the car about'],
]) {
  const r = RES[`${id}:21`];
  ok(r.end === 'BUSTED' && Math.abs(r.busted - r.first - DIFF.pin) < 2.5 * DT, `boxed in, ${name}: busted DIFF.pin (${DIFF.pin} s) after the first pinned frame (${fmt(r)})`);
  ok(r.drops === 0, `  and the bar never dropped (${r.drops})`);
  ok(r.backoff.length === 0, `  and no unit backed off him (${r.backoff.slice(0, 4).join(', ')})`);
  ok(r.hp >= 99, `  and the arrest did not hurt him (hp ${r.hp.toFixed(0)})`);
}
// Rammed in, the first hit can knock him off the wall into the open before anybody has him: then the bar can drop for a
// moment while they close in on him again. Most of the time it does not.
let clean = 0;
for (const [id, name] of [['ram3', 'three patrol units (level 3)'], ['ram4', 'three Enforcers (level 4)'], ['jugg', 'two Juggernauts (a head-on and a pincer)']]) for (const sd of [1, 2, 3]) {
  const r = RES[`${id}:${sd}`];
  ok(r.end === 'BUSTED' && r.busted - r.first < DIFF.pin + 1.2, `${name} ram him into the wall and box him (run ${sd}): busted, at most 1.2 s over DIFF.pin from the first pinned frame (${fmt(r)})`);
  ok(r.hp >= 99, `  and not hurt once they had him (hp ${r.hp.toFixed(0)})`);
  ok(r.backoff.length === 0, `  and no unit at him backed off for another run (${r.backoff.slice(0, 4).join(', ')})`);
  if (Math.abs(r.busted - r.first - DIFF.pin) < 2.5 * DT && r.drops === 0) clean++;
}
ok(clean >= 7, `in ${clean} of those 9 runs he was busted DIFF.pin after the first pinned frame, the bar never dropping (want 7)`);
{
  const r = RES['escape:31'];
  ok(r.pinnedBy > 0 && r.pinnedBy < 2.2, `one unit puts him on the wall and the bar starts (at ${r.pinnedBy.toFixed(2)} s)`);
  ok(r.state === 'playing' && r.fast > 2.2, `with the road ahead open he drives out (over 9 m/s at ${r.fast.toFixed(2)} s)`);
  ok(r.free > 0 && r.free - r.fast <= PIN_HOLD.grace + 2 * DT, `the hold ends PIN_HOLD.grace after he got going (${(r.free - r.fast).toFixed(2)} s)`);
  ok(r.empty > 0, `the bar runs empty (at ${r.empty.toFixed(2)} s)`);
  ok(r.chasing > r.free, `and the unit goes back to chasing him at speed (over 12 m/s at ${(+r.chasing).toFixed(2)} s; he got ${r.far.toFixed(0)} m away)`);
}

console.log(`pin hold: ${checks} checks PASSED`);
process.exit(0);
