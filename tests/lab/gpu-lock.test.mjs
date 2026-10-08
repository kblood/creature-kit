// tests/helpers/gpu-lock.mjs against a throw-away lock directory (never the real C:/LLM/IWSDK/.gpu-browser-lock).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'kit-gpu-lock-'));
process.env.ATLAS_GPU_LOCK_DIR = join(root, '.gpu-browser-lock');
// This file itself runs inside Atlas's test slot (README: CPU tests go through test-slot.mjs), so the inherited slot token
// is set aside here; the lock-order tests below set it explicitly.
const savedToken = process.env.ATLAS_TEST_SLOT_TOKEN; delete process.env.ATLAS_TEST_SLOT_TOKEN;
const {GPU_LOCK_DIR, acquireGpuLock, withGpuLock} = await import('../helpers/gpu-lock.mjs');
test.after(() => { rmSync(root, {recursive: true, force: true}); if (savedToken !== undefined) process.env.ATLAS_TEST_SLOT_TOKEN = savedToken; });
const quiet = () => {};

test('the default lock directory is the machine-wide one Atlas uses', async () => {
  const text = readFileSync(new URL('../helpers/gpu-lock.mjs', import.meta.url), 'utf8');
  assert.match(text, /process\.env\.ATLAS_GPU_LOCK_DIR \|\| 'C:\/LLM\/IWSDK\/\.gpu-browser-lock'/);
  assert.equal(GPU_LOCK_DIR, process.env.ATLAS_GPU_LOCK_DIR);
});

test('acquire writes owner.txt and publishes ATLAS_GPU_LOCK_HELD; a second holder waits and times out; release frees it', async () => {
  const before = process.env.ATLAS_GPU_LOCK_HELD;
  const lock = await acquireGpuLock({owner: 'kit-test-a', log: quiet});
  assert.ok(existsSync(GPU_LOCK_DIR));
  assert.match(readFileSync(join(GPU_LOCK_DIR, 'owner.txt'), 'utf8'), /^kit-test-a pid=\d+/);
  assert.equal(process.env.ATLAS_GPU_LOCK_HELD, lock.owner);
  await assert.rejects(acquireGpuLock({owner: 'kit-test-b', retryMs: 50, timeoutMs: 200, staleMs: Infinity, log: quiet}), /still held .* by: kit-test-a/);
  await lock.release();
  assert.equal(existsSync(GPU_LOCK_DIR), false);
  assert.equal(process.env.ATLAS_GPU_LOCK_HELD, before);
});

test('withGpuLock releases on failure', async () => {
  await assert.rejects(withGpuLock({owner: 'kit-test-c', log: quiet}, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(GPU_LOCK_DIR), false);
});

test('a stale lock is taken over only when no browser runs', async () => {
  const leaked = await acquireGpuLock({owner: 'kit-test-leaked', log: quiet});
  const old = new Date(Date.now() - 3600_000); utimesSync(join(GPU_LOCK_DIR, 'owner.txt'), old, old);
  await assert.rejects(acquireGpuLock({owner: 'kit-test-d', retryMs: 50, timeoutMs: 200, staleMs: 60_000, listBrowsers: async () => ['1 chrome'], log: quiet}), /still held/);
  const taken = await acquireGpuLock({owner: 'kit-test-e', retryMs: 50, timeoutMs: 2000, staleMs: 60_000, listBrowsers: async () => [], log: quiet});
  assert.match(readFileSync(join(GPU_LOCK_DIR, 'owner.txt'), 'utf8'), /^kit-test-e/);
  await leaked.release(); // not the owner any more: must not remove the new holder's lock
  assert.ok(existsSync(GPU_LOCK_DIR));
  await taken.release();
  assert.equal(existsSync(GPU_LOCK_DIR), false);
});

test('lock order (I8): a capture is refused while this process holds the test slot or inherited ATLAS_TEST_SLOT_TOKEN', async () => {
  const held = globalThis[Symbol.for('atlas.test-slot.held')] ??= [];
  held.push({token: 'kit-test-slot'});
  try {
    await assert.rejects(acquireGpuLock({owner: 'kit-capture', log: quiet}), /capture path "kit-capture" .*holding the test slot \(this process\)/);
  } finally { held.pop(); }
  process.env.ATLAS_TEST_SLOT_TOKEN = '00000000-0000-4000-8000-000000000000';
  try {
    await assert.rejects(acquireGpuLock({owner: 'kit-capture', log: quiet}), /ATLAS_TEST_SLOT_TOKEN inherited/);
    const nonCapture = await acquireGpuLock({owner: 'kit-non-capture', capture: false, log: quiet});
    await nonCapture.release();
  } finally { delete process.env.ATLAS_TEST_SLOT_TOKEN; }
  assert.equal(existsSync(GPU_LOCK_DIR), false, 'a refused capture never creates the lock directory');
  const ok = await acquireGpuLock({owner: 'kit-capture', log: quiet});
  await ok.release();
});

test('lock order: the GPU lock is refused while this process has a test-slot wait pending, capture or not', async () => {
  const pending = globalThis[Symbol.for('atlas.test-slot.pending')] ??= {waits: 0, owners: []};
  pending.waits++; pending.owners.push('kit-slot-waiter');
  try {
    await assert.rejects(acquireGpuLock({owner: 'kit-gpu', capture: false, log: quiet}), /still waiting for the test slot \(kit-slot-waiter\)/);
  } finally { pending.waits--; pending.owners.pop(); }
  assert.equal(existsSync(GPU_LOCK_DIR), false);
});

test('the GPU wait and hold are published on globalThis atlas.gpu-lock.state for Atlas test-slot.mjs', async () => {
  const state = globalThis[Symbol.for('atlas.gpu-lock.state')];
  assert.deepEqual({waiting: state.waiting, held: state.held}, {waiting: 0, held: 0});
  const lock = await acquireGpuLock({owner: 'kit-state', log: quiet});
  assert.equal(state.held, 1); assert.equal(state.owners.at(-1), lock.owner);
  await lock.release();
  assert.equal(state.held, 0); assert.equal(state.owners.length, 0);
});
