// Composer skin 2 coat: the shared coat library sampled on the true surface. Asymmetry, resolvability, legs,
// individuals and the giraffe reticulation, measured on the actual vertex colours (linear RGB).
import test from 'node:test';
import assert from 'node:assert/strict';
import {composerPreset, COMPOSER_PRESET_IDS, normalizeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {COAT_REGIONS} from '../src/fauna-coat-vocab.ts';

const REGION = Object.fromEntries(COAT_REGIONS.map((n, i) => [n, i]));
const build = (input, options = {debug: true}) => buildComposerSkin(buildComposerGraph(deriveComposerIndividual(normalizeComposerRecipe(input).recipe).recipe), options);
const luminance = (c, i) => 0.2126 * c[i * 3] + 0.7152 * c[i * 3 + 1] + 0.0722 * c[i * 3 + 2];
const partVertices = (s, pred) => { const set = new Set(); for (const p of s.parts) if (pred(p)) for (let t = p.firstTriangle; t < p.firstTriangle + p.triangles; t++) for (let k = 0; k < 3; k++) set.add(s.index[t * 3 + k]); return [...set].sort((a, b) => a - b); };
const regionVertices = (s, region) => { const out = []; for (let i = 0; i < s.vertexCount; i++) if (s.regions[i] === REGION[region]) out.push(i); return out; };
const spotted = {...composerPreset('giraffe'), palette: 'fawn', pattern: 'spots', colorSeed: 12};
const rosettes = {...composerPreset('rhinoceros'), palette: 'tawny', pattern: 'rosettes', colorSeed: 5};

/** Largest colour difference between a torso vertex and its mirror twin (z -> -z) within 0.1 mm. */
function mirrorMax(s) {
  const vs = partVertices(s, p => p.part === 'torso'), P = s.positions, grid = new Map(), cell = 0.01, key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const i of vs) { const k = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  let max = 0, pairs = 0;
  for (const i of vs) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (z < 1e-3) continue;
    let best = -1, bd = 1e-4;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const j of grid.get(`${Math.floor(x / cell) + a},${Math.floor(y / cell) + b},${Math.floor(-z / cell) + c}`) ?? []) {
      const d = Math.hypot(P[j * 3] - x, P[j * 3 + 1] - y, P[j * 3 + 2] + z); if (d < bd) { bd = d; best = j; }
    }
    if (best < 0) continue;
    pairs++;
    max = Math.max(max, Math.hypot(s.colors[i * 3] - s.colors[best * 3], s.colors[i * 3 + 1] - s.colors[best * 3 + 1], s.colors[i * 3 + 2] - s.colors[best * 3 + 2]));
  }
  return {pairs, max};
}

test('coats are not mirror images: torso L/R pair difference >= 0.05', () => {
  for (const [name, recipe] of [['giraffe', composerPreset('giraffe')], ['dinosaur', composerPreset('dinosaur')], ['spots', spotted], ['rosettes', rosettes]]) {
    const {pairs, max} = mirrorMax(build(recipe));
    assert.ok(pairs > 500, `${name}: ${pairs} mirror pairs`);
    assert.ok(max >= 0.05, `${name}: max mirror-pair difference ${max.toFixed(4)}`);
  }
});

test('patterns stay resolvable: torso median edge <= 0.25 x the mean cell diameter', () => {
  for (const [name, recipe] of [...COMPOSER_PRESET_IDS.map(id => [id, composerPreset(id)]), ['spots', spotted], ['rosettes', rosettes], ['small reticulation', {...composerPreset('giraffe'), patternScale: 2}]]) {
    const s = build(recipe), edges = [];
    for (const p of s.parts) if (p.part === 'torso') for (let t = p.firstTriangle; t < p.firstTriangle + p.triangles; t++) {
      const ids = [0, 1, 2].map(k => s.index[t * 3 + k]); if (!ids.every(i => s.regions[i] === REGION.torso)) continue;
      for (let k = 0; k < 3; k++) { const a = ids[k] * 3, b = ids[(k + 1) % 3] * 3; edges.push(Math.hypot(s.positions[a] - s.positions[b], s.positions[a + 1] - s.positions[b + 1], s.positions[a + 2] - s.positions[b + 2])); }
    }
    edges.sort((a, b) => a - b);
    const median = edges[edges.length >> 1], cell = s.debug.coat.meanCellDiameter;
    assert.ok(Math.abs(s.debug.coat.torsoEdgeEstimate - median) <= 0.02 * median, `${name}: the clamp sees the emitted edges`);
    assert.ok(s.debug.coat.effectiveScale <= s.debug.coat.requestedScale + 1e-12, `${name}: the clamp only coarsens`);
    if (Number.isFinite(cell)) assert.ok(median <= 0.25 * cell, `${name}: median edge ${median.toFixed(4)} vs cell ${cell.toFixed(4)}`);
  }
});

