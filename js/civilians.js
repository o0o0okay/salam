/* Civilian traffic - lane routing + reactive AI.
   Right-hand traffic. Lane position: axis z -> x = road - dir*off ; axis x -> z = road + dir*off */
import { PI, CHUNK, clamp, wrapAngle, rnd, hash2 } from './utils.js';
import { player, police, cars, civs } from './state.js';
import { CAR_DIMS, GARBAGE_LIVERIES } from './carModels.js';
import { createCar } from './vehicle.js';
import { solidAt, nearChunks, plazaIn } from './world.js';
import { onIsland, CORE } from './island.js';
import { overlapsAnything } from './collisions.js';
import { lightGo, lightPhase, isYellow } from './trafficLights.js';
import { tramTrackAhead } from './tram.js';
import { logAhead } from './logSpill.js';
import { isFlyoverNode, plazaAt, surfaceAt, armOpen, nearClosedStreet, FLY, nodeAt, bridgeHeight, alongOf } from './flyover.js';

export const CIV_KINDS = [
  'sedan', 'sedan', 'sedan',
  'taxi', 'taxi',
  'pickup', 'pickup',
  'bus',
  'hatchback', 'hatchback', 'hatchback',
  'suv', 'suv',
  'van',
  'sportscar',
  'oldclassic',
  'limo',
  'icecream',
  'garbage',
  'cementtruck',
  'fueltanker',
  'semi',
  'semibox',
  'flatbed',
  'lowboy',
  'logtruck'
];

const CIV_COLORS = [0xe34a4a, 0x3a7bd5, 0x39b36b, 0xf2a93b, 0xeeeeee, 0x8e5bd9, 0x2f3340, 0x58c7d6, 0xf07ab8, 0xb0b8c4];
const BUS_COLORS = [0x3b82c4, 0xe8b02a, 0x3f9e48, 0xffffff];
const PASTEL_COLORS = [0xd9c7a3, 0x9fb8d9, 0xc9a0dc, 0xdfe0c0, 0xb5d8c0, 0xe3b9a6];
const TRUCK_COLORS = [0xe8a33a, 0xd64545, 0x3a7bd5, 0xeeeeee, 0x4a7a45];
const TANKER_COLORS = [0xf4f4f4, 0xe8e8e8, 0xd0d0d0, 0xc7cdd2];
const SEMI_COLORS = [0x3a7bd5, 0x4f8fc0, 0xd64545, 0xeeeeee, 0x2f7f6f, 0x3f8f3f, 0xf2c230, 0xc0322b, 0x2f5fa8];

const laneHeading = (axis, dir) => axis === 'z' ? (dir > 0 ? 0 : PI) : dir * PI / 2;

function lanePoint(c, ahead, out) {
  if (c.axis === 'z') { out.x = c.road - c.dir * c.off; out.z = c.z + c.dir * ahead; }
  else { out.x = c.x + c.dir * ahead; out.z = c.road + c.dir * c.off; }
  return out;
}

function civColor(kind) {
  if (kind === 'taxi') return 0xffc400;
  if (kind === 'bus') return BUS_COLORS[Math.floor(Math.random() * BUS_COLORS.length)];
  if (kind === 'oldclassic') return PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
  if (kind === 'limo') return Math.random() < 0.8 ? 0x111216 : 0xf2f2f2;
  if (kind === 'icecream') return Math.random() < 0.5 ? 0x3f9fe0 : 0xe8434a;   // the blue livery or the red
  if (kind === 'garbage') return GARBAGE_LIVERIES[Math.floor(Math.random() * GARBAGE_LIVERIES.length)].body;   // green, grey or white
  if (kind === 'cementtruck') return TRUCK_COLORS[Math.floor(Math.random() * TRUCK_COLORS.length)];
  if (kind === 'fueltanker') return TANKER_COLORS[Math.floor(Math.random() * TANKER_COLORS.length)];
  if (['semi', 'semibox', 'flatbed', 'lowboy', 'logtruck'].includes(kind)) return SEMI_COLORS[Math.floor(Math.random() * SEMI_COLORS.length)];
  return CIV_COLORS[Math.floor(Math.random() * CIV_COLORS.length)];
}

