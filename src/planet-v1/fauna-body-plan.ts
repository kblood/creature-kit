import type { CreatureGenome } from './creature-model.ts';
import { quadrupedFaceBuildSteps, type FaunaFaceFeature, type FaunaFaceAttachment } from './fauna-face.ts';
import { FAUNA_APPEARANCE_VERSION, sampleFaunaCoat, type FaunaCoatSurface } from './fauna-appearance.ts';
import type { CoatRegion } from '../fauna-coat-vocab.ts';
import { appendFaunaStructuralFeatures } from './fauna-structural-appendages.ts';

/**
 * One continuous, skinned quadruped body plan derived from an existing
 * creature genome. The anatomy is a smooth union of genome-sized volumes
 * (hindquarters, chest, neck, head, tail and three-segment legs), polygonised
 * once in the bind pose with surface nets, so legs, neck and tail grow out of
 * the torso as one connected surface instead of touching primitives. Every
 * vertex is weighted to the 22-bone skeleton that the locomotion solver poses.
 *
 * Body space is metres: +X forward, +Y up, +Z = X x Y (the frame
 * `faunaGroundedTransform` gives each animal). Every bone has an identity bind
 * rotation, so a bone's inverse bind matrix is just its negated rest position.
 *
 * Building is exposed as a generator so a caller can time-slice it across
 * frames; `buildQuadrupedBody` runs it to completion. The output depends only
 * on the genome.
 */
export type Vec3 = [number, number, number];

export const QUADRUPED_BODY_VERSION = 'quadruped-body-4';
export const QUADRUPED_BONE_NAMES = [
  'root', 'pelvis', 'spine', 'chest', 'neck1', 'neck2', 'head', 'tail1', 'tail2', 'tail3',
  'rear-left-upper', 'rear-left-lower', 'rear-left-foot',
  'rear-right-upper', 'rear-right-lower', 'rear-right-foot',
  'front-left-upper', 'front-left-lower', 'front-left-foot',
  'front-right-upper', 'front-right-lower', 'front-right-foot',
] as const;
export const QUADRUPED_BONE_PARENTS: readonly number[] = [-1, 0, 1, 2, 3, 4, 5, 1, 7, 8, 1, 10, 11, 1, 13, 14, 3, 16, 17, 3, 19, 20];
export const BONE = { root: 0, pelvis: 1, spine: 2, chest: 3, neck1: 4, neck2: 5, head: 6, tail1: 7, tail2: 8, tail3: 9 } as const;
/** Upper-limb bone index of each leg, in `QuadrupedPlan.legs` order. */
export const LEG_UPPER_BONES = [10, 13, 16, 19] as const;
/** Grid-point ceiling for one body: bounds build memory/time on any genome. */
export const QUADRUPED_GRID_POINT_BUDGET = 200_000;

export interface QuadrupedLegPlan {
  id: string; rear: boolean; side: -1 | 1;
  parentBone: number; upperBone: number; lowerBone: number; footBone: number;
  /** Bind-pose joints in body space. `toe` is the hoof/pad sphere centre. */
  hip: Vec3; knee: Vec3; ankle: Vec3; toe: Vec3;
  upperLength: number; lowerLength: number; footLength: number;
  /** Rest pitch of the foot segment above the ground plane, radians. */
  footAngle: number;
  hipRadius: number; kneeRadius: number; ankleRadius: number; toeRadius: number;
  /** +1: the knee flexes toward +X (fore carpus); -1: toward -X (hind hock). */
  pole: 1 | -1;
}
export interface QuadrupedPrimitive {
  shape: 'cone' | 'ellipsoid'; bone: number; region: Region;
  /** Cone: segment ends and end radii. Ellipsoid: `a` centre, `b` radii. */
  a: Vec3; b: Vec3; ra: number; rb: number;
  /** Smooth-union radius joining this volume to everything before it. */
  blend: number;
}
export interface QuadrupedAppendage { kind: 'ear' | 'horn'; bone: number; base: Vec3; tip: Vec3; radius: number }
type Region = 'torso' | 'neck' | 'head' | 'tail' | 'upper' | 'lower' | 'foot' | 'armor';

export interface QuadrupedPlan {
  version: string;
  genome: CreatureGenome;
  bones: { name: string; parent: number; rest: Vec3 }[];
  legs: QuadrupedLegPlan[];
  torsoY: number;
  neckBase: Vec3; neckTip: Vec3; headCentre: Vec3; muzzleTip: Vec3; eyes: Vec3[];
  tailBase: Vec3; tailTip: Vec3;
  primitives: QuadrupedPrimitive[];
  appendages: QuadrupedAppendage[];
  /** Gait anatomy: stance duty factor, swing lift and preferred stride (m per cycle). */
  gait: { duty: number; liftM: number; strideM: number };
  /** Head reach used for grazing: lowest safe head-centre height above ground. */
  grazeClearanceM: number;
}

