/** UI adapters for canonical planetary genes. No composer recipes or second generator. */
import {generateCreatureGenome, realisticIndividualCreatureGenome, planetAnimalDefinition, inheritedFaunaFamily,
  faunaFarCoatMean, faunaArmorShare, linearHexOf, type PlanetAnimalDefinition, type CreatureGenome,
  type CreatureArchetype, type FaunaMorphologyFamily} from '../../../src/planet-v1/index.ts';
import {COAT_PATTERNS, COAT_MARK_BITS, type CoatMarkName, type CoatRole} from '../../../src/fauna-coat-vocab.ts';
import {COAT_GENOME_RANGES} from '../../../src/fauna-coat-fields.ts';

export const PLANET_PRESETS:readonly {id:FaunaMorphologyFamily;label:string;archetype:CreatureArchetype}[]=[
  {id:'ungulate',label:'Hoofed browser',archetype:'browser'},
  {id:'cursorial',label:'Long-legged runner',archetype:'runner'},
  {id:'padded',label:'Low padded quadruped',archetype:'low-slung'},
  {id:'long-neck',label:'Long-necked browser',archetype:'long-neck'},
  {id:'proboscidean',label:'Trunked quadruped',archetype:'low-slung'},
  {id:'winged',label:'Folded-wing quadruped',archetype:'browser'},
];
export const PLANET_FIELDS=[
  {key:'torsoLength',label:'Body length',group:'Body',min:.7,max:3.2},
  {key:'torsoHeight',label:'Body depth',group:'Body',min:.25,max:1.5},
  {key:'torsoWidth',label:'Body width',group:'Body',min:.25,max:1.5},
  {key:'neckLength',label:'Neck length',group:'Head and neck',min:.15,max:2.8},
  {key:'neckRise',label:'Neck rise',group:'Head and neck',min:0,max:1.8},
  {key:'headLength',label:'Head length',group:'Head and neck',min:.2,max:1},
  {key:'headWidth',label:'Head width',group:'Head and neck',min:.12,max:.7},
  {key:'hornLength',label:'Horn length',group:'Head and neck',min:0,max:.9},
  {key:'earLength',label:'Ear length',group:'Head and neck',min:0,max:.45},
  {key:'legLength',label:'Leg length',group:'Legs and feet',min:.35,max:2.5},
  {key:'upperLegFraction',label:'Upper leg fraction',group:'Legs and feet',min:.4,max:.62,unit:'ratio'},
  {key:'stanceWidth',label:'Stance width',group:'Legs and feet',min:.35,max:1.5},
  {key:'footLength',label:'Foot length',group:'Legs and feet',min:.1,max:.65},
  {key:'footWidth',label:'Foot width',group:'Legs and feet',min:.06,max:.45},
  {key:'tailLength',label:'Tail length',group:'Tail and armour',min:0,max:1.8},
  {key:'armor',label:'Back armour',group:'Tail and armour',min:0,max:1,unit:'ratio'},
  {key:'strideLength',label:'Preferred stride',group:'Walking',min:.18,max:1.9},
  {key:'walkSpeed',label:'Walking speed',group:'Walking',min:.4,max:2.4,unit:'m/s'},
] as const;
export const PLANET_COAT_FIELDS=[
  {key:'scale',label:'Pattern density'}, {key:'contrast',label:'Pattern contrast'},
  {key:'countershade',label:'Pale belly'}, {key:'warp',label:'Pattern irregularity'},
  {key:'threshold',label:'Mark coverage'}, {key:'greying',label:'Muzzle greying'},
] as const;
export const PLANET_COLOUR_ROLES:readonly {key:CoatRole;label:string}[]=[
  {key:'base',label:'Base coat'},{key:'accent',label:'Markings'},{key:'belly',label:'Belly'},
  {key:'plate',label:'Armour'},
];
export function copyPlanetDefinition(input:unknown):PlanetAnimalDefinition {
  return structuredClone(planetAnimalDefinition(input));
}
/** Seed and family changes are explicit new specimens, never import side effects. */
export function newPlanetSpecimen(seed:string,family:FaunaMorphologyFamily,individual=0,stage:'adult'|'juvenile'='adult'):PlanetAnimalDefinition {
  const preset=PLANET_PRESETS.find(p=>p.id===family);
  if(!preset)throw new Error('Choose a supported planetary body family');
  if(!Number.isSafeInteger(individual)||individual<0)throw new Error('Individual must be a non-negative integer');
  const id=`planet-lab/${encodeURIComponent(seed)}/${family}/${individual}/${stage}`;
  const founder=generateCreatureGenome(seed,preset.archetype);
  const genome=realisticIndividualCreatureGenome(founder,id,individual%4,stage,family);
  genome.mutationLog.push(`Planet Lab source seed: ${seed}; individual ${individual}; ${stage}`);
  return copyPlanetDefinition({individualId:id,speciesId:`planet-lab/${encodeURIComponent(seed)}/${family}`,genome});
}
export function fieldUnavailable(g:CreatureGenome,key:string):string {
  if(key==='armor'&&g.archetype!=='low-slung')return 'Back plates are built on low-slung bodies.';
  if(key==='trunkLength'&&g.morphology?.family!=='proboscidean')return 'Available on trunked quadrupeds.';
  if(key==='wingSpan'&&g.morphology?.family!=='winged')return 'Available on folded-wing quadrupeds.';
  return '';
}
function bounded(value:unknown,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Value must be from ${min} to ${max}`);
  return value;
}
function hexToLinear(hex:string):[number,number,number] {
  if(!/^#[0-9a-f]{6}$/i.test(hex))throw new Error('Choose an RGB colour');
  return [1,3,5].map(i=>{const v=parseInt(hex.slice(i,i+2),16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}) as [number,number,number];
}
/** One deliberate field edit. Retains identity and every unrelated phenotype channel. */
export function editPlanetDefinition(source:PlanetAnimalDefinition,key:string,value:string|number|boolean):PlanetAnimalDefinition {
  const next=copyPlanetDefinition(source),g=next.genome,coat=g.appearance?.coat;
  const field=PLANET_FIELDS.find(f=>f.key===key);
  const why=fieldUnavailable(g,key);if(why)throw new Error(why);
  const sameColour=coat&&key.startsWith('coat.colour.')&&PLANET_COLOUR_ROLES.some(r=>r.key===key.slice(12))&&linearHexOf(coat.colours[key.slice(12) as CoatRole])===value;
  const sameMark=coat&&key.startsWith('coat.mark.')&&Object.hasOwn(COAT_MARK_BITS,key.slice(10))&&Boolean(coat.marks&COAT_MARK_BITS[key.slice(10) as CoatMarkName])===value;
  const current=key.startsWith('coat.')?(coat as unknown as Record<string,unknown>|undefined)?.[key.slice(5)]:key==='trunkLength'||key==='wingSpan'?g.morphology?.[key]:(g as unknown as Record<string,unknown>)[key];
  if(sameColour||sameMark||current!==undefined&&current===value)return next;
  let coatChanged=false;
  if(field){
    const v=bounded(value,field.min,field.max);
    (g as unknown as Record<string,unknown>)[key]=v;
    if(key==='walkSpeed'&&g.runSpeed<=v)g.runSpeed=Math.min(7.5,v*1.75);
  }else if(key==='trunkLength'||key==='wingSpan'){
    if(!g.morphology)throw new Error('This animal has no morphology block');
    g.morphology[key]=bounded(value,.01,key==='trunkLength'?1.5:6);
  }else if(key==='coat.pattern'){
    if(!coat||typeof value!=='string'||value==='auto'||!COAT_PATTERNS.includes(value as never))throw new Error('Choose a supported coat pattern');
    coat.pattern=value as typeof coat.pattern;coatChanged=true;
  }else if(key.startsWith('coat.colour.')){
    const role=key.slice(12) as CoatRole;
    if(!coat||!PLANET_COLOUR_ROLES.some(r=>r.key===role)||typeof value!=='string')throw new Error('Unsupported coat colour');
    if(role==='plate'&&(g.archetype!=='low-slung'||g.armor<=.05))throw new Error('This animal has no back armour to colour');
    coat.colours[role]=hexToLinear(value);coatChanged=true;
  }else if(key.startsWith('coat.mark.')){
    const mark=key.slice(10) as CoatMarkName;
    if(!coat||!Object.hasOwn(COAT_MARK_BITS,mark)||typeof value!=='boolean')throw new Error('Unsupported coat marking');
    coat.marks=value?coat.marks|COAT_MARK_BITS[mark]:coat.marks&~COAT_MARK_BITS[mark];coatChanged=true;
  }else if(key==='coat.seed'){
    if(!coat)throw new Error('This animal uses an earlier coat');
    coat.seed=bounded(value,0,0xffffffff);
    if(!Number.isInteger(coat.seed))throw new Error('Pattern seed must be a whole number');
    coatChanged=true;
  }else if(key.startsWith('coat.')){
    const name=key.slice(5) as typeof PLANET_COAT_FIELDS[number]['key'];
    if(!coat||!PLANET_COAT_FIELDS.some(f=>f.key===name))throw new Error('Unsupported coat field');
    const [min,max]=COAT_GENOME_RANGES[name];coat[name]=bounded(value,min,max);coatChanged=true;
  }else if(key==='color'||key==='accentColor'){
    if(typeof value!=='string')throw new Error('Choose an RGB colour');hexToLinear(value);g[key]=value;
    if(g.appearance){if(key==='color')g.appearance.palette.base=value;else g.appearance.palette.marking=value;}
  }else if(key==='pattern'){
    if(!['plain','stripes','spots'].includes(String(value)))throw new Error('Unsupported legacy pattern');
    g.pattern=value as CreatureGenome['pattern'];if(g.appearance)g.appearance.pattern=g.pattern;
  }else throw new Error(`Unsupported animal control: ${key}`);
  if(coatChanged&&coat&&g.appearance){
    g.appearance.palette.base=linearHexOf(faunaFarCoatMean(coat,g.morphology?.family??inheritedFaunaFamily(g),faunaArmorShare(g,g.morphology?.family??inheritedFaunaFamily(g))));
    g.appearance.palette.marking=linearHexOf(coat.colours.accent);g.appearance.palette.belly=linearHexOf(coat.colours.belly);
    g.color=g.appearance.palette.base;g.accentColor=g.appearance.palette.marking;
  }
  if(JSON.stringify(g)===JSON.stringify(source.genome))return copyPlanetDefinition(source);
  g.mutationLog.push(`Planet Lab edit: ${key} = ${String(value)}`);
  return copyPlanetDefinition(next);
}
/** UTF-8, URL-safe state; links carry the whole canonical definition, never regenerate it. */
export function planetSpecimenHash(definition:PlanetAnimalDefinition):string {
  return `animal=${encodeURIComponent(JSON.stringify(copyPlanetDefinition(definition)))}`;
}
export function planetSpecimenFromHash(hash:string):PlanetAnimalDefinition|undefined {
  const query=new URLSearchParams(hash.replace(/^#/,''));
  if(!query.has('animal'))return undefined;
  if(hash.length>64000)throw new Error('Specimen link is too large; import a JSON file instead');
  if(query.getAll('animal').length!==1)throw new Error('Specimen link contains repeated animal definitions');
  return copyPlanetDefinition(JSON.parse(query.get('animal')!));
}
