// Recipe v2/v3, individual variation and the coherent species generator (WP2; face round WP1).
// The v1 fixture was captured at commit 1ec5072 (before v2) and is the compatibility oracle.
// Recipe v3 (fauna-composer-face-1) migrates v1/v2 trunks into the face: muzzle + trunk becomes 'proboscis',
// a trunk on any other face is removed; both are reported as issues.
// Recipe v4 (eye catalogue EC1, fauna-composer-face-2) appends one key, eyeRules; v1-v3 text reads eyeRules 2 (the
// current eye rules) and says so with an 'Eyes: upgraded ...' issue when that changes the eyes it built.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  COMPOSER_PRESET_IDS, COMPOSER_RANGES, COMPOSER_RECIPE_KEYS, COMPOSER_RECIPE_VERSION, COMPOSER_SPECIES_KEYS, COMPOSER_V1_KEYS, COMPOSER_V2_DEFAULTS, COMPOSER_V2_KEYS, COMPOSER_V3_DEFAULTS,
  COMPOSER_V3_KEYS, COMPOSER_V4_DEFAULTS, composerWildEyes, composerConstraints, composerLegacyPresetId, composerPreset, composerRecipesEqual, composerSpeciesEqual, decodeComposerRecipe, drawComposerRandomV1, encodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe,
} from '../src/fauna-composer-recipe.ts';
import {composerHeadgearBuild} from '../src/fauna-composer-face.ts';
import {COMPOSER_BUDGET, buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {composerIndividualTraits, composerSpeciesKey, deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {COMPOSER_ARCHETYPES, coherentComposerSpecies, composerStaticBalance, randomCoherentComposerRecipe} from '../src/fauna-composer-species.ts';
import {COAT_PALETTE_IDS, LEGACY_PALETTE_IDS} from '../src/fauna-coat-vocab.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/composer-v1-links.json', import.meta.url), 'utf8'));
const allEntries = [...fixture.presets, ...fixture.fixtureSeeds, ...fixture.extremes, ...fixture.wild];
const digest = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const v1Values = recipe => fixture.keys.map(key => recipe[key]);
// a (migrated) v1 text's preset: the redesigned hybrids still match their legacy v1 values
const presetOf = recipe => composerLegacyPresetId(recipe);
const v2Only = COMPOSER_RECIPE_KEYS.filter(key => !COMPOSER_V1_KEYS.includes(key));
const LATER_DEFAULTS = {...COMPOSER_V2_DEFAULTS, ...COMPOSER_V3_DEFAULTS, ...COMPOSER_V4_DEFAULTS};
const EYE_UPGRADE = /^Eyes: upgraded to the current eye rules: [a-z-]+( \([a-z-]+\))? eyes, where the earlier rules built [a-z-]+( \([a-z-]+\))?\. Eye rules -> Earlier restores them\.$/;
/** The 26 v1 values a v1 text has after the v3 face migration. */
const migratedV1 = values => { const r = Object.fromEntries(fixture.keys.map((k, i) => [k, values[i]])); if (r.trunk === 'trunk') { if (r.head === 'muzzle') r.head = 'proboscis'; else r.trunk = 'none'; } return fixture.keys.map(k => r[k]); };
const MIGRATION_ISSUE = /^Trunk: (now a face type; this muzzle became Face = Proboscis\.|removed\. A trunk is a nose and only grows on a mammal muzzle; this [a-z-]+ face is kept\. Choose Face -> Proboscis for a trunk\.)$/;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const cv = xs => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) / m; };
const pearson = (a, b) => { const ma = mean(a), mb = mean(b); let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; } return ab / Math.sqrt(aa * bb); };
const withoutAllometry = traits => { const {allometry, ...rest} = traits; return rest; };

