import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const world = await import('../../js/world.js');
for (let cx = -1; cx <= 0; cx++) for (let cz = 0; cz <= 1; cz++) world.updateChunks(cx * 80 + 40, cz * 80 + 40, 1);
const out = [];
for (const ch of world.chunks.values()) {
  for (const pr of ch.props) if (Math.abs(pr.x) < 9 && pr.z > 30 && pr.z < 130) out.push(`   prop ${pr.kind} at ${pr.x.toFixed(1)},${pr.z.toFixed(1)} [${ch.cx},${ch.cz}]`);
  for (const t of ch.trees) if (Math.abs(t.x) < 9 && t.z > 30 && t.z < 130) out.push(`   tree at ${t.x.toFixed(1)},${t.z.toFixed(1)}`);
  for (const s of ch.solids) if (Math.abs(s.x) < 12 && s.z > 30 && s.z < 130) out.push(`   solid ${s.kind}${s.maxY !== undefined ? '(under ' + s.maxY + ')' : ''} at ${s.x.toFixed(1)},${s.z.toFixed(1)} h ${s.hx}x${s.hz}`);
  for (const pk of ch.pickups) if (Math.abs(pk.x) < 9 && pk.z > 30 && pk.z < 130) out.push(`   pickup ${pk.kind} at ${pk.x.toFixed(1)},${pk.z.toFixed(1)}`);
  for (const rw of ch.roadworks) if (Math.abs(rw.x) < 12 && rw.z > 30 && rw.z < 130) out.push(`   roadworks at ${rw.x.toFixed(1)},${rw.z.toFixed(1)} len ${rw.len}`);
}
console.log(out.length + ' things in the avenue corridor:');
console.log(out.sort().join('\n'));
