// Composer gait and individual rig (fauna-composer-graph-2, WP4 of the 2026-10-02 fauna round).
// Every measurement is taken from posed bone transforms (positions, quaternions, radial scale) or rest bones, never
// from pose.diagnostics. Baselines quoted below were measured at graph-1 (0a6fd24) with the same method.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {COMPOSER_GRAPH_VERSION, buildComposerGraph, poseComposer} from '../src/fauna-composer-rig.ts';
import {COMPOSER_PRESETS, COMPOSER_V2_DEFAULTS, decodeComposerRecipe, normalizeComposerRecipe, randomComposerRecipe} from '../src/fauna-composer-recipe.ts';
import {composerIndividualTraits, deriveComposerIndividual} from '../src/fauna-composer-individual.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/composer-v1-links.json', import.meta.url), 'utf8'));
/** The animal createComposerCreature builds: the individual derived from a species recipe. */
const effective = recipe => deriveComposerIndividual(normalizeComposerRecipe(recipe).recipe).recipe;
const graphOf = recipe => buildComposerGraph(effective(recipe));
const pos = (p, i) => new THREE.Vector3().fromArray(p.positions, i * 3);
const quat = (p, i) => new THREE.Quaternion().fromArray(p.quaternions, i * 4);
const local = (p, i, v) => new THREE.Vector3(...v).applyQuaternion(quat(p, i)).add(pos(p, i));
const legsOf = g => g.limbs.filter(l => l.kind === 'leg');
const legName = l => `${l.side < 0 ? 'L' : 'R'}${l.front ? 'F' : 'H'}`;
/** Sole point of a leg in the display frame (part of the rotating foot frame). */
const sole = (p, l) => local(p, l.bones.at(-1), [0, -l.footHeight, 0]);
const stanceOf = (p, l) => p.contacts.find(c => c.limb === l.index).stance;
const deg = r => r * 180 / Math.PI;
const wrap = x => ((x % 1) + 1) % 1;
const circ = (a, b) => { const d = wrap(a - b); return Math.min(d, 1 - d); };
const corr = (a, b) => { const m = x => x.reduce((s, v) => s + v, 0) / x.length, ma = m(a), mb = m(b); let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; } return ab / Math.sqrt(aa * bb); };

const report = {version: 1, graph: COMPOSER_GRAPH_VERSION, measurements: {}};
const output = path.resolve('test-results/fauna-composer-gait/report.json');
after(() => { mkdirSync(path.dirname(output), {recursive: true}); writeFileSync(output, JSON.stringify(report, null, 1)); });

/** Touchdown instants (cycle units, [0, 1)) of every leg, from sole heights: the first sample where a raised sole is back on the floor. */
function touchdowns(g, steps = 800) {
  const L = g.locomotion, legs = legsOf(g), out = new Map();
  let prev = null;
  for (let k = 0; k <= 2 * steps && out.size < legs.length; k++) {
    const t = k / steps * L.period, p = poseComposer(g, 'walk', t), ys = legs.map(l => sole(p, l).y);
    if (prev && k > steps / 2) legs.forEach((l, j) => { if (!out.has(l.index) && prev[j] > 1e-9 && Math.abs(ys[j]) <= 1e-9) out.set(l.index, wrap(t / L.period)); });
    prev = ys;
  }
  return legs.map(l => ({leg: legName(l), side: l.side, front: l.front, limb: l.index, cycle: out.get(l.index)}));
}
/** Leg names in touchdown order starting at the left hind, with the gaps between them. */
function sequence(g) {
  const td = touchdowns(g).filter(x => x.leg.length === 2 && legsOf(g).find(l => l.index === x.limb).pair <= 1);
  const lh = td.find(x => x.leg === 'LH').cycle;
  const sorted = td.map(x => ({...x, rel: wrap(x.cycle - lh + 1e-9)})).sort((a, b) => a.rel - b.rel);
  return {order: sorted.map(x => x.leg), rel: sorted.map(x => +x.rel.toFixed(4))};
}

test('graph-4 carries the traits of the recipe it built', () => {
  assert.equal(COMPOSER_GRAPH_VERSION, 'fauna-composer-graph-4');
  for (const seed of [0, 3]) {
    const g = graphOf({...COMPOSER_PRESETS.giraffe, individualSeed: seed});
    assert.deepEqual(g.traits, composerIndividualTraits(g.recipe));
  }
});

