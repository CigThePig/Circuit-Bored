# Circuit Bored

A fast, browser-based tactical roguelike built around action points, cover,
line of sight, corner peeking, committed exposure, and overwatch.

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
