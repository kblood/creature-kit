// Composer eyes (fauna-composer-eye-1, face round WP4; fauna-composer-eye-2, eye round EC2): lidded ring eyes with
// shaped pupils, iris, limbus and lids, arthropod compound eyes and worm eyespots, seated on the built skull along each
// face's gaze. Measured on the actual skin buffers (positions, colours, gloss, parts) plus the skin's debug eye records;
// the pure module is checked on its own. Under the current eye rules (eyeRules 2) every eye is the catalogue geometry
// (fauna-composer-eye-2, debug type = the eye kind); under the earlier rules the face round's kinds keep the
// fauna-composer-eye-1 build (debug type = the built stand-in). The catalogue kinds' own traits are measured in
// tests/fauna-composer-eye-catalogue-geometry.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {COMPOSER_CHOICES, COMPOSER_PRESET_IDS, composerPreset, decodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {COMPOSER_BUDGET, buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {COMPOSER_EYE_CATALOGUE, COMPOSER_EYE_CONTRAST, COMPOSER_EYE_PITCH_DEG, COMPOSER_EYESPOT_PITCH_DEG, buildComposerSkin, composerSpeciesBodyLength} from '../src/fauna-composer-mesh.ts';
import {createComposerCreature} from '../src/fauna-composer.ts';
import {composerIndividualTraits, deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {randomCoherentComposerRecipe} from '../src/fauna-composer-species.ts';
import {COMPOSER_IRIS_RGB, FACE_EYE_PROFILE, composerEyeProfileId, resolveComposerEyes} from '../src/fauna-composer-face.ts';
import {EYE_PRESETS, FACE_ROUND_EYE_KINDS} from '../src/fauna-composer-eye-catalogue.ts';
import {COAT_PALETTE_IDS} from '../src/fauna-coat-vocab.ts';
import {
  EYE_PATCH, EYE_ROLE, buildCompoundEye, buildEyePatch, buildEyespot, eyeGaze, nearestExit, outermostExit, raycastFirstHit, ringNormal,
} from '../src/fauna-composer-eye.ts';

const digest = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const effective = input => deriveComposerIndividual(normalizeComposerRecipe(input).recipe).recipe;
const build = input => { const graph = buildComposerGraph(effective(input)); return {graph, skin: buildComposerSkin(graph, {debug: true})}; };
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const deg = r => r * 180 / Math.PI;
const angleDeg = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)))));
const specimens = JSON.parse(readFileSync(new URL('./fauna-face-specimens.json', import.meta.url), 'utf8')).specimens;
const showcases = specimens.filter(s => s.group === 'eye').map(s => [s.name, decodeComposerRecipe(s.text).recipe]);
const presets = COMPOSER_PRESET_IDS.map(id => [id, composerPreset(id)]);
const LIDDED = new Set(['round', 'horizontal', 'vertical-slit']);
/** Debug types of camera (lidded) eyes: the face round's three and every catalogue camera kind. */
const CAMERA = new Set(Object.values(EYE_PRESETS).filter(t => t.structure === 'camera').map(t => t.kind));
/** The debug type the skin records for a recipe's eyes: the stand-in under the earlier rules, else the kind. */
const builtType = e => (e.rules === 1 && FACE_ROUND_EYE_KINDS.includes(e.kind) ? e.built : e.kind);
/** Eyes per kind: spiders 8, insects 2 compound + 3 ocelli, everything else a pair. */
const eyeCount = kind => (kind === 'spider' ? 8 : kind === 'insect' ? 5 : 2);
/** The gaze a skin's eye must have, from its kind's preset and the face's profiles (fauna-composer-eye-2); null for
 * simple eyes and stalks (measured in the catalogue geometry test). */
