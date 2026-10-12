import * as THREE from 'three';
import {composerConstraints, composerWingSpanLimit, normalizeComposerRecipe, type ComposerConstraint, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {composerIndividualTraits, type ComposerIndividualTraits} from './fauna-composer-individual.ts';
import {cloneComposerBuildPhenotype, assertComposerResolvedRecipe, type ComposerBuildPhenotype} from './fauna-composer-phenotype.ts';
import {COMPOSER_FACE_GEOMETRY, PROBOSCIS_TRUNK_BASE, PROBOSCIS_TRUNK_LENGTH, composerFaceTip, composerHeadPitch, composerTrunkRadius, composerTrunkRestShape} from './fauna-composer-face-geometry.ts';

/** Variable articulated body-plan graph for the modular composer. It is
 * deliberately separate from the fixed 22-bone quadruped rig: limbless,
 * biped, quadruped, sprawled and many-legged plans each get their own bones.
 * Every bone has an explicit parent, rest length and bind frame (local +X
 * along the bone, +Y dorsal). Creature space: metres, +X forward, +Y up,
 * +Z to the animal's right, ground at y = 0. */
export const COMPOSER_GRAPH_VERSION = 'fauna-composer-graph-4';
export const COMPOSER_TRUNK_MOTION_VERSION = 'fauna-composer-trunk-motion-1';
export interface ComposerGroundContact {position: Vec3; normal?: Vec3; forward?: Vec3; pitch?: number; stance?: boolean}
/** Optional caller-owned terrain/path context. The same Composer IK handles
 * authored previews and dated planetary movement; no world controller is imported. */
export interface ComposerPoseEnvironment {
  cycle?: number; clock?: number; stride?: number; speed?: number; cycleLength?: number;
  /** Closed-form startup/settling blend; omitted on unchanged authored clips. */
  walkWeight?: number; idleWeight?: number;
  rootHeight?: number; rootRotation?: Quat;
  /** Fit vertical support to the exact two-bone reach intervals of all requested
   * leg targets. Leaves the caller's X/Z anchor and every foot target intact. */
  supportHeight?: 'reachable-1';
  ground?: (x: number, z: number) => number;
  contact?: (limb: ComposerLimb, phase: number, stance: boolean, target: Vec3) => ComposerGroundContact;
}
export interface ComposerPoseOptions {trunkMotion?: 'legacy' | 'wave-1'; environment?: ComposerPoseEnvironment}
/** Desktop preview budget. Not a Quest qualification. */
export const COMPOSER_BUDGET = Object.freeze({maxBones: 160, maxVertices: 48000, maxTriangles: 80000, drawCallsPerCreature: 2});
export const COMPOSER_MOTIONS = ['neutral', 'idle', 'walk', 'display'] as const;
export type ComposerMotion = typeof COMPOSER_MOTIONS[number];
export type ComposerPart = 'torso' | 'tail' | 'neck' | 'head' | 'trunk' | 'leg' | 'foot' | 'arm' | 'hand' | 'finger' | 'wing';
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
/** Elliptical cross-section (half width along local Z, half height along local Y, centre offset along Y). */
export interface ComposerSection {w: number; h: number; yc: number}
export interface ComposerBone {
  index: number; name: string; parent: number; part: ComposerPart; side: -1 | 0 | 1; limb: number;
  length: number; driver: 'fk' | 'ik';
  /** Origin in the parent frame (creature space for the root). */
  offset: Vec3;
  /** Rotation relative to the parent at bind. */
  restLocal: Quat;
  restPosition: Vec3; restQuaternion: Quat;
  /** Cross-sections at the bone start and end, used for skin and ground clearance. */
  start: ComposerSection; end: ComposerSection;
}
export type ComposerLimbKind = 'leg' | 'arm' | 'wing';
export interface ComposerLimb {
  index: number; kind: ComposerLimbKind; side: -1 | 1; pair: number; front: boolean;
  /** Body bone carrying the socket, and the socket in that bone's frame. */
  socketBone: number; socket: Vec3;
  /** Bone indices root to tip. Legs: upper, lower, [meta], foot. Arms: upper, fore, hand, finger. Wings: humerus, forearm, hand. */
  bones: number[]; segments: number[];
  /** Knee/elbow pole in the body heading frame. */
  pole: Vec3;
  /** Metapodial tilt for three-segment legs (radians, top behind the foot). */
  metaTilt: number;
  footHeight: number; footLength: number;
  /** Legs: foot geometry contract in the foot bone frame (metres behind and ahead of the ankle). The skin keeps every
   * foot vertex inside x in [-back, front] and y >= -footHeight, and swing pitch is limited by the current lift so the
   * rotated sole cannot pass below the floor. Zero for arms and wings. */
  footExtent: [number, number];
  /** Rest ground contact in creature space (legs) or rest hand target (arms). */
  rest: Vec3;
  phase: number;
}
export interface ComposerLocomotion {
  gait: 'biped-walk' | 'quadruped-walk' | 'sprawling-walk' | 'metachronal-wave' | 'serpentine-crawl' | 'peristaltic-crawl';
  period: number; duty: number; stride: number; speed: number; lift: number;
  /** Vertical body bob amplitude (m) while walking. */
  bob: number;
  /** Lateral spine undulation amplitude per torso joint (radians) while walking. */
  sway: number;
}
export interface ComposerGraph {
  version: typeof COMPOSER_GRAPH_VERSION;
  /** Additive, explicit measured-anatomy input. Absent on historical graphs. */
  phenotype?: ComposerBuildPhenotype;
  /** Numeric fit audit exists only for explicitly resolved phenotypes. */
  phenotypeFit?: ComposerPhenotypeFit;
  recipe: ComposerRecipe;
  constraints: ComposerConstraint[];
  bones: ComposerBone[];
  limbs: ComposerLimb[];
  chains: {torso: number[]; tail: number[]; neck: number[]; head: number; trunk: number[]};
  dims: {
    bodyLength: number; torsoWidth: number; torsoHeight: number; legReach: number; frontLegReach: number; socketHeight: number;
    headLength: number; craniumWidth: number; craniumHeight: number; snoutLength: number; neckLength: number; tailLength: number; trunkLength: number;
    wingSemiSpan: number; armLength: number; legRadius: number; armRadius: number; torsoPitch: number;
  };
  locomotion: ComposerLocomotion;
  /** The individual this graph was built for (composerIndividualTraits of the effective recipe). poseComposer reads its
   * motion desync (phase, period, duty, lift, breathing and look phases); the build reads limb robustness, leg segment
   * jitter, torso profile terms and carriage. Neutral traits build the version-1 rest skeleton bit for bit. */
  traits: ComposerIndividualTraits;
}
export interface ComposerPhenotypeFitEntry {field:string;requested:number;built:number;units:'m'|'m/s'|'s'|'ratio';reason:string}
export interface ComposerPhenotypeFit {version:'composer-phenotype-fit-1';entries:ComposerPhenotypeFitEntry[];deviations:ComposerPhenotypeFitEntry[];derived:{snoutToHeadRatio:number;craniumHeightToWidthRatio:number;footHeightToWidthRatio:number;neckBones:number}}
/** A leg's ground support. `contact` is the sole point under the foot in the centred display frame;
 * `world` adds the walk's travel along +X. `extension` is socket-to-hock distance / (upper + lower). */
export interface ComposerContact {limb: number; side: -1 | 1; pair: number; stance: boolean; contact: Vec3; world: Vec3; reachError: number; extension: number}
export interface ComposerPose {
  motion: ComposerMotion; time: number;
  positions: Float64Array; quaternions: Float64Array;
  /** Radial (Y/Z) bone scale for breathing and peristalsis; bone lengths are never scaled. */
  radialScale: Float64Array;
  /** Extra local-Z scale on top of `radialScale`; folded wings furl their membrane chord toward the leading-edge spar. */
  chordScale: Float64Array;
  travel: number; contacts: ComposerContact[];
  diagnostics: {maxBoneLengthError: number; maxReachError: number; maxStancePenetration: number; minSwingClearance: number; minBodyClearance: number; jointCount: number;
    supportHeight?: {version:'composer-support-height-1';requested:number;applied:number;delta:number;feasible:boolean;intervals:[number,number][]}};
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (lo: number, hi: number, v: number) => { const t = clamp((v - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = Object.freeze(V(0, 1, 0)), FWD = Object.freeze(V(1, 0, 0));
const arr3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
const arr4 = (q: THREE.Quaternion): Quat => [q.x, q.y, q.z, q.w];
const v3 = (a: readonly number[]) => V(a[0], a[1], a[2]);
const q4 = (a: readonly number[]) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
const axisQ = (axis: THREE.Vector3, angle: number) => new THREE.Quaternion().setFromAxisAngle(axis, angle);
const X_AXIS = V(1, 0, 0), Y_AXIS = V(0, 1, 0), Z_AXIS = V(0, 0, 1);
/** Resting bodies sit this far above the floor (0.02 mm) so contact is not numerically negative. */
const GROUND_EPSILON = 2e-5;
/** Stance legs never exceed this fraction of upper+lower length, so planted feet are always reachable. */
export const COMPOSER_MAX_STANCE_EXTENSION = 0.985;

/** Frame with +X along `dir` and +Y as close as possible to `upRef`. */
export function composerFrame(dir: THREE.Vector3, upRef: THREE.Vector3): THREE.Quaternion {
  const x = dir.clone().normalize();
  let y = upRef.clone().addScaledVector(x, -upRef.dot(x));
  if (y.lengthSq() < 1e-10) { y = Math.abs(x.y) < 0.9 ? UP.clone() : V(-Math.sign(x.y) || -1, 0, 0); y.addScaledVector(x, -y.dot(x)); }
  y.normalize();
  const z = V().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
/** Two-bone IK: joint position for segments a,b from root to target bending toward pole. */
export function composerTwoBone(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): {joint: THREE.Vector3; end: THREE.Vector3; reachError: number} {
  const delta = target.clone().sub(root), raw = delta.length();
  const d = clamp(raw, Math.abs(a - b) + 1e-6, a + b - 1e-6);
  const u = raw > 1e-9 ? delta.multiplyScalar(1 / raw) : V(0, -1, 0);
  const along = (a * a - b * b + d * d) / (2 * d), across = Math.sqrt(Math.max(0, a * a - along * along));
  let p = pole.clone().addScaledVector(u, -pole.dot(u));
  if (p.lengthSq() < 1e-10) p = Math.abs(u.y) < 0.9 ? UP.clone().addScaledVector(u, -u.y) : FWD.clone().addScaledVector(u, -u.x);
  p.normalize();
  const joint = root.clone().addScaledVector(u, along).addScaledVector(p, across);
  const end = root.clone().addScaledVector(u, d);
  return {joint, end, reachError: Math.abs(raw - d)};
}

const TORSO: Record<ComposerRecipe['torso'], {w: number; h: number}> = {
  slim: {w: 0.13, h: 0.16}, barrel: {w: 0.2, h: 0.2}, 'deep-chest': {w: 0.15, h: 0.2}, flat: {w: 0.24, h: 0.12}, annulated: {w: 0.1, h: 0.1}, segmented: {w: 0.15, h: 0.1},
};
const LEG: Record<ComposerRecipe['legs'], {seg: number[]; tilt: number; ext: number}> = {
  pillar: {seg: [0.5, 0.5], tilt: 0, ext: 0.94},
  plantigrade: {seg: [0.5, 0.46], tilt: 0, ext: 0.92},
  digitigrade: {seg: [0.36, 0.38, 0.26], tilt: 0.38, ext: 0.9},
  unguligrade: {seg: [0.3, 0.34, 0.36], tilt: 0.12, ext: 0.93},
  arthropod: {seg: [0.45, 0.55], tilt: 0, ext: 0.8},
};
const FOOT: Record<ComposerRecipe['feet'], {h: number; l: number}> = {
  hoof: {h: 0.07, l: 0.1}, paw: {h: 0.045, l: 0.14}, claw: {h: 0.03, l: 0.24}, pad: {h: 0.08, l: 0.16}, hand: {h: 0.04, l: 0.26}, spike: {h: 0.1, l: 0.03},
};

interface Builder {bones: ComposerBone[]}
function addBone(b: Builder, spec: {name: string; parent: number; part: ComposerPart; side?: -1 | 0 | 1; limb?: number; length: number; driver?: 'fk' | 'ik'; position: THREE.Vector3; quaternion: THREE.Quaternion; start: ComposerSection; end?: ComposerSection}): number {
  const parent = spec.parent >= 0 ? b.bones[spec.parent]! : undefined;
  const pq = parent ? q4(parent.restQuaternion) : new THREE.Quaternion(), pp = parent ? v3(parent.restPosition) : V();
  const inv = pq.clone().invert();
  const offset = spec.position.clone().sub(pp).applyQuaternion(inv);
  const local = inv.multiply(spec.quaternion.clone()).normalize();
  const index = b.bones.length;
  b.bones.push({index, name: spec.name, parent: spec.parent, part: spec.part, side: spec.side ?? 0, limb: spec.limb ?? -1, length: spec.length, driver: spec.driver ?? 'fk',
    offset: arr3(offset), restLocal: arr4(local), restPosition: arr3(spec.position), restQuaternion: arr4(spec.quaternion.clone().normalize()), start: spec.start, end: spec.end ?? spec.start});
  return index;
}
const sec = (w: number, h: number, yc = 0): ComposerSection => ({w, h, yc});
const boneEnd = (bone: ComposerBone) => v3(bone.restPosition).add(V(bone.length, 0, 0).applyQuaternion(q4(bone.restQuaternion)));
const toBone = (bone: ComposerBone, local: Vec3) => v3(local).applyQuaternion(q4(bone.restQuaternion)).add(v3(bone.restPosition));

/** Builds the bind-pose graph. Pure and deterministic. */
export function buildComposerGraph(input: ComposerRecipe, options: {phenotype?: ComposerBuildPhenotype} = {}): ComposerGraph {
  const recipe = normalizeComposerRecipe(input).recipe;
  const phenotype = options.phenotype ? cloneComposerBuildPhenotype(options.phenotype) : undefined, measured = phenotype?.dimensions;
  if (phenotype) assertComposerResolvedRecipe(recipe);
  const constraints = composerConstraints(recipe);
  // The individual: rest-pose terms below are exact identities (x * 1, x + 0) for neutral traits.
  const traits = composerIndividualTraits(recipe), variability = recipe.variability;
  const b: Builder = {bones: []};
  const layout = recipe.layout, L = measured?.bodyLength ?? recipe.bodyLength;
  const axialLong = layout === 'limbless' || layout === 'many-legged';
  const legged = layout !== 'limbless';
  const sprawl = layout === 'sprawled' || (legged && recipe.legs === 'arthropod');
  const shape = TORSO[recipe.torso], radial = (axialLong ? 0.42 : 1) * recipe.girth * L;
  let w = measured ? measured.torsoWidth / 2 : shape.w * radial, h = measured ? measured.torsoHeight / 2 : shape.h * radial;
  const scaleBody = Math.cbrt(L * w * h);
  // per-face skull proportions (fauna-composer-face-geometry-1): the legacy faces keep their graph-2 numbers
  const face = recipe.head, faceGeo = COMPOSER_FACE_GEOMETRY[face];
  const headLength = measured?.headLength ?? recipe.headSize * faceGeo.headScale * scaleBody * (axialLong ? 1 : 1.25);
  const craniumH = measured ? measured.headWidth / (2 * faceGeo.craniumWidth) : headLength * faceGeo.craniumHeight;
  const craniumW = measured ? measured.headWidth / 2 : craniumH * faceGeo.craniumWidth;
  const snoutLength = headLength * recipe.snoutLength * faceGeo.snout;

  // ---- legs: dimensions decide body height
  let legReach = legged ? measured?.legReach ?? recipe.legLength * L : 0;
  if (layout === 'many-legged' && recipe.legs !== 'arthropod') legReach = Math.min(legReach, 0.45 * L);
  const inheritedLegSpec = LEG[recipe.legs], footSpec = FOOT[recipe.feet];
  const metaShare = inheritedLegSpec.seg[2] ?? 0;
  const legSpec = measured ? {...inheritedLegSpec, seg: [measured.upperLegFraction * (1 - metaShare), (1 - measured.upperLegFraction) * (1 - metaShare), ...(metaShare ? [metaShare] : [])]} : inheritedLegSpec;
  // Individual segment proportions: each segment fraction x (1 + jitter), renormalised to the original sum so the
  // leg's reach is unchanged. Fore and hind legs jitter independently.
  const jitteredSeg = (jitter: readonly number[]): number[] => {
    if (legSpec.seg.every((_, k) => jitter[k] === 0)) return legSpec.seg;
    const raw = legSpec.seg.map((f, k) => f * (1 + jitter[k]!)), sum0 = legSpec.seg.reduce((a, x) => a + x, 0), sum1 = raw.reduce((a, x) => a + x, 0);
    return raw.map(f => f * sum0 / sum1);
  };
  const segFore = jitteredSeg(traits.segmentJitter.fore), segHind = jitteredSeg(traits.segmentJitter.hind);
  const segs = (reach: number, fore = false) => (fore ? segFore : segHind).map(f => f * reach);
  // Individual metapodial tilt (three-segment legs): +-0.04 rad per unit of the limb latent.
  const hindTilt = legSpec.tilt + (legSpec.seg.length === 3 ? 0.04 * variability * traits.limb : 0);
  const footHeight = (reach: number) => measured ? measured.footWidth * .42 : footSpec.h * reach, footLength = (reach: number) => measured?.footLength ?? footSpec.l * reach;
  /** Socket height above ground for a leg of `reach` at rest, and lateral foot offset. */
  const legRest = (reach: number, fore = false) => {
    const s = segs(reach, fore), two = s[0]! + s[1]!, meta = s[2] ?? 0, tilt = sprawl ? 0 : hindTilt;
    if (sprawl) { const lateral = 0.55 * two, ext = 0.8 * two; return {height: footHeight(reach) + meta + Math.sqrt(ext * ext - lateral * lateral), lateral}; }
    const back = meta * Math.sin(tilt), ext = legSpec.ext * two;
    const lateral = measured ? Math.max(0, measured.stanceWidth / 2 - .68 * w * .85) : 0;
    return {height: footHeight(reach) + meta * Math.cos(tilt) + Math.sqrt(Math.max(0, ext * ext - back * back - lateral * lateral)), lateral: 0};
  };
  const legRestHeightPerReach = legged ? legRest(1, true).height : 0;

  // ---- axial chain counts and lengths
  const nTorso = layout === 'many-legged' ? recipe.legPairs : layout === 'limbless' ? 12 : 4;
  const torsoLength = layout === 'many-legged' ? L * 0.88 : layout === 'limbless' ? L * 0.8 : L;
  const segLen = torsoLength / nTorso;
  const neckLength = measured?.neckLength ?? (layout === 'limbless' ? L * (0.12 + 0.1 * recipe.neckLength) : layout === 'many-legged' ? Math.max(0.25 * segLen, recipe.neckLength * 0.3 * L) : Math.max(0.05 * L, recipe.neckLength * 0.9 * L));
  const nNeck = layout === 'limbless' ? 2 : clamp(Math.round(1 + recipe.neckLength * 3.4), 1, 6);
  const tailLength = recipe.tail === 'none' ? 0 : measured?.tailLength ?? (recipe.tail === 'stub' ? L * (0.08 + 0.08 * recipe.tailLength) * (axialLong ? 0.5 : 1)
    : Math.max(0.1 * L, recipe.tailLength * L * (axialLong ? 0.4 : 1)) * (recipe.tail === 'feather-fan' ? 0.25 : 1));
  const nTail = recipe.tail === 'none' ? 0 : recipe.tail === 'stub' || recipe.tail === 'feather-fan' ? 2 : recipe.tail === 'tufted' ? 5 : 7;

  // Individual torso profile terms (latents already scaled by variability): a deeper or shallower brisket, a sagging
  // or tucked belly (plus body condition), a heavier or lighter rump and a tucked or full waist. Depth terms move the
  // ventral line only, so the topline (and the mesh-side withers lobe) keeps its shape.
  const lobe = traits.torso, condition = traits.condition;
  const shaped = lobe.chest !== 0 || lobe.belly !== 0 || lobe.rump !== 0 || lobe.waist !== 0 || condition !== 0;
  const bump = (u: number, centre: number, sigma: number) => Math.exp(-0.5 * ((u - centre) / sigma) ** 2);
  // torso profile, rear (u=0) to front (u=1)
  const profile = (u: number): ComposerSection => {
    let wm = 1, hm = 1, yc = 0;
    if (recipe.torso === 'segmented' || recipe.torso === 'annulated') { const e = recipe.torso === 'annulated' ? 0.72 : 0.82; wm = hm = mix(e, 1, smooth(0, 0.2, u)) * mix(0.86, 1, smooth(1, 0.82, u)); }
    else {
      const body = 0.8 + 0.2 * Math.sin(Math.PI * clamp(u * 1.08, 0, 1));
      wm = body * (recipe.torso === 'deep-chest' ? mix(0.88, 1.02, u) : 1);
      hm = body * (recipe.torso === 'deep-chest' ? 0.8 + 0.4 * smooth(0.3, 0.75, u) - 0.12 * smooth(0.9, 1, u) : 1);
      yc = recipe.torso === 'deep-chest' ? -0.14 * h * smooth(0.35, 0.8, u) : recipe.torso === 'barrel' ? -0.04 * h : 0;
      if (recipe.tail === 'none' && u < 0.12) { wm *= mix(0.82, 1, u / 0.12); hm *= mix(0.86, 1, u / 0.12); }
      // an upright body with arms gets a shoulder girdle, so the arms hang from lateral shoulders, not beside the neck
      if (layout === 'biped' && recipe.arms !== 'none') wm *= 1 + 0.22 * smooth(0.55, 0.8, u) * (1 - 0.6 * smooth(0.9, 1, u));
      if (shaped) {
        hm *= 1 + 0.06 * lobe.rump * bump(u, 0.1, 0.1);
        wm *= 1 - 0.08 * lobe.waist * bump(u, 0.3, 0.1);
        // ventral drop as a fraction of the section's depth: brisket at u 0.7-0.9, belly sag at mid-body
        const drop = Math.max(-0.3, 0.1 * lobe.chest * bump(u, 0.8, 0.08) + (0.08 * lobe.belly + 0.04 * condition) * bump(u, 0.5, 0.2)) * h * hm;
        return sec(w * wm, h * hm + drop / 2, yc - drop / 2);
      }
    }
    return sec(w * wm, h * hm, yc);
  };

  // ---- body pitch and placement
  let pitch = 0;
  if (layout === 'biped') pitch = mix(0.21, 1.36, recipe.posture);
  else if (layout === 'quadruped') pitch = recipe.posture * 0.24;
  const hipSocketLocal = (side: number): Vec3 => { const s = profile(0.5 / nTorso); return [0.5 * segLen, (sprawl ? -0.2 : -0.35) * s.h + s.yc, side * 0.68 * s.w]; };
  const shoulderSocketLocal = (side: number): Vec3 => { const s = profile(1 - 0.65 / nTorso); return [0.35 * segLen, (sprawl ? -0.18 : -0.3) * s.h + s.yc, side * 0.68 * s.w]; };
  const segmentSocketLocal = (i: number, side: number): Vec3 => { const s = profile((i + 0.5) / nTorso); return [0.5 * segLen, -0.25 * s.h + s.yc, side * 0.8 * s.w]; };

  const rootQ = axisQ(Z_AXIS, pitch);
  let socketHeight = 0, frontLegReach = legReach;
  const root = V(-torsoLength * 0.5 * Math.cos(pitch), 0, 0);
  if (!legged) root.y = profile(0.5).h - profile(0.5).yc;
  else {
    socketHeight = legRest(legReach).height;
    const local = layout === 'many-legged' ? segmentSocketLocal(0, 1) : hipSocketLocal(1);
    root.y = socketHeight - v3(local).applyQuaternion(rootQ).y;
    if (layout === 'biped') root.x = -0.5 * segLen * Math.cos(pitch);
  }
  // Ground clearance: shrink torso depth (reported) if short legs would bury the belly.
  // Support of a pitched elliptical section is centreY - (h - yc) * cos(pitch); the margin covers gait bob, roll and breathing.
  if (legged) {
    const originalH = h, margin = () => Math.max((sprawl ? 0.06 : 0.15) * socketHeight, 0.04 * h);
    const placeRoot = () => { const local = layout === 'many-legged' ? segmentSocketLocal(0, 1) : hipSocketLocal(1); root.y = socketHeight - v3(local).applyQuaternion(rootQ).y; };
    const allowed = () => { let f = Infinity; for (let i = 0; i <= 16; i++) { const u = i / 16, s = profile(u); f = Math.min(f, (root.y + u * torsoLength * Math.sin(pitch) - margin()) / Math.max(1e-6, (s.h - s.yc) * Math.cos(pitch))); } return f; };
    const originalReach = legReach;
    if(measured&&allowed()<1){
      // Only the measured branch: find the smallest reach that clears the
      // unchanged torso, instead of rounding up to a 20% multiplicative step.
      const testReach=(reach:number)=>{legReach=reach;socketHeight=legRest(reach).height;placeRoot();return allowed()>=1;};
      let lo=originalReach,hi=originalReach;
      for(let k=0;k<24&&!testReach(hi);k++)hi*=2;
      if(!testReach(hi))throw new Error('Resolved torso cannot clear ground within the bounded leg fitter');
      for(let k=0;k<44;k++){const mid=(lo+hi)/2;if(testReach(mid))hi=mid;else lo=mid;}
      testReach(hi);
    }
    for (let k = 0; !measured&&k < 24; k++) {
      const f = allowed(); if (f >= 1) break;
      // modest depth reduction first; a body that would need more is raised on longer legs instead
      if (!measured && h * f >= originalH * 0.6) h *= Math.min(f, 0.995);
      else { legReach *= 1.2; socketHeight = legRest(legReach).height; }
      placeRoot();
    }
    if (legReach > originalReach * 1.001) constraints.push({part: 'Leg length', chosen: recipe.legLength.toFixed(2), effect: `Lengthened to ${(legReach / L).toFixed(2)} body lengths so the body clears the ground.`});
    if (h < originalH * 0.995) constraints.push({part: 'Torso depth', chosen: recipe.torso, effect: `Reduced to ${(h / originalH * 100).toFixed(0)}% so the belly clears the ground on these leg lengths.`});
  }

  // ---- torso bones
  const torso: number[] = [];
  const torsoDir = V(1, 0, 0).applyQuaternion(rootQ);
  const restOnBelly = (u: number) => { const p = profile(u); return p.h - p.yc + GROUND_EPSILON; };
  let cursor = root.clone();
  if (!legged) cursor.y = restOnBelly(0);
  for (let i = 0; i < nTorso; i++) {
    let dir = torsoDir.clone();
    if (!legged) { const dy = restOnBelly((i + 1) / nTorso) - cursor.y; dir = V(Math.sqrt(segLen * segLen - dy * dy), dy, 0).normalize(); }
    torso.push(addBone(b, {name: `torso_${i}`, parent: i ? torso[i - 1]! : -1, part: 'torso', length: segLen, position: cursor.clone(), quaternion: legged ? rootQ.clone() : composerFrame(dir, UP), start: profile(i / nTorso), end: profile((i + 1) / nTorso)}));
    cursor = cursor.clone().addScaledVector(dir, segLen);
  }
  const front = b.bones[torso[nTorso - 1]!]!;
  const neckBase = boneEnd(front);
  const frontSec = profile(1);

  // ---- tail (rest pitches are world-space, then converted to parent-relative rotations)
  const tail: number[] = [];
  if (nTail) {
    const rump = profile(0), baseR = Math.min(rump.w, rump.h);
    const thick = recipe.tail === 'reptile' || recipe.tail === 'club' ? 0.78 : recipe.tail === 'tufted' ? 0.22 : recipe.tail === 'feather-fan' ? 0.5 : 0.55;
    const tipR = recipe.tail === 'reptile' ? 0.06 : recipe.tail === 'club' ? 0.16 : recipe.tail === 'tufted' ? 0.09 : 0.3;
    let droop0 = layout === 'biped' ? (recipe.posture > 0.6 ? -1.0 : -0.05 - pitch * 0.4) : layout === 'quadruped' ? (recipe.tail === 'tufted' ? -1.05 : -0.35) : -0.08;
    if (axialLong) droop0 = -0.02;
    else droop0 += traits.carriage.tail; // individual tail carriage (raised or hanging); the rest clearance below still applies
    const droopStep = layout === 'biped' && recipe.posture > 0.6 ? 0.18 : recipe.tail === 'tufted' ? -0.06 : axialLong ? 0 : -0.07;
    // the tail starts where torso_0 actually starts (a limbless torso is re-seated on its belly)
    let pos = v3(b.bones[torso[0]!]!.restPosition), tl = tailLength / nTail;
    for (let i = 0; i < nTail; i++) {
      const droop = droop0 + droopStep * i;
      const dir = V(-Math.cos(droop), Math.sin(droop), 0);
      const q = composerFrame(dir, UP);
      const r0 = baseR * mix(i === 0 ? 1 : thick, tipR, Math.pow(i / nTail, 0.85)) / (i === 0 ? 1 : 1), r1 = baseR * mix(thick, tipR, Math.pow((i + 1) / nTail, 0.85));
      const s0 = i === 0 ? sec(rump.w, rump.h, rump.yc) : sec(r0 * 1.04, r0, 0);
      tail.push(addBone(b, {name: `tail_${i}`, parent: i ? tail[i - 1]! : torso[0]!, part: 'tail', length: tl, position: pos.clone(), quaternion: q, start: s0, end: sec(r1 * 1.04, r1, 0)}));
      pos.addScaledVector(dir, tl);
      if (i === 0) tl = tailLength / nTail;
    }
    // keep rest tail above the ground
    resolveRestClearance(b, tail, composerTailTipBounds(recipe, L, b.bones[tail[tail.length - 1]!]!), 0.004 * L);
  }

  // ---- neck and head
  const neck: number[] = [];
  // long axial bodies (centipede, worm) carry the head on a broad neck so the body flows into it without a step
  const headNeckR = Math.min(craniumW, craniumH) * (axialLong ? 0.8 : 0.62);
  const neckBaseR = Math.max(Math.min(frontSec.w, frontSec.h) * (axialLong ? 1 : 0.62), headNeckR);
  let neckElev0: number, neckElev1: number, headPitch = composerHeadPitch(face, layout, recipe.posture);
  if (layout === 'limbless') { neckElev0 = 0.32; neckElev1 = 0.18; }
  else if (layout === 'many-legged') { neckElev0 = 0.05; neckElev1 = 0.02; }
  else {
    const e = mix(0.12, 1.25, clamp(recipe.neckLength / 1.3, 0, 1));
    neckElev0 = Math.max(pitch, e); neckElev1 = Math.max(0.05, e * 0.75);
    if (layout === 'biped' && recipe.posture > 0.6) { neckElev0 = Math.max(pitch * 0.9, e); neckElev1 = Math.max(0.6, e); }
  }
  // individual carriage: a raised or lowered neck, and a head pitch that partly compensates (traits correlate them)
  neckElev0 += traits.carriage.neck; neckElev1 += traits.carriage.neck; headPitch += traits.carriage.headPitch;
  if (measured) neckElev0 = neckElev1 = measured.neckElevation;
  {
    let pos = neckBase.clone(); const nl = neckLength / nNeck;
    for (let i = 0; i < nNeck; i++) {
      const e = nNeck === 1 ? (neckElev0 + neckElev1) / 2 : mix(neckElev0, neckElev1, i / (nNeck - 1));
      const dir = V(Math.cos(e), Math.sin(e), 0), q = composerFrame(dir, UP);
      // Width and depth taper separately from the actual front section: a flattened body narrows into a round neck
      // gradually instead of dropping its full width within the first neck bone.
      const neckSec = (u: number): ComposerSection => {
        if (!axialLong) { const r = mix(neckBaseR, headNeckR, Math.pow(u, 0.8)); return sec(r * 1.02, r * 1.05, 0); }
        const e = smooth(0, 1, u);
        return sec(mix(frontSec.w, headNeckR * 1.02, e), mix(frontSec.h, headNeckR * 1.05, e), mix(frontSec.yc * 0.5, 0, e));
      };
      const s0 = i === 0 ? sec(frontSec.w * (axialLong ? 1 : 0.85), frontSec.h * (axialLong ? 1 : 0.85), frontSec.yc * 0.5) : neckSec(i / nNeck);
      neck.push(addBone(b, {name: `neck_${i}`, parent: i ? neck[i - 1]! : torso[nTorso - 1]!, part: 'neck', length: nl, position: pos.clone(), quaternion: q, start: s0, end: neckSec((i + 1) / nNeck)}));
      pos.addScaledVector(dir, nl);
    }
  }
  const neckEnd = boneEnd(b.bones[neck[neck.length - 1]!]!);
  const head = addBone(b, {name: 'head', parent: neck[neck.length - 1]!, part: 'head', length: headLength, position: neckEnd, quaternion: composerFrame(V(Math.cos(headPitch), Math.sin(headPitch), 0), UP), start: sec(craniumW, craniumH), end: sec(craniumW * 0.5, craniumH * 0.5)});
  if (layout === 'limbless') resolveRestClearance(b, [...neck, head]);

  // ---- trunk: a proboscis face's nose, growing from the face tip (composerFaceTip, shared with the skin), whose
  // section it continues: the skin's first trunk ring is the muzzle's last station. graph-4 (EC4): shorter
  // (PROBOSCIS_TRUNK_LENGTH), a fast taper from a thicker base (composerTrunkRadius), and a hanging rest shape whose
  // distal bones curl forward just enough to clear the ground (composerTrunkRestAngles) instead of lying on it
  const trunk: number[] = [];
  const trunkLength = recipe.trunk === 'trunk' ? measured?.trunkLength ?? recipe.trunkLength * PROBOSCIS_TRUNK_LENGTH * headLength : 0;
  if (trunkLength > 0) {
    const hb = b.bones[head]!, n = 6, tl = trunkLength / n;
    const tip = composerFaceTip(face, {headLength, craniumWidth: craniumW, craniumHeight: craniumH, snoutLength});
    const baseR = PROBOSCIS_TRUNK_BASE * Math.min(tip.w, tip.h), root = toBone(hb, [tip.x, tip.y, 0]);
    const radius = (i: number) => composerTrunkRadius(baseR, i / n);
    // the bone ends (and the rounded tip) for a curl; clear when every end stands above the deepest section touching
    // it, with resolveRestClearance's 5% margin
    const clear = (angles: number[]) => {
      const pos = root.clone();
      for (let i = 0; i < n; i++) {
        pos.addScaledVector(V(Math.cos(angles[i]!), Math.sin(angles[i]!), 0), tl);
        const floor = Math.max(radius(i), radius(i + 1), i + 1 < n ? radius(i + 1) : COMPOSER_TRUNK_TIP_CLEARANCE * radius(n)) * 1.05;
        if (pos.y < floor) return false;
      }
      return true;
    };
    const angles = composerTrunkRestShape(n, headPitch, clear);
    let pos = root;
    for (let i = 0; i < n; i++) {
      // the frame keeps its lateral axis +Z as the trunk curls past vertical (an UP reference flips it there, which
      // twisted the skin band at that joint half a turn: the 'plug' near the tip of graph-2 trunks)
      const dir = V(Math.cos(angles[i]!), Math.sin(angles[i]!), 0);
      const r0 = radius(i), r1 = radius(i + 1);
      trunk.push(addBone(b, {name: `trunk_${i}`, parent: i ? trunk[i - 1]! : head, part: 'trunk', length: tl, position: pos.clone(), quaternion: composerFrame(dir, V(-dir.y, dir.x, 0)), start: sec(r0, r0), end: sec(r1, r1)}));
      pos = pos.clone().addScaledVector(dir, tl);
    }
    // a last resort only: the curl above already clears the ground unless the face tip itself is too low
    resolveRestClearance(b, trunk);
  }

  // ---- limbs
  const limbs: ComposerLimb[] = [];
  // Limb robustness: allometric (thicker limbs for heavier animals, L^(0.09 allometry)) times the individual's build.
  // It scales the clamped species radius, so allometry acts even where the 0.055-0.16 x reach clamp binds.
  const limbScale = traits.allometry.limbRobust * traits.limbRadius;
  const legRadius = legged ? (recipe.legs === 'arthropod' ? 0.05 * legReach : clamp(0.42 * Math.min(w, h), 0.055 * legReach, 0.16 * legReach) * (recipe.legs === 'pillar' ? 1.3 : 1)) * limbScale : 0;
  let lengthened = false;
  const addLeg = (pair: number, side: -1 | 1, socketBone: number, socket: Vec3, reach: number, frontLimb: boolean, phase: number) => {
    const sock = toBone(b.bones[socketBone]!, socket);
    // Fore-limb conventions (elbow pole behind, upright metapodial, fore segment jitter) apply to the front pair of a
    // quadruped or sprawler. Every pair of a many-legged body is built alike, so its knees all bend the same way.
    const foreStyle = frontLimb && layout !== 'many-legged';
    let rest = legRest(reach, foreStyle);
    // Fit the actual socket height: narrow a sprawl, then lengthen the leg if the foot still cannot reach the ground.
    for (let k = 0; k < 8; k++) {
      const s2 = segs(reach, foreStyle), two = s2[0]! + s2[1]!, meta = s2[2] ?? 0, tilt = sprawl ? 0 : foreStyle ? 0 : hindTilt;
      const back = meta * Math.sin(tilt), dy = sock.y - (footHeight(reach) + meta * Math.cos(tilt)), limit = 0.95 * two;
      if (sprawl) rest = {...rest, lateral: Math.min(rest.lateral, Math.sqrt(Math.max(0, limit * limit - dy * dy - back * back)))};
      const lateral = measured ? measured.stanceWidth * .5 - Math.abs(sock.z) : sprawl ? rest.lateral : 0;
      if (Math.hypot(dy, back, lateral) <= limit * 1.0001) break;
      reach *= Math.min(1.5, Math.hypot(dy, back) / limit * 1.01); rest = legRest(reach, foreStyle); lengthened = true;
    }
    const s = segs(reach, foreStyle), fh = footHeight(reach), fl = footLength(reach);
    const r0 = legRadius * (frontLimb && layout === 'quadruped' ? 0.92 : 1);
    const radii = s.length === 3 ? [r0, r0 * 0.6, r0 * 0.36, r0 * 0.3] : recipe.legs === 'arthropod' ? [r0, r0 * 0.8, r0 * 0.5] : recipe.legs === 'pillar' ? [r0, r0 * 0.86, r0 * 0.8] : [r0, r0 * 0.66, r0 * 0.5];
    if (measured) radii[s.length] = measured.footWidth / (2 * 1.24);
    const radii0 = (i: number) => radii[i]!;
    // the thigh carries a proximal muscle mass that tapers to the knee (a drumstick, not a constant-width stalk)
    const thigh = r0 * composerLimbMass(recipe, 'leg');
    const contact = V(sock.x, 0, measured ? side * measured.stanceWidth * .5 : sprawl ? sock.z + side * rest.lateral : sock.z);
    const pole = sprawl ? V(0, 1, 0.35 * side) : foreStyle ? V(-1, 0, 0) : V(1, 0, 0);
    const tilt = sprawl ? 0 : foreStyle ? 0 : hindTilt;
    const limb: ComposerLimb = {index: limbs.length, kind: 'leg', side, pair, front: frontLimb, socketBone, socket, bones: [], segments: s, pole: arr3(pole), metaTilt: tilt, footHeight: fh, footLength: fl,
      footExtent: [0.45 * fl + 1.6 * radii0(s.length) + 0.3 * fh, 1.4 * fl + 1.6 * radii0(s.length) + 1.6 * fh], rest: arr3(contact), phase};
    const joints = solveLeg(limb, sock, contact, new THREE.Quaternion());
    const names = s.length === 3 ? ['upper', 'lower', 'meta'] : ['upper', 'lower'];
    let parent = socketBone;
    for (let i = 0; i < s.length; i++) {
      const bone = addBone(b, {name: `leg_${pair}_${side < 0 ? 'L' : 'R'}_${names[i]}`, parent, part: 'leg', side, limb: limb.index, length: s[i]!, driver: 'ik', position: joints.points[i]!, quaternion: joints.frames[i]!, start: i ? sec(radii[i]!, radii[i]!) : sec(thigh, thigh), end: sec(radii[i + 1]!, radii[i + 1]!)});
      limb.bones.push(bone); parent = bone;
    }
    limb.bones.push(addBone(b, {name: `leg_${pair}_${side < 0 ? 'L' : 'R'}_foot`, parent, part: 'foot', side, limb: limb.index, length: fl, driver: 'ik', position: joints.points[s.length]!, quaternion: joints.frames[s.length]!, start: sec(radii[s.length]!, fh)}));
    limbs.push(limb);
  };
  const locomotion = locomotionFor(recipe, legReach, socketHeight, legSpec, sprawl, L, traits);
  if (phenotype) {locomotion.stride = locomotion.duty * phenotype.motion.strideLength; locomotion.speed = phenotype.motion.walkSpeed; locomotion.period = phenotype.motion.strideLength / locomotion.speed;}
  if (layout === 'biped') {
    for (const side of [-1, 1] as const) addLeg(0, side, torso[0]!, hipSocketLocal(side), legReach, false, side < 0 ? 0 : 0.5);
  } else if (layout === 'quadruped' || layout === 'sprawled') {
    const frontSocket = toBone(front, shoulderSocketLocal(1));
    frontLegReach = layout === 'quadruped' ? clamp(frontSocket.y / legRestHeightPerReach, legReach * 0.5, legReach * 2) : legReach;
    if (measured && layout === 'quadruped') {
      let lo = 0, hi = Math.max(.001,legReach);
      for(let k=0;k<24&&legRest(hi,true).height<frontSocket.y;k++)hi*=2;
      if(legRest(hi,true).height<frontSocket.y)throw new Error('Resolved shoulder cannot reach ground within the bounded leg fitter');
      for (let i = 0; i < 40; i++) {const mid = (lo + hi) / 2; if (legRest(mid, true).height < frontSocket.y) lo = mid; else hi = mid;}
      frontLegReach = (lo + hi) / 2;
    }
    if (layout === 'quadruped' && Math.abs(frontLegReach - legReach) > 0.03 * legReach) constraints.push({part: 'Front legs', chosen: recipe.legLength.toFixed(2), effect: `${frontLegReach > legReach ? 'Lengthened' : 'Shortened'} to ${(frontLegReach / L).toFixed(2)} body lengths so both pairs reach the ground with this shoulder height.`});
    // Stance starts at phase 0 and phase = cycle + limb.phase, so a foot touches down at cycle = 1 - limb.phase.
    // Quadrupeds walk a lateral sequence (LH 0, LF 0.25, RH 0.5, RF 0.75), as most mammals and fauna-locomotion's
    // WALK_PHASE_OFFSETS do. Primate-like bodies (flat face, grasping hands, none of the horns or wings of a hybrid)
    // walk the primate diagonal sequence (LH 0, RF 0.25, RH 0.5, LF 0.75). Sprawlers move diagonal pairs together
    // (LH with RF, RH with LF). Index 0 is side -1 (left).
    // Still the recipe's horns field (not the built headgear): switching it would change gait for flat-face recipes
    // with an omitted horn, which this round keeps out of scope (bones change only for proboscis recipes).
    const primateLike = face === 'flat-face' && (recipe.arms === 'grasping' || recipe.feet === 'hand') && recipe.horns === 'none' && recipe.wings === 'none';
    const phases = layout === 'quadruped' ? {hind: [0, 0.5], fore: primateLike ? [0.25, 0.75] : [0.75, 0.25]} : {hind: [0.5, 0], fore: [0, 0.5]};
    for (const side of [-1, 1] as const) addLeg(0, side, torso[0]!, hipSocketLocal(side), legReach, false, phases.hind[side < 0 ? 0 : 1]!);
    for (const side of [-1, 1] as const) addLeg(1, side, torso[nTorso - 1]!, shoulderSocketLocal(side), frontLegReach, true, phases.fore[side < 0 ? 0 : 1]!);
  } else if (layout === 'many-legged') {
    const lag = 0.62 / Math.max(3, recipe.legPairs);
    for (let i = 0; i < nTorso; i++) for (const side of [-1, 1] as const) addLeg(i, side, torso[i]!, segmentSocketLocal(i, side), legReach, i >= nTorso / 2, ((i * lag + (side > 0 ? 0.5 : 0)) % 1 + 1) % 1);
  }

  // arms: biped forelimbs, or an extra non-walking pair at the front
  const armLength = recipe.arms === 'none' ? 0 : recipe.armLength * L * (recipe.arms === 'small' ? 0.55 : 1) * (axialLong ? 0.45 : 1);
  const armRadius = armLength ? clamp(0.3 * Math.min(w, h), 0.045 * armLength, 0.11 * armLength) * (recipe.arms === 'small' ? 0.8 : 1) * limbScale : 0;
  if (armLength > 0) {
    // shoulders sit on the body surface below the front end, so the arm and its proximal mass stay visible
    const carrier = b.bones[torso[nTorso - 1]!]!, s = profile((nTorso - 1 + 0.62) / nTorso);
    const local = (side: number): Vec3 => [carrier.length * 0.62, (layout === 'biped' ? 0.08 : -0.05) * s.h + s.yc, side * 0.9 * s.w];
    for (const side of [-1, 1] as const) {
      const segsA = [armLength * 0.45, armLength * 0.4, armLength * 0.09, armLength * 0.08];
      const sock = toBone(carrier, local(side));
      const limb: ComposerLimb = {index: limbs.length, kind: 'arm', side, pair: 0, front: true, socketBone: carrier.index, socket: local(side), bones: [], segments: segsA, pole: [-1, -0.2, 0.3 * side], metaTilt: 0, footHeight: 0, footLength: 0, footExtent: [0, 0], rest: [0, 0, 0], phase: side < 0 ? 0.5 : 0};
      limb.rest = arr3(armRestTarget(recipe, limb, sock));
      const solved = solveArm(limb, sock, v3(limb.rest), new THREE.Quaternion(), 0, 0.25);
      const names = ['upper', 'fore', 'hand', 'finger'];
      const radii = [armRadius * composerLimbMass(recipe, 'arm'), armRadius * 0.7, armRadius * 0.62, armRadius * 0.4, armRadius * 0.3];
      let parent = carrier.index;
      for (let i = 0; i < 4; i++) {
        const bone = addBone(b, {name: `arm_${side < 0 ? 'L' : 'R'}_${names[i]}`, parent, part: i < 2 ? 'arm' : i === 2 ? 'hand' : 'finger', side, limb: limb.index, length: segsA[i]!, driver: 'ik', position: solved.points[i]!, quaternion: solved.frames[i]!, start: sec(radii[i]!, radii[i]!), end: sec(radii[i + 1]!, radii[i + 1]!)});
        limb.bones.push(bone); parent = bone;
      }
      limbs.push(limb);
    }
  }

  // wings: rest/bind pose is spread so the skin is never folded in bind
  const wingSemiSpan = recipe.wings === 'none' ? 0 : measured ? measured.wingSpan / 2 : Math.min(recipe.wingSpan, composerWingSpanLimit(recipe)) * L * (axialLong ? 0.45 : 0.5);
  if (wingSemiSpan > 0) {
    const carrierIndex = layout === 'many-legged' || layout === 'limbless' ? torso[Math.max(0, Math.floor(nTorso * 0.7))]! : torso[nTorso - 1]!;
    const carrier = b.bones[carrierIndex]!, s = layout === 'many-legged' || layout === 'limbless' ? profile(0.75) : frontSec;
    const dome = recipe.armor === 'dome';
    // shoulder just inside the dorsolateral body surface (or on the shell rim)
    const local = (side: number): Vec3 => [carrier.length * (layout === 'biped' ? 0.62 : 0.4), dome ? 0.25 * s.h + s.yc : 0.7 * s.h + s.yc, side * (dome ? 1.05 : 0.6) * s.w];
    const lengths = [0.28, 0.34, 0.38].map(f => f * wingSemiSpan);
    for (const side of [-1, 1] as const) {
      const limb: ComposerLimb = {index: limbs.length, kind: 'wing', side, pair: 0, front: true, socketBone: carrierIndex, socket: local(side), bones: [], segments: lengths, pole: [0, 1, 0], metaTilt: 0, footHeight: 0, footLength: 0, footExtent: [0, 0], rest: [0, 0, 0], phase: 0};
      let pos = toBone(carrier, local(side)), parent = carrierIndex;
      const dirs = [V(-0.18, 0.22, side), V(-0.2, 0.04, side), V(-0.42, -0.04, side)];
      const radius = Math.max(0.012 * wingSemiSpan, Math.min(w, h) * 0.16);
      ['humerus', 'forearm', 'hand'].forEach((name, i) => {
        const dir = dirs[i]!.normalize();
        const bone = addBone(b, {name: `wing_${side < 0 ? 'L' : 'R'}_${name}`, parent, part: 'wing', side, limb: limb.index, length: lengths[i]!, position: pos.clone(), quaternion: composerFrame(dir, UP), start: sec(radius * (1 - i * 0.28), radius * (1 - i * 0.28)), end: sec(radius * (0.72 - i * 0.24), radius * (0.72 - i * 0.24))});
        limb.bones.push(bone); parent = bone; pos.addScaledVector(dir, lengths[i]!);
      });
      limbs.push(limb);
    }
  }

  if (lengthened) constraints.push({part: 'Leg length', chosen: recipe.legLength.toFixed(2), effect: 'Some legs were lengthened so their feet reach the ground from this body height.'});
  if (b.bones.length > COMPOSER_BUDGET.maxBones) throw new Error(`Composer graph uses ${b.bones.length} bones; budget is ${COMPOSER_BUDGET.maxBones}.`);
  const graph: ComposerGraph = {
    version: COMPOSER_GRAPH_VERSION, recipe, constraints, bones: b.bones, limbs,
    ...(phenotype ? {phenotype} : {}),
    chains: {torso, tail, neck, head, trunk},
    dims: {bodyLength: L, torsoWidth: w, torsoHeight: h, legReach, frontLegReach, socketHeight, headLength, craniumWidth: craniumW, craniumHeight: craniumH, snoutLength,
      neckLength, tailLength, trunkLength, wingSemiSpan, armLength, legRadius, armRadius, torsoPitch: pitch},
    locomotion, traits,
  };
  if (legged) fitStride(graph);
  if (phenotype && graph.locomotion.stride > 0) {graph.locomotion.speed = phenotype.motion.walkSpeed; graph.locomotion.period = graph.locomotion.stride / (graph.locomotion.duty * graph.locomotion.speed);}
  if(phenotype){
    const p=phenotype.dimensions,l=graph.locomotion,entries:ComposerPhenotypeFitEntry[]=[];
    const record=(field:string,requested:number,built:number,units:ComposerPhenotypeFitEntry['units'],reason:string)=>entries.push({field,requested,built,units,reason});
    record('legReach',p.legReach,legReach,'m','Minimum articulated reach for the unchanged torso belly clearance.');
    record('frontLegReach',p.legReach,frontLegReach,'m','Forelimb reach fitted to the built shoulder height.');
    for(const limb of limbs.filter(x=>x.kind==='leg')){const sum=limb.segments.reduce((a,b)=>a+b,0),two=limb.segments[0]!+limb.segments[1]!;record(`limb.${limb.index}.reach`,p.legReach,sum,'m','Actual segment sum after socket and lateral stance fitting.');record(`limb.${limb.index}.upperLegFraction`,p.upperLegFraction,limb.segments[0]!/two,'ratio','Upper share of upper/lower pair, excluding any metapodial segment.');record(`limb.${limb.index}.footLength`,p.footLength,limb.footLength,'m','Nominal foot profile length; surface extent is separately measured.');}
    record('cycleLength',phenotype.motion.strideLength,l.stride/l.duty,'m','Full gait cycle; fitted stance sweep divided by duty.');
    record('stanceSweep',phenotype.motion.strideLength*l.duty,l.stride,'m','Composer stride is the stance sweep, duty times full cycle length.');
    record('period',phenotype.motion.strideLength/phenotype.motion.walkSpeed,l.period,'s','Fitted full gait cycle divided by retained walking speed.');
    record('walkSpeed',phenotype.motion.walkSpeed,l.speed,'m/s','Source walking speed, or zero for an immobile fitted gait.');
    graph.phenotypeFit={version:'composer-phenotype-fit-1',entries,deviations:entries.filter(x=>Math.abs(x.built-x.requested)>1e-9*Math.max(1,Math.abs(x.requested))),derived:{snoutToHeadRatio:snoutLength/headLength,craniumHeightToWidthRatio:craniumH/p.headWidth,footHeightToWidthRatio:.42,neckBones:nNeck}};
  }
  return graph;
}

/** Shrinks stride and bob until every sampled stance leg (moving socket included) stays within
 * COMPOSER_MAX_STANCE_EXTENSION of its reach; continuity then keeps unsampled instants reachable. */
function fitStride(graph: ComposerGraph) {
  const loco = graph.locomotion, samples = 96, original = loco.stride;
  // Stance extension peaks at touchdown and liftoff (foot at +-stride/2), so those instants are sampled exactly as well;
  // uniform samples alone missed the peak by up to 4e-4 on short legs.
  const legs = graph.limbs.filter(l => l.kind === 'leg'), phase0 = graph.traits.motion.phase;
  const worst = () => {
    let e = 0;
    const times: number[] = [];
    for (let k = 0; k < samples; k++) times.push((k + 0.37) / samples * loco.period);
    for (const l of legs) for (const p of [1e-9, loco.duty * (1 - 1e-9)]) times.push((((p - l.phase - phase0) % 1 + 1) % 1) * loco.period);
    for (const t of times) for (const c of poseComposer(graph, 'walk', t).contacts) if (c.stance) e = Math.max(e, c.extension);
    for (const c of poseComposer(graph, 'neutral', 0).contacts) e = Math.max(e, c.extension);
    return e;
  };
  for (let k = 0; k < 24 && worst() > COMPOSER_MAX_STANCE_EXTENSION; k++) { loco.stride *= 0.85; loco.bob *= 0.8; loco.sway *= 0.75; loco.speed = loco.stride / (loco.duty * loco.period); }
  if (worst() > COMPOSER_MAX_STANCE_EXTENSION) { loco.stride = 0; loco.speed = 0; graph.constraints.push({part: 'Walking', chosen: graph.recipe.layout, effect: 'These legs cannot step without overextending; the walk marks time in place.'}); }
  else if (loco.stride < original * 0.6) graph.constraints.push({part: 'Walking', chosen: graph.recipe.legs, effect: `Stride shortened to ${(loco.stride / Math.max(1e-9, original) * 100).toFixed(0)}% so planted feet stay within reach.`});
}

/** Gait parameters. The individual's motion traits scale the period (so fitStride sees it), shift the duty factor and
 * scale the swing lift; neutral traits leave every value exactly as the species builds it. */
function locomotionFor(recipe: ComposerRecipe, reach: number, socketHeight: number, legSpec: {seg: number[]; tilt: number; ext: number}, sprawl: boolean, L: number, traits: ComposerIndividualTraits): ComposerLocomotion {
  const motion = traits.motion;
  if (recipe.layout === 'limbless') {
    const peristaltic = recipe.torso === 'annulated';
    const period = clamp(1.4 * Math.sqrt(L), 1.1, 3.2) * motion.periodScale;
    return {gait: peristaltic ? 'peristaltic-crawl' : 'serpentine-crawl', period, duty: 1, stride: 0, speed: (peristaltic ? 0.08 : 0.3) * L / period, lift: 0, bob: 0, sway: 0};
  }
  const period = clamp(1.25 * Math.sqrt(Math.max(0.01, socketHeight)), 0.6, 2.2) * motion.periodScale;
  const duty = (recipe.layout === 'biped' ? 0.6 : recipe.layout === 'quadruped' ? 0.66 : recipe.layout === 'sprawled' ? 0.7 : 0.62) + motion.dutyDelta;
  const two = (legSpec.seg[0]! + legSpec.seg[1]!) * reach;
  // Largest stride whose extreme stance positions keep the two-bone chain within 96% reach.
  const ext = sprawl ? 0.8 * two : legSpec.ext * two;
  const halfMax = Math.sqrt(Math.max(0, (COMPOSER_MAX_STANCE_EXTENSION * two) ** 2 - ext * ext));
  const stride = Math.min(2 * halfMax * 0.92, 0.75 * reach * (recipe.layout === 'many-legged' ? 0.6 : 1));
  const lift = Math.min(0.12 * reach, 0.5 * (two - ext) + 0.06 * reach) * motion.liftScale;
  const gait = recipe.layout === 'biped' ? 'biped-walk' : recipe.layout === 'quadruped' ? 'quadruped-walk' : recipe.layout === 'sprawled' ? 'sprawling-walk' : 'metachronal-wave';
  const bob = (recipe.layout === 'biped' ? 0.018 : recipe.layout === 'quadruped' ? 0.008 : 0) * socketHeight;
  const sway = recipe.layout === 'sprawled' ? (recipe.armor === 'dome' ? 0.03 : 0.12) : recipe.layout === 'many-legged' ? 0.05 : 0;
  return {gait, period, duty, stride, speed: stride / (duty * period), lift, bob, sway};
}

function resolveRestClearance(b: Builder, chain: number[], tipBounds: [number, number, number, number, number][] = [], tipFloor = 0) {
  // Re-solve rest positions so free chains (tail, trunk, a limbless neck and head) do not start below the ground.
  // Each bone's tip clears the deepest section touching it, including the next bone's start.
  const under = (x: ComposerSection) => x.h - x.yc;
  for (let k = 0; k < chain.length; k++) {
    const bone = b.bones[chain[k]!]!, q = q4(bone.restQuaternion), p = v3(bone.restPosition), next = b.bones[chain[k + 1]!];
    const tipCap = !next && bone.part === 'trunk' ? COMPOSER_TRUNK_TIP_CLEARANCE * bone.end.h : 0;
    const dir = V(1, 0, 0).applyQuaternion(q), floor = Math.max(under(bone.start), under(bone.end), next ? under(next.start) : 0, tipCap) * 1.05;
    let end = p.clone().addScaledVector(dir, bone.length);
    if (end.y < floor) {
      const lifted = liftDirection(dir, p.y, bone.length, floor);
      const delta = new THREE.Quaternion().setFromUnitVectors(dir, lifted);
      // rotate this bone and all following rest frames about this bone's origin
      for (let j = k; j < chain.length; j++) {
        const bj = b.bones[chain[j]!]!;
        const pj = v3(bj.restPosition).sub(p).applyQuaternion(delta).add(p);
        bj.restPosition = arr3(pj); bj.restQuaternion = arr4(delta.clone().multiply(q4(bj.restQuaternion)).normalize());
      }
      end = p.clone().addScaledVector(lifted, bone.length);
    }
  }
  const tip = b.bones[chain[chain.length - 1]!];
  if (tip && tipBounds.length) tip.restQuaternion = arr4(liftTip(v3(tip.restPosition), q4(tip.restQuaternion), tip.length, tipBounds, tipFloor));
  // refresh parent-relative rest data
  for (const i of chain) {
    const bone = b.bones[i]!, parent = b.bones[bone.parent]!;
    const inv = q4(parent.restQuaternion).invert();
    bone.offset = arr3(v3(bone.restPosition).sub(v3(parent.restPosition)).applyQuaternion(inv));
    bone.restLocal = arr4(inv.multiply(q4(bone.restQuaternion)).normalize());
  }
}
/** Bone-local bounding ellipsoids [x past the tip bone's end, z, rx, ry, rz] of the tail-tip ornament. The skin builds
 * the ornament inside them and the rest and posed tail keep them above the ground. */
export function composerTailTipBounds(recipe: ComposerRecipe, L: number, tip: {length: number; end: {h: number}}): [number, number, number, number, number][] {
  const h = tip.end.h;
  if (recipe.tail === 'tufted') return [[h * 2, 0, Math.max(tip.length * 0.9, h * 4), h * 2.6, h * 2.6]];
  if (recipe.tail === 'club') {
    const rr = Math.max(h * 2.4, L * 0.05);
    return [[rr * 0.6, 0, rr * 1.1, rr * 0.8, rr * 1.3], [rr * 0.6, -rr * 1.2, rr * 0.55, rr * 0.45, rr * 0.5], [rr * 0.6, rr * 1.2, rr * 0.55, rr * 0.45, rr * 0.5]];
  }
  if (recipe.tail === 'feather-fan') { const span = composerFeatherFanSpan(recipe, L); return [[span * 0.5, 0, span * 0.53, span * 0.06, span * 0.7]]; }
  return [];
}
export const composerFeatherFanSpan = (recipe: ComposerRecipe, L: number) => Math.max(recipe.tailLength * L * 0.8, 0.12 * L);
function tipLowest(p: THREE.Vector3, q: THREE.Quaternion, length: number, bounds: [number, number, number, number, number][]) {
  const ax = V(1, 0, 0).applyQuaternion(q), ay = V(0, 1, 0).applyQuaternion(q), az = V(0, 0, 1).applyQuaternion(q);
  return bounds.reduce((lo, [x, z, rx, ry, rz]) => Math.min(lo, p.y + ax.y * (length + x) + az.y * z - Math.hypot(rx * ax.y, ry * ay.y, rz * az.y)), Infinity);
}
/** Smallest upward swing about the bone origin that keeps the tail-tip ornament above `floor`. */
function liftTip(p: THREE.Vector3, q: THREE.Quaternion, length: number, bounds: [number, number, number, number, number][], floor: number): THREE.Quaternion {
  if (!bounds.length || tipLowest(p, q, length, bounds) >= floor) return q;
  const dir = V(1, 0, 0).applyQuaternion(q), k = V().crossVectors(dir, UP);
  if (k.lengthSq() < 1e-12) return q;
  k.normalize();
  const turned = (a: number) => axisQ(k, a).multiply(q).normalize();
  let lo = 0, hi = dir.angleTo(UP);
  if (tipLowest(p, turned(hi), length, bounds) < floor) return turned(hi);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (tipLowest(p, turned(mid), length, bounds) >= floor) hi = mid; else lo = mid; }
  return turned(hi);
}
/** Proximal muscle mass: the upper segment's start radius relative to the limb's base radius. The skin's root collar
 * scales down by the same factor so the root still blends into the body. */
export function composerLimbMass(recipe: ComposerRecipe, kind: 'leg' | 'arm'): number {
  if (kind === 'arm') return 1.4;
  return recipe.legs === 'arthropod' ? 1 : recipe.legs === 'pillar' ? 1.15 : 1.45;
}
/** The trunk's rounded tip reaches this many end radii below (and past) the last trunk bone's end. */
export const COMPOSER_TRUNK_TIP_CLEARANCE = 1.2;
/** Membrane chord furl per wing bone (humerus, forearm, hand) when fully folded. */
const WING_FURL = [0.45, 0.5, 0.45];
/** Humerus offset (relative to its rest local frame) for the folded wing, defined in the carrier's frame:
 * spar back along the body, chord (local +Z x side) ventral and slightly outward. */
function wingFoldOffset(graph: ComposerGraph, limb: ComposerLimb): THREE.Quaternion {
  const s = limb.side, x = V(-1, -0.18, 0.1 * s).normalize();
  const chord = V(0, -1, 0.45 * s); chord.addScaledVector(x, -chord.dot(x)).normalize();
  const z = chord.multiplyScalar(s), y = V().crossVectors(z, x);
  const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return q4(graph.bones[limb.bones[0]!]!.restLocal).invert().multiply(target);
}
/** Membrane chord (perpendicular to the spar, toward the bone's local +Z x side) at span fraction `u`. */
export function composerWingChord(feathered: boolean, total: number, u: number): number {
  let chord = feathered ? total * (0.36 + 0.14 * Math.sin(Math.PI * Math.min(1, u * 1.15))) * (1 - 0.8 * smooth(0.8, 1, u)) : total * 0.58 * Math.pow(1 - u, 0.9) * (0.78 + 0.22 * Math.abs(Math.cos(Math.PI * 3 * u)));
  if (feathered) chord *= 1 - 0.08 * Math.abs(Math.sin(Math.PI * 9 * u));
  return Math.max(chord, total * 0.03);
}
/** Membrane thickness for a wing of `total` spar length. */
export const composerWingThickness = (feathered: boolean, total: number) => total * (feathered ? 0.018 : 0.008);
function liftWing(graph: ComposerGraph, limb: ComposerLimb, world: {p: THREE.Vector3; q: THREE.Quaternion}[], chordScale: Float64Array, floor: number) {
  const chain = limb.bones.map(i => graph.bones[i]!), total = chain.reduce((a, b) => a + b.length, 0);
  const feathered = graph.recipe.wings === 'feathered', thickness = composerWingThickness(feathered, total);
  const shoulder = world[chain[0]!.index]!.p.clone();
  const samples = (R: THREE.Quaternion) => {
    const out: THREE.Vector3[] = []; let acc = 0;
    for (const bone of chain) {
      const {p, q} = world[bone.index]!, ax = V(1, 0, 0).applyQuaternion(q), ay = V(0, 1, 0).applyQuaternion(q), az = V(0, 0, 1).applyQuaternion(q);
      const radius = Math.max(bone.start.h, bone.end.h);
      for (let j = 0; j <= 4; j++) {
        const along = bone.length * j / 4, chord = composerWingChord(feathered, total, (acc + along) / total) * chordScale[bone.index]!;
        const lead = p.clone().addScaledVector(ax, along), sag = Math.abs(ay.y);
        const trail = lead.clone().addScaledVector(az, limb.side * chord);
        out.push(lead.addScaledVector(UP, -Math.hypot(radius * sag, radius * Math.abs(az.y))), trail.addScaledVector(UP, -(thickness + 0.06 * chord) * sag));
      }
      acc += bone.length;
    }
    return out.map(v => v.sub(shoulder).applyQuaternion(R).add(shoulder));
  };
  const lowest = (R: THREE.Quaternion) => samples(R).reduce((lo, v) => v.y < lo.y ? v : lo);
  if (lowest(new THREE.Quaternion()).y >= floor) return;
  // abduct about the carrier's horizontal forward axis: raises folded segments ahead of and behind the shoulder alike
  const forward = V(1, 0, 0).applyQuaternion(world[limb.socketBone]!.q).setY(0);
  if (forward.lengthSq() < 1e-12) return;
  const k = forward.normalize().multiplyScalar(-limb.side);
  let lo = 0, hi = Math.PI * 0.75;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (lowest(axisQ(k, mid)).y >= floor) hi = mid; else lo = mid; }
  const R = axisQ(k, hi);
  for (const bone of chain) { const w = world[bone.index]!; w.p.sub(shoulder).applyQuaternion(R).add(shoulder); w.q.premultiply(R).normalize(); }
}
/** Same heading, vertical component raised so a bone of `length` from height `y0` ends at `floor`. */
function liftDirection(dir: THREE.Vector3, y0: number, length: number, floor: number): THREE.Vector3 {
  const vy = clamp((floor - y0) / length, -1, 1);
  const horizontal = V(dir.x, 0, dir.z); const hl = horizontal.length();
  const scale = Math.sqrt(Math.max(0, 1 - vy * vy));
  return hl > 1e-9 ? horizontal.multiplyScalar(scale / hl).setY(vy) : V(0, vy >= 0 ? 1 : -1, 0);
}

interface Solved {points: THREE.Vector3[]; frames: THREE.Quaternion[]; reachError: number; extension?: number}
/** Shared by the height fit and IK: a three-segment foot first fixes its ankle
 * and metatarsal orientation, leaving the upper two segments to reach the hock. */
function legTargetFrame(limb: ComposerLimb, contact: THREE.Vector3, heading: THREE.Quaternion, groundNormal?: Vec3, groundForward?: Vec3) {
  const up = groundNormal ? v3(groundNormal).normalize() : UP.clone(), fwd = groundForward ? v3(groundForward) : V(1, 0, 0).applyQuaternion(heading);
  if (groundNormal) fwd.addScaledVector(up, -fwd.dot(up)); else fwd.y = 0;
  fwd.normalize();
  const ankle = contact.clone().addScaledVector(up, limb.footHeight), s = limb.segments;
  let hock = ankle;
  if (s.length === 3) hock = ankle.clone().addScaledVector(up, s[2]! * Math.cos(limb.metaTilt)).addScaledVector(fwd, -s[2]! * Math.sin(limb.metaTilt));
  return {up,fwd,ankle,hock};
}
/** Leg IK: socket -> [knee] -> [hock] -> ankle above the contact. Lengths are exact
 * whenever the target is reachable; otherwise the leg extends straight and reports the error. */
function solveLeg(limb: ComposerLimb, socket: THREE.Vector3, contact: THREE.Vector3, heading: THREE.Quaternion, footPitch = 0, groundNormal?: Vec3, groundForward?: Vec3): Solved {
  const {up,fwd,ankle,hock} = legTargetFrame(limb,contact,heading,groundNormal,groundForward);
  const s = limb.segments, pole = v3(limb.pole).applyQuaternion(heading);
  const {joint, end, reachError} = composerTwoBone(socket, hock, s[0]!, s[1]!, pole);
  const points = [socket.clone(), joint, end];
  if (s.length === 3) points.push(end.clone().add(ankle.clone().sub(hock)));
  const plane = V().crossVectors(points[points.length - 1]!.clone().sub(socket), pole);
  if (plane.lengthSq() < 1e-12) plane.set(0, 0, 1);
  plane.normalize();
  const frames: THREE.Quaternion[] = [];
  for (let i = 0; i < s.length; i++) {
    const dir = points[i + 1]!.clone().sub(points[i]!);
    // +Y lies in the bend plane on the pole side, so skin rings never twist between segments
    frames.push(composerFrame(dir, V().crossVectors(plane, dir).normalize()));
  }
  let toe = fwd.clone();
  if (limb.side && Math.abs(limb.pole[2]) > 0.1) toe.applyAxisAngle(UP, -limb.side * 0.35); // sprawling feet toe out
  const footQ = composerFrame(toe, up);
  if (footPitch) footQ.multiply(axisQ(Z_AXIS, footPitch));
  frames.push(footQ);
  points.push(points[points.length - 1]!.clone());
  // points: socket, knee, (hock), ankle; frames for each segment + foot (origin = ankle)
  return {points: points.slice(0, s.length + 1), frames, reachError, extension: socket.distanceTo(hock) / (s[0]! + s[1]!)};
}
/** Rest hand target of an axial body's arms, in arm reaches from the shoulder: [forward, up, outward] (graph-4). */
export const AXIAL_ARM_REST = Object.freeze([-0.2, -0.35, 0.75]);
/** Display arm raise from the rest target, in arm reaches: [forward, up, outward] (graph-3: [0.35, 0.55, 0]). */
export const DISPLAY_ARM_RAISE = Object.freeze([-0.2, 0.9, 0.5]);
function armRestTarget(recipe: ComposerRecipe, limb: ComposerLimb, shoulder: THREE.Vector3): THREE.Vector3 {
  const reach = limb.segments[0]! + limb.segments[1]!;
  let t: THREE.Vector3;
  if (recipe.layout === 'biped' && recipe.arms === 'grasping') t = shoulder.clone().add(V(0.12 * reach, -0.86 * reach, limb.side * 0.12 * reach));
  // graph-4 (EC4): the arms of a long axial body (limbless, many-legged) sit on its front segment right behind a small
  // head, so reaching forward put forearms and hands in front of the face (GPT Luna 6 on wild seed 40: "black shapes
  // look like wings or limbs passing in front of and around the head"); they rest out to the side and back instead
  else if (recipe.layout === 'limbless' || recipe.layout === 'many-legged') t = shoulder.clone().add(V(AXIAL_ARM_REST[0] * reach, AXIAL_ARM_REST[1] * reach, limb.side * AXIAL_ARM_REST[2] * reach));
  else t = shoulder.clone().add(V(0.5 * reach, -0.42 * reach, limb.side * 0.1 * reach));
  const floor = limb.segments[2]! + limb.segments[3]! + 0.02 * reach;
  if (t.y < floor) t.y = floor;
  return t;
}
/** Arm IK with wrist flexion and finger curl applied about the hand's bend axis. */
/** Finger geometry (hand, claw, pincer) extends up to this many finger-bone lengths past the finger origin. */
const ARM_DIGIT_REACH = 2.4;
/** Lowest hand surface estimate: wrist, finger origin and the digit reach, less the hand's section depth. */
function armHandLowest(graph: ComposerGraph, limb: ComposerLimb, solved: Solved): number {
  const [, , hand, finger] = limb.bones.map(i => graph.bones[i]!) as ComposerBone[];
  const depth = 1.5 * Math.max(hand!.start.h, hand!.end.h, finger!.start.h);
  const dir = V(1, 0, 0).applyQuaternion(solved.frames[3]!), tip = solved.points[3]!.clone().addScaledVector(dir, finger!.length * ARM_DIGIT_REACH);
  return Math.min(solved.points[2]!.y, solved.points[3]!.y, tip.y) - depth;
}
function solveArm(limb: ComposerLimb, shoulder: THREE.Vector3, target: THREE.Vector3, heading: THREE.Quaternion, wrist: number, curl: number, raise = 0): Solved {
  const s = limb.segments, pole = v3(limb.pole).applyQuaternion(heading).addScaledVector(UP, raise);
  const delta = target.clone().sub(shoulder), maxReach = (s[0]! + s[1]!) * 0.985;
  const goal = delta.length() > maxReach ? shoulder.clone().addScaledVector(delta.normalize(), maxReach) : target.clone();
  const {joint, end, reachError} = composerTwoBone(shoulder, goal, s[0]!, s[1]!, pole);
  const plane = V().crossVectors(end.clone().sub(shoulder), pole); if (plane.lengthSq() < 1e-12) plane.set(0, 0, 1); plane.normalize();
  const frames: THREE.Quaternion[] = [], points = [shoulder.clone(), joint, end];
  for (let i = 0; i < 2; i++) { const dir = points[i + 1]!.clone().sub(points[i]!); frames.push(composerFrame(dir, V().crossVectors(plane, dir).normalize())); }
  const handQ = frames[1]!.clone().multiply(axisQ(Z_AXIS, -wrist));
  const handDir = V(1, 0, 0).applyQuaternion(handQ);
  const fingerOrigin = end.clone().addScaledVector(handDir, s[2]!);
  const fingerQ = handQ.clone().multiply(axisQ(Z_AXIS, -curl));
  return {points: [shoulder, joint, end, fingerOrigin], frames: [frames[0]!, frames[1]!, handQ, fingerQ], reachError};
}

// ------------------------------------------------------------------ pose
const TAU = Math.PI * 2;
/** Deterministic pose for a motion at `time` seconds (bounded 0..120). */
export function poseComposer(graph: ComposerGraph, motion: ComposerMotion, time: number, options: ComposerPoseOptions = {}): ComposerPose {
  if (options.trunkMotion !== undefined && options.trunkMotion !== 'legacy' && options.trunkMotion !== 'wave-1') throw new Error('Unknown Composer trunk motion');
  const environment = options.environment;
  if (environment) {
    for (const key of ['cycle', 'clock', 'stride', 'speed', 'cycleLength', 'walkWeight', 'idleWeight', 'rootHeight'] as const) if (environment[key] !== undefined && !Number.isFinite(environment[key])) throw new Error(`Invalid Composer environment ${key}`);
    if (environment.clock !== undefined && (environment.clock < 0 || environment.clock > 1e6)) throw new Error('Composer runtime clock must be bounded to one million seconds');
    if ((environment.stride ?? 0) < 0 || (environment.speed ?? 0) < 0) throw new Error('Composer path stride/speed must be nonnegative');
    if ((environment.cycleLength ?? 0) < 0 || [environment.walkWeight,environment.idleWeight].some(x=>x!==undefined&&(x<0||x>1))) throw new Error('Invalid Composer motion blend/cycle length');
    if (environment.contact && !environment.ground) throw new Error('Composer terrain contacts require a ground diagnostic sampler');
    if (environment.supportHeight !== undefined && environment.supportHeight !== 'reachable-1') throw new Error('Invalid Composer support-height policy');
    if (environment.rootRotation && (!environment.rootRotation.every(Number.isFinite) || Math.abs(Math.hypot(...environment.rootRotation) - 1) > 1e-6)) throw new Error('Invalid Composer environment rotation');
  }
  const t = environment?.clock ?? clamp(Number.isFinite(time) ? time : 0, 0, 120);
  const n = graph.bones.length, recipe = graph.recipe, loco = graph.locomotion;
  const positions = new Float64Array(n * 3), quaternions = new Float64Array(n * 4), radialScale = new Float64Array(n).fill(1), chordScale = new Float64Array(n).fill(1);
  const world: {p: THREE.Vector3; q: THREE.Quaternion}[] = new Array(n);
  const offsets: (THREE.Quaternion | undefined)[] = new Array(n);
  // individual desync: a herd started together does not step, breathe or look around in lockstep
  const desync = graph.traits.motion;
  const cycle = environment?.cycle ?? t / loco.period + desync.phase;
  const stride = environment?.stride ?? loco.stride, speed = environment?.speed ?? loco.speed;
  const walkWeight = environment?.walkWeight ?? (motion === 'walk' ? 1 : 0), idleWeight = environment?.idleWeight ?? (motion === 'idle' ? 1 : 0);
  const moving = motion === 'walk' || walkWeight > 0, idle = motion === 'idle' || idleWeight > 0, display = motion === 'display';
  const add = (i: number, q: THREE.Quaternion) => { offsets[i] = offsets[i] ? offsets[i]!.multiply(q) : q; };
  const pitchQ = (a: number) => axisQ(Z_AXIS, a), yawQ = (a: number) => axisQ(Y_AXIS, a), rollQ = (a: number) => axisQ(X_AXIS, a);
  const {torso, tail, neck, head, trunk} = graph.chains;
  const limbless = recipe.layout === 'limbless';
  let travel = 0;
  const rootBone = graph.bones[torso[0]!]!;
  const rootP = v3(rootBone.offset), rootQ = q4(rootBone.restLocal);

  // ---- axial motion offsets
  if (moving && !limbless) {
    travel = environment ? 0 : loco.speed * t;
    const twoStep = Math.cos(TAU * cycle * 2);
    if (recipe.layout === 'biped') { rootP.y += -loco.bob * twoStep * walkWeight; rootQ.multiply(rollQ(0.035 * Math.sin(TAU * cycle) * walkWeight)).multiply(yawQ(0.04 * Math.sin(TAU * cycle) * walkWeight)); }
    else if (recipe.layout === 'quadruped') { rootP.y += -loco.bob * twoStep * walkWeight; rootQ.multiply(rollQ(0.015 * Math.sin(TAU * cycle) * walkWeight)); }
    if (loco.sway) torso.forEach((bi, i) => { if (i) add(bi, yawQ(loco.sway * Math.sin(TAU * cycle - i * 0.9) * walkWeight)); });
    const bob = recipe.head === 'beak' && recipe.layout === 'biped' ? 0.16 : 0.05;
    neck.forEach((bi, i) => add(bi, pitchQ((i % 2 ? -1 : 1) * bob * Math.sin(TAU * cycle * 2) / Math.max(1, neck.length * 0.6) * walkWeight)));
    add(head, pitchQ(-0.5 * bob * Math.sin(TAU * cycle * 2) * walkWeight));
    tail.forEach((bi, i) => add(bi, yawQ(0.07 * Math.sin(TAU * cycle - 0.7 * (i + 1)) * walkWeight)));
  }
  if (idle || display) {
    // Breathing slows with size (about L^0.25: 2.3 s for a 0.2 m bird, 4 s for a 2 m rhino).
    const breathPeriod = 3.4 * clamp(Math.pow(graph.dims.bodyLength, 0.25), 0.6, 1.8);
    const breath = 1 + 0.012 * Math.sin(TAU * (t / breathPeriod + desync.breathPhase)) * (display ? 1 : idleWeight);
    for (const bi of torso) radialScale[bi] = breath;
    const lp = desync.lookPhase;
    const look = idle ? 0.22 * Math.sin(TAU * (t / 7.3 + lp)) * idleWeight : 0.12 * Math.sin(TAU * (t / 4.1 + lp));
    const nod = idle ? 0.07 * Math.sin(TAU * (t / 5.2 + lp)) * idleWeight : -0.12 - 0.05 * Math.sin(TAU * (t / 2.7 + lp));
    // The look turns about world up (gravity), shared along the neck: each neck bone turns by look/n about the vertical
    // expressed in its own rest frame. A bone-local yaw would mostly roll a raised neck (a giraffe turned its head ~6 deg).
    const nNeck = Math.max(1, neck.length);
    neck.forEach(bi => {
      const vertical = UP.clone().applyQuaternion(q4(graph.bones[bi]!.restQuaternion).invert());
      add(bi, axisQ(vertical, look / nNeck).multiply(pitchQ((display ? 0.1 : 0) + nod / nNeck)));
    });
    add(head, pitchQ(display ? 0.18 : nod * 0.5));
    tail.forEach((bi, i) => add(bi, yawQ((idle ? 0.1 * idleWeight : 0.16) * Math.sin(TAU * (t / (idle ? 3.1 : 1.9) + lp) - 0.6 * i)).multiply(pitchQ(display && i < 3 ? 0.12 : 0))));
  }
  const lowestTorso = () => torso.reduce((lo, bi) => Math.min(lo, world[bi]!.p.y - graph.bones[bi]!.start.h), Infinity);
  // trunk curl
  if (trunk.length && motion !== 'neutral') {
    const lp = desync.lookPhase;
    if (options.trunkMotion === 'wave-1') {
      const curlWeights = [0.08, 0.45, 0.85, 1.25, 1.6, 1.85], swayWeights = [0.12, 0.35, 0.55, 0.65, 0.65, 0.65];
      trunk.forEach((bi, i) => {
        const lag = 0.45 * i;
        // Distal gain compensates for the shorter lever arms and phase lag;
        // the base retains its small unamplified offset. A small relaxed curl
        // biases the free tip upward; clearance corrections remain measurable.
        const gain = i ? 1.45 : 1, relaxedCurl = i && !display ? 0.035 : 0;
        const curl = display ? 0.38 + 0.12 * Math.sin(TAU * (t / 2.4 + lp) - lag) : relaxedCurl + gain * (environment ? walkWeight*.05*Math.sin(TAU*cycle-lag)+idleWeight*.08*Math.sin(TAU*(t/4.6+lp)-lag) : moving ? 0.05 * Math.sin(TAU * cycle - lag) : 0.08 * Math.sin(TAU * (t / 4.6 + lp) - lag));
        const sway = gain * (environment ? walkWeight*.12*Math.sin(TAU*cycle+1-lag)+idleWeight*.1*Math.sin(TAU*(t/3.3+lp)-lag) : moving ? 0.12 * Math.sin(TAU * cycle + 1 - lag) : 0.1 * Math.sin(TAU * (t / 3.3 + lp) - lag));
        add(bi, pitchQ(curl * curlWeights[i]!).multiply(yawQ(sway * swayWeights[i]!)));
      });
    } else {
      const curl = display ? 0.38 + 0.12 * Math.sin(TAU * (t / 2.4 + lp)) : environment ? walkWeight*.05*Math.sin(TAU*cycle)+idleWeight*.08*Math.sin(TAU*(t/4.6+lp)) : moving ? 0.05 * Math.sin(TAU * cycle) : 0.08 * Math.sin(TAU * (t / 4.6 + lp));
      const sway = environment ? walkWeight*.12*Math.sin(TAU*cycle+1)+idleWeight*.1*Math.sin(TAU*(t/3.3+lp)) : (moving ? 0.12 * Math.sin(TAU * cycle + 1) : 0.1 * Math.sin(TAU * (t / 3.3 + lp)));
      trunk.forEach((bi, i) => add(bi, pitchQ(curl * (0.4 + i * 0.25)).multiply(yawQ(sway * (i ? 0.4 : 1)))));
    }
  }
  // wings: fold (idle/walk), spread and slow grounded display beats
  const wingLimbs = graph.limbs.filter(l => l.kind === 'wing');
  for (const limb of wingLimbs) {
    const fold = motion === 'neutral' ? 0 : display ? 0.1 + 0.1 * Math.sin(TAU * t / 3) : 1;
    const flap = display ? 0.38 * Math.sin(TAU * t / 1.6) : moving ? 0.04 * Math.sin(TAU * cycle * 2) : 0;
    const [hum, fore, hand] = limb.bones as [number, number, number];
    // Folded, the humerus lies back along the flank with the membrane hanging ventrally and slightly outward; forearm
    // and hand fold about the chord axis like a creased strip, so the membrane stacks instead of shearing in its plane.
    add(hum, new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), wingFoldOffset(graph, limb), fold).multiply(pitchQ(flap)));
    add(fore, pitchQ(-(Math.PI - 0.22) * fold));
    add(hand, pitchQ((Math.PI - 0.3) * fold + (display ? 0.4 * flap : 0)));
    limb.bones.forEach((bi, k) => { chordScale[bi] = 1 - WING_FURL[k]! * fold; });
  }

  // The terrain attitude is a rigid transform of the local body, including its
  // root offset and axial motion. Rotating only rootQ instead pivots the body
  // around the elevated rear root joint and can pull a planted foot out of IK
  // reach even on a shallow plane. External ground height remains a translation
  // in the caller's frame; it must never be rotated with the body.
  if (environment) {
    if (environment.rootRotation) {
      const terrainFrame = q4(environment.rootRotation);
      rootP.applyQuaternion(terrainFrame); rootQ.premultiply(terrainFrame);
    }
    rootP.y += environment.rootHeight ?? 0;
  }

  // ---- forward kinematics for every FK bone (parents precede children)
  const fkBone = (i: number) => {
    const bone = graph.bones[i]!;
    let p: THREE.Vector3, q: THREE.Quaternion;
    if (bone.parent < 0) { p = rootP.clone(); q = rootQ.clone(); }
    else { const parent = world[bone.parent]!; p = v3(bone.offset).applyQuaternion(parent.q).add(parent.p); q = parent.q.clone().multiply(q4(bone.restLocal)); }
    if (offsets[i]) q.multiply(offsets[i]!);
    q.normalize();
    // free chains stay above the ground
    if ((bone.part === 'tail' || bone.part === 'trunk' || ((bone.part === 'neck' || bone.part === 'head') && limbless)) && motion !== 'neutral') {
      // The tip clears the deepest section touching it (a head is deeper mid-length, and its start is deeper than the
      // neck end it hangs from); the 6% covers skin blended across a bend at the joint.
      const under = (x: ComposerSection) => x.h - x.yc, carriesHead = limbless && bone.part === 'neck' && i === neck[neck.length - 1];
      const dir = V(1, 0, 0).applyQuaternion(q), end = p.clone().addScaledVector(dir, bone.length);
      const tipCap = bone.part === 'trunk' && i === trunk[trunk.length - 1] ? COMPOSER_TRUNK_TIP_CLEARANCE * bone.end.h : 0;
      const floor = Math.max(under(bone.start), under(bone.end), carriesHead ? under(graph.bones[head]!.start) : 0, tipCap) * 1.06 + (environment?.ground?.(end.x, end.z) ?? 0);
      if (end.y < floor) q = new THREE.Quaternion().setFromUnitVectors(dir, liftDirection(dir, p.y, bone.length, floor)).multiply(q).normalize();
      if (i === tail[tail.length - 1]) q = liftTip(p, q, bone.length, composerTailTipBounds(recipe, graph.dims.bodyLength, bone), 0.004 * graph.dims.bodyLength);
    }
    world[i] = {p, q};
  };
  if (limbless && motion !== 'neutral') {
    // limbless crawl places the torso and tail along a travelling track; everything else follows by FK
    // Turning the neck relative to the front segment sags the skin blended across that joint; lift the joint to cover it.
    const neckTurn = neck.length && offsets[neck[0]!] ? 2 * Math.acos(Math.min(1, Math.abs(offsets[neck[0]!]!.w))) : 0;
    travel = crawl(graph, motion, t, world, radialScale, neckTurn);
    for (let i = 0; i < n; i++) { const part = graph.bones[i]!.part; if (graph.bones[i]!.driver === 'fk' && part !== 'torso' && part !== 'tail') fkBone(i); }
  } else for (let i = 0; i < n; i++) if (graph.bones[i]!.driver === 'fk') fkBone(i);
  // ---- legs
  const contacts: ComposerContact[] = [];
  let maxReach = 0;
  const heading = new THREE.Quaternion();
  const legTargets: {limb:ComposerLimb;contact:THREE.Vector3;stance:boolean;footPitch:number;groundNormal?:Vec3;groundForward?:Vec3}[] = [];
  for (const limb of graph.limbs) {
    if (limb.kind !== 'leg') continue;
    const rest = v3(limb.rest);
    let stance = true, footPitch = 0;
    const phase = ((cycle + limb.phase) % 1 + 1) % 1;
    const contact = rest.clone();
    if (moving) {
      if (phase < loco.duty) { const u = phase / loco.duty; contact.x = rest.x + stride * (0.5 - u); }
      else {
        // Swing, in the body frame, from -stride/2 to +stride/2. The world foot follows a minimum-jerk path: it covers
        // stride + speed x swing time with the quintic 6u^5 - 15u^4 + 10u^3, so it leaves and meets the ground with zero
        // world velocity and zero acceleration. In the body frame that is a curve whose end tangents (-speed x swing
        // time) match the stance foot's body-frame velocity; it dips slightly behind the liftoff point first, as a real
        // foot does. (A cubic Hermite with the same end tangents still reaches ~0.3 x body speed within 2% of liftoff.)
        // y = lift 16u^2(1-u)^2 has zero vertical velocity at touchdown. Pitch: toe down (heel up) through push-off,
        // toe up before heel strike; both factors vanish at u = 0.5, so the asymmetric scale introduces no jump.
        const u = (phase - loco.duty) / (1 - loco.duty), u3 = u * u * u;
        const carried = environment?.cycleLength !== undefined ? (1-loco.duty)*environment.cycleLength : speed * (1 - loco.duty) * loco.period, s = u3 * (10 + u * (6 * u - 15));
        contact.x = rest.x - stride * 0.5 + (stride + carried) * s - carried * u;
        contact.y = loco.lift * 16 * u * u * (1 - u) * (1 - u); stance = false;
        footPitch = recipe.feet === 'spike' ? 0 : -0.35 * Math.sin(TAU * u) * Math.sin(Math.PI * u) * (u < 0.5 ? 1 : 0.4);
        // Toe-down pitch rotates the front of the sole down by front*sin(pitch); never more than the current lift.
        const reach = footPitch < 0 ? limb.footExtent[1] : limb.footExtent[0];
        footPitch = Math.sign(footPitch) * Math.min(Math.abs(footPitch), Math.asin(Math.min(1, contact.y / Math.max(1e-9, reach))));
      }
    }
    let groundNormal: Vec3 | undefined, groundForward: Vec3 | undefined;
    if (environment?.contact) {
      const target = environment.contact(limb, phase, stance, arr3(contact));
      if (!target.position.every(Number.isFinite) || (target.normal && (!target.normal.every(Number.isFinite) || Math.hypot(...target.normal) < 1e-6))) throw new Error('Invalid Composer terrain contact');
      contact.fromArray(target.position); groundNormal = target.normal;
      if(target.forward&&(!target.forward.every(Number.isFinite)||Math.hypot(...target.forward)<1e-6))throw new Error('Invalid Composer foot heading');
      groundForward=target.forward;
      if(target.pitch!==undefined){if(!Number.isFinite(target.pitch))throw new Error('Invalid Composer foot pitch');footPitch=target.pitch;}
      if(target.stance!==undefined)stance=target.stance;
    } else if (environment?.ground) contact.y += environment.ground(contact.x, contact.z);
    legTargets.push({limb,contact,stance,footPitch,groundNormal,groundForward});
  }
  let supportHeight: ComposerPose['diagnostics']['supportHeight'];
  if (environment?.supportHeight === 'reachable-1' && legTargets.length) {
    // For fixed X/Z, each leg's reach shell cuts the vertical root line into
    // one or two closed intervals. Intersect ALL targets, including swing, so
    // removing a support at toe-off cannot create a body-height jump. The
    // nearest point preserves the authored bob whenever it remains feasible.
    let intervals:[number,number][] = [[-Infinity,Infinity]];
    for (const target of legTargets) {
      const {limb,contact,groundNormal,groundForward} = target, carrier = world[limb.socketBone]!;
      const socket = v3(limb.socket).applyQuaternion(carrier.q).add(carrier.p);
      const {hock} = legTargetFrame(limb,contact,heading,groundNormal,groundForward);
      const horizontal = (socket.x-hock.x)**2+(socket.z-hock.z)**2, centre = hock.y-socket.y;
      // These are exactly composerTwoBone's numerical reach limits, not a
      // displacement chosen to hide a measured foot gap.
      const outer = (limb.segments[0]!+limb.segments[1]!-1e-6)**2-horizontal;
      const inner = (Math.abs(limb.segments[0]!-limb.segments[1]!)+1e-6)**2-horizontal;
      const outerY = Math.sqrt(Math.max(0,outer)), innerY = Math.sqrt(Math.max(0,inner));
      const allowed:[number,number][] = outer<0?[]:inner>0?[[centre-outerY,centre-innerY],[centre+innerY,centre+outerY]]:[[centre-outerY,centre+outerY]];
      intervals = intervals.flatMap(([lo,hi])=>allowed.map(([a,b])=>[Math.max(lo,a),Math.min(hi,b)] as [number,number]).filter(([a,b])=>a<=b));
    }
    let delta = 0;
    if (intervals.length) delta = intervals.map(([lo,hi])=>clamp(0,lo,hi)).reduce((best,x)=>Math.abs(x)<Math.abs(best)?x:best,Infinity);
    supportHeight = {version:'composer-support-height-1',requested:environment.rootHeight??0,applied:(environment.rootHeight??0)+delta,delta,feasible:intervals.length>0,intervals};
    if (delta) {
      rootP.y += delta;
      for (let i=0;i<n;i++) if(graph.bones[i]!.driver==='fk') fkBone(i);
    }
  }
  // wings: raise the whole wing about its final shoulder after support fitting
  for (const limb of wingLimbs) liftWing(graph, limb, world, chordScale, 0.004 * graph.dims.bodyLength);
  for (const {limb,contact,stance,footPitch,groundNormal,groundForward} of legTargets) {
    const carrier = world[limb.socketBone]!;
    const sock = v3(limb.socket).applyQuaternion(carrier.q).add(carrier.p);
    const solved = solveLeg(limb, sock, contact, heading, footPitch, groundNormal, groundForward);
    maxReach = Math.max(maxReach, solved.reachError);
    limb.bones.forEach((bi, k) => { world[bi] = {p: solved.points[Math.min(k, solved.points.length - 1)]!, q: solved.frames[k]!}; });
    // foot origin is the ankle; sole sits footHeight below it
    const footBone = limb.bones[limb.bones.length - 1]!;
    world[footBone]!.p = solved.points[solved.points.length - 1]!.clone();
    const sole = world[footBone]!.p.clone().addScaledVector(groundNormal ? v3(groundNormal).normalize() : UP, -limb.footHeight);
    contacts.push({limb: limb.index, side: limb.side, pair: limb.pair, stance, contact: arr3(sole), world: [sole.x + travel, sole.y, sole.z], reachError: solved.reachError, extension: solved.extension ?? 0});
  }
  // ---- arms
  for (const limb of graph.limbs) {
    if (limb.kind !== 'arm') continue;
    const carrier = world[limb.socketBone]!;
    const sock = v3(limb.socket).applyQuaternion(carrier.q).add(carrier.p);
    const restCarrier = graph.bones[limb.socketBone]!;
    // rest target expressed relative to the moving carrier, so arms stay attached to a bending body
    const restLocal = v3(limb.rest).sub(v3(restCarrier.restPosition)).applyQuaternion(q4(restCarrier.restQuaternion).invert());
    const target = restLocal.applyQuaternion(carrier.q).add(carrier.p);
    const reach = limb.segments[0]! + limb.segments[1]!;
    let curl = 0.25, wrist = 0.15;
    if (moving && recipe.layout === 'biped') {
      // Arms swing against the same-side leg: the left hand is furthest back as the left foot touches down. Small
      // (theropod) arms and forward-pitched bodies hold their arms still; upright grasping arms swing fully.
      const swing = recipe.arms === 'small' ? 0 : clamp((recipe.posture - 0.4) / 0.2, 0, 1);
      if (swing > 0) target.x += swing * 0.22 * reach * Math.cos(TAU * (cycle + limb.phase));
    }
    if (idle) { curl = 0.35 + 0.25 * Math.sin(TAU * t / 2.8 + limb.side); }
    // display raises the arms forward and up; graph-4 (EC4) spreads them sideways so the raised hands frame the face
    // instead of passing in front of it
    if (display) { target.add(V(DISPLAY_ARM_RAISE[0] * reach, DISPLAY_ARM_RAISE[1] * reach + 0.1 * reach * Math.sin(TAU * t / 1.7 + limb.side), limb.side * DISPLAY_ARM_RAISE[2] * reach)); curl = 0.9 + 0.5 * Math.sin(TAU * t / 1.3); wrist = -0.3; }
    const floor = limb.segments[2]! + limb.segments[3]! + 0.02 * reach;
    if (target.y < floor) target.y = floor;
    const grip = recipe.hands === 'pincer' ? Math.max(0, curl) * 0.6 : curl;
    // a low shoulder can swing the elbow into the ground; turn the elbow upward just enough
    const margin = 0.004 * graph.dims.bodyLength, elbowFloor = graph.bones[limb.bones[0]!]!.end.h * 1.3 + margin;
    const solve = () => { let out = solveArm(limb, sock, target, heading, wrist, grip); for (const raise of [0.5, 1, 2, 4, 16]) { if (out.points[1]!.y >= elbowFloor) break; out = solveArm(limb, sock, target, heading, wrist, grip, raise); } return out; };
    let solved = solve();
    // fingers, pincers and claws reach up to ARM_DIGIT_REACH finger lengths past the finger joint; raise the hand to clear them
    for (let k = 0; k < 3; k++) {
      const deficit = margin - armHandLowest(graph, limb, solved);
      if (deficit <= 0) break;
      target.y += deficit; solved = solve();
    }
    maxReach = Math.max(maxReach, solved.reachError);
    limb.bones.forEach((bi, k) => { world[bi] = {p: solved.points[k]!, q: solved.frames[k]!}; });
  }

  // ---- treadmill display keeps the animal centred; `travel` restores world positions
  let maxLen = 0, minBody = Infinity, maxPen = 0, minSwing = Infinity;
  for (let i = 0; i < n; i++) {
    const wq = world[i]!;
    const pi=i*3,qi=i*4;
    positions[pi]=wq.p.x;positions[pi+1]=wq.p.y;positions[pi+2]=wq.p.z;
    quaternions[qi]=wq.q.x;quaternions[qi+1]=wq.q.y;quaternions[qi+2]=wq.q.z;quaternions[qi+3]=wq.q.w;
  }
  for (const limb of graph.limbs) {
    for (let k = 0; k + 1 < limb.bones.length && k < limb.segments.length; k++) {
      if (limb.kind === 'arm' && k >= 2) break;
      const a = world[limb.bones[k]!]!.p, c = world[limb.bones[k + 1]!]!.p;
      maxLen = Math.max(maxLen, Math.abs(a.distanceTo(c) - limb.segments[k]!));
    }
  }
  for (const c of contacts) {
    const floor = environment?.ground?.(c.contact[0], c.contact[2]) ?? 0, clearance = c.contact[1] - floor;
    if (c.stance) maxPen = Math.max(maxPen, Math.max(0, -clearance), Math.abs(clearance)); else minSwing = Math.min(minSwing, clearance);
  }
  minBody = limbless ? Math.min(...torso.map(bi => world[bi]!.p.y - graph.bones[bi]!.start.h * radialScale[bi]! + graph.bones[bi]!.start.yc)) : lowestTorso();
  return {motion, time: t, positions, quaternions, radialScale, chordScale, travel, contacts,
    diagnostics: {maxBoneLengthError: maxLen, maxReachError: maxReach, maxStancePenetration: maxPen, minSwingClearance: Number.isFinite(minSwing) ? minSwing : 0, minBodyClearance: minBody, jointCount: n,...(supportHeight?{supportHeight}:{})}};
}

/** Serpentine or peristaltic crawl. Body segments follow a sinuous track that
 * is fixed in the world (heading depends on track arc length), so segments
 * slide along their own path instead of being dragged sideways. Bone lengths
 * are exact; the display is re-centred (treadmill) and the returned value is
 * the world distance travelled. */
function crawl(graph: ComposerGraph, motion: ComposerMotion, t: number, world: {p: THREE.Vector3; q: THREE.Quaternion}[], radialScale: Float64Array, neckTurn = 0): number {
  const loco = graph.locomotion, {torso, tail} = graph.chains;
  const peristaltic = loco.gait === 'peristaltic-crawl';
  const L = graph.dims.bodyLength;
  const wavelength = (peristaltic ? 0.9 : 0.62) * L;
  const amplitude = motion === 'walk' ? (peristaltic ? 0.12 : 0.55) : motion === 'display' ? 0.32 : 0.16;
  const advance = motion === 'walk' ? loco.speed * t : 0;
  const drift = motion === 'walk' ? 0 : 0.18 * Math.sin(TAU * t / 6);
  const heading = (s: number) => amplitude * Math.sin(TAU * (s / wavelength + drift));
  // tail tip -> neck base; tail bones point rearward from their body-side origin
  const order = [...[...tail].reverse(), ...torso];
  const joints: THREE.Vector3[] = [];
  if (peristaltic) torso.forEach((bi, k) => { radialScale[bi] = 1 + (motion === 'walk' ? 0.13 : 0.04) * Math.sin(TAU * t / loco.period - TAU * k / 5); });
  const restY = (bi: number, atStart: boolean) => { const b = graph.bones[bi]!, s = atStart ? b.start : b.end; return s.h * radialScale[bi]! - s.yc; };
  let s = 0;
  // a joint shared by two differently scaled bones rests on the larger of their two sections
  const near = (bi: number) => restY(bi, graph.bones[bi]!.part !== 'tail'), far = (bi: number) => restY(bi, graph.bones[bi]!.part === 'tail');
  // Joint heights: each joint rests on the larger of its two sections. The front joint also carries the
  // (unscaled) neck start, so a contracted front segment cannot pull the neck's underside into the floor.
  const heights = order.map((bi, k) => k ? Math.max(far(order[k - 1]!), near(bi)) : near(bi));
  const neck0 = graph.chains.neck[0], neckStart = neck0 === undefined ? 0 : graph.bones[neck0]!.start.h - graph.bones[neck0]!.start.yc;
  const front = graph.bones[order[order.length - 1]!]!;
  // Blended skin reaches back about half a segment with up to half weight on the neck: sag <= ~0.1 x length x sin(turn).
  heights.push(Math.max(far(front.index), neckStart) + 0.1 * front.length * Math.sin(Math.min(Math.PI / 2, neckTurn)) + front.end.h * (1 - Math.cos(Math.min(Math.PI / 2, neckTurn))) * 0.5);
  // A tail-tip ornament (tuft, club, fan) needs its own vertical radius under the tip, and its bone must not point
  // down into the ground (a later lift would add an unbudgeted bend at the tip joint).
  const ornament = tail.length ? composerTailTipBounds(graph.recipe, L, graph.bones[tail[tail.length - 1]!]!) : [];
  if (ornament.length) heights[0] = Math.max(heights[0]!, ...ornament.map(([, , , ry, rz]) => Math.max(ry, 0.2 * rz)));
  // Raise joints (never lower them) so no segment needs more than the 30 degree slope the placement allows;
  // otherwise a short steep tail would leave the rump joint below its section.
  const slope = (k: number) => 0.5 * graph.bones[order[k]!]!.length, base = heights.slice();
  const feasible = () => {
    if (ornament.length) {
      // the tip bone runs from joint 1 to the tip (joint 0); a tilted ornament reaches down by its length too
      const len = graph.bones[order[0]!]!.length;
      heights[0] = Math.max(heights[0]!, heights[1]!);
      for (let i = 0; i < 4; i++) {
        const sy = clamp((heights[0]! - heights[1]!) / len, -0.5, 0.5), cy = Math.sqrt(1 - sy * sy);
        const low = Math.min(...ornament.map(([x, , rx, ry]) => heights[0]! + sy * x - Math.hypot(rx * sy, ry * cy)));
        if (low >= 0.006 * L) break;
        heights[0] = heights[0]! + 0.006 * L - low;
      }
    }
    for (let k = 0; k < order.length; k++) heights[k + 1] = Math.max(heights[k + 1]!, heights[k]! - slope(k));
    for (let k = order.length - 1; k >= 0; k--) heights[k] = Math.max(heights[k]!, heights[k + 1]! - slope(k));
  };
  feasible();
  // Skin blended across a joint sags by about 0.1 x length x sin(pitch) + h(1 - cos roll), where pitch and roll are
  // how far the joint's relative rotation moved from bind (the travelling wave's heading turns move skin sideways).
  const ths: number[] = []; { let arc = 0; for (const bi of order) { const len = graph.bones[bi]!.length; ths.push(heading(arc + advance + len * 0.5)); arc += len; } }
  const margins = heights.map(() => 0);
  for (let round = 0; round < 3; round++) {
    const dir = (k: number) => { const pitch = Math.asin(clamp((heights[k + 1]! - heights[k]!) / graph.bones[order[k]!]!.length, -0.5, 0.5)); return V(Math.cos(ths[k]!) * Math.cos(pitch), Math.sin(pitch), -Math.sin(ths[k]!) * Math.cos(pitch)); };
    const skinQ = (k: number) => { const bone = graph.bones[order[k]!]!, d = dir(k); return composerFrame(bone.part === 'tail' ? d.negate() : d, UP).multiply(q4(bone.restQuaternion).invert()); };
    const margin = (k: number) => {
      // relative skinning rotation in the previous bone's bind frame: about local Z (pitch) it moves blended skin
      // vertically, about local X (roll) it drops the underside, about local Y (heading) it only moves skin sideways
      const bindPrev = q4(graph.bones[order[k - 1]!]!.restQuaternion);
      const rel = bindPrev.clone().invert().multiply(skinQ(k - 1).invert().multiply(skinQ(k))).multiply(bindPrev);
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      const angle = 2 * Math.acos(Math.min(1, rel.w)), sinHalf = Math.sqrt(Math.max(0, 1 - rel.w * rel.w));
      const pitch = sinHalf > 1e-9 ? Math.min(Math.PI / 2, Math.abs(angle * rel.z / sinHalf)) : 0, roll = sinHalf > 1e-9 ? Math.min(Math.PI / 2, Math.abs(angle * rel.x / sinHalf)) : 0;
      const len = Math.min(graph.bones[order[k]!]!.length, graph.bones[order[k - 1]!]!.length);
      return base[k]! * (1 - Math.cos(roll)) + 0.1 * len * Math.sin(pitch);
    };
    // margins only grow between rounds: raising one joint changes its neighbours' bends, which would otherwise oscillate
    heights.forEach((_, k) => { margins[k] = Math.max(margins[k]!, k > 0 && k < order.length ? margin(k) : 0); });
    margins.forEach((m, k) => { heights[k] = base[k]! + m; });
    feasible();
  }
  let p = V(0, heights[0]! + GROUND_EPSILON, 0);
  joints.push(p.clone());
  const dirs: THREE.Vector3[] = [];
  for (const [k, bi] of order.entries()) {
    const bone = graph.bones[bi]!;
    const nextY = heights[k + 1]! + GROUND_EPSILON;
    const dy = clamp(nextY - p.y, -0.5 * bone.length, 0.5 * bone.length);
    const th = heading(s + advance + bone.length * 0.5), flat = Math.sqrt(bone.length * bone.length - dy * dy);
    const dir = V(Math.cos(th) * flat, dy, -Math.sin(th) * flat).multiplyScalar(1 / bone.length);
    dirs.push(dir); p = p.clone().addScaledVector(dir, bone.length); joints.push(p); s += bone.length;
  }
  order.forEach((bi, k) => {
    const isTail = graph.bones[bi]!.part === 'tail';
    world[bi] = isTail ? {p: joints[k + 1]!.clone(), q: composerFrame(dirs[k]!.clone().negate(), UP)} : {p: joints[k]!.clone(), q: composerFrame(dirs[k]!, UP)};
  });
  if (tail.length) {
    const tipBone = graph.bones[tail[tail.length - 1]!]!, tip = world[tipBone.index]!;
    tip.q = liftTip(tip.p, tip.q, tipBone.length, composerTailTipBounds(graph.recipe, L, tipBone), 0.004 * L);
  }
  // treadmill: keep the torso centred on its bind centre
  const mean = (list: number[], k: 0 | 2, rest: boolean) => list.reduce((a, bi) => a + (rest ? graph.bones[bi]!.restPosition[k] : world[bi]!.p.getComponent(k)), 0) / list.length;
  const shift = V(mean(torso, 0, true) - mean(torso, 0, false), 0, mean(torso, 2, true) - mean(torso, 2, false));
  for (const bi of order) world[bi]!.p.add(shift);
  return advance * meanCos(amplitude);
}
function meanCos(amplitude: number) { let acc = 0; const steps = 64; for (let k = 0; k < steps; k++) acc += Math.cos(amplitude * Math.sin(TAU * (k + 0.5) / steps)); return acc / steps; }

/** Parent-child joint list (bone origin pairs) for skeleton display and tests. */
export function composerSkeletonSegments(graph: ComposerGraph): [number, number][] {
  return graph.bones.filter(b => b.parent >= 0).map(b => [b.parent, b.index]);
}
/** Plain summary of a graph's structure, useful in reports and UI. */
export function composerStructure(graph: ComposerGraph) {
  const count = (kind: ComposerLimbKind) => graph.limbs.filter(l => l.kind === kind).length;
  return {
    layout: graph.recipe.layout, gait: graph.locomotion.gait, bones: graph.bones.length, legs: count('leg'), arms: count('arm'), wings: count('wing'),
    torsoSegments: graph.chains.torso.length, neckBones: graph.chains.neck.length, tailBones: graph.chains.tail.length, trunkBones: graph.chains.trunk.length,
    bodyLength: graph.dims.bodyLength, height: graph.dims.socketHeight,
  };
}