test('fixture: the key list is the frozen v1 order and v2, then v3 keys, then the v4 key are appended', () => {
  assert.deepEqual([...COMPOSER_V1_KEYS], fixture.keys);
  assert.deepEqual(COMPOSER_RECIPE_KEYS.slice(0, 26), fixture.keys);
  assert.deepEqual([...COMPOSER_V2_KEYS], [...fixture.keys, 'pattern', 'marks', 'patternScale', 'patternContrast', 'countershade', 'dimorphism', 'variability', 'allometry', 'individualSeed', 'sex', 'maturity', 'condition']);
  assert.ok(Object.isFrozen(COMPOSER_V2_KEYS));
  assert.deepEqual([...COMPOSER_V3_KEYS], [...COMPOSER_V2_KEYS, 'eyes', 'iris']);
  assert.ok(Object.isFrozen(COMPOSER_V3_KEYS));
  assert.deepEqual([...COMPOSER_RECIPE_KEYS], [...COMPOSER_V3_KEYS, 'eyeRules']);
  assert.equal(COMPOSER_RECIPE_VERSION, 4);
  assert.deepEqual(COAT_PALETTE_IDS.slice(0, 6), [...LEGACY_PALETTE_IDS]);
  assert.equal(allEntries.length, 12 + 128 + 27 + 256);
});

test('every v1 fixture text decodes with no error, only face-migration and eye-upgrade issues, and keeps all 26 v1 values (face-migrated)', () => {
  let presets = 0, others = 0, migrated = 0, upgraded = 0;
  for (const entry of allEntries) {
    const {recipe, issues: all, error} = decodeComposerRecipe(entry.text);
    assert.equal(error, null, entry.text);
    const issues = all.filter(issue => !EYE_UPGRADE.test(issue));
    upgraded += all.length - issues.length;
    assert.ok(all.length - issues.length <= 1 && (all.length === issues.length || EYE_UPGRADE.test(all.at(-1))), `${entry.text}: one eye-upgrade issue, last`);
    for (const issue of issues) assert.match(issue, MIGRATION_ISSUE, entry.text);
    assert.equal(issues.length, entry.values[fixture.keys.indexOf('trunk')] === 'trunk' ? 1 : 0, entry.text);
    migrated += issues.length;
    assert.deepEqual(v1Values(recipe), migratedV1(entry.values), entry.text);
    assert.equal(recipe.version, 4); assert.equal(recipe.eyeRules, 2, `${entry.text}: an old link upgrades to the current eye rules`);
    const id = presetOf(recipe);
    if (id) {
      // a v1 preset link names the preset: it adopts the preset's later species values and keeps its own v1 choices
      presets++;
      for (const key of COMPOSER_SPECIES_KEYS) if (!COMPOSER_V1_KEYS.includes(key)) assert.equal(recipe[key], composerPreset(id)[key], `${entry.text} -> ${id}: ${key}`);
      // the redesigned hybrids keep the legacy horn (disclosed); every other preset link is the preset itself
      if (['shelled-giraffe-bird', 'trunked-centipede', 'winged-ape-rhino'].includes(id)) {
        assert.equal(composerRecipesEqual(recipe, {...composerPreset(id), horns: recipe.horns}), true, `${entry.text} -> ${id} (legacy horn kept)`);
        assert.notEqual(recipe.horns, composerPreset(id).horns);
        assert.ok(composerConstraints(recipe).some(c => c.part === 'Horns' && c.chosen === recipe.horns), `${id}: legacy horn disclosed`);
      } else {
        assert.ok(composerSpeciesEqual(recipe, composerPreset(id)), `${entry.text} -> ${id}`);
        assert.ok(composerRecipesEqual(recipe, composerPreset(id)), `${entry.text} -> ${id} (individual keys neutral)`);
      }
    } else {
      others++;
      for (const key of v2Only) assert.equal(recipe[key], LATER_DEFAULTS[key], `${entry.text}: ${key} default`);
      const derived = deriveComposerIndividual(recipe);
      assert.equal(derived.traits.neutral, true, entry.text);
      assert.deepEqual(derived.recipe, recipe, entry.text);
      assert.deepEqual(derived.deltas, []);
    }
  }
  assert.ok(presets >= 12 && others > 300, `presets ${presets}, others ${others}`);
  assert.ok(migrated > 0); assert.ok(upgraded > 0, 'some old links build different eyes under the current rules, and say so');
});

