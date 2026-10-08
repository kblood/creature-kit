// Coat crisp v1 (fauna-composer-skin-5, docs/fauna-coat-crisp-v1.md): the per-fragment coat pattern, its exact
// per-vertex layers and the pre-registered metrics (section 1 of the doc; thresholds are not changed here).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {
  COAT_CELLS_PER_BODY, COAT_PATTERN_SALTS, COAT_WORLEY_JITTER, coatPatternProbe, coatSeedMix, defaultCoatGenome,
  evaluateCoat, evaluateCoatWithMask,
} from '../src/fauna-coat-fields.ts';
import {COAT_MARK_BITS, COAT_PATTERNS, COAT_REGIONS} from '../src/fauna-coat-vocab.ts';
import {COMPOSER_PRESET_IDS, composerPreset, decodeComposerRecipe, normalizeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {COMPOSER_COAT_CRISP_PATTERNS, COMPOSER_COAT_CRISP_VERSION, TRUNK_TIP, buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {
  COMPOSER_COAT_CRISP_GLSL, COMPOSER_GLOSS_CACHE_KEY, createComposerCreature, patchComposerCoatCrispShader, patchComposerGlossShader,
} from '../src/fauna-composer.ts';

const RESOLVED = COAT_PATTERNS.filter(p => p !== 'auto');
const skinOf = (overrides, options = {debug: true}) => {
  const recipe = normalizeComposerRecipe(overrides).recipe;
  return buildComposerSkin(buildComposerGraph(deriveComposerIndividual(recipe).recipe), options);
};
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const MALE = {sex: 'male', dimorphism: 1, individualSeed: 7, variability: 0, maturity: 1, condition: 0};

// ------------------------------------------------------------------ the layer evaluator is evaluateCoat
test('evaluateCoatWithMask with coatPatternProbe mask and patch equals evaluateCoat (Object.is, every pattern, region and mark)', () => {
  let n = 0;
  const probe = new Float64Array(5), a = new Float64Array(3), b = new Float64Array(3);
  for (const pattern of RESOLVED) for (const [k, marks] of [0, 255, COAT_MARK_BITS['juvenile-spots'] | COAT_MARK_BITS.blaze].entries()) {
    const genome = defaultCoatGenome(['savanna', 'tawny', 'plumage'][k], 17 + k, {pattern, marks, contrast: [1, 1.5, 0.6][k], threshold: [0, 0.2, -0.2][k], greying: k * 0.4});
    for (const region of COAT_REGIONS) for (let i = 0; i < 24; i++) {
      const s = {x: -0.5 + i / 23, y: 0.2 * Math.sin(i * 1.7), z: 0.15 * Math.cos(i * 2.3), dorsal: Math.cos(i * 0.9), region, along: (i % 7) / 6, footprint: i % 3 ? 0 : 0.01};
      evaluateCoat(genome, s, a, 0);
      coatPatternProbe(genome, s, probe);
      evaluateCoatWithMask(genome, s, b, 0, probe[0], probe[4]);
      for (let c = 0; c < 3; c++) assert.ok(Object.is(a[c], b[c]), `${pattern}/${region}/${i}: channel ${c} ${a[c]} vs ${b[c]}`);
      n++;
    }
  }
  assert.ok(n > 3000);
});

test('evaluateCoatWithMask source is evaluateCoat with only the mask and patch substituted (no drift)', () => {
  const src = readFileSync(new URL('../src/fauna-coat-fields.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = name => {
    const start = src.indexOf(`export function ${name}(`);
    assert.ok(start >= 0, name);
    const open = src.indexOf('{\n', start), end = src.indexOf('\n}\n', open);
    return src.slice(open, end);
  };
  const original = body('evaluateCoat'), copy = body('evaluateCoatWithMask');
  const expected = original.replace('const m = patternMask(genome, sample, fp);', 'const m = mask;').replaceAll('accent[0], PATCH)', 'accent[0], patch)').replaceAll('accent[1], PATCH)', 'accent[1], patch)').replaceAll('accent[2], PATCH)', 'accent[2], patch)');
  assert.notEqual(expected, original);
  assert.equal(copy, expected);
});

test('the shader takes its salts and jitter from the coat library', () => {
  for (const v of Object.values(COAT_PATTERN_SALTS)) assert.ok(COMPOSER_COAT_CRISP_GLSL.includes(`0x${(v >>> 0).toString(16)}u`), v.toString(16));
  assert.ok(COMPOSER_COAT_CRISP_GLSL.includes(`COAT_JITTER = ${COAT_WORLEY_JITTER}`));
  assert.deepEqual([...COMPOSER_COAT_CRISP_PATTERNS], ['spots', 'rosettes', 'reticulated', 'dapple', 'stripes', 'bands', 'brindle']);
});

// ------------------------------------------------------------------ skin contract
test('crisp contract: requested (unclamped) scale, seed, cells; layers on every vertex; plain patterns stay vertex colour', () => {
  const skin = skinOf({...composerPreset('giraffe'), pattern: 'spots', bodyLength: 0.3, patternScale: 2});
  const c = skin.coatCrisp;
  assert.equal(c.version, COMPOSER_COAT_CRISP_VERSION);
  assert.ok(skin.coatScale.effective < skin.coatScale.requested, 'this body clamps the vertex pattern');
  assert.equal(c.genome.scale, skin.coatScale.requested, 'the shader runs at the requested scale');
  assert.equal(c.cellsPerBody, COAT_CELLS_PER_BODY.spots * skin.coatScale.requested);
  assert.equal(c.seed, coatSeedMix(c.genome.seed) >>> 0);
  assert.deepEqual([c.code, c.threshold, c.warp, c.bellyLine], [1, c.genome.threshold, c.genome.warp, c.genome.bellyLine]);
  const L = skin.coatLayers, n = skin.vertexCount;
  assert.deepEqual([L.c0.length, L.c1.length, L.c2.length, L.sample.length], [3 * n, 3 * n, 3 * n, 4 * n]);
  // a vertex whose layers coincide (no own coat sample, not a cap copy) shades exactly with its vertex colour
  let fallback = 0;
  for (let v = 0; v < n; v++) {
    const same = [0, 1, 2].every(k => L.c0[3 * v + k] === L.c1[3 * v + k] && L.c1[3 * v + k] === L.c2[3 * v + k]);
    if (!same) continue;
    fallback++;
    for (let k = 0; k < 3; k++) assert.equal(L.c0[3 * v + k], skin.colors[3 * v + k], `${v}`);
  }
  assert.ok(fallback > 0 && skin.debug.coatVertex.own.some(Boolean));
  for (const pattern of ['plain', 'saddle', 'piebald', 'roan', 'dorsal-stripe']) {
    const plain = skinOf({...composerPreset('giraffe'), pattern});
    assert.equal(plain.coatCrisp, null, pattern); assert.equal(plain.coatLayers, null, pattern);
  }
});

/** Every crisp vertex: the shader formula with the vertex's own CPU mask (coatPatternProbe at the vertex's exact
 * sample, the clamped scale the vertex colours use) gives the vertex colour. Returns [checked, crisp, maxErr]. */
function vertexEquality(skin) {
  const {own, sample} = skin.debug.coatVertex, L = skin.coatLayers, genome = {...skin.coatCrisp.genome, scale: skin.coatScale.effective};
  const probe = new Float64Array(5), lo = 0.002, hi = 1;
  let checked = 0, crisp = 0, maxErr = 0;
  for (let v = 0; v < skin.vertexCount; v++) {
    if (!own[v]) continue;
    crisp++;
    const layers = [L.c0, L.c1, L.c2].flatMap(a => [a[3 * v], a[3 * v + 1], a[3 * v + 2]]);
    const colour = [skin.colors[3 * v], skin.colors[3 * v + 1], skin.colors[3 * v + 2]];
    if ([...layers, ...colour].some(x => x <= lo || x >= hi)) continue;
    const q = sample.subarray(6 * v, 6 * v + 6);
    coatPatternProbe(genome, {x: q[0], y: q[1], z: q[2], dorsal: q[3], region: COAT_REGIONS[skin.regions[v]], along: q[4], footprint: q[5]}, probe);
    const m = probe[0], p = probe[4];
    for (let k = 0; k < 3; k++) {
      const a0 = layers[k], a1 = layers[3 + k], a2 = layers[6 + k];
      maxErr = Math.max(maxErr, Math.abs(a0 + m * (a1 - a0) + m * p * (a2 - a1) - colour[k]));
    }
    checked++;
  }
  return [checked, crisp, maxErr];
}

test('layers are exact: the shader formula at every crisp vertex reproduces its vertex colour (<= 2e-6, >= 95 % checked)', () => {
  const bodies = [
    // pre-registered: the two metric (a) bodies, >= 95 % of their crisp vertices away from the clamp bounds
    ['giraffe', 'spots', 0.3, 0.95], ['dinosaur', 'reticulated', 0.3, 0.95],
    // extra coverage (not pre-registered): every crisp pattern on a full-size body. The plumage accent has a zero
    // blue channel, so about half of the bird's mask-1 layers sit on the 0.002 floor and are not checked there.
    ['giraffe', 'rosettes', 1, 0.95], ['rhinoceros', 'dapple', 1, 0.95], ['ape', 'stripes', 1, 0.95], ['turtle', 'bands', 1, 0.95], ['bird', 'brindle', 1, 0.4], ['trunked-centipede', 'spots', 1, 0.95],
    // step 3: dichromatic males (the darkening map, and the accent wash of a dark ink coat) keep the layers exact
    ['giraffe', 'spots', 1, 0.95, MALE], ['ape', 'stripes', 1, 0.95, MALE],
  ];
  for (const [preset, pattern, bodyLength, share, extra = {}] of bodies) {
    const skin = skinOf({...composerPreset(preset), pattern, bodyLength, ...extra});
    const [checked, crisp, maxErr] = vertexEquality(skin);
    assert.ok(crisp > 500, `${preset}/${pattern}: ${crisp} crisp vertices`);
    assert.ok(checked >= share * crisp, `${preset}/${pattern}: ${checked}/${crisp} away from the clamp bounds`);
    assert.ok(maxErr <= 2e-6, `${preset}/${pattern}: max error ${maxErr}`);
    if (process.env.COAT_CRISP_REPORT) console.log('vertex-equality', preset, pattern, bodyLength, checked, crisp, maxErr);
  }
});

// ------------------------------------------------------------------ metric (a): pattern frequency on small bodies
/** Orthographic CPU raster of the torso part seen from the animal's left (-z, camera looking +z) at 1024 pixels per
 * body length; per pixel the nearest triangle and its barycentrics. */
function rasterTorso(skin) {
  const ppl = 1024 / skin.coatCrisp.frame.scale, P = skin.positions, part = skin.parts.find(p => p.part === 'torso');
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let t = part.firstTriangle; t < part.firstTriangle + part.triangles; t++) for (let k = 0; k < 3; k++) {
    const v = skin.index[3 * t + k]; x0 = Math.min(x0, P[3 * v]); x1 = Math.max(x1, P[3 * v]); y0 = Math.min(y0, P[3 * v + 1]); y1 = Math.max(y1, P[3 * v + 1]);
  }
  const W = Math.ceil((x1 - x0) * ppl) + 2, H = Math.ceil((y1 - y0) * ppl) + 2;
  const depth = new Float64Array(W * H).fill(Infinity), tri = new Int32Array(W * H).fill(-1), bary = new Float64Array(W * H * 3);
  const px = v => (P[3 * v] - x0) * ppl, py = v => (y1 - P[3 * v + 1]) * ppl;
  for (let t = part.firstTriangle; t < part.firstTriangle + part.triangles; t++) {
    const a = skin.index[3 * t], b = skin.index[3 * t + 1], c = skin.index[3 * t + 2];
    const ax = px(a), ay = py(a), bx = px(b), by = py(b), cx = px(c), cy = py(c);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    for (let j = Math.max(0, Math.floor(Math.min(ay, by, cy))); j <= Math.min(H - 1, Math.ceil(Math.max(ay, by, cy))); j++) {
      for (let i = Math.max(0, Math.floor(Math.min(ax, bx, cx))); i <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))); i++) {
        const x = i + 0.5, y = j + 0.5;
        const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area, wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area, wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        const z = wa * P[3 * a + 2] + wb * P[3 * b + 2] + wc * P[3 * c + 2], o = j * W + i;
        if (z < depth[o]) { depth[o] = z; tri[o] = t; bary[3 * o] = wa; bary[3 * o + 1] = wb; bary[3 * o + 2] = wc; }
      }
    }
  }
  return {W, H, tri, bary, x0, y1, ppl};
}
/** Luminance of the vertex-colour value and the crisp value (CPU twin of the fragment shader) per pixel in a window. */
function flankSignals(skin) {
  const R = rasterTorso(skin), torsoRegion = COAT_REGIONS.indexOf('torso'), P = skin.positions;
  // the torso region's extent: columns over its central 60 %, rows over the middle 20 % of its height
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let v = 0; v < skin.vertexCount; v++) if (skin.regions[v] === torsoRegion) { x0 = Math.min(x0, P[3 * v]); x1 = Math.max(x1, P[3 * v]); y0 = Math.min(y0, P[3 * v + 1]); y1 = Math.max(y1, P[3 * v + 1]); }
  const col = x => Math.round((x - R.x0) * R.ppl), row = y => Math.round((R.y1 - y) * R.ppl);
  const c0 = col(x0 + 0.2 * (x1 - x0)), c1 = col(x0 + 0.8 * (x1 - x0)), r0 = row(y0 + 0.6 * (y1 - y0)), r1 = row(y0 + 0.4 * (y1 - y0));
  const genome = skin.coatCrisp.genome, L = skin.coatLayers, probe = new Float64Array(5), fp = 1 / 1024;
  const crispRows = [], vertexRows = [];
  for (let j = r0; j <= r1; j++) {
    const cr = [], vr = [];
    for (let i = c0; i < c1; i++) {
      const o = j * R.W + i, t = R.tri[o];
      if (t < 0) break;
      const vs = [skin.index[3 * t], skin.index[3 * t + 1], skin.index[3 * t + 2]], w = [R.bary[3 * o], R.bary[3 * o + 1], R.bary[3 * o + 2]];
      const at = (arr, n, k) => w[0] * arr[n * vs[0] + k] + w[1] * arr[n * vs[1] + k] + w[2] * arr[n * vs[2] + k];
      vr.push(lum(at(skin.colors, 3, 0), at(skin.colors, 3, 1), at(skin.colors, 3, 2)));
      coatPatternProbe(genome, {x: at(L.sample, 4, 0), y: at(L.sample, 4, 1), z: at(L.sample, 4, 2), dorsal: Math.max(-1, Math.min(1, at(L.sample, 4, 3))), region: 'torso', along: 0, footprint: fp}, probe);
      const m = probe[0], p = probe[4], ch = k => { const a0 = at(L.c0, 3, k), a1 = at(L.c1, 3, k), a2 = at(L.c2, 3, k); return Math.min(1, Math.max(0, a0 + m * (a1 - a0) + m * p * (a2 - a1))); };
      cr.push(lum(ch(0), ch(1), ch(2)));
    }
    if (cr.length === c1 - c0) { crispRows.push(cr); vertexRows.push(vr); }
  }
  return {crispRows, vertexRows, N: c1 - c0};
}
/** Dominant frequency (cycles per body length) of the mean DFT power spectrum of the rows, bins 2 and up. */
function dominantFrequency(rows, N) {
  const power = new Float64Array((N >> 1) + 1);
  for (const row of rows) {
    const mean = row.reduce((a, b) => a + b, 0) / N;
    for (let k = 2; k <= N >> 1; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) { const a = -2 * Math.PI * k * i / N, v = row[i] - mean; re += v * Math.cos(a); im += v * Math.sin(a); }
      power[k] += (re * re + im * im) / rows.length;
    }
  }
  let best = 2;
  for (let k = 3; k <= N >> 1; k++) if (power[k] > power[best]) best = k;
  return best * 1024 / N;
}

