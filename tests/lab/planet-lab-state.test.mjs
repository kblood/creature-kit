import test from 'node:test';
import assert from 'node:assert/strict';
import {PLANET_PRESETS,PLANET_FIELDS,copyPlanetDefinition,newPlanetSpecimen,editPlanetDefinition,planetSpecimenHash,planetSpecimenFromHash} from '../../apps/creature-lab/src/planet-lab-state.ts';
import {generateCreatureGenome,validateCreatureGenome,buildQuadrupedBody} from '../../src/planet-v1/index.ts';

test('canonical presets, seeds and growth use the existing generator deterministically',()=>{
  for(const {id} of PLANET_PRESETS){
    const first=newPlanetSpecimen('lab-regression',id),again=newPlanetSpecimen('lab-regression',id);
    assert.deepEqual(first,again);assert.equal(first.genome.morphology.family,id);
    assert.deepEqual(validateCreatureGenome(first.genome),[]);
    const sibling=newPlanetSpecimen('lab-regression',id,1),young=newPlanetSpecimen('lab-regression',id,0,'juvenile');
    assert.equal(sibling.speciesId,first.speciesId);assert.notEqual(sibling.individualId,first.individualId);
    assert.equal(young.genome.appearance.growth.stage,'juvenile');assert.ok(young.genome.torsoLength<first.genome.torsoLength);
  }
});
test('import and share retain every identity, appearance and morphology field without reseeding',()=>{
  const source=newPlanetSpecimen('Atlas test/æøå & = #','long-neck',3);source.individualId='atlas/member-original';source.speciesId='atlas/species-original';
  const before=structuredClone(source),loaded=copyPlanetDefinition(source),shared=planetSpecimenFromHash('#'+planetSpecimenHash(loaded));
  assert.deepEqual(loaded,before);assert.deepEqual(shared,before);loaded.genome.appearance.coat.colours.base[0]=0;
  assert.deepEqual(source,before,'nested coat arrays are not shared');
  assert.throws(()=>planetSpecimenFromHash('#animal={oops}'));assert.throws(()=>planetSpecimenFromHash('#animal={}&animal={}'),/repeated/);
});
test('anatomy edit preserves phenotype and source; unrelated genes are exact',()=>{
  const source=newPlanetSpecimen('imported-source','ungulate'),before=structuredClone(source),next=editPlanetDefinition(source,'torsoLength',2.45);
  assert.deepEqual(source,before);assert.equal(next.individualId,source.individualId);assert.equal(next.speciesId,source.speciesId);
  assert.equal(next.genome.torsoLength,2.45);assert.deepEqual(next.genome.appearance,source.genome.appearance);
  for(const [key,value] of Object.entries(source.genome))if(!['torsoLength','mutationLog'].includes(key))assert.deepEqual(next.genome[key],value,key);
  assert.match(next.genome.mutationLog.at(-1),/Planet Lab edit: torsoLength/);
  assert.deepEqual(editPlanetDefinition(source,'torsoLength',source.genome.torsoLength),source,'no-op does not append history');
});
test('coat edits change the actual canonical rendered colours without losing identity',()=>{
  const source=newPlanetSpecimen('coat-edit','ungulate'),before=structuredClone(source);
  const next=editPlanetDefinition(source,'coat.colour.base','#34aa66');
  assert.deepEqual(source,before);assert.equal(next.individualId,source.individualId);
  assert.notDeepEqual(next.genome.appearance.coat.colours.base,source.genome.appearance.coat.colours.base);
  assert.deepEqual(next.genome.appearance.individual,source.genome.appearance.individual);
  assert.notDeepEqual(buildQuadrupedBody(next.genome).colors,buildQuadrupedBody(source.genome).colors);
  assert.deepEqual(validateCreatureGenome(next.genome),[]);
  assert.deepEqual(editPlanetDefinition(source,'coat.pattern',source.genome.appearance.coat.pattern),source);
  const patterned=editPlanetDefinition(source,'coat.pattern','rosettes');assert.equal(patterned.genome.appearance.coat.pattern,'rosettes');
  const marked=editPlanetDefinition(source,'coat.mark.socks',true);assert.equal(marked.genome.appearance.coat.marks&1,1);
});
test('unsupported and invalid input fail without changing a loaded genome',()=>{
  const source=newPlanetSpecimen('bounds','ungulate'),before=structuredClone(source);
  for(const [key,value] of [['torsoLength',100],['neckRise',NaN],['layout','biped'],['coat.pattern','invented'],['coat.seed',.5],['coat.colour.base','red'],['trunkLength',.6]])
    assert.throws(()=>editPlanetDefinition(source,key,value),`${key} ${value}`);
  assert.deepEqual(source,before);
  assert.throws(()=>copyPlanetDefinition({...source,genome:{...source.genome,version:'future'}}),/Unsupported/);
});
test('earlier genome import keeps its version and its original coat controls',()=>{
  const source=copyPlanetDefinition({individualId:'legacy-animal',genome:generateCreatureGenome('legacy','runner')});
  assert.equal(source.genome.appearance,undefined);
  const changed=editPlanetDefinition(source,'color','#446688');assert.equal(changed.genome.appearance,undefined);assert.equal(changed.genome.color,'#446688');
  assert.equal(changed.individualId,'legacy-animal');assert.deepEqual(validateCreatureGenome(changed.genome),[]);
});
test('all exposed dimensional endpoints satisfy the public genome contract',()=>{
  for(const field of PLANET_FIELDS){
    const source=newPlanetSpecimen('field-contract',field.key==='armor'?'padded':'ungulate');
    for(const value of [field.min,field.max])assert.deepEqual(validateCreatureGenome(editPlanetDefinition(source,field.key,value).genome),[],`${field.key}=${value}`);
  }
});
