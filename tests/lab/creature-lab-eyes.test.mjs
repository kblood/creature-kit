// Creature Lab eye controls (eye round EC3, 2026-10-03): the grouped Eyes menu, the Eye rules select, iris colours and
// swatch, the eye close-up framing, and how old and new links reach these controls. Pure (no browser); the panel itself
// is exercised by tests/fauna-composer-ui.browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {
  COMPOSER_EYE_GROUP_LABEL, COMPOSER_EYE_MENU, COMPOSER_EYE_RULES_LABEL, COMPOSER_EYE_SHORT, COMPOSER_HINTED_KEYS, COMPOSER_OPTION_HINTS as H,
  EYE_FRAME_FILL_BOTH, EYE_FRAME_FILL_NEAR, EYE_FRAME_FORWARD_YAW_DEG, EYE_FRAME_FRONT_YAW_DEG, EYE_FRAME_MAX_OBLIQUE_DEG, EYE_FRAME_PAIR, composerBuiltEyeGaze, composerEyeFrameOf, composerEyeMidlineZ, composerVisibleEyeIndices, composerFieldLabel, composerHintedValues, composerIrisChoices, composerIrisSwatch, composerOptionText,
} from '../../apps/creature-lab/src/creature-lab-composer.ts';
import {COMPOSER_EYE_KINDS, EYE_PRESETS, composerEyeNative} from '../../src/fauna-composer-eye-catalogue.ts';
import {COMPOSER_EYE_TYPES, COMPOSER_FACES, COMPOSER_IRIS, COMPOSER_IRIS_RGB, resolveComposerEyes} from '../../src/fauna-composer-face.ts';
import {
  COMPOSER_PRESET_IDS, composerEyeUpgradeIssue, composerPreset, decodeComposerRecipe, encodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe,
} from '../../src/fauna-composer-recipe.ts';
import {creatureLabUrl, parseCreatureLabState} from '../../apps/creature-lab/src/creature-lab-state.ts';
import {createComposerCreature} from '../../src/fauna-composer.ts';

const decode = text => { const d = decodeComposerRecipe(text); assert.equal(d.error, null, text); return d; };
const asV3 = text => text.replace(/^v4\*/, 'v3*').replace(/\*eyeRules_\d+$/, '');

test('Eyes menu: Automatic first, then all 18 kinds exactly once in three named groups following the catalogue', () => {
  assert.equal(COMPOSER_EYE_KINDS.length, 18);
  assert.deepEqual(COMPOSER_EYE_MENU.map(g => g.label), ['Pupil shape', 'Animal eyes', 'Arthropod and other']);
  const listed = COMPOSER_EYE_MENU.flatMap(g => g.kinds);
  assert.equal(listed.length, 18); assert.deepEqual([...listed].sort(), [...COMPOSER_EYE_KINDS].sort());
  for (const g of COMPOSER_EYE_MENU) {
    assert.equal(COMPOSER_EYE_GROUP_LABEL[g.group], g.label);
    for (const k of g.kinds) assert.equal(EYE_PRESETS[k].group, g.group, `${k} is listed in its catalogue group`);
  }
  assert.deepEqual(COMPOSER_EYE_MENU[0].kinds, ['round', 'horizontal', 'vertical-slit'], 'the pupil shapes keep the face round order');
  assert.deepEqual(COMPOSER_EYE_MENU[2].kinds, ['compound', 'insect', 'spider', 'stalk', 'eyespot']);
  // the select's values are the recipe values (Automatic + 18) - grouping changes no link
  assert.deepEqual(['auto', ...listed].sort(), [...COMPOSER_EYE_TYPES].sort());
  assert.deepEqual(composerHintedValues('eyes'), COMPOSER_EYE_TYPES);
  for (const k of COMPOSER_EYE_KINDS) {
    const label = composerOptionText(composerPreset('giraffe'), 'eyes', k, false);
    assert.ok(label.length > 3 && label !== k, `${k} has a written label (${label})`);
    assert.ok(COMPOSER_EYE_SHORT[k], `${k} has a short name for Automatic`);
  }
});

