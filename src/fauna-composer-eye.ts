/**
 * Eye geometry for the modular creature composer (fauna-composer-eye-1, face round WP4; fauna-composer-eye-2, eye round EC2).
 *
 * Pure: plain number arrays, no rendering library, no randomness, no clock, so every function here can be
 * unit-tested in node. Erasable TypeScript only (Node type-strips src/*.ts). The mesh glue
 * (fauna-composer-mesh.ts) places, colours and skins what these functions return.
 *
 * All coordinates are head-local (x forward along the head bone, y up, z lateral), in metres.
 *
 * - raycastFirstHit / raycastLine / nearestExit: ray and line queries against a triangle soup (9 numbers per
 *   triangle, outward winding), used to seat an eye on the already-built skull.
 * - buildEyePatch: a lidded vertebrate eye, a 20-segment ring patch: pupil (round, horizontal bar or vertical slit),
 *   iris, limbus, an almond lid opening, a raised outer lid and an orbit ring that lies on the skull surface. A cone
 *   behind it closes the patch, so the eye part is a closed outward surface like every other part.
 * - buildCompoundEye: an arthropod compound-eye dome (12 x 5) with a facet checker and a dark pseudopupil at its apex.
 * - buildEyespot: a worm's flush pigment eyespot (8 triangles).
 *
 * fauna-composer-eye-2 (eye catalogue EC2) appends the catalogue geometry and leaves every function above untouched, so
 * the face round's build ("Earlier eye rules", eyeRules 1) stays byte-identical:
 * - catalogueEyeSpec + buildEyePatch({spec}): the same 20-segment, 7-ring patch (280 triangles) with preset pupils
 *   (slit-wide, beaded-slit, W, pinhole, dilated, rounded bar), lid shapes (round, wide-almond, spectacle, turret), brow
 *   deformers of the existing rings (shelf, raised orbit, facial disc, turret cone), a white-sclera ring layout, an
 *   in-plane roll, a nictitating-membrane role and a per-vertex iris pattern factor;
 * - buildFacetedEye: a compound eye whose cells are raised lenses on a dark lattice, so it reads as faceted (not a lump);
 * - buildOcellus: a glossy simple-eye bead (spider eyes, insect ocelli);
 * - buildEyespotBead: a domed, glossy pigment eyespot with a pale rim, closed behind;
 * - buildStalk: a tapered, closed eye stalk.
 */

export const COMPOSER_EYE_VERSION = 'fauna-composer-eye-2';
export type Vec3 = [number, number, number];
export type LiddedEyeType = 'round' | 'horizontal' | 'vertical-slit';

/** Per-vertex roles. The mesh glue colours by role; gloss is per role too. Append-only: the first 12 are
 * fauna-composer-eye-1's; the rest belong to the eye catalogue geometry (fauna-composer-eye-2). */
export const EYE_ROLES = ['pupil', 'iris-inner', 'iris', 'limbus', 'lid', 'outer-lid', 'orbit', 'socket', 'facet-a', 'facet-b', 'pseudopupil', 'eyespot',
  'sclera', 'brow', 'nictitans', 'turret', 'ocellus', 'ocellus-rim', 'stalk', 'facet-edge', 'eyespot-rim', 'periocular'] as const;
export type EyeRole = typeof EYE_ROLES[number];
export const EYE_ROLE: Readonly<Record<EyeRole, number>> = Object.freeze(Object.fromEntries(EYE_ROLES.map((r, i) => [r, i])) as Record<EyeRole, number>);

/** Lidded-eye layout, in units of the eye radius er (radii in the eye plane, lifts along the gaze). */
export const EYE_PATCH = Object.freeze({
  segments: 20,
  /** pupil edge radius (round); the bar and slit use their own half-axes below */
  pupil: 0.34, pupilInnerScale: 1.06, iris: 0.65, limbus: 0.92,
  horizontalPupil: {rx: 0.55, ry: 0.16, n: 4},
  slitPupil: {rx: 0.08, ry: 0.46, point: 0.6},
  /** vertical slit: the iris fills this fraction of the opening */
  slitIrisFill: 0.95, slitIrisInner: 0.85,
  /** lid opening (almond): half-width, half-height above and below */
  lid: {w: 1, above: 0.72, below: 0.62},
  outerLid: {w: 1.2, above: 0.95, below: 0.85},
  orbit: {w: 1.55, above: 1.35, below: 1.25},
  /** inner rings are clipped to these fractions of the lid opening (pupil edge, inner iris, iris, limbus) */
  clip: [0.8, 0.84, 0.9, 0.98] as readonly number[],
  /** eye centre below the skull surface; every ring's lift above the skin under it: the eyeball (+ the cornea dome toward
   * the centre), the lid margin, the outer lid (at most outerLidDrop below the margin) and the orbit */
  recess: 0.2, eyeLift: 0.03, lidLift: 0.10, outerLidLift: 0.08, outerLidDrop: 0.06, orbitLift: 0.01,
  /** the exposed eyeball is a sphere cap of this radius cut at the limbus (height ~0.34 er, rim slope ~41 deg), so a
   * light within ~80 deg of the view finds a mirror normal on it: the corneal highlight */
  corneaRadius: 1.4,
  /** a rim vertex looks for the skull surface within this distance of the hit plane */
  rimSearch: 1.0,
  /** a rim vertex whose line misses takes the depth of the closest skull point within this distance */
  closestSearch: 2.5,
  /** the closing cone's apex behind the eye centre */
  socketDepth: 0.8,
});
export const EYE_GLOSS = Object.freeze({cornea: 1, lid: 0.4, compound: 0.35});
/** Compound eye dome: radial segments x stations (apex excluded); facet shading amplitude. */
export const COMPOUND_EYE = Object.freeze({segments: 12, stations: 5, facet: 0.08});
export const EYESPOT_SEGMENTS = 8;

export interface RayHit {
  /** Distance along `dir` (negative behind the origin for line queries). */
  t: number; point: Vec3;
  /** Unit geometric normal of the hit triangle (its winding). */
  normal: Vec3;
  /** Triangle index and barycentric weights of vertices b and c (a gets 1 - u - v). */
  tri: number; u: number; v: number;
}
export interface EyePatch {
  /** xyz per vertex, head-local */
  positions: number[];
  roles: Uint8Array;
  gloss: number[];
  /** three vertex indices per triangle, outward winding */
  index: number[];
  /** Per vertex: the skull-surface hit a rim vertex was projected onto (lid, outer lid and orbit rings), else null. */
  surface: (RayHit | null)[];
  /** Vertices that found no skull surface (neither along the gaze nor within EYE_PATCH.closestSearch) and kept the hit plane. */
  rimFallbacks: number;
  /** First vertex of each ring (centre first), for measurement. */
  rings: number[];
  /** Catalogue path only: per-vertex iris pattern factor (1 = plain), applied by the mesh to the iris colours. */
  shade?: number[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const addS = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const normalize3 = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-15 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

type Tris = ArrayLike<number>;
/** Every crossing of the full line origin + t dir (t of either sign), sorted by t. Shared edges may report twice. */
export function raycastLine(tris: Tris, origin: Vec3, dir: Vec3): RayHit[] {
  const out: RayHit[] = [];
  const [ox, oy, oz] = origin, [dx, dy, dz] = dir;
  for (let i = 0, n = Math.floor(tris.length / 9); i < n; i++) {
    const o = i * 9, ax = tris[o]!, ay = tris[o + 1]!, az = tris[o + 2]!;
    const e1x = tris[o + 3]! - ax, e1y = tris[o + 4]! - ay, e1z = tris[o + 5]! - az, e2x = tris[o + 6]! - ax, e2y = tris[o + 7]! - ay, e2z = tris[o + 8]! - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-18) continue;
    const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    const normal = normalize3([e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x]);
    out.push({t, point: [ox + dx * t, oy + dy * t, oz + dz * t], normal, tri: i, u, v});
  }
  return out.sort((a, b) => a.t - b.t);
}
/** First hit in front of the origin (t > 1e-9), or null. */
export function raycastFirstHit(tris: Tris, origin: Vec3, dir: Vec3): RayHit | null {
  for (const h of raycastLine(tris, origin, dir)) if (h.t > 1e-9) return h;
  return null;
}
/** The exit crossing (normal along dir) of the line through `point` that lies nearest to it, within |t| <= maxAbsT.
 * Choosing the crossing nearest the intended site, rather than the first hit of a ray, keeps a brow, beak or ear
 * that the line passes through from capturing the eye. */
export function nearestExit(tris: Tris, point: Vec3, dir: Vec3, maxAbsT = Infinity): RayHit | null {
  let best: RayHit | null = null;
  for (const h of raycastLine(tris, point, dir)) if (dot(h.normal, dir) > 0 && Math.abs(h.t) <= maxAbsT && (!best || Math.abs(h.t) < Math.abs(best.t))) best = h;
  return best;
}

/** The closest point of a triangle soup to `p` (Ericson's region test per triangle), with its triangle, barycentric
 * weights and geometric normal; t is 0 (the caller measures depth). */
export function closestPointOnSoup(tris: Tris, p: Vec3): RayHit | null {
  let best: RayHit | null = null, bestD = Infinity;
  for (let i = 0, n = Math.floor(tris.length / 9); i < n; i++) {
    const o = i * 9, A: Vec3 = [tris[o]!, tris[o + 1]!, tris[o + 2]!], B: Vec3 = [tris[o + 3]!, tris[o + 4]!, tris[o + 5]!], C: Vec3 = [tris[o + 6]!, tris[o + 7]!, tris[o + 8]!];
    const [u, v] = closestBary(A, B, C, p), q: Vec3 = [A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v, A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * v];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = {t: 0, point: q, normal: normalize3(cross(sub(B, A), sub(C, A))), tri: i, u, v}; }
  }
  return best;
}
/** Tie window (head-local metres) for closestPointOnSoupLowTie: tied candidates differ by <= ~1.4e-17 m (engine noise),
 * distinct ones by >= ~4.5e-6 m (docs/fauna-eye-seat-tie-2026-10-08.md); the same window as the mesh's SEAM_TIE. */
