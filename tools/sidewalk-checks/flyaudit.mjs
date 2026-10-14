import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const world = await import('../../js/world.js');
for (let cx = -1; cx <= 0; cx++) for (let cz = 0; cz <= 1; cz++) world.updateChunks(cx * 80 + 40, cz * 80 + 40, 1);
const rows = [];
for (const ch of world.chunks.values()) {
  if (ch.merged) continue;
  ch.group.updateMatrixWorld(true);
  for (const b of ch.mergeQ || []) {
    const g = b.geo, p = g.parameters || {};
    if (g.type !== 'BoxGeometry' || !p.width) continue;
    const e = b.m.elements;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const ix of [-1, 1]) for (const iy of [-1, 1]) for (const iz of [-1, 1]) {
      const lx = ix * p.width / 2, ly = iy * p.height / 2, lz = iz * p.depth / 2;
      const wx = e[0] * lx + e[4] * ly + e[8] * lz + e[12], wy = e[1] * lx + e[5] * ly + e[9] * lz + e[13], wz = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
    if (Math.abs((x0 + x1) / 2) > 16) continue;
    if ((z0 + z1) / 2 < 20 || (z0 + z1) / 2 > 140) continue;
    const mt = Array.isArray(b.mat) ? b.mat[0] : b.mat;
    rows.push(`   y ${y0.toFixed(2)}..${y1.toFixed(2)}  x ${x0.toFixed(2)}..${x1.toFixed(2)}  z ${z0.toFixed(2)}..${z1.toFixed(2)}  d ${p.depth.toFixed(2)} #${mt.color ? mt.color.getHex().toString(16) : '?'} ${ch.cx},${ch.cz}`);
  }
}
rows.sort();
console.log(`${rows.length} pieces in the avenue corridor (|x|<16, 20<z<140):`);
console.log(rows.join('\n'));
