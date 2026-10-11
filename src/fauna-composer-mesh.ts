import * as THREE from 'three';
import {composerHash, composerRandom, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {COAT_REGIONS, type CoatRegion} from './fauna-coat-vocab.ts';
import {COAT_CELLS_PER_BODY, applyCoatDrift, coatIndividualDrift, coatSeedMix, defaultCoatGenome, evaluateCoat, evaluateCoatWithMask, hash3u, valueNoise3, type CoatGenome} from './fauna-coat-fields.ts';
import {evaluateFaunaStageCoat} from './fauna-coat-juvenile.ts';
import {composerIndividualTraits, type ComposerIndividualTraits} from './fauna-composer-individual.ts';
import {COMPOSER_IRIS_RGB, FACE_EYE_PROFILE, composerEyeProfileId, composerEyeRulesOf, composerHeadgearBuild, composerSkullOf, resolveComposerEyes, type ComposerSkull} from './fauna-composer-face.ts';
import {EYE_PATCH, EYE_ROLE, OCELLUS, type LiddedEyeType, buildCompoundEye, buildEyePatch, buildEyespot, buildEyespotBead, buildFacetedEye, buildOcellus, buildStalk, catalogueEyeSpec, type CatalogueEyeSpec, eyeBarAxis, eyeGaze, nearestExit, normalize3, outermostExit, raycastFirstHit, raycastLine, type EyePatch, type RayHit, type Vec3 as EyeVec3} from './fauna-composer-eye.ts';
import {isFaceRoundEyeKind} from './fauna-composer-eye-catalogue.ts';
import {PROBOSCIS_FACE, composerFaceTip} from './fauna-composer-face-geometry.ts';
import {composerFeatherFanSpan, composerWingChord, composerWingThickness, type ComposerBone, type ComposerGraph, type ComposerLimb, type ComposerSection, type Vec3} from './fauna-composer-rig.ts';

/** Procedural, experimental skin for a composer graph. Every visible part is
 * real geometry skinned to explicit bones: chain tubes follow centripetal
 * Catmull-Rom centrelines through the joints, limb roots blend out of the body
 * through weighted transition rings, the neck blends into the head through
 * weighted rings in the head frame, and rigid parts (beaks, horns, feet, hands,
 * shells, plates, feathers) carry full weight on their bone. Vertex colours come
 * from the shared fauna coat library (fauna-coat-1), sampled at each vertex's
 * true 3D position. Output is plain arrays so it can be inspected in tests. */
/** skin-4 (eye round EC2): the eye catalogue geometry (fauna-composer-eye-2) under the current eye rules, and the blunt
 * mouth disc shaded as a mouth; the earlier eye rules (eyeRules 1) still build skin-3 byte for byte. */
/** skin-5 (coat crisp v1, docs/fauna-coat-crisp-v1.md): crisp-coat layer colours per vertex for the per-fragment coat. */
export const COMPOSER_SKIN_VERSION = 'fauna-composer-skin-5';
/** Additive presentation revision. Recipe/individual/graph identities are unchanged. */
export const COMPOSER_REALISM_SKIN_VERSION = 'fauna-composer-skin-6';
export type ComposerSkinPresentation = 'skin-5' | 'realism-1';
/** The per-fragment ("crisp") coat: the shader that evaluates the pattern per fragment (fauna-composer.ts) and the
 * layer colours the skin carries for it. */
export const COMPOSER_COAT_CRISP_VERSION = 'fauna-composer-coat-crisp-1';
/** Patterns the crisp coat draws per fragment (index + 1 = the shader's pattern code). Stripes, bands and brindle are
 * crisp off the limbs only (their limb rings follow the limb axis, which the shader does not know). Others (plain,
 * saddle, dorsal-stripe, piebald, roan) keep the vertex colours. */
export const COMPOSER_COAT_CRISP_PATTERNS = Object.freeze(['spots', 'rosettes', 'reticulated', 'dapple', 'stripes', 'bands', 'brindle'] as const);
export type ComposerCoatCrispPattern = typeof COMPOSER_COAT_CRISP_PATTERNS[number];
/** What the crisp-coat shader needs besides the per-vertex layers: the frozen pattern's parameters at the REQUESTED
 * (unclamped) scale and the coat frame that maps a bind-space position to the pattern-space sample. */
export interface ComposerCoatCrisp {
  version: typeof COMPOSER_COAT_CRISP_VERSION;
  pattern: ComposerCoatCrispPattern;
  /** 1-based pattern code of the shader (COMPOSER_COAT_CRISP_PATTERNS index + 1). */
  code: number;
  /** The coat genome at the REQUESTED scale (coatScale.requested, never the clamped one): the CPU twin of the shader
   * evaluates coatPatternProbe with it. */
  genome: CoatGenome;
  /** seedMix(genome.seed) as an unsigned 32-bit integer. */
  seed: number;
  /** COAT_CELLS_PER_BODY[pattern] x the requested scale. */
  cellsPerBody: number;
  threshold: number; warp: number; bellyLine: number;
  /** sample.x = ((p.x, p.y) - origin) . forward / scale, sample.y = ((p.y - origin.y) forward.x - (p.x - origin.x) forward.y) / scale, sample.z = p.z / scale. */
  frame: {origin: [number, number]; forward: [number, number]; scale: number; phase?: number; lateral?: number};
}
/** Per-vertex crisp-coat layers (linear RGB, 3 per vertex): c0 = the coat at pattern mask 0, c1 = at mask 1 (patch
 * shade 0), c2 = at mask 1 (patch shade 1). The shaded colour is c0 + m (c1 - c0) + m p (c2 - c1) for the fragment's
 * mask m and patch shade p (the coat is affine in both). A vertex that did not sample the coat itself carries its
 * vertex colour in all three, so the mask cannot change it. `sample` (4 per vertex) is the pattern-space point
 * (x, y, z in body lengths, the coat frame) and the coat dorsal value the vertex was coloured with; vertices without
 * their own sample get their position in the coat frame and dorsal 0. */
export interface ComposerCoatLayers {c0: Float32Array; c1: Float32Array; c2: Float32Array; sample: Float32Array}
export type ComposerSkinPart = 'torso' | 'neck' | 'tail' | 'head' | 'eyes' | 'mouth' | 'horn' | 'trunk' | 'leg' | 'foot' | 'arm' | 'hand' | 'wing' | 'armor' | 'tail-tip';

/** Radial segments and rings per bone of the lofted tubes (feet and toes keep their own tessellation). */
export const COMPOSER_SKIN_TESSELLATION = Object.freeze({
  torsoRadial: 28, torsoRadialBanded: 22, torsoRings: 7, torsoRingsAnnulated: 9, neckRings: 6, tailRings: 6,
  legRadial: 16, legRadialArthropod: 9, legRings: 6, legRingsArthropod: 3, armRadial: 14, armRings: 4,
  /** lidded eyes (fauna-composer-eye-1): EYE_PATCH.segments around, centre + 7 rings + the closing cone */
  eyeRadial: 20, eyeStations: 7, rootRings: 4,
});
/** Region code for vertices that carry no coat region. */
export const COMPOSER_SKIN_NO_REGION = 255;

/** One lofted ring of a chain tube (bind space), reported when `debug` is requested. */
export interface ComposerSkinRing {
  /** 'axial' (tail tip -> torso -> neck -> head blend), 'leg <n><L|R>', 'arm <L|R>' or 'trunk'. */
  chain: string;
  /** 'bone': regular ring; 'joint': the extra rings at +-12% around an interior joint; 'blend': neck-to-head;
   * 'root': limb-root transition ring (the last one is the first limb ring). */
  kind: 'bone' | 'joint' | 'blend' | 'root';
  bone: number; part: string; f: number;
  centre: Vec3; tangent: Vec3; rx: number; ry: number; ryBelow: number;
  weights: [number, number][];
  region: CoatRegion;
}
export interface ComposerSkinDebug {
  rings: ComposerSkinRing[];
  /** Interior joints whose spline overshot and fell back to the polyline. */
  splineFallbacks: number;
  coat: {
    pattern: string; requestedScale: number; effectiveScale: number; cellsPerBody: number;
    /** Mean pattern cell diameter in metres (Infinity for patterns without cells). */
    meanCellDiameter: number;
    /** Torso median edge estimated from the torso rings before colouring (metres). */
    torsoEdgeEstimate: number;
  };
  traitsNeutral: boolean;
  /** Crisp coat (skin-5): own = 1 where the layers were sampled at the vertex itself; sample = the exact (double)
   * coat sample of those vertices, 6 per vertex (x, y, z, dorsal, along, footprint), NaN elsewhere. Null without the
   * crisp coat. */
  coatVertex: {own: Uint8Array; sample: Float64Array} | null;
  /** skin-5: 1 per triangle of a cap or disc that closes a part inside another part (left out of welded seam normals). */
  hiddenTriangles: Uint8Array;
  /** skin-5: the neck-to-head blend rings still crossed after fanOutBends and were turned monotonically instead. */
  blendUnfolded: boolean;
  /** The eyes as built (fauna-composer-eye-1): one entry per eye, head-local geometry and the skin vertex range. */
  eyes: ComposerSkinEyeDebug[];
  /** The palette's eye colour and the built iris colour (null: compound eyes or eyespots), for colour audits. */
  eyeColours: {eye: [number, number, number]; iris: [number, number, number] | null; lidFactor: number; compound: [number, number, number] | null};
}
export interface ComposerSkinEyeDebug {
  side: number; type: string;
  /** eye radius (lidded) or the dome / disc radius, metres */
  er: number;
  /** head-local eye centre (lidded: recessed below the skull surface) and unit gaze */
  centre: [number, number, number]; gaze: [number, number, number];
  /** head-local skull-surface point the eye was seated on (null: fallback) */
  surface: [number, number, number] | null;
  /** first skin vertex of the eye and the first vertex of each ring (absolute skin vertex ids) */
  firstVertex: number; vertexCount: number; rings: number[]; triangles: number;
  rimFallbacks: number;
}
export interface ComposerSkin {
  version: typeof COMPOSER_SKIN_VERSION | typeof COMPOSER_REALISM_SKIN_VERSION;
  positions: Float32Array; colors: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array; index: Uint32Array;
  /** skin-5: the shading normals (three's area-weighted vertex normals, except that every welded seam group - vertices
   * with bitwise-equal positions and equal skin indices and weights, outside the eyes - shares one normal built from
   * its visible faces). createComposerCreature and the export ship these. */
  normals: Float32Array;
  /** Per-vertex gloss in [0, 1] (0 everywhere but the eyes): the material lowers roughness toward 0.06 with it. */
  gloss: Float32Array;
  /** Eyes that found no skull surface along their gaze and kept the old fixed offset (expected 0). */
  eyeFallbacks: number;
  /** Coat region per vertex: an index into COAT_REGIONS, or COMPOSER_SKIN_NO_REGION. */
  regions: Uint8Array;
  /** Triangle ranges per anatomical part (start/count in triangles). */
  parts: {part: ComposerSkinPart; label: string; firstTriangle: number; triangles: number; bones: number[]}[];
  vertexCount: number; triangleCount: number;
  /** Pattern scale asked for vs drawn: the pattern clamp keeps a mean pattern cell at least four torso
   * edges across, so above `effective` a finer scale looks the same on this body (the Lab says so). */
  coatScale: {pattern: string; requested: number; effective: number};
  /** skin-5: the crisp coat (null: the pattern is not drawn per fragment) and its per-vertex layers. */
  coatCrisp: ComposerCoatCrisp | null;
  coatLayers: ComposerCoatLayers | null;
  debug?: ComposerSkinDebug;
}
export interface ComposerSkinOptions {
  /** Explicit surface revision; omitted retains the frozen skin-5 presentation. */
  presentation?: ComposerSkinPresentation;
  /** Individual traits to build with (default composerIndividualTraits(graph.recipe)). */
  traits?: ComposerIndividualTraits;
  /** Report ring centrelines, spline fallbacks and coat scale in `debug`. */
  debug?: boolean;
}
type RGB = [number, number, number];
type W = [number, number][];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (lo: number, hi: number, v: number) => { const t = clamp((v - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x: number, m: number, sigma: number) => Math.exp(-0.5 * ((x - m) / sigma) ** 2);
const mixC = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const scaleC = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** CIE L* (0..100) of a relative luminance, and back. */
const lstarOf = (y: number) => y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : y * 24389 / 27;
const lumOfLstar = (l: number) => l > 8 ? ((l + 16) / 116) ** 3 : l * 27 / 24389;
/** Male coat colour at dichromatism weight w (0 = unchanged, bitwise). Birds take the palette accent (breeding
 * plumage). Other coats get a darker back: the luminance factor lowers the palette base by DICHRO.lstar perceptual
 * lightness units at w = 1 whatever the base lightness (a savanna coat turns a deeper tan); a dark coat that cannot
 * drop that far (floor: DICHRO.floor of its L*) takes a wash of the palette accent for the shortfall (a dark animal
 * with a coloured male flush). A pure luminance scale and a mix toward an in-gamut colour, so the result stays in
 * gamut; every factor depends on the palette, never on `c`, so the map is affine in `c` and the crisp coat layers
 * stay exact. */
const dichromatic = (c: RGB, w: number, plumage: boolean, accent: RGB, base: RGB): RGB => {
  if (!(w > 0)) return c;
  if (plumage) return mixC(c, accent, DICHRO.plumageMix * w);
  const yb = Math.max(1e-6, 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]), lb = lstarOf(yb);
  const floor = DICHRO.floor * lb, short = Math.max(0, 1 - (lb - floor) / DICHRO.lstar);
  const out = scaleC(c, lumOfLstar(Math.max(floor, lb - DICHRO.lstar * w)) / yb);
  return short > 0 ? mixC(out, accent, DICHRO.shortAccent * short * w) : out;
};
const DICHRO = {plumageMix: 0.55, lstar: 16, floor: 0.4, shortAccent: 0.3};
const TAU = Math.PI * 2;
const REGION = Object.fromEntries(COAT_REGIONS.map((name, i) => [name, i])) as Record<CoatRegion, number>;
const vec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

/** 1 for every vertex used by an eyes part (eye shells meet at deliberate creases and are never welded). */
function eyeVertices(parts: ComposerSkin['parts'], index: Uint32Array, nv: number): Uint8Array {
  const out = new Uint8Array(nv);
  for (const p of parts) if (p.part === 'eyes') for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) out[index[i]!] = 1;
  return out;
}
/**
 * skin-5 shading normals (docs/fauna-coat-crisp-v1.md, metric c). three's computeVertexNormals (area-weighted face
 * normals) everywhere, except welded seam groups: vertices with bitwise-equal Float32 positions and equal skin indices
 * and weights, outside the eyes. Each part used to get its own normals there, so the coincident seam vertices shaded
 * differently (the dotted light line at the neck-to-head and trunk seams, EC4). A group's members now share one
 * normal: the sum of the members' unit VISIBLE normals (each member's area-weighted visible faces; faces of hidden
 * caps and discs, which close a part inside another, are left out), so each side of the seam counts once. A group
 * with no visible face uses all its faces, and a degenerate sum keeps its lowest member's own normal - always one
 * bitwise value per group.
 */
export function composerSeamNormals(positions: Float32Array, index: Uint32Array, skinIndex: Uint16Array, skinWeight: Float32Array, hidden: Uint8Array, excluded: Uint8Array): Float32Array {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  const normals = (geometry.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
  geometry.dispose();
  const nv = positions.length / 3, pb = new Uint32Array(positions.buffer, positions.byteOffset, nv * 3), wb = new Uint32Array(skinWeight.buffer, skinWeight.byteOffset, nv * 4);
  const groups = new Map<string, number[]>();
  for (let v = 0; v < nv; v++) {
    if (excluded[v]) continue;
    const key = `${pb[3 * v]},${pb[3 * v + 1]},${pb[3 * v + 2]},${skinIndex[4 * v]},${skinIndex[4 * v + 1]},${skinIndex[4 * v + 2]},${skinIndex[4 * v + 3]},${wb[4 * v]},${wb[4 * v + 1]},${wb[4 * v + 2]},${wb[4 * v + 3]}`;
    const g = groups.get(key); if (g) g.push(v); else groups.set(key, [v]);
  }
  const welded = new Int32Array(nv).fill(-1), list: number[][] = [];
  for (const g of groups.values()) if (g.length > 1) { for (const v of g) welded[v] = list.length; list.push(g); }
  if (!list.length) return normals;
  // per member: the area-weighted sum of its own visible faces (and of all its faces, the fallback)
  const vis = new Float64Array(nv * 3), all = new Float64Array(nv * 3);
  for (let t = 0; t < index.length / 3; t++) {
    const a = index[3 * t]!, b = index[3 * t + 1]!, c = index[3 * t + 2]!;
    if (welded[a]! < 0 && welded[b]! < 0 && welded[c]! < 0) continue;
    // three's face normal: (C - B) x (A - B), from the Float32 positions
    const ux = positions[3 * c]! - positions[3 * b]!, uy = positions[3 * c + 1]! - positions[3 * b + 1]!, uz = positions[3 * c + 2]! - positions[3 * b + 2]!;
    const vx = positions[3 * a]! - positions[3 * b]!, vy = positions[3 * a + 1]! - positions[3 * b + 1]!, vz = positions[3 * a + 2]! - positions[3 * b + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      if (welded[v]! < 0) continue;
      all[3 * v] += nx; all[3 * v + 1] += ny; all[3 * v + 2] += nz;
      if (!hidden[t]) { vis[3 * v] += nx; vis[3 * v + 1] += ny; vis[3 * v + 2] += nz; }
    }
  }
  // the group normal: every member side with visible faces counts once (the sum of the members' unit visible
  // normals, so a big-faced side does not pull the normal off the other side; two sides give their bisector)
  const unitSum = (src: Float64Array, members: number[]) => {
    let x = 0, y = 0, z = 0;
    for (const v of members) { const l = Math.hypot(src[3 * v]!, src[3 * v + 1]!, src[3 * v + 2]!); if (l > 1e-30) { x += src[3 * v]! / l; y += src[3 * v + 1]! / l; z += src[3 * v + 2]! / l; } }
    return [x, y, z, Math.hypot(x, y, z)] as const;
  };
  for (const members of list) {
    let [x, y, z, l] = unitSum(vis, members);
    if (!(l > 1e-12)) [x, y, z, l] = unitSum(all, members);
    if (!(l > 1e-12)) { const m = members[0]!; x = normals[3 * m]!; y = normals[3 * m + 1]!; z = normals[3 * m + 2]!; l = 1; }
    const nx = Math.fround(x / l), ny = Math.fround(y / l), nz = Math.fround(z / l);
    for (const v of members) { normals[3 * v] = nx; normals[3 * v + 1] = ny; normals[3 * v + 2] = nz; }
  }
  return normals;
}

class Skin {
  // growable typed buffers; positions stay double precision until the final Float32 copy
  p = new Float64Array(3 * 4096); c = new Float32Array(3 * 4096); si = new Uint16Array(4 * 4096); sw = new Float32Array(4 * 4096); rg = new Uint8Array(4096); gl = new Float32Array(4096); ix = new Uint32Array(3 * 8192);
  /** skin-5: 1 per triangle emitted while `hide` is set (a cap or disc that closes a part inside another part); such
   * faces never shade a welded seam (composerSeamNormals). */
  hid = new Uint8Array(8192); hide = false;
  /** Crisp-coat layers (skin-5, docs/fauna-coat-crisp-v1.md), written only while `coat` is set: l0 = colour at mask 0,
   * l1 = at mask 1 (patch 0), l2 = at mask 1 (patch 1); `own` = 1 where they were sampled at the vertex itself (0:
   * copied from a ring, or the vertex colour); cq = that sample (x, y, z, dorsal, along, footprint; NaN when not own). */
  l0 = new Float32Array(3 * 4096); l1 = new Float32Array(3 * 4096); l2 = new Float32Array(3 * 4096); own = new Uint8Array(4096); cq = new Float64Array(6 * 4096);
  coat: CoatLayerHook | undefined;
  /** The raw colour of the last vertex emitted by `vc`. */
  lastColour: RGB = [0, 0, 0];
  /** Vertex and index counts. */
  nv = 0; ni = 0;
  /** Coat region written for vertices that do not name their own. */
  region = COMPOSER_SKIN_NO_REGION;
  parts: ComposerSkin['parts'] = [];
  private current: ComposerSkin['parts'][number] | undefined;
  begin(part: ComposerSkinPart, label: string) { this.end(); this.lastW = undefined; this.current = {part, label, firstTriangle: this.ni / 3, triangles: 0, bones: []}; }
  end() { if (this.current) { this.current.triangles = this.ni / 3 - this.current.firstTriangle; if (this.current.triangles > 0) this.parts.push(this.current); this.current = undefined; } }
  /** Normalised top-4 influences, prepared once per weight list (rings share one list for all their vertices). */
  private prepared = new WeakMap<W, number[]>();
  private lastW: W | undefined;
  private lastPrep: number[] = [];
  private grow() {
    const cap = this.rg.length * 2, g = <A extends Float64Array | Float32Array | Uint16Array | Uint8Array>(src: A, n: number): A => { const out = new (src.constructor as new (n: number) => A)(n); out.set(src); return out; };
    this.p = g(this.p, cap * 3); this.c = g(this.c, cap * 3); this.si = g(this.si, cap * 4); this.sw = g(this.sw, cap * 4); this.rg = g(this.rg, cap); this.gl = g(this.gl, cap);
    if (this.coat) { this.l0 = g(this.l0, cap * 3); this.l1 = g(this.l1, cap * 3); this.l2 = g(this.l2, cap * 3); this.own = g(this.own, cap); this.cq = g(this.cq, cap * 6); }
  }
  v(pos: THREE.Vector3, col: RGB, w: W, region = this.region): number {
    let prep = w === this.lastW ? this.lastPrep : this.prepared.get(w);
    if (!prep) {
      const list = w.filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = list.reduce((a, [, x]) => a + x, 0) || 1;
      prep = [];
      for (let k = 0; k < 4; k++) prep.push(list[k]?.[0] ?? 0, list[k] ? list[k]![1] / total : 0, list[k] ? 1 : 0);
      this.prepared.set(w, prep);
    }
    if (w !== this.lastW) {
      this.lastW = w; this.lastPrep = prep;
      if (this.current) for (let k = 0; k < 4; k++) if (prep[k * 3 + 2] && !this.current.bones.includes(prep[k * 3]!)) this.current.bones.push(prep[k * 3]!);
    }
    if (this.nv >= this.rg.length) this.grow();
    const i = this.nv++;
    for (let k = 0; k < 4; k++) { this.si[i * 4 + k] = prep[k * 3]!; this.sw[i * 4 + k] = prep[k * 3 + 1]!; }
    this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
    this.c[i * 3] = clamp(col[0], 0, 1); this.c[i * 3 + 1] = clamp(col[1], 0, 1); this.c[i * 3 + 2] = clamp(col[2], 0, 1);
    this.rg[i] = region;
    this.gl[i] = 0;
    if (this.coat) {
      // every vertex carries layers; a vertex without its own coat sample shades exactly with its vertex colour
      for (let k = 0; k < 3; k++) { const c = this.c[i * 3 + k]!; this.l0[i * 3 + k] = c; this.l1[i * 3 + k] = c; this.l2[i * 3 + k] = c; }
      this.own[i] = 0; this.cq.fill(NaN, i * 6, i * 6 + 6);
    }
    return i;
  }
  /** A vertex whose colour comes from `colour` (a ring's colour field): with the crisp coat on, a colour that sampled
   * the coat exactly once, at this very vertex, for a crisp pattern and region, is evaluated again with the pattern
   * mask forced to 0 and to 1 (patch 0 and 1) to give the vertex's exact layer colours. The vertex colour itself is the
   * first, ordinary evaluation (unchanged). */
  vc(pos: THREE.Vector3, colour: () => RGB, w: W, region = this.region): number {
    const h = this.coat;
    if (!h) { const col = colour(); this.lastColour = col; return this.v(pos, col, w, region); }
    h.mode = 0; h.calls = 0; h.ok = false;
    const col = colour();
    this.lastColour = col;
    const i = this.v(pos, col, w, region);
    if (h.calls === 1 && h.ok && h.sampledAt(pos)) {
      const q = h.sample;
      this.cq[i * 6] = q.x; this.cq[i * 6 + 1] = q.y; this.cq[i * 6 + 2] = q.z; this.cq[i * 6 + 3] = q.dorsal; this.cq[i * 6 + 4] = q.along; this.cq[i * 6 + 5] = q.footprint;
      h.mode = 1; const a = colour(); h.mode = 2; const b = colour(); h.mode = 3; const c = colour(); h.mode = 0;
      // unclamped: the shader clamps the blended colour, so the blend stays exact where a layer overshoots 0..1
      for (let k = 0; k < 3; k++) { this.l0[i * 3 + k] = a[k]!; this.l1[i * 3 + k] = b[k]!; this.l2[i * 3 + k] = c[k]!; }
      this.own[i] = 1;
    }
    return i;
  }
  /** Copies the layers of vertex `from` to vertex `to` (cap rings that reuse their boundary ring's colours). */
  copyLayers(from: number, to: number) {
    if (!this.coat) return;
    for (let k = 0; k < 3; k++) { this.l0[to * 3 + k] = this.l0[from * 3 + k]!; this.l1[to * 3 + k] = this.l1[from * 3 + k]!; this.l2[to * 3 + k] = this.l2[from * 3 + k]!; }
  }
  /** Emits a pre-built patch (model-space xyz per vertex, a colour and gloss per vertex, triangle indices local to the
   * patch) with one weight list; returns the first vertex. */
  patch(positions: ArrayLike<number>, colors: RGB[], gloss: ArrayLike<number>, index: ArrayLike<number>, w: W, region = this.region): number {
    const first = this.nv, p = V();
    for (let k = 0; k < colors.length; k++) { const i = this.v(p.set(positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!), colors[k]!, w, region); this.gl[i] = clamp(gloss[k]!, 0, 1); }
    for (let k = 0; k + 2 < index.length; k += 3) this.t(first + index[k]!, first + index[k + 1]!, first + index[k + 2]!);
    return first;
  }
  t(a: number, b: number, c: number) {
    if (this.ni + 3 > this.ix.length) { const out = new Uint32Array(this.ix.length * 2); out.set(this.ix); this.ix = out; const h = new Uint8Array(this.ix.length / 3); h.set(this.hid); this.hid = h; }
    this.hid[this.ni / 3] = this.hide ? 1 : 0;
    this.ix[this.ni++] = a; this.ix[this.ni++] = b; this.ix[this.ni++] = c;
  }
  pos(i: number) { return V(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]); }
  /** Triangle with winding chosen so its normal faces `out`. */
  to(a: number, b: number, c: number, out: THREE.Vector3) {
    const pa = this.pos(a), n = V().crossVectors(this.pos(b).sub(pa), this.pos(c).sub(pa));
    if (n.dot(out) >= 0) this.t(a, b, c); else this.t(a, c, b);
  }
}

interface Ring {
  c: THREE.Vector3; t: THREE.Vector3; u: THREE.Vector3; rx: number; ry: number; w: W;
  /** Colour at ring angle `a` for the final vertex position `p`. */
  color: (a: number, p: THREE.Vector3) => RGB;
  /** lower half radius (default ry) */ ryBelow?: number;
  /** Superellipse exponent (2 = ellipse). */ n?: number;
  /** Additive [lateral, dorsal] radius at angle a (dorsal only applies to the upper half). */
  lobe?: (a: number) => [number, number];
  /** In-plane flattening: direction (perpendicular to t) and fraction removed along it. */
  squash?: [THREE.Vector3, number];
  region?: number;
}
/** Lofts closed rings; caps are rounded. Winding is outward when the
 * ring basis (v = u x t, u, t) is right-handed, which this function enforces. */
type RingBasis = {t: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3};
const ringBasis = (r: Ring): RingBasis => { const t = r.t.clone().normalize(); let u = r.u.clone().addScaledVector(t, -r.u.dot(t)); if (u.lengthSq() < 1e-10) u = Math.abs(t.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), u.addScaledVector(t, -u.dot(t)); u.normalize(); return {t, u, v: V().crossVectors(u, t)}; };
/** Position of a ring's vertex at angle `a` (superellipse section, lobes, squash), exactly as `loft` emits it. */
function ringPoint(r: Ring, b: RingBasis, a: number, out: THREE.Vector3, scale = 1, shift = 0) {
  const {t, u, v} = b, e = 2 / (r.n ?? 2), ca = Math.cos(a), sa = Math.sin(a);
  const cx = e === 1 ? ca : Math.sign(ca) * Math.pow(Math.abs(ca), e), sy = e === 1 ? sa : Math.sign(sa) * Math.pow(Math.abs(sa), e);
  let rx = r.rx, ry = sa < 0 ? r.ryBelow ?? r.ry : r.ry;
  if (r.lobe) { const [dl, dd] = r.lobe(a); rx = Math.max(1e-4, rx + dl); if (sa > 0) ry = Math.max(1e-4, ry + dd); }
  const kx = cx * rx * scale, ky = sy * ry * scale;
  out.set(r.c.x + t.x * shift + v.x * kx + u.x * ky, r.c.y + t.y * shift + v.y * kx + u.y * ky, r.c.z + t.z * shift + v.z * kx + u.z * ky);
  if (r.squash) { const [n, f] = r.squash, dn = -f * ((out.x - r.c.x) * n.x + (out.y - r.c.y) * n.y + (out.z - r.c.z) * n.z); out.x += n.x * dn; out.y += n.y * dn; out.z += n.z * dn; }
  return out;
}
/** Do consecutive ring planes cross within the rings' own radius (inside of a bend)? Margin 0.9 of the spacing. */
function ringsCross(a: Ring, b: Ring): boolean {
  const ds = a.c.distanceTo(b.c), ang = a.t.angleTo(b.t), r = Math.max(a.rx, a.ry, a.ryBelow ?? a.ry, b.rx, b.ry, b.ryBelow ?? b.ry);
  return ang * r > 0.9 * ds;
}
/** Smooths ring orientations (tangents only) with a Gaussian over arc length, sigma = k x the local radius, raising k
 * until no consecutive pair crosses (one-sided windows at the chain ends; with `fixLast` the last frame is kept). */
function fanOutBends(rings: Ring[], fixLast = false): void {
  if (rings.length < 4 || !rings.slice(0, -1).some((r, i) => ringsCross(r, rings[i + 1]!))) return;
  const t0 = rings.map(r => r.t.clone().normalize()), arc = [0];
  for (let i = 1; i < rings.length; i++) arc.push(arc[i - 1]! + rings[i - 1]!.c.distanceTo(rings[i]!.c));
  const rad = rings.map(r => Math.max(r.rx, r.ry, r.ryBelow ?? r.ry)), acc = new THREE.Vector3();
  for (const k of [0.5, 0.8, 1.2, 1.8, 2.5, 3.5]) {
    for (let i = 0; i < rings.length; i++) {
      const sigma = Math.max(1e-6, k * rad[i]!);
      acc.set(0, 0, 0);
      for (let j = 0; j < rings.length; j++) { const d = (arc[j]! - arc[i]!) / sigma; if (Math.abs(d) < 3) acc.addScaledVector(t0[j]!, Math.exp(-0.5 * d * d)); }
      // a fixed last frame: the smoothing tapers out over two sigmas before it
      const keep = fixLast ? Math.min(1, (arc[arc.length - 1]! - arc[i]!) / (2 * sigma)) : 1;
      rings[i]!.t.copy(t0[i]!).lerp(acc.normalize(), keep).normalize();
    }
    if (!rings.slice(0, -1).some((r, i) => ringsCross(r, rings[i + 1]!))) return;
  }
}
/** Every triangle edge length a loft of `rings` would emit between consecutive rings (caps excluded). */
function loftEdgeLengths(rings: Ring[], segments: number, include: (i: number) => boolean): Float64Array {
  const pairs: number[] = [];
  for (let i = 0; i + 1 < rings.length; i++) if (include(i)) pairs.push(i);
  const pts = new Map<number, THREE.Vector3[]>(), ringPts = (i: number) => {
    let p = pts.get(i);
    if (!p) { const r = rings[i]!, b = ringBasis(r); p = Array.from({length: segments}, (_, k) => ringPoint(r, b, TAU * k / segments, V())); pts.set(i, p); }
    return p;
  };
  const out = new Float64Array(pairs.length * segments * 6);
  let o = 0;
  for (const i of pairs) {
    const A = ringPts(i), B = ringPts(i + 1);
    for (let k = 0; k < segments; k++) {
      const a = A[k]!, b = A[(k + 1) % segments]!, c = B[k]!, d = B[(k + 1) % segments]!;
      out[o++] = a.distanceTo(b); out[o++] = b.distanceTo(c); out[o++] = c.distanceTo(a); out[o++] = b.distanceTo(d); out[o++] = d.distanceTo(c); out[o++] = c.distanceTo(b);
    }
  }
  return out;
}
/** `hidden`: 1 = the start cap, 2 = the end cap, 3 = both close the loft inside another part (their faces are marked
 * hidden, so they do not shade the welded seam ring). */
function loft(s: Skin, rings: Ring[], segments: number, capStart = 0.6, capEnd = 0.6, hidden = 0) {
  if (rings.length < 2) return;
  const ids: number[][] = [];
  const basis = ringBasis;
  const p = V();
  /** Emits one ring; with `colours` the vertices reuse those colours (cap rings copy their boundary ring, whose
   * colour they match to within the cap's tiny extent), otherwise each vertex samples the ring's colour field. */
  const ringIds = (r: Ring, scale = 1, shift = 0, colours?: RGB[], record?: RGB[], from?: number[]) => {
    const b = basis(r), out: number[] = [];
    for (let k = 0; k < segments; k++) {
      const a = TAU * k / segments;
      ringPoint(r, b, a, p, scale, shift);
      if (colours) { const i = s.v(p, colours[k]!, r.w, r.region); if (from) s.copyLayers(from[k]!, i); out.push(i); continue; }
      out.push(s.vc(p, () => r.color(a, p), r.w, r.region));
      record?.push(s.lastColour);
    }
    return out;
  };
  const capRings = (r: Ring, dir: number, len: number, colours: RGB[], from: number[]) => {
    const list: number[][] = [], steps = 3, radius = Math.max(r.rx, r.ry) * len;
    for (let k = 1; k <= steps; k++) { const phi = (k / (steps + 1)) * Math.PI / 2; list.push(ringIds(r, Math.cos(phi), dir * Math.sin(phi) * radius, colours, undefined, from)); }
    const {t} = basis(r), apexPos = r.c.clone().addScaledVector(t, dir * radius);
    const apex = s.v(apexPos, colours[Math.floor(segments * 3 / 4)]!, r.w, r.region);
    s.copyLayers(from[Math.floor(segments * 3 / 4)]!, apex);
    return {list, apex};
  };
  const firstColours: RGB[] = [], lastColours: RGB[] = [];
  const startCap: number[][] = [];
  let startApex = -1;
  const main: number[][] = rings.map((r, i) => ringIds(r, 1, 0, undefined, i === 0 ? firstColours : i === rings.length - 1 ? lastColours : undefined));
  if (capStart > 0) { const cap = capRings(rings[0]!, -1, capStart, firstColours, main[0]!); startCap.push(...cap.list.reverse()); startApex = cap.apex; }
  ids.push(...startCap, ...main);
  const hide0 = s.hide;
  if (startApex >= 0) { s.hide = hide0 || (hidden & 1) !== 0; fan(s, startApex, ids[0]!, true); s.hide = hide0; }
  if (capEnd > 0) { const cap = capRings(rings[rings.length - 1]!, 1, capEnd, lastColours, main[main.length - 1]!); ids.push(...cap.list); s.hide = hide0 || (hidden & 2) !== 0; fan(s, cap.apex, ids[ids.length - 1]!, false); s.hide = hide0; }
  const endFrom = startCap.length + main.length - 1;
  for (let i = 0; i + 1 < ids.length; i++) {
    s.hide = hide0 || (i < startCap.length && (hidden & 1) !== 0) || (i >= endFrom && (hidden & 2) !== 0);
    for (let k = 0; k < segments; k++) {
      const a = ids[i]![k]!, b = ids[i]![(k + 1) % segments]!, c = ids[i + 1]![k]!, d = ids[i + 1]![(k + 1) % segments]!;
      s.t(a, b, c); s.t(b, d, c);
    }
  }
  s.hide = hide0;
}
/** A band between two rings with different vertex counts (bind space; both rings emitted with their own colours and
 * weights), triangulated by walking both rings in angle order. Faces outward from the rings' centres. */
function zipRings(s: Skin, a: Ring, na: number, b: Ring, nb: number) {
  const emit = (r: Ring, n: number) => { const bs = ringBasis(r), p = V(), ids: number[] = []; for (let k = 0; k < n; k++) { const ang = TAU * k / n; ringPoint(r, bs, ang, p); ids.push(s.vc(p, () => r.color(ang, p), r.w, r.region)); } return ids; };
  const A = emit(a, na), B = emit(b, nb), mid = a.c.clone().add(b.c).multiplyScalar(0.5);
  const out = (i: number, j: number, k: number) => s.pos(i).add(s.pos(j)).add(s.pos(k)).multiplyScalar(1 / 3).sub(mid);
  let i = 0, j = 0;
  while (i < na || j < nb) {
    const ai = A[i % na]!, bj = B[j % nb]!;
    if (j >= nb || (i < na && (i + 1) / na <= (j + 1) / nb)) { const an = A[(i + 1) % na]!; s.to(ai, an, bj, out(ai, an, bj)); i++; }
    else { const bn = B[(j + 1) % nb]!; s.to(ai, bn, bj, out(ai, bn, bj)); j++; }
  }
}
/** Closes a ring with a flat disc facing `dir` x its tangent (the same vertices a loft emits for it, plus the centre).
 * With `inset` < 1 the disc's rim is pulled toward its centre by that factor: a hidden disc inside a joint whose rim
 * coincided with the surface depth-fought it along the seam (the light dotted line at the trunk junction, skin EC4). */
function capFlat(s: Skin, r: Ring, segments: number, dir: 1 | -1, inset = 1) {
  const b = ringBasis(r), p = V(), ids: number[] = [], mid = V(), rim: THREE.Vector3[] = [];
  for (let k = 0; k < segments; k++) { const a = TAU * k / segments; ringPoint(r, b, a, p); rim.push(p.clone()); mid.add(p); }
  mid.multiplyScalar(1 / segments);
  for (let k = 0; k < segments; k++) { const a = TAU * k / segments, q = inset === 1 ? rim[k]! : mid.clone().lerp(rim[k]!, inset); ids.push(s.vc(q, () => r.color(a, q), r.w, r.region)); }
  const centre = s.vc(mid, () => r.color(-Math.PI / 2, mid), r.w, r.region), out = b.t.clone().multiplyScalar(dir);
  const hide0 = s.hide; if (inset < 1) s.hide = true;
  for (let k = 0; k < segments; k++) s.to(centre, ids[k]!, ids[(k + 1) % segments]!, out);
  s.hide = hide0;
}
function fan(s: Skin, apex: number, ring: number[], start: boolean) {
  for (let k = 0; k < ring.length; k++) { const a = ring[k]!, b = ring[(k + 1) % ring.length]!; if (start) s.t(b, a, apex); else s.t(a, b, apex); }
}
/** Tube along a polyline with parallel-transported frames. */
function tube(s: Skin, points: THREE.Vector3[], radii: number[], weights: W[], color: (i: number, a: number, p: THREE.Vector3) => RGB, segments: number, capStart = 0.5, capEnd = 0.5, flatten = 1, upHint?: THREE.Vector3) {
  if (points.length < 2) return;
  const rings: Ring[] = [];
  let u = upHint?.clone() ?? V(0, 1, 0);
  for (let i = 0; i < points.length; i++) {
    const t = points[Math.min(points.length - 1, i + 1)]!.clone().sub(points[Math.max(0, i - 1)]!).normalize();
    u.addScaledVector(t, -u.dot(t)); if (u.lengthSq() < 1e-8) u = Math.abs(t.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), u.addScaledVector(t, -u.dot(t));
    u.normalize();
    const index = i;
    rings.push({c: points[i]!, t, u: u.clone(), rx: Math.max(1e-4, radii[i]!), ry: Math.max(1e-4, radii[i]! * flatten), w: weights[i]!, color: (a, p) => color(index, a, p)});
  }
  loft(s, rings, segments, capStart, capEnd);
}
function ellipsoid(s: Skin, center: THREE.Vector3, axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3], radii: [number, number, number], w: W, color: (a: number, f: number, p: THREE.Vector3) => RGB, segments = 10, stations = 6) {
  const [ax, ay] = axes, rings: Ring[] = [];
  for (let i = 0; i <= stations; i++) {
    const f = i / stations, th = mix(-0.92, 0.92, f) * Math.PI / 2, k = Math.cos(th);
    rings.push({c: center.clone().addScaledVector(ax, Math.sin(th) * radii[0]), t: ax, u: ay, rx: radii[2] * k, ry: radii[1] * k, w, color: (a, p) => color(a, f, p)});
  }
  loft(s, rings, segments, 0.32, 0.32);
}
/** Closed thin slab from a convex polygon (in a plane spanned by e1,e2 about origin). */
function slab(s: Skin, origin: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3, poly: [number, number][], thickness: number, w: W | ((x: number, y: number) => W), color: RGB | ((x: number, y: number) => RGB)) {
  const n = V().crossVectors(e1, e2).normalize(), centroid = V();
  const at = (x: number, y: number, side: number) => origin.clone().addScaledVector(e1, x).addScaledVector(e2, y).addScaledVector(n, side * thickness * 0.5);
  const weight = (x: number, y: number) => typeof w === 'function' ? w(x, y) : w, col = (x: number, y: number) => typeof color === 'function' ? color(x, y) : color;
  const top = poly.map(([x, y]) => s.v(at(x, y, 1), col(x, y), weight(x, y))), bottom = poly.map(([x, y]) => s.v(at(x, y, -1), col(x, y), weight(x, y)));
  poly.forEach(([x, y]) => centroid.add(at(x, y, 0))); centroid.multiplyScalar(1 / poly.length);
  for (let k = 1; k + 1 < poly.length; k++) { s.to(top[0]!, top[k]!, top[k + 1]!, n); s.to(bottom[0]!, bottom[k]!, bottom[k + 1]!, n.clone().negate()); }
  for (let k = 0; k < poly.length; k++) {
    const k2 = (k + 1) % poly.length, out = s.pos(top[k]!).add(s.pos(top[k2]!)).multiplyScalar(0.5).sub(centroid);
    s.to(top[k]!, bottom[k]!, top[k2]!, out); s.to(top[k2]!, bottom[k]!, bottom[k2]!, out);
  }
}

