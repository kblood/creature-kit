import type { CreatureArchetype, CreatureGenome } from './creature-model.ts';
import {
  COAT_MARK_BITS, COAT_ROLES, isCoatPattern, PIGMENT_FAMILIES,
  type CoatMarkName, type CoatRegion, type PigmentFamily, type ResolvedCoatPattern,
} from '../fauna-coat-vocab.ts';
import {
  applyCoatDrift, COAT_CELLS_PER_BODY, COAT_GENOME_RANGES, coatCanonicalSamples, coatIndividualDrift, coatMinFeature, coatPatternProbe, coatRandom,
  defaultCoatGenome, evaluateCoat, evaluateCoatWithMask, hash3u, linearToSrgb,
  type CoatGenome, type CoatRGB, type CoatSample,
} from '../fauna-coat-fields.ts';

/** An additive rendering contract. A genome without this block keeps its v1
 * evaluation; a stored 'fauna-appearance-1' block keeps the v1 coat. */
export const FAUNA_APPEARANCE_VERSION = 'fauna-appearance-2';
export const FAUNA_APPEARANCE_LEGACY_VERSION = 'fauna-appearance-1';
export const MORPHOLOGY_FAMILIES = ['ungulate', 'cursorial', 'padded', 'long-neck', 'proboscidean', 'winged'] as const;
export type FaunaMorphologyFamily = typeof MORPHOLOGY_FAMILIES[number];
export interface FaunaMorphology {
  version: 'fauna-morphology-1';
  family: FaunaMorphologyFamily;
  footType: 'paw' | 'hoof' | 'broad-pad';
  /** Metres at the specimen's current growth stage. */
  trunkLength: number;
  wingSpan: number;
  /** Winged specimens are grounded speculative animals; flight is not simulated. */
  wingState: 'none' | 'folded';
}
export type FaunaSex = 'female' | 'male';
export interface FaunaAppearance {
  version: typeof FAUNA_APPEARANCE_VERSION | typeof FAUNA_APPEARANCE_LEGACY_VERSION;
  individualKey: string;
  markingSeed: number;
  /** The inherited (catalogue) pattern; the rendered pattern is `coat.pattern`. */
  pattern: CreatureGenome['pattern'];
  /** sRGB hex. base = near-body area-weighted coat mean (far LOD), marking = dark role, belly = belly role. */
  palette: { base: string; marking: string; belly: string };
  roughness: number;
  /** Species axes. dimorphism (0.15..0.7) scales the sex differences of this species. */
  profile: { mass: number; limb: number; neck: number; dimorphism: number; hornlessFemales: boolean };
  /** coatPhase (v2, 0..1): the individual's offset of banded and striped
   * coats along the body, in pattern periods; absent in v1. */
  individual: {
    size: number; condition: number; muzzle: number; ears: number; sex: FaunaSex;
    /** fauna-appearance-2 only: band phase (0..1) and signed limb, neck and
     * tail proportion axes (-1..1); a v1 appearance has none of them. */
    coatPhase?: number; limb?: number; neck?: number; tail?: number;
  };
  /** maturity is 1 for adults and continuous 0.22..0.45 for juveniles.
   * lateral (v2) maps the body's z into the adult coat frame: 1 for adults,
   * adult/juvenile torso width-to-length for juveniles; absent in v1. */
  growth: { stage: 'adult' | 'juvenile'; maturity: number; lateral?: number };
  /** The individual's resolved coat at this growth stage (fauna-coat-1). */
  coat: CoatGenome;
  /** Pigment family and pattern shared by every species of one lineage. */
  lineage: { family: PigmentFamily; pattern: ResolvedCoatPattern };
}
export type CoatColor = [number, number, number];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (lo: number, hi: number, v: number) => { const t = clamp((v - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h ^ h >>> 16) >>> 0;
}
const signed = (key: string) => hash(key) / 0xffffffff * 2 - 1;
const unit = (key: string) => hash(key) / 0x100000000;
function rgb(hex: string): CoatColor { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as CoatColor; }
function hex(rgb: CoatColor): string { return '#' + rgb.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join(''); }
function linear(hex: string): CoatColor { return rgb(hex).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) as CoatColor; }
/** Linear RGB to sRGB hex. */
export function linearHexOf(c: readonly number[]): string { return hex([linearToSrgb(clamp(c[0]!, 0, 1)), linearToSrgb(clamp(c[1]!, 0, 1)), linearToSrgb(clamp(c[2]!, 0, 1))]); }

// ---------------------------------------------------------------------------
// Lineage and species coat genomes (fauna-appearance-2).
// ---------------------------------------------------------------------------

type Weighted<T extends string> = readonly (readonly [T, number])[];
/** Pigment-family priors per archetype. Low-slung animals (padded or
 * proboscidean) also carry the olive-grey of armoured, wallowing forms, so
 * every pigment family occurs on planets. */
export const FAUNA_LINEAGE_FAMILIES: Readonly<Record<CreatureArchetype, Weighted<PigmentFamily>>> = {
  runner: [['tawny', 3], ['dun', 2], ['fawn', 2], ['rufous', 1]],
  browser: [['rufous', 3], ['fawn', 2], ['dun', 2], ['grey', 1]],
  'long-neck': [['ochre', 4], ['tawny', 2], ['fawn', 1]],
  'low-slung': [['grey', 3], ['sable', 2], ['dun', 2], ['olive', 1]],
};
/** Coat pattern priors per inherited catalogue pattern. A small roan share
 * keeps the frosted coats of grey and sable lineages in the planet set. */
export const FAUNA_LINEAGE_PATTERNS: Readonly<Record<CreatureGenome['pattern'], Weighted<ResolvedCoatPattern>>> = {
  plain: [['plain', .42], ['saddle', .24], ['dorsal-stripe', .19], ['piebald', .09], ['roan', .06]],
  spots: [['spots', .35], ['rosettes', .25], ['reticulated', .25], ['dapple', .15]],
  stripes: [['stripes', .4], ['bands', .25], ['brindle', .15], ['dorsal-stripe', .2]],
};
/** Region marks a species may toggle on or off its lineage's marks. */
export const FAUNA_SPECIES_MARKS: Readonly<Record<CreatureArchetype, readonly CoatMarkName[]>> = {
  runner: ['socks', 'mask', 'blaze', 'rump-patch', 'tail-tip', 'ear-tips'],
  browser: ['socks', 'mask', 'blaze', 'rump-patch', 'tail-tip', 'ear-tips'],
  'long-neck': ['socks', 'mask', 'blaze', 'rump-patch', 'tail-tip', 'ear-tips'],
  'low-slung': ['socks', 'mask', 'blaze', 'tail-rings', 'tail-tip', 'ear-tips'],
};

function pick<T extends string>(table: Weighted<T>, u: number, weight?: (value: T) => number): T {
  let total = 0;
  for (const [value, w] of table) total += w * (weight ? weight(value) : 1);
  let target = u * total;
  for (const [value, w] of table) { target -= w * (weight ? weight(value) : 1); if (target < 0) return value; }
  return table[table.length - 1]![0];
}

/** The catalogue identity of a lineage: inherited unchanged by descendants. */
export function faunaLineageKey(genome: CreatureGenome): string { return `${genome.archetype}/${genome.color}/${genome.pattern}/coat-lineage-v2`; }
/** The species channel of the v1 appearance (descendants change anatomy, so it differs per species). */
export function faunaSpeciesKey(genome: CreatureGenome): string {
  return `${genome.archetype}/${genome.torsoLength}/${genome.torsoWidth}/${genome.legLength}/${genome.neckLength}/${genome.color}/${genome.pattern}`;
}

export interface FaunaLineageCoat { family: PigmentFamily; pattern: ResolvedCoatPattern; marks: number; juvenileSpots: boolean }
/** Lineage family, pattern, base marks and juvenile-spot inheritance. */
export function faunaLineageCoat(genome: CreatureGenome): FaunaLineageCoat {
  const key = faunaLineageKey(genome), archetype = genome.archetype;
  const family = pick(FAUNA_LINEAGE_FAMILIES[archetype], unit(`${key}/family`));
  const pattern = pick(FAUNA_LINEAGE_PATTERNS[genome.pattern], unit(`${key}/pattern`), p => p === 'reticulated' && archetype === 'long-neck' ? 3 : 1);
  let marks = 0;
  for (const name of FAUNA_SPECIES_MARKS[archetype]) if (unit(`${key}/mark/${name}`) < .3) marks |= COAT_MARK_BITS[name];
  const juvenileSpots = (archetype === 'browser' || archetype === 'long-neck') && unit(`${key}/juvenile-spots`) < .6;
  return { family, pattern, marks, juvenileSpots };
}

