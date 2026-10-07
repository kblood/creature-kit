// Composer head geometry (fauna-composer-face-geometry-1, face round WP5): the proboscis face whose muzzle hands over
// into the trunk, headgear only where real animals carry it (casque on a beak, a seated jaws crest, paired horns on the
// brow), ears kept beside horns, the flat face's brow above the eyes, nostrils and the worm's mouth disc seated on
// their caps, and the budgets. Measured on the actual skin buffers, the debug rings and the graph's bones.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {COMPOSER_PRESET_IDS, composerPreset, decodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {COMPOSER_BUDGET, COMPOSER_GRAPH_VERSION, COMPOSER_TRUNK_TIP_CLEARANCE, buildComposerGraph, poseComposer} from '../src/fauna-composer-rig.ts';
import {CREST_HALF_THICKNESS, HIDDEN_DISC_INSET, TRUNK_TIP, buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {composerIndividualTraits, deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {coherentComposerSpecies, randomCoherentComposerRecipe} from '../src/fauna-composer-species.ts';
import {COMPOSER_FACES, COMPOSER_HORNS, composerHeadgearBuild} from '../src/fauna-composer-face.ts';
import {COMPOSER_FACE_GEOMETRY, COMPOSER_FACE_GEOMETRY_VERSION, PROBOSCIS_FACE, PROBOSCIS_TRUNK_LENGTH, composerFaceTip, composerHeadPitch} from '../src/fauna-composer-face-geometry.ts';
import {outermostExit, raycastFirstHit, raycastLine} from '../src/fauna-composer-eye.ts';

const effective = input => deriveComposerIndividual(normalizeComposerRecipe(input).recipe).recipe;
const build = input => { const graph = buildComposerGraph(effective(input)); return {graph, skin: buildComposerSkin(graph, {debug: true})}; };
const specimens = JSON.parse(readFileSync(new URL('./fauna-face-specimens.json', import.meta.url), 'utf8')).specimens;
const specimen = name => decodeComposerRecipe(specimens.find(s => s.name === name).text).recipe;
const HEAD_GROUP = new Set(['head', 'eyes', 'mouth', 'horn', 'trunk']);
const headGroup = skin => skin.parts.filter(p => HEAD_GROUP.has(p.part)).reduce((a, p) => a + p.triangles, 0);
const vertex = (skin, v) => [skin.positions[v * 3], skin.positions[v * 3 + 1], skin.positions[v * 3 + 2]];
const partsOf = (skin, part, label) => skin.parts.filter(p => p.part === part && (label === undefined || p.label === label));
function verticesOf(skin, parts) { const set = new Set(); for (const p of parts) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) set.add(skin.index[i]); return [...set]; }
/** Head-local frame of a bone (x along it, y dorsal, z lateral). */
function frame(bone) {
  const q = new THREE.Quaternion(...bone.restQuaternion), qi = q.clone().invert(), p0 = new THREE.Vector3(...bone.restPosition);
  return {toLocal: p => { const v = new THREE.Vector3(...p).sub(p0).applyQuaternion(qi); return [v.x, v.y, v.z]; }, toModel: p => { const v = new THREE.Vector3(...p).applyQuaternion(q).add(p0); return [v.x, v.y, v.z]; }};
}
function localTris(skin, parts, toLocal) { const out = []; for (const p of parts) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) out.push(...toLocal(vertex(skin, skin.index[i]))); return out; }
const dims = graph => { const d = graph.dims; return {H: d.headLength, cW: d.craniumWidth, cH: d.craniumHeight, sn: d.snoutLength}; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / len(a) / len(b)))) * 180 / Math.PI;
const key = p => p.map(x => Math.round(x * 1e6)).join(',');
const meanR = r => (r.rx + 0.5 * (r.ry + r.ryBelow)) / 2;

// The proboscis specimens of the round: the redesigned preset (live) and the frozen custom/plausible trunk animals.
const PROBOSCIS = {
  'trunked-centipede': composerPreset('trunked-centipede'),
  'custom-giraffe-trunk': specimen('custom-giraffe-trunk'),
  'custom-rhinoceros-trunk': specimen('custom-rhinoceros-trunk'),
  'plausible-pachyderm-1': specimen('plausible-pachyderm-1'),
};
/** Head-group triangles of the same specimens at the WP4 merge (179485c), where proboscis built muzzle + a 12-sided trunk. */
const LEGACY_HEAD_GROUP = {'trunked-centipede': 3072, 'custom-giraffe-trunk': 3120, 'custom-rhinoceros-trunk': 3120, 'plausible-pachyderm-1': 3120};
const proboscisCases = [];
for (const [id, recipe] of Object.entries(PROBOSCIS)) {
  proboscisCases.push([id, recipe]);
  for (const trunkLength of [0.2, 1.4]) proboscisCases.push([`${id}@trunk${trunkLength}`, {...recipe, trunkLength}]);
  for (const snoutLength of [0, 1.5]) proboscisCases.push([`${id}@snout${snoutLength}`, {...recipe, snoutLength}]);
}

