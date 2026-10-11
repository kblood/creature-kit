import {COAT_GENOME_RANGES, type CoatGenome} from './fauna-coat-fields.ts';
import {COAT_ROLES, COAT_PATTERNS} from './fauna-coat-vocab.ts';
import type {ComposerRecipe} from './fauna-composer-recipe.ts';
import {FAUNA_JUVENILE_COAT_VERSION, type FaunaJuvenileCoatStage} from './fauna-coat-juvenile.ts';

/** An already resolved individual. This is additive to recipe v4, not a new
 * individual random stream. Dimensions are never quantized to recipe controls. */
export const COMPOSER_BUILD_PHENOTYPE_VERSION = 'fauna-composer-phenotype-1';
export interface ComposerBuildPhenotype {
  version: typeof COMPOSER_BUILD_PHENOTYPE_VERSION;
  units: 'm';
  identity: {individualId?: string; speciesId?: string; appearanceKey?: string; maturity: number; sex: 'none' | 'female' | 'male'};
  dimensions: {
    bodyLength: number; torsoWidth: number; torsoHeight: number;
    legReach: number; upperLegFraction: number; stanceWidth: number;
    neckLength: number; neckElevation: number;
    headLength: number; headWidth: number;
    tailLength: number; footLength: number; footWidth: number;
    hornLength: number; earLength: number; trunkLength: number; wingSpan: number;
  };
  coat: CoatGenome;
  /** Optional sampled stage layers. Absent definitions retain library-only spots/socks. */
  coatStage?: FaunaJuvenileCoatStage;
  /** Pattern-frame offsets in torso-length units; colours remain linear RGB. */
  coatFrame: {phase: number; lateral: number};
  roughness: number;
  /** walkSpeed: metres/second; strideLength: metres travelled in ONE FULL GAIT
   * CYCLE, not the Composer locomotion.stride stance sweep (duty × cycle). */
  motion: {walkSpeed: number; strideLength: number};
}

/** Fail closed on malformed resolved data; never repair or silently clamp it. */
export function cloneComposerBuildPhenotype(input: ComposerBuildPhenotype): ComposerBuildPhenotype {
  if (!input || input.version !== COMPOSER_BUILD_PHENOTYPE_VERSION || input.units !== 'm') throw new Error('Unsupported Composer build phenotype');
  const finite = (v: number, lo: number, hi: number, label: string) => {if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`Invalid Composer phenotype ${label}`);};
  const d = input.dimensions;
  if (!d || !input.identity || !input.motion || !input.coatFrame) throw new Error('Incomplete Composer build phenotype');
  for (const key of ['bodyLength','torsoWidth','torsoHeight','legReach','stanceWidth','neckLength','headLength','headWidth','footLength','footWidth'] as const) finite(d[key], .001, 20, key);
  for (const key of ['tailLength','hornLength','earLength','trunkLength','wingSpan'] as const) finite(d[key], 0, 30, key);
  finite(d.upperLegFraction, .1, .9, 'upperLegFraction'); finite(d.neckElevation, -Math.PI / 2, Math.PI / 2, 'neckElevation');
  finite(input.identity.maturity, 0, 1, 'maturity');
  if (!['none','female','male'].includes(input.identity.sex)) throw new Error('Invalid Composer phenotype sex');
  for (const key of ['individualId','speciesId','appearanceKey'] as const) {const value = input.identity[key]; if (value !== undefined && (typeof value !== 'string' || !value || value.length > 2048)) throw new Error(`Invalid Composer phenotype ${key}`);}
  finite(input.motion.walkSpeed, .001, 30, 'walkSpeed'); finite(input.motion.strideLength, .001, 20, 'strideLength');
  if(input.coatStage){if(input.coatStage.version!==FAUNA_JUVENILE_COAT_VERSION||!['adult','juvenile'].includes(input.coatStage.stage))throw new Error('Invalid Composer coat stage');finite(input.coatStage.maturity,0,1,'coat stage maturity');}
  finite(input.coatFrame.phase, -10, 10, 'coat phase'); finite(input.coatFrame.lateral, .01, 100, 'coat lateral'); finite(input.roughness, 0, 1, 'roughness');
  const c = input.coat;
  if (!c || c.version !== 'fauna-coat-1' || c.pattern === ('auto' as string) || !(COAT_PATTERNS as readonly string[]).includes(c.pattern) || !['accent','belly'].includes(c.markRole)) throw new Error('Invalid Composer resolved coat');
  if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff || !Number.isInteger(c.marks)) throw new Error('Invalid Composer resolved coat seed/marks');
  for (const [key, range] of Object.entries(COAT_GENOME_RANGES)) finite(c[key as keyof typeof COAT_GENOME_RANGES], range[0], range[1], `coat.${key}`);
  for (const role of COAT_ROLES) {const rgb = c.colours?.[role]; if (!Array.isArray(rgb) || rgb.length !== 3) throw new Error(`Invalid Composer coat role ${role}`); for (const x of rgb) finite(x, 0, 1, `coat.${role}`);}
  return structuredClone(input);
}

/** Resolved dimensions already include sex, age and individual variation. */
export function assertComposerResolvedRecipe(recipe: ComposerRecipe): void {
  if (recipe.layout !== 'quadruped') throw new Error('Composer phenotype-1 currently supports the inherited quadruped layout');
  if (recipe.maturity !== 1 || recipe.individualSeed !== 0 || recipe.variability !== 0 || recipe.dimorphism !== 0 || recipe.allometry !== 0 || recipe.condition !== 0 || recipe.sex !== 'auto')
    throw new Error('Resolved Composer phenotype requires neutral individual controls; edit resolved dimensions instead of applying growth twice');
}
