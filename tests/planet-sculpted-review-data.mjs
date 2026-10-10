/** Optional Atlas reducer acceptance, outside Kit's core dependency boundary.
 * ATLAS_ROOT selects the consumer being checked; output is disposable evidence. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {buildQuadrupedBody,quadrupedPoseAt,quadrupedBodyBytes} from '../src/planet-v1/index.ts';
import {fields,digestBody,bonePalette,deformBody,footSurfaceEvidence,topologyEvidence} from './helpers/planet-body-evidence.mjs';
const out=process.env.QUALITY_RESULTS,atlas=process.env.ATLAS_ROOT;
if(!out||!atlas)throw new Error('QUALITY_RESULTS and ATLAS_ROOT are required');
const {buildFaunaJointConstrainedLodChain}=await import(pathToFileURL(atlas+'/src/fauna-body-lod-candidates.ts'));
const fixture=JSON.parse(await readFile(new URL('./fixtures/planet-sculpted-specimens.json',import.meta.url),'utf8'));
await mkdir(out,{recursive:true});
const pack=b=>({plan:b.plan,...Object.fromEntries(fields.map(f=>[f,Array.from(b[f])])),vertexCount:b.vertexCount,triangleCount:b.triangleCount,bodyVertexCount:b.bodyVertexCount,bodyTriangleCount:b.bodyTriangleCount,faceFeatures:b.faceFeatures,cellM:b.cellM});
const report={scope:'Paired canonical-body presentation review; true walking, flat ground, fixed lights/camera. Consumer QEM acceptance; no Quest or export approval.',source:fixture.source,rows:[]};
for(let i=0;i<fixture.rows.length;i++){
  const row=fixture.rows[i],before=JSON.stringify(row.genome),legacy=buildQuadrupedBody(row.genome),sculpt=buildQuadrupedBody(row.genome,{presentation:'sculpted-v1'}),digest=digestBody(sculpt);
  assert.equal(digestBody(legacy),row.sourceDigest);
  const lod=buildFaunaJointConstrainedLodChain(sculpt,[1500,750]);
  assert.equal(digestBody(sculpt),digest);assert.equal(JSON.stringify(row.genome),before);
  for(const l of lod.levels){assert.ok(l.reached);assert.ok(l.withinBudget);}
  const bodies=[legacy,sculpt,...lod.levels],labels=['Legacy body 4','Sculpted v1','Sculpted 1500 triangles','Sculpted 750 triangles'];
  const poses=row.poses.map(p=>({...p,activity:{...p.activity,revolutionS:p.name==='walk'?100:Infinity}}));
  // Additional phase coverage must actually include raised and planted feet.
  for(const phase of [.031,.057,.092,.143])poses.push({...poses[1],name:`walk-${phase}`,phase,activity:{...poses[1].activity,travel:phase}});
  let swings=0;
  const evidence=poses.map(p=>{
    const input=[p.member,p.activity,()=>0,p.phase*10,{behaviour:p.behaviour}],pose=quadrupedPoseAt(sculpt.plan,...input),originalPose=quadrupedPoseAt(legacy.plan,...input);
    assert.deepEqual(pose,originalPose);if(p.name.startsWith('walk'))assert.equal(pose.state,'walk');
    swings+=pose.feet.filter(f=>!f.stance).length;
    const palette=bonePalette(sculpt.plan,pose);
    return {name:p.name,palette:Array.from(palette),state:pose.state,maxReachError:pose.maxReachError,headClearance:pose.headClearance,
      feet:bodies.map((b,j)=>({label:labels[j],feet:footSurfaceEvidence(b,deformBody(b,palette),pose)}))};
  });assert.ok(swings>0);
  const data={...row,variants:bodies.map((b,j)=>({label:labels[j],body:pack(b)})),poses:evidence};
  await writeFile(`${out}/row-${i}.json`,JSON.stringify(data));
  const summary={i,id:row.id,archetype:row.archetype,stage:row.stage,genomeUnchanged:true,legacyDigestUnchanged:true,poseParity:true,swingFeetSampled:swings,
    variants:bodies.map((b,j)=>({label:labels[j],version:b.plan.version,vertices:b.vertexCount,triangles:b.triangleCount,cpuBytes:quadrupedBodyBytes(b),cellM:b.cellM,grid:b.grid,digest:digestBody(b),...(j<2?{topology:topologyEvidence(b),surfaceCleanup:b.surfaceCleanup}:{reached:b.reached,droppedFeatures:b.droppedFeatures})})),poses:evidence.map(({palette,...p})=>p)};
  report.rows.push(summary);console.log(JSON.stringify({i,id:row.id,triangles:summary.variants.map(v=>v.triangles),swings}));
}
report.ok=true;await writeFile(out+'/report.json',JSON.stringify(report,null,2));