/** Centripetal (alpha 0.5) Catmull-Rom segment p1 -> p2; returns the point and unit tangent at fraction f. */
function centripetal(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
  const knot = (a: THREE.Vector3, b: THREE.Vector3) => Math.max(1e-6, Math.sqrt(a.distanceTo(b)));
  const t0 = 0, t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const a1 = V(), a2 = V(), a3 = V(), b1 = V(), b2 = V();
  const point = (t: number, out: THREE.Vector3) => {
    a1.copy(p0).lerp(p1, (t - t0) / (t1 - t0)); a2.copy(p1).lerp(p2, (t - t1) / (t2 - t1)); a3.copy(p2).lerp(p3, (t - t2) / (t3 - t2));
    b1.copy(a1).lerp(a2, (t - t0) / (t2 - t0)); b2.copy(a2).lerp(a3, (t - t1) / (t3 - t1));
    return out.copy(b1).lerp(b2, (t - t1) / (t2 - t1));
  };
  return (f: number) => {
    const t = t1 + (t2 - t1) * f, h = (t2 - t1) * 1e-3;
    const c = point(t, V()), tan = point(t + h, V()).sub(point(t - h, V()));
    if (tan.lengthSq() < 1e-20) tan.copy(p2).sub(p1);
    return {c, t: tan.normalize()};
  };
}

/** Largest centreline turn allowed between consecutive rings before a midpoint ring is inserted. */
const MAX_RING_TURN = 12 * Math.PI / 180;
/**
 * skin-5: re-places the stations past arc length `fromArc` (the station there and the chain end stay) at equal steps of
 * max(arc / mean spacing + turn / TRUNK_RESPACE_TURN, |log radius change| / TRUNK_RESPACE_TAPER) along the
 * centreline, keeping their number: rings move from straight runs into bends, so the largest ring-to-ring turn drops without adding
 * triangles, while a tapering run keeps enough rings for small radius steps.
 */
function respaceStations<S extends {k: number; f: number; kind: ComposerSkinRing['kind']}>(plan: S[], evalSeg: (k: number, f: number) => {c: THREE.Vector3; t: THREE.Vector3}, radiusAt: (k: number, f: number) => number, segCount: number, fromArc: number): S[] {
  const tau = (st: {k: number; f: number}) => st.k + st.f, N = 32 * segCount;
  const at = (x: number) => { const k = Math.min(segCount - 1, Math.floor(x)); return evalSeg(k, x - k); };
  const rAt = (x: number) => { const k = Math.min(segCount - 1, Math.floor(x)); return Math.max(1e-6, radiusAt(k, x - k)); };
  const xs: number[] = [], arc: number[] = [], turn: number[] = [], taper: number[] = [];
  let prev = at(0), prevR = rAt(0);
  for (let j = 0; j <= N; j++) {
    const x = segCount * j / N, cur = at(x), r = rAt(x);
    xs.push(x); arc.push(j ? arc[j - 1]! + cur.c.distanceTo(prev.c) : 0); turn.push(j ? turn[j - 1]! + cur.t.angleTo(prev.t) : 0);
    taper.push(j ? taper[j - 1]! + Math.abs(Math.log(r / prevR)) : 0);
    prev = cur; prevR = r;
  }
  const arcAt = (x: number) => { const j = Math.min(N - 1, Math.floor(x / segCount * N)), f = x / segCount * N - j; return mix(arc[j]!, arc[j + 1]!, f); };
  const i0 = plan.findIndex(st => arcAt(tau(st)) >= fromArc);
  if (i0 < 0 || plan.length - 1 - i0 < 2) return plan;
  const x0 = tau(plan[i0]!), x1 = segCount, n = plan.length - 1 - i0, mean = (arcAt(x1) - arcAt(x0)) / n;
  // bend measure per sample, then the taper floor: one ring step (mu step S) never spans more than TRUNK_RESPACE_TAPER
  // of log radius change; S depends on the floor, so a few fixed-point passes settle it
  const j0 = Math.max(0, xs.findIndex(x => x >= x0)), bend: number[] = [0], tp: number[] = [0];
  for (let j = 1; j <= N; j++) { bend.push(j > j0 ? (arc[j]! - arc[j - 1]!) / Math.max(1e-9, mean) + (turn[j]! - turn[j - 1]!) / TRUNK_RESPACE_TURN : 0); tp.push(j > j0 ? (taper[j]! - taper[j - 1]!) / TRUNK_RESPACE_TAPER : 0); }
  let S = bend.reduce((a, b) => a + b, 0) / n, d = bend;
  for (let pass = 0; pass < 6; pass++) { d = bend.map((b, j) => Math.max(b, S * tp[j]!)); S = d.reduce((a, b) => a + b, 0) / n; }
  const mu = [0];
  for (let j = 1; j <= N; j++) mu.push(mu[j - 1]! + d[j]!);
  const muAt = (x: number) => { const j = Math.min(N - 1, Math.floor(x / segCount * N)), f = x / segCount * N - j; return mix(mu[j]!, mu[j + 1]!, f); };
  const m0 = muAt(x0), m1 = muAt(x1), out = plan.slice(0, i0 + 1);
  let j = 0;
  for (let i = 1; i < n; i++) {
    const target = m0 + (m1 - m0) * i / n;
    while (j < N - 1 && mu[j + 1]! < target) j++;
    const x = Math.max(x0, xs[j]! + (xs[j + 1]! - xs[j]!) * (target - mu[j]!) / Math.max(1e-12, mu[j + 1]! - mu[j]!));
    const k = Math.min(segCount - 1, Math.floor(x)), f = x - k;
    out.push({...plan[i0]!, k, f, kind: 'bone'});
  }
  out.push(plan[plan.length - 1]!);
  return out;
}
/**
 * Adaptive ring placement: wherever two consecutive stations (segment k, fraction f) differ in tangent by more
 * than MAX_RING_TURN, a station is inserted halfway in chain parameter (k + f), up to three levels deep. Only
 * sharply bent joints gain rings, so a straight chain keeps its spec'd tessellation.
 */
function refineStations<S extends {k: number; f: number; kind: ComposerSkinRing['kind']}>(plan: S[], tangent: (s: {k: number; f: number}) => THREE.Vector3, segCount: number): S[] {
  let cur = plan, tans = cur.map(st => tangent(st).clone().normalize());
  for (let pass = 0; pass < 3; pass++) {
    const next: S[] = [cur[0]!], nextT: THREE.Vector3[] = [tans[0]!];
    let added = false;
    for (let i = 1; i < cur.length; i++) {
      const a = cur[i - 1]!, b = cur[i]!;
      if (tans[i - 1]!.angleTo(tans[i]!) > MAX_RING_TURN) {
        const tm = (a.k + a.f + b.k + b.f) / 2, k = Math.min(segCount - 1, Math.floor(tm)), f = tm - k;
        const st = {...a, k, f, kind: f < 0.12 || f > 0.88 ? 'joint' : 'bone'} as S;
        next.push(st); nextT.push(tangent(st).clone().normalize()); added = true;
      }
      next.push(b); nextT.push(tans[i]!);
    }
    cur = next; tans = nextT;
    if (!added) break;
  }
  return cur;
}

// ------------------------------------------------------------------ head stations
interface HeadStation {x: number; w: number; h: number; yc: number}
/** The cranial station where the head loft starts (and the neck blend ends), in head-bone units. */
function headFirstStation(head: ComposerSkull, H: number, cW: number, cH: number): HeadStation {
  const x = 0.22 * H;
  if (head === 'muzzle' || head === 'jaws') { const fl = head === 'jaws' ? 0.82 : 1; return {x, w: 0.982 * cW, h: 0.973 * cH * fl, yc: -0.0133 * cH}; }
  if (head === 'beak') return {x, w: cW, h: cH, yc: 0.02 * cH};
  if (head === 'flat-face') return {x, w: cW, h: cH, yc: 0.04 * cH};
  if (head === 'blunt') return {x, w: 0.985 * cW, h: 0.985 * cH, yc: 0};
  return {x, w: 0.943 * cW, h: 0.931 * cH, yc: 0};
}

type At = (b: ComposerBone, x: number, y?: number, z?: number) => THREE.Vector3;
type Axis = (b: ComposerBone, x: number, y: number, z: number) => THREE.Vector3;
type Palette = Record<'base' | 'accent' | 'belly' | 'keratin' | 'skin' | 'eye' | 'horn' | 'plate', RGB>;
type CoatAt = (p: THREE.Vector3, dorsal: number, region: CoatRegion, along: number, footprint?: number) => RGB;
/** Crisp-coat layer hook (skin-5): Skin.vc sets `mode`, coatAt evaluates accordingly and reports its sample. */
interface CoatLayerHook {
  /** 0: ordinary evaluation (recorded); 1: mask 0; 2: mask 1, patch 0; 3: mask 1, patch 1. */
  mode: number;
  /** coatAt calls in the current mode-0 evaluation; ok = the last one was a crisp pattern in a crisp region. */
  calls: number; ok: boolean;
  /** The coat sample of the last mode-0 evaluation (coatAt's scratch sample). */
  readonly sample: {x: number; y: number; z: number; dorsal: number; along: number; footprint: number};
  /** Did the recorded sample come from exactly this position? */
  sampledAt(p: THREE.Vector3): boolean;
}
const CRISP_OFF_LIMBS: ReadonlySet<string> = new Set(['stripes', 'bands', 'brindle']);
const LIMB_REGIONS: ReadonlySet<CoatRegion> = new Set(['limb-upper', 'limb-lower', 'foot'] as CoatRegion[]);
/** Dorsal component of an elliptical ring's outward normal at angle a (bone-local, -1 belly .. 1 back). */
const ringDorsal = (a: number, rx: number, ry: number, ryBelow = ry) => { const sa = Math.sin(a), ca = Math.cos(a), h = sa < 0 ? ryBelow : ry, n = Math.hypot(ca * h, sa * rx); return n > 1e-12 ? sa * rx / n : sa; };
const ringLateral = (a: number, rx: number, ry: number, ryBelow = ry) => { const sa = Math.sin(a), ca = Math.cos(a), h = sa < 0 ? ryBelow : ry, n = Math.hypot(ca * h, sa * rx); return n > 1e-12 ? ca * h / n : ca; };

/** Per-individual skin features; identity (zero jitter) when the traits are neutral. */
interface SkinIndividual {
  traits: ComposerIndividualTraits;
  /** Jitter strength: 0 for neutral traits, else the recipe variability (capped at 1.5). */
  jv: number;
  osteoSeed: number; plateSeed: number; featherSeed: number;
}
const jitterU = (seed: number, k: number, j: number) => hash3u(k, j, 7, seed) / 4294967296;

