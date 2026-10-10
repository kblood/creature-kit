import {COMPOSER_RECIPE_MAX_TEXT} from '../../../src/fauna-composer-recipe.ts';
import {FAUNA_REVIEW_PRESET_IDS, type FaunaReviewPresetId} from './fauna-review-environment.ts';
import type {ComposerSkinPresentation} from '../../../src/fauna-composer-mesh.ts';
/** Composer slice of universe-atlas src/creature-lab-state.ts (universe-atlas 7419733; see apps/creature-lab/PROVENANCE.md).
 * The kit's Creature Lab app is the composer mode only, so this keeps exactly the keys a composer link writes and parses
 * them exactly as Atlas does (tests/lab/creature-lab-atlas-parity.test.mjs compares both parsers on a link corpus).
 * Differences from Atlas, all for the one-mode app:
 * - `mode` is always 'composer'. A link without `mode` opens composer mode (Atlas opens its gallery), so the composer
 *   checks (repeated keys, unknown motion, herd and light notices) also apply when `mode` is absent. A link naming any
 *   other mode (an Atlas planetary mode, or junk) is rejected visibly by creatureLabComposerInputError instead of being
 *   shown as something else.
 * - `presentation` is an app-only surface selection (modern by default), separately validated and shared; it never
 *   changes either recipe. The legacy portion of parser/URL behavior remains covered by Atlas parity tests.
 * - The planetary-mode keys (seed, profile, species, variant, growth, frame, family, pose, date, compareVariant,
 *   compareGrowth, source, assetHash, sidecarHash, replayVersion, templateRecipe, morphLocks and the six morph values)
 *   are neither parsed nor written: Atlas never writes them into a composer link either.
 * Camera gestures are deliberately excluded: shared links open the same named frame, measured in metres. */
export type LabMode = 'composer';
export const COMPOSER_LAB_MOTIONS = ['neutral', 'idle', 'walk', 'display'] as const;
export type ComposerLabMotion = typeof COMPOSER_LAB_MOTIONS[number];
/** Composer herd sizes: one animal, or a herd of individuals of the same species. */
export const COMPOSER_HERD_SIZES = [1, 6, 9, 12] as const;
export type ComposerHerdSize = typeof COMPOSER_HERD_SIZES[number];
/** App presentation is independent of the encoded species/individual recipe. */
export const COMPOSER_LAB_PRESENTATIONS = ['realism-1', 'skin-5'] as const satisfies readonly ComposerSkinPresentation[];
export const isComposerLabPresentation = (value:unknown):value is ComposerSkinPresentation => (COMPOSER_LAB_PRESENTATIONS as readonly unknown[]).includes(value);
/** Key order is Atlas's (creature-lab.ts specimenState), so a re-shared link lists its parameters in the same order. */
export interface CreatureLabState {
  mode: LabMode;
  view: 'three-quarter' | 'side' | 'front'; time: number;
  compare: boolean; neutral: boolean; skeleton: boolean;
  /** Encoded recipes are decoded and validated by the Lab. */
  recipe: string; compareRecipe: string; composerSeed: string; motion: ComposerLabMotion;
  /** Composer herd size (comparison always shows one animal per recipe). */
  herd: ComposerHerdSize;
  /** Review lighting preset. */
  light: FaunaReviewPresetId;
  presentation: ComposerSkinPresentation;
}
export const DEFAULT_LAB_STATE: Readonly<CreatureLabState> = Object.freeze({
  mode: 'composer', view: 'three-quarter', time: 0, compare: false, neutral: false, skeleton: false,
  recipe: '', compareRecipe: '', composerSeed: 'composer-1', motion: 'walk', herd: 1, light: 'studio', presentation: 'realism-1',
});
/** Composer-only keys: repeated values reject a composer link. */
const COMPOSER_KEYS = ['recipe', 'compareRecipe', 'composerSeed', 'motion', 'herd', 'presentation'] as const;
/** Keys a composer link writes. */
const COMPOSER_URL_KEYS = ['mode', ...COMPOSER_KEYS, 'compare', 'time', 'view', 'neutral', 'skeleton', 'light'] as const;
const isHerdSize = (value: string | null) => (COMPOSER_HERD_SIZES as readonly number[]).some(n => String(n) === value);
const query = (search: string | URLSearchParams) => typeof search === 'string' ? new URLSearchParams(search) : search;
/** A link opens composer mode when it names composer mode or no mode at all. */
const isComposerLink = (q: URLSearchParams) => !q.has('mode') || q.get('mode') === 'composer';
export function parseCreatureLabState(search: string | URLSearchParams): CreatureLabState {
  const q = query(search);
  const choice = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = q.get(key); return values.includes(value as T) ? value as T : fallback;
  };
  const number = (key: string, fallback: number, min: number, max: number, integer = false) => {
    const raw = q.get(key); if (!raw?.trim()) return fallback;
    const value = Number(raw); if (!Number.isFinite(value)) return fallback;
    const bounded = Math.max(min, Math.min(max, value)); return integer ? Math.floor(bounded) : bounded;
  };
  const clean = (key: string, fallback: string, length: number) =>
    q.get(key)?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, length) || fallback;
  return {
    mode: 'composer',
    view: choice('view', ['three-quarter', 'side', 'front'], 'three-quarter'),
    time: number('time', 0, 0, 120),
    compare: q.get('compare') === '1', neutral: q.get('neutral') === '1', skeleton: q.get('skeleton') === '1',
    // One character over the limit is kept so the decoder can reject oversize text visibly instead of truncating it into another animal.
    recipe: (q.get('recipe') || '').slice(0, COMPOSER_RECIPE_MAX_TEXT + 1), compareRecipe: (q.get('compareRecipe') || '').slice(0, COMPOSER_RECIPE_MAX_TEXT + 1),
    composerSeed: clean('composerSeed', DEFAULT_LAB_STATE.composerSeed, 160),
    motion: choice('motion', COMPOSER_LAB_MOTIONS, 'walk'),
    herd: isHerdSize(q.get('herd')) ? Number(q.get('herd')) as ComposerHerdSize : 1,
    light: choice('light', FAUNA_REVIEW_PRESET_IDS, 'studio'),
    presentation: choice('presentation', COMPOSER_LAB_PRESENTATIONS, 'realism-1'),
  };
}
/** Visible notices for link values that were replaced by a default rather than rejected
 * (an unsupported herd size or lighting preset). Empty when the link is used as written. */
