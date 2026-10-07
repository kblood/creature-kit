// Headless creature GLB export (fauna-composer-export-1, backlog task 10). Checked without a GPU:
// - the GLB container and glTF structure (one skinned mesh, joints in graph order, weights summing to 1, budgets);
// - a second export of the same recipe is byte-identical, and so are the CLI's sidecar and brief;
// - clips round-trip through three's own GLTFLoader + AnimationMixer and, at every sampled key time, skin the mesh to
//   the same vertex positions as the runtime creature posed by poseComposer (createComposerCreature().update);
// - the export path imports only the 12-module composer core and three (the CLI adds only node: builtins);
// - the CLI refuses to overwrite a file whose bytes differ.
// assetctl validate/package run outside this repo (evidence: test-results/round2-2026-10-04/creature-export/).
// Export v2 (docs/creature-export-v2.md), self-relative except one core-keyed v1 pin:
// - with no v2 option the GLB is v1's byte for byte (pinned hashes apply only while the core sources are unchanged);
// - quest-3: an LOD chain on MSFT_lod nodes, every level within its target, the budget in the report and sidecar;
//   an export over budget fails with machine-readable reasons (library and CLI, nothing written);
// - LOD levels played by GLTFLoader + AnimationMixer skin exactly like the runtime vertices they came from;
// - seamless idle/display: first and last keys bit-identical, poseComposer(b + t) before the blend, other clips v1;
// - a v2 export is byte-identical on a second run, for three coherent seeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {COMPOSER_EXPORT_TARGETS, COMPOSER_EXPORT_V2_VERSION, COMPOSER_GLOSS_ATTRIBUTE, COMPOSER_EXPORT_VERSION, ComposerExportBudgetError, bakeComposerClip, bakeComposerLoopClip,
  checkComposerExportBudget, composerClipWindow, exportCreatureGlb, readComposerGlb} from '../src/fauna-composer-export.ts';
import {composerPreset, encodeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {coherentComposerSpecies} from '../src/fauna-composer-species.ts';
import {COMPOSER_BUDGET, buildComposerGraph, poseComposer} from '../src/fauna-composer-rig.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {CREATURE_EXPORT_BUDGET_EXIT, CREATURE_EXPORT_GENERATOR_SOURCES_V2, CREATURE_EXPORT_SIDECAR_SCHEMA, CREATURE_EXPORT_SIDECAR_SCHEMA_V2, briefExportOptions, buildCreatureFiles,
  generatorSourceHash, main as cliMain, parseArgs, parseLods, writeOnce} from '../scripts/export-creature.mjs';

const SPECIMENS = {
  bird: composerPreset('bird'),            // biped, feathered wings (scale channels), fast walk
  centipede: composerPreset('centipede'),  // 79 joints
  worm: composerPreset('worm'),            // limbless crawl, peristaltic scale, static neutral
  'winged-ape-rhino': composerPreset('winged-ape-rhino'),
  coherent: coherentComposerSpecies('export-test-1').recipe,
};
const cache = new Map();
const exported = name => { if (!cache.has(name)) cache.set(name, exportCreatureGlb(SPECIMENS[name])); return cache.get(name); };
const accessorArray = (json, bin, index) => {
  const a = json.accessors[index], v = json.bufferViews[a.bufferView];
  const C = {5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array}[a.componentType];
  const n = {SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16}[a.type] * a.count;
  return new C(bin.buffer.slice(bin.byteOffset + v.byteOffset + (a.byteOffset ?? 0), bin.byteOffset + v.byteOffset + (a.byteOffset ?? 0) + n * C.BYTES_PER_ELEMENT));
};

test('export: GLB container and glTF structure match the composer skin and graph', () => {
  for (const name of Object.keys(SPECIMENS)) {
    const {glb, report} = exported(name);
    const {json, bin} = readComposerGlb(glb);
    const effective = deriveComposerIndividual(SPECIMENS[name]).recipe, graph = buildComposerGraph(effective);
    assert.equal(json.asset.version, '2.0');
    assert.equal(json.asset.generator, `universe-atlas ${COMPOSER_EXPORT_VERSION}`);
    assert.equal(json.asset.extras.composer.recipeText, encodeComposerRecipe(SPECIMENS[name]));
    assert.equal(json.meshes.length, 1); assert.equal(json.meshes[0].primitives.length, 1); assert.equal(json.skins.length, 1);
    const prim = json.meshes[0].primitives[0];
    assert.deepEqual(Object.keys(prim.attributes), ['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0', COMPOSER_GLOSS_ATTRIBUTE]);
    // joints: one per graph bone, graph order and names, at most the composer budget
    const joints = json.skins[0].joints;
    assert.equal(joints.length, graph.bones.length, name);
    assert.ok(joints.length <= COMPOSER_BUDGET.maxBones);
    assert.deepEqual(joints.map(j => json.nodes[j].name), graph.bones.map(b => b.name));
    // triangles = index length / 3, and equal to the report and to the runtime skin
    const index = accessorArray(json, bin, prim.indices);
    assert.equal(index.length / 3, report.mesh.triangles);
    const runtime = createComposerCreature(SPECIMENS[name]);
    try {
      assert.equal(report.mesh.triangles, runtime.skin.triangleCount);
      assert.equal(json.accessors[prim.attributes.POSITION].count, runtime.skin.vertexCount);
      assert.deepEqual([...accessorArray(json, bin, prim.attributes.POSITION)], [...runtime.skin.positions]);
      assert.deepEqual([...index], [...runtime.skin.index]);
    } finally { runtime.dispose(); }
    // every weight row sums to 1 (float32) and names valid joints
    const w = accessorArray(json, bin, prim.attributes.WEIGHTS_0), j = accessorArray(json, bin, prim.attributes.JOINTS_0);
    for (let v = 0; v < w.length; v += 4) {
      const sum = w[v] + w[v + 1] + w[v + 2] + w[v + 3];
      assert.ok(Math.abs(sum - 1) <= 1e-6, `${name} vertex ${v / 4} weight sum ${sum}`);
      for (let k = 0; k < 4; k++) assert.ok(j[v + k] < joints.length);
    }
    assert.equal(report.repairs.zeroNormals, 0, `${name}: no zero-length normals to patch`);
    assert.ok(report.repairs.maxWeightChange < 1e-6, `${name}: weight repair is float rounding only (${report.repairs.maxWeightChange})`);
    // every buffer view lies inside the BIN chunk, 4-byte aligned
    for (const v of json.bufferViews) { assert.equal(v.byteOffset % 4, 0); assert.ok(v.byteOffset + v.byteLength <= bin.byteLength); }
    assert.deepEqual(json.animations.map(a => a.name), ['neutral', 'idle', 'walk', 'display']);
  }
});

