import {Box3, DirectionalLight, Matrix4, Vector3} from 'three';

// Desktop inspection preset, visually reviewed with neutral and grazing keys.
// Map storage is separate from the asset's shared coat-map memory budget.
export const FAUNA_REVIEW_SHADOWS = Object.freeze({mapSize: 2048, depthBiasM: .003, normalBiasM: .002});

export interface FaunaReviewShadowOptions {
  groundY?: number;
  paddingM?: number;
  depthBiasM?: number;
  normalBiasM?: number;
}

const finiteVector = (v: Vector3) => [v.x, v.y, v.z].every(Number.isFinite);
const corners = (box: Box3) => {
  const result: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
    for (const z of [box.min.z, box.max.z]) result.push(new Vector3(x, y, z));
  return result;
};

/** Fit full world-space caster bounds, independently of the viewing camera.
 * Call after layout/shape/light changes with a conservative animation envelope
 * or a cheaply updated box. Never pass a head crop or scan skin vertices here.
 * Ground-ray endpoints retain the complete cast shadow, including low light.
 * Light target, direction, map size/type, and cast/receive flags are preserved.
 */
export function fitFaunaReviewShadow(light: DirectionalLight, fullCasterBounds: Box3,
  {groundY = -.004, paddingM = .1, depthBiasM = .001, normalBiasM = .002}: FaunaReviewShadowOptions = {}) {
  if (!light.isDirectionalLight || !finiteVector(fullCasterBounds.min) || !finiteVector(fullCasterBounds.max)
    || fullCasterBounds.isEmpty()) throw new Error('Finite nonempty full caster bounds and a directional light are required');
  if (![groundY, paddingM, depthBiasM, normalBiasM].every(Number.isFinite)
    || paddingM <= 0 || paddingM > 100 || depthBiasM < 0 || depthBiasM > .005 || normalBiasM < 0 || normalBiasM > .01)
    throw new Error('Invalid review shadow ground, padding or bounded physical bias');
  const size = fullCasterBounds.getSize(new Vector3()), scale = Math.max(size.x, size.y, size.z);
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('Caster bounds must have finite positive extent');
  if (![light.shadow.mapSize.x, light.shadow.mapSize.y].every(n => Number.isFinite(n) && n >= 1))
    throw new Error('Positive finite shadow map dimensions are required');
  light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
  const lightPosition = light.getWorldPosition(new Vector3()), target = light.target.getWorldPosition(new Vector3());
  if (!finiteVector(lightPosition) || !finiteVector(target) || !finiteVector(light.shadow.camera.up)
    || !(light.shadow.camera.up.lengthSq() > 0))
    throw new Error('Finite light, target and shadow camera orientation are required');
  const direction = lightPosition.clone().sub(target);
  if (!(direction.length() > 1e-9)) throw new Error('Light and target must differ');
  direction.normalize();
  if (!(direction.y > 1e-4)) throw new Error('Review key must shine downward onto the ground');
  const casterCorners = corners(fullCasterBounds);
  const groundCorners = casterCorners.map(p => p.clone().addScaledVector(direction, -(p.y - groundY) / direction.y));
  const points = [...casterCorners, ...groundCorners];
  if (!points.every(finiteVector)) throw new Error('Nonfinite shadow ground projection');
  // A directional source may be translated along its ray without changing
  // illumination. Retreat only when necessary to put every point in front.
  const minimumDepth = Math.min(...points.map(p => lightPosition.clone().sub(p).dot(direction)));
  const lightRetreatM = Math.max(0, paddingM + .001 - minimumDepth);
  const fittedPosition = lightPosition.clone().addScaledVector(direction, lightRetreatM);
  const view = new Matrix4().lookAt(fittedPosition, target, light.shadow.camera.up).setPosition(fittedPosition).invert();
  const lightSpace = new Box3().setFromPoints(points.map(p => p.clone().applyMatrix4(view)));
  const frustum = {
    left: lightSpace.min.x - paddingM, right: lightSpace.max.x + paddingM,
    bottom: lightSpace.min.y - paddingM, top: lightSpace.max.y + paddingM,
    near: Math.max(.0001, -lightSpace.max.z - paddingM), far: -lightSpace.min.z + paddingM,
  };
  if (!Object.values(frustum).every(Number.isFinite) || frustum.far <= frustum.near
    || frustum.right <= frustum.left || frustum.top <= frustum.bottom)
    throw new Error('Invalid fitted directional shadow frustum');
  // Fixed millimetres for metre-scale specimens; avoid a detached shadow on
  // tiny specimens. Depth bias is normalized by the actual orthographic span.
  const appliedDepthBiasM = Math.min(depthBiasM, scale * .001);
  const appliedNormalBiasM = Math.min(normalBiasM, scale * .002);
  if (lightRetreatM > 0) {
    light.position.copy(light.parent ? light.parent.worldToLocal(fittedPosition.clone()) : fittedPosition);
    light.updateWorldMatrix(true, false);
  }
  Object.assign(light.shadow.camera, frustum);
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = -appliedDepthBiasM / (frustum.far - frustum.near);
  light.shadow.normalBias = appliedNormalBiasM;
  light.shadow.updateMatrices(light);
  light.shadow.needsUpdate = true;
  return {
    frustum, direction: direction.toArray(), groundY, paddingM, lightRetreatM,
    casterBounds: {min: fullCasterBounds.min.toArray(), max: fullCasterBounds.max.toArray()},
    groundBounds: {min: new Box3().setFromPoints(groundCorners).min.toArray(), max: new Box3().setFromPoints(groundCorners).max.toArray()},
    texelSizeM: [(frustum.right - frustum.left) / light.shadow.mapSize.x, (frustum.top - frustum.bottom) / light.shadow.mapSize.y],
    depthBiasM: appliedDepthBiasM, normalBiasM: appliedNormalBiasM, normalizedDepthBias: light.shadow.bias,
  };
}
