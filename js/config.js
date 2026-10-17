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
// ---- Holding a pinned player (js/police.js holdPin, js/update.js) ----
// Once the player is pinned (the BUSTED bar is filling) the police stop ramming him and hold him for the arrest. A unit at
// him comes in slowly, stops right up against him and stays there. It never backs off for another run: a unit that
// reverses for another go opens the box, the bar drains and he drives out through the gap. Nor does it shove him: while
// the hold lasts, a car right up against him counts as touching him for the bar, and so does a wall.
//   grace    the hold lasts this long after the last pinned frame, so a moment's lost contact does not undo it, s
//   hold     a unit this near the player (box to box, on his level: a Juggernaut on his corner can be 9 m centre to
//            centre) holds him, m
//   join     a unit this near (centre to centre) comes for the player himself instead of its role's own aim (a pincer's
//            flank, a head-on's point ahead of him), no faster than it could stop on him in the gap left, m
//   gap      while he is held, a car or a wall this near him (box to box) counts as touching him, m
//   snug     a holding unit this near him (box to box) has arrived: it stops and stands, m
//   side     a holding unit with him at its side stands where it is when he is nearer than this (box to box): it cannot
//            close in sideways, and through a gap that narrow he cannot get by; further off it goes round to him, m
//   press    the throttle a holding unit comes in with
//   close    the speed a unit comes in at as it arrives, and `closeK` more for each metre still between them, box to
//            box: 6.3 m/s from 3 m out, under 2 m/s as it gets there (a recoil takes a 9 m/s hit), m/s
export const PIN_HOLD = { grace: 0.6, hold: 5, join: 40, gap: 0.4, snug: 0.15, side: 1.6, press: 0.5, close: 1.5, closeK: 1.6 };
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
// ---- Log trucks: a hard hit spills the load (js/logSpill.js) ----
// The closing speed of a crash that knocks the six logs off a log truck's trailer: about 29 km/h, so a real ram
// spills the load and a nudge in a queue does not.
export const LOG_SPILL_V = 8;
// One log (7.2 m long, 0.6 m across) in CAR_DIMS mass units: a little heavier than a family car. It shoves the car it
// hits and a car shoves it; what it knocks down follows from it as well (the thresholds divide by its root, as a car's).
export const LOG_MASS = 1.4;
// A log that meets a car hurts it: the damage per m/s of closing speed above LOG_HIT_MIN, to another car and to the
// player's. A log at 10 m/s wrecks a family car (40 HP), at about 13 m/s the lightest patrol car; the armoured police
// tiers take less of it (js/damage.js hurtCar). The player's car takes about what a crash into a car costs.
export const LOG_HIT_MIN = 2;
export const LOG_DMG_CAR = 5;
export const LOG_DMG_PLAYER = 0.6;
// A log rolls easily across its length and hardly slides along it: the two decelerations on the road (m/s²; rolling
// also loses 0.3 of its speed a second, so a log rolling at 6 m/s comes to rest in about 6 m, at 10 m/s in about 13).
export const LOG_ROLL_DECEL = 1.8;
export const LOG_SLIDE_DECEL = 9;
// A log is no wall: the blows it takes wear it down, and then it breaks up. LOG_HP is how much it can take. A blow
// between a log and a car takes LOG_WEAR off it for every m/s of closing speed over LOG_HIT_MIN, times the reduced mass
// of the two (m·M/(m+M): the heavier the car, the harder the blow). So the player's car breaks a log at about 8 m/s
// (29 km/h), a family car or the lightest patrol car at about 9, a bus or a heavy truck at 5 or 6; a slower blow cracks
// it, and two or three of those break it. The car is hurt by the blow as before and goes on through the pieces, losing
// only the speed it took to break the log. A knock off the world (a wall, a parapet, a tram) wears a log by the speed
// it loses in it over LOG_KNOCK_MIN (m/s), times its own mass: rolling at a wall at 8 m/s breaks it, at 5 it does not.
export const LOG_HP = 20;
export const LOG_WEAR = 5;
export const LOG_KNOCK_MIN = 6;
// How long a spilled log that nothing breaks lies in the street before it crumbles away (s; the six logs of a load
// from 0.85 to 1.15 times this, 1.2 s apart at 20 s, so a load goes one log at a time), and how many can be out at
// once (past that, the oldest go first).
export const LOG_LIFE = 20;
export const LOG_MAX = 48;
