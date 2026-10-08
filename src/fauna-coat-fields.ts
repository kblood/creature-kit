/**
 * Pure deterministic coat-field library (fauna-coat-1).
 *
 * Evaluates a creature coat colour (linear RGB) at a bind-space sample point.
 * Used as vertex colour by the composer and the planet body; there is no GPU
 * dependency, no texture and no shader, so CPU results are exact.
 *
 * Contract:
 * - Erasable TypeScript only (Node type-strips src/*.ts): no enum, namespace or
 *   parameter properties. No `three` import, no global random source, no clock.
 * - All randomness is integer lattice hashing (pcg3d-style, Math.imul, >>>0) or
 *   the composerHash-compatible string stream for per-species and per-individual
 *   draws. The hash and noise functions below are FROZEN once merged: composer
 *   determinism and planet appearance both depend on them. Any change must be
 *   released as 'fauna-coat-2'.
 * - evaluateCoat allocates nothing; it reuses module-level scratch and writes into
 *   a caller array. No state survives between calls, so evaluation order never
 *   changes a result.
 *
 * Sample space: x, y, z are bind-space metres divided by body length, +X toward
 * the head, +Y up, z SIGNED (left and right flanks differ). dorsal is the
 * surface's up-facing measure, 1 on the spine and -1 on the belly midline.
 * along runs 0..1 within the region, from the proximal end (the end nearer the
 * torso) to the distal end (snout, hoof, tail tip, ear tip).
 */
import {
  COAT_MARK_BITS, COAT_PALETTE_HEX, COAT_ROLES, isCoatPaletteId, isCoatPattern, resolveCoatPattern,
  type CoatPaletteId, type CoatPattern, type CoatRegion, type CoatRole, type ResolvedCoatPattern,
} from './fauna-coat-vocab.ts';

export const FAUNA_COAT_FIELD_VERSION = 'fauna-coat-1';

export type CoatRGB = [number, number, number];
export type CoatColours = Record<CoatRole, CoatRGB>;
/** Which palette role a pattern's marks take: dark ('accent') or light ('belly'). */
export type CoatMarkRole = 'accent' | 'belly';

export interface CoatGenome {
  version: 'fauna-coat-1';
  /** Resolved pattern; never 'auto'. */
  pattern: ResolvedCoatPattern;
  /** OR of COAT_MARK_BITS, 0..255. */
  marks: number;
  /** Pattern frequency multiplier, 0.5..2 (higher = smaller, denser marks). */
  scale: number;
  /** Mark strength, 0..1.5 (values above 1 push past the mark colour). */
  contrast: number;
  /** Pale-belly strength, 0..1. */
  countershade: number;
  /** Dorsal value where the countershading transition is centred; default -0.45. */
  bellyLine: number;
  /** Linear RGB per role. */
  colours: CoatColours;
  markRole: CoatMarkRole;
  /** Pattern placement seed (uint32). */
  seed: number;
  /** Domain-warp amount, 0..1. */
  warp: number;
  /** Mark-coverage offset, -0.3..0.3 (positive = more marked area). */
  threshold: number;
  /** Juvenile spot strength, 0..1; only drawn when the 'juvenile-spots' mark bit is set. */
  juvenileSpots: number;
  /** Muzzle greying, 0..1. */
  greying: number;
}

export interface CoatSample {
  x: number;
  y: number;
  z: number;
  /** -1 (belly midline) .. 1 (spine). */
  dorsal: number;
  region: CoatRegion;
  /** 0..1 within the region, proximal to distal. */
  along: number;
  /**
   * Optional sampling spacing in body lengths (for example the local vertex
   * spacing). Widens edges so marks thinner than the spacing blend toward their
   * average instead of aliasing into triangle-shaped blots. Default 0.
   */
  footprint?: number;
}

/** Inclusive numeric ranges for genome fields. */
export const COAT_GENOME_RANGES = {
  marks: [0, 255],
  scale: [0.5, 2],
  contrast: [0, 1.5],
  countershade: [0, 1],
  bellyLine: [-1, 1],
  warp: [0, 1],
  threshold: [-0.3, 0.3],
  juvenileSpots: [0, 1],
  greying: [0, 1],
} as const;

/** Pattern cells (or stripe periods) per body length at scale 1. */
export const COAT_CELLS_PER_BODY: Readonly<Record<ResolvedCoatPattern, number>> = {
  plain: 0,
  spots: 11,
  rosettes: 8,
  reticulated: 6.5,
  stripes: 4.5,
  bands: 3,
  saddle: 0,
  'dorsal-stripe': 0,
  dapple: 12,
  piebald: 2.2,
  roan: 60,
  brindle: 9,
};

// ------------------------------------------------------------------ small math
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
/** Hermite smoothstep; a > b gives the descending ramp. */
function smooth(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }

// ------------------------------------------------------------------ integer lattice hash (FROZEN)
const INV32 = 1 / 4294967296;
let H0 = 0, H1 = 0, H2 = 0;

/** Seed pre-mix so seeds n and n+1 are unrelated lattices. */
function seedMix(seed: number): number {
  let s = ((seed >>> 0) ^ 0x9e3779b9) | 0;
  s = Math.imul(s ^ (s >>> 16), 0x7feb352d);
  s = Math.imul(s ^ (s >>> 15), 0x846ca68b);
  return (s ^ (s >>> 16)) | 0;
}

/** pcg3d over an integer lattice point and a pre-mixed seed; writes H0..H2. */
function pcg3(x: number, y: number, z: number, s: number): void {
  let a = (Math.imul(x | 0, 1664525) + 1013904223 + s) | 0;
  let b = (Math.imul(y | 0, 1664525) + 1013904223 ^ ((s << 11) | (s >>> 21))) | 0;
  let c = (Math.imul(z | 0, 1664525) + 1013904223 + Math.imul(s, 0x27d4eb2f)) | 0;
  a = (a + Math.imul(b, c)) | 0; b = (b + Math.imul(c, a)) | 0; c = (c + Math.imul(a, b)) | 0;
  a ^= a >>> 16; b ^= b >>> 16; c ^= c >>> 16;
  a = (a + Math.imul(b, c)) | 0; b = (b + Math.imul(c, a)) | 0; c = (c + Math.imul(a, b)) | 0;
  H0 = a >>> 0; H1 = b >>> 0; H2 = c >>> 0;
}

/** Integer lattice hash: uint32 for an integer point and a seed. */
export function hash3u(x: number, y: number, z: number, seed: number): number {
  pcg3(x, y, z, seedMix(seed));
  return H2;
}

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }

/** Value noise with a pre-mixed seed; result in [0, 1). */
function vnoise(x: number, y: number, z: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
  pcg3(ix, iy, iz, s); const c000 = H2;
  pcg3(ix + 1, iy, iz, s); const c100 = H2;
  pcg3(ix, iy + 1, iz, s); const c010 = H2;
  pcg3(ix + 1, iy + 1, iz, s); const c110 = H2;
  pcg3(ix, iy, iz + 1, s); const c001 = H2;
  pcg3(ix + 1, iy, iz + 1, s); const c101 = H2;
  pcg3(ix, iy + 1, iz + 1, s); const c011 = H2;
  pcg3(ix + 1, iy + 1, iz + 1, s); const c111 = H2;
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return (y0 + (y1 - y0) * w) * INV32;
}

let NX = 0, NY = 0, NZ = 0;
/** Three independent value-noise channels from one lattice walk; writes NX..NZ in [0, 1). */
function vnoise3v(x: number, y: number, z: number, s: number): void {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
  let ax = 0, ay = 0, az = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const weight = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    pcg3(ix + dx, iy + dy, iz + dz, s);
    ax += H0 * weight; ay += H1 * weight; az += H2 * weight;
  }
  NX = ax * INV32; NY = ay * INV32; NZ = az * INV32;
}

/** Smooth (quintic-interpolated) value noise in [0, 1). */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  return vnoise(x, y, z, seedMix(seed));
}

function fbm2s(x: number, y: number, z: number, s: number): number {
  return (2 * vnoise(x, y, z, s) + vnoise(x * 2.03 + 17.31, y * 2.03 - 9.17, z * 2.03 + 5.71, (s ^ 0x5bd1e995) | 0)) / 3;
}
/** Two-octave value-noise fBm in 3D ("2" is the octave count); result in [0, 1). */
export function fbm2(x: number, y: number, z: number, seed: number): number {
  return fbm2s(x, y, z, seedMix(seed));
}

