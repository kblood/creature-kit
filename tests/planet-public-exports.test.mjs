import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as planet from '../src/planet-v1/index.ts';
test('planet runtime exports preserve existing inspection, pose workspaces and additive sculpted selection',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/planet-runtime-exports.json',import.meta.url),'utf8'));
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(fixture.schema,'planet-runtime-exports-1');assert.equal(fixture.packageVersion,pkg.version);
 assert.deepEqual(Object.keys(planet).sort(),fixture.values);
 for(const name of ['createQuadrupedPoseWorkspace','quadrupedPoseAtInto','quadrupedPoseAt','createQuadrupedBodyPatternSampler','createPlanetAnimalInspector'])assert.equal(typeof planet[name],'function',name);
 assert.equal(typeof planet.COAT_PATTERN_CRISP_GLSL,'string');
 assert.equal(planet.QUADRUPED_SCULPTED_BODY_VERSION,'quadruped-body-sculpted-1');
});
