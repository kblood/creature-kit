// Eye catalogue geometry (eye round EC2, fauna-composer-eye-2 / fauna-composer-skin-4): the 13 catalogue kinds' own
// shapes, measured on the pure module (a flat skull plane, er = 1) and on built skins (the eye-catalogue specimens of
// tests/fauna-face-specimens.json, and a sweep of every kind on its native faces). The pure measures pin what each kind
// is for (the gecko's beaded slit, the cuttlefish W, the raptor's brow shelf, the chameleon's leaning turret, the
// human-like white sclera); the skin measures pin what the legibility pass fixed (no rim standing in the air as a flap,
// no eye crossing the midline, nothing buried, no fallbacks).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMPOSER_PRESET_IDS, composerPreset, decodeComposerRecipe, normalizeComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {COMPOSER_BUDGET, buildComposerGraph} from '../src/fauna-composer-rig.ts';
import {COMPOSER_EYE_CATALOGUE, COMPOSER_EYE_PITCH_DEG, SPIDER_EYES, buildComposerSkin} from '../src/fauna-composer-mesh.ts';
import {deriveComposerIndividual} from '../src/fauna-composer-individual.ts';
import {FACE_EYE_PROFILE, composerEyeProfileId, resolveComposerEyes} from '../src/fauna-composer-face.ts';
import {CATALOGUE_EYE_KINDS, EYE_PRESETS} from '../src/fauna-composer-eye-catalogue.ts';
import {
  CATALOGUE_EYE, EYE_PATCH, EYE_ROLE, EYESPOT_BEAD, OCELLUS, buildEyePatch, buildEyespotBead, buildFacetedEye, buildOcellus, catalogueEyeSpec,
  cataloguePupilPoint, closestPointOnSoup, eyeGaze, wPupilPoint,
} from '../src/fauna-composer-eye.ts';

