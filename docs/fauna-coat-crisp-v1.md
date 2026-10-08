# Fauna coat crisp v1 (`fauna-composer-skin-5`)

Date: 2026-10-07. Backlog #17 FAUNA-COAT-CRISP plus the EC4 visual carry-overs. Branch `kit/coat-crisp` (creature-kit),
from `3e0d6e8`. Author: Opus 5.5.

Decisions in this document are **Opus-decided on Kasper's instruction, overrulable**.

## 1. Pre-registration (written before any look change; step 1 of the brief)

This section was committed on its own, before the code that it judges. Later sections only add results and ledgers;
they do not move a threshold. A threshold that turns out to be wrong is reported as not met, not re-set.

### Baseline at 3e0d6e8 (measured, CPU)

- **Pattern clamp makes the requested scale a no-op on most bodies.** The mesh caps the pattern scale so that a mean
  cell is at least four torso edges across (`fauna-composer-mesh.ts`, "pattern scale clamp"). Probe (`coatScale`,
  preset recipe with `pattern` and `bodyLength` overridden):

  | preset | pattern | patternScale 1 -> effective | patternScale 2 -> effective |
  |---|---|---|---|
  | giraffe, bodyLength 0.3 | spots | 0.623 | 0.623 |
  | rhinoceros, bodyLength 0.3 | spots | 0.377 | 0.377 |
  | dinosaur, bodyLength 0.3 | reticulated | 0.861 | 0.861 |
  | ape, bodyLength 1.5 | reticulated | 0.834 | 0.834 |
  | bird, bodyLength 0.3 | spots | 0.431 | 0.431 |
  | centipede, bodyLength 0.3 | spots | 0.970 | 1.541 |

  The clamp is relative (cells per body length against the torso edge in body lengths), so it bites on every body
  size; "small bodies" is where the result is most visible on screen.
- **Seam normals.** three's `computeVertexNormals` (today's runtime and export path) gives each part its own normals.
  Coincident seam vertices (bitwise-equal positions, equal skin weights) therefore shade differently. Angle between the
  normals of coincident vertex pairs:

  | specimen | torso / head (neck-to-head seam) | head / trunk | trunk / trunk (zip band, tip re-emit) |
  |---|---|---|---|
  | preset-trunked-centipede | 14.1 .. 15.6 deg (22 pairs) | 5.4 .. 180 deg (45) | 3.7 .. 168 deg (70) |
  | custom-rhinoceros-trunk | max 29.1 deg (28) | max 180 deg (57) | max 92.2 deg (76) |
  | preset-giraffe | max 41.9 deg (28) | - | - |
  | plausible-pachyderm-1 | max 28.6 deg (28) | max 180 deg (57) | max 26.6 deg (76) |

  This matches the EC4 "dotted light line at part seams" (trunk junction, head to neck), which EC4 found with bitwise
  identical seam positions and weights: it is a shading-normal step, not a crack. The 180-degree pairs are the centres
  of the two hidden junction discs; the hidden loft caps (the neck's end cap inside the head, the head's start cap
  inside the neck) also pollute the boundary-ring normals.
- **Trunk.** Centreline turn between consecutive trunk rings (debug rings, chain `trunk`): 13.2 deg
  (trunked-centipede), 10.0 (custom-giraffe-trunk), 10.3 (custom-rhinoceros-trunk), 10.8 (plausible-pachyderm-1);
  the largest turn sits at ring 2, inside the muzzle-to-trunk join blend. Tip: the end face is a flat disc of radius
  `TRUNK_TIP.face` = 0.86 r behind a lip of 1.1 r, a flat-cap ratio of 0.78.
- **Proboscis head-group budget** (head + eyes + mouth + horn + trunk triangles, allowance legacy + 800): margin left
  356 (trunked-centipede), 224 (custom-giraffe-trunk), 192 (custom-rhinoceros-trunk), 120 (plausible-pachyderm-1).
  Any trunk change must be close to triangle-neutral.
