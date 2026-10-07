/**
 * Eye catalogue for the modular creature composer (fauna-composer-eye-catalogue-1; eye round EC1).
 *
 * Pure: no imports at all, no rendering library, no randomness, no clock. Erasable TypeScript only (Node type-strips
 * src/*.ts), so no enums, namespaces or parameter properties.
 *
 * An eye KIND is a named, frozen preset over a small tuple of independent traits (structure, pupil, size, placement,
 * lid, brow, sclera, iris pattern, extras, count, eyeshine, iris bands). The recipe stores only the kind name
 * (`eyes`), never a trait: the owner asked for recognisable kinds, not an eye editor (no "Advanced eyes" panel).
 * The geometry code reads traits, never kind names, except to dispatch to a builder.
 *
 * Vocabulary rules (append-only; renaming or reordering breaks encoded recipes):
 * - The first five kinds are the face round's (fauna-composer-face-1). Their traits describe exactly what
 *   fauna-composer-eye-1 builds today.
 * - The thirteen kinds after them are the eye catalogue v2 (design 2026-10-03). Every number below is a design value
 *   to tune in the geometry package (EC2); only its direction (bigger, more frontal, dorsal) comes from the research.
 * - Every kind is built on every face when chosen (owner decision 2026-10-03: odd combinations such as a cuttlefish W
 *   on a horse are allowed and built). `nativeFaces` only says where a kind is at home; it never suppresses a build.
 * - Eyeshine is metadata in this round; nothing renders it.
 */

export const COMPOSER_EYE_CATALOGUE_VERSION = 'fauna-composer-eye-catalogue-1';

/** The face round's eye kinds (fauna-composer-face-1), in their recipe order. */
export const FACE_ROUND_EYE_KINDS = ['round', 'horizontal', 'vertical-slit', 'compound', 'eyespot'] as const;
export type FaceRoundEyeKind = typeof FACE_ROUND_EYE_KINDS[number];
/** The eye catalogue v2 kinds, appended after the face round's. */
export const CATALOGUE_EYE_KINDS = ['raptor', 'owl', 'cat', 'gecko', 'frog', 'chameleon', 'crocodile', 'sclera', 'nocturnal', 'cephalopod', 'insect', 'spider', 'stalk'] as const;
export type CatalogueEyeKind = typeof CATALOGUE_EYE_KINDS[number];
/** Every buildable eye kind (18), in recipe order. */
export const COMPOSER_EYE_KINDS = [...FACE_ROUND_EYE_KINDS, ...CATALOGUE_EYE_KINDS] as const;
export type ComposerEyeKind = typeof COMPOSER_EYE_KINDS[number];

/** Built iris colours: the face round's nine (frozen RGB), then the catalogue's 3 (appended). */
export const FACE_ROUND_IRIS_IDS = ['dark-brown', 'brown', 'amber', 'gold', 'yellow', 'orange', 'red', 'green', 'pale'] as const;
export const CATALOGUE_IRIS_IDS = ['blue', 'copper', 'grey-green'] as const;
export const EYE_IRIS_IDS = [...FACE_ROUND_IRIS_IDS, ...CATALOGUE_IRIS_IDS] as const;
export type EyeIrisId = typeof EYE_IRIS_IDS[number];
/** Linear RGB of the appended iris colours (the face round's nine stay in fauna-composer-face.ts, frozen). */
export const CATALOGUE_IRIS_RGB: Readonly<Record<typeof CATALOGUE_IRIS_IDS[number], readonly [number, number, number]>> = Object.freeze({
  blue: [0.10, 0.22, 0.40], copper: [0.48, 0.13, 0.02], 'grey-green': [0.26, 0.30, 0.13],
});

/** The composer faces (the recipe's `head` values), duplicated here to keep this module import-free. */
export type EyeCatalogueFace = 'muzzle' | 'jaws' | 'beak' | 'flat-face' | 'blunt' | 'mandibles' | 'proboscis';

// ---- trait vocabulary ---------------------------------------------------------------------------------------------
/** camera = lidded vertebrate or cephalopod eye; compound = facet dome; ocellus = simple lens bead (spider eyes, insect
 * ocelli); eyespot = flush pigment disc; stalk = an eye on a tapered stalk (until EC2 builds it, its tip stands in as an
 * eyespot on a worm head and a compound dome on any other face, see composerEyeStandIn). */