// The v1 head-skin digests (captured at 1ec5072) are frozen history: skin-2
// (WP3) and graph-2 (WP4) change every legacy skin by design, which is the
// documented drift for old links. composer-skin2-links.json keeps the skin-2 pins
// (and the face round's 13 face-rule repins) as history; composer-skin3-links.json
// pins the skin-3 build of the same 28 migrated texts. Skin-3 (fauna-composer-eye-1,
// face round WP4) rebuilt the eyes of every face, so all 28 entries drift from their
// skin-2 pin with driftFromSkin2 = 'fauna-composer-eye-1: eyes rebuilt'; the 13 that
// the face rules repinned keep that reason as faceDrift. Bone counts must still equal
// v1 (no new bones), except that a trunk dropped by the face rules removes 6 bones.
// Eye round EC2 (fauna-composer-eye-2, skin-4) rebuilt the eyes under the current eye rules; the face round's build is
// kept as the earlier eye rules (eyeRules 1), so the skin-3 pins are now checked with eyeRules 1: they must still hold
// byte for byte. The current-rules build of the same texts is pinned in composer-skin4-links.json.
// Eye round EC4 (head polish, graph-4 / face-geometry-2) repinned the drifted entries in place (ec4Drift, skinPreEC4):
// trunk and arm fixes are not eye rules, so they apply under eyeRules 1 too.
const skin2 = JSON.parse(readFileSync(new URL('./fixtures/composer-skin2-links.json', import.meta.url), 'utf8'));
const skin3 = JSON.parse(readFileSync(new URL('./fixtures/composer-skin3-links.json', import.meta.url), 'utf8'));
test('legacy recipes: migrated neutral v1 texts with the earlier eye rules build the pinned skin-3 digest byte for byte, with v1 bone counts', () => {
  let checked = 0, faceRepinned = 0, ec4Repinned = 0;
  assert.deepEqual(Object.keys(skin3.byText).sort(), Object.keys(fixture.headSkinDigests.byText).sort());
  assert.equal(skin3.capturedAt.skin, 'fauna-composer-skin-3');
  for (const [text, v1] of Object.entries(fixture.headSkinDigests.byText)) {
    const pinned = skin3.byText[text], previous = skin2.byText[text];
    const decoded = decodeComposerRecipe(text).recipe;
    // a non-preset v1 text is neutral already; a preset text is checked with its v1 fields only (v2 keys neutral)
    const neutral = presetOf(decoded) ? {...decoded, ...COMPOSER_V2_DEFAULTS} : decoded;
    const dropped = decodeComposerRecipe(text).issues.some(issue => issue.startsWith('Trunk: removed'));
    // every skin-2 pin drifted for one documented reason: the eyes were rebuilt
    assert.equal(pinned.driftFromSkin2, 'fauna-composer-eye-1: eyes rebuilt', text);
    assert.equal(pinned.skin2, previous.skin, `${text}: the skin-2 pin it replaces`);
    assert.notEqual(pinned.skin, previous.skin, `${text}: a repin must differ from the pin it replaces`);
    assert.equal(pinned.faceDrift ?? null, previous.driftFromV2 ?? null, `${text}: the face-rule reason is carried over`);
    if (pinned.faceDrift) {
      faceRepinned++;
      // a face repin is explained: a horn the face does not build, or a dropped trunk
      const hornChanged = composerHeadgearBuild(decoded).built !== decoded.horns;
      assert.equal(pinned.faceDrift, dropped ? 'fauna-composer-face-1: trunk dropped' : 'fauna-composer-face-1: horn not built on face', text);
      assert.ok(dropped || hornChanged, `${text}: repin without a face-rule cause`);
    }
    const derived = deriveComposerIndividual({...neutral, eyeRules: 1});
    assert.equal(derived.traits.neutral, true, text);
    // eye round EC4 (head polish; not an eye rule, so under both epochs) repinned in place the proboscis entries and
    // those whose arms sit on a long axial body
    if (pinned.ec4Drift) {
      ec4Repinned++;
      assert.notEqual(pinned.skinPreEC4, pinned.skin, `${text}: an EC4 repin must differ from the pin it replaces`);
      const r = derived.recipe, axialArms = (r.layout === 'limbless' || r.layout === 'many-legged') && r.arms !== 'none';
      assert.ok(r.head === 'proboscis' || axialArms, `${text}: an EC4 repin without an EC4 cause`);
      assert.equal(pinned.ec4Drift.includes('proboscis head polish'), r.head === 'proboscis', text);
      assert.equal(pinned.ec4Drift.includes('arms of a limbless or many-legged body'), axialArms, text);
    }
    const graph = buildComposerGraph(derived.recipe), skin = buildComposerSkin(graph);
    assert.equal(digest(skin.positions, skin.index, skin.skinIndex, skin.skinWeight, skin.colors), pinned.skin, text);
    assert.equal(digest(skin.gloss), pinned.gloss, `${text}: gloss`);
    assert.deepEqual([skin.vertexCount, skin.triangleCount, graph.bones.length], [pinned.vertices, pinned.triangles, pinned.bones], text);
    assert.equal(graph.bones.length, v1.bones - (dropped ? 6 : 0), `${text}: graph-2 adds no bones; a dropped trunk removes 6`);
    checked++;
  }
  assert.equal(checked, 28);
  assert.equal(faceRepinned, 13);
  assert.equal(ec4Repinned, skin3.repinnedAtEC4.changed);
  // and through the public creature factory
  const text = fixture.fixtureSeeds[3].text, c = createComposerCreature({...decodeComposerRecipe(text).recipe, eyeRules: 1});
  try { assert.equal(digest(c.skin.positions, c.skin.index, c.skin.skinIndex, c.skin.skinWeight, c.skin.colors), skin3.byText[text].skin); assert.deepEqual(c.individual.deltas, []); }
  finally { c.dispose(); }
});