// ------------------------------------------------------------------ skin builder
export function buildComposerSkin(graph: ComposerGraph, options: ComposerSkinOptions = {}): ComposerSkin {
  if (options.presentation !== undefined && options.presentation !== 'skin-5' && options.presentation !== 'realism-1') throw new Error('Unknown Composer skin presentation');
  const realism = options.presentation === 'realism-1';
  const s = new Skin(), r = graph.recipe, d = graph.dims, bones = graph.bones;
  const traits = options.traits ?? composerIndividualTraits(r);
  const jv = traits.neutral ? 0 : clamp(r.variability, 0, 1.5);
  const seed = composerHash(`${r.colorSeed}/${r.palette}`);
  const Q = (b: ComposerBone) => new THREE.Quaternion(...b.restQuaternion);
  const P = (b: ComposerBone) => V(...b.restPosition);
  const at = (b: ComposerBone, x: number, y = 0, z = 0) => V(x, y, z).applyQuaternion(Q(b)).add(P(b));
  const axis = (b: ComposerBone, x: number, y: number, z: number) => V(x, y, z).applyQuaternion(Q(b)).normalize();
  const L = d.bodyLength, scale = Math.max(L, 0.2);
  const one = (bone: number): W => [[bone, 1]];
  const debugRings: ComposerSkinRing[] | undefined = options.debug ? [] : undefined;
  let splineFallbacks = 0, blendUnfolded = false;
  const T = COMPOSER_SKIN_TESSELLATION;

  // ---- individual stream: fixed draw order, mesh-local, never colorSeed
  const ind = composerRandom(`composer-skin-ind-v1/${traits.coat.driftKey}`);
  const u9: number[] = []; for (let i = 0; i < 12; i++) u9.push(ind());
  const word = (u: number) => Math.floor(u * 4294967296) >>> 0;
  const mottleSeed = word(u9[0]!), mottleAmp = jv * (0.05 + 0.07 * u9[1]!);
  const bellyShift = jv * (u9[2]! - 0.5) * 0.24, countershadeScale = 1 + jv * (u9[3]! - 0.5) * 0.3;
  const soil = jv * 0.45 * u9[4]!, soilHeight = 0.12 + 0.3 * u9[5]!;
  // overall coat tone: individuals of one species differ in shade by about +-17% perceptual lightness
  const tone = 1 + jv * (u9[9]! - 0.5) * 0.34;
  const individual: SkinIndividual = {traits, jv, osteoSeed: word(u9[6]!), plateSeed: word(u9[7]!), featherSeed: word(u9[8]!)};

  // ---- coat genome (built once per creature)
  let genome: CoatGenome = graph.phenotype ? structuredClone(graph.phenotype.coat) : applyCoatDrift(defaultCoatGenome(r.palette, r.colorSeed, {pattern: r.pattern, marks: r.marks, scale: r.patternScale, contrast: r.patternContrast, countershade: r.countershade, juvenileSpots: traits.coat.juvenileSpots}),
    coatIndividualDrift(traits.coat.driftKey, r.variability));
  if (jv > 0) genome = {...genome, bellyLine: clamp(genome.bellyLine + bellyShift, -1, 1), countershade: clamp(genome.countershade * countershadeScale, 0, 1)};
  const requestedScale = genome.scale;
  // bare parts vary per individual too: skin and keratin pigment together (+-15% perceptual), iris shade (+-10%)
  const skinMul = (1 + jv * (u9[10]! - 0.5) * 0.3) ** 2.2, eyeMul = (1 + jv * (u9[11]! - 0.5) * 0.2) ** 2.2;
  const pal = {...genome.colours, skin: scaleC(genome.colours.skin, skinMul), keratin: scaleC(genome.colours.keratin, skinMul), eye: scaleC(genome.colours.eye, eyeMul)} as Palette;
  const male = traits.sex === 'male' && r.dimorphism > 0;
  // sexual dichromatism (skin-5, docs/fauna-coat-crisp-v1.md metric b): an adult male's back and flanks take a richer
  // coat, from existing fields only (sex, dimorphism, maturity, palette); females and sexless animals are untouched
  const dichro = male ? r.dimorphism * smooth(0.55, 0.95, traits.maturity) : 0;
  const SOIL: RGB = [0.155, 0.117, 0.08];

  // coat frame: origin at the torso centre, x along the torso (in the sagittal plane), z lateral
  const {torso, tail, neck, head, trunk} = graph.chains;
  const tFirst = bones[torso[0]!]!, tLast = bones[torso[torso.length - 1]!]!;
  const rear = at(tFirst, 0, tFirst.start.yc), front = at(tLast, tLast.length, tLast.end.yc);
  const origin = rear.clone().add(front).multiplyScalar(0.5), fwd = front.clone().sub(rear); fwd.z = 0;
  if (fwd.lengthSq() < 1e-12) fwd.set(1, 0, 0);
  fwd.normalize();
  const coatPhase = graph.phenotype?.coatFrame.phase ?? 0, coatLateral = graph.phenotype?.coatFrame.lateral ?? 1;
  const coatStage=graph.phenotype?.coatStage,stageBody={x:0,y:0,z:0,halfH:d.torsoHeight/scale,halfW:d.torsoWidth/scale,cell:.024};
  const coatOut = new Float64Array(3);
  const sample = {x: 0, y: 0, z: 0, dorsal: 0, region: 'torso' as CoatRegion, along: 0, footprint: 0};
  const groundRef = Math.max(d.legReach, d.frontLegReach, 1e-3);
  const plainGenome = genome.pattern === 'bands' ? {...genome, pattern: 'plain' as const} : null;
  // crisp coat (skin-5): the pattern is drawn per fragment at the requested scale; the skin carries layer colours
  const crispPattern = (COMPOSER_COAT_CRISP_PATTERNS as readonly string[]).includes(genome.pattern) ? genome.pattern as ComposerCoatCrispPattern : null;
  const hook: CoatLayerHook = {mode: 0, calls: 0, ok: false, sample, sampledAt: q => {
    const dx = q.x - origin.x, dy = q.y - origin.y;
    return sample.x === (dx * fwd.x + dy * fwd.y) / scale + coatPhase && sample.y === (dy * fwd.x - dx * fwd.y) / scale && sample.z === q.z / scale * coatLateral;
  }};
  if (crispPattern) s.coat = hook;
  const coatAt: CoatAt = (p, dorsal, region, along, fp = 0) => {
    const dx = p.x - origin.x, dy = p.y - origin.y;
    sample.x = (dx * fwd.x + dy * fwd.y) / scale + coatPhase; sample.y = (dy * fwd.x - dx * fwd.y) / scale; sample.z = p.z / scale * coatLateral;
    sample.dorsal = clamp(dorsal, -1, 1); sample.region = region; sample.along = clamp(along, 0, 1); sample.footprint = fp;
    if(coatStage){stageBody.x=sample.x-coatPhase;stageBody.y=sample.y;stageBody.z=p.z/scale;}
    const mode = hook.mode;
    if (mode === 0) {
      if(coatStage)evaluateFaunaStageCoat(genome,coatStage,sample,stageBody,coatOut);else evaluateCoat(genome, sample, coatOut, 0);
      hook.calls++;
      hook.ok = region !== 'eye' && region !== 'horn' && region !== 'armor' && !(CRISP_OFF_LIMBS.has(genome.pattern) && LIMB_REGIONS.has(region));
    } else if(coatStage)evaluateFaunaStageCoat(genome,coatStage,sample,stageBody,coatOut,mode===1?0:1,mode===3?1:0);else evaluateCoatWithMask(genome, sample, coatOut, 0, mode === 1 ? 0 : 1, mode === 3 ? 1 : 0);
    let c: RGB = [coatOut[0]!, coatOut[1]!, coatOut[2]!];
    // body bands continued as rings down every leg read as a striped sock (toy-like); reptile limbs carry the
    // banding faintly, as scale-row shading, so it fades to 40% strength there
    if (plainGenome && (region === 'limb-upper' || region === 'limb-lower' || region === 'foot')) {
      if(coatStage)evaluateFaunaStageCoat(plainGenome,coatStage,sample,stageBody,coatOut);else evaluateCoat(plainGenome, sample, coatOut, 0);
      c = mixC([coatOut[0]!, coatOut[1]!, coatOut[2]!], c, 0.4);
    }
    if (region === 'eye' || region === 'horn' || region === 'armor') return c;
    // individual tone, low-frequency mottling and darker males along the back, as perceptual (sRGB-like)
    // lightness factors so dark coats vary visibly too (linear factor = perceptual factor ^ 2.2)
    let k = tone;
    if (mottleAmp > 0) k *= 1 + mottleAmp * 2 * (valueNoise3(sample.x * 4.5, sample.y * 4.5, sample.z * 4.5, mottleSeed) - 0.5);
    if (male) k *= 1 - 0.06 * r.dimorphism * smooth(-0.2, 0.7, dorsal);
    if (k !== 1) c = scaleC(c, Math.pow(k, 2.2));
    if (dichro > 0) c = dichromatic(c, dichro * smooth(-0.85, 0.15, dorsal), r.palette === 'plumage', pal.accent, pal.base);
    if (r.palette === 'plumage' && region === 'neck') c = mixC(c, pal.accent, 0.25);
    // dried mud and dust on the lower legs, varying per individual
    if (soil > 0 && (region === 'limb-lower' || region === 'foot' || region === 'limb-upper') && r.layout !== 'limbless') c = mixC(c, SOIL, soil * smooth(soilHeight * groundRef, 0.02 * groundRef, p.y));
    return c;
  };

  // ---- chains
  type Seg = {bone: ComposerBone; reversed: boolean};
  interface Meta {kind: ComposerSkinRing['kind']; bone: ComposerBone; k: number; f: number; sec: ComposerSection; fp: number; along: number; region: CoatRegion}
  interface ChainOpts {
    ringsFor: (bone: ComposerBone) => number;
    ripple?: (bone: ComposerBone, f: number) => number;
    startWeights?: W; endBone?: number;
    /** Control points past the chain end (the spline continues into them). */
    extra?: THREE.Vector3[];
    /** First ring of the first segment (limb root); earlier rings are dropped. */
    rootF?: number;
    /** skin-5: respace the stations past this arc length by arc + turn (TRUNK_RESPACE_TURN), keeping their count. */
    respaceFrom?: number;
    dress: (ring: Ring, meta: Meta) => void;
    /** Runs after the underside clamp. */
    after?: (ring: Ring, meta: Meta) => void;
  }
  const buildChain = (segs: Seg[], o: ChainOpts) => {
    const sections: ComposerSection[] = [];
    segs.forEach(({bone, reversed}, k) => {
      const first = reversed ? bone.end : bone.start, last = reversed ? bone.start : bone.end;
      if (k === 0) sections.push(first); else { const prev = sections[sections.length - 1]!; sections[sections.length - 1] = {w: (prev.w + first.w) / 2, h: (prev.h + first.h) / 2, yc: (prev.yc + first.yc) / 2}; }
      sections.push(last);
    });
    // Catmull-Rom across joint sections smooths the silhouette between bones
    const sampleSec = (k: number, f: number): ComposerSection => {
      const p0 = sections[Math.max(0, k - 1)]!, p1 = sections[k]!, p2 = sections[k + 1]!, p3 = sections[Math.min(sections.length - 1, k + 2)]!;
      const cr = (a: number, b: number, c: number, e: number) => 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - e) * f * f + (-a + 3 * b - 3 * c + e) * f * f * f);
      const w = Math.max(1e-4, cr(p0.w, p1.w, p2.w, p3.w)), yc = cr(p0.yc, p1.yc, p2.yc, p3.yc);
      // The underside never bulges below the straight line between joint undersides (the rig's support contract);
      // Catmull-Rom overshoot would otherwise push a resting belly through the floor.
      const lowest = mix(p1.yc - p1.h, p2.yc - p2.h, f);
      return {w, h: Math.max(1e-4, Math.min(cr(p0.h, p1.h, p2.h, p3.h), yc - lowest)), yc};
    };
    // centreline control points: joints offset by the section centre along the (averaged) dorsal axis
    const ctrl: THREE.Vector3[] = [], ups: THREE.Vector3[] = [];
    segs.forEach(({bone, reversed}, k) => {
      const up = axis(bone, 0, 1, 0), a = at(bone, reversed ? bone.length : 0), b = at(bone, reversed ? 0 : bone.length);
      if (k === 0) { ctrl.push(a); ups.push(up); } else { ctrl[k]!.add(a).multiplyScalar(0.5); ups[k] = ups[k]!.clone().add(up).normalize(); }
      ctrl.push(b); ups.push(up);
    });
    ctrl.forEach((c, i) => c.addScaledVector(ups[i]!, sections[i]!.yc));
    const ext = [...ctrl, ...(o.extra ?? [])];
    const pad = [ext[0]!.clone().multiplyScalar(2).sub(ext[1]!), ...ext, ext[ext.length - 1]!.clone().multiplyScalar(2).sub(ext[ext.length - 2]!)];
    const curves = ext.slice(0, -1).map((_, k) => centripetal(pad[k]!, pad[k + 1]!, pad[k + 2]!, pad[k + 3]!));
    const chordDir = (k: number) => ext[k + 1]!.clone().sub(ext[k]!).normalize();
    // overshoot guard: a segment that strays from its chord falls back to the polyline at its interior joints
    const fallback = curves.map(() => false), fellBack = new Set<number>();
    for (let k = 0; k < segs.length; k++) {
      const a = ext[k]!, dir = chordDir(k), len = ext[k + 1]!.distanceTo(a);
      const rmin = Math.max(1e-4, Math.min((sections[k]!.w + sections[k]!.h) / 2, (sections[k + 1]!.w + sections[k + 1]!.h) / 2));
      for (let q = 1; q < 8; q++) {
        const {c, t} = curves[k]!(q / 8), off = c.clone().sub(a), dev = off.addScaledVector(dir, -off.dot(dir)).length();
        if (dev > Math.max(0.5 * rmin, 0.12 * len) || t.dot(dir) < 0.3) { fallback[k] = true; break; }
      }
      if (fallback[k]) { if (k > 0) fellBack.add(k); if (k + 1 < ext.length - 1) fellBack.add(k + 1); }
    }
    splineFallbacks += fellBack.size;
    const evalSeg = (k: number, f: number) => {
      if (!fallback[k]) return curves[k]!(f);
      const dir = chordDir(k), t = dir.clone();
      if (k > 0 && fellBack.has(k) && f < 0.12) t.lerp(chordDir(k - 1), 0.5 - f / 0.24);
      if (k + 1 < curves.length && fellBack.has(k + 1) && f > 0.88) t.lerp(chordDir(k + 1), (f - 0.88) / 0.24);
      return {c: ext[k]!.clone().lerp(ext[k + 1]!, f), t: t.normalize()};
    };
    // ring plan: regular rings, joint rings at +-12%, then adaptive midpoints wherever the centreline turns too fast
    type Station = {k: number; f: number; kind: ComposerSkinRing['kind']};
    let plan: Station[] = [];
    segs.forEach(({bone}, k) => {
      const R = o.ringsFor(bone);
      let fr: number[] = [];
      for (let i = 0; i < R; i++) fr.push(i / R);
      if (k === segs.length - 1) fr.push(1);
      const extras = new Set<number>();
      if (k > 0) extras.add(0.12);
      if (k < segs.length - 1 || o.extra) extras.add(0.88);
      // regular rings too close to a joint ring are dropped so no sliver quads appear
      fr = fr.filter(f => ![...extras].some(e => Math.abs(f - e) < 0.04));
      fr = [...fr, ...extras].sort((a, b) => a - b);
      if (k === 0 && o.rootF !== undefined) { const f3 = o.rootF, gap = 0.5 / R; fr = [f3, ...fr.filter(f => f > f3 + gap)]; }
      for (const f of fr) plan.push({k, f, kind: k === 0 && f === o.rootF ? 'root' : extras.has(f) ? 'joint' : 'bone'});
    });
    plan = refineStations(plan, st => evalSeg(st.k, st.f).t, segs.length);
    if (o.respaceFrom !== undefined) plan = respaceStations(plan, evalSeg, (k, f) => { const sc = sampleSec(k, f); return 0.5 * (sc.w + sc.h); }, segs.length, o.respaceFrom);
    const rings: Ring[] = [], metas: Meta[] = [];
    segs.forEach(({bone}, k) => {
      const prev = segs[k - 1]?.bone, next = segs[k + 1]?.bone;
      for (const {f, kind} of plan.filter(st => st.k === k)) {
        const sec = sampleSec(k, f), ripple = o.ripple ? o.ripple(bone, f) : 1;
        const {c, t} = evalSeg(k, f), up = axis(bone, 0, 1, 0);
        let weights: W;
        if (f < 0.5 && prev) { const wp = 0.5 * (1 - smooth(0, 0.5, f)); weights = [[prev.index, wp], [bone.index, 1 - wp]]; }
        else if (f > 0.5 && next) { const wn = 0.5 * smooth(0.5, 1, f); weights = [[next.index, wn], [bone.index, 1 - wn]]; }
        // The tube end hands over completely to `endBone` (a leg's level foot), so the ankle follows the planted sole.
        else if (f > 0.5 && !next && o.endBone !== undefined) { const wn = smooth(0.5, 1, f); weights = [[o.endBone, wn], [bone.index, 1 - wn]]; }
        else weights = [[bone.index, 1]];
        if (k === 0 && rings.length === 0 && o.startWeights) weights = o.startWeights;
        const ring: Ring = {c, t, u: up, rx: sec.w * ripple, ry: sec.h * ripple, w: weights, color: () => [0, 0, 0]};
        const meta: Meta = {kind, bone, k, f, sec, fp: 0, along: 0, region: 'torso'};
        o.dress(ring, meta);
        // the spline centreline may sag below the straight bone line: keep the underside above the joint-underside line
        const lineY = mix(sections[k]!.yc - sections[k]!.h, sections[k + 1]!.yc - sections[k + 1]!.h, f);
        const local = c.clone().sub(P(bone)).dot(up);
        let below = ring.ryBelow ?? ring.ry;
        if (local - below < lineY) {
          below = local - lineY;
          const floor = 0.35 * ring.ry;
          if (below < floor) { c.addScaledVector(up, floor - below); below = floor; }
        }
        ring.ryBelow = Math.max(1e-4, below);
        o.after?.(ring, meta);
        rings.push(ring); metas.push(meta);
      }
    });
    return {rings, metas, sections, evalSeg};
  };
  /** Pattern footprint per ring: the larger of the circumferential and axial vertex spacing, in body lengths. */
  const setFootprints = (rings: Ring[], metas: Meta[], radial: number) => {
    rings.forEach((ring, i) => {
      const circ = TAU * 0.5 * (ring.rx + 0.5 * (ring.ry + (ring.ryBelow ?? ring.ry))) / radial;
      const dPrev = i > 0 ? rings[i - 1]!.c.distanceTo(ring.c) : Infinity, dNext = i + 1 < rings.length ? rings[i + 1]!.c.distanceTo(ring.c) : Infinity;
      const axial = Math.min(dPrev, dNext);
      metas[i]!.fp = Math.max(circ, Number.isFinite(axial) ? axial : circ) / scale;
    });
  };
  const report = (chain: string, rings: Ring[], metas: Meta[]) => {
    if (!debugRings) return;
    rings.forEach((ring, i) => {
      const m = metas[i]!;
      debugRings.push({chain, kind: m.kind, bone: m.bone.index, part: m.bone.part, f: m.f, centre: vec(ring.c), tangent: vec(ring.t.clone().normalize()), rx: ring.rx, ry: ring.ry, ryBelow: ring.ryBelow ?? ring.ry, weights: ring.w.map(([b, w]) => [b, w] as [number, number]), region: m.region});
    });
  };

  // ---- axial chain: tail tip -> torso -> neck end -> head blend
  const torsoSeg = r.torso === 'segmented', annulated = r.torso === 'annulated';
  const ripple = (bone: ComposerBone, f: number) => bone.part !== 'torso' ? 1 : torsoSeg ? 1 - 0.14 * Math.pow(Math.cos(Math.PI * f), 8) : annulated ? 1 - 0.05 * Math.pow(Math.cos(Math.PI * 3 * f), 6) : 1;
  const band = (bone: ComposerBone, f: number) => bone.part !== 'torso' ? 0 : torsoSeg ? 0.55 * Math.pow(Math.cos(Math.PI * f), 6) : annulated ? 0.25 * Math.pow(Math.cos(Math.PI * 3 * f), 4) : 0;
  const axialSegs: Seg[] = [...[...tail].reverse().map(i => ({bone: bones[i]!, reversed: true})), ...torso.map(i => ({bone: bones[i]!, reversed: false})), ...neck.map(i => ({bone: bones[i]!, reversed: false}))];
  const torsoBones = torso.map(i => bones[i]!), torsoTotal = torsoBones.reduce((a, b) => a + b.length, 0);
  const startOf = (list: number[]) => { const m = new Map<number, number>(); let acc = 0; for (const i of list) { m.set(i, acc); acc += bones[i]!.length; } return m; };
  const chainLen = (list: number[]) => list.reduce((a, i) => a + bones[i]!.length, 0);
  const torsoStartOf = startOf(torso), tailStart = startOf(tail), neckStart = startOf(neck);
  const tailTotal = chainLen(tail), neckTotal = chainLen(neck);
  // torso lobes: withers, scapula, haunch, flank tuck, male shoulders (dorsal or lateral only)
  const limbU = (limb: ComposerLimb) => ((torsoStartOf.get(limb.socketBone) ?? 0) + limb.socket[0]) / Math.max(torsoTotal, 1e-9);
  const ground = graph.limbs.filter(l => l.kind !== 'wing');
  const meanU = (list: ComposerLimb[]) => list.length ? list.reduce((a, l) => a + limbU(l), 0) / list.length : undefined;
  const hindU = meanU(ground.filter(l => !l.front)), foreU = meanU(ground.filter(l => l.front));
  const lobed = ground.length > 0 && (r.layout === 'quadruped' || r.layout === 'biped' || r.layout === 'sprawled') && !torsoSeg && !annulated;
  const socketSep = ground.length ? Math.min(...ground.map(l => 2 * Math.abs(l.socket[2]))) : 0;
  const latCap = 0.35 * socketSep;
  const torsoLobe = (u: number, sec: ComposerSection) => (a: number): [number, number] => {
    const ca = Math.cos(a), sa = Math.sin(a), c2 = ca * ca, upper = smooth(-0.25, 0.35, sa), lower = smooth(0.25, -0.45, sa);
    const dor = 0.06 * sec.h * (1 + 0.05 * traits.torso.withers) * gauss(u, 0.85, 0.09) * Math.max(0, sa) ** 2;
    let lat = 0;
    if (foreU !== undefined) lat += 0.08 * sec.w * gauss(u, foreU, 0.07) * c2 * upper;
    if (hindU !== undefined) lat += 0.10 * sec.w * gauss(u, hindU, 0.08) * c2 * upper;
    lat -= 0.06 * sec.w * gauss(u, 0.25, 0.1) * c2 * lower;
    if (male) lat += 0.08 * r.dimorphism * sec.w * smooth(0.72, 0.86, u) * c2 * upper;
    // the lobes die out at both ends of the torso: a lobe still standing at the last torso ring would end in a
    // step (a collar) where the neck or tail starts
    const ends = smooth(0, 0.06, u) * smooth(1, 0.9, u);
    return [clamp(lat, -latCap, latCap) * ends, dor * ends];
  };
  const torsoU = (bone: ComposerBone, f: number) => ((torsoStartOf.get(bone.index) ?? 0) + f * bone.length) / Math.max(torsoTotal, 1e-9);
  const axialRegion = (bone: ComposerBone, f: number): [CoatRegion, number] => {
    if (bone.part === 'tail') { const x = ((tailStart.get(bone.index) ?? 0) + (1 - f) * bone.length) / Math.max(tailTotal, 1e-9); return x > 0.85 ? ['tail-tip', (x - 0.85) / 0.15] : ['tail', x / 0.85]; }
    if (bone.part === 'neck') return ['neck', ((neckStart.get(bone.index) ?? 0) + f * bone.length) / Math.max(neckTotal, 1e-9)];
    return ['torso', torsoU(bone, f)];
  };
  const hb = bones[head]!, H = d.headLength;
  const station0 = headFirstStation(composerSkullOf(r.head), H, d.craniumWidth, d.craniumHeight);
  const hc1 = at(hb, station0.x, station0.yc), hc2 = at(hb, 0.5 * H, station0.yc);
  const axialRadial = torsoSeg || annulated ? T.torsoRadialBanded : T.torsoRadial;
  const headCtx = makeHeadColours(r, d, coatAt, axialRadial, scale);
  s.begin('torso', torsoSeg ? 'segmented trunk' : annulated ? 'annulated body' : 'torso');
  const axialChain = buildChain(axialSegs, {
    ripple, extra: [hc1, hc2],
    ringsFor: b => b.part === 'torso' ? (annulated ? T.torsoRingsAnnulated : T.torsoRings) : b.part === 'neck' ? T.neckRings : T.tailRings,
    dress: (ring, meta) => {
      const {bone, f, sec} = meta, [region, along] = axialRegion(bone, f);
      meta.region = region; meta.along = along; ring.region = REGION[region];
      if (bone.part === 'torso') {
        const u = torsoU(bone, f);
        ring.n = 2 + 0.3 * smooth(0, 0.15, u) * smooth(1, 0.85, u);
        if (lobed) ring.lobe = torsoLobe(u, sec);
      }
      const bandK = band(bone, f);
      ring.color = (a, p) => {
        const c = coatAt(p, ringDorsal(a, ring.rx, ring.ry, ring.ryBelow), region, along, meta.fp);
        return bandK ? mixC(c, pal.accent, bandK) : c;
      };
    },
  });
  // neck -> head blend rings in the head frame: sections ramp geometrically, weights hand over to the head
  const lastSeg = axialSegs[axialSegs.length - 1]!.bone, lastSec = axialChain.sections[axialChain.sections.length - 1]!;
  const meanR = (w: number, h: number) => (w + h) / 2;
  const ratio = meanR(station0.w, station0.h) / Math.max(1e-6, meanR(lastSec.w, lastSec.h));
  // the radius eases into the head station (zero slope there) so the cranium does not rise as a ridge behind the
  // blend; the ease doubles the steepest step, hence twice the rings of a geometric ramp
  const blendCount = clamp(Math.ceil(2 * Math.abs(Math.log(ratio)) / Math.log(1.12)), 2, 9);
  const blendEase = (sb: number) => 1 - (1 - sb) * (1 - sb);
  const headWeightAt = (x: number) => x <= 0.1 * H ? 0.35 * x / (0.1 * H) : Math.min(0.7, 0.35 + 0.35 * (x - 0.1 * H) / (0.12 * H));
  const blendRings: Ring[] = [], blendMetas: Meta[] = [];
  // blend stations: uniform in sb, then refined where the neck-to-head centreline turns faster than MAX_RING_TURN
  const headAxis = axis(hb, 1, 0, 0), lastAxial = axialChain.rings[axialChain.rings.length - 1]!;
  const blendPlan = refineStations([{k: 0, f: 0, kind: 'blend' as const}, ...Array.from({length: blendCount}, (_, i) => ({k: 0, f: (i + 1) / blendCount, kind: 'blend' as const}))],
    st => st.f === 0 ? lastAxial.t : st.f === 1 ? headAxis : axialChain.evalSeg(axialSegs.length, st.f).t, 1).slice(1).map(st => st.f);
  for (const sb of blendPlan) {
    const x = station0.x * sb, last = sb === 1;
    const {c, t} = axialChain.evalSeg(axialSegs.length, sb);
    const eb = blendEase(sb), w = lastSec.w * (station0.w / lastSec.w) ** eb, h = lastSec.h * (station0.h / lastSec.h) ** eb;
    const hw = headWeightAt(x), up = last ? axis(hb, 0, 1, 0) : axis(lastSeg, 0, 1, 0).lerp(axis(hb, 0, 1, 0), sb).normalize();
    const ring: Ring = {c: last ? hc1.clone() : c, t: last ? axis(hb, 1, 0, 0) : t, u: up, rx: last ? station0.w : w, ry: last ? station0.h : h, w: [[lastSeg.index, 1 - hw], [hb.index, hw]], color: () => [0, 0, 0]};
    const region: CoatRegion = sb < 0.5 ? 'neck' : headCtx.region(x), along = sb < 0.5 ? 1 : headCtx.along(x);
    const meta: Meta = {kind: 'blend', bone: hb, k: axialSegs.length, f: sb, sec: {w, h, yc: 0}, fp: 0, along, region};
    ring.region = REGION[region];
    if (last) ring.color = headCtx.col(x, station0.w, station0.h);
    else ring.color = (a, p) => {
      const dorsal = ringDorsal(a, ring.rx, ring.ry);
      // stretch: a soft cavity under the jaw where the throat meets the head
      const cavity = 1 - 0.12 * Math.sin(Math.PI * sb) * smooth(0.1, -0.7, dorsal);
      return scaleC(coatAt(p, dorsal, region, along, meta.fp), cavity);
    };
    blendRings.push(ring); blendMetas.push(meta);
  }
  const axialRings = [...axialChain.rings, ...blendRings], axialMetas = [...axialChain.metas, ...blendMetas];
  // ring planes must not cross on the inside of a bend (a thick torso turning up into the neck pinches the back
  // into a crease): wherever consecutive rings turn by more than their spacing allows at their radius, the ring
  // orientations are smoothed over a window that grows with the radius until no pair crosses; centres stay on the
  // spline. The last ring is the head's first station and keeps the head frame; the tail tip is free.
  fanOutBends(axialRings, true);
  // skin-5: the neck-to-head blend rings sit close together (the head station is a short reach away), so where the
  // smoothed frames still cross there (a fold at the top of the seam, whose faces point into the neck) the blend rings
  // turn monotonically from the neck's last frame to the head axis instead, eased over the blend's arc length
  const firstBlend = axialChain.rings.length - 1;
  if (axialRings.slice(firstBlend, -1).some((r, i) => ringsCross(r, axialRings[firstBlend + i + 1]!))) {
    blendUnfolded = true;
    const from = axialRings[firstBlend]!.t.clone().normalize(), to = axialRings[axialRings.length - 1]!.t.clone().normalize(), arc = [0];
    for (let i = firstBlend + 1; i < axialRings.length; i++) arc.push(arc[arc.length - 1]! + axialRings[i]!.c.distanceTo(axialRings[i - 1]!.c));
    const total = arc[arc.length - 1]! || 1, q = new THREE.Quaternion().setFromUnitVectors(from, to), id = new THREE.Quaternion();
    for (let i = firstBlend + 1; i < axialRings.length - 1; i++) axialRings[i]!.t = from.clone().applyQuaternion(id.clone().slerp(q, smooth(0, 1, arc[i - firstBlend]! / total)));
  }
  setFootprints(axialRings, axialMetas, axialRadial);
  // ---- pattern scale clamp: keep a mean pattern cell at least four torso edges across
  // the exact triangle edges the loft will emit between torso-region rings (same superellipse, lobes and squash)
  const torsoEdges = loftEdgeLengths(axialRings, axialRadial, i => axialMetas[i]!.region === 'torso' && axialMetas[i + 1]!.region === 'torso');
  torsoEdges.sort();
  const torsoEdge = torsoEdges.length ? torsoEdges[torsoEdges.length >> 1]! : 0;
  if(coatStage)stageBody.cell=torsoEdge/scale;
  const cells = COAT_CELLS_PER_BODY[genome.pattern];
  if (cells > 0 && genome.pattern !== 'roan' && torsoEdge > 0) {
    const maxScale = scale / (4 * 1.08 * cells * torsoEdge);
    if (genome.scale > maxScale) genome = {...genome, scale: maxScale};
  }
  if(coatStage){Object.freeze(genome);if(plainGenome)Object.freeze(plainGenome);}
  // the end cap closes the neck inside the head (whose first station is the neck's last ring)
  loft(s, axialRings, axialRadial, tail.length ? 0.25 : 0.85, 0.25, 2);
  report('axial', axialRings, axialMetas);
  s.end();

  // ---- head (rigid on the head bone except the first station, which shares the last blend ring's weights)
  const eyeCtx: EyeContext = {eyeMul, speciesBodyLength: composerSpeciesBodyLength(r, traits), fallbacks: 0, eyes: [], colours: {eye: [...pal.eye] as RGB, iris: null, lidFactor: 0.35}};
  const trunkJoin = buildHead(s, graph, hb, pal, at, axis, headCtx, station0, blendRings[blendRings.length - 1]!.w, individual, coatAt, eyeCtx);
  // ---- trunk: the proboscis face's nose. Its first ring IS the muzzle's last station (same centre, section, basis,
  // colour and weights, duplicated like the neck-to-head seam), then the section and ring orientation ease from that
  // station into the trunk bones' own over TRUNK_JOIN_BLEND x the station radius, so the muzzle flows into the trunk
  // instead of a thin tube stepping out of a capped snout. skin EC4: TRUNK_RADIAL (16, was 12) segments, and a
  // nostril end (TRUNK_TIP) instead of a rounded cap.
  if (trunk.length) {
    s.begin('trunk', 'trunk');
    s.region = REGION.muzzle;
    const segs = trunk.map(i => ({bone: bones[i]!, reversed: false}));
    const reach0 = trunkJoin ? TRUNK_JOIN_BLEND * Math.max(trunkJoin.rx, trunkJoin.ry) : 0;
    const tr = buildChain(segs, {ringsFor: () => 4, respaceFrom: reach0, startWeights: [[head, 0.7], [trunk[0]!, 0.3]], dress: (ring, meta) => {
      meta.region = 'muzzle'; meta.along = 1; ring.region = REGION.muzzle;
      // fine skin wrinkles (skin EC4; 4 broad accent bands before, which Luna read as 'segment-like bands')
      const bandK = TRUNK_WRINKLE[0] * Math.pow(Math.sin(Math.PI * TRUNK_WRINKLE[1] * meta.f), 6);
      ring.color = (a, p) => mixC(coatAt(p, ringDorsal(a, ring.rx, ring.ry, ring.ryBelow), 'muzzle', 1, meta.fp), pal.accent, bandK);
    }});
    let rings = tr.rings;
    setFootprints(tr.rings, tr.metas, TRUNK_RADIAL);
    if (trunkJoin) {
      rings = [trunkJoin, ...tr.rings.slice(1)];
      const reach = TRUNK_JOIN_BLEND * Math.max(trunkJoin.rx, trunkJoin.ry);
      // skin-5 (coat crisp v1, metric d2): the centre line leaves the muzzle along its axis and meets the trunk spline at
      // the first ring past `reach` on a cubic Hermite curve (tangent-continuous at both ends), and the rings inside
      // the reach sit at equal arc steps along it, so the turn spreads evenly over the join (EC4's lerp toward the
      // muzzle line bent most at the second ring, 10 .. 13 deg)
      let m = 1, arc = 0;
      while (m < rings.length - 2 && (arc += rings[m]!.c.distanceTo(rings[m - 1]!.c)) < reach) m++;
      if (arc < reach) {
        // a trunk shorter than the reach (trunkLength 0.2): EC4's blend toward the muzzle line, unchanged
        arc = 0;
        for (let i = 1; i < rings.length; i++) {
          arc += rings[i]!.c.distanceTo(rings[i - 1]!.c);
          const k = 1 - smooth(0, reach, arc), rg = rings[i]!;
          if (k <= 0) break;
          rg.c = rg.c.clone().lerp(trunkJoin.c.clone().addScaledVector(trunkJoin.t.clone().normalize(), arc), k * k);
          rg.t = rg.t.clone().normalize().lerp(trunkJoin.t.clone().normalize(), k).normalize();
          rg.u = rg.u.clone().lerp(trunkJoin.u, k).normalize();
          const below = rg.ryBelow ?? rg.ry;
          rg.rx = mix(rg.rx, trunkJoin.rx, k); rg.ry = mix(rg.ry, trunkJoin.ry, k); rg.ryBelow = mix(below, trunkJoin.ryBelow ?? trunkJoin.ry, k);
        }
      } else if (m > 1) {
        const P0 = trunkJoin.c, T0 = trunkJoin.t.clone().normalize(), P1 = rings[m]!.c, T1 = rings[m]!.t.clone().normalize(), L = P0.distanceTo(P1);
        const herm = (u: number, out: THREE.Vector3) => { const u2 = u * u, u3 = u2 * u; return out.copy(P0).multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(T0, TRUNK_JOIN_LEAD * L * (u3 - 2 * u2 + u)).addScaledVector(P1, -2 * u3 + 3 * u2).addScaledVector(T1, L * (u3 - u2)); };
        const N = 64, len = [0], q = V(), prev = herm(0, V());
        for (let j = 1; j <= N; j++) { herm(j / N, q); len.push(len[j - 1]! + q.distanceTo(prev)); prev.copy(q); }
        const uAt = (frac: number) => { const target = frac * len[N]!; let j = 1; while (j < N && len[j]! < target) j++; return (j - 1 + (target - len[j - 1]!) / Math.max(1e-12, len[j]! - len[j - 1]!)) / N; };
        for (let i = 1; i < m; i++) {
          const frac = i / m, u = uAt(frac), rg = rings[i]!, k = 1 - smooth(0, 1, frac);
          rg.c = herm(u, V());
          rg.t = herm(Math.min(1, u + 1e-3), V()).sub(herm(Math.max(0, u - 1e-3), V())).normalize();
          rg.u = rg.u.clone().lerp(trunkJoin.u, k).normalize();
          const below = rg.ryBelow ?? rg.ry;
          rg.rx = mix(rg.rx, trunkJoin.rx, k); rg.ry = mix(rg.ry, trunkJoin.ry, k); rg.ryBelow = mix(below, trunkJoin.ryBelow ?? trunkJoin.ry, k);
        }
      }
      // the join ring carries the head's radial count, which the trunk keeps for its first TRUNK_ZIP_LENGTH join radii;
      // one zipper band then steps it down to the trunk's TRUNK_RADIAL segments, away from the junction (a zipper's
      // chord sag tilts its surface, most where rings lie close, as on a short trunk)
      const minArc = TRUNK_ZIP_LENGTH * Math.max(trunkJoin.rx, trunkJoin.ry);
      let z = 0;
      for (let arc = 0; z < rings.length - 3 && arc < minArc; z++) arc += rings[z + 1]!.c.distanceTo(rings[z]!.c);
      capFlat(s, trunkJoin, axialRadial, -1, HIDDEN_DISC_INSET);
      if (z > 0) loft(s, rings.slice(0, z + 1), axialRadial, 0, 0);
      zipRings(s, rings[z]!, axialRadial, rings[z + 1]!, TRUNK_RADIAL);
      loft(s, rings.slice(z + 1), TRUNK_RADIAL, 0, 0);
    } else loft(s, rings, TRUNK_RADIAL, 0.2, 0);
    report('trunk', rings, tr.metas);
    buildTrunkTip(s, rings[rings.length - 1]!, bones[trunk[trunk.length - 1]!]!, pal, at, axis, (p, a) => coatAt(p, a, 'muzzle', 1));
    s.end();
  }

  // ---- tail extras
  if (tail.length) {
    const tip = bones[tail[tail.length - 1]!]!, tipEnd = at(tip, tip.length);
    const ax = axis(tip, 1, 0, 0), ay = axis(tip, 0, 1, 0), az = axis(tip, 0, 0, 1);
    s.begin('tail-tip', r.tail);
    s.region = REGION['tail-tip'];
    if (r.tail === 'tufted') ellipsoid(s, tipEnd.clone().addScaledVector(ax, tip.end.h * 2), [ax, ay, az], [Math.max(tip.length * 0.9, tip.end.h * 4), tip.end.h * 2.6, tip.end.h * 2.6], one(tip.index),
      (a, f, p) => mixC(mixC(coatAt(p, Math.sin(a), 'tail-tip', 1), pal.accent, 0.75), pal.keratin, 0.4 + 0.2 * Math.sin(a * 5 + f * 9)), 10, 6);
    if (r.tail === 'club') {
      const rr = Math.max(tip.end.h * 2.4, L * 0.05);
      ellipsoid(s, tipEnd.clone().addScaledVector(ax, rr * 0.6), [ax, ay, az], [rr * 1.1, rr * 0.8, rr * 1.3], one(tip.index), () => pal.horn, 12, 7);
      for (const side of [-1, 1]) ellipsoid(s, tipEnd.clone().addScaledVector(ax, rr * 0.6).addScaledVector(az, side * rr * 1.2), [ax, ay, az], [rr * 0.55, rr * 0.45, rr * 0.5], one(tip.index), () => pal.horn, 8, 4);
    }
    if (r.tail === 'feather-fan') {
      const span = composerFeatherFanSpan(r, L), feathers = Math.max(5, 9 + traits.countScale.feather);
      for (let k = 0; k < feathers; k++) {
        const ang = mix(-0.75, 0.75, k / (feathers - 1)), dir = ax.clone().multiplyScalar(Math.cos(ang)).addScaledVector(az, Math.sin(ang)).normalize();
        const side = V().crossVectors(ay, dir).normalize(), len = span * (1 - 0.18 * Math.abs(ang)) * (1 + 0.24 * individual.jv * (jitterU(individual.featherSeed, k, 0) - 0.5));
        const wdt = span * 0.11;
        slab(s, tipEnd.clone().addScaledVector(ay, 0.004 * k * span / feathers), dir, side, [[-0.02 * len, 0], [0.3 * len, -wdt * 0.5], [0.85 * len, -wdt * 0.55], [len, 0], [0.85 * len, wdt * 0.55], [0.3 * len, wdt * 0.5]], span * 0.012, one(tip.index), (x) => mixC(pal.accent, pal.keratin, smooth(0.7, 1, x / len) * 0.7));
      }
    }
    s.end();
  }

  // ---- limbs
  /** Torso skin weights at a carrier bone fraction (the axial chain's smoothstep blend). */
  const carrierWeights = (carrier: ComposerBone, f: number): W => {
    const k = axialSegs.findIndex(sg => sg.bone.index === carrier.index);
    const prev = k > 0 ? axialSegs[k - 1]!.bone : undefined, next = k >= 0 ? axialSegs[k + 1]?.bone : undefined;
    if (f < 0.5 && prev) { const wp = 0.5 * (1 - smooth(0, 0.5, f)); return [[prev.index, wp], [carrier.index, 1 - wp]]; }
    if (f > 0.5 && next) { const wn = 0.5 * smooth(0.5, 1, f); return [[next.index, wn], [carrier.index, 1 - wn]]; }
    return [[carrier.index, 1]];
  };
  // body containment: superellipse norm of a point against the axial loft, interpolated between bracketing rings
  // (lobes ignored; < 1 is inside). Infinity when no ring pair brackets the point.
  const axialBases = axialRings.map(ringBasis), tq = V();
  const sectionNorm = (r: Ring, b: RingBasis, p: THREE.Vector3) => {
    tq.copy(p).sub(r.c);
    const x = tq.dot(b.v), y = tq.dot(b.u), e = r.n ?? 2, ry = y < 0 ? r.ryBelow ?? r.ry : r.ry;
    return (Math.abs(x / r.rx) ** e + Math.abs(y / ry) ** e) ** (1 / e);
  };
  // bounding sphere per ring pair: a point outside it cannot reach norm < ~2.5 against that pair
  const pairBound = axialRings.slice(0, -1).map((a, i) => { const b = axialRings[i + 1]!, c = a.c.clone().add(b.c).multiplyScalar(0.5); return {c, r2: (0.5 * a.c.distanceTo(b.c) + 2.5 * Math.max(a.rx, a.ry, a.ryBelow ?? a.ry, b.rx, b.ry, b.ryBelow ?? b.ry)) ** 2}; });
  const allPairs = pairBound.map((_, i) => i);
  const torsoNorm = (p: THREE.Vector3, candidates: readonly number[] = allPairs) => {
    let best = Infinity;
    for (const i of candidates) {
      if (p.distanceToSquared(pairBound[i]!.c) > pairBound[i]!.r2) continue;
      const a = axialRings[i]!, b = axialRings[i + 1]!, da = tq.copy(p).sub(a.c).dot(axialBases[i]!.t), db = tq.copy(p).sub(b.c).dot(axialBases[i + 1]!.t);
      if (da < 0 || db > 0) continue;
      const lam = da / Math.max(1e-12, da - db);
      best = Math.min(best, (1 - lam) * sectionNorm(a, axialBases[i]!, p) + lam * sectionNorm(b, axialBases[i + 1]!, p));
    }
    return best;
  };
  const rp = V();
  /** Largest torso norm over a ring's vertices; stops early once it exceeds `limit` (only the comparison is used then).
   * Only ring pairs whose bounding sphere the ring can reach are tested: the rest fail the per-point bound anyway. */
  const ringNorm = (ring: Ring, radial: number, limit = Infinity) => {
    const b = ringBasis(ring), reach = 1.5 * Math.max(ring.rx, ring.ry, ring.ryBelow ?? ring.ry);
    const candidates = allPairs.filter(i => { const d = Math.sqrt(pairBound[i]!.r2) + reach; return ring.c.distanceToSquared(pairBound[i]!.c) <= d * d; });
    let m = 0;
    for (let k = 0; k < radial && m <= limit; k++) m = Math.max(m, torsoNorm(ringPoint(ring, b, TAU * k / radial, rp), candidates));
    return m;
  };
  const limbChain = (limb: ComposerLimb, segBones: ComposerBone[], kind: 'leg' | 'arm', chainName: string) => {
    const arth = kind === 'leg' && r.legs === 'arthropod';
    const radial = kind === 'arm' ? T.armRadial : arth ? T.legRadialArthropod : T.legRadial;
    const R = kind === 'arm' ? T.armRings : arth ? T.legRingsArthropod : T.legRings;
    const upper = segBones[0]!, carrier = bones[limb.socketBone]!, footBone = kind === 'leg' ? bones[limb.bones[limb.bones.length - 1]!]! : undefined;
    const lowerTotal = segBones.slice(1).reduce((a, b) => a + b.length, 0);
    const lowerStart = new Map<number, number>(); { let acc = 0; for (const b of segBones.slice(1)) { lowerStart.set(b.index, acc); acc += b.length; } }
    const S = P(upper), dir = axis(upper, 1, 0, 0), qInv = Q(carrier).invert(), PC = P(carrier);
    const cAlong = clamp(S.clone().sub(PC).dot(axis(carrier, 1, 0, 0)), 0, carrier.length), fc = cAlong / Math.max(carrier.length, 1e-9);
    const csec = {w: mix(carrier.start.w, carrier.end.w, fc), h: mix(carrier.start.h, carrier.end.h, fc), yc: mix(carrier.start.yc, carrier.end.yc, fc)};
    const local = (p: THREE.Vector3) => p.clone().sub(PC).applyQuaternion(qInv);
    const inside = (x: number) => { const q = local(S.clone().addScaledVector(dir, x)), yy = (q.y - csec.yc) / csec.h, zz = q.z / csec.w; return yy * yy + zz * zz < 1; };
    // where the limb axis leaves the body
    let xe = 0;
    if (inside(0)) {
      const steps = 32; let lo = 0, hi = upper.length;
      for (let i = 1; i <= steps; i++) { const x = upper.length * i / steps; if (!inside(x)) { hi = x; break; } lo = x; }
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
      xe = hi;
    }
    const qe = local(S.clone().addScaledVector(dir, xe));
    const nS = V(0, (qe.y - csec.yc) / (csec.h * csec.h), qe.z / (csec.w * csec.w)).applyQuaternion(Q(carrier)).normalize();
    const torsoDorsal = (p: THREE.Vector3) => { const q = local(p), y = (q.y - csec.yc) / (csec.h * csec.h), z = q.z / (csec.w * csec.w), n = Math.hypot(y, z); return n > 1e-12 ? y / n : 0; };
    const fE = clamp(xe / upper.length, 0, 0.9);
    const sE = upper.start, eE = upper.end, rE = Math.max(1e-4, mix((sE.w + sE.h) / 2, (eE.w + eE.h) / 2, fE));
    const cosI = Math.max(0.35, Math.abs(dir.dot(nS)));
    const x0 = xe - 0.3 * rE / cosI, x3 = Math.max(x0 + 0.6 * rE, xe + 0.1 * rE);
    const f3 = clamp(x3 / upper.length, 0.01, 0.45);
    const thighCap = Math.abs(limb.socket[2]) * 0.9;
    const sideRoom = csec.w * 1.05 - Math.abs(local(S).z);
    const latCapLimb = 0.35 * Math.max(2 * Math.abs(limb.socket[2]), 1e-6);
    const deepCannon = kind === 'leg' && (r.legs === 'unguligrade' || r.legs === 'digitigrade');
    const basisCache = new WeakMap<Ring, {u: THREE.Vector3; v: THREE.Vector3}>();
    const limbColour = (ring: Ring, region: CoatRegion, along: number, fp: number, rootness: number, a: number, p: THREE.Vector3): RGB => {
      let b = basisCache.get(ring);
      if (!b) { const t = ring.t.clone().normalize(), u = ring.u.clone().addScaledVector(t, -ring.u.dot(t)).normalize(); b = {u, v: V().crossVectors(u, t)}; basisCache.set(ring, b); }
      const nl = ringLateral(a, ring.rx, ring.ry, ring.ryBelow), nd = ringDorsal(a, ring.rx, ring.ry, ring.ryBelow);
      const nz = b.v.z * nl + b.u.z * nd, ny = b.v.y * nl + b.u.y * nd, medial = -limb.side * nz;
      // limbs have no spine: outer and upper faces read as dorsal, the inner (medial) face as belly
      let dorsal = clamp(0.35 - 0.9 * medial + 0.5 * ny, -1, 1);
      if (rootness > 0) dorsal = mix(dorsal, torsoDorsal(p), rootness);
      const c = coatAt(p, dorsal, region, along, fp);
      return arth && r.palette === 'ink' ? mixC(c, pal.accent, 0.85) : c;
    };
    const chain = buildChain(segBones.map(b => ({bone: b, reversed: false})), {
      ringsFor: () => R, endBone: footBone?.index, rootF: f3,
      dress: (ring, meta) => {
        const {bone, f, sec} = meta, bi = segBones.indexOf(bone);
        const region: CoatRegion = bi === 0 ? 'limb-upper' : 'limb-lower';
        const along = bi === 0 ? f : ((lowerStart.get(bone.index) ?? 0) + f * bone.length) / Math.max(lowerTotal, 1e-9);
        meta.region = region; meta.along = along; ring.region = REGION[region];
        let k = 1;
        if (!arth) {
          if (bi === 0) k += 0.45 * (1 - smooth(0.25, 0.75, f));                        // thigh / upper arm: a taper, never a bump below the body
          if (bi === 1) k += 0.12 * gauss(f, 0.45, 0.15);                             // gaskin / forearm
          // condyle at the joint; graviportal pillar legs are columnar, with barely a knob at the elbow and knee
          if (bi >= 1) k += (r.legs === 'pillar' ? 0.04 : 0.12) * (1 - smooth(0.03, 0.14, f));
        }
        // muscle mass deepens a limb fore-aft (ry, the bend plane) more than it widens it (rx): thighs are
        // laterally flat, and the upper limb never bulges past the body's side wall
        let rx = Math.min(sec.w * (1 + 0.8 * (k - 1)), sec.w + latCapLimb);
        const ry = sec.h * k;
        if (bi === 0) rx = Math.min(rx, Math.max(sec.w, sideRoom));
        // upright limbs: the thigh never crosses the body midline
        if (bi === 0 && Math.abs(axis(bone, 0, 0, 1).z) > 0.7 && Math.abs(axis(bone, 1, 0, 0).y) > 0.6) rx = Math.min(rx, Math.max(thighCap, 0.55 * sec.w));
        ring.rx = rx; ring.ry = ry; ring.ryBelow = ry;
        const rootness = bi === 0 ? 1 - smooth(0, 0.3, f) : 0;
        ring.color = (a, p) => limbColour(ring, region, along, meta.fp, rootness, a, p);
      },
      after: (ring, meta) => {
        // unguligrade / digitigrade cannons: deeper fore-aft than wide
        if (deepCannon && segBones.indexOf(meta.bone) >= 1) ring.rx = (ring.ry + (ring.ryBelow ?? ring.ry)) / (2 * 1.3);
      },
    });
    // root transition rings: from a flattened ellipse inside the body surface to the first limb ring
    const ring3 = chain.rings[0]!, meta3 = chain.metas[0]!;
    const nPerp = nS.clone().addScaledVector(ring3.t, -nS.dot(ring3.t));
    const squashDir = nPerp.lengthSq() > 0.01 ? nPerp.normalize() : undefined;
    const cw = carrierWeights(carrier, fc);
    const rootRings: Ring[] = [], rootMetas: Meta[] = [];
    const ROOT: [number, number, number][] = [[0, 1, 0.18], [1 / 3, 0.7, 0.12], [2 / 3, 0.35, 0.06]];
    // the first root ring must lie wholly inside the body, or its cap shows as a sleeve: sink it deeper, then shrink it
    const ringAt = (x: number, g: number): Ring => {
      const ring: Ring = {c: S.clone().addScaledVector(dir, x), t: dir.clone(), u: ring3.u.clone(), rx: ring3.rx * g, ry: ring3.ry * g, ryBelow: (ring3.ryBelow ?? ring3.ry) * g, w: [], color: () => [0, 0, 0]};
      if (squashDir) ring.squash = [squashDir, 0.4];
      return ring;
    };
    let xRoot = x0, gRoot = 1.15;
    if (Number.isFinite(torsoNorm(S.clone().addScaledVector(dir, x0)))) {
      const fits = (x: number, g: number) => ringNorm(ringAt(x, g), radial, 0.96) <= 0.96;
      let j = 0;
      while (j < 8 && !fits(xRoot, gRoot)) { j++; xRoot = x0 - j * 0.15 * rE; }
      if (!fits(xRoot, gRoot)) {
        let lo = 0.3, hi = 1.15;
        for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (fits(xRoot, m)) lo = m; else hi = m; }
        gRoot = lo;
      }
    }
    for (const [sF, carrierShare, cavityK] of ROOT) {
      const grow = sF === 0 ? gRoot : mix(1.15, 1, sF), c = S.clone().addScaledVector(dir, xRoot).lerp(ring3.c, sF), t = dir.clone().lerp(ring3.t, sF).normalize();
      const weights: W = [...cw.map(([b, w]) => [b, w * carrierShare] as [number, number]), [upper.index, 1 - carrierShare]];
      const ring: Ring = {c, t, u: ring3.u.clone(), rx: ring3.rx * grow, ry: ring3.ry * grow, ryBelow: (ring3.ryBelow ?? ring3.ry) * grow, w: weights, region: REGION['limb-upper'], color: () => [0, 0, 0]};
      if (squashDir) ring.squash = [squashDir, 0.4 * (1 - sF)];
      const meta: Meta = {kind: 'root', bone: upper, k: 0, f: mix(xRoot, x3, sF) / upper.length, sec: meta3.sec, fp: 0, along: 0, region: 'limb-upper'};
      // stretch: cavity shading where the limb meets the body, strongest on the ventral side
      ring.color = (a, p) => scaleC(limbColour(ring, 'limb-upper', 0, meta.fp, 1, a, p), 1 - cavityK * (0.5 + 0.5 * smooth(0.2, -0.6, torsoDorsal(p))));
      rootRings.push(ring); rootMetas.push(meta);
    }
    const rings = [...rootRings, ...chain.rings], metas = [...rootMetas, ...chain.metas];
    // buried rings must stay buried: a ring whose centre is inside the body but whose side pokes out of the flank
    // (the body narrows toward the belly) slides toward the midline, then narrows laterally, until it fits
    const zC = axis(carrier, 0, 0, 1);
    for (const ring of rings) {
      const cn = torsoNorm(ring.c);
      if (!(cn < 1) || ringNorm(ring, radial, 0.97) <= 0.97) continue;
      const lz = local(ring.c).z, inward = zC.clone().multiplyScalar(-Math.sign(lz) || 0), c0 = ring.c.clone(), rx0 = ring.rx;
      const fit = (shift: number, sx: number) => { ring.c.copy(c0).addScaledVector(inward, shift); ring.rx = rx0 * sx; return ringNorm(ring, radial, 0.97) <= 0.97; };
      // only a flank poke is corrected: when even a ring narrowed to half width at 0.8 of the way to the midline
      // still sticks out, the excess is fore-aft (a limb at the very front of the chest) and the ring stays as built
      let shift = 0.8 * Math.abs(lz), sx = 1;
      if (fit(shift, 1)) { let lo = 0, hi = shift; for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (fit(m, 1)) hi = m; else lo = m; } shift = hi; }
      else if (fit(shift, 0.5)) { let lo = 0.5, hi = 1; for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (fit(shift, m)) lo = m; else hi = m; } sx = lo; }
      else { ring.c.copy(c0); ring.rx = rx0; continue; }
      // rings near the surface take part of the correction, so the leg leaves the body without a kink
      const w = cn < 0.9 ? 1 : (1 - cn) / 0.1;
      ring.c.copy(c0).addScaledVector(inward, shift * w); ring.rx = rx0 * mix(1, sx, w);
    }
    setFootprints(rings, metas, radial);
    // a small start cap keeps the buried root closed (positive part volume) without a visible collar
    const joinedFoot = realism && kind === 'leg' && ['pad', 'hoof', 'claw'].includes(r.feet);
    loft(s, rings, radial, 0.1, joinedFoot ? 0 : kind === 'arm' ? 0.3 : 0.4);
    report(chainName, rings, metas);
    return {ring: rings[rings.length - 1]!, radial};
  };
  for (const limb of graph.limbs) {
    const carrier = bones[limb.socketBone]!;
    const tag = `${limb.side < 0 ? 'L' : 'R'}`;
    if (limb.kind === 'leg') {
      const name = `leg ${limb.pair + 1}${tag}`;
      s.begin('leg', name);
      s.region = REGION['limb-upper'];
      const firstVertex = s.nv, footBone = bones[limb.bones[limb.bones.length - 1]!]!;
      const ankle = limbChain(limb, limb.bones.slice(0, limb.segments.length).map(i => bones[i]!), 'leg', name);
      s.end();
      s.begin('foot', `${r.feet} ${limb.pair + 1}${tag}`);
      s.region = REGION.foot;
      const firstFootVertex = s.nv;
      const footCoat = (p: THREE.Vector3) => coatAt(p, 0, 'foot', 1);
      if (realism && (r.feet === 'pad' || r.feet === 'hoof' || r.feet === 'claw')) buildRealismFoot(s, r.feet, footBone, limb.footHeight, limb.footLength, limb.side, ankle, pal, at, axis, footCoat, graph.phenotype?.dimensions);
      else buildFoot(s, r.feet, footBone, bones[limb.bones[limb.bones.length - 2]!]!, limb.footHeight, limb.footLength, limb.side, pal, at, axis, footCoat);
      if (graph.phenotype && r.feet === 'paw') {
        // Paw lobes are separate overlapping geometry in the existing Composer.
        // Fit their lateral extent to the resolved foot width, in the foot frame.
        const centre = P(footBone), lateral = axis(footBone, 0, 0, 1), p = V(); let lo = Infinity, hi = -Infinity;
        for (let v = firstFootVertex; v < s.nv; v++) {const z = p.fromArray(s.p, v * 3).sub(centre).dot(lateral); lo = Math.min(lo, z); hi = Math.max(hi, z);}
        const k = graph.phenotype.dimensions.footWidth / (hi - lo), middle = (lo + hi) / 2;
        for (let v = firstFootVertex; v < s.nv; v++) {p.fromArray(s.p, v * 3); const z = p.clone().sub(centre).dot(lateral); p.addScaledVector(lateral, (z - middle) * k - z); s.p.set([p.x,p.y,p.z], v * 3);}
      }
      s.end();
      fitFootContract(s, firstVertex, footBone, limb.footHeight, limb.footExtent);
    } else if (limb.kind === 'arm') {
      s.begin('arm', `arm ${tag}`);
      s.region = REGION['limb-upper'];
      limbChain(limb, limb.bones.slice(0, 2).map(i => bones[i]!), 'arm', `arm ${tag}`);
      s.end();
      s.begin('hand', `${r.hands} ${tag}`);
      s.region = REGION.foot;
      buildHand(s, r.hands, bones[limb.bones[1]!]!, bones[limb.bones[2]!]!, bones[limb.bones[3]!]!, limb.side, pal, at, axis, p => coatAt(p, 0, 'foot', 1));
      s.end();
    } else {
      s.begin('wing', `${r.wings} wing ${tag}`);
      s.region = REGION.wing;
      buildWing(s, graph, limb.bones.map(i => bones[i]!), carrier, limb.side, pal, at, axis, (p, u) => coatAt(p, 0.6, 'wing', u));
      s.end();
    }
  }

  // ---- armor
  if (r.armor !== 'none') { s.begin('armor', r.armor); s.region = REGION.armor; buildArmor(s, graph, pal, at, axis, seed, individual); s.end(); }
  s.end();

  const positions = new Float32Array(s.p.subarray(0, s.nv * 3)), colors = s.c.slice(0, s.nv * 3), skinIndex = s.si.slice(0, s.nv * 4), skinWeight = s.sw.slice(0, s.nv * 4), index = s.ix.slice(0, s.ni), regions = s.rg.slice(0, s.nv), gloss = s.gl.slice(0, s.nv);
  // the shader's pattern runs at the REQUESTED scale (the vertex colours above use the clamped `genome.scale`)
  const crispGenome: CoatGenome = {...genome, scale: requestedScale};
  const coatCrisp: ComposerCoatCrisp | null = crispPattern ? {
    version: COMPOSER_COAT_CRISP_VERSION, pattern: crispPattern, code: COMPOSER_COAT_CRISP_PATTERNS.indexOf(crispPattern) + 1, genome: crispGenome,
    seed: coatSeedMix(crispGenome.seed) >>> 0, cellsPerBody: COAT_CELLS_PER_BODY[crispPattern] * crispGenome.scale,
    threshold: crispGenome.threshold, warp: crispGenome.warp, bellyLine: crispGenome.bellyLine,
    frame: {origin: [origin.x, origin.y], forward: [fwd.x, fwd.y], scale, ...(graph.phenotype ? {phase: coatPhase, lateral: coatLateral} : {})},
  } : null;
  let coatLayers: ComposerCoatLayers | null = null;
  if (crispPattern) {
    const sampleOut = new Float32Array(s.nv * 4);
    for (let i = 0; i < s.nv; i++) {
      if (s.own[i]) { for (let k = 0; k < 4; k++) sampleOut[i * 4 + k] = s.cq[i * 6 + k]!; continue; }
      const dx = s.p[i * 3]! - origin.x, dy = s.p[i * 3 + 1]! - origin.y;
      sampleOut[i * 4] = (dx * fwd.x + dy * fwd.y) / scale + coatPhase; sampleOut[i * 4 + 1] = (dy * fwd.x - dx * fwd.y) / scale; sampleOut[i * 4 + 2] = s.p[i * 3 + 2]! / scale * coatLateral; sampleOut[i * 4 + 3] = 0;
    }
    coatLayers = {c0: s.l0.slice(0, s.nv * 3), c1: s.l1.slice(0, s.nv * 3), c2: s.l2.slice(0, s.nv * 3), sample: sampleOut};
  }
  const normals = composerSeamNormals(positions, index, skinIndex, skinWeight, s.hid.subarray(0, s.ni / 3), eyeVertices(s.parts, index, s.nv));
  const out: ComposerSkin = {version: realism ? COMPOSER_REALISM_SKIN_VERSION : COMPOSER_SKIN_VERSION, positions, normals, colors, skinIndex, skinWeight, index, regions, gloss, eyeFallbacks: eyeCtx.fallbacks, parts: s.parts, vertexCount: positions.length / 3, triangleCount: index.length / 3, coatScale: {pattern: genome.pattern, requested: requestedScale, effective: genome.scale}, coatCrisp, coatLayers};
  if (options.debug) out.debug = {
    rings: debugRings!, splineFallbacks,
    coat: {pattern: genome.pattern, requestedScale, effectiveScale: genome.scale, cellsPerBody: cells, meanCellDiameter: cells > 0 ? scale / (cells * genome.scale) : Infinity, torsoEdgeEstimate: torsoEdge},
    traitsNeutral: traits.neutral,
    coatVertex: crispPattern ? {own: s.own.slice(0, s.nv), sample: s.cq.slice(0, s.nv * 6)} : null,
    hiddenTriangles: s.hid.slice(0, s.ni / 3), blendUnfolded,
    eyes: eyeCtx.eyes, eyeColours: {eye: eyeCtx.colours.eye, iris: eyeCtx.colours.iris, lidFactor: eyeCtx.colours.lidFactor, compound: eyeCtx.colours.compound ?? null},
  };
  return out;
}

