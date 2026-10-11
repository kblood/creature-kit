import * as THREE from 'three';
import {poseComposer, type ComposerGraph, type ComposerLimb, type ComposerPose, type ComposerPoseOptions, type Quat, type Vec3} from './fauna-composer-rig.ts';
import type {PlanetFaunaActivity, PlanetFaunaPathMember} from './planet-v1/caller-contract.ts';

export const PLANET_COMPOSER_POSE_VERSION = 'planet-composer-pose-1';
export type PlanetComposerGround = (x: number, z: number) => number;
export interface PlanetComposerPose extends ComposerPose {
  planet: {version: typeof PLANET_COMPOSER_POSE_VERSION; memberId: string; cyclesPerRevolution: number; cycle: number; strideM: number; speedMps: number; root: Vec3; yaw: number};
}
const TAU = Math.PI * 2;
const fraction = (x: number) => ((x % 1) + 1) % 1;
const quintic = (x: number) => x * x * x * (10 + x * (6 * x - 15));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Composer movement on a caller-owned dated orbit and ground stencil.
 * Membership, population and dates stay with the world. All bones and IK come
 * from Composer, including its variable leg chains and shaped skin6 feet.
 * No previous frame is read and no quadruped body/pose factory is called. */
export function posePlanetComposer(
  graph: ComposerGraph, member: PlanetFaunaPathMember, activity: PlanetFaunaActivity,
  ground: PlanetComposerGround, rigSeconds: number, options: Pick<ComposerPoseOptions, 'trunkMotion'> = {},
): PlanetComposerPose {
  const source = [member.anchorOffsetX, member.anchorOffsetZ, member.orbitRadiusM, member.orbitAngularSpeed, member.orbitPhase,
    activity.pose.x, activity.pose.z, activity.pose.yaw, activity.travel, activity.stateS, rigSeconds];
  if (!member.id || !source.every(Number.isFinite) || member.orbitRadiusM < 0 || activity.travel < 0 || activity.travel >= 1 || rigSeconds < 0 || rigSeconds > 1e6)
    throw new Error('Invalid planetary Composer path');
  if (!(activity.revolutionS > 0)) throw new Error('Invalid planetary Composer revolution');
  const sample = (x: number, z: number) => {const h = ground(x,z); if (!Number.isFinite(h)) throw new Error('Nonfinite planetary Composer terrain'); return h;};
  const circumference = TAU * member.orbitRadiusM;
  const cycles = Math.max(1, Math.round(circumference * graph.locomotion.duty / Math.max(1e-6, graph.locomotion.stride)));
  const speed = Number.isFinite(activity.revolutionS) ? circumference / activity.revolutionS : 0;
  const moving = activity.pose.gait !== 'idle' && speed > 1e-9;
  const stride = moving ? circumference / cycles * graph.locomotion.duty : 0;
  const cycle = fraction(activity.travel * cycles);
  const yaw = activity.pose.yaw, cos = Math.cos(yaw), sin = Math.sin(yaw);
  const rootHeight = sample(activity.pose.x, activity.pose.z);
  const toWorld = (x: number, z: number): [number,number] => [activity.pose.x + cos*x + sin*z, activity.pose.z + sin*x - cos*z];
  const toBody = (x: number, h: number, z: number): Vec3 => {const dx=x-activity.pose.x,dz=z-activity.pose.z;return [cos*dx+sin*dz,h-rootHeight,sin*dx-cos*dz];};
  const bodyGround = (x: number,z: number) => {const p=toWorld(x,z);return sample(p[0],p[1])-rootHeight;};
  const terrainNormal = (x: number,z: number): Vec3 => {
    const e=0.025, dx=(sample(x+e,z)-sample(x-e,z))/(2*e), dz=(sample(x,z+e)-sample(x,z-e))/(2*e);
    const n=new THREE.Vector3(-cos*dx-sin*dz,1,-sin*dx+cos*dz).normalize();return [n.x,n.y,n.z];
  };
  const sign=Math.sign(member.orbitAngularSpeed||1);
  // Dated root is authoritative even if rounded revolution arithmetic differs
  // from the original floating orbit speed: derive earlier angles from this root.
  const angle=Math.atan2(activity.pose.z-member.anchorOffsetZ,activity.pose.x-member.anchorOffsetX);
  const foothold = (limb: ComposerLimb, deltaCycles: number): Vec3 => {
    const theta=angle+sign*TAU*deltaCycles/cycles, heading=theta+sign*Math.PI/2;
    const px=member.anchorOffsetX+Math.cos(theta)*member.orbitRadiusM, pz=member.anchorOffsetZ+Math.sin(theta)*member.orbitRadiusM;
    const fx=limb.rest[0]+stride*.5, fz=limb.rest[2];
    const x=px+Math.cos(heading)*fx+Math.sin(heading)*fz, z=pz+Math.sin(heading)*fx-Math.cos(heading)*fz;
    return [x,sample(x,z),z];
  };
  const contact = (limb: ComposerLimb, phase: number, stance: boolean) => {
    let target: Vec3;
    if (!moving) {
      const [x,z]=toWorld(limb.rest[0],limb.rest[2]); target=[x,sample(x,z),z];
    } else if (stance) target=foothold(limb,-phase);
    else {
      const u=(phase-graph.locomotion.duty)/(1-graph.locomotion.duty), blend=quintic(u);
      const last=foothold(limb,-phase),next=foothold(limb,1-phase);
      const x=lerp(last[0],next[0],blend),z=lerp(last[2],next[2],blend);
      // Follow actual terrain under the swept sole; the smooth lift vanishes
      // at touchdown. This is an airborne foot, never a synthetic ground point.
      const lift=graph.locomotion.lift*16*u*u*(1-u)*(1-u);
      target=[x,sample(x,z)+lift,z];
    }
    return {position:toBody(...target),normal:terrainNormal(target[0],target[2])};
  };
  const legs=graph.limbs.filter(l=>l.kind==='leg');
  const support=legs.map(l=>contact(l,fraction(cycle+l.phase),!moving||fraction(cycle+l.phase)<graph.locomotion.duty).position);
  const lift=support.length?support.reduce((total,p)=>total+bodyGround(p[0],p[2]),0)/support.length:bodyGround(0,0);
  const ex=Math.max(.1,graph.dims.bodyLength*.25),ez=Math.max(.1,graph.dims.torsoWidth*.25);
  const slopeX=(bodyGround(ex,0)-bodyGround(-ex,0))/(2*ex),slopeZ=(bodyGround(0,ez)-bodyGround(0,-ez))/(2*ez);
  const up=new THREE.Vector3(-slopeX,1,-slopeZ).normalize(),forward=new THREE.Vector3(1,slopeX,0).normalize();
  const side=new THREE.Vector3().crossVectors(forward,up).normalize();forward.crossVectors(up,side).normalize();
  const attitude=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward,up,side));
  const pose=poseComposer(graph,moving?'walk':'idle',rigSeconds,{...options,environment:{cycle,clock:rigSeconds,stride,speed,
    rootHeight:lift,rootRotation:attitude.toArray() as Quat,ground:bodyGround,contact}});
  for (const foot of pose.contacts) {
    const p=toWorld(foot.contact[0],foot.contact[2]);foot.world=[p[0],foot.contact[1]+rootHeight,p[1]];
  }
  return {...pose,planet:{version:PLANET_COMPOSER_POSE_VERSION,memberId:member.id,cyclesPerRevolution:cycles,cycle,strideM:stride,speedMps:speed,
    root:[activity.pose.x,rootHeight,activity.pose.z],yaw}};
}
