import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
import {composerPreset,encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';
import {buildComposerGraph,composerMotionPeriod} from '../../src/fauna-composer-rig.ts';

const kit=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.env.CREATURE_LAB_RESULTS??join(kit,'test-results','animal-motion',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(output,{recursive:true});
const base=process.env.CREATURE_LAB_URL;
if(!base)throw new Error('Run through npm run test:browser -- --only animal-motion');
const report={ok:false,url:base,checks:[],errors:[]};
const recipe=composerPreset('bird'),graph=buildComposerGraph(recipe),period=composerMotionPeriod(graph,'fly');
const editor=new URL('creature-lab.html',base);editor.search=new URLSearchParams({mode:'composer',recipe:encodeComposerRecipe(recipe),motion:'idle',time:'0',view:'side'}).toString();
let benchmarkUrl;
async function browserPhase(name,work){
 await withGpuLock({owner:`animal-motion-${name}`,timeoutMs:600000,retryMs:10000},async()=>{
  const browser=await chromium.launch({headless:true,args:browserArgs});
  try{const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));await work(page);}
  finally{await browser.close();}
 });
}
try{
 await browserPhase('preview',async page=>{
  const settle=async()=>{await page.waitForFunction(()=>window.__creatureLab?.ready&&!window.__creatureLab.composer.building);return page.evaluate(()=>window.__creatureLab.composer);};
  await page.goto(editor.href);const idle=await settle();assert.equal(idle.playing,false);
  const choices=await page.locator('#composer-motion option').evaluateAll(os=>os.map(o=>o.value));
  for(const motion of ['run','eat','fly','glide'])assert(choices.includes(motion));
  await page.selectOption('#composer-motion','fly');let flight=await settle();
  const finite=s=>assert(s.actors.every(a=>a.pose.positions.every(Number.isFinite)&&a.bounds.min.every(Number.isFinite)&&a.bounds.max.every(Number.isFinite)));
  finite(flight);assert(flight.actors[0].bounds.min[1]>idle.actors[0].bounds.min[1]+.1);
  assert(flight.actors[0].pose.contacts.every(c=>!c.stance));
  const wingIndices=graph.limbs.filter(l=>l.kind==='wing').flatMap(l=>l.bones);
  await page.locator('#composer-time').fill(String(period/2));await page.locator('#composer-time').dispatchEvent('input');flight=await settle();const a=flight.actors[0].pose.positions;
  await page.locator('#composer-time').fill(String(period/4));await page.locator('#composer-time').dispatchEvent('input');flight=await settle();const b=flight.actors[0].pose.positions;
  assert(wingIndices.some(i=>Math.hypot(a[i*3]-b[i*3],a[i*3+1]-b[i*3+1],a[i*3+2]-b[i*3+2])>.02),'wing joints must move through the flight cycle');
  assert(Math.abs(Number(await page.locator('#composer-phase').inputValue())-.25)<.01);
  for(const lod of ['source','4500','1000']){
   await page.selectOption('#composer-lod-first',lod);flight=await settle();finite(flight);assert.equal(flight.motion,'fly');assert(flight.actors[0].bounds.min[1]>.1);
   await page.locator('#viewport').screenshot({path:join(output,`bird-fly-${lod}.png`)});
   report.checks.push({motion:'fly',lod,triangles:flight.actors[0].details.triangles,bounds:flight.actors[0].bounds});
  }
  await page.selectOption('#composer-motion','glide');const glide=await settle();finite(glide);assert(glide.actors[0].bounds.min[1]>.1);
  await page.locator('#viewport').screenshot({path:join(output,'bird-glide-far.png')});
  for(const motion of ['run','eat']){await page.selectOption('#composer-motion',motion);finite(await settle());}
  await page.selectOption('#composer-motion','fly');await settle();await page.click('#benchmark-open');await page.waitForFunction(()=>window.__animalBenchmark?.ready);assert.equal(await page.locator('#motion').inputValue(),'fly');benchmarkUrl=page.url();
  report.checks.push('new motion choices, airborne flight/glide, moving wing joints, phase scrubbing, finite running/eating, benchmark transfer');
 });
 await browserPhase('wingless',async page=>{
  const u=new URL(editor);u.searchParams.set('recipe',encodeComposerRecipe(composerPreset('giraffe')));u.searchParams.set('motion','fly');
  await page.goto(u.href);await page.waitForFunction(()=>window.__creatureLab?.ready);
  const s=await page.evaluate(()=>window.__creatureLab.composer);assert.equal(s.error,null);assert(s.actors[0].bounds.min[1]<.1);
  assert.match(await page.locator('#composer-constraints').innerText(),/no wings.*remains standing/s);report.checks.push('wingless flight remains grounded with visible explanation');
 });
 await browserPhase('gallop',async page=>{
  const recipe=composerPreset('giraffe'),g=buildComposerGraph(recipe),u=new URL(editor);
  u.searchParams.set('recipe',encodeComposerRecipe(recipe));u.searchParams.set('motion','run');
  await page.goto(u.href);
  const settle=async()=>{await page.waitForFunction(()=>window.__creatureLab?.ready&&!window.__creatureLab.composer.building);return page.evaluate(()=>window.__creatureLab.composer);};
  await settle();
  for(const lod of ['source','4500','1000']){
   await page.selectOption('#composer-lod-first',lod);await settle();
   for(const [name,phase] of [['hind-support',.12],['suspension',.37]]){
    const time=((phase-g.traits.motion.phase+1)%1)*composerMotionPeriod(g,'run');
    await page.locator('#composer-time').fill(String(time));await page.locator('#composer-time').dispatchEvent('input');
    const state=await settle(),actor=state.actors[0];
    assert.equal(state.motion,'run');assert(actor.pose.positions.every(Number.isFinite));
    if(name==='suspension'){
     assert(actor.pose.contacts.every(c=>!c.stance));
     assert(actor.pose.contacts.every(c=>c.contact[1]>.01));
     assert(actor.bounds.min[1]>.01,'actual rendered skin leaves the ground');
    }else assert(actor.pose.contacts.some(c=>c.stance));
    await page.locator('#viewport').screenshot({path:join(output,`giraffe-run-${lod}-${name}.png`)});
    report.checks.push({motion:'run',lod,phase,suspension:name==='suspension',bounds:actor.bounds});
   }
  }
 });
 await browserPhase('benchmark',async page=>{
  const settle=()=>page.waitForFunction(()=>window.__animalBenchmark?.ready&&!window.__animalBenchmark.state.building);
  await page.goto(benchmarkUrl);await settle();await page.selectOption('#count','16');await settle();await page.selectOption('#lod','1000');await settle();
  assert.equal(await page.evaluate(()=>window.__animalBenchmark.settings.motion),'fly');
  const before=await page.evaluate(()=>window.__animalBenchmark.state.time);await page.waitForFunction(t=>window.__animalBenchmark.state.time>t+.05,before);assert.equal(await page.evaluate(()=>window.__animalBenchmark.state.members.length),16);
  await page.locator('#viewport').screenshot({path:join(output,'bird-flight-population.png')});
  await page.selectOption('#motion','glide');await settle();assert.equal(await page.evaluate(()=>window.__animalBenchmark.settings.motion),'glide');
  await page.uncheck('#instancing');await settle();assert.equal(await page.evaluate(()=>window.__animalBenchmark.settings.motion),'glide');
  await page.selectOption('#duration','5');await page.click('#measure');await page.waitForFunction(()=>!window.__animalBenchmark.running&&window.__animalBenchmark.results.length===1,null,{timeout:30000});
  const result=await page.evaluate(()=>window.__animalBenchmark.results[0]);assert.equal(result.settings.motion,'glide');assert(result.frameMs.samples>=10);
  const download=page.waitForEvent('download');await page.click('#export');await (await download).saveAs(join(output,'flight-benchmark.json'));const exported=JSON.parse(await readFile(join(output,'flight-benchmark.json'),'utf8'));assert.equal(exported.results[0].settings.motion,'glide');
  await page.click('#edit-animal');await page.waitForFunction(()=>window.__creatureLab?.ready);assert.equal(await page.locator('#composer-motion').inputValue(),'glide');
  report.checks.push('population animation clock, instanced/separate motion selection, recorded/exported motion, return to editor');
 });
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,error:report.error,output,checks:report.checks.length}));}