export interface QuadrupedBodyData {
  plan: QuadrupedPlan;
  positions: Float32Array; normals: Float32Array;
  /** Linear-light RGB, normalized Uint8. */
  colors: Uint8Array;
  skinIndex: Uint8Array;
  /** Normalized Uint8 weights; each vertex sums to exactly 255. */
  skinWeight: Uint8Array;
  index: Uint16Array | Uint32Array;
  /** Vertices/triangles of the single connected skin; appendages follow. */
  bodyVertexCount: number; bodyTriangleCount: number;
  vertexCount: number; triangleCount: number;
  cellM: number; grid: [number, number, number];
  faceFeatures: FaunaFaceFeature[];
  structuralVertexCount: number; structuralTriangleCount: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Two-bone analytic IK. `pole` is the direction the middle joint bends toward.
 * `reachError` is the distance the target was clamped by to stay reachable. */
export function solveTwoBone(root: Vec3, target: Vec3, upper: number, lower: number, pole: Vec3): { knee: Vec3; end: Vec3; reachError: number } {
  const delta = sub(target, root), distance = len(delta);
  const axis: Vec3 = distance > 1e-9 ? scale(delta, 1 / distance) : [0, -1, 0];
  const d = clamp(distance, Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6);
  const along = (upper * upper - lower * lower + d * d) / (2 * d), bend = Math.sqrt(Math.max(0, upper * upper - along * along));
  let bendDir = sub(pole, scale(axis, dot(pole, axis)));
  if (len(bendDir) < 1e-6) bendDir = Math.abs(axis[0]) < .9 ? sub([1, 0, 0], scale(axis, axis[0])) : sub([0, 1, 0], scale(axis, axis[1]));
  bendDir = norm(bendDir);
  return { knee: add(add(root, scale(axis, along)), scale(bendDir, bend)), end: add(root, scale(axis, d)), reachError: Math.abs(distance - d) };
}

/** Ankle position for a toe resting on a plane with normal `up`, the foot
 * segment pitched `angle` above the plane along the plane-projected `forward`. */
export function ankleFromToe(toe: Vec3, forward: Vec3, up: Vec3, length: number, angle: number): Vec3 {
  const f = norm(sub(forward, scale(up, dot(forward, up))));
  return add(add(toe, scale(f, -length * Math.cos(angle))), scale(up, length * Math.sin(angle)));
}

export function createQuadrupedPlan(genome: CreatureGenome): QuadrupedPlan {
  const g = genome;
  for (const field of ['torsoLength', 'torsoHeight', 'torsoWidth', 'legLength', 'upperLegFraction', 'stanceWidth', 'neckLength', 'neckRise', 'headLength', 'headWidth', 'tailLength', 'footLength', 'footWidth', 'strideLength'] as const)
    if (!Number.isFinite(g?.[field]) || g[field] < 0) throw new Error(`Invalid creature genome field ${field}`);
  const TL = g.torsoLength, th = g.torsoHeight, TW = g.torsoWidth, L = g.legLength, HL = g.headLength, HW = g.headWidth;
  // fauna-appearance-2 phenotype: a neonate's short muzzle and domed cranium,
  // and a male's heavier neck. Legacy and v1 genomes keep factor 1.
  const coat = g.appearance?.version === FAUNA_APPEARANCE_VERSION ? g.appearance : undefined;
  const muzzle = coat?.growth.stage === 'juvenile' ? .8 + .2 * clamp(coat.growth.maturity, 0, 1) : 1;
  const neckGirth = coat?.individual.sex === 'male' ? 1 + .06 * clamp(coat.profile.dimorphism, 0, 1) : 1;
  /** Head-local x offset (in HL) beyond the muzzle base, shortened by `muzzle`. */
  const snout = (offset: number) => offset <= .25 ? offset : .25 + (offset - .25) * muzzle;
  // Matches the instanced far representation (torso at L + .36th, neck from
  // .42TL, head .3HL beyond the neck tip), so near/far handoff keeps silhouette.
  const torsoY = L + th * .36;
  const neckBase: Vec3 = [TL * .42, torsoY + th * .12, 0];
  const neckTip: Vec3 = [neckBase[0] + g.neckLength * .35, neckBase[1] + g.neckRise + g.neckLength * .66, 0];
  const neckMid = lerp3(neckBase, neckTip, .5);
  const headCentre: Vec3 = [neckTip[0] + HL * .12, neckTip[1] + HW * .08, 0];
  const muzzleBase: Vec3 = [neckTip[0] + HL * .25, neckTip[1] - HW * .02, 0], muzzleTip: Vec3 = [neckTip[0] + HL * snout(.66), neckTip[1] - HW * (.02 + .12 * muzzle), 0];
  const tailBase: Vec3 = [-TL * .46, torsoY + th * .1, 0];
  const tailDir = norm([-.9, -.16, 0]), tailTip = add(tailBase, scale(tailDir, g.tailLength));
  const bones: QuadrupedPlan['bones'] = QUADRUPED_BONE_NAMES.map((name, i) => ({ name, parent: QUADRUPED_BONE_PARENTS[i]!, rest: [0, 0, 0] as Vec3 }));
  const setRest = (i: number, p: Vec3) => { bones[i]!.rest = [...p]; };
  setRest(BONE.pelvis, [-TL * .2, torsoY, 0]); setRest(BONE.spine, [0, torsoY, 0]); setRest(BONE.chest, [TL * .2, torsoY, 0]);
  setRest(BONE.neck1, neckBase); setRest(BONE.neck2, neckMid); setRest(BONE.head, neckTip);
  for (let i = 0; i < 3; i++) setRest(BONE.tail1 + i, add(tailBase, scale(tailDir, g.tailLength * i / 3)));

  // Foot pitch follows foot/leg proportion: long feet are plantigrade-like,
  // short feet stand up on digits. Radii keep limbs load-bearing in scale.
  const footAngle = clamp(1.25 - (g.footLength / Math.max(L, .1)) * 1.6, .35, 1.05), footLength = g.footLength * .8;
  const toeRadius = Math.max(g.footWidth * .42, .02), ankleRadius = Math.max(g.footWidth * .3, L * .028, .016), kneeRadius = Math.max(g.footWidth * .38, L * .042, ankleRadius * 1.15);
  const legs: QuadrupedLegPlan[] = [];
  const primitives: QuadrupedPrimitive[] = [];
  const duty = .68, strideM = Math.max(.18, g.strideLength), liftM = clamp(L * .11, .04, .22);
  const cone = (bone: number, region: Region, a: Vec3, b: Vec3, ra: number, rb: number, blend: number) => primitives.push({ shape: 'cone', bone, region, a, b, ra, rb, blend });
  const ellipsoid = (bone: number, region: Region, c: Vec3, r: Vec3, blend: number) => primitives.push({ shape: 'ellipsoid', bone, region, a: c, b: r, ra: Math.min(...r), rb: Math.min(...r), blend });

  // Torso: hindquarters, barrel and a deeper chest joined into one trunk.
  ellipsoid(BONE.pelvis, 'torso', [-TL * .2, torsoY + th * .03, 0], [TL * .33, th * .47, TW * .48], 0);
  // The abdomen is an oval barrel with a slight tuck toward the pelvis;
  // a round axial capsule made thin animals look like rigid tubes.
  ellipsoid(BONE.spine, 'torso', [-TL * .035, torsoY + th * .025, 0], [TL * .36, th * .42, TW * .43], th * .14);
  ellipsoid(BONE.chest, 'torso', [TL * .17, torsoY - th * .01, 0], [TL * .36, th * .52, TW * .5], th * .14);
  // Neck, head and muzzle.
  const neckRoot = clamp(HW * .55 * neckGirth, .03, Math.min(th * .38, TW * .45)), neckEnd = Math.max(HW * .3 * neckGirth, .02);
  cone(BONE.neck1, 'neck', neckBase, neckMid, neckRoot, (neckRoot + neckEnd) / 2, neckRoot * .8);
  cone(BONE.neck2, 'neck', neckMid, neckTip, (neckRoot + neckEnd) / 2, neckEnd, neckEnd * .6);
  const broadSkull = g.morphology?.family === 'proboscidean';
  const dome = 1 + .5 * (1 - muzzle);
  ellipsoid(BONE.head, 'head', headCentre, [HL * .34, HW * (broadSkull ? .57 : .45) * dome, HW * (broadSkull ? .51 : .46)], neckEnd * .8);
  cone(BONE.head, 'head', muzzleBase, muzzleTip, HW * .34, HW * .2, HW * .18);
  // Joined mandible and nasal bridge give the muzzle a lower jaw and a
  // flattened, broad nose while preserving the existing facial landmarks.
  ellipsoid(BONE.head, 'head', [neckTip[0] + HL * snout(.34), neckTip[1] - HW * .12, 0], [HL * .32 * (.5 + .5 * muzzle), HW * .25, HW * .32], HW * .12);
  ellipsoid(BONE.head, 'head', [muzzleTip[0] - HL * .025, muzzleTip[1] + HW * .035, 0], [HL * .15, HW * .22, HW * .25], HW * .09);
  // Tail: three tapering segments, each owned by its own bone.
  if (g.tailLength > .04) for (let i = 0; i < 3; i++) {
    const r0 = Math.max(TW * (.13 - i * .03), .012), r1 = Math.max(TW * (.1 - i * .03), .008);
    cone(BONE.tail1 + i, 'tail', add(tailBase, scale(tailDir, g.tailLength * i / 3)), add(tailBase, scale(tailDir, g.tailLength * (i + 1) / 3)), r0, r1, i ? r0 * .5 : TW * .12);
  }
  // Legs, in QUADRUPED_BONE_NAMES order: rear-left, rear-right, front-left, front-right.
  for (const rear of [true, false]) for (const side of [-1, 1] as const) {
    const index = legs.length, upperBone = LEG_UPPER_BONES[index]!;
    const hipX = (rear ? -.3 : .3) * TL, hip: Vec3 = [hipX, torsoY - th * (rear ? .05 : .02), side * TW * .3];
    const toe: Vec3 = [hipX + (rear ? .04 : .02) * TL, toeRadius, side * g.stanceWidth * .5];
    const ankle = ankleFromToe(toe, [1, 0, 0], [0, 1, 0], footLength, footAngle);
    // The chain is longer than the rest span, giving a flexed stance that can
    // still reach both ends of the stance sweep on a slope; upperLegFraction
    // splits it as in the genome.
    const sweep = duty * Math.max(.18, g.strideLength) * .55, span = len(sub(ankle, hip));
    const extreme = Math.max(len(sub(add(ankle, [sweep, 0, 0]), hip)), len(sub(add(ankle, [-sweep, 0, 0]), hip)));
    const chain = Math.max(span * 1.1, (extreme + L * .05) * 1.03), upperLength = chain * g.upperLegFraction, lowerLength = chain - upperLength;
    const pole: 1 | -1 = rear ? -1 : 1, { knee } = solveTwoBone(hip, ankle, upperLength, lowerLength, [pole, 0, 0]);
    const hipRadius = Math.max(th * (rear ? .26 : .22), kneeRadius * 1.6);
    legs.push({ id: `${rear ? 'rear' : 'front'}-${side < 0 ? 'left' : 'right'}`, rear, side, parentBone: rear ? BONE.pelvis : BONE.chest, upperBone, lowerBone: upperBone + 1, footBone: upperBone + 2,
      hip, knee, ankle, toe, upperLength, lowerLength, footLength, footAngle, hipRadius, kneeRadius, ankleRadius, toeRadius, pole });
    setRest(upperBone, hip); setRest(upperBone + 1, knee); setRest(upperBone + 2, ankle);
    // The limb root sits inside the trunk; blending there forms haunch/shoulder.
    // These longitudinal muscle volumes fade into the moving upper limb and
    // the trunk instead of presenting a spherical shoulder stuck to its side.
    const muscleCentre = lerp3(hip, knee, rear ? .22 : .18);
    ellipsoid(upperBone, 'upper', muscleCentre,
      [hipRadius * (rear ? 1.0 : .83), Math.min(upperLength * .37, th * .39), hipRadius * .75], hipRadius * .65);
    cone(upperBone, 'upper', hip, knee, hipRadius, kneeRadius, hipRadius * .55);
    cone(upperBone + 1, 'lower', knee, ankle, kneeRadius, ankleRadius, kneeRadius * .5);
    cone(upperBone + 2, 'foot', ankle, toe, ankleRadius, toeRadius, ankleRadius * .45);
    // Broad toe pad/hoof; its sole remains at y=0 in the bind pose. Do not
    // change the IK contact point or the existing 22-bone skeleton.
    const footType = g.morphology?.footType;
    if (footType === 'hoof') {
      // Two joined keratin toes; the forward split stays visible beyond the
      // supporting round ankle volume without disconnecting the skin.
      for (const digit of [-1, 1]) ellipsoid(upperBone + 2, 'foot',
        [toe[0] + toeRadius * .55, toeRadius * .88, toe[2] + digit * g.footWidth * .24],
        [toeRadius * 1.15, toeRadius * .88, g.footWidth * .22], 0);
    } else if (footType === 'paw') {
      ellipsoid(upperBone + 2, 'foot', [toe[0], toe[1], toe[2]], [toeRadius * 1.1, toeRadius, g.footWidth * .46], 0);
      for (const digit of [-1, 0, 1]) ellipsoid(upperBone + 2, 'foot',
        [toe[0] + toeRadius * (.7 - Math.abs(digit) * .1), toeRadius * .68, toe[2] + digit * g.footWidth * .29],
        [toeRadius * .85, toeRadius * .68, g.footWidth * .21], 0);
    } else {
      ellipsoid(upperBone + 2, 'foot', [toe[0] + toeRadius * .1, toe[1], toe[2]],
        [toeRadius * (footType === 'broad-pad' || g.archetype === 'low-slung' ? 1.55 : 1.3), toeRadius, g.footWidth * .49], 0);
    }
  }
  // Dorsal armor belongs to the authored low-bodied family. Legacy browser
  // genomes carry a small nonzero armor value that produced accidental plates.
  if (g.archetype === 'low-slung' && g.armor > .05) {
    const plates = Math.max(2, Math.min(6, Math.round(2 + g.armor * 4)));
    for (let i = 0; i < plates; i++) {
      const x = -TL * .3 + i * TL * .6 / Math.max(1, plates - 1);
      ellipsoid(x < -TL * .1 ? BONE.pelvis : x > TL * .1 ? BONE.chest : BONE.spine, 'armor', [x, torsoY + th * .4, 0], [TL / plates * .42, th * (.08 + g.armor * .06), TW * .44], th * .03);
    }
  }
  const appendages: QuadrupedAppendage[] = [];
  for (const side of [-1, 1]) {
    if (g.earLength > .01) {
      const lateral = g.morphology?.family === 'proboscidean';
      const base: Vec3 = [neckTip[0] - HL * .02, neckTip[1] + HW * (lateral ? .2 : .3), side * HW * (lateral ? .32 : .26)];
      appendages.push({ kind: 'ear', bone: BONE.head, base,
        tip: add(base, scale(norm(lateral ? [-.12, -.12, side] : [-.35, 1, side * .45]), g.earLength + HW * .2)),
        radius: Math.max(HW * (lateral ? .25 : .12), .012) });
    }
    if (g.hornLength > .01) { const base: Vec3 = [neckTip[0] + HL * .1, neckTip[1] + HW * .35, side * HW * .2]; appendages.push({ kind: 'horn', bone: BONE.head, base, tip: add(base, scale(norm([.35, 1, side * .25]), g.hornLength + HW * .2)), radius: Math.max(HW * .1, .01) }); }
  }
  const eyes: Vec3[] = [-1, 1].map(side => [neckTip[0] + HL * .3, neckTip[1] + HW * .2, side * HW * .36]);
  return { version: QUADRUPED_BODY_VERSION, genome: g, bones, legs, torsoY, neckBase, neckTip, headCentre, muzzleTip, eyes, tailBase, tailTip, primitives, appendages,
    gait: { duty, liftM, strideM }, grazeClearanceM: HW * .5 + .02 };
}

// ---------------------------------------------------------------------------
// Signed distance fields (negative inside).
// ---------------------------------------------------------------------------

/** Round cone (Inigo Quilez, MIT): a capsule with different end radii. */
function sdRoundCone(px: number, py: number, pz: number, a: Vec3, b: Vec3, r1: number, r2: number): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  if (a2 <= 1e-12) return Math.min(Math.hypot(pax, pay, paz) - r1, Math.hypot(px - b[0], py - b[1], pz - b[2]) - r2);
  const il2 = 1 / l2, y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y, x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2, k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdEllipsoid(px: number, py: number, pz: number, c: Vec3, r: Vec3): number {
  const x = px - c[0], y = py - c[1], z = pz - c[2];
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]), k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 < 1e-12 ? -Math.min(r[0], r[1], r[2]) : k0 * (k0 - 1) / k1;
}
export function primitiveDistance(p: QuadrupedPrimitive, x: number, y: number, z: number): number {
  return p.shape === 'cone' ? sdRoundCone(x, y, z, p.a, p.b, p.ra, p.rb) : sdEllipsoid(x, y, z, p.a, p.b);
}
function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * .25;
}
/** The complete body field, evaluated exactly as the grid accumulates it. */
export function quadrupedBodyDistance(plan: QuadrupedPlan, x: number, y: number, z: number): number {
  let d = 1e9;
  for (const p of plan.primitives) d = smoothMin(d, primitiveDistance(p, x, y, z), p.blend);
  return d;
}
function primitiveBounds(p: QuadrupedPrimitive): [Vec3, Vec3] {
  if (p.shape === 'ellipsoid') return [sub(p.a, p.b), add(p.a, p.b)];
  return [[Math.min(p.a[0] - p.ra, p.b[0] - p.rb), Math.min(p.a[1] - p.ra, p.b[1] - p.rb), Math.min(p.a[2] - p.ra, p.b[2] - p.rb)],
    [Math.max(p.a[0] + p.ra, p.b[0] + p.rb), Math.max(p.a[1] + p.ra, p.b[1] + p.rb), Math.max(p.a[2] + p.ra, p.b[2] + p.rb)]];
}

