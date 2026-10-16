/* Static tuning data: difficulty, player params, police tiers, wanted thresholds */
export const HEAR_R = 38;
export const HELI_V = 52;          // slower than nitro (~65), faster than normal driving (48)
export const TREE_BREAK_V = 11;    // speed to break a tree (divided by sqrt(mass))
export const PLAYER_PARAMS = { maxSpeed: 48, maxReverse: 16, accel: 30, brake: 58, turn: 2.6, turnFalloff: 55, grip: 8 };
export const DIFFICULTIES = {
  easy:   { speed: .93,  accel: .9,  hp: .8,   count: .7,  spawn: 1.3, esc: 1.35, pin: 4.5, dmg: .7,
            predict: .7,  aggr: .7,  spikeFrom: 3, spike: 1.4,  roadblockFrom: 4, score: .8 },
  normal: { speed: 1,    accel: 1,   hp: 1,    count: 1,   spawn: 1,   esc: 1,    pin: 3,   dmg: 1,
            predict: 1,   aggr: 1,   spikeFrom: 2, spike: 1,    roadblockFrom: 3, score: 1 },
  hard:   { speed: 1.04, accel: 1.1, hp: 1.25, count: 1.35, spawn: .8, esc: .75,  pin: 2.4, dmg: 1.25,
            predict: 1.25, aggr: 1.3, spikeFrom: 2, spike: .75, roadblockFrom: 3, score: 1.3 },
};
export const cfg = { diffKey: 'normal' };
try { cfg.diffKey = localStorage.getItem('escape_road_diff') || 'normal'; } catch (e) {}
if (!DIFFICULTIES[cfg.diffKey]) cfg.diffKey = 'normal';
// DIFF is a persistent object (mutated in place) so every module always sees the current difficulty
export const DIFF = Object.assign({}, DIFFICULTIES[cfg.diffKey]);
// Scale on the damage taken from the scenery: walls, trees, street props, plaza features, bus shelters, scaffolding,
// shop windows, fences and flyover parapets. A bump with a bin or a wall should cost a little, not a chunk of health.
export const ENV_DMG = 0.3;
export function setDiff(k) {
  cfg.diffKey = k; Object.assign(DIFF, DIFFICULTIES[k]);
  try { localStorage.setItem('escape_road_diff', k); } catch (e) {}
  document.querySelectorAll('#diffPick button').forEach(b => b.classList.toggle('sel', b.dataset.d === k));
}
// Police speeds kept below player (48); rubber-band makes up the difference at range
// `kinds`: visual variants that can spawn within this tier (weighted array — repeat for higher odds)
export const POLICE_TIERS = [
  { kind: 'police1', kinds: ['police1', 'police1', 'police1', 'policeUnmarked'], name: 'PATROL SEDANS',
    maxSpeed: 33, accel: 22, brake: 48, turn: 2.45, grip: 7.5, hp: 55, mass: 1.0, prediction: 0.55, impact: 0.8,
    roles: ['chaser', 'chaser', 'interceptor'] },
  { kind: 'police2', kinds: ['police2', 'police2', 'police2'], name: 'MUSCLE INTERCEPTORS',
    maxSpeed: 43, accel: 32, brake: 57, turn: 2.8, grip: 8.0, hp: 90, mass: 1.55, prediction: 1.05, impact: 1.05,
    roles: ['sideswipe', 'sideswipe', 'interceptor', 'chaser'] },
  { kind: 'police3', kinds: ['police3', 'police3', 'police3', 'policeVan'], name: 'SWAT ROADBLOCKS',
    maxSpeed: 40, accel: 26, brake: 62, turn: 2.15, grip: 8.8, hp: 190, mass: 3.2, prediction: 1.35, impact: 1.35,
    roles: ['blocker', 'pit', 'blocker', 'interceptor'] },
  { kind: 'police4', kinds: ['police4', 'police4', 'policeVan'], name: 'ARMORED BEARCATS',
    maxSpeed: 44, accel: 29, brake: 68, turn: 2.0, grip: 9.5, hp: 330, mass: 5.4, prediction: 1.65, impact: 1.7,
    roles: ['rammer', 'pincer', 'pinner', 'rammer'] },
  { kind: 'police5', kinds: ['police5'], name: 'JUGGERNAUTS + AIR UNIT',
    maxSpeed: 47, accel: 32, brake: 75, turn: 1.82, grip: 10.5, hp: 520, mass: 8.3, prediction: 2.05, impact: 2.15,
    roles: ['headon', 'pinner', 'pincer', 'rammer'] },
];
// Stars rise slower and scale with difficulty
export const WANTED_AT = [0, 30, 70, 115, 165];
// A burnt-out hull has no driver: it coasts on the handbrake and skids, so it only needs a top speed it can
// never reach and a grip that lets it slide when the player shoves it (see js/wrecks.js and js/collisions.js).
export const HULK_PARAMS = { maxSpeed: 46, maxReverse: 8, accel: 0, brake: 34, turn: 1.5, turnFalloff: 40, grip: 9.4 };
// ---- Street furniture (js/world.js) ----
// The hydrants on the pavement: the share of the hydrant spots that get one (a spot left empty stays taken while the
// block is laid out, so nothing else in the block moves). 0.5: half as many hydrants as before.
export const HYDRANT_KEEP = 0.5;
// Metered parking: the chance that a kerb side of a busy block (downtown, a shopping street, the bazaar, a mall, a bank)
// has a run of painted parking bays with a meter at each (meteredParking).
export const METER_SIDE_P = 0.25;
// Phone booths: the chance that a block of each type has one on its pavement (phoneBooths, one at most a block). Other
// types have none. Five times the first cut, which was too few to come across (195 on the island, about one per 2 km of
// street): now about 930, one per 430 m or so, in two busy blocks out of three and by nearly every bank, hospital, school
// and filling station. Each block keeps its own roll, so raising a chance only adds booths: none of them move.
export const BOOTH_P = { downtown: 0.65, shops: 0.65, bazaar: 0.65, commercial: 0.65, bank: 1, hospital: 1, school: 1, fuel: 1, suburb: 0.2, park: 0.25 };
