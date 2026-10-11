/** Original-vertex volume constraints. No replacement surfaces or moved vertices. */
import type {ComposerLodAnatomyGraph, ComposerLodOptions, ComposerLodPart, ComposerLodSource} from './fauna-composer-lod.ts';

type V3 = readonly [number, number, number];
type Constraints = Pick<ComposerLodOptions, 'protectedVertices' | 'vertexImportance' | 'deformationScale'>;
const CARDINAL = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const OCTAGON = [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2], [0, -1], [Math.SQRT1_2, -Math.SQRT1_2]] as const;

export function applyComposerVolumeConstraints(source: ComposerLodSource, graph: ComposerLodAnatomyGraph, base: Constraints): Constraints {
  const keep = base.protectedVertices!, importance = base.vertexImportance!, p = source.positions;
  const parts = source.parts ?? [], count = p.length / 3;
  const idsOf = (part: ComposerLodPart) => [...new Set(source.index.slice(part.firstTriangle * 3, (part.firstTriangle + part.triangles) * 3))];
  const axes = (q: readonly number[]): readonly V3[] => {
    const [x, y, z, w] = q as [number, number, number, number];
    return [[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
      [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
      [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]];
  };
  const nearest = (ids: readonly number[], point: ArrayLike<number>) => {
    let best = -1, distance = Infinity;
    for (const v of ids) {
      const d = (p[v * 3]! - point[0]!) ** 2 + (p[v * 3 + 1]! - point[1]!) ** 2 + (p[v * 3 + 2]! - point[2]!) ** 2;
      if (d < distance) { distance = d; best = v; }
    }
    if (best >= 0) keep[best] = 1;
    return best;
  };
  const sample = (ids: number[], joints: readonly number[], stations: readonly number[], directions: readonly (readonly number[])[]) => {
    for (const joint of joints) {
      const b = graph.bones[joint]!, [ax, ay, az] = axes(b.restQuaternion) as [V3, V3, V3];
      for (const u of stations) {
        const ry = b.start.h * (1 - u) + b.end.h * u, rz = b.start.w * (1 - u) + b.end.w * u;
        if (!(ry > 0 && rz > 0 && b.length > 0)) continue;
        const yc = (b.start.yc ?? 0) * (1 - u) + (b.end.yc ?? 0) * u;
        const centre = b.restPosition.map((x, k) => x + ax[k]! * b.length * u);
        for (const [y, z] of directions as readonly (readonly [number, number])[]) {
          let best = -1, score = -Infinity;
          for (const v of ids) {
            const dx = p[v * 3]! - centre[0]!, dy = p[v * 3 + 1]! - centre[1]!, dz = p[v * 3 + 2]! - centre[2]!;
            const x = dx * ax[0] + dy * ax[1] + dz * ax[2];
            const a = dx * ay[0] + dy * ay[1] + dz * ay[2] - yc, c = dx * az[0] + dy * az[1] + dz * az[2];
            const out = y * a / ry + z * c / rz;
            if (Math.abs(x) > b.length * .18 || Math.abs(a) > ry * 2 || Math.abs(c) > rz * 2 || out <= 0) continue;
            const q = out - 6 * (x / Math.max(b.length, .001)) ** 2;
            if (q > score) { score = q; best = v; }
          }
          if (best >= 0) keep[best] = 1;
          else nearest(ids, centre.map((x, k) => x + ay[k]! * (yc + y * ry) + az[k]! * z * rz));
        }
      }
    }
  };
  // Component membership prevents a wing's thin finger struts from standing
  // in for the actual membrane outline. At most two ears and one membrane
  // per wing are sampled, irrespective of tessellation density.
  const components = (part: ComposerLodPart): number[][] => {
    const ids = idsOf(part), parent = new Map(ids.map(v => [v, v]));
    const find = (v: number) => { let r = v; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
    const join = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a); };
    for (let t = part.firstTriangle * 3; t < (part.firstTriangle + part.triangles) * 3; t += 3) {
      join(source.index[t]!, source.index[t + 1]!); join(source.index[t]!, source.index[t + 2]!);
    }
    const out = new Map<number, number[]>();
    for (const v of ids) { const r = find(v); if (!out.has(r)) out.set(r, []); out.get(r)!.push(v); }
    return [...out.values()].sort((a, b) => b.length - a.length);
  };

  const torso = parts.find(part => part.part === 'torso');
  if (torso) {
    const ids = idsOf(torso), armored = parts.some(part => part.part === 'armor');
    for (const v of ids) importance[v] = Math.max(importance[v]!, 8);
    // Four directions retain the ordinary torso. Armor also needs the
    // diagonal surface under its studs, rather than a diamond cross-section.
    sample(ids, graph.chains.torso ?? [], armored ? [0, .5, 1] : [0, 1], armored ? OCTAGON : CARDINAL);
    const neck = graph.chains.neck ?? [];
    // The denser armored torso also supports the fused neck root. Avoid a
    // second hard ring there; ordinary four-direction bodies need their own.
    sample(ids, neck.slice(0, 1), armored ? [.5, 1] : [0, .5, 1], CARDINAL);
    sample(ids, neck.slice(1), [0, .5, 1], CARDINAL);
  }
  const legs = graph.limbs?.filter(limb => limb.kind === 'leg') ?? [];
  // Dense multi-leg recipes already have bounded joint-region/sole anchors.
  // Additional rings must not grow with every tiny leg in those recipes.
  if (legs.length <= 8) for (const limb of legs) {
    const part = parts.find(p => p.label === `leg ${limb.pair + 1}${limb.side < 0 ? 'L' : 'R'}`);
    if (part) sample(idsOf(part), limb.bones.slice(0, -1), [.25, .75], CARDINAL);
  }
  for (const part of parts.filter(part => part.part === 'wing')) {
    const ids = idsOf(part); for (const v of ids) importance[v] = Math.max(importance[v]!, 8);
    const membrane = components(part)[0]; if (!membrane?.length) continue;
    let low = Infinity, high = -Infinity;
    for (const v of membrane) { low = Math.min(low, p[v * 3 + 2]!); high = Math.max(high, p[v * 3 + 2]!); }
    const span = high - low; if (!(span > 0)) continue;
    for (const u of [0, .25, .5, .75, 1]) for (const sign of [-1, 1]) {
      let best = -1, score = -Infinity;
      for (const v of membrane) {
        const d = (p[v * 3 + 2]! - (low + span * u)) / span; if (Math.abs(d) > .12) continue;
        const q = sign * p[v * 3]! - Math.abs(d) * span;
        if (q > score) { score = q; best = v; }
      }
      if (best >= 0) keep[best] = 1;
    }
  }
  const head = parts.filter(part => part.part === 'head' && !part.label.endsWith('ears')).flatMap(idsOf);
  for (const part of parts.filter(part => part.part === 'head' && part.label.endsWith('ears'))) {
    for (const ear of components(part).slice(0, 2)) {
      const root = nearest(ear, graph.bones[graph.chains.head]!.restPosition);
      if (root >= 0) nearest(head, p.subarray(root * 3, root * 3 + 3));
    }
  }
  // Global-diagonal skin penalties preferentially remove the circumference
  // of a thin limb (constant weights) instead of reducing axial tessellation
  // (changing weights). Its own weighted bone diameter is the relevant scale.
  const deformationScale = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    let diameter = 0;
    for (let k = 0; k < 4; k++) {
      const weight = source.skinWeight[v * 4 + k]!;
      if (!(weight > 0)) continue;
      const b = graph.bones[source.skinIndex[v * 4 + k]!]!;
      diameter += weight * Math.max(b.start.h, b.start.w, b.end.h, b.end.w) * 2;
    }
    deformationScale[v] = Math.max(diameter, 1e-6);
  }
  // The articulated proboscis already has calibrated quarter-section rings
  // and substantial inter-joint motion. Preserve its historical deformation
  // priority, including the source-welded head join.
  let diagonal2 = 0;
  for (let k = 0; k < 3; k++) {
    let low = Infinity, high = -Infinity;
    for (let v = 0; v < count; v++) { low = Math.min(low, p[v * 3 + k]!); high = Math.max(high, p[v * 3 + k]!); }
    diagonal2 += (high - low) ** 2;
  }
  const diagonal = Math.sqrt(diagonal2);
  for (const part of parts.filter(part => part.part === 'trunk')) for (const v of idsOf(part)) deformationScale[v] = diagonal;
  return {...base, deformationScale};
}