test('versions: v1, v2, v3 and v4 decode, every other version is rejected', () => {
  for (const text of ['v5*layout_biped', 'v999*layout_biped', 'v4.1*layout_biped', 'V4*layout_biped', 'v0*layout_biped', 'v3.1*layout_biped', 'V3*layout_biped', 'v2.1*layout_biped', 'V2*layout_biped']) {
    const result = decodeComposerRecipe(text);
    assert.equal(result.recipe, null, text);
    assert.match(result.error, /Unsupported/, text);
  }
  assert.equal(decodeComposerRecipe('v1*layout_biped').error, null);
  assert.equal(decodeComposerRecipe('v2*layout_biped').error, null);
  assert.equal(decodeComposerRecipe('v3*layout_biped').error, null);
  assert.equal(decodeComposerRecipe('v4*layout_biped').error, null);
  // a v3 text does not know the v4 key: an old link cannot pin itself to the earlier eye rules
  const v3 = decodeComposerRecipe('v3*layout_biped*eyeRules_1');
  assert.equal(v3.recipe.eyeRules, 2); assert.match(v3.issues[0], /unknown recipe field "eyeRules"/);
  assert.equal(decodeComposerRecipe('v4*layout_biped*eyeRules_1').recipe.eyeRules, 1);
  // a v2 text does not know the v3 keys
  const v2 = decodeComposerRecipe('v2*layout_biped*eyes_round');
  assert.equal(v2.recipe.eyes, 'auto');
  assert.match(v2.issues[0], /unknown recipe field "eyes"/);
  assert.equal(decodeComposerRecipe('v3*layout_biped*eyes_round').recipe.eyes, 'round');
  // a v1 text does not know the v2 keys: they are reported and ignored
  const v1 = decodeComposerRecipe('v1*layout_biped*maturity_0.3');
  assert.equal(v1.recipe.maturity, 1);
  assert.equal(v1.issues.length, 1);
  assert.match(v1.issues[0], /unknown recipe field "maturity"/);
  assert.equal(decodeComposerRecipe('v2*layout_biped*maturity_0.3').recipe.maturity, 0.3);
  assert.ok(encodeComposerRecipe(composerPreset('giraffe')).startsWith('v4*'));
});

