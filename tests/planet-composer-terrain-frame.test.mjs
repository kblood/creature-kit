import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {buildPlanetComposerSource} from '../src/planet-composer.ts';
import {poseComposer} from '../src/fauna-composer-rig.ts';
import {PLANET_COMPOSER_POSE_VERSION} from '../src/planet-composer-pose.ts';
import {fixture,terrainRegression} from './helpers/planet-composer-terrain-regression.mjs';

test('terrain frame rotates the local root and axial motion before external ground height',()=>{
 const {graph}=buildPlanetComposerSource(fixture.definition),rotation=new T.Quaternion().setFromEuler(new T.Euler(.11,.07,-.13)),height=4.7;
 for(const motion of ['neutral','idle','walk']){
  const original=poseComposer(graph,motion,.173),transformed=poseComposer(graph,motion,.173,{environment:{rootRotation:rotation.toArray(),rootHeight:height,ground:()=>0}});
  for(const b of graph.bones.filter(b=>b.part==='torso')){
   const expected=new T.Vector3().fromArray(original.positions,b.index*3).applyQuaternion(rotation).add(new T.Vector3(0,height,0)),actual=new T.Vector3().fromArray(transformed.positions,b.index*3);
   assert.ok(expected.distanceTo(actual)<1e-12,`${motion}/${b.name}: terrain root must transform as a point`);
   const q=new T.Quaternion().fromArray(original.quaternions,b.index*4).premultiply(rotation),r=new T.Quaternion().fromArray(transformed.quaternions,b.index*4);assert.ok(1-Math.abs(q.dot(r))<1e-12);
  }
 }
 assert.equal(PLANET_COMPOSER_POSE_VERSION,'planet-composer-pose-3');
});

test('captured Daunune hoof2R stays planted across its actual idle/walk clock, source and far tiers',t=>{
 const report=terrainRegression();
 assert.deepEqual(report.before,fixture.sourceDigests,'pose correction cannot change the original graph or any raw skin/coat arrays');assert.deepEqual(report.after,report.before);
 assert.equal(report.far.reached,true);assert.ok(report.far.triangles<=1000);
 assert.ok(fixture.provenance.before.sourceAndActualGpuGapM>.013,'preserve the failed actual GPU measurement');
 for(const row of report.rows){
  assert.ok(row.maxReachError<1e-6,`${row.terrain}: reachable fixed footholds`);
  assert.ok(row.maxBoundaryJump<=.001,`${row.terrain}: full source deformed vertex continuity ${row.maxBoundaryJump}`);
  for(const variant of row.variants){
   assert.ok(variant.stance>0&&variant.swing>0);assert.ok(variant.driftPairs>0);
   assert.ok(variant.maxStanceGap<=.003,`${row.terrain}/${variant.name}: planted mesh gap ${variant.maxStanceGap}`);
   assert.ok(variant.maxPenetration<=.001,`${row.terrain}/${variant.name}: mesh penetration ${variant.maxPenetration}`);
   assert.ok(variant.maxStanceDrift<=.001,`${row.terrain}/${variant.name}: rigid sole drift ${variant.maxStanceDrift}`);
  }
 }
 t.diagnostic(JSON.stringify(report));
});
