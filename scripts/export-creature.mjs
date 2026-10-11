#!/usr/bin/env node
// Headless creature export (fauna-composer-export-3; v1: backlog task 10; v2 options: docs/creature-export-v2.md; v3:
// docs/creature-export-v3.md): writes one GLB per species plus a provenance sidecar and an asset brief, with no browser
// and no Atlas runtime.
//
//   node scripts/export-creature.mjs --out <dir> [selection...] [options]
//
// Selection (repeatable, at least one):
//   --preset <id|all>          a Creature Lab preset (COMPOSER_PRESET_IDS) or every preset
//   --seed <text>              a coherent random species (coherentComposerSpecies), optionally with --archetype <a>
//   --count <N> --seed-prefix <p>   N coherent species from seeds <p>-0 .. <p>-(N-1)
//   --recipe <text>            a shared recipe link (v1..v4 text)
// Options:
//   --motions <a,b,..>         subset of neutral,idle,walk,display (default all)
//   --fps <n>                  sample rate (default 30)
//   --gloss attribute|drop     keep the eye gloss as the _COMPOSER_GLOSS attribute (default) or drop it
//   --forward +Z|+X            exported heading (default +Z, the glTF asset front)
// v2 options (none given: a plain export, whose GLB BIN chunk is v1's byte for byte):
//   --target desktop-web|quest-3   target profile; quest-3 = LOD chain 8000,3000,1000 and a HARD budget
//   --lods full,8000,3000|none     LOD chain, level 0 first ('full' = the unreduced skin, first only); none = one mesh
//   --seamless                     idle and display as crossfaded loops (last key = first key, bit for bit)
//   --seamless-blend <s>           crossfade length (default 1 s, at most half the clip)
//   --no-reduce-skeleton           v3: keep every joint even over the profile's bone budget (the export then fails on
//                                  bones); by default such a graph gets the fauna-composer-skeleton-1 reduced skeleton
//   --brief <file.json>            take the target and budget from an asset brief (assets/briefs/creature-export-*.json):
//                                  devices quest-3/quest-3s -> quest-3; geometry.maxTriangles/maxMaterials and
//                                  textures.maxDimension may only tighten the profile; geometry.lodCount picks the
//                                  first lodCount+1 levels of the profile chain
// Exit codes: 0 written (or identical), 1 usage or other error, 3 budget exceeded (JSON on stdout, nothing written).
//
// Files per species, <key> = <label>-<8-hex hash of the recipe text>:
//   <key>.glb            the creature (see src/fauna-composer-export.ts)
//   <key>.creature.json  sidecar creature-export-sidecar-3: recipe, versions, generator source hash, clips, provenance
//   <key>.brief.json     an IWSDK asset brief (schemas/asset-brief/v1) for `assetctl package --brief`
// An existing file is never overwritten: identical bytes are accepted (a re-run is a no-op), different bytes fail.
// Nothing written depends on the clock, so a second export of the same selection is byte-identical.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {COMPOSER_EXPORT_GENERATOR, COMPOSER_EXPORT_TARGETS, COMPOSER_EXPORT_V3_VERSION, ComposerExportBudgetError, exportCreatureGlb} from '../src/fauna-composer-export.ts';
import {COMPOSER_PRESET_IDS, composerHash, composerPreset, decodeComposerRecipe, isComposerPresetId} from '../src/fauna-composer-recipe.ts';
import {COMPOSER_ARCHETYPES, coherentComposerSpecies} from '../src/fauna-composer-species.ts';
import {COMPOSER_BUDGET, COMPOSER_MOTIONS} from '../src/fauna-composer-rig.ts';

/** Historical sidecar schema of a plain export up to export v2 (kept exported for compatibility; no longer written). */
export const CREATURE_EXPORT_SIDECAR_SCHEMA = 'creature-export-sidecar-1';
/** Historical sidecar schema of a profiled v2 export: sidecar-1 plus target, lods, budget and status (kept; not written). */
export const CREATURE_EXPORT_SIDECAR_SCHEMA_V2 = 'creature-export-sidecar-2';
/** Sidecar schema written since export v3, for every export: a plain export carries the sidecar-1 fields, a profiled
 * export the sidecar-2 fields plus `skeleton`; the provenance carries the private licence (owner decision A13). */
