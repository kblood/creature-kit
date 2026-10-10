/**
 * Deterministic LOD chain for the composer skin (fauna-composer-lod-1; creature export v2).
 *
 * buildComposerLodChain(source, targets) reduces one composer skin to a chain of triangle targets in a single pass of
 * quadric-error HALF-EDGE collapses (Garland-Heckbert quadrics, the surviving vertex keeps its own position). Every
 * output vertex is therefore an original skin vertex, unchanged: its position, runtime normal, colour, gloss and skin
 * weights are copied bit for bit. A removed vertex is re-bound to the surviving vertex it collapsed into (its
 * "representative", reported per source vertex). The skin has no UVs; if one ever does, the same copy applies.
 *
 * Rules that keep it deterministic and safe:
 * - Positions are welded by exact float value before collapsing, so a seam (two skin vertices at one position with
 *   different attributes) can never open a crack: the seam moves as one position.
 * - Cost = quadric error at the surviving position + an attribute term (colour, gloss and skin-weight L1 distance,
 *   scaled by the collapsed area and the body size), so eyes, colour borders and joints between bone regions are
 *   collapsed last; a vertex never moves onto one weighted to very different bones while a cheaper choice exists.
 * - Validity: the link condition (the mesh stays manifold), no triangle may turn by more than ~72 degrees or become
 *   degenerate, open borders only collapse along themselves, non-manifold input edges are locked, and a tetrahedron
 *   is never flattened.
 * - Sagittal symmetry: the composer mirror plane is z = 0. A vertex on the plane only collapses onto the plane; an
 *   off-plane vertex with an exact mirror partner collapses together with its partner onto the mirrored target, or
 *   not at all. Pairs that cannot be mirrored after the first half are counted (`asymmetricCollapses`).
 * - Order: a binary heap ordered by (cost, vertex id); a vertex's best target is the cheapest valid neighbour, ties
 *   to the lowest id. No Math.random, no clock, no transcendental function (only +, -, *, / and sqrt, which IEEE
 *   rounds exactly), so the chain is the same in every engine that runs this code.
 *
 * Pure: no three, no Node API, no Atlas module.
 */

export const COMPOSER_LOD_VERSION = 'fauna-composer-lod-1';
/** Additive opt-in constraints; absent options preserve the original reducer. */
export const COMPOSER_LOD_CONSTRAINTS_VERSION='fauna-composer-lod-constraints-1';
export const COMPOSER_FOOT_LOD_VERSION = 'fauna-composer-foot-lod-1';

/** Default attribute weights (dimensionless; multiplied by the body diagonal) and the largest allowed face turn. */
export const COMPOSER_LOD_DEFAULTS = Object.freeze({colour: 0.02, gloss: 0.05, skin: 0.08, boundary: 10, minFaceCosine: 0.3});

export interface ComposerLodPart {part: string; label: string; firstTriangle: number; triangles: number}
/** The arrays the reducer reads (the composer skin's layout: 3 floats per position/normal/colour, 4 joints/weights). */
export interface ComposerLodSource {
  positions: Float32Array; colors: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array;
  index: Uint32Array | Uint16Array;
  normals?: Float32Array; gloss?: Float32Array;
  parts?: readonly ComposerLodPart[];
}
export interface ComposerLodOptions {
  /** Keep the z = 0 mirror symmetry (default true). */
  symmetry?: boolean;
  /** Hard position anchors, source-vertex indexed0/1. Welded positions inherit
   * any protected member. Anchors may receive collapses but never move. */
  protectedVertices?: Uint8Array;
  /** Source-vertex importance>=1; welded positions take the maximum. */
  vertexImportance?: Float32Array;
  colour?: number; gloss?: number; skin?: number; boundary?: number; minFaceCosine?: number;
}
/** Skin-6's joined ankles no longer have separate closed foot components to
 * resist collapse. Preserve sole/ankle extrema and the supporting leg's joint
 * regions, and spend more of the remaining error budget on these contours.
 * Explicit opt-in: historical skin-5 reductions remain byte-identical. */
