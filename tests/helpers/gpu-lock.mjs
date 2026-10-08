/** Machine-wide GPU browser lock, the SAME lock every agent on this PC uses: C:/LLM/IWSDK/.gpu-browser-lock (override
 * with ATLAS_GPU_LOCK_DIR, as in universe-atlas). A small version of universe-atlas tests/helpers/gpu-lock.mjs with the
 * same protocol, so a kit browser test and an Atlas browser test exclude each other:
 * - `mkdir` of the lock directory is the atomic acquire; `owner.txt` inside names the holder and is refreshed every minute;
 * - a held lock is waited for, never broken, except a leaked one: owner.txt older than 20 min while no chrome/headless
 *   browser runs (the coordinator rule of 2026-09-29), which is renamed away and logged;
 * - while held, ATLAS_GPU_LOCK_HELD is set for child processes, and while waiting or held the in-process state is on the
 *   globalThis symbol 'atlas.gpu-lock.state', so Atlas's tests/helpers/test-slot.mjs refuses to take the CPU slot inside
 *   a GPU wait or hold (lock order: merge -> slot -> GPU, never GPU -> slot);
 * - lock-order guards ported from Atlas (rule I8: captures do their GPU work OUTSIDE the CPU test slot). Every kit GPU
 *   user is a browser capture, so `capture` defaults to TRUE here (Atlas: opt-in): acquire is refused while this process
 *   holds Atlas's test slot (globalThis 'atlas.test-slot.held') or inherited ATLAS_TEST_SLOT_TOKEN from a slot holder,
 *   i.e. `test-slot.mjs -- npm run test:browser` fails fast instead of holding CPU tokens for the whole capture. It is also
 *   refused while this process has a test-slot wait pending (globalThis 'atlas.test-slot.pending'). The guards read only
 *   env vars and globalThis symbols that Atlas's test-slot.mjs publishes: no Atlas import. `capture: false` keeps the
 *   pending-wait guard and lifts only the slot guard (a non-capture GPU user taking slot -> GPU, as Atlas allows);
 * - released on success, failure, exit and SIGINT/SIGTERM.
 * Acquire immediately before launching a browser and release as soon as that run ends: withGpuLock(options, work). */
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {readFileSync, rmSync} from 'node:fs';
import {hostname, platform} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const GPU_LOCK_DIR = process.env.ATLAS_GPU_LOCK_DIR || 'C:/LLM/IWSDK/.gpu-browser-lock';
export const GPU_LOCK_STALE_MS = Number(process.env.ATLAS_GPU_LOCK_STALE_MS || 20 * 60 * 1000);
const OWNER = `${GPU_LOCK_DIR}/owner.txt`;
/** Same symbol and shape as Atlas's helper, so Atlas's test-slot.mjs sees a GPU wait/hold of this process. */
const STATE = globalThis[Symbol.for('atlas.gpu-lock.state')] ??= {waiting: 0, held: 0, owners: []};
const INHERITED_HELD = process.env.ATLAS_GPU_LOCK_HELD;
function publish() {
  const v = STATE.owners.at(-1) ?? INHERITED_HELD;
  if (v === undefined) delete process.env.ATLAS_GPU_LOCK_HELD; else process.env.ATLAS_GPU_LOCK_HELD = v;
}

/** Refuses a capture path that holds Atlas's test slot (in this process or inherited through ATLAS_TEST_SLOT_TOKEN). */
export function assertCaptureOutsideSlot(owner) {
  const held = globalThis[Symbol.for('atlas.test-slot.held')]?.length > 0;
  if (held || process.env.ATLAS_TEST_SLOT_TOKEN) throw new Error(`lock order: capture path "${owner}" asks for the GPU lock while holding the test slot (${held ? 'this process' : 'ATLAS_TEST_SLOT_TOKEN inherited'}); captures take the GPU lock outside the CPU slot: run the browser tests WITHOUT test-slot.mjs (creature-kit README "Creature Lab app"; Atlas docs/test-policy.md "Lock order")`);
}

/** Refuses the GPU lock while this process still waits for the test slot (lock order merge -> slot -> GPU). */
export function assertNoPendingSlotWait(owner) {
  const p = globalThis[Symbol.for('atlas.test-slot.pending')];
  if (p?.waits > 0) throw new Error(`lock order violation: "${owner}" asks for the GPU lock while this process is still waiting for the test slot (${p.owners.join('; ')}); await or abort the slot wait first: the order is merge -> slot -> GPU`);
}
const lockOwner = async () => { try { return (await readFile(OWNER, 'utf8')).trim(); } catch { return '(no owner.txt)'; } };