test('export: a second export of the same recipe is byte-identical (GLB, sidecar and brief)', () => {
  for (const name of ['bird', 'coherent']) {
    const a = exportCreatureGlb(SPECIMENS[name]).glb, b = exportCreatureGlb({...SPECIMENS[name]}).glb;
    assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0, name);
    assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(exported(name).glb)), 0, name);
  }
  const hash = generatorSourceHash();
  const one = buildCreatureFiles({kind: 'preset', preset: 'ape'}, {}, hash), two = buildCreatureFiles({kind: 'preset', preset: 'ape'}, {}, hash);
  assert.equal(one.key, two.key);
  for (let i = 0; i < one.files.length; i++) {
    assert.equal(one.files[i][0], two.files[i][0]);
    assert.equal(Buffer.compare(Buffer.from(one.files[i][1]), Buffer.from(two.files[i][1])), 0, one.files[i][0]);
  }
});

test('export: recipe text and recipe object export the same bytes; options are validated', () => {
  const text = encodeComposerRecipe(SPECIMENS.bird);
  assert.equal(Buffer.compare(Buffer.from(exportCreatureGlb(text, {clips: ['walk']}).glb), Buffer.from(exportCreatureGlb(SPECIMENS.bird, {clips: ['walk']}).glb)), 0);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {clips: ['run']}), /unknown motion/);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {clips: ['walk', 'walk']}), /listed twice/);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {gloss: 'shiny'}), /gloss/);
  assert.throws(() => exportCreatureGlb('v9*layout_biped'), /Unsupported composer recipe version/);
  for (const fps of [0.01, 0, NaN, 241]) assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {fps, clips: []}), /fps/, String(fps));
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {clips: [{motion: 'walk', fps: 0.5}]}), /fps/);
  const dropped = readComposerGlb(exportCreatureGlb(SPECIMENS.bird, {gloss: 'drop', clips: []}).glb).json;
  assert.ok(!(COMPOSER_GLOSS_ATTRIBUTE in dropped.meshes[0].primitives[0].attributes));
  assert.equal(dropped.animations, undefined);
});

test('export: clip windows are measured, walk loops on whole gait periods, a static motion bakes two keys', () => {
  const worm = buildComposerGraph(deriveComposerIndividual(SPECIMENS.worm).recipe);
  assert.deepEqual(composerClipWindow(worm, 'neutral'), {duration: 1, keys: 2, seamPosition: 0, seamAngle: 0, seamScale: 0, seamless: true, method: 'static'});
  const bird = buildComposerGraph(deriveComposerIndividual(SPECIMENS.bird).recipe);
  const walk = composerClipWindow(bird, 'walk');
  assert.equal(walk.method, 'gait-periods');
  assert.ok(walk.seamless, `bird walk loops (seam ${walk.seamPosition} m, ${walk.seamAngle} rad)`);
  assert.ok(Math.abs(walk.duration / bird.locomotion.period - Math.round(walk.duration / bird.locomotion.period)) < 1e-12);
  const baked = bakeComposerClip(bird, 'walk', walk);
  assert.equal(baked.times.length, walk.keys);
  assert.equal(baked.times[0], 0); assert.equal(baked.times[walk.keys - 1], Math.fround(walk.duration));
  // quaternion keys stay in one hemisphere
  for (const q of baked.rotation) for (let k = 4; k < q.length; k += 4) assert.ok(q[k] * q[k - 4] + q[k + 1] * q[k - 3] + q[k + 2] * q[k - 2] + q[k + 3] * q[k - 1] >= 0);
  // a crawl's travelling wave recurs between gait periods and between 1/fps grid points: the refined search closes it
  // (Astra review: a slim-torso worm took 2.937 s with a 12.7 mm / 6.4 deg seam; its track period is ~3.0346 s)
  const slim = buildComposerGraph(deriveComposerIndividual({...SPECIMENS.worm, torso: 'slim'}).recipe);
  const crawl = composerClipWindow(slim, 'walk');
  assert.ok(crawl.seamless, `slim worm crawl closes (${crawl.duration} s, seam ${crawl.seamPosition} m, ${crawl.seamAngle} rad)`);
  assert.ok(Math.abs(crawl.duration - 3.0346) < 0.01, `slim worm crawl window ${crawl.duration} s`);
  // the report carries every clip's seam honestly
  for (const c of exported('bird').report.clips) assert.equal(c.seamless, c.seamPosition <= 5e-4 && c.seamAngle <= 0.25 * Math.PI / 180 && c.seamScale <= 1e-3, c.motion);
});

const loadGlb = glb => new Promise((resolve, reject) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));

