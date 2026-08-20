from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    text = read(path)
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}")
    write(path, text.replace(old, new, count))


# ---------------------------------------------------------------------------
# Rules: movement is a positional commitment boundary.
# ---------------------------------------------------------------------------
replace_exact(
    "src/rules.ts",
    "  isBraced,\n  isDashing,",
    "  isAimed,\n  isBraced,\n  isDashing,",
)
replace_exact(
    "src/rules.ts",
    "export function beginUnitTurn(unit: Unit): void {\n  // AP is computed before any state is cleared, because a Brace set last turn",
    "export function beginUnitTurn(unit: Unit): void {\n  // A Marksman's telegraphed lock is the one prepared shot that deliberately\n  // crosses its own turn boundary. The stored aim intent names the exact target;\n  // ordinary Aim still expires here as before.\n  const preserveMarksmanLock =\n    unit.aiBehavior === \"marksman\" &&\n    isAimed(unit) &&\n    unit.intent?.kind === \"aim\" &&\n    unit.intent.targetId !== null;\n\n  // AP is computed before any state is cleared, because a Brace set last turn",
)
replace_exact(
    "src/rules.ts",
    "  setAimed(unit, false);\n  setHunkered(unit, false);",
    "  if (!preserveMarksmanLock) setAimed(unit, false);\n  setHunkered(unit, false);",
)
replace_exact(
    "src/rules.ts",
    "export function onUnitMoved(unit: Unit): void {\n  unit.movesThisTurn = (unit.movesThisTurn ?? 0) + 1;\n  unit.peekExposure = null;\n  setAimed(unit, false);\n  // An anchor that walks away is no longer an anchor.\n  setBraced(unit, false);\n}",
    "export function onUnitMoved(unit: Unit): void {\n  unit.movesThisTurn = (unit.movesThisTurn ?? 0) + 1;\n  unit.peekExposure = null;\n  setAimed(unit, false);\n  // Hunker and Overwatch both describe a committed position. Carrying either\n  // state to different terrain would make the new tile inherit preparation\n  // that was paid for somewhere else.\n  setHunkered(unit, false);\n  unit.overwatch = false;\n  unit.overwatchShotsUsed = 0;\n  // An anchor that walks away is no longer an anchor.\n  setBraced(unit, false);\n}",
)

# Player-facing text must describe the movement cancellation now enforced above.
replace_exact(
    "src/actions.ts",
    '    "Press into adjacent cover until your next turn. Worth little in the open.",',
    '    "Press into adjacent cover until your next turn or until you move. Worth little in the open.",',
)
replace_exact(
    "src/actions.ts",
    '      ? "Deepens adjacent cover until your next turn, and drops your lean."',
    '      ? "Deepens adjacent cover until your next turn or until you move, and drops your lean."',
)
replace_exact(
    "src/actions.ts",
    '    "through it takes one reaction shot. Remaining AP is kept.",',
    '    "through it takes one reaction shot. Remaining AP is kept. Moving cancels it.",',
)
replace_exact(
    "src/actions.ts",
    '    detail: "One reaction shot at the first hostile that moves in your firing arc.",',
    '    detail: "One reaction shot at the first hostile that moves in your firing arc. Moving cancels it.",',
)

# ---------------------------------------------------------------------------
# Runtime wiring: all targeted actions arm, and every independent watcher gets
# its legal reaction on the same movement step.
# ---------------------------------------------------------------------------
replace_exact(
    "src/runtime.ts",
    '    if (action.targeting === "enemy") {\n      // Arm the action and wait for a tap on the board. Nothing is spent yet.\n      pendingAction = id;\n      redraw();\n      return;\n    }',
    '    if (action.targeting !== "self") {\n      // Every targeted action owns the next board tap. Enemy-targeted actions\n      // resolve on hostiles; ally-targeted role abilities resolve on squadmates.\n      pendingAction = id;\n      redraw();\n      return;\n    }',
)

