/**
 * Face, headgear and eye contract for the modular creature composer (fauna-composer-face-2).
 *
 * Pure: no rendering-library import, no randomness, no clock. Erasable TypeScript only (Node
 * type-strips src/*.ts), so no enums, namespaces or parameter properties. Its only runtime import is the pure,
 * import-free eye catalogue (fauna-composer-eye-catalogue.ts). It does not import the recipe module at runtime (the
 * recipe module imports this one), so it carries its own copy of the composer hash (faceHash === composerHash, tested).
 *
 * Vocabulary rules (append-only; renaming or reordering breaks encoded recipes):
 * - A face is the recipe's `head` value. 'proboscis' is the trunk face (elephant, tapir):
 *   a trunk is a nose, so it grows only from a proboscis face, and the recipe's `trunk`
 *   key is derived from the face.
 * - Headgear is built only where real animals carry it. FACE_HEADGEAR says, per face and
 *   chosen horn kind, what is built. The chosen kind stays in the recipe; a 'Horns'
 *   compatibility entry explains when the built kind differs.
 * - Eye kinds (the eye catalogue: 5 face-round kinds + 13 appended) and iris colours (9 + 3 appended) resolve per face
 *   under an eye-rules epoch (recipe key eyeRules, v4):
 *   - eyeRules 2 (current, the default for every recipe and link, also v1-v3 links): 'auto' picks the kind from the
 *     anatomy (never from colour), and every explicit kind is built on every face (odd combinations are allowed).
 *   - eyeRules 1 ("Earlier eye rules", fauna-composer-face-1, frozen): the face round's auto table and iris hash, and
 *     its face table for the five face-round kinds (a face-round kind the face could not have is built as auto and
 *     disclosed). A catalogue kind chosen explicitly is built as chosen under both epochs.
 *   The iris band comes from a hash of colorSeed and face (and kind, for catalogue kinds).
 *
 * fauna-composer-face-2 changes only eye resolution (eye catalogue EC1): headgear and the trunk rules are unchanged.
 */
import {
  CATALOGUE_IRIS_RGB, COMPOSER_EYE_KINDS, EYE_IRIS_IDS, EYE_PRESETS, composerEyeStandIn, eyeKindHasIris, isFaceRoundEyeKind,
  type ComposerEyeKind, type EyeTraits, type FaceRoundEyeKind,
} from './fauna-composer-eye-catalogue.ts';

export const COMPOSER_FACE_VERSION = 'fauna-composer-face-2';

/** Eye choices: 'auto' (resolved per face) then the 18 catalogue kinds. */
export const COMPOSER_EYE_TYPES = ['auto', ...COMPOSER_EYE_KINDS] as const;
export type ComposerEyeType = typeof COMPOSER_EYE_TYPES[number];
/** An eye kind that is built (every catalogue kind). */
export type BuiltEyeType = ComposerEyeKind;
export type {ComposerEyeKind, FaceRoundEyeKind, EyeTraits};

/** Eye-rules epochs (recipe key eyeRules). 2 is current; 1 is the face round's, kept selectable as "Earlier eye rules". */
export const COMPOSER_EYE_RULES = [1, 2] as const;
export type ComposerEyeRules = typeof COMPOSER_EYE_RULES[number];
export const COMPOSER_EYE_RULES_CURRENT: ComposerEyeRules = 2;
/** The epoch a recipe resolves with: 1 only when it says 1, otherwise the current rules. */
export function composerEyeRulesOf(r: {eyeRules?: number}): ComposerEyeRules {
  return r.eyeRules === 1 ? 1 : 2;
}