export function composerFootLodConstraints(source: ComposerLodSource): Pick<ComposerLodOptions, 'protectedVertices' | 'vertexImportance'> {
  const count = source.positions.length / 3;
  const protectedVertices = new Uint8Array(count), vertexImportance = new Float32Array(count).fill(1);
  const legCount = source.parts?.filter(part => part.part === 'leg').length ?? 0;
  for (const part of source.parts ?? []) {
    if (part.part === 'leg') {
      const next = source.parts?.[(source.parts.indexOf(part)) + 1];
      if (!next || !/^(pad|hoof|claw) /.test(next.label)) continue;
      // A surviving sole is insufficient if reduction removes the shank above
      // it. Keep the spatial extrema of each dominant joint region as well.
      const groups = new Map<number, number[]>();
      for (const id of new Set(source.index.slice(part.firstTriangle * 3, (part.firstTriangle + part.triangles) * 3))) {
        vertexImportance[id] = 4;
        let slot = 0; for (let k = 1; k < 4; k++) if (source.skinWeight[id * 4 + k]! > source.skinWeight[id * 4 + slot]!) slot = k;
        const joint = source.skinIndex[id * 4 + slot]!;
        if (!groups.has(joint)) groups.set(joint, []);
        groups.get(joint)!.push(id);
      }
      for (const band of groups.values()) for (const axis of (legCount > 8 ? [1, 2] : [0, 1, 2])) for (const sign of [-1, 1]) {
        let best = -1, value = -Infinity;
        for (const id of band) { const q = sign * source.positions[id * 3 + axis]!; if (q > value) { value = q; best = id; } }
        if (best >= 0) protectedVertices[best] = 1;
      }
    }
    if (part.part !== 'foot' || !/^(pad|hoof|claw) /.test(part.label)) continue;
    const ids = [...new Set(source.index.slice(part.firstTriangle * 3, (part.firstTriangle + part.triangles) * 3))];
    let low = Infinity, high = -Infinity;
    for (const id of ids) { const y = source.positions[id * 3 + 1]!; low = Math.min(low, y); high = Math.max(high, y); vertexImportance[id] = 8; }
    const height = Math.max(high - low, 1e-8);
    const sole = ids.filter(id => source.positions[id * 3 + 1]! <= low + height * 0.05);
    const ankle = ids.filter(id => source.positions[id * 3 + 1]! >= low + height * 0.65);
    for (const band of [sole, ankle]) for (const axis of [0, 2]) for (const sign of [-1, 1]) {
      let best = -1, value = -Infinity;
      for (const id of band) { const q = sign * source.positions[id * 3 + axis]!; if (q > value) { value = q; best = id; } }
      if (best >= 0) protectedVertices[best] = 1;
    }
  }
  return {protectedVertices, vertexImportance};
}
export interface ComposerLodLevel {
  /** Requested triangle target; null for the unreduced source. */
  target: number | null;
  triangles: number; vertices: number;
  /** triangles <= target. */
  reached: boolean;
  positions: Float32Array; colors: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array; index: Uint32Array;
  normals?: Float32Array; gloss?: Float32Array;
  parts: ComposerLodPart[];
  /** Output vertex -> source vertex. */
  sourceVertex: Uint32Array;
  /** Source vertex -> output vertex that stands for it (itself when it survived). */
  representative: Uint32Array;
  stats: ComposerLodStats;
}
export interface ComposerLodStats {
  collapses: number; mirroredPairs: number; asymmetricCollapses: number;
  /** 0 strict; 1 face turns up to 90 degrees allowed; 2 also unpaired collapses across the mirror (see the stage note). */
  relaxation: number;
  /** Largest RMS plane distance (m) of an accepted collapse: sqrt(quadric error / collapsed area). */
  maxPlaneError: number;
  /** Largest skin-weight L1 distance (0..2) between a source vertex and its representative. */
  maxWeightChange: number;
  /** Largest distance (m) between a source vertex and its representative at rest. */
  maxRestDisplacement: number;
  /** Surviving off-plane vertices whose exact mirror partner also survives, over those that have a partner. */
  mirrorKept: number;
}
export interface ComposerLodChain {
  version: typeof COMPOSER_LOD_VERSION;
  sourceTriangles: number; sourceVertices: number;
  /** Positions after the exact-value weld, vertices locked on non-manifold edges, open-border vertices. */
  welded: number; locked: number; boundary: number; mirrorPartners: number;
  levels: ComposerLodLevel[];
}

/** Checks a target list: positive integers, strictly decreasing. */
export function assertComposerLodTargets(targets: readonly number[]): void {
  if (!Array.isArray(targets) || !targets.length) throw new Error('composer lod: at least one triangle target is required');
  targets.forEach((t, i) => {
    if (!(Number.isInteger(t) && t >= 4)) throw new Error(`composer lod: target ${String(t)} is not an integer >= 4`);
    if (i && !(t < targets[i - 1]!)) throw new Error(`composer lod: targets must strictly decrease (${targets.join(', ')})`);
  });
}

/** Reduces `source` to each target in turn (one collapse sequence, so the levels are nested). A level whose target is
 * at least the source's triangle count is the source itself. */