runtime = read("src/runtime.ts")
first_start = runtime.index("  const triggerOverwatchReactions = async (")
second_start = runtime.index("  async function triggerEnemyOverwatchReactions(", first_start)
first = runtime[first_start:second_start]
old_tail = "      await delay(effect.durationMs);\n      if (cancelled) return;\n      break;"
if first.count(old_tail) != 1:
    raise RuntimeError("runtime.ts: player-overwatch loop tail did not match exactly once")
first = first.replace(
    old_tail,
    "      await delay(effect.durationMs);\n      if (cancelled) return;\n      // Independent watchers are independent reactions. Continue through the\n      // squad unless this shot actually ended the mover's turn by killing it.\n      if (enemy.hp <= 0) return;",
)
runtime = runtime[:first_start] + first + runtime[second_start:]
second_start = runtime.index("  async function triggerEnemyOverwatchReactions(")
second_end = runtime.index("\n\n  const animateEnemyTurn", second_start)
second = runtime[second_start:second_end]
if second.count(old_tail) != 1:
    raise RuntimeError("runtime.ts: enemy-overwatch loop tail did not match exactly once")
second = second.replace(
    old_tail,
    "      await delay(effect.durationMs);\n      if (cancelled) return;\n      // A movement step can cross several separately-covered lanes. Let every\n      // eligible watcher react unless the mover has already been dropped.\n      if (player.hp <= 0) return;",
)
runtime = runtime[:second_start] + second + runtime[second_end:]
write("src/runtime.ts", runtime)

# ---------------------------------------------------------------------------
# AI: target-specific Marksman lock, truthful next-turn intent forecasting, and
# an executor that actually obeys HOLDING.
# ---------------------------------------------------------------------------
replace_exact(
    "src/ai.ts",
    'import { isPassable, unitAt } from "./map.ts";',
    'import { cloneMap, isPassable, unitAt } from "./map.ts";',
)
replace_exact(
    "src/ai.ts",
    'import { isAimed, isHunkered, isSuppressed } from "./status.ts";',
    'import { isAimed, isHunkered, isSuppressed, setAimed } from "./status.ts";',
)
replace_exact(
    "src/ai.ts",
    'import { onUnitMoved } from "./rules.ts";',
    'import { beginUnitTurn, onUnitMoved } from "./rules.ts";',
)
replace_exact(
    "src/ai.ts",
    "function bestVisibleTarget(map: GameMap, enemy: Unit): Unit | null {\n  let best: Unit | null = null;\n  let bestValue = -Infinity;\n  for (const p of visiblePlayers(map, enemy)) {\n    const value = shotValue(map, enemy, p);\n    if (value > bestValue) {\n      bestValue = value;\n      best = p;\n    }\n  }\n  return best;\n}\n\n/**\n * Decide what `enemy` is trying to do, and say so.",
    "function bestVisibleTarget(map: GameMap, enemy: Unit): Unit | null {\n  let best: Unit | null = null;\n  let bestValue = -Infinity;\n  for (const p of visiblePlayers(map, enemy)) {\n    const value = shotValue(map, enemy, p);\n    if (value > bestValue) {\n      bestValue = value;\n      best = p;\n    }\n  }\n  return best;\n}\n\n/** The exact operator a prepared Marksman lock belongs to, if it is still valid. */\nfunction marksmanLockedTarget(map: GameMap, enemy: Unit): Unit | null {\n  if (enemy.aiBehavior !== \"marksman\" || !isAimed(enemy)) return null;\n  if (enemy.intent?.kind !== \"aim\" || !enemy.intent.targetId) return null;\n  if (isSuppressed(enemy)) return null;\n  const target = map.units.find((unit) =>\n    unit.id === enemy.intent!.targetId && unit.team === \"player\" && unit.hp > 0\n  ) ?? null;\n  if (!target) return null;\n  return canShootTarget(map, enemy, target).canShoot ? target : null;\n}\n\n/** Break a stale lock instead of letting its Aim bonus migrate to another target. */\nfunction validateMarksmanLock(map: GameMap, enemy: Unit): Unit | null {\n  if (enemy.aiBehavior !== \"marksman\" || !isAimed(enemy)) return null;\n  const target = marksmanLockedTarget(map, enemy);\n  if (!target) setAimed(enemy, false);\n  return target;\n}\n\n/**\n * Decide what `enemy` is trying to do, and say so.",
)