/** Species dimorphism (0.15..0.7): stronger in horned ungulates and long-necked browsers. */
export function faunaSpeciesDimorphism(genome: CreatureGenome): { dimorphism: number; hornlessFemales: boolean } {
  const species = faunaSpeciesKey(genome), family = inheritedFaunaFamily(genome);
  const raw = .15 + .55 * unit(`${species}/dimorphism-v2`);
  const dimorphism = clamp(raw * (family === 'ungulate' || family === 'long-neck' ? 1.3 : 1), .15, .7);
  return { dimorphism, hornlessFemales: dimorphism > .55 && unit(`${species}/hornless-females-v2`) < .5 };
}

/** Species coat (adult, no individual drift), from stream `<speciesKey>/coat-v2`:
 * colour seed (hue +-0.04 via coatSpeciesColours), scale +-25%, contrast +-20%,
 * countershade 0.35..0.9, belly line +-0.1, a 0.25 toggle per archetype mark,
 * light marks with p 0.3, then warp and coverage. The draw order is append-only. */
export function faunaSpeciesCoat(genome: CreatureGenome): { lineage: FaunaLineageCoat; coat: CoatGenome } {
  const lineage = faunaLineageCoat(genome), rand = coatRandom(`${faunaSpeciesKey(genome)}/coat-v2`);
  const colourSeed = Math.floor(rand() * 4294967296) >>> 0;
  const scale = 1 + (rand() * 2 - 1) * .25, contrast = 1 + (rand() * 2 - 1) * .2;
  const countershade = .35 + rand() * .55, bellyLine = -.45 + (rand() * 2 - 1) * .1;
  let marks = lineage.marks;
  for (const name of FAUNA_SPECIES_MARKS[genome.archetype]) if (rand() < .25) marks ^= COAT_MARK_BITS[name];
  const markRole = rand() < .3 ? 'belly' as const : 'accent' as const;
  const warp = .35 + rand() * .4, threshold = (rand() * 2 - 1) * .1;
  if (lineage.juvenileSpots) marks |= COAT_MARK_BITS['juvenile-spots'];
  const coat = defaultCoatGenome(lineage.family, colourSeed, { pattern: lineage.pattern, marks, scale, contrast, countershade, bellyLine, markRole, warp, threshold, juvenileSpots: 0 });
  return { lineage, coat };
}

/** Area shares of the near body's coat regions per morphology family
 * (quadruped-body-4 skins, the mean of the normalised adult and juvenile
 * shares measured over 4 archetypes x 4 specimens each, so the one
 * stage-invariant far colour serves both stages;
 * ears, horns and structural parts excluded, as they follow the far colour),
 * and the mean hoof/pad darkening of the feet. */
export const FAUNA_FAR_REGION_SHARES: Readonly<Record<FaunaMorphologyFamily, { torso: number; neck: number; head: number; tail: number; upper: number; lower: number; foot: number; footHoof: number }>> = {
  ungulate: { torso: .380, neck: .065, head: .052, tail: .021, upper: .289, lower: .124, foot: .069, footHoof: .671 },
  cursorial: { torso: .353, neck: .055, head: .054, tail: .017, upper: .324, lower: .154, foot: .043, footHoof: .267 },
  padded: { torso: .465, neck: .033, head: .104, tail: .038, upper: .130, lower: .104, foot: .126, footHoof: .413 },
  'long-neck': { torso: .298, neck: .155, head: .037, tail: .015, upper: .319, lower: .129, foot: .046, footHoof: .665 },
  proboscidean: { torso: .364, neck: .053, head: .095, tail: .021, upper: .231, lower: .118, foot: .118, footHoof: .441 },
  winged: { torso: .382, neck: .085, head: .061, tail: .021, upper: .268, lower: .122, foot: .061, footHoof: .268 },
};
const HOOF: CoatRGB = [.035, .03, .026];
/** Area share of dorsal armour plates (low-slung bodies only). */
export function faunaArmorShare(genome: Pick<CreatureGenome, 'archetype' | 'armor'>, family: FaunaMorphologyFamily): number {
  // Proboscideans carry no plates (their armour is zeroed by the phenotype).
  return family !== 'proboscidean' && genome.archetype === 'low-slung' && genome.armor > .05 ? clamp(.25 * genome.armor, 0, .2) : 0;
}

/** Sampling footprint for a mesh cell of `cell` torso lengths. Vertex colours
 * are interpolated linearly across each triangle, so a rosette ring narrower
 * than about two cells would be reconstructed as straight, grid-aligned blocks;
 * its edge filter therefore spans two cells. Other patterns use one cell. */
function coatFootprint(coat: CoatGenome, cell: number): number { return coat.pattern === 'rosettes' ? 2 * cell : cell; }
const MEAN_SAMPLE: CoatSample = { x: 0, y: 0, z: 0, dorsal: 0, region: 'torso', along: 0, footprint: 0 };
/** Typical near-skin cell size in torso lengths (measured 0.019-0.026). */
const FAR_MEAN_CELL = .022;
const MEAN_OUT = new Float64Array(3);
/** Far-LOD colour of a coat (linear): the canonical coat evaluated per
 * region, weighted by the family's near-body region shares, with hoof
 * darkening on the feet and the plate role on armour. This is coatMeanColor
 * re-weighted to the body the near LOD actually draws, so the far colour
 * stays within 0.04 of the near-body mean (tested). */
export function faunaFarCoatMean(coat: CoatGenome, family: FaunaMorphologyFamily, armorShare = 0): CoatRGB {
  const sums: Record<string, [number, number, number, number]> = {};
  const add = (key: string, w: number) => { const t = sums[key] ??= [0, 0, 0, 0]; t[0] += MEAN_OUT[0]! * w; t[1] += MEAN_OUT[1]! * w; t[2] += MEAN_OUT[2]! * w; t[3] += w; };
  const groups: Partial<Record<CoatRegion, string>> = { torso: 'torso', neck: 'neck', head: 'head', muzzle: 'head', ear: 'head', tail: 'tail', 'tail-tip': 'tail', 'limb-upper': 'upper', 'limb-lower': 'lower', foot: 'foot' };
  // The near skins sample with a footprint of about one cell (0.02 torso
  // lengths) and the matching scale clamp, which softens fine marks; the far
  // mean uses the same filtering so both LODs agree.
  const filtered = clampedCoat(coat, FAR_MEAN_CELL);
  for (const s of coatCanonicalSamples()) {
    Object.assign(MEAN_SAMPLE, s); MEAN_SAMPLE.footprint = coatFootprint(coat, FAR_MEAN_CELL);
    evaluateCoat(filtered, MEAN_SAMPLE, MEAN_OUT, 0);
    add(groups[s.region] ?? 'torso', s.weight);
    if (armorShare > 0 && s.region === 'torso' && s.dorsal > .3) {
      MEAN_SAMPLE.region = 'armor';
      evaluateCoat(filtered, MEAN_SAMPLE, MEAN_OUT, 0); add('armor', s.weight);
    }
  }
  const shares = FAUNA_FAR_REGION_SHARES[family], out: CoatRGB = [0, 0, 0];
  const parts: [string, number][] = [['torso', shares.torso], ['neck', shares.neck], ['head', shares.head], ['tail', shares.tail], ['upper', shares.upper], ['lower', shares.lower], ['foot', shares.foot]];
  const total = parts.reduce((n, [, w]) => n + w, 0), coatShare = 1 - armorShare;
  for (const [key, w] of parts) {
    const t = sums[key]!, share = w / total * coatShare;
    for (let i = 0; i < 3; i++) {
      const mean = t[i]! / t[3]!;
      out[i]! += share * (key === 'foot' ? mix(mean, HOOF[i]!, shares.footHoof) : mean);
    }
  }
  if (armorShare > 0) { const t = sums.armor!; for (let i = 0; i < 3; i++) out[i]! += armorShare * t[i]! / t[3]!; }
  return out;
}
/** Memoised species models (see faunaFarMean). */
const FAR_MODELS = new Map<string, FarModel>();
/** Canonical samples are grouped like the near body's regions; index order
 * torso, neck, head, tail, upper, lower, foot (as in faunaFarCoatMean). */
