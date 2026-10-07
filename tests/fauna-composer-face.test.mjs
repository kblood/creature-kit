// Face contract (fauna-composer-face-1, recipe v3; face round WP1), as amended by the eye catalogue (EC1:
// fauna-composer-face-2, recipe v4, eyeRules). The oracle for "nothing else moved" is tests/fixtures/composer-baseline-v2.json,
// captured from the unmodified v2 composer at a9e3654 before any face-round edit (never regenerate it). The face round's
// eye rules stay testable as eyeRules 1; tests/fauna-composer-eye-catalogue.test.mjs pins both epochs against
// tests/fixtures/composer-baseline-v3.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  COMPOSER_EYE_TYPES, COMPOSER_FACES, COMPOSER_FACE_VERSION, COMPOSER_HORNS, COMPOSER_IRIS, COMPOSER_IRIS_RGB, FACE_EYES, FACE_EYE_PROFILE, FACE_HEADGEAR,
  composerAnatomyProjection, composerHeadgearBuild, composerIrisBands, composerSkullOf, faceHash, migrateLegacyFace, resolveComposerEyes,
} from '../src/fauna-composer-face.ts';
import {
  COMPOSER_CHOICES, COMPOSER_PRESET_IDS, COMPOSER_V2_KEYS, composerConstraints, composerHash, composerLegacyPresetId, composerPreset,
  decodeComposerRecipe, drawComposerRandomV1, encodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe,
} from '../src/fauna-composer-recipe.ts';
import {coherentComposerSpecies} from '../src/fauna-composer-species.ts';
import {composerSpeciesKey} from '../src/fauna-composer-individual.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/composer-baseline-v2.json', import.meta.url), 'utf8'));
const v1Links = JSON.parse(readFileSync(new URL('./fixtures/composer-v1-links.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/fauna-composer-face.ts', import.meta.url), 'utf8');
/** The raw key -> value strings of an encoded recipe text. */
const fields = text => Object.fromEntries(text.split('*').slice(1).map(pair => { const i = pair.indexOf('_'); return [pair.slice(0, i), pair.slice(i + 1)]; }));
const UPGRADED = /^Eyes: upgraded to the current eye rules: /;
const notEyeUpgrade = issues => issues.filter(i => !UPGRADED.test(i));
const faceOnly = r => composerConstraints(r).filter(c => ['Horns', 'Eyes', 'Iris colour'].includes(c.part));
const REDESIGNED = ['shelled-giraffe-bird', 'trunked-centipede', 'winged-ape-rhino'];
const REMOVED = /^Trunk: removed\. A trunk is a nose and only grows on a mammal muzzle; this ([a-z-]+) face is kept\. Choose Face -> Proboscis for a trunk\.$/;
const PROMOTED = 'Trunk: now a face type; this muzzle became Face = Proboscis.';

test('source scan: the face module is pure (no rendering library, no Math.random, no Date) and versioned', () => {
  assert.equal(COMPOSER_FACE_VERSION, 'fauna-composer-face-2');
  for (const banned of ['three', 'Math.random', 'Date']) assert.ok(!source.includes(banned), `fauna-composer-face.ts contains '${banned}'`);
  // its only runtime import is the pure, import-free eye catalogue
  const imports = [...source.replace(/^import type .*$/gm, '').matchAll(/^\s*import\s[\s\S]*?from\s+'([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(imports, ['./fauna-composer-eye-catalogue.ts']);
});

test('vocabularies: faces, horns, eyes and iris match the recipe choices', () => {
  assert.deepEqual([...COMPOSER_CHOICES.head], [...COMPOSER_FACES]);
  assert.equal(COMPOSER_FACES.at(-1), 'proboscis');
  assert.deepEqual([...COMPOSER_CHOICES.horns], [...COMPOSER_HORNS]);
  assert.deepEqual([...COMPOSER_CHOICES.eyes], ['auto', 'round', 'horizontal', 'vertical-slit', 'compound', 'eyespot',
    'raptor', 'owl', 'cat', 'gecko', 'frog', 'chameleon', 'crocodile', 'sclera', 'nocturnal', 'cephalopod', 'insect', 'spider', 'stalk']);
  assert.deepEqual([...COMPOSER_EYE_TYPES], [...COMPOSER_CHOICES.eyes]);
  assert.deepEqual([...COMPOSER_CHOICES.iris], ['auto', 'dark-brown', 'brown', 'amber', 'gold', 'yellow', 'orange', 'red', 'green', 'pale', 'blue', 'copper', 'grey-green']);
  assert.deepEqual([...COMPOSER_IRIS], [...COMPOSER_CHOICES.iris]);
  assert.deepEqual(Object.keys(COMPOSER_IRIS_RGB), COMPOSER_IRIS.slice(1));
  for (const rgb of Object.values(COMPOSER_IRIS_RGB)) for (const c of rgb) assert.ok(c >= 0 && c <= 1);
  assert.deepEqual(COMPOSER_FACES.map(composerSkullOf), ['muzzle', 'jaws', 'beak', 'flat-face', 'blunt', 'mandibles', 'muzzle']);
  assert.deepEqual(composerAnatomyProjection({head: 'proboscis', horns: 'paired'}), {head: 'muzzle', horns: 'paired'});
  const jaws = {head: 'jaws'};
  assert.equal(composerAnatomyProjection(jaws), jaws);
  assert.deepEqual(FACE_EYES.mandibles, ['compound']);
  assert.deepEqual(FACE_EYES.blunt, ['eyespot']);
  for (const face of ['muzzle', 'proboscis', 'jaws', 'beak', 'flat-face']) assert.deepEqual(FACE_EYES[face], ['round', 'horizontal', 'vertical-slit']);
  assert.deepEqual(FACE_EYE_PROFILE, {
    'flat-face': {gazeYawDeg: 15, k: 0.13}, 'muzzle-carnivore': {gazeYawDeg: 35, k: 0.13}, 'muzzle-grazer': {gazeYawDeg: 65, k: 0.14},
    'jaws-upright': {gazeYawDeg: 45, k: 0.13}, 'jaws-sprawled': {gazeYawDeg: 70, k: 0.13}, proboscis: {gazeYawDeg: 70, k: 0.07},
    beak: {gazeYawDeg: 75, k: 0.16}, mandibles: {gazeYawDeg: 90, k: 0}, blunt: {gazeYawDeg: 20, k: 0},
    'mandibles-camera': {gazeYawDeg: 70, k: 0.21}, 'blunt-camera': {gazeYawDeg: 35, k: 0.19},
  });
});

// The rule table of the plan (faceTypes allowedHeadgear), with every effect string verbatim.
const MAMMAL_CREST = 'Not built: mammal skulls carry no bony crest.';
const BEAK_HORN = 'Not built: birds and turtles never grow horns; only a casque (Crest).';
const keep = horn => [horn, null];
const omit = effect => ['none', effect];
const all = effect => ({none: keep('none'), nasal: omit(effect), paired: omit(effect), ossicones: omit(effect), crest: omit(effect)});
const EXPECTED_HEADGEAR = {
  muzzle: {none: keep('none'), nasal: keep('nasal'), paired: keep('paired'), ossicones: keep('ossicones'), crest: omit(`${MAMMAL_CREST} Choose Paired horns or Ossicones.`)},
  jaws: {none: keep('none'), nasal: keep('nasal'), paired: keep('paired'), ossicones: ['paired', 'Built as brow horns: ossicones grow only on giraffe-like muzzles.'], crest: keep('crest')},
  beak: {none: keep('none'), nasal: ['crest', 'Built as a casque: a beak carries a casque, not a nose horn.'], paired: omit(BEAK_HORN), ossicones: omit(BEAK_HORN), crest: keep('crest')},
  'flat-face': all('Not built: primate faces carry no horns.'),
  blunt: all('Not built: a worm head has no skull to carry horns.'),
  mandibles: all('Not built: arthropod heads carry no bony horns.'),
  proboscis: {none: keep('none'), nasal: omit('Not built: a trunk face has no nose bones to carry a horn.'), paired: keep('paired'),
    ossicones: omit('Not built: ossicones grow only on giraffe-like muzzles.'), crest: omit(MAMMAL_CREST)},
};

test('FACE_HEADGEAR 7 x 5 matrix: exact built kinds and effect strings; one Horns constraint exactly when built differs', () => {
  assert.deepEqual(Object.keys(FACE_HEADGEAR).sort(), [...COMPOSER_FACES].sort());
  let cells = 0, disclosed = 0;
  for (const face of COMPOSER_FACES) {
    assert.deepEqual(Object.keys(FACE_HEADGEAR[face]).sort(), [...COMPOSER_HORNS].sort(), face);
    for (const horn of COMPOSER_HORNS) {
      cells++;
      const [built, effect] = EXPECTED_HEADGEAR[face][horn];
      assert.deepEqual(FACE_HEADGEAR[face][horn], {built, effect}, `${face} + ${horn}`);
      assert.equal(effect === null, built === horn, `${face} + ${horn}: effect is null exactly when built === chosen`);
      const recipe = normalizeComposerRecipe({...composerPreset('giraffe'), head: face, horns: horn}).recipe;
      assert.deepEqual(composerHeadgearBuild(recipe), {built, effect});
      const horns = composerConstraints(recipe).filter(c => c.part === 'Horns');
      if (built === horn) assert.equal(horns.length, 0, `${face} + ${horn}`);
      else { disclosed++; assert.deepEqual(horns, [{part: 'Horns', chosen: horn, effect}], `${face} + ${horn}`); }
      assert.ok(!composerConstraints(recipe).some(c => c.part === 'Horn' || c.part === 'Trunk'), 'the v2 Horn/Trunk rules are gone');
    }
  }
  assert.equal(cells, 35);
  assert.equal(disclosed, 20, 'muzzle 1, proboscis 3, jaws 1, beak 3, flat-face/blunt/mandibles 4 each');
});

// Pinned at the WP1 commit: what each preset's eyes resolve to (eye type, iris, gaze yaw, k).
const PRESET_EYES = {
  dinosaur: ['round', 'gold', 45, 0.13], turtle: ['round', 'green', 75, 0.16], giraffe: ['horizontal', 'dark-brown', 65, 0.14], bird: ['round', 'yellow', 75, 0.16],
  ostrich: ['round', 'dark-brown', 75, 0.16], rhinoceros: ['round', 'dark-brown', 65, 0.14], ape: ['round', 'dark-brown', 15, 0.13], worm: ['eyespot', null, 20, 0],
  centipede: ['compound', null, 90, 0], 'shelled-giraffe-bird': ['round', 'orange', 75, 0.16], 'trunked-centipede': ['round', 'dark-brown', 70, 0.07],
  'winged-ape-rhino': ['round', 'dark-brown', 15, 0.13],
};

test('resolveComposerEyes on the 12 presets is pinned; colorSeed changes only the iris band, never the eye type', () => {
  assert.deepEqual(Object.keys(PRESET_EYES), [...COMPOSER_PRESET_IDS]);
  for (const id of COMPOSER_PRESET_IDS) {
    const recipe = composerPreset(id), eyes = resolveComposerEyes(recipe), [built, iris, yaw, k] = PRESET_EYES[id];
    assert.deepEqual([eyes.built, eyes.irisBuilt, eyes.gazeYawDeg, eyes.k], [built, iris, yaw, k], id);
    assert.equal(eyes.chosen, 'auto'); assert.equal(eyes.auto, true); assert.equal(eyes.effect, null);
    assert.ok(!composerConstraints(recipe).some(c => ['Horns', 'Eyes', 'Iris colour'].includes(c.part)), `${id}: a preset has no face disclosure`);
    const bands = composerIrisBands(recipe, built), seen = new Set();
    for (let colorSeed = 0; colorSeed < 64; colorSeed++) {
      const other = resolveComposerEyes({...recipe, colorSeed});
      assert.equal(other.built, built, `${id} colorSeed ${colorSeed}: eye type`);
      assert.deepEqual([other.gazeYawDeg, other.k], [yaw, k]);
      if (bands.length === 0) assert.equal(other.irisBuilt, null); else assert.ok(bands.includes(other.irisBuilt), `${id}: ${other.irisBuilt} in ${bands}`);
      seen.add(other.irisBuilt);
    }
    assert.equal(seen.size, Math.max(1, bands.length), `${id}: every iris band is reachable through colorSeed`);
  }
  // explicit choices under the Earlier eye rules (eyeRules 1): an eye the face cannot have is disclosed and built as the
  // auto type; an iris on an eye without one too (the face round's strings, verbatim)
  const giraffe = composerPreset('giraffe'), centipede = composerPreset('centipede'), worm = composerPreset('worm');
  const early = r => ({...r, eyeRules: 1});
  assert.deepEqual(resolveComposerEyes({...giraffe, eyes: 'vertical-slit', iris: 'green'}).built, 'vertical-slit');
  assert.equal(resolveComposerEyes({...giraffe, iris: 'green'}).irisBuilt, 'green');
  assert.deepEqual(faceOnly(early({...giraffe, eyes: 'compound'})), [{part: 'Eyes', chosen: 'compound', effect: 'Built as horizontal: compound eyes belong to arthropod heads.'}]);
  assert.deepEqual(faceOnly(early({...giraffe, eyes: 'eyespot'})), [{part: 'Eyes', chosen: 'eyespot', effect: 'Built as horizontal: eyespots belong to worm heads.'}]);
  assert.deepEqual(faceOnly(early({...centipede, eyes: 'round', iris: 'red'})), [
    {part: 'Eyes', chosen: 'round', effect: 'Built as compound: arthropod heads have compound eyes.'},
    {part: 'Iris colour', chosen: 'red', effect: 'Iris colour has no effect: compound eyes and eyespots have no iris.'}]);
  assert.deepEqual(faceOnly(early({...worm, eyes: 'horizontal'})), [{part: 'Eyes', chosen: 'horizontal', effect: 'Built as eyespot: a worm head has only pigment eyespots.'}]);
  // the current rules (eyeRules 2) build every explicit kind on every face: no Eyes entry; an iris on an eye without one
  // is still disclosed
  for (const [r, eyes] of [[giraffe, 'compound'], [giraffe, 'eyespot'], [centipede, 'round'], [worm, 'horizontal']]) {
    const e = resolveComposerEyes({...r, eyes});
    assert.equal(e.kind, eyes); assert.equal(e.effect, null); assert.deepEqual(faceOnly({...r, eyes}), []);
  }
  assert.deepEqual(faceOnly({...giraffe, eyes: 'compound', iris: 'red'}), [{part: 'Iris colour', chosen: 'red', effect: 'Iris colour has no effect: compound eyes, simple eyes, eye stalks and eyespots have no iris.'}]);
  // eyes and iris are species keys, but never anatomy: the species key (herd identity) ignores them
  assert.equal(composerSpeciesKey({...giraffe, eyes: 'round', iris: 'pale'}), composerSpeciesKey(giraffe));
});

test('faceHash is composerHash (duplicated only to keep the face module import-free)', () => {
  for (const text of ['', 'a', 'face-eye-v1/37/muzzle', 'composer-random-v1/0', 'x'.repeat(300)]) assert.equal(faceHash(text), composerHash(text), text);
});

test('migration over the 420 legacy and 28 skin-2 texts: 0 errors, 16 proboscis, exactly 78 trunks removed, horns verbatim', () => {
  const legacy = Object.keys(baseline.legacy), skin2 = Object.keys(baseline.skin2);
  assert.equal(legacy.length, 420); assert.equal(skin2.length, 28);
  const count = texts => {
    const out = {errors: 0, proboscis: 0, removed: 0};
    for (const text of texts) {
      const {recipe, issues: all, error} = decodeComposerRecipe(text), raw = fields(text), issues = all && notEyeUpgrade(all);
      if (error) { out.errors++; continue; }
      assert.equal(recipe.horns, raw.horns, `${text}: chosen horns kept verbatim`);
      const head = raw.head ?? 'muzzle';
      if (raw.trunk === 'trunk' && head === 'muzzle') { out.proboscis++; assert.deepEqual(issues, [PROMOTED], text); assert.equal(recipe.head, 'proboscis'); assert.equal(recipe.trunk, 'trunk'); }
      else if (raw.trunk === 'trunk') { out.removed++; assert.equal(issues.length, 1, text); assert.equal(issues[0].match(REMOVED)?.[1], head, text); assert.equal(recipe.head, head); assert.equal(recipe.trunk, 'none'); }
      else { assert.deepEqual(issues, [], text); assert.equal(recipe.trunk, 'none'); }
    }
    return out;
  };
  assert.deepEqual(count(legacy), {errors: 0, proboscis: 16, removed: 78});
  assert.deepEqual(count(skin2), {errors: 0, proboscis: 1, removed: 2});
  // the v1 trunked-centipede preset link still names its preset (matched on its legacy v1 values) and keeps its legacy horn, disclosed
  const v1 = v1Links.presets.find(p => p.id === 'trunked-centipede').text, decoded = decodeComposerRecipe(v1);
  assert.equal(decoded.error, null); assert.deepEqual(notEyeUpgrade(decoded.issues), [PROMOTED]);
  assert.equal(composerLegacyPresetId(decoded.recipe), 'trunked-centipede');
  assert.deepEqual(decoded.recipe, {...composerPreset('trunked-centipede'), horns: 'nasal'});
  assert.deepEqual(composerConstraints(decoded.recipe), [{part: 'Horns', chosen: 'nasal', effect: 'Not built: a trunk face has no nose bones to carry a horn.'}]);
  // the migration helper itself: a missing head built a muzzle, so it is promoted too; the source copy is mutated only
  const issues = [], src = {trunk: 'trunk'};
  migrateLegacyFace(src, issues);
  assert.deepEqual([src, issues], [{trunk: 'trunk', head: 'proboscis'}, [PROMOTED]]);
});

test('v3 trunk rules: the trunk follows the face, a stale trunk field never re-promotes', () => {
  // v3 text whose trunk disagrees with the face
  for (const text of ['v3*head_beak*trunk_trunk', 'v3*head_proboscis*trunk_none']) {
    const {recipe, issues, error} = decodeComposerRecipe(text);
    assert.equal(error, null);
    assert.deepEqual(issues, ['Trunk follows the Face; trunk field ignored.'], text);
    assert.equal(recipe.trunk, recipe.head === 'proboscis' ? 'trunk' : 'none');
  }
  assert.deepEqual(decodeComposerRecipe('v3*head_proboscis*trunk_trunk').issues, []);
  // the Lab edit path: proboscis -> muzzle with the stale trunk:'trunk' from the previous recipe
  const proboscis = composerPreset('trunked-centipede');
  assert.equal(proboscis.trunk, 'trunk');
  for (const edit of [{...proboscis, head: 'muzzle'}, (({version, ...rest}) => ({...rest, head: 'muzzle'}))(proboscis)]) {
    const {recipe, issues} = normalizeComposerRecipe(edit);
    assert.equal(recipe.head, 'muzzle', 'no re-promotion'); assert.equal(recipe.trunk, 'none'); assert.deepEqual(issues, []);
  }
  // a version-3 object choosing a trunk on a muzzle does not grow one either
  assert.equal(normalizeComposerRecipe({...composerPreset('giraffe'), trunk: 'trunk'}).recipe.trunk, 'none');
});

test('species keys equal the v2 baseline except the asserted dropped-trunk set and the 3 redesigned presets', () => {
  let same = 0, dropped = 0;
  for (const [group, entries] of [['legacy', baseline.legacy], ['skin2', baseline.skin2]]) for (const [text, base] of Object.entries(entries)) {
    const {recipe, issues} = decodeComposerRecipe(text), key = composerSpeciesKey(recipe);
    if (issues.some(issue => REMOVED.test(issue))) { dropped++; assert.notEqual(key, base.speciesKey, `${group} ${text}: a dropped trunk is a new species`); }
    else { same++; assert.equal(key, base.speciesKey, `${group} ${text}`); }
  }
  assert.equal(dropped, 78 + 2);
  assert.equal(same, 420 + 28 - 80);
  const changed = [];
  for (const id of COMPOSER_PRESET_IDS) if (composerSpeciesKey(composerPreset(id)) !== baseline.presets[id].speciesKey) changed.push(id);
  // trunked-centipede changes only because the coordinator removed its (never built) nasal horn; its proboscis face itself
  // projects to the legacy muzzle + trunk, which the legacy-horn variant proves:
  assert.deepEqual(changed, REDESIGNED);
  assert.equal(composerSpeciesKey({...composerPreset('trunked-centipede'), horns: 'nasal'}), baseline.presets['trunked-centipede'].speciesKey);
  assert.equal(composerSpeciesKey({...composerPreset('shelled-giraffe-bird'), horns: 'ossicones'}), baseline.presets['shelled-giraffe-bird'].speciesKey);
  assert.equal(composerSpeciesKey({...composerPreset('winged-ape-rhino'), horns: 'nasal'}), baseline.presets['winged-ape-rhino'].speciesKey);
});

test('generators: frozen draws equal the baseline; only head, trunk, horns, eyes, iris and eyeRules move; 1000 + 1000 seeds obey the face rules', () => {
  assert.equal(baseline.wild.length, 256); assert.equal(baseline.coherent.length, 256);
  const MOVABLE = new Set(['head', 'trunk', 'horns', 'eyes', 'iris']);
  for (let i = 0; i < 256; i++) {
    const seed = String(i), base = fields(baseline.wild[i]), draw = drawComposerRandomV1(seed), now = randomComposerRecipe(seed);
    for (const key of COMPOSER_V2_KEYS) assert.equal(String(draw[key]), base[key], `wild ${i}: drawn ${key}`);
    for (const key of COMPOSER_V2_KEYS) if (!MOVABLE.has(key)) assert.equal(String(now[key]), base[key], `wild ${i}: ${key}`);
    const coherent = coherentComposerSpecies(seed), cbase = baseline.coherent[i], cfields = fields(cbase.encoded);
    assert.equal(coherent.archetype, cbase.archetype, `coherent ${i}: archetype`);
    for (const key of COMPOSER_V2_KEYS) if (!MOVABLE.has(key)) assert.equal(String(coherent.recipe[key]), cfields[key], `coherent ${i}: ${key}`);
    for (const r of [now, coherent.recipe]) assert.ok(encodeComposerRecipe(r).length < 700);
  }
  let violations = 0;
  for (let i = 0; i < 1000; i++) for (const r of [randomComposerRecipe(`face-rule-${i}`), coherentComposerSpecies(`face-rule-${i}`).recipe]) {
    if (composerHeadgearBuild(r).built !== r.horns) violations++;
    if (r.trunk === 'trunk' && r.head !== 'proboscis') violations++;
    if (r.trunk !== 'trunk' && r.head === 'proboscis') violations++;
    // eyes: 'auto' or an explicit catalogue kind (wild rarity pass, coherent eye flavour); always the current rules
    if (!COMPOSER_EYE_TYPES.includes(r.eyes) || r.iris !== 'auto' || r.eyeRules !== 2) violations++;
    if (composerConstraints(r).some(c => c.part === 'Horns' || c.part === 'Eyes' || c.part === 'Iris colour')) violations++;
  }
  assert.equal(violations, 0);
});

test('skin-2 pins: exactly the 13 predicted entries were repinned, each with its face-rule cause; the other 15 keep their v2 pin', () => {
  const skin2 = JSON.parse(readFileSync(new URL('./fixtures/composer-skin2-links.json', import.meta.url), 'utf8'));
  let repinned = 0, kept = 0;
  for (const [text, pin] of Object.entries(skin2.byText)) {
    const {recipe, issues} = decodeComposerRecipe(text), raw = fields(text);
    const dropped = issues.some(issue => REMOVED.test(issue)), hornOmitted = composerHeadgearBuild(recipe).built !== recipe.horns;
    if (pin.driftFromV2) {
      repinned++;
      assert.equal(pin.driftFromV2, dropped ? 'fauna-composer-face-1: trunk dropped' : 'fauna-composer-face-1: horn not built on face', text);
      assert.ok(dropped || hornOmitted, text);
      assert.ok(pin.previous && pin.previous.skin !== pin.skin, `${text}: the previous pin is recorded`);
      if (dropped) assert.equal(pin.previous.bones - pin.bones, 6, `${text}: the 6 trunk bones`);
    } else {
      kept++;
      assert.ok(!dropped && !hornOmitted, `${text}: a face-rule change must be repinned`);
      assert.equal(pin.previous, undefined);
    }
    // the one text that becomes proboscis (the v1 trunked-centipede) is repinned only because its nasal horn is omitted
    if (recipe.head === 'proboscis') { assert.equal(raw.head, 'muzzle'); assert.equal(hornOmitted, true); assert.equal(pin.driftFromV2, 'fauna-composer-face-1: horn not built on face'); }
  }
  assert.deepEqual([repinned, kept], [13, 15]);
  assert.equal(skin2.repinnedAt.changed, 13);
});

test('presets: what they show is built (reversible redesign of the 3 hybrids)', () => {
  assert.equal(composerPreset('shelled-giraffe-bird').horns, 'crest');
  assert.deepEqual([composerPreset('trunked-centipede').head, composerPreset('trunked-centipede').trunk, composerPreset('trunked-centipede').horns], ['proboscis', 'trunk', 'none']);
  assert.equal(composerPreset('winged-ape-rhino').horns, 'none');
  for (const id of COMPOSER_PRESET_IDS) {
    const r = composerPreset(id);
    assert.equal(composerHeadgearBuild(r).built, r.horns, `${id}: its horn is built`);
    assert.equal(r.trunk, r.head === 'proboscis' ? 'trunk' : 'none');
  }
});

test('headBounds: rest-pose bounds of the face parts, inside the body, a fresh copy per call', () => {
  for (const id of ['giraffe', 'trunked-centipede', 'bird', 'centipede', 'worm']) {
    const creature = createComposerCreature(composerPreset(id));
    try {
      const head = creature.headBounds(), size = head.getSize(new (head.min.constructor)());
      assert.ok(!head.isEmpty(), id);
      for (const v of [head.min, head.max]) for (const c of v.toArray()) assert.ok(Number.isFinite(c), id);
      // every face-part vertex is inside it, and it is a strict part of the whole rest skin
      const skin = creature.skin, whole = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
      for (let v = 0; v < skin.vertexCount; v++) for (let a = 0; a < 3; a++) { whole.min[a] = Math.min(whole.min[a], skin.positions[v * 3 + a]); whole.max[a] = Math.max(whole.max[a], skin.positions[v * 3 + a]); }
      for (let a = 0; a < 3; a++) assert.ok(head.min.getComponent(a) >= whole.min[a] - 1e-9 && head.max.getComponent(a) <= whole.max[a] + 1e-9, `${id} axis ${a}`);
      assert.ok(size.x * size.y * size.z < (whole.max[0] - whole.min[0]) * (whole.max[1] - whole.min[1]) * (whole.max[2] - whole.min[2]), id);
      for (const part of skin.parts.filter(p => ['head', 'eyes', 'mouth', 'horn', 'trunk'].includes(p.part)))
        for (let i = part.firstTriangle * 3; i < (part.firstTriangle + part.triangles) * 3; i++) {
          const v = skin.index[i] * 3;
          for (let a = 0; a < 3; a++) assert.ok(skin.positions[v + a] >= head.min.getComponent(a) && skin.positions[v + a] <= head.max.getComponent(a));
        }
      head.makeEmpty();
      assert.ok(!creature.headBounds().isEmpty(), `${id}: a copy, not the cached box`);
      if (id === 'trunked-centipede') assert.ok(skin.parts.some(p => p.part === 'trunk' && p.triangles > 0), 'the proboscis face grows its trunk');
    } finally { creature.dispose(); }
  }
});
