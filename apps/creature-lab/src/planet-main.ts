import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import * as planet from '../../../src/planet-v1/index.ts';
import type {PlanetAnimalDefinition,PlanetAnimalInspector,PlanetInspectorDiagnostics,FaunaMorphologyFamily} from '../../../src/planet-v1/index.ts';
import {COAT_PATTERNS,COAT_MARK_BITS,COAT_MARK_NAMES} from '../../../src/fauna-coat-vocab.ts';
import {COAT_GENOME_RANGES} from '../../../src/fauna-coat-fields.ts';
import {PLANET_PRESETS,PLANET_FIELDS,PLANET_COAT_FIELDS,PLANET_COLOUR_ROLES,copyPlanetDefinition,newPlanetSpecimen,
  editPlanetDefinition,fieldUnavailable,planetSpecimenHash,planetSpecimenFromHash} from './planet-lab-state.ts';
import {applyFaunaReviewLighting,FAUNA_REVIEW_PRESET_IDS,FAUNA_REVIEW_PRESETS,isFaunaReviewPresetId} from './fauna-review-environment.ts';
import {fitFaunaReviewShadow,FAUNA_REVIEW_SHADOWS} from './fauna-review-lighting.ts';
import './creature-lab.css';
import './planet-lab.css';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const input=(id:string)=>$<HTMLInputElement>(id),select=(id:string)=>$<HTMLSelectElement>(id);
const editor=$<HTMLTextAreaElement>('definition'),status=$('status');
const sculptedAvailable='QUADRUPED_SCULPTED_BODY_VERSION' in planet;
select('presentation').options[1]!.disabled=!sculptedAvailable;
select('presentation').value=sculptedAvailable?'sculpted-v1':'legacy-v4';
$('presentation-note').textContent=sculptedAvailable?'Surface style changes the preview; the canonical animal genes stay intact.':'The original planetary surface is available in this build.';
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(47,1,.05,160);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$('viewport').append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.maxPolarAngle=Math.PI*.495;controls.maxDistance=70;
let lighting=applyFaunaReviewLighting(scene,'studio');
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:lighting.preset.ground,roughness:1}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.006;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(40,40,'#739085','#516e65');grid.position.y=-.003;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.32;scene.add(grid);
interface Actor{definition:PlanetAnimalDefinition;inspector:PlanetAnimalInspector;role:'original'|'edited';diagnostics:PlanetInspectorDiagnostics}
let actors:Actor[]=[],definition:PlanetAnimalDefinition,original:PlanetAnimalDefinition,undo:PlanetAnimalDefinition[]=[];
let playing=false,seconds=0,lastFrame=0,lastMetrics=0,ready=false,error:string|null=null,individual=0,imported=false;
let focusFollow:THREE.Vector3|null=null;
const changed=()=>JSON.stringify(definition)!==JSON.stringify(original);
function message(text:string,failed=false){status.textContent=text;status.dataset.error=String(failed);error=failed?text:null;}
function guard(action:()=>void){try{action();}catch(e){message(e instanceof Error?e.message:String(e),true);}}
function buildActor(source:PlanetAnimalDefinition,role:Actor['role']):Actor{
  const g=source.genome,radius=Math.max(6,g.torsoLength*3);
  const member={id:source.individualId,anchorOffsetX:0,anchorOffsetZ:0,orbitRadiusM:radius,orbitAngularSpeed:g.walkSpeed/radius,orbitPhase:0,gaitPeriodS:6};
  const options={member,presentation:select('presentation').value as 'legacy-v4'|'sculpted-v1',sample(time:number){
    const walking=select('pose').value==='walk',revolutionS=Math.PI*2*radius/g.walkSpeed;
    return {activity:{pose:{x:0,z:0,yaw:0,gait:walking?'walk' as const:'idle' as const},travel:walking?((time/revolutionS)%1+1)%1:0,revolutionS:walking?revolutionS:Infinity,stateS:walking?time+1:3},rigSeconds:time,behaviour:select('pose').value==='feed'?'feed' as const:'alert' as const};
  }};
  const inspector=planet.createPlanetAnimalInspector(source.genome,options);
  inspector.setSkeletonVisible(input('skeleton').checked);inspector.setNeutral(input('neutral').checked);
  (inspector.mesh.material as THREE.MeshStandardMaterial).wireframe=input('wireframe').checked;
  return {definition:copyPlanetDefinition(source),inspector,role,diagnostics:inspector.update(seconds)};
}
function bounds(actor:Actor){actor.inspector.group.updateMatrixWorld(true);actor.inspector.mesh.computeBoundingBox();return actor.inspector.mesh.boundingBox!.clone().applyMatrix4(actor.inspector.mesh.matrixWorld);}
function fullBounds(){const box=new THREE.Box3();for(const a of actors)box.union(bounds(a));return box;}
function viewDirection(){const views:Record<string,THREE.Vector3>={'three-quarter':new THREE.Vector3(.75,.36,1),side:new THREE.Vector3(0,.06,1),front:new THREE.Vector3(1,.06,0),back:new THREE.Vector3(-1,.06,0),top:new THREE.Vector3(.001,1,.001)};return views[select('view').value]!.normalize();}
function layoutComparison(){
  if(actors.length!==2)return;
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),viewDirection()).normalize();
  for(const a of actors)a.inspector.group.position.set(0,0,0);
  const width=Math.max(...actors.map(a=>{const size=bounds(a).getSize(new THREE.Vector3());return Math.abs(right.x)*size.x+Math.abs(right.z)*size.z;}));
  actors[0]!.inspector.group.position.copy(right).multiplyScalar(-(width+.65)/2);actors[1]!.inspector.group.position.copy(right).multiplyScalar((width+.65)/2);
}
function fitShadow(){if(!actors.length)return;lighting.key.castShadow=true;fitFaunaReviewShadow(lighting.key,fullBounds().expandByScalar(.4),{groundY:0,paddingM:.3,depthBiasM:FAUNA_REVIEW_SHADOWS.depthBiasM,normalBiasM:FAUNA_REVIEW_SHADOWS.normalBiasM});}
/** Prepare before replacing the previous actor, so invalid edits/imports preserve the visible animal. */
function rebuild(next:PlanetAnimalDefinition,base:PlanetAnimalDefinition,fit=false){
  const built:Actor[]=[];
  try{if(input('compare').checked)built.push(buildActor(base,'original'));built.push(buildActor(next,'edited'));}
  catch(e){for(const a of built)a.inspector.dispose();throw e;}
  for(const a of actors)a.inspector.dispose();actors=built;
  layoutComparison();
  for(const a of actors)scene.add(a.inspector.group);
  definition=copyPlanetDefinition(next);original=copyPlanetDefinition(base);focusFollow=null;
  $('comparison-labels').hidden=actors.length!==2;fitShadow();if(fit||select('focus').value!=='body')frame();
}
function focusedBounds(){
  const actor=actors.at(-1)!;if(select('focus').value==='body')return fullBounds();
  const mesh=actor.inspector.mesh,box=new THREE.Box3(),p=new THREE.Vector3();mesh.skeleton.update();mesh.updateMatrixWorld(true);
  const eye=select('focus').value==='eyes',features=actor.inspector.body.faceFeatures.filter(f=>!eye||f.kind==='eye'&&f.side===1);
  for(const f of features)for(let i=f.firstVertex;i<f.firstVertex+f.vertexCount;i++){mesh.getVertexPosition(i,p);box.expandByPoint(p.applyMatrix4(mesh.matrixWorld));}
  if(eye)return box.expandByScalar(actor.definition.genome.headWidth*.025);
  // The canonical face geometry is attached to the head; include its ears and muzzle in a readable crop.
  return box.expandByScalar(Math.max(actor.definition.genome.headWidth*.4,actor.definition.genome.earLength*.55));
}
/** Same projected-bounds camera fit as the established Lab; no fixed camera distance per family. */
function frame(){
  if(!actors.length)return;layoutComparison();const box=focusedBounds(),size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());
  $('comparison-labels').hidden=actors.length!==2||select('focus').value!=='body';
  const eye=select('focus').value==='eyes',direction=(eye?new THREE.Vector3(.12,.08,1):viewDirection()).normalize();
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
  const extent=(axis:THREE.Vector3)=>Math.abs(axis.x)*size.x+Math.abs(axis.y)*size.y+Math.abs(axis.z)*size.z;
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),fill=eye?.65:.72;
  const distance=Math.max(eye?.005:.15,extent(right)/(2*tan*camera.aspect*fill),extent(up)/(2*tan*fill))+extent(direction)/2;
  camera.near=eye?.0005:.01;camera.updateProjectionMatrix();controls.minDistance=eye?.003:.05;
  controls.target.copy(centre);camera.position.copy(centre).addScaledVector(direction,distance);camera.lookAt(centre);controls.update();
  focusFollow=select('focus').value==='body'?null:centre;
  fitShadow();
}
function fieldMarkup(key:string,label:string,min:number,max:number,value:number,unit='',why=''){
  const id=key.startsWith('coat.')?`coat-${key.slice(5)}`:`gene-${key}`;
  return `<div class="gene-row"><label for="${id}">${esc(label)}${unit?` <span>(${unit})</span>`:''}</label><input id="${id}" data-gene="${key}" type="number" min="${min}" max="${max}" step="0.001" value="${value}" ${why?'disabled':''}><input id="range-${key.replaceAll('.','-')}" type="range" data-range="${id}" min="${min}" max="${max}" step="0.001" value="${value}" aria-label="${esc(label)} slider" ${why?'disabled':''}>${why?`<small>${esc(why)}</small>`:''}</div>`;
}
function renderFields(){
  const g=definition.genome,groups=[...new Set(PLANET_FIELDS.map(f=>f.group))];
  $('shape-controls').innerHTML=groups.map(group=>`<fieldset class="composer-group"><legend>${group}</legend>${PLANET_FIELDS.filter(f=>f.group===group).map(f=>fieldMarkup(f.key,f.label,f.min,f.max,g[f.key],'unit' in f?(f.unit==='ratio'?'':f.unit):'m',fieldUnavailable(g,f.key))).join('')}</fieldset>`).join('');
  if(g.morphology?.family==='proboscidean'||g.morphology?.family==='winged'){
    const trunk=g.morphology.family==='proboscidean',key=trunk?'trunkLength':'wingSpan';
    $('shape-controls').insertAdjacentHTML('beforeend',`<fieldset class="composer-group"><legend>${trunk?'Trunk':'Folded wings'}</legend>${fieldMarkup(key,trunk?'Trunk length':'Wing span',.01,trunk?1.5:6,g.morphology[key],'m')}<p class="hint">${trunk?'Uses the canonical trunk anatomy.':'Grounded animal with folded wings; flight is not simulated.'}</p></fieldset>`);
  }
  const coat=g.appearance?.coat;
  if(coat){
    $('coat-controls').innerHTML=`<fieldset class="composer-group"><legend>Coat pattern</legend><label>Pattern<select id="coat-pattern" data-gene="coat.pattern">${COAT_PATTERNS.filter(p=>p!=='auto').map(p=>`<option value="${p}" ${p===coat.pattern?'selected':''}>${esc(p.replaceAll('-',' '))}</option>`).join('')}</select></label>${PLANET_COAT_FIELDS.map(f=>fieldMarkup(`coat.${f.key}`,f.label,COAT_GENOME_RANGES[f.key][0],COAT_GENOME_RANGES[f.key][1],coat[f.key])).join('')}<label>Pattern seed<input id="coat-seed" data-gene="coat.seed" type="number" min="0" max="4294967295" step="1" value="${coat.seed}"></label></fieldset>
      <fieldset class="composer-group"><legend>Colours</legend><div class="coat-colours">${PLANET_COLOUR_ROLES.filter(r=>r.key!=='plate'||g.archetype==='low-slung'&&g.armor>.05).map(r=>`<label>${r.label}<input id="coat-${r.key}" data-gene="coat.colour.${r.key}" type="color" value="${planet.linearHexOf(coat.colours[r.key])}"></label>`).join('')}</div></fieldset>
      <fieldset class="composer-group"><legend>Markings</legend><div class="mark-grid">${COAT_MARK_NAMES.filter(m=>m!=='juvenile-spots').map(m=>`<label class="check"><input id="mark-${m}" data-gene="coat.mark.${m}" type="checkbox" ${coat.marks&COAT_MARK_BITS[m]?'checked':''}>${esc(m.replaceAll('-',' '))}</label>`).join('')}</div></fieldset>`;
  }else{
    $('coat-controls').innerHTML=`<fieldset class="composer-group"><legend>Original coat</legend><p class="hint">This imported animal retains its earlier coat model.</p><label>Pattern<select id="legacy-pattern" data-gene="pattern">${['plain','stripes','spots'].map(p=>`<option ${p===g.pattern?'selected':''}>${p}</option>`).join('')}</select></label><div class="coat-colours"><label>Base coat<input id="legacy-color" data-gene="color" type="color" value="${g.appearance?.palette.base??g.color}"></label><label>Markings<input id="legacy-accent" data-gene="accentColor" type="color" value="${g.appearance?.palette.marking??g.accentColor}"></label></div></fieldset>`;
  }
  renderInfo();
}
function renderInfo(){
  const g=definition.genome,family=g.morphology?.family??planet.inheritedFaunaFamily(g),name=PLANET_PRESETS.find(p=>p.id===family)?.label??family,a=actors.at(-1)!;
  $('animal-title').textContent=name;$('caption-title').textContent=name;
  $('identity-summary').textContent=`${g.appearance?.growth.stage==='juvenile'?'Young':'Adult'} · ${g.appearance?.individual.sex??'specimen'} · ${g.morphology?.footType?.replaceAll('-',' ')??g.archetype}`;
  $('caption-copy').textContent=`${g.torsoLength.toFixed(2)} m body · ${g.appearance?.coat?.pattern??g.pattern} coat · ${input('compare').checked?'Original on left, edited animal on right':'Drag to orbit · scroll to zoom'}`;
  $('edit-state').textContent=changed()?'Edited specimen · identity retained':imported?'Imported animal · unchanged':'Original specimen';
  $<HTMLButtonElement>('undo').disabled=!undo.length;$<HTMLButtonElement>('reset').disabled=!changed();
  $<HTMLButtonElement>('next-individual').disabled=imported;
  $<HTMLButtonElement>('next-individual').title=imported?'Create a seeded starting animal to explore its individuals.':'Another individual of the chosen seeded species';
  $('details').innerHTML=`<div><b>${a.inspector.body.vertexCount.toLocaleString()}</b> vertices · <b>${a.inspector.body.triangleCount.toLocaleString()}</b> triangles</div><div>${a.inspector.mesh.skeleton.bones.length} bones · ${esc(a.inspector.body.plan.version)}</div><div>${esc(planet.PLANET_ANIMAL_CORE_VERSION)}</div>`;
  $('identity').textContent=`Animal: ${definition.individualId}\nSpecies: ${definition.speciesId??'not supplied'}\nAppearance: ${g.appearance?.version??'original genome colour'}`;
  $('history').innerHTML=g.mutationLog.map(line=>`<li>${esc(line)}</li>`).join('');
  editor.value=JSON.stringify(definition,null,2);
}
function inspect(value:unknown,isImport=true){
  const next=copyPlanetDefinition(value);rebuild(next,next,true);undo=[];imported=isImport;seconds=0;setPlaying(false);renderFields();refreshPose();
  if(isImport){select('demo').value=next.genome.morphology?.family??planet.inheritedFaunaFamily(next.genome);select('stage').value=next.genome.appearance?.growth.stage??'adult';}
  message(isImport?'Imported animal loaded with its full genome unchanged.':'Seeded specimen ready. Adjust anatomy or explore its coat.');ready=true;
}
function createSpecimen(nextIndividual=false){
  const n=nextIndividual?individual+1:0,next=newPlanetSpecimen(input('seed').value,select('demo').value as FaunaMorphologyFamily,n,select('stage').value as 'adult'|'juvenile');
  inspect(next,false);individual=n;
}
function edit(key:string,value:string|number|boolean){
  const next=editPlanetDefinition(definition,key,value);if(JSON.stringify(next)===JSON.stringify(definition))return;
  const before=copyPlanetDefinition(definition);rebuild(next,original);undo.push(before);if(undo.length>60)undo.shift();renderFields();
  message('Animal updated. Undo or reset returns to the preserved original.');
}
function setPlaying(value:boolean){playing=value;lastFrame=0;$('play').textContent=playing?'Ⅱ Pause':'▶ Play';$('play').setAttribute('aria-label',playing?'Pause animation':'Play animation');}
function refreshPose(){for(const a of actors)a.diagnostics=a.inspector.update(seconds);input('time').value=String(seconds);$('time-label').textContent=`${seconds.toFixed(2)} s`;}
function resize(){const area=$('viewport');camera.aspect=Math.max(1,area.clientWidth)/Math.max(1,area.clientHeight);camera.updateProjectionMatrix();renderer.setSize(Math.max(1,area.clientWidth),Math.max(1,area.clientHeight));if(ready)frame();}

