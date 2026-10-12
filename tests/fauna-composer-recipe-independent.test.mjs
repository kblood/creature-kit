// Independent of the production implementation tests. Real module only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 COMPOSER_RECIPE_VERSION,COMPOSER_RECIPE_MAX_TEXT,COMPOSER_CHOICES,COMPOSER_RANGES,
 COMPOSER_RECIPE_KEYS,COMPOSER_PRESETS,COMPOSER_PRESET_IDS,composerPreset,
 composerLegPairRange,normalizeComposerRecipe,composerConstraints,
 composerHash,composerRandom,randomComposerRecipe,encodeComposerRecipe,
 decodeComposerRecipe,composerRecipesEqual,
} from '../src/fauna-composer-recipe.ts';

function bounded(recipe){
 assert.equal(recipe.version,COMPOSER_RECIPE_VERSION);
 assert.deepEqual(Object.keys(recipe).sort(),['version',...COMPOSER_RECIPE_KEYS].sort());
 for(const[key,choices]of Object.entries(COMPOSER_CHOICES))assert.ok(choices.includes(recipe[key]),`${key} must be an actual supported choice`);
 for(const[key,[min,max,step]]of Object.entries(COMPOSER_RANGES)){
  assert.ok(Number.isFinite(recipe[key])&&recipe[key]>=min&&recipe[key]<=max,`${key} bounded`);
  assert.ok(Math.abs(recipe[key]/step-Math.round(recipe[key]/step))<1e-7,`${key} step`);
 }
 const[lo,hi]=composerLegPairRange(recipe.layout);assert.ok(recipe.legPairs>=lo&&recipe.legPairs<=hi);
}

test('all twelve presets are complete, bounded and independently editable copies',()=>{
 const frozen=JSON.stringify(COMPOSER_PRESETS);assert.equal(COMPOSER_PRESET_IDS.length,12);
 for(const id of COMPOSER_PRESET_IDS){const recipe=composerPreset(id),again=composerPreset(id);bounded(recipe);assert.notEqual(recipe,again);assert.deepEqual(recipe,again);assert.deepEqual(normalizeComposerRecipe(recipe).issues,[]);
  // trunk is derived from the face (v3): it follows head, never an edit of its own
  assert.equal(recipe.trunk,recipe.head==='proboscis'?'trunk':'none',`${id}: trunk follows the face`);
  for(const[key,choices]of Object.entries(COMPOSER_CHOICES)){if(key==='trunk')continue;const chosen=choices.find(value=>value!==recipe[key]),manual={...recipe,[key]:chosen};assert.equal(normalizeComposerRecipe(manual).recipe[key],chosen,`${id}: ${key} remains editable`);}
  recipe.head='mandibles';recipe.bodyLength=4.25;assert.deepEqual(composerPreset(id),again,'Preset clone cannot mutate its source');
 }
 assert.equal(JSON.stringify(COMPOSER_PRESETS),frozen);
});

test('preset lookup rejects paths, unknown ids and inherited Object prototype names',()=>{
 for(const id of ['../deer','https://example.test/asset.glb','file:///private.glb','unknown','toString','constructor','__proto__','hasOwnProperty'])
  assert.throws(()=>composerPreset(id),/Unknown composer preset/,`Preset ${id} must never return an incomplete inherited value`);
});

test('numeric and enum normalization bounds malformed input without retaining its fields',()=>{
 for(const[key,[min,max]]of Object.entries(COMPOSER_RANGES)){
  for(const value of [NaN,Infinity,-Infinity,'','  ',{},null,undefined]){const result=normalizeComposerRecipe({[key]:value});bounded(result.recipe);assert.ok(result.issues.some(issue=>issue.includes(key)));}
  for(const value of [min-100,max+100,'1e309']){const result=normalizeComposerRecipe({[key]:value});bounded(result.recipe);assert.ok(result.issues.some(issue=>issue.includes(key)));}
 }
 for(const[key]of Object.entries(COMPOSER_CHOICES))for(const value of ['unknown','../../private.glb','https://example.test/model',null,[],123]){const result=normalizeComposerRecipe({[key]:value});bounded(result.recipe);assert.ok(result.issues.some(issue=>issue.includes(key)));}
 for(const input of [null,undefined,false,4,'recipe']){const result=normalizeComposerRecipe(input);bounded(result.recipe);assert.ok(result.issues.length>0);}
});

test('every legal layout enforces its real leg-pair range and preserves other choices',()=>{
 const expected={limbless:[0,0],biped:[1,1],quadruped:[2,2],sprawled:[2,2],'many-legged':[3,12]};
 for(const[layout,range]of Object.entries(expected)){assert.deepEqual(composerLegPairRange(layout),range);for(const count of[-100,0,1,2,3,7,12,999,2.6]){const{recipe}=normalizeComposerRecipe({...composerPreset('dinosaur'),layout,legPairs:count,head:'beak',armor:'dome',trunk:'trunk'});bounded(recipe);assert.equal(recipe.head,'beak');assert.equal(recipe.armor,'dome');assert.equal(recipe.trunk,'none','v3: a stale trunk field never grows a trunk on a beak');}}
});

