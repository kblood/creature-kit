/** Deterministic, metre-based quadruped anatomy shared by the lab data and rig. */
import { createFaunaAppearance, FAUNA_APPEARANCE_LEGACY_VERSION, FAUNA_APPEARANCE_VERSION, FAUNA_JUVENILE_PROPORTIONS, FAUNA_REFERENCE_JUVENILE_MATURITY, faunaAdultCoat, faunaArmorShare, faunaCoatErrors, faunaFarMean, faunaFarSpeciesId, faunaSpeciesCoat, inheritedFaunaFamily, isPigmentFamily, linearHexOf, MORPHOLOGY_FAMILIES, type FaunaAppearance, type FaunaMorphology, type FaunaMorphologyFamily } from './fauna-appearance.ts';
export type CreatureArchetype = 'browser'|'runner'|'low-slung'|'long-neck';
export interface CreatureGenome {
  version:string; archetype:CreatureArchetype;
  torsoLength:number; torsoHeight:number; torsoWidth:number;
  legLength:number; upperLegFraction:number; stanceWidth:number;
  neckLength:number; neckRise:number; headLength:number; headWidth:number;
  tailLength:number; footLength:number; footWidth:number;
  hornLength:number; earLength:number; armor:number;
  color:string; accentColor:string; pattern:'plain'|'stripes'|'spots';
  walkSpeed:number; runSpeed:number; strideLength:number;
  mutationLog:string[];
  /** Optional additive presentation contracts; absent on unchanged v1 founders. */
  appearance?:FaunaAppearance;
  morphology?:FaunaMorphology;
}

export const CREATURE_GENOME_VERSION = 'creature-genome-1';
const ARCHETYPES: readonly CreatureArchetype[] = ['browser','runner','low-slung','long-neck'];
const COLORS = ['#8d633e','#657a4b','#5f6d78','#9a7650','#78654a','#596f65'];
const ACCENTS = ['#e1c58a','#c98757','#a9bec3','#d6a56d','#b9a675','#d1d6c8'];

function hash32(value:string):number { let h=2166136261>>>0; for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);} h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);return(h^(h>>>16))>>>0; }
function unit(key:string):number { return hash32(key)/0x1_0000_0000; }
function between(key:string,low:number,high:number):number { return low+(high-low)*unit(key); }
function clamp(value:number,low:number,high:number):number { return Math.max(low,Math.min(high,value)); }
function round(value:number):number { return Math.round(value*1000)/1000; }
function requireSeed(seed:string):void { if(typeof seed!=='string'||!seed.trim()||seed.length>160) throw new Error('seed must be a non-empty string up to 160 characters'); }
function requireArchetype(archetype:CreatureArchetype):void { if(!ARCHETYPES.includes(archetype)) throw new Error(`Unknown creature archetype: ${String(archetype)}`); }
function copy(g:CreatureGenome):CreatureGenome { return {...g,mutationLog:[...g.mutationLog],...(g.appearance?{appearance:copyAppearance(g.appearance)}:{}),...(g.morphology?{morphology:{...g.morphology}}:{})}; }
/** Deep copy of the optional appearance block (a v1 block has no coat or lineage). */
function copyAppearance(a:FaunaAppearance):FaunaAppearance {
  const out:FaunaAppearance={...a,palette:{...a.palette},profile:{...a.profile},individual:{...a.individual},growth:{...a.growth}};
  if(a.coat)out.coat={...a.coat,colours:Object.fromEntries(Object.entries(a.coat.colours).map(([role,c])=>[role,[...c]])) as FaunaAppearance['coat']['colours']};
  if(a.lineage)out.lineage={...a.lineage};
  return out;
}

