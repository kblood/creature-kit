import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildComposerLodChain} from '../src/fauna-composer-lod.ts';
function fixture(){
 const width=17,n=width*width,positions=new Float32Array(n*3),colors=new Float32Array(n*3),skinIndex=new Uint16Array(n*4),skinWeight=new Float32Array(n*4),indices=[];
 for(let y=0;y<width;y++)for(let x=0;x<width;x++){const v=y*width+x;positions.set([x/width,Math.sin(x*.4)*Math.cos(y*.3)*.1,y/width],v*3);colors.set([x%3/2,y%5/4,.5],v*3);skinWeight[v*4]=1;}
 for(let y=0;y<width-1;y++)for(let x=0;x<width-1;x++){const v=y*width+x;indices.push(v,v+width,v+1,v+1,v+width,v+width+1);}
 return {positions,colors,skinIndex,skinWeight,index:new Uint32Array(indices)};
}
export {fixture};
export const hash=c=>{const h=createHash('sha256');for(const l of c.levels)for(const a of [l.positions,l.colors,l.skinIndex,l.skinWeight,l.index,l.sourceVertex,l.representative])h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));h.update(JSON.stringify(c.levels.map(l=>l.stats)));return h.digest('hex');};
test('optional constraints absent preserve frozen baseline output',()=>{assert.equal(hash(buildComposerLodChain(fixture(),[200,100],{symmetry:false})), 'cecf000efb6e185591722120b4114e948db119cdd8cfb5af409402340b6488f2');});
test('protected anchors remain exact and fully locked target reports refusal',()=>{const src=fixture(),mask=new Uint8Array(src.positions.length/3);mask[144]=1;const c=buildComposerLodChain(src,[100],{symmetry:false,protectedVertices:mask,vertexImportance:new Float32Array(mask.length).fill(2)});assert.ok(c.levels[0].sourceVertex.includes(144));mask.fill(1);const blocked=buildComposerLodChain(src,[100],{protectedVertices:mask});assert.equal(blocked.levels[0].reached,false);assert.equal(blocked.levels[0].triangles,src.index.length/3);});
test('invalid constraints reject before reduction',()=>{const src=fixture();for(const options of [{protectedVertices:new Uint8Array(2)},{protectedVertices:new Uint8Array(289).fill(2)},{vertexImportance:new Float32Array(289)},{vertexImportance:new Float32Array(289).fill(NaN)}])assert.throws(()=>buildComposerLodChain(src,[100],options),/composer lod/);});
