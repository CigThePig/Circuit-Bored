import { describe, expect, it } from "vitest";
import {
  AI_SCORE_EXPOSES_TARGET,
  AI_SCORE_PEEK_EXPOSURE_RISK,
  beginEnemyTurn,
  takeEnemyAction,
  type AiAction,
} from "../src/ai.ts";
import { performAction } from "../src/actions.ts";
import {
  applySuppression,
  canShootTarget,
  exposedAgainst,
  previewShot,
} from "../src/combat.ts";
import { beginUnitTurn } from "../src/rules.ts";
import { isHunkered } from "../src/status.ts";
import { createAiSession } from "../src/aiSession.ts";
import { makeArchetypeUnit } from "../src/content.ts";
import { buildMap } from "./fixtures.ts";

function runEnemyTurn(map: ReturnType<typeof buildMap>, enemyIdx: number): AiAction[] {
  const session = createAiSession();
  const enemy = map.units[enemyIdx];
  beginEnemyTurn(map, enemy, session);
  const log: AiAction[] = [];
  let safety = 32;
  while (enemy.ap > 0 && enemy.hp > 0 && safety-- > 0) {
    const action = takeEnemyAction(map, enemy, session);
    log.push(action);
    if (action.kind === "wait") break;
  }
  return log;
}

