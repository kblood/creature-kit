import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {anatomyCorpus,arrayBytes,trunkSections} from '../helpers/composer-lod-anatomy.mjs';
import {buildComposerLodChain,composerAnatomyLodConstraints,composerFootLodConstraints} from '../../src/fauna-composer-lod.ts';
const output=process.argv[2];if(!output)throw new Error('Pass a new evidence directory');await mkdir(output,{recursive:false});
const rows=[];
for(const specimen of anatomyCorpus()){
 const {graph,skin}=specimen.build(),sourceSections=trunkSections(skin,graph),variants=[];
 const coatBytesPerVertex=skin.coatLayers?Object.values(skin.coatLayers).reduce((n,a)=>n+a.byteLength,0)/skin.vertexCount:0;
 for(const kind of ['foot-1','anatomy-1']){
  const options=kind==='foot-1'?composerFootLodConstraints(skin):composerAnatomyLodConstraints(skin,graph),chain=buildComposerLodChain(skin,[8000,3000,1500,1000],options);
  variants.push({kind,anchors:options.protectedVertices.reduce((n,v)=>n+v,0),levels:chain.levels.map(l=>{const arrays=arrayBytes(l);return {target:l.target,triangles:l.triangles,vertices:l.vertices,reached:l.reached,arrays,rawRenderArrayBytes:Object.entries(arrays).filter(([k])=>k!=='sourceVertex'&&k!=='representative').reduce((n,[,bytes])=>n+bytes,0)+coatBytesPerVertex*l.vertices,coatLayerBytes:coatBytesPerVertex*l.vertices,parts:l.parts,sections:trunkSections(l,graph)};})});
 }
 const row={id:specimen.id,recipe:graph.recipe,definition:specimen.definition,source:{triangles:skin.triangleCount,vertices:skin.vertexCount,bones:graph.bones.length,sections:sourceSections},variants};rows.push(row);
 console.log(JSON.stringify({id:row.id,tiers:variants.map(v=>({kind:v.kind,anchors:v.anchors,triangles:v.levels.map(l=>l.triangles),minTrunkWidthRatio:v.levels.at(-1).sections.length?Math.min(...v.levels.at(-1).sections.map((s,i)=>s.width/sourceSections[i].width)):null}))}));
}
await writeFile(join(output,'report.json'),JSON.stringify({version:'composer-anatomy-lod-review-1',provider:'deterministic-code',license:'UNLICENSED',targets:[8000,3000,1500,1000],visualAcceptance:false,rows},null,2));
