/* Police AI + spawning */
import { PI, CHUNK, clamp, lerp, wrapAngle, rnd } from './utils.js';
import { game, player, sight, reportSighting, police, cars } from './state.js';
import { DIFF, HEAR_R, POLICE_TIERS } from './config.js';
import { env } from './environment.js';
import { CAR_DIMS } from './carModels.js';
import { createCar } from './vehicle.js';
import { solidAt } from './world.js';
import { overlapsAnything } from './collisions.js';
import { FLY, flyoverNear, alongOf, latOf, laneOffsetOn, laneOffset, rampApproach, rampExit, laneAim, surfaceAt, rampHeight, roadEdge } from './flyover.js';
function roadPointNear(x, z, spread) { // a random point on a road near (x,z)
  return Math.random() < 0.5
    ? { x: Math.round((x + rnd(-spread, spread)) / CHUNK) * CHUNK + rnd(-3, 3), z: z + rnd(-spread, spread) }
    : { x: x + rnd(-spread, spread), z: Math.round((z + rnd(-spread, spread)) / CHUNK) * CHUNK + rnd(-3, 3) };
}
function losBlocked(p, tx, tz, y = 1.2) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), n = Math.min(14, Math.ceil(Math.min(d, 90) / 6));
  for (let i = 1; i <= n; i++) { const t = (i / n) * Math.min(1, 90 / d); if (solidAt(p.x + dx * t, p.z + dz * t, 1.2, y)) return true; }
  return false;
}
// Does the interchange itself stand between a car at grade and (tx, tz)? The embankments are the one obstacle the
// sight line and the car disagree about: a pursuer looks over the low end of a ramp and sees the player on the far
// side, while the concrete under it still stops the car, and that is what used to send it off on a tour of the
// block. Only the mound is tested here - a building or a parked truck in the way is the grid waypoint's business,
// because that is what the waypoint is for, and rerouting every chase past a hydrant into the at-grade lane would
// be worse than the bug.
function moundInWay(p, f, tx, tz) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), n = Math.min(24, Math.ceil(d / 5));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = alongOf(f, p.x + dx * t, p.z + dz * t), v = latOf(f, p.x + dx * t, p.z + dz * t);
    if (Math.abs(u) > FLY.deckHalf - 1 && Math.abs(u) < FLY.rampEnd + 3 && Math.abs(v) < FLY.halfW + 1 && rampHeight(u) > p.y + 0.7) return true;
  }
  return false;
}
function navWaypoint(p, tx, tz) {
  const R = 8.5, rx = Math.round(p.x / CHUNK) * CHUNK, rz = Math.round(p.z / CHUNK) * CHUNK;
  const onV = Math.abs(p.x - rx) < R, onH = Math.abs(p.z - rz) < R;
  const dtx = tx - p.x, dtz = tz - p.z;
  let wx, wz;
  if (onV && onH) { // at an intersection: choose the axis with most remaining distance
    if (Math.abs(dtx) > Math.abs(dtz)) { wx = rx + Math.sign(dtx || 1) * CHUNK; wz = rz; } else { wx = rx; wz = rz + Math.sign(dtz || 1) * CHUNK; }
  } else if (onV) { wx = rx; wz = dtz > 0 ? Math.floor(p.z / CHUNK) * CHUNK + CHUNK : Math.floor(p.z / CHUNK) * CHUNK; }
  else if (onH) { wz = rz; wx = dtx > 0 ? Math.floor(p.x / CHUNK) * CHUNK + CHUNK : Math.floor(p.x / CHUNK) * CHUNK; }
  else { if (Math.abs(p.x - rx) < Math.abs(p.z - rz)) { wx = rx; wz = p.z; } else { wx = p.x; wz = rz; } }
  p.navX = wx; p.navZ = wz;
}
const _ramp = { x: 0, z: 0 }, _lane = { x: 0, z: 0 };
export function policeAI(p, dt) {
  // ---------- STATIONARY ROADBLOCK ----------
  // Parked across the road with the handbrake on, lights still flashing (handled generically by the main loop).
  // Breaks formation and joins the normal chase once the player gets close, or the hold timer runs out.
  if (p.role === 'roadblock') {
    p.blockT -= dt;
    const d0 = Math.hypot(player.x - p.x, player.z - p.z);
    if (d0 < 26 || p.blockT <= 0) p.role = Math.random() < 0.5 ? 'interceptor' : 'chaser';
    else return { throttle: 0, hand: true };
  }
  const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz), info = POLICE_TIERS[p.tier - 1];
  // ---------- VISION ----------
  p.seeT -= dt;
  if (p.seeT <= 0) {
    p.seeT = 0.2 + Math.random() * 0.12;
    const range = lerp(115, 80, env.night) * DIFF.aggr;           // night vision reduced; difficulty affects range
    p.sees = d < HEAR_R || (d < range && !losBlocked(p, player.x, player.z, Math.max(p.y, player.y) + 1.2));
  }
  if (p.sees) reportSighting();                                    // radio: everyone knows
  const k = sight.t >= p.tip.t ? sight : p.tip;                    // freshest info
  const fresh = game.t - k.t < 0.35;
  const forward = { x: Math.sin(player.h), z: Math.cos(player.h) }, side = { x: Math.cos(player.h), z: -Math.sin(player.h) };
  const lead = clamp(d / 42, 0.2, 1.25) * info.prediction * DIFF.predict;
  const rb = d > 45 ? 1 + Math.min(0.12, (d - 45) / 700) : d < 22 ? 0.97 : 1;
  p.params.maxSpeed = p.baseMax * rb * (fresh ? 1 : 0.8);          // slower in search mode
  let tx, tz, ramming = false, blockerHold = false;
  if (fresh) {
    p.search = null; p.arrived = false;
    tx = player.x + player.vx * lead; tz = player.z + player.vz * lead;
    if (p.role === 'chaser') { tx = player.x + player.vx * lead * .5; tz = player.z + player.vz * lead * .5; }
    else if (p.role === 'interceptor') { tx = player.x + player.vx * lead * 1.35; tz = player.z + player.vz * lead * 1.35; }
    else if (p.role === 'sideswipe') { const off = Math.min(5.5, d * 0.25); tx += side.x * p.flank * off; tz += side.z * p.flank * off; }
    else if (p.role === 'pit') { tx = player.x - forward.x * 3 + side.x * p.flank * 2; tz = player.z - forward.z * 3 + side.z * p.flank * 2; ramming = d < 26; }
    else if (p.role === 'blocker') {
      tx = player.x + player.vx * lead * 1.9 + side.x * p.flank * 3; tz = player.z + player.vz * lead * 1.9 + side.z * p.flank * 3;
      if (d > 23 && Math.hypot(tx - p.x, tz - p.z) < 10) { blockerHold = true; tx = player.x; tz = player.z; }
    } else if (p.role === 'pincer') { tx += forward.x * 8 + side.x * p.flank * 10; tz += forward.z * 8 + side.z * p.flank * 10; }
    else if (p.role === 'pinner') { tx = player.x + side.x * p.flank * 2; tz = player.z + side.z * p.flank * 2; ramming = true; }
    else if (p.role === 'headon') { tx += forward.x * 14; tz += forward.z * 14; ramming = true; }
    if (d < 18 * DIFF.aggr && p.tier >= 3) ramming = true;
  } else {
    // ---------- SEARCH: last known pos (with motion guess) then patrol nearby roads ----------
    const age = clamp(game.t - k.t, 0, 5), ex = k.x + k.vx * age * 0.7, ez = k.z + k.vz * age * 0.7;
    p.searchT -= dt;
    if (!p.search || p.searchT <= 0 || Math.hypot(p.search.x - p.x, p.search.z - p.z) < 14) {
      p.searchT = rnd(4, 7);
      if (!p.arrived && Math.hypot(ex - p.x, ez - p.z) > 28) p.search = solidAt(ex, ez, 3, player.y) ? roadPointNear(ex, ez, 25) : { x: ex, z: ez };
      else { p.arrived = true; p.search = roadPointNear(ex, ez, 75); }
    }
    tx = p.search.x; tz = p.search.z;
  }
  // Separation from teammates
  if (d > 16 && !ramming) {
    let sx = 0, sz = 0;
    for (const o of police) {
      if (o === p || o.wrecked) continue;
      const ox = p.x - o.x, oz = p.z - o.z, od = Math.hypot(ox, oz);
      if (od < 14 && od > 0.1) { const w = (14 - od) / 14; sx += ox / od * w; sz += oz / od * w; }
    }
    tx += sx * 9; tz += sz * 9;
  }
  const aimX = tx, aimZ = tz;   // the aim before the grid waypoint below replaces it: the interchange rules test the road against this
  p.navT -= dt;
  if (p.navT <= 0) {
    p.navT = 0.25 + Math.random() * 0.14;
    p.navOn = !ramming && Math.hypot(tx - p.x, tz - p.z) > 20 && losBlocked(p, tx, tz);
    if (p.navOn) navWaypoint(p, tx, tz);
  }
  if (p.navOn) { tx = p.navX; tz = p.navZ; if (Math.hypot(tx - p.x, tz - p.z) < 9) p.navT = 0; }
  // ---------- THE BRIDGE ----------
  // A player who gets up on a flyover used to be untouchable: every pursuer at grade drove under the deck and
  // milled about below it, because the embankment read as a wall on every probe the AI could make. Two things
  // fixed that. The probes and the sight lines now carry the height of the car asking (see solidAt), so a car on
  // the structure sees clear road ahead of it; and a pursuer that is at grade on the flying road now heads for
  // its own lane in front of the ramp's foot instead of straight at the player, so it lines up and climbs. Up on
  // the structure the same lane is held, which is what stops cars from ending up scraping along the parapets.
  // The other two rules below carry the chase back down, and both of them come from the same complaint — police
  // "circling" beside a flyover while a player hides next to the structure at grade:
  //  * a pursuer that ends up on the structure with the player *not* on it drives on to the ramp (rampExit)
  //    instead of steering across the parapets at a target beside the road below. Without it a car on the deck
  //    pins itself to a parapet, the stuck-escape reverses it, and it shuttles across the carriageway for as long
  //    as the player stays there — it never reaches the ground at all;
  //  * a pursuer at grade with the structure between it and the player takes the at-grade lane beside it, which
  //    is the way past the interchange on the ground (the flying road's own lanes at grade end at the abutment).
  //    It runs its own lane out past the end of the structure first when it is still alongside it, then crosses
  //    to the lane on the player's side: the structure's own retaining wall runs the whole length of the ramp, so
  //    a diagonal aim across it just scrapes along the wall.
  let bridgeTurn = false;
  const pf = flyoverNear(player.x, player.z);
  if (pf && player.y > 2) {                                // the player is up on the structure
    if (p.y > 1.2) {                                        // already up there: hold the lane it is driving in
      const want = laneOffsetOn(pf.axis, Math.sign(pf.axis === 'z' ? p.vz : p.vx) || 1, 2.5);
      const verr = want - latOf(pf, p.x, p.z);
      tx += (pf.axis === 'z' ? 0 : verr) * 2.2; tz += (pf.axis === 'z' ? verr : 0) * 2.2;
    } else if (!ramming && rampApproach(pf, p.x, p.z, 2.5, 9, _ramp)) { tx = _ramp.x, tz = _ramp.z; }
  } else {
    const onF = !ramming && p.y > FLY.on && surfaceAt(p.x, p.z, p.y) > 0 ? flyoverNear(p.x, p.z) : null;
    if (onF) {                                             // this one is up on the structure, the player is not: come down
      rampExit(onF, p.x, p.z, onF.axis === 'z' ? Math.cos(p.h) : Math.sin(p.h), 2.5, 9, _lane);
      tx = _lane.x; tz = _lane.z;
    } else if (!ramming && player.y <= 2) {                 // both on the ground: the structure may be in between
      const nf = flyoverNear(p.x, p.z, roadEdge() + 16);
      if (nf && moundInWay(p, nf, aimX, aimZ)) {
        // The flying road's own lanes at grade end at the abutment, so the way past the structure is the at-grade
        // lane beside it — which runs the whole length of the block and through the junction. Getting there from
        // the wrong half of the road means crossing the avenue's own lanes, and the only places that can be done
        // at grade are the junction box under the deck (between the abutments) and the ground beyond either
        // ramp's foot, where the retaining walls end: alongside the wall itself there is no gap to slip through,
        // and a diagonal aim at the lane on the far side just scrapes down the wall.
        const u = alongOf(nf, p.x, p.z), v = latOf(nf, p.x, p.z);
        const tu = alongOf(nf, aimX, aimZ), tv = latOf(nf, aimX, aimZ);
        const my = v >= 0 ? 1 : -1;
        const want = Math.abs(tv) > FLY.halfW ? (tv > 0 ? 1 : -1) : my;   // the lane on the player's side, or its own when the player is under the road itself
        const beside = Math.abs(u) > FLY.deckHalf && Math.abs(u) < FLY.rampEnd + 3;
        // Which way along the road the car is facing, and the first crossing point of the avenue in front of it:
        // the junction box under the deck while that is still ahead, otherwise the ground past the ramp's foot,
        // where the retaining walls end. Everything below aims at a point in front of the car, so a pursuer never
        // turns round for a crossing it has already passed.
        const dirU = (nf.axis === 'z' ? Math.cos(p.h) : Math.sin(p.h)) >= 0 ? 1 : -1;
        // Along the road, the aim is the player's own position - never less than a car length in front of the car,
        // so a crossing point or a car that has just come off a ramp is not asked to reverse on the spot - and
        // never a point that runs on ahead of the car either: an aim that keeps the distance while the car drives
        // is what walked pursuers away from the structure, down the lane they happened to be pointing along.
        const tgtU = tu > u ? Math.max(tu, u + 12) : Math.min(tu, u - 12);
        const cross = dirU * (u * dirU < FLY.deckHalf ? FLY.deckHalf - 2 : FLY.rampEnd + 5);
        if (Math.abs(v) < FLY.halfW + 1) {                    // still on the road's own lanes: out into the at-grade lane
          // In the junction box the full width is open, so it can step out where it stands; past the box there is a
          // wall of concrete where the ramp rises out of the ground, and the only clear place to step out is the
          // lane just outside the ramp's foot - a fixed point, so the aim cannot walk out from under a car that is
          // still crossing. A car that has been carried onto the low end of a ramp is taken off it the same way.
          // Still at the foot of the ramp, the nose guard stands at the lane's edge (lateral -7.3 m) just short of the lane
          // point, and it is a solid: a diagonal aim from here runs into it, and a car that comes in at an angle wedges
          // its front corner against it. So first run along the foot to the far side of the guard, drawn in toward the
          // middle of the road (2.5 m off the centre line), then cut out to the lane.
          const beyondGuard = FLY.rampEnd + 6;
          // In the junction it steps out to the lane the player is in (want), not the side it happens to be on: the side
          // flips as the car crosses the centre line, and a car at speed then swings from lane to lane across the avenue.
          if (Math.abs(u) <= FLY.deckHalf - 2) laneAim(nf, u + dirU * 12, want * laneOffset(), _lane);
          else if (Math.abs(u) < beyondGuard - 0.5) laneAim(nf, Math.sign(u || 1) * beyondGuard, Math.max(-2.5, Math.min(2.5, v)), _lane);
          else laneAim(nf, Math.sign(u || 1) * beyondGuard, my * laneOffset(), _lane);
          tx = _lane.x; tz = _lane.z; bridgeTurn = true;
        } else if (my !== want) {                             // in a lane, but on the wrong half of the avenue
          laneAim(nf, beside ? cross : u, (beside ? my : want) * laneOffset(), _lane);   //   its own lane up to the crossing, then straight across
          tx = _lane.x; tz = _lane.z;
        } else if (Math.abs(tu - u) >= 14) {                  // in the lane that helps, but not yet level with the player
          laneAim(nf, tgtU, want * laneOffset(), _lane);                          //   close along the lane
          tx = _lane.x; tz = _lane.z; bridgeTurn = true;   // it has just come across: brake for the turn into the lane
        }                                                     // in the lane that helps with the player in it: the aim straight at him already stands
      }
    }
  }
  const desired = Math.atan2(tx - p.x, tz - p.z), diff = wrapAngle(desired - p.h), vf = p.vf;
  let steer = clamp(diff * (p.tier >= 4 ? 2.8 : 2.35), -1, 1), throttle = 1;
  if (Math.abs(diff) > 1.0 && vf > (p.tier >= 4 ? 30 : 22)) throttle = -0.1;
  // Brake for the tight turn off a ramp; do not rely on sliding through the parapet.
  if (bridgeTurn && Math.abs(diff) > 0.65 && vf > 12) throttle = -1;
  if (blockerHold) throttle = vf > 2 ? -1 : 0;
  if (d > 14) {
    const L = 7 + Math.max(0, vf) * 0.4, probe = a => { const g = p.h + a; return solidAt(p.x + Math.sin(g) * L, p.z + Math.cos(g) * L, p.box.e2, p.y); };
    const c = probe(0), l = probe(0.55), r = probe(-0.55);
    if (c || (l && r)) { if (!p.avoidDir) p.avoidDir = Math.random() < .5 ? 1 : -1; steer = p.avoidDir; throttle = vf > 16 ? -0.3 : 0.5; }
    else if (l) { steer = -1; p.avoidDir = 0; } else if (r) { steer = 1; p.avoidDir = 0; } else p.avoidDir = 0;
  }
  if (p.recoilT > 0) { p.recoilT -= dt; throttle = -0.7; steer *= 0.4; }
  if (p.reverseT > 0) { p.reverseT -= dt; throttle = -1; steer = -steer; }
  else {
    if (Math.abs(vf) < 2.5 && throttle > .3 && d > 5) p.stuckT += dt; else p.stuckT = Math.max(0, p.stuckT - dt);
    if (p.stuckT > 1.0) { p.reverseT = p.tier >= 4 ? .7 : 1.1; p.stuckT = 0; }
  }
  p.steer += (steer - p.steer) * Math.min(1, dt * (p.tier >= 4 ? 11 : 9));
  return { throttle, hand: p.tier === 2 && Math.abs(diff) > .65 && vf > 26 };
}
// Builds a fully-configured police unit (stats, hp, initial tip) without picking a role or pushing it anywhere —
// shared by normal wanted-level spawning (spawnPolice) and scripted spawns (e.g. roadblock.js).
export function makePoliceUnit(tier, x, z, h, kind) {
  const info = POLICE_TIERS[tier - 1], dims = CAR_DIMS[kind];
  // Moto: lighter & nimbler. Van: heavier & slightly slower. Others: tier baseline.
  const speedMul = kind === 'policeMoto' ? 1.12 : kind === 'policeVan' ? 0.92 : 1;
  const accelMul = kind === 'policeMoto' ? 1.2 : kind === 'policeVan' ? 0.9 : 1;
  const turnMul = kind === 'policeMoto' ? 1.25 : kind === 'policeVan' ? 0.9 : 1;
  const params = { maxSpeed: (info.maxSpeed + rnd(0, 2)) * DIFF.speed * speedMul, maxReverse: 14,
                   accel: info.accel * DIFF.accel * accelMul, brake: info.brake, turn: info.turn * turnMul, turnFalloff: 55, grip: info.grip };
  const p = createCar(kind, x, z, h, params, 0);
  p.tier = tier; p.mass = dims.mass; p.hp = p.maxHp = dims.hp * DIFF.hp; p.impact = info.impact;
  p.baseMax = params.maxSpeed; p.recoilT = 0;
  // Fresh unit gets an imprecise initial tip about player position
  p.tip = { x: player.x + rnd(-35, 35), z: player.z + rnd(-35, 35), vx: player.vx, vz: player.vz, t: game.t };
  p.seeT = 0; p.sees = false; p.searchT = 0; p.search = null; p.arrived = false;
  return p;
}
export function spawnPolice(forceTier = 0) {
  const level = forceTier || game.wanted, tier = Math.max(1, Math.min(level, Math.random() < .78 ? level : Math.max(1, level - 1))), info = POLICE_TIERS[tier - 1];
  const kindPool = info.kinds || [info.kind];
  for (let a = 0; a < 10; a++) {
    const behind = Math.random() < 0.6, ang = behind ? player.h + PI + (Math.random() - 0.5) * 2.2 : Math.random() * PI * 2, dist = rnd(122, 150);
    let x = player.x + Math.sin(ang) * dist, z = player.z + Math.cos(ang) * dist;
    const rx = Math.round(x / CHUNK) * CHUNK, rz = Math.round(z / CHUNK) * CHUNK, lane = (Math.random() < 0.5 ? -1 : 1) * 3.5; let h;
    if (Math.abs(x - rx) < Math.abs(z - rz)) { x = rx + lane; h = player.z > z ? 0 : PI; } else { z = rz + lane; h = player.x > x ? PI / 2 : -PI / 2; }
    if (Math.hypot(x - player.x, z - player.z) < 105) continue;
    const kind = kindPool[Math.floor(Math.random() * kindPool.length)];
    const dims = CAR_DIMS[kind], tmp = { x, z, ux: Math.sin(h), uz: Math.cos(h), vx: -Math.cos(h), vz: Math.sin(h), e1: dims.e1, e2: dims.e2 };
    if (overlapsAnything(tmp, null)) continue;
    const p = makePoliceUnit(tier, x, z, h, kind);
    // Pick least-used role for tactical variety
    const used = r => { let n = 0; for (const q of police) if (!q.wrecked && q.role === r) n++; return n; };
    p.role = info.roles.map(r => ({ r, s: used(r) + Math.random() })).sort((a, b) => a.s - b.s)[0].r;
    // Split flank between left/right
    let nL = 0, nR = 0;
    for (const q of police) { if (q.wrecked) continue; if (q.flank < 0) nL++; else if (q.flank > 0) nR++; }
    p.flank = nL > nR ? 1 : -1;
    police.push(p); cars.push(p); return true;
  }
  return false;
}