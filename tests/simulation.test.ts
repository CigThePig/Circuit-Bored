import { beforeEach, describe, expect, it } from "vitest";
import {
  beginEnemyTurn,
  refreshEnemyIntents,
  takeEnemyAction,
} from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";
import {
  SHOOT_AP_COST,
  actionEligibility,
  performAction,
} from "../src/actions.ts";
import {
  UNIT_ARCHETYPES,
  maxApWithUpgrades,
  type UnitArchetypeId,
  type UpgradeId,
} from "../src/content.ts";
import {
  overwatchReactions,
  previewShot,
  resolveShot,
  settleOverwatch,
} from "../src/combat.ts";
import { getTile, type GameMap, type Unit } from "../src/map.ts";
import {
  MOVE_DIRECTIONS,
  computeMovementField,
  diagonalIsClear,
  movementDestinations,
  movementPath,
} from "../src/movement.ts";
import {
  beginUnitTurn,
  endUnitTurn,
  isSpent,
  movementApCost,
  movementRange,
  onUnitMoved,
} from "../src/rules.ts";
import {
  availableNodes,
  chooseRecovery,
  chooseUpgrade,
  completeEncounter,
  createRun,
  enterNode,
  loadRunWithReport,
  nextRandom,
  saveRun,
  updateActiveEncounter,
  type RunState,
} from "../src/run.ts";

const LIVE_UPGRADES: readonly UpgradeId[] = [
  "auxiliary_cell",
  "ghost_step",
  "command_uplink",
  "target_designator",
  "sprint_servos",
  "shield_projector",
  "sustained_fire",
  "steady_hands",
];

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

function living(map: GameMap, team: Unit["team"]): Unit[] {
  return map.units.filter((unit) => unit.team === team && unit.hp > 0);
}

function outcome(map: GameMap): "victory" | "defeat" | null {
  const players = living(map, "player").length;
  const enemies = living(map, "enemy").length;
  if (enemies === 0) return "victory";
  if (players === 0) return "defeat";
  return null;
}

/**
 * Assertions deliberately sit inside the driver and run after every mutation.
 * A seeded simulation is only useful if it catches the first illegal state,
 * rather than noticing a strange final board thirty actions later.
 */
function assertEncounterInvariants(run: RunState, map: GameMap): void {
  const occupied = new Set<string>();
  const expectedPlayerIds = new Set(
    run.squad.filter((member) => member.hp > 0).map((member) => member.id),
  );
  const mapPlayers = map.units.filter((unit) => unit.team === "player");
  expect(new Set(mapPlayers.map((unit) => unit.id))).toEqual(expectedPlayerIds);

  for (const unit of map.units) {
    expect(Number.isInteger(unit.hp)).toBe(true);
    expect(Number.isInteger(unit.ap)).toBe(true);
    expect(unit.hp).toBeGreaterThanOrEqual(0);
    expect(unit.hp).toBeLessThanOrEqual(unit.maxHp);
    expect(unit.ap).toBeGreaterThanOrEqual(0);
    expect(unit.ap).toBeLessThanOrEqual(unit.maxAp);

    if (unit.hp > 0) {
      expect(getTile(map, unit.x, unit.y)).toBe("floor");
      const key = `${unit.x},${unit.y}`;
      expect(occupied.has(key), `living units stacked at ${key}`).toBe(false);
      occupied.add(key);
    }

    if (unit.team === "player") {
      const member = run.squad.find((candidate) => candidate.id === unit.id)!;
      expect(unit.maxHp).toBe(member.maxHp);
      expect(unit.maxAp).toBe(maxApWithUpgrades(member.baseMaxAp, run.upgrades));
    } else if (unit.archetypeId) {
      const archetype = UNIT_ARCHETYPES[unit.archetypeId as UnitArchetypeId];
      expect(archetype).toBeDefined();
      expect(unit.maxHp).toBe(archetype.maxHp);
      expect(unit.maxAp).toBe(archetype.maxAp);
    }

    // Dead watchers are already inert in settleOverwatch. What matters here is
    // that a living watch never survives after exhausting its real reactions.
    if (unit.hp > 0 && unit.overwatch) {
      expect(unit.overwatchShotsUsed ?? 0).toBeLessThan(overwatchReactions(unit));
    }
    if (unit.statuses?.dashing) expect(unit.archetypeId).toBe("runner");
    if (unit.statuses?.braced) expect(unit.archetypeId).toBe("bulwark");
  }
}

