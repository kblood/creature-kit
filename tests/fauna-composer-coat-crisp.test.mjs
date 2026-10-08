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
import {composerPreset, normalizeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {COMPOSER_COAT_CRISP_PATTERNS, COMPOSER_COAT_CRISP_VERSION, buildComposerSkin} from '../src/fauna-composer-mesh.ts';
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
 * (step 2, before dichromatism): metric (b) requires that they do not change. */
const UNCHANGED_COLOUR_PINS = {
  'dinosaur/female-1': 'female:b2d32bb65d6543cb',
  'dinosaur/female-0.5': 'female:b2d32bb65d6543cb',
  'dinosaur/none': 'none:b2d32bb65d6543cb',
  'dinosaur/male-0': 'male:b2d32bb65d6543cb',
  'turtle/female-1': 'female:73768b9fdebdc622',
  'turtle/female-0.5': 'female:73768b9fdebdc622',
  'turtle/none': 'none:73768b9fdebdc622',
  'turtle/male-0': 'male:73768b9fdebdc622',
  'giraffe/female-1': 'female:4c475ff4f63f4581',
  'giraffe/female-0.5': 'female:3593f7465e4fa7ba',
  'giraffe/none': 'none:94ebfe01f884a182',
  'giraffe/male-0': 'male:94ebfe01f884a182',
  'bird/female-1': 'female:923509841fb37105',
  'bird/female-0.5': 'female:923509841fb37105',
  'bird/none': 'none:923509841fb37105',
  'bird/male-0': 'male:923509841fb37105',
  'ostrich/female-1': 'female:f60416d30e536778',
  'ostrich/female-0.5': 'female:f60416d30e536778',
  'ostrich/none': 'none:f60416d30e536778',
  'ostrich/male-0': 'male:f60416d30e536778',
  'rhinoceros/female-1': 'female:bbc0a4d77f5c9fce',
  'rhinoceros/female-0.5': 'female:a327f8147c6fb573',
  'rhinoceros/none': 'none:fb23351b96d10b39',
  'rhinoceros/male-0': 'male:fb23351b96d10b39',
  'ape/female-1': 'female:91f9f64c0ed4ccf3',
  'ape/female-0.5': 'female:91f9f64c0ed4ccf3',
  'ape/none': 'none:91f9f64c0ed4ccf3',
  'ape/male-0': 'male:91f9f64c0ed4ccf3',
  'worm/female-1': 'female:b192a7e4ae2f0b11',
  'worm/female-0.5': 'female:b192a7e4ae2f0b11',
  'worm/none': 'none:b192a7e4ae2f0b11',
  'worm/male-0': 'male:b192a7e4ae2f0b11',
  'centipede/female-1': 'female:ba058bdae8bb65fd',
  'centipede/female-0.5': 'female:ba058bdae8bb65fd',
  'centipede/none': 'none:ba058bdae8bb65fd',
  'centipede/male-0': 'male:ba058bdae8bb65fd',
  'shelled-giraffe-bird/female-1': 'female:c0d118cfb3cf59b9',
  'shelled-giraffe-bird/female-0.5': 'female:c0d118cfb3cf59b9',
  'shelled-giraffe-bird/none': 'none:c0d118cfb3cf59b9',
  'shelled-giraffe-bird/male-0': 'male:c0d118cfb3cf59b9',
  'trunked-centipede/female-1': 'female:27e370cf20970ee1',
  'trunked-centipede/female-0.5': 'female:27e370cf20970ee1',
  'trunked-centipede/none': 'none:27e370cf20970ee1',
  'trunked-centipede/male-0': 'male:27e370cf20970ee1',
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
