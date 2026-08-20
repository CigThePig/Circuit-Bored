# Circuit Bored

A fast, browser-based tactical roguelike built around action points, cover,
line of sight, corner peeking, committed exposure, and overwatch.

## Operators

The squad is three different tools, not three stat lines. Each operator has
abilities the others cannot use at all, and a range band its weapon actually
wants the fight to happen in.

| Operator | Role | Abilities | Best at |
| --- | --- | --- | --- |
| Rook | Coordinator | **Mark Target** (1 AP) — squadmates, *not* Rook, gain accuracy against the called target and read through part of its cover. **Relay** (1 AP) — hand one action point to a squadmate, once per turn. | Medium |
| Vex | Infiltrator | **Dash** (1 AP) — action points buy more ground for the rest of the turn, and the first reaction shot aimed at Vex is slipped. Must be used before moving. | Close |
| Hex | Anchor | **Guard** (1 AP) — soften hits on a squadmate within 2 tiles. **Brace** (1 AP) — soften incoming hits, ignore suppression's AP cost, sharpen your overwatch; cancelled by moving. | Medium |

Mark deliberately excludes the marker: it is a coordination tool, and letting
Rook mark for its own shot would make it a personal damage buff. Relay moves an
action point and never creates one — one out, at most one in, once per turn.

## Range

Three bands, measured with the same eight-way distance movement uses:
**close** (1–3), **medium** (4–8), **long** (9+). A band changes accuracy, and
for a few weapons damage. No unit is useless outside its band; it just pays for
being there.

## Enemies

Each hostile is dangerous for a reason you can name and beatable by a plan that
follows from it. Select **Intel** and tap one to read its role, its weakness,
its current plan, and how to break that plan.

| Enemy | Dangerous because | Beaten by |
| --- | --- | --- |
| Scrapper | Lethal at knife range, and fast | Controlling the ground it must cross. Nearly harmless at distance. |
| Rifleman | Nothing special — the benchmark | Ordinary cover and focus fire |
| Marksman | Locks onto a target one turn before firing, then hits very hard | Breaking line of sight, suppressing it, rushing it, or killing it before the shot |
| Sentinel | Holds a lane with overwatch and suppressing fire; armoured | Flanking, crossfire, or suppression — a head-on trade is a bad deal |

## Enemy intent

Every hostile publishes what it means to do next, as a banner over its unit:
`AIMING AT VEX`, `CLOSING ON ROOK`, `SETTING WATCH`. A locked-on shot inverts to
a bright plate with a thread to its target, because it is the one plan you have
to answer this turn.

Intent comes from the AI's own planner (`planEnemyIntent` in `src/ai.ts`), never
from the UI guessing: the renderer shows the stored plan and `takeEnemyAction`
executes against the same function. Plans are replanned at the top of each
enemy turn, so breaking a firing line genuinely changes what the enemy does —
intent is information about a plan, not a promise.

## Combat actions

A turn is not just move-and-shoot. Every deliberate action is a definition in
`src/actions.ts` carrying its own cost, targeting, eligibility, preview text,
and resolution, so the runtime asks what a unit can do rather than branching
per action.

| Action | AP | Target | Effect |
| --- | --- | --- | --- |
| Shoot | 2 | Hostile | The ordinary attack, bound to tapping a hostile. |
| Aim | 1 | Self | The next shot gains accuracy. Cancelled by moving, spent by firing, gone at your next turn. |
| Hunker | 1 | Self | Deepens adjacent cover until your next turn and drops your lean. Moving cancels it. Nearly worthless in the open. |
| Suppress | 2 | Hostile | No damage. The target loses accuracy and an action point on its next turn, cannot prepare shots, and any overwatch it holds is broken. |
| Overwatch | 2 | Self | One reaction shot at the first hostile that moves through ground you can shoot into. Remaining AP is kept; moving cancels it. |

Two positional rules give manoeuvre a payoff beyond restoring accuracy. A
target is **Exposed** - worth extra accuracy and a point of damage - when it is
using cover that does not face the shooter, when a squadmate bears on it from
90 degrees or more away (**crossfire**), or when it has leaned out of cover and
not yet moved. Standing in the open with no terrain nearby is not Exposed;
being outmanoeuvred is.

Temporary states live on the unit in `src/status.ts`, are cloned with the map,
validated on load, and read by previews, resolution, and the AI through the
same helpers. `tests/scenarios.test.ts` plays fixed boards with fixed dice to
show that these decisions change outcomes.

## Overwatch

Overwatch is area control rather than a visibility transition. A watcher takes
its reaction on any step that *ends* somewhere it has a valid firing solution -
whether the mover emerged from cover or was already visible and moved anyway.
Every wall, corner, and occupancy rule comes from the ordinary shooting
relationship, so a watcher can never react through terrain it could not shoot
through. Selecting a unit marks the tiles inside its movement radius that a
hostile watcher already covers.

