// Eye round EC2 pins (fauna-composer-eye-2, fauna-composer-skin-4), captured by
// tests/tools/capture-composer-skin4-pins.mjs. composer-skin4-links.json pins the current-rules build of the 28
// migrated neutral v1 texts whose earlier-rules build composer-skin3-links.json still pins byte for byte (checked in
// fauna-composer-individual.test.mjs); every entry drifts from skin-3 for one documented reason. Owner decision
// 2026-10-03: old links upgrade to the current eye rules. composer-eye-catalogue-links.json pins the eye review
// specimens (the 13 catalogue kinds, odd combinations, upgraded v3 links) exactly as the Lab builds them.
// Coat crisp v1 (fauna-composer-skin-5): composer-skin4-links.json is history; composer-skin5-links.json pins the
// current build of the same 28 texts, each entry naming its skin-4 pin and, if it moved, the step-4 cause (skin5Drift);
// the eye catalogue was repinned in place (repinnedAtSkin5, skinPreSkin5). docs/fauna-coat-crisp-v1.md, step 6.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {COMPOSER_V2_DEFAULTS, composerLegacyPresetId, decodeComposerRecipe, normalizeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {COMPOSER_SKIN_VERSION, buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {COMPOSER_EYE_VERSION} from '../src/fauna-composer-eye.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {resolveComposerEyes} from '../src/fauna-composer-face.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const skin4 = load('composer-skin4-links.json'), skin3 = load('composer-skin3-links.json'), cat = load('composer-eye-catalogue-links.json');
const skin5 = load('composer-skin5-links.json');
const BLEND = 'neck-to-head blend rings that still crossed after fanOutBends turn monotonically to the head axis';
const TRUNK = 'trunk join on a Hermite curve, trunk rings respaced by turn and taper';
/** A skin-5 drift names exactly the step-4 causes the build shows: an unfolded blend (debug.blendUnfolded), a trunk. */
const checkSkin5Drift = (reason, recipe, label) => {
  const graph = buildComposerGraph(recipe), dbg = buildComposerSkin(graph, {debug: true}).debug;
  assert.ok(reason.startsWith('fauna-composer-skin-5 (coat crisp v1 step 4): '), label);
  assert.equal(reason.includes(BLEND), dbg.blendUnfolded, `${label}: blend reason`);
  assert.equal(reason.includes(TRUNK), (graph.chains.trunk ?? []).length > 0, `${label}: trunk reason`);
};
const specimens = JSON.parse(readFileSync(new URL('./fauna-face-specimens.json', import.meta.url), 'utf8')).specimens;
const digest = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const DRIFT = 'fauna-composer-eye-2: eyes rebuilt under the current eye rules';

test('skin-4 fixture: the 28 skin-3 texts, captured at fauna-composer-skin-4 / eye-2, each drifting for the documented reason', () => {
  assert.equal(skin4.schema, 'composer-skin4-links-1');
  assert.deepEqual([skin4.capturedAt.skin, skin4.capturedAt.eye], ['fauna-composer-skin-4', 'fauna-composer-eye-2']);
  // history since skin-5: the current build is pinned in composer-skin5-links.json
  assert.deepEqual(Object.keys(skin4.byText).sort(), Object.keys(skin3.byText).sort());
  let ec4 = 0;
  for (const [text, pin] of Object.entries(skin4.byText)) {
    // (a skin-3 pin repinned in place at skin-5 keeps the one skin-4 replaced in skinPreSkin5)
    assert.equal(pin.skin3, skin3.byText[text].skinPreSkin5 ?? skin3.byText[text].skin, `${text}: the skin-3 pin it replaces`);
    assert.equal(pin.driftFromSkin3, DRIFT, text);
    assert.notEqual(pin.skin, pin.skin3, `${text}: a repin must differ from the pin it replaces`);
    // eyes are mesh-only: the bone count is skin-3's
    assert.equal(pin.bones, skin3.byText[text].bones, text);
    // eye round EC4 (head polish) repinned in place, recording the replaced pins and the reason
    if (pin.ec4Drift) {
      ec4++;
      assert.notEqual(pin.skinPreEC4, pin.skin, `${text}: an EC4 repin must differ from the pin it replaces`);
      assert.ok(pin.skin3PreEC4 && skin3.byText[text].ec4Drift, `${text}: its skin-3 twin was repinned for EC4 too`);
    }
  }
  assert.equal(ec4, skin4.repinnedAtEC4.changed);
});

