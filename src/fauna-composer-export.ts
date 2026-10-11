/**
 * Headless GLB export for the modular creature composer (fauna-composer-export-3; v1: backlog task 10, creature-kit
 * phase 3; v2: LOD chain, quest-3 budget, seamless loops; v3: creature-kit strings, bone-reducing skeleton,
 * docs/creature-export-v3.md).
 *
 * exportCreatureGlb(recipe) builds the creature exactly as the runtime does (createComposerCreature: normalise, derive
 * the individual, graph, skin, three's vertex normals) and writes a binary glTF 2.0 file directly. three's GLTFExporter
 * is not used: it needs FileReader in Node, and a hand-written writer keeps the bytes fixed (a second export of the same
 * recipe is byte-identical in the same engine).
 *
 * Contents:
 * - one skinned mesh, one primitive, one material (vertex colour, roughness 0.82, metalness 0, as the runtime);
 *   POSITION, NORMAL, COLOR_0 (linear), JOINTS_0, WEIGHTS_0, optionally the application attribute _COMPOSER_GLOSS;
 * - one joint node per graph bone, in graph order, named as the graph names them, all children of the skeleton root
 *   (the composer's flat bone list: every bone carries its creature-space pose);
 * - inverse bind matrices of the rest skeleton;
 * - one animation per motion, sampled from poseComposer(graph, motion, t) at the requested rate. Walk is a treadmill
 *   (the animal stays centred); the clip's travel speed is in its extras and in the report.
 *
 * Axes: metres, +Y up, right-handed. By default the skeleton root turns the composer's +X heading onto +Z, glTF's
 * asset front; forward '+X' keeps the composer frame. The skinned mesh node is a scene root with no transform.
 *
 * Export v2 options (opt-in; with none of them the BIN chunk is exactly v1's):
 * - `lods` / `target`: an LOD chain from fauna-composer-lod.ts. Level 0 is the scene's skinned mesh; lower levels are
 *   extra skinned meshes on nodes outside the scene, linked by MSFT_lod on the level-0 node (with MSFT_screencoverage
 *   hints). Every level shares the one skin, material and clip set. A loader without MSFT_lod shows level 0 only.
 * - `target: 'quest-3'`: default chain 8000/3000/1000 triangles and a HARD budget (COMPOSER_EXPORT_TARGETS); an
 *   export over budget throws ComposerExportBudgetError, whose `reasons` are machine readable.
 * - `seamless: true`: idle and display are baked as crossfaded loops (source window starts at t = b, the last b
 *   seconds blend back into the pre-roll 0..b), so the last key is the first key bit for bit.
 *
 * Export v3 (docs/creature-export-v3.md): every export is fauna-composer-export-3 with the creature-kit generator string.
 * A profile whose bone budget is below the graph's joint count (quest-3: 80) gets a reduced skeleton by the
 * pre-registered rule fauna-composer-skeleton-1 (planComposerSkeleton: feet, metapodials, then odd tail, torso and neck
 * joints collapse into their nearest surviving ancestor); the skin error against the full skeleton must stay within
 * COMPOSER_SKELETON_SKIN_ERROR_BOUND or the export fails with a `skin-error` reason. Every other export keeps every joint.
 *
 * This module imports only the composer core, the LOD reducer and three (no Atlas module, no Node API), so it runs in
 * a browser too.
 */
