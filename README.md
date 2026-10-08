# creature-kit

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
| `apps/creature-lab/` | The Creature Lab app: the composer page (see below). Not part of the library build or the npm `files`. |
| `tests/` | The Atlas-free composer tests, their fixtures, the boundary test and the Atlas parity test; `tests/lab/` and `tests/lab-boundary.test.mjs` for the app, `tests/browser/` for its browser tests. |
| `docs/` | Export v1 and v2 design notes, copied from Atlas (they still name Atlas paths and commits). |

Entry points (`package.json` `exports`, built into `dist/` by `npm run build`): `creature-kit/three`
(`createComposerCreature`), `creature-kit/gltf` (`exportCreatureGlb`), `creature-kit/lod`, and `creature-kit/<module>`
for any single module. Node refuses to type-strip `.ts` inside `node_modules`, so a package consumer uses `dist/`;
`creature-kit/src/*` exposes the sources for bundlers.

## Dependencies

`three` is a **peer** dependency, pinned to `npm:super-three@0.181.0` (the same alias Atlas uses; the gloss shader patch
depends on three's internals). Dev: `typescript@5.9.3`, `@types/three@0.181.0`, and `vite@7.3.6` for the Creature Lab app.
Nothing else declared. **Known hidden dependency:** the app's browser tests (`tests/browser/`) import `playwright`,
which is NOT in `devDependencies`; it resolves only through the junctioned Atlas `node_modules` (below). A standalone
checkout cannot run `npm run test:browser` until it is declared (planned with the Atlas cut-over, phase 4b).

No `package-lock.json` exists yet and `npm install` has not been run: in this workspace `node_modules` is a **junction**
to `C:/LLM/IWSDK/universe-atlas/node_modules`, which has exactly these versions. To recreate it:

```powershell
cmd /c mklink /J C:\LLM\IWSDK\creature-kit\node_modules C:\LLM\IWSDK\universe-atlas\node_modules
```

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

`apps/creature-lab/` is the kit's own review page: the composer mode of Universe Atlas's Creature Lab
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
  any other mode (Atlas's gallery, anatomy, arena, ancestry or skin) is rejected with a visible message; those modes need
  the planet and stay in Universe Atlas.
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
- Skin byte digests in `tests/fixtures/composer-skin4-links.json` stay identical unless a version bump is documented.
- Subsystem versions: graph `fauna-composer-graph-3`, skin `fauna-composer-skin-4`, eye `fauna-composer-eye-2`, eye
  catalogue `fauna-composer-eye-catalogue-1`, face `fauna-composer-face-2`, face geometry
  `fauna-composer-face-geometry-1`, individual `fauna-composer-individual-2`, species `composer-species-v1`, coat
  `fauna-coat-1`, export `fauna-composer-export-1`/`-2`, LOD `fauna-composer-lod-1`.
- `fauna-coat-*` is also used by Atlas's planet renderer (lineage B): changing the coat moves Atlas's life digests.

## Consumers

`universe-atlas` consumes the kit as a sha-pinned vendored copy of these files at their original `src/` paths, checked
by a drift test and refreshed by a sync script; see `docs/creature-kit-consumption.md` in that repo (branch
`infra/creature-kit-consume`).
