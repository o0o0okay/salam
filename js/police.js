/* Police AI + spawning */
import { PI, CHUNK, clamp, lerp, wrapAngle, rnd } from './utils.js';
import { game, player, sight, reportSighting, police, cars } from './state.js';
import { DIFF, HEAR_R, POLICE_TIERS } from './config.js';
import { env } from './environment.js';
import { CAR_DIMS } from './carModels.js';
import { createCar } from './vehicle.js';
import { solidAt } from './world.js';
import { overlapsAnything } from './collisions.js';
function roadPointNear(x, z, spread) { // a random point on a road near (x,z)
  return Math.random() < 0.5
    ? { x: Math.round((x + rnd(-spread, spread)) / CHUNK) * CHUNK + rnd(-3, 3), z: z + rnd(-spread, spread) }
    : { x: x + rnd(-spread, spread), z: Math.round((z + rnd(-spread, spread)) / CHUNK) * CHUNK + rnd(-3, 3) };
}
function losBlocked(p, tx, tz) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), n = Math.min(14, Math.ceil(Math.min(d, 90) / 6));
  for (let i = 1; i <= n; i++) { const t = (i / n) * Math.min(1, 90 / d); if (solidAt(p.x + dx * t, p.z + dz * t, 1.2)) return true; }
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
    p.sees = d < HEAR_R || (d < range && !losBlocked(p, player.x, player.z));
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
      if (!p.arrived && Math.hypot(ex - p.x, ez - p.z) > 28) p.search = solidAt(ex, ez, 3) ? roadPointNear(ex, ez, 25) : { x: ex, z: ez };
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
  p.navT -= dt;
  if (p.navT <= 0) {
    p.navT = 0.25 + Math.random() * 0.14;
    p.navOn = !ramming && Math.hypot(tx - p.x, tz - p.z) > 20 && losBlocked(p, tx, tz);
    if (p.navOn) navWaypoint(p, tx, tz);
  }
  if (p.navOn) { tx = p.navX; tz = p.navZ; if (Math.hypot(tx - p.x, tz - p.z) < 9) p.navT = 0; }
  const desired = Math.atan2(tx - p.x, tz - p.z), diff = wrapAngle(desired - p.h), vf = p.vf;
  let steer = clamp(diff * (p.tier >= 4 ? 2.8 : 2.35), -1, 1), throttle = 1;
  if (Math.abs(diff) > 1.0 && vf > (p.tier >= 4 ? 30 : 22)) throttle = -0.1;
  if (blockerHold) throttle = vf > 2 ? -1 : 0;
  if (d > 14) {
    const L = 7 + Math.max(0, vf) * 0.4, probe = a => { const g = p.h + a; return solidAt(p.x + Math.sin(g) * L, p.z + Math.cos(g) * L, p.box.e2); };
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
    const used = r => police.filter(q => !q.wrecked && q.role === r).length;
    p.role = info.roles.map(r => ({ r, s: used(r) + Math.random() })).sort((a, b) => a.s - b.s)[0].r;
    // Split flank between left/right
    const nL = police.filter(q => !q.wrecked && q.flank < 0).length, nR = police.filter(q => !q.wrecked && q.flank > 0).length;
    p.flank = nL > nR ? 1 : -1;
    police.push(p); cars.push(p); return true;
  }
  return false;
}