test('rarity labels: on every preset face the kinds native to that face read plainly, the others "unusual here", and all are built', () => {
  for (const id of COMPOSER_PRESET_IDS) {
    const r = composerPreset(id);
    let plain = 0, odd = 0;
    for (const k of COMPOSER_EYE_KINDS) {
      const text = composerOptionText(r, 'eyes', k);
      assert.equal(resolveComposerEyes({...r, eyes: k}).kind, k, `${id}/${k}: built as chosen under the current rules`);
      if (composerEyeNative(k, r.head)) { assert.ok(!text.includes(' — '), `${id}/${k}: ${text}`); plain++; }
      else { assert.ok(text.endsWith(H.unusualFace), `${id}/${k}: ${text}`); odd++; }
    }
    assert.ok(plain >= 2 && odd >= 3, `${id}: ${plain} plain, ${odd} unusual`);
    // Automatic always shows what it resolves to and is never labelled unusual
    const auto = composerOptionText(r, 'eyes', 'auto'), e = resolveComposerEyes(r);
    assert.ok(auto.startsWith(`Automatic (${COMPOSER_EYE_SHORT[e.kind]}, `) && !auto.includes(' — '), `${id}: ${auto}`);
  }
});

test('Automatic (...) follows the face and the eye rules; the resolved label is what is built', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = randomComposerRecipe(seed);
    for (const eyeRules of [2, 1]) {
      const x = {...r, eyes: 'auto', eyeRules}, e = resolveComposerEyes(x), text = composerOptionText(x, 'eyes', 'auto');
      assert.equal(text, `Automatic (${COMPOSER_EYE_SHORT[e.kind]}, ${e.irisBuilt ? e.irisBuilt.replace('-', ' ') : 'no iris'}${eyeRules === 1 ? '; earlier eye rules' : ''})`);
      // choosing the kind Automatic names builds the same eyes (current rules)
      if (eyeRules === 2) assert.equal(resolveComposerEyes({...x, eyes: e.kind}).kind, e.kind);
    }
  }
});

test('Eye rules select: Current then Earlier; the upgrade notice names this control; choosing Earlier restores an upgraded link', () => {
  assert.deepEqual(composerHintedValues('eyeRules'), ['2', '1']);
  assert.ok(COMPOSER_HINTED_KEYS.includes('eyeRules'));
  assert.equal(composerFieldLabel('eyeRules'), 'Eye rules');
  assert.match(COMPOSER_EYE_RULES_LABEL['1'], /^Earlier eye rules/); assert.match(COMPOSER_EYE_RULES_LABEL['2'], /^Current eye rules/);
  const worm = {...composerPreset('worm'), eyes: 'horizontal'};
  const up = decode(asV3(encodeComposerRecipe(worm)));
  assert.equal(up.recipe.eyeRules, 2);
  const notice = composerEyeUpgradeIssue(up.recipe);
  assert.ok(notice.includes(`${composerFieldLabel('eyeRules')} -> Earlier`), `the notice points at the control: ${notice}`);
  // the Earlier option says what it would build here; the Current option never carries a hint
  assert.equal(composerOptionText(up.recipe, 'eyeRules', '1'), `${COMPOSER_EYE_RULES_LABEL['1']} — builds eyespots (no iris) here`);
  assert.equal(composerOptionText(up.recipe, 'eyeRules', '2'), COMPOSER_EYE_RULES_LABEL['2']);
  assert.equal(composerOptionText(composerPreset('giraffe'), 'eyeRules', '1'), `${COMPOSER_EYE_RULES_LABEL['1']} — same eyes here`);
  // the panel's change handler writes Number(select.value): the result is a v4 link with eyeRules 1 that keeps the old eyes
  const earlier = normalizeComposerRecipe({...up.recipe, eyeRules: Number('1')}).recipe, text = encodeComposerRecipe(earlier);
  assert.match(text, /\*eyeRules_1$/);
  const back = decode(text);
  assert.deepEqual(back.issues, []); assert.equal(resolveComposerEyes(back.recipe).built, 'eyespot');
});

