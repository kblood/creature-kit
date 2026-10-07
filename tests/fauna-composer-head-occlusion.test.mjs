// Composer head occlusion (eye round EC4, graph-4): the creature's own arms and wings must not cover its face in the
// three review views (front along the head axis, side from the left, three-quarter front-left), at rest and in
// every motion. GPT Luna 6 on wild seed 40 of the face round (limbless, grasping arms, feathered wings): "black shapes
// look like wings or limbs passing in front of and around the head". The arms of a long axial body (limbless,
// many-legged) sit on its front segment right behind a small head; graph-3 rested them forward (hands in front of the
// face: 34-68% of seed 40's face hidden in the review views). graph-4 rests them out to the side and back
// (AXIAL_ARM_REST) and the display pose raises every arm up and out (DISPLAY_ARM_RAISE) instead of straight forward.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {decodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {randomCoherentComposerRecipe} from '../src/fauna-composer-species.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {AXIAL_ARM_REST, COMPOSER_GRAPH_VERSION, DISPLAY_ARM_RAISE, buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {composerHeadOcclusion, composerHeadOcclusionOf} from './helpers/composer-head-occlusion.mjs';

const eff = r => deriveComposerIndividual(normalizeComposerRecipe(r).recipe).recipe;
const specimens = JSON.parse(readFileSync(new URL('./fauna-face-specimens.json', import.meta.url), 'utf8')).specimens;
const POSES = [['neutral', 0], ['idle', 0.3], ['idle', 1.1], ['walk', 0.3], ['walk', 1.1], ['display', 0.3], ['display', 1.1]];

test('versions and constants: graph-4 rests axial arms beside and behind the head, display raises arms up and out', () => {
  assert.equal(COMPOSER_GRAPH_VERSION, 'fauna-composer-graph-4');
  assert.deepEqual([...AXIAL_ARM_REST], [-0.2, -0.35, 0.75]);
  assert.deepEqual([...DISPLAY_ARM_RAISE], [-0.2, 0.9, 0.5]);
});

test('wild seed 40 (limbless, grasping arms, feathered wings): no arm or wing hides its face, at rest and in every motion', () => {
  const spec = specimens.find(s => s.name === 'wild-composer-40-flat-face-trunk-nasal');
  const recipe = eff(decodeComposerRecipe(spec.text).recipe);
  assert.deepEqual([recipe.layout, recipe.arms, recipe.wings], ['limbless', 'grasping', 'feathered']);
  for (const [motion, t] of POSES) {
    const o = composerHeadOcclusionOf(recipe, motion, t, {stride: 1});
    assert.ok(o.samples > 100 && o.worst === 0, `${motion}@${t}: front ${o.front}, side ${o.side}, 3/4 ${o.threeQuarter}`);
  }
  // the rest hands sit behind the head's root and out beside it, not in front of the face
  const graph = buildComposerGraph(recipe), hb = graph.bones[graph.chains.head];
  const hq = new THREE.Quaternion(...hb.restQuaternion).invert(), hp = new THREE.Vector3(...hb.restPosition);
  for (const limb of graph.limbs.filter(l => l.kind === 'arm')) {
    const l = new THREE.Vector3(...limb.rest).sub(hp).applyQuaternion(hq);
    assert.ok(l.x < 0 && Math.abs(l.z) > graph.dims.craniumWidth, `${limb.side}: rest hand at head-local ${l.toArray().map(x => x.toFixed(3))}`);
  }
});

test('the metric has teeth: seed 40 posed toward the graph-3 rest hands (forward of the shoulder) hides its face', () => {
  const spec = specimens.find(s => s.name === 'wild-composer-40-flat-face-trunk-nasal');
  const graph = buildComposerGraph(eff(decodeComposerRecipe(spec.text).recipe)), skin = buildComposerSkin(graph);
  for (const limb of graph.limbs.filter(l => l.kind === 'arm')) {
    // graph-3 armRestTarget for a non-biped: shoulder + (0.5, -0.42, 0.1 side) reach, hand kept above the floor
    const reach = limb.segments[0] + limb.segments[1], carrier = graph.bones[limb.socketBone];
    const sock = new THREE.Vector3(...limb.socket).applyQuaternion(new THREE.Quaternion(...carrier.restQuaternion)).add(new THREE.Vector3(...carrier.restPosition));
    const t = sock.add(new THREE.Vector3(0.5 * reach, -0.42 * reach, limb.side * 0.1 * reach));
    t.y = Math.max(t.y, limb.segments[2] + limb.segments[3] + 0.02 * reach);
    limb.rest = t.toArray();
  }
  const o = composerHeadOcclusion(graph, skin, 'neutral', 0, {stride: 1});
  assert.ok(o.worst > 0.25, `graph-3 rest hands: front ${o.front}, side ${o.side}, 3/4 ${o.threeQuarter}`);
});

