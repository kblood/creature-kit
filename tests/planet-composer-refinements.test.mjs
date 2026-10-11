import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCreatureGenome,realisticIndividualCreatureGenome} from '../src/planet-v1/creature-model.ts';
import {sampleFaunaCoat,faunaPreparedCoatContextInto,MORPHOLOGY_FAMILIES} from '../src/planet-v1/fauna-appearance.ts';
import {planetComposerDefinition,planetComposerWorldDefinition,buildPlanetComposerSource,parsePlanetComposerDefinition,serializePlanetComposerDefinition,planetComposerSourceIdentity,assertPlanetComposerSourceIdentity,PLANET_COMPOSER_SOURCE_VERSION} from '../src/planet-composer.ts';
import {evaluateFaunaStageCoat,FAUNA_JUVENILE_COAT_VERSION,faunaJuvenileStockingStrength} from '../src/fauna-coat-juvenile.ts';
import {COAT_MARK_BITS,COAT_REGIONS} from '../src/fauna-coat-vocab.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {exportCreatureGlb,readComposerGlb} from '../src/fauna-composer-export.ts';

const genome=(family='ungulate',stage='juvenile')=>realisticIndividualCreatureGenome(generateCreatureGenome(`refinement/${family}`,'runner'),`original/${family}`,2,stage,family);
const definition=(family,stage)=>planetComposerWorldDefinition(genome(family,stage),{individualId:'world/individual/27',speciesId:'world/species/4'});
const reverseKeys=x=>Array.isArray(x)?x.map(reverseKeys):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reverseKeys(x[k])])):x;

test('canonical whole-definition identity ignores object key order, memoizes frozen values, detects mutation and validates collisions',()=>{
 const d=definition(),r=reverseKeys(d),text=serializePlanetComposerDefinition(d);assert.equal(text,serializePlanetComposerDefinition(r));assert.equal(text,serializePlanetComposerDefinition(parsePlanetComposerDefinition(text)));
 const a=planetComposerSourceIdentity(d,{codePin:'kit/abcdef'}),b=planetComposerSourceIdentity(r,{codePin:'kit/abcdef'});assert.deepEqual(a,b);assert.equal(planetComposerSourceIdentity(d,{codePin:'kit/abcdef'}),a);assert.ok(a.key.length<400);assert.equal(a.versions.source,PLANET_COMPOSER_SOURCE_VERSION);assert.equal(a.versions.skin,'fauna-composer-skin-6');assertPlanetComposerSourceIdentity(a,b);
 assert.throws(()=>assertPlanetComposerSourceIdentity(a,{...a,canonical:a.canonical+' '}),/collision/);
 for(const options of [{codePin:'kit/other'},{codePin:'kit/abcdef',presentation:'skin-5'}])assert.notEqual(planetComposerSourceIdentity(d,options).key,a.key);
 r.phenotype.dimensions.bodyLength+=.1;assert.notEqual(planetComposerSourceIdentity(r,{codePin:'kit/abcdef'}).key,a.key);assert.notEqual(serializePlanetComposerDefinition(r),text);
 assert.deepEqual(d.genome,genome());assert.deepEqual(d.phenotype.identity,{individualId:'world/individual/27',speciesId:'world/species/4',appearanceKey:d.genome.appearance.individualKey,maturity:d.genome.appearance.growth.maturity,sex:d.genome.appearance.individual.sex});
 for(const identity of [undefined,{}, {individualId:'x'}, {individualId:' ',speciesId:'s'}])assert.throws(()=>planetComposerWorldDefinition(genome(),identity),/actual individualId/);
 assert.throws(()=>planetComposerWorldDefinition(generateCreatureGenome('debug','runner'),{individualId:'x',speciesId:'s'}),/resolved inherited appearance/);
});

test('full-cycle metres convert to duty-scaled stance sweep, and numeric post-fit ledger matches actual segments and cadence',t=>{
 const rows=[];
 for(const family of MORPHOLOGY_FAMILIES)for(const stage of ['adult','juvenile']){
  const d=definition(family,stage),{graph:g}=buildPlanetComposerSource(d),l=g.locomotion,fit=g.phenotypeFit,entry=key=>fit.entries.find(e=>e.field===key);
  assert.equal(entry('stanceSweep').requested,d.phenotype.motion.strideLength*l.duty);assert.equal(entry('cycleLength').requested,d.phenotype.motion.strideLength);assert.equal(entry('cycleLength').built,l.stride/l.duty);
  assert.ok(entry('cycleLength').built<=entry('cycleLength').requested*(1+1e-12));assert.ok(Math.abs(l.period*l.speed-l.stride/l.duty)<1e-12);assert.equal(l.speed,d.genome.walkSpeed);
  for(const limb of g.limbs.filter(x=>x.kind==='leg'))assert.equal(entry(`limb.${limb.index}.reach`).built,limb.segments.reduce((a,b)=>a+b,0));
  assert.equal(fit.derived.footHeightToWidthRatio,.42);assert.equal(fit.derived.neckBones,g.chains.neck.length);assert.deepEqual(fit.deviations,fit.entries.filter(x=>Math.abs(x.built-x.requested)>1e-9*Math.max(1,Math.abs(x.requested))));
  rows.push({family,stage,cycleRequested:entry('cycleLength').requested,cycleBuilt:entry('cycleLength').built,legRequested:entry('legReach').requested,legBuilt:entry('legReach').built,deviations:fit.deviations.length});
 }
 t.diagnostic(JSON.stringify(rows));
 const tiny=structuredClone(definition('padded','adult'));tiny.phenotype.motion.strideLength=.001;const g=buildPlanetComposerSource(tiny).graph;assert.equal(g.locomotion.stride,.001*g.locomotion.duty);assert.ok(Math.abs(g.locomotion.period-.001/tiny.phenotype.motion.walkSpeed)<1e-15);
});

