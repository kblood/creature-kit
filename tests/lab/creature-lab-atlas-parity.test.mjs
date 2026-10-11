// Creature Lab app parity with universe-atlas (extraction plan phase 4a). Runs only when ATLAS_DIR points at a
// universe-atlas tree; otherwise every test is skipped (like tests/atlas-parity.test.mjs).
//   ATLAS_DIR=C:/LLM/IWSDK/universe-atlas node --test tests/lab/creature-lab-atlas-parity.test.mjs
// 1. URL contract: a fixed corpus of Atlas composer links (mode=composer) parses to the same state with Atlas's
//    creature-lab-state.ts and with the app's composer slice; the legacy fields, errors and notices stay identical.
//    The app-only presentation field is tested separately and excluded from the preserved shared slice.
// 2. REVIEW_SKY_COLOR / REVIEW_GROUND_ALBEDO equal Atlas's SURFACE_SKY_COLOR / SURFACE_GROUND_ALBEDO, the presets are
//    equal, and planet-noon's ground bounce still equals Atlas's SurfaceLighting (moved here from
//    fauna-review-environment.test, the only part of it that needs Atlas).
// 3. The shared recipe controls, eye helpers and lighting remain unchanged. The app-owned actor/state host now
//    handles complete planet definitions; tests/lab/planet-composer-replay.test.mjs covers that intentional extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as THREE from 'three';
import * as app from '../../apps/creature-lab/src/creature-lab-state.ts';
import {REVIEW_GROUND_ALBEDO, REVIEW_SKY_COLOR, FAUNA_REVIEW_PRESETS, applyFaunaReviewLighting} from '../../apps/creature-lab/src/fauna-review-environment.ts';
import {COMPOSER_PRESET_IDS, COMPOSER_RECIPE_MAX_TEXT, composerPreset, encodeComposerRecipe, randomComposerRecipe} from '../../src/fauna-composer-recipe.ts';

const KIT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ATLAS = process.env.ATLAS_DIR ? resolve(process.env.ATLAS_DIR) : null;
const skip = ATLAS ? false : 'ATLAS_DIR is not set';
const atlasModule = path => import(pathToFileURL(resolve(ATLAS, path)).href);
const lf = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const fixture = name => JSON.parse(readFileSync(resolve(KIT, 'tests/fixtures', name), 'utf8'));

/** The keys of the app's state, which are the keys an Atlas composer link writes. */
// Presentation is an intentional standalone-Lab extension; Atlas's preserved composer parser has no such field.
const SLICE_KEYS = Object.keys(app.DEFAULT_LAB_STATE).filter(k=>k!=='presentation');
const pick = state => Object.fromEntries(SLICE_KEYS.map(k => [k, state[k]]));

/** Fixed corpus of Atlas composer links (every one names mode=composer). */
function corpus() {
  const q = params => '?' + new URLSearchParams([['mode', 'composer'], ...params]).toString();
  const v4 = COMPOSER_PRESET_IDS.map(id => encodeComposerRecipe(composerPreset(id)));
  const v1 = fixture('composer-v1-links.json').presets.map(p => p.text);
  const v2 = fixture('composer-baseline-v2.json').wild.slice(0, 8);
  const wild = encodeComposerRecipe(randomComposerRecipe('parity-1')), giraffe = v4[COMPOSER_PRESET_IDS.indexOf('giraffe')];
  const links = ['?mode=composer', '?mode=composer&recipe=', `?mode=composer&recipe=${'x'.repeat(COMPOSER_RECIPE_MAX_TEXT + 40)}`];
  for (const text of [...v4, ...v1, ...v2]) links.push(q([['recipe', text]]));
  for (const herd of ['1', '6', '9', '12', '7', '0', '6.0', '-6', 'x', '']) links.push(q([['recipe', giraffe], ['herd', herd]]));
  for (const light of ['studio', 'planet-noon', 'planet-evening', 'disco', '']) links.push(q([['recipe', giraffe], ['light', light]]));
  for (const motion of ['neutral', 'idle', 'walk', 'display', 'fly', '']) links.push(q([['recipe', giraffe], ['motion', motion]]));
  for (const time of ['0', '3.5', '47.25', '120', '999', '-4', 'Infinity', 'NaN', '', ' ']) links.push(q([['recipe', giraffe], ['time', time]]));
  for (const view of ['three-quarter', 'side', 'front', 'top']) links.push(q([['recipe', giraffe], ['view', view]]));
  for (const flag of ['compare', 'neutral', 'skeleton']) for (const value of ['1', '0', 'true', '']) links.push(q([['recipe', giraffe], [flag, value]]));
  for (const seed of ['composer-1', 'seed 7/æ', '\u0000\n', 'x'.repeat(200), '  padded  ', '']) links.push(q([['composerSeed', seed]]));
  links.push(q([['recipe', giraffe], ['compare', '1'], ['compareRecipe', wild]]), q([['recipe', giraffe], ['compareRecipe', wild]]));
  links.push(q([['recipe', giraffe], ['compare', '1'], ['compareRecipe', wild], ['herd', '6'], ['light', 'planet-evening'], ['motion', 'display'], ['time', '12.345'], ['view', 'side'], ['skeleton', '1'], ['neutral', '1'], ['composerSeed', 'wp5-plausible-3']]));
  for (const key of ['recipe', 'compareRecipe', 'composerSeed', 'motion', 'herd', 'light', 'time', 'view', 'compare'])
    links.push(q([['recipe', giraffe], ['compare', '1'], ['compareRecipe', wild], [key, key === 'motion' ? 'idle' : key === 'herd' ? '6' : key === 'light' ? 'studio' : key === 'time' ? '2' : key === 'view' ? 'side' : key === 'compare' ? '1' : giraffe], [key, key === 'light' ? 'planet-noon' : key === 'herd' ? '9' : key === 'motion' ? 'walk' : giraffe]]));
  // planetary-mode keys in a composer link are ignored by both
  links.push(q([['recipe', giraffe], ['seed', 'LETHRA'], ['species', 'w/a:3'], ['variant', '2'], ['pose', 'walk'], ['assetHash', 'ab'.repeat(32)], ['bodyCondition', '.4']]));
  // hand-written links: + for space, percent-encoding, key order, a second mode after composer
  links.push(`?mode=composer&composerSeed=a+b&recipe=${encodeURIComponent(giraffe)}`, `?recipe=${encodeURIComponent(giraffe)}&mode=composer&light=planet-noon&herd=12`, '?mode=composer&mode=gallery&herd=6');
  return links;
}

