// fauna-coat-1: pure deterministic coat-field library (WP1 acceptance).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  FAUNA_COAT_FIELD_VERSION, COAT_CELLS_PER_BODY, COAT_CANONICAL_SAMPLE_COUNT, COAT_MORPH_RATES,
  hash3u, valueNoise3, fbm2, worley3, coatStringHash, coatRandom, coatLuminance, hexToLinear, linearToSrgb,
  coatSpeciesColours, coatIndividualDrift, applyCoatDrift, defaultCoatGenome, normalizeCoatGenome,
  evaluateCoat, coatPatternProbe, coatCanonicalSamples, coatMeanColor, coatMinFeature,
} from '../src/fauna-coat-fields.ts';
import {
  COAT_PATTERNS, COAT_PALETTE_IDS, PIGMENT_FAMILIES, COAT_ROLES, COAT_REGIONS, COAT_MARK_BITS, AUTO_PATTERN,
} from '../src/fauna-coat-vocab.ts';
import {composerHash, composerRandom} from '../src/fauna-composer-recipe.ts';
import {sampleFaunaCoat} from '../src/fauna-appearance.ts';

const RESOLVED = COAT_PATTERNS.filter(p => p !== 'auto');
const PIGMENTED = ['base', 'accent', 'belly', 'skin'];
const rgb = () => new Float64Array(3);
const ev = (g, s) => { const o = rgb(); evaluateCoat(g, s, o); return o; };
const median = list => { const a = [...list].sort((x, y) => x - y); return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2; };

/** 64 x 64 samples over the whole torso circumference (an elliptic tube). */
function torsoGrid(n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -0.4 + 0.8 * (i + 0.5) / n, phi = 2 * Math.PI * (j + 0.5) / n;
    out.push({x, y: Math.cos(phi) * 0.15, z: Math.sin(phi) * 0.12, dorsal: Math.cos(phi), region: 'torso', along: 0.5});
  }
  return out;
}
const GRID = torsoGrid();
/** Flank band: where the marks are designed to read (belly and spine excluded). */
const FLANK = GRID.filter(s => s.dorsal > -0.2 && s.dorsal < 0.8);

// Linear sRGB -> CIELAB (D65).
function lab([r, g, b]) {
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

test('purity: no three, Math.random, Date or performance in the coat modules', () => {
  for (const file of ['../src/fauna-coat-fields.ts', '../src/fauna-coat-vocab.ts']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /from\s+['"]three['"]|import\(\s*['"]three['"]\s*\)|require\(\s*['"]three['"]\s*\)/, `${file} imports three`);
    assert.doesNotMatch(text, /Math\.random/, `${file} uses Math.random`);
    assert.doesNotMatch(text, /\bDate\b/, `${file} uses Date`);
    assert.doesNotMatch(text, /\bperformance\b/, `${file} uses performance`);
    assert.doesNotMatch(text, /^\s*(export\s+)?(declare\s+)?(const\s+)?(enum|namespace)\s+\w+/m, `${file} must stay erasable TypeScript`);
  }
  assert.equal(FAUNA_COAT_FIELD_VERSION, 'fauna-coat-1');
});

test('string stream is composerHash/composerRandom compatible', () => {
  for (const text of ['', 'a', 'coat-species-v1/savanna/400', 'coat-individual-v1/herd/7', 'x'.repeat(300)]) {
    assert.equal(coatStringHash(text), composerHash(text));
    const a = coatRandom(text), b = composerRandom(text);
    for (let i = 0; i < 5; i++) assert.equal(a(), b());
  }
});

