import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
import {newPlanetSpecimen} from '../../apps/creature-lab/src/planet-lab-state.ts';

const kit=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.env.CREATURE_LAB_RESULTS??join(kit,'test-results','planet-lab-ui',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(output,{recursive:true});
const server=await createServer({configFile:resolve(kit,'apps/creature-lab/vite.config.mjs'),server:{hmr:false,watch:null},logLevel:'warn'});
await server.listen();const url=new URL('apps/creature-lab/planet-skin.html',server.resolvedUrls.local[0]).href;
const report={ok:false,errors:[],checks:[],url,output};
try{
 await withGpuLock({owner:'planet-lab-canonical-ui',timeoutMs:600000,retryMs:10000},async()=>{
  const browser=await chromium.launch({headless:true,args:browserArgs});
  try{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
   const state=()=>page.evaluate(()=>window.__planetAnimalLab.details());
   const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return state();};
   const capture=name=>page.screenshot({path:join(output,`${name}.png`)});
   await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__planetAnimalLab?.details().ready);
   assert.equal(await page.locator('#advanced').getAttribute('open'),null);assert(await page.locator('#gene-torsoLength').isVisible());
   await capture('01-anatomy-desktop');report.checks.push('useful editor visible; JSON collapsed');
   const imported=newPlanetSpecimen('external-world-fixture','long-neck',2);imported.individualId='atlas/animal/actual-17';imported.speciesId='atlas/species/ancestral-8';
   await page.evaluate(d=>window.__planetAnimalLab.load(d),imported);assert.deepEqual((await state()).definition,imported);assert.equal((await state()).edited,false);
   assert(await page.locator('#next-individual').isDisabled());
   await page.locator('#gene-torsoLength').fill('2.65');await page.locator('#gene-torsoLength').dispatchEvent('change');
   let s=await settle();assert.equal(s.definition.genome.torsoLength,2.65);assert.deepEqual(s.original,imported);assert.equal(s.definition.individualId,imported.individualId);
   await page.click('#undo');assert.deepEqual((await settle()).definition,imported);report.checks.push('import identity and full genome exact; anatomical edit and undo');
   await page.click('#tab-coat');await page.selectOption('#coat-pattern','stripes');await settle();
   await page.locator('#coat-base').fill('#ddbb66');await page.locator('#coat-base').dispatchEvent('change');s=await settle();assert.equal(s.definition.genome.appearance.coat.pattern,'stripes');assert.equal(s.edited,true);await capture('02-coat-desktop');
   await page.click('#tab-review');await page.check('#compare');s=await settle();assert.equal(s.actors.length,2);assert.deepEqual(s.actors[0].definition,imported);await capture('03-compare-desktop');
   await page.selectOption('#view','front');s=await settle();assert.notEqual(s.actors[0].bounds.min[2],s.actors[1].bounds.min[2]);await capture('04-compare-front');
   await page.uncheck('#compare');await page.click('#reset');assert.deepEqual((await settle()).definition,imported);report.checks.push('coat edits, original comparison in front view, exact reset');
   await page.selectOption('#pose','walk');await page.locator('#time').fill('1.35');await page.locator('#time').dispatchEvent('input');s=await settle();assert.equal(s.diagnostics.gait,'walk');assert.equal(s.time,1.35);
   await page.click('#play');await page.waitForTimeout(350);assert((await state()).time>1.35);await page.click('#play');assert.equal((await state()).playing,false);report.checks.push('canonical walking, play, pause, scrub');
   await page.selectOption('#pose','idle');await page.selectOption('#focus','head');await settle();await capture('05-head');await page.selectOption('#focus','eyes');await settle();await capture('06-eye');await page.selectOption('#focus','body');
   await page.locator('#advanced').evaluate(e=>e.open=true);await page.locator('#definition').fill('{invalid');await page.click('#load');s=await settle();assert(s.error);assert.deepEqual(s.definition,imported);report.checks.push('invalid JSON preserves displayed definition');
   await page.locator('#advanced').evaluate(e=>e.open=false);
   for(const family of ['ungulate','cursorial','padded','long-neck','proboscidean','winged']){await page.selectOption('#demo',family);await page.click('#demo-load');s=await settle();assert.equal(s.definition.genome.morphology.family,family);assert.equal(s.error,null);}
   await page.selectOption('#stage','juvenile');await page.click('#demo-load');s=await settle();assert.equal(s.definition.genome.appearance.growth.stage,'juvenile');report.checks.push('six canonical families and young specimens');
   await page.selectOption('#demo','ungulate');await page.selectOption('#stage','adult');await page.click('#demo-load');await page.click('#tab-shape');await page.selectOption('#view','three-quarter');await page.setViewportSize({width:390,height:844});await settle();await capture('07-mobile');
   const layout=await page.evaluate(()=>{const v=document.querySelector('#viewport').getBoundingClientRect(),p=document.querySelector('.side-panel').getBoundingClientRect();return {viewport:v.height,panel:p.height,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert(layout.viewport>180);assert(layout.panel>250);assert.equal(layout.overflow,false);report.checks.push('mobile controls and viewport remain usable');
   assert.deepEqual(report.errors,[]);report.ok=true;
  }finally{await browser.close();}
 });
}catch(e){report.error=e.stack;throw e;}finally{await server.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
