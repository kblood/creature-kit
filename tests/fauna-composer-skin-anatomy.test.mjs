// Composer skin anatomy (skin-2, eyes skin-3): neck-to-head blend, limb roots, splined bends, section shape, budgets and the
// separation of colour inputs from geometry. Measured on the actual skin buffers and the skin's debug rings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composerPreset, COMPOSER_PRESET_IDS, COMPOSER_RANGES, normalizeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {buildComposerGraph, COMPOSER_BUDGET} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin, COMPOSER_SKIN_VERSION, COMPOSER_SKIN_TESSELLATION} from '../src/fauna-composer-mesh.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {composerIndividualTraits, deriveComposerIndividual} from '../src/fauna-composer-individual.ts';

const digest = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
/** What createComposerCreature builds: the species recipe through the individual derivation. */
const effective = input => deriveComposerIndividual(normalizeComposerRecipe(input).recipe).recipe;
const build = (input, options = {debug: true}) => { const graph = buildComposerGraph(effective(input)); return {graph, skin: buildComposerSkin(graph, options)}; };
const meanRadius = r => (r.rx + 0.5 * (r.ry + r.ryBelow)) / 2;
const turnDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const presets = new Map(COMPOSER_PRESET_IDS.map(id => [id, build(composerPreset(id))]));
const limbChains = rings => [...new Set(rings.map(r => r.chain))].filter(c => c.startsWith('leg') || c.startsWith('arm'));
const partGeometry = (skin, pred) => {
  const out = [];
  for (const p of skin.parts) if (pred(p)) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) { const v = skin.index[i]; out.push(...skin.positions.subarray(v * 3, v * 3 + 3), ...skin.skinWeight.subarray(v * 4, v * 4 + 4)); }
  return new Float32Array(out);
};

test('skin version and the spec tessellation', () => {
  assert.equal(COMPOSER_SKIN_VERSION, 'fauna-composer-skin-4', 'skin-4: eye round EC2 (fauna-composer-eye-2)');
  assert.equal(COMPOSER_SKIN_TESSELLATION.eyeRadial, 20, 'lidded eye rings (fauna-composer-eye-1)');
  assert.equal(COMPOSER_SKIN_TESSELLATION.torsoRadial, 28);
  assert.equal(COMPOSER_SKIN_TESSELLATION.legRadial, 16);
  assert.equal(COMPOSER_SKIN_TESSELLATION.rootRings, 4);
  for (const [id, {skin}] of presets) {
    assert.equal(skin.regions.length, skin.vertexCount, `${id}: one region per vertex`);
    assert.ok(skin.debug && skin.debug.rings.length > 0, `${id}: debug rings`);
  }
});

test('neck-to-head blend: at least two mixed-weight rings and no radius step above 1.15', () => {
  for (const [id, {graph, skin}] of presets) {
    const axial = skin.debug.rings.filter(r => r.chain === 'axial'), blend = axial.filter(r => r.kind === 'blend'), head = graph.chains.head;
    const mixed = blend.filter(r => { const w = r.weights.find(([b]) => b === head)?.[1] ?? 0; return w > 0.15 && w < 0.85; });
    assert.ok(mixed.length >= 2, `${id}: ${mixed.length} rings with head weight in (0.15, 0.85)`);
    // from the last neck (or torso) ring through every blend ring to the head's first station (the last blend ring)
    const seq = axial.slice(axial.indexOf(blend[0]) - 1).map(meanRadius);
    for (let i = 0; i + 1 < seq.length; i++) {
      const ratio = Math.max(seq[i + 1] / seq[i], seq[i] / seq[i + 1]);
      assert.ok(ratio <= 1.15, `${id}: consecutive neck/head mean-radius ratio ${ratio.toFixed(3)} (v1 baseline 1.58)`);
    }
    // head weight rises monotonically to the head station
    const hw = blend.map(r => r.weights.find(([b]) => b === head)?.[1] ?? 0);
    for (let i = 1; i < hw.length; i++) assert.ok(hw[i] >= hw[i - 1] - 1e-9, `${id}: head weight ramps`);
  }
});

test('limb roots: four rings hand over from the carrier in steps of at most 0.4 and never exceed 1.15x the first limb ring', () => {
  for (const [id, {skin}] of presets) for (const chain of limbChains(skin.debug.rings)) {
    const rings = skin.debug.rings.filter(r => r.chain === chain), roots = rings.filter(r => r.kind === 'root');
    assert.equal(roots.length, COMPOSER_SKIN_TESSELLATION.rootRings, `${id}/${chain}: root ring count`);
    const limbBone = roots[roots.length - 1].bone;
    const carrier = r => r.weights.filter(([b]) => b !== limbBone).reduce((a, [, w]) => a + w, 0) / r.weights.reduce((a, [, w]) => a + w, 0);
    assert.ok(Math.abs(carrier(roots[0]) - 1) < 1e-6, `${id}/${chain}: the first root ring rides the carrier`);
    assert.ok(carrier(roots[roots.length - 1]) < 1e-6, `${id}/${chain}: the last root ring is the limb's first ring`);
    const first = roots[roots.length - 1], firstR = Math.max(first.rx, first.ry, first.ryBelow);
    for (let i = 0; i + 1 < roots.length; i++) assert.ok(Math.abs(carrier(roots[i]) - carrier(roots[i + 1])) <= 0.4 + 1e-9, `${id}/${chain}: carrier weight step`);
    for (const r of roots) assert.ok(Math.max(r.rx, r.ry, r.ryBelow) <= 1.15 * firstR + 1e-9, `${id}/${chain}: root radius ${(Math.max(r.rx, r.ry, r.ryBelow) / firstR).toFixed(3)}x the first limb ring`);
  }
});

