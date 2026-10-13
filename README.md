# creature-kit

Private Git remote (`origin`, branch `main`):
`caldor@192.168.50.17:/srv/git/repositories/creature-kit.git` (the same SSH
Git server used by Universe Atlas).

Since `0.11.1`, biped running includes loading, push-off and two suspension
intervals per cycle, with raised knees and bent-arm pumping. Quadrupeds use a
hind/front gallop sequence with a short left/right lag, spinal flexion and
whole-body suspension. Planted feet retain their stationary world contacts.

Since `0.11.0`, the shared rig adds `run`, `eat`, `fly` and `glide`.
Animal Lab exposes all eight motions, including source/middle/far LOD previews,
and the benchmark can measure the selected motion. Flight articulates the
original wings, folds the legs behind the body and has no planted-foot contacts.
Wingless animals fall back to standing when a flight preview is selected.
Planet callers supply a dated airborne path; the shared planet pose selects
flight for winged animals. These are procedural cycles, with no takeoff/landing
transition or aerodynamic simulation. GLB export retains its original four
default clips; request the new motion names explicitly to bake them.

Since `0.8.0`, `creature-kit/planet` exposes the same Composer source used by
**Animal Lab** for existing planetary genomes. The caller supplies the original
individual/species IDs, resolved metre dimensions and appearance. The adapter
does not regenerate populations or apply growth and variation a second time.
Full definition links reproduce the selected planet animal in the visual Lab.
The shared terrain pose keeps stance feet planted as dated activity changes.
See [planet Composer contract](docs/planet-composer-migration.md).

Since `0.7.0`, the primary **Animal Lab** opens the advanced Composer at
`apps/creature-lab/index.html`, with visual controls for snakes, worms, insects,
turtles, dinosaurs and proboscis faces. Its `realism-1` presentation improves
joined feet and protects their form in LODs. Historical `skin-5` remains selectable.
The old quadruped inspector is labelled archived. Its compatibility exports
remain available for historical consumers. See [current Lab and archives](docs/animal-lab-current.md)
and [measured realism changes](docs/composer-realism-1.md).

Since `0.2.0`, `creature-kit/planet` also owns Atlas's canonical planetary
genome/phenotype, connected quadruped body and terrain-aware pose core. These
are the original algorithms and data versions, not a composer-preset adapter.
World population/date/habitat controllers stay in Atlas. The experimental
composer has its own recipe authoring format; the shared planetary definition
adds resolved phenotype and provenance to this recipe for source construction.

Since `0.3.0`, `creature-kit/planet` exports `planetAnimalDefinition` and
`createPlanetAnimalInspector`. The standalone Lab's `planet-skin.html` accepts
an existing planetary genome/definition without reseeding it and uses the same
body and 22-bone pose implementation as Atlas. Atlas supplies dated activity
and its material through callbacks; the kit imports no Atlas controller.

The procedural fauna composer, extracted from `universe-atlas`: a recipe link (`v1`..`v4` text) becomes a species, an
individual, a rig graph and a skinned, vertex-coloured mesh, deterministically. A headless exporter writes the creature
as a GLB with baked clips, an optional LOD chain (`MSFT_lod`) and a provenance sidecar.

Status: **experimental**, private, all rights reserved (`UNLICENSED`, same as Universe Atlas and Civilization Lab; owner decision A13, 2026-10-07). Generated creatures stay
experimental until topology, deformation and in-headset checks pass.

Where it came from, file by file: `PROVENANCE.md`. Extraction plan: `C:/LLM/IWSDK/docs/creature-kit-extraction-plan-2026-10-04.md`.

## Layout

