import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateCreatureGenome,realisticIndividualCreatureGenome,buildQuadrupedBody,createQuadrupedBodyColourSampler,createQuadrupedBodyPatternSampler} from '../src/planet-v1/index.ts';
const hash=source=>{const h=createHash('sha256');for(const k of ['positions','normals','colors','skinIndex','skinWeight','index'])h.update(new Uint8Array(source[k].buffer,source[k].byteOffset,source[k].byteLength));return h.digest('hex');};
test('exact shared connected-body paint matches all original quantized samples and never changes source',()=>{
  for(const [archetype,family] of [['browser','ungulate'],['runner','cursorial'],['low-slung','padded'],['long-neck','long-neck']])for(const stage of ['adult','juvenile']){
    const genome=realisticIndividualCreatureGenome(generateCreatureGenome('COAT-SAMPLER-CORPUS',archetype),`${archetype}/${stage}`,1,stage,family),source=buildQuadrupedBody(genome),before=hash(source),identity=JSON.stringify(source.plan.genome),sampler=createQuadrupedBodyColourSampler(source),out=new Float64Array(3);
    assert.equal(sampler.source,source);
    for(let v=0;v<source.bodyVertexCount;v++){
      sampler.sampleInto(source.positions[v*3],source.positions[v*3+1],source.positions[v*3+2],source.normals[v*3+1],out);
      for(let c=0;c<3;c++)assert.equal(Math.round(Math.min(1,Math.max(0,out[c]))*255),source.colors[v*3+c],`${archetype}/${stage}/${v}/${c}`);
    }
    assert.equal(hash(source),before);assert.equal(JSON.stringify(source.plan.genome),identity);
  }
});
test('legacy spot/stripe/solid paint retains original body samples; callback validates scalar/output contract',()=>{
  for(const pattern of ['spots','stripes','solid']){
    const source=buildQuadrupedBody({...generateCreatureGenome('LEGACY-COAT','browser'),appearance:undefined,pattern}),sampler=createQuadrupedBodyColourSampler(source),out=new Float64Array(3);
    for(let v=0;v<source.bodyVertexCount;v+=7){sampler.sampleInto(...source.positions.subarray(v*3,v*3+3),source.normals[v*3+1],out);for(let c=0;c<3;c++)assert.equal(Math.round(Math.min(1,Math.max(0,out[c]))*255),source.colors[v*3+c]);}
    assert.throws(()=>sampler.sampleInto(NaN,0,0,0,out),/colour sampler/);assert.throws(()=>sampler.sampleInto(0,0,0,0,new Float32Array(3)),/colour sampler/);
  }
});

test('planetary forced-mask layers reconstruct exact existing colour or report nonlinear overlay',()=>{
 let eligible=0,nonlinear=0;
 for(const [archetype,family] of [['browser','ungulate'],['runner','cursorial'],['low-slung','padded'],['long-neck','long-neck']])for(const stage of ['adult','juvenile']){
  const source=buildQuadrupedBody(realisticIndividualCreatureGenome(generateCreatureGenome('PATTERN-SAMPLER',archetype),`${archetype}/${stage}`,1,stage,family)),before=hash(source),sampler=createQuadrupedBodyPatternSampler(source),layers=new Float64Array(9),rgb=new Float64Array(3),context={x:0,y:0,z:0,dorsal:0,region:'torso',along:0,footprint:0};
  for(let v=0;v<source.bodyVertexCount;v+=97){
   const args=[...source.positions.subarray(v*3,v*3+3),source.normals[v*3+1]],info=sampler.sampleInto(...args,layers,context);sampler.oracle.sampleInto(...args,rgb);
   assert.ok(Number.isFinite(info.affineError)&&info.affineError>=0);assert.ok(info.coat);assert.ok(context.footprint>0);assert.ok(context.dorsal>=-1&&context.dorsal<=1);assert.ok(context.along>=0&&context.along<=1);
   if(info.affineError<1e-10){eligible++;for(let c=0;c<3;c++)assert.ok(Math.abs(rgb[c]-(layers[c]+info.mask*(layers[c+3]-layers[c])+info.mask*info.patch*(layers[c+6]-layers[c+3])))<1e-10);}else nonlinear++;
  }
  assert.equal(hash(source),before);
 }
 assert.ok(eligible>0);console.log({eligible,nonlinear});
});

test('raw layer sampler reproduces original post-mask clamp underhighcontrastreticulation withoutchangingdefaultcolour',()=>{
 const genome=realisticIndividualCreatureGenome(generateCreatureGenome('RAW-RETIC','runner'),'raw-retic',1,'adult','cursorial');genome.appearance.coat={...genome.appearance.coat,pattern:'reticulated',contrast:1.8,juvenileSpots:0,marks:0};
 const source=buildQuadrupedBody(genome),before=hash(source),sampler=createQuadrupedBodyPatternSampler(source,{rawLayers:true}),layers=new Float64Array(9),rgb=new Float64Array(3),context={x:0,y:0,z:0,dorsal:0,region:'torso',along:0,footprint:0};let checked=0;
 assert.equal(sampler.version,'quadruped-body-pattern-sampler-raw-1');
 for(let v=0;v<source.bodyVertexCount;v+=17){const args=[...source.positions.subarray(v*3,v*3+3),source.normals[v*3+1]],info=sampler.sampleInto(...args,layers,context);sampler.oracle.sampleInto(...args,rgb);if(!info.rawLayers)continue;assert.ok(info.affineError<1e-9);checked++;for(let c=0;c<3;c++){const reconstructed=Math.max(.002,Math.min(1,layers[c]+info.mask*(layers[c+3]-layers[c])+info.mask*info.patch*(layers[c+6]-layers[c+3])));assert.ok(Math.abs(reconstructed-rgb[c])<1e-9);}}
 assert.ok(checked>100);assert.equal(hash(source),before);
});