test('face geometry module: versions, legacy numbers unchanged, proboscis its own face', () => {
  assert.equal(COMPOSER_FACE_GEOMETRY_VERSION, 'fauna-composer-face-geometry-2');
  assert.equal(COMPOSER_GRAPH_VERSION, 'fauna-composer-graph-4');
  assert.deepEqual(Object.keys(COMPOSER_FACE_GEOMETRY).sort(), [...COMPOSER_FACES].sort());
  // the graph-2 numbers of the six legacy faces
  const legacy = {muzzle: [1, 0.34, 0.9], jaws: [1.15, 0.34, 0.95], beak: [0.9, 0.34, 0.9], 'flat-face': [0.9, 0.42, 0.9], blunt: [0.6, 0.5, 0.9], mandibles: [0.7, 0.3, 1.4]};
  for (const [face, [s, h, w]] of Object.entries(legacy)) assert.deepEqual(COMPOSER_FACE_GEOMETRY[face], {headScale: s, craniumHeight: h, craniumWidth: w, snout: 0.62}, face);
  assert.deepEqual(COMPOSER_FACE_GEOMETRY.proboscis, {headScale: 1.05, craniumHeight: 0.4, craniumWidth: 0.9, snout: 0.62 * 0.4});
  assert.equal(composerHeadPitch('beak', 'quadruped', 0.2), -0.12);
  assert.equal(composerHeadPitch('proboscis', 'quadruped', 0.2), -0.3);
  assert.equal(composerHeadPitch('muzzle', 'biped', 0.8), -0.08);
  // pure: same input, same tip; a round tip section for the trunk to continue
  const d = {headLength: 1, craniumWidth: 0.36, craniumHeight: 0.4, snoutLength: 0.1};
  assert.deepEqual(composerFaceTip('proboscis', d), composerFaceTip('proboscis', d));
  const tip = composerFaceTip('proboscis', d);
  assert.ok(Math.abs(tip.w / tip.h - 1) < 0.02, `round tip ${tip.w} x ${tip.h}`);
});