const FAR_GROUP_OF: Partial<Record<CoatRegion, number>> = { torso: 0, neck: 1, head: 2, muzzle: 2, ear: 2, tail: 3, 'tail-tip': 3, 'limb-upper': 4, 'limb-lower': 5, foot: 6 };
/** The species base model uses every canonical sample; slopes, the direct
 * layout means and their stride-matched base use every fourth (128). */
const FAR_GROUPS = 7, FAR_STRIDE = 4;
const SOCK_GROUPS = 1 << 5 | 1 << 6, HEAD_GROUP = 1 << 2, ALL_GROUPS = (1 << FAR_GROUPS) - 1;
/** Coats whose canonical mean depends on the individual pattern layout (two or
 * three patches or bands per body) rather than only on its statistics. Measured
 * against the near body over 120 specimens per pattern, the species model alone
 * misses by up to 0.2 on piebald and 0.046 on bands. Piebald individuals
 * evaluate their own coat on every fourth canonical sample (128 evaluations,
 * ~0.11 ms; the exact mean itself misses the near body by up to 0.073 there).
 * Bands individuals only probe their raw pattern mask on the samples of the
 * groups they cross and move each group along the species threshold slope by
 * the mask change (79 probes, ~0.04 ms; within 0.038 of the near body). The
 * same mask term measured to 0.15 on piebald, whose white patches do not track
 * the threshold slope. Reticulated (exact mean itself 0.056, model 0.061) and
 * stripes (0.048) stay on the model: a layout term would cost every individual
 * of a common pattern. */
const FAR_LAYOUT_PATTERNS: ReadonlySet<ResolvedCoatPattern> = new Set<ResolvedCoatPattern>(['piebald']);
const FAR_MASK_PATTERNS: ReadonlySet<ResolvedCoatPattern> = new Set<ResolvedCoatPattern>(['bands']);
/** Groups whose layout term applies: bands only on the torso, neck and tail
 * they cross (all groups measured no better); piebald patches everywhere. */
const FAR_LAYOUT_GROUPS: Partial<Record<ResolvedCoatPattern, number>> = { bands: 1 << 0 | 1 << 1 | 1 << 3 };
const LIN_A = .3, LIN_D = .2;
const LIN_B0 = new Float64Array(3), LIN_B1 = new Float64Array(3);
/** A coat's per-group mean colour as an exact linear function of its three
 * pigment roles: evaluateCoat mixes base, accent and belly with weights that
 * do not depend on the colours, so per group (7 entries)
 * mean[ch] = w0 base[ch] + w1 accent[ch] + w2 belly[ch] + k[ch], then the weight. */
type FarLinear = Float64Array;
type FarSlopeField = 'contrast' | 'countershade' | 'threshold' | 'bellyLine';
interface FarModel {
  species: CoatGenome;
  /** Layout patterns: per-group strided mean pattern mask of the species coat
   * and its threshold derivative (see farLayoutMask). */
  mask: Float64Array | undefined; maskSlope: Float64Array | undefined;
  /** Marks an individual may flip (faunaIndividualCoat): socks and blaze. */
  flipBits: number;
  base: FarLinear; flipped: FarLinear | undefined;
  /** Head group at greying 1 (greying enters linearly), unflipped and flipped. */
  grey: FarLinear; greyFlipped: FarLinear | undefined;
  /** d(mean)/d(field) at the species coat (linear models, every fourth sample). */
  slopes: readonly (readonly [FarSlopeField, FarLinear])[];
  /** Mean plate grain of the dorsal armour samples. */
  armour: number;
}
function scaleClamped(coat: CoatGenome, cell: number): CoatGenome {
  const max = faunaCoatMaxScale(coat, cell);
  return coat.scale > max ? { ...coat, scale: max } : coat;
}
/** The linear model of `coat` over the canonical samples of the groups in
 * `mask` (every `stride`-th sample); `sub`, when
 * given, also receives the strided subset. */
function farLinear(coat: CoatGenome, mask: number, stride: number, sub?: FarLinear, subStride = FAR_STRIDE): FarLinear {
  const filtered = scaleClamped(coat, FAR_MEAN_CELL), fp = coatFootprint(coat, FAR_MEAN_CELL), A = LIN_A, D = LIN_D;
  const uniform: CoatGenome = { ...filtered, colours: { ...filtered.colours, base: [A, A, A], accent: [A, A, A], belly: [A, A, A] } };
  const basis: CoatGenome = { ...filtered, colours: { ...filtered.colours, base: [A + D, A, A], accent: [A, A + D, A], belly: [A, A, A + D] } };
  const out = new Float64Array(FAR_GROUPS * 7), samples = coatCanonicalSamples();
  const accumulate = (target: FarLinear, g: number, w: number, w0: number, w1: number, w2: number) => {
    const o = g * 7, sum = w0 + w1 + w2;
    target[o]! += w0 * w; target[o + 1]! += w1 * w; target[o + 2]! += w2 * w;
    for (let c = 0; c < 3; c++) target[o + 3 + c]! += (LIN_B0[c]! - A * sum) * w;
    target[o + 6]! += w;
  };
  for (let i = 0; i < samples.length; i += stride) {
    const s = samples[i]!, g = FAR_GROUP_OF[s.region] ?? 0;
    if (!(mask >> g & 1)) continue;
    Object.assign(MEAN_SAMPLE, s); MEAN_SAMPLE.footprint = fp;
    evaluateCoat(basis, MEAN_SAMPLE, LIN_B1, 0); evaluateCoat(uniform, MEAN_SAMPLE, LIN_B0, 0);
    const w0 = (LIN_B1[0]! - LIN_B0[0]!) / D, w1 = (LIN_B1[1]! - LIN_B0[1]!) / D, w2 = (LIN_B1[2]! - LIN_B0[2]!) / D;
    accumulate(out, g, s.weight, w0, w1, w2);
    if (sub && i % subStride === 0) accumulate(sub, g, s.weight, w0, w1, w2);
  }
  for (const target of sub ? [out, sub] : [out]) for (let g = 0; g < FAR_GROUPS; g++) {
    const o = g * 7, w = target[o + 6]!;
    if (w > 0) for (let j = 0; j < 6; j++) target[o + j]! /= w;
  }
  return out;
}
/** Group g of a linear model at the given colours (linear RGB), into out. */
function farGroupColour(model: FarLinear, g: number, colours: CoatGenome['colours'], out: CoatRGB): void {
  const o = g * 7, b = colours.base, a = colours.accent, l = colours.belly;
  for (let c = 0; c < 3; c++) out[c] = model[o]! * b[c]! + model[o + 1]! * a[c]! + model[o + 2]! * l[c]! + model[o + 3 + c]!;
}
/** Slope steps: contrast and countershade enter evaluateCoat linearly, so a
 * one-sided step is exact; threshold and the belly line use central steps. */
const FAR_SLOPES: readonly (readonly [FarSlopeField, number, boolean])[] = [['contrast', .1, false], ['countershade', .1, false], ['threshold', .04, true], ['bellyLine', .04, true]];
// Individual scale and warp drift are not modelled: slopes in them were measured
// to make the near/far error worse (the pattern reseed dominates them).
const FAR_PROBE = new Float64Array(5);
/** Per-group weighted mean of the raw pattern mask (coatPatternProbe) over
 * every fourth canonical sample of the pattern's layout groups, into out. */
