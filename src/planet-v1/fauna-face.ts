import type { QuadrupedPlan, Vec3 } from './fauna-body-plan.ts';
import {QUADRUPED_SCULPTED_BODY_VERSION} from './fauna-sculpted-plan.ts';

/** Small surface details share the body's draw, material and skinning. All
 * landmarks are projected onto the actual polygonised skin, so coarse grids
 * cannot swallow an eye or leave a mouth floating above a different surface. */
export interface FaunaFaceFeature {
  kind: 'eye' | 'nostril' | 'mouth'; side: -1 | 1;
  firstVertex: number; vertexCount: number;
  firstTriangle: number; triangleCount: number;
}

type Triangle = { x: number; y: number; z: number; ux: number; uy: number; uz: number;
  vx: number; vy: number; vz: number; det: number; vertices: [number, number, number] };
export interface FaunaFaceAttachment { vertices: [number, number, number]; weights: [number, number, number] }

export function* quadrupedFaceBuildSteps(plan: QuadrupedPlan, positions: number[], indices: number[],
  bodyTriangleCount: number, colors: Vec3[], attachments: FaunaFaceAttachment[]): Generator<void, FaunaFaceFeature[], void> {
  const { headWidth: hw, headLength: hl } = plan.genome;
  const sculpted = plan.version === QUADRUPED_SCULPTED_BODY_VERSION;
  const [nx, ny] = plan.neckTip;
  const triangles: Triangle[] = [];
  // Only the skull/muzzle portion of the closed body skin is relevant. Ears
  // and horns are intentionally excluded from the projection surface.
  for (let t = 0; t < bodyTriangleCount * 3; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    if (Math.max(positions[a]!, positions[b]!, positions[c]!) < nx - hl * .25
      || Math.max(positions[a + 1]!, positions[b + 1]!, positions[c + 1]!) < ny - hw * .5) continue;
    const x = positions[a]!, y = positions[a + 1]!, z = positions[a + 2]!;
    const ux = positions[b]! - x, uy = positions[b + 1]! - y, uz = positions[b + 2]! - z;
    const vx = positions[c]! - x, vy = positions[c + 1]! - y, vz = positions[c + 2]! - z;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) > 1e-12) triangles.push({ x, y, z, ux, uy, uz, vx, vy, vz, det, vertices: [a / 3, b / 3, c / 3] });
  }
  const surface = (x: number, y: number, side: number) => {
    let outer = -Infinity;
    let attachment: FaunaFaceAttachment | undefined;
    for (const t of triangles) {
      const dx = x - t.x, dy = y - t.y;
      const u = (dx * t.vy - dy * t.vx) / t.det, v = (t.ux * dy - t.uy * dx) / t.det;
      const z = side * (t.z + u * t.uz + v * t.vz);
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7 && z > outer) {
        outer = z;
        attachment = { vertices: t.vertices, weights: [1 - u - v, u, v] };
      }
    }
    if (!Number.isFinite(outer)) throw new Error('Fauna facial landmark outside skull surface');
    return { z: outer * side, attachment: attachment! };
  };
  const features: FaunaFaceFeature[] = [];
  const skin = linearColor(plan.genome.color);
  const dark: Vec3 = [.009, .007, .005];
  const rim = skin.map(c => c * .48) as Vec3;
  // Dark brown iris without white human-like sclera. Colour is a bounded
  // expression of the inherited coat, rather than a new random identity.
  const iris: Vec3 = sculpted ? [Math.min(.14, .065 + skin[0] * .18), Math.min(.09, .035 + skin[1] * .12), .014]
    : [Math.min(.075, .022 + skin[0] * .12), Math.min(.045, .014 + skin[1] * .08), .008];
  const vertex = (x: number, y: number, side: -1 | 1, lift: number, color: Vec3) => {
    const index = positions.length / 3;
    const hit = surface(x, y, side);
    positions.push(x, y, hit.z + side * lift);
    colors.push(color);
    attachments.push(hit.attachment);
    return index;
  };
  const tri = (a: number, b: number, c: number, side: number) => {
    if (side > 0) indices.push(a, b, c); else indices.push(a, c, b);
  };
  for (const side of [-1, 1] as const) {
    for (const kind of ['eye', 'nostril', 'mouth'] as const) {
      const firstVertex = positions.length / 3, firstTriangle = indices.length / 3;
      if (kind === 'mouth') {
        const segments = 10;
        for (let s = 0; s <= segments; s++) {
          const t = s / segments, x = nx + hl * (.29 + .37 * t);
          const y = ny - hw * (.21 + .035 * Math.sin(t * Math.PI));
          const width = hw * (.003 + .009 * Math.sin(t * Math.PI));
          vertex(x, y - width, side, hw * .006, rim);
          vertex(x, y + width, side, hw * .006, dark);
          if (s > 0) {
            const a = firstVertex + (s - 1) * 2;
            tri(a, a + 2, a + 3, side); tri(a, a + 3, a + 1, side);
          }
        }
      } else {
        const eye = kind === 'eye', cx = nx + hl * (eye ? .28 : .64), cy = ny + hw * (eye ? .20 : -.10);
        const rx = hw * (eye ? (sculpted ? .135 : .10) : .060), ry = hw * (eye ? (sculpted ? .078 : .054) : .036), segments = 16;
        const radii = eye ? [.27, .44, .72, .87, 1] : [.55, .82, 1];
        const palette = eye ? [dark, dark, iris, iris, rim, skin] : [dark, dark, rim, skin];
        const lift = (r: number) => hw * (.008 + (eye ? .022 : .012) * (1 - r * r));
        vertex(cx, cy, side, lift(0), palette[0]!);
        for (let ring = 0; ring < radii.length; ring++) {
          const r = radii[ring]!, start = positions.length / 3;
          for (let s = 0; s < segments; s++) {
            const angle = s / segments * Math.PI * 2;
            vertex(cx + rx * r * Math.cos(angle), cy + ry * r * Math.sin(angle), side, lift(r), palette[ring + 1]!);
          }
          for (let s = 0; s < segments; s++) {
            const n = (s + 1) % segments;
            if (ring === 0) tri(firstVertex, start + s, start + n, side);
            else {
              tri(start - segments + s, start + s, start + n, side);
              tri(start - segments + s, start + n, start - segments + n, side);
            }
          }
        }
        if (eye && sculpted) {
          // Small corneal sheen, on the same projected/weighted surface and
          // in the same draw. It makes the iris readable without white sclera.
          const first = positions.length / 3, sx = cx - hw * .028, sy = cy + hw * .019;
          vertex(sx, sy, side, lift(.25) + hw * .002, [.48, .50, .44]);
          for (let s = 0; s < 8; s++) {
            const a = s / 8 * Math.PI * 2;
            vertex(sx + hw * .012 * Math.cos(a), sy + hw * .008 * Math.sin(a), side, lift(.25) + hw * .002, iris);
          }
          for(let s = 0; s < 8; s++) tri(first, first + 1 + s, first + 1 + (s + 1) % 8, side);
        }
      }
      features.push({ kind, side, firstVertex, vertexCount: positions.length / 3 - firstVertex,
        firstTriangle, triangleCount: indices.length / 3 - firstTriangle });
      yield;
    }
  }
  return features;
}

function linearColor(hex: string): Vec3 {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [16, 8, 0].map(shift => {
    const v = ((value >> shift) & 255) / 255;
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  }) as Vec3;
}
