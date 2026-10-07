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
