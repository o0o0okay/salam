/* Ambient city life, live: shopping-centre and hospital car parks that follow the clock, the hospital
 * rooftop air ambulance idling on its pad, and the fire station roster.
 *
 * Occupancy comes from the shared rule in world.js, so the bays the generator filled and the bays this
 * system tops up always agree: a floor of ordinary cars, a 20% ceiling on the whole lot once the vehicles
 * that are always parked there (hospital ambulances) are counted in, and a peak in the middle of the day.
 *
 * Destruction is permanent: a wrecked unit's burnt hulk stays exactly where it burned and that bay is out
 * of service for the rest of the run. Nothing respawns. The only traffic a roster bay ever sees is a unit
 * leaving on a call and driving back in. */
import { env } from './environment.js';
import { game, player } from './state.js';
import { scene } from './renderer.js';
import { nearChunks, addParkedCarToChunk, lotCars, ambulanceTarget, RELIEF_DELAY } from './world.js';

const CAR_KINDS = ['sedan', 'hatchback', 'suv', 'oldclassic', 'sedan', 'suv'];
const CAR_COLORS = [0xe34a4a, 0x3a7bd5, 0x39b36b, 0xf2a93b, 0xeeeeee, 0x8e5bd9, 0x2f3340];
const FLOOR = 2;              // default floor for ordinary cars; a block can raise it (ch.parkingFloor)
const LOTS = new Map();       // chunk key -> { chunk, reliefT }

const pick = a => a[Math.floor(Math.random() * a.length)];

// Takes a car out of the world for good: hands its bay back and stops it blocking anything.
function retireCar(ch, car, slot) {
  if (car.solid) { car.solid.hx = car.solid.hz = -999; }
  car.gone = true;
  car.mesh.visible = false;
  const i = ch.spill.indexOf(car);
  if (i >= 0) {                                               // run-time cars leave the world straight away
    ch.spill.splice(i, 1);
    scene.remove(car.mesh);                                   // geometry is shared with every other car (ASSET.wheelGeo
  }                                                           // and friends), so nothing here may be disposed
  if (slot) ch.parking.push(slot);                            // the bay is free for a later arrival
}
// Puts a car that left on an errand back on its bay (used by the ambulance day/night roster).
function wakeCar(car, slot) {
  car.mesh.visible = true;
  if (car.solid && car.solid.base) { car.solid.hx = car.solid.base.hx; car.solid.hz = car.solid.base.hz; }
}
// Fades a car in over about half a second.
function fadeIn(c) {
  c.fade = c.fade === undefined ? 0 : c.fade;
  c.fade = Math.min(1, c.fade + 0.06);
  c.mesh.traverse(o => {
    if (!o.isMesh || o.userData.beam) return;
    o.material = o.userData.lotMat || (o.userData.lotMat = o.material);
    if (!o.userData.faded) { o.userData.faded = o.material.clone(); o.userData.faded.transparent = true; o.userData.faded.opacity = 0; }
    o.userData.faded.opacity = c.fade;
    o.userData.faded.transparent = c.fade < 1;
  });
}
// A roster of permanent bays (fire appliances, ambulances). A wrecked unit is never replaced: its burnt hulk
// stays where it burned and that bay is out of service for good, so a run that wrecks a station's fleet
// really does run the station down. A bay is only ever filled when it has never held a vehicle yet (the
// third ambulance that comes on at night) — never after a wreck.
function staffSlots(ch, slots, want) {
  for (const slot of slots) {
    if (slot.car && (slot.car.broken || slot.car.gone)) {
      slot.wreck = slot.car;                                   // burnt out: it stays exactly where it is
      slot.car = null;
    }
  }
  let live = 0; for (const sl of slots) if (sl.car && !sl.out) live++;
  // Send an extra unit out (an ambulance on a call) and bring it back when the roster needs it again. The
  // bays are walked backwards so it is the relief unit that goes out, never one of the two front bays.
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i];
    if (live <= want) break;
    if (!slot.car || slot.out) continue;
    slot.out = true; slot.car.mesh.visible = false;
    if (slot.car.solid) { slot.car.solid.hx = slot.car.solid.hz = -999; }
    live--;
  }
  for (const slot of slots) {                                   // a unit that was out is called back in
    if (live >= want) break;
    if (!slot.car || !slot.out) continue;
    slot.out = false; slot.car.fade = 0;                        // it drives back in, no popping
    wakeCar(slot.car, slot);
    live++;
  }
  for (const slot of slots) {                                   // a bay that has never held a vehicle yet
    if (live >= want) break;
    if (slot.car || slot.wreck) continue;                       // wrecked bays stay wrecked for the whole run
    const car = addParkedCarToChunk(ch, slot.kind, slot.color, slot);
    if (!car) break;
    car.fade = 0; slot.car = car; live++;
  }
  for (const slot of slots) if (slot.car && !slot.out && slot.car.fade !== 1) fadeIn(slot.car);
}

