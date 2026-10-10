import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateCreatureGenome,realisticIndividualCreatureGenome,buildQuadrupedBody,createQuadrupedBodyColourSampler} from '../src/planet-v1/index.ts';
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