export function buildComposerLodChain(source: ComposerLodSource, targets: readonly number[], options: ComposerLodOptions = {}): ComposerLodChain {
  assertComposerLodTargets(targets);
  const o = {...COMPOSER_LOD_DEFAULTS, ...options};
  const symmetry = options.symmetry ?? true;
  const pos = source.positions, nV = pos.length / 3, index = source.index, nT = index.length / 3;
  if (source.colors.length !== nV * 3 || source.skinIndex.length !== nV * 4 || source.skinWeight.length !== nV * 4) throw new Error('composer lod: attribute lengths do not match the positions');
  if (index.length % 3) throw new Error('composer lod: index length is not a multiple of 3');
  if(options.protectedVertices&&(!(options.protectedVertices instanceof Uint8Array)||options.protectedVertices.length!==nV||
    options.protectedVertices.some(v=>v>1)))throw new Error('composer lod: protectedVertices requires source-sized0/1 bytes');
  if(options.vertexImportance&&(!(options.vertexImportance instanceof Float32Array)||options.vertexImportance.length!==nV||
    options.vertexImportance.some(v=>!Number.isFinite(v)||v<1||v>16384)))throw new Error('composer lod: vertexImportance requires source-sized finite1..16384 weights');

  // ---- weld positions by exact value (first occurrence order)
  const posOf = new Int32Array(nV);
  const ids = new Map<string, number>();
  const firstAttr: number[] = [];
  for (let v = 0; v < nV; v++) {
    const key = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    let id = ids.get(key);
    if (id === undefined) { id = firstAttr.length; ids.set(key, id); firstAttr.push(v); }
    posOf[v] = id;
  }
  const nP = firstAttr.length;
  const P = new Float64Array(nP * 3);
  for (let p = 0; p < nP; p++) { const v = firstAttr[p]!; P[p * 3] = pos[v * 3]!; P[p * 3 + 1] = pos[v * 3 + 1]!; P[p * 3 + 2] = pos[v * 3 + 2]!; }
  // attribute vertices per position (CSR, ascending)
  const attrStart = new Int32Array(nP + 1);
  for (let v = 0; v < nV; v++) attrStart[posOf[v]! + 1]!++;
  for (let p = 0; p < nP; p++) attrStart[p + 1] += attrStart[p]!;
  const attrList = new Int32Array(nV), fill = attrStart.slice(0, nP);
  for (let v = 0; v < nV; v++) attrList[fill[posOf[v]!]!++] = v;

  let lo0 = Infinity, hi0 = -Infinity, diag2 = 0;
  for (let c = 0; c < 3; c++) {
    lo0 = Infinity; hi0 = -Infinity;
    for (let p = 0; p < nP; p++) { const x = P[p * 3 + c]!; if (x < lo0) lo0 = x; if (x > hi0) hi0 = x; }
    if (nP) diag2 += (hi0 - lo0) * (hi0 - lo0);
  }
  const L2 = diag2 > 0 ? diag2 : 1;

  // ---- triangles in position space
  const tri = new Int32Array(nT * 3), alive = new Uint8Array(nT);
  const adj: number[][] = Array.from({length: nP}, () => []);
  let triCount = 0;
  for (let t = 0; t < nT; t++) {
    const a = posOf[index[t * 3]!]!, b = posOf[index[t * 3 + 1]!]!, c = posOf[index[t * 3 + 2]!]!;
    tri[t * 3] = a; tri[t * 3 + 1] = b; tri[t * 3 + 2] = c;
    if (a === b || b === c || a === c) continue; // degenerate in the source: never emitted by a reduced level
    alive[t] = 1; triCount++;
    adj[a]!.push(t); adj[b]!.push(t); adj[c]!.push(t);
  }

  // ---- edge census: open borders and non-manifold edges
  const edgeCount = new Map<number, number>();
  const ekey = (a: number, b: number) => a < b ? a * nP + b : b * nP + a;
  for (let t = 0; t < nT; t++) if (alive[t]) for (let k = 0; k < 3; k++) {
    const key = ekey(tri[t * 3 + k]!, tri[t * 3 + (k + 1) % 3]!);
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  }
  const boundary = new Uint8Array(nP), locked = new Uint8Array(nP);
  const importance=options.vertexImportance?new Float64Array(nP).fill(1):null;
  for(let v=0;v<nV;v++){
    const p=posOf[v];if(options.protectedVertices?.[v])locked[p]=1;
    if(importance&&options.vertexImportance![v]>importance[p])importance[p]=options.vertexImportance![v];
  }
  for (const [key, count] of edgeCount) {
    const a = Math.floor(key / nP), b = key - a * nP;
    if (count === 1) { boundary[a] = 1; boundary[b] = 1; }
    else if (count > 2) { locked[a] = 1; locked[b] = 1; }
  }

  // ---- quadrics (area weighted) and per-position area
  const Q = new Float64Array(nP * 10), area = new Float64Array(nP);
  const addPlane = (p: number, nx: number, ny: number, nz: number, d: number, w: number) => {
    const q = p * 10;
    Q[q] += w * nx * nx; Q[q + 1] += w * nx * ny; Q[q + 2] += w * nx * nz; Q[q + 3] += w * nx * d;
    Q[q + 4] += w * ny * ny; Q[q + 5] += w * ny * nz; Q[q + 6] += w * ny * d;
    Q[q + 7] += w * nz * nz; Q[q + 8] += w * nz * d; Q[q + 9] += w * d * d;
  };
  for (let t = 0; t < nT; t++) {
    if (!alive[t]) continue;
    const a = tri[t * 3]!, b = tri[t * 3 + 1]!, c = tri[t * 3 + 2]!;
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 0)) continue;
    nx /= len; ny /= len; nz /= len;
    const w = len / 2, d = -(nx * P[a * 3]! + ny * P[a * 3 + 1]! + nz * P[a * 3 + 2]!);
    for (const p of [a, b, c]) { addPlane(p, nx, ny, nz, d, w); area[p] += w / 3; }
    // open border: a plane through the edge, perpendicular to the face, so the border keeps its shape
    for (let k = 0; k < 3; k++) {
      const e0 = tri[t * 3 + k]!, e1 = tri[t * 3 + (k + 1) % 3]!;
      if (edgeCount.get(ekey(e0, e1)) !== 1) continue;
      const ex = P[e1 * 3]! - P[e0 * 3]!, ey = P[e1 * 3 + 1]! - P[e0 * 3 + 1]!, ez = P[e1 * 3 + 2]! - P[e0 * 3 + 2]!;
      let mx = ey * nz - ez * ny, my = ez * nx - ex * nz, mz = ex * ny - ey * nx;
      const ml = Math.sqrt(mx * mx + my * my + mz * mz);
      if (!(ml > 0)) continue;
      mx /= ml; my /= ml; mz /= ml;
      const md = -(mx * P[e0 * 3]! + my * P[e0 * 3 + 1]! + mz * P[e0 * 3 + 2]!), mw = o.boundary * (ex * ex + ey * ey + ez * ez);
      addPlane(e0, mx, my, mz, md, mw); addPlane(e1, mx, my, mz, md, mw);
    }
  }
  const quadricAt = (p: number, q: number, x: number, y: number, z: number) => {
    const a = p * 10, b = q * 10;
    const g = (i: number) => Q[a + i]! + Q[b + i]!;
    return g(0) * x * x + 2 * g(1) * x * y + 2 * g(2) * x * z + 2 * g(3) * x + g(4) * y * y + 2 * g(5) * y * z + 2 * g(6) * y + g(7) * z * z + 2 * g(8) * z + g(9);
  };

  // ---- attributes (per source vertex)
  const col = source.colors, gl = source.gloss, sIdx = source.skinIndex, sW = source.skinWeight;
  const jointWeight = (v: number, j: number) => { let s = 0; for (let k = 0; k < 4; k++) { const w = sW[v * 4 + k]!; if (w > 0 && sIdx[v * 4 + k] === j) s += w; } return s; };
  const skinL1 = (a: number, b: number) => {
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const j = sIdx[a * 4 + k]!, w = sW[a * 4 + k]!;
      if (!(w > 0)) continue;
      let seen = false; for (let m = 0; m < k; m++) if (sW[a * 4 + m]! > 0 && sIdx[a * 4 + m] === j) seen = true;
      if (!seen) s += Math.abs(jointWeight(a, j) - jointWeight(b, j));
    }
    for (let k = 0; k < 4; k++) {
      const j = sIdx[b * 4 + k]!, w = sW[b * 4 + k]!;
      if (!(w > 0) || jointWeight(a, j) > 0) continue;
      let seen = false; for (let m = 0; m < k; m++) if (sW[b * 4 + m]! > 0 && sIdx[b * 4 + m] === j) seen = true;
      if (!seen) s += jointWeight(b, j);
    }
    return s;
  };
  const colour2 = (a: number, b: number) => {
    const r = col[a * 3]! - col[b * 3]!, g = col[a * 3 + 1]! - col[b * 3 + 1]!, bl = col[a * 3 + 2]! - col[b * 3 + 2]!;
    return r * r + g * g + bl * bl;
  };
  const gloss2 = (a: number, b: number) => { if (!gl) return 0; const d = gl[a]! - gl[b]!; return d * d; };
  const kc = o.colour * o.colour * L2, kg = o.gloss * o.gloss * L2, ks = o.skin * o.skin * L2;
  /** Penalty for moving position p onto q: the worst pairing of their attribute vertices. */
  const attributePenalty = (p: number, q: number) => {
    let worst = 0;
    for (let i = attrStart[p]!; i < attrStart[p + 1]!; i++) {
      const a = attrList[i]!;
      let best = Infinity;
      for (let j = attrStart[q]!; j < attrStart[q + 1]!; j++) {
        const b = attrList[j]!, s = skinL1(a, b);
        const e = kc * colour2(a, b) + kg * gloss2(a, b) + ks * s * s;
        if (e < best) best = e;
      }
      if (best > worst) worst = best;
    }
    return worst;
  };
  /** Distance used to choose an attribute vertex at a position for a corner (unscaled). */
  const attrDistance = (a: number, b: number) => { const s = skinL1(a, b); return colour2(a, b) + gloss2(a, b) + s * s; };

  // ---- mirror partners (exact z -> -z)
  const mirror = new Int32Array(nP).fill(-1);
  let mirrorPartners = 0;
  if (symmetry) for (let p = 0; p < nP; p++) {
    const z = P[p * 3 + 2]!;
    if (z === 0) { mirror[p] = p; continue; }
    const m = ids.get(`${pos[firstAttr[p]! * 3]},${pos[firstAttr[p]! * 3 + 1]},${-pos[firstAttr[p]! * 3 + 2]!}`);
    if (m !== undefined && m !== p) { mirror[p] = m; mirrorPartners++; }
  }

  // ---- topology helpers (scratch marks, no allocation per call beyond the neighbour lists)
  const deadP = new Uint8Array(nP), parent = new Int32Array(nP).fill(-1);
  const mark = new Int32Array(nP), mark2 = new Int32Array(nP);
  let stamp = 0;
  const compact = (p: number) => { const l = adj[p]!; let w = 0; for (let i = 0; i < l.length; i++) if (alive[l[i]!]) l[w++] = l[i]!; l.length = w; return l; };
  const has = (t: number, v: number) => tri[t * 3] === v || tri[t * 3 + 1] === v || tri[t * 3 + 2] === v;
  const neighbours = (p: number): number[] => {
    stamp++;
    const out: number[] = [];
    for (const t of compact(p)) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]!; if (v !== p && mark[v] !== stamp) { mark[v] = stamp; out.push(v); } }
    return out.sort((a, b) => a - b);
  };
  // Relaxation when the strict rules stall above a target: stage 1 allows a face turn up to 90 degrees (never a flip),
  // stage 2 also lets a vertex collapse without its mirror partner. Each level reports the stage it needed.
  let stage = 0;
  const minCos2s = [o.minFaceCosine * o.minFaceCosine, 0, 0], degenerate2 = (1e-12 * L2) * (1e-12 * L2);
  /** Can position p collapse onto q in the current mesh (ignoring the mirror rule)? */
  const collapsible = (p: number, q: number): boolean => {
    if (p === q || locked[p] || deadP[p] || deadP[q]) return false;
    const lp = compact(p), lq = compact(q);
    let shared = 0;
    for (const t of lp) if (has(t, q)) shared++;
    if (shared === 0 || shared > 2) return false;
    if (boundary[p]) { if (!boundary[q] || shared !== 1) return false; }
    else if (shared !== 2) return false;
    if (lp.length <= 3 && lq.length <= 3) return false; // a tetrahedron (or smaller shell) is never flattened
    // link condition: the common neighbours of p and q are exactly the apexes of the shared triangles
    stamp++;
    const s1 = stamp;
    for (const t of lp) for (let k = 0; k < 3; k++) mark[tri[t * 3 + k]!] = s1;
    stamp++;
    const s2 = stamp;
    let common = 0;
    for (const t of lq) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]!; if (v !== p && v !== q && mark[v] === s1 && mark2[v] !== s2) { mark2[v] = s2; common++; } }
    if (common !== shared) return false;
    // faces around p that stay: no flip, no large turn, no degeneracy
    const qx = P[q * 3]!, qy = P[q * 3 + 1]!, qz = P[q * 3 + 2]!;
    for (const t of lp) {
      if (has(t, q)) continue;
      const i0 = tri[t * 3]!, i1 = tri[t * 3 + 1]!, i2 = tri[t * 3 + 2]!;
      const ax = P[i0 * 3]!, ay = P[i0 * 3 + 1]!, az = P[i0 * 3 + 2]!, bx = P[i1 * 3]!, by = P[i1 * 3 + 1]!, bz = P[i1 * 3 + 2]!, cx = P[i2 * 3]!, cy = P[i2 * 3 + 1]!, cz = P[i2 * 3 + 2]!;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const n0x = uy * vz - uz * vy, n0y = uz * vx - ux * vz, n0z = ux * vy - uy * vx;
      const Ax = i0 === p ? qx : ax, Ay = i0 === p ? qy : ay, Az = i0 === p ? qz : az;
      const Bx = i1 === p ? qx : bx, By = i1 === p ? qy : by, Bz = i1 === p ? qz : bz;
      const Cx = i2 === p ? qx : cx, Cy = i2 === p ? qy : cy, Cz = i2 === p ? qz : cz;
      const Ux = Bx - Ax, Uy = By - Ay, Uz = Bz - Az, Vx = Cx - Ax, Vy = Cy - Ay, Vz = Cz - Az;
      const n1x = Uy * Vz - Uz * Vy, n1y = Uz * Vx - Ux * Vz, n1z = Ux * Vy - Uy * Vx;
      const l0 = n0x * n0x + n0y * n0y + n0z * n0z, l1 = n1x * n1x + n1y * n1y + n1z * n1z;
      if (!(l1 > degenerate2)) return false;
      const dot = n0x * n1x + n0y * n1y + n0z * n1z;
      if (!(dot > 0) || dot * dot < minCos2s[stage]! * l0 * l1) return false;
    }
    return true;
  };
  const adjacent = (a: number, b: number) => { for (const t of compact(a)) if (has(t, b)) return true; return false; };
  /** The mirror rule for p -> q: [mp, mq] to collapse with it, null when none is needed, or false when forbidden. */
  const mirrorOf = (p: number, q: number): [number, number] | null | false => {
    if (!symmetry) return null;
    const mp = mirror[p]!, mq = mirror[q]!;
    if (mp < 0 || mq < 0) return null;            // an asymmetric region: no constraint
    if (mp === p) return mq === q || stage >= 2 ? null : false; // on the plane: stay on the plane
    if (mq === p) return stage >= 2 ? null : false;              // crossing edge: would move p onto its own mirror
    const ok = !deadP[mp] && !deadP[mq] && mp !== mq && !adjacent(p, mp) && collapsible(mp, mq);
    return ok ? [mp, mq] : stage >= 2 ? null : false;
  };
  const costOf = (p: number, q: number) => {
    const e = quadricAt(p, q, P[q * 3]!, P[q * 3 + 1]!, P[q * 3 + 2]!);
    const cost=(e > 0 ? e : 0) + area[p]! * attributePenalty(p, q);
    return importance?cost*Math.max(importance[p],importance[q]):cost;
  };

  // ---- heap of (cost, vertex, version)
  let hCost = new Float64Array(1024), hVert = new Int32Array(1024), hVer = new Int32Array(1024), hSize = 0;
  const less = (i: number, j: number) => hCost[i]! < hCost[j]! || (hCost[i] === hCost[j] && hVert[i]! < hVert[j]!);
  const swap = (i: number, j: number) => {
    const c = hCost[i]!, v = hVert[i]!, r = hVer[i]!;
    hCost[i] = hCost[j]!; hVert[i] = hVert[j]!; hVer[i] = hVer[j]!; hCost[j] = c; hVert[j] = v; hVer[j] = r;
  };
  const push = (cost: number, v: number, ver: number) => {
    if (hSize === hCost.length) {
      const grow = <T extends Float64Array | Int32Array>(a: T): T => { const b = new (a.constructor as {new(n: number): T})(a.length * 2); b.set(a); return b; };
      hCost = grow(hCost); hVert = grow(hVert); hVer = grow(hVer);
    }
    let i = hSize++;
    hCost[i] = cost; hVert[i] = v; hVer[i] = ver;
    while (i > 0) { const up = (i - 1) >> 1; if (!less(i, up)) break; swap(i, up); i = up; }
  };
  const pop = () => {
    hSize--; swap(0, hSize);
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < hSize && less(l, m)) m = l;
      if (r < hSize && less(r, m)) m = r;
      if (m === i) break;
      swap(i, m); i = m;
    }
    return hSize;
  };

  const best = new Int32Array(nP).fill(-1), version = new Int32Array(nP);
  const evaluate = (p: number) => {
    version[p]!++;
    best[p] = -1;
    if (deadP[p] || locked[p]) return;
    let bc = Infinity, bq = -1;
    for (const q of neighbours(p)) {
      if (!collapsible(p, q) || mirrorOf(p, q) === false) continue;
      const c = costOf(p, q);
      if (c < bc) { bc = c; bq = q; }
    }
    if (bq >= 0) { best[p] = bq; push(bc, p, version[p]!); }
  };
  let maxPlaneError = 0, collapses = 0, mirroredPairs = 0, asymmetricCollapses = 0;
  const collapse = (p: number, q: number) => {
    const e = quadricAt(p, q, P[q * 3]!, P[q * 3 + 1]!, P[q * 3 + 2]!), a = area[p]! + area[q]!;
    if (a > 0 && e > 0) { const rms = Math.sqrt(e / a); if (rms > maxPlaneError) maxPlaneError = rms; }
    for (const t of compact(p)) {
      if (has(t, q)) { alive[t] = 0; triCount--; continue; }
      for (let k = 0; k < 3; k++) if (tri[t * 3 + k] === p) tri[t * 3 + k] = q;
      adj[q]!.push(t);
    }
    adj[p]!.length = 0;
    deadP[p] = 1; parent[p] = q;
    for (let i = 0; i < 10; i++) Q[q * 10 + i] += Q[p * 10 + i]!;
    area[q] += area[p]!;
    compact(q);
    collapses++;
  };
  const root = (p: number) => { let r = p; while (parent[r]! >= 0) r = parent[r]!; while (parent[p]! >= 0) { const n = parent[p]!; parent[p] = r; p = n; } return r; };

  for (let p = 0; p < nP; p++) evaluate(p);

  // ---- snapshots
  const snapshot = (target: number | null): ComposerLodLevel => {
    const chosen = new Int32Array(nT * 3).fill(-1);
    const used = new Uint8Array(nV);
    const pick = (orig: number, at: number, onlyUsed: boolean) => {
      if (posOf[orig] === at && (!onlyUsed || used[orig])) return orig;
      let bestA = -1, bestD = Infinity;
      for (let j = attrStart[at]!; j < attrStart[at + 1]!; j++) {
        const b = attrList[j]!;
        if (onlyUsed && !used[b]) continue;
        const d = attrDistance(orig, b);
        if (d < bestD) { bestD = d; bestA = b; }
      }
      return bestA;
    };
    const keep: number[] = [];
    for (let t = 0; t < nT; t++) {
      if (!alive[t]) continue;
      keep.push(t);
      for (let k = 0; k < 3; k++) { const a = pick(index[t * 3 + k]!, tri[t * 3 + k]!, false); chosen[t * 3 + k] = a; used[a] = 1; }
    }
    const newIndex = new Int32Array(nV).fill(-1), sourceVertex: number[] = [];
    for (let v = 0; v < nV; v++) if (used[v]) { newIndex[v] = sourceVertex.length; sourceVertex.push(v); }
    const n = sourceVertex.length, outIndex = new Uint32Array(keep.length * 3);
    keep.forEach((t, i) => { for (let k = 0; k < 3; k++) outIndex[i * 3 + k] = newIndex[chosen[t * 3 + k]!]!; });
    const take = <T extends Float32Array | Uint16Array>(src: T, c: number): T => {
      const out = new (src.constructor as {new(n: number): T})(n * c);
      for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) out[i * c + k] = src[sourceVertex[i]! * c + k]!;
      return out;
    };
    // parts: the kept triangles stay in source order, so each part is still one contiguous range
    const parts: ComposerLodPart[] = [];
    let cursor = 0;
    for (const part of source.parts ?? []) {
      let count = 0;
      while (cursor < keep.length && keep[cursor]! < part.firstTriangle + part.triangles) { if (keep[cursor]! >= part.firstTriangle) count++; cursor++; }
      parts.push({part: part.part, label: part.label, firstTriangle: cursor - count, triangles: count});
    }
    // representatives and their measured change
    const representative = new Uint32Array(nV);
    let maxWeightChange = 0, maxRest = 0;
    for (let v = 0; v < nV; v++) {
      let r = used[v] ? v : pick(v, root(posOf[v]!), true);
      if (r < 0) r = sourceVertex[0] ?? 0; // a position whose whole shell vanished (never seen); keep a valid index
      representative[v] = newIndex[r]! >= 0 ? newIndex[r]! : 0;
      const w = skinL1(v, r); if (w > maxWeightChange) maxWeightChange = w;
      const dx = pos[v * 3]! - pos[r * 3]!, dy = pos[v * 3 + 1]! - pos[r * 3 + 1]!, dz = pos[v * 3 + 2]! - pos[r * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d > maxRest) maxRest = d;
    }
    let partners = 0, kept = 0;
    if (symmetry) for (let p = 0; p < nP; p++) if (!deadP[p] && mirror[p]! >= 0 && mirror[p] !== p) { partners++; if (!deadP[mirror[p]!]) kept++; }
    return {
      target, triangles: keep.length, vertices: n, reached: target === null || keep.length <= target,
      positions: take(source.positions, 3), colors: take(source.colors, 3), skinIndex: take(source.skinIndex, 4), skinWeight: take(source.skinWeight, 4), index: outIndex,
      ...(source.normals ? {normals: take(source.normals, 3)} : {}), ...(source.gloss ? {gloss: take(source.gloss, 1)} : {}),
      parts, sourceVertex: Uint32Array.from(sourceVertex), representative,
      stats: {collapses, mirroredPairs, asymmetricCollapses, relaxation: stage, maxPlaneError, maxWeightChange, maxRestDisplacement: maxRest, mirrorKept: partners ? kept / partners : 1},
    };
  };

  const levels: ComposerLodLevel[] = [];
  for (const target of targets) {
    for (;;) {
      if (triCount <= target) break;
      if (hSize === 0) {
        if (stage >= 2) break;
        stage++;
        for (let p = 0; p < nP; p++) evaluate(p);
        continue;
      }
      const p = hVert[0]!, ver = hVer[0]!;
      pop();
      if (ver !== version[p] || deadP[p]) continue;
      const q = best[p]!;
      if (q < 0 || !collapsible(p, q)) { evaluate(p); continue; }
      const m = mirrorOf(p, q);
      if (m === false) { evaluate(p); continue; }
      collapse(p, q);
      const touched = new Set<number>([q, ...neighbours(q)]);
      if (m) {
        if (collapsible(m[0], m[1])) { collapse(m[0], m[1]); mirroredPairs++; touched.add(m[1]); for (const v of neighbours(m[1])) touched.add(v); }
        else asymmetricCollapses++;
      }
      const around = [...touched];
      for (const v of around) if (mirror[v]! >= 0) touched.add(mirror[v]!);
      for (const v of [...touched].sort((a, b) => a - b)) evaluate(v);
    }
    levels.push(snapshot(target));
  }
  let boundaryCount = 0, lockedCount = 0;
  for (let p = 0; p < nP; p++) { boundaryCount += boundary[p]!; lockedCount += locked[p]!; }
  return {version: COMPOSER_LOD_VERSION, sourceTriangles: nT, sourceVertices: nV, welded: nP, locked: lockedCount, boundary: boundaryCount, mirrorPartners, levels};
}

