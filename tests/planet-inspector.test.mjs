import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {generateCreatureGenome,realisticIndividualCreatureGenome,buildQuadrupedBody,quadrupedPoseAt,createPlanetAnimalInspector,planetAnimalDefinition} from '../src/planet-v1/index.ts';
test('shared inspector retains the loaded canonical genome/body and exact solved bone transforms',()=>{
  for(const archetype of ['browser','runner','low-slung','long-neck']){
    const id=`shared-inspector/${archetype}`,genome=realisticIndividualCreatureGenome(generateCreatureGenome('INSPECTOR',archetype),id,1,'adult');
    const member={id,anchorOffsetX:0,anchorOffsetZ:0,orbitRadiusM:6,orbitAngularSpeed:.2,orbitPhase:.3,gaitPeriodS:12};
    const sample=time=>({activity:{pose:{x:0,z:0,yaw:0,gait:'walk'},travel:time/100,revolutionS:100,stateS:3.7},rigSeconds:time,behaviour:'alert'});
    const inspector=createPlanetAnimalInspector(genome,{member,sample}),original=buildQuadrupedBody(genome);
    try{
      assert.equal(inspector.body.plan.genome,genome);
      for(const key of ['positions','normals','colors','skinIndex','skinWeight','index'])assert.deepEqual(inspector.body[key],original[key],`${archetype}: ${key}`);
      for(const time of [0,.25,4.7]){
        inspector.update(time);const input=sample(time),pose=quadrupedPoseAt(original.plan,member,input.activity,()=>0,input.rigSeconds,{behaviour:input.behaviour});
        inspector.mesh.skeleton.bones.forEach((bone,i)=>{assert.deepEqual(bone.position.toArray(),Array.from(pose.positions.slice(i*3,i*3+3)));assert.deepEqual(bone.quaternion.toArray(),Array.from(pose.quaternions.slice(i*4,i*4+4)));});
      }
    }finally{inspector.dispose();}
  }
});
test('inspection source definition preserves identity and rejects accidental generator/version substitution',()=>{
  const genome=generateCreatureGenome('SOURCE-DEFINITION','runner'),input={individualId:'planet/member/17',speciesId:'planet/species/4',genome};
  const definition=planetAnimalDefinition(input);assert.equal(definition.genome,genome);assert.equal(definition.individualId,input.individualId);assert.equal(definition.speciesId,input.speciesId);
  assert.throws(()=>planetAnimalDefinition({...input,kind:'composer-recipe'}),/canonical genome/);
  assert.throws(()=>planetAnimalDefinition({...input,genome:{...genome,version:'future-unmigrated'}}),/migrate explicitly/);
});
test('caller material/geometry hooks do not require an Atlas import and ownership is explicit',()=>{
  const genome=generateCreatureGenome('INSPECTOR-HOOKS','browser'),material=new THREE.MeshStandardMaterial({vertexColors:true});let materialDisposes=0;material.addEventListener('dispose',()=>materialDisposes++);
  const inspector=createPlanetAnimalInspector(genome,{member:{id:'hooks',anchorOffsetX:0,anchorOffsetZ:0,orbitRadiusM:6,orbitAngularSpeed:0,orbitPhase:0,gaitPeriodS:12},sample:()=>({activity:{pose:{x:0,z:0,yaw:0,gait:'idle'},travel:0,revolutionS:Infinity,stateS:4},rigSeconds:0}),material,
    prepareGeometry(g,source){g.setAttribute('restSourcePosition',new THREE.BufferAttribute(source.positions.slice(),3));}});
  assert.ok(inspector.mesh.geometry.hasAttribute('restSourcePosition'));inspector.dispose();inspector.dispose();assert.equal(materialDisposes,0,'borrowed material remains caller-owned');material.dispose();
});