test('proboscis: trunk grows from the muzzle tip station, round and smooth, with a mouth, at every trunk and snout length', () => {
  for (const [id, recipe] of proboscisCases) {
    const {graph, skin} = build(recipe), r = graph.recipe, {H} = dims(graph);
    assert.equal(r.head, 'proboscis', id);
    // bone count = legacy muzzle + 6 trunk bones
    const muzzle = buildComposerGraph(effective({...recipe, head: 'muzzle', trunk: 'none'}));
    assert.equal(graph.bones.length, muzzle.bones.length + 6, `${id} bones`);
    assert.equal(graph.chains.trunk.length, 6, id);
    // the trunk root is the face tip station (composerFaceTip in the head frame)
    const hb = graph.bones[graph.chains.head], hf = frame(hb), t0 = graph.bones[graph.chains.trunk[0]];
    const tip = composerFaceTip('proboscis', {headLength: H, craniumWidth: graph.dims.craniumWidth, craniumHeight: graph.dims.craniumHeight, snoutLength: graph.dims.snoutLength});
    const tipModel = hf.toModel([tip.x, tip.y, 0]);
    assert.ok(len(sub(t0.restPosition, tipModel)) <= 0.02 * H, `${id}: trunk root ${len(sub(t0.restPosition, tipModel)) / H} H from the tip station`);
    // the skin seam: trunk vertices that coincide with the muzzle's last station, centred on the root
    const headVerts = verticesOf(skin, partsOf(skin, 'head', 'proboscis')), trunkVerts = verticesOf(skin, partsOf(skin, 'trunk'));
    const headKeys = new Map(headVerts.map(v => [key(vertex(skin, v)), v]));
    // shared vertices: the junction ring plus the two hidden closing discs (their centre, and since skin EC4 their rims,
    // inset by HIDDEN_DISC_INSET so they no longer depth-fight the surface along the seam); the discs are dropped: they are
    // not surface. A disc vertex is one on a triangle that touches the disc centre (the shared vertex nearest the mean).
    const shared = trunkVerts.filter(v => headKeys.has(key(vertex(skin, v))));
    const mean = shared.reduce((a, v) => a.map((x, k) => x + vertex(skin, v)[k] / shared.length), [0, 0, 0]);
    const centreKey = key(vertex(skin, shared.reduce((a, v) => len(sub(vertex(skin, v), mean)) < len(sub(vertex(skin, a), mean)) ? v : a)));
    const discKeys = new Set([centreKey]);
    for (const p of [...partsOf(skin, 'head', 'proboscis'), ...partsOf(skin, 'trunk')]) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i += 3) {
      const ks = [0, 1, 2].map(k => key(vertex(skin, skin.index[i + k])));
      if (ks.includes(centreKey)) for (const k of ks) discKeys.add(k);
    }
    const seam = shared.filter(v => !discKeys.has(key(vertex(skin, v))));
    const typical = [...seam.map(v => len(sub(vertex(skin, v), mean)))].sort((x, y) => x - y)[seam.length >> 1];
    assert.ok(seam.length >= 12 && shared.length - seam.length <= 1 + 2 * seam.length, `${id}: ${seam.length} seam vertices`);
    for (const v of shared) if (discKeys.has(key(vertex(skin, v))) && key(vertex(skin, v)) !== centreKey) assert.ok(len(sub(vertex(skin, v), mean)) <= HIDDEN_DISC_INSET * typical * 1.02, `${id}: hidden disc rim inset`);
    const seamKeys = new Set(seam.map(v => key(vertex(skin, v))));
    const centre = seam.reduce((a, v) => a.map((x, k) => x + vertex(skin, v)[k] / seam.length), [0, 0, 0]);
    assert.ok(len(sub(centre, t0.restPosition)) <= 0.02 * H, `${id}: seam centre ${len(sub(centre, t0.restPosition)) / H} H from the root`);
    const rings = skin.debug.rings.filter(x => x.chain === 'trunk');
    assert.ok(len(sub(rings[0].centre, tipModel)) <= 0.02 * H, `${id}: first trunk ring at the tip station`);
    // radius: no step above 10% between consecutive trunk rings
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = meanR(rings[i]), b = meanR(rings[i + 1]);
      assert.ok(Math.max(a, b) / Math.min(a, b) <= 1.1, `${id}: radius step ${(Math.max(a, b) / Math.min(a, b)).toFixed(3)} at ring ${i}`);
    }
    // surface normals across the seam: muzzle side vs trunk side, per seam vertex, at most 15 degrees apart
    const onDisc = ps => ps.some(q => discKeys.has(key(q)) && !seamKeys.has(key(q)));
    const normalsAt = parts => {
      const acc = new Map();
      for (const p of parts) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i += 3) {
        const ps = [0, 1, 2].map(k => vertex(skin, skin.index[i + k]));
        if (onDisc(ps)) continue; // the hidden flat closing disc
        const n = cross(sub(ps[1], ps[0]), sub(ps[2], ps[0]));
        for (const q of ps) { const k = key(q); if (!seamKeys.has(k)) continue; const a = acc.get(k) ?? [0, 0, 0]; acc.set(k, [a[0] + n[0], a[1] + n[1], a[2] + n[2]]); }
      }
      return acc;
    };
    const before = normalsAt(partsOf(skin, 'head', 'proboscis')), after = normalsAt(partsOf(skin, 'trunk'));
    let worst = 0;
    for (const [k, n] of before) if (after.has(k)) worst = Math.max(worst, angleDeg(n, after.get(k)));
    assert.ok(before.size >= 12 && before.size === seamKeys.size && worst <= 15, `${id}: seam normal angle ${worst.toFixed(1)} degrees over ${before.size} vertices`);
    // the tip is no wider than its lip flare (TRUNK_TIP.flare, skin EC4) x the last trunk ring
    const tb = graph.bones[graph.chains.trunk[5]], tf = frame(tb), r0 = tb.end.h, from = tb.length - 0.15 * r0;
    const lastRings = rings.filter(x => x.bone === tb.index && tf.toLocal(x.centre)[0] >= from - 1e-9);
    const bound = Math.max(meanR(rings[rings.length - 1]), ...lastRings.map(x => Math.max(x.rx, x.ry, x.ryBelow)));
    let widest = 0;
    for (const v of trunkVerts) { const l = tf.toLocal(vertex(skin, v)), own = skin.skinIndex[v * 4] === tb.index && skin.skinWeight[v * 4] === 1; if (l[0] >= from && own && Math.hypot(l[0] - tb.length, l[1], l[2]) <= 4 * r0) widest = Math.max(widest, Math.hypot(l[1], l[2])); } // near the tip, on the last bone alone (a curled trunk passes the cut plane elsewhere, and a short trunk's broad base rings lie within 4 end radii)
    assert.ok(widest <= TRUNK_TIP.flare * bound * (1 + 1e-4), `${id}: tip ${widest} vs last ring ${bound}`);
    // no twisted band along the trunk: every trunk bone keeps the head's lateral axis (the trunk curls in the head's
    // sagittal plane), also past vertical, where an UP-referenced frame flipped half a turn and folded the skin band
    // between the two joints into an annulus facing the axis (graph-2's 'plug' near the tip)
    const lateral = b => new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...b.restQuaternion));
    const headZ = lateral(graph.bones[graph.chains.head]);
    for (const i of graph.chains.trunk) assert.ok(lateral(graph.bones[i]).dot(headZ) > 0.99, `${id}: ${graph.bones[i].name} lateral axis flipped`);
    // a mouth part
    assert.ok(partsOf(skin, 'mouth').some(p => p.triangles > 0), `${id}: lower lip`);
    // the hidden discs keep each part closed: the head's proboscis part and the trunk both enclose positive volume
  }
});

