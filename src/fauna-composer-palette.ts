import * as THREE from 'three';
import type {ComposerGraph, ComposerPose} from './fauna-composer-rig.ts';

/** Composer poses are absolute model-space frames, NOT parent-local frames.
 * Inverse bind includes the original quaternion. The same writer serves every
 * layout and tier; radial/chord scaling is part of the canonical pose. */
export class FaunaComposerPaletteWriter {
  readonly boneCount: number;
  private readonly inverses: THREE.Matrix4[];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly reuse:boolean;
  constructor(graph: ComposerGraph,reuseWorkingBuffers=true) {
    this.reuse=reuseWorkingBuffers;
    this.boneCount = graph.bones.length;
    this.inverses = graph.bones.map(b => new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(b.restPosition), new THREE.Quaternion().fromArray(b.restQuaternion), this.scale).invert());
  }
  write(pose: ComposerPose, out: Float32Array, offset = 0,activeBones?:Uint16Array,fast=false): void {
    const n = this.boneCount;
    if (pose.positions.length !== n * 3 || pose.quaternions.length !== n * 4 || pose.radialScale.length !== n ||
        pose.chordScale.length !== n || out.length < offset + n * 16) throw new Error('Composer palette/pose size mismatch');
    for (let k=0;k<(activeBones?.length??n);k++) {
      const i=activeBones?.[k]??k;if(i>=n)throw new Error('Invalid active palette bone');
      if(fast){this.writeAffine(pose,out,offset+i*16,i);continue;}
      this.position.fromArray(pose.positions, i * 3); this.quaternion.fromArray(pose.quaternions, i * 4);
      const radial = pose.radialScale[i]!, chord = pose.chordScale[i]!;
      const finite=this.reuse?
        Number.isFinite(this.position.x)&&Number.isFinite(this.position.y)&&Number.isFinite(this.position.z)&&
        Number.isFinite(this.quaternion.x)&&Number.isFinite(this.quaternion.y)&&Number.isFinite(this.quaternion.z)&&Number.isFinite(this.quaternion.w)&&Number.isFinite(radial)&&Number.isFinite(chord):
        [this.position.x,this.position.y,this.position.z,this.quaternion.x,this.quaternion.y,this.quaternion.z,this.quaternion.w,radial,chord].every(Number.isFinite);
      if(!finite||radial<=0||chord<=0)throw new Error('Invalid Composer bone pose');
      this.scale.set(1, radial, radial * chord);
      this.matrix.compose(this.position, this.quaternion, this.scale).multiply(this.inverses[i]!);
      this.matrix.toArray(out, offset + i * 16);
    }
  }
  /** Same TRS arithmetic as Matrix4.compose, followed by affine multiplication.
   * Rest transforms are rigid affine matrices. The homogeneous row is constant;
   * avoid its generic multiplication and the temporary composed Matrix4. */
  private writeAffine(pose:ComposerPose,out:Float32Array,at:number,i:number){
    const pi=i*3,qi=i*4,px=pose.positions[pi]!,py=pose.positions[pi+1]!,pz=pose.positions[pi+2]!,
      x=pose.quaternions[qi]!,y=pose.quaternions[qi+1]!,z=pose.quaternions[qi+2]!,w=pose.quaternions[qi+3]!,sy=pose.radialScale[i]!,sz=sy*pose.chordScale[i]!;
    if(!Number.isFinite(px)||!Number.isFinite(py)||!Number.isFinite(pz)||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||!Number.isFinite(w)||!Number.isFinite(sy)||!Number.isFinite(sz)||sy<=0||sz<=0)throw new Error('Invalid Composer bone pose');
    const x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
    const a11=1-(yy+zz),a21=xy+wz,a31=xz-wy,a12=(xy-wz)*sy,a22=(1-(xx+zz))*sy,a32=(yz+wx)*sy,a13=(xz+wy)*sz,a23=(yz-wx)*sz,a33=(1-(xx+yy))*sz;
    const b=this.inverses[i]!.elements;
    for(let col=0;col<4;col++){
      const c=col*4,b1=b[c]!,b2=b[c+1]!,b3=b[c+2]!,b4=b[c+3]!;
      out[at+c]=a11*b1+a12*b2+a13*b3+px*b4;
      out[at+c+1]=a21*b1+a22*b2+a23*b3+py*b4;
      out[at+c+2]=a31*b1+a32*b2+a33*b3+pz*b4;
      out[at+c+3]=col===3?1:0;
    }
  }
  get ownedBytes(): number {return this.boneCount * 16 * 8;}
}
