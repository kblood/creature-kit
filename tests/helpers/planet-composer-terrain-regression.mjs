import * as T from 'three';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildPlanetComposerSource} from '../../src/planet-composer.ts';
import {posePlanetComposer} from '../../src/planet-composer-pose.ts';
import {buildComposerLodChain,composerAnatomyLodConstraints} from '../../src/fauna-composer-lod.ts';

export const fixture=JSON.parse(readFileSync(new URL('../fixtures/planet-composer-terrain-32e5fe9d.json',import.meta.url),'utf8'));
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceDigests(source){
 const buffers={};const visit=(value,path='')=>{if(ArrayBuffer.isView(value)){buffers[path]=hash(Buffer.from(value.buffer,value.byteOffset,value.byteLength));return;}if(value&&typeof value==='object')for(const [key,v]of Object.entries(value))visit(v,path?path+'.'+key:key);};visit(source.skin);
 return {graph:hash(JSON.stringify(source.graph)),skinBuffers:buffers};
}
/** Recorded caller stencil contract: ordinary production uses bilinear samples
 * of an immutable 7x7 grid with 8-metre spacing, in the herd's tangent frame. */
export function recordedGround(x,z){
 const {rawGrid:g,n,halfM,stepM,relief}=fixture.ground,fx=Math.max(0,Math.min(n-1,(x+halfM)/stepM)),fz=Math.max(0,Math.min(n-1,(z+halfM)/stepM)),ix=Math.min(n-2,Math.floor(fx)),iz=Math.min(n-2,Math.floor(fz)),u=fx-ix,v=fz-iz;
 return ((g[iz*n+ix]*(1-u)+g[iz*n+ix+1]*u)*(1-v)+(g[(iz+1)*n+ix]*(1-u)+g[(iz+1)*n+ix+1]*u)*v)*relief;
}
function palette(graph,pose){
 const data=new Float32Array(graph.bones.length*16),p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3(),rest=new T.Matrix4(),posed=new T.Matrix4();
 for(const b of graph.bones){rest.compose(p.fromArray(b.restPosition),q.fromArray(b.restQuaternion),scale.set(1,1,1)).invert();posed.compose(p.fromArray(pose.positions,b.index*3),q.fromArray(pose.quaternions,b.index*4),scale.set(1,pose.radialScale[b.index],pose.radialScale[b.index]*pose.chordScale[b.index])).multiply(rest).toArray(data,b.index*16);}
 return data;
}
function vertex(mesh,v,matrices,packed=false){
 const out=[0,0,0],weights=Array.from(mesh.skinWeight.subarray(v*4,v*4+4),w=>packed?Math.round(w*65535):w),sum=packed?weights.reduce((a,b)=>a+b,0):1;
 for(let k=0;k<4;k++){const w=weights[k]/sum;if(!w)continue;const j=mesh.skinIndex[v*4+k]*16,x=mesh.positions[v*3],y=mesh.positions[v*3+1],z=mesh.positions[v*3+2];for(let a=0;a<3;a++)out[a]+=(matrices[j+a]*x+matrices[j+4+a]*y+matrices[j+8+a]*z+matrices[j+12+a])*w;}
 return out;
}
const world=(activity,ground,p)=>{const a=activity.pose,c=Math.cos(a.yaw),s=Math.sin(a.yaw);return [a.x+c*p[0]+s*p[2],ground(a.x,a.z)+p[1],a.z+s*p[0]-c*p[2]];};

