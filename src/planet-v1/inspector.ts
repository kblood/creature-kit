import * as THREE from 'three';
import {buildQuadrupedBody,QUADRUPED_BONE_NAMES,QUADRUPED_BONE_PARENTS,type QuadrupedBodyData,type QuadrupedBodyPresentation} from './fauna-body-plan.ts';
import {quadrupedPoseAt,type FaunaGround,type FaunaPoseOptions} from './fauna-locomotion.ts';
import type {CreatureGenome} from './creature-model.ts';
import type {PlanetFaunaPathMember,PlanetFaunaActivity} from './caller-contract.ts';
export interface PlanetInspectionSample {activity:PlanetFaunaActivity;rigSeconds:number;behaviour?:FaunaPoseOptions['behaviour']}
export interface PlanetInspectorDiagnostics {
  time:number;gait:'idle'|'walk';root:[number,number,number];jointCount:number;maxPenetration:number;maxReachError:number;
  feet:{id:string;position:[number,number,number];stance:boolean;target:[number,number,number]}[];
}
export interface PlanetInspectorOptions {
  member:PlanetFaunaPathMember;sample:(time:number)=>PlanetInspectionSample;ground?:FaunaGround;
  material?:THREE.MeshStandardMaterial;ownsMaterial?:boolean;
  /** Explicit surface revision; omitted retains the frozen body-4 contract. */
  presentation?:QuadrupedBodyPresentation;
  /** Presentation extension point; source position/colour/weight buffers stay
   * owned by this body. A rest-space coat can add separate attributes here. */
  prepareGeometry?:(geometry:THREE.BufferGeometry,body:QuadrupedBodyData)=>void;
}
export interface PlanetAnimalInspector {
  readonly group:THREE.Group;readonly mesh:THREE.SkinnedMesh;readonly body:QuadrupedBodyData;
  update(time:number):PlanetInspectorDiagnostics;
  setSkeletonVisible(value:boolean):void;setNeutral(value:boolean):void;dispose():void;
}
/** Shared full-body inspection. Atlas supplies its exact dated activity
 * callback; a standalone Lab supplies explicit demo activity. No world lookup,
 * reseeding, alternate anatomy or new species is performed here. */
export function createPlanetAnimalInspector(genome:CreatureGenome,options:PlanetInspectorOptions):PlanetAnimalInspector {
  const body=buildQuadrupedBody(genome,{presentation:options.presentation}),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(body.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(body.normals,3));
  geometry.setAttribute('color',new THREE.BufferAttribute(body.colors,3,true));
  geometry.setAttribute('skinIndex',new THREE.BufferAttribute(body.skinIndex,4));
  geometry.setAttribute('skinWeight',new THREE.BufferAttribute(body.skinWeight,4,true));
  geometry.setIndex(new THREE.BufferAttribute(body.index,1));geometry.computeBoundingSphere();
  geometry.name=`Fauna body ${genome.archetype}`;
  Object.assign(geometry.userData,{bodyVersion:body.plan.version,faceFeatures:body.faceFeatures,structuralVertexCount:body.structuralVertexCount,structuralTriangleCount:body.structuralTriangleCount,morphology:genome.morphology});
  try{options.prepareGeometry?.(geometry,body);}catch(error){geometry.dispose();throw error;}
  const bones=QUADRUPED_BONE_NAMES.map(name=>{const b=new THREE.Bone();b.name=name;return b;});
  QUADRUPED_BONE_PARENTS.forEach((parent,i)=>{if(parent>=0)bones[parent]!.add(bones[i]!);});
  const skeleton=new THREE.Skeleton(bones,bones.map(()=>new THREE.Matrix4()));
  const material=options.material??new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,metalness:0});
  const ownsMaterial=options.ownsMaterial??options.material===undefined;
  material.roughness=genome.appearance?.roughness??.86;
  const mesh=new THREE.SkinnedMesh(geometry,material);mesh.bindMode=THREE.DetachedBindMode;mesh.bind(skeleton,new THREE.Matrix4());
  mesh.name='Planet animal inspection body';mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;
  body.plan.bones.forEach((b,i)=>{const parent=b.parent>=0?body.plan.bones[b.parent]!.rest:[0,0,0];bones[i]!.position.set(b.rest[0]-parent[0]!,b.rest[1]-parent[1]!,b.rest[2]-parent[2]!);skeleton.boneInverses[i]!.makeTranslation(-b.rest[0],-b.rest[1],-b.rest[2]);});
  const group=new THREE.Group();group.name='Shared planetary animal inspector';group.add(mesh);
  const helper=new THREE.SkeletonHelper(bones[0]!);helper.visible=false;helper.renderOrder=10;
  const helperMaterial=helper.material as THREE.LineBasicMaterial;helperMaterial.depthTest=false;helperMaterial.transparent=true;group.add(helper);
  const ground=options.ground??(()=>0);let disposed=false;
  const inspector:PlanetAnimalInspector={group,mesh,body,
    update(time):PlanetInspectorDiagnostics{
      if(disposed)throw new Error('Planet inspector is disposed');if(!Number.isFinite(time))throw new Error('Planet inspection time must be finite');
      const sample=options.sample(time);if(!Number.isFinite(sample.rigSeconds))throw new Error('Planet inspection rigSeconds must be finite');
      const pose=quadrupedPoseAt(body.plan,options.member,sample.activity,ground,sample.rigSeconds,{behaviour:sample.behaviour});
      for(let i=0;i<bones.length;i++){bones[i]!.position.fromArray(pose.positions,i*3);bones[i]!.quaternion.fromArray(pose.quaternions,i*4);}bones[0]!.updateMatrixWorld(true);mesh.matrixWorldNeedsUpdate=true;
      const c=Math.cos(pose.root.yaw),s=Math.sin(pose.root.yaw);
      return {time,gait:pose.state,root:[0,0,0],jointCount:bones.length,maxPenetration:pose.maxPenetration,maxReachError:pose.maxReachError,
        feet:pose.feet.map(f=>{const dx=f.contact[0]-pose.root.x,dz=f.contact[2]-pose.root.z;return {id:f.id,position:[...f.toe],stance:f.stance,target:[dx*c+dz*s,f.contact[1]-pose.root.h,dx*s-dz*c]};})};
    },
    setSkeletonVisible(value){helper.visible=value;},
    setNeutral(value){material.vertexColors=!value;material.color.set(value?'#a7a7a7':'#ffffff');material.needsUpdate=true;},
    dispose(){if(disposed)return;disposed=true;helper.geometry.dispose();helperMaterial.dispose();helper.removeFromParent();skeleton.dispose();geometry.dispose();if(ownsMaterial)material.dispose();group.clear();group.removeFromParent();},
  };
  try{inspector.update(0);}catch(error){inspector.dispose();throw error;}
  return inspector;
}
