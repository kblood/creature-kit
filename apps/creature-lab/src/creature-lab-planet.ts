import {parsePlanetComposerDefinition,serializePlanetComposerDefinition,PLANET_COMPOSER_SOURCE_VERSION,type PlanetComposerDefinition,type ComposerBuildPhenotype} from '../../../src/planet-composer.ts';
import {createComposerCreature} from '../../../src/fauna-composer.ts';
import {composerPreviewLod} from '../../../src/fauna-composer-preview-lod.ts';
import {normalizeComposerRecipe,composerRecipesEqual,type ComposerRecipe} from '../../../src/fauna-composer-recipe.ts';
import type {ComposerSkinPresentation} from '../../../src/fauna-composer-mesh.ts';
import {srgbToLinear,linearToSrgb,type CoatRGB} from '../../../src/fauna-coat-fields.ts';
import type {CoatRole} from '../../../src/fauna-coat-vocab.ts';

export const LAB_PLANET_DEFINITION_MAX_BYTES=64*1024;
const bytes=(s:string)=>new TextEncoder().encode(s).length;
export function parseLabJson(text:string,maxBytes=LAB_PLANET_DEFINITION_MAX_BYTES):unknown{if(bytes(text)>maxBytes)throw new Error(`JSON exceeds ${maxBytes/1024} KiB`);return strictJson(text);}
/** JSON.parse accepts repeated object names; a specimen must never rely on which
 * duplicate wins. Validate JSON syntax first, then inspect its string tokens. */
function strictJson(text:string):unknown{
 const value=JSON.parse(text),stack:(Set<string>|null)[]=[];
 for(let i=0;i<text.length;i++){
  const c=text[i];if(c==='{')stack.push(new Set());else if(c==='[')stack.push(null);else if(c==='}'||c===']')stack.pop();
  else if(c==='"'){const start=i;for(i++;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"')break;}
   let next=i+1;while(/\s/.test(text[next]??'')&&next<text.length)next++;
   if(text[next]===':'){const key=JSON.parse(text.slice(start,i+1)) as string,keys=stack.at(-1);if(keys?.has(key))throw new Error(`Repeated JSON field: ${key}`);keys?.add(key);}
  }
 }
 return value;
}
export function parseLabPlanetDefinition(input:unknown):PlanetComposerDefinition{
 const text=typeof input==='string'?input:JSON.stringify(input);
 if(typeof text!=='string'||bytes(text)>LAB_PLANET_DEFINITION_MAX_BYTES)throw new Error('Planet definition exceeds 64 KiB');
 return parsePlanetComposerDefinition(strictJson(text));
}
export function serializeLabPlanetDefinition(input:PlanetComposerDefinition):string{
 const text=serializePlanetComposerDefinition(parseLabPlanetDefinition(input));
 if(bytes(text)>LAB_PLANET_DEFINITION_MAX_BYTES)throw new Error('Planet definition exceeds 64 KiB');return text;
}
export function editLabPlanetRecipe(input:PlanetComposerDefinition,recipe:ComposerRecipe):PlanetComposerDefinition{
 return parseLabPlanetDefinition({...input,recipe:normalizeComposerRecipe(recipe).recipe});
}
export function editLabPlanetDimension(input:PlanetComposerDefinition,key:keyof ComposerBuildPhenotype['dimensions'],value:number):PlanetComposerDefinition{
 const out=structuredClone(input);out.phenotype.dimensions[key]=value;return parseLabPlanetDefinition(out);
}
export function editLabPlanetCoat(input:PlanetComposerDefinition,key:string,value:unknown):PlanetComposerDefinition{
 const out=structuredClone(input);if(key==='roughness')out.phenotype.roughness=value as number;
 else if(key==='phase'||key==='lateral')out.phenotype.coatFrame[key]=value as number;
 else if(key.startsWith('colour:'))out.phenotype.coat.colours[key.slice(7) as CoatRole]=value as CoatRGB;
 else (out.phenotype.coat as unknown as Record<string,unknown>)[key]=value;
 return parseLabPlanetDefinition(out);
}
export const labPlanetColourHex=(rgb:readonly number[])=>'#'+rgb.map(c=>Math.round(Math.max(0,Math.min(1,linearToSrgb(c)))*255).toString(16).padStart(2,'0')).join('');
export function labPlanetColourLinear(hex:string):CoatRGB{
 if(!/^#[\da-f]{6}$/i.test(hex))throw new Error('Choose a valid coat colour');return [1,3,5].map(i=>srgbToLinear(parseInt(hex.slice(i,i+2),16)/255)) as CoatRGB;
}
export function labComposerBuildOptions(recipe:ComposerRecipe,definition:PlanetComposerDefinition|undefined,presentation:ComposerSkinPresentation){
 if(!definition)return {presentation};
 const parsed=parseLabPlanetDefinition(definition);if(!composerRecipesEqual(recipe,parsed.recipe))throw new Error('Visible recipe and planet definition differ');
 return {presentation,phenotype:parsed.phenotype};
}
/** Actual Lab actor path, also used by unit/browser replay checks. */
export function createLabComposerActor(recipe:ComposerRecipe,definition:PlanetComposerDefinition|undefined,presentation:ComposerSkinPresentation,lodTargetTriangles?:number){
 const actor=createComposerCreature(recipe,{...labComposerBuildOptions(recipe,definition,presentation),...(lodTargetTriangles===undefined?{}:{transformSkin:(skin,graph)=>composerPreviewLod(skin,graph,lodTargetTriangles)})});
 if(definition){actor.group.userData.planetComposerDefinition=structuredClone(definition);Object.assign(actor.mesh.geometry.userData.composer,{definitionVersion:definition.schema,sourceVersion:PLANET_COMPOSER_SOURCE_VERSION});}
 return actor;
}

/** Bounds match the validated resolved-phenotype contract. Angles use radians;
 * the remaining non-ratio fields are metres. No value is rounded on import. */
export const LAB_PLANET_DIMENSIONS:readonly {key:keyof ComposerBuildPhenotype['dimensions'];label:string;min:number;max:number;step:number;unit:string}[]=[
 ...(['bodyLength','torsoWidth','torsoHeight','legReach','stanceWidth','neckLength','headLength','headWidth','footLength','footWidth'] as const).map(key=>({key,label:({bodyLength:'Torso length',torsoWidth:'Torso width',torsoHeight:'Torso height',legReach:'Articulated leg reach',stanceWidth:'Stance width',neckLength:'Neck centreline',headLength:'Head length',headWidth:'Head width',footLength:'Foot length',footWidth:'Foot width'})[key],min:.001,max:20,step:.001,unit:'m'})),
 ...(['tailLength','hornLength','earLength','trunkLength','wingSpan'] as const).map(key=>({key,label:({tailLength:'Tail length',hornLength:'Paired horn length',earLength:'Ear length',trunkLength:'Proboscis length',wingSpan:'Wing span'})[key],min:0,max:30,step:.001,unit:'m'})),
 {key:'neckElevation',label:'Neck elevation',min:-Math.PI/2,max:Math.PI/2,step:.001,unit:'rad'},
 {key:'upperLegFraction',label:'Upper / lower leg share',min:.1,max:.9,step:.001,unit:'ratio'},
];
export const LAB_PLANET_OVERRIDDEN_KEYS=new Set(['bodyLength','girth','neckLength','headSize','legLength','tailLength','wingSpan','trunkLength','palette','colorSeed','pattern','marks','patternScale','patternContrast','countershade','individualSeed','sex','maturity','condition','variability','dimorphism','allometry']);