test('footfall: quadrupeds walk a lateral sequence, primate-like quadrupeds the diagonal sequence', () => {
  const lateral = ['LH', 'LF', 'RH', 'RF'], diagonal = ['LH', 'RF', 'RH', 'LF'], rows = [];
  const check = (id, recipe, expected) => {
    const s = sequence(graphOf(recipe)); rows.push({id, ...s});
    assert.deepEqual(s.order, expected, `${id}: ${s.order.join(' ')} @ ${s.rel.join(' ')}`);
    s.rel.forEach((r, i) => assert.ok(Math.abs(r - i * 0.25) < 0.01, `${id}: footfall ${s.order[i]} at ${r}, expected ${i * 0.25}`));
  };
  for (const id of ['giraffe', 'rhinoceros', 'winged-ape-rhino']) for (const seed of [0, 1, 7]) check(`${id}#${seed}`, {...COMPOSER_PRESETS[id], individualSeed: seed}, lateral);
  // an ape walking on all fours on its grasping hands
  check('ape-quadruped', {...COMPOSER_PRESETS.ape, layout: 'quadruped', posture: 0.3}, diagonal);
  check('ape-quadruped-no-arms', {...COMPOSER_PRESETS.ape, layout: 'quadruped', arms: 'none', posture: 0.3}, diagonal);
  report.measurements.footfall = rows;
});

/** Exact liftoff/touchdown times of a leg (bisection on the stance label), then foot velocities from bone positions. */
function swingProfile(g, l, grid) {
  const L = g.locomotion, Ts = (1 - L.duty) * L.period, n = 400, flag = t => stanceOf(poseComposer(g, 'walk', t), l);
  const edges = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n + 0.5) * L.period, b = ((k + 1) / n + 0.5) * L.period, fa = flag(a), fb = flag(b);
    if (fa === fb) continue;
    let lo = a, hi = b; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (flag(m) === fa) lo = m; else hi = m; }
    edges.push({t: hi, liftoff: fa});
  }
  const liftoff = edges.find(e => e.liftoff).t, touchdown = edges.find(e => !e.liftoff && e.t > liftoff)?.t ?? edges.find(e => !e.liftoff).t + L.period;
  const world = t => { const p = poseComposer(g, 'walk', t); return sole(p, l).add(new THREE.Vector3(p.travel, 0, 0)); };
  const h = Ts * 1e-4, vel = t => world(t + h).sub(world(t - h)).multiplyScalar(1 / (2 * h));
  let start = 0, end = 0, endVy = 0;
  for (let i = 0; i <= 10; i++) {
    const f = 0.002 + 0.016 * i / 10;
    const a = vel(liftoff + f * Ts), b = vel(touchdown - f * Ts);
    start = Math.max(start, Math.hypot(a.x, a.z)); end = Math.max(end, Math.hypot(b.x, b.z)); endVy = Math.max(endVy, Math.abs(b.y));
  }
  // baseline method (probe.mjs): the 1/400-period step from the last swing sample into stance
  let stepVy = 0, prev = null;
  for (const p of grid) { const s = {stance: stanceOf(p, l), y: sole(p, l).y}; if (prev && !prev.stance && s.stance) stepVy = Math.max(stepVy, Math.abs((s.y - prev.y) / (L.period / 400))); prev = s; }
  return {swingTime: Ts, startSpeed: start / L.speed, endSpeed: end / L.speed, touchdownVyLast2: endVy, touchdownVyStep: stepVy, measuredSwing: (touchdown - liftoff) / Ts};
}