/** Iris colours. 'auto' resolves to one of the face's (or kind's) bands. */
export const COMPOSER_IRIS = ['auto', ...EYE_IRIS_IDS] as const;
export type IrisId = typeof COMPOSER_IRIS[number];
export type BuiltIrisId = Exclude<IrisId, 'auto'>;
/** Linear-RGB iris table. The first nine are the face round's (frozen, pinned by skin-3); 3 appended. */
export const COMPOSER_IRIS_RGB: Readonly<Record<BuiltIrisId, readonly [number, number, number]>> = Object.freeze({
  'dark-brown': [0.035, 0.018, 0.008], brown: [0.09, 0.045, 0.015], amber: [0.40, 0.20, 0.03], gold: [0.55, 0.38, 0.06], yellow: [0.70, 0.55, 0.05],
  orange: [0.70, 0.25, 0.03], red: [0.50, 0.04, 0.02], green: [0.18, 0.28, 0.06], pale: [0.55, 0.55, 0.50],
  ...CATALOGUE_IRIS_RGB,
});

/** Every face, in the recipe's head-choice order ('proboscis' appended). */
export const COMPOSER_FACES = ['muzzle', 'jaws', 'beak', 'flat-face', 'blunt', 'mandibles', 'proboscis'] as const;
export type ComposerFace = typeof COMPOSER_FACES[number];
export const COMPOSER_HORNS = ['none', 'nasal', 'paired', 'ossicones', 'crest'] as const;
export type ComposerHorn = typeof COMPOSER_HORNS[number];
/** The skull the rig and mesh build. Until WP5 builds a real proboscis face, it builds the muzzle skull. */
export type ComposerSkull = 'muzzle' | 'jaws' | 'beak' | 'flat-face' | 'blunt' | 'mandibles';
export function composerSkullOf(face: ComposerFace): ComposerSkull {
  return face === 'proboscis' ? 'muzzle' : face;
}

/** The recipe fields this module reads (a full ComposerRecipe satisfies it). */
export interface ComposerFaceInput {
  head: ComposerFace;
  horns: ComposerHorn;
  layout: string;
  legs: string;
  feet: string;
  bodyLength: number;
  colorSeed: number;
  eyes: ComposerEyeType;
  iris: IrisId;
  /** Walking leg pairs (eyeRules 2 tells spiders and insects apart by it). */
  legPairs: number;
  /** Eye-rules epoch (recipe v4); absent = current (2). */
  eyeRules?: number;
}
export interface ComposerFaceConstraint { part: string; chosen: string; effect: string }

export type BuiltHeadgear = 'none' | 'nasal' | 'paired' | 'ossicones' | 'crest';
export interface HeadgearBuild { built: BuiltHeadgear; effect: string | null }
const keep = (built: BuiltHeadgear): HeadgearBuild => ({built, effect: null});
const omit = (effect: string): HeadgearBuild => ({built: 'none', effect});
const MAMMAL_CREST = 'Not built: mammal skulls carry no bony crest.';
const BEAK_HORN = 'Not built: birds and turtles never grow horns; only a casque (Crest).';
const flat = (effect: string): Record<ComposerHorn, HeadgearBuild> => ({none: keep('none'), nasal: omit(effect), paired: omit(effect), ossicones: omit(effect), crest: omit(effect)});
/** What is built for each face and chosen horn kind. `effect` is null exactly when built === chosen
 * (beak + crest builds the crest as a casque; the UI labels that option 'Crest or casque'). */
export const FACE_HEADGEAR: Readonly<Record<ComposerFace, Readonly<Record<ComposerHorn, HeadgearBuild>>>> = Object.freeze({
  muzzle: {none: keep('none'), nasal: keep('nasal'), paired: keep('paired'), ossicones: keep('ossicones'),
    crest: omit(`${MAMMAL_CREST} Choose Paired horns or Ossicones.`)},
  proboscis: {none: keep('none'), paired: keep('paired'),
    nasal: omit('Not built: a trunk face has no nose bones to carry a horn.'),
    ossicones: omit('Not built: ossicones grow only on giraffe-like muzzles.'),
    crest: omit(MAMMAL_CREST)},
  jaws: {none: keep('none'), nasal: keep('nasal'), paired: keep('paired'), crest: keep('crest'),
    ossicones: {built: 'paired', effect: 'Built as brow horns: ossicones grow only on giraffe-like muzzles.'}},
  beak: {none: keep('none'), crest: keep('crest'),
    nasal: {built: 'crest', effect: 'Built as a casque: a beak carries a casque, not a nose horn.'},
    paired: omit(BEAK_HORN), ossicones: omit(BEAK_HORN)},
  'flat-face': flat('Not built: primate faces carry no horns.'),
  blunt: flat('Not built: a worm head has no skull to carry horns.'),
  mandibles: flat('Not built: arthropod heads carry no bony horns.'),
});
export function composerHeadgearBuild(recipe: Pick<ComposerFaceInput, 'head' | 'horns'>): HeadgearBuild {
  const row = FACE_HEADGEAR[recipe.head], cell = row?.[recipe.horns];
  return cell ? {...cell} : keep('none');
}

