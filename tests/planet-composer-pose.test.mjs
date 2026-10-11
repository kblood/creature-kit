import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {composerPreset} from '../src/fauna-composer-recipe.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {poseComposer} from '../src/fauna-composer-rig.ts';
import {posePlanetComposer} from '../src/planet-composer-pose.ts';

const member={id:'composer-planet-pose-test',anchorOffsetX:1,anchorOffsetZ:-2,orbitRadiusM:6,orbitAngularSpeed:.1,orbitPhase:.37,gaitPeriodS:1};
const revolution=Math.PI*2/.1;
const activity=(travel,gait='walk')=>{const angle=member.orbitPhase+travel*Math.PI*2;return {pose:{x:member.anchorOffsetX+Math.cos(angle)*6,z:member.anchorOffsetZ+Math.sin(angle)*6,yaw:angle+Math.PI/2,gait},travel,revolutionS:revolution,stateS:.7};};
const ground=(x,z)=>.08*x+.05*z+.025*Math.sin(x*.7)*Math.cos(z*.6);
const pointToWorld=(a,p)=>{const c=Math.cos(a.pose.yaw),s=Math.sin(a.pose.yaw);return [a.pose.x+c*p[0]+s*p[2],ground(a.pose.x,a.pose.z)+p[1],a.pose.z+s*p[0]-c*p[2]];};

test('dated Composer gait is seek-independent and genuinely swings on nonflat terrain',()=>{
 for(const id of ['dinosaur','rhinoceros','giraffe','turtle','centipede']){
  const creature=createComposerCreature(composerPreset(id),{presentation:'realism-1'});
  try{
   let swing=0,stance=0,maxReach=0,maxGap=0;
   for(let i=0;i<96;i++){
    const a=activity(.18+i*.0007),pose=posePlanetComposer(creature.graph,member,a,ground,1000+i*.01);
    assert.equal(pose.planet.memberId,member.id);assert.equal(pose.positions.length,creature.graph.bones.length*3);
    for(const foot of pose.contacts){maxReach=Math.max(maxReach,foot.reachError);const p=pointToWorld(a,foot.contact),clearance=p[1]-ground(p[0],p[2]);if(foot.stance){stance++;maxGap=Math.max(maxGap,Math.abs(clearance));}else{swing++;assert.ok(clearance>=-1e-6,`${id}: swing below terrain ${clearance}`);}}
   }
   assert.ok(swing>0&&stance>0,id);assert.ok(maxReach<.002,`${id}: reach error ${maxReach}`);assert.ok(maxGap<.002,`${id}: stance gap ${maxGap}`);
   const a=activity(.321),first=posePlanetComposer(creature.graph,member,a,ground,19000);
   posePlanetComposer(creature.graph,member,activity(.8),ground,900000);
   assert.deepEqual(posePlanetComposer(creature.graph,member,a,ground,19000),first,id);
  }finally{creature.dispose();}
 }
});

test('stance contacts stay fixed in herd space on a curved orbit rather than sliding with its root',()=>{
 const creature=createComposerCreature(composerPreset('rhinoceros'),{presentation:'realism-1'});
 try{
  let pairs=0;
  for(let i=0;i<240;i++){
   const a=activity(.1+i*.0002),b=activity(.1+i*.0002+1e-5),p=posePlanetComposer(creature.graph,member,a,ground,i*.01),q=posePlanetComposer(creature.graph,member,b,ground,i*.01+.001);
   for(let j=0;j<p.contacts.length;j++)if(p.contacts[j].stance&&q.contacts[j].stance){pairs++;for(let k=0;k<3;k++)assert.ok(Math.abs(p.contacts[j].world[k]-q.contacts[j].world[k])<2e-6,`foot ${j} axis${k} slipped ${p.contacts[j].world[k]-q.contacts[j].world[k]}`);}
  }
  assert.ok(pairs>100);
 }finally{creature.dispose();}
});

test('actual deformed skin6 soles follow a sloping plane; solver markers alone do not pass',()=>{
 const plane=(x,z)=>.07*x-.04*z;
 for(const id of ['dinosaur','rhinoceros','giraffe']){
  const creature=createComposerCreature(composerPreset(id),{presentation:'realism-1'});
  try{
   const graph=creature.graph,skin=creature.skin;
   let samples=0,maxPenetration=0,maxGap=0;
   for(let step=0;step<12;step++){
    const a=activity(.25+step*.002),pose=posePlanetComposer(graph,member,a,plane,1600+step*.1),cos=Math.cos(a.pose.yaw),sin=Math.sin(a.pose.yaw);
    for(const contact of pose.contacts.filter(c=>c.stance)){
     const limb=graph.limbs[contact.limb],bone=graph.bones[limb.bones.at(-1)],restQ=new THREE.Quaternion().fromArray(bone.restQuaternion),inverseRest=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(bone.restPosition),restQ,new THREE.Vector3(1,1,1)).invert();
     const posed=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(pose.positions,bone.index*3),new THREE.Quaternion().fromArray(pose.quaternions,bone.index*4),new THREE.Vector3(1,pose.radialScale[bone.index],pose.radialScale[bone.index]*pose.chordScale[bone.index]));
     const matrix=posed.clone().multiply(inverseRest);
     for(let v=0;v<skin.vertexCount;v++){
      let weight=0;for(let k=0;k<4;k++)if(skin.skinIndex[v*4+k]===bone.index)weight+=skin.skinWeight[v*4+k];if(weight<.999999)continue;
      const source=new THREE.Vector3().fromArray(skin.positions,v*3),local=source.clone().applyMatrix4(inverseRest);if(Math.abs(local.y+limb.footHeight)>2e-5)continue;
      const p=source.applyMatrix4(matrix),x=a.pose.x+cos*p.x+sin*p.z,z=a.pose.z+sin*p.x-cos*p.z,h=plane(a.pose.x,a.pose.z)+p.y;
      const gap=h-plane(x,z);maxPenetration=Math.max(maxPenetration,-gap);maxGap=Math.max(maxGap,Math.abs(gap));samples++;
     }
    }
   }
   assert.ok(samples>10,id);assert.ok(maxPenetration<2e-5,`${id}: actual sole penetration ${maxPenetration}`);assert.ok(maxGap<2e-5,`${id}: actual sole gap ${maxGap}`);
  }finally{creature.dispose();}
 }
});

test('runtime clock moves after120seconds and omitted environment remains historical pose path',()=>{
 const creature=createComposerCreature(composerPreset('giraffe'));
 try{
  const a=activity(.3,'idle');assert.notDeepEqual(posePlanetComposer(creature.graph,member,a,ground,1000).quaternions,posePlanetComposer(creature.graph,member,a,ground,1001).quaternions);
  assert.deepEqual(poseComposer(creature.graph,'walk',.4),poseComposer(creature.graph,'walk',.4,{}));
  assert.throws(()=>posePlanetComposer(creature.graph,member,a,()=>NaN,1000),/terrain/);
  assert.throws(()=>posePlanetComposer(creature.graph,member,a,ground,1000001),/path/);
 }finally{creature.dispose();}
});