/** The species' body length behind an individual's effective recipe: the individual derivation scales bodyLength by
 * size, sex and maturity (fauna-composer-individual.ts), and 'auto' eyes must not change pupil with them (a kitten
 * keeps its species' pupil, a herd shares one). Rounded to the recipe's 0.01 m step. */
export function composerSpeciesBodyLength(r: ComposerRecipe, traits: ComposerIndividualTraits): number {
  if (traits.neutral) return r.bodyLength;
  const v = r.variability, d = r.dimorphism, m = r.maturity;
  const f = (1 + 0.045 * v * traits.size) * (traits.sex === 'male' ? 1 + 0.10 * d : 1) * (0.45 + 0.55 * m);
  return Math.round(r.bodyLength / f * 100) / 100;
}

interface EyeContext {
  /** the individual's iris shade factor (the existing u9[11] draw) */
  eyeMul: number;
  speciesBodyLength: number;
  fallbacks: number;
  eyes: ComposerSkinEyeDebug[];
  colours: {eye: RGB; iris: RGB | null; lidFactor: number; compound?: RGB};
}
const PUPIL_RGB: RGB = [0.008, 0.008, 0.010];
const luminance = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Iris luminance floors: at least 10x the pupil, and at least 1.8x the lid rim (eyes stay readable on dark coats). */
/** Compound-eye facet floor: at least `min` luminance and `overSkin` x the head skin under the eye, reached by blending
 * the palette eye colour toward `tint`. */
export const COMPOUND_EYE_FLOOR = Object.freeze({min: 0.03, overSkin: 2, tint: [0.36, 0.13, 0.05] as RGB});
export const COMPOSER_EYE_CONTRAST = Object.freeze({overPupil: 10, overLid: 1.8, maxIrisGain: 4, lid: 0.35, outerLid: 0.7});

/** Head-surface colour helpers shared by the neck blend rings and the head loft, so the seam matches exactly. */
function makeHeadColours(r: ComposerRecipe, d: ComposerGraph['dims'], coatAt: CoatAt, radial: number, scale: number) {
  const skull = composerSkullOf(r.head);
  const H = d.headLength, sn = d.snoutLength, muzzleFrom = skull === 'muzzle' || skull === 'jaws' ? 0.4 * H : Infinity;
  const region = (x: number): CoatRegion => x >= muzzleFrom ? 'muzzle' : 'head';
  // a flat face is bare skin (its own lofts) in front of a furred cranium: the fur rim around the face is head,
  // never muzzle, and 'along' spans the whole head so a facial mark only shades the brow instead of capping it
  const headSpan = skull === 'flat-face' ? H + sn : 0.4 * H + sn;
  const along = (x: number) => x >= muzzleFrom ? clamp((x - muzzleFrom) / Math.max(sn, 1e-3), 0, 1) : clamp(x / headSpan, 0, 1);
  const col = (x: number, sw: number, sh: number) => {
    const reg = region(x), al = along(x), fp = TAU * 0.5 * (sw + sh) / radial / scale;
    return (a: number, p: THREE.Vector3): RGB => coatAt(p, ringDorsal(a, sw, sh), reg, al, fp);
  };
  return {region, along, col, radial};
}

/** Builds the head, eyes and headgear. Returns the proboscis face's last muzzle station (bind space), which the trunk
 * loft starts from (same centre, section, basis, colour and weights), or null for every other face. */
