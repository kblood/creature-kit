import {CREATURE_GENOME_VERSION,validateCreatureGenome,type CreatureGenome} from './creature-model.ts';
export const PLANET_ANIMAL_DEFINITION_VERSION='planet-animal-definition-1';
/** One source definition for planetary inspection/rendering. Experimental
 * ComposerRecipe remains a different, explicitly labelled input format. */
export interface PlanetAnimalDefinition {
  schema:typeof PLANET_ANIMAL_DEFINITION_VERSION;kind:'planet-genome';
  individualId:string;speciesId?:string;genome:CreatureGenome;
}
export function planetAnimalDefinition(input:unknown):PlanetAnimalDefinition{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Planet animal definition must be an object');
  const record=input as Partial<PlanetAnimalDefinition>,genome=(record.genome??input) as CreatureGenome;
  if(record.schema!==undefined&&record.schema!==PLANET_ANIMAL_DEFINITION_VERSION)throw new Error('Unsupported planet animal definition version');
  if(record.kind!==undefined&&record.kind!=='planet-genome')throw new Error('Planet inspection requires a canonical genome, not another recipe format');
  if(genome.version!==CREATURE_GENOME_VERSION)throw new Error('Unsupported canonical genome version; migrate explicitly');
  const errors=validateCreatureGenome(genome);if(errors.length)throw new Error(errors.join('; '));
  const individualId=record.individualId??'planet-inspection';
  if(typeof individualId!=='string'||!individualId.trim()||individualId.length>512)throw new Error('Invalid individual identity');
  if(record.speciesId!==undefined&&typeof record.speciesId!=='string')throw new Error('Invalid species identity');
  // Keep the loaded genome unchanged, including its individual phenotype.
  return {schema:PLANET_ANIMAL_DEFINITION_VERSION,kind:'planet-genome',individualId,...(record.speciesId!==undefined?{speciesId:record.speciesId}:{}),genome};
}