const WORLEY_JITTER = 0.9;
/** Worley/cellular noise with a pre-mixed seed. Writes out[0]=F1, out[1]=F2,
 * out[2]=nearest-cell hash (uint32) and, when out has room, out[3..5] = the
 * vector from the nearest feature point to the sample. */
function worleys(x: number, y: number, z: number, s: number, out: ArrayLike<number> & { [i: number]: number }): void {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let f1 = 1e9, f2 = 1e9, h = 0, vx = 0, vy = 0, vz = 0;
  const lo = (1 - WORLEY_JITTER) * 0.5;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const cx = ix + a, cy = iy + b, cz = iz + c;
    pcg3(cx, cy, cz, s);
    const dx = x - (cx + lo + WORLEY_JITTER * H0 * INV32);
    const dy = y - (cy + lo + WORLEY_JITTER * H1 * INV32);
    const dz = z - (cz + lo + WORLEY_JITTER * H2 * INV32);
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < f1) { f2 = f1; f1 = d2; h = Math.imul(H0 ^ (H2 >>> 7), 0x9e3779b1) ^ H1; vx = dx; vy = dy; vz = dz; }
    else if (d2 < f2) f2 = d2;
  }
  out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2); out[2] = h >>> 0;
  if (out.length >= 6) { out[3] = vx; out[4] = vy; out[5] = vz; }
}
/** Worley noise: writes F1, F2 and the nearest cell hash (plus the offset
 * vector to the nearest feature point when out.length >= 6). Allocates nothing. */
export function worley3(x: number, y: number, z: number, seed: number, out: ArrayLike<number> & { [i: number]: number }): void {
  worleys(x, y, z, seedMix(seed), out);
}

// ------------------------------------------------------------------ string stream (composerHash-compatible)
/** Same algorithm as composerHash in fauna-composer-recipe.ts (kept local so this
 * module has no composer dependency; a test pins the equality). */