test('links: the eye choice, iris and eye rules survive a Lab URL round trip; old links open on the current rules', () => {
  const cases = [
    {...composerPreset('ape'), eyes: 'cephalopod', iris: 'copper'},
    {...composerPreset('ostrich'), eyes: 'owl', iris: 'grey-green', eyeRules: 1},
    {...composerPreset('centipede'), eyes: 'spider'},
    {...composerPreset('worm'), eyes: 'stalk', iris: 'blue'},
  ];
  for (const r of cases) {
    const text = encodeComposerRecipe(r);
    const url = new URL(creatureLabUrl('http://x/creature-lab.html', {...parseCreatureLabState(new URLSearchParams()), mode: 'composer', recipe: text}));
    const state = parseCreatureLabState(url.searchParams);
    assert.equal(state.recipe, text);
    const d = decode(state.recipe);
    assert.equal(d.recipe.eyes, r.eyes); assert.equal(d.recipe.iris, r.iris); assert.equal(d.recipe.eyeRules, r.eyeRules ?? 2);
    assert.deepEqual(d.issues, []);
  }
  // a v3 link never opens on the earlier rules silently
  for (const id of COMPOSER_PRESET_IDS) assert.equal(decode(asV3(encodeComposerRecipe(composerPreset(id)))).recipe.eyeRules, 2, id);
});

test('iris: Automatic names the colour built; colours outside these eyes\' automatic colours read "uncommon"; eyes without an iris say so', () => {
  const cat = {...composerPreset('giraffe'), head: 'muzzle', eyes: 'cat'};
  const bands = composerIrisChoices(cat);
  assert.ok(bands.length >= 2);
  for (const iris of COMPOSER_IRIS) {
    if (iris === 'auto') continue;
    const text = composerOptionText(cat, 'iris', iris);
    assert.equal(text.endsWith(H.unusualIris), !bands.includes(iris), `${iris}: ${text}`);
  }
  const compound = composerPreset('centipede');
  assert.deepEqual(composerIrisChoices(compound), []);
  assert.equal(composerOptionText(compound, 'iris', 'blue'), 'Blue — no effect (no iris)');
  assert.equal(composerIrisSwatch(compound), null);
});

