# FAUNA-NUDGE-STABLE-2 diagnosis

Recorded before production code edits. On kit c8d1f94 the six-mode nudge corpus
contains five known unstable specimens. Diagnostic copies of the mesh capture
mouth surface hits and the camera-eye contrast calculation.

Mouth: skin5-link-14's midline ray (y=-0.006841006490881241, z=0) switches between
cap triangles 48/49. They have equal depth (~0.0374600909139364 m) and opposite
normal.z (+/-0.0184691224171759). Lifting by the selected facet normal gives the
reported +/-8.8e-6 m lateral movement. Links 22/23 have the same seam cause.
The earlier-rules worm disc's centre ray (y=z=0) hits the cap apex shared by
many triangles. Base chooses 26, all-positive nudge 37, negative 24, alternating
23/22: depths differ below 1e-16 m, but their normals differ. Ring points at
y~1.5e-18 also switch the top/bottom facets (308/351). Thus a z-only snap cannot
fix its x/y shifts: shared-edge/apex ties need a deterministic normal as well.

Cephalopod: no sampled eye surface triangle changes. The boosted iris is meant
to equal the lid contrast floor, but after multiplication its luminance is
0.4350648745777327 and the floor is 0.43506487457773274. Strict `<` applies the
extra 0.999 lid factor (0.3496499999999999). A positive nudge makes both exactly
0.4350648745777297 and keeps factor 0.35. This changes 246 lid/socket RGB floats,
maximum 0.0002803206443786621 in this diagnostic build. The cause is cancellation
at a mathematically equal luminance floor, not an eye-seat threshold or argmin.

Proposed rules: mouth shared-crossing ties resolved by a stable triangle index,
with exact mirror-plane coordinates where a generated mouth point is on that
plane; contrast-floor equality treated within a small relative tolerance. The
full identity/V1/golden survey must show precisely which specimens change before
any pins are updated.

## Implemented rules and compatibility

Mouth crossings within 1e-9 m of the first forward hit choose the lowest triangle
index. Mouth coordinates within 1e-12 head lengths of the mirror plane are
snapped to z=0; on that plane the normal lift has no lateral component. The
cap-apex tie also uses the index rule, so the older non-neutral worm disc no
longer changes x/y. Neutral earlier-rule links keep their original projection:
their skin-3 geometry is explicitly frozen, and the legacy neutral guard verifies
all 28 historical pins. The measured earlier-rule worm is non-neutral and uses
the correction. This preserves the supported neutral compatibility path; it
does not claim that every historical neutral link is nudge-stable.

Cephalopod catalogue eyes treat a relative luminance deficit below 1e-12 as
equality, leaving the base lid factor. The tolerance is family-scoped because a
generic contrast change moved two unrelated muzzle links (10/15). Those profiles
and the legacy eye builder keep their existing contrast computation. Their
unchanged pins are verified by the full composer identity report and fixture
tests. The cephalopod's observed rounding discrepancy is only ~1e-16 relative,
well below the tolerance; genuine deficient iris brightness retains darkening.

## Old to new skin ledger

No gloss, count, bone, V1 GLB or CLI GLB changes. The five revised skins carry
`skinPreNudgeStable2` and `nudgeStable2Drift`; every other fixture stays pinned.

| specimen | old SHA prefix | new SHA prefix | correction |
|---|---|---|---|
| skin5-link-14 | e02a3791899ba009 | 797c21573eb5fa49 | mouth |
| skin5-link-22 | 962abd763b19c88b | 1535f877243413c9 | mouth |
| skin5-link-23 | a8f8a8905c6cf9f8 | c4912b12a18cb5eb | mouth |
| odd-earlier-rules-worm | 2eaec782dce02009 | 17db35c53dcd0a69 | mouth |
| odd-cephalopod-horse | b8fbfa7555219e30 | 329dc5ed29ea909e | lid/socket colour |

Validation (shared test slots): TypeScript 0; targeted nudge/fixture/head/coat
suite 46/46; historic neutral guard and unconditional V1 byte pins 2/2.
`NUDGE_UNSTABLE_KNOWN` is empty and the whole 74-specimen, six-mode corpus passes.
The lineage-B fixture and V1_PINS are untouched. Full identity against aa89701
changes exactly the five skins above. All 32 CLI GLBs remain identical; their
32 sidecars change only because they embed the generator source hash.
Evidence is preserved in `Assets/_assetctl/kit-nudge-evidence/` in the shared
IWSDK workspace (diagnostic captures, full identity reports and their ledger).

The Atlas sync adds odd-earlier-rules-worm and odd-cephalopod-horse to the golden
fauna corpus. Its four-engine gate and proposed fauna re-pin are still required
before integration; no engine mismatch exception is added.
