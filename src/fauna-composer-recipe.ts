import {COAT_PALETTE_IDS, COAT_PATTERNS, LEGACY_PALETTE_IDS, type CoatPaletteId, type CoatPattern} from './fauna-coat-vocab.ts';
import {COMPOSER_EYE_RULES_CURRENT, COMPOSER_EYE_TYPES, COMPOSER_IRIS, composerAutoEyeType, composerFaceConstraints, composerHeadgearBuild, migrateLegacyFace, resolveComposerEyes} from './fauna-composer-face.ts';
import {COMPOSER_EYE_KINDS} from './fauna-composer-eye-catalogue.ts';

/** Versioned, bounded recipe for the experimental modular creature composer.
 * Every part is chosen independently. The recipe never names an asset path:
 * all geometry is procedural, so a shared link cannot load arbitrary files.
 * Units are metres; the creature faces +X with +Y up.
 *
 * Version 2 appends coat keys (pattern .. countershade), species variation keys
 * (dimorphism, variability, allometry) and individual keys (individualSeed, sex,
 * maturity, condition). Version 1 text still decodes: its 26 fields are kept and
 * the new keys take neutral defaults, so a v1 animal builds exactly as before.
 *
 * Version 3 (fauna-composer-face-1) appends 'proboscis' to the face (head) choices and the
 * keys eyes and iris. The `trunk` key stays in its encoded position but is DERIVED: a trunk
 * exists exactly on a proboscis face. v1/v2 text and objects are migrated (migrateLegacyFace):
 * muzzle + trunk becomes proboscis, a trunk on any other face is removed.
 *
 * Version 4 (fauna-composer-face-2, eye catalogue EC1) appends 13 eye kinds and 3 iris colours (values, encoded by name)
 * and ONE key, eyeRules: the eye-rules epoch (2 = current, 1 = the face round's "Earlier eye rules"). Owner decision
 * 2026-10-03: every v1-v3 link UPGRADES to the current rules (it reads eyeRules 2); decodeComposerRecipe lists an
 * 'Eyes: upgraded ...' issue when that changes the eyes it built, and eyeRules 1 restores them. */
export const COMPOSER_RECIPE_VERSION = 4;
export const COMPOSER_RECIPE_MAX_TEXT = 1200;

export const COMPOSER_LAYOUTS = ['limbless', 'biped', 'quadruped', 'sprawled', 'many-legged'] as const;
export const COMPOSER_CHOICES = {
  layout: COMPOSER_LAYOUTS,
  torso: ['slim', 'barrel', 'deep-chest', 'flat', 'annulated', 'segmented'],
  /** The face. 'proboscis' (v3) is the trunk face. */
  head: ['muzzle', 'jaws', 'beak', 'flat-face', 'blunt', 'mandibles', 'proboscis'],
  horns: ['none', 'nasal', 'paired', 'ossicones', 'crest'],
  legs: ['pillar', 'plantigrade', 'digitigrade', 'unguligrade', 'arthropod'],
  feet: ['hoof', 'paw', 'claw', 'pad', 'hand', 'spike'],
  arms: ['none', 'small', 'grasping'],
  hands: ['hand', 'claw', 'pincer'],
  tail: ['none', 'stub', 'reptile', 'tufted', 'feather-fan', 'club'],
  armor: ['none', 'dome', 'plates', 'osteoderms', 'bands'],
  wings: ['none', 'feathered', 'membrane'],
  /** Derived from the face since v3: 'trunk' exactly when head is 'proboscis'. */
  trunk: ['none', 'trunk'],
  /** Legacy six first (v1 indices), then the fauna-coat-1 pigment families. */
  palette: COAT_PALETTE_IDS,
  pattern: COAT_PATTERNS,
  sex: ['auto', 'female', 'male'],
  eyes: COMPOSER_EYE_TYPES,
  iris: COMPOSER_IRIS,
} as const;
export type ComposerLayout = typeof COMPOSER_LAYOUTS[number];
type Choices = typeof COMPOSER_CHOICES;
export type ComposerChoiceKey = keyof Choices;

/** Numeric ranges: [min, max, step]. Lengths other than bodyLength are ratios of bodyLength. */
export const COMPOSER_RANGES = {
  legPairs: [0, 12, 1],
  bodyLength: [0.2, 6, 0.01],
  girth: [0.5, 1.6, 0.01],
  posture: [0, 1, 0.01],
  neckLength: [0, 1.5, 0.01],
  headSize: [0.5, 1.6, 0.01],
  snoutLength: [0, 1.5, 0.01],
  legLength: [0.1, 1.8, 0.01],
  armLength: [0.2, 1.4, 0.01],
  tailLength: [0, 2, 0.01],
  wingSpan: [0.5, 4, 0.01],
  trunkLength: [0.2, 1.4, 0.01],
  colorSeed: [0, 9999, 1],
  /** Region-mark bit flags (COAT_MARK_BITS). */
  marks: [0, 255, 1],
  patternScale: [0.5, 2, 0.05],
  patternContrast: [0, 1.5, 0.05],
  /** Pale-belly mix; 0.8 is the v1 belly blend. */
  countershade: [0, 1, 0.05],
  /** Sexual dimorphism strength (0 = none). */
  dimorphism: [0, 1, 0.05],
  /** Individual variation strength (0 = clones, 1 = natural herd, 2 = exaggerated). */
  variability: [0, 2, 0.05],
  /** Allometry strength (0 = off): larger bodies get relatively smaller heads and eyes and sturdier limbs. */
  allometry: [0, 1, 0.05],
  /** 0 is the species type specimen; any other value is one deterministic individual. */
  individualSeed: [0, 9999, 1],
  /** 1 adult .. 0.2 neonate. */
  maturity: [0.2, 1, 0.01],
  /** Body condition: -1 lean .. +1 heavy. */
  condition: [-1, 1, 0.05],
  /** v4: eye-rules epoch (1 = the face round's rules, 2 = current). Appended last; never drawn by a generator. */
  eyeRules: [1, 2, 1],
} as const;
export type ComposerNumberKey = keyof typeof COMPOSER_RANGES;
/** The numeric keys of recipe v3, in COMPOSER_RANGES order (frozen): the coherent generator draws one latent per key
 * in exactly this order, so a key appended to COMPOSER_RANGES must never enter that loop. */