test('proboscis EC4: a shorter trunk that hangs clear of the ground (J curl, no clearance lift), thick base, nostril tip', () => {
  // GPT Luna 6 on the face-round trunks: "Roughly 1.5-2 head lengths ... the face is small relative to the trunk", "its
  // base looks pinched and narrower than the face", "The tip looks blunt and capped", rhinoceros "especially thin and
  // droops far forward"
  assert.equal(PROBOSCIS_TRUNK_LENGTH, 1.45);
  assert.deepEqual([PROBOSCIS_FACE.tipH, PROBOSCIS_FACE.tipW], [0.92, 1.02]);
  for (const [id, recipe] of proboscisCases.filter(([id]) => !id.includes('@snout'))) {
    const {graph, skin} = build(recipe), {H, cW} = dims(graph), trunk = graph.chains.trunk.map(i => graph.bones[i]);
    const length = trunk.reduce((a, b) => a + b.length, 0);
    assert.ok(Math.abs(length / H - PROBOSCIS_TRUNK_LENGTH * graph.recipe.trunkLength) < 1e-9, `${id}: ${length / H} head lengths`);
    if (!id.includes('@')) assert.ok(length / H >= 1.1 && length / H <= 1.65, `${id}: ${(length / H).toFixed(2)} head lengths`);
    // the trunk base is the round muzzle tip: at least 0.7 of the cranium half-width (face round: 0.55 x 0.9 = 0.5)
    assert.ok(trunk[0].start.h >= 0.7 * cW, `${id}: base ${trunk[0].start.h / cW} cW`);
    // the rest shape is composerTrunkRestShape's chain, untouched by the clearance fallback: bone i + 1 starts where bone
    // i ends, along bone i's own +X, and every bone end stands above its section
    for (let i = 0; i < trunk.length; i++) {
      const b = trunk[i], dir = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...b.restQuaternion));
      const end = new THREE.Vector3(...b.restPosition).addScaledVector(dir, b.length);
      if (i + 1 < trunk.length) assert.ok(end.distanceTo(new THREE.Vector3(...trunk[i + 1].restPosition)) < 1e-9 * H + 1e-12, `${id}: ${b.name} chain`);
      assert.ok(end.y >= b.end.h * (i + 1 < trunk.length ? 1 : COMPOSER_TRUNK_TIP_CLEARANCE), `${id}: ${b.name} end ${end.y} vs section ${b.end.h}`);
    }
    // the tip turns forward (the flick, and the J of a trunk too long for the face height)
    const tipDir = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...trunk[trunk.length - 1].restQuaternion));
    const headDir = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...graph.bones[graph.chains.head].restQuaternion));
    assert.ok(tipDir.x * Math.sign(headDir.x || 1) > 0, `${id}: tip points back`);
    // a nostril end: dark nostril vertices on the end face, within 1.6 end radii of the bone end; no pale lip ring (Luna
    // read one as "a small, plain-looking cap"): the swelling end keeps the trunk's own coat (lipMix 0)
    const tb = trunk[trunk.length - 1], tf = frame(tb), r0 = tb.end.h;
    assert.equal(TRUNK_TIP.lipMix, 0);
    let dark = 0;
    const lum = v => 0.3 * skin.colors[v * 3] + 0.59 * skin.colors[v * 3 + 1] + 0.11 * skin.colors[v * 3 + 2];
    const ringLums = verticesOf(skin, partsOf(skin, 'trunk')).filter(v => Math.abs(tf.toLocal(vertex(skin, v))[0] - tb.length) < 1e-6 * H + 1e-9).map(lum);
    const ringLum = Math.min(...ringLums);
    for (const v of verticesOf(skin, partsOf(skin, 'trunk'))) {
      const l = tf.toLocal(vertex(skin, v));
      if (l[0] <= tb.length + 1e-9 || Math.hypot(l[0] - tb.length, l[1], l[2]) > 1.6 * r0) continue;
      if (lum(v) < 0.5 * ringLum) dark++;
    }
    assert.ok(dark >= 2 * 10, `${id}: ${dark} nostril vertices`);
  }
});

