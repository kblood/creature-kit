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
  dimorphism-1 value (lowest ratio 0.54, giraffe); dimorphism 0 exactly 0 with bitwise-equal colour arrays. Female,
  sexless (type specimen) and dimorphism-0 male colour arrays of all 12 presets are byte-identical to 819be67 (48
  digests pinned); negative control: the dimorphism-1 male giraffe differs from its pinned female.
- **Before** (section 1): 0.40 .. 1.63 at dimorphism 1, under the just-noticeable difference.
