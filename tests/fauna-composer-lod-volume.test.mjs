import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {anatomyCorpus} from './helpers/composer-lod-anatomy.mjs';
import {volumeRatios} from './helpers/composer-lod-volume.mjs';
import {buildComposerLodChain,composerAnatomyLodConstraints} from '../src/fauna-composer-lod.ts';
import {posePlanetComposer} from '../src/planet-composer-pose.ts';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:new Uint8Array(value.buffer,value.byteOffset,value.byteLength)).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value));
function sourceReceipt(id,source){
 const arrays=[];const visit=(value,path='')=>{if(ArrayBuffer.isView(value)){arrays.push([path,value.constructor.name,value.length,hash(value)]);return;}if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))visit(v,path?`${path}.${k}`:k);};visit(source.skin);
 return{id,graph:jsonHash(source.graph),metadata:jsonHash({parts:source.skin.parts,coatCrisp:source.skin.coatCrisp}),arrays:arrays.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)};
}
const corpus=anatomyCorpus().filter(s=>s.definition),cache=new Map();
const built=s=>{
 if(!cache.has(s.id)){
  const source=s.build(),before=sourceReceipt(s.id,source),options=composerAnatomyLodConstraints(source.skin,source.graph);
  const direct=buildComposerLodChain(source.skin,[1000],options).levels[0],chain=buildComposerLodChain(source.skin,[8000,3000,1000],options);
  assert.deepEqual(sourceReceipt(s.id,source),before,'all source arrays, graph, coat metadata and parts stay unchanged');
  cache.set(s.id,{source,before,options,direct,chain});
 }
 return cache.get(s.id);
};
test('saved twelve adult/young source specimens remain byte-pinned; direct and sequential reductions are identical',()=>{
 const receipts=[];
 for(const s of corpus){const{before,direct,chain}=built(s);receipts.push(before);const last=chain.levels.at(-1);
  for(const k of ['positions','normals','colors','gloss','skinIndex','skinWeight','index','sourceVertex','representative'])assert.deepEqual(direct[k],last[k],`${s.id}/${k}`);
  for(const l of chain.levels)assert.ok(l.reached&&l.triangles<=l.target,`${s.id}/${l.target}`);
 }
 // SHA256 aggregate of the preserved lod-anatomy-release-chain source graph,
 // metadata and every typed attribute descriptor, including crisp coat data.
 assert.equal(jsonHash(receipts),'d1505ba29238da881542975e9486b78097815a26ce6898994f244e2362ca89dc');
});
test('actual reduced triangle sections resist torso/neck/limb collapse and preserve membrane area at the same budgets',()=>{
 for(const s of corpus){const{source,chain}=built(s);for(const l of chain.levels){const m=volumeRatios(source.skin,l,source.graph);
  for(const section of m.sections){const minimum=section.part==='torso'?.84:.70;
   assert.ok(section.widthRatio>=minimum&&section.heightRatio>=minimum,`${s.id}/${l.target}/${section.part}/${section.joint}/${section.u} ${JSON.stringify(section)}`);
   assert.ok(section.areaRatio>=.53,`${s.id}/${l.target}/${section.part}: cross-section area ${section.areaRatio}`);
  }
  for(const wing of m.wings)assert.ok(wing.ratio>=.94,`${s.id}/${l.target}: membrane area ${wing.ratio}`);
 }}
});

