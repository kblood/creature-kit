/** Versioned canonical planetary animal entry. Existing algorithms and model
 * versions are preserved; extraction is not a ComposerRecipe substitution. */
export const PLANET_ANIMAL_CORE_VERSION='planet-animal-core-1';
export * from './creature-model.ts';
export * from './fauna-appearance.ts';
export * from './fauna-body-plan.ts';
export * from './fauna-face.ts';
export * from './fauna-structural-appendages.ts';
export * from './fauna-locomotion.ts';
export * from './inspector.ts';
export * from './definition.ts';
export type {PlanetFaunaPathMember,PlanetFaunaActivity} from './caller-contract.ts';
