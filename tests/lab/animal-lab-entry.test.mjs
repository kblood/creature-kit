import test from 'node:test';
import assert from 'node:assert/strict';
import {animalLabEntryUrl} from '../../apps/creature-lab/src/animal-lab-entry.ts';
import {composerPreset,encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';
import {parseCreatureLabState,creatureLabComposerInputError} from '../../apps/creature-lab/src/creature-lab-state.ts';

test('the directory and index entries open the full Animal Lab composer at any deployment depth',()=>{
  for(const base of ['https://example.test/animal-lab/','https://example.test/animal-lab/index.html','https://example.test/nested/labs/animals/']){
    const target=new URL(animalLabEntryUrl(base));
    assert.equal(target.href,new URL('./creature-lab.html?mode=composer',base).href);
    assert.equal(parseCreatureLabState(target.search).mode,'composer');
  }
});
test('entry forwards exact recipe, eyes, trunk, comparison, herd, time and fragment state',()=>{
  const recipe=encodeComposerRecipe({...composerPreset('trunked-centipede'),eyes:'gecko',iris:'gold'});
  const second=encodeComposerRecipe(composerPreset('worm'));
  const query=`?mode=composer&recipe=${encodeURIComponent(recipe)}&compare=1&compareRecipe=${encodeURIComponent(second)}&herd=6&time=2.75&motion=display&view=side&composerSeed=a+b%2Fc&light=planet-noon`;
  const target=new URL(animalLabEntryUrl(`https://example.test/animal-lab/${query}#composer-head`));
  assert.equal(target.search,query);assert.equal(target.hash,'#composer-head');
  assert.deepEqual(parseCreatureLabState(target.search),parseCreatureLabState(query));
});
test('entry supplies default mode without rewriting encoded parameters or hiding invalid inputs',()=>{
  const query='?composerSeed=a+b%2Fc&recipe=v4%2Ainvalid&herd=6&herd=9';
  const target=new URL(animalLabEntryUrl(`https://example.test/animal-lab/index.html${query}#anchor`));
  assert.equal(target.search,query+'&mode=composer');assert.match(creatureLabComposerInputError(target.search),/repeated herd/);
  for(const mode of ['skin','gallery','']){
    const explicit=`?mode=${mode}&recipe=keep-this&mode=composer`;
    const result=new URL(animalLabEntryUrl(`https://example.test/animal-lab/${explicit}`));
    assert.equal(result.search,explicit);assert.match(creatureLabComposerInputError(result.search),/Unsupported link/);
  }
});