select('demo').innerHTML=PLANET_PRESETS.map(p=>`<option value="${p.id}">${p.label}</option>`).join('');
select('lighting').innerHTML=FAUNA_REVIEW_PRESET_IDS.map(id=>`<option value="${id}">${FAUNA_REVIEW_PRESETS[id].label}</option>`).join('');
$('demo-load').onclick=()=>guard(()=>createSpecimen());$('next-individual').onclick=()=>guard(()=>createSpecimen(true));
$('load').onclick=()=>guard(()=>inspect(JSON.parse(editor.value)));$('refresh-json').onclick=()=>{editor.value=JSON.stringify(definition,null,2);};
$('import-file').onclick=()=>input('file').click();input('file').onchange=async()=>{const file=input('file').files?.[0];if(!file)return;try{if(file.size>1000000)throw new Error('Definition files must be smaller than 1 MB');inspect(JSON.parse(await file.text()));}catch(e){message(String(e),true);}finally{input('file').value='';}};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(definition,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='planet-animal-definition.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Complete canonical animal definition exported.');};
$('share').onclick=async()=>{const url=new URL(location.href);url.hash=planetSpecimenHash(definition);try{await navigator.clipboard.writeText(url.href);message('Exact specimen link copied.');}catch{$<HTMLDetailsElement>('advanced').open=true;$('share-fallback').hidden=false;input('share-link').value=url.href;input('share-link').select();message('Copy the specimen link from the advanced panel.');}};
$('undo').onclick=()=>guard(()=>{const next=undo.at(-1);if(!next)return;rebuild(next,original);undo.pop();renderFields();message('Last edit undone.');});
$('reset').onclick=()=>guard(()=>{const before=copyPlanetDefinition(definition);rebuild(original,original,true);undo.push(before);renderFields();message('Original definition restored exactly.');});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')){
  button.onclick=()=>{for(const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')){const active=b===button;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$(`panel-${b.dataset.tab}`).hidden=!active;}};
  button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll<HTMLButtonElement>('[data-tab]')],i=tabs.indexOf(button),next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length]!;next.click();next.focus();};
  button.tabIndex=button.getAttribute('aria-selected')==='true'?0:-1;
}
for(const area of [$('shape-controls'),$('coat-controls')]){
  area.addEventListener('input',e=>{const el=e.target as HTMLInputElement;if(el.dataset.range)input(el.dataset.range).value=el.value;});
  area.addEventListener('change',e=>{const el=e.target as HTMLInputElement,control=el.dataset.range?input(el.dataset.range):el,key=control.dataset.gene;if(!key)return;guard(()=>edit(key,control.type==='checkbox'?control.checked:control.type==='number'?Number(control.value):control.value));if(error)renderFields();});
}
input('compare').onchange=()=>guard(()=>{rebuild(definition,original,true);renderInfo();message(input('compare').checked?'Comparing the preserved original with the edited animal.':'Showing the edited animal.');});
for(const id of ['skeleton','neutral','wireframe'])input(id).onchange=()=>{for(const a of actors){a.inspector.setSkeletonVisible(input('skeleton').checked);a.inspector.setNeutral(input('neutral').checked);(a.inspector.mesh.material as THREE.MeshStandardMaterial).wireframe=input('wireframe').checked;}};
input('grid').onchange=()=>{grid.visible=input('grid').checked;};
select('presentation').onchange=()=>guard(()=>{rebuild(definition,original,true);renderInfo();message('Body surface updated; animal genes and identity are unchanged.');});
select('lighting').onchange=()=>{if(!isFaunaReviewPresetId(select('lighting').value))return;lighting.dispose();lighting=applyFaunaReviewLighting(scene,select('lighting').value as typeof FAUNA_REVIEW_PRESET_IDS[number]);renderer.toneMappingExposure=lighting.preset.exposure;floor.material.color.set(lighting.preset.ground);fitShadow();};
$('play').onclick=()=>setPlaying(!playing);input('time').oninput=()=>{setPlaying(false);seconds=Number(input('time').value);refreshPose();};
select('pose').onchange=()=>{refreshPose();fitShadow();};$('frame').onclick=frame;select('view').onchange=frame;select('focus').onchange=frame;
addEventListener('resize',resize);new ResizeObserver(resize).observe($('viewport'));resize();renderer.toneMappingExposure=lighting.preset.exposure;
try{const linked=planetSpecimenFromHash(location.hash);if(linked)inspect(linked);else createSpecimen();}catch(e){createSpecimen();message(`Could not import specimen link: ${e instanceof Error?e.message:String(e)}`,true);}
addEventListener('hashchange',()=>guard(()=>{const linked=planetSpecimenFromHash(location.hash);if(linked)inspect(linked);}));
renderer.setAnimationLoop((timestamp:number)=>{
  if(playing&&lastFrame)seconds=(seconds+Math.min((timestamp-lastFrame)/1000,.1)*Number(select('speed').value))%30;lastFrame=timestamp;
  refreshPose();
  if(focusFollow){const centre=focusedBounds().getCenter(new THREE.Vector3()),delta=centre.clone().sub(focusFollow);controls.target.add(delta);camera.position.add(delta);focusFollow.copy(centre);}
  controls.update();renderer.render(scene,camera);
  if(timestamp-lastMetrics>250&&actors.length){const d=actors.at(-1)!.diagnostics;$('metrics').innerHTML=`<div>${d.gait==='walk'?'Walking':'Standing'} · ${d.feet.filter(f=>f.stance).length} planted feet</div><div>Ground penetration ${(d.maxPenetration*1000).toFixed(1)} mm · reach error ${(d.maxReachError*1000).toFixed(1)} mm</div>`;lastMetrics=timestamp;}
});
Object.assign(window,{__planetAnimalLab:{load:(value:unknown)=>inspect(value),details:()=>({ready,error,definition:copyPlanetDefinition(definition),original:copyPlanetDefinition(original),edited:changed(),playing,time:seconds,compare:input('compare').checked,
  coreVersion:planet.PLANET_ANIMAL_CORE_VERSION,bodyVersion:actors.at(-1)?.inspector.body.plan.version,vertices:actors.at(-1)?.inspector.body.vertexCount,triangles:actors.at(-1)?.inspector.body.triangleCount,bones:actors.at(-1)?.inspector.mesh.skeleton.bones.length,
  presentation:select('presentation').value,diagnostics:actors.at(-1)?.diagnostics,actors:actors.map(a=>({role:a.role,definition:copyPlanetDefinition(a.definition),bounds:{min:bounds(a).min.toArray(),max:bounds(a).max.toArray()},diagnostics:a.diagnostics})),
  camera:{position:camera.position.toArray(),target:controls.target.toArray(),focus:select('focus').value,view:select('view').value},renderer:{memory:{...renderer.info.memory},calls:renderer.info.render.calls}})}});
