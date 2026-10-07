// Composer gloss channel (face round WP4): a per-vertex `composerGloss` attribute lowers the coloured material's
// roughness toward 0.06 on the cornea, so the eye gets a real specular highlight. Checked without a GPU: the shader
// patch against three's own MeshStandardMaterial program text, the material wiring, and the gloss buffer itself.
// The pixel identity at gloss 0 is checked in a browser (test-results/fauna-face-round-2026-10-02/WP4/gloss-identity).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {COMPOSER_PRESET_IDS, composerPreset, normalizeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {COMPOSER_GLOSS_CACHE_KEY, COMPOSER_GLOSS_PATCH, COMPOSER_GLOSS_ROUGHNESS, createComposerColouredMaterial, createComposerCreature, patchComposerGlossShader} from '../src/fauna-composer.ts';

const count = (text, needle) => text.split(needle).length - 1;
const standard = () => ({vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader});

test('the gloss patch applies to three\'s MeshStandardMaterial program exactly once per edit', () => {
  const shader = standard();
  for (const [anchor] of [...COMPOSER_GLOSS_PATCH.vertex]) assert.equal(count(shader.vertexShader, anchor), 1, `vertex anchor ${anchor}`);
  for (const [anchor] of [...COMPOSER_GLOSS_PATCH.fragment]) assert.equal(count(shader.fragmentShader, anchor), 1, `fragment anchor ${anchor}`);
  patchComposerGlossShader(shader);
  assert.equal(count(shader.vertexShader, 'attribute float composerGloss;'), 1);
  assert.equal(count(shader.vertexShader, 'varying float vComposerGloss;'), 1);
  assert.equal(count(shader.vertexShader, 'vComposerGloss = composerGloss;'), 1);
  assert.equal(count(shader.fragmentShader, 'varying float vComposerGloss;'), 1);
  const mix = `roughnessFactor = mix(roughnessFactor, ${COMPOSER_GLOSS_ROUGHNESS.toFixed(2)}, vComposerGloss);`;
  assert.equal(count(shader.fragmentShader, mix), 1, 'the roughness mix, once');
  // after the roughness chunk (which declares roughnessFactor) and before anything reads it for lighting
  assert.ok(shader.fragmentShader.indexOf(mix) > shader.fragmentShader.indexOf('#include <roughnessmap_fragment>'));
  assert.ok(shader.fragmentShader.indexOf(mix) < shader.fragmentShader.indexOf('#include <lights_physical_fragment>'));
  assert.equal(COMPOSER_GLOSS_ROUGHNESS, 0.06);
  // a renamed chunk fails loudly instead of silently dropping the highlight
  assert.throws(() => patchComposerGlossShader({vertexShader: 'void main() {}', fragmentShader: standard().fragmentShader}), /anchor/);
  const twice = standard(); patchComposerGlossShader(twice);
  assert.throws(() => patchComposerGlossShader(twice), /already patched/, 'patching twice is refused');
});

test('material wiring: one coloured material with the gloss patch and its own program cache key; neutral untouched', () => {
  const m = createComposerColouredMaterial();
  try {
    assert.equal(m.customProgramCacheKey(), COMPOSER_GLOSS_CACHE_KEY);
    assert.equal(COMPOSER_GLOSS_CACHE_KEY, 'composer-gloss-1');
    assert.equal(m.roughness, 0.82); assert.equal(m.metalness, 0); assert.equal(m.vertexColors, true);
    const shader = standard(); m.onBeforeCompile(shader, null);
    assert.equal(count(shader.fragmentShader, 'vComposerGloss);'), 1);
  } finally { m.dispose(); }
  const c = createComposerCreature(composerPreset('giraffe'));
  try {
    assert.ok(!Array.isArray(c.mesh.material));
    const coloured = c.mesh.material;
    assert.equal(coloured.customProgramCacheKey(), COMPOSER_GLOSS_CACHE_KEY);
    const gloss = c.mesh.geometry.getAttribute('composerGloss');
    assert.equal(gloss.itemSize, 1);
    assert.equal(gloss.array, c.skin.gloss, 'the attribute is the skin gloss buffer');
    assert.equal(gloss.count, c.skin.vertexCount);
    c.setNeutral(true);
    const neutral = c.mesh.material;
    assert.notEqual(neutral, coloured);
    assert.equal(neutral.customProgramCacheKey(), new THREE.MeshStandardMaterial().customProgramCacheKey(), 'neutral material keeps three\'s default program');
    assert.equal(neutral.onBeforeCompile.toString(), new THREE.MeshStandardMaterial().onBeforeCompile.toString());
    c.setNeutral(false);
    assert.equal(c.mesh.material, coloured);
    assert.equal(c.details().drawCalls, 1);
  } finally { c.dispose(); }
});

test('gloss is 0 outside the eyes part, in [0, 1] everywhere, and present on every built eye', () => {
  const recipes = [...COMPOSER_PRESET_IDS.map(id => [id, composerPreset(id)]), ...Array.from({length: 40}, (_, i) => [`wild-${i}`, randomComposerRecipe(`gloss-${i}`)])];
  for (const [name, recipe] of recipes) {
    const skin = buildComposerSkin(buildComposerGraph(deriveComposerIndividual(normalizeComposerRecipe(recipe).recipe).recipe));
    assert.equal(skin.gloss.length, skin.vertexCount, name);
    const eyes = new Set();
    for (const p of skin.parts) if (p.part === 'eyes') for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) eyes.add(skin.index[i]);
    assert.ok(eyes.size > 0, `${name}: an eyes part`);
    let glossy = 0;
    for (let v = 0; v < skin.vertexCount; v++) {
      const g = skin.gloss[v];
      assert.ok(g >= 0 && g <= 1, `${name}: gloss ${g}`);
      if (!eyes.has(v)) assert.equal(g, 0, `${name}: vertex ${v} outside the eyes has gloss ${g}`);
      else if (g > 0) glossy++;
    }
    // eyespots are matt pigment; every other eye has a glossy cornea or facets
    if (!skin.parts.some(p => p.label === 'eyespots')) assert.ok(glossy > 0, `${name}: the eyes carry gloss`);
  }
});
