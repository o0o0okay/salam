/* The ice cream van (js/carModels.js 'icecream', js/civilians.js, js/audio.js updateIce):
   * the model: a step van inside its CAR_DIMS box, 4.3 m to the top of its scoops; the serving window under its
     awning on the kerb side (local -x, the right: traffic drives on the right), so the van reaches further out on that
     side; the big waffle cone on the roof with its three scoops (strawberry, mint, chocolate); ICE CREAM on both flanks
     and across the rear doors, its letters side by side; the livery band and roof line in the van's colour, the awning
     in the other colour of the pair (red on a blue van, blue on a red one); two vans of one livery share their body
     geometry;
   * the traffic: about one civilian car in 25 is an ice cream van (CIV_KINDS);
   * the chime, played on a stand-in audio clock: near a van the tune is Greensleeves from the top (A C D E F ...) in
     time (an eighth is 0.19 s) whatever the frame rate, louder the nearer the van; it is silent out of earshot (75 m)
     and with the game not running, and after a silence it starts from the top again; after a stall of the frames the
     notes missed are skipped and the tune carries on in time.
   Run:  node tools/sidewalk-checks/ice-cream.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const THREE = await import('three');
const C = await import('../../js/carModels.js');
const { CIV_KINDS } = await import('../../js/civilians.js');
const { sfx } = await import('../../js/audio.js');

let checks = 0;
const BLUE = 0x3f9fe0, RED = 0xe8434a;
// the mesh of one colour, and its vertices in the van's frame (a colour with a single piece is not merged: that mesh
// keeps its own position and turn)
const meshOf = (g, hex) => g.userData.inner.children.find(o => o.isMesh && o.material.color && o.material.color.getHex() === hex);
const vertsOf = m => {
  m.updateMatrix();
  const p = m.geometry.attributes.position, v = new THREE.Vector3(), out = [];
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrix); out.push([v.x, v.y, v.z]); }
  return out;
};
const count = (m, f) => vertsOf(m).filter(f).length;
const boundsOf = m => new THREE.Box3().setFromPoints(vertsOf(m).map(([x, y, z]) => new THREE.Vector3(x, y, z)));

// ---- the model ----
const dims = C.CAR_DIMS.icecream;
assert(dims && dims.e1 > 2.5 && dims.e1 < 3.2 && dims.e2 > 1.0 && dims.e2 < 1.3, 'the ice cream van has no step-van sized CAR_DIMS box');
for (const [livery, other] of [[BLUE, RED], [RED, BLUE]]) {
  const g = C.buildCar('icecream', livery, true);
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  const name = livery === BLUE ? 'the blue van' : 'the red van';
  assert(b.min.z >= -dims.e1 - 0.02 && b.max.z <= dims.e1 + 0.02, `${name} is longer than its box: z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)}`);
  assert(b.max.y > 4.1 && b.max.y < 4.6, `${name} is ${b.max.y.toFixed(2)} m high, not 4.3 m to the top of its scoops`);
  assert(-b.min.x > b.max.x + 0.1 && -b.min.x < dims.e2 + 0.45, `${name}'s awning does not stand out on the kerb side: x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}`);
  // the awning, in the other colour, out on the kerb side
  const aw = meshOf(g, other);
  assert(aw && count(aw, ([x, y]) => x < -1.3 && y > 2.2) > 0, `${name}'s awning is not on the kerb side in the other colour`);
  // the livery band down the van in its own colour
  const band = meshOf(g, livery);
  assert(band, `${name} has nothing in its own colour`);
  const bb = boundsOf(band);
  assert(bb.max.z - bb.min.z > 4.8, `${name}'s livery band is ${(bb.max.z - bb.min.z).toFixed(2)} m long`);
  // the cone and its scoops on the roof
  const waffle = meshOf(g, 0xe39a48);
  assert(waffle && boundsOf(waffle).min.y > 2.8, `${name} has no waffle cone on its roof`);
  for (const [hex, flavour] of [[0xf7a6c8, 'strawberry'], [0x7fe0c8, 'mint'], [0x7b4a2b, 'chocolate']]) {
    const m = meshOf(g, hex);
    assert(m && count(m, ([, y]) => y > 3.6) > 20, `${name} has no ${flavour} scoop on its cone`);
  }
  checks += 7;
}
{
  // ICE CREAM along the far flank and across the rear doors (red on the blue van), ICE by the cab on the kerb side
  const g = C.buildCar('icecream', BLUE, true), red = meshOf(g, RED);
  assert(count(red, ([x]) => x > 1.16) > 500, 'no ICE CREAM along the van\'s left flank');
  // its nine letters side by side, a letter and a gap apart (0.26 m high: 2.15 m in all), not on top of each other
  const word = vertsOf(red).filter(([x, y]) => x > 1.16 && y > 2.1).map(([, , z]) => z);
  const wlen = Math.max(...word) - Math.min(...word);
  assert(Math.abs(wlen - 2.15) < 0.05, `ICE CREAM along the left flank is ${wlen.toFixed(2)} m long, not 2.15 m: its letters overlap`);
  assert(count(red, ([, , z]) => z < -2.79) > 500, 'no ICE CREAM across the van\'s rear doors');
  assert(count(red, ([x, y, z]) => x < -1.16 && z > 0.2 && z < 1.05 && y > 1.8) > 100, 'no ICE / CREAM by the cab on the kerb side');
  // two vans of one livery share their body geometry
  const ids = v => v.userData.inner.children.map(o => o.geometry.uuid).sort().join();
  assert.equal(ids(g), ids(C.buildCar('icecream', BLUE, true)), 'two ice cream vans of one livery do not share their body geometry');
  checks += 5;
}

// ---- the traffic ----
const share = CIV_KINDS.filter(k => k === 'icecream').length / CIV_KINDS.length;
assert(share > 1 / 40 && share < 1 / 15, `one civilian car in ${(1 / share).toFixed(0)} is an ice cream van (want about one in 25)`);
checks++;

// ---- the chime, on a stand-in audio clock ----
const notes = [];                                 // { t, f, peak }: every oscillator started
const param = () => ({ value: 0, peak: 0, setValueAtTime(v) { this.peak = Math.max(this.peak, v); }, exponentialRampToValueAtTime(v) { this.peak = Math.max(this.peak, v); } });
const ctx = {
  currentTime: 0,
  createOscillator() { const o = { type: '', frequency: param(), gain: null, connect(g) { o.gain = g; }, start(t) { notes.push({ t, f: o.frequency.value, o }); }, stop() {} }; return o; },
  createGain() { return { gain: param(), connect() {} }; },
};
sfx.ctx = ctx; sfx.master = { connect() {} };
// run the clock for `secs` at `fps`, the nearest van `dist` away; returns the notes struck (their fundamentals)
function play(secs, fps, dist, active = true) {
  notes.length = 0;
  const t0 = ctx.currentTime;
  for (let t = t0; t < t0 + secs; t += 1 / fps) { ctx.currentTime = t; sfx.updateIce(dist, active); }
  const byT = new Map();
  for (const n of notes) { const k = n.t.toFixed(4); if (!byT.has(k) || byT.get(k).f > n.f) byT.set(k, { t: n.t, f: n.f, peak: n.o.gain.gain.peak }); }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}
const A4 = 440, semis = f => Math.round(12 * Math.log2(f / A4));
let a = play(12, 60, 10);
assert.deepEqual(a.slice(0, 8).map(n => semis(n.f)), [0, 3, 5, 7, 8, 7, 5, 2], `the chime does not open with Greensleeves: ${a.slice(0, 8).map(n => semis(n.f))}`);
const gaps = a.slice(0, 4).map((n, i, l) => i ? +(n.t - l[i - 1].t).toFixed(3) : 0).slice(1);
assert.deepEqual(gaps, [0.19, 0.38, 0.19], `the chime is out of time: ${gaps}`);
// the tune is 37 notes in 54 eighths (its last bar a rest), then it starts again from the top
assert(a.length > 37 && semis(a[37].f) === 0 && Math.abs(a[37].t - a[0].t - 54 * 0.19) < 1e-6,
  `the chime does not come round again after its 37 notes and 54 eighths (note 38: ${a[37] && semis(a[37].f)} at ${a[37] && (a[37].t - a[0].t).toFixed(3)} s)`);
// the same tune at 20 frames a second: the same notes at the same times
sfx.updateIce(999, true);                                     // a silence: the tune starts again from the top
const at60 = a.map(n => +(n.t - a[0].t).toFixed(3));
const b = play(12, 20, 10), at20 = b.map(n => +(n.t - b[0].t).toFixed(3));
assert.deepEqual(at20.slice(0, 37), at60.slice(0, 37), 'the chime keeps different time at 20 frames a second');
assert.equal(semis(b[0].f), 0, 'after a silence the chime does not start from the top');
checks += 5;
// louder the nearer; silent out of earshot and with the game not running
sfx.updateIce(999, true);
const near = play(3, 60, 10)[0].peak; sfx.updateIce(999, true);
const far = play(3, 60, 55)[0].peak; sfx.updateIce(999, true);
assert(near > 2 * far && far > 0, `the chime is not louder near the van (${near.toFixed(4)} at 10 m, ${far.toFixed(4)} at 55 m)`);
assert.equal(play(3, 60, 80).length, 0, 'the chime is heard from 80 m');
assert.equal(play(3, 60, 10, false).length, 0, 'the chime plays with the game not running');
checks += 3;
// the frames stall for 0.7 s (too short to be a silence: the tune is not restarted): the note whose time passed
// meanwhile is skipped, not struck late on top of the next, and the tune carries on in time
sfx.updateIce(999, true);
let r0 = null;
const ref = play(7, 60, 10).map(n => [+(n.t - (r0 ??= n.t)).toFixed(3), semis(n.f)]);   // undisturbed, from the top
sfx.updateIce(999, true);
const s0 = play(1.5, 60, 10)[0].t;                       // from the top again, for 1.5 s ...
ctx.currentTime += 0.7;                                  // ... a stall ...
const resume = ctx.currentTime, post = play(3, 60, 10);  // ... and on
assert(post.every(n => n.t > resume - 0.02), `after a stall the chime strikes notes late (${post.filter(n => n.t <= resume - 0.02).length})`);
const rel = post.map(n => [+(n.t - s0).toFixed(3), semis(n.f)]);
assert.deepEqual(rel, ref.filter(([o]) => o >= rel[0][0] - 1e-6 && o <= rel[rel.length - 1][0] + 1e-6), 'after a stall the chime is out of time');
checks += 2;

console.log(`ice cream van: ${checks} checks PASSED (one civilian car in ${(1 / share).toFixed(0)}; the chime ${a.length} notes in 12 s at 10 m)`);
process.exit(0);
