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
| `tests/` | The Atlas-free composer tests, their fixtures, the boundary test and the Atlas parity test. |
| `docs/` | Export v1 and v2 design notes, copied from Atlas (they still name Atlas paths and commits). |

Entry points (`package.json` `exports`, built into `dist/` by `npm run build`): `creature-kit/three`
(`createComposerCreature`), `creature-kit/gltf` (`exportCreatureGlb`), `creature-kit/lod`, and `creature-kit/<module>`
for any single module. Node refuses to type-strip `.ts` inside `node_modules`, so a package consumer uses `dist/`;
`creature-kit/src/*` exposes the sources for bundlers.

## Dependencies

`three` is a **peer** dependency, pinned to `npm:super-three@0.181.0` (the same alias Atlas uses; the gloss shader patch
depends on three's internals). Dev: `typescript@5.9.3`, `@types/three@0.181.0`. Nothing else.

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
