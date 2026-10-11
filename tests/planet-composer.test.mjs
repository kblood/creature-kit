import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {generateCreatureGenome,realisticIndividualCreatureGenome} from '../src/planet-v1/creature-model.ts';
import {MORPHOLOGY_FAMILIES} from '../src/planet-v1/fauna-appearance.ts';
import {planetComposerDefinition,parsePlanetComposerDefinition,serializePlanetComposerDefinition,buildPlanetComposerSource,createPlanetComposerAnimal,measurePlanetComposerSource} from '../src/planet-composer.ts';
import {buildComposerSource} from '../src/fauna-composer-source.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {composerPreset} from '../src/fauna-composer-recipe.ts';
import {poseComposer} from '../src/fauna-composer-rig.ts';
import {exportCreatureGlb} from '../src/fauna-composer-export.ts';

const archetypes=['browser','runner','low-slung','long-neck'];
const corpus=MORPHOLOGY_FAMILIES.flatMap((family,i)=>['adult','juvenile'].map(stage=>({family,stage,genome:realisticIndividualCreatureGenome(generateCreatureGenome(`planet-composer/${family}`,archetypes[i%4]),`individual/${family}`,i%4,stage,family)})));
const arrays=['positions','normals','colors','skinIndex','skinWeight','index','regions','gloss'];
function eqSkin(a,b){for(const k of arrays)assert.deepEqual(a[k],b[k],k);assert.deepEqual(a.coatLayers,b.coatLayers);assert.deepEqual(a.coatCrisp,b.coatCrisp);}

test('planet definition preserves raw genome, IDs, resolved colours and exact specimen metres without double growth',()=>{
 for(const {genome:g,family,stage} of corpus){
  const before=structuredClone(g),d=planetComposerDefinition(g,{individualId:`id/${family}`,speciesId:`species/${family}`});
  assert.deepEqual(g,before);assert.notEqual(d.genome,g);assert.ok(Object.isFrozen(d.genome.appearance.coat.colours.base));
  assert.equal(d.phenotype.identity.individualId,`id/${family}`);assert.equal(d.phenotype.identity.speciesId,`species/${family}`);assert.equal(d.phenotype.identity.appearanceKey,g.appearance.individualKey);
  assert.deepEqual(d.phenotype.coat,g.appearance.coat);assert.equal(d.phenotype.identity.maturity,g.appearance.growth.maturity);
  assert.equal(d.recipe.maturity,1);assert.equal(d.recipe.individualSeed,0);assert.equal(d.recipe.variability,0);
  const src=buildPlanetComposerSource(d),p=d.phenotype.dimensions;
  assert.equal(src.graph.dims.bodyLength,g.torsoLength);assert.equal(src.graph.dims.torsoWidth,g.torsoWidth/2);assert.equal(src.graph.dims.torsoHeight,g.torsoHeight/2);
  assert.equal(src.graph.dims.headLength,g.headLength);assert.equal(src.graph.dims.craniumWidth,g.headWidth/2);
  assert.equal(src.graph.dims.neckLength,p.neckLength);assert.equal(src.graph.dims.tailLength,g.tailLength);
  assert.deepEqual(src.individual.deltas,[]);assert.equal(src.individual.traits.neutral,true);
  for(const limb of src.graph.limbs.filter(l=>l.kind==='leg')){assert.equal(Math.abs(limb.rest[2]),g.stanceWidth/2);assert.equal(limb.footLength,g.footLength);}
  assert.equal(src.graph.locomotion.speed,g.walkSpeed,`${family}/${stage} walking speed`);
  assert.equal(src.skin.version,'fauna-composer-skin-6');
  if(src.skin.coatCrisp)assert.deepEqual(src.skin.coatCrisp.genome,g.appearance.coat);
 }
});

test('JSON replay, worker source and Lab actor use identical Composer graph/skin and actual poses',()=>{
 const g=corpus.find(x=>x.family==='proboscidean'&&x.stage==='juvenile').genome,d=planetComposerDefinition(g,{individualId:'real-id',speciesId:'real-species'}),replay=parsePlanetComposerDefinition(serializePlanetComposerDefinition(d));
 const source=buildPlanetComposerSource(d),direct=buildComposerSource(replay.recipe,{phenotype:replay.phenotype,presentation:'realism-1'}),lab=createComposerCreature(replay.recipe,{phenotype:replay.phenotype,presentation:'realism-1'}),planet=createPlanetComposerAnimal(d);
 try{assert.deepEqual(source.graph,direct.graph);assert.deepEqual(source.graph,lab.graph);assert.deepEqual(source.graph,planet.graph);eqSkin(source.skin,direct.skin);eqSkin(source.skin,lab.skin);eqSkin(source.skin,planet.skin);
  for(const motion of ['neutral','idle','walk','display'])for(const t of [0,.173,.617,1.39]){assert.deepEqual(planet.update(motion,t),lab.update(motion,t));assert.deepEqual(planet.lastPose,poseComposer(source.graph,motion,t));}
  assert.deepEqual(planet.mesh.geometry.userData.composer.identity,d.phenotype.identity);assert.equal(planet.mesh.material.roughness,g.appearance.roughness);
  const measured=measurePlanetComposerSource(source,planet.lastPose),bounds=planet.bounds();
  for(let i=0;i<3;i++){assert.ok(Math.abs(measured.bounds.min[i]-bounds.min.toArray()[i])<1e-8);assert.ok(Math.abs(measured.bounds.max[i]-bounds.max.toArray()[i])<1e-8);}
 }finally{lab.dispose();planet.dispose();}
});