const CLOSEST_TIE = 1e-9;
/** closestPointOnSoup with an engine-independent tie rule, for the catalogue patch's surfaceZ fallback only. The closest
 * point of a soup often lies on an edge two triangles share: both give the same point and distance, and which one is
 * "closer" (whose normal wrap() then lifts the rim vertex along) was a 1-ulp question. WebKit 26.5 kept the other half
 * of the ostrich's neck-to-head blend quad than Node/Chromium/Firefox (8.1e-6 m on two orbit vertices). Every triangle
 * within CLOSEST_TIE of the best distance ties, and the lowest triangle index wins, never the rounding (the SEAM_TIE /
 * seamNormal precedent in fauna-composer-mesh.ts). The hit is built exactly as closestPointOnSoup builds it. */
function closestPointOnSoupLowTie(tris: Tris, p: Vec3): RayHit | null {
  const n = Math.floor(tris.length / 9), dist = new Float64Array(n);
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 9, A: Vec3 = [tris[o]!, tris[o + 1]!, tris[o + 2]!], B: Vec3 = [tris[o + 3]!, tris[o + 4]!, tris[o + 5]!], C: Vec3 = [tris[o + 6]!, tris[o + 7]!, tris[o + 8]!];
    const [u, v] = closestBary(A, B, C, p), qx = A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v - p[0], qy = A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v - p[1], qz = A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * v - p[2];
    dist[i] = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (dist[i]! < best) best = dist[i]!;
  }
  for (let i = 0; i < n; i++) {
    if (!(dist[i]! <= best + CLOSEST_TIE)) continue;
    const o = i * 9, A: Vec3 = [tris[o]!, tris[o + 1]!, tris[o + 2]!], B: Vec3 = [tris[o + 3]!, tris[o + 4]!, tris[o + 5]!], C: Vec3 = [tris[o + 6]!, tris[o + 7]!, tris[o + 8]!];
    const [u, v] = closestBary(A, B, C, p), q: Vec3 = [A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v, A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * v];
    return {t: 0, point: q, normal: normalize3(cross(sub(B, A), sub(C, A))), tri: i, u, v};
  }
  return null;
}
/** Barycentric (u for B, v for C) of the closest point of triangle ABC to p. */
function closestBary(a: Vec3, b: Vec3, c: Vec3, p: Vec3): [number, number] {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return [d1 / (d1 - d3), 0];
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return [0, d2 / (d2 - d6)];
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [1 - w, w]; }
  const den = 1 / (va + vb + vc);
  return [vb * den, vc * den];
}

/** The outermost exit crossing (largest t, normal along dir) of the line through `point` within |t| <= maxAbsT. A ring
 * vertex is seated on it so that no overlapping skull surface (a jaw loft, a cheek) lies outside the eye and hides it. */
export function outermostExit(tris: Tris, point: Vec3, dir: Vec3, maxAbsT: number): RayHit | null {
  let best: RayHit | null = null;
  for (const h of raycastLine(tris, point, dir)) if (dot(h.normal, dir) > 0 && Math.abs(h.t) <= maxAbsT && (!best || h.t > best.t)) best = h;
  return best;
}

/** Unit gaze from a yaw (degrees from the forward midline toward `side`) and a pitch (degrees up), head-local. */
export function eyeGaze(yawDeg: number, pitchDeg: number, side: number): Vec3 {
  const y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
  return [Math.cos(p) * Math.cos(y), Math.sin(p), side * Math.cos(p) * Math.sin(y)];
}
/** In-plane axis of the eye (the pupil bar and the lid opening's long axis): the head-forward projection onto the eye
 * plane blended 0.7 toward the world-horizontal projection, which counter-rolls the rest head pitch. `worldUp` is the
 * world up direction in head-local coordinates. Signed so that gaze x axis points up. */
export function eyeBarAxis(gaze: Vec3, worldUp: Vec3, headForward: Vec3 = [1, 0, 0]): Vec3 {
  const g = normalize3(gaze);
  const proj = (v: Vec3) => addS(v, g, -dot(v, g));
  let hw = cross(worldUp, g);
  if (Math.hypot(...hw) < 1e-6) hw = proj([1, 0, 0]);
  hw = normalize3(hw);
  const hf = proj(headForward), hfl = Math.hypot(...hf);
  let axis = hw;
  if (hfl > 0.2) {
    const hfn = scale(hf, 1 / hfl), s = dot(hfn, hw) < 0 ? -1 : 1;
    axis = normalize3(addS(scale(hfn, 0.3), hw, 0.7 * s));
  }
  // in-plane up = gaze x axis; flip the axis so that up is up (lid above, lid below)
  if (dot(cross(g, axis), worldUp) < 0) axis = scale(axis, -1);
  return axis;
}

/** Almond lid opening: in-plane point at angle th (radians) for half-width w and half-heights above/below. */
export function lidPoint(th: number, w: number, above: number, below: number): [number, number] {
  const c = Math.cos(th), s = Math.sin(th);
  return [w * c, (s >= 0 ? above : below) * s * (1 - 0.25 * c * c)];
}
/** Pupil edge in-plane point at angle th, in er. */
export function pupilPoint(type: LiddedEyeType, th: number): [number, number] {
  const c = Math.cos(th), s = Math.sin(th), E = EYE_PATCH;
  if (type === 'horizontal') { const e = 2 / E.horizontalPupil.n; return [E.horizontalPupil.rx * Math.sign(c) * Math.abs(c) ** e, E.horizontalPupil.ry * Math.sign(s) * Math.abs(s) ** e]; }
  if (type === 'vertical-slit') return [E.slitPupil.rx * c * Math.abs(c) ** E.slitPupil.point, E.slitPupil.ry * s];
  return [E.pupil * c, E.pupil * s];
}

