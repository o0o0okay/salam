/* Log trucks spill their load (js/logSpill.js, js/carModels.js LOG_LOAD, js/collisions.js carCar, js/damage.js
   wreckCar, js/civilians.js civAI):
   * the load: the six logs are a group of their own on the log trailer (userData.cargo, not merged into the body),
     three meshes (the bark in two shades and the cut ends) whose geometry every log truck shares, lying where LOG_LOAD
     says; the cut ends' rims sit on the bark's edge; no other vehicle carries a load;
   * the spill: a hard hit (closing speed over LOG_SPILL_V) takes the load off the trailer, once; a nudge does not;
     a wreck spills it too. The six logs start where they lay, turned like the truck, and go the way the hit shoved it;
   * the logs: they fall to the road and come to rest without lying in each other; they roll across their length much
     further than they slide along it; one dropped on another can lie on it;
   * what they hit: a car a log runs into is hurt by the closing speed (a fast log wrecks a family car), and so is a car
     driving into one, and the player's car; the log is shoved and turned; a light patrol car that drives into a log
     at speed is wrecked, an armoured one is not; a log the player spilled credits the player with the takedown; a log
     that runs into another log truck spills its load; a log just off a trailer leaves its own truck alone;
   * logs break up: a blow wears a log by the closing speed and the two masses (LOG_HP, LOG_WEAR), once a blow; two or
     three knocks break it, a hard one or a heavy truck at once, and a fall or another log never wears it. The broken
     log is gone from the street at once, in three pieces and five splinters that fly the car's way, never into the
     car, come down on the road and are gone in under 2.6 s, drawn with the logs; the car goes on through, losing only
     the blow it took to break it, so a log stops one car and not the one behind it;
   * the world: a log knocks down a street prop, a parked car and a shop window, breaks a tree when it is fast and stops
     at one when it is slow (only cracked), and stops at a building's wall when it is slow and breaks up on it when it
     is fast;
   * the traffic: a civilian car sees a log lying in its path (and not one beside it, behind it or on another level),
     and a civilian car driving down the street stops short of a log lying across its lane;
   * clearing: a log nothing breaks crumbles away after its own time (0.85 to 1.15 LOG_LIFE, a load's six one by one),
     shrinking with its underside on the road; at once when it is far from the player; the oldest go first past
     LOG_MAX, and a new run starts with none and no pieces; the loose logs are drawn with two instanced meshes.
   Run:  node tools/sidewalk-checks/log-spill.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
// the spill, the world and the traffic use Math.random: a fixed sequence makes every run the same
let seed = 20261017;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const THREE = await import('three');
const C = await import('../../js/carModels.js');
const S = await import('../../js/state.js');
const V = await import('../../js/vehicle.js');
const Col = await import('../../js/collisions.js');
const LS = await import('../../js/logSpill.js');
const cfg = await import('../../js/config.js');
const { LOG_LOAD } = C;
const { LOG_SPILL_V, LOG_MASS, LOG_HIT_MIN, LOG_DMG_CAR, LOG_DMG_PLAYER, LOG_HP, LOG_WEAR, LOG_KNOCK_MIN, LOG_LIFE, LOG_MAX, DIFF, PLAYER_PARAMS } = cfg;
const R = LOG_LOAD.r, HALF = LOG_LOAD.len / 2, DT = 1 / 60;
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(3)} (want ${b.toFixed(3)} ± ${tol})`);
const mu = m => 1 / (1 / m + 1 / LOG_MASS);                     // the reduced mass of a car and a log
// what a car of mass m loses going through a log it breaks with hp left: the blow that would just have broken it
const throughLoss = (m, hp = LOG_HP) => 1.25 * (LOG_HIT_MIN + hp / (mu(m) * LOG_WEAR)) * mu(m) / m;

// ---------------------------------------------------------------------------------------------------------------
// The load on the trailer
// ---------------------------------------------------------------------------------------------------------------
{
  const g = C.buildCar('logtruck', 0xffffff), inner = g.userData.inner, cargo = g.userData.cargo;
  ok(cargo && cargo.isGroup && cargo.parent === inner, 'the log truck has its load as a group of its own on the body');
  ok(cargo.visible, 'a new log truck carries its load');
  ok(cargo.children.length === 3 && cargo.children.every(m => m.isMesh && m.castShadow), `the load is three shadow-casting meshes (${cargo.children.length})`);
  const hexes = cargo.children.map(m => m.material.color.getHex());
  ok(hexes[0] === LOG_LOAD.bark[0] && hexes[1] === LOG_LOAD.bark[1] && hexes[2] === LOG_LOAD.end, `the load is the two barks and the cut ends (${hexes.map(h => h.toString(16))})`);
  near(cargo.position.z, LOG_LOAD.z, 1e-9, 'the load sits where LOG_LOAD says, in the middle of the trailer');
  // the bark: every vertex 0.3 m from one of the six axes, the ends at the two ends of the logs
  const v = new THREE.Vector3();
  const axisDist = (x, y) => Math.min(...LOG_LOAD.at.map(([ax, ay]) => Math.hypot(x - ax, y - ay)));
  for (const [mi, keep] of [[0, i => i % 2 === 0], [1, i => i % 2 === 1]]) {
    const p = cargo.children[mi].geometry.attributes.position; let worst = 0;
    const axes = LOG_LOAD.at.filter((_, i) => keep(i));
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      worst = Math.max(worst, Math.min(...axes.map(([ax, ay]) => Math.abs(Math.hypot(v.x - ax, v.y - ay) - R))), Math.abs(v.z) - HALF);
    }
    ok(worst < 1e-5, `bark ${mi}: every vertex is on one of its logs (${worst.toExponential(1)})`);
  }
  {
    const p = cargo.children[2].geometry.attributes.position; let bad = 0;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (Math.abs(Math.abs(v.z) - HALF) > 1e-5 || axisDist(v.x, v.y) > R + 1e-5) bad++; }
    ok(bad === 0 && p.count === 6 * 2 * (LOG_LOAD.seg + 2), `the cut ends: two discs a log, at its two ends (${p.count} vertices, ${bad} astray)`);
  }
  // one log's two pieces: the ends' rims lie on the bark's edge (no gap round the end of a log)
  {
    const { bark, ends } = C.logParts(), bp = bark.attributes.position, ep = ends.attributes.position, rim = [];
    for (let i = 0; i < bp.count; i++) rim.push(new THREE.Vector3().fromBufferAttribute(bp, i));
    let worst = 0;
    for (let i = 0; i < ep.count; i++) {
      v.fromBufferAttribute(ep, i); if (Math.hypot(v.x, v.y) < R * 0.5) continue;     // the centre of a disc
      worst = Math.max(worst, Math.min(...rim.map(q => q.distanceTo(v))));
    }
    ok(worst < 1e-5, `the cut ends' rims sit on the bark's edge (${worst.toExponential(1)} m)`);
  }
  // nothing of the logs is left in the body
  const bodyWood = inner.children.filter(o => o !== cargo && o.isMesh && o.material.color && [0xb8733f, 0x9c5f30, ...LOG_LOAD.bark].includes(o.material.color.getHex()));
  ok(bodyWood.length === 0, 'none of the logs is merged into the truck\'s body any more');
  const g2 = C.buildCar('logtruck', 0x2266aa);
  ok(g2.userData.cargo.children.every((m, i) => m.geometry === cargo.children[i].geometry), 'every log truck shares the load\'s geometry');
  for (const kind of ['semi', 'semibox', 'flatbed', 'lowboy', 'garbage', 'cementtruck', 'sedan']) ok(!C.buildCar(kind, 0xffffff).userData.cargo, `a ${kind} carries no load`);
}

// ---------------------------------------------------------------------------------------------------------------
// A run: the player, the cars, the clock
// ---------------------------------------------------------------------------------------------------------------
Object.assign(S.player, V.createCar('player', 0, -400, 0, PLAYER_PARAMS, 0xffc21a)); S.cars.push(S.player);
const P = S.player;
function fresh() {
  LS.clearLogs();
  for (const c of S.cars.slice()) if (c !== P) V.removeCar(c);          // (removeCar takes it out of S.cars)
  if (!S.cars.includes(P)) S.cars.push(P);
  Object.assign(P, { x: 0, z: -120, h: 0, vx: 0, vz: 0, y: 0, logHitAt: -99 });   // near enough that no log is cleared for distance
  Object.assign(S.game, { state: 'playing', time: 10, hp: 100, takedowns: 0, cash: 0 });
}
const car = (kind, x, z, h = 0, params = {}) => { const c = V.createCar(kind, x, z, h, params, 0x8899aa); if (kind.startsWith('police')) c.tier = { police1: 1, police2: 2, police3: 3, police4: 4, police5: 5 }[kind] || 1; S.cars.push(c); return c; };
// the clock runs, the cars coast (no driver), the logs move and hit
function run(sec, each) {
  for (let k = Math.round(sec / DT); k > 0; k--) {
    S.game.time += DT;
    for (const c of S.cars) if (c !== P || c.coast) { c.x += c.vx * DT; c.z += c.vz * DT; }
    LS.updateLogs(DT);
    if (each && each() === false) break;
  }
}
// one loose log, laid where the check wants it (it comes off a log truck parked far away, which then goes)
function lone(x, z, h, vx = 0, vz = 0, y = R, opts = {}) {
  const t = V.createCar('logtruck', 5000, 5000, 0, {}, 0xffffff);
  LS.spillLogs(t, 0, 0, 0, !!opts.byPlayer); V.removeCar(t);
  const L = S.logs.pop(); S.logs.splice(S.logs.length - 5, 5);
  Object.assign(L, { x, y, z, h, vx, vy: 0, vz, spin: 0, src: null, sleep: false });
  S.logs.push(L); return L;
}
const capsuleGap = (A, B) => {                // the distance between two logs' axes (a radius short of each end)
  let best = 9;
  for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
    const k = HALF - R, s = i / 10, t = j / 10;
    best = Math.min(best, Math.hypot(A.x + Math.sin(A.h) * k * s - B.x - Math.sin(B.h) * k * t, A.y - B.y, A.z + Math.cos(A.h) * k * s - B.z - Math.cos(B.h) * k * t));
  }
  return best;
};

// ---------------------------------------------------------------------------------------------------------------
// The spill
// ---------------------------------------------------------------------------------------------------------------
{
  fresh();
  const truck = car('logtruck', 0, 0, 0); truck.vz = 7;
  // a nudge: the player's car closes at 6 m/s
  Object.assign(P, { x: 2.35, z: -2.4, h: -Math.PI / 2, vx: -6, vz: 0 });
  Col.carCar(P, truck);
  ok(!truck.spilled && S.logs.length === 0 && truck.mesh.userData.cargo.visible, 'a nudge at 6 m/s leaves the load on the trailer');
  // a ram from the truck's +x side at 20 m/s
  Object.assign(P, { x: 2.35, z: -2.4, h: -Math.PI / 2, vx: -20, vz: 0 }); truck.vx = 0; truck.vz = 7; truck.x = 0; truck.z = 0;
  const h0 = truck.h;                         // carCar turns the truck a little after the spill: the logs left at h0
  Col.carCar(P, truck);
  ok(truck.spilled && S.logs.length === 6, `a ram at 20 m/s spills the six logs (${S.logs.length})`);
  ok(!truck.mesh.userData.cargo.visible, 'the load is gone from the trailer');
  // each log starts where it lay, turned like the truck, and the player's spill is the player's
  const sorted = S.logs.slice();
  LOG_LOAD.at.forEach(([ax, ay], i) => {
    const L = sorted[i], wx = truck.x + ax * Math.cos(h0) + LOG_LOAD.z * Math.sin(h0), wz = truck.z - ax * Math.sin(h0) + LOG_LOAD.z * Math.cos(h0);
    ok(Math.hypot(L.x - wx, L.z - wz) < 1e-6 && Math.abs(L.y - ay) < 1e-6, `log ${i} starts where it lay on the trailer`);
    ok(Math.abs(L.h - h0) <= 0.06 + 1e-9 && L.byPlayer && L.shade === i % 2, `log ${i} is turned like the truck, in its own bark, and the player's`);
  });
  // they go the way the hit shoved the truck (towards -x), faster than the truck itself
  const mean = S.logs.reduce((a, L) => a + L.vx, 0) / 6;
  ok(mean < truck.vx - 1, `the logs fly off the way the ram pushed (mean ${mean.toFixed(2)} m/s, truck ${truck.vx.toFixed(2)})`);
  ok(S.logs.every(L => L.vx < 0), 'every log goes off on the far side from the car that hit');
  // a second ram: nothing more comes off
  Object.assign(P, { x: 2.35, z: -2.4, h: -Math.PI / 2, vx: -20, vz: 0 }); truck.x = 0; truck.z = 0; truck.vx = 0;
  Col.carCar(P, truck);
  ok(S.logs.length === 6, 'a log truck spills its load once');
  // the logs come down, spread out and lie still, never in each other
  truck.vx = truck.vz = 0;
  let worstOverlap = 9, packed = 9, fr = 0;       // packed: the first two frames, the six coming off touching each other
  run(15, () => { fr++; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { const g = capsuleGap(S.logs[i], S.logs[j]); if (fr <= 2) packed = Math.min(packed, g); else worstOverlap = Math.min(worstOverlap, g); } });
  const onRoad = L => L.sleep && Math.abs(L.y - R) < 1e-6, across = L => L.y > R + 0.3 && Math.hypot(L.vx, L.vy, L.vz) < 0.1 && S.logs.some(M => M !== L && M.y < L.y && capsuleGap(L, M) < 2 * R + 0.02);
  ok(S.logs.every(L => onRoad(L) || across(L)), 'fifteen seconds on, every log lies still: asleep on the road, or lying on another log');
  ok(S.logs.filter(onRoad).length >= 4, `most of them on the road itself (${S.logs.filter(onRoad).length} of 6)`);
  ok(worstOverlap > 2 * R - 0.12, `no log ever sinks into another (closest ${worstOverlap.toFixed(2)} m between axes, 0.60 is touching)`);
  ok(packed > 2 * R - 0.25, `nor far as they leave the trailer packed together (closest ${packed.toFixed(2)} m in the first two frames)`);
  ok(S.logs.every(L => L.hp === LOG_HP), `the fall off the trailer and the other logs wear none of them (${S.logs.map(L => L.hp.toFixed(1)).join(' ')})`);
  const off = S.logs.map(L => -L.x);
  ok(Math.min(...off) > 1.5 && Math.max(...off) < 30, `they lie off the far side of the trailer, 1.5 to 30 m out (${Math.min(...off).toFixed(1)} to ${Math.max(...off).toFixed(1)})`);
  // a wreck spills its load as well, and counts for the player who did it
  fresh();
  const t2 = car('logtruck', 0, 0, 0); t2.lastPlayerHit = S.game.time - 1;
  const { hurtCar } = await import('../../js/damage.js');
  hurtCar(t2, 999);
  ok(t2.wrecked && t2.spilled && S.logs.length === 6 && S.logs.every(L => L.byPlayer), 'a log truck that is wrecked spills its load (the player\'s, when the player wrecked it)');
  // a police car ramming one spills it, and that spill is not the player's
  fresh();
  const t3 = car('logtruck', 0, 0, 0), cop = car('police2', 2.4, -2.4, -Math.PI / 2); cop.vx = -18;
  Col.carCar(cop, t3);
  ok(t3.spilled && S.logs.length === 6 && S.logs.every(L => !L.byPlayer), 'a patrol car ramming a log truck spills it, and not on the player\'s account');
  // a truck with another trailer has nothing to spill
  fresh();
  const box = car('semibox', 0, 0, 0);
  Object.assign(P, { x: 2.4, z: -2.4, h: -Math.PI / 2, vx: -20, vz: 0 });
  Col.carCar(P, box);
  ok(S.logs.length === 0 && !LS.spillLogs(box), 'a box trailer spills nothing');
}

// ---------------------------------------------------------------------------------------------------------------
// A loose log on the road
// ---------------------------------------------------------------------------------------------------------------
{
  const roll = (v, across) => {
    fresh(); const L = lone(0, 0, 0, across ? v : 0, across ? 0 : v);
    let t = 0; run(12, () => { t += DT; return !L.sleep; });
    return { d: Math.hypot(L.x, L.z), t, L };
  };
  const a6 = roll(6, true), s6 = roll(6, false), a10 = roll(10, true);
  ok(a6.d > 4 && a6.d < 9, `a log rolling across its length at 6 m/s comes to rest after 4 to 9 m (${a6.d.toFixed(1)})`);
  ok(a10.d > 9 && a10.d < 18, `at 10 m/s, after 9 to 18 m (${a10.d.toFixed(1)})`);
  ok(s6.d < 3, `sliding along its length at 6 m/s it stops within 3 m (${s6.d.toFixed(1)})`);
  ok(a6.d > 2.5 * s6.d, 'it rolls much further than it slides');
  ok(a6.L.sleep && s6.L.sleep && a6.t < 5 && s6.t < 2, `both come to rest (${a6.t.toFixed(1)} s, ${s6.t.toFixed(1)} s)`);
  ok(Math.abs(a6.L.roll) > 4 / R && Math.abs(s6.L.roll) < 0.01, 'a rolling log turns about its own axis, a sliding one does not');
  // one dropped across another lies on it
  fresh();
  const low = lone(0, 0, 0), top = lone(0, 0, Math.PI / 2, 0, 0, 1.6);
  run(3);
  near(top.y, 3 * R, 0.04, 'a log dropped across the middle of another comes to lie on top of it');
  ok(Math.hypot(top.vx, top.vz) < 0.05 && Math.abs(low.y - R) < 1e-6, 'and stays there, the lower one on the road');
  // held up near one end, it tips off, away from the log under it, and lies on the road
  fresh();
  lone(0, 0, 0); const tipper = lone(2.4, 0, Math.PI / 2, 0, 0, 1.6);   // the lower log under it 2.4 m from its middle
  run(4);
  ok(Math.abs(tipper.y - R) < 0.01 && tipper.x > 2.4 + 0.5, `a log dropped across another near its own end tips off it, onto the road (${tipper.x.toFixed(2)}, ${tipper.y.toFixed(2)})`);
  // and one lying across two logs, near both its ends, stays up on them
  fresh();
  lone(-2.4, 0, 0); lone(2.4, 0, 0); const bridge = lone(0, 0, Math.PI / 2, 0, 0, 1.6);
  run(4);
  ok(Math.abs(bridge.y - 3 * R) < 0.04 && Math.abs(bridge.x) < 0.1, `a log across two logs stays up on both (${bridge.x.toFixed(2)}, ${bridge.y.toFixed(2)})`);
}

// ---------------------------------------------------------------------------------------------------------------
// What a log hits: the cars
// ---------------------------------------------------------------------------------------------------------------
{
  // a log rolling into a family car standing beside the road: hurt by the closing speed, shoved, and panicking
  const rollInto = (v, kind = 'sedan') => {
    fresh(); const L = lone(0, 0, 0, v, 0), c = car(kind, R + 0.95 + 0.4, 0, 0);
    run(0.5);
    return { L, c };
  };
  const slow = rollInto(8);
  const want = 40 - (8 - 0.2 - LOG_HIT_MIN) * LOG_DMG_CAR;             // it loses about 0.2 m/s rolling up to the car
  ok(Math.abs(slow.c.hp - want) < 2.5 && !slow.c.wrecked, `a log rolling into a family car at 8 m/s takes about ${(40 - want).toFixed(0)} of its 40 HP (${(40 - slow.c.hp).toFixed(1)})`);
  ok(slow.c.vx > 1.5 && slow.L.vx < 8 - 1.5, `the car is shoved (${slow.c.vx.toFixed(1)} m/s) and the log slowed (${slow.L.vx.toFixed(1)} m/s)`);
  ok(slow.c.panicT > 0, 'the driver panics');
  const slowWear = (8 - 0.2 - LOG_HIT_MIN) * mu(1.0) * LOG_WEAR;
  ok(S.logs.includes(slow.L) && Math.abs(LOG_HP - slow.L.hp - slowWear) < 1.5, `the log is cracked by it, not broken (${slow.L.hp.toFixed(1)} of ${LOG_HP} left, about ${(LOG_HP - slowWear).toFixed(1)})`);
  const fast = rollInto(12);
  ok(fast.c.wrecked, `a log rolling into it at 12 m/s wrecks it (${fast.c.hp.toFixed(1)} HP left)`);
  ok(!S.logs.includes(fast.L) && fast.L.hp <= 0, 'and breaks up on it');
  const crawl = rollInto(1.8);
  ok(crawl.c.hp === 40 && crawl.L.hp === LOG_HP, 'a log that only bumps it (under LOG_HIT_MIN) does no harm, and takes none');
  // a patrol car driving into a log lying across its lane
  const driveInto = (kind, v, byPlayer = false) => {
    fresh(); const L = lone(0, 0, 0, 0, 0, R, { byPlayer }), c = car(kind, -(R + C.CAR_DIMS[kind].e1 + 1.2), 0, Math.PI / 2); c.vx = v;
    run(0.6); return { L, c };
  };
  const light = driveInto('police1', 15, true);
  ok(light.c.wrecked, `the lightest patrol car driving into a log at 15 m/s is wrecked (${light.c.hp.toFixed(1)} HP)`);
  ok(S.game.takedowns === 1, 'a log the player spilled credits the player with that takedown');
  ok(!S.logs.includes(light.L), 'the log breaks up under the blow');
  near(light.c.vx, 15 - throughLoss(1.0), 0.02, 'the car goes on through it, losing only the blow it took to break it');
  const armoured = driveInto('police4', 15);
  const lost = C.CAR_DIMS.police4.hp - armoured.c.hp;
  ok(!armoured.c.wrecked && lost > 15 && lost < 40, `an armoured patrol car takes the same blow with ${lost.toFixed(1)} of its ${C.CAR_DIMS.police4.hp} HP`);
  ok(!S.logs.includes(armoured.L), 'and breaks the log as well');
  const noCredit = driveInto('police1', 15, false);
  ok(noCredit.c.wrecked && S.game.takedowns === 0, 'a log the traffic spilled credits no one');
  // an off-centre blow turns the log (one that leaves it whole)
  {
    fresh(); const L = lone(0, 0, 0), c = car('sedan', -(R + 2.05 + 1.0), 2.8, Math.PI / 2); c.vx = 6;
    run(0.4);
    ok(S.logs.includes(L) && (Math.abs(L.spin) > 0.5 || Math.abs(L.h) > 0.1), `a car striking the end of a log turns it (spin ${L.spin.toFixed(2)} rad/s, turned ${L.h.toFixed(2)} rad)`);
  }
  // the player's car
  {
    fresh(); const L = lone(0, 0, 0); P.coast = true;
    Object.assign(P, { x: -(R + 2.05 + 0.8), z: 0, h: Math.PI / 2, vx: 20, vz: 0 });
    run(0.4); P.coast = false;
    const lostHp = 100 - S.game.hp, expect = (20 - LOG_HIT_MIN) * LOG_DMG_PLAYER * DIFF.dmg;
    ok(Math.abs(lostHp - expect) < 0.8, `the player's car driving into a log at 20 m/s loses ${lostHp.toFixed(1)} HP (about ${expect.toFixed(1)})`);
    ok(!S.logs.includes(L), 'and smashes it to pieces');
    near(P.vx, 20 - throughLoss(C.CAR_DIMS.player.mass), 0.02, `going on through them at most of its speed`);
  }
  // a car pushed against a log lying still (by something else: it has no way of its own), the log against another one:
  // the log it shoves wakes, so the two part instead of sinking into each other
  {
    fresh(); const a = lone(0, 0, 0), b = lone(-2 * R, 0, 0); a.sleep = b.sleep = true;
    const c = car('sedan', R + 0.95 - 0.01, 0, 0); let worst = 9;
    run(1, () => { c.x -= 0.01; worst = Math.min(worst, capsuleGap(a, b)); });
    ok(worst > 2 * R - 0.05, `a car shoved against a log lying against another does not push one into the other (closest ${worst.toFixed(2)} m)`);
  }
  // a log that runs into another log truck knocks that load off too
  {
    fresh(); const L = lone(0, 0, 0, 11, 0, R, { byPlayer: true }), t = car('logtruck', R + 1.35 + 0.4, 0, 0);
    run(0.4);
    ok(t.spilled && S.logs.length === 6 && !S.logs.includes(L) && S.logs.every(l => l.byPlayer), `a log rolling into a log truck at 11 m/s spills its load as well, breaking up on it (${S.logs.length} logs, all on the player's account)`);
  }
  // logs with no way of their own off the trailer (a hit straight from behind) still slide off it over the side,
  // and the bed holds them up until they are past its edge: none drops through the trailer onto the road under it
  {
    fresh(); const t = car('logtruck', 0, 0, 0); LS.spillLogs(t);
    for (const L of S.logs) { L.vx = t.vx; L.vz = t.vz; L.vy = 0; }
    const BED_Y = LOG_LOAD.at[0][1] - R, s = Math.sin(t.h), co = Math.cos(t.h);
    const local = L => [(L.x - t.x) * co - (L.z - t.z) * s, (L.x - t.x) * s + (L.z - t.z) * co];
    let through = 0, offBy = Infinity, t0 = S.game.time;
    run(4, () => {
      for (const L of S.logs) { const [lx, lz] = local(L); if (Math.abs(lx) < 0.95 && Math.abs(lz - LOG_LOAD.z) < 3.7 && L.y < BED_Y + R - 0.05) through++; }
      if (offBy === Infinity && S.logs.every(L => Math.abs(local(L)[0]) > 1.0 + R)) offBy = S.game.time - t0;
    });
    ok(through === 0, 'no log drops through the trailer bed');
    ok(offBy < 1.2, `they are all off the bed within 1.2 s (${offBy.toFixed(2)} s)`);
    ok(S.logs.every(L => Math.abs(local(L)[0]) > 1.35 + R - 0.05), `every log has come off the side of the trailer (${S.logs.map(L => Math.abs(local(L)[0]).toFixed(2)).join(' ')})`);
  }
  // logs coming off a trailer leave their truck alone, and land beside it, not under it
  {
    fresh(); const t = car('logtruck', 0, 0, 0);
    t.vz = 5; LS.spillLogs(t, 0, 0, 0, false);
    run(1);                                     // (once down, a log lying by the road may be brushed by the trailer)
    ok(Math.abs(t.vz - 5) < 1e-9 && t.vx === 0, 'the falling load does not shove its own truck');
    run(3);
    const s = Math.sin(t.h), co = Math.cos(t.h);
    ok(S.logs.every(L => Math.abs((L.x - t.x) * co - (L.z - t.z) * s) > 1.35 || Math.abs((L.x - t.x) * s + (L.z - t.z) * co) > 6.1), 'none of the logs ends up lying under its truck');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Logs break up
// ---------------------------------------------------------------------------------------------------------------
{
  const { surfaceAt } = await import('../../js/flyover.js');
  const e1Of = kind => kind === 'player' ? P.box.e1 : C.CAR_DIMS[kind].e1;
  // how fast a piece (as it was born, a frame back) leaves the face of a car's box it is nearest, against the car
  const away = (c, p) => {
    const s = Math.sin(c.h), co = Math.cos(c.h), dx = p.x - p.vx * DT - c.x, dz = p.z - p.vz * DT - c.z, lf = dx * s + dz * co, ll = dx * co - dz * s;
    const ends = c.box.e1 - Math.abs(lf) < c.box.e2 - Math.abs(ll), sg = (ends ? lf : ll) >= 0 ? 1 : -1;
    return (p.vx - c.vx) * (ends ? s * sg : co * sg) + (p.vz - c.vz) * (ends ? co * sg : -s * sg);
  };
  // a car of a kind driving at v into the log L lying across its way (at the origin, along z), as many times as asked,
  // the log put back still between knocks; L's strength after each
  const knocks = (kind, v, n, L) => {
    const left = [];
    for (let k = 0; k < n && S.logs.includes(L); k++) {
      Object.assign(L, { x: 0, y: R, z: 0, h: 0, vx: 0, vy: 0, vz: 0, spin: 0, sleep: false });
      const c = car(kind, -(R + e1Of(kind) + 0.6), 0, Math.PI / 2); c.vx = v;
      run(0.4); V.removeCar(c); left.push(S.logs.includes(L) ? L.hp : 0);
    }
    return left;
  };
  // the wear: by the closing speed over LOG_HIT_MIN and the two masses
  fresh();
  let L = lone(0, 0, 0);
  const w5 = (5 - LOG_HIT_MIN) * mu(1.0) * LOG_WEAR, left = knocks('sedan', 5, 4, L);
  near(LOG_HP - left[0], w5, 0.01, 'a family car driving into a log at 5 m/s takes (5 - LOG_HIT_MIN) x LOG_WEAR x the reduced mass off it');
  near(LOG_HP - left[1], 2 * w5, 0.01, 'the next knock as much again');
  ok(left.length === 3 && left[2] === 0 && !S.logs.includes(L), `and the third breaks it (${left.map(h => h.toFixed(1)).join(', ')})`);
  fresh(); L = lone(0, 0, 0);
  const sedan6 = knocks('sedan', 6, 1, L)[0];
  fresh(); L = lone(0, 0, 0);
  const heavy6 = knocks('police4', 6, 1, L)[0];
  ok(sedan6 > 0 && heavy6 === 0, `at 6 m/s a family car only cracks a log (${sedan6.toFixed(1)} left), an armoured patrol truck breaks it at once`);
  // one blow wears a log once, however many frames the two touch for: a car that keeps driving at 4 m/s into a log
  // held where it lies (as against a wall)
  fresh(); L = lone(0, 0, 0);
  { const c = car('sedan', -(R + 2.05 + 0.3), 0, Math.PI / 2); c.vx = 4; let n = 0, last = LOG_HP;
    run(0.25, () => { if (L.hp < last) { n++; last = L.hp; } c.vx = 4; L.vx = L.vz = 0; L.x = 0; });
    ok(n === 1 && S.logs.includes(L), `a car pressing on into a log wears it once in 0.3 s, not every frame it touches (${n})`); }
  // the break: the log is gone at once, in three pieces and five splinters, drawn with the logs
  fresh(); L = lone(0, 0, 0);
  const cop = car('police1', -(R + e1Of('police1') + 0.6), 0, Math.PI / 2); cop.vx = 15;
  let broke = false;
  run(0.5, () => { if (!S.logs.includes(L)) { broke = true; return false; } });
  const pcs = LS.logPieces().slice(), thick = pcs.filter(p => p.r === R), thin = pcs.filter(p => p.r < R);
  ok(broke && L.hp <= 0, 'the blow that takes the last of a log takes it out of the street that frame');
  ok(thick.length === 3 && thin.length === 5, `it breaks into three pieces and five splinters (${thick.length}, ${thin.length})`);
  ok(pcs.every(p => Math.abs((p.x - L.x) * Math.cos(L.h) - (p.z - L.z) * Math.sin(L.h)) < 1.2 && Math.abs((p.x - L.x) * Math.sin(L.h) + (p.z - L.z) * Math.cos(L.h)) < HALF + 0.5),
    'every piece starts where its part of the log lay');
  ok(thick.reduce((a, p) => a + 2 * p.half, 0) < 2 * HALF && thick.every(p => 2 * p.half > 1 && 2 * p.half < 0.45 * 2 * HALF), `the pieces are short lengths of it (${thick.map(p => (2 * p.half).toFixed(2)).join(', ')} m)`);
  ok(thin.every(p => p.r <= 0.3 * R + 1e-9 && 2 * p.half <= 1.6 + 1e-9), 'the splinters thin sticks of it');
  { const slow = Math.min(...pcs.map(p => away(cop, p)));
    ok(slow > 1 - 1e-6, `every piece and splinter leaves the car's nearest face at 1 m/s or more, none into it (the slowest ${slow.toFixed(2)} m/s)`); }
  {
    const byLane = thick.slice().sort((a, b) => Math.abs(a.z) - Math.abs(b.z)), [inWay, ...aside] = byLane;   // the car runs along z = 0
    ok(pcs.every(p => p.vy > 0) && inWay.vx > cop.vx + 1, `they are thrown up, the piece in the car's way on ahead of it (${inWay.vx.toFixed(1)} m/s; the car ${cop.vx.toFixed(1)})`);
    ok(aside.every(p => p.vx > 0 && p.vz * Math.sign(p.z) > 1.5), `and the others aside, out of its way (${aside.map(p => `${p.vx.toFixed(1)}, ${p.vz.toFixed(1)}`).join('; ')})`);
  }
  {
    const { bark, ends } = LS.logMeshes(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), k = new THREE.Vector3();
    ok(bark.count === S.logs.length + pcs.length && ends.count === bark.count && bark.visible, `the pieces are drawn after the logs, with the same two meshes (${bark.count})`);
    const i = S.logs.length + pcs.indexOf(thick[0]), p = thick[0], kk = Math.min(1, (p.life - p.age) / 0.45);
    bark.getMatrixAt(i, m); m.decompose(pos, q, k);
    ok(Math.abs(k.z - 2 * p.half / LOG_LOAD.len * kk) < 1e-6 && Math.abs(k.x - kk) < 1e-6 && pos.distanceTo(new THREE.Vector3(p.x, p.y - (p.half * Math.abs(Math.sin(p.pitch)) + p.r * Math.abs(Math.cos(p.pitch))) * (1 - kk), p.z)) < 1e-6,
      'a piece is drawn where it is, as short as it is');
  }
  // they fly, never into the car and never into the road, come down and are gone
  let inCar = 0, sunk = 0, maxY = 0;
  run(2.7, () => {
    const s = Math.sin(cop.h), co = Math.cos(cop.h);
    for (const p of LS.logPieces()) {
      const dx = p.x - cop.x, dz = p.z - cop.z;
      if (p.r === R && Math.abs(dx * s + dz * co) < cop.box.e1 && Math.abs(dx * co - dz * s) < cop.box.e2 && p.y - p.r < 1.6) inCar++;
      sunk = Math.min(sunk, p.y - (p.half * Math.abs(Math.sin(p.pitch)) + p.r * Math.abs(Math.cos(p.pitch))) - surfaceAt(p.x, p.z, p.y));
      maxY = Math.max(maxY, p.y);
    }
  });
  ok(inCar === 0, `no piece goes through the car that broke it (${inCar} frames)`);
  ok(sunk > -1e-9 && maxY > 1 && maxY < 6, `they fly (up to ${maxY.toFixed(1)} m) and come down on the road, never into it`);
  ok(LS.logPieces().length === 0 && LS.logMeshes().bark.count === 0, 'and are all gone in under 2.6 s');
  // a log rolling into a car standing still breaks up on it: every piece leaves the car's side, none goes into it
  {
    fresh(); L = lone(0, 0, 0.4, 15, 0); const c = car('sedan', R + 0.95 + 0.6, 0, 0);
    const out = p => { const s = Math.sin(c.h), co = Math.cos(c.h), dx = p.x - c.x, dz = p.z - c.z; return Math.max(Math.abs(dx * s + dz * co) - c.box.e1, Math.abs(dx * co - dz * s) - c.box.e2); };
    let born = null, slowest = Infinity;
    run(0.5, () => { if (!born && LS.logPieces().length) { born = LS.logPieces().map(p => [p, out(p)]); slowest = Math.min(...LS.logPieces().map(p => away(c, p))); } });
    ok(slowest > 1 - 1e-6, `every piece leaves the car's nearest face at 1 m/s or more (the slowest ${slowest.toFixed(2)} m/s)`);
    run(0.25);
    ok(born && born.length === 8 && born.every(([p, d0]) => out(p) > d0 + 0.1), `the pieces of a log that breaks on a car standing still all fly off it (${born && born.map(([p, d0]) => (out(p) - d0).toFixed(2)).join(' ')} m further out)`);
  }
  // a log stops one car, not the one behind it
  fresh(); L = lone(0, 0, 0);
  const first = car('police1', -(R + e1Of('police1') + 0.6), 0, Math.PI / 2), second = car('police1', first.x - 9, 0, Math.PI / 2);
  first.vx = second.vx = 15;
  run(1.2);
  ok(first.wrecked && !S.logs.includes(L), 'the first patrol car into a log is wrecked and breaks it');
  ok(second.hp === C.CAR_DIMS.police1.hp && second.vx === 15 && second.x > 5, `the one right behind it drives on through, untouched (${second.hp} HP, ${second.vx} m/s)`);
  // two cars into one log in the same frame: it breaks once, and the second car goes through what is left
  fresh(); L = lone(0, 0, 0);
  {
    const a = car('police1', -(R + e1Of('police1') + 0.6), -1.6, Math.PI / 2), b = car('police1', a.x, 1.6, Math.PI / 2);
    a.vx = b.vx = 15; let n = 0;
    run(0.4, () => { n = Math.max(n, LS.logPieces().length); });
    ok(!S.logs.includes(L) && n === 8, `two patrol cars driving into one log side by side break it once (${n} pieces)`);
    ok(Math.min(a.vx, b.vx) > 15 - throughLoss(1.0) - 1e-6, `and neither is stopped harder than one going through it (${a.vx.toFixed(2)}, ${b.vx.toFixed(2)} m/s)`);
  }
  // a new run: no pieces left over
  fresh(); L = lone(0, 0, 0); { const c = car('police1', -(R + e1Of('police1') + 0.6), 0, Math.PI / 2); c.vx = 20; run(0.2); }
  ok(LS.logPieces().length > 0, 'pieces in the air');
  const { resetWorld } = await import('../../js/flow.js');
  resetWorld();
  ok(LS.logPieces().length === 0 && LS.logMeshes().bark.count === 0, 'a new run starts with no pieces of logs either');
  fresh();
}

// ---------------------------------------------------------------------------------------------------------------
// What a log hits: the street
// ---------------------------------------------------------------------------------------------------------------
{
  fresh();
  const W = await import('../../js/world.js');
  const { surfaceAt } = await import('../../js/flyover.js');
  W.updateChunks(3, -24, 999);
  const solids = [...W.chunks.values()].flatMap(ch => ch.solids), props = [...W.chunks.values()].flatMap(ch => ch.props);
  const boxAt = (x, z, h) => ({ x, z, ux: Math.sin(h), uz: Math.cos(h), vx: -Math.cos(h), vz: Math.sin(h), e1: HALF, e2: R });
  // a log laid with its near side 0.3 m from the target's face, between it and the street, rolling at it
  const approach = (tx, tz, half) => {
    const X = Math.round(tx / 80) * 80, Z = Math.round(tz / 80) * 80;
    if (Math.abs(tx - X) <= Math.abs(tz - Z)) { const side = Math.sign(tx - X) || 1; return { x: tx - side * (half + R + 0.3), z: tz, h: 0, ux: side, uz: 0 }; }
    const side = Math.sign(tz - Z) || 1; return { x: tx, z: tz - side * (half + R + 0.3), h: Math.PI / 2, ux: 0, uz: side };
  };
  const clearAt = (a, except) => surfaceAt(a.x, a.z, 10) === 0
    && !solids.some(s => s !== except && s.hx > 0 && Col.sat(boxAt(a.x, a.z, a.h), s.box))
    && !props.some(p => p !== except && !p.broken && Math.abs((p.x - a.x) * a.ux + (p.z - a.z) * a.uz) < p.r + R + 0.3 && Math.abs((p.x - a.x) * a.uz - (p.z - a.z) * a.ux) < HALF + p.r);
  const roll = (a, v, sec = 1.2) => {
    Object.assign(P, { x: a.x + 40 * a.uz, z: a.z + 40 * a.ux });      // the player looks on from up the street
    const L = lone(a.x, a.z, a.h, a.ux * v, a.uz * v); run(sec); return L;
  };
  // the first of a list with a clear approach from the street: a prop by its radius, a solid by its half width
  // across the approach
  const pickProp = list => {
    for (const t of list) { const a = approach(t.x, t.z, t.r); if (clearAt(a, t)) return { t, a }; }
    return null;
  };
  const pickSolid = list => {
    for (const t of list) {
      const half = Math.abs(approach(t.x, t.z, 0).ux) ? t.hx : t.hz, a = approach(t.x, t.z, half);
      if (clearAt(a, t)) return { t, a, half };
    }
    return null;
  };
  const past = (L, g) => (L.x - g.t.x) * g.a.ux + (L.z - g.t.z) * g.a.uz + g.half + R;   // > 0: into the target
  // a street prop
  const pr = pickProp(props.filter(p => !p.broken && ['streetlight', 'hydrant', 'trashcan', 'mailbox', 'bench', 'meter'].includes(p.kind)));
  ok(pr, 'a street prop to roll a log into');
  roll(pr.a, 5);
  ok(pr.t.broken, `a log rolling at 5 m/s knocks down a ${pr.t.kind}`);
  // trees: a fast log breaks one, a slow one stops at it
  const t1 = pickSolid(solids.filter(s => s.tree && !s.tree.broken));
  ok(t1, 'a street tree to roll a log into');
  roll(t1.a, 11);
  ok(t1.t.tree.broken, 'a log at 11 m/s breaks a tree');
  const t2 = pickSolid(solids.filter(s => s.tree && !s.tree.broken));
  const L2 = roll(t2.a, 5, 2);
  ok(!t2.t.tree.broken, 'a log at 5 m/s does not');
  ok(past(L2, t2) < 0.05, `it stops at the tree, not through it (${past(L2, t2).toFixed(2)} m)`);
  ok(S.logs.includes(L2) && L2.hp > LOG_HP / 2, `and is no more than cracked by it (${L2.hp.toFixed(1)} of ${LOG_HP} left)`);
  // a parked car and a shop window
  const pk = pickSolid(solids.filter(s => s.parked && !s.parked.broken && !W.isHeavyParked(s.parked.mass)));
  ok(pk, 'a parked car to roll a log into');
  roll(pk.a, 10);
  ok(pk.t.parked.broken, 'a log at 10 m/s knocks a parked car off its bay');
  const shop = pickSolid(solids.filter(s => s.shop && !s.shop.broken));
  ok(shop, 'a shop window to roll a log into');
  roll(shop.a, 6);
  ok(shop.t.shop.broken, 'a log at 6 m/s goes through a shop window');
  // a building's wall stops it
  const bw = pickSolid(solids.filter(s => s.kind === 'building' && s.hx > 3 && s.hz > 3));
  ok(bw, 'a building to roll a log at');
  const Lw = roll(bw.a, 5, 2);
  ok(past(Lw, bw) < 0.05, `a log rolling at a wall at 5 m/s stops outside it (${past(Lw, bw).toFixed(2)} m)`);
  ok(Lw.vx * bw.a.ux + Lw.vz * bw.a.uz <= 0.05, 'and is not still going into it');
  ok(S.logs.includes(Lw) && Lw.hp > LOG_HP / 2, `nor much the worse for it (${Lw.hp.toFixed(1)} of ${LOG_HP} left)`);
  const Lf = roll(bw.a, 9, 0.5);
  ok(!S.logs.includes(Lf) && LS.logPieces().length === 8 && past(Lf, bw) < 0.05, 'one rolling at it at 9 m/s breaks up against it');
  LS.clearLogs();
}

// ---------------------------------------------------------------------------------------------------------------
// The traffic
// ---------------------------------------------------------------------------------------------------------------
{
  fresh();
  const viewer = { x: 0, z: 0, y: 0, box: { e1: 2.05, e2: 0.95 } };
  Object.assign(P, { x: 0, z: -60 });
  const ahead = (x, z, h, y = R) => { LS.clearLogs(); lone(x, z, h, 0, 0, y); return LS.logAhead(viewer, 0, 1, 30); };
  near(ahead(0, 10, Math.PI / 2), 10, 1e-9, 'a car sees a log lying across its lane 10 m ahead');
  near(ahead(3.4, 10, Math.PI / 2), 10, 1e-9, 'and one lying across the road with only its end in the lane');
  ok(ahead(4, 10, 0) === Infinity, 'but not one lying along the next lane');
  ok(ahead(0, -10, Math.PI / 2) === Infinity, 'nor one behind it');
  ok(ahead(0, 10, Math.PI / 2, 7) === Infinity, 'nor one up on a deck over it');
  ok(ahead(0, 45, Math.PI / 2) === Infinity, 'nor one further than it looks');
  // a car in the traffic, driving down a street with a log lying across its lane, stops short of it
  const { resetWorld } = await import('../../js/flow.js');
  const CV = await import('../../js/civilians.js');
  const { surfaceAt } = await import('../../js/flyover.js');
  resetWorld();
  S.game.state = 'playing';
  const clearRun = c => {
    if (c.y !== 0 || c.wrecked) return false;
    const along = c.axis === 'z' ? c.z : c.x, lo = Math.min(along, along + c.dir * 34) - 12, hi = Math.max(along, along + c.dir * 34) + 12;
    return Math.ceil(lo / 80) * 80 > hi;                                // no junction (and so no lights) on the way
  };
  const c = S.civs.find(c => clearRun(c) && c.cruise >= 6);              // (not one queued in a jam, crawling)
  ok(c, 'a car in the traffic cruising down a street with a clear run');
  for (const o of S.cars.slice()) if (o !== P && o !== c) V.removeCar(o);
  const lx = c.axis === 'z' ? c.road - c.dir * c.off : c.x + c.dir * 24, lz = c.axis === 'z' ? c.z + c.dir * 24 : c.road + c.dir * c.off;
  ok(surfaceAt(lx, lz, 5) === 0, 'the log lies on the street, not under a flyover');
  const L = lone(lx, lz, c.axis === 'z' ? Math.PI / 2 : 0);
  let touched = false, top = 0;
  for (let k = 0; k < 600; k++) {
    S.game.time += DT;
    V.driveCar(c, CV.civAI(c, DT), DT);
    LS.updateLogs(DT);
    top = Math.max(top, c.speed);
    if (Col.sat(V.carBox(c), V.carBox(L))) touched = true;
  }
  const gapLeft = Math.abs(c.axis === 'z' ? L.z - c.z : L.x - c.x) - c.box.e1 - R;
  ok(top > 4, `the car got going (${top.toFixed(1)} m/s)`);
  ok(!touched && Math.abs(c.speed) < 0.3, `and stopped short of the log without touching it (${c.speed.toFixed(2)} m/s)`);
  ok(gapLeft > 0.3 && gapLeft < 8, `about a car's length short of it (${gapLeft.toFixed(1)} m)`);
  ok(Math.hypot(L.x - lx, L.z - lz) < 1e-9, 'the log was never moved');
  // a new run starts with no logs in the street
  LS.clearLogs();
  const t = car('logtruck', P.x + 12, P.z, 0); LS.spillLogs(t); LS.updateLogs(DT);
  ok(S.logs.length === 6 && LS.logMeshes().bark.visible, 'a spill puts six logs in the street');
  P.logHitAt = 1e6;                           // a log hit late in the last run, by the clock of that run
  resetWorld();
  ok(S.logs.length === 0 && !LS.logMeshes().bark.visible && LS.logMeshes().bark.count === 0, 'a new run starts with none');
  ok(P.logHitAt < 0, 'and the player\'s car is not left out of reach of the logs by the last run\'s clock');
}

// ---------------------------------------------------------------------------------------------------------------
// Clearing away, and drawing
// ---------------------------------------------------------------------------------------------------------------
{
  fresh();
  const t = car('logtruck', 0, 0, 0); LS.spillLogs(t, 0, 0, 0, false);
  V.removeCar(t);
  run(1);
  const { bark, ends } = LS.logMeshes();
  ok(bark.isInstancedMesh && ends.isInstancedMesh && bark.count === 6 && ends.count === 6 && bark.visible, 'the loose logs are drawn with two instanced meshes, one instance each');
  ok(bark.castShadow && ends.castShadow && !bark.frustumCulled, 'they cast shadows and are not culled as one object');
  ok(ends.material.color.getHex() === LOG_LOAD.end, 'the cut ends in their own colour');
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), k = new THREE.Vector3(), col = new THREE.Color();
  S.logs.forEach((L, i) => {
    bark.getMatrixAt(i, m); m.decompose(p, q, k);
    const ax = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    ok(p.distanceTo(new THREE.Vector3(L.x, L.y, L.z)) < 1e-5 && Math.abs(ax.x - Math.sin(L.h)) < 1e-5 && Math.abs(ax.z - Math.cos(L.h)) < 1e-5 && Math.abs(k.x - 1) < 1e-6, `log ${i} is drawn where it lies, turned its way`);
    bark.getColorAt(i, col);
    ok(col.getHex() === LOG_LOAD.bark[L.shade], `log ${i} in its own bark`);
  });
  // nothing breaks them: each lies for a time of its own, from 0.85 LOG_LIFE to 1.15, so the load goes a log at a time
  const lives = S.logs.map(L => L.life), all = S.logs.slice(), byLife = lives.slice().sort((a, b) => a - b);
  ok(byLife.every((l, k) => Math.abs(l - LOG_LIFE * (0.85 + 0.06 * k)) < 1e-9), `the six lie from 0.85 to 1.15 LOG_LIFE, 0.06 LOG_LIFE apart: one at a time (${lives.map(l => l.toFixed(1)).join(' ')} s)`);
  ok(Math.abs(all[2].life - byLife[0]) < 1e-9 && Math.abs(all[3].life - byLife[5]) < 1e-9, 'and not from one end of the stack to the other');
  run(0.85 * LOG_LIFE - 1 - 0.1);
  ok(S.logs.length === 6 && S.logs.every(L => !L.out), 'they all lie in the street for most of LOG_LIFE');
  let going = null;
  run(0.35 * LOG_LIFE, () => { going = S.logs.find(L => L.out > 0.3); if (going) return false; });
  ok(going && S.logs.every(L => (L.out > 0) === (L.age > L.life)), 'then each starts to crumble away when its own time is up, and only then');
  { const i = S.logs.indexOf(going), kk = 1 - going.out / 0.8; bark.getMatrixAt(i, m); m.decompose(p, q, k);
    ok(Math.abs(k.x - kk) < 1e-6 && kk < 1 && Math.abs(p.y - R * k.x - (going.y - R)) < 1e-6, `shrinking out with its underside on the road (scale ${k.x.toFixed(2)})`); }
  run(0.8);
  ok(!S.logs.includes(going), 'and is gone');
  run(0.3 * LOG_LIFE + 1);
  ok(S.logs.length === 0 && all.every(L => L.hp === LOG_HP) && bark.count === 0 && !bark.visible, 'by 1.15 LOG_LIFE they are all gone, none of them broken');
  // far from the player, at once
  fresh(); lone(0, 0, 0); Object.assign(P, { x: 0, z: 300 }); run(DT);
  ok(S.logs.length === 0, 'a log far from the player is cleared at once');
  // no more than LOG_MAX: the oldest go first
  fresh();
  for (let n = 1; n <= 9; n++) {
    const tr = car('logtruck', 14 * n - 70, -100, 0);                 // all within sight of the player
    LS.spillLogs(tr); for (const L of S.logs) if (L.n === undefined) L.n = n;
    V.removeCar(tr); run(0.1);
  }
  ok(S.logs.length === LOG_MAX, `no more than LOG_MAX logs at once (${S.logs.length})`);
  ok(!S.logs.some(L => L.n === 1) && S.logs.filter(L => L.n === 9).length === 6, 'the oldest were cleared first');
}

console.log(`log spill: ${checks} checks PASSED`);
process.exit(0);
