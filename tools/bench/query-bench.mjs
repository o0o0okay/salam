/* Timings that can be taken without a browser: how long the city takes to build, how long one solid query takes,
   and how long a car takes to build. Numbers depend on the machine and the Node version, so compare runs on the
   same machine only, and run it two or three times: the first run includes JIT warm-up and the figures move by up to
   2x between runs. They are not frame times: frame time needs the ?debug overlay in a real browser.
   Run:  node tools/bench/query-bench.mjs */
import { modulePath } from '../sidewalk-checks/harness.mjs';
import os from 'os';

const W = await import(modulePath);
const { updateChunks, solidAt, solidsNear, CHUNK } = W;
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

// 1. building: a 3x3 block of chunks, built from scratch, synchronously (the way boot and world reset build it)
const build = [];
for (const [x, z] of [[0, 0], [CHUNK * 3, 0], [0, CHUNK * 3]]) {
  const t0 = process.hrtime.bigint();
  updateChunks(x, z, 999);
  build.push(ms(t0));
}

// 2. one solidAt query near the streets (the collision and AI code asks this several times a frame per car)
let seed = 4242;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pts = Array.from({ length: 20000 }, () => [(rnd() - 0.5) * CHUNK * 2, (rnd() - 0.5) * CHUNK * 2]);
for (const [x, z] of pts.slice(0, 2000)) solidAt(x, z, 1.2, 0);          // warm up
let hits = 0;
const t1 = process.hrtime.bigint();
for (const [x, z] of pts) if (solidAt(x, z, 1.2, 0)) hits++;
const queryUs = (ms(t1) * 1000) / pts.length;

// 3. solidsNear with a car-sized reach: how many solids come back on average
let total = 0;
for (const [x, z] of pts.slice(0, 2000)) total += solidsNear(x, z, 4).length;
const avgNear = total / 2000;

console.log(`machine: ${os.cpus()[0]?.model ?? 'unknown'}, node ${process.version}`);
console.log(`build 3x3 block (ms):   ${build.map(v => v.toFixed(1)).join(', ')}   (first, second, third block)`);
console.log(`solidAt (µs/query):     ${queryUs.toFixed(2)}   (${hits} hits of ${pts.length})`);
console.log(`solidsNear reach 4 m:   ${avgNear.toFixed(1)} solids per query on average`);