test('iris swatch: the built iris colour as sRGB hex, the same colour the mesh is given', () => {
  const toSrgb = c => Math.round(255 * Math.min(1, c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055));
  for (const iris of COMPOSER_IRIS) {
    if (iris === 'auto') continue;
    const r = {...composerPreset('ape'), iris}, e = resolveComposerEyes(r), hex = composerIrisSwatch(r);
    assert.equal(e.irisBuilt, iris);
    assert.match(hex, /^#[0-9a-f]{6}$/);
    assert.deepEqual([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), COMPOSER_IRIS_RGB[iris].map(toSrgb), iris);
  }
  const auto = composerPreset('ape');
  assert.equal(composerIrisSwatch(auto), composerIrisSwatch({...auto, iris: resolveComposerEyes(auto).irisBuilt}));
  // different colours, different swatches (the 12 colours are distinguishable at a glance)
  const all = COMPOSER_IRIS.filter(i => i !== 'auto').map(iris => composerIrisSwatch({...auto, iris}));
  assert.equal(new Set(all).size, all.length);
});

test('eye close-up framing: lateral eyes give the near eye (front view: a front-quarter view of it), forward pairs are framed together, a midline eye whole', () => {
  // two visible eyes of radius 0.02 at z = +-0.11 (11 radii apart: lateral) around a head at x = 1, y = 1.2 (bodies face +X)
  const sphere = (cx, cy, cz, r) => { const ps = []; for (let i = 0; i < 64; i++) { const t = i / 64 * Math.PI * 2, p = (i % 8) / 8 * Math.PI - Math.PI / 2; ps.push(new THREE.Vector3(cx + r * Math.cos(p) * Math.cos(t), cy + r * Math.sin(p), cz + r * Math.cos(p) * Math.sin(t))); } ps.push(new THREE.Vector3(cx, cy + r, cz), new THREE.Vector3(cx, cy - r, cz)); return ps; };
  const eyes = [...sphere(1, 1.2, .11, .02), ...sphere(1, 1.2, -.11, .02)];
  const sideDir = new THREE.Vector3(0, 0, 1), side = composerEyeFrameOf(eyes, 0, sideDir);
  assert.equal(side.side, 'near'); assert.equal(side.yawed, false);
  assert.ok(Math.abs(side.centre.z - .11) < 1e-3 && Math.abs(side.eyeRadius - .02) < 2e-3);
  assert.ok(Math.abs(side.pairSeparation - 11) < .2, `pair separation ${side.pairSeparation}`);
  assert.ok(side.box.containsPoint(new THREE.Vector3(1, 1.2, .11)) && !side.box.containsPoint(new THREE.Vector3(1, 1.2, -.11)), 'only the near eye');
  assert.ok(side.direction.equals(sideDir), 'side view keeps its direction');
  // the fit extents are the eye's own (radius .02 across and up), and the near eye is fitted to EYE_FRAME_FILL_NEAR
  assert.ok(Math.abs(side.half.up - .02) < 2e-3 && Math.abs(side.half.right - .02) < 2e-3, JSON.stringify(side.half));
  assert.deepEqual(side.fill, EYE_FRAME_FILL_NEAR);
  const q = composerEyeFrameOf(eyes, 0, new THREE.Vector3(.6, .3, .74).normalize());
  assert.equal(q.side, 'near'); assert.ok(q.centre.z > 0);
  const fromLeft = composerEyeFrameOf(eyes, 0, new THREE.Vector3(0, 0, -1));
  assert.ok(fromLeft.centre.z < 0, 'a camera on the -z side frames the -z eye');
  // front view of lateral eyes: no edge-on pair at the frame sides; the +z eye from a front-quarter direction
  const front = composerEyeFrameOf(eyes, 0, new THREE.Vector3(1, .15, 0).normalize());
  assert.equal(front.side, 'near'); assert.equal(front.yawed, true); assert.ok(front.centre.z > 0);
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(front.direction.z, front.direction.x));
  assert.ok(Math.abs(yaw - EYE_FRAME_FRONT_YAW_DEG) < 1e-6, `front-quarter yaw ${yaw}`);
  assert.ok(Math.abs(front.direction.length() - 1) < 1e-9 && Math.abs(front.direction.y - new THREE.Vector3(1, .15, 0).normalize().y) < 1e-9, 'elevation kept');
  // forward-facing eyes (pair closer than EYE_FRAME_PAIR eye radii): the front and three-quarter views frame the pair
  // (no half-cut far eye), the side view still the near eye
  const forward = [...sphere(1, 1.2, .06, .02), ...sphere(1, 1.2, -.06, .02)];
  for (const d of [new THREE.Vector3(.6, .3, .74), new THREE.Vector3(1, .15, 0)]) {
    const f = composerEyeFrameOf(forward, 0, d.normalize());
    assert.equal(f.side, 'both'); assert.equal(f.yawed, false); assert.deepEqual(f.fill, EYE_FRAME_FILL_BOTH);
    for (const z of [.06, -.06]) assert.ok(f.box.containsPoint(new THREE.Vector3(1, 1.2, z)));
  }
  assert.equal(composerEyeFrameOf(forward, 0, new THREE.Vector3(0, 0, 1)).side, 'near');
  // the same spacing on a face that looks sideways (a beak, gaze 75 degrees) is a lateral pair; a forward gaze keeps it a pair
  assert.equal(composerEyeFrameOf(forward, 0, new THREE.Vector3(1, .15, 0).normalize(), 75).yawed, true);
  assert.equal(composerEyeFrameOf(forward, 0, new THREE.Vector3(1, .15, 0).normalize(), 15).side, 'both');
  // a close pair looking 35 degrees out (a cat, the sclera-eyed worm with EC2's eyes: 5.5-6.1 radii) is framed one eye
  // at a time; the forward limit is EYE_FRAME_FORWARD_YAW_DEG
  assert.ok(EYE_FRAME_FORWARD_YAW_DEG < 35 && EYE_FRAME_FORWARD_YAW_DEG >= 20);
  for (const d of [new THREE.Vector3(1, .15, 0), new THREE.Vector3(.6, .3, .74)]) {
    const f = composerEyeFrameOf(forward, 0, d.normalize(), 35);
    assert.equal(f.side, 'near'); assert.ok(f.centre.z > 0);
    // seen at most EYE_FRAME_MAX_OBLIQUE_DEG off its 35-degree gaze
    assert.ok(Math.abs(Math.abs(THREE.MathUtils.radToDeg(Math.atan2(f.direction.z, f.direction.x))) - 35) <= EYE_FRAME_MAX_OBLIQUE_DEG + 1e-6);
  }
  // a known gaze caps the obliquity at EYE_FRAME_MAX_OBLIQUE_DEG: a beak eye (75 degrees) seen from the front turns to
  // a (75 - cap)-degree front-quarter view; a primate's forward eye (15 degrees) seen from the side turns to a (15 + cap)-degree view;
  // a view within the cap is kept
  const az = d => THREE.MathUtils.radToDeg(Math.atan2(d.z, d.x));
  const beakFront = composerEyeFrameOf(eyes, 0, new THREE.Vector3(1, .15, 0).normalize(), 75);
  assert.equal(beakFront.side, 'near'); assert.ok(Math.abs(az(beakFront.direction) - (75 - EYE_FRAME_MAX_OBLIQUE_DEG)) < 1e-6 && Math.abs(beakFront.yawDeg - (75 - EYE_FRAME_MAX_OBLIQUE_DEG)) < 1e-6, `${az(beakFront.direction)}`);
  const apeSide = composerEyeFrameOf(forward, 0, new THREE.Vector3(0, .12, 1).normalize(), 15);
  assert.equal(apeSide.side, 'near'); assert.equal(apeSide.yawed, true); assert.ok(Math.abs(az(apeSide.direction) - (15 + EYE_FRAME_MAX_OBLIQUE_DEG)) < 1e-6, `${az(apeSide.direction)}`);
  const fromMinusZ = composerEyeFrameOf(forward, 0, new THREE.Vector3(0, .12, -1).normalize(), 15);
  assert.ok(fromMinusZ.centre.z < 0 && Math.abs(az(fromMinusZ.direction) + (15 + EYE_FRAME_MAX_OBLIQUE_DEG)) < 1e-6, 'mirrored on the -z side');
  const within = composerEyeFrameOf(eyes, 0, new THREE.Vector3(0, .12, 1).normalize(), 75);
  assert.equal(within.yawed, false); assert.equal(within.yawDeg, 0);
  // wide-set eyes are lateral even with a forward gaze (a cat's muzzle: the pair would be tiny at the frame sides): the
  // front view frames the near eye alone, turned only as far as the obliquity cap needs (35-degree gaze)
  const catFront = composerEyeFrameOf(eyes, 0, new THREE.Vector3(1, .15, 0).normalize(), 35);
  assert.equal(catFront.side, 'near'); assert.equal(catFront.yawDeg, Math.max(0, 35 - EYE_FRAME_MAX_OBLIQUE_DEG));
  // an animal off the origin (herd/compare offset): sides are taken about its own midline
  const shifted = eyes.map(p => p.clone().add(new THREE.Vector3(0, 0, 3)));
  assert.ok(Math.abs(composerEyeFrameOf(shifted, 3, new THREE.Vector3(0, 0, 1)).centre.z - 3.11) < 1e-3);
  // a single frontal eye (straddles the midline) and no eyes
  assert.equal(composerEyeFrameOf(sphere(1, 1, 0, .03), 0, new THREE.Vector3(0, 0, 1)).side, 'both', 'a midline eye is framed whole');
  assert.equal(composerEyeFrameOf([], 0, new THREE.Vector3(0, 0, 1)), null);
});

