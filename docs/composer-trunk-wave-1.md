# Optional Composer trunk wave

`wave-1` is a bounded motion experiment for the existing six-bone proboscis. It
reduces nose-base rotation and introduces phased distal curling. It is independent
of skin presentation: selecting `realism-1` alone retains legacy motion.

```ts
poseComposer(graph, 'walk', time, {trunkMotion: 'wave-1'});
createComposerCreature(recipe, {presentation: 'realism-1', trunkMotion: 'wave-1'});
exportCreatureGlb(recipe, {presentation: 'realism-1', trunkMotion: 'wave-1'});
```

The option is `ComposerPoseOptions.trunkMotion?: 'legacy' | 'wave-1'`. Omitted or
explicit legacy options preserve previous poses and GLB bytes. Neutral poses,
non-trunk bones, and creatures without a trunk remain exact. Recipe meanings,
graph4, skin5 defaults, oscillation periods, and the ground solver are unchanged.
`COMPOSER_TRUNK_MOTION_VERSION` is `fauna-composer-trunk-motion-1`; exports record
`versions.trunkMotion` only when a trunk and a non-neutral clip use the option.
The factory captures options when constructed. Clip search and both raw and
crossfaded baking receive the same selected motion options.

Evidence is under `Assets/_assetctl/composer-realism-20261011/` in the IWSDK
workspace. `trunk-wave-review/` contains 48 paired six-frame strips: two fixtures,
three motions, two views, and full/8000/3000/1000 detail. Each strip shows legacy
motion above wave motion on identical skin6 geometry. `trunk-pass2-metrics.json`
measures 361 poses per motion and fixture, actual deformed mesh tip displacement
in head space, root rotation, ground clearance, and solver correction. Seven
sampled frames also measure join-face orientation and edge stretch.

| Fixture | Motion | Tip RMS ratio, wave/legacy | Clearance correction count, legacy → wave |
| --- | --- | ---: | ---: |
| Trunked centipede | idle | 0.954 | 45 → 46 |
| Trunked centipede | walk | 0.924 | 0 → 0 |
| Trunked centipede | display | 0.743 | 0 → 0 |
| Quadruped proboscis | idle | 0.803 | 244 → 247 |
| Quadruped proboscis | walk | 0.776 | 172 → 88 |
| Quadruped proboscis | display | 1.034 | 0 → 0 |

Root rotation is 12.1–18.8% of legacy. The sampled join-face inversion proxy
(face cross product versus the weighted rotated bind normal, excluding internal
hidden faces) falls to zero, and maximum join-edge stretch improves for all six
comparisons. All
sampled trunk surfaces clear the floor; maximum solver lift does not increase.
Minimum clearance does decrease slightly in some comparisons, including
quadruped idle from 58.17 to 57.32 mm. These checks are deformation observations,
not a manifold guarantee or physical-device qualification.

The full-source review shows a quieter attachment and more progressive curl.
However, three excursion ratios miss the preferred 85–115% band, and both idle
correction counts increase slightly. The experiment therefore remains opt-in.
The 1000-triangle trunk is visibly degraded in both motion variants, with a
spear-like silhouette and tiny separated tip faces; this motion change does not
qualify that geometry tier. No additional mesh or reducer changes are included.

Unchanged periods do not imply unchanged exported clip windows. At 12 fps, the
trunked-centipede search finds wave idle 3.70125 s (raw seam 34.80 mm / 0.3453 rad),
walk 0.731778655 s (roundoff-only seam), and display 7.316875 s (32.67 mm /
0.2238 rad). Optional seamless idle/display baking closes endpoint keys exactly;
raw clips accurately retain and report their measured seam. Focused tests cover
legacy bytes, actual selected quaternion/translation keys, version metadata,
deformation metrics, and crossfaded endpoints.
