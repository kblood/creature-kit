// Exact planet replay through the BUILT Lab. Run npm run lab:build first.
// Output is disposable and must be a new directory; GPU browsers use the shared lock.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
import {generateCreatureGenome,realisticIndividualCreatureGenome} from '../../src/planet-v1/creature-model.ts';
import {planetComposerDefinition,buildPlanetComposerSource} from '../../src/planet-composer.ts';
import {readComposerGlb} from '../../src/fauna-composer-export.ts';
import {editLabPlanetDimension,serializeLabPlanetDefinition,labPlanetColourLinear} from '../../apps/creature-lab/src/creature-lab-planet.ts';

const kit=fileURLToPath(new URL('../..',import.meta.url));
const output=resolve(process.env.CREATURE_LAB_RESULTS||join(kit,'test-results',`planet-composer-lab-${Date.now()}`));await mkdir(output,{recursive:false});
const first=planetComposerDefinition(realisticIndividualCreatureGenome(generateCreatureGenome('lab-browser/real-planet','runner'),'lab-browser/individual',2,'juvenile','proboscidean'),{individualId:'planet/member-27',speciesId:'planet/species-4'});
const second=editLabPlanetDimension(first,'bodyLength',first.phenotype.dimensions.bodyLength*1.15);
function digest(p){let a=0,b=0;for(let i=0;i<p.length;i++){a=(a+Math.round(p[i]*1e5)*((i%251)+1))%2147483647;b=(b*31+Math.round(p[i]*1e4))%2147483647;}return `${p.length/3}:${a.toString(36)}:${b.toString(36)}`;}
function expected(d){const s=buildPlanetComposerSource(d);return {skinDigest:digest(s.skin.positions),colorDigest:digest(s.skin.colors),bones:s.graph.bones.length};}
const firstExpected=expected(first),secondExpected=expected(second),errors=[],checks=[];
const server=await createServer({configFile:false,root:join(kit,'apps/creature-lab/dist'),publicDir:false,server:{host:'127.0.0.1',port:5587,strictPort:false}});await server.listen();
const base=new URL('creature-lab.html',server.resolvedUrls.local[0]);
try{await withGpuLock({owner:'planet-composer-lab-replay',timeoutMs:120000,staleMs:Infinity},async()=>{
 const browser=await chromium.launch({headless:true,args:browserArgs});let page;
 try{
  page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
  const inspect=()=>page.evaluate(()=>JSON.parse(JSON.stringify({ready:window.__creatureLab?.ready,error:window.__creatureLab?.error,state:window.__creatureLab?.specimenState,url:window.__creatureLab?.specimenUrl,composer:window.__creatureLab?.composer})));
  const settled=async()=>{await page.waitForFunction(()=>window.__creatureLab?.ready&&!window.__creatureLab.composer.building,null,{timeout:20000});const s=await inspect();assert.equal(s.error,null);return s;};
  const setNumber=async(id,value)=>{await page.fill(id,String(value));await page.dispatchEvent(id,'change');return settled();};
  const url=new URL(base);url.search=new URLSearchParams({compare:'1',motion:'neutral',time:'0',view:'side',presentation:'realism-1'}).toString();url.hash=new URLSearchParams({planetDefinition:serializeLabPlanetDefinition(first),comparePlanetDefinition:serializeLabPlanetDefinition(second)}).toString();
  await page.goto(url.href,{waitUntil:'networkidle'});let s=await settled();assert.equal(s.composer.actors.length,2);assert.equal(s.composer.playing,false);
  for(const [i,d,e] of [[0,first,firstExpected],[1,second,secondExpected]]){const a=s.composer.actors[i];assert.deepEqual(a.planetDefinition,d);assert.equal(a.skinDigest,e.skinDigest);assert.equal(a.colorDigest,e.colorDigest);assert.equal(a.details.bones,e.bones);assert.equal(a.individual.maturity,d.phenotype.identity.maturity);assert.equal(a.individual.stage,'juvenile');}
  for(const key of ['bodyLength','girth','maturity','individualSeed','palette','layout'])assert.equal(await page.isDisabled(`#composer-${key}`),true,key);
  assert.equal(await page.isDisabled('#composer-head'),false);assert.equal(await page.isDisabled('#composer-resolved-bodyLength'),false);assert.equal(await page.isDisabled('#composer-resolved-trunkLength'),false);
  assert.equal(await page.inputValue('#composer-resolved-bodyLength'),String(first.phenotype.dimensions.bodyLength));
  await page.screenshot({path:join(output,'01-exact-planet-pair.png')});checks.push({check:'exact-source-replay',first:firstExpected,second:secondExpected});
  await page.selectOption('#composer-edit-target','second');const changedLength=second.phenotype.dimensions.bodyLength+.17;s=await setNumber('#composer-resolved-bodyLength',changedLength);assert.equal(s.composer.actors[0].skinDigest,firstExpected.skinDigest);assert.notEqual(s.composer.actors[1].skinDigest,secondExpected.skinDigest);
  await page.locator('#composer-resolved-colour-base').evaluate(el=>{el.value='#d74a19';el.dispatchEvent(new Event('change',{bubbles:true}));});s=await settled();const edited=s.composer.actors[1].planetDefinition;
  assert.equal(edited.phenotype.dimensions.bodyLength,changedLength);assert.deepEqual(edited.phenotype.coat.colours.base,labPlanetColourLinear('#d74a19'));assert.deepEqual(edited.genome,first.genome);assert.deepEqual(edited.phenotype.identity,first.phenotype.identity);assert.deepEqual(edited.phenotype.coat.colours.accent,first.phenotype.coat.colours.accent);
  assert.equal(s.composer.actors[1].skinDigest,expected(edited).skinDigest);assert.equal(s.composer.actors[1].colorDigest,expected(edited).colorDigest);
  await page.selectOption('#composer-eyes','gecko');s=await settled();assert.equal(s.composer.actors[1].recipe.eyes,'gecko');assert.deepEqual(s.composer.actors[1].planetDefinition.phenotype,edited.phenotype);
  const selected=s.composer.actors[1].planetDefinition;
  const share=s.url;assert.equal(new URL(share).searchParams.has('recipe'),false);assert.equal(new URL(share).searchParams.has('compareRecipe'),false);const pairedBefore=s.composer.actors.map(a=>[a.skinDigest,a.colorDigest,a.planetDefinition]);await page.goto(share,{waitUntil:'networkidle'});s=await settled();assert.deepEqual(s.composer.actors.map(a=>[a.skinDigest,a.colorDigest,a.planetDefinition]),pairedBefore);
  await page.selectOption('#composer-edit-target','second');
  const [jsonDownload]=await Promise.all([page.waitForEvent('download'),page.click('#export-json')]);const jsonPath=join(output,'complete-lab.json');await jsonDownload.saveAs(jsonPath);const json=JSON.parse(await readFile(jsonPath,'utf8'));assert.deepEqual(JSON.parse(json.state.comparePlanetDefinition),selected);
  const [glbDownload]=await Promise.all([page.waitForEvent('download',{timeout:30000}),page.click('#export-glb')]);const glbPath=join(output,'selected-planet.glb');await glbDownload.saveAs(glbPath);const glb=readComposerGlb(new Uint8Array(await readFile(glbPath))).json;assert.deepEqual(glb.asset.extras.composer.phenotype,selected.phenotype);assert.equal(glb.asset.extras.composer.phenotype.identity.individualId,'planet/member-27');
  const [reportDownload]=await Promise.all([page.waitForEvent('download'),page.click('#export-report')]);const reportPath=join(output,'selected-export-report.json');await reportDownload.saveAs(reportPath);assert.deepEqual(JSON.parse(await readFile(reportPath,'utf8')).planetDefinition,selected);
  await page.locator('.side-panel').evaluate(el=>el.scrollTop=0);await page.screenshot({path:join(output,'02-edited-compared-planet.png')});checks.push({check:'resolved-native-edits-share-json-selected-GLB',selected});
  // Complete Lab JSON restores both definitions after replacing the selected side with an ordinary preset.
  await page.selectOption('#composer-preset','worm');s=await settled();assert.equal(s.composer.actors[1].planetDefinition,undefined);assert.equal(await page.isDisabled('#composer-maturity'),false);assert.equal(await page.locator('#composer-resolved').isHidden(),true);
  await Promise.all([page.waitForEvent('load'),page.setInputFiles('#import-file',jsonPath)]);s=await settled();assert.deepEqual(s.composer.actors.map(a=>[a.skinDigest,a.colorDigest,a.planetDefinition]),pairedBefore);
  // A plain definition replaces only the selected side; rejected input preserves both existing animals.
  await page.selectOption('#composer-edit-target','second');await page.setInputFiles('#import-file',{name:'planet.json',mimeType:'application/json',buffer:Buffer.from(serializeLabPlanetDefinition(first))});s=await settled();assert.deepEqual(s.composer.actors[0].planetDefinition,first);assert.deepEqual(s.composer.actors[1].planetDefinition,first);
  await page.setInputFiles('#import-file',{name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"schema":"planet-composer-definition-1","schema":"bad"}')});await page.waitForFunction(()=>document.getElementById('import-status').textContent.includes('Import failed'));s=await settled();assert.deepEqual(s.composer.actors[1].planetDefinition,first);
  await page.click('#composer-leave-resolved');s=await settled();assert.equal(s.composer.actors[1].planetDefinition,undefined);assert.ok(s.composer.actors[0].planetDefinition);await page.selectOption('#composer-layout','limbless');s=await settled();assert.equal(s.composer.actors[1].recipe.layout,'limbless');
  checks.push({check:'file-import-isolated-sides-invalid-nonmutation-explicit-exit',pass:true});assert.deepEqual(errors,[]);
 }catch(e){if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw e;}finally{await browser.close();}
});}finally{await server.close();await writeFile(join(output,'report.json'),JSON.stringify({checks,errors,source:'built Lab',physicalQuest:'unverified'},null,2));}
console.log(JSON.stringify({pass:true,output,checks:checks.length}));
