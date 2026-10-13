# Provenance

## Canonical planetary core extraction (2026-10-10)

`src/planet-v1/{creature-model,fauna-appearance,fauna-body-plan,fauna-face,
fauna-structural-appendages,fauna-locomotion}.ts` comes from the same six Atlas
files at `f96a8c1`. Geometry, phenotype and locomotion arithmetic are copied
unchanged. Only coat import paths and the locomotion's Atlas-only type dependency
change: `caller-contract.ts` owns the structural member/activity input shape.
Atlas remains the owner of dates, population, membership, habitat and ground.

`tests/fixtures/planet-core-f96a8c1.json` records the pre-extraction genotypes,
inherited genomes, twelve adult/juvenile body-buffer digests, coat samples and
terrain-aware walking/feeding pose digests. Existing genotype/body/appearance
versions stay unchanged. This release moves actual planetary core ownership;
it does not replace those animals with composer presets or claim the two
generator formats have already converged. No composer generator source moved.

Library release `0.2.0` adds public `creature-kit/planet`, built from
`src/planet-v1/index.ts`. All source arrays, source identity and
`UNLICENSED` provenance are retained.

## Source

- **Source repository:** `C:/LLM/IWSDK/universe-atlas` (local, no remote).
- **Source commit:** `ab6042c567b3c854b534427f83c7c515733e11d5` (`ab6042c`, universe-atlas `main` on 2026-10-07, after the
  composer-stability, export-v2 and ocellus-seam merges).
- **Method:** copy, not move. No history-preserving tool fits: `git filter-repo` is not installed, and `git subtree split`
  only splits a whole directory prefix, while the creature files are 48 files mixed into Atlas's `src/`, `tests/`,
  `scripts/`, `assets/` and `docs/`. The kit's history therefore starts at commit `4c8783e` ("Import composer core from
  universe-atlas@ab6042c, unchanged"). The earlier history of each file is in universe-atlas; the last Atlas commit that
  touched each file is listed below, so `git -C universe-atlas log <commit> -- <path>` recovers it.
- **Owner decision:** Kasper, 2026-10-07: the creature kit is its own repo, consumed by Atlas (universe-atlas
  `docs/owner-decisions-2026-10-04.md`, "Owner answers 2026-10-07", A18 Q6). Plan:
  `C:/LLM/IWSDK/docs/creature-kit-extraction-plan-2026-10-04.md`.
- **Licence:** `UNLICENSED` (all rights reserved; public visibility does not grant reuse rights), the same as the rest of the owner's projects. Owner decision A13, 2026-10-07: "Den licens skal være den samme som resten".

## Per-file record (at the import commit)

`blob` is the git blob id in universe-atlas at `ab6042c`; the kit's import commit `4c8783e` has the same blob id for
every file (checked). `sha256 (LF)` is the sha256 of the committed (LF) bytes, so it is independent of the checkout's
line endings. `last Atlas commit` is the most recent universe-atlas commit touching the file at or before `ab6042c`.

