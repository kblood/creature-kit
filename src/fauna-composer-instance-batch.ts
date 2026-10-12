import * as THREE from 'three';
import {createComposerColouredMaterial, createComposerCrispCoatMaterial} from './fauna-composer.ts';
import type {ComposerSkin} from './fauna-composer-mesh.ts';
import {patchComposerShadowFade} from './fauna-composer-shadows.ts';
/** Structural skin contract shared by Atlas's render tiers and Kit previews. */
export type FaunaComposerRenderSkin=Pick<ComposerSkin,'positions'|'normals'|'colors'|'skinIndex'|'skinWeight'|'index'|'gloss'|'coatCrisp'|'coatLayers'|'version'>;

export const FAUNA_COMPOSER_REQUIRED_ATTRIBUTES = 15;
const HEADER = `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float composerActor;
uniform sampler2D composerBones;
mat4 composerBone(float index) {
 int x=int(index)*4, y=int(composerActor);
 return mat4(texelFetch(composerBones,ivec2(x,y),0),texelFetch(composerBones,ivec2(x+1,y),0),
             texelFetch(composerBones,ivec2(x+2,y),0),texelFetch(composerBones,ivec2(x+3,y),0));
}
`;
/** Shared by colour, directional/spot depth, and point-light shadow programs. */
export function patchFaunaComposerInstancing(shader: {vertexShader: string}): void {
  const replace = (anchor: string, replacement: string) => {
    if (shader.vertexShader.split(anchor).length !== 2) throw new Error(`Composer instancing shader anchor: ${anchor}`);
    shader.vertexShader = shader.vertexShader.replace(anchor, replacement);
  };
  replace('#include <common>', '#include <common>\n' + HEADER);
  replace('void main() {', `void main() {
    mat4 composerSkin = skinWeight.x*composerBone(skinIndex.x)+skinWeight.y*composerBone(skinIndex.y)
                      +skinWeight.z*composerBone(skinIndex.z)+skinWeight.w*composerBone(skinIndex.w);`);
  if (shader.vertexShader.includes('#include <beginnormal_vertex>')) replace('#include <beginnormal_vertex>',
    '#include <beginnormal_vertex>\nobjectNormal=(composerSkin*vec4(objectNormal,0.0)).xyz;');
  replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed=(composerSkin*vec4(transformed,1.0)).xyz;');
}
function install(material: THREE.Material, palette: {value: THREE.DataTexture},shadow=false): void {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {before.call(material, shader, renderer); patchFaunaComposerInstancing(shader);if(shadow)patchComposerShadowFade(shader,'1.0-fract(composerActor)*4.0'); shader.uniforms.composerBones = palette;};
  material.customProgramCacheKey = () => `${key}/composer-variable-instances-1${shadow?'/shadow-fade-1':''}`;
}
export function faunaComposerGeometry(skin: FaunaComposerRenderSkin): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [attribute, array, width] of [
    ['position', skin.positions, 3], ['normal', skin.normals, 3], ['color', skin.colors, 3],
    ['skinIndex', skin.skinIndex, 4], ['skinWeight', skin.skinWeight, 4], ['composerGloss', skin.gloss, 1],
  ] as const) g.setAttribute(attribute, new THREE.BufferAttribute(array, width));
  if (skin.coatLayers) for (const [attribute, array, width] of [
    ['coatL0', skin.coatLayers.c0, 3], ['coatL1', skin.coatLayers.c1, 3], ['coatL2', skin.coatLayers.c2, 3], ['coatSample', skin.coatLayers.sample, 4],
  ] as const) g.setAttribute(attribute, new THREE.BufferAttribute(array, width));
  g.setIndex(new THREE.BufferAttribute(skin.index, 1));
  g.userData.composer = {skin: skin.version, coatCrisp: skin.coatCrisp?.version ?? null};
  return g;
}
/** One geometry/coat source per draw. Identical definitions share this batch;
 * different anatomy or coat parameters are never substituted to increase batching. */
export class FaunaComposerInstanceBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly uploadedGeometryBytes: number;
  readonly instanceBytes: number;
  private readonly actors: THREE.InstancedBufferAttribute;
  private disposed = false;
  private shadowAllowed:boolean|undefined;private shadowActors=0;
  readonly skin: FaunaComposerRenderSkin;
  readonly capacity: number;
  constructor(skin: FaunaComposerRenderSkin, palette: {value: THREE.DataTexture}, capacity: number, roughness = .82) {
    this.skin = skin; this.capacity = capacity;
    const geometry = faunaComposerGeometry(skin);
    this.actors = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.uploadedGeometryBytes = Object.values(geometry.attributes).reduce((n, a) => n + a.array.byteLength, geometry.index!.array.byteLength);
    geometry.setAttribute('composerActor', this.actors);
    const material = skin.coatCrisp ? createComposerCrispCoatMaterial(skin.coatCrisp) : createComposerColouredMaterial();
    material.roughness = roughness;
    install(material, palette);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const depth = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking}); install(depth, palette,true);
    const distance = new THREE.MeshDistanceMaterial(); install(distance, palette,true);
    this.mesh.customDepthMaterial = depth; this.mesh.customDistanceMaterial = distance;
    this.mesh.name = 'Planet Composer source instances'; this.mesh.count = 0;
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.instanceBytes = this.mesh.instanceMatrix.array.byteLength + this.actors.array.byteLength;
  }
  beginFrame(): void {this.shadowAllowed??=this.mesh.castShadow;this.shadowActors=0;this.mesh.count = 0; this.mesh.visible = false;}
  submit(matrix: THREE.Matrix4, paletteRow: number,shadowStrength=1): void {
    const i = this.mesh.count;
    if (this.disposed || i >= this.capacity) throw new Error('Composer instance capacity exceeded');
    if(!Number.isFinite(shadowStrength)||shadowStrength<0||shadowStrength>1)throw new Error('Invalid Composer shadow strength');
    this.mesh.setMatrixAt(i, matrix); this.actors.setX(i, paletteRow+(1-shadowStrength)*.25);if(shadowStrength>0)this.shadowActors++;this.mesh.count++; this.mesh.visible = true;
  }
  endFrame(): void {
    this.shadowAllowed??=this.mesh.castShadow;
    this.mesh.castShadow=!!this.shadowAllowed&&this.shadowActors>0;
    if (!this.mesh.count) return;
    this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, this.mesh.count * 16); this.mesh.instanceMatrix.needsUpdate = true;
    this.actors.clearUpdateRanges(); this.actors.addUpdateRange(0, this.mesh.count); this.actors.needsUpdate = true;
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.mesh.removeFromParent();
    this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial!.dispose(); this.mesh.customDistanceMaterial!.dispose(); this.mesh.dispose();
  }
}