import * as THREE from 'three';
import type {ComposerBuildPhenotype} from './fauna-composer-phenotype.ts';
import {createComposerCreature} from './fauna-composer.ts';
import {COMPOSER_RECIPE_VERSION, decodeComposerRecipe, encodeComposerRecipe, normalizeComposerRecipe, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {COMPOSER_BUDGET, COMPOSER_GRAPH_VERSION, COMPOSER_MOTIONS, COMPOSER_TRUNK_MOTION_VERSION, poseComposer, type ComposerGraph, type ComposerMotion, type ComposerPose, type ComposerPoseOptions} from './fauna-composer-rig.ts';
import {COMPOSER_SKIN_VERSION, COMPOSER_REALISM_SKIN_VERSION, type ComposerSkinPresentation} from './fauna-composer-mesh.ts';
import {COMPOSER_INDIVIDUAL_VERSION, composerSpeciesKey} from './fauna-composer-individual.ts';
import {COMPOSER_FACE_VERSION} from './fauna-composer-face.ts';
import {COMPOSER_FACE_GEOMETRY_VERSION} from './fauna-composer-face-geometry.ts';
import {COMPOSER_EYE_VERSION} from './fauna-composer-eye.ts';
import {COMPOSER_EYE_CATALOGUE_VERSION} from './fauna-composer-eye-catalogue.ts';
import {COMPOSER_SPECIES_GENERATOR_VERSION} from './fauna-composer-species.ts';
import {FAUNA_COAT_FIELD_VERSION} from './fauna-coat-fields.ts';
import {COMPOSER_LOD_VERSION, COMPOSER_FOOT_LOD_VERSION, COMPOSER_ANATOMY_LOD_VERSION, buildComposerLodChain, composerAnatomyLodConstraints, type ComposerLodLevel} from './fauna-composer-lod.ts';

/** Historical: written by plain exports up to export v2 (kept exported for compatibility; no longer written). */
export const COMPOSER_EXPORT_VERSION = 'fauna-composer-export-1';
/** Historical: written by profiled exports (an LOD chain or a crossfaded loop) in export v2 (kept for compatibility). */
export const COMPOSER_EXPORT_V2_VERSION = 'fauna-composer-export-2';
/** Written by every export since v3 (docs/creature-export-v3.md): creature-kit generator string, plain or profiled.
 * A plain export's BIN chunk is byte-identical to export-1's, a profiled in-budget export's to export-2's. */
export const COMPOSER_EXPORT_V3_VERSION = 'fauna-composer-export-3';
/** The generator named in asset.generator (`<generator> <export version>`). */
export const COMPOSER_EXPORT_GENERATOR = 'creature-kit';
export type ComposerExportTarget = 'desktop-web' | 'quest-3';
/** A hard export budget. Triangles apply to level 0 (what the scene draws up close); every level must also meet its
 * own target. Textures: the composer creature has none (vertex colour), so its texture bytes are 0. */
export interface ComposerExportBudget {maxTriangles: number; maxBones: number; maxMaterials: number; maxTextureBytes: number; maxDrawCallsPerLevel: number}
/** Target profiles. desktop-web: no LOD by default and no hard gate beyond the composer's own budget.
 * quest-3: the Quest 3 standalone tier (docs/creature-export-v2.md, "Budget"): <= 150k triangles and <= 150 draw calls
 * per frame for a whole scene, so one creature gets 8000 / 3000 / 1000 triangles at its three levels, one draw call
 * per level and at most one 1024x1024 RGBA8 texture's worth of texture memory.
 * Bones: 80 is a CPU budget we set (D4, 2026-10-07), not a Quest 3 hardware limit. three r181 skins through a float
 * bone texture (no uniform-array path, so MAX_VERTEX_UNIFORM_VECTORS does not apply) and JOINTS_0 is unsigned 16-bit.
 * The cost is CPU: mixer (2 tracks per bone) + world matrices + skeleton update measured 0.17 us per bone per frame on
 * the desktop, flat over 40/80/160 bones; ~1 us on Quest 3 is an ESTIMATE (assumed ~5x slower CPU, not measured).
 * The 8000-triangle level 0 implies ~18 creatures per 150k-triangle scene; at 80 bones they cost ~1.4 ms of an 11.1 ms
 * frame (160 bones: ~2.9 ms). Raise it only after a headset measurement of <= 0.5 us per bone, or answer a sweep that
 * often fails with a bone-reducing LOD skeleton, not a higher cap. */
export const COMPOSER_EXPORT_TARGETS: Readonly<Record<ComposerExportTarget, {lods: readonly number[] | null; budget: Readonly<ComposerExportBudget> | null}>> = Object.freeze({
  'desktop-web': Object.freeze({lods: null, budget: null}),
  'quest-3': Object.freeze({lods: Object.freeze([8000, 3000, 1000]), budget: Object.freeze({maxTriangles: 8000, maxBones: 80, maxMaterials: 1, maxTextureBytes: 1024 * 1024 * 4, maxDrawCallsPerLevel: 1})}),
});
/** Default crossfade length (s) of a seamless idle/display loop; capped at half the clip window. */
export const COMPOSER_EXPORT_SEAMLESS_BLEND = 1;
/** One machine-readable reason an export broke its budget. */
/** `skin-error` (export v3): a reduced skeleton moved a level-0 vertex by more than COMPOSER_SKELETON_SKIN_ERROR_BOUND of the
 * body diagonal (limit and actual are fractions of the diagonal). */
export interface ComposerBudgetReason {code: 'triangles' | 'bones' | 'materials' | 'texture-bytes' | 'draw-calls' | 'lod-target' | 'skin-error'; level?: number; limit: number; actual: number}
/** Thrown when an export breaks its target's budget; nothing is written. */
export class ComposerExportBudgetError extends Error {
  readonly code = 'composer-export-budget';
  readonly target: ComposerExportTarget;
  readonly budget: Readonly<ComposerExportBudget>;
  readonly reasons: readonly ComposerBudgetReason[];
  constructor(target: ComposerExportTarget, budget: Readonly<ComposerExportBudget>, reasons: readonly ComposerBudgetReason[]) {
    super(`composer export: ${target} budget exceeded: ${reasons.map(r => `${r.code}${r.level === undefined ? '' : ` (level ${r.level})`} ${r.actual} > ${r.limit}`).join('; ')}`);
    this.name = 'ComposerExportBudgetError';
    this.target = target; this.budget = budget; this.reasons = reasons;
  }
  toJSON() { return {error: this.code, target: this.target, budget: this.budget, reasons: this.reasons}; }
}
/** Checks measured export numbers against a budget; `levels[i].target` is that level's requested triangle target. */
export function checkComposerExportBudget(budget: Readonly<ComposerExportBudget>, actual: {bones: number; materials: number; textureBytes: number; drawCallsPerLevel: number; levels: readonly {triangles: number; target: number | null}[]}): {pass: boolean; reasons: ComposerBudgetReason[]} {
  const reasons: ComposerBudgetReason[] = [];
  const level0 = actual.levels[0]?.triangles ?? 0;
  if (level0 > budget.maxTriangles) reasons.push({code: 'triangles', level: 0, limit: budget.maxTriangles, actual: level0});
  actual.levels.forEach((l, i) => { if (l.target !== null && l.triangles > l.target) reasons.push({code: 'lod-target', level: i, limit: l.target, actual: l.triangles}); });
  if (actual.bones > budget.maxBones) reasons.push({code: 'bones', limit: budget.maxBones, actual: actual.bones});
  if (actual.materials > budget.maxMaterials) reasons.push({code: 'materials', limit: budget.maxMaterials, actual: actual.materials});
  if (actual.textureBytes > budget.maxTextureBytes) reasons.push({code: 'texture-bytes', limit: budget.maxTextureBytes, actual: actual.textureBytes});
  if (actual.drawCallsPerLevel > budget.maxDrawCallsPerLevel) reasons.push({code: 'draw-calls', limit: budget.maxDrawCallsPerLevel, actual: actual.drawCallsPerLevel});
  return {pass: reasons.length === 0, reasons};
}
export const COMPOSER_EXPORT_DEFAULT_FPS = 30;
/** glTF application-specific attribute (leading underscore) carrying the runtime gloss channel. */
export const COMPOSER_GLOSS_ATTRIBUTE = '_COMPOSER_GLOSS';
export type ComposerGlossMode = 'attribute' | 'drop';
export type ComposerExportForward = '+Z' | '+X';
/** Default clip windows (seconds). Walk first tries whole gait periods up to `maxSeconds`; when none closes (a crawl's
 * travelling wave) it searches the seam from `walkMinSeconds`. Idle and display search between `minSeconds` and
 * `maxSeconds` (their sinusoids are incommensurate, so the seam is usually small but not zero; the report says so).
 * The shortest seamless window wins, else the smallest seam. A static motion bakes two identical keys one second apart. */
export const COMPOSER_EXPORT_CLIP_WINDOW = Object.freeze({minSeconds: 4, maxSeconds: 12, walkMinSeconds: 0.5});
/** A clip loops seamlessly when the pose at its end equals the pose at t=0 within these (metres, radians). */
export const COMPOSER_EXPORT_SEAM_TOLERANCE = Object.freeze({position: 5e-4, angle: 0.25 * Math.PI / 180, scale: 1e-3});

export interface ComposerClipRequest {motion: ComposerMotion; fps?: number; duration?: number}
export interface ComposerExportOptions extends ComposerPoseOptions {
  /** Already resolved metre anatomy and coat; recipe text alone cannot replay it. */
  phenotype?: ComposerBuildPhenotype;
  /** Surface revision, independent of recipe identity. Omitted exports skin-5. */
  presentation?: ComposerSkinPresentation;
  /** Motions (or explicit clip windows) to bake; default every COMPOSER_MOTIONS entry. */
  clips?: readonly (ComposerMotion | ComposerClipRequest)[];
  fps?: number;
  gloss?: ComposerGlossMode;
  forward?: ComposerExportForward;
  /** Name of the skeleton root node (default 'composer-creature'). */
  name?: string;
  /** v2: target profile. Sets the default LOD chain and, for quest-3, the hard budget. */
  target?: ComposerExportTarget;
  /** v2: LOD chain, level 0 first: 'full' (the unreduced skin; first entry only) or strictly decreasing triangle
   * targets. `false` exports a single mesh even for a profile with a default chain. */
  lods?: readonly (number | 'full')[] | false;
  /** v2: may only tighten the target's budget (each field becomes the smaller of the two). */
  budget?: Partial<ComposerExportBudget>;
  /** v2: bake idle and display as crossfaded loops whose last key equals the first bit for bit. */
  seamless?: boolean;
  /** v2: crossfade length in seconds (default COMPOSER_EXPORT_SEAMLESS_BLEND, at most half the window). */
  seamlessBlend?: number;
  /** v3: with a profile whose bone budget is below the graph's joint count, reduce the skeleton by the pre-registered
   * rule (COMPOSER_SKELETON_VERSION; default true). false keeps every joint, so such an export fails on `bones`. */
  reduceSkeleton?: boolean;
}
export interface ComposerClipWindow {
  duration: number; keys: number;
  /** Largest bone position (m), rotation (rad) and scale difference between the poses at 0 and `duration`. */
  seamPosition: number; seamAngle: number; seamScale: number; seamless: boolean;
  /** How the window was chosen. */
  method: 'static' | 'gait-periods' | 'seam-search' | 'requested' | 'crossfade';
}
export interface ComposerBakedClipReport extends ComposerClipWindow {
  motion: ComposerMotion; fps: number;
  /** Treadmill speed (m/s) along the exported forward axis; 0 for motions that stay in place. */
  travelSpeed: number;
  channels: {translation: number; rotation: number; scale: number};
  /** v2 seamless loop: the crossfade length, the source window start and the seam of the uncrossfaded window. */
  crossfade?: {blendSeconds: number; sourceStart: number; rawSeamPosition: number; rawSeamAngle: number; rawSeamScale: number};
}
export interface ComposerExportLodReport {
  level: number; target: number | null; triangles: number; vertices: number; reached: boolean;
  /** glTF node and mesh of this level; level 0 is the scene's skinned mesh. */
  node: number; mesh: number; screenCoverage: number;
  relaxation: number; mirrorKept: number; maxWeightChange: number; maxPlaneError: number;
  parts: {part: string; label: string; firstTriangle: number; triangles: number}[];
  /** Output vertex -> composer skin vertex (not written to the GLB; for checks and tools). */
  sourceVertex: Uint32Array;
}
export interface ComposerExportReport {
  version: typeof COMPOSER_EXPORT_V3_VERSION;
  recipeText: string; speciesKey: string;
  versions: Record<string, string | number>;
  phenotype?: ComposerBuildPhenotype;
  individual: {deltas: string[]; effectiveRecipeText: string};
  axes: {units: 'metres'; up: '+Y'; handedness: 'right'; forward: ComposerExportForward};
  mesh: {vertices: number; triangles: number; bones: number; parts: {part: string; label: string; firstTriangle: number; triangles: number}[];
    restBounds: {min: [number, number, number]; max: [number, number, number]}};
  gloss: ComposerGlossMode;
  /** Vertex rows changed to satisfy glTF: duplicate joints merged, zero-weight joints reset to 0, sums renormalised. */
  repairs: {weightRows: number; maxWeightChange: number; zeroNormals: number};
  clips: ComposerBakedClipReport[];
  glbBytes: number;
  /** v2 only (absent when no v2 option is given). */
  target?: ComposerExportTarget;
  lods?: ComposerExportLodReport[];
  budget?: {target: ComposerExportTarget; limits: ComposerExportBudget | null; actual: {level0Triangles: number; bones: number; materials: number; textureBytes: number; drawCallsPerLevel: number}; pass: boolean};
  /** v3, profiled exports only: the skeleton as written. `reduced: false` means every graph joint is a GLB joint. */
  skeleton?: ComposerExportSkeletonReport;
}
export interface ComposerExportSkeletonReport {
  version: typeof COMPOSER_SKELETON_VERSION; fullJoints: number; joints: number; reduced: boolean; stage: ComposerSkeletonStage | null;
  collapsed: {joint: string; into: string; stage: ComposerSkeletonStage}[];
  /** [graph joint name, written joint it is skinned by], every graph joint in graph order (sidecar: mappingSha256). */
  mapping: [string, string][];
  /** Graph bone index of every written joint, in joint order. */
  survivors: number[];
  /** The pre-registered metric (null when nothing was reduced). */
  skinError: {max: number; diagonal: number; fraction: number; bound: number; vertex: number; motion: string | null; key: number; verticesChecked: number; keys: number; pass: boolean} | null;
}
export interface ComposerExportResult {glb: Uint8Array; report: ComposerExportReport}

const FORWARD_ROOT: Record<ComposerExportForward, [number, number, number, number]> = {
  // rotation by -90 deg about +Y maps +X to +Z
  '+Z': [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
  '+X': [0, 0, 0, 1],
};

/** The versions a GLB depends on, in a fixed order. */
export function composerExportVersions(): Record<string, string | number> {
  return {
    export: COMPOSER_EXPORT_V3_VERSION, recipe: COMPOSER_RECIPE_VERSION, graph: COMPOSER_GRAPH_VERSION, skin: COMPOSER_SKIN_VERSION,
    individual: COMPOSER_INDIVIDUAL_VERSION, face: COMPOSER_FACE_VERSION, faceGeometry: COMPOSER_FACE_GEOMETRY_VERSION,
    eye: COMPOSER_EYE_VERSION, eyeCatalogue: COMPOSER_EYE_CATALOGUE_VERSION, species: COMPOSER_SPECIES_GENERATOR_VERSION,
    coat: FAUNA_COAT_FIELD_VERSION, three: THREE.REVISION,
  };
}

// ------------------------------------------------------------------ clip sampling

/** Largest bone position difference (m), rotation difference (rad) and bone scale difference between two poses. */
export function composerPoseDistance(a: ComposerPose, b: ComposerPose): {position: number; angle: number; scale: number} {
  let position = 0, angle = 0, scale = 0;
  for (let i = 0; i < a.positions.length; i++) position = Math.max(position, Math.abs(a.positions[i]! - b.positions[i]!));
  for (let i = 0; i < a.radialScale.length; i++) scale = Math.max(scale, Math.abs(a.radialScale[i]! - b.radialScale[i]!), Math.abs(a.radialScale[i]! * a.chordScale[i]! - b.radialScale[i]! * b.chordScale[i]!));
  const q = a.quaternions, p = b.quaternions;
  for (let i = 0; i < q.length; i += 4) {
    // relative rotation conj(a) * b; atan2 keeps tiny angles exact (acos of a dot product rounds them to ~3e-8)
    const ax = -q[i]!, ay = -q[i + 1]!, az = -q[i + 2]!, aw = q[i + 3]!, bx = p[i]!, by = p[i + 1]!, bz = p[i + 2]!, bw = p[i + 3]!;
    const rx = aw * bx + ax * bw + ay * bz - az * by, ry = aw * by - ax * bz + ay * bw + az * bx, rz = aw * bz + ax * by - ay * bx + az * bw;
    const rw = aw * bw - ax * bx - ay * by - az * bz;
    angle = Math.max(angle, 2 * Math.atan2(Math.hypot(rx, ry, rz), Math.abs(rw)));
  }
  return {position, angle, scale};
}
type PoseDistance = ReturnType<typeof composerPoseDistance>;
const seamScore = (d: PoseDistance) =>
  Math.max(d.position / COMPOSER_EXPORT_SEAM_TOLERANCE.position, d.angle / COMPOSER_EXPORT_SEAM_TOLERANCE.angle, d.scale / COMPOSER_EXPORT_SEAM_TOLERANCE.scale);
const isSeamless = (d: PoseDistance) => seamScore(d) <= 1;

function assertFps(fps: number): void {
  if (!(Number.isFinite(fps) && fps >= 1 && fps <= 240)) throw new Error(`composer export: fps ${fps} outside [1, 240]`);
}

/** The clip window for a motion: deterministic, chosen by measuring poseComposer (only the legged gait period is read
 * from the graph, and even that candidate is accepted only when its measured seam closes). */
export function composerClipWindow(graph: ComposerGraph, motion: ComposerMotion, fps = COMPOSER_EXPORT_DEFAULT_FPS, duration?: number, poseOptions: ComposerPoseOptions = {}): ComposerClipWindow {
  assertFps(fps);
  const start = poseComposer(graph, motion, 0, poseOptions);
  const scored = new Map<ComposerClipWindow, number>();
  const window = (d: number, method: ComposerClipWindow['method']): ComposerClipWindow => {
    const seam = composerPoseDistance(start, poseComposer(graph, motion, d, poseOptions));
    const w = {duration: d, keys: Math.max(1, Math.round(d * fps)) + 1, seamPosition: seam.position, seamAngle: seam.angle, seamScale: seam.scale, seamless: isSeamless(seam), method};
    scored.set(w, seamScore(seam));
    return w;
  };
  if (duration !== undefined) {
    if (!(duration > 0 && duration <= 120)) throw new Error(`composer export: duration ${duration} outside (0, 120]`);
    return window(duration, 'requested');
  }
  const same = (a: ComposerPose, b: ComposerPose) => (['positions', 'quaternions', 'radialScale', 'chordScale'] as const).every(k => a[k].every((v, i) => v === b[k][i]));
  if ([0.37, 1.13, 2.71].every(t => same(start, poseComposer(graph, motion, t, poseOptions))))
    return {duration: 1, keys: 2, seamPosition: 0, seamAngle: 0, seamScale: 0, seamless: true, method: 'static'};
  const {minSeconds, maxSeconds, walkMinSeconds} = COMPOSER_EXPORT_CLIP_WINDOW;
  const tried: ComposerClipWindow[] = [];
  if (motion === 'walk') {
    // legged gaits recur after one gait period; take the shortest whole number of periods that closes
    const period = graph.locomotion.period;
    for (let k = 1; k * period <= Math.max(maxSeconds, period); k++) {
      const w = window(k * period, 'gait-periods'); tried.push(w);
      if (w.seamless) return w;
    }
  }
  // Otherwise (a crawl's travelling wave, idle and display sinusoids) search the measured seam: a 1/fps grid, then two
  // finer passes around the three best grid minima, so a recurrence between grid points is still found.
  const lo = motion === 'walk' ? walkMinSeconds : minSeconds, step = 1 / fps;
  const grid: ComposerClipWindow[] = [];
  for (let k = Math.ceil(lo * fps); k <= Math.floor(maxSeconds * fps); k++) grid.push(window(k / fps, 'seam-search'));
  const minima = grid.filter((w, i) => scored.get(w)! <= scored.get(grid[i - 1] ?? w)! && scored.get(w)! <= scored.get(grid[i + 1] ?? w)!)
    .sort((a, b) => scored.get(a)! - scored.get(b)! || a.duration - b.duration).slice(0, 3);
  tried.push(...grid);
  for (const seed of minima) {
    let centre = seed, half = step;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = -20; j <= 20; j++) {
        const d = centre.duration + half * j / 20;
        if (d <= 0 || d > maxSeconds) continue;
        const w = window(d, 'seam-search'); tried.push(w);
        if (scored.get(w)! < scored.get(centre)!) centre = w;
      }
      half /= 20;
    }
  }
  const seamless = tried.filter(w => w.seamless).sort((a, b) => a.duration - b.duration);
  if (seamless.length) return seamless[0]!;
  const best = [...tried].sort((a, b) => scored.get(a)! - scored.get(b)! || a.duration - b.duration)[0];
  return best ?? window(maxSeconds, 'seam-search');
}