old_plan_open = """  const visible = bestVisibleTarget(map, enemy);\n  const behavior = enemy.aiBehavior ?? \"balanced\";\n  const wanted = preferredBand(enemy.combat);\n\n  const shooting = (intent: EnemyIntent, target: Unit): EnemyPlan =>\n    ({ intent, target, destination: null });\n\n  if (visible) {\n    const band = rangeBandBetween(enemy, visible);\n    // A Marksman that already holds a bead is committed: that is the whole\n    // point of telegraphing it.\n    if (behavior === \"marksman\" && isAimed(enemy)) {\n      return shooting(makeIntent(\"aim\", visible.id, { x: visible.x, y: visible.y }), visible);\n    }\n    // It settles on a target one turn before firing, so the player gets a turn\n"""
new_plan_open = """  const behavior = enemy.aiBehavior ?? \"balanced\";\n  const wanted = preferredBand(enemy.combat);\n\n  const shooting = (intent: EnemyIntent, target: Unit): EnemyPlan =>\n    ({ intent, target, destination: null });\n\n  // A prepared Marksman shot belongs to the operator named when the lock was\n  // acquired. It never retargets just because somebody else becomes easier to\n  // hit during the player's response turn.\n  const locked = behavior === \"marksman\" ? marksmanLockedTarget(map, enemy) : null;\n  if (locked) {\n    return shooting(makeIntent(\"aim\", locked.id, { x: locked.x, y: locked.y }), locked);\n  }\n\n  const visible = bestVisibleTarget(map, enemy);\n  if (visible) {\n    const band = rangeBandBetween(enemy, visible);\n    // It settles on a target one turn before firing, so the player gets a turn\n"""
replace_exact("src/ai.ts", old_plan_open, new_plan_open)

