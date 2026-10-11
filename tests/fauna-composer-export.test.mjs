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
import {COMPOSER_EXPORT_GENERATOR, COMPOSER_EXPORT_TARGETS, COMPOSER_EXPORT_V2_VERSION, COMPOSER_EXPORT_V3_VERSION, COMPOSER_GLOSS_ATTRIBUTE, COMPOSER_EXPORT_VERSION, ComposerExportBudgetError, bakeComposerClip, bakeComposerLoopClip,
  COMPOSER_SKELETON_SKIN_ERROR_BOUND, COMPOSER_SKELETON_STAGES, COMPOSER_SKELETON_VERSION, checkComposerExportBudget, composerClipWindow, composerSkeletonUnits, exportCreatureGlb, planComposerSkeleton,
  readComposerGlb} from '../src/fauna-composer-export.ts';
import {composerPreset, encodeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {coherentComposerSpecies} from '../src/fauna-composer-species.ts';
import {COMPOSER_BUDGET, buildComposerGraph, poseComposer} from '../src/fauna-composer-rig.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {CREATURE_EXPORT_BUDGET_EXIT, CREATURE_EXPORT_GENERATOR_SOURCES_V2, CREATURE_EXPORT_LICENSE, CREATURE_EXPORT_SIDECAR_SCHEMA, CREATURE_EXPORT_SIDECAR_SCHEMA_V2, CREATURE_EXPORT_SIDECAR_SCHEMA_V3, briefExportOptions, buildCreatureFiles,
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
    assert.equal(json.asset.generator, `creature-kit ${COMPOSER_EXPORT_V3_VERSION}`);
    assert.equal(json.asset.extras.composer.versions.export, COMPOSER_EXPORT_V3_VERSION);
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
  'fauna-composer-face.ts', 'fauna-composer-individual.ts', 'fauna-composer-mesh.ts', 'fauna-composer-phenotype.ts', 'fauna-composer-source.ts', 'fauna-composer-recipe.ts', 'fauna-composer-rig.ts', 'fauna-composer-species.ts', 'fauna-composer.ts']);

test('export: the export path imports only the composer core, the LOD reducer and three (the CLI adds node: builtins)', () => {
  // the core itself is closed (tests/creature-core-boundary.test.mjs); so the export path never reaches an Atlas module
  const leaks = specifiers('src/fauna-composer-export.ts', ts.ScriptKind.TS).filter(s => s !== 'three' && s !== './fauna-composer-lod.ts' && !CORE.has(/^\.\/([^/]+\.ts)$/.exec(s)?.[1]));
  assert.deepEqual(leaks, []);
  assert.deepEqual(specifiers('src/fauna-composer-lod.ts', ts.ScriptKind.TS), ['./fauna-composer-lod-volume.ts'], 'LOD imports its pure numeric volume helper only');
  assert.deepEqual(specifiers('src/fauna-composer-lod-volume.ts', ts.ScriptKind.TS), ['./fauna-composer-lod.ts'], 'volume helper imports only reducer types');
  const cli = specifiers('scripts/export-creature.mjs', ts.ScriptKind.JS).filter(s => !s.startsWith('node:') && !(s === '../src/fauna-composer-export.ts' || CORE.has(/^\.\.\/src\/([^/]+\.ts)$/.exec(s)?.[1])));
  assert.deepEqual(cli, []);
});

