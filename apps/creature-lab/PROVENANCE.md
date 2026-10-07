# Creature Lab app: provenance

The kit's Creature Lab app is the **composer mode** of universe-atlas's Creature Lab (`creature-lab.html?mode=composer`),
copied into the kit so the kit is a product of its own (Kasper, 2026-10-07: "sin egen ting som dette projekt så bruger").
Extraction plan phase 4a: `C:/LLM/IWSDK/docs/creature-kit-extraction-plan-2026-10-04.md`.

- **Source repository:** `C:/LLM/IWSDK/universe-atlas` (local, no remote).
- **Source commit:** `7419733` (universe-atlas `main` on 2026-10-07).
- **Method:** copy, not move. Atlas is untouched by this step; its Creature Lab keeps every mode until the phase-4b
  cut-over. Until then Atlas is the source of truth for these files, and a change made there has to be brought over by hand
  (the parity test below catches URL-contract and lighting-colour drift; it does not diff the panel code).
- **Decisions** (Opus-decided on Kasper's instruction, overrulable):
  - the app is composer-only; a link without `mode` opens composer mode, a link naming any other mode is rejected visibly;
  - the composer panel module is copied unchanged apart from its import paths, so a later Atlas fix can be diffed in;
  - the host page (`src/main.ts`) is new code written from the composer branch of Atlas's `src/creature-lab.ts`;
  - the dev server is rooted at the kit root (the browser tests import `/src/*.ts` and `/node_modules/three/...`), the
    build at this folder (`dist/creature-lab.html`, relative URLs).
- **Licence:** `UNLICENSED` (private, all rights reserved), as the rest of the kit.

## Copied files

`blob` is the git blob id in universe-atlas at `7419733`; `sha256 (LF)` is the sha256 of those committed (LF) bytes, so it
is independent of the checkout's line endings. `last Atlas commit` is the most recent universe-atlas commit touching the
file at or before `7419733`. `kit sha256 (LF)` is the file as committed here.

| Kit path | Atlas path | blob | sha256 (LF) | last Atlas commit | kit sha256 (LF) | Change |
|---|---|---|---|---|---|---|
| `apps/creature-lab/src/creature-lab-composer.ts` | `src/creature-lab-composer.ts` | `4da0baa3569d207d3c5b37156609140edbd013e7` | `15fab8594f9143a21ca70d659ec9e59b3178f79e72c2570ca625974d580cf6a4` | `41c2a37` | `10060e4c21f3de9d5f7e16b6f150a224026c2d8bc3f85161832f8075a7ce1d67` | Import paths only: `./fauna-*.ts` becomes `../../../src/fauna-*.ts` (lines 2-11). |
| `apps/creature-lab/src/creature-lab-state.ts` | `src/creature-lab-state.ts` | `a6b5568e1026e9c147294a756cb47b53505c07fc` | `405aca6f19521ebdf841b32b4d1abe52271ba21064859bdccad5f15923053257` | `71cc529` | `25c3e9a5e103f8ecc4e66dca54981b90d44078ee99ea82192f6542635f005dcc` | Composer slice: the keys a composer link writes (`mode view time compare neutral skeleton recipe compareRecipe composerSeed motion herd light`), parsed with the same rules; `mode` is always `composer` and is the default; another mode is an input error; the planetary-mode keys, `creatureLabReplayInputError` and `creatureLabTemplateMismatch` are dropped (they need `fauna-appearance.ts` and `fauna-template-phenotype.ts`). |
| `apps/creature-lab/src/fauna-review-lighting.ts` | `src/fauna-review-lighting.ts` | `f02385649b4f68e274837bea662a69c1a5812d19` | `90c7aec8447f9f0023495c037f151376d81d8c3bf043d79b799ddea8e934e4d0` | `9d3b84c` | `90c7aec8447f9f0023495c037f151376d81d8c3bf043d79b799ddea8e934e4d0` | None (byte-identical). |
| `apps/creature-lab/src/fauna-review-environment.ts` | `src/fauna-review-environment.ts` | `36bb84ed674e0b3dc5d929c571dd0cac39010922` | `aa7b9711d57ffca8329525c5bb1fe8e8c079a293a8495c923921943eb6431baf` | `27a7e5a` | `f92e713ad2872421024b36262fef9d12072cf7c01fa189c9b6d115f246372d6f` | The `surface-lighting.ts` import is replaced by two inlined, exported constants with the exact values: `REVIEW_SKY_COLOR = new THREE.Color('#b5cce3')` (Atlas `SURFACE_SKY_COLOR`) and `REVIEW_GROUND_ALBEDO = new THREE.Color('#697451')` (Atlas `SURFACE_GROUND_ALBEDO`); the three uses are renamed. |
| `apps/creature-lab/creature-lab.html` | `creature-lab.html` | `c98c56269a6c644352c3edce2c160b701f3718a5` | `5c51fa7a35e8c41856ebf8ae731575141e11f16804d90af9c097582107993731` | `7e5b194` | `d79fee4b4ad5a427877dc826cc00800687aec1d874f7c54cfd9f95492a727c39` | The composer panel (`#composer-controls`, unchanged), its inline styles (minus the gallery label-card rules), and the shared shell the composer mode uses (`#lighting`, `#skeleton`, `#neutral`, notices, details, diagnostics, share link, JSON export, caption, status). Dropped: the planetary-mode controls, the header seed/profile controls, the mode select, the Atlas navigation links and the label layer. Script: `./src/main.ts`. |
| `apps/creature-lab/src/creature-lab.css` | `src/creature-lab.css` | `d88b8b522b79e94a81108cc4fe772fc9cc5914d7` | `179be328da367433bebf78e66062225932ff405a9868da10e7063d56c4c7d48d` | `9d3b84c` | `179be328da367433bebf78e66062225932ff405a9868da10e7063d56c4c7d48d` | None (byte-identical; the planetary-mode rules are unused here). |

## Derived (new code written from an Atlas file)

| Kit path | Written from | blob | sha256 (LF) | last Atlas commit | What |
|---|---|---|---|---|---|
| `apps/creature-lab/src/main.ts` | `src/creature-lab.ts` | `df3a834be5c569af3abf2c6dd45cd9a6d8b12dda` | `46aa5fba35815423434328a31b44deff282032dd149617793e1c631b76cdfc6b` | `b559866` | The composer branch of the Atlas host: renderer, camera, orbit controls, review lighting swap and shadow fit, the flat review ground, `fitViewCamera`/`fitEyeCamera`/`followEye`, frame loop, share link, JSON export and `window.__creatureLab` (composer fields only; `mode` is always `composer`). Atlas's planetary-mode code (biosphere, creature rig, templates, labels) is not carried over. |
| `apps/creature-lab/src/fauna-review-environment.ts` constants | `src/surface-lighting.ts` | `75b54b871b953de6cd5a3cc5de691421971e8cc4` | `358c1b96e0f1a1c747b51e72b99d93f8f76de128a0c5cd3fae85d6aed40a356a` | `cccf15a` | `SURFACE_SKY_COLOR`, `SURFACE_GROUND_ALBEDO` values only. |

New, no Atlas source: `apps/creature-lab/vite.config.mjs`, this file.