const specimens = JSON.parse(readFileSync(new URL('./fauna-face-specimens.json', import.meta.url), 'utf8')).specimens;
const effective = input => deriveComposerIndividual(normalizeComposerRecipe(input).recipe).recipe;
const build = input => { const graph = buildComposerGraph(effective(input)); return {graph, skin: buildComposerSkin(graph, {debug: true})}; };
const vtx = (skin, i) => [skin.positions[3 * i], skin.positions[3 * i + 1], skin.positions[3 * i + 2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The skin's own skull (head, neck, torso and trunk parts; never the eyes), as a triangle soup. */
function skullSoup(skin) {
  const out = [];
  for (const p of skin.parts) {
    if (!['head', 'neck', 'torso', 'trunk'].includes(p.part)) continue;
    for (let t = p.firstTriangle; t < p.firstTriangle + p.triangles; t++) for (let k = 0; k < 3; k++) out.push(...vtx(skin, skin.index[3 * t + k]));
  }
  return Float64Array.from(out);
}
/** Largest distance (in er) of an eye's ring `k` from the skull. */
function ringOff(skin, soup, e, k) {
  let m = 0;
  for (let i = e.rings[k]; i < e.rings[k + 1]; i++) { const p = vtx(skin, i); m = Math.max(m, dist(p, closestPointOnSoup(soup, p).point) / e.er); }
  return m;
}
/** Eyes per kind and their debug types. */
const expectedTypes = kind => (kind === 'spider' ? Array(8).fill('ocellus') : kind === 'insect' ? ['insect', 'insect', 'ocellus', 'ocellus', 'ocellus'] : [kind, kind]);
/** The catalogue specimens with their resolved kind ('auto' resolves to the spider on four leg pairs). */
const catalogue = specimens.filter(s => s.group === 'eye-catalogue').map(s => { const recipe = decodeComposerRecipe(s.text).recipe; return {name: s.name, recipe, kind: resolveComposerEyes(effective(recipe)).kind}; });
const built = new Map(catalogue.map(c => [c.name, build(c.recipe)]));
const byKind = kind => { const c = catalogue.find(x => x.kind === kind); assert.ok(c, `a catalogue specimen for ${kind}`); return built.get(c.name); };

// ---- the pure module, er = 1, on a flat skull plane (z = 0) looking along +z ------------------------------------------
const PLANE = Float64Array.from([-10, -10, 0, 10, -10, 0, 0, 10, 0]);
const patch = (kind, extra = {}) => buildEyePatch({type: 'round', er: 1, centre: [0, 0, -EYE_PATCH.recess], gaze: [0, 0, 1], up: [0, 1, 0], forward: [1, 0, 0], surface: PLANE, spec: catalogueEyeSpec(EYE_PRESETS[kind]), ...extra});
/** Vertices of ring k of a patch. */
const ring = (p, k) => { const out = []; for (let i = p.rings[k]; i < (p.rings[k + 1] ?? p.positions.length / 3); i++) out.push([p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2], p.roles[i]]); return out; };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

test('every catalogue camera kind builds a closed 280-triangle patch on a plane with no rim fallback', () => {
  for (const kind of CATALOGUE_EYE_KINDS) {
    if (EYE_PRESETS[kind].structure !== 'camera') continue;
    const p = patch(kind);
    assert.equal(p.index.length / 3, 280, kind);
    assert.equal(p.rimFallbacks, 0, kind);
    for (const v of p.positions) assert.ok(Number.isFinite(v), kind);
  }
});

test('gecko: a beaded slit with five beads down each side', () => {
  const spec = catalogueEyeSpec(EYE_PRESETS.gecko), N = EYE_PATCH.segments, q = N / 4;
  assert.equal(spec.pupil.kind, 'beaded-slit');
  // the left side runs top to bottom (q + 1 .. 3q - 1): count local maxima of the half-width
  const w = []; for (let k = q + 1; k < 3 * q; k++) w.push(Math.abs(cataloguePupilPoint(spec.pupil, 2 * Math.PI * k / N, k, N)[0]));
  let beads = 0; for (let j = 0; j < w.length; j++) if ((j === 0 || w[j] > w[j - 1]) && (j === w.length - 1 || w[j] > w[j + 1])) beads++;
  assert.equal(beads, 5, `half-widths ${w.map(v => v.toFixed(3))}`);
  assert.ok(Math.min(...w) < 0.5 * Math.max(...w), 'the pinches are narrower than half a bead');
});

test('cephalopod: the W pupil has two lower lobes and a raised central cusp', () => {
  assert.equal(catalogueEyeSpec(EYE_PRESETS.cephalopod).pupil.kind, 'w');
  const pts = []; for (let k = 0; k < 360; k++) pts.push(wPupilPoint(2 * Math.PI * k / 360));
  const low = Math.min(...pts.map(p => p[1])), cusp = wPupilPoint(-Math.PI / 2)[1];
  assert.ok(low < -0.25, `lobes reach ${low}`);
  assert.ok(cusp > low + 0.15, `cusp ${cusp} stands above the lobes ${low}`);
  for (const sign of [-1, 1]) {
    const lobe = pts.filter(p => sign * p[0] > 0.05).reduce((a, b) => (b[1] < a[1] ? b : a));
    assert.ok(Math.abs(lobe[0]) > 0.12 && lobe[1] < cusp - 0.15, `lobe ${sign}: ${lobe}`);
  }
});

test('raptor: the brow shelf overhangs the upper lid; a plain round eye is symmetric', () => {
  const OUTER = 6, up = p => mean(ring(p, OUTER).filter(v => v[1] > 0.05).map(v => v[2])), lo = p => mean(ring(p, OUTER).filter(v => v[1] < -0.05).map(v => v[2]));
  const raptor = patch('raptor'), round = patch('round');
  assert.ok(up(raptor) - lo(raptor) >= 0.2, `raptor shelf ${up(raptor) - lo(raptor)}`);
  assert.ok(Math.abs(up(round) - lo(round)) < 0.02, `round ${up(round) - lo(round)}`);
});

test('chameleon: a turret whose apex stands at least 0.5 er proud and whose aperture leans toward the look', () => {
  const straight = patch('chameleon'), leaning = patch('chameleon', {look: [0.6, 0, 0.8]});
  assert.ok(straight.positions[2] >= 0.5, `apex ${straight.positions[2]}`);
  const turret = ring(straight, 6);
  assert.ok(turret.every(v => v[3] === EYE_ROLE.turret) && mean(turret.map(v => v[2])) >= CATALOGUE_EYE.turret.lift - 0.01);
  const cx = p => mean(ring(p, 5).map(v => v[0]));
  assert.ok(Math.abs(cx(straight)) < 1e-9);
  // the look's in-plane part is 0.6: the aperture moves CATALOGUE_EYE.turret.lean x 0.6 toward it
  assert.ok(Math.abs(cx(leaning) - 0.6 * CATALOGUE_EYE.turret.lean) < 1e-9 && cx(leaning) > 0.1, `aperture lean ${cx(leaning)}`);
  // the turret wall and the orbit stay on the skull axis: only the aperture leans
  assert.ok(Math.abs(mean(ring(leaning, 6).map(v => v[0]))) < 1e-9);
});

test('sclera: a white ring visible well beyond the iris on both sides', () => {
  const p = patch('sclera'), iris = Math.max(...ring(p, 3).map(v => Math.abs(v[0])));
  const white = [4, 5].flatMap(k => ring(p, k)).filter(v => v[3] === EYE_ROLE.sclera), reach = Math.max(...white.map(v => Math.abs(v[0])));
  assert.ok(white.length >= 40);
  assert.ok(reach - iris > 0.55, `sclera reaches ${reach}, iris ${iris}`);
  for (const sign of [-1, 1]) assert.ok(white.some(v => sign * v[0] > iris + 0.55), `white on side ${sign}`);
});

test('faceted, simple and eyespot beads: closed, with the roles that make them read', () => {
  const closed = (p, byPosition = false) => {
    const key = i => byPosition ? [0, 1, 2].map(k => Math.round(p.positions[3 * i + k] * 1e9) || 0).join(',') : String(i);
    const edges = new Map();
    for (let t = 0; t < p.index.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = key(p.index[t + k]), b = key(p.index[t + (k + 1) % 3]), e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    return [...edges.values()].every(n => n === 2);
  };
  // the compound dome: a 12 x 3 lattice with raised lens centres, 120 triangles (the design cap, FACETED_EYE)
  const facet = buildFacetedEye({er3: [1, 1, 0.7], centre: [0, 0, 0], gaze: [0, 0, 1], up: [0, 1, 0]});
  assert.equal(facet.index.length / 3, 120); assert.ok(closed(facet));
  assert.equal(facet.roles[0], EYE_ROLE.pseudopupil);
  assert.equal([...facet.roles].filter(r => r === EYE_ROLE.pseudopupil).length, 1, 'only the apex is the pseudopupil');
  assert.ok([...facet.roles].filter(r => r === EYE_ROLE['facet-edge']).length >= 36);
  assert.ok([...facet.roles].filter(r => r === EYE_ROLE['facet-a'] || r === EYE_ROLE['facet-b']).length >= 24, 'a lens in every cell');
  const rimmed = buildOcellus({r: 1, height: 0.75, centre: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0], segments: 12, stations: 2, rim: true});
  assert.equal(rimmed.index.length / 3, 48); assert.ok(closed(rimmed));
  assert.ok(ring(rimmed, 2).every(v => v[3] === EYE_ROLE['ocellus-rim']), 'the lowest station is the pale rim');
  assert.ok(ring(rimmed, 1).every(v => v[3] === EYE_ROLE.ocellus));
  // with a flange: a fully dark dome inside a pale ring on the skin (the spider beads: 10 x 1 = 40, 5 x 1 = 20)
  const flanged = buildOcellus({r: 1, height: 0.75, centre: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0], segments: 10, stations: 1, rim: true, flange: true});
  assert.equal(flanged.index.length / 3, 40); assert.ok(closed(flanged));
  assert.ok(ring(flanged, 1).every(v => v[3] === EYE_ROLE.ocellus), 'the dome stays dark');
  assert.ok(ring(flanged, 2).every(v => v[3] === EYE_ROLE['ocellus-rim'] && Math.abs(Math.hypot(v[0], v[1]) - OCELLUS.flange) < 1e-9));
  assert.equal(buildOcellus({r: 1, height: 0.75, centre: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0], segments: 5, stations: 1, rim: true, flange: true}).index.length / 3, 20);
  const bead = buildEyespotBead({r: 1, centre: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0]});
  assert.equal(bead.index.length / 3, 96);
  // a raised dome: the apex stands at heights[0] and the dome falls monotonically to the skin
  assert.ok(Math.abs(bead.positions[2] - EYESPOT_BEAD.heights[0]) < 1e-9);
  for (let k = 1; k < EYESPOT_BEAD.heights.length; k++) assert.ok(EYESPOT_BEAD.heights[k] < EYESPOT_BEAD.heights[k - 1]);
});