export interface EyePatchOptions {
  type: LiddedEyeType;
  /** eye radius, metres */
  er: number;
  /** eye centre (recess below the skull surface), head-local */
  centre: Vec3;
  gaze: Vec3;
  /** in-plane long axis (eyeBarAxis); default: from `up` */
  barAxis?: Vec3;
  /** head-local up, used when barAxis is omitted */
  up?: Vec3;
  /** head triangles (9 numbers each) the lid and orbit rings are projected onto; omitted: the hit plane */
  surface?: Tris;
  /** fauna-composer-eye-2: a catalogue preset (catalogueEyeSpec). Omitted: the face round's exact build. */
  spec?: CatalogueEyeSpec;
  /** catalogue path: head-forward, head-local (default +x); orients the roll and the nictitating membrane */
  forward?: Vec3;
  /** catalogue path: rim vertices never cross this plane (unit normal n, minimum offset along it, metres), so two
   * frontal eyes' rims and facial discs never overlap at the midline */
  midline?: {n: Vec3; min: number};
  /** catalogue turret: where the eye looks (unit, head-local) when the patch is built along the skull normal; the
   * aperture leans that way by CATALOGUE_EYE.turret.lean x its in-plane part */
  look?: Vec3;
}
/** A lidded vertebrate eye. 141 front vertices (centre + 7 rings of 20) + a 21-vertex closing cone; 280 triangles. */
export function buildEyePatch(o: EyePatchOptions): EyePatch {
  if (o.spec) return buildCataloguePatch(o, o.spec);
  const E = EYE_PATCH, N = E.segments, er = o.er, g = normalize3(o.gaze), c0 = o.centre;
  const a = o.barAxis ? normalize3(addS(o.barAxis, g, -dot(o.barAxis, g))) : eyeBarAxis(g, o.up ?? [0, 1, 0]);
  const b = cross(g, a);
  const positions: number[] = [], roles: number[] = [], gloss: number[] = [], index: number[] = [], surface: (RayHit | null)[] = [], rings: number[] = [];
  let rimFallbacks = 0;
  const at = (x: number, y: number, z: number): Vec3 => [c0[0] + (a[0] * x + b[0] * y + g[0] * z) * er, c0[1] + (a[1] * x + b[1] * y + g[1] * z) * er, c0[2] + (a[2] * x + b[2] * y + g[2] * z) * er];
  const push = (p: Vec3, role: EyeRole, gl: number, hit: RayHit | null = null) => { positions.push(p[0], p[1], p[2]); roles.push(EYE_ROLE[role]); gloss.push(gl); surface.push(hit); return positions.length / 3 - 1; };
  const capR2 = E.corneaRadius * E.corneaRadius, capBase = Math.sqrt(capR2 - E.limbus * E.limbus);
  const lift = (x: number, y: number) => { const rho = Math.min(E.limbus, Math.hypot(x, y)); return Math.sqrt(capR2 - rho * rho) - capBase; };
  /** the almond's vertical extent at in-plane x (inner rings are clipped to a fraction of it) */
  const lidY = (x: number, upper: boolean) => { const c = Math.max(-1, Math.min(1, x / E.lid.w)), s = Math.sqrt(1 - c * c); return (upper ? E.lid.above : E.lid.below) * s * (1 - 0.25 * c * c); };
  const clipY = (x: number, y: number, k: number) => { const lim = k * lidY(x, y >= 0); return Math.sign(y) * Math.min(Math.abs(y), lim); };
  const th = (k: number) => 2 * Math.PI * k / N;

  // every ring is seated on the skull surface found along the gaze (the head skin is not cut: the eye lies on it)
  const surfaceZ = (x: number, y: number): [number, RayHit | null] => {
    if (o.surface) {
      const p = at(x, y, E.recess), hit = outermostExit(o.surface, p, g, E.rimSearch * er);
      if (hit) return [E.recess + hit.t / er, hit];
      // the line misses (the rim overhangs the skull's edge): the closest skull point sets the rim's depth
      const near = closestPointOnSoup(o.surface, p);
      if (near && Math.hypot(...sub(near.point, p)) <= E.closestSearch * er) { const t = dot(sub(near.point, p), g); return [E.recess + t / er, {...near, t}]; }
    }
    rimFallbacks += o.surface ? 1 : 0;
    return [E.recess, null];
  };
  // centre and inner rings (pupil edge, inner iris, iris, limbus): one smooth cornea dome, raised so that it clears the
  // skin under its pupil and iris by eyeLift (a per-vertex seat would crumple the dome over a skull crease). The limbus
  // does not lift the dome: where the skull slopes across the eye it may dip under the skin, which reads as the lid
  // overlapping the eyeball instead of the whole eye standing proud of a sloped face.
  const slit = o.type === 'vertical-slit';
  const inner: [EyeRole, (t: number) => [number, number], number][] = [
    ['pupil', t => pupilPoint(o.type, t), E.clip[0]!],
    ['iris-inner', t => { const [x, y] = pupilPoint(o.type, t); return [x * E.pupilInnerScale, y * E.pupilInnerScale]; }, E.clip[1]!],
    ['iris', t => slit ? scale2(lidPoint(t, E.lid.w, E.lid.above, E.lid.below), E.slitIrisInner) : [E.iris * Math.cos(t), E.iris * Math.sin(t)], E.clip[2]!],
    ['limbus', t => slit ? scale2(lidPoint(t, E.lid.w, E.lid.above, E.lid.below), E.slitIrisFill) : [E.limbus * Math.cos(t), E.limbus * Math.sin(t)], E.clip[3]!],
  ];
  const dome: {x: number; y: number; role: EyeRole; hit: RayHit | null}[] = [];
  let base = -Infinity;
  const seat = (x: number, y: number, role: EyeRole) => { const [sz, hit] = surfaceZ(x, y); if (role !== 'limbus') base = Math.max(base, sz - lift(x, y)); dome.push({x, y, role, hit}); };
  seat(0, 0, 'pupil');
  for (const [role, shape, k] of inner) for (let i = 0; i < N; i++) { const [x, y0] = shape(th(i)), y = clipY(x, y0, k); seat(x, y, role); }
  dome.forEach(({x, y, role, hit}, i) => { if (i % N === 1 || i === 0) rings.push(positions.length / 3); push(at(x, y, base + E.eyeLift + lift(x, y)), role, EYE_GLOSS.cornea, hit); });
  const lidZ: number[] = [];
  rings.push(positions.length / 3);
  for (let i = 0; i < N; i++) { const [x, y] = lidPoint(th(i), E.lid.w, E.lid.above, E.lid.below), [sz, hit] = surfaceZ(x, y), z = sz + E.lidLift; lidZ.push(z); push(at(x, y, z), 'lid', EYE_GLOSS.lid, hit); }
  rings.push(positions.length / 3);
  for (let i = 0; i < N; i++) { const [x, y] = lidPoint(th(i), E.outerLid.w, E.outerLid.above, E.outerLid.below), [sz, hit] = surfaceZ(x, y); push(at(x, y, Math.max(sz + E.outerLidLift, lidZ[i]! - E.outerLidDrop)), 'outer-lid', 0, hit); }
  rings.push(positions.length / 3);
  const orbit: Vec3[] = [];
  for (let i = 0; i < N; i++) { const [x, y] = lidPoint(th(i), E.orbit.w, E.orbit.above, E.orbit.below), [sz, hit] = surfaceZ(x, y), p = at(x, y, sz + E.orbitLift); orbit.push(p); push(p, 'orbit', 0, hit); }
  // front triangles: centre fan, then a band between consecutive rings (normals along +gaze)
  for (let i = 0; i < N; i++) index.push(0, 1 + i, 1 + (i + 1) % N);
  for (let r = 1; r + 1 < rings.length; r++) {
    const A = rings[r]!, B = rings[r + 1]!;
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; index.push(A + i, B + i, B + j, A + i, B + j, A + j); }
  }
  // closing cone behind the eye: the orbit ring again (own vertices, so the front keeps its normals) and an apex
  const socket = positions.length / 3;
  rings.push(socket);
  for (const p of orbit) push(p, 'socket', 0);
  const apex = push(at(0, 0, -E.socketDepth), 'socket', 0);
  for (let i = 0; i < N; i++) index.push(apex, socket + (i + 1) % N, socket + i);
  return {positions, roles: Uint8Array.from(roles), gloss, index, surface, rimFallbacks, rings};
}
const scale2 = (p: [number, number], k: number): [number, number] => [p[0] * k, p[1] * k];

export interface CompoundEyeOptions {
  /** dome radii: in-plane along the long axis, in-plane up, and along the gaze (dome height) */
  er3: [number, number, number];
  /** centre of the dome's base, head-local */
  centre: Vec3;
  gaze: Vec3;
  up: Vec3;
}
/** Arthropod compound eye: a closed half-ellipsoid dome on its base, 12 segments x 5 stations plus an apex (the dark
 * pseudopupil) and a base centre. 120 triangles. Facet roles alternate per station and segment (checker). */
export function buildCompoundEye(o: CompoundEyeOptions): EyePatch {
  const {segments: S, stations: M} = COMPOUND_EYE, g = normalize3(o.gaze);
  const a = normalize3(cross(o.up, g)), b = cross(g, a), [ra, rb, rg] = o.er3, c0 = o.centre;
  const positions: number[] = [], roles: number[] = [], gloss: number[] = [], index: number[] = [], rings: number[] = [];
  const push = (p: Vec3, role: EyeRole) => { positions.push(p[0], p[1], p[2]); roles.push(EYE_ROLE[role]); gloss.push(EYE_GLOSS.compound); return positions.length / 3 - 1; };
  const at = (x: number, y: number, z: number): Vec3 => [c0[0] + a[0] * x + b[0] * y + g[0] * z, c0[1] + a[1] * x + b[1] * y + g[1] * z, c0[2] + a[2] * x + b[2] * y + g[2] * z];
  rings.push(push(at(0, 0, rg), 'pseudopupil'));
  for (let j = 1; j <= M; j++) {
    rings.push(positions.length / 3);
    const phi = (j / M) * Math.PI / 2, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let k = 0; k < S; k++) { const t = 2 * Math.PI * k / S; push(at(ra * sp * Math.cos(t), rb * sp * Math.sin(t), rg * cp), (j + k) % 2 ? 'facet-b' : 'facet-a'); }
  }
  const base = positions.length / 3;
  rings.push(base);
  positions.push(c0[0], c0[1], c0[2]); roles.push(EYE_ROLE.socket); gloss.push(0);
  for (let k = 0; k < S; k++) index.push(0, 1 + k, 1 + (k + 1) % S);
  for (let j = 1; j < M; j++) {
    const A = 1 + (j - 1) * S, B = 1 + j * S;
    for (let k = 0; k < S; k++) { const l = (k + 1) % S; index.push(A + k, B + k, B + l, A + k, B + l, A + l); }
  }
  const last = 1 + (M - 1) * S;
  for (let k = 0; k < S; k++) index.push(base, last + (k + 1) % S, last + k);
  return {positions, roles: Uint8Array.from(roles), gloss, index, surface: roles.map(() => null), rimFallbacks: 0, rings};
}

