# Circuit Bored agent workflow

## Visual work

**Passing renderer tests does not prove visual quality.**

**Do not infer that a visual change works merely because the rendering code
logically implements it.** Renderer changes routinely compile, typecheck, pass
every assertion, and still look wrong. The only evidence that a visual change
worked is the rendered pixels.

You do not need a human, a browser window, or a screenshot tool to get that
evidence. Run the pipeline and open the files it writes:

```bash
npm run visual:review
```

It renders the canonical scenes with the production renderer in a local
headless Chromium, renders the same scenes from the base commit, diffs them,
and writes ordinary PNGs into `artifacts/visual-review/`. Read those images
directly. Full documentation is in `docs/VISUAL_REVIEW.md`.

### Required loop for meaningful visual changes

For any change to `src/render.ts`, `src/renderLandmarks.ts`,
`src/renderPalette.ts`, or the generation modules that shape what the board
looks like:

1. Run the fast structural checks: `npm run check:visual`.
2. Run `npm run visual:review` (add `-- --scene <ids>` while iterating).
3. **Open the generated CURRENT images** for the scenes you touched.
4. **Open the BEFORE/CURRENT/DIFF comparisons** in `compare/` when a baseline
   exists, and check the metrics for scenes you did not expect to change.
5. Write down concrete findings from the actual images — "the wall lip reads as
   an inset panel at 28 px", not "the change is applied".
6. Modify the implementation based on those findings.
7. Run the review again.
8. Do at least two render → inspect → edit cycles for substantial visual work,
   unless the first capture proves the change had no meaningful visual effect.

Stopping at "the code implements it and the tests pass" is the specific failure
this pipeline exists to prevent.

### What to look for

Judge images against `docs/ART_DIRECTION.md`. The report repeats each scene's
own review objective and the relevant questions beside the pixels; the short
version:

- **Terrain**: does floor recede, do walls read as solid impassable mass, does
  half cover sit between them, do connected walls read as one structure?
- **Units**: are archetypes distinguishable at 28 px and in grayscale, without
  relying on the two-letter badge? Does combat UI cover faces or weapons?
- **Combat**: is a peek shot understandable, does the projectile leave the
  exposed shooting position, are hits and misses distinct, is movement visibly
  interpolated, do HP/AP/target/threat cues fight each other?
- **Environment**: is the family identifiable without its label, does one
  dominant feature win the eye, do supports stay secondary, does quiet floor
  stay quiet, does heavy mean context rather than clutter?
- **Diagnostic modes**: does the hierarchy survive grayscale and squint? Does
  semantic view show the problem is generation/layout rather than decoration?

### Interactive lab

The lab is still the right tool for exploration:

```bash
npm run dev:visual
```

The page is `/visual-lab.html`. It is a separate development surface and must
not acquire game rules. Its canonical scenes live in `tools/visual-scenes.ts`.
Use it in this order: normal at 40 px, grayscale, squint, then 28 px and 56 px.

Any single automated capture can be reopened by hand, because capture mode is
just a URL:

```
/visual-lab.html?capture=1&scene=terrain&cell=40&view=normal&time=0
```

Wall tiles must read as impassable before their internal decoration is read.
Do not rely on colour alone for gameplay meaning. Preserve the hierarchy in
`docs/ART_DIRECTION.md`.

Bespoke landmark artwork lives in `src/renderLandmarks.ts` and is reviewed
through the three landmark gallery scenes. When adding a landmark family, add
it to `LANDMARK_KINDS`, give it a painter in `generationLandmarks.ts`, an art
entry in `renderLandmarks.ts`, and a slot in the matching gallery; the visual
lab test fails if any kind lacks artwork or a gallery example.

When you add a scene to `tools/visual-scenes.ts`, add the cases that should be
reviewed for it to `tools/visual/review-matrix.ts`.

## Validation

Run focused checks while iterating:

```bash
npm run check:visual   # structural: does the scene contain the right state?
npm run typecheck
```

Structural tests and pixel inspection answer different questions and neither
replaces the other. `check:visual` never rasterizes anything, so ordinary test
runs do not need Chromium; `visual:review` is where the pixels get looked at.

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
  frame timestamp. Capture mode depends on that: a scene, cell size, view, and
  timestamp must always produce the same frame.
- Never make the lab's hand-authored overlays a source of gameplay truth.
- Keep mobile readability at a 28 px cell size; decorative detail may disappear,
  but walls, cover, units, targets, HP, and AP must remain recognizable.
- `artifacts/` is generated output and stays gitignored. Never commit
  screenshots produced by the review pipeline.
