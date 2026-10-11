import {validateCreatureGenome, CREATURE_GENOME_VERSION, type CreatureGenome} from './planet-v1/creature-model.ts';
import {inheritedFaunaFamily, FAUNA_APPEARANCE_VERSION} from './planet-v1/fauna-appearance.ts';
import {COAT_CELLS_PER_BODY, srgbToLinear, type CoatGenome, type CoatRGB} from './fauna-coat-fields.ts';
import {COMPOSER_RECIPE_KEYS, normalizeComposerRecipe, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {COMPOSER_BUILD_PHENOTYPE_VERSION, cloneComposerBuildPhenotype, assertComposerResolvedRecipe, type ComposerBuildPhenotype} from './fauna-composer-phenotype.ts';
import {buildComposerSource, type ComposerSourceOptions} from './fauna-composer-source.ts';
import {createComposerCreature} from './fauna-composer.ts';
import type {ComposerPoseOptions} from './fauna-composer-rig.ts';
import {FAUNA_JUVENILE_COAT_VERSION} from './fauna-coat-juvenile.ts';

export {COMPOSER_BUILD_PHENOTYPE_VERSION, type ComposerBuildPhenotype} from './fauna-composer-phenotype.ts';
export {measurePlanetComposerSource} from './planet-composer-measure.ts';
export {PLANET_COMPOSER_IDENTITY_VERSION,planetComposerSourceIdentity,assertPlanetComposerSourceIdentity,type PlanetComposerSourceIdentity,type PlanetComposerSourceIdentityOptions} from './planet-composer-identity.ts';
export const PLANET_COMPOSER_DEFINITION_VERSION = 'planet-composer-definition-1';
export const PLANET_COMPOSER_SOURCE_VERSION = 'planet-composer-source-2';
export interface PlanetComposerIdentity {individualId?: string; speciesId?: string}
export interface PlanetComposerDefinition {
  schema: typeof PLANET_COMPOSER_DEFINITION_VERSION;
  kind: 'planet-composer';
  /** Provenance snapshot: this is never rewritten when the Composer recipe is edited. */
  genome: CreatureGenome;
  recipe: ComposerRecipe;
  phenotype: ComposerBuildPhenotype;
  ledger: {
    units: 'metres; radians for neckElevation; linear RGB for coat';
    sourceGenomeVersion: string;
    sourceAppearanceVersion: string | null;
    sourceMorphologyVersion: string | null;
    family: string;
    growth: 'already-resolved-no-additional-growth';
    coat: 'resolved-coat-exact' | 'legacy-colours-mapped';
    mappings: string[];
    recipeControlAdjustments: string[];
  };
}
export type PlanetComposerBuildOptions = Pick<ComposerSourceOptions, 'presentation' | 'debug'>;

function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {for (const v of Object.values(value)) frozen(v); Object.freeze(value);}
  return value;
}
function validGenome(input: CreatureGenome): CreatureGenome {
  if (!input || input.version !== CREATURE_GENOME_VERSION) throw new Error('Unsupported planet genome for Composer migration');
  const errors = validateCreatureGenome(input); if (errors.length) throw new Error(`Planet Composer genome: ${errors.join('; ')}`);
  return structuredClone(input);
}
const linear = (hex: string): CoatRGB => [1,3,5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as CoatRGB;
const blend = (a: CoatRGB, b: CoatRGB, k: number): CoatRGB => a.map((v, i) => v + (b[i]! - v) * k) as CoatRGB;
function sourceCoat(g: CreatureGenome): CoatGenome {
  if (g.appearance?.version === FAUNA_APPEARANCE_VERSION) return structuredClone(g.appearance.coat);
  const base = linear(g.appearance?.palette.base ?? g.color), accent = linear(g.appearance?.palette.marking ?? g.accentColor);
  const belly = g.appearance?.palette.belly ? linear(g.appearance.palette.belly) : blend(base, [1,1,1], .24);
  // Legacy inputs contain two colours, not a pigment-family seed. Explicit role
  // conversion avoids pretending a new palette draw preserves those colours.
  return {version: 'fauna-coat-1', pattern: g.appearance?.pattern ?? g.pattern, marks: 0, scale: 1, contrast: 1, countershade: .6, bellyLine: -.45,
    colours: {base, accent, belly, skin: blend(base, accent, .35), keratin: [.035,.03,.026], horn: accent.slice() as CoatRGB, plate: blend(base, accent, .3), eye: [.018,.012,.008]},
    markRole: 'accent', seed: g.appearance?.markingSeed ?? 0, warp: .5, threshold: 0, juvenileSpots: 0, greying: 0};
}

/** Pure, deterministic migration of the already resolved planet phenotype.
 * No preset, seed draw, species generator or second maturity derivation occurs. */
export function planetComposerDefinition(input: CreatureGenome, identity: PlanetComposerIdentity = {}): PlanetComposerDefinition {
  const g = validGenome(input), family = inheritedFaunaFamily(g), coat = sourceCoat(g), a = g.appearance;
  const head: ComposerRecipe['head'] = family === 'proboscidean' ? 'proboscis' : 'muzzle';
  const legs: ComposerRecipe['legs'] = family === 'ungulate' || family === 'long-neck' ? 'unguligrade' : family === 'proboscidean' ? 'pillar' : family === 'padded' ? 'plantigrade' : 'digitigrade';
  const feet: ComposerRecipe['feet'] = g.morphology?.footType === 'hoof' || (!g.morphology && (family === 'ungulate' || family === 'long-neck')) ? 'hoof' : g.morphology?.footType === 'broad-pad' || family === 'padded' || family === 'proboscidean' ? 'pad' : 'paw';
  const torso: ComposerRecipe['torso'] = g.torsoWidth > g.torsoLength * .4 ? 'barrel' : g.torsoHeight > g.torsoWidth * 1.4 ? 'deep-chest' : 'slim';
  const neckForward = g.neckLength * .35, neckRise = g.neckRise + g.neckLength * .66;
  const neckLength = Math.hypot(neckForward, neckRise), trunkLength = g.morphology?.trunkLength ?? (head === 'proboscis' ? Math.min(1.45, g.headLength * 1.9) : 0);
  const wingSpan = g.morphology?.wingSpan ?? 0;
  const raw = {version: 4, layout: 'quadruped', legPairs: 2, torso, bodyLength: g.torsoLength, girth: 1, posture: 0,
    neckLength: neckLength / (.9 * g.torsoLength), head, headSize: 1, snoutLength: .6,
    horns: g.hornLength > .01 && head !== 'proboscis' ? 'paired' : 'none', legs, legLength: g.legLength / g.torsoLength, feet,
    arms: 'none', armLength: .6, hands: 'hand', tail: g.tailLength > 0 ? (family === 'cursorial' ? 'reptile' : 'tufted') : 'none', tailLength: g.tailLength / g.torsoLength,
    armor: g.armor > .05 && family !== 'proboscidean' ? 'osteoderms' : 'none', wings: wingSpan > 0 ? 'membrane' : 'none', wingSpan: wingSpan ? wingSpan / g.torsoLength : 2,
    trunk: head === 'proboscis' ? 'trunk' : 'none', trunkLength: trunkLength ? trunkLength / (1.45 * g.headLength) : .8,
    palette: a?.lineage?.family ?? 'earth', colorSeed: 0, pattern: coat.pattern, marks: coat.marks, patternScale: coat.scale, patternContrast: coat.contrast, countershade: coat.countershade,
    dimorphism: 0, variability: 0, allometry: 0, individualSeed: 0, sex: 'auto', maturity: 1, condition: 0, eyes: 'auto', iris: 'auto', eyeRules: 2};
  const normalized = normalizeComposerRecipe(raw), recipe = normalized.recipe;
  const phase = (coat.pattern === 'stripes' || coat.pattern === 'bands') ? (a?.individual.coatPhase ?? 0) / (COAT_CELLS_PER_BODY[coat.pattern] * coat.scale) : 0;
  const phenotype = cloneComposerBuildPhenotype({version: COMPOSER_BUILD_PHENOTYPE_VERSION, units: 'm',
    identity: {...identity, ...(a?.individualKey ? {appearanceKey: a.individualKey} : {}), maturity: a?.growth.maturity ?? 1, sex: a?.individual.sex ?? 'none'},
    dimensions: {bodyLength: g.torsoLength, torsoWidth: g.torsoWidth, torsoHeight: g.torsoHeight, legReach: g.legLength, upperLegFraction: g.upperLegFraction, stanceWidth: g.stanceWidth,
      neckLength, neckElevation: Math.atan2(neckRise, neckForward), headLength: g.headLength, headWidth: g.headWidth, tailLength: g.tailLength,
      footLength: g.footLength, footWidth: g.footWidth, hornLength: g.hornLength, earLength: g.earLength, trunkLength, wingSpan},
    coat,...(a?.version===FAUNA_APPEARANCE_VERSION?{coatStage:{version:FAUNA_JUVENILE_COAT_VERSION,stage:a.growth.stage,maturity:a.growth.maturity}}:{}),coatFrame: {phase, lateral: a?.growth.lateral ?? 1}, roughness: a?.roughness ?? .82, motion: {walkSpeed: g.walkSpeed, strideLength: g.strideLength}});
  const recipeControlAdjustments = COMPOSER_RECIPE_KEYS.filter(k => k in raw && recipe[k] !== raw[k as keyof typeof raw]).map(k => `${k}: control ${String(raw[k as keyof typeof raw])} → ${String(recipe[k])}; resolved phenotype remains exact`);
  return frozen({schema: PLANET_COMPOSER_DEFINITION_VERSION, kind: 'planet-composer', genome: g, recipe, phenotype,
    ledger: {units: 'metres; radians for neckElevation; linear RGB for coat', sourceGenomeVersion: g.version, sourceAppearanceVersion: a?.version ?? null, sourceMorphologyVersion: g.morphology?.version ?? null,
      family, growth: 'already-resolved-no-additional-growth', coat: a?.version === FAUNA_APPEARANCE_VERSION ? 'resolved-coat-exact' : 'legacy-colours-mapped', recipeControlAdjustments,
      mappings: [
        'Inherited genome is quadrupedal; categorical anatomy is mapped field by field, without selecting a Composer preset.',
        'Torso width/height and head width are full diameters; Composer graph sections use half-extents. Surface lobes and shading remain Composer geometry.',
        'Neck centreline preserves the genome forward=.35×neckLength and rise=neckRise+.66×neckLength vector; stored neckLength is its Euclidean length.',
        'Leg reach is nominal articulated length; upperLegFraction divides upper/lower after any metapodial share. The Composer ground/reach solver may lengthen limbs and shorten stride; graph constraints disclose this.',
        'Stance width is the exact left/right sole-centre separation. Foot length/width are nominal profile dimensions; generated/deformed bounds are separate measurements.',
        'Head, muzzle, ears, horns, armor and tail surface shapes use Composer profiles; armor amount selects presence, not the old plate-area fraction.',
        'Derived profile mappings: cranium height = headWidth/(2×face.craniumWidth); snout length = headLength×recipe.snoutLength×face.snout (initial recipe.snoutLength .6); foot height = .42×footWidth; neck bone count = round(1+3.4×recipe.neckLength), clamped to 1..6. graph.phenotypeFit exposes numeric derived ratios.',
        'Resolved coat RGB, seed, pattern and marks are copied exactly. Coat coordinates use the Composer torso frame plus the existing phase/lateral growth offsets; surface coverage changes with anatomy.',
        'Source runSpeed and mutation log remain in the genome; Composer walking uses source walkSpeed with reach-fitted stride and cadence. No new species/individual identity is generated.',
        'phenotype.motion.strideLength is metres per full gait cycle. Composer stance sweep = duty×cycleLength; period = cycleLength/walkSpeed. graph.phenotypeFit records requested and fitted cycle, sweep, period and limb reaches.',
        'Explicit coatStage retains planetary fawn rows and developing stockings in both vertex fallback and all crisp-colour layers, with a layout sized for the generated Composer torso cells. Shared shader interpolates those layers; spot placement follows the new anatomy.',
      ]}});
}

/** Validate imported/edited definitions without losing source provenance or
 * rounding their phenotype to the authoring recipe's slider increments. */
export function parsePlanetComposerDefinition(input: unknown): PlanetComposerDefinition {
  const value = typeof input === 'string' ? JSON.parse(input) as PlanetComposerDefinition : input as PlanetComposerDefinition;
  if (!value || value.schema !== PLANET_COMPOSER_DEFINITION_VERSION || value.kind !== 'planet-composer') throw new Error('Unsupported planet Composer definition');
  const genome = validGenome(value.genome), phenotype = cloneComposerBuildPhenotype(value.phenotype), normalized = normalizeComposerRecipe(value.recipe);
  if (!value.recipe || value.recipe.version !== 4 || COMPOSER_RECIPE_KEYS.some(k => normalized.recipe[k] !== value.recipe[k])) throw new Error('Planet Composer recipe is not canonical v4; normalize edits explicitly');
  assertComposerResolvedRecipe(normalized.recipe);
  if (!value.ledger || value.ledger.growth !== 'already-resolved-no-additional-growth' || !Array.isArray(value.ledger.mappings)) throw new Error('Planet Composer definition is missing its mapping ledger');
  return frozen({...structuredClone(value), genome, phenotype, recipe: normalized.recipe});
}
const canonicalCache=new WeakMap<PlanetComposerDefinition,string>();
function sortedJson(value:unknown):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>sortedJson(v===undefined?null:v)).join(',')+']';
  return '{'+Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>JSON.stringify(k)+':'+sortedJson((value as Record<string,unknown>)[k])).join(',')+'}';
}
const deeplyFrozen=(value:unknown):boolean=>!value||typeof value!=='object'||Object.isFrozen(value)&&Object.values(value).every(deeplyFrozen);
export function serializePlanetComposerDefinition(input: PlanetComposerDefinition): string {
  const previous=canonicalCache.get(input);if(previous!==undefined)return previous;
  const canonical=sortedJson(parsePlanetComposerDefinition(input));if(deeplyFrozen(input))canonicalCache.set(input,canonical);return canonical;
}
/** Normal world members must bring their actual identity and resolved appearance.
 * Debug inputs can use planetComposerDefinition, but are never relabelled as a
 * real member by this wrapper. No source payload fields are rewritten. */