old_refresh = """export function refreshEnemyIntents(map: GameMap): void {\n  for (const unit of map.units) {\n    if (unit.team !== \"enemy\") continue;\n    if (unit.hp <= 0) {\n      unit.intent = undefined;\n      continue;\n    }\n    unit.intent = planEnemyIntent(map, unit);\n  }\n}\n"""
new_refresh = """function forecastEnemyIntent(map: GameMap, enemy: Unit): EnemyIntent {\n  // Intent is shown during the player's turn, but the enemy will act only after\n  // its own begin-turn reset. Forecast on a clone after applying that exact\n  // lifecycle so spent AP and stale per-turn counters cannot lie to the HUD.\n  const forecastMap = cloneMap(map);\n  const forecastEnemy = forecastMap.units.find((unit) => unit.id === enemy.id);\n  if (!forecastEnemy) return makeIntent(\"idle\");\n  beginUnitTurn(forecastEnemy);\n  validateMarksmanLock(forecastMap, forecastEnemy);\n  return planEnemyIntent(forecastMap, forecastEnemy);\n}\n\nexport function refreshEnemyIntents(map: GameMap): void {\n  for (const unit of map.units) {\n    if (unit.team !== \"enemy\") continue;\n    if (unit.hp <= 0) {\n      unit.intent = undefined;\n      continue;\n    }\n    // If the player killed the named target or broke its firing line, break the\n    // live lock now before replacing the stored plan with a forecast. That is\n    // what prevents the prepared Aim from being transferred to a new target.\n    validateMarksmanLock(map, unit);\n    unit.intent = forecastEnemyIntent(map, unit);\n  }\n}\n"""
replace_exact("src/ai.ts", old_refresh, new_refresh)
replace_exact(
    "src/ai.ts",
    "  enemy.peekExposure = null;\n  // Replan at the top of the turn: the player has had a whole turn to",
    "  enemy.peekExposure = null;\n  validateMarksmanLock(map, enemy);\n  // Replan at the top of the turn: the player has had a whole turn to",
)
replace_exact(
    "src/ai.ts",
    "  if (intent.kind === \"aim\" && intentTarget && !isAimed(enemy)) {\n    const outcome = performAction(map, enemy, \"aim\");\n    if (outcome.ok) return { kind: \"aim\", target: intentTarget };\n  }",
    "  if (intent.kind === \"aim\" && intentTarget && !isAimed(enemy)) {\n    const outcome = performAction(map, enemy, \"aim\");\n    if (outcome.ok) {\n      // Locking on is the Marksman's whole telegraph turn. The next enemy turn\n      // is the earliest point at which this prepared shot may be fired.\n      enemy.ap = 0;\n      return { kind: \"aim\", target: intentTarget };\n    }\n  }",
)
replace_exact(
    "src/ai.ts",
    "  session.turnTargets.set(enemy.id, target.id);\n\n  // Re-check shoot now using current LoS and current AP.",
    "  session.turnTargets.set(enemy.id, target.id);\n\n  // A prepared Marksman shot is resolved against its named lock before the\n  // ordinary target-selection code gets a chance to compare other operators.\n  // The whole firing turn is committed to that telegraphed shot, preserving the\n  // one-lock/one-shot cadence and preventing a surprise follow-up attack.\n  if (enemy.aiBehavior === \"marksman\" && isAimed(enemy)) {\n    const locked = marksmanLockedTarget(map, enemy);\n    if (!locked || enemy.ap < SHOOT_AP_COST) return { kind: \"wait\" };\n    enemy.ap -= SHOOT_AP_COST;\n    const result = resolveShot(map, enemy, locked, rng);\n    if (!result.canShoot) {\n      enemy.ap += SHOOT_AP_COST;\n      setAimed(enemy, false);\n      return { kind: \"wait\" };\n    }\n    enemy.ap = 0;\n    session.turnTargets.set(enemy.id, locked.id);\n    return { kind: \"shoot\", target: locked, result };\n  }\n\n  // Re-check shoot now using current LoS and current AP.",
)
replace_exact(
    "src/ai.ts",
    "  // A unit that has committed to watching a lane stays on it. Without this the\n  // fallback route below would walk a sentinel straight off the position it\n  // just spent two action points to hold.\n  if (holdingPosition && enemy.overwatch) return { kind: \"wait\" };",
    "  // HOLDING is a player-facing promise about position. Defensive actions\n  // such as Hunker above may reinforce that tile, but the executor must never\n  // fall through into a secret fallback move after publishing HOLDING.\n  if (intent.kind === \"hold\") return { kind: \"wait\" };\n\n  // A unit that has committed to watching a lane stays on it. Without this the\n  // fallback route below would walk a sentinel straight off the position it\n  // just spent two action points to hold.\n  if (holdingPosition && enemy.overwatch) return { kind: \"wait\" };",
)

# ---------------------------------------------------------------------------
# Documentation follows the repaired positional rules.
# ---------------------------------------------------------------------------
replace_exact(
    "README.md",
    "| Hunker | 1 | Self | Deepens adjacent cover until your next turn and drops your lean. Nearly worthless in the open. |",
    "| Hunker | 1 | Self | Deepens adjacent cover until your next turn and drops your lean. Moving cancels it. Nearly worthless in the open. |",
)
replace_exact(
    "README.md",
    "| Overwatch | 2 | Self | One reaction shot at the first hostile that moves through ground you can shoot into. Remaining AP is kept. |",
    "| Overwatch | 2 | Self | One reaction shot at the first hostile that moves through ground you can shoot into. Remaining AP is kept; moving cancels it. |",
)