export const COMPOSER_V3_RANGE_KEYS = Object.freeze(['legPairs', 'bodyLength', 'girth', 'posture', 'neckLength', 'headSize', 'snoutLength', 'legLength', 'armLength', 'tailLength',
  'wingSpan', 'trunkLength', 'colorSeed', 'marks', 'patternScale', 'patternContrast', 'countershade', 'dimorphism', 'variability', 'allometry', 'individualSeed', 'maturity',
  'condition'] as const);

export interface ComposerRecipe {
  version: typeof COMPOSER_RECIPE_VERSION;
  layout: ComposerLayout;
  /** Walking leg pairs. Fixed by layout except many-legged (3..12). */
  legPairs: number;
  /** Metres: torso length for legged plans; whole body length for limbless/many-legged. */
  bodyLength: number;
  girth: number;
  /** Bipeds: 0 horizontal (theropod) .. 1 upright (ape). Quadrupeds: shoulder rise. */
  posture: number;
  torso: Choices['torso'][number];
  neckLength: number;
  head: Choices['head'][number];
  headSize: number;
  snoutLength: number;
  horns: Choices['horns'][number];
  legs: Choices['legs'][number];
  legLength: number;
  feet: Choices['feet'][number];
  arms: Choices['arms'][number];
  armLength: number;
  hands: Choices['hands'][number];
  tail: Choices['tail'][number];
  tailLength: number;
  armor: Choices['armor'][number];
  wings: Choices['wings'][number];
  wingSpan: number;
  trunk: Choices['trunk'][number];
  trunkLength: number;
  palette: CoatPaletteId;
  colorSeed: number;
  // ---- v2 coat (species)
  pattern: CoatPattern;
  marks: number;
  patternScale: number;
  patternContrast: number;
  countershade: number;
  // ---- v2 variation strengths (species)
  dimorphism: number;
  variability: number;
  allometry: number;
  // ---- v2 individual
  individualSeed: number;
  sex: Choices['sex'][number];
  maturity: number;
  condition: number;
  // ---- v3 face (species)
  eyes: Choices['eyes'][number];
  iris: Choices['iris'][number];
  // ---- v4 (species)
  /** Eye-rules epoch: 2 current, 1 the face round's (fauna-composer-face-1). */
  eyeRules: number;
}
/** The 26 version-1 keys, in their v1 encoding order. */
export const COMPOSER_V1_KEYS = ['layout', 'legPairs', 'bodyLength', 'girth', 'posture', 'torso', 'neckLength', 'head', 'headSize', 'snoutLength', 'horns',
  'legs', 'legLength', 'feet', 'arms', 'armLength', 'hands', 'tail', 'tailLength', 'armor', 'wings', 'wingSpan', 'trunk', 'trunkLength', 'palette', 'colorSeed'] as const;
/** The 38 version-2 keys, in their v2 encoding order (frozen). */
export const COMPOSER_V2_KEYS = Object.freeze([...COMPOSER_V1_KEYS,
  'pattern', 'marks', 'patternScale', 'patternContrast', 'countershade', 'dimorphism', 'variability', 'allometry', 'individualSeed', 'sex', 'maturity', 'condition'] as const);
/** The 40 version-3 keys, in their v3 encoding order (frozen). */
export const COMPOSER_V3_KEYS = Object.freeze([...COMPOSER_V2_KEYS, 'eyes', 'iris'] as const);
/** Encoding order: v3 keys, then the v4 key appended (append-only). */
export const COMPOSER_RECIPE_KEYS = [...COMPOSER_V3_KEYS, 'eyeRules'] as const;
export type ComposerRecipeKey = typeof COMPOSER_RECIPE_KEYS[number];
/** What makes the species: anatomy, coat, variation strengths and eyes (with their rules epoch). Equal species keys =
 * same species. composerSpeciesKey (the herd hash) still reads the anatomy only. */
export const COMPOSER_SPECIES_KEYS = [...COMPOSER_V1_KEYS,
  'pattern', 'marks', 'patternScale', 'patternContrast', 'countershade', 'dimorphism', 'variability', 'allometry', 'eyes', 'iris', 'eyeRules'] as const;
/** What makes one animal of that species. */
export const COMPOSER_INDIVIDUAL_KEYS = ['individualSeed', 'sex', 'maturity', 'condition'] as const;

/** A compatibility adjustment the composer applied. The chosen part stays in the
 * recipe; `effect` says what is actually built from it. */
export interface ComposerConstraint { part: string; chosen: string; effect: string }

