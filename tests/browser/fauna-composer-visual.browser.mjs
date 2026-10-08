// Copied from universe-atlas@7419733 tests/fauna-composer-visual.browser.mjs for the kit's Creature Lab app (apps/creature-lab); adaptations: import paths (review modules under /apps/creature-lab/src/), CREATURE_LAB_URL/CREATURE_LAB_RESULTS, kit dev-server origin.
// Needs `npm run lab:dev` (http://127.0.0.1:5206/apps/creature-lab/) and the GPU browser lock. Listed in apps/creature-lab/PROVENANCE.md.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {browserArgs} from './browser-options.mjs';
import {withGpuLock} from '../helpers/gpu-lock.mjs';

const origin=new URL(process.env.CREATURE_LAB_URL||'http://127.0.0.1:5206').origin;
const output=process.env.CREATURE_LAB_RESULTS||'test-results/fauna-opus-modular-001/independent-visual-001';
await mkdir(output,{recursive:false});
const sourceFiles=['fauna-composer.ts','fauna-composer-recipe.ts','fauna-composer-rig.ts','fauna-composer-mesh.ts'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,createHash('sha256').update(await readFile(new URL(`../../src/${name}`,import.meta.url))).digest('hex')])));
let planetLighting=null;
const before=await snapshot(),errors=[],samples=[],planetSamples=[];
// Second pass: the in-game planet-noon light with cast shadows, one fixed orthographic camera for every preset
// (true metre scale: a giraffe is drawn taller than a bird), a 1 m grid on a planet-albedo ground.
const METRE_VIEW={halfHeightM:3.4,centreY:2.9,width:1280,height:720};
const planetHtml=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#a9c0d6;color:white;font:16px system-ui}canvas{display:block}#label{position:absolute;left:18px;top:14px;background:#202529dd;padding:10px;max-width:900px}</style><div id="label"></div><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {createComposerCreature} from '/src/fauna-composer.ts';
import {COMPOSER_PRESETS,composerPreset} from '/src/fauna-composer-recipe.ts';
import {applyFaunaReviewLighting,faunaReviewFillKeyRatio} from '/apps/creature-lab/src/fauna-review-environment.ts';
import {fitFaunaReviewShadow,FAUNA_REVIEW_SHADOWS} from '/apps/creature-lab/src/fauna-review-lighting.ts';
const V=${JSON.stringify(METRE_VIEW)};
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(V.width,V.height);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
const scene=new THREE.Scene(),lab=applyFaunaReviewLighting(scene,'planet-noon');renderer.toneMappingExposure=lab.preset.exposure;lab.key.castShadow=true;scene.add(lab.key.target);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:lab.preset.ground,roughness:.95}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
const grid=new THREE.GridHelper(40,40,0x3e4630,0x55603f);grid.position.y=.002;scene.add(grid);
// Metre ruler: alternating 1 m blocks, 6 m high, at the left of the frame.
for(let k=0;k<6;k++){const block=new THREE.Mesh(new THREE.BoxGeometry(.12,1,.12),new THREE.MeshStandardMaterial({color:k%2?0xf2f2f2:0x202020}));block.position.set(-V.halfHeightM*V.width/V.height+.4,k+.5,0);block.castShadow=true;scene.add(block);}
const aspect=V.width/V.height,camera=new THREE.OrthographicCamera(-V.halfHeightM*aspect,V.halfHeightM*aspect,V.halfHeightM,-V.halfHeightM,.1,200);
camera.position.set(0,V.centreY+6,40);camera.lookAt(0,V.centreY,0);camera.updateMatrixWorld(true);let animal;
window.planet={ids:Object.keys(COMPOSER_PRESETS),draw(id){if(animal)animal.dispose();animal=createComposerCreature(composerPreset(id));animal.mesh.castShadow=true;scene.add(animal.group);animal.update('neutral',0);
 const b=animal.bounds(),c=b.getCenter(new THREE.Vector3());animal.group.position.set(-c.x,0,-c.z);scene.updateMatrixWorld(true);const placed=animal.bounds();
 fitFaunaReviewShadow(lab.key,placed,{groundY:0,depthBiasM:FAUNA_REVIEW_SHADOWS.depthBiasM,normalBiasM:FAUNA_REVIEW_SHADOWS.normalBiasM});
 document.querySelector('#label').textContent=id+' · side · planet-noon · fixed scale, ruler blocks and grid squares = 1 m · experimental geometry';renderer.render(scene,camera);
 return {id,bounds:{min:placed.min.toArray(),max:placed.max.toArray()},inFrame:placed.max.y<=V.centreY+V.halfHeightM&&placed.min.x>=-V.halfHeightM*aspect&&placed.max.x<=V.halfHeightM*aspect,details:animal.details(),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}};},
 lighting:()=>({preset:lab.preset.id,shadows:renderer.shadowMap.enabled&&lab.key.castShadow,fillKeyRatio:faunaReviewFillKeyRatio(lab.preset),exposure:renderer.toneMappingExposure}),
 dispose(){animal?.dispose();lab.dispose();renderer.dispose();}};