- **Dichromatism.** Today the only sex colour effect is a 6 % perceptual darkening of a male's back. CIE76 dE between the
  mean torso-region vertex colour of the male and the female individual of a preset (individualSeed 7, variability 0,
  maturity 1, condition 0): at dimorphism 1, 0.40 (centipede) .. 1.63 (bird); at dimorphism 0, 0.000. A dE below
  about 2.3 is under the just-noticeable difference.

### Metrics and thresholds

**(a) Pattern frequency on small bodies (crisp coat).**

- Bodies: the giraffe preset at bodyLength 0.3 with `pattern` spots, and the dinosaur preset at bodyLength 0.3 with
  `pattern` reticulated (both clamp at patternScale 1 and 2, table above).
- Fragment-density samples: an orthographic CPU rasteriser draws the torso part from the left side at 1024 pixels per
  body length (z-buffered, barycentric interpolation of the vertex attributes; a pixel is about 1/1024 body length).
  - The **crisp** value of a pixel is the CPU twin of the fragment shader: the pattern mask from `coatPatternProbe`
    (the frozen `patternMask`) at the pixel's pattern-space point with the requested, unclamped scale and a footprint
    of one pixel, mixed between the interpolated per-vertex layer colours.
  - The **vertex** value is the interpolated vertex colour (today's only path).
- Signal: luminance along the middle rows of the torso flank. Measure: the dominant frequency (cycles per body length)
  of the mean power spectrum of those rows, from a DFT, bins 2 and up.
- Pass: dominant frequency at patternScale 2 / at patternScale 1 is >= 1.5 for the crisp value, on both bodies.
- Negative case (must fail the same threshold): the vertex value gives a ratio < 1.5 on both bodies. If today's path
  passed, the metric would not distinguish anything and the step counts as not met.
- Equality at the vertices: for every crisp vertex the shader formula evaluated with the vertex's own CPU mask
  reproduces the vertex colour to <= 2e-6 per channel, wherever no layer colour touches a clamp bound (0.002 or 1;
  the coat colour is affine in the mask amount, so the layers are exact there, not an approximation). At least 95 %
  of the crisp vertices of each body must be in that set.

**(b) Dichromatism colour distance.**

- Metric: CIE76 dE (D65, from linear RGB) between the mean torso-region vertex colour of the male and of the female
  individual of the same recipe (individualSeed 7, variability 0, maturity 1, condition 0), over all 12 presets.
- Pass: at dimorphism 1, dE >= 12 for the plumage palette and dE >= 5 for every other palette. At dimorphism 0.5,
  dE >= 0.4 x the dimorphism-1 value (monotone). At dimorphism 0 (monomorphic), dE is exactly 0 and the colour arrays
  are bitwise equal.
- Source: existing fields only (`traits.sex`, `recipe.dimorphism`, `traits.maturity`, `recipe.palette`); no recipe
  format change; the female and sexless (`sex: 'none'`) colours do not change.
- The 12 dimorphism-1 dE values are pinned (1e-6) in `tests/fauna-composer-coat-crisp.test.mjs`.

**(c) Seam-line metric (shading discontinuity across welded seams).**

- Welded group: vertices with bitwise-equal Float32 positions and equal skin indices and weights, outside the eyes part
  (eye shells meet at deliberate creases).
- Metric: the largest angle between the shipped shading normals of two vertices of one welded group, over the review
  corpus (all presets, the face specimens of tests/fauna-face-specimens.json).
- Pass: exactly 0 (bitwise-equal normals in every welded group), and every welded normal points out of the visible
  surface (dot with the area-weighted normal of its visible incident faces > 0.5 on each side of the seam).
- Negative case: today's `computeVertexNormals` path gives > 10 deg on preset-giraffe, preset-trunked-centipede and
  custom-rhinoceros-trunk.

**(d) Trunk faceting and centipede tip closure.**

- (d1) Shading facets inside the trunk: covered by (c) (the zip band and the tip re-emit are welded seams).
- (d2) Side silhouette: the largest centreline turn between consecutive trunk rings is <= 8 deg on the four proboscis
  review specimens (baseline 10.0 .. 13.2 deg).
- (d3) Tip closure: the flat end-cap ratio (radius of the planar end disc / the tip's largest ring radius) is <= 0.6
  (baseline 0.78), the end rolls in over at least two rings narrower than the lip, and the tip is a closed surface.
- Budget: the proboscis head group stays <= legacy + 800 (no allowance raise); COMPOSER_BUDGET and the soft 70k / hard
  80k triangle limits hold.

**Visual (advisory, step 7).** Luna (GPT Luna 6), three fixed asks per criterion, 2-of-3 majority, "cannot tell" stays
unverified, on a fixed before/after sheet of 8 specimens: two small spotted/reticulated bodies, a dichromatic pair, a
trunked head, the centipede. Criteria: crisp pattern edges; male and female read as differently coloured; no light
line at the seams; no facets on the trunk; the trunk tip is not a cap; the creature is intact (no tearing). Luna
verdicts never gate; "intact / no tearing" failing twice stops the task.

### Version plan

- `COMPOSER_SKIN_VERSION`: `fauna-composer-skin-4` -> `fauna-composer-skin-5` (a look change: shading normals, layer
  attributes, trunk tip, male colours).
- Material: a new cache key and shader version `fauna-composer-coat-crisp-1` for the coloured material with the crisp
  coat. The neutral material is unchanged.
- `fauna-coat-1` (`FAUNA_COAT_FIELD_VERSION`) does not move: `fauna-coat-fields.ts` and `fauna-coat-vocab.ts` are
  append-only (new exports only), guarded by `tests/fixtures/coat-lineage-b-guard.json` (every 3e0d6e8 export,
  Object.is).
- Recipe format: unchanged (v1 .. v4 links decode unchanged).
- Export (`fauna-composer-export.ts`, not touched here): the GLB keeps vertex colours, so an exported creature carries
  the vertex-density (clamped) pattern, not the crisp one. It does pick up the new shading normals, because it reads the
  runtime geometry; its V1_PINS skip with "composer core moved" (expected).

## 2. Results (added per step; section 1 is unchanged)

### Step 0: lineage-B guard

`tests/fauna-coat-fields.test.mjs`, run on the branch after the 6d0a1c7 merge with the step-2 appends present: guard
PASS (every 3e0d6e8 export of both coat modules, Object.is) and its one-ulp negative control PASS.

### Step 2: crisp coat (`fauna-composer-coat-crisp-1`)

- **What it does.** For the patterns spots, rosettes, reticulated, dapple, stripes, bands and brindle (stripes, bands and
  brindle off the limbs only), every vertex whose colour came from exactly one coat sample at that vertex (lofted
  rings, zip bands, flat caps) is evaluated three more times with `evaluateCoatWithMask` (mask 0; mask 1 with patch
  shade 0 and 1). The coat is affine in the mask amount and the patch shade, so the shader's
  `c0 + m (c1 - c0) + m p (c2 - c1)` with the fragment's own mask is exact. Other vertices (eyes, horn, armour, the
  head's ellipsoid and tube parts, feet built from patches) carry their vertex colour in all three layers, so they shade
  exactly as before. The shader (`COMPOSER_COAT_CRISP_GLSL`) re-implements the crisp patterns' `patternMask` in GLSL
  with the frozen uint hash, at the REQUESTED pattern scale and with a screen-space footprint (`fwidth` of the
  pattern-space point).
- **Which vertices are crisp** (preset sweep): torso 89-96 %, legs and arms 71-82 %, head 9-70 %, feet 0-13 %, trunk
  87 %. Heads built from ellipsoids and tubes stay at vertex density in v1.
- **Vertex colours did not move.** The 28 skin-4 link texts and every eye-catalogue specimen build the same positions,
  index, weights, colours and gloss bytes as before (composer-identity: `skin4Links` and `eyeCatalogue` sections
  identical to 634ca06). The layer evaluations are side-effect free.
- **Export.** `fauna-composer-export.ts` is not touched: a GLB keeps the vertex colours, so an exported creature carries
  the clamped vertex-density pattern, not the crisp one.
- **Gate (pre-registered metric a).**

  | body | dominant frequency, scale 1 -> 2 (cycles per body length) | crisp ratio | vertex ratio (negative case) |
  |---|---|---|---|
  | giraffe, spots, bodyLength 0.3 | crisp 2.96 -> 10.34; vertex 4.43 -> 4.43 | 3.50 (>= 1.5 PASS) | 1.00 (< 1.5 PASS) |
  | dinosaur, reticulated, bodyLength 0.3 | crisp 8.08 -> 12.92; vertex 3.23 -> 3.23 | 1.60 (>= 1.5 PASS) | 1.00 (< 1.5 PASS) |

  The giraffe's scale-1 crisp peak sits at a low frequency (a broad tonal component outweighs the spot peak), which
  inflates its ratio; the dinosaur's 1.60 is the tighter of the two. Equality at the vertices: giraffe 5762 / 5762
  crisp vertices checked, max error 5.8e-8; dinosaur 4964 / 4964, max error 4.9e-8 (<= 2e-6 and >= 95 % PASS).
  Extra coverage (not pre-registered): rosettes, dapple, stripes, bands, brindle and the trunked centipede, max error
  <= 5.8e-8; on the bird's plumage palette (accent blue = 0) 1132 / 2296 vertices are away from the 0.002 floor.

### Step 3: sexual dichromatism (skin-5)

- **Source.** Existing fields only: `traits.sex`, `recipe.dimorphism`, `traits.maturity` (full effect from maturity
  0.95, none below 0.55) and `recipe.palette`. No recipe field was added; v1..v4 links decode unchanged.
- **Map** (`dichromatic` in `fauna-composer-mesh.ts`), weighted by dimorphism x maturity x the back-and-flank weight
  `smooth(-0.85, 0.15, dorsal)` (the belly stays as the female's):
  - plumage: the coat mixes toward the palette accent (55 % at full weight): breeding plumage;
  - every other palette: a pure luminance scale that lowers the palette base by 16 L* units, floored at 40 % of the
    base L*; a coat too dark to drop that far (the ink palette) takes a wash of the palette accent for the shortfall
    (30 % x shortfall). A first draft also raised saturation by 50 %; it pushed 1158-3147 vertices per reptile and
    savanna male out of gamut (a channel <= 0), so saturation was dropped. No channel leaves gamut now (0 vertices
    on all 12 presets).
  - The map is affine in the colour, so the crisp layers stay exact on males (giraffe/spots and ape/stripes males:
    5790 / 5790 and 1413 / 1413 checked, max error 5.5e-8 and 1.4e-8).
- **Gate (pre-registered metric b), CIE76 dE of the mean torso colour, male vs female, individualSeed 7:**

  | preset | palette | dE at dimorphism 1 (pinned) | at 0.5 | at 0 |
  |---|---|---|---|---|
  | dinosaur | reptile | 9.012490 | 4.943 | 0 (bitwise) |
  | turtle | reptile | 7.824129 | 4.336 | 0 (bitwise) |
  | giraffe | savanna | 8.176930 | 4.407 | 0 (bitwise) |
  | bird | plumage | 35.183680 | 17.959 | 0 (bitwise) |
  | ostrich | ink | 11.108634 | 6.118 | 0 (bitwise) |
  | rhinoceros | slate | 9.019166 | 4.903 | 0 (bitwise) |
  | ape | ink | 9.784565 | 5.382 | 0 (bitwise) |
  | worm | earth | 5.959899 | 3.355 | 0 (bitwise) |
  | centipede | ink | 6.271398 | 4.027 | 0 (bitwise) |
  | shelled-giraffe-bird | savanna | 8.428803 | 4.491 | 0 (bitwise) |
  | trunked-centipede | slate | 6.922974 | 3.826 | 0 (bitwise) |
  | winged-ape-rhino | earth | 7.554235 | 4.177 | 0 (bitwise) |

  PASS: plumage 35.18 >= 12; the other 11 >= 5 (minimum 5.96, worm); every dimorphism-0.5 value >= 0.4 x its
  dimorphism-1 value (lowest ratio 0.53, shelled-giraffe-bird 4.4906 / 8.4288; erratum, step 4: first written as 0.54, giraffe); dimorphism 0 exactly 0 with bitwise-equal colour arrays. Female,
  sexless (type specimen) and dimorphism-0 male colour arrays of all 12 presets are byte-identical to 819be67 (48
  digests pinned); negative control: the dimorphism-1 male giraffe differs from its pinned female.
- **Before** (section 1): 0.40 .. 1.63 at dimorphism 1, under the just-noticeable difference.

### Step 4: seam normals and the trunk (skin-5)

- **Seam normals** (`composerSeamNormals`, used by `createComposerCreature` instead of three's
  `computeVertexNormals`). Start from three's per-vertex normals, then for every welded group (bitwise Float32
  position, equal skin indices and bitwise weights, outside the eyes part) write ONE normal to all members:
  the normalised sum of each member's own unit normal over its visible incident faces, so each side of the seam counts
  once (the bisector of the two surfaces). A first draft summed area-weighted face normals over the whole group; a
  large flat cap on one side then dominated and the shared normal left the other side's visible faces (min dot 0.49,
  ape). Faces that close a part inside another one are marked hidden while they are built (`Skin.hide`, kept per
  triangle in `debug.hiddenTriangles`): the axial loft's end cap (inside the head), the six head lofts' start caps
  (inside the neck) and the inset trunk discs; they do not vote. Fallbacks: all faces, then the lowest member's own
  normal. Written with `Math.fround`, so the members are bitwise equal.
- **Neck-to-head blend fold.** On long or steep necks the blend rings still crossed after `fanOutBends` (a fold at the
  top of the seam whose faces point into the neck; it made the giraffe and cat seams fail the dot check, min dot 0.035
  without the fix). Where they still cross, the blend rings now turn monotonically from the neck's last frame to the
  head axis (slerp, eased over the blend's arc length); centres and radii are unchanged.
  - Side effect: the eyes seat on the head part plus the head-weighted blend triangles (`buildEyes`, unchanged), and the
    unfolded blend is a valid surface, so the ostrich and shelled-giraffe-bird eyes seat 2.25 / 2.32 eye radii further
    back (cat-cephalopod-ape 0.16; the other 92 eye builds of presets x maturity 0.3/1 and the specimens do not move).
    CPU side view before / after (ostrich, scratch review image, not committed): `C:/Users/Caldor/AppData/Local/Temp/claude/C--LLM-IWSDK/84c3735d-46ff-4f28-8f76-5598fd94ed7b/scratchpad/coat/ostrich-cmp.png` (left: fold, right: fixed). The eyes test's
    seating surface (`headTris` in tests/fauna-composer-eyes.test.mjs) now matches buildEyes' (head part plus
    head-weighted blend triangles); with the head part alone, "skull surface along the gaze" found no exit for the
    moved ostrich eye. Its thresholds are unchanged.
- **Hidden-flag check (not pre-registered).** Independently of the flags, every hidden face's centroid, nudged along
  its outward normal by 0.005 x its two edge lengths, must lie inside another connected shell (ray parity per shell).
  The axial end caps and trunk discs pass on all 83 specimens. The head start caps (a 0.2-radius dome reaching back
  into the neck, unchanged from skin-4) poke out of the throat of a sharply bent neck: 25 of 83 specimens, 333 faces,
  deepest 0.119 seam radii (wild-composer-5-blunt-paired); 20 specimens before the fold fix. They are interior cap
  bands (radial 0.56-0.84), not the seam band, so no shipped seam normal depends on them; the test reports them and
  does not gate them. A flatter cap (0.02) cut this to 9 specimens but moved the eye seat of the juvenile turtle off
  the skull (buildEyes seats on the head part, cap included), so it was reverted. Follow-up: a cap clipped to the neck.
- **Trunk centreline (d2).** Two changes, same ring count:
  - the join: the centre line leaves the muzzle along its axis on a cubic Hermite curve that meets the trunk spline at
    the first ring past the EC4 reach, start tangent 1.3 x chord (`TRUNK_JOIN_LEAD`), rings at equal arc steps
    (EC4's lerp bent most at the second ring, 10 .. 13 deg). A trunk shorter than the reach (trunkLength 0.2) keeps
    EC4's blend: on it the curve turned every ring plane and folded the band (head-geometry test, 178.8 deg);
  - past the reach, `respaceStations` moves the trunk stations along max(arc / mean spacing + turn / 2 deg,
    S x |log radius step| / log 1.08), so rings leave straight runs for the curl while a tapering run keeps radius
    steps under 8 % per ring (arc + turn alone gave a 10.3 % step on custom-rhinoceros-trunk@snout0, over the
    head-geometry test's 10 %).
- **Trunk tip (d3).** `TRUNK_TIP`: the bulb rolls in over two rings past the widest (1.04 r and 0.90 r) to a flat end
  face of 0.62 r at 0.56 r (was 0.86 r behind a 1.06 r ring); nostrils 0.3 r apart, half width 0.22 r, so they stay on
  the smaller face. Triangle count of the tip unchanged except one ring (+32 per trunk).
- **Gate (pre-registered metrics c, d), tests/fauna-composer-coat-crisp.test.mjs:**

  | metric | result | threshold | |
  |---|---|---|---|
  | (c) largest in-group normal angle, 83 specimens | 0 (bitwise) | exactly 0 | PASS |
  | (c) min dot, welded normal vs its visible faces (area-weighted) | 0.794 | > 0.5 | PASS |
  | (c) negative: three's normals, giraffe / trunked-centipede / rhinoceros-trunk | 25.8 / 180 / 180 deg | > 10 | PASS |
  | (d2) max centreline turn: trunked-centipede / giraffe-trunk / rhinoceros-trunk / pachyderm-1 | 7.35 / 5.46 / 6.62 / 7.55 deg | <= 8 (baseline 10.0 .. 13.2) | PASS |
  | (d3) flat-cap ratio, all four | 0.564 (0.62 / 1.10) | <= 0.6 (baseline 0.78) | PASS |
  | (d3) roll-in rings narrower than the widest, all four | 2 (1.04, 0.90 r) | >= 2 | PASS |
  | (d3) closed tip: trunk boundary edges off the join plane | 0 | 0 | PASS |
  | budget: proboscis head group (legacy + 800) | 3560 / 3752 / 3784 / 3856 (limits 3872 / 3920 / 3920 / 3920) | <= | PASS |
  | budget: triangles | 28452 / 16756 / 19280 / 13268; COMPOSER_BUDGET and 70k / 80k tests pass | | PASS |

- **Regression gate.** tsc 0. Suite: 211 tests, 205 pass, 2 skip (atlas parity, no ATLAS_DIR), 4 fail. mesh-stability (5 tests), lineage-B guard and its negative control,
  budgets, head geometry, eyes, occlusion pins: PASS. Remaining failures are the four step-6 re-pins: the skin-4 and
  eye-catalogue fixtures' `capturedAt` version (skin-4 -> skin-5, since step 2) and the geometry digests of the
  legacy links (skin-3 links under the earlier eye rules, and the skin-4 links), which the fold fix and the trunk move.
- **composer-identity:** digest 63d88faf... -> 70932ea6...; `v1Pins` 5 / 5 change (the GLBs carry the new seam normals; export test V1_PINS),
  `skin4Links` 12 / 28, `eyeCatalogue` 11 / 30, `cli` 2 / 2. Recorded for the step-6 ledger.
- **Ledger, metric (b) colour pins** (`UNCHANGED_COLOUR_PINS`, 20 of 48 re-keyed; the other 28 unchanged since
  819be67). Each new value was checked byte-equal to the same step-4 build with the dichromatism term removed:

  | build | old (819be67) | new (step 4) |
  |---|---|---|
| giraffe/female-1 | 4c475ff4f63f4581 | 0a2d66732ebef180 |
| giraffe/female-0.5 | 3593f7465e4fa7ba | 17897264bdbb6715 |
| giraffe/none | 94ebfe01f884a182 | 49f55d0163213cd1 |
| giraffe/male-0 | 94ebfe01f884a182 | 49f55d0163213cd1 |
| ostrich/female-1 | f60416d30e536778 | 28124ff34972dd02 |
| ostrich/female-0.5 | f60416d30e536778 | 28124ff34972dd02 |
| ostrich/none | f60416d30e536778 | 28124ff34972dd02 |
| ostrich/male-0 | f60416d30e536778 | 28124ff34972dd02 |
| ape/female-1 | 91f9f64c0ed4ccf3 | f7cbbab79d014305 |
| ape/female-0.5 | 91f9f64c0ed4ccf3 | f7cbbab79d014305 |
| ape/none | 91f9f64c0ed4ccf3 | f7cbbab79d014305 |
| ape/male-0 | 91f9f64c0ed4ccf3 | f7cbbab79d014305 |
| shelled-giraffe-bird/female-1 | c0d118cfb3cf59b9 | 886d6140940b487b |
| shelled-giraffe-bird/female-0.5 | c0d118cfb3cf59b9 | 886d6140940b487b |
| shelled-giraffe-bird/none | c0d118cfb3cf59b9 | 886d6140940b487b |
| shelled-giraffe-bird/male-0 | c0d118cfb3cf59b9 | 886d6140940b487b |
| trunked-centipede/female-1 | 27e370cf20970ee1 | 7f51c8e62852ee07 |
| trunked-centipede/female-0.5 | 27e370cf20970ee1 | 7f51c8e62852ee07 |
| trunked-centipede/none | 27e370cf20970ee1 | 7f51c8e62852ee07 |
| trunked-centipede/male-0 | 27e370cf20970ee1 | 7f51c8e62852ee07 |

### Step 5: neck-to-head crease (optional): not done

The step-4 blend fix already removed the fold at the top of the neck-to-head seam (giraffe, cat, ostrich and the
other 11 skin-4 links that unfold). A separate crease pass was not started; step 7's Luna asks on the seam line are the
check.

### Step 6: re-pins (old -> new ledger)

- **Fixtures.** New `tests/fixtures/composer-skin5-links.json` (schema composer-skin5-links-1): the 28 skin-4 link texts
  under the current eye rules at fauna-composer-skin-5 / eye-2; every entry records its skin-4 pin (`skin4`,
  `gloss4`) and, if it moved, `skin5Drift`. 12 of 28 drift (11 blend, 1 trunk); 16 build their skin-4 pin byte for byte.
  `composer-skin4-links.json` is unchanged history. `composer-skin3-links.json` (the earlier eye rules) and
  `composer-eye-catalogue-links.json` were repinned in place (`repinnedAtSkin5`; each drifted entry keeps every
  history field and adds `skinPreSkin5`, `glossPreSkin5`, `verticesPreSkin5`, `trianglesPreSkin5`, `skin5Drift`):
  12 / 28 and 11 / 30; the catalogue's skin-4 capture is kept in `capturedAtSkin4`.
- **Causes are checked, not just recorded.** `debug.blendUnfolded` (new) says whether a build turned its blend rings;
  the tests require `skin5Drift` to name the blend exactly when it is set and the trunk exactly when the graph has a
  trunk, and every drifted entry to differ from the pin it replaces. Cross-check: with the blend fix switched off
  (scratch build), only the one trunk entry still drifts in each set (0 of 30 catalogue links).
- **Tests updated.** fauna-composer-skin4-links.test.mjs: skin-4 fixture kept as history (its `skin3` field is
  compared with `skinPreSkin5` where a skin-3 pin was repinned); new skin-5 fixture test; the byte-for-byte build
  test now builds the skin-5 pins; the catalogue test checks `skin5Drift`. fauna-composer-individual.test.mjs: the
  skin-3 legacy test checks the skin-5 repins like the EC4 ones.
- **Unchanged:** composer-baseline-v2 / v3 (their tests pass), the face specimens, composer-v1/skin2 links.
- **creature-core-exports.json:** + `composerSeamNormals`, `TRUNK_JOIN_LEAD`, `TRUNK_RESPACE_TURN`,
  `TRUNK_RESPACE_TAPER` (step 4; step 2 added 13).
- **Export test V1_PINS** (owned by R2, not touched): the composer core hash moved in step 2, so the test reports
  "v1 byte pins not applicable" and returns; the GLBs also carry the new seam normals. Needs a re-key by its owner.
- **Gate.** tsc 0; suite 212 tests: 210 pass, 2 skip (atlas parity, no ATLAS_DIR), 0 fail. composer-identity digest
  -> f255c404... (`v1Pins`, `skin4Links`, `eyeCatalogue` as at step 4; `sourceHash` and `cli` move with the source).
- **Ledger** (sha256 prefixes):

  skin-5 links (current eye rules; skin-4 pin -> skin-5 pin):

  | text (layout/head/seed) | skin-4 | skin-5 | cause |
  |---|---|---|---|
  | quadruped/muzzle/seed 37 | 27a1fcf1a8fa | 82ba8bd606e3 | blend |
  | biped/beak/seed 88 | 7e54707dd3cc | 5c77013ff28d | blend |
  | biped/flat-face/seed 143 | ec0ecfd09b0c | 9f7f9e88caf4 | blend |
  | biped/beak/seed 2718 | 43892194b12e | 07041247551f | blend |
  | many-legged/muzzle/seed 3141 | 4d01dd21b26c | 889ac842b59a | trunk |
  | biped/jaws/seed 4922 | d1d3a069c5c6 | e7657e9153d5 | blend |
  | quadruped/blunt/seed 7350 | 82d5b843221a | e02a3791899b | blend |
  | biped/muzzle/seed 2066 | 2fcaf311e23c | a79d58beb60a | blend |
  | biped/muzzle/seed 3620 | 67c46b9e6c79 | b9febb2c11c9 | blend |
  | quadruped/blunt/seed 9819 | 1cd2085951d3 | 962abd763b19 | blend |
  | biped/blunt/seed 6480 | 0ca2271afbf8 | a8f8a8905c6c | blend |
  | quadruped/jaws/seed 4636 | 26b34c9c6d1a | 1c75c8890a92 | blend |

  skin-3 links under the earlier eye rules (repinned in place):

  | text (layout/head/seed) | before | after | cause |
  |---|---|---|---|
  | quadruped/muzzle/seed 37 | a27f90f81d84 | ef0130e42be1 | blend |
  | biped/beak/seed 88 | 9d213669acd8 | 3042c95803af | blend |
  | biped/flat-face/seed 143 | dd5952bdeb36 | fc6f91fe318f | blend |
  | biped/beak/seed 2718 | 541dfe8bceed | 9f776afd4a2d | blend |
  | many-legged/muzzle/seed 3141 | a98d37fb711b | 2ac030b4d3e6 | trunk |
  | biped/jaws/seed 4922 | e718d8531595 | 9a2f9dae30e0 | blend |
  | quadruped/blunt/seed 7350 | ce82030ba9d3 | 355808bc52f9 | blend |
  | biped/muzzle/seed 2066 | c79104779676 | c7dfdd6fe330 | blend |
  | biped/muzzle/seed 3620 | ccf036160932 | 75dca1d72e11 | blend |
  | quadruped/blunt/seed 9819 | 08c5f7f56cde | a259e1b386de | blend |
  | biped/blunt/seed 6480 | 30ad288d8fd6 | 7d2841d89cc1 | blend |
  | quadruped/jaws/seed 4636 | d5bac2f2322d | 5797bd0a195c | blend |

  eye-catalogue links (repinned in place):

  | specimen | before | after | cause |
  |---|---|---|---|
  | cat-cat-carnivore | c38f63e20ca2 | 2255f305dc36 | blend |
  | cat-sclera-ape | 151b12bdead4 | 11ebc8fee6c8 | blend |
  | cat-nocturnal-primate | 1be0e3825c71 | 2f7a7d5db2eb | blend |
  | cat-cephalopod-ape | ceb71a2f9b25 | 2576bc2c1440 | blend |
  | odd-cephalopod-horse | 347e50e935b7 | b8fbfa755521 | blend |
  | odd-eyespot-giraffe | 3f36910fc815 | be204b805a3a | blend |
  | odd-wild-33 | 1d5ff254147c | 677833cd07af | blend |
  | upgrade-v3-eyespot-giraffe | 3f36910fc815 | be204b805a3a | blend |
  | upgrade-before-eyespot-giraffe | 0a15c6abc960 | 7ddde9a5166c | blend |
  | upgrade-v3-compound-giraffe | dcd3f3190adf | 33425888f6ec | blend |
  | upgrade-before-compound-giraffe | 0a15c6abc960 | 7ddde9a5166c | blend |
