import {createHash} from 'node:crypto';
const hash=parts=>{const h=createHash('sha256');for(const part of parts)h.update(typeof part==='string'?part:Buffer.from(part.buffer,part.byteOffset,part.byteLength));return h.digest('hex');};
/** Behavioural migration corpus: identities, inherited genomes, rendered
 * byte buffers and terrain-aware walking/feeding poses from the existing core. */
export function planetCoreCorpus(api){
  const archetypes=['browser','runner','low-slung','long-neck'],founders={},inherited={};
  for(const archetype of archetypes){
    founders[archetype]=api.generateCreatureGenome('PACKAGE-PARITY/'+archetype,archetype);
    inherited[archetype]=api.generateCreatureGenome('PACKAGE-PARITY/'+archetype+'/child',archetype,founders[archetype]);
  }
  const families=[['browser','ungulate'],['runner','cursorial'],['low-slung','padded'],['long-neck','long-neck'],['browser','proboscidean'],['runner','winged']],bodies={};
  for(const [archetype,family] of families)for(const stage of ['adult','juvenile']){
    const id=`parity/${family}/${stage}`,genome=api.realisticIndividualCreatureGenome(inherited[archetype],id,2,stage,family),body=api.buildQuadrupedBody(genome);
    const member={id,anchorOffsetX:.3,anchorOffsetZ:-.7,orbitRadiusM:5,orbitAngularSpeed:.12,orbitPhase:.2,gaitPeriodS:12};
    const poses={};
    for(const behaviour of ['alert','feed']){
      const activity={pose:{x:1,z:2,yaw:.5,gait:behaviour==='feed'?'idle':'walk'},travel:.18,revolutionS:52,stateS:3.7};
      const pose=api.quadrupedPoseAt(body.plan,member,activity,(x,z)=>.02*x-.03*z,17.25,{behaviour});
      poses[behaviour]=hash([pose.positions,pose.quaternions,pose.joints,JSON.stringify({...pose,positions:undefined,quaternions:undefined,joints:undefined})]);
    }
    const sample=[];for(let i=0;i<20;i++)sample.push(api.sampleFaunaCoat(genome,Math.sin(i)*.8,.15*Math.cos(i),Math.sin(i*.7)*.2,body.plan.torsoY));
    bodies[id]={genome:hash([JSON.stringify(genome)]),plan:hash([JSON.stringify(body.plan)]),geometry:hash([body.positions,body.normals,body.colors,body.skinIndex,body.skinWeight,body.index]),
      details:hash([JSON.stringify({bodyVertexCount:body.bodyVertexCount,bodyTriangleCount:body.bodyTriangleCount,vertexCount:body.vertexCount,triangleCount:body.triangleCount,cellM:body.cellM,grid:body.grid,faceFeatures:body.faceFeatures,structuralVertexCount:body.structuralVertexCount,structuralTriangleCount:body.structuralTriangleCount})]),
      coat:hash([JSON.stringify(sample)]),poses};
  }
  return {versions:{genome:api.CREATURE_GENOME_VERSION,appearance:api.FAUNA_APPEARANCE_VERSION,body:api.QUADRUPED_BODY_VERSION},founders,inherited,bodies};
}
