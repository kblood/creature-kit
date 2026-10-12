import * as THREE from 'three';
import {composerConstraints, type ComposerConstraint, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {composerSkeletonSegments, composerStructure, poseComposer, COMPOSER_BUDGET, COMPOSER_TRUNK_MOTION_VERSION, type ComposerGraph, type ComposerMotion, type ComposerPose, type ComposerPoseOptions} from './fauna-composer-rig.ts';
import {COMPOSER_COAT_CRISP_VERSION, type ComposerCoatCrisp, type ComposerSkin} from './fauna-composer-mesh.ts';
import {COAT_PATTERN_CRISP_GLSL as COMPOSER_COAT_CRISP_GLSL} from './fauna-coat-crisp-glsl.ts';
export {COAT_PATTERN_CRISP_GLSL as COMPOSER_COAT_CRISP_GLSL} from './fauna-coat-crisp-glsl.ts';
import {type ComposerIndividualTraits} from './fauna-composer-individual.ts';
import {buildComposerSource, type ComposerSourceOptions} from './fauna-composer-source.ts';

/** Experimental modular creature: one skinned mesh (one draw call) driven by
 * the composer's own variable skeleton, plus an optional skeleton overlay.
 * Procedural geometry only; nothing here is a finished authored asset. */
export interface ComposerCreatureDetails {
  version: 'fauna-composer-creature-1';
  structure: ReturnType<typeof composerStructure>;
  constraints: ComposerConstraint[];
  vertices: number; triangles: number; bones: number; drawCalls: number;
  parts: {part: string; label: string; triangles: number; bones: number}[];
  budget: typeof COMPOSER_BUDGET; withinBudget: boolean;
  buildMs: number;
  individual: ComposerCreatureIndividual;
}
/** The individual this creature is: its traits, the changes applied to the species recipe, and the recipe actually built. */
export interface ComposerCreatureIndividual {traits: ComposerIndividualTraits; deltas: string[]; effectiveRecipe: ComposerRecipe}
export interface ComposerCreature {
  group: THREE.Group; mesh: THREE.SkinnedMesh; graph: ComposerGraph; skin: ComposerSkin;
  readonly individual: ComposerCreatureIndividual;
  readonly lastPose: ComposerPose | undefined;
  update(motion: ComposerMotion, time: number): ComposerPose;
  setSkeletonVisible(value: boolean): void;
  setNeutral(value: boolean): void;
  /** World-space bounds of the currently posed skin. */
  bounds(): THREE.Box3;
  /** Rest-pose bounds (creature space, metres) of the face: skin parts head, eyes, mouth, horn and trunk.
   * Computed once at build; a fresh copy per call. Empty when the skin has none of those parts. */
  headBounds(): THREE.Box3;
  details(): ComposerCreatureDetails;
  dispose(): void;
}

/** Per-vertex gloss (the skin's `gloss`, attribute `composerGloss`): roughness falls toward this value with it, which
 * gives the cornea a real specular highlight. Gloss 0 leaves the material's roughness untouched. */
export const COMPOSER_GLOSS_ROUGHNESS = 0.06;
export const COMPOSER_GLOSS_CACHE_KEY = 'composer-gloss-1';
/** The shader edits behind the gloss channel: [chunk anchor, replacement]. Each anchor must occur exactly once. */
export const COMPOSER_GLOSS_PATCH = Object.freeze({
  vertex: [
    ['#include <common>', '#include <common>\nattribute float composerGloss;\nvarying float vComposerGloss;'],
    ['#include <begin_vertex>', '#include <begin_vertex>\nvComposerGloss = composerGloss;'],
  ] as readonly (readonly [string, string])[],
  fragment: [
    ['#include <common>', '#include <common>\nvarying float vComposerGloss;'],
    ['#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ${COMPOSER_GLOSS_ROUGHNESS.toFixed(2)}, vComposerGloss);`],
  ] as readonly (readonly [string, string])[],
});
/** Applies COMPOSER_GLOSS_PATCH to a MeshStandardMaterial program; throws when an anchor is not present exactly once
 * (a three.js upgrade that renames a chunk must fail loudly, not silently drop the highlight). */
export function patchComposerGlossShader(shader: {vertexShader: string; fragmentShader: string}): void {
  if (shader.vertexShader.includes('composerGloss') || shader.fragmentShader.includes('vComposerGloss')) throw new Error('composer gloss: shader already patched');
  const apply = (src: string, edits: readonly (readonly [string, string])[], stage: string) => edits.reduce((out, [anchor, replacement]) => {
    const n = out.split(anchor).length - 1;
    if (n !== 1) throw new Error(`composer gloss: ${stage} anchor ${anchor} occurs ${n} times`);
    return out.replace(anchor, replacement);
  }, src);
  shader.vertexShader = apply(shader.vertexShader, COMPOSER_GLOSS_PATCH.vertex, 'vertex');
  shader.fragmentShader = apply(shader.fragmentShader, COMPOSER_GLOSS_PATCH.fragment, 'fragment');
}
/** The creature's coloured material: vertex colours, roughness 0.82, and the gloss channel. */
export function createComposerColouredMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.82, metalness: 0});
  material.onBeforeCompile = shader => patchComposerGlossShader(shader);
  material.customProgramCacheKey = () => COMPOSER_GLOSS_CACHE_KEY;
  return material;
}