/** Samples poseComposer at `window.keys` evenly spaced times over [0, duration] (both ends included). Per bone:
 * keys x 3 translations, keys x 4 rotations, keys x 3 scales (null when the scale never leaves 1). Quaternions are
 * kept in one hemisphere from key to key so slerp playback never takes the long way round. */
export function bakeComposerClip(graph: ComposerGraph, motion: ComposerMotion, window: Pick<ComposerClipWindow, 'duration' | 'keys'>, poseOptions: ComposerPoseOptions = {}): {
  times: Float32Array; translation: Float32Array[]; rotation: Float32Array[]; scale: (Float32Array | null)[]; travelSpeed: number;
} {
  const n = graph.bones.length, keys = window.keys;
  const times = new Float32Array(keys);
  const translation = Array.from({length: n}, () => new Float32Array(keys * 3));
  const rotation = Array.from({length: n}, () => new Float32Array(keys * 4));
  const scaleRaw = Array.from({length: n}, () => new Float32Array(keys * 3));
  const scaleUsed = new Array<boolean>(n).fill(false);
  const prev = new Float64Array(n * 4);
  let travelSpeed = 0;
  for (let k = 0; k < keys; k++) {
    const t = keys === 1 ? 0 : window.duration * k / (keys - 1);
    times[k] = t;
    const pose = poseComposer(graph, motion, t, poseOptions);
    if (k === keys - 1 && t > 0) travelSpeed = pose.travel / t;
    for (let i = 0; i < n; i++) {
      translation[i]!.set([pose.positions[i * 3]!, pose.positions[i * 3 + 1]!, pose.positions[i * 3 + 2]!], k * 3);
      let x = pose.quaternions[i * 4]!, y = pose.quaternions[i * 4 + 1]!, z = pose.quaternions[i * 4 + 2]!, w = pose.quaternions[i * 4 + 3]!;
      const len = Math.hypot(x, y, z, w); x /= len; y /= len; z /= len; w /= len;
      if (k > 0 && x * prev[i * 4]! + y * prev[i * 4 + 1]! + z * prev[i * 4 + 2]! + w * prev[i * 4 + 3]! < 0) { x = -x; y = -y; z = -z; w = -w; }
      prev.set([x, y, z, w], i * 4);
      rotation[i]!.set([x, y, z, w], k * 4);
      const radial = pose.radialScale[i]!, sy = radial, sz = radial * pose.chordScale[i]!;
      scaleRaw[i]!.set([1, sy, sz], k * 3);
      if (Math.fround(sy) !== 1 || Math.fround(sz) !== 1) scaleUsed[i] = true;
    }
  }
  return {times, translation, rotation, scale: scaleRaw.map((s, i) => scaleUsed[i] ? s : null), travelSpeed};
}

