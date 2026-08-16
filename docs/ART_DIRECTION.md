# Circuit Bored visual direction

## Readability hierarchy

The board should be understood in this order:

1. **Walkable versus blocked:** floor must recede; walls must form a solid,
   high-mass boundary; half cover must occupy less visual height than walls.
2. **Teams and units:** player silhouettes read cool/cyan, enemies warm/red,
   while archetype geometry remains recognizable without colour.
3. **Immediate actions:** selected unit, legal moves, shootable targets, and hit
   chance are stronger than ambient decoration.
4. **Tactical context:** cover edges, enemy threat, overwatch, HP, and AP.
5. **Atmosphere:** seams, vents, pipes, screens, wear, glows, and animation.

Lower levels must never obscure higher levels.

## Terrain rules

- Floor is the darkest and flattest material. Internal detail stays low contrast.
- Walls need a continuous outer mass, a brighter player-facing lip, a dark
  occlusion edge, and a footprint that does not resemble an inset floor panel.
- Half cover can be colourful and object-like, but its occupied area must remain
  consistent across cargo, barricade, and machinery variants.
- Adjacent walls should visually join into structures rather than a collection
  of unrelated square icons.
- Grayscale and squint modes in the visual lab are acceptance tests, not novelty
  filters. If a category disappears in either mode, strengthen shape or value.

## Combat-overlay rules

- One cue, one meaning. Target brackets mean the selected unit can shoot.
- The movement radius is one shaded region of walkable cells, not a ring of
  per-step markers: a bright rim states how far the turn reaches, fainter seams
  divide the action points the walk spends, and closer bands read stronger than
  distant ones. It covers a large share of the board, so it must stay quieter
  than units, cover, threat, and target cues at every cell size.
- Warning chevrons mean an enemy currently threatens a living player.
- Clear-shot and covered-shot lines are thin, secondary guides.
- Overlay graphics must not cover faces, HP, or the weapon silhouette.
- Never show a firing line when the action cannot be afforded.

## Bespoke landmark artwork

- A major feature is drawn as one multi-tile object, not as decorated squares.
  `renderLandmarks.ts` owns that artwork and keys it off stable environment
  metadata: kind, footprint, orientation, sub-variant, and ambient family.
- Landmark artwork is clipped to the wall tiles of its footprint, minus the
  raised lip the tile renderer paints on every edge facing walkable space. The
  bright player-facing lip and the dark occlusion edge therefore survive
  untouched, and artwork can never make floor or half cover look blocked.
- Half cover is excluded from every landmark clip. A cover object keeps its own
  raised silhouette even when it stands inside a landmark footprint.
- The only floor pixels landmark art owns are a soft contact shadow at the
  object's south and east edges. Everything else on the floor belongs to the
  regional treatment system.
- A landmark's artwork is derived from the solid masses actually present in its
  footprint, so the object always lines up with the geometry the generator
  produced. Face detail (a furnace mouth, a vault door) anchors to real
  structure and never lands in a doorway.
- **Classify a landmark's masses by contact with its own footprint edge, never
  by tile count.** A shell, a containment ring, and a corridor wall all reach
  the edge; a core pillar and an interior rack never do. Board mirroring,
  rotation, and connectivity repairs all change how large a mass is and whether
  it stays in one piece, so any size threshold silently drops artwork on real
  generated boards while still looking correct in a hand-built gallery.

## Ambient motion

- Only landmarks animate. Ordinary floor, ordinary walls, and ordinary cover
  are completely still, and that contrast is the point.
- Motion is low frequency (roughly 1.9 s to 4.2 s cycles), localized, and
  attenuated for secondary structures. Blinking beacons are reserved for
  dominant and major features.
- Every ambient value is a pure function of the frame timestamp plus the
  landmark's id, so a given frame always renders identically.
- Ambient motion never encodes gameplay state. If a cue matters tactically it
  belongs to the overlay layer, not to environmental art.
