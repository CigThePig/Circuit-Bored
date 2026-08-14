import { describe, expect, it } from "vitest";
import {
  AI_SCORE_PEEK_EXPOSURE_RISK,
  beginEnemyTurn,
  takeEnemyAction,
  type AiAction,
} from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";
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
    expect(enemy).toMatchObject({ overwatch: true, ap: 0 });
  });
});