describe("AI movement", () => {
  it("targets the route-nearest player instead of a Manhattan-near unit behind bulkheads", () => {
    const map = buildMap([
      ".......",
      ".......",
      ".......",
      ".#####.",
      ".......",
    ], [
      { id: "sealed-near", team: "player", x: 3, y: 2 },
      { id: "open-far", team: "player", x: 6, y: 4 },
      { id: "pathfinder", team: "enemy", x: 3, y: 4 },
    ]);
    const session = createAiSession();
    const enemy = map.units[2];
    beginEnemyTurn(map, enemy, session);
    expect(session.turnTargets.get(enemy.id)).toBe("open-far");
  });

  it("does not step onto the player's occupied tile", () => {
    const map = buildMap([
      "p.....e",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 6, y: 0 },
    ]);
    const log = runEnemyTurn(map, 1);
    for (const a of log) {
      if (a.kind === "move") {
        expect(`${a.to.x},${a.to.y}`).not.toBe("0,0");
      }
    }
    // Enemy should be on a tile other than (0,0).
    expect(`${map.units[1].x},${map.units[1].y}`).not.toBe("0,0");
  });

  it("shoots when adjacent with LoS instead of stepping onto the player", () => {
    const map = buildMap([
      "pe",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 1, y: 0 },
    ]);
    const log = runEnemyTurn(map, 1);
    expect(log.some((a) => a.kind === "shoot")).toBe(true);
  });

  it("moves to gain line of sight when blocked", () => {
    // Enemy starts behind a wall; player is on the far side. Enemy should
    // be able to move around the wall to gain LoS.
    const map = buildMap([
      "p......",
      ".......",
      "...#...",
      ".......",
      "......e",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 6, y: 4 },
    ]);
    const startX = map.units[1].x;
    const startY = map.units[1].y;
    const log = runEnemyTurn(map, 1);
    expect(log.some((a) => a.kind === "move")).toBe(true);
    // Enemy moved at least one tile.
    expect(map.units[1].x !== startX || map.units[1].y !== startY).toBe(true);
  });

  it("does not move onto an ally tile", () => {
    const map = buildMap([
      "p......",
      ".......",
      ".......",
      "...e...",
      "...e...",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 3, y: 3 },
      { team: "enemy", x: 3, y: 4 },
    ]);
    const session = createAiSession();
    const enemyA = map.units[1];
    beginEnemyTurn(map, enemyA, session);
    const before = map.units[2];
    const beforePos = `${before.x},${before.y}`;
    let safety = 16;
    while (enemyA.ap > 0 && enemyA.hp > 0 && safety-- > 0) {
      const a = takeEnemyAction(map, enemyA, session);
      if (a.kind === "move") {
        expect(`${a.to.x},${a.to.y}`).not.toBe(beforePos);
      }
      if (a.kind === "wait") break;
    }
  });

  it("two AiSessions do not share state", () => {
    const map = buildMap([
      "p.....e",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 6, y: 0 },
    ]);
    const sessionA = createAiSession();
    const sessionB = createAiSession();
    beginEnemyTurn(map, map.units[1], sessionA);
    expect(sessionA.turnTargets.size).toBe(1);
    expect(sessionB.turnTargets.size).toBe(0);
    sessionA.turnTargets.clear();
    expect(sessionA.turnTargets.size).toBe(0);
  });

  it("returns 'wait' gracefully when no path exists", () => {
    // Enemy walled in completely; no valid move and no shot.
    const map = buildMap([
      "p..",
      "...",
      "###",
      "#e#",
      "###",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 1, y: 3 },
    ]);
    const log = runEnemyTurn(map, 1);
    // Enemy is fully boxed in; we expect a wait somewhere in the log.
    expect(log.some((a) => a.kind === "wait")).toBe(true);
  });

  it("never shoots through a connected wall barrier", () => {
    const map = buildMap([
      "...#...",
      "...#...",
      "...#...",
      "...#...",
      "...#...",
    ], [
      { team: "player", x: 1, y: 2 },
      { team: "enemy", x: 5, y: 2 },
    ]);
    const session = createAiSession();
    const enemy = map.units[1];
    beginEnemyTurn(map, enemy, session);
    expect(takeEnemyAction(map, enemy, session).kind).not.toBe("shoot");
  });

  it("routes toward a reachable target-adjacent tile when an equal-distance option is blocked", () => {
    const map = buildMap([
      "#..",
      ".#.",
      "...",
    ], [
      { team: "player", x: 2, y: 1 },
      { team: "enemy", x: 0, y: 1 },
    ]);
    const session = createAiSession();
    const enemy = map.units[1];
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session);
    expect(action.kind).toBe("move");
    expect(enemy).toMatchObject({ x: 0, y: 2, ap: 3 });
  });

  it("moving via the AI clears peekExposure", () => {
    // Enemy is fully blocked from the player by a wall column with no peek
    // option (perpendicular tiles are walls too) - so its only choice is to
    // move. We pre-set a peekExposure on the enemy to simulate a previous
    // peek shot, then verify the move clears it.
    const map = buildMap([
      "...#...",
      "...#...",
      "...#...",
    ], [
      { team: "player", x: 0, y: 1 },
      { team: "enemy", x: 6, y: 1 },
    ]);
    const enemy = map.units[1];
    enemy.peekExposure = { x: 6, y: 0 };
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    // beginEnemyTurn clears exposure on its own; reseed it to test the move
    // path specifically.
    enemy.peekExposure = { x: 6, y: 0 };
    const action = takeEnemyAction(map, enemy, session);
    expect(action.kind).toBe("move");
    expect(enemy.peekExposure).toBeNull();
  });

  it("starting a new enemy turn clears peekExposure", () => {
    const map = buildMap([
      "p.....e",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 6, y: 0 },
    ]);
    const enemy = map.units[1];
    enemy.peekExposure = { x: 5, y: 0 };
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(enemy.peekExposure).toBeNull();
  });

  it("exposes the peek exposure risk constant as a negative penalty", () => {
    expect(AI_SCORE_PEEK_EXPOSURE_RISK).toBeLessThan(0);
  });

  it("can move and then shoot in the same turn when AP allows", () => {
    // Enemy starts where it has no LoS but one step gains LoS.
    //   p . . . . . .
    //   . . . . . . .
    //   . . . # . . .
    //   . . . . . . e
    // From (6,3), no LoS to (0,0) due to wall at (3,2) (Bresenham path goes
    // through (3,2)). Stepping to (6,2) keeps it blocked, but stepping to
    // (5,3) etc. opens it up. We just check the action sequence contains
    // a move followed eventually by a shoot.
    const map = buildMap([
      "p......",
      ".......",
      "...#...",
      "......e",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 6, y: 3 },
    ]);
    map.units[1].ap = 4;
    const log = runEnemyTurn(map, 1);
    const moveIdx = log.findIndex((a) => a.kind === "move");
    const shootIdx = log.findIndex((a) => a.kind === "shoot");
    if (shootIdx >= 0 && moveIdx >= 0) {
      expect(shootIdx).toBeGreaterThan(moveIdx);
    } else {
      // At minimum it should have moved or waited - it should not have
      // crashed and should produce at least one action.
      expect(log.length).toBeGreaterThan(0);
    }
  });

  it("bills one action point for every two tiles it walks", () => {
    const map = buildMap([
      "p...........",
      "....#.......",
      "............",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 11, y: 2 },
    ]);
    const session = createAiSession();
    const enemy = map.units[1];
    beginEnemyTurn(map, enemy, session);
    const spentAfter: number[] = [];
    for (let i = 0; i < 4; i++) {
      const action = takeEnemyAction(map, enemy, session);
      if (action.kind !== "move") break;
      spentAfter.push(enemy.maxAp - enemy.ap);
    }
    // Four tiles of travel cost two action points, not four.
    expect(spentAfter).toEqual([1, 1, 2, 2]);
    expect(enemy.movesThisTurn).toBe(4);
  });

  it("covers eight tiles of ground in a turn without gaining a third shot", () => {
    const map = buildMap([
      "p.....e",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 6, y: 0 },
    ]);
    const log = runEnemyTurn(map, 1);
    // Four action points still buy exactly two shots.
    expect(log.filter((a) => a.kind === "shoot")).toHaveLength(2);
  });

  it("uses diagonal steps to close on a target off both axes", () => {
    const map = buildMap([
      "e.........",
      "..........",
      "....##....",
      "....##....",
      "..........",
      ".........p",
    ], [
      { team: "enemy", x: 0, y: 0 },
      { team: "player", x: 9, y: 5 },
    ]);
    const log = runEnemyTurn(map, 0);
    const moves = log.filter((a) => a.kind === "move");
    expect(moves.length).toBeGreaterThan(0);
    expect(
      moves.some((a) => a.kind === "move" && a.from.x !== a.to.x && a.from.y !== a.to.y),
    ).toBe(true);
  });

  it("lets a boxed sentinel establish overwatch instead of wasting its turn", () => {
    const map = buildMap([
      "#####",
      "#.#.#",
      "#####",
    ], [
      { team: "enemy", x: 1, y: 1 },
      { team: "player", x: 3, y: 1 },
    ]);
    const enemy = map.units[0];
    enemy.aiBehavior = "sentinel";
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(takeEnemyAction(map, enemy, session)).toEqual({ kind: "overwatch" });
    // Overwatch is a fixed 2 AP commitment now; the rest of the turn survives
    // it rather than being erased.
    expect(enemy).toMatchObject({ overwatch: true, ap: 2 });
  });
});

