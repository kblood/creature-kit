import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {buildPlanetComposerSource} from '../src/planet-composer.ts';
import {poseComposer} from '../src/fauna-composer-rig.ts';
import {posePlanetComposer} from '../src/planet-composer-pose.ts';
import {buildComposerLodChain,composerAnatomyLodConstraints} from '../src/fauna-composer-lod.ts';
import {palette,vertex,world,sourceDigests} from './helpers/planet-composer-terrain-regression.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/planet-composer-terrain-reach-eight.json',import.meta.url),'utf8'));
const groundFor=({rawGrid:g,relief})=>(x,z)=>{const fx=Math.max(0,Math.min(6,(x+24)/8)),fz=Math.max(0,Math.min(6,(z+24)/8)),ix=Math.min(5,Math.floor(fx)),iz=Math.min(5,Math.floor(fz)),u=fx-ix,v=fz-iz;return((g[iz*7+ix]*(1-u)+g[iz*7+ix+1]*u)*(1-v)+(g[(iz+1)*7+ix]*(1-u)+g[(iz+1)*7+ix+1]*u)*v)*relief;};

test('all eight captured padded animals keep actual mesh feet and body clear through dated cycles and boundaries',t=>{
 const reports=[];
 for(const data of fixture.cases){
  const source=buildPlanetComposerSource(data.definition),{graph:g,skin}=source,ground=groundFor(data.ground),before=sourceDigests(source),far=buildComposerLodChain(skin,[1000],composerAnatomyLodConstraints(skin,g)).levels[0];
  assert.deepEqual(before,data.sourceDigests,'original graph and every source/coat buffer must remain unchanged');
  assert.ok(data.baseline.some(r=>r.feet.some(f=>f.stance&&f.capturedGpuGap>.003)),'keep failed GPU measurements');
  const feet=skin.parts.filter(p=>p.part==='foot'||p.part==='paw').map(part=>{const ids=new Set(skin.index.subarray(part.firstTriangle*3,(part.firstTriangle+part.triangles)*3)),limb=g.limbs.find(l=>l.kind==='leg'&&part.label.endsWith(String(l.pair+1)+(l.side<0?'L':'R'))),bone=g.bones[limb.bones.at(-1)],inverse=new T.Matrix4().compose(new T.Vector3().fromArray(bone.restPosition),new T.Quaternion().fromArray(bone.restQuaternion),new T.Vector3(1,1,1)).invert();return {ids,limb,sole:new Set([...ids].filter(v=>{let w=0;for(let k=0;k<4;k++)if(skin.skinIndex[v*4+k]===bone.index)w+=skin.skinWeight[v*4+k];return w>.999999&&Math.abs(new T.Vector3().fromArray(skin.positions,v*3).applyMatrix4(inverse).y+limb.footHeight)<2e-5;}))};});
  const bodyIds=new Set(skin.parts.filter(p=>p.part==='torso').flatMap(p=>Array.from(skin.index.subarray(p.firstTriangle*3,(p.firstTriangle+p.triangles)*3))));
  const variants=[['source',skin,false],['far-original',far,false],['far-packed',far,true]].map(([name,s,packed])=>({name,s,packed,ids:feet.map(f=>Array.from({length:s.positions.length/3},(_,i)=>i).filter(i=>f.ids.has(s.sourceVertex?.[i]??i))),previous:new Map()}));
  const report={id:data.id,frames:data.clock.length,seams:data.seams.length,stance:0,swing:0,adjusted:0,maxCorrection:0,maxGap:0,maxPenetration:0,maxReach:0,maxSoleDrift:0,minBody:Infinity,maxSeamJump:0,maxBoneLengthError:0};
  const saved=new Map(),seamDates=new Set(data.seams.flatMap(s=>[s.before,s.after]));
  for(const clock of data.clock){
   const pose=posePlanetComposer(g,data.member,clock.activity,ground,clock.rigSeconds),mat=palette(g,pose),fit=pose.diagnostics.supportHeight;
   assert.ok(fit.feasible,data.id);report.adjusted+=Number(fit.delta!==0);report.maxCorrection=Math.max(report.maxCorrection,Math.abs(fit.delta));report.maxReach=Math.max(report.maxReach,pose.diagnostics.maxReachError);report.maxBoneLengthError=Math.max(report.maxBoneLengthError,pose.diagnostics.maxBoneLengthError);
   assert.deepEqual(pose.planet.root,[clock.activity.pose.x,ground(clock.activity.pose.x,clock.activity.pose.z),clock.activity.pose.z]);
   const captured=data.baseline.find(row=>row.worldNs===clock.worldNs);
   if(captured)for(let i=0;i<feet.length;i++){const expected=captured.feet[i].requestedHock,bone=feet[i].limb.bones[2];assert.ok(Math.hypot(...expected.map((x,k)=>x-pose.positions[bone*3+k]))<1e-9,'requested hock/ankle targets from the actual failed capture remain fixed');}
   if(seamDates.has(clock.worldNs))saved.set(clock.worldNs,{clock,mat});
   for(const v of bodyIds){const p=world(clock.activity,ground,vertex(skin,v,mat));report.minBody=Math.min(report.minBody,p[1]-ground(p[0],p[2]));}
   for(const v of variants)for(let i=0;i<feet.length;i++){
    const f=feet[i],contact=pose.contacts.find(c=>c.limb===f.limb.index),points=v.ids[i].map(index=>({index,p:world(clock.activity,ground,vertex(v.s,index,mat,v.packed))})),gap=Math.min(...points.map(({p})=>p[1]-ground(p[0],p[2])));
    report.maxPenetration=Math.max(report.maxPenetration,-gap);if(contact.stance){report.stance++;report.maxGap=Math.max(report.maxGap,gap);}else report.swing++;
    const rigid=new Map(points.filter(p=>f.sole.has(v.s.sourceVertex?.[p.index]??p.index)).map(p=>[p.index,p.p])),prev=v.previous.get(i),dt=prev?BigInt(clock.worldNs)-BigInt(prev.ns):0n;
    if(prev?.stance&&contact.stance&&dt>0n&&dt<=100000000n)for(const[j,p]of rigid){const q=prev.points.get(j);if(q)report.maxSoleDrift=Math.max(report.maxSoleDrift,Math.hypot(...p.map((x,k)=>x-q[k])));}
    v.previous.set(i,{ns:clock.worldNs,stance:contact.stance,points:rigid});
   }
  }
  for(const seam of data.seams){const a=saved.get(seam.before),b=saved.get(seam.after);for(let v=0;v<skin.vertexCount;v++){const p=world(a.clock.activity,ground,vertex(skin,v,a.mat)),q=world(b.clock.activity,ground,vertex(skin,v,b.mat));report.maxSeamJump=Math.max(report.maxSeamJump,Math.hypot(...p.map((x,k)=>x-q[k])));}}
  const clock=data.clock[Math.floor(data.clock.length/2)],a=posePlanetComposer(g,data.member,clock.activity,ground,clock.rigSeconds);posePlanetComposer(g,data.member,data.clock[0].activity,ground,900000);assert.deepEqual(posePlanetComposer(g,data.member,clock.activity,ground,clock.rigSeconds),a,'A-B-A seek');
  assert.ok(report.stance&&report.swing&&report.adjusted);assert.ok(report.maxReach<1e-6,JSON.stringify(report));assert.ok(report.maxBoneLengthError<1e-6,JSON.stringify(report));assert.ok(report.maxGap<=.003,JSON.stringify(report));assert.ok(report.maxPenetration<=.001,JSON.stringify(report));assert.ok(report.maxSoleDrift<=.001,JSON.stringify(report));assert.ok(report.minBody>0,JSON.stringify(report));assert.ok(report.maxSeamJump<=.001,JSON.stringify(report));assert.deepEqual(sourceDigests(source),before);reports.push(report);
 }
 t.diagnostic(JSON.stringify(reports));
});

test('unreachable horizontal terrain contacts stay explicitly infeasible; unused support fit stays absent',()=>{
 const {graph}=buildPlanetComposerSource(fixture.cases[0].definition),environment={ground:()=>0,contact:l=>({position:[l.rest[0]+100,0,l.rest[2]],stance:true})},original=poseComposer(graph,'idle',.3,{environment}),fit=poseComposer(graph,'idle',.3,{environment:{...environment,supportHeight:'reachable-1'}});
 assert.equal(original.diagnostics.supportHeight,undefined);assert.equal(fit.diagnostics.supportHeight.feasible,false);assert.equal(fit.diagnostics.supportHeight.delta,0);assert.deepEqual(fit.positions,original.positions);assert.deepEqual(fit.contacts,original.contacts);assert.ok(fit.diagnostics.maxReachError>1);
});
