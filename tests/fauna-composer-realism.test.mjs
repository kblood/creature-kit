import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {composerPreset, COMPOSER_PRESET_IDS, encodeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {buildComposerSkin, COMPOSER_SKIN_VERSION, COMPOSER_REALISM_SKIN_VERSION} from '../src/fauna-composer-mesh.ts';
import {buildComposerLodChain, composerFootLodConstraints} from '../src/fauna-composer-lod.ts';
import {exportCreatureGlb, ComposerExportBudgetError} from '../src/fauna-composer-export.ts';

const digest = skin => { const hash = createHash('sha256'); for (const key of ['positions','normals','colors','index','skinIndex','skinWeight','regions','gloss']) hash.update(new Uint8Array(skin[key].buffer)); return hash.digest('hex'); };
const changed = recipe => ['pad','hoof','claw'].includes(recipe.feet) && recipe.layout !== 'limbless';
const vertices = (skin, part) => [...new Set(skin.index.slice(part.firstTriangle * 3, (part.firstTriangle + part.triangles) * 3))];
const signature = (s,v) => [...s.positions.slice(v*3,v*3+3),...s.skinIndex.slice(v*4,v*4+4),...s.skinWeight.slice(v*4,v*4+4)].join(',');

test('skin6 is an explicit presentation: same recipe, individual, graph and pose; skin5 remains exact', () => {
  assert.equal(COMPOSER_SKIN_VERSION, 'fauna-composer-skin-5');
  assert.equal(COMPOSER_REALISM_SKIN_VERSION, 'fauna-composer-skin-6');
  for (const id of COMPOSER_PRESET_IDS) {
    const recipe = composerPreset(id), before = structuredClone(recipe), text = encodeComposerRecipe(recipe);
    const old = createComposerCreature(recipe), current = createComposerCreature(recipe,{presentation:'realism-1'});
    try {
      assert.deepEqual(recipe,before,id); assert.equal(encodeComposerRecipe(recipe),text,id);
      assert.deepEqual(old.individual,current.individual,id); assert.deepEqual(old.graph,current.graph,id);
      for(const motion of ['neutral','idle','walk']) assert.deepEqual(old.update(motion,.37),current.update(motion,.37),id);
      assert.equal(digest(old.skin),digest(buildComposerSkin(old.graph,{presentation:'skin-5'})),id);
      assert.equal(current.skin.version,COMPOSER_REALISM_SKIN_VERSION);
      assert.equal(digest(old.skin) !== digest(current.skin),changed(current.graph.recipe),id);
      assert.ok(current.skin.triangleCount <= 40000 && current.skin.vertexCount <= 30000,id);
    } finally {old.dispose();current.dispose();}
  }
});

test('joined feet share their ankle positions AND influences with the leg, without changing other part geometry', () => {
  for(const id of COMPOSER_PRESET_IDS) {
    const animal = createComposerCreature(composerPreset(id),{presentation:'realism-1'}), skin=animal.skin;
    try {
      if(!changed(animal.graph.recipe))continue;
      for(const foot of skin.parts.filter(p=>p.part==='foot')) {
        const leg=skin.parts[skin.parts.indexOf(foot)-1]; assert.equal(leg.part,'leg');
        const legPoints=new Set(vertices(skin,leg).map(v=>signature(skin,v)));
        const shared=vertices(skin,foot).filter(v=>legPoints.has(signature(skin,v)));
        assert.equal(shared.length,animal.graph.recipe.legs==='arthropod'?9:16,`${id}/${foot.label}: one complete welded ankle ring`);
      }
      const old=buildComposerSkin(animal.graph);
      for(const part of skin.parts.filter(p=>!['leg','foot'].includes(p.part))) {
        const oldPart=old.parts.find(p=>p.part===part.part&&p.label===part.label);
        const arrays=(s,p)=>vertices(s,p).map(v=>[...s.positions.slice(v*3,v*3+3),...s.colors.slice(v*3,v*3+3),...s.skinIndex.slice(v*4,v*4+4),...s.skinWeight.slice(v*4,v*4+4)]);
        assert.deepEqual(arrays(skin,part),arrays(old,oldPart),`${id}/${part.label}: unrelated anatomy unchanged`);
      }
    } finally {animal.dispose();}
  }
});

test('actual deformed skin soles remain grounded in stance and clear the floor during swing', t => {
  let checks=0,stances=0,swings=0,maxModifiedStanceGap=0,maxUnmodifiedStanceGap=0,minGround=Infinity;
  const point=new THREE.Vector3();
  for(const id of COMPOSER_PRESET_IDS) for(const maturity of [1,.35]) {
    const animal=createComposerCreature({...composerPreset(id),maturity},{presentation:'realism-1'});
    try {
      const feet=animal.skin.parts.filter(p=>p.part==='foot').map(part=>({part,ids:vertices(animal.skin,part),limb:animal.graph.limbs.find(l=>l.kind==='leg'&&part.label.endsWith(`${l.pair+1}${l.side<0?'L':'R'}`))}));
      for(let frame=-1;frame<48;frame++) {
        const pose=animal.update(frame<0?'neutral':'walk',Math.max(frame,0)/48*animal.graph.locomotion.period);
        animal.group.updateMatrixWorld(true); animal.mesh.skeleton.update();
        for(const foot of feet) {
          const contact=pose.contacts.find(c=>c.limb===foot.limb.index); let minimum=Infinity;
          for(const v of foot.ids){point.fromArray(animal.skin.positions,v*3);animal.mesh.applyBoneTransform(v,point);minimum=Math.min(minimum,point.y);}
          const tol=Math.max(2e-6,animal.graph.dims.bodyLength*1e-6);
          assert.ok(minimum>=-tol,`${id}/${maturity}/${frame}/${foot.part.label}: skin penetrates ${minimum}m`);
          if(contact.stance){stances++;if(changed(animal.graph.recipe)){maxModifiedStanceGap=Math.max(maxModifiedStanceGap,minimum);assert.ok(minimum<=tol,`${id}/${foot.part.label}: planted mesh floats ${minimum}m`);}else maxUnmodifiedStanceGap=Math.max(maxUnmodifiedStanceGap,minimum);}
          else swings++;
          checks++;minGround=Math.min(minGround,minimum);
        }
      }
    } finally {animal.dispose();}
  }
  assert.ok(stances>0&&swings>0); t.diagnostic(JSON.stringify({checks,stances,swings,maxModifiedStanceGap,maxUnmodifiedStanceGap,minGround}));
});

test('skin6 reaches the existing Composer export LOD profile with valid inherited skinning', t => {
  const rows=[];
  for(const id of ['dinosaur','rhinoceros','turtle','giraffe','centipede','worm']) {
    const animal=createComposerCreature(composerPreset(id),{presentation:'realism-1'});
    try {
      const constraints=composerFootLodConstraints(animal.skin), chain=buildComposerLodChain(animal.skin,[8000,3000,1000],constraints);
      for(const level of chain.levels) {
        assert.ok(level.reached,`${id}: ${level.triangles}/${level.target}`);
        assert.ok(level.positions.every(Number.isFinite));
        const kept=new Set(level.sourceVertex);
        for(let i=0;i<constraints.protectedVertices.length;i++)if(constraints.protectedVertices[i])assert.ok(kept.has(i)||level.positions.some((_,j)=>j%3===0&&level.positions[j]===animal.skin.positions[i*3]&&level.positions[j+1]===animal.skin.positions[i*3+1]&&level.positions[j+2]===animal.skin.positions[i*3+2]),`${id}: foot anchor survives`);
        for(let i=0;i<level.vertices;i++) {
          const source=level.sourceVertex[i];
          assert.deepEqual(level.skinIndex.slice(i*4,i*4+4),animal.skin.skinIndex.slice(source*4,source*4+4));
          assert.deepEqual(level.skinWeight.slice(i*4,i*4+4),animal.skin.skinWeight.slice(source*4,source*4+4));
        }
        for(const part of level.parts.filter(p=>p.part==='foot')) {
          const limb=animal.graph.limbs.find(l=>l.kind==='leg'&&part.label.endsWith(`${l.pair+1}${l.side<0?'L':'R'}`));
          const ids=vertices(level,part),p=new THREE.Vector3();
          assert.ok(ids.length>=3,`${id}/${part.label}: foot still has a surface`);
          for(let f=0;f<12;f++){
            const pose=animal.update('walk',f/12*animal.graph.locomotion.period);animal.group.updateMatrixWorld(true);
            let low=Infinity;for(const v of ids){const source=level.sourceVertex[v];p.fromArray(level.positions,v*3);animal.mesh.applyBoneTransform(source,p);low=Math.min(low,p.y);}
            assert.ok(low>=-2e-6,`${id}/${part.label}: reduced foot penetrates ${low}`);
            if(changed(animal.graph.recipe)&&pose.contacts.find(c=>c.limb===limb.index).stance)assert.ok(low<=2e-6,`${id}/${part.label}: reduced sole floats ${low}`);
          }
        }
      }
      rows.push({id,source:animal.skin.triangleCount,tiers:chain.levels.map(l=>l.triangles)});
    } finally {animal.dispose();}
  }
  t.diagnostic(JSON.stringify(rows));
});

test('GLB style selection matches its geometry and version; legacy exports remain byte-exact', () => {
  const recipe=composerPreset('dinosaur'),opts={clips:['neutral']};
  const old=exportCreatureGlb(recipe,opts),explicit=exportCreatureGlb(recipe,{...opts,presentation:'skin-5'});
  assert.deepEqual(old.glb,explicit.glb);
  const current=exportCreatureGlb(recipe,{...opts,presentation:'realism-1',lods:['full',8000,3000,1000]});
  assert.equal(current.report.recipeText,old.report.recipeText);assert.equal(current.report.speciesKey,old.report.speciesKey);
  assert.equal(current.report.versions.skin,COMPOSER_REALISM_SKIN_VERSION);assert.equal(current.report.versions.lodFeet,'fauna-composer-foot-lod-1');
  const view=new DataView(current.glb.buffer,current.glb.byteOffset,current.glb.byteLength),json=JSON.parse(new TextDecoder().decode(current.glb.slice(20,20+view.getUint32(12,true))));
  assert.equal(json.asset.extras.composer.versions.skin,current.report.versions.skin);
  const a=createComposerCreature(recipe,{presentation:'realism-1'});
  try{assert.equal(current.report.mesh.triangles,a.skin.triangleCount);assert.equal(current.report.mesh.vertices,a.skin.vertexCount);}finally{a.dispose();}
  assert.notDeepEqual(old.glb,current.glb);
});

test('an over-detailed 24-leg body fails the 1000-triangle export rather than dropping protected limbs', () => {
  const recipe={...composerPreset('trunked-centipede'),legPairs:12};
  assert.throws(()=>exportCreatureGlb(recipe,{presentation:'realism-1',clips:['neutral'],lods:[8000,3000,1000]}),error=>error instanceof ComposerExportBudgetError&&error.reasons.some(r=>r.code==='lod-target'));
});