test('frozen lattice hash and noise values (fauna-coat-1 pins)', () => {
  // These pins freeze the integer hash, noise and coat evaluation. Changing any
  // of them is a fauna-coat-2 release, never an edit.
  const values = [hash3u(0, 0, 0, 0), hash3u(1, 2, 3, 4), hash3u(-7, 11, -13, 0xdeadbeef), hash3u(2147483647, -2147483648, 5, 99)];
  for (const v of values) assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
  assert.notEqual(hash3u(1, 2, 3, 4), hash3u(1, 2, 3, 5));
  assert.notEqual(hash3u(1, 2, 3, 4), hash3u(2, 1, 3, 4));
  const w = new Float64Array(6); worley3(1.3, -2.7, 0.4, 17, w);
  assert.ok(w[0] <= w[1] && w[0] >= 0);
  const digest = createHash('sha256');
  digest.update(JSON.stringify(values));
  digest.update(JSON.stringify([valueNoise3(0.3, 1.7, -2.2, 5), fbm2(4.1, -0.3, 9.9, 6), [...w]]));
  const samples = coatCanonicalSamples(), out = new Float64Array(3);
  for (const pattern of RESOLVED) {
    const g = defaultCoatGenome('tawny', 'pin', {pattern, marks: 255});
    for (let i = 0; i < samples.length; i += 7) { evaluateCoat(g, samples[i], out); digest.update(out); }
  }
  assert.equal(digest.digest('hex'), PINNED_DIGEST);
});
const PINNED_DIGEST = 'f73ad98b781d07de82184df16649cf4d47d1a3e05f13727c23812c0adbb4e4a2';

test('noise ranges', () => {
  const w = new Float64Array(3);
  for (let i = 0; i < 2000; i++) {
    const x = i * 0.137 - 50, y = i * 0.071 + 3, z = -i * 0.053;
    const v = valueNoise3(x, y, z, i), f = fbm2(x, y, z, i);
    assert.ok(v >= 0 && v < 1 && f >= 0 && f < 1);
    worley3(x, y, z, 3, w);
    assert.ok(w[0] >= 0 && w[1] >= w[0] && w[0] < 1.8 && Number.isInteger(w[2]) && w[2] >= 0 && w[2] <= 0xffffffff);
  }
});

test('determinism: 10,000 samples twice and in shuffled order are bit-identical', () => {
  const rand = composerRandom('coat-determinism'), jobs = [];
  for (let i = 0; i < 10000; i++) {
    const pattern = RESOLVED[i % RESOLVED.length], palette = COAT_PALETTE_IDS[(i * 7) % COAT_PALETTE_IDS.length];
    jobs.push({
      g: defaultCoatGenome(palette, i % 13, {pattern, marks: (i * 37) & 255, greying: (i % 5) / 4, juvenileSpots: (i % 3) / 2, threshold: ((i % 7) - 3) / 10}),
      s: {x: rand() - 0.5, y: rand() * 0.6 - 0.3, z: rand() * 0.3 - 0.15, dorsal: rand() * 2 - 1, region: COAT_REGIONS[i % COAT_REGIONS.length], along: rand(), ...(i % 4 === 0 ? {footprint: rand() * 0.05} : {})},
    });
  }
  const run = order => { const out = new Float64Array(jobs.length * 3); for (const i of order) evaluateCoat(jobs[i].g, jobs[i].s, out, i * 3); return out; };
  const ids = jobs.map((_, i) => i), first = run(ids), second = run(ids);
  const shuffled = [...ids]; for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const third = run(shuffled);
  assert.deepEqual(Buffer.from(first.buffer), Buffer.from(second.buffer));
  assert.deepEqual(Buffer.from(first.buffer), Buffer.from(third.buffer));
  for (const v of first) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
  // Float32Array output with an offset writes the same values.
  const f32 = new Float32Array(5); evaluateCoat(jobs[3].g, jobs[3].s, f32, 2);
  assert.deepEqual([...f32.slice(2)], [...Float32Array.from(first.slice(9, 12))]);
});

