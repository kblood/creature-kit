import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCreatureGenome,realisticIndividualCreatureGenome} from '../src/planet-v1/creature-model.ts';
import {createQuadrupedPlan} from '../src/planet-v1/fauna-body-plan.ts';
import {quadrupedPoseAt,createQuadrupedPoseWorkspace,quadrupedPoseAtInto} from '../src/planet-v1/fauna-locomotion.ts';
const memberFor=id=>({id,anchorOffsetX:.3,anchorOffsetZ:-.7,orbitRadiusM:5,orbitAngularSpeed:.12,orbitPhase:.2,gaitPeriodS:12});
const activity=(travel,stateS,gait='walk',revolutionS=52)=>({pose:{x:1,z:2,yaw:.5,gait},travel,revolutionS,stateS});
const clone=x=>structuredClone(x);
const grounds=[()=>0,(x,z)=>.02*x-.03*z,(x,z)=>.04*Math.sin(x*.7)+.06*Math.cos(z*.4),(x,z)=>.15*x+.08*z];
const cases=[
 [-2.31,0,'walk',52,-.25,'alert'],[-.02,.01,'walk',52,0,'auto'],[0,.2,'walk',52,17.25,'feed'],
 [.18,3.7,'idle',52,17.25,'feed'],[.51,9,'idle',52,1e7,'alert'],[3.25,.01,'idle',52,37,'auto'],
 [.18,0,'idle',Infinity,17.25,'feed'],[.51,.7,'walk',52,17.25,'auto'],[.18,1.2,'idle',52,23,'auto'],
];
test('workspace is numerically exact with identical stencil calls across terrain, activity and reversed seeks',()=>{
 for(const [archetype,family] of [['browser','ungulate'],['runner','cursorial'],['low-slung','padded'],['long-neck','long-neck']])for(const stage of ['adult','juvenile']){
  const id=`workspace/${archetype}/${stage}`,g=realisticIndividualCreatureGenome(generateCreatureGenome(id,archetype),id,1,stage,family),plan=createQuadrupedPlan(g),member=memberFor(id),workspace=createQuadrupedPoseWorkspace(plan,member);
  const before=clone(plan);assert.equal(workspace.resources.outputTypedBytes,1760);assert.equal(workspace.resources.vector3Objects,66);assert.equal(workspace.resources.quaternionObjects,44);
  for(const ground of grounds){
   const expected=cases.map(([travel,stateS,gait,revolutionS,seconds,behaviour])=>{
    const calls=[],pose=quadrupedPoseAt(plan,member,activity(travel,stateS,gait,revolutionS),(x,z)=>{calls.push([x,z]);return ground(x,z);},seconds,{behaviour});return{pose,calls};
   });
   for(const i of [...cases.keys(),...[...cases.keys()].reverse(),0,4,1]){
    const [travel,stateS,gait,revolutionS,seconds,behaviour]=cases[i],calls=[];
    const pose=quadrupedPoseAtInto(workspace,activity(travel,stateS,gait,revolutionS),(x,z)=>{calls.push([x,z]);return ground(x,z);},seconds,{behaviour});
    assert.deepEqual(pose,expected[i].pose,`${id}/${i}`);assert.deepEqual(calls,expected[i].calls,`${id}/${i}/stencil calls`);
   }
  }
  assert.deepEqual(plan,before);
 }
});
test('borrowed output reuses records while default outputs remain independent and workspaces reject forged identity',()=>{
 const plan=createQuadrupedPlan(generateCreatureGenome('workspace/lifetime','browser')),member=memberFor('workspace/lifetime'),w=createQuadrupedPoseWorkspace(plan,member),a=activity(.18,3.7,'idle');
 const first=quadrupedPoseAtInto(w,a,grounds[1],17.25,{behaviour:'feed'}),snapshot=clone(first),positions=first.positions,foot=first.feet[0],contact=foot.contact,root=first.root;
 const ordinary=quadrupedPoseAt(plan,member,a,grounds[1],17.25,{behaviour:'feed'}),ordinarySnapshot=clone(ordinary);
 const later=quadrupedPoseAtInto(w,activity(.51,.01),grounds[3],27,{behaviour:'alert'});
 assert.equal(later,first);assert.equal(later.positions,positions);assert.equal(later.feet[0],foot);assert.equal(later.feet[0].contact,contact);assert.equal(later.root,root);assert.notDeepEqual(later,snapshot);assert.deepEqual(ordinary,ordinarySnapshot);assert.notEqual(ordinary.positions,later.positions);
 assert.throws(()=>quadrupedPoseAtInto({...w},a,grounds[0],0),/factory-created/);member.id='changed';assert.throws(()=>quadrupedPoseAtInto(w,a,grounds[0],0),/immutable member identity/);
});