test('swing: the foot leaves and meets the ground at rest, and lands softly', () => {
  const baseline = {dinosaur: 0.8189, giraffe: 0.8889, rhinoceros: 0.6749}, rows = [];
  for (const [id, recipe] of Object.entries(COMPOSER_PRESETS)) {
    if (recipe.layout === 'limbless') continue;
    for (const seed of [0, 7]) {
      const g = graphOf({...recipe, individualSeed: seed}), grid = [];
      for (let k = 0; k <= 800; k++) grid.push(poseComposer(g, 'walk', k / 400 * g.locomotion.period));
      for (const l of legsOf(g).slice(0, 4)) {
        const s = swingProfile(g, l, grid); rows.push({id, seed, leg: legName(l), ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(4)]))});
        assert.ok(Math.abs(s.measuredSwing - 1) < 1e-3, `${id}#${seed} ${legName(l)}: swing lasts ${s.measuredSwing} x (1 - duty) x period`);
        assert.ok(s.startSpeed <= 0.1, `${id}#${seed} ${legName(l)}: world foot speed ${s.startSpeed.toFixed(3)} x body speed in the first 2% of swing`);
        assert.ok(s.endSpeed <= 0.1, `${id}#${seed} ${legName(l)}: world foot speed ${s.endSpeed.toFixed(3)} x body speed in the last 2% of swing`);
        if (baseline[id] !== undefined) {
          assert.ok(s.touchdownVyStep <= 0.25 * baseline[id], `${id}#${seed} ${legName(l)}: touchdown vertical speed ${s.touchdownVyStep.toFixed(3)} m/s (baseline ${baseline[id]})`);
          assert.ok(s.touchdownVyLast2 <= 0.25 * baseline[id], `${id}#${seed} ${legName(l)}: vertical speed ${s.touchdownVyLast2.toFixed(3)} m/s in the last 2% of swing (baseline ${baseline[id]})`);
        }
      }
    }
  }
  report.measurements.swing = rows;
});

test('foot pitch turns smoothly: at most 4 deg per 1/400 cycle on every non-spike foot', () => {
  const rows = [];
  for (const [id, recipe] of Object.entries(COMPOSER_PRESETS)) {
    if (recipe.layout === 'limbless' || recipe.feet === 'spike') continue;
    for (const seed of [0, 7]) {
      const g = graphOf({...recipe, individualSeed: seed}), legs = legsOf(g).slice(0, 4);
      let worst = 0, prev = null;
      for (let k = 0; k <= 800; k++) {
        const p = poseComposer(g, 'walk', k / 400 * g.locomotion.period), qs = legs.map(l => quat(p, l.bones.at(-1)));
        if (prev) qs.forEach((q, j) => { worst = Math.max(worst, q.angleTo(prev[j])); });
        prev = qs;
      }
      rows.push({id, seed, maxStepDeg: +deg(worst).toFixed(3)});
      assert.ok(deg(worst) <= 4, `${id}#${seed}: foot turns ${deg(worst).toFixed(2)} deg in 1/400 cycle (baseline 16-25)`);
    }
  }
  report.measurements.footPitch = rows;
});

test('arms: small arms are held still, upright grasping arms swing against the same-side leg', () => {
  const handInCarrier = (g, l, p) => pos(p, l.bones[2]).sub(pos(p, l.socketBone)).applyQuaternion(quat(p, l.socketBone).invert());
  // dinosaur: the hand stays put relative to the body bone that carries the shoulder
  for (const seed of [0, 7]) {
    const g = graphOf({...COMPOSER_PRESETS.dinosaur, individualSeed: seed}), arm = g.limbs.find(l => l.kind === 'arm' && l.side < 0);
    const box = new THREE.Box3();
    for (let k = 0; k <= 400; k++) box.expandByPoint(handInCarrier(g, arm, poseComposer(g, 'walk', k / 200 * g.locomotion.period)));
    const range = box.getSize(new THREE.Vector3()).length();
    (report.measurements.arms ??= []).push({id: `dinosaur#${seed}`, handTravel_m: +range.toFixed(5)});
    assert.ok(range <= 0.02, `dinosaur#${seed}: small arm hand moves ${range.toFixed(4)} m during the walk (baseline 0.128)`);
  }
  // ape: the left hand is furthest back when the left foot touches down
  for (const seed of [0, 1, 7]) {
    const g = graphOf({...COMPOSER_PRESETS.ape, individualSeed: seed}), L = g.locomotion;
    const arm = g.limbs.find(l => l.kind === 'arm' && l.side < 0), foot = legsOf(g).find(l => l.side < 0);
    const td = touchdowns(g).find(x => x.limb === foot.index).cycle;
    let back = Infinity, at = 0;
    for (let k = 0; k < 800; k++) {
      const t = k / 800 * L.period, p = poseComposer(g, 'walk', t), x = pos(p, arm.bones[2]).x - pos(p, arm.bones[0]).x;
      if (x < back) { back = x; at = wrap(t / L.period); }
    }
    const off = circ(at, td);
    report.measurements.arms.push({id: `ape#${seed}`, leftTouchdown: +td.toFixed(4), leftHandBack: +at.toFixed(4), offsetCycles: +off.toFixed(4)});
    assert.ok(off <= 0.05, `ape#${seed}: left hand furthest back at cycle ${at.toFixed(3)}, left touchdown at ${td.toFixed(3)}`);
  }
});

