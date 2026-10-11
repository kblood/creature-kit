import {PLANET_COMPOSER_SOURCE_VERSION,serializePlanetComposerDefinition,type PlanetComposerDefinition} from './planet-composer.ts';
import {COMPOSER_GRAPH_VERSION} from './fauna-composer-rig.ts';
import {COMPOSER_SKIN_VERSION,COMPOSER_REALISM_SKIN_VERSION,type ComposerSkinPresentation} from './fauna-composer-mesh.ts';
import {COMPOSER_LOD_VERSION,COMPOSER_LOD_CONSTRAINTS_VERSION,COMPOSER_FOOT_LOD_VERSION} from './fauna-composer-lod.ts';

export const PLANET_COMPOSER_IDENTITY_VERSION='planet-composer-identity-1';
export interface PlanetComposerSourceIdentityOptions {presentation?:ComposerSkinPresentation;/** Caller release commit/build pin; defaults to the explicit source contract revision. */codePin?:string}
export interface PlanetComposerSourceIdentity {
  readonly key:string;readonly digest:string;readonly canonical:string;
  readonly versions:Readonly<{source:string;graph:string;skin:string;lod:string;constraints:string;footLod:string;presentation:ComposerSkinPresentation;codePin:string}>;
}
/** Compact deterministic, non-cryptographic identifier. Equality is always
 * collision-validated with canonical text at cache/worker admission. */
function digest(text:string):string{
 let a=0x811c9dc5,b=0x9e3779b9,c=0x85ebca6b,d=0xc2b2ae35;
 for(let i=0;i<text.length;i++){const x=text.charCodeAt(i);a=Math.imul(a^x,0x01000193);b=Math.imul(b^x,0x85ebca6b);c=Math.imul(c^x,0xc2b2ae35);d=Math.imul(d^x,0x27d4eb2d);}
 return [a,b,c,d].map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
const cache=new WeakMap<PlanetComposerDefinition,Map<string,PlanetComposerSourceIdentity>>();
const deepFrozen=(x:unknown):boolean=>!x||typeof x!=='object'||Object.isFrozen(x)&&Object.values(x).every(deepFrozen);
/** Compute once per immutable member/definition and carry key through frames.
 * Calls on an already deeply frozen definition return the same token; mutable
 * debug inputs are revalidated and never gain a stale identity cache. */
export function planetComposerSourceIdentity(definition:PlanetComposerDefinition,options:PlanetComposerSourceIdentityOptions={}):PlanetComposerSourceIdentity{
 const presentation=options.presentation??'realism-1',codePin=options.codePin??PLANET_COMPOSER_SOURCE_VERSION;
 if(presentation!=='realism-1'&&presentation!=='skin-5')throw new Error('Unknown planet Composer presentation');
 if(typeof codePin!=='string'||!codePin.trim()||codePin.length>256)throw new Error('Invalid planet Composer code pin');
 const variant=presentation+'/'+codePin,previous=cache.get(definition)?.get(variant);if(previous)return previous;
 const canonical=serializePlanetComposerDefinition(definition),hash=digest(canonical),versions=Object.freeze({source:PLANET_COMPOSER_SOURCE_VERSION,graph:COMPOSER_GRAPH_VERSION,skin:presentation==='realism-1'?COMPOSER_REALISM_SKIN_VERSION:COMPOSER_SKIN_VERSION,lod:COMPOSER_LOD_VERSION,constraints:COMPOSER_LOD_CONSTRAINTS_VERSION,footLod:COMPOSER_FOOT_LOD_VERSION,presentation,codePin});
 const key=[PLANET_COMPOSER_IDENTITY_VERSION,...Object.values(versions).map(encodeURIComponent),hash].join('/'),token=Object.freeze({key,digest:hash,canonical,versions});
 if(deepFrozen(definition)){let variants=cache.get(definition);if(!variants){variants=new Map();cache.set(definition,variants);}variants.set(variant,token);}return token;
}
/** Validate the canonical payload as well as its compact key when admitting a
 * cached or worker-built source. Per-frame dispatch may then compare only key. */
export function assertPlanetComposerSourceIdentity(expected:Pick<PlanetComposerSourceIdentity,'key'|'canonical'>,actual:Pick<PlanetComposerSourceIdentity,'key'|'canonical'>):void{
 if(expected.key!==actual.key)throw new Error('Planet Composer source version, presentation, code pin or definition differs');
 if(expected.canonical!==actual.canonical)throw new Error('Planet Composer source key collision: canonical definitions differ');
}
