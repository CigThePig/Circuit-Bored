# Automated visual review

The Visual Laboratory renders canonical scenes with the production renderer.
This pipeline drives that lab from the command line with a local headless
Chromium, so an agent can look at real pixels instead of inferring visual
quality from code.

Nothing here needs a human to open a browser, click Export PNG, use the
clipboard, or download a file, and nothing needs an external browser to reach
localhost: Chromium and the Vite server both run inside this workspace.

## Commands

```bash
npm run visual:review     # baseline + current + comparisons + report (the normal loop)
npm run visual:capture    # current images only, no baseline work
npm run visual:baseline   # (re)render the baseline only
npm run visual:compare    # diff and report whatever is already captured
npm run visual:sample     # deeper, uncurated procedural seeds
```

Options are passed through npm:

```bash
npm run visual:review -- --scene terrain,units      # only some cases
npm run visual:review -- --base main                # explicit baseline ref
npm run visual:review -- --refresh-baseline         # ignore the cached baseline
npm run visual:review -- --no-baseline              # current images only
npm run visual:sample  -- --seeds 6                 # 6 seeds per theme/profile
node tools/visual-review.mjs --help                 # everything
```

A full review is about 45 images and takes roughly a minute; a capture-only run
is about 40 seconds. `--scene` is the fast path while iterating on one area.

## Where output lives

```
artifacts/visual-review/
  current/     working-tree captures, one directory per scene family
    terrain/   units/   overlays/   effects/   landmarks/   generated/
  baseline/    the same captures rendered from the base commit
    baseline.json     which commit the baseline came from
  compare/     <case>-compare.png (before | current | difference) and <case>-diff.png
    metrics.json      machine-readable difference metrics
  report/
    index.html        images with the review objective beside them
    manifest.json     the same data for programmatic reading
artifacts/visual-sample/   output of `npm run visual:sample`
```

`artifacts/` is gitignored. Every image is regenerated from the working tree
and from a git ref, so committing them would only add large binaries that go
stale on the next renderer change.

Captures whose longest side exceeds 1200 px also get a `-overview.png` beside
them, downscaled to 900 px, for when the whole composition needs to be taken in
at once.

## How baselines are determined

`baseline` means **rendered from real previous code**, not a stored reference
image:

1. The base commit is the **merge-base** between `HEAD` and the first ref that
   resolves out of `origin/main`, `main`, `origin/master`, `master`,
   `origin/HEAD`. `--base <ref>` picks a different one (still through its
   merge-base with `HEAD`, so a long-lived branch shows only its own change).
2. That commit is checked out into a **temporary detached git worktree**. Your
   working tree, index, and current branch are never touched.
3. The current capture harness (`visual-lab.html`, `tools/visual-lab.ts`,
   `tools/visual/`) is copied into the worktree. `src/` is not — otherwise the
   baseline would compare the working tree against itself. This is also what
   lets a base commit from before this pipeline existed be captured at all.
4. The worktree is served, captured, and removed.

The result is cached: a second `visual:review` against the same base commit
reuses `baseline/` instead of re-rendering it. `--refresh-baseline` forces a
re-render, and the cache is also invalidated when the base commit changes or
when the run needs cases the cached baseline does not have.

If no base ref resolves, the run still produces current captures and the report
says so.

## How deterministic capture works

`draw(canvas, state, nowMs)` already takes an explicit timestamp, and ambient
landmark motion and combat effects are pure functions of it. Capture mode never
calls `performance.now()`: it renders exactly one frame at the requested `time`,
with no animation loop running underneath the screenshot.

A scene, cell size, view mode, and timestamp therefore always produce the same
image. This is verifiable: rendering the merge-base in a worktree and the
identical working tree produces byte-identical PNGs for every case.

Animated scenes are captured as several fixed frames plus a composed strip:

- `effects` at t = 0, 240, 480, 720, 960 ms — muzzle flash, projectile
  departure, travel, peek geometry, impact, miss, defeat, and movement
  interpolation. The effect loop is 1200 ms, and the canonical shots carry
  different phase offsets, so five evenly spaced samples walk all of them
  through the whole animation.
- `landmarks-foundry` at t = 0, 1400, 2800 ms — ambient motion runs on 1.9 s to
  4.2 s cycles, so widely spaced frames show that landmarks move and that
  ordinary terrain does not.

## Inspecting one scene by hand

Capture mode is a documented URL, so any single frame can be reopened:

```
/visual-lab.html?capture=1&scene=terrain&cell=40&view=normal&time=0
```