test('splined chains: no tangent turn above 15 degrees between consecutive rings on legs, arms, neck and tail', t => {
  const fallbacks = {};
  for (const [id, {skin}] of presets) {
    fallbacks[id] = skin.debug.splineFallbacks;
    const chains = [...new Set(skin.debug.rings.map(r => r.chain))];
    for (const chain of chains) {
      const rings = skin.debug.rings.filter(r => r.chain === chain);
      for (let i = 0; i + 1 < rings.length; i++) {
        const turn = turnDeg(rings[i].tangent, rings[i + 1].tangent);
        assert.ok(turn <= 15, `${id}/${chain}: ${turn.toFixed(1)} degree turn between rings ${i} and ${i + 1}`);
      }
    }
  }
  t.diagnostic(`spline fallbacks per preset: ${JSON.stringify(fallbacks)}`);
  assert.ok(Object.values(fallbacks).every(n => Number.isInteger(n) && n >= 0));
});

test('section shape: thigh mass over the knee and deep unguligrade/digitigrade cannons', () => {
  for (const [id, {graph, skin}] of presets) {
    if (graph.recipe.legs === 'arthropod') continue;
    for (const chain of limbChains(skin.debug.rings).filter(c => c.startsWith('leg'))) {
      const rings = skin.debug.rings.filter(r => r.chain === chain), bones = [...new Set(rings.map(r => r.bone))];
      if (bones.length < 2) continue;
      const upper = rings.filter(r => r.bone === bones[0]).sort((a, b) => a.f - b.f);
      const at = f => { if (f <= upper[0].f) return meanRadius(upper[0]); for (let i = 1; i < upper.length; i++) if (upper[i].f >= f) { const t = (f - upper[i - 1].f) / (upper[i].f - upper[i - 1].f); return meanRadius(upper[i - 1]) * (1 - t) + meanRadius(upper[i]) * t; } return meanRadius(upper[upper.length - 1]); };
      const knee = rings.find(r => r.bone === bones[1] && r.f === 0) ?? rings.find(r => r.bone === bones[1]);
      const thigh = Math.max(at(0.2), at(0.25), at(0.3));
      assert.ok(thigh >= 1.3 * meanRadius(knee), `${id}/${chain}: upper leg ${thigh.toFixed(4)} vs knee ${meanRadius(knee).toFixed(4)}`);
      if (graph.recipe.legs === 'unguligrade' || graph.recipe.legs === 'digitigrade') for (const r of rings.filter(x => x.bone !== bones[0] && x.kind !== 'root')) {
        const ratio = 0.5 * (r.ry + r.ryBelow) / r.rx;
        assert.ok(ratio >= 1.2 && ratio <= 1.5, `${id}/${chain}: distal fore-aft/lateral ${ratio.toFixed(3)}`);
      }
    }
  }
});

test('budgets: presets within 40k triangles / 30k vertices, worst endpoint within 70k / 48k, one draw call', t => {
  for (const [id, {skin}] of presets) {
    assert.ok(skin.triangleCount <= 40000 && skin.vertexCount <= 30000, `${id}: ${skin.triangleCount} triangles / ${skin.vertexCount} vertices`);
  }
  let worst = [0, 0], built = 0;
  for (const layout of ['quadruped', 'biped', 'sprawled', 'many-legged', 'limbless']) for (const armor of ['osteoderms', 'plates', 'dome', 'bands']) for (const tail of ['club', 'feather-fan', 'whip']) {
    const recipe = {...composerPreset('trunked-centipede'), layout, armor, tail, arms: 'grasping', wings: 'membrane', trunk: 'trunk', horns: 'paired', individualSeed: 0, maturity: 1, condition: 0};
    for (const [k, r] of Object.entries(COMPOSER_RANGES)) if (!(k in {individualSeed: 1, maturity: 1, condition: 1})) recipe[k] = r[1];
    let skin;
    try { skin = build(recipe, {}).skin; } catch { continue; } // a combination the recipe normaliser rejects is not an endpoint
    built++; worst = [Math.max(worst[0], skin.triangleCount), Math.max(worst[1], skin.vertexCount)];
  }
  t.diagnostic(`worst of ${built} maximal endpoints: ${worst[0]} triangles / ${worst[1]} vertices`);
  assert.ok(built >= 30, `${built} endpoints built`);
  assert.ok(worst[0] <= 70000 && worst[1] <= 48000, `worst endpoint ${worst[0]} triangles / ${worst[1]} vertices`);
  assert.ok(worst[0] <= COMPOSER_BUDGET.maxTriangles && worst[1] <= COMPOSER_BUDGET.maxVertices);
  const c = createComposerCreature(composerPreset('winged-ape-rhino'));
  try { assert.equal(c.details().drawCalls, 1); } finally { c.dispose(); }
});