test('every pattern differs from plain (>= 0.04) and from every other pattern (>= 0.02)', () => {
  // Metric: mean over the 4,096-sample torso grid of the Euclidean |dRGB| (linear).
  const colours = {};
  for (const pattern of RESOLVED) { const g = defaultCoatGenome('tawny', 7, {pattern}); colours[pattern] = GRID.map(s => ev(g, s)); }
  const diff = (a, b) => a.reduce((sum, c, i) => sum + Math.hypot(c[0] - b[i][0], c[1] - b[i][1], c[2] - b[i][2]), 0) / a.length;
  const report = {};
  for (const p of RESOLVED) if (p !== 'plain') { report[p] = diff(colours[p], colours.plain); assert.ok(report[p] >= 0.04, `${p} vs plain ${report[p]}`); }
  for (let i = 0; i < RESOLVED.length; i++) for (let j = i + 1; j < RESOLVED.length; j++) {
    const d = diff(colours[RESOLVED[i]], colours[RESOLVED[j]]);
    assert.ok(d >= 0.02, `${RESOLVED[i]} vs ${RESOLVED[j]} ${d}`);
  }
});

test('coverage at scale 1 (flank band, countershading off, 3 species seeds)', () => {
  const probe = new Float64Array(6);
  for (const seed of [7, 400, 'savanna-herd']) {
    const L = (g, s) => coatLuminance(ev(g, s));
    // spots: dark fraction 0.12 - 0.35
    let g = defaultCoatGenome('tawny', seed, {pattern: 'spots', countershade: 0});
    let mid = (coatLuminance(g.colours.base) + coatLuminance(g.colours.accent)) / 2;
    const spots = FLANK.filter(s => L(g, s) < mid).length / FLANK.length;
    assert.ok(spots >= 0.12 && spots <= 0.35, `spots dark fraction ${spots} (seed ${seed})`);
    // reticulated: dark patches >= 0.6, pale lines 0.12 - 0.30
    g = defaultCoatGenome('savanna', seed, {pattern: 'reticulated', countershade: 0});
    mid = (coatLuminance(g.colours.base) + coatLuminance(g.colours.belly)) / 2;
    const pale = FLANK.filter(s => L(g, s) > mid).length / FLANK.length;
    const dark = FLANK.filter(s => L(g, s) < coatLuminance(g.colours.base)).length / FLANK.length;
    assert.ok(dark >= 0.6, `reticulated dark-patch fraction ${dark} (seed ${seed})`);
    assert.ok(pale >= 0.12 && pale <= 0.3, `reticulated pale-line fraction ${pale} (seed ${seed})`);
    // rosettes: ring darkness exceeds centre darkness by >= 0.1
    g = defaultCoatGenome('ochre', seed, {pattern: 'rosettes', countershade: 0});
    const lb = coatLuminance(g.colours.base); let ring = 0, nRing = 0, centre = 0, nCentre = 0;
    for (const s of FLANK) {
      coatPatternProbe(g, s, probe);
      const rho = probe[1] / probe[2], inner = probe[3], outer = probe[4], darkness = 1 - L(g, s) / lb;
      if (rho > inner + 0.04 && rho < outer - 0.04) { ring += darkness; nRing++; } else if (rho < inner - 0.06) { centre += darkness; nCentre++; }
    }
    assert.ok(nRing > 100 && nCentre > 100);
    assert.ok(ring / nRing - centre / nCentre >= 0.1, `rosette ring ${ring / nRing} vs centre ${centre / nCentre} (seed ${seed})`);
    // stripes: dark fraction 0.25 - 0.5
    g = defaultCoatGenome('ochre', seed, {pattern: 'stripes', countershade: 0});
    mid = (coatLuminance(g.colours.base) + coatLuminance(g.colours.accent)) / 2;
    const stripes = FLANK.filter(s => L(g, s) < mid).length / FLANK.length;
    assert.ok(stripes >= 0.25 && stripes <= 0.5, `stripes dark fraction ${stripes} (seed ${seed})`);
  }
});

test('stripes vary in width per band', () => {
  const g = defaultCoatGenome('ochre', 3, {pattern: 'stripes', countershade: 0, warp: 0}), runs = [];
  const mid = (coatLuminance(g.colours.base) + coatLuminance(g.colours.accent)) / 2;
  let run = 0;
  for (let i = 0; i < 4000; i++) {
    const x = -0.45 + 0.9 * i / 4000, dark = coatLuminance(ev(g, {x, y: 0.15, z: 0, dorsal: 1, region: 'torso', along: 0.5})) < mid;
    if (dark) run++; else if (run) { runs.push(run); run = 0; }
  }
  assert.ok(runs.length >= 3);
  assert.ok(Math.max(...runs) / Math.min(...runs) >= 1.4, `stripe widths ${runs}`);
});

