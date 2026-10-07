// Eye catalogue contract (EC1: fauna-composer-eye-catalogue-1, fauna-composer-face-2, recipe v4 / eyeRules).
// The oracle is tests/fixtures/composer-baseline-v3.json: every eye resolution of the face round (recipe v3,
// fauna-composer-face-1), captured by tests/tools/capture-composer-baseline-v3.mjs from the unmodified code at 07036b0
// before any EC1 source edit (never regenerate it). Owner decisions 2026-10-03: old links upgrade to the current eye
// rules (eyeRules 2) and the face round's rules stay selectable (eyeRules 1); odd combinations are built; the wild
// generator rarely (5-10 %) draws an unusual kind through a pure hash; named kinds only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  CATALOGUE_EYE_KINDS, CATALOGUE_IRIS_IDS, COMPOSER_EYE_CATALOGUE_VERSION, COMPOSER_EYE_KINDS, EYE_IRIS_IDS, EYE_PRESETS, FACE_ROUND_EYE_KINDS,
  composerEyeNative, composerEyeStandIn, eyeKindHasIris,
} from '../src/fauna-composer-eye-catalogue.ts';
import {
  COMPOSER_EYE_TYPES, COMPOSER_FACES, COMPOSER_FACE_VERSION, COMPOSER_IRIS, COMPOSER_IRIS_RGB, FACE_EYE_PROFILE, composerAutoEyeType, composerFaceConstraints,
  composerIrisBands, composerIrisKind, resolveComposerEyes,
} from '../src/fauna-composer-face.ts';
import {
  COMPOSER_PRESET_IDS, COMPOSER_RANGES, COMPOSER_RECIPE_VERSION, COMPOSER_V2_KEYS, COMPOSER_V3_RANGE_KEYS, COMPOSER_WILD_UNUSUAL_EYES_PER_MILLE, composerEyeUpgradeIssue,
  composerPreset, composerWildEyes, decodeComposerRecipe, encodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe,
} from '../src/fauna-composer-recipe.ts';
import {COMPOSER_SPECIES_EYE_FLAVOUR, coherentComposerSpecies, composerSpeciesEyeFlavour} from '../src/fauna-composer-species.ts';
import {composerSpeciesKey} from '../src/fauna-composer-individual.ts';
import {buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../src/fauna-composer-mesh.ts';

const B = JSON.parse(readFileSync(new URL('./fixtures/composer-baseline-v3.json', import.meta.url), 'utf8'));
const catalogueSource = readFileSync(new URL('../src/fauna-composer-eye-catalogue.ts', import.meta.url), 'utf8');
const J = JSON.stringify;
/** The face round's resolution tuple, as the baseline recorded it. */
const eye = r => { const e = resolveComposerEyes(r); return [e.built, e.irisBuilt, e.gazeYawDeg, e.k, e.effect]; };
const early = r => ({...r, eyeRules: 1});
const v2digest = r => createHash('sha256').update(COMPOSER_V2_KEYS.map(k => `${k}_${String(r[k])}`).join('*')).digest('hex').slice(0, 16);
const decode = text => { const d = decodeComposerRecipe(text); assert.equal(d.error, null, text); return d; };

test('baseline fixture: captured before EC1, from the face round', () => {
  assert.equal(B.schema, 'composer-baseline-v3-1');
  assert.deepEqual([B.capturedAt.recipeVersion, B.capturedAt.face], [3, 'fauna-composer-face-1']);
  assert.deepEqual(B.counts, {legacyTexts: 420, skin3Texts: 28, presets: 12, wild: 1000, coherent: 1000});
  assert.equal(Object.keys(B.legacy).length, 420); assert.equal(Object.keys(B.skin3).length, 28);
});

test('catalogue module: pure, import-free, versioned; 5 face-round kinds then 13 appended; 9 + 3 iris colours', () => {
  assert.equal(COMPOSER_EYE_CATALOGUE_VERSION, 'fauna-composer-eye-catalogue-1');
  assert.equal(COMPOSER_FACE_VERSION, 'fauna-composer-face-2');
  for (const banned of ['three', 'Math.random', 'Date']) assert.ok(!catalogueSource.includes(banned), `catalogue contains '${banned}'`);
  assert.ok(!/^\s*import\s/m.test(catalogueSource), 'no imports at all');
  assert.deepEqual([...FACE_ROUND_EYE_KINDS], ['round', 'horizontal', 'vertical-slit', 'compound', 'eyespot']);
  assert.deepEqual([...CATALOGUE_EYE_KINDS], ['raptor', 'owl', 'cat', 'gecko', 'frog', 'chameleon', 'crocodile', 'sclera', 'nocturnal', 'cephalopod', 'insect', 'spider', 'stalk']);
  assert.deepEqual([...COMPOSER_EYE_KINDS], [...FACE_ROUND_EYE_KINDS, ...CATALOGUE_EYE_KINDS]);
  assert.deepEqual([...COMPOSER_EYE_TYPES], ['auto', ...COMPOSER_EYE_KINDS]);
  assert.deepEqual([...CATALOGUE_IRIS_IDS], ['blue', 'copper', 'grey-green']);
  assert.deepEqual([...COMPOSER_IRIS], ['auto', ...EYE_IRIS_IDS]);
  assert.deepEqual(Object.keys(COMPOSER_IRIS_RGB), [...EYE_IRIS_IDS]);
  for (const rgb of Object.values(COMPOSER_IRIS_RGB)) for (const c of rgb) assert.ok(c >= 0 && c <= 1);
  assert.ok(Object.isFrozen(EYE_PRESETS) && Object.isFrozen(EYE_PRESETS.cat) && Object.isFrozen(EYE_PRESETS.cat.placement));
  assert.deepEqual(Object.keys(EYE_PRESETS), [...COMPOSER_EYE_KINDS]);
  for (const kind of COMPOSER_EYE_KINDS) {
    const t = EYE_PRESETS[kind];
    assert.equal(t.kind, kind); assert.ok(t.label.length > 4 && t.size > 0, kind);
    assert.ok(FACE_ROUND_EYE_KINDS.includes(t.standIn), `${kind}: stands in as a face-round kind`);
    assert.ok(t.nativeFaces.length > 0 && t.nativeFaces.every(f => COMPOSER_FACES.includes(f)), kind);
    assert.equal(eyeKindHasIris(kind), t.structure === 'camera', kind);
    if (t.irisBands) for (const id of t.irisBands) assert.ok(EYE_IRIS_IDS.includes(id), `${kind}: ${id}`);
    if (!eyeKindHasIris(kind)) assert.deepEqual(t.irisBands ?? [], [], `${kind}: no iris, no bands`);
    for (const face of COMPOSER_FACES) assert.ok(FACE_ROUND_EYE_KINDS.includes(composerEyeStandIn(kind, face)), `${kind} on ${face}`);
  }
  // every catalogue kind is native somewhere, and its native face is where coherent species use it
  for (const kind of CATALOGUE_EYE_KINDS) assert.ok(COMPOSER_FACES.some(face => composerEyeNative(kind, face)), kind);
});

test('eyeRules 1 reproduces the face round byte for byte: 420 legacy + 28 skin-3 texts, 12 presets x 6 choices, 1000 + 1000 generated', () => {
  let checked = 0;
  for (const map of [B.legacy, B.skin3]) for (const [text, b] of Object.entries(map)) { assert.deepEqual(eye(early(decode(text).recipe)), b.eye, text); checked++; }
  for (const [id, b] of Object.entries(B.presets)) {
    const p = composerPreset(id);
    assert.deepEqual(eye(early(p)), b.eye, id); checked++;
    for (const [eyes, e] of Object.entries(b.explicit)) { assert.deepEqual(eye(early({...p, eyes})), e, `${id} ${eyes}`); checked++; }
  }
  for (let i = 0; i < 1000; i++) {
    // the face round's generators always wrote 'auto'
    assert.deepEqual(eye(early({...randomComposerRecipe(String(i)), eyes: 'auto'})), B.wild[i].eye, `wild ${i}`);
    assert.deepEqual(eye(early({...coherentComposerSpecies(String(i)).recipe, eyes: 'auto'})), B.coherent[i].eye, `coherent ${i}`);
    checked += 2;
  }
  assert.equal(checked, 420 + 28 + 12 * 7 + 2000);
  // the earlier rules keep the face round's 'auto' table exactly; a catalogue kind chosen explicitly is built as chosen
  assert.equal(composerAutoEyeType({...composerPreset('centipede'), legPairs: 4}, 1), 'compound');
  assert.equal(resolveComposerEyes(early({...composerPreset('giraffe'), eyes: 'owl'})).kind, 'owl');
});

test('eyeRules 2 (current): 0 of 12 presets change; every legacy change is one of the three new auto rules', () => {
  for (const [id, b] of Object.entries(B.presets)) {
    const p = composerPreset(id), e = resolveComposerEyes(p);
    assert.equal(p.eyeRules, 2, id);
    assert.deepEqual(eye(p), b.eye, `${id}: unchanged under the current rules`);
    assert.equal(e.kind, b.eye[0], `${id}: same kind`);
  }
  const changes = {};
  for (const [src, map] of [['legacy', B.legacy], ['skin3', B.skin3]]) for (const [text, b] of Object.entries(map)) {
    const {recipe, issues} = decode(text), e = resolveComposerEyes(recipe);
    assert.equal(recipe.eyeRules, 2, `${text}: an old link upgrades`);
    const changed = e.kind !== b.eye[0] || e.irisBuilt !== b.eye[1];
    assert.equal(issues.some(i => i.startsWith('Eyes: upgraded')), changed, `${text}: the upgrade is disclosed exactly when it changes the eyes`);
    if (!changed) { assert.deepEqual(eye(recipe), b.eye, text); continue; }
    const key = `${src} ${b.eye[0]}->${e.kind}`; changes[key] = (changes[key] ?? 0) + 1;
    // an upgrade refines the kind only: the iris colour, gaze and size stay the face round's (EC1 review: the rehashed
    // cat amber / crocodile grey-green read worse at normal size)
    assert.deepEqual(eye(recipe), b.eye, `${text}: an upgrade keeps the face round's iris, gaze and size`);
    if (e.kind === 'insect' || e.kind === 'spider') assert.equal(recipe.head, 'mandibles');
    if (e.kind === 'cat') assert.ok(recipe.head === 'muzzle' && recipe.bodyLength < 0.9, text);
    if (e.kind === 'crocodile') assert.ok(recipe.head === 'jaws' && recipe.layout === 'sprawled' && recipe.bodyLength >= 1, text);
  }
  assert.deepEqual(changes, {'legacy compound->insect': 42, 'legacy compound->spider': 1, 'legacy vertical-slit->cat': 4, 'legacy vertical-slit->crocodile': 5, 'skin3 compound->insect': 2});
  // the 28 skin-3 texts build byte-identical eyes (only metadata kind moves), so their skin pins hold
  for (const [text, b] of Object.entries(B.skin3)) assert.deepEqual(eye(decode(text).recipe), b.eye, text);
});

test('colorSeed never changes the kind, traits, stand-in, gaze or size; it only picks the iris band', () => {
  for (const id of COMPOSER_PRESET_IDS) for (const eyes of COMPOSER_EYE_TYPES) for (const eyeRules of [1, 2]) {
    const r = {...composerPreset(id), eyes, eyeRules}, ref = resolveComposerEyes(r), bands = composerIrisBands(r, composerIrisKind(r, ref.kind)), seen = new Set();
    for (let colorSeed = 0; colorSeed < 48; colorSeed++) {
      const e = resolveComposerEyes({...r, colorSeed});
      assert.deepEqual([e.kind, e.traits, e.built, e.gazeYawDeg, e.k], [ref.kind, ref.traits, ref.built, ref.gazeYawDeg, ref.k], `${id} ${eyes} ${eyeRules} ${colorSeed}`);
      if (bands.length) assert.ok(bands.includes(e.irisBuilt)); else assert.equal(e.irisBuilt, null);
      seen.add(e.irisBuilt);
    }
    if (bands.length > 1) assert.ok(seen.size > 1, `${id} ${eyes}: colorSeed reaches several bands`);
  }
});

test('species keys (herds) ignore eyes, iris and eye rules; frozen streams are byte-identical for 1000 wild + 1000 coherent seeds', () => {
  for (const map of [B.legacy, B.skin3]) for (const [text, b] of Object.entries(map)) assert.equal(composerSpeciesKey(decode(text).recipe), b.speciesKey, text);
  for (const [id, b] of Object.entries(B.presets)) {
    const p = composerPreset(id);
    for (const eyes of COMPOSER_EYE_TYPES) for (const eyeRules of [1, 2]) assert.equal(composerSpeciesKey({...p, eyes, eyeRules, iris: 'copper'}), b.speciesKey, `${id} ${eyes}`);
  }
  for (let i = 0; i < 1000; i++) {
    const w = randomComposerRecipe(String(i)), c = coherentComposerSpecies(String(i)), bw = B.wild[i], bc = B.coherent[i];
    assert.equal(v2digest(w), bw.v2, `wild ${i}: the 38 v2 fields`); assert.equal(composerSpeciesKey(w), bw.speciesKey, `wild ${i}`);
    assert.equal(v2digest(c.recipe), bc.v2, `coherent ${i}: the 38 v2 fields`); assert.equal(composerSpeciesKey(c.recipe), bc.speciesKey, `coherent ${i}`);
    assert.deepEqual([c.archetype, c.attempt], [bc.archetype, bc.attempt], `coherent ${i}: same archetype and attempt`);
    for (const r of [w, c.recipe]) { assert.equal(r.iris, 'auto'); assert.equal(r.eyeRules, 2); assert.ok(encodeComposerRecipe(r).length < 700); }
  }
  // the coherent generator draws one latent per v3 numeric key: eyeRules (appended) is never drawn
  assert.deepEqual([...COMPOSER_V3_RANGE_KEYS], Object.keys(COMPOSER_RANGES).filter(k => k !== 'eyeRules'));
  assert.deepEqual(Object.keys(COMPOSER_RANGES).at(-1), 'eyeRules');
});

test('wild generator: about 7.5 % of seeds get an unusual kind by a pure hash, never the kind auto would build', () => {
  assert.equal(COMPOSER_WILD_UNUSUAL_EYES_PER_MILLE, 75);
  const rate = seeds => { let n = 0; for (const s of seeds) if (randomComposerRecipe(s).eyes !== 'auto') n++; return n / seeds.length; };
  const baselineRate = rate(Array.from({length: 1000}, (_, i) => String(i)));
  assert.ok(baselineRate >= 0.05 && baselineRate <= 0.10, `seeds 0-999: ${baselineRate}`);
  assert.equal(baselineRate, 0.062);
  const kinds = new Set(); let unusual = 0;
  for (let i = 0; i < 8000; i++) {
    const seed = `wild-eyes-${i}`, r = randomComposerRecipe(seed);
    assert.equal(r.eyes, composerWildEyes(seed, r), 'the post-pass is a pure function of the seed and the anatomy');
    if (r.eyes === 'auto') continue;
    unusual++; kinds.add(r.eyes);
    assert.notEqual(r.eyes, composerAutoEyeType(r, 2), `${seed}: an unusual kind differs from the auto kind`);
    assert.deepEqual(composerFaceConstraints(r).filter(c => c.part === 'Eyes'), [], `${seed}: built as chosen`);
  }
  assert.ok(unusual / 8000 >= 0.065 && unusual / 8000 <= 0.085, `rate ${unusual / 8000}`);
  assert.equal(kinds.size, 18, 'the full catalogue is reachable');
});

test('coherent generator: eye flavour by a pure hash per archetype; ecology-plausible kinds only', () => {
  const allowed = {bird: ['raptor', 'owl'], theropod: ['raptor'], 'sprawler-lizard': ['gecko', 'chameleon', 'frog'], primate: ['nocturnal'], worm: ['stalk']};
  assert.deepEqual(Object.keys(COMPOSER_SPECIES_EYE_FLAVOUR).sort(), Object.keys(allowed).sort());
  const tally = {};
  for (let i = 0; i < 1000; i++) {
    const c = coherentComposerSpecies(String(i)), r = c.recipe, key = `${c.archetype}:${r.eyes}`;
    tally[key] = (tally[key] ?? 0) + 1;
    if (r.eyes === 'auto') continue;
    assert.ok(allowed[c.archetype]?.includes(r.eyes), `${i}: ${key}`);
    if (c.archetype === 'sprawler-lizard') assert.equal(r.head, 'jaws');
    if (r.eyes === 'frog') assert.ok(r.snoutLength < 0.6);
    assert.ok(composerEyeNative(r.eyes, r.head) || r.eyes === 'stalk', `${i}: ${r.eyes} is native on ${r.head}`);
  }
  // pinned tally (seeds 0-999): about one species in eight carries a named eye kind
  assert.deepEqual(Object.fromEntries(Object.entries(tally).filter(([k]) => !k.endsWith(':auto')).sort()),
    {'bird:owl': 11, 'bird:raptor': 16, 'primate:nocturnal': 21, 'sprawler-lizard:chameleon': 13, 'sprawler-lizard:frog': 1, 'sprawler-lizard:gecko': 35, 'theropod:raptor': 20, 'worm:stalk': 7});
  // a pure function of the stream name: same stream, same kind
  assert.equal(composerSpeciesEyeFlavour('composer-species-v1/7', 'bird', {head: 'beak', snoutLength: 0.4}), composerSpeciesEyeFlavour('composer-species-v1/7', 'bird', {head: 'beak', snoutLength: 0.4}));
  assert.equal(composerSpeciesEyeFlavour('x', 'giraffid', {head: 'muzzle', snoutLength: 0.4}), 'auto');
});

test('recipe v4: v1-v3 links upgrade to eyeRules 2 (disclosed when the eyes change), eyeRules 1 restores them, v5 is rejected', () => {
  assert.equal(COMPOSER_RECIPE_VERSION, 4);
  const worm = encodeComposerRecipe({...composerPreset('worm'), eyes: 'horizontal'}), v3 = worm.replace(/^v4\*/, 'v3*').replace(/\*eyeRules_2$/, '');
  const up = decode(v3);
  assert.equal(up.recipe.eyeRules, 2); assert.equal(resolveComposerEyes(up.recipe).kind, 'horizontal');
  assert.deepEqual(up.issues, [composerEyeUpgradeIssue(up.recipe)]);
  assert.match(up.issues[0], /^Eyes: upgraded to the current eye rules: horizontal \(amber\) eyes, where the earlier rules built eyespot\./);
  const restored = decode(encodeComposerRecipe({...up.recipe, eyeRules: 1}));
  assert.deepEqual(restored.issues, []); assert.equal(restored.recipe.eyeRules, 1);
  assert.deepEqual(eye(restored.recipe), eye(early(up.recipe)));
  assert.equal(resolveComposerEyes(restored.recipe).built, 'eyespot');
  assert.deepEqual(composerFaceConstraints(restored.recipe).map(c => c.part), ['Eyes'], 'the earlier rules disclose as they did');
  for (const bad of ['v5*layout_biped', 'v4.0*layout_biped', 'V4*layout_biped']) assert.match(decodeComposerRecipe(bad).error, /Unsupported/);
  assert.equal(composerEyeUpgradeIssue(composerPreset('giraffe')), null);
  // the object form: a version-3 object reads eyeRules 2 silently; an explicit eyeRules is bounded
  assert.equal(normalizeComposerRecipe({...composerPreset('ape'), version: 3, eyeRules: undefined}).recipe.eyeRules, 2);
  assert.deepEqual(normalizeComposerRecipe({...composerPreset('ape'), eyeRules: 9}).issues, ['eyeRules 9 limited to 2.']);
});

test('old links with an explicit OFF-FACE face-round kind: built as chosen on upgrade (geometry changes, disclosed), eyeRules 1 restores; eyespot stand-in keeps the face size', () => {
  // EC1 review 2026-10-03: the face round built an off-face explicit kind (Compound or Eyespots on a vertebrate face, a
  // camera kind on a worm or arthropod head) as the face's auto eye and disclosed it. Under the current rules the
  // owner's 'odd combinations are built when chosen' applies to old links too, so these links (and only these) build
  // different eye geometry after the upgrade. This set is absent from the legacy/skin-3 corpora, so it is pinned here.
  const tally = {};
  let checked = 0;
  for (const [id, b] of Object.entries(B.presets)) {
    const p = composerPreset(id);
    for (const [eyes, before] of Object.entries(b.explicit)) {
      if (eyes === 'auto') continue;
      const v3 = encodeComposerRecipe({...p, eyes}).replace(/^v4\*/, 'v3*').replace(/\*eyeRules_2$/, '');
      const {recipe, issues} = decode(v3), now = eye(recipe), offFace = before[4] !== null;
      assert.deepEqual(eye(early(recipe)), before, `${id} ${eyes}: eyeRules 1 restores the face round`);
      assert.equal(issues.some(i => i.startsWith('Eyes: upgraded')), offFace, `${id} ${eyes}: disclosed exactly when off-face`);
      checked++;
      if (!offFace) { assert.deepEqual(now, before, `${id} ${eyes}: an on-face explicit kind is unchanged`); continue; }
      assert.notDeepEqual(now, before, `${id} ${eyes}`);
      assert.equal(now[4], null, `${id} ${eyes}: built as chosen, no disclosure under the current rules`);
      const key = `${recipe.head}/${eyes}`; tally[key] = (tally[key] ?? 0) + 1;
      // the eyespot stand-in on a vertebrate face keeps the face round's seat and size (no 'specks'); only the pupil
      // shape (round) and the iris (none: a pigment eyespot) differ
      if (eyes === 'eyespot' && recipe.head !== 'mandibles') assert.deepEqual([now[0], now[1], now[2], now[3]], ['round', null, before[2], before[3]], `${id}: eyespot stand-in`);
    }
  }
  assert.equal(checked, 12 * 5);
  assert.deepEqual(tally, {'jaws/compound': 1, 'jaws/eyespot': 1, 'beak/compound': 4, 'beak/eyespot': 4, 'muzzle/compound': 2, 'muzzle/eyespot': 2,
    'flat-face/compound': 2, 'flat-face/eyespot': 2, 'blunt/round': 1, 'blunt/horizontal': 1, 'blunt/vertical-slit': 1, 'blunt/compound': 1,
    'mandibles/round': 1, 'mandibles/horizontal': 1, 'mandibles/vertical-slit': 1, 'mandibles/eyespot': 1, 'proboscis/compound': 1, 'proboscis/eyespot': 1});
  // the stand-in size follows the face profile on every non-worm face
  for (const id of ['giraffe', 'dinosaur', 'bird', 'ape', 'trunked-centipede', 'centipede']) {
    const r = {...composerPreset(id), eyes: 'eyespot'}, e = resolveComposerEyes(r);
    assert.equal(e.built, 'round', id); assert.ok(e.k >= 0.07, `${id}: k ${e.k}`);
  }
});

test('odd combinations are built: every kind on every face, 0 eye fallbacks, no disclosure under the current rules', () => {
  const bodies = ['giraffe', 'dinosaur', 'bird', 'ape', 'worm', 'centipede', 'trunked-centipede', 'turtle'].map(composerPreset);
  assert.deepEqual([...new Set(bodies.map(b => b.head))].sort(), [...COMPOSER_FACES].sort());
  let builds = 0;
  for (const body of bodies) for (const eyes of COMPOSER_EYE_KINDS) {
    const r = {...body, eyes}, e = resolveComposerEyes(r);
    assert.equal(e.kind, eyes); assert.equal(e.effect, null);
    assert.deepEqual(composerFaceConstraints(r).filter(c => c.part === 'Eyes'), []);
    if (e.built !== 'compound' && e.built !== 'eyespot') assert.ok(e.k > 0, `${body.head}/${eyes}: a lidded stand-in has a size`);
    const skin = buildComposerSkin(buildComposerGraph(r), {debug: true});
    assert.equal(skin.eyeFallbacks, 0, `${body.head}/${eyes}: seated on the head`);
    // EC2 (fauna-composer-eye-2) builds the kind itself: spiders 8 eyes, insects 2 compound eyes + 3 ocelli
    assert.equal(skin.debug.eyes.length, eyes === 'spider' ? 8 : eyes === 'insect' ? 5 : 2, `${body.head}/${eyes}: eye count`);
    builds++;
  }
  assert.equal(builds, 8 * 18);
  // the appended profiles size a camera eye on an arthropod or worm head
  assert.equal(resolveComposerEyes({...composerPreset('centipede'), eyes: 'owl'}).k, FACE_EYE_PROFILE['mandibles-camera'].k);
  assert.equal(resolveComposerEyes({...composerPreset('worm'), eyes: 'cat'}).k, FACE_EYE_PROFILE['blunt-camera'].k);
});
