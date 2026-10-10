# Composer realism-1 feet

This is an additive presentation of the advanced multi-layout Composer. It uses
the existing recipe v4, individual derivation and graph4 skeleton. It does not
call the planetary quadruped generator.

```ts
createComposerCreature(recipe, {presentation: 'realism-1'});
buildComposerSkin(graph, {presentation: 'realism-1'});
exportCreatureGlb(recipe, {presentation: 'realism-1', lods: ['full', 8000, 3000, 1000]});
```

The resulting skin version is `fauna-composer-skin-6`, exported as
`COMPOSER_REALISM_SKIN_VERSION`. Omitted presentation or `skin-5` retains the
historical skin5 output. Recipe text, species identity, individual traits, graph
and pose arrays are unchanged. The application can select realism-1 after its
visual acceptance without migrating recipe URLs or changing historical fixtures.

Pad, hoof and claw feet continue the terminal leg ring, with identical boundary
positions, skin influences and coat samples. The foot loft shapes a heel, instep,
sloped toe and planar sole. Pad nails sit into the toe wall. Clawed feet gain
broader, tapered digits with small knuckles and separate keratin tips. Other feet,
head, torso, trunk, arms, wings and limbless bodies retain their existing geometry.

The optional `composerFootLodConstraints(skin)` preserves sole and ankle extrema
and the supporting leg joint regions. Use it when reducing skin6 directly; the
GLB exporter applies it automatically for realism-1 and records
`versions.lodFeet = fauna-composer-foot-lod-1`. Historical skin5 exports use the
unchanged reducer options and keep their bytes. Constraints are explicit because
joining the foot removes the separate component that previously resisted collapse.
They may make an extremely small requested tier unreachable; the exporter fails
that budget rather than silently discarding the protected anatomy.

Evidence is preserved under
`Assets/_assetctl/composer-realism-20261011/` in the IWSDK workspace:

- `brief.json`: validated asset brief, owned source, UNLICENSED, no checkpoint.
- `feet-pass2/`: 72 paired images, same recipe, camera, pose and lighting; all12
  presets at adult/young maturity in neutral and actual walking poses, plus foot
  close-ups. Its LOD images are a rejected intermediate constraint pass.
- `feet-lod-pass3/`: final 18 paired LOD images at8000/3000/1000 triangles.
- `feet-artifacts/`: deterministic recipe/source/resource manifest and two
  animated desktop GLBs with export reports and assetctl package sidecars.

Validation: typecheck and build;24 historical skin/eye/gait/stability tests;32
realism/export/LOD tests. The new grounding test checks6076 posed foot observations,
including2180 swing observations. Modified stance soles have maximum gap below
3e-16m and no penetration beyond floating-point roundoff. Unmodified hand/spike
feet retain a pre-existing maximum13.2mm gap, separately reported. Reduced foot
surfaces are checked across12 gait samples per tier. A complete ankle boundary
shares position and influence signatures between the leg and foot.

Adult dinosaur source triangles change16032→16568; rhinoceros17684→17348;
giraffe15468→14604. The source resource manifest includes actual buffer byte counts
for all12 presets and two maturities. This is not a performance benchmark.

Six reviewed morphology samples reach all three requested LOD tiers. A24-legged
proboscis stress recipe reaches7998/3000 triangles but stops at1530 for a1000
target; the export test verifies a machine-readable budget failure. The1000 tiers
remain visibly coarse at close range. Physical Quest acceptance, universal low-tier
budgets, manifold topology and production-ready authored realism are not claimed.
