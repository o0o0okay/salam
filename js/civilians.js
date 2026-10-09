/* Civilian traffic - lane routing + reactive AI.
   Right-hand traffic. Lane position: axis z -> x = road - dir*off ; axis x -> z = road + dir*off */
import { PI, CHUNK, clamp, wrapAngle, rnd } from './utils.js';
import { player, police, cars, civs } from './state.js';
import { CAR_DIMS } from './carModels.js';
import { createCar } from './vehicle.js';
import { solidAt, nearChunks, plazaIn } from './world.js';
import { overlapsAnything } from './collisions.js';
import { lightGo } from './trafficLights.js';
import { isFlyoverNode, plazaAt } from './flyover.js';

const CIV_KINDS = [
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
  'cementtruck',
  'fueltanker'
];

const CIV_COLORS = [0xe34a4a, 0x3a7bd5, 0x39b36b, 0xf2a93b, 0xeeeeee, 0x8e5bd9, 0x2f3340, 0x58c7d6, 0xf07ab8, 0xb0b8c4];
const BUS_COLORS = [0x3b82c4, 0xe8b02a, 0x3f9e48, 0xffffff];
const PASTEL_COLORS = [0xd9c7a3, 0x9fb8d9, 0xc9a0dc, 0xdfe0c0, 0xb5d8c0, 0xe3b9a6];
const TRUCK_COLORS = [0xe8a33a, 0xd64545, 0x3a7bd5, 0xeeeeee, 0x4a7a45];
const TANKER_COLORS = [0xf4f4f4, 0xe8e8e8, 0xd0d0d0, 0xc7cdd2];

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
  if (kind === 'cementtruck') return TRUCK_COLORS[Math.floor(Math.random() * TRUCK_COLORS.length)];
  if (kind === 'fueltanker') return TANKER_COLORS[Math.floor(Math.random() * TANKER_COLORS.length)];
  return CIV_COLORS[Math.floor(Math.random() * CIV_COLORS.length)];
}

function civParams(kind) {
  switch (kind) {
    case 'bus': return { maxSpeed: 20, maxReverse: 6, accel: 9, brake: 30, turn: 1.7, turnFalloff: 40, grip: 9 };
    case 'van': return { maxSpeed: 24, maxReverse: 7, accel: 11, brake: 36, turn: 2.0, turnFalloff: 45, grip: 8.5 };
    case 'limo': return { maxSpeed: 25, maxReverse: 7, accel: 10, brake: 34, turn: 1.6, turnFalloff: 48, grip: 8.5 };
    case 'suv': return { maxSpeed: 27, maxReverse: 8, accel: 13, brake: 38, turn: 2.2, turnFalloff: 48, grip: 8.2 };
    case 'pickup': return { maxSpeed: 27, maxReverse: 8, accel: 14, brake: 40, turn: 2.4, turnFalloff: 50, grip: 8 };
    case 'sportscar': return { maxSpeed: 34, maxReverse: 9, accel: 19, brake: 46, turn: 2.7, turnFalloff: 55, grip: 7.6 };
    case 'oldclassic': return { maxSpeed: 23, maxReverse: 7, accel: 11, brake: 34, turn: 2.0, turnFalloff: 46, grip: 8.4 };
    case 'hatchback': return { maxSpeed: 28, maxReverse: 8, accel: 15, brake: 42, turn: 2.6, turnFalloff: 52, grip: 7.8 };
    case 'cementtruck': return { maxSpeed: 17, maxReverse: 5, accel: 7, brake: 26, turn: 1.25, turnFalloff: 36, grip: 9.5 };
    case 'fueltanker': return { maxSpeed: 18, maxReverse: 5, accel: 7.5, brake: 24, turn: 1.0, turnFalloff: 32, grip: 9.6 };
    default: return { maxSpeed: 27, maxReverse: 8, accel: 14, brake: 40, turn: 2.4, turnFalloff: 50, grip: 8 };
  }
}