// ---- built skins ------------------------------------------------------------------------------------------------------
test('catalogue specimens: every kind builds its eye count, seats every eye, and stays in budget', () => {
  assert.equal(new Set(catalogue.map(c => c.kind)).size, CATALOGUE_EYE_KINDS.length, 'one specimen per catalogue kind');
  for (const {name, kind} of catalogue) {
    const {skin} = built.get(name), eyes = skin.debug.eyes;
    assert.deepEqual(eyes.map(e => e.type), expectedTypes(kind), name);
    assert.equal(skin.eyeFallbacks, 0, name);
    assert.ok(eyes.every(e => e.rimFallbacks === 0 && e.surface), name);
    assert.ok(skin.triangleCount <= COMPOSER_BUDGET.maxTriangles && skin.vertexCount <= COMPOSER_BUDGET.maxVertices, name);
  }
  assert.equal(SPIDER_EYES.length, 4);
});

/** Eye triangles per creature (the whole set), per BUILT kind: the design caps of eye-catalogue-v2.json budgets.perType
 * (lidded presets 280 per eye / 600 per pair, insect <= 280, spider <= 200, stalk <= 160 per pair), and the face
 * round's own counts for its kinds (compound 240 per pair, the flat eyespot 16 per pair, lidded 560). ONE deliberate
 * change, recorded here, in the source (EYESPOT_BEAD) and in the EC2 report: the current rules' eyespot BEAD is 96 per
 * eye (192 per pair), not the face round's 8-triangle flat disc, because the flat disc read as black holes at normal
 * size (GPT Luna 6, face round and EC2 r15/r16); the bead is a low pigment film with a skin rim and blend ring
 * (12 segments x 4 rings + a closing cone). */
