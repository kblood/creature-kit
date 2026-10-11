# Planet Composer contract, 0.8

`planetComposerWorldDefinition` retains the original planetary genome and the
caller-provided individual/species IDs. Its resolved phenotype supplies metre
dimensions, exact coat values, maturity/sex and full-cycle gait distances to
`buildPlanetComposerSource`. Recipe categories select anatomy; resolved dimensions
prevent another application of seeded variation or maturity scaling. Graph fit
metadata records requested and constructed dimensions and derived gait ratios.

Patch 0.8.1 corrects the terrain rotation pivot: pose revision 3 rotates the
local root offset and orientation together before adding external ground height.
The old pivot could leave a planted hoof 13.755 mm above even a shallow plane.
The captured regression retains the original genome, graph, source arrays and
world footholds. Default poses without terrain environment remain unchanged.

Patch 0.8.2 adds pose revision 4's explicit `supportHeight: 'reachable-1'` terrain
mode. It intersects the actual two-bone reach intervals for every leg, including
swing targets, and chooses the nearest feasible support height before refitting
FK. World footholds, canonical X/Z and source geometry remain unchanged. The
diagnostic reports the interval, height correction and feasibility; unreachable
requests remain explicit. This corrects the captured padded-foot walk failures
without introducing a family-specific offset or changing default Lab poses.

`buildPlanetComposerSource` and `createPlanetComposerAnimal` use the same source
builder as ordinary Composer authoring. Source revision 2 includes the corrected
gait units and juvenile coat layers. `posePlanetComposer` revision 4 uses the
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

Anatomy LOD revision 1 protects paw/hoof sole joins, trunk sections and selected
facial extrema with bounded shared constraints. Both runtime and realism-1 GLB
export use `composerAnatomyLodConstraints(skin, graph)`. Reduction can stop above
the requested triangle count when protected anatomy prevents further collapse;
the reported actual count is authoritative. A distant tier remains visibly
simplified in enlarged close-up review and is not a substitute for the near mesh.

Historical quadruped geometry/pose and the old inspector remain compatibility
exports and preserved archives. They do not participate in the Composer builder.
Historical recipe links and skin-5 fixtures remain pinned.

This is a code-native deterministic migration, with no model download, checkpoint,
new generated third-party asset or changed licence. Existing provenance is retained.
Core/Lab regression, independent dated geometry, anatomical LOD and desktop browser
evidence are separate gates. Physical headset performance remains unverified;
procedural creatures retain their experimental status.
