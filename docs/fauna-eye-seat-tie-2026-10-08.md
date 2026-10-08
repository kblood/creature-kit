# Ostrich eye seat: an engine-dependent closest-point tie (R7a-KIT-EYE-TIE, 2026-10-08)

Task R7a-KIT-EYE-TIE (Opus-decided on Kasper's instruction, overrulable). The Atlas R7 sync (infra/creature-kit-sync-2 at
031f4b5, kit c5b0cde) failed the strict four-engine golden check on one key: WebKit 26.5 `fauna` a8e59237... against
Node, Chromium 149 and Firefox 151 fefcb903.... This note records the diagnosis, which was written before any code change.
**It ends in a STOP. No code has changed on this branch.**

## 1. What moves

- **Specimen:** the `ostrich` preset, built the golden worker's way (normalize, derive, graph, skin). Skin-5 unfolds its
  neck-to-head blend (`debug.blendUnfolded` true).
- **Floats:** 6 position floats, at vertices 3654 and 3674. The two vertices coincide.
- **Node / Chromium / Firefox:** (1.1120960712432861, 2.739077568054199, -0.06546421349048615).
- **WebKit:** (1.1121041774749756, 2.739084005355835, -0.0654660239815712). The largest difference is 8.1e-6 m.

**Which code makes them:**
- Both vertices belong to the left eye (side -1, first vertex 3532). Vertex 3654 is local vertex 122, the orbit ring's
  vertex i = 1. Vertex 3674 is local vertex 142, its socket copy.
- The eye kind is `round`, built through the catalogue path (`buildCataloguePatch`, fauna-composer-eye-2).

