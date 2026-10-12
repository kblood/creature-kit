// The app's own URL rules where it intentionally differs from Atlas's multi-mode Creature Lab (no Atlas needed):
// composer is the only mode and the default; a link naming another mode is rejected visibly, never shown as composer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LAB_STATE, parseCreatureLabState, creatureLabUrl, creatureLabComposerInputError, creatureLabInputNotices, creatureLabLightInputError} from '../../apps/creature-lab/src/creature-lab-state.ts';
import {composerPreset, encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';

const giraffe = encodeComposerRecipe(composerPreset('giraffe'));

test('mode=composer is accepted and is the default', () => {
  assert.equal(DEFAULT_LAB_STATE.mode, 'composer');
  assert.deepEqual(parseCreatureLabState(''), DEFAULT_LAB_STATE);
  assert.deepEqual(parseCreatureLabState('?mode=composer'), DEFAULT_LAB_STATE);
  const bare = parseCreatureLabState(`?recipe=${encodeURIComponent(giraffe)}&herd=6&light=planet-noon`);
  assert.deepEqual(bare, parseCreatureLabState(`?mode=composer&recipe=${encodeURIComponent(giraffe)}&herd=6&light=planet-noon`));
  assert.equal(bare.mode, 'composer'); assert.equal(bare.recipe, giraffe); assert.equal(bare.herd, 6);
  // a re-shared link always names the mode, so it opens the same in Atlas's Creature Lab
  assert.equal(new URL(creatureLabUrl('https://example.test/creature-lab.html', bare)).searchParams.get('mode'), 'composer');
});

test('a link without mode gets the composer checks: repeated keys and unknown motion reject, bad herd and light notice', () => {
  for (const key of ['recipe', 'compareRecipe', 'composerSeed', 'motion', 'herd', 'light']) {
    const q = new URLSearchParams({recipe: giraffe}); q.append(key, key === 'motion' ? 'walk' : key === 'herd' ? '6' : key === 'light' ? 'studio' : 'x'); q.append(key, key === 'motion' ? 'idle' : key === 'herd' ? '9' : key === 'light' ? 'planet-noon' : 'y');
    assert.equal(creatureLabComposerInputError(q), `Invalid composer link: repeated ${key}`, key);
  }
  assert.match(creatureLabComposerInputError('?motion=teleport'), /unknown motion "teleport"/);
  assert.equal(creatureLabLightInputError('?light=studio&light=planet-noon'), 'Invalid link: repeated light');
  const notices = creatureLabInputNotices('?herd=7&light=disco');
  assert.equal(notices.length, 2); assert.match(notices[0], /Herd size "7"/); assert.match(notices[1], /Lighting "disco"/);
  assert.equal(creatureLabComposerInputError(`?recipe=${encodeURIComponent(giraffe)}`), null);
});

test('new animation selections survive shared links', () => {
  for (const motion of ['run', 'eat', 'fly', 'glide']) {
    const state = parseCreatureLabState(`?mode=composer&motion=${motion}`);
    assert.equal(creatureLabComposerInputError(`?motion=${motion}`), null);
    assert.equal(state.motion, motion);
    assert.equal(parseCreatureLabState(new URL(creatureLabUrl('https://example.test/creature-lab.html', state)).search).motion, motion);
  }
});

test('a link naming another mode is rejected visibly, not reinterpreted', () => {
  for (const mode of ['gallery', 'anatomy', 'arena', 'ancestry', 'skin', 'typo', '', 'Composer']) {
    const q = `?mode=${encodeURIComponent(mode)}&recipe=${encodeURIComponent(giraffe)}`;
    assert.match(creatureLabComposerInputError(q), new RegExp(`^Unsupported link: mode "${mode}" is not part of the Creature Lab app`), mode);
    assert.deepEqual(creatureLabInputNotices(`${q}&herd=7`), [], 'no composer notices for a rejected link');
    assert.equal(creatureLabLightInputError(`${q}&light=a&light=b`), null);
  }
  assert.equal(creatureLabComposerInputError('?mode=composer&mode=gallery'), null, 'the first mode decides, as in Atlas');
});