test('proboscis: trunk clearance and gait at trunkLength 0.2 and 1.4 (rest and every motion)', () => {
  const under = s => s.h - s.yc;
  for (const [id, recipe] of Object.entries(PROBOSCIS)) for (const trunkLength of [0.2, 1.4]) {
    const graph = buildComposerGraph(effective({...recipe, trunkLength})), trunk = graph.chains.trunk;
    for (const motion of ['idle', 'walk', 'display']) for (let k = 0; k < 8; k++) {
      const pose = poseComposer(graph, motion, k * 0.37);
      assert.ok(pose.diagnostics.maxBoneLengthError < 1e-6, `${id}@${trunkLength} ${motion}: bone length`);
      for (const i of trunk) {
        const b = graph.bones[i], p = new THREE.Vector3().fromArray(pose.positions, i * 3), q = new THREE.Quaternion().fromArray(pose.quaternions, i * 4);
        const end = p.clone().add(new THREE.Vector3(b.length, 0, 0).applyQuaternion(q));
        const cap = i === trunk[trunk.length - 1] ? COMPOSER_TRUNK_TIP_CLEARANCE * b.end.h : 0;
        const floor = Math.max(under(b.start), under(b.end), cap);
        assert.ok(end.y >= floor - 1e-6, `${id}@${trunkLength} ${motion} t${k}: ${b.name} end ${end.y} below ${floor}`);
      }
    }
    // a muzzle-faced twin walks the same legs: the trunk face does not change the gait
    const twin = buildComposerGraph(effective({...recipe, trunkLength, head: 'muzzle', trunk: 'none'}));
    assert.deepEqual(graph.locomotion, twin.locomotion, `${id}@${trunkLength} locomotion`);
  }
});

test('headgear: an omitted kind is bit-identical to none and a built kind differs, for 7 faces x 5 horns', () => {
  const faceSpecimen = {muzzle: 'giraffe', proboscis: 'trunked-centipede', jaws: 'dinosaur', beak: 'bird', 'flat-face': 'ape', blunt: 'worm', mandibles: 'centipede'};
  const arrays = s => [s.positions, s.index, s.colors, s.skinIndex, s.skinWeight, s.gloss, s.regions];
  const same = (a, b) => arrays(a).every((x, i) => Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(arrays(b)[i].buffer, arrays(b)[i].byteOffset, arrays(b)[i].byteLength)));
  let built = 0, omitted = 0;
  for (const [face, id] of Object.entries(faceSpecimen)) {
    // the individual stream is keyed on the whole species recipe (horns included), so coat jitter is held at the
    // 'none' twin's traits: the comparison isolates what the headgear choice builds
    const base = {...composerPreset(id), head: face}, noneRecipe = effective({...base, horns: 'none'}), traits = composerIndividualTraits(noneRecipe);
    const none = buildComposerSkin(buildComposerGraph(noneRecipe), {traits});
    for (const horns of COMPOSER_HORNS) {
      if (horns === 'none') continue;
      const kind = composerHeadgearBuild({head: face, horns}).built, skin = buildComposerSkin(buildComposerGraph(effective({...base, horns})), {traits});
      if (kind === 'none') { omitted++; assert.ok(same(skin, none), `${face}+${horns} omitted but differs`); assert.equal(partsOf(skin, 'horn').length, 0); }
      else { built++; assert.ok(!same(skin, none), `${face}+${horns} built ${kind} but identical`); assert.ok(partsOf(skin, 'horn').some(p => p.triangles > 0), `${face}+${horns} horn part`); }
    }
  }
  assert.equal(built + omitted, 7 * 4);
  assert.equal(omitted, 1 + 3 + 2 + 4 + 4 + 4, 'muzzle 1, proboscis 3, beak 2, flat-face/blunt/mandibles 4 each');
});

