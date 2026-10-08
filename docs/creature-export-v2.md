# Creature export v2: LOD chain, Quest 3 budget, seamless loops

Task T4, branch `fauna/export-v2`, based on main `5450d9d`. Decided by Fable 5.1 on Kasper's instruction; implemented
and written by Claude Opus 5.5, as the commit trailers say. The 2026-10-07 follow-up (branch `fauna/ocellus-seam`:
decision D4, Opus-decided on Kasper's instruction, overrulable) was also implemented by Claude Opus 5.5.
v1 is described in `docs/creature-export-v1.md`; this document covers only what v2 adds.

## Hand-off header

- **Verdict:** DONE, experimental. All seven acceptance gates (a) to (g) pass, and no stop condition was hit.
  Generated creatures stay experimental: nothing in this branch signs off topology, deformation or how they look in a headset.
- **Commits:**
  - main base: `5450d9d`;
  - code commit: `880ea62`. The evidence below was exported at this commit;
  - composer core: unchanged from main. The 12 core sources hash to `e49fc2ec469c…` on both.
- **Exit codes:**

  | Command | Exit code |
  |---|---|
  | `node --test tests/fauna-composer-lod.test.mjs`, through the shared slot | 0 (6/6) |
  | `node --test tests/fauna-composer-export.test.mjs`, through the shared slot | 0 (14/14) |
  | `node --test tests/creature-core-boundary.test.mjs` (file unchanged from main) | 0 (3/3) |
  | `npx tsc --noEmit` | 0 |
  | `npm run test:affected -- --base main` | 0 (5 files selected, 51/51) |
  | `export-creature.mjs --preset all --count 4 --seed-prefix ce1 --target quest-3 --seamless`, twice | 0 and 0 |
  | the same 16 species with no v2 flag | 0 |
  | `assetctl validate` on all 16 v2 GLBs | 0 for every one |
  | `assetctl contract validate asset-brief` on the template and the 16 generated briefs | 0 for every one |

- **NOT run:**
  - the Luna viewer sheets, and any other render or browser review of the LOD levels;
  - an in-headset check on Quest 3;
  - `test:full`;
  - `assetctl package`;
  - the cross-engine golden runs. No golden or terrain file was touched.
- **needs:** (outside this task's files)
  - DONE (`1ce6005`): `needs: package.json` "test": register `tests/fauna-composer-lod.test.mjs`. It was UNREGISTERED: test:affected picked it up, but `npm test` does not run it. `tests/fauna-composer-export.test.mjs` is already registered.
  - `needs: tests/tiers.json`: put `tests/fauna-composer-lod.test.mjs` in the same tier as `fauna-composer-export.test.mjs`. It takes about 14 s.
  - DONE 2026-10-07 (`fauna/ocellus-seam`): `regenerate after the composer-stability merge (T2)`; see "Triangle counts" below. When `fauna-composer-mesh.ts`, `fauna-composer-rig.ts` or `fauna-composer.ts` change, three things change with them:
    - the v1 byte pins in `tests/fauna-composer-export.test.mjs` (`V1_PINS`) stop applying. The test then logs a "composer core moved" diagnostic and skips them. Re-pin them, keyed by the new core hash;
    - the triangle table below and the evidence directory must be regenerated;
    - the reducer itself does not need to change.
  - DECIDED (D4, 2026-10-07): the Quest 3 bone budget stays 80, as a CPU budget we set, not a Quest 3 limit; see "Why 80 joints" below.
  - `needs: owner decision`: the creature-kit licence. It stays `NOASSERTION`.

## What v2 adds

Every v2 feature is opt-in. With none of the v2 options, `exportCreatureGlb` is `fauna-composer-export-1`:

- the GLB is the same byte for byte;
- the report has the same shape;
- the brief is the same file.

v2 is switched on by any of these options: `target`, `lods` (an array), `seamless: true`, `budget` or `seamlessBlend`. `lods: false` alone still counts as v1.

| Option / CLI flag | Effect |
|---|---|
| `target` / `--target desktop-web\|quest-3` | Picks a profile: an LOD chain plus a hard budget. `desktop-web` has no chain, and its budget is the composer's own (80 000 triangles, 160 joints). `quest-3` builds the LOD chain `[8000, 3000, 1000]` under the budget below. |
| `lods` / `--lods full,3000,1000\|none` | Overrides the chain. The targets must strictly decrease, and `'full'` may only come first: it means "the unreduced skin as level 0". |
| `budget` / a brief's `constraints` | Can only **tighten** the profile, through a per-field `min`. A brief that asks for 1 000 000 triangles still gets 8000. |
| `seamless` / `--seamless`, `seamlessBlend` / `--seamless-blend` | Bakes idle and display as crossfaded loops. The default blend is 1 s, capped at half the window. |
| `--brief <asset-brief.json>` | Reads `target.devices`, `constraints.geometry` (`maxTriangles`, `maxMaterials`, `lodCount`) and `constraints.textures.maxDimension`. `assets/briefs/creature-export-quest-3.json` is the template, and it validates against `asset-brief/v1`. |

The output is written as `fauna-composer-export-2`, with `versions.export` and `versions.lod = fauna-composer-lod-1` in the asset extras. The sidecar is `creature-export-sidecar-2`. On top of v1 it adds:

- `status: experimental…`;
- `target`;
- `budget`, with the limits, the actual numbers and pass;
- one `lods` row per level: target, triangles, vertices, node, mesh, screen coverage, relaxation, mirrorKept, maxWeightChange, maxPlaneError and parts;
- `lodPlayback` and `seamlessPlayback` notes.

In a v2 export with an LOD chain, the report's and sidecar's `mesh` block (`vertices`, `triangles`, `parts`,
`restBounds`) describes **level 0**, the reduced mesh the scene draws up close, not the unreduced creature. Level-0
vertices are a subset of the skin's, so `restBounds` can only be slightly smaller than the creature's true rest box.

Its `generator.sources` list also includes `src/fauna-composer-lod.ts`. The per-creature brief records:

- the measured limits and `lodCount`;
- an `lod` deliverable (`glb-msft-lod`);
- the runtime line "experimental until an in-headset check on Quest 3 passes".

## The hard budget (fails the export, machine-readable)

`checkComposerExportBudget` runs **before** anything is written. The checks are:

- level-0 triangles;
- every level against its own target;
- joints;
- materials (always 1);
- texture bytes (always 0, because the skin is vertex-coloured);
- draw calls per level (1, because there is one primitive per level).

If any check fails, `exportCreatureGlb` throws `ComposerExportBudgetError`. Its `toJSON()` is:

```json
{"error": "composer-export-budget", "target": "quest-3", "budget": {...},
 "reasons": [{"code": "triangles", "level": 0, "limit": 8000, "actual": 28408}]}
```

The reason codes are `triangles | lod-target | bones | materials | texture-bytes | draw-calls`.

The CLI builds every selected creature first. If any of them fails the budget, the CLI:

- prints `{exporter, error: "composer-export-budget", out, written: 0, failures: [...]}` on stdout;
- exits with code **3** (`CREATURE_EXPORT_BUDGET_EXIT`);
- writes nothing, not even the output directory. The test checks this.

Here is an example with the trunked centipede, whose unreduced skin has 28 408 triangles, exported to quest-3 with `--lods full,3000,1000`. It gave `exit 3` with reason `triangles 28408 > 8000`, and nothing was written.

### Budget ledger (`quest-3`)

| Limit | Value | Source / rationale |
|---|---|---|
| level-0 triangles | 8000 | One creature among many. The Quest 3 standalone scene budget is ≤150k triangles a frame and ≤150 draw calls per eye (memory `feedback_quest3_perf_budgets`, docs/webxr cookbook). 8000 lets a dozen animals take under two thirds of that budget at full detail, and the far levels cut it further. |
| LOD targets | 8000 / 3000 / 1000 | Each step is about 2.7× to 3×. 1000 triangles still keeps the limbs and head as separate shapes on every preset (deviation figures below). |
| joints | 80 | **A CPU budget we set, not a Quest 3 limit** (decision D4, 2026-10-07, Opus-decided on Kasper's instruction, overrulable). See "Why 80 joints" below. The highest count over the 16 evidence species is 79 (centipede), so every one of them passes. A longer myriapod fails with a `bones` reason instead of exporting silently. |
| materials | 1 | The composer skin is a single vertex-coloured material. |
| texture bytes | 4 MiB | There are no textures today (0 bytes). The limit is there so that a future textured export cannot exceed the 256 MB Quest texture budget by accident. |
| draw calls per level | 1 | One primitive per level. |

Nothing in v1 was loosened. The desktop profile uses the existing composer budget unchanged.

### Why 80 joints

**There is no hardware cap involved.**

- three.js r181, as installed, skins every mesh through a float bone texture (`skinning_pars_vertex` uses
  `texelFetch(boneTexture)`). There is no uniform-array path, so `MAX_VERTEX_UNIFORM_VECTORS` does not apply. The old
  uniform fallback (about 59 bones at 256 vectors) only mattered for WebGL1-era engines, not the WebGL2 Quest Browser.
- `JOINTS_0` is written as unsigned 16-bit, so there is no 256-joint ceiling either.

**The real cost is CPU.** A small benchmark covered the animation mixer with 2 tracks per bone, the world-matrix update
and the skeleton update:

- measured on the desktop: **0.17 µs per bone per frame**, flat across 40, 80 and 160 bones;
- estimated for Quest 3: **about 1 µs per bone**. This assumes the headset CPU is roughly 5× slower than the desktop;
  the multiplier is an **estimate, not a measurement**;
- the 8000-triangle level 0 already implies a scene of about 18 creatures (150k ÷ 8000). At 80 bones those 18 cost about
  **1.4 ms**, roughly 13 % of an 11.1 ms frame. At 160 bones they would cost about 2.9 ms. So 80 is consistent with the
  scene the triangle budget already assumes.

**Raising it later.** Briefs can only tighten budgets, so going up means a code change plus an entry here. Do that only
if a headset measurement comes in at 0.5 µs per bone or less (then 160 is fine). If a bone sweep shows random seeds
failing often, the fix is a bone-reducing LOD skeleton, not a higher cap.

**Bone sweep (report only, `tests/fauna-composer-export.test.mjs` "bone sweep").** Joint counts of the composer graph as
the exporter builds it, seeds `bone-sweep-0` .. `bone-sweep-99`. The limit is not asserted and was not changed.

| Population | Joints | Histogram (joints: seeds) | Over 80 |
|---|---|---|---:|
| coherent species (the CLI's `--seed` / `--count` path) | 15 .. 72 | 10-19: 3, 20-29: 66, 30-39: 20, 50-59: 1, 60-69: 7, 70-79: 3 | 0 of 100 |
| raw random recipes (`randomComposerRecipe`) | 15 .. 126 | 10-19: 2, 20-29: 31, 30-39: 42, 40-49: 8, 50-59: 3, 70-79: 3, 80-89: 3, 90-99: 3, 100-109: 3, 110-119: 1, 120-129: 1 | 11 of 100 |

Coherent species, which is what the export CLI draws, never exceed 80. Raw random recipes do in 11 of 100: all 11 are
`many-legged` layouts with 8 to 12 leg pairs (82 to 126 joints), and they fail the quest-3 export with a `bones` reason. Whether 11 % counts as "often" is
an owner call; per D4 the answer would be a bone-reducing LOD skeleton, not a higher limit.

**Superseded in export v3** (`docs/creature-export-v3.md`): the reduced skeleton `fauna-composer-skeleton-1` now brings
all 11 to at most 80 joints under quest-3 within a pre-registered 2 % skin-error bound, and the sweep is an assertion
(0 of 100 over the limit with the rule, the same 11 without it). The limit itself is unchanged.

## LOD chain (`src/fauna-composer-lod.ts`, `fauna-composer-lod-1`)

The module is pure: it has no imports and no Node, three or Atlas API. No core module imports it, and both of those facts are tested.

- **Half-edge collapse with Garland-Heckbert quadrics.** The surviving vertex keeps its own position, so **every output vertex is an original skin vertex, unchanged**. Its position, runtime normal, colour, gloss and four joints and weights are copied bit for bit. Weights are never re-blended.
  - A removed vertex is **re-bound to the surviving vertex it collapsed into**, its `representative`. Each output vertex records its `sourceVertex`.
  - The skin has no UVs today. If it ever gets them, the same copy rule applies.
- **The seams cannot crack.** Positions are welded by exact float value before collapsing. A seam, meaning two skin vertices at one position with different attributes, therefore moves as one position. Each output corner takes the attribute vertex of its welded position that is nearest in attributes.
- **The cost** is the quadric error at the surviving position plus an attribute term. The attribute term is the L1 distance in colour, gloss and skin weight, scaled by the collapsed area and the body diagonal. The defaults are colour 0.02, gloss 0.05 and skin 0.08. As a result, eyes, colour borders and joints between bone regions collapse last.
- **A collapse is only valid if it keeps the mesh sound:**
  - the link condition holds, so the mesh stays manifold, and no new non-manifold edges appear (tested);
  - no triangle turns by more than about 72° (cosine 0.3) or becomes degenerate;
  - an open border only collapses along itself;
  - vertices on non-manifold input edges are locked;
  - a tetrahedron is never flattened.
- **Sagittal symmetry (z = 0).**
  - A vertex on the plane only collapses onto the plane.
  - A vertex with an exact mirror partner collapses together with that partner, onto the mirrored target.
  - An edge never crosses the plane.
  - If the heap runs dry above a target, the reducer relaxes in stages and records the stage in `relaxation`: stage 1 allows face turns up to 90°, and stage 2 allows unpaired collapses.
  - Only the 1000-triangle level of the long or limbless presets reaches stage 2.
- **Determinism.**
  - The heap is ordered by (cost, vertex id) and the queue entries are versioned, with no transcendental functions; only + − × ÷ and sqrt are used. One collapse sequence produces all the levels, so the levels are nested.
  - Tests: two runs give the same chain hash for 3 coherent seeds and 4 presets; the levels form a prefix property; and a second v2 GLB export is byte-identical for 3 seeds.
- **Output.**
  - Each level keeps its triangles in source order and recomputes the part ranges, which stay contiguous.
  - The vertices are compacted in ascending source order.
- **Reducer time:** about 100 to 460 ms per species for the whole chain.

### Skinning and deformation

The skinning test is `tests/fauna-composer-lod.test.mjs`. It runs on the bird, the centipede and coherent export-test-1, at walk t = 0.31 and display t = 1.7. Deviation is the distance from each source vertex to the reduced surface, sampled at every fifth vertex (`stride: 5`) and given as a percentage of the body diagonal:

| Level | Rest max | Note |
|---|---:|---|
| 0 (8000) | ≤ 0.94 % | over all presets |
| 1 (3000) | ≤ 1.74 % | Centipede is the exception at 6.59 %, with a p95 of 0.45 %: thin legs lose their tips. |
| 2 (1000) | ≤ 8.82 % | The highest is the rhinoceros. This is a far level by design. |

Posing barely changes these numbers:

- **Posed vs rest:** the posed deviation exceeds the rest deviation by at most about 0.7 % of the diagonal (winged-ape-rhino, level 2).
- **Test gates** (levels 0 and 1 only):
  - posed max minus rest max ≤ 1 % of the diagonal;
  - level 0 posed ≤ 1 % of the diagonal.
  - Level 2 is **deliberately ungated**. It is the far level (screen coverage 0.1 → 0), it may use relaxation stage 2,
    and it re-binds whole vertices to other bones: the centipede's level 2 reports `maxWeightChange` 2.0000000056, the
    full 0..2 range plus float-summation overshoot. Its numbers are reported in the sidecar, not asserted.

  Both pass. Bird level 0 measures 0.36 %, centipede level 0 0.28 % and export-test-1 level 0 0.09 %.
- **GLTFLoader + AnimationMixer:** every LOD level shares the 24 joint nodes of the bird. Played this way, the levels skin to the runtime's own vertices within **2.9e-8 m (walk)** and **8.5e-8 m (display)**. The comparison is against the runtime vertex each output vertex came from, over 3 levels and 5040 and 3780 vertex samples.

### glTF layout

- Level 0 is node 0, `composer-skin`, the only mesh node in the scene, so a loader without LOD support shows level 0. Levels 1 and 2 are nodes `composer-skin-lod1` and `composer-skin-lod2`, placed after the joints and outside the scene.
- Every level uses the same `skin: 0`.
- Node 0 carries `extensions.MSFT_lod.ids` and `extras.MSFT_screencoverage` = `[0.25, 0.1, 0]`.
- `extensionsUsed: ["MSFT_lod"]` is set, but **not** `extensionsRequired`.
- In three.js, fetch each level with `gltf.parser.getDependency('node', id)` and put the levels in a `THREE.LOD`. The levels share the bones, so one `AnimationMixer` drives all of them.
- `assetctl validate` / gltf-transform prints `Missing optional extension, "MSFT_lod"`. This is informational: the Khronos validator reports 0 errors and 0 warnings, and it lists the extension in `info.extensionsUsed`.
- assetctl's `drawCallCount` adds up all the meshes. One level at a time draws one call.

MSFT_lod was chosen over a sidecar block because the levels are then real skinned meshes inside the one GLB, with no second file to keep in sync. Any glTF loader still opens the file, and the extension is a published, registered glTF extension.

## Seamless idle and display (`bakeComposerLoopClip`)

This is opt-in, with `seamless: true`. The clip window, its duration and its key times are exactly v1's. What changes is which pose each key holds, where `b` is the blend length:

- Key `k` holds the source pose at `b + t_k`.
- Over the last `b` seconds the pose blends toward the source pose at `u = t − (D − b)`. That is the pre-roll that leads into `b`, so at `t = D` the pose is the source pose at `b`, which is key 0.
- The blend weight follows smoothstep; translation and scale are lerped, and rotation is normalised-lerped in the same hemisphere.
- The last key is written as a **copy of key 0**, so the loop closes bit for bit.
- The bake throws if the rotation would close in the opposite quaternion hemisphere. It also throws for a travelling motion: walk keeps its v1 gait-period window, and the bake rejects it.

The clip report gets `method: 'crossfade'`, seam 0, and `crossfade: {blendSeconds, sourceStart, rawSeamPosition, rawSeamAngle, rawSeamScale}`. The raw values record how far the uncrossfaded window missed. Walk and neutral are byte-identical to v1 under the flag, and the test checks this.

What the test checked on the bird:

| Check | Idle | Display |
|---|---|---|
| Window | 330 keys, 1 s blend | 265 keys, 1 s blend |
| Raw seam (v1 window) | 2.29 mm / 3.84° | 8.77 mm / 7.01° |
| Last key bytes = first key bytes (every channel) | yes | yes |
| Channel keys before the blend vs `poseComposer(b + t)` | 5800 keys, within 5.6e-8 | 4582 keys, within 5.9e-8 |
| Wrap step vs largest other step | 2.6e-3 vs 9.6e-3 | 1.9e-2 vs 3.1e-2 |

In the 16-species evidence the raw seams that the crossfade removes reach 105 mm / 27° (pachyderm idle) and 81 mm / 35° (winged-ape-rhino display). Without `--seamless`, LoopRepeat would visibly pop on those creatures.

## Evidence: 16 species, quest-3 `--seamless`

The evidence is in `test-results/round-2026-10-07/creature-export-v2/`. The test-results junction points to `D:/IWSDK-review/universe-atlas/test-results-20260913/`.

| Evidence | Files | Result |
|---|---|---|
| v1 baseline from unmodified main `5450d9d` | `v1-baseline/` (48 files), `v1-baseline-commit.txt` | — |
| v1 recheck at `880ea62`, no v2 flag | `v1-recheck/` | All 16 GLBs and all 16 briefs are byte-identical to the baseline. The 16 sidecars differ in one field only: `generator.sourceSha256` (`8b21dc66…` → `8c80028c…`). That field hashes `src/fauna-composer-export.ts`, which this branch changed, so it has to differ. |
| v2 exports | `v2-quest3-run-a/`, `v2-quest3-run-b/`, `*.sha256` | Two separate runs. **All 48 files are byte-identical** between them. |
| validation | `assetctl-validate/` | One JSON file per GLB, plus `exit-codes.txt`, `brief-validate.txt` and `lod-table.md`. |

Command: `node scripts/export-creature.mjs --out <dir> --preset all --count 4 --seed-prefix ce1 --target quest-3 --seamless`.

### Triangle counts per species and LOD level

First taken at main `5450d9d` and branch `880ea62`. **Regenerated 2026-10-07** after the composer-stability merge (T2)
and the midline-ocellus `seamNormal` package (D2), at `fauna/ocellus-seam` `e087695` (composer core `a0a31556…`), into
`test-results/round-2026-10-07/creature-export-v2/after-stability/`:

- two v2 runs (`v2-quest3-run-a/`, `v2-quest3-run-b/`, `*.sha256`): all 48 files byte-identical between them;
- every one of the 16 v2 GLBs is byte-identical to T4's `v2-quest3-run-a`, and every one of the 16 v1 GLBs (`v1/`,
  no v2 flag) is byte-identical to T4's `v1-baseline`. None of these species has the midline insect ocellus, and the
  proboscis-ear clamp changes no unperturbed build, so the table below did not change (`lod-table.md`, 16 rows equal).
  The sidecars differ from T4's only in `generator.sourceSha256`, which hashes the changed core sources;
- `assetctl validate` exit 0 on all 16 (`assetctl-validate/`, valid, 0 errors / 0 warnings, skinQuality clean), and
  all 16 briefs validate (`brief-validate.txt`).

| Creature | v1 full | LOD0 (≤8000) | LOD1 (≤3000) | LOD2 (≤1000) | Relaxation | mirrorKept | Joints | GLB bytes v1 → v2 | assetctl validate |
|---|---:|---:|---:|---:|---|---|---:|---:|---|
| ape-c5202062 | 12224 | 8000 | 2998 | 1000 | 0/0/0 | 0.999/0.997/0.990 | 20 | 896320 → 905012 | exit 0, valid, 0 err / 0 warn |
| bird-3f0f5b1c | 11900 | 7998 | 3000 | 998 | 0/0/0 | 0.999/0.992/0.984 | 24 | 1007708 → 1027136 | exit 0, valid, 0 err / 0 warn |
| centipede-f9363239 | 17636 | 8000 | 3000 | 1000 | 0/0/2 | 1.000/1.000/0.907 | 79 | 1721324 → 1532872 | exit 0, valid, 0 err / 0 warn |
| cursorial-carnivore-ce1-2-8b76e520 | 17244 | 8000 | 3000 | 1000 | 0/0/0 | 0.995/0.991/0.978 | 29 | 1212124 → 1029016 | exit 0, valid, 0 err / 0 warn |
| dinosaur-60311ed9 | 16032 | 8000 | 3000 | 1000 | 0/0/0 | 0.999/0.996/0.972 | 31 | 1061820 → 924124 | exit 0, valid, 0 err / 0 warn |
| giraffe-e07a368b | 15468 | 8000 | 3000 | 1000 | 0/0/0 | 0.993/0.990/0.967 | 32 | 1198156 → 1075360 | exit 0, valid, 0 err / 0 warn |
| ostrich-3a9b1fb2 | 13364 | 8000 | 2998 | 998 | 0/0/0 | 0.993/0.994/0.969 | 27 | 1179640 → 1141304 | exit 0, valid, 0 err / 0 warn |
| pachyderm-ce1-3-45a774bc | 14844 | 7998 | 3000 | 1000 | 0/0/0 | 0.998/0.990/0.922 | 30 | 1031288 → 937600 | exit 0, valid, 0 err / 0 warn |
| rhinoceros-a1d997bf | 17684 | 8000 | 2998 | 1000 | 0/0/1 | 0.999/0.994/0.969 | 24 | 1144364 → 952692 | exit 0, valid, 0 err / 0 warn |
| shelled-giraffe-bird-ee124f7e | 11896 | 8000 | 2998 | 1000 | 0/0/0 | 0.995/0.986/0.987 | 26 | 1098440 → 1110912 | exit 0, valid, 0 err / 0 warn |
| theropod-ce1-0-1f4926df | 19548 | 7998 | 3000 | 1000 | 0/0/2 | 0.997/0.993/0.968 | 30 | 1352516 → 1090120 | exit 0, valid, 0 err / 0 warn |
| trunked-centipede-36926306 | 28408 | 8000 | 2998 | 1000 | 0/0/2 | 0.998/0.992/0.893 | 63 | 2459972 → 1864632 | exit 0, valid, 0 err / 0 warn |
| turtle-6a3afe66 | 12288 | 8000 | 2998 | 998 | 0/0/0 | 0.998/0.998/0.984 | 21 | 948580 → 948192 | exit 0, valid, 0 err / 0 warn |
| ungulate-grazer-ce1-1-51ad6b85 | 13600 | 7998 | 2998 | 1000 | 0/0/0 | 0.998/0.997/0.979 | 29 | 1080292 → 1028080 | exit 0, valid, 0 err / 0 warn |
| winged-ape-rhino-cf702ed1 | 22288 | 8000 | 3000 | 1000 | 0/0/2 | 0.997/0.997/0.957 | 40 | 1488260 → 1121980 | exit 0, valid, 0 err / 0 warn |
| worm-a8de320f | 6616 | 6616 | 3000 | 999 | 0/0/2 | 1.000/1.000/0.857 | 15 | 619412 → 776576 | exit 0, valid, 0 err / 0 warn |

Reading the table:

- **Worm.** The worm's skin is already under 8000 triangles, so its level 0 is the unreduced source.
- **Skin quality.** For all 16 species, assetctl `skinQuality` reports 0 unweighted vertices, 0 vertices with more than four influences and 0 non-normalised vertices.
- **Briefs.** All 16 generated v2 briefs validate against `asset-brief/v1`.
- **mirrorKept.** This is the share of surviving off-plane vertices whose exact mirror partner also survives.
- **Relaxation.** These are the stages used per level: 0 = strict, and 2 = some unpaired collapses at the 1000-triangle level.

## Open risks

1. **No visual review was done.** No Luna sheet and no headset check covers the LOD levels. Level 2 can lose up to 8.8 % of the body diagonal (rhinoceros), and the centipede's level 1 shortens leg tips by 6.6 %. Both fall within the 0.1 and 0.25 screen-coverage switch hints, but a person has not looked at them.
2. **The 80-joint limit is a CPU budget we set** (see "Why 80 joints"). The Quest 3 per-bone cost is an estimate, not a
   headset measurement. The centipede at 79 passes by one joint, and 11 of 100 raw random recipes exceed 80 (coherent
   species: 0 of 100). Export v3 reduces those 11 to at most 80 joints (`docs/creature-export-v3.md`); the per-bone
   headset cost is still an estimate.
3. **The display crossfade is a blend, not `poseComposer`.** Inside the last second, the clip is a blend between two source poses. On the creatures with large raw seams, a smoothstep blend over 1 s could look like a slow drift. `--seamless-blend` can lengthen the blend, up to half the window.
4. **The evidence goes stale when the composer core moves.** When a core source changes, the v1 pins skip (with a
   "composer core moved" diagnostic) and do not fail, and this table must be regenerated. Done 2026-10-07 for T2 and
   the ocellus package: core re-keyed to `a0a31556…`, all five v1 shas and the whole table unchanged.
5. **Some tools hide the extension.** gltf-transform-based tools (`assetctl validate`/`inspect`) report `extensions.used: []` because MSFT_lod is not registered with them, and a gltf-transform rewrite would drop it (not tested here; `assetctl package` was not run). Only the exporter's GLB keeps it. Do not run a gltf-transform optimisation pass over a v2 GLB without a step that adds the extension back.
6. **Licence.** The licence is `NOASSERTION` in the template, the sidecars and the briefs. There is no Creature Lab Export button.
   Export v3 sets it to `UNLICENSED` (private, owner decision A13) and runs `assetctl package` on its evidence.