test('export: clips played by three\'s GLTFLoader + AnimationMixer skin the mesh exactly like poseComposer', async () => {
  const fwd = new THREE.Matrix4().makeRotationY(-Math.PI / 2); // exported +Z front
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const lines = [];
  for (const name of Object.keys(SPECIMENS)) {
    const {glb, report} = exported(name);
    const gltf = await loadGlb(glb);
    let skinned = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh) skinned = o; });
    assert.ok(skinned, `${name}: a SkinnedMesh`);
    assert.equal(skinned.skeleton.bones.length, report.mesh.bones);
    const runtime = createComposerCreature(SPECIMENS[name]);
    const graph = runtime.graph;
    const mixer = new THREE.AnimationMixer(gltf.scene);
    try {
      for (const clip of gltf.animations) {
        const spec = report.clips.find(c => c.motion === clip.name);
        assert.ok(Math.abs(clip.duration - spec.duration) < 1e-5, `${name} ${clip.name} duration`);
        mixer.stopAllAction();
        // LoopOnce + clamp: the last key is played as the last key (LoopRepeat would wrap t = duration to t = 0)
        const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.reset().play();
        const at = t => { action.reset(); action.time = t; mixer.update(0); gltf.scene.updateMatrixWorld(true); };
        // 1) every stored key: joint translation, rotation and scale under the skeleton root equal poseComposer
        let worstBone = 0, keysChecked = 0;
        for (let k = 0; k < spec.keys; k++) {
          const t = spec.duration * k / (spec.keys - 1 || 1);
          at(t);
          const pose = poseComposer(graph, clip.name, t);
          skinned.skeleton.bones.forEach((bone, i) => {
            for (let c = 0; c < 3; c++) worstBone = Math.max(worstBone, Math.abs(bone.position.getComponent(c) - pose.positions[i * 3 + c]));
            const q = bone.quaternion, dot = Math.abs(q.x * pose.quaternions[i * 4] + q.y * pose.quaternions[i * 4 + 1] + q.z * pose.quaternions[i * 4 + 2] + q.w * pose.quaternions[i * 4 + 3]);
            worstBone = Math.max(worstBone, 1 - dot);
            const radial = pose.radialScale[i], chord = pose.chordScale[i];
            worstBone = Math.max(worstBone, Math.abs(bone.scale.x - 1), Math.abs(bone.scale.y - radial), Math.abs(bone.scale.z - radial * chord));
          });
          keysChecked++;
        }
        assert.equal(keysChecked, spec.keys);
        // 2) skinning: at ~8 key times including the last, and halfway between keys, every 7th vertex against the runtime
        let worstKey = 0, worstMid = 0, vertexSamples = 0;
        const step = Math.max(1, Math.floor((spec.keys - 1) / 7)), sampleKeys = new Set([spec.keys - 1]);
        for (let k = 0; k < spec.keys; k += step) sampleKeys.add(k);
        for (const k of [...sampleKeys].sort((x, y) => x - y)) for (const mid of [0, 0.5]) {
          if (mid && k >= spec.keys - 1) continue;
          const t = spec.duration * (k + mid) / (spec.keys - 1 || 1);
          at(t);
          runtime.update(clip.name, t); runtime.group.updateMatrixWorld(true);
          let worst = 0;
          for (let v = 0; v < skinned.geometry.attributes.position.count; v += 7) {
            skinned.getVertexPosition(v, a).applyMatrix4(skinned.matrixWorld);
            runtime.mesh.getVertexPosition(v, b).applyMatrix4(fwd);
            worst = Math.max(worst, a.distanceTo(b)); vertexSamples++;
          }
          if (mid) worstMid = Math.max(worstMid, worst); else worstKey = Math.max(worstKey, worst);
        }
        assert.ok(vertexSamples > 0);
        lines.push(`${name} ${clip.name}: ${spec.keys} keys all checked (joint TRS ${worstBone.toExponential(1)}), vertex error at ${sampleKeys.size} keys ${worstKey.toExponential(1)} m, between keys ${worstMid.toExponential(1)} m`);
        assert.ok(worstBone < 2e-6, `${name} ${clip.name}: joint TRS differs from poseComposer by ${worstBone}`);
        assert.ok(worstKey < 2e-6, `${name} ${clip.name}: skinned vertices at key times differ from the runtime by ${worstKey} m`);
        // linear interpolation between 30 fps keys: a sanity bound only (bird walk: ~3 mm)
        assert.ok(worstMid < 0.02, `${name} ${clip.name}: between-key interpolation error ${worstMid} m`);
      }
    } finally { runtime.dispose(); }
  }
  console.log(lines.join('\n'));
});

const specifiers = (path, kind) => {
  const sf = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')))
      out.push(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : '<non-literal>');
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) out.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};
const CORE = new Set(['fauna-coat-fields.ts', 'fauna-coat-vocab.ts', 'fauna-composer-eye-catalogue.ts', 'fauna-composer-eye.ts', 'fauna-composer-face-geometry.ts',
  'fauna-composer-face.ts', 'fauna-composer-individual.ts', 'fauna-composer-mesh.ts', 'fauna-composer-recipe.ts', 'fauna-composer-rig.ts', 'fauna-composer-species.ts', 'fauna-composer.ts']);

test('export: the export path imports only the composer core, the LOD reducer and three (the CLI adds node: builtins)', () => {
  // the core itself is closed (tests/creature-core-boundary.test.mjs); so the export path never reaches an Atlas module
  const leaks = specifiers('src/fauna-composer-export.ts', ts.ScriptKind.TS).filter(s => s !== 'three' && s !== './fauna-composer-lod.ts' && !CORE.has(/^\.\/([^/]+\.ts)$/.exec(s)?.[1]));
  assert.deepEqual(leaks, []);
  assert.deepEqual(specifiers('src/fauna-composer-lod.ts', ts.ScriptKind.TS), [], 'the LOD reducer imports nothing');
  const cli = specifiers('scripts/export-creature.mjs', ts.ScriptKind.JS).filter(s => !s.startsWith('node:') && !(s === '../src/fauna-composer-export.ts' || CORE.has(/^\.\.\/src\/([^/]+\.ts)$/.exec(s)?.[1])));
  assert.deepEqual(cli, []);
});

