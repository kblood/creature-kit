/** Coherent random species for the modular creature composer.
 *
 * randomComposerRecipe (fauna-composer-recipe.ts) draws every part independently:
 * a useful stress test, but most results are chimeras (268 of 300 trigger a
 * compatibility adjustment). randomCoherentComposerRecipe instead draws an animal
 * from one of twelve archetype priors (each a partial recipe with ranges and
 * weighted choice tables), with correlated size / limb / neck / robustness latents,
 * anatomical exclusions, and a static balance check on the built rig. Coat
 * pattern, marks and pigment family come from archetype-weighted tables.
 *
 * Determinism: stream 'composer-species-v1/<seed>'; a rejected draw resamples on
 * '<seed>/r1' .. '<seed>/r8'. Every draw order below is append-only.
 *
 * fauna-composer-face-1 changes only the post-draw rewrites: a drawn trunk on a muzzle
 * becomes the proboscis face (a trunk anywhere else is dropped), the horns become the kind
 * the face builds, and eyes and iris are 'auto'. No draw is added or moved.
 *
 * fauna-composer-face-2 (eye catalogue EC1) adds one more post-draw rewrite: the eye flavour. Some archetypes get an
 * explicit eye kind (raptor or owl birds, gecko, chameleon or frog lizards, nocturnal primates, stalk-eyed worms) from
 * a pure hash of the attempt's stream name ('composer-species-eyes-1/<stream>'), never a rand() draw, and every
 * species carries eyeRules 2. The stream is byte-identical; species keys (herds) ignore eyes. */