test('seeded composition is order-independent, structurally varied and never chooses a preset wholesale',()=>{
 const signatures=new Set(),layouts=new Set(),heads=new Set(),torsos=new Set(),presets=new Set(COMPOSER_PRESET_IDS.map(id=>encodeComposerRecipe(composerPreset(id))));
 for(let i=0;i<256;i++){const seed=`independent-composer-${i}`,recipe=randomComposerRecipe(seed);bounded(recipe);const encoded=encodeComposerRecipe(recipe);signatures.add(encoded);layouts.add(recipe.layout);heads.add(recipe.head);torsos.add(recipe.torso);assert.ok(!presets.has(encoded));randomComposerRecipe(`interference-${i}`);assert.deepEqual(randomComposerRecipe(seed),recipe);}
 assert.equal(signatures.size,256);assert.deepEqual([...layouts].sort(),[...COMPOSER_CHOICES.layout].sort());assert.deepEqual([...heads].sort(),[...COMPOSER_CHOICES.head].sort());assert.deepEqual([...torsos].sort(),[...COMPOSER_CHOICES.torso].sort());
 const a=composerRandom('stable'),b=composerRandom('stable');for(let i=0;i<64;i++){const value=a();assert.ok(value>=0&&value<1);assert.equal(value,b());}
 assert.equal(composerHash('stable'),composerHash('stable'));assert.notEqual(composerHash('stable'),composerHash('changed'));
});

test('full explicit recipes round-trip through actual URL form encoding without rerolling manual values',()=>{
 const recipes=COMPOSER_PRESET_IDS.map(composerPreset);for(let i=0;i<128;i++)recipes.push(randomComposerRecipe(`replay-${i}`));
 for(const[key,[min,max]]of Object.entries(COMPOSER_RANGES))for(const value of[min,max])recipes.push(normalizeComposerRecipe({...composerPreset('centipede'),[key]:value}).recipe);
 recipes.push(normalizeComposerRecipe({...composerPreset('turtle'),layout:'many-legged',legPairs:9,head:'flat-face',neckLength:1.17,armor:'dome',wings:'membrane',hands:'pincer',arms:'grasping',trunk:'trunk',bodyLength:3.21,colorSeed:9876}).recipe);
 for(const recipe of recipes){const snapshot=structuredClone(recipe),text=encodeComposerRecipe(recipe),url=new URL('https://example.test/creature-lab.html');url.searchParams.set('composerRecipe',text);const result=decodeComposerRecipe(url.searchParams.get('composerRecipe'));assert.equal(result.error,null);assert.deepEqual(result.issues,[]);assert.deepEqual(result.recipe,recipe);assert.equal(composerRecipesEqual(result.recipe,recipe),true);assert.deepEqual(recipe,snapshot);assert.ok(text.length<=COMPOSER_RECIPE_MAX_TEXT);assert.equal(encodeComposerRecipe(result.recipe),text);}
});

test('decoder rejects unsupported versions and oversized text; bounded partial/duplicate input is explicit',()=>{
 for(const text of['','   ',null,17,'v0','v5*head_beak','v5*layout_biped','V3*layout_biped','V4*layout_biped','v4.1*layout_biped','v3.1*layout_biped','v999*layout_biped','x'.repeat(COMPOSER_RECIPE_MAX_TEXT+1)]){const result=decodeComposerRecipe(text);assert.equal(result.recipe,null);assert.ok(result.error);}
 const duplicate=decodeComposerRecipe('v1*head_beak*head_jaws*layout_biped*legPairs_12*bodyLength_999');assert.equal(duplicate.error,null);bounded(duplicate.recipe);assert.equal(duplicate.recipe.head,'beak');assert.equal(duplicate.recipe.legPairs,1);assert.equal(duplicate.recipe.bodyLength,6);assert.ok(duplicate.issues.some(issue=>/Repeated/.test(issue)));assert.ok(duplicate.issues.some(issue=>/limited/.test(issue)));
 const unknown=decodeComposerRecipe('v1*glb_https://example.test/private.glb*source_../../private*__proto___polluted*head_https://example.test/evil');bounded(unknown.recipe);assert.ok(unknown.issues.length>=4);assert.equal(Object.hasOwn(unknown.recipe,'source'),false);assert.equal(Object.hasOwn(unknown.recipe,'glb'),false);assert.equal(Object.hasOwn(unknown.recipe,'__proto__'),false);assert.equal({}.polluted,undefined);assert.ok(!encodeComposerRecipe(unknown.recipe).includes('https:'));
});

test('compatibility explanations retain selected modules instead of rewriting recipe identity',()=>{
 const recipe=normalizeComposerRecipe({...composerPreset('worm'),neckLength:1,wings:'membrane',wingSpan:4,armor:'dome',arms:'grasping',hands:'pincer',head:'beak',trunk:'trunk',horns:'nasal',tail:'none',tailLength:1}).recipe,snapshot=structuredClone(recipe),constraints=composerConstraints(recipe);
 // v3: the nasal horn on a beak is built as a casque ('Horns'); the trunk follows the face, so a beak has none and nothing is disclosed for it
 for(const term of['Legs and feet','Neck','Shell','Wings','Wing span','Horns','Arms','Tail length'])assert.ok(constraints.some(c=>c.part===term),`Disclosure for ${term}`);
 assert.equal(recipe.horns,'nasal');assert.equal(recipe.trunk,'none');assert.ok(!constraints.some(c=>c.part==='Trunk'||c.part==='Horn'));
 for(const c of constraints){assert.equal(typeof c.chosen,'string');assert.ok(c.effect.length>10);}
 assert.deepEqual(recipe,snapshot);assert.ok(constraints.some(c=>c.effect.includes('flight and gliding')));
});

test('versioned recipe equality does not equate an unsupported future recipe with v1',()=>{
 const recipe=composerPreset('turtle');assert.equal(composerRecipesEqual(recipe,{...recipe,version:5}),false,'Version changes can change interpretation even with identical field text');
 for(const key of COMPOSER_RECIPE_KEYS){const changed={...recipe};changed[key]=typeof recipe[key]==='number'?recipe[key]+1:'different';assert.equal(composerRecipesEqual(recipe,changed),false,key);}
});