test('many-legged: every knee of a non-arthropod many-legged body bends the same way', () => {
  const cases = [['trunked-centipede', COMPOSER_PRESETS['trunked-centipede']],
    ...['pillar', 'plantigrade', 'digitigrade', 'unguligrade'].map(legs => [`many-${legs}`, {...COMPOSER_PRESETS['trunked-centipede'], legs, legPairs: 9}])];
  for (let i = 0; cases.length < 12 && i < 400; i++) { const r = randomComposerRecipe(`gait-many-${i}`); if (r.layout === 'many-legged' && r.legs !== 'arthropod') cases.push([`random-${i}`, r]); }
  const rows = [];
  for (const [id, recipe] of cases) {
    const g = graphOf(recipe), signs = new Set(), offsets = [];
    for (const [motion, time] of [['neutral', 0], ['walk', 0.31], ['walk', 0.77]]) {
      const p = poseComposer(g, motion, time);
      for (const l of legsOf(g)) {
        const a = pos(p, l.bones[0]), k = pos(p, l.bones[1]), c = pos(p, l.bones[2]);
        const off = k.x - (a.x + c.x) / 2; if (motion === 'neutral' && l.side < 0) offsets.push(+off.toFixed(4));
        if (Math.abs(off) > 1e-6) signs.add(Math.sign(off));
      }
    }
    rows.push({id, legs: g.recipe.legs, pairs: g.recipe.legPairs, kneeOffsetsLeft: offsets});
    assert.equal(signs.size, 1, `${id}: knee offsets change sign along the body ${offsets.join(' ')}`);
  }
  report.measurements.manyLegged = rows;
});

test('idle: the head looks around about the vertical, and breathing slows with size', () => {
  const yawRange = g => { let lo = Infinity, hi = -Infinity; for (let k = 0; k <= 300; k++) { const x = new THREE.Vector3(1, 0, 0).applyQuaternion(quat(poseComposer(g, 'idle', k * 0.1), g.chains.head)); const y = Math.atan2(x.z, x.x); lo = Math.min(lo, y); hi = Math.max(hi, y); } return deg(hi - lo); };
  const breathing = g => { const bi = g.chains.torso[0], ups = []; let prev = null; for (let k = 0; k <= 2400; k++) { const t = k * 0.0125, s = poseComposer(g, 'idle', t).radialScale[bi] - 1; if (prev !== null && prev < 0 && s >= 0) ups.push(t); prev = s; } return (ups.at(-1) - ups[0]) / (ups.length - 1); };
  const giraffe = graphOf(COMPOSER_PRESETS.giraffe), yaw = yawRange(giraffe);
  const bird = breathing(graphOf(COMPOSER_PRESETS.bird)), rhino = breathing(graphOf(COMPOSER_PRESETS.rhinoceros));
  report.measurements.idle = {giraffeHeadYawRangeDeg: +yaw.toFixed(2), breathPeriod: {bird: +bird.toFixed(3), rhinoceros: +rhino.toFixed(3)}};
  assert.ok(yaw >= 15, `giraffe idle head yaw range ${yaw.toFixed(1)} deg (baseline 6.3)`);
  assert.ok(rhino > bird * 1.4, `breathing period bird ${bird.toFixed(2)} s, rhinoceros ${rhino.toFixed(2)} s`);
  for (const [id, period] of [['bird', bird], ['rhinoceros', rhino]]) {
    const expected = 3.4 * Math.min(1.8, Math.max(0.6, graphOf(COMPOSER_PRESETS[id]).dims.bodyLength ** 0.25));
    assert.ok(Math.abs(period - expected) < 0.02, `${id}: breathing period ${period} s, expected ${expected}`);
  }
});