export function planetComposerWorldDefinition(input:CreatureGenome,identity:Required<PlanetComposerIdentity>):PlanetComposerDefinition{
  if(!identity||![identity.individualId,identity.speciesId].every(x=>typeof x==='string'&&x.trim().length>0&&x.length<=2048))throw new Error('World Composer animals require actual individualId and speciesId');
  if(input.appearance?.version!==FAUNA_APPEARANCE_VERSION)throw new Error('World Composer animals require a resolved inherited appearance');
  return planetComposerDefinition(input,identity);
}
const definitionOf = (input: CreatureGenome | PlanetComposerDefinition) => 'schema' in input ? parsePlanetComposerDefinition(input) : planetComposerDefinition(input);

/** Worker-safe shared source: no actor/material is allocated. */
export function buildPlanetComposerSource(input: CreatureGenome | PlanetComposerDefinition, options: PlanetComposerBuildOptions = {}) {
  const definition = definitionOf(input), source = buildComposerSource(definition.recipe, {...options, presentation: options.presentation ?? 'realism-1', phenotype: definition.phenotype});
  return {...source, definition, sourceVersion: PLANET_COMPOSER_SOURCE_VERSION};
}
export type PlanetComposerSource = ReturnType<typeof buildPlanetComposerSource>;
export function createPlanetComposerAnimal(input: CreatureGenome | PlanetComposerDefinition, options: PlanetComposerBuildOptions & ComposerPoseOptions = {}) {
  const definition = definitionOf(input), creature = createComposerCreature(definition.recipe, {...options, presentation: options.presentation ?? 'realism-1', phenotype: definition.phenotype});
  return Object.assign(creature, {definition, sourceVersion: PLANET_COMPOSER_SOURCE_VERSION});
}