function farLayoutMask(coat: CoatGenome, out: Float64Array): Float64Array {
  const filtered = scaleClamped(coat, FAR_MEAN_CELL), fp = coatFootprint(coat, FAR_MEAN_CELL), samples = coatCanonicalSamples();
  const groups = FAR_LAYOUT_GROUPS[coat.pattern] ?? ALL_GROUPS;
  out.fill(0);
  for (let i = 0; i < samples.length; i += FAR_STRIDE) {
    const s = samples[i]!, g = FAR_GROUP_OF[s.region] ?? 0;
    if (FAR_DIRECT_COUNTS[g]! < 3 || !(groups >> g & 1)) continue;
    Object.assign(MEAN_SAMPLE, s); MEAN_SAMPLE.footprint = fp;
    coatPatternProbe(filtered, MEAN_SAMPLE, FAR_PROBE);
    out[g * 2]! += FAR_PROBE[0]! * s.weight; out[g * 2 + 1]! += s.weight;
  }
  for (let g = 0; g < FAR_GROUPS; g++) if (out[g * 2 + 1]! > 0) out[g * 2]! /= out[g * 2 + 1]!;
  return out;
}
function farModel(id: string, species: CoatGenome, archetype: CreatureArchetype): FarModel {
  const cached = FAR_MODELS.get(id);
  if (cached) return cached;
  let flipBits = 0;
  for (const name of INDIVIDUAL_MARKS[archetype]) flipBits |= COAT_MARK_BITS[name];
  const sub = new Float64Array(FAR_GROUPS * 7), base = farLinear(species, ALL_GROUPS, 1, sub, FAR_STRIDE);
  const flippedCoat: CoatGenome = { ...species, marks: species.marks ^ flipBits };
  const slopes = FAR_SLOPES.map(([field, h, central]) => {
    const up = farLinear({ ...species, [field]: species[field] + h }, ALL_GROUPS, FAR_STRIDE);
    const down = central ? farLinear({ ...species, [field]: species[field] - h }, ALL_GROUPS, FAR_STRIDE) : sub;
    const slope = new Float64Array(up.length);
    for (let i = 0; i < up.length; i++) slope[i] = i % 7 === 6 ? 0 : (up[i]! - down[i]!) / (central ? 2 * h : h);
    return [field, slope] as const;
  });
  // Armour plates draw plate x grain; the grain mean is taken at plate 0.5.
  const plate: CoatGenome = { ...scaleClamped(species, FAR_MEAN_CELL), colours: { ...species.colours, plate: [.5, .5, .5] } };
  let grain = 0, weight = 0;
  for (const s of coatCanonicalSamples()) if (s.region === 'torso' && s.dorsal > .3) {
    Object.assign(MEAN_SAMPLE, s); MEAN_SAMPLE.region = 'armor'; MEAN_SAMPLE.footprint = coatFootprint(species, FAR_MEAN_CELL);
    evaluateCoat(plate, MEAN_SAMPLE, MEAN_OUT, 0); grain += MEAN_OUT[0]! / .5 * s.weight; weight += s.weight;
  }
  let mask: Float64Array | undefined, maskSlope: Float64Array | undefined;
  if (FAR_MASK_PATTERNS.has(species.pattern)) {
    mask = farLayoutMask(species, new Float64Array(FAR_GROUPS * 2));
    const up = farLayoutMask({ ...species, threshold: species.threshold + .04 }, new Float64Array(FAR_GROUPS * 2));
    const down = farLayoutMask({ ...species, threshold: species.threshold - .04 }, new Float64Array(FAR_GROUPS * 2));
    maskSlope = new Float64Array(FAR_GROUPS);
    for (let g = 0; g < FAR_GROUPS; g++) maskSlope[g] = (up[g * 2]! - down[g * 2]!) / .08;
  }
  const model: FarModel = {
    species, flipBits, base, slopes, armour: grain / weight, mask, maskSlope,
    flipped: flipBits ? farLinear(flippedCoat, SOCK_GROUPS | HEAD_GROUP, 1) : undefined,
    grey: farLinear({ ...species, greying: 1 }, HEAD_GROUP, 1),
    greyFlipped: flipBits & COAT_MARK_BITS.blaze ? farLinear({ ...flippedCoat, greying: 1 }, HEAD_GROUP, 1) : undefined,
  };
  if (FAR_MODELS.size >= 256) FAR_MODELS.clear();
  FAR_MODELS.set(id, model);
  return model;
}
/** Number of strided canonical samples per group. */
const FAR_DIRECT_COUNTS: readonly number[] = (() => {
  const counts = new Array<number>(FAR_GROUPS).fill(0), samples = coatCanonicalSamples();
  for (let i = 0; i < samples.length; i += FAR_STRIDE) counts[FAR_GROUP_OF[samples[i]!.region] ?? 0]!++;
  return counts;
})();
const FAR_GROUP_MEANS = Array.from({ length: FAR_GROUPS }, (): CoatRGB => [0, 0, 0]);
const FAR_TMP: CoatRGB = [0, 0, 0], FAR_TMP2: CoatRGB = [0, 0, 0];
const FAR_DIRECT = new Float64Array(FAR_GROUPS * 4), FAR_MASK = new Float64Array(FAR_GROUPS * 2);
/** Far-LOD colour (linear) of one individual's adult coat, without
 * evaluating its whole canonical body. The species model (memoised per
 * `speciesId`, about 2 ms once per species) is exact in the individual's
 * colours, socks/blaze flips and greying, and first-order in its contrast,
 * countershade, threshold and belly line; layout-dependent patterns
 * (FAR_LAYOUT_PATTERNS) also evaluate the individual's own coat on every
 * fourth canonical sample. About 3 us per individual (about 0.1 ms for
 * layout-dependent patterns) against 0.45 ms for faunaFarCoatMean; the
 * near/far bound is tested on the 96 corpus bodies. A coat that is not an
 * individual of this species falls back to the exact mean. */
export function faunaFarMean(speciesId: string, species: CoatGenome, archetype: CreatureArchetype, coat: CoatGenome, family: FaunaMorphologyFamily, armorShare = 0): CoatRGB {
  const m = farModel(speciesId, species, archetype), flip = (coat.marks ^ m.species.marks) | 0;
  if (coat.pattern !== m.species.pattern || flip & ~m.flipBits) return faunaFarCoatMean(coat, family, armorShare);
  const C = coat.colours, socks = flip & COAT_MARK_BITS.socks, blaze = flip & COAT_MARK_BITS.blaze;
  for (let g = 0; g < FAR_GROUPS; g++) {
    const out = FAR_GROUP_MEANS[g]!, flipped = (g === 5 || g === 6) ? socks : g === 2 ? blaze : 0;
    farGroupColour(flipped ? m.flipped! : m.base, g, C, out);
    if (g === 2 && coat.greying > 0) {
      farGroupColour(blaze ? m.greyFlipped! : m.grey, 2, C, FAR_TMP);
      for (let c = 0; c < 3; c++) out[c] = mix(out[c]!, FAR_TMP[c]!, coat.greying);
    }
    for (const [field, slope] of m.slopes) {
      const delta = coat[field] - m.species[field];
      if (delta === 0) continue;
      farGroupColour(slope, g, C, FAR_TMP2);
      for (let c = 0; c < 3; c++) out[c]! += delta * FAR_TMP2[c]!;
    }
  }
  if (m.mask && m.maskSlope) {
    // Layout term: the individual's own mean mask, beyond what its threshold
    // change already explains, moves each group along the threshold slope.
    const ind = farLayoutMask(coat, FAR_MASK), dt = coat.threshold - m.species.threshold, ts = m.slopes.find(([f]) => f === 'threshold')![1];
    for (let g = 0; g < FAR_GROUPS; g++) {
      const k = m.maskSlope[g]!;
      if (ind[g * 2 + 1]! <= 0 || Math.abs(k) < 1e-3) continue;
      const residual = (ind[g * 2]! - m.mask[g * 2]! - k * dt) / k;
      farGroupColour(ts, g, C, FAR_TMP2);
      for (let c = 0; c < 3; c++) FAR_GROUP_MEANS[g]![c]! += residual * FAR_TMP2[c]!;
    }
  } else if (FAR_LAYOUT_PATTERNS.has(coat.pattern)) {
    // The individual's own layout: a direct mean over every fourth sample
    // replaces the model in each group that has at least three of them.
    const filtered = scaleClamped(coat, FAR_MEAN_CELL), fp = coatFootprint(coat, FAR_MEAN_CELL), samples = coatCanonicalSamples();
    FAR_DIRECT.fill(0);
    const groups = FAR_LAYOUT_GROUPS[coat.pattern] ?? ALL_GROUPS;
    for (let i = 0; i < samples.length; i += FAR_STRIDE) {
      const s = samples[i]!, g = FAR_GROUP_OF[s.region] ?? 0, o = g * 4;
      if (FAR_DIRECT_COUNTS[g]! < 3 || !(groups >> g & 1)) continue;
      Object.assign(MEAN_SAMPLE, s); MEAN_SAMPLE.footprint = fp;
      evaluateCoat(filtered, MEAN_SAMPLE, MEAN_OUT, 0);
      FAR_DIRECT[o]! += MEAN_OUT[0]! * s.weight; FAR_DIRECT[o + 1]! += MEAN_OUT[1]! * s.weight; FAR_DIRECT[o + 2]! += MEAN_OUT[2]! * s.weight; FAR_DIRECT[o + 3]! += s.weight;
    }
    for (let g = 0; g < FAR_GROUPS; g++) {
      const o = g * 4, w = FAR_DIRECT[o + 3]!;
      if (w > 0) for (let c = 0; c < 3; c++) FAR_GROUP_MEANS[g]![c] = FAR_DIRECT[o + c]! / w;
    }
  }
  const shares = FAUNA_FAR_REGION_SHARES[family], parts = [shares.torso, shares.neck, shares.head, shares.tail, shares.upper, shares.lower, shares.foot];
  const total = parts.reduce((n, w) => n + w, 0), coatShare = 1 - armorShare, out: CoatRGB = [0, 0, 0];
  for (let g = 0; g < FAR_GROUPS; g++) {
    const share = parts[g]! / total * coatShare, mean = FAR_GROUP_MEANS[g]!;
    for (let c = 0; c < 3; c++) out[c]! += share * (g === 6 ? mix(mean[c]!, HOOF[c]!, shares.footHoof) : mean[c]!);
  }
  if (armorShare > 0) for (let c = 0; c < 3; c++) out[c]! += armorShare * coat.colours.plate[c]! * m.armour;
  return out;
}
/** Memo key of a species' far-LOD model (species and lineage channels). */
export function faunaFarSpeciesId(genome: CreatureGenome): string { return `${faunaSpeciesKey(genome)}|${faunaLineageKey(genome)}`; }