function civCruise(kind) {
  if (kind === 'bus') return rnd(7, 9);
  if (kind === 'van' || kind === 'limo') return rnd(8, 11);
  if (kind === 'sportscar') return rnd(13, 18);
  if (kind === 'oldclassic') return rnd(7, 10);
  if (kind === 'cementtruck' || kind === 'fueltanker') return rnd(6, 8.5);
  return rnd(9, 14);
}

const _lp = { x: 0, z: 0 };

export function civPanic(c, hard) {
  if (c.wrecked) return;
  if (!hard && (c.panicT > 0 || c.panicCool > 0)) return;
  if (hard && c.panicT > 1.5) return;
  c.panicT = hard ? 3.2 : 2.6;
  c.panicCool = 3.5;
  c.panicMode = hard ? (Math.random() < 0.5 ? 1 : 2) : Math.floor(Math.random() * 3);
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
    let threat = dp < 24 && player.speed > 11 && !player.dead;
    if (!threat) {
      for (const p of police) {
        if (!p.wrecked && Math.hypot(p.x - c.x, p.z - c.z) < 20) { threat = true; break; }
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
    if (Math.random() < 0.4 && !isFlyoverNode(ixN, izN) && !plazaAt(ixN / CHUNK, izN / CHUNK)) {
      c.axis = c.axis === 'z' ? 'x' : 'z';
      c.dir = Math.random() < 0.5 ? 1 : -1;
      c.road = node;
    }
  }

  const sp = c.vf, s = Math.sin(c.h), co = Math.cos(c.h);
  lanePoint(c, 9 + Math.max(0, sp) * 0.55, _lp);

  // Plaza avoidance: civilian cars steer around the roundabout island instead of driving through it.
  // The plaza (radius 5 m) sits at the junction centre, so a car driving straight through would hit it.
  // Cars curve outward — away from the road centre — to pass between the island and the kerb (8 m out).
  // The swerve is proportional to how far the car's lane is from the kerb: inner-lane cars (off=2.5)
  // swerve more than outer-lane cars (off=5.0) which are already near the edge.
  // Police cars are not subject to this — they drive through in pursuit.
  // Must run BEFORE the desired heading is computed from _lp, so the offset takes effect.
  {
    // Find the next junction ahead (same pattern as the traffic-light check below): the nearest junction
    // rounded to, then stepped one CHUNK in the direction of travel if the car is at or past it.
    let nextAlong = Math.round(along / CHUNK) * CHUNK;
    if (c.dir > 0 && nextAlong <= along + 0.01) nextAlong += CHUNK;
    if (c.dir < 0 && nextAlong >= along - 0.01) nextAlong -= CHUNK;
    const distToJunction = (nextAlong - along) * c.dir;
    if (distToJunction > 0 && distToJunction < 35) {
      const jx = c.axis === 'z' ? c.road : nextAlong, jz = c.axis === 'z' ? nextAlong : c.road;
      const pz = plazaIn(jx, jz);
      if (pz) {
        const proximity = 1 - distToJunction / 35;
        // How far the car's centre must move outward to clear the island (5 m radius + ~1 m car half-width
        // + 0.5 m margin = 6.5 m from the junction centre). Inner-lane cars need more swerve.
        const needOut = Math.max(0, 6.5 - c.off);
        const swerve = needOut * proximity;
        // Outward direction: for axis 'z' the car sits at road - dir*off, so outward is -dir in x.
        // For axis 'x' the car sits at road + dir*off, so outward is +dir in z.
        if (c.axis === 'z') { _lp.x -= c.dir * swerve; }
        else { _lp.z += c.dir * swerve; }
      }
    }
  }

  const desired = Math.atan2(_lp.x - c.x, _lp.z - c.z), diff = wrapAngle(desired - c.h);
  let steer = clamp(diff * 2.4, -1, 1), target = c.cruise;

  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dz = o.z - c.z;
    if (dx * dx + dz * dz > 400) continue;
    const f = dx * s + dz * co, l = dx * co - dz * s;
    if (f > 0 && f < 5 + Math.max(0, sp) * 0.9 + o.box.e1 && Math.abs(l) < 2.3) {
      target = Math.min(target, f < 7 + o.box.e1 ? 0 : o.speed * 0.8);
    }
  }

  const L = 6 + Math.max(0, sp) * 0.4;
  // The look-ahead is asked from the car's own height: on a flyover the embankment below the ramp is not a wall,
  // and a car at grade beside the structure is still told it is there. Asking from the ground was what used to
  // send climbing cars swerving off to the edges of the bridge.
  if (solidAt(c.x + s * L, c.z + co * L, 1.2, c.y)) {
    target = Math.min(target, 3);
    steer = solidAt(c.x + Math.sin(c.h + 0.5) * L, c.z + Math.cos(c.h + 0.5) * L, 1.2, c.y) ? -1 : 1;
  }

  // Plaza proximity slow-down: if the car is within 20 m of a plaza it eases off the throttle for the curve.
  {
    const pzNear = plazaIn(c.x + s * 12, c.z + co * 12);
    if (pzNear) target = Math.min(target, c.cruise * 0.7);
  }

  {
    let nextNode = Math.round(along / CHUNK) * CHUNK;
    if (c.dir > 0 && nextNode <= along + 0.01) nextNode += CHUNK;
    if (c.dir < 0 && nextNode >= along - 0.01) nextNode -= CHUNK;
    const distAhead = (nextNode - along) * c.dir;
    if (distAhead > 0 && distAhead < 17) {
      const ix = c.axis === 'z' ? c.road : nextNode, iz = c.axis === 'z' ? nextNode : c.road;
      if (!lightGo(ix, iz, c.axis)) {
        const stopDist = distAhead - 13;
        if (stopDist >= 0 && stopDist < 11) target = Math.min(target, stopDist * 1.6);
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

  let throttle = sp < target - 0.5 ? 0.75 : sp > target + 1.5 ? -0.6 : 0;

  if (c.panicT > 0) {
    c.panicT -= dt;
    if (c.panicMode === 0) { throttle = -1; steer *= 0.3; }
    else if (c.panicMode === 1) {
      if (c.panicT > 1.9) { steer = c.swerve; throttle = 1; }
      else throttle = sp < 20 ? 1 : 0;
    } else {
      throttle = sp < 24 ? 1 : 0;
    }
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

  c.steer += (steer - c.steer) * Math.min(1, dt * 7);
  return { throttle, hand: false };
}

export function spawnCiv() {
  for (let a = 0; a < 10; a++) {
    const ang = Math.random() * PI * 2, dist = rnd(70, 135);
    let x = player.x + Math.sin(ang) * dist, z = player.z + Math.cos(ang) * dist;
    const rx = Math.round(x / CHUNK) * CHUNK, rz = Math.round(z / CHUNK) * CHUNK;
    let axis, road;
    if (Math.abs(x - rx) < Math.abs(z - rz)) { axis = 'z'; road = rx; }
    else { axis = 'x'; road = rz; }
    const dir = Math.random() < 0.5 ? 1 : -1, off = Math.random() < 0.5 ? 2.5 : 5.0;   // inner lane / outer lane beside the parking
    if (axis === 'z') x = road - dir * off; else z = road + dir * off;
    const along = axis === 'z' ? z : x;
    if (Math.abs(along - Math.round(along / CHUNK) * CHUNK) < 20) continue;   // keep clear of the wide junctions
    if (Math.hypot(x - player.x, z - player.z) < 55) continue;
    const h = laneHeading(axis, dir), kind = CIV_KINDS[Math.floor(Math.random() * CIV_KINDS.length)], dims = CAR_DIMS[kind];
    const tmp = { x, z, ux: Math.sin(h), uz: Math.cos(h), vx: -Math.cos(h), vz: Math.sin(h), e1: dims.e1 + 2, e2: dims.e2 };
    if (overlapsAnything(tmp, null)) continue;
    const color = civColor(kind);
    const params = civParams(kind);
    const c = createCar(kind, x, z, h, params, color);
    c.axis = axis; c.dir = dir; c.road = road; c.off = off; c.cruise = civCruise(kind);
    c.vx = Math.sin(h) * c.cruise; c.vz = Math.cos(h) * c.cruise;
    civs.push(c); cars.push(c);
    return true;
  }
  return false;
}