import {Matrix4, Quaternion, Vector3} from 'three';
import type {ComposerGraph, ComposerPose} from './fauna-composer-rig.ts';
import type {ComposerSkin} from './fauna-composer-mesh.ts';

/** Actual generated/skinned vertex bounds, kept distinct from nominal genome
 * dimensions. This audit helper never modifies source buffers or animation. */
export function measurePlanetComposerSource(source: {graph: ComposerGraph; skin: ComposerSkin}, pose?: ComposerPose) {
  const {graph,skin}=source, p=new Vector3(), q=new Vector3(), result=new Vector3(), one=new Vector3(1,1,1);
  if(pose&&(pose.positions.length!==graph.bones.length*3||pose.quaternions.length!==graph.bones.length*4))throw new Error('Pose does not match Composer source graph');
  const matrices=pose?graph.bones.map((b,i)=>{
    const rest=new Matrix4().compose(new Vector3(...b.restPosition),new Quaternion(...b.restQuaternion),one).invert(),r=pose.radialScale[i]!;
    return new Matrix4().compose(new Vector3().fromArray(pose.positions,i*3),new Quaternion().fromArray(pose.quaternions,i*4),new Vector3(1,r,r*pose.chordScale[i]!)).multiply(rest);
  }):null;
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(let v=0;v<skin.vertexCount;v++){
    p.fromArray(skin.positions,v*3);result.copy(p);
    if(matrices){result.set(0,0,0);for(let k=0;k<4;k++){const w=skin.skinWeight[v*4+k]!;if(w)result.addScaledVector(q.copy(p).applyMatrix4(matrices[skin.skinIndex[v*4+k]!]!),w);}}
    const a=result.toArray();for(let k=0;k<3;k++){min[k]=Math.min(min[k]!,a[k]!);max[k]=Math.max(max[k]!,a[k]!);}
  }
  return {units:'m' as const,frame:'Composer model space; +X forward, +Y up' as const,motion:pose?.motion??'bind',time:pose?.time??0,bounds:{min,max},
    requested:graph.phenotype?structuredClone(graph.phenotype.dimensions):null,
    resolved:{bodyLength:graph.dims.bodyLength,torsoWidth:graph.dims.torsoWidth*2,torsoHeight:graph.dims.torsoHeight*2,neckLength:graph.dims.neckLength,headLength:graph.dims.headLength,headWidth:graph.dims.craniumWidth*2,
      legs:graph.limbs.filter(l=>l.kind==='leg').map(l=>({limb:l.index,reach:l.segments.reduce((a,b)=>a+b,0),footLength:l.footLength,footHeight:l.footHeight,rest:[...l.rest]})),
      stride:graph.locomotion.stride,cycleLength:graph.locomotion.stride/graph.locomotion.duty,speed:graph.locomotion.speed,period:graph.locomotion.period},fit:graph.phenotypeFit?structuredClone(graph.phenotypeFit):null,constraints:graph.constraints.map(c=>({...c}))};
}
