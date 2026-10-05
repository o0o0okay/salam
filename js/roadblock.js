/* Police roadblocks: 2-3 cruisers parked sideways across the road ahead of the player (wanted ≥ roadblockFrom).
   Unlike a static concrete barrier, these are real police units — they can be rammed, wrecked and scored like
   any other cop, and if the player gets close (or lingers too long) they drop the blockade and join the chase. */
import { PI, CHUNK, rnd } from './utils.js';
import { game, player, police, cars } from './state.js';
import { POLICE_TIERS } from './config.js';
import { CAR_DIMS } from './carModels.js';
import { makePoliceUnit } from './police.js';
import { solidAt } from './world.js';
import { overlapsAnything } from './collisions.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';
export function deployRoadblock() {
  // only one live blockade at a time
  if (game.roadblockGroup && game.roadblockGroup.some(p => !p.wrecked && p.role === 'roadblock')) return false;
  const s = Math.sin(player.h), co = Math.cos(player.h);
  const axisZ = Math.abs(co) >= Math.abs(s);
  const ahead = axisZ ? Math.sign(co || 1) : Math.sign(s || 1);
  const pAlong = axisZ ? player.z : player.x, pLat = axisZ ? player.x : player.z;
  const rc = Math.round(pLat / CHUNK) * CHUNK;
  if (Math.abs(pLat - rc) > 12) return false; // player is not on a straight road
  for (let a = 0; a < 5; a++) {
    let along = pAlong + ahead * rnd(100, 135);
    const node = Math.round(along / CHUNK) * CHUNK;
    if (Math.abs(along - node) < 22) along = node + (along >= node ? 24 : -24); // stay clear of intersections
    const cx = axisZ ? rc : along, cz = axisZ ? along : rc;
    if (Math.hypot(cx - player.x, cz - player.z) < 75) continue;
    const tier = Math.max(3, Math.min(5, game.wanted));          // SWAT-tier or better — fits the roadblock tactic
    const info = POLICE_TIERS[tier - 1], kindPool = info.kinds || [info.kind];
    const h = axisZ ? PI / 2 : 0;                                // cars laid sideways: their length spans the road
    const n = 3, spacing = 4.6, slots = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * spacing;
      const x = cx + (axisZ ? off : 0), z = cz + (axisZ ? 0 : off);
      const kind = kindPool[Math.floor(Math.random() * kindPool.length)];
      const dims = CAR_DIMS[kind], tmp = { x, z, ux: Math.sin(h), uz: Math.cos(h), vx: -Math.cos(h), vz: Math.sin(h), e1: dims.e1, e2: dims.e2 };
      if (solidAt(x, z, 1) || overlapsAnything(tmp, null)) { ok = false; break; }
      slots.push({ x, z, kind });
    }
    if (!ok) continue;
    const units = slots.map(sl => {
      const p = makePoliceUnit(tier, sl.x, sl.z, h, sl.kind);
      p.role = 'roadblock'; p.blockT = rnd(11, 16); p.flank = Math.random() < 0.5 ? -1 : 1;
      police.push(p); cars.push(p); return p;
    });
    game.roadblockGroup = units;
    toast('🚧 ROADBLOCK AHEAD!'); sfx.blip(260);
    return true;
  }
  return false;
}