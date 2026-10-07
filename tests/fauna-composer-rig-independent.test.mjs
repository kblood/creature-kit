import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { buildComposerGraph, poseComposer, COMPOSER_MOTIONS, COMPOSER_BUDGET } from '../src/fauna-composer-rig.ts';
import { COMPOSER_PRESETS, COMPOSER_LAYOUTS, normalizeComposerRecipe, randomComposerRecipe } from '../src/fauna-composer-recipe.ts';
import { createComposerCreature } from '../src/fauna-composer.ts';
import { deriveComposerIndividual } from '../src/fauna-composer-individual.ts';

// Independent checks use returned joint transforms and authored section shapes,
// never pose.diagnostics as the acceptance measurement. Geometry/surface QA is
// a separate suite: this file cannot certify rendered shells or skin topology.
const cases = Object.entries(COMPOSER_PRESETS).map(([id, recipe]) => ({ id, recipe }));
for (let i = 0; i < 12; i++) cases.push({ id: `mixed-${i}`, recipe: randomComposerRecipe(`independent-rig-${i}`) });
for (const layout of COMPOSER_LAYOUTS) for (const long of [false, true]) {
  cases.push({ id: `${layout}-${long ? 'long' : 'short'}-boundary`, recipe: normalizeComposerRecipe({
    ...COMPOSER_PRESETS.dinosaur, layout, legPairs: long ? 12 : 3,
    bodyLength: long ? 6 : .2, girth: 1.6, legLength: long ? 1.8 : .1,
    // v3 (fauna-composer-face-1): a trunk grows only from the Proboscis face, so the worst case chooses that face
    // (the WP1 shim rigs it exactly like legacy muzzle + trunk) and keeps its graph-1 bone counts
    posture: 1, neckLength: 1.5, arms: 'grasping', wings: 'membrane', head: 'proboscis', trunk: 'trunk',
  }).recipe });
}
// Individuals (graph-2): every preset at seeds 0, 1, 7 and 42, plus a juvenile (maturity 0.3), built from the effective
// recipe exactly as createComposerCreature builds them. The raw presets (above) are built without derivation.
for (const [id, recipe] of Object.entries(COMPOSER_PRESETS)) {
  for (const seed of [0, 1, 7, 42]) cases.push({ id: `${id}-seed-${seed}`, recipe: deriveComposerIndividual({...recipe, individualSeed: seed}).recipe });
  cases.push({ id: `${id}-juvenile`, recipe: deriveComposerIndividual({...recipe, individualSeed: 7, maturity: 0.3}).recipe });
}
const graphs = cases.map(c => ({ ...c, graph: buildComposerGraph(c.recipe) }));
// Bone counts of the fixed cases at graph-1 (b8c00bf .. 0a6fd24): graph-2 adds no bones. The worst case is the 12-pair
// many-legged boundary with arms, wings, trunk and a full neck (142).
// Face round (fauna-composer-face-1) repins: mixed-0 (42 -> 36), mixed-1 (40 -> 34) and mixed-2 (38 -> 32) draw a trunk on
// a non-muzzle face; the face rules drop that trunk and its 6 trunk bones. No other count changes.
const HEAD_BONE_COUNTS = Object.fromEntries(cases.slice(0, 34).map((c, i) => [c.id, [31,21,32,24,27,24,20,15,79,26,63,40,36,34,32,41,19,45,73,21,26,40,38,31,42,42,46,46,54,54,54,54,61,142][i]]));
const vec = a => new THREE.Vector3(...a);
const pos = (p, i) => new THREE.Vector3().fromArray(p.positions, i * 3);
const quat = (p, i) => new THREE.Quaternion().fromArray(p.quaternions, i * 4);
const local = (p, i, v) => vec(v).applyQuaternion(quat(p, i)).add(pos(p, i));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? Array.from(v) : v)).digest('hex');
const report = { version: 1, cases: graphs.map(({id, recipe}) => ({ id, recipe })), measurements: {}, limitations: 'Graph joints and authored elliptical sections only; rendered surface geometry and visual acceptance require separate audits.' };
const output = path.resolve('test-results/fauna-opus-modular-001/rig-independent.json');
after(() => {
  report.sources = Object.fromEntries(['src/fauna-composer-rig.ts', 'src/fauna-composer-recipe.ts', 'src/fauna-composer.ts', 'src/fauna-composer-mesh.ts', 'tests/fauna-composer-rig-independent.test.mjs'].map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
  fs.mkdirSync(path.dirname(output), {recursive:true}); fs.writeFileSync(output, JSON.stringify(report, null, 2));
});
function finish(name, violations, metrics) {
  report.measurements[name] = { ...metrics, violationCount: violations.length, violations };
  assert.equal(violations.length, 0, `${name}: ${violations.length} violations; first ${JSON.stringify(violations.slice(0, 4))}; report ${output}`);
}

test('independent graph has real variable support counts and valid parent chains', () => {
  const failures = [];
  for (const {id,graph:g} of graphs) {
    const fail = (reason, detail) => failures.push({id,reason,detail});
    const expected = g.recipe.layout === 'limbless' ? 0 : g.recipe.layout === 'biped' ? 2 : g.recipe.layout === 'many-legged' ? 2*g.recipe.legPairs : 4;
    if (g.limbs.filter(l=>l.kind==='leg').length !== expected) fail('support count', expected);
    if (g.bones.length > COMPOSER_BUDGET.maxBones) fail('bone budget',g.bones.length);
    if (HEAD_BONE_COUNTS[id] !== undefined && g.bones.length !== HEAD_BONE_COUNTS[id]) fail('bone count changed from graph-1', `${g.bones.length} vs ${HEAD_BONE_COUNTS[id]}`);
    if (new Set(g.bones.map(b=>b.name)).size !== g.bones.length) fail('duplicate bone names');
    for (const b of g.bones) {
      if (!(b.parent >= -1 && b.parent < b.index)) fail('invalid parent', b.name);
      if (!(b.length > 0 && Number.isFinite(b.length))) fail('nonpositive length', b.name);
      if (![...b.restPosition,...b.restQuaternion,...b.offset,...b.restLocal].every(Number.isFinite)) fail('nonfinite bind',b.name);
      if (b.parent >= 0) {
        const parent = g.bones[b.parent];
        const expectedP = vec(b.offset).applyQuaternion(new THREE.Quaternion(...parent.restQuaternion)).add(vec(parent.restPosition));
        if (expectedP.distanceTo(vec(b.restPosition))>1e-8) fail('bind local translation mismatch',b.name);
      }
    }
  }
  finish('graph',failures,{caseCount:graphs.length});
});

test('independent seek and reset reproduce exact poses with documented time bounds', () => {
  const failures=[];
  for (const {id,graph:g} of graphs) {
    const snapshot=digest(g);
    for (const motion of COMPOSER_MOTIONS) for(const time of [-3,0,.371,7.82,1e12]) {
      const a=digest(poseComposer(g,motion,time));
      poseComposer(g,'display',91); poseComposer(g,'walk',33); poseComposer(g,'neutral',0);
      if(a!==digest(poseComposer(g,motion,time))) failures.push({id,motion,time,reason:'seek depends on history'});
      const bounded=Math.max(0,Math.min(120,time));
      if(a!==digest(poseComposer(g,motion,bounded))) failures.push({id,motion,time,reason:'documented 0..120 clamp mismatch'});
    }
    if(snapshot!==digest(g)) failures.push({id,reason:'pose mutated graph'});
  }
  finish('seek',failures,{caseCount:graphs.length});
});

test('independent posed joints preserve chain lengths and socket attachment', () => {
  const failures=[]; let maxLengthError=0,maxSocketError=0,frames=0;
  for(const {id,graph:g} of graphs) for(const motion of COMPOSER_MOTIONS) for(let k=0;k<=48;k++) {
    const time=g.locomotion.period*k/24,p=poseComposer(g,motion,time); frames++;
    if(![...p.positions,...p.quaternions,...p.radialScale].every(Number.isFinite)) failures.push({id,motion,time,reason:'nonfinite pose'});
    for(const b of g.bones) if(Math.abs(quat(p,b.index).length()-1)>1e-9) failures.push({id,motion,time,reason:'unnormalized frame',bone:b.name});
    for(const l of g.limbs) {
      const socket=local(p,l.socketBone,l.socket),error=socket.distanceTo(pos(p,l.bones[0])); maxSocketError=Math.max(maxSocketError,error);
      if(error>1e-8) failures.push({id,motion,time,reason:'root detached',limb:l.index,error});
      for(let j=0;j+1<l.bones.length;j++) {
        const error=Math.abs(pos(p,l.bones[j]).distanceTo(pos(p,l.bones[j+1]))-l.segments[j]); maxLengthError=Math.max(maxLengthError,error);
        if(error>1e-8) failures.push({id,motion,time,reason:'limb stretched',limb:l.index,segment:j,error});
        const end=local(p,l.bones[j],[g.bones[l.bones[j]].length,0,0]);
        if(end.distanceTo(pos(p,l.bones[j+1]))>1e-8) failures.push({id,motion,time,reason:'frame endpoint misses next joint',limb:l.index,segment:j});
      }
    }
    for(const chain of [g.chains.torso,g.chains.tail,g.chains.neck,g.chains.trunk]) for(let j=0;j+1<chain.length;j++) {
      const b=g.bones[chain[j]],error=local(p,b.index,[b.length,0,0]).distanceTo(pos(p,chain[j+1])); maxLengthError=Math.max(maxLengthError,error);
      if(error>1e-8) failures.push({id,motion,time,reason:'axial chain detached',bone:b.name,error});
    }
  }
  finish('joints',failures,{frames,maxLengthError,maxSocketError});
});

test('independent foot support stays grounded and stance positions do not slide', () => {
  const failures=[]; let maxStanceSlip=0,maxStanceHeight=0,minSwingSole=Infinity,maxStanceExtension=0,frames=0;
  for(const {id,graph:g} of graphs) {
    const legs=g.limbs.filter(l=>l.kind==='leg'); let previous;
    if(legs.length && !(g.locomotion.stride>0 && g.locomotion.speed>0)) failures.push({id,reason:'walking has no forward travel',stride:g.locomotion.stride,speed:g.locomotion.speed});
    for(let k=0;k<=240;k++) {
      const time=g.locomotion.period*k/120,p=poseComposer(g,'walk',time);frames++;
      if(p.contacts.length!==legs.length) failures.push({id,time,reason:'support count does not match actual legs'});
      const actual=[];
      for(const l of legs) {
        const contact=p.contacts.find(c=>c.limb===l.index),bi=l.bones.at(-1);
        // Sole point is part of the rotating foot frame, not world-down ankle offset.
        const sole=local(p,bi,[0,-l.footHeight,0]);
        const world=sole.clone().add(new THREE.Vector3(p.travel,0,0));
        actual.push({limb:l.index,stance:contact.stance,world});
        if(contact.stance) {
          maxStanceHeight=Math.max(maxStanceHeight,Math.abs(sole.y));
          if(Math.abs(sole.y)>1e-6) failures.push({id,time,limb:l.index,reason:'stance sole off ground',height:sole.y,reach:contact.reachError});
          // socket to hock (three-segment legs) or ankle (two-segment legs): bones[2] starts there in both
          const extension=pos(p,l.bones[0]).distanceTo(pos(p,l.bones[2]))/(l.segments[0]+l.segments[1]); maxStanceExtension=Math.max(maxStanceExtension,extension);
          if(extension>0.985+1e-9) failures.push({id,time,limb:l.index,reason:'stance leg overextended',extension});
          const before=previous?.find(c=>c.limb===l.index);
          if(before?.stance) {const slip=before.world.distanceTo(world); maxStanceSlip=Math.max(maxStanceSlip,slip); if(slip>1e-6) failures.push({id,time,limb:l.index,reason:'stance slides',slip});}
        } else {minSwingSole=Math.min(minSwingSole,sole.y);if(sole.y < -1e-6) failures.push({id,time,limb:l.index,reason:'swing sole penetrates',height:sole.y});}
      }
      previous=actual;
    }
  }
  finish('contacts',failures,{frames,maxStanceSlip,maxStanceHeight,minSwingSole,maxStanceExtension});
});

test('independent torso section support clears floor, with real belly support for limbless bodies', () => {
  const failures=[];let minClearance=Infinity,maxLimblessGap=0;
  for(const {id,graph:g} of graphs) for(const motion of COMPOSER_MOTIONS) for(let k=0;k<=48;k++) {
    const time=g.locomotion.period*k/24,p=poseComposer(g,motion,time);let support=Infinity;
    for(const bi of g.chains.torso) for(const atEnd of [false,true]) {
      const b=g.bones[bi],s=atEnd?b.end:b.start,q=quat(p,bi),scale=p.radialScale[bi];
      const centre=local(p,bi,[atEnd?b.length:0,s.yc,0]);
      const yAxis=new THREE.Vector3(0,1,0).applyQuaternion(q),zAxis=new THREE.Vector3(0,0,1).applyQuaternion(q);
      // Exact support of the transformed ellipse, not unrotated p.y - radius.
      const low=centre.y-Math.hypot(s.h*scale*yAxis.y,s.w*scale*zAxis.y);minClearance=Math.min(minClearance,low);support=Math.min(support,low);
      if(low < -1e-6) failures.push({id,motion,time,bone:b.name,atEnd,reason:'torso support penetrates floor',clearance:low});
    }
    if(g.recipe.layout==='limbless') {maxLimblessGap=Math.max(maxLimblessGap,support); if(support>1e-3) failures.push({id,motion,time,reason:'limbless body has no floor support',support});}
  }
  finish('body-support',failures,{minClearance,maxLimblessGap});
});

test('actual skinned surface vertices stay above the floor through preset and individual poses', () => {
  const failures=[];let minY=Infinity,frames=0;const perPreset=[];
  // presets, then individuals: createComposerCreature derives the individual from the species recipe itself
  const skinCases=[...Object.entries(COMPOSER_PRESETS)];
  for(const [id,recipe] of Object.entries(COMPOSER_PRESETS)) { for(const seed of [1,42]) skinCases.push([`${id}-seed-${seed}`,{...recipe,individualSeed:seed}]); skinCases.push([`${id}-juvenile`,{...recipe,individualSeed:7,maturity:.3}]); }
  for(const [id,recipe] of skinCases) {
    const c=createComposerCreature(recipe);
    try {
      const parts=c.skin.parts.map(part=>{
        const ids=new Set();for(let t=part.firstTriangle;t<part.firstTriangle+part.triangles;t++)for(let j=0;j<3;j++)ids.add(c.skin.index[t*3+j]);
        return {...part,ids:[...ids]};
      });
      const v=new THREE.Vector3(),ys=new Float64Array(c.skin.vertexCount);let presetMin=Infinity,worst;
      for(const motion of COMPOSER_MOTIONS)for(let k=0;k<=8;k++) {
        const time=c.graph.locomotion.period*k/8;c.update(motion,time);c.group.updateMatrixWorld(true);c.mesh.skeleton.update();frames++;
        for(let i=0;i<ys.length;i++){c.mesh.getVertexPosition(i,v);ys[i]=v.y;}
        for(const p of parts) {
          let low=Infinity,index=-1;for(const i of p.ids)if(ys[i]<low){low=ys[i];index=i;}
          minY=Math.min(minY,low);
          if(low<presetMin){presetMin=low;worst={motion,time,part:p.part,label:p.label,index};}
          if(low < -1e-6)failures.push({id,motion,time,part:p.part,label:p.label,index,minY:low});
        }
      }
      perPreset.push({id,minY:presetMin,worst});
    } finally {c.dispose();}
  }
  finish('actual-skin-floor',failures,{frames,minY,perPreset});
});