| Path | blob | sha256 (LF) | last Atlas commit |
|---|---|---|---|
| `assets/briefs/creature-export-quest-3.json` | `c3ccd675b5c4b8980a7ced00df9b0f82e7e0d1ad` | `07f0c49a220bb5ff010c2d41149ec0ce382efc98ed4477ca89f1ef056c983e13` | `880ea62` |
| `docs/creature-export-v1.md` | `c4868c1f84c63ff9dcd55f826686b194de441804` | `dcea23e062fae3f5a5e3df8a94131accbae4e6914de843d7f9288fcacaa62108` | `a101bb4` |
| `docs/creature-export-v2.md` | `921d6c456c4b68d2691d3e3762c81e1b5c77e9f6` | `6bf421d7e07551974b13a57da0e0bb83f5e50a6b92ca43f9d55b3ece8c973771` | `e4f9c8c` |
| `scripts/export-creature.mjs` | `98ff995441feb63a2588c41940d63727912abf3e` | `e86c69ca0e74eca9273a5f5c2e7f316bd947afadab455bb6ab34bda850dafe56` | `880ea62` |
| `src/fauna-coat-fields.ts` | `c7517b7987aaa194f527d320023f293e684955b3` | `0648dcf1cfb11853813dc655030f93a9571825aa554d36be2b993992a529bb15` | `679407f` |
| `src/fauna-coat-vocab.ts` | `28bccd3f736811a8a2cbd5e957964856469bbc05` | `4ffc73800d048c7f46a2c5452a18d5179cf9a17b5cbbc1bb3497989bf0f4cab7` | `1ec5072` |
| `src/fauna-composer-export.ts` | `ffd525bf59f772c1cbb7f1270fed7b7a07e8921a` | `20d781298faa484f6c595141a5ad0df73914760d4128d60facb0b9841496a293` | `e7d76e4` |
| `src/fauna-composer-eye-catalogue.ts` | `04d020b8271b2cc96781eba9a1fb2a8baa66b5ae` | `8cfcb95cedced7e71a718a6f1c9c7f57899ed6decebdb9837faed187049aca2b` | `ed5dab3` |
| `src/fauna-composer-eye.ts` | `fc58877a0e692c49ab3083ad77ca7d9554a9b220` | `5e10538cd89b5106dd8627f5a2a0beaeeccd7cd43573f8bed9ec7a751daf4110` | `4e030bb` |
| `src/fauna-composer-face-geometry.ts` | `1ea1546a24615b83b3358beb39d79d182cc4911f` | `1eeac2392172a491ab183e051efdffd49a265570cc94420110c3da2e9800c54b` | `0b4baf2` |
| `src/fauna-composer-face.ts` | `c88bf9233f4a6a2d3a531088813abc2f1a37ff51` | `64d24814bc97952d162ac5cbe7ca0fab77759e379799b959cff293436a083365` | `ed5dab3` |
| `src/fauna-composer-individual.ts` | `ae669b6ddb84147acbe0a1e73dc26473bcbc1fa5` | `9d5cb67607fdda03464efdc6647692b195d317dbc741ada91e52da78e918bdbd` | `2b3da98` |
| `src/fauna-composer-lod.ts` | `7cd26cc9219473b374f3fb5aacc246a20f368848` | `3842242654f3090c725b9c283034a10997c1ba41b4ff239b044a8d3dbc5a1e53` | `880ea62` |
| `src/fauna-composer-mesh.ts` | `61ea45d70b5db6eb61b675e9a5afe2e3b73d5cd9` | `fbb66cd375f67b62dd333cfde0cce269ed6c48fa22db91e74ca129c1a769c8ff` | `bfe1399` |
| `src/fauna-composer-recipe.ts` | `08a01fe93472f2bfc6ad5b525394f6dd788ce2f2` | `fceaae0cc833262e098d29f62ed8836e6d9da458641741e66fb6ceaefc6ae39b` | `0e02688` |
| `src/fauna-composer-rig.ts` | `e4145850baea7fef955dc84a546d34b4b2ac9b8e` | `4cb64e17425ab88092177476603b3c9ba7d8134352fcd42456ea3095da92c066` | `c6067d8` |
| `src/fauna-composer-species.ts` | `cda7639e2dcacbc96884bc9314bb7d030d61e979` | `d756ddb1409edae98a28fc1072e55002c6504871cd5c9166dad43b3ff2af3ad0` | `0e02688` |
| `src/fauna-composer.ts` | `85a61e4944a13b1549728bed62d26da9de42905b` | `0d7fa3397fa9bbc415f0f2fa6f23023cf633677a9a8a416ea18638baffa95a2b` | `3623f89` |
| `tests/creature-core-boundary.test.mjs` | `4c3ce4588cd9f5f66a3d25d6c555f5143440842c` | `dbaaa2812dcfb8834ebbdce05ec70ce8e95726919940a3223d24c47587cb441e` | `e44f458` |
| `tests/fauna-coat-fields.test.mjs` | `b85649c27b24b7b01dfe0e8c8eaf9b6e2c85dfa3` | `44719eb154c65619f4d8bf84116494dc09adc9e01961de2e42ad7b943bb23fde` | `6c7b0f8` |
| `tests/fauna-composer-coat.test.mjs` | `175a6cf5c018abe55f73bbc6bfd252e02912f653` | `027797a5f15b867029afbe4d515a6711357ea8213cd03c07b28bbdbbdb094a2f` | `e84d499` |
| `tests/fauna-composer-export.test.mjs` | `6d3751e95b96b9bbef118b34f3abac8bcc1be9a7` | `073e9cbc397254920de1bc7f25498d0fd0502fc608df141374b1e7786e89f954` | `e4f9c8c` |
| `tests/fauna-composer-eye-catalogue-geometry.test.mjs` | `5551f9e00bd05fcb6fe0be98251f318178811c7c` | `5f78a65ceed6a29864372b1c592474b2a7a8b348bbcd30e3f15f6d704c2e0182` | `4e030bb` |
| `tests/fauna-composer-eye-catalogue.test.mjs` | `9c760e54ff10d8dc34faca6e9f172b3b1838a17e` | `eefa72ef605d56eb38324d843450d7936e59e4b700151c66c3e0b0e6e742c428` | `d38a26c` |
| `tests/fauna-composer-eyes.test.mjs` | `f90a372beef19a2c2f8896a7285f4ded76df43c9` | `733602bd32a632d8a2db56e5be2999839386ecaa8e7a14d7847bcbc1056ce2d8` | `4e030bb` |
| `tests/fauna-composer-face.test.mjs` | `c193ea909a47fe8536c5d1c23dd3cf3ff776951e` | `f7a76d99b97e11047f0107959df09eb2df4eac2aa1429bb1a052d7bf0022bca6` | `ed5dab3` |
| `tests/fauna-composer-gait.test.mjs` | `6f48cf411c723488aef60ea7965c815c7f81194d` | `5bbfd1b8eec2c4449f987d2e62e371ca0a57cc4a72d0228b734e27e1886ce946` | `0b4baf2` |
| `tests/fauna-composer-gloss.test.mjs` | `59e6094ba2aa8a479f2114f2935df83df2cff984` | `99f74d96e0291ba3d808f7ee89a5531e804ac7ac7746a2f679e394da324091d7` | `3623f89` |
| `tests/fauna-composer-head-geometry.test.mjs` | `705b995bd57c83e60fc58cb63f9da11c1ca3d10b` | `999123819ac1824317c7f5e8a8c4ca8225c1f08a49bb0312502e49febb5a56ab` | `b86b0ad` |
| `tests/fauna-composer-head-occlusion.test.mjs` | `a908c4deb1ef21679bc5a0eae0a6457600cc2880` | `c8ea6988dace13c735c29d5b22f9d19fb4d258a251c308b07357c48ded325cd0` | `a633587` |
| `tests/fauna-composer-individual.test.mjs` | `675268a11165cae4e1fde3ff78aaf2c8406b108b` | `459f214c479a15c78b9d013b38f327f2afacd3b244185f7cb8524661dd7fac50` | `c6067d8` |
| `tests/fauna-composer-lod.test.mjs` | `f2d31e2a04f79ef6b3ffaadc357195ef0ac23c5c` | `63c427b489348f7891586533e04f80e24405fd3862500245e0edd5fffe2a47e8` | `4bbc8d8` |
| `tests/fauna-composer-mesh-stability.test.mjs` | `f1b9b63ac54340573d44f1e435083b9bf15d6fb4` | `36ec1e8c9494eaef95a3b3d05945e71b7206c611d910d597a1d1866227bf2783` | `bfe1399` |
| `tests/fauna-composer-recipe-independent.test.mjs` | `5529c66838207ab64a034d0892f5383b06c96ded` | `c83be4821bfabc9e63ace2c12cc16e0a469dbef50c26ccb10817ce56b9538c55` | `0e02688` |
| `tests/fauna-composer-rig-independent.test.mjs` | `99ad5161c0c9d63d65eeef9b2429de0794ef2b24` | `96b0eea919a9d7619000e93fb96d69e3b62d2dad6cc268bd21fe0ffffa8f3555` | `2b3da98` |
| `tests/fauna-composer-skin-anatomy.test.mjs` | `6b9291fe04b20009178f3f8846b723f432d4f28b` | `aa03a340f8b4b2aee5d96e8619628bda101a7e292227242433c60b2f00f6d7de` | `d38a26c` |
| `tests/fauna-composer-skin4-links.test.mjs` | `f0923ef94903a70b166002f8f23e65e755295e29` | `30e820bd8edf5624f6d2606554f6b7a1f673d870773d8e054d1755dc5100a97f` | `27aaa91` |
| `tests/fauna-composer-structure-independent.test.mjs` | `ba75ac07c2541587770ef7b5d55d993b0f906410` | `3293c664f35bcecaf52e57862167fab2ce6eaf703c28a674235e64d046105433` | `2b3da98` |
| `tests/fauna-face-specimens.json` | `9cd58fb241c11efb0291c2214b4d7c4d3d65f77c` | `d4a36aa7ff0035af54ca2197e610ec94ffc7d6c4defd386243d360b54e9eee16` | `ed5dab3` |
| `tests/fixtures/composer-baseline-v2.json` | `5b19a1485990b962c4a6777f677b6761513be2d5` | `c9834a221fbd0ebeefc9bf8b3b0fc49399ae15c9503158e21e377181570bb2fa` | `5d8f5eb` |
| `tests/fixtures/composer-baseline-v3.json` | `4a21512ee910c00517cf17a4e238f35c87b61527` | `9eeecc60e3d61050e3830940fb279b0038a7c8c895a98d2d42a633f4479997bc` | `6704a08` |
| `tests/fixtures/composer-eye-catalogue-links.json` | `f6ef66d6050644920c0a5c27303ac77c0d6b2aca` | `292de79f72559f7e7e97cdefa03fe52e2ca3098a0d8f7229b67a301c216aea0e` | `d721a39` |
| `tests/fixtures/composer-skin2-links.json` | `b3ce82cdc12d0bbb78c787d8e8e6826b4e2f7a81` | `a733621ebb3338dfb9a204588c639080b17cae80c92f9ee00a982e40342bf9a2` | `2b3da98` |
| `tests/fixtures/composer-skin3-links.json` | `0d718abb05e91bf895837abfc3b3b475effc7fc5` | `dd281b0c4a152ca0715ac12567920686f80bba8cb652ed8826dbe3f4466b174e` | `b86b0ad` |
| `tests/fixtures/composer-skin4-links.json` | `4b19a9b271f6c3dfce9ee8ed635759d65a5892c9` | `b6c1fc96be251d8aaf94b10dcb2563c395a1a27f5c08e12b5b930a84cdb44985` | `bfe1399` |
| `tests/fixtures/composer-v1-links.json` | `3e4c7148c37af68b3ce653a33fac37207360fbc7` | `4df69c57e5c330a563fcce68e4fcc3dea71a6fd6258e18948336969f16e0057b` | `ddc224a` |
| `tests/fixtures/creature-core-exports.json` | `b1fffe5aa2da4b63f51df9483e6b6b989373532d` | `27fd1eb9a9b6575f846ccc99d31d3066e20903282c7bbf6d81d808c8876a9c19` | `0ebc88e` |
| `tests/helpers/composer-head-occlusion.mjs` | `02760bd24d8c82068d83b021a7a83b1a9b57904c` | `2c87cf41bd90c02059da4c7a9f98da9644b0a33a6d576a0686d3a2c6d90637e8` | `c6067d8` |

