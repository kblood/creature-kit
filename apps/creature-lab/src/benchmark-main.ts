import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {composerPreset,normalizeComposerRecipe,encodeComposerRecipe,type ComposerRecipe} from '../../../src/fauna-composer-recipe.ts';
import {createComposerColouredMaterial,createComposerCrispCoatMaterial,type ComposerCreature} from '../../../src/fauna-composer.ts';
import {poseComposer,type ComposerPose} from '../../../src/fauna-composer-rig.ts';
import {composerPreviewLod} from '../../../src/fauna-composer-preview-lod.ts';
import {FaunaComposerInstanceBatch,faunaComposerGeometry,FAUNA_COMPOSER_REQUIRED_ATTRIBUTES} from '../../../src/fauna-composer-instance-batch.ts';
import {FaunaComposerPaletteWriter} from '../../../src/fauna-composer-palette.ts';
import type {ComposerSkin,ComposerSkinPresentation} from '../../../src/fauna-composer-mesh.ts';
import type {PlanetComposerDefinition} from '../../../src/planet-composer.ts';
import {createLabComposerActor,parseLabPlanetDefinition,parseLabJson} from './creature-lab-planet.ts';
import {benchmarkMembers,benchmarkTier,sampleStats,BENCHMARK_PRESETS,type BenchmarkOptions,type BenchmarkTier,type BenchmarkMember} from './benchmark-state.ts';
import {BenchmarkGpuTimer} from './benchmark-gpu.ts';
import {ComposerPaletteUploads} from '../../../src/fauna-composer-palette-uploads.ts';
import {FaunaComposerRenderer,type FaunaComposerCandidate} from '../../../src/fauna-composer-renderer.ts';
import {buildFaunaComposerRequestedLevels} from '../../../src/fauna-composer-render-source.ts';
import {FAUNA_PLANET_COMPOSER_POLICY} from '../../../src/fauna-planet-composer-policy.ts';
import './benchmark.css';
declare const __ANIMAL_BENCH_BUILD__:{commit:string;version:string;dirty:boolean};

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const select=(id:string)=>$<HTMLSelectElement>(id).value;
const checked=(id:string)=>$<HTMLInputElement>(id).checked;
const controlsIds=['count','collection','placement','lod','atlas-renderer','instancing','partial-uploads','share-geometry','share-pose','culling','shadows','animate','stride','duration','observer','overview','measure','compare','compare-uploads'];
const scene=new THREE.Scene();scene.background=new THREE.Color('#08131a');
const camera=new THREE.PerspectiveCamera(47,1,.1,1000);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('viewport').append(renderer.domElement);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.maxDistance=800;
const ambient=new THREE.HemisphereLight('#d2eeff','#658065',2);scene.add(ambient);
const sun=new THREE.DirectionalLight('#fff0da',3);sun.position.set(40,90,20);sun.target.position.set(0,0,-130);scene.add(sun,sun.target);
sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-180,right:180,top:180,bottom:-180,near:1,far:600});sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.0002;
const ground=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),new THREE.MeshStandardMaterial({color:'#456359',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.set(0,-.03,-180);ground.receiveShadow=true;scene.add(ground);
const group=new THREE.Group();scene.add(group);
const gl=renderer.getContext() as WebGL2RenderingContext;
const gpu=new BenchmarkGpuTimer(gl);

interface Source{key:string;actor:ComposerCreature;skins:Record<BenchmarkTier,ComposerSkin>;geometries:Record<BenchmarkTier,THREE.BufferGeometry>;writer:FaunaComposerPaletteWriter}
interface Member extends BenchmarkMember{tier:BenchmarkTier;row:number;matrix:THREE.Matrix4;sphere:THREE.Sphere;mesh?:THREE.SkinnedMesh;ownedGeometry?:THREE.BufferGeometry;visible:boolean;pose?:ComposerPose}
const cache=new Map<string,Source>();let sources:Source[]=[],members:Member[]=[],batches=new Map<string,FaunaComposerInstanceBatch>();
let palette:THREE.DataTexture|null=null,paletteData=new Float32Array(0),maxBones=1;
let paletteUploads:ComposerPaletteUploads|null=null;
type AtlasDefinition={source:number;key:string};
let atlas:FaunaComposerRenderer<AtlasDefinition>|null=null;
const atlasCandidates:FaunaComposerCandidate<AtlasDefinition>[]=[],atlasPoses=new Map<number,ComposerPose>();
let options:BenchmarkOptions,ready=false,error:string|null=null,building=false,buildToken=0,buildMs=0,time=0,frameNumber=0,last=performance.now(),lastHud=0;
 const recentFrames:number[]=[],recentCpu:number[]=[];
let sourceRecipe=composerPreset('dinosaur'),definition:PlanetComposerDefinition|undefined,presentation:ComposerSkinPresentation='realism-1';
let runSerial=0,active:Capture|null=null,cancelled=false,running=false;
const results:Result[]=[];
interface Capture{id:number;start:number;frame:number[];cpu:number[];gpu:number[];calls:number[];triangles:number[];visible:number[];poseCalculations:number[];uploadBytes:number[];collecting:boolean}
interface Result{simulationStartSeconds:number;settings:BenchmarkOptions;camera:{position:number[];target:number[]};durationSeconds:number;frameMs:ReturnType<typeof sampleStats>;cpuMs:ReturnType<typeof sampleStats>;gpuMs:ReturnType<typeof sampleStats>;gpuDropped:number;paletteUploadBytes:ReturnType<typeof sampleStats>;drawCalls:ReturnType<typeof sampleStats>;triangles:ReturnType<typeof sampleStats>;visibleAnimals:ReturnType<typeof sampleStats>;poseCalculations:ReturnType<typeof sampleStats>;memory:ReturnType<typeof memory>;prepareMs:number;timestamp:string;scene:unknown[];environment:ReturnType<typeof environment>}

function readOptions():BenchmarkOptions{return {count:Number(select('count')),collection:select('collection') as BenchmarkOptions['collection'],placement:select('placement') as BenchmarkOptions['placement'],lod:select('lod') as BenchmarkOptions['lod'],instancing:checked('instancing'),atlasRenderer:checked('atlas-renderer'),partialUploads:checked('partial-uploads'),shareGeometry:checked('share-geometry'),sharePose:checked('share-pose'),culling:checked('culling'),shadows:checked('shadows'),animate:checked('animate'),stride:Number(select('stride'))};}
function observer(){camera.position.set(0,2.5,12);orbit.target.set(0,1,-70);camera.lookAt(orbit.target);orbit.update();}
function overview(){camera.position.set(125,150,125);orbit.target.set(0,0,-130);camera.lookAt(orbit.target);orbit.update();}
function layout(){const view=$('viewport');camera.aspect=Math.max(1,view.clientWidth)/Math.max(1,view.clientHeight);camera.updateProjectionMatrix();renderer.setSize(Math.max(1,view.clientWidth),Math.max(1,view.clientHeight));}
new ResizeObserver(()=>{if(running)cancel('Viewport changed; measurement cancelled.');layout();}).observe($('viewport'));
function clearMeshes(){
 atlas?.dispose();atlas=null;atlasCandidates.length=0;atlasPoses.clear();paletteUploads?.dispose();paletteUploads=null;
 for(const batch of batches.values())batch.dispose();batches.clear();
 for(const member of members){member.mesh?.removeFromParent();member.mesh?.skeleton.dispose();member.ownedGeometry?.dispose();if(member.mesh)(member.mesh.material as THREE.Material).dispose();delete member.mesh;delete member.ownedGeometry;}
 palette?.dispose();palette=null;paletteData=new Float32Array(0);group.clear();
}
function buildSeparate(member:Member){
 const source=sources[member.source]!,skin=source.skins[member.tier];
 const geometry=options.shareGeometry?source.geometries[member.tier]:source.geometries[member.tier].clone();
 if(!options.shareGeometry)member.ownedGeometry=geometry;
 const material=skin.coatCrisp?createComposerCrispCoatMaterial(skin.coatCrisp):createComposerColouredMaterial();material.roughness=(source.actor.mesh.material as THREE.MeshStandardMaterial).roughness;
 const mesh=new THREE.SkinnedMesh(geometry,material);mesh.frustumCulled=false;mesh.castShadow=options.shadows;mesh.position.fromArray(member.position);
 const bones=source.actor.graph.bones.map(b=>{const bone=new THREE.Bone();bone.position.fromArray(b.restPosition);bone.quaternion.fromArray(b.restQuaternion);mesh.add(bone);return bone;});
 mesh.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton(bones));member.mesh=mesh;group.add(mesh);
}
function batchFor(member:Member){const key=`${member.source}/${member.tier}`;let batch=batches.get(key);if(!batch){
 const source=sources[member.source]!;batch=new FaunaComposerInstanceBatch(source.skins[member.tier],{value:palette!},members.filter(m=>m.source===member.source).length,(source.actor.mesh.material as THREE.MeshStandardMaterial).roughness);
 batch.mesh.castShadow=options.shadows;group.add(batch.mesh);batches.set(key,batch);
 }return batch;}
function configureMeshes(){
 clearMeshes();maxBones=Math.max(...sources.map(s=>s.actor.graph.bones.length));
 if(options.atlasRenderer){
  const p=FAUNA_PLANET_COMPOSER_POLICY;
  atlas=new FaunaComposerRenderer({provider:{async build(job){const source=sources[job.definition.source]!,original={graph:source.actor.graph,skin:source.actor.skin};return {key:job.key,source:original,levels:buildFaunaComposerRequestedLevels(original,job.tiers,[p.middleTargetTriangles,p.farTargetTriangles]),buildMs:0};}},
   pose:(graph,c)=>{if(options.sharePose){const cached=atlasPoses.get(c.definition.source);if(cached)return cached;}const pose=poseComposer(graph,'walk',c.rigSeconds);poseCalculations++;if(options.sharePose)atlasPoses.set(c.definition.source,pose);return pose;},
   onMeshAdopted:mesh=>{mesh.castShadow=options.shadows;},capacity:p.capacity,maxSources:p.capacity,maxBones:p.maxBones,maxBytes:p.residentBytes,maxResultBytes:p.resultBytes,workerReserveBytes:p.workerReserveBytes,
   fullSourceCache:p.nearSources,middleSourceCache:p.middleSources,coldJobsBeforeNearUpgrade:8,nearM:p.nearM,middleM:p.middleM,maxDistanceM:p.visibleM,partialPaletteUploads:options.partialUploads,
   mergedGpuContext:gl,mergedTiers:{middle:{maxVertices:p.middleVertices,maxIndices:p.middleIndices,maxBytes:5*1024*1024,storage:'packed-1'},far:{maxVertices:p.farVertices,maxIndices:p.farIndices,maxBytes:35*1024*1024,storage:'packed-1',activeIndexPasses:true}}});
  atlas.assertCapabilities(renderer);atlas.setViewCameras([camera]);group.add(atlas.group);
  for(const member of members){delete member.pose;atlasCandidates.push({id:String(member.id),definition:{source:member.source,key:sources[member.source]!.key},sourceKey:sources[member.source]!.key,matrix:member.matrix,distanceM:0,cameraVisible:true,rigSeconds:time});}
  sun.castShadow=options.shadows;renderer.shadowMap.needsUpdate=true;lastHud=-Infinity;
  $<HTMLInputElement>('instancing').disabled=true;$<HTMLInputElement>('share-geometry').disabled=true;$<HTMLSelectElement>('stride').disabled=true;
  $('optimization-note').textContent='Actual Atlas controller with its packed GPU arenas, admission budgets and camera/shadow index handling. Automatic LOD requests can fall back to a cheaper resident level under those budgets.';return;
 }
 $<HTMLInputElement>('instancing').disabled=false;$<HTMLSelectElement>('stride').disabled=false;
 if(options.instancing){
  const rows=options.sharePose?sources.length:members.length;
  paletteData=new Float32Array(maxBones*16*rows);palette=new THREE.DataTexture(paletteData,maxBones*4,rows,THREE.RGBAFormat,THREE.FloatType);palette.needsUpdate=true;
  paletteUploads=new ComposerPaletteUploads(rows,options.partialUploads);paletteUploads.attach(palette);
 }
 for(const member of members){delete member.pose;member.row=options.sharePose?member.source:member.id;member.tier=benchmarkTier(camera.position.distanceTo(new THREE.Vector3().fromArray(member.position)),options.lod);if(options.instancing)batchFor(member);else buildSeparate(member);}
 sun.castShadow=options.shadows;renderer.shadowMap.needsUpdate=true;
 lastHud=-Infinity;
 $('share-geometry').toggleAttribute('disabled',options.instancing);
 $('optimization-note').textContent=options.instancing?'Instancing shares geometry within each identical specimen + LOD group. Different species use separate batches. Shared pose synchronizes the repeated animals.':'Separate skinned meshes: geometry sharing saves geometry buffers; each animal still has its own draw and skeleton. Shared pose reduces solver work.';
}
async function prepare(){
 const token=++buildToken;ready=false;building=true;error=null;const started=performance.now();options=readOptions();clearMeshes();
 $('bench-status').textContent='Preparing source animals and LODs…';
 try{
  if(options.instancing&&gl.getParameter(gl.MAX_VERTEX_ATTRIBS)<FAUNA_COMPOSER_REQUIRED_ATTRIBUTES)throw new Error('Animated instancing needs at least 15 vertex attributes on this device.');
  const recipes=options.collection==='mixed'?BENCHMARK_PRESETS.map(id=>composerPreset(id)):[sourceRecipe];
  const prepared:Source[]=[];
  for(let i=0;i<recipes.length;i++){
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(token!==buildToken)return;
   const recipe=recipes[i]!,planet=options.collection==='selected'?definition:undefined,key=JSON.stringify([presentation,planet??recipe]);
   let source=cache.get(key);
   if(!source){
    const actor=createLabComposerActor(recipe,planet,presentation);
    const skins={'source':actor.skin,'4500':composerPreviewLod(actor.skin,actor.graph,4500),'1000':composerPreviewLod(actor.skin,actor.graph,1000)};
    source={key,actor,skins,geometries:{source:faunaComposerGeometry(skins.source),'4500':faunaComposerGeometry(skins['4500']),'1000':faunaComposerGeometry(skins['1000'])},writer:new FaunaComposerPaletteWriter(actor.graph)};cache.set(key,source);
   }
   prepared.push(source);$('bench-status').textContent=`Prepared ${i+1}/${recipes.length} specimens…`;
  }
  sources=prepared;members=benchmarkMembers(options).map(m=>{const source=sources[m.source]!;
   const bounds=source.actor.bounds(),radius=bounds.getSize(new THREE.Vector3()).length()/2+Math.max(1,source.actor.graph.dims.bodyLength);
   const centre=bounds.getCenter(new THREE.Vector3()).add(new THREE.Vector3().fromArray(m.position));
   return {...m,tier:'source',row:m.id,matrix:new THREE.Matrix4().makeTranslation(...m.position),sphere:new THREE.Sphere(centre,radius),visible:true} as Member;});
  configureMeshes();buildMs=performance.now()-started;ready=true;$('bench-status').textContent='Ready. Warm-up and source preparation are excluded from recorded frame timings.';
 }catch(e){error=String(e);$('bench-status').textContent=error;clearMeshes();}finally{if(token===buildToken)building=false;}
}
const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),position=new THREE.Vector3();let poseCalculations=0;
function update(){
 camera.updateMatrixWorld();frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const poses=new Map<number,ComposerPose>(),writtenRows=new Set<number>();poseCalculations=0;let paletteChanged=false;
 if(atlas){
  atlasPoses.clear();
  for(const member of members){const c=atlasCandidates[member.id]!,distance=camera.position.distanceTo(position.fromArray(member.position));
   member.visible=(options.lod!=='auto'||distance<=600)&&(!options.culling||frustum.intersectsSphere(member.sphere));
   c.cameraVisible=member.visible;c.shadowVisible=options.shadows;c.distanceM=options.lod==='source'?0:options.lod==='4500'?80:options.lod==='1000'?300:distance;
   c.rigSeconds=time+(options.sharePose?0:member.id*.071);c.poseKey=String(c.rigSeconds);
  }
  atlas.update(atlasCandidates);return;
 }
 for(const batch of batches.values())batch.beginFrame();
 for(const member of members){
  const distance=camera.position.distanceTo(position.fromArray(member.position)),inRange=options.lod!=='auto'||distance<=600;
  const next=benchmarkTier(distance,options.lod,member.tier);
  if(next!==member.tier){member.tier=next;if(!options.instancing){member.mesh?.removeFromParent();member.mesh?.skeleton.dispose();member.ownedGeometry?.dispose();if(member.mesh)(member.mesh.material as THREE.Material).dispose();delete member.ownedGeometry;buildSeparate(member);}else batchFor(member);}
  member.visible=inRange&&(!options.culling||frustum.intersectsSphere(member.sphere));
  if(!inRange){if(member.mesh)member.mesh.visible=false;continue;}
  // Shadow casters retain their poses even outside the main camera, so culling
  // cannot freeze an off-camera animal's shadow.
  if(member.visible||options.shadows){
   const source=sources[member.source]!;
   const needsPose=!member.pose||(options.animate&&frameNumber%options.stride===0);
   if(needsPose){let pose=options.sharePose?poses.get(member.source):undefined;
    if(!pose){pose=poseComposer(source.actor.graph,'walk',time+(options.sharePose?0:member.id*.071));poseCalculations++;if(options.sharePose)poses.set(member.source,pose);}
    member.pose=pose;
    if(options.instancing){if(!writtenRows.has(member.row)){
     const offset=member.row*maxBones*16,count=source.actor.graph.bones.length*16;
     source.writer.write(pose,paletteData,offset);paletteUploads!.mark(offset,count);writtenRows.add(member.row);paletteChanged=true;}}
    else{const bones=member.mesh!.skeleton.bones;for(let i=0;i<bones.length;i++){bones[i]!.position.fromArray(pose.positions,i*3);bones[i]!.quaternion.fromArray(pose.quaternions,i*4);bones[i]!.scale.set(1,pose.radialScale[i]!,pose.radialScale[i]!*pose.chordScale[i]!);}}
   }
  }
  if(options.instancing){if(member.visible||options.shadows)batchFor(member).submit(member.matrix,member.row);}
  else member.mesh!.visible=member.visible||options.shadows;
 }
 for(const batch of batches.values())batch.endFrame();if(paletteChanged)paletteUploads!.flush();
}
function memory(){
 const buffers=new Set<ArrayBufferLike>();let separateSkeletonBytes=0;
 const take=(geometry:THREE.BufferGeometry)=>{for(const a of Object.values(geometry.attributes))if(!(a instanceof THREE.InstancedBufferAttribute))buffers.add(a.array.buffer);if(geometry.index)buffers.add(geometry.index.array.buffer);};
 for(const s of cache.values())for(const geometry of Object.values(s.geometries))take(geometry);
 for(const m of members){if(m.ownedGeometry)take(m.ownedGeometry);if(m.mesh)separateSkeletonBytes+=m.mesh.skeleton.boneMatrices.byteLength;}
 let instanceBytes=0;for(const b of batches.values()){take(b.mesh.geometry);instanceBytes+=b.instanceBytes;}
 return {geometryArrayBytes:[...buffers].reduce((n,b)=>n+b.byteLength,0),paletteBytes:paletteData.byteLength,separateSkeletonBytes,instanceBytes,atlasOwnedBytes:atlas?.ownedBytes??0,scope:'Reference geometry arrays plus Atlas owned bytes when selected; overlapping source arrays are not additive. Excludes complete browser/driver memory.'};
}
function environment(){const ext=gl.getExtension('WEBGL_debug_renderer_info');return {build:__ANIMAL_BENCH_BUILD__,crossOriginIsolated,userAgent:navigator.userAgent,devicePixelRatio,pixelRatio:renderer.getPixelRatio(),canvas:[renderer.domElement.width,renderer.domElement.height],webglVersion:gl.getParameter(gl.VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),gpuTimerSupported:gpu.supported,visibility:document.visibilityState};}
function lock(value:boolean){running=value;orbit.enabled=!value;for(const id of controlsIds)$<HTMLInputElement>(id).disabled=value;$<HTMLButtonElement>('cancel').disabled=!value;if(!value){$<HTMLInputElement>('share-geometry').disabled=options.instancing||options.atlasRenderer;$<HTMLInputElement>('instancing').disabled=options.atlasRenderer;$<HTMLSelectElement>('stride').disabled=options.atlasRenderer;}}
function cancel(message='Cancelled.'){cancelled=true;active=null;gpu.clear();$('bench-status').textContent=message;}
function wait(ms:number){const start=performance.now();return new Promise<void>((resolve,reject)=>{const tick=()=>{if(cancelled||document.hidden||!ready){reject(new Error('Measurement cancelled or scene unavailable.'));return;}if(performance.now()-start>=ms)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});}
 async function capture(simulationStartSeconds=time):Promise<Result>{
 const duration=Number(select('duration'));
 if(atlas){$('bench-status').textContent='Waiting for Atlas source admission and upgrades…';const started=performance.now();while(atlas.pendingPresentationWork){await wait(50);if(performance.now()-started>60000)throw new Error('Atlas admission did not settle before measurement.');}}$('bench-status').textContent='Warming up for 2 seconds…';gpu.clear();await wait(2000);
 if(atlas){const started=performance.now();while(atlas.pendingPresentationWork){await wait(50);if(performance.now()-started>60000)throw new Error('Atlas warm-up did not settle.');}}
 time=simulationStartSeconds;frameNumber=0;for(const member of members)delete member.pose;
 const c:Capture={id:++runSerial,start:performance.now(),frame:[],cpu:[],gpu:[],calls:[],triangles:[],visible:[],poseCalculations:[],uploadBytes:[],collecting:true};active=c;const dropped=gpu.dropped;
 $('bench-status').textContent=`Measuring for ${duration} seconds…`;await wait(duration*1000);c.collecting=false;
 const ended=performance.now();await wait(250);gpu.clear();active=null;
 if(c.frame.length<10)throw new Error('Too few frame samples.');
 return {simulationStartSeconds,settings:{...options},camera:{position:camera.position.toArray(),target:orbit.target.toArray()},durationSeconds:(ended-c.start)/1000,frameMs:sampleStats(c.frame),cpuMs:sampleStats(c.cpu),gpuMs:sampleStats(c.gpu),gpuDropped:gpu.dropped-dropped,paletteUploadBytes:sampleStats(c.uploadBytes),drawCalls:sampleStats(c.calls),triangles:sampleStats(c.triangles),visibleAnimals:sampleStats(c.visible),poseCalculations:sampleStats(c.poseCalculations),memory:memory(),prepareMs:buildMs,timestamp:new Date().toISOString(),scene:sources.map(s=>({recipe:s.actor.graph.recipe,definition:s.actor.group.userData.planetComposerDefinition??null,skinVersion:s.actor.skin.version,graphVersion:s.actor.graph.version,triangles:Object.fromEntries(Object.entries(s.skins).map(([k,v])=>[k,v.triangleCount]))})),environment:environment()};
}
const ms=(stats:ReturnType<typeof sampleStats>)=>stats?stats.median.toFixed(2):'unavailable';
function showResults(){
 if(results.length>32)results.splice(0,results.length-32);
 const latest=results.slice(-6);$('results').innerHTML='<table><thead><tr><th>Run / animals</th><th>FPS</th><th>Frame median / p95 ms</th><th>CPU ms</th><th>GPU ms</th><th>Draws</th></tr></thead><tbody>'+latest.map((r,i)=>`<tr><td>${results.length-latest.length+i+1} · ${r.settings.atlasRenderer?'Atlas arenas':r.settings.instancing?'instances':'meshes'} · ${r.settings.count} ${r.settings.collection==='mixed'?'mixed':'same'}</td><td>${(1000/r.frameMs!.mean).toFixed(1)}</td><td>${ms(r.frameMs)} / ${r.frameMs!.p95.toFixed(2)}</td><td>${ms(r.cpuMs)}</td><td>${ms(r.gpuMs)}</td><td>${r.drawCalls!.median}</td></tr>`).join('')+'</tbody></table>';
 $<HTMLButtonElement>('export').disabled=!results.length;
}
async function measure(compare:boolean,uploadComparison=false){
 if(!ready||running)return;cancelled=false;lock(true);const savedTime=time,savedInstancing=options.instancing,savedAtlas=options.atlasRenderer,savedPartial=options.partialUploads;
 try{
  if(compare){for(const enabled of [false,true]){time=savedTime;if(uploadComparison){options={...options,partialUploads:enabled};$<HTMLInputElement>('partial-uploads').checked=enabled;}else{options={...options,instancing:enabled,atlasRenderer:false};$<HTMLInputElement>('instancing').checked=enabled;}configureMeshes();for(const m of members)delete m.pose;const r=await capture(savedTime);results.push(r);showResults();}}
  else{results.push(await capture());showResults();}
  $('bench-status').textContent=compare?`Comparison complete. Same animals, camera and starting clock; only ${uploadComparison?'partial uploads':'instancing'} changed.`:'Benchmark complete. Results can be exported.';
 }catch(e){$('bench-status').textContent=String(e);}
 finally{active=null;gpu.clear();if(compare){options={...options,instancing:savedInstancing,atlasRenderer:savedAtlas,partialUploads:savedPartial};$<HTMLInputElement>('instancing').checked=savedInstancing;$<HTMLInputElement>('partial-uploads').checked=savedPartial;configureMeshes();for(const m of members)delete m.pose;time=savedTime;}lock(false);}
}
function hud(){const actual=atlas?.diagnostics(),counts={source:0,'4500':0,'1000':0};if(actual)for(const a of actual.actors)counts[a.tier==='near'?'source':a.tier==='middle'?'4500':'1000']++;else for(const m of members)counts[m.tier]++;const visible=members.filter(m=>m.visible).length;
 $('scene-summary').textContent=`${members.length} animals · ${sources.length} specimens · LOD: ${counts.source} full / ${counts['4500']} middle / ${counts['1000']} far · ${visible} in camera · orbit / drag to change viewpoint`;
 const frames=sampleStats(recentFrames),cpu=sampleStats(recentCpu),owned=memory();
 $('live-metrics').textContent=`${frames?(1000/frames.mean).toFixed(1):'–'} FPS · CPU ${ms(cpu)} ms · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles drawn (including ground and shadows) · ${poseCalculations} pose calculations this frame · ${(owned.geometryArrayBytes/1048576).toFixed(1)} MiB geometry arrays · ${((owned.paletteBytes+owned.separateSkeletonBytes+owned.instanceBytes)/1048576).toFixed(2)} MiB pose / instance buffers · ${atlas?'Atlas packed arenas':options.instancing?'instances':'individual meshes'} · GPU timer ${gpu.supported?'available':'unavailable'}`;
}
function frame(now:number){
 const interval=now-last;last=now;frameNumber++;
 gpu.poll((run,ms)=>{if(active?.id===run)active.gpu.push(ms);});
 if(ready&&!building){const start=performance.now();if(options.animate)time+=Math.min(interval,100)/1000;orbit.update();update();
  const uploadedBefore=atlas?.uploadedPaletteBytes??paletteUploads?.uploadedBytes??0;const c=active?.collecting?active:null;if(c)gpu.begin(c.id);renderer.render(scene,camera);if(c)gpu.end();const cpu=performance.now()-start;
  if(c){c.uploadBytes.push((atlas?.uploadedPaletteBytes??paletteUploads?.uploadedBytes??0)-uploadedBefore);c.frame.push(interval);c.cpu.push(cpu);c.calls.push(renderer.info.render.calls);c.triangles.push(renderer.info.render.triangles);c.visible.push(members.filter(m=>m.visible).length);c.poseCalculations.push(poseCalculations);}
  recentFrames.push(interval);recentCpu.push(cpu);if(recentFrames.length>120){recentFrames.shift();recentCpu.shift();}
  if(now-lastHud>500){hud();lastHud=now;}
 }
 requestAnimationFrame(frame);
}
for(const id of controlsIds.filter(id=>!['duration','observer','overview','measure','compare','compare-uploads'].includes(id)))$(id).onchange=()=>{if(running)cancel('Settings changed; measurement cancelled.');void prepare();};
$('observer').onclick=observer;$('overview').onclick=overview;$('measure').onclick=()=>void measure(false);$('compare').onclick=()=>void measure(true);$('compare-uploads').onclick=()=>void measure(true,true);$('cancel').onclick=()=>cancel();
$('export').onclick=()=>{const data={schema:'animal-population-benchmark-1',method:'2-second warm-up; display-paced frames; CPU update + submission; asynchronous disjoint-aware GPU queries; no readback in timed frames',results};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='animal-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)cancel('Page became hidden; measurement cancelled.');});
renderer.domElement.addEventListener('webglcontextlost',()=>{cancel('WebGL context lost; reload to continue.');ready=false;error='WebGL context lost';});
addEventListener('pagehide',()=>{cancel();clearMeshes();for(const source of cache.values()){source.actor.dispose();for(const geometry of Object.values(source.geometries))geometry.dispose();}cache.clear();gpu.dispose();orbit.dispose();renderer.dispose();});
try{
 const input=new URLSearchParams(location.hash.slice(1));if(input.get('presentation')==='skin-5')presentation='skin-5';
 if(input.has('planetDefinition')){definition=parseLabPlanetDefinition(input.get('planetDefinition')!);sourceRecipe=definition.recipe;}
 else if(input.has('recipe'))sourceRecipe=normalizeComposerRecipe(parseLabJson(input.get('recipe')!) as ComposerRecipe).recipe;
 const edit=new URL('./creature-lab.html?mode=composer',location.href);edit.searchParams.set('presentation',presentation);
 if(definition)edit.hash=new URLSearchParams({planetDefinition:JSON.stringify(definition)}).toString();else edit.searchParams.set('recipe',encodeComposerRecipe(sourceRecipe));$<HTMLAnchorElement>('edit-animal').href=edit.href;
 observer();layout();requestAnimationFrame(frame);void prepare();
}catch(e){error=String(e);$('bench-status').textContent=`Cannot open specimen: ${error}`;}
Object.defineProperty(window,'__animalBenchmark',{value:{get ready(){return ready;},get error(){return error;},get running(){return running;},get settings(){return options;},get results(){return structuredClone(results);},get state(){return {time,building,buildMs,poseCalculations,atlas:atlas?.diagnostics()??null,batches:batches.size,members:members.map(m=>({id:m.id,source:m.source,tier:m.tier,visible:m.visible,position:m.position,row:m.row})),sources:sources.map(s=>({recipe:s.actor.graph.recipe,definition:s.actor.group.userData.planetComposerDefinition??null,bones:s.actor.graph.bones.length,triangles:Object.fromEntries(Object.entries(s.skins).map(([k,v])=>[k,v.triangleCount]))})),memory:memory(),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:renderer.info.memory},environment:environment()};}}});