export interface EyespotOptions {
  /** disc radius, metres */
  r: number;
  /** disc centre, head-local */
  centre: Vec3;
  /** disc normal (outward) */
  normal: Vec3;
  up: Vec3;
  /** per-rim-vertex lift along the normal (to sit flush on a curved cap); default 0 */
  rimLift?: (k: number, p: Vec3) => number;
}
/** A worm's pigment eyespot: a flat disc of 8 segments (centre + 8 rim vertices, 8 triangles), gloss 0. */
export function buildEyespot(o: EyespotOptions): EyePatch {
  const n = normalize3(o.normal), a = normalize3(cross(o.up, n)), b = cross(n, a), S = EYESPOT_SEGMENTS;
  const positions: number[] = [...o.centre], index: number[] = [];
  for (let k = 0; k < S; k++) {
    const t = 2 * Math.PI * k / S, p: Vec3 = [o.centre[0] + (a[0] * Math.cos(t) + b[0] * Math.sin(t)) * o.r, o.centre[1] + (a[1] * Math.cos(t) + b[1] * Math.sin(t)) * o.r, o.centre[2] + (a[2] * Math.cos(t) + b[2] * Math.sin(t)) * o.r];
    const l = o.rimLift ? o.rimLift(k, p) : 0;
    positions.push(p[0] + n[0] * l, p[1] + n[1] * l, p[2] + n[2] * l);
  }
  for (let k = 0; k < S; k++) index.push(0, 1 + k, 1 + (k + 1) % S);
  return {positions, roles: new Uint8Array(S + 1).fill(EYE_ROLE.eyespot), gloss: new Array(S + 1).fill(0), index, surface: new Array(S + 1).fill(null), rimFallbacks: 0, rings: [0, 1]};
}

/** Newell normal of a closed polygon (vertex ids into an xyz array): the plane normal of a ring, exact for planar or
 * mirror-symmetric rings. */
export function ringNormal(positions: ArrayLike<number>, ids: readonly number[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ids.length; i++) {
    const p = ids[i]! * 3, q = ids[(i + 1) % ids.length]! * 3;
    const px = positions[p]!, py = positions[p + 1]!, pz = positions[p + 2]!, qx = positions[q]!, qy = positions[q + 1]!, qz = positions[q + 2]!;
    nx += (py - qy) * (pz + qz); ny += (pz - qz) * (px + qx); nz += (px - qx) * (py + qy);
  }
  return normalize3([nx, ny, nz]);
}
export {sub as eyeSub, dot as eyeDot, cross as eyeCross};

// ---- fauna-composer-eye-2: the eye catalogue geometry (eye round EC2) ------------------------------------------------

export type CataloguePupil = 'round' | 'horizontal' | 'vertical-slit' | 'slit-wide' | 'beaded-slit' | 'w' | 'pinhole' | 'dilated';
export interface CataloguePupilSpec {
  kind: CataloguePupil;
  /** round, pinhole, dilated: radius */
  r: number;
  /** bar and slits: half-axes; bar: superellipse exponent n; slits: tip sharpness `point` */
  rx: number; ry: number; n: number; point: number;
  /** beaded slit: half-width of a bead and of a pinch between beads */
  bead: number; pinch: number;
}
export type CatalogueBrow = 'none' | 'shelf' | 'raised-orbit' | 'raised-orbit-shelf' | 'disc' | 'turret';
/** Everything the catalogue patch needs, in eye radii (er). Built from a preset's traits by catalogueEyeSpec; plain
 * data, so the mesh glue may adjust it (the legibility rules for the face round's kinds under the current eye rules). */
export interface CatalogueEyeSpec {
  pupil: CataloguePupilSpec;
  /** iris and limbus ring radii; null: the iris fills the lid opening (rings at `fill` fractions of it, the slit look) */
  iris: number | null; limbus: number | null; fill: readonly [number, number];
  /** lid opening: almond (the face round's formula) or round (an ellipse) */
  lid: {shape: 'almond' | 'round'; w: number; above: number; below: number};
  /** outer-lid and orbit rings: the lid opening grown by these margins (w, above, below) */
  outerMargin: readonly [number, number, number]; orbitMargin: readonly [number, number, number];
  /** in-plane roll of the whole eye in degrees, positive = the rear (temporal) corner up (the cat's upswept almond) */
  rollDeg: number;
  brow: CatalogueBrow;
  /** raised orbit: the eyeball, lid and outer lid stand this far proud of the skull (the orbit ring stays on it) */
  raise: number;
  /** extra lift of the upper outer lid (shelf, palpebral bump), how far it is pulled down toward the lid, and the
   * orbit ring's lift in the same arc */
  shelfLift: number; shelfDrop: number; shelfOrbitLift: number;
  /** owl facial disc: the orbit ring's opening (replaces orbitMargin) */
  disc: {w: number; above: number; below: number} | null;
  /** chameleon turret: the outer-lid ring's radius and lift, and the aperture rim's lift above the skull */
  turret: {w: number; lift: number; aperture: number} | null;
  /** white sclera ring layout (human-like): iris, a sclera ring at the opening, no separate orbit ring */
  sclera: boolean;
  /** lidless spectacle (brille): the lid ring sits at cornea height, glossy, and the outer lid is flush */
  spectacle: boolean;
  corneaRadius: number;
  /** the cornea dome stops rising beyond this radius (null: the limbus) */
  domeLimit: number | null;
  pattern: 'plain' | 'radial' | 'reticulated' | 'reticulated-faint';
  nictitating: 'none' | 'front' | 'lower';
}
/** Catalogue-path numbers (er). */
export const CATALOGUE_EYE = Object.freeze({
  /** default outer-lid and orbit margins over the lid opening: they reproduce the face round's rings for its almond */
  outerMargin: [0.2, 0.23, 0.23] as readonly number[], orbitMargin: [0.55, 0.63, 0.63] as readonly number[],
  shelf: {lift: 0.34, drop: 0.2, orbitLift: 0.16, from: 0.25, to: 0.7},
  raised: {raise: 0.35, cornea: 1.15}, crocodile: {raise: 0.3, palpebral: 0.15},
  /** owl facial disc: the orbit ring (the disc's dark rim, the ruff) at w/above/below, and the outer-lid ring (the
   * disc's pale band) `outer` er beyond the lid opening, so a pale ring stands between the dark lid and the ruff (the
   * face round's 0.2 er outer lid left only pale strips beside the beak at normal size, GPT Luna 6, EC2 review); the
   * lid and the pale band stand at least `plate` er above the eyeball's rim, so the disc is a raised plate the eye sits in */
  disc: {w: 1.95, above: 2.3, below: 1.85, lift: 0.06, outer: 0.45, plate: 0.04},
  turret: {lift: 0.55, aperture: 0.82, orbit: 1.25, lean: 0.25, rimGloss: 0.35},
  sclera: {gap: 0.03, opening: 0.97},
  nictitatingDeg: 40, spectacleLift: 0.02, spectacleOuterLift: 0.01,
  /** an outer-lid or orbit vertex whose line along the gaze misses the skull (beyond its silhouette) and whose closest
   * skull point lies more than wrapOff er off its line is wrapped onto that point (lifted along its normal), so the rim
   * hugs a skull that curves away instead of standing in the air as a flap */
  wrapOff: 0.15,
  /** see unair in buildCataloguePatch: an outer-lid vertex more than airOff er above its lift off the skull is pulled onto it */
  airOff: 0.15,
  /** the eyeball stands at most this far (er) above the depth its pupil and inner iris need: a large eye at a skull
   * corner (a lateral eye beside a flat face) otherwise rises to the highest skull point under its rim, a slab */
  domeRiseMax: 0.2,
  pattern: {radial: 0.12, reticulated: 0.55, faint: 0.75},
  /** the W pupil polygon (er) and the point it is sampled from: deep lobes, a raised cusp, a shallow dip on top, wide
   * arms (the first W read as a flat dark band with a notch at normal size) */
  w: [[-0.56, 0.2], [-0.4, -0.36], [-0.2, -0.36], [0, 0], [0.2, -0.36], [0.4, -0.36], [0.56, 0.2], [0, 0.14]] as readonly (readonly [number, number])[],
  wOrigin: [0, 0.07] as readonly [number, number],
});

