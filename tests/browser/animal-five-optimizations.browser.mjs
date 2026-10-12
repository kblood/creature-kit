import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(root,'test-results','animal-five-optimizations',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out,{recursive:true});const server=await preview({root:resolve(root,'apps/creature-lab'),configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:false}}),report={ok:false,errors:[],runs:[],allocations:[]};
try{await withGpuLock({owner:'five-animal-optimizations',timeoutMs:600000,retryMs:10000},async()=>{
 const browser=await chromium.launch({headless:true,args:browserArgs});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const settle=()=>page.waitForFunction(()=>window.__animalBenchmark?.ready&&!window.__animalBenchmark.state.building,{},{timeout:90000});
  await page.goto(new URL('benchmark.html',server.resolvedUrls.local[0]).href);await settle();
  await page.selectOption('#count','128');await settle();await page.selectOption('#collection','mixed');await settle();await page.check('#shadows');await settle();await page.uncheck('#culling');await settle();await page.check('#atlas-renderer');await settle();await page.selectOption('#duration','5');
  const cdp=await page.context().newCDPSession(page);await page.click('#compare-all');
  for(let i=0;i<2;i++){
   await page.waitForFunction(index=>window.__animalBenchmark.running&&window.__animalBenchmark.results.length===index&&document.getElementById('bench-status').textContent.startsWith('Measuring'),i,{timeout:90000});
   await cdp.send('HeapProfiler.startSampling',{samplingInterval:1024,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
   await page.waitForFunction(index=>window.__animalBenchmark.results.length>index,i,{timeout:30000});
   const {profile}=await cdp.send('HeapProfiler.stopSampling');await writeFile(join(out,`allocation-${i}.json`),JSON.stringify(profile));
   let total=0;const functions=[];const visit=node=>{total+=node.selfSize;if(node.selfSize)functions.push({function:node.callFrame.functionName,url:node.callFrame.url,bytes:node.selfSize});for(const child of node.children)visit(child);};visit(profile.head);
   report.allocations.push({sampledHeapBytes:total,samples:profile.samples.length,topFunctions:functions.sort((a,b)=>b.bytes-a.bytes).slice(0,15)});
  }
  await page.waitForFunction(()=>!window.__animalBenchmark.running,{},{timeout:30000});report.runs=await page.evaluate(()=>window.__animalBenchmark.results);
  assert.equal(report.runs.length,2);const [a,b]=report.runs;assert(a.settings.atlasRenderer&&b.settings.atlasRenderer);assert(!a.settings.adaptiveAnimation&&b.settings.adaptiveAnimation);assert(!a.settings.reuseWorkingBuffers&&b.settings.reuseWorkingBuffers);
  assert.equal(a.simulationStartSeconds,b.simulationStartSeconds);assert.deepEqual(a.scene,b.scene);assert.deepEqual(a.camera,b.camera);assert.equal(a.visibleAnimals.median,b.visibleAnimals.median);
  assert(b.poseCalculations.mean<a.poseCalculations.mean);assert(b.paletteUploadBytes.mean<a.paletteUploadBytes.mean);assert(b.atlasDiagnostics.fastBoneMatrices>0);assert(b.atlasDiagnostics.temporalFrames>0);
  assert(report.allocations.every(a=>a.samples>0));await page.screenshot({path:join(out,'comparison.png')});assert.deepEqual(report.errors,[]);report.ok=true;
 }finally{await browser.close();}
});}catch(error){report.failure=String(error.stack);process.exitCode=1;}finally{await new Promise(done=>server.httpServer.close(done));await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,out,failure:report.failure,runs:report.runs.map(r=>({cpu:r.cpuMs.median,gpu:r.gpuMs?.median,poses:r.poseCalculations.mean,uploads:r.paletteUploadBytes.mean})),allocations:report.allocations.map(a=>a.sampledHeapBytes)}));}
