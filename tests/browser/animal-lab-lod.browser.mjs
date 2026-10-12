import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
import {generateCreatureGenome} from '../../src/planet-v1/creature-model.ts';
import {planetComposerDefinition,serializePlanetComposerDefinition} from '../../src/planet-composer.ts';

const kit=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.env.CREATURE_LAB_RESULTS??join(kit,'test-results','animal-lab-lod',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(output,{recursive:true});
const server=process.env.CREATURE_LAB_URL?null:await preview({root:resolve(kit,'apps/creature-lab'),configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:5287,strictPort:false}});
const base=process.env.CREATURE_LAB_URL??server.resolvedUrls.local[0];
const report={ok:false,url:base,checks:[],errors:[]};
try{
 await withGpuLock({owner:'animal-lab-lod-preview',timeoutMs:600000,retryMs:10000},async()=>{
  const browser=await chromium.launch({headless:true,args:browserArgs});
  try{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
   const settle=async()=>{await page.waitForFunction(()=>window.__creatureLab?.ready&&!window.__creatureLab.composer.building);return page.evaluate(()=>window.__creatureLab.composer);};
   const pause=async()=>{if((await settle()).playing)await page.click('#composer-play');};
   await page.goto(base,{waitUntil:'networkidle'});await pause();
   assert.equal(await page.locator('#composer-lod-second').isDisabled(),true);
   for(const preset of ['dinosaur','turtle','worm','centipede','giraffe']){
    await page.selectOption('#composer-preset',preset);await settle();
    await page.click('#composer-lod-compare');let s=await settle();
    assert.equal(s.actors.length,2);assert.equal(s.actors[0].encoded,s.actors[1].encoded);
    assert.deepEqual(s.actors[0].pose,s.actors[1].pose);
    assert(s.actors[1].details.triangles<s.actors[0].details.triangles);
    const far=s.actors[1].details.triangles;
    await page.selectOption('#composer-lod-second','4500');s=await settle();
    assert(s.actors[1].details.triangles>=far);
    assert.deepEqual(s.actors[0].pose,s.actors[1].pose);
    await page.selectOption('#composer-lod-second','1000');await settle();
    await page.screenshot({path:join(output,`${preset}-source-far.png`)});
    report.checks.push({preset,source:s.actors[0].details.triangles,middle:s.actors[1].details.triangles,far});
   }
   const definition=planetComposerDefinition(generateCreatureGenome('lab-lod-browser','runner'),{individualId:'original/planet/member',speciesId:'original/planet/species'});
   const target=new URL('creature-lab.html?mode=composer&presentation=realism-1&time=0.375',base);
   target.hash=new URLSearchParams({planetDefinition:serializePlanetComposerDefinition(definition)}).toString();
   await page.goto(target.href,{waitUntil:'networkidle'});await pause();await page.click('#composer-lod-compare');let s=await settle();
   for(const a of s.actors)assert.deepEqual(a.planetDefinition,definition);
   assert.deepEqual(s.actors[0].pose,s.actors[1].pose);
   await page.selectOption('#composer-edit-target','second');await page.selectOption('#composer-focus','eyes');await settle();
   assert.equal(await page.evaluate(()=>window.__creatureLab.error),null);
   await page.selectOption('#composer-focus','body');
   await page.click('#composer-play');await page.waitForTimeout(450);s=await settle();assert(s.time>.375);assert.deepEqual(s.actors[0].pose,s.actors[1].pose);await pause();
   await page.screenshot({path:join(output,'planet-source-far.png')});
   await page.setViewportSize({width:375,height:812});await page.screenshot({path:join(output,'mobile.png')});
   assert(await page.locator('#composer-lod-first').isVisible());
   assert(await page.locator('#composer-lod-status').innerText());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   report.checks.push('planet definition preserved, eye framing, common playback clock and mobile controls');
   assert.deepEqual(report.errors,[]);report.ok=true;
  }finally{await browser.close();}
 });
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await new Promise(done=>server?server.httpServer.close(done):done());await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