test('measured belly clearance finds the same minimum from either side instead of rounding up by 20 percent',()=>{
 const short=structuredClone(definition('padded','adult'));Object.assign(short.phenotype.dimensions,{legReach:.06,torsoHeight:1.4,torsoWidth:.6,stanceWidth:.35});
 const a=buildPlanetComposerSource(short).graph,built=a.dims.legReach;assert.ok(built>.06);assert.equal(a.phenotypeFit.entries.find(x=>x.field==='legReach').built,built);
 const below=structuredClone(short);below.phenotype.dimensions.legReach=built*.999;const b=buildPlanetComposerSource(below).graph;assert.ok(Math.abs(b.dims.legReach-built)<1e-9);
 const above=structuredClone(short);above.phenotype.dimensions.legReach=built*1.001;const c=buildPlanetComposerSource(above).graph;assert.equal(c.dims.legReach,above.phenotype.dimensions.legReach);
 assert.equal(a.dims.torsoHeight,short.phenotype.dimensions.torsoHeight/2);assert.equal(a.dims.torsoWidth,short.phenotype.dimensions.torsoWidth/2);
});

test('shared sampled stage helper reproduces actual planetary fawn spots and developing stockings on adult/juvenile probes',t=>{
 let probes=0,spotted=0;
 for(const stage of ['adult','juvenile']){
  const g=genome('ungulate',stage);g.appearance.coat={...g.appearance.coat,pattern:'plain',marks:COAT_MARK_BITS.socks|COAT_MARK_BITS['juvenile-spots'],juvenileSpots:stage==='juvenile'?.85:0};
  const TL=g.torsoLength,ty=1.1,halfH=g.torsoHeight/2/TL,halfW=g.torsoWidth/2/TL,context={x:0,y:0,z:0,dorsal:0,region:'torso',along:0,footprint:0},out=new Float64Array(3);
  const stageInfo={version:FAUNA_JUVENILE_COAT_VERSION,stage,maturity:g.appearance.growth.maturity};
  for(const region of ['torso','limb-upper','limb-lower','foot','neck'])for(let ix=0;ix<31;ix++)for(let iy=0;iy<7;iy++){
   const x=(-.45+ix*.03)*TL,y=ty+(-.1+iy*.05)*TL,z=halfW*TL,cell=.019,surface={dorsal:.3,along:.8,cellM:cell*TL};
   const prepared=faunaPreparedCoatContextInto(g,x,y,z,ty,region,surface,context),oracle=sampleFaunaCoat(g,x,y,z,ty,region,surface);
   evaluateFaunaStageCoat(prepared,stageInfo,context,{x:x/TL,y:(y-ty)/TL,z:z/TL,halfH,halfW,cell},out);for(let c=0;c<3;c++)assert.ok(Math.abs(out[c]-oracle[c])<1e-12,`${stage}/${region}/${ix}/${iy}/${c}`);probes++;
   if(region==='torso'&&stage==='juvenile'){const noSpots={...prepared,marks:prepared.marks&~COAT_MARK_BITS['juvenile-spots']},unspotted=new Float64Array(3);evaluateFaunaStageCoat(noSpots,stageInfo,context,{x:x/TL,y:(y-ty)/TL,z:z/TL,halfH,halfW,cell},unspotted);if(Math.abs(unspotted[0]-out[0])>1e-3)spotted++;}
  }
 }
 assert.ok(spotted>0);assert.equal(faunaJuvenileStockingStrength(.2),.4);assert.equal(faunaJuvenileStockingStrength(.7),1);t.diagnostic(JSON.stringify({probes,spotted}));
});

test('versioned juvenile stage colours reach vertex fallback, crisp layers, actor and actual GLB; old definitions remain explicit',()=>{
 const d=structuredClone(definition());d.phenotype.coat={...d.phenotype.coat,pattern:'spots',marks:COAT_MARK_BITS.socks|COAT_MARK_BITS['juvenile-spots'],juvenileSpots:.9};
 const old=structuredClone(d);delete old.phenotype.coatStage;const a=buildPlanetComposerSource(d),b=buildPlanetComposerSource(old);assert.deepEqual(a.skin.positions,b.skin.positions);assert.notDeepEqual(a.skin.colors,b.skin.colors);for(const k of ['c0','c1','c2'])assert.notDeepEqual(a.skin.coatLayers[k],b.skin.coatLayers[k]);
 const unstocked=structuredClone(d);unstocked.phenotype.coat.marks&=~COAT_MARK_BITS.socks;const c=buildPlanetComposerSource(unstocked),stockingDiff=[];for(let v=0;v<a.skin.vertexCount;v++)if(a.skin.regions[v]===COAT_REGIONS.indexOf('foot'))stockingDiff.push(Math.abs(a.skin.colors[v*3]-c.skin.colors[v*3]));assert.ok(stockingDiff.some(x=>x>1e-3));
 const actor=createComposerCreature(d.recipe,{phenotype:d.phenotype,presentation:'realism-1'});try{assert.deepEqual(actor.skin.colors,a.skin.colors);assert.deepEqual(actor.skin.coatLayers,a.skin.coatLayers);}finally{actor.dispose();}
 const glb=exportCreatureGlb(d.recipe,{phenotype:d.phenotype,presentation:'realism-1',clips:['neutral']});assert.deepEqual(readComposerGlb(glb.glb).json.asset.extras.composer.phenotype.coatStage,d.phenotype.coatStage);
 assert.throws(()=>parsePlanetComposerDefinition({...d,phenotype:{...d.phenotype,coatStage:{version:'unknown',stage:'juvenile',maturity:.3}}}),/coat stage/);
});
