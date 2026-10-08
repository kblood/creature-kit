// Runs the Creature Lab app's browser tests one after another (npm run test:browser). Each test takes the machine-wide
// GPU browser lock itself (tests/helpers/gpu-lock.mjs) and waits for it; never run two of these at once.
//   npm run test:browser                 # all, against a dev server this script starts on a free port from 5206
//   npm run test:browser -- --list       # print the tests and exit (no server, no browser)
//   npm run test:browser -- --only fauna-composer-ui,fauna-composer-herd
// Output goes to test-results/creature-lab-browser/<run>/<test>/ (CREATURE_LAB_RESULTS); each test writes report.json.
// fauna-composer-visual and -herd refuse an existing output folder, so every run gets a new <run> folder.
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertCaptureOutsideSlot} from '../helpers/gpu-lock.mjs';

const here = dirname(fileURLToPath(import.meta.url)), kit = resolve(here, '../..');
export const BROWSER_TESTS = Object.freeze([
  {name: 'fauna-composer', file: 'fauna-composer.browser.mjs', what: 'panel, presets, links, motion, malformed links, herd, lighting, disposal, mode rejection'},
  {name: 'fauna-composer-ui', file: 'fauna-composer-ui.browser.mjs', what: 'independent UI review: every control, comparison, mobile, invalid-link recovery, resource residency'},
  {name: 'fauna-composer-visual', file: 'fauna-composer-visual.browser.mjs', what: 'every preset rendered in isolation and under planet-noon lighting, contact sheets'},
  {name: 'fauna-composer-herd', file: 'fauna-composer-herd.browser.mjs', what: 'herds of 12 under planet-noon: individuals, shadows, isolated crops'},
  {name: 'creature-lab-eye-review', file: 'creature-lab-eye-review.browser.mjs', what: 'eye close-up review set (own Vite server, --label kit-lab)', args: ['--label', 'kit-lab'], ownServer: true},
]);

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1]?.split(',').map(s => s.trim()) : null;
const tests = BROWSER_TESTS.filter(t => !only || only.includes(t.name));
if (only && tests.length !== only.length) throw new Error(`unknown test in --only: ${only.filter(n => !BROWSER_TESTS.some(t => t.name === n)).join(', ')}`);
if (argv.includes('--list')) {
  for (const t of tests) console.log(`${t.name.padEnd(26)} tests/browser/${t.file}  ${t.what}`);
  process.exit(0);
}

// Lock order (I8): the captures take the GPU lock OUTSIDE Atlas's CPU test slot. Fail before the dev server starts when
// run as `test-slot.mjs -- npm run test:browser` (each test's withGpuLock would refuse anyway, one by one).
assertCaptureOutsideSlot('test:browser');
const {createServer} = await import('vite');
const server = await createServer({configFile: resolve(kit, 'apps/creature-lab/vite.config.mjs'), server: {hmr: false, watch: null}, logLevel: 'warn'});
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error('the Vite dev server did not report a local URL');
const labUrl = new URL('apps/creature-lab/', url).href;
const runDir = resolve(kit, 'test-results', 'creature-lab-browser', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(runDir, {recursive: true});
console.log(`[test:browser] dev server ${labUrl}; results ${runDir}`);
const results = [];
try {
  for (const t of tests) {
    const output = join(runDir, t.name);
    const args = [join(here, t.file), ...(t.args ?? []), ...(t.ownServer ? ['--out', output] : [])];
    const env = {...process.env, CREATURE_LAB_URL: labUrl, CREATURE_LAB_RESULTS: output};
    console.log(`[test:browser] ${t.name} ...`);
    const code = await new Promise(done => spawn(process.execPath, args, {cwd: kit, env, stdio: 'inherit'}).on('exit', c => done(c ?? 1)));
    // Some tests record failures in report.json and still exit 0: a report with ok/passed false or an error is a failure.
    let report = null; try { const p = join(output, 'report.json'); if (existsSync(p)) report = JSON.parse(readFileSync(p, 'utf8')); } catch (error) { report = {error: `unreadable report.json: ${error.message}`}; }
    const failedReport = report && (report.ok === false || report.passed === false || !!report.error);
    results.push({name: t.name, code: code === 0 && failedReport ? 1 : code});
  }
} finally { await server.close(); }
for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'} ${r.name} (exit ${r.code})`);
process.exit(results.every(r => r.code === 0) ? 0 : 1);