test('beak: the casque rides the culmen above the upper mandible centre line, within 160 triangles', () => {
  const cases = [['shelled-giraffe-bird', composerPreset('shelled-giraffe-bird')], ['custom-bird-nasal-horns', specimen('custom-bird-nasal-horns')]];
  for (const seed of [0, 1, 7, 42]) cases.push([`bird-crest-${seed}`, {...composerPreset('bird'), horns: 'crest', individualSeed: seed, variability: 1}]);
  for (const snoutLength of [0, 1.5]) cases.push([`bird-crest-snout${snoutLength}`, {...composerPreset('bird'), horns: 'crest', snoutLength}]);
  for (const [id, recipe] of cases) {
    const {graph, skin} = build(recipe), {H, cH, sn} = dims(graph), hf = frame(graph.bones[graph.chains.head]);
    const casque = partsOf(skin, 'horn', 'casque');
    assert.equal(casque.length, 1, `${id}: one casque`);
    assert.ok(casque[0].triangles <= 160, `${id}: ${casque[0].triangles} casque triangles`);
    const L = Math.max(sn, 0.15 * H);
    const centreLine = x => { const f = Math.max(0, Math.min(1, (x - 0.36 * H) / L)), hook = L < 0.35 * H ? (t => t * t * (3 - 2 * t))(Math.max(0, Math.min(1, (f - 0.6) / 0.4))) * 0.18 : 0; return (0.08 - 0.12 * f - hook) * cH; };
    let low = Infinity;
    for (const v of verticesOf(skin, casque)) { const [x, y] = hf.toLocal(vertex(skin, v)); low = Math.min(low, y - centreLine(x)); }
    assert.ok(low >= 0, `${id}: casque ${low / cH} cH below the culmen centre line`);
  }
});

test('jaws: the crest is a seated fin at least 0.18 cW thick, its base within 0.02 H of the skull, within 200 triangles', () => {
  const cases = [['dinosaur', composerPreset('dinosaur')], ['eye-crocodile+crest', {...specimen('eye-crocodile'), horns: 'crest'}], ['plausible-theropod-3+crest', {...specimen('plausible-theropod-3'), horns: 'crest'}]];
  for (const seed of [1, 7]) cases.push([`dinosaur-${seed}`, {...composerPreset('dinosaur'), individualSeed: seed, variability: 1}]);
  for (const [id, recipe] of cases) {
    const {graph, skin} = build(recipe), {H, cW} = dims(graph), hb = graph.bones[graph.chains.head], hf = frame(hb);
    const crest = partsOf(skin, 'horn', 'crest');
    assert.equal(crest.length, 1, id);
    assert.ok(crest[0].triangles <= 200, `${id}: ${crest[0].triangles} crest triangles`);
    const verts = verticesOf(skin, crest).map(v => hf.toLocal(vertex(skin, v)));
    const skull = localTris(skin, skin.parts.filter(p => (p.part === 'head' && !p.label.endsWith('ears')) || p.part === 'torso'), hf.toLocal);
    let seated = 0;
    for (const fx of [-0.12, 0.05, 0.22, 0.42, 0.5]) {
      const ring = verts.filter(p => Math.abs(p[0] - fx * H) < 1e-6 * H);
      assert.ok(ring.length >= 8, `${id}: station ${fx}`);
      const half = Math.max(...ring.map(p => Math.abs(p[2])));
      assert.ok(2 * half >= 2 * CREST_HALF_THICKNESS * cW * (1 - 1e-6) && CREST_HALF_THICKNESS >= 0.09, `${id}: thickness ${2 * half / cW} cW at ${fx}`);
      const bottom = Math.min(...ring.map(p => p[1])), cH = graph.dims.craniumHeight;
      const hit = raycastFirstHit(skull, [fx * H, 2 * cH, 0], [0, -1, 0]);
      if (hit && hit.point[1] >= 0.3 * cH && hit.point[1] <= 1.2 * cH) { seated++; assert.ok(Math.abs(bottom - hit.point[1]) <= 0.02 * H, `${id}: base ${(bottom - hit.point[1]) / H} H off the skull at ${fx}`); }
    }
    assert.ok(seated >= 4, `${id}: ${seated} stations over the skull`);
  }
});