export const CREATURE_EXPORT_SIDECAR_SCHEMA_V3 = 'creature-export-sidecar-3';
/** Owner decision A13 (2026-10-07): the licence is the same as the rest of the owner's projects, private, UNLICENSED. */
export const CREATURE_EXPORT_LICENSE = Object.freeze({expression: 'UNLICENSED', attribution: null, restrictions: Object.freeze(['private, all rights reserved (owner decision A13, 2026-10-07)'])});
export const CREATURE_EXPORT_BUDGET_EXIT = 3;
const BRIEF_SCHEMA = 'https://iwsdk.local/schemas/asset-brief/v1';
/** Sources whose bytes decide the exported GLB: the 12-module composer core and the exporter (repo-relative). */
export const CREATURE_EXPORT_GENERATOR_SOURCES = Object.freeze([
  'src/fauna-coat-fields.ts', 'src/fauna-coat-vocab.ts', 'src/fauna-composer-eye-catalogue.ts', 'src/fauna-composer-eye.ts',
  'src/fauna-composer-export.ts', 'src/fauna-composer-face-geometry.ts', 'src/fauna-composer-face.ts', 'src/fauna-composer-individual.ts',
  'src/fauna-composer-mesh.ts', 'src/fauna-composer-recipe.ts', 'src/fauna-composer-rig.ts', 'src/fauna-composer-species.ts', 'src/fauna-composer.ts',
]);
/** A v2 export also depends on the LOD reducer. */
export const CREATURE_EXPORT_GENERATOR_SOURCES_V2 = Object.freeze([...CREATURE_EXPORT_GENERATOR_SOURCES, 'src/fauna-composer-lod.ts', 'src/fauna-composer-lod-volume.ts'].sort());
const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hex8 = n => (n >>> 0).toString(16).padStart(8, '0');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'creature';

/** sha256 over the generator sources, sorted by path, LF line endings (a CRLF checkout hashes the same). */
export function generatorSourceHash(repo = REPO, sources = CREATURE_EXPORT_GENERATOR_SOURCES) {
  const h = createHash('sha256');
  for (const path of [...sources].sort()) {
    const text = readFileSync(join(repo, path), 'utf8').replace(/\r\n/g, '\n');
    h.update(`${path}\n${Buffer.byteLength(text)}\n`).update(text);
  }
  return h.digest('hex');
}

