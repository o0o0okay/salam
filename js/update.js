/* Main per-frame update */
import { rnd } from './utils.js';
import { scene } from './renderer.js';
import { sun, headLight } from './renderer.js';
import { game, player, police, civs, cars, flying, fallingTrees, geysers, fires, sight } from './state.js';
import { DIFF } from './config.js';
import { env, updateEnvironment } from './environment.js';
import { CAR_DIMS } from './carModels.js';
import { driveCar, syncCarMesh, removeCar } from './vehicle.js';
import { nearChunks, updateChunks } from './world.js';
import { emit, smoke, sparks, updateParticles } from './particles.js';
import { sfx } from './audio.js';
import { readInput } from './input.js';
import { collideSolids, collideFlyover, collideProps, triggerRamps, carCar, tickPumpFuses, updatePlazaBreaking } from './collisions.js';
import { updateSpikes, deploySpike } from './spikes.js';
import { policeAI, spawnPolice } from './police.js';
import { deployRoadblock } from './roadblock.js';
import { updateHelicopter, helicopter } from './helicopter.js';
import { civAI, spawnCiv } from './civilians.js';
import { updateTrafficLights } from './trafficLights.js';
import { updateWanted, nearMissAward } from './rules.js';
import { updateParking, updateRooftops } from './traffic.js';
import { wreckTick, tickHulks } from './wrecks.js';
import { updateFlying } from './flying.js';
import { updateCamera } from './camera.js';
import { updateHUD, drawRadar, toast } from './ui.js';
import { endGame, showOver } from './flow.js';
function spinPickups(t) {
  for (const ch of nearChunks(player.x, player.z)) for (const pk of ch.pickups) {
    if (pk.taken) continue; pk.mesh.rotation.y = t * 2.6 + pk.ph; pk.mesh.position.y = 1.4 + Math.sin(t * 3 + pk.ph) * 0.2;
  }
}
let hudTick = 0;
export function update(dt) {
  game.t += dt;
  if (game.paused) return;
  game.clock += dt;
  const menu = game.state === 'menu', playing = game.state === 'playing';
  const sdt = playing || menu ? dt : dt * game.slow;
  if (playing) { game.time += sdt; updateWanted(); } else if (!menu) { game.overT += dt; if (!game.overShown && game.overT > 1.1) showOver(); }
  /* --- player --- */
  if (!player.dead) {
    let inp;
    if (playing) {
      inp = readInput(); player.steer += (inp.steer - player.steer) * Math.min(1, sdt * 9);
      // NITRO
      const wantN = inp.nitro && inp.throttle >= 0 && !game.nitroLock && game.nitro > 0;
      game.nitroOn = wantN;
      if (wantN) { game.nitro = Math.max(0, game.nitro - 30 * sdt); inp.throttle = 1; if (game.nitro <= 0) game.nitroLock = true; }
      else {
        game.nitro = Math.min(100, game.nitro + 3.5 * sdt);
        if (Math.abs(player.vl) > 5 && player.speed > 15) game.nitro = Math.min(100, game.nitro + 9 * sdt); // drifting recharges
      }
      if (game.nitroLock && game.nitro > 20) game.nitroLock = false;
    }
    else { inp = { throttle: 0, hand: true }; game.nitroOn = false; player.steer *= 0.9; }
    player.boost += ((game.nitroOn ? 1 : 0) - player.boost) * Math.min(1, sdt * (game.nitroOn ? 5 : 2.5));
    driveCar(player, inp, sdt);
    if (playing) game.dist += player.speed * sdt;
    // nitro flames + rumble
    if (player.boost > 0.25 && playing) {
      const s = Math.sin(player.h), co = Math.cos(player.h);
      for (let k = 0; k < 2; k++) {
        const sx = k ? 0.6 : -0.6;
        emit(player.x - s * 2.3 + co * sx, 0.65, player.z - co * 2.3 - s * sx, -s * rnd(6, 12) + player.vx * 0.4 + rnd(-0.8, 0.8), rnd(-0.3, 0.8), -co * rnd(6, 12) + player.vz * 0.4 + rnd(-0.8, 0.8),
          Math.random() < 0.5 ? 0xff9a2a : 0x6ac8ff, rnd(0.3, 0.55), rnd(0.18, 0.34), 0);
      }
      if (player.boost > 0.5) game.shake = Math.max(game.shake, 0.07 * player.boost);
    }
    // tire smoke + damage smoke
    player.smokeT -= sdt;
    if (player.smokeT <= 0) {
      player.smokeT = 0.05; const s = Math.sin(player.h), co = Math.cos(player.h);
      if (Math.abs(player.vl) > 5 && player.speed > 8) for (const sx of [-1, 1]) smoke(player.x - s * 1.4 + co * sx, 0.3, player.z - co * 1.4 - s * sx, 1, false, 0.9);
      if (game.hp < 45 && playing) smoke(player.x + s * 1.8, 1.3, player.z + co * 1.8, 1, true, 1.2);
      if (game.hp < 22 && playing) emit(player.x + s * 1.8 + rnd(-.4, .4), 1.2, player.z + co * 1.8 + rnd(-.4, .4), rnd(-1, 1), rnd(2, 5), rnd(-1, 1), 0xff8a1a, 0.35, 0.45, 0, 0);
    }
  }
  /* --- police --- */
  if (playing) {
    game.spawnT -= sdt;
    if (game.spawnT <= 0) {
      let active = 0; for (const p of police) if (!p.wrecked) active++;
      const maxP = Math.max(2, Math.round([3, 5, 7, 9, 12][game.wanted - 1] * DIFF.count));
      if (game.tierSpawnPending) { if (spawnPolice(game.tierSpawnPending)) game.tierSpawnPending = 0; }
      else if (active < maxP) spawnPolice();
      game.spawnT = Math.max(1.15, 4.1 - game.wanted * .5 - game.time * 0.012) * DIFF.spawn * rnd(0.8, 1.2);
    }
    // spike strip deployment
    if (game.wanted >= DIFF.spikeFrom) {
      game.spikeT -= sdt;
      if (game.spikeT <= 0) game.spikeT = deploySpike() ? Math.max(9, rnd(17, 25) - game.wanted * 1.6) * DIFF.spike : 2;
    }
    // police roadblock deployment — heavier & rarer than spike strips, kicks in at higher wanted levels
    if (game.wanted >= DIFF.roadblockFrom) {
      game.roadblockT -= sdt;
      if (game.roadblockT <= 0) game.roadblockT = deployRoadblock() ? Math.max(18, rnd(28, 40) - game.wanted * 2) * DIFF.spike : 3;
    }
  }
  const ph = Math.floor(game.t * 7) % 2;
  // Walks the live list by index, without copying it each frame: removeCar() splices the car out, so the index steps
  // back to visit the car that moved into its place.
  for (let i = 0; i < police.length; i++) {
    const p = police[i];
    const dp = Math.hypot(p.x - player.x, p.z - player.z);
    if (p.wrecked) { wreckTick(p, sdt); if ((p.wreckT > 6 && dp > 45) || p.wreckT > 20 || dp > 210) { smoke(p.x, 1, p.z, 6, true, 1.6); removeCar(p); i--; continue; } }
    else {
      driveCar(p, policeAI(p, sdt), sdt);
      p.lights.red.color.setHex(ph ? 0xff2020 : 0x330606); p.lights.blue.color.setHex(ph ? 0x061233 : 0x2a6bff);
      p.smokeT -= sdt;
      if (p.smokeT <= 0) { p.smokeT = 0.1; if (p.hp < p.maxHp * .4) smoke(p.x + Math.sin(p.h) * p.box.e1 * .85, 1.3, p.z + Math.cos(p.h) * p.box.e1 * .85, 1, true, 1.1); if (Math.abs(p.vl) > 6 && p.speed > 10) smoke(p.x - Math.sin(p.h) * p.box.e1 * .68, 0.3, p.z - Math.cos(p.h) * p.box.e1 * .68, 1, false, 0.8); }
      if (p.role !== 'roadblock' && (dp > 210 || (dp > 120 && game.t - Math.max(sight.t, p.tip.t) > 14))) { removeCar(p); i--; }   // lost cop replaced
    }
  }
  updateHelicopter(sdt, playing && game.wanted >= 5);
  if (playing) { // lost-the-cops toast
    const seenAge = game.t - sight.t;
    if (seenAge > 4 && !sight.lostFlag) { sight.lostFlag = true; toast('LOST THEM — KEEP MOVING'); }
    else if (seenAge < 0.5) sight.lostFlag = false;
  }
  /* --- civilian traffic --- */
  if (playing || menu) {
    game.civT -= sdt;
    if (game.civT <= 0) {
      game.civT = 0.7;
      let alive = 0; for (const c of civs) if (!c.wrecked) alive++;
      const maxC = menu ? 10 : 13;
      if (alive < maxC) spawnCiv();
    }
  }
  for (let i = 0; i < civs.length; i++) {          // same index walk as the police loop above
    const c = civs[i];
    const dp = Math.hypot(c.x - player.x, c.z - player.z);
    if (c.wrecked) { wreckTick(c, sdt); if ((c.wreckT > 8 && dp > 45) || c.wreckT > 25 || dp > 190) { smoke(c.x, 1, c.z, 6, true, 1.6); removeCar(c); i--; continue; } }
    else {
      driveCar(c, civAI(c, sdt), sdt);
      c.smokeT -= sdt;
      if (c.smokeT <= 0) { c.smokeT = 0.1; if (c.hp < CAR_DIMS[c.kind].hp * 0.4) smoke(c.x + Math.sin(c.h) * c.box.e1 * 0.85, 1.3, c.z + Math.cos(c.h) * c.box.e1 * 0.85, 1, true, 1.1); if (Math.abs(c.vl) > 5 && c.speed > 8) smoke(c.x - Math.sin(c.h) * 1.4, 0.3, c.z - Math.cos(c.h) * 1.4, 1, false, 0.8); }
      if (dp > 190) { removeCar(c); i--; }
    }
  }
  /* --- burning hulls (parked appliances that burned out): they roll, they burn, they never go away --- */
  tickHulks(sdt);
  /* --- flat tires countdown + sparks, spike strips --- */
  for (const c of cars) {
    if (c.flatT > 0) {
      c.flatT -= sdt;
      if (!c.wrecked && c.speed > 8 && Math.random() < 0.35) sparks(c.x - Math.sin(c.h) * c.box.e1 * 0.5, 0.25, c.z - Math.cos(c.h) * c.box.e1 * 0.5, 1, 0, 0, 3);
    }
  }
  updateSpikes(sdt);
  /* --- hydrant geysers --- */
  for (let i = geysers.length - 1; i >= 0; i--) {
    const g = geysers[i]; g.life -= sdt;
    const n = g.life > 1.5 ? 3 : 1;
    for (let k = 0; k < n; k++) emit(g.x + rnd(-.2, .2), 0.5, g.z + rnd(-.2, .2), rnd(-1.2, 1.2), rnd(11, 17), rnd(-1.2, 1.2), k === 0 ? 0xd6f0ff : 0x8fd3ff, rnd(0.2, 0.4), rnd(0.9, 1.3), 26);
    if (g.life <= 0) geysers.splice(i, 1);
  }
  /* --- burning tanker wrecks --- */
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]; f.life -= sdt;
    if (Math.random() < 0.7) emit(f.x + rnd(-0.9, 0.9), 0.3, f.z + rnd(-0.9, 0.9), rnd(-1, 1), rnd(3, 7), rnd(-1, 1), Math.random() < 0.5 ? 0xff6a1a : 0xffcf4a, rnd(0.3, 0.6), rnd(0.5, 0.9), 9);
    if (Math.random() < 0.2) smoke(f.x, 1, f.z, 1, true, 1.3);
    if (f.life <= 0) fires.splice(i, 1);
  }
  /* --- collisions --- */
  for (const c of cars) { if (c.dead) continue; collideSolids(c); collideFlyover(c); collideProps(c); }
  tickPumpFuses(sdt);                                          // dispensers that caught the fire
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const A = cars[i], B = cars[j]; if (A.dead || B.dead) continue;
    // Two cars at different levels are not touching: one on the flyover deck passes over one on the crossing
    // street below it, and the pair must not shove each other about.
    if (Math.abs(A.y - B.y) > 2.0) continue;
    const dx = A.x - B.x, dz = A.z - B.z, rr = A.box.e1 + B.box.e1 + 1; if (dx * dx + dz * dz > rr * rr) continue; carCar(A, B);
  }
  // Pair separation can push a car back into the parapet: resolve it before drawing this frame.
  for (const c of cars) if (!c.dead) collideFlyover(c);
  for (const c of cars) if (!c.dead && !c.wrecked) triggerRamps(c);
  for (const c of cars) if (!c.dead) syncCarMesh(c, sdt);
  updateFlying(sdt);
  updatePlazaBreaking(sdt);
  /* --- falling trees --- */
  for (let i = fallingTrees.length - 1; i >= 0; i--) {
    const f = fallingTrees[i]; f.life -= sdt;
    f.w += 6 * sdt; f.ang = Math.min(1.5, f.ang + f.w * sdt);
    f.mesh.quaternion.setFromAxisAngle(f.axis, f.ang).multiply(f.yaw);
    if (f.life < 0.8) f.mesh.scale.setScalar(Math.max(0.01, f.life / 0.8));
    if (f.life <= 0) { scene.remove(f.mesh); fallingTrees.splice(i, 1); }
  }
  /* --- pickups, near misses & pinned logic (player only, while playing) --- */
  if (playing) {
    for (const ch of nearChunks(player.x, player.z)) for (const pk of ch.pickups) {
      if (pk.taken) continue;
      if (Math.abs(player.y - 1.4) > 2.2) continue;                    // no collecting through the deck above
      const dx = pk.x - player.x, dz = pk.z - player.z;
      if (dx * dx + dz * dz < 12) {
        pk.taken = true; pk.mesh.visible = false;
        if (pk.kind === 'cash') { game.cash += 25; sfx.blip(1040); toast('+$25'); for (let i = 0; i < 6; i++) emit(pk.x, 1.4, pk.z, rnd(-3, 3), rnd(2, 6), rnd(-3, 3), 0xffd23b, 0.25, 0.6, 12); }
        else if (pk.kind === 'nitro') {
          game.nitro = Math.min(100, game.nitro + 45); if (game.nitroLock && game.nitro > 20) game.nitroLock = false;
          sfx.blip(820); toast('NITRO +45'); for (let i = 0; i < 12; i++) emit(pk.x, 1.4, pk.z, rnd(-3, 3), rnd(2, 6), rnd(-3, 3), 0x6ac8ff, 0.3, 0.7, 10);
        }
        else { game.hp = Math.min(100, game.hp + 30); sfx.blip(660); toast('REPAIRED +30'); for (let i = 0; i < 10; i++) emit(pk.x, 1.4, pk.z, rnd(-3, 3), rnd(2, 6), rnd(-3, 3), 0x44ff77, 0.3, 0.7, 10); }
      }
    }
    // NEAR MISS: pass close to a civilian at speed without touching
    game.comboT -= sdt; if (game.comboT <= 0) game.combo = 0;
    for (const c of civs) {
      if (c.wrecked) { c.nmIn = false; continue; }
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < 8 && player.speed > 20) {
        if (!c.nmIn) { c.nmIn = true; c.nmEnter = game.time; c.nmMin = d; } else if (d < c.nmMin) c.nmMin = d;
      } else if (c.nmIn) {
        c.nmIn = false;
        if (game.time - c.lastTouchPlayer > 1 && c.lastTouchPlayer < c.nmEnter && c.nmMin < 4.2 && player.speed > 18) nearMissAward();
      }
    }
    // BUSTED: pinned against structures / wrecks, or boxed in by vehicles, with at least one cruiser on you
    let policeTouch = 0, vehTouch = 0, wreckTouch = false, policeNear = false;
    for (const c of cars) {
      if (c.isPlayer) continue;
      const recent = game.time - c.lastTouchPlayer < 0.3;
      if (recent) { if (c.wrecked) wreckTouch = true; else { vehTouch++; if (c.isPolice) policeTouch++; } }
      if (c.isPolice && !c.wrecked && Math.hypot(c.x - player.x, c.z - player.z) < 9) policeNear = true;
    }
    const wallLike = game.time - player.lastWall < 0.3 || wreckTouch;
    const pinned = player.speed < 9 && ((policeTouch >= 1 && (wallLike || vehTouch >= 2)) || (policeNear && vehTouch >= 3));
    if (pinned) { game.pin += sdt; } else game.pin = Math.max(0, game.pin - sdt * 1.5);
    if (game.pin > DIFF.pin) endGame('BUSTED');
  }
  /* --- world streaming --- */
  updateChunks(player.x, player.z, playing ? 2 : 1);
  updateParking(dt);       // mall and hospital carparks follow the time of day
  updateRooftops(dt);       // hospital rooftop air ambulance keeps its rotors turning
  updateTrafficLights(dt);
  spinPickups(game.t);
  updateParticles(dt);
  updateCamera(dt);
  /* --- day / night + lights --- */
  updateEnvironment(dt, player.x, player.z, playing);
  if (playing) {
    const isN = env.day < 0.3;
    if (isN !== game.isNight) { game.isNight = isN; toast(isN ? 'NIGHT FALLS 🌙' : 'SUNRISE ☀'); }
  }
  sun.position.set(player.x + env.sx * 70, env.sy * 95, player.z + 30); sun.target.position.set(player.x, 0, player.z);
  if (!player.dead) {
    const s = Math.sin(player.h), co = Math.cos(player.h);
    headLight.position.set(player.x + s * 1.5, 3.5, player.z + co * 1.5); headLight.target.position.set(player.x + s * 16, 0, player.z + co * 16);
    headLight.intensity = env.night * 130;
  } else headLight.intensity = 0;
  /* --- audio + HUD --- */
  let nearest = 999; for (const p of police) if (!p.wrecked) nearest = Math.min(nearest, Math.hypot(p.x - player.x, p.z - player.z));
  sfx.update(player.speed, nearest, playing, game.t, player.boost);
  // helicopter proximity sound — fed the real rotor angle so the "wokka" stays perfectly synced to the visual blur
  const heliActive = !!(helicopter && helicopter.visible);
  const heliDist = heliActive ? Math.hypot(helicopter.x - player.x, helicopter.z - player.z) : 999;
  sfx.updateHeli(heliDist, heliActive, heliActive ? helicopter.rotor.rotation.y : 0);
  // HUD text and the radar canvas redraw do not need 60 Hz: cheap throttling keeps the DOM and the 2D
  // canvas off the critical path (they update at ~20 Hz, which reads as live).
  hudTick = (hudTick + 1) % 3;
  if (!menu && hudTick === 0) { updateHUD(); drawRadar(); }
}