const EYE_TRI_CAP = {lidded: 600, insect: 280, spider: 200, stalk: 160, compound: 240, eyespotBead: 192, eyespotFlat: 16};
const LIDDED_KINDS = new Set(['round', 'horizontal', 'vertical-slit', 'raptor', 'owl', 'cat', 'gecko', 'frog', 'chameleon', 'crocodile', 'sclera', 'nocturnal', 'cephalopod']);
test('every eye-catalogue, eye-odd and eye-upgrade specimen stays within the eye triangle cap of its kind', () => {
  const pool = specimens.filter(s => ['eye-catalogue', 'eye-odd', 'eye-upgrade'].includes(s.group));
  assert.ok(pool.length >= 30);
  const seen = new Set();
  for (const s of pool) {
    const {skin} = s.group === 'eye-catalogue' ? built.get(s.name) : build(decodeComposerRecipe(s.text).recipe);
    seen.add(checkEyeCap(s.name, effective(decodeComposerRecipe(s.text).recipe), skin));
  }
  for (const c of ['lidded', 'insect', 'spider', 'stalk', 'compound', 'eyespotBead', 'eyespotFlat']) assert.ok(seen.has(c), `the pool covers ${c}`);
});
/** The cap class of a built skin, from its built eye types and the recipe's eye rules (never from the triangle count it
 * checks: an eyespot is flat under eyeRules 1 on a worm cap and a bead otherwise); asserts the cap and returns the class. */