import * as THREE from 'three';
import {COMPOSER_PRESET_IDS, COMPOSER_RANGES, COMPOSER_V2_DEFAULTS, COMPOSER_V3_DEFAULTS, COMPOSER_V3_RANGE_KEYS, COMPOSER_V4_DEFAULTS, COMPOSER_RECIPE_VERSION, composerHash, composerPreset, composerRandom, composerSpeciesEqual, normalizeComposerRecipe,
  type ComposerLayout, type ComposerNumberKey, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {buildComposerGraph, type ComposerGraph} from './fauna-composer-rig.ts';
import {COAT_MARK_BITS, type CoatPaletteId, type CoatPattern, type CoatMarkName} from './fauna-coat-vocab.ts';
import {COMPOSER_EYE_RULES_CURRENT, composerHeadgearBuild, type ComposerEyeType} from './fauna-composer-face.ts';

export const COMPOSER_SPECIES_GENERATOR_VERSION = 'composer-species-v1';
export const COMPOSER_ARCHETYPES = ['ungulate-grazer', 'giraffid', 'pachyderm', 'cursorial-carnivore', 'theropod', 'ratite', 'bird', 'sprawler-lizard', 'tortoise', 'primate', 'myriapod', 'worm'] as const;
export type ComposerArchetype = typeof COMPOSER_ARCHETYPES[number];
/** Resampling attempts after the first draw. */
export const COMPOSER_SPECIES_MAX_RESAMPLES = 8;

type R = ComposerRecipe;
type Weighted<T> = readonly (readonly [T, number])[];
/** Numeric prior: [lo, hi] mapped from a unit-variance latent g as lo + (hi - lo) * clamp(0.5 + g / 4). */
type Span = readonly [number, number];
/** Latent loadings for a numeric field: the field's g = sum(load * latent) + residual own noise. */
type Loads = Partial<Record<'size' | 'limb' | 'neck' | 'robust', number>>;
interface Prior {
  weight: number;
  layout: ComposerLayout;
  legPairs?: Span;
  num: Partial<Record<ComposerNumberKey, Span>>;
  choice: {[K in 'torso' | 'head' | 'horns' | 'legs' | 'feet' | 'arms' | 'hands' | 'tail' | 'armor' | 'wings' | 'trunk']?: Weighted<R[K]>};
  palette: Weighted<CoatPaletteId>;
  pattern: Weighted<CoatPattern>;
  /** Independent probability of each mark. */
  marks: Partial<Record<CoatMarkName, number>>;
  coat: {scale: Span; contrast: Span; countershade: Span};
  dimorphism: Span;
}
/** How the shared latents load on numeric fields (the rest of each field's variance is its own noise).
 * neck loads on neck length and (half) on leg length; robust loads on girth (+) and head size (-0.3). */
const LOADS: Partial<Record<ComposerNumberKey, Loads>> = {
  bodyLength: {size: 0.95},
  neckLength: {neck: 0.85},
  legLength: {limb: 0.65, neck: 0.5, robust: -0.2},
  girth: {robust: 0.85},
  headSize: {robust: -0.3},
  armLength: {limb: 0.5},
  tailLength: {robust: -0.2},
};

const ungulateCoats: Weighted<CoatPaletteId> = [['tawny', 3], ['fawn', 3], ['dun', 2], ['rufous', 2], ['sable', 1], ['grey', 1], ['earth', 1]];
export const COMPOSER_ARCHETYPE_PRIORS: Readonly<Record<ComposerArchetype, Prior>> = {
  'ungulate-grazer': {weight: 1.5, layout: 'quadruped',
    num: {bodyLength: [0.8, 2.3], girth: [0.85, 1.25], posture: [0.1, 0.35], neckLength: [0.4, 0.8], headSize: [0.8, 1.05], snoutLength: [0.65, 1.0], legLength: [0.95, 1.4], tailLength: [0.2, 0.55]},
    choice: {torso: [['slim', 3], ['deep-chest', 2], ['barrel', 2]], head: [['muzzle', 1]], horns: [['paired', 6], ['none', 4]], legs: [['unguligrade', 1]], feet: [['hoof', 1]],
      arms: [['none', 1]], hands: [['hand', 1]], tail: [['tufted', 3], ['stub', 2]], armor: [['none', 1]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: ungulateCoats, pattern: [['plain', 3], ['saddle', 2], ['dorsal-stripe', 2], ['spots', 1], ['roan', 0.6], ['stripes', 0.4], ['piebald', 0.3]],
    marks: {socks: 0.25, blaze: 0.2, 'rump-patch': 0.35, 'tail-tip': 0.3, 'ear-tips': 0.2, 'juvenile-spots': 0.3},
    coat: {scale: [0.8, 1.3], contrast: [0.6, 1.1], countershade: [0.6, 0.95]}, dimorphism: [0.3, 0.75]},
  giraffid: {weight: 0.6, layout: 'quadruped',
    num: {bodyLength: [1.2, 1.8], girth: [0.85, 1.0], posture: [0.5, 0.8], neckLength: [1.05, 1.5], headSize: [0.8, 0.95], snoutLength: [0.7, 0.9], legLength: [1.25, 1.6], tailLength: [0.5, 0.7]},
    choice: {torso: [['slim', 2], ['deep-chest', 1]], head: [['muzzle', 1]], horns: [['ossicones', 1]], legs: [['unguligrade', 1]], feet: [['hoof', 1]], arms: [['none', 1]], hands: [['hand', 1]],
      tail: [['tufted', 1]], armor: [['none', 1]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['savanna', 3], ['ochre', 2], ['tawny', 1], ['rufous', 1]], pattern: [['reticulated', 4], ['spots', 2], ['rosettes', 1], ['plain', 0.5]],
    marks: {socks: 0.3, 'tail-tip': 0.6, 'ear-tips': 0.2}, coat: {scale: [0.8, 1.2], contrast: [0.8, 1.2], countershade: [0.6, 0.9]}, dimorphism: [0.2, 0.4]},
  pachyderm: {weight: 0.8, layout: 'quadruped',
    num: {bodyLength: [1.6, 3.2], girth: [1.25, 1.6], posture: [0, 0.2], neckLength: [0.1, 0.3], headSize: [1.0, 1.3], snoutLength: [0.4, 0.8], legLength: [0.5, 0.8], tailLength: [0.2, 0.35], trunkLength: [0.6, 1.2]},
    choice: {torso: [['barrel', 3], ['deep-chest', 1]], head: [['muzzle', 1]], horns: [['nasal', 4], ['none', 3], ['paired', 1]], legs: [['pillar', 1]], feet: [['pad', 3], ['hoof', 1]],
      arms: [['none', 1]], hands: [['hand', 1]], tail: [['tufted', 3], ['stub', 1]], armor: [['none', 3], ['osteoderms', 1]], wings: [['none', 1]], trunk: [['none', 3], ['trunk', 2]]},
    palette: [['grey', 3], ['slate', 3], ['dun', 1], ['sable', 1]], pattern: [['plain', 6], ['dapple', 1]], marks: {}, coat: {scale: [0.9, 1.2], contrast: [0.3, 0.7], countershade: [0.1, 0.4]}, dimorphism: [0.2, 0.5]},
  'cursorial-carnivore': {weight: 1.3, layout: 'quadruped',
    num: {bodyLength: [0.5, 1.6], girth: [0.8, 1.1], posture: [0.05, 0.3], neckLength: [0.3, 0.6], headSize: [0.9, 1.2], snoutLength: [0.4, 1.0], legLength: [0.75, 1.15], tailLength: [0.5, 1.1]},
    choice: {torso: [['deep-chest', 3], ['slim', 2]], head: [['muzzle', 1]], horns: [['none', 1]], legs: [['digitigrade', 1]], feet: [['paw', 1]], arms: [['none', 1]], hands: [['hand', 1]],
      tail: [['tufted', 3], ['reptile', 0.4]], armor: [['none', 1]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['tawny', 3], ['rufous', 2], ['grey', 2], ['sable', 1], ['dun', 1], ['ochre', 1]], pattern: [['plain', 3], ['spots', 2], ['rosettes', 1.5], ['stripes', 1], ['saddle', 1.5], ['brindle', 0.8]],
    marks: {mask: 0.3, 'tail-tip': 0.35, 'ear-tips': 0.3, socks: 0.2, 'juvenile-spots': 0.15}, coat: {scale: [0.8, 1.4], contrast: [0.7, 1.2], countershade: [0.6, 0.95]}, dimorphism: [0.1, 0.4]},
  theropod: {weight: 1, layout: 'biped',
    num: {bodyLength: [0.8, 3.2], girth: [0.9, 1.2], posture: [0.2, 0.45], neckLength: [0.25, 0.5], headSize: [0.8, 1.15], snoutLength: [0.7, 1.15], legLength: [1.0, 1.4], armLength: [0.3, 0.6], tailLength: [1.4, 2.0]},
    choice: {torso: [['deep-chest', 3], ['slim', 1], ['barrel', 1]], head: [['jaws', 5], ['beak', 1]], horns: [['none', 4], ['crest', 2], ['nasal', 1]], legs: [['digitigrade', 1]], feet: [['claw', 1]],
      arms: [['small', 3], ['grasping', 1]], hands: [['claw', 1]], tail: [['reptile', 1]], armor: [['none', 4], ['osteoderms', 1], ['plates', 0.6]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['reptile', 3], ['olive', 2], ['ochre', 1], ['grey', 1], ['rufous', 1], ['sable', 0.5]], pattern: [['bands', 3], ['stripes', 2], ['dapple', 1], ['plain', 1], ['spots', 1]],
    marks: {'tail-rings': 0.3, mask: 0.2}, coat: {scale: [0.8, 1.5], contrast: [0.6, 1.2], countershade: [0.6, 0.95]}, dimorphism: [0, 0.3]},
  ratite: {weight: 0.8, layout: 'biped',
    num: {bodyLength: [0.6, 1.2], girth: [1.0, 1.25], posture: [0.4, 0.55], neckLength: [0.9, 1.5], headSize: [0.7, 0.9], snoutLength: [0.4, 0.6], legLength: [1.4, 1.8], tailLength: [0.3, 0.5], wingSpan: [1.0, 1.4]},
    choice: {torso: [['barrel', 1]], head: [['beak', 1]], horns: [['none', 3], ['crest', 1]], legs: [['digitigrade', 1]], feet: [['claw', 1]], arms: [['none', 1]], hands: [['hand', 1]],
      tail: [['feather-fan', 4], ['stub', 1]], armor: [['none', 1]], wings: [['none', 7], ['feathered', 3]], trunk: [['none', 1]]},
    palette: [['ink', 2], ['sable', 2], ['grey', 2], ['dun', 2], ['fawn', 1]], pattern: [['plain', 5], ['piebald', 0.6], ['dapple', 0.6]], marks: {socks: 0.2},
    coat: {scale: [0.9, 1.2], contrast: [0.5, 1.0], countershade: [0.4, 0.8]}, dimorphism: [0.4, 0.85]},
  bird: {weight: 0.8, layout: 'biped',
    num: {bodyLength: [0.12, 0.5], girth: [1.05, 1.3], posture: [0.35, 0.5], neckLength: [0.3, 0.55], headSize: [0.85, 1.15], snoutLength: [0.3, 0.8], legLength: [0.6, 1.0], tailLength: [0.8, 1.2], wingSpan: [2.4, 3.6]},
    choice: {torso: [['barrel', 1]], head: [['beak', 1]], horns: [['none', 6], ['crest', 1]], legs: [['digitigrade', 1]], feet: [['claw', 1]], arms: [['none', 1]], hands: [['hand', 1]],
      tail: [['feather-fan', 1]], armor: [['none', 1]], wings: [['feathered', 1]], trunk: [['none', 1]]},
    palette: [['plumage', 2], ['rufous', 1], ['grey', 2], ['olive', 1], ['ink', 1], ['fawn', 1]], pattern: [['plain', 4], ['bands', 1], ['dapple', 1]], marks: {mask: 0.25},
    coat: {scale: [0.8, 1.3], contrast: [0.6, 1.2], countershade: [0.6, 0.95]}, dimorphism: [0.2, 0.8]},
  'sprawler-lizard': {weight: 1.2, layout: 'sprawled',
    num: {bodyLength: [0.25, 1.5], girth: [0.85, 1.15], neckLength: [0.15, 0.4], headSize: [0.9, 1.3], snoutLength: [0.5, 1.0], legLength: [0.35, 0.6], tailLength: [0.9, 1.8]},
    choice: {torso: [['flat', 2], ['slim', 2]], head: [['jaws', 4], ['blunt', 1]], horns: [['none', 6], ['crest', 1], ['paired', 0.5]], legs: [['plantigrade', 2], ['digitigrade', 1]], feet: [['claw', 3], ['hand', 1]],
      arms: [['none', 1]], hands: [['hand', 1]], tail: [['reptile', 1]], armor: [['none', 3], ['osteoderms', 1.2], ['plates', 0.4]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['reptile', 3], ['olive', 2], ['ochre', 1], ['dun', 1], ['grey', 1]], pattern: [['bands', 3], ['spots', 2], ['dorsal-stripe', 1.5], ['dapple', 1], ['plain', 1]],
    marks: {'tail-rings': 0.35}, coat: {scale: [0.8, 1.5], contrast: [0.6, 1.2], countershade: [0.6, 0.95]}, dimorphism: [0, 0.3]},
  tortoise: {weight: 0.8, layout: 'sprawled',
    num: {bodyLength: [0.3, 1.1], girth: [1.0, 1.3], neckLength: [0.25, 0.5], headSize: [0.8, 1.0], snoutLength: [0.2, 0.35], legLength: [0.36, 0.5], tailLength: [0.15, 0.3]},
    choice: {torso: [['flat', 1]], head: [['beak', 1]], horns: [['none', 1]], legs: [['pillar', 1]], feet: [['pad', 1]], arms: [['none', 1]], hands: [['hand', 1]],
      tail: [['stub', 1]], armor: [['dome', 1]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['reptile', 2], ['olive', 2], ['ochre', 2], ['sable', 1], ['dun', 1]], pattern: [['plain', 2], ['reticulated', 2], ['spots', 1]], marks: {},
    coat: {scale: [0.8, 1.3], contrast: [0.5, 1.0], countershade: [0.4, 0.8]}, dimorphism: [0, 0.2]},
  primate: {weight: 0.9, layout: 'biped',
    num: {bodyLength: [0.4, 0.9], girth: [1.0, 1.25], posture: [0.72, 0.95], neckLength: [0.05, 0.2], headSize: [1.0, 1.2], snoutLength: [0.2, 0.6], legLength: [0.9, 1.2], armLength: [1.0, 1.3], tailLength: [0.5, 0.95]},
    choice: {torso: [['deep-chest', 1]], head: [['flat-face', 3], ['muzzle', 1]], horns: [['none', 1]], legs: [['plantigrade', 1]], feet: [['hand', 1]], arms: [['grasping', 1]], hands: [['hand', 1]],
      tail: [['none', 7], ['tufted', 3]], armor: [['none', 1]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['ink', 2], ['sable', 2], ['rufous', 2], ['grey', 2], ['tawny', 1]], pattern: [['plain', 5], ['saddle', 1]], marks: {mask: 0.3, 'ear-tips': 0.15},
    coat: {scale: [0.9, 1.2], contrast: [0.4, 0.9], countershade: [0.3, 0.7]}, dimorphism: [0.3, 0.7]},
  myriapod: {weight: 0.9, layout: 'many-legged', legPairs: [6, 12],
    num: {bodyLength: [0.3, 1.4], girth: [0.8, 1.2], neckLength: [0, 0.1], headSize: [0.9, 1.1], snoutLength: [0.2, 0.4], legLength: [0.15, 0.35]},
    choice: {torso: [['segmented', 1]], head: [['mandibles', 1]], horns: [['none', 1]], legs: [['arthropod', 1]], feet: [['spike', 3], ['claw', 1]], arms: [['none', 1]], hands: [['hand', 1]],
      tail: [['none', 1]], armor: [['bands', 3], ['none', 1]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['ink', 2], ['rufous', 2], ['ochre', 1], ['sable', 1], ['olive', 1]], pattern: [['bands', 3], ['plain', 2]], marks: {},
    coat: {scale: [0.8, 1.3], contrast: [0.5, 1.2], countershade: [0.3, 0.7]}, dimorphism: [0, 0]},
  worm: {weight: 0.5, layout: 'limbless',
    num: {bodyLength: [0.3, 2.0], girth: [0.8, 1.2], neckLength: [0, 0], headSize: [0.9, 1.1], snoutLength: [0.1, 0.3], legLength: [0.2, 0.4]},
    choice: {torso: [['annulated', 1]], head: [['blunt', 1]], horns: [['none', 1]], legs: [['pillar', 1]], feet: [['pad', 1]], arms: [['none', 1]], hands: [['hand', 1]],
      tail: [['none', 1]], armor: [['none', 1]], wings: [['none', 1]], trunk: [['none', 1]]},
    palette: [['earth', 2], ['rufous', 2], ['dun', 1], ['grey', 1], ['fawn', 1]], pattern: [['plain', 3], ['bands', 2], ['dorsal-stripe', 1]], marks: {},
    coat: {scale: [0.8, 1.3], contrast: [0.3, 0.8], countershade: [0.2, 0.6]}, dimorphism: [0, 0]},
};

/** Eye flavour per archetype (eye catalogue v2): weighted explicit kinds, 'auto' = the anatomy rules. Archetypes not
 * listed always take 'auto'. The sprawler-lizard table applies to a jaws face only; its frog weight is 1 only with a
 * short snout (snoutLength < .6). */
export const COMPOSER_SPECIES_EYE_FLAVOUR: Readonly<Partial<Record<ComposerArchetype, Weighted<ComposerEyeType>>>> = Object.freeze({
  bird: [['auto', 5], ['raptor', 3], ['owl', 2]],
  theropod: [['auto', 3], ['raptor', 1]],
  'sprawler-lizard': [['auto', 4], ['gecko', 2], ['chameleon', 1], ['frog', 1]],
  primate: [['auto', 4], ['nocturnal', 1]],
  worm: [['auto', 3], ['stalk', 1]],
});
/** The coherent eye flavour of one attempt's draw: a pure hash of the attempt's stream name over the archetype's
 * weighted table. No rand() draw, so the 'composer-species-v1/' stream is untouched. */
export function composerSpeciesEyeFlavour(stream: string, archetype: ComposerArchetype, r: Pick<ComposerRecipe, 'head' | 'snoutLength'>): ComposerEyeType {
  let table = COMPOSER_SPECIES_EYE_FLAVOUR[archetype];
  if (!table || (archetype === 'sprawler-lizard' && r.head !== 'jaws')) return 'auto';
  if (archetype === 'sprawler-lizard' && !(r.snoutLength < 0.6)) table = table.filter(([kind]) => kind !== 'frog');
  const total = table.reduce((a, [, w]) => a + w, 0);
  let x = (composerHash(`composer-species-eyes-1/${stream}`) / 4294967296) * total;
  for (const [kind, w] of table) { if (x < w) return kind; x -= w; }
  return table[table.length - 1]![0];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const roundStep = (value: number, step: number) => step >= 1 ? Math.round(value) : Math.round(value / step) * step;
const fix = (value: number) => Number(value.toFixed(4));
const numberIn = (key: ComposerNumberKey, value: number) => { const [min, max, step] = COMPOSER_RANGES[key]; return fix(clamp(roundStep(value, step), min, max)); };

/** One archetype draw. Fixed, append-only draw order. */
function drawSpecies(stream: string, archetype: ComposerArchetype | undefined): {recipe: ComposerRecipe; archetype: ComposerArchetype} {
  const rand = composerRandom(stream);
  const pickW = <T>(table: Weighted<T>): T => { const total = table.reduce((a, [, w]) => a + w, 0); let x = rand() * total; for (const [v, w] of table) { x -= w; if (x <= 0) return v; } return table[table.length - 1]![0]; };
  const z = () => clamp((rand() + rand() + rand() - 1.5) / 0.5, -2, 2);
  const kind = pickW(COMPOSER_ARCHETYPES.map(a => [a, COMPOSER_ARCHETYPE_PRIORS[a].weight] as const));
  const a = archetype ?? kind, p = COMPOSER_ARCHETYPE_PRIORS[a];
  const latent = {size: z(), limb: z(), neck: z(), robust: z()};
  const r: ComposerRecipe = {...composerPreset('giraffe'), ...COMPOSER_V2_DEFAULTS, ...COMPOSER_V3_DEFAULTS, ...COMPOSER_V4_DEFAULTS, version: COMPOSER_RECIPE_VERSION, layout: p.layout};
  const out = r as unknown as Record<string, unknown>;
  // numeric fields in the frozen v3 COMPOSER_RANGES order, one own latent each (eyeRules, appended in v4, is never drawn)
  for (const key of COMPOSER_V3_RANGE_KEYS as readonly ComposerNumberKey[]) {
    const own = z(), span = p.num[key];
    if (!span) continue;
    const loads = LOADS[key] ?? {};
    let g = 0, shared = 0;
    for (const [name, w] of Object.entries(loads) as [keyof typeof latent, number][]) { g += w * latent[name]; shared += w * w; }
    g = clamp(g + Math.sqrt(Math.max(0, 1 - shared)) * own, -2, 2);
    // body length is drawn log-uniformly (sizes span an order of magnitude)
    const t = clamp(0.5 + g / 4, 0, 1);
    out[key] = numberIn(key, key === 'bodyLength' ? span[0] * (span[1] / span[0]) ** t : span[0] + (span[1] - span[0]) * t);
  }
  const pairs = p.legPairs ? Math.round(p.legPairs[0] + (p.legPairs[1] - p.legPairs[0]) * rand()) : p.layout === 'biped' ? 1 : p.layout === 'limbless' ? 0 : 2;
  r.legPairs = pairs;
  const choice = p.choice as Record<string, Weighted<string>>;
  for (const key of ['torso', 'head', 'horns', 'legs', 'feet', 'arms', 'hands', 'tail', 'armor', 'wings', 'trunk'] as const) {
    const table = choice[key];
    if (table) out[key] = pickW(table);
  }
  // robust bodies stand on pillar legs (quadrupeds only, never hooved grazers or carnivores)
  if (a === 'pachyderm' || (p.layout === 'sprawled' && latent.robust > 1.2 && r.legs !== 'pillar')) r.legs = 'pillar';
  r.palette = pickW(p.palette);
  r.pattern = pickW(p.pattern);
  let marks = 0;
  for (const [name, prob] of Object.entries(p.marks) as [CoatMarkName, number][]) if (rand() < prob) marks |= COAT_MARK_BITS[name];
  r.marks = marks;
  r.patternScale = numberIn('patternScale', p.coat.scale[0] + (p.coat.scale[1] - p.coat.scale[0]) * rand());
  r.patternContrast = numberIn('patternContrast', p.coat.contrast[0] + (p.coat.contrast[1] - p.coat.contrast[0]) * rand());
  r.countershade = numberIn('countershade', p.coat.countershade[0] + (p.coat.countershade[1] - p.coat.countershade[0]) * rand());
  r.dimorphism = numberIn('dimorphism', p.dimorphism[0] + (p.dimorphism[1] - p.dimorphism[0]) * rand());
  r.colorSeed = Math.floor(rand() * 10000);
  const wingRoll = rand();
  // ---- anatomical exclusions (every rule keeps the result coherent; none is a composerConstraints trigger)
  if (r.head === 'mandibles' && r.layout !== 'many-legged') r.head = 'jaws';
  // a trunk is a nose: it makes a muzzle the proboscis face, and is dropped on any other face
  if (r.trunk === 'trunk') { if (r.head === 'muzzle') r.head = 'proboscis'; else r.trunk = 'none'; }
  if (r.trunk === 'trunk' && r.head === 'proboscis' && r.horns === 'nasal') r.horns = 'none';
  if (r.tail === 'feather-fan' && !(r.layout === 'biped' && r.head === 'beak')) r.tail = 'stub';
  if (r.armor === 'dome' && r.layout !== 'sprawled' && r.layout !== 'quadruped') r.armor = 'none';
  if (r.armor === 'dome' && r.wings !== 'none') r.wings = 'none';
  if (r.layout === 'biped' && r.posture < 0.4 && r.tail !== 'none') r.tailLength = Math.max(r.tailLength, 0.8);
  if (r.layout === 'biped' && r.posture < 0.4 && r.tail === 'none') { r.tail = r.head === 'beak' ? 'feather-fan' : 'reptile'; r.tailLength = Math.max(r.tailLength, 0.8); }
  if (r.tail === 'none') r.tailLength = 0;
  if (r.arms === 'none') r.hands = 'hand';
  if (r.layout === 'limbless') { r.neckLength = 0; r.arms = 'none'; }
  if (r.layout === 'biped' && r.posture > 0.6 && r.tail !== 'none') r.tailLength = Math.min(r.tailLength, 1);
  if (r.wings !== 'none') r.wingSpan = Math.min(r.wingSpan, a === 'ratite' ? 1.4 : 3.6);
  if (r.wings === 'none') r.wingSpan = numberIn('wingSpan', 1 + wingRoll);
  // face rules: only headgear the face builds; the iris resolves automatically, the eyes too unless the archetype's
  // eye flavour (a pure hash, no draw) names a kind
  r.horns = composerHeadgearBuild(r).built;
  r.eyeRules = COMPOSER_EYE_RULES_CURRENT;
  r.eyes = composerSpeciesEyeFlavour(stream, a, r); r.iris = 'auto';
  r.variability = 1; r.allometry = 1; r.individualSeed = 0; r.sex = 'auto'; r.maturity = 1; r.condition = 0;
  return {recipe: normalizeComposerRecipe(r).recipe, archetype: a};
}

export interface ComposerBalance {
  /** Section-volume-weighted centre of mass (creature space, metres). */
  com: [number, number, number];
  /** Horizontal distance from the centre of mass to the rest-foot support polygon (0 inside). */
  distance: number;
  /** Allowed distance: 0.1 x bodyLength. */
  tolerance: number;
  pass: boolean;
  feet: number;
}
/** Static balance at rest: the centre of mass must lie over the rest-foot support polygon (convex hull of every
 * sole: rest contact, heel and toe of each foot bone, each widened by the sole half-width) expanded by 0.1 L.
 * Limbless bodies rest on their belly and always pass. */
export function composerStaticBalance(graph: ComposerGraph): ComposerBalance {
  let mass = 0; const com = new THREE.Vector3(), q = new THREE.Quaternion(), mid = new THREE.Vector3();
  for (const bone of graph.bones) {
    const a0 = Math.PI * bone.start.w * bone.start.h, a1 = Math.PI * bone.end.w * bone.end.h;
    const volume = bone.length * (a0 + a1 + Math.sqrt(a0 * a1)) / 3;
    q.fromArray(bone.restQuaternion);
    mid.set(bone.length / 2, (bone.start.yc + bone.end.yc) / 2, 0).applyQuaternion(q).add(new THREE.Vector3().fromArray(bone.restPosition));
    com.addScaledVector(mid, volume); mass += volume;
  }
  com.multiplyScalar(1 / Math.max(mass, 1e-12));
  const L = graph.recipe.bodyLength, tolerance = 0.1 * L;
  // Each foot contributes its sole: the rest contact plus the heel and toe of the foot bone, each widened by the sole half-width.
  const legs = graph.limbs.filter(l => l.kind === 'leg'), points: [number, number][] = [];
  const dir = new THREE.Vector3(), side = new THREE.Vector3();
  for (const limb of legs) {
    points.push([limb.rest[0], limb.rest[2]]);
    const foot = graph.bones[limb.bones[limb.bones.length - 1]!]!;
    q.fromArray(foot.restQuaternion);
    dir.set(1, 0, 0).applyQuaternion(q).setY(0); side.set(0, 0, 1).applyQuaternion(q).setY(0);
    if (dir.lengthSq() < 1e-12) continue;
    dir.normalize(); side.normalize().multiplyScalar(foot.start.w);
    const heel = new THREE.Vector3().fromArray(foot.restPosition), toe = heel.clone().addScaledVector(dir, foot.length);
    for (const c of [heel, toe]) for (const sgn of [-1, 1]) points.push([c.x + sgn * side.x, c.z + sgn * side.z]);
  }
  const distance = legs.length ? distanceToHull([com.x, com.z], points) : 0;
  return {com: [com.x, com.y, com.z], distance, tolerance, pass: distance <= tolerance + 1e-12, feet: legs.length};
}
/** Distance from p to the convex hull of points (0 when inside). Handles 1 or 2 points (point / segment). */
function distanceToHull(p: [number, number], points: [number, number][]): number {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 1e-15) lower.pop(); lower.push(q); }
  for (const q of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 1e-15) upper.pop(); upper.push(q); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const segDist = (a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
    const t = len > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len, 0, 1) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  if (hull.length <= 1) return Math.hypot(p[0] - pts[0]![0], p[1] - pts[0]![1]);
  if (hull.length === 2) return segDist(hull[0]!, hull[1]!);
  let inside = true, best = Infinity;
  for (let i = 0; i < hull.length; i++) { const a = hull[i]!, b = hull[(i + 1) % hull.length]!; if (cross(a, b, p) < 0) inside = false; best = Math.min(best, segDist(a, b)); }
  return inside ? 0 : best;
}

export interface CoherentComposerSpecies {
  recipe: ComposerRecipe; archetype: ComposerArchetype;
  /** 0 = first draw; 1..8 = resample suffix used. */
  attempt: number;
  balance: ComposerBalance;
}
/** Plausible random species with its archetype and balance report. If no draw within the resample
 * budget balances, the draw with the smallest balance violation is returned (balance.pass false). */
export function coherentComposerSpecies(seed: string, options: {archetype?: ComposerArchetype} = {}): CoherentComposerSpecies {
  const base = `${COMPOSER_SPECIES_GENERATOR_VERSION}/${String(seed).slice(0, 160)}`;
  let best: CoherentComposerSpecies | null = null, kind = options.archetype;
  for (let attempt = 0; attempt <= COMPOSER_SPECIES_MAX_RESAMPLES; attempt++) {
    // a resample redraws the animal but keeps the archetype of the first draw
    const {recipe, archetype} = drawSpecies(attempt ? `${base}/r${attempt}` : base, kind);
    kind = archetype;
    if (COMPOSER_PRESET_IDS.some(id => composerSpeciesEqual(composerPreset(id), recipe))) continue;
    const balance = composerStaticBalance(buildComposerGraph(recipe));
    const candidate = {recipe, archetype, attempt, balance};
    if (balance.pass) return candidate;
    if (!best || balance.distance - balance.tolerance < best.balance.distance - best.balance.tolerance) best = candidate;
  }
  return best!;
}
/** A coherent random species recipe (variability 1, allometry 1, individualSeed 0). */
export function randomCoherentComposerRecipe(seed: string): ComposerRecipe {
  return coherentComposerSpecies(seed).recipe;
}
