import type { QuadrupedPlan, Vec3 } from './fauna-body-plan.ts';

/** Authored grounded morphologies. These closed surfaces share the body's
 * material and existing skeleton. Trunks follow the head; folded wings follow
 * the chest. Independent trunk articulation and powered flight need new rigs. */
export function appendFaunaStructuralFeatures(plan: QuadrupedPlan, positions: number[], indices: number[]): { colors: Vec3[]; bones: number[] } {
  const colors: Vec3[] = [], bones: number[] = [];
  const morphology = plan.genome.morphology;
  if (!morphology) return { colors, bones };
  const g = plan.genome;
  const hex = Number.parseInt(g.color.slice(1), 16);
  const coat = [16, 8, 0].map(shift => {
    const c = ((hex >> shift) & 255) / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }) as Vec3;
  const tint = (factor: number): Vec3 => coat.map(c => c * factor) as Vec3;
  const add = (p: Vec3, color: Vec3, bone: number) => {
    const index = positions.length / 3;
    positions.push(...p); colors.push(color); bones.push(bone);
    return index;
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const normalize = (v: Vec3): Vec3 => { const n = Math.hypot(...v); return v.map(c => c / n) as Vec3; };
  const tube = (points: Vec3[], radii: number[], bone: number, segments: number, shade = 1) => {
    const start = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)]!, next = points[Math.min(points.length - 1, i + 1)]!;
      const axis = normalize(next.map((v, k) => v - prev[k]!) as Vec3);
      const u = normalize(cross(axis, Math.abs(axis[2]) < .9 ? [0, 0, 1] : [0, 1, 0]));
      const v = cross(axis, u), p = points[i]!;
      for (let j = 0; j < segments; j++) {
        const a = j / segments * Math.PI * 2;
        add(p.map((c, k) => c + radii[i]! * (Math.cos(a) * u[k]! + Math.sin(a) * v[k]!)) as Vec3,
          tint(shade * (.95 + .05 * Math.cos(a))), bone);
      }
      if (i > 0) for (let j = 0; j < segments; j++) {
        const n = (j + 1) % segments, a = start + (i - 1) * segments, b = a + segments;
        indices.push(a + j, a + n, b + n, a + j, b + n, b + j);
      }
    }
    const begin = add(points[0]!, tint(shade), bone), end = add(points.at(-1)!, tint(shade * .6), bone);
    const last = start + (points.length - 1) * segments;
    for (let j = 0; j < segments; j++) {
      const n = (j + 1) % segments;
      indices.push(begin, start + n, start + j, end, last + j, last + n);
    }
  };
  if (morphology.trunkLength > 0) {
    // Embed the thick root within the nose and curve the tip forward. Its
    // authored extent leaves clearance in the upright inspection pose.
    const length = Math.min(morphology.trunkLength, plan.muzzleTip[1] * .65);
    const root: Vec3 = [plan.muzzleTip[0] - g.headLength * .02, plan.muzzleTip[1] + g.headWidth * .08, 0];
    const points: Vec3[] = [], radii: number[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const bridge = 1 - Math.exp(-t * 8);
      points.push([root[0] + length * (.20 * bridge + .08 * t ** 4),
        root[1] - length * (t - .15 * bridge - .14 * t ** 5), 0]);
      radii.push(g.headWidth * (.26 * (1 - t) ** 1.1 + .055));
    }
    tube(points, radii, 6, 12, .92);
  }
  if (morphology.wingSpan > 0 && morphology.wingState === 'folded') {
    const span = morphology.wingSpan / 2;
    for (const side of [-1, 1]) {
      // A folded, swept-back membrane with a supported leading edge. This is
      // an explicitly speculative quadruped family, not a real bat skeleton.
      const root: Vec3 = [g.torsoLength * .27, plan.torsoY + g.torsoHeight * .16, side * g.torsoWidth * .28];
      const anchors: Vec3[] = [root,
        [root[0] + span * .10, root[1] + span * .43, root[2] + side * span * .35],
        [root[0] - span * .38, root[1] + span * .53, root[2] + side * span * .58],
        [root[0] - span * .91, root[1] + span * .11, root[2] + side * span * .46],
        [root[0] - span * .59, root[1] + span * .09, root[2] + side * span * .27],
        [root[0] - g.torsoLength * .53, root[1] - g.torsoHeight * .06, root[2]]];
      // Concave trailing spans between the support fingers read as a flexible
      // membrane, with the near-rest wing swept back toward the body.
      const outline: Vec3[] = anchors.slice(0, 3);
      for (let edge = 2; edge < 5; edge++) {
        const a = anchors[edge]!, b = anchors[edge + 1]!;
        for (let step = 1; step <= 6; step++) {
          const t = step / 6, pull = Math.sin(t * Math.PI) * .20;
          const p = a.map((v, k) => v + (b[k]! - v) * t) as Vec3;
          outline.push(p.map((v, k) => v + (anchors[1]![k]! - v) * pull) as Vec3);
        }
      }
      const centre = outline.reduce((p, q) => p.map((v, k) => v + q[k]! / outline.length) as Vec3, [0, 0, 0] as Vec3);
      const thickness = Math.max(.003, g.torsoWidth * .009);
      const halves: number[][] = [];
      for (const shell of [-1, 1]) {
        const row = outline.map(p => add([p[0], p[1], p[2] + shell * thickness], tint(.67), 3));
        const middle = add([centre[0], centre[1] + span * .025, centre[2] + shell * thickness], tint(.88), 3);
        for (let i = 0; i < row.length; i++) {
          const n = (i + 1) % row.length;
          if (shell > 0) indices.push(middle, row[i]!, row[n]!);
          else indices.push(middle, row[n]!, row[i]!);
        }
        halves.push(row);
      }
      for (let i = 0; i < outline.length; i++) {
        const n = (i + 1) % outline.length, a = halves[0]!, b = halves[1]!;
        indices.push(a[i]!, a[n]!, b[n]!, a[i]!, b[n]!, b[i]!);
      }
      tube(anchors.slice(0, 3), [1, .85, .35].map(r => Math.max(.007, g.torsoWidth * .038) * r), 3, 8, .75);
      for (const end of [anchors[3]!, anchors[4]!, anchors[5]!]) tube([anchors[1]!, end], [g.torsoWidth * .022, .005], 3, 6, .8);
    }
  }
  return { colors, bones };
}