// ---------------------------------------------------------------------------
// Colour.
// ---------------------------------------------------------------------------

function linearHex(hex: string): Vec3 {
  const hit = /^#?([0-9a-f]{6})$/i.exec(hex || ''), v = Number.parseInt(hit ? hit[1]! : '778877', 16);
  const c = (n: number) => { const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; };
  return [c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255)];
}
function coatMark(plan: QuadrupedPlan, x: number, y: number): number {
  const g = plan.genome, u = x / g.torsoLength, v = (y - plan.torsoY) / Math.max(g.torsoHeight, .1);
  if (g.pattern === 'stripes') return Math.max(0, Math.sin((u * 7.5 + v * .65) * Math.PI * 2) - .37) / .63;
  if (g.pattern === 'spots') {
    const gx = u * 7.2, gy = v * 2.7, cx = Math.floor(gx) + .5 + Math.sin(Math.floor(gy) * 19.1) * .17, cy = Math.floor(gy) + .5 + Math.sin(Math.floor(gx) * 11.7) * .16;
    return Math.max(0, 1 - Math.hypot(gx - cx, gy - cy) / .37);
  }
  return 0;
}

/** Fraction of `p` along a->b, clamped to 0..1. */
function alongSegment(a: Vec3, b: Vec3, x: number, y: number, z: number): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz;
  return l2 > 1e-12 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2, 0, 1) : 0;
}
/** Head fraction (cranium back to muzzle tip) where the muzzle region begins. */
const MUZZLE_START = .62, TAIL_TIP_START = .75;
/** Coat region and proximal-to-distal position of a skin vertex, from the
 * volume that owns it. */
