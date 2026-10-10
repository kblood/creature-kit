import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {COAT_PATTERN_CRISP_GLSL,COAT_PATTERN_CRISP_GLSL_VERSION} from '../src/planet-v1/index.ts';
import {COMPOSER_COAT_CRISP_GLSL} from '../src/fauna-composer.ts';
test('planet and composer use one frozen shared shader without recipe imports',()=>{
 assert.equal(COAT_PATTERN_CRISP_GLSL_VERSION,'coat-pattern-crisp-glsl-1');
 assert.equal(COAT_PATTERN_CRISP_GLSL,COMPOSER_COAT_CRISP_GLSL);
 assert.equal(createHash('sha256').update(COAT_PATTERN_CRISP_GLSL).digest('hex'),'9c49a372ba3ad46e66496e5cd27d69bb93dee5287f0a62ba8c4d1b08ec060253');
});