test('desync: a herd does not walk in lockstep, and the type specimen keeps phase 0', () => {
  const herd = []; for (let s = 1; s <= 12; s++) herd.push(graphOf({...COMPOSER_PRESETS.giraffe, individualSeed: s}));
  const T = 4 * graphOf(COMPOSER_PRESETS.giraffe).locomotion.period, n = 480;
  const series = herd.map(g => { const lh = legsOf(g).find(l => !l.front && l.side < 0), ys = []; for (let k = 0; k < n; k++) ys.push(sole(poseComposer(g, 'walk', k / n * T), lh).y); return ys; });
  const cs = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) cs.push(corr(series[i], series[j]));
  const below = cs.filter(c => c < 0.9).length;
  report.measurements.desync = {pairs: cs.length, below09: below, fraction: +(below / cs.length).toFixed(3), maxCorrelation: +Math.max(...cs).toFixed(3), phases: herd.map(g => +g.traits.motion.phase.toFixed(3)), periods: herd.map(g => +g.locomotion.period.toFixed(3))};
  assert.ok(below / cs.length >= 0.8, `${below}/${cs.length} herd pairs below correlation 0.9`);
  // seed 0: no phase offset, so the left hind foot touches down at t = 0 (cycle 0)
  const g0 = graphOf(COMPOSER_PRESETS.giraffe);
  assert.equal(g0.traits.motion.phase, 0);
  const lh = touchdowns(g0).find(x => x.leg === 'LH').cycle;
  assert.ok(circ(lh, 0) < 2e-3, `type specimen left-hind touchdown at cycle ${lh}`);
});

test('allometry: heavier animals get proportionally thicker limbs', () => {
  const ratio = (allometry, bodyLength) => { const g = graphOf({...COMPOSER_PRESETS.giraffe, allometry, bodyLength}), leg = legsOf(g).find(l => !l.front); return g.bones[leg.bones[1]].start.h / g.dims.legReach; };
  const rows = {};
  for (const a of [0, 1]) for (const L of [1, 4]) rows[`allometry ${a}, ${L} m`] = ratio(a, L);
  report.measurements.allometry = rows;
  assert.ok(rows['allometry 1, 4 m'] >= 1.12 * rows['allometry 1, 1 m'], JSON.stringify(rows));
  assert.ok(Math.abs(rows['allometry 0, 4 m'] / rows['allometry 0, 1 m'] - 1) < 1e-9, JSON.stringify(rows));
});