const base: ComposerRecipe = {
  version: 4, layout: 'quadruped', legPairs: 2, bodyLength: 1, girth: 1, posture: 0.2, torso: 'slim', neckLength: 0.4, head: 'muzzle', headSize: 1, snoutLength: 0.6,
  horns: 'none', legs: 'digitigrade', legLength: 0.8, feet: 'paw', arms: 'none', armLength: 0.6, hands: 'hand', tail: 'tufted', tailLength: 0.6,
  armor: 'none', wings: 'none', wingSpan: 2, trunk: 'none', trunkLength: 0.8, palette: 'earth', colorSeed: 1,
  pattern: 'auto', marks: 0, patternScale: 1, patternContrast: 1, countershade: 0.8, dimorphism: 0, variability: 0, allometry: 0,
  individualSeed: 0, sex: 'auto', maturity: 1, condition: 0, eyes: 'auto', iris: 'auto', eyeRules: COMPOSER_EYE_RULES_CURRENT,
};
type V2Key = Exclude<typeof COMPOSER_V2_KEYS[number], typeof COMPOSER_V1_KEYS[number]>;
type V3Key = Exclude<typeof COMPOSER_V3_KEYS[number], typeof COMPOSER_V2_KEYS[number]>;
type V4Key = Exclude<ComposerRecipeKey, typeof COMPOSER_V3_KEYS[number]>;
/** Neutral values of the keys version 2 added; a v1 recipe gets exactly these. */
export const COMPOSER_V2_DEFAULTS: Readonly<Pick<ComposerRecipe, V2Key>> = Object.freeze(Object.fromEntries(
  COMPOSER_V2_KEYS.filter(k => !(COMPOSER_V1_KEYS as readonly string[]).includes(k)).map(k => [k, base[k]])) as Pick<ComposerRecipe, V2Key>);
/** Neutral values of the keys version 3 added; a v1 or v2 recipe gets exactly these. */
export const COMPOSER_V3_DEFAULTS: Readonly<Pick<ComposerRecipe, V3Key>> = Object.freeze({eyes: 'auto', iris: 'auto'});
/** Value of the key version 4 added for any recipe that lacks it, v1-v3 links included (owner decision: old links
 * upgrade to the current eye rules). */
export const COMPOSER_V4_DEFAULTS: Readonly<Pick<ComposerRecipe, V4Key>> = Object.freeze({eyeRules: COMPOSER_EYE_RULES_CURRENT});
const preset = (p: Partial<ComposerRecipe>): Readonly<ComposerRecipe> => Object.freeze({ ...base, ...p });

/** Every preset is a variable species (variability 1, allometry 1). Its individual keys stay neutral,
 * so the preset itself is the species' type specimen. */
