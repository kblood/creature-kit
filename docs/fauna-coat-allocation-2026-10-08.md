# Coat allocation repair (PERF-ALLOC-AUDIT)

The recovered `kit/coat-alloc` change replaces boxed module scalar scratch with
Uint32Array/Float64Array slots, moves double-valued noise arguments/results through
typed scratch, and inlines small smoothstep/mix helpers on the hot colour path.
Both coat evaluators share that path; exported functions and fauna-coat-1 values
stay unchanged.

Measured on Node v24.7.0 with `tests/fauna-coat-allocation.bench.mjs`, 3 million
calls after three warmup passes, every pattern and canonical body samples, all
marks enabled. GCProfiler counts bytes reclaimed during the loop plus positive
heap growth. Its independent no-op control uses the same loop shape.

| source | coat B/call | control B/call | GC events |
|---|---:|---:|---:|
| aa89701 | 1947.38 | 0.149 | 2643 |
| repaired | 0.027 | 0.155 | 0 |

The benchmark gates coat below 20 B/call and control below 1 B/call. Strict zero
remains a goal. Running it with `--root ../../creature-kit` on aa89701 fails the
coat gate, proving it catches the previous allocation despite mid-loop GCs.

Validation: 2,640,000 Object.is comparisons against aa89701 over all twelve
patterns, 20 seeds, 1000 varying samples, all regions, marks, three entry points
(evaluateCoat, evaluateCoatWithMask, coatPatternProbe): zero differences. The
lineage-B pinned guard passes unchanged, as do TypeScript checks. The old
source-copy assertion is removed because the two entry points now share code;
their Object.is output test stays. Export byte pins now run unconditionally
instead of being bypassed whenever a generator source hash changes; V1_PINS
values are unchanged.