test('export CLI: sidecar and brief carry provenance; an existing file is never overwritten', () => {
  const built = buildCreatureFiles({kind: 'coherent-species', seed: 'export-test-1'});
  const sidecar = built.sidecar;
  assert.equal(sidecar.schema, CREATURE_EXPORT_SIDECAR_SCHEMA);
  assert.match(sidecar.generator.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(sidecar.recipeText, encodeComposerRecipe(SPECIMENS.coherent));
  assert.equal(sidecar.source.seed, 'export-test-1');
  assert.equal(sidecar.asset.sha256.length, 64);
  // asset-provenance v1: generated assets need generator, prompt and seed; the licence stays NOASSERTION (owner question)
  const p = sidecar.provenance;
  assert.equal(p.sourceType, 'generated');
  assert.ok(p.generator.provider && p.generator.model && p.prompt && p.seed);
  assert.equal(p.license.expression, 'NOASSERTION');
  const brief = JSON.parse(new TextDecoder().decode(built.files.find(([n]) => n.endsWith('.brief.json'))[1]));
  assert.match(brief.id, /^[a-z0-9][a-z0-9-]{2,63}$/);
  assert.equal(brief.kind, 'creature');
  assert.deepEqual(brief.provenance, p);
  assert.doesNotMatch(new TextDecoder().decode(built.files[1][1]), /20\d\d-\d\d-\d\dT/, 'no timestamp in the sidecar');
  const dir = mkdtempSync(join(tmpdir(), 'creature-export-'));
  try {
    const path = join(dir, 'x.bin');
    assert.equal(writeOnce(path, new Uint8Array([1, 2, 3])), 'written');
    assert.equal(writeOnce(path, new Uint8Array([1, 2, 3])), 'identical');
    assert.throws(() => writeOnce(path, new Uint8Array([1, 2, 4])), /refusing to overwrite/);
    assert.deepEqual([...readFileSync(path)], [1, 2, 3]);
  } finally { rmSync(dir, {recursive: true, force: true}); }
  assert.throws(() => parseArgs(['--preset', 'all']), /--out/);
  assert.throws(() => parseArgs(['--out', 'x']), /nothing selected/);
  assert.throws(() => parseArgs(['--out', 'x', '--preset', 'unicorn']), /unknown preset/);
  assert.throws(() => parseArgs(['--out', 'x', '--preset', 'ape', '--motions', ',']), /at least one motion/);
  assert.throws(() => parseArgs(['--out', 'x', '--preset', 'ape', '--fps', 'NaN']), /--fps/);
  assert.throws(() => buildCreatureFiles({kind: 'preset', preset: 'ape'}, {motions: []}), /no motions/);
  assert.equal(parseArgs(['--out', 'x', '--count', '3', '--seed-prefix', 'p']).selections.map(s => s.seed).join(), 'p-0,p-1,p-2');
});

// ------------------------------------------------------------------ export v2

/** v1 GLB sha256 per specimen, exported by fauna-composer-export-1 at main 5450d9d. They hold while the 12 composer-core
 * sources hash to `core` (generatorSourceHash format); when the core moves (skin version, composer-stability work) the
 * byte comparison is skipped with a diagnostic and the self-relative checks still run. Regenerate by exporting the
 * specimens with no v2 option on the new core.
 * 2026-10-07: core re-keyed e49fc2ec… -> 84d9d6fd… after the fauna/composer-stability merge (proboscis-ear clamp);
 * all five GLB shas regenerated on the new core were byte-identical to the pins below, so only `core` changed.
 * 2026-10-07: core re-keyed 84d9d6fd… -> a0a31556… after the midline-ocellus seamNormal package (fauna/ocellus-seam, D2/D4);
 * none of the five specimens has the midline insect ocellus: their skins (positions, index, weights, colours, gloss)
 * are identical before and after, and all five GLB shas are byte-identical to the pins below, so only `core` changed. */
const V1_PINS = {
  core: 'a0a315563251220cedb09cb760b07a80de3441a0c863bf981c513249f6148f5c',
  glb: {
    bird: 'bb87f35b228bab8a7ec375aad1ff3b7e91562e984df641d2cc067a43417a7a0f',
    centipede: '709abe3ce33ccfaff18ce5b55e877a4016cbe492b2bd663127d559f3cb933786',
    worm: '86fecc903ec8f19bda2c89db1012fff514a493b01b3ca38a03c543176f54be00',
    'winged-ape-rhino': 'ae1784773193c049f6a4f9ff9749c76085a2d8b61eaf02d256c37ded648aedb7',
    coherent: '01b43824c05d6733afe0bc769ea20bf2b5b3596be7f0b225293106e05d637965',
  },
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let questBirdCache = null;
const questBird = () => questBirdCache ??= exportCreatureGlb(SPECIMENS.bird, {target: 'quest-3', seamless: true});

test('export v2: with no v2 option the GLB is v1 byte for byte', t => {
  for (const name of Object.keys(SPECIMENS)) {
    const v1 = exported(name);
    // flags spelled out as off give the same bytes as no options at all
    assert.equal(sha(exportCreatureGlb(SPECIMENS[name], {lods: false, seamless: false}).glb), sha(v1.glb), name);
    assert.equal(v1.report.version, COMPOSER_EXPORT_VERSION);
    assert.equal(v1.report.lods, undefined); assert.equal(v1.report.budget, undefined);
    assert.equal(readComposerGlb(v1.glb).json.extensionsUsed, undefined);
  }
  const core = generatorSourceHash(undefined, [...CORE].map(f => `src/${f}`));
  if (core !== V1_PINS.core) { t.diagnostic(`composer core moved (${core.slice(0, 12)} != ${V1_PINS.core.slice(0, 12)}): v1 byte pins not applicable`); return; }
  for (const [name, pin] of Object.entries(V1_PINS.glb)) assert.equal(sha(exported(name).glb), pin, `${name}: v1 bytes`);
});

/** REPORT-ONLY bone sweep (D4, docs/creature-export-v2.md "Budget ledger"): joint counts of the composer graph, as the
 * exporter builds it (individual-derived recipe), for 100 coherent species (the CLI's --seed/--count path) and 100 raw
 * random recipes. It prints a histogram and the number over the quest-3 limit; it asserts nothing about the limit. */
function boneSweep(recipeOf) {
  const counts = [];
  for (let i = 0; i < 100; i++) counts.push(buildComposerGraph(deriveComposerIndividual(recipeOf(`bone-sweep-${i}`)).recipe).bones.length);
  const bins = new Map();
  for (const n of counts) { const lo = Math.floor(n / 10) * 10; bins.set(lo, (bins.get(lo) ?? 0) + 1); }
  const limit = COMPOSER_EXPORT_TARGETS['quest-3'].budget.maxBones;
  return {limit, min: Math.min(...counts), max: Math.max(...counts), over: counts.filter(n => n > limit).length,
    histogram: [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([lo, k]) => `${lo}-${lo + 9}:${k}`).join(' ')};
}
test('export v2: bone sweep over 100 seeds (report only, the quest-3 limit is not asserted)', t => {
  for (const [label, recipeOf] of [['coherent species', seed => coherentComposerSpecies(seed).recipe], ['random recipes', seed => randomComposerRecipe(seed)]]) {
    const s = boneSweep(recipeOf);
    t.diagnostic(`bone sweep, ${label} bone-sweep-0..99: joints ${s.min}..${s.max}, histogram ${s.histogram}; over the quest-3 limit of ${s.limit}: ${s.over} of 100`);
    assert.ok(s.min > 0 && s.max <= COMPOSER_BUDGET.maxBones, `${label}: every graph within the composer's own cap`);
  }
});

test('export v2: quest-3 writes an MSFT_lod chain within budget and reports it', () => {
  const {glb, report} = questBird();
  const {json, bin} = readComposerGlb(glb);
  assert.equal(report.version, COMPOSER_EXPORT_V2_VERSION);
  assert.equal(json.asset.generator, `universe-atlas ${COMPOSER_EXPORT_V2_VERSION}`);
  assert.equal(json.asset.extras.composer.versions.export, COMPOSER_EXPORT_V2_VERSION);
  assert.deepEqual(json.extensionsUsed, ['MSFT_lod']);
  assert.equal(json.extensionsRequired, undefined, 'MSFT_lod stays optional: a plain loader shows level 0');
  const targets = COMPOSER_EXPORT_TARGETS['quest-3'].lods;
  assert.equal(json.meshes.length, targets.length);
  const ids = json.nodes[0].extensions.MSFT_lod.ids;
  assert.equal(ids.length, targets.length - 1);
  assert.equal(json.nodes[0].extras.MSFT_screencoverage.length, targets.length);
  assert.deepEqual(json.scenes[0].nodes, [0, 1], 'LOD nodes stay outside the scene');
  ids.forEach((id, i) => { assert.equal(json.nodes[id].mesh, i + 1); assert.equal(json.nodes[id].skin, 0); });
  assert.equal(report.lods.length, targets.length);
  report.lods.forEach((l, i) => {
    const prim = json.meshes[i].primitives[0];
    const tri = json.accessors[prim.indices].count / 3;
    assert.equal(tri, l.triangles); assert.equal(l.target, targets[i]);
    assert.ok(l.reached && tri <= targets[i], `level ${i}: ${tri} <= ${targets[i]}`);
    assert.equal(json.accessors[prim.attributes.POSITION].count, l.vertices);
    assert.equal(l.sourceVertex.length, l.vertices);
    assert.deepEqual(Object.keys(prim.attributes), ['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0', COMPOSER_GLOSS_ATTRIBUTE]);
    const w = accessorArray(json, bin, prim.attributes.WEIGHTS_0);
    for (let v = 0; v < w.length; v += 4) assert.ok(Math.abs(w[v] + w[v + 1] + w[v + 2] + w[v + 3] - 1) <= 1e-6);
    assert.equal(json.meshes[i].extras.composer.parts.reduce((s, p) => s + p.triangles, 0), tri);
    assert.deepEqual(json.meshes[i].extras.composer.lod, {level: i, target: targets[i], triangles: tri});
  });
  assert.equal(report.mesh.triangles, report.lods[0].triangles);
  assert.deepEqual(report.budget.limits, {...COMPOSER_EXPORT_TARGETS['quest-3'].budget});
  assert.equal(report.budget.pass, true);
  assert.ok(report.mesh.bones <= report.budget.limits.maxBones);
  for (const v of json.bufferViews) { assert.equal(v.byteOffset % 4, 0); assert.ok(v.byteOffset + v.byteLength <= bin.byteLength); }
  // a brief can tighten the budget but not loosen it
  const loose = exportCreatureGlb(SPECIMENS.bird, {target: 'quest-3', clips: [], budget: {maxTriangles: 1e6, maxBones: 500}}).report.budget.limits;
  assert.equal(loose.maxTriangles, 8000); assert.equal(loose.maxBones, 80);
  // desktop-web with seamless only: one mesh, v2 version, desktop budget
  const desk = exportCreatureGlb(SPECIMENS.bird, {seamless: true, clips: ['idle']});
  assert.equal(desk.report.target, 'desktop-web'); assert.equal(desk.report.lods.length, 1);
  assert.equal(readComposerGlb(desk.glb).json.extensionsUsed, undefined);
});

test('export v2: a quest-3 export over budget fails with machine-readable reasons', () => {
  const big = composerPreset('trunked-centipede');
  const fail = (options, check) => assert.throws(() => exportCreatureGlb(big, {clips: [], ...options}), e => {
    assert.ok(e instanceof ComposerExportBudgetError, String(e));
    assert.equal(e.code, 'composer-export-budget');
    const json = JSON.parse(JSON.stringify(e));
    assert.equal(json.error, 'composer-export-budget'); assert.equal(json.target, 'quest-3');
    check(json.reasons);
    return true;
  });
  // the unreduced skin as level 0 (trunked-centipede: ~28k triangles)
  fail({target: 'quest-3', lods: ['full', 3000, 1000]}, r => {
    assert.deepEqual(r.map(x => x.code), ['triangles']);
    assert.equal(r[0].level, 0); assert.equal(r[0].limit, 8000); assert.ok(r[0].actual > 8000, String(r[0].actual));
  });
  // a brief tighter than the chain, and a bone limit below the skeleton
  fail({target: 'quest-3', budget: {maxTriangles: 500}}, r => assert.deepEqual(r.map(x => [x.code, x.limit]), [['triangles', 500]]));
  fail({target: 'quest-3', budget: {maxBones: 10}}, r => assert.deepEqual(r.map(x => [x.code, x.limit]), [['bones', 10]]));
  // the check itself: every reason code
  const reasons = checkComposerExportBudget({maxTriangles: 10, maxBones: 1, maxMaterials: 0, maxTextureBytes: 0, maxDrawCallsPerLevel: 0},
    {bones: 2, materials: 1, textureBytes: 1, drawCallsPerLevel: 1, levels: [{triangles: 11, target: 8}, {triangles: 5, target: 4}]}).reasons;
  assert.deepEqual(reasons.map(r => r.code), ['triangles', 'lod-target', 'lod-target', 'bones', 'materials', 'texture-bytes', 'draw-calls']);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {target: 'quest-9'}), /unknown target/);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {lods: [3000, 'full']}), /'full' only first/);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {lods: [3000, 3000]}), /strictly decrease/);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {target: 'quest-3', budget: {maxTriangles: -1}}), /budget/);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {target: 'quest-3', budget: {maxPolys: 1}}), /unknown budget field/);
  assert.throws(() => exportCreatureGlb(SPECIMENS.bird, {seamless: true, seamlessBlend: 0}), /seamlessBlend/);
});