function civParams(kind) {
  switch (kind) {
    case 'bus': return { maxSpeed: 20, maxReverse: 6, accel: 9, brake: 30, turn: 1.7, turnFalloff: 40, grip: 9 };
    case 'van': return { maxSpeed: 24, maxReverse: 7, accel: 11, brake: 36, turn: 2.0, turnFalloff: 45, grip: 8.5 };
    case 'limo': return { maxSpeed: 25, maxReverse: 7, accel: 10, brake: 34, turn: 1.6, turnFalloff: 48, grip: 8.5 };
    case 'icecream': return { maxSpeed: 21, maxReverse: 6, accel: 9, brake: 32, turn: 1.8, turnFalloff: 42, grip: 8.8 };
    case 'garbage': return { maxSpeed: 17, maxReverse: 5, accel: 7, brake: 26, turn: 1.25, turnFalloff: 36, grip: 9.5 };   // laden like the mixer
    case 'suv': return { maxSpeed: 27, maxReverse: 8, accel: 13, brake: 38, turn: 2.2, turnFalloff: 48, grip: 8.2 };
    case 'pickup': return { maxSpeed: 27, maxReverse: 8, accel: 14, brake: 40, turn: 2.4, turnFalloff: 50, grip: 8 };
    case 'sportscar': return { maxSpeed: 34, maxReverse: 9, accel: 19, brake: 46, turn: 2.7, turnFalloff: 55, grip: 7.6 };
    case 'oldclassic': return { maxSpeed: 23, maxReverse: 7, accel: 11, brake: 34, turn: 2.0, turnFalloff: 46, grip: 8.4 };
    case 'hatchback': return { maxSpeed: 28, maxReverse: 8, accel: 15, brake: 42, turn: 2.6, turnFalloff: 52, grip: 7.8 };
    case 'cementtruck': return { maxSpeed: 17, maxReverse: 5, accel: 7, brake: 26, turn: 1.25, turnFalloff: 36, grip: 9.5 };
    case 'fueltanker': return { maxSpeed: 18, maxReverse: 5, accel: 7.5, brake: 24, turn: 1.0, turnFalloff: 32, grip: 9.6 };
    case 'semi': return { maxSpeed: 22, maxReverse: 6, accel: 9, brake: 30, turn: 1.5, turnFalloff: 40, grip: 9.2 };
    case 'semibox': case 'flatbed': case 'lowboy': case 'logtruck': return { maxSpeed: 18, maxReverse: 5, accel: 7, brake: 24, turn: 0.95, turnFalloff: 30, grip: 9.6 };
    default: return { maxSpeed: 27, maxReverse: 8, accel: 14, brake: 40, turn: 2.4, turnFalloff: 50, grip: 8 };
  }
}

function civCruise(kind) {
  if (kind === 'bus') return rnd(7, 9);
  if (kind === 'van' || kind === 'limo') return rnd(8, 11);
  if (kind === 'sportscar') return rnd(13, 18);
  if (kind === 'oldclassic') return rnd(7, 10);
  if (kind === 'icecream') return rnd(6, 8.5);                  // the ice cream van takes its time
  if (kind === 'garbage') return rnd(5.5, 8);                   // and the garbage truck crawls along its round
  if (['cementtruck', 'fueltanker', 'semibox', 'flatbed', 'lowboy', 'logtruck'].includes(kind)) return rnd(6, 8.5);
  if (kind === 'semi') return rnd(8, 11);
  return rnd(9, 14);
}

const _lp = { x: 0, z: 0 };

// Is the junction at (ix,iz) already occupied by another car (player/police/civ)?
// Used to enforce “don’t enter a blocked intersection even on green”.
function junctionOccupied(ix, iz, self) {
  for (const o of cars) {
    if (o === self || o.wrecked || o.sink) continue;
    // inside the 18×18 m junction box
    if (Math.abs(o.x - ix) < 8.5 && Math.abs(o.z - iz) < 8.5) return true;
    // also consider a car that is just entering (nose within 3 m of centre at speed)
    if (o.speed > 3 && Math.hypot(o.x - ix, o.z - iz) < 6) return true;
  }
  return false;
}
// Does perpendicular traffic have earlier arrival and thus right-of-way?
// Yield only if cross car is clearly closer (0.9 m margin) — avoids deadlock when both arrive simultaneously.
function crossHasPriority(c, ix, iz, distAhead) {
  for (const o of cars) {
    if (o === c || o.wrecked || o.sink) continue;
    if (o.axis === c.axis) continue; // only cross traffic
    const od = Math.hypot(o.x - ix, o.z - iz);
    if (od > 18) continue;
    // ignore cars moving away from the junction (their heading points away)
    const headingToJuncX = ix - o.x, headingToJuncZ = iz - o.z;
    const headingDot = Math.sin(o.h) * headingToJuncX + Math.cos(o.h) * headingToJuncZ;
    if (headingDot < -1) continue; // moving away
    if (od + 0.9 < distAhead && od < 12 && o.speed > 0.8) return true;
    if (od < 6.5 && Math.hypot(o.x - ix, o.z - iz) < 7) return true; // already at mouth
  }
  return false;
}