function buildHead(s: Skin, graph: ComposerGraph, hb: ComposerBone, pal: Palette, at: At, axis: Axis, hc: ReturnType<typeof makeHeadColours>, st0: HeadStation, firstWeights: W, ind: SkinIndividual, coatAt: CoatAt, eyeCtx: EyeContext): Ring | null {
  const r = graph.recipe, d = graph.dims, H = d.headLength, cW = d.craniumWidth, cH = d.craniumHeight, sn = d.snoutLength, tr = ind.traits;
  // the legacy skull the eyes are anchored on (proboscis: the muzzle's eye site) and the headgear the face carries
  const skull = composerSkullOf(r.head), hg = composerHeadgearBuild(r);
  let trunkJoin: Ring | null = null;
  const ax = axis(hb, 1, 0, 0), ay = axis(hb, 0, 1, 0), az = axis(hb, 0, 0, 1), w = [[hb.index, 1]] as W;
  const seg = hc.radial;
  const station = (x: number, sw: number, sh: number, yc: number, color?: (a: number, p: THREE.Vector3) => RGB): Ring => ({c: at(hb, x, yc), t: ax, u: ay, rx: sw, ry: sh, w, color: color ?? hc.col(x, sw, sh), region: REGION[hc.region(x)]});
  // the first station coincides with the last neck blend ring (same centre, section, basis, colour and weights)
  const first = (): Ring => ({...station(st0.x, st0.w, st0.h, st0.yc), w: firstWeights});
  const firstPart = s.parts.length;
  // bare-part colours of the face (never the eye colour, which only the eyes part carries)
  const nose = scaleC(pal.skin, 0.22), mouthDisc = mixC(pal.skin, [0, 0, 0], 0.7);
  s.begin('head', r.head);
  s.region = REGION.head;
  let tipX = 0.4 * H + sn, tipY = -0.2 * cH, tipH = 0.5 * cH;
  const es = graph.phenotype ? graph.phenotype.dimensions.earLength / (H * (r.head === 'proboscis' ? PROBOSCIS_EAR.length : .34)) : tr.earScale;
  if (r.head === 'proboscis') {
    // elephant/tapir face (fauna-composer-face-geometry-1): a high-domed cranium and a short, deep muzzle that ends in a
    // round section and hands over into the trunk without a cap; its last stations pitch down toward the trunk
    const tip = composerFaceTip('proboscis', {headLength: H, craniumWidth: cW, craniumHeight: cH, snoutLength: sn});
    const trunk0 = graph.chains.trunk[0], len = tip.x - 0.4 * H;
    const joinW: W = trunk0 !== undefined ? [[hb.index, 0.7], [trunk0, 0.3]] : w;
    const rings = [first(), station(0.36 * H, 0.92 * cW, 0.9 * cH, -0.04 * cH)];
    // square stations (see PROBOSCIS_FACE) whose centre and section ease (quartic) into the tip section: the last
    // muzzle segment runs parallel to the head axis, which is the trunk's first bone, so the two meet tangent-continuous
    const n = 4;
    for (let i = 1; i <= n; i++) {
      const f = i / n, e = 1 - (1 - f) ** 4, ring = station(0.4 * H + len * f, mix(0.84 * cW, tip.w, e), mix(0.86 * cH, tip.h, e), mix(-0.06 * cH, tip.y, e));
      if (i === n) ring.w = joinW;
      rings.push(ring);
    }
    loft(s, rings, seg, 0.2, trunk0 !== undefined ? 0 : 0.45, 1);
    // the open end is closed by a flat disc hidden inside the joined muzzle and trunk (each part stays a closed surface)
    if (trunk0 !== undefined) { trunkJoin = rings[rings.length - 1]!; capFlat(s, trunkJoin, seg, 1, HIDDEN_DISC_INSET); }
    tipX = tip.x; tipY = tip.y; tipH = tip.h;
    // flap ears: thin, broad and set low on the side of the cranium, flaring backward-outward beside the thick neck.
    // skin EC4: an elephant ear rather than an ellipse (GPT Luna 6: "the ears look like flat, dark discs", "detached"):
    // a thick root seated in the side of the cranium, a sheet that runs back from it, widens and hangs a deeper lower
    // lobe, bowed outward and thinning toward its free rim (proboscisEar)
    s.begin('head', `${r.head} ears`);
    s.region = REGION.ear;
    for (const side of es > 0 ? [-1, 1] : []) {
      const back = PROBOSCIS_EAR.flare * Math.PI / 180, e1 = ax.clone().multiplyScalar(Math.cos(back)).addScaledVector(az, -side * Math.sin(back)).normalize();
      const out = az.clone().multiplyScalar(side * Math.cos(back)).addScaledVector(ax, Math.sin(back)).normalize();
      const root = at(hb, 0.02 * H, 0.4 * cH, side * 0.9 * cW).addScaledVector(e1, 0.06 * H * es).addScaledVector(ay, -0.1 * H * es).addScaledVector(out, -0.02 * H * es);
      proboscisEar(s, root, e1.clone().negate(), ay, out, H * es, w, (f, p) => mixC(coatAt(p, 0.4, 'ear', f), pal.skin, 0.2));
    }
    // the lower lip under the trunk base (its own 'mouth' part)
    s.begin('mouth', 'lower lip');
    s.region = REGION.muzzle;
    ellipsoid(s, at(hb, tip.x - 0.05 * H, tip.y - tip.h + 0.02 * cH, 0), [ax, ay, az], [0.12 * H, 0.08 * cH, 0.28 * cW], w, () => mixC(pal.skin, [0, 0, 0], 0.45), 8, 4);
  } else if (skull === 'muzzle' || skull === 'jaws') {
    const jaws = skull === 'jaws', flatten = jaws ? 0.82 : 1;
    const rings = [first(), station(0.36 * H, 0.92 * cW, 0.88 * cH * flatten, -0.06 * cH)];
    const n = 4;
    for (let i = 1; i <= n; i++) {
      const f = i / n, x = 0.4 * H + sn * f, sw = mix(0.8, jaws ? 0.5 : 0.48, f) * cW, sh = mix(0.82, jaws ? 0.36 : 0.52, f) * cH, base = hc.col(x, sw, sh);
      const mouth = (a: number, p: THREE.Vector3): RGB => { const c = base(a, p); const line = Math.abs(Math.sin(a) + (jaws ? 0.25 : 0.35)) < (jaws ? 0.07 : 0.05) && Math.abs(Math.cos(a)) > 0.5; return line ? pal.keratin : jaws ? c : f > 0.75 ? mixC(c, pal.skin, 0.6) : c; };
      rings.push(station(x, sw, sh, mix(-0.08, jaws ? -0.12 : -0.24, f) * cH, mouth));
    }
    const capFrom = s.ni / 3;
    loft(s, rings, seg, 0.2, jaws ? 0.55 : 0.45, 1);
    tipY = (jaws ? -0.12 : -0.24) * cH; tipH = (jaws ? 0.36 : 0.52) * cH;
    s.region = REGION.muzzle;
    // nostrils seated on the rounded muzzle cap: each stands NOSTRIL_PROUD x H proud of the cap surface found along
    // the head axis (they used to sit 0.02 H ahead of the tip station, i.e. buried inside the cap)
    if (!jaws) {
      const cap = headLocalTriangles(s, hb, capFrom, s.ni / 3);
      s.begin('head', `${r.head} nostrils`);
      s.region = REGION.muzzle;
      for (const side of [-1, 1]) {
        const ny = tipY + 0.15 * cH, nz = side * 0.18 * cW, hit = raycastFirstHit(cap, [tipX, ny, nz], [1, 0, 0]);
        const nx = (hit ? hit.point[0] : tipX + 0.035 * H) - 0.03 * H + NOSTRIL_PROUD * H;
        ellipsoid(s, at(hb, nx, ny, nz), [ax, ay, az], [0.03 * H, 0.06 * cH, 0.06 * cW], w, () => nose, 6, 3);
      }
    }
    if (jaws) for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
      const f = 0.15 + 0.13 * k, x = 0.4 * H + sn * f, sw = mix(0.8, 0.5, f) * cW * 0.93, y = mix(-0.08, -0.12, f) * cH - mix(0.82, 0.36, f) * cH * 0.25;
      tube(s, [at(hb, x, y, side * sw), at(hb, x + 0.01 * H, y - 0.07 * cH, side * sw * 0.97)], [0.028 * cH, 0.004 * cH], [w, w], () => [0.92, 0.9, 0.82], 5, 0.2, 0.1);
    }
    if (!jaws) {
      // ears are always built; with horns or ossicones they move lower, back and outward, clear of the horn roots
      const horned = hg.built === 'ossicones' || hg.built === 'paired';
      s.begin('head', `${r.head} ears`);
      s.region = REGION.ear;
      for (const side of es > 0 ? [-1, 1] : []) {
        const base = horned ? at(hb, -0.06 * H, 0.55 * cH, side * 0.62 * cW) : at(hb, 0.04 * H, 0.75 * cH, side * 0.55 * cW);
        const dir = horned ? ay.clone().multiplyScalar(0.45).addScaledVector(az, side * 0.85).addScaledVector(ax, -0.25).normalize() : ay.clone().multiplyScalar(0.8).addScaledVector(az, side * 0.6).addScaledVector(ax, -0.25).normalize();
        ellipsoid(s, base.clone().addScaledVector(dir, 0.16 * H * es), [dir, ax.clone().negate(), az], [0.18 * H * es, 0.03 * H * es, 0.09 * H * es], w, (_a, f, p) => mixC(coatAt(p, 0.4, 'ear', f), pal.skin, 0.25), 8, 4);
      }
    }
  } else if (skull === 'beak') {
    loft(s, [first(), station(0.4 * H, 0.62 * cW, 0.66 * cH, 0.02 * cH)], seg, 0.2, 0.3, 1);
    const len = Math.max(sn, 0.15 * H), n = 6, upper: Ring[] = [], lower: Ring[] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = 0.36 * H + len * f, hook = len < 0.35 * H ? smooth(0.6, 1, f) * 0.18 : 0;
      upper.push(station(x, mix(0.55, 0.06, Math.pow(f, 0.8)) * cW, mix(0.42, 0.05, Math.pow(f, 0.9)) * cH, (0.08 - 0.12 * f - hook) * cH, () => pal.keratin));
      if (f <= 0.85) lower.push(station(x, mix(0.45, 0.08, f / 0.85) * cW, mix(0.22, 0.04, f / 0.85) * cH, (-0.3 - 0.02 * f) * cH, () => mixC(pal.keratin, [0, 0, 0], 0.25)));
    }
    s.region = REGION.muzzle;
    for (const rg of [...upper, ...lower]) rg.region = REGION.muzzle;
    loft(s, upper, 12, 0.2, 0.3); loft(s, lower, 10, 0.2, 0.3);
    tipX = 0.36 * H + len; tipY = -0.05 * cH; tipH = 0.1 * cH;
  } else if (skull === 'flat-face') {
    const skinBelow = (base: (a: number, p: THREE.Vector3) => RGB) => (a: number, p: THREE.Vector3) => Math.sin(a) < 0.2 ? pal.skin : base(a, p);
    loft(s, [first(), station(0.4 * H, 0.86 * cW, 0.86 * cH, -0.02 * cH, skinBelow(hc.col(0.4 * H, 0.86 * cW, 0.86 * cH))), station(0.48 * H, 0.55 * cW, 0.5 * cH, -0.1 * cH, () => pal.skin)], seg, 0.2, 0.45, 1);
    const len = Math.max(0.05 * H, sn * 0.6);
    // lower face: bare skin with a darker mouth line across its lower front (the cap rings carry it over the front)
    const lowerFace = (a: number): RGB => Math.abs(Math.sin(a) + 0.38) < 0.07 ? scaleC(pal.keratin, 0.5) : pal.skin;
    const faceFrom = s.ni / 3;
    loft(s, [station(0.36 * H, 0.55 * cW, 0.45 * cH, -0.4 * cH, lowerFace), station(0.36 * H + len, 0.42 * cW, 0.34 * cH, -0.42 * cH, lowerFace)].map(rg => ({...rg, region: REGION.muzzle})), 14, 0.3, 0.6);
    // a broad, low nose seated on the upper front of the lower face
    const faceTris = headLocalTriangles(s, hb, faceFrom, s.ni / 3), noseHit = raycastFirstHit(faceTris, [0.36 * H, -0.2 * cH, 0], [1, 0, 0]);
    s.region = REGION.muzzle;
    ellipsoid(s, at(hb, (noseHit ? noseHit.point[0] : 0.36 * H + len) - 0.02 * H, -0.2 * cH, 0), [ax, ay, az], [0.05 * H, 0.05 * cH, 0.12 * cW], w, () => scaleC(pal.skin, 0.6), 10, 3);
    s.region = REGION.head;
    // the brow ridge sits above the eyes (it used to reach down over the upper lid)
    s.begin('head', `${r.head} brow`);
    ellipsoid(s, at(hb, 0.42 * H, 0.32 * cH, 0), [ax, ay, az], [0.08 * H, 0.09 * cH, 0.9 * cW], w, () => mixC(pal.base, pal.keratin, 0.3), 12, 4);
    s.begin('head', `${r.head} ears`);
    s.region = REGION.ear;
    for (const side of [-1, 1]) ellipsoid(s, at(hb, 0.12 * H, 0, side * 0.96 * cW), [ax, ay, az], [0.08 * H * es, 0.2 * cH * es, 0.05 * cW * es], w, () => pal.skin, 8, 4);
    tipX = 0.36 * H + len; tipY = -0.42 * cH; tipH = 0.34 * cH;
  } else if (skull === 'blunt') {
    const xt = 0.6 * H + sn * 0.3, base = hc.col(xt, 0.75 * cW, 0.75 * cH);
    const capFrom = s.ni / 3;
    loft(s, [first(), station(xt, 0.75 * cW, 0.75 * cH, 0, (a, p) => mixC(base(a, p), pal.skin, 0.5))], seg, 0.2, 0.75, 1);
    // the frontal mouth disc (bare skin, not an eye), seated on the cap's front: it used to float 0.72 cW ahead of the
    // cap station, beyond the rounded cap end; now its centre sits 0.01 H inside the cap surface found along the axis
    // the disc is a thin shell draped over the cap: every vertex is cast from inside the cap along the head axis and
    // lifted MOUTH_DISC_LIFT x H along the surface normal there, so no part of it stands clear of the cap
    const capTris = headLocalTriangles(s, hb, capFrom, s.ni / 3);
    s.begin('mouth', 'mouth disc');
    s.region = REGION.muzzle;
    // dense enough (20 x 4) that a chord between disc vertices sags < 0.002 H below the convex cap
    const discRings = 4, discSeg = 20, lift = MOUTH_DISC_LIFT * H;
    const onCap = (y: number, z: number) => {
      // Neutral earlier-rule links retain their frozen skin-3 geometry. The
      // current mouth and non-neutral earlier-rule individuals use stable ties.
      if (composerEyeRulesOf(r) === 1 && tr.neutral) {
        const h = raycastFirstHit(capTris, [xt, y, z], [1, 0, 0]);
        if (!h) return at(hb, xt + 0.72 * cW + lift, y, z);
        const sg = h.normal[0] < 0 ? -1 : 1;
        return at(hb, h.point[0] + sg * h.normal[0] * lift, h.point[1] + sg * h.normal[1] * lift, h.point[2] + sg * h.normal[2] * lift);
      }
      // A generated point on the mirror plane must not inherit the lateral
      // normal of whichever seam facet wins a floating-point depth tie.
      if (Math.abs(z) < 1e-12 * H) z = 0;
      const hits = raycastLine(capTris, [xt, y, z], [1, 0, 0]).filter(h => h.t > 1e-9);
      const first = hits[0];
      const h = first ? hits.filter(h => Math.abs(h.t - first.t) <= 1e-9).sort((a, b) => a.tri - b.tri)[0] : null;
      if (!h) return at(hb, xt + 0.72 * cW + lift, y, z);
      const sg = h.normal[0] < 0 ? -1 : 1;
      return at(hb, h.point[0] + sg * h.normal[0] * lift, h.point[1] + sg * h.normal[1] * lift, z === 0 ? 0 : h.point[2] + sg * h.normal[2] * lift);
    };
    if (composerEyeRulesOf(r) === 1) {
      // the earlier eye rules keep the face round's flat dark disc (byte-identical)
      const centre = s.v(onCap(0, 0), mouthDisc, w), ringIds: number[][] = [];
      for (let k = 1; k <= discRings; k++) {
        const rr = k / discRings, ids: number[] = [];
        for (let j = 0; j < discSeg; j++) { const a = TAU * j / discSeg; ids.push(s.v(onCap(Math.sin(a) * 0.32 * cH * rr, Math.cos(a) * 0.32 * cW * rr), mouthDisc, w)); }
        ringIds.push(ids);
      }
      for (let j = 0; j < discSeg; j++) s.to(centre, ringIds[0]![j]!, ringIds[0]![(j + 1) % discSeg]!, ax);
      for (let k = 0; k + 1 < discRings; k++) for (let j = 0; j < discSeg; j++) {
        const a = ringIds[k]![j]!, b = ringIds[k]![(j + 1) % discSeg]!, c = ringIds[k + 1]![j]!, e = ringIds[k + 1]![(j + 1) % discSeg]!;
        s.to(a, c, b, ax); s.to(b, c, e, ax);
      }
    } else {
      // the current eye rules (fauna-composer-eye-2): a closed mouth, not a disc; see MOUTH_SLIT
      const M = MOUTH_SLIT, zw = M.halfWidth * cW, cols = M.columns, ids: number[][] = [];
      const capColour = (y: number, p: THREE.Vector3) => mixC(base(Math.asin(clamp(y / (0.75 * cH), -1, 1)), p), pal.skin, 0.5);
      const vertex = (y: number, z: number, row: number, open: number) => {
        const p = onCap(y, z);
        return s.v(p, mouthSlitColour(capColour(y, p), row, open), w);
      };
      const endL = vertex(M.y * cH, -zw, 0, 0), endR = vertex(M.y * cH, zw, 0, 0);
      for (let i = 1; i < cols; i++) {
        const u = 2 * i / cols - 1, open = Math.sqrt(1 - u * u), z = u * zw, yc = (M.y - M.droop * open) * cH, hh = M.halfHeight * cH * open;
        ids.push(M.rows.map((t, row) => vertex(yc + t * hh, z, row, open)));
      }
      const R = M.rows.length;
      for (let row = 0; row + 1 < R; row++) {
        s.to(endL, ids[0]![row]!, ids[0]![row + 1]!, ax);
        s.to(endR, ids[cols - 2]![row]!, ids[cols - 2]![row + 1]!, ax);
        for (let i = 0; i + 1 < cols - 1; i++) {
          const a = ids[i]![row]!, b = ids[i]![row + 1]!, c = ids[i + 1]![row]!, e = ids[i + 1]![row + 1]!;
          s.to(a, c, b, ax); s.to(b, c, e, ax);
        }
      }
    }
    tipX = 0.6 * H + sn * 0.3 + 0.7 * cW; tipY = 0; tipH = 0.5 * cH;
  } else {
    // mandibles: arthropod head capsule with antennae and pincer mouthparts
    loft(s, [first(), station(0.3 * H, cW, cH, 0), station(0.75 * H, 0.8 * cW, 0.75 * cH, -0.1 * cH)], seg, 0.2, 0.5, 1);
    const len = Math.max(0.25 * H, sn * 1.1);
    for (const side of [-1, 1]) {
      const pts = [0, 0.35, 0.7, 1].map(f => at(hb, 0.72 * H + len * f, -0.25 * cH, side * mix(0.55, 0.05, f * f) * cW));
      s.region = REGION.muzzle;
      tube(s, pts, [0.16 * cW, 0.12 * cW, 0.08 * cW, 0.01 * cW], pts.map(() => w), () => pal.keratin, 7, 0.3, 0.1, 0.7);
      const ant = [0, 0.25, 0.5, 0.75, 1].map(f => at(hb, 0.6 * H + 1.5 * H * f, 0.45 * cH + 0.8 * H * f * (1 - 0.4 * f), side * (0.4 * cW + 0.55 * H * f)));
      s.region = REGION.ear;
      tube(s, ant, [0.07, 0.06, 0.05, 0.04, 0.02].map(x => x * cW * tr.earScale), ant.map(() => w), (i) => i % 2 ? pal.accent : pal.keratin, 5, 0.2, 0.2);
    }
    tipX = 0.72 * H + len; tipY = -0.25 * cH; tipH = 0.3 * cH;
  }
  s.end();
  buildEyes(s, graph, hb, pal, at, hc, ind, coatAt, eyeCtx, firstPart);
  // horns: length x hornScale, curl rotated by hornCurl, left/right x (1 +- hornAsym). Only the headgear the face
  // carries is built (FACE_HEADGEAR); an omitted kind builds exactly what 'none' builds.
  if (hg.built !== 'none') {
    const casque = hg.built === 'crest' && r.head === 'beak';
    // the head surface the casque and crest seat on (raycast down onto it, head-local), before any headgear exists
    const surface = hg.built === 'crest' ? headSurfaceTriangles(s, hb, firstPart, casque ? 'blend' : 'all') : null;
    // the first surface below a point well above the skull; for the crest a hit outside 0.3..1.2 cH (e.g. the back
    // behind a short neck) is not the skull and keeps the fallback height (the casque also rides the low culmen)
    const lowest = casque ? -0.5 * cH : 0.3 * cH;
    const topAt = (x: number, fallback: number) => { const h = surface && raycastFirstHit(surface, [x, 2 * cH, 0], [0, -1, 0]); return h && h.point[1] >= lowest && h.point[1] <= 1.2 * cH ? h.point[1] : fallback; };
    s.begin('horn', casque ? 'casque' : hg.built);
    s.region = REGION.horn;
    const pairedLength = Math.hypot(.05 * H, .25 * cH, .3 * cW) + Math.hypot(.12 * H, .3 * cH, .3 * cW) + Math.hypot(.03 * H, .5 * cH, .05 * cW) + Math.hypot(.1 * H, .35 * cH, .2 * cW);
    const hs = graph.phenotype && hg.built === 'paired' ? graph.phenotype.dimensions.hornLength / pairedLength : tr.hornScale, curl = tr.hornCurl, asym = tr.hornAsym, thick = 0.5 + 0.5 * hs;
    const hornCol = (i: number, n: number, p: THREE.Vector3) => mixC(coatAt(p, 1, 'horn', i / n), pal.keratin, 0.35 + 0.65 * i / n);
    const curled = (pts: THREE.Vector3[], base: THREE.Vector3, about: THREE.Vector3, angle: number) => angle === 0 ? pts : pts.map((p, i) => i === 0 ? p : p.clone().sub(base).applyAxisAngle(about, angle * i / (pts.length - 1)).add(base));
    const grow = (pts: THREE.Vector3[], k: number) => k === 1 ? pts : pts.map((p, i) => i === 0 ? p : p.clone().sub(pts[0]!).multiplyScalar(k).add(pts[0]!));
    if (hg.built === 'nasal') {
      // a nasal horn is never built on a trunk face, so the old forehead relocation is gone
      const x0 = 0.4 * H + sn * 0.65, y0 = (skull === 'muzzle' ? -0.24 * cH * 0.65 : tipY) + tipH * 0.9 + 0.05 * cH;
      const big = 0.5 * H * hs, root = at(hb, x0, y0, 0);
      const pts = curled([0, 0.33, 0.66, 1].map(f => at(hb, x0 + big * (0.12 * f - 0.25 * f * f), y0 + big * f, 0)), root, az, -curl);
      tube(s, [at(hb, x0, y0 - 0.12 * cH, 0), ...pts], [0.15 * H, 0.14 * H, 0.1 * H, 0.05 * H, 0.008 * H].map(x => x * thick), [w, w, w, w, w], (i, _a, p) => hornCol(i, 4, p), 10, 0.2, 0.15);
      const x1 = x0 - 0.25 * H, y1 = y0 + 0.08 * cH, k2 = hs * (1 + asym);
      tube(s, [at(hb, x1, y1 - 0.1 * cH, 0), at(hb, x1 + 0.02 * H * k2, y1 + 0.12 * H * k2, 0), at(hb, x1 - 0.02 * H * k2, y1 + 0.22 * H * k2, 0)], [0.09 * H, 0.06 * H, 0.008 * H].map(x => x * (0.5 + 0.5 * k2)), [w, w, w], (i, _a, p) => hornCol(i, 2, p), 8, 0.2, 0.15);
    } else if (hg.built === 'paired') {
      for (const side of [-1, 1]) {
        // the root sits forward on the brow (0.16 H, 0.8 cH, 0.48 cW) instead of behind the cranium; the whole horn shifts
        const k = hs * (1 + side * asym), raw = [V(0.05, 0.7, 0.55), V(0.0, 0.95, 0.85), V(-0.12, 1.25, 1.15), V(-0.15, 1.75, 1.2), V(-0.05, 2.1, 1.0)].map(p => at(hb, (p.x + PAIRED_ROOT_SHIFT[0]) * H, (p.y + PAIRED_ROOT_SHIFT[1]) * cH, side * (p.z + PAIRED_ROOT_SHIFT[2]) * cW));
        const pts = curled(grow(raw, k), raw[0]!, az, -curl * side);
        tube(s, pts, [0.1 * H, 0.08 * H, 0.06 * H, 0.035 * H, 0.006 * H].map(x => x * (0.5 + 0.5 * k)), pts.map(() => w), (i, _a, p) => hornCol(i, 4, p), 9, 0.2, 0.15);
      }
    } else if (hg.built === 'ossicones') {
      for (const side of [-1, 1]) {
        const k = hs * (1 + side * asym), base = at(hb, 0.02 * H, 0.8 * cH, side * 0.35 * cW);
        const [, top] = curled(grow([base, at(hb, -0.03 * H, 0.8 * cH + 0.32 * H, side * 0.42 * cW)], k), base, az, -curl);
        tube(s, [base, top!], [0.055 * H, 0.045 * H].map(x => x * (0.5 + 0.5 * k)), [w, w], (_i, a, p) => mixC(coatAt(p, Math.sin(a), 'head', 0.2), pal.accent, 0.3), 9, 0.2, 0.2);
        ellipsoid(s, top!, [ax, ay, az], [0.06 * H, 0.06 * H, 0.06 * H].map(x => x * (0.5 + 0.5 * k)) as [number, number, number], w, () => pal.keratin, 8, 4);
      }
    } else if (casque) {
      // hornbill/cassowary casque: a keratin helmet riding the culmen from the forehead onto the base of the bill
      // (low and long: a helmet over the bill, not a blade standing on it)
      const len = Math.max(sn, 0.15 * H), x0 = 0.26 * H, x1 = 0.36 * H + 0.6 * len, hMax = Math.max(0.5 * cH, 0.25 * H) * hs * 0.32, sink = 0.04 * cH;
      const col = mixC(pal.horn, pal.accent, 0.25), profile = [0.45, 1, 0.8, 0.3], width = [0.24, 0.3, 0.26, 0.14], rings: Ring[] = [];
      profile.forEach((k, i) => {
        const x = mix(x0, x1, i / 3), bottom = topAt(x, 0.5 * cH) - sink, ry = (hMax * k + sink) / 2;
        rings.push({c: at(hb, x, bottom + ry, 0), t: ax, u: ay, rx: width[i]! * cW, ry, w, color: () => col, region: REGION.horn});
      });
      loft(s, rings, 8, 0.3, 0.3);
    } else if (hg.built === 'crest') {
      // jaws crest: a fin with real thickness, seated on the skull along its outline (it used to float as a thin slab)
      const crestH = Math.max(0.5 * cH, 0.25 * H) * hs, outline: [number, number][] = [[-0.12, 0.15], [0.05, 0.9], [0.22, 1], [0.42, 0.45], [0.5, 0.15]];
      const rings: Ring[] = outline.map(([fx, k]) => {
        const x = fx * H, base = topAt(x, 0.72 * cH) - CREST_SINK * H, ry = (crestH * k + CREST_SINK * H) / 2;
        return {c: at(hb, x, base + ry, 0), t: ax, u: ay, rx: CREST_HALF_THICKNESS * cW, ry, w, color: (a: number) => mixC(pal.accent, pal.plate, 0.6 * clamp(0.5 + 0.5 * Math.sin(a), 0, 1) * k), region: REGION.horn};
      });
      loft(s, rings, 8, 0.3, 0.3);
    }
    s.end();
  }
  return trunkJoin;
}
/** The trunk's section and orientation ease from the muzzle's last station over this many station radii. */
export const TRUNK_JOIN_BLEND = 1.2;
/** skin-5: the join curve's start tangent length (x its chord): above 1 the curve holds the muzzle axis a little longer,
 * so its turn peaks mid-join instead of at the muzzle (max ring turn 8.3 -> 7.4 deg on the trunked centipede). */
export const TRUNK_JOIN_LEAD = 1.3;
/** skin-5: past the join reach, trunk rings are spread by arc length plus turn (one TRUNK_RESPACE_TURN of turn
 * counts like a mean ring spacing of length), so a curled trunk end gets rings from its straight run, same count. */
export const TRUNK_RESPACE_TURN = 2 * Math.PI / 180;
/** skin-5: in that respacing a section radius change by this log ratio counts at least like one mean spacing, so the
 * rings leaving a straight but tapering run keep consecutive radius steps small. */
export const TRUNK_RESPACE_TAPER = Math.log(1.08);
/** The trunk keeps the muzzle's radial count for this many join radii before it zips down to 12 segments. */
export const TRUNK_ZIP_LENGTH = 0.5;
/** Trunk radial segments (skin EC4; 12 before: Luna saw "visible flat facets on the trunk"). */
export const TRUNK_RADIAL = 16;
/** Rim inset of the two hidden discs closing the muzzle and the trunk at their shared junction ring (skin EC4). */
export const HIDDEN_DISC_INSET = 0.96;
/** Trunk wrinkle shading: [accent mix, wrinkles along the trunk] (skin EC4; face round 0.18 x 4 bands). */
export const TRUNK_WRINKLE = [0.08, 6] as const;
/** Proboscis flap ears (skin EC4; the face round built a 14 x 4 ellipsoid flared 30 degrees): `flare` degrees out from
 * the head axis, `length` back from the root, the sheet's upper and lower edge (`top`, `lobe`: a deeper lower lobe toward
 * the back), its half thickness from `root` at the front to `rim`, the outward bow, and the tessellation (`segments`
 * around the thin section, `stations` along the ear). Units: head length x earScale. */
export const PROBOSCIS_EAR = Object.freeze({flare: 22, length: 0.44, top: 0.15, lobe: 0.3, root: 0.05, rim: 0.012, bow: 0.035, segments: 12, stations: 10});
function proboscisEar(s: Skin, root: THREE.Vector3, back: THREE.Vector3, up: THREE.Vector3, out: THREE.Vector3, unit: number, w: W, color: (f: number, p: THREE.Vector3) => RGB) {
  const E = PROBOSCIS_EAR, rings: Ring[] = [];
  // sin(pi x)^p with a fractional p is NaN for a sin a hair below 0. At the rim station (f = 1) the argument is pi x 1:
  // every libm returns pow(1, 0.75) = 1 and sin(Math.PI) = +1.2e-16, but a pow(1, 0.75) one ulp above 1 (ECMA-262
  // leaves it implementation-approximated) gives a negative sine and a NaN rim ring (the trunked-centipede skin record
  // that moved under the 1-ULP perturbation test, docs/fauna-composer-stability-2026-10-07.md). Clamped at 0: the
  // value is unchanged wherever the sine is not negative.
  const arch = (x: number, p: number) => Math.pow(Math.max(0, Math.sin(Math.PI * x)), p);
  for (let i = 0; i <= E.stations; i++) {
    const f = i / E.stations, bulge = arch(Math.min(1, 0.08 + 0.92 * f), 0.6);
    const top = (0.035 + E.top * arch(Math.min(1, f * 1.15), 0.7)) * Math.max(0, 1 - Math.pow(f, 6));
    const bottom = -(0.035 + E.lobe * arch(Math.pow(f, 0.75), 0.8)) * Math.max(0, 1 - Math.pow(f, 6));
    const half = Math.max(0.004, (top - bottom) / 2), thick = E.rim + (E.root - E.rim) * Math.pow(1 - f, 3);
    const c = root.clone().addScaledVector(back, E.length * f * unit).addScaledVector(up, (top + bottom) / 2 * unit).addScaledVector(out, E.bow * bulge * unit);
    rings.push({c, t: back, u: up, rx: Math.min(thick, half) * unit, ry: half * unit, w, color: (_a, p) => color(f, p)});
  }
  loft(s, rings, E.segments, 0.3, 0.3);
}
/** The trunk's nostril end (skin EC4), in units of the last trunk ring's radius r, along the last bone's axis from the
 * ring: a bulbous lip (`bulb`: [forward, radius] stations, widest `flare`) mottled pale pink, rolling in to the end face
 * at `faceAt` (its radius `face` x r),
 * two nostrils (half axes `nostril` x r, `nostrilTall` taller than wide, `nostrilZ` x r either side of the middle) on
 * that face, and a dorsal finger (an elephant's prehensile lip; `finger` = [forward, up, half length, half height,
 * half width]). Everything stays within COMPOSER_TRUNK_TIP_CLEARANCE end radii of the bone end, which the rig keeps
 * above the ground. GPT Luna 6 on the face-round tip: "The tip looks blunt and capped. A nostril or lip detail is too
 * small to make out." A pale pink lip (lipMix 0.4) then read as "a small, plain-looking cap" (luna/after-trunk.txt): the lip is
 * now the plain coat, the end swells gently (a steep flare caught the light as a pale ring), the end face is darkened by
 * `faceDark` and the nostrils are larger. skin-5 (coat crisp v1, metric d3): the end rolls in over two rings past the
 * widest (1.04 and 0.9 r) to a flat face of 0.62 r (was 0.86 r behind a 1.06 r ring, a flat-cap ratio of 0.78 that read
 * as a cap); the nostrils sit closer together (0.3 r, half width 0.22 r) to stay on the smaller face. */
export const TRUNK_TIP = Object.freeze({bulb: [[0.16, 1.05], [0.3, 1.1], [0.42, 1.04], [0.51, 0.9]] as readonly (readonly number[])[], flare: 1.1, faceAt: 0.56, face: 0.62, nostril: 0.22, nostrilTall: 1.35, nostrilZ: 0.3, nostrilY: 0.02,
  finger: [0.38, 0.8, 0.36, 0.26, 0.3] as readonly number[], lipTone: [0.66, 0.52, 0.48] as readonly number[], lipMix: 0, faceDark: 0.35});