**Which call:**
- The vertex is not placed by the seat search (`nearestExit` in `buildCatalogueEyes`), and not by the site hit.
- It comes from the patch's surface projection, `surfaceZ(x, y)` in `buildCataloguePatch`, for the orbit ring:
  - The rim line (p = at(x, y, recess), along the gaze, |t| <= rimSearch er = 0.01627 m) has exactly one crossing:
    t = -0.018425283986925441. Its triangle is head-local 199 (skin triangle 5547, the torso's neck-to-head blend), not
    hidden, with n.g 0.731. That |t| is outside the range, so `outermostExit` returns null. The line falls past the
    blend's edge, into a gap.
  - The fallback, `closestPointOnSoup(o.surface, p)`, finds the closest skull point 0.013735217975587001 m away.
    That is within closestSearch, so the vertex is seated on it.
  - Its off-line distance is 0.527 er, above wrapOff/2 = 0.075. So `wrap()` moves the vertex fully (w = 1) onto
    `hit.point + hit.normal x orbitLift er`. **The chosen triangle's normal sets the vertex position.**

**The candidates of that closest-point call (17 significant digits):**

| near tri | skin tri | part | hidden | d^2 | u, v | normal |
|---|---|---|---|---|---|---|
| 133 | 5602 | torso (neck-to-head blend) | 0 | 0.00018865621283688830 | 0.41811502852532267, 0.58188497147467733 | -0.43154228058839506, 0.15783950478349271, -0.88817675650417072 |
| 134 | 5603 | torso (neck-to-head blend) | 0 | 0.00018865621283688830 | 0, 0.58188497147467733 | -0.38718018838163309, 0.20350363557819642, -0.89926512888648125 |
| 158 | 5658 | torso blend | 0 | 0.00020382539159840261 | 0.43880888449063588, 0 | (next distinct surface) |

- Triangles 133 and 134 are the two halves of one blend quad. They share the edge from
  (0.014006253155939064, 0.035000929518040284, -0.06044457123018487) to (0.026179993668374136, 0.021139875350183503, -0.06882275227935794).
- The closest point lies on that shared edge. Both give the same point
  (0.021089969806757470, 0.026935390408967985, -0.065319708870992629) and the same d^2, bit for bit, in Node.
- Their normals are 3.70 degrees apart.
- `closestPointOnSoup` keeps the first strict minimum (`d < bestD`), so Node keeps triangle 133.

**Reproduced exactly in Node, in two ways:**
1. Resolve exact ties to the last candidate (`d <= bestD`) and change nothing else. The build moves exactly those 6
   floats, to WebKit's values bit for bit: x 1.1121041774749756, y 2.739084005355835, z -0.0654660239815712. Colours
   are unchanged.
2. The existing nudge mode "pow(1, y) one ulp below 1" (tests/fauna-composer-mesh-stability.test.mjs) moves the same 6
   floats to the same WebKit values. This is the negative control.

**Classification:**
- This is an exact tie between two visible triangles of the same surface. It is not a hidden face, so fix (a) does not
  apply. The ray does fall into a gap, but the gap only routes the vertex to the closest-point fallback, where the tie
  is.
- The head's start-cap hypothesis is ruled out: no candidate is a head-cap triangle, and none is hidden.
- The tie is geometric. The closest point of a soup very often lies on an edge shared by two triangles. Which of the
  two is "closer" is decided by rounding, and that rounding differs between engines. Here the cause is a one-ulp
  difference upstream in a transcendental (pow), as the nudge shows.

**Measured numbers for fix (b):**
- **Engine noise:** the largest distance difference between tied candidates is 1.4e-17 m, across all closest-point ties
  in the corpus.
- **Gap to the next distinct candidate:** at least 4.5e-6 m at this call site (odd-cat-centipede), and at least
  8.6e-7 m at any closest-point call.
- **Ostrich:** noise 0 here (an exact tie); gap to the next distinct surface 5.42e-4 m.
- A tie distance of 1e-9 m therefore sits 8 orders of magnitude above the noise and about 3 below the smallest gap.

## 2. The fix (b) and what it would move

**The rule:** at the catalogue `surfaceZ` closest-point fallback only, candidates within 1e-9 m of the best distance
are resolved by the lowest triangle index. It was tried in a scratch copy, not on this branch.

**Results:**
- **Ostrich:** Node output unchanged. Lowest index is triangle 133, which is today's pick.
- **The golden corpus** (12 presets and GOLDEN-FAUNA-1 to 4) is unchanged in Node. The 32 composer-identity CLI GLBs,
  V1_PINS and the skin-4/5 links are unchanged too. (The `.creature.json` and source hashes differ only because they
  embed the generator source hash.)
- **Nudge survey** (six modes, 74 specimens):
  - The rule removes every eye-seat flip: ostrich, skin5-link-24, cat-raptor-bird, cat-cephalopod-ape,
    odd-cat-centipede and odd-wild-33. That is 15 of the 31 moves.
  - Applying it at every closest-point call (legacy `surfaceZ` and `unair` as well) removes nothing more.
- **It does move Node bytes in three eye-catalogue specimens.** These have the same proven cause, and all of them flip
  under the nudge:

| specimen | floats moved (incl. normals) | vertices | max position move | all in the eye patch |
|---|---|---|---|---|
| cat-raptor-bird | 33 | 2 | 1.32e-5 m | yes |
| cat-cephalopod-ape | 63 | 4 | 6.82e-5 m | yes |
| odd-wild-33 | 66 | 4 | 5.09e-4 m | yes |

**Why no tie rule can keep today's Node bytes:**
- At this call site there are 36 ties whose normal is actually used (w > 0) across the corpus.
- In every exact tie, Node keeps the lowest index.
- In the 5 inexact ones, the candidates differ by 1.7e-18 to 1.4e-17 m, and Node keeps whichever is a few ulps
  smaller: the higher index in all 5 (raptor 388, cephalopod-ape 309 and 419, wild-33 1108 and 1114).
- Neither "largest n.g" nor "smallest n.g" matches Node's picks across the 36.
- So today's Node output is itself rounding noise. Any deterministic rule moves at least one of these specimens.
- Lowest index moves the fewest: the 3 specimens above, and none in the golden corpus.

## 3. STOP

The decision's gates cannot all hold:

1. **"The nudge test finds flips with a different cause."** Under the six modes, with the fix applied, 16 moves remain
   in 5 specimens. None of them is an eye seat:
   - **Mouth disc on blunt heads,** whose midline vertices sit a hair off z = 0 and change sign:
     - skin5-link-14: 1 float, z +-8.8e-6 m.
     - skin5-link-22: up to 4 floats per mode, z +-4.4e-5 m.
     - skin5-link-23: up to 5 floats, z +-4.4e-6 m.
     - cat:odd-earlier-rules-worm: up to 5 floats. Its mouth-disc vertex also moves in x and y, by up to 7.8e-5 m.
   - **Cephalopod eye colours,** in cat:odd-cephalopod-horse: 246 colour floats move under three of the six modes, by
     up to 1.4e-4.
   - All five specimens are outside the golden corpus. The golden corpus is clean under every mode once the eye-seat
     rule is in.
2. **The fix moves Node bytes in three specimens of the eye catalogue.** Its fixture
   (composer-eye-catalogue-links.json) must stay identical, and fixtures are not to be touched. These three specimens
   have the same proven cause; see the table in section 2.

No code change, test, version change or Atlas sync has been made.

**Options for the decision:**
- **(A)** Apply fix (b) at the catalogue `surfaceZ` closest-point fallback, with a 1e-9 m tie and the lowest index.
  Re-pin the 3 eye-catalogue entries as a pre-ship skin-5 correction, with an old to new ledger. Scope the new nudge test
  to the golden corpus, the 28 skin-5 links minus 14, 22 and 23, and the catalogue minus the two different-cause
  specimens. List those five specimens as a backlog item (mouth-disc midline, cephalopod eye colour).
- **(B)** As (A), but also fix the mouth-disc midline and the cephalopod colour flips in this round. Both are outside
  the owned file list.
- **(C)** The fallback: a WebKit entry in `KNOWN_ENGINE_MISMATCHES` for the fauna key. This is not authorised.

Scratch evidence (session scratchpad `eyetie/`): `d2.mjs` and `d3.mjs` (the crossing and closest-point dumps),
`d4.mjs` (the last-of-ties reproduction), `survey.mjs` with `survey-c5b0cde.log` and `survey-var-*.log` (the nudge
survey), `scan-1e-9.log` and `scan2.log` (every closest-point tie), `id-base.json` and `id-surfaceZ.json` (the
composer-identity reports).

## 4. Decision and results

**Decision** (`eye-tie-decision-2`, Opus-decided on Kasper's instruction, overrulable): option (A). Opus amended two of
its own gates:
- The eye-catalogue fixture may change in exactly three entries.
- The nudge test skips five named specimens, which must keep moving until FAUNA-NUDGE-STABLE-2 fixes them.

Option (B) was rejected, and option (C) was not needed.

**Code:**
- In `src/fauna-composer-eye.ts`, a new module-private function `closestPointOnSoupLowTie` with `CLOSEST_TIE = 1e-9` m.
  It compares distances, not squared distances. Every candidate within the tie window of the best distance counts as
  tied, and the lowest triangle index wins. The hit is built exactly the way `closestPointOnSoup` builds it.
- It is used only at the `surfaceZ` closest-point fallback in `buildCataloguePatch`. The legacy `surfaceZ` and
  `unair` call sites are untouched, because the survey showed they gain nothing.
- Every exported function is byte-identical, and `creature-core-exports.json` is unchanged.

**What moved in Node** (composer-identity against c5b0cde):
- The three catalogue entries below, and the source hash.
- Unchanged: the 32 CLI GLBs, V1_PINS (GLB, BIN and JSON pins byte-equal), the skin-4 and skin-5 links, baseline-v2
  and baseline-v3, the face specimens, the lineage-B guard and the LOD budgets.
- The `.creature.json` sidecars and the V1_PINS `core` key change only because they carry the generator source hash.
  `core` was re-keyed from 5c941506... to 179e31d7..., with a ledger line in the export test. Export is 20/20 with no
  diagnostic.

**Re-pin ledger** (`composer-eye-catalogue-links.json`, re-pinned in place; `skinPreEyeTie` holds the old pin and
`eyeTieDrift` is "catalogue-closest-tie"):

| specimen | skin old -> new | moved |
|---|---|---|
| cat-raptor-bird | 7010df494c541bbd... -> 5b001069f5bddd38... | 2 eye-rim vertices, max 1.32e-5 m |
| cat-cephalopod-ape | 2576bc2c14404a32... -> f6133c1a77db8e56... | 4 eye-rim vertices, max 6.82e-5 m |
| odd-wild-33 | 677833cd07afd9cc... -> 6d1004a8e79a5269... | 4 eye-rim vertices, max 5.09e-4 m |

- Gloss, vertex counts, triangle counts and bones are unchanged for all three.
- This is a pre-ship skin-5 correction, so there is no version change.

**Nudge test** (`tests/fauna-composer-mesh-stability.test.mjs`):
- **Scope:** the six modes over 74 specimens: the 12 presets, GOLDEN-FAUNA-1 to 4, the 28 skin-5 link texts and the
  30 eye-catalogue specimens.
- **The rule:** every float must sit on the 1e-6 grid and equal the unnudged build.
- **`NUDGE_UNSTABLE_KNOWN`** (FAUNA-NUDGE-STABLE-2). Each entry must still move under at least one mode, or the test
  fails with "remove it from NUDGE_UNSTABLE_KNOWN":
  - skin5-link-14, skin5-link-22, skin5-link-23 and cat:odd-earlier-rules-worm: the mouth-disc midline.
  - cat:odd-cephalopod-horse: the cephalopod eye colours.
- A third new test requires `eyeTieDrift` on exactly the three re-pinned entries, each differing from the pin it
  replaces.

**Negative control:** the same test file was run against the c5b0cde `src` tree (git archive into the scratchpad,
with this branch's fixtures). The corpus test fails with these six movers:
- `ostrich`: pow(1, y) one ulp below 1. It moves to WebKit's bytes.
- `cat:cat-raptor-bird`: three modes.
- `cat:cat-cephalopod-ape`: four modes.
- `cat:odd-wild-33`: four modes.
- `cat:odd-cat-centipede`: two modes.
- `skin5-link-24`: alternating from minus.

On this branch the corpus test passes. The output is in `eyetie/negative-control.log`.

**Gates on kit/eye-seat-tie 2fe1fa3** (all through `test-slot.mjs --shared 4`):
- tsc: 0.
- `tests/*.test.mjs`: 217 tests, 215 pass, 2 skip (atlas parity, no ATLAS_DIR), 0 fail.
- Lab suite with ATLAS_DIR: 60 of 60 pass.
- Export: 20 of 20 pass, with no diagnostic.

**Cross-engine proof** (uncommitted sync of 2fe1fa3 into `universe-atlas-wt/kit-sync-2`, 46 files, then
`git restore` back to 031f4b5):
- Strict run against R7's golden.json: Node, Chromium, Firefox and WebKit all give fauna fefcb903 and equal every other
  key (`fourEngineEqual: true`). The gate reads FAIL only because that golden.json still holds main's skin-4 fauna
  6bf5d085...; R7 step 3 re-pins it.
- Strict run with `--fixture` set to Node's proposed result (fauna fefcb903, faunaKnownUnstable 495fa9eb):
  "GOLDEN CROSS-ENGINE GATE: PASS (all four engines equal)".
- WebKit 26.5 now builds the ostrich as Node does.
