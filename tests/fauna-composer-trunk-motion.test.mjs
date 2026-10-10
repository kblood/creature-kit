import test from 'node:test';
import assert from 'node:assert/strict';
import {composerPreset,COMPOSER_PRESET_IDS} from '../src/fauna-composer-recipe.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {poseComposer,COMPOSER_TRUNK_MOTION_VERSION} from '../src/fauna-composer-rig.ts';
import {composerClipWindow,bakeComposerClip,bakeComposerLoopClip,composerPoseDistance,exportCreatureGlb} from '../src/fauna-composer-export.ts';
import {measureComposerTrunkMotion} from './tools/measure-composer-trunk-motion.mjs';

test('trunk wave is optional: neutral and no-trunk poses remain exact, as do legacy defaults', () => {
 for(const id of COMPOSER_PRESET_IDS){const a=createComposerCreature(composerPreset(id),{presentation:'realism-1'});try{
  for(const motion of ['neutral','idle','walk','display'])for(const time of [0,.31,1.37]){
   const old=poseComposer(a.graph,motion,time),explicit=poseComposer(a.graph,motion,time,{trunkMotion:'legacy'}),wave=poseComposer(a.graph,motion,time,{trunkMotion:'wave-1'});
   assert.deepEqual(old,explicit);assert.deepEqual(a.update(motion,time),old,'realism-1 does not silently enable this experiment');
   if(motion==='neutral'||!a.graph.chains.trunk.length)assert.deepEqual(wave,old,id);
   for(const bone of a.graph.bones)if(bone.part!=='trunk'){
    assert.deepEqual(wave.positions.slice(bone.index*3,bone.index*3+3),old.positions.slice(bone.index*3,bone.index*3+3));
    assert.deepEqual(wave.quaternions.slice(bone.index*4,bone.index*4+4),old.quaternions.slice(bone.index*4,bone.index*4+4));
   }
  }
 }finally{a.dispose();}}
});

test('measured nose-base motion and join deformation improve; missed amplitude goals remain documented', t => {
 const report=measureComposerTrunkMotion();
 for(const p of report.paired){
  assert.ok(p.rootRatio<=.3,`${p.id}/${p.motion}: calm root`);
  assert.equal(p.flips[1],0,`${p.id}/${p.motion}: no join-face inversions at sampled frames`);
  assert.ok(p.ground[1]>0,`${p.id}/${p.motion}: actual trunk mesh clears floor`);
  assert.ok(p.maxLift[1]<=p.maxLift[0]+1e-6,`${p.id}/${p.motion}: maximum clearance correction`);
  assert.ok(p.edgeStretch[1]<=p.edgeStretch[0],`${p.id}/${p.motion}: no worse join stretch`);
 }
 // This experiment is intentionally not the default: it misses the preferred
 // 85–115% excursion band and non-increasing lift count on part of the corpus.
 assert.ok(report.paired.some(p=>p.tipRmsRatio<.85));
 assert.ok(report.paired.some(p=>p.liftEvents[1]>p.liftEvents[0]));
 t.diagnostic(JSON.stringify(report.paired));
});

test('clip search and baking use the selected motion, and seamless loop endpoints still match', t => {
 const a=createComposerCreature(composerPreset('trunked-centipede'),{presentation:'realism-1',trunkMotion:'wave-1'}),g=a.graph,options={trunkMotion:'wave-1'},rows=[];
 try{
  assert.equal(a.mesh.geometry.userData.composer.trunkMotion,COMPOSER_TRUNK_MOTION_VERSION);
  for(const motion of ['idle','walk','display']){
   const oldWindow=composerClipWindow(g,motion,12),window=composerClipWindow(g,motion,12,undefined,options),baked=bakeComposerClip(g,motion,window,options);
   const measured=composerPoseDistance(poseComposer(g,motion,0,options),poseComposer(g,motion,window.duration,options));
   assert.equal(window.seamPosition,measured.position);assert.equal(window.seamAngle,measured.angle);
   for(const key of [0,Math.floor((window.keys-1)/2),window.keys-1]){
    const time=window.duration*key/(window.keys-1),pose=a.update(motion,time);
    for(const bi of g.chains.trunk){
     for(let k=0;k<3;k++)assert.ok(Math.abs(baked.translation[bi][key*3+k]-pose.positions[bi*3+k])<2e-6);
     let dot=0;for(let k=0;k<4;k++)dot+=baked.rotation[bi][key*4+k]*pose.quaternions[bi*4+k];
     const sign=dot<0?-1:1;
     for(let k=0;k<4;k++)assert.ok(Math.abs(sign*baked.rotation[bi][key*4+k]-pose.quaternions[bi*4+k])<2e-6);
    }
   }
   if(motion!=='walk'){
    const loop=bakeComposerLoopClip(g,motion,window,Math.min(1,window.duration/2),options);
    for(const bi of g.chains.trunk){assert.deepEqual(loop.translation[bi].slice(0,3),loop.translation[bi].slice(-3));assert.deepEqual(loop.rotation[bi].slice(0,4),loop.rotation[bi].slice(-4));}
   }
   rows.push({motion,legacyWindow:oldWindow.duration,waveWindow:window.duration,rawSeamPosition:window.seamPosition,rawSeamAngle:window.seamAngle});
  }
 }finally{a.dispose();}
 t.diagnostic(JSON.stringify(rows));
});

test('GLB marks the actual optional trunk motion, while legacy/no-trunk bytes remain unchanged', () => {
 const recipe=composerPreset('trunked-centipede'),options={presentation:'realism-1',clips:[{motion:'walk',duration:1,fps:12}]};
 const old=exportCreatureGlb(recipe,options),explicit=exportCreatureGlb(recipe,{...options,trunkMotion:'legacy'}),wave=exportCreatureGlb(recipe,{...options,trunkMotion:'wave-1'});
 assert.deepEqual(old.glb,explicit.glb);assert.notDeepEqual(old.glb,wave.glb);
 assert.equal(wave.report.versions.trunkMotion,COMPOSER_TRUNK_MOTION_VERSION);assert.equal(old.report.versions.trunkMotion,undefined);
 assert.equal(wave.report.recipeText,old.report.recipeText);assert.equal(wave.report.mesh.triangles,old.report.mesh.triangles);
 const noTrunk=composerPreset('dinosaur');assert.deepEqual(exportCreatureGlb(noTrunk,options).glb,exportCreatureGlb(noTrunk,{...options,trunkMotion:'wave-1'}).glb);
 const neutral={...options,clips:['neutral']};assert.deepEqual(exportCreatureGlb(recipe,neutral).glb,exportCreatureGlb(recipe,{...neutral,trunkMotion:'wave-1'}).glb);
});