function bestVisibleTarget(map: GameMap, shooter: Unit): Unit | null {
  let best: Unit | null = null;
  let bestValue = -Infinity;
  for (const target of living(map, shooter.team === "player" ? "enemy" : "player")) {
    const shot = previewShot(map, shooter, target);
    if (!shot.shot.canShoot) continue;
    const value = shot.hitChance * shot.damage +
      (shot.damage >= target.hp ? shot.hitChance * 2 : 0);
    if (value > bestValue) {
      bestValue = value;
      best = target;
    }
  }
  return best;
}

/**
 * One multi-source walking-distance field from every living enemy. It uses the
 * same eight-way/corner geometry as gameplay, but deliberately ignores unit
 * occupancy so an ally in a doorway does not make the tactical destination
 * behind it appear permanently unreachable.
 */
function enemyDistanceField(map: GameMap): Map<string, number> {
  const key = (x: number, y: number) => `${x},${y}`;
  const distances = new Map<string, number>();
  let frontier = living(map, "enemy").map((enemy) => ({ x: enemy.x, y: enemy.y }));
  for (const point of frontier) distances.set(key(point.x, point.y), 0);
  let depth = 0;

  while (frontier.length > 0) {
    depth += 1;
    const next: Array<{ x: number; y: number }> = [];
    for (const current of frontier) {
      for (const direction of MOVE_DIRECTIONS) {
        const x = current.x + direction.x;
        const y = current.y + direction.y;
        const pointKey = key(x, y);
        if (distances.has(pointKey) || getTile(map, x, y) !== "floor") continue;
        if (!diagonalIsClear(map, current.x, current.y, x, y)) continue;
        distances.set(pointKey, depth);
        next.push({ x, y });
      }
    }
    frontier = next;
  }
  return distances;
}

function resolveWatchers(
  map: GameMap,
  mover: Unit,
  watcherTeam: Unit["team"],
  from: { x: number; y: number },
  to: { x: number; y: number },
  rng: () => number,
): void {
  for (const watcher of map.units) {
    if (watcher.team !== watcherTeam || watcher.hp <= 0 || mover.hp <= 0) continue;
    const check = settleOverwatch(map, watcher, mover, from, to);
    if (!check.fires) continue;
    watcher.resolvingOverwatch = true;
    resolveShot(map, watcher, mover, rng);
    watcher.resolvingOverwatch = false;
  }
}

function movePlayerTowardEnemy(
  run: RunState,
  map: GameMap,
  player: Unit,
  afterMutation: () => void,
): boolean {
  const range = movementRange(player);
  if (range <= 0) return false;
  const field = computeMovementField(map, player, range);
  const destinations = movementDestinations(player, field);
  if (destinations.length === 0) return false;
  const distances = enemyDistanceField(map);

  // Preserve one shot when the board permits it. If the unit has to spend the
  // whole budget just to make progress, movement still wins over standing in a
  // sealed room forever.
  const preserving = destinations.filter(
    (destination) => destination.apCost <= Math.max(0, player.ap - SHOOT_AP_COST),
  );
  const candidates = preserving.length > 0 ? preserving : destinations;
  candidates.sort((a, b) => {
    const aDistance = distances.get(`${a.x},${a.y}`) ?? Infinity;
    const bDistance = distances.get(`${b.x},${b.y}`) ?? Infinity;
    return aDistance - bDistance || b.steps - a.steps || a.apCost - b.apCost;
  });

  const chosen = candidates[0];
  const path = movementPath(field, chosen.x, chosen.y);
  let moved = false;
  for (const step of path) {
    if (player.hp <= 0) break;
    const cost = movementApCost(player);
    if (player.ap < cost) break;
    const from = { x: player.x, y: player.y };
    player.x = step.x;
    player.y = step.y;
    player.ap -= cost;
    onUnitMoved(player);
    moved = true;
    resolveWatchers(map, player, "enemy", from, step, () => nextRandom(run));
    afterMutation();
  }
  return moved;
}

