import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {anatomyCorpus,trunkSections} from './helpers/composer-lod-anatomy.mjs';
import {buildComposerLodChain,composerFootLodConstraints,composerAnatomyLodConstraints,COMPOSER_ANATOMY_LOD_VERSION,COMPOSER_LOD_CONSTRAINTS_VERSION} from '../src/fauna-composer-lod.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {exportCreatureGlb,readComposerGlb,ComposerExportBudgetError} from '../src/fauna-composer-export.ts';
import {planetComposerSourceIdentity} from '../src/planet-composer.ts';
const corpus=anatomyCorpus(),cache=new Map();
const built=s=>{if(!cache.has(s.id)){const source=s.build(),before=structuredClone(source.skin),options=composerAnatomyLodConstraints(source.skin,source.graph);cache.set(s.id,{...source,options,chain:buildComposerLodChain(source.skin,[1500,1000],options)});assert.deepEqual(source.skin,before,'constraints/reduction never mutate the original raw-float source, including coat layers');}return cache.get(s.id);};
const ids=(skin,part)=>[...new Set(skin.index.slice(part.firstTriangle*3,(part.firstTriangle+part.triangles)*3))];
const key=(skin,v)=>Array.from(skin.positions.slice(v*3,v*3+3)).join(',');
function components(skin,part){
 const adjacent=new Map();
 for(let t=part.firstTriangle*3;t<(part.firstTriangle+part.triangles)*3;t+=3){const row=[0,1,2].map(k=>key(skin,skin.index[t+k]));for(const a of row){if(!adjacent.has(a))adjacent.set(a,new Set());for(const b of row)adjacent.get(a).add(b);}}
 const remaining=new Set(adjacent.keys()),out=[];while(remaining.size){const stack=[remaining.values().next().value],group=new Set();while(stack.length){const k=stack.pop();if(!remaining.delete(k))continue;group.add(k);for(const b of adjacent.get(k))stack.push(b);}out.push(group);}return out.sort((a,b)=>b.size-a.size);
}

test('shared anatomy constraints are bounded, deterministic and strictly include foot-1; all outputs remain original source attributes',()=>{
 for(const s of corpus){const {skin,graph,options,chain}=built(s),foot=composerFootLodConstraints(skin);
  assert.deepEqual(options,composerAnatomyLodConstraints(skin,graph));
  const added=options.protectedVertices.reduce((n,v,i)=>n+(v&&!foot.protectedVertices[i]?1:0),0);
  // Anatomy2 adds bounded body/neck/leg cross-sections and membrane anchors;
  // the cap is independent of source tessellation (not a percentage of it).
  assert.ok(added<=360,`${s.id} bounded additional anchors ${added}`);
  for(let v=0;v<skin.vertexCount;v++){if(foot.protectedVertices[v])assert.equal(options.protectedVertices[v],1);assert.ok(options.vertexImportance[v]>=foot.vertexImportance[v]);}
  for(const l of chain.levels){
   assert.equal(l.reached,l.triangles<=l.target);
   // These combined advanced recipes cannot retain the added body volume,
   // stud shells and articulated trunk inside their historical low targets.
   // Keep the requested budget and report the miss, never discard anatomy.
   if(s.id.includes('trunked-centipede')){assert.equal(l.reached,false);assert.ok(l.triangles<1700);}
   else if(s.id.startsWith('advanced-')&&l.target===1000){assert.equal(l.reached,false);assert.ok(l.triangles<1500);}
   else assert.ok(l.reached,`${s.id}/${l.target}`);
   for(const [name,size] of [['positions',3],['normals',3],['colors',3],['gloss',1],['skinIndex',4],['skinWeight',4]])for(let v=0;v<l.vertices;v++)for(let k=0;k<size;k++)assert.equal(l[name][v*size+k],skin[name][l.sourceVertex[v]*size+k],`${s.id}/${name}`);
   for(let v=0;v<skin.vertexCount;v++)if(options.protectedVertices[v])assert.equal(key(l,l.representative[v]),key(skin,v),`${s.id}: locked source position moved`);
   if(graph.recipe.feet==='paw')for(const part of skin.parts.filter(p=>p.part==='leg')){
    const selected=ids(skin,part).filter(v=>options.protectedVertices[v]);assert.ok(selected.length>=12,`${s.id}: paw supporting leg requires joint-region anchors`);
   }
  }
 }
});

