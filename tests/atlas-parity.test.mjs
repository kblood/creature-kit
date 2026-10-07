// Atlas parity (extraction plan phase 2): the kit and a universe-atlas checkout must hold the same composer sources and
// produce the same bytes. Runs only when ATLAS_DIR points at a universe-atlas tree; otherwise every test is skipped.
//   ATLAS_DIR=C:/LLM/IWSDK/universe-atlas npm run test:parity
// 1. Every file under src/ and scripts/export-creature.mjs is byte-identical to the Atlas file at the same path
//    (LF-normalised, so a CRLF checkout on either side compares equal; git stores both as LF).
// 2. scripts/composer-identity.mjs reports the same digests for both trees: generator source hashes, the V1_PINS
//    specimens, the composer-skin4-links and eye-catalogue skins, and every file the export CLI makes for
//    `--preset all --count 4 --seed-prefix ce1`, with no v2 flag and with `--target quest-3 --seamless` (LOD chain).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {composerIdentity} from '../scripts/composer-identity.mjs';

const KIT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ATLAS = process.env.ATLAS_DIR ? resolve(process.env.ATLAS_DIR) : null;
const skip = ATLAS ? false : 'ATLAS_DIR is not set';
const lfSha = path => createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const shared = () => [
  ...readdirSync(resolve(KIT, 'src'), {recursive: true}).map(String).map(f => `src/${f.replace(/\\/g, '/')}`).filter(f => /\.ts$/.test(f)),
  'scripts/export-creature.mjs',
].sort();

test('atlas parity: kit sources are byte-identical to ATLAS_DIR', {skip}, () => {
  const files = shared(), diff = [];
  assert.ok(files.length >= 15);
  for (const f of files) {
    const theirs = resolve(ATLAS, f);
    if (!existsSync(theirs)) diff.push(`${f}: missing in Atlas`);
    else if (lfSha(resolve(KIT, f)) !== lfSha(theirs)) diff.push(`${f}: bytes differ`);
  }
  assert.deepEqual(diff, [], `kit and Atlas sources differ:\n${diff.join('\n')}`);
});

test('atlas parity: the composer produces the same bytes from the kit and from ATLAS_DIR', {skip, timeout: 600000}, async () => {
  const kit = await composerIdentity(KIT), atlas = await composerIdentity(ATLAS);
  assert.deepEqual(kit, atlas);
  console.log(`composer identity digest ${kit.digest} (kit == Atlas); v1 source ${kit.sourceHash.v1.slice(0, 12)}, v2 source ${kit.sourceHash.v2.slice(0, 12)}`);
});
