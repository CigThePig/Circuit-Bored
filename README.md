# Circuit Bored

A fast, browser-based tactical roguelike built around action points, cover,
line of sight, corner peeking, committed exposure, and overwatch.

## Movement

Units walk in eight directions. Selecting a unit marks every tile it can reach
this turn with a diamond that shrinks as the walk spends more action points;
tapping any tile
in that region walks the whole route, one tile at a time, with overwatch
resolved at each tile. One action point buys `TILES_PER_MOVE_AP` tiles of
travel (`src/rules.ts`), so a turn covers twice the ground of a turn where
every tile cost a full point while the number of shots it can contain is
unchanged.

## Run loop

A run is a deterministic seven-node route. Players choose between standard and
elite combat, repair bays, and upgrade caches before a final Core Breach.
Squad HP, deaths, and installed circuits persist between encounters; AP and
turn-local action state reset normally. The current seed is always visible and
can be entered on the title screen to reproduce a route.

Active runs use the versioned `circuit-bored.run.v1` browser save. Editor maps
continue to use their separate `circuit-bored.map.v1` format.

## Architecture

- `src/combat.ts`, `src/ai.ts`, and `src/runtime.ts` contain the tactical match.
- `src/rules.ts` owns the action-point economy; `src/movement.ts` owns walking
  geometry and the reachable region both the player and the AI plan against.
- `src/rng.ts` owns serializable seeded randomness.
- `src/content.ts` is the registry for unit archetypes and upgrades.
- `src/generation.ts` builds validated, connected tactical encounters.
- `src/run.ts` owns route generation, persistent squad state, rewards,
  lifecycle transitions, and save validation.
- `src/main.ts` presents title, route, reward, recovery, outcome, encounter,
  and developer-editor screens without owning game rules.

The map editor remains available from the title screen as a development tool.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The GitHub Pages workflow builds with the repository base path. Gameplay and
content code intentionally use no external runtime dependencies.

## Visual review

`/visual-lab.html` renders canonical scenes with the production renderer:

```bash
npm run dev:visual     # interactive laboratory
npm run visual:review  # headless capture, baseline comparison, and report
```

`visual:review` drives that lab through a local headless Chromium and writes
before/current/difference PNGs, difference metrics, and a report into
`artifacts/visual-review/` (gitignored). It needs Node 22.18+ and a Playwright
Chromium; see `docs/VISUAL_REVIEW.md`. Visual direction lives in
`docs/ART_DIRECTION.md`.
