import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ComposerPaletteUploads} from '../../src/fauna-composer-palette-uploads.ts';
const texture=(rows=4,bones=16)=>new THREE.DataTexture(new Float32Array(rows*bones*16),bones*4,rows,THREE.RGBAFormat,THREE.FloatType);
const consumed=t=>{t.clearUpdateRanges();t.onUpdate?.();};
test('first upload initializes every texel; later dirty rows queue exact RGBA ranges',()=>{
 const t=texture(),tracker=new ComposerPaletteUploads(4);tracker.attach(t);
 tracker.mark(17,3);assert.equal(tracker.flush(),t.image.data.byteLength);assert.deepEqual(t.updateRanges,[]);consumed(t);
 tracker.mark(17,3);tracker.mark(33,2);tracker.mark(256+1,2);
 assert.equal(tracker.flush(),(36-16+4)*4);assert.deepEqual(t.updateRanges,[{start:16,count:20},{start:256,count:4}]);
 consumed(t);assert.equal(tracker.flush(),0);assert.equal(tracker.pendingBytes,0);
});
test('pending changes survive many simulation frames without a render and keep a bounded pooled queue',()=>{
 const t=texture(),tracker=new ComposerPaletteUploads(4);tracker.attach(t);consumed(t);
 tracker.mark(4,4);tracker.flush();const range=t.updateRanges[0];
 for(let i=0;i<1000;i++){tracker.mark(12,4);tracker.mark(256+20,4);tracker.flush();}
 assert.equal(t.updateRanges.length,2);assert.equal(t.updateRanges[0],range);assert.deepEqual(t.updateRanges[0],{start:4,count:12});
 assert.equal(tracker.pendingBytes,64);consumed(t);assert.equal(tracker.pendingBytes,0);
});
test('full/partial toggles and resized/context-restored textures cannot lose earlier dirty rows',()=>{
 const t=texture(),tracker=new ComposerPaletteUploads(4);tracker.attach(t);consumed(t);
 tracker.mark(4,4);tracker.flush();tracker.setPartial(false);assert.deepEqual(t.updateRanges,[]);consumed(t);
 tracker.mark(300,4);assert.equal(tracker.flush(),t.image.data.byteLength);consumed(t);
 tracker.setPartial(true);tracker.mark(300,4);assert.equal(tracker.flush(),t.image.data.byteLength);consumed(t);
 tracker.mark(300,4);assert.equal(tracker.flush(),16);consumed(t);
 const bigger=texture(4,32);tracker.attach(bigger);tracker.mark(512,4);assert.equal(tracker.flush(),bigger.image.data.byteLength);consumed(bigger);
 tracker.mark(512,4);assert.equal(tracker.flush(),16);assert.throws(()=>tracker.mark(510,4),/crosses a row/);
 tracker.detach();assert.equal(tracker.pendingBytes,0);assert.equal(bigger.onUpdate,null);
});
