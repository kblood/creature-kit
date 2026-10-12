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
  constructor(graph: ComposerGraph) {
    this.boneCount = graph.bones.length;
    this.inverses = graph.bones.map(b => new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(b.restPosition), new THREE.Quaternion().fromArray(b.restQuaternion), this.scale).invert());
  }
  write(pose: ComposerPose, out: Float32Array, offset = 0): void {
    const n = this.boneCount;
    if (pose.positions.length !== n * 3 || pose.quaternions.length !== n * 4 || pose.radialScale.length !== n ||
        pose.chordScale.length !== n || out.length < offset + n * 16) throw new Error('Composer palette/pose size mismatch');
    for (let i = 0; i < n; i++) {
      this.position.fromArray(pose.positions, i * 3); this.quaternion.fromArray(pose.quaternions, i * 4);
      const radial = pose.radialScale[i]!, chord = pose.chordScale[i]!;
      if (!Number.isFinite(this.position.x)||!Number.isFinite(this.position.y)||!Number.isFinite(this.position.z)||
          !Number.isFinite(this.quaternion.x)||!Number.isFinite(this.quaternion.y)||!Number.isFinite(this.quaternion.z)||!Number.isFinite(this.quaternion.w)||
          !Number.isFinite(radial)||!Number.isFinite(chord)||radial<=0||chord<=0) throw new Error('Invalid Composer bone pose');
      this.scale.set(1, radial, radial * chord);
      this.matrix.compose(this.position, this.quaternion, this.scale).multiply(this.inverses[i]!);
      this.matrix.toArray(out, offset + i * 16);
    }
  }
  get ownedBytes(): number {return this.boneCount * 16 * 8;}
}
