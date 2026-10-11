/** Individual variation for the modular creature composer (pure, three-free).
 *
 * A composer recipe names a species (COMPOSER_SPECIES_KEYS) and one animal of it
 * (COMPOSER_INDIVIDUAL_KEYS: individualSeed, sex, maturity, condition).
 * composerIndividualTraits() turns the individual keys into a deterministic set of
 * small, correlated deviations; deriveComposerIndividual() applies the recipe-level
 * part of them (proportions, sex, growth, condition, allometry) and returns the
 * effective recipe that the rig and skin build. Trait-level parts (horn, ear and eye
 * scale, limb robustness, torso lobes, carriage, gait desync, coat drift, count
 * offsets) are read by the rig and skin from the same traits.
 *
 * Determinism: the stream is composerRandom(`composer-individual-v2/<speciesKey>/<individualSeed>`)
 * with a fixed, append-only draw order (see drawIndividual). speciesKey hashes only the
 * anatomical choice keys, which derivation never changes, so the latents of an
 * individual are identical whether they are computed from the species recipe or from
 * its effective recipe, and colour controls (palette, colorSeed, pattern, marks ...)
 * can never change geometry.
 *
 * individualSeed 0 is the species type specimen: every latent is 0 and 'auto' sex
 * resolves to 'none'. With maturity 1, condition 0 and allometry 0 the derivation
 * is the identity, so v1 recipes build exactly as before.
 *
 * Only buildComposerSource may call deriveComposerIndividual: derivation is not
 * idempotent (deriving an effective recipe again would apply the deltas twice).
 * Code that holds an effective recipe (rig, skin) calls composerIndividualTraits. */
