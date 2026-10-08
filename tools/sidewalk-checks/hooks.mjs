/* Node ESM loader: maps 'three' to the npm copy, stubs the WebGL renderer and the input device, and can serve a
   world.js whose chunk merge is disabled (NO_MERGE=1) so the baked geometry is still visible to audits. */
import fs from 'fs';
import url from 'node:url';

import path from 'node:path';
const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..') + path.sep;
// three is not vendored in this repo: take it from wherever it can be found (NODE_PATH, a local install, or the
// scratch install the audit tools use).
const candidates = [process.env.THREE_DIR, path.join(here, 'node_modules/three'), '/tmp/3t/node_modules/three'].filter(Boolean);
const threeDir = candidates.find(d => fs.existsSync(path.join(d, 'build/three.module.js')));
if (!threeDir) throw new Error('hooks.mjs: three not found — npm i three, or set THREE_DIR to its package root');
const THREE = path.join(threeDir, 'build/three.module.js');
const ADDONS = path.join(threeDir, 'examples/jsm') + path.sep;
const noMerge = process.env.NO_MERGE === '1';

const RENDERER_STUB = `
import * as THREE from 'three';
export const SKY = 0x9ad5ff;
export const renderer = { setSize(){}, setPixelRatio(){}, render(){}, domElement:{ addEventListener(){}, style:{} }, shadowMap:{ enabled:false, autoUpdate:false, needsUpdate:false }, setAnimationLoop(){}, dispose(){} };
export const QUALITY = [{ pixelRatio:1, shadow:1024, shadowsEvery:2 }];
export let qualityLevel = 0;
export function applyQuality(){ return 0; }
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, 16/9, 0.5, 400);
export const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.9); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
sun.position.set(40, 70, 30); sun.castShadow = false; scene.add(sun); scene.add(sun.target);
export const headLight = new THREE.SpotLight(0xfff0c8, 0, 78, 0.55, 0.6, 1.2);
export const skyGroup = new THREE.Group(); skyGroup.position.set(0, 300, 0); scene.add(skyGroup);
export const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })); sunDisc.position.set(-240, 300, 240);
export const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 12, 8), new THREE.MeshBasicMaterial({ color: 0xdfe8ff })); moonDisc.position.set(240, 300, -240);
export const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2 });
`;

const INPUT_STUB = `
export function readInput(){ return { throttle:0, steer:0, hand:false, nitro:false }; }
export function initInput(){}
`;

const WORLD_NO_MERGE = `export function flushChunk(ch) { return false; }   // NO_MERGE: leave the bake list for the audits
`;

export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: url.pathToFileURL(THREE).href, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: url.pathToFileURL(ADDONS + spec.slice('three/addons/'.length)).href, shortCircuit: true };
  if (spec === 'three/examples/jsm/utils/BufferGeometryUtils.js') return { url: url.pathToFileURL(ADDONS + 'utils/BufferGeometryUtils.js').href, shortCircuit: true };
  return next(spec, ctx);
}

export async function load(u, ctx, next) {
  if (!u.startsWith('file:')) return next(u, ctx);
  const p = url.fileURLToPath(u);
  if (p === REPO + 'js/renderer.js') return { format: 'module', shortCircuit: true, source: RENDERER_STUB };
  if (p === REPO + 'js/input.js') return { format: 'module', shortCircuit: true, source: INPUT_STUB };
  if (noMerge && p === REPO + 'js/world.js') {
    let src = fs.readFileSync(p, 'utf8');
    const i = src.indexOf('export function flushChunk');
    const j = src.indexOf('function buildTreeInstances');
    if (i < 0 || j < 0) throw new Error('hooks: could not find flushChunk');
    src = src.slice(0, i) + WORLD_NO_MERGE + src.slice(j);
    return { format: 'module', shortCircuit: true, source: src };
  }
  return next(u, ctx);
}
