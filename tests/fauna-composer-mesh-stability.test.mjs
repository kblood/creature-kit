// Composer-core determinism under a 1-ULP nudge of the platform transcendentals (docs/fauna-composer-stability-2026-10-07.md).
// The golden perturbation test (tests/golden/perturbation.test.mjs) found the pinned `trunked-centipede|skin-arrays`
// record moving under its nudge. Root cause: the proboscis ear profile raised sin(pi x) to a fractional power, and at
// the rim station x = pow(1, 0.75), which ECMA-262 leaves implementation-approximated. One ulp above 1 the sine is a hair
// below 0 and pow(negative, 0.8) is NaN: the whole rim ring of the ear (and its colours) became NaN. These tests drive
// the composer directly, in-process, so the failure is reproducible without the golden worker's call order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {composerPreset, COMPOSER_PRESET_IDS, normalizeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../src/fauna-composer-mesh.ts';

/** The golden generator's fauna pin: an absolute 1e-6 grid (tests/golden/generator.ts PLATFORM_QUANTUM_M.fauna). */
const Q = 1e-6;
const NAMES = ['sin', 'cos', 'atan2', 'atan', 'tan', 'pow', 'exp', 'log', 'cbrt', 'acos', 'asin', 'hypot', 'log2', 'log10', 'log1p', 'expm1', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'];

/** Results ECMA-262 21.3.2 fixes exactly (the golden perturbation test's table): never nudged. */
function specExact(name, a) {
  const [x, y] = a;
  switch (name) {
    case 'acos': case 'acosh': case 'log': case 'log2': case 'log10': return x === 1;
    case 'asin': case 'atan': case 'sin': case 'tan': case 'cbrt': case 'sinh': case 'asinh': case 'atanh': case 'log1p':
    case 'cos': case 'cosh': return x === 0;
    case 'exp': case 'expm1': return x === 0 || x === -Infinity;
    case 'tanh': return x === 0 || x === Infinity || x === -Infinity;
    case 'atan2': return (x === 0 && (y > 0 || Object.is(y, 0))) || (Number.isFinite(x) && y === Infinity);
    case 'pow': { const ax = Math.abs(x); return y === 0 || (x === 0 && y > 0) || (ax === Infinity && y < 0) || (ax < 1 && y === Infinity) || (ax > 1 && y === -Infinity); }
    case 'hypot': return a.every(v => v === 0);
    default: return false;
  }
}

/** Runs fn with Math[names] nudged by ~1 ulp. sign(k) gives the sign of the k-th nudged call (k from 1). */
function withNudge(names, sign, fn, select = () => true) {
  const originals = names.map(n => Math[n]);
  let k = 0;
  names.forEach((n, i) => {
    const original = originals[i];
    Math[n] = (...a) => {
      const r = original(...a);
      if (!Number.isFinite(r) || specExact(n, a) || !select(n, a)) return r;
      const s = sign(++k);
      return r === 0 ? s * Number.MIN_VALUE : r + s * Math.abs(r) * Number.EPSILON;
    };
  });
  try { return fn(); } finally { names.forEach((n, i) => { Math[n] = originals[i]; }); }
}

const build = recipe => buildComposerSkin(buildComposerGraph(deriveComposerIndividual(normalizeComposerRecipe(recipe).recipe).recipe));

function nonFinite(skin) {
  const bad = [];
  for (const key of ['positions', 'colors', 'skinWeight', 'gloss']) {
    const a = skin[key];
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad.push(`${key}[${i}]`); if (bad.length > 4) return bad; }
  }
  return bad;
}

/** Compares two skins on the golden grid (floats) and exactly (integer arrays); returns the first differences. */
function gridDiff(a, b) {
  const out = [];
  for (const key of ['index', 'skinIndex', 'regions']) {
    if (a[key].length !== b[key].length) { out.push(`${key}: length ${a[key].length} -> ${b[key].length}`); continue; }
    for (let i = 0; i < a[key].length && out.length < 6; i++) if (a[key][i] !== b[key][i]) out.push(`${key}[${i}]: ${a[key][i]} -> ${b[key][i]}`);
  }
  for (const key of ['positions', 'colors', 'skinWeight', 'gloss']) {
    if (a[key].length !== b[key].length) { out.push(`${key}: length ${a[key].length} -> ${b[key].length}`); continue; }
    for (let i = 0; i < a[key].length && out.length < 6; i++) if (Math.round(a[key][i] / Q) !== Math.round(b[key][i] / Q)) out.push(`${key}[${i}]: ${a[key][i]} -> ${b[key][i]}`);
  }
  return out;
}

const CENTIPEDE = 'trunked-centipede';
const MODES = {
  'pow(1, y) one ulp above 1': [['pow'], () => 1, (_n, a) => a[0] === 1],
  'pow(1, y) one ulp below 1': [['pow'], () => -1, (_n, a) => a[0] === 1],
  'every transcendental, alternating from +': [NAMES, k => (k % 2 ? 1 : -1)],
  'every transcendental, alternating from -': [NAMES, k => (k % 2 ? -1 : 1)],
  'every transcendental, all +1 ulp': [NAMES, () => 1],
  'every transcendental, all -1 ulp': [NAMES, () => -1],
};