| Path | What |
|---|---|
| `src/` | The 12 composer core modules (`fauna-composer*.ts`, `fauna-coat-*.ts`), the GLB exporter `fauna-composer-export.ts` and the LOD reducer `fauna-composer-lod.ts`. They import only each other and `three`. |
| `scripts/export-creature.mjs` | Headless export CLI: `node scripts/export-creature.mjs --out <dir> --preset all [--target quest-3 --seamless]`. Never overwrites a different file. Exit 3 = budget exceeded, nothing written. |
| `scripts/composer-identity.mjs` | One digest over everything the composer produces for the pinned corpora; used to prove two trees behave identically. |
| `assets/briefs/creature-export-quest-3.json` | Asset-brief template for the quest-3 export. |
| `apps/creature-lab/` | Independent planetary inspection and experimental composer pages. Not part of the library build or npm `files`. |
| `tests/` | The Atlas-free composer tests, their fixtures, the boundary test and the Atlas parity test; `tests/lab/` and `tests/lab-boundary.test.mjs` for the app, `tests/browser/` for its browser tests. |
| `docs/` | Export v1 and v2 design notes, copied from Atlas (they still name Atlas paths and commits). |

Entry points (`package.json` `exports`, built into `dist/` by `npm run build`): `creature-kit/three`
(`createComposerCreature`), `creature-kit/planet` (canonical body, pose and inspector), `creature-kit/gltf` (`exportCreatureGlb`), `creature-kit/lod`, and `creature-kit/<module>`
for any single module. Node refuses to type-strip `.ts` inside `node_modules`, so a package consumer uses `dist/`;
`creature-kit/src/*` exposes the sources for bundlers.

## Dependencies

`three` is a **peer** dependency, pinned to `npm:super-three@0.181.0` (the same alias Atlas uses; the gloss shader patch
depends on three's internals). The lockfile pins the development toolchain, including `typescript@5.9.3`,
`@types/three@0.181.0`, `vite@7.3.6`, and `playwright@1.61.1` for the Creature Lab browser tests.

For a clean checkout, use Node `>=22.18` and run:

```powershell
npm ci
npm run build
npm test
npm run test:lab
npm run lab:build
npx playwright install chromium
npm run test:browser
```

The browser install is separate because Playwright's browser binaries are machine-level tools, not npm package files.
The Atlas working copy may still use a `node_modules` junction for convenience, but it is no longer required to build
or test Creature Kit. The committed lockfile was generated from an isolated package directory without that junction.
See [clean-checkout verification](docs/clean-checkout-verification-2026-10-13.md) for the recorded install and test results.

## Commands

```powershell
npm run typecheck                 # tsc --noEmit
npm run build                     # dist/ with .js imports (rewriteRelativeImportExtensions) and .d.ts
npm test                          # every tests/*.test.mjs (atlas-parity skips without ATLAS_DIR)
$env:ATLAS_DIR='C:/LLM/IWSDK/universe-atlas'; npm run test:parity
node scripts/composer-identity.mjs [--root <dir>] [--quick]
```

On this machine, run CPU-heavy tests through Atlas's shared test slot:
`$env:ATLAS_SLOT_SHARED='1'; node C:/LLM/IWSDK/universe-atlas/tests/helpers/test-slot.mjs --shared 8 -- node --test --test-concurrency=8 <files>`.

## Creature Lab app

`apps/creature-lab/planet-skin.html` is the canonical animal inspection page.
Paste an Atlas-exported `planet-animal-definition-1` record (or raw current
`CreatureGenome`) and inspect it with idle/walk/feed poses, skeleton and neutral
material. Demo animals are explicitly inspection inputs, not planetary members.
Definition identity and genome versions are preserved; incompatible versions
require an explicit migration. Export returns the same definition.

`apps/creature-lab/creature-lab.html` retains the experimental composer mode of Universe Atlas's Creature Lab
(`creature-lab.html?mode=composer`), copied from universe-atlas `7419733` (file by file, with blob ids and hashes, in
`apps/creature-lab/PROVENANCE.md`). Atlas keeps its own Creature Lab, all modes, unchanged.

```powershell
npm run lab:dev      # http://127.0.0.1:5206/apps/creature-lab/creature-lab.html (dev server rooted at the kit)
npm run lab:build    # apps/creature-lab/dist/creature-lab.html + assets/, relative URLs: deployable under any subpath
npm run test:lab     # tests/lab/*.test.mjs + tests/lab-boundary.test.mjs (no browser)
npm run test:browser -- --list    # the browser tests; running them needs the GPU browser lock (never inside the slot)
```

On this machine the CPU tests go through Atlas's shared test slot (as above), e.g. the parity test:

```powershell
$env:ATLAS_DIR='C:/LLM/IWSDK/universe-atlas'
node C:/LLM/IWSDK/universe-atlas/tests/helpers/test-slot.mjs --shared 4 -- node --test tests/lab/creature-lab-atlas-parity.test.mjs
node C:/LLM/IWSDK/universe-atlas/tests/helpers/test-slot.mjs --shared 4 -- npm run test:lab
```

- **Links.** The URL contract is Atlas's composer contract, key for key: `mode view time compare neutral skeleton recipe
  compareRecipe composerSeed motion herd light`, repeated identity keys or `light` reject the link, an unknown herd size
  or light falls back with a notice. A link from Atlas's composer mode opens the same animal here and the other way round;
  `tests/lab/creature-lab-atlas-parity.test.mjs` parses a fixed corpus with both parsers (skips without `ATLAS_DIR`).
- **One mode.** `mode=composer` is accepted and is the default (a link without `mode` opens the composer). A link naming
  any other mode on this composer page is rejected with a visible message. Canonical
  inspection has its own `planet-skin.html`; world/date browsing remains in Atlas.
- **Lighting.** The review presets are Atlas's. The planet surface colours are inlined as `REVIEW_SKY_COLOR` (`#b5cce3`)
  and `REVIEW_GROUND_ALBEDO` (`#697451`); the parity test checks them against Atlas's `SURFACE_SKY_COLOR` /
  `SURFACE_GROUND_ALBEDO`.
- **Boundary.** `apps/**` imports only `apps/**`, the kit's `src/**` and `three` (`tests/lab-boundary.test.mjs`; the Vite
  config may also import `vite` and `node:*`). The library build (`npm run build` -> `dist/`) does not include `apps/`.
