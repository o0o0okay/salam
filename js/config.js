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
export function setDiff(k) {
  cfg.diffKey = k; Object.assign(DIFF, DIFFICULTIES[k]);
  try { localStorage.setItem('escape_road_diff', k); } catch (e) {}
  document.querySelectorAll('#diffPick button').forEach(b => b.classList.toggle('sel', b.dataset.d === k));
}
// Police speeds kept below player (48); rubber-band makes up the difference at range
// `kinds`: visual variants that can spawn within this tier (weighted array — repeat for higher odds)
export const POLICE_TIERS = [
  { kind: 'police1', kinds: ['police1', 'police1', 'police1', 'policeUnmarked', 'policeMoto'], name: 'PATROL SEDANS',
    maxSpeed: 33, accel: 22, brake: 48, turn: 2.45, grip: 7.5, hp: 55, mass: 1.0, prediction: 0.55, impact: 0.8,
    roles: ['chaser', 'chaser', 'interceptor'] },
  { kind: 'police2', kinds: ['police2', 'police2', 'police2', 'policeMoto'], name: 'MUSCLE INTERCEPTORS',
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
