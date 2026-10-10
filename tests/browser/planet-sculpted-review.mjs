import * as THREE from 'three';
const base=new URLSearchParams(location.search).get('data');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1600,900);renderer.setPixelRatio(1);renderer.autoClear=false;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#25313b');scene.add(new THREE.HemisphereLight('#e6f3ff','#5c5040',2));
const key=new THREE.DirectionalLight('#fff0d8',2.6);key.position.set(3,6,5);scene.add(key);
const fill=new THREE.DirectionalLight('#b4d7ff',.9);fill.position.set(-4,2,-4);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#34404a',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.0002;scene.add(floor);
const grid=new THREE.GridHelper(24,48,'#54636a','#3c4850');grid.position.y=.0001;scene.add(grid);
let row,rigs=[],lastIndex=-1;
function makeRig(s){
  const geo=new THREE.BufferGeometry();for(const [name,type,lanes,normalized] of [['position',Float32Array,3,false],['normal',Float32Array,3,false],['color',Uint8Array,3,true],['skinIndex',Uint8Array,4,false],['skinWeight',Uint8Array,4,true]])geo.setAttribute(name,new THREE.BufferAttribute(new type(s[{position:'positions',normal:'normals',color:'colors'}[name]||name]),lanes,normalized));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(s.index),1));
  const bones=s.plan.bones.map(b=>{const bone=new THREE.Bone();bone.name=b.name;return bone;});
  const skeleton=new THREE.Skeleton(bones,s.plan.bones.map(()=>new THREE.Matrix4()));
  const mesh=new THREE.SkinnedMesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83,metalness:0}));mesh.bindMode=THREE.DetachedBindMode;mesh.bind(skeleton,new THREE.Matrix4());mesh.frustumCulled=false;
  return {mesh,skeleton};
}
async function review(i,poseName='rest',view='side',neutral=false){
  if(i!==lastIndex){for(const r of rigs){r.mesh.geometry.dispose();r.mesh.material.dispose();r.skeleton.dispose();}row=await fetch(`${base}/row-${i}.json`).then(r=>r.json());rigs=row.variants.map(v=>makeRig(v.body));lastIndex=i;}
  const pose=row.poses.find(p=>p.name===poseName);if(!pose)throw new Error('unknown pose');
  for(const r of rigs){r.skeleton.boneMatrices.set(pose.palette);if(r.skeleton.boneTexture)r.skeleton.boneTexture.needsUpdate=true;r.mesh.material.vertexColors=!neutral;r.mesh.material.color.set(neutral?'#aeb6ba':'#ffffff');r.mesh.material.needsUpdate=true;}
  const s=row.variants[0].body;
  const deform=(v,b)=>{const p=new THREE.Vector3().fromArray(b.positions,v*3),out=new THREE.Vector3();for(let k=0;k<4;k++){const w=b.skinWeight[v*4+k]/255;if(w)out.addScaledVector(p.clone().applyMatrix4(new THREE.Matrix4().fromArray(pose.palette,b.skinIndex[v*4+k]*16)),w);}return out;};
  const box=new THREE.Box3();for(const v of row.variants.slice(0,2))for(let j=0;j<v.body.vertexCount;j++)box.expandByPoint(deform(j,v.body));
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());let span;
  if(view==='head'){center.fromArray(s.plan.headCentre).applyMatrix4(new THREE.Matrix4().fromArray(pose.palette,6*16));span=Math.max(s.plan.genome.headWidth*.95,s.plan.genome.earLength*.75);}
  else span=Math.max(size.y*.59,(view==='front'?size.z:size.x)*.59/(800/450));
  const camera=new THREE.OrthographicCamera(-span*800/450,span*800/450,span,-span,.01,200);
  camera.position.copy(center).add(view==='front'?new THREE.Vector3(15,.15,0):view==='head'?new THREE.Vector3(7,2,15):new THREE.Vector3(0,.1,15));camera.lookAt(center);camera.updateMatrixWorld(true);
  floor.visible=grid.visible=view!=='head';
  renderer.setScissorTest(false);renderer.setViewport(0,0,1600,900);renderer.clear();
  for(let j=0;j<rigs.length;j++){
    renderer.setScissorTest(true);const x=(j%2)*800,y=j<2?450:0;renderer.setViewport(x,y,800,450);renderer.setScissor(x,y,800,450);renderer.clear();scene.add(rigs[j].mesh);
    // The frozen palette is already in final inverse-bind space. Prevent the
    // renderer from rebuilding it from unused Bone objects in this review.
    rigs[j].skeleton.update=()=>{};
    renderer.render(scene,camera);scene.remove(rigs[j].mesh);
  }renderer.setScissorTest(false);
  document.querySelector('#title').textContent=`${i}: ${row.archetype} ${row.stage} | ${poseName} · ${view}${neutral?' · neutral surface':''} | same genome, pose, framing and lights`;
  document.querySelector('#labels').innerHTML=row.variants.map(v=>`<span>${v.label} · ${v.body.triangleCount.toLocaleString()} triangles</span>`).join('');
  return {i,pose:poseName,view,neutral,id:row.id,renderer:renderer.capabilities.isWebGL2?'WebGL2':'WebGL1'};
}
window.__qualityReview={ready:true,review};
