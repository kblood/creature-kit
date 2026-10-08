# Creature export v3: private licence, creature-kit strings, bone-reducing skeleton

Task R2-KIT-EXPORT-3, branch `kit/export-3`, based on creature-kit main `3e0d6e8`. Decided by Opus on Kasper's
instruction, overrulable (owner decision A13 for the licence; decision D4 for the 80-joint budget). Implemented and
written by Claude Opus 5.5, as the commit trailers say. v1 and v2 are described in `docs/creature-export-v1.md` and
`docs/creature-export-v2.md`; this document covers only what v3 changes.

## Pre-registration

This section was committed on its own, **before** any skin error of a reduced skeleton was measured. Nothing in it is
changed afterwards; results go in the sections below it. What had been looked at before writing it: the joint counts
and part lists of the 11 raw recipes that exceed 80 joints (structure only), the baseline exports at `3e0d6e8` (pins,
the 16 evidence species, the 11 raw recipes failing with exit 3), and the baseline quest-3 budget outcome of all 100
raw recipes (89 pass; the 11 fail on `bones`, one of them, `bone-sweep-70`, also on `lod-target` level 2: 1116 > 1000).

### 1. One version bump

- Every export is written as **`fauna-composer-export-3`** (`COMPOSER_EXPORT_V3_VERSION`), with or without the v2
  options. `asset.generator` becomes **`creature-kit fauna-composer-export-3`**.
- The sidecar schema becomes **`creature-export-sidecar-3`** for every export. A plain export (no v2 option) carries
  the sidecar-1 fields, a profiled export (any v2 option) the sidecar-2 fields plus a `skeleton` block.
- The old constants stay exported, unchanged, for compatibility: `COMPOSER_EXPORT_VERSION` (`-1`),
  `COMPOSER_EXPORT_V2_VERSION` (`-2`), `CREATURE_EXPORT_SIDECAR_SCHEMA` (`-1`), `CREATURE_EXPORT_SIDECAR_SCHEMA_V2` (`-2`).
- The LOD reducer is not changed (`fauna-composer-lod-1`); the composer core (the 12 modules) is not changed.
- New: the reduction rule below is versioned as **`fauna-composer-skeleton-1`**.

### 2. Which bytes may change

Compared with the same export (same recipe, same options) at `3e0d6e8`:

| Output | May change | Must not change |
|---|---|---|
| GLB, any export that needs no skeleton reduction (every plain export, every desktop-web export, every quest-3 export of a graph with at most 80 joints) | JSON chunk: the string values `asset.generator` and `asset.extras.composer.versions.export`, and as a consequence the JSON chunk length, its space padding and the header's total length | the **BIN chunk, byte for byte**; every other JSON key and value; key order |
| GLB, a reduced export | everything that follows from fewer joints: joint nodes, `skins[0].joints`, inverse bind matrices, animation channels, `JOINTS_0` / `WEIGHTS_0`; plus `asset.extras.composer.versions.skeleton` and `asset.extras.composer.skeleton` | positions, normals, colours, gloss, indices and LOD levels: the LOD chain is built from the unreduced skin exactly as before, only joints and weights are remapped |
| Sidecar | `schema`; `provenance.license`; `provenance.generator.provider` and `.version`; `provenance.notes`; `versions.export`; `generator.sourceSha256` (it hashes the changed exporter); `asset.bytes` and `asset.sha256` (they follow the GLB); new `skeleton` block (profiled exports only) | everything else |
| Per-creature brief | `purpose`; `target.project`; the manifest deliverable's `format`; `provenance` (the same object as the sidecar's); for a reduced export one extra `acceptance.technical` line | everything else (id, deliverables, constraints, the other acceptance lines) |
| Brief template | `id`, `purpose`, `target.project`, `artDirection.summary`, the manifest deliverable's `format`, the joints line in `acceptance.technical`, `provenance.generator.provider` and `.version`, `provenance.license`, `provenance.notes` | `target.devices`, `constraints` (so `briefExportOptions(template)` is unchanged) |

