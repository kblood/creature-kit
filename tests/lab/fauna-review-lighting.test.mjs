import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3, DirectionalLight, Matrix4, Object3D, Vector3} from 'three';
import {fitFaunaReviewShadow} from '../../apps/creature-lab/src/fauna-review-lighting.ts';

const deer = new Box3(new Vector3(-.8485, .004, -.2352), new Vector3(1.179, 1.6643, .2352));
function key(position) {const light = new DirectionalLight(); light.position.set(...position); light.shadow.mapSize.set(1024, 1024); return light;}
function assertCovered(light, box, groundY = -.004) {
  light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
  const direction = light.getWorldPosition(new Vector3()).sub(light.target.getWorldPosition(new Vector3())).normalize();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new Vector3(x, y, z), ground = p.clone().addScaledVector(direction, -(p.y - groundY) / direction.y);
    for (const point of [p, ground]) {
      const clip = point.clone().project(light.shadow.camera);
      assert.ok([clip.x, clip.y, clip.z].every(n => Number.isFinite(n) && n >= -1 - 1e-8 && n <= 1 + 1e-8), JSON.stringify({point, clip}));
    }
  }
}

for (const position of [[4, 7, 5], [-2, 1.25, 5], [-20, 38, 26]]) test(`full caster and ground projection fit ${position}`, () => {
  const light = key(position), original = light.position.clone(), target = light.target.position.clone(), bounds = deer.clone();
  const result = fitFaunaReviewShadow(light, deer);
  assertCovered(light, deer); assert.ok(deer.equals(bounds));
  assert.ok(light.position.equals(original)); assert.ok(light.target.position.equals(target));
  assert.equal(result.depthBiasM, .001); assert.equal(result.normalBiasM, .002);
  assert.ok(Math.abs(light.shadow.bias * (result.frustum.far - result.frustum.near) + .001) < 1e-12);
  assert.ok(Math.max(...result.texelSizeM) < .0025, 'caster fit improves over 10-14 m fixed frustum');
  assert.deepEqual(fitFaunaReviewShadow(light, deer), result, 'repeat fit is deterministic');
  assert.equal(light.shadow.mapSize.x, 1024); assert.equal(light.shadow.mapSize.y, 1024);
});

test('tiny and huge bounds remain covered with bounded physical bias and stable light direction', () => {
  for (const factor of [1e-6, 1e-3, 100, 1e5]) {
    const box = deer.clone().applyMatrix4(new Matrix4().makeScale(factor, factor, factor));
    const light = key([-2, 1.25, 5]), direction = light.position.clone().normalize(), target = light.target.position.clone();
    const result = fitFaunaReviewShadow(light, box); assertCovered(light, box);
    assert.ok(light.position.clone().sub(target).normalize().distanceTo(direction) < 1e-12);
    assert.ok(light.target.position.equals(target));
    assert.ok(result.depthBiasM > 0 && result.depthBiasM <= .001 && result.normalBiasM <= .002);
    if (factor < 1e-3) assert.ok(result.normalBiasM < factor * .005);
    if (factor >= 100) assert.ok(result.lightRetreatM > 0);
  }
});

test('transformed world bounds and parented light retain ray direction', () => {
  const transform = new Matrix4().makeRotationY(.8); transform.setPosition(31, 5, -24);
  const box = deer.clone().applyMatrix4(transform), parent = new Object3D();
  parent.position.set(-10, 2, 7); parent.rotation.y = .3; parent.scale.set(2, 1.5, .7);
  const light = key([4, 7, 5]); parent.add(light); parent.updateMatrixWorld(true);
  light.target.position.set(31, 0, -24); light.target.updateMatrixWorld(true);
  const before = light.getWorldPosition(new Vector3()).sub(light.target.getWorldPosition(new Vector3())).normalize();
  fitFaunaReviewShadow(light, box, {groundY: 2}); assertCovered(light, box, 2);
  const after = light.getWorldPosition(new Vector3()).sub(light.target.getWorldPosition(new Vector3())).normalize();
  assert.ok(before.distanceTo(after) < 1e-12);
});

test('full-body shadow fit is independent of viewer head/body crop and includes multiple actors', () => {
  const box = deer.clone().union(deer.clone().translate(new Vector3(3, 0, 2)));
  const light = key([-2, 1.25, 5]); const body = fitFaunaReviewShadow(light, box);
  // No viewer camera or crop argument exists; switching a view must retain this full box.
  const head = fitFaunaReviewShadow(light, box); assert.deepEqual(head, body); assertCovered(light, box);
});

test('invalid bounds, light rays, map size and bias fail explicitly', () => {
  for (const box of [new Box3(), new Box3(new Vector3(NaN, 0, 0), new Vector3(1, 1, 1)), new Box3(new Vector3(), new Vector3())])
    assert.throws(() => fitFaunaReviewShadow(key([4, 7, 5]), box));
  for (const position of [[0, 0, 0], [4, 0, 5], [4, -1, 5], [NaN, 1, 0]])
    assert.throws(() => fitFaunaReviewShadow(key(position), deer));
  for (const options of [{groundY: NaN}, {paddingM: 0}, {paddingM: Infinity}, {depthBiasM: -.01}, {depthBiasM: .006}, {normalBiasM: .011}])
    assert.throws(() => fitFaunaReviewShadow(key([4, 7, 5]), deer, options));
  const light = key([4, 7, 5]); light.shadow.mapSize.x = 0; assert.throws(() => fitFaunaReviewShadow(light, deer));
});