test('metric (a): the requested pattern scale sets the crisp frequency on small bodies; the vertex path cannot (negative case)', () => {
  const result = {};
  for (const [preset, pattern] of [['giraffe', 'spots'], ['dinosaur', 'reticulated']]) {
    const f = {};
    for (const patternScale of [1, 2]) {
      const skin = skinOf({...composerPreset(preset), pattern, bodyLength: 0.3, patternScale});
      const sig = flankSignals(skin);
      assert.ok(sig.crispRows.length >= 8, `${preset}: ${sig.crispRows.length} full rows`);
      f[patternScale] = {crisp: dominantFrequency(sig.crispRows, sig.N), vertex: dominantFrequency(sig.vertexRows, sig.N), rows: sig.crispRows.length, N: sig.N};
    }
    const crisp = f[2].crisp / f[1].crisp, vertex = f[2].vertex / f[1].vertex;
    result[preset] = {pattern, ...f, crispRatio: crisp, vertexRatio: vertex};
    assert.ok(crisp >= 1.5, `${preset}/${pattern}: crisp ratio ${crisp} (${JSON.stringify(f)})`);
    assert.ok(vertex < 1.5, `${preset}/${pattern}: negative case, vertex ratio ${vertex} (${JSON.stringify(f)})`);
  }
  if (process.env.COAT_CRISP_REPORT) console.log(JSON.stringify(result));
});

