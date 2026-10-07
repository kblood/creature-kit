#!/usr/bin/env node
// Behavioural identity digest of a composer tree (creature-kit or universe-atlas): every byte the composer produces for
// the pinned corpora, computed from <root>/src and <root>/scripts/export-creature.mjs. Two trees whose reports are equal
// produce the same creatures byte for byte. Used by tests/atlas-parity.test.mjs and by hand:
//
//   node scripts/composer-identity.mjs [--root <dir>] [--quick]
//
// Report (JSON on stdout):
//   sourceHash      generatorSourceHash over the v1 (13 files) and v2 (14 files) generator sources, LF-normalised
//   v1Pins          GLB sha256 of the five export-test specimens with no v2 option (tests/fauna-composer-export V1_PINS)
//   skin4Links      skin + gloss sha256, vertices/triangles/bones of the 28 composer-skin4-links texts
//   eyeCatalogue    the same for every composer-eye-catalogue-links specimen
//   cli             sha256 of every file buildCreatureFiles makes for `--preset all --count 4 --seed-prefix ce1`, once
//                   with no v2 flag (v1) and once with `--target quest-3 --seamless` (v2, the LOD chain). --quick skips it.
//   digest          sha256 over the canonical JSON of everything above (the one number to compare)
// Fixtures are read from THIS kit (tests/fixtures), so both trees are asked the same questions.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const KIT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const skinDigest = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const fixture = name => JSON.parse(readFileSync(resolve(KIT, 'tests/fixtures', name), 'utf8'));

export async function composerIdentity(root, {quick = false} = {}) {
  const at = p => import(pathToFileURL(resolve(root, p)).href);
  const recipeM = await at('src/fauna-composer-recipe.ts');
  const rigM = await at('src/fauna-composer-rig.ts');
  const meshM = await at('src/fauna-composer-mesh.ts');
  const indM = await at('src/fauna-composer-individual.ts');
  const speciesM = await at('src/fauna-composer-species.ts');
  const exportM = await at('src/fauna-composer-export.ts');
  const cli = await at('scripts/export-creature.mjs');

  const sourceHash = {
    v1: cli.generatorSourceHash(resolve(root)),
    v2: cli.generatorSourceHash(resolve(root), cli.CREATURE_EXPORT_GENERATOR_SOURCES_V2),
  };

  const specimens = {
    bird: recipeM.composerPreset('bird'), centipede: recipeM.composerPreset('centipede'), worm: recipeM.composerPreset('worm'),
    'winged-ape-rhino': recipeM.composerPreset('winged-ape-rhino'), coherent: speciesM.coherentComposerSpecies('export-test-1').recipe,
  };
  const v1Pins = Object.fromEntries(Object.entries(specimens).map(([k, r]) => [k, sha(exportM.exportCreatureGlb(r).glb)]));

  const build = recipe => {
    const graph = rigM.buildComposerGraph(recipe), skin = meshM.buildComposerSkin(graph);
    return {skin: skinDigest(skin.positions, skin.index, skin.skinIndex, skin.skinWeight, skin.colors), gloss: skinDigest(skin.gloss),
      vertices: skin.vertexCount, triangles: skin.triangleCount, bones: graph.bones.length};
  };
  // the same derivation as tests/fauna-composer-skin4-links.test.mjs
  const skin4Links = {};
  for (const text of Object.keys(fixture('composer-skin4-links.json').byText).sort()) {
    const decoded = recipeM.decodeComposerRecipe(text).recipe;
    const neutral = recipeM.composerLegacyPresetId(decoded) ? {...decoded, ...recipeM.COMPOSER_V2_DEFAULTS} : decoded;
    skin4Links[text] = build(indM.deriveComposerIndividual(neutral).recipe);
  }
  const eyeCatalogue = {};
  for (const link of fixture('composer-eye-catalogue-links.json').links) {
    eyeCatalogue[link.name] = build(indM.deriveComposerIndividual(recipeM.normalizeComposerRecipe(recipeM.decodeComposerRecipe(link.text).recipe).recipe).recipe);
  }

  let cliFiles = null;
  if (!quick) {
    cliFiles = {};
    const base = ['--out', 'unused', '--preset', 'all', '--count', '4', '--seed-prefix', 'ce1'];
    for (const [run, extra] of [['v1', []], ['v2-quest3-seamless', ['--target', 'quest-3', '--seamless']]]) {
      const args = cli.parseArgs([...base, ...extra]), files = {};
      for (const sel of args.selections) for (const [name, bytes] of cli.buildCreatureFiles(sel, args).files) files[name] = sha(bytes);
      cliFiles[run] = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1));
    }
  }
  const report = {schema: 'composer-identity-1', sourceHash, v1Pins, skin4Links, eyeCatalogue, cli: cliFiles};
  return {...report, digest: sha(JSON.stringify(report))};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), i = argv.indexOf('--root');
  const root = i >= 0 ? argv[i + 1] : KIT;
  if (!root) { console.error('usage: composer-identity.mjs [--root <dir>] [--quick]'); process.exit(1); }
  console.log(JSON.stringify(await composerIdentity(root, {quick: argv.includes('--quick')}), null, 2));
}