test('eye close-up framing splits near/far about the posed HEAD midline: a head swayed off the animal midline still gives the near eye, capped', () => {
  const sphere = (cx, cy, cz, r) => { const ps = []; for (let i = 0; i < 64; i++) { const t = i / 64 * Math.PI * 2, p = (i % 8) / 8 * Math.PI - Math.PI / 2; ps.push(new THREE.Vector3(cx + r * Math.cos(p) * Math.cos(t), cy + r * Math.sin(p), cz + r * Math.cos(p) * Math.sin(t))); } ps.push(new THREE.Vector3(cx, cy + r, cz), new THREE.Vector3(cx, cy - r, cz)); return ps; };
  // a worm-like forward pair (eyespots r 0.003 at rest z +-0.01, under EYE_FRAME_PAIR radii apart), head swayed 0.047 m to +z and yawed
  // 7 degrees: at the animal's midline (z 0) both eyes lie on the +z side
  const restPlus = sphere(.63, .077, .01, .003), restMinus = sphere(.63, .077, -.01, .003), rest = [...restPlus, ...restMinus];
  const sway = new THREE.Matrix4().makeTranslation(0, 0, .047).multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(-7)));
  const pivot = new THREE.Vector3(.63, .077, 0), posed = rest.map(p => p.clone().sub(pivot).applyMatrix4(sway).add(pivot));
  const restZ = rest.map(p => p.z);
  assert.ok(posed.every(p => p.z > 0), 'the swayed eyes are all on the +z side of the animal midline');
  const midZ = composerEyeMidlineZ(posed, restZ);
  assert.ok(Math.abs(midZ - .047) < 2e-3, `head midline ${midZ}`);
  const gaze = 20, sideDir = new THREE.Vector3(0, .12, 1).normalize(), az = d => THREE.MathUtils.radToDeg(Math.atan2(d.z, d.x));
  // the bug this guards: the animal's midline puts both eyes on one side, no pair, no near eye, no obliquity cap
  const wrong = composerEyeFrameOf(posed, 0, sideDir, gaze);
  assert.equal(wrong.side, 'both'); assert.equal(wrong.pairSeparation, 0);
  const side = composerEyeFrameOf(posed, midZ, sideDir, gaze);
  assert.equal(side.side, 'near'); assert.equal(side.midZ, midZ);
  assert.ok(side.pairSeparation > 2 && side.pairSeparation < EYE_FRAME_PAIR, `pair separation ${side.pairSeparation}`);
  assert.ok(side.centre.z > midZ, 'the near (+z) eye');
  assert.equal(side.yawed, true); assert.ok(Math.abs(az(side.direction) - (gaze + EYE_FRAME_MAX_OBLIQUE_DEG)) < 1e-6, `capped view azimuth ${az(side.direction)}`);
  // the other side: a camera on -z frames the -z eye of the swayed head
  const other = composerEyeFrameOf(posed, midZ, new THREE.Vector3(0, .12, -1).normalize(), gaze);
  assert.equal(other.side, 'near'); assert.ok(other.centre.z < midZ);
  // a forward pair in the three-quarter and front views is still framed together
  for (const d of [new THREE.Vector3(.6, .3, .74), new THREE.Vector3(1, .15, 0)]) assert.equal(composerEyeFrameOf(posed, midZ, d.normalize(), gaze).side, 'both');
  // unchanged for an unswayed head (midline = the animal's) and for a single midline eye (its own centre)
  assert.ok(Math.abs(composerEyeMidlineZ(rest, restZ)) < 1e-9);
  const cyclops = sphere(1, 1, 0, .03).map(p => p.clone().add(new THREE.Vector3(0, 0, .05)));
  assert.ok(Math.abs(composerEyeMidlineZ(cyclops, sphere(1, 1, 0, .03).map(p => p.z)) - .05) < 1e-3);
  assert.equal(composerEyeFrameOf(cyclops, composerEyeMidlineZ(cyclops, sphere(1, 1, 0, .03).map(p => p.z)), new THREE.Vector3(0, 0, 1)).side, 'both');
  assert.equal(composerEyeMidlineZ([], []), 0);
});