type Shape = Omit<CreatureGenome,'version'|'archetype'|'color'|'accentColor'|'pattern'|'mutationLog'|'appearance'|'morphology'>;
const BASE:Record<CreatureArchetype,Shape> = {
  browser: {torsoLength:1.72,torsoHeight:.82,torsoWidth:.68,legLength:1.08,upperLegFraction:.53,stanceWidth:.76,neckLength:.58,neckRise:.34,headLength:.48,headWidth:.32,tailLength:.48,footLength:.25,footWidth:.15,hornLength:.22,earLength:.18,armor:.08,walkSpeed:1.05,runSpeed:3.15,strideLength:.9},
  runner: {torsoLength:1.94,torsoHeight:.66,torsoWidth:.48,legLength:1.46,upperLegFraction:.52,stanceWidth:.58,neckLength:.38,neckRise:.2,headLength:.44,headWidth:.25,tailLength:1.05,footLength:.3,footWidth:.11,hornLength:0,earLength:.24,armor:.02,walkSpeed:1.55,runSpeed:5.6,strideLength:1.35},
  'low-slung': {torsoLength:1.8,torsoHeight:.48,torsoWidth:.82,legLength:.62,upperLegFraction:.49,stanceWidth:.92,neckLength:.31,neckRise:.1,headLength:.52,headWidth:.42,tailLength:.3,footLength:.28,footWidth:.23,hornLength:.08,earLength:.12,armor:.58,walkSpeed:.72,runSpeed:2.25,strideLength:.58},
  'long-neck': {torsoLength:1.66,torsoHeight:.76,torsoWidth:.57,legLength:1.35,upperLegFraction:.54,stanceWidth:.68,neckLength:1.42,neckRise:.82,headLength:.43,headWidth:.27,tailLength:.72,footLength:.27,footWidth:.14,hornLength:0,earLength:.2,armor:.05,walkSpeed:1.12,runSpeed:3.45,strideLength:1.08},
};
const BOUNDS:Record<keyof Shape,[number,number]>={torsoLength:[.7,3.2],torsoHeight:[.25,1.5],torsoWidth:[.25,1.5],legLength:[.35,2.5],upperLegFraction:[.4,.62],stanceWidth:[.35,1.5],neckLength:[.15,2.8],neckRise:[0,1.8],headLength:[.2,1],headWidth:[.12,.7],tailLength:[0,1.8],footLength:[.1,.65],footWidth:[.06,.45],hornLength:[0,.9],earLength:[0,.45],armor:[0,1],walkSpeed:[.4,2.4],runSpeed:[1.2,7.5],strideLength:[.18,1.9]};

function visibleMutation(parent:CreatureGenome,seed:string):CreatureGenome {
  const g=copy(parent), swing=between(`${seed}/direction`,-1,1)>=0?1:-1;
  const n=(field:keyof Shape,amount:number,label:string)=>{ const before=g[field] as number,[low,high]=BOUNDS[field],after=round(clamp(before*(1+swing*amount),low,high)),suffix=field==='armor'?' coverage':'m'; (g as unknown as Record<string,number>)[field]=after; if(after!==before) g.mutationLog.push(`${label} ${after>before?'increased':'decreased'}: ${before}${suffix} → ${after}${suffix}`); };
  // Each clade changes an anatomical package, so ancestry is readable from a neutral pose.
  if(g.archetype==='browser'){ n('neckLength',.24,'browsing neck');n('headLength',.18,'muzzle');n('hornLength',.42,'horn development');n('torsoWidth',.14,'barrel torso'); }
  else if(g.archetype==='runner'){ n('legLength',.19,'cursorial legs');n('tailLength',.27,'balancing tail');n('torsoWidth',.14,'narrow torso');n('strideLength',.18,'stride length'); }
  else if(g.archetype==='low-slung'){ n('torsoLength',.16,'long low torso');n('torsoWidth',.22,'broad low torso');n('stanceWidth',.16,'wide stance');n('armor',.34,'armor plates');n('footWidth',.22,'broad feet'); }
  else { n('neckLength',.28,'towering neck');n('neckRise',.25,'upright neck');n('legLength',.16,'stilt legs');n('headLength',.16,'reaching head'); }
  g.walkSpeed=round(clamp(g.walkSpeed*(1+swing*.08),.45,2.2));
  g.runSpeed=round(clamp(g.runSpeed*(1+swing*.1),1.3,7));
  return normalized(g);
}