test('creature lab parity: Atlas composer links parse, reject, notice and re-share identically', {skip}, async () => {
  const atlas = await atlasModule('src/creature-lab-state.ts');
  const links = corpus(), base = 'https://example.test/nested/creature-lab.html?old=1#old', diff = [];
  assert.ok(links.length > 100, `corpus has ${links.length} links`);
  assert.deepEqual(SLICE_KEYS, ['mode', 'view', 'time', 'compare', 'neutral', 'skeleton', 'recipe', 'compareRecipe', 'composerSeed', 'motion', 'herd', 'light']);
  for (const link of links) {
    for (const search of [link, new URLSearchParams(link)]) {
      const theirs = atlas.parseCreatureLabState(search), ours = app.parseCreatureLabState(search);
      assert.equal(theirs.mode, 'composer', link);
      try {
        assert.deepEqual(pick(ours), pick(theirs));
        assert.equal(ours.presentation,'realism-1','the Lab-only default does not alter recipe identity');
        assert.equal(app.creatureLabComposerInputError(search), atlas.creatureLabComposerInputError(search));
        assert.equal(app.creatureLabLightInputError(search), atlas.creatureLabLightInputError(search));
        assert.deepEqual(app.creatureLabInputNotices(search), atlas.creatureLabInputNotices(search));
        assert.equal(app.creatureLabUrl(base, pick(ours)), atlas.creatureLabUrl(base, theirs), 'legacy portion of re-shared link');
      } catch (error) { diff.push(`${link.slice(0, 160)}: ${error.message.split('\n')[0]}`); }
    }
  }
  assert.deepEqual(diff, [], `the app and Atlas differ on ${diff.length} link(s):\n${diff.slice(0, 20).join('\n')}`);
  // the app's default state is Atlas's composer link with nothing else set
  assert.deepEqual(pick(app.DEFAULT_LAB_STATE), pick(atlas.parseCreatureLabState('?mode=composer')));
});

test('creature lab parity: REVIEW_* colours and presets equal Atlas surface lighting and review presets', {skip}, async () => {
  const surface = await atlasModule('src/surface-lighting.ts'), env = await atlasModule('src/fauna-review-environment.ts');
  assert.ok(REVIEW_SKY_COLOR.equals(surface.SURFACE_SKY_COLOR), `sky ${REVIEW_SKY_COLOR.getHexString()} != ${surface.SURFACE_SKY_COLOR.getHexString()}`);
  assert.ok(REVIEW_GROUND_ALBEDO.equals(surface.SURFACE_GROUND_ALBEDO), `ground ${REVIEW_GROUND_ALBEDO.getHexString()} != ${surface.SURFACE_GROUND_ALBEDO.getHexString()}`);
  assert.deepEqual(REVIEW_SKY_COLOR.toArray(), surface.SURFACE_SKY_COLOR.toArray());
  assert.deepEqual(REVIEW_GROUND_ALBEDO.toArray(), surface.SURFACE_GROUND_ALBEDO.toArray());
  assert.deepEqual(JSON.parse(JSON.stringify(FAUNA_REVIEW_PRESETS)), JSON.parse(JSON.stringify(env.FAUNA_REVIEW_PRESETS)));
  for (const id of Object.keys(FAUNA_REVIEW_PRESETS)) assert.deepEqual(applyFaunaReviewLighting(new THREE.Scene(), id).hemisphere.groundColor.toArray(), env.faunaReviewGroundColor(env.FAUNA_REVIEW_PRESETS[id]).toArray(), id);
});