const VERTEBRATE_EYES: readonly FaceRoundEyeKind[] = ['round', 'horizontal', 'vertical-slit'];
/** The face round's table (eyeRules 1): the face-round kinds each face could build ('auto' is always allowed). Under
 * eyeRules 1 a face-round kind outside it is built as the auto kind and disclosed. Under eyeRules 2 every kind is built
 * on every face; this table is then only history. */
export const FACE_EYES: Readonly<Record<ComposerFace, readonly FaceRoundEyeKind[]>> = Object.freeze({
  muzzle: VERTEBRATE_EYES, proboscis: VERTEBRATE_EYES, jaws: VERTEBRATE_EYES, beak: VERTEBRATE_EYES, 'flat-face': VERTEBRATE_EYES,
  blunt: ['eyespot'], mandibles: ['compound'],
});

/** Eye placement profile per face (or face sub-case): gaze yaw from the midline in degrees, and the eye
 * radius factor k (er = k x craniumHeight x eyeScale x eyeRel). The mesh reads these.
 * Compound eyes and eyespots take their size from their own face geometry: k 0 means "not k-sized".
 * The face round's nine entries are frozen; 'mandibles-camera' and 'blunt-camera' (appended, eyeRules 2) size a
 * lidded camera eye chosen on an arthropod or worm head. They are larger than the vertebrate profiles (k 0.15/0.14 read
 * as "a tiny dark point" on the ink centipede, GPT Luna 6 FAIL, EC1 review round 3): an arthropod or worm head is small
 * and dark, and the camera eye there is an odd combination that must read at normal size. */
export const FACE_EYE_PROFILE = Object.freeze({
  'flat-face': {gazeYawDeg: 15, k: 0.13},
  'muzzle-carnivore': {gazeYawDeg: 35, k: 0.13},
  'muzzle-grazer': {gazeYawDeg: 65, k: 0.14},
  'jaws-upright': {gazeYawDeg: 45, k: 0.13},
  'jaws-sprawled': {gazeYawDeg: 70, k: 0.13},
  proboscis: {gazeYawDeg: 70, k: 0.07},
  beak: {gazeYawDeg: 75, k: 0.16},
  mandibles: {gazeYawDeg: 90, k: 0},
  blunt: {gazeYawDeg: 20, k: 0},
  'mandibles-camera': {gazeYawDeg: 70, k: 0.21},
  'blunt-camera': {gazeYawDeg: 35, k: 0.19},
} as const satisfies Record<string, {gazeYawDeg: number; k: number}>);
export type ComposerEyeProfileId = keyof typeof FACE_EYE_PROFILE;
/* An eyespot off a worm head is stood in by an iris-less round eye at the face's OWN camera-eye size (profile k), the
 * size the face round built for an old link that chose Eyespots on that face. A half-size bead (k 0.065, removed) made
 * those upgraded links' eyes "tiny dark specks ... marks on the coat" (GPT Luna 6, EC1 review 2026-10-03). The
 * eye-geometry package (EC2) owns the real eyespot geometry and size when it replaces this stand-in. */