function buildTrunkTip(s: Skin, last: Ring, tip: ComposerBone, pal: Palette, at: At, axis: Axis, coat: (p: THREE.Vector3, dorsal: number) => RGB) {
  const K = TRUNK_TIP, r = Math.max(last.rx, last.ry), tx = axis(tip, 1, 0, 0), ty = axis(tip, 0, 1, 0), tz = axis(tip, 0, 0, 1), w: W = [[tip.index, 1]];
  const c0 = at(tip, tip.length);
  // the lip and finger: the trunk's own coat, mottled toward a pale pink (an elephant's trunk end is bare, paler skin)
  const rim = (a: number, p: THREE.Vector3) => mixC(coat(p, Math.sin(a)), K.lipTone as RGB, K.lipMix);
  const faceCol = mixC(mixC(pal.skin, [0.62, 0.48, 0.45], 0.3), [0, 0, 0], K.faceDark);
  const ring = (dx: number, k: number, color: (a: number, p: THREE.Vector3) => RGB): Ring => ({c: c0.clone().addScaledVector(tx, dx * r), t: tx, u: ty, rx: k * r, ry: k * r, w, color});
  // the trunk loft's last ring (same centre, basis and radius, re-emitted with its own colours), the flared lip rim, its
  // rolled edge and the end face, closed by a flat disc
  const end = {...last, w};
  const lip = [end, ...K.bulb.map(([x, k]) => ring(x!, k!, (a, p) => mixC(coat(p, Math.sin(a)), K.lipTone as RGB, K.lipMix * Math.min(1, x! / K.bulb[1]![0]!)))), ring(K.faceAt, K.face, () => faceCol)];
  loft(s, lip, TRUNK_RADIAL, 0, 0);
  capFlat(s, lip[lip.length - 1]!, TRUNK_RADIAL, 1);
  // two nostrils: dark ovals standing just proud of the end face, closed behind
  const pit = scaleC(pal.skin, 0.1), faceC = c0.clone().addScaledVector(tx, K.faceAt * r);
  for (const side of [-1, 1]) {
    const c = faceC.clone().addScaledVector(tz, side * K.nostrilZ * r).addScaledVector(ty, K.nostrilY * r), ids: number[] = [];
    for (let k = 0; k < 8; k++) { const a = TAU * k / 8; ids.push(s.v(c.clone().addScaledVector(ty, Math.cos(a) * K.nostril * K.nostrilTall * r).addScaledVector(tz, Math.sin(a) * K.nostril * r).addScaledVector(tx, 0.012 * r), pit, w)); }
    const front = s.v(c.clone().addScaledVector(tx, 0.012 * r), pit, w), back = s.v(c.clone().addScaledVector(tx, -0.02 * r), pit, w);
    for (let k = 0; k < 8; k++) { s.to(front, ids[k]!, ids[(k + 1) % 8]!, tx); s.to(back, ids[k]!, ids[(k + 1) % 8]!, tx.clone().negate()); }
  }
  // the dorsal finger on the upper rim
  const [fx, fy, fl, fh, fw] = K.finger as [number, number, number, number, number];
  ellipsoid(s, c0.clone().addScaledVector(tx, fx * r).addScaledVector(ty, fy * r), [tx, ty, tz], [fl * r, fh * r, fw * r], w, (a, _f, p) => rim(a, p), 10, 5);
}
/** Muzzle nostrils stand this far (x H) proud of the muzzle cap; the worm's mouth disc lies this far (x H) off its cap. */
export const NOSTRIL_PROUD = 0.012;
export const MOUTH_DISC_LIFT = 0.0035;
/** Paired horns: root shift from the pre-face-geometry root (0.05 H, 0.7 cH, 0.55 cW) to (0.16 H, 0.8 cH, 0.48 cW). */
const PAIRED_ROOT_SHIFT = [0.11, 0.1, -0.07] as const;
/** Jaws crest fin: half thickness (x cW) and how far its base sinks into the skull (x H). */
export const CREST_HALF_THICKNESS = 0.09;
const CREST_SINK = 0.01;
/** The built head surface in head-local space: the head parts from `firstPart` on (ears excluded) plus the torso
 * triangles with a vertex weighted to the head bone (neck 'blend', the neck-to-head blend) or all of them ('all'). */
function headSurfaceTriangles(s: Skin, hb: ComposerBone, firstPart: number, neck: 'blend' | 'all'): Float64Array {
  const q = new THREE.Quaternion(...hb.restQuaternion).invert(), P0 = V(...hb.restPosition), tmp = V(), out: number[] = [];
  const headWeighted = (v: number) => { for (let k = 0; k < 4; k++) if (s.si[v * 4 + k] === hb.index && s.sw[v * 4 + k]! > 0) return true; return false; };
  s.parts.forEach((part, i) => {
    const own = i >= firstPart;
    if (own ? part.part !== 'head' || part.label.endsWith('ears') : part.part !== 'torso') return;
    for (let t = part.firstTriangle * 3; t < (part.firstTriangle + part.triangles) * 3; t += 3) {
      if (!own && neck === 'blend' && !headWeighted(s.ix[t]!) && !headWeighted(s.ix[t + 1]!) && !headWeighted(s.ix[t + 2]!)) continue;
      for (let k = 0; k < 3; k++) { const v = s.ix[t + k]!; tmp.set(s.p[v * 3]!, s.p[v * 3 + 1]!, s.p[v * 3 + 2]!).sub(P0).applyQuaternion(q); out.push(tmp.x, tmp.y, tmp.z); }
    }
  });
  return new Float64Array(out);
}

/** The blunt face's mouth under the current eye rules (fauna-composer-eye-2): a CLOSED mouth drawn on the cap, a
 * lens-shaped patch of `columns` columns (two end points) x `rows`, draped on the cap like the old disc. The face
 * round's flat dark disc, a dark-centred radial gradient, a pale-lipped radial pucker and a slit painted on the radial
 * disc all read as a hole or a sucker (GPT Luna 6, face round: "a large dark circular ... opening ... hole"; EC2
 * review: "nearly black center and heavy circular rim suggest an opening"; EC2 r21: "a recessed hole or sucker ...
 * thick raised rim ... radial pattern"; r22/r23: a dark-red line on the lens read as "a slit or shallow hole"). The
 * patch's edge is the cap's own colour (it melts into the cap); inside, pale pink lips either side of a pink lip line
 * that tapers to the corners. Nothing in it is darker than the cap (`floor`), and the lips are paler (`lipFloor`). Sizes: x craniumWidth (half width) and x craniumHeight (centre y, droop, half height). */
export const MOUTH_SLIT = Object.freeze({
  halfWidth: 0.3, y: -0.04, droop: 0.06, halfHeight: 0.07, columns: 12,
  rows: [1, 0.45, 0, -0.45, -1] as readonly number[],
  slit: [0.55, 0.16, 0.15] as RGB, toSlit: 0.6, lip: [0.85, 0.42, 0.40] as RGB, toLip: 0.55,
  /** luminance floors relative to the cap: the line at least 0.85 x the cap, the lips at least the cap */
  floor: 0.85, lipFloor: 1.0,
});
function mouthSlitColour(cap: RGB, row: number, open: number): RGB {
  const M = MOUTH_SLIT, edge = row === 0 || row === M.rows.length - 1, line = M.rows[row] === 0;
  if (edge) return cap;
  const c = line ? mixC(cap, M.slit, M.toSlit * Math.sqrt(open)) : mixC(cap, M.lip, M.toLip * open);
  const want = (line ? M.floor : 1 + (M.lipFloor - 1) * open) * luminance(cap), have = luminance(c);
  return have < want && have > 0 ? scaleC(c, want / have) : c;
}

/** Head-local anchor of each lidded eye per skull (the pre-WP4 fixed eye sites, x and y in head units). */
function eyeAnchor(skull: ComposerSkull, H: number, cH: number, cW: number): [number, number, number] {
  return skull === 'beak' ? [0.2 * H, 0.3 * cH, 0.86 * cW] : skull === 'flat-face' ? [0.43 * H, 0.06 * cH, 0.42 * cW] : skull === 'jaws' ? [0.24 * H, 0.52 * cH, 0.72 * cW] : [0.3 * H, 0.38 * cH, 0.8 * cW];
}
/** Gaze pitch above the head's long axis for lidded and compound eyes, degrees. */
export const COMPOSER_EYE_PITCH_DEG = 5;
/** Eyespots sit on the upper front of a worm's cap. */
export const COMPOSER_EYESPOT_PITCH_DEG = 35;

/** The eyes (fauna-composer-eye-1): seated on the already-built head part along each face's gaze, coloured by role.
 * Everything here goes into one 'eyes' part; nothing outside it carries the eye or iris colour. */
function buildEyes(s: Skin, graph: ComposerGraph, hb: ComposerBone, pal: Palette, at: At, hc: ReturnType<typeof makeHeadColours>, ind: SkinIndividual, coatAt: CoatAt, ctx: EyeContext, firstPart: number) {
  const r = graph.recipe, d = graph.dims, H = d.headLength, cW = d.craniumWidth, cH = d.craniumHeight, sn = d.snoutLength, tr = ind.traits;
  const skull = composerSkullOf(r.head);
  const eyes = resolveComposerEyes({...r, bodyLength: ctx.speciesBodyLength});
  const sizeK = tr.eyeScale * tr.allometry.eyeRel;
  // the built head part (ears excluded) in head-local space: the surface the eyes are seated on
  const q = new THREE.Quaternion(...hb.restQuaternion), qInv = q.clone().invert(), P0 = V(...hb.restPosition), tmp = V();
  const tris: number[] = [], triVerts: number[] = [];
  // plus the torso's neck-to-head blend triangles (any vertex weighted to the head bone), where a rear eye rim lands
  const headWeighted = (v: number) => { for (let k = 0; k < 4; k++) if (s.si[v * 4 + k] === hb.index && s.sw[v * 4 + k]! > 0) return true; return false; };
  for (const part of s.parts) {
    const own = s.parts.indexOf(part) >= firstPart;
    if (own ? part.part !== 'head' || part.label.endsWith('ears') : part.part !== 'torso') continue;
    for (let i = part.firstTriangle * 3; i < (part.firstTriangle + part.triangles) * 3; i += 3) {
      if (!own && !headWeighted(s.ix[i]!) && !headWeighted(s.ix[i + 1]!) && !headWeighted(s.ix[i + 2]!)) continue;
      for (let k = 0; k < 3; k++) {
        const v = s.ix[i + k]!; tmp.set(s.p[v * 3]!, s.p[v * 3 + 1]!, s.p[v * 3 + 2]!).sub(P0).applyQuaternion(qInv);
        tris.push(tmp.x, tmp.y, tmp.z); triVerts.push(v);
      }
    }
  }
  const headTris = new Float64Array(tris);
  const toModel = (x: number, y: number, z: number) => at(hb, x, y, z);
  const wu = V(0, 1, 0).applyQuaternion(qInv), worldUp: EyeVec3 = [wu.x, wu.y, wu.z];
  /** the head skin's own colour under a surface hit (barycentric), so the orbit ring blends exactly */
  const surfaceColour = (hit: RayHit): RGB => {
    const i = hit.tri * 3, w0 = 1 - hit.u - hit.v, a = triVerts[i]! * 3, b = triVerts[i + 1]! * 3, c = triVerts[i + 2]! * 3;
    return [0, 1, 2].map(k => w0 * s.c[a + k]! + hit.u * s.c[b + k]! + hit.v * s.c[c + k]!) as RGB;
  };
  /** How far the head's SMOOTH surface (Phong tessellation over area-weighted vertex normals, the normals the renderer
   * shades the skin with) stands above a hit on its flat facet, measured along `dir`. A decal draped on the flat facets
   * is shaded flat while the skin around it is shaded smooth, so it reads as a raised sticker; draped on the smooth
   * surface it shades like the skin. Vertex normals are built on first use. */
  let vertexNormals: Map<number, EyeVec3> | null = null;
  const smoothOffset = (hit: RayHit, dir: EyeVec3): number => {
    if (!vertexNormals) {
      vertexNormals = new Map();
      for (let t = 0; t + 8 < headTris.length; t += 9) {
        const ux = headTris[t + 3]! - headTris[t]!, uy = headTris[t + 4]! - headTris[t + 1]!, uz = headTris[t + 5]! - headTris[t + 2]!;
        const vx = headTris[t + 6]! - headTris[t]!, vy = headTris[t + 7]! - headTris[t + 1]!, vz = headTris[t + 8]! - headTris[t + 2]!;
        const n: EyeVec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        for (let k = 0; k < 3; k++) { const v = triVerts[t / 3 + k]!, m = vertexNormals.get(v) ?? [0, 0, 0]; vertexNormals.set(v, [m[0] + n[0], m[1] + n[1], m[2] + n[2]]); }
      }
      for (const [v, n] of vertexNormals) vertexNormals.set(v, normalize3(n));
    }
    const i = hit.tri * 3, w = [1 - hit.u - hit.v, hit.u, hit.v], p = hit.point;
    let off = 0;
    for (let k = 0; k < 3; k++) {
      const n = vertexNormals.get(triVerts[i + k]!)!, o = (i + k) * 3;
      const d = (p[0] - headTris[o]!) * n[0] + (p[1] - headTris[o + 1]!) * n[1] + (p[2] - headTris[o + 2]!) * n[2];
      // the projection of p onto vertex k's tangent plane is p - d n; its offset along dir is -d (n . dir)
      off += w[k]! * -d * (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]);
    }
    return Math.max(0, off);
  };
  const w = [[hb.index, 1]] as W;
  const emit = (patch: EyePatch, colours: RGB[], side: number, type: string, er: number, centre: EyeVec3, gaze: EyeVec3, surface: EyeVec3 | null) => {
    const pos: number[] = [];
    for (let k = 0; k < patch.positions.length; k += 3) { const p = toModel(patch.positions[k]!, patch.positions[k + 1]!, patch.positions[k + 2]!); pos.push(p.x, p.y, p.z); }
    const first = s.patch(pos, colours, patch.gloss, patch.index, w, REGION.eye);
    ctx.eyes.push({side, type, er, centre: [...centre], gaze: [...gaze], surface: surface ? [...surface] : null, firstVertex: first, vertexCount: colours.length, rings: patch.rings.map(x => first + x), triangles: patch.index.length / 3, rimFallbacks: patch.rimFallbacks});
  };
  // the earlier eye rules build the face round's kinds exactly as fauna-composer-eye-1 did (byte-identical); every other
  // eye (the current rules, or a catalogue kind under either rules) is the catalogue geometry (fauna-composer-eye-2)
  const legacy = eyes.rules === 1 && isFaceRoundEyeKind(eyes.kind);
  const label = legacy ? eyes.built : eyes.kind;
  s.begin('eyes', label === 'compound' ? 'compound eyes' : label === 'eyespot' ? 'eyespots' : `${label} eyes`);
  s.region = REGION.eye;
  if (!legacy) {
    buildCatalogueEyes({s, r, H, cW, cH, sn, skull, eyes, sizeK, tr, pal, hc, coatAt, ctx, headTris, worldUp, surfaceColour, smoothOffset, toModel, emit});
    s.end();
    return;
  }
  if (eyes.built === 'compound') {
    // mandibles: compound-eye domes at the old site, seated on the head capsule
    for (const side of [-1, 1]) {
      const er3: [number, number, number] = [0.07 * H * sizeK, 0.18 * cH * sizeK, 0.12 * cW * sizeK];
      const gaze = eyeGaze(eyes.gazeYawDeg, COMPOSER_EYE_PITCH_DEG, side), site: EyeVec3 = [0.45 * H, 0.35 * cH, side * 0.82 * cW];
      const hit = nearestExit(headTris, site, gaze);
      if (!hit) ctx.fallbacks++;
      const centre = hit ? addV(hit.point, gaze, -0.35 * er3[2]) : site;
      const patch = buildCompoundEye({er3, centre, gaze, up: [0, 1, 0]});
      // the facets keep the palette's eye colour unless it would vanish into the coat: then they blend toward a
      // reddish brown until they are twice as bright as the head skin at the eye (a dark dome still reads on ink)
      const site0 = hit ? surfaceColour(hit) : pal.base, floor = Math.max(COMPOUND_EYE_FLOOR.min, COMPOUND_EYE_FLOOR.overSkin * luminance(site0));
      let facet = pal.eye;
      if (luminance(facet) < floor) facet = mixC(facet, COMPOUND_EYE_FLOOR.tint, Math.min(1, (floor - luminance(facet)) / Math.max(1e-6, luminance(COMPOUND_EYE_FLOOR.tint) - luminance(facet))));
      ctx.colours.compound = facet;
      const dark = scaleC(facet, 0.3);
      const colours = [...patch.roles].map(role => role === EYE_ROLE.pseudopupil ? dark : role === EYE_ROLE['facet-a'] ? scaleC(facet, 1.08) : role === EYE_ROLE['facet-b'] ? scaleC(facet, 0.92) : facet);
      emit(patch, colours, side, 'compound', Math.max(...er3), centre, gaze, hit ? hit.point : null);
    }
  } else if (eyes.built === 'eyespot') {
    // worm: two flush pigment discs on the upper front of the cap, cast from inside the cap
    const xt = 0.6 * H + sn * 0.3, rr = 0.1 * cH * sizeK, liftH = 0.002 * H;
    for (const side of [-1, 1]) {
      const gaze = eyeGaze(eyes.gazeYawDeg, COMPOSER_EYESPOT_PITCH_DEG, side), from: EyeVec3 = [xt, 0, 0];
      const hit = raycastFirstHit(headTris, from, gaze);
      if (!hit) ctx.fallbacks++;
      const base = hit ? hit.point : addV(from, gaze, 0.7 * cW);
      const patch = buildEyespot({r: rr, centre: addV(base, gaze, liftH), normal: gaze, up: [0, 1, 0], rimLift: (_k, p) => {
        const h = nearestExit(headTris, p, gaze, 3 * rr);
        return h ? h.t + liftH : 0;
      }});
      emit(patch, [...patch.roles].map(() => pal.eye), side, 'eyespot', rr, base, gaze, hit ? hit.point : null);
    }
  } else {
    const type = eyes.built as LiddedEyeType, er = eyes.k * cH * sizeK, [ex, ey, ez] = eyeAnchor(skull, H, cH, cW);
    const built: {patch: EyePatch; side: number; centre: EyeVec3; gaze: EyeVec3; hit: RayHit | null; surf: RGB[]}[] = [];
    for (const side of [-1, 1]) {
      const gaze = eyeGaze(eyes.gazeYawDeg, COMPOSER_EYE_PITCH_DEG, side), site: EyeVec3 = [ex, ey, side * ez];
      // the skull surface crossing nearest the old eye site along the gaze; the eye centre is recessed behind it
      const hit = nearestExit(headTris, site, gaze);
      if (!hit) ctx.fallbacks++;
      const centre = hit ? addV(hit.point, gaze, -EYE_PATCH.recess * er) : site;
      const near = trianglesNear(headTris, centre, EYE_PATCH_REACH * er);
      const patch = buildEyePatch({type, er, centre, gaze, barAxis: eyeBarAxis(gaze, worldUp), surface: near.tris});
      for (const h of patch.surface) if (h) h.tri = near.ids[h.tri]!;
      // the skin colour under every rim vertex; rim vertices that found no surface take the head coat there
      const surf = patch.surface.map((h, k): RGB => {
        if (h) return surfaceColour(h);
        const x = patch.positions[k * 3]!, p = toModel(x, patch.positions[k * 3 + 1]!, patch.positions[k * 3 + 2]!);
        return coatAt(p, 0.5, hc.region(x), hc.along(x));
      });
      built.push({patch, side, centre, gaze, hit, surf});
    }
    // iris: the face's built colour x the individual shade, juvenile birds darker, then the contrast floors
    const irisOf = (id: string): RGB => scaleC([...(COMPOSER_IRIS_RGB as Record<string, readonly number[]>)[id]!] as RGB, ctx.eyeMul);
    let iris = irisOf(eyes.irisBuilt ?? 'dark-brown');
    if (r.head === 'beak' && r.maturity < 0.75) iris = mixC(iris, irisOf('dark-brown'), (0.75 - r.maturity) / 0.75);
    const C = COMPOSER_EYE_CONTRAST, lidRole = EYE_ROLE.lid;
    let lidLum = 0;
    for (const {patch, surf} of built) patch.roles.forEach((role, k) => { if (role === lidRole) lidLum = Math.max(lidLum, luminance(scaleC(surf[k]!, C.lid))); });
    const gain = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
    const want = Math.max(C.overPupil * luminance(PUPIL_RGB), C.overLid * lidLum), have = luminance(iris);
    if (have < want && have > 0) iris = gain(iris, Math.min(C.maxIrisGain, want / have));
    // a pale coat whose lid rim is still too bright for the iris gets a darker lid rim (dark-skinned eyelids)
    let lidFactor = C.lid;
    if (luminance(iris) < C.overLid * lidLum) lidFactor = C.lid * luminance(iris) / (C.overLid * lidLum) * 0.999;
    ctx.colours.iris = iris; ctx.colours.lidFactor = lidFactor;
    const irisInner = gain(iris, 1.1), limbus = scaleC(iris, 0.45);
    for (const {patch, side, centre, gaze, hit, surf} of built) {
      let lidSum: RGB = [0, 0, 0], lids = 0;
      const colours = [...patch.roles].map((role, k): RGB => {
        switch (role) {
          case EYE_ROLE.pupil: return PUPIL_RGB;
          case EYE_ROLE['iris-inner']: return irisInner;
          case EYE_ROLE.iris: return iris;
          case EYE_ROLE.limbus: return limbus;
          case EYE_ROLE.lid: { const c = scaleC(surf[k]!, lidFactor); lidSum = [lidSum[0] + c[0], lidSum[1] + c[1], lidSum[2] + c[2]]; lids++; return c; }
          case EYE_ROLE['outer-lid']: return scaleC(surf[k]!, C.outerLid);
          case EYE_ROLE.orbit: return surf[k]!;
          default: return [0, 0, 0];
        }
      });
      // the closing cone behind the eye is never seen: the mean lid colour
      const socket = scaleC(lidSum, 1 / Math.max(1, lids));
      patch.roles.forEach((role, k) => { if (role === EYE_ROLE.socket) colours[k] = socket; });
      emit(patch, colours, side, type, er, centre, gaze, hit ? hit.point : null);
    }
  }
  s.end();
}

/** Catalogue-path eye numbers (fauna-composer-eye-2, eye round EC2). Design values tuned in review at normal viewing
 * size; colours are linear RGB, luminances Rec.709. */
export const COMPOSER_EYE_CATALOGUE = Object.freeze({
  /** camera eyes: er = max(profile k, minK) x sizeBoost x preset size x craniumHeight x eyeScale x eyeRel. The face
   * round's eyes read "tiny" or vanished on large dark heads (proboscis k 0.07); the floor and the boost fix the size. */
  minK: 0.14, sizeBoost: 1.12,
  /** iris: an absolute luminance floor on top of the face round's floors (10x the pupil, 1.8x the lid rim), and a
   * larger gain limit, so a dark-brown iris reads as brown, not as a hole */
  irisMin: 0.1, maxIrisGain: 8,
  /** a bare periocular ring: the outer lid blends toward this pale skin until its luminance reaches periocularLum or
   * periocularOverSkin x the skin under it, whichever is higher (never past the ring colour itself): a halo a little
   * paler than the face around the dark eye (the face round's eyes vanished into dark and mid-grey faces) */
  periocular: [0.36, 0.30, 0.25] as RGB, periocularLum: 0.18, periocularOverSkin: 1.3, periocularSkinGain: 2.5, periocularOwnLum: 0.08,
  sclera: [0.72, 0.68, 0.60] as RGB, nictitans: [0.50, 0.42, 0.40] as RGB, nictitansMix: 0.6, brow: 0.85,
  /** owl facial disc: its pale band (the outer-lid ring) mixes discMix toward `disc` and is lifted to at least discLum,
   * and its edge (the orbit ring) mixes discEdge toward it, so the whole disc is pale out to a crisp edge on the skin (EC2
   * review: at mix 0.3 the disc read only as pale strips beside the beak, "the facial-disc ring is missing or unclear",
   * and a dark ruff read as "heavy dark brows", GPT Luna 6) */
  disc: [0.70, 0.64, 0.52] as RGB, discMix: 1, discLum: 0.4, discEdge: 0.6,
  /** compound eyes: facet floor (luminance, and a multiple of the head skin), lens shades (a, b), lattice and pseudopupil */
  facetMin: 0.15, facetOverSkin: 3, lens: [1.5, 1.15] as readonly number[], lattice: 0.55, pseudopupil: 0.12,
  /** compound domes are this much larger than the face round's (they vanished at normal size) */
  compoundScale: 1.45,
  /** compound eyes on a mandibles head are larger again: there they read as small bumps */
  mandibleScale: 1.3,
  /** how deep (x the dome's depth radius) a compound dome's centre sits under the skin along its gaze */
  compoundSink: 0.5,
  /** eyespot bead: radius on a worm cap (x craniumHeight) and on any other face (x the camera er); pigment tint (never
   * black), the rim (the skin under it; rimGain 1: not brightened) and the cap's own eyespot gaze */
  eyespotR: 0.09, eyespotOnFace: 0.75, pigment: [0.62, 0.2, 0.07] as RGB, pigmentMix: 0.85, rimGain: 1.0, eyespotEdgeToSkin: 0.3, eyespotLum: 0.9,
  /** a worm cap's eyespots sit higher and wider than the face round's discs, clear of the mouth disc */
  eyespotYawDeg: 24, eyespotPitchDeg: 42,
  /** simple eyes (spider eyes, ocelli, a snail's stalk tip): near-black glossy lenses with a slightly paler socket rim */
  ocellus: [0.012, 0.012, 0.016] as RGB, ocellusRim: [0.5, 0.4, 0.32] as RGB, ocellusRimMix: 0.6,
  /** a spider bead's centre stays this many flange radii off the midline */
  ocellusClear: 1.35,
  /** chameleon turret skin: a little paler than the coat under it; the aperture (pupil, iris, limbus and opening) this
   * much wider than the preset's pinhole, ringed with a pale rim, and the cone's shoulder and aperture rim (er) set so
   * the turret reads as a cone with a hole at normal size, not as a smooth knob */
  turretGain: 1.2, turretOpen: 2, turretRim: [0.80, 0.72, 0.45] as RGB, turretRimMix: 0.5,
  turretShape: {w: 0.78, lift: 0.62, aperture: 1.3}, turretSize: 1.3, turretStripe: 0.6,
  /** a lidless (spectacle) eye: the skin up to the brille edge is the coat a little darkened, no periocular halo */
  brilleEdge: 0.8,
  /** a horizontal bar pupil is at least barMin wide and at most barMax tall (er), with square-ish ends (superellipse
   * exponent at least barSquare): the frog's fat oval read as round, then as an oval */
  barMin: 0.62, barMax: 0.17, barSquare: 5,
  /** a vertical slit pupil is at least slitMin (er) half-wide: the 0.08 hairline vanished at normal size */
  slitMin: 0.12,
  /** a vertical-slit, wide-slit or W-pupil eye is this much larger: at the preset size the slit was unreadable on a
   * big crocodilian head, the cat's iris on a long muzzle and the cuttlefish W on a horse */
  slitSize: 1.25,
  /** the cat kind is up to `size` larger again, but never past maxEr x craniumHeight by the boost (the preset size on a
   * long muzzle read as "eyes too small and side-set" at normal size, GPT Luna 6, EC2 review), and it turns toward a
   * skull leaning away from its look like a lidless eye, by the excess over tiltDeg (at the full size and the preset's
   * yaw it stood 0.7 er proud of the skull on its muzzle side, read as "rim flaps" and "layered protrusions") */
  cat: {size: 1.8, tiltDeg: 14, maxEr: 0.5},
  /** the owl kind is a little smaller than its preset, so its facial disc shows around the eye (at 1.6 the eyes filled
   * the face and the disc showed only as pale strips; "the eyes look very large and protruding", GPT Luna 6, EC2 review),
   * sits `up` x craniumHeight higher (off the beak's base), and its two discs meet `midline` x craniumWidth off the
   * midline (at 0.03 a blue stripe split the face, "a sharp blue wedge cuts down the forehead") */
  owl: {size: 0.68, up: 0.12, midline: 0.005},
  /** chameleon turret axis = look + turretNormal x the skull normal (normalised): nearly the normal */
  turretNormal: 4,
  /** camera-eye seat: when the skull under the eye (the mean normal of five exits, the site and `reach` er either way
   * along both in-plane axes) leans more than `deg` from the look, or the eye would overhang the skull (an exit
   * missing), the site moves on a grid (x head length, x craniumHeight) to the one that faces the look best, less
   * `move` per unit of offset: a big eye at a skull corner or on a narrow head top otherwise stands out as a slab. An
   * lidless spectacle eye (its brille edge sits at cornea height, so no lid hides the skull falling away under a big
   * eye) whose seat still leans more than `tiltLidless` degrees from the look turns toward the skull by the excess. */
  seat: {deg: 30, tiltLidless: 12, reach: 1.0, dx: [-0.3, 0.15] as readonly number[], dy: [-0.25, 0.25] as readonly number[], step: 0.05, move: 0.5},
  /** eye stalks: length x craniumHeight (worm cap, any other face), males x (1 + dimorphism x stalkDimorphism) */
  stalkLength: {blunt: 0.9, other: 0.45}, stalkDimorphism: 0.6, stalkR: [0.07, 0.05] as readonly number[], stalkBulb: 0.13, stalkBead: 0.09,
});
/** The eight spider eyes per pair (anterior median, anterior lateral, posterior median, posterior lateral): radius
 * (x craniumHeight), gaze yaw and pitch (degrees), lateral offset (x craniumWidth), site offsets (x head length, x
 * craniumHeight) from the face's eye site, and the bead's tessellation; every bead has a pale rim so it reads on a
 * black head: a dark dome in a pale flange ring on the skin (the stations-only pale rim of an earlier cut read as
 * "hard to count", GPT Luna 6, EC2 r29). 2 x (40 + 3 x 20) = 200 triangles: the design cap (eye-catalogue-v2 budgets,
 * spider <= 200), with the side pairs as pentagonal beads; the beads are larger than the first passes' (main 0.32, was
 * 0.26; sides 0.14-0.15, were 0.10-0.11) since at the cap's tessellation size is the legibility lever. EC2's first passes used
 * 2 x (72 + 3 x 48) = 432 without disclosure; cut back to the cap after the EC2 review. */
export const SPIDER_EYES = Object.freeze([
  {r: 0.32, yaw: 12, pitch: 5, z: 0.2, dx: 0.1, dy: 0, segments: 10, stations: 1, rim: true},
  {r: 0.15, yaw: 42, pitch: 5, z: 0.5, dx: 0.04, dy: -0.06, segments: 5, stations: 1, rim: true},
  {r: 0.14, yaw: 20, pitch: 35, z: 0.28, dx: -0.03, dy: 0.14, segments: 5, stations: 1, rim: true},
  {r: 0.15, yaw: 90, pitch: 25, z: 0.55, dx: -0.07, dy: 0.08, segments: 5, stations: 1, rim: true},
]);
/** Insect ocelli: site offsets (x head length, x craniumWidth) from the compound eyes' site, on the head top. */
const INSECT_OCELLI: readonly (readonly [number, number])[] = [[0.1, 0], [-0.05, -0.3], [-0.05, 0.3]];
/** Tie window (head-local metres) for exits that share one mirror-seam crossing: engine noise on t is ~1e-17, a head
 * triangle is >= ~1e-4 across. */
