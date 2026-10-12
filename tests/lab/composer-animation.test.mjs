import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildComposerSource} from '../../src/fauna-composer-source.ts';
import {composerPreset} from '../../src/fauna-composer-recipe.ts';
import {poseComposer} from '../../src/fauna-composer-rig.ts';
import {ComposerTemporalPose,composerActiveBones} from '../../src/fauna-composer-animation.ts';
import {FaunaComposerPaletteWriter} from '../../src/fauna-composer-palette.ts';
import {buildFaunaComposerLevels} from '../../src/fauna-composer-render-source.ts';

test('temporal presentation preserves the initial exact pose and interpolates positions and normalized rotations without mutating source samples',()=>{
 const source=buildComposerSource(composerPreset('dinosaur'),{presentation:'realism-1'}),a=poseComposer(source.graph,'walk',.3),b=poseComposer(source.graph,'walk',.4);
 const beforeA=structuredClone(a),beforeB=structuredClone(b),state=new ComposerTemporalPose(a,.3,'ground1/walk',.1);
 assert.deepEqual(state.interpolate(.3).positions,a.positions);assert.deepEqual(state.interpolate(.3).quaternions,a.quaternions);
 state.accept(b,.4,'ground1/walk',.1);const out=state.interpolate(.45);
 for(let i=0;i<a.positions.length;i++)assert(Math.abs(out.positions[i]-(Math.fround(a.positions[i])+Math.fround(b.positions[i]))/2)<1e-6);
 for(let i=0;i<source.graph.bones.length;i++){
  const expected=new THREE.Quaternion().fromArray(a.quaternions,i*4).normalize().slerp(new THREE.Quaternion().fromArray(b.quaternions,i*4).normalize(),.5);
  assert(expected.angleTo(new THREE.Quaternion().fromArray(out.quaternions,i*4))<1e-6);
 }
 assert.deepEqual(a,beforeA);assert.deepEqual(b,beforeB);assert.equal(state.metadata().contactsAndDiagnostics,'latest canonical sample');
});
test('ground/activity changes, backward seeks, large jumps and tier interval changes discard earlier samples immediately',()=>{
 const graph=buildComposerSource(composerPreset('worm')).graph,a=poseComposer(graph,'walk',1),state=new ComposerTemporalPose(a,1,'ground1',.1);
 for(const [clock,context,interval] of [[1.02,'ground2',.1],[.9,'ground2',.1],[5,'ground2',.1],[5.01,'ground2',.05]]){
  const pose=poseComposer(graph,'walk',clock);assert(state.needsSample(clock,context,interval));state.accept(pose,clock,context,interval);assert.deepEqual(state.interpolate(clock).positions,pose.positions);
 }
 assert.equal(state.metadata().resets,4);assert.throws(()=>state.interpolate(NaN));
});
test('far affine writer reproduces the reference matrices for every surviving vertex without changing the rig',()=>{
 const cases=[];
 for(const preset of ['dinosaur','turtle','bird','centipede','giraffe']){
  const source=buildComposerSource(composerPreset(preset),{presentation:'realism-1'}),level=buildFaunaComposerLevels(source,[4500,1000]).far,mask=composerActiveBones(level,source.graph.bones.length);
  const pose=poseComposer(source.graph,'walk',.731),writer=new FaunaComposerPaletteWriter(source.graph),full=new Float32Array(source.graph.bones.length*16),reduced=new Float32Array(full.length).fill(NaN);
  writer.write(pose,full);writer.write(pose,reduced,0,mask,true);
  for(let i=0;i<level.skinWeight.length;i++)if(level.skinWeight[i]>0){const bone=level.skinIndex[i];assert.deepEqual(reduced.slice(bone*16,(bone+1)*16),full.slice(bone*16,(bone+1)*16));}
  cases.push({preset,full:source.graph.bones.length,active:mask.length});
 }
 assert.equal(cases.length,5);
});
