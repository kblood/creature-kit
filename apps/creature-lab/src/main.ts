import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {parseCreatureLabState, creatureLabUrl, creatureLabComposerInputError, creatureLabInputNotices, type CreatureLabState} from "./creature-lab-state.ts";
import {createComposerLab, type ComposerEyeFrame} from "./creature-lab-composer.ts";
import {fitFaunaReviewShadow, FAUNA_REVIEW_SHADOWS} from "./fauna-review-lighting.ts";
import {applyFaunaReviewLighting, FAUNA_REVIEW_PRESETS, FAUNA_REVIEW_PRESET_IDS, faunaReviewFillKeyRatio, isFaunaReviewPresetId, type FaunaReviewPresetId} from "./fauna-review-environment.ts";
import "./creature-lab.css";
import "./animal-lab-entry.css";

/** The kit's Creature Lab app: the composer mode of universe-atlas's Creature Lab as a page of its own. This host is the
 * composer branch of universe-atlas src/creature-lab.ts (7419733): renderer, camera, orbit controls, review lighting and
 * shadow fit, flat review ground, camera framing (whole animal, head, eye close-up with eye follow), the frame loop, the
 * share link, the JSON export and the window.__creatureLab review API. The planetary modes (gallery, anatomy, arena,
 * ancestry, planet skin) and everything they need (biosphere, creature rig, fauna templates) stay in Atlas. The composer
 * panel itself is creature-lab-composer.ts, copied unchanged apart from import paths (apps/creature-lab/PROVENANCE.md). */
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!));
const initialState=parseCreatureLabState(location.search);
const skeleton=$<HTMLInputElement>("skeleton"),neutral=$<HTMLInputElement>("neutral");
neutral.checked=initialState.neutral;skeleton.checked=initialState.skeleton;

const scene=new THREE.Scene(); scene.background=new THREE.Color("#08131a"); scene.fog=null;
const camera=new THREE.PerspectiveCamera(47,1,.05,280);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"}); renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$("viewport").append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=2;controls.maxDistance=180;controls.maxPolarAngle=Math.PI*.49;
// Review lighting: 'studio' is the original Lab rig; planet presets match the in-game surface light.
const lightSelect=$<HTMLSelectElement>("lighting");lightSelect.innerHTML=FAUNA_REVIEW_PRESET_IDS.map(id=>`<option value="${id}">${esc(FAUNA_REVIEW_PRESETS[id].label)}</option>`).join("");lightSelect.value=initialState.light;
const inputNotices=creatureLabInputNotices(location.search);
let lighting=applyFaunaReviewLighting(scene,"studio"),key=lighting.key;renderer.toneMappingExposure=lighting.preset.exposure;
function effectiveLight():FaunaReviewPresetId{return isFaunaReviewPresetId(lightSelect.value)?lightSelect.value:"studio";}
/** Swaps the light rig when the preset changes; keeps shadow casting and refits the shadow frustum. */
function applyLighting(){
 const id=effectiveLight();if(lighting.preset.id===id)return;
 const cast=key.castShadow;lighting.dispose();lighting=applyFaunaReviewLighting(scene,id);key=lighting.key;key.castShadow=cast;renderer.toneMappingExposure=lighting.preset.exposure;
 if(terrainMesh)(terrainMesh.material as THREE.MeshStandardMaterial).color.set(lighting.preset.ground);
 reviewShadowEnvelope.makeEmpty();fitLabShadow(true);metricsPending=true;
}
const worldGroup=new THREE.Group();scene.add(worldGroup);const actorGroup=new THREE.Group();worldGroup.add(actorGroup);
let terrainMesh:THREE.Mesh|undefined,grid:THREE.LineSegments|undefined;
let ready=false,error="",time=initialState.time,cpuMs=0,lastFrame=performance.now(),fps=0,frameN=0,lastFps=lastFrame,metricsPending=true;
const composer=createComposerLab({group:actorGroup,initial:initialState,inputError:creatureLabComposerInputError(location.search),notices:inputNotices,getTime:()=>time,setTime:t=>{time=t;composer.syncTime(t);},rebuild:()=>rebuild(),refresh:()=>{updateRigs();metricsPending=true;},fit:()=>fitCamera(),
 progress:done=>{updateRigs();if(done){fitCamera();applyComposerText();}$("status").textContent=composer.status();metricsPending=true;}});

