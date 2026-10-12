import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {COMPOSER_PRESETS, COMPOSER_PRESET_IDS, COMPOSER_LAYOUTS, COMPOSER_RECIPE_KEYS, composerPreset, normalizeComposerRecipe, randomComposerRecipe,
  encodeComposerRecipe, decodeComposerRecipe, composerRecipesEqual, composerConstraints} from '../../src/fauna-composer-recipe.ts';
import {buildComposerGraph, poseComposer, COMPOSER_BUDGET, COMPOSER_MOTIONS} from '../../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../../src/fauna-composer-mesh.ts';
import {createComposerCreature} from '../../src/fauna-composer.ts';
import {parseCreatureLabState, creatureLabUrl, creatureLabComposerInputError, DEFAULT_LAB_STATE} from '../../apps/creature-lab/src/creature-lab-state.ts';

const recipes = [...COMPOSER_PRESET_IDS.map(id => [id, composerPreset(id)]), ...Array.from({length: 10}, (_, i) => [`random-${i}`, randomComposerRecipe(`composer-test-${i}`)])];
const built = recipes.map(([id, recipe]) => { const graph = buildComposerGraph(recipe); return {id, recipe, graph, skin: buildComposerSkin(graph)}; });
const signedVolume = (skin, part) => {
  const p = skin.positions, idx = skin.index; let v = 0;
  for (let t = part.firstTriangle; t < part.firstTriangle + part.triangles; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
};

test('skins are well formed: finite, valid indices, normalized weights to real bones, within the desktop budget', () => {
  for (const {id, graph, skin} of built) {
    assert.ok(skin.positions.every(Number.isFinite), id);
    assert.ok(skin.vertexCount <= COMPOSER_BUDGET.maxVertices && skin.triangleCount <= COMPOSER_BUDGET.maxTriangles, `${id} budget`);
    assert.ok(graph.bones.length <= COMPOSER_BUDGET.maxBones, `${id} bones`);
    for (let i = 0; i < skin.index.length; i++) assert.ok(skin.index[i] < skin.vertexCount, `${id} index`);
    for (let v = 0; v < skin.vertexCount; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) { const w = skin.skinWeight[v * 4 + k]; sum += w; if (w > 0) assert.ok(skin.skinIndex[v * 4 + k] < graph.bones.length, `${id} bone index`); }
      assert.ok(Math.abs(sum - 1) < 1e-4, `${id} vertex ${v} weight sum ${sum}`);
    }
    const covered = skin.parts.reduce((a, p) => a + p.triangles, 0);
    assert.equal(covered, skin.triangleCount, `${id} parts partition triangles`);
  }
});

test('every built part is a closed outward surface (positive signed volume)', () => {
  for (const {id, skin} of built) for (const part of skin.parts) if (part.triangles) assert.ok(signedVolume(skin, part) > 0, `${id} ${part.part} ${part.label}`);
});

test('layouts are structurally different, not relabelled', () => {
  const byLayout = {};
  for (const layout of COMPOSER_LAYOUTS) {
    const g = buildComposerGraph(normalizeComposerRecipe({...COMPOSER_PRESETS.dinosaur, layout, legPairs: 6}).recipe);
    byLayout[layout] = {legs: g.limbs.filter(l => l.kind === 'leg').length, gait: g.locomotion.gait, bones: g.bones.length};
  }
  assert.deepEqual(Object.fromEntries(Object.entries(byLayout).map(([k, v]) => [k, v.legs])), {limbless: 0, biped: 2, quadruped: 4, sprawled: 4, 'many-legged': 12});
  assert.equal(new Set(Object.values(byLayout).map(v => v.gait)).size, 5, JSON.stringify(byLayout));
  const parts = id => new Set(built.find(b => b.id === id).skin.parts.filter(p => p.triangles).map(p => p.part));
  assert.ok(parts('turtle').has('armor') && parts('bird').has('wing') && parts('rhinoceros').has('horn') && parts('ape').has('hand') && parts('trunked-centipede').has('trunk'));
  assert.ok(!parts('worm').has('leg') && !parts('worm').has('foot'));
  // Feet are distinct geometry, not one shared shape: each foot type has its own foot-part geometry hash.
  const footHash = feet => {
    const skin = buildComposerSkin(buildComposerGraph({...composerPreset('giraffe'), feet})), h = createHash('sha256');
    for (const p of skin.parts.filter(p => p.part === 'foot')) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) { const v = skin.index[i] * 3; h.update(Buffer.from(skin.positions.buffer, skin.positions.byteOffset + v * 4, 12)); }
    return h.digest('hex');
  };
  assert.equal(new Set(['hoof', 'paw', 'claw', 'pad', 'hand', 'spike'].map(footHash)).size, 6);
});