The strings: `provider: "creature-kit"`, `project: "creature-kit"`, purpose "... exported headless from creature-kit ...",
`provenance.license = {expression: "UNLICENSED", attribution: null, restrictions: ["private, all rights reserved
(owner decision A13, 2026-10-07)"]}`. The licence is the owner's decision A13 ("the same as the rest": private,
`UNLICENSED`), the same licence `package.json` and `PROVENANCE.md` already declare.

`V1_PINS` in `tests/fauna-composer-export.test.mjs` are re-pinned with an old -> new ledger, and the test also pins the
BIN chunk sha256 of each specimen, taken from the `3e0d6e8` export, so the test itself proves the BIN chunks did not move.

### 3. The reduction rule (`fauna-composer-skeleton-1`)

The composer exports a **flat** joint list: every joint is a child of the skeleton root and carries its own
creature-space pose, sampled from `poseComposer`. Dropping a joint therefore never moves another joint, and a reduced
skeleton's clips are the full pose's channels of the surviving joints, unchanged.

- **When.** Only in a profiled export whose resolved `budget.maxBones` is below the graph's joint count. With the
  shipped profiles that is quest-3 (80) and nothing else: desktop-web's budget is the composer's own cap (160), which
  no graph exceeds. A brief can still only tighten the budget. Option `reduceSkeleton: false` (CLI
  `--no-reduce-skeleton`) disables the rule; the export then fails with a `bones` reason as at `3e0d6e8`.
- **Units, in this fixed order.** Each unit removes a fixed set of joints. Units are applied in order until the joint
  count is at most `maxBones`, and no further:
  1. **feet**, one leg pair at a time, by `limb.pair` ascending (pair 0 is the rearmost pair of a many-legged body, the
     hind pair of a quadruped): both sides' `foot` joints collapse into their parent (the `lower` or `meta` segment);
  2. **metapodials** (three-segment legs only), one pair at a time, by `limb.pair` ascending: both `meta` joints
     collapse into `lower`;
  3. **tail**, merged in pairs: the odd tail joints counted from the base (`tail_1`, `tail_3`, ...), tip-most first,
     each into the tail joint before it;
  4. **torso**, merged in pairs: the odd torso joints (`torso_1`, `torso_3`, ...), rearmost first, each into the torso
     joint before it (`torso_0`, the root, is never removed);
  5. **neck**, merged in pairs: the odd neck joints (`neck_1`, `neck_3`, ...), base first, each into the neck joint
     before it.

  The knee is never removed: `upper` and `lower` of every leg, the head, arms, wings and trunk always survive.
- **If the units run out** above `maxBones`, nothing is reduced and the export fails with the `bones` reason and the
  full joint count, as before.
- **Weights.** Every joint maps to its nearest surviving ancestor (itself when it survives). Each vertex row's joints
  are mapped, duplicate joints merged by adding their weights, and the row renormalised by the exporter's existing glTF
  row repair. A row never gains influences, so it stays at four or fewer.
- **Clips.** Baked from the full pose exactly as before (`poseComposer`, `bakeComposerClip` / `bakeComposerLoopClip`);
  the reduced GLB keeps the surviving joints' channels and drops the others.
- **Recorded.** The report and the sidecar's `skeleton` block carry the full and the reduced joint counts, the rule
  version, the collapsed joints (`[joint, into]` by name), the stage reached, the skin error (below) and
  `mappingSha256`, the sha256 of the canonical JSON `[[jointName, survivorName], ...]` over all full joints in graph
  order. A reduced GLB carries the version, the counts and the collapsed list in `asset.extras.composer.skeleton`.

### 4. The skin-error bound, stated before measuring