/** An individual's adult coat: the species coat with its individual drift. */
export function faunaAdultCoat(archetype: CreatureArchetype, speciesCoat: CoatGenome, individualKey: string): CoatGenome {
  const drifted = applyCoatDrift(speciesCoat, coatIndividualDrift(`${individualKey}/coat`, 1));
  return faunaIndividualCoat(archetype, drifted, individualKey);
}
/** Region marks that differ between individuals of one species, as stockings
 * and blazes do in wild cattle, equids and deer (not on broad low-slung heads).
 * Low-slung bodies flip stockings only: dark-legged and uniform individuals
 * occur in one population of bears, wolverines and tapirs. The flip reuses the
 * existing per-mark draw, so the stream order is unchanged. */
const INDIVIDUAL_MARKS: Readonly<Record<CreatureArchetype, readonly CoatMarkName[]>> = { browser: ['socks', 'blaze'], runner: ['socks', 'blaze'], 'long-neck': ['socks'], 'low-slung': ['socks'] };
/** The fauna-appearance-2 individual layer, from stream
 * `<individualKey>/coat-individual-v2`, on top of the shared coat drift:
 * overall tone (sRGB value x(1 +-0.14), +-0.22 low-slung, +-0.2 long-neck),
 * then (appended) the mark shade alone (+-0.18 low-slung, +-0.3 long-neck: giraffe
 * patches run from pale orange to near black between individuals), contrast +-0.15, countershade +-0.1,
 * belly line +-0.05, coverage +-0.05, warp +-0.15, scale +-6%, and a 0.12
 * flip per stocking and blaze mark. Draw order is append-only. */
/** Individual tone spread (sRGB value) per archetype. Bears and badgers run
 * from pale to near-black colour phases within one population, and giraffe
 * patches darken with age and sex, so the low-slung and long-neck archetypes
 * vary more than deer and antelope. */
const INDIVIDUAL_VALUE: Readonly<Record<CreatureArchetype, number>> = { browser: .14, runner: .14, 'low-slung': .22, 'long-neck': .2 };
/** Extra individual darkening of the mark colour alone (patch, stripe and band
 * shade), appended to the stream: 0 keeps the shared tone. */
const INDIVIDUAL_ACCENT: Readonly<Record<CreatureArchetype, number>> = { browser: 0, runner: 0, 'low-slung': .18, 'long-neck': .3 };
function faunaIndividualCoat(archetype: CreatureArchetype, coat: CoatGenome, individualKey: string): CoatGenome {
  const rand = coatRandom(`${individualKey}/coat-individual-v2`), s = () => rand() * 2 - 1;
  const value = Math.pow(1 + INDIVIDUAL_VALUE[archetype] * s(), 2.2), contrast = .15 * s(), countershade = .1 * s(), bellyLine = .05 * s();
  // Stripe and band counts vary more between individuals (zebra torso stripe
  // counts span roughly +-10%) than spot sizes do.
  const linear = coat.pattern === 'stripes' || coat.pattern === 'bands' || coat.pattern === 'brindle';
  const threshold = .05 * s(), warp = .15 * s(), scale = 1 + (linear ? .1 : .06) * s();
  let marks = coat.marks;
  for (const name of ['socks', 'blaze'] as const) if (rand() < .12 && INDIVIDUAL_MARKS[archetype].includes(name)) marks ^= COAT_MARK_BITS[name];
  const R = COAT_GENOME_RANGES, colours = { ...coat.colours };
  for (const role of ['base', 'accent', 'belly'] as const) colours[role] = coat.colours[role].map(c => clamp(c * value, 0, 1)) as CoatRGB;
  // Appended draw: the mark shade alone (stream order of the draws above is unchanged).
  const accent = Math.pow(1 + INDIVIDUAL_ACCENT[archetype] * s(), 2.2);
  if (INDIVIDUAL_ACCENT[archetype] > 0) colours.accent = colours.accent.map(c => clamp(c * accent, 0, 1)) as CoatRGB;
  return {
    ...coat, colours, marks,
    contrast: clamp(coat.contrast + contrast, R.contrast[0], R.contrast[1]),
    countershade: clamp(coat.countershade + countershade, R.countershade[0], R.countershade[1]),
    bellyLine: clamp(coat.bellyLine + bellyLine, R.bellyLine[0], R.bellyLine[1]),
    threshold: clamp(coat.threshold + threshold, R.threshold[0], R.threshold[1]),
    warp: clamp(coat.warp + warp, R.warp[0], R.warp[1]),
    scale: clamp(coat.scale * scale, R.scale[0], R.scale[1]),
  };
}

/** Juvenile-spot strength: full up to maturity 0.3, gone by 0.7. */
export function faunaJuvenileSpotStrength(maturity: number): number { return 1 - smooth(.3, .7, maturity); }

/** Channels depend on identity, never date, camera, quality or life stage
 * (stage only sets maturity and the juvenile coat). */
/** Species-level channels of createFaunaAppearance, memoised per species so a
 * burst of new herd members pays only for its individual channels. */
interface SpeciesAppearance {
  farId: string; lineage: FaunaLineageCoat; coat: CoatGenome;
  mass: number; limb: number; neck: number; roughness: number; dimorphism: number; hornlessFemales: boolean;
}
const SPECIES_APPEARANCES = new Map<string, SpeciesAppearance>();
function speciesAppearance(genome: CreatureGenome): SpeciesAppearance {
  const farId = faunaFarSpeciesId(genome), cached = SPECIES_APPEARANCES.get(farId);
  if (cached) return cached;
  const species = faunaSpeciesKey(genome), { lineage, coat } = faunaSpeciesCoat(genome), { dimorphism, hornlessFemales } = faunaSpeciesDimorphism(genome);
  const value: SpeciesAppearance = {
    farId, lineage, coat, dimorphism, hornlessFemales,
    mass: signed(`${species}/mass`), limb: signed(`${species}/limb`), neck: signed(`${species}/neck`), roughness: .84 + signed(`${species}/roughness`) * .035,
  };
  if (SPECIES_APPEARANCES.size >= 512) SPECIES_APPEARANCES.clear();
  SPECIES_APPEARANCES.set(farId, value);
  return value;
}