test('the real posed worm (idle, time 0, as the Lab shows it): side view frames the near eyespot with the obliquity cap', () => {
  const r = composerPreset('worm'), c = createComposerCreature(r);
  try {
    c.update('idle', 0); c.group.updateMatrixWorld(true);
    const ids = composerVisibleEyeIndices(c.skin), restZ = ids.map(i => c.skin.positions[i * 3 + 2]);
    const posed = ids.map(i => c.mesh.localToWorld(c.mesh.getVertexPosition(i, new THREE.Vector3())));
    const gaze = resolveComposerEyes(r).gazeYawDeg, midZ = composerEyeMidlineZ(posed, restZ);
    for (const [view, d] of [['side', new THREE.Vector3(0, .12, 1)], ['side-left', new THREE.Vector3(0, .12, -1)]]) {
      const f = composerEyeFrameOf(posed, midZ, d.normalize(), gaze);
      assert.equal(f.side, 'near', `${view}: near eyespot (midline ${midZ.toFixed(4)})`);
      assert.ok(f.pairSeparation > 1, `${view}: a pair (${f.pairSeparation})`);
      const off = Math.abs(Math.abs(THREE.MathUtils.radToDeg(Math.atan2(f.direction.z, f.direction.x))) - gaze);
      assert.ok(off <= EYE_FRAME_MAX_OBLIQUE_DEG + 1e-6, `${view}: ${off.toFixed(1)} degrees off the gaze`);
    }
  } finally { c.dispose(); }
});