test('trunked-centipede: the skin arrays hold the golden grid under every 1-ULP nudge mode (no NaN ear rim)', () => {
  const recipe = composerPreset(CENTIPEDE), base = build(recipe);
  assert.deepEqual(nonFinite(base), [], 'sanity: the unperturbed build is finite');
  for (const [mode, [names, sign, select]] of Object.entries(MODES)) {
    const skin = withNudge(names, sign, () => build(recipe), select);
    assert.deepEqual(nonFinite(skin), [], `${mode}: non-finite skin values (the proboscis ear's sin(pi x)^p rim)`);
    assert.deepEqual(gridDiff(base, skin), [], `${mode}: skin arrays moved on the golden 1e-6 grid`);
  }
});

// The midline insect ocellus (golden faunaKnownUnstable, GOLDEN-FAUNA-2): its site and seating ray lie in the head's
// mirror plane and cross the two seam triangles at the same t. Before seamNormal the tie order (a 1-ulp question) picked
// one seam triangle's normal: WebKit 26.5 picked the other one, and so does Node under the alternating nudge below.
const MIDLINE_INSECT = 'GOLDEN-FAUNA-2';
test('midline-ocellus insect: the skin arrays hold the golden grid under every 1-ULP nudge mode (seam tie)', () => {
  const recipe = randomComposerRecipe(MIDLINE_INSECT), base = build(recipe);
  for (const [mode, [names, sign, select]] of Object.entries(MODES)) {
    const skin = withNudge(names, sign, () => build(recipe), select);
    assert.deepEqual(nonFinite(skin), [], `${mode}: non-finite skin values`);
    assert.deepEqual(gridDiff(base, skin), [], `${mode}: skin arrays moved on the golden 1e-6 grid (the midline ocellus seam tie)`);
  }
});

/** The eye-part vertices near the mirror plane (|z| < 0.1 x the eyes' largest |z|): the midline ocellus. */
function midlineEyeVertices(skin) {
  const vs = new Set();
  for (const p of skin.parts) if (p.part === 'eyes') for (let t = p.firstTriangle; t < p.firstTriangle + p.triangles; t++) for (let k = 0; k < 3; k++) vs.add(skin.index[3 * t + k]);
  const z = v => skin.positions[3 * v + 2], maxZ = Math.max(...[...vs].map(v => Math.abs(z(v))));
  return [...vs].filter(v => Math.abs(z(v)) < 0.1 * maxZ);
}
test('midline ocellus is exactly mirror-symmetric: its on-seam vertices sit at z = 0 and every vertex has an exact mirror twin', () => {
  for (const name of [MIDLINE_INSECT]) {
    const skin = build(randomComposerRecipe(name)), mid = midlineEyeVertices(skin), P = v => [0, 1, 2].map(k => skin.positions[3 * v + k]);
    assert.equal(mid.length, 8, `${name}: the midline ocellus (6 rim + apex + base vertices)`);
    assert.ok(mid.filter(v => P(v)[2] === 0).length >= 2, `${name}: the ocellus axis vertices lie on the seam, z exactly 0`);
    for (const v of mid) {
      const [x, y, z] = P(v);
      assert.ok(mid.some(u => { const [a, b, c] = P(u); return a === x && b === y && c === -z; }), `${name}: vertex ${v} (${x}, ${y}, ${z}) has no exact mirror twin`);
    }
  }
});

test('the pow(1, y) nudge reaches the proboscis ear (negative control: the nudge is live)', () => {
  // the ear profile is the only pow(1, y) call site that feeds a fractional power of a sine; the nudge must still reach
  // pow(1, y) in the build, or the test above proves nothing
  let calls = 0;
  withNudge(['pow'], () => 1, () => build(composerPreset(CENTIPEDE)), (_n, a) => a[0] === 1 && ++calls > 0);
  assert.ok(calls > 0, 'pow(1, y) is called while building the trunked centipede');
});

test('every preset and golden random seed builds finite skins when pow(1, y) is one ulp off', () => {
  const recipes = [...COMPOSER_PRESET_IDS.map(id => [id, composerPreset(id)]), ...['GOLDEN-FAUNA-1', 'GOLDEN-FAUNA-2', 'GOLDEN-FAUNA-3', 'GOLDEN-FAUNA-4'].map(s => [s, randomComposerRecipe(s)])];
  for (const [name, recipe] of recipes) for (const s of [1, -1]) {
    const skin = withNudge(['pow'], () => s, () => build(recipe), (_n, a) => a[0] === 1);
    assert.deepEqual(nonFinite(skin), [], `${name} (pow(1, y) ${s > 0 ? 'above' : 'below'} 1)`);
  }
});
