import test from 'node:test';
import assert from 'node:assert/strict';
import {anatomyCorpus} from './helpers/composer-lod-anatomy.mjs';
import {attachmentMetrics,deformAttachmentMesh,retainedEarSupports} from './helpers/composer-lod-attachments.mjs';
import {buildComposerLodChain,composerAnatomyLodConstraints} from '../src/fauna-composer-lod.ts';
import {poseComposer} from '../src/fauna-composer-rig.ts';

test('shared anatomical LOD preserves actual ear support and connected tail shafts in adult/young rest and posed surfaces',t=>{
 let earSamples=0,shaftSamples=0,tipIntersections=0,maxEarGapGrowth=0,minShaftRatio=1;const supportReceipts=[];
 const inspect=(id,source,level,graph)=>{
  const full=attachmentMetrics(source,graph),low=attachmentMetrics(level,graph);
  assert.equal(low.ears.length,full.ears.length,`${id}: all source ears retained`);
  assert.deepEqual(low.ears.map(e=>e.side),full.ears.map(e=>e.side),'match each actual ear in the posed head frame');
  for(let i=0;i<low.ears.length;i++){earSamples++;const growth=low.ears[i].gap-full.ears[i].gap;maxEarGapGrowth=Math.max(maxEarGapGrowth,growth);assert.ok(growth<=.002,`${id}: cranial surface receded from ear by ${growth}m`);}
  assert.equal(low.tailSections.length,full.tailSections.length);
  for(let i=0;i<full.tailSections.length;i++)for(const dimension of ['width','height'])if(full.tailSections[i][dimension]>1e-6){shaftSamples++;const ratio=low.tailSections[i][dimension]/full.tailSections[i][dimension];minShaftRatio=Math.min(minShaftRatio,ratio);assert.ok(ratio>=.30,`${id}: tail joint${full.tailSections[i].joint}/${full.tailSections[i].u} ${dimension} collapsed to ${ratio}`);}
  if(full.tailTipIntersectsShaft){tipIntersections++;assert.equal(low.tailTipIntersectsShaft,true,`${id}: detached tuft; actual source shaft/tip surfaces intersect`);}
 };
 for(const specimen of anatomyCorpus().filter(s=>s.definition)){
  const {skin,graph}=specimen.build(),before=structuredClone(skin),chain=buildComposerLodChain(skin,[8000,3000,1000],composerAnatomyLodConstraints(skin,graph));
  for(const level of chain.levels){assert.ok(level.reached,`${specimen.id}/${level.target}: same triangle target required`);inspect(`${specimen.id}/rest/${level.target}`,skin,level,graph);
   const supports=retainedEarSupports(skin,level,graph);for(const receipt of supports){assert.equal(receipt.retained.supportTriangle.length,3,'original weighted cranial support facet remains adjacent');assert.ok(receipt.retained.gap<=receipt.source.gap+1e-9,`${specimen.id}/${level.target}: original supporting triangle lost`);}if(level.target===1000)supportReceipts.push({id:specimen.id,supports});
  }
  const low=chain.levels.at(-1);
  for(const phase of [0,.17,.39,.61,.83,1]){
   const pose=poseComposer(graph,'walk',phase*graph.locomotion.period),full=deformAttachmentMesh(skin,graph,pose),reduced=deformAttachmentMesh(low,graph,pose);
   const posedGraph={...graph,bones:graph.bones.map((b,i)=>({...b,restPosition:Array.from(pose.positions.slice(i*3,i*3+3)),restQuaternion:Array.from(pose.quaternions.slice(i*4,i*4+4))}))};
   inspect(`${specimen.id}/walk/${phase}`,full,reduced,posedGraph);
  }
  assert.deepEqual(skin,before,'attachment constraints never remodel the original source');
 }
 assert.ok(earSamples>=200&&shaftSamples>1000&&tipIntersections>=80);
 t.diagnostic(JSON.stringify({earSamples,shaftSamples,tipIntersections,maxEarGapGrowth,minShaftRatio,supportReceipts}));
});