import {COMPOSER_RANGES, composerHash, composerRandom, normalizeComposerRecipe, type ComposerNumberKey, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {COAT_MARK_BITS} from './fauna-coat-vocab.ts';
import {composerAnatomyProjection} from './fauna-composer-face.ts';

export const COMPOSER_INDIVIDUAL_VERSION = 'fauna-composer-individual-2';
/** Anatomical choice keys: the only species keys the individual stream depends on. Frozen: eyes and iris are
 * deliberately NOT here (an eye or iris choice never re-rolls a herd). */
export const COMPOSER_ANATOMY_CHOICE_KEYS = ['layout', 'torso', 'head', 'horns', 'legs', 'feet', 'arms', 'hands', 'tail', 'armor', 'wings', 'trunk'] as const;
export type ComposerSex = 'none' | 'female' | 'male';

export interface ComposerIndividualTraits {
  version: typeof COMPOSER_INDIVIDUAL_VERSION;
  individualSeed: number;
  /** 8-hex hash of the anatomical choice keys. */
  speciesKey: string;
  /** Resolved sex: 'none' for the type specimen or a species without dimorphism (unless set explicitly). */
  sex: ComposerSex;
  maturity: number;
  condition: number;
  /** Correlated latents, each in [-2, 2] (unscaled by variability; 0 for the type specimen). */
  size: number; limb: number; neck: number; head: number; tail: number; mass: number;
  /** Body pitch latent in [-2, 2] (applied to the recipe's posture, additively). */
  posture: number;
  /** Horn length multiplier (variation x sex x maturity^2). */
  hornScale: number;
  /** Additive horn curvature change. */
  hornCurl: number;
  /** Signed left/right horn length asymmetry (fraction). */
  hornAsym: number;
  earScale: number;
  eyeScale: number;
  /** Limb radius multiplier (variation + condition). */
  limbRadius: number;
  /** Per-segment leg length jitter (fractions, renormalised by the rig). */
  segmentJitter: {fore: [number, number, number]; hind: [number, number, number]};
  /** Torso lobe offsets, each z x variability in [-2, 2]. */
  torso: {chest: number; belly: number; rump: number; waist: number; withers: number};
  /** Rest carriage offsets in radians. */
  carriage: {neck: number; headPitch: number; tail: number};
  motion: {phase: number; periodScale: number; dutyDelta: number; liftScale: number; breathPhase: number; lookPhase: number};
  coat: {driftKey: string; juvenileSpots: number};
  /** Integer count offsets for repeated parts. */
  countScale: {osteoderm: number; plate: number; feather: number};
  /** Allometric factors from the recipe's body length (metres, rounded to 1 mm) and allometry strength. */
  allometry: {limbRobust: number; headRel: number; eyeRel: number};
  /** True iff individualSeed 0, maturity 1, condition 0, sex 'none' and allometry 0. */
  neutral: boolean;
}

export interface ComposerIndividual {
  /** The effective recipe the rig and skin build. */
  recipe: ComposerRecipe;
  traits: ComposerIndividualTraits;
  /** Human-readable list of every applied change and every range clamp. Empty when nothing changed. */
  deltas: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 1e-9 rounding keeps traits compact and never produces -0. */
const c9 = (x: number) => { const y = Math.round(x * 1e9) / 1e9; return y === 0 ? 0 : y; };
const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/** Hash of the anatomical choice keys (derivation never changes them). It hashes composerAnatomyProjection(recipe):
 * the proboscis face projects to the legacy muzzle (its derived trunk is kept), so a migrated muzzle+trunk link keeps
 * its species key, individuals and coat drift. */
export function composerSpeciesKey(recipe: ComposerRecipe): string {
  const projected = composerAnatomyProjection(recipe);
  return hex8(composerHash(COMPOSER_ANATOMY_CHOICE_KEYS.map(key => `${key}_${String(projected[key])}`).join('*')));
}

interface Draws {
  z: {size: number; limb: number; neck: number; head: number; tail: number; mass: number; carriage: number};
  sexU: number; horn: number; curl: number; asymMag: number; asymSign: number; ear: number; eye: number; limbR: number;
  fore: [number, number, number]; hind: [number, number, number];
  torso: [number, number, number, number, number]; headPitch: number; tailCarriage: number;
  phase: number; period: number; duty: number; lift: number; breath: number; look: number;
  osteoderm: number; plate: number; feather: number;
  posture: number;
}
/** Fixed, append-only draw order. Seed 0 draws nothing: every value is neutral. */
function drawIndividual(speciesKey: string, seed: number): Draws {
  if (seed === 0) {
    const zero3: [number, number, number] = [0, 0, 0];
    return {z: {size: 0, limb: 0, neck: 0, head: 0, tail: 0, mass: 0, carriage: 0}, sexU: 0, horn: 0, curl: 0, asymMag: 0, asymSign: 0, ear: 0, eye: 0, limbR: 0,
      fore: zero3, hind: [0, 0, 0], torso: [0, 0, 0, 0, 0], headPitch: 0, tailCarriage: 0, phase: 0, period: 0, duty: 0, lift: 0, breath: 0, look: 0, osteoderm: 0.5, plate: 0.5, feather: 0.5, posture: 0};
  }
  const rand = composerRandom(`composer-individual-v2/${speciesKey}/${seed}`);
  /** Approximately normal latent: sum of three uniforms, unit variance, bounded to +-2. */
  const z = () => clamp((rand() + rand() + rand() - 1.5) / 0.5, -2, 2);
  const zs = {size: z(), limb: z(), neck: z(), head: z(), tail: z(), mass: z(), carriage: z()};
  const sexU = rand();
  const horn = z(), curl = z(), asymMag = rand(), asymSign = rand(), ear = z(), eye = z(), limbR = z();
  const fore: [number, number, number] = [z(), z(), z()], hind: [number, number, number] = [z(), z(), z()];
  const torso: [number, number, number, number, number] = [z(), z(), z(), z(), z()];
  const headPitch = z(), tailCarriage = z();
  const phase = rand(), period = z(), duty = z(), lift = z(), breath = rand(), look = rand();
  const osteoderm = rand(), plate = rand(), feather = rand();
  const posture = z();
  return {z: zs, sexU, horn, curl, asymMag, asymSign, ear, eye, limbR, fore, hind, torso, headPitch, tailCarriage, phase, period, duty, lift, breath, look, osteoderm, plate, feather, posture};
}
/** Unit-variance mix of a shared latent and an own latent, bounded to +-2. */
const blend = (shared: number, weight: number, own: number) => clamp(weight * shared + Math.sqrt(1 - weight * weight) * own, -2, 2);

/** Resolves 'auto' sex: by the individual stream when the species is dimorphic and the animal is not the type specimen. */
function resolveSex(recipe: ComposerRecipe, sexU: number): ComposerSex {
  if (recipe.sex === 'female' || recipe.sex === 'male') return recipe.sex;
  return recipe.dimorphism > 0 && recipe.individualSeed > 0 ? (sexU < 0.5 ? 'female' : 'male') : 'none';
}

/** Deterministic traits of one individual. Reads only the individual keys, the anatomical choice keys,
 * variability, dimorphism, allometry, marks (juvenile-spot bit) and bodyLength rounded to 1 mm (allometry). */
export function composerIndividualTraits(input: ComposerRecipe): ComposerIndividualTraits {
  const r = normalizeComposerRecipe(input).recipe;
  const v = r.variability, d = r.dimorphism, m = r.maturity, seed = r.individualSeed;
  const speciesKey = composerSpeciesKey(r), w = drawIndividual(speciesKey, seed), z = w.z;
  const sex = resolveSex(r, w.sexU);
  const sexHorn = sex === 'male' ? 1 + 0.35 * d : sex === 'female' ? 1 - 0.6 * d : 1;
  const L = Math.round(r.bodyLength * 1000) / 1000, a = r.allometry;
  const offset = (u: number, lo: number, hi: number) => { if (seed === 0 || v === 0) return 0; const raw = lo + Math.min(hi - lo, Math.floor(u * (hi - lo + 1))); return Math.round(raw * Math.min(1, v)) || 0; };
  const juvenileSpots = (r.marks & COAT_MARK_BITS['juvenile-spots']) ? clamp((0.75 - m) / 0.4, 0, 1) : 0;
  const traits: ComposerIndividualTraits = {
    version: COMPOSER_INDIVIDUAL_VERSION, individualSeed: seed, speciesKey, sex, maturity: m, condition: r.condition,
    size: c9(z.size), limb: c9(z.limb), neck: c9(z.neck), head: c9(z.head), tail: c9(z.tail), mass: c9(z.mass), posture: c9(blend(z.carriage, 0.4, w.posture)),
    hornScale: c9(Math.max(0.05, 1 + 0.15 * v * w.horn) * sexHorn * m * m),
    hornCurl: c9(0.15 * v * w.curl),
    hornAsym: c9((w.asymSign < 0.5 ? -1 : 1) * (0.02 + 0.03 * w.asymMag) * v * (seed === 0 ? 0 : 1)),
    earScale: c9((1 + 0.075 * v * w.ear) * (1 + 0.2 * (1 - m))),
    eyeScale: c9((1 + 0.04 * v * w.eye) * (1 + 0.25 * (1 - m))),
    limbRadius: c9(1 + 0.05 * v * blend(z.mass, 0.6, w.limbR) + 0.04 * r.condition),
    segmentJitter: {fore: w.fore.map(x => c9(0.025 * v * x)) as [number, number, number], hind: w.hind.map(x => c9(0.025 * v * x)) as [number, number, number]},
    torso: {
      chest: c9(clamp(v * blend(z.mass, 0.5, w.torso[0]), -2, 2)),
      belly: c9(clamp(v * blend(z.mass, 0.5, w.torso[1]), -2, 2)),
      rump: c9(clamp(v * blend(z.mass, 0.5, w.torso[2]), -2, 2)),
      waist: c9(clamp(v * blend(z.mass, -0.4, w.torso[3]), -2, 2)),
      withers: c9(clamp(v * blend(z.neck, 0.5, w.torso[4]), -2, 2)),
    },
    // A raised neck is partly compensated by a lowered head, so the gaze stays level.
    carriage: {neck: c9(0.06 * v * z.carriage), headPitch: c9(0.04 * v * blend(z.carriage, -0.5, w.headPitch)), tail: c9(0.075 * v * blend(z.carriage, 0.3, w.tailCarriage))},
    motion: {
      phase: c9(w.phase),
      // larger individuals step slightly slower
      periodScale: c9(1 + 0.03 * v * blend(z.size, 0.5, w.period)),
      dutyDelta: c9(0.015 * v * w.duty), liftScale: c9(1 + 0.05 * v * w.lift),
      breathPhase: c9(w.breath), lookPhase: c9(w.look),
    },
    coat: {driftKey: `${speciesKey}/${seed}`, juvenileSpots: c9(juvenileSpots)},
    countScale: {osteoderm: offset(w.osteoderm, -2, 2), plate: offset(w.plate, -2, 2), feather: offset(w.feather, -1, 3)},
    allometry: {limbRobust: c9(L ** (0.09 * a)), headRel: c9(L ** (-0.12 * a)), eyeRel: c9(L ** (-0.25 * a))},
    neutral: seed === 0 && m === 1 && r.condition === 0 && sex === 'none' && a === 0,
  };
  return traits;
}

const LABEL: Partial<Record<ComposerNumberKey, [string, string]>> = {
  bodyLength: ['Body length', ' m'], girth: ['Girth', ''], legLength: ['Leg length', ''], neckLength: ['Neck length', ''],
  headSize: ['Head size', ''], snoutLength: ['Snout length', ''], tailLength: ['Tail length', ''], posture: ['Posture', ''],
};
const roundStep = (value: number, step: number) => step >= 1 ? Math.round(value) : Math.round(value / step) * step;
const fix = (value: number) => Number(value.toFixed(4));

/** Applies one individual to its species recipe. Pure; see the module note on idempotence. */
export function deriveComposerIndividual(input: ComposerRecipe): ComposerIndividual {
  const species = normalizeComposerRecipe(input).recipe;
  const pre = composerIndividualTraits(species);
  if (pre.neutral) return {recipe: {...species}, traits: pre, deltas: []};
  const out: ComposerRecipe = {...species}, deltas: string[] = [], clamps: string[] = [];
  const v = species.variability, d = species.dimorphism, m = species.maturity, sex = pre.sex;
  /** Multiplies by every term's factor, then adds `add` (for fields like posture whose neutral value can be 0). */
  const apply = (key: ComposerNumberKey, terms: [number, string][], add = 0) => {
    const factor = terms.reduce((f, [x]) => f * x, 1);
    if (factor === 1 && add === 0) return;
    const [min, max, step] = COMPOSER_RANGES[key], before = out[key] as number, raw = before * factor + add;
    const next = fix(clamp(roundStep(raw, step), min, max));
    const [label, unit] = LABEL[key]!;
    if (raw < min - step * 0.5 || raw > max + step * 0.5) clamps.push(`${label} limited to ${next.toFixed(2)}${unit} (range ${raw < min ? 'minimum' : 'maximum'}; ${raw.toFixed(3)}${unit} requested).`);
    if (next === before) return;
    (out as unknown as Record<string, number>)[key] = next;
    const why = [...terms.filter(([x]) => x !== 1).map(([x, name]) => `${name} ${x >= 1 ? '+' : ''}${((x - 1) * 100).toFixed(1)}%`), ...(add ? [`individual carriage ${add > 0 ? '+' : ''}${add.toFixed(3)}`] : [])].join(', ');
    deltas.push(`${label} ${before.toFixed(2)} → ${next.toFixed(2)}${unit} (${why}).`);
  };
  const juvenile = 1 - m, precocial = species.legs === 'unguligrade' || species.legs === 'digitigrade';
  // Body length first: allometry is evaluated at the individual's actual length.
  apply('bodyLength', [[1 + 0.045 * v * pre.size, 'individual size'], [sex === 'male' ? 1 + 0.10 * d : 1, 'male'], [0.45 + 0.55 * m, `maturity ${m}`]]);
  const headRel = composerIndividualTraits(out).allometry.headRel;
  // Linear-measure spreads of 3-8% per standard deviation: within the intraspecific range of wild populations.
  apply('legLength', [[1 + 0.045 * v * pre.limb - 0.01 * v * pre.mass, 'individual limbs'], [precocial ? 1 + 0.15 * juvenile : 1, `maturity ${m}`]]);
  apply('neckLength', [[1 + 0.065 * v * pre.neck, 'individual neck'], [0.75 + 0.25 * m, `maturity ${m}`]]);
  apply('headSize', [[1 + 0.05 * v * pre.head, 'individual head'], [1 + 0.5 * juvenile, `maturity ${m}`], [headRel, 'allometry']]);
  apply('snoutLength', [[1 + 0.06 * v * pre.head, 'individual head'], [0.7 + 0.3 * m, `maturity ${m}`]]);
  if (species.tail !== 'none') apply('tailLength', [[1 + 0.08 * v * pre.tail, 'individual tail'], [0.8 + 0.2 * m, `maturity ${m}`]]);
  apply('girth', [[1 + 0.06 * species.condition + 0.04 * v * pre.mass, 'condition and build'], [sex === 'male' ? 1 + 0.05 * d : 1, 'male']]);
  // Body pitch, about 2-5 degrees per standard deviation. Limbless, sprawled and many-legged bodies ignore posture.
  // A biped never crosses the rig's 0.6 upright threshold (that switches tail and neck carriage): it stays the species' kind of biped.
  if (species.layout === 'quadruped') apply('posture', [], 0.12 * v * pre.posture);
  if (species.layout === 'biped') {
    const p0 = species.posture, upright = p0 > 0.6;
    const p1 = clamp(p0 + 0.035 * v * pre.posture, upright ? Math.min(p0, 0.61) : 0, upright ? 1 : 0.6);
    apply('posture', [], p1 - p0);
  }
  const recipe = normalizeComposerRecipe(out).recipe;
  return {recipe, traits: composerIndividualTraits(recipe), deltas: [...deltas, ...clamps]};
}
