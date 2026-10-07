/** Machine-wide GPU browser lock, the SAME lock every agent on this PC uses: C:/LLM/IWSDK/.gpu-browser-lock (override
 * with ATLAS_GPU_LOCK_DIR, as in universe-atlas). A small version of universe-atlas tests/helpers/gpu-lock.mjs with the
 * same protocol, so a kit browser test and an Atlas browser test exclude each other:
 * - `mkdir` of the lock directory is the atomic acquire; `owner.txt` inside names the holder and is refreshed every minute;
 * - a held lock is waited for, never broken, except a leaked one: owner.txt older than 20 min while no chrome/headless
 *   browser runs (the coordinator rule of 2026-09-29), which is renamed away and logged;
 * - while held, ATLAS_GPU_LOCK_HELD is set for child processes, so Atlas's tests/helpers/test-slot.mjs refuses to take the
 *   CPU slot inside a GPU hold (lock order: slot -> GPU, never GPU -> slot);
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
export async function acquireGpuLock({owner, retryMs = 60000, timeoutMs = Infinity, staleMs = GPU_LOCK_STALE_MS, listBrowsers = runningBrowsers, heartbeatMs = 60000, log = console.error} = {}) {
  if (!owner) throw new Error('acquireGpuLock needs an owner name');
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
    const inherited = process.env.ATLAS_GPU_LOCK_HELD;
    process.env.ATLAS_GPU_LOCK_HELD = text;
    let released = false;
    const ours = () => { try { return readFileSync(OWNER, 'utf8').trim() === text; } catch { return false; } };
    const unpublish = () => { if (inherited === undefined) delete process.env.ATLAS_GPU_LOCK_HELD; else process.env.ATLAS_GPU_LOCK_HELD = inherited; };
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

/** Holds the lock only for `work()`, releasing it on success or failure. */
export async function withGpuLock(options, work) {
  const lock = await acquireGpuLock(options);
  try { return await work(lock); } finally { await lock.release(); }
}