test('export CLI: sidecar and brief carry provenance; an existing file is never overwritten', () => {
  const built = buildCreatureFiles({kind: 'coherent-species', seed: 'export-test-1'});
  const sidecar = built.sidecar;
  assert.equal(sidecar.schema, CREATURE_EXPORT_SIDECAR_SCHEMA_V3);
  assert.equal(sidecar.target, undefined, 'a plain export carries the sidecar-1 fields only');
  assert.match(sidecar.generator.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(sidecar.recipeText, encodeComposerRecipe(SPECIMENS.coherent));
  assert.equal(sidecar.source.seed, 'export-test-1');
  assert.equal(sidecar.asset.sha256.length, 64);
  // asset-provenance v1: generated assets need generator, prompt and seed; the licence is private (owner decision A13)
  const p = sidecar.provenance;
  assert.equal(p.sourceType, 'generated');
  assert.ok(p.generator.provider && p.generator.model && p.prompt && p.seed);
  assert.deepEqual(p.license, {expression: 'UNLICENSED', attribution: null, restrictions: ['private, all rights reserved (owner decision A13, 2026-10-07)']});
  assert.deepEqual(p.license, {...CREATURE_EXPORT_LICENSE, restrictions: [...CREATURE_EXPORT_LICENSE.restrictions]});
  assert.equal(p.generator.provider, 'creature-kit');
  assert.equal(p.generator.version, `${sidecar.versions.graph} ${sidecar.versions.skin} ${COMPOSER_EXPORT_V3_VERSION}`);
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
 * are identical before and after, and all five GLB shas are byte-identical to the pins below, so only `core` changed.
 * 2026-10-07: export v3 (docs/creature-export-v3.md, task R2-KIT-EXPORT-3, owner decision A13): `asset.generator`
 * "universe-atlas fauna-composer-export-1" -> "creature-kit fauna-composer-export-3" and `versions.export` -> "-3"; the
 * core key is unchanged. GLB shas, old (creature-kit main 3e0d6e8) -> new:
 *   bird              bb87f35b228bab8a… -> a9007575ad408f80…  (1007708 -> 1007704 bytes: JSON chunk padding)
 *   centipede         709abe3ce33ccfaf… -> b3981c9365265006…  (1721324 bytes, both)
 *   worm              86fecc903ec8f19b… -> 1395baa897fbc8a8…  (619412 -> 619408 bytes)
 *   winged-ape-rhino  ae1784773193c049… -> c26e0d16388e289f…  (1488260 bytes, both)
 *   coherent          01b43824c05d6733… -> a91e920cab8c5607…  (905608 bytes, both)
 *   quest-3 bird      7a590ed3f6c2ed5d… -> d45acf82a921e081…  (the v2 specimen, `questBird` below)
 * Proof that nothing but the two strings moved: `bin` pins each BIN chunk as exported at 3e0d6e8 (unchanged), and
 * `json` pins the 3e0d6e8 JSON chunk text (trailing padding trimmed); the test maps the two v3 strings back to the
 * 3e0d6e8 ones and hashes the result, so any other JSON change fails it.
 * 2026-10-08: core re-keyed a0a31556… -> 5c941506…, as at kit main 13c7b35, skin-5 (merge of kit/coat-crisp:
 * crisp coat, dichromatism, seam normals, trunk). Decoded accessor by accessor against the 8157b10 export: only
 * NORMAL moved on all six (welded seam normals); coherent (debug.blendUnfolded) also moved POSITION and COLOR_0 on
 * 212 of the 216 moved neck_4/head vertices (max colour delta 0.0073): coat re-sampled at the moved positions (sex none;
 * the colour change is a subset of the position change); accepted as a knock-on, Opus-decided on Kasper's instruction,
 * overrulable. The JSON differs only in versions.skin skin-4 -> skin-5; nodes, skins, animations, joints, channels and
 * byte lengths are identical. 16x3 LOD table (Assets/_assetctl/creature-kit/export-3/skin5-13c7b35/): 8 of 16 rows
 * differ (the blend-moved or trunked specimens), all within quest-3; watch items: level-2 maxPlaneError ungulate-grazer
 * 0.127 -> 0.179, cursorial-carnivore 0.086 -> 0.105. GLB sha256, old -> new:
 *   bird              a9007575ad408f80… -> 9b9edad9e835b428…  (1007704 bytes, both)
 *   centipede         b3981c9365265006… -> 7b67645e52182d1c…  (1721324 bytes, both)
 *   worm              1395baa897fbc8a8… -> 84d8b6b06d0c942f…  (619408 bytes, both)
 *   winged-ape-rhino  c26e0d16388e289f… -> 102a45b16c48cab8…  (1488260 bytes, both)
 *   coherent          a91e920cab8c5607… -> 2ac739d47b70d427…  (905608 bytes, both)
 *   quest-3 bird      d45acf82a921e081… -> 6228c286f4768cd1…  (1027136 bytes, both)
 * `bin` and `json` below are the skin-5 BIN chunk and the skin-5 JSON chunk with the v3 strings mapped back as before.
 * 2026-10-08: core re-keyed 5c941506… -> 179e31d7… after the catalogue eye-seat closest-point tie rule (kit/eye-seat-tie,
 * R7a, docs/fauna-eye-seat-tie-2026-10-08.md); none of the five specimens nor the quest-3 bird has a catalogue-eye
 * closest-point tie whose pick changed: GLB, BIN and JSON pins are byte-identical, so only `core` changed.
 */
const V1_PINS = {
  core: '179e31d7216220616d7da2799a087a87679df2c9312c7856aa2061772db7cd8c',
  glb: {
    bird: '9b9edad9e835b42814becb7ae771a1ee46f5d2f23b52c63419600ef5438508b5',
    centipede: '7b67645e52182d1c0da6343c0bbdac4b0d851ceb0cb3c420e20abb3115cae92d',
    worm: '84d8b6b06d0c942f67db9aa41f738c1f48a154e58474f7d492f7597be149fc9f',
    'winged-ape-rhino': '102a45b16c48cab83020eb288d04591d3f417cad93e5ab5065a7f61264867404',
    coherent: '2ac739d47b70d427222764d0cca525978f62f9fdcafd5f12f2c5d695f19718c7',
  },
  bin: {
    bird: '4d179e77f6117a628856fe14f92462265e1a58855ff24af70b1f66c68033dc7e',
    centipede: '82dc2570a179fd0f7fdcad74722c2e973a28e1c86d4d6f25a3ab0f9d1f190b55',
    worm: '941278a28617368078f104a5b07ad83b4d0aa50163314c0414da2990b9621274',
    'winged-ape-rhino': '2846994420928419ac12056c41e45b9704f10c26dcc15192b6946eb2b8d16f50',
    coherent: '61eb2008ff4d9effb71e2df916fc702b6601c3174787721ff96febede4579650',
    questBird: '022a3e8a5814f4dd828fd32ec1793970694628f99c61ac1313fd941126848b07',
  },
  json: {
    bird: '2f6f76a815516372a472e3892a7ee4e8086e1dc3e1fdaa0650dfc409c6d8eb94',
    centipede: '96896b6bbeeec63fe3e92807f0e7a5bd7bd8252aa0d93fc1716cf84e7d34b782',
    worm: '4c3eb130f5a31091b9c44fedff6611fb5a58cdda0279c8ec4dca32335b65522d',
    'winged-ape-rhino': '8546b181bbbc62f6aeb032a9d0e6fd2da0e6294aa05fa2cea07715df114d539d',
    coherent: '3e61616c519140e410b5f1c868ccabd057f3a352a94fd2062fe2dd180970b41b',
    questBird: '71d9b9c2916558c90e858b92e23b70ed1f4f9dbc3871c5f7082805b030420bec',
  },
  questBirdGlb: '6228c286f4768cd133ed20dbc90c739046aed4d54f6c2bd30faa1a7c4b66a36f',
};
/** The JSON chunk text with the v3 strings mapped back to the strings the 3e0d6e8 export wrote (export -1 or -2). */
const jsonAsAt3e0d6e8 = (glb, v) => {
  const dv = new DataView(glb.buffer, glb.byteOffset);
  return new TextDecoder().decode(glb.subarray(20, 20 + dv.getUint32(12, true))).replace(/ +$/, '')
    .replace(`"generator":"${COMPOSER_EXPORT_GENERATOR} ${COMPOSER_EXPORT_V3_VERSION}"`, `"generator":"universe-atlas fauna-composer-export-${v}"`)
    .replace(`"export":"${COMPOSER_EXPORT_V3_VERSION}"`, `"export":"fauna-composer-export-${v}"`);
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let questBirdCache = null;
const questBird = () => questBirdCache ??= exportCreatureGlb(SPECIMENS.bird, {target: 'quest-3', seamless: true});

test('export v2: with no v2 option the GLB is v1 byte for byte', t => {
  for (const name of Object.keys(SPECIMENS)) {
    const v1 = exported(name);
    // flags spelled out as off give the same bytes as no options at all
    assert.equal(sha(exportCreatureGlb(SPECIMENS[name], {lods: false, seamless: false}).glb), sha(v1.glb), name);
    assert.equal(v1.report.version, COMPOSER_EXPORT_V3_VERSION);
    assert.equal(v1.report.lods, undefined); assert.equal(v1.report.budget, undefined);
    assert.equal(readComposerGlb(v1.glb).json.extensionsUsed, undefined);
  }
  // Source edits must still satisfy the byte pins. The historic source hash is
  // provenance, never a reason to silently bypass these behavioural guards.
  for (const [name, pin] of Object.entries(V1_PINS.glb)) {
    const glb = exported(name).glb;
    assert.equal(sha(glb), pin, `${name}: v1 bytes`);
    assert.equal(sha(readComposerGlb(glb).bin), V1_PINS.bin[name], `${name}: BIN chunk as at 3e0d6e8`);
    assert.equal(sha(jsonAsAt3e0d6e8(glb, 1)), V1_PINS.json[name], `${name}: JSON chunk as at 3e0d6e8 but for the two version strings`);
  }
  const quest = questBird().glb;
  assert.equal(sha(quest), V1_PINS.questBirdGlb, 'quest-3 bird bytes');
  assert.equal(sha(readComposerGlb(quest).bin), V1_PINS.bin.questBird, 'quest-3 bird: BIN chunk as at 3e0d6e8');
  assert.equal(sha(jsonAsAt3e0d6e8(quest, 2)), V1_PINS.json.questBird, 'quest-3 bird: JSON chunk as at 3e0d6e8 but for the two version strings');
});

/** Bone sweep (D4; docs/creature-export-v2.md "Budget ledger", docs/creature-export-v3.md): joint counts of the composer
 * graph, as the exporter builds it (individual-derived recipe), for 100 coherent species (the CLI's --seed/--count path)
 * and 100 raw random recipes, unreduced and after the fauna-composer-skeleton-1 plan under the quest-3 limit. */
function boneSweep(recipeOf) {
  const limit = COMPOSER_EXPORT_TARGETS['quest-3'].budget.maxBones;
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const graph = buildComposerGraph(deriveComposerIndividual(recipeOf(`bone-sweep-${i}`)).recipe);
    rows.push({seed: `bone-sweep-${i}`, full: graph.bones.length, plan: planComposerSkeleton(graph, limit)});
  }
  const counts = rows.map(r => r.full), bins = new Map();
  for (const n of counts) { const lo = Math.floor(n / 10) * 10; bins.set(lo, (bins.get(lo) ?? 0) + 1); }
  return {limit, rows, min: Math.min(...counts), max: Math.max(...counts), over: rows.filter(r => r.full > limit).map(r => r.seed),
    overReduced: rows.filter(r => r.plan.joints > limit).map(r => r.seed),
    histogram: [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([lo, k]) => `${lo}-${lo + 9}:${k}`).join(' ')};
}
/** The raw recipes over the quest-3 limit at 3e0d6e8 (all 11 failed the quest-3 export on `bones`). */
const RAW_OVER_80 = ['bone-sweep-3', 'bone-sweep-9', 'bone-sweep-15', 'bone-sweep-20', 'bone-sweep-24', 'bone-sweep-28', 'bone-sweep-29',
  'bone-sweep-46', 'bone-sweep-53', 'bone-sweep-70', 'bone-sweep-81'];
test('export v3: bone sweep over 100 seeds: with the reduced skeleton no graph is over the quest-3 limit; without it the same 11 are', t => {
  for (const [label, recipeOf, over] of [['coherent species', seed => coherentComposerSpecies(seed).recipe, []], ['random recipes', seed => randomComposerRecipe(seed), RAW_OVER_80]]) {
    const s = boneSweep(recipeOf);
    t.diagnostic(`bone sweep, ${label} bone-sweep-0..99: joints ${s.min}..${s.max}, histogram ${s.histogram}; over the quest-3 limit of ${s.limit}: ${s.over.length} of 100 unreduced, ${s.overReduced.length} reduced`);
    assert.ok(s.min > 0 && s.max <= COMPOSER_BUDGET.maxBones, `${label}: every graph within the composer's own cap`);
    assert.deepEqual(s.over, over, `${label}: over the limit without the rule (negative case)`);
    assert.deepEqual(s.overReduced, [], `${label}: none over the limit with the rule`);
    for (const r of s.rows) {
      assert.equal(r.plan.reached, true, r.seed);
      assert.equal(r.plan.reduced, r.full > s.limit, `${r.seed}: reduced exactly when over`);
      if (!r.plan.reduced) { assert.equal(r.plan.joints, r.full); assert.deepEqual(r.plan.collapsed, []); continue; }
      t.diagnostic(`${r.seed}: ${r.full} -> ${r.plan.joints} joints (stage ${r.plan.stage}, ${r.plan.collapsed.length} collapsed)`);
      assert.ok(r.plan.joints <= s.limit && r.plan.joints === r.full - r.plan.collapsed.length);
    }
  }
});

test('export v3: the reduction plan follows the pre-registered unit order and never removes a knee, the root or the head', () => {
  const graph = buildComposerGraph(deriveComposerIndividual(randomComposerRecipe('bone-sweep-20')).recipe);
  const units = composerSkeletonUnits(graph);
  const order = units.map(u => COMPOSER_SKELETON_STAGES.indexOf(u.stage));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'stages in order');
  const removable = /^(leg_\d+_[LR]_(foot|meta)|tail_\d*[13579]|torso_\d*[13579]|neck_\d*[13579])$/;
  for (const u of units) for (const j of u.joints) {
    assert.match(graph.bones[j].name, removable, 'only feet, metapodials and odd tail/torso/neck joints are ever removed');
    assert.ok(graph.bones[j].parent >= 0);
  }
  assert.equal(graph.bones.length, 126);
  const plan = planComposerSkeleton(graph, 80);
  assert.equal(plan.version, COMPOSER_SKELETON_VERSION);
  assert.deepEqual([plan.fullJoints, plan.joints, plan.reduced, plan.reached, plan.stage], [126, 80, true, true, 'metapodials']);
  // every joint maps to a surviving ancestor-or-self
  plan.into.forEach((s, j) => {
    assert.ok(plan.survivors.includes(s));
    let a = j; while (a !== s) { a = graph.bones[a].parent; assert.ok(a >= 0, `${graph.bones[j].name}: maps to an ancestor`); }
  });
  // no reduction needed, and units that run out: nothing is removed
  assert.deepEqual([planComposerSkeleton(graph, 126).reduced, planComposerSkeleton(graph, 126).joints], [false, 126]);
  const out = planComposerSkeleton(graph, 10);
  assert.deepEqual([out.reduced, out.reached, out.joints, out.collapsed.length], [false, false, 126, 0]);
});

/** The quest-3 exports of the 11 over-limit raw recipes, all clips, seamless (the evidence options). */
const reducedCache = new Map();
const reducedExport = seed => { if (!reducedCache.has(seed)) {
  try { reducedCache.set(seed, exportCreatureGlb(randomComposerRecipe(seed), {target: 'quest-3', seamless: true})); } catch (e) { reducedCache.set(seed, e); }
} return reducedCache.get(seed); };

test('export v3: the 11 over-limit raw recipes export under quest-3 with a reduced skeleton within the skin-error bound', t => {
  const lines = [];
  for (const seed of RAW_OVER_80) {
    let result = reducedExport(seed);
    if (seed === 'bone-sweep-70') {
      // known at 3e0d6e8 and out of scope (LOD reducer, not joints): level 2 cannot reach 1000 triangles. The joint
      // budget is met; the failure is exactly lod-target level 2 and nothing else.
      assert.ok(result instanceof ComposerExportBudgetError, String(result));
      assert.deepEqual(JSON.parse(JSON.stringify(result)).reasons.map(r => [r.code, r.level, r.limit]), [['lod-target', 2, 1000]]);
      result = exportCreatureGlb(randomComposerRecipe(seed), {target: 'quest-3', seamless: true, lods: [8000, 3000]});
    }
    assert.ok(!(result instanceof Error), `${seed}: ${result}`);
    const {glb, report} = result, sk = report.skeleton, e = sk.skinError;
    const {json, bin} = readComposerGlb(glb);
    lines.push(`${seed}${seed === 'bone-sweep-70' ? ' (lods 8000/3000)' : ''}: ${sk.fullJoints} -> ${sk.joints} joints, stage ${sk.stage}, skin error ${(100 * e.fraction).toFixed(3)} % of ${e.diagonal.toFixed(3)} m (${e.motion} key ${e.key}, ${e.verticesChecked} vertices x ${e.keys} keys)`);
    assert.equal(sk.reduced, true); assert.ok(sk.joints <= 80 && sk.fullJoints > 80);
    assert.ok(e.pass && e.fraction <= COMPOSER_SKELETON_SKIN_ERROR_BOUND && e.keys > 0 && e.verticesChecked > 0, lines.at(-1));
    assert.equal(report.mesh.bones, sk.joints); assert.equal(report.budget.actual.bones, sk.joints);
    // the GLB: survivors only, with consistent joints, weights and channels
    assert.equal(json.skins[0].joints.length, sk.joints);
    assert.equal(json.accessors[json.skins[0].inverseBindMatrices].count, sk.joints);
    assert.equal(json.nodes[1].children.length, sk.joints);
    assert.deepEqual(json.skins[0].joints.map(n => json.nodes[n].name), sk.survivors.map(j => sk.mapping[j][0]));
    assert.equal(json.asset.extras.composer.versions.skeleton, COMPOSER_SKELETON_VERSION);
    assert.deepEqual(json.asset.extras.composer.skeleton, {version: COMPOSER_SKELETON_VERSION, fullJoints: sk.fullJoints, joints: sk.joints, collapsed: sk.collapsed.map(c => [c.joint, c.into])});
    for (const mesh of json.meshes) {
      const prim = mesh.primitives[0];
      const jw = accessorArray(json, bin, prim.attributes.JOINTS_0), w = accessorArray(json, bin, prim.attributes.WEIGHTS_0);
      for (let v = 0; v < w.length; v += 4) {
        assert.ok(Math.abs(w[v] + w[v + 1] + w[v + 2] + w[v + 3] - 1) <= 1e-6);
        for (let c = 0; c < 4; c++) assert.ok(jw[v + c] < sk.joints);
      }
    }
    const lastJoint = 2 + sk.joints - 1;
    for (const anim of json.animations) for (const ch of anim.channels) assert.ok(ch.target.node >= 2 && ch.target.node <= lastJoint);
    assert.equal(sk.mapping.length, sk.fullJoints);
  }
  t.diagnostic(lines.join('\n'));
  console.log(lines.join('\n'));
});

test('export v3: with the rule off the 11 fail on bones; the reduced GLB keeps the unreduced geometry; two runs are byte-identical', () => {
  for (const seed of RAW_OVER_80) {
    assert.throws(() => exportCreatureGlb(randomComposerRecipe(seed), {target: 'quest-3', clips: [], reduceSkeleton: false}), e => {
      const r = JSON.parse(JSON.stringify(e)).reasons.find(x => x.code === 'bones');
      assert.ok(r, `${seed}: a bones reason`); assert.equal(r.limit, 80); assert.ok(r.actual > 80);
      return true;
    }, seed);
  }
  const seed = 'bone-sweep-20', recipe = randomComposerRecipe(seed);
  const one = reducedExport(seed), two = exportCreatureGlb(structuredClone(recipe), {target: 'quest-3', seamless: true});
  assert.equal(sha(one.glb), sha(two.glb), 'byte-identical on a second export');
  // desktop-web with the same LOD chain keeps all 126 joints; positions, normals, colours, gloss and indices are the same bytes
  const desk = exportCreatureGlb(recipe, {target: 'desktop-web', seamless: true, lods: [8000, 3000, 1000]});
  assert.equal(desk.report.skeleton.reduced, false); assert.equal(desk.report.mesh.bones, 126);
  const r = readComposerGlb(one.glb), d = readComposerGlb(desk.glb);
  const bytesOf = ({json, bin}, a) => { const acc = json.accessors[a], v = json.bufferViews[acc.bufferView]; return Buffer.from(bin.subarray(v.byteOffset, v.byteOffset + v.byteLength)); };
  assert.equal(r.json.meshes.length, 3);
  r.json.meshes.forEach((mesh, i) => {
    const pr = mesh.primitives[0], pd = d.json.meshes[i].primitives[0];
    for (const attr of ['POSITION', 'NORMAL', 'COLOR_0', COMPOSER_GLOSS_ATTRIBUTE]) assert.equal(Buffer.compare(bytesOf(r, pr.attributes[attr]), bytesOf(d, pd.attributes[attr])), 0, `level ${i} ${attr}`);
    assert.equal(Buffer.compare(bytesOf(r, pr.indices), bytesOf(d, pd.indices)), 0, `level ${i} indices`);
  });
});

test('export v3: GLTFLoader playback of a reduced GLB differs from the full skeleton by at most the reported skin error', async () => {
  const seed = 'bone-sweep-46', recipe = randomComposerRecipe(seed);
  const reduced = reducedExport(seed);
  const full = exportCreatureGlb(recipe, {target: 'desktop-web', seamless: true, lods: [8000, 3000, 1000]});
  const e = reduced.report.skeleton.skinError;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const load = async glb => { const gltf = await loadGlb(glb); let mesh = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; }); return {gltf, mesh, mixer: new THREE.AnimationMixer(gltf.scene)}; };
  const R = await load(reduced.glb), F = await load(full.glb);
  assert.equal(R.mesh.skeleton.bones.length, reduced.report.skeleton.joints); assert.equal(F.mesh.skeleton.bones.length, reduced.report.skeleton.fullJoints);
  const clipR = R.gltf.animations.find(c => c.name === e.motion), clipF = F.gltf.animations.find(c => c.name === e.motion);
  const times = clipR.tracks[0].times;
  const pose = (side, clip, t) => { side.mixer.stopAllAction(); const act = side.mixer.clipAction(clip); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.reset().play(); act.time = t; side.mixer.update(0); side.gltf.scene.updateMatrixWorld(true); };
  let worst = 0, atReported = 0;
  for (const k of [0, Math.floor(times.length / 3), e.key, times.length - 1]) {
    pose(R, clipR, times[k]); pose(F, clipF, times[k]);
    for (let v = 0; v < R.mesh.geometry.attributes.position.count; v++) {
      R.mesh.getVertexPosition(v, a); F.mesh.getVertexPosition(v, b);
      const dist = a.distanceTo(b); worst = Math.max(worst, dist);
      if (k === e.key && v === e.vertex) atReported = dist;
    }
  }
  const line = `${seed} ${e.motion}: three.js skinned worst ${worst.toFixed(5)} m, at the reported vertex/key ${atReported.toFixed(5)} m, reported ${e.max.toFixed(5)} m`;
  console.log(line);
  assert.ok(worst <= e.max + 1e-5, line);
  assert.ok(Math.abs(atReported - e.max) <= 1e-5, line);
});