## Changes made in the kit after the import

The `0.3.0` shared planetary inspector and `planet-animal-definition-1` adapter
retain the existing loaded genome, body arrays and exact solved local bone
transforms. The standalone planetary Lab is new UI over that core, not another
animal generator. World/date interpretation and authored reference assets stay
in Atlas; caller material/geometry hooks allow presentation updates separately.
The canonical data versions and extraction corpus are unchanged.

| Path | Change | Why |
|---|---|---|
| `tests/creature-core-boundary.test.mjs` | Adds the test "every src/** module imports only other src/** modules and three". The 12-module core test and the export-name snapshot are unchanged. | The kit's package boundary (plan phase 2). |
| `tests/fauna-coat-fields.test.mjs` | Drops the `sampleFaunaCoat` import and the "legacy planet coat is symmetric" half of the asymmetry test. | That half tests Atlas's lineage-B planet renderer (`src/fauna-appearance.ts`), which is not part of the kit. Atlas keeps the full test. |

Every file under `src/`, `scripts/export-creature.mjs` and every fixture was byte-identical to Atlas at import.
Since export v3 (kit/export-3) the kit is the source of truth: `src/fauna-composer-export.ts`, `scripts/export-creature.mjs`,
the brief template and `tests/fauna-composer-export.test.mjs` differ from Atlas until Atlas re-syncs with
`node scripts/sync-creature-kit.mjs --write --kit ../creature-kit`.
`tests/atlas-parity.test.mjs` (with `ATLAS_DIR` set) re-checks the sources and the produced bytes.

## Known Atlas-flavoured strings (renamed in export v3)

Up to export v2, `src/fauna-composer-export.ts` wrote `asset.generator = "universe-atlas <export version>"`, and
`scripts/export-creature.mjs` wrote `provider: "universe-atlas"`, `project: "universe-atlas"` and a purpose line
"exported headless from universe-atlas" into the sidecar and brief; the brief template's id was
`atlas-creature-export-quest-3`. They were part of the pinned GLB and sidecar bytes, so the byte-identical extraction
kept them. Export v3 (`fauna-composer-export-3`, branch `kit/export-3`, `docs/creature-export-v3.md`) renames them in one
versioned change, together with the no-grant licence metadata (owner decision A13): the generator, provider and project are
`creature-kit`, the template id is `creature-kit-export-quest-3`, and the sidecars, briefs and template say
`UNLICENSED`. Only the JSON chunk strings moved; every GLB BIN chunk that needs no skeleton reduction is byte-identical
to the import (ledger in `docs/creature-export-v3.md`). From this change on, `src/fauna-composer-export.ts`,
`scripts/export-creature.mjs`, `assets/briefs/creature-export-quest-3.json` and `tests/fauna-composer-export.test.mjs` differ from
universe-atlas `ab6042c`.
