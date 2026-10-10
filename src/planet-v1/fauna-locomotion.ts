import * as THREE from 'three';
import { ankleFromToe, BONE, QUADRUPED_BONE_PARENTS, solveTwoBone, type QuadrupedPlan, type Vec3 } from './fauna-body-plan.ts';
import type { PlanetFaunaPathMember, PlanetFaunaActivity as FaunaMemberActivity } from './caller-contract.ts';

/**
 * Closed-form planetary locomotion for a `QuadrupedPlan`.
 *
 * Every footfall is derived from the member's existing exact-date orbit
 * (`faunaMemberActivityAtWorldNs`), never from previous frames: gait phase is
 * the distance already walked round the orbit divided by an integral number of
 * strides per revolution. A stance foot's ground point is the body frame *at
 * its touchdown phase* applied to the touchdown foothold, so it stays fixed in
 * the herd's tangent frame even on the curved path, through idle windows and
 * at any seek. Heights and normals come from the herd's immutable ground
 * stencil, the same one that already places the animal's root.
 *
 * Tangent frame: x = anchor right, z = anchor forward, h = up (metres), as used
 * by `faunaGroundedTransform`. Body frame: +X facing, +Y up, +Z = X x Y.
 */
export type FaunaGround = (x: number, z: number) => number;
export type FaunaPathMember = PlanetFaunaPathMember;

/** Footfall order LH, LF, RH, RF (lateral-sequence walk); legs are ordered RL, RR, FL, FR. */
export const WALK_PHASE_OFFSETS = [0, .5, .75, .25] as const;
const BONES = QUADRUPED_BONE_PARENTS.length;
/** Largest total head-lowering flexion of the neck, radians. */
export const NECK_FLEX_LIMIT = 1.35;

export interface FaunaGaitSchedule {
  /** Whole gait cycles per orbit, so phase is exactly periodic with position. */
  cyclesPerRevolution: number;
  /** Distance walked per gait cycle, metres. */
  cycleM: number;
  /** Gait cycles per second while walking. */
  frequencyHz: number;
  duty: number; liftM: number;
}
export interface QuadrupedFootState {
  id: string; stance: boolean;
  /** Ground contact under the toe, tangent frame [x, h, z]. */
  contact: [number, number, number];
  /** Solved toe sphere centre, body frame. */
  toe: Vec3;
}
export interface QuadrupedPose {
  /** Local bone translations/rotations in QUADRUPED_BONE_NAMES order. */
  positions: Float64Array; quaternions: Float64Array;
  /** Body-frame joint positions after forward kinematics. */
  joints: Float64Array;
  feet: QuadrupedFootState[];
  root: { x: number; z: number; h: number; yaw: number };
  state: 'idle' | 'walk'; phase: number;
  /** Largest sole/knee/ankle depth below the stencil surface, metres. */
  maxPenetration: number;
  /** Largest distance a foot target was clamped by to stay within leg reach. */
  maxReachError: number;
  /** Lowest clearance of the head's muzzle/cranium above ground, metres. */
  headClearance: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const frac = (v: number) => v - Math.floor(v);
function hashUnit(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
}

export function faunaGaitSchedule(plan: QuadrupedPlan, member: FaunaPathMember, revolutionS: number): FaunaGaitSchedule {
  const circumference = Math.PI * 2 * Math.max(member.orbitRadiusM, 1e-3);
  const speed = Number.isFinite(revolutionS) && revolutionS > 0 ? circumference / revolutionS : 0;
  // Slow walkers shorten their stride instead of stepping unnaturally slowly.
  const preferred = Math.min(plan.gait.strideM, plan.genome.legLength * 1.2) * (.6 + .4 * clamp(speed / Math.max(plan.genome.walkSpeed, .1), 0, 1));
  const cycles = Math.max(3, Math.round(circumference / preferred));
  return { cyclesPerRevolution: cycles, cycleM: circumference / cycles, frequencyHz: speed > 0 ? cycles / revolutionS : 0, duty: plan.gait.duty, liftM: plan.gait.liftM };
}

/** Authored motion envelopes, not a biological simulation. Identity affects
 * small idle motions without changing the canonical path or activity clock. */
export function faunaMotionTraits(plan: QuadrupedPlan, memberId: string) {
  const g = plan.genome, massShape = clamp(g.torsoWidth / g.legLength, .2, 1.8);
  return {
    breathPeriodS: (3.2 + massShape * .5) * (.94 + hashUnit(`${memberId}/breath-rate`) * .12),
    breathPhase: hashUnit(`${memberId}/breath-phase`) * Math.PI * 2,
    breathM: clamp(g.torsoHeight * .0045, .001, .006),
    tailPhase: hashUnit(`${memberId}/tail-phase`) * Math.PI * 2,
    tailAmplitude: clamp(g.tailLength / Math.max(g.torsoLength, .1), .08, .8) * .18,
    headAmplitude: clamp(g.headWidth / Math.max(g.neckLength, .1), .12, 1) * .035,
  };
}

export interface FaunaPoseOptions { behaviour?: 'auto' | 'feed' | 'alert' }

/** Body frame after walking `travel` revolutions (any real value). */
function frameAt(member: FaunaPathMember, travel: number) {
  const sign = Math.sign(member.orbitAngularSpeed || 1), angle = member.orbitPhase + sign * travel * Math.PI * 2;
  return { x: member.anchorOffsetX + Math.cos(angle) * member.orbitRadiusM, z: member.anchorOffsetZ + Math.sin(angle) * member.orbitRadiusM, yaw: angle + sign * Math.PI * .5 };
}
/** Body-frame (X, Z) foothold to tangent (x, z). */
function toTangent(frame: { x: number; z: number; yaw: number }, X: number, Z: number): [number, number] {
  const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
  return [frame.x + X * c + Z * s, frame.z + X * s - Z * c];
}

// Scratch objects: the solver is synchronous and re-entrant per call.
const worldQ = Array.from({ length: BONES }, () => new THREE.Quaternion());
const worldP = Array.from({ length: BONES }, () => new THREE.Vector3());
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), va = new THREE.Vector3(), vb = new THREE.Vector3();
const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** Rotation taking the frame (a0 along, n0 normal) onto (a1, n1), twist-free. */
function frameRotation(a0: THREE.Vector3, n0: THREE.Vector3, a1: THREE.Vector3, n1: THREE.Vector3, out: THREE.Quaternion) {
  const b0 = new THREE.Vector3().crossVectors(n0, a0).normalize(), c0 = new THREE.Vector3().crossVectors(a0, b0);
  const b1 = new THREE.Vector3().crossVectors(n1, a1).normalize(), c1 = new THREE.Vector3().crossVectors(a1, b1);
  m0.makeBasis(a0, b0, c0); m1.makeBasis(a1, b1, c1);
  return out.setFromRotationMatrix(m1.multiply(m0.transpose()));
}
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

