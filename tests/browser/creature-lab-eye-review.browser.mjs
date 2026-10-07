// Copied from universe-atlas@7419733 tests/creature-lab-eye-review.browser.mjs for the kit's Creature Lab app (apps/creature-lab); adaptations: repo root is the kit (../..), page /apps/creature-lab/creature-lab.html, host /apps/creature-lab/src/main.ts, Vite cacheDir apps/creature-lab/.vite, import paths.
// Needs `npm run lab:dev` (http://127.0.0.1:5206/apps/creature-lab/) and the GPU browser lock. Listed in apps/creature-lab/PROVENANCE.md.
// Creature Lab eye review captures (manual review tool, NOT in the npm test list; eye round EC3).
//
//   node tests/browser/creature-lab-eye-review.browser.mjs --label before|after [--out <dir>] [--only <name|group,...>] [--port 5263]
//
// Opens the REAL Creature Lab (creature-lab.html, composer mode) for specimens of tests/fauna-face-specimens.json (their
// frozen recipe text, as a shared link would carry it) and screenshots the Lab viewport the way the owner sees it:
//   <name>-body.png          Frame = Whole animal, three-quarter view (normal viewing size)
//   <name>-head-<view>.png   Frame = Head and face (front, side, three-quarter)
//   <name>-eyes-<view>.png   Frame = Eye close-up (front, side, three-quarter), only when the Lab offers that frame; the
//                            'front' close-up of lateral eyes is the Lab's front-quarter view of the near eye
//                            (report.json eyeFrames[view].frame.yawed); eyeFrames[view].view is the projected visible-eye fill
//   <name>.png               the above tiled with labels (ImageMagick montage)
//   menu-<name>.png          the Head and neck panel with the Eyes and Iris lists expanded (option text as shown)
//   report.json              per specimen: the Eyes/Iris option texts, the selected values, the frames captured
//   run.json                 GPU-lock holds, timings, console errors
// The caption box is hidden for the captures (it overlays the viewport's lower left). Lighting is planet-noon, motion
// Standing at time 0. Renders use SwiftShader unless ATLAS_HARDWARE is set.
//
// GPU: the browser only runs inside withGpuLock (tests/helpers/gpu-lock.mjs), in batches whose hold stays under 22 s
// (hard limit 30 s); the lock is released after every batch and on failure. Vite runs in-process on --port with
// strictPort and is closed at the end.
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {createServer as createNetServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HARD_HOLD_MS = 30000, HOLD_BUDGET_MS = 22000;
const DEFAULT_ONLY = ['preset-ostrich', 'preset-rhinoceros', 'preset-ape', 'preset-trunked-centipede', 'preset-worm', 'preset-centipede',
  'cat-cat-carnivore', 'cat-owl-bird', 'odd-cephalopod-horse', 'upgrade-before-round-centipede'];
const MENU_SPECIMENS = ['cat-cat-carnivore', 'preset-centipede', 'upgrade-before-round-centipede'];
const VIEWS = ['front', 'side', 'three-quarter'];

function args(argv) {
  const a = {label: null, out: null, only: null, port: 5263};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--label') a.label = v();
    else if (k === '--out') a.out = resolve(v());
    else if (k === '--only') a.only = v().split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--port') a.port = Number(v());
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!a.label || !/^[\w.-]+$/.test(a.label)) throw new Error('--label <before|after|...> is required (letters, digits, . _ -)');
  if (!Number.isInteger(a.port) || a.port < 1024) throw new Error('--port must be an integer >= 1024');
  return a;
}
function defaultOut(label) {
  let main = repo;
  try { main = resolve(repo, execFileSync('git', ['rev-parse', '--git-common-dir'], {cwd: repo, encoding: 'utf8'}).trim(), '..'); } catch {}
  return join(main, 'test-results', 'fauna-eye-round-2026-10-03', 'EC3', label);
}
const git = (...a) => { try { return execFileSync('git', a, {cwd: repo, encoding: 'utf8'}).trim(); } catch { return null; } };
const portFree = port => new Promise(res => { const s = createNetServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
function magickPath() {
  for (const c of [process.env.MAGICK, 'C:/LLM/IWSDK/tools/bin/imagemagick/magick.exe'].filter(Boolean)) if (existsSync(c)) return c;
  try { execFileSync('magick', ['-version'], {stdio: 'ignore'}); return 'magick'; } catch { return null; }
}

const opt = args(process.argv.slice(2));
const out = opt.out ?? defaultOut(opt.label);
const specFile = JSON.parse(readFileSync(join(repo, 'tests', 'fauna-face-specimens.json'), 'utf8'));
const wanted = opt.only ?? DEFAULT_ONLY;
const specimens = specFile.specimens.filter(s => wanted.includes(s.name) || wanted.includes(s.group));
const missing = wanted.filter(w => !specFile.specimens.some(s => s.name === w || s.group === w));
if (missing.length) throw new Error(`unknown specimen or group: ${missing.join(', ')}`);
mkdirSync(out, {recursive: true});
if (!await portFree(opt.port)) throw new Error(`Port ${opt.port} is in use; pass --port <free port>`);
const vite = await createServer({configFile: false, root: repo, cacheDir: join(repo, 'apps', 'creature-lab', '.vite'), logLevel: 'warn', appType: 'mpa',
  server: {host: '127.0.0.1', port: opt.port, strictPort: true, hmr: false, watch: null}});
const run = {schema: 'creature-lab-eye-review-run-1', label: opt.label, out, port: opt.port, startedAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'), dirty: (git('status', '--porcelain') ?? '').length > 0, renderer: process.env.ATLAS_HARDWARE ? 'hardware' : 'swiftshader',
  holds: [], errors: [], perSpecimenMs: {}};
const results = new Map();
let failure = null;
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${opt.port}`;
  const warm = await fetch(`${origin}/apps/creature-lab/creature-lab.html`); if (!warm.ok) throw new Error(`page ${warm.status}`);
  for (const m of ['/apps/creature-lab/src/main.ts', '/apps/creature-lab/src/creature-lab-composer.ts', '/src/fauna-composer.ts', '/src/fauna-composer-recipe.ts']) await vite.warmupRequest(m);
  await vite.transformRequest('/apps/creature-lab/src/main.ts');
  // work units: phase 'a' = whole animal + Head and face frames, phase 'b' = Eye close-up frames, phase 'c' = option
  // texts + menu; each unit opens the link afresh, so a GPU hold can end between them
  const queue = specimens.flatMap(spec => [{spec, phase: 'a'}, {spec, phase: 'b'}, {spec, phase: 'c'}]);
  let batch = 0, lastUnit = 8000;
  while (queue.length) {
    batch++;
    await withGpuLock({owner: `creature-lab-eye-review-${opt.label}`, retryMs: 15000, timeoutMs: 45 * 60 * 1000}, async () => {
      const t0 = Date.now(), done = [];
      const browser = await chromium.launch({headless: true, args: browserArgs});
      try {
        const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
        page.on('pageerror', e => run.errors.push(`pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') run.errors.push(`console: ${m.text()}`); });
        const settle = async () => {
          await page.waitForFunction(() => { const c = window.__creatureLab?.composer; return window.__creatureLab?.ready && c && (c.error || (c.actors.length && !c.building)); }, null, {timeout: 20000});
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        };
        while (queue.length && (done.length === 0 || Date.now() - t0 + lastUnit * 1.3 < HOLD_BUDGET_MS)) {
          const {spec, phase} = queue.shift(), s0 = Date.now();
          const u = new URL(`${origin}/apps/creature-lab/creature-lab.html`);
          for (const [k, v] of Object.entries({mode: 'composer', recipe: spec.text, motion: 'idle', time: '0', light: 'planet-noon', view: 'three-quarter'})) u.searchParams.set(k, v);
          await page.goto(u.href, {waitUntil: 'load'});
          await page.addStyleTag({content: '.caption{display:none!important}'});
          await settle();
          const lab = await page.evaluate(() => window.__creatureLab.composer);
          if (lab.error) throw new Error(`${spec.name}: ${lab.error}`);
          const focusValues = await page.$$eval('#composer-focus option', os => os.map(o => o.value));
          const eyesFrame = focusValues.includes('eyes');
          const entry = results.get(spec.name) ?? {name: spec.name, group: spec.group, eyesFrame, shots: [], eyeFrames: {},
            recipe: {head: lab.actors[0].recipe.head, eyes: lab.actors[0].recipe.eyes, iris: lab.actors[0].recipe.iris, eyeRules: lab.actors[0].recipe.eyeRules}};
          results.set(spec.name, entry);
          const shots = entry.shots;
          const shoot = async (focus, view) => {
            await page.selectOption('#composer-view', view); await page.selectOption('#composer-focus', focus); await settle();
            const file = `${spec.name}-${focus === 'body' ? 'body' : `${focus}-${view}`}.png`;
            await page.locator('#viewport').screenshot({path: join(out, file)}); shots.push(file);
            if (focus === 'eyes') entry.eyeFrames[view] = await page.evaluate(() => ({frame: window.__creatureLab.composer.eyeFrame, view: window.__creatureLab.eyeView, camera: window.__creatureLab.camera}));
          };
          if (phase === 'a') {
            await shoot('body', 'three-quarter');
            for (const view of VIEWS) await shoot('head', view);
          } else if (phase === 'b') {
            if (eyesFrame) for (const view of VIEWS) await shoot('eyes', view);
          } else {
            await page.selectOption('#composer-focus', 'body'); await page.selectOption('#composer-view', 'three-quarter');
            entry.options = await page.evaluate(() => Object.fromEntries(['eyes', 'iris', 'eyeRules'].map(k => {
              const el = document.getElementById(`composer-${k}`);
              if (!el) return [k, null];
              return [k, {tag: el.tagName.toLowerCase(), value: el.value, options: el.tagName === 'SELECT' ? [...el.options].map(o => ({value: o.value, text: o.textContent, group: o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : null})) : null}];
            })));
            if (MENU_SPECIMENS.includes(spec.name)) {
              // expand the Eyes and Iris lists in place (a native dropdown is not in a screenshot); restored afterwards
              await page.evaluate(() => { for (const id of ['composer-eyes', 'composer-iris']) { const el = document.getElementById(id); el.size = el.options.length + el.querySelectorAll('optgroup').length; el.style.height = 'auto'; } });
              await page.setViewportSize({width: 1440, height: 2000}); // the expanded lists are taller than the review viewport
              const fieldset = page.locator('fieldset:has(#composer-eyes)');
              await fieldset.scrollIntoViewIfNeeded();
              await fieldset.screenshot({path: join(out, `menu-${spec.name}.png`)}); shots.push(`menu-${spec.name}.png`);
              await page.evaluate(() => { for (const id of ['composer-eyes', 'composer-iris']) { const el = document.getElementById(id); el.size = 0; el.style.height = ''; } });
              await page.setViewportSize({width: 1440, height: 1000});
            }
            entry.constraints = await page.locator('#composer-constraints').innerText();
            entry.issues = await page.locator('#composer-issues').isVisible() ? await page.locator('#composer-issues').innerText() : '';
          }
          done.push(`${spec.name}/${phase}`); lastUnit = Date.now() - s0; run.perSpecimenMs[`${spec.name}/${phase}`] = lastUnit;
          console.log(`[eye-review] ${spec.name}/${phase} ${lastUnit} ms (${shots.length} shots${eyesFrame ? '' : ', no eye frame'})`);
        }
      } finally {
        await browser.close();
        const heldMs = Date.now() - t0; run.holds.push({batch, heldMs, specimens: done.length});
        console.log(`[eye-review] batch ${batch}: ${done.length} specimens, GPU lock held ${heldMs} ms`);
      }
    });
  }
} catch (error) { failure = error; } finally { await vite.close(); }
run.portFreeAfter = await portFree(opt.port);
run.finishedAt = new Date().toISOString();
run.maxHoldMs = Math.max(0, ...run.holds.map(h => h.heldMs));
run.holdsWithinLimit = run.holds.every(h => h.heldMs <= HARD_HOLD_MS);
if (!failure) {
  const magick = magickPath();
  for (const r of results.values()) {
    const tiles = r.shots.filter(f => !f.startsWith('menu-'));
    if (!magick) break;
    const argv = ['montage'];
    for (const f of tiles) argv.push('-label', f.replace(`${r.name}-`, '').replace('.png', ''), join(out, f));
    argv.push('-tile', '4x', '-geometry', '536x440+3+3', '-background', '#111111', '-fill', '#eeeeee', '-pointsize', '18', '-title', r.name,
      '-define', 'png:exclude-chunks=date,time', '-strip', join(out, `${r.name}.png`));
    try { execFileSync(magick, argv, {stdio: 'pipe'}); } catch (error) { run.errors.push(`montage ${r.name}: ${error.message.split('\n')[0]}`); }
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify({schema: 'creature-lab-eye-review-1', label: opt.label, specimens: [...results.values()]}, null, 1) + '\n');
}
run.failure = failure ? String(failure.stack ?? failure) : null;
writeFileSync(join(out, 'run.json'), JSON.stringify(run, null, 1) + '\n');
console.log(`[eye-review] ${results.size}/${specimens.length} specimens -> ${out}; max hold ${run.maxHoldMs} ms; port free after: ${run.portFreeAfter}; errors ${run.errors.length}`);
if (failure) { console.error(failure); process.exit(1); }
if (run.errors.length || !run.holdsWithinLimit || !run.portFreeAfter) process.exit(1);
process.exit(0);