const TYPE = {variability: 1, allometry: 1} as const;
/** Starting points inspired by real animals. Every field stays editable. */
export const COMPOSER_PRESETS = {
  dinosaur: preset({ layout: 'biped', legPairs: 1, bodyLength: 1.6, girth: 1.05, posture: 0.12, torso: 'deep-chest', neckLength: 0.45, head: 'jaws', headSize: 1.35, snoutLength: 1,
    horns: 'crest', legs: 'digitigrade', legLength: 1.05, feet: 'claw', arms: 'small', armLength: 0.38, hands: 'claw', tail: 'reptile', tailLength: 1.6, palette: 'reptile', colorSeed: 17,
    marks: 16, dimorphism: 0, ...TYPE }),
  turtle: preset({ layout: 'sprawled', bodyLength: 0.55, girth: 1.1, posture: 0, torso: 'flat', neckLength: 0.35, head: 'beak', headSize: 0.9, snoutLength: 0.25,
    legs: 'pillar', legLength: 0.42, feet: 'pad', tail: 'stub', tailLength: 0.25, armor: 'dome', palette: 'reptile', colorSeed: 211,
    dimorphism: 0, ...TYPE }),
  giraffe: preset({ layout: 'quadruped', bodyLength: 1.5, girth: 0.9, posture: 0.7, torso: 'slim', neckLength: 1.5, head: 'muzzle', headSize: 0.85, snoutLength: 0.8,
    horns: 'ossicones', legs: 'unguligrade', legLength: 1.45, feet: 'hoof', tail: 'tufted', tailLength: 0.6, palette: 'savanna', colorSeed: 37,
    marks: 0, dimorphism: 0.3, ...TYPE }),
  bird: preset({ layout: 'biped', legPairs: 1, bodyLength: 0.22, girth: 1.2, posture: 0.45, torso: 'barrel', neckLength: 0.45, head: 'beak', headSize: 1.2, snoutLength: 0.55,
    legs: 'digitigrade', legLength: 0.85, feet: 'claw', tail: 'feather-fan', tailLength: 0.9, wings: 'feathered', wingSpan: 3.2, palette: 'plumage', colorSeed: 5,
    dimorphism: 0.6, ...TYPE }),
  ostrich: preset({ layout: 'biped', legPairs: 1, bodyLength: 0.8, girth: 1.1, posture: 0.3, torso: 'barrel', neckLength: 1.5, head: 'beak', headSize: 0.75, snoutLength: 0.45,
    legs: 'digitigrade', legLength: 1.8, feet: 'claw', tail: 'feather-fan', tailLength: 0.4, wings: 'feathered', wingSpan: 1.3, palette: 'ink', colorSeed: 88,
    marks: 1, dimorphism: 0.8, ...TYPE }),
  rhinoceros: preset({ layout: 'quadruped', bodyLength: 2.1, girth: 1.4, posture: 0.1, torso: 'barrel', neckLength: 0.2, head: 'muzzle', headSize: 1.15, snoutLength: 0.75,
    horns: 'nasal', legs: 'pillar', legLength: 0.5, feet: 'pad', tail: 'tufted', tailLength: 0.25, armor: 'osteoderms', palette: 'slate', colorSeed: 61,
    countershade: 0.3, dimorphism: 0.2, ...TYPE }),
  ape: preset({ layout: 'biped', legPairs: 1, bodyLength: 0.6, girth: 1.15, posture: 0.85, torso: 'deep-chest', neckLength: 0.1, head: 'flat-face', headSize: 1.1, snoutLength: 0.35,
    legs: 'plantigrade', legLength: 1.05, feet: 'hand', arms: 'grasping', armLength: 1.25, hands: 'hand', tail: 'none', tailLength: 0, palette: 'ink', colorSeed: 143,
    marks: 2, dimorphism: 0.5, ...TYPE }),
  worm: preset({ layout: 'limbless', legPairs: 0, bodyLength: 1.1, girth: 1, posture: 0, torso: 'annulated', neckLength: 0, head: 'blunt', headSize: 1, snoutLength: 0.2,
    legs: 'pillar', feet: 'pad', tail: 'none', tailLength: 0, palette: 'earth', colorSeed: 401,
    dimorphism: 0, ...TYPE }),
  centipede: preset({ layout: 'many-legged', legPairs: 11, bodyLength: 0.55, girth: 0.9, posture: 0, torso: 'segmented', neckLength: 0, head: 'mandibles', headSize: 1, snoutLength: 0.3,
    legs: 'arthropod', legLength: 0.2, feet: 'spike', tail: 'none', tailLength: 0, armor: 'bands', palette: 'ink', colorSeed: 909,
    dimorphism: 0, ...TYPE }),
  // Named hybrids show independent composition; they are starting points, not species.
  // fauna-composer-face-1 redesign (reversible; legacy v1 links keep their old horn, see LEGACY_PRESET_V1): every part a
  // hybrid preset shows is built. shelled-giraffe-bird carries a casque (Crest) instead of ossicones, which a beak cannot
  // grow; trunked-centipede has the Proboscis face and no nose horn (a trunk face has no nose bones); winged-ape-rhino
  // drops the nose horn, which a primate face cannot carry.
  'shelled-giraffe-bird': preset({ layout: 'biped', legPairs: 1, bodyLength: 0.9, girth: 1.2, posture: 0.3, torso: 'barrel', neckLength: 1.3, head: 'beak', headSize: 0.9, snoutLength: 0.5,
    horns: 'crest', legs: 'unguligrade', legLength: 1.3, feet: 'hoof', tail: 'stub', tailLength: 0.3, armor: 'dome', wings: 'feathered', wingSpan: 1.6, palette: 'savanna', colorSeed: 2718,
    dimorphism: 0, ...TYPE }),
  'trunked-centipede': preset({ layout: 'many-legged', legPairs: 7, bodyLength: 1.4, girth: 1.3, posture: 0, torso: 'segmented', neckLength: 0.3, head: 'proboscis', headSize: 1, snoutLength: 0.4,
    horns: 'none', legs: 'pillar', legLength: 0.24, feet: 'pad', tail: 'tufted', tailLength: 0.2, armor: 'bands', trunk: 'trunk', trunkLength: 1, palette: 'slate', colorSeed: 3141,
    dimorphism: 0, ...TYPE }),
  'winged-ape-rhino': preset({ layout: 'quadruped', bodyLength: 1.2, girth: 1.25, posture: 0.25, torso: 'deep-chest', neckLength: 0.15, head: 'flat-face', headSize: 1.1, snoutLength: 0.5,
    horns: 'none', legs: 'plantigrade', legLength: 0.7, feet: 'hand', arms: 'grasping', armLength: 0.8, hands: 'hand', tail: 'club', tailLength: 0.8, wings: 'membrane', wingSpan: 2.4, palette: 'earth', colorSeed: 1618,
    dimorphism: 0, ...TYPE }),
} satisfies Record<string, Readonly<ComposerRecipe>>;
export type ComposerPresetId = keyof typeof COMPOSER_PRESETS;
export const COMPOSER_PRESET_IDS = Object.keys(COMPOSER_PRESETS) as ComposerPresetId[];
export const COMPOSER_PRESET_LABELS: Record<ComposerPresetId, string> = {
  dinosaur: 'Dinosaur-like', turtle: 'Turtle-like', giraffe: 'Giraffe-like', bird: 'Bird-like', ostrich: 'Ostrich-like', rhinoceros: 'Rhinoceros-like', ape: 'Ape-like',
  worm: 'Worm-like', centipede: 'Centipede-like', 'shelled-giraffe-bird': 'Hybrid: shelled giraffe-bird', 'trunked-centipede': 'Hybrid: trunked centipede',
  'winged-ape-rhino': 'Hybrid: winged ape-rhino',
};
export function composerPreset(id: ComposerPresetId): ComposerRecipe {
  if (typeof id !== 'string' || !Object.hasOwn(COMPOSER_PRESETS, id)) throw new Error(`Unknown composer preset: ${String(id).slice(0, 40)}`);
  return { ...COMPOSER_PRESETS[id] };
}
export function isComposerPresetId(id: unknown): id is ComposerPresetId { return typeof id === 'string' && Object.hasOwn(COMPOSER_PRESETS, id); }
/** The v1 values the redesigned hybrid presets had (after face migration), so an old v1 preset link still names its
 * preset. Such a link keeps its own (now disclosed) horn choice. */