function disposeActors(){composer.disposeActors();actorGroup.clear();}
function disposeTerrain(){if(terrainMesh){worldGroup.remove(terrainMesh);terrainMesh.geometry.dispose();(terrainMesh.material as THREE.Material).dispose();terrainMesh=undefined;}if(grid){worldGroup.remove(grid);grid.geometry.dispose();(grid.material as THREE.Material).dispose();grid=undefined;}}
/** Flat review ground (Atlas's composer-mode terrain: 72 m square, 1 m mesh, 8 m grid lines). */
function buildTerrain(){disposeTerrain();const range=36,pos:number[]=[],idx:number[]=[];const n=range*2+1;for(let iz=0;iz<n;iz++)for(let ix=0;ix<n;ix++)pos.push(-range+ix,0,-range+iz);for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++){const a=z*n+x;idx.push(a,a+n,a+1,a+1,a+n,a+n+1);}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();terrainMesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:lighting.preset.ground,roughness:1,flatShading:false,side:THREE.DoubleSide}));terrainMesh.receiveShadow=true;worldGroup.add(terrainMesh);const lines:number[]=[];for(let p=-32;p<=32;p+=8){lines.push(p,.012,-32,p,.012,32,-32,.012,p,32,.012,p);}const lg=new THREE.BufferGeometry();lg.setAttribute("position",new THREE.Float32BufferAttribute(lines,3));grid=new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:"#9dc1b3",transparent:true,opacity:.25}));worldGroup.add(grid);}
const reviewShadowEnvelope=new THREE.Box3();
function fitLabShadow(force=false){
 if(!key.castShadow)return;
 const fullBounds=composer.envelope();
 if(fullBounds.isEmpty())return;
 if(force||!reviewShadowEnvelope.containsBox(fullBounds)){
  reviewShadowEnvelope.copy(fullBounds).expandByScalar(.1);
  fitFaunaReviewShadow(key,reviewShadowEnvelope,{groundY:0,depthBiasM:FAUNA_REVIEW_SHADOWS.depthBiasM,normalBiasM:FAUNA_REVIEW_SHADOWS.normalBiasM});
 }
}
/** Near plane of the Lab camera; the eye close-up moves it in so a centimetre-sized eye is not clipped. */
const CAMERA_NEAR=.05;
function setNear(near:number){if(camera.near!==near){camera.near=near;camera.updateProjectionMatrix();}}
/** Eye close-up: the eye centre the camera follows while the animal plays (null when not following). */
let eyeFollow:THREE.Vector3|null=null,eyeFollowTime=NaN;
function fitViewCamera(box:THREE.Box3,direction:THREE.Vector3,minFit:number,minDistance:number){
 if(box.isEmpty())return;
 const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
 const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
 const extent=(axis:THREE.Vector3)=>Math.abs(axis.x)*size.x+Math.abs(axis.y)*size.y+Math.abs(axis.z)*size.z;
 const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),distance=Math.max(minFit,extent(right)/(2*tanV*camera.aspect*.8),extent(up)/(2*tanV*.8))+extent(direction)/2;
 setNear(CAMERA_NEAR);
 controls.minDistance=minDistance;controls.maxPolarAngle=Math.PI/2;controls.enableRotate=true;controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center);controls.update();
 fitLabShadow(true);
}
/** Eye close-up: the visible eye (or a forward-facing pair) fills frame.fill of the viewport, seen along frame.direction
 * (the view's direction, or a front-quarter view of a lateral eye); the near plane drops with the distance. */