# The old intent assertion compared the forecast against stale live AP. Compare
# against the exact next-turn snapshot the HUD now promises instead.
replace_exact(
    "tests/intent.test.ts",
    """  it(\"matches what the planner would say when asked again\", () => {\n    const { map } = lane(\"sentinel\");\n    refreshEnemyIntents(map);\n    for (const unit of map.units) {\n      if (unit.team !== \"enemy\") continue;\n      expect(planEnemyIntent(map, unit)).toEqual(unit.intent);\n    }\n  });\n""",
    """  it(\"matches what the planner says from the enemy's next-turn state\", () => {\n    const { map } = lane(\"sentinel\");\n    const enemy = map.units.find((unit) => unit.team === \"enemy\")!;\n    enemy.ap = 0;\n    enemy.movesThisTurn = 4;\n    refreshEnemyIntents(map);\n    const published = enemy.intent;\n\n    const forecast = cloneMap(map);\n    const forecastEnemy = forecast.units.find((unit) => unit.id === enemy.id)!;\n    beginUnitTurn(forecastEnemy);\n    expect(planEnemyIntent(forecast, forecastEnemy)).toEqual(published);\n  });\n""",
)

wave1_test = r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beginEnemyTurn,
  planEnemyIntent,
  refreshEnemyIntents,
  takeEnemyAction,
} from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";
import { performAction } from "../src/actions.ts";
import { makeArchetypeUnit } from "../src/content.ts";
import { beginUnitTurn, endUnitTurn, onUnitMoved } from "../src/rules.ts";
import { isAimed, isHunkered } from "../src/status.ts";
import { buildMap } from "./fixtures.ts";

function marksmanLane() {
  const map = buildMap([
    "................",
    "................",
    "................",
  ]);
  const rook = makeArchetypeUnit("operator", "rook", 1, 1);
  const vex = makeArchetypeUnit("runner", "vex", 2, 0);
  const marksman = makeArchetypeUnit("marksman", "marksman", 14, 1);
  map.units.push(rook, vex, marksman);
  return { map, rook, vex, marksman };
}