/**
 * Pose at one exact date. Pure: identical inputs give identical output
 * regardless of which dates were evaluated before.
 */
export function quadrupedPoseAt(plan: QuadrupedPlan, member: FaunaPathMember, activity: FaunaMemberActivity, ground: FaunaGround, rigSeconds: number, options: FaunaPoseOptions = {}): QuadrupedPose {
  const g = plan.genome, schedule = faunaGaitSchedule(plan, member, activity.revolutionS);
  const moving = schedule.frequencyHz > 0, walking = moving && activity.pose.gait === 'walk', tau = Math.max(0, activity.stateS);
  const N = schedule.cyclesPerRevolution, phase = activity.travel * N, duty = schedule.duty;
  const resumePhase = walking ? (activity.travel - tau / activity.revolutionS) * N : phase;
  const swingS = moving ? (1 - duty) / schedule.frequencyHz : .5;
  const root = frameAt(member, activity.travel), rootH = ground(root.x, root.z);
  const groundLocal = (X: number, Zs: number) => { const [x, z] = toTangent(root, X, Zs); return ground(x, z) - rootH; };
  const normalLocal = (x: number, z: number): THREE.Vector3 => {
    const e = .35, dx = (ground(x + e, z) - ground(x - e, z)) / (2 * e), dz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
    const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
    // Tangent normal (-dx, 1, -dz) expressed in the body frame.
    return new THREE.Vector3(-dx * c - dz * s, 1, -dx * s + dz * c).normalize();
  };
  // Locomotion weight eases body motion in and out of idle windows.
  const locomotion = walking ? smooth(tau / .6) : moving ? 1 - smooth(tau / .6) : 0;

  // --- Trunk: follow the stencil under hips and shoulders, with gait bob. ---
  const TL = g.torsoLength, hRear = groundLocal(-.3 * TL, 0), hFront = groundLocal(.3 * TL, 0);
  const pitch = Math.atan2(hFront - hRear, .6 * TL);
  const traits = faunaMotionTraits(plan, member.id);
  const breath = Math.sin(rigSeconds * Math.PI * 2 / traits.breathPeriodS + traits.breathPhase);
  const bob = -Math.cos(phase * Math.PI * 4) * g.legLength * .012 * locomotion + breath * traits.breathM;
  const roll = Math.sin(phase * Math.PI * 2) * .025 * locomotion;
  const positions = new Float64Array(BONES * 3), quaternions = new Float64Array(BONES * 4);
  const local = Array.from({ length: BONES }, () => new THREE.Quaternion());
  const offsets = plan.bones.map((bone, i) => i === 0 ? v3(bone.rest) : v3(bone.rest).sub(v3(plan.bones[bone.parent]!.rest)));
  // Pelvis sits on the straight line through the ground under hips and shoulders.
  offsets[BONE.pelvis]!.y += (hRear + hFront) / 2 - (.2 / .6) * (hFront - hRear) + bob;
  local[BONE.pelvis]!.setFromEuler(new THREE.Euler(roll, 0, pitch, 'XYZ'));
  local[BONE.spine]!.setFromAxisAngle(Z, breath * .006);

  // --- Tail: idle sway and a gait-locked swing. ---
  const sway = Math.sin(rigSeconds * Math.PI * 2 * .23 + traits.tailPhase) * traits.tailAmplitude * (1 - locomotion) + Math.sin(phase * Math.PI * 2) * .1 * locomotion;
  for (let i = 0; i < 3; i++) local[BONE.tail1 + i]!.setFromEuler(new THREE.Euler(0, sway * (1 + i * .35) * (i ? .6 : 1), i ? -.06 : -.12));

  // Forward kinematics up to the trunk and neck root.
  const fk = (i: number) => {
    const parent = QUADRUPED_BONE_PARENTS[i]!;
    if (parent < 0) { worldP[i]!.copy(offsets[i]!); worldQ[i]!.copy(local[i]!); return; }
    worldP[i]!.copy(offsets[i]!).applyQuaternion(worldQ[parent]!).add(worldP[parent]!);
    worldQ[i]!.multiplyQuaternions(worldQ[parent]!, local[i]!);
  };
  for (const i of [BONE.root, BONE.pelvis, BONE.spine, BONE.chest, BONE.neck1]) fk(i);

  // --- Neck and head: nod while walking; in idle either graze or look round. ---
  const idleWeight = 1 - locomotion, grazes = options.behaviour === 'feed' || (options.behaviour !== 'alert' && hashUnit(`${member.id}|${Math.round(activity.travel * 1e6)}`) < .62);
  // Rise before the idle window ends so walking never starts with a lowered head.
  const envelope = walking ? 0 : options.behaviour === 'feed' ? 1 : smooth((tau - 1.2) / 1.4) * (1 - smooth((tau - (member.gaitPeriodS - 2.4)) / 1.4));
  // A long rigid inspection trunk must not sweep through the floor during
  // neck flexion. Its feeding articulation needs a future segmented rig.
  const hasTrunk = (g.morphology?.trunkLength ?? 0) > 0;
  const graze = grazes && !hasTrunk ? envelope * idleWeight : 0, look = grazes && !hasTrunk ? 0 : envelope * idleWeight;
  const neckVector = v3(plan.neckTip).sub(v3(plan.neckBase)), neckReach = neckVector.length();
  const neckRest = Math.atan2(neckVector.y, neckVector.x);
  const headDown = -.55 * graze;
  // Lowest head point relative to the head joint for the chosen head pitch.
  qa.setFromAxisAngle(Z, headDown);
  const muzzle = v3(plan.muzzleTip).sub(v3(plan.neckTip)).applyQuaternion(qa), cranium = v3(plan.headCentre).sub(v3(plan.neckTip)).applyQuaternion(qa);
  const headGround = groundLocal(worldP[BONE.neck1]!.x + neckReach * Math.cos(neckRest), 0);
  const jointTarget = Math.max(headGround + .03 + g.headWidth * .2 - muzzle.y, headGround + .03 + g.headWidth * .45 - cranium.y);
  const currentAngle = neckRest + pitch;
  const reachAngle = Math.asin(clamp((jointTarget - worldP[BONE.neck1]!.y) / neckReach, -1, 1));
  // Flexion is limited and shared by both neck joints, like a vertebral
  // column; bending the neck shortens its reach, so the head only ends higher
  // than the rigid-neck estimate. Short necks lower the head as far as they can.
  const lower = clamp(Math.max(reachAngle, -1.45) - currentAngle, -NECK_FLEX_LIMIT, 0);
  const nod = Math.sin(phase * Math.PI * 4 + .8) * .045 * locomotion;
  local[BONE.neck1]!.setFromAxisAngle(Z, -pitch * .6 * (1 - graze) + lower * .55 * graze + nod);
  const lookYaw = Math.sin(tau * Math.PI * 2 / 5.5) * .45 * look;
  local[BONE.neck2]!.setFromEuler(new THREE.Euler(0, lookYaw * .5, lower * .45 * graze - nod * .5));
  fk(BONE.neck1); fk(BONE.neck2);
  // Head orientation is set in body terms, so grazing points the muzzle down
  // and a walking head stays near level whatever the neck and slope angles.
  qa.copy(worldQ[BONE.neck2]!).invert();
  qb.setFromEuler(new THREE.Euler(0, lookYaw + Math.sin(rigSeconds * .7 + traits.breathPhase) * traits.headAmplitude * idleWeight * (1 - graze), headDown + Math.sin(tau * Math.PI * 2 / 3.1) * .06 * graze, 'YZX'));
  local[BONE.head]!.multiplyQuaternions(qa, qb);
  for (const i of [BONE.head, BONE.tail1, BONE.tail2, BONE.tail3]) fk(i);

  // --- Legs: world-fixed footholds from the path, then two-bone IK. ---
  const feet: QuadrupedFootState[] = [];
  let maxPenetration = 0, maxReachError = 0;
  const stanceSweep = duty * schedule.cycleM;
  plan.legs.forEach((leg, index) => {
    const offset = WALK_PHASE_OFFSETS[index]!, p = frac(phase + offset), touchdown = phase - p;
    const touchLocal: [number, number] = [leg.toe[0] + stanceSweep / 2, leg.toe[2]], restLocal: [number, number] = [leg.toe[0], leg.toe[2]];
    const foothold = (travelPhase: number, at: [number, number]) => toTangent(frameAt(member, travelPhase / N), at[0], at[1]);
    let stance = true, x: number, z: number, lift = 0, swing = 0;
    if (!moving) { [x, z] = foothold(phase, restLocal); }
    else if (p < duty) { [x, z] = foothold(touchdown, touchLocal); }
    else {
      stance = false;
      const s = (p - duty) / (1 - duty), next = foothold(touchdown + 1, touchLocal);
      // A swing cut short by idle lands between the neutral foothold and its
      // planned one, weighted by progress, so the rest of the step after the
      // pause covers a distance proportional to its remaining swing time.
      const settled = (at: number, progress: number): [number, number] => {
        const rest = foothold(at, restLocal), k = smooth(progress);
        return [rest[0] + (next[0] - rest[0]) * k, rest[1] + (next[1] - rest[1]) * k];
      };
      let start = foothold(touchdown, touchLocal), sp = s, liftScale = 1;
      if (walking && touchdown + duty < resumePhase - 1e-9) {
        // This swing was interrupted by the idle window: it resumes from the
        // settled foothold and completes over its remaining swing time.
        const resumed = clamp((resumePhase - touchdown - duty) / (1 - duty), 0, .999);
        start = settled(resumePhase, resumed); sp = (s - resumed) / (1 - resumed); liftScale = Math.sqrt(1 - resumed);
      }
      const e = smooth(sp);
      x = start[0] + (next[0] - start[0]) * e; z = start[1] + (next[1] - start[1]) * e;
      lift = Math.sin(Math.PI * clamp(sp, 0, 1)) * schedule.liftM * liftScale; swing = clamp(sp, 0, 1);
      if (!walking) {
        // Idle began mid-swing: finish the step onto the settled foothold.
        const settle = clamp(tau / Math.max(.2, (1 - s) * swingS), 0, 1), target = settled(phase, s), k = smooth(settle);
        x += (target[0] - x) * k; z += (target[1] - z) * k;
        lift = lift * (1 - k) + Math.sin(Math.PI * settle) * schedule.liftM * .35 * (1 - s);
        swing *= 1 - k; stance = settle >= 1;
      }
    }
    const h = ground(x, z) + lift;
    const c = Math.cos(root.yaw), s = Math.sin(root.yaw), dx = x - root.x, dz = z - root.z;
    const contactBody = new THREE.Vector3(dx * c + dz * s, h - rootH, dx * s - dz * c);
    const up = normalLocal(x, z), toe = contactBody.clone().addScaledVector(up, leg.toeRadius);
    const angle = leg.footAngle + Math.sin(Math.PI * swing) * .55;
    const ankleTarget = ankleFromToe([toe.x, toe.y, toe.z], [1, 0, 0], [up.x, up.y, up.z], leg.footLength, angle);
    const hip = worldP[leg.upperBone]!.copy(offsets[leg.upperBone]!).applyQuaternion(worldQ[leg.parentBone]!).add(worldP[leg.parentBone]!);
    // Knees flex fore/aft in the body frame; splayed stances tilt the leg plane.
    const solved = solveTwoBone([hip.x, hip.y, hip.z], ankleTarget, leg.upperLength, leg.lowerLength, [leg.pole, 0, 0]);
    maxReachError = Math.max(maxReachError, solved.reachError);
    const knee = v3(solved.knee), ankle = v3(solved.end);
    const restHip = v3(leg.hip), restKnee = v3(leg.knee), restAnkle = v3(leg.ankle), restToe = v3(leg.toe);
    const restNormal = va.crossVectors(restKnee.clone().sub(restHip), restAnkle.clone().sub(restKnee)).normalize().clone();
    let posedNormal = vb.crossVectors(knee.clone().sub(hip), ankle.clone().sub(knee));
    if (posedNormal.lengthSq() < 1e-10) posedNormal = new THREE.Vector3().crossVectors(ankle.clone().sub(hip), new THREE.Vector3(leg.pole, 0, 0));
    posedNormal = posedNormal.normalize().clone();
    const upperWorld = frameRotation(restKnee.clone().sub(restHip).normalize(), restNormal, knee.clone().sub(hip).normalize(), posedNormal, new THREE.Quaternion());
    const lowerWorld = frameRotation(restAnkle.clone().sub(restKnee).normalize(), restNormal, ankle.clone().sub(knee).normalize(), posedNormal, new THREE.Quaternion());
    const footDir = toe.clone().sub(ankle).normalize(), restFoot = restToe.clone().sub(restAnkle).normalize();
    const footWorld = frameRotation(restFoot, new THREE.Vector3().crossVectors(restFoot, Y).normalize(), footDir, new THREE.Vector3().crossVectors(footDir, up).normalize(), new THREE.Quaternion());
    local[leg.upperBone]!.copy(worldQ[leg.parentBone]!).invert().multiply(upperWorld);
    local[leg.lowerBone]!.copy(upperWorld).invert().multiply(lowerWorld);
    local[leg.footBone]!.copy(lowerWorld).invert().multiply(footWorld);
    for (const i of [leg.upperBone, leg.lowerBone, leg.footBone]) fk(i);
    const toeActual = v3(leg.toe).sub(restAnkle).applyQuaternion(worldQ[leg.footBone]!).add(worldP[leg.footBone]!);
    const sole = toeActual.clone().addScaledVector(up, -leg.toeRadius);
    maxPenetration = Math.max(maxPenetration, groundLocal(sole.x, sole.z) - sole.y,
      groundLocal(worldP[leg.footBone]!.x, worldP[leg.footBone]!.z) + leg.ankleRadius * .5 - worldP[leg.footBone]!.y,
      groundLocal(worldP[leg.lowerBone]!.x, worldP[leg.lowerBone]!.z) + leg.kneeRadius * .5 - worldP[leg.lowerBone]!.y);
    feet.push({ id: leg.id, stance, contact: [x, h - lift, z], toe: [toeActual.x, toeActual.y, toeActual.z] });
  });
  const joints = new Float64Array(BONES * 3);
  for (let i = 0; i < BONES; i++) {
    positions.set([offsets[i]!.x, offsets[i]!.y, offsets[i]!.z], i * 3);
    quaternions.set([local[i]!.x, local[i]!.y, local[i]!.z, local[i]!.w], i * 4);
    joints.set([worldP[i]!.x, worldP[i]!.y, worldP[i]!.z], i * 3);
  }
  const headQ = worldQ[BONE.head]!, headP = worldP[BONE.head]!;
  const muzzleActual = v3(plan.muzzleTip).sub(v3(plan.neckTip)).applyQuaternion(headQ).add(headP), craniumActual = v3(plan.headCentre).sub(v3(plan.neckTip)).applyQuaternion(headQ).add(headP);
  const headClearance = Math.min(muzzleActual.y - g.headWidth * .2 - groundLocal(muzzleActual.x, muzzleActual.z), craniumActual.y - g.headWidth * .45 - groundLocal(craniumActual.x, craniumActual.z));
  return { positions, quaternions, joints, feet, root: { x: root.x, z: root.z, h: rootH, yaw: root.yaw }, state: walking ? 'walk' : 'idle', phase, maxPenetration: Math.max(0, maxPenetration), maxReachError, headClearance };
}