- **Browser tests** (`tests/browser/`, copied from Atlas): `fauna-composer`, `fauna-composer-ui`, `fauna-composer-visual`,
  `fauna-composer-herd`, `creature-lab-eye-review`. `npm run test:browser` starts the dev server and runs them one after
  another; each takes the machine-wide GPU lock `C:/LLM/IWSDK/.gpu-browser-lock` (`tests/helpers/gpu-lock.mjs`, same lock
  as Atlas) and waits for it. SwiftShader unless `ATLAS_HARDWARE` is set.
- **Lock order: never run the browser tests inside the test slot.** The order is merge -> slot -> GPU, and captures do
  their GPU work outside the CPU slot (Atlas rule I8), so `test-slot.mjs ... -- npm run test:browser` is wrong: it would
  hold CPU tokens for the whole capture and wait. `tests/helpers/gpu-lock.mjs` carries Atlas's guards: it refuses the GPU
  lock while the process holds the slot or inherited `ATLAS_TEST_SLOT_TOKEN` (every kit GPU user is a capture, so this is
  on by default; `capture: false` lifts it) and while a slot wait of the process is pending; `npm run test:browser`
  checks the same before it starts the dev server. Run it bare, from a shell that holds no slot.

## Contracts

- Recipe links `v1`..`v4` decode forever; the vocabulary is append-only (`composer-v1-links`, `baseline-v2`,
  `baseline-v3` fixtures).
- Skin byte digests in `tests/fixtures/composer-skin5-links.json` (skin-5) stay identical unless a version bump is
  documented. `composer-skin4-links.json` (skin-4) and the older link fixtures are kept as history.