const LEGACY_PRESET_V1: Partial<Record<ComposerPresetId, Partial<ComposerRecipe>>> = {
  'shelled-giraffe-bird': {horns: 'ossicones'}, 'trunked-centipede': {horns: 'nasal'}, 'winged-ape-rhino': {horns: 'nasal'},
};
/** The preset a (migrated) v1 recipe was encoded from: all 26 v1 fields equal that preset's v1 values. */
export function composerLegacyPresetId(recipe: ComposerRecipe): ComposerPresetId | undefined {
  return COMPOSER_PRESET_IDS.find(id => {
    const p = {...COMPOSER_PRESETS[id], ...LEGACY_PRESET_V1[id]};
    return COMPOSER_V1_KEYS.every(key => p[key] === recipe[key]);
  });
}

const roundStep = (value: number, step: number) => step >= 1 ? Math.round(value) : Math.round(value / step) * step;
const fix = (value: number) => Number(value.toFixed(4));
/** Layout-fixed leg pair counts. */
export function composerLegPairRange(layout: ComposerLayout): [number, number] {
  if (!(COMPOSER_LAYOUTS as readonly string[]).includes(layout)) throw new Error(`Unknown composer layout: ${String(layout).slice(0, 40)}`);
  return layout === 'limbless' ? [0, 0] : layout === 'biped' ? [1, 1] : layout === 'quadruped' || layout === 'sprawled' ? [2, 2] : [3, 12];
}

/** Bounds every field. Out-of-range or unknown values are replaced and listed in `issues`.
 * Version 1, 2, 3 and 4 objects are accepted (keys an older version lacks take their neutral defaults; eyeRules the
 * current epoch); the output is always version 4. A version 1 or 2 object is migrated first (migrateLegacyFace: muzzle + trunk becomes the
 * proboscis face, a trunk on another face is removed, each with an issue). Then the trunk is always derived from the
 * face; for version 3 or version-less objects a stale `trunk` field is ignored silently, so editing a proboscis back to
 * a muzzle never re-promotes it. */
export function normalizeComposerRecipe(input: unknown): { recipe: ComposerRecipe; issues: string[] } {
  const issues: string[] = [];
  const record = !!input && typeof input === 'object' && !Array.isArray(input);
  let source = (record ? input : {}) as Record<string, unknown>;
  if (!record) issues.push('Recipe was not a plain object; defaults used.');
  if (record && 'version' in source && source.version !== 1 && source.version !== 2 && source.version !== 3 && source.version !== COMPOSER_RECIPE_VERSION) issues.push(`Recipe version ${String(source.version).slice(0, 12)} is not supported; fields were read as version ${COMPOSER_RECIPE_VERSION}.`);
  if (record && (source.version === 1 || source.version === 2)) { source = {...source}; migrateLegacyFace(source, issues); }
  const recipe = { ...base } as ComposerRecipe;
  const r = recipe as unknown as Record<string, unknown>;
  for (const key of Object.keys(COMPOSER_CHOICES) as ComposerChoiceKey[]) {
    if (!(key in source)) continue;
    const value = source[key], allowed = COMPOSER_CHOICES[key] as readonly string[];
    if (typeof value === 'string' && allowed.includes(value)) r[key] = value;
    else issues.push(`Unknown ${key} "${String(value).slice(0, 40)}"; using ${String(r[key])}.`);
  }
  for (const key of Object.keys(COMPOSER_RANGES) as ComposerNumberKey[]) {
    if (!(key in source)) continue;
    const [min, max, step] = COMPOSER_RANGES[key];
    const raw = source[key], value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(value)) { issues.push(`${key} is not a finite number; using ${String(r[key])}.`); continue; }
    const bounded = fix(Math.max(min, Math.min(max, roundStep(value, step))));
    if (Math.abs(bounded - value) > step * 0.5 + 1e-9) issues.push(`${key} ${value} limited to ${bounded}.`);
    r[key] = bounded;
  }
  const [lo, hi] = composerLegPairRange(recipe.layout);
  if (recipe.legPairs < lo || recipe.legPairs > hi) {
    const next = Math.max(lo, Math.min(hi, recipe.legPairs));
    if ('legPairs' in source) issues.push(`${recipe.layout} body uses ${lo === hi ? lo : `${lo}-${hi}`} leg pairs; ${recipe.legPairs} set to ${next}.`);
    recipe.legPairs = next;
  }
  recipe.trunk = recipe.head === 'proboscis' ? 'trunk' : 'none';
  recipe.version = COMPOSER_RECIPE_VERSION;
  return { recipe, issues };
}

/** Compatibility rules applied when building. Chosen parts are kept in the
 * recipe; each entry reports how the builder adapts a combination. */