export function parseArgs(argv) {
  const out = {out: null, selections: [], motions: null, fps: undefined, gloss: undefined, forward: undefined, target: undefined, lods: undefined, seamless: false, seamlessBlend: undefined, brief: undefined, reduceSkeleton: undefined};
  let count = null, prefix = null, archetype;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = () => { if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`); return argv[++i]; };
    if (flag === '--out') out.out = value();
    else if (flag === '--preset') { const id = value(); for (const p of id === 'all' ? COMPOSER_PRESET_IDS : [id]) { if (!isComposerPresetId(p)) throw new Error(`unknown preset ${p}; known: ${COMPOSER_PRESET_IDS.join(', ')}`); out.selections.push({kind: 'preset', preset: p}); } }
    else if (flag === '--seed') out.selections.push({kind: 'coherent-species', seed: value()});
    else if (flag === '--archetype') { archetype = value(); if (!COMPOSER_ARCHETYPES.includes(archetype)) throw new Error(`unknown archetype ${archetype}; known: ${COMPOSER_ARCHETYPES.join(', ')}`); }
    else if (flag === '--count') { count = Number(value()); if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('--count must be an integer 1..500'); }
    else if (flag === '--seed-prefix') prefix = value();
    else if (flag === '--recipe') out.selections.push({kind: 'recipe', recipe: value()});
    else if (flag === '--motions') {
      out.motions = value().split(',').map(s => s.trim()).filter(Boolean);
      if (!out.motions.length) throw new Error('--motions needs at least one motion (the brief promises embedded clips)');
      for (const m of out.motions) if (!COMPOSER_MOTIONS.includes(m)) throw new Error(`unknown motion ${m}`);
    }
    else if (flag === '--fps') { out.fps = Number(value()); if (!(Number.isFinite(out.fps) && out.fps >= 1 && out.fps <= 240)) throw new Error('--fps must be a number in [1, 240]'); }
    else if (flag === '--gloss') out.gloss = value();
    else if (flag === '--forward') out.forward = value();
    else if (flag === '--target') { out.target = value(); if (!Object.hasOwn(COMPOSER_EXPORT_TARGETS, out.target)) throw new Error(`--target must be one of ${Object.keys(COMPOSER_EXPORT_TARGETS).join(', ')}`); }
    else if (flag === '--lods') out.lods = parseLods(value());
    else if (flag === '--seamless') out.seamless = true;
    else if (flag === '--seamless-blend') { out.seamlessBlend = Number(value()); if (!(Number.isFinite(out.seamlessBlend) && out.seamlessBlend > 0)) throw new Error('--seamless-blend must be a positive number of seconds'); }
    else if (flag === '--brief') out.brief = value();
    else if (flag === '--no-reduce-skeleton') out.reduceSkeleton = false;
    else throw new Error(`unknown argument ${flag}`);
  }
  if ((count === null) !== (prefix === null)) throw new Error('--count and --seed-prefix go together');
  if (count !== null) for (let k = 0; k < count; k++) out.selections.push({kind: 'coherent-species', seed: `${prefix}-${k}`});
  for (const s of out.selections) if (s.kind === 'coherent-species' && archetype) s.archetype = archetype;
  if (!out.out) throw new Error('--out <dir> is required');
  if (!out.selections.length) throw new Error('nothing selected: use --preset, --seed, --count/--seed-prefix or --recipe');
  return out;
}

/** `--lods` text: 'none' (one mesh) or a comma list of 'full' (first only) and triangle targets. */
export function parseLods(text) {
  if (text === 'none') return false;
  const lods = String(text).split(',').map(s => s.trim()).filter(Boolean).map(s => s === 'full' ? 'full' : Number(s));
  if (!lods.length) throw new Error('--lods needs at least one level (or none)');
  for (const l of lods) if (l !== 'full' && !Number.isInteger(l)) throw new Error(`--lods: ${l} is not 'full' or an integer`);
  return lods;
}

/** Export options from an asset brief (schemas/asset-brief/v1, kind creature). Reads only target.devices and the
 * geometry/texture constraints; a brief can tighten its profile's budget but never loosen it (the exporter takes the
 * smaller value). Throws on a brief that is not a creature brief. */
export function briefExportOptions(brief) {
  if (!brief || brief.schema !== BRIEF_SCHEMA) throw new Error(`brief: schema must be ${BRIEF_SCHEMA}`);
  if (brief.kind !== 'creature') throw new Error(`brief: kind must be creature (got ${brief.kind})`);
  const devices = brief.target?.devices;
  if (!Array.isArray(devices) || !devices.length) throw new Error('brief: target.devices is required');
  const target = devices.some(d => d === 'quest-3' || d === 'quest-3s') ? 'quest-3' : 'desktop-web';
  const geometry = brief.constraints?.geometry ?? {}, textures = brief.constraints?.textures ?? {};
  const budget = {};
  if (geometry.maxTriangles !== undefined) budget.maxTriangles = geometry.maxTriangles;
  if (geometry.maxMaterials !== undefined) budget.maxMaterials = geometry.maxMaterials;
  if (textures.maxDimension !== undefined) budget.maxTextureBytes = textures.maxDimension * textures.maxDimension * 4;
  const options = {target, budget};
  if (geometry.lodCount !== undefined) {
    const chain = COMPOSER_EXPORT_TARGETS[target].lods;
    if (!Number.isInteger(geometry.lodCount) || geometry.lodCount < 0) throw new Error('brief: geometry.lodCount must be an integer >= 0');
    if (geometry.lodCount === 0) options.lods = chain ? [chain[0]] : false;
    else {
      if (!chain || geometry.lodCount + 1 > chain.length) throw new Error(`brief: lodCount ${geometry.lodCount} exceeds the ${target} chain (${chain ? chain.length - 1 : 0} extra levels)`);
      options.lods = chain.slice(0, geometry.lodCount + 1);
    }
  }
  return options;
}

/** Resolves a selection to {recipe, label, source}. */
export function resolveSelection(sel) {
  if (sel.kind === 'preset') return {recipe: composerPreset(sel.preset), label: sel.preset, source: {kind: 'preset', preset: sel.preset}};
  if (sel.kind === 'coherent-species') {
    const species = coherentComposerSpecies(sel.seed, sel.archetype ? {archetype: sel.archetype} : {});
    return {recipe: species.recipe, label: `${species.archetype}-${slug(sel.seed)}`,
      source: {kind: 'coherent-species', seed: sel.seed, archetype: species.archetype, archetypeRequested: sel.archetype ?? null, attempt: species.attempt, balancePass: species.balance.pass}};
  }
  const decoded = decodeComposerRecipe(sel.recipe);
  if (!decoded.recipe) throw new Error(`recipe: ${decoded.error}`);
  return {recipe: decoded.recipe, label: 'recipe', source: {kind: 'recipe', text: sel.recipe, issues: decoded.issues}};
}

function provenance(report, key, source) {
  return {
    sourceType: 'generated',
    generator: {provider: COMPOSER_EXPORT_GENERATOR, model: 'fauna-composer', checkpoint: null, version: `${report.versions.graph} ${report.versions.skin} ${COMPOSER_EXPORT_V3_VERSION}`, workflow: 'scripts/export-creature.mjs'},
    prompt: report.recipeText,
    // the species seed when one drew the recipe; otherwise the recipe text's hash (the recipe itself is the whole input)
    seed: source.kind === 'coherent-species' ? source.seed : `recipe-${hex8(composerHash(report.recipeText))}`,
    sourceUrl: null,
    sourceConsent: 'not-applicable',
    parents: [],
    license: {expression: CREATURE_EXPORT_LICENSE.expression, attribution: CREATURE_EXPORT_LICENSE.attribution, restrictions: [...CREATURE_EXPORT_LICENSE.restrictions]},
    notes: `Procedural; no external inputs (no model checkpoint, texture, scan or third-party asset). The recipe text is the whole input. Private, all rights reserved (UNLICENSED, owner decision A13, 2026-10-07). Asset ${key}.`,
  };
}

/** Builds the three files for one selection; returns {key, files: [[name, bytes]...], sidecar}. Pure apart from reading sources. */
export function buildCreatureFiles(sel, options = {}, sourceHash) {
  const {recipe, label, source} = resolveSelection(sel);
  const exportOptions = {};
  if (options.motions && !options.motions.length) throw new Error('no motions selected (the brief promises embedded clips)');
  if (options.motions) exportOptions.clips = options.motions;
  if (options.fps !== undefined) exportOptions.fps = options.fps;
  if (options.gloss !== undefined) exportOptions.gloss = options.gloss;
  if (options.forward !== undefined) exportOptions.forward = options.forward;
  // v2: a brief first, then explicit flags override it (the budget still only tightens)
  const fromBrief = options.briefJson ? briefExportOptions(options.briefJson) : {};
  for (const [k, v] of Object.entries(fromBrief)) exportOptions[k] = v;
  if (options.target !== undefined) exportOptions.target = options.target;
  if (options.lods !== undefined) exportOptions.lods = options.lods;
  if (options.seamless) exportOptions.seamless = true;
  if (options.seamlessBlend !== undefined) exportOptions.seamlessBlend = options.seamlessBlend;
  if (options.reduceSkeleton === false) exportOptions.reduceSkeleton = false;
  const {glb, report} = exportCreatureGlb(recipe, exportOptions);
  // profiled export (any v2 option): the report carries the target, the LOD rows and the budget
  const v2 = report.target !== undefined;
  if (v2 && sourceHash === undefined) sourceHash = generatorSourceHash(REPO, CREATURE_EXPORT_GENERATOR_SOURCES_V2);
  if (sourceHash === undefined) sourceHash = generatorSourceHash();
  const key = `${slug(label)}-${hex8(composerHash(report.recipeText))}`;
  const prov = provenance(report, key, source);
  const lodRows = v2 && report.lods ? report.lods.map(({sourceVertex, ...rest}) => rest) : null;
  // v3: full and written joint counts, the rule, the collapsed joints and a hash of the full joint -> written joint mapping
  const sk = v2 ? report.skeleton : null;
  const skeleton = sk ? {version: sk.version, fullJoints: sk.fullJoints, joints: sk.joints, reduced: sk.reduced, stage: sk.stage, collapsed: sk.collapsed,
    mappingSha256: sha256(JSON.stringify(sk.mapping)), skinError: sk.skinError} : null;
  const sidecar = {
    schema: CREATURE_EXPORT_SIDECAR_SCHEMA_V3,
    asset: {id: key, file: `${key}.glb`, bytes: glb.byteLength, sha256: sha256(glb)},
    source,
    recipeText: report.recipeText, speciesKey: report.speciesKey,
    individual: report.individual,
    versions: report.versions,
    generator: {description: 'procedural; no external inputs', sources: v2 ? CREATURE_EXPORT_GENERATOR_SOURCES_V2 : CREATURE_EXPORT_GENERATOR_SOURCES, sourceSha256: sourceHash, script: 'scripts/export-creature.mjs'},
    axes: report.axes, mesh: report.mesh, gloss: report.gloss, repairs: report.repairs, clips: report.clips,
    playback: 'Clips marked seamless loop with LoopRepeat; the others are exact poseComposer windows whose end differs from the start by the listed seam: play them with LoopPingPong or crossfade. Walk is a treadmill: move the creature along the forward axis at travelSpeed.',
    ...(v2 ? {
      status: 'experimental: generated creature; topology, deformation and in-headset checks are not signed off',
      target: report.target, budget: report.budget, lods: lodRows, skeleton,
      lodPlayback: lodRows.length > 1 ? 'Level 0 is the scene mesh. Lower levels are skinned meshes on nodes outside the scene, listed by MSFT_lod on node 0 with MSFT_screencoverage hints; all levels share the skin and the clips. three.js: gltf.parser.getDependency(\'node\', id) for each id, then a THREE.LOD.' : null,
      seamlessPlayback: report.clips.some(c => c.method === 'crossfade') ? 'Clips with method crossfade loop exactly (last key = first key); inside the last crossfade.blendSeconds they blend into the pre-roll and are not poseComposer.' : null,
    } : {}),
    provenance: prov,
  };
  const brief = {
    schema: 'https://iwsdk.local/schemas/asset-brief/v1',
    id: key.slice(0, 64),
    kind: 'creature',
    purpose: `Procedural composer creature (${label}) exported headless from ${COMPOSER_EXPORT_GENERATOR} for use by other IWSDK games.`,
    target: {engine: 'IWSDK', project: COMPOSER_EXPORT_GENERATOR, devices: [v2 ? report.target : 'desktop-web'], metersPerUnit: 1, runtimeCoordinates: 'right-handed-y-up'},
    artDirection: {summary: 'Stylised procedural animal: one skinned vertex-coloured mesh, composer skeleton, baked motion clips.', styleTags: ['procedural', 'vertex-colour', 'skinned']},
    deliverables: [
      {type: 'runtime', path: `${key}.glb`, format: 'glb', required: true},
      {type: 'animation', path: `${key}.glb`, format: 'glb-embedded-clips', required: true},
      ...(lodRows && lodRows.length > 1 ? [{type: 'lod', path: `${key}.glb`, format: 'glb-msft-lod', required: true}] : []),
      {type: 'manifest', path: `${key}.creature.json`, format: CREATURE_EXPORT_SIDECAR_SCHEMA_V3, required: true},
    ],
    constraints: {geometry: v2
      ? {maxTriangles: report.budget.limits.maxTriangles, maxMaterials: report.budget.limits.maxMaterials, lodCount: lodRows.length - 1, collision: 'none'}
      : {maxTriangles: COMPOSER_BUDGET.maxTriangles, maxMaterials: 1, lodCount: 0, collision: 'none'}},
    acceptance: {
      visual: ['animal intact at normal viewing size', 'no skinning tears while the clips play', 'clips visibly play'],
      technical: v2
        ? ['assetctl validate passes', `${report.target} budget: level 0 at most ${report.budget.limits.maxTriangles} triangles, at most ${report.budget.limits.maxBones} joints, ${report.budget.limits.maxDrawCallsPerLevel} draw call per level, texture bytes at most ${report.budget.limits.maxTextureBytes}`,
          ...(lodRows.length > 1 ? [`LOD levels at most ${lodRows.map(l => l.target ?? l.triangles).join(' / ')} triangles`] : []),
          ...(skeleton?.reduced ? [`reduced skeleton ${skeleton.version}: ${skeleton.fullJoints} -> ${skeleton.joints} joints, skin error ${(100 * skeleton.skinError.fraction).toFixed(3)} % of the body diagonal (bound ${100 * skeleton.skinError.bound} %)`] : []),
          'clips match poseComposer at their keys (crossfaded loops: outside the blend)', 'second export byte-identical']
        : ['assetctl validate passes', `at most ${COMPOSER_BUDGET.maxBones} joints`, 'clips match poseComposer at their keys', 'second export byte-identical'],
      ...(v2 && report.target === 'quest-3' ? {runtime: ['experimental until an in-headset check on Quest 3 passes']} : {}),
    },
    provenance: prov,
  };
  const json = v => new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`);
  return {key, sidecar, files: [[`${key}.glb`, glb], [`${key}.creature.json`, json(sidecar)], [`${key}.brief.json`, json(brief)]]};
}

