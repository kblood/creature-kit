// Independent CPU inspection of the actual composer buffers and Three objects.
// Seeds select appearance; the two sizes are NOT juvenile growth stages.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {composerPreset,COMPOSER_PRESET_IDS,COMPOSER_CHOICES,COMPOSER_RANGES,normalizeComposerRecipe,encodeComposerRecipe,decodeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {buildComposerGraph,COMPOSER_BUDGET} from '../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {COAT_PATTERNS} from '../src/fauna-coat-vocab.ts';
import {FACE_HEADGEAR} from '../src/fauna-composer-face.ts';

const digest=(...arrays)=>{const h=createHash('sha256');for(const a of arrays)h.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));return h.digest('hex');};
const build=input=>{const recipe=normalizeComposerRecipe(input).recipe,graph=buildComposerGraph(recipe);return{recipe,graph,skin:buildComposerSkin(graph)};};
/** What createComposerCreature builds: the species recipe through the individual derivation. */
const buildIndividual=input=>build(deriveComposerIndividual(normalizeComposerRecipe(input).recipe).recipe);
const report={scope:'Experimental CPU geometry, structural diversity, deterministic replay and resource ownership; no visual, self-intersection or device acceptance.',corpusDefinition:'12 presets x 4 palette seeds x 2 explicit body sizes; no juvenile control exists',sourceHashes:Object.fromEntries(['recipe','rig','mesh',''].map(s=>{const p=`src/fauna-composer${s?'-'+s:''}.ts`;return[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')];})),corpus:[],structural:[],failures:[]};
after(()=>{if(process.env.COMPOSER_STRUCTURE_REPORT)writeFileSync(process.env.COMPOSER_STRUCTURE_REPORT,JSON.stringify(report,null,2)+'\n');});
function audit({skin:s,graph:g},id,record=true){
 const errors=[];const require=(x,m)=>{if(!x&&errors.length<20)errors.push(m);};
 require(s.positions.length===s.vertexCount*3,'position count');require(s.colors.length===s.positions.length,'color count');require(s.index.length===s.triangleCount*3,'triangle count');require(s.skinIndex.length===s.vertexCount*4&&s.skinWeight.length===s.vertexCount*4,'skin counts');
 require(s.vertexCount>0&&s.vertexCount<=COMPOSER_BUDGET.maxVertices&&s.triangleCount<=COMPOSER_BUDGET.maxTriangles&&g.bones.length<=COMPOSER_BUDGET.maxBones,'actual desktop budget');
 for(const [name,buffer]of Object.entries({positions:s.positions,colors:s.colors,weights:s.skinWeight}))require(buffer.every(Number.isFinite),`finite ${name}`);
 let weightError=0,minTwiceArea=Infinity,degenerate=0;
 for(let i=0;i<s.vertexCount;i++){let total=0;for(let j=0;j<4;j++){const k=4*i+j;require(s.skinIndex[k]<g.bones.length,'bone index');require(s.skinWeight[k]>=0&&s.skinWeight[k]<=1,'weight range');total+=s.skinWeight[k];}weightError=Math.max(weightError,Math.abs(total-1));}
 require(weightError<2e-7,'normalized weights');
 const p=s.positions;for(let k=0;k<s.index.length;k+=3){const ids=[s.index[k],s.index[k+1],s.index[k+2]];require(ids.every(i=>i<s.vertexCount),'vertex index');const[a,b,c]=ids.map(i=>i*3),u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]],area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);minTwiceArea=Math.min(minTwiceArea,area);if(area===0)degenerate++;}
 require(degenerate===0,`${degenerate} exactly zero-area triangles`);
 let next=0;for(const part of s.parts){require(part.firstTriangle===next&&part.triangles>0,'contiguous nonempty part');next+=part.triangles;require(part.bones.every(i=>i<g.bones.length),'part bones');}require(next===s.triangleCount,'all triangles belong to a part');
 const result={id,vertices:s.vertexCount,triangles:s.triangleCount,bones:g.bones.length,weightError,minTwiceArea,degenerate,geometryHash:digest(s.positions,s.index),errors};if(record)report.corpus.push(result);return errors;
}

test('96 actual mixed specimens have finite indexed surfaces, normalized skinning and bounded resources',()=>{
 const failures=[];for(const id of COMPOSER_PRESET_IDS)for(const colorSeed of[0,17,901,9999])for(const factor of[.75,1.25]){const base=composerPreset(id),entry=build({...base,colorSeed,bodyLength:Math.min(6,Math.max(.2,base.bodyLength*factor))}),name=`${id}/${colorSeed}/size-${factor}`,errors=audit(entry,name);if(errors.length)failures.push({name,errors});}
 report.failures.push(...failures);assert.equal(report.corpus.length,96);assert.deepEqual(failures,[]);
});

function partGeometry(skin,parts){const positions=[];for(const p of skin.parts)if(parts.includes(p.part))for(let i=p.firstTriangle*3;i<(p.firstTriangle+p.triangles)*3;i++){const v=skin.index[i]*3;positions.push(...skin.positions.subarray(v,v+3));}return new Float32Array(positions);}
test('every torso/head/surface/appendage choice changes actual geometry with fixed palette and seed',()=>{
 // v3 (fauna-composer-face-1): the trunk is derived from the face, so 'proboscis' is the head choice that grows it
 // (its head-part set includes the trunk); eyes and iris are not structural keys here. Horns are checked per face
 // below, because a face builds only the headgear it can carry.
 const base={...composerPreset('dinosaur'),palette:'earth',colorSeed:1,arms:'grasping',tailLength:1};
 const distinct=(key,variants,parts)=>{const signatures=new Set(),previous=[];for(const[choice,recipe]of variants){const {skin}=build(recipe),a=partGeometry(skin,parts);signatures.add(digest(a));report.structural.push({key,choice,triangles:a.length/9,hash:digest(a)});
   for(const b of previous)if(a.length===b.length){let maxDelta=0;for(let i=0;i<a.length;i++)maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));assert.ok(maxDelta>base.bodyLength*.001,`${key}/${choice}: equal-topology variation must exceed 0.1% of body length`);}previous.push(a);
  }
  assert.equal(signatures.size,variants.length,`${key} choices must change positions/topology, not just colors/labels`);};
 for(const[key,parts]of Object.entries({torso:['torso'],head:['head','mouth','trunk'],armor:['armor'],wings:['wing'],feet:['foot'],hands:['hand'],tail:['torso','tail-tip']}))
  distinct(key,COMPOSER_CHOICES[key].map(choice=>[choice,{...base,[key]:choice}]),parts);
 assert.ok(COMPOSER_CHOICES.head.includes('proboscis'));
 // every built horn kind: nasal, paired and ossicones on a giraffe muzzle, the crest on the dinosaur's jaws
 const giraffe={...composerPreset('giraffe'),palette:'earth',colorSeed:1};
 distinct('horns',[['none',{...giraffe,horns:'none'}],['nasal',{...giraffe,horns:'nasal'}],['paired',{...giraffe,horns:'paired'}],['ossicones',{...giraffe,horns:'ossicones'}],['crest (jaws)',{...base,horns:'crest'}]],['horn']);
 assert.notEqual(digest(partGeometry(build({...base,horns:'crest'}).skin,['horn'])),digest(partGeometry(build({...base,horns:'none'}).skin,['horn'])),'jaws crest is built');
});

