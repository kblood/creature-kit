import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlanetComposerSource,planetComposerDefinition} from '../../src/planet-composer.ts';
import {generateCreatureGenome} from '../../src/planet-v1/creature-model.ts';
import {buildComposerLodChain,composerAnatomyLodConstraints} from '../../src/fauna-composer-lod.ts';
import {createLabComposerActor} from '../../apps/creature-lab/src/creature-lab-planet.ts';

test('Lab LOD geometry matches Atlas requested-tier reduction and preserves the original identity and animation',()=>{
 const definition=planetComposerDefinition(generateCreatureGenome('lod-preview-replay','runner'),{individualId:'original/member',speciesId:'original/species'});
 const source=buildPlanetComposerSource(definition),before=structuredClone(definition);
 const full=createLabComposerActor(definition.recipe,definition,'realism-1');
 try{for(const target of [4500,1000]){
  const expected=buildComposerLodChain(source.skin,[target],composerAnatomyLodConstraints(source.skin,source.graph)).levels[0];
  const actor=createLabComposerActor(definition.recipe,definition,'realism-1',target);
  try{
   for(const key of ['positions','normals','colors','skinIndex','skinWeight','index','gloss'])assert.deepEqual(actor.skin[key],expected[key],key);
   assert.deepEqual(actor.graph,source.graph);assert.deepEqual(actor.group.userData.planetComposerDefinition,definition);
   assert.deepEqual(actor.update('walk',.375),full.update('walk',.375));
   assert.equal(actor.mesh.geometry.index.count,expected.triangles*3);
   assert.equal(actor.details().triangles,expected.triangles);
   for(let i=0;i<expected.vertices;i++){
    assert.equal(actor.skin.regions[i],source.skin.regions[expected.sourceVertex[i]]);
    if(source.skin.coatLayers)for(const key of ['c0','c1','c2','sample']){
     const width=key==='sample'?4:3;
     assert.deepEqual(actor.skin.coatLayers[key].slice(i*width,(i+1)*width),source.skin.coatLayers[key].slice(expected.sourceVertex[i]*width,(expected.sourceVertex[i]+1)*width));
    }
   }
  }finally{actor.dispose();}
 }}finally{full.dispose();}
 assert.deepEqual(definition,before);
});