export const EYE_STRUCTURES = ['camera', 'compound', 'ocellus', 'eyespot', 'stalk'] as const;
export type EyeStructure = typeof EYE_STRUCTURES[number];
/** Shape of the pupil ring. The first 3 are the face round's exact shapes. */
export const EYE_PUPILS = ['round', 'horizontal', 'vertical-slit', 'slit-wide', 'beaded-slit', 'w', 'pinhole', 'dilated', 'none'] as const;
export type EyePupil = typeof EYE_PUPILS[number];
/** face = the face's own profile (FACE_EYE_PROFILE yaw, the mesh's default pitch); the others override yaw and/or pitch.
 * independent = the left and right eyes look different ways (chameleon); stalk = on a stalk (yaw and pitch of the stalk). */
export const EYE_PLACEMENTS = ['face', 'frontal', 'forward', 'lateral', 'dorsal', 'independent', 'stalk'] as const;
export type EyePlacementKind = typeof EYE_PLACEMENTS[number];
export const EYE_LIDS = ['almond', 'round', 'wide-almond', 'spectacle', 'turret', 'none'] as const;
export type EyeLid = typeof EYE_LIDS[number];
/** Deformations of the existing outer-lid and orbit rings (no new triangles). */
export const EYE_BROWS = ['none', 'shelf', 'raised-orbit', 'raised-orbit-shelf', 'disc'] as const;
export type EyeBrow = typeof EYE_BROWS[number];
export const EYE_SCLERAS = ['hidden', 'white'] as const;
export type EyeSclera = typeof EYE_SCLERAS[number];
export const EYE_IRIS_PATTERNS = ['plain', 'radial', 'reticulated', 'reticulated-faint'] as const;
export type EyeIrisPattern = typeof EYE_IRIS_PATTERNS[number];
export const EYE_EXTRAS = ['none', 'nictitating', 'nictitating-lower', 'ocelli', 'stalk'] as const;
export type EyeExtra = typeof EYE_EXTRAS[number];
export const EYE_COUNTS = ['pair', 'pair+3', '8'] as const;
export type EyeCount = typeof EYE_COUNTS[number];
/** Metadata only in this round (a later planet-lighting round may render it). */
export const EYE_SHINES = ['none', 'green-gold', 'silver-white', 'red-orange'] as const;
export type EyeShine = typeof EYE_SHINES[number];
/** The Lab groups its Eyes select by these. */
export const EYE_GROUPS = ['pupil', 'animal', 'arthropod'] as const;
export type EyeGroup = typeof EYE_GROUPS[number];

export interface EyePlacement {
  kind: EyePlacementKind;
  /** Gaze yaw from the forward midline in degrees; null = the face profile's yaw. */
  yawDeg: number | null;
  /** Gaze pitch above the head's long axis in degrees; null = the mesh's default pitch for this structure. */
  pitchDeg: number | null;
  /** 'independent' only: the right eye's own yaw and pitch (the fields above are the left eye's). */
  right?: {yawDeg: number; pitchDeg: number};
  /** Per-face yaw overrides (nocturnal: frontal on a flat face, less so on a muzzle). */
  yawByFace?: Partial<Record<EyeCatalogueFace, number>>;
}
export interface EyeTraits {
  kind: ComposerEyeKind;
  /** Lab option label. */
  label: string;
  group: EyeGroup;
  structure: EyeStructure;
  pupil: EyePupil;
  /** Pupil shape numbers in eye radii (er); null = the face round's EYE_PATCH constants. */
  pupilShape: Readonly<Record<string, number>> | null;
  /** Size multiplier m on the face's k (er = k x m x craniumHeight x eyeScale x eyeRel). 1 = the face round. */
  size: number;
  placement: EyePlacement;
  lid: EyeLid;
  /** Lid opening numbers in er; null = the face round's almond (w 1, above .72, below .62). */
  lidShape: Readonly<Record<string, number>> | null;
  brow: EyeBrow;
  sclera: EyeSclera;
  irisPattern: EyeIrisPattern;
  extras: EyeExtra;
  count: EyeCount;
  eyeshine: EyeShine;
  /** Per-face eyeshine overrides (nocturnal: silver-white on a muzzle, none on a flat face). */
  eyeshineByFace?: Partial<Record<EyeCatalogueFace, EyeShine>>;
  /** Iris colours an 'auto' iris picks from when this kind is chosen explicitly. null: the face round's per-face bands
   * (composerIrisBands); an empty list: the eye has no iris. An automatic eye keeps the face round's bands and hash
   * (composerIrisKind in fauna-composer-face.ts), so an upgraded link never changes iris colour. */
  irisBands: readonly EyeIrisId[] | null;
  /** Where real animals carry this kind; a hint only, never a build restriction. */
  nativeFaces: readonly EyeCatalogueFace[];
  /** The face round's kind that fauna-composer-eye-1 builds for it until the catalogue geometry lands (stalk: see
   * composerEyeStandIn, it depends on the face). Face-round kinds are their own stand-in. */
  standIn: FaceRoundEyeKind;
}

