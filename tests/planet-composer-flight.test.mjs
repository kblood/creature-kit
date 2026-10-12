import test from 'node:test';
import assert from 'node:assert/strict';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {composerPreset} from '../src/fauna-composer-recipe.ts';
import {poseComposer} from '../src/fauna-composer-rig.ts';
import {posePlanetComposer} from '../src/planet-composer-pose.ts';

test('planet winged animals use airborne rig at unbounded dated clocks, all original bones and no planted feet', () => {
  const animal = createComposerCreature(composerPreset('bird'));
  const member = {id:'flying-bird',anchorOffsetX:0,anchorOffsetZ:0,orbitRadiusM:6,orbitAngularSpeed:.2,orbitPhase:0,gaitPeriodS:1};
  const activity = {pose:{x:6,z:0,yaw:Math.PI/2,gait:'walk'},travel:0,revolutionS:Math.PI*10,stateS:1};
  const ground = ()=>2;
  try {
    const first = posePlanetComposer(animal.graph,member,activity,ground,12345.2);
    const canonical = poseComposer(animal.graph,'fly',12345.2,{environment:{clock:12345.2,rootHeight:0}});
    assert.deepEqual(first.positions,canonical.positions);
    assert.deepEqual(first.quaternions,canonical.quaternions);
    assert.equal(first.contacts.length,0);
    assert.equal(first.positions.length,animal.graph.bones.length*3);
    assert.deepEqual(first.planet.root,[6,ground(6,0),0]);
    const second=posePlanetComposer(animal.graph,member,activity,ground,12345.4);
    assert.notDeepEqual(second.quaternions,first.quaternions);
    posePlanetComposer(animal.graph,member,activity,ground,900000);
    assert.deepEqual(posePlanetComposer(animal.graph,member,activity,ground,12345.2),first);
  } finally {animal.dispose();}
});

test('spread wings clear a steep hillside on both forward and sideways headings', () => {
  const animal=createComposerCreature(composerPreset('bird'));
  const member={id:'hillside-bird',anchorOffsetX:0,anchorOffsetZ:0,orbitRadiusM:6,orbitAngularSpeed:.2,orbitPhase:0,gaitPeriodS:1};
  const ground=(x,z)=>2*z+.5*x;
  try {
    for(const yaw of [0,Math.PI/2,Math.PI]) for(let k=0;k<24;k++){
      const activity={pose:{x:0,z:0,yaw,gait:'walk'},travel:0,revolutionS:Math.PI*10,stateS:1};
      const pose=posePlanetComposer(animal.graph,member,activity,ground,100+k/24);
      for(const limb of animal.graph.limbs.filter(l=>l.kind==='wing')) for(const bi of limb.bones){
        const [x,y,z]=pose.positions.slice(bi*3,bi*3+3),c=Math.cos(yaw),s=Math.sin(yaw);
        assert.ok(y-ground(c*x+s*z,s*x-c*z)>0,`wing ${bi} phase ${k} yaw ${yaw}`);
      }
    }
  } finally {animal.dispose();}
});