test('colour inputs never move geometry: colorSeed, palette and pattern keep positions, index and skinning', () => {
  for (const id of COMPOSER_PRESET_IDS) {
    const base = composerPreset(id), a = build(base, {}).skin;
    for (const change of [{colorSeed: 4242}, {pattern: 'spots'}, {pattern: 'reticulated', palette: 'tawny'}, {pattern: 'stripes', colorSeed: 7}]) {
      const b = build({...base, ...change}, {}).skin;
      assert.equal(digest(b.positions, b.index, b.skinIndex, b.skinWeight), digest(a.positions, a.index, a.skinIndex, a.skinWeight), `${id} ${JSON.stringify(change)}`);
    }
  }
});

test('individual traits reshape horns and ears; neutral traits equal a forced-neutral build', () => {
  const recipe = {...composerPreset('rhinoceros'), variability: 1};
  const graph = buildComposerGraph(effective(recipe));
  const horn = p => p.part === 'horn', ears = p => p.label.endsWith('ears'), eyes = p => p.part === 'eyes';
  const t1 = composerIndividualTraits({...graph.recipe, individualSeed: 1}), t2 = composerIndividualTraits({...graph.recipe, individualSeed: 2});
  const s1 = buildComposerSkin(graph, {traits: t1}), s2 = buildComposerSkin(graph, {traits: t2});
  for (const [name, pred] of [['horn', horn], ['ears', ears]]) {
    const a = partGeometry(s1, pred), b = partGeometry(s2, pred);
    assert.ok(a.length > 0, `rhino has ${name}`);
    assert.notEqual(digest(a), digest(b), `individualSeed must change the ${name}`);
  }
  // A truly neutral recipe (seed 0, maturity 1, condition 0, no sex, allometry 0) against the identity traits forced in.
  const neutralRecipe = {...recipe, individualSeed: 0, maturity: 1, condition: 0, sex: 'none', allometry: 0};
  const ng = buildComposerGraph(effective(neutralRecipe)), traits = composerIndividualTraits(ng.recipe);
  assert.equal(traits.neutral, true);
  const forced = {...traits, hornScale: 1, hornCurl: 0, hornAsym: 0, earScale: 1, eyeScale: 1, allometry: {...traits.allometry, eyeRel: 1}, countScale: {osteoderm: 0, plate: 0, feather: 0}, neutral: true};
  const n0 = buildComposerSkin(ng), n1 = buildComposerSkin(ng, {traits: forced});
  for (const pred of [horn, ears, eyes]) assert.equal(digest(partGeometry(n0, pred)), digest(partGeometry(n1, pred)));
  assert.equal(digest(n0.positions, n0.colors, n0.index), digest(n1.positions, n1.colors, n1.index), 'neutral traits are the identity');
});

test('eyes scale with the individual eyeScale and the allometric eyeRel, for every eye kind', () => {
  for (const id of ['giraffe', 'bird', 'dinosaur', 'ape', 'centipede', 'worm']) {
    const graph = buildComposerGraph(effective(composerPreset(id))), traits = composerIndividualTraits(graph.recipe);
    const er = t => buildComposerSkin(graph, {traits: t, debug: true}).debug.eyes.map(e => e.er);
    const base = er(traits);
    const big = er({...traits, eyeScale: traits.eyeScale * 1.25, neutral: false});
    const rel = er({...traits, allometry: {...traits.allometry, eyeRel: traits.allometry.eyeRel * 0.8}, neutral: false});
    assert.equal(base.length, 2, id);
    base.forEach((r, i) => {
      assert.ok(Math.abs(big[i] / r - 1.25) < 1e-9, `${id}: eyeScale x1.25 gives er x${(big[i] / r).toFixed(4)}`);
      assert.ok(Math.abs(rel[i] / r - 0.8) < 1e-9, `${id}: eyeRel x0.8 gives er x${(rel[i] / r).toFixed(4)}`);
    });
  }
});

test('the underside of every chain ring stays above the joint-underside line within the clamp floor', () => {
  for (const [id, {skin}] of presets) for (const r of skin.debug.rings) {
    assert.ok(r.ryBelow > 0 && r.ryBelow >= 0.35 * r.ry - 1e-9, `${id}/${r.chain}: underside ${r.ryBelow} vs ${r.ry}`);
  }
});