function coatRegionAt(plan: QuadrupedPlan, prim: QuadrupedPrimitive, x: number, y: number, z: number, out: FaunaCoatSurface): CoatRegion {
  switch (prim.region) {
    case 'neck': out.along = alongSegment(plan.neckBase, plan.neckTip, x, y, z); return 'neck';
    case 'tail': {
      const t = alongSegment(plan.tailBase, plan.tailTip, x, y, z);
      if (t < TAIL_TIP_START) { out.along = t / TAIL_TIP_START; return 'tail'; }
      out.along = (t - TAIL_TIP_START) / (1 - TAIL_TIP_START); return 'tail-tip';
    }
    case 'head': {
      const HL = plan.genome.headLength, back: Vec3 = [plan.headCentre[0] - HL * .34, plan.headCentre[1], 0];
      const t = alongSegment(back, plan.muzzleTip, x, y, 0);
      if (t < MUZZLE_START) { out.along = t / MUZZLE_START; return 'head'; }
      out.along = (t - MUZZLE_START) / (1 - MUZZLE_START); return 'muzzle';
    }
    case 'upper': case 'lower': case 'foot': {
      const leg = plan.legs[Math.max(0, Math.min(3, Math.floor((prim.bone - LEG_UPPER_BONES[0]) / 3)))]!;
      if (prim.region === 'upper') { out.along = alongSegment(leg.hip, leg.knee, x, y, z); return 'limb-upper'; }
      if (prim.region === 'lower') { out.along = alongSegment(leg.knee, leg.ankle, x, y, z); return 'limb-lower'; }
      out.along = alongSegment(leg.ankle, leg.toe, x, y, z); return 'foot';
    }
    case 'armor': out.along = 0; return 'armor';
    default: out.along = 0; return 'torso';
  }
}