export function createFaunaAppearance(genome: CreatureGenome, id: string, variant: number, stage: 'adult' | 'juvenile'): FaunaAppearance {
  const key = `${id}/${variant}/appearance-v1`;
  const { farId, lineage, coat: speciesCoat, mass, limb, neck, roughness, dimorphism, hornlessFemales } = speciesAppearance(genome);
  // The individual coat drift supersedes the v1 +-14% brightness channel.
  const adultCoat = faunaAdultCoat(genome.archetype, speciesCoat, key);
  const maturity = stage === 'adult' ? 1 : .22 + .23 * unit(`${key}/maturity-v2`);
  const coat: CoatGenome = stage === 'adult' ? adultCoat : {
    ...adultCoat,
    juvenileSpots: adultCoat.marks & COAT_MARK_BITS['juvenile-spots'] ? faunaJuvenileSpotStrength(maturity) : 0,
    greying: 0,
  };
  // The far-LOD palette is the adult coat's body mean, so it never depends on stage.
  const family = inheritedFaunaFamily(genome);
  const mean = faunaFarMean(farId, speciesCoat, genome.archetype, adultCoat, family, faunaArmorShare(genome, family));
  return {
    version: FAUNA_APPEARANCE_VERSION, individualKey: key, markingSeed: hash(`${key}/markings`), pattern: genome.pattern,
    palette: { base: linearHexOf(mean), marking: linearHexOf(adultCoat.colours.accent), belly: linearHexOf(adultCoat.colours.belly) },
    roughness,
    profile: { mass, limb, neck, dimorphism, hornlessFemales },
    individual: { size: signed(`${key}/size`), condition: signed(`${key}/condition`), muzzle: signed(`${key}/muzzle`), ears: signed(`${key}/ears`), sex: unit(`${key}/sex-v2`) < .5 ? 'male' : 'female', coatPhase: unit(`${key}/coat-phase-v2`),
      limb: signed(`${key}/limb-v2`), neck: signed(`${key}/neck-v2`), tail: signed(`${key}/tail-v2`) },
    growth: { stage, maturity, lateral: 1 },
    coat,
    lineage: { family: lineage.family, pattern: lineage.pattern },
  };
}

/** Errors in a stored v2 coat genome (shape and ranges only). */
export function faunaCoatErrors(coat: CoatGenome | undefined): string[] {
  if (!coat || typeof coat !== 'object' || coat.version !== 'fauna-coat-1') return ['invalid coat genome'];
  const errors: string[] = [];
  if (!isCoatPattern(coat.pattern) || (coat.pattern as string) === 'auto') errors.push('invalid coat pattern');
  for (const [field, [lo, hi]] of Object.entries(COAT_GENOME_RANGES)) {
    const value = (coat as unknown as Record<string, number>)[field];
    if (!Number.isFinite(value) || value! < lo || value! > hi) errors.push(`coat ${field} out of range`);
  }
  if (!Number.isInteger(coat.seed) || coat.seed < 0 || coat.seed > 0xffffffff) errors.push('invalid coat seed');
  if (coat.markRole !== 'accent' && coat.markRole !== 'belly') errors.push('invalid coat mark role');
  if (!coat.colours || !COAT_ROLES.every(role => Array.isArray(coat.colours[role]) && coat.colours[role].length === 3 && coat.colours[role].every(v => Number.isFinite(v) && v >= 0 && v <= 1))) errors.push('invalid coat colours');
  return errors;
}
export function isPigmentFamily(value: unknown): value is PigmentFamily { return typeof value === 'string' && (PIGMENT_FAMILIES as readonly string[]).includes(value); }

/** A species keeps one morphology regardless of specimen, life stage or camera. */
export function inheritedFaunaFamily(genome: CreatureGenome): FaunaMorphologyFamily {
  if (genome.morphology) return genome.morphology.family;
  if (genome.archetype === 'browser') return 'ungulate';
  if (genome.archetype === 'runner') return 'cursorial';
  if (genome.archetype === 'long-neck') return 'long-neck';
  return hash(`${genome.torsoLength}/${genome.torsoWidth}/${genome.color}/family-v1`) % 4 === 0 ? 'proboscidean' : 'padded';
}

/** Relative growth scales at the reviewed juvenile stage (maturity 0.28, not
 * years or world date). Precocial browsers retain long legs; young long-necked
 * animals have a shorter neck. Heads and feet develop ahead of the trunk.
 * fauna-appearance-2 interpolates these by (1 - maturity) / 0.72. */
export const FAUNA_JUVENILE_PROPORTIONS: Record<CreatureArchetype, { trunk: number; width: number; limb: number; neck: number; head: number; foot: number; ear: number }> = {
  browser: { trunk: .58, width: .55, limb: .69, neck: .53, head: .75, foot: .76, ear: .82 },
  runner: { trunk: .56, width: .56, limb: .63, neck: .57, head: .76, foot: .80, ear: .82 },
  'low-slung': { trunk: .59, width: .58, limb: .62, neck: .56, head: .75, foot: .78, ear: .80 },
  'long-neck': { trunk: .59, width: .56, limb: .71, neck: .43, head: .73, foot: .77, ear: .81 },
};
/** The maturity at which FAUNA_JUVENILE_PROPORTIONS were authored. */
export const FAUNA_REFERENCE_JUVENILE_MATURITY = .28;

// ---------------------------------------------------------------------------
// Sampling.
// ---------------------------------------------------------------------------

/** Body-plan region names accepted by sampleFaunaCoat (coat regions pass through). */
export type FaunaBodyRegion = 'torso' | 'neck' | 'head' | 'tail' | 'upper' | 'lower' | 'foot' | 'armor';
/** Optional surface detail for one sample. dorsal: the surface normal's
 * vertical component (default from height); along: 0..1 within the region,
 * proximal to distal; cellM: the mesh's vertex spacing in metres, which widens
 * mark edges and bounds the pattern scale so marks span several vertices. */
export interface FaunaCoatSurface { dorsal?: number; along?: number; cellM?: number }

const REGION_MAP: Readonly<Record<string, CoatRegion>> = {
  torso: 'torso', neck: 'neck', head: 'head', tail: 'tail', upper: 'limb-upper', lower: 'limb-lower', foot: 'foot', armor: 'armor',
  muzzle: 'muzzle', ear: 'ear', 'limb-upper': 'limb-upper', 'limb-lower': 'limb-lower', 'tail-tip': 'tail-tip', horn: 'horn', wing: 'wing', eye: 'eye',
};
/** Pattern feature constants for the vertex-density clamp: the mark (cell,
 * stripe period) spans `k / (cells per body x scale)` torso lengths and must
 * cover at least four mesh cells. Spots use coatMinFeature (spot diameter)
 * exactly; thin lines (reticulation, rosette rings) are carried by the
 * footprint instead of being clamped away, but a rosette's dark centre must
 * still span five cells or it renders as a square block (k 0.4). Roan, saddle and dorsal stripes are
 * not cellular and need no clamp. */
const CLAMP_FEATURE: Partial<Record<ResolvedCoatPattern, number>> = {
  rosettes: .4, reticulated: .67, dapple: .67, stripes: .67, bands: .67, brindle: .67, piebald: .67,
};
/** Largest pattern scale whose marks span 4 cells of `cell` torso lengths. */
export function faunaCoatMaxScale(coat: CoatGenome, cell: number): number {
  const need = 4 * cell;
  if (!(need > 0)) return Infinity;
  if (coat.pattern === 'spots') return coatMinFeature({ ...coat, marks: 0, scale: 1 }) / need;
  const k = CLAMP_FEATURE[coat.pattern], cells = COAT_CELLS_PER_BODY[coat.pattern];
  return k === undefined || !(cells > 0) ? Infinity : k / (cells * need);
}
let clampSource: CoatGenome | undefined, clampCell = NaN, clampResult: CoatGenome | undefined;
function clampedCoat(coat: CoatGenome, cell: number): CoatGenome {
  if (coat === clampSource && cell === clampCell) return clampResult!;
  const max = faunaCoatMaxScale(coat, cell);
  clampSource = coat; clampCell = cell;
  clampResult = coat.scale > max ? { ...coat, scale: max } : coat;
  return clampResult;
}

/** Individual offset (torso lengths) of banded and striped coats: up to one
 * pattern period, so every animal's bands fall differently on its body. */