/** Surface deviation of a level from its source: for every `stride`-th source vertex, the distance (m) to the nearest
 * triangle of the level. `posed` (optional, source-vertex indexed xyz, e.g. the runtime's skinned positions at one
 * pose) measures the same thing after skinning: a level's vertices are source vertices with their own weights, so the
 * posed level is the posed source restricted to `sourceVertex`. Growth from rest to posed is the skinning cost of the
 * reduction. Brute force with a box early-out; meant for tests and evidence, not for the runtime. */
export function composerLodDeviation(sourcePositions: Float32Array, level: Pick<ComposerLodLevel, 'index' | 'sourceVertex'>, options: {posed?: ArrayLike<number>; stride?: number} = {}): {max: number; mean: number; p95: number; samples: number} {
  const X = options.posed ?? sourcePositions, stride = Math.max(1, Math.floor(options.stride ?? 1));
  const nT = level.index.length / 3, sv = level.sourceVertex, idx = level.index;
  const T = new Float64Array(nT * 9), box = new Float64Array(nT * 6);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = sv[idx[t * 3 + k]!]!;
    for (let c = 0; c < 3; c++) {
      const x = X[v * 3 + c]!; T[t * 9 + k * 3 + c] = x;
      if (k === 0 || x < box[t * 6 + c]!) box[t * 6 + c] = x;
      if (k === 0 || x > box[t * 6 + 3 + c]!) box[t * 6 + 3 + c] = x;
    }
  }
  const out: number[] = [];
  const n = X.length / 3;
  for (let v = 0; v < n; v += stride) {
    const px = X[v * 3]!, py = X[v * 3 + 1]!, pz = X[v * 3 + 2]!;
    let best2 = Infinity;
    for (let t = 0; t < nT; t++) {
      const b = t * 6;
      const dx = Math.max(box[b]! - px, 0, px - box[b + 3]!), dy = Math.max(box[b + 1]! - py, 0, py - box[b + 4]!), dz = Math.max(box[b + 2]! - pz, 0, pz - box[b + 5]!);
      if (dx * dx + dy * dy + dz * dz >= best2) continue;
      const d2 = pointTriangle2(px, py, pz, T, t * 9);
      if (d2 < best2) best2 = d2;
    }
    out.push(Math.sqrt(best2));
  }
  const sorted = Float64Array.from(out).sort();
  let sum = 0; for (const d of out) sum += d;
  return {max: sorted.length ? sorted[sorted.length - 1]! : 0, mean: out.length ? sum / out.length : 0, p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0, samples: out.length};
}

/** Squared distance from p to triangle T[o..o+9] (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangle2(px: number, py: number, pz: number, T: Float64Array, o: number): number {
  const ax = T[o]!, ay = T[o + 1]!, az = T[o + 2]!, bx = T[o + 3]!, by = T[o + 4]!, bz = T[o + 5]!, cx = T[o + 6]!, cy = T[o + 7]!, cz = T[o + 8]!;
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const at = (x: number, y: number, z: number) => { const ex = px - x, ey = py - y, ez = pz - z; return ex * ex + ey * ey + ez * ez; };
  if (d1 <= 0 && d2 <= 0) return at(ax, ay, az);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return at(bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at(ax + v * abx, ay + v * aby, az + v * abz); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return at(cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at(ax + w * acx, ay + w * acy, az + w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return at(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}
