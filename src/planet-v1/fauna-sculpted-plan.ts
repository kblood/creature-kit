import type {QuadrupedPlan, QuadrupedPrimitive, Vec3} from './fauna-body-plan.ts';

/** An explicit presentation revision. The inherited genome and all locomotion
 * landmarks belong to the caller; only newly allocated skin volumes change. */
export const QUADRUPED_SCULPTED_BODY_VERSION = 'quadruped-body-sculpted-1';
export type QuadrupedBodyPresentation = 'legacy-v4' | 'sculpted-v1';
export interface QuadrupedBodyOptions {presentation?: QuadrupedBodyPresentation}

/** A barely sampled tail cap can form a detached sub-cell island. Discard only
 * that numerical dust, never a foot, a substantial part, or the main skin.
 * The rest of the mesher (including its saddle-edge limitation) is unchanged. */
export function removeTailSamplingDust(positions: number[], indices: number[], plan: QuadrupedPlan, cell: number) {
  const count = positions.length / 3, parents = Int32Array.from({length:count}, (_, i) => i);
  const root = (v: number): number => {while(parents[v] !== v){parents[v] = parents[parents[v]!]!;v = parents[v]!;}return v;};
  for(let t = 0; t < indices.length; t += 3) {parents[root(indices[t]!)] = root(indices[t + 1]!);parents[root(indices[t + 1]!)] = root(indices[t + 2]!);}
  const groups = new Map<number,number[]>();
  for(let v = 0; v < count; v++){const r = root(v);if(!groups.has(r))groups.set(r,[]);groups.get(r)!.push(v);}
  const discarded = new Set<number>();let removedTailIslands = 0;
  for(const ids of groups.values()) {
    if(ids.length > 16 || ids.some(v => positions[v * 3]! >= plan.tailBase[0] - plan.genome.torsoLength * .2))continue;
    const extents = [0,1,2].map(c => Math.max(...ids.map(v => positions[v * 3 + c]!)) - Math.min(...ids.map(v => positions[v * 3 + c]!)));
    if(Math.max(...extents) >= cell * .5)continue;
    for(const v of ids)discarded.add(v);removedTailIslands++;
  }
  const oldTriangles = indices.length / 3;
  if(discarded.size) {
    const remap = new Int32Array(count).fill(-1);let cursor = 0;
    for(let v = 0; v < count; v++)if(!discarded.has(v)){remap[v] = cursor / 3;for(let c = 0; c < 3; c++)positions[cursor++] = positions[v * 3 + c]!;}
    positions.length = cursor;cursor = 0;
    for(let t = 0; t < indices.length; t += 3)if(!discarded.has(indices[t]!))for(let c = 0; c < 3; c++)indices[cursor++] = remap[indices[t + c]!]!;
    indices.length = cursor;
  }
  return {removedTailIslands, removedVertices:discarded.size, removedTriangles:oldTriangles - indices.length / 3};
}

export function sculptQuadrupedPlan(source: QuadrupedPlan): QuadrupedPlan {
  const g = source.genome, L = g.torsoLength, H = g.torsoHeight, W = g.torsoWidth;
  const padded = g.morphology?.family === 'padded' || g.archetype === 'low-slung';
  const heavy = g.morphology?.family === 'proboscidean';
  const primitives: QuadrupedPrimitive[] = source.primitives.map(p => ({...p, a: [...p.a], b: [...p.b]}));
  const radius = (p: QuadrupedPrimitive, r: Vec3) => {p.b = r; p.ra = p.rb = Math.min(...r);};
  // Three overlapping ovoids describe the pelvis, tucked flank and rib cage.
  // This removes the straight capsule underside without changing shoulder or
  // hip attachment points, body length, or the inherited family proportions.
  const [pelvis, abdomen, chest] = primitives;
  pelvis!.a = [-L * .255, source.torsoY + H * .045, 0];
  radius(pelvis!, [L * .285, H * .465, W * .47]);
  abdomen!.a = [-L * .055, source.torsoY + H * (padded || heavy ? .045 : .08), 0];
  radius(abdomen!, [L * .345, H * (padded || heavy ? .39 : .345), W * .405]);
  chest!.a = [L * .20, source.torsoY - H * .035, 0];
  radius(chest!, [L * .305, H * .515, W * .485]);
  abdomen!.blend = chest!.blend = H * .2;

  for (const p of primitives) {
    if (p.region === 'head' && p.shape === 'ellipsoid' && p.a[0] === source.headCentre[0]) {
      // A distinguishable cranium above the tapering muzzle, including the
      // existing neonatal dome. Facial landmarks stay on the same skull.
      radius(p, [p.b[0] * 1.06, p.b[1] * 1.10, p.b[2] * 1.12]);
    }
    if (p.region === 'neck' && p.shape === 'cone') {
      // Smooth throat/withers transition; keep the slender upper neck.
      p.ra *= p.bone === 4 ? 1.13 : 1.04;
      p.rb *= 1.04; p.blend *= 1.12;
    }
    if (p.region === 'upper') {
      const leg = source.legs.find(l => l.upperBone === p.bone)!;
      if (p.shape === 'ellipsoid') {
        // Long proximal muscle belly and a narrower distal tendon instead of
        // a round knob at the hip. Nothing moves the solved joint or sole.
        const t = leg.rear ? .29 : .24;
        p.a = leg.hip.map((v, i) => v + (leg.knee[i]! - v) * t) as Vec3;
        radius(p, [leg.hipRadius * (leg.rear ? 1.08 : .9), Math.min(leg.upperLength * .4, H * .46), leg.hipRadius * .86]);
        p.blend = leg.hipRadius * .78;
      } else {p.ra *= 1.02; p.rb *= 1.06; p.blend *= 1.08;}
    }
    if(p.region === 'lower' && p.shape === 'cone') {
      p.ra *= 1.06; p.rb *= 1.12;
    }
    if (p.region === 'foot' && p.shape === 'ellipsoid') {
      // A forward-bearing toe/pad, still with exactly the authored sole y=0.
      // Vertical radius and centre deliberately remain the contact contract.
      const footType = g.morphology?.footType;
      const forward = footType === 'paw' ? 1.65 : footType === 'hoof' ? 1.42 : 1.10;
      const wide = footType === 'paw' ? 1.28 : footType === 'hoof' ? 1.18 : 1.05;
      if(footType === 'paw' || footType === 'hoof')p.a[0] += g.footWidth * .16;
      radius(p, [p.b[0] * forward, p.b[1], p.b[2] * wide]);
    }
    if (p.region === 'tail' && p.shape === 'cone') {
      // An organic drop in the distal silhouette, using the existing three
      // tail bones. No new animation chain or random phenotype is introduced.
      for (const point of [p.a, p.b]) {
        const t = Math.max(0, Math.min(1, (source.tailBase[0] - point[0]) / Math.max(.001, source.tailBase[0] - source.tailTip[0])));
        point[1] -= Math.min(g.tailLength * .16, H * .28) * t * t;
      }
      // Do not taper below the inherited distal thickness: a sub-cell taper
      // creates stair steps in surface nets rather than a readable tail tip.
    }
  }
  const appendages = source.appendages.map(a => ({...a, base: [...a.base] as Vec3, tip: [...a.tip] as Vec3,
    radius: a.radius * (a.kind === 'ear' && !heavy ? 1.22 : 1)}));
  return {...source, version: QUADRUPED_SCULPTED_BODY_VERSION, primitives, appendages};
}