const VERTEBRATE_FACES: readonly EyeCatalogueFace[] = ['muzzle', 'jaws', 'beak', 'flat-face', 'proboscis'];
const FACE: EyePlacement = Object.freeze({kind: 'face', yawDeg: null, pitchDeg: null});
const NO_IRIS: readonly EyeIrisId[] = Object.freeze([]);
type Preset = Omit<EyeTraits, 'kind'>;
const camera = (p: Partial<Preset> & Pick<Preset, 'label' | 'group' | 'standIn' | 'nativeFaces'>): Preset => ({
  structure: 'camera', pupil: 'round', pupilShape: null, size: 1, placement: FACE, lid: 'almond', lidShape: null, brow: 'none', sclera: 'hidden',
  irisPattern: 'plain', extras: 'none', count: 'pair', eyeshine: 'none', irisBands: null, ...p,
});
const other = (p: Partial<Preset> & Pick<Preset, 'label' | 'group' | 'standIn' | 'nativeFaces' | 'structure'>): Preset => ({
  pupil: 'none', pupilShape: null, size: 1, placement: FACE, lid: 'none', lidShape: null, brow: 'none', sclera: 'hidden',
  irisPattern: 'plain', extras: 'none', count: 'pair', eyeshine: 'none', irisBands: NO_IRIS, ...p,
});