</script>`;
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#343a3d;color:white;font:16px system-ui}canvas{display:block}#label{position:absolute;left:18px;top:14px;background:#202529dd;padding:10px;max-width:820px}</style><div id="label"></div><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {createComposerCreature} from '/src/fauna-composer.ts';
import {COMPOSER_PRESETS,composerPreset} from '/src/fauna-composer-recipe.ts';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,720);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#343a3d');scene.add(new THREE.HemisphereLight(0xe4edff,0x6a6258,2));const light=new THREE.DirectionalLight(0xfff1df,3);light.position.set(4,7,5);scene.add(light);renderer.shadowMap.enabled=false;
const grid=new THREE.GridHelper(14,28,0x727d81,0x4a5358);grid.position.y=-.01;scene.add(grid);
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.001,1000);let animal;
function frame(box,view){const centre=box.getCenter(new THREE.Vector3());const direction=new THREE.Vector3(...(view==='side'?[0,.12,1]:view==='front'?[1,.1,0]:[1.2,.65,1.6])).normalize();camera.position.copy(centre).addScaledVector(direction,box.getSize(new THREE.Vector3()).length()*3+1);camera.lookAt(centre);camera.updateMatrixWorld(true);let maxX=0,maxY=0;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y));}const half=Math.max(maxY,maxX/(960/720),.05)*1.25;camera.top=half;camera.bottom=-half;camera.left=-half*960/720;camera.right=half*960/720;camera.updateProjectionMatrix();}
window.specimen={ids:Object.keys(COMPOSER_PRESETS),draw(id,view,motion='neutral',time=0){if(animal)animal.dispose();animal=createComposerCreature(composerPreset(id));scene.add(animal.group);animal.update(motion,time);scene.updateMatrixWorld(true);renderer.render(scene,camera);const bounds=animal.bounds();frame(bounds,view);document.querySelector('#label').textContent=id+' · '+view+' · '+motion+' '+time+'s · experimental geometry';renderer.render(scene,camera);const b={min:bounds.min.toArray(),max:bounds.max.toArray()};return {id,view,motion,time,recipe:composerPreset(id),bounds:b,details:animal.details(),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory}}};},dispose(){animal?.dispose();renderer.dispose();}};
</script>`;
await withGpuLock({owner:'composer-independent-visual',timeoutMs:60000,staleMs:Infinity},async()=>{
 const browser=await chromium.launch({headless:true,args:browserArgs});
 try{
  const page=await browser.newPage({viewport:{width:960,height:720}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/tests/composer-independent-review.html',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(origin+'/tests/composer-independent-review.html');
  await page.waitForFunction(()=>window.specimen, null,{timeout:30000});
  const ids=await page.evaluate(()=>window.specimen.ids);assert.equal(ids.length,12);
  for(const id of ids)for(const [view,motion,time] of [['hero','neutral',0],['side','neutral',0],['front','neutral',0],['hero','walk',.35]]){
   const sample=await page.evaluate(args=>window.specimen.draw(...args),[id,view,motion,time]);
   assert(sample.bounds.min.concat(sample.bounds.max).every(Number.isFinite),`${id}: finite actual posed bounds`);
   assert(sample.details.withinBudget,`${id}: declared budget`);assert(sample.details.vertices>0&&sample.details.triangles>0);
   const file=`${id}-${view}-${motion}.png`;await page.screenshot({path:join(output,file)});samples.push({...sample,file});console.log(file);
  }
  await page.evaluate(()=>window.specimen.dispose());
  // Pass 2: planet-noon, shadows, fixed metre-scale orthographic camera.
  await page.setViewportSize({width:METRE_VIEW.width,height:METRE_VIEW.height});
  await page.route('**/tests/composer-planet-review.html',route=>route.fulfill({contentType:'text/html',body:planetHtml}));
  await page.goto(origin+'/tests/composer-planet-review.html');
  await page.waitForFunction(()=>window.planet,null,{timeout:30000});
  for(const id of await page.evaluate(()=>window.planet.ids)){
   const sample=await page.evaluate(id=>window.planet.draw(id),id);
   assert(sample.bounds.min.concat(sample.bounds.max).every(Number.isFinite),`${id}: finite planet-pass bounds`);
   assert(sample.inFrame,`${id}: fits the fixed metre-scale frame`);
   const file=`planet-noon-${id}-side.png`;await page.screenshot({path:join(output,file)});planetSamples.push({...sample,file});console.log(file);
  }
  planetLighting=await page.evaluate(()=>window.planet.lighting());
  assert.equal(planetLighting.preset,'planet-noon');assert.equal(planetLighting.shadows,true);
  await page.evaluate(()=>window.planet.dispose());
  const planetFigures=await Promise.all(planetSamples.map(async s=>`<figure><img src="data:image/png;base64,${(await readFile(join(output,s.file))).toString('base64')}"><figcaption>${s.id} · ${(s.bounds.max[1]).toFixed(2)} m tall</figcaption></figure>`));
  await page.setViewportSize({width:1920,height:1200});await page.setContent(`<style>body{margin:0;background:#202529;color:white;font:18px system-ui;display:grid;grid-template-columns:repeat(3,1fr)}figure{margin:0;padding:6px}img{width:100%;display:block}figcaption{padding:4px}</style>${planetFigures.join('')}`);await page.screenshot({path:join(output,'planet-noon-contact-sheet.png'),fullPage:true});
  const figures=await Promise.all(samples.filter(s=>s.view==='hero'&&s.motion==='neutral').map(async s=>`<figure><img src="data:image/png;base64,${(await readFile(join(output,s.file))).toString('base64')}"><figcaption>${s.id}</figcaption></figure>`));
  await page.setViewportSize({width:1920,height:1560});await page.setContent(`<style>body{margin:0;background:#202529;color:white;font:20px system-ui;display:grid;grid-template-columns:repeat(4,1fr)}figure{margin:0;padding:6px}img{width:100%;display:block}figcaption{padding:4px}</style>${figures.join('')}`);await page.screenshot({path:join(output,'contact-sheet.png'),fullPage:true});
 }finally{await browser.close();}
});
const after=await snapshot();
await writeFile(join(output,'report.json'),JSON.stringify({technicalChecks:errors.length===0,visualAcceptance:false,errors,sourceBefore:before,sourceAfter:after,sourceStable:JSON.stringify(before)===JSON.stringify(after),lighting:{preset:'planet-noon',shadows:true,metreScaleComparison:true,fillKeyRatio:planetLighting.fillKeyRatio,exposure:planetLighting.exposure,camera:{kind:'orthographic',...METRE_VIEW},
  firstPass:{shadows:false,reason:'Isolate actual geometry and attachments from renderer shadow artifacts',normalizedFraming:true,metreScaleComparison:false}},samples,planetSamples},null,2));
assert.deepEqual(errors,[],'No browser errors');console.log('GPU clear; inspect images before visual acceptance.');