test('asymmetry: mirror pairs differ for spots, rosettes, reticulated, piebald; the legacy planet coat is symmetric', () => {
  for (const pattern of ['spots', 'rosettes', 'reticulated', 'piebald']) {
    const g = defaultCoatGenome('tawny', 7, {pattern});
    let max = 0;
    for (const s of GRID) { const a = ev(g, s), b = ev(g, {...s, z: -s.z}); max = Math.max(max, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
    assert.ok(max >= 0.05, `${pattern} mirror difference ${max}`);
  }
  const legacy = {torsoLength: 1.2, torsoHeight: 0.4, torsoWidth: 0.3, appearance: {pattern: 'spots', markingSeed: 1234, palette: {base: '#a87c4f', marking: '#3a2414', belly: '#d9c09a'}}};
  let max = 0;
  for (const s of GRID) {
    const a = sampleFaunaCoat(legacy, s.x * 1.2, s.y * 1.2 + 0.5, s.z * 1.2, 0.5), b = sampleFaunaCoat(legacy, s.x * 1.2, s.y * 1.2 + 0.5, -s.z * 1.2, 0.5);
    max = Math.max(max, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  assert.equal(max, 0);
});

test('countershading: belly luminance >= dorsal luminance x (1 + 0.25 countershade)', () => {
  const xs = Array.from({length: 40}, (_, i) => -0.35 + 0.7 * i / 39);
  const meanL = (g, dorsal) => xs.reduce((sum, x) => sum + coatLuminance(ev(g, {x, y: dorsal * 0.15, z: 0.001, dorsal, region: 'torso', along: 0.5})), 0) / xs.length;
  for (const palette of COAT_PALETTE_IDS) for (const countershade of [0.3, 0.8, 1]) for (const seed of [1, 2, 3]) {
    // Every palette for the plain ground; dorsal patterns only where the accent is the
    // darker pigment (plumage and ink carry a bright accent, so a dorsal mark is meant to be light).
    const darkAccent = coatLuminance(coatSpeciesColours(palette, seed).accent) < coatLuminance(coatSpeciesColours(palette, seed).base);
    for (const pattern of darkAccent ? ['plain', 'saddle', 'dorsal-stripe', 'stripes', 'spots', 'rosettes', 'brindle', 'bands'] : ['plain']) {
      const g = defaultCoatGenome(palette, seed, {pattern, countershade});
      const belly = meanL(g, -1), back = meanL(g, 1);
      assert.ok(belly >= back * (1 + 0.25 * countershade), `${palette}/${pattern}/cs${countershade}: belly ${belly} back ${back}`);
    }
  }
});

test('albedo: pigment roles stay within linear luminance 0.02 - 0.60 (14 palettes x 200 seeds)', () => {
  for (const palette of COAT_PALETTE_IDS) for (let seed = 0; seed < 200; seed++) {
    const c = coatSpeciesColours(palette, seed);
    for (const role of PIGMENTED) { const l = coatLuminance(c[role]); assert.ok(l >= 0.02 - 1e-12 && l <= 0.6 + 1e-12, `${palette}/${seed}/${role} ${l}`); }
    assert.ok(coatLuminance(c.keratin) <= 0.5 + 1e-12);
    for (const role of COAT_ROLES) assert.ok(c[role].every(v => Number.isFinite(v) && v >= 0));
  }
  // A grey stays grey under the species jitter.
  for (let seed = 0; seed < 50; seed++) {
    const c = coatSpeciesColours('grey', seed).base, s = c.map(linearToSrgb);
    assert.ok((Math.max(...s) - Math.min(...s)) / Math.max(...s) < 0.12, `grey saturation ${s}`);
  }
});

test('individuals: within-species dE76 median 2.5-8, across pigment families >= 12, variability 0 is exactly 0', () => {
  const N = 8, within = [], species = {};
  for (const palette of COAT_PALETTE_IDS) {
    const base = defaultCoatGenome(palette, 'dE');
    species[palette] = Array.from({length: N}, (_, i) => coatMeanColor(applyCoatDrift(base, coatIndividualDrift(`dE/${palette}/${i}`, 1))));
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) within.push(deltaE(species[palette][i], species[palette][j]));
  }
  const mWithin = median(within);
  assert.ok(mWithin >= 2.5 && mWithin <= 8, `within-species median dE ${mWithin}`);
  const across = [];
  for (let a = 0; a < PIGMENT_FAMILIES.length; a++) for (let b = a + 1; b < PIGMENT_FAMILIES.length; b++)
    for (const ca of species[PIGMENT_FAMILIES[a]]) for (const cb of species[PIGMENT_FAMILIES[b]]) across.push(deltaE(ca, cb));
  const mAcross = median(across);
  assert.ok(mAcross >= 12, `across-family median dE ${mAcross}`);
  // variability 0: identity drift, identical genome and mean colour.
  for (const palette of COAT_PALETTE_IDS) {
    const base = defaultCoatGenome(palette, 'dE'), drift = coatIndividualDrift(`dE/${palette}/0`, 0);
    assert.deepEqual(drift, {hue: 0, saturation: 0, value: 0, reseed: 0, scale: 0, threshold: 0, warp: 0, greying: 0, morph: 'none'});
    const same = applyCoatDrift(base, drift);
    assert.deepEqual(same, base);
    assert.equal(deltaE(coatMeanColor(same), coatMeanColor(base)), 0);
  }
});

test('individual drift: bounded, deterministic, new seed, input untouched', () => {
  const base = defaultCoatGenome('fawn', 5, {pattern: 'spots', marks: 128}), frozen = JSON.stringify(base);
  for (let i = 0; i < 500; i++) {
    const d = coatIndividualDrift(`k${i}`, 1);
    assert.deepEqual(d, coatIndividualDrift(`k${i}`, 1));
    assert.ok(Math.abs(d.hue) <= 0.015 && Math.abs(d.value) <= 0.08 && Math.abs(d.saturation) <= 0.1 && Math.abs(d.scale) <= 0.08 && Math.abs(d.threshold) <= 0.06 && d.greying >= 0 && d.greying <= 0.3);
    assert.ok(d.reseed > 0);
    const g = applyCoatDrift(base, d);
    assert.notEqual(g.seed, base.seed);
    assert.ok(g.scale >= 0.5 && g.scale <= 2 && g.warp >= 0 && g.warp <= 1);
    const half = coatIndividualDrift(`k${i}`, 0.5);
    assert.ok(Math.abs(half.hue - d.hue / 2) < 1e-12 && Math.abs(half.value - d.value / 2) < 1e-12);
  }
  assert.equal(JSON.stringify(base), frozen);
});

test('morph rates over 20,000 individuals at v = 1 are within +-35% of target', () => {
  const counts = {none: 0, melanistic: 0, leucistic: 0, erythristic: 0};
  for (let i = 0; i < 20000; i++) counts[coatIndividualDrift(`morph/${i}`, 1).morph]++;
  for (const [morph, rate] of Object.entries(COAT_MORPH_RATES)) {
    const expected = rate * 20000;
    assert.ok(Math.abs(counts[morph] - expected) <= 0.35 * expected, `${morph}: ${counts[morph]} vs ${expected}`);
  }
  // Morphs change the look in the documented direction.
  const g = defaultCoatGenome('tawny', 1), drift = {hue: 0, saturation: 0, value: 0, reseed: 0, scale: 0, threshold: 0, warp: 0, greying: 0};
  const mel = applyCoatDrift(g, {...drift, morph: 'melanistic'}), leu = applyCoatDrift(g, {...drift, morph: 'leucistic'}), ery = applyCoatDrift(g, {...drift, morph: 'erythristic'});
  assert.ok(coatLuminance(mel.colours.base) < 0.4 * coatLuminance(g.colours.base));
  assert.ok(coatLuminance(leu.colours.base) > coatLuminance(g.colours.base) && coatLuminance(leu.colours.base) <= 0.55 + 1e-9);
  assert.ok(ery.colours.base[0] / ery.colours.base[1] > g.colours.base[0] / g.colours.base[1], 'erythristic is redder');
  assert.deepEqual(leu.colours.eye, g.colours.eye);
});

test('genome construction: auto resolution, overrides, clamps, normalisation', () => {
  for (const palette of COAT_PALETTE_IDS) {
    const g = defaultCoatGenome(palette, 0);
    assert.equal(g.pattern, AUTO_PATTERN[palette]);
    assert.equal(g.version, 'fauna-coat-1');
    assert.equal(g.countershade, 0.8); assert.equal(g.bellyLine, -0.45); assert.equal(g.marks, 0);
    assert.deepEqual(g, defaultCoatGenome(palette, 0));
    assert.deepEqual(normalizeCoatGenome(g), g);
  }
  assert.equal(defaultCoatGenome('savanna', 1).pattern, 'reticulated');
  const g = defaultCoatGenome('earth', 1, {pattern: 'stripes', scale: 9, contrast: -1, marks: 300, threshold: 2});
  assert.equal(g.pattern, 'stripes'); assert.equal(g.scale, 2); assert.equal(g.contrast, 0); assert.equal(g.marks, 255); assert.equal(g.threshold, 0.3);
  assert.equal(defaultCoatGenome('dun', 1, {marks: COAT_MARK_BITS['juvenile-spots']}).juvenileSpots, 1);
  assert.throws(() => defaultCoatGenome('nope', 1));
  assert.throws(() => defaultCoatGenome('earth', 1, {pattern: 'nope'}));
  assert.throws(() => normalizeCoatGenome({...g, pattern: 'auto'}));
  assert.notDeepEqual(coatSpeciesColours('earth', 1), coatSpeciesColours('earth', 2));
  // Legacy rows are the verbatim v1 composer palettes before jitter.
  assert.deepEqual(hexToLinear('#7a5a3c').map(v => +v.toFixed(6)), hexToLinear('#7A5A3C').map(v => +v.toFixed(6)));
  for (const p of RESOLVED) assert.ok(p in COAT_CELLS_PER_BODY);
});

test('regions: eye, horn and armor take their roles and no marks', () => {
  const g = defaultCoatGenome('rufous', 2, {pattern: 'spots', marks: 255, greying: 1});
  const e = ev(g, {x: 0.6, y: 0.3, z: 0.05, dorsal: 0.5, region: 'eye', along: 0.5});
  assert.deepEqual([...e], g.colours.eye);
  for (const [region, role] of [['horn', 'horn'], ['armor', 'plate']]) {
    for (let i = 0; i < 50; i++) {
      const c = ev(g, {x: i / 50 - 0.5, y: 0.1, z: 0.02, dorsal: 0.8, region, along: i / 50});
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(c[k] / g.colours[role][k] - 1) <= 0.0401, `${region} ${c}`);
    }
  }
});

test('region marks change only their regions', () => {
  const plain = defaultCoatGenome('tawny', 4, {pattern: 'plain'});
  const cases = [
    ['socks', {region: 'foot', along: 0.5}, {region: 'torso', along: 0.5}],
    ['mask', {region: 'muzzle', along: 0.5}, {region: 'neck', along: 0.5}],
    ['blaze', {region: 'head', along: 0.6, z: 0}, {region: 'head', along: 0.6, z: 0.08}],
    ['tail-tip', {region: 'tail-tip', along: 0.8}, {region: 'tail', along: 0.5}],
    ['ear-tips', {region: 'ear', along: 0.95}, {region: 'ear', along: 0.2}],
    ['rump-patch', {region: 'torso', x: -0.45, dorsal: 0.3}, {region: 'torso', x: 0.1, dorsal: 0.3}],
  ];
  for (const [mark, hit, miss] of cases) {
    const g = {...plain, marks: COAT_MARK_BITS[mark]};
    const s = o => ({x: 0, y: 0.1, z: 0.03, dorsal: 0.4, along: 0.5, ...o});
    const dHit = Math.hypot(...ev(g, s(hit)).map((v, i) => v - ev(plain, s(hit))[i])), dMiss = Math.hypot(...ev(g, s(miss)).map((v, i) => v - ev(plain, s(miss))[i]));
    assert.ok(dHit > 0.03, `${mark} hit ${dHit}`); assert.equal(dMiss, 0, `${mark} miss ${dMiss}`);
  }
  // Juvenile spots: off without strength, present on the torso flank with it.
  const juv = {...plain, marks: COAT_MARK_BITS['juvenile-spots'], juvenileSpots: 1}, none = {...juv, juvenileSpots: 0};
  let changed = 0;
  for (const s of FLANK) { const a = ev(juv, s), b = ev(plain, s); if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.05) changed++; assert.deepEqual([...ev(none, s)], [...b]); }
  assert.ok(changed > 20 && changed < FLANK.length * 0.25, `juvenile spots ${changed}`);
  // Greying lightens the muzzle only.
  const grey = {...plain, greying: 1};
  assert.ok(coatLuminance(ev(grey, {x: 0.7, y: 0.2, z: 0, dorsal: 0, region: 'muzzle', along: 0.5})) > coatLuminance(ev(plain, {x: 0.7, y: 0.2, z: 0, dorsal: 0, region: 'muzzle', along: 0.5})));
  assert.deepEqual([...ev(grey, GRID[100])], [...ev(plain, GRID[100])]);
});

test('footprint filtering: wide footprints blend thin marks instead of aliasing', () => {
  for (const pattern of ['reticulated', 'roan', 'rosettes']) {
    const g = defaultCoatGenome('savanna', 3, {pattern, countershade: 0});
    const variance = fp => { const ls = FLANK.map(s => coatLuminance(ev(g, {...s, footprint: fp}))), m = ls.reduce((a, b) => a + b, 0) / ls.length; return ls.reduce((a, b) => a + (b - m) ** 2, 0) / ls.length; };
    assert.ok(variance(0.06) < variance(0) * 0.85, `${pattern}: ${variance(0.06)} vs ${variance(0)}`);
  }
});

test('coatMinFeature and coatMeanColor', () => {
  for (const pattern of RESOLVED) for (const scale of [0.5, 1, 2]) {
    const g = defaultCoatGenome('dun', 1, {pattern, scale, marks: 255});
    const f = coatMinFeature(g);
    assert.ok(Number.isFinite(f) && f > 0 && f <= 1, `${pattern} ${f}`);
    if (pattern !== 'plain' && pattern !== 'saddle' && pattern !== 'dorsal-stripe') assert.ok(coatMinFeature({...g, scale: g.scale / 2, marks: 0}) > coatMinFeature({...g, marks: 0}) || scale === 0.5);
  }
  assert.equal(coatMinFeature(defaultCoatGenome('slate', 1, {pattern: 'plain'})), 1);
  const samples = coatCanonicalSamples();
  assert.equal(samples.length, COAT_CANONICAL_SAMPLE_COUNT);
  assert.ok(Object.isFrozen(samples));
  const regions = new Set(samples.map(s => s.region));
  for (const r of ['torso', 'neck', 'head', 'muzzle', 'ear', 'tail', 'tail-tip', 'limb-upper', 'limb-lower', 'foot']) assert.ok(regions.has(r), r);
  const g = defaultCoatGenome('savanna', 9);
  let r = 0, gg = 0, b = 0, w = 0; const o = new Float64Array(3);
  for (const s of samples) { evaluateCoat(g, s, o); r += o[0] * s.weight; gg += o[1] * s.weight; b += o[2] * s.weight; w += s.weight; }
  const mean = coatMeanColor(g);
  assert.ok(Math.abs(mean[0] - r / w) < 1e-12 && Math.abs(mean[1] - gg / w) < 1e-12 && Math.abs(mean[2] - b / w) < 1e-12);
  assert.deepEqual(coatMeanColor(g), mean);
});

// Timing cap moved to perf/fauna-coat-fields.perf.test.mjs.