**Metric.** For a reduced export: the largest distance between a level-0 vertex skinned by the full skeleton (its
glTF-repaired weight rows over all graph joints) and the same vertex skinned by the reduced skeleton (the remapped
rows), over every level-0 vertex and every key of every baked clip, as a fraction of the **body diagonal**: the
diagonal of the rest bounding box of the unreduced composer skin. Joint matrices are built in float64 from the float32
channel values the GLB stores, times each joint's rest inverse bind matrix. Lower LOD levels need no separate check:
their vertices are a subset of level 0's (one collapse sequence), with the same weights.

**Bound: at most 2 % of the body diagonal (`COMPOSER_SKELETON_SKIN_ERROR_BOUND = 0.02`).**

Why 2 %:

- the v2 LOD chain gates level 0 at 1 % of the diagonal posed (geometry), and ships level 1 at up to 1.74 % at rest on
  the legged presets. A rigid foot is the same kind of error (an extremity keeps a slightly wrong shape for part of
  a stride, the surface does not tear), so allowing it twice the level-0 geometric gate keeps the combined level-0
  error of the order the v2 chain already accepts one level further out;
- it is a worst-case metric: the maximum over every vertex and every key, not a percentile, and the reduction only ever
  applies to quest-3, where the creature is one of many at a distance.

A-priori estimate (not a measurement): a collapsed foot follows its lower leg rigidly, so its toe is off by about foot
length x the change of the ankle angle against rest. Arthropod and claw feet are 0.24 reach long and the many-legged
stride turns the lower leg by roughly 0.3 to 0.5 rad, so long-clawed many-legged recipes may sit close to, or above, the
bound. That is accepted as a risk, not a reason to pick a looser number.

**Enforced.** The exporter computes the metric for every reduced export and fails it with a new budget reason
`skin-error` (`limit` 0.02, `actual` the measured fraction) when it is exceeded; nothing is written. The bound is never
loosened: a recipe that fails it is reported, not accepted.

### 5. Acceptance and stop conditions (from the brief)

- Typecheck 0; `npm test` green; `composer-identity` skin digests unchanged (no skin change in this task);
  `creature-core-boundary` green; none of the 12 core modules edited.
- BIN chunks byte-identical for every export that needs no reduction (the pins, the 16 evidence species).
- The bone sweep becomes an assertion: 0 of the 100 raw recipes `bone-sweep-0..99` over 80 joints under quest-3, each
  reduced one within the bound, and with the rule disabled the same 11 fail. Two runs byte-identical.
