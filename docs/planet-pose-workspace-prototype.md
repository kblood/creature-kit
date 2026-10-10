# Exact pose workspace experiment

`createQuadrupedPoseWorkspace(plan, member)` owns one canonical plan/member
workspace. Keep the plan, its rest data and member identity immutable. Call
`quadrupedPoseAtInto(workspace, activity, ground, rigSeconds, options)` with the
same exact activity, ground stencil and behaviour used by `quadrupedPoseAt`.
The returned object, arrays, root and foot records are borrowed until the next
call with that workspace. Copy them explicitly when retaining a snapshot.

The original API retains independent output objects and arrays. Both paths use
the same terrain sampling, walking/idle transition equations, head clearance,
two-bone IK and forward kinematics. Dates, revolution speed, activity state,
behaviour and ground values are evaluated anew on every call. The opt-in path
caches only immutable bone rest offsets and member-bound motion traits.

Each workspace owns 1,760 output typed bytes, 66 Vector3 objects, 44 Quaternion
objects, one Euler, four foot records and eight three-number foot tuples. It
also retains container arrays, one output/root record, cached motion traits and
workspace metadata. JavaScript object bytes depend on the engine and are not
included in the typed-byte count. At 128 members the output arrays alone total
225,280 CPU bytes. Source plans are borrowed, not duplicated. The solver still
creates temporary IK vectors, path tuples, schedule/closure objects and other
scratch; this experiment is not a zero-allocation claim.

All reused local quaternions, offsets and world joint records are reset each
call. Date order must not change the result. The tests compare exact numeric
outputs and the full stencil-call sequence on flat ground, slopes and waves,
including walk, feed, alert, idle/resume, adult/juvenile and reversed seeks.
The frozen pre-extraction body/pose corpus remains a separate default-API gate.

This is source-only until exactness and controlled CPU/allocation measurements
pass. It does not select a renderer default, change source animals or approximate
the ground/IK solver.


## Desktop Node measurement

The frozen actual128 census supplied the same individual genotypes to every
variant.240 frames per variant used identical dates, mixed walking/feeding, the
same sloped/wavy ground callback, and rotated measurement order. The unchanged
Kit40dc4b3 and Into outputs match exactly in1,536 comparisons. The frozen f96
corpus and terrain/date-order tests also pass.

| Solver | p50 ms /128 | p95 ms /128 | Observed GC events |
| --- | ---: | ---: | ---: |
| Unchanged Kit40dc4b3 |1.967 |3.155 |104 |
| New independent-output default |1.970 |3.091 |104 |
| Borrowed workspace Into |1.441 |2.457 |57 |
| No-op field update/read control |0.0021 |0.0079 |0 |

GC entries are attributed by start time inside each measured block; explicit
major collections before blocks are excluded. These counts show less pressure,
not zero allocation or an exact allocated-byte total. This is one desktop Node
solver measurement and excludes palette packing, renderer submission, real
terrain sampling, GPU work and whole-game memory. Browser/Quest performance is
unverified. The latest artifact is
`Assets/_assetctl/animal-system-20261010/pose-workspace-bench-report.json` in the
shared IWSDK workspace; it records the exact census hash and matched dates.
Earlier balanced-phase and observer-attribution reports are retained as
preliminary evidence and do not support the final timing claim.
