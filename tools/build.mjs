// Optional bundle for hosting: `npm run build` writes dist/ — index.html, css/, and app.js with the whole game
// (three.js included) in one file, so a page load is one script instead of ~45 module requests in a chain.
// The root index.html keeps loading js/main.js directly; `npm run serve` and `npm run check` do not use dist/.
import fs from 'fs';
import path from 'path';
import url from 'url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, 'js/main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  outfile: path.join(out, 'app.js'),
  metafile: true,
  logLevel: 'warning',
});

// the same page, minus the import map (three is inside app.js now) and with the entry pointed at the bundle
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const before = html;
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n/, '');
html = html.replace('<script type="module" src="js/main.js"></script>', '<script type="module" src="app.js"></script>');
if (html === before || html.includes('importmap') || !html.includes('src="app.js"')) {
  throw new Error('build: index.html changed shape — update the replacements in tools/build.mjs');
}
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.cpSync(path.join(root, 'css'), path.join(out, 'css'), { recursive: true });

const inputs = Object.keys(result.metafile.inputs).filter(f => !f.includes('node_modules')).length;
const three = Object.keys(result.metafile.inputs).filter(f => f.includes('node_modules/three/')).length;
const kb = (fs.statSync(path.join(out, 'app.js')).size / 1024).toFixed(0);
console.log(`dist/: app.js ${kb} KB (${inputs} game modules, ${three} three.js modules), index.html, css/`);
