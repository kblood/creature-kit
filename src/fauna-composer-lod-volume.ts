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
    // Thin appendages otherwise lose their intervening surface before the
    // broad torso. This priority reserves no extra hard vertices.
    const slenderJoints = new Set([...(graph.chains.neck ?? []), ...(graph.chains.tail ?? [])]);
    for (const v of ids) if ([0, 1, 2, 3].some(k => source.skinWeight[v * 4 + k]! > .1 && slenderJoints.has(source.skinIndex[v * 4 + k]!))) importance[v] = Math.max(importance[v]!, 32);
    // Armor needs diagonal support beneath its studs at bone boundaries.
    // Only vertical midpoint samples are additional: the adjacent octagons
    // already bound its width, freeing redundant anchors for attachments.
    sample(ids, graph.chains.torso ?? [], [0, 1], armored ? OCTAGON : CARDINAL);
    if (armored) sample(ids, graph.chains.torso ?? [], [.5], [[1, 0], [-1, 0]]);
    const neck = graph.chains.neck ?? [];
    // The denser armored torso also supports the fused neck root. Avoid a
    // second hard ring there; ordinary four-direction bodies need their own.
    sample(ids, neck.slice(0, 1), armored ? [.5, 1] : [0, .5, 1], CARDINAL);
    sample(ids, neck.slice(1), [0, .5, 1], CARDINAL);
    const tail = graph.chains.tail ?? [];
    if (tail.length) {
      // Bound the root bend on both sides, the middle and the tip join.
      // Four source rings remain bounded as tail tessellation/bones grow.
      sample(ids, tail.slice(0, 1), [.75], CARDINAL);
      sample(ids, tail.slice(1, 2), [.25], CARDINAL);
      sample(ids, tail.slice(Math.floor(tail.length / 2), Math.floor(tail.length / 2) + 1), [.5], CARDINAL);
      sample(ids, tail.slice(-1), [1], CARDINAL);
    }
  }
  const legs = graph.limbs?.filter(limb => limb.kind === 'leg') ?? [];
  // Dense multi-leg recipes already have bounded joint-region/sole anchors.
  // Additional rings must not grow with every tiny leg in those recipes.
  if (legs.length <= 8) for (const limb of legs) {
    const part = parts.find(p => p.label === `leg ${limb.pair + 1}${limb.side < 0 ? 'L' : 'R'}`);
    if (part) {
      // Three-segment legs need two full rings through their slender shank.
      // Two-segment legs retain vertical bend support at both quarters, with
      // one shared lateral ring between the existing joint-region extrema.
      if (limb.bones.length > 3) sample(idsOf(part), limb.bones.slice(0, -1), [.25, .75], CARDINAL);
      else {
        sample(idsOf(part), limb.bones.slice(0, -1), [.25, .75], [[1, 0], [-1, 0]]);
        sample(idsOf(part), limb.bones.slice(0, -1), [.5], [[0, 1], [0, -1]]);
      }
    }
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
  // The rear cranium is part of the fused neck loft, so a head-part vertex
  // alone is not the supporting surface. Preserve the actual closest source
  // triangle on either the head or its weighted neck junction, plus the ear
  // vertex it supports. Every coordinate and weight remains original.
  const headJoints = new Set([graph.chains.head, ...(graph.chains.neck ?? []).slice(-1)]);
  const headSurface: number[] = [];
  for (const part of parts) if ((part.part === 'head' && !part.label.endsWith('ears')) || part.part === 'torso') {
    for (let t = part.firstTriangle * 3; t < (part.firstTriangle + part.triangles) * 3; t += 3) {
      if (part.part === 'torso' && ![0, 1, 2].some(k => {
        const v = source.index[t + k]!; return [0, 1, 2, 3].some(j => source.skinWeight[v * 4 + j]! > 0 && headJoints.has(source.skinIndex[v * 4 + j]!));
      })) continue;
      headSurface.push(t);
    }
  }
  const head = parts.filter(part => part.part === 'head' && !part.label.endsWith('ears')).flatMap(idsOf);
  for (const part of parts.filter(part => part.part === 'head' && part.label.endsWith('ears'))) {
    for (const ear of components(part).slice(0, 2)) {
      // The existing head contour support is distinct from the closest neck
      // facet; retain it while adding the actual attachment surface below.
      const centralRoot = nearest(ear, graph.bones[graph.chains.head]!.restPosition);
      if (centralRoot >= 0) nearest(head, p.subarray(centralRoot * 3, centralRoot * 3 + 3));
      for (const v of ear) importance[v] = Math.max(importance[v]!, 8);
      let root = -1, best = -1, distance = Infinity;
      for (const v of ear) for (const t of headSurface) {
        const d = pointTriangleDistance2(p, v, source.index[t]!, source.index[t + 1]!, source.index[t + 2]!);
        if (d < distance) { distance = d; best = t; root = v; }
      }
      if (best >= 0) { keep[root] = 1; for (let k = 0; k < 3; k++) keep[source.index[best + k]!] = 1; }
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
  // scale, including the source-welded head join. Its stronger soft priority
  // preserves that curved junction alongside the new neck/tail priority.
  let diagonal2 = 0;
  for (let k = 0; k < 3; k++) {
    let low = Infinity, high = -Infinity;
    for (let v = 0; v < count; v++) { low = Math.min(low, p[v * 3 + k]!); high = Math.max(high, p[v * 3 + k]!); }
    diagonal2 += (high - low) ** 2;
  }
  const diagonal = Math.sqrt(diagonal2);
  for (const part of parts.filter(part => part.part === 'trunk')) for (const v of idsOf(part)) {
    deformationScale[v] = diagonal;
    importance[v] = Math.max(importance[v]!, 96);
  }
  return {...base, deformationScale};
}

// Closest surface support, rather than a nearby vertex whose incident head
// triangles can recede from the ear root. Ericson triangle Voronoi regions.
function pointTriangleDistance2(p: Float32Array, v: number, a: number, b: number, c: number): number {
  const ax=p[a*3]!,ay=p[a*3+1]!,az=p[a*3+2]!,px=p[v*3]!,py=p[v*3+1]!,pz=p[v*3+2]!;
  const bx=p[b*3]!,by=p[b*3+1]!,bz=p[b*3+2]!,cx=p[c*3]!,cy=p[c*3+1]!,cz=p[c*3+2]!;
  const abx=bx-ax,aby=by-ay,abz=bz-az,acx=cx-ax,acy=cy-ay,acz=cz-az,apx=px-ax,apy=py-ay,apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
  const at=(x:number,y:number,z:number)=>(px-x)**2+(py-y)**2+(pz-z)**2;
  if(d1<=0&&d2<=0)return at(ax,ay,az);
  const bpx=px-bx,bpy=py-by,bpz=pz-bz,d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
  if(d3>=0&&d4<=d3)return at(bx,by,bz);
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const u=d1/(d1-d3);return at(ax+u*abx,ay+u*aby,az+u*abz);}
  const cpx=px-cx,cpy=py-cy,cpz=pz-cz,d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
  if(d6>=0&&d5<=d6)return at(cx,cy,cz);
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const u=d2/(d2-d6);return at(ax+u*acx,ay+u*acy,az+u*acz);}
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){const u=(d4-d3)/((d4-d3)+(d5-d6));return at(bx+u*(cx-bx),by+u*(cy-by),bz+u*(cz-bz));}
  const n=1/(va+vb+vc),u=vb*n,w=vc*n;return at(ax+abx*u+acx*w,ay+aby*u+acy*w,az+abz*u+acz*w);
}