function fitEyeCamera(e:ComposerEyeFrame){
 const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
 const distance=Math.max(.004,e.half.up/(tanV*e.fill.up),e.half.right/(tanV*camera.aspect*e.fill.right))+e.half.depth;
 setNear(Math.min(CAMERA_NEAR,Math.max(5e-4,distance*.1)));
 controls.minDistance=.002;controls.maxPolarAngle=Math.PI/2;controls.enableRotate=true;controls.target.copy(e.centre);camera.position.copy(e.centre).addScaledVector(e.direction,distance);camera.lookAt(e.centre);controls.update();
 fitLabShadow(true);
}
function fitCamera(){eyeFollow=null;setNear(CAMERA_NEAR);const eye=composer.focus()==="eyes"&&!composer.building?composer.eyeFrame():null;if(eye){fitEyeCamera(eye);eyeFollow=eye.centre.clone();eyeFollowTime=time;return;}if(composer.focus()!=="body"&&!composer.building)fitViewCamera(composer.headEnvelope(),composer.viewDirection(),.12,.1);else fitViewCamera(composer.envelope(),composer.viewDirection(),.4,.15);}
function buildActors(){disposeActors();key.castShadow=true;composer.build({skeleton:skeleton.checked,neutral:neutral.checked});buildTerrain();updateRigs();fitCamera();}
function applyComposerText(){
 composer.setActive(true);
 const t=composer.text();$("title").textContent="Animal Lab";$("description").textContent=t.description;$("caption-title").textContent=t.captionTitle;$("caption-copy").textContent=t.captionCopy;$("species-detail").innerHTML=t.detail;
 $("notice").hidden=true;
}
function updateMetrics(){const calls=renderer.info.render.calls,shadow=key.castShadow?composer.shadowCasters():0;$("metrics").innerHTML=`${composer.metrics()}<div><b>Draw calls</b> ${calls}${shadow?` (${calls-shadow} scene + ${shadow} shadow)`:""}</div><div><b>Triangles drawn</b> ${renderer.info.render.triangles}${shadow?" (scene and shadow passes)":""}</div><div><b>Lighting</b> ${esc(lighting.preset.label)} · fill/key ${faunaReviewFillKeyRatio(lighting.preset).toFixed(2)}</div><div><b>CPU</b> ${cpuMs.toFixed(2)} ms · ${fps.toFixed(0)} fps</div>`;if(ready&&!error)$("status").textContent=composer.status(calls);}
function rebuild(){
 applyLighting();applyComposerText();
 try{
  error="";ready=false;
  buildActors();applyComposerText();metricsPending=true;ready=true;$("status").textContent=composer.status();
 }catch(e){error=e instanceof Error?e.message:String(e);disposeActors();$("status").textContent=`Animal Lab error: ${error}`;$("notice").hidden=false;$("notice").textContent=`Could not load or display the requested specimen: ${error}`;}
}
function updateRigs(){composer.update(time);followEye();fitLabShadow();}
/** Keeps the eye in the close-up whenever the pose changes (playing, Pose time, Phase): the camera and its target move
 * with the eye centre (orbit and zoom kept). */
function followEye(){
 if(!eyeFollow||composer.focus()!=="eyes"||time===eyeFollowTime)return;
 eyeFollowTime=time;
 const e=composer.eyeFrame();if(!e)return;
 const delta=e.centre.clone().sub(eyeFollow);camera.position.add(delta);controls.target.add(delta);eyeFollow.copy(e.centre);
}
function lightingDetails(){const p=lighting.preset;return {preset:p.id,label:p.label,fillKeyRatio:faunaReviewFillKeyRatio(p),exposure:renderer.toneMappingExposure,shadows:key.castShadow,keyIntensity:key.intensity,hemisphereIntensity:lighting.hemisphere.intensity,ambientIntensity:lighting.ambient.intensity,background:p.background,ground:p.ground};}
function exportJson(){const out={specimenUrl:creatureLabUrl(location.href,specimenState()),composer:composer.details(),mode:"composer",time,settings:{neutral:neutral.checked,skeleton:skeleton.checked},renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory}},lighting:lightingDetails(),cpuMs};const url=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="creature-lab-composer.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
/** Same key order as Atlas's specimenState (mode, view, time, compare, neutral, skeleton, then the composer keys), so a
 * shared link lists its parameters exactly as Atlas's composer mode does. */