/** Shared connected-body paint arithmetic. The generator supplies its existing
 * nearest primitive so its geometry/weights and paint calculations stay identical. */
function connectedBodyColour(plan:QuadrupedPlan,nearest:number,x:number,y:number,z:number,ny0:number,coatV2:boolean,surface:FaunaCoatSurface,base:Vec3,accent:Vec3,hoof:Vec3):Vec3{
  const region = plan.primitives[nearest]!.region;
  let color:Vec3;
  if (coatV2) {
    // Socks, countershading and armour plates come from the coat itself.
    surface.dorsal = ny0;
    const coatRegion = coatRegionAt(plan, plan.primitives[nearest]!, x, y, z, surface);
    color = sampleFaunaCoat(plan.genome, x, y, z, plan.torsoY, coatRegion, surface)!;
  } else {
    const mark = region === 'torso' || region === 'neck' || region === 'upper' || region === 'tail' ? coatMark(plan, x, y) : 0;
    color = sampleFaunaCoat(plan.genome, x, y, z, plan.torsoY) ?? lerp3(base, accent, mark * .6);
    if (region === 'torso' || region === 'neck' || region === 'upper') color = lerp3(color, lerp3(accent, [1, 1, 1], .15), Math.max(0, -ny0 - .15) * .45);
    if (region === 'lower') color = scale(color, .82);
  }
  if (region === 'foot') {
    const footType = plan.genome.morphology?.footType;
    const darkening = footType === 'paw' ? .3 : footType === 'broad-pad' ? .55 : .9;
    color = lerp3(coatV2 ? color : scale(color, .7), hoof, clamp((plan.legs[0]!.ankle[1] - y) / Math.max(plan.legs[0]!.ankle[1], 1e-3) * 1.6, 0, darkening));
  }
  if (region === 'armor' && !coatV2) color = scale(accent, .85);
  return color;
}
export const QUADRUPED_BODY_COLOUR_SAMPLER_VERSION='quadruped-body-colour-sampler-1';
export interface QuadrupedBodyColourSampler {
  readonly version:typeof QUADRUPED_BODY_COLOUR_SAMPLER_VERSION;
  /** Borrowed immutable source; no regenerated specimen or copied genome. */
  readonly source:Readonly<QuadrupedBodyData>;
  /** Original connected-body colour field in linear RGB before quantization.
   * Supplemental ears/horns/structural/face colours are outside this API. */
  sampleInto(x:number,y:number,z:number,normalY:number,out:Float64Array):Float64Array;
}
/** Exact same colour/context as the connected-body builder. Uses source.cellM
 * as the canonical sampling footprint; callers do not silently change pattern
 * filtering. Scratch context is per sampler, and sampling must be sequential. */