test('a horn kind the face does not build is bit-identical to horns none in every skin array',()=>{
 // One specimen per face; every omitted cell of FACE_HEADGEAR (built 'none' for a chosen kind) is checked.
 // The CHOSEN horn stays part of the species identity (composerSpeciesKey hashes the chosen anatomy, projecting only
 // proboscis -> muzzle, so no herd re-rolls), and with variability > 0 the species key seeds the individual draw.
 // An omitted horn is therefore compared at variability 0, the type specimen, where the species key cannot reach the
 // build: there every skin array equals the 'none' build. At the preset variability only 'no horn part' is asserted.
 const specimen={muzzle:'giraffe',proboscis:'trunked-centipede',jaws:'dinosaur',beak:'bird','flat-face':'ape',blunt:'worm',mandibles:'centipede'};
 const all=s=>digest(s.positions,s.index,s.skinIndex,s.skinWeight,s.colors);
 let omitted=0;
 for(const[face,row]of Object.entries(FACE_HEADGEAR)){const recipe={...composerPreset(specimen[face]),head:face},flat={...recipe,variability:0};
  const noneFlat=all(build({...flat,horns:'none'}).skin);
  for(const[horn,cell]of Object.entries(row)){if(horn==='none')continue;
   const flatSkin=build({...flat,horns:horn}).skin;
   if(cell.built!=='none'){assert.notEqual(all(flatSkin),noneFlat,`${face} + ${horn} is built (as ${cell.built}) and must differ from none`);continue;}
   omitted++;
   assert.equal(all(flatSkin),noneFlat,`${face} + ${horn} (variability 0): every skin array equals none`);
   assert.ok(!build({...recipe,horns:horn}).skin.parts.some(p=>p.part==='horn'),`${face} + ${horn}: no horn part`);}}
 assert.equal(omitted,1+3+2+4+4+4,'muzzle 1, proboscis 3, beak 2, flat-face/blunt/mandibles 4 each');
 // the named examples: an ape with a nose horn, a worm with paired horns
 for(const[id,horn]of[['ape','nasal'],['worm','paired']]){const p={...composerPreset(id),variability:0};
  assert.equal(all(build({...p,horns:horn}).skin),all(build(p).skin),`${id} + ${horn} (variability 0)`);}
});

