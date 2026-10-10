import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as planet from '../src/planet-v1/index.ts';
import {planetCoreCorpus} from './helpers/planet-core-corpus.mjs';
test('planet core extraction preserves f96a8c1 genomes, ancestry, 12 body bytes, coat and terrain-aware poses',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/planet-core-f96a8c1.json',import.meta.url),'utf8'));
  assert.equal(fixture.sourceAtlasCommit,'f96a8c1');assert.equal(fixture.capturedBeforeExtraction,true);
  assert.deepEqual(planetCoreCorpus(planet),fixture.outputs);
});
test('planet body does not substitute composer presets or change data versions',()=>{
  assert.equal(planet.PLANET_ANIMAL_CORE_VERSION,'planet-animal-core-1');
  assert.equal(planet.CREATURE_GENOME_VERSION,'creature-genome-1');
  assert.equal(planet.QUADRUPED_BODY_VERSION,'quadruped-body-4');
  assert.equal(planet.QUADRUPED_BONE_NAMES.length,22);
});