export function createQuadrupedBodyColourSampler(source:Readonly<QuadrupedBodyData>):QuadrupedBodyColourSampler{
  if(!source?.plan?.primitives?.length||!Number.isFinite(source.cellM)||source.cellM<=0)throw new Error('quadruped body colour sampler: valid loaded source required');
  const plan=source.plan,base=linearHex(plan.genome.color),accent=linearHex(plan.genome.accentColor),hoof:Vec3=[.035,.03,.026];
  const coatV2=plan.genome.appearance?.version===FAUNA_APPEARANCE_VERSION&&!!plan.genome.appearance.coat;
  const surface:FaunaCoatSurface={dorsal:0,along:0,cellM:source.cellM};
  return {version:QUADRUPED_BODY_COLOUR_SAMPLER_VERSION,source,sampleInto(x,y,z,normalY,out){
    if(![x,y,z,normalY].every(Number.isFinite)||!(out instanceof Float64Array)||out.length<3)throw new Error('quadruped body colour sampler: finite point/normal and Float64 RGB output required');
    let nearest=0,dMin=Infinity;
    for(let p=0;p<plan.primitives.length;p++){const d=primitiveDistance(plan.primitives[p]!,x,y,z);if(d<dMin){dMin=d;nearest=p;}}
    const colour=connectedBodyColour(plan,nearest,x,y,z,normalY,coatV2,surface,base,accent,hoof);
    for(let c=0;c<3;c++)out[c]=colour[c]!;return out;
  }};
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

/** Resumable build. Each `yield` is a bounded unit of work (one volume, a few
 * grid slices, or a vertex batch), so callers can respect a frame budget. */
export function* quadrupedBodyBuildSteps(genome: CreatureGenome): Generator<void, QuadrupedBodyData, void> {
  const plan = createQuadrupedPlan(genome);
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  let minFeature = Infinity;
  for (const p of plan.primitives) {
    const [a, b] = primitiveBounds(p);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, a[i]! - p.blend); hi[i] = Math.max(hi[i]!, b[i]! + p.blend); }
    if (p.region !== 'tail') minFeature = Math.min(minFeature, p.ra, p.rb);
  }
  // Resolve the thinnest load-bearing limb, then coarsen only if the grid budget requires it.
  let cell = clamp(minFeature * .8, .012, .08);
  const extent = sub(hi, lo);
  const points = (c: number) => (Math.ceil(extent[0] / c) + 5) * (Math.ceil(extent[1] / c) + 5) * (Math.ceil(extent[2] / c) + 5);
  while (points(cell) > QUADRUPED_GRID_POINT_BUDGET) cell *= 1.06;
  const origin: Vec3 = [lo[0] - 2 * cell, lo[1] - 2 * cell, lo[2] - 2 * cell];
  const nx = Math.ceil(extent[0] / cell) + 5, ny = Math.ceil(extent[1] / cell) + 5, nz = Math.ceil(extent[2] / cell) + 5;
  const field = new Float32Array(nx * ny * nz).fill(1e9);
  yield;
  for (const p of plan.primitives) {
    const [a, b] = primitiveBounds(p), margin = p.blend + 2 * cell;
    const i0 = Math.max(0, Math.floor((a[0] - margin - origin[0]) / cell)), i1 = Math.min(nx - 1, Math.ceil((b[0] + margin - origin[0]) / cell));
    const j0 = Math.max(0, Math.floor((a[1] - margin - origin[1]) / cell)), j1 = Math.min(ny - 1, Math.ceil((b[1] + margin - origin[1]) / cell));
    const k0 = Math.max(0, Math.floor((a[2] - margin - origin[2]) / cell)), k1 = Math.min(nz - 1, Math.ceil((b[2] + margin - origin[2]) / cell));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const index = i + nx * (j + ny * k);
      field[index] = smoothMin(field[index]!, primitiveDistance(p, origin[0] + i * cell, origin[1] + j * cell, origin[2] + k * cell), p.blend);
    }
    yield;
  }
  // Surface nets: one vertex per sign-changing cell at the mean edge crossing.
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions: number[] = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const;
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const values = new Float64Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { const o = corner[c]!, v = field[i + o[0] + nx * (j + o[1] + ny * (k + o[2]))]!; values[c] = v; if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [e0, e1] of edges) {
        const a = values[e0]!, b = values[e1]!;
        if ((a < 0) === (b < 0)) continue;
        const t = a / (a - b), o0 = corner[e0]!, o1 = corner[e1]!;
        sx += o0[0] + (o1[0] - o0[0]) * t; sy += o0[1] + (o1[1] - o0[1]) * t; sz += o0[2] + (o1[2] - o0[2]) * t; n++;
      }
      cellVertex[i + cx * (j + cy * k)] = positions.length / 3;
      positions.push(origin[0] + (i + sx / n) * cell, origin[1] + (j + sy / n) * cell, origin[2] + (k + sz / n) * cell);
    }
    if (k % 8 === 7) yield;
  }
  // One quad per sign-changing grid edge, joining the four cells around it.
  const indices: number[] = [];
  const cellAt = (i: number, j: number, k: number) => cellVertex[i + cx * (j + cy * k)]!;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (flip) [b, d] = [d, b];
    // Split along the shorter diagonal for better-shaped triangles.
    const ac = (positions[a * 3]! - positions[c * 3]!) ** 2 + (positions[a * 3 + 1]! - positions[c * 3 + 1]!) ** 2 + (positions[a * 3 + 2]! - positions[c * 3 + 2]!) ** 2;
    const bd = (positions[b * 3]! - positions[d * 3]!) ** 2 + (positions[b * 3 + 1]! - positions[d * 3 + 1]!) ** 2 + (positions[b * 3 + 2]! - positions[d * 3 + 2]!) ** 2;
    if (ac <= bd) indices.push(a, b, c, a, c, d); else indices.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const inside = field[i + nx * (j + ny * k)]! < 0;
      if (inside !== (field[i + 1 + nx * (j + ny * k)]! < 0)) quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), !inside);
      if (inside !== (field[i + nx * (j + 1 + ny * k)]! < 0)) quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), !inside);
      if (inside !== (field[i + nx * (j + ny * (k + 1))]! < 0)) quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), !inside);
    }
    if (k % 8 === 7) yield;
  }
  const bodyVertexCount = positions.length / 3, bodyTriangleCount = indices.length / 3;
  // Appendages: rigid lathe cones rooted inside the skull, weighted to the head.
  const appendageStart = bodyVertexCount, appendageKinds: ('ear' | 'inner-ear' | 'horn')[] = [], appendageAlong: number[] = [];
  for (const a of plan.appendages) {
    const lateralEar = a.kind === 'ear' && plan.genome.morphology?.family === 'proboscidean';
    // Lateral pinnae spread in the vertical/lateral plane rather than turning
    // into horizontal fins when their axis moves away from upright.
    const axis = norm(sub(a.tip, a.base)), ref: Vec3 = lateralEar ? [1, 0, 0] : Math.abs(axis[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([axis[1] * ref[2] - axis[2] * ref[1], axis[2] * ref[0] - axis[0] * ref[2], axis[0] * ref[1] - axis[1] * ref[0]]);
    const v: Vec3 = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
    // A pinna widens beyond its embedded root, then tapers into a cupped,
    // curved leaf. Horns retain their compact conical construction.
    const ear = a.kind === 'ear';
    const start = positions.length / 3, segments = ear ? 12 : 7, flat = ear ? .16 : 1;
    const rings = ear ? [[0, .65], [.22, 1.65], [.52, 1.5], [.8, .8]] : [[0, 1], [.55, .5]];
    for (const [t, r] of rings) for (let s = 0; s < segments; s++) {
      const angle = s / segments * Math.PI * 2, rr = a.radius * r;
      const cup = ear ? a.radius * .25 * Math.sin(Math.PI * t) * Math.cos(angle) ** 2 : 0;
      positions.push(...add(lerp3(a.base, a.tip, t), add(scale(u, Math.cos(angle) * rr), scale(v, Math.sin(angle) * rr * flat + cup))));
      appendageKinds[positions.length / 3 - 1 - appendageStart] = ear && Math.sin(angle) > .1 && t > 0 ? 'inner-ear' : a.kind;
      appendageAlong[positions.length / 3 - 1 - appendageStart] = t;
    }
    positions.push(...a.tip, ...a.base);
    const tip = start + segments * rings.length, base = tip + 1;
    appendageKinds[tip - appendageStart] = a.kind; appendageKinds[base - appendageStart] = a.kind;
    appendageAlong[tip - appendageStart] = 1; appendageAlong[base - appendageStart] = 0;
    for (let s = 0; s < segments; s++) {
      const n = (s + 1) % segments;
      for (let ring = 0; ring < rings.length - 1; ring++) {
        const r = start + ring * segments;
        indices.push(r + s, r + n, r + segments + n, r + s, r + segments + n, r + segments + s);
      }
      const last = start + (rings.length - 1) * segments;
      indices.push(last + s, last + n, tip, start + n, start + s, base);
    }
  }
  const structuralStart = positions.length / 3, structuralTriangleStart = indices.length / 3;
  const structural = appendFaunaStructuralFeatures(plan, positions, indices);
  const structuralVertexCount = positions.length / 3 - structuralStart, structuralTriangleCount = indices.length / 3 - structuralTriangleStart;
  const faceStart = positions.length / 3, faceColors: Vec3[] = [];
  const faceAttachments: FaunaFaceAttachment[] = [];
  const faceFeatures = yield* quadrupedFaceBuildSteps(plan, positions, indices, bodyTriangleCount, faceColors, faceAttachments);
  yield;
  const vertexCount = positions.length / 3;
  const positionArray = new Float32Array(positions), normals = new Float32Array(vertexCount * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    const nx0 = uy * vz - uz * vy, ny0 = uz * vx - ux * vz, nz0 = ux * vy - uy * vx;
    for (const o of [a, b, c]) { normals[o] += nx0; normals[o + 1] += ny0; normals[o + 2] += nz0; }
  }
  for (let v = 0; v < vertexCount; v++) {
    const l = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!) || 1;
    normals[v * 3] /= l; normals[v * 3 + 1] /= l; normals[v * 3 + 2] /= l;
  }
  yield;
  // Skin weights: each volume influences vertices within its blend band of
  // the nearest surface, so joints deform smoothly rather than hinging.
  const skinIndex = new Uint8Array(vertexCount * 4), skinWeight = new Uint8Array(vertexCount * 4), colors = new Uint8Array(vertexCount * 3);
  const base = linearHex(plan.genome.color), accent = linearHex(plan.genome.accentColor), hoof: Vec3 = [.035, .03, .026], ivory: Vec3 = [.52, .46, .36];
  // fauna-appearance-2 coats are evaluated per vertex in torso-length space,
  // with signed z, the surface normal as the dorsal measure and the mesh cell
  // size as the sampling footprint; v1 and legacy genomes keep their coats.
  const coatV2 = plan.genome.appearance?.version === FAUNA_APPEARANCE_VERSION && !!plan.genome.appearance.coat;
  const surface: FaunaCoatSurface = { dorsal: 0, along: 0, cellM: cell };
  const boneWeight = new Float64Array(QUADRUPED_BONE_NAMES.length), distances = new Float64Array(plan.primitives.length);
  for (let v = 0; v < vertexCount; v++) {
    const x = positionArray[v * 3]!, y = positionArray[v * 3 + 1]!, z = positionArray[v * 3 + 2]!;
    boneWeight.fill(0);
    let color: Vec3;
    if (v >= faceStart) {
      // Interpolate the supporting skin triangle's weights, preserving the
      // existing neck/skull deformation instead of making a hard weight seam.
      const attachment = faceAttachments[v - faceStart]!;
      for (let i = 0; i < 3; i++) for (let s = 0; s < 4; s++) {
        const source = attachment.vertices[i]! * 4 + s;
        boneWeight[skinIndex[source]!] += skinWeight[source]! * Math.max(0, attachment.weights[i]!);
      }
      color = faceColors[v - faceStart]!;
    } else if (v >= structuralStart) {
      boneWeight[structural.bones[v - structuralStart]!] = 1;
      color = structural.colors[v - structuralStart]!;
    } else if (v >= appendageStart) {
      boneWeight[BONE.head] = 1;
      const kind = appendageKinds[v - appendageStart];
      if (kind === 'ear' && coatV2) {
        surface.dorsal = normals[v * 3 + 1]!; surface.along = appendageAlong[v - appendageStart] ?? 0;
        color = sampleFaunaCoat(plan.genome, x, y, z, plan.torsoY, 'ear', surface)!;
      } else color = kind === 'horn' ? lerp3(accent, ivory, .6) : kind === 'inner-ear' ? lerp3(base, [.22, .09, .07], .4) : lerp3(base, accent, .35);
    } else {
      let nearest = 0, dMin = Infinity;
      for (let p = 0; p < plan.primitives.length; p++) { const d = primitiveDistance(plan.primitives[p]!, x, y, z); distances[p] = d; if (d < dMin) { dMin = d; nearest = p; } }
      for (let p = 0; p < plan.primitives.length; p++) {
        const prim = plan.primitives[p]!, band = Math.max(prim.blend, Math.min(prim.ra, prim.rb) * .6, 1e-4);
        const w = Math.max(0, 1 - (distances[p]! - dMin) / band) ** 2;
        if (w > boneWeight[prim.bone]!) boneWeight[prim.bone] = w;
      }
      color = connectedBodyColour(plan, nearest, x, y, z, normals[v * 3 + 1]!, coatV2, surface, base, accent, hoof);
    }
    // Keep the four strongest bones, then quantize to an exact 255 sum.
    const top: number[] = [];
    for (let b = 0; b < boneWeight.length; b++) if (boneWeight[b]! > 0) top.push(b);
    top.sort((a, b) => boneWeight[b]! - boneWeight[a]! || a - b); top.length = Math.min(4, top.length);
    const total = top.reduce((s, b) => s + boneWeight[b]!, 0);
    let assigned = 0;
    for (let s = 0; s < 4; s++) {
      const b = top[s];
      skinIndex[v * 4 + s] = b ?? 0;
      const q = b === undefined ? 0 : Math.round(boneWeight[b]! / total * 255);
      skinWeight[v * 4 + s] = q; assigned += q;
    }
    skinWeight[v * 4] += 255 - assigned;
    for (let c = 0; c < 3; c++) colors[v * 3 + c] = Math.round(clamp(color[c]!, 0, 1) * 255);
    // Bounded colour/weight batches (coat evaluation included) per yield.
    if (v % 1500 === 1499) yield;
  }
  const index = vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  return { plan, positions: positionArray, normals, colors, skinIndex, skinWeight, index, bodyVertexCount, bodyTriangleCount, vertexCount, triangleCount: indices.length / 3, cellM: cell, grid: [nx, ny, nz], faceFeatures, structuralVertexCount, structuralTriangleCount };
}

export function buildQuadrupedBody(genome: CreatureGenome): QuadrupedBodyData {
  const steps = quadrupedBodyBuildSteps(genome);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}

/** Resident bytes for one CPU copy of a body's attributes and index. */
export function quadrupedBodyBytes(data: QuadrupedBodyData): number {
  return data.positions.byteLength + data.normals.byteLength + data.colors.byteLength + data.skinIndex.byteLength + data.skinWeight.byteLength + data.index.byteLength;
}