export function composerConstraints(recipe: ComposerRecipe): ComposerConstraint[] {
  const out: ComposerConstraint[] = [];
  const legged = recipe.layout !== 'limbless';
  if (!legged) {
    out.push({ part: 'Legs and feet', chosen: `${recipe.legs} / ${recipe.feet}`, effect: 'Not built: a limbless body has no legs. It crawls on its belly instead.' });
    if (recipe.neckLength > 0) out.push({ part: 'Neck', chosen: recipe.neckLength.toFixed(2), effect: 'A limbless body has no separate neck; the front of the body is raised and lengthened instead.' });
  }
  if (recipe.layout === 'many-legged' && recipe.legs !== 'arthropod' && recipe.legLength > 0.45)
    out.push({ part: 'Leg length', chosen: recipe.legLength.toFixed(2), effect: 'Shortened to 0.45 body lengths so neighbouring leg pairs do not cross.' });
  if (recipe.armor === 'dome' && (recipe.layout === 'limbless' || recipe.layout === 'many-legged'))
    out.push({ part: 'Shell', chosen: 'dome', effect: 'Covers only the middle third so the long flexible body can still bend.' });
  if (recipe.armor === 'dome' && recipe.wings !== 'none')
    out.push({ part: 'Wings', chosen: recipe.wings, effect: 'Wing roots are moved to the shell rim instead of the back.' });
  if (recipe.armor === 'plates' && recipe.layout === 'many-legged')
    out.push({ part: 'Armor', chosen: 'plates', effect: 'One plate per body segment.' });
  out.push(...composerFaceConstraints(recipe));
  if (recipe.arms !== 'none' && recipe.layout !== 'biped')
    out.push({ part: 'Arms', chosen: recipe.arms, effect: recipe.layout === 'limbless' ? 'Attached behind the head; the body still crawls.' : 'Added as an extra pair in front of the walking legs; they do not touch the ground.' });
  if (recipe.arms === 'none' && recipe.hands !== 'hand')
    out.push({ part: 'Hands', chosen: recipe.hands, effect: 'Not built because no arms are selected.' });
  if (recipe.wings !== 'none') {
    const limit = composerWingSpanLimit(recipe);
    if (recipe.wingSpan > limit) out.push({ part: 'Wing span', chosen: recipe.wingSpan.toFixed(2), effect: `Limited to ${limit.toFixed(2)} body lengths so folded wings stay off the ground.` });
    out.push({ part: 'Wings', chosen: recipe.wings, effect: 'Grounded display and folding only. Flight is not simulated.' });
  }
  if (recipe.tail === 'none' && recipe.tailLength > 0)
    out.push({ part: 'Tail length', chosen: recipe.tailLength.toFixed(2), effect: 'Ignored because no tail is selected.' });
  if (recipe.feet === 'spike' && recipe.layout !== 'many-legged' && legged)
    out.push({ part: 'Feet', chosen: 'spike', effect: 'Pointed tips carry the weight on a very small contact area.' });
  if (recipe.layout === 'biped' && recipe.posture > 0.6 && recipe.tail !== 'none' && recipe.tailLength > 1)
    out.push({ part: 'Tail', chosen: recipe.tail, effect: 'An upright body lets a long tail rest along the ground.' });
  return out;
}
/** Folded wings must clear the ground: span is bounded by body height. */
export function composerWingSpanLimit(recipe: ComposerRecipe): number {
  return recipe.layout === 'limbless' ? 1.5 : recipe.layout === 'many-legged' || recipe.layout === 'sprawled' ? 2 : 4;
}