function playPlayerUnit(run: RunState, map: GameMap, player: Unit): void {
  const commit = () => {
    assertEncounterInvariants(run, map);
    updateActiveEncounter(run, map, "player");
  };

  // Exercise role states as part of the integration path rather than only in
  // isolated action tests.
  const initialTarget = bestVisibleTarget(map, player);
  if (player.archetypeId === "operator" && initialTarget) {
    const alliesWithShot = living(map, "player").filter(
      (ally) => ally.id !== player.id && previewShot(map, ally, initialTarget).shot.canShoot,
    );
    if (alliesWithShot.length > 0 && actionEligibility(map, player, "mark", initialTarget).ok) {
      performAction(map, player, "mark", initialTarget, () => nextRandom(run));
      commit();
    }
  } else if (player.archetypeId === "runner" && !initialTarget) {
    if (actionEligibility(map, player, "dash").ok) {
      performAction(map, player, "dash", null, () => nextRandom(run));
      commit();
    }
  } else if (player.archetypeId === "bulwark") {
    const ally = living(map, "player").find(
      (candidate) =>
        candidate.id !== player.id &&
        candidate.hp < candidate.maxHp &&
        actionEligibility(map, player, "guard", candidate).ok,
    );
    if (ally) {
      performAction(map, player, "guard", ally, () => nextRandom(run));
      commit();
    }
  }

  let safety = 24;
  while (!isSpent(player) && player.hp > 0 && living(map, "enemy").length > 0 && safety-- > 0) {
    const target = bestVisibleTarget(map, player);
    if (target && player.ap >= SHOOT_AP_COST) {
      const shot = performAction(map, player, "shoot", target, () => nextRandom(run));
      expect(shot.ok).toBe(true);
      commit();
      continue;
    }

    if (movePlayerTowardEnemy(run, map, player, commit)) continue;

    if (player.ap >= 2 && actionEligibility(map, player, "overwatch").ok) {
      const watch = performAction(map, player, "overwatch", null, () => nextRandom(run));
      expect(watch.ok).toBe(true);
      commit();
    }
    break;
  }
  expect(safety).toBeGreaterThanOrEqual(0);
}

function beginPlayerPhase(run: RunState, map: GameMap): void {
  for (const player of living(map, "player")) beginUnitTurn(player);
  refreshEnemyIntents(map);
  assertEncounterInvariants(run, map);
  updateActiveEncounter(run, map, "player");
}

function playEnemyPhase(run: RunState, map: GameMap): void {
  // Mirror runtime.ts exactly: all player statuses tick together, then all
  // enemies receive their begin-turn reset before any hostile acts.
  for (const player of living(map, "player")) endUnitTurn(player);
  for (const enemy of living(map, "enemy")) beginUnitTurn(enemy);
  updateActiveEncounter(run, map, "enemy");

  const session = createAiSession();
  const rng = () => nextRandom(run);
  for (const enemy of map.units.filter((unit) => unit.team === "enemy")) {
    if (enemy.hp <= 0 || living(map, "player").length === 0) continue;
    beginEnemyTurn(map, enemy, session);
    assertEncounterInvariants(run, map);

    let safety = 32;
    while (!isSpent(enemy) && enemy.hp > 0 && living(map, "player").length > 0 && safety-- > 0) {
      const action = takeEnemyAction(map, enemy, session, rng);
      if (action.kind === "move") {
        resolveWatchers(map, enemy, "player", action.from, action.to, rng);
      }
      assertEncounterInvariants(run, map);
      if (action.kind === "wait") break;
    }
    expect(safety).toBeGreaterThanOrEqual(0);
  }

  for (const enemy of living(map, "enemy")) endUnitTurn(enemy);
  if (!outcome(map)) {
    for (const player of living(map, "player")) beginUnitTurn(player);
    refreshEnemyIntents(map);
  }

  // This is the persistence seam Wave 2 made transactional. Wave 4 drives it
  // with a complete hostile phase rather than a hand-mutated fixture.
  updateActiveEncounter(run, map, "player");
  assertEncounterInvariants(run, map);
}

