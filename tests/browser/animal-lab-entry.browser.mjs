/** Built app entry/label smoke. Uses the existing composer and preserved inspector URLs. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
import {composerPreset,encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';
import {readComposerGlb} from '../../src/fauna-composer-export.ts';

const kit=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.env.CREATURE_LAB_RESULTS??join(kit,'test-results','animal-lab-entry',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(output,{recursive:true});
const server=await preview({root:resolve(kit,'apps/creature-lab'),configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:5287,strictPort:false}});
const base=server.resolvedUrls.local[0],report={ok:false,checks:[],errors:[],url:base,output};
try{
 await withGpuLock({owner:'animal-lab-primary-entry-review',timeoutMs:600000,retryMs:10000},async()=>{
  const browser=await chromium.launch({headless:true,args:browserArgs});
  try{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
   const settle=()=>page.waitForFunction(()=>window.__creatureLab?.ready&&!window.__creatureLab?.composer.building);
   const state=()=>page.evaluate(()=>window.__creatureLab.specimenState);
   await page.goto(base,{waitUntil:'networkidle'});await settle();
   assert.match(page.url(),/creature-lab\.html\?mode=composer$/);assert.equal(await page.title(),'Animal Lab · Creature Kit');assert.equal(await page.locator('#title').innerText(),'Animal Lab');
   assert(await page.locator('#animal-body-guide').isVisible());await page.screenshot({path:join(output,'01-primary-animal-lab.png')});report.checks.push('bare built directory opens full Animal Lab');
   if(await page.evaluate(()=>window.__creatureLab.composer.playing))await page.click('#composer-play');
   const before=await state();await page.locator('a[href="#composer-layout"]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'composer-layout');assert.deepEqual(await state(),before);report.checks.push('body-plan guide locates existing controls without changing recipe');
   assert.equal((await state()).presentation,'realism-1');
   await page.selectOption('#composer-preset','turtle');await settle();const surfaceRecipe=(await state()).recipe;
   for(const [presentation,version] of [['skin-5','fauna-composer-skin-5'],['realism-1','fauna-composer-skin-6']]){
    await page.selectOption('#composer-presentation',presentation);await settle();assert.equal((await state()).recipe,surfaceRecipe);
    assert.equal(await page.evaluate(()=>window.__creatureLab.composer.actors[0].skinVersion),version);
    const shared=await page.evaluate(()=>window.__creatureLab.specimenUrl);assert.equal(new URL(shared).searchParams.get('presentation'),presentation);
    await page.goto(shared,{waitUntil:'networkidle'});await settle();assert.equal(await page.locator('#composer-presentation').inputValue(),presentation);assert.equal((await state()).recipe,surfaceRecipe);
    const downloading=page.waitForEvent('download',{timeout:90000});await page.click('#export-glb');const downloaded=await downloading;const glbFile=join(output,`selected-${presentation}.glb`);await downloaded.saveAs(glbFile);
    const glb=readComposerGlb(await readFile(glbFile));assert.match(JSON.stringify(glb.json),new RegExp(version));assert.match(await page.locator('#export-status').innerText(),/Desktop budget passed/);
    const jsonDownload=page.waitForEvent('download');await page.click('#export-json');const json=await jsonDownload;const jsonFile=join(output,`selected-${presentation}.json`);await json.saveAs(jsonFile);const exported=JSON.parse(await readFile(jsonFile,'utf8'));
    assert.equal(exported.presentation,presentation);assert.equal(exported.composer.actors[0].skinVersion,version);
   }
   report.checks.push('both surface styles preserve recipe, share/reload and export actual JSON/GLB skin versions');
   for(const [preset,layout] of [['dinosaur','biped'],['turtle','sprawled'],['worm','limbless'],['centipede','many-legged']]){
    await page.selectOption('#composer-preset',preset);await settle();assert.equal(await page.locator('#composer-layout').inputValue(),layout);
   }
   await page.locator('#composer-legPairs').fill('3');await page.locator('#composer-legPairs').dispatchEvent('input');await page.locator('#composer-legPairs').dispatchEvent('change');await settle();assert.equal(await page.locator('#composer-legPairs').inputValue(),'3');report.checks.push('dinosaur, turtle, limbless and insect leg controls remain available');
   const recipe=encodeComposerRecipe({...composerPreset('trunked-centipede'),eyes:'gecko',iris:'gold'});
   const query=`?mode=composer&recipe=${encodeURIComponent(recipe)}&time=2.75&motion=display&view=side&light=planet-noon`;
   await page.goto(base+query+'#composer-head',{waitUntil:'networkidle'});await settle();assert.equal(new URL(page.url()).search,query);assert.equal(new URL(page.url()).hash,'#composer-head');
   assert.equal((await state()).recipe,recipe);assert.equal(await page.locator('#composer-head').inputValue(),'proboscis');assert.equal(await page.locator('#composer-eyes').inputValue(),'gecko');assert.equal((await state()).time,2.75);report.checks.push('entry preserves exact advanced proboscis/eye recipe and pose');
   await page.goto(new URL('planet-skin.html',base).href,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__planetAnimalLab?.details().ready);
   assert.match(await page.title(),/^Archived planet inspector/);assert(await page.locator('.full-animal-lab').isVisible());assert.match(await page.locator('.inspector-archive-note').innerText(),/Archived legacy quadruped view/);assert.match(await page.locator('.inspector-archive-note').innerText(),/Normal Atlas and the full Animal Lab now share Composer/);
   await page.screenshot({path:join(output,'02-archived-quadruped-inspector.png')});await page.locator('.full-animal-lab').click();await settle();assert.match(page.url(),/creature-lab\.html\?mode=composer$/);report.checks.push('compatible inspector URL is archived and links to full Animal Lab');
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'03-primary-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.goto(new URL('planet-skin.html',base).href,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__planetAnimalLab?.details().ready);await page.screenshot({path:join(output,'04-archive-mobile.png')});assert(await page.locator('.full-animal-lab').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.checks.push('primary and archived entry remain usable on mobile');
   assert.deepEqual(report.errors,[]);report.ok=true;
  }finally{await browser.close();}
 });
}catch(e){report.error=e.stack;throw e;}finally{await new Promise(r=>server.httpServer.close(r));await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