/** v2 seamless loop (idle, display): the same key times as bakeComposerClip over [0, D], but key k shows the source
 * pose at b + t_k, and over the last b seconds it blends (smoothstep weight; lerp for translation and scale, normalised
 * lerp for rotation) toward the source pose at u = t - (D - b), the pre-roll that leads into b. At t = D the weight is
 * 1 and the pose is the source pose at b, which is key 0, so the last key is written as a copy of key 0: the loop
 * closes bit for bit. Inside the blend the clip is no longer poseComposer; everywhere else it is poseComposer(b + t).
 * Uses only + - * / and sqrt. Throws for a travelling motion (walk) and when the rotation path would close in the
 * opposite quaternion hemisphere (it never does for an idle sway; a throw beats a silent long-way slerp). */
export function bakeComposerLoopClip(graph: ComposerGraph, motion: ComposerMotion, window: Pick<ComposerClipWindow, 'duration' | 'keys'>, blend: number, poseOptions: ComposerPoseOptions = {}): {
  times: Float32Array; translation: Float32Array[]; rotation: Float32Array[]; scale: (Float32Array | null)[]; travelSpeed: number;
} {
  const n = graph.bones.length, keys = window.keys, D = window.duration;
  if (keys < 3) throw new Error('composer export: a seamless loop needs at least 3 keys');
  if (!(Number.isFinite(blend) && blend > 0 && blend <= D / 2)) throw new Error(`composer export: crossfade ${blend} s outside (0, ${D / 2}]`);
  const times = new Float32Array(keys);
  const translation = Array.from({length: n}, () => new Float32Array(keys * 3));
  const rotation = Array.from({length: n}, () => new Float32Array(keys * 4));
  const scaleRaw = Array.from({length: n}, () => new Float32Array(keys * 3));
  const scaleUsed = new Array<boolean>(n).fill(false);
  const prev = new Float64Array(n * 4);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  for (let k = 0; k < keys; k++) {
    const t = D * k / (keys - 1);
    times[k] = t;
    if (k === keys - 1) {
      for (let i = 0; i < n; i++) {
        const r = rotation[i]!;
        if (r[0]! * prev[i * 4]! + r[1]! * prev[i * 4 + 1]! + r[2]! * prev[i * 4 + 2]! + r[3]! * prev[i * 4 + 3]! < 0)
          throw new Error(`composer export: ${motion} loop closes in the opposite quaternion hemisphere at bone ${i}`);
        translation[i]!.copyWithin(k * 3, 0, 3); rotation[i]!.copyWithin(k * 4, 0, 4); scaleRaw[i]!.copyWithin(k * 3, 0, 3);
      }
      break;
    }
    const a = poseComposer(graph, motion, blend + t, poseOptions);
    if (a.travel !== 0) throw new Error(`composer export: ${motion} travels; a crossfaded loop is only for in-place motions`);
    const u = t - (D - blend);
    const w = u > 0 ? smooth(Math.min(1, u / blend)) : 0;
    const b = w > 0 ? poseComposer(graph, motion, u, poseOptions) : null;
    for (let i = 0; i < n; i++) {
      const tr = [a.positions[i * 3]!, a.positions[i * 3 + 1]!, a.positions[i * 3 + 2]!];
      let x = a.quaternions[i * 4]!, y = a.quaternions[i * 4 + 1]!, z = a.quaternions[i * 4 + 2]!, qw = a.quaternions[i * 4 + 3]!;
      let len = Math.sqrt(x * x + y * y + z * z + qw * qw); x /= len; y /= len; z /= len; qw /= len;
      let radial = a.radialScale[i]!, sz = radial * a.chordScale[i]!;
      if (b) {
        for (let c = 0; c < 3; c++) tr[c] = tr[c]! + (b.positions[i * 3 + c]! - tr[c]!) * w;
        let bx = b.quaternions[i * 4]!, by = b.quaternions[i * 4 + 1]!, bz = b.quaternions[i * 4 + 2]!, bw = b.quaternions[i * 4 + 3]!;
        const bl = Math.sqrt(bx * bx + by * by + bz * bz + bw * bw); bx /= bl; by /= bl; bz /= bl; bw /= bl;
        if (x * bx + y * by + z * bz + qw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
        x += (bx - x) * w; y += (by - y) * w; z += (bz - z) * w; qw += (bw - qw) * w;
        len = Math.sqrt(x * x + y * y + z * z + qw * qw); x /= len; y /= len; z /= len; qw /= len;
        const bRadial = b.radialScale[i]!;
        sz += (bRadial * b.chordScale[i]! - sz) * w;
        radial += (bRadial - radial) * w;
      }
      if (k > 0 && x * prev[i * 4]! + y * prev[i * 4 + 1]! + z * prev[i * 4 + 2]! + qw * prev[i * 4 + 3]! < 0) { x = -x; y = -y; z = -z; qw = -qw; }
      prev.set([x, y, z, qw], i * 4);
      translation[i]!.set(tr, k * 3);
      rotation[i]!.set([x, y, z, qw], k * 4);
      scaleRaw[i]!.set([1, radial, sz], k * 3);
      if (Math.fround(radial) !== 1 || Math.fround(sz) !== 1) scaleUsed[i] = true;
    }
  }
  return {times, translation, rotation, scale: scaleRaw.map((s, i) => scaleUsed[i] ? s : null), travelSpeed: 0};
}

// ------------------------------------------------------------------ bone-reducing skeleton (export v3)

/** The reduction rule (docs/creature-export-v3.md "The reduction rule", pre-registered before any measurement). */
export const COMPOSER_SKELETON_VERSION = 'fauna-composer-skeleton-1';
/** Pre-registered bound: a reduced skeleton may move no level-0 vertex, at any key of any baked clip, by more than this
 * fraction of the body diagonal (the unreduced skin's rest bounding box) against the full skeleton. Never loosened. */
export const COMPOSER_SKELETON_SKIN_ERROR_BOUND = 0.02;
/** Unit stages, in the order they are applied. */
export const COMPOSER_SKELETON_STAGES = Object.freeze(['feet', 'metapodials', 'tail', 'torso', 'neck'] as const);
export type ComposerSkeletonStage = typeof COMPOSER_SKELETON_STAGES[number];
/** One reduction unit: joints removed together (both sides of a leg pair, or one midline joint). */
export interface ComposerSkeletonUnit {stage: ComposerSkeletonStage; joints: number[]}
export interface ComposerSkeletonPlan {
  version: typeof COMPOSER_SKELETON_VERSION;
  fullJoints: number; joints: number; maxBones: number;
  /** True when joints were removed; false when the graph fits (nothing to do) or the units ran out (nothing removed). */
  reduced: boolean;
  /** joints <= maxBones. */
  reached: boolean;
  /** The last stage that removed a joint (null when nothing was removed). */
  stage: ComposerSkeletonStage | null;
  /** Surviving graph bones, ascending (graph order); every bone when nothing is removed. */
  survivors: number[];
  /** Graph bone -> its nearest surviving ancestor (itself when it survives). */
  into: number[];
  /** Removed joints by name, in removal order. */
  collapsed: {joint: string; into: string; stage: ComposerSkeletonStage}[];
}

/** The reduction units of a graph, in application order: feet (per leg pair, pair ascending), metapodials (three-segment
 * legs, per pair), then the odd tail joints tip-most first, the odd torso joints rearmost first and the odd neck joints
 * base first, each merging into the joint before it. Knees (upper, lower), the root, head, arms, wings and trunk never
 * appear. */
export function composerSkeletonUnits(graph: ComposerGraph): ComposerSkeletonUnit[] {
  const units: ComposerSkeletonUnit[] = [];
  const legs = graph.limbs.filter(l => l.kind === 'leg');
  const pairs = [...new Set(legs.map(l => l.pair))].sort((a, b) => a - b);
  const perPair = (stage: ComposerSkeletonStage, pick: (limb: ComposerGraph['limbs'][number]) => number | null) => {
    for (const pair of pairs) {
      const joints = legs.filter(l => l.pair === pair).map(pick).filter((j): j is number => j !== null).sort((a, b) => a - b);
      if (joints.length) units.push({stage, joints});
    }
  };
  perPair('feet', l => { const j = l.bones[l.bones.length - 1]; return j !== undefined && graph.bones[j]!.part === 'foot' ? j : null; });
  perPair('metapodials', l => l.segments.length === 3 && l.bones.length === 4 ? l.bones[2]! : null);
  const odd = (chain: readonly number[]) => chain.filter((_, i) => i % 2 === 1);
  for (const j of odd(graph.chains.tail).reverse()) units.push({stage: 'tail', joints: [j]});
  for (const j of odd(graph.chains.torso)) units.push({stage: 'torso', joints: [j]});
  for (const j of odd(graph.chains.neck)) units.push({stage: 'neck', joints: [j]});
  return units;
}

/** Applies the units in order until the joint count is at most `maxBones`, and no further. If they run out first,
 * nothing is removed (`reached: false`). */
export function planComposerSkeleton(graph: ComposerGraph, maxBones: number): ComposerSkeletonPlan {
  const n = graph.bones.length;
  const identity = Array.from({length: n}, (_, i) => i);
  const plan = (removed: Set<number>, stage: ComposerSkeletonStage | null, collapsedOrder: {joint: number; stage: ComposerSkeletonStage}[], reached: boolean): ComposerSkeletonPlan => {
    const into = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      const parent = graph.bones[j]!.parent;
      if (removed.has(j) && !(parent >= 0 && parent < j)) throw new Error(`composer skeleton: joint ${graph.bones[j]!.name} has no earlier parent to collapse into`);
      into[j] = removed.has(j) ? into[parent]! : j;
    }
    return {version: COMPOSER_SKELETON_VERSION, fullJoints: n, joints: n - removed.size, maxBones, reduced: removed.size > 0, reached, stage,
      survivors: identity.filter(j => !removed.has(j)), into,
      collapsed: collapsedOrder.map(c => ({joint: graph.bones[c.joint]!.name, into: graph.bones[into[c.joint]!]!.name, stage: c.stage}))};
  };
  if (n <= maxBones) return plan(new Set(), null, [], true);
  const removed = new Set<number>(), order: {joint: number; stage: ComposerSkeletonStage}[] = [];
  for (const unit of composerSkeletonUnits(graph)) {
    for (const j of unit.joints) { removed.add(j); order.push({joint: j, stage: unit.stage}); }
    if (n - removed.size <= maxBones) return plan(removed, unit.stage, order, true);
  }
  return plan(new Set(), null, [], false);
}