test('the framing gaze is the gaze the eyes are built with: every camera eye of the eye specimens faces where composerBuiltEyeGaze says', () => {
  const specs = JSON.parse(readFileSync(new URL('../fauna-face-specimens.json', import.meta.url), 'utf8')).specimens.filter(s => /^(preset|eye|eye-catalogue|eye-odd|eye-upgrade)$/.test(s.group));
  let checked = 0;
  for (const sp of specs) {
    const c = createComposerCreature(decode(sp.text).recipe);
    try {
      // cat and spectacle eyes turn into the skull (EC2 4e030bb): their gaze is measured from the built skin; every
      // other kind is the pure mirror (the skin is passed as the Lab passes it, and only those kinds read it)
      const r = c.individual.effectiveRecipe, e = resolveComposerEyes(r), g = composerBuiltEyeGaze(r, c.skin.version, c.skin);
      assert.ok(Number.isFinite(g.plus) && Number.isFinite(g.minus), sp.name);
      // the turret (chameleon) aims its cornea through a cone; its facing is not a dome's
      if (e.traits.structure !== 'camera' || e.traits.placement.kind === 'independent') { if (e.traits.placement.kind !== 'independent') assert.equal(g.plus, g.minus, sp.name); continue; }
      const ids = new Set(composerVisibleEyeIndices(c.skin)), pos = c.skin.positions, V = i => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const n = {1: new THREE.Vector3(), [-1]: new THREE.Vector3()};
      for (const p of c.skin.parts) if (p.part === 'eyes') for (let t = p.firstTriangle; t < p.firstTriangle + p.triangles; t++) {
        const k = [0, 1, 2].map(j => c.skin.index[t * 3 + j]);
        if (!k.every(i => ids.has(i))) continue;
        const [A, B, D] = k.map(V);
        n[A.z + B.z + D.z > 0 ? 1 : -1].add(new THREE.Vector3().crossVectors(B.clone().sub(A), D.clone().sub(A)));
      }
      for (const side of [1, -1]) {
        const facing = THREE.MathUtils.radToDeg(Math.atan2(side * n[side].z, n[side].x)), built = side > 0 ? g.plus : g.minus;
        assert.ok(Math.abs(facing - built) <= 8, `${sp.name} (${e.kind}, ${c.skin.version}) ${side > 0 ? '+z' : '-z'} eye: cornea faces ${facing.toFixed(1)}, framing gaze ${built}`);
      }
      checked++;
    } finally { c.dispose(); }
  }
  assert.ok(checked >= 30, `camera-eye specimens checked: ${checked}`);
  // per-side gaze (independent eyes): each side's own gaze caps its own view
  const sphere = (cx, cy, cz, r) => { const ps = []; for (let i = 0; i < 64; i++) { const t = i / 64 * Math.PI * 2, p = (i % 8) / 8 * Math.PI - Math.PI / 2; ps.push(new THREE.Vector3(cx + r * Math.cos(p) * Math.cos(t), cy + r * Math.sin(p), cz + r * Math.cos(p) * Math.sin(t))); } return ps; };
  const eyes = [...sphere(1, 1, .11, .02), ...sphere(1, 1, -.11, .02)], az = d => THREE.MathUtils.radToDeg(Math.atan2(d.z, d.x)), gaze = {plus: 110, minus: 35};
  const fromPlus = composerEyeFrameOf(eyes, 0, new THREE.Vector3(0, .12, 1).normalize(), gaze), fromMinus = composerEyeFrameOf(eyes, 0, new THREE.Vector3(0, .12, -1).normalize(), gaze);
  assert.equal(fromPlus.yawed, false, 'the +z eye looks 110 degrees out: the side view is within the cap');
  assert.ok(Math.abs(-az(fromMinus.direction) - (35 + EYE_FRAME_MAX_OBLIQUE_DEG)) < 1e-6, `the -z eye (35 degrees) is turned to: ${-az(fromMinus.direction)}`);
});

