/* Boot check: import every game module in order against the Node stubs. Catches import cycles, syntax slips and
 * a module reaching for the DOM at load time, which a browser would only show as a blank canvas.
 *   node tools/sidewalk-checks/boot-check.mjs
 */
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const mods = ['state', 'config', 'utils', 'assets', 'world', 'flyover', 'vehicle', 'collisions', 'trafficLights', 'civilians', 'police', 'roadblock', 'spikes', 'traffic', 'wrecks', 'flying', 'flow', 'main'];
let bad = 0;
for (const m of mods) {
  try { await import(`../../js/${m}.js`); console.log(`  . js/${m}.js boots`); }
  catch (e) { bad++; console.log(`  x js/${m}.js failed to boot: ${e.message}`); }
}
console.log(bad ? `${bad} MODULE(S) FAILED TO BOOT` : 'ALL MODULES BOOT');
process.exit(bad ? 1 : 0);
