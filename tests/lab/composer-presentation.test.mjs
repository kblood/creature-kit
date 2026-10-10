import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCreatureLabState,creatureLabUrl,creatureLabComposerInputError} from '../../apps/creature-lab/src/creature-lab-state.ts';
import {composerPreset,encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';
import {createComposerCreature} from '../../src/fauna-composer.ts';
import {exportCreatureGlb,readComposerGlb} from '../../src/fauna-composer-export.ts';

test('Lab defaults to the modern presentation while the factory keeps preserved skin 5',()=>{
 const recipe=composerPreset('rhinoceros'),before=structuredClone(recipe),old=createComposerCreature(recipe),modern=createComposerCreature(recipe,{presentation:parseCreatureLabState('').presentation});
 try{assert.equal(old.skin.version,'fauna-composer-skin-5');assert.equal(modern.skin.version,'fauna-composer-skin-6');assert.equal(modern.graph.version,old.graph.version);assert.deepEqual(modern.individual,old.individual);assert.deepEqual(recipe,before);}finally{old.dispose();modern.dispose();}
});
test('both presentations survive share/reload with exact recipe and secondary comparison state',()=>{
 for(const presentation of ['realism-1','skin-5']){
  const recipe=encodeComposerRecipe({...composerPreset('trunked-centipede'),eyes:'gecko'}),compareRecipe=encodeComposerRecipe(composerPreset('worm'));
  const state={...parseCreatureLabState(''),presentation,recipe,compareRecipe,compare:true,time:3.7,herd:6};
  const url=new URL(creatureLabUrl('https://example.test/animal-lab/creature-lab.html',state));
  assert.equal(url.searchParams.get('presentation'),presentation);assert.deepEqual(parseCreatureLabState(url.search),state);assert.equal(creatureLabComposerInputError(url.search),null);
 }
});
test('unknown or repeated presentation parameters reject visibly instead of silently replacing a surface',()=>{
 for(const value of ['new','skin-6','', 'REALISM-1'])assert.match(creatureLabComposerInputError(`?presentation=${value}`),/unknown presentation/);
 assert.match(creatureLabComposerInputError('?presentation=skin-5&presentation=realism-1'),/repeated presentation/);
});
test('desktop GLB export uses selected surface and exposes its real version; budget failure throws before output',()=>{
 const recipe=composerPreset('turtle');
 for(const [presentation,version] of [['realism-1','fauna-composer-skin-6'],['skin-5','fauna-composer-skin-5']]){
  const {glb,report}=exportCreatureGlb(recipe,{presentation,target:'desktop-web',clips:[]});
  assert.equal(report.versions.skin,version);assert.equal(report.budget.pass,true);assert.ok(readComposerGlb(glb).json.asset);
 }
 assert.throws(()=>exportCreatureGlb(recipe,{presentation:'realism-1',target:'desktop-web',clips:[],budget:{maxTriangles:1}}),/budget exceeded/);
});