/** The trait subset catalogueEyeSpec reads (a full EyeTraits satisfies it). */
export interface CatalogueEyeTraits {
  pupil: string; pupilShape: Readonly<Record<string, number>> | null; lid: string; lidShape: Readonly<Record<string, number>> | null;
  brow: string; sclera: string; irisPattern: string; extras: string;
}
/** The catalogue patch spec of a camera-eye preset (its traits). Pure; the numbers are design values tuned in review. */
export function catalogueEyeSpec(t: CatalogueEyeTraits): CatalogueEyeSpec {
  const E = EYE_PATCH, C = CATALOGUE_EYE, ps = t.pupilShape ?? {}, ls = t.lidShape ?? {};
  const kind = (['round', 'horizontal', 'vertical-slit', 'slit-wide', 'beaded-slit', 'w', 'pinhole', 'dilated'] as const).find(k => k === t.pupil) ?? 'round';
  const pupil: CataloguePupilSpec = {kind, r: ps.r ?? (kind === 'pinhole' ? 0.09 : kind === 'dilated' ? 0.5 : E.pupil),
    rx: ps.rx ?? (kind === 'horizontal' ? E.horizontalPupil.rx : kind === 'slit-wide' ? 0.12 : E.slitPupil.rx),
    ry: ps.ry ?? (kind === 'horizontal' ? E.horizontalPupil.ry : kind === 'slit-wide' || kind === 'beaded-slit' ? 0.48 : E.slitPupil.ry),
    n: ps.n ?? E.horizontalPupil.n, point: ps.point ?? E.slitPupil.point, bead: ps.bead ?? 0.07, pinch: ps.pinch ?? 0.022};
  const slit = kind === 'vertical-slit' || kind === 'slit-wide' || kind === 'beaded-slit';
  const raised = t.brow === 'raised-orbit' || t.brow === 'raised-orbit-shelf';
  // the iris fills the opening for slit pupils and for eyes on a raised orbit (frogs and crocodiles are all iris)
  const fill = slit || raised;
  const roundLid = t.lid === 'round' || t.lid === 'spectacle' || t.lid === 'turret';
  const lid = {shape: roundLid ? 'round' as const : 'almond' as const, w: ls.w ?? E.lid.w, above: ls.above ?? E.lid.above, below: ls.below ?? E.lid.below};
  const sclera = t.sclera === 'white';
  const brow = (['none', 'shelf', 'raised-orbit', 'raised-orbit-shelf', 'disc'] as const).find(b => b === t.brow) ?? 'none';
  const turret = t.lid === 'turret' ? {w: ls.turretW ?? 0.8, lift: ls.turretLift ?? C.turret.lift, aperture: C.turret.aperture} : null;
  return {
    pupil, iris: fill ? null : ps.iris ?? E.iris, limbus: fill ? null : ps.limbus ?? E.limbus, fill: [E.slitIrisInner, E.slitIrisFill], lid,
    outerMargin: (brow === 'disc' ? [C.disc.outer, C.disc.outer, C.disc.outer] : C.outerMargin) as [number, number, number], orbitMargin: C.orbitMargin as [number, number, number],
    rollDeg: ls.cornerUpDeg ?? 0, brow: turret ? 'turret' : brow,
    raise: t.brow === 'raised-orbit' ? C.raised.raise : t.brow === 'raised-orbit-shelf' ? C.crocodile.raise : 0,
    shelfLift: brow === 'shelf' ? C.shelf.lift : brow === 'raised-orbit-shelf' ? C.crocodile.palpebral : 0,
    shelfDrop: brow === 'shelf' ? C.shelf.drop : 0, shelfOrbitLift: brow === 'shelf' ? C.shelf.orbitLift : 0,
    disc: brow === 'disc' ? {w: C.disc.w, above: C.disc.above, below: C.disc.below} : null, turret,
    sclera, spectacle: t.lid === 'spectacle', corneaRadius: t.brow === 'raised-orbit' ? C.raised.cornea : E.corneaRadius,
    domeLimit: sclera ? (ps.limbus ?? 0.52) : null,
    pattern: (['plain', 'radial', 'reticulated', 'reticulated-faint'] as const).find(p => p === t.irisPattern) ?? 'plain',
    nictitating: t.extras === 'nictitating' ? 'front' : t.extras === 'nictitating-lower' ? 'lower' : 'none',
  };
}

/** Pupil edge (er) of a catalogue pupil at ring angle th; i/N are the ring index and segment count (the beaded slit is
 * index-aware: two tips plus N/2 - 1 vertices per side, evenly spaced in y, alternating bead and pinch widths). */
