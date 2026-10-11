# Planet genomes built by Composer

The new definition carries a planet's existing specimen into the same Composer
graph, skin and actor factory used by the advanced Animal Lab. It does not select
a preset, generate a replacement species, or retain the old quadruped mesher.
The historical planetary APIs remain available for explicit compatibility.

```ts
import {
  planetComposerDefinition, buildPlanetComposerSource,
  createPlanetComposerAnimal, serializePlanetComposerDefinition,
  parsePlanetComposerDefinition, measurePlanetComposerSource,
} from 'creature-kit/planet';

const definition = planetComposerDefinition(member.genome, {
  individualId: member.id, speciesId: member.speciesId,
});
const source = buildPlanetComposerSource(definition); // worker: graph + skin6
const animal = createPlanetComposerAnimal(definition); // Lab / actor
const replay = parsePlanetComposerDefinition(serializePlanetComposerDefinition(definition));
const measured = measurePlanetComposerSource(source, animal.update('walk', .37));
```

`PlanetComposerDefinition` uses schema `planet-composer-definition-1`. It contains
a frozen clone of the original genome, recipe v4, `ComposerBuildPhenotype`, and a
mapping ledger. The recipe supplies categorical anatomy. The phenotype supplies
already resolved metres, source IDs, full-precision `CoatGenome`, growth metadata,
coat-frame offsets, roughness, and desired walk speed/stride. Recipe-only links
cannot reproduce this input: share/import the complete versioned definition.
Imported categorical edits retain the source genome as provenance. Modify the
phenotype's metre/coat fields to edit resolved measurements and pigmentation.

`buildComposerSource(recipe, {phenotype, presentation})` is the shared source
function used by `createComposerCreature`; the planetary wrappers delegate to
those functions. The worker path allocates no actor, material or GPU object.
Planet wrappers explicitly default to `realism-1`; the standard factory retains
its historical skin5 default. Every generated graph carries the optional
`fauna-composer-phenotype-1` metadata. Model-space pose and skin contracts are
unchanged. Cache keys must include the whole recipe and phenotype, presentation,
and source version (`planet-composer-source-1`), not just the recipe text or ID.

The source genome already includes individual variation, sex and juvenile growth.
The companion recipe therefore uses neutral individual controls. Applying another
maturity/variation derivation to resolved anatomy fails explicitly. Source IDs
remain intact and separate from Composer's anatomical classification hash.
Existing v1–v4 recipe decoding, neutral skin5 fixture hashes, and unextended GLB
bytes remain unchanged.

The mapping has explicit limits. Full torso and head diameters become Composer
section half-extents. The old neck fields define a vector, so the migration uses
forward `.35 × neckLength` and rise `neckRise + .66 × neckLength`, preserving that
vector as a centreline length and angle. Feet preserve the requested lateral
width; skin6 hoof/pad feet share the complete 16-vertex ankle seam and weights.
Composer shapes the head, muzzle, body lobes and appendages. Armor amount selects
presence rather than reproducing the old plate-area fraction. Coat roles and
pattern seed are exact; their coverage follows the new surface and its torso
frame. Legacy inputs with only two hex colours use a disclosed fixed role
conversion, never an invented palette seed.

The leg solver may lengthen an unsafe leg and shorten an inherited stride.
Generated constraints and `measurePlanetComposerSource` distinguish requested
dimensions, actual graph dimensions/limb lengths, and actual generated or posed
vertex bounds. The reviewed 12-body corpus uses 38–72% of its inherited stride;
cadence adjusts to retain inherited walk speed. Source run speed and mutation
history remain in the source genome. These are intentional Composer gait changes,
not a claim of visual or animation parity with the retired rig.

GLB replay uses the same `exportCreatureGlb(definition.recipe, {phenotype:
definition.phenotype, presentation: 'realism-1'})` path. Both the report and GLB
asset extras include the complete phenotype and its version, including source
IDs and exact coat roles. Recipe text alone is labelled insufficient above.

Validation covers six morphology families at adult and juvenile stages: 12,608–
19,116 source triangles and 24–34 bones; JSON replay, source and Lab arrays/poses
are exact. Across 768 actual planted-foot and 384 swing observations, hoof/pad
sole gaps are roundoff-only, paw gaps peak at 0.661 mm, and penetration is below
1.4e-16 m. Foot widths match within 1 µm. These are full-source flat-ground checks;
terrain integration, reduced-LOD visual review and physical Quest acceptance
remain separate runtime gates.