- Evidence: the 16 evidence species and the 11 formerly failing raw recipes exported under quest-3 into
  `C:/LLM/IWSDK/Assets/_assetctl/creature-kit/export-3/`, `assetctl validate` and `assetctl package --brief` on all of
  them, the 16 x 3 LOD table regenerated (equal to v2's apart from version strings).
- Stop: a core module edit is needed; the schema rejects `UNLICENSED`; an in-budget BIN chunk changes; a reduced recipe
  cannot meet the bound (reported, never loosened); anything outside the task's files.
- Known before starting, outside this rule: `bone-sweep-70` also fails quest-3 on `lod-target` level 2 (1116 > 1000)
  at `3e0d6e8`. That is an LOD reducer limit, not a joint one; this task does not change the reducer, so it is
  reported, not fixed.

## Results (measured after the pre-registration; nothing above was changed)

Code at `kit/export-3` `d957a21` (steps 1 to 4); the evidence was exported from that commit. Evidence directory:
`C:/LLM/IWSDK/Assets/_assetctl/creature-kit/export-3/`. `baseline-3e0d6e8/` holds the same exports from unmodified
creature-kit main `3e0d6e8`, and `v3-d957a21/` holds the v3 exports, comparisons and assetctl output (`compare.json`,
`lod-table.md`, `lod-table-vs-v2.txt`, `raw11-table.md`, `raw100-quest3-budget*.json`, `assetctl/`, `exit-codes.txt`).

### Bytes: only the pre-registered strings moved

| Check | Result |
|---|---|
| 16 species, plain export (no v2 flag) vs `3e0d6e8`: BIN chunk | byte-identical, 16 of 16 |
| 16 species, quest-3 `--seamless` vs `3e0d6e8`: BIN chunk | byte-identical, 16 of 16 |
| JSON chunk, both sets, with `asset.generator` and `versions.export` mapped back to the `3e0d6e8` strings | identical text, 32 of 32 (GLB length moves by 0 or −4 bytes of chunk padding) |
| quest-3 run a vs run b | all 48 files byte-identical |
| sidecar fields that differ from `3e0d6e8` | `schema`, `versions.export`, `generator.sourceSha256`, `asset.sha256`, `asset.bytes` (where the padding moved), `provenance.generator.provider` / `.version`, `provenance.license.expression` / `.restrictions`, `provenance.notes`, and (quest-3 only) the new `skeleton` block: the pre-registered list, nothing else |
| brief fields that differ | `purpose`, `target.project`, the manifest deliverable's `format`, `provenance.generator.provider` / `.version`, `provenance.license.*`, `provenance.notes`: the pre-registered list, nothing else |
| 100 raw recipes, quest-3 budget rows of the 89 in-budget recipes | identical to `3e0d6e8` (bones, LOD triangles) |
| composer-identity report, branch vs main `3e0d6e8` | `skin4Links` and `eyeCatalogue` (every skin, gloss and count) identical; `sourceHash`, `v1Pins` and `cli` move with the exporter source and the two strings, so the top-level `digest` moves by design (main `c6354860…`, branch `6d6fbab0…`) |

`V1_PINS` ledger (also in `tests/fauna-composer-export.test.mjs`, which pins each BIN chunk sha and each `3e0d6e8` JSON
text):

| Specimen | GLB sha256 `3e0d6e8` → v3 | Bytes |
|---|---|---|
| bird | `bb87f35b228bab8a…` → `a9007575ad408f80…` | 1007708 → 1007704 |
| centipede | `709abe3ce33ccfaf…` → `b3981c9365265006…` | 1721324 |
| worm | `86fecc903ec8f19b…` → `1395baa897fbc8a8…` | 619412 → 619408 |
| winged-ape-rhino | `ae1784773193c049…` → `c26e0d16388e289f…` | 1488260 |
| coherent (`export-test-1`) | `01b43824c05d6733…` → `a91e920cab8c5607…` | 905608 |
| quest-3 bird (`--seamless`) | `7a590ed3f6c2ed5d…` → `d45acf82a921e081…` | unchanged BIN |

### Reduced skeletons: all 11 within the 2 % bound

| Seed | Asset key | Joints full → written | Stage | Collapsed | Skin error (% of diagonal) | Worst at | LODs | mappingSha256 |
|---|---|---:|---|---:|---:|---|---|---|
| bone-sweep-3 | recipe-b7f6404a | 105 → 80 | tail | 25 | 0.762 | walk key 12 | 7998/2998/1000 | a81d348ee51b5a3e… |
| bone-sweep-9 | recipe-cb1aa46e | 91 → 79 | feet | 12 | 0.269 | walk key 1 | 8000/2998/1000 | d4b06107903aa4b6… |
| bone-sweep-15 | recipe-c929a9bc | 94 → 80 | feet | 14 | 0.240 | walk key 2 | 7998/3000/1000 | 0e3e473c1bf7c7e5… |
| bone-sweep-20 | recipe-17b06523 | 126 → 80 | metapodials | 46 | 1.303 | walk key 0 | 7999/2999/999 | 4123de5d64e2e2e7… |
| bone-sweep-24 | recipe-9e3d87ac | 82 → 80 | feet | 2 | 0.164 | walk key 14 | 8000/2998/1000 | ec944696f6f303fe… |
| bone-sweep-28 | recipe-1a26c7be | 103 → 80 | tail | 23 | 0.753 | walk key 8 | 8000/2998/1000 | bf8a70fc862ac1aa… |
| bone-sweep-29 | recipe-bd36e13a | 91 → 79 | feet | 12 | 0.136 | walk key 1 | 7998/3000/1000 | a9142e6190c8072a… |
| bone-sweep-46 | recipe-5af31756 | 111 → 79 | metapodials | 32 | **1.786** | walk key 4 | 7999/2999/999 | 7a47a0ed4875afb0… |
| bone-sweep-53 | recipe-20f86cfa | 105 → 80 | tail | 25 | 0.613 | walk key 1 | 8000/3000/1000 | 62b1097b1961e279… |
| bone-sweep-70 | recipe-f863e004 | 89 → 79 | feet | 10 | 0.379 | walk key 5 | 8000/3000 (see below) | deed000f1ec46f85… |
| bone-sweep-81 | recipe-bd0a067b | 87 → 79 | feet | 8 | 1.055 | walk key 6 | 7998/3000/1000 | 1b41aabfa2a84d66… |

- The worst case is bone-sweep-46 at 1.786 %, so the margin to the bound is about 11 %. The worst key is always in `walk`.
- A three.js `GLTFLoader` + `AnimationMixer` playback of bone-sweep-46's reduced GLB against its full-skeleton
  desktop-web export (same LOD chain) gives a worst vertex distance of 0.02468 m, which equals the reported metric
  (test "GLTFLoader playback ...").
- With the rule off (`--no-reduce-skeleton`), all 11 exit 3 with a `bones` reason and write nothing
  (`v3-d957a21/raw11-noreduce-*.stdout.json`). The 100-recipe sweep without the rule gives the `3e0d6e8` outcome
  exactly (89 pass).

### 100 raw recipes under quest-3

- **Joint budget: 100 of 100** within 80 joints.
- **Full quest-3 export: 99 of 100.** `bone-sweep-70` still fails, as at `3e0d6e8`, on `lod-target` level 2
  (1116 > 1000). That is the LOD reducer, not the joint budget, and it was listed before measuring as out of this rule.
  With `--lods 8000,3000` it exports, reduced to 79 joints, within the bound (`raw70-quest3-lods-8000-3000/`).

### assetctl (run from `C:/LLM/IWSDK`)

| Command | Inputs | Result |
|---|---|---|
| `assetctl contract validate asset-brief` | the template and the 27 generated briefs | exit 0 for all 28 (`UNLICENSED` accepted by the schema) |
| `assetctl validate <glb>` | the 16 quest-3 species and the 11 reduced raw recipes | exit 0 for all 27: valid, 0 Khronos errors / 0 warnings, max 4 influences, skinQuality 0 unweighted / 0 over four / 0 non-normalised |
| `assetctl package <glb> --brief <brief>` | the same 27 | exit 0 for all 27; each `<glb>.asset.json` carries `license.expression: "UNLICENSED"` with the A13 restriction |

`assetctl validate` prints `Missing optional extension, "MSFT_lod"` on stderr (gltf-transform does not register it;
v2 open risk 5). The 16 × 3 LOD table (`v3-d957a21/lod-table.md`) equals the v2 table in every column except GLB bytes
(0 or −4, JSON chunk padding); `lod-table-vs-v2.txt` reports 0 mismatches over 16 rows.

### Open risks

1. **No visual or headset review** of a reduced skeleton. The metric is a worst-case vertex distance, but rigid feet and
   merged spine joints have not been looked at, and the per-bone headset CPU cost is still an estimate (v2).
2. **bone-sweep-70** needs a reducer change (or a shorter chain) to meet the default quest-3 chain; out of scope here.
3. The margin to the bound is 11 % on the worst of 11 recipes; longer many-legged recipes than the sweep's could exceed
   it. Such an export fails with `skin-error` instead of shipping; the bound is not to be loosened.
