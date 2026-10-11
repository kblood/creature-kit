import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCreatureGenome,realisticIndividualCreatureGenome} from '../../src/planet-v1/creature-model.ts';
import {MORPHOLOGY_FAMILIES} from '../../src/planet-v1/fauna-appearance.ts';
import {planetComposerDefinition,buildPlanetComposerSource,PLANET_COMPOSER_SOURCE_VERSION} from '../../src/planet-composer.ts';
import {composerPreset,encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';
import {exportCreatureGlb,readComposerGlb} from '../../src/fauna-composer-export.ts';
import {createComposerCreature} from '../../src/fauna-composer.ts';
import {createLabComposerActor,parseLabPlanetDefinition,serializeLabPlanetDefinition,labComposerBuildOptions,editLabPlanetRecipe,editLabPlanetDimension,editLabPlanetCoat,labPlanetColourHex,labPlanetColourLinear} from '../../apps/creature-lab/src/creature-lab-planet.ts';
import {DEFAULT_LAB_STATE,parseCreatureLabState,creatureLabUrl,creatureLabComposerInputError,parseCreatureLabFile,creatureLabLocationQuery} from '../../apps/creature-lab/src/creature-lab-state.ts';

const specimen=(family='proboscidean',stage='juvenile')=>planetComposerDefinition(realisticIndividualCreatureGenome(generateCreatureGenome(`lab-replay/${family}`,'runner'),`individual/${family}`,2,stage,family),{individualId:`original/${family}/${stage}`,speciesId:`species/${family}`});
const skinArrays=['positions','normals','colors','skinIndex','skinWeight','index','regions','gloss','coatLayers','coatCrisp'];
function equalSkin(a,b){for(const key of skinArrays)assert.deepEqual(a[key],b[key],key);}

test('actual Lab actor path replays six families and both growth stages with exact graph, skin, colours and identity',()=>{
 for(const family of MORPHOLOGY_FAMILIES)for(const stage of ['adult','juvenile']){
  const d=specimen(family,stage),before=structuredClone(d),source=buildPlanetComposerSource(d),actor=createLabComposerActor(d.recipe,d,'realism-1');
  try{assert.deepEqual(actor.graph,source.graph);equalSkin(actor.skin,source.skin);assert.deepEqual(actor.mesh.geometry.userData.composer.identity,d.phenotype.identity);assert.equal(actor.mesh.geometry.userData.composer.sourceVersion,PLANET_COMPOSER_SOURCE_VERSION);assert.equal(actor.mesh.geometry.userData.composer.definitionVersion,d.schema);assert.deepEqual(actor.group.userData.planetComposerDefinition,d);assert.equal(actor.graph.dims.bodyLength,d.genome.torsoLength);assert.equal(actor.mesh.material.roughness,d.phenotype.roughness);assert.deepEqual(d,before);}finally{actor.dispose();}
 }
});

test('both independent definitions survive strict share, reload and complete Lab JSON import without redundant recipe keys',()=>{
 const first=specimen(),second=editLabPlanetDimension(first,'bodyLength',first.phenotype.dimensions.bodyLength*1.2);
 assert.deepEqual(first.recipe,second.recipe);assert.notDeepEqual(first.phenotype,second.phenotype);
 const state={...DEFAULT_LAB_STATE,planetDefinition:serializeLabPlanetDefinition(first),comparePlanetDefinition:serializeLabPlanetDefinition(second),compare:true,time:.375,presentation:'realism-1'};
 const url=new URL(creatureLabUrl('https://example.test/animal-lab/',state));
 const merged=creatureLabLocationQuery(url);assert.equal(url.searchParams.has('recipe'),false);assert.equal(url.searchParams.has('compareRecipe'),false);assert.equal(creatureLabComposerInputError(merged),null);assert.ok(url.search.length<300,'full definition payloads must not hit HTTP request-target limits');assert.ok(url.hash.includes('planetDefinition='));
 assert.deepEqual(parseCreatureLabState(merged),state);
 const repeated=new URL(url);repeated.searchParams.set('planetDefinition',state.planetDefinition);assert.match(creatureLabComposerInputError(creatureLabLocationQuery(repeated)),/repeated planetDefinition/);
 const restored=parseCreatureLabFile(JSON.stringify({state,composer:{diagnostics:'optional'},specimenUrl:'https://unused.example/'}));assert.equal(restored.kind,'lab');assert.deepEqual(restored.state,state);
 assert.deepEqual(parseCreatureLabFile(serializeLabPlanetDefinition(first)),{kind:'planet',definition:first});
 const mixed={...state,comparePlanetDefinition:undefined,compareRecipe:encodeComposerRecipe(composerPreset('worm'))};
 assert.equal(creatureLabComposerInputError(creatureLabLocationQuery(new URL(creatureLabUrl('https://example.test',mixed)))),null);
});

test('ambiguous, duplicate, malformed, oversized and doubly grown definition inputs fail closed',()=>{
 const d=specimen(),s=serializeLabPlanetDefinition(d),q=new URLSearchParams({planetDefinition:s});
 q.append('planetDefinition',s);assert.match(creatureLabComposerInputError(q),/repeated planetDefinition/);
 q.delete('planetDefinition');q.set('comparePlanetDefinition',s);q.set('compareRecipe','recipe');assert.match(creatureLabComposerInputError(q),/ambiguous/);
 for(const key of ['planetDefinition','comparePlanetDefinition']){
  assert.match(creatureLabComposerInputError(new URLSearchParams({[key]:''})),/Invalid/);
  assert.match(creatureLabComposerInputError(new URLSearchParams({[key]:'{bad'})),/Invalid/);
  assert.match(creatureLabComposerInputError(new URLSearchParams({[key]:' '.repeat(65537)})),/64 KiB/);
 }
 assert.throws(()=>parseLabPlanetDefinition(s.replace('"units":"m"','"units":"m","units":"m"')),/Repeated JSON field/);
 assert.throws(()=>parseLabPlanetDefinition(s.replace('"units":"m"','"units":"m","\\u0075nits":"m"')),/Repeated JSON field/);
 assert.throws(()=>parseLabPlanetDefinition(' '.repeat(65536)+s),/64 KiB/);
 assert.throws(()=>parseLabPlanetDefinition(JSON.stringify({...d,unrecognized:'é'.repeat(32768)})),/64 KiB/);
 assert.throws(()=>parseLabPlanetDefinition({...d,phenotype:{...d.phenotype,dimensions:{...d.phenotype.dimensions,bodyLength:-1}}}),/bodyLength/);
 assert.throws(()=>editLabPlanetRecipe(d,{...d.recipe,maturity:.4}),/growth twice/);
 assert.throws(()=>parseCreatureLabFile('{"state":{},"state":{}}'),/Repeated/);
 assert.throws(()=>parseCreatureLabFile(JSON.stringify({state:{...DEFAULT_LAB_STATE,compare:'1'}})),/compare/);
});

test('native resolved edits change only requested fields and preserve genome, IDs, stage and untouched float colours',()=>{
 const d=specimen(),before=structuredClone(d),hex=labPlanetColourHex(d.phenotype.coat.colours.base);assert.match(hex,/^#[\da-f]{6}$/);
 assert.deepEqual(d,before,'display colour conversion must not write 8-bit colours back');
 const length=d.phenotype.dimensions.bodyLength+.123456789;
 const shaped=editLabPlanetDimension(d,'bodyLength',length),coloured=editLabPlanetCoat(shaped,'colour:base',labPlanetColourLinear('#d74a19')),edited=editLabPlanetRecipe(coloured,{...coloured.recipe,eyes:'gecko'});
 assert.equal(edited.phenotype.dimensions.bodyLength,length);assert.equal(edited.recipe.eyes,'gecko');assert.deepEqual(edited.genome,before.genome);assert.deepEqual(edited.phenotype.identity,before.phenotype.identity);assert.deepEqual(edited.phenotype.coat.colours.accent,before.phenotype.coat.colours.accent);
 const a=buildPlanetComposerSource(d),b=buildPlanetComposerSource(edited);assert.notDeepEqual(a.skin.positions,b.skin.positions);assert.notDeepEqual(a.skin.colors,b.skin.colors);assert.deepEqual(d,before);
 assert.throws(()=>labComposerBuildOptions({...d.recipe,eyes:'gecko'},d,'realism-1'),/differ/);
});

test('the selected definition reaches the real GLB exporter with identical resolved phenotype, metres and source arrays',()=>{
 const first=specimen(),selected=editLabPlanetDimension(first,'headWidth',first.phenotype.dimensions.headWidth*1.15),options=labComposerBuildOptions(selected.recipe,selected,'realism-1');
 const expected=exportCreatureGlb(selected.recipe,{phenotype:selected.phenotype,presentation:'realism-1',clips:['neutral']}),actual=exportCreatureGlb(selected.recipe,{...options,clips:['neutral']});
 assert.deepEqual(actual.glb,expected.glb);assert.deepEqual(actual.report.phenotype,selected.phenotype);
 const gltf=readComposerGlb(actual.glb).json;assert.deepEqual(gltf.asset.extras.composer.phenotype,selected.phenotype);assert.notDeepEqual(gltf.asset.extras.composer.phenotype,first.phenotype);assert.equal(gltf.materials[0].pbrMetallicRoughness.roughnessFactor,selected.phenotype.roughness);
});

test('ordinary Composer recipe URLs and factory path retain their original controls and skin-5 output',()=>{
 const recipe={...composerPreset('worm'),maturity:.6,individualSeed:27},state={...DEFAULT_LAB_STATE,recipe:encodeComposerRecipe(recipe),presentation:'skin-5'},url=creatureLabUrl('https://example.test',state);
 assert.deepEqual(parseCreatureLabState(new URL(url).search),state);assert.equal(new URL(url).searchParams.has('planetDefinition'),false);
 const lab=createLabComposerActor(recipe,undefined,'skin-5'),direct=createComposerCreature(recipe);
 try{equalSkin(lab.skin,direct.skin);assert.deepEqual(lab.graph,direct.graph);assert.equal(lab.group.userData.planetComposerDefinition,undefined);}finally{lab.dispose();direct.dispose();}
});