test('v4 round trips: presets, 256 coherent species, 128 wild hybrids and range extremes (max length reported)', () => {
  const corpus = [...COMPOSER_PRESET_IDS.map(composerPreset)];
  for (let i = 0; i < 256; i++) corpus.push({...randomCoherentComposerRecipe(String(i)), individualSeed: i * 37 % 10000, sex: ['auto', 'female', 'male'][i % 3], maturity: 0.2 + (i % 81) / 100, condition: ((i % 41) - 20) / 20});
  for (let i = 0; i < 128; i++) corpus.push({...randomComposerRecipe(String(i)), pattern: 'brindle', marks: i * 2 % 256});
  for (const [key, [min, max]] of Object.entries(COMPOSER_RANGES)) for (const value of [min, max]) corpus.push({...composerPreset('trunked-centipede'), [key]: value});
  for (const end of [0, 1]) { const r = {...composerPreset('winged-ape-rhino')}; for (const [key, range] of Object.entries(COMPOSER_RANGES)) r[key] = range[end]; corpus.push(r); }
  let maxLength = 0, longest = '';
  for (const input of corpus) {
    const recipe = normalizeComposerRecipe(input).recipe, text = encodeComposerRecipe(recipe), back = decodeComposerRecipe(text);
    assert.equal(back.error, null, text);
    assert.deepEqual(back.issues, [], text);
    assert.deepEqual(back.recipe, recipe, text);
    assert.ok(composerRecipesEqual(back.recipe, recipe));
    // and through actual URL form encoding
    const url = new URLSearchParams({composer: text}).toString();
    assert.deepEqual(decodeComposerRecipe(new URLSearchParams(url).get('composer')).recipe, recipe);
    if (text.length > maxLength) { maxLength = text.length; longest = text; }
  }
  assert.ok(maxLength < 700, `max encoded length ${maxLength}: ${longest}`);
  console.log(`# max v4 encoded length ${maxLength} (limit 700; COMPOSER_RECIPE_MAX_TEXT 1200)`);
});

test('wild stream: drawComposerRandomV1(String(i)) keeps the HEAD v1 fields for i = 0..255; randomComposerRecipe only applies the face rules', () => {
  assert.equal(fixture.wild.length, 256);
  for (const entry of fixture.wild) {
    const draw = drawComposerRandomV1(entry.seed), recipe = randomComposerRecipe(entry.seed);
    assert.deepEqual(v1Values(draw), entry.values, entry.seed);
    for (const key of v2Only) assert.equal(draw[key], LATER_DEFAULTS[key]);
    assert.ok(LEGACY_PALETTE_IDS.includes(recipe.palette));
    // the post-pass: trunk -> face, horns -> the built kind, iris auto, eyes auto or the rare hashed kind; nothing else moves
    const expected = {...draw};
    if (expected.trunk === 'trunk') { if (expected.head === 'muzzle') expected.head = 'proboscis'; else expected.trunk = 'none'; }
    expected.horns = composerHeadgearBuild(expected).built;
    expected.eyes = composerWildEyes(entry.seed, expected);
    assert.deepEqual(recipe, expected, entry.seed);
  }
});

test('species vs individual equality', () => {
  const a = composerPreset('ape'), b = {...a, individualSeed: 3, sex: 'male', maturity: 0.5, condition: 0.4};
  assert.ok(composerSpeciesEqual(a, b));
  assert.equal(composerRecipesEqual(a, b), false);
  for (const key of COMPOSER_SPECIES_KEYS) { const c = {...a}; c[key] = typeof a[key] === 'number' ? a[key] + 1 : 'other'; assert.equal(composerSpeciesEqual(a, c), false, key); }
});

test('herds of 24 per preset: natural size spread, all distinct, within budget, stable traits', () => {
  for (const id of COMPOSER_PRESET_IDS) {
    const species = composerPreset(id), lengths = [], texts = new Set();
    for (let seed = 1; seed <= 24; seed++) {
      const recipe = {...species, individualSeed: seed, maturity: 1};
      const derived = deriveComposerIndividual(recipe);
      lengths.push(derived.recipe.bodyLength);
      texts.add(encodeComposerRecipe(derived.recipe));
      // traits from the species recipe and from the effective recipe agree; allometry follows the actual body length
      const fromSpecies = composerIndividualTraits(recipe), fromEffective = composerIndividualTraits(derived.recipe);
      assert.deepEqual(withoutAllometry(fromSpecies), withoutAllometry(fromEffective), `${id}/${seed}`);
      assert.deepEqual(derived.traits, fromEffective);
      const L = Math.round(derived.recipe.bodyLength * 1000) / 1000;
      assert.ok(Math.abs(fromEffective.allometry.headRel - L ** (-0.12 * species.allometry)) < 1e-8, `${id}/${seed} allometry at actual length`);
      assert.equal(composerSpeciesKey(recipe), composerSpeciesKey(derived.recipe));
      // derived values are on the recipe grid, so the rig's own normalisation is the identity
      assert.deepEqual(normalizeComposerRecipe(derived.recipe).recipe, derived.recipe);
      assert.deepEqual(normalizeComposerRecipe(derived.recipe).issues, []);
      const c = createComposerCreature(recipe);
      try {
        const d = c.details();
        assert.ok(d.withinBudget && d.vertices <= COMPOSER_BUDGET.maxVertices && d.triangles <= COMPOSER_BUDGET.maxTriangles && d.bones <= COMPOSER_BUDGET.maxBones, `${id}/${seed} budget`);
        assert.deepEqual(c.individual.effectiveRecipe, derived.recipe);
      } finally { c.dispose(); }
    }
    const spread = cv(lengths);
    assert.ok(spread >= 0.025 && spread <= 0.07, `${id}: bodyLength CV ${spread.toFixed(4)}`);
    assert.equal(texts.size, 24, `${id}: no two effective recipes equal`);
  }
});

