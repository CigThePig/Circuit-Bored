# Circuit Bored agent workflow

## Visual work

Before changing `src/render.ts`, open the real-renderer laboratory:

```bash
npm run dev:visual
```

The page is `/visual-lab.html`. It is a separate development surface and must
not acquire game rules. Its canonical scenes live in `tools/visual-scenes.ts`.

Use the lab in this order:

1. Normal mode at 40 px: judge the intended presentation.
2. Grayscale: confirm floor, half cover, and walls remain distinct by value.
3. Squint: confirm the major silhouettes remain distinct when detail is lost.
4. 28 px and 56 px: check the practical small and large cell sizes.
5. Export a contact sheet and compare it with the previous version when a
   browser or screenshot-capable tool is available.

Wall tiles must read as impassable before their internal decoration is read.
Do not rely on colour alone for gameplay meaning. Preserve the hierarchy in
`docs/ART_DIRECTION.md`.

Bespoke landmark artwork lives in `src/renderLandmarks.ts` and is reviewed
through the three landmark gallery scenes. When adding a landmark family, add
it to `LANDMARK_KINDS`, give it a painter in `generationLandmarks.ts`, an art
entry in `renderLandmarks.ts`, and a slot in the matching gallery; the visual
lab test fails if any kind lacks artwork or a gallery example.

## Validation

Run focused visual checks while iterating:

```bash
npm run check:visual
npm run typecheck
```

Before publishing, run:

```bash
npm run check
```

The GitHub Pages build includes the lab as a second entry point, but the game
does not link to it. Keep production gameplay in `index.html` and `src/`.

## Change discipline

- Prefer deterministic canvas art for board elements that react to game state.
- Keep visual-only metadata out of saves unless variation truly needs state.
- Add a canonical lab example for every new unit, terrain family, overlay, or
  landmark family.
- Landmark artwork may only draw on wall tiles inside its own footprint. Never
  paint gameplay-bearing information into environmental art.
- Ambient motion belongs to landmarks only and must stay a pure function of the
  frame timestamp.
- Never make the lab's hand-authored overlays a source of gameplay truth.
- Keep mobile readability at a 28 px cell size; decorative detail may disappear,
  but walls, cover, units, targets, HP, and AP must remain recognizable.