export function civPanic(c, hard) {
  if (c.wrecked) return;
  if (!hard && (c.panicT > 0 || c.panicCool > 0)) return;
  if (hard && c.panicT > 1.2) return;
  // soft panic is now just a gentle brake — no swerve off-lane.
  // hard (real collision) still makes them brake longer.
  c.panicT = hard ? 2.0 : 1.1;
  c.panicCool = hard ? 4.0 : 6.0;
  c.panicMode = 0;
  c.swerve = Math.random() < 0.5 ? 1 : -1;
}

export function civAI(c, dt) {
  c.panicCool -= dt;

  if (c.kind === 'bus' && c.busWaitT > 0) {
    c.busWaitT -= dt;
    c.steer *= 0.2;
    return { throttle: c.busWaitT > 0.2 ? -1 : 0, hand: true };
  }

  if (c.panicT <= 0 && c.panicCool <= 0) {
    const dp = Math.hypot(player.x - c.x, player.z - c.z);
    let threat = false;
    // Player: only if close, fast, and roughly heading toward the civ — not just cruising parallel 5m away
    if (!player.dead && player.speed > 14 && dp < 13) {
      const toX = c.x - player.x, toZ = c.z - player.z;
      const pv = Math.hypot(player.vx, player.vz);
      const fwdDot = pv > 0.5 ? (player.vx * toX + player.vz * toZ) / (pv * dp) : 0;
      const lat = Math.abs(toX * Math.cos(player.h) - toZ * Math.sin(player.h));
      // very close always counts (<4.5m)
      if (dp < 4.5) threat = true;
      // otherwise need to be ahead of player and in forward cone
      else if (fwdDot > 0.25 && lat < 3.2 && dp < 7 + player.speed * 0.18) threat = true;
    }
    if (!threat) {
      for (const p of police) {
        if (p.wrecked || p.speed < 5) continue;
        const d2 = Math.hypot(p.x - c.x, p.z - c.z);
        if (d2 < 11) {
          // police must be close and not just parked — siren radius was 20m, now 11m
          const pfwd = Math.hypot(p.vx, p.vz) > 3;
          if (d2 < 7 || (pfwd && d2 < 11)) { threat = true; break; }
        }
      }
    }
    if (threat) civPanic(c, false);
  }

  const along = c.axis === 'z' ? c.z : c.x;
  const node = Math.round(along / CHUNK) * CHUNK;
  if (Math.abs(along - node) < 2.5 && c.lastNode !== node) {
    c.lastNode = node;
    // Nobody turns at the interchange: the avenue is up on the bridge and the crossing street runs underneath, so
    // there is no at-grade movement to turn into. A car that turned there would either drive off the deck or
    // appear through the embankment, so the junction is straight-through for both roads.
    const ixN = c.axis === 'z' ? c.road : node, izN = c.axis === 'z' ? node : c.road;
    // Nobody turns at a plaza junction either: turning means driving through the island, and the user
    // wants civilian traffic to go around it naturally. Only police (in pursuit) and the player do that.
    // A closed street (a T junction) is never driven into: a car whose way on is closed turns onto an open arm, and
    // a random turn only picks an open arm. The junction index is the node in grid units.
    const jxN = ixN / CHUNK, jzN = izN / CHUNK;
    const turnAx = c.axis === 'z' ? 'x' : 'z';
    const turnOpts = [1, -1].filter(d => armOpen(jxN, jzN, turnAx, d));
    if (!armOpen(jxN, jzN, c.axis, c.dir) && turnOpts.length) {
      c.axis = turnAx; c.dir = turnOpts[Math.floor(Math.random() * turnOpts.length)]; c.road = node;
    } else if (Math.random() < 0.4 && !isFlyoverNode(ixN, izN) && !plazaAt(jxN, jzN) && turnOpts.length) {
      c.axis = turnAx; c.dir = turnOpts[Math.floor(Math.random() * turnOpts.length)]; c.road = node;
    }
  }

  const sp = c.vf, s = Math.sin(c.h), co = Math.cos(c.h);
  lanePoint(c, 9 + Math.max(0, sp) * 0.55, _lp);

  // Plaza avoidance: civilian cars steer around the roundabout island instead of driving through it.
  // The plaza (radius 5 m) sits at the junction centre, so a car driving straight through would hit it.
  // Cars curve outward — away from the road centre — to pass between the island and the kerb (8 m out).
  // The swerve target is set so the car's centre reaches 6.5 m from the junction centre at the closest
  // point (5 m island + ~1 m car half-width + 0.5 m margin). The curve spans 50 m (25 m each side of
  // the junction) so it reads as a natural arc, not a sudden swerve. Police cars are not subject to
  // this — they drive through in pursuit.
  // Must run BEFORE the desired heading is computed from _lp, so the offset takes effect.
  {
    // Find the next junction ahead (same pattern as the traffic-light check below): the nearest junction
    // rounded to, then stepped one CHUNK in the direction of travel if the car is at or past it.
    let nextAlong = Math.round(along / CHUNK) * CHUNK;
    if (c.dir > 0 && nextAlong <= along + 0.01) nextAlong += CHUNK;
    if (c.dir < 0 && nextAlong >= along - 0.01) nextAlong -= CHUNK;
    const distToJunction = (nextAlong - along) * c.dir;          // >0: junction is ahead; <0: just passed
    if (distToJunction > -25 && distToJunction < 50) {            // active from 50 m before to 25 m past
      const jx = c.axis === 'z' ? c.road : nextAlong, jz = c.axis === 'z' ? nextAlong : c.road;
      const pz = plazaIn(jx, jz);
      if (pz) {
        // Bell curve: 0 at the edges of the range, 1 at the junction centre.
        const range = distToJunction < 0 ? 25 : 50;
        const proximity = 1 - Math.abs(distToJunction) / range;
        // The car's centre must reach 6.5 m from the junction centre to clear the island
        // (5 m radius + ~1 m car half-width + 0.5 m margin). The swerve is the ADDITIONAL
        // outward offset on top of the car's current lane position, so the lane point
        // ends up at (c.off + swerve) from the road centre. A speed-dependent multiplier
        // compensates for the steering lag: at higher speeds the look-ahead is further
        // out, so the car turns more gently and needs a bigger offset to reach the same
        // lateral position by the junction.
        const targetOut = 6.5;                                    // car centre 6.5 m from junction centre
        const needOut = Math.max(0, targetOut - c.off);           // how much further out the car must go
        const speedComp = 1 + Math.max(0, sp - 18) * 0.035;       // +3.5% per m/s above 18
        const swerve = needOut * proximity * 1.6 * speedComp;
        if (c.axis === 'z') { _lp.x -= c.dir * swerve; }
        else { _lp.z += c.dir * swerve; }
      }
    }
  }

  const desired = Math.atan2(_lp.x - c.x, _lp.z - c.z), diff = wrapAngle(desired - c.h);
  let steer = clamp(diff * 3.0, -1, 1), target = c.cruise;

  // city following: keep safe headway, ignore oncoming / perpendicular (handled by junction logic)
  for (const o of cars) {
    if (o === c || o.wrecked || o.sink) continue;
    const dx = o.x - c.x, dz = o.z - c.z;
    if (dx * dx + dz * dz > 900) continue; // 30 m
    const f = dx * s + dz * co, l = dx * co - dz * s;
    if (f <= 0 || Math.abs(l) > 2.6) continue;
    // only follow cars roughly heading same way (dot > 0.35) — avoids braking for oncoming in adjacent lane or cross traffic
    const headingDot = Math.sin(o.h) * s + Math.cos(o.h) * co;
    if (headingDot < 0.35) continue;
    const safeGap = 6 + Math.max(0, sp) * 1.15;
    const need = f - o.box.e1 - c.box.e1 - 0.5;
    if (f < safeGap + o.box.e1) {
      if (need < 3.5) target = Math.min(target, 0);
      else if (need < safeGap) target = Math.min(target, Math.max(0, (need - 2.2) * 1.0, o.speed * 0.85));
      else target = Math.min(target, o.speed * 0.97);
    }
  }
  // A loose log in its path (js/logSpill.js): the car slows down for it and stops short of it, the last few metres on
  // the handbrake (below 1.5 m/s the throttle only coasts). The police do not: a log in the road is a hazard the chase
  // drives into.
  const logGap = logAhead(c, s, co, 6 + Math.max(0, sp) * 1.2 + c.box.e1) - c.box.e1 - 0.3;    // its nose to the log
  if (logGap < Infinity) target = Math.min(target, Math.max(0, logGap - 3.5) * 1.2);

  const L = 6 + Math.max(0, sp) * 0.4;
  // The look-ahead is asked from the car's own height: on a flyover the embankment below the ramp is not a wall,
  // and a car at grade beside the structure is still told it is there. Asking from the ground was what used to
  // send climbing cars swerving off to the edges of the bridge.
  // A car riding a flyover's surface skips the ramp slices. They sit under the surface it is on, and ten metres out
  // on a climb the slice tops are above its height, so every climbing car was told a wall was ahead: it slowed to
  // 3 m/s and steered for the centre of the ramp. At grade, and under the structure, the slices still stop it.
  // The flank walls and the abutment are not ramp slices and still count.
  const skipRamp = surfaceAt(c.x, c.z, c.y) > 0;
  if (solidAt(c.x + s * L, c.z + co * L, 1.2, c.y, skipRamp, c.height)) {
    target = Math.min(target, 4.2);
    const leftClear = !solidAt(c.x + Math.sin(c.h + 0.5) * L, c.z + Math.cos(c.h + 0.5) * L, 1.1, c.y, skipRamp, c.height);
    const rightClear = !solidAt(c.x + Math.sin(c.h - 0.5) * L, c.z + Math.cos(c.h - 0.5) * L, 1.1, c.y, skipRamp, c.height);
    if (leftClear && !rightClear) steer = -0.7;
    else if (rightClear && !leftClear) steer = 0.7;
    else steer = solidAt(c.x + Math.sin(c.h + 0.5) * L, c.z + Math.cos(c.h + 0.5) * L, 1.2, c.y, skipRamp, c.height) ? -0.65 : 0.65;
    // stay closer to lane centre — don’t add full swerve on top of lane error
    steer = clamp(steer * 0.85 + diff * 0.35, -1, 1);
  }

  // Plaza proximity slow-down: a car approaching or passing a plaza eases off for the curve.
  {
    const pzNear = plazaIn(c.x + s * 20, c.z + co * 20);
    if (pzNear) target = Math.min(target, c.cruise * 0.7);
  }

  // --- Intersection discipline: lights + occupancy + right-of-way ---
  {
    let nextNode = Math.round(along / CHUNK) * CHUNK;
    if (c.dir > 0 && nextNode <= along + 0.01) nextNode += CHUNK;
    if (c.dir < 0 && nextNode >= along - 0.01) nextNode -= CHUNK;
    const distAhead = (nextNode - along) * c.dir;
    if (distAhead > 0 && distAhead < 26) {
      const ix = c.axis === 'z' ? c.road : nextNode, iz = c.axis === 'z' ? nextNode : c.road;
      const go = lightGo(ix, iz, c.axis);
      const yellow = isYellow(ix, iz, c.axis);
      const blocked = junctionOccupied(ix, iz, c);
      const crossPri = crossHasPriority(c, ix, iz, distAhead);
      if (!go) {
        const stopDist = distAhead - 12.5;
        if (stopDist >= 0 && stopDist < 14) target = Math.min(target, Math.max(0, stopDist * 1.8));
        // don’t slam brake if already inside the box on red (you ran it) — just crawl through if blocked
        if (distAhead < 8.5 && blocked) target = Math.min(target, 2);
      } else if (yellow) {
        if (distAhead > 6.5) {
          const stopDist = distAhead - 12.5;
          if (stopDist >= 0 && stopDist < 14) target = Math.min(target, Math.max(0, stopDist * 1.7));
        } else if (blocked) {
          target = Math.min(target, 2.5);
        }
      } else { // green
        if (blocked && distAhead < 15) {
          const stopDist = distAhead - 12.5;
          if (stopDist >= 0) target = Math.min(target, Math.max(0, stopDist * 1.6));
          else target = Math.min(target, 1.0);
        }
        if (crossPri && distAhead < 15) {
          const stopDist = distAhead - 12.5;
          if (stopDist >= 0) target = Math.min(target, Math.max(0, stopDist * 1.5));
          else target = Math.min(target, 0.6);
        }
      }
    }
  }

  if (c.kind === 'bus') {
    for (const ch2 of nearChunks(c.x, c.z)) {
      for (const bs of ch2.busStops) {
        if (bs.broken || bs === c.busStopDoneAt) continue;
        if (bs.axis !== c.axis || bs.road !== c.road) continue;
        const aheadBS = (bs.along - along) * c.dir;
        if (aheadBS > 0 && aheadBS < 15) {
          target = Math.min(target, Math.max(0, aheadBS - 3) * 1.4);
          if (aheadBS < 3 && sp < 2) { c.busWaitT = 5; c.busStopDoneAt = bs; }
        }
      }
    }
  }

  // Trams: a car on a live track gets off it (gas, on towards its lane); a car about to cross a track with a tram coming
  // brakes for it and waits for the tram to pass.
  const rails = tramTrackAhead(c);
  const offRails = rails < 0;
  if (offRails) target = Math.max(target, c.cruise + 6);
  else if (rails < Infinity) target = Math.min(target, Math.max(0, rails - 4) * 1.2);

  // City throttle: proportional, not bang-bang — coasts often, brakes early, doesn’t floor it constantly
  let throttle;
  if (offRails) throttle = 1;
  else {
    const err = target - sp;
    if (err > 3.5) throttle = 0.65;
    else if (err > 1.0) throttle = 0.32;
    else if (err < -2.0) throttle = -0.75;
    else if (err < -0.7) throttle = -0.35;
    else throttle = 0; // coast — not always on gas
    // occasional city hesitation: lift off gas briefly (look, check, pedestrian)
    if (!c.panicT && c.kind !== 'bus' && Math.random() < 0.0022) throttle = Math.min(throttle, 0.0);
  }
  if (offRails) throttle = 1;

  if (c.panicT > 0) {
    c.panicT -= dt;
    // panic now = just gentle brake, stay in lane (no swerve into walls)
    throttle = -0.95; steer *= 0.35;
    // hard collision panic still just brakes a bit longer — no runaway acceleration
  }

  if (c.reverseT > 0) {
    c.reverseT -= dt;
    throttle = -1;
    steer = -steer;
  } else {
    if (Math.abs(sp) < 1.5 && throttle > 0.3) c.stuckT += dt;
    else c.stuckT = Math.max(0, c.stuckT - dt);
    if (c.stuckT > 1.3) { c.reverseT = 1.0; c.stuckT = 0; }
  }

  c.steer += (steer - c.steer) * Math.min(1, dt * 9);
  return { throttle, hand: logGap < 5 };
}

