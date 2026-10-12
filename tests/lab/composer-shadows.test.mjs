import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {composerShadowStrength,patchComposerShadowFade} from '../../src/fauna-composer-shadows.ts';
import {FaunaComposerInstanceBatch} from '../../src/fauna-composer-instance-batch.ts';
import {buildComposerSource} from '../../src/fauna-composer-source.ts';
import {composerPreset} from '../../src/fauna-composer-recipe.ts';
test('shadow policy preserves close shadows, fades monotonically and reaches zero at the far boundary',()=>{
 assert.equal(composerShadowStrength(0),1);assert.equal(composerShadowStrength(35),1);assert.equal(composerShadowStrength(140),0);assert.equal(composerShadowStrength(1000),0);
 let prior=1;for(let d=35;d<=140;d++){const strength=composerShadowStrength(d);assert(strength<=prior);assert(strength>=0);prior=strength;}assert.throws(()=>composerShadowStrength(NaN));
});
test('instance shadow strength encoding retains the exact original palette row for colour rendering and skips empty shadow draws',()=>{
 const source=buildComposerSource(composerPreset('worm')),texture=new THREE.DataTexture(new Float32Array(16*16),64,1),batch=new FaunaComposerInstanceBatch(source.skin,{value:texture},3);
 try{batch.beginFrame();batch.submit(new THREE.Matrix4(),0,1);batch.submit(new THREE.Matrix4(),0,.5);batch.submit(new THREE.Matrix4(),0,0);batch.endFrame();
  assert(batch.mesh.castShadow);const attr=batch.mesh.geometry.getAttribute('composerActor');assert.equal(attr.getX(0),0);assert.equal(Math.floor(attr.getX(1)),0);assert.equal(Math.floor(attr.getX(2)),0);
  batch.beginFrame();batch.submit(new THREE.Matrix4(),0,0);batch.endFrame();assert.equal(batch.mesh.castShadow,false);
  batch.beginFrame();batch.submit(new THREE.Matrix4(),0,1);batch.endFrame();assert(batch.mesh.castShadow);
 }finally{batch.dispose();texture.dispose();}
});
test('both depth and point-shadow programs receive the fading fragment test',()=>{
 for(const name of ['depth','distanceRGBA']){const shader={vertexShader:THREE.ShaderLib[name].vertexShader,fragmentShader:THREE.ShaderLib[name].fragmentShader};patchComposerShadowFade(shader,'1.0');assert.match(shader.vertexShader,/vComposerShadowStrength=clamp/);assert.match(shader.fragmentShader,/if\(vComposerShadowStrength<composerDither\)discard/);}
});