export function coatStringHash(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Same PRNG as composerRandom (mulberry32 over coatStringHash). */
export function coatRandom(seed: string): () => number {
  let state = coatStringHash(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0; let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ colour helpers
export function srgbToLinear(c: number): number { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function linearToSrgb(c: number): number { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
/** Rec. 709 relative luminance of a linear colour. */
export function coatLuminance(c: readonly number[]): number { return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; }
export function hexToLinear(hex: string): CoatRGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** HSV adjustment applied in sRGB-encoded space to a linear colour.
 * Saturation is multiplicative, so a grey stays (near) grey. */
function adjustHsv(c: readonly number[], dh: number, sMul: number, vMul: number): CoatRGB {
  const r = linearToSrgb(clamp01(c[0]!)), g = linearToSrgb(clamp01(c[1]!)), b = linearToSrgb(clamp01(c[2]!));
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-12) {
    if (max === r) h = ((g - b) / d) / 6; else if (max === g) h = ((b - r) / d + 2) / 6; else h = ((r - g) / d + 4) / 6;
    if (h < 0) h += 1;
  }
  const s = max > 0 ? d / max : 0;
  h = ((h + dh) % 1 + 1) % 1;
  const s2 = clamp01(s * sMul), v2 = clamp01(max * vMul);
  const i = Math.floor(h * 6), f = h * 6 - i, p = v2 * (1 - s2), q = v2 * (1 - f * s2), t = v2 * (1 - (1 - f) * s2);
  let ro = v2, go = t, bo = p;
  switch (i % 6) {
    case 1: ro = q; go = v2; bo = p; break;
    case 2: ro = p; go = v2; bo = t; break;
    case 3: ro = p; go = q; bo = v2; break;
    case 4: ro = t; go = p; bo = v2; break;
    case 5: ro = v2; go = p; bo = q; break;
  }
  return [srgbToLinear(ro), srgbToLinear(go), srgbToLinear(bo)];
}

/** Pigmented roles carry a physically plausible albedo window. */
const ROLE_LUMINANCE: Readonly<Record<CoatRole, readonly [number, number]>> = {
  base: [0.02, 0.6], accent: [0.02, 0.6], belly: [0.02, 0.6], skin: [0.02, 0.6],
  keratin: [0, 0.5], eye: [0, 0.6], horn: [0, 0.6], plate: [0.02, 0.6],
};
function clampRoleLuminance(role: CoatRole, c: CoatRGB): CoatRGB {
  const [lo, hi] = ROLE_LUMINANCE[role], l = coatLuminance(c);
  if (l >= lo && l <= hi) return c;
  if (l <= 1e-9) { const t = Math.max(lo, 1e-4); return [t, t, t]; }
  const k = (l < lo ? lo : hi) / l;
  return [c[0] * k, c[1] * k, c[2] * k];
}
function copyColours(c: CoatColours): CoatColours {
  const out = {} as CoatColours;
  for (const role of COAT_ROLES) out[role] = [c[role][0], c[role][1], c[role][2]];
  return out;
}

function speciesDraws(paletteId: CoatPaletteId, colorSeed: number | string) {
  const rand = coatRandom(`coat-species-v1/${paletteId}/${colorSeed}`);
  // Fixed draw order: hue, saturation, value, pattern seed.
  const dh = (rand() - 0.5) * 0.08, ds = (rand() - 0.5) * 0.24, dv = (rand() - 0.5) * 0.2;
  const seed = Math.floor(rand() * 4294967296) >>> 0;
  return { dh, ds, dv, seed };
}

/** Species colours (linear RGB per role) for a palette and colour seed, from
 * stream `coat-species-v1/<palette>/<colorSeed>`: hue +-0.04, saturation
 * x(1+-0.12), value x(1+-0.10) in HSV, then a per-role albedo clamp. */
export function coatSpeciesColours(paletteId: CoatPaletteId, colorSeed: number | string): CoatColours {
  if (!isCoatPaletteId(paletteId)) throw new RangeError(`Unknown coat palette '${String(paletteId)}'`);
  const d = speciesDraws(paletteId, colorSeed), row = COAT_PALETTE_HEX[paletteId], out = {} as CoatColours;
  for (const role of COAT_ROLES) out[role] = clampRoleLuminance(role, adjustHsv(hexToLinear(row[role]), d.dh, 1 + d.ds, 1 + d.dv));
  return out;
}

// ------------------------------------------------------------------ individual drift
export const COAT_MORPHS = ['none', 'melanistic', 'leucistic', 'erythristic'] as const;
export type CoatMorph = typeof COAT_MORPHS[number];
/** Morph probability per individual at variability 1 (scaled linearly by v). */
export const COAT_MORPH_RATES = { melanistic: 0.012, leucistic: 0.004, erythristic: 0.008 } as const;

export interface CoatDrift {
  /** Hue shift (fraction of the colour wheel). */
  hue: number;
  /** Relative saturation change (0.1 = x1.1). */
  saturation: number;
  /** Relative value change. */
  value: number;
  /** XOR applied to the pattern seed; 0 keeps the species seed. */
  reseed: number;
  /** Relative pattern-scale change. */
  scale: number;
  /** Added to the threshold offset. */
  threshold: number;
  /** Added to the warp amount. */
  warp: number;
  /** Added to greying. */
  greying: number;
  morph: CoatMorph;
}

/** Per-individual drift from stream `coat-individual-v1/<key>`. All draws are
 * always taken in a fixed order, so the stream is stable for any variability;
 * variability 0 returns the identity drift. */
export function coatIndividualDrift(key: string | number, variability: number): CoatDrift {
  const v = Number.isFinite(variability) ? clamp01(variability) : 0;
  const rand = coatRandom(`coat-individual-v1/${key}`);
  const u: number[] = [];
  for (let i = 0; i < 9; i++) u.push(rand());
  if (v === 0) return { hue: 0, saturation: 0, value: 0, reseed: 0, scale: 0, threshold: 0, warp: 0, greying: 0, morph: 'none' };
  const r = u[8]!, pm = COAT_MORPH_RATES.melanistic * v, pl = COAT_MORPH_RATES.leucistic * v, pe = COAT_MORPH_RATES.erythristic * v;
  const morph: CoatMorph = r < pm ? 'melanistic' : r < pm + pl ? 'leucistic' : r < pm + pl + pe ? 'erythristic' : 'none';
  return {
    hue: (u[0]! * 2 - 1) * 0.015 * v,
    value: (u[1]! * 2 - 1) * 0.08 * v,
    saturation: (u[2]! * 2 - 1) * 0.10 * v,
    reseed: (Math.floor(u[3]! * 4294967296) | 1) >>> 0,
    scale: (u[4]! * 2 - 1) * 0.08 * v,
    threshold: (u[5]! * 2 - 1) * 0.06 * v,
    warp: (u[6]! * 2 - 1) * 0.1 * v,
    greying: 0.3 * v * u[7]! * u[7]!,
    morph,
  };
}

const PIGMENT_ROLES: readonly CoatRole[] = ['base', 'accent', 'belly', 'skin'];
/** Apply an individual drift; returns a new genome (the input is not modified). */
export function applyCoatDrift(genome: CoatGenome, drift: CoatDrift): CoatGenome {
  const colours = copyColours(genome.colours);
  const tint = drift.hue !== 0 || drift.saturation !== 0 || drift.value !== 0 || drift.morph !== 'none';
  if (tint) {
    for (const role of PIGMENT_ROLES) {
      let c = adjustHsv(colours[role], drift.hue, 1 + drift.saturation, 1 + drift.value);
      if (drift.morph === 'melanistic') c = adjustHsv(c, 0, 1, 0.35);
      else if (drift.morph === 'erythristic') c = adjustHsv(c, -0.04, 1.2, 1); // toward red (hue 0)
      else if (drift.morph === 'leucistic') {
        c = adjustHsv(c, 0, 0.25, 1);
        const l = coatLuminance(c), target = Math.min(0.55, l + (0.55 - l) * 0.8);
        if (l > 1e-6) { const k = target / l; c = [c[0] * k, c[1] * k, c[2] * k]; }
      }
      colours[role] = clampRoleLuminance(role, c);
    }
    if (drift.value !== 0) colours.plate = clampRoleLuminance('plate', adjustHsv(colours.plate, 0, 1, 1 + drift.value));
  }
  return {
    ...genome,
    colours,
    seed: drift.reseed ? (genome.seed ^ drift.reseed) >>> 0 : genome.seed,
    scale: clamp(genome.scale * (1 + drift.scale), 0.5, 2),
    threshold: clamp(genome.threshold + drift.threshold, -0.3, 0.3),
    warp: clamp01(genome.warp + drift.warp),
    greying: clamp01(genome.greying + drift.greying),
  };
}

// ------------------------------------------------------------------ genome construction
export type CoatGenomeOverrides = Partial<Omit<CoatGenome, 'version' | 'pattern' | 'colours'>> & {
  pattern?: CoatPattern;
  colours?: Partial<CoatColours>;
};

/** Default genome for a palette and colour seed. 'auto' (the default pattern)
 * resolves through AUTO_PATTERN, so legacy palettes keep their character
 * (savanna -> reticulated, reptile -> bands, earth -> saddle). */
export function defaultCoatGenome(paletteId: CoatPaletteId, colorSeed: number | string, overrides: CoatGenomeOverrides = {}): CoatGenome {
  if (!isCoatPaletteId(paletteId)) throw new RangeError(`Unknown coat palette '${String(paletteId)}'`);
  const d = speciesDraws(paletteId, colorSeed), species = coatSpeciesColours(paletteId, colorSeed);
  const requested = overrides.pattern ?? 'auto';
  if (!isCoatPattern(requested)) throw new RangeError(`Unknown coat pattern '${String(requested)}'`);
  const marks = clamp(Math.round(overrides.marks ?? 0), 0, 255);
  const colours = copyColours(species);
  if (overrides.colours) for (const role of COAT_ROLES) { const c = overrides.colours[role]; if (c) colours[role] = [c[0], c[1], c[2]]; }
  const R = COAT_GENOME_RANGES, num = (v: number | undefined, fallback: number, [lo, hi]: readonly [number, number]) => clamp(Number.isFinite(v) ? v! : fallback, lo, hi);
  return {
    version: 'fauna-coat-1',
    pattern: resolveCoatPattern(requested, paletteId),
    marks,
    scale: num(overrides.scale, 1, R.scale),
    contrast: num(overrides.contrast, 1, R.contrast),
    countershade: num(overrides.countershade, 0.8, R.countershade),
    bellyLine: num(overrides.bellyLine, -0.45, R.bellyLine),
    colours,
    markRole: overrides.markRole === 'belly' ? 'belly' : 'accent',
    seed: overrides.seed === undefined ? d.seed : overrides.seed >>> 0,
    warp: num(overrides.warp, 0.5, R.warp),
    threshold: num(overrides.threshold, 0, R.threshold),
    juvenileSpots: num(overrides.juvenileSpots, marks & COAT_MARK_BITS['juvenile-spots'] ? 1 : 0, R.juvenileSpots),
    greying: num(overrides.greying, 0, R.greying),
  };
}

// ------------------------------------------------------------------ pattern masks
const W = new Float64Array(6);
/** Probe outputs of the last pattern evaluation (F1, F2, cell radius, patch shade). */
let PF1 = 0, PF2 = 0, PR = 0, PATCH = 0;

/** Seed offsets per field so the pattern, warp, grain and marks are unrelated. */
const SALT_WARP = 0x2c1b3c6d, SALT_DETAIL = 0x297a2d39, SALT_GRAIN = 0x5f356495, SALT_TONE = 0x1b873593, SALT_MARK = 0x68e31da4, SALT_BAND = 0x3c6ef372;

/** Raw pattern mask in 0..1 (1 = full mark) before region strength, belly fade
 * and contrast. `fp` is the footprint in body lengths. */
function patternMask(g: CoatGenome, s: CoatSample, fp: number): number {
  PF1 = 0; PF2 = 0; PR = 0; PATCH = 0;
  const p = g.pattern;
  if (p === 'plain') return 0;
  const seed = seedMix(g.seed), t = g.threshold, warp = g.warp;
  const cpb = COAT_CELLS_PER_BODY[p] * g.scale;
  const region = s.region;

  if (p === 'saddle') {
    if (region !== 'torso' && region !== 'neck' && region !== 'tail') return 0;
    const n = fbm2s(s.x * 7, s.y * 7, s.z * 7, (seed ^ SALT_DETAIL) | 0) - 0.5;
    // Grizzled edge: fine noise breaks the boundary like banded guard hairs.
    const grizzle = vnoise(s.x * 42, s.y * 42, s.z * 42, (seed ^ SALT_MARK) | 0) - 0.5;
    // A rounded blanket: full length along the spine, narrowing down the flank.
    const ex = (s.x + 0.03) / (0.3 + 0.3 * t), ey = (1 - s.dorsal) / (0.8 + 0.3 * t);
    const r = Math.sqrt(ex * ex + ey * ey) + 0.22 * warp * n + 0.16 * grizzle;
    const e = Math.max(0.06, fp * 4);
    return 1 - smooth(0.92 - e, 0.92 + e, r);
  }

  if (p === 'dorsal-stripe') {
    const ez = Math.max(0.012, fp * 0.5);
    let m = 0;
    if (region === 'torso' || region === 'neck' || region === 'tail' || region === 'head') {
      const wob = (vnoise(s.x * 18, 0.5, 0.5, (seed ^ SALT_DETAIL) | 0) - 0.5) * 0.012 * (0.5 + warp);
      const half = 0.04 + 0.03 * t;
      m = (1 - smooth(half - ez, half + ez, Math.abs(s.z + wob))) * smooth(0.55, 0.72, s.dorsal);
      if (region === 'head') m *= 1 - smooth(0.05, 0.3, s.along);
    }
    if (region === 'torso') {
      // Primitive dun markings: a faint shoulder cross over the withers.
      const sx = Math.abs(s.x - 0.26 - 0.05 * (1 - s.dorsal));
      const ex = Math.max(0.012, fp * 0.5);
      m = Math.max(m, 0.55 * (1 - smooth(0.018 - ex, 0.018 + ex, sx)) * smooth(0.2, 0.55, s.dorsal));
    } else if (region === 'limb-lower' || region === 'limb-upper') {
      // ...and faint zebra-like barring on the legs.
      const k = region === 'limb-lower' ? 5 : 3, f = s.along * k + 0.3, d = Math.abs(f - Math.floor(f) - 0.5);
      const e = Math.max(0.06, fp * k * 3);
      m = 0.45 * (1 - smooth(0.16 - e, 0.16 + e, d)) * (region === 'limb-upper' ? smooth(0.4, 1, s.along) : 1);
      // Dun 'points': the lower legs darken toward the hoof.
      if (region === 'limb-lower') m = Math.max(m, 0.6 * smooth(0.25, 0.9, s.along));
    } else if (region === 'foot' || region === 'tail-tip') m = 0.6;
    return m;
  }

  const isLimb = region === 'limb-upper' || region === 'limb-lower' || region === 'foot';
  if (p === 'stripes' || p === 'bands') {
    const stripes = p === 'stripes';
    let u: number;
    if (isLimb) {
      const rings = (region === 'limb-upper' ? 3.5 : region === 'limb-lower' ? 5 : 2) * (stripes ? 1 : 0.65) * g.scale;
      u = s.along * rings + (region === 'limb-lower' ? 0.37 : region === 'foot' ? 0.71 : 0);
    } else {
      // Stripes sweep slightly backward toward the belly.
      u = (s.x + (stripes ? 0.05 : 0.015) * (1 - s.dorsal)) * cpb;
    }
    const wAmp = stripes ? 0.55 * warp : 0.12 * warp;
    const qs = cpb * 0.6;
    u += wAmp * (fbm2s(s.x * qs, s.y * qs * 1.6, s.z * qs * 1.6, (seed ^ SALT_WARP) | 0) - 0.5) * 2;
    const k = Math.floor(u), f = u - k;
    pcg3(k, stripes ? 1 : 2, 0, (seed ^ SALT_BAND) | 0);
    // Width 0.6-1.4 per band, triangular so a few bands cannot swing the coverage.
    const width = 0.6 + 0.4 * (H0 * INV32 + (H2 & 0xffff) / 65536);
    const duty = (stripes ? 0.43 : 0.42) + 0.3 * t;
    let hw = 0.5 * duty * width;
    let d = Math.abs(f - 0.5);
    if (stripes && !isLimb) {
      // Each stripe tapers to a point at its own height above the belly.
      const end = g.bellyLine + 0.1 + 0.45 * H1 * INV32;
      hw *= smooth(end - 0.04, end + 0.22, s.dorsal);
    }
    if (stripes && H2 * INV32 < 0.3) { d = Math.abs(d - 0.55 * hw); hw *= 0.42; } // a split (double) stripe
    // Ragged edges: small edge noise, finer for stripes.
    const edge = (vnoise(s.x * cpb * 3, s.y * cpb * 3, s.z * cpb * 3, (seed ^ SALT_DETAIL) | 0) - 0.5) * (stripes ? 0.08 : 0.05);
    const e = Math.max(stripes ? 0.03 : 0.02, fp * cpb * 0.5);
    return hw <= 0 ? 0 : 1 - smooth(hw - e, hw + e, d + edge);
  }

  if (p === 'brindle') {
    const qs = cpb;
    const n1 = fbm2s(s.x * qs * 0.45, s.y * qs * 0.6, s.z * qs * 0.6, (seed ^ SALT_WARP) | 0) - 0.5;
    const n2 = vnoise(s.x * qs * 2, s.y * qs * 2, s.z * qs * 2, (seed ^ SALT_DETAIL) | 0) - 0.5;
    const u = (isLimb ? s.along * 6 * g.scale : s.x * qs + 0.4 * (1 - s.dorsal)) + (1.3 + 1.2 * warp) * n1 + 0.35 * n2;
    const f = u - Math.floor(u);
    const thick = vnoise(s.x * qs * 0.8 + 3.1, s.y * qs * 0.8, s.z * qs * 0.8, (seed ^ SALT_MARK) | 0);
    const hw = (0.1 + 0.1 * thick) * (1 + 1.2 * t);
    const e = Math.max(0.035, fp * qs * 0.5);
    const breakup = smooth(0.22, 0.4, vnoise(s.x * qs * 1.3 - 7.7, s.y * qs * 1.3, s.z * qs * 1.3, (seed ^ SALT_BAND) | 0));
    return (1 - smooth(hw - e, hw + e, Math.abs(f - 0.5))) * breakup * 0.9;
  }

  // 3D cellular and noise patterns: q in cells, with domain warp.
  let qx = s.x * cpb, qy = s.y * cpb, qz = s.z * cpb;
  const warpAmp = p === 'piebald' ? 0.45 : p === 'roan' ? 0 : p === 'reticulated' ? 0.32 : p === 'rosettes' ? 0.28 : 0.22;
  if (warpAmp > 0 && warp > 0) {
    vnoise3v(qx * 0.45 + 31.7, qy * 0.45 - 12.9, qz * 0.45 + 4.3, (seed ^ SALT_WARP) | 0);
    const a = warp * warpAmp * 2;
    qx += a * (NX - 0.5); qy += a * (NY - 0.5); qz += a * (NZ - 0.5);
  }
  const efp = fp * cpb * 0.5;

  if (p === 'spots') {
    worleys(qx, qy, qz, seed, W);
    const h = W[2]! * INV32, r0 = 0.35 + 0.06 * (2 * h - 1) + 0.25 * t, soft = Math.max(0.05, efp);
    PF1 = W[0]!; PF2 = W[1]!; PR = r0;
    return 1 - smooth(r0, r0 + soft, W[0]!);
  }
  if (p === 'rosettes') {
    // Rings follow isolines of F1/F2 (rounded, Apollonius-circle-like cells), not
    // F1/r: a 3D lattice sliced by the body surface would otherwise lose about half
    // of its rosettes to cells whose feature point lies far off the surface.
    worleys(qx, qy, qz, seed, W);
    const hc = W[2]! >>> 0, rho = W[0]! / Math.max(W[1]!, 1e-6), inv = 1 / Math.max(W[0]!, 1e-6);
    PF1 = W[0]!; PF2 = W[1]!;
    // Gaps break each ring into 3-5 irregular blotches; the gap layout differs per rosette.
    const dx = W[3]! * inv, dy = W[4]! * inv, dz = W[5]! * inv;
    const gap = vnoise(dx * 1.6 + (hc & 1023) * 0.37, dy * 1.6 + ((hc >>> 10) & 1023) * 0.41, dz * 1.6 + ((hc >>> 20) & 1023) * 0.43, (seed ^ SALT_DETAIL) | 0);
    const thick = vnoise(dx * 2.3 + 9.1, dy * 2.3 - 3.3, dz * 2.3 + 1.7, (seed ^ SALT_MARK) | 0);
    const e = Math.max(0.035, efp * 0.6);
    const outer = 0.8 - 0.04 * (hc * INV32) + 0.2 * t, inner = outer - 0.22 - 0.12 * (thick - 0.5) - 0.15 * t;
    PR = inner; PATCH = outer;
    const ring = smooth(inner - e, inner + e, rho) * (1 - smooth(outer - e, outer + e, rho)) * smooth(0.3, 0.44, gap);
    const centre = 0.35 * (1 - smooth(inner - e, inner + e, rho));
    return Math.max(ring, centre);
  }
  if (p === 'reticulated') {
    worleys(qx, qy, qz, seed, W);
    const d = W[1]! - W[0]!, h = W[2]! * INV32;
    PF1 = W[0]!; PF2 = W[1]!;
    const wob = (vnoise(qx * 1.7, qy * 1.7, qz * 1.7, (seed ^ SALT_DETAIL) | 0) - 0.5) * 0.04;
    const lo = 0.05 - 0.1 * t + wob, e = Math.max(0, efp - 0.025);
    // Patch shade varies per patch and darkens toward the patch centre.
    PATCH = clamp01(0.55 + 0.3 * h + 0.18 * smooth(0.12, 0.6, d));
    return smooth(lo - e, lo + 0.05 + e, d);
  }
  if (p === 'dapple') {
    // Rounded light dapples (F1/F2 isolines) with a darker net between them.
    worleys(qx, qy, qz, seed, W);
    PF1 = W[0]!; PF2 = W[1]!;
    const rho = W[0]! / Math.max(W[1]!, 1e-6), hi = 0.86 + 0.25 * t, e = Math.max(0, efp * 0.5);
    return 0.85 * (1 - smooth(hi - 0.45 - e, hi + 0.04 + e, rho));
  }
  if (p === 'piebald') {
    let n = fbm2s(qx, qy, qz, seed);
    // White concentrates low on the body, on the legs and on the face.
    n += 0.16 * (-s.dorsal) + (region === 'limb-lower' || region === 'foot' ? 0.18 : region === 'muzzle' || region === 'head' ? 0.1 : 0);
    const thr = 0.56 - 0.35 * t, e = Math.max(0.008, efp * 0.15);
    return smooth(thr - e, thr + e, n);
  }
  if (p === 'roan') {
    // White hairs intermixed with the base: a continuous frosting whose density
    // drifts across the body, plus fine flecks that fade out under a footprint.
    const density = 0.32 + 0.35 * t + 0.6 * (fbm2s(s.x * 2.6, s.y * 2.6, s.z * 2.6, (seed ^ SALT_DETAIL) | 0) - 0.5);
    // Two rotated lattices so the flecks show no axis-aligned grid.
    const f2 = vnoise((0.8 * qx + 0.6 * qz) * 1.73 + 5.3, qy * 1.73, (0.8 * qz - 0.6 * qx) * 1.73, (seed ^ SALT_GRAIN) | 0);
    const fleck = (0.5 * vnoise(qx, qy, qz, seed) + 0.5 * f2 - 0.5) * 0.8 * (1 - smooth(0.4, 1.2, fp * cpb));
    // White hairs never fully replace the coloured ones.
    return 0.8 * clamp01(density + fleck);
  }
  return 0;
}

/** Region strength for a pattern; varies smoothly with along at region joins. */
function regionStrength(p: ResolvedCoatPattern, s: CoatSample): number {
  const a = s.along;
  switch (s.region) {
    case 'torso': case 'neck': case 'tail': case 'tail-tip': case 'wing': return 1;
    case 'head': return p === 'roan' ? mix(1, 0.25, smooth(0, 0.3, a)) : mix(1, 0.6, smooth(0, 0.5, a));
    case 'muzzle': return p === 'roan' ? 0.2 : 0.45;
    case 'ear': return 0.5;
    case 'limb-upper': return p === 'roan' ? mix(1, 0.4, a) : p === 'dapple' ? mix(1, 0.5, a) : mix(1, 0.85, a);
    case 'limb-lower': return p === 'roan' ? mix(0.4, 0.2, a) : p === 'dapple' ? mix(0.5, 0.2, a) : mix(0.85, 0.65, a);
    case 'foot': return p === 'roan' || p === 'dapple' ? 0.2 : 0.6;
    default: return 0;
  }
}

/** How strongly each pattern fades on the belly (stripes taper on their own). */
const BELLY_FADE: Readonly<Record<ResolvedCoatPattern, number>> = {
  plain: 0, spots: 0.45, rosettes: 0.6, reticulated: 0.75, stripes: 0, bands: 0.35, saddle: 0,
  'dorsal-stripe': 0, dapple: 0.6, piebald: 0, roan: 0.3, brindle: 0.5,
};

/** Linear "white" for unpigmented fur, kept inside the albedo window. */
const WHITE_R = 0.6, WHITE_G = 0.585, WHITE_B = 0.55;

// ------------------------------------------------------------------ evaluation
let CR = 0, CG = 0, CB = 0;
function mixTo(r: number, g: number, b: number, t: number): void {
  CR += (r - CR) * t; CG += (g - CG) * t; CB += (b - CB) * t;
}

/** Evaluate the coat at one sample, writing linear RGB to out[offset..offset+2].
 * Allocates nothing. */
export function evaluateCoat(genome: CoatGenome, sample: CoatSample, out: number[] | Float32Array | Float64Array, offset = 0): void {
  const C = genome.colours, region = sample.region;
  if (region === 'eye') { const e = C.eye; out[offset] = e[0]; out[offset + 1] = e[1]; out[offset + 2] = e[2]; return; }
  const seed = seedMix(genome.seed);
  const grain = 1 + 0.08 * (vnoise(sample.x * 40, sample.y * 40, sample.z * 40, (seed ^ SALT_GRAIN) | 0) - 0.5);
  if (region === 'horn' || region === 'armor') {
    const c = region === 'horn' ? C.horn : C.plate;
    out[offset] = c[0] * grain; out[offset + 1] = c[1] * grain; out[offset + 2] = c[2] * grain; return;
  }
  const base = C.base, belly = C.belly, accent = C.accent, P = genome.pattern;
  const fp = sample.footprint !== undefined && sample.footprint > 0 ? sample.footprint : 0;
  const along = sample.along, dorsal = sample.dorsal;

  // 1. Ground colour with countershading (limbs at half strength away from the root).
  let cs = genome.countershade * smooth(genome.bellyLine + 0.3, genome.bellyLine - 0.3, dorsal);
  if (region === 'limb-upper') cs *= mix(1, 0.5, smooth(0, 0.35, along));
  else if (region === 'limb-lower' || region === 'foot') cs *= 0.5;
  if (P === 'reticulated') { CR = belly[0]; CG = belly[1]; CB = belly[2]; }
  else { CR = mix(base[0], belly[0], cs); CG = mix(base[1], belly[1], cs); CB = mix(base[2], belly[2], cs); }
  // Low-frequency tonal variation (+-3%) so a plain coat is not a flat fill.
  const tone = 1 + 0.06 * (vnoise(sample.x * 3.2, sample.y * 3.2, sample.z * 3.2, (seed ^ SALT_TONE) | 0) - 0.5);
  CR *= tone; CG *= tone; CB *= tone;

  // 2. Pattern.
  if (P !== 'plain') {
    const m = patternMask(genome, sample, fp);
    if (m > 0) {
      const fadeBelly = 1 - BELLY_FADE[P] * smooth(genome.bellyLine + 0.35, genome.bellyLine - 0.2, dorsal);
      const amount = m * regionStrength(P, sample) * fadeBelly * genome.contrast;
      let mr: number, mg: number, mb: number;
      if (P === 'reticulated') { mr = mix(base[0], accent[0], PATCH); mg = mix(base[1], accent[1], PATCH); mb = mix(base[2], accent[2], PATCH); }
      else if (P === 'piebald') { mr = mix(belly[0], WHITE_R, 0.6); mg = mix(belly[1], WHITE_G, 0.6); mb = mix(belly[2], WHITE_B, 0.6); }
      else if (P === 'roan') { mr = mix(belly[0], WHITE_R, 0.5); mg = mix(belly[1], WHITE_G, 0.5); mb = mix(belly[2], WHITE_B, 0.5); }
      else if (P === 'dapple') { mr = mix(base[0], belly[0], 0.85) * 1.08; mg = mix(base[1], belly[1], 0.85) * 1.08; mb = mix(base[2], belly[2], 0.85) * 1.08; }
      else if (genome.markRole === 'belly') { mr = mix(belly[0], WHITE_R, 0.3); mg = mix(belly[1], WHITE_G, 0.3); mb = mix(belly[2], WHITE_B, 0.3); }
      else { mr = accent[0]; mg = accent[1]; mb = accent[2]; }
      if (amount <= 1) mixTo(mr, mg, mb, amount);
      else { // contrast > 1 pushes past the mark colour, away from the ground.
        const k = amount - 1, gr = CR, gg = CG, gb = CB;
        CR = mr + (mr - gr) * k; CG = mg + (mg - gg) * k; CB = mb + (mb - gb) * k;
      }
    }
  }

  // 3. Region marks.
  const marks = genome.marks | 0;
  if (marks) {
    const light = genome.markRole === 'belly';
    const kr = light ? mix(belly[0], WHITE_R, 0.45) : accent[0], kg = light ? mix(belly[1], WHITE_G, 0.45) : accent[1], kb = light ? mix(belly[2], WHITE_B, 0.45) : accent[2];
    const wr = mix(belly[0], WHITE_R, 0.55), wg = mix(belly[1], WHITE_G, 0.55), wb = mix(belly[2], WHITE_B, 0.55);
    if (marks & COAT_MARK_BITS.socks) {
      if (region === 'limb-lower') {
        const edge = 0.45 + 0.12 * (vnoise(sample.x * 30, sample.y * 30, sample.z * 30, (seed ^ SALT_MARK) | 0) - 0.5);
        mixTo(kr, kg, kb, 0.92 * smooth(edge - 0.18, edge + 0.12, along));
      } else if (region === 'foot') mixTo(kr, kg, kb, 0.92);
    }
    if (marks & COAT_MARK_BITS.mask) {
      if (region === 'muzzle') mixTo(accent[0], accent[1], accent[2], 0.82);
      else if (region === 'head') mixTo(accent[0], accent[1], accent[2], 0.6 * smooth(0.15, 0.65, along) * (1 - 0.6 * smooth(0.45, 0.95, dorsal)));
    }
    if (marks & COAT_MARK_BITS.blaze && (region === 'head' || region === 'muzzle')) {
      const half = region === 'head' ? 0.035 + 0.015 * along : 0.045, e = Math.max(0.012, fp * 0.5);
      const k = (1 - smooth(half - e, half + e, Math.abs(sample.z))) * smooth(-0.35, 0.05, dorsal) * (region === 'head' ? smooth(0.1, 0.4, along) : 1);
      mixTo(wr, wg, wb, 0.92 * k);
    }
    if (marks & COAT_MARK_BITS['tail-tip']) {
      if (region === 'tail-tip') mixTo(kr, kg, kb, 0.95 * smooth(0, 0.25, along));
    }
    if (marks & COAT_MARK_BITS['tail-rings'] && (region === 'tail' || region === 'tail-tip')) {
      const u = (region === 'tail' ? along * 7 : 7 + along * 1.5) + 0.25, f = Math.abs(u - Math.floor(u) - 0.5), e = Math.max(0.04, fp * 25);
      mixTo(kr, kg, kb, 0.88 * (1 - smooth(0.22 - e, 0.22 + e, f)));
    }
    if (marks & COAT_MARK_BITS['ear-tips'] && region === 'ear') mixTo(kr, kg, kb, 0.95 * smooth(0.62, 0.8, along));
    if (marks & COAT_MARK_BITS['rump-patch']) {
      if (region === 'torso') {
        const wob = 0.03 * (vnoise(sample.y * 14, sample.z * 14, 0.5, (seed ^ SALT_MARK) | 0) - 0.5);
        mixTo(wr, wg, wb, 0.9 * smooth(-0.31, -0.4, sample.x + wob) * smooth(-0.3, -0.1, dorsal));
      } else if (region === 'tail') mixTo(wr, wg, wb, 0.9 * (1 - smooth(0.1, 0.35, along)) * smooth(0.2, -0.4, dorsal));
    }
    if (marks & COAT_MARK_BITS['juvenile-spots'] && genome.juvenileSpots > 0 && region === 'torso') {
      const k = juvenileSpotMask(sample, seed, fp);
      if (k > 0) mixTo(wr, wg, wb, 0.85 * genome.juvenileSpots * k);
    }
  }

  // 4. Greying lightens the muzzle (and the face toward it).
  if (genome.greying > 0) {
    const gk = region === 'muzzle' ? 0.85 : region === 'head' ? 0.5 * smooth(0.45, 0.95, along) : 0;
    if (gk > 0) {
      const gr = mix(0.4, belly[0], 0.3), gg = mix(0.39, belly[1], 0.3), gb = mix(0.37, belly[2], 0.3);
      mixTo(gr, gg, gb, genome.greying * gk);
    }
  }

  // 5. Grain (+-4%).
  out[offset] = clamp(CR * grain, 0.002, 1);
  out[offset + 1] = clamp(CG * grain, 0.002, 1);
  out[offset + 2] = clamp(CB * grain, 0.002, 1);
}

/** Fawn-style juvenile spots: two dorsolateral rows per side plus a few
 * scattered lower spots. Returns 0..1. */
function juvenileSpotMask(s: CoatSample, seed: number, fp: number): number {
  const side = s.z >= 0 ? 1 : 2, spacing = 0.048, x = s.x;
  const span = smooth(-0.42, -0.34, x) * (1 - smooth(0.26, 0.34, x));
  if (span <= 0) return 0;
  let best = 0;
  const e = Math.max(0.004, fp * 0.5);
  for (let row = 0; row < 3; row++) {
    const rowD = row === 0 ? 0.74 : row === 1 ? 0.5 : 0.22, offset = row === 1 ? 0.5 : row === 2 ? 0.25 : 0;
    const cx = x / spacing - offset, k = Math.floor(cx);
    for (let j = k - 1; j <= k + 1; j++) {
      pcg3(j, row, side, (seed ^ SALT_MARK) | 0);
      if (row === 2 && H2 * INV32 > 0.55) continue; // the lowest row is sparse and irregular
      if (row < 2 && H2 * INV32 > 0.9) continue;
      const px = (j + offset + 0.5 + (H0 * INV32 - 0.5) * 0.5) * spacing;
      const pd = rowD + (H1 * INV32 - 0.5) * (row === 2 ? 0.2 : 0.09);
      const dx = x - px, dd = (s.dorsal - pd) * 0.2;
      const r = 0.0085 + 0.006 * ((H2 >>> 8) & 255) / 255 - (row === 2 ? 0.002 : 0);
      const v = 1 - smooth(r - e, r + e, Math.sqrt(dx * dx + dd * dd));
      if (v > best) best = v;
    }
  }
  return best * span;
}

/** Debug/test probe of the raw pattern mask. Writes out[0]=m (0..1, before
 * region strength, belly fade and contrast), out[1]=F1, out[2]=F2 (cellular
 * patterns), out[3]=spot radius r0 (spots) or the rosette ring's inner edge as
 * an F1/F2 ratio (rosettes), out[4]=reticulated patch shade or the rosette ring's
 * outer edge as an F1/F2 ratio. Unused slots are 0. */
export function coatPatternProbe(genome: CoatGenome, sample: CoatSample, out: number[] | Float64Array): void {
  const m = genome.pattern === 'plain' ? 0 : patternMask(genome, sample, sample.footprint ?? 0);
  out[0] = m; out[1] = PF1; out[2] = PF2; out[3] = PR; out[4] = PATCH;
}

// ------------------------------------------------------------------ canonical body + mean colour
export interface CoatWeightedSample extends CoatSample { weight: number }
export const COAT_CANONICAL_SAMPLE_COUNT = 512;
let CANONICAL: readonly CoatWeightedSample[] | undefined;

/** Fixed 512-point canonical body (a capsule torso, neck, head, ears, tail and
 * four limbs, in body-length units) with area weights. Built deterministically
 * from a golden-ratio lattice; no hashing involved. */
export function coatCanonicalSamples(): readonly CoatWeightedSample[] {
  if (CANONICAL) return CANONICAL;
  const out: CoatWeightedSample[] = [], PHI = 0.6180339887498949;
  type Tube = { region: CoatRegion; ax: number; ay: number; az: number; bx: number; by: number; bz: number; ry: number; rz: number; count: number; alongFrom?: number; alongTo?: number };
  const tube = (t: Tube) => {
    const dx = t.bx - t.ax, dy = t.by - t.ay, dz = t.bz - t.az, len = Math.hypot(dx, dy, dz);
    // A frame around the axis: n1 'up-ish', n2 sideways.
    const tx = dx / len, ty = dy / len, tz = dz / len;
    let ux = -tx * ty, uy = 1 - ty * ty, uz = -tz * ty; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    if (Math.abs(ty) > 0.95) { ux = 1; uy = 0; uz = 0; }
    const sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
    const perimeter = Math.PI * (3 * (t.ry + t.rz) - Math.sqrt((3 * t.ry + t.rz) * (t.ry + 3 * t.rz)));
    const weight = perimeter * len / t.count;
    for (let i = 0; i < t.count; i++) {
      const f = (i + 0.5) / t.count, phi = 2 * Math.PI * ((i * PHI) % 1);
      const cu = Math.cos(phi), su = Math.sin(phi);
      const x = t.ax + dx * f + (ux * cu * t.ry + sx * su * t.rz), y = t.ay + dy * f + (uy * cu * t.ry + sy * su * t.rz), z = t.az + dz * f + (uz * cu * t.ry + sz * su * t.rz);
      // Surface normal of the elliptic tube; dorsal is its vertical component.
      let nx = ux * cu / t.ry + sx * su / t.rz, ny = uy * cu / t.ry + sy * su / t.rz, nz = uz * cu / t.ry + sz * su / t.rz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl; void nx; void nz;
      const along = (t.alongFrom ?? 0) + ((t.alongTo ?? 1) - (t.alongFrom ?? 0)) * f;
      out.push({ x, y, z, dorsal: clamp(ny, -1, 1), region: t.region, along, weight });
    }
  };
  tube({ region: 'torso', ax: -0.4, ay: 0, az: 0, bx: 0.36, by: 0.02, bz: 0, ry: 0.15, rz: 0.12, count: 260 });
  tube({ region: 'neck', ax: 0.33, ay: 0.06, az: 0, bx: 0.52, by: 0.24, bz: 0, ry: 0.06, rz: 0.06, count: 36 });
  tube({ region: 'head', ax: 0.5, ay: 0.27, az: 0, bx: 0.64, by: 0.26, bz: 0, ry: 0.06, rz: 0.05, count: 32 });
  tube({ region: 'muzzle', ax: 0.64, ay: 0.255, az: 0, bx: 0.73, by: 0.22, bz: 0, ry: 0.035, rz: 0.035, count: 16 });
  for (const side of [1, -1]) tube({ region: 'ear', ax: 0.53, ay: 0.32, az: 0.04 * side, bx: 0.49, by: 0.4, bz: 0.06 * side, ry: 0.015, rz: 0.008, count: 4 });
  tube({ region: 'tail', ax: -0.42, ay: 0.06, az: 0, bx: -0.58, by: -0.12, bz: 0, ry: 0.02, rz: 0.02, count: 16 });
  tube({ region: 'tail-tip', ax: -0.58, ay: -0.12, az: 0, bx: -0.62, by: -0.17, bz: 0, ry: 0.02, rz: 0.02, count: 4 });
  for (const [x, z] of [[0.26, 0.08], [0.26, -0.08], [-0.28, 0.08], [-0.28, -0.08]] as const) {
    tube({ region: 'limb-upper', ax: x, ay: -0.04, az: z, bx: x - 0.01, by: -0.28, bz: z, ry: 0.045, rz: 0.04, count: 18 });
    tube({ region: 'limb-lower', ax: x - 0.01, ay: -0.28, az: z, bx: x, by: -0.52, bz: z, ry: 0.026, rz: 0.024, count: 14 });
    tube({ region: 'foot', ax: x, ay: -0.52, az: z, bx: x + 0.01, by: -0.56, bz: z, ry: 0.03, rz: 0.028, count: 3 });
  }
  if (out.length !== COAT_CANONICAL_SAMPLE_COUNT) throw new Error(`canonical coat sample count ${out.length}`);
  CANONICAL = Object.freeze(out.map(s => Object.freeze(s)));
  return CANONICAL;
}

const MEAN_SCRATCH = new Float64Array(3);
/** Area-weighted mean linear colour over the canonical body (for far LODs). */
export function coatMeanColor(genome: CoatGenome): CoatRGB {
  const samples = coatCanonicalSamples();
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    evaluateCoat(genome, s, MEAN_SCRATCH, 0);
    r += MEAN_SCRATCH[0]! * s.weight; g += MEAN_SCRATCH[1]! * s.weight; b += MEAN_SCRATCH[2]! * s.weight; w += s.weight;
  }
  return [r / w, g / w, b / w];
}

/** Smallest mark feature (body lengths) the genome draws, so consumers can
 * keep it above their vertex spacing (or pass footprint). 1 when nothing. */
export function coatMinFeature(genome: CoatGenome): number {
  const k = COAT_CELLS_PER_BODY[genome.pattern] * genome.scale, t = genome.threshold;
  let feature = 1;
  switch (genome.pattern) {
    case 'spots': feature = 2 * Math.max(0.08, 0.29 + 0.25 * t) / k; break;
    case 'rosettes': feature = 0.08 / k; break; // ring thickness
    case 'reticulated': feature = Math.max(0.03, 0.08 - 0.1 * t) / k; break;
    case 'stripes': feature = (0.43 + 0.3 * t) * 0.6 * 0.42 / k; break; // half-width of the narrowest stripe
    case 'bands': feature = (0.42 + 0.3 * t) * 0.6 / k; break;
    case 'saddle': feature = 0.1; break;
    case 'dorsal-stripe': feature = 0.036; break; // the shoulder cross
    case 'dapple': feature = 0.1 / k; break; // the dark net between dapples
    case 'piebald': feature = 0.35 / k; break;
    case 'roan': feature = 0.3 / k; break;
    case 'brindle': feature = 0.2 * (1 + 1.2 * Math.min(0, t)) / k; break;
    default: break;
  }
  const m = genome.marks | 0;
  if (m & COAT_MARK_BITS['juvenile-spots'] && genome.juvenileSpots > 0) feature = Math.min(feature, 0.013);
  if (m & COAT_MARK_BITS['tail-rings']) feature = Math.min(feature, 0.025);
  if (m & COAT_MARK_BITS['ear-tips']) feature = Math.min(feature, 0.02);
  if (m & COAT_MARK_BITS.blaze) feature = Math.min(feature, 0.07);
  return feature;
}

/** Clamp and validate an untrusted genome-like object (decoded recipes). */
export function normalizeCoatGenome(input: CoatGenome): CoatGenome {
  const R = COAT_GENOME_RANGES, num = (v: number, [lo, hi]: readonly [number, number], fallback: number) => clamp(Number.isFinite(v) ? v : fallback, lo, hi);
  if (!isCoatPattern(input.pattern) || (input.pattern as string) === 'auto') throw new RangeError(`Coat pattern must be resolved, got '${String(input.pattern)}'`);
  const colours = {} as CoatColours;
  for (const role of COAT_ROLES) {
    const c = input.colours?.[role];
    if (!c || c.length !== 3 || !c.every(Number.isFinite)) throw new RangeError(`Coat colour '${role}' is missing or invalid`);
    colours[role] = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
  }
  return {
    version: 'fauna-coat-1',
    pattern: input.pattern,
    marks: clamp(Math.round(Number.isFinite(input.marks) ? input.marks : 0), 0, 255),
    scale: num(input.scale, R.scale, 1),
    contrast: num(input.contrast, R.contrast, 1),
    countershade: num(input.countershade, R.countershade, 0.8),
    bellyLine: num(input.bellyLine, R.bellyLine, -0.45),
    colours,
    markRole: input.markRole === 'belly' ? 'belly' : 'accent',
    seed: (Number.isFinite(input.seed) ? input.seed : 0) >>> 0,
    warp: num(input.warp, R.warp, 0.5),
    threshold: num(input.threshold, R.threshold, 0),
    juvenileSpots: num(input.juvenileSpots, R.juvenileSpots, 0),
    greying: num(input.greying, R.greying, 0),
  };
}

// ------------------------------------------------------------------ crisp coat layers (appended, fauna-coat-crisp-1)
/** evaluateCoat with the raw pattern mask (and the reticulated patch shade) given instead of computed: a copy of
 * evaluateCoat's body in which `patternMask(genome, sample, fp)` is replaced by `mask` and the module's PATCH by
 * `patch`. With mask and patch from coatPatternProbe it returns exactly what evaluateCoat returns
 * (tests/fauna-composer-coat-crisp.test.mjs). The coat colour is affine in the mask amount (both branches of the
 * pattern mix; the marks, greying and grain that follow are affine too), so the colours at mask 0 and at mask 1 (patch 0
 * and 1) are exact layers between which a fragment shader can mix with its own per-fragment mask (the crisp coat of
 * the composer skin, docs/fauna-coat-crisp-v1.md). evaluateCoat itself is unchanged (fauna-coat-1 is frozen). */
export function evaluateCoatWithMask(genome: CoatGenome, sample: CoatSample, out: number[] | Float32Array | Float64Array, offset: number, mask: number, patch: number): void {
  const C = genome.colours, region = sample.region;
  if (region === 'eye') { const e = C.eye; out[offset] = e[0]; out[offset + 1] = e[1]; out[offset + 2] = e[2]; return; }
  const seed = seedMix(genome.seed);
  const grain = 1 + 0.08 * (vnoise(sample.x * 40, sample.y * 40, sample.z * 40, (seed ^ SALT_GRAIN) | 0) - 0.5);
  if (region === 'horn' || region === 'armor') {
    const c = region === 'horn' ? C.horn : C.plate;
    out[offset] = c[0] * grain; out[offset + 1] = c[1] * grain; out[offset + 2] = c[2] * grain; return;
  }
  const base = C.base, belly = C.belly, accent = C.accent, P = genome.pattern;
  const fp = sample.footprint !== undefined && sample.footprint > 0 ? sample.footprint : 0;
  const along = sample.along, dorsal = sample.dorsal;

  // 1. Ground colour with countershading (limbs at half strength away from the root).
  let cs = genome.countershade * smooth(genome.bellyLine + 0.3, genome.bellyLine - 0.3, dorsal);
  if (region === 'limb-upper') cs *= mix(1, 0.5, smooth(0, 0.35, along));
  else if (region === 'limb-lower' || region === 'foot') cs *= 0.5;
  if (P === 'reticulated') { CR = belly[0]; CG = belly[1]; CB = belly[2]; }
  else { CR = mix(base[0], belly[0], cs); CG = mix(base[1], belly[1], cs); CB = mix(base[2], belly[2], cs); }
  // Low-frequency tonal variation (+-3%) so a plain coat is not a flat fill.
  const tone = 1 + 0.06 * (vnoise(sample.x * 3.2, sample.y * 3.2, sample.z * 3.2, (seed ^ SALT_TONE) | 0) - 0.5);
  CR *= tone; CG *= tone; CB *= tone;

  // 2. Pattern.
  if (P !== 'plain') {
    const m = mask;
    if (m > 0) {
      const fadeBelly = 1 - BELLY_FADE[P] * smooth(genome.bellyLine + 0.35, genome.bellyLine - 0.2, dorsal);
      const amount = m * regionStrength(P, sample) * fadeBelly * genome.contrast;
      let mr: number, mg: number, mb: number;
      if (P === 'reticulated') { mr = mix(base[0], accent[0], patch); mg = mix(base[1], accent[1], patch); mb = mix(base[2], accent[2], patch); }
      else if (P === 'piebald') { mr = mix(belly[0], WHITE_R, 0.6); mg = mix(belly[1], WHITE_G, 0.6); mb = mix(belly[2], WHITE_B, 0.6); }
      else if (P === 'roan') { mr = mix(belly[0], WHITE_R, 0.5); mg = mix(belly[1], WHITE_G, 0.5); mb = mix(belly[2], WHITE_B, 0.5); }
      else if (P === 'dapple') { mr = mix(base[0], belly[0], 0.85) * 1.08; mg = mix(base[1], belly[1], 0.85) * 1.08; mb = mix(base[2], belly[2], 0.85) * 1.08; }
      else if (genome.markRole === 'belly') { mr = mix(belly[0], WHITE_R, 0.3); mg = mix(belly[1], WHITE_G, 0.3); mb = mix(belly[2], WHITE_B, 0.3); }
      else { mr = accent[0]; mg = accent[1]; mb = accent[2]; }
      if (amount <= 1) mixTo(mr, mg, mb, amount);
      else { // contrast > 1 pushes past the mark colour, away from the ground.
        const k = amount - 1, gr = CR, gg = CG, gb = CB;
        CR = mr + (mr - gr) * k; CG = mg + (mg - gg) * k; CB = mb + (mb - gb) * k;
      }
    }
  }

  // 3. Region marks.
  const marks = genome.marks | 0;
  if (marks) {
    const light = genome.markRole === 'belly';
    const kr = light ? mix(belly[0], WHITE_R, 0.45) : accent[0], kg = light ? mix(belly[1], WHITE_G, 0.45) : accent[1], kb = light ? mix(belly[2], WHITE_B, 0.45) : accent[2];
    const wr = mix(belly[0], WHITE_R, 0.55), wg = mix(belly[1], WHITE_G, 0.55), wb = mix(belly[2], WHITE_B, 0.55);
    if (marks & COAT_MARK_BITS.socks) {
      if (region === 'limb-lower') {
        const edge = 0.45 + 0.12 * (vnoise(sample.x * 30, sample.y * 30, sample.z * 30, (seed ^ SALT_MARK) | 0) - 0.5);
        mixTo(kr, kg, kb, 0.92 * smooth(edge - 0.18, edge + 0.12, along));
      } else if (region === 'foot') mixTo(kr, kg, kb, 0.92);
    }
    if (marks & COAT_MARK_BITS.mask) {
      if (region === 'muzzle') mixTo(accent[0], accent[1], accent[2], 0.82);
      else if (region === 'head') mixTo(accent[0], accent[1], accent[2], 0.6 * smooth(0.15, 0.65, along) * (1 - 0.6 * smooth(0.45, 0.95, dorsal)));
    }
    if (marks & COAT_MARK_BITS.blaze && (region === 'head' || region === 'muzzle')) {
      const half = region === 'head' ? 0.035 + 0.015 * along : 0.045, e = Math.max(0.012, fp * 0.5);
      const k = (1 - smooth(half - e, half + e, Math.abs(sample.z))) * smooth(-0.35, 0.05, dorsal) * (region === 'head' ? smooth(0.1, 0.4, along) : 1);
      mixTo(wr, wg, wb, 0.92 * k);
    }
    if (marks & COAT_MARK_BITS['tail-tip']) {
      if (region === 'tail-tip') mixTo(kr, kg, kb, 0.95 * smooth(0, 0.25, along));
    }
    if (marks & COAT_MARK_BITS['tail-rings'] && (region === 'tail' || region === 'tail-tip')) {
      const u = (region === 'tail' ? along * 7 : 7 + along * 1.5) + 0.25, f = Math.abs(u - Math.floor(u) - 0.5), e = Math.max(0.04, fp * 25);
      mixTo(kr, kg, kb, 0.88 * (1 - smooth(0.22 - e, 0.22 + e, f)));
    }
    if (marks & COAT_MARK_BITS['ear-tips'] && region === 'ear') mixTo(kr, kg, kb, 0.95 * smooth(0.62, 0.8, along));
    if (marks & COAT_MARK_BITS['rump-patch']) {
      if (region === 'torso') {
        const wob = 0.03 * (vnoise(sample.y * 14, sample.z * 14, 0.5, (seed ^ SALT_MARK) | 0) - 0.5);
        mixTo(wr, wg, wb, 0.9 * smooth(-0.31, -0.4, sample.x + wob) * smooth(-0.3, -0.1, dorsal));
      } else if (region === 'tail') mixTo(wr, wg, wb, 0.9 * (1 - smooth(0.1, 0.35, along)) * smooth(0.2, -0.4, dorsal));
    }
    if (marks & COAT_MARK_BITS['juvenile-spots'] && genome.juvenileSpots > 0 && region === 'torso') {
      const k = juvenileSpotMask(sample, seed, fp);
      if (k > 0) mixTo(wr, wg, wb, 0.85 * genome.juvenileSpots * k);
    }
  }

  // 4. Greying lightens the muzzle (and the face toward it).
  if (genome.greying > 0) {
    const gk = region === 'muzzle' ? 0.85 : region === 'head' ? 0.5 * smooth(0.45, 0.95, along) : 0;
    if (gk > 0) {
      const gr = mix(0.4, belly[0], 0.3), gg = mix(0.39, belly[1], 0.3), gb = mix(0.37, belly[2], 0.3);
      mixTo(gr, gg, gb, genome.greying * gk);
    }
  }

  // 5. Grain (+-4%).
  out[offset] = clamp(CR * grain, 0.002, 1);
  out[offset + 1] = clamp(CG * grain, 0.002, 1);
  out[offset + 2] = clamp(CB * grain, 0.002, 1);
}

/** The coat library's seed pre-mix (seedMix, unchanged) as an export, for the crisp-coat shader, which hashes with the
 * pre-mixed seed exactly as patternMask does. Returns a signed 32-bit integer (>>> 0 for the unsigned bits). */
export function coatSeedMix(seed: number): number { return seedMix(seed); }

/** The pattern salts and the Worley jitter patternMask uses (the module's own constants, unchanged), as exports for the
 * crisp-coat shader, which re-implements the crisp patterns' masks in GLSL with exactly these values. */
export const COAT_PATTERN_SALTS = Object.freeze({warp: SALT_WARP, detail: SALT_DETAIL, mark: SALT_MARK, band: SALT_BAND});
export const COAT_WORLEY_JITTER = WORLEY_JITTER;