test('skin-5 fixture: the 28 texts at fauna-composer-skin-5 / eye-2; each keeps its skin-4 pin or drifts for a step-4 cause', () => {
  assert.equal(skin5.schema, 'composer-skin5-links-1');
  assert.deepEqual([COMPOSER_SKIN_VERSION, COMPOSER_EYE_VERSION], [skin5.capturedAt.skin, skin5.capturedAt.eye]);
  assert.deepEqual(Object.keys(skin5.byText).sort(), Object.keys(skin4.byText).sort());
  let drifted = 0;
  for (const [text, pin] of Object.entries(skin5.byText)) {
    const old = skin4.byText[text];
    assert.deepEqual([pin.skin4, pin.gloss4, pin.bones], [old.skin, old.gloss, old.bones], `${text}: the skin-4 pin it follows`);
    if (!pin.skin5Drift) { assert.deepEqual([pin.skin, pin.gloss, pin.vertices, pin.triangles], [old.skin, old.gloss, old.vertices, old.triangles], text); continue; }
    drifted++;
    assert.notEqual(pin.skin, old.skin, `${text}: a repin must differ from the pin it replaces`);
    const decoded = decodeComposerRecipe(text).recipe, neutral = composerLegacyPresetId(decoded) ? {...decoded, ...COMPOSER_V2_DEFAULTS} : decoded;
    checkSkin5Drift(pin.skin5Drift, deriveComposerIndividual(neutral).recipe, text);
  }
  assert.equal(drifted, skin5.driftFromSkin4.changed);
  assert.ok(drifted > 0 && drifted < 28);
});

test('skin-5: migrated neutral v1 texts upgrade to the current eye rules and build their pin byte for byte', () => {
  for (const [text, pin] of Object.entries(skin5.byText)) {
    const decoded = decodeComposerRecipe(text).recipe;
    const neutral = composerLegacyPresetId(decoded) ? {...decoded, ...COMPOSER_V2_DEFAULTS} : decoded;
    assert.equal(neutral.eyeRules, 2, `${text}: an old link upgrades to the current eye rules`);
    const derived = deriveComposerIndividual(neutral);
    assert.equal(derived.traits.neutral, true, text);
    const graph = buildComposerGraph(derived.recipe), skin = buildComposerSkin(graph);
    assert.equal(digest(skin.positions, skin.index, skin.skinIndex, skin.skinWeight, skin.colors), pin.skin, text);
    assert.equal(digest(skin.gloss), pin.gloss, `${text}: gloss`);
    assert.deepEqual([skin.vertexCount, skin.triangleCount, graph.bones.length], [pin.vertices, pin.triangles, pin.bones], text);
  }
});

test('eye catalogue links: every eye review specimen builds its pin, through the public creature factory too', () => {
  assert.equal(cat.schema, 'composer-eye-catalogue-links-1');
  assert.equal(cat.capturedAt.skin, COMPOSER_SKIN_VERSION);
  const wanted = specimens.filter(s => ['eye-catalogue', 'eye-odd', 'eye-upgrade'].includes(s.group));
  assert.deepEqual(cat.links.map(l => l.name), wanted.map(s => s.name), 'the pins follow the specimen list');
  const kinds = new Set();
  for (const link of cat.links) {
    assert.equal(link.text, wanted.find(s => s.name === link.name).text, `${link.name}: frozen text`);
    const recipe = deriveComposerIndividual(normalizeComposerRecipe(decodeComposerRecipe(link.text).recipe).recipe).recipe, e = resolveComposerEyes(recipe);
    assert.deepEqual([e.kind, e.rules], [link.kind, link.eyeRules], link.name);
    const graph = buildComposerGraph(recipe), skin = buildComposerSkin(graph);
    assert.equal(digest(skin.positions, skin.index, skin.skinIndex, skin.skinWeight, skin.colors), link.skin, link.name);
    assert.equal(digest(skin.gloss), link.gloss, `${link.name}: gloss`);
    assert.deepEqual([skin.vertexCount, skin.triangleCount, graph.bones.length], [link.vertices, link.triangles, link.bones], link.name);
    if (link.group === 'eye-catalogue') kinds.add(link.kind);
    if (link.skin5Drift) { assert.notEqual(link.skinPreSkin5, link.skin, `${link.name}: a repin must differ`); checkSkin5Drift(link.skin5Drift, recipe, link.name); }
  }
  assert.equal(cat.links.filter(l => l.skin5Drift).length, cat.repinnedAtSkin5.changed);
  assert.equal(cat.capturedAtSkin4.skin, 'fauna-composer-skin-4');
  assert.equal(kinds.size, 13, 'one catalogue specimen per catalogue kind');
  const first = cat.links[0], c = createComposerCreature(decodeComposerRecipe(first.text).recipe);
  try { assert.equal(digest(c.skin.positions, c.skin.index, c.skin.skinIndex, c.skin.skinWeight, c.skin.colors), first.skin); }
  finally { c.dispose(); }
});