const SEAM_TIE = 1e-9;
/** The skull normal under a site on the head's mirror plane (z = 0) along a line in that plane (dir z = 0). Such a line
 * crosses the two seam triangles at the SAME t, and which of them nearestExit keeps is decided by a 1-ulp difference in
 * the site (WebKit 26.5 kept the other one than Node/Chromium/Firefox: a 0.15 rad lens-normal flip, 0.42 mm on the
 * midline insect ocellus, golden faunaKnownUnstable). Every exit at the chosen signed crossing is summed in triangle-
 * index order (not t order, which is what differed) and the lateral component dropped, so the midline normal is
 * symmetric and independent of the tie order. Trialled 2026-10-04 (golden-ext/composer-patch-trial: four engines equal). */
function seamNormal(tris: ArrayLike<number>, site: EyeVec3, dir: EyeVec3, hit: RayHit): EyeVec3 {
  const tied = raycastLine(tris, site, dir).filter(h => h.normal[0] * dir[0] + h.normal[1] * dir[1] + h.normal[2] * dir[2] > 0 && Math.abs(h.t - hit.t) <= SEAM_TIE).sort((a, b) => a.tri - b.tri);
  let sx = 0, sy = 0;
  for (const h of tied) { sx += h.normal[0]; sy += h.normal[1]; }
  return normalize3([sx, sy, 0]);
}
/** Every catalogue ring vertex lies within this many er of its centre (facial disc 2.1 er in plane + the closest-point
 * search 2.5 er), so the skull triangles beyond it never affect the patch. */
const CATALOGUE_PATCH_REACH = 5.2;

interface CatalogueEyeEnv {
  s: Skin; r: ComposerRecipe; H: number; cW: number; cH: number; sn: number; skull: ComposerSkull;
  eyes: ReturnType<typeof resolveComposerEyes>; sizeK: number; tr: SkinIndividual['traits']; pal: Palette;
  hc: ReturnType<typeof makeHeadColours>; coatAt: CoatAt; ctx: EyeContext; headTris: Float64Array; worldUp: EyeVec3;
  surfaceColour: (hit: RayHit) => RGB; smoothOffset: (hit: RayHit, dir: EyeVec3) => number; toModel: (x: number, y: number, z: number) => THREE.Vector3;
  emit: (patch: EyePatch, colours: RGB[], side: number, type: string, er: number, centre: EyeVec3, gaze: EyeVec3, surface: EyeVec3 | null) => void;
}
/** The legibility rules at normal viewing size: a horizontal bar pupil at least barMin wide and at most barMax tall
 * (er), a vertical slit at least slitMin wide, and a chameleon turret's wider aperture and cone (see COMPOSER_EYE_CATALOGUE.turretOpen). */
function legibleSpec(spec0: CatalogueEyeSpec): CatalogueEyeSpec {
  const K = COMPOSER_EYE_CATALOGUE;
  const p0 = spec0.pupil;
  const spec = p0.kind === 'horizontal' ? {...spec0, pupil: {...p0, rx: Math.max(p0.rx, K.barMin), ry: Math.min(p0.ry, K.barMax), n: Math.max(p0.n, K.barSquare)}}
    : p0.kind === 'vertical-slit' ? {...spec0, pupil: {...p0, rx: Math.max(p0.rx, K.slitMin)}} : spec0;
  if (!spec.turret) return spec;
  const f = K.turretOpen, p = spec.pupil;
  return {...spec, pupil: {...p, r: p.r * f}, iris: spec.iris === null ? null : spec.iris * f, limbus: spec.limbus === null ? null : spec.limbus * f,
    lid: {...spec.lid, w: spec.lid.w * f, above: spec.lid.above * f, below: spec.lid.below * f}, turret: {...K.turretShape}};
}
/** `v` turned toward `n` (both unit) until at most `maxAngle` radians from it; unchanged when already within. */
function turnToward(v: EyeVec3, n: EyeVec3, maxAngle: number): EyeVec3 {
  const th = Math.acos(clamp(v[0] * n[0] + v[1] * n[1] + v[2] * n[2], -1, 1));
  if (th <= maxAngle || th > Math.PI - 1e-6) return v;
  const a = Math.sin(maxAngle) / Math.sin(th), b = Math.sin(th - maxAngle) / Math.sin(th);
  return normalize3([n[0] * b + v[0] * a, n[1] * b + v[1] * a, n[2] * b + v[2] * a]);
}
function mergeEyePatches(a: EyePatch, b: EyePatch): EyePatch {
  const off = a.positions.length / 3;
  return {positions: [...a.positions, ...b.positions], roles: Uint8Array.from([...a.roles, ...b.roles]), gloss: [...a.gloss, ...b.gloss], index: [...a.index, ...b.index.map(i => i + off)],
    surface: [...a.surface, ...b.surface], rimFallbacks: a.rimFallbacks + b.rimFallbacks, rings: [...a.rings, ...b.rings.map(i => i + off)]};
}
const gainC = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
/** Blends c toward `toward` just enough to reach luminance `target` (never darkens). */
function liftTo(c: RGB, toward: RGB, target: number): RGB {
  const l = luminance(c), lt = luminance(toward);
  if (l >= target || lt <= l) return c;
  return mixC(c, toward, Math.min(1, (target - l) / (lt - l)));
}

/** The eye catalogue geometry (fauna-composer-eye-2): every kind on every face, from its preset's traits. */
function buildCatalogueEyes(e: CatalogueEyeEnv) {
  const {r, H, cW, cH, sn, skull, eyes, sizeK, tr, pal, ctx, headTris, worldUp, surfaceColour, smoothOffset, emit} = e;
  const K = COMPOSER_EYE_CATALOGUE, C = COMPOSER_EYE_CONTRAST, T = eyes.traits, face = r.head, deg = Math.PI / 180;
  // the face's camera-eye profile (an arthropod or worm head takes the appended camera profiles)
  const cam = FACE_EYE_PROFILE[composerEyeProfileId(r, 'round')], camK = Math.max(cam.k, K.minK) * K.sizeBoost;
  const [ex, ey, ez] = eyeAnchor(skull, H, cH, cW), onMandibles = face === 'mandibles';
  const P = T.placement, own = (side: number) => (P.kind === 'independent' && side > 0 && P.right ? P.right : null);
  const isCat = eyes.kind === 'cat', isOwl = eyes.kind === 'owl';
  const yawOf = (side: number) => own(side)?.yawDeg ?? P.yawByFace?.[face] ?? P.yawDeg ?? cam.gazeYawDeg;
  const pitchOf = (side: number) => own(side)?.pitchDeg ?? P.pitchDeg ?? COMPOSER_EYE_PITCH_DEG;
  /** the camera site, moved forward and inward for a gaze more frontal than the face's own, and up for a dorsal one */
  const siteOf = (side: number, yaw: number, pitch: number): EyeVec3 => {
    const shift = clamp((cam.gazeYawDeg - yaw) / Math.max(cam.gazeYawDeg, 1), 0, 1), up = pitch > 10 ? Math.sin(pitch * deg) : 0;
    return [ex + 0.1 * H * shift, ey + 0.2 * cH * up + (isOwl ? K.owl.up * cH : 0), side * ez * (1 - 0.45 * shift) * (1 - 0.25 * up)];
  };
  const skinAt = (hit: RayHit | null): RGB => hit ? surfaceColour(hit) : pal.base;
  /** compound facets: the palette eye colour, lifted toward a reddish brown until it clears the skin under the eye */
  const facetOf = (under: RGB): RGB => {
    const floor = Math.max(K.facetMin, K.facetOverSkin * luminance(under));
    return liftTo(pal.eye, COMPOUND_EYE_FLOOR.tint, Math.min(floor, luminance(COMPOUND_EYE_FLOOR.tint)));
  };
  const facetColours = (patch: EyePatch, facet: RGB): RGB[] => [...patch.roles].map(role =>
    role === EYE_ROLE['facet-a'] ? gainC(facet, K.lens[0]!) : role === EYE_ROLE['facet-b'] ? gainC(facet, K.lens[1]!)
      : role === EYE_ROLE.pseudopupil ? scaleC(facet, K.pseudopupil) : scaleC(facet, K.lattice));

  if (T.structure === 'camera') {
    const spec = legibleSpec(catalogueEyeSpec(T)), er0 = camK * T.size * cH * sizeK * (spec.turret ? K.turretSize : ['vertical-slit', 'slit-wide', 'w'].includes(spec.pupil.kind) ? K.slitSize : 1);
    // the cat's boost stops at cat.maxEr x craniumHeight (a juvenile's already larger eye bulged off its head at the full
    // boost, "oversized bulging eyes", GPT Luna 6, EC2 review); it never shrinks an eye
    const er = er0 * (isCat ? clamp(K.cat.maxEr * cH / er0, 1, K.cat.size) : isOwl ? K.owl.size : 1);
    const built: {patch: EyePatch; side: number; centre: EyeVec3; gaze: EyeVec3; hit: RayHit | null; surf: RGB[]}[] = [];
    const Q = K.seat, local = trianglesNear(headTris, [ex, ey, 0], 0.6 * H + 2 * er).tris;
    /** how squarely the skull under the eye faces `look` (see K.seat), -Infinity when the eye would overhang */
    const facing = (at: EyeVec3, look: EyeVec3): {hit: RayHit; score: number; normal?: EyeVec3} | null => {
      const hit = nearestExit(local, at, look);
      if (!hit) return null;
      // a seat under another skull layer (a jaw or brow loft outside it) would bury the eye
      const outer = outermostExit(local, hit.point, look, 3 * er);
      if (outer && outer.t > 0.02 * er) return {hit, score: -Infinity};
      const a = normalize3(Math.abs(look[1]) > 0.95 ? [look[1], -look[0], 0] : [look[2], 0, -look[0]]), b: EyeVec3 = [look[1] * a[2] - look[2] * a[1], look[2] * a[0] - look[0] * a[2], look[0] * a[1] - look[1] * a[0]];
      let n: EyeVec3 = [...hit.normal];
      for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const h = nearestExit(local, addV(addV(hit.point, a, u * Q.reach * er), b, v * Q.reach * er), look, er);
        if (!h) return {hit, score: -Infinity};
        n = addV(n, h.normal, 1);
      }
      const m = normalize3(n);
      return {hit, score: m[0] * look[0] + m[1] * look[1] + m[2] * look[2], normal: m};
    };
    /** the seat offset (x H, x cH) per side; a symmetric pair searches once (left) and mirrors it */
    let pairOffset: [number, number] | null = null;
    const seatOffset = (site: EyeVec3, look: EyeVec3, side: number): [number, number] => {
      if (spec.turret) return [0, 0];
      if (P.kind !== 'independent' && pairOffset) return pairOffset;
      const here = facing(site, look);
      let best: [number, number] = [0, 0];
      if (!here || here.score < Math.cos(Q.deg * deg)) {
        let top = here ? here.score : -Infinity;
        const nx = Math.round((Q.dx[1]! - Q.dx[0]!) / Q.step), ny = Math.round((Q.dy[1]! - Q.dy[0]!) / Q.step);
        for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
          const dx = Q.dx[0]! + i * Q.step, dy = Q.dy[0]! + j * Q.step, f = facing([site[0] + dx * H, site[1] + dy * cH, site[2]], look);
          const sc = f ? f.score - Q.move * Math.hypot(dx, dy) : -Infinity;
          if (sc > top + 1e-9) { top = sc; best = [dx, dy]; }
        }
      }
      if (side < 0) pairOffset = best;
      return best;
    };
    for (const side of [-1, 1]) {
      const yaw = yawOf(side), pitch = pitchOf(side), look = eyeGaze(yaw, pitch, side), site0 = siteOf(side, yaw, pitch);
      const [sdx, sdy] = seatOffset(site0, look, side), site: EyeVec3 = [site0[0] + sdx * H, site0[1] + sdy * cH, site0[2]];
      const hit = nearestExit(headTris, site, look);
      if (!hit) ctx.fallbacks++;
      // a turret rises from the skull along its normal (its aperture leans toward the look), so a forward- or
      // backward-looking turret stands up instead of lying along the snout
      let gaze = spec.turret && hit ? normalize3(addV(look, hit.normal, K.turretNormal)) : look;
      // a lidless eye on a skull that still leans more than seat.tiltLidless from the look turns toward the skull by the
      // excess, so a big gecko eye on a curving head side sits in it instead of standing a rim's height proud on one side
      // so does a cat eye by its own (larger) limit: a big cat eye at the cranium's front corner otherwise stands 0.7 er
      // proud of the skull on its muzzle side, read as "rim flaps" and "layered protrusions" (GPT Luna 6, EC2 review)
      const under = spec.spectacle || isCat ? facing(site, look) : null;
      if (under?.normal && Number.isFinite(under.score)) gaze = turnToward(look, under.normal, (isCat ? K.cat.tiltDeg : Q.tiltLidless) * deg);
      const centre = hit ? addV(hit.point, gaze, -EYE_PATCH.recess * er) : site;
      const near = trianglesNear(headTris, centre, CATALOGUE_PATCH_REACH * er);
      const patch = buildEyePatch({type: 'round', er, centre, gaze, barAxis: eyeBarAxis(gaze, worldUp), surface: near.tris, spec, forward: [1, 0, 0], midline: {n: [0, 0, side], min: (spec.disc ? K.owl.midline : 0.03) * cW}, look});
      for (const h of patch.surface) if (h) h.tri = near.ids[h.tri]!;
      const surf = patch.surface.map((h, k): RGB => {
        if (h) return surfaceColour(h);
        const x = patch.positions[k * 3]!, p = e.toModel(x, patch.positions[k * 3 + 1]!, patch.positions[k * 3 + 2]!);
        return e.coatAt(p, 0.5, e.hc.region(x), e.hc.along(x));
      });
      built.push({patch, side, centre, gaze, hit, surf});
    }
    const irisOf = (id: string): RGB => scaleC([...(COMPOSER_IRIS_RGB as Record<string, readonly number[]>)[id]!] as RGB, ctx.eyeMul);
    let iris = irisOf(eyes.irisBuilt ?? 'dark-brown');
    if (r.head === 'beak' && r.maturity < 0.75) iris = mixC(iris, irisOf('dark-brown'), (0.75 - r.maturity) / 0.75);
    let lidLum = 0;
    for (const {patch, surf} of built) patch.roles.forEach((role, k) => { if (role === EYE_ROLE.lid) lidLum = Math.max(lidLum, luminance(scaleC(surf[k]!, C.lid))); });
    const want = Math.max(C.overPupil * luminance(PUPIL_RGB), C.overLid * lidLum, K.irisMin), have = luminance(iris);
    if (have < want && have > 0) iris = gainC(iris, Math.min(K.maxIrisGain, want / have));
    let lidFactor = C.lid;
    // The cephalopod's boosted iris reaches this floor mathematically exactly.
    // One rounding bit must not toggle the discontinuous extra 0.999 darkening.
    // Other profiles retain their pinned contrast calculation.
    const lidFloor = C.overLid * lidLum, deficit = eyes.kind === 'cephalopod' ? lidFloor * (1 - 1e-12) : lidFloor;
    if (luminance(iris) < deficit) lidFactor = C.lid * luminance(iris) / lidFloor * 0.999;
    ctx.colours.iris = iris; ctx.colours.lidFactor = lidFactor;
    const irisInner = gainC(iris, 1.1), limbus = scaleC(iris, 0.45);
    for (const {patch, side, centre, gaze, hit, surf} of built) {
      let lidSum: RGB = [0, 0, 0], lids = 0;
      const shade = (k: number) => patch.shade?.[k] ?? 1;
      const colours = [...patch.roles].map((role, k): RGB => {
        switch (role) {
          case EYE_ROLE.pupil: return PUPIL_RGB;
          case EYE_ROLE['iris-inner']: return gainC(irisInner, shade(k));
          case EYE_ROLE.iris: return gainC(iris, shade(k));
          case EYE_ROLE.limbus: return limbus;
          case EYE_ROLE.sclera: return K.sclera;
          case EYE_ROLE.lid: case EYE_ROLE.nictitans: {
            const c = spec.turret ? mixC(gainC(surf[k]!, K.turretGain), K.turretRim, K.turretRimMix) : scaleC(surf[k]!, spec.spectacle ? K.brilleEdge : lidFactor);
            lidSum = [lidSum[0] + c[0], lidSum[1] + c[1], lidSum[2] + c[2]]; lids++;
            return role === EYE_ROLE.nictitans ? mixC(c, K.nictitans, K.nictitansMix) : c;
          }
          case EYE_ROLE['outer-lid']: {
            // a lidless eye's skin runs plainly up to the brille (a pale halo there sawtoothed against the brille edge)
            if (spec.spectacle) return scaleC(surf[k]!, K.brilleEdge);
            const c = scaleC(surf[k]!, C.outerLid);
            if (spec.disc) return liftTo(mixC(c, K.disc, K.discMix), K.disc, K.discLum);
            // toward a paler shade of the skin itself, or the pale periocular skin on a near-black coat (a fixed tan
            // halo read as a pale socket on olive and green skins)
            const toward = mixC(K.periocular, gainC(surf[k]!, K.periocularSkinGain), clamp(luminance(surf[k]!) / K.periocularOwnLum, 0, 1));
            return liftTo(spec.disc ? mixC(c, K.disc, K.discMix) : c, toward, Math.max(K.periocularLum, K.periocularOverSkin * luminance(surf[k]!)));
          }
          case EYE_ROLE.brow: return scaleC(surf[k]!, K.brow);
          // radial stripes of paler and darker skin down the cone (the scale rows of a real turret), so it reads as a cone
          case EYE_ROLE.turret: return (k - patch.rings[6]!) % 2 ? scaleC(surf[k]!, K.turretStripe) : gainC(surf[k]!, K.turretGain);
          case EYE_ROLE.orbit: return spec.disc ? mixC(surf[k]!, K.disc, K.discEdge) : surf[k]!;
          default: return [0, 0, 0];
        }
      });
      const socket = scaleC(lidSum, 1 / Math.max(1, lids));
      patch.roles.forEach((role, k) => { if (role === EYE_ROLE.socket) colours[k] = socket; });
      emit(patch, colours, side, eyes.kind, er, centre, gaze, hit ? hit.point : null);
    }
  } else if (T.structure === 'compound') {
    // facet domes: the arthropod site on a mandibles head (the face round's), the camera site on any other face
    const kc = camK * cH * sizeK * T.size, ks = K.compoundScale * sizeK * T.size * K.mandibleScale;
    const er3: [number, number, number] = onMandibles ? [0.07 * H * ks, 0.18 * cH * ks, 0.12 * cW * ks] : [1.05 * kc * K.compoundScale, 1.2 * kc * K.compoundScale, 0.75 * kc * K.compoundScale];
    const yaw = onMandibles ? FACE_EYE_PROFILE.mandibles.gazeYawDeg : cam.gazeYawDeg;
    let facet: RGB = pal.eye;
    for (const side of [-1, 1]) {
      const gaze = eyeGaze(yaw, COMPOSER_EYE_PITCH_DEG, side), site: EyeVec3 = onMandibles ? [0.45 * H, 0.35 * cH, side * 0.82 * cW] : [ex, ey, side * ez];
      const hit = nearestExit(headTris, site, gaze);
      if (!hit) ctx.fallbacks++;
      // sunk deeper into the skull (sunk 0.35 of its depth, the dome stood off a round head like a flap)
      const centre = hit ? addV(hit.point, gaze, -K.compoundSink * er3[2]) : site;
      const patch = buildFacetedEye({er3, centre, gaze, up: [0, 1, 0]});
      facet = facetOf(skinAt(hit));
      emit(patch, facetColours(patch, facet), side, eyes.kind, Math.max(...er3), centre, gaze, hit ? hit.point : null);
    }
    ctx.colours.compound = facet;
    if (T.extras === 'ocelli') {
      // three ocelli on the head top between the compound eyes
      const ox = onMandibles ? 0.45 * H : ex, rr = 0.25 * er3[1], up = normalize3([0.35, 1, 0]);
      for (const [dx, z] of INSECT_OCELLI) {
        const site: EyeVec3 = [ox + dx! * H, 0.3 * cH, z! * cW], hit = nearestExit(headTris, site, up);
        if (!hit) ctx.fallbacks++;
        const hn = hit ? (z === 0 ? seamNormal(headTris, site, up, hit) : hit.normal) : null;
        const n = hn ? normalize3(addV(up, hn, 1)) : up, base = hit ? addV(hit.point, n, -0.25 * rr) : site;
        const patch = buildOcellus({r: rr, height: 0.7 * rr, centre: base, normal: n, up: [1, 0, 0], segments: 6, stations: 1});
        const lens = gainC(facet, 1.2);
        emit(patch, [...patch.roles].map(() => lens), 0, 'ocellus', rr, base, n, hit ? hit.point : null);
      }
    }
  } else if (T.structure === 'ocellus') {
    // spider eyes: four beads per side around the face's eye site
    const [x0, y0] = onMandibles ? [0.45 * H, 0.35 * cH] : [ex, ey];
    for (const side of [-1, 1]) for (const S of SPIDER_EYES) {
      // the lateral offset never lets a bead's rim flange reach the midline (the front pair overlapped on narrow heads)
      const rr = S.r * cH * sizeK, gaze = eyeGaze(S.yaw, S.pitch, side), site: EyeVec3 = [x0 + S.dx * H, y0 + S.dy * cH, side * Math.max(S.z * cW, K.ocellusClear * OCELLUS.flange * rr)];
      const hit = nearestExit(headTris, site, gaze);
      if (!hit) ctx.fallbacks++;
      // seated just under the skin so the pale rim station stays outside it
      const n = hit ? normalize3(addV(gaze, hit.normal, 1)) : gaze, base = hit ? addV(hit.point, n, -0.05 * rr) : site;
      const patch = buildOcellus({r: rr, height: 0.75 * rr, centre: base, normal: n, up: [0, 1, 0], segments: S.segments, stations: S.stations, rim: S.rim, flange: S.rim});
      const rim = mixC(skinAt(hit), K.ocellusRim, K.ocellusRimMix);
      emit(patch, [...patch.roles].map(role => role === EYE_ROLE['ocellus-rim'] ? rim : K.ocellus), side, 'ocellus', rr, base, n, hit ? hit.point : null);
    }
  } else if (T.structure === 'eyespot') {
    // a flush pigment spot, draped on the skin: on a worm's cap where the face round put its discs, on any other face
    // at the camera site. A spot much darker than the skin read as a hole or a button, one brighter than it as a lit
    // bulb (EC2 r21-r26), so the pigment is a red hue at the skin's own luminance (x eyespotLum) with a crisp edge.
    const blunt = face === 'blunt', rr = blunt ? K.eyespotR * cH * sizeK : K.eyespotOnFace * camK * cH * sizeK;
    const hue = mixC(pal.eye, K.pigment, K.pigmentMix), liftH = 0.002 * H;
    for (const side of [-1, 1]) {
      let gaze: EyeVec3, hit: RayHit | null, base: EyeVec3;
      if (blunt) {
        const xt = 0.6 * H + sn * 0.3, from: EyeVec3 = [xt, 0, 0];
        gaze = eyeGaze(K.eyespotYawDeg, K.eyespotPitchDeg, side); hit = raycastFirstHit(headTris, from, gaze);
        base = hit ? hit.point : addV(from, gaze, 0.7 * cW);
      } else {
        gaze = eyeGaze(cam.gazeYawDeg, COMPOSER_EYE_PITCH_DEG, side);
        const site: EyeVec3 = [ex, ey, side * ez];
        hit = nearestExit(headTris, site, gaze); base = hit ? hit.point : site;
      }
      if (!hit) ctx.fallbacks++;
      const g = gaze, onSkin = (p: EyeVec3) => nearestExit(headTris, p, g, 3 * rr);
      // draped on the head's smooth surface (smoothOffset), so the pigment shades like the skin around it
      const patch = buildEyespotBead({r: rr, centre: base, normal: gaze, up: [0, 1, 0], rimLift: p => { const h = onSkin(p); return h ? h.t + smoothOffset(h, g) + liftH : liftH; }});
      const under = skinAt(hit), pigment = scaleC(hue, K.eyespotLum * luminance(under) / Math.max(1e-6, luminance(hue)));
      const colours = [...patch.roles].map((role, k): RGB => {
        // the pigment's edge ring fades toward the skin instead of darkening (a darker edge outlined the bead as a
        // button or a hole: EC2 review, GPT Luna 6)
        if (role === EYE_ROLE.eyespot && k <= 12) return pigment;
        const p: EyeVec3 = [patch.positions[k * 3]!, patch.positions[k * 3 + 1]!, patch.positions[k * 3 + 2]!], h = onSkin(addV(p, g, -rr));
        const skin = h ? surfaceColour(h) : under;
        if (role === EYE_ROLE.eyespot) return mixC(pigment, skin, K.eyespotEdgeToSkin);
        // the rim is the skin itself: a brightened rim caught the light like a button's edge (EC2 r21); so is the closing
        // cone behind it, whose sliver between the draped rim and the flat facets showed as a dark button edge (r26)
        return role === EYE_ROLE['eyespot-rim'] ? gainC(skin, K.rimGain) : skin;
      });
      emit(patch, colours, side, 'eyespot', rr, base, gaze, hit ? hit.point : null);
    }
  } else {
    // eye stalks: a tapered stalk rising from the head top, tipped with a facet bulb (crab) or a dark bead (snail)
    const blunt = face === 'blunt', dim = tr.sex === 'male' ? 1 + K.stalkDimorphism * r.dimorphism : 1;
    const len = (blunt ? K.stalkLength.blunt : K.stalkLength.other) * cH * sizeK * dim, r0 = K.stalkR[0]! * cH * sizeK, r1 = K.stalkR[1]! * cH * sizeK;
    for (const side of [-1, 1]) {
      const dir = eyeGaze(P.yawDeg ?? 40, P.pitchDeg ?? 55, side);
      const site: EyeVec3 = blunt ? [0.55 * H + 0.3 * sn, 0.35 * cH, side * 0.3 * cW] : onMandibles ? [0.4 * H, 0.45 * cH, side * 0.45 * cW] : [ex, ey + 0.25 * cH, side * 0.6 * ez];
      const hit = nearestExit(headTris, site, dir);
      if (!hit) ctx.fallbacks++;
      const root = hit ? hit.point : site, under = skinAt(hit);
      // design caps (eye-catalogue-v2: stalk <= 160 per pair): blunt 48 + 32 = 80, other 24 + 48 = 72 per eye
      const {patch: stalk, tip} = buildStalk({base: root, dir, up: [0, 1, 0], length: len, r0, r1, segments: 6, rings: blunt ? 4 : 2});
      let bulb: EyePatch, bulbColours: RGB[], er: number, centre: EyeVec3 = tip, gaze: EyeVec3 = dir;
      if (blunt) {
        er = K.stalkBead * cH * sizeK;
        // a glossy dark bead whose lowest station is a pale ring (no extra triangles): a black knob alone did not read
        // as an eye (GPT Luna 6, EC2 r29)
        bulb = buildOcellus({r: er, height: 0.9 * er, centre: tip, normal: dir, up: [0, 1, 0], segments: 8, stations: 2, rim: true});
        const ring = mixC(scaleC(under, 0.9), K.ocellusRim, K.ocellusRimMix);
        bulbColours = [...bulb.roles].map(role => role === EYE_ROLE['ocellus-rim'] ? ring : K.ocellus);
      } else {
        er = K.stalkBulb * cH * sizeK;
        gaze = normalize3(addV(dir, [0, 0, side], 0.6)); centre = addV(tip, gaze, -0.2 * er);
        bulb = buildFacetedEye({er3: [er, er, 0.8 * er], centre, gaze, up: [0, 1, 0], segments: 8, stations: 2});
        bulbColours = facetColours(bulb, facetOf(under));
      }
      const stalkColour = scaleC(under, 0.9);
      emit(mergeEyePatches(stalk, bulb), [...stalk.roles].map(() => stalkColour).concat(bulbColours), side, 'stalk', er, centre, gaze, hit ? hit.point : null);
    }
  }
}
/** Triangles [from, to) of the skin, as a head-local soup (9 numbers each, the head bone's rest frame). */
function headLocalTriangles(s: Skin, hb: ComposerBone, from: number, to: number): Float64Array {
  const qInv = new THREE.Quaternion(...hb.restQuaternion).invert(), P0 = V(...hb.restPosition), tmp = V(), out = new Float64Array((to - from) * 9);
  for (let i = from * 3, o = 0; i < to * 3; i++, o += 3) { const v = s.ix[i]!; tmp.set(s.p[v * 3]!, s.p[v * 3 + 1]!, s.p[v * 3 + 2]!).sub(P0).applyQuaternion(qInv); out[o] = tmp.x; out[o + 1] = tmp.y; out[o + 2] = tmp.z; }
  return out;
}
/** Every ring vertex of a lidded eye lies within this many er of its centre (orbit 1.55 er in plane, the rim search
 * and the closest-point search at most 2.5 er deep), so the skull triangles beyond it never affect the patch. */
const EYE_PATCH_REACH = 4.5;
/** The triangles of a soup that come within `reach` of `p` (bounding-sphere test; a superset, never a subset), with
 * each kept triangle's index in the full soup. */
function trianglesNear(tris: Float64Array, p: EyeVec3, reach: number): {tris: Float64Array; ids: number[]} {
  const out: number[] = [], ids: number[] = [];
  for (let o = 0; o + 8 < tris.length; o += 9) {
    const cx = (tris[o]! + tris[o + 3]! + tris[o + 6]!) / 3, cy = (tris[o + 1]! + tris[o + 4]! + tris[o + 7]!) / 3, cz = (tris[o + 2]! + tris[o + 5]! + tris[o + 8]!) / 3;
    let rad = 0;
    for (let k = 0; k < 9; k += 3) rad = Math.max(rad, Math.hypot(tris[o + k]! - cx, tris[o + k + 1]! - cy, tris[o + k + 2]! - cz));
    if (Math.hypot(cx - p[0], cy - p[1], cz - p[2]) <= reach + rad) { ids.push(o / 9); for (let k = 0; k < 9; k++) out.push(tris[o + k]!); }
  }
  return {tris: Float64Array.from(out), ids};
}
const addV = (a: EyeVec3, b: EyeVec3, k: number): EyeVec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Enforces the rig's foot contract on a leg's vertices: anything below the ankle moves rigidly with the
 * level foot bone, and foot-rigid vertices are kept inside x in [-back, front], y >= -footHeight of the foot
 * frame. Soles become flat contact patches at exactly the rig's sole plane, so a planted foot neither sinks
 * into nor hovers above the floor, and the rig's swing-pitch limit covers every foot vertex. */
function fitFootContract(s: Skin, firstVertex: number, foot: ComposerBone, hF: number, [back, front]: [number, number]) {
  const origin = V(...foot.restPosition), inverse = new THREE.Quaternion(...foot.restQuaternion).invert(), rotate = new THREE.Quaternion(...foot.restQuaternion);
  for (let i = firstVertex; i < s.nv; i++) {
    let footWeight = 0;
    for (let k = 0; k < 4; k++) if (s.si[i * 4 + k] === foot.index) footWeight += s.sw[i * 4 + k]!;
    if (footWeight <= 0) continue;
    const local = s.pos(i).sub(origin).applyQuaternion(inverse);
    if (footWeight < 0.999) { if (local.y >= 0) continue; for (let k = 0; k < 4; k++) { s.si[i * 4 + k] = k ? 0 : foot.index; s.sw[i * 4 + k] = k ? 0 : 1; } }
    local.set(clamp(local.x, -back, front), Math.max(local.y, -hF), local.z);
    const p = local.applyQuaternion(rotate).add(origin);
    s.p[i * 3] = p.x; s.p[i * 3 + 1] = p.y; s.p[i * 3 + 2] = p.z;
  }
}