/** The pre-registered skin error of a reduced skeleton: the largest distance between a vertex skinned with its full
 * rows (graph joints) and with its reduced rows (indices into `survivors`), over every key of every baked clip, with
 * joint matrices composed in float64 from the stored float32 channels times the stored float32 inverse bind matrices.
 * Rows whose joints all survive are identical in both skeletons and skipped. */
export function composerSkeletonSkinError(positions: Float32Array, full: {joints: Uint16Array; weights: Float32Array}, reduced: {joints: Uint16Array; weights: Float32Array},
  survivors: readonly number[], ibm: Float32Array, clips: readonly {motion: string; translation: Float32Array[]; rotation: Float32Array[]; scale: (Float32Array | null)[]; keys: number}[]): {
  max: number; vertex: number; motion: string | null; key: number; verticesChecked: number; keys: number;
} {
  const surviving = new Set(survivors);
  const rows: number[] = [];
  for (let v = 0; v < full.joints.length / 4; v++) {
    for (let k = 0; k < 4; k++) if (full.weights[v * 4 + k]! > 0 && !surviving.has(full.joints[v * 4 + k]!)) { rows.push(v); break; }
  }
  const n = ibm.length / 16, S = new Float64Array(n * 12);
  let max = 0, vertex = -1, motion: string | null = null, key = -1, keys = 0;
  for (const clip of clips) {
    for (let k = 0; k < clip.keys; k++) {
      keys++;
      for (let j = 0; j < n; j++) {
        const t = clip.translation[j]!, r = clip.rotation[j]!, s = clip.scale[j];
        const x = r[k * 4]!, y = r[k * 4 + 1]!, z = r[k * 4 + 2]!, w = r[k * 4 + 3]!;
        const sx = s ? s[k * 3]! : 1, sy = s ? s[k * 3 + 1]! : 1, sz = s ? s[k * 3 + 2]! : 1;
        // M = T * R * S as a 3x4 row-major matrix, then M * IBM (IBM column-major, as glTF stores it)
        const m = [
          (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y - z * w)) * sy, (2 * (x * z + y * w)) * sz, t[k * 3]!,
          (2 * (x * y + z * w)) * sx, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z - x * w)) * sz, t[k * 3 + 1]!,
          (2 * (x * z - y * w)) * sx, (2 * (y * z + x * w)) * sy, (1 - 2 * (x * x + y * y)) * sz, t[k * 3 + 2]!,
        ];
        const b = j * 16;
        for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
          S[j * 12 + row * 4 + col] = m[row * 4]! * ibm[b + col * 4]! + m[row * 4 + 1]! * ibm[b + col * 4 + 1]! + m[row * 4 + 2]! * ibm[b + col * 4 + 2]! + m[row * 4 + 3]! * ibm[b + col * 4 + 3]!;
        }
      }
      for (const v of rows) {
        const px = positions[v * 3]!, py = positions[v * 3 + 1]!, pz = positions[v * 3 + 2]!;
        let fx = 0, fy = 0, fz = 0, rx = 0, ry = 0, rz = 0;
        for (let c = 0; c < 4; c++) {
          const fw = full.weights[v * 4 + c]!;
          if (fw > 0) { const o = full.joints[v * 4 + c]! * 12; fx += fw * (S[o]! * px + S[o + 1]! * py + S[o + 2]! * pz + S[o + 3]!); fy += fw * (S[o + 4]! * px + S[o + 5]! * py + S[o + 6]! * pz + S[o + 7]!); fz += fw * (S[o + 8]! * px + S[o + 9]! * py + S[o + 10]! * pz + S[o + 11]!); }
          const rw = reduced.weights[v * 4 + c]!;
          if (rw > 0) { const o = survivors[reduced.joints[v * 4 + c]!]! * 12; rx += rw * (S[o]! * px + S[o + 1]! * py + S[o + 2]! * pz + S[o + 3]!); ry += rw * (S[o + 4]! * px + S[o + 5]! * py + S[o + 6]! * pz + S[o + 7]!); rz += rw * (S[o + 8]! * px + S[o + 9]! * py + S[o + 10]! * pz + S[o + 11]!); }
        }
        const d = Math.sqrt((fx - rx) * (fx - rx) + (fy - ry) * (fy - ry) + (fz - rz) * (fz - rz));
        if (d > max) { max = d; vertex = v; motion = clip.motion; key = k; }
      }
    }
  }
  return {max, vertex, motion, key, verticesChecked: rows.length, keys};
}

// ------------------------------------------------------------------ GLB writer

const GL = Object.freeze({FLOAT: 5126, UNSIGNED_BYTE: 5121, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125, ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, TRIANGLES: 4});
type AccessorType = 'SCALAR' | 'VEC3' | 'VEC4' | 'MAT4';
const COMPONENTS: Record<AccessorType, number> = {SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16};