function deform(skin,graph,pose){
 const matrices=graph.bones.map((b,i)=>new T.Matrix4().compose(new T.Vector3().fromArray(pose.positions,i*3),new T.Quaternion().fromArray(pose.quaternions,i*4),new T.Vector3(1,pose.radialScale[i],pose.radialScale[i]*pose.chordScale[i])).multiply(
  new T.Matrix4().compose(new T.Vector3().fromArray(b.restPosition),new T.Quaternion().fromArray(b.restQuaternion),new T.Vector3(1,1,1)).invert()));
 const positions=new Float64Array(skin.positions.length),p=new T.Vector3(),q=new T.Vector3(),out=new T.Vector3();
 for(let v=0;v<positions.length/3;v++){p.fromArray(skin.positions,v*3);out.set(0,0,0);for(let k=0;k<4;k++){const w=skin.skinWeight[v*4+k];if(w>0)out.addScaledVector(q.copy(p).applyMatrix4(matrices[skin.skinIndex[v*4+k]]),w);}out.toArray(positions,v*3);}
 return{...skin,positions};
}
test('real posed triangle sections and planted soles retain source support on sloping terrain at several gait phases',t=>{
 const member={id:'lod-volume-gait',anchorOffsetX:1,anchorOffsetZ:-2,orbitRadiusM:6,orbitAngularSpeed:.1,orbitPhase:.37,gaitPeriodS:1};
 const ground=(x,z)=>.07*x-.04*z,minima={torso:1,neck:1,leg:1},coverage=[];let soleDifference=0,stance=0,swing=0,pawStance=0,pawSwing=0;
 const revolutionS=Math.PI*20;
 const activityAt=(travel,stateS)=>{const angle=member.orbitPhase+travel*Math.PI*2;return{pose:{x:member.anchorOffsetX+Math.cos(angle)*6,z:member.anchorOffsetZ+Math.sin(angle)*6,yaw:angle+Math.PI/2,gait:'walk'},travel,revolutionS,stateS};};
 for(const s of corpus){const{source,direct}=built(s),{graph}=source;
  const cycles=posePlanetComposer(graph,member,activityAt(.25,.7),ground,1600).planet.cyclesPerRevolution;
  const period=revolutionS/cycles,base=Math.floor(.25*cycles)/cycles,observed=[];
  const feet=source.skin.parts.filter(p=>p.part==='foot'||p.part==='paw');
  const legs=graph.limbs.filter(l=>l.kind==='leg');
  assert.equal(feet.length,legs.length,`${s.id}: every actual leg has a tested sole`);
  for(const step of [0,.17,.39,.61,.83,1]){
   const travel=base+step/cycles,activity=activityAt(travel,(2+step)*period);
   const pose=posePlanetComposer(graph,member,activity,ground,1600+step*period),full=deform(source.skin,graph,pose),low=deform(direct,graph,pose);
   const cycleError=Math.abs(pose.planet.cycle-step%1);assert.ok(Math.min(cycleError,1-cycleError)<1e-12,`${s.id}: actual Composer cycle ${pose.planet.cycle} must cover phase ${step}`);observed.push(pose.planet.cycle);
   for(let v=0;v<direct.vertices;v++)for(let k=0;k<3;k++)assert.ok(Math.abs(low.positions[v*3+k]-full.positions[direct.sourceVertex[v]*3+k])<1e-12,'original weighted vertex is unchanged by LOD selection');
   const posedGraph={...graph,bones:graph.bones.map((b,i)=>({...b,restPosition:Array.from(pose.positions.slice(i*3,i*3+3)),restQuaternion:Array.from(pose.quaternions.slice(i*4,i*4+4))}))};
   const sections=volumeRatios(full,low,posedGraph).sections;
   for(const section of sections){const ratio=Math.min(section.widthRatio??1,section.heightRatio??1);minima[section.part]=Math.min(minima[section.part],ratio);assert.ok(ratio>=.60,`${s.id}/phase${step}: ${JSON.stringify(section)}`);assert.ok(section.areaRatio>=.40,`${s.id}/phase${step}: posed section area ${section.areaRatio}`);}
   const c=Math.cos(activity.pose.yaw),si=Math.sin(activity.pose.yaw),origin=ground(activity.pose.x,activity.pose.z);
   const gap=(mesh,part)=>{let min=Infinity;for(const v of new Set(mesh.index.slice(part.firstTriangle*3,(part.firstTriangle+part.triangles)*3))){const[x,y,z]=mesh.positions.slice(v*3,v*3+3);min=Math.min(min,origin+y-ground(activity.pose.x+c*x+si*z,activity.pose.z+si*x-c*z));}return min;};
   for(const foot of feet){const limb=legs.find(l=>foot.label===`${graph.recipe.feet} ${l.pair+1}${l.side<0?'L':'R'}`),contact=pose.contacts.find(c=>c.limb===limb?.index),lowFoot=low.parts.find(p=>p.part===foot.part&&p.label===foot.label);
    assert.ok(limb&&contact&&lowFoot,`${s.id}/${foot.label}: sole maps to its actual limb and contact`);
    const paw=foot.part==='paw'||foot.label.startsWith('paw ');
    if(contact.stance){stance++;if(paw)pawStance++;const difference=Math.abs(gap(full,foot)-gap(low,lowFoot));soleDifference=Math.max(soleDifference,difference);assert.ok(difference<.003,`${s.id}/${foot.label}: LOD sole differs from source ${difference}m`);}else{ swing++;if(paw)pawSwing++;}
   }
  }
  assert.equal(new Set(observed.slice(0,-1).map(x=>x.toFixed(9))).size,5,`${s.id}: distinct full-cycle phases`);coverage.push({id:s.id,cyclesPerRevolution:cycles,period,observed});
 }
 assert.ok(stance>0&&swing>0&&pawStance>0&&pawSwing>0);t.diagnostic(JSON.stringify({minima,soleDifference,stance,swing,pawStance,pawSwing,coverage}));
});
