import * as THREE from 'three';
import {createHash} from 'node:crypto';
export const fields=['positions','normals','colors','skinIndex','skinWeight','index'];
export function digestBody(body){const h=createHash('sha256');for(const k of fields)h.update(new Uint8Array(body[k].buffer,body[k].byteOffset,body[k].byteLength));return h.digest('hex');}
export function bonePalette(plan,pose){
  const matrices=[],palette=new Float32Array(plan.bones.length*16);
  for(let i=0;i<plan.bones.length;i++){
    const b=plan.bones[i],local=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(pose.positions,i*3),new THREE.Quaternion().fromArray(pose.quaternions,i*4),new THREE.Vector3(1,1,1));
    matrices[i]=b.parent<0?local:matrices[b.parent].clone().multiply(local);
    matrices[i].clone().multiply(new THREE.Matrix4().makeTranslation(...b.rest.map(v=>-v))).toArray(palette,i*16);
  }return palette;
}
export function deformBody(body,palette){
  const out=new Float32Array(body.positions.length);
  for(let v=0;v<body.vertexCount;v++)for(let k=0;k<4;k++){
    const w=body.skinWeight[v*4+k]/255,b=body.skinIndex[v*4+k]*16,x=body.positions[v*3],y=body.positions[v*3+1],z=body.positions[v*3+2];
    for(let c=0;c<3;c++)out[v*3+c]+=w*(palette[b+c]*x+palette[b+4+c]*y+palette[b+8+c]*z+palette[b+12+c]);
  }return out;
}
/** Actual skinned vertices, not IK toe centres. Flat review ground is y=0. */
export function footSurfaceEvidence(body,posed,pose){
  return body.plan.legs.map((leg,i)=>{
    let minY=Infinity,maxY=-Infinity,vertices=0;
    for(let v=0;v<body.bodyVertexCount;v++){
      let weight=0;for(let k=0;k<4;k++)if(body.skinIndex[v*4+k]===leg.footBone)weight+=body.skinWeight[v*4+k];
      if(weight<96)continue;
      minY=Math.min(minY,posed[v*3+1]);maxY=Math.max(maxY,posed[v*3+1]);vertices++;
    }
    return {id:leg.id,stance:pose.feet[i].stance,vertices,minY,maxY,soleGapM:pose.feet[i].stance?minY:null};
  });
}
export function topologyEvidence(body){
  const parent=Int32Array.from({length:body.bodyVertexCount},(_,i)=>i),edges=new Map();
  const root=v=>{while(parent[v]!==v){parent[v]=parent[parent[v]];v=parent[v];}return v;};
  let degenerate=0;
  for(let t=0;t<body.bodyTriangleCount*3;t+=3){
    const ids=[body.index[t],body.index[t+1],body.index[t+2]];
    if(new Set(ids).size!==3)degenerate++;
    for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3];parent[root(a)]=root(b);const key=a<b?`${a}/${b}`:`${b}/${a}`;edges.set(key,(edges.get(key)||0)+1);}
  }
  return {components:new Set(Array.from(parent,(_,i)=>root(i))).size,boundaryEdges:[...edges.values()].filter(n=>n===1).length,nonManifoldEdges:[...edges.values()].filter(n=>n>2).length,degenerateIndexTriangles:degenerate};
}