class GlbBuilder {
  readonly bufferViews: Record<string, number>[] = [];
  readonly accessors: Record<string, unknown>[] = [];
  private chunks: Uint8Array[] = [];
  private length = 0;
  /** Appends bytes 4-byte aligned; returns the byte offset in the binary chunk. */
  private append(bytes: Uint8Array): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    const offset = this.length; this.chunks.push(bytes); this.length += bytes.byteLength;
    return offset;
  }
  bufferView(data: ArrayBufferView, target?: number, byteStride?: number): number {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const view: Record<string, number> = {buffer: 0, byteOffset: this.append(bytes.slice()), byteLength: bytes.byteLength};
    if (byteStride) view.byteStride = byteStride;
    if (target) view.target = target;
    return this.bufferViews.push(view) - 1;
  }
  accessor(view: number, byteOffset: number, componentType: number, count: number, type: AccessorType, extra: {min?: number[]; max?: number[]; normalized?: boolean} = {}): number {
    const a: Record<string, unknown> = {bufferView: view};
    if (byteOffset) a.byteOffset = byteOffset;
    a.componentType = componentType;
    if (extra.normalized) a.normalized = true;
    a.count = count; a.type = type;
    if (extra.min) a.min = extra.min;
    if (extra.max) a.max = extra.max;
    return this.accessors.push(a) - 1;
  }
  /** One tightly packed accessor in its own buffer view. */
  data(array: Float32Array | Uint16Array | Uint32Array | Uint8Array, type: AccessorType, target?: number, withBounds = false): number {
    const componentType = array instanceof Float32Array ? GL.FLOAT : array instanceof Uint16Array ? GL.UNSIGNED_SHORT : array instanceof Uint32Array ? GL.UNSIGNED_INT : GL.UNSIGNED_BYTE;
    const c = COMPONENTS[type], count = array.length / c;
    let bounds: {min?: number[]; max?: number[]} = {};
    if (withBounds) bounds = componentBounds(array, c);
    return this.accessor(this.bufferView(array, target), 0, componentType, count, type, bounds);
  }
  /** Writes the container: `doc` (key order kept) followed by accessors, bufferViews and the one buffer. */
  finish(doc: Record<string, unknown>): Uint8Array {
    const enc = new TextEncoder();
    const binLength = this.length + ((4 - (this.length % 4)) % 4);
    const json = {...doc, accessors: this.accessors, bufferViews: this.bufferViews, buffers: [{byteLength: binLength}]};
    let jsonBytes = enc.encode(JSON.stringify(json));
    const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
    if (jsonPad) { const padded = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20); padded.set(jsonBytes); jsonBytes = padded; }
    const total = 12 + 8 + jsonBytes.byteLength + 8 + binLength;
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20);
    let o = 20 + jsonBytes.byteLength;
    dv.setUint32(o, binLength, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
    let p = 0;
    for (const chunk of this.chunks) { out.set(chunk, o + p); p += chunk.byteLength; }
    return out;
  }
}
function componentBounds(array: ArrayLike<number>, c: number): {min: number[]; max: number[]} {
  const min = new Array<number>(c).fill(Infinity), max = new Array<number>(c).fill(-Infinity);
  for (let i = 0; i < array.length; i++) { const k = i % c, v = array[i]!; if (v < min[k]!) min[k] = v; if (v > max[k]!) max[k] = v; }
  return {min, max};
}

/** Parses a GLB container (header, JSON chunk, BIN chunk). Throws on a malformed file. */
export function readComposerGlb(bytes: Uint8Array): {json: any; bin: Uint8Array} {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('GLB: bad magic');
  if (dv.getUint32(4, true) !== 2) throw new Error('GLB: not version 2');
  if (dv.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB: header length does not match the file');
  const jsonLength = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || jsonLength % 4) throw new Error('GLB: first chunk is not an aligned JSON chunk');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const o = 20 + jsonLength;
  if (o === bytes.byteLength) return {json, bin: new Uint8Array(0)};
  const binLength = dv.getUint32(o, true);
  if (dv.getUint32(o + 4, true) !== 0x004e4942 || binLength % 4 || o + 8 + binLength !== bytes.byteLength) throw new Error('GLB: second chunk is not an aligned BIN chunk ending the file');
  return {json, bin: bytes.subarray(o + 8, o + 8 + binLength)};
}

/** glTF requires every weight row to sum to 1 and a joint to appear at most once with a non-zero weight; unused slots
 * point at joint 0. The composer's rows already sum to 1 within float rounding; this merges duplicates and renormalises. */
function gltfSkinRows(skinIndex: Uint16Array, skinWeight: Float32Array): {joints: Uint16Array; weights: Float32Array; rows: number; maxChange: number} {
  const joints = new Uint16Array(skinIndex.length), weights = new Float32Array(skinWeight.length);
  let rows = 0, maxChange = 0;
  for (let v = 0; v < skinIndex.length; v += 4) {
    const j: number[] = [], w: number[] = [];
    for (let k = 0; k < 4; k++) {
      const wk = skinWeight[v + k]!, jk = skinIndex[v + k]!;
      if (!(wk > 0)) continue;
      const at = j.indexOf(jk);
      if (at >= 0) w[at] += wk; else { j.push(jk); w.push(wk); }
    }
    const sum = w.reduce((s, x) => s + x, 0);
    if (!(sum > 0)) throw new Error(`composer export: vertex ${v / 4} has no skin weight`);
    for (let k = 0; k < 4; k++) { joints[v + k] = k < j.length ? j[k]! : 0; weights[v + k] = k < j.length ? Math.fround(w[k]! / sum) : 0; }
    // float32 residual goes onto the largest weight so the stored row sums to 1 as closely as float32 allows
    let big = 0; for (let k = 1; k < j.length; k++) if (weights[v + k]! > weights[v + big]!) big = k;
    let stored = 0; for (let k = 0; k < 4; k++) stored += weights[v + k]!;
    weights[v + big] = Math.fround(weights[v + big]! + (1 - stored));
    let changed = false;
    for (let k = 0; k < 4; k++) {
      if (joints[v + k] !== skinIndex[v + k] && weights[v + k]! > 0) changed = true;
      const d = Math.abs(weights[v + k]! - (skinWeight[v + k]! > 0 ? skinWeight[v + k]! : 0));
      if (joints[v + k] === skinIndex[v + k]) maxChange = Math.max(maxChange, d);
      if (d > 0) changed = true;
    }
    if (changed) rows++;
  }
  return {joints, weights, rows, maxChange};
}

function resolveRecipe(input: ComposerRecipe | string): ComposerRecipe {
  if (typeof input === 'string') {
    const decoded = decodeComposerRecipe(input);
    if (!decoded.recipe) throw new Error(`composer export: ${decoded.error}`);
    return decoded.recipe;
  }
  return normalizeComposerRecipe(input).recipe;
}

/** Mesh data for one level, in the composer skin layout. */
interface LevelArrays {
  positions: Float32Array; normals: Float32Array; colors: Float32Array; gloss: Float32Array;
  skinIndex: Uint16Array; skinWeight: Float32Array; index: Uint32Array; vertexCount: number;
}
/** Writes one level's primitive data (the v1 order: POSITION, NORMAL, COLOR_0, JOINTS_0, WEIGHTS_0, gloss, indices). */
function writeLevelMesh(b: GlbBuilder, level: LevelArrays, gloss: ComposerGlossMode) {
  const rows = gltfSkinRows(level.skinIndex, level.skinWeight);
  const attributes: Record<string, number> = {
    POSITION: b.data(level.positions, 'VEC3', GL.ARRAY_BUFFER, true),
    NORMAL: b.data(level.normals, 'VEC3', GL.ARRAY_BUFFER),
    COLOR_0: b.data(level.colors, 'VEC3', GL.ARRAY_BUFFER),
    JOINTS_0: b.data(rows.joints, 'VEC4', GL.ARRAY_BUFFER),
    WEIGHTS_0: b.data(rows.weights, 'VEC4', GL.ARRAY_BUFFER),
  };
  if (gloss === 'attribute') attributes[COMPOSER_GLOSS_ATTRIBUTE] = b.data(level.gloss, 'SCALAR', GL.ARRAY_BUFFER);
  const index = level.vertexCount <= 0xffff ? Uint16Array.from(level.index) : level.index;
  const indices = b.data(index, 'SCALAR', GL.ELEMENT_ARRAY_BUFFER);
  return {attributes, indices, rows};
}

/** MSFT_screencoverage hints, one per level: level i is drawn while the creature covers at least this fraction of the
 * screen height; the last level is never culled (0). */
export function composerLodScreenCoverage(levels: number): number[] {
  return Array.from({length: levels}, (_, i) => i === levels - 1 ? 0 : Number((0.25 * 0.4 ** i).toFixed(4)));
}