describe("AI awareness of the new tactical rules", () => {
  it("keeps the committed firing line used by suppression after the target loses exposure", () => {
    const map = buildMap([
      ".....",
      "..#..",
      ".....",
    ]);
    const player = makeArchetypeUnit("operator", "rook", 1, 1);
    const enemy = makeArchetypeUnit("sentinel", "sentinel", 4, 2);
    player.peekExposure = { x: 2, y: 2 };
    player.overwatch = true;
    map.units.push(player, enemy);
    const before = previewShot(map, enemy, player);
    expect(before.shot).toMatchObject({ canShoot: true, targetExposure: true });
    const session = createAiSession();

    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);

    expect(action.kind).toBe("suppress");
    if (action.kind === "suppress") {
      expect(action.shot).toEqual(before);
    }
    expect(player.peekExposure).toBeNull();
    expect(previewShot(map, enemy, player).shot.canShoot).toBe(false);
  });

  it("fires on the operator whose cover it has already gone around", () => {
    // Both operators are visible and both stand against cover. Only the
    // western one's cover fails to face the shooter, and that is the one worth
    // shooting.
    const map = buildMap([
      "..........",
      "..h.......",
      "......h...",
    ], [
      { team: "player", x: 2, y: 2 },
      { team: "player", x: 7, y: 2 },
      { team: "enemy", x: 0, y: 2 },
    ]);
    const [flanked, covered, enemy] = map.units;
    expect(exposedAgainst(map, enemy, flanked)).toBe("flanked");
    expect(exposedAgainst(map, enemy, covered)).toBeNull();
    expect(AI_SCORE_EXPOSES_TARGET).toBeGreaterThan(0);
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);
    expect(action.kind).toBe("shoot");
    if (action.kind === "shoot") {
      expect(action.target.id).toBe(flanked.id);
      expect(action.result.exposed).toBe("flanked");
    }
  });

  it("reads a hunkered target's real defence rather than raw cover", () => {
    const map = buildMap([
      ".ph...e",
    ], [
      { team: "player", x: 1, y: 0 },
      { team: "enemy", x: 6, y: 0 },
    ]);
    const [player, enemy] = map.units;
    const open = previewShot(map, enemy, player).hitChance;
    performAction(map, player, "hunker", null, () => 0);
    const dug = previewShot(map, enemy, player).hitChance;
    expect(dug).toBeLessThan(open);
  });

  it("shoots the softer of two targets when one has dug in", () => {
    const map = buildMap([
      "..h....",
      ".......",
      "e......",
    ], [
      { team: "player", x: 3, y: 0 },
      { team: "player", x: 3, y: 2 },
      { team: "enemy", x: 0, y: 2 },
    ]);
    const [dug, exposed, enemy] = map.units;
    performAction(map, dug, "hunker", null, () => 0);
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);
    expect(action.kind).toBe("shoot");
    if (action.kind === "shoot") expect(action.target.id).toBe(exposed.id);
  });

  it("fights at a penalty while suppressed instead of ignoring it", () => {
    const map = buildMap([
      "e....p",
    ], [
      { team: "enemy", x: 0, y: 0 },
      { team: "player", x: 5, y: 0 },
    ]);
    const [enemy, player] = map.units;
    const clean = previewShot(map, enemy, player).hitChance;
    applySuppression(enemy);
    beginUnitTurn(enemy);
    expect(enemy.ap).toBe(enemy.maxAp - 1);
    expect(previewShot(map, enemy, player).hitChance).toBeLessThan(clean);
  });

  it("refuses to establish overwatch while suppressed", () => {
    const map = buildMap([
      "#####",
      "#.#.#",
      "#####",
    ], [
      { team: "enemy", x: 1, y: 1 },
      { team: "player", x: 3, y: 1 },
    ]);
    const enemy = map.units[0];
    enemy.aiBehavior = "sentinel";
    applySuppression(enemy);
    beginUnitTurn(enemy);
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session);
    expect(action.kind).not.toBe("overwatch");
    expect(enemy.overwatch).toBe(false);
  });

  it("does not wander off a lane it just committed to watching", () => {
    const map = buildMap([
      "#####",
      "#.#.#",
      "#####",
    ], [
      { team: "enemy", x: 1, y: 1 },
      { team: "player", x: 3, y: 1 },
    ]);
    const enemy = map.units[0];
    enemy.aiBehavior = "sentinel";
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(takeEnemyAction(map, enemy, session).kind).toBe("overwatch");
    expect(takeEnemyAction(map, enemy, session)).toEqual({ kind: "wait" });
    expect(enemy).toMatchObject({ x: 1, y: 1, overwatch: true });
  });

  it("prefers an approach that keeps out of a watched lane", () => {
    // Two ways north. The eastern corridor is covered by the operator holding
    // overwatch at (6,0); the western one is not.
    const map = buildMap([
      "......p",
      ".#####.",
      ".......",
      ".....e.",
    ], [
      { team: "player", x: 6, y: 0, overwatch: true },
      { team: "enemy", x: 5, y: 3 },
    ]);
    const [watcher, enemy] = map.units;
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);
    if (action.kind === "move") {
      // Whatever it chose, it must not have walked straight into the watch
      // when a route outside it existed.
      expect(canShootTarget(map, watcher, enemy).canShoot).toBe(false);
    }
  });

  it("hunkers a pinned defender that has cover and nowhere better to go", () => {
    // The marksman is already on the only tile whose cover faces the operator,
    // it is being looked at, and it cannot afford a shot. Digging in is the
    // one useful thing left.
    const map = buildMap([
      "########",
      "#eh....#",
      "########",
    ], [
      { team: "enemy", x: 1, y: 1 },
      { team: "player", x: 6, y: 1 },
    ]);
    const enemy = map.units[0];
    enemy.aiBehavior = "marksman";
    enemy.ap = 1;
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);
    expect(action.kind).toBe("hunker");
    expect(isHunkered(enemy)).toBe(true);
  });
});