test('creature lab parity: planet-noon ground bounce equals Atlas SurfaceLighting at the same sun to 1e-6', {skip}, async () => {
  const {SurfaceLighting} = await atlasModule('src/surface-lighting.ts');
  const close = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance, `${label} ${a} != ${b}`);
  const closeColor = (a, b, tolerance, label) => { close(a.r, b.r, tolerance, label + '.r'); close(a.g, b.g, tolerance, label + '.g'); close(a.b, b.b, tolerance, label + '.b'); };
  // The real SurfaceLighting at full daylight, close to the ground, with the preset's sun.
  const preset = FAUNA_REVIEW_PRESETS['planet-noon'];
  const radiusM = 6000000, planet = new THREE.Group(); planet.scale.setScalar(radiusM); planet.updateMatrixWorld();
  const sunLight = new THREE.DirectionalLight(preset.key.color, preset.key.intensity), ambient = new THREE.AmbientLight('#91b3cc', .22);
  const surface = new SurfaceLighting(sunLight, ambient);
  surface.update({planet, radiusM, eye: new THREE.Vector3(0, radiusM + 2, 0), sun: new THREE.Vector3(...preset.key.position).normalize(),
    altitudeM: 2, atmosphere: true, enabled: true, immersive: false});
  close(surface.sky.intensity, preset.hemisphere.intensity, 1e-9, 'sky intensity');
  close(ambient.intensity, preset.ambient.intensity, 1e-9, 'ambient after full daylight');
  const lab = applyFaunaReviewLighting(new THREE.Scene(), preset);
  closeColor(lab.hemisphere.groundColor, surface.sky.groundColor, 1e-6, 'ground bounce');
  closeColor(lab.hemisphere.color, surface.sky.color, 1e-9, 'sky colour');
});

test('creature lab parity: shared recipe controls, eye helpers and lighting modules match ATLAS_DIR', {skip}, () => {
  // The complete planet-definition actor/state host is intentionally app-owned.
  // Preserve the unchanged ordinary recipe UI and camera/eye helpers as exact source,
  // rather than pretending the evolved host remains a byte-for-byte Atlas copy.
  const sharedControls = text => text.slice(text.indexOf('const GROUPS:'),text.indexOf('export interface ComposerLab{'));
  const controls=sharedControls(lf(resolve(KIT,'apps/creature-lab/src/creature-lab-composer.ts')));
  assert.ok(controls.length>10000,'the shared recipe/eye helper boundary must remain present');
  assert.equal(controls,sharedControls(lf(resolve(ATLAS,'src/creature-lab-composer.ts'))),'ordinary recipe controls or eye helpers drifted from Atlas');
  assert.equal(lf(resolve(KIT, 'apps/creature-lab/src/fauna-review-lighting.ts')), lf(resolve(ATLAS, 'src/fauna-review-lighting.ts')), 'fauna-review-lighting.ts drifted from Atlas');
  assert.equal(lf(resolve(KIT, 'apps/creature-lab/src/creature-lab.css')), lf(resolve(ATLAS, 'src/creature-lab.css')), 'creature-lab.css drifted from Atlas');
  const inlined = text => text.replace(/\/\*\* The planet surface's sky-dome[\s\S]*?export const REVIEW_GROUND_ALBEDO = [^\n]*\n\n/, '')
    .replace(/REVIEW_SKY_COLOR/g, 'SURFACE_SKY_COLOR').replace(/REVIEW_GROUND_ALBEDO/g, 'SURFACE_GROUND_ALBEDO');
  const atlasEnv = lf(resolve(ATLAS, 'src/fauna-review-environment.ts')).replace("import {SURFACE_GROUND_ALBEDO, SURFACE_SKY_COLOR} from './surface-lighting.ts';\n", '');
  assert.equal(inlined(lf(resolve(KIT, 'apps/creature-lab/src/fauna-review-environment.ts'))), atlasEnv, 'fauna-review-environment.ts drifted from Atlas');
});