/** Writes a file unless it exists: identical bytes are accepted, different bytes throw. Returns 'written' | 'identical'. */
export function writeOnce(path, bytes) {
  if (existsSync(path)) {
    const old = readFileSync(path);
    if (Buffer.compare(old, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)) === 0) return 'identical';
    throw new Error(`refusing to overwrite ${path} (contents differ); export into a new directory`);
  }
  writeFileSync(path, bytes, {flag: 'wx'});
  return 'written';
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.brief) args.briefJson = JSON.parse(readFileSync(resolve(args.brief), 'utf8'));
  const dir = resolve(args.out);
  // build everything first: a budget failure anywhere writes nothing
  const builds = [], failures = [];
  for (const sel of args.selections) {
    try { builds.push(buildCreatureFiles(sel, args)); }
    catch (error) {
      if (!(error instanceof ComposerExportBudgetError)) throw error;
      failures.push({selection: sel, ...error.toJSON()});
    }
  }
  if (failures.length) {
    console.log(JSON.stringify({exporter: COMPOSER_EXPORT_V3_VERSION, error: 'composer-export-budget', out: dir, written: 0, failures}, null, 2));
    process.exitCode = CREATURE_EXPORT_BUDGET_EXIT;
    return;
  }
  mkdirSync(dir, {recursive: true});
  const sourceHash = builds[0]?.sidecar.generator.sourceSha256 ?? generatorSourceHash();
  const seen = new Set(), rows = [];
  for (const built of builds) {
    if (seen.has(built.key)) { rows.push({key: built.key, status: 'duplicate selection skipped'}); continue; }
    seen.add(built.key);
    const status = built.files.map(([name, bytes]) => `${name}:${writeOnce(join(dir, name), bytes)}`);
    const m = built.sidecar.mesh;
    rows.push({key: built.key, triangles: m.triangles, bones: m.bones, ...(built.sidecar.skeleton?.reduced ? {fullJoints: built.sidecar.skeleton.fullJoints} : {}), bytes: built.sidecar.asset.bytes,
      ...(built.sidecar.lods ? {lods: built.sidecar.lods.map(l => l.triangles).join('/')} : {}),
      clips: built.sidecar.clips.map(c => `${c.motion} ${c.duration.toFixed(2)}s${c.method === 'crossfade' ? ' (crossfade loop)' : c.seamless ? '' : ' (seam)'}`).join(', '), status: status.join(' ')});
  }
  console.log(JSON.stringify({exporter: COMPOSER_EXPORT_V3_VERSION, out: dir, generatorSourceSha256: sourceHash, creatures: rows}, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`export-creature: ${error.message}`); process.exitCode = 1; }
}
