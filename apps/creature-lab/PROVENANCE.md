# Creature Lab app: provenance

The kit's Creature Lab app is the **composer mode** of universe-atlas's Creature Lab (`creature-lab.html?mode=composer`),
copied into the kit so the kit is a product of its own (Kasper, 2026-10-07: "sin egen ting som dette projekt så bruger").
Extraction plan phase 4a: `C:/LLM/IWSDK/docs/creature-kit-extraction-plan-2026-10-04.md`.

- **Source repository:** `C:/LLM/IWSDK/universe-atlas` (local, no remote).
- **Source commit:** `7419733` (universe-atlas `main` on 2026-10-07).
- **Method:** copy, not move. Atlas is untouched by this step; its Creature Lab keeps every mode until the phase-4b
  cut-over. Until then Atlas is the source of truth for these files, and a change made there has to be brought over by hand
  (`tests/lab/creature-lab-atlas-parity.test.mjs`, run with `ATLAS_DIR`, catches URL-contract and lighting-colour drift and diffs the copied panel, lighting and CSS files against Atlas).
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

## Copied tests

Node tests run with `npm run test:lab`; browser tests are run by hand at a GPU slot (`npm run test:browser` lists them).
Every copy changes import paths (`../src/X` becomes `../../src/X` for kit modules, `../../apps/creature-lab/src/X` for app
modules; `./fixtures/` becomes `../fixtures/`); further changes are listed.

