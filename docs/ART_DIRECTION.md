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
- Warning chevrons mean an enemy currently threatens a living player.
- Clear-shot and covered-shot lines are thin, secondary guides.
- Overlay graphics must not cover faces, HP, or the weapon silhouette.
- Never show a firing line when the action cannot be afforded.

## Review sizes

- 28 px: minimum-detail/mobile stress case.
- 40 px: normal 12×12 encounter presentation.
- 56 px: detail and shape inspection.

Review the terrain contact sheet, unit lineup, overlay matrix, and generated
encounter at all three sizes before approving a renderer change.