test('actual trunk triangle sections retain diameter through bends; head junction and mouth survive both tiers',()=>{
 for(const s of corpus){const {skin,graph,chain}=built(s);if(!graph.chains.trunk.length)continue;
  const reference=trunkSections(skin,graph),headKeys=new Set(skin.parts.filter(p=>p.part==='head'&&!p.label.endsWith('ears')).flatMap(p=>ids(skin,p).map(v=>key(skin,v))));
  const sourceJoin=new Set(skin.parts.filter(p=>p.part==='trunk').flatMap(p=>ids(skin,p).map(v=>key(skin,v))).filter(k=>headKeys.has(k)));
  assert.ok(sourceJoin.size>=8);
  const trunkPart=skin.parts.find(p=>p.part==='trunk'),shells=components(skin,trunkPart).slice(1);
  assert.ok(shells.length>=3,'source includes separate two nostrils and tip finger');
  for(const l of chain.levels){const sections=trunkSections(l,graph);assert.equal(sections.length,18);
   for(let i=0;i<sections.length;i++)for(const dimension of ['width','height']){const ratio=sections[i][dimension]/reference[i][dimension];assert.ok(ratio>=.85&&ratio<=1.2,`${s.id}/${l.target}/joint${sections[i].joint}/${sections[i].u} ${dimension} ratio ${ratio}`);}
   const heads=new Set(l.parts.filter(p=>p.part==='head'&&!p.label.endsWith('ears')).flatMap(p=>ids(l,p).map(v=>key(l,v))));
   const shared=new Set(l.parts.filter(p=>p.part==='trunk').flatMap(p=>ids(l,p).map(v=>key(l,v))).filter(k=>heads.has(k)&&sourceJoin.has(k)));
   assert.ok(shared.size>=4,`${s.id}/${l.target}: source-welded head/trunk junction retained`);
   assert.ok(l.parts.some(p=>p.part==='mouth'&&p.triangles>=4));assert.ok(l.parts.some(p=>p.part==='eyes'&&p.triangles>=16));
   const trunk=l.parts.find(p=>p.part==='trunk');for(const shell of shells){let triangles=0;for(let t=trunk.firstTriangle*3;t<(trunk.firstTriangle+trunk.triangles)*3;t+=3)if([0,1,2].every(k=>shell.has(key(l,l.index[t+k]))))triangles++;assert.ok(triangles>=4,`${s.id}/${l.target}: source tip shell disappeared`);}
  }
 }
});

