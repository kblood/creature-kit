# Animal Lab population benchmarks

Open **Benchmark this animal / populations** under the Animal Lab's group
control, or open `benchmark.html` directly. The editor transfers the selected
recipe or complete original planetary definition, including phenotype and IDs.
The benchmark links back to that editor specimen.

Choose 16, 64, 128 or 256 animals. **Repeated selected animal** creates instances
of the exact specimen; **Mixed collection** repeats six different Composer
species. These are repeated specimens, not newly generated individual genomes.
Distance groups start at 10, 80 and 220 metres from the observer camera, with
additional rows behind each group. Orbit freely or choose the overview camera.
Auto LOD uses actual camera distance, the Atlas 35/140 metre boundaries and
10% hysteresis, with a 600 metre visibility limit. Forced LOD is useful for
stress comparisons. Counts and triangles are shown in the scene summary.

Live switches:

- Animated instancing uses the **same `FaunaComposerInstanceBatch` and palette
  writer as Atlas**, now maintained in creature-kit. Only identical geometry,
  LOD and appearance share a batch. Different species retain separate batches.
- With instancing off, sharing geometry reduces duplicate geometry buffers;
  it preserves separate draws and skeletons.
- Shared pose calculation reduces solver work and palette rows by synchronizing
  repeated animals of the same specimen. With it off each member has its own
  deterministic time offset.
- Pose updates can run every frame, every second frame or every fourth frame.
- Frustum culling skips animals outside a conservative animated bounding sphere.
  When shadows are enabled, off-camera casters retain animation and submission
  so their shadows are not accidentally removed.
- Shadows and animation can be enabled independently.

## Measurement

Runs include a two-second warm-up followed by 5, 10 or 30 seconds of samples.
Source generation, LOD preparation and mesh setup happen before warm-up; their
last preparation wall time is recorded separately. Sources and LODs remain in
a bounded cache of the selected specimen and six predefined mixed specimens.

Frame intervals are measured from requestAnimationFrame and include display
pacing. CPU time covers update and renderer submission; it does not measure GPU
completion. GPU measurements use asynchronous WebGL2 timer queries when the
browser supports them. Disjoint results are discarded; unsupported GPU timing
is reported as unavailable. Queries are bounded and never force a GPU finish or
framebuffer readback during sampling. JSON includes sample counts, mean, median,
p95, p99, draw calls, triangles, visible animals, solver calls, camera, actual
LOD triangle counts, specimen definitions, browser/GPU and canvas resolution.
The export also records the creature-kit commit, package version and dirty state
embedded by the build, so different software revisions can be distinguished.
Memory values cover retained geometry arrays and pose/instance buffers; they
exclude JS object overhead and complete driver/browser memory.

**Compare instancing on / off** records the same population, camera, settings
and starting simulation clock, first with separate meshes and then with
instancing. Each run warms up independently. Camera and settings are locked
while measuring. Cancellation, hiding the page or resizing invalidates a run;
partial runs are never presented as completed results. Export JSON to retain
results and context. The latest 32 results are retained. The order is fixed, so thermal and background-task effects
can still influence a pair; repeat runs before drawing conclusions.

The Lab measures animal rendering in a reference scene with a ground plane.
It does not reproduce Atlas's terrain, clouds, source-admission budgets, merged
packed middle/far arenas or whole-world frame workload. Instancing comparisons
are real shared-code comparisons, not a claim of overall Atlas or Quest FPS.
