// Copied from universe-atlas@7419733 tests/fauna-composer-herd.browser.mjs for the kit's Creature Lab app (apps/creature-lab); adaptations: import paths (panel and review modules under /apps/creature-lab/src/), CREATURE_LAB_URL/CREATURE_LAB_RESULTS, app URL.
// Needs `npm run lab:dev` (http://127.0.0.1:5206/apps/creature-lab/) and the GPU browser lock. Listed in apps/creature-lab/PROVENANCE.md.
// Herd capture suite for the modular composer (run by hand, not part of npm test):
//   CREATURE_LAB_URL=http://127.0.0.1:5206/apps/creature-lab/ CREATURE_LAB_RESULTS=<new dir> node tests/browser/fauna-composer-herd.browser.mjs
// For five species it opens the real Creature Lab with a herd of 12 under planet-noon light (side and
// three-quarter screenshots, actor/seed/triangle/draw-call/build-time checks), then renders every herd
// member alone at a fixed per-species metre scale (the crops) and measures pairwise image difference with
// `magick compare -metric RMSE`. Screenshots are review evidence; RMSE measures variety, not realism.
// Set HERD_RMSE_ENFORCE=1 to fail when any pair differs by less than HERD_RMSE_MIN (default 0.04).
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
import {composerPreset, encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';

const run = promisify(execFile);
const base = new URL('.', process.env.CREATURE_LAB_URL || 'http://127.0.0.1:5206/apps/creature-lab/');
const output = resolve(process.env.CREATURE_LAB_RESULTS || 'test-results/fauna-round-2026-10-02/WP5/herd-001');
await mkdir(output, {recursive: false});
const MAGICK = process.env.MAGICK || ['C:/LLM/IWSDK/tools/bin/imagemagick/magick.exe'].find(existsSync) || 'magick';
const SPECIES = (process.env.HERD_SPECIES || 'giraffe,rhinoceros,dinosaur,bird,ostrich').split(',');
const HERD = 12, RMSE_MIN = Number(process.env.HERD_RMSE_MIN || .04), CROP = {width: 640, height: 480};
const errors = [], failures = [], report = {ok: false, url: base.href, herd: HERD, species: {}, errors, failures, magick: MAGICK,
  scope: 'Desktop preview at true metre scale. Herd variety RMSE compares isolated renders of each individual (no perspective or occlusion); it measures difference, not realism.'};
const check = (name, ok, detail) => { if (!ok) failures.push({name, detail}); return ok; };

// Isolated member renders: planet-noon light with shadows, side or three-quarter orthographic view, one fixed
// frame per species (the union of all twelve animals), so size differences between individuals stay visible.
const reviewHtml = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#a9c0d6}canvas{display:block}</style><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {createComposerCreature} from '/src/fauna-composer.ts';
import {composerPreset} from '/src/fauna-composer-recipe.ts';
import {composerHerdRecipes} from '/apps/creature-lab/src/creature-lab-composer.ts';
import {applyFaunaReviewLighting} from '/apps/creature-lab/src/fauna-review-environment.ts';
import {fitFaunaReviewShadow, FAUNA_REVIEW_SHADOWS} from '/apps/creature-lab/src/fauna-review-lighting.ts';
const W = ${CROP.width}, H = ${CROP.height};
const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true}); renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const scene = new THREE.Scene(), lab = applyFaunaReviewLighting(scene, 'planet-noon'); renderer.toneMappingExposure = lab.preset.exposure; lab.key.castShadow = true; scene.add(lab.key.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({color: lab.preset.ground, roughness: .95})); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 400);
const dirs = {side: new THREE.Vector3(0, .12, 1).normalize(), 'three-quarter': new THREE.Vector3(1, .42, 1).normalize()};
function place(creature) { creature.update('neutral', 0); const b = creature.bounds(), c = b.getCenter(new THREE.Vector3()); creature.group.position.set(-c.x, 0, -c.z); creature.group.updateMatrixWorld(true); return creature.bounds(); }
function frame(box, view) {
  const centre = box.getCenter(new THREE.Vector3()), dir = dirs[view];
  camera.position.copy(centre).addScaledVector(dir, 100); camera.lookAt(centre); camera.updateMatrixWorld(true);
  let mx = 0, my = 0; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) { const p = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse); mx = Math.max(mx, Math.abs(p.x)); my = Math.max(my, Math.abs(p.y)); }
  const half = Math.max(my, mx * H / W) * 1.06; camera.top = half; camera.bottom = -half; camera.left = -half * W / H; camera.right = half * W / H; camera.updateProjectionMatrix();
  return {halfHeightM: half, metresPerPixel: 2 * half / H};
}
window.herdReview = {
  render(species, view) {
    const recipes = composerHerdRecipes({...composerPreset(species), individualSeed: 1}, ${HERD}), union = new THREE.Box3(), out = [];
    for (const recipe of recipes) { const c = createComposerCreature(recipe); union.union(place(c)); c.dispose(); }
    const f = frame(union, view);
    for (const recipe of recipes) {
      const c = createComposerCreature(recipe); c.mesh.castShadow = true; scene.add(c.group); const box = place(c);
      fitFaunaReviewShadow(lab.key, union, {groundY: 0, depthBiasM: FAUNA_REVIEW_SHADOWS.depthBiasM, normalBiasM: FAUNA_REVIEW_SHADOWS.normalBiasM});
      renderer.render(scene, camera);
      const t = c.individual.traits;
      out.push({seed: t.individualSeed, sex: t.sex, maturity: t.maturity, deltas: c.individual.deltas, size: box.getSize(new THREE.Vector3()).toArray(), triangles: c.details().triangles, png: renderer.domElement.toDataURL('image/png')});
      c.dispose();
    }
    return {frame: f, union: {min: union.min.toArray(), max: union.max.toArray()}, members: out};
  },
};
</script>`;

const lab = query => new URL(`creature-lab.html${query}`, base).href;
const crops = [];
const started = Date.now();
try {
  await withGpuLock({owner: 'fauna-composer-herd', timeoutMs: 900000, staleMs: Infinity}, async () => {
    const lockStart = Date.now();
    const browser = await chromium.launch({headless: true, args: browserArgs});
    try {
      const context = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      for (const species of SPECIES) {
        const entry = report.species[species] = {lab: {}, isolated: {}};
        const recipe = encodeComposerRecipe({...composerPreset(species), individualSeed: 1});
        const t0 = Date.now();
        await page.goto(lab(`?mode=composer&recipe=${encodeURIComponent(recipe)}&herd=${HERD}&light=planet-noon&view=side&time=1.3`), {waitUntil: 'networkidle'});
        await page.waitForFunction(() => { const c = window.__creatureLab; return c?.ready && c.composer?.actors.length > 0 && !c.composer.building; }, null, {timeout: 60000});
        const pageMs = Date.now() - t0;
        await page.waitForTimeout(400);
        const c = await page.evaluate(() => window.__creatureLab.composer), calls = await page.evaluate(() => window.__creatureLab.renderer.calls);
        const lighting = await page.evaluate(() => window.__creatureLab.lighting), status = await page.textContent('#status'), caption = await page.textContent('#caption-title');
        const seeds = c.actors.map(a => a.individual.seed);
        check(`${species}: ${HERD} actors`, c.actors.length === HERD, c.actors.length);
        check(`${species}: ${HERD} distinct seeds`, new Set(seeds).size === HERD, seeds);
        check(`${species}: ${HERD} distinct skins`, new Set(c.actors.map(a => a.skinDigest)).size === HERD);
        check(`${species}: within 480k triangles`, c.herdStats.triangles <= 480000, c.herdStats.triangles);
        check(`${species}: within 25 draw calls`, calls <= 25, calls);
        check(`${species}: planet-noon with shadows`, lighting.preset === 'planet-noon' && lighting.shadows, lighting);
        Object.assign(entry.lab, {seeds, sexes: c.actors.map(a => a.individual.sex), maturity: c.actors.map(a => a.individual.maturity), triangles: c.herdStats.triangles, vertices: c.herdStats.vertices,
          buildMs: c.herdStats.buildMs, slowestAnimalMs: c.herdStats.maxBuildMs, herdWallMs: c.herdStats.wallMs, pageLoadToHerdMs: pageMs, drawCalls: calls, status, caption, envelope: c.envelope});
        for (const view of ['side', 'three-quarter']) {
          if (view !== 'side') { await page.selectOption('#composer-view', view); await page.waitForTimeout(300); }
          const file = join(output, `lab-${species}-herd${HERD}-${view}.png`); await page.screenshot({path: file}); entry.lab[`${view}Screenshot`] = file;
        }
      }
      // Isolated crops.
      const review = await context.newPage(); review.on('pageerror', e => errors.push(`review: ${e.message}`));
      await review.route('**/tests/composer-herd-review.html', route => route.fulfill({contentType: 'text/html', body: reviewHtml}));
      await review.goto(new URL('tests/composer-herd-review.html', base).href); await review.waitForFunction(() => window.herdReview, null, {timeout: 30000});
      for (const species of SPECIES) for (const view of ['side', 'three-quarter']) {
        const result = await review.evaluate(([s, v]) => window.herdReview.render(s, v), [species, view]);
        const files = [];
        for (const m of result.members) { const file = join(output, `crop-${species}-${view}-${String(m.seed).padStart(2, '0')}.png`); await writeFile(file, Buffer.from(m.png.split(',')[1], 'base64')); files.push(file); delete m.png; }
        report.species[species].isolated[view] = {frame: result.frame, union: result.union, members: result.members, files};
        crops.push({species, view, files, members: result.members});
      }
      // Contact sheets (one per view): rows are species, columns are individuals.
      for (const view of ['side', 'three-quarter']) {
        const rows = await Promise.all(crops.filter(c => c.view === view).map(async c => `<div class="row"><b>${c.species}</b>${(await Promise.all(c.files.map(async (f, i) => { const m = c.members[i]; return `<figure><img src="data:image/png;base64,${(await readFile(f)).toString('base64')}"><figcaption>#${m.seed} ${m.sex === 'none' ? '' : m.sex} ${m.maturity < .75 ? 'young' : ''}</figcaption></figure>`; }))).join('')}</div>`));
        await review.setViewportSize({width: 2400, height: 1200});
        await review.setContent(`<style>body{margin:0;background:#1c2124;color:#eee;font:15px system-ui}.row{display:grid;grid-template-columns:110px repeat(${HERD},1fr);align-items:center;gap:3px;padding:3px}figure{margin:0}img{width:100%;display:block}figcaption{font-size:12px;text-align:center}</style><h3 style="margin:6px">Herd of ${HERD}, isolated individuals, ${view}, planet-noon, fixed metre scale per species row</h3>${rows.join('')}`);
        const sheet = join(output, `contact-sheet-${view}.png`); await review.screenshot({path: sheet, fullPage: true}); report[`contactSheet_${view}`] = sheet;
      }
      check('no page or console errors', errors.length === 0, errors);
    } finally { await browser.close(); report.gpuLockHeldMs = Date.now() - lockStart; }
  });
  // Pairwise RMSE on the crops (CPU only, outside the GPU lock).
  const rmse = async (a, b) => {
    const r = await run(MAGICK, ['compare', '-metric', 'RMSE', a, b, 'null:']).catch(e => e);
    const text = `${r.stderr || ''}${r.stdout || ''}`, m = /\(([0-9.eE+-]+)\)/.exec(text);
    if (!m) throw new Error(`magick compare gave no normalized RMSE: ${text.slice(0, 200)}`);
    return Number(m[1]);
  };
  for (const c of crops) {
    const pairs = [];
    for (let i = 0; i < c.files.length; i++) for (let j = i + 1; j < c.files.length; j++) pairs.push({a: c.members[i].seed, b: c.members[j].seed, rmse: await rmse(c.files[i], c.files[j])});
    const values = pairs.map(p => p.rmse).sort((x, y) => x - y), below = pairs.filter(p => p.rmse < RMSE_MIN);
    report.species[c.species].isolated[c.view].rmse = {threshold: RMSE_MIN, min: values[0], median: values[values.length >> 1], max: values.at(-1), pairsBelowThreshold: below.length, pairs};
    if (process.env.HERD_RMSE_ENFORCE === '1') check(`${c.species} ${c.view}: every pair RMSE >= ${RMSE_MIN}`, below.length === 0, below.slice(0, 10));
  }
  report.ok = failures.length === 0;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  report.totalMs = Date.now() - started;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
const summary = Object.fromEntries(Object.entries(report.species).map(([s, e]) => [s, {triangles: e.lab.triangles, drawCalls: e.lab.drawCalls, herdWallMs: e.lab.herdWallMs && Math.round(e.lab.herdWallMs), buildMs: e.lab.buildMs && Math.round(e.lab.buildMs),
  young: e.lab.maturity?.filter(m => m < .75).length, sexes: e.lab.sexes?.join(''), rmseSide: e.isolated.side?.rmse && [e.isolated.side.rmse.min, e.isolated.side.rmse.median].map(v => v.toFixed(4)), rmse34: e.isolated['three-quarter']?.rmse && [e.isolated['three-quarter'].rmse.min, e.isolated['three-quarter'].rmse.median].map(v => v.toFixed(4))}]));
console.log(JSON.stringify({ok: report.ok, failures, errors: errors.slice(0, 10), error: report.error, gpuLockHeldMs: report.gpuLockHeldMs, summary}, null, 2));
assert.ok(report.ok, `herd capture failed; see ${join(output, 'report.json')}`);