test('resolved feet preserve requested lateral width and shared hoof/pad ankle seams',()=>{
 for(const {genome:g} of corpus){const {graph,skin}=buildPlanetComposerSource(g);for(const foot of skin.parts.filter(p=>p.part==='foot')){
  const vertices=new Set();for(let j=foot.firstTriangle*3;j<(foot.firstTriangle+foot.triangles)*3;j++)vertices.add(skin.index[j]);
  let lo=Infinity,hi=-Infinity;for(const v of vertices){lo=Math.min(lo,skin.positions[v*3+2]);hi=Math.max(hi,skin.positions[v*3+2]);}
  assert.ok(Math.abs(hi-lo-g.footWidth)<1e-6,`${graph.recipe.feet} actual foot width ${hi-lo} vs ${g.footWidth}`);
  if(graph.recipe.feet==='paw')continue;
  const leg=skin.parts[skin.parts.indexOf(foot)-1],signature=v=>JSON.stringify([Array.from(skin.positions.slice(v*3,v*3+3)),Array.from(skin.skinIndex.slice(v*4,v*4+4)),Array.from(skin.skinWeight.slice(v*4,v*4+4))]);
  const legs=new Set();for(let j=leg.firstTriangle*3;j<(leg.firstTriangle+leg.triangles)*3;j++)legs.add(signature(skin.index[j]));
  assert.equal([...vertices].filter(v=>legs.has(signature(v))).length,16);
 }}
});

test('resolved anatomy has finite deforming geometry and planted full-source feet through a real gait cycle',t=>{
 const report=[];let planted=0,swing=0;
 for(const {family,stage,genome:g} of corpus){const a=createPlanetComposerAnimal(planetComposerDefinition(g)),s=a.skin,feet=a.graph.limbs.filter(l=>l.kind==='leg');
  try{for(const key of ['positions','normals','colors','skinWeight'])assert.ok(s[key].every(Number.isFinite),`${family}/${stage}/${key}`);
   const ids=feet.map(l=>{const b=l.bones.at(-1),out=[];for(let i=0;i<s.vertexCount;i++)if(s.skinIndex[i*4]===b&&s.skinWeight[i*4]>.9999)out.push(i);return out;});
   let penetration=0,maxStanceGap=0;const p=new T.Vector3();
   for(let frame=0;frame<24;frame++){const pose=a.update('walk',(frame+.137)/24*a.graph.locomotion.period);a.group.updateMatrixWorld(true);
    for(let i=0;i<feet.length;i++){const contact=pose.contacts.find(c=>c.limb===feet[i].index);if(contact.stance)planted++;else swing++;
     let min=Infinity;for(const v of ids[i]){p.fromArray(s.positions,v*3);a.mesh.applyBoneTransform(v,p);min=Math.min(min,p.y);}assert.ok(Number.isFinite(min));penetration=Math.min(penetration,min);if(contact.stance)maxStanceGap=Math.max(maxStanceGap,min);
    }
   }
   assert.ok(penetration>-.00001,`${family}/${stage} penetration ${penetration}`);assert.ok(maxStanceGap<.02,`${family}/${stage} stance gap ${maxStanceGap}`);
   report.push({family,stage,vertices:s.vertexCount,triangles:s.triangleCount,bones:a.graph.bones.length,penetration,maxStanceGap,sourceStride:g.strideLength,actualStride:a.graph.locomotion.stride,constraints:a.graph.constraints});
  }finally{a.dispose();}
 }
 assert.ok(planted>0&&swing>0);t.diagnostic(JSON.stringify({planted,swing,report}));
});

test('invalid and doubly resolved inputs fail instead of silently clamping; original source snapshot stays intact',()=>{
 const d=planetComposerDefinition(corpus[0].genome),e=structuredClone(d);e.phenotype.dimensions.bodyLength=NaN;assert.throws(()=>parsePlanetComposerDefinition(e),/bodyLength/);
 const double=structuredClone(d);double.recipe.maturity=.3;assert.throws(()=>buildPlanetComposerSource(double),/growth twice/);
 const q=structuredClone(d);q.recipe.neckLength=5;assert.throws(()=>parsePlanetComposerDefinition(q),/canonical/);
 const edits=structuredClone(d);edits.recipe.tail='club';const built=buildPlanetComposerSource(edits);assert.equal(built.graph.recipe.tail,'club');assert.deepEqual(built.definition.genome,d.genome);
});

test('export carries exact resolved phenotype and shared geometry, while historical unextended recipes stay identical',()=>{
 const d=planetComposerDefinition(corpus[0].genome,{individualId:'stored-id'}),s=buildPlanetComposerSource(d),out=exportCreatureGlb(d.recipe,{phenotype:d.phenotype,presentation:'realism-1',clips:['neutral']});
 assert.equal(out.report.mesh.vertices,s.skin.vertexCount);assert.equal(out.report.mesh.triangles,s.skin.triangleCount);assert.deepEqual(out.report.phenotype,d.phenotype);assert.equal(out.report.versions.phenotype,d.phenotype.version);
 const dv=new DataView(out.glb.buffer,out.glb.byteOffset,out.glb.byteLength),json=JSON.parse(new TextDecoder().decode(out.glb.subarray(20,20+dv.getUint32(12,true))));
 assert.deepEqual(json.asset.extras.composer.phenotype,d.phenotype);assert.equal(json.materials[0].pbrMetallicRoughness.roughnessFactor,d.phenotype.roughness);
 const r=composerPreset('dinosaur'),old=buildComposerSource(r),a=createComposerCreature(r);try{eqSkin(old.skin,a.skin);assert.deepEqual(old.graph,a.graph);}finally{a.dispose();}
 assert.deepEqual(exportCreatureGlb(r,{clips:['neutral']}).glb,exportCreatureGlb(r,{clips:['neutral'],phenotype:undefined}).glb);
});