test('neutral identity: neutral recipes build the graph-1 rest skeleton bit for bit', () => {
  // Pinned at 0a6fd24 (graph-1, unchanged since b8c00bf). The front-half legs of a non-arthropod many-legged body are
  // excluded: graph-2 gives every pair the same knee pole (the documented many-legged fix).
  const list = Object.entries(COMPOSER_PRESETS).map(([id, r]) => [`preset:${id}`, {...r, ...COMPOSER_V2_DEFAULTS}]);
  for (let i = 0; i < 12; i++) list.push([`random:${i}`, randomComposerRecipe(`independent-rig-${i}`)]);
  for (const e of [...fixture.fixtureSeeds, ...fixture.extremes, ...fixture.wild]) list.push([e.text, {...decodeComposerRecipe(e.text).recipe, ...COMPOSER_V2_DEFAULTS}]);
  const restDigest = g => {
    const skip = new Set(g.recipe.layout === 'many-legged' && g.recipe.legs !== 'arthropod' ? g.limbs.filter(l => l.kind === 'leg' && l.front).flatMap(l => l.bones) : []);
    const h = createHash('sha256');
    for (const b of g.bones) if (!skip.has(b.index)) h.update(new Float64Array([...b.restPosition, ...b.restQuaternion, ...b.offset, ...b.restLocal, b.length, b.parent]));
    return h.digest('hex');
  };
  const per = list.map(([id, r]) => { const recipe = normalizeComposerRecipe(r).recipe, g = buildComposerGraph(recipe); assert.equal(g.traits.neutral, true, id); return restDigest(g); });
  assert.equal(per.length, 435);
  // Face round repin (fauna-composer-face-1, base a9e3654): was 616ab685f50894fc620ff95a321ebf2daccc55b0e33aee23500b7888ffbe0a66.
  // Exactly 81 of the 435 rest digests changed and all 81 are dropped trunks (a trunk drawn or linked on a non-muzzle face:
  // 78 legacy texts + 3 random draws), compared recipe by recipe against a9e3654; the other 354 are bit-identical.
  // Face round WP5 repin (graph-3, fauna-composer-face-geometry-1, base 179485c): was 3710768dc6ea90ad8bace030f75e0a5ed997d50faf6ae8f8cf9ac411a94e407e.
  // Exactly 17 of the 435 rest digests changed and all 17 are proboscis faces (own head proportions; the trunk grows from
  // the muzzle tip station along the head axis, its bone frames keep +Z lateral past vertical), compared recipe by recipe against 179485c; the other 418 are bit-identical.
  // Eye round EC4 repin (graph-4, fauna-composer-face-geometry-2, base d403279): was 5bac90d9db270f0b9191b80e5038c1df9403c3fe17989f855ba45c79fe55d4a9.
  // Exactly 44 of the 435 rest digests changed, compared recipe by recipe against d403279; the other 391 are bit-identical:
  // 17 proboscis faces (shorter trunk, fast taper from a thicker base, hanging rest shape with a J curl clear of the
  // ground) and 30 limbless or many-legged bodies with arms (the arms rest beside and behind the head, AXIAL_ARM_REST),
  // 3 recipes being both (recounted after the a13 trunk widening: still 44, all explained).
  assert.equal(createHash('sha256').update(per.join('')).digest('hex'), 'd511c141bdbb9795e7a346b47629d8321484f55c2363515af64a1f18ec6fa269');
  const presets = {dinosaur: '5ca42245ef7eb62a', turtle: '71aec60226a20f4e', giraffe: 'f0f50d9d7a17e692', bird: '077f406187aae8b6', ostrich: '1739d106b47409a7', rhinoceros: '5ba09676464c8b12',
    ape: '285e7a12f65178dc', worm: '480f8d770ed23553', centipede: 'f4cba80e3fac0914', 'shelled-giraffe-bird': '4570c2077e2a062d', 'trunked-centipede': '2f966be2032497a2', 'winged-ape-rhino': 'f83279ddbffb2dd6'};
  Object.keys(COMPOSER_PRESETS).forEach((id, i) => assert.equal(per[i].slice(0, 16), presets[id], id));
});

test('individuals differ in carriage, belly line, leg proportions and limb build', () => {
  const herd = []; for (let s = 1; s <= 12; s++) herd.push(graphOf({...COMPOSER_PRESETS.giraffe, individualSeed: s}));
  const elevation = (g, i) => { const b = g.bones[i], x = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...b.restQuaternion)); return Math.atan2(x.y, Math.hypot(x.x, x.z)); };
  const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
  // ventral line at mid-body relative to the torso depth (independent of the animal's size)
  const belly = g => { const b = g.bones[g.chains.torso[2]], s = b.start; return (s.h - s.yc) / g.dims.torsoHeight; };
  const leg = g => { const l = legsOf(g).find(x => !x.front); return l.segments[0] / l.segments.reduce((a, b) => a + b, 0); };
  const stats = {
    neckElevationSdDeg: deg(sd(herd.map(g => elevation(g, g.chains.neck[0])))), headPitchSdDeg: deg(sd(herd.map(g => elevation(g, g.chains.head)))),
    tailDroopSdDeg: deg(sd(herd.map(g => elevation(g, g.chains.tail[0])))), bellyDepthSd: sd(herd.map(belly)), thighFractionSd: sd(herd.map(leg)),
    legRadiusOverReachSd: sd(herd.map(g => g.dims.legRadius / g.dims.legReach)) / (herd.reduce((a, g) => a + g.dims.legRadius / g.dims.legReach, 0) / herd.length),
  };
  report.measurements.individuals = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, +v.toFixed(4)]));
  assert.ok(stats.neckElevationSdDeg > 2, JSON.stringify(stats));
  assert.ok(stats.tailDroopSdDeg > 2, JSON.stringify(stats));
  assert.ok(stats.bellyDepthSd > 0.02, JSON.stringify(stats));
  assert.ok(stats.thighFractionSd > 0.005, JSON.stringify(stats));
  assert.ok(stats.legRadiusOverReachSd > 0.02, JSON.stringify(stats));
});
