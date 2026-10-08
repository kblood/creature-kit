import * as THREE from 'three';
import {composerConstraints, normalizeComposerRecipe, type ComposerConstraint, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {buildComposerGraph, composerSkeletonSegments, composerStructure, poseComposer, COMPOSER_BUDGET, type ComposerGraph, type ComposerMotion, type ComposerPose} from './fauna-composer-rig.ts';
import {COMPOSER_COAT_CRISP_VERSION, buildComposerSkin, type ComposerCoatCrisp, type ComposerSkin} from './fauna-composer-mesh.ts';
import {COAT_PATTERN_SALTS, COAT_WORLEY_JITTER} from './fauna-coat-fields.ts';
import {deriveComposerIndividual, type ComposerIndividualTraits} from './fauna-composer-individual.ts';

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
const hex = (n: number) => `0x${(n >>> 0).toString(16)}u`;
const glslFloat = (x: number) => { const t = String(x); return /[.eE]/.test(t) ? t : `${t}.0`; };
/** GLSL ES 3.00 re-implementation of fauna-coat-1's patternMask for the crisp patterns (COMPOSER_COAT_CRISP_PATTERNS,
 * off the limbs), with the frozen lattice hash (pcg3 over uint, which wraps exactly like Math.imul), value noise,
 * fBm and Worley noise, and the same salts and constants (COAT_PATTERN_SALTS, COAT_WORLEY_JITTER). Floats are 32-bit
 * on the GPU, so the mask matches coatPatternProbe up to float rounding (cell boundaries may move by an ulp), not bit
 * for bit; the CPU twin of the crisp coat (tests/fauna-composer-coat-crisp.test.mjs) uses coatPatternProbe itself.
 * Selected by `#define COAT_PATTERN <code>` (COMPOSER_COAT_CRISP_PATTERNS index + 1). */
export const COMPOSER_COAT_CRISP_GLSL = `
// every integer the hash touches is highp (32-bit), whatever the program's default int precision
uniform highp uint coatSeed;
uniform float coatCells, coatThreshold, coatWarp, coatBellyLine;
varying vec3 vCoatL0;
varying vec3 vCoatL1;
varying vec3 vCoatL2;
varying vec4 vCoatSample;
const float COAT_INV32 = 1.0 / 4294967296.0;
const highp uint COAT_SALT_WARP = ${hex(COAT_PATTERN_SALTS.warp)}, COAT_SALT_DETAIL = ${hex(COAT_PATTERN_SALTS.detail)}, COAT_SALT_MARK = ${hex(COAT_PATTERN_SALTS.mark)}, COAT_SALT_BAND = ${hex(COAT_PATTERN_SALTS.band)};
const float COAT_JITTER = ${glslFloat(COAT_WORLEY_JITTER)};
highp uvec3 coatPcg3(highp ivec3 p, highp uint s) {
  highp uint a = uint(p.x) * 1664525u + 1013904223u + s;
  highp uint b = (uint(p.y) * 1664525u + 1013904223u) ^ ((s << 11u) | (s >> 21u));
  highp uint c = uint(p.z) * 1664525u + 1013904223u + s * 0x27d4eb2fu;
  a += b * c; b += c * a; c += a * b;
  a ^= a >> 16u; b ^= b >> 16u; c ^= c >> 16u;
  a += b * c; b += c * a; c += a * b;
  return uvec3(a, b, c);
}
float coatSmooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec3 coatFade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float coatVnoise(vec3 p, highp uint s) {
  vec3 fl = floor(p), u = coatFade(p - fl);
  highp ivec3 i = ivec3(fl);
  float c000 = float(coatPcg3(i, s).z), c100 = float(coatPcg3(i + ivec3(1, 0, 0), s).z);
  float c010 = float(coatPcg3(i + ivec3(0, 1, 0), s).z), c110 = float(coatPcg3(i + ivec3(1, 1, 0), s).z);
  float c001 = float(coatPcg3(i + ivec3(0, 0, 1), s).z), c101 = float(coatPcg3(i + ivec3(1, 0, 1), s).z);
  float c011 = float(coatPcg3(i + ivec3(0, 1, 1), s).z), c111 = float(coatPcg3(i + ivec3(1, 1, 1), s).z);
  float x00 = c000 + (c100 - c000) * u.x, x10 = c010 + (c110 - c010) * u.x;
  float x01 = c001 + (c101 - c001) * u.x, x11 = c011 + (c111 - c011) * u.x;
  float y0 = x00 + (x10 - x00) * u.y, y1 = x01 + (x11 - x01) * u.y;
  return (y0 + (y1 - y0) * u.z) * COAT_INV32;
}
vec3 coatVnoise3(vec3 p, highp uint s) {
  vec3 fl = floor(p), u = coatFade(p - fl), acc = vec3(0.0);
  highp ivec3 i = ivec3(fl);
  for (int k = 0; k < 8; k++) {
    highp ivec3 d = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    float w = (d.x == 1 ? u.x : 1.0 - u.x) * (d.y == 1 ? u.y : 1.0 - u.y) * (d.z == 1 ? u.z : 1.0 - u.z);
    acc += vec3(coatPcg3(i + d, s)) * w;
  }
  return acc * COAT_INV32;
}
float coatFbm2(vec3 p, highp uint s) { return (2.0 * coatVnoise(p, s) + coatVnoise(p * 2.03 + vec3(17.31, -9.17, 5.71), s ^ 0x5bd1e995u)) / 3.0; }
// F1, F2, nearest-cell hash and the vector from the nearest feature point
void coatWorley(vec3 p, highp uint s, out float f1, out float f2, out highp uint h, out vec3 v) {
  vec3 fl = floor(p);
  highp ivec3 i = ivec3(fl);
  float d1 = 1e9, d2 = 1e9, lo = (1.0 - COAT_JITTER) * 0.5;
  h = 0u; v = vec3(0.0);
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
    highp ivec3 cell = i + ivec3(a, b, c);
    highp uvec3 H = coatPcg3(cell, s);
    vec3 d = p - (vec3(cell) + lo + COAT_JITTER * vec3(H) * COAT_INV32);
    float q = dot(d, d);
    if (q < d1) { d2 = d1; d1 = q; h = ((H.x ^ (H.z >> 7u)) * 0x9e3779b1u) ^ H.y; v = d; }
    else if (q < d2) d2 = q;
  }
  f1 = sqrt(d1); f2 = sqrt(d2);
}
// raw pattern mask (x) and the reticulated patch shade (y), as patternMask / coatPatternProbe
vec2 coatPatternMask(vec3 sp, float dorsal, float fp) {
  highp uint seed = coatSeed;
  float t = coatThreshold, cpb = coatCells;
#if COAT_PATTERN == 5 || COAT_PATTERN == 6
  const bool stripes = COAT_PATTERN == 5;
  float u = (sp.x + (stripes ? 0.05 : 0.015) * (1.0 - dorsal)) * cpb;
  float wAmp = stripes ? 0.55 * coatWarp : 0.12 * coatWarp, qs = cpb * 0.6;
  u += wAmp * (coatFbm2(vec3(sp.x * qs, sp.y * qs * 1.6, sp.z * qs * 1.6), seed ^ COAT_SALT_WARP) - 0.5) * 2.0;
  float k = floor(u), f = u - k;
  highp uvec3 H = coatPcg3(ivec3(int(k), stripes ? 1 : 2, 0), seed ^ COAT_SALT_BAND);
  float width = 0.6 + 0.4 * (float(H.x) * COAT_INV32 + float(H.z & 0xffffu) / 65536.0);
  float duty = (stripes ? 0.43 : 0.42) + 0.3 * t, hw = 0.5 * duty * width, d = abs(f - 0.5);
  if (stripes) { float end = coatBellyLine + 0.1 + 0.45 * float(H.y) * COAT_INV32; hw *= coatSmooth(end - 0.04, end + 0.22, dorsal); }
  if (stripes && float(H.z) * COAT_INV32 < 0.3) { d = abs(d - 0.55 * hw); hw *= 0.42; }
  float edge = (coatVnoise(sp * cpb * 3.0, seed ^ COAT_SALT_DETAIL) - 0.5) * (stripes ? 0.08 : 0.05);
  float e = max(stripes ? 0.03 : 0.02, fp * cpb * 0.5);
  return vec2(hw <= 0.0 ? 0.0 : 1.0 - coatSmooth(hw - e, hw + e, d + edge), 0.0);
#elif COAT_PATTERN == 7
  float qs = cpb;
  float n1 = coatFbm2(vec3(sp.x * qs * 0.45, sp.y * qs * 0.6, sp.z * qs * 0.6), seed ^ COAT_SALT_WARP) - 0.5;
  float n2 = coatVnoise(sp * qs * 2.0, seed ^ COAT_SALT_DETAIL) - 0.5;
  float u = sp.x * qs + 0.4 * (1.0 - dorsal) + (1.3 + 1.2 * coatWarp) * n1 + 0.35 * n2;
  float f = u - floor(u);
  float thick = coatVnoise(vec3(sp.x * qs * 0.8 + 3.1, sp.y * qs * 0.8, sp.z * qs * 0.8), seed ^ COAT_SALT_MARK);
  float hw = (0.1 + 0.1 * thick) * (1.0 + 1.2 * t), e = max(0.035, fp * qs * 0.5);
  float breakup = coatSmooth(0.22, 0.4, coatVnoise(vec3(sp.x * qs * 1.3 - 7.7, sp.y * qs * 1.3, sp.z * qs * 1.3), seed ^ COAT_SALT_BAND));
  return vec2((1.0 - coatSmooth(hw - e, hw + e, abs(f - 0.5))) * breakup * 0.9, 0.0);
#else
  vec3 q = sp * cpb;
#if COAT_PATTERN == 3
  const float warpAmp = 0.32;
#elif COAT_PATTERN == 2
  const float warpAmp = 0.28;
#else
  const float warpAmp = 0.22;
#endif
  if (coatWarp > 0.0) q += coatWarp * warpAmp * 2.0 * (coatVnoise3(q * 0.45 + vec3(31.7, -12.9, 4.3), seed ^ COAT_SALT_WARP) - 0.5);
  float efp = fp * cpb * 0.5, f1, f2;
  highp uint hc; vec3 dv;
  coatWorley(q, seed, f1, f2, hc, dv);
#if COAT_PATTERN == 1
  float r0 = 0.35 + 0.06 * (2.0 * float(hc) * COAT_INV32 - 1.0) + 0.25 * t, soft = max(0.05, efp);
  return vec2(1.0 - coatSmooth(r0, r0 + soft, f1), 0.0);
#elif COAT_PATTERN == 2
  float rho = f1 / max(f2, 1e-6), inv = 1.0 / max(f1, 1e-6);
  vec3 g = dv * inv;
  float gap = coatVnoise(vec3(g.x * 1.6 + float(hc & 1023u) * 0.37, g.y * 1.6 + float((hc >> 10u) & 1023u) * 0.41, g.z * 1.6 + float((hc >> 20u) & 1023u) * 0.43), seed ^ COAT_SALT_DETAIL);
  float thick = coatVnoise(vec3(g.x * 2.3 + 9.1, g.y * 2.3 - 3.3, g.z * 2.3 + 1.7), seed ^ COAT_SALT_MARK);
  float e = max(0.035, efp * 0.6);
  float outer = 0.8 - 0.04 * (float(hc) * COAT_INV32) + 0.2 * t, inner = outer - 0.22 - 0.12 * (thick - 0.5) - 0.15 * t;
  float ring = coatSmooth(inner - e, inner + e, rho) * (1.0 - coatSmooth(outer - e, outer + e, rho)) * coatSmooth(0.3, 0.44, gap);
  float centre = 0.35 * (1.0 - coatSmooth(inner - e, inner + e, rho));
  return vec2(max(ring, centre), 0.0);
#elif COAT_PATTERN == 3
  float d = f2 - f1, h = float(hc) * COAT_INV32;
  float wob = (coatVnoise(q * 1.7, seed ^ COAT_SALT_DETAIL) - 0.5) * 0.04;
  float lo = 0.05 - 0.1 * t + wob, e = max(0.0, efp - 0.025);
  float shade = clamp(0.55 + 0.3 * h + 0.18 * coatSmooth(0.12, 0.6, d), 0.0, 1.0);
  return vec2(coatSmooth(lo - e, lo + 0.05 + e, d), shade);
#else
  float rho = f1 / max(f2, 1e-6), hi = 0.86 + 0.25 * t, e = max(0.0, efp * 0.5);
  return vec2(0.85 * (1.0 - coatSmooth(hi - 0.45 - e, hi + 0.04 + e, rho)), 0.0);
#endif
#endif
}
vec3 composerCoatCrisp() {
  vec3 sp = vCoatSample.xyz;
  // the fragment's footprint in body lengths (the larger screen-space step of the pattern-space point)
  float fp = max(length(dFdx(sp)), length(dFdy(sp)));
  vec2 mp = coatPatternMask(sp, clamp(vCoatSample.w, -1.0, 1.0), fp);
  return clamp(vCoatL0 + mp.x * (vCoatL1 - vCoatL0) + mp.x * mp.y * (vCoatL2 - vCoatL1), 0.0, 1.0);
}
`;
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

export function createComposerCreature(input: ComposerRecipe): ComposerCreature {
  const started = performance.now();
  const recipe = normalizeComposerRecipe(input).recipe;
  // The only caller of deriveComposerIndividual: the rig and skin receive the effective recipe.
  const derived = deriveComposerIndividual(recipe);
  const graph = buildComposerGraph(derived.recipe);
  const skin = buildComposerSkin(graph);
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
  const coloured = skin.coatCrisp && skin.coatLayers ? createComposerCrispCoatMaterial(skin.coatCrisp) : createComposerColouredMaterial();
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
      const pose = poseComposer(graph, motion, time);
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
