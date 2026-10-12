/* Hiding: a car that the police have not seen for a while, and that they cannot drive to quickly, is punished.
 *
 * "Hidden" (updateHiding): no pursuer has seen the car for UNSEEN seconds, and the nearest pursuer within NEAR metres
 * either cannot reach it on the ground at all inside the search square, or has to drive more than HIDE_DETOUR times
 * the straight-line distance to get there (and at least HIDE_MIN metres of driving). The driving distance is a
 * breadth-first search over ground cells from the car, so a car that sits between two buildings with a clear way round
 * is not hidden; a car in a pocket the cars cannot get into is. A car in a chase is never hidden: the police see it.
 *
 * What hiding costs (all of it stops the moment the car is found again):
 *   - the search goes to the car itself (police.js, the search branch reads game.hideT);
 *   - the wanted clock runs faster: game.hideBonus gains 1.5 s per second hidden (rules.js). It is kept after the hide ends;
 *   - the score is docked: game.hidePen gains 12 points a second (state.js, calcScore). Kept after the hide ends;
 *   - from 8 s hidden, a spike strip, and a roadblock at wanted 3+, are laid ahead of the car every 12 s;
 *   - from 20 s hidden the air unit is sent (update.js), whatever the wanted level, and can lock on behind buildings.
 * game.hideT counts the seconds of the current hide. */
import { game, player, sight, police } from './state.js';
import { solidAt } from './world.js';
import { deploySpike } from './spikes.js';
import { deployRoadblock } from './roadblock.js';
import { toast } from './ui.js';

const UNSEEN = 12, NEAR = 100, CELL = 2.5, HIDE_DETOUR = 2.5, HIDE_MIN = 40;
const N = Math.round(2 * NEAR / CELL) + 1, MID = (N - 1) / 2;
const seen = new Uint8Array(N * N), dist = new Int32Array(N * N), queue = new Int32Array(N * N), copAt = new Int32Array(N * N);
const CAR_HALF = 1.0;             // half width the car needs to get through: the physical box, not the route's margin
let timer = 0, hidden = false, toolT = 0;

// Driving distance (metres) from the car to the nearest pursuer inside the box, and that pursuer's straight distance.
// -1 for the distance when no pursuer can be reached inside the box.
function drivingTo(cops) {
  seen.fill(0); copAt.fill(-1);
  const cellOf = (x, z) => [Math.round((x - player.x) / CELL + MID), Math.round((z - player.z) / CELL + MID)];
  cops.forEach((c, k) => {
    const [ci, cj] = cellOf(c.x, c.z);
    if (ci >= 0 && cj >= 0 && ci < N && cj < N) copAt[cj * N + ci] = k;
  });
  const s0 = MID * N + MID;
  let head = 0, tail = 0;
  queue[tail++] = s0; seen[s0] = 1; dist[s0] = 0;
  while (head < tail) {
    const c = queue[head++], i = c % N, j = (c - i) / N;
    if (copAt[c] >= 0) return { steps: dist[c] * CELL, cop: copAt[c] };
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nc = nj * N + ni;
      if (seen[nc]) continue;
      seen[nc] = 1;
      if (copAt[nc] < 0 && solidAt(player.x + (ni - MID) * CELL, player.z + (nj - MID) * CELL, CAR_HALF, 0.5)) continue;
      dist[nc] = dist[c] + 1; queue[tail++] = nc;
    }
  }
  return { steps: -1, cop: -1 };
}

function evaluate() {
  if (game.t - sight.t < UNSEEN) return false;
  const cops = police.filter(p => !p.wrecked && p.role !== 'roadblock' && Math.hypot(p.x - player.x, p.z - player.z) <= NEAR);
  if (!cops.length) return false;                              // nobody near: that is not hiding, it is driving away
  const r = drivingTo(cops);
  if (r.steps < 0) return true;                                 // no pursuer can get to him inside the box
  const straight = Math.hypot(cops[r.cop].x - player.x, cops[r.cop].z - player.z);
  return r.steps >= HIDE_MIN && r.steps > HIDE_DETOUR * straight;
}

export function updateHiding(dt) {
  timer -= dt;
  if (timer <= 0) {
    timer = 0.5;
    const now = evaluate();
    if (now && !hidden) toast('HIDING — THEY ARE COMING FOR YOU');
    if (!now && hidden) toast('FOUND AGAIN');
    hidden = now;
  }
  if (!hidden) { game.hideT = 0; toolT = 0; return; }
  game.hideT = (game.hideT || 0) + dt;
  game.hideBonus = (game.hideBonus || 0) + dt * 1.5;
  game.hidePen = (game.hidePen || 0) + dt * 12;
  if (game.hideT >= 8) {
    toolT -= dt;
    if (toolT <= 0) { toolT = 12; deploySpike(); if (game.wanted >= 3) deployRoadblock(); }
  }
}
