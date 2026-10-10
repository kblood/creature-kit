// Reproducible code-native sample artifacts; refuses to overwrite review output.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {composerPreset,COMPOSER_PRESET_IDS,encodeComposerRecipe} from '../../src/fauna-composer-recipe.ts';
import {createComposerCreature} from '../../src/fauna-composer.ts';
import {exportCreatureGlb} from '../../src/fauna-composer-export.ts';
const output=process.argv[2];if(!output)throw new Error('Pass a new output directory');
await mkdir(output,{recursive:false});
const sha=a=>createHash('sha256').update(a).digest('hex'),samples=[];
for(const id of COMPOSER_PRESET_IDS)for(const maturity of [1,.35]){
 const recipe={...composerPreset(id),maturity},pair=[];
 for(const presentation of ['skin-5','realism-1']){
  const a=createComposerCreature(recipe,{presentation});
  try{const s=a.skin;pair.push({presentation,skinVersion:s.version,vertices:s.vertexCount,triangles:s.triangleCount,bones:a.graph.bones.length,bufferBytes:[s.positions,s.normals,s.colors,s.index,s.skinIndex,s.skinWeight,s.regions,s.gloss,...Object.values(s.coatLayers??{})].reduce((n,v)=>n+v.byteLength,0),positionsSha256:sha(new Uint8Array(s.positions.buffer))});}finally{a.dispose();}
 }
 samples.push({id,maturity,recipe:encodeComposerRecipe(recipe),pair});
}
const artifacts=[];
for(const id of ['dinosaur','rhinoceros']){
 const recipe=composerPreset(id),r=exportCreatureGlb(recipe,{presentation:'realism-1',target:'desktop-web',clips:['neutral',{motion:'walk',duration:1,fps:12}],lods:['full',8000,3000,1000]});
 const file=id+'-realism-1.glb';await writeFile(join(output,file),r.glb,{flag:'wx'});await writeFile(join(output,id+'-export.json'),JSON.stringify(r.report,null,2),{flag:'wx'});
 artifacts.push({file,sha256:sha(r.glb),bytes:r.glb.byteLength,versions:r.report.versions,recipe:r.report.recipeText,lods:r.report.lods.map(l=>({target:l.target,triangles:l.triangles,reached:l.reached}))});
}
const source={};for(const name of ['fauna-composer-mesh.ts','fauna-composer.ts','fauna-composer-rig.ts','fauna-composer-recipe.ts','fauna-composer-lod.ts','fauna-composer-export.ts'])source[name]=sha(await readFile(new URL('../../src/'+name,import.meta.url)));
await writeFile(join(output,'manifest.json'),JSON.stringify({schema:'composer-realism-evidence-1',source,sourceBaseline:'creature-kit@38215a7eff3d31c637b3e6534fce5672a3693cb1',license:'UNLICENSED',sourceConsent:'owned',provider:'creature-kit deterministic Composer',checkpoint:null,samples,artifacts,acceptance:{physicalQuest:false,allRecipeLodBudgets:false},knownLimit:'24-leg proboscis with protected limbs stops at1530 triangles for a1000 target; export fails closed.'},null,2),{flag:'wx'});
console.log(JSON.stringify({output,artifacts:artifacts.map(a=>({file:a.file,bytes:a.bytes})),samples:samples.length}));
