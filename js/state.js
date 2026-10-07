/* Shared mutable game state */
import { DIFF } from './config.js';


export const game = { state: 'menu', time: 0, t: 0, clock: 0, dist: 0, cash: 0, takedowns: 0, hp: 100, pin: 0, shake: 0, spawnT: 2, slow: 1, overT: 0, overShown: false, reason: '', paused: false, best: 0, score: 0, wanted: 1, wantedLast: 1, tierSpawnPending: 0, civT: 0,
  nitro: 60, nitroLock: false, nitroOn: false, combo: 0, comboT: 0, nearMiss: 0, spiked: 0, spikeT: 6, isNight: false,
  debugWanted: 1 /* DEBUG: manual wanted level (T key) */ };
try { game.best = parseInt(localStorage.getItem('escape_road_best') || '0') || 0; } catch (e) {}


export const police = [];
export const civs = [];
export const cars = [];
export const spikes = [];
export const flying = [];        // broken props in flight
export const fallingTrees = [];
export const geysers = [];       // broken hydrants spraying water
export const fires = [];         // burning wrecks (exploded fuel tankers)


// Persistent player object: filled with Object.assign(player, createCar(...)) in resetWorld
export const player = {};


// Shared police knowledge of the player (radio). Updated whenever any cop sees you or the helicopter is locked on.
export const sight = { x: 0, z: 0, vx: 0, vz: 0, t: -99, heliLock: 0, heliOn: false, lostFlag: false };
export function reportSighting() { sight.x = player.x; sight.z = player.z; sight.vx = player.vx; sight.vz = player.vz; sight.t = game.t; }


export const calcScore = () => Math.floor((Math.floor(game.dist * 0.5) + game.takedowns * 200 + game.cash) * DIFF.score);