// ------------------------------------------------------------------ the material
test('crisp shader patch: applies once on three\'s standard program after the gloss patch, refuses a second time', () => {
  const shader = {vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {}};
  patchComposerGlossShader(shader);
  patchComposerCoatCrispShader(shader, {code: 3});
  assert.ok(shader.fragmentShader.startsWith('#define COAT_PATTERN 3\n'));
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb *= composerCoatCrisp();') && !shader.fragmentShader.includes('#include <color_fragment>'));
  assert.ok(shader.vertexShader.includes('vCoatSample = coatSample;') && shader.vertexShader.includes('vComposerGloss = composerGloss;'));
  assert.throws(() => patchComposerCoatCrispShader(shader, {code: 3}), /already patched/);
});

test('createComposerCreature: a crisp coat gets the layer attributes and the crisp material; a plain coat keeps the gloss material', () => {
  const crisp = createComposerCreature({...composerPreset('giraffe'), pattern: 'reticulated'});
  try {
    const g = crisp.mesh.geometry, m = crisp.mesh.material;
    for (const name of ['coatL0', 'coatL1', 'coatL2', 'coatSample']) assert.ok(g.getAttribute(name), name);
    assert.equal(m.customProgramCacheKey(), `${COMPOSER_GLOSS_CACHE_KEY}+${COMPOSER_COAT_CRISP_VERSION}/reticulated`);
    assert.deepEqual(m.userData.composerCoatCrisp, {version: COMPOSER_COAT_CRISP_VERSION, pattern: 'reticulated'});
    // the vertex colours (the GLB export's colours) are still there
    assert.ok(g.getAttribute('color'));
  } finally { crisp.dispose(); }
  const plain = createComposerCreature({...composerPreset('giraffe'), pattern: 'plain'});
  try {
    assert.equal(plain.mesh.geometry.getAttribute('coatL0'), undefined);
    assert.equal(plain.mesh.material.customProgramCacheKey(), COMPOSER_GLOSS_CACHE_KEY);
  } finally { plain.dispose(); }
});

// ------------------------------------------------------------------ metric (b): sexual dichromatism
/** CIE76 Lab (D65) of a linear-RGB colour. */
const labOf = ([r, g, b]) => {
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const TORSO = COAT_REGIONS.indexOf('torso');
const torsoMean = skin => {
  const m = [0, 0, 0]; let n = 0;
  for (let v = 0; v < skin.vertexCount; v++) if (skin.regions[v] === TORSO) { for (let k = 0; k < 3; k++) m[k] += skin.colors[3 * v + k]; n++; }
  return m.map(x => x / n);
};
const sexSkin = (preset, sex, dimorphism, individualSeed = 7) => {
  const recipe = normalizeComposerRecipe({...composerPreset(preset), sex, dimorphism, individualSeed, variability: 0, maturity: 1, condition: 0}).recipe;
  const derived = deriveComposerIndividual(recipe);
  return {skin: buildComposerSkin(buildComposerGraph(derived.recipe)), sex: derived.traits.sex, palette: recipe.palette};
};
const deltaE = (a, b) => { const p = labOf(torsoMean(a)), q = labOf(torsoMean(b)); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const colourDigest = skin => createHash('sha256').update(Buffer.from(skin.colors.buffer, skin.colors.byteOffset, skin.colors.byteLength)).digest('hex').slice(0, 16);

/** dE (male vs female, dimorphism 1, individualSeed 7, variability 0, maturity 1, condition 0) per preset, pinned at
 * 1e-6 (pre-registered metric b). */
const DICHROMATISM_DE_PINS = {dinosaur: 9.01249016036704, turtle: 7.824128637621952, giraffe: 8.176930110350218, bird: 35.18368016177891, ostrich: 11.108633687985092, rhinoceros: 9.019165940473389, ape: 9.784564835309515, worm: 5.959898681917788, centipede: 6.271398108322732, 'shelled-giraffe-bird': 8.428803391822855, 'trunked-centipede': 6.9229743932803895, 'winged-ape-rhino': 7.5542351883197};
/** `<resolved sex>:<colour digest>` of female, sexless (type specimen) and dimorphism-0 male builds as at 819be67
 * (step 2, before dichromatism): metric (b) requires that they do not change. Step 4 moved vertices (the neck-to-head
 * blend fold fix: giraffe, ostrich, ape, shelled-giraffe-bird; the trunk: trunked-centipede), so those 20 pins were
 * re-captured from the step-4 build and checked byte-equal to the same build with the dichromatism term removed
 * (docs/fauna-coat-crisp-v1.md, step 4 ledger); the other 28 are unchanged since 819be67. */
const UNCHANGED_COLOUR_PINS = {
  'dinosaur/female-1': 'female:b2d32bb65d6543cb',
  'dinosaur/female-0.5': 'female:b2d32bb65d6543cb',
  'dinosaur/none': 'none:b2d32bb65d6543cb',
  'dinosaur/male-0': 'male:b2d32bb65d6543cb',
  'turtle/female-1': 'female:73768b9fdebdc622',
  'turtle/female-0.5': 'female:73768b9fdebdc622',
  'turtle/none': 'none:73768b9fdebdc622',
  'turtle/male-0': 'male:73768b9fdebdc622',
  'giraffe/female-1': 'female:0a2d66732ebef180',
  'giraffe/female-0.5': 'female:17897264bdbb6715',
  'giraffe/none': 'none:49f55d0163213cd1',
  'giraffe/male-0': 'male:49f55d0163213cd1',
  'bird/female-1': 'female:923509841fb37105',
  'bird/female-0.5': 'female:923509841fb37105',
  'bird/none': 'none:923509841fb37105',
  'bird/male-0': 'male:923509841fb37105',
  'ostrich/female-1': 'female:28124ff34972dd02',
  'ostrich/female-0.5': 'female:28124ff34972dd02',
  'ostrich/none': 'none:28124ff34972dd02',
  'ostrich/male-0': 'male:28124ff34972dd02',
  'rhinoceros/female-1': 'female:bbc0a4d77f5c9fce',
  'rhinoceros/female-0.5': 'female:a327f8147c6fb573',
  'rhinoceros/none': 'none:fb23351b96d10b39',
  'rhinoceros/male-0': 'male:fb23351b96d10b39',
  'ape/female-1': 'female:f7cbbab79d014305',
  'ape/female-0.5': 'female:f7cbbab79d014305',
  'ape/none': 'none:f7cbbab79d014305',
  'ape/male-0': 'male:f7cbbab79d014305',
  'worm/female-1': 'female:b192a7e4ae2f0b11',
  'worm/female-0.5': 'female:b192a7e4ae2f0b11',
  'worm/none': 'none:b192a7e4ae2f0b11',
  'worm/male-0': 'male:b192a7e4ae2f0b11',
  'centipede/female-1': 'female:ba058bdae8bb65fd',
  'centipede/female-0.5': 'female:ba058bdae8bb65fd',
  'centipede/none': 'none:ba058bdae8bb65fd',
  'centipede/male-0': 'male:ba058bdae8bb65fd',
  'shelled-giraffe-bird/female-1': 'female:886d6140940b487b',
  'shelled-giraffe-bird/female-0.5': 'female:886d6140940b487b',
  'shelled-giraffe-bird/none': 'none:886d6140940b487b',
  'shelled-giraffe-bird/male-0': 'male:886d6140940b487b',
  'trunked-centipede/female-1': 'female:7f51c8e62852ee07',
  'trunked-centipede/female-0.5': 'female:7f51c8e62852ee07',
  'trunked-centipede/none': 'none:7f51c8e62852ee07',
  'trunked-centipede/male-0': 'male:7f51c8e62852ee07',
  'winged-ape-rhino/female-1': 'female:88fd26785bcf282f',
  'winged-ape-rhino/female-0.5': 'female:88fd26785bcf282f',
  'winged-ape-rhino/none': 'none:88fd26785bcf282f',
  'winged-ape-rhino/male-0': 'male:88fd26785bcf282f',
};

test('metric (b): dichromatism dE >= 12 (plumage) / >= 5 at dimorphism 1, >= 0.4 x that at 0.5, exactly 0 and bitwise at 0', () => {
  const report = {};
  for (const preset of Object.keys(DICHROMATISM_DE_PINS)) {
    const m1 = sexSkin(preset, 'male', 1), f1 = sexSkin(preset, 'female', 1);
    const m5 = sexSkin(preset, 'male', 0.5), f5 = sexSkin(preset, 'female', 0.5);
    const m0 = sexSkin(preset, 'male', 0), f0 = sexSkin(preset, 'female', 0);
    assert.equal(m1.sex, 'male'); assert.equal(f1.sex, 'female');
    const d1 = deltaE(m1.skin, f1.skin), d5 = deltaE(m5.skin, f5.skin), d0 = deltaE(m0.skin, f0.skin);
    report[preset] = {palette: m1.palette, d1, d5, d0};
    assert.ok(d1 >= (m1.palette === 'plumage' ? 12 : 5), `${preset} (${m1.palette}): dE ${d1} at dimorphism 1`);
    assert.ok(d5 >= 0.4 * d1, `${preset}: dE ${d5} at dimorphism 0.5 < 0.4 x ${d1}`);
    assert.equal(d0, 0, `${preset}: dE ${d0} at dimorphism 0`);
    assert.deepEqual(m0.skin.colors, f0.skin.colors, `${preset}: dimorphism 0 colours bitwise equal`);
    assert.ok(Math.abs(d1 - DICHROMATISM_DE_PINS[preset]) <= 1e-6, `${preset}: dE ${d1} != pin ${DICHROMATISM_DE_PINS[preset]}`);
  }
  if (process.env.COAT_CRISP_REPORT) console.log('dichromatism', JSON.stringify(report));
});

test('metric (b): female, sexless and dimorphism-0 male colours are byte-identical to before dichromatism (negative: a male differs)', () => {
  const runs = {'female-1': ['female', 1, 7], 'female-0.5': ['female', 0.5, 7], none: ['auto', 1, 0], 'male-0': ['male', 0, 7]};
  for (const [key, pin] of Object.entries(UNCHANGED_COLOUR_PINS)) {
    const [preset, tag] = key.split('/');
    const [sex, dimorphism, seed] = runs[tag];
    const built = sexSkin(preset, sex, dimorphism, seed);
    assert.equal(`${built.sex}:${colourDigest(built.skin)}`, pin, key);
  }
  // negative case: a dimorphism-1 male differs from its pinned female, so the digest check can fail
  const male = sexSkin('giraffe', 'male', 1);
  assert.notEqual(`female:${colourDigest(male.skin)}`, UNCHANGED_COLOUR_PINS['giraffe/female-1']);
});

// ------------------------------------------------------------------ metric (c): welded seam normals
const SPECIMENS = JSON.parse(readFileSync(new URL('./fauna-face-specimens.json', import.meta.url), 'utf8')).specimens;
const specimenRecipe = name => name.startsWith('preset-') ? composerPreset(name.slice(7)) : decodeComposerRecipe(SPECIMENS.find(s => s.name === name).text).recipe;
const debugSkin = recipe => buildComposerSkin(buildComposerGraph(deriveComposerIndividual(normalizeComposerRecipe(recipe).recipe).recipe), {debug: true});
/** three's computeVertexNormals on the skin's positions and index (the shipped normals before skin-5). */
const threeNormals = skin => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(skin.positions, 3)); g.setIndex(new THREE.BufferAttribute(skin.index, 1));
  g.computeVertexNormals();
  return g.getAttribute('normal').array;
};
/** Welded groups (bitwise Float32 positions, equal skin indices and weights, outside the eyes part) and, per group,
 * the largest normal angle, plus per member the dot of the normal with its own visible (non-hidden) incident faces. */
const seamReport = (skin, normals) => {
  const P = skin.positions, I = skin.index, nv = skin.vertexCount, nt = I.length / 3, hidden = skin.debug.hiddenTriangles;
  const eye = new Uint8Array(nv), vis = new Float64Array(nv * 3);
  for (const p of skin.parts) if (p.part === 'eyes') for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) eye[I[i]] = 1;
  for (let t = 0; t < nt; t++) {
    if (hidden[t]) continue;
    const [a, b, c] = [I[3 * t], I[3 * t + 1], I[3 * t + 2]];
    const u = [0, 1, 2].map(i => P[3 * c + i] - P[3 * b + i]), w = [0, 1, 2].map(i => P[3 * a + i] - P[3 * b + i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, c]) for (let i = 0; i < 3; i++) vis[3 * v + i] += n[i];
  }
  const pb = new Uint32Array(P.buffer, P.byteOffset, nv * 3), wb = new Uint32Array(skin.skinWeight.buffer, skin.skinWeight.byteOffset, nv * 4);
  const groups = new Map();
  for (let v = 0; v < nv; v++) {
    if (eye[v]) continue;
    const key = [...pb.subarray(3 * v, 3 * v + 3), ...skin.skinIndex.subarray(4 * v, 4 * v + 4), ...wb.subarray(4 * v, 4 * v + 4)].join(',');
    const g = groups.get(key); if (g) g.push(v); else groups.set(key, [v]);
  }
  let count = 0, maxAngle = 0, minDot = Infinity, bitwise = true;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    count++;
    for (const v of g) for (const w of g) if (w > v) {
      const same = [0, 1, 2].every(i => normals[3 * v + i] === normals[3 * w + i]);
      if (!same) bitwise = false;
      const d = normals[3 * v] * normals[3 * w] + normals[3 * v + 1] * normals[3 * w + 1] + normals[3 * v + 2] * normals[3 * w + 2];
      maxAngle = Math.max(maxAngle, same ? 0 : Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
    }
    for (const v of g) {
      const l = Math.hypot(vis[3 * v], vis[3 * v + 1], vis[3 * v + 2]);
      if (l > 0) minDot = Math.min(minDot, (vis[3 * v] * normals[3 * v] + vis[3 * v + 1] * normals[3 * v + 1] + vis[3 * v + 2] * normals[3 * v + 2]) / l);
    }
  }
  return {count, maxAngle, minDot, bitwise};
};

test('metric (c): every welded seam group shares one bitwise normal that faces out of its visible faces (all presets, all face specimens)', () => {
  const report = {};
  let worstDot = Infinity;
  for (const name of [...COMPOSER_PRESET_IDS.map(id => `preset-${id}`), ...SPECIMENS.map(s => s.name)]) {
    const skin = debugSkin(specimenRecipe(name)), r = seamReport(skin, skin.normals);
    assert.ok(r.bitwise && r.maxAngle === 0, `${name}: welded normals differ by ${r.maxAngle} deg`);
    assert.ok(r.count === 0 || r.minDot > 0.5, `${name}: a welded normal is ${r.minDot} off its visible faces`);
    worstDot = Math.min(worstDot, r.minDot);
    report[name] = r.count;
  }
  if (process.env.COAT_CRISP_REPORT) console.log('seam groups', JSON.stringify({worstDot, groups: report}));
});

test('metric (c) negative case: three\'s computeVertexNormals (the shipped normals before skin-5) splits the seams by > 10 deg', () => {
  const out = {};
  for (const name of ['preset-giraffe', 'preset-trunked-centipede', 'custom-rhinoceros-trunk']) {
    const skin = debugSkin(specimenRecipe(name)), r = seamReport(skin, threeNormals(skin));
    out[name] = r.maxAngle;
    assert.ok(r.maxAngle > 10, `${name}: ${r.maxAngle} deg`);
  }
  if (process.env.COAT_CRISP_REPORT) console.log('seam negative', JSON.stringify(out));
});