| Parameter | Values | Meaning |
| --- | --- | --- |
| `capture` | `1` | Hide all page chrome and render one scene |
| `scene` | any lab scene id, or `seed-inspection` | Required in capture mode |
| `cell` | even, 24–64 | Cell size in px |
| `view` | `normal`, `grayscale`, `contrast`, `squint`, `semantic` | Diagnostic view |
| `time` | 0–600000 | Fixed frame timestamp in ms |
| `backdrop` | `dark`, `light` | Stage background |
| `overlays` | `0`, `1` | Gameplay overlays on the board |
| `ambient` | `0`, `1` | Ambient landmark motion |
| `label` | `0`, `1` | The caption strip under the board |
| `inspectionTheme` / `inspectionProfile` / `inspectionSeed` | | Only for `scene=seed-inspection` |

Scene ids come from `tools/visual-scenes.ts`: `terrain`, `units`, `overlays`,
`effects`, `landmarks-foundry`, `landmarks-data-core`, `landmarks-derelict`,
and `generated-{industrial,data-core,derelict}-{landmark,quiet}`. A scene the
lab does not have fails the capture with the list of ids it does have.

Run `npm run dev:visual` first; the capture URLs in `manifest.json` point at
`http://localhost:5173`. Drop `capture=1` to land on the same configuration in
the interactive lab.

## The review matrix

`tools/visual/review-matrix.ts` owns the list of captures. It is explicit rather
than a full cross-product, because every image costs a reviewer attention:

- terrain at 40 px normal / grayscale / squint, plus 28 px and 56 px
- units at 40 px, 28 px, 28 px grayscale, 56 px
- overlays at 40 px, 40 px grayscale, 28 px
- effects as a 5-frame strip at 40 px, plus 28 px
- each landmark gallery at 40 px normal and squint, plus an ambient strip
- each generated encounter at 40 px, with grayscale, squint, and semantic on
  the landmark-heavy ones, and one full encounter at 28 px

Editing that file is the supported way to change what gets reviewed;
`tests/visual-pipeline.test.ts` checks that every referenced scene exists and
that the required sizes and diagnostic views stay covered.

## Metrics, and what they do not mean

`compare/metrics.json` and the report give `changedPixels`, `changedRatio`,
`meanDifference`, and `maxDifference` per capture. They answer questions like
"did this change reach this scene at all?", "which scenes moved most?", and
"was a supposedly local change actually global?".

They do not decide whether a change is good. This is a development tool, not a
screenshot regression test: intentional art changes are supposed to produce
large diffs, and nothing here fails a build because pixels moved.

## Structural tests versus pixel inspection

```bash
npm run check:visual   # fast structural tests: does the scene contain the right state?
npm run visual:review  # pixel inspection: what does it actually look like?
```

`check:visual` verifies that scenes contain every archetype, that combat
geometry is legal, that every landmark family has artwork and a gallery slot,
and that the pipeline's own contracts hold. It never rasterizes anything.
Ordinary test runs therefore do not need Chromium.

## Continuous integration

`.github/workflows/visual-review.yml` runs on pull requests that touch the
renderer, generation, the lab, or the pipeline, and on demand via
`workflow_dispatch`. It captures the PR head and, when the base branch is
available, renders the baseline from the merge-base too, then uploads
`circuit-bored-visual-review` containing the report, the images, and the
metrics. It never commits screenshots to the branch, and deployment does not
depend on it.

## Troubleshooting

**"No usable Chromium was found"** — install one with
`npx playwright install chromium`. If the environment ships a pre-installed
Chromium at a pinned revision, the runner already searches
`PLAYWRIGHT_BROWSERS_PATH`; `CIRCUIT_BORED_CHROMIUM=/path/to/chrome` overrides
the search entirely.

**"needs Node 22.18 or newer"** — the pipeline is TypeScript executed by Node's
built-in type stripping, so no transpiler is in the dependency tree. The game,
its tests, and its build still work on older Node.

**"Visual lab never reached its ready state"** or **"logged errors while
rendering"** — the lab threw while building or drawing a scene. The message
carries the scene, cell size, view, timestamp, capture URL, and the browser's
own output. Open that URL with `npm run dev:visual` to see it directly. Capture
never screenshots a blank or broken canvas.

**Sizes differ between baseline and current** — the comparison is still written
and labelled `size-changed`, with the pixel diff skipped. That normally means a
scene's map dimensions changed.

**A worktree was left behind** — `git worktree prune`. The pipeline removes its
own worktree even when capture fails, but a killed process can leave one.
