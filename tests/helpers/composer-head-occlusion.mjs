// Composer head occlusion (eye round EC4): how much of the head do the creature's own limbs and wings hide from the
// three review cameras of tests/fauna-face-closeups.html (front along the head axis, side from the left,
// three-quarter front-left; same directions, elevation included)? Pure CPU: the skin is posed by linear blend
// skinning exactly as the GPU does (bone matrix = pose x inverse bind), and every head-group vertex casts a ray toward
// each camera; a hit on a posed arm, hand, finger or wing triangle hides it. GPT Luna 6 on wild seed 40 (face round):
// "black shapes look like wings or limbs passing in front of and around the head".
import * as THREE from 'three';
import {buildComposerGraph, poseComposer} from '../../src/fauna-composer-rig.ts';
import {buildComposerSkin} from '../../src/fauna-composer-mesh.ts';

export const HEAD_GROUP = ['head', 'eyes', 'mouth', 'horn', 'trunk'];
export const OCCLUDERS = ['arm', 'hand', 'finger', 'wing'];
/** The face proper (what a viewer reads as the face): head, eyes and mouth parts, without trunk and horns. */
export const FACE = ['head', 'eyes', 'mouth'];

function boneMatrices(graph, pose) {
  return graph.bones.map((b, i) => {
    const rest = new THREE.Matrix4().compose(new THREE.Vector3(...b.restPosition), new THREE.Quaternion(...b.restQuaternion), new THREE.Vector3(1, 1, 1));
    const cur = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(pose.positions, i * 3), new THREE.Quaternion().fromArray(pose.quaternions, i * 4), new THREE.Vector3(1, 1, 1));
    return cur.multiply(rest.invert());
  });
}
function posedPositions(skin, M) {
  const out = new Float64Array(skin.vertexCount * 3), p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let v = 0; v < skin.vertexCount; v++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = skin.skinWeight[v * 4 + k];
      if (!w) continue;
      p.set(skin.positions[v * 3], skin.positions[v * 3 + 1], skin.positions[v * 3 + 2]);
      q.copy(p).applyMatrix4(M[skin.skinIndex[v * 4 + k]]);
      x += w * q.x; y += w * q.y; z += w * q.z;
    }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
  }
  return out;
}
const partSet = (skin, names) => skin.parts.filter(p => p.triangles && names.includes(p.part));

/** Fraction of the face's vertices hidden by limbs or wings, per review camera, for one built creature and pose. */
export function composerHeadOcclusion(graph, skin, motion = 'neutral', t = 0, {stride = 3} = {}) {
  const pose = poseComposer(graph, motion, t), P = posedPositions(skin, boneMatrices(graph, pose));
  const hi = graph.chains.head, hq = new THREE.Quaternion().fromArray(pose.quaternions, hi * 4);
  const up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(hq);
  fwd.y = 0; if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0); fwd.normalize();
  const left = new THREE.Vector3().crossVectors(fwd, up).normalize().negate();
  const views = {
    front: fwd.clone().addScaledVector(up, 0.12).normalize(),
    side: left.clone().addScaledVector(up, 0.08).normalize(),
    threeQuarter: fwd.clone().multiplyScalar(0.75).add(left).addScaledVector(up, 0.35).normalize(),
  };
  // occluder triangles, flattened (a, edge1, edge2), with a bounding box for a cheap reject
  const tris = [];
  for (const part of partSet(skin, OCCLUDERS)) for (let i = part.firstTriangle * 3; i < (part.firstTriangle + part.triangles) * 3; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => skin.index[i + k] * 3);
    tris.push([P[a], P[a + 1], P[a + 2], P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2], P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
  }
  const face = new Set();
  for (const part of partSet(skin, FACE)) for (let i = part.firstTriangle * 3; i < (part.firstTriangle + part.triangles) * 3; i++) face.add(skin.index[i]);
  const samples = [...face].sort((x, y) => x - y).filter((_, k) => k % stride === 0);
  const out = {};
  for (const [name, d] of Object.entries(views)) {
    let hidden = 0;
    for (const v of samples) {
      const ox = P[v * 3], oy = P[v * 3 + 1], oz = P[v * 3 + 2];
      for (const T of tris) {
        // Moller-Trumbore, ray o + s d (s > 0)
        const px = d.y * T[8] - d.z * T[7], py = d.z * T[6] - d.x * T[8], pz = d.x * T[7] - d.y * T[6];
        const det = T[3] * px + T[4] * py + T[5] * pz;
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det, tx = ox - T[0], ty = oy - T[1], tz = oz - T[2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * T[5] - tz * T[4], qy = tz * T[3] - tx * T[5], qz = tx * T[4] - ty * T[3];
        const w = (d.x * qx + d.y * qy + d.z * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        if ((T[6] * qx + T[7] * qy + T[8] * qz) * inv > 1e-6) { hidden++; break; }
      }
    }
    out[name] = samples.length ? hidden / samples.length : 0;
  }
  return {...out, worst: Math.max(...Object.values(out)), samples: samples.length};
}

export function composerHeadOcclusionOf(recipe, motion = 'neutral', t = 0, options) {
  const graph = buildComposerGraph(recipe), skin = buildComposerSkin(graph);
  return composerHeadOcclusion(graph, skin, motion, t, options);
}