export function cataloguePupilPoint(p: CataloguePupilSpec, th: number, i: number, N: number): [number, number] {
  const c = Math.cos(th), s = Math.sin(th);
  switch (p.kind) {
    case 'horizontal': { const e = 2 / p.n; return [p.rx * Math.sign(c) * Math.abs(c) ** e, p.ry * Math.sign(s) * Math.abs(s) ** e]; }
    case 'vertical-slit': case 'slit-wide': return [p.rx * c * Math.abs(c) ** p.point, p.ry * s];
    case 'beaded-slit': {
      const q = N / 4, m = N / 2 - 1, k = ((i % N) + N) % N;
      if (k === q) return [0, p.ry];
      if (k === 3 * q) return [0, -p.ry];
      // left side (q+1 .. 3q-1) runs top to bottom, right side (3q+1 .. q-1, wrapping) bottom to top
      const left = k > q && k < 3 * q, j = left ? k - q - 1 : (k - 3 * q - 1 + N) % N;
      const y = (left ? 1 : -1) * p.ry * (1 - 2 * (j + 1) / (m + 1)), half = j % 2 === 0 ? p.bead : p.pinch;
      return [left ? -half : half, y];
    }
    case 'w': return wPupilPoint(th);
    default: return [p.r * c, p.r * s];
  }
}
/** The cuttlefish W: the star-shaped polygon CATALOGUE_EYE.w sampled by a ray from CATALOGUE_EYE.wOrigin at angle th. */
export function wPupilPoint(th: number): [number, number] {
  const P = CATALOGUE_EYE.w, [ox, oy] = CATALOGUE_EYE.wOrigin, dx = Math.cos(th), dy = Math.sin(th);
  let best = Infinity;
  for (let k = 0; k < P.length; k++) {
    const [ax, ay] = P[k]!, [bx, by] = P[(k + 1) % P.length]!, ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den, u = ((ax - ox) * dy - (ay - oy) * dx) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return [ox + dx * best, oy + dy * best];
}

const smooth01 = (lo: number, hi: number, v: number) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
/** The catalogue patch: the face round's ring patch (centre, 7 rings of EYE_PATCH.segments, the closing cone; 280
 * triangles) with the preset's pupil, lid, brow, sclera layout, roll and pattern. */
function buildCataloguePatch(o: EyePatchOptions, sp: CatalogueEyeSpec): EyePatch {
  const E = EYE_PATCH, C = CATALOGUE_EYE, N = E.segments, er = o.er, g = normalize3(o.gaze), c0 = o.centre;
  let a = o.barAxis ? normalize3(addS(o.barAxis, g, -dot(o.barAxis, g))) : eyeBarAxis(g, o.up ?? [0, 1, 0]);
  let b = cross(g, a);
  const fwd = o.forward ?? [1, 0, 0], fsign = dot(a, fwd) >= 0 ? 1 : -1;
  if (sp.rollDeg) {
    // rotate the in-plane frame so that the rear corner (in-plane x = -fsign) rises
    const r = -fsign * sp.rollDeg * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
    const a2 = addS(scale(a, cr), b, sr), b2 = addS(scale(b, cr), a, -sr); a = a2; b = b2;
  }
  const positions: number[] = [], roles: number[] = [], gloss: number[] = [], index: number[] = [], surface: (RayHit | null)[] = [], rings: number[] = [], shade: number[] = [];
  let rimFallbacks = 0;
  const at = (x: number, y: number, z: number): Vec3 => [c0[0] + (a[0] * x + b[0] * y + g[0] * z) * er, c0[1] + (a[1] * x + b[1] * y + g[1] * z) * er, c0[2] + (a[2] * x + b[2] * y + g[2] * z) * er];
  const push = (p: Vec3, role: EyeRole, gl: number, hit: RayHit | null = null, sh = 1) => { positions.push(p[0], p[1], p[2]); roles.push(EYE_ROLE[role]); gloss.push(gl); surface.push(hit); shade.push(sh); return positions.length / 3 - 1; };
  const L = sp.lid, round = L.shape === 'round';
  const opening = (t: number, w: number, above: number, below: number): [number, number] => round ? [w * Math.cos(t), (Math.sin(t) >= 0 ? above : below) * Math.sin(t)] : lidPoint(t, w, above, below);
  const lidY = (x: number, upper: boolean) => { const c = Math.max(-1, Math.min(1, x / L.w)), s = Math.sqrt(1 - c * c); return (upper ? L.above : L.below) * s * (round ? 1 : 1 - 0.25 * c * c); };
  const clipY = (x: number, y: number, k: number) => { const lim = k * lidY(x, y >= 0); return Math.sign(y) * Math.min(Math.abs(y), lim); };
  const th = (k: number) => 2 * Math.PI * k / N;
  // rim vertices never cross the midline plane (frontal eyes, facial discs)
  const mid = (x: number, y: number): [number, number] => {
    if (!o.midline) return [x, y];
    const n = o.midline.n, along = (a[0] * x + b[0] * y) * n[0] + (a[1] * x + b[1] * y) * n[1] + (a[2] * x + b[2] * y) * n[2], cz = dot(c0, n);
    if (along >= 0 || cz + along * er >= o.midline.min) return [x, y];
    // an owl's facial disc slides sideways onto the midline (the two discs meet there, as on a real owl): pulled in
    // toward the eye centre, its medial arc left a dark wedge of skull between the discs, read as "a central brow ridge"
    // and "broken, angular patches" (GPT Luna 6, EC2 review)
    if (sp.disc) {
      const na = dot(a, n), nb = dot(b, n), n2 = na * na + nb * nb;
      if (n2 > 1e-6) { const t = ((o.midline.min - cz) / er - along) / n2; return [x + t * na, y + t * nb]; }
    }
    const k = Math.max(0, (o.midline.min - cz) / (along * er));
    return [x * k, y * k];
  };
  /** skull depth under an in-plane point: [z (er), hit, how far (er) the hit lies off the point's line] */
  const surfaceZ = (x: number, y: number): [number, RayHit | null, number] => {
    if (o.surface) {
      const p = at(x, y, E.recess), hit = outermostExit(o.surface, p, g, E.rimSearch * er);
      if (hit) return [E.recess + hit.t / er, hit, 0];
      const near = closestPointOnSoupLowTie(o.surface, p);
      if (near && Math.hypot(...sub(near.point, p)) <= E.closestSearch * er) {
        const d = sub(near.point, p), t = dot(d, g);
        return [E.recess + t / er, {...near, t}, Math.hypot(...addS(d, g, -t)) / er];
      }
    }
    rimFallbacks += o.surface ? 1 : 0;
    return [E.recess, null, 0];
  };
  // blended in over (wrapOff/2, wrapOff] so neighbouring rim vertices on either side of the threshold stay continuous
  const wrap = (p: Vec3, hit: RayHit | null, off: number, liftEr: number): Vec3 => {
    const w = hit ? Math.min(1, Math.max(0, (off - 0.5 * C.wrapOff) / (0.5 * C.wrapOff))) : 0;
    if (w <= 0) return p;
    const q = addS(hit!.point, hit!.normal, liftEr * er), k = w * w * (3 - 2 * w);
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  };
  /** a rim vertex whose line hits the skull at a grazing angle can still stand in the air (EC2 review: a cat eye's outer
   * lid 0.39 er off the skull, held up by the lid margin beside it, a flap): one more than airOff er above its own lift
   * (outerLidLift, raise and shelf; not the margin's) off the closest skull point is pulled onto that point (lifted),
   * blended in over (airOff, 2 airOff]; a no-op for a vertex that hugs the skull */
  const unair = (p: Vec3, liftEr: number): Vec3 => {
    if (!o.surface) return p;
    const near = closestPointOnSoup(o.surface, p);
    if (!near) return p;
    const d = Math.hypot(...sub(near.point, p)) / er - liftEr, w = Math.min(1, Math.max(0, (d - C.airOff) / C.airOff));
    if (w <= 0) return p;
    const q = addS(near.point, near.normal, liftEr * er), k = w * w * (3 - 2 * w);
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  };
  const domeLimit = sp.domeLimit ?? sp.limbus ?? E.limbus, capR2 = sp.corneaRadius * sp.corneaRadius, capBase = Math.sqrt(capR2 - domeLimit * domeLimit);
  const lift = (x: number, y: number) => { const rho = Math.min(domeLimit, Math.hypot(x, y)); return Math.sqrt(capR2 - rho * rho) - capBase; };
  const P = sp.pupil, pup = (t: number, i: number) => cataloguePupilPoint(P, t, i, N);
  const circle = (r: number) => (t: number): [number, number] => [r * Math.cos(t), r * Math.sin(t)];
  const fillRing = (k: number) => (t: number): [number, number] => scale2(opening(t, L.w, L.above, L.below), k);
  const pattern = (role: EyeRole, i: number) => {
    if (sp.pattern === 'radial' && (role === 'iris' || role === 'iris-inner')) return i % 2 ? 1 - C.pattern.radial : 1 + C.pattern.radial;
    if (sp.pattern === 'reticulated' && role === 'iris' && i % 3 === 0) return C.pattern.reticulated;
    if (sp.pattern === 'reticulated-faint' && role === 'iris' && i % 3 === 0) return C.pattern.faint;
    return 1;
  };
  // inner rings: [role, in-plane point, clip fraction of the lid opening (null: no clip)]
  type Inner = [EyeRole, (t: number, i: number) => [number, number], number | null];
  const inner: Inner[] = sp.sclera ? [
    ['pupil', pup, E.clip[0]!],
    ['iris-inner', (t, i) => scale2(pup(t, i), E.pupilInnerScale), E.clip[1]!],
    ['iris', circle(sp.iris ?? 0.44), E.clip[2]!],
    ['sclera', circle((sp.iris ?? 0.44) + C.sclera.gap), E.clip[3]!],
    ['sclera', fillRing(C.sclera.opening), null],
  ] : [
    ['pupil', pup, E.clip[0]!],
    ['iris-inner', (t, i) => scale2(pup(t, i), E.pupilInnerScale), E.clip[1]!],
    ['iris', sp.iris === null ? fillRing(sp.fill[0]) : circle(sp.iris), E.clip[2]!],
    ['limbus', sp.limbus === null ? fillRing(sp.fill[1]) : circle(sp.limbus), E.clip[3]!],
  ];
  const T = sp.turret, sc = T ? surfaceZ(0, 0)[0] : 0;
  const dome: {x: number; y: number; role: EyeRole; hit: RayHit | null; i: number}[] = [];
  let base = -Infinity, baseInner = -Infinity;
  const seat = (x: number, y: number, role: EyeRole, i: number) => {
    const [sz, hit] = surfaceZ(x, y);
    if (role !== 'limbus' && role !== 'sclera') base = Math.max(base, sz - lift(x, y));
    if (role === 'pupil' || role === 'iris-inner') baseInner = Math.max(baseInner, sz - lift(x, y));
    dome.push({x, y, role, hit, i});
  };
  seat(0, 0, 'pupil', 0);
  for (const [role, shape, k] of inner) for (let i = 0; i < N; i++) { const [x, y0] = shape(th(i), i), y = k === null ? y0 : clipY(x, y0, k); seat(x, y, role, i); }
  base = Math.min(base, baseInner + C.domeRiseMax);
  const domeZ = (x: number, y: number) => T ? sc + T.aperture - 0.05 + lift(x, y) : base + E.eyeLift + lift(x, y) + sp.raise;
  // a turret's aperture (dome and rim) leans toward the look
  const [lx, ly] = T && o.look ? [dot(o.look, a) * C.turret.lean, dot(o.look, b) * C.turret.lean] : [0, 0];
  dome.forEach(({x, y, role, hit, i}, n) => { if (n % N === 1 || n === 0) rings.push(positions.length / 3); push(at(x + lx, y + ly, domeZ(x, y)), role, EYE_GLOSS.cornea, hit, pattern(role, i)); });
  // lid ring (the opening's rim; turret: the aperture rim; spectacle: the brille's edge at cornea height)
  const tf = Math.atan2(dot(fwd, b), dot(fwd, a)), nictDeg = C.nictitatingDeg * Math.PI / 180;
  const nictitans = (t: number) => sp.nictitating === 'front' ? Math.abs(Math.atan2(Math.sin(t - tf), Math.cos(t - tf))) <= nictDeg : sp.nictitating === 'lower' && Math.sin(t) < -0.2;
  const lidZ: number[] = [];
  rings.push(positions.length / 3);
  for (let i = 0; i < N; i++) {
    const t = th(i), [x, y] = mid(...opening(t, L.w, L.above, L.below)), [sz, hit, off] = surfaceZ(x, y);
    // an owl's facial disc is a plate at the eyeball's rim height: the lid stands at least there, so the eye sits in
    // the disc instead of standing out of the skull as a ball (EC2 review: "the eyes protrude strongly", GPT Luna 6)
    const z = T ? sc + T.aperture : sp.spectacle ? Math.max(base + E.eyeLift + lift(x, y) + sp.raise, sz + C.spectacleLift)
      : sp.disc ? Math.max(sz + E.lidLift, base + E.eyeLift + C.disc.plate) : sz + E.lidLift + sp.raise;
    lidZ.push(z);
    const nict = nictitans(t);
    // a lid vertex whose line misses the skull is wrapped onto it like the outer rings (EC2 review: a cat eye at the
    // cranium's front corner left one lid vertex 0.44 er in the air, a flap); a no-op wherever the line hits
    const p = T || sp.spectacle ? at(x + lx, y + ly, z) : wrap(at(x + lx, y + ly, z), hit, off, z - sz);
    push(p, nict ? 'nictitans' : 'lid', T ? C.turret.rimGloss : sp.spectacle ? 1 : nict ? 0.7 : EYE_GLOSS.lid, hit);
  }
  // outer lid (shelf and palpebral bump on its upper arc; turret: the cone's shoulder; sclera layout: on the skin)
  const [ow, oa, ob] = [L.w + sp.outerMargin[0], L.above + sp.outerMargin[1], L.below + sp.outerMargin[2]];
  rings.push(positions.length / 3);
  const lastRing = sp.sclera;
  const outer: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const t = th(i), wShelf = smooth01(C.shelf.from, C.shelf.to, Math.sin(t));
    let [x, y] = T ? [T.w * Math.cos(t), T.w * Math.sin(t)] as [number, number] : opening(t, ow, oa, ob);
    if (sp.shelfDrop) y -= sp.shelfDrop * wShelf;
    [x, y] = mid(x, y);
    const [sz, hit, off] = surfaceZ(x, y);
    const z = T ? sz + T.lift : lastRing ? sz + E.orbitLift : sp.spectacle ? sz + C.spectacleOuterLift
      : Math.max(sz + E.outerLidLift + sp.raise, lidZ[i]! - E.outerLidDrop) + sp.shelfLift * wShelf;
    const role: EyeRole = T ? 'turret' : lastRing ? 'orbit' : sp.shelfLift && wShelf > 0.5 ? 'brow' : 'outer-lid';
    const p = T ? at(x, y, z) : sp.spectacle || sp.disc ? wrap(at(x, y, z), hit, off, z - sz) : unair(wrap(at(x, y, z), hit, off, z - sz), E.outerLidLift + sp.raise + sp.shelfLift * wShelf);
    outer.push(p);
    push(p, role, T ? 0.15 : 0, hit);
  }
  let closing = outer;
  if (!lastRing) {
    rings.push(positions.length / 3);
    closing = [];
    for (let i = 0; i < N; i++) {
      const t = th(i), wShelf = smooth01(C.shelf.from, C.shelf.to, Math.sin(t)), D = sp.disc;
      const [x, y] = mid(...(T ? [C.turret.orbit * Math.cos(t), C.turret.orbit * Math.sin(t)] as [number, number]
        : D ? opening(t, D.w, D.above, D.below) : opening(t, L.w + sp.orbitMargin[0], L.above + sp.orbitMargin[1], L.below + sp.orbitMargin[2])));
      const [sz, hit, off] = surfaceZ(x, y), lift = (D ? C.disc.lift : E.orbitLift) + sp.shelfOrbitLift * wShelf, p = wrap(at(x, y, sz + lift), hit, off, lift);
      closing.push(p);
      push(p, 'orbit', 0, hit);
    }
  }
  for (let i = 0; i < N; i++) index.push(0, 1 + i, 1 + (i + 1) % N);
  for (let r = 1; r + 1 < rings.length; r++) {
    const A = rings[r]!, B = rings[r + 1]!;
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; index.push(A + i, B + i, B + j, A + i, B + j, A + j); }
  }
  const socket = positions.length / 3;
  rings.push(socket);
  for (const p of closing) push(p, 'socket', 0);
  const apex = push(at(0, 0, -E.socketDepth), 'socket', 0);
  for (let i = 0; i < N; i++) index.push(apex, socket + (i + 1) % N, socket + i);
  return {positions, roles: Uint8Array.from(roles), gloss, index, surface, rimFallbacks, rings, shade};
}