function checkEyeCap(name, recipe, skin) {
  const types = skin.debug.eyes.map(e => e.type), eyeTris = skin.parts.filter(p => p.part === 'eyes').reduce((n, p) => n + p.triangles, 0);
  const rules = resolveComposerEyes(recipe).rules;
  const cap = types.includes('insect') ? 'insect' : types.length === 8 ? 'spider' : types[0] === 'stalk' ? 'stalk' : types[0] === 'compound' ? 'compound'
    : types[0] === 'eyespot' ? (rules === 1 ? 'eyespotFlat' : 'eyespotBead') : LIDDED_KINDS.has(types[0]) ? 'lidded' : null;
  assert.ok(cap, `${name}: no cap for built types ${types}`);
  assert.ok(eyeTris > 0 && eyeTris <= EYE_TRI_CAP[cap], `${name} (${cap}): ${eyeTris} eye triangles > ${EYE_TRI_CAP[cap]}`);
  if (cap === 'lidded') assert.ok(eyeTris / types.length <= 300, `${name}: ${eyeTris / types.length} per lidded eye`);
  return cap;
}
test('the eye triangle caps hold over the sweep of the 13 catalogue kinds on each of their native faces', () => {
  const presetOf = {};
  for (const id of COMPOSER_PRESET_IDS) presetOf[composerPreset(id).head] ??= id;
  let n = 0;
  for (const kind of CATALOGUE_EYE_KINDS) for (const face of EYE_PRESETS[kind].nativeFaces) {
    const id = presetOf[face];
    assert.ok(id, `a preset with a ${face} head`);
    const recipe = effective({...composerPreset(id), eyes: kind, eyeRules: 2});
    const graph = buildComposerGraph(recipe), skin = buildComposerSkin(graph, {debug: true});
    assert.equal(skin.eyeFallbacks, 0, `${kind} on ${face}: eye fallbacks`);
    checkEyeCap(`${kind} on ${face} (${id})`, recipe, skin);
    n++;
  }
  assert.ok(n >= 13);
});

test('camera eyes hug the skull: the orbit ring lies on it and no rim stands in the air as a flap', () => {
  for (const {name, kind} of catalogue) {
    if (EYE_PRESETS[kind].structure !== 'camera') continue;
    const {skin} = built.get(name), soup = skullSoup(skin);
    for (const e of skin.debug.eyes) {
      assert.equal(e.rings.length, 9, name);
      const orbit = ringOff(skin, soup, e, 7), outer = ringOff(skin, soup, e, 6);
      // on the skull, or lifted by the brow shelf's orbit arc
      // (an owl's facial disc edge is lifted a little more, so the skull's midline ridge never shows between the discs)
      const brow = EYE_PRESETS[kind].brow, allow = brow === 'shelf' ? CATALOGUE_EYE.shelf.orbitLift : brow === 'disc' ? CATALOGUE_EYE.disc.lift : 0;
      assert.ok(orbit <= 0.05 + allow, `${name} side ${e.side}: orbit ring ${orbit.toFixed(3)} er off the skull`);
      // the outer lid rises at most a raised orbit's height above the skull (0.6 er); a turret's shoulder its own lift
      // an owl's facial disc is a plate at the eyeball's rim height (CATALOGUE_EYE.disc.plate): never more than the plate
      // above the rim's highest point off the skull
      const cap = kind === 'chameleon' ? COMPOSER_EYE_CATALOGUE.turretShape.lift + 0.05
        : EYE_PRESETS[kind].brow === 'disc' ? Math.max(0.6, ringOff(skin, soup, e, 4) + CATALOGUE_EYE.disc.plate + 0.1) : 0.6;
      assert.ok(outer <= cap, `${name} side ${e.side}: outer lid ${outer.toFixed(3)} er off the skull`);
    }
  }
});

