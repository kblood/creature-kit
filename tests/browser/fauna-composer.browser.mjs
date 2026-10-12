// Copied from universe-atlas@7419733 tests/fauna-composer.browser.mjs for the kit's Creature Lab app (apps/creature-lab); adaptations: import paths, CREATURE_LAB_URL/CREATURE_LAB_RESULTS, app URL; the planet-skin light block and section 12 (legacy modes) replaced by the app's mode-rejection checks.
// Needs `npm run lab:dev` (http://127.0.0.1:5206/apps/creature-lab/) and the GPU browser lock. Listed in apps/creature-lab/PROVENANCE.md.
// Modular composer in the actual Creature Lab page: DOM controls, structure, replay, comparison,
// motion, malformed links, disposal and legacy modes. Requires the Vite dev server (CREATURE_LAB_URL).
// GPU work is serialized through tests/helpers/gpu-lock.mjs. Screenshots are review evidence only;
// passing checks do not establish realism.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
import {COMPOSER_CHOICES, COMPOSER_PRESET_IDS, COMPOSER_RANGES, COMPOSER_RECIPE_KEYS, COMPOSER_PRESETS} from '../../src/fauna-composer-recipe.ts';

const base = new URL('.', process.env.CREATURE_LAB_URL || 'http://127.0.0.1:5206/apps/creature-lab/');
const output = process.env.CREATURE_LAB_RESULTS || 'test-results/fauna-opus-modular-001/browser';
await mkdir(output, {recursive: true});
const lab = query => new URL(`creature-lab.html${query}`, base).href;
const errors = [], failures = [], report = {ok: false, url: base.href, steps: {}, screenshots: [], errors, failures,
  scope: 'Actual Creature Lab DOM and rendered composer actors. Screenshots are for visual review; technical checks do not certify realism, flight or headset performance.'};
const check = (name, ok, detail) => { if (!ok) failures.push({name, detail}); return ok; };
const expectedLegs = r => r.layout === 'limbless' ? 0 : r.layout === 'biped' ? 2 : r.layout === 'many-legged' ? 2 * r.legPairs : 4;

async function shot(page, name) { const path = join(output, `${name}.png`); await page.screenshot({path}); report.screenshots.push(path); }
const composer = page => page.evaluate(() => window.__creatureLab.composer);
async function settle(page) {
  await page.waitForFunction(() => { const c = window.__creatureLab; return c.ready && c.mode === 'composer' && c.composer?.actors.length > 0 && !c.composer.building; }, null, {timeout: 60000});
}
async function pause(page) { if ((await composer(page)).playing) await page.click('#composer-play'); }
async function setRange(page, key, value) {
  await page.evaluate(([key, value]) => { const el = document.getElementById(`composer-${key}`); el.value = String(value); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }, [key, value]);
  await settle(page);
}
async function setPart(page, key, value) {
  if (key === 'marks') { await page.evaluate(value => { for (const box of document.querySelectorAll('#composer-marks input[data-mark]')) { const bit = {socks: 1, mask: 2, blaze: 4, 'tail-tip': 8, 'tail-rings': 16, 'ear-tips': 32, 'rump-patch': 64, 'juvenile-spots': 128}[box.dataset.mark]; if (box.checked !== !!(value & bit)) box.click(); } }, value); await settle(page); return; }
  if (key in COMPOSER_CHOICES) { await page.selectOption(`#composer-${key}`, String(value)); await settle(page); } else await setRange(page, key, value);
}
async function seek(page, time) { await page.fill('#composer-time', String(time)); await page.waitForFunction(t => Math.abs(window.__creatureLab.time - t) < 1e-9, time); }
const COAT_KEYS = ['palette', 'colorSeed', 'pattern', 'marks', 'patternScale', 'patternContrast', 'countershade'], TYPE_SPECIMEN_NOOP = ['variability', 'dimorphism'], EYE_KEYS = ['eyes', 'iris', 'eyeRules'];
// eyeRules (eye round): the earlier and current eye rules build the same eye for many animals until the catalogue
// geometry lands (skin-4); like eyes and iris it is recorded here and asserted in the eye package's tests.
const CONTROL_KEYS = COMPOSER_RECIPE_KEYS.filter(key => key !== 'trunk');
const digestPose = c => c.actors.map(a => a.pose.positions.map(v => v.toFixed(9)).join(',')).join('|');
// Neck and tail are lofted into the continuous body tube (skin part 'torso'), so they are checked by their bone chains.
const partSet = a => { const s = a.details.structure, out = new Set(a.details.parts.filter(p => p.triangles > 0).map(p => p.part));
  if (s.neckBones) out.add('neck'); if (s.tailBones) out.add('tail'); return out; };