test('metric (c) flags: hidden end caps lie inside another closed shell; head start caps reported (all presets, all face specimens)', () => {
  // independent of the construction flags: a hidden face's centroid, nudged 0.005 x its two edge lengths along its
  // outward normal, must lie inside another connected shell (ray parity per shell, eyes excluded). The axial end cap
  // (inside the head) and the trunk's inset discs must pass everywhere. The head's start cap (hidden=1, closing the head
  // loft at its welded first ring) pokes out of the throat of a sharply bent neck: reported, not gated (doc step 4).
  const D = [0.5773, 0.6123, 0.5401], report = {};
  for (const name of [...COMPOSER_PRESET_IDS.map(id => `preset-${id}`), ...SPECIMENS.map(s => s.name)]) {
    const skin = debugSkin(specimenRecipe(name)), P = skin.positions, I = skin.index, hidden = skin.debug.hiddenTriangles, nt = I.length / 3;
    const vtx = v => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
    const parent = Int32Array.from({length: skin.vertexCount}, (_, i) => i), find = x => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
    for (let t = 0; t < nt; t++) { const r = find(I[3 * t]); parent[find(I[3 * t + 1])] = r; parent[find(I[3 * t + 2])] = r; }
    const partOf = new Int32Array(nt);
    skin.parts.forEach((p, k) => { for (let t = p.firstTriangle; t < p.firstTriangle + p.triangles; t++) partOf[t] = k; });
    const shells = new Map();
    for (let t = 0; t < nt; t++) if (skin.parts[partOf[t]].part !== 'eyes') { const r = find(I[3 * t]); if (shells.has(r)) shells.get(r).push(t); else shells.set(r, [t]); }
    const inside = (q, tris) => {
      let hits = 0;
      for (const t of tris) {
        const [a, b, c] = [I[3 * t], I[3 * t + 1], I[3 * t + 2]].map(vtx), e1 = b.map((x, i) => x - a[i]), e2 = c.map((x, i) => x - a[i]);
        const h = [D[1] * e2[2] - D[2] * e2[1], D[2] * e2[0] - D[0] * e2[2], D[0] * e2[1] - D[1] * e2[0]], det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
        if (Math.abs(det) < 1e-18) continue;
        const f = 1 / det, s = q.map((x, i) => x - a[i]), u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
        if (u < 0 || u > 1) continue;
        const qq = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = f * (D[0] * qq[0] + D[1] * qq[1] + D[2] * qq[2]);
        if (v < 0 || u + v > 1) continue;
        if (f * (e2[0] * qq[0] + e2[1] * qq[1] + e2[2] * qq[2]) > 0) hits++;
      }
      return hits % 2 === 1;
    };
    let n = 0, headOut = 0;
    for (let t = 0; t < nt; t++) {
      if (!hidden[t]) continue;
      n++;
      const [a, b, c] = [I[3 * t], I[3 * t + 1], I[3 * t + 2]].map(vtx), e1 = b.map((x, i) => x - a[i]), e2 = c.map((x, i) => x - a[i]);
      const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...nrm);
      const q = [0, 1, 2].map(i => (a[i] + b[i] + c[i]) / 3 + nrm[i] / l * 0.005 * (Math.hypot(...e1) + Math.hypot(...e2)));
      const own = find(I[3 * t]), part = skin.parts[partOf[t]].part;
      if ([...shells].some(([r, tris]) => r !== own && inside(q, tris))) continue;
      assert.equal(part, 'head', `${name}: a hidden ${part} face (triangle ${t}) lies outside every other shell`);
      headOut++;
    }
    assert.ok(n > 0, `${name}: hidden faces`);
    if (headOut) report[name] = headOut;
  }
  if (process.env.COAT_CRISP_REPORT) console.log('head start caps outside the neck', JSON.stringify(report));
});

// ------------------------------------------------------------------ metric (d): trunk centreline and tip
const TRUNK_SPECIMENS = ['preset-trunked-centipede', 'custom-giraffe-trunk', 'custom-rhinoceros-trunk', 'plausible-pachyderm-1'];
const TRUNK_LEGACY_HEAD_GROUP = {'preset-trunked-centipede': 3072, 'custom-giraffe-trunk': 3120, 'custom-rhinoceros-trunk': 3120, 'plausible-pachyderm-1': 3120};

