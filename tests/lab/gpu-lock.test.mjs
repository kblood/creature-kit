// tests/helpers/gpu-lock.mjs against a throw-away lock directory (never the real C:/LLM/IWSDK/.gpu-browser-lock).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'kit-gpu-lock-'));
process.env.ATLAS_GPU_LOCK_DIR = join(root, '.gpu-browser-lock');
const {GPU_LOCK_DIR, acquireGpuLock, withGpuLock} = await import('../helpers/gpu-lock.mjs');
test.after(() => rmSync(root, {recursive: true, force: true}));
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