/** Grazer proxy: hooves, tip-toe hooved legs, or pillar legs (rhino-like herbivores). */
const grazer = (r: Pick<ComposerFaceInput, 'legs' | 'feet'>) => r.feet === 'hoof' || r.legs === 'unguligrade' || r.legs === 'pillar';
const sprawledJaws = (r: Pick<ComposerFaceInput, 'layout'>) => r.layout === 'sprawled' || r.layout === 'limbless';
/** The face's own profile (the face round's choice). With `built` (the face-round stand-in the mesh builds), a camera
 * eye on an arthropod or worm head takes the appended camera profiles, and a compound dome or eyespot on any other
 * face takes the mandibles or blunt profile; without it, exactly the face round's table. */
export function composerEyeProfileId(r: Pick<ComposerFaceInput, 'head' | 'layout' | 'legs' | 'feet'>, built?: FaceRoundEyeKind): ComposerEyeProfileId {
  if (built === 'compound') return 'mandibles';
  if (built === 'eyespot') return 'blunt';
  if (built && (r.head === 'mandibles' || r.head === 'blunt')) return r.head === 'mandibles' ? 'mandibles-camera' : 'blunt-camera';
  switch (r.head) {
    case 'muzzle': return grazer(r) ? 'muzzle-grazer' : 'muzzle-carnivore';
    case 'jaws': return sprawledJaws(r) ? 'jaws-sprawled' : 'jaws-upright';
    default: return r.head;
  }
}

type AutoInput = Pick<ComposerFaceInput, 'head' | 'layout' | 'legs' | 'feet' | 'bodyLength'> & {legPairs?: number; eyeRules?: number};
/** Eye rules 1 (fauna-composer-face-1, frozen): the face round's auto table. */
function autoEyeRules1(r: AutoInput): FaceRoundEyeKind {
  switch (r.head) {
    case 'mandibles': return 'compound';
    case 'blunt': return 'eyespot';
    case 'beak': case 'flat-face': case 'proboscis': return 'round';
    case 'muzzle':
      if (r.feet === 'hoof' || r.legs === 'unguligrade') return 'horizontal';
      if (r.legs === 'pillar') return 'round';
      return r.bodyLength < 0.9 ? 'vertical-slit' : 'round';
    case 'jaws': return sprawledJaws(r) ? 'vertical-slit' : 'round';
    default: return 'round';
  }
}
/** Eye rules 2 (eye catalogue v2): spiders and insects on mandibles, cat eyes on small carnivore muzzles, crocodile
 * eyes on large sprawled jaws; everything else as rules 1. */
function autoEyeRules2(r: AutoInput): ComposerEyeKind {
  switch (r.head) {
    case 'mandibles':
      if (r.layout === 'many-legged' && r.legPairs === 4) return 'spider';
      if (r.layout !== 'many-legged' || r.legPairs === 3) return 'insect';
      return 'compound';
    case 'muzzle':
      if (r.feet === 'hoof' || r.legs === 'unguligrade') return 'horizontal';
      if (r.legs === 'pillar') return 'round';
      return r.bodyLength < 0.9 ? 'cat' : 'round';
    case 'jaws':
      if (r.layout === 'sprawled' && r.bodyLength >= 1.0) return 'crocodile';
      return sprawledJaws(r) ? 'vertical-slit' : 'round';
    default: return autoEyeRules1(r);
  }
}
/** The eye kind 'auto' builds. Depends on anatomy only (face, layout, leg pairs, legs, feet, body length) and the
 * rules epoch (default: the recipe's eyeRules, else current), never on colour. */
export function composerAutoEyeType(r: AutoInput, rules: ComposerEyeRules = composerEyeRulesOf(r)): ComposerEyeKind {
  return rules === 1 ? autoEyeRules1(r) : autoEyeRules2(r);
}

/** Iris bands 'auto' chooses from, per face and built kind. Empty: the eye has no iris. A face-round kind takes the
 * face round's per-face bands (frozen); a catalogue camera kind its preset's bands. */
