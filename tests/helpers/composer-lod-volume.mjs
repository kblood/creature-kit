// Actual triangle/plane cross-sections. Bone positions select planes only;
// measured widths/heights always come from intersections with mesh triangles.
export function boneAxes(q){const[x,y,z,w]=q;return [[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w)],[2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w)],[2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)]];}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function hullArea(points){
 const p=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 if(p.length<3)return 0;const lower=[],upper=[];
 for(const q of p){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),q)<=0)lower.pop();lower.push(q);}
 for(const q of p.toReversed()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),q)<=0)upper.pop();upper.push(q);}
 const hull=lower.slice(0,-1).concat(upper.slice(0,-1));let area=0;for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length];area+=a[0]*b[1]-b[0]*a[1];}return Math.abs(area)*.5;
}
// A bent limb can cross the same plane twice. Measure its local tube, not
// the union with the remote upper segment. Retain the all-loop bounds in the
// report so this distinction is inspectable instead of hiding a narrower cut.
function localLoop(segments,radius){
 const points=new Map(),parent=new Map(),scale=1e7/Math.max(radius,1e-8),key=p=>`${Math.round(p[0]*scale)},${Math.round(p[1]*scale)}`;
 const find=k=>{let r=k;while(parent.get(r)!==r)r=parent.get(r);return r;};
 for(const segment of segments){const ids=segment.map(p=>{const k=key(p);points.set(k,p);if(!parent.has(k))parent.set(k,k);return k;});for(const k of ids.slice(1)){const a=find(ids[0]),b=find(k);if(a!==b)parent.set(b,a);}}
 const groups=new Map();for(const[k,p]of points){const r=find(k);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(p);}
 const loops=[...groups.values()].filter(p=>p.length>=3),distance=p=>{const centre=p.reduce((a,b)=>[a[0]+b[0]/p.length,a[1]+b[1]/p.length],[0,0]);return centre[0]**2+centre[1]**2;};
 loops.sort((a,b)=>distance(a)-distance(b));return{points:loops[0]??[],loops:loops.length};
}
export function anatomySections(mesh,graph){
 const out=[];
 const sections=[];for(const part of ['torso','neck'])for(const joint of graph.chains[part]??[])sections.push({part,joint,meshPart:'torso'});
 for(const limb of graph.limbs??[])if(limb.kind==='leg')for(const joint of limb.bones.slice(0,-1))sections.push({part:'leg',joint,meshPart:'leg',label:`leg ${limb.pair+1}${limb.side<0?'L':'R'}`});
 for(const {part,joint,meshPart,label}of sections){const b=graph.bones[joint],axes=boneAxes(b.restQuaternion),parts=mesh.parts.filter(p=>p.part===meshPart&&(!label||p.label===label));
  for(const u of [.25,.5,.75]){const centre=b.restPosition.map((x,k)=>x+axes[0][k]*b.length*u),radius=Math.max(b.start.h,b.start.w,b.end.h,b.end.w)*3,min=[Infinity,Infinity],max=[-Infinity,-Infinity],segments=[];let crossings=0;
   for(const p of parts)for(let t=p.firstTriangle*3;t<(p.firstTriangle+p.triangles)*3;t+=3){const v=[0,1,2].map(k=>[0,1,2].map(i=>mesh.positions[mesh.index[t+k]*3+i]-centre[i])),d=v.map(a=>dot(a,axes[0])),hits=[];for(let k=0;k<3;k++){const j=(k+1)%3;if(d[k]*d[j]>0||Math.abs(d[k]-d[j])<1e-14)continue;const f=d[k]/(d[k]-d[j]),hit=v[k].map((x,i)=>x+(v[j][i]-x)*f),yz=[dot(hit,axes[1]),dot(hit,axes[2])];if(Math.hypot(...yz)>radius)continue;crossings++;hits.push(yz);for(let i=0;i<2;i++){min[i]=Math.min(min[i],yz[i]);max[i]=Math.max(max[i],yz[i]);}}if(hits.length>=2)segments.push(hits);}
   const local=localLoop(segments,radius),points=part==='leg'?local.points:segments.flat(),loops=local.loops,spans=[0,1].map(k=>points.length?Math.max(...points.map(p=>p[k]))-Math.min(...points.map(p=>p[k])):0);
   out.push({part,joint,u,height:spans[0],width:spans[1],area:hullArea(points),crossings,loops,allHeight:crossings?max[0]-min[0]:0,allWidth:crossings?max[1]-min[1]:0});
  }
 }
 return out;
}
export function wingProjectedArea(mesh){return mesh.parts.filter(p=>p.part==='wing').map(p=>{let area=0;for(let t=p.firstTriangle*3;t<(p.firstTriangle+p.triangles)*3;t+=3){const a=mesh.index[t]*3,b=mesh.index[t+1]*3,c=mesh.index[t+2]*3;area+=Math.abs((mesh.positions[b]-mesh.positions[a])*(mesh.positions[c+2]-mesh.positions[a+2])-(mesh.positions[b+2]-mesh.positions[a+2])*(mesh.positions[c]-mesh.positions[a]))/2;}return{label:p.label,area};});}
export function volumeRatios(source,level,graph){const reference=anatomySections(source,graph),actual=anatomySections(level,graph),sections=actual.map((s,i)=>({...s,widthRatio:reference[i].width>1e-6?s.width/reference[i].width:null,heightRatio:reference[i].height>1e-6?s.height/reference[i].height:null,areaRatio:reference[i].area>1e-10?s.area/reference[i].area:null})),wing0=wingProjectedArea(source),wings=wingProjectedArea(level).map((s,i)=>({...s,ratio:s.area/wing0[i].area}));return{sections,wings,minimum:Object.fromEntries(['torso','neck','leg'].map(part=>{const s=sections.filter(s=>s.part===part);return[part,{width:Math.min(...s.map(s=>s.widthRatio??1)),height:Math.min(...s.map(s=>s.heightRatio??1)),area:Math.min(...s.map(s=>s.areaRatio??1))}];}))};}