function normalized(g:CreatureGenome):CreatureGenome {
  for(const [field,[low,high]] of Object.entries(BOUNDS)) (g as unknown as Record<string,number>)[field]=round(clamp((g as unknown as Record<string,number>)[field]!,low,high));
  g.runSpeed=round(Math.max(g.runSpeed,g.walkSpeed*1.75));
  return g;
}

export function generateCreatureGenome(seed:string,archetype:CreatureArchetype,parent?:CreatureGenome):CreatureGenome {
  requireSeed(seed);requireArchetype(archetype);
  // Public seeds may be 160 characters; fold them before adding generation channels.
  const key=hash32(seed).toString(16);
  if(parent){ if(parent.archetype!==archetype) throw new Error('A descendant must retain its parent archetype'); if(validateCreatureGenome(parent).length) throw new Error('Invalid parent creature genome'); return visibleMutation(parent,key); }
  const base=BASE[archetype], g={version:CREATURE_GENOME_VERSION,archetype,...base,color:COLORS[Math.floor(unit(`${key}/color`)*COLORS.length)]!,accentColor:ACCENTS[Math.floor(unit(`${key}/accent`)*ACCENTS.length)]!,pattern:(['plain','stripes','spots'] as const)[Math.floor(unit(`${key}/pattern`)*3)]!,mutationLog:[`${archetype} founder anatomy`]} as CreatureGenome;
  // A founder has bounded variation, but retains its deliberately distinct clade silhouette.
  for(const field of ['torsoLength','torsoHeight','torsoWidth','legLength','neckLength','headLength','tailLength','footLength','earLength'] as const) g[field]=round(g[field]*(1+between(`${key}/${field}`,-.07,.07)));
  return normalized(g);
}

export function individualCreatureGenome(genome:CreatureGenome,id:string,variant:number,stage:'adult'|'juvenile'='adult'):CreatureGenome {
  if(validateCreatureGenome(genome).length) throw new Error('Invalid creature genome');
  if(typeof id!=='string'||!id||!Number.isInteger(variant)||variant<0||variant>3||(stage!=='adult'&&stage!=='juvenile')) throw new Error('Invalid creature specimen request');
  const g=copy(genome), growth=stage==='juvenile'?.57:between(`${id}/${variant}/adult-size`,.95,1.06);
  for(const field of ['torsoLength','torsoHeight','torsoWidth','legLength','neckLength','neckRise','headLength','headWidth','tailLength','footLength','footWidth','hornLength','earLength','stanceWidth','strideLength'] as const) g[field]=round(g[field]*growth);
  if(stage==='juvenile'){const speedFactor=Math.sqrt(growth);g.walkSpeed=round(g.walkSpeed*speedFactor);g.runSpeed=round(g.runSpeed*speedFactor);g.hornLength=round(g.hornLength*.45);g.armor=round(g.armor*.7);g.mutationLog.push('juvenile proportions and locomotion');}
  else {
    const direction=unit(`${id}/${variant}/shape`)>.5?1:-1;
    if(g.archetype==='runner'){g.legLength=round(g.legLength*(1+direction*.06));g.tailLength=round(g.tailLength*(1-direction*.08));}
    if(g.archetype==='long-neck') g.neckLength=round(g.neckLength*(1+direction*.07));
    if(g.archetype==='low-slung') g.torsoWidth=round(g.torsoWidth*(1+direction*.06));
    if(g.archetype==='browser') g.headWidth=round(g.headWidth*(1+direction*.06));
  }
  return normalized(g);
}

/** Opt-in phenotype. Canonical genome generation and the legacy individual
 * evaluator above remain unchanged, including their deterministic channels. */