test('review specimens with arms or wings: at most 2% of the face hidden at rest, idle and walk, 6% in display', () => {
  let checked = 0;
  for (const s of specimens) {
    const recipe = eff(decodeComposerRecipe(s.text).recipe);
    if (recipe.arms === 'none' && recipe.wings === 'none') continue;
    for (const [motion, t] of POSES) {
      const o = composerHeadOcclusionOf(recipe, motion, t, {stride: 4});
      assert.ok(o.worst <= (motion === 'display' ? 0.06 : 0.02), `${s.name} ${motion}@${t}: front ${o.front.toFixed(3)}, side ${o.side.toFixed(3)}, 3/4 ${o.threeQuarter.toFixed(3)}`);
    }
    checked++;
  }
  assert.ok(checked >= 25, `${checked} specimens`);
});

// The three known residual specimens: wild bipeds with feathered/membrane wings whose wing still crosses part of the
// face in the side view at display t=1.1. Measured at full vertex sampling (stride 1) at b86b0ad and independently
// reproduced by the Astra review (2026-10-03): side 4.67 % (19), 3.43 % (38), 2.98 % (115). ACCEPTANCE CEILING 6 %:
// this is the documented per-specimen ceiling for the known cases, deliberately tighter than the broad 8 % display
// guard of the generated-animal regression test below (which is a coarse-sampled corpus guard, not an acceptance).
// The metric counts sampled face vertices, not projected face pixels or eye visibility.
const KNOWN_WINGED = [[19, 0.0467], [38, 0.0343], [115, 0.0298]];
const KNOWN_WINGED_CEILING = 0.06;
test('known winged wild specimens 19, 38, 115: display@1.1 side cover pinned at the measured values, under the 6% ceiling', () => {
  for (const [seed, side] of KNOWN_WINGED) {
    const recipe = eff(randomComposerRecipe(String(seed)));
    assert.notEqual(recipe.wings, 'none', `seed ${seed} has wings`);
    const o = composerHeadOcclusionOf(recipe, 'display', 1.1, {stride: 1});
    const msg = `seed ${seed} display@1.1: front ${o.front.toFixed(4)}, side ${o.side.toFixed(4)}, 3/4 ${o.threeQuarter.toFixed(4)}`;
    assert.ok(Math.abs(o.side - side) < 0.0005, `pinned side ${side}: ${msg}`);
    assert.ok(o.worst <= KNOWN_WINGED_CEILING, `ceiling ${KNOWN_WINGED_CEILING}: ${msg}`);
  }
});

test('generated animals (wild and coherent seeds 0-63, plus wild 115) with arms or wings: at most 3% of the face hidden at rest, idle and walk, 8% in display', () => {
  let checked = 0, axial = 0;
  const pairs = [];
  for (let i = 0; i < 64; i++) pairs.push([i, eff(randomComposerRecipe(String(i)))], [i, eff(randomCoherentComposerRecipe(String(i)))]);
  pairs.push([115, eff(randomComposerRecipe('115'))]); // known winged specimen outside 0-63 (Astra review 2026-10-03)
  for (const [i, recipe] of pairs) {
    if (recipe.arms === 'none' && recipe.wings === 'none') continue;
    if ((recipe.layout === 'limbless' || recipe.layout === 'many-legged') && recipe.arms !== 'none') axial++;
    for (const [motion, t] of [['neutral', 0], ['idle', 0.3], ['walk', 1.1], ['display', 1.1]]) {
      const o = composerHeadOcclusionOf(recipe, motion, t, {stride: 6});
      assert.ok(o.worst <= (motion === 'display' ? 0.08 : 0.03), `${i} ${recipe.layout} ${recipe.arms}/${recipe.wings} ${motion}@${t}: front ${o.front.toFixed(3)}, side ${o.side.toFixed(3)}, 3/4 ${o.threeQuarter.toFixed(3)}`);
    }
    checked++;
  }
  assert.ok(checked >= 60 && axial >= 5, `${checked} animals, ${axial} axial bodies with arms`);
});
