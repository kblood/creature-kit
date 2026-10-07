// Composer LOD chain (fauna-composer-lod-1; creature export v2). Checked without a GPU, self-relative only (no pinned
// skin bytes, so a composer skin change does not break this file):
// - every level meets its target, levels are nested, every output vertex is a source vertex with bit-identical
//   attributes, triangles are valid and parts stay contiguous;
// - the chain is deterministic: two runs hash the same, for three coherent seeds and the presets;
// - sagittal symmetry survives (mirror pairs kept) and no new non-manifold edge appears;
// - skinning: the posed level stays as close to the posed source as the rest level does to the rest source;
// - the reducer imports nothing, and no composer core module imports it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {COMPOSER_LOD_VERSION, assertComposerLodTargets, buildComposerLodChain, composerLodDeviation} from '../src/fauna-composer-lod.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {composerPreset} from '../src/fauna-composer-recipe.ts';
import {coherentComposerSpecies} from '../src/fauna-composer-species.ts';

const TARGETS = [8000, 3000, 1000];
const SEEDS = ['export-test-1', 'export-test-2', 'export-test-3'];
const SPECIMENS = {
  bird: () => composerPreset('bird'),
  centipede: () => composerPreset('centipede'),                  // 79 joints, many thin legs
  worm: () => composerPreset('worm'),                            // below the first target: level 0 is the source
  'trunked-centipede': () => composerPreset('trunked-centipede'), // the largest skin
  ...Object.fromEntries(SEEDS.map(s => [s, () => coherentComposerSpecies(s).recipe])),
};
const built = new Map();
/** The runtime creature's skin plus its three-computed normals, as the exporter feeds the reducer. */
function source(name) {
  if (!built.has(name)) {
    const creature = createComposerCreature(SPECIMENS[name]());
    const skin = creature.skin;
    const normals = new Float32Array(creature.mesh.geometry.getAttribute('normal').array);
    built.set(name, {creature, src: {positions: skin.positions, normals, colors: skin.colors, gloss: skin.gloss, skinIndex: skin.skinIndex, skinWeight: skin.skinWeight, index: skin.index, parts: skin.parts}, skin});
  }
  return built.get(name);
}
const chainHash = chain => {
  const h = createHash('sha256');
  for (const l of chain.levels) for (const a of [l.positions, l.normals, l.colors, l.gloss, l.skinIndex, l.skinWeight, l.index, l.sourceVertex, l.representative])
    h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  h.update(JSON.stringify(chain.levels.map(l => [l.target, l.triangles, l.vertices, l.parts, l.stats])));
  return h.digest('hex');
};
const diagonal = positions => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { lo[i % 3] = Math.min(lo[i % 3], positions[i]); hi[i % 3] = Math.max(hi[i % 3], positions[i]); }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
};
const nonManifoldEdges = (positions, index) => {
  const key = v => `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
  const ids = new Map(), id = v => { const k = key(v); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const edges = new Map();
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = id(index[t + k]), b = id(index[t + (k + 1) % 3]), e = a < b ? `${a}:${b}` : `${b}:${a}`;
    edges.set(e, (edges.get(e) ?? 0) + 1);
  }
  let n = 0; for (const c of edges.values()) if (c > 2) n++;
  return n;
};

test.after(() => { for (const {creature} of built.values()) creature.dispose(); });

test('lod: targets are validated', () => {
  for (const bad of [[], [3], [8000, 8000], [3000, 8000], [1000.5], ['full']]) assert.throws(() => assertComposerLodTargets(bad), /composer lod/, JSON.stringify(bad));
  assert.doesNotThrow(() => assertComposerLodTargets(TARGETS));
  assert.throws(() => buildComposerLodChain({...source('bird').src, colors: new Float32Array(3)}, TARGETS), /attribute lengths/);
});

test('lod: every level meets its target and is a valid, nested subset of the source', () => {
  for (const name of Object.keys(SPECIMENS)) {
    const {src, skin} = source(name);
    const chain = buildComposerLodChain(src, TARGETS);
    assert.equal(chain.version, COMPOSER_LOD_VERSION);
    assert.equal(chain.sourceTriangles, skin.triangleCount);
    let previous = Infinity;
    chain.levels.forEach((level, i) => {
      const label = `${name} level ${i}`;
      assert.equal(level.target, TARGETS[i]);
      assert.ok(level.reached && level.triangles <= TARGETS[i], `${label}: ${level.triangles} > ${TARGETS[i]}`);
      assert.ok(level.triangles <= previous, `${label}: nested`); previous = level.triangles;
      assert.equal(level.index.length, level.triangles * 3);
      assert.equal(level.positions.length, level.vertices * 3);
      // every output vertex is a source vertex, attributes copied bit for bit
      for (let v = 0; v < level.vertices; v++) {
        const s = level.sourceVertex[v];
        assert.ok(s < skin.vertexCount && (v === 0 || s > level.sourceVertex[v - 1]), `${label}: source vertices ascending`);
        for (let c = 0; c < 3; c++) {
          assert.ok(Object.is(level.positions[v * 3 + c], skin.positions[s * 3 + c]) && Object.is(level.colors[v * 3 + c], skin.colors[s * 3 + c]) && Object.is(level.normals[v * 3 + c], src.normals[s * 3 + c]), `${label} vertex ${v}`);
        }
        for (let c = 0; c < 4; c++) assert.ok(level.skinIndex[v * 4 + c] === skin.skinIndex[s * 4 + c] && Object.is(level.skinWeight[v * 4 + c], skin.skinWeight[s * 4 + c]), `${label} weights ${v}`);
        assert.ok(Object.is(level.gloss[v], skin.gloss[s]));
      }
      // triangles: valid indices, no degenerate corner, every vertex used
      const used = new Uint8Array(level.vertices);
      for (let t = 0; t < level.index.length; t += 3) {
        const a = level.index[t], b = level.index[t + 1], c = level.index[t + 2];
        assert.ok(a < level.vertices && b < level.vertices && c < level.vertices && a !== b && b !== c && a !== c, `${label} triangle ${t / 3}`);
        used[a] = used[b] = used[c] = 1;
      }
      assert.equal(used.reduce((s, x) => s + x, 0), level.vertices, `${label}: no unused vertex`);
      // parts stay contiguous, in order, and cover every triangle
      let cursor = 0;
      for (const p of level.parts) { assert.equal(p.firstTriangle, cursor, `${label} part ${p.part}`); cursor += p.triangles; }
      assert.equal(cursor, level.triangles, `${label}: parts cover the level`);
      assert.deepEqual(level.parts.map(p => p.part), skin.parts.map(p => p.part));
      // representatives point at real output vertices
      assert.equal(level.representative.length, skin.vertexCount);
      for (const r of level.representative) assert.ok(r < level.vertices);
      // the reduction adds no non-manifold edge
      assert.ok(nonManifoldEdges(level.positions, level.index) <= nonManifoldEdges(skin.positions, skin.index), `${label}: no new non-manifold edge`);
    });
    if (skin.triangleCount <= TARGETS[0]) assert.equal(chain.levels[0].triangles, skin.triangleCount, `${name}: a skin under the first target is kept whole`);
  }
});

test('lod: deterministic across two runs for three coherent seeds and the presets', () => {
  const hashes = {};
  for (const name of Object.keys(SPECIMENS)) {
    const {src} = source(name);
    const a = chainHash(buildComposerLodChain(src, TARGETS)), b = chainHash(buildComposerLodChain({...src}, TARGETS));
    assert.equal(a, b, name);
    hashes[name] = a;
  }
  // three different seeds give three different chains (the hash is not trivially constant)
  assert.equal(new Set(SEEDS.map(s => hashes[s])).size, SEEDS.length);
  // a shorter target list is a prefix of the longer chain (one collapse sequence)
  const {src} = source('bird');
  const long = buildComposerLodChain(src, TARGETS), short = buildComposerLodChain(src, TARGETS.slice(0, 2));
  for (let i = 0; i < 2; i++) assert.deepEqual([...short.levels[i].index], [...long.levels[i].index]);
  console.log(Object.entries(hashes).map(([k, v]) => `${k} ${v.slice(0, 16)}`).join('\n'));
});

test('lod: sagittal symmetry survives and strict levels need no relaxation on the legged presets', () => {
  for (const name of ['bird', 'trunked-centipede', ...SEEDS]) {
    const chain = buildComposerLodChain(source(name).src, TARGETS);
    assert.ok(chain.mirrorPartners > 0, name);
    for (const [i, level] of chain.levels.entries()) {
      assert.ok(level.stats.mirrorKept >= (level.stats.relaxation >= 2 ? 0.85 : 0.95), `${name} level ${i}: mirror pairs kept ${level.stats.mirrorKept}`);
      if (i < 2) assert.equal(level.stats.relaxation, 0, `${name} level ${i}: strict rules suffice`);
    }
  }
  const off = buildComposerLodChain(source('bird').src, TARGETS, {symmetry: false});
  assert.equal(off.mirrorPartners, 0);
});

test('lod: skinning keeps the reduced surface on the posed source surface', () => {
  const v = new THREE.Vector3();
  for (const name of ['bird', 'centipede', 'export-test-1']) {
    const {src, creature, skin} = source(name);
    const chain = buildComposerLodChain(src, TARGETS);
    const diag = diagonal(skin.positions);
    const posed = [];
    for (const [motion, t] of [['walk', 0.31], ['display', 1.7]]) {
      creature.update(motion, t); creature.group.updateMatrixWorld(true);
      const P = new Float32Array(skin.positions.length);
      for (let i = 0; i < skin.vertexCount; i++) { creature.mesh.getVertexPosition(i, v); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
      posed.push(P);
    }
    // Levels 0 and 1 only. Level 2 (1000 triangles) is deliberately ungated: it is the far level (MSFT_screencoverage
    // 0.1 -> 0), may use relaxation stage 2 (unpaired collapses), and re-binds whole vertices to other bones
    // (maxWeightChange up to 2, plus float-summation overshoot). Its numbers are reported in the sidecar, not asserted.
    for (const [i, level] of chain.levels.slice(0, 2).entries()) {
      const rest = composerLodDeviation(skin.positions, level, {stride: 5});
      let worst = 0;
      for (const P of posed) worst = Math.max(worst, composerLodDeviation(skin.positions, level, {posed: P, stride: 5}).max);
      const line = `${name} level ${i} (${level.triangles} tri): rest max ${(100 * rest.max / diag).toFixed(2)}% diag, posed max ${(100 * worst / diag).toFixed(2)}% diag`;
      console.log(line);
      // gate: posing never adds more than 1% of the body diagonal to the rest deviation, and level 0 stays within 1%
      assert.ok(worst - rest.max <= 0.01 * diag, line);
      if (i === 0) assert.ok(worst <= 0.01 * diag, line);
    }
  }
});

test('lod: the reducer imports nothing and no composer core module imports it', () => {
  const lod = readFileSync(new URL('../src/fauna-composer-lod.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(lod, /^\s*import\s/m, 'fauna-composer-lod.ts is self-contained');
  const core = ['fauna-coat-fields.ts', 'fauna-coat-vocab.ts', 'fauna-composer-eye-catalogue.ts', 'fauna-composer-eye.ts', 'fauna-composer-face-geometry.ts', 'fauna-composer-face.ts',
    'fauna-composer-individual.ts', 'fauna-composer-mesh.ts', 'fauna-composer-recipe.ts', 'fauna-composer-rig.ts', 'fauna-composer-species.ts', 'fauna-composer.ts'];
  for (const f of core) assert.doesNotMatch(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), /fauna-composer-lod/, f);
  assert.ok(!/Math\.random\(|Date\.now\(|performance\.now\(/.test(lod), 'no randomness or clock in the reducer');
});