function expectedGaze(r, eye) {
  const e = resolveComposerEyes(r), t = e.traits, P = t.placement;
  if (e.rules === 1 && FACE_ROUND_EYE_KINDS.includes(e.kind)) {
    const profile = FACE_EYE_PROFILE[composerEyeProfileId(r)];
    return eyeGaze(profile.gazeYawDeg, eye.type === 'eyespot' ? COMPOSER_EYESPOT_PITCH_DEG : COMPOSER_EYE_PITCH_DEG, eye.side);
  }
  const cam = FACE_EYE_PROFILE[composerEyeProfileId(r, 'round')];
  // simple eyes, stalks, the chameleon's turret (its axis leans toward the skull normal) and a lidless spectacle eye (it
  // turns toward a skull leaning away, COMPOSER_EYE_CATALOGUE.seat.tiltLidless) are measured in the catalogue geometry test
  if (eye.type === 'ocellus' || eye.type === 'stalk' || t.lid === 'turret' || t.lid === 'spectacle') return null;
  if (t.structure === 'camera') {
    const own = P.kind === 'independent' && eye.side > 0 ? P.right : null;
    return eyeGaze(own?.yawDeg ?? P.yawByFace?.[r.head] ?? P.yawDeg ?? cam.gazeYawDeg, own?.pitchDeg ?? P.pitchDeg ?? COMPOSER_EYE_PITCH_DEG, eye.side);
  }
  if (t.structure === 'compound') return eyeGaze(r.head === 'mandibles' ? FACE_EYE_PROFILE.mandibles.gazeYawDeg : cam.gazeYawDeg, COMPOSER_EYE_PITCH_DEG, eye.side);
  if (t.structure === 'eyespot') return r.head === 'blunt' ? eyeGaze(COMPOSER_EYE_CATALOGUE.eyespotYawDeg, COMPOSER_EYE_CATALOGUE.eyespotPitchDeg, eye.side) : eyeGaze(cam.gazeYawDeg, COMPOSER_EYE_PITCH_DEG, eye.side);
  return null;
}
const RING = {centre: 0, pupil: 1, irisInner: 2, iris: 3, limbus: 4, lid: 5, outerLid: 6, orbit: 7, socket: 8};

/** Head-local frame of the built head bone (x forward, y up, z lateral). */
function headFrame(graph) {
  const hb = graph.bones[graph.chains.head], q = new THREE.Quaternion(...hb.restQuaternion), qi = q.clone().invert(), p0 = new THREE.Vector3(...hb.restPosition);
  const toLocal = (x, y, z) => { const v = new THREE.Vector3(x, y, z).sub(p0).applyQuaternion(qi); return [v.x, v.y, v.z]; };
  const dirToModel = d => { const v = new THREE.Vector3(...d).applyQuaternion(q); return [v.x, v.y, v.z]; };
  const forward = dirToModel([1, 0, 0]);
  return {toLocal, dirToModel, pitchDeg: deg(Math.asin(Math.max(-1, Math.min(1, forward[1]))))};
}
const vertex = (skin, v) => [skin.positions[v * 3], skin.positions[v * 3 + 1], skin.positions[v * 3 + 2]];
const colour = (skin, v) => [skin.colors[v * 3], skin.colors[v * 3 + 1], skin.colors[v * 3 + 2]];
const ringIds = (eye, r, n = 20) => Array.from({length: n}, (_, i) => eye.rings[r] + i);
/** The head part's own triangles (ears excluded) in head-local coordinates. */
function headTris(graph, skin) {
  const {toLocal} = headFrame(graph), out = [];
  for (const p of skin.parts) if (p.part === 'head' && !p.label.endsWith('ears')) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) out.push(...toLocal(...vertex(skin, skin.index[i])));
  return out;
}
const eyesPart = skin => skin.parts.filter(p => p.part === 'eyes');
function inEyes(skin) {
  const set = new Set();
  for (const p of eyesPart(skin)) for (let i = p.firstTriangle * 3; i < (p.firstTriangle + p.triangles) * 3; i++) set.add(skin.index[i]);
  return set;
}
/** 2-D principal axes of a ring projected into the plane normal to n: [long half-extent, short half-extent, long axis]. */
function ringShape(points, n) {
  const c = points.reduce((a, p) => a.map((x, k) => x + p[k] / points.length), [0, 0, 0]);
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nn = n.map(x => x / Math.hypot(...n)), e1 = (v => v.map(x => x / Math.hypot(...v)))(cr(ref, nn)), e2 = cr(nn, e1);
  const uv = points.map(p => { const d = p.map((x, k) => x - c[k]); return [d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2], d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2]]; });
  let sxx = 0, syy = 0, sxy = 0; for (const [u, v] of uv) { sxx += u * u; syy += v * v; sxy += u * v; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), a = [Math.cos(th), Math.sin(th)], b = [-a[1], a[0]];
  const ext = d => Math.max(...uv.map(([u, v]) => Math.abs(u * d[0] + v * d[1])));
  const ea = ext(a), eb = ext(b), long = ea >= eb ? a : b;
  return [Math.max(ea, eb), Math.min(ea, eb), [e1[0] * long[0] + e2[0] * long[1], e1[1] * long[0] + e2[1] * long[1], e1[2] * long[0] + e2[2] * long[1]]];
}