export function realisticIndividualCreatureGenome(genome:CreatureGenome,id:string,variant:number,stage:'adult'|'juvenile'='adult',family?:FaunaMorphologyFamily):CreatureGenome {
  if(validateCreatureGenome(genome).length) throw new Error('Invalid creature genome');
  if(typeof id!=='string'||!id||!Number.isInteger(variant)||variant<0||variant>3||(stage!=='adult'&&stage!=='juvenile')) throw new Error('Invalid creature specimen request');
  if(family!==undefined&&!MORPHOLOGY_FAMILIES.includes(family)) throw new Error('Invalid fauna morphology family');
  const selected=family??inheritedFaunaFamily(genome),g=copy(genome);
  const a=createFaunaAppearance(genome,id,variant,stage),p=a.profile,i=a.individual;
  const apply=(field:keyof Shape,factor:number)=>{g[field]=round(g[field]*factor);};
  // Small, correlated species axes: mass broadens trunk, stance and supporting
  // feet together; limb length changes stride and speed together. Founders stay
  // canonical, so adding a phenotype cannot reroll species or ancestry IDs.
  // Individual body size: +-4.5% (v1) and +-7% for coat phenotypes (uniform),
  // closer to the spread of wild ungulate populations.
  // Body condition (girth and depth): +-5.5% (v1) and +-9% for coat phenotypes,
  // +-13% for low-slung coat phenotypes (bears and badgers swing widely with season).
  // Long-neck size spans +-10% (adult giraffe shoulder heights differ by ~20%).
  const size=1+i.size*(isCoatPhenotype(a)?(genome.archetype==='long-neck'?.1:.07):.045),condition=1+i.condition*(isCoatPhenotype(a)?(genome.archetype==='low-slung'?.13:.09):.055);
  for(const field of ['torsoLength','torsoHeight','torsoWidth','legLength','stanceWidth','neckLength','neckRise','headLength','headWidth','tailLength','footLength','footWidth','hornLength','earLength','strideLength'] as const)apply(field,size);
  apply('torsoLength',1+p.mass*.035);apply('torsoHeight',(1+p.mass*.055)*condition);
  apply('torsoWidth',(1+p.mass*.075)*condition);apply('stanceWidth',1+p.mass*.065);
  apply('footWidth',1+p.mass*.05);apply('legLength',1+p.limb*.055-p.mass*.025);
  apply('strideLength',1+p.limb*.055-p.mass*.025);apply('neckLength',1+p.neck*.07);
  apply('neckRise',1+p.neck*.06);apply('headLength',1+i.muzzle*.065);apply('headWidth',1+i.condition*.035);
  apply('earLength',1+i.ears*.12);
  // Individual proportions (fauna-appearance-2): limb, neck and tail lengths
  // relative to the trunk vary within a population (limb +-4%, neck +-7%,
  // tail +-10%), so siblings differ in silhouette and not only in size. Long
  // necks vary +-14% and long-neck limbs +-6% (giraffe neck-to-leg ratios
  // differ between individuals).
  const coatPhenotype=isCoatPhenotype(a);
  const limbIndividual=coatPhenotype?1+(i.limb??0)*(genome.archetype==='long-neck'?.06:.04):1,neckIndividual=coatPhenotype?1+(i.neck??0)*(genome.archetype==='long-neck'?.14:.07):1;
  if(coatPhenotype){
    apply('legLength',limbIndividual);apply('strideLength',limbIndividual);
    apply('neckLength',neckIndividual);apply('neckRise',neckIndividual);apply('tailLength',1+(i.tail??0)*.1);
  }
  // Sexual dimorphism (fauna-appearance-2): males are larger with longer horns;
  // females carry reduced horns, none at all in strongly dimorphic species
  // whose females are hornless. A legacy v1 appearance has no sex channel.
  const sex=i.sex,dimorphism=Number.isFinite(p.dimorphism)?p.dimorphism:0;
  if(sex==='male'){
    const larger=1+.06*dimorphism;
    for(const field of ['torsoLength','torsoHeight','torsoWidth','legLength','stanceWidth','neckLength','neckRise','headLength','headWidth','tailLength','footLength','footWidth','hornLength','earLength','strideLength'] as const)apply(field,larger);
    apply('hornLength',1+.4*dimorphism);
  } else if(sex==='female'){
    apply('hornLength',1-.7*dimorphism);
    if(p.hornlessFemales)g.hornLength=0;
  }

  // Explicit alternate families use authored ratio envelopes. Species-specific
  // length and condition survive, while incompatible inherited parts are removed.
  if(family!==undefined){
    const ratios:Record<FaunaMorphologyFamily,[number,number,number,number,number,number]>={
      ungulate:[.48,.39,.64,.34,.28,.17],cursorial:[.34,.26,.76,.23,.25,.14],
      padded:[.29,.48,.35,.18,.31,.24],'long-neck':[.46,.35,.83,.88,.25,.16],
      proboscidean:[.57,.49,.51,.17,.34,.29],winged:[.39,.34,.63,.34,.27,.17],
    };
    const r=ratios[selected],length=g.torsoLength;
    g.torsoHeight=length*r[0]*condition;g.torsoWidth=length*r[1]*condition;
    g.legLength=length*r[2]*(1+p.limb*.035)*limbIndividual;g.neckLength=length*r[3]*(1+p.neck*.035)*neckIndividual;
    g.headLength=length*r[4]*(1+i.muzzle*.065);g.headWidth=length*r[5];
    g.neckRise=g.neckLength*(selected==='long-neck'?.59:.45);
    g.stanceWidth=g.torsoWidth*1.1;g.footWidth=g.torsoWidth*(selected==='proboscidean'?.27:.23);
    g.footLength=g.footWidth*1.5;g.strideLength=g.legLength*.82;
    g.hornLength=selected==='ungulate'?Math.min(g.hornLength,g.headLength*.65):0;
    g.armor=selected==='padded'?Math.min(g.armor,.4):0;
  }
  if(selected==='proboscidean'){
    // The proboscidean floors are species proportions. For coat phenotypes they
    // carry the individual's body condition, head breadth and ear size, which
    // a bare floor erased (every adult had torso height exactly .48 of its
    // length and the same ear ratio). Elephant body condition, and ear size and
    // outline, differ visibly between individuals of one population (ears are
    // used to identify them).
    const floorTorso=coatPhenotype?condition:1,floorHead=coatPhenotype?1+i.condition*.035:1,floorEar=coatPhenotype?1+i.ears*.12:1;
    g.torsoHeight=Math.max(g.torsoHeight,g.torsoLength*.48*floorTorso);g.headWidth=Math.max(g.headWidth,g.headLength*.77*floorHead);
    g.footWidth=Math.max(g.footWidth,g.torsoWidth*.25);g.hornLength=0;g.armor=0;
    g.earLength=Math.max(g.earLength,g.headLength*.52*floorEar);
  }
  // Headgear only where real animals carry it (fauna face round WP3): horns
  // grow on hoofed browsers (bovids, giraffids), never on the face of a padded
  // badger/bear-like animal, a runner or a proboscidean. The founder genome
  // keeps its hornLength (no new draws, no species reroll); only the drawn
  // phenotype drops it, and the drop is disclosed in the mutation log.
  if(selected!=='ungulate'&&g.hornLength>0){g.hornLength=0;g.mutationLog.push(`${selected} face: horns not grown (only hoofed browsers carry horns)`);}
  // An explicit family draws a different body, so its far colour is re-weighted
  // to that body (stage-invariant: the adult-equivalent armour is used).
  if(family!==undefined&&isCoatPhenotype(a)&&family!==inheritedFaunaFamily(genome)){
    {const species=faunaSpeciesCoat(genome).coat;a.palette.base=linearHexOf(faunaFarMean(faunaFarSpeciesId(genome),species,genome.archetype,faunaAdultCoat(genome.archetype,species,a.individualKey),selected,faunaArmorShare(g,selected)));}
  }
  // Male barrel width survives the authored family ratio envelopes.
  if(sex==='male')g.torsoWidth*=1+.06*dimorphism;
  // Adapt speed to the actual limb length, retaining inherited gait personality.
  const limbRatio=g.legLength/genome.legLength;
  g.walkSpeed*=Math.sqrt(limbRatio);g.runSpeed*=Math.sqrt(limbRatio);
  g.strideLength=Math.min(g.strideLength,g.legLength*.96);
  const adultWidthRatio=g.torsoWidth/g.torsoLength;
  if(stage==='juvenile'){
    const growthFamily:CreatureArchetype=selected==='long-neck'?'long-neck':selected==='cursorial'?'runner':selected==='padded'||selected==='proboscidean'?'low-slung':'browser';
    const q=FAUNA_JUVENILE_PROPORTIONS[growthFamily];
    if(isCoatPhenotype(a))juvenileProportions(g,q,a.growth.maturity);
    else {
      apply('torsoLength',q.trunk);apply('torsoHeight',q.trunk);apply('torsoWidth',q.width);
      apply('legLength',q.limb);apply('stanceWidth',q.width);apply('neckLength',q.neck);apply('neckRise',q.neck);
      apply('headLength',q.head);apply('headWidth',q.head);apply('footLength',q.foot);apply('footWidth',q.foot);
      apply('earLength',q.ear);apply('tailLength',q.trunk);apply('hornLength',.18);apply('armor',.6);
      apply('strideLength',q.limb);apply('walkSpeed',Math.sqrt(q.limb));apply('runSpeed',Math.sqrt(q.limb));
    }
  }
  // Family envelopes, at every growth stage: a long-necked browser never drifts
  // below a 0.6 neck/torso ratio (descendant drift measured 1.464 m -> 0.794 m
  // without it), and padded quadrupeds keep short legs.
  if(isCoatPhenotype(a)&&selected==='long-neck'&&g.neckLength<g.torsoLength*.6){const lift=g.torsoLength*.6/g.neckLength;g.neckLength*=lift;g.neckRise*=lift;}
  if(isCoatPhenotype(a)&&selected==='padded')g.legLength=Math.min(g.legLength,g.torsoLength*.445);
  normalized(g);
  // Feet must remain narrower than stance, and preferred stride below leg reach.
  g.footWidth=round(Math.min(g.footWidth,g.stanceWidth*.55));
  g.strideLength=round(Math.min(g.strideLength,g.legLength*.96));
  // Juvenile coats are laid out in the adult's lateral frame, so a young
  // body (relatively narrower than it will be) carries the same markings.
  if(isCoatPhenotype(a)&&stage==='juvenile')a.growth.lateral=Math.round(adultWidthRatio/(g.torsoWidth/g.torsoLength)*1e6)/1e6;
  g.appearance=a;
  // Shared coarse/facial colours use the exact phenotype palette too; the
  // original species genome remains untouched and keeps its inherited colours.
  g.color=a.palette.base;g.accentColor=a.palette.marking;
  g.morphology={version:'fauna-morphology-1',family:selected,footType:selected==='ungulate'||selected==='long-neck'?'hoof':selected==='padded'||selected==='proboscidean'?'broad-pad':'paw',trunkLength:selected==='proboscidean'?round(Math.min(1.45,g.headLength*1.9)):0,wingSpan:selected==='winged'?round(g.torsoLength*1.85):0,wingState:selected==='winged'?'folded':'none'};
  g.mutationLog.push(`${selected} phenotype; ${stage} anatomy and identity-preserving coat${sex?`; ${sex}`:''}`);
  return g;
}