function reloadAtStableBoundary(run: RunState): RunState {
  const before = run.activeEncounter
    ? JSON.parse(JSON.stringify(run.activeEncounter.map))
    : null;
  expect(saveRun(run)).toBe(true);
  const loaded = loadRunWithReport();
  expect(loaded.error).toBeNull();
  expect(loaded.run).not.toBeNull();
  if (before) expect(loaded.run!.activeEncounter!.map).toEqual(before);
  return loaded.run!;
}

function playLiveEncounter(start: RunState, maxRounds = 32): { run: RunState; rounds: number } {
  let run = start;
  if (!run.activeEncounter) throw new Error("Expected active encounter");
  let map = run.activeEncounter.map;
  beginPlayerPhase(run, map);

  for (let round = 1; round <= maxRounds; round++) {
    for (const player of map.units.filter((unit) => unit.team === "player")) {
      if (player.hp <= 0 || outcome(map)) break;
      playPlayerUnit(run, map, player);
    }

    let result = outcome(map);
    if (!result) {
      playEnemyPhase(run, map);
      result = outcome(map);
    } else {
      updateActiveEncounter(run, map, "player");
    }

    if (result) {
      completeEncounter(run, result, map);
      return { run, rounds: round };
    }

    // Reload every completed round. This makes serialization/rehydration part
    // of the ordinary simulation path instead of one bespoke persistence test.
    run = reloadAtStableBoundary(run);
    map = run.activeEncounter!.map;
  }

  throw new Error(`Live encounter '${run.seed}' did not resolve within ${maxRounds} rounds`);
}

describe("procedural run state machine", () => {
  it("fuzzes 1,000 seeded route/progression sequences without pretending they are combat", () => {
    for (let seed = 0; seed < 1_000; seed++) {
      const run = createRun(`ROUTE-${seed}`);
      let transitions = 0;
      while (run.status !== "victory") {
        transitions += 1;
        expect(transitions).toBeLessThan(30);
        if (run.status === "route") {
          const nodes = availableNodes(run);
          expect(nodes.length).toBeGreaterThan(0);
          enterNode(run, nodes[seed % nodes.length].id);
        } else if (run.status === "encounter") {
          // This test is intentionally only the progression state machine.
          // Live combat is exercised separately below.
          for (const enemy of run.activeEncounter!.map.units.filter((unit) => unit.team === "enemy")) {
            enemy.hp = 0;
          }
          completeEncounter(run, "victory", run.activeEncounter!.map);
        } else if (run.status === "reward") {
          expect(run.pendingRewards.length).toBeGreaterThan(0);
          chooseUpgrade(run, run.pendingRewards[seed % run.pendingRewards.length]);
        } else if (run.status === "recovery") {
          const survivor = run.squad.find((member) => member.hp > 0);
          expect(survivor).toBeDefined();
          chooseRecovery(run, survivor!.id);
        } else {
          throw new Error(`Unexpected simulated status ${run.status}`);
        }
      }
      expect(run.depth).toBe(run.route.length);
      expect(run.stats.combatsWon).toBeGreaterThanOrEqual(5);
    }
  }, 60_000);
});

describe("live tactical integration simulation", () => {
  it("plays upgraded generated encounters through real movement, AI, reactions, and reloads", () => {
    let victories = 0;
    let defeats = 0;
    let totalRounds = 0;

    for (let seed = 0; seed < 12; seed++) {
      let run = createRun(`LIVE-${seed}`);
      run.upgrades.push(...LIVE_UPGRADES);
      enterNode(run, availableNodes(run)[0].id);
      const played = playLiveEncounter(run);
      run = played.run;
      totalRounds += played.rounds;
      if (run.status === "reward") victories += 1;
      else if (run.status === "defeat") defeats += 1;
      else throw new Error(`Unexpected post-combat status ${run.status}`);
    }

    expect(victories + defeats).toBe(12);
    expect(totalRounds).toBeGreaterThan(0);
  }, 90_000);
});