export function terrainRegression(){
 const source=buildPlanetComposerSource(fixture.definition),graph=source.graph,skin=source.skin,before=sourceDigests(source),far=buildComposerLodChain(skin,[1000],composerAnatomyLodConstraints(skin,graph)).levels[0];
 const feet=skin.parts.filter(p=>p.part==='foot'||p.part==='paw').map(part=>{
  const ids=new Set(skin.index.subarray(part.firstTriangle*3,(part.firstTriangle+part.triangles)*3)),limb=graph.limbs.find(l=>l.kind==='leg'&&part.label.endsWith(String(l.pair+1)+(l.side<0?'L':'R'))),bone=graph.bones[limb.bones.at(-1)],inverse=new T.Matrix4().compose(new T.Vector3().fromArray(bone.restPosition),new T.Quaternion().fromArray(bone.restQuaternion),new T.Vector3(1,1,1)).invert();
  const sole=new Set([...ids].filter(v=>{let weight=0;for(let k=0;k<4;k++)if(skin.skinIndex[v*4+k]===bone.index)weight+=skin.skinWeight[v*4+k];return weight>.999999&&Math.abs(new T.Vector3().fromArray(skin.positions,v*3).applyMatrix4(inverse).y+limb.footHeight)<2e-5;}));
  return {label:part.label,limb,ids,sole};
 });
 const a0=fixture.clock[0].activity.pose,e=.025,base=recordedGround(a0.x,a0.z),dx=(recordedGround(a0.x+e,a0.z)-recordedGround(a0.x-e,a0.z))/(2*e),dz=(recordedGround(a0.x,a0.z+e)-recordedGround(a0.x,a0.z-e))/(2*e);
 const rows=[];
 for(const [terrain,ground] of [['actual-grid',recordedGround],['tangent-plane',(x,z)=>base+dx*(x-a0.x)+dz*(z-a0.z)],['constant-plane',()=>base]]){
  const variants=[['source',skin,false],['far-original-floats',far,false],['far-packed-weights',far,true]].map(([name,mesh,packed])=>({name,mesh,packed,footIds:feet.map(f=>Array.from({length:mesh.positions.length/3},(_,v)=>v).filter(v=>f.ids.has(mesh.sourceVertex?.[v]??v))),stance:0,swing:0,maxStanceGap:0,maxPenetration:0,maxStanceDrift:0,driftPairs:0,previous:new Map()}));
  let maxReachError=0;const poses=new Map(),initial=[];
  for(const clock of fixture.clock){
   const pose=posePlanetComposer(graph,fixture.member,clock.activity,ground,clock.rigSeconds),matrices=palette(graph,pose);poses.set(clock.worldNs,{pose,matrices,clock});maxReachError=Math.max(maxReachError,pose.diagnostics.maxReachError);
   for(const variant of variants)for(let i=0;i<feet.length;i++){
    const foot=feet[i],contact=pose.contacts.find(c=>c.limb===foot.limb.index),points=variant.footIds[i].map(v=>({v,world:world(clock.activity,ground,vertex(variant.mesh,v,matrices,variant.packed))})),low=Math.min(...points.map(p=>p.world[1]-ground(p.world[0],p.world[2])));
    variant.maxPenetration=Math.max(variant.maxPenetration,-low);if(contact.stance){variant.stance++;variant.maxStanceGap=Math.max(variant.maxStanceGap,low);}else variant.swing++;
    const rigid=new Map(points.filter(p=>foot.sole.has(variant.mesh.sourceVertex?.[p.v]??p.v)).map(p=>[p.v,p.world])),previous=variant.previous.get(i);
    if(previous?.stance&&contact.stance&&BigInt(clock.worldNs)-BigInt(previous.date)<=50000000n){for(const [v,p]of rigid){const q=previous.points.get(v);if(q){variant.maxStanceDrift=Math.max(variant.maxStanceDrift,Math.hypot(...p.map((x,k)=>x-q[k])));variant.driftPairs++;}}}
    variant.previous.set(i,{date:clock.worldNs,stance:contact.stance,points:rigid});
    if(clock===fixture.clock[0])initial.push({foot:foot.label,variant:variant.name,stance:contact.stance,gap:low,reachError:contact.reachError});
   }
  }
  let maxBoundaryJump=0;
  for(const boundary of fixture.boundaries){const p=poses.get(boundary.before),q=poses.get(boundary.after);for(let v=0;v<skin.vertexCount;v++){const a=world(p.clock.activity,ground,vertex(skin,v,p.matrices)),b=world(q.clock.activity,ground,vertex(skin,v,q.matrices));maxBoundaryJump=Math.max(maxBoundaryJump,Math.hypot(...a.map((x,k)=>x-b[k])));}}
  rows.push({terrain,maxReachError,maxBoundaryJump,initial,variants:variants.map(({name,stance,swing,maxStanceGap,maxPenetration,maxStanceDrift,driftPairs})=>({name,stance,swing,maxStanceGap,maxPenetration,maxStanceDrift,driftPairs}))});
 }
 return {version:'planet-composer-terrain-frame-regression-1',id:fixture.provenance.id,clockSamples:fixture.clock.length,before,after:sourceDigests(source),far:{triangles:far.triangles,reached:far.reached},rows};
}