function specimenState():CreatureLabState{const s=composer.state();return {mode:"composer",view:s.view,time,compare:s.compare,neutral:neutral.checked,skeleton:skeleton.checked,recipe:s.recipe,compareRecipe:s.compareRecipe,composerSeed:s.composerSeed,motion:s.motion,herd:s.herd,light:effectiveLight()};}
$("share-specimen").onclick=async()=>{if(!ready||error){$("share-status").textContent="Load a valid specimen before copying its link.";return;}composer.setPlaying(false);const url=creatureLabUrl(location.href,specimenState());history.replaceState(null,"",url);try{await navigator.clipboard.writeText(url);$("share-status").textContent="Specimen link copied.";$("share-fallback").hidden=true;}catch{$<HTMLInputElement>("share-link").value=url;$("share-fallback").hidden=false;$<HTMLInputElement>("share-link").select();$("share-status").textContent="Select and copy this specimen link.";}};
lightSelect.onchange=()=>applyLighting();
skeleton.onchange=rebuild;neutral.onchange=rebuild;$("export-json").onclick=exportJson;
function layout(){const vp=$("viewport"),panel=document.querySelector<HTMLElement>(".side-panel"),header=document.querySelector<HTMLElement>(".topbar"),bottom=innerWidth<=850&&panel?`${Math.ceil(panel.getBoundingClientRect().height)}px`:"32px",top=`${Math.ceil(header?.getBoundingClientRect().height||82)}px`;vp.style.top=top;vp.style.bottom=bottom;camera.aspect=Math.max(1,vp.clientWidth)/Math.max(1,vp.clientHeight);camera.updateProjectionMatrix();renderer.setSize(Math.max(1,vp.clientWidth),Math.max(1,vp.clientHeight));if(ready)fitCamera();}addEventListener("resize",layout);const layoutObserver=new ResizeObserver(()=>layout());layoutObserver.observe(document.querySelector<HTMLElement>(".side-panel")!);layoutObserver.observe(document.querySelector<HTMLElement>(".topbar")!);
Object.defineProperty(window,"__creatureLab",{configurable:false,writable:false,value:{get ready(){return ready;},get error(){return error||null;},get mode(){return "composer";},get time(){return time;},get specimenState(){return specimenState();},get specimenUrl(){return creatureLabUrl(location.href,specimenState());},get renderer(){return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory}};},get cpuMs(){return cpuMs;},get fps(){return fps;},get composer(){return composer.details();},get eyeView(){return composer.focus()==="eyes"?composer.eyeView(camera):null;},get camera(){camera.updateMatrixWorld();return {position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov,aspect:camera.aspect,near:camera.near,projectionMatrix:camera.projectionMatrix.toArray(),matrixWorldInverse:camera.matrixWorldInverse.toArray()};},get lighting(){return lightingDetails();}}});
function frame(now:number){const start=performance.now(),dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;if(composer.playing){time=(time+dt)%120;composer.syncTime(time);}updateRigs();controls.update();renderer.render(scene,camera);cpuMs=performance.now()-start;if(metricsPending){metricsPending=false;updateMetrics();}frameN++;if(now-lastFps>500){fps=frameN*1000/(now-lastFps);frameN=0;lastFps=now;updateMetrics();}requestAnimationFrame(frame);}
layout();rebuild();layout();requestAnimationFrame(frame);
// The guide only locates existing controls. Following it never changes a loaded recipe.
for(const link of document.querySelectorAll<HTMLAnchorElement>('.animal-guide-links a'))link.onclick=event=>{
 event.preventDefault();const target=document.querySelector<HTMLElement>(link.hash);if(!target)return;
 target.closest('label')?.scrollIntoView({block:'center'});target.focus({preventScroll:true});
};