// Traffic density and jams. A quarter of the lanes (by hash, the same on every visit) are jam lanes: a car spawned there
// comes with a platoon of three to five cars behind it, spaced 7.5 m, all creeping along at 1.5 to 3.5 m/s, so a queue
// forms that reads as a jam. The other lanes keep the normal speeds. The cap is ten times the old 13 (menu: 10 -> 100).
export const CIV_MAX = 130, CIV_MAX_MENU = 100;
const JAM_SHARE = 4;                                    // one lane in four
export function isJamLane(axis, road, dir) {
  return (hash2(Math.round(road / CHUNK) * 2 + (axis === 'z' ? 1 : 0), dir > 0 ? 1 : 0) % JAM_SHARE) === 0;
}
// One civilian car at a lane position, with the checks the spawn always made (clear of the junctions, of a closed
// street, of the player by 55 m, and of anything that stands there). Returns the car or null.
function placeCiv(axis, road, dir, off, along, cruise, y = 0) {
  const x = axis === 'z' ? road - dir * off : along, z = axis === 'z' ? along : road + dir * off;
  // keep clear of the wide junctions at grade; a deck car may sit over one (no crossing traffic runs under the deck there)
  if (!y && Math.abs(along - Math.round(along / CHUNK) * CHUNK) < 20) return null;
  if (nearClosedStreet(x, z, 10)) return null;                                  // nor on a street closed for a T junction
  if (Math.hypot(x - player.x, z - player.z) < 55) return null;
  const h = laneHeading(axis, dir), kind = CIV_KINDS[Math.floor(Math.random() * CIV_KINDS.length)], dims = CAR_DIMS[kind];
  const tmp = { x, z, y, ux: Math.sin(h), uz: Math.cos(h), vx: -Math.cos(h), vz: Math.sin(h), e1: dims.e1 + 2, e2: dims.e2 };
  if (overlapsAnything(tmp, null)) return null;
  // not on a track a tram is about to use, nor about to cross one: the car would be in the way of the tram from the start
  if (tramTrackAhead({ x, z, h, box: { e1: dims.e1 + 2, e2: dims.e2 } }) < Infinity) return null;
  const color = civColor(kind);
  const params = civParams(kind);
  const c = createCar(kind, x, z, h, params, color);
  c.y = y;                                                    // on a deck: the deck's height (the car rides it from there)
  c.axis = axis; c.dir = dir; c.road = road; c.off = off; c.cruise = cruise ?? civCruise(kind);
  c.vx = Math.sin(h) * c.cruise; c.vz = Math.cos(h) * c.cruise;
  civs.push(c); cars.push(c);
  return c;
}
// A share of the new cars start up on a flyover's deck, so the bridges carry traffic as the streets do. A deck is
// chosen from the flyovers whose junction is 70 to 220 m from the player (out of sight, as the ground spawns are),
// and the car is placed on the deck's flat part, in one of its two lanes, at the deck's height.
const DECK_SHARE = 0.3, DECK_NEAR = 70, DECK_FAR = 220;
export function spawnDeckCiv() {
  const near = [];
  for (let b = FLY.minGap; b <= CORE - 1; b++) {
    for (const s of [1, -1]) {
      for (const f of [nodeAt(0, s * b), nodeAt(s * b, 0)]) {
        if (!f) continue;
        const jx = f.axis === 'z' ? 0 : f.node, jz = f.axis === 'z' ? f.node : 0;
        const d = Math.hypot(jx - player.x, jz - player.z);
        if (d >= DECK_NEAR && d <= DECK_FAR) near.push(f);
      }
    }
  }
  if (!near.length) return false;
  for (let a = 0; a < 6; a++) {
    const f = near[Math.floor(Math.random() * near.length)];
    // the flat deck runs from the start junction's extent less the deck's overhang to the far end's, plus the overhang
    const lo = f.node + f.lo - FLY.deckHalf, hi = f.node + f.hi + FLY.deckHalf;
    const along = lo + Math.random() * (hi - lo);
    const dir = Math.random() < 0.5 ? 1 : -1, off = Math.random() < 0.5 ? 2.5 : 5.0;
    const x = f.axis === 'z' ? f.road - dir * off : along, z = f.axis === 'z' ? along : f.road + dir * off;
    const y = bridgeHeight(f, alongOf(f, x, z));
    if (y <= 0) continue;
    if (placeCiv(f.axis, f.road, dir, off, along, null, y)) return true;
  }
  return false;
}
export function spawnCiv() {
  if (Math.random() < DECK_SHARE && spawnDeckCiv()) return true;
  for (let a = 0; a < 10; a++) {
    const ang = Math.random() * PI * 2, dist = rnd(70, 135);
    const x = player.x + Math.sin(ang) * dist, z = player.z + Math.cos(ang) * dist;
    const rx = Math.round(x / CHUNK) * CHUNK, rz = Math.round(z / CHUNK) * CHUNK;
    if (!onIsland(x, z, 14)) continue;                          // never out to sea
    let axis, road;
    if (Math.abs(x - rx) < Math.abs(z - rz)) { axis = 'z'; road = rx; }
    else { axis = 'x'; road = rz; }
    const dir = Math.random() < 0.5 ? 1 : -1, off = Math.random() < 0.5 ? 2.5 : 5.0;   // inner lane / outer lane beside the parking
    const along = axis === 'z' ? z : x;
    if (isJamLane(axis, road, dir)) {
      // a jam: the lead car and the cars queued behind it, all slow
      const slow = rnd(1.5, 3.5), n = 3 + Math.floor(Math.random() * 3);
      let placed = false;
      for (let k = 0; k < n; k++) if (placeCiv(axis, road, dir, off, along - dir * k * 7.5, slow)) placed = true;
      if (placed) return true;
      continue;
    }
    if (placeCiv(axis, road, dir, off, along, null)) return true;
  }
  return false;
}