interface ResolvedV2 {target: ComposerExportTarget; lods: (number | 'full')[] | null; budget: ComposerExportBudget; seamless: boolean; blend: number}
/** The desktop budget is the composer's own (the core already refuses a creature over it). */
const DESKTOP_BUDGET: Readonly<ComposerExportBudget> = Object.freeze({maxTriangles: COMPOSER_BUDGET.maxTriangles, maxBones: COMPOSER_BUDGET.maxBones, maxMaterials: 1, maxTextureBytes: 0, maxDrawCallsPerLevel: 1});
/** Resolves the v2 options; null when none is given (the plain path: its BIN chunk is byte-identical to fauna-composer-export-1). */
function resolveV2(options: ComposerExportOptions): ResolvedV2 | null {
  const lodsGiven = options.lods !== undefined && options.lods !== false;
  if (options.target === undefined && !lodsGiven && options.seamless !== true && options.budget === undefined && options.seamlessBlend === undefined) return null;
  const target = options.target ?? 'desktop-web';
  if (!Object.hasOwn(COMPOSER_EXPORT_TARGETS, target)) throw new Error(`composer export: unknown target ${String(target)}`);
  const profile = COMPOSER_EXPORT_TARGETS[target];
  const lods = options.lods === false ? null : options.lods ? [...options.lods] : profile.lods ? [...profile.lods] : null;
  if (lods) {
    if (!lods.length) throw new Error('composer export: an empty LOD list (use lods: false for a single mesh)');
    lods.forEach((l, i) => { if (l === 'full' ? i !== 0 : !(Number.isInteger(l) && l >= 4)) throw new Error(`composer export: LOD entry ${String(l)} at ${i} ('full' only first, otherwise an integer >= 4)`); });
    for (let i = 1; i < lods.length; i++) if (lods[i - 1] !== 'full' && !((lods[i] as number) < (lods[i - 1] as number))) throw new Error(`composer export: LOD targets must strictly decrease (${lods.join(', ')})`);
  }
  const budget: ComposerExportBudget = {...(profile.budget ?? DESKTOP_BUDGET)};
  for (const [key, value] of Object.entries(options.budget ?? {})) {
    if (!Object.hasOwn(budget, key)) throw new Error(`composer export: unknown budget field ${key}`);
    if (!(typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error(`composer export: budget ${key} must be a finite number >= 0`);
    const k = key as keyof ComposerExportBudget;
    budget[k] = Math.min(budget[k], value); // a brief may tighten a profile, never loosen it
  }
  const blend = options.seamlessBlend ?? COMPOSER_EXPORT_SEAMLESS_BLEND;
  if (!(Number.isFinite(blend) && blend > 0)) throw new Error(`composer export: seamlessBlend ${blend} must be a positive number of seconds`);
  return {target, lods, budget, seamless: options.seamless === true, blend};
}

/** Builds the creature for `recipe` (a recipe object or its shared text) and returns the GLB bytes and a report. */
export function exportCreatureGlb(input: ComposerRecipe | string, options: ComposerExportOptions = {}): ComposerExportResult {
  const recipe = resolveRecipe(input);
  const fps = options.fps ?? COMPOSER_EXPORT_DEFAULT_FPS;
  const gloss = options.gloss ?? 'attribute', forward = options.forward ?? '+Z';
  if (gloss !== 'attribute' && gloss !== 'drop') throw new Error(`composer export: unknown gloss mode ${String(gloss)}`);
  if (!Object.hasOwn(FORWARD_ROOT, forward)) throw new Error(`composer export: unknown forward axis ${String(forward)}`);
  const requests: ComposerClipRequest[] = (options.clips ?? COMPOSER_MOTIONS).map(c => typeof c === 'string' ? {motion: c} : {...c});
  assertFps(fps);
  for (const r of requests) {
    if (!(COMPOSER_MOTIONS as readonly string[]).includes(r.motion)) throw new Error(`composer export: unknown motion ${String(r.motion)}`);
    if (r.fps !== undefined) assertFps(r.fps);
  }
  if (new Set(requests.map(r => r.motion)).size !== requests.length) throw new Error('composer export: a motion is listed twice');
  const v2 = resolveV2(options);

  const creature = createComposerCreature(recipe, {presentation: options.presentation, trunkMotion: options.trunkMotion, phenotype: options.phenotype});
  try {
    const {graph, skin} = creature;
    const geometry = creature.mesh.geometry;
    const normals = (geometry.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
    const normalOut = new Float32Array(normals);
    let zeroNormals = 0;
    for (let i = 0; i < normalOut.length; i += 3) {
      const l = Math.hypot(normalOut[i]!, normalOut[i + 1]!, normalOut[i + 2]!);
      if (!(l > 0.5)) { normalOut.set([0, 1, 0], i); zeroNormals++; }
    }
    const n = graph.bones.length;

    // ---- levels: the skin itself (v1), or the LOD chain (v2)
    const full: LevelArrays & {parts: ComposerExportReport['mesh']['parts']} = {
      positions: skin.positions, normals: normalOut, colors: skin.colors, gloss: skin.gloss, skinIndex: skin.skinIndex, skinWeight: skin.skinWeight,
      index: skin.index, vertexCount: skin.vertexCount, parts: skin.parts.map(p => ({part: p.part, label: p.label, firstTriangle: p.firstTriangle, triangles: p.triangles})),
    };
    type Level = LevelArrays & {parts: ComposerExportReport['mesh']['parts']; target: number | null; reduced: ComposerLodLevel | null};
    let levels: Level[] = [{...full, target: null, reduced: null}];
    if (v2?.lods) {
      const numeric = v2.lods.filter((l): l is number => l !== 'full');
      const chain = numeric.length ? buildComposerLodChain({positions: skin.positions, normals: normalOut, colors: skin.colors, gloss: skin.gloss,
        skinIndex: skin.skinIndex, skinWeight: skin.skinWeight, index: skin.index, parts: full.parts}, numeric,
        skin.version === COMPOSER_REALISM_SKIN_VERSION ? composerAnatomyLodConstraints(skin, graph) : undefined) : null;
      const reducedLevels: Level[] = (chain?.levels ?? []).map(l => ({positions: l.positions, normals: l.normals!, colors: l.colors, gloss: l.gloss!, skinIndex: l.skinIndex,
        skinWeight: l.skinWeight, index: l.index, vertexCount: l.vertices, parts: l.parts, target: l.target, reduced: l}));
      levels = v2.lods[0] === 'full' ? [levels[0]!, ...reducedLevels] : reducedLevels;
    }
    // ---- skeleton (v3): a profile whose bone budget is below the graph's joint count reduces the skeleton by the
    // pre-registered rule; every other export writes every graph joint (and its bytes do not change)
    const plan = v2 && options.reduceSkeleton !== false && v2.budget.maxBones < n ? planComposerSkeleton(graph, v2.budget.maxBones) : null;
    const reduction = plan?.reduced ? plan : null;
    const joints = reduction ? reduction.survivors : graph.bones.map((_, i) => i);
    const jointCount = joints.length;
    const fullLevel0 = levels[0]!;
    if (reduction) {
      // joints map to their nearest surviving ancestor; the glTF row repair (writeLevelMesh) merges duplicates and renormalises
      const slot = new Int32Array(n).fill(-1); joints.forEach((j, k) => { slot[j] = k; });
      const remap = (index: Uint16Array) => index.map(j => slot[reduction.into[j]!]!);
      levels = levels.map(level => ({...level, skinIndex: remap(level.skinIndex)}));
    }
    const budgetActual = {level0Triangles: levels[0]!.index.length / 3, bones: jointCount, materials: 1, textureBytes: 0, drawCallsPerLevel: 1};
    if (v2) {
      // a failing budget throws here, before anything is written, so a report that carries a budget always passed it
      const check = checkComposerExportBudget(v2.budget, {...budgetActual, levels: levels.map(l => ({triangles: l.index.length / 3, target: l.target}))});
      if (!check.pass) throw new ComposerExportBudgetError(v2.target, v2.budget, check.reasons);
    }

    const b = new GlbBuilder();
    const rootName = options.name ?? 'composer-creature';
    const recipeText = encodeComposerRecipe(recipe);
    const effectiveRecipeText = encodeComposerRecipe(creature.individual.effectiveRecipe);
    const versions: Record<string, string | number> = v2 ? {...composerExportVersions(), lod: COMPOSER_LOD_VERSION} : composerExportVersions();
    versions.skin = skin.version;
    if (graph.phenotype) versions.phenotype = graph.phenotype.version;
    if (options.trunkMotion === 'wave-1' && graph.chains.trunk.length && requests.some(r => r.motion !== 'neutral')) versions.trunkMotion = COMPOSER_TRUNK_MOTION_VERSION;
    if (v2?.lods && skin.version === COMPOSER_REALISM_SKIN_VERSION) versions.lodFeet = COMPOSER_FOOT_LOD_VERSION;
    if (v2?.lods && skin.version === COMPOSER_REALISM_SKIN_VERSION) versions.lodAnatomy = COMPOSER_ANATOMY_LOD_VERSION;
    if (reduction) versions.skeleton = COMPOSER_SKELETON_VERSION;
    const exportVersion = COMPOSER_EXPORT_V3_VERSION;

    // ---- meshes (level 0 first; v1 writes exactly one)
    const written = levels.map(level => writeLevelMesh(b, level, gloss));
    const rows = written[0]!.rows;
    const parts = levels[0]!.parts;

    // ---- skeleton
    const ibmAll = new Float32Array(n * 16), m = new THREE.Matrix4();
    graph.bones.forEach((bone, i) => {
      m.compose(new THREE.Vector3().fromArray(bone.restPosition), new THREE.Quaternion().fromArray(bone.restQuaternion), new THREE.Vector3(1, 1, 1)).invert();
      ibmAll.set(m.elements, i * 16);
    });
    let ibm = ibmAll;
    if (reduction) { ibm = new Float32Array(jointCount * 16); joints.forEach((j, k) => ibm.set(ibmAll.subarray(j * 16, j * 16 + 16), k * 16)); }
    const ibmAccessor = b.data(ibm, 'MAT4');
    const SKIN_NODE = 0, ROOT_NODE = 1, FIRST_JOINT = 2, FIRST_LOD_NODE = FIRST_JOINT + jointCount;
    const coverage = composerLodScreenCoverage(levels.length);
    const skinNode: Record<string, unknown> = {name: 'composer-skin', mesh: 0, skin: 0};
    if (levels.length > 1) {
      skinNode.extensions = {MSFT_lod: {ids: levels.slice(1).map((_, i) => FIRST_LOD_NODE + i)}};
      skinNode.extras = {MSFT_screencoverage: coverage};
    }
    const nodes: Record<string, unknown>[] = [
      skinNode,
      {name: rootName, ...(forward === '+X' ? {} : {rotation: FORWARD_ROOT[forward]}), children: joints.map((_, k) => FIRST_JOINT + k)},
      ...joints.map(j => graph.bones[j]!).map(bone => {
        const q = new THREE.Quaternion().fromArray(bone.restQuaternion).normalize();
        return {name: bone.name, rotation: [q.x, q.y, q.z, q.w], translation: [...bone.restPosition]};
      }),
      // lower LOD levels: skinned by the same skin, outside the scene (MSFT_lod reaches them from node 0)
      ...levels.slice(1).map((_, i) => ({name: `composer-skin-lod${i + 1}`, mesh: i + 1, skin: 0})),
    ];

    // ---- animations
    const clipReports: ComposerBakedClipReport[] = [];
    const animations: Record<string, unknown>[] = [];
    const bakedClips: {motion: string; keys: number; translation: Float32Array[]; rotation: Float32Array[]; scale: (Float32Array | null)[]}[] = [];
    for (const request of requests) {
      const clipFps = request.fps ?? fps;
      let window = composerClipWindow(graph, request.motion, clipFps, request.duration, options);
      let crossfade: ComposerBakedClipReport['crossfade'];
      let baked: ReturnType<typeof bakeComposerClip>;
      if (v2?.seamless && (request.motion === 'idle' || request.motion === 'display') && window.method !== 'static') {
        const blend = Math.min(v2.blend, window.duration / 2);
        if (window.keys < 3) window = {...window, keys: 3};
        baked = bakeComposerLoopClip(graph, request.motion, window, blend, options);
        crossfade = {blendSeconds: blend, sourceStart: blend, rawSeamPosition: window.seamPosition, rawSeamAngle: window.seamAngle, rawSeamScale: window.seamScale};
        window = {...window, seamPosition: 0, seamAngle: 0, seamScale: 0, seamless: true, method: 'crossfade'};
      } else baked = bakeComposerClip(graph, request.motion, window, options);
      const input = b.data(baked.times, 'SCALAR', undefined, true);
      const samplers: Record<string, unknown>[] = [], channels: Record<string, unknown>[] = [];
      const counts = {translation: 0, rotation: 0, scale: 0};
      const channel = (joint: number, path: 'translation' | 'rotation' | 'scale', data: Float32Array, type: AccessorType) => {
        const output = b.data(data, type);
        channels.push({sampler: samplers.push({input, interpolation: 'LINEAR', output}) - 1, target: {node: FIRST_JOINT + joint, path}});
        counts[path]++;
      };
      // the full pose is baked for every graph bone; a reduced skeleton writes the surviving joints' channels
      joints.forEach((i, k) => {
        channel(k, 'translation', baked.translation[i]!, 'VEC3');
        channel(k, 'rotation', baked.rotation[i]!, 'VEC4');
        if (baked.scale[i]) channel(k, 'scale', baked.scale[i]!, 'VEC3');
      });
      if (reduction) bakedClips.push({motion: request.motion, keys: baked.times.length, translation: baked.translation, rotation: baked.rotation, scale: baked.scale});
      const travelSpeed = baked.travelSpeed;
      const report: ComposerBakedClipReport = {motion: request.motion, fps: clipFps, ...window, travelSpeed, channels: counts, ...(crossfade ? {crossfade} : {})};
      clipReports.push(report);
      const extras: Record<string, unknown> = {travelSpeed, seamless: window.seamless, seamPosition: window.seamPosition, seamAngle: window.seamAngle, seamScale: window.seamScale};
      if (crossfade) extras.crossfade = {blendSeconds: crossfade.blendSeconds, sourceStart: crossfade.sourceStart};
      animations.push({name: request.motion, channels, samplers, extras: {composer: extras}});
    }

    // ---- the pre-registered skin-error bound of a reduced skeleton (level 0, every key of every baked clip)
    let skinError: ComposerExportSkeletonReport['skinError'] = null;
    if (reduction) {
      const sb = componentBounds(skin.positions, 3);
      const diagonal = Math.sqrt((sb.max[0]! - sb.min[0]!) ** 2 + (sb.max[1]! - sb.min[1]!) ** 2 + (sb.max[2]! - sb.min[2]!) ** 2);
      const fullRows = gltfSkinRows(fullLevel0.skinIndex, fullLevel0.skinWeight);
      const e = composerSkeletonSkinError(levels[0]!.positions, fullRows, written[0]!.rows, joints, ibmAll, bakedClips);
      const fraction = e.max / diagonal;
      skinError = {max: e.max, diagonal, fraction, bound: COMPOSER_SKELETON_SKIN_ERROR_BOUND, vertex: e.vertex, motion: e.motion, key: e.key, verticesChecked: e.verticesChecked, keys: e.keys,
        pass: fraction <= COMPOSER_SKELETON_SKIN_ERROR_BOUND};
      if (!skinError.pass) throw new ComposerExportBudgetError(v2!.target, v2!.budget, [{code: 'skin-error', limit: COMPOSER_SKELETON_SKIN_ERROR_BOUND, actual: fraction}]);
    }

    const restBounds = componentBounds(levels[0]!.positions, 3) as {min: [number, number, number]; max: [number, number, number]};
    const meshes = levels.map((level, i) => ({
      name: i === 0 ? 'composer-skin' : `composer-skin-lod${i}`,
      primitives: [{attributes: written[i]!.attributes, indices: written[i]!.indices, material: 0, mode: GL.TRIANGLES}],
      extras: {composer: i === 0 && levels.length === 1 ? {parts: level.parts} : {parts: level.parts, lod: {level: i, target: level.target, triangles: level.index.length / 3}}},
    }));
    const glb = b.finish({
      asset: {version: '2.0', generator: `${COMPOSER_EXPORT_GENERATOR} ${exportVersion}`, extras: {composer: {recipeText, speciesKey: composerSpeciesKey(recipe), versions,
        ...(graph.phenotype ? {phenotype: graph.phenotype} : {}),
        ...(reduction ? {skeleton: {version: reduction.version, fullJoints: reduction.fullJoints, joints: reduction.joints, collapsed: reduction.collapsed.map(c => [c.joint, c.into])}} : {})}}},
      ...(levels.length > 1 ? {extensionsUsed: ['MSFT_lod']} : {}),
      scene: 0,
      scenes: [{name: rootName, nodes: [SKIN_NODE, ROOT_NODE]}],
      nodes,
      meshes,
      materials: [{name: 'composer-coloured', pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: graph.phenotype?.roughness ?? 0.82}}],
      skins: [{name: 'composer-skeleton', inverseBindMatrices: ibmAccessor, skeleton: ROOT_NODE, joints: joints.map((_, k) => FIRST_JOINT + k)}],
      ...(animations.length ? {animations} : {}),
    });
    const report: ComposerExportReport = {
      version: exportVersion, recipeText, speciesKey: composerSpeciesKey(recipe), versions,
      ...(graph.phenotype ? {phenotype: structuredClone(graph.phenotype)} : {}),
      individual: {deltas: creature.individual.deltas, effectiveRecipeText},
      axes: {units: 'metres', up: '+Y', handedness: 'right', forward},
      mesh: {vertices: levels[0]!.vertexCount, triangles: levels[0]!.index.length / 3, bones: jointCount, parts, restBounds},
      gloss, repairs: {weightRows: rows.rows, maxWeightChange: rows.maxChange, zeroNormals}, clips: clipReports, glbBytes: glb.byteLength,
    };
    if (v2) {
      report.target = v2.target;
      report.lods = levels.map((level, i) => {
        const r = level.reduced;
        return {level: i, target: level.target, triangles: level.index.length / 3, vertices: level.vertexCount, reached: r ? r.reached : true,
          node: i === 0 ? SKIN_NODE : FIRST_LOD_NODE + i - 1, mesh: i, screenCoverage: coverage[i]!,
          relaxation: r?.stats.relaxation ?? 0, mirrorKept: r?.stats.mirrorKept ?? 1, maxWeightChange: r?.stats.maxWeightChange ?? 0, maxPlaneError: r?.stats.maxPlaneError ?? 0,
          parts: level.parts, sourceVertex: r ? r.sourceVertex : Uint32Array.from({length: level.vertexCount}, (_, v) => v)};
      });
      report.budget = {target: v2.target, limits: v2.budget, actual: budgetActual, pass: true};
      const into = reduction ? reduction.into : joints;
      report.skeleton = {version: COMPOSER_SKELETON_VERSION, fullJoints: n, joints: jointCount, reduced: !!reduction, stage: reduction?.stage ?? null,
        collapsed: reduction ? reduction.collapsed : [], mapping: graph.bones.map((bone, j) => [bone.name, graph.bones[into[j]!]!.name]), survivors: [...joints], skinError};
    }
    return {glb, report};
  } finally {
    creature.dispose();
  }
}