function bandPhase(a: FaunaAppearance): number {
  const c = a.coat;
  if ((c.pattern !== 'bands' && c.pattern !== 'stripes') || !Number.isFinite(a.individual.coatPhase)) return 0;
  return a.individual.coatPhase! / (COAT_CELLS_PER_BODY[c.pattern] * c.scale);
}
const SAMPLE: CoatSample = { x: 0, y: 0, z: 0, dorsal: 0, region: 'torso', along: 0, footprint: 0 };
const OUT = new Float64Array(3);

/** Fills SAMPLE in torso-length units (x forward, y from the torso axis, z signed). */
function prepare(genome: CreatureGenome, x: number, y: number, z: number, torsoY: number, region: string | undefined, surface: FaunaCoatSurface | undefined): CoatGenome {
  const a = genome.appearance!, TL = Math.max(genome.torsoLength, 1e-3);
  SAMPLE.x = x / TL + bandPhase(a); SAMPLE.y = (y - torsoY) / TL; SAMPLE.z = z / TL * (a.growth.lateral ?? 1);
  SAMPLE.dorsal = surface?.dorsal !== undefined && Number.isFinite(surface.dorsal) ? clamp(surface.dorsal, -1, 1) : clamp(2 * (y - torsoY) / Math.max(genome.torsoHeight, .05), -1, 1);
  SAMPLE.region = (region !== undefined && REGION_MAP[region]) || 'torso';
  SAMPLE.along = surface?.along !== undefined && Number.isFinite(surface.along) ? clamp(surface.along, 0, 1) : 0;
  const cell = surface?.cellM !== undefined && surface.cellM > 0 ? surface.cellM / TL : 0;
  SAMPLE.footprint = coatFootprint(a.coat, cell);
  return cell > 0 ? clampedCoat(a.coat, cell) : a.coat;
}

/** Exact prepared planetary pattern coordinates and the source-density-clamped
 * coat. Caller scratch receives a copy; no global sampler scratch is exposed. */
export function faunaPreparedCoatContextInto(genome:CreatureGenome,x:number,y:number,z:number,torsoY:number,region:FaunaBodyRegion|CoatRegion,surface:FaunaCoatSurface,out:CoatSample):Readonly<CoatGenome>|undefined{
  if(genome.appearance?.version!==FAUNA_APPEARANCE_VERSION||!genome.appearance.coat)return undefined;
  const coat=prepare(genome,x,y,z,torsoY,region,surface);Object.assign(out,SAMPLE);return coat;
}
/** Fawn spots sized for the near mesh. The coat library's juvenile spots
 * (0.0085-0.0145 torso lengths) are finer than the 0.019-0.028 TL vertex
 * cells of a juvenile body and render as single-vertex triangles and bars, so
 * near bodies draw their own: whole spots in rows along the back and flank
 * (and onto the thigh where a spot crosses the limb seam), laid out
 * on the torso surface (forward x, arc length from the spine) with a radius of
 * at least 2.1 mesh cells (over a four-cell diameter) and gaps of at least two
 * cells. Same colour and strength as the library layer. */
/** Linear cream of fawn spots (the WP1 juvenile-spot white). */
const FAWN_CREAM = [.6, .585, .55] as const;
const FAWN_SPOT_CELLS = 2.1, FAWN_DEFAULT_CELL = .024, FAWN_SALT = 0x5a1f7e31, FAWN_JITTER = .1, FAWN_X0 = -.36, FAWN_X1 = .28;
export interface FaunaFawnSpotLayout { radius: number; spacing: number; rowGap: number; rows: readonly number[] }
/** Spot layout in torso lengths for a near body whose vertex cell is
 * `cell` torso lengths. */
export function faunaFawnSpotLayout(cell: number): FaunaFawnSpotLayout {
  const c = cell > 0 ? cell : FAWN_DEFAULT_CELL, radius = Math.max(FAWN_SPOT_CELLS * c, .042);
  // Two neighbouring spots at their largest radius (1 + FAWN_JITTER) and closest
  // jitter still leave a two-cell gap: along a row, between offset rows and
  // across the spine.
  const clear = 2 * (1 + FAWN_JITTER) * radius + 2 * c, spacing = clear / (1 - 2 * FAWN_JITTER);
  const half = .5 * spacing * (1 - 2 * FAWN_JITTER), rowGap = Math.sqrt(Math.max(clear * clear - half * half, 0)) / (1 - 2 * FAWN_JITTER);
  const first = .5 * clear + FAWN_JITTER * rowGap;
  return { radius, spacing, rowGap, rows: [first, first + rowGap, first + 2 * rowGap] };
}
let fawnSource: CoatGenome | undefined, fawnResult: CoatGenome | undefined;
function withoutLibrarySpots(coat: CoatGenome): CoatGenome {
  if (coat !== fawnSource) { fawnSource = coat; fawnResult = { ...coat, marks: coat.marks & ~COAT_MARK_BITS['juvenile-spots'] }; }
  return fawnResult!;
}
/** Fawn-spot coverage (0..1) at a torso or thigh vertex: x forward of the
 * torso centre, (dy, z) from the torso axis, all in torso lengths; halfH and
 * halfW are the torso's half height and half width. The dorsal row lies along
 * the spine in surface coordinates (arc length from the spine); the two flank
 * rows are laid out in side projection, which stays continuous across the
 * torso/thigh seam, so a flank spot over the hip is painted whole on both. */
let fawnLayoutCell = NaN, fawnLayout: FaunaFawnSpotLayout | undefined;
function fawnSpotMask(seed: number, x: number, dy: number, z: number, cell: number, halfH: number, halfW: number): number {
  // One body shares one cell size: reuse its layout instead of allocating per vertex.
  if (cell !== fawnLayoutCell || !fawnLayout) { fawnLayoutCell = cell; fawnLayout = faunaFawnSpotLayout(cell); }
  const L = fawnLayout;
  if (x < FAWN_X0 - 2 * L.radius || x > FAWN_X1 + 2 * L.radius) return 0;
  const rLoc = Math.hypot(dy, z), arc = Math.atan2(Math.abs(z), dy) * rLoc, side = z >= 0 ? 1 : 2, e = .6 * (cell > 0 ? cell : FAWN_DEFAULT_CELL);
  const top = halfH * Math.cos(Math.min(L.rows[0]! / Math.max(halfH, 1e-3), Math.PI / 2)), flank = Math.abs(z) >= .4 * halfW;
  let best = 0;
  for (let row = 0; row < 3; row++) {
    // Row 0: arc from the spine; rows 1-2: height in side projection.
    const v0 = row === 0 ? arc : dy, centre = row === 0 ? L.rows[0]! : top - row * L.rowGap, offset = row === 1 ? .5 : row === 2 ? .25 : 0;
    if (row > 0 && !flank) continue;
    if (Math.abs(v0 - centre) > L.rowGap) continue;
    const k = Math.floor(x / L.spacing - offset);
    for (let j = k - 1; j <= k + 1; j++) {
      const h0 = hash3u(j, row, side, seed ^ FAWN_SALT), h1 = hash3u(j, row, side + 4, seed ^ FAWN_SALT);
      if ((h0 & 255) / 256 > (row === 2 ? .45 : .9)) continue; // the lowest row is sparse
      const px = (j + offset + .5 + ((h0 >>> 8 & 255) / 255 - .5) * 2 * FAWN_JITTER) * L.spacing;
      // Whole spots only: a spot is kept or dropped by its centre, never faded.
      if (px < FAWN_X0 || px > FAWN_X1) continue;
      const pv = centre + ((h0 >>> 16 & 255) / 255 - .5) * 2 * FAWN_JITTER * L.rowGap;
      const radius = L.radius * (1 + FAWN_JITTER * (h1 & 255) / 255);
      const v = 1 - smooth(radius - e, radius + e, Math.hypot(x - px, v0 - pv));
      if (v > best) best = v;
    }
  }
  return best;
}

/** Vertex coat in linear light. Torso-normalised bind-space coordinates keep
 * the same markings on adult and juvenile bodies; z is signed, so the flanks
 * differ. No maps, GPU resources, random state or added draw calls. The
 * undefined branch preserves legacy coats; a v1 appearance keeps its v1 coat. */