test('export v2: LOD levels played by GLTFLoader skin exactly like the runtime vertices they came from', async () => {
  const fwd = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const {glb, report} = questBird();
  const gltf = await loadGlb(glb);
  let level0 = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh) level0 = o; });
  assert.ok(level0);
  const lodMeshes = [level0];
  for (const id of gltf.parser.json.nodes[0].extensions.MSFT_lod.ids) {
    const node = await gltf.parser.getDependency('node', id);
    let mesh = null; node.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    assert.ok(mesh, `LOD node ${id} is a SkinnedMesh`);
    assert.equal(mesh.skeleton.bones.length, level0.skeleton.bones.length);
    mesh.skeleton.bones.forEach((bone, i) => assert.equal(bone, level0.skeleton.bones[i], 'LOD levels share the joint nodes'));
    lodMeshes.push(mesh);
  }
  const runtime = createComposerCreature(SPECIMENS.bird);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const lines = [];
  try {
    for (const motion of ['walk', 'display']) {
      const clip = gltf.animations.find(c => c.name === motion), spec = report.clips.find(c => c.motion === motion);
      mixer.stopAllAction();
      const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.reset().play();
      // keys outside a crossfade blend (where the clip is poseComposer(sourceStart + t))
      const end = spec.crossfade ? spec.duration - spec.crossfade.blendSeconds : spec.duration;
      const ks = [0, Math.floor(spec.keys / 3), Math.floor(spec.keys / 2), spec.keys - 1].filter(k => spec.duration * k / (spec.keys - 1) < end || (!spec.crossfade && k === spec.keys - 1));
      let worst = 0, samples = 0;
      for (const k of ks) {
        const t = spec.duration * k / (spec.keys - 1);
        action.reset(); action.time = t; mixer.update(0); gltf.scene.updateMatrixWorld(true);
        runtime.update(motion, spec.crossfade ? spec.crossfade.sourceStart + t : t); runtime.group.updateMatrixWorld(true);
        lodMeshes.forEach((mesh, level) => {
          mesh.updateMatrixWorld(true);
          const sv = report.lods[level].sourceVertex;
          for (let v = 0; v < sv.length; v += 5) {
            mesh.getVertexPosition(v, a).applyMatrix4(mesh.matrixWorld);
            runtime.mesh.getVertexPosition(sv[v], b).applyMatrix4(fwd);
            worst = Math.max(worst, a.distanceTo(b)); samples++;
          }
        });
      }
      lines.push(`bird quest-3 ${motion}: ${lodMeshes.length} levels x ${ks.length} keys, ${samples} vertex samples, worst skinned LOD vertex vs runtime ${worst.toExponential(1)} m`);
      assert.ok(ks.length >= 2 && samples > 0);
      assert.ok(worst < 2e-6, lines[lines.length - 1]);
    }
  } finally { runtime.dispose(); }
  console.log(lines.join('\n'));
});