test('export v2: quest-3 writes an MSFT_lod chain within budget and reports it', () => {
  const {glb, report} = questBird();
  const {json, bin} = readComposerGlb(glb);
  assert.equal(report.version, COMPOSER_EXPORT_V3_VERSION);
  assert.equal(json.asset.generator, `${COMPOSER_EXPORT_GENERATOR} ${COMPOSER_EXPORT_V3_VERSION}`);
  assert.equal(json.asset.extras.composer.versions.export, COMPOSER_EXPORT_V3_VERSION);
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
  assert.equal(v2.report.version, COMPOSER_EXPORT_V3_VERSION);
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
  assert.equal(sidecar.schema, CREATURE_EXPORT_SIDECAR_SCHEMA_V3);
  assert.deepEqual(sidecar.generator.sources, CREATURE_EXPORT_GENERATOR_SOURCES_V2);
  assert.ok(sidecar.generator.sources.includes('src/fauna-composer-lod.ts'));
  assert.ok(sidecar.generator.sources.includes('src/fauna-composer-lod-volume.ts'));
  assert.equal(sidecar.generator.sourceSha256, generatorSourceHash(undefined, CREATURE_EXPORT_GENERATOR_SOURCES_V2));
  assert.equal(sidecar.target, 'quest-3');
  assert.match(sidecar.status, /^experimental/);
  assert.deepEqual(sidecar.lods.map(l => l.target), [8000, 3000, 1000]);
  assert.ok(sidecar.lods.every(l => l.triangles <= l.target && !('sourceVertex' in l)));
  assert.equal(sidecar.budget.pass, true); assert.equal(sidecar.budget.limits.maxTriangles, 8000);
  assert.equal(sidecar.provenance.license.expression, 'UNLICENSED');
  const brief = JSON.parse(new TextDecoder().decode(built.files.find(([n]) => n.endsWith('.brief.json'))[1]));
  assert.deepEqual(brief.target.devices, ['quest-3']);
  assert.deepEqual(brief.constraints.geometry, {maxTriangles: 8000, maxMaterials: 1, lodCount: 2, collision: 'none'});
  assert.ok(brief.deliverables.some(d => d.type === 'lod' && d.format === 'glb-msft-lod'));
  assert.equal(brief.provenance.license.expression, 'UNLICENSED');
  assert.equal(brief.target.project, 'creature-kit');
  assert.match(brief.purpose, /exported headless from creature-kit/);
  assert.deepEqual(brief.deliverables.find(d => d.type === 'manifest').format, CREATURE_EXPORT_SIDECAR_SCHEMA_V3);
  // the historical constants stay exported, unchanged, for compatibility
  assert.deepEqual([COMPOSER_EXPORT_VERSION, COMPOSER_EXPORT_V2_VERSION, CREATURE_EXPORT_SIDECAR_SCHEMA, CREATURE_EXPORT_SIDECAR_SCHEMA_V2],
    ['fauna-composer-export-1', 'fauna-composer-export-2', 'creature-export-sidecar-1', 'creature-export-sidecar-2']);
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

test('export v3 CLI: a reduced export records the skeleton in the sidecar and the brief; --no-reduce-skeleton keeps every joint', () => {
  assert.equal(parseArgs(['--out', 'x', '--preset', 'ape', '--target', 'quest-3', '--no-reduce-skeleton']).reduceSkeleton, false);
  assert.equal(parseArgs(['--out', 'x', '--preset', 'ape', '--target', 'quest-3']).reduceSkeleton, undefined);
  const text = encodeComposerRecipe(randomComposerRecipe('bone-sweep-24'));
  const built = buildCreatureFiles({kind: 'recipe', recipe: text}, {target: 'quest-3', seamless: true, motions: ['idle', 'walk']});
  const sk = built.sidecar.skeleton;
  assert.equal(built.sidecar.schema, CREATURE_EXPORT_SIDECAR_SCHEMA_V3);
  assert.deepEqual([sk.version, sk.fullJoints, sk.joints, sk.reduced, sk.stage], [COMPOSER_SKELETON_VERSION, 82, 80, true, 'feet']);
  assert.deepEqual(sk.collapsed.map(c => c.stage), ['feet', 'feet']);
  assert.ok(sk.skinError.pass && sk.skinError.fraction <= COMPOSER_SKELETON_SKIN_ERROR_BOUND);
  const report = exportCreatureGlb(text, {target: 'quest-3', seamless: true, clips: ['idle', 'walk']}).report;
  assert.equal(sk.mappingSha256, sha(JSON.stringify(report.skeleton.mapping)));
  assert.equal(report.skeleton.mapping.filter(([a, b]) => a !== b).length, 2);
  assert.ok(!('mapping' in sk) && !('survivors' in sk), 'the sidecar carries the mapping hash, not the mapping');
  const brief = JSON.parse(new TextDecoder().decode(built.files.find(([n]) => n.endsWith('.brief.json'))[1]));
  assert.ok(brief.acceptance.technical.some(l => /^reduced skeleton fauna-composer-skeleton-1: 82 -> 80 joints, skin error \d+\.\d{3} % of the body diagonal \(bound 2 %\)$/.test(l)));
  // an in-budget profiled export carries an unreduced skeleton block; a plain export carries none
  const quest = buildCreatureFiles({kind: 'preset', preset: 'bird'}, {target: 'quest-3', motions: ['idle']}).sidecar.skeleton;
  assert.deepEqual([quest.reduced, quest.stage, quest.collapsed, quest.skinError, quest.fullJoints === quest.joints], [false, null, [], null, true]);
  assert.equal(buildCreatureFiles({kind: 'preset', preset: 'bird'}, {motions: ['idle']}).sidecar.skeleton, undefined);
  // the rule off: the same recipe fails on bones
  assert.throws(() => buildCreatureFiles({kind: 'recipe', recipe: text}, {target: 'quest-3', motions: ['idle'], reduceSkeleton: false}),
    e => e instanceof ComposerExportBudgetError && e.reasons.some(r => r.code === 'bones' && r.actual === 82));
});