export function sampleFaunaCoat(genome: CreatureGenome, x: number, y: number, z: number, torsoY: number, region?: FaunaBodyRegion | CoatRegion, surface?: FaunaCoatSurface): CoatColor | undefined {
  return sampleFaunaCoatInternal(genome,x,y,z,torsoY,region,surface);
}
/** Existing planetary colour arithmetic with only the library's raw main
 * pattern/patch mask overridden. Juvenile fawn/stocking and region rules remain.
 * Used to test whether a source point is affine enough for a shared GLSL mask. */
export function sampleFaunaCoatWithPatternMask(genome:CreatureGenome,x:number,y:number,z:number,torsoY:number,region:FaunaBodyRegion|CoatRegion,surface:FaunaCoatSurface,mask:number,patch:number):CoatColor|undefined{
  if(!Number.isFinite(mask)||mask<0||mask>1||!Number.isFinite(patch)||patch<0||patch>1)throw new Error('planet coat mask: mask/patch0..1 required');
  return sampleFaunaCoatInternal(genome,x,y,z,torsoY,region,surface,mask,patch);
}
function sampleFaunaCoatInternal(genome:CreatureGenome,x:number,y:number,z:number,torsoY:number,region:FaunaBodyRegion|CoatRegion|undefined,surface:FaunaCoatSurface|undefined,forcedMask?:number,forcedPatch=0):CoatColor|undefined {
  const a = genome.appearance;
  if (!a) return undefined;
  if (a.version !== FAUNA_APPEARANCE_VERSION || !a.coat) return sampleLegacyCoat(genome, x, y, z, torsoY);
  const coat = prepare(genome, x, y, z, torsoY, region, surface);
  const stockings = a.growth.stage === 'juvenile' && (coat.marks & COAT_MARK_BITS.socks) !== 0 && (SAMPLE.region === 'limb-lower' || SAMPLE.region === 'foot');
  if (!(coat.marks & COAT_MARK_BITS['juvenile-spots']) || !(coat.juvenileSpots > 0)) {
    if(forcedMask===undefined)evaluateCoat(coat,SAMPLE,OUT,0);else evaluateCoatWithMask(coat,SAMPLE,OUT,0,forcedMask,forcedPatch);
    if(stockings)developingStockings(coat,a.growth.maturity,forcedMask,forcedPatch);
    return [OUT[0]!, OUT[1]!, OUT[2]!];
  }
  const unspotted = withoutLibrarySpots(coat);
  if(forcedMask===undefined)evaluateCoat(unspotted,SAMPLE,OUT,0);else evaluateCoatWithMask(unspotted,SAMPLE,OUT,0,forcedMask,forcedPatch);
  if(stockings)developingStockings(unspotted,a.growth.maturity,forcedMask,forcedPatch);
  // The thigh continues the flank, so spots cut by the torso/limb region seam
  // stay whole discs; the neck is excluded (its surface leaves the torso axis).
  if (SAMPLE.region === 'torso' || SAMPLE.region === 'limb-upper') {
    const TL = Math.max(genome.torsoLength, 1e-3), cell = surface?.cellM !== undefined && surface.cellM > 0 ? surface.cellM / TL : 0;
    const k = fawnSpotMask(coat.seed, x / TL, (y - torsoY) / TL, z / TL, cell, genome.torsoHeight / 2 / TL, genome.torsoWidth / 2 / TL);
    if (k > 0) {
      // The spot is the pale belly cream, but always at least halfway from the
      // local coat to cream, so a disc crossing a pale band stays a whole disc
      // instead of showing only where it overlaps the dark band.
      const b = coat.colours.belly, t = .85 * coat.juvenileSpots * k;
      for (let c = 0; c < 3; c++) { const cream = FAWN_CREAM[c]!; OUT[c] = mix(OUT[c]!, Math.max(mix(b[c]!, cream, .55), mix(OUT[c]!, cream, .5)), t); }
    }
  }
  return [OUT[0]!, OUT[1]!, OUT[2]!];
}

/** Stocking strength of a juvenile (0.4 at maturity 0.2, 0.7 at 0.45, 1 by
 * 0.7). Leg stockings darken and sharpen with age: gaur and banteng calves
 * are near body-coloured below the knee, and bear cubs and young tapirs lack
 * the adults' dark legs. The young's lower legs also take a larger share of
 * the skin (by about half), so full-strength stockings would make juveniles
 * read darker than their stage-invariant far colour. */
export function faunaJuvenileStockingStrength(maturity: number): number { return mix(.4, 1, smooth(.2, .7, maturity)); }
let sockSource: CoatGenome | undefined, sockResult: CoatGenome | undefined;
const SOCK_OUT = new Float64Array(3);
/** Blends OUT (the stockinged lower leg) toward the same point without
 * stockings, by the juvenile's undeveloped share. */
function developingStockings(coat: CoatGenome, maturity: number, forcedMask?:number,forcedPatch=0): void {
  const k = faunaJuvenileStockingStrength(maturity);
  if (k >= 1) return;
  if (coat !== sockSource) { sockSource = coat; sockResult = { ...coat, marks: coat.marks & ~COAT_MARK_BITS.socks }; }
  if(forcedMask===undefined)evaluateCoat(sockResult!,SAMPLE,SOCK_OUT,0);else evaluateCoatWithMask(sockResult!,SAMPLE,SOCK_OUT,0,forcedMask,forcedPatch);
  for (let c = 0; c < 3; c++) OUT[c] = mix(SOCK_OUT[c]!, OUT[c]!, k);
}

const PROBE = new Float64Array(5);
/** Review/test probe: the raw pattern mark (0..1) the coat draws at a point,
 * before region strength and colour; 0 for legacy appearances. */
export function faunaCoatMark(genome: CreatureGenome, x: number, y: number, z: number, torsoY: number, region?: FaunaBodyRegion | CoatRegion, surface?: FaunaCoatSurface): number {
  const a = genome.appearance;
  if (!a || a.version !== FAUNA_APPEARANCE_VERSION || !a.coat) return 0;
  const coat = prepare(genome, x, y, z, torsoY, region, surface);
  if (coat.pattern === 'plain') return 0;
  // Pattern probe: identical placement to evaluateCoat.
  coatPatternProbe(coat, SAMPLE, PROBE);
  return PROBE[0]!;
}

/** The v1 coat (fauna-appearance-1), unchanged. */
function sampleLegacyCoat(genome: CreatureGenome, x: number, y: number, z: number, torsoY: number): CoatColor {
  const a = genome.appearance!;
  const u = x / genome.torsoLength, v = (y - torsoY) / genome.torsoHeight, w = Math.abs(z) / genome.torsoWidth;
  const phase = (a.markingSeed >>> 0) / 0x100000000 * Math.PI * 2;
  let marking = 0;
  if (a.pattern === 'stripes') {
    const wave = Math.sin(u * 32 + Math.sin(v * 4 + phase) * .65 + w * 1.5 + phase);
    marking = smooth(.44, .72, wave) * (1 - smooth(.6, 1.3, Math.abs(v)));
  } else if (a.pattern === 'spots') {
    // Jittered staggered cells avoid a visibly regular checkerboard of spots.
    const su = u * 10, sv = v * 6 + w * .7;
    const ix = Math.floor(su), iy = Math.floor(sv);
    let distance = 2;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cx = ix + dx, cy = iy + dy, cell = `${a.markingSeed}/${cx}/${cy}`;
      const ox = .5 + signed(`${cell}/x`) * .22, oy = .5 + signed(`${cell}/y`) * .22;
      distance = Math.min(distance, Math.hypot(su - cx - ox, sv - cy - oy));
    }
    marking = (1 - smooth(.20, .34, distance)) * (1 - smooth(.7, 1.4, Math.abs(v)));
  }
  const base = linear(a.palette.base), marks = linear(a.palette.marking), belly = linear(a.palette.belly);
  const underside = 1 - smooth(-.42, .06, v);
  const dorsal = 1 - .10 * smooth(.02, .55, v);
  // Very small analytic mottling provides restrained coat variation at every LOD.
  const grain = 1 + .018 * Math.sin(u * 69 + v * 23 + phase) * Math.sin(w * 37 - v * 41);
  return base.map((b, i) => clamp(mix(mix(b, marks[i]!, marking * .78), belly[i]!, underside * .62) * dorsal * grain, 0, 1)) as CoatColor;
}
