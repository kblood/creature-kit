import {buildComposerLodChain, composerAnatomyLodConstraints} from './fauna-composer-lod.ts';
import type {ComposerSkin, ComposerCoatLayers} from './fauna-composer-mesh.ts';
import type {ComposerGraph} from './fauna-composer-rig.ts';

/** Same original-vertex reduction as Atlas. A single requested tier is built
 * directly from the source, as in Atlas's requested-tier worker jobs. */
export function composerPreviewLod(skin:ComposerSkin,graph:ComposerGraph,target:number):ComposerSkin {
  if(!Number.isInteger(target)||target<1)throw new Error('LOD target must be a positive integer');
  const level=buildComposerLodChain(skin,[target],composerAnatomyLodConstraints(skin,graph)).levels[0]!;
  const take=(source:Float32Array,width:number)=>{
    const out=new Float32Array(level.vertices*width);
    for(let i=0;i<level.vertices;i++)for(let k=0;k<width;k++)out[i*width+k]=source[level.sourceVertex[i]!*width+k]!;
    return out;
  };
  const coatLayers:ComposerCoatLayers|null=skin.coatLayers?{c0:take(skin.coatLayers.c0,3),c1:take(skin.coatLayers.c1,3),c2:take(skin.coatLayers.c2,3),sample:take(skin.coatLayers.sample,4)}:null;
  return {...skin,positions:level.positions,normals:level.normals!,colors:level.colors,skinIndex:level.skinIndex,skinWeight:level.skinWeight,index:level.index,gloss:level.gloss!,
    regions:Uint8Array.from(level.sourceVertex,i=>skin.regions[i]!),coatLayers,
    parts:level.parts.map(p=>({...p,part:p.part as ComposerSkin['parts'][number]['part'],bones:[...(skin.parts.find(s=>s.part===p.part&&s.label===p.label)?.bones??[])]})),
    vertexCount:level.vertices,triangleCount:level.triangles,debug:undefined};
}