test('paired horns root on the brow (x >= 0.12 H) and muzzle ears stay beside horns and ossicones', () => {
  const cases = [['muzzle+paired', {...composerPreset('giraffe'), horns: 'paired'}], ['jaws+paired', {...composerPreset('dinosaur'), horns: 'paired'}],
    ['jaws+ossicones', {...composerPreset('dinosaur'), horns: 'ossicones'}], ['proboscis+paired', {...composerPreset('trunked-centipede'), horns: 'paired'}],
    ['custom-ape-paired-horns', specimen('custom-ape-paired-horns')]];
  for (const [id, recipe] of cases) {
    const {graph, skin} = build(recipe), {H} = dims(graph), hf = frame(graph.bones[graph.chains.head]);
    const horns = partsOf(skin, 'horn', 'paired');
    if (composerHeadgearBuild(graph.recipe).built !== 'paired') { assert.equal(horns.length, 0, id); continue; }
    assert.equal(horns.length, 1, id);
    // the two tubes: the first 9 vertices of each are its root ring (9 segments); the second tube follows the first
    const verts = verticesOf(skin, horns).sort((a, b) => a - b), perTube = verts.length / 2;
    for (const first of [verts[0], verts[perTube]]) {
      const ring = Array.from({length: 9}, (_, k) => hf.toLocal(vertex(skin, first + k))), x = ring.reduce((a, p) => a + p[0] / 9, 0);
      assert.ok(x >= 0.12 * H, `${id}: horn root at ${(x / H).toFixed(3)} H`);
    }
  }
  for (const [id, recipe] of [['giraffe', composerPreset('giraffe')], ['muzzle+paired', {...composerPreset('giraffe'), horns: 'paired'}], ['muzzle+ossicones', {...composerPreset('rhinoceros'), horns: 'ossicones'}], ['eye-giraffe-juvenile', specimen('eye-giraffe-juvenile')]]) {
    const {skin} = build(recipe), ears = partsOf(skin, 'head', 'muzzle ears');
    assert.equal(ears.length, 1, `${id}: ears part`);
    assert.equal(ears[0].triangles, 2 * 176, `${id}: two ears`);
  }
});

test('flat face: no brow triangle lies along any eye\'s gaze; nose and mouth line are built', () => {
  const cases = [['ape', composerPreset('ape')], ['winged-ape-rhino', composerPreset('winged-ape-rhino')], ['eye-ape', specimen('eye-ape')], ['eye-ape-juvenile', specimen('eye-ape-juvenile')], ['plausible-primate-1', specimen('plausible-primate-1')],
    ['wild-composer-31-flat-face-ossicones', specimen('wild-composer-31-flat-face-ossicones')]];
  for (const seed of [1, 7, 42]) cases.push([`ape-${seed}`, {...composerPreset('ape'), individualSeed: seed, variability: 1}]);
  for (const [id, recipe] of cases) {
    const {graph, skin} = build(recipe), hf = frame(graph.bones[graph.chains.head]);
    const brow = localTris(skin, partsOf(skin, 'head', 'flat-face brow'), hf.toLocal);
    assert.ok(brow.length > 0, `${id}: brow part`);
    assert.equal(skin.eyeFallbacks, 0, id);
    for (const eye of skin.debug.eyes) {
      const g = eye.gaze, side = cross([0, 1, 0], g), up = cross(g, side), nu = len(up), ns = len(side);
      for (const [ku, ks] of [[0, 0], [0.5, 0], [0.9, 0], [0.7, 0.6], [0.7, -0.6]]) {
        const o = eye.centre.map((c, k) => c + up[k] / nu * eye.er * ku + side[k] / ns * eye.er * ks);
        const hits = raycastLine(brow, o, g).filter(h => h.t > 0);
        assert.equal(hits.length, 0, `${id}: brow crosses the gaze of the ${eye.side < 0 ? 'right' : 'left'} eye at (${ku}, ${ks}) er`);
      }
    }
  }
});

