// GC-counted coat allocation regression. Run with node --expose-gc; --root also
// measures an older source tree without changing fixtures or overwriting sources.
import v8 from 'node:v8';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const rootAt = process.argv.indexOf('--root');
const root = rootAt < 0 ? new URL('../', import.meta.url) : pathToFileURL(resolve(process.argv[rootAt + 1]) + '/');
const F = await import(new URL('src/fauna-coat-fields.ts', root));
assert.ok(globalThis.gc, 'run with --expose-gc');
const patterns = ['plain', 'spots', 'rosettes', 'reticulated', 'stripes', 'bands', 'saddle', 'dorsal-stripe', 'dapple', 'piebald', 'roan', 'brindle'];
const genomes = patterns.map(pattern => F.defaultCoatGenome('fawn', 400, {pattern, marks: 255, juvenileSpots: 0.8, greying: 0.6}));
const samples = F.coatCanonicalSamples(), out = new Float64Array(3), acc = new Float64Array(1);
const N = 3000000;
function control(_g, s, o) { o[0] = s.x * 0.125 + 0.5; o[1] = s.y; o[2] = s.z; }
// Each callback has its own monomorphic call site. No numeric closure writes.
const run = () => { for (let i = 0; i < N; i++) { F.evaluateCoat(genomes[i % genomes.length], samples[i % samples.length], out); acc[0] += out[0]; } };
const runControl = () => { for (let i = 0; i < N; i++) { control(genomes[i % genomes.length], samples[i % samples.length], out); acc[0] += out[0]; } };
function measure(fn) {
  for (let i = 0; i < 3; i++) fn();
  gc(); gc();
  const heap0 = process.memoryUsage().heapUsed, profiler = new v8.GCProfiler();
  profiler.start(); fn();
  const profile = profiler.stop(), heap1 = process.memoryUsage().heapUsed;
  assert.ok(Array.isArray(profile?.statistics), 'GCProfiler did not return a statistics array');
  const stats = profile.statistics;
  let freed = 0;
  for (const st of stats) {
    const before = st.beforeGC?.heapStatistics?.usedHeapSize, after = st.afterGC?.heapStatistics?.usedHeapSize;
    assert.ok(Number.isFinite(before) && Number.isFinite(after), 'GC event lacks finite before/after usedHeapSize');
    freed += Math.max(0, before - after);
  }
  return {calls: N, gcEvents: stats.length, heapGrowthBytes: heap1 - heap0, freedByGcBytes: freed, bytesPerCall: (Math.max(0, heap1 - heap0) + freed) / N};
}
const result = {node: process.version, control: measure(runControl), coat: measure(run)};
console.log(JSON.stringify(result, null, 2));
assert.ok(result.control.bytesPerCall < 1, 'no-op control must stay below 1 B/call or the measurement is invalid');
assert.ok(result.coat.bytesPerCall < 20, 'coat must stay below 20 B/call (strict zero remains a goal)');