test('export v2: seamless idle and display close bit for bit and equal poseComposer(b + t) before the blend', () => {
  const recipe = SPECIMENS.bird;
  const graph = buildComposerGraph(deriveComposerIndividual(recipe).recipe);
  const v2 = exportCreatureGlb(recipe, {seamless: true, clips: ['idle', 'walk', 'display']});
  const v1 = exportCreatureGlb(recipe, {clips: ['idle', 'walk', 'display']});
  const d2 = readComposerGlb(v2.glb), d1 = readComposerGlb(v1.glb);
  assert.equal(v2.report.version, COMPOSER_EXPORT_V2_VERSION);
  const lines = [];
  for (const motion of ['idle', 'display']) {
    const spec = v2.report.clips.find(c => c.motion === motion), raw = v1.report.clips.find(c => c.motion === motion);
    assert.equal(spec.method, 'crossfade'); assert.equal(spec.seamless, true);
    assert.equal(spec.seamPosition, 0); assert.equal(spec.seamAngle, 0);
    assert.equal(spec.duration, raw.duration); assert.equal(spec.keys, raw.keys);
    assert.equal(spec.crossfade.rawSeamPosition, raw.seamPosition);
    assert.ok(spec.crossfade.blendSeconds > 0 && spec.crossfade.blendSeconds <= spec.duration / 2);
    const anim = d2.json.animations.find(x => x.name === motion);
    assert.equal(anim.extras.composer.seamless, true);
    assert.deepEqual(anim.extras.composer.crossfade, {blendSeconds: spec.crossfade.blendSeconds, sourceStart: spec.crossfade.sourceStart});
    let worstPose = 0, worstStep = 0, wrapStep = 0, poseKeys = 0;
    for (const ch of anim.channels) {
      const sampler = anim.samplers[ch.sampler];
      const out = accessorArray(d2.json, d2.bin, sampler.output), keys = accessorArray(d2.json, d2.bin, sampler.input).length;
      const c = {translation: 3, rotation: 4, scale: 3}[ch.target.path], bone = ch.target.node - 2;
      // 1) the loop closes bit for bit
      const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      assert.deepEqual([...bytes.subarray((keys - 1) * c * 4, keys * c * 4)], [...bytes.subarray(0, c * 4)], `${motion} bone ${bone} ${ch.target.path}: last key bytes = first key bytes`);
      // 2) outside the blend each key is the source pose at b + t
      for (let k = 0; k < keys; k += 3) {
        const t = spec.duration * k / (keys - 1);
        if (t >= spec.duration - spec.crossfade.blendSeconds) break;
        const pose = poseComposer(graph, motion, spec.crossfade.sourceStart + t);
        const ref = ch.target.path === 'translation' ? [0, 1, 2].map(i => pose.positions[bone * 3 + i])
          : ch.target.path === 'rotation' ? [0, 1, 2, 3].map(i => pose.quaternions[bone * 4 + i])
          : [1, pose.radialScale[bone], pose.radialScale[bone] * pose.chordScale[bone]];
        const sign = ch.target.path === 'rotation' && ref.reduce((s, x, i) => s + x * out[k * c + i], 0) < 0 ? -1 : 1;
        for (let i = 0; i < c; i++) worstPose = Math.max(worstPose, Math.abs(out[k * c + i] - sign * ref[i]));
        poseKeys++;
      }
      // 3) the wrap step (key K-2 -> key K-1, which equals key 0) is no larger than the largest ordinary step
      for (let k = 1; k < keys; k++) {
        let step = 0; for (let i = 0; i < c; i++) step = Math.max(step, Math.abs(out[k * c + i] - out[(k - 1) * c + i]));
        if (k === keys - 1) wrapStep = Math.max(wrapStep, step); else worstStep = Math.max(worstStep, step);
      }
    }
    lines.push(`bird ${motion}: ${spec.keys} keys, blend ${spec.crossfade.blendSeconds} s, raw seam ${(raw.seamPosition * 1000).toFixed(2)} mm / ${(raw.seamAngle * 180 / Math.PI).toFixed(3)} deg -> 0 (bit-identical); ${poseKeys} channel keys before the blend, worst vs poseComposer ${worstPose.toExponential(1)}; wrap step ${wrapStep.toExponential(2)} vs largest other step ${worstStep.toExponential(2)}`);
    assert.ok(poseKeys > 0);
    assert.ok(worstPose < 2e-6, `${motion}: keys before the blend equal poseComposer(b + t) (${worstPose})`);
    assert.ok(wrapStep <= worstStep + 1e-7, `${motion}: the wrap is no jump (${wrapStep} vs ${worstStep})`);
  }
  // walk is untouched by the seamless flag: its channel data equal v1's
  const walk2 = d2.json.animations.find(x => x.name === 'walk'), walk1 = d1.json.animations.find(x => x.name === 'walk');
  assert.equal(walk2.channels.length, walk1.channels.length);
  walk2.samplers.forEach((s, i) => {
    assert.deepEqual([...accessorArray(d2.json, d2.bin, s.output)], [...accessorArray(d1.json, d1.bin, walk1.samplers[i].output)]);
    assert.deepEqual([...accessorArray(d2.json, d2.bin, s.input)], [...accessorArray(d1.json, d1.bin, walk1.samplers[i].input)]);
  });
  assert.deepEqual(v2.report.clips.find(c => c.motion === 'walk'), v1.report.clips.find(c => c.motion === 'walk'));
  // a static neutral stays static
  assert.equal(exportCreatureGlb(SPECIMENS.worm, {seamless: true, clips: ['neutral']}).report.clips[0].method, 'static');
  assert.throws(() => bakeComposerLoopClip(graph, 'walk', {duration: 2, keys: 61}, 0.5), /travels/);
  assert.throws(() => bakeComposerLoopClip(graph, 'idle', {duration: 2, keys: 61}, 1.5), /crossfade/);
  console.log(lines.join('\n'));
});