// ------------------------------------------------------------------ crisp coat (skin-5, docs/fauna-coat-crisp-v1.md)
/** The crisp-coat shader edits, applied after COMPOSER_GLOSS_PATCH: [chunk anchor, replacement], each anchor exactly once. */
export const COMPOSER_COAT_CRISP_PATCH = Object.freeze({
  vertex: [
    ['#include <common>', '#include <common>\nattribute vec3 coatL0;\nattribute vec3 coatL1;\nattribute vec3 coatL2;\nattribute vec4 coatSample;\nvarying vec3 vCoatL0;\nvarying vec3 vCoatL1;\nvarying vec3 vCoatL2;\nvarying vec4 vCoatSample;'],
    ['#include <begin_vertex>', '#include <begin_vertex>\nvCoatL0 = coatL0; vCoatL1 = coatL1; vCoatL2 = coatL2; vCoatSample = coatSample;'],
  ] as readonly (readonly [string, string])[],
  fragment: [
    ['#include <common>', `#include <common>\n${COMPOSER_COAT_CRISP_GLSL}`],
    // the per-fragment coat replaces the vertex colour (which stays the geometry's `color`, the export and fallback)
    ['#include <color_fragment>', 'diffuseColor.rgb *= composerCoatCrisp();'],
  ] as readonly (readonly [string, string])[],
});
const crispCacheKey = (pattern: string) => `${COMPOSER_GLOSS_CACHE_KEY}+${COMPOSER_COAT_CRISP_VERSION}/${pattern}`;
/** Applies COMPOSER_COAT_CRISP_PATCH for one crisp pattern; throws when an anchor is not present exactly once. */
export function patchComposerCoatCrispShader(shader: {vertexShader: string; fragmentShader: string; defines?: Record<string, unknown>}, crisp: Pick<ComposerCoatCrisp, 'code'>): void {
  if (shader.vertexShader.includes('coatSample') || shader.fragmentShader.includes('composerCoatCrisp')) throw new Error('composer coat crisp: shader already patched');
  const apply = (src: string, edits: readonly (readonly [string, string])[], stage: string) => edits.reduce((out, [anchor, replacement]) => {
    const n = out.split(anchor).length - 1;
    if (n !== 1) throw new Error(`composer coat crisp: ${stage} anchor ${anchor} occurs ${n} times`);
    return out.replace(anchor, replacement);
  }, src);
  shader.vertexShader = apply(shader.vertexShader, COMPOSER_COAT_CRISP_PATCH.vertex, 'vertex');
  shader.fragmentShader = `#define COAT_PATTERN ${crisp.code}\n` + apply(shader.fragmentShader, COMPOSER_COAT_CRISP_PATCH.fragment, 'fragment');
}
/** The coloured material with the crisp coat (skin-5): the gloss channel plus the per-fragment coat pattern of `crisp`
 * between the geometry's coatL0..coatL2 layers. One program per crisp pattern; the pattern parameters are uniforms. */
export function createComposerCrispCoatMaterial(crisp: ComposerCoatCrisp): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.82, metalness: 0});
  const uniforms = {
    coatSeed: {value: crisp.seed >>> 0}, coatCells: {value: crisp.cellsPerBody}, coatThreshold: {value: crisp.threshold},
    coatWarp: {value: crisp.warp}, coatBellyLine: {value: crisp.bellyLine},
  };
  material.onBeforeCompile = shader => {
    patchComposerGlossShader(shader);
    patchComposerCoatCrispShader(shader, crisp);
    Object.assign(shader.uniforms, uniforms);
  };
  material.customProgramCacheKey = () => crispCacheKey(crisp.pattern);
  material.userData.composerCoatCrisp = {version: crisp.version, pattern: crisp.pattern};
  return material;
}

