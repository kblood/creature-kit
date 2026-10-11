# Planet Composer contract, 0.8

`planetComposerWorldDefinition` retains the original planetary genome and the
caller-provided individual/species IDs. Its resolved phenotype supplies metre
dimensions, exact coat values, maturity/sex and full-cycle gait distances to
`buildPlanetComposerSource`. Recipe categories select anatomy; resolved dimensions
prevent another application of seeded variation or maturity scaling. Graph fit
metadata records requested and constructed dimensions and derived gait ratios.

`buildPlanetComposerSource` and `createPlanetComposerAnimal` use the same source
builder as ordinary Composer authoring. Source revision 2 includes the corrected
gait units and juvenile coat layers. `posePlanetComposer` revision 2 uses the
caller's canonical dated orbit/activity and ground samples, with fixed stance
footholds and heading, smooth swing, and continuous stop/resume transitions.
The caller retains world generation, populations, navigation and time controls.

Animal Lab accepts the complete serialized definition in its URL fragment or a
JSON file. Visual metre and coat controls edit the resolved phenotype; recipe
controls edit anatomy. Detaching the planetary definition is an explicit action.
Comparison and GLB export use the selected side's complete definition.

Source identities include code, presentation, source, graph, skin and LOD contract
revisions. Compact cache keys are checked against canonical serialized definition
text at admission; they are not cryptographic proofs. Worker transport and runtime
storage are consumer responsibilities. Atlas verifies complete source receipts and
packs only runtime arenas; original float source and GLB data remain available.

Historical quadruped geometry/pose and the old inspector remain compatibility
exports and preserved archives. They do not participate in the Composer builder.
Historical recipe links and skin-5 fixtures remain pinned.

This is a code-native deterministic migration, with no model download, checkpoint,
new generated third-party asset or changed licence. Existing provenance is retained.
Core/Lab regression, independent dated geometry, anatomical LOD and desktop browser
evidence are separate gates. Physical headset performance remains unverified;
procedural creatures retain their experimental status.
