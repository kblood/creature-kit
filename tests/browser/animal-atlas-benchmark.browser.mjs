import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(root,'test-results','animal-atlas-benchmark',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out,{recursive:true});const server=await preview({root:resolve(root,'apps/creature-lab'),configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:false}});
const report={ok:false,checks:[],errors:[]};
try{await withGpuLock({owner:'actual-atlas-benchmark',timeoutMs:600000,retryMs:10000},async()=>{
 const browser=await chromium.launch({headless:true,args:browserArgs});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const state=()=>page.evaluate(()=>window.__animalBenchmark.state);
  const settled=()=>page.waitForFunction(()=>window.__animalBenchmark?.ready&&!window.__animalBenchmark.state.building,{},{timeout:90000});
  const admitted=()=>page.waitForFunction(()=>{const s=window.__animalBenchmark?.state;return s?.atlas&&s.atlas.active>0&&!s.atlas.running&&!s.atlas.upgradesPending&&s.atlas.stagedSources===0;},{},{timeout:20000}).catch(async error=>{report.live=await state();throw error;});
  await page.goto(new URL('benchmark.html',server.resolvedUrls.local[0]).href);await settled();await page.check('#atlas-renderer');await settled();await admitted();
  let s=await state();assert.equal(s.atlas.mergedTiers.far.ownership,'composer-gpu-arena-1');assert(s.atlas.mergedTiers.far.records>0);assert(s.atlas.active>0);assert(s.atlas.paletteUploadCount>0);
  await page.selectOption('#collection','mixed');await settled();await admitted();s=await state();assert.equal(s.sources.length,6);assert(s.atlas.mergedTiers.far.records>0);assert(s.atlas.mergedTiers.middle.records>0);
  await page.screenshot({path:join(out,'mixed-atlas-packed.png')});
  await page.selectOption('#duration','5');await page.click('#compare-uploads');await page.waitForFunction(()=>!window.__animalBenchmark.running&&window.__animalBenchmark.results.length===2,{},{timeout:90000});
  const results=await page.evaluate(()=>window.__animalBenchmark.results);assert(results.every(r=>r.settings.atlasRenderer&&r.frameMs.samples>10));assert(!results[0].settings.partialUploads);assert(results[1].settings.partialUploads);assert.equal(results[0].simulationStartSeconds,results[1].simulationStartSeconds);assert.deepEqual(results[0].scene,results[1].scene);
  assert(results[1].paletteUploadBytes.mean<results[0].paletteUploadBytes.mean);report.checks.push({kind:'actual shared Atlas packed arenas with measured partial/full upload counters',results});
  await page.uncheck('#atlas-renderer');await settled();await page.check('#atlas-renderer');await settled();await admitted();assert.deepEqual(report.errors,[]);report.ok=true;
 }finally{await browser.close();}
});}catch(error){report.failure=String(error.stack);process.exitCode=1;}finally{await new Promise(done=>server.httpServer.close(done));await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,out,failure:report.failure}));}
