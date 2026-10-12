import * as THREE from 'three';
import type {ComposerPose} from './fauna-composer-rig.ts';

export const COMPOSER_ANIMATION_VERSION='composer-temporal-presentation-1';
type Compact={positions:Float32Array;quaternions:Float32Array;radialScale:Float32Array;chordScale:Float32Array};
/** Delayed interpolation between actually evaluated canonical poses. No future
 * ground/path prediction, reseeding or alternate rig. Output is a borrowed view. */
export class ComposerTemporalPose {
  readonly output:ComposerPose;
  private a:Compact;private b:Compact;
  private aTime:number;private bTime:number;
  private context:string;private interval:number;
  private readonly qa=new THREE.Quaternion();private readonly qb=new THREE.Quaternion();
  samples=0;resets=0;alpha=1;
  constructor(pose:ComposerPose,clock:number,context:string,interval:number){
    if(!Number.isFinite(clock)||!Number.isFinite(interval)||interval<=0)throw new Error('Invalid temporal pose clock');
    const compact=():Compact=>({positions:new Float32Array(pose.positions.length),quaternions:new Float32Array(pose.quaternions.length),radialScale:new Float32Array(pose.radialScale.length),chordScale:new Float32Array(pose.chordScale.length)});
    this.a=compact();this.b=compact();this.aTime=clock;this.bTime=clock;this.context=context;this.interval=interval;
    this.output={...pose,positions:pose.positions.slice(),quaternions:pose.quaternions.slice(),radialScale:pose.radialScale.slice(),chordScale:pose.chordScale.slice(),diagnostics:{...pose.diagnostics}};
    this.copy(pose,this.a);this.copy(pose,this.b);this.samples=1;
  }
  private copy(pose:ComposerPose,into:Compact){into.positions.set(pose.positions);into.quaternions.set(pose.quaternions);into.radialScale.set(pose.radialScale);into.chordScale.set(pose.chordScale);}
  /** Caller evaluates the current authoritative pose only when this is true. */
  needsSample(clock:number,context:string,interval:number){return this.context!==context||this.interval!==interval||clock<this.bTime||clock-this.bTime>Math.max(.25,interval*3)||clock-this.bTime>=interval;}
  accept(pose:ComposerPose,clock:number,context:string,interval:number){
    if(!Number.isFinite(clock)||!Number.isFinite(interval)||interval<=0)throw new Error('Invalid temporal pose clock');
    const reset=this.context!==context||this.interval!==interval||clock<this.bTime||clock-this.bTime>Math.max(.25,interval*3);
    if(reset){this.copy(pose,this.a);this.aTime=clock;this.resets++;}else{const old=this.a;this.a=this.b;this.b=old;this.aTime=this.bTime;}
    this.copy(pose,this.b);this.bTime=clock;this.context=context;this.interval=interval;this.samples++;
    this.output.motion=pose.motion;this.output.travel=pose.travel;this.output.contacts=pose.contacts;this.output.diagnostics=pose.diagnostics;
    if(reset){this.output.positions.set(pose.positions);this.output.quaternions.set(pose.quaternions);this.output.radialScale.set(pose.radialScale);this.output.chordScale.set(pose.chordScale);}
  }
  interpolate(clock:number):ComposerPose{
    if(!Number.isFinite(clock))throw new Error('Invalid temporal pose clock');
    const span=this.bTime-this.aTime;this.alpha=span>0?Math.max(0,Math.min(1,(clock-this.bTime)/span)):1;
    if(span>0){const t=this.alpha,a=this.a,b=this.b,out=this.output;
      for(let i=0;i<out.positions.length;i++)out.positions[i]=a.positions[i]!+(b.positions[i]!-a.positions[i]!)*t;
      for(let i=0;i<out.radialScale.length;i++){
        out.radialScale[i]=a.radialScale[i]!+(b.radialScale[i]!-a.radialScale[i]!)*t;out.chordScale[i]=a.chordScale[i]!+(b.chordScale[i]!-a.chordScale[i]!)*t;
        this.qa.fromArray(a.quaternions,i*4).normalize();this.qb.fromArray(b.quaternions,i*4).normalize();this.qa.slerp(this.qb,t);this.qa.toArray(out.quaternions,i*4);
      }
    }
    this.output.time=clock;return this.output;
  }
  metadata(){return {version:COMPOSER_ANIMATION_VERSION,clock:this.output.time,sourceClockA:this.aTime,sourceClockB:this.bTime,interval:this.interval,alpha:this.alpha,samples:this.samples,resets:this.resets,contactsAndDiagnostics:'latest canonical sample'};}
  get ownedBytes(){return this.output.positions.byteLength+this.output.quaternions.byteLength+this.output.radialScale.byteLength+this.output.chordScale.byteLength+
    this.a.positions.byteLength+this.a.quaternions.byteLength+this.a.radialScale.byteLength+this.a.chordScale.byteLength+
    this.b.positions.byteLength+this.b.quaternions.byteLength+this.b.radialScale.byteLength+this.b.chordScale.byteLength+256;}
}

/** Stable list of original joints actually weighted by surviving vertices.
 * Compact codecs may round tiny weights to zero; including those is conservative. */
export function composerActiveBones(skin:{skinIndex:ArrayLike<number>;skinWeight:ArrayLike<number>},bones:number):Uint16Array{
  const used=new Uint8Array(bones);for(let i=0;i<skin.skinWeight.length;i++)if(skin.skinWeight[i]!>0){const bone=skin.skinIndex[i]!;if(!Number.isInteger(bone)||bone<0||bone>=bones)throw new Error('LOD references invalid bone');used[bone]=1;}
  const indices:number[]=[];for(let i=0;i<bones;i++)if(used[i])indices.push(i);return Uint16Array.from(indices);
}