function isCoatPhenotype(a:FaunaAppearance):boolean { return a.version===FAUNA_APPEARANCE_VERSION&&!!a.coat; }


/** Continuous juvenile growth (fauna-appearance-2). FAUNA_JUVENILE_PROPORTIONS
 * were authored at maturity 0.28; they are interpolated by (1-m)/(1-0.28), so a
 * maturity-0.22 neonate is younger and a 0.45 yearling older than that review
 * stage. On top: a neonatal head (+0.05 head/torso at m 0.22, fading to adult),
 * legs relative to the trunk x(1+0.12(1-m)) and horn buds x m^2 (at most 0.2).
 * The short neonatal muzzle (x(0.8+0.2m)) is drawn by the body plan. */
function juvenileProportions(g:CreatureGenome,q:typeof FAUNA_JUVENILE_PROPORTIONS[CreatureArchetype],m:number):void {
  const t=(1-m)/(1-FAUNA_REFERENCE_JUVENILE_MATURITY),at=(v:number)=>1-(1-v)*t;
  const trunk=at(q.trunk),width=at(q.width),limb=at(q.limb)*(1+.12*(1-m)),neck=at(q.neck),head=at(q.head),foot=at(q.foot),ear=at(q.ear);
  const scale=(field:keyof Shape,factor:number)=>{g[field]=round(g[field]*factor);};
  scale('torsoLength',trunk);scale('torsoHeight',trunk);scale('torsoWidth',width);
  scale('legLength',limb);scale('stanceWidth',width);scale('neckLength',neck);scale('neckRise',neck);
  scale('footLength',foot);scale('footWidth',foot);scale('earLength',ear);scale('tailLength',trunk);
  // Neonatal head: a proportionally larger cranium, fading linearly to maturity.
  const headLength=g.headLength*head,neonatal=.05*(1-m)/(1-.22)*g.torsoLength,grow=(headLength+neonatal)/headLength;
  g.headLength=round(headLength*grow);g.headWidth=round(g.headWidth*head*grow);
  scale('hornLength',Math.min(m*m,.2));scale('armor',.6);
  scale('strideLength',limb);scale('walkSpeed',Math.sqrt(limb));scale('runSpeed',Math.sqrt(limb));
}