test('nostrils stand >= 0.005 H proud of the muzzle cap; the worm mouth disc lies within 0.005 H of its cap', () => {
  for (const [id, recipe] of [['giraffe', composerPreset('giraffe')], ['rhinoceros', composerPreset('rhinoceros')], ['plausible-ungulate-grazer-2', specimen('plausible-ungulate-grazer-2')], ['eye-cat', specimen('eye-cat')],
    ['giraffe-snout0', {...composerPreset('giraffe'), snoutLength: 0}], ['giraffe-snout1.5', {...composerPreset('giraffe'), snoutLength: 1.5}]]) {
    const {graph, skin} = build(recipe), {H} = dims(graph), hf = frame(graph.bones[graph.chains.head]);
    const cap = localTris(skin, partsOf(skin, 'head', 'muzzle'), hf.toLocal), nostrils = verticesOf(skin, partsOf(skin, 'head', 'muzzle nostrils')).map(v => hf.toLocal(vertex(skin, v)));
    for (const side of [-1, 1]) {
      let proud = -Infinity;
      for (const p of nostrils.filter(q => Math.sign(q[2]) === side)) { const h = outermostExit(cap, [p[0] - H, p[1], p[2]], [1, 0, 0], 4 * H); if (h) proud = Math.max(proud, p[0] - h.point[0]); }
      assert.ok(proud >= 0.005 * H, `${id}: nostril ${side} stands ${(proud / H).toFixed(4)} H proud`);
    }
  }
  for (const [id, recipe] of [['worm', composerPreset('worm')], ['wild-composer-5-blunt-paired', specimen('wild-composer-5-blunt-paired')], ['wild-composer-26-blunt-trunk', specimen('wild-composer-26-blunt-trunk')], ['worm-snout1.5', {...composerPreset('worm'), snoutLength: 1.5}]]) {
    const {graph, skin} = build(recipe), {H} = dims(graph), hf = frame(graph.bones[graph.chains.head]);
    const cap = localTris(skin, partsOf(skin, 'head', 'blunt'), hf.toLocal), disc = verticesOf(skin, partsOf(skin, 'mouth', 'mouth disc')).map(v => hf.toLocal(vertex(skin, v)));
    assert.ok(disc.length > 20, `${id}: mouth disc`);
    let worst = 0;
    for (const p of disc) { const h = outermostExit(cap, [p[0] - H, p[1], p[2]], [1, 0, 0], 4 * H); assert.ok(h, `${id}: disc vertex over the cap`); worst = Math.max(worst, Math.abs(p[0] - h.point[0])); }
    assert.ok(worst <= 0.005 * H, `${id}: mouth disc ${(worst / H).toFixed(4)} H off the cap`);
  }
});

// EC4 (head polish) raised the proboscis allowance 600 -> 800 triangles: a 16-segment trunk (was 12), its nostril tip
// (bulb lip, two nostrils, finger) and the lofted ear sheets; still a small fraction of COMPOSER_BUDGET.maxTriangles
test('budgets: proboscis head group <= legacy + 800, trunked centipede < 30000, COMPOSER_BUDGET over presets, 256 wild, 256 coherent', () => {
  for (const [id, recipe] of Object.entries(PROBOSCIS)) {
    const {skin} = build(recipe), n = headGroup(skin);
    assert.ok(n <= LEGACY_HEAD_GROUP[id] + 800, `${id}: head group ${n} vs legacy ${LEGACY_HEAD_GROUP[id]}`);
  }
  assert.ok(build(composerPreset('trunked-centipede')).skin.triangleCount < 30000);
  const check = (id, recipe) => {
    const graph = buildComposerGraph(effective(recipe)), skin = buildComposerSkin(graph);
    assert.ok(graph.bones.length <= COMPOSER_BUDGET.maxBones && skin.vertexCount <= COMPOSER_BUDGET.maxVertices && skin.triangleCount <= COMPOSER_BUDGET.maxTriangles, `${id}: ${graph.bones.length} bones, ${skin.vertexCount} v, ${skin.triangleCount} t`);
  };
  for (const id of COMPOSER_PRESET_IDS) check(id, composerPreset(id));
  for (let i = 0; i < 256; i++) { check(`wild ${i}`, randomComposerRecipe(String(i))); check(`coherent ${i}`, randomCoherentComposerRecipe(String(i))); }
});

test('coherent pachyderms (proboscis faces) still balance at rest', () => {
  let pass = 0, n = 0;
  for (let i = 0; i < 48; i++) {
    const s = coherentComposerSpecies(`pachyderm-${i}`, {archetype: 'pachyderm'});
    n++; if (s.balance.pass) pass++;
  }
  assert.ok(pass === n, `${pass}/${n} pachyderms balanced`);
});