export function composerIrisBands(r: Pick<ComposerFaceInput, 'head' | 'layout'>, built: ComposerEyeKind): readonly BuiltIrisId[] {
  if (!eyeKindHasIris(built)) return [];
  if (!isFaceRoundEyeKind(built)) return EYE_PRESETS[built].irisBands ?? ['dark-brown'];
  switch (r.head) {
    case 'muzzle': return built === 'vertical-slit' ? ['amber', 'gold'] : ['dark-brown', 'brown'];
    case 'proboscis': return ['dark-brown'];
    case 'jaws': return ['gold', 'amber', 'orange', 'green'];
    case 'beak': return r.layout === 'sprawled' ? ['dark-brown', 'green'] : ['yellow', 'orange', 'red', 'dark-brown'];
    case 'flat-face': return ['dark-brown', 'brown'];
    // a face-round camera kind on an arthropod or worm head (eyeRules 2 only; the face round never built one): a bright
    // band, because those heads are small and usually dark (dark-brown read as "a tiny dark point", EC1 review round 3)
    case 'mandibles': case 'blunt': return ['amber', 'gold'];
    default: return ['dark-brown'];
  }
}

/** The kind whose iris bands and hash an 'auto' iris uses. An automatic catalogue camera eye is always the eyeRules-2
 * refinement of the face round's automatic kind (cat for vertical-slit on a small carnivore muzzle, crocodile for
 * vertical-slit on large sprawled jaws), so it keeps the face round's bands and hash (face-eye-v1): an upgraded link's
 * iris colour never changes. Rehashing over the preset bands moved 8 legacy links to a darker band (cat gold -> amber,
 * crocodile amber -> grey-green), which GPT Luna 6 judged less readable at normal size (EC1 review, 2026-10-03). An
 * explicitly chosen kind uses its preset's own bands. */
export function composerIrisKind(r: AutoInput & Pick<ComposerFaceInput, 'eyes'>, kind: ComposerEyeKind): ComposerEyeKind {
  if (r.eyes !== 'auto' || isFaceRoundEyeKind(kind) || !eyeKindHasIris(kind)) return kind;
  const earlier = autoEyeRules1(r);
  return eyeKindHasIris(earlier) ? earlier : kind;
}