- Subsystem versions: graph `fauna-composer-graph-4`, skin `fauna-composer-skin-5`, crisp-coat material shader
  `fauna-composer-coat-crisp-1`, eye `fauna-composer-eye-2`, eye catalogue `fauna-composer-eye-catalogue-1`, face
  `fauna-composer-face-2`, face geometry `fauna-composer-face-geometry-2`, individual `fauna-composer-individual-2`,
  species `composer-species-v1`, coat `fauna-coat-1`, export `fauna-composer-export-3`, skeleton
  `fauna-composer-skeleton-1`, LOD `fauna-composer-lod-1`.
- `fauna-coat-*` is also used by Atlas's planet renderer (lineage B): changing the coat moves Atlas's life digests.
  `tests/fixtures/coat-lineage-b-guard.json` freezes every 3e0d6e8 export of both coat modules.

### Coat crisp v1 merged (kit main 13c7b35, `docs/fauna-coat-crisp-v1.md`)

- The crisp coat is runtime-only: the `fauna-composer-coat-crisp-1` shader evaluates the pattern per fragment. GLB
  export keeps vertex colours, so an exported creature carries the coarser clamped vertex pattern, not the crisp coat.
  A GLB's colours do follow the skin-5 geometry (the coat is sampled at each vertex's position, so where the neck-to-head
  blend moved a vertex its colour moved too).
- Sexual dichromatism uses existing recipe fields only (sex, dimorphism, maturity, palette): an adult male's back and
  flanks take a richer coat; females and sexless animals are unchanged.
- Seam normals: welded per-position normals replace three's `computeVertexNormals`, so part seams shade continuously.
- OPEN:
  - the trunk tip still reads as a cap (metric d3 met, visual goal not met; Atlas backlog FAUNA-TRUNK-TIP-2);
  - one trunk join band on the trunked centipede (FAUNA-TRUNK-JOIN-BAND);
  - leg-to-body joins read as gaps or merges, pre-existing (FAUNA-LEG-JOIN);
  - the head start-cap pokes through the throat on 25 of 83 specimens, up from 20 (FAUNA-HEAD-CAP-CLIP);
  - ostrich and shelled-giraffe-bird eyes sit about 2.3 eye radii further back; check on the next review sheet;
  - a breeding male bird can come out duller than the female (blue female, tan male for colorSeed 5).

## Consumers

`universe-atlas` consumes `creature-kit/planet` as a self-contained built package
with exact commit/version/file hashes. `npm run update:creature-kit -- --kit <checkout>`
preflights and builds the committed kit before updating Atlas. Composer source
consumption uses the same SHA-pinned sync for renderer types and shaders.
See Atlas's `docs/creature-kit-planet-package-2026-10-10.md`.


## Planet appearance API 0.4

The additive loaded-body colour and raw pattern samplers preserve the frozen
planetary generator, source arrays and genome. The planet entry now exports
`COAT_PATTERN_CRISP_GLSL` from one shared module used by the composer as well.
Consumers must supply the actual planetary rest-space context and preserve its
clamp stages, supplemental colours and full 32-bit seed. Choosing a per-fragment
appearance changes interpolation compared with the original baked vertex colours;
it requires an explicit presentation version and visual/performance review. This
API release does not enable Atlas's prototype renderer or select a new LOD method.
The canonical inspector and definition exports remain available.


## Exact pose workspace API 0.5

The additive `createQuadrupedPoseWorkspace(plan, member)` and
`quadrupedPoseAtInto(workspace, activity, ground, rigSeconds, options)` APIs reuse
immutable preparation and output storage while preserving the original terrain
sampling and canonical IK. Into output is borrowed until the next call with the
same workspace; copy it when retaining a snapshot. Existing `quadrupedPoseAt`
continues returning independent output objects and arrays. Each workspace owns
1,760 typed output bytes plus explicitly counted JS scratch; temporary solver
allocations remain. See `docs/planet-pose-workspace-prototype.md` for exactness,
desktop Node evidence and the limits on browser/whole-game/Quest claims.
