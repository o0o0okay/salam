import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const world = await import('../../js/world.js');
const got = [];
const harvest = () => {
  for (const ch of world.chunks.values()) {
    const k = ch.cx + ',' + ch.cz; if (got.some(g => g.k === k)) continue;
    ch.group.updateMatrixWorld(true);
    const items = [];
    for (const b of ch.mergeQ || []) {
      const p = b.geo.parameters || {}; if (b.geo.type !== 'BoxGeometry' || !p.width) continue;
      const e = b.m.elements; const mt = Array.isArray(b.mat) ? b.mat[0] : b.mat;
      items.push({ x: e[12], y: e[13], z: e[14], s: [Math.hypot(e[0],e[1],e[2]), Math.hypot(e[4],e[5],e[6]), Math.hypot(e[8],e[9],e[10])].map(v=>+v.toFixed(2)), col: mt.color ? mt.color.getHex().toString(16) : '?' });
    }
    got.push({ k, items, visible: ch.group.visible, merged: ch.merged });
  }
};
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { world.updateChunks(cx * 80 + 40, cz * 80 + 40, 1); harvest(); }
console.log('harvested blocks:', got.map(g => g.k + (g.merged ? '(merged)' : '')).join(' '));
const hits = [];
for (const g of got) for (const it of g.items) if (Math.abs(it.x) < 14 && it.z > 62 && it.z < 100 && it.y > 4.5) hits.push(`   ${g.k} ${it.col} at ${it.x.toFixed(2)},${it.y.toFixed(2)},${it.z.toFixed(2)} size ${it.s.join('x')}`);
console.log(`${hits.length} pieces above the junction:`);
console.log(hits.sort().join('\n'));