const PRESETS: Readonly<Record<ComposerEyeKind, Preset>> = {
  // ---- the face round's five kinds (frozen: they describe fauna-composer-eye-1 exactly)
  round: camera({label: 'Round (birds, primates, large predators)', group: 'pupil', standIn: 'round', nativeFaces: ['beak', 'flat-face', 'proboscis', 'muzzle', 'jaws']}),
  horizontal: camera({label: 'Horizontal bar (goat, horse, deer, octopus)', group: 'pupil', standIn: 'horizontal', pupil: 'horizontal', eyeshine: 'silver-white',
    nativeFaces: ['muzzle', 'proboscis']}),
  'vertical-slit': camera({label: 'Vertical slit (fox, viper, small lizard)', group: 'pupil', standIn: 'vertical-slit', pupil: 'vertical-slit', nativeFaces: ['muzzle', 'jaws']}),
  compound: other({label: 'Compound (centipede, generic arthropod)', group: 'arthropod', standIn: 'compound', structure: 'compound', nativeFaces: ['mandibles']}),
  eyespot: other({label: 'Eyespots (worm)', group: 'arthropod', standIn: 'eyespot', structure: 'eyespot', nativeFaces: ['blunt']}),
  // ---- eye catalogue v2
  raptor: camera({label: 'Raptor (eagle, hawk, falcon)', group: 'animal', standIn: 'round', size: 1.15,
    placement: {kind: 'forward', yawDeg: 55, pitchDeg: 0}, lidShape: {w: 1, above: 0.55, below: 0.62}, brow: 'shelf',
    irisBands: ['yellow', 'gold', 'brown', 'orange', 'red'], nativeFaces: ['beak', 'jaws']}),
  owl: camera({label: 'Owl (huge frontal eyes, facial disc)', group: 'animal', standIn: 'round', pupil: 'dilated', pupilShape: {r: 0.45}, size: 1.6,
    placement: {kind: 'frontal', yawDeg: 12, pitchDeg: 0}, lid: 'round', lidShape: {w: 0.95, above: 0.9, below: 0.9}, brow: 'disc',
    irisBands: ['yellow', 'orange', 'dark-brown'], nativeFaces: ['beak']}),
  cat: camera({label: 'Cat (large, mid-width slit)', group: 'animal', standIn: 'vertical-slit', pupil: 'slit-wide', pupilShape: {rx: 0.12, ry: 0.48, point: 0.6}, size: 1.25,
    placement: {kind: 'forward', yawDeg: 30, pitchDeg: null}, lidShape: {w: 1, above: 0.72, below: 0.62, cornerUpDeg: 8}, irisPattern: 'radial', eyeshine: 'green-gold',
    irisBands: ['gold', 'yellow', 'green', 'amber', 'copper', 'blue'], nativeFaces: ['muzzle']}),
  gecko: camera({label: 'Gecko (beaded slit, lidless)', group: 'animal', standIn: 'vertical-slit', pupil: 'beaded-slit', pupilShape: {beads: 5, bead: 0.07, pinch: 0.022, ry: 0.48}, size: 1.4,
    lid: 'spectacle', lidShape: {w: 0.95, above: 0.9, below: 0.9}, irisPattern: 'reticulated',
    irisBands: ['gold', 'pale', 'green', 'copper', 'grey-green'], nativeFaces: ['jaws']}),
  frog: camera({label: 'Frog or toad (bulging dorsal eyes)', group: 'animal', standIn: 'horizontal', pupil: 'horizontal', pupilShape: {rx: 0.48, ry: 0.22, n: 2.6}, size: 1.45,
    placement: {kind: 'dorsal', yawDeg: 55, pitchDeg: 35}, brow: 'raised-orbit', irisPattern: 'reticulated', extras: 'nictitating-lower',
    irisBands: ['gold', 'amber', 'copper', 'red', 'green'], nativeFaces: ['jaws']}),
  chameleon: camera({label: 'Chameleon (turret eyes, independent gaze)', group: 'animal', standIn: 'round', pupil: 'pinhole', pupilShape: {r: 0.09, iris: 0.16, limbus: 0.2}, size: 1.5,
    placement: {kind: 'independent', yawDeg: 35, pitchDeg: -8, right: {yawDeg: 110, pitchDeg: 12}}, lid: 'turret', lidShape: {w: 0.22, above: 0.22, below: 0.22, turretW: 0.8, turretLift: 0.55},
    irisBands: ['gold', 'dark-brown'], nativeFaces: ['jaws']}),
  crocodile: camera({label: 'Crocodile (slit on raised orbits, third eyelid)', group: 'animal', standIn: 'vertical-slit', pupil: 'vertical-slit', size: 1.1,
    placement: {kind: 'dorsal', yawDeg: 60, pitchDeg: 30}, brow: 'raised-orbit-shelf', irisPattern: 'reticulated-faint', extras: 'nictitating', eyeshine: 'red-orange',
    irisBands: ['gold', 'grey-green', 'pale', 'amber'], nativeFaces: ['jaws']}),
  sclera: camera({label: 'Human-like (white sclera)', group: 'animal', standIn: 'round', pupilShape: {r: 0.2, iris: 0.44, limbus: 0.52}, lid: 'wide-almond',
    lidShape: {w: 1.25, above: 0.5, below: 0.45}, sclera: 'white', irisPattern: 'radial',
    irisBands: ['dark-brown', 'brown', 'amber', 'green', 'blue', 'grey-green'], nativeFaces: ['flat-face']}),
  nocturnal: camera({label: 'Nocturnal (huge, wide pupils: tarsier, bushbaby)', group: 'animal', standIn: 'round', pupil: 'dilated', pupilShape: {r: 0.58, iris: 0.72, limbus: 0.9}, size: 1.75,
    placement: {kind: 'frontal', yawDeg: null, pitchDeg: null, yawByFace: {'flat-face': 10, muzzle: 30}}, lid: 'round', lidShape: {w: 1, above: 0.85, below: 0.8},
    eyeshine: 'silver-white', eyeshineByFace: {'flat-face': 'none'}, irisBands: ['brown', 'amber', 'gold'], nativeFaces: ['flat-face', 'muzzle']}),
  cephalopod: camera({label: 'Cuttlefish (W-shaped pupil)', group: 'animal', standIn: 'horizontal', pupil: 'w', pupilShape: {iris: 0.72, limbus: 0.92}, size: 1.4,
    placement: {kind: 'lateral', yawDeg: 80, pitchDeg: null}, lid: 'round', lidShape: {w: 1, above: 0.8, below: 0.75},
    irisBands: ['pale', 'gold', 'grey-green'], nativeFaces: ['blunt']}),
  insect: other({label: 'Insect (compound eyes and 3 ocelli)', group: 'arthropod', standIn: 'compound', structure: 'compound', size: 1.3, extras: 'ocelli', count: 'pair+3',
    nativeFaces: ['mandibles']}),
  spider: other({label: 'Spider (8 simple eyes)', group: 'arthropod', standIn: 'compound', structure: 'ocellus', placement: {kind: 'frontal', yawDeg: 8, pitchDeg: null}, count: '8',
    eyeshine: 'silver-white', nativeFaces: ['mandibles']}),
  stalk: other({label: 'Stalk eyes (crab, snail)', group: 'arthropod', standIn: 'compound', structure: 'stalk', placement: {kind: 'stalk', yawDeg: 40, pitchDeg: 55},
    extras: 'stalk', nativeFaces: ['mandibles', 'blunt']}),
};
const freezeDeep = <T>(o: T): T => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { for (const v of Object.values(o)) freezeDeep(v); Object.freeze(o); } return o; };
/** The frozen preset table: kind -> traits. */
export const EYE_PRESETS: Readonly<Record<ComposerEyeKind, Readonly<EyeTraits>>> = freezeDeep(Object.fromEntries(
  COMPOSER_EYE_KINDS.map(kind => [kind, {kind, ...PRESETS[kind]}])) as Record<ComposerEyeKind, EyeTraits>);