export interface FacetedEyeOptions {
  /** dome radii: in-plane along the long axis, in-plane up, and along the gaze (dome height), metres */
  er3: [number, number, number];
  centre: Vec3; gaze: Vec3; up: Vec3;
  segments?: number; stations?: number;
}
/** Compound-eye numbers: lattice segments x stations, the lens bulge (fraction of the dome radius) and gloss.
 * 12 x 3 = 120 triangles per dome: the design cap (eye-catalogue-v2 budgets: insect set <= 280 = 2 x 120 + 3 x 12 = 276;
 * the face round's compound pair 240). EC2's first passes used 14 x 5 = 252 without disclosure; the EC2 review cut it
 * back. Legibility does not justify the larger lattice: across GPT Luna 6 runs on the same eight specimens the 120 dome
 * (r28: 2 of 4 compound sheets PASS) did no worse than the 252 one (r32, r33: 1 of 5), and a flat-faceted 120 variant
 * did worse (r30: 0 of 4). What fails at normal size on centipede heads is the eye's SIZE (deferred), not the lattice. */
export const FACETED_EYE = Object.freeze({segments: 12, stations: 3, lens: 0.07, gloss: {lens: 0.85, edge: 0.3, pupil: 0.6}});
/** A compound eye that reads as faceted: a half-ellipsoid lattice (dark 'facet-edge' vertices) whose every cell carries
 * its own raised lens centre ('facet-a'/'facet-b', glossy), so the dome breaks the light into many small highlights.
 * The apex vertex is the dark pseudopupil (a small spot fading into the lattice); a base fan closes it. segments x (4 x stations - 2) triangles (12 x 3: 120; 8 x 2: 48). */
export function buildFacetedEye(o: FacetedEyeOptions): EyePatch {
  const S = o.segments ?? FACETED_EYE.segments, M = o.stations ?? FACETED_EYE.stations, G = FACETED_EYE.gloss, g = normalize3(o.gaze);
  const a = normalize3(cross(o.up, g)), b = cross(g, a), [ra, rb, rg] = o.er3, c0 = o.centre;
  const positions: number[] = [], roles: number[] = [], gloss: number[] = [], index: number[] = [], rings: number[] = [];
  const push = (p: Vec3, role: EyeRole, gl: number) => { positions.push(p[0], p[1], p[2]); roles.push(EYE_ROLE[role]); gloss.push(gl); return positions.length / 3 - 1; };
  const pt = (phi: number, t: number, k = 1): Vec3 => {
    const x = ra * Math.sin(phi) * Math.cos(t) * k, y = rb * Math.sin(phi) * Math.sin(t) * k, z = rg * Math.cos(phi) * k;
    return [c0[0] + a[0] * x + b[0] * y + g[0] * z, c0[1] + a[1] * x + b[1] * y + g[1] * z, c0[2] + a[2] * x + b[2] * y + g[2] * z];
  };
  const phiOf = (j: number) => (j / M) * Math.PI / 2, tOf = (k: number) => 2 * Math.PI * k / S;
  rings.push(push(pt(0, 0), 'pseudopupil', G.pupil));
  // lattice rings 1..M (ring M is the base rim)
  for (let j = 1; j <= M; j++) { rings.push(positions.length / 3); for (let k = 0; k < S; k++) push(pt(phiOf(j), tOf(k)), 'facet-edge', G.edge); }
  const ringV = (j: number, k: number) => 1 + (j - 1) * S + ((k % S) + S) % S;
  // lens centres of the cells between rings j and j + 1
  rings.push(positions.length / 3);
  const lensStart = positions.length / 3;
  for (let j = 1; j < M; j++) for (let k = 0; k < S; k++) push(pt((phiOf(j) + phiOf(j + 1)) / 2, tOf(k + 0.5), 1 + FACETED_EYE.lens), (j + k) % 2 ? 'facet-b' : 'facet-a', G.lens);
  const base = push([...c0] as Vec3, 'socket', 0);
  rings.push(base);
  for (let k = 0; k < S; k++) index.push(0, ringV(1, k), ringV(1, k + 1));
  for (let j = 1; j < M; j++) for (let k = 0; k < S; k++) {
    const c = lensStart + (j - 1) * S + k, p00 = ringV(j, k), p01 = ringV(j, k + 1), p10 = ringV(j + 1, k), p11 = ringV(j + 1, k + 1);
    index.push(c, p00, p10, c, p10, p11, c, p11, p01, c, p01, p00);
  }
  for (let k = 0; k < S; k++) index.push(base, ringV(M, k + 1), ringV(M, k));
  return {positions, roles: Uint8Array.from(roles), gloss, index, surface: roles.map(() => null), rimFallbacks: 0, rings};
}

export interface OcellusOptions {
  /** base radius and dome height, metres */
  r: number; height: number;
  /** base centre, outward normal and an up hint, head-local */
  centre: Vec3; normal: Vec3; up: Vec3;
  segments: number; stations: number;
  /** a pale rim ('ocellus-rim'): without `flange`, the lowest station (no extra triangles) */
  rim?: boolean;
  /** with `rim`, the pale rim is instead a flange ring around a fully dark dome, on the skin (2 x segments more
   * triangles): a dark bead in a pale ring */
  flange?: boolean;
}
/** Simple-eye numbers: the rim flange's radius (x r). */
export const OCELLUS = Object.freeze({flange: 1.4});
/** A simple eye: a glossy dome of `segments` x `stations` plus an apex and a closing base fan; 2 x segments x stations
 * triangles (5 x 1: 10, 6 x 1: 12, 8 x 1: 16, 12 x 2: 48), plus 2 x segments with a rim flange. */