export function validateCreatureGenome(genome:CreatureGenome):string[] {
  const errors:string[]=[]; if(!genome||typeof genome!=='object'){return ['genome must be an object'];}
  if(genome.version!==CREATURE_GENOME_VERSION) errors.push('unsupported genome version');
  if(!ARCHETYPES.includes(genome.archetype)) errors.push('unknown archetype');
  const numeric=['torsoLength','torsoHeight','torsoWidth','legLength','upperLegFraction','stanceWidth','neckLength','neckRise','headLength','headWidth','tailLength','footLength','footWidth','hornLength','earLength','armor','walkSpeed','runSpeed','strideLength'] as const;
  for(const field of numeric) { const value=genome[field],[low,high]=BOUNDS[field]; if(!Number.isFinite(value)||value<low||value>high) errors.push(`${field} must be a finite number from ${low} to ${high}`); }
  if(genome.upperLegFraction<.35||genome.upperLegFraction>.7) errors.push('upperLegFraction must permit a two-segment leg');
  if(genome.legLength<=0||genome.torsoLength<=0||genome.torsoHeight<=0||genome.torsoWidth<=0||genome.stanceWidth<=0||genome.headLength<=0||genome.footWidth<=0) errors.push('core body dimensions must be positive');
  if(genome.runSpeed<=genome.walkSpeed) errors.push('runSpeed must exceed walkSpeed');
  if(!/^#[0-9a-f]{6}$/i.test(genome.color)||!/^#[0-9a-f]{6}$/i.test(genome.accentColor)) errors.push('colors must be #RRGGBB');
  if(!['plain','stripes','spots'].includes(genome.pattern)) errors.push('unknown pattern');
  if(!Array.isArray(genome.mutationLog)||!genome.mutationLog.every(x=>typeof x==='string')) errors.push('mutationLog must be string[]');
  if(genome.appearance!==undefined){
    const a=genome.appearance;
    if(!a||(a.version!==FAUNA_APPEARANCE_VERSION&&a.version!==FAUNA_APPEARANCE_LEGACY_VERSION))errors.push('unsupported fauna appearance version');
    else {
      if(a.version===FAUNA_APPEARANCE_VERSION){
        errors.push(...faunaCoatErrors(a.coat));
        if(!a.individual||(a.individual.sex!=='female'&&a.individual.sex!=='male'))errors.push('invalid individual sex');
        if(!a.individual||!Number.isFinite(a.individual.coatPhase)||a.individual.coatPhase!<0||a.individual.coatPhase!>1)errors.push('invalid individual coat phase');
        if(!a.profile||!Number.isFinite(a.profile.dimorphism)||a.profile.dimorphism<0||a.profile.dimorphism>1||typeof a.profile.hornlessFemales!=='boolean')errors.push('invalid species dimorphism');
        if(!a.lineage||!isPigmentFamily(a.lineage.family)||typeof a.lineage.pattern!=='string')errors.push('invalid coat lineage');
        for(const axis of ['limb','neck','tail'] as const){const v=a.individual?.[axis];if(v!==undefined&&(!Number.isFinite(v)||v<-1||v>1))errors.push(`invalid individual ${axis} axis`);}
        if(!a.growth||!Number.isFinite(a.growth.lateral)||a.growth.lateral!<.5||a.growth.lateral!>2)errors.push('invalid coat growth frame');
      }
      if(typeof a.individualKey!=='string'||!a.individualKey||!Number.isInteger(a.markingSeed)||a.markingSeed<0||a.markingSeed>0xffffffff)errors.push('invalid appearance identity');
      if(!['plain','stripes','spots'].includes(a.pattern))errors.push('invalid appearance pattern');
      if(!a.palette||!['base','marking','belly'].every(k=>/^#[0-9a-f]{6}$/i.test((a.palette as unknown as Record<string,string>)[k]??'')))errors.push('invalid appearance palette');
      if(!Number.isFinite(a.roughness)||a.roughness<.65||a.roughness>1)errors.push('invalid coat roughness');
      if(!a.profile||!['mass','limb','neck'].every(k=>Number.isFinite((a.profile as unknown as Record<string,number>)[k])&&Math.abs((a.profile as unknown as Record<string,number>)[k]!)<=1))errors.push('invalid species profile');
      if(!a.individual||!['size','condition','muzzle','ears'].every(k=>Number.isFinite((a.individual as unknown as Record<string,number>)[k])&&Math.abs((a.individual as unknown as Record<string,number>)[k]!)<=1))errors.push('invalid individual profile');
      if(!a.growth||!['adult','juvenile'].includes(a.growth.stage)||!Number.isFinite(a.growth.maturity)||a.growth.maturity<0||a.growth.maturity>1)errors.push('invalid growth profile');
    }
  }
  if(genome.morphology!==undefined){
    const m=genome.morphology;
    if(!m||m.version!=='fauna-morphology-1'||!MORPHOLOGY_FAMILIES.includes(m.family))errors.push('unsupported fauna morphology');
    else {
      if(!['paw','hoof','broad-pad'].includes(m.footType))errors.push('invalid morphology feet');
      if(!Number.isFinite(m.trunkLength)||m.trunkLength<0||m.trunkLength>1.5||!Number.isFinite(m.wingSpan)||m.wingSpan<0||m.wingSpan>6)errors.push('invalid morphology appendage dimensions');
      if(m.wingState!=='none'&&m.wingState!=='folded')errors.push('invalid wing state');
      if((m.family==='winged')!==(m.wingSpan>0)||m.wingState!==(m.family==='winged'?'folded':'none')||(m.family==='proboscidean')!==(m.trunkLength>0))errors.push('incoherent morphology appendages');
      const feet=m.family==='ungulate'||m.family==='long-neck'?'hoof':m.family==='padded'||m.family==='proboscidean'?'broad-pad':'paw';
      if(m.footType!==feet)errors.push('incoherent morphology feet');
    }
  }
  return errors;
}