export function isComposerEyeKind(value: unknown): value is ComposerEyeKind {
  return typeof value === 'string' && (COMPOSER_EYE_KINDS as readonly string[]).includes(value);
}
export function isFaceRoundEyeKind(value: unknown): value is FaceRoundEyeKind {
  return typeof value === 'string' && (FACE_ROUND_EYE_KINDS as readonly string[]).includes(value);
}
/** True when the kind has an iris that an iris colour can tint (camera eyes). */
export function eyeKindHasIris(kind: ComposerEyeKind): boolean {
  return EYE_PRESETS[kind].structure === 'camera';
}
/** The face round's kind that fauna-composer-eye-1 builds for `kind` on `face` until the catalogue geometry lands
 * (a bridge, never a restriction: the recipe keeps the kind). The face round's mesh casts an eyespot from inside a
 * worm's cap, which misses every other head, so off a blunt face an eyespot is stood in by an iris-less round eye
 * (resolveComposerEyes gives it the face's own camera-eye size) and a stalk's tip by a compound dome; on a blunt face both are eyespots. Every other
 * kind builds its preset's standIn. */
export function composerEyeStandIn(kind: ComposerEyeKind, face: EyeCatalogueFace): FaceRoundEyeKind {
  if (kind === 'eyespot') return face === 'blunt' ? 'eyespot' : 'round';
  if (kind === 'stalk') return face === 'blunt' ? 'eyespot' : 'compound';
  return EYE_PRESETS[kind].standIn;
}
/** True when real animals carry `kind` on `face` (a hint for the Lab and the generators; never a build restriction). */
export function composerEyeNative(kind: ComposerEyeKind, face: EyeCatalogueFace): boolean {
  return EYE_PRESETS[kind].nativeFaces.includes(face) || (kind === 'round' && VERTEBRATE_FACES.includes(face));
}
/** The eyeshine a kind carries on a face (metadata only). */
export function composerEyeShine(kind: ComposerEyeKind, face: EyeCatalogueFace): EyeShine {
  const t = EYE_PRESETS[kind];
  return t.eyeshineByFace?.[face] ?? t.eyeshine;
}
