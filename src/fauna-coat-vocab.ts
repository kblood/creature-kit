/**
 * Shared fauna coat vocabulary (fauna-coat-1 contract).
 *
 * Pure data: no `three` import, no randomness, no clock. Erasable TypeScript only
 * (Node type-strips src/*.ts), so no enums, namespaces or parameter properties.
 *
 * These strings are a cross-package contract (composer recipe, composer coat,
 * Creature Lab UI, planet appearance). Renaming or reordering an entry breaks
 * encoded recipes and determinism; append-only, and version any change.
 */

/** Coat pattern ids. 'auto' resolves per palette through AUTO_PATTERN. */
export const COAT_PATTERNS = [
  'auto', 'plain', 'spots', 'rosettes', 'reticulated', 'stripes', 'bands', 'saddle',
  'dorsal-stripe', 'dapple', 'piebald', 'roan', 'brindle',
] as const;
export type CoatPattern = typeof COAT_PATTERNS[number];
/** A pattern after 'auto' has been resolved. */
export type ResolvedCoatPattern = Exclude<CoatPattern, 'auto'>;

/** Region-mark bit flags; a genome's `marks` is an OR of these (0..255). */
export const COAT_MARK_BITS = {
  socks: 1,
  mask: 2,
  blaze: 4,
  'tail-tip': 8,
  'tail-rings': 16,
  'ear-tips': 32,
  'rump-patch': 64,
  'juvenile-spots': 128,
} as const;
export type CoatMarkName = keyof typeof COAT_MARK_BITS;
/** All mark names in bit order (1, 2, 4, ... 128). */
export const COAT_MARK_NAMES = Object.keys(COAT_MARK_BITS) as readonly CoatMarkName[];
/** Mask of every defined mark bit. */
export const COAT_MARKS_ALL = 255;

/** The six palettes of the v1 composer recipe, in their original order. */
export const LEGACY_PALETTE_IDS = ['earth', 'savanna', 'reptile', 'plumage', 'slate', 'ink'] as const;
export type LegacyPaletteId = typeof LEGACY_PALETTE_IDS[number];

/** Natural pigment families added by fauna-coat-1. */
export const PIGMENT_FAMILIES = ['tawny', 'rufous', 'dun', 'fawn', 'grey', 'sable', 'olive', 'ochre'] as const;
export type PigmentFamily = typeof PIGMENT_FAMILIES[number];

/** Every palette id: legacy first (stable indices), then pigment families. */
export const COAT_PALETTE_IDS = [...LEGACY_PALETTE_IDS, ...PIGMENT_FAMILIES] as const;
export type CoatPaletteId = typeof COAT_PALETTE_IDS[number];

/** Colour roles carried by every palette row. */
export const COAT_ROLES = ['base', 'accent', 'belly', 'keratin', 'skin', 'eye', 'horn', 'plate'] as const;
export type CoatRole = typeof COAT_ROLES[number];

/**
 * sRGB hex per palette and role. The six legacy rows are copied verbatim from
 * fauna-composer-mesh.ts PALETTES (composer v1) and must never change.
 */
