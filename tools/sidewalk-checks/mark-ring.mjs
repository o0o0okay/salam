/* The mark's light in the world (js/markBeam.js): the column of light on the marked place, and the circle round its foot.
   * the circle breathes: it grows from 3.2 m to 5.6 m and shrinks back, smoothly, once every 1.4 s, centred on the mark;
   * driving onto the circle finishes the mark: once the car's centre is inside the circle at its largest the mark is
     cleared (the map, the radar and the road arrows all drop it), and not a frame before. The light then goes out with a
     short flourish (the circle opens out and fades) and is gone after it;
   * a car parked just outside the circle does not finish the mark, however long it stays there;
   * a fast car that crosses the circle between two frames still finishes it, but a jump across the map does not;
   * a mark set with the car already on its circle is not finished at once, only after the car has been off it;
   * the light stands on the mark's own level: on the ground for a mark on the street under a deck, up on the deck for a
     mark on the deck, and on a ramp's surface, its circle tilted to the slope, for a mark on a ramp. The car finishes a mark
     only on that level: driving over the deck does not finish a mark on the street beneath it, nor driving under the deck
     one up on it, nor the lane beside a ramp one on the ramp;
   * clearing the mark on the map puts the light out at once.
   Run:  node tools/sidewalk-checks/mark-ring.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const F = await import('../../js/flyover.js');
const M = await import('../../js/map.js');
const B = await import('../../js/markBeam.js');
const { player } = await import('../../js/state.js');
const { scene } = await import('../../js/renderer.js');
const { CORE } = await import('../../js/island.js');
const { FLY } = F;

let clock = 1000;                                            // milliseconds: the suite's own clock (updateMarkBeam takes it)
const frame = (dt = 1 / 60) => { clock += dt * 1000; B.updateMarkBeam(clock); };
const put = (x, z, y = 0) => Object.assign(player, { x, z, y });
const marked = () => !!M.currentMark();
put(0, -24);
B.updateMarkBeam(clock);
const beam = scene.getObjectByName('markBeam'), pad = scene.getObjectByName('markCircle');
assert(beam && pad, 'the mark\'s light is not in the scene');
const ring = pad.children.find(c => c.geometry.type === 'RingGeometry');
const column = beam.children.find(c => c.geometry.type === 'CylinderGeometry');
const radius = () => ring.geometry.parameters.outerRadius * pad.scale.x;      // the circle's outer edge now, in metres
let checks = 0;

// The circle breathes, centred on the mark.
let ARRIVE;
{
  M.setMark(120, 80);
  frame();
  assert(beam.visible, 'no light at the mark');
  assert(Math.hypot(beam.position.x - 120, beam.position.z - 80) < 1e-9 && Math.abs(beam.position.y) < 1e-9, 'the light is not on the mark');
  let lo = Infinity, hi = 0, prev = radius(), step = 0;
  const sizes = [];
  for (let k = 0; k < 280; k++) {                            // two breaths, a frame at a time
    frame();
    const r = radius();
    lo = Math.min(lo, r); hi = Math.max(hi, r); step = Math.max(step, Math.abs(r - prev)); prev = r;
    sizes.push(r);
  }
  assert(Math.abs(lo - 3.2) < 0.02 && Math.abs(hi - 5.6) < 0.02, `the circle breathes from ${lo.toFixed(2)} to ${hi.toFixed(2)} m, not 3.2 to 5.6 m`);
  assert(step < 0.1, `the circle jumps ${step.toFixed(3)} m in a frame (it should grow and shrink smoothly)`);
  for (let k = 0; k + 84 < sizes.length; k++) assert(Math.abs(sizes[k] - sizes[k + 84]) < 1e-6, 'the circle does not breathe once every 1.4 s');
  ARRIVE = hi;
  checks += 4;
}

// Driving onto the circle finishes the mark, at the circle's largest size and not a frame before; the light goes out.
{
  put(60, 80);
  let at = null;
  for (let x = 60; x <= 120 && at === null; x += 0.5) {      // 30 m/s, straight at the mark
    put(x, 80); frame();
    if (!marked()) at = 120 - x;
  }
  assert(at !== null, 'the car drove onto the circle, and the mark was not finished');
  assert(at < ARRIVE && at >= ARRIVE - 0.5, `the mark was finished with the car ${at.toFixed(2)} m from it (the circle reaches ${ARRIVE.toFixed(2)} m)`);
  assert.equal(M.currentRoute(), null, 'the route is still there after the mark was finished');
  assert(beam.visible, 'the light went out at once, without its flourish');
  const r0 = radius();
  frame(0.3);
  assert(beam.visible && radius() > r0 && ring.material.opacity < 0.5 && column.material.opacity < 1, 'the light does not open out and fade as it goes');
  frame(0.35);
  assert(!beam.visible, 'the light is still there after its flourish');
  checks += 5;
}

// A car parked just outside the circle does not finish the mark; a step onto it does.
{
  put(200 - ARRIVE - 0.3, 80);
  M.setMark(200, 80);
  for (let k = 0; k < 180; k++) frame();
  assert(marked(), 'the mark was finished by a car parked outside its circle');
  put(200 - ARRIVE + 0.1, 80); frame();
  assert(!marked(), 'the mark was not finished by a car on its circle');
  frame(1);
  checks += 2;
}

// A fast car that crosses the circle between two frames finishes the mark; a jump across the map does not.
{
  put(113, 162);
  M.setMark(120, 160);
  frame();
  assert(marked(), 'the mark was finished before the car came near');
  put(127, 162); frame();                                    // 14 m in one frame, passing 2 m from the mark
  assert(!marked(), 'a fast car crossed the circle between two frames, and the mark was not finished');
  frame(1);
  put(-130, 240);
  M.setMark(120, 240);
  frame();
  put(370, 240); frame();                                    // 500 m at once: a jump, not a drive
  assert(marked(), 'a jump across the map finished the mark');
  M.clearMark(); frame();
  checks += 3;
}

// A mark set with the car already on its circle waits until the car has been off it.
{
  put(40, 80);
  M.setMark(42, 80);
  for (let k = 0; k < 30; k++) frame();
  assert(marked(), 'a mark set with the car on its circle was finished at once');
  for (let x = 40; x >= 30; x -= 0.5) { put(x, 80); frame(); }        // drives off the circle...
  assert(marked(), 'the mark was finished as the car drove off its circle');
  for (let x = 30; x <= 38 && marked(); x += 0.5) { put(x, 80); frame(); }   // ... and back onto it
  assert(!marked(), 'the car left the circle and came back onto it, and the mark was not finished');
  frame(1);
  checks += 2;
}

// The light stands on the mark's level, and the car finishes the mark only on that level.
{
  let f = null;
  for (let k = 1; k <= CORE && !f; k++) { const q = F.nodeAt(k, 0); if (q && q.ext === 0) f = q; }
  assert(f, 'no plain flyover found');
  const Q = f.node, h = (x, z) => F.bridgeHeight(f, F.alongOf(f, x, z));
  // a mark on the street under the deck, just out of the deck's outline: its light is on the ground
  put(Q + 2, 6, FLY.deckH);                                  // the car up on the deck, 5.4 m from the mark on the map
  M.setMark(Q, 11);
  for (let k = 0; k < 30; k++) frame();
  assert(Math.abs(beam.position.y) < 1e-9, `the light of a mark on the street under the deck stands ${beam.position.y.toFixed(2)} m up`);
  assert(marked(), 'driving over the deck finished the mark on the street beneath it');
  put(Q + 2, 6, 0); frame();                                 // the same place at grade, under the deck
  assert(!marked(), 'the car under the deck, on the mark\'s circle, did not finish it');
  frame(1);
  // a mark up on the deck: its light is on the deck
  put(Q + 1, 1, 0);                                          // the car at grade under the deck
  M.setMark(Q + 3, 2);
  for (let k = 0; k < 30; k++) frame();
  assert(Math.abs(beam.position.y - FLY.deckH) < 1e-9, `the light of a mark on the deck stands ${beam.position.y.toFixed(2)} m up, not on the deck`);
  assert(marked(), 'driving under the deck finished the mark up on it');
  put(Q + 1, 1, FLY.deckH); frame();
  assert(!marked(), 'the car up on the deck, on the mark\'s circle, did not finish it');
  frame(1);
  // a mark on a ramp: its light is on the ramp's surface, the circle tilted to the slope
  const u = Q - (FLY.deckHalf + FLY.rampEnd) / 2;
  put(u, 9.5, 0);                                            // the car on the ground beside the ramp, 5.5 m from the mark
  M.setMark(u, 4);
  for (let k = 0; k < 30; k++) frame();
  assert(Math.abs(beam.position.y - h(u, 4)) < 1e-9, `the light of a mark on the ramp stands ${beam.position.y.toFixed(2)} m up, not on the ramp (${h(u, 4).toFixed(2)} m)`);
  const n = pad.localToWorld(pad.position.clone().setY(1)).sub(pad.getWorldPosition(pad.position.clone())).normalize();
  const tilt = Math.acos(n.y) * 180 / Math.PI, want = Math.atan(FLY.deckH / (FLY.rampEnd - FLY.deckHalf)) * 180 / Math.PI;
  assert(Math.abs(tilt - want) < 0.2 && Math.abs(n.z) < 1e-6 && n.x * (Q - u) < 0, `the circle on the ramp is tilted ${tilt.toFixed(2)} deg (the ramp climbs ${want.toFixed(2)} deg)`);
  assert(marked(), 'the car on the ground beside the ramp finished the mark on the ramp');
  put(u, 1, h(u, 1)); frame();
  assert(!marked(), 'the car on the ramp, on the mark\'s circle, did not finish it');
  frame(1);
  checks += 9;
}

// Clearing the mark on the map puts the light out at once.
{
  put(0, -24);
  M.setMark(120, 80);
  frame();
  assert(beam.visible, 'no light at the mark');
  M.clearMark(); frame();
  assert(!beam.visible, 'the light stayed on after the mark was cleared on the map');
  checks += 1;
}

console.log(`mark ring: the circle breathes ${3.2} -> ${ARRIVE.toFixed(1)} m; ${checks} checks`);
console.log('ALL MARK RING CHECKS PASSED');
process.exit(0);