test('hybrids keep every chosen part and report adaptations instead of dropping them', () => {
  // v3: a trunk grows only from the Proboscis face, so the trunked worm hybrid chooses that face
  const hybrid = normalizeComposerRecipe({...COMPOSER_PRESETS.worm, armor: 'dome', head: 'proboscis', wings: 'membrane', arms: 'grasping'}).recipe;
  const g = buildComposerGraph(hybrid), skin = buildComposerSkin(g), parts = new Set(skin.parts.filter(p => p.triangles).map(p => p.part));
  for (const part of ['armor', 'trunk', 'wing', 'arm', 'hand']) assert.ok(parts.has(part), part);
  const reported = g.constraints.map(c => c.part);
  for (const part of ['Shell', 'Wings', 'Arms', 'Legs and feet']) assert.ok(reported.includes(part), `${part} in ${reported}`);
  assert.deepEqual(composerConstraints(hybrid), g.constraints.slice(0, composerConstraints(hybrid).length));
});

test('posed skin follows the joints: skinned vertices stay attached and move with motion', () => {
  for (const id of ['giraffe', 'centipede', 'worm', 'bird']) {
    const creature = createComposerCreature(composerPreset(id));
    const before = creature.bounds();
    for (const motion of COMPOSER_MOTIONS) {
      const pose = creature.update(motion, 0.8);
      assert.ok(pose.diagnostics.maxBoneLengthError < 1e-9, `${id} ${motion}`);
      const box = creature.bounds(), size = box.getSize(new THREE.Vector3());
      assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite));
      // Posed skin stays near its rest size (no exploded or collapsed weights).
      const rest = before.getSize(new THREE.Vector3());
      assert.ok(size.length() < rest.length() * 2.2 && size.length() > rest.length() * 0.4, `${id} ${motion} ${size.toArray()} vs ${rest.toArray()}`);
    }
    creature.dispose(); creature.dispose();
    assert.throws(() => creature.update('walk', 0), /disposed/);
  }
});

test('actor reports details within budget and disposes all GPU-side objects', () => {
  const creature = createComposerCreature(composerPreset('winged-ape-rhino'));
  const d = creature.details();
  assert.equal(d.withinBudget, true); assert.equal(d.drawCalls, 1);
  creature.setSkeletonVisible(true); assert.equal(creature.details().drawCalls, 2);
  let disposed = 0; const count = () => disposed++;
  creature.mesh.geometry.addEventListener('dispose', count);
  creature.mesh.material.addEventListener('dispose', count);
  creature.dispose();
  assert.equal(disposed, 2); assert.equal(creature.group.parent, null);
});

test('recipe text and lab URLs round-trip every field', () => {
  for (const [, recipe] of recipes) {
    const decoded = decodeComposerRecipe(encodeComposerRecipe(recipe));
    assert.equal(decoded.error, null); assert.deepEqual(decoded.issues, []);
    assert.ok(composerRecipesEqual(decoded.recipe, recipe));
  }
  const state = {...DEFAULT_LAB_STATE, mode: 'composer', recipe: encodeComposerRecipe(composerPreset('ostrich')), compare: true,
    compareRecipe: encodeComposerRecipe(randomComposerRecipe('x')), composerSeed: 'seed 7/æ', motion: 'display', time: 12.345, view: 'side', skeleton: true};
  const url = new URL(creatureLabUrl('https://example.test/lab/creature-lab.html', state));
  assert.deepEqual(parseCreatureLabState(url.search), state);
  assert.ok(!url.searchParams.has('bodyCondition') && !url.searchParams.has('assetHash'), 'composer links carry only composer state');
  for (const key of COMPOSER_RECIPE_KEYS) assert.match(url.searchParams.get('recipe'), new RegExp(`\\*${key}_`));
  assert.equal(creatureLabComposerInputError('?mode=composer&recipe=a&recipe=b'), 'Invalid composer link: repeated recipe');
  assert.match(creatureLabComposerInputError('?mode=composer&motion=teleport'), /unknown motion/);
  assert.match(decodeComposerRecipe(parseCreatureLabState(`?mode=composer&recipe=v1*${'x'.repeat(3000)}`).recipe).error, /longer than/);
  assert.match(decodeComposerRecipe('v5*layout_biped').error, /Unsupported/);
  assert.match(decodeComposerRecipe('v999*layout_biped').error, /Unsupported/);
});

test('seeded random combinations are deterministic and mix parts across presets', () => {
  assert.deepEqual(randomComposerRecipe('a'), randomComposerRecipe('a'));
  const many = Array.from({length: 40}, (_, i) => randomComposerRecipe(`mix-${i}`));
  assert.equal(new Set(many.map(r => r.layout)).size, 5);
  const isPreset = r => COMPOSER_PRESET_IDS.some(id => composerRecipesEqual(composerPreset(id), r));
  assert.ok(many.every(r => !isPreset(r)));
  for (const r of many) { const g = buildComposerGraph(r); const p = poseComposer(g, 'walk', 1.1); assert.ok(p.diagnostics.maxReachError < 1e-6 || p.contacts.every(c => !c.stance || c.reachError < 1e-6)); }
});