export function buildOcellus(o: OcellusOptions): EyePatch {
  const S = o.segments, M = o.stations, n = normalize3(o.normal);
  let a = cross(o.up, n); if (Math.hypot(...a) < 1e-6) a = cross([1, 0, 0], n);
  a = normalize3(a);
  const b = cross(n, a), c0 = o.centre;
  const positions: number[] = [], roles: number[] = [], gloss: number[] = [], index: number[] = [], rings: number[] = [];
  const push = (p: Vec3, role: EyeRole, gl: number) => { positions.push(p[0], p[1], p[2]); roles.push(EYE_ROLE[role]); gloss.push(gl); return positions.length / 3 - 1; };
  const at = (x: number, y: number, z: number): Vec3 => [c0[0] + a[0] * x + b[0] * y + n[0] * z, c0[1] + a[1] * x + b[1] * y + n[1] * z, c0[2] + a[2] * x + b[2] * y + n[2] * z];
  rings.push(push(at(0, 0, o.height), 'ocellus', 1));
  for (let j = 1; j <= M; j++) {
    rings.push(positions.length / 3);
    const phi = (j / M) * Math.PI / 2, rr = o.r * Math.sin(phi), h = o.height * Math.cos(phi);
    for (let k = 0; k < S; k++) { const t = 2 * Math.PI * k / S; push(at(rr * Math.cos(t), rr * Math.sin(t), h), o.rim && !o.flange && j === M ? 'ocellus-rim' : 'ocellus', 1); }
  }
  if (o.rim && o.flange) {
    rings.push(positions.length / 3);
    for (let k = 0; k < S; k++) { const t = 2 * Math.PI * k / S; push(at(OCELLUS.flange * o.r * Math.cos(t), OCELLUS.flange * o.r * Math.sin(t), 0), 'ocellus-rim', 0.3); }
  }
  const M1 = o.rim && o.flange ? M + 1 : M;
  const base = push(at(0, 0, -0.3 * o.height), 'socket', 0);
  rings.push(base);
  for (let k = 0; k < S; k++) index.push(0, 1 + k, 1 + (k + 1) % S);
  for (let j = 1; j < M1; j++) { const A = 1 + (j - 1) * S, B = 1 + j * S; for (let k = 0; k < S; k++) { const l = (k + 1) % S; index.push(A + k, B + k, B + l, A + k, B + l, A + l); } }
  const last = 1 + (M1 - 1) * S;
  for (let k = 0; k < S; k++) index.push(base, last + (k + 1) % S, last + k);
  return {positions, roles: Uint8Array.from(roles), gloss, index, surface: roles.map(() => null), rimFallbacks: 0, rings};
}

export interface EyespotBeadOptions {
  /** pigment radius, metres; the pale rim reaches EYESPOT_BEAD.rim x r and the skin blend ring EYESPOT_BEAD.blend x r */
  r: number;
  centre: Vec3; normal: Vec3; up: Vec3;
  /** per-vertex lift along the normal so the rim rings sit flush on a curved cap (default 0) */
  rimLift?: (p: Vec3) => number;
}
/** Eyespot bead numbers: segments; ring radii (x r) pigment, pigment edge, rim, skin blend; dome heights (x r). */
/** (fauna-composer-eye-2, EC2 review and r21: the 0.5 r dome read as "dark raised buttons, not subtle pigment"; now a
 * near-flush 0.04 r film with a faint sheen, and the skin-coloured rim and blend rings hug the pigment (0.95 and 1.05 r,
 * were 1.0 and 1.35 r): the bead's flat-draped normals never quite match the cap's smooth ones, so a wide skin ring
 * showed as a grey halo around a button.) */
export const EYESPOT_BEAD = Object.freeze({segments: 12, rings: [0.7, 0.9, 1.0, 1.1] as readonly number[], heights: [0.04, 0.035, 0.02, 0.008, 0] as readonly number[], socketDepth: 0.6});
/** A worm's pigment eyespot that reads at normal size: a low glossy dome of tinted pigment (apex + 2 rings), a pale rim
 * ring and a ring blending into the skin, closed behind by a cone. 12 x 8 = 96 triangles. */
export function buildEyespotBead(o: EyespotBeadOptions): EyePatch {
  const B = EYESPOT_BEAD, S = B.segments, n = normalize3(o.normal);
  let a = cross(o.up, n); if (Math.hypot(...a) < 1e-6) a = cross([1, 0, 0], n);
  a = normalize3(a);
  const bb = cross(n, a), c0 = o.centre;
  const positions: number[] = [], roles: number[] = [], gloss: number[] = [], index: number[] = [], rings: number[] = [];
  const push = (p: Vec3, role: EyeRole, gl: number) => { positions.push(p[0], p[1], p[2]); roles.push(EYE_ROLE[role]); gloss.push(gl); return positions.length / 3 - 1; };
  const at = (x: number, y: number, z: number): Vec3 => [c0[0] + a[0] * x + bb[0] * y + n[0] * z, c0[1] + a[1] * x + bb[1] * y + n[1] * z, c0[2] + a[2] * x + bb[2] * y + n[2] * z];
  const lifted = (p: Vec3) => { const l = o.rimLift ? o.rimLift(p) : 0; return addS(p, n, l); };
  rings.push(push(lifted(at(0, 0, B.heights[0]! * o.r)), 'eyespot', 0));
  const roleOf = ['eyespot', 'eyespot', 'eyespot-rim', 'periocular'] as const, glossOf = [0, 0, 0, 0];
  const last: Vec3[] = [];
  B.rings.forEach((k, j) => {
    rings.push(positions.length / 3);
    for (let s = 0; s < S; s++) { const t = 2 * Math.PI * s / S, p = lifted(at(k * o.r * Math.cos(t), k * o.r * Math.sin(t), B.heights[j + 1]! * o.r)); if (j === B.rings.length - 1) last.push(p); push(p, roleOf[j]!, glossOf[j]!); }
  });
  for (let s = 0; s < S; s++) index.push(0, 1 + s, 1 + (s + 1) % S);
  for (let j = 0; j + 1 < B.rings.length; j++) { const A = 1 + j * S, C = 1 + (j + 1) * S; for (let s = 0; s < S; s++) { const l = (s + 1) % S; index.push(A + s, C + s, C + l, A + s, C + l, A + l); } }
  const socket = positions.length / 3;
  rings.push(socket);
  for (const p of last) push(p, 'socket', 0);
  const apex = push(at(0, 0, -B.socketDepth * o.r), 'socket', 0);
  for (let s = 0; s < S; s++) index.push(apex, socket + (s + 1) % S, socket + s);
  return {positions, roles: Uint8Array.from(roles), gloss, index, surface: roles.map(() => null), rimFallbacks: 0, rings};
}

export interface StalkOptions {
  /** root on the skull, unit direction, length and radii at the root and the tip, metres */
  base: Vec3; dir: Vec3; up: Vec3; length: number; r0: number; r1: number;
  segments: number; rings: number;
  /** how far the root is sunk into the skull (fraction of r0) */
  sink?: number;
}
/** An eye stalk: a tapered tube of `segments` x `rings`, closed at the root (sunk into the skull) and at the tip (hidden
 * inside the eye bulb). segments x 2 x rings triangles. Returns the patch and the tip centre. */
export function buildStalk(o: StalkOptions): {patch: EyePatch; tip: Vec3} {
  const S = o.segments, R = o.rings, d = normalize3(o.dir);
  let a = cross(o.up, d); if (Math.hypot(...a) < 1e-6) a = cross([1, 0, 0], d);
  a = normalize3(a);
  const b = cross(d, a);
  const positions: number[] = [], roles: number[] = [], gloss: number[] = [], index: number[] = [], rings: number[] = [];
  const push = (p: Vec3) => { positions.push(p[0], p[1], p[2]); roles.push(EYE_ROLE.stalk); gloss.push(0); return positions.length / 3 - 1; };
  const root = addS(o.base, d, -(o.sink ?? 0.6) * o.r0);
  push(root);
  for (let r = 0; r < R; r++) {
    rings.push(positions.length / 3);
    const f = r / (R - 1), c = addS(root, d, f * (o.length + (o.sink ?? 0.6) * o.r0)), rr = o.r0 + (o.r1 - o.r0) * f;
    for (let k = 0; k < S; k++) { const t = 2 * Math.PI * k / S; push(addS(addS(c, a, rr * Math.cos(t)), b, rr * Math.sin(t))); }
  }
  const tip = addS(o.base, d, o.length), cap = push(addS(tip, d, 0.2 * o.r1));
  for (let k = 0; k < S; k++) index.push(0, 1 + (k + 1) % S, 1 + k);
  for (let r = 0; r + 1 < R; r++) { const A = 1 + r * S, B = 1 + (r + 1) * S; for (let k = 0; k < S; k++) { const l = (k + 1) % S; index.push(A + k, B + l, B + k, A + k, A + l, B + l); } }
  const last = 1 + (R - 1) * S;
  for (let k = 0; k < S; k++) index.push(cap, last + k, last + (k + 1) % S);
  return {patch: {positions, roles: Uint8Array.from(roles), gloss, index, surface: roles.map(() => null), rimFallbacks: 0, rings}, tip};
}