test('the type specimen and variability 0 are exact; deltas list every change and every clamp', () => {
  const v1 = {...composerPreset('giraffe'), ...COMPOSER_V2_DEFAULTS};
  assert.deepEqual(deriveComposerIndividual(v1), {recipe: v1, traits: composerIndividualTraits(v1), deltas: []});
  // variability 0: every seed of one sex is the same animal
  const clones = [1, 2, 3].map(seed => deriveComposerIndividual({...composerPreset('rhinoceros'), variability: 0, sex: 'female', individualSeed: seed}).recipe);
  assert.deepEqual({...clones[0], individualSeed: 0}, {...clones[1], individualSeed: 0});
  assert.deepEqual({...clones[0], individualSeed: 0}, {...clones[2], individualSeed: 0});
  // every changed field has a delta line
  const species = composerPreset('ostrich'), derived = deriveComposerIndividual({...species, individualSeed: 9, maturity: 0.4, condition: 0.6});
  const changed = COMPOSER_RECIPE_KEYS.filter(key => derived.recipe[key] !== {...species, individualSeed: 9, maturity: 0.4, condition: 0.6}[key]);
  assert.ok(changed.length >= 4);
  assert.equal(derived.deltas.filter(line => !/limited to/.test(line)).length, changed.length);
  // a clamp is reported, never silent
  const clamped = deriveComposerIndividual({...composerPreset('dinosaur'), maturity: 0.2});
  assert.ok(clamped.deltas.some(line => /^Head size limited to 1\.60 \(range maximum/.test(line)), clamped.deltas.join('\n'));
  // explicit sex is honoured even without dimorphism; 'auto' at seed 0 is 'none'
  assert.equal(composerIndividualTraits({...composerPreset('worm'), sex: 'male', individualSeed: 2}).sex, 'male');
  assert.equal(composerIndividualTraits({...composerPreset('worm'), individualSeed: 2}).sex, 'none');
  assert.equal(composerIndividualTraits(composerPreset('ape')).sex, 'none');
  // colour keys never reach the individual stream
  const t = composerIndividualTraits({...composerPreset('ape'), individualSeed: 4});
  assert.deepEqual(withoutAllometry(composerIndividualTraits({...composerPreset('ape'), individualSeed: 4, palette: 'olive', colorSeed: 3, pattern: 'roan', countershade: 0.1})), withoutAllometry(t));
});

test('sex at dimorphism 0.8: males carry much larger horns and longer bodies', () => {
  for (const id of ['giraffe', 'rhinoceros', 'ostrich', 'ape']) {
    const species = {...composerPreset(id), dimorphism: 0.8}, males = [], females = [];
    for (let seed = 1; seed <= 48; seed++) { males.push(deriveComposerIndividual({...species, individualSeed: seed, sex: 'male'})); females.push(deriveComposerIndividual({...species, individualSeed: seed, sex: 'female'})); }
    const horn = mean(males.map(d => d.traits.hornScale)) / mean(females.map(d => d.traits.hornScale));
    const length = mean(males.map(d => d.recipe.bodyLength)) / mean(females.map(d => d.recipe.bodyLength));
    assert.ok(horn >= 2.0, `${id}: horn ratio ${horn.toFixed(3)}`);
    assert.ok(length >= 1.06, `${id}: length ratio ${length.toFixed(3)}`);
  }
  // 'auto' sex is close to 1:1
  let m = 0; for (let seed = 1; seed <= 1000; seed++) if (composerIndividualTraits({...composerPreset('giraffe'), individualSeed: seed}).sex === 'male') m++;
  assert.ok(m > 440 && m < 560, `males ${m}/1000`);
});

test('maturity 0.3 giraffe: big head, short snout, no horns yet', () => {
  const adult = deriveComposerIndividual(composerPreset('giraffe')), calf = deriveComposerIndividual({...composerPreset('giraffe'), maturity: 0.3});
  const head = (calf.recipe.headSize / calf.recipe.bodyLength) / (adult.recipe.headSize / adult.recipe.bodyLength);
  assert.ok(head >= 1.25, `head/body ${head.toFixed(3)}`);
  assert.ok(calf.recipe.snoutLength / adult.recipe.snoutLength <= 0.85, `snout ${calf.recipe.snoutLength}/${adult.recipe.snoutLength}`);
  assert.ok(calf.traits.hornScale <= 0.1, `horn ${calf.traits.hornScale}`);
  assert.ok(calf.recipe.bodyLength < adult.recipe.bodyLength && calf.traits.eyeScale > adult.traits.eyeScale && calf.traits.earScale > adult.traits.earScale);
  // growth is monotonic in maturity for the same individual
  let last = 0; for (const m of [0.2, 0.4, 0.6, 0.8, 1]) { const L = deriveComposerIndividual({...composerPreset('giraffe'), individualSeed: 3, maturity: m}).recipe.bodyLength; assert.ok(L > last); last = L; }
});

test('coherent species generator over 300 seeds: compatible, balanced, diverse, correlated and deterministic', () => {
  let triggered = 0, balanced = 0; const layouts = new Set(), archetypes = new Set(), neck = [], leg = [];
  for (let i = 0; i < 300; i++) {
    const s = coherentComposerSpecies(String(i));
    if (composerConstraints(s.recipe).length) triggered++;
    if (s.balance.pass) balanced++;
    layouts.add(s.recipe.layout); archetypes.add(s.archetype);
    if (s.recipe.layout !== 'limbless') { neck.push(s.recipe.neckLength); leg.push(s.recipe.legLength); }
    assert.equal(COMPOSER_PRESET_IDS.some(id => composerSpeciesEqual(composerPreset(id), s.recipe)), false, `seed ${i} collides with a preset`);
    assert.deepEqual(normalizeComposerRecipe(s.recipe).issues, []);
    assert.equal(s.recipe.variability, 1); assert.equal(s.recipe.allometry, 1); assert.equal(s.recipe.individualSeed, 0);
    if (i < 40) assert.deepEqual(randomCoherentComposerRecipe(String(i)), s.recipe, `seed ${i} deterministic`);
    // the balance report is recomputable from the built rig
    if (i < 20) assert.deepEqual(composerStaticBalance(buildComposerGraph(s.recipe)), s.balance);
  }
  const r = pearson(neck, leg);
  console.log(`# coherent: ${triggered}/300 trigger constraints, ${balanced}/300 balanced, corr(neck, leg) ${r.toFixed(3)}, layouts ${[...layouts].join(',')}`);
  assert.ok(triggered <= 75, `${triggered}/300 trigger a constraint`);
  assert.ok(balanced >= 285, `${balanced}/300 balanced`);
  assert.equal(layouts.size, 5);
  assert.equal(archetypes.size, COMPOSER_ARCHETYPES.length);
  assert.ok(r >= 0.3, `corr ${r}`);
});

test('static balance check has teeth: a head-heavy biped fails, its preset quadruped passes', () => {
  assert.equal(composerStaticBalance(buildComposerGraph(composerPreset('giraffe'))).pass, true);
  const toppling = {...composerPreset('ostrich'), posture: 0, headSize: 1.6, neckLength: 1.5, tailLength: 0.2};
  const b = composerStaticBalance(buildComposerGraph(normalizeComposerRecipe(toppling).recipe));
  assert.equal(b.pass, false);
  assert.ok(b.distance > b.tolerance);
  assert.equal(composerStaticBalance(buildComposerGraph(composerPreset('worm'))).pass, true);
});
