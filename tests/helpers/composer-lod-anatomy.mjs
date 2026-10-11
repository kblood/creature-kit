import {generateCreatureGenome,realisticIndividualCreatureGenome} from '../../src/planet-v1/creature-model.ts';
import {MORPHOLOGY_FAMILIES} from '../../src/planet-v1/fauna-appearance.ts';
import {buildPlanetComposerSource,planetComposerDefinition} from '../../src/planet-composer.ts';
import {buildComposerSource} from '../../src/fauna-composer-source.ts';
import {composerPreset} from '../../src/fauna-composer-recipe.ts';

export function anatomyCorpus(){
 const archetypes=['browser','runner','low-slung','long-neck'];
 const rows=MORPHOLOGY_FAMILIES.flatMap((family,i)=>['adult','juvenile'].map(stage=>{
  const genome=realisticIndividualCreatureGenome(generateCreatureGenome(`planet-composer/${family}`,archetypes[i%4]),`individual/${family}`,i%4,stage,family);
  const definition=planetComposerDefinition(genome,{individualId:`id/${family}/${stage}`,speciesId:`species/${family}`});
  return {id:`planet-${family}-${stage}`,definition,build:()=>buildPlanetComposerSource(definition)};
 }));
 for(const id of ['trunked-centipede','rhinoceros'])for(const maturity of [1,.28]){
  const recipe={...composerPreset(id),...(id==='rhinoceros'?{head:'proboscis',trunk:'trunk'}:{}),maturity};
  rows.push({id:`advanced-${id}-${maturity===1?'adult':'young'}`,recipe,build:()=>buildComposerSource(recipe,{presentation:'realism-1'})});
 }
 return rows;
}
export function arrayBytes(level){return Object.fromEntries(Object.entries(level).filter(([,v])=>ArrayBuffer.isView(v)).map(([k,v])=>[k,v.byteLength]));}
const axis=(q,i)=>{const[x,y,z,w]=q;return i===0?[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w)]:i===1?[2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w)]:[2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)];};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
/** Intersect actual reduced triangles with cross-section planes, not bone
 * landmarks or the constraint array. Restrict the cut to this bone's vicinity
 * so a curling distal section cannot inflate its proximal width. */
export function trunkSections(mesh,graph){
 const parts=mesh.parts.filter(p=>p.part==='trunk'),out=[];
 for(const j of graph.chains.trunk){const b=graph.bones[j],tx=axis(b.restQuaternion,0),ty=axis(b.restQuaternion,1),tz=axis(b.restQuaternion,2);
  for(const u of [.25,.5,.75]){const centre=b.restPosition.map((v,k)=>v+tx[k]*b.length*u),r=Math.max(b.start.h,b.start.w,b.end.h,b.end.w)*3,points=[];
   for(const part of parts)for(let t=part.firstTriangle*3;t<(part.firstTriangle+part.triangles)*3;t+=3){
    const v=[0,1,2].map(k=>Array.from(mesh.positions.slice(mesh.index[t+k]*3,mesh.index[t+k]*3+3)).map((x,i)=>x-centre[i])),d=v.map(p=>dot(p,tx));
    for(let k=0;k<3;k++){const l=(k+1)%3;if(d[k]*d[l]>0||Math.abs(d[k]-d[l])<1e-14)continue;const f=d[k]/(d[k]-d[l]),p=v[k].map((x,i)=>x+(v[l][i]-x)*f),y=dot(p,ty),z=dot(p,tz);if(Math.hypot(y,z)<=r)points.push([y,z]);}
   }
   const spans=[0,1].map(k=>points.length?Math.max(...points.map(p=>p[k]))-Math.min(...points.map(p=>p[k])):0);
   out.push({joint:j,u,height:spans[0],width:spans[1],intersections:points.length});
  }
 }
 return out;
}