test('legal numeric endpoints and maximal combinations retain finite bounded actual geometry',()=>{
 // The v2 keys (coat, variation strengths, individual seed, maturity, condition) take their extremes too, and every
 // recipe is built through the individual derivation exactly as createComposerCreature builds it, for both sexes.
 const failures=[];for(const layout of COMPOSER_CHOICES.layout)for(const endpoint of[0,1])for(const sex of['female','male']){const recipe={...composerPreset('trunked-centipede'),layout,sex};for(const[key,range]of Object.entries(COMPOSER_RANGES))recipe[key]=range[endpoint];const errors=audit(buildIndividual(recipe),`${layout}/all-${endpoint?'maximum':'minimum'}/${sex}`,false);if(errors.length)failures.push({layout,endpoint,sex,errors});}report.endpointFailures=failures;assert.deepEqual(failures,[]);
});

test('buffer audit rejects real malformed triangle, weight and coordinate negative controls',()=>{
 const entry=build(composerPreset('worm'));
 for(const kind of['triangle','weight','coordinate']){const skin={...entry.skin,positions:entry.skin.positions.slice(),index:entry.skin.index.slice(),skinWeight:entry.skin.skinWeight.slice()};if(kind==='triangle')skin.index[1]=skin.index[0];if(kind==='weight')skin.skinWeight.fill(0,0,4);if(kind==='coordinate')skin.positions[0]=NaN;assert.ok(audit({...entry,skin},kind,false).length>0,`${kind} must fail actual buffer audit`);}
});

test('geometry and skinning reproduce exactly through recipe replay and palette changes preserve structure',()=>{
 for(const id of COMPOSER_PRESET_IDS){const recipe=composerPreset(id),a=build(recipe).skin,b=build(decodeComposerRecipe(encodeComposerRecipe(recipe)).recipe).skin,c=build({...recipe,palette:recipe.palette==='earth'?'slate':'earth',colorSeed:1234}).skin;
  assert.equal(digest(a.positions,a.index,a.skinIndex,a.skinWeight,a.colors),digest(b.positions,b.index,b.skinIndex,b.skinWeight,b.colors),id);
  assert.equal(digest(a.positions,a.index,a.skinIndex,a.skinWeight),digest(c.positions,c.index,c.skinIndex,c.skinWeight),`${id}: palette cannot alter anatomy`);
 }
});

function posedVertices(c){c.group.updateMatrixWorld(true);const p=new THREE.Vector3(),out=new Float64Array(c.skin.vertexCount*3);for(let i=0;i<c.skin.vertexCount;i++){c.mesh.getVertexPosition(i,p).applyMatrix4(c.mesh.matrixWorld);p.toArray(out,i*3);}return out;}
test('actual skinned vertices replay without history and world bounds enclose every posed vertex',()=>{
 const p=new THREE.Vector3();for(const id of COMPOSER_PRESET_IDS){const c=createComposerCreature(composerPreset(id));try{c.group.position.set(2,.4,-3);c.group.rotation.set(.1,.4,-.2);c.group.scale.set(1.1,.9,1.2);
  for(const motion of['neutral','idle','walk','display']){c.update(motion,.731);const first=posedVertices(c),box=c.bounds();assert.ok(first.every(Number.isFinite));for(let i=0;i<first.length;i+=3){p.fromArray(first,i);assert.ok(box.clone().expandByScalar(1e-7).containsPoint(p),`${id}/${motion}: world bounds`);}c.update('walk',12345);c.update('idle',-.8);c.update(motion,.731);assert.equal(digest(first),digest(posedVertices(c)),`${id}/${motion}: seek history`);}
 }finally{c.dispose();}}
});