test('no eye crosses the midline; the owl\'s facial discs and the spider\'s front pair keep clear of it', () => {
  for (const {name} of catalogue) {
    const {skin} = built.get(name);
    for (const e of skin.debug.eyes) {
      if (e.side === 0) continue; // an insect's median ocellus sits on the midline by design
      let min = Infinity; for (let i = e.firstVertex; i < e.firstVertex + e.vertexCount; i++) min = Math.min(min, e.side * skin.positions[3 * i + 2]);
      assert.ok(min >= 0, `${name} ${e.type} side ${e.side}: ${(min / e.er).toFixed(2)} er across the midline`);
    }
  }
});

test('gecko: the lidless eye turns into a skull that leans away, so its brille edge stays low and its gaze near the look', () => {
  const {skin, graph} = byKind('gecko'), soup = skullSoup(skin), P = EYE_PRESETS.gecko.placement;
  for (const e of skin.debug.eyes) {
    const brille = ringOff(skin, soup, e, 5);
    assert.ok(brille <= 0.45, `side ${e.side}: brille edge ${brille.toFixed(2)} er off the skull`);
    const look = eyeGaze(P.yawByFace?.[graph.recipe.head] ?? P.yawDeg ?? FACE_EYE_PROFILE[composerEyeProfileId(graph.recipe, 'round')].gazeYawDeg, P.pitchDeg ?? COMPOSER_EYE_PITCH_DEG, e.side);
    const turned = Math.acos(Math.min(1, look[0] * e.gaze[0] + look[1] * e.gaze[1] + look[2] * e.gaze[2])) * 180 / Math.PI;
    assert.ok(turned <= 35, `side ${e.side}: turned ${turned.toFixed(1)} deg from the look`);
  }
});

test('cat: a large eye that turns into the skull at most by the excess over cat.tiltDeg, its rims hugging the skull', () => {
  const {skin, graph} = byKind('cat'), soup = skullSoup(skin), P = EYE_PRESETS.cat.placement, K = COMPOSER_EYE_CATALOGUE.cat;
  for (const e of skin.debug.eyes) {
    const look = eyeGaze(P.yawDeg ?? FACE_EYE_PROFILE[composerEyeProfileId(graph.recipe, 'round')].gazeYawDeg, P.pitchDeg ?? COMPOSER_EYE_PITCH_DEG, e.side);
    const turned = Math.acos(Math.min(1, look[0] * e.gaze[0] + look[1] * e.gaze[1] + look[2] * e.gaze[2])) * 180 / Math.PI;
    assert.ok(turned <= 35, `side ${e.side}: turned ${turned.toFixed(1)} deg from the look`);
    // the lid and outer lid hug the skull (the EC2 review's flaps stood 0.44 and 0.39 er off it)
    for (const k of [5, 6]) { const off = ringOff(skin, soup, e, k); assert.ok(off <= 0.25, `side ${e.side}: ring ${k} ${off.toFixed(2)} er off the skull`); }
  }
});