/** Optional preview skin transformation keeps the core independent of LOD
 * reduction. The caller must preserve the source graph's joint indices. */
export function createComposerCreature(input: ComposerRecipe, options: ComposerSourceOptions & ComposerPoseOptions & {transformSkin?:(skin:ComposerSkin,graph:ComposerGraph)=>ComposerSkin} = {}): ComposerCreature {
  // Capture the chosen motion once; mutating the caller's options cannot change
  // an already built creature without updating its version metadata.
  const poseOptions: ComposerPoseOptions = {trunkMotion: options.trunkMotion ?? 'legacy'};
  const started = performance.now();
  const {recipe, individual: derived, graph, skin:sourceSkin} = buildComposerSource(input, options);
  const skin=options.transformSkin?options.transformSkin(sourceSkin,graph):sourceSkin;
  if (skin.vertexCount > COMPOSER_BUDGET.maxVertices || skin.triangleCount > COMPOSER_BUDGET.maxTriangles)
    throw new Error(`Composer skin exceeds the desktop preview budget (${skin.vertexCount} vertices, ${skin.triangleCount} triangles).`);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(skin.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(skin.colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skin.skinWeight, 4));
  geometry.setAttribute('composerGloss', new THREE.BufferAttribute(skin.gloss, 1));
  // skin-5: the crisp coat's per-vertex layers and pattern-space sample (the vertex colour stays the fallback)
  if (skin.coatCrisp && skin.coatLayers) {
    geometry.setAttribute('coatL0', new THREE.BufferAttribute(skin.coatLayers.c0, 3));
    geometry.setAttribute('coatL1', new THREE.BufferAttribute(skin.coatLayers.c1, 3));
    geometry.setAttribute('coatL2', new THREE.BufferAttribute(skin.coatLayers.c2, 3));
    geometry.setAttribute('coatSample', new THREE.BufferAttribute(skin.coatLayers.sample, 4));
  }
  geometry.setIndex(new THREE.BufferAttribute(skin.index, 1));
  // skin-5: the skin's shading normals (three's vertex normals with welded seams sharing one normal)
  geometry.setAttribute('normal', new THREE.BufferAttribute(skin.normals, 3));
  geometry.userData.composer = {graph: graph.version, skin: skin.version, coatCrisp: skin.coatCrisp?.version ?? null};
  if (graph.phenotype) Object.assign(geometry.userData.composer, {phenotype: graph.phenotype.version, identity: structuredClone(graph.phenotype.identity)});
  if (poseOptions.trunkMotion === 'wave-1' && graph.chains.trunk.length) geometry.userData.composer.trunkMotion = COMPOSER_TRUNK_MOTION_VERSION;
  const coloured = skin.coatCrisp && skin.coatLayers ? createComposerCrispCoatMaterial(skin.coatCrisp) : createComposerColouredMaterial();
  if (graph.phenotype) coloured.roughness = graph.phenotype.roughness;
  const neutralMaterial = new THREE.MeshStandardMaterial({color: '#a9aba6', roughness: 0.9, metalness: 0});
  const mesh = new THREE.SkinnedMesh(geometry, coloured);
  mesh.name = 'composer-skin'; mesh.castShadow = true; mesh.receiveShadow = true;
  // Skinned bounds are recomputed on demand; the posed animal is never culled by its bind box.
  mesh.frustumCulled = false;
  const bones = graph.bones.map(b => { const bone = new THREE.Bone(); bone.name = b.name; bone.position.fromArray(b.restPosition); bone.quaternion.fromArray(b.restQuaternion); return bone; });
  // Flat bone list: every bone carries its model-space pose; the explicit parent graph lives in `graph.bones`.
  for (const bone of bones) mesh.add(bone);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  const group = new THREE.Group(); group.name = 'composer-creature'; group.add(mesh);
  const restHeadBounds = composerHeadBounds(skin);

  const segments = composerSkeletonSegments(graph);
  const linePositions = new Float32Array((segments.length + graph.bones.length) * 6);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const lineMaterial = new THREE.LineBasicMaterial({color: '#ffd166', depthTest: false, transparent: true, opacity: 0.95});
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  lines.renderOrder = 10; lines.visible = false; lines.frustumCulled = false; lines.name = 'composer-skeleton';
  group.add(lines);

  let lastPose: ComposerPose | undefined, disposed = false;
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
  const writeLines = (pose: ComposerPose) => {
    let o = 0;
    const p = pose.positions;
    for (const [a, b] of segments) { linePositions.set([p[a * 3]!, p[a * 3 + 1]!, p[a * 3 + 2]!, p[b * 3]!, p[b * 3 + 1]!, p[b * 3 + 2]!], o); o += 6; }
    graph.bones.forEach((bone, i) => {
      tmpQ.fromArray(pose.quaternions, i * 4); tmpV.set(bone.length, 0, 0).applyQuaternion(tmpQ);
      linePositions.set([p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!, p[i * 3]! + tmpV.x, p[i * 3 + 1]! + tmpV.y, p[i * 3 + 2]! + tmpV.z], o); o += 6;
    });
    lineGeometry.attributes.position!.needsUpdate = true;
  };
  const cloneIndividual = (): ComposerCreatureIndividual => ({traits: structuredClone(derived.traits), deltas: [...derived.deltas], effectiveRecipe: {...derived.recipe}});
  const creature: ComposerCreature = {
    group, mesh, graph, skin,
    get individual() { return cloneIndividual(); },
    get lastPose() { return lastPose; },
    update(motion, time) {
      if (disposed) throw new Error('Composer creature was disposed');
      const pose = poseComposer(graph, motion, time, poseOptions);
      for (let i = 0; i < bones.length; i++) {
        const bone = bones[i]!;
        bone.position.fromArray(pose.positions, i * 3); bone.quaternion.fromArray(pose.quaternions, i * 4);
        const radial = pose.radialScale[i]!; bone.scale.set(1, radial, radial * pose.chordScale[i]!);
      }
      if (lines.visible) writeLines(pose);
      lastPose = pose;
      return pose;
    },
    setSkeletonVisible(value) { lines.visible = value; if (value && lastPose) writeLines(lastPose); },
    setNeutral(value) { mesh.material = value ? neutralMaterial : coloured; },
    bounds() {
      group.updateMatrixWorld(true);
      mesh.computeBoundingBox();
      return mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    },
    headBounds() { return restHeadBounds.clone(); },
    details() {
      const structure = composerStructure(graph);
      return {
        version: 'fauna-composer-creature-1', structure, constraints: graph.constraints.map(c => ({...c})),
        vertices: skin.vertexCount, triangles: skin.triangleCount, bones: graph.bones.length, drawCalls: lines.visible ? 2 : 1,
        parts: skin.parts.map(p => ({part: p.part, label: p.label, triangles: p.triangles, bones: p.bones.length})),
        budget: COMPOSER_BUDGET,
        withinBudget: skin.vertexCount <= COMPOSER_BUDGET.maxVertices && skin.triangleCount <= COMPOSER_BUDGET.maxTriangles && graph.bones.length <= COMPOSER_BUDGET.maxBones,
        buildMs,
        individual: cloneIndividual(),
      };
    },
    dispose() {
      if (disposed) return; disposed = true;
      group.removeFromParent();
      geometry.dispose(); coloured.dispose(); neutralMaterial.dispose(); lineGeometry.dispose(); lineMaterial.dispose();
      mesh.skeleton.dispose();
    },
  };
  const buildMs = performance.now() - started;
  creature.update('neutral', 0);
  return creature;
}
export {composerConstraints};

const HEAD_PARTS: ReadonlySet<string> = new Set(['head', 'eyes', 'mouth', 'horn', 'trunk']);
/** Rest-pose bounds of every vertex referenced by a triangle of the face parts. */
export function composerHeadBounds(skin: ComposerSkin): THREE.Box3 {
  const box = new THREE.Box3(), p = new THREE.Vector3(), pos = skin.positions;
  for (const part of skin.parts) {
    if (!HEAD_PARTS.has(part.part)) continue;
    for (let i = part.firstTriangle * 3, end = (part.firstTriangle + part.triangles) * 3; i < end; i++) {
      const v = skin.index[i]! * 3;
      box.expandByPoint(p.set(pos[v]!, pos[v + 1]!, pos[v + 2]!));
    }
  }
  return box;
}
