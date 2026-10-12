import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {buildComposerGraph, poseComposer, composerMotionPeriod, COMPOSER_MOTIONS} from '../src/fauna-composer-rig.ts';
import {COMPOSER_PRESETS, normalizeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';

const position = (p, i) => new THREE.Vector3().fromArray(p.positions, i * 3);
const rotation = (p, i) => new THREE.Quaternion().fromArray(p.quaternions, i * 4);
const tip = (g, p, i) => new THREE.Vector3(g.bones[i].length, 0, 0).applyQuaternion(rotation(p, i)).add(position(p, i));
const phaseTime = (g, motion, phase) => ((phase - g.traits.motion.phase + 1) % 1) * composerMotionPeriod(g, motion);
const flightGraphs = [COMPOSER_PRESETS.bird, COMPOSER_PRESETS['winged-ape-rhino'],
  normalizeComposerRecipe({...COMPOSER_PRESETS.worm, wings: 'membrane'}).recipe,
  normalizeComposerRecipe({...COMPOSER_PRESETS['trunked-centipede'], wings: 'feathered'}).recipe].map(r => buildComposerGraph(r));

test('motion library preserves every historical preset pose exactly', () => {
  const digest = createHash('sha256');
  for (const recipe of Object.values(COMPOSER_PRESETS)) for (const motion of ['neutral', 'idle', 'walk', 'display']) for (const time of [0, .37, 1.42, 5.9]) {
    digest.update(JSON.stringify(poseComposer(buildComposerGraph(recipe), motion, time), (_, x) => ArrayBuffer.isView(x) ? Array.from(x) : x));
  }
  assert.equal(digest.digest('hex'), 'daab212c269fab65a2032914d8b675c09fc690031382ee2cfe9de0ac7f4c130d');
  for (const motion of ['run', 'eat', 'fly', 'glide']) assert.ok(COMPOSER_MOTIONS.includes(motion));
});

test('flight beats both wings together, spreads the membrane, and tucks the feet', () => {
  for (const g of flightGraphs) {
    const up = poseComposer(g, 'fly', phaseTime(g, 'fly', .25)), down = poseComposer(g, 'fly', phaseTime(g, 'fly', .75));
    const rest = poseComposer(g, 'neutral', 0), wings = g.limbs.filter(l => l.kind === 'wing');
    for (const p of [up, down]) {
      assert.equal(p.contacts.length, 0);
      assert.ok(p.positions[1] > rest.positions[1] + g.dims.bodyLength * .5);
      const relative = wings.map(l => tip(g, p, l.bones.at(-1)).sub(position(p, l.bones[0])));
      assert.ok(Math.abs(relative[0].y - relative[1].y) < 1e-8, 'left/right wing height is synchronized');
      assert.ok(Math.abs(relative[0].z + relative[1].z) < 1e-8, 'left/right wing sweep is mirrored');
      for (const l of wings) for (const bi of l.bones) assert.ok(p.chordScale[bi] >= .85, 'airfoil remains spread');
      for (const l of g.limbs.filter(l => l.kind === 'leg')) {
        const hang = position(p, l.bones[0]).y - position(p, l.bones.at(-1)).y;
        const restHang = position(rest, l.bones[0]).y - position(rest, l.bones.at(-1)).y;
        assert.ok(hang < restHang * .8, `leg ${l.index} folds toward body`);
      }
    }
    for (const l of wings) {
      const upY = tip(g, up, l.bones.at(-1)).y - position(up, l.bones[0]).y;
      const downY = tip(g, down, l.bones.at(-1)).y - position(down, l.bones[0]).y;
      assert.ok(upY - downY > g.dims.wingSemiSpan * .9, 'wingtip has a full powered stroke');
    }
  }
});

test('airborne poses ignore ground fitting and preserve caller altitude as translation', () => {
  for (const g of flightGraphs) for (const motion of ['fly', 'glide']) {
    const time = .27, base = poseComposer(g, motion, time);
    const raised = poseComposer(g, motion, time, {environment: {
      rootHeight: 7, supportHeight: 'reachable-1',
      ground: () => { throw new Error('airborne ground sample'); },
      contact: () => { throw new Error('airborne contact solve'); },
    }});
    assert.equal(raised.contacts.length, 0);
    assert.equal(raised.diagnostics.supportHeight, undefined);
    for (let i = 0; i < g.bones.length; i++) {
      assert.ok(Math.abs(raised.positions[i * 3 + 1] - base.positions[i * 3 + 1] - 7) < 1e-8);
      assert.ok(rotation(base, i).angleTo(rotation(raised, i)) < 1e-7);
    }
  }
});

test('glide holds the wings out and each flight cycle closes smoothly', () => {
  for (const g of flightGraphs) {
    const wings = g.limbs.filter(l => l.kind === 'wing');
    for (let k = 0; k < 16; k++) {
      const p = poseComposer(g, 'glide', composerMotionPeriod(g, 'glide') * k / 16);
      for (const l of wings) {
        const spread = Math.abs(tip(g, p, l.bones.at(-1)).z - position(p, l.bones[0]).z);
        assert.ok(spread > g.dims.wingSemiSpan * .85);
      }
    }
    for (const motion of ['fly', 'glide']) {
      const a = poseComposer(g, motion, .21), b = poseComposer(g, motion, .21 + composerMotionPeriod(g, motion));
      for (let i = 0; i < g.bones.length; i++) {
        assert.ok(position(a, i).distanceTo(position(b, i)) < 1e-8);
        assert.ok(rotation(a, i).angleTo(rotation(b, i)) < 1e-7);
      }
    }
  }
});

test('run increases travel with planted stance and eat lowers the head without foot travel', () => {
  for (const recipe of [COMPOSER_PRESETS.giraffe, COMPOSER_PRESETS.bird, COMPOSER_PRESETS.ape]) {
    const g = buildComposerGraph(recipe), rest = poseComposer(g, 'neutral', 0);
    assert.ok(poseComposer(g, 'run', 1).travel > poseComposer(g, 'walk', 1).travel * 1.4);
    let previous;
    for (let k = 0; k <= 120; k++) {
      const p = poseComposer(g, 'run', composerMotionPeriod(g, 'run') * k / 120);
      for (const c of p.contacts) {
        assert.ok(c.reachError < 1e-8);
        if (!c.stance) continue;
        assert.ok(Math.abs(c.contact[1]) < 1e-8);
        const before = previous?.contacts.find(x => x.limb === c.limb);
        if (before?.stance) assert.ok(new THREE.Vector3(...before.world).distanceTo(new THREE.Vector3(...c.world)) < 1e-8, 'stance does not slide');
      }
      previous = p;
    }
    for (const time of [0, .5, 1]) {
      const p = poseComposer(g, 'eat', time);
      assert.equal(p.travel, 0);
      assert.ok(tip(g, p, g.chains.head).y < tip(g, rest, g.chains.head).y);
      assert.ok(p.contacts.every(c => c.stance && Math.abs(c.contact[1]) < 1e-8));
    }
  }
});

test('running has whole-body suspension and a hind/front gallop instead of sped-up walking', () => {
  for(const recipe of [COMPOSER_PRESETS.giraffe,COMPOSER_PRESETS.rhinoceros,COMPOSER_PRESETS.bird,COMPOSER_PRESETS.ape]){
    const g=buildComposerGraph(recipe),period=composerMotionPeriod(g,'run');
    let suspension=0,planted=0,maxSoleClearance=0;
    for(let k=0;k<200;k++){
      const p=poseComposer(g,'run',phaseTime(g,'run',k/200));
      if(p.contacts.every(c=>!c.stance)){
        suspension++;
        assert.ok(p.contacts.every(c=>c.contact[1]>=-1e-8),'suspension soles do not penetrate the ground');
        maxSoleClearance=Math.max(maxSoleClearance,Math.min(...p.contacts.map(c=>c.contact[1])));
      }else planted++;
      assert.ok(p.diagnostics.maxReachError<1e-8,'run remains within leg reach');
    }
    assert.ok(suspension>=30&&planted>0,'distinct support and suspension intervals');
    assert.ok(maxSoleClearance>.04*g.dims.legReach,'all soles visibly leave the ground together');
    if(g.recipe.layout==='quadruped'){
      const hind=poseComposer(g,'run',phaseTime(g,'run',.12));
      const front=poseComposer(g,'run',phaseTime(g,'run',.62));
      assert.ok(hind.contacts.filter(c=>c.stance).every(c=>!g.limbs[c.limb].front));
      assert.ok(front.contacts.filter(c=>c.stance).every(c=>g.limbs[c.limb].front));
      const flight=poseComposer(g,'run',phaseTime(g,'run',.37));
      assert.ok(position(flight,g.chains.torso[0]).y>position(hind,g.chains.torso[0]).y+.04*g.dims.legReach);
    }
    const a=poseComposer(g,'run',.21),b=poseComposer(g,'run',.21+period);
    for(let i=0;i<g.bones.length;i++)assert.ok(position(a,i).distanceTo(position(b,i))<1e-8,'run cycle closes');
  }
});

test('new motion poses are deterministic, finite, and keep every limb attached at its original length', () => {
  const recipes = [...Object.values(COMPOSER_PRESETS), ...Array.from({length: 8}, (_, i) => randomComposerRecipe(`new-motion-${i}`))];
  for (const recipe of recipes) {
    const g = buildComposerGraph(recipe);
    for (const motion of ['run', 'eat', 'fly', 'glide']) for (const time of [0, .31, 1.4, 120]) {
      const p = poseComposer(g, motion, time);
      assert.deepEqual(p, poseComposer(g, motion, time));
      assert.ok([...p.positions, ...p.quaternions, ...p.radialScale, ...p.chordScale].every(Number.isFinite));
      for (const l of g.limbs) {
        const socket = new THREE.Vector3(...l.socket).applyQuaternion(rotation(p, l.socketBone)).add(position(p, l.socketBone));
        assert.ok(socket.distanceTo(position(p, l.bones[0])) < 1e-8);
        for (let k = 0; k + 1 < l.bones.length; k++) assert.ok(tip(g, p, l.bones[k]).distanceTo(position(p, l.bones[k + 1])) < 1e-8);
      }
      if (!g.limbs.some(l => l.kind === 'wing') && (motion === 'fly' || motion === 'glide')) {
        assert.equal(p.travel, 0);
        assert.deepEqual(p.positions, poseComposer(g, 'idle', time).positions, 'wingless animals stay grounded');
      }
    }
  }
});