test('chameleon: turrets stand proud on both sides and look independently', () => {
  const {skin} = byKind('chameleon'), soup = skullSoup(skin), [l, r] = skin.debug.eyes;
  for (const e of [l, r]) {
    const apex = vtx(skin, e.firstVertex), off = dist(apex, closestPointOnSoup(soup, apex).point) / e.er;
    assert.ok(off >= 0.5, `side ${e.side}: apex ${off.toFixed(2)} er proud`);
  }
  // The design's acceptance: the two gazes differ by >= 60 deg (measured 91.6 deg at fauna-composer-eye-2). DEVIATION,
  // documented: the turret axis is the look blended with the skull normal (COMPOSER_EYE_CATALOGUE.turretNormal, so the
  // turret stands up instead of lying along the snout), which breaks the design's "gaze within 3 deg of the preset" and
  // leaves the right turret only ~15 deg off the left one's mirror image (measured 15.0 deg); the threshold below keeps
  // a margin under that measurement rather than sitting on it.
  const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180 / Math.PI;
  assert.ok(angle(l.gaze, r.gaze) >= 60, `the two gazes differ by ${angle(l.gaze, r.gaze).toFixed(1)} deg`);
  const mirrored = [r.gaze[0], r.gaze[1], -r.gaze[2]];
  assert.ok(angle(l.gaze, mirrored) > 12, `the two axes are not mirror images (${angle(l.gaze, mirrored).toFixed(1)} deg)`);
});

test('spider: eight beads in four pairs; insect: a compound pair and three ocelli on the head top', () => {
  const sp = byKind('spider').skin.debug.eyes;
  assert.deepEqual(sp.map(e => e.side), [-1, -1, -1, -1, 1, 1, 1, 1]);
  assert.ok(sp[0].er > 2 * sp[1].er, 'the front pair is the large one');
  const ins = byKind('insect').skin.debug.eyes;
  assert.deepEqual(ins.map(e => e.side), [-1, 1, 0, 0, 0]);
  for (const o of ins.slice(2)) assert.ok(o.er < 0.5 * ins[0].er);
});

test('stalk: the eye tip stands at least 0.4 craniumHeight clear of the skull', () => {
  const {skin, graph} = byKind('stalk'), soup = skullSoup(skin);
  for (const e of skin.debug.eyes) {
    let far = 0; for (let i = e.firstVertex; i < e.firstVertex + e.vertexCount; i++) { const p = vtx(skin, i); far = Math.max(far, dist(p, closestPointOnSoup(soup, p).point)); }
    assert.ok(far >= 0.4 * graph.dims.craniumHeight, `side ${e.side}: ${(far / graph.dims.craniumHeight).toFixed(2)} cH`);
  }
});

// every kind on each of its native faces, juvenile and adult, eight individuals: never a fallback
const FACE_PRESET = {beak: 'bird', jaws: 'dinosaur', muzzle: 'giraffe', 'flat-face': 'ape', blunt: 'worm', mandibles: 'centipede', proboscis: 'trunked-centipede'};
test('sweep: 13 kinds x native faces x maturity {0.3, 1} x individualSeed 1..8 build with zero fallbacks', () => {
  let builds = 0;
  for (const kind of CATALOGUE_EYE_KINDS) for (const face of EYE_PRESETS[kind].nativeFaces) {
    const id = FACE_PRESET[face]; assert.ok(COMPOSER_PRESET_IDS.includes(id), face);
    const base = {...composerPreset(id), eyes: kind, eyeRules: 2};
    for (const maturity of [0.3, 1]) for (let individualSeed = 1; individualSeed <= 8; individualSeed++) {
      const skin = buildComposerSkin(buildComposerGraph(effective({...base, maturity, individualSeed})), {debug: true}), tag = `${kind} on ${face} m${maturity} s${individualSeed}`;
      assert.equal(skin.eyeFallbacks, 0, tag);
      assert.ok(skin.debug.eyes.every(e => e.rimFallbacks === 0), tag);
      assert.equal(skin.debug.eyes.length, expectedTypes(kind).length, tag);
      for (const v of skin.positions) if (!Number.isFinite(v)) assert.fail(`${tag}: non-finite position`);
      builds++;
    }
  }
  assert.equal(builds, 16 * CATALOGUE_EYE_KINDS.reduce((s, k) => s + EYE_PRESETS[k].nativeFaces.length, 0));
});
