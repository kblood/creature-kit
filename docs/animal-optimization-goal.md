# Animal rendering optimization goal — 2026-10-12

Status: active development. This checkpoint is not the completed five-part
release. Native applications and WASM remain separate possible work.

## Required outcome

1. Partial uploads of changed skeleton data, including initialization, deferred
   rendering, palette growth and context restoration.
2. Distance-dependent animation sampling with interpolation. Preserve exact near
   poses, discard stale samples on context/date/terrain/activity discontinuities,
   and verify visible continuity and terrain contact at the actual viewing scale.
3. Cheaper far animation, using fewer active bone transforms or a verified
   equivalent. Keep the original source graph, skin ancestry and individual IDs.
4. Reuse working buffers and objects to reduce transient allocations; measure
   allocation behavior in addition to frame CPU/GPU time.
5. Distance-dependent animal shadows, preserving nearby contact shadows and
   correct off-camera shadow participation. Test shadow transitions and costs.

The Animal Lab must use the actual Atlas controller and packed GPU arenas for
the relevant comparisons. Each option needs measurable counters and a reference
path. Commit and sync the shared Kit into Atlas, then publish only after the
combined correctness, lifecycle, memory and ordinary-world tests pass. Desktop
measurements must not be presented as physical Quest measurements.

## Current evidence

- `ComposerPaletteUploads` pools pending RGBA ranges per row and initializes new
  GPU storage fully. Deferred frames do not lose earlier changes. Renderer
  diagnostics distinguish newly queued bytes from actual upload notifications.
- Native WebGL instrumentation measured 65,536 versus 1,280 palette bytes for
  one changed animal in both instance and packed-far paths. Final pixels and
  accumulated deferred-change pixels were identical. A real context-loss and
  restore test also preserved pixels when CPU palette width remained unchanged.
- The Lab can select the actual Atlas renderer, its production arena budgets,
  camera-prefix behavior and source-admission policy. Its partial/full comparison
  holds the source collection, camera and starting simulation clock constant.
- One desktop D3D11 pair with 64 mixed specimens measured 2,621,440 versus
  132,864 mean palette-upload bytes/frame and GPU medians 2.290 versus 0.880 ms.
  This is a five-second reference-scene result, not a whole-world performance
  claim. CPU medians were about 1.4 ms in both runs.
- Per-bone validation/output arrays and per-frame row/key collection allocations
  were removed; group arrays and row masks are reused. Original quick identity
  corpora (`v1Pins`, `skin4Links`, `eyeCatalogue`) remained equal. Allocation
  sampling and combined-world measurements are still required.
- A shared-source scheduling bug found by the real renderer benchmark was fixed:
  an already-loaded near tier no longer prevents missing middle-tier construction
  for other members of the same source. A regression test verifies the far,
  near, middle job sequence and stable completed state.

## Outstanding

Implement and verify items 2, 3 and 5. Extend the shared controls and counters
accordingly. Complete allocation profiling for item 4, repeat the paired tests
after all features are combined, validate normal planetary visits and resource
lifetimes, then integrate into main and publish. Until those gates pass, keep the
goal active and the current public release unchanged.

Evidence root in IWSDK: `Assets/_assetctl/animal-optimizations-20261012/`.
