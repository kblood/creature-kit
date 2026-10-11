import * as T from 'three';
import {trunkSections} from './composer-lod-anatomy.mjs';
const ids=(mesh,part)=>[...new Set(mesh.index.slice(part.firstTriangle*3,(part.firstTriangle+part.triangles)*3))];
function components(mesh,part){
 const all=ids(mesh,part),parent=new Map(all.map(v=>[v,v])),find=v=>{let r=v;while(parent.get(r)!==r)r=parent.get(r);return r;};
 for(let t=part.firstTriangle*3;t<(part.firstTriangle+part.triangles)*3;t+=3)for(let k=1;k<3;k++){const a=find(mesh.index[t]),b=find(mesh.index[t+k]);if(a!==b)parent.set(b,a);}
 const groups=new Map();for(const v of all){const r=find(v);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(v);}
 return [...groups.values()].sort((a,b)=>b.length-a.length);
}
export function surfaceSupport(mesh,vertices,parts,allowedTriangles){
 const triangle=new T.Triangle(),point=new T.Vector3(),closest=new T.Vector3();let d2=Infinity,earVertex=-1,supportTriangle=[];
 for(const v of vertices){point.fromArray(mesh.positions,v*3);for(const part of parts)for(let t=part.firstTriangle*3;t<(part.firstTriangle+part.triangles)*3;t+=3){if(allowedTriangles&&!allowedTriangles.has(t))continue;triangle.a.fromArray(mesh.positions,mesh.index[t]*3);triangle.b.fromArray(mesh.positions,mesh.index[t+1]*3);triangle.c.fromArray(mesh.positions,mesh.index[t+2]*3);triangle.closestPointToPoint(point,closest);const next=point.distanceToSquared(closest);if(next<d2){d2=next;earVertex=v;supportTriangle=Array.from(mesh.index.slice(t,t+3));}}}
 return {gap:Math.sqrt(d2),earVertex,supportTriangle};
}
export const surfaceDistance=(mesh,vertices,parts)=>surfaceSupport(mesh,vertices,parts).gap;
export function retainedEarSupports(source,level,graph){
 const key=triangle=>Array.from(triangle).sort((a,b)=>a-b).join(','),retained=new Set();
 for(let t=0;t<level.index.length;t+=3)retained.add(key([0,1,2].map(k=>level.sourceVertex[level.index[t+k]])));
 const parts=source.parts.filter(p=>p.part==='head'&&!p.label.endsWith('ears')||p.part==='torso'),joints=new Set([graph.chains.head,...graph.chains.neck.slice(-1)]),allowed=new Set();
 for(const part of parts)for(let t=part.firstTriangle*3;t<(part.firstTriangle+part.triangles)*3;t+=3){const triangle=source.index.slice(t,t+3);if(retained.has(key(triangle))&&(part.part==='head'||Array.from(triangle).some(v=>[0,1,2,3].some(k=>source.skinWeight[v*4+k]>0&&joints.has(source.skinIndex[v*4+k])))))allowed.add(t);}
 const retainedVertices=new Set(level.sourceVertex);
 return source.parts.filter(p=>p.part==='head'&&p.label.endsWith('ears')).flatMap(p=>components(source,p).slice(0,2).map(vertices=>({source:surfaceSupport(source,vertices,parts),retained:surfaceSupport(source,vertices.filter(v=>retainedVertices.has(v)),parts,allowed)})));
}
function area(mesh,vertices){const chosen=new Set(vertices),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let sum=0;for(let t=0;t<mesh.index.length;t+=3){if(!chosen.has(mesh.index[t]))continue;a.fromArray(mesh.positions,mesh.index[t]*3);b.fromArray(mesh.positions,mesh.index[t+1]*3).sub(a);c.fromArray(mesh.positions,mesh.index[t+2]*3).sub(a);sum+=b.cross(c).length()*.5;}return sum;}
function intersects(mesh,left,right){
 const triangles=parts=>parts.flatMap(part=>Array.from({length:part.triangles},(_,i)=>{const start=(part.firstTriangle+i)*3,vertices=[0,1,2].map(k=>new T.Vector3().fromArray(mesh.positions,mesh.index[start+k]*3));return{vertices,box:new T.Box3().setFromPoints(vertices)};}));
 const a=triangles(left),b=triangles(right),ray=new T.Ray(),delta=new T.Vector3(),hit=new T.Vector3();
 for(const p of a)for(const q of b){if(!p.box.intersectsBox(q.box))continue;
  for(const [from,to]of [[p,q],[q,p]])for(let k=0;k<3;k++){const origin=from.vertices[k],end=from.vertices[(k+1)%3];delta.subVectors(end,origin);const length=delta.length();if(length<1e-12)continue;ray.set(origin,delta.multiplyScalar(1/length));if(ray.intersectTriangle(...to.vertices,false,hit)&&hit.distanceToSquared(origin)<=length*length+1e-18)return true;}
 }
 return false;
}
export function attachmentMetrics(mesh,graph){
 const heads=mesh.parts.filter(p=>p.part==='head'&&!p.label.endsWith('ears')||p.part==='torso');
 const head=graph.bones[graph.chains.head],inverse=new T.Quaternion().fromArray(head.restQuaternion).invert();
 const ears=mesh.parts.filter(p=>p.part==='head'&&p.label.endsWith('ears')).flatMap(p=>components(mesh,p).slice(0,2).map(vertices=>{const centre=new T.Vector3();for(const v of vertices)centre.add(new T.Vector3().fromArray(mesh.positions,v*3));centre.multiplyScalar(1/vertices.length).sub(new T.Vector3().fromArray(head.restPosition)).applyQuaternion(inverse);return{side:Math.sign(centre.z),gap:surfaceDistance(mesh,vertices,heads),area:area(mesh,vertices)};})).sort((a,b)=>a.side-b.side);
 const torso=mesh.parts.filter(p=>p.part==='torso'),tips=mesh.parts.filter(p=>p.part==='tail-tip'&&p.label==='tufted');
 const tailTipGap=tips.length?surfaceDistance(mesh,tips.flatMap(p=>ids(mesh,p)),torso):null;
 const tailSections=trunkSections({...mesh,parts:torso.map(p=>({...p,part:'trunk'}))},{...graph,chains:{...graph.chains,trunk:graph.chains.tail??[]}});
 return{ears,tailTipGap,tailTipIntersectsShaft:tips.length?intersects(mesh,tips,torso):null,tailSections};
}
export function deformAttachmentMesh(mesh,graph,pose){
 const matrices=graph.bones.map((b,i)=>new T.Matrix4().compose(new T.Vector3().fromArray(pose.positions,i*3),new T.Quaternion().fromArray(pose.quaternions,i*4),new T.Vector3(1,pose.radialScale[i],pose.radialScale[i]*pose.chordScale[i])).multiply(new T.Matrix4().compose(new T.Vector3().fromArray(b.restPosition),new T.Quaternion().fromArray(b.restQuaternion),new T.Vector3(1,1,1)).invert()));
 const positions=new Float64Array(mesh.positions.length),p=new T.Vector3(),q=new T.Vector3(),out=new T.Vector3();
 for(let v=0;v<positions.length/3;v++){p.fromArray(mesh.positions,v*3);out.set(0,0,0);for(let k=0;k<4;k++){const w=mesh.skinWeight[v*4+k];if(w>0)out.addScaledVector(q.copy(p).applyMatrix4(matrices[mesh.skinIndex[v*4+k]]),w);}out.toArray(positions,v*3);}
 return{...mesh,positions};
}