test('independent instances dispose every owned resource exactly once without damaging a survivor',()=>{
 const a=createComposerCreature(composerPreset('winged-ape-rhino')),b=createComposerCreature(composerPreset('winged-ape-rhino')),parent=new THREE.Group();parent.add(a.group,b.group);
 const coloured=a.mesh.material;a.setNeutral(true);const neutral=a.mesh.material,lines=a.group.getObjectByName('composer-skeleton'),owned=[a.mesh.geometry,coloured,neutral,lines.geometry,lines.material],counts=new Map(owned.map(x=>[x,0]));for(const x of owned)x.addEventListener('dispose',()=>counts.set(x,counts.get(x)+1));
 let skeletonDisposals=0;const disposeSkeleton=a.mesh.skeleton.dispose.bind(a.mesh.skeleton);a.mesh.skeleton.dispose=()=>{skeletonDisposals++;disposeSkeleton();};
 assert.notEqual(a.mesh.geometry,b.mesh.geometry);assert.notEqual(a.mesh.skeleton,b.mesh.skeleton);assert.notEqual(coloured,b.mesh.material);b.update('display',.7);const before=digest(posedVertices(b));a.setSkeletonVisible(true);assert.equal(a.details().drawCalls,2);a.dispose();a.dispose();assert.deepEqual([...counts.values()],[1,1,1,1,1]);assert.equal(skeletonDisposals,1);assert.equal(a.group.parent,null);assert.equal(b.group.parent,parent);assert.equal(digest(posedVertices(b)),before);assert.throws(()=>a.update('walk',0),/disposed/);b.dispose();
});

test('coat keys never change anatomy; the individual seed does when variation is on; individuals replay exactly',()=>{
 const anatomy=s=>digest(s.positions,s.index,s.skinIndex,s.skinWeight);
 for(const id of COMPOSER_PRESET_IDS){const species={...composerPreset(id),individualSeed:5},ref=buildIndividual(species).skin,refHash=anatomy(ref);
  for(const change of[{pattern:COAT_PATTERNS[(COAT_PATTERNS.indexOf(species.pattern)+3)%COAT_PATTERNS.length]},{marks:species.marks^0xff},{colorSeed:(species.colorSeed+4321)%10000},{patternScale:1.95,patternContrast:0.1,countershade:0.05},{palette:'sable'}])
   assert.equal(anatomy(buildIndividual({...species,...change}).skin),refHash,`${id}: ${Object.keys(change).join('+')} must not change positions, index or skinning`);
  const other=buildIndividual({...species,individualSeed:6}).skin;
  assert.notEqual(anatomy(other),refHash,`${id}: another individual must change geometry when variability > 0`);
  assert.equal(anatomy(buildIndividual({...species,individualSeed:6,variability:0,sex:'female'}).skin),anatomy(buildIndividual({...species,individualSeed:5,variability:0,sex:'female'}).skin),`${id}: variability 0 makes same-sex seeds clones`);
  const replay=buildIndividual(decodeComposerRecipe(encodeComposerRecipe(species)).recipe).skin;
  assert.equal(digest(replay.positions,replay.index,replay.skinIndex,replay.skinWeight,replay.colors),digest(ref.positions,ref.index,ref.skinIndex,ref.skinWeight,ref.colors),`${id}: individual replay`);
 }
 // createComposerCreature builds exactly the derived individual
 const recipe={...composerPreset('giraffe'),individualSeed:11,maturity:0.6},c=createComposerCreature(recipe);
 try{const s=buildIndividual(recipe).skin;assert.equal(digest(c.skin.positions,c.skin.index),digest(s.positions,s.index));assert.deepEqual(c.individual.effectiveRecipe,deriveComposerIndividual(recipe).recipe);assert.deepEqual(c.details().individual,c.individual);}finally{c.dispose();}
});