/** Same algorithm as composerHash (fauna-composer-recipe.ts); duplicated to keep this module free of the recipe module. */
export function faceHash(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface ResolvedComposerEyes {
  /** The recipe's eye choice ('auto' or an explicit kind). */
  chosen: ComposerEyeType;
  /** The eye-rules epoch the choice resolved with. */
  rules: ComposerEyeRules;
  /** The catalogue kind built. */
  kind: ComposerEyeKind;
  /** Its frozen traits (EYE_PRESETS[kind]). */
  traits: Readonly<EyeTraits>;
  /** The face round's kind that fauna-composer-eye-1 builds for `kind` on this face (composerEyeStandIn): equal to
   * `kind` for the five face-round kinds. The current mesh builds this; the catalogue geometry (EC2) reads kind/traits. */
  built: FaceRoundEyeKind;
  /** True when the choice was 'auto'. */
  auto: boolean;
  /** The recipe's iris choice ('auto' or an explicit colour). */
  iris: IrisId;
  /** The iris colour actually built; null for eyes without an iris (compound, simple eyes, eyespots, stalks). */
  irisBuilt: BuiltIrisId | null;
  /** The face profile of the built stand-in (composerEyeProfileId(r, built)); a kind's own placement is in traits. */
  gazeYawDeg: number;
  k: number;
  /** Why the built eye differs from an explicit choice; null when it does not (always null under eyeRules 2). */
  effect: string | null;
}
const NO_COMPOUND = 'compound eyes belong to arthropod heads.';
const NO_EYESPOT = 'eyespots belong to worm heads.';
/** Resolves the eye kind and iris actually built. Pure; colorSeed only picks the iris band. */
export function resolveComposerEyes(r: ComposerFaceInput): ResolvedComposerEyes {
  const rules = composerEyeRulesOf(r), auto = composerAutoEyeType(r, rules), chosen = r.eyes;
  let kind: ComposerEyeKind = auto, effect: string | null = null;
  if (chosen !== 'auto') {
    if (rules === 2 || !isFaceRoundEyeKind(chosen) || FACE_EYES[r.head]?.includes(chosen)) kind = chosen;
    else if (r.head === 'mandibles') effect = 'Built as compound: arthropod heads have compound eyes.';
    else if (r.head === 'blunt') effect = 'Built as eyespot: a worm head has only pigment eyespots.';
    else effect = `Built as ${auto}: ${chosen === 'compound' ? NO_COMPOUND : NO_EYESPOT}`;
  }
  const irisKind = composerIrisKind(r, kind), bands = composerIrisBands(r, irisKind);
  let irisBuilt: BuiltIrisId | null = null;
  if (bands.length) irisBuilt = r.iris !== 'auto' ? r.iris
    : isFaceRoundEyeKind(irisKind) ? bands[faceHash(`face-eye-v1/${r.colorSeed}/${r.head}`) % bands.length]!
    : bands[faceHash(`face-eye-v2/${r.colorSeed}/${r.head}/${kind}`) % bands.length]!;
  const built = composerEyeStandIn(kind, r.head);
  // an eyespot off a worm head stands in as an iris-less round eye at the face's own size (see the note above)
  const profile = FACE_EYE_PROFILE[composerEyeProfileId(r, built)];
  return {chosen, rules, kind, traits: EYE_PRESETS[kind], built, auto: chosen === 'auto', iris: r.iris, irisBuilt, gazeYawDeg: profile.gazeYawDeg, k: profile.k, effect};
}

/** Face compatibility entries: horns not built (or built as another kind), an eye type the face cannot have,
 * and an iris colour on an eye without an iris. Under eyeRules 2 every eye kind is built, so only
 * eyeRules 1 links can carry an 'Eyes' entry. */
export function composerFaceConstraints(r: ComposerFaceInput): ComposerFaceConstraint[] {
  const out: ComposerFaceConstraint[] = [];
  const hg = composerHeadgearBuild(r);
  if (hg.built !== r.horns) out.push({part: 'Horns', chosen: r.horns, effect: hg.effect!});
  const eyes = resolveComposerEyes(r);
  if (eyes.effect) out.push({part: 'Eyes', chosen: r.eyes, effect: eyes.effect});
  if (r.iris !== 'auto' && eyes.irisBuilt === null) out.push({part: 'Iris colour', chosen: r.iris, effect: eyes.rules === 1 && isFaceRoundEyeKind(eyes.kind)
    ? 'Iris colour has no effect: compound eyes and eyespots have no iris.'
    : 'Iris colour has no effect: compound eyes, simple eyes, eye stalks and eyespots have no iris.'});
  return out;
}

const LEGACY_FACES: readonly string[] = ['muzzle', 'jaws', 'beak', 'flat-face', 'blunt', 'mandibles'];
/** Legacy (recipe v1/v2) migration of the trunk into the face. Mutates `source` (pass a copy) and appends
 * the explanation to `issues`. A trunk on a muzzle (or on a missing/unknown head, which built a muzzle)
 * becomes Face = Proboscis; a trunk on any other face is removed and the face kept. */
export function migrateLegacyFace(source: Record<string, unknown>, issues: string[]): void {
  if (source.trunk !== 'trunk') return;
  const head = typeof source.head === 'string' && LEGACY_FACES.includes(source.head) ? source.head : 'muzzle';
  if (head === 'muzzle') {
    source.head = 'proboscis';
    issues.push('Trunk: now a face type; this muzzle became Face = Proboscis.');
  } else {
    source.trunk = 'none';
    issues.push(`Trunk: removed. A trunk is a nose and only grows on a mammal muzzle; this ${head} face is kept. Choose Face -> Proboscis for a trunk.`);
  }
}

/** The anatomy the species key hashes: a proboscis face projects to the legacy muzzle (+ derived trunk),
 * so migrated muzzle+trunk links keep their species key and herds. */
export function composerAnatomyProjection<T extends {head: string}>(recipe: T): T {
  return recipe.head === 'proboscis' ? {...recipe, head: 'muzzle'} : recipe;
}