test('metric (d2): the largest centreline turn between consecutive trunk rings is <= 8 deg (baseline 10.0 .. 13.2)', () => {
  const out = {};
  for (const name of TRUNK_SPECIMENS) {
    const skin = debugSkin(specimenRecipe(name)), R = skin.debug.rings.filter(r => r.chain === 'trunk');
    assert.ok(R.length > 10, `${name}: ${R.length} trunk rings`);
    let max = 0;
    for (let i = 1; i + 1 < R.length; i++) {
      const u = R[i].centre.map((x, k) => x - R[i - 1].centre[k]), v = R[i + 1].centre.map((x, k) => x - R[i].centre[k]);
      max = Math.max(max, Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)))) * 180 / Math.PI);
    }
    out[name] = max;
    assert.ok(max <= 8, `${name}: centreline turn ${max} deg`);
  }
  if (process.env.COAT_CRISP_REPORT) console.log('trunk turn', JSON.stringify(out));
});

test('metric (d3): the trunk tip rolls in to a small end face (flat-cap ratio <= 0.6, >= 2 narrower rings) and is closed; budget kept', () => {
  const out = {};
  for (const name of TRUNK_SPECIMENS) {
    const recipe = normalizeComposerRecipe(specimenRecipe(name)).recipe, graph = buildComposerGraph(deriveComposerIndividual(recipe).recipe);
    const skin = buildComposerSkin(graph, {debug: true}), P = skin.positions, I = skin.index;
    const tb = graph.bones[graph.chains.trunk[graph.chains.trunk.length - 1]], q = new THREE.Quaternion(...tb.restQuaternion);
    const tx = new THREE.Vector3(1, 0, 0).applyQuaternion(q), c0 = new THREE.Vector3(...tb.restPosition).addScaledVector(tx, tb.length);
    const R = skin.debug.rings.filter(r => r.chain === 'trunk'), last = R[R.length - 1], r = Math.max(last.rx, last.ry);
    const trunk = skin.parts.filter(p => p.part === 'trunk');
    // radius of the tip surface at each lip station: median distance from the tip axis of the vertices on that plane
    const radiusAt = x => {
      const d = [];
      for (const p of trunk) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) {
        const v = new THREE.Vector3(P[3 * I[i]], P[3 * I[i] + 1], P[3 * I[i] + 2]).sub(c0), along = v.dot(tx);
        if (Math.abs(along - x * r) <= 1e-5 * r) d.push(v.addScaledVector(tx, -along).length());
      }
      d.sort((a, b) => a - b);
      return d.length ? d[d.length >> 1] : NaN;
    };
    const stations = [0, ...TRUNK_TIP.bulb.map(([x]) => x)], radii = stations.map(radiusAt), face = radiusAt(TRUNK_TIP.faceAt);
    const widest = Math.max(...radii), iw = radii.indexOf(widest), narrower = radii.slice(iw + 1).filter(x => x < widest).length;
    const ratio = face / widest;
    assert.ok(radii.every(Number.isFinite) && Number.isFinite(face), `${name}: tip stations ${radii} / ${face}`);
    assert.ok(ratio <= 0.6, `${name}: flat-cap ratio ${ratio}`);
    assert.ok(narrower >= 2 && radii.slice(iw + 1).every((x, i, a) => x < (i ? a[i - 1] : widest)), `${name}: roll-in ${radii.map(x => (x / r).toFixed(3))}`);
    // closed: welding the trunk part by bitwise position, every boundary edge lies in the plane of the join ring (the
    // trunk's open start and its hidden disc, inside the muzzle); the tip end leaves no boundary
    const pb = new Uint32Array(P.buffer, P.byteOffset, P.length), key = v => `${pb[3 * v]},${pb[3 * v + 1]},${pb[3 * v + 2]}`, edges = new Map();
    for (const p of trunk) for (let t = p.firstTriangle; t < p.firstTriangle + p.triangles; t++) for (let k = 0; k < 3; k++) {
      const a = key(I[3 * t + k]), b = key(I[3 * t + (k + 1) % 3]), e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    const j0 = new THREE.Vector3(...R[0].centre), jt = new THREE.Vector3(...R[0].tangent).normalize();
    let open = 0, stray = 0;
    for (const [e, n] of edges) {
      if (n !== 1) continue;
      open++;
      for (const k of e.split('|')) { const f = new Float32Array(new Uint32Array(k.split(',').map(Number)).buffer); if (Math.abs(new THREE.Vector3(f[0], f[1], f[2]).sub(j0).dot(jt)) > 1e-4 * r) stray++; }
    }
    assert.ok(open > 0 && stray === 0, `${name}: ${stray} boundary edge ends off the join plane (${open} boundary edges)`);
    const HG = new Set(['head', 'eyes', 'mouth', 'horn', 'trunk']), group = skin.parts.filter(p => HG.has(p.part)).reduce((a, p) => a + p.triangles, 0);
    assert.ok(group <= TRUNK_LEGACY_HEAD_GROUP[name] + 800, `${name}: proboscis head group ${group}`);
    out[name] = {ratio, radii: radii.map(x => x / r), face: face / r, narrower, headGroup: group, triangles: skin.triangleCount};
  }
  if (process.env.COAT_CRISP_REPORT) console.log('trunk tip', JSON.stringify(out));
});