## Movement

Units walk in eight directions. Selecting a unit marks every tile it can reach
this turn with a diamond that shrinks as the walk spends more action points;
tapping any tile
in that region walks the whole route, one tile at a time, with overwatch
resolved at each tile. One action point buys `TILES_PER_MOVE_AP` tiles of
travel (`src/rules.ts`), so a turn covers twice the ground of a turn where
every tile cost a full point while the number of shots it can contain is
unchanged.

## Firing positions

The board publishes where a shot is, not only where one already exists.

The AI scores a firing solution from every tile it can reach, and weights that
above everything else it considers, so a hostile that steps two tiles to clear a
corner and fires is doing something ordinary. Shown only the shot it has from
the tile it is standing on, the squad had no way to find the same move, and an
enemy repositioning into a lane read as a shot the player was not allowed to
take.

Selecting an operator therefore marks, with a crosshair, every tile inside its
movement radius that would open a firing line it does not already have - and
only tiles whose walk still leaves the shot affordable, because a line the unit
cannot pay for is not an option. The tiles come from `openingFiringPositions`
in `src/combat.ts`, the same shooting relationship the AI, overwatch, and
resolution all ask, so the mark can never promise a shot the rules would refuse.
It is the opportunity half of the radius the watched-lane hatch already covers
in hazard.

The rules themselves are reciprocal, and `tests/shot-symmetry.test.ts` holds
them to it: line of sight gives the same verdict in both directions, every shot
the AI takes is one the player's own action pipeline would allow, and the only
one-way firing lines are corner peeks - which the shooter pays for by committing
to a silhouette its target can shoot back at.

## Field manual

The question mark in the top bar opens an in-game manual, available on every
screen and over a live board — reading it mid-turn costs nothing and leaves the
selected operator and any armed action exactly as they were.

Its content is not hand-written prose about the game. `src/help.ts` builds each
section from the module that owns the rule: action names, costs, and
descriptions come from the registry in `src/actions.ts`, unit statistics and
counters from `UNIT_ARCHETYPES`, band edges from `src/range.ts`, the movement
rate from `src/rules.ts`, the route length from `generateRoute`, and the
accuracy swings from `src/combat.ts`. Retuning a constant retunes the manual in
the same commit, and `tests/help.test.ts` fails if an action, an archetype, or a
HUD status code exists that the manual does not explain.

## Run loop

A run is a deterministic seven-node route. Players choose between standard and
elite combat, repair bays, and upgrade caches before a final Core Breach.
Squad HP, deaths, and installed circuits persist between encounters; AP and
turn-local action state reset normally. The current seed is always visible and
can be entered on the title screen to reproduce a route.

Active runs use the versioned `circuit-bored.run.v1` browser save. Active combat
snapshots are strict rather than repaired: operator presence, terrain, tactical
state, counters, and canonical HP/AP ceilings have to describe a real encounter.
Player actions commit individually. An enemy phase commits as one deterministic
transaction, so closing the app halfway through replays that same phase from its
saved start instead of resuming from a half-scheduled board. Combat RNG advances
with the battlefield snapshot that consumed it, never ahead of it. Editor maps
continue to use their separate, deliberately forgiving `circuit-bored.map.v1`
format.

## Architecture

- `src/combat.ts`, `src/ai.ts`, and `src/runtime.ts` contain the tactical match.
- `src/actions.ts` is the registry of non-movement combat actions; it is the
  only place their AP is charged, and where each operator's role abilities are
  gated to its archetype.
- `src/status.ts` owns temporary tactical states and their sanitisation.
- `src/range.ts` owns range bands and per-unit range profiles.
- `src/intent.ts` owns the shape and persistence of an enemy plan; the planner
  itself lives in `src/ai.ts`, because planning is the AI's job.
- `src/rules.ts` owns the action-point economy and the turn lifecycle
  (`beginUnitTurn`, `endUnitTurn`, `onUnitMoved`), which is where every status
  duration is enforced. `src/movement.ts` owns walking geometry and the
  reachable region both the player and the AI plan against.
- `src/rng.ts` owns serializable seeded randomness.
- `src/content.ts` is the registry for unit archetypes and upgrades.
- `src/generation.ts` builds validated, connected tactical encounters.
- `src/run.ts` owns route generation, persistent squad state, rewards,
  lifecycle transitions, and save validation.
- `src/main.ts` presents title, route, reward, recovery, outcome, encounter,
  and developer-editor screens without owning game rules.
- `src/help.ts` derives the in-game field manual from those rule modules and
  mounts it as a modal over whatever screen is showing.

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