test('pure module: ring layout, counts and closure of the three eye kinds', () => {
  for (const type of ['round', 'horizontal', 'vertical-slit']) {
    const p = buildEyePatch({type, er: 1, centre: [0, 0, 0], gaze: [0, 0, 1], up: [0, 1, 0]});
    assert.equal(p.positions.length / 3, 1 + 7 * EYE_PATCH.segments + EYE_PATCH.segments + 1, type);
    assert.equal(p.index.length / 3, 280, `${type}: 280 triangles (<= 300)`);
    assert.deepEqual(p.rings, [0, 1, 21, 41, 61, 81, 101, 121, 141]);
    assert.equal(p.roles[0], EYE_ROLE.pupil);
    assert.ok(p.gloss.every((g, i) => (p.roles[i] <= EYE_ROLE.limbus ? g === 1 : p.roles[i] === EYE_ROLE.lid ? g === 0.4 : g === 0)), `${type}: gloss by role`);
    // a closed surface once coincident vertices are welded (the closing cone repeats the orbit ring with its own
    // vertices): every edge is shared by exactly two triangles in opposite directions
    const weld = new Map(), id = v => { const key = p.positions.slice(v * 3, v * 3 + 3).map(x => x.toFixed(9)).join(); if (!weld.has(key)) weld.set(key, weld.size); return weld.get(key); };
    const edges = new Map();
    for (let t = 0; t < p.index.length; t += 3) for (let k = 0; k < 3; k++) { const a = id(p.index[t + k]), b = id(p.index[t + (k + 1) % 3]), key = `${a},${b}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
    for (const [key, n] of edges) { const [a, b] = key.split(','); assert.equal(n, 1, `${type}: edge ${key}`); assert.equal(edges.get(`${b},${a}`), 1, `${type}: edge ${key} unpaired`); }
  }
  const c = buildCompoundEye({er3: [1, 2, 1.5], centre: [0, 0, 0], gaze: [0, 0, 1], up: [0, 1, 0]});
  assert.equal(c.index.length / 3, 120, 'compound eye: 120 triangles');
  assert.equal(c.roles[0], EYE_ROLE.pseudopupil);
  const s = buildEyespot({r: 1, centre: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0]});
  assert.equal(s.index.length / 3, 8, 'eyespot: 8 triangles');
  // raycasts on a unit tetrahedron-free square: two triangles in the z = 1 plane facing +z
  const quad = [-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, 1, 1];
  assert.equal(raycastFirstHit(quad, [0.2, 0.1, 0], [0, 0, 1]).t, 1);
  assert.equal(raycastFirstHit(quad, [0.2, 0.1, 0], [0, 0, -1]), null);
  assert.equal(nearestExit(quad, [0.2, 0.1, 3], [0, 0, 1]).t, -2);
  assert.equal(outermostExit(quad, [0.2, 0.1, 0], [0, 0, 1], 0.5), null);
});

test('pupil aspect on the flat patch: horizontal >= 2.5, vertical slit >= 3, round 0.9-1.1', () => {
  for (const [type, check] of [['horizontal', (w, h) => w / h >= 2.5], ['vertical-slit', (w, h) => h / w >= 3], ['round', (w, h) => w / h >= 0.9 && w / h <= 1.1]]) {
    const p = buildEyePatch({type, er: 1, centre: [0, 0, 0], gaze: [0, 0, 1], barAxis: [1, 0, 0]});
    const r1 = Array.from({length: 20}, (_, i) => p.positions.slice((1 + i) * 3, (2 + i) * 3));
    const w = Math.max(...r1.map(q => Math.abs(q[0]))), h = Math.max(...r1.map(q => Math.abs(q[1])));
    assert.ok(check(w, h), `${type}: ${w.toFixed(3)} x ${h.toFixed(3)}`);
  }
});

/** Every recipe the gaze/placement acceptance covers: 12 presets and 6 showcases, at maturity .3 and 1, plus extreme individuals. */
function* coverage() {
  for (const [name, recipe] of [...presets, ...showcases]) {
    for (const maturity of [0.3, 1]) yield [`${name} m${maturity}`, {...recipe, maturity}];
    for (let seed = 1; seed <= 8; seed++) yield [`${name} seed${seed}`, {...recipe, individualSeed: seed, variability: 1}];
  }
}

test('built eyes: pupil aspect and a bar that counter-rolls the head pitch, on the actual skins', () => {
  for (const [name, recipe] of coverage()) {
    const {graph, skin} = build(recipe), {toLocal, pitchDeg} = headFrame(graph);
    for (const eye of skin.debug.eyes.filter(e => LIDDED.has(e.type))) {
      const r1 = ringIds(eye, RING.pupil).map(v => vertex(skin, v));
      const gazeModel = headFrame(graph).dirToModel(eye.gaze);
      const [long, short, axis] = ringShape(r1, gazeModel);
      // the long pupil axis: along the bar for a horizontal pupil, across it for a slit
      if (eye.type === 'horizontal') {
        assert.ok(long / short >= 2.5, `${name}: horizontal aspect ${(long / short).toFixed(2)}`);
        const tilt = deg(Math.asin(Math.min(1, Math.abs(axis[1]))));
        assert.ok(tilt <= 0.3 * Math.abs(pitchDeg) + 2, `${name}: bar ${tilt.toFixed(1)} deg vs head pitch ${pitchDeg.toFixed(1)}`);
      } else if (eye.type === 'vertical-slit') assert.ok(long / short >= 3, `${name}: slit aspect ${(long / short).toFixed(2)}`);
      else assert.ok(long / short <= 1.1, `${name}: round aspect ${(long / short).toFixed(2)}`);
      void toLocal;
    }
  }
});

test('gaze within 3 degrees of the face profile, no fallbacks, eye centres just behind the skull surface', () => {
  let eyes = 0;
  for (const [name, recipe] of coverage()) {
    const {graph, skin} = build(recipe), {toLocal} = headFrame(graph), r = graph.recipe;
    assert.equal(skin.eyeFallbacks, 0, `${name}: eye fallbacks`);
    const tris = headTris(graph, skin), resolved = resolveComposerEyes(r);
    assert.equal(skin.debug.eyes.length, eyeCount(resolved.kind), name);
    for (const eye of skin.debug.eyes) {
      const expected = expectedGaze(r, eye);
      if (!expected) continue;
      if (eye.type === 'eyespot') {
        // an eyespot follows the cap, so its gaze is the direction it was placed along, and its centre must sit on the
        // cap (within 1% of the head length; eye-1: the disc's first vertex, eye-2: the bead's base centre)
        assert.ok(angleDeg(eye.gaze, expected) <= 3, `${name}: eyespot direction`);
        const c = resolved.rules === 1 ? toLocal(...vertex(skin, eye.firstVertex)) : eye.centre, hit = nearestExit(tris, c, eye.gaze);
        assert.ok(hit && Math.abs(hit.t) <= 0.01 * graph.dims.headLength, `${name}: eyespot off the cap by ${hit?.t}`);
        eyes++;
        continue;
      }
      // measured gaze: the Newell normal of the first ring (pupil edge; compound: first station, 12 segments in eye-1,
      // 14 in eye-2)
      const ids = ringIds(eye, 1, eye.type === 'compound' || eye.type === 'insect' ? (eye.triangles === 120 ? 12 : 14) : 20);
      const local = new Float64Array(ids.flatMap(v => toLocal(...vertex(skin, v))));
      const measured = ringNormal(local, ids.map((_, i) => i));
      const err = Math.min(angleDeg(measured, expected), angleDeg(measured.map(x => -x), expected));
      // a cat eye turns toward a skull leaning away from its look (COMPOSER_EYE_CATALOGUE.cat.tiltDeg, EC2 review), at
      // most as far as the catalogue geometry test allows (35 deg); every other eye looks where its profile says
      const tol = eye.type === 'cat' ? 35 : 3;
      assert.ok(err <= tol, `${name} side ${eye.side}: gaze off by ${err.toFixed(2)} deg`);
      assert.ok(eye.surface, `${name}: eye seated on the skull`);
      if (CAMERA.has(eye.type)) {
        // centre to skull surface along the gaze: in [-0.3 er, +0.05 er] (negative: behind the surface)
        const hit = nearestExit(tris, eye.centre, eye.gaze);
        assert.ok(hit, `${name}: skull surface along the gaze`);
        const offset = -hit.t / eye.er;
        assert.ok(offset >= -0.3 - 1e-9 && offset <= 0.05, `${name}: centre offset ${offset.toFixed(3)} er`);
      }
      eyes++;
    }
  }
  assert.ok(eyes >= 2 * 18 * 10);
});

test('cornea gloss sits on the outward, lateral side of every eye (no medial glint)', () => {
  // A literal per-vertex test (side * z of every glossy vertex >= that of its eye centre) is impossible for a symmetric
  // cornea whenever the gaze is less than ~74 deg from the midline (flat faces look 15 deg out), so the regression is
  // checked as: every glossy vertex lies on the outward side of its eye centre along the gaze, and the gloss-weighted
  // centroid is lateral of the eye centre.
  for (const [name, recipe] of [...presets, ...showcases, ...Array.from({length: 24}, (_, i) => [`wild-${i}`, randomComposerRecipe(`eye-glint-${i}`)])]) {
    const {graph, skin} = build(recipe), {toLocal} = headFrame(graph);
    // an eye-2 eyespot bead is pigment draped on the cap (its rim follows the cap behind the tangent point): no cornea
    for (const eye of skin.debug.eyes.filter(e => e.type !== 'eyespot' || e.triangles === 8)) {
      let sum = 0, cz = 0;
      for (let v = eye.firstVertex; v < eye.firstVertex + eye.vertexCount; v++) {
        const g = skin.gloss[v];
        if (g <= 0.5) continue;
        const p = toLocal(...vertex(skin, v)), d = p.map((x, k) => x - eye.centre[k]);
        assert.ok(d[0] * eye.gaze[0] + d[1] * eye.gaze[1] + d[2] * eye.gaze[2] >= -1e-6, `${name}: glossy vertex behind its eye centre (float32 positions: 1 micron)`);
        sum += g; cz += g * p[2];
      }
      if (CAMERA.has(eye.type)) assert.ok(sum > 0 && eye.side * (cz / sum) > eye.side * eye.centre[2], `${name}: gloss centroid medial of the eye`);
    }
  }
});

test('colour: iris against pupil and lid on every palette and face; the eye colours stay inside the eyes part', () => {
  const faces = {muzzle: composerPreset('giraffe'), beak: composerPreset('bird'), jaws: composerPreset('dinosaur')};
  for (const palette of COAT_PALETTE_IDS) for (const [face, base] of Object.entries(faces)) {
    const name = `${palette}/${face}`, {skin} = build({...base, palette});
    const {iris, eye, lidFactor} = skin.debug.eyeColours;
    assert.ok(iris, `${name}: an iris`);
    assert.notDeepEqual(iris, [0.008, 0.008, 0.010], `${name}: iris differs from the pupil`);
    assert.ok(lum(iris) >= COMPOSER_EYE_CONTRAST.overPupil * lum([0.008, 0.008, 0.010]) - 1e-9, `${name}: iris over pupil`);
    assert.ok(lidFactor > 0 && lidFactor <= COMPOSER_EYE_CONTRAST.lid);
    for (const e of skin.debug.eyes) {
      const irisV = ringIds(e, RING.iris).map(v => colour(skin, v)), lidV = ringIds(e, RING.lid).map(v => colour(skin, v));
      for (const c of irisV) for (const l of lidV) assert.ok(lum(c) >= 1.8 * lum(l) - 1e-6, `${name}: iris ${lum(c).toFixed(4)} vs lid ${lum(l).toFixed(4)}`);
    }
    // no vertex outside the eyes part carries the iris or the palette eye colour (float32 compare)
    const own = inEyes(skin), f = c => Float32Array.from(c).join(), banned = new Set([f(iris), f(eye)]);
    for (let v = 0; v < skin.vertexCount; v++) if (!own.has(v)) assert.ok(!banned.has(f(colour(skin, v))), `${name}: vertex ${v} outside 'eyes' has an eye colour`);
  }
  // nostrils and the blunt mouth disc: not pal.eye either (the worm and every muzzle preset)
  for (const id of ['worm', 'giraffe', 'rhinoceros', 'ape', 'centipede']) {
    const {skin} = build(composerPreset(id)), own = inEyes(skin), eye = Float32Array.from(skin.debug.eyeColours.eye).join();
    for (let v = 0; v < skin.vertexCount; v++) if (!own.has(v)) assert.notEqual(Float32Array.from(colour(skin, v)).join(), eye, `${id}: vertex ${v}`);
  }
});

test('iris choice changes colours only, never positions, index or skinning', () => {
  for (const id of ['giraffe', 'bird', 'dinosaur', 'ape']) {
    const base = composerPreset(id), a = build(base).skin;
    for (const iris of COMPOSER_CHOICES.iris.filter(x => x !== 'auto')) {
      const b = build({...base, iris}).skin;
      assert.equal(digest(b.positions, b.index, b.skinIndex, b.skinWeight, b.gloss), digest(a.positions, a.index, a.skinIndex, a.skinWeight, a.gloss), `${id} iris ${iris}`);
    }
    const colours = new Set(COMPOSER_CHOICES.iris.map(iris => digest(build({...base, iris}).skin.colors)));
    assert.ok(colours.size >= COMPOSER_CHOICES.iris.length - 1, `${id}: iris choices recolour the eye (${colours.size})`);
  }
  // a brown-eyed and a gold-eyed giraffe differ in the iris ring only
  const g1 = build({...composerPreset('giraffe'), iris: 'brown'}).skin, g2 = build({...composerPreset('giraffe'), iris: 'gold'}).skin, own = inEyes(g1);
  for (let v = 0; v < g1.vertexCount; v++) if (!own.has(v)) assert.deepEqual(colour(g1, v), colour(g2, v), `vertex ${v} outside the eyes recoloured`);
  assert.ok(COMPOSER_IRIS_RGB.gold[0] > 0);
});

test('budget: per-eye triangles, the creature budget on presets, 256 wild and 256 coherent seeds, one draw', () => {
  const recipes = [...presets, ...Array.from({length: 256}, (_, i) => [`wild-${i}`, randomComposerRecipe(`eye-budget-wild-${i}`)]), ...Array.from({length: 256}, (_, i) => [`coherent-${i}`, randomCoherentComposerRecipe(`eye-budget-coherent-${i}`)])];
  const kinds = new Set();
  for (const [name, recipe] of recipes) {
    const {skin} = build(recipe);
    assert.equal(skin.eyeFallbacks, 0, `${name}: eye fallbacks`);
    for (const e of skin.debug.eyes) {
      kinds.add(e.type);
      // eye-1: lidded 280, compound 120, eyespot 8; eye-2: lidded 280, faceted compound 252, eyespot bead 96, simple
      // eyes 16-72 (a rim flange adds 2 x segments), a stalk with its bulb <= 160
      const limit = CAMERA.has(e.type) ? 300 : e.type === 'compound' || e.type === 'insect' ? 252 : e.type === 'eyespot' ? 96 : e.type === 'ocellus' ? 72 : 160;
      assert.ok(e.triangles <= limit, `${name}: ${e.type} eye ${e.triangles} triangles`);
      if (e.type === 'eyespot') assert.equal(e.triangles, 96, 'the eyespot bead');
    }
    const eyeTris = eyesPart(skin).reduce((n, p) => n + p.triangles, 0);
    assert.equal(eyeTris, skin.debug.eyes.reduce((n, e) => n + e.triangles, 0), `${name}: every eye triangle is in the eyes part`);
    assert.ok(skin.triangleCount <= COMPOSER_BUDGET.maxTriangles && skin.vertexCount <= COMPOSER_BUDGET.maxVertices, `${name}: ${skin.vertexCount} v / ${skin.triangleCount} t`);
  }
  for (const k of ['round', 'horizontal', 'vertical-slit', 'compound', 'eyespot']) assert.ok(kinds.has(k), `coverage: ${k}`);
  const c = createComposerCreature(composerPreset('giraffe'));
  try {
    const meshes = []; c.group.traverse(o => { if (o.isMesh) meshes.push(o); });
    assert.equal(meshes.filter(o => o.isSkinnedMesh).length, 1);
    assert.ok(!Array.isArray(c.mesh.material), 'one colour material');
    assert.equal(c.details().drawCalls, 1);
  } finally { c.dispose(); }
});

test('determinism: two builds are byte-identical including gloss; the skin individual stream still takes 12 draws', () => {
  for (const [name, recipe] of [...presets, ...showcases]) {
    const a = build(recipe).skin, b = build(recipe).skin;
    assert.equal(digest(a.positions, a.colors, a.index, a.skinIndex, a.skinWeight, a.gloss, a.regions), digest(b.positions, b.colors, b.index, b.skinIndex, b.skinWeight, b.gloss, b.regions), name);
  }
  const src = readFileSync(new URL('../src/fauna-composer-mesh.ts', import.meta.url), 'utf8');
  assert.equal((src.match(/\bind\(\)/g) ?? []).length, 1, 'one draw site on the skin individual stream');
  assert.match(src, /for \(let i = 0; i < 12; i\+\+\) u9\.push\(ind\(\)\)/);
  assert.doesNotMatch(readFileSync(new URL('../src/fauna-composer-eye.ts', import.meta.url), 'utf8'), /Math\.random|composerRandom|Date\.now|performance\.now/);
});

test('auto eye type is a species trait: an individual never changes pupil with its size, sex or age', () => {
  for (const [name, recipe] of [...presets, ...showcases, ['kitten', {...showcases.find(([n]) => n === 'eye-cat')[1]}]]) {
    const species = normalizeComposerRecipe(recipe).recipe, want = builtType(resolveComposerEyes(species));
    for (const maturity of [0.3, 0.6, 1]) for (let seed = 0; seed <= 6; seed++) for (const sex of ['auto', 'male', 'female']) {
      const r = {...species, maturity, individualSeed: seed, variability: 1, sex, dimorphism: 1};
      const eff = effective(r), traits = composerIndividualTraits(eff);
      // the species body length recovered from the effective recipe is the species' own (to the recipe's 0.01 step)
      // unless the individual length was clamped to the recipe range; a clamp keeps the estimate on the species' side
      // of every eye-type threshold (min 0.2 m / 0.45 < 0.9 m; max 6 m / 1.2 > 0.9 m)
      const clamped = eff.bodyLength <= 0.2 || eff.bodyLength >= 6;
      if (!clamped) assert.ok(Math.abs(composerSpeciesBodyLength(eff, traits) - species.bodyLength) <= 0.011, `${name}: species length ${composerSpeciesBodyLength(eff, traits)} vs ${species.bodyLength}`);
      if (maturity === 0.6 || seed % 2 === 0 && seed > 0) continue;
      const {skin} = build(r);
      assert.equal(skin.debug.eyes[0].type, want, `${name} m${maturity} seed${seed} ${sex}`);
    }
  }
});