test('legs carry the coat: socks change limb-lower luminance by >= 15% and patterned legs vary', () => {
  for (const recipe of [{...composerPreset('giraffe'), palette: 'tawny', pattern: 'plain', marks: 1}, {...composerPreset('rhinoceros'), marks: 1}]) {
    const s = build(recipe), mean = ids => ids.reduce((a, i) => a + luminance(s.colors, i), 0) / ids.length;
    const up = mean(regionVertices(s, 'limb-upper')), lo = mean(regionVertices(s, 'limb-lower'));
    assert.ok(Math.abs(lo - up) / Math.max(up, lo) >= 0.15, `socks: limb-lower ${lo.toFixed(4)} vs limb-upper ${up.toFixed(4)}`);
  }
  for (const [name, recipe] of [['giraffe', composerPreset('giraffe')], ['spots', spotted], ['dinosaur', composerPreset('dinosaur')]]) {
    const s = build(recipe);
    for (const region of ['limb-upper', 'limb-lower']) {
      const ids = regionVertices(s, region), m = [0, 1, 2].map(k => ids.reduce((a, i) => a + s.colors[i * 3 + k], 0) / ids.length);
      const std = Math.sqrt(ids.reduce((a, i) => a + [0, 1, 2].reduce((b, k) => b + (s.colors[i * 3 + k] - m[k]) ** 2, 0), 0) / ids.length / 3);
      assert.ok(ids.length > 50 && std >= 0.02, `${name}/${region}: colour std ${std.toFixed(4)} over ${ids.length} vertices`);
    }
  }
});

test('individuals differ: individualSeed 1 vs 2 mean per-vertex |dRGB| >= 0.02 for every preset', t => {
  const out = {};
  for (const id of COMPOSER_PRESET_IDS) {
    const a = build({...composerPreset(id), individualSeed: 1}, {}), b = build({...composerPreset(id), individualSeed: 2}, {});
    // the rig differs between individuals, so vertices pair by index when the topology matches, else by nearest position
    const same = a.vertexCount === b.vertexCount;
    let sum = 0;
    for (let i = 0; i < a.vertexCount; i++) {
      let j = i;
      if (!same) { let bd = Infinity; for (let q = 0; q < b.vertexCount; q++) { const d = (a.positions[i * 3] - b.positions[q * 3]) ** 2 + (a.positions[i * 3 + 1] - b.positions[q * 3 + 1]) ** 2 + (a.positions[i * 3 + 2] - b.positions[q * 3 + 2]) ** 2; if (d < bd) { bd = d; j = q; } } }
      sum += Math.hypot(a.colors[i * 3] - b.colors[j * 3], a.colors[i * 3 + 1] - b.colors[j * 3 + 1], a.colors[i * 3 + 2] - b.colors[j * 3 + 2]);
    }
    out[id] = +(sum / a.vertexCount).toFixed(4);
    assert.ok(sum / a.vertexCount >= 0.02, `${id}: mean |dRGB| ${(sum / a.vertexCount).toFixed(4)} (rhino v1 baseline 0.008-0.016)`);
  }
  t.diagnostic(`individual 1 vs 2 mean linear |dRGB|: ${JSON.stringify(out)}`);
});

test('giraffe reads as dark patches on a pale line network', t => {
  const s = build(composerPreset('giraffe'));
  assert.equal(s.debug.coat.pattern, 'reticulated');
  const tris = [];
  for (const p of s.parts) if (p.part === 'torso') for (let k = p.firstTriangle; k < p.firstTriangle + p.triangles; k++) {
    const ids = [0, 1, 2].map(j => s.index[k * 3 + j]); if (!ids.every(i => s.regions[i] === REGION.torso)) continue;
    const [a, b, c] = ids.map(i => [s.positions[i * 3], s.positions[i * 3 + 1], s.positions[i * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    tris.push({area: 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]), l: ids.reduce((x, i) => x + luminance(s.colors, i), 0) / 3, y: (a[1] + b[1] + c[1]) / 3});
  }
  // the flank above the median height (the pale belly below is countershading, not the line network)
  const ymed = tris.map(x => x.y).sort((a, b) => a - b)[tris.length >> 1], upper = tris.filter(x => x.y >= ymed).sort((a, b) => a.l - b.l);
  const total = upper.reduce((a, x) => a + x.area, 0);
  const pct = q => { let acc = 0; for (const x of upper) { acc += x.area; if (acc >= q * total) return x.l; } return upper[upper.length - 1].l; };
  // patch and line reference shades; a triangle is patch when it is closer to the patch shade
  const patch = pct(0.1), line = pct(0.95), mid = (patch + line) / 2;
  const dark = upper.filter(x => x.l < mid).reduce((a, x) => a + x.area, 0) / total;
  const patchMean = upper.filter(x => x.l < mid).reduce((a, x) => a + x.area * x.l, 0) / (dark * total);
  const lineMean = upper.filter(x => x.l >= mid).reduce((a, x) => a + x.area * x.l, 0) / ((1 - dark) * total);
  t.diagnostic(`dark-patch fraction ${dark.toFixed(3)}, patch luminance ${patchMean.toFixed(3)}, line luminance ${lineMean.toFixed(3)}`);
  assert.ok(dark >= 0.55 && dark <= 0.8, `dark-patch area fraction ${dark.toFixed(3)}`);
  assert.ok(lineMean > patchMean * 1.3, 'lines are lighter than patches');
});