try {
  await withGpuLock({owner: 'fauna-composer-browser', timeoutMs: 180000, staleMs: Infinity}, async () => {
    const browser = await chromium.launch({headless: true, args: browserArgs});
    try {
      const context = await browser.newContext({viewport: {width: 1440, height: 1080}, deviceScaleFactor: 1});
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

      // 1. Default entry and renderer identity.
      await page.goto(lab('?mode=composer'), {waitUntil: 'networkidle'});
      await settle(page);
      report.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? {vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)} : null; });
      let c = await composer(page);
      check('default preset is dinosaur', c.actors[0].preset === 'dinosaur', c.actors[0].preset);
      check('fresh page plays', c.playing === true);
      const t0 = await page.evaluate(() => window.__creatureLab.time); await page.waitForTimeout(400);
      check('time advances while playing', (await page.evaluate(() => window.__creatureLab.time)) > t0);
      check('composer panel visible', await page.isVisible('#composer-controls'));
      check('limitations visible', /flight is not simulated/i.test(await page.textContent('#composer-limitations')));
      // recipe v3: the trunk is derived from the face (Face = Proboscis) and has no control of its own
      for (const key of CONTROL_KEYS) check(`control ${key} exists`, await page.locator(`#composer-${key}`).count() === 1);
      check('no Trunk control (derived from the face)', await page.locator('#composer-trunk').count() === 0);
      await pause(page);

      // 2. All presets: structure, finite bounds, screenshots.
      report.steps.presets = [];
      for (const id of COMPOSER_PRESET_IDS) {
        await page.selectOption('#composer-preset', id); await settle(page); await seek(page, 0.37);
        c = await composer(page); const a = c.actors[0], s = a.details.structure, env = [...c.envelope.min, ...c.envelope.max];
        check(`${id} preset applied`, a.preset === id, a.preset);
        check(`${id} support count`, s.legs === expectedLegs(COMPOSER_PRESETS[id]), {legs: s.legs});
        check(`${id} finite envelope`, env.every(Number.isFinite) && c.envelope.max[1] > c.envelope.min[1]);
        check(`${id} within budget`, a.details.withinBudget, a.details);
        check(`${id} stance feet planted`, a.pose.contacts.filter(x => x.stance).every(x => Math.abs(x.contact[1]) < 1e-5), a.pose.contacts);
        report.steps.presets.push({id, layout: a.recipe.layout, structure: s, parts: [...partSet(a)], vertices: a.details.vertices, triangles: a.details.triangles, constraints: a.details.constraints, envelope: c.envelope});
        await shot(page, `preset-${id}`);
      }
      const byId = Object.fromEntries(report.steps.presets.map(p => [p.id, p]));
      check('presets cover all five layouts', new Set(report.steps.presets.map(p => p.layout)).size === 5);
      check('presets differ structurally', new Set(report.steps.presets.map(p => `${p.structure.legs}/${p.structure.arms}/${p.structure.wings}/${p.structure.neckBones}/${p.structure.tailBones}/${p.structure.trunkBones}`)).size >= 9, report.steps.presets.map(p => p.structure));
      for (const [id, part] of [['turtle', 'armor'], ['bird', 'wing'], ['rhinoceros', 'horn'], ['ape', 'hand'], ['trunked-centipede', 'trunk'], ['giraffe', 'neck'], ['dinosaur', 'tail']])
        check(`${id} has ${part}`, byId[id].parts.includes(part), byId[id].parts);
      check('worm has no legs', !byId.worm.parts.includes('leg') && !byId.worm.parts.includes('foot'));

      // 3. Each independent part once: intended field changes, unrelated fields preserved.
      report.steps.parts = []; const coatColour = {};
      await page.selectOption('#composer-preset', 'giraffe'); await settle(page);
      for (const key of CONTROL_KEYS) {
        const before = (await composer(page)).actors[0];
        const disabled = key === 'marks' ? await page.isDisabled('#composer-mark-socks') : await page.isDisabled(`#composer-${key}`);
        if (disabled) { report.steps.parts.push({key, skipped: await page.textContent(`#composer-${key}-why`)}); continue; }
        let value;
        if (key === 'marks') value = before.recipe.marks ^ 1;
        else if (key === 'sex') value = before.individual.sex === 'female' ? 'male' : 'female';
        else if (key in COMPOSER_CHOICES) value = COMPOSER_CHOICES[key].find(v => v !== before.recipe[key] && !(key === 'layout' && v === 'limbless') && !(key === 'pattern' && v === 'plain'));
        else { const [min, max] = COMPOSER_RANGES[key]; value = key === 'legPairs' ? before.recipe[key] : Number((min + (max - min) * (before.recipe[key] > (min + max) / 2 ? 0.3 : 0.7)).toFixed(COMPOSER_RANGES[key][2] >= 1 ? 0 : 2)); }
        await setPart(page, key, value);
        const after = (await composer(page)).actors[0];
        const changed = COMPOSER_RECIPE_KEYS.filter(k => after.recipe[k] !== before.recipe[k]);
        const allowed = key === 'layout' ? ['layout', 'legPairs'] : [key];
        check(`part ${key} applied`, after.recipe[key] === value, {value, got: after.recipe[key]});
        check(`part ${key} preserves unrelated fields`, changed.every(k => allowed.includes(k)), changed);
        const geometryChanged = after.skinDigest !== before.skinDigest || after.details.bones !== before.details.bones || digestPose({actors: [after]}) !== digestPose({actors: [before]});
        // Coat keys change colour only; variability and dimorphism have no effect on the type specimen (individual 0) and say so.
        if (COAT_KEYS.includes(key)) {
          coatColour[key] = after.colorDigest !== before.colorDigest; check(`part ${key} leaves the geometry unchanged`, after.skinDigest === before.skinDigest);
          // The skin clamps a pattern finer than its mesh can draw (WP3); spots on this giraffe clamp below the whole
          // slider range. A clamped scale must say so in the control's note, and the scale must still repaint a
          // pattern the body can resolve (stripes: every scale draws).
          if (key === 'patternScale' && !coatColour[key]) {
            const note = await page.isVisible('#composer-patternScale-why') ? await page.textContent('#composer-patternScale-why') : '';
            const clampNoted = /mesh can draw/i.test(note);
            await setPart(page, 'pattern', 'stripes');
            const striped = (await composer(page)).actors[0];
            const stripedValue = striped.recipe.patternScale === COMPOSER_RANGES.patternScale[0] ? COMPOSER_RANGES.patternScale[1] : COMPOSER_RANGES.patternScale[0];
            await setPart(page, key, stripedValue);
            const rescaled = (await composer(page)).actors[0];
            const stripesRepaint = rescaled.colorDigest !== striped.colorDigest && rescaled.skinDigest === striped.skinDigest;
            report.steps.patternScaleClamp = {pattern: before.recipe.pattern, value, note, clampNoted, stripes: {from: striped.recipe.patternScale, to: stripedValue, repaints: stripesRepaint}};
            coatColour[key] = clampNoted && stripesRepaint;
          }
        }
        // Eye type and iris colour: the built eye (geometry and iris colour) belongs to the eye package; recorded here, asserted there.
        else if (EYE_KEYS.includes(key)) report.steps.eyeKeys = {...report.steps.eyeKeys, [key]: {value, geometryChanged, colourChanged: after.colorDigest !== before.colorDigest}};
        else if (TYPE_SPECIMEN_NOOP.includes(key)) check(`part ${key} explains why the type specimen is unchanged`, /type specimen/i.test(await page.textContent(`#composer-${key}-why`)) && after.skinDigest === before.skinDigest);
        else if (!['hands', 'armLength'].includes(key)) check(`part ${key} changes structure or shape`, geometryChanged);
        report.steps.parts.push({key, value, changed, vertices: [before.details.vertices, after.details.vertices]});
      }

      // Palette and colour seed always repaint. The coat keys (pattern, marks, scale, contrast, countershade) repaint once the
      // coat painter (round package WP3) is merged; before that none of them does. Either all applicable ones repaint or none.
      report.steps.coatColour = coatColour;
      check('palette and colour seed repaint the skin', coatColour.palette && coatColour.colorSeed, coatColour);
      const coatPainted = ['pattern', 'marks', 'patternScale', 'patternContrast', 'countershade'].filter(k => k in coatColour);
      report.steps.coatPainter = coatPainted.some(k => coatColour[k]) ? 'present' : 'not in this build (WP3 coat painter not merged)';
      if (report.steps.coatPainter === 'present') check('every coat key repaints the skin', coatPainted.every(k => coatColour[k]), coatColour);

      // 4. Constraints are visible; inapplicable controls explain why.
      await page.selectOption('#composer-preset', 'worm'); await settle(page);
      check('limbless legs disabled with reason', await page.isDisabled('#composer-legs') && /no legs/i.test(await page.textContent('#composer-legs-why')));
      await setPart(page, 'armor', 'dome');
      check('shell adaptation explained', /middle third/i.test(await page.textContent('#composer-constraints')));
      await page.selectOption('#composer-preset', 'bird'); await settle(page);
      check('wing limitation explained', /flight is not simulated/i.test(await page.textContent('#composer-constraints')));

      // 5. Cross-family hybrids through the DOM.
      const hybrids = [
        ['shell-neck-beak', 'turtle', [['neckLength', 1.4], ['snoutLength', 0.7], ['horns', 'ossicones']], ['armor', 'neck', 'head', 'leg']],
        ['rhino-hands-reptile-tail', 'rhinoceros', [['arms', 'grasping'], ['hands', 'hand'], ['tail', 'reptile'], ['tailLength', 1.2]], ['horn', 'arm', 'hand', 'tail']],
        ['winged-beaked-dinosaur', 'dinosaur', [['wings', 'membrane'], ['head', 'beak']], ['wing', 'tail', 'leg']],
        ['centipede-jaws-tail', 'centipede', [['head', 'jaws'], ['tail', 'reptile'], ['tailLength', 0.6]], ['tail', 'leg']],
        // recipe v3: a trunk is the Proboscis face (there is no Trunk control)
        ['worm-trunk-shell', 'worm', [['head', 'proboscis'], ['armor', 'dome']], ['trunk', 'armor']],
      ];
      report.steps.hybrids = [];
      for (const [name, start, edits, expectParts] of hybrids) {
        await page.selectOption('#composer-preset', start); await settle(page);
        for (const [key, value] of edits) await setPart(page, key, value);
        await page.selectOption('#composer-motion', 'idle'); await settle(page); await seek(page, 0.5);
        c = await composer(page); const a = c.actors[0];
        check(`${name} is not a preset`, a.preset === null);
        for (const part of expectParts) check(`${name} has ${part}`, partSet(a).has(part), [...partSet(a)]);
        for (const view of ['three-quarter', 'side']) { await page.selectOption('#composer-view', view); await shot(page, `hybrid-${name}-${view}`); }
        await page.selectOption('#composer-view', 'three-quarter');
        report.steps.hybrids.push({name, encoded: a.encoded, parts: [...partSet(a)], structure: a.details.structure, constraints: a.details.constraints});
      }
      await page.selectOption('#composer-motion', 'walk'); await settle(page);

      // 6. Seeded random, share and replay in a new page.
      await page.fill('#composer-seed', 'opus-browser-7'); await page.click('#composer-randomize'); await settle(page);
      const r1 = (await composer(page)).actors[0].encoded;
      await page.click('#composer-randomize'); await settle(page);
      check('same seed same recipe', (await composer(page)).actors[0].encoded === r1);
      await page.click('#composer-next-seed'); await settle(page);
      c = await composer(page);
      check('next seed differs', c.seed === 'opus-browser-8' && c.actors[0].encoded !== r1, c.seed);
      await setRange(page, 'girth', 1.37);
      const manual = (await composer(page)).actors[0].encoded;
      await page.check('#skeleton'); await settle(page); await page.selectOption('#composer-view', 'side'); await page.uncheck('#skeleton'); await settle(page); await page.selectOption('#composer-view', 'three-quarter');
      check('unrelated UI does not reroll', (await composer(page)).actors[0].encoded === manual);
      await seek(page, 2.718);
      await page.click('#share-specimen');
      await page.waitForFunction(() => document.getElementById('share-status').textContent.length > 0);
      const shared = await page.evaluate(() => window.__creatureLab.specimenUrl), original = await composer(page);
      report.steps.share = {url: shared};
      check('share url has composer params', /mode=composer/.test(shared) && /recipe=v4/.test(shared) && !/bodyCondition/.test(shared), shared);
      const replay = await context.newPage(); replay.on('pageerror', e => errors.push(`replay: ${e.message}`));
      await replay.goto(shared, {waitUntil: 'networkidle'}); await settle(replay);
      const restored = await composer(replay);
      check('replay recipe identical', restored.actors[0].encoded === original.actors[0].encoded);
      check('replay paused at captured time', restored.playing === false && Math.abs(restored.time - 2.718) < 1e-9, restored.time);
      check('replay pose identical', digestPose(restored) === digestPose(original));
      check('replay bounds identical', JSON.stringify(restored.actors[0].bounds) === JSON.stringify(original.actors[0].bounds));
      check('replay controls restored', (await replay.inputValue('#composer-girth')) === '1.37' && (await replay.inputValue('#composer-seed')) === 'opus-browser-8');
      await replay.close();

      // 7. Comparison: independent sides, serialized, separated on screen.
      await page.selectOption('#composer-preset', 'ostrich'); await settle(page);
      await page.check('#composer-compare'); await page.waitForFunction(() => window.__creatureLab.composer?.actors.length === 2);
      await page.selectOption('#composer-edit-target', 'second'); await page.selectOption('#composer-preset', 'centipede'); await settle(page);
      await setPart(page, 'armor', 'plates');
      c = await composer(page);
      check('comparison keeps first', c.actors[0].preset === 'ostrich' && c.actors[1].recipe.layout === 'many-legged' && c.actors[1].recipe.armor === 'plates', c.actors.map(a => a.encoded));
      await page.selectOption('#composer-edit-target', 'first'); await setPart(page, 'tail', 'club');
      c = await composer(page);
      check('editing first leaves second', c.actors[1].recipe.armor === 'plates' && c.actors[0].recipe.tail === 'club');
      const separation = await page.evaluate(() => {
        const out = [];
        // Project actual posed bounds of both actors to the screen with the live camera.
        for (const a of window.__creatureLab.composer.actors) out.push(a.bounds);
        return out;
      });
      const right = [Math.SQRT1_2, 0, -Math.SQRT1_2];
      const interval = b => { const xs = [b.min[0], b.max[0]], zs = [b.min[2], b.max[2]], v = []; for (const x of xs) for (const z of zs) v.push(x * right[0] + z * right[2]); return [Math.min(...v), Math.max(...v)]; };
      const [i0, i1] = separation.map(interval);
      check('comparison actors separated left-right', i0[1] < i1[0], {i0, i1});
      await shot(page, 'compare-ostrich-centipede');
      const compareUrl = await page.evaluate(() => window.__creatureLab.specimenUrl);
      const cmpPage = await context.newPage(); await cmpPage.goto(compareUrl, {waitUntil: 'networkidle'}); await settle(cmpPage);
      const cmp = await composer(cmpPage);
      check('comparison replays both recipes', cmp.compare && cmp.actors.length === 2 && cmp.actors.map(a => a.encoded).join() === c.actors.map(a => a.encoded).join());
      await cmpPage.close();
      await page.uncheck('#composer-compare'); await page.waitForFunction(() => window.__creatureLab.composer?.actors.length === 1);

      // 8. Play, pause, scrub A-B-A.
      await page.selectOption('#composer-preset', 'giraffe'); await settle(page);
      await seek(page, 1.234); const poseA = digestPose(await composer(page));
      await seek(page, 7.5); const poseB = digestPose(await composer(page));
      await seek(page, 1.234);
      check('scrub A-B-A identical', digestPose(await composer(page)) === poseA && poseA !== poseB);
      await page.click('#composer-play'); await page.waitForTimeout(350); c = await composer(page);
      check('play advances transforms', c.playing && digestPose(c) !== poseA);
      await page.click('#composer-play'); const paused = digestPose(await composer(page)); await page.waitForTimeout(300);
      check('pause holds pose', digestPose(await composer(page)) === paused);
      await page.check('#skeleton'); await settle(page); await shot(page, 'giraffe-skeleton'); await page.uncheck('#skeleton'); await settle(page);
      await page.check('#neutral'); await settle(page); await shot(page, 'giraffe-neutral'); await page.uncheck('#neutral'); await settle(page);

      // 9. Repeated rebuilds keep resident GPU resources bounded.
      const memory = () => page.evaluate(() => window.__creatureLab.renderer.memory);
      for (const id of COMPOSER_PRESET_IDS.slice(0, 4)) { await page.selectOption('#composer-preset', id); await settle(page); }
      await page.waitForTimeout(100); const warm = await memory();
      for (let k = 0; k < 3; k++) for (const id of COMPOSER_PRESET_IDS) { await page.selectOption('#composer-preset', id); await settle(page); }
      await page.selectOption('#composer-preset', COMPOSER_PRESET_IDS[3]); await settle(page); await page.waitForTimeout(100);
      const later = await memory(); report.steps.memory = {warm, later};
      check('geometries bounded after rebuild cycles', later.geometries <= warm.geometries + 2, {warm, later});

      // 10. Malformed links: visible rejection or bounded normalization.
      report.steps.malformed = [];
      for (const [name, query, expect] of [
        ['unsupported-version', '?mode=composer&recipe=v9*layout_biped', /Unsupported composer recipe version/],
        ['oversize', `?mode=composer&recipe=v1*${'x'.repeat(1400)}`, /longer than/],
        ['repeated', '?mode=composer&recipe=v1*layout_biped&recipe=v1*layout_limbless', /repeated recipe/],
        ['bad-motion', '?mode=composer&motion=teleport', /unknown motion/],
      ]) {
        const p = await context.newPage(); p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
        await p.goto(lab(query), {waitUntil: 'networkidle'});
        await p.waitForFunction(() => !!window.__creatureLab?.error, null, {timeout: 20000});
        const state = await p.evaluate(() => ({error: window.__creatureLab.error, actors: window.__creatureLab.composer?.actors.length ?? 0, notice: document.getElementById('notice').textContent, visible: !document.getElementById('notice').hidden}));
        check(`${name} rejected visibly`, expect.test(state.notice) && state.visible && state.actors === 0, state);
        await p.selectOption('#composer-preset', 'bird'); await settle(p);
        check(`${name} recovers by choosing a preset`, (await composer(p)).actors[0].preset === 'bird' && !(await p.evaluate(() => window.__creatureLab.error)));
        report.steps.malformed.push({name, ...state}); await p.close();
      }
      const bounded = await context.newPage();
      await bounded.goto(lab('?mode=composer&recipe=v1*layout_banana*girth_NaN*legPairs_99*bodyLength_1e9*wingSpan_Infinity*__proto___x'), {waitUntil: 'networkidle'}); await settle(bounded);
      const b = await composer(bounded);
      check('bounded normalization listed', b.issues.length >= 4 && await bounded.isVisible('#composer-issues') && b.actors[0].recipe.bodyLength === 6, b.issues);
      report.steps.malformed.push({name: 'bounded', issues: b.issues}); await bounded.close();

      // 10b. Coat and Individual controls, generators, herd and lighting.
      report.steps.wp5 = {};
      const fresh = await context.newPage(); fresh.on('pageerror', e => errors.push(`wp5: ${e.message}`));
      await fresh.goto(lab('?mode=composer'), {waitUntil: 'networkidle'}); await settle(fresh); await pause(fresh);
      check('marks are 8 labelled checkboxes', await fresh.locator('#composer-marks input[type=checkbox]').count() === 8 && /Socks/.test(await fresh.textContent('#composer-marks')) && /Juvenile spots/.test(await fresh.textContent('#composer-marks')));
      check('maturity slider labelled Age', /^Age\b/.test((await fresh.locator('label:has(#composer-maturity)').innerText()).trim()));
      check('lighting select visible in composer mode', await fresh.isVisible('#lighting') && (await fresh.inputValue('#lighting')) === 'studio');
      await fresh.selectOption('#composer-preset', 'giraffe'); await settle(fresh);
      const g0 = await composer(fresh);
      await fresh.click('#composer-next-individual'); await settle(fresh);
      let g1 = await composer(fresh);
      check('Next individual increments individualSeed', g1.actors[0].recipe.individualSeed === g0.actors[0].recipe.individualSeed + 1, g1.actors[0].recipe.individualSeed);
      check('individual keeps the preset identity', g1.actors[0].preset === 'giraffe' && (await fresh.inputValue('#composer-preset')) === 'giraffe' && /^Giraffe-like · individual 1/.test(await fresh.textContent('#caption-title')), await fresh.textContent('#caption-title'));
      check('individual differs from the type specimen', g1.actors[0].skinDigest !== g0.actors[0].skinDigest && g1.actors[0].individual.deltas.length > 0);
      check('individual deltas listed', /This individual/.test(await fresh.textContent('#composer-constraints')) && (await fresh.locator('#composer-constraints .composer-deltas li').count()) === g1.actors[0].individual.deltas.length);
      await setRange(fresh, 'maturity', 0.4); await setPart(fresh, 'sex', 'male');
      g1 = await composer(fresh);
      check('sex and age keep the preset identity', g1.actors[0].preset === 'giraffe' && /juvenile male/.test(await fresh.textContent('#caption-title')), await fresh.textContent('#caption-title'));
      await shot(fresh, 'giraffe-individual-1-juvenile-male');
      await setRange(fresh, 'neckLength', 1.2);
      check('anatomy edit becomes a custom combination', (await composer(fresh)).actors[0].preset === null && (await fresh.inputValue('#composer-preset')) === 'custom' && /^Custom combination/.test(await fresh.textContent('#caption-title')));
      await setRange(fresh, 'individualSeed', 9999); await fresh.click('#composer-next-individual'); await settle(fresh);
      check('Next individual wraps 9999 to 1', (await composer(fresh)).actors[0].recipe.individualSeed === 1);
      await fresh.selectOption('#composer-preset', 'worm'); await settle(fresh);
      check('sex disabled without dimorphism', await fresh.isDisabled('#composer-sex') && /no sex differences/i.test(await fresh.textContent('#composer-sex-why')));
      await fresh.selectOption('#composer-preset', 'bird'); await settle(fresh);
      check('plain coat disables pattern scale', await fresh.isDisabled('#composer-patternScale') && /plain coat/i.test(await fresh.textContent('#composer-patternScale-why')));
      await setPart(fresh, 'marks', 128);
      check('juvenile spots note on an adult', /young animals/i.test(await fresh.textContent('#composer-marks-why')));
      // Generators: wild hybrid, plausible species, and New seed repeating the last kind.
      check('wild hybrid button relabelled', (await fresh.textContent('#composer-randomize')).trim() === 'Wild hybrid' && /Random plausible species/.test(await fresh.textContent('#composer-random-species')));
      await fresh.fill('#composer-seed', 'wp5-plausible-3'); await fresh.click('#composer-random-species'); await settle(fresh);
      const p1 = await composer(fresh);
      check('plausible species labelled', /^Plausible /.test(await fresh.textContent('#caption-title')) && p1.generator === 'plausible', await fresh.textContent('#caption-title'));
      await shot(fresh, 'plausible-species-wp5-plausible-3');
      await fresh.click('#composer-random-species'); await settle(fresh);
      check('plausible species is seeded', (await composer(fresh)).actors[0].encoded === p1.actors[0].encoded);
      await fresh.click('#composer-next-seed'); await settle(fresh);
      const p2 = await composer(fresh);
      check('New seed repeats the plausible generator', p2.seed === 'wp5-plausible-4' && p2.generator === 'plausible' && p2.actors[0].encoded !== p1.actors[0].encoded && /^Plausible /.test(await fresh.textContent('#caption-title')), {seed: p2.seed, generator: p2.generator});
      await fresh.click('#composer-randomize'); await settle(fresh);
      const w1 = await composer(fresh);
      check('wild hybrid differs from plausible species', w1.generator === 'wild' && w1.actors[0].encoded !== p2.actors[0].encoded);
      // Herd: built one animal per frame with a visible status, 12 distinct individuals; comparison disables it.
      await fresh.selectOption('#composer-preset', 'rhinoceros'); await settle(fresh);
      const herdStart = Date.now();
      await fresh.selectOption('#composer-herd', '12');
      const sawBuilding = await fresh.waitForFunction(() => /Building \d+\/12/.test(document.getElementById('status').textContent), null, {timeout: 5000, polling: 'raf'}).then(() => true, () => false);
      await settle(fresh);
      const herdWallMs = Date.now() - herdStart;
      await fresh.waitForTimeout(300);
      const herd = await composer(fresh);
      const seeds = herd.actors.map(a => a.individual.seed), young = herd.actors.filter(a => a.individual.maturity < .75).length;
      check('herd status shows Building i/N', sawBuilding);
      check('herd of 12 has 12 distinct individuals', herd.actors.length === 12 && new Set(seeds).size === 12 && new Set(herd.actors.map(a => a.skinDigest)).size === 12, seeds);
      check('herd has three young', young === 3, young);
      check('herd within triangle budget', herd.herdStats.triangles <= 480000, herd.herdStats);
      check('herd status lists totals as desktop preview', /triangles · .* vertices · \d+ draw calls \| desktop preview/.test(await fresh.textContent('#status')), await fresh.textContent('#status'));
      const herdCalls = await fresh.evaluate(() => window.__creatureLab.renderer.calls);
      check('herd draw calls within 25', herdCalls <= 25, herdCalls);
      report.steps.wp5.herd = {species: 'rhinoceros', stats: herd.herdStats, observedWallMs: herdWallMs, seeds, sexes: herd.actors.map(a => a.individual.sex), maturity: herd.actors.map(a => a.individual.maturity), drawCalls: herdCalls, status: await fresh.textContent('#status')};
      await shot(fresh, 'herd-rhinoceros-12-studio');
      // Lighting select, shared with the herd.
      await fresh.selectOption('#lighting', 'planet-noon'); await fresh.waitForTimeout(300);
      const lit = await fresh.evaluate(() => window.__creatureLab.lighting);
      check('lighting switches to planet-noon', lit.preset === 'planet-noon' && lit.fillKeyRatio > .2 && lit.fillKeyRatio < .35 && lit.shadows, lit);
      report.steps.wp5.lighting = lit;
      await shot(fresh, 'herd-rhinoceros-12-planet-noon');
      await fresh.click('#share-specimen'); await fresh.waitForFunction(() => document.getElementById('share-status').textContent.length > 0);
      const herdLink = await fresh.evaluate(() => window.__creatureLab.specimenUrl);
      check('herd and light are shared', new URL(herdLink).searchParams.get('herd') === '12' && new URL(herdLink).searchParams.get('light') === 'planet-noon', herdLink);
      const herdReplay = await context.newPage(); herdReplay.on('pageerror', e => errors.push(`herd replay: ${e.message}`));
      await herdReplay.goto(herdLink, {waitUntil: 'networkidle'}); await settle(herdReplay);
      const hr = await composer(herdReplay);
      check('herd replays identically', hr.actors.map(a => a.encoded).join() === herd.actors.map(a => a.encoded).join() && (await herdReplay.evaluate(() => window.__creatureLab.lighting.preset)) === 'planet-noon');
      await herdReplay.close();
      await fresh.check('#composer-compare'); await fresh.waitForFunction(() => window.__creatureLab.composer?.actors.length === 2 && !window.__creatureLab.composer.building);
      check('compare disables the herd', await fresh.isDisabled('#composer-herd') && (await composer(fresh)).herd === 1);
      await fresh.uncheck('#composer-compare'); await settle(fresh);
      await fresh.close();
      // Unavailable herd size: visible notice, one animal.
      const odd = await context.newPage(); odd.on('pageerror', e => errors.push(`herd7: ${e.message}`));
      await odd.goto(lab('?mode=composer&herd=7&light=planet-noon'), {waitUntil: 'networkidle'}); await settle(odd);
      const oddState = await composer(odd);
      check('herd=7 falls back to 1 with a visible notice', oddState.actors.length === 1 && await odd.isVisible('#composer-issues') && /Herd size "7"/.test(await odd.textContent('#composer-issues')));
      check('light=planet-noon link applies', (await odd.evaluate(() => window.__creatureLab.lighting.preset)) === 'planet-noon');
      await odd.close();
      // (Atlas: a planet-skin link with an unknown light; the app has composer mode only, see section 12.)

      // 11. Mobile layout.
      await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(300);
      const mobile = await page.evaluate(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return {canvas: [r.width, r.height], panel: document.getElementById('composer-preset').getBoundingClientRect().width}; });
      check('mobile canvas and controls usable', mobile.canvas[0] > 300 && mobile.canvas[1] > 200 && mobile.panel > 100, mobile);
      await shot(page, 'mobile-390');
      await page.setViewportSize({width: 1440, height: 1080});

      // 12. (app) Links naming another mode are rejected visibly, never shown as a composer animal; no mode means composer.
      for (const query of ['?mode=gallery', '?mode=skin&pose=idle']) {
        const p = await context.newPage(); p.on('pageerror', e => errors.push(`${query}: ${e.message}`));
        await p.goto(lab(query), {waitUntil: 'networkidle'}); await settle(p);
        const other = await p.evaluate(() => ({mode: window.__creatureLab.mode, error: window.__creatureLab.composer?.error, actors: window.__creatureLab.composer?.actors.length, text: document.body.innerText}));
        check(`${query} rejected visibly`, other.mode === 'composer' && /Unsupported link: mode/.test(other.error ?? '') && other.actors === 0 && /Unsupported link: mode/.test(other.text), {...other, text: undefined});
        await p.close();
      }
      { const p = await context.newPage(); p.on('pageerror', e => errors.push(`no mode: ${e.message}`));
        await p.goto(lab(''), {waitUntil: 'networkidle'}); await settle(p);
        const bare = await p.evaluate(() => ({error: window.__creatureLab.composer?.error, actors: window.__creatureLab.composer?.actors.length, url: window.__creatureLab.specimenUrl}));
        check('a link without mode opens composer mode', !bare.error && bare.actors > 0 && /mode=composer/.test(bare.url), bare);
        await p.close(); }
      check('no page or console errors', errors.length === 0, errors);
    } finally { await browser.close(); }
  });
  report.ok = failures.length === 0;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ok: report.ok, failures: failures.slice(0, 20), errors: errors.slice(0, 10), error: report.error, screenshots: report.screenshots.length}, null, 2));
assert.ok(report.ok, `composer browser acceptance failed; see ${join(output, 'report.json')}`);
