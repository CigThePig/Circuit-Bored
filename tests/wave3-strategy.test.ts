import { describe, expect, it } from "vitest";
import {
  beginEnemyTurn,
  overwatchRouteReactions,
  planEnemyIntent,
  takeEnemyAction,
} from "../src/ai.ts";
import { performAction } from "../src/actions.ts";
import { canShootTarget, checkOverwatch } from "../src/combat.ts";
import {
  UNIT_ARCHETYPES,
  getUpgrade,
  makeArchetypeUnit,
} from "../src/content.ts";
import { floorPathDistance } from "../src/generationAnalysis.ts";
import { createAiSession } from "../src/aiSession.ts";
import { preferredBand, tileDistance } from "../src/range.ts";
import {
  availableNodes,
  createRun,
  enterNode,
} from "../src/run.ts";
import { buildMap } from "./fixtures.ts";

describe("Wave 3 range-aware AI", () => {
  it("keeps a flat Rifleman neutral instead of secretly preferring close range", () => {
    expect(preferredBand(UNIT_ARCHETYPES.rifleman.profile)).toBe("medium");
  });

  it("does not make a range-neutral Rifleman reposition just because a target is far away", () => {
    const map = buildMap(["............"]);
    const enemy = makeArchetypeUnit("rifleman", "rifleman", 0, 0);
    const player = makeArchetypeUnit("operator", "rook", 11, 0);
    map.units.push(enemy, player);
    const session = createAiSession();

    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);

    expect(action.kind).toBe("shoot");
  });

  it("has a Scrapper close before taking a poor long-range shot", () => {
    const map = buildMap(["............"]);
    const enemy = makeArchetypeUnit("scrapper", "scrapper", 0, 0);
    const player = makeArchetypeUnit("operator", "rook", 11, 0);
    map.units.push(enemy, player);
    const before = tileDistance(enemy, player);
    const session = createAiSession();

    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);

    expect(action.kind).toBe("move");
    expect(tileDistance(enemy, player)).toBeLessThan(before);
  });

  it("has a Marksman back away when a visible target is inside its preferred lane", () => {
    const map = buildMap(["............."]);
    const player = makeArchetypeUnit("operator", "rook", 0, 0);
    const enemy = makeArchetypeUnit("marksman", "marksman", 6, 0);
    map.units.push(player, enemy);
    const before = tileDistance(enemy, player);
    const intent = planEnemyIntent(map, enemy);
    const session = createAiSession();

    expect(intent.kind).toBe("reposition");
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);

    expect(action.kind).toBe("move");
    expect(tileDistance(enemy, player)).toBeGreaterThan(before);
  });

  it("uses ordinary Aim when one prepared shot beats two bad unaimed shots", () => {
    const map = buildMap([
      ".#..",
      "..h.",
    ]);
    const enemy = makeArchetypeUnit("rifleman", "rifleman", 0, 0);
    const player = makeArchetypeUnit("operator", "rook", 3, 1);
    map.units.push(enemy, player);
    expect(performAction(map, player, "hunker").ok).toBe(true);
    const session = createAiSession();

    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.99);

    expect(action.kind).toBe("shoot");
    if (action.kind === "shoot") expect(action.result.usedAim).toBe(true);
    expect(enemy.ap).toBe(1);
  });

  it("does not call a range-improving route safe when an intermediate step is watched", () => {
    const map = buildMap([
      "..#....h",
      ".....#.#",
      "........",
      "..h....#",
      "........",
      ".......h",
      "...#....",
      "h.......",
    ]);
    const enemy = makeArchetypeUnit("scrapper", "enemy", 2, 4);
    const target = makeArchetypeUnit("operator", "target", 7, 7);
    const watcher = makeArchetypeUnit("operator", "watcher", 0, 0);
    watcher.overwatch = true;
    map.units.push(enemy, target, watcher);
    expect(canShootTarget(map, enemy, target).canShoot).toBe(true);
    const session = createAiSession();

    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);

    if (action.kind === "move") {
      expect(checkOverwatch(map, watcher, enemy, action.from, action.to).fires).toBe(false);
    } else {
      expect(action.kind).toBe("shoot");
    }
  });
});

describe("Wave 3 route control", () => {
  it("prices every reaction a watched route can actually consume", () => {
    const map = buildMap(["......."]);
    const watcher = makeArchetypeUnit(
      "operator",
      "watcher",
      0,
      0,
      ["command_uplink"],
    );
    const enemy = makeArchetypeUnit("rifleman", "enemy", 6, 0);
    watcher.overwatch = true;
    map.units.push(watcher, enemy);
    const path = [
      { x: 5, y: 0 },
      { x: 4, y: 0 },
      { x: 3, y: 0 },
    ];

    expect(overwatchRouteReactions(map, enemy, path)).toBe(2);
    watcher.overwatchShotsUsed = 1;
    expect(overwatchRouteReactions(map, enemy, path)).toBe(1);
  });
});

describe("Wave 3 generation movement truth", () => {
  it("measures an open diagonal with the same eight-way steps units use", () => {
    const map = buildMap([
      "....",
      "....",
      "....",
      "....",
    ]);
    expect(floorPathDistance(map, { x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
  });

  it("does not let the generation metric squeeze diagonally through a blocked corner", () => {
    const map = buildMap([
      ".#",
      "#.",
    ]);
    expect(floorPathDistance(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(Infinity);
  });
});

describe("Wave 3 contextual rewards", () => {
  it("does not offer role circuits that no surviving operator can use", () => {
    for (let seed = 0; seed < 24; seed++) {
      const run = createRun(`DEAD-ROLE-${seed}`);
      run.depth = 4;
      run.squad.find((member) => member.archetypeId === "operator")!.hp = 0;
      run.squad.find((member) => member.archetypeId === "runner")!.hp = 0;
      const cache = availableNodes(run).find((node) => node.kind === "cache")!;

      enterNode(run, cache.id);

      expect(run.pendingRewards).not.toContain("target_designator");
      expect(run.pendingRewards).not.toContain("sprint_servos");
      expect(run.pendingRewards.some((id) => getUpgrade(id).tag === "tactic")).toBe(true);
    }
  });

  it("keeps contextual reward rolls deterministic for the same run state", () => {
    const rewards = (seed: string) => {
      const run = createRun(seed);
      run.depth = 4;
      run.upgrades.push("smartlink");
      const cache = availableNodes(run).find((node) => node.kind === "cache")!;
      enterNode(run, cache.id);
      return run.pendingRewards;
    };

    expect(rewards("CONTEXT-REWARD")).toEqual(rewards("CONTEXT-REWARD"));
  });
});