export function updateParking(dt = 1 / 60) {
  if (game.state === 'menu') return;                           // lots only fill while the run is on
  const seen = new Set();
  for (const ch of nearChunks(player.x, player.z)) {
    const key = ch.cx + '_' + ch.cz;
    seen.add(key);
    let lot = LOTS.get(key);
    if (!lot || lot.chunk !== ch) { lot = { chunk: ch, reliefT: 0 }; LOTS.set(key, lot); }   // rebuilt block, fresh books

    // ---- ordinary cars: the day/night curve, counted together with the cars the generator parked ----
    const bays = ch.parkingTotal || 0;
    if (bays) {
      const standing = ch.lotStanding || (ch.lotStanding = []);
      for (let i = standing.length - 1; i >= 0; i--) {
        const rec = standing[i];
        if (rec.car.broken || rec.car.gone) {                  // rammed: out of the books, bay empty for a while
          standing.splice(i, 1);
          retireCar(ch, rec.car, rec.slot);
          lot.reliefT = RELIEF_DELAY;
        }
      }
      const want = lotCars(bays, ch.parkingFixed || 0, env.phase, ch.parkingFloor || FLOOR);
      while (standing.length > want) {                          // the lot thins out as the day winds down
        const rec = standing.pop();                             // generator cars go first, run-time cars last
        retireCar(ch, rec.car, rec.slot);
      }
      lot.reliefT = Math.max(0, lot.reliefT - dt);
      while (standing.length < want && ch.parking.length && lot.reliefT <= 0) {
        const slot = ch.parking.splice(Math.floor(Math.random() * ch.parking.length), 1)[0];
        const car = addParkedCarToChunk(ch, pick(CAR_KINDS), pick(CAR_COLORS), slot);
        if (!car) { ch.parking.push(slot); break; }
        car.fade = 0;
        standing.push({ car, slot });
      }
      for (const rec of standing) if (rec.car.fade !== 1) fadeIn(rec.car);
    }
    // ---- hospital ambulances: two or three on station at every hour ----
    if (ch.ambulanceSlots && ch.ambulanceSlots.length) {
      staffSlots(ch, ch.ambulanceSlots, ambulanceTarget(env.phase));
    }
    // ---- fire station: three to five appliances, on station from the first frame ----
    if (ch.fireSlots && ch.fireSlots.length) staffSlots(ch, ch.fireSlots, ch.fireSlots.length);
    // ---- school bus stand: the yellow fleet stands in its bays, and a wrecked bus is never replaced ----
    if (ch.busSlots && ch.busSlots.length) staffSlots(ch, ch.busSlots, ch.busSlots.length);
  }
  for (const [key, lot] of LOTS) if (!seen.has(key)) LOTS.delete(key);   // forget blocks that streamed away
}

// ---- hospital rooftop: the air ambulance idles on its pad ----
// Rotors turn slowly and the beacons flash; the mesh references live on the chunk, so a chunk that streams
// away simply disappears with its rotor references and no cleanup is needed beyond the group it owns.
export function updateRooftops(dt) {
  if (game.state === 'menu') return;
  for (const ch of nearChunks(player.x, player.z)) {
    const h = ch.heli;
    if (!h) continue;
    h.rotor.rotation.y += dt * 6;        // main rotor, ~1 turn per second: idling, not taking off
    h.tail.rotation.x += dt * 26;        // tail rotor spins fast enough to read as a blur
    const on = game.t % 1.2 < 0.6;       // beacons flash twice per second or so
    for (const b of h.beacons) {
      if (!b || !b.color || !b.color.setHex || !b.color.getHex) continue;
      if (b.userData.base === undefined) b.userData.base = b.color.getHex();
      b.color.setHex(on ? b.userData.base : (b.userData.base >> 2) & 0x3f3f3f);
    }
  }
}
