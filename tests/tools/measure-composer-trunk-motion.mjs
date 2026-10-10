import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {composerPreset} from '../../src/fauna-composer-recipe.ts';
import {createComposerCreature} from '../../src/fauna-composer.ts';
import {buildComposerSkin} from '../../src/fauna-composer-mesh.ts';
const fixtures=[['trunked-centipede',composerPreset('trunked-centipede')],['quadruped-proboscis',{...composerPreset('rhinoceros'),head:'proboscis',trunk:'trunk',horns:'none'}]];
const quat=(pose,i)=>new T.Quaternion().fromArray(pose.quaternions,i*4),pos=(pose,i)=>new T.Vector3().fromArray(pose.positions,i*3);
const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.dot(b))));
export function measureComposerTrunkMotion() {
const rows=[];
for(const [id,recipe] of fixtures)for(const motion of ['idle','walk','display'])for(const trunkMotion of ['legacy','wave-1']){
 const a=createComposerCreature(recipe,{presentation:'realism-1',trunkMotion}),g=a.graph,s=a.skin,chain=g.chains.trunk,head=g.chains.head,last=chain.at(-1),first=chain[0],lastBone=g.bones[last],lastInv=new T.Quaternion(...lastBone.restQuaternion).invert();
 const dbg=buildComposerSkin(g,{presentation:'realism-1',debug:true}).debug;
 const tip=[],trunkIds=new Set(),joins=[];
 for(const part of s.parts.filter(p=>p.part==='trunk'))for(let j=part.firstTriangle*3;j<(part.firstTriangle+part.triangles)*3;j++)trunkIds.add(s.index[j]);
 for(const v of trunkIds)if(s.skinIndex[v*4]===last&&s.skinWeight[v*4]===1){const p=new T.Vector3().fromArray(s.positions,v*3).sub(new T.Vector3(...lastBone.restPosition)).applyQuaternion(lastInv);if(p.x>lastBone.length)tip.push(v);}
 if(!tip.length)throw new Error('No actual trunk-tip skin vertices');
 for(const part of s.parts.filter(p=>p.part==='trunk'))for(let j=part.firstTriangle*3;j<(part.firstTriangle+part.triangles)*3;j+=3){
  if(dbg.hiddenTriangles[j/3])continue;const ids=[...s.index.slice(j,j+3)];
  if(!ids.some(v=>[0,1,2,3].some(k=>s.skinWeight[v*4+k]>.001&&[head,first].includes(s.skinIndex[v*4+k]))))continue;
  const p=ids.map(v=>new T.Vector3().fromArray(s.positions,v*3)),normal=p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));if(normal.lengthSq()>1e-18)joins.push({ids,normal:normal.normalize(),edges:[p[0].distanceTo(p[1]),p[1].distanceTo(p[2]),p[2].distanceTo(p[0])]});
 }
 let rootAngle=0,minGround=Infinity,liftEvents=0,maxLift=0,flippedFrames=0,maxFlips=0,maxEdgeStretch=1;
 const points=[],steps=360,duration=motion==='walk'?g.locomotion.period:15.18,restLocal=new T.Quaternion(...g.bones[first].restLocal);
 const v=new T.Vector3(),norm=new T.Vector3();
 for(let frame=0;frame<=steps;frame++){
  const time=frame/steps*duration,pose=a.update(motion,time);a.group.updateMatrixWorld(true);
  const hq=quat(pose,head).invert(),hp=pos(pose,head),root=hq.clone().multiply(quat(pose,first));rootAngle=Math.max(rootAngle,angle(root,restLocal));
  const tipMean=new T.Vector3();for(const vi of tip){v.fromArray(s.positions,vi*3);a.mesh.applyBoneTransform(vi,v);tipMean.add(v);}tipMean.multiplyScalar(1/tip.length).sub(hp).applyQuaternion(hq);points.push(tipMean.toArray());
  const posed=new Map();for(const vi of trunkIds){v.fromArray(s.positions,vi*3);a.mesh.applyBoneTransform(vi,v);minGround=Math.min(minGround,v.y);posed.set(vi,v.clone());}
  // Ground solver correction: compare actual local rotation to the requested
  // motion offset. A free trunk has no other local drivers.
  for(let k=0;k<chain.length;k++){
   const bi=chain[k],parent=g.bones[bi].parent,actual=quat(pose,parent).invert().multiply(quat(pose,bi));
   const lag=trunkMotion==='wave-1'?.45*k:0,lp=g.traits.motion.lookPhase,cycle=time/g.locomotion.period+g.traits.motion.phase;
   const gain=trunkMotion==='wave-1'&&k?1.45:1,bias=trunkMotion==='wave-1'&&k&&motion!=='display'?.035:0;
   const curl=motion==='display'?.38+.12*Math.sin(2*Math.PI*(time/2.4+lp)-lag):bias+gain*(motion==='walk'?.05*Math.sin(2*Math.PI*cycle-lag):.08*Math.sin(2*Math.PI*(time/4.6+lp)-lag));
   const sway=gain*(motion==='walk'?.12*Math.sin(2*Math.PI*cycle+1-lag):.1*Math.sin(2*Math.PI*(time/3.3+lp)-lag));
   const cw=trunkMotion==='wave-1'?[.08,.45,.85,1.25,1.6,1.85][k]:.4+k*.25,sw=trunkMotion==='wave-1'?[.12,.35,.55,.65,.65,.65][k]:(k?.4:1);
   const expected=new T.Quaternion(...g.bones[bi].restLocal).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),curl*cw)).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),sway*sw));
   const correction=angle(actual,expected);if(correction>1e-6){liftEvents++;maxLift=Math.max(maxLift,correction);}
  }
  if(frame%(steps/6)===0){
   let flips=0;const rotations=g.bones.map((bone,i)=>quat(pose,i).multiply(new T.Quaternion(...bone.restQuaternion).invert()));
   for(const f of joins){const p=f.ids.map(i=>posed.get(i)),cross=p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize(),expected=new T.Vector3();for(const vi of f.ids)for(let k=0;k<4;k++)if(s.skinWeight[vi*4+k]){norm.copy(f.normal).applyQuaternion(rotations[s.skinIndex[vi*4+k]]);expected.addScaledVector(norm,s.skinWeight[vi*4+k]/3);}if(cross.dot(expected)<0)flips++;for(let e=0;e<3;e++)if(f.edges[e]>1e-8)maxEdgeStretch=Math.max(maxEdgeStretch,p[e].distanceTo(p[(e+1)%3])/f.edges[e]);}
   maxFlips=Math.max(maxFlips,flips);if(flips)flippedFrames++;
  }
 }
 const mean=points.reduce((m,p)=>m.map((v,i)=>v+p[i]/points.length),[0,0,0]),rms=Math.sqrt(points.reduce((n,p)=>n+p.reduce((m,v,i)=>m+(v-mean[i])**2,0),0)/points.length),ranges=[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))-Math.min(...points.map(p=>p[i])));
 rows.push({id,motion,trunkMotion,duration,steps,rootAngle,rmsTipExcursion:rms,tipRanges:ranges,minGround,liftEvents,maxLift,maxFlips,flippedFrames,maxEdgeStretch,tipVertices:tip.length,joinTriangles:joins.length});a.dispose();
}
const paired=[];for(let i=0;i<rows.length;i+=2){const old=rows[i],now=rows[i+1];paired.push({id:old.id,motion:old.motion,rootRatio:now.rootAngle/old.rootAngle,tipRmsRatio:now.rmsTipExcursion/old.rmsTipExcursion,ground:[old.minGround,now.minGround],liftEvents:[old.liftEvents,now.liftEvents],maxLift:[old.maxLift,now.maxLift],flips:[old.maxFlips,now.maxFlips],edgeStretch:[old.maxEdgeStretch,now.maxEdgeStretch]});}
return {rows,paired};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=measureComposerTrunkMotion();if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result.paired,null,2));
}