describe("Wave 1 mechanical truth", () => {
  it("movement cancels Hunker and Overwatch as positional commitments", () => {
    const map = buildMap(["....."]);
    const unit = makeArchetypeUnit("operator", "rook", 1, 0);
    const foe = makeArchetypeUnit("rifleman", "foe", 4, 0);
    map.units.push(unit, foe);
    expect(performAction(map, unit, "hunker").ok).toBe(true);
    unit.overwatch = true;
    unit.overwatchShotsUsed = 1;
    expect(isHunkered(unit)).toBe(true);

    onUnitMoved(unit);

    expect(isHunkered(unit)).toBe(false);
    expect(unit.overwatch).toBe(false);
    expect(unit.overwatchShotsUsed).toBe(0);
  });

  it("a Marksman spends one turn locking and the next firing at that exact operator", () => {
    const { map, rook, vex, marksman } = marksmanLane();
    refreshEnemyIntents(map);
    const lockedId = marksman.intent!.targetId!;
    const locked = map.units.find((unit) => unit.id === lockedId)!;
    const before = new Map([[rook.id, rook.hp], [vex.id, vex.hp]]);
    const session = createAiSession();

    beginUnitTurn(marksman);
    beginEnemyTurn(map, marksman, session);
    const acquire = takeEnemyAction(map, marksman, session, () => 0);
    expect(acquire.kind).toBe("aim");
    expect(isAimed(marksman)).toBe(true);
    expect(marksman.ap).toBe(0);
    expect(rook.hp).toBe(before.get(rook.id));
    expect(vex.hp).toBe(before.get(vex.id));

    endUnitTurn(marksman);
    refreshEnemyIntents(map);
    expect(marksman.intent).toMatchObject({ kind: "aim", targetId: lockedId });

    beginUnitTurn(marksman);
    expect(isAimed(marksman)).toBe(true);
    beginEnemyTurn(map, marksman, session);
    const fire = takeEnemyAction(map, marksman, session, () => 0);
    expect(fire.kind).toBe("shoot");
    if (fire.kind === "shoot") {
      expect(fire.target.id).toBe(locked.id);
      expect(fire.result.usedAim).toBe(true);
    }
    expect(marksman.ap).toBe(0);
    expect(isAimed(marksman)).toBe(false);
  });

  it("does not transfer a broken Marksman lock to another visible operator", () => {
    const { map, rook, vex, marksman } = marksmanLane();
    refreshEnemyIntents(map);
    const lockedId = marksman.intent!.targetId!;
    const locked = map.units.find((unit) => unit.id === lockedId)!;
    const other = locked.id === rook.id ? vex : rook;
    const session = createAiSession();

    beginUnitTurn(marksman);
    beginEnemyTurn(map, marksman, session);
    expect(takeEnemyAction(map, marksman, session, () => 0).kind).toBe("aim");
    expect(isAimed(marksman)).toBe(true);

    locked.hp = 0;
    refreshEnemyIntents(map);
    expect(isAimed(marksman)).toBe(false);
    const otherHp = other.hp;

    beginUnitTurn(marksman);
    beginEnemyTurn(map, marksman, session);
    const replacement = takeEnemyAction(map, marksman, session, () => 0);
    expect(replacement.kind).toBe("aim");
    expect(other.hp).toBe(otherHp);
  });

  it("publishes intent from restored next-turn AP rather than exhausted AP", () => {
    const map = buildMap(["........"]);
    const player = makeArchetypeUnit("operator", "rook", 0, 0);
    const enemy = makeArchetypeUnit("rifleman", "foe", 6, 0);
    map.units.push(player, enemy);
    enemy.ap = 0;
    enemy.movesThisTurn = 6;
    enemy.shotsThisTurn = 2;

    refreshEnemyIntents(map);
    const published = structuredClone(enemy.intent);
    expect(published?.kind).toBe("engage");

    beginUnitTurn(enemy);
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(enemy.intent).toEqual(published);
  });

  it("executes HOLDING as staying on the published tile", () => {
    const map = buildMap(["p..e"], [
      { id: "rook", team: "player", x: 0, y: 0, overwatch: true },
      { id: "foe", team: "enemy", x: 3, y: 0, ap: 1, maxAp: 4 },
    ]);
    const enemy = map.units[1];
    const start = { x: enemy.x, y: enemy.y };
    const intent = planEnemyIntent(map, enemy);
    expect(intent.kind).toBe("hold");
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(enemy.intent!.kind).toBe("hold");
    expect(takeEnemyAction(map, enemy, session)).toEqual({ kind: "wait" });
    expect(enemy).toMatchObject(start);
  });

  it("keeps ally-targeted actions armed and processes all independent reaction loops", () => {
    // This is a wiring guard until the planned browser-level runtime harness
    // can exercise the DOM and animation loop directly.
    const source = readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf8");
    expect(source).toContain('if (action.targeting !== "self")');

    const playerReactions = source.slice(
      source.indexOf("const triggerOverwatchReactions = async"),
      source.indexOf("async function triggerEnemyOverwatchReactions"),
    );
    const enemyReactions = source.slice(
      source.indexOf("async function triggerEnemyOverwatchReactions"),
      source.indexOf("const animateEnemyTurn"),
    );
    expect(playerReactions).not.toMatch(/if \(cancelled\) return;\s*break;/);
    expect(enemyReactions).not.toMatch(/if \(cancelled\) return;\s*break;/);
  });
});
'''
write("tests/wave1-mechanical-truth.test.ts", wave1_test)

print("Wave 1 patch applied successfully")