export const COAT_PALETTE_HEX: Readonly<Record<CoatPaletteId, Readonly<Record<CoatRole, string>>>> = {
  earth: {base: '#7a5a3c', accent: '#4a3322', belly: '#b89c78', keratin: '#2e2620', skin: '#8d6e5a', eye: '#120d0a', horn: '#6b6156', plate: '#5e4a36'},
  savanna: {base: '#c99a52', accent: '#6b3f1d', belly: '#ead8b0', keratin: '#2b241d', skin: '#8a6a4a', eye: '#100c08', horn: '#4a3a2a', plate: '#9a6a3a'},
  reptile: {base: '#5e7a3a', accent: '#37502a', belly: '#cfc890', keratin: '#3b3a2a', skin: '#6e7a4a', eye: '#2a2008', horn: '#8a8060', plate: '#7a6a3a'},
  plumage: {base: '#2f6fa8', accent: '#e0a020', belly: '#e8e2d0', keratin: '#e09a30', skin: '#c06040', eye: '#0a0a0a', horn: '#333038', plate: '#a03a2a'},
  slate: {base: '#6d6f70', accent: '#4c4e50', belly: '#8e8c88', keratin: '#3a3836', skin: '#7a7470', eye: '#0d0d0d', horn: '#9a948a', plate: '#585a5a'},
  ink: {base: '#2c2b31', accent: '#c84a2a', belly: '#5e5249', keratin: '#18161a', skin: '#6a5a50', eye: '#070707', horn: '#3a3030', plate: '#3a2c2c'},
  tawny: {base: '#a87c4f', accent: '#5a3a20', belly: '#d9c09a', keratin: '#2a2420', skin: '#8a6a52', eye: '#1a120a', horn: '#5a5048', plate: '#7a5a3a'},
  rufous: {base: '#8e4a2a', accent: '#3e2414', belly: '#e0cdb0', keratin: '#2a201a', skin: '#7a5040', eye: '#140c08', horn: '#4a4038', plate: '#6a3a22'},
  dun: {base: '#a8926a', accent: '#4a3a28', belly: '#d2c4a4', keratin: '#2e2822', skin: '#8a7660', eye: '#120e0a', horn: '#5a5048', plate: '#7a6a4e'},
  fawn: {base: '#b89a72', accent: '#6a4c32', belly: '#e6d8c0', keratin: '#2c2622', skin: '#9a7a64', eye: '#140e0a', horn: '#5c524a', plate: '#8a7256'},
  grey: {base: '#7b7872', accent: '#55524e', belly: '#96928a', keratin: '#3a3734', skin: '#827c76', eye: '#0e0d0c', horn: '#a09a90', plate: '#66625e'},
  sable: {base: '#4a3828', accent: '#241a12', belly: '#7a6450', keratin: '#1a1614', skin: '#5a4436', eye: '#0a0806', horn: '#3a3028', plate: '#3a2c20'},
  olive: {base: '#5f6a3a', accent: '#343c20', belly: '#c4be8c', keratin: '#34321f', skin: '#6a7048', eye: '#241c08', horn: '#807656', plate: '#6a6034'},
  ochre: {base: '#a8682f', accent: '#4a2a14', belly: '#e8dcc0', keratin: '#2a2018', skin: '#8a5c3c', eye: '#120c08', horn: '#3e3024', plate: '#8a5a30'},
};

/** What pattern 'auto' resolves to for each palette. */
export const AUTO_PATTERN: Readonly<Record<CoatPaletteId, ResolvedCoatPattern>> = {
  earth: 'saddle',
  savanna: 'reticulated',
  reptile: 'bands',
  plumage: 'plain',
  slate: 'plain',
  ink: 'plain',
  tawny: 'plain',
  rufous: 'plain',
  dun: 'dorsal-stripe',
  fawn: 'spots',
  grey: 'plain',
  sable: 'plain',
  olive: 'bands',
  ochre: 'reticulated',
};

/** Anatomical region a coat sample belongs to. */
export type CoatRegion =
  | 'torso' | 'neck' | 'head' | 'muzzle' | 'ear' | 'limb-upper' | 'limb-lower'
  | 'foot' | 'tail' | 'tail-tip' | 'horn' | 'armor' | 'wing' | 'eye';

/** Runtime list of every CoatRegion (same members as the type). */
export const COAT_REGIONS = [
  'torso', 'neck', 'head', 'muzzle', 'ear', 'limb-upper', 'limb-lower',
  'foot', 'tail', 'tail-tip', 'horn', 'armor', 'wing', 'eye',
] as const satisfies readonly CoatRegion[];

/** Type guards for untrusted strings (decoded recipes, URLs). */
export function isCoatPattern(value: unknown): value is CoatPattern {
  return typeof value === 'string' && (COAT_PATTERNS as readonly string[]).includes(value);
}
export function isCoatPaletteId(value: unknown): value is CoatPaletteId {
  return typeof value === 'string' && (COAT_PALETTE_IDS as readonly string[]).includes(value);
}
export function isCoatRegion(value: unknown): value is CoatRegion {
  return typeof value === 'string' && (COAT_REGIONS as readonly string[]).includes(value);
}

/** Resolve 'auto' against a palette; any other pattern passes through. */
export function resolveCoatPattern(pattern: CoatPattern, paletteId: CoatPaletteId): ResolvedCoatPattern {
  return pattern === 'auto' ? AUTO_PATTERN[paletteId] : pattern;
}