test('real reduced skin deformation matches source vertices through stance and swing, including the planted soles',()=>{
 let stance=0,swing=0;
 for(const s of corpus){const {skin,chain}=built(s),l=chain.levels.at(-1),a=createComposerCreature(s.definition?.recipe??s.recipe,{phenotype:s.definition?.phenotype,presentation:'realism-1'});
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(l.positions,3));g.setAttribute('skinIndex',new T.BufferAttribute(l.skinIndex,4));g.setAttribute('skinWeight',new T.BufferAttribute(l.skinWeight,4));g.setIndex(new T.BufferAttribute(l.index,1));const reduced=new T.SkinnedMesh(g,a.mesh.material);a.group.add(reduced);reduced.bind(a.mesh.skeleton,a.mesh.bindMatrix);
  const feet=l.parts.filter(p=>p.part==='foot'||p.part==='paw').map(p=>({part:p,vertices:ids(l,p),limb:a.graph.limbs.find(limb=>limb.kind==='leg'&&p.label===`${a.graph.recipe.feet} ${limb.pair+1}${limb.side<0?'L':'R'}`)}));
  assert.ok(feet.every(f=>f.limb),'every sole maps to its actual limb');
  try{for(const phase of [0,.13,.31,.57,.79,.93]){const pose=a.update('walk',phase*a.graph.locomotion.period);a.group.updateMatrixWorld(true);stance+=pose.contacts.filter(c=>c.stance).length;swing+=pose.contacts.filter(c=>!c.stance).length;
   const actual=new Float64Array(l.vertices*3),p=new T.Vector3(),q=new T.Vector3();
   for(let v=0;v<l.vertices;v++){p.fromArray(l.positions,v*3);reduced.applyBoneTransform(v,p);q.fromArray(skin.positions,l.sourceVertex[v]*3);a.mesh.applyBoneTransform(l.sourceVertex[v],q);assert.ok(p.distanceTo(q)<1e-10,`${s.id}: actual LOD skinning drift`);p.toArray(actual,v*3);}
   for(const foot of feet){const contact=pose.contacts.find(c=>c.limb===foot.limb.index);assert.ok(contact);const low=Math.min(...foot.vertices.map(v=>actual[v*3+1]));assert.ok(low>-.00001,`${s.id}: reduced foot penetrates ground ${low}`);if(contact.stance)assert.ok(low<.025,`${s.id}: reduced stance sole floats ${low}`);}
  }}finally{g.dispose();a.dispose();}
 }
 assert.ok(stance>0&&swing>0);
});

const accessor=(json,bin,i)=>{const a=json.accessors[i],v=json.bufferViews[a.bufferView],C={5126:Float32Array,5123:Uint16Array,5125:Uint32Array,5121:Uint8Array}[a.componentType],n={SCALAR:1,VEC3:3,VEC4:4}[a.type]*a.count,start=bin.byteOffset+v.byteOffset+(a.byteOffset??0);return new C(bin.buffer.slice(start,start+n*C.BYTES_PER_ELEMENT));};
test('realism GLB uses exactly the shared anatomy chain and tags it; impossible targets fail closed and source identities invalidate',()=>{
 const s=corpus.find(x=>x.id==='planet-proboscidean-adult'),{chain}=built(s),d=s.definition;
 const out=exportCreatureGlb(d.recipe,{phenotype:d.phenotype,presentation:'realism-1',clips:['neutral'],lods:[1500,1000]}),{json,bin}=readComposerGlb(out.glb);
 assert.equal(out.report.versions.lodAnatomy,COMPOSER_ANATOMY_LOD_VERSION);assert.equal(json.asset.extras.composer.versions.lodAnatomy,COMPOSER_ANATOMY_LOD_VERSION);
 assert.equal(json.meshes.length,2);
 for(let i=0;i<2;i++){const p=json.meshes[i].primitives[0],l=chain.levels[i];assert.deepEqual(accessor(json,bin,p.attributes.POSITION),l.positions);assert.deepEqual(Array.from(accessor(json,bin,p.indices)),Array.from(l.index));assert.deepEqual(accessor(json,bin,p.attributes.COLOR_0),l.colors);}
 const impossible=corpus.find(x=>x.id==='advanced-trunked-centipede-adult');assert.throws(()=>exportCreatureGlb(impossible.recipe,{presentation:'realism-1',clips:['neutral'],lods:[1500,1000]}),e=>e instanceof ComposerExportBudgetError&&e.reasons.some(r=>r.code==='lod-target'));
 const token=planetComposerSourceIdentity(d);assert.equal(token.versions.constraints,COMPOSER_LOD_CONSTRAINTS_VERSION);assert.match(token.key,/fauna-composer-lod-constraints-3/);
 const legacy=exportCreatureGlb(d.recipe,{clips:['neutral'],lods:[1500,1000]}),explicit=exportCreatureGlb(d.recipe,{clips:['neutral'],lods:[1500,1000],presentation:'skin-5'});assert.deepEqual(legacy.glb,explicit.glb);assert.equal(legacy.report.versions.lodAnatomy,undefined);
});