| Kit path | Atlas path | blob | sha256 (LF) | last Atlas commit | kit sha256 (LF) | Further change |
|---|---|---|---|---|---|---|
| `tests/lab/creature-lab-state.test.mjs` | `tests/creature-lab-state.test.mjs` | `12903942d7f77ed982aacb84bfc43dd20922073a` | `952592387060f1412b23e5db6f390970a2eea61c32588f442e51c10964f088f0` | `178d8de` | `ea1589fbea7cbd16e4fb15ca303c74c2f2ba9851defd885ec6da4f5c03baf0e7` | Composer tests only: the 7 planetary-mode tests (identity URLs, malformed planetary state, morph controls, trait locks, v2 replay, template revisions, legacy link re-share) and the planet-skin/gallery asserts inside the herd/light tests are dropped; one title shortened accordingly. |
| `tests/lab/fauna-composer.test.mjs` | `tests/fauna-composer.test.mjs` | `078b8a2d3c2a872c014120efb1f92a0a5b9c9fd5` | `94ae75201c0ee3b7fdba5c691b0df754be7fc57fbe348a8efe5009639b8bc3d3` | `0e02688` | `0ccd63a6657321ee6f4f2cd48109c44282230e15bf0a7a3e39fb0dfa19fed3f7` | The URL test loses its three `mode=skin` asserts (planetary links); title shortened. |
| `tests/lab/fauna-review-lighting.test.mjs` | `tests/fauna-review-lighting.test.mjs` | `e3213a1a91481a399a610f0a0b16b020521197bf` | `a077450514850fdf8e04a0fe9a5d039571dad1673d0ff75535155dddf8a78ea8` | `9d3b84c` | `a91d6b3f75d08b1f26d0ad5e10d0f17f747ced500c733d0627508aa666c5fa5a` | None. |
| `tests/lab/fauna-review-environment.test.mjs` | `tests/fauna-review-environment.test.mjs` | `1a5cbc1e026d78af36897f78d13c971f3a38ae9f` | `e719fece2a11b5398cdd8776b6e106610bb7db644f76ac109131e5fb193edf56` | `27a7e5a` | `59cb448a18de718720d9e36c1e497af4f075824cae525459b94c4b5cf9eab112` | `SURFACE_SKY_COLOR` is the app's `REVIEW_SKY_COLOR`; the planet-noon comparison with Atlas `SurfaceLighting` moved to `tests/lab/creature-lab-atlas-parity.test.mjs` (needs Atlas); the evening and studio ground checks stay. |
| `tests/lab/creature-lab-eyes.test.mjs` | `tests/creature-lab-eyes.test.mjs` | `1dd58c984000361bd32accfc3c324e48440c51c7` | `7eb9adbf7897a0fe727722d7c5f279223dc7faffe55afcfe9301cc1d24f1f89f` | `41c2a37` | `e5d29ca07f685597c55867aa6658c2ea0712eafb6c20ad343a8a71a6a3c98a7f` | None. |
| `tests/browser/fauna-composer.browser.mjs` | `tests/fauna-composer.browser.mjs` | `201b45aeee30bfb01ec9387eda881d972191e965` | `04b0688533c17420c7de1fbc19bd545096ae8b2f7a034fc09c5c65aa21f4a51e` | `846a622` | `50be382ec9cfb20912201d2a0df802c5e73d211173358bf8c21027a97191e267` | `CREATURE_LAB_URL`/`CREATURE_LAB_RESULTS` (was `ATLAS_URL`/`ATLAS_RESULTS`), default `http://127.0.0.1:5206/apps/creature-lab/`; the planet-skin light block and section 12 (legacy modes) replaced by checks that `?mode=gallery` / `?mode=skin` are rejected visibly and a link without mode opens composer mode. |
| `tests/browser/fauna-composer-ui.browser.mjs` | `tests/fauna-composer-ui.browser.mjs` | `5bf8f1f9e5e071db653838468e6ad198a6f10887` | `198736b4d016fe831a7ff948b0e98ba3ddc67ac1f4979142fc4d2eb023607436` | `47313a0` | `0e783f2c9927032ec6fe481effeeb8b92aa5c6bb4918168ad6cb91c716a2b468` | Env names and default URL as above; source snapshot hashes the kit/app files (`creature-lab.ts` becomes `apps/creature-lab/src/main.ts`); the `#mode` gallery round trip removed (no mode select). |
| `tests/browser/fauna-composer-visual.browser.mjs` | `tests/fauna-composer-visual.browser.mjs` | `7b87571574239f67e052bea0590976b9d7aade23` | `4a57e7e9e0b628a2a5d7aaf429056715d0a8591d109504aaa10c2ebc35efb055` | `6e16059` | `ba54b9567bfafabefc97893cda4ecea1524be8b48010817431b73de959730df7` | Env names, default origin `http://127.0.0.1:5206`; in-page imports of the review modules from `/apps/creature-lab/src/`. |
| `tests/browser/fauna-composer-herd.browser.mjs` | `tests/fauna-composer-herd.browser.mjs` | `244c708a1d301eb356878f8e83d7e260b1f58224` | `caa0d685b94b47b8846e0c1221b720ebda00046a8a72bbbe0424e90c9b2d83da` | `6e16059` | `103fa66071c562de6cf3712e952b68ee119760a118503f295f369e0872288d91` | Env names and default URL as above; in-page imports of the panel and review modules from `/apps/creature-lab/src/`. |
| `tests/browser/creature-lab-eye-review.browser.mjs` | `tests/creature-lab-eye-review.browser.mjs` | `15442aab8a11526bf80cf61d035f7f1e6842acb4` | `c839ed87e261e3711b2b2d6ee3bd8933fa24ac84e1589df5984eb4ec47c9117f` | `4d31e33` | `d7a0f2ef1377ae5ea3a30bae980aafe7f9edced7da523a194524d864207b6775` | Its own Vite server is rooted at the kit (`../..`) with `cacheDir` `apps/creature-lab/.vite`; page `/apps/creature-lab/creature-lab.html`, host `/apps/creature-lab/src/main.ts`. |
| `tests/browser/browser-options.mjs` | `tests/browser-options.mjs` | `1dbced3f8cc24932954c243f2f2dda128b15b105` | `51147d2d7087b09cba09915c57eb78ee51cb572fed6ec1921c1035cee14a6d51` | `f7e3ea0` | `51147d2d7087b09cba09915c57eb78ee51cb572fed6ec1921c1035cee14a6d51` | None (byte-identical; `ATLAS_HARDWARE` still selects the hardware GPU). |

`tests/helpers/gpu-lock.mjs` is new: a smaller rewrite of Atlas `tests/helpers/gpu-lock.mjs` (blob
`b3844a3c7e57c148fac0fb1cfeeb5685729fe7fd`) with the same lock directory (`C:/LLM/IWSDK/.gpu-browser-lock`), owner.txt,
heartbeat, 20-minute stale rule and `ATLAS_GPU_LOCK_HELD` publication; Atlas's slot-pending and capture-in-slot guards are
not carried over (the kit has no test slot of its own). New kit tests with no Atlas source:
`tests/lab/creature-lab-atlas-parity.test.mjs`, `tests/lab/creature-lab-app-state.test.mjs`, `tests/lab/gpu-lock.test.mjs`,
`tests/lab-boundary.test.mjs`.
