import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createPlanetAnimalInspector,planetAnimalDefinition,generateCreatureGenome,realisticIndividualCreatureGenome,PLANET_ANIMAL_CORE_VERSION,type PlanetAnimalDefinition,type PlanetAnimalInspector,type CreatureArchetype} from '../../../src/planet-v1/index.ts';
import './creature-lab.css';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const editor=$<HTMLTextAreaElement>('definition'),poseInput=$<HTMLSelectElement>('pose'),time=$<HTMLInputElement>('time'),status=$('status');
const scene=new THREE.Scene();scene.background=new THREE.Color('#08131a');
scene.add(new THREE.HemisphereLight('#dcecf1','#697451',2));const sun=new THREE.DirectionalLight('#ffffff',3);sun.position.set(4,7,4);scene.add(sun);
const camera=new THREE.PerspectiveCamera(47,1,.05,100),renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;$('viewport').append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
const grid=new THREE.GridHelper(20,20,'#54726b','#263e38');scene.add(grid);
let inspector:PlanetAnimalInspector|undefined,definition:PlanetAnimalDefinition|undefined;
function frame(){
  if(!inspector)return;const box=new THREE.Box3().setFromObject(inspector.mesh),centre=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const radius=Math.max(size.length()*.8,1);controls.target.copy(centre);camera.position.copy(centre).add(new THREE.Vector3(radius*.9,radius*.45,radius));controls.update();
}
function inspect(input:unknown){
  const next=planetAnimalDefinition(input),g=next.genome,radius=Math.max(6,g.torsoLength*3);
  const member={id:next.individualId,anchorOffsetX:0,anchorOffsetZ:0,orbitRadiusM:radius,orbitAngularSpeed:g.walkSpeed/radius,orbitPhase:0,gaitPeriodS:6};
  const built=createPlanetAnimalInspector(g,{member,sample(seconds){
    const walking=poseInput.value==='walk',revolutionS=Math.PI*2*radius/g.walkSpeed;
    return {activity:{pose:{x:0,z:0,yaw:0,gait:walking?'walk':'idle'},travel:walking?((seconds/revolutionS)%1+1)%1:0,revolutionS:walking?revolutionS:Infinity,stateS:walking?seconds+1:3},rigSeconds:seconds,behaviour:poseInput.value==='feed'?'feed':'alert'};
  }});
  built.setSkeletonVisible($<HTMLInputElement>('skeleton').checked);built.setNeutral($<HTMLInputElement>('neutral').checked);
  inspector?.dispose();inspector=built;definition=next;scene.add(built.group);editor.value=JSON.stringify(next,null,2);frame();status.textContent='Loaded canonical genome unchanged.';
  $('details').textContent=`${PLANET_ANIMAL_CORE_VERSION}\n${next.individualId}\n${next.speciesId??'inspection specimen'}\n${g.morphology?.family??g.archetype}\n${built.body.vertexCount} vertices · ${built.body.triangleCount} triangles · ${built.mesh.skeleton.bones.length} bones`;
}
function demo(){const archetype=$<HTMLSelectElement>('demo').value as CreatureArchetype,id=`planet-lab-demo/${archetype}`;inspect({individualId:id,genome:realisticIndividualCreatureGenome(generateCreatureGenome('PLANET-LAB-DEMO',archetype),id,0,'adult')});}
$('load').onclick=()=>{try{inspect(JSON.parse(editor.value));}catch(error){status.textContent=String(error);}};
$('demo-load').onclick=()=>{try{demo();}catch(error){status.textContent=String(error);}};
$('export').onclick=()=>{if(!definition)return;const url=URL.createObjectURL(new Blob([JSON.stringify(definition,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='planet-animal-definition.json';link.click();URL.revokeObjectURL(url);};
$<HTMLInputElement>('skeleton').onchange=()=>inspector?.setSkeletonVisible($<HTMLInputElement>('skeleton').checked);
$<HTMLInputElement>('neutral').onchange=()=>inspector?.setNeutral($<HTMLInputElement>('neutral').checked);
function resize(){const area=$('viewport');camera.aspect=Math.max(1,area.clientWidth)/Math.max(1,area.clientHeight);camera.updateProjectionMatrix();renderer.setSize(Math.max(1,area.clientWidth),Math.max(1,area.clientHeight));}
addEventListener('resize',resize);resize();demo();
renderer.setAnimationLoop(()=>{inspector?.update(Number(time.value));controls.update();renderer.render(scene,camera);});
Object.assign(window,{__planetAnimalLab:{details:()=>({definition,coreVersion:PLANET_ANIMAL_CORE_VERSION,bodyVersion:inspector?.body.plan.version,vertices:inspector?.body.vertexCount,triangles:inspector?.body.triangleCount,bones:inspector?.mesh.skeleton.bones.length}),load:inspect}});