export function creatureLabInputNotices(search: string | URLSearchParams): string[] {
  const q = query(search), out: string[] = [];
  if (!isComposerLink(q)) return out;
  if (q.has('herd') && !isHerdSize(q.get('herd')))
    out.push(`Herd size "${q.get('herd')!.slice(0, 12)}" is not available (choose 1, 6, 9 or 12); showing 1 animal.`);
  if (q.has('light') && !(FAUNA_REVIEW_PRESET_IDS as readonly string[]).includes(q.get('light')!))
    out.push(`Lighting "${q.get('light')!.slice(0, 24)}" is not available; using Studio.`);
  return out;
}
/** A repeated lighting parameter is ambiguous and rejects the link. */
export function creatureLabLightInputError(search: string | URLSearchParams): string | null {
  const q = query(search);
  return isComposerLink(q) && q.getAll('light').length > 1 ? 'Invalid link: repeated light' : null;
}
/** Composer links are rejected, not reinterpreted, when identity parameters repeat or the motion is unknown, and (app
 * only) when they name a mode this app does not have. Recipe text errors (version, size) are reported by decodeComposerRecipe. */
export function creatureLabComposerInputError(search: string | URLSearchParams): string | null {
  const q = query(search);
  if (!isComposerLink(q)) return `Unsupported link: mode "${q.get('mode')!.slice(0, 24)}" is not part of the Creature Lab app (composer mode only); the planetary modes are in Universe Atlas's Creature Lab`;
  for (const key of [...COMPOSER_KEYS, 'light']) if (q.getAll(key).length > 1) return `Invalid composer link: repeated ${key}`;
  if (q.has('motion') && !(COMPOSER_LAB_MOTIONS as readonly string[]).includes(q.get('motion')!)) return `Invalid composer link: unknown motion "${q.get('motion')!.slice(0, 24)}"`;
  if (q.has('presentation') && !isComposerLabPresentation(q.get('presentation'))) return `Invalid composer link: unknown presentation "${q.get('presentation')!.slice(0, 32)}"`;
  return null;
}
export function creatureLabUrl(base: string, state: CreatureLabState): string {
  const url = new URL(base); url.search = ''; url.hash = '';
  for (const [key, value] of Object.entries(state)) {
    if (!(COMPOSER_URL_KEYS as readonly string[]).includes(key)) continue;
    if (key === 'compareRecipe' && !state.compare) continue;
    url.searchParams.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return url.href;
}