test('export v2: deterministic, byte-identical on a second export for three coherent seeds', () => {
  const lines = [];
  for (const seed of ['export-test-1', 'export-test-2', 'export-test-3']) {
    const recipe = coherentComposerSpecies(seed).recipe;
    const opts = {target: 'quest-3', seamless: true, clips: ['idle', 'walk']};
    const one = exportCreatureGlb(recipe, opts), two = exportCreatureGlb(structuredClone(recipe), {...opts});
    assert.equal(sha(one.glb), sha(two.glb), seed);
    one.report.lods.forEach((l, i) => assert.ok(l.triangles <= COMPOSER_EXPORT_TARGETS['quest-3'].lods[i], `${seed} level ${i}`));
    lines.push(`${seed}: ${sha(one.glb).slice(0, 16)} lods ${one.report.lods.map(l => l.triangles).join('/')}`);
  }
  assert.equal(new Set(lines.map(l => l.split(' ')[1])).size, 3, 'three seeds, three different GLBs');
  console.log(lines.join('\n'));
});

test('export v2 CLI: brief options, sidecar-2 with the LOD chain, budget failure exits 3 and writes nothing', () => {
  assert.deepEqual(parseLods('full,8000,3000'), ['full', 8000, 3000]);
  assert.equal(parseLods('none'), false);
  assert.throws(() => parseLods('full,abc'), /not 'full' or an integer/);
  assert.throws(() => parseArgs(['--out', 'x', '--preset', 'ape', '--target', 'quest-4']), /--target/);
  const args = parseArgs(['--out', 'x', '--preset', 'ape', '--target', 'quest-3', '--lods', '8000,2000', '--seamless', '--seamless-blend', '0.5', '--brief', 'b.json']);
  assert.deepEqual([args.target, args.lods, args.seamless, args.seamlessBlend, args.brief], ['quest-3', [8000, 2000], true, 0.5, 'b.json']);
  const template = JSON.parse(readFileSync(new URL('../assets/briefs/creature-export-quest-3.json', import.meta.url), 'utf8'));
  assert.deepEqual(briefExportOptions(template), {target: 'quest-3', budget: {maxTriangles: 8000, maxMaterials: 1}, lods: [8000, 3000, 1000]});
  assert.deepEqual(briefExportOptions({...template, target: {...template.target, devices: ['desktop-web']}, constraints: {geometry: {lodCount: 0}}}), {target: 'desktop-web', budget: {}, lods: false});
  assert.throws(() => briefExportOptions({...template, kind: 'static-prop'}), /kind must be creature/);
  assert.throws(() => briefExportOptions({...template, constraints: {geometry: {lodCount: 5}}}), /exceeds/);

  const options = {briefJson: template, seamless: true, motions: ['idle', 'walk']};
  const built = buildCreatureFiles({kind: 'preset', preset: 'bird'}, options);
  const sidecar = built.sidecar;
  assert.equal(sidecar.schema, CREATURE_EXPORT_SIDECAR_SCHEMA_V2);
  assert.deepEqual(sidecar.generator.sources, CREATURE_EXPORT_GENERATOR_SOURCES_V2);
  assert.ok(sidecar.generator.sources.includes('src/fauna-composer-lod.ts'));
  assert.equal(sidecar.generator.sourceSha256, generatorSourceHash(undefined, CREATURE_EXPORT_GENERATOR_SOURCES_V2));
  assert.equal(sidecar.target, 'quest-3');
  assert.match(sidecar.status, /^experimental/);
  assert.deepEqual(sidecar.lods.map(l => l.target), [8000, 3000, 1000]);
  assert.ok(sidecar.lods.every(l => l.triangles <= l.target && !('sourceVertex' in l)));
  assert.equal(sidecar.budget.pass, true); assert.equal(sidecar.budget.limits.maxTriangles, 8000);
  assert.equal(sidecar.provenance.license.expression, 'NOASSERTION');
  const brief = JSON.parse(new TextDecoder().decode(built.files.find(([n]) => n.endsWith('.brief.json'))[1]));
  assert.deepEqual(brief.target.devices, ['quest-3']);
  assert.deepEqual(brief.constraints.geometry, {maxTriangles: 8000, maxMaterials: 1, lodCount: 2, collision: 'none'});
  assert.ok(brief.deliverables.some(d => d.type === 'lod' && d.format === 'glb-msft-lod'));
  assert.equal(brief.provenance.license.expression, 'NOASSERTION');
  // a second build is byte-identical (GLB, sidecar, brief)
  const again = buildCreatureFiles({kind: 'preset', preset: 'bird'}, options);
  built.files.forEach(([name, bytes], i) => assert.equal(Buffer.compare(Buffer.from(bytes), Buffer.from(again.files[i][1])), 0, name));

  // the CLI: an over-budget brief fails with exit code 3, a JSON reason on stdout, and writes nothing
  const dir = mkdtempSync(join(tmpdir(), 'creature-export-v2-'));
  const log = console.log, exitCode = process.exitCode, out = [];
  try {
    const tight = join(dir, 'tight.brief.json'), outDir = join(dir, 'out');
    writeFileSync(tight, JSON.stringify({...template, constraints: {geometry: {...template.constraints.geometry, maxTriangles: 500}}}));
    console.log = s => out.push(s);
    cliMain(['--out', outDir, '--preset', 'bird', '--preset', 'worm', '--motions', 'neutral', '--brief', tight]);
    console.log = log;
    assert.equal(process.exitCode, CREATURE_EXPORT_BUDGET_EXIT);
    const result = JSON.parse(out.join('\n'));
    assert.equal(result.error, 'composer-export-budget'); assert.equal(result.written, 0);
    assert.deepEqual(result.failures.map(f => [f.selection.preset, f.reasons[0].code, f.reasons[0].limit]), [['bird', 'triangles', 500], ['worm', 'triangles', 500]]);
    assert.equal(existsSync(outDir), false, 'nothing written');
  } finally {
    console.log = log; process.exitCode = exitCode;
    rmSync(dir, {recursive: true, force: true});
  }
});