/** Skin-6 feet continue the actual ankle boundary. The shared ring keeps its exact
 * position, weight and colour samples, so its seam stays closed under every pose.
 * Foot height/extent and the graph's contact solver retain their skin-5 meaning. */
function buildRealismFoot(s: Skin, type: 'pad' | 'hoof' | 'claw', foot: ComposerBone, hF: number, lF: number, side: number, ankle: {ring: Ring; radial: number}, pal: Palette, at: At, axis: Axis, coat: (p: THREE.Vector3) => RGB, measured?: {footLength: number; footWidth: number}) {
  const w: W = [[foot.index, 1]], ax = axis(foot, 1, 0, 0), ay = axis(foot, 0, 1, 0), az = axis(foot, 0, 0, 1);
  const down = ay.clone().negate(), a = ankle.ring, r0 = a.rx;
  const skinColour = (p: THREE.Vector3) => mixC(coat(p), pal.skin, type === 'claw' ? 0.4 : 0.18);
  const colour = (i: number, p: THREE.Vector3) => type === 'hoof' ? mixC(coat(p), pal.keratin, smooth(0, 2, i)) : skinColour(p);
  // Heel stays behind the ankle; a fuller toe slopes forward. The sole is a
  // plane, not a rounded cap later crushed by the ground-contract clamp.
  const shape = type === 'claw'
    ? [[0.06, -0.28, Math.max(a.ry, 0.16 * lF), Math.max(r0, 0.15 * lF)], [0.15, -0.65, 0.25 * lF, Math.max(r0, 0.19 * lF)], [0.17, -1, 0.23 * lF, Math.max(r0 * 0.94, 0.17 * lF)]]
    : [[0.03, -0.25, Math.max(a.ry, r0 * 1.08), r0 * 1.05], [0.11, -0.7, Math.max(r0 * 1.2, lF * 0.38), r0 * 1.23], [0.14, -1, Math.max(r0 * 1.23, lF * 0.4), r0 * 1.24]];
  if (measured && type !== 'claw') {
    shape[1]![2] = measured.footLength * .48; shape[1]![3] = measured.footWidth * .48;
    shape[2]![2] = measured.footLength * .5; shape[2]![3] = measured.footWidth * .5;
  }
  const rings: Ring[] = [a, ...shape.map(([x, y, fore, lateral], i): Ring => ({
    c: at(foot, x! * lF, y! * hF), t: down, u: ax,
    rx: lateral!, ry: fore!, w, region: REGION.foot, color: (_angle, p) => colour(i + 1, p),
  }))];
  loft(s, rings, ankle.radial, 0, 0);
  capFlat(s, rings[rings.length - 1]!, ankle.radial, 1);
  if (type === 'pad') {
    // Broad nails sit in the toe wall, instead of separate white beads on its rim.
    const toe = shape[2]!, fore = toe[2]!, lateral = toe[3]!;
    for (let k = -1; k <= 1; k++) {
      const ang = k * 0.56;
      ellipsoid(s, at(foot, toe[0]! * lF + fore * Math.cos(ang) * 0.97, -0.79 * hF, lateral * Math.sin(ang)), [ax, ay, az], [0.09 * fore, 0.16 * hF, 0.19 * lateral], w, () => mixC(pal.keratin, pal.horn, 0.4), 8, 4);
    }
  }
  if (type !== 'claw') return;
  // Three forward digits: a fleshy proximal pad, small knuckles and a narrowing
  // distal phalanx, followed by a separate keratin tip. All use the planted foot.
  const toeR = 0.082 * lF;
  for (const spread of [-0.42, 0, 0.42]) {
    const dir = ax.clone().multiplyScalar(Math.cos(spread)).addScaledVector(az, Math.sin(spread) * side).normalize();
    const base = at(foot, 0.18 * lF, 0, Math.sin(spread) * side * 0.12 * lF);
    const len = (0.76 - 0.18 * Math.abs(spread)) * lF;
    const stations = [[0, 1.08, -0.55, 0.45], [0.2, 1.12, -0.55, 0.45], [0.36, 0.87, -0.59, 0.4], [0.53, 0.91, -0.58, 0.41], [0.72, 0.68, -0.67, 0.32], [0.9, 0.48, -0.7, 0.28]];
    const digit = stations.map(([f, radius, y, h]): Ring => ({c: base.clone().addScaledVector(dir, len * f!).addScaledVector(ay, hF * y!), t: dir, u: ay, rx: toeR * radius!, ry: hF * h!, w, region: REGION.foot, color: (_angle, p) => skinColour(p)}));
    loft(s, digit, 10, 0.12, 0.12);
    const tip = digit[digit.length - 1]!.c, claw = [tip, tip.clone().addScaledVector(dir, toeR * 1.3).addScaledVector(ay, -0.02 * hF), tip.clone().addScaledVector(dir, toeR * 2.3).addScaledVector(ay, -0.2 * hF)];
    tube(s, claw, [toeR * 0.48, toeR * 0.27, toeR * 0.025], [w, w, w], () => pal.keratin, 8, 0.05, 0.05, 0.65, ay);
  }
  const back = ax.clone().negate().addScaledVector(az, -side * 0.15).normalize();
  const heel = at(foot, -0.01 * lF, -0.58 * hF);
  tube(s, [heel, heel.clone().addScaledVector(back, 0.14 * lF), heel.clone().addScaledVector(back, 0.28 * lF).addScaledVector(ay, -0.12 * hF)], [toeR * 0.8, toeR * 0.6, toeR * 0.16], [w, w, w], (i, _a, p) => i === 2 ? pal.keratin : skinColour(p), 8, 0.1, 0.1, 0.62, ay);
}

function buildFoot(s: Skin, type: ComposerRecipe['feet'], foot: ComposerBone, shank: ComposerBone, hF: number, lF: number, side: number, pal: Palette, at: At, axis: Axis, coat: (p: THREE.Vector3) => RGB) {
  const w = [[foot.index, 1]] as W, wb = [[foot.index, 0.6], [shank.index, 0.4]] as W;
  const ax = axis(foot, 1, 0, 0), ay = axis(foot, 0, 1, 0), az = axis(foot, 0, 0, 1);
  const r0 = Math.max(shank.end.w, 1e-3);
  const vertical = (pts: [number, number, number, number][], color: (i: number, p: THREE.Vector3) => RGB, seg: number, capEnd = 0.25) => {
    // [x, y, rx, rz] stations stacked downward in the foot frame
    const rings: Ring[] = pts.map(([x, y, rx, rz], i) => ({c: at(foot, x, y), t: ay.clone().negate(), u: ax, rx: rz, ry: rx, w: i === 0 ? wb : w, color: (_a, p) => color(i, p)}));
    loft(s, rings, seg, 0.15, capEnd);
  };
  if (type === 'hoof') {
    vertical([[0, 0.25 * hF, r0, r0], [0.05 * lF, -0.3 * hF, r0 * 1.15, r0 * 1.1], [0.18 * lF, -1.02 * hF, r0 * 1.35, r0 * 1.2]], (i, p) => i === 0 ? mixC(pal.keratin, coat(p), 0.4) : pal.keratin, 12, 0.08);
  } else if (type === 'pad') {
    vertical([[0, 0.3 * hF, r0, r0], [0.02 * lF, -0.4 * hF, r0 * 1.2, r0 * 1.2], [0.05 * lF, -1.02 * hF, r0 * 1.35, r0 * 1.3]], (_i, p) => mixC(coat(p), pal.skin, 0.3), 14, 0.06);
    for (let k = -1; k <= 1; k++) ellipsoid(s, at(foot, 0.05 * lF + r0 * 1.25 * Math.cos(k * 0.5), -0.8 * hF, r0 * 1.2 * Math.sin(k * 0.5)), [ax, ay, az], [r0 * 0.18, hF * 0.22, r0 * 0.3], w, () => [0.78, 0.72, 0.62], 6, 3);
  } else if (type === 'paw') {
    ellipsoid(s, at(foot, 0.25 * lF, -0.45 * hF), [ax, ay, az], [0.42 * lF, 0.55 * hF + 0.01 * lF, Math.max(r0 * 1.15, 0.28 * lF)], wb, (_a, _f, p) => mixC(coat(p), pal.accent, 0.2), 10, 5);
    for (let k = 0; k < 4; k++) {
      const z = (k - 1.5) * 0.17 * lF, x = 0.62 * lF - Math.abs(k - 1.5) * 0.06 * lF;
      ellipsoid(s, at(foot, x, -0.62 * hF, z), [ax, ay, az], [0.12 * lF, 0.38 * hF, 0.085 * lF], w, (_a, _f, p) => coat(p), 7, 4);
      tube(s, [at(foot, x + 0.08 * lF, -0.5 * hF, z), at(foot, x + 0.17 * lF, -0.85 * hF, z)], [0.03 * lF, 0.003 * lF], [w, w], () => pal.keratin, 5, 0.1, 0.1);
    }
  } else if (type === 'claw' || type === 'hand') {
    const hand = type === 'hand', toeR = hand ? 0.06 * lF : Math.max(0.035 * lF, 0.45 * hF);
    const toes = hand ? [-0.36, -0.12, 0.12, 0.36] : [-0.42, 0, 0.42];
    if (hand) ellipsoid(s, at(foot, 0.32 * lF, -0.6 * hF), [ax, ay, az], [0.36 * lF, 0.4 * hF, 0.22 * lF], wb, () => pal.skin, 10, 5);
    else ellipsoid(s, at(foot, 0.02 * lF, -0.3 * hF), [ax, ay, az], [toeR * 2, toeR * 1.5, toeR * 2], wb, () => mixC(pal.keratin, pal.skin, 0.5), 8, 4);
    for (const a of toes) {
      const len = (hand ? 0.55 : 1 - 0.25 * Math.abs(a)) * lF, base = hand ? at(foot, 0.6 * lF, -0.6 * hF, a * 0.5 * lF) : at(foot, 0.02 * lF, -0.4 * hF, 0);
      const dir = ax.clone().multiplyScalar(Math.cos(a)).addScaledVector(az, Math.sin(a) * side * (hand ? 0.3 : 1)).normalize();
      const pts = [0, 0.35, 0.7, 0.95].map(f => base.clone().addScaledVector(dir, len * f).addScaledVector(ay, -hF * 0.55 * f + (hand ? 0 : hF * 0.1)));
      tube(s, pts, [toeR, toeR * 0.85, toeR * 0.7, toeR * 0.5], pts.map(() => w), () => hand ? pal.skin : mixC(pal.keratin, pal.skin, 0.55), 7, 0.3, 0.2);
      const tip = pts[3]!, claw = [tip, tip.clone().addScaledVector(dir, toeR * 2.2).addScaledVector(ay, -toeR * 0.2), tip.clone().addScaledVector(dir, toeR * 3.6).addScaledVector(ay, -toeR * 1.1)];
      tube(s, claw, [toeR * 0.5, toeR * 0.32, toeR * 0.03], [w, w, w], () => pal.keratin, 6, 0.1, 0.1);
    }
    // hallux / thumb: backward (bird, dinosaur) or sideways (grasping foot)
    const hDir = hand ? ax.clone().multiplyScalar(0.3).addScaledVector(az, -side * 0.95).normalize() : ax.clone().negate().addScaledVector(az, -side * 0.15).normalize();
    const hb = hand ? at(foot, 0.25 * lF, -0.6 * hF, -side * 0.2 * lF) : at(foot, 0, -0.5 * hF, 0);
    const hp = [0, 0.5, 1].map(f => hb.clone().addScaledVector(hDir, (hand ? 0.35 : 0.3) * lF * f).addScaledVector(ay, -0.4 * hF * f));
    tube(s, hp, [toeR * 0.9, toeR * 0.7, toeR * 0.35], [w, w, w], () => hand ? pal.skin : pal.keratin, 6, 0.3, 0.2);
  } else {
    // spike: tapered tarsus tip
    tube(s, [at(foot, 0, 0.25 * hF), at(foot, 0.08 * hF, -0.5 * hF), at(foot, 0.12 * hF, -hF)], [r0, r0 * 0.6, r0 * 0.06], [wb, w, w], (i) => i ? pal.keratin : mixC(pal.keratin, pal.accent, 0.4), 6, 0.1, 0.05);
  }
}

function buildHand(s: Skin, type: ComposerRecipe['hands'], fore: ComposerBone, hand: ComposerBone, finger: ComposerBone, side: number, pal: Palette, at: At, axis: Axis, coat: (p: THREE.Vector3) => RGB) {
  const wh = [[hand.index, 1]] as W, wf = [[finger.index, 1]] as W, wb = [[hand.index, 0.5], [fore.index, 0.5]] as W, wj = [[hand.index, 0.5], [finger.index, 0.5]] as W;
  const ax = axis(hand, 1, 0, 0), ay = axis(hand, 0, 1, 0), az = axis(hand, 0, 0, 1);
  const lh = hand.length, lf = finger.length, r0 = Math.max(fore.end.w, 1e-3);
  if (type === 'pincer') {
    const big = Math.max(lh * 1.6, r0 * 3);
    ellipsoid(s, at(hand, big * 0.45), [ax, ay, az], [big * 0.6, r0 * 1.7, r0 * 1.4], wb, () => mixC(pal.plate, pal.accent, 0.3), 12, 6);
    const fixed = [0, 0.5, 1].map(f => at(hand, big * (0.9 + 0.7 * f), r0 * (0.6 - 0.7 * f * f)));
    tube(s, fixed, [r0 * 0.7, r0 * 0.45, r0 * 0.05], [wh, wh, wh], () => pal.keratin, 8, 0.2, 0.1);
    const dact = [0, 0.5, 1].map(f => at(finger, big * (0.45 + 0.7 * f) - lf * 0, -r0 * (0.6 - 0.6 * f * f)));
    tube(s, dact, [r0 * 0.65, r0 * 0.42, r0 * 0.05], [wf, wf, wf], () => pal.keratin, 8, 0.2, 0.1);
    return;
  }
  const claw = type === 'claw';
  ellipsoid(s, at(hand, lh * 0.5), [ax, ay, az], [lh * 0.62, r0 * 0.7, r0 * (claw ? 1 : 1.25)], wb, (_a, _f, p) => claw ? coat(p) : pal.skin, 10, 5);
  const digits = claw ? [-0.5, 0, 0.5] : [-0.45, -0.15, 0.15, 0.45];
  for (const k of digits) {
    const len = lf * (claw ? 2.2 : 1.6) * (1 - 0.2 * Math.abs(k));
    const base = at(hand, lh * 0.95, 0, k * r0 * 1.6);
    const pts = [base, ...[0.33, 0.66, 1].map(f => at(finger, len * f, -len * 0.18 * f * f, k * r0 * 1.6 * (1 - 0.15 * f)))];
    tube(s, pts, claw ? [r0 * 0.35, r0 * 0.28, r0 * 0.18, r0 * 0.02] : [r0 * 0.28, r0 * 0.24, r0 * 0.2, r0 * 0.14], [wj, wf, wf, wf], () => claw ? pal.keratin : pal.skin, 6, 0.2, claw ? 0.05 : 0.6);
  }
  if (!claw) {
    const tb = at(hand, lh * 0.35, -r0 * 0.3, -side * r0 * 1.1), tdir = ax.clone().addScaledVector(az, -side * 0.8).addScaledVector(ay, -0.3).normalize();
    tube(s, [tb, tb.clone().addScaledVector(tdir, lf * 0.9), tb.clone().addScaledVector(tdir, lf * 1.5)], [r0 * 0.3, r0 * 0.24, r0 * 0.16], [wh, wh, wh], () => pal.skin, 6, 0.2, 0.6);
  }
}

function buildWing(s: Skin, graph: ComposerGraph, chain: ComposerBone[], carrier: ComposerBone, side: number, pal: Palette, at: At, axis: Axis, coat: (p: THREE.Vector3, u: number) => RGB) {
  const r = graph.recipe, feathered = r.wings === 'feathered';
  const total = chain.reduce((a, b) => a + b.length, 0);
  const stations = 16, rows = 4;
  const top: number[][] = [], bottom: number[][] = [];
  const thickness = composerWingThickness(feathered, total);
  const grid: {p: THREE.Vector3; n: THREE.Vector3; w: W; col: RGB}[][] = [];
  for (let i = 0; i <= stations; i++) {
    const sArc = i / stations * total;
    let k = 0, acc = 0; while (k < chain.length - 1 && acc + chain[k]!.length < sArc - 1e-9) { acc += chain[k]!.length; k++; }
    const bone = chain[k]!, local = sArc - acc, f = local / bone.length;
    const lead = at(bone, local), back = axis(bone, 0, 0, 1).multiplyScalar(side), up = axis(bone, 0, 1, 0);
    const u = i / stations;
    const chord = composerWingChord(feathered, total, u);
    const row: typeof grid[number] = [];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const near = f < 0.5 && k > 0 ? [[chain[k - 1]!.index, 0.5 * (1 - smooth(0, 0.5, f))], [bone.index, 1]] as W : f > 0.5 && k < chain.length - 1 ? [[chain[k + 1]!.index, 0.5 * smooth(0.5, 1, f)], [bone.index, 1]] as W : [[bone.index, 1]] as W;
      let w: W = near;
      // the membrane's inner trailing edge joins the flank
      if (!feathered && u < 0.2) w = [...near.map(([b, x]) => [b, x * (1 - v * (1 - u / 0.2))] as [number, number]), [carrier.index, v * (1 - u / 0.2)]];
      const p = lead.clone().addScaledVector(back, chord * v).addScaledVector(up, chord * 0.06 * Math.sin(Math.PI * v));
      const col: RGB = feathered ? mixC(mixC(coat(p, u), pal.accent, smooth(0.45, 0.9, v) * 0.8), pal.keratin, smooth(0.75, 1, u) * 0.5 * v) : mixC(mixC(pal.skin, pal.accent, 0.35), pal.keratin, 0.25 * smooth(0.6, 1, v));
      row.push({p, n: up, w, col});
    }
    grid.push(row);
  }
  for (const row of grid) {
    top.push(row.map(({p, n, w, col}, j) => s.v(p.clone().addScaledVector(n, thickness * 0.5 * (1 - 0.7 * j / rows)), col, w)));
    bottom.push(row.map(({p, n, w, col}, j) => s.v(p.clone().addScaledVector(n, -thickness * 0.5 * (1 - 0.7 * j / rows)), mixC(col, [0.8, 0.78, 0.74], 0.12), w)));
  }
  const centroid = V(); let count = 0; for (const row of grid) for (const g of row) { centroid.add(g.p); count++; } centroid.multiplyScalar(1 / count);
  for (let i = 0; i < stations; i++) for (let j = 0; j < rows; j++) {
    const n = grid[i]![j]!.n;
    s.to(top[i]![j]!, top[i + 1]![j]!, top[i]![j + 1]!, n); s.to(top[i + 1]![j]!, top[i + 1]![j + 1]!, top[i]![j + 1]!, n);
    const m = n.clone().negate();
    s.to(bottom[i]![j]!, bottom[i + 1]![j]!, bottom[i]![j + 1]!, m); s.to(bottom[i + 1]![j]!, bottom[i + 1]![j + 1]!, bottom[i]![j + 1]!, m);
  }
  // seal the perimeter
  const edge: [number, number][] = [];
  for (let i = 0; i <= stations; i++) edge.push([i, 0]);
  for (let j = 1; j <= rows; j++) edge.push([stations, j]);
  for (let i = stations - 1; i >= 0; i--) edge.push([i, rows]);
  for (let j = rows - 1; j >= 1; j--) edge.push([0, j]);
  for (let e = 0; e < edge.length; e++) {
    const [i0, j0] = edge[e]!, [i1, j1] = edge[(e + 1) % edge.length]!;
    const out = grid[i0]![j0]!.p.clone().add(grid[i1]![j1]!.p).multiplyScalar(0.5).sub(centroid);
    s.to(top[i0]![j0]!, bottom[i0]![j0]!, top[i1]![j1]!, out); s.to(top[i1]![j1]!, bottom[i0]![j0]!, bottom[i1]![j1]!, out);
  }
  // finger struts on membranes, covert feather ridge on feathered wings
  if (!feathered) {
    const hand = chain[chain.length - 1]!;
    for (const a of [0.35, 0.75]) {
      const base = at(hand, 0), dir = axis(hand, 1, 0, 0).multiplyScalar(Math.cos(a)).addScaledVector(axis(hand, 0, 0, 1), side * Math.sin(a)).normalize();
      const len = hand.length * (1.2 - 0.4 * a);
      tube(s, [base, base.clone().addScaledVector(dir, len * 0.5), base.clone().addScaledVector(dir, len)], [hand.start.w * 0.5, hand.start.w * 0.35, hand.start.w * 0.1], [[[hand.index, 1]], [[hand.index, 1]], [[hand.index, 1]]], () => pal.keratin, 5, 0.1, 0.1);
    }
  }
  for (const bone of chain) tube(s, [at(bone, 0), at(bone, bone.length)], [bone.start.w, bone.end.w], [[[bone.index, 1]], [[bone.index, 1]]], (_i, _a, p) => feathered ? coat(p, 0) : pal.skin, 7, 0.4, 0.4);
}

function buildArmor(s: Skin, graph: ComposerGraph, pal: Palette, at: At, axis: Axis, seed: number, ind: SkinIndividual) {
  const r = graph.recipe, bones = graph.bones, torso = graph.chains.torso.map(i => bones[i]!);
  const n = torso.length, total = torso.reduce((a, b) => a + b.length, 0);
  const flexible = r.layout === 'limbless' || r.layout === 'many-legged';
  const sample = (u: number) => {
    // position along the torso chain at fraction u (may extrapolate slightly)
    const x = clamp(u, -0.12, 1.12) * total; let acc = 0, k = 0;
    while (k < n - 1 && acc + torso[k]!.length < x) { acc += torso[k]!.length; k++; }
    const bone = torso[k]!, local = x - acc, f = clamp(local / bone.length, 0, 1);
    const sec = {w: mix(bone.start.w, bone.end.w, f), h: mix(bone.start.h, bone.end.h, f), yc: mix(bone.start.yc, bone.end.yc, f)};
    const prev = torso[k - 1], next = torso[k + 1];
    const w: W = f < 0.5 && prev ? [[prev.index, 0.5 * (1 - smooth(0, 0.5, f))], [bone.index, 1]] : f > 0.5 && next ? [[next.index, 0.5 * smooth(0.5, 1, f)], [bone.index, 1]] : [[bone.index, 1]];
    return {bone, local, sec, w};
  };
  if (r.armor === 'dome') {
    const [u0, u1] = flexible ? [0.33, 0.67] : [-0.08, 1.04];
    const rings: Ring[] = [], count = 10;
    for (let i = 0; i <= count; i++) {
      const u = mix(u0, u1, i / count), {bone, local, sec, w} = sample(u);
      const along = i / count, env = Math.pow(Math.sin(Math.PI * mix(0.08, 0.92, along)), 0.45);
      const c = at(bone, local, sec.yc + sec.h * 0.12);
      const ax = axis(bone, 1, 0, 0), ay = axis(bone, 0, 1, 0);
      rings.push({c, t: ax, u: ay, rx: sec.w * 1.25 * env, ry: sec.h * 1.32 * env, ryBelow: sec.h * Math.min(1.32 * env, 1.1), w, color: a => {
        const up = Math.sin(a);
        if (up < -0.15) return mixC(pal.belly, pal.plate, 0.35);
        const cell = Math.abs(Math.sin(along * Math.PI * 5)) < 0.12 || Math.abs(Math.sin(a * 3)) < 0.1;
        return up < 0.1 ? mixC(pal.plate, pal.belly, 0.4) : cell ? mixC(pal.plate, pal.keratin, 0.6) : mixC(pal.plate, pal.horn, 0.25 + 0.15 * Math.sin(seed + along * 13));
      }});
    }
    // the plastron (lower half) stops at the torso's underside instead of hanging below the belly
    loft(s, rings, 24, 0.25, 0.25);
    return;
  }
  if (r.armor === 'bands') {
    const count = flexible ? n : Math.max(6, n * 2);
    for (let k = 0; k < count; k++) {
      // bands overlap their neighbour but the front band stops at the torso's end: past it the body narrows into the
      // neck and a full-size shell would hang open over it
      const u0 = (k + 0.05) / count, u1 = Math.min((k + 1.15) / count, 0.985);
      const a0 = -0.35, a1 = Math.PI + 0.35, steps = 12;
      const ids: number[][][] = [];
      for (const [ui, u] of [u0, u1].entries()) {
        const {bone, local, sec, w} = sample(u), ay = axis(bone, 0, 1, 0), az = axis(bone, 0, 0, 1), c = at(bone, local, sec.yc);
        const layer: number[][] = [];
        // the exposed ends of the first and last band sink flush into the body instead of showing a dark open lip
        const flush = (k === count - 1 && ui === 1) || (k === 0 && ui === 0);
        for (const scale of flush ? [1.03, 0.95] : [1.16, 1.02]) {
          const row: number[] = [];
          for (let q = 0; q <= steps; q++) {
            const a = mix(a0, a1, q / steps), p = c.clone().addScaledVector(az, -Math.cos(a) * sec.w * scale).addScaledVector(ay, Math.sin(a) * sec.h * scale);
            row.push(s.v(p, mixC(pal.plate, pal.keratin, ui ? 0.35 : 0.1), w));
          }
          layer.push(row);
        }
        ids.push(layer);
      }
      // outer, inner, front, back and arc-end faces
      const [front, back] = ids as [number[][], number[][]];
      const centre = (u: number) => { const {bone, local, sec} = sample(u); return at(bone, local, sec.yc); };
      const cMid = centre((u0 + u1) / 2);
      for (let q = 0; q < steps; q++) {
        const o = (a: number, b: number, c: number, out: THREE.Vector3) => s.to(a, b, c, out);
        const outward = s.pos(front[0]![q]!).sub(cMid);
        o(front[0]![q]!, front[0]![q + 1]!, back[0]![q]!, outward); o(front[0]![q + 1]!, back[0]![q + 1]!, back[0]![q]!, outward);
        o(front[1]![q]!, front[1]![q + 1]!, back[1]![q]!, outward.clone().negate()); o(front[1]![q + 1]!, back[1]![q + 1]!, back[1]![q]!, outward.clone().negate());
        const fw = centre(u0).sub(cMid), bw = centre(u1).sub(cMid);
        o(front[0]![q]!, front[0]![q + 1]!, front[1]![q]!, fw); o(front[0]![q + 1]!, front[1]![q + 1]!, front[1]![q]!, fw);
        o(back[0]![q]!, back[0]![q + 1]!, back[1]![q]!, bw); o(back[0]![q + 1]!, back[1]![q + 1]!, back[1]![q]!, bw);
      }
      for (const q of [0, steps]) {
        const out = s.pos(front[0]![q]!).sub(s.pos(front[0]![steps / 2]!));
        s.to(front[0]![q]!, front[1]![q]!, back[0]![q]!, out); s.to(front[1]![q]!, back[1]![q]!, back[0]![q]!, out);
      }
    }
    return;
  }
  if (r.armor === 'plates') {
    const tailBones = graph.chains.tail.slice(0, Math.ceil(graph.chains.tail.length / 2)).map(i => bones[i]!);
    const list: {bone: ComposerBone; local: number; sec: {w: number; h: number; yc: number}; w: W; size: number}[] = [];
    const count = flexible ? n : Math.max(3, 9 + ind.traits.countScale.plate);
    for (let k = 0; k < count; k++) { const u = (k + 0.5) / count, smp = sample(u); list.push({...smp, size: 0.6 + 0.5 * Math.sin(Math.PI * u)}); }
    for (const [k, bone] of tailBones.entries()) list.push({bone, local: bone.length * 0.5, sec: {w: bone.start.w, h: bone.start.h, yc: 0}, w: [[bone.index, 1]], size: 0.7 - 0.12 * k});
    list.forEach(({bone, local, sec, w, size}, k) => {
      // alternating height noise: neighbouring plates differ, never a perfectly regular comb
      const noise = ind.jv * ((k % 2 ? 0.07 : -0.07) + 0.12 * (jitterU(ind.plateSeed, k, 0) - 0.5));
      const hgt = Math.max(sec.h, graph.dims.torsoHeight * 0.5) * 0.85 * size * (1 + noise), len = hgt * 0.95;
      const ax = axis(bone, bone.part === 'tail' ? -1 : 1, 0, 0), ay = axis(bone, 0, 1, 0), az = axis(bone, 0, 0, 1);
      const base = at(bone, local, sec.yc + sec.h * 0.82).addScaledVector(az, (k % 2 ? 1 : -1) * sec.w * 0.14);
      slab(s, base, ax, ay, [[-len * 0.5, 0], [-len * 0.3, hgt * 0.7], [0, hgt], [len * 0.35, hgt * 0.65], [len * 0.5, 0]], hgt * 0.07, w, (_x, y) => mixC(pal.plate, pal.accent, smooth(0.5, 1, y / hgt) * 0.6));
    });
    return;
  }
  // osteoderms: rows of keeled studs over the back and flanks, jittered per individual (+-0.25 cell, +-15% size)
  const rows = Math.max(3, (flexible ? n * 2 : 10) + ind.traits.countScale.osteoderm), angles = [0.55, 0.95, 1.5707, 2.19, 2.59];
  for (let k = 0; k < rows; k++) for (const [ai, a0] of angles.entries()) {
    const ju = ind.jv * (jitterU(ind.osteoSeed, k, ai * 3) - 0.5) * 0.5, ja = ind.jv * (jitterU(ind.osteoSeed, k, ai * 3 + 1) - 0.5) * 0.2;
    const js = 1 + ind.jv * (jitterU(ind.osteoSeed, k, ai * 3 + 2) - 0.5) * 0.3;
    const u = (k + 0.5 + (ai % 2) * 0.5 + ju) / (rows + 0.5), a = a0 + ja, {bone, local, sec, w} = sample(u);
    const ay = axis(bone, 0, 1, 0), az = axis(bone, 0, 0, 1), c = at(bone, local, sec.yc);
    const normal = az.clone().multiplyScalar(-Math.cos(a) * sec.h).addScaledVector(ay, Math.sin(a) * sec.w).normalize();
    const surface = c.clone().addScaledVector(az, -Math.cos(a) * sec.w * 0.97).addScaledVector(ay, Math.sin(a) * sec.h * 0.97);
    const size = Math.min(sec.w, sec.h) * 0.16 * js;
    tube(s, [surface.clone().addScaledVector(normal, -size * 0.4), surface.clone().addScaledVector(normal, size * 0.55), surface.clone().addScaledVector(normal, size * 0.95)], [size, size * 0.75, size * 0.08], [w, w, w], (i) => i ? mixC(pal.plate, pal.horn, 0.4) : pal.plate, 5, 0.1, 0.05);
  }
}
