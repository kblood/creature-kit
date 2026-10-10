import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildQuadrupedBody,quadrupedBodyBuildSteps,createQuadrupedPlan,quadrupedPoseAt,quadrupedBodyBytes,QUADRUPED_BODY_VERSION,QUADRUPED_SCULPTED_BODY_VERSION,createPlanetAnimalInspector} from '../src/planet-v1/index.ts';
import {digestBody,bonePalette,deformBody,footSurfaceEvidence,topologyEvidence} from './helpers/planet-body-evidence.mjs';
const {rows}=JSON.parse(readFileSync(new URL('./fixtures/planet-sculpted-specimens.json',import.meta.url),'utf8'));
for(const row of rows)test(`sculpted presentation preserves inherited identity and exact rig: ${row.id}`,()=>{
  const before=JSON.stringify(row.genome),legacy=buildQuadrupedBody(row.genome),body=buildQuadrupedBody(row.genome,{presentation:'sculpted-v1'});
  assert.equal(digestBody(legacy),row.sourceDigest,'the frozen six-array body-4 reference is unchanged');
  assert.equal(legacy.plan.version,QUADRUPED_BODY_VERSION);assert.equal(body.plan.version,QUADRUPED_SCULPTED_BODY_VERSION);
  assert.equal(body.plan.genome,row.genome);assert.equal(JSON.stringify(row.genome),before);
  for(const key of ['bones','legs','gait','torsoY','neckBase','neckTip','headCentre','muzzleTip','tailBase','tailTip','grazeClearanceM'])assert.deepEqual(body.plan[key],legacy.plan[key],key);
  assert.notEqual(digestBody(body),digestBody(legacy));
  assert.ok(body.vertexCount<=40000);assert.ok(body.triangleCount<=60000);assert.ok(body.grid.reduce((a,b)=>a*b,1)<=200000);
  assert.ok(quadrupedBodyBytes(body)>0);assert.ok(body.positions.every(Number.isFinite));assert.ok(body.normals.every(Number.isFinite));
  const topology=topologyEvidence(body);
  assert.equal(topology.components,1);assert.equal(topology.boundaryEdges,0);assert.equal(topology.degenerateIndexTriangles,0);
  // Surface nets retain the pre-existing ambiguous saddle-edge limitation.
  // The paired review records its exact count; this is not retopology approval.
  for(let v=0;v<body.vertexCount;v++)assert.equal(body.skinWeight.slice(v*4,v*4+4).reduce((a,b)=>a+b,0),255);
  for(const p of row.poses){
    const input=[p.member,{...p.activity,revolutionS:p.name==='walk'?100:Infinity},()=>0,p.phase*10,{behaviour:p.behaviour}];
    const oldPose=quadrupedPoseAt(legacy.plan,...input),pose=quadrupedPoseAt(body.plan,...input);assert.deepEqual(pose,oldPose,`${p.name}: exact pose`);
    if(p.name==='walk')assert.equal(pose.state,'walk');
    const palette=bonePalette(body.plan,pose),posed=deformBody(body,palette);assert.ok(posed.every(Number.isFinite));
    const feet=footSurfaceEvidence(body,posed,pose);
    for(const foot of feet){assert.ok(foot.vertices>3);if(foot.stance){assert.ok(foot.soleGapM>-.012,`${p.name} ${foot.id} penetrates ${foot.soleGapM}`);assert.ok(foot.soleGapM<Math.max(.018,body.cellM*.75),`${p.name} ${foot.id} floats ${foot.soleGapM}`);}}
  }
});
test('explicit presentation selection, resumable build and shared inspector agree',()=>{
  const row=rows[0],g=row.genome;
  assert.throws(()=>createQuadrupedPlan(g,{presentation:'future'}),/migrate explicitly/);
  const options={presentation:'sculpted-v1'},body=buildQuadrupedBody(g,options),steps=quadrupedBodyBuildSteps(g,options);let result,yields=0;
  do{result=steps.next();yields++;}while(!result.done);
  assert.ok(yields>10);assert.equal(digestBody(result.value),digestBody(body));
  assert.equal(digestBody(buildQuadrupedBody(g,{presentation:'legacy-v4'})),row.sourceDigest);
  const p=row.poses[0],inspector=createPlanetAnimalInspector(g,{...options,member:p.member,sample:()=>({activity:p.activity,rigSeconds:p.phase*10,behaviour:p.behaviour})});
  try{assert.equal(digestBody(inspector.body),digestBody(body));assert.equal(inspector.mesh.geometry.userData.bodyVersion,QUADRUPED_SCULPTED_BODY_VERSION);}finally{inspector.dispose();}
});
