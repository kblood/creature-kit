# Creature export v1 (`fauna-composer-export-1`)

Date: 2026-10-04. Backlog task 10 (CREATURE-EXPORT), creature-kit plan phase 3 done inside Atlas.
Branch `round2/creature-export`. Author: Opus 5.5. No Sonnet agent could be started from this session, so Opus wrote this document too.

## What it is

Other games can now take a composer creature as a file. They need no code from Atlas.

- `src/fauna-composer-export.ts` turns a recipe into a binary glTF (`.glb`).
  - It builds the creature the same way the runtime does, through `createComposerCreature`. That function normalises the recipe, derives the individual, builds the graph and the skin, and computes normals with three's own code.
  - It then writes the GLB itself.
  - It does not use three's `GLTFExporter`, because that needs `FileReader` in Node.
  - It imports only the 12 composer-core modules and `three`. It uses no Node API, so it also runs in a browser (a future "Export" button in Creature Lab could call it).
- `scripts/export-creature.mjs` is the Node command line. For each species it writes three files:
  - the GLB;
  - a provenance sidecar;
  - an IWSDK asset brief.
- `tests/fauna-composer-export.test.mjs` holds the checks below.

## Command line

Run from the repo root:

```powershell
node scripts/export-creature.mjs --out <dir> --preset all
node scripts/export-creature.mjs --out <dir> --count 4 --seed-prefix ce1          # 4 coherent random species
node scripts/export-creature.mjs --out <dir> --seed herd-7 --archetype pachyderm
node scripts/export-creature.mjs --out <dir> --recipe "v4*layout_biped*..."       # a Creature Lab share link
# options: --motions walk,idle  --fps 60  --gloss attribute|drop  --forward +Z|+X
```

**File names.** Each species gets the key `<label>-<8-hex hash of the recipe text>`. The label is the preset id, `<archetype>-<seed>`, or `recipe`.

**Files written per species:**

| File | Contents |
|---|---|
| `<key>.glb` | the creature |
| `<key>.creature.json` | sidecar, schema `creature-export-sidecar-1`. It holds: the recipe text; the species key; the individual's deltas and its effective recipe; every subsystem version; `generator.sourceSha256`; axes; mesh; repairs; clips; a playback note; the provenance block. `generator.sourceSha256` is a sha256 over the 12 core sources plus the exporter, sorted by path, with LF line endings, so a CRLF checkout gives the same hash. |
| `<key>.brief.json` | an asset brief (`schemas/asset-brief/v1`). Its kind is `creature` and its device is `desktop-web` only (see the limits below). It carries the same provenance block, so `assetctl package --brief` records it. |

**Provenance block** (asset-provenance v1):
- `sourceType: generated`;
- generator `universe-atlas / fauna-composer`, with the graph, skin and exporter versions;
- `prompt` is the recipe text;
- `seed` is the species seed, or for presets and links the hash of the recipe;
- `sourceConsent: not-applicable` (procedural, no external inputs);
- licence `NOASSERTION`, until the owner answers the creature-kit licence question.

**No overwriting.** The CLI never overwrites a file. If the existing file has identical bytes, the run is a no-op. If the bytes differ, the run fails.

**No clock.** Nothing in the output depends on the clock.

## What the GLB contains

**Mesh:**
- One skinned mesh: one primitive, one material, one draw call.
- Material: vertex colour, roughness 0.82, metalness 0, the same as the runtime.
- Attributes:
  - `POSITION`, `NORMAL`, `COLOR_0` (linear), `JOINTS_0`, `WEIGHTS_0` (4 influences);
  - `_COMPOSER_GLOSS`, the eye gloss channel. It is an application attribute; three's loader exposes it as `_composer_gloss`. `--gloss drop` leaves it out.
- `meshes[0].extras.composer.parts` lists the triangle range of each anatomical part.

**Skeleton:**
- One joint node per graph bone, in graph order, with the graph's bone names.
- All joints are children of the skeleton root `composer-creature`. This is the composer's flat bone list: every bone carries its creature-space pose.
- The inverse bind matrices are the inverses of each bone's rest translation and rotation.
- The skeleton root rotates −90° about +Y. That turns the composer's +X heading onto +Z, the glTF asset front. `--forward +X` keeps the composer frame.
- The skinned-mesh node is a scene root with no transform.

**Axes:** metres, +Y up, right-handed.

**Clips:**
- One animation per motion: `neutral`, `idle`, `walk`, `display`.
- Each joint has a translation channel and a rotation channel.
- A scale channel is added only on bones whose scale actually changes: breathing, peristalsis and wing chord furl.
- Keys are evenly spaced, 30 per second by default, and include both ends of the window.
- Rotation keys are kept in one hemisphere, so slerp never takes the long way round.