/** Chrome / headless-shell processes currently running. */
export async function runningBrowsers() {
  if (platform() !== 'win32') {
    try { const {stdout} = await run('pgrep', ['-l', '-f', 'chrome|headless_shell'], {timeout: 10000}); return stdout.trim().split(/\n/).filter(Boolean); } catch { return []; }
  }
  const {stdout} = await run('powershell', ['-NoProfile', '-Command',
    "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(chrome|chrome-headless-shell|headless_shell|chromium)$' } | ForEach-Object { '{0} {1}' -f $_.Id,$_.ProcessName }"], {timeout: 20000});
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

async function tryBreakStale(staleMs, log, listBrowsers) {
  let info, text = null;
  try { info = await stat(OWNER); text = await readFile(OWNER, 'utf8'); } catch { try { info = await stat(GPU_LOCK_DIR); } catch { return false; } }
  const age = Date.now() - info.mtimeMs;
  if (age < staleMs) return false;
  let browsers; try { browsers = await listBrowsers(); } catch (error) { log(`[gpu-lock] stale check skipped: ${error.message}`); return false; }
  if (browsers.length) { log(`[gpu-lock] owner.txt is ${Math.round(age / 60000)} min old but browsers are running (${browsers.join(', ')}); not breaking`); return false; }
  try { if (text !== null && (await readFile(OWNER, 'utf8')) !== text) return false; } catch { return false; }
  const graveyard = `${GPU_LOCK_DIR}.stale-${Date.now()}-${process.pid}`;
  try { await rename(GPU_LOCK_DIR, graveyard); } catch { return false; }
  log(`[gpu-lock] TOOK OVER stale lock (owner.txt ${Math.round(age / 60000)} min old, no chrome/headless process): ${(text ?? '(no owner.txt)').trim()}`);
  await rm(graveyard, {recursive: true, force: true}).catch(() => {});
  return true;
}

/** Resolves to {release, owner, waitedMs, attempts} once held; retries every `retryMs` until `timeoutMs`. */
export async function acquireGpuLock({owner, retryMs = 60000, timeoutMs = Infinity, staleMs = GPU_LOCK_STALE_MS, listBrowsers = runningBrowsers, heartbeatMs = 60000, log = console.error, capture = true} = {}) {
  if (!owner) throw new Error('acquireGpuLock needs an owner name');
  assertNoPendingSlotWait(owner);
  if (capture) assertCaptureOutsideSlot(owner);
  STATE.waiting++;
  try { return await acquire({owner, retryMs, timeoutMs, staleMs, listBrowsers, heartbeatMs, log}); } finally { STATE.waiting--; }
}
async function acquire({owner, retryMs, timeoutMs, staleMs, listBrowsers, heartbeatMs, log}) {
  const started = Date.now(); let attempts = 0;
  for (;;) {
    attempts++;
    try { await mkdir(GPU_LOCK_DIR); } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Number.isFinite(staleMs) && await tryBreakStale(staleMs, log, listBrowsers)) continue;
      const waited = Date.now() - started;
      if (waited >= timeoutMs) throw new Error(`GPU lock ${GPU_LOCK_DIR} still held after ${Math.round(waited / 1000)} s by: ${await lockOwner()}`);
      log(`[gpu-lock] held by: ${await lockOwner()} - retry ${attempts} in ${Math.round(retryMs / 1000)} s`);
      await sleep(Math.min(retryMs, Math.max(1000, timeoutMs - waited)));
      continue;
    }
    const text = `${owner} pid=${process.pid} host=${hostname()} acquired=${new Date().toISOString()}`;
    await writeFile(OWNER, text + '\n');
    let released = false;
    const ours = () => { try { return readFileSync(OWNER, 'utf8').trim() === text; } catch { return false; } };
    STATE.held++; STATE.owners.push(text); publish();
    const unpublish = () => { STATE.held--; const i = STATE.owners.lastIndexOf(text); if (i >= 0) STATE.owners.splice(i, 1); publish(); };
    const onExit = () => { if (!released && ours()) { released = true; unpublish(); rmSync(GPU_LOCK_DIR, {recursive: true, force: true}); } };
    const onSignal = () => { onExit(); process.exit(130); };
    process.on('exit', onExit); process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
    const heartbeat = setInterval(() => { if (!released && ours()) writeFile(OWNER, text + '\n').catch(() => {}); }, heartbeatMs); heartbeat.unref?.();
    const release = async () => {
      if (released) return; released = true; clearInterval(heartbeat); unpublish();
      process.off('exit', onExit); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
      if (ours()) await rm(GPU_LOCK_DIR, {recursive: true, force: true});
      else log(`[gpu-lock] not releasing: owner is now ${await lockOwner()}`);
    };
    return {release, owner: text, waitedMs: Date.now() - started, attempts};
  }
}

/** Holds the lock only for `work()`, releasing it on success or failure. Never call it inside a test-slot hold (see above). */
export async function withGpuLock(options, work) {
  const lock = await acquireGpuLock(options);
  try { return await work(lock); } finally { await lock.release(); }
}