- **Environmental light is capped below unit value.** Heat, coolant, and data
  glows carry their meaning through hue and saturation, never through
  luminance. Every glow in `renderLandmarks.ts` passes through one clamp
  (`MAX_ACCENT_INTENSITY`), because an ambient light that renders brighter than
  a unit puts atmosphere above gameplay in the hierarchy above. Verify it by
  measuring a review capture against the unit lineup, not by eye.
- Two glows must not stack on the same point. Overlapping alphas composite well
  past the cap even when each one respects it.

## Feature hierarchy

- Every generated encounter has exactly one **dominant** feature, at least
  1.25x the footprint of anything else on the board. It anchors the eye, shapes
  routes, and is what the player should remember afterwards.
- **Major** features support the anchor. **Secondary** structures support the
  majors. Small props (crates, barricades, consoles, markers) reinforce a
  zone's function and must never be the reason a board looks interesting.
- Dominant and major features own the space around them through an apron zone:
  a machine service ring, a debris field, or a controlled approach in front of
  a threshold. Cover is placed by function inside that owned space.
- A quiet encounter carries one larger anchor and more negative space; a heavy
  encounter keeps the same anchor and adds supporting context, not density.

## Theme shape language

Geometry, not palette, has to separate the families. These are measured in
`generationAnalysis.ts` and enforced during generation.

- **Foundry**: long aligned runs (a wall run of eight or more), chunky
  asymmetric equipment masses, parallel processing lines, broad service aprons.
- **Data Core**: near-mirror symmetry across the board axis, precise
  compartments with two-tile doors, repeated rack rhythm, controlled
  thresholds.
- **Derelict**: broken outlines that never close, offset masses that slip out
  of alignment, terminating stubs, capped debris that hugs its structure.

## Review sizes

- 28 px: minimum-detail/mobile stress case.
- 40 px: normal detail review for encounters; generated 24×24 maps scroll in the lab rather than shrinking below readability.
- 56 px: detail and shape inspection.

Review the terrain contact sheet, unit lineup, overlay matrix, the three
landmark galleries, and the generated landmark-heavy and quiet encounter
examples at all three sizes before approving a renderer change. Use Semantic
categories to separate generation hierarchy problems from decorative-art
problems: the dominant feature is outlined in orange, majors in yellow, and
secondaries with a dashed white rule.

## Macro identity and restraint

- A generated encounter should be describable by two to four named places. One
  or two major landmarks carry the map silhouette; secondary structures support
  them; the remaining board is allowed to stay calm.
- Ordinary floor never uses isolated glowing rails, conduits, or strips. A
  brighter floor treatment must belong to a generated multi-tile region such as
  a service lane, checkpoint threshold, loading apron, or server hall.
- Regional treatment follows the room or landmark footprint. It must not make
  every enclosed tile equally detailed, and at least half of usable floor should
  remain untreated background in generated encounters.
- Long wall runs read as a single mass. Pipes, panels, brackets, and lights are
  reserved for exposed corners, entrances, and sparse structural intervals.
- Cover is a physical tactical object, not floor decoration: preserve its raised
  silhouette and cluster it around landmark edges, crossings, and defensive
  pockets.
- Quiet space is intentional negative space, not unfinished art. Units,
  highlights, projectile effects, and the landmark silhouette should become
  easier to parse because ordinary terrain recedes.

## Environment families

- Industrial Processing Foundry uses long wall runs, broad lanes, pipe-bank machinery, and functional cargo clusters.
- Data Core Security Complex uses clean orthogonal panels, room partitions, controlled entrances, consoles, and checkpoint cover.
- Derelict Maintenance Salvage Deck uses worn plates, broken wall masses, exposed conduits, salvage piles, and improvised barricades.
- Geometry must identify the family before colour does. Theme palettes may reinforce identity, but floor remains the quietest value, half cover a compact raised object, and walls the strongest connected mass in every family.