**How each clip window is chosen.** The window is measured from `poseComposer`, never read from its constants:

| Clip | Rule |
|---|---|
| static motion | two identical keys one second apart. `neutral` is static for every preset. |
| `walk` | first, the shortest whole number of gait periods whose end pose equals the start pose (within 0.5 mm, 0.25° and 1e-3 of scale). All 15 legged exports loop after one period. If no whole period closes (a crawl's travelling wave), the walk falls back to the seam search below, starting at 0.5 s. A slim-torso worm then closes at about 3.035 s. The default worm's peristaltic crawl does not close within 12 s: it keeps its best window (1.43 s, seam 10.4 mm / 3.8°) and is marked `seamless: false`. |
| `idle`, `display` | a seam search over 4–12 s: a 1/fps grid, then two finer passes (1/20 and 1/400 of a frame) around the three best grid minima. The shortest seamless window wins; otherwise the one with the smallest seam. Their sinusoids have incommensurate periods, so in practice they never loop exactly. `clip-windows.txt` lists every measured seam; the worst bone, for example a tail tip, ends 2–92 mm and 3–34° away from where it started. |

**Seams are reported.** Each clip's seam goes into the sidecar and into `animations[i].extras.composer` as `seamless`, `seamPosition`, `seamAngle` and `seamScale`.
- Play `seamless` clips with `LoopRepeat`.
- Play the others with `LoopPingPong`, or crossfade them.

**Walk is a treadmill.** The animal stays centred in the clip. Move it along the forward axis at `extras.composer.travelSpeed` (m/s).

**glTF repairs.** glTF requires each weight row to sum to 1 in float32, and each joint to appear at most once. The writer merges duplicate joints, points unused slots at joint 0, and renormalises.
- Measured weight change: at most 6e-8, which is float rounding.
- Zero-length normals patched: 0 for every export so far.

## Checks (`tests/fauna-composer-export.test.mjs`)

The test is **not registered in `npm test`**; the merger registers it. It runs in about 1.7 s. Specimens: the bird, centipede, worm and winged-ape-rhino presets, plus one coherent species. It checks:

1. **Structure.**
   - The GLB header and chunks are valid; every buffer view is 4-byte aligned and lies inside the BIN chunk.
   - One mesh, one primitive, one skin.
   - The joints are the graph bones: same order, same names, at most 160.
   - Triangles = index length / 3 = the runtime skin's count.
   - Positions and indices equal the runtime skin bit for bit.
   - Every weight row sums to 1 within 1e-6 and names valid joints.
2. **Byte identity.**
   - A second export is byte-identical.
   - A copied recipe object and the recipe text give the same bytes.
   - The CLI's sidecar and brief are identical on a second build.
3. **Parity with the runtime.**
   - Each GLB is loaded with three's own `GLTFLoader` in Node and played with an `AnimationMixer`. Clips play as `LoopOnce` with clamping, so the last key really is evaluated as the last key.
   - At **every** stored key, every joint's local translation, rotation and scale equals `poseComposer` within 2e-6. Measured: at most 3e-7.
   - At about 8 keys, including the last, every 7th skinned vertex equals the runtime creature (`createComposerCreature().update(motion, t)`, turned to +Z) within 2e-6 m. Measured: at most 4.7e-7 m. Skinning does not depend on time once the joints match, so together these two checks cover every key.
   - Between keys the error is linear interpolation at 30 fps. Measured: at most 4.5 mm (the winged ape-rhino's walk). The test only checks that it stays under 2 cm. Use `--fps 60` for tighter playback.
4. **Clip windows.**
   - A static motion bakes two keys.
   - The bird walk loops on whole gait periods.
   - The slim-worm crawl closes through the refined search (the case raised in Astra's review).
   - The reported `seamless` flags agree with the measured seams.
   - An fps outside [1, 240] is rejected.
5. **Boundary.** `src/fauna-composer-export.ts` imports only the core modules and `three`. The CLI adds only `node:` builtins. `tests/creature-core-boundary.test.mjs` still passes unchanged; the export module is not added to its 12-module list.
6. **CLI.**
   - The provenance has the shape asset-provenance requires, and the brief id matches the schema pattern.
   - The sidecar contains no timestamp.
   - The CLI refuses to overwrite a file with different bytes.
   - It rejects an empty `--motions` list and a non-numeric `--fps`; the other argument errors are tested too.

## Review

Astra (gpt-6-astra, read-only) reviewed commit `25a78b3`; the review is in `test-results/round2-2026-10-04/creature-export/astra-review.md`. It found no defect in:
- the root rotation and inverse-bind-matrix arrangement;
- the buffer layout;
- the accessor bounds;
- quaternion continuity;
- skin-weight merging.

It requested four changes, all fixed in `a41844d`:
1. The crawl clip window missed the real track period.
2. An fps of 0.01 crashed the export.
3. The test checked only some keys, never the last one, and no scale.
4. An empty motion list was accepted.

## Evidence (2026-10-04)

Evidence is in `test-results/round2-2026-10-04/creature-export/`. It was regenerated from commit `a41844d` (`export-commit.txt`), after the review fixes.

**Two exports.** `export-1/` and `export-2/` hold the same 16 species: the 12 presets, plus coherent species `ce1-0` to `ce1-3` (theropod, ungulate-grazer, cursorial-carnivore, pachyderm).
- Each export wrote 48 files from a separate Node process.
- The sha256 lists `export-1.sha256` and `export-2.sha256` match: 0 differences.
- A third run into `export-1/` reported all 16 species `identical` and wrote nothing.
- `clip-windows.txt` lists every clip's window, key count, seam and travel speed. All 15 legged walks are seamless after one gait period; the default worm's crawl and every idle and display clip carry a seam.

**assetctl validate** (`assetctl/summary.txt`, one line per species with every exit code):
- 16/16 valid;
- 0 Khronos errors, 0 warnings;
- no unweighted vertices, none with more than 4 influences, no non-normalised rows;
- 6,616–27,948 triangles, 15–79 joints, 4 animations each.

**assetctl contract validate asset-brief:** 16/16 exit 0.

**assetctl package --brief:** 16/16 exit 0. Each wrote `<key>.glb.asset.json` beside its GLB and registered the asset in the IWSDK `.assetctl` registry as version 0.1.0.

**Viewer sheets.** Four GLBs (bird, rhinoceros, trunked centipede, coherent theropod) were played in a plain three.js `GLTFLoader` page under the GPU lock. The renderer is in `render/`; it is evidence tooling only and is not shipped. Luna (`scripts/luna-eyes.mjs`) judged them six times; the verdicts are saved in `luna-1.txt` to `luna-6.txt`.

| Run | Images | Verdict |
|---|---|---|
| 1 | `sheets-run1/`: neutral, idle, display, and walk at 0, ¼ and ½ of the cycle | **FAIL**. Luna saw all four animals intact, with no tears or spikes. The fail was about motion: Luna could not see the walk move for the bird, centipede and theropod. The cause was my tile choice: t=0 and t=½ cycle are mirror phases, so from the side a symmetric gait looks almost the same. The tile bounds in `sheets-run1/render.json` show the mirroring. |
| 2, 3 | `sheets/`: the same, but walk at 0, ¼ and ¾ of the cycle | **FAIL** and **FAIL**. The animals were intact and untorn both times. Motion was seen for the rhinoceros and theropod. For the small bird and centipede legs Luna answered "cannot tell at this image size" (run 2: centipede; run 3: bird). |
| 4, 5, 6 | `sheets-legs/`: side close-ups of the walk at 0/6 to 5/6 of the cycle (`SHEET_MODE=legs`) | **PASS** all three times: "all four clips visibly animate, with no clear deformation artefacts". |

The animals were judged intact in all six runs. That the walk plays was settled by the close-ups, three times out of three. The numeric checks above already compare every key exactly. Luna's caveats: overlapping rhinoceros legs are hard to read one by one, and the centipede's small joints cannot show subtle skinning faults at this size.

## Limits (not done in v1)

- **No LOD and no Quest budget.** The briefs say `desktop-web` only. The trunked centipede has 27,948 triangles, which is a lot for a Quest scene. A LOD chain belongs to a later step.
- **No exact-loop idle or display clips.** A crossfaded loop variant (bake from t=b and blend the last b seconds back to the start) would make them seamless. It would no longer equal `poseComposer` inside the blend, so it is left as a follow-up.
- **No root motion.** Walk stays a treadmill and the travel speed is metadata.
- **Byte identity is checked only within V8 and this three revision.** `versions.three` and the source hash are in the sidecar. Recipe identity is engine-neutral; GLB bytes are fixed once exported (creature-kit plan, question 4).
- **The licence is `NOASSERTION`** until the owner decides it.
- **EC4 is not included.** This branch is built on main `b7d1df3`, without the held EC4 branch. When EC4 merges, the skin version and the source hash change, so new exports differ from these. That is expected; they do not need re-pinning.