/** Deterministic string hash and PRNG shared by seeding and colours. */
export function composerHash(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
export function composerRandom(seed: string): () => number {
  let state = composerHash(seed) || 1;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The six v1 faces: the frozen wild draw picks uniformly from exactly these (never 'proboscis'). */
const COMPOSER_V1_FACES = ['muzzle', 'jaws', 'beak', 'flat-face', 'blunt', 'mandibles'] as const;
/** The frozen wild draw: stream 'composer-random-v1/' with its fixed draw order, byte-identical to the v1/v2
 * generator. The v2 and v3 keys keep their neutral defaults and take no draws. The result is the raw draw (it may
 * carry a trunk or horns the face cannot have); randomComposerRecipe applies the face rules to it. */
export function drawComposerRandomV1(seed: string): ComposerRecipe {
  const rand = composerRandom(`composer-random-v1/${String(seed).slice(0, 160)}`);
  const pick = <T>(list: readonly T[], weights?: number[]): T => {
    if (!weights) return list[Math.floor(rand() * list.length) % list.length]!;
    const total = weights.reduce((a, b) => a + b, 0); let x = rand() * total;
    for (let i = 0; i < list.length; i++) { x -= weights[i]!; if (x <= 0) return list[i]!; }
    return list[list.length - 1]!;
  };
  const range = (key: ComposerNumberKey, lo?: number, hi?: number) => { const [min, max, step] = COMPOSER_RANGES[key]; const a = lo ?? min, b = hi ?? max; return fix(roundStep(a + (b - a) * rand(), step)); };
  const layout = pick(COMPOSER_LAYOUTS, [1, 2.2, 2.2, 1.3, 1.3]);
  const [lo, hi] = composerLegPairRange(layout);
  const legs = layout === 'many-legged' ? pick(COMPOSER_CHOICES.legs, [1, 0.5, 0.4, 0.3, 2.5]) : pick(COMPOSER_CHOICES.legs, [1, 1, 1.2, 1, 0.4]);
  const r: ComposerRecipe = {
    ...COMPOSER_V2_DEFAULTS, ...COMPOSER_V3_DEFAULTS, ...COMPOSER_V4_DEFAULTS, version: COMPOSER_RECIPE_VERSION, layout, legPairs: lo + Math.floor(rand() * (hi - lo + 1)),
    bodyLength: layout === 'limbless' || layout === 'many-legged' ? range('bodyLength', 0.4, 2) : range('bodyLength', 0.3, 2.4),
    girth: range('girth', 0.75, 1.4), posture: range('posture'),
    torso: layout === 'limbless' ? pick(['annulated', 'slim', 'segmented'] as const) : layout === 'many-legged' ? pick(['segmented', 'annulated', 'flat'] as const) : pick(['slim', 'barrel', 'deep-chest', 'flat'] as const),
    neckLength: layout === 'limbless' ? 0 : range('neckLength', 0, 1.5), head: pick(COMPOSER_V1_FACES), headSize: range('headSize', 0.7, 1.4), snoutLength: range('snoutLength', 0.1, 1.2),
    horns: pick(COMPOSER_CHOICES.horns, [2.5, 1, 1, 1, 1]), legs,
    legLength: layout === 'many-legged' ? range('legLength', 0.12, 0.4) : layout === 'sprawled' ? range('legLength', 0.3, 0.7) : range('legLength', 0.4, 1.6),
    feet: legs === 'arthropod' ? pick(['spike', 'claw', 'hand'] as const, [3, 1, 0.5]) : pick(COMPOSER_CHOICES.feet, [1, 1, 1, 1, 0.6, 0.3]),
    arms: pick(COMPOSER_CHOICES.arms, layout === 'biped' ? [1, 1, 1.5] : [3, 0.5, 1]), armLength: range('armLength', 0.3, 1.2), hands: pick(COMPOSER_CHOICES.hands),
    tail: pick(COMPOSER_CHOICES.tail, [0.8, 0.8, 1.5, 1, 0.8, 0.6]), tailLength: range('tailLength', 0.2, 1.6),
    armor: pick(COMPOSER_CHOICES.armor, [2, 1, 0.8, 0.8, 0.8]), wings: pick(COMPOSER_CHOICES.wings, [2.2, 1, 1]), wingSpan: range('wingSpan', 1, 3),
    trunk: pick(COMPOSER_CHOICES.trunk, [3, 1]), trunkLength: range('trunkLength', 0.4, 1.2), palette: pick(LEGACY_PALETTE_IDS), colorSeed: Math.floor(rand() * 10000),
  };
  if (r.tail === 'none') r.tailLength = 0;
  return r;
}
/** Wild specimens that get an unusual eye kind, per mille (owner decision 2026-10-03: rarely, about 5-10 %). */
export const COMPOSER_WILD_UNUSUAL_EYES_PER_MILLE = 75;
/** The wild generator's eye choice: a pure hash post-pass on its own stream name ('composer-wild-eyes-1/<seed>'), no
 * draw from the frozen 'composer-random-v1/' stream. About 7.5 % of seeds get an explicit kind drawn uniformly from
 * the 17 catalogue kinds other than the one 'auto' builds on that body (so it always shows); the rest stay 'auto'. */
export function composerWildEyes(seed: string, r: Pick<ComposerRecipe, 'head' | 'layout' | 'legPairs' | 'legs' | 'feet' | 'bodyLength'>): ComposerRecipe['eyes'] {
  const name = `composer-wild-eyes-1/${String(seed).slice(0, 160)}`;
  if (composerHash(name) % 1000 >= COMPOSER_WILD_UNUSUAL_EYES_PER_MILLE) return 'auto';
  const auto = composerAutoEyeType(r, COMPOSER_EYE_RULES_CURRENT), pool = COMPOSER_EYE_KINDS.filter(k => k !== auto);
  return pool[composerHash(`${name}/kind`) % pool.length]!;
}
/** Seeded structural combination ("wild"): each part is drawn independently, so the
 * result mixes anatomy from different presets rather than choosing one. The draw is
 * drawComposerRandomV1 (frozen); a post-pass then obeys the face rules without any new
 * draw: a trunk on a muzzle becomes the proboscis face, a trunk on another face is
 * dropped, the horns become the kind the face builds, the iris is 'auto', and the eyes
 * are 'auto' except for a rare unusual kind (composerWildEyes, a pure hash), under the
 * current eye rules. For plausible animals use randomCoherentComposerRecipe (fauna-composer-species.ts). */
export function randomComposerRecipe(seed: string): ComposerRecipe {
  const r = drawComposerRandomV1(seed);
  if (r.trunk === 'trunk') { if (r.head === 'muzzle') r.head = 'proboscis'; else r.trunk = 'none'; }
  r.horns = composerHeadgearBuild(r).built;
  r.eyeRules = COMPOSER_EYE_RULES_CURRENT;
  r.eyes = composerWildEyes(seed, r); r.iris = 'auto';
  return normalizeComposerRecipe(r).recipe;
}

const NUMBER_KEYS = new Set<string>(Object.keys(COMPOSER_RANGES));
/** Compact, URL-safe text: `v4*layout_biped*bodyLength_1.6*...` (form-encoding leaves `*`, `_`, `.`, `-` intact). Always writes version 4. */
export function encodeComposerRecipe(recipe: ComposerRecipe): string {
  const { recipe: r } = normalizeComposerRecipe(recipe);
  return [`v${COMPOSER_RECIPE_VERSION}`, ...COMPOSER_RECIPE_KEYS.map(key => `${key}_${String(r[key])}`)].join('*');
}
/** Decodes shared text. An unsupported version or oversized text is an error
 * (nothing is built); unknown or out-of-range fields are bounded and listed.
 * 'v1*' text reads only the 26 v1 fields and 'v2*' text the 38 v2 fields; neither raises an
 * issue for the keys it lacks: they take neutral defaults, except that a v1 text whose 26
 * fields equal a preset's adopts that preset's later species values (so an old preset link
 * still names the preset). v1 and v2 text is face-migrated (migrateLegacyFace), and the
 * migration is reported in `issues`. In v3 and v4 text the trunk follows the face. 'v3*' text reads the 40 v3 fields.
 * v1-v3 text takes the current eye rules (eyeRules 2); when that changes the eyes the link built (kind or iris), an
 * 'Eyes: upgraded ...' issue says what it built before (eyeRules 1 restores it). 'v5*' and anything else is an error. */
export function decodeComposerRecipe(text: string): { recipe: ComposerRecipe | null; issues: string[]; error: string | null } {
  if (typeof text !== 'string' || !text.trim()) return { recipe: null, issues: [], error: 'Empty composer recipe.' };
  if (text.length > COMPOSER_RECIPE_MAX_TEXT) return { recipe: null, issues: [], error: `Composer recipe is longer than ${COMPOSER_RECIPE_MAX_TEXT} characters.` };
  const [version, ...pairs] = text.split('*');
  const textVersion = version === 'v1' ? 1 : version === 'v2' ? 2 : version === 'v3' ? 3 : version === `v${COMPOSER_RECIPE_VERSION}` ? COMPOSER_RECIPE_VERSION : 0;
  if (!textVersion) return { recipe: null, issues: [], error: `Unsupported composer recipe version "${String(version).slice(0, 12)}".` };
  const legacy = textVersion === 1;
  const known: readonly string[] = textVersion === 1 ? COMPOSER_V1_KEYS : textVersion === 2 ? COMPOSER_V2_KEYS : textVersion === 3 ? COMPOSER_V3_KEYS : COMPOSER_RECIPE_KEYS;
  const source: Record<string, unknown> = {}, issues: string[] = [];
  for (const pair of pairs) {
    const split = pair.indexOf('_'), key = split > 0 ? pair.slice(0, split) : pair, value = split > 0 ? pair.slice(split + 1) : '';
    if (!known.includes(key)) { issues.push(`Ignored unknown recipe field "${key.slice(0, 24)}".`); continue; }
    if (key in source) { issues.push(`Repeated recipe field "${key}"; first value kept.`); continue; }
    source[key] = NUMBER_KEYS.has(key) ? (value.trim() ? Number(value) : NaN) : value;
  }
  // the version marker makes normalize migrate v1/v2 text (it is not a recipe field of the text)
  const normalized = normalizeComposerRecipe({...source, version: textVersion});
  if (textVersion >= 3 && 'trunk' in source && source.trunk !== normalized.recipe.trunk)
    issues.push('Trunk follows the Face; trunk field ignored.');
  // normalize (migration included) THEN the preset match, so a v1 trunked-centipede text matches the migrated preset
  if (legacy) upgradeLegacyPreset(normalized.recipe);
  const upgrade = textVersion < 4 ? composerEyeUpgradeIssue(normalized.recipe) : null;
  return { recipe: normalized.recipe, issues: [...issues, ...normalized.issues, ...(upgrade ? [upgrade] : [])], error: null };
}
/** The disclosure for an old (v1-v3) link whose eyes the current rules build differently from the face round's
 * rules (kind or iris), else null. The recipe keeps eyeRules 2; setting eyeRules 1 restores the earlier eyes. */
export function composerEyeUpgradeIssue(recipe: ComposerRecipe): string | null {
  const now = resolveComposerEyes({...recipe, eyeRules: 2}), before = resolveComposerEyes({...recipe, eyeRules: 1});
  if (now.kind === before.kind && now.irisBuilt === before.irisBuilt) return null;
  const says = (e: typeof now) => `${e.kind}${e.irisBuilt ? ` (${e.irisBuilt})` : ''}`;
  return `Eyes: upgraded to the current eye rules: ${says(now)} eyes, where the earlier rules built ${says(before)}. Eye rules -> Earlier restores them.`;
}
/** v1 preset links keep their preset identity: copy that preset's later species values (the v1 fields already
 * match, or are the legacy choices a redesigned preset used to have, which the link keeps). */
function upgradeLegacyPreset(recipe: ComposerRecipe): void {
  const id = composerLegacyPresetId(recipe);
  if (!id) return;
  const r = recipe as unknown as Record<string, unknown>, p = COMPOSER_PRESETS[id] as unknown as Record<string, unknown>;
  for (const key of COMPOSER_SPECIES_KEYS) if (!(COMPOSER_V1_KEYS as readonly string[]).includes(key)) r[key] = p[key];
}
/** Every key (species and individual) is equal. */
export function composerRecipesEqual(a: ComposerRecipe, b: ComposerRecipe): boolean {
  return a.version === COMPOSER_RECIPE_VERSION && b.version === COMPOSER_RECIPE_VERSION && COMPOSER_RECIPE_KEYS.every(key => a[key] === b[key]);
}
/** Same species: every species key is equal; individual keys (seed, sex, maturity, condition) are ignored. */
export function composerSpeciesEqual(a: ComposerRecipe, b: ComposerRecipe): boolean {
  return a.version === COMPOSER_RECIPE_VERSION && b.version === COMPOSER_RECIPE_VERSION && COMPOSER_SPECIES_KEYS.every(key => a[key] === b[key]);
}