test('the eye close-up frames the visible eye: the cornea of a lidded eye (not its lids, orbit ring or socket), a compound dome, an eyespot', () => {
  for (const id of ['ape', 'ostrich', 'centipede', 'worm']) {
    const c = createComposerCreature(composerPreset(id));
    try {
      const skin = c.skin, ids = composerVisibleEyeIndices(skin), part = new Set();
      for (const p of skin.parts) if (p.part === 'eyes') for (let t = p.firstTriangle * 3; t < (p.firstTriangle + p.triangles) * 3; t++) part.add(skin.index[t]);
      assert.ok(ids.length > 0 && ids.every(i => part.has(i)), `${id}: visible eye vertices come from the eyes part`);
      const max = Math.max(...[...part].map(i => skin.gloss[i]));
      if (max > 0) assert.ok(ids.every(i => skin.gloss[i] >= .5 * max), `${id}: only the glossy eye surface`);
      if (id === 'ape' || id === 'ostrich') assert.ok(ids.length <= part.size / 2, `${id}: the cornea is at most half of the eye part (${ids.length}/${part.size})`);
      // the visible eye is much smaller than the whole eye part with its lids and orbit ring
      const box = ps => { const b = new THREE.Box3(); for (const i of ps) b.expandByPoint(new THREE.Vector3(skin.positions[i * 3], skin.positions[i * 3 + 1], skin.positions[i * 3 + 2])); return b.getSize(new THREE.Vector3()).y; };
      if (id === 'ape' || id === 'ostrich') assert.ok(box(ids) < .8 * box(part), `${id}: cornea height ${box(ids)} vs eye part ${box(part)}`);
    } finally { c.dispose(); }
  }
});

test('rarity hints never forbid: every face x kind is selectable and builds the chosen kind under the current rules', () => {
  for (const head of COMPOSER_FACES) for (const eyes of COMPOSER_EYE_KINDS) {
    const r = normalizeComposerRecipe({...composerPreset('giraffe'), head, eyes}).recipe;
    assert.equal(r.eyes, eyes); assert.equal(resolveComposerEyes(r).kind, eyes, `${head}/${eyes}`);
  }
});
