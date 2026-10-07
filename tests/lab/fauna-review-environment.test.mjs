import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FAUNA_REVIEW_PRESETS, FAUNA_REVIEW_PRESET_IDS, applyFaunaReviewLighting, faunaReviewFillKeyRatio, faunaReviewGroundColor, faunaReviewSunPosition, isFaunaReviewPresetId} from '../../apps/creature-lab/src/fauna-review-environment.ts';
import {REVIEW_SKY_COLOR as SURFACE_SKY_COLOR} from '../../apps/creature-lab/src/fauna-review-environment.ts';
import {FAUNA_REVIEW_SHADOWS} from '../../apps/creature-lab/src/fauna-review-lighting.ts';

const close = (a, b, tolerance = 1e-6, label = '') => assert.ok(Math.abs(a - b) <= tolerance, `${label} ${a} != ${b}`);
const closeColor = (a, b, tolerance = 1e-6, label = '') => { close(a.r, b.r, tolerance, label + '.r'); close(a.g, b.g, tolerance, label + '.g'); close(a.b, b.b, tolerance, label + '.b'); };
const elevation = light => THREE.MathUtils.radToDeg(Math.asin(light.position.clone().normalize().y));

test('studio reproduces the legacy Creature Lab light rig exactly', () => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#123456');
  const lab = applyFaunaReviewLighting(scene, 'studio');
  // Legacy creature-lab.ts:38-42 constructed exactly these lights.
  const legacyHemi = new THREE.HemisphereLight('#cdeeff', '#263d32', 2.8), legacyKey = new THREE.DirectionalLight('#ffe0b2', 3.8), legacyAmbient = new THREE.AmbientLight('#56817b', .6);
  legacyKey.position.set(-20, 38, 26);
  assert.equal(lab.hemisphere.intensity, 2.8); assert.equal(lab.key.intensity, 3.8); assert.equal(lab.ambient.intensity, .6);
  assert.ok(lab.hemisphere.color.equals(legacyHemi.color)); assert.ok(lab.hemisphere.groundColor.equals(legacyHemi.groundColor));
  assert.ok(lab.key.color.equals(legacyKey.color)); assert.ok(lab.ambient.color.equals(legacyAmbient.color));
  assert.deepEqual(lab.key.position.toArray(), [-20, 38, 26]); assert.deepEqual(lab.key.target.position.toArray(), [0, 0, 0]);
  assert.deepEqual(lab.key.shadow.mapSize.toArray(), [FAUNA_REVIEW_SHADOWS.mapSize, FAUNA_REVIEW_SHADOWS.mapSize]);
  assert.ok(scene.background.equals(new THREE.Color('#08131a')), 'legacy Lab background');
  assert.equal(FAUNA_REVIEW_PRESETS.studio.ground, '#36504a'); assert.equal(FAUNA_REVIEW_PRESETS.studio.exposure, 1.15);
  assert.equal(scene.children.filter(o => o.isLight).length, 3);
  lab.dispose(); lab.dispose();
  assert.equal(scene.children.length, 0, 'dispose removes every light');
  assert.ok(scene.background.equals(new THREE.Color('#123456')), 'dispose restores the previous background');
  close(faunaReviewFillKeyRatio(FAUNA_REVIEW_PRESETS.studio), (2.8 + .6) / 3.8, 1e-12);
  close(faunaReviewFillKeyRatio(FAUNA_REVIEW_PRESETS.studio), .9, .02, 'studio ratio about 0.9');
});

test('planet presets: sun elevation, colour and intensities as specified', () => {
  const scene = new THREE.Scene();
  const noon = applyFaunaReviewLighting(scene, 'planet-noon');
  close(elevation(noon.key), 55, 1e-9, 'noon elevation'); assert.equal(noon.key.intensity, 3);
  assert.ok(noon.key.color.equals(new THREE.Color('#fff1dc')));
  assert.equal(noon.hemisphere.intensity, .7); closeColor(noon.hemisphere.color, SURFACE_SKY_COLOR, 1e-9, 'sky');
  close(noon.ambient.intensity, .22 * .4, 1e-12, 'noon ambient');
  noon.dispose();
  const evening = applyFaunaReviewLighting(scene, FAUNA_REVIEW_PRESETS['planet-evening']);
  close(elevation(evening.key), 12, 1e-9, 'evening elevation'); assert.equal(evening.key.intensity, 1.6);
  assert.ok(evening.key.color.equals(new THREE.Color('#ffb070')));
  assert.equal(evening.hemisphere.intensity, .35); close(evening.ambient.intensity, .088, 1e-12);
  evening.dispose();
  // Planet suns keep the studio key's compass direction, so swapping presets never mirrors the light.
  const studio = new THREE.Vector3(-20, 0, 26).normalize(), sun = new THREE.Vector3(...faunaReviewSunPosition(55)).setY(0).normalize();
  close(studio.dot(sun), 1, 1e-12, 'azimuth');
  close(new THREE.Vector3(...faunaReviewSunPosition(30)).length(), Math.hypot(-20, 38, 26), 1e-9, 'distance');
  for (const id of FAUNA_REVIEW_PRESET_IDS) {
    const lab = applyFaunaReviewLighting(scene, id);
    assert.ok(lab.key.position.y > 0, `${id} key shines downward`);
    assert.ok(!scene.environment, `${id}: no environment map`);
    lab.dispose();
  }
  assert.equal(isFaunaReviewPresetId('planet-noon'), true); assert.equal(isFaunaReviewPresetId('noon'), false);
  assert.throws(() => applyFaunaReviewLighting(scene, 'bogus'), /Unknown/);
});

test('planet-noon fill/key ratio is planet-like (0.2-0.35), far below studio', () => {
  const noon = faunaReviewFillKeyRatio(FAUNA_REVIEW_PRESETS['planet-noon']), evening = faunaReviewFillKeyRatio(FAUNA_REVIEW_PRESETS['planet-evening']);
  assert.ok(noon >= .2 && noon <= .35, `noon ${noon}`);
  assert.ok(evening >= .2 && evening <= .35, `evening ${evening}`);
  assert.ok(faunaReviewFillKeyRatio(FAUNA_REVIEW_PRESETS.studio) > 3 * noon);
});

test('ground bounce: evening follows the SurfaceLighting formula; studio ground is explicit', () => {
  // Evening uses the same formula at its own (specified) sky intensity.
  const ev = FAUNA_REVIEW_PRESETS['planet-evening'], s = new THREE.Vector3(...ev.key.position).normalize();
  const expected = new THREE.Color(ev.key.color).multiplyScalar(s.y * ev.key.intensity / ev.hemisphere.intensity).add(new THREE.Color(ev.hemisphere.sky)).multiply(new THREE.Color('#697451'));
  closeColor(faunaReviewGroundColor(ev), expected, 1e-6, 'evening bounce');
  closeColor(faunaReviewGroundColor(FAUNA_REVIEW_PRESETS.studio), new THREE.Color('#263d32'), 0, 'studio ground');
});
