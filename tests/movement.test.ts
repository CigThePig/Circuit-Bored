import { describe, expect, it } from "vitest";
import {
  canStep,
  computeMovementField,
  findMovementPath,
  movementDestinations,
  movementPath,
} from "../src/movement.ts";
import {
  isSpent,
  movementApCost,
  movementApCostForTiles,
  movementRange,
  resetTurnState,
  TILES_PER_MOVE_AP,
} from "../src/rules.ts";
import { makeArchetypeUnit } from "../src/content.ts";
import { buildMap, unit } from "./fixtures.ts";

const openRow = (width: number) => ".".repeat(width);

/** Walks a unit along a path the way the runtime does, tile by tile. */
function walk(mover: ReturnType<typeof unit>, path: { x: number; y: number }[]): void {
  for (const step of path) {
    const cost = movementApCost(mover);
    expect(mover.ap).toBeGreaterThanOrEqual(cost);
    mover.ap -= cost;
    mover.x = step.x;
    mover.y = step.y;
    mover.movesThisTurn = (mover.movesThisTurn ?? 0) + 1;
  }
}

describe("movement budget", () => {
  it("gives a turn twice the travel of its action points", () => {
    const mover = unit({ team: "player", x: 0, y: 0, ap: 4, maxAp: 4 });
    expect(movementRange(mover)).toBe(8);
    expect(TILES_PER_MOVE_AP).toBe(2);
  });

  it("charges one action point per two tiles walked", () => {
    const mover = unit({ team: "player", x: 0, y: 0, ap: 4, maxAp: 4 });
    expect(movementApCostForTiles(mover, 1)).toBe(1);
    expect(movementApCostForTiles(mover, 2)).toBe(1);
    expect(movementApCostForTiles(mover, 3)).toBe(2);
    expect(movementApCostForTiles(mover, 8)).toBe(4);
  });

  it("keeps the shooting budget untouched while movement doubles", () => {
    // Two shots at two action points each still exhausts the same turn that
    // now carries eight tiles of travel instead of four.
    const map = buildMap([openRow(12)], [{ team: "player", x: 0, y: 0 }]);
    const mover = map.units[0];
    const SHOT_AP_COST = 2;
    expect(Math.floor(mover.maxAp / SHOT_AP_COST)).toBe(2);
    walk(mover, findMovementPath(map, mover, 8, 0));
    expect(mover).toMatchObject({ x: 8, y: 0, ap: 0, movesThisTurn: 8 });
    expect(mover.ap).toBeLessThan(SHOT_AP_COST);
  });

  it("banks the tile already paid for when a move stops mid action point", () => {
    const mover = unit({ team: "player", x: 0, y: 0, ap: 4, maxAp: 4 });
    mover.ap -= movementApCostForTiles(mover, 1);
    mover.movesThisTurn = 1;
    expect(mover.ap).toBe(3);
    expect(movementRange(mover)).toBe(7);
    expect(movementApCost(mover)).toBe(0);
    expect(isSpent(mover)).toBe(false);
  });

  it("treats a unit with no action points and no paid tile as spent", () => {
    const mover = unit({ team: "player", x: 0, y: 0, ap: 0, maxAp: 4 });
    mover.movesThisTurn = 8;
    expect(movementRange(mover)).toBe(0);
    expect(isSpent(mover)).toBe(true);
    resetTurnState(mover);
    expect(movementRange(mover)).toBe(8);
  });

  it("spends a free first move as a full action point of travel", () => {
    const mover = makeArchetypeUnit("operator", "p", 0, 0, ["ghost_step"]);
    expect(movementRange(mover)).toBe(mover.ap * TILES_PER_MOVE_AP + TILES_PER_MOVE_AP);
    expect(movementApCostForTiles(mover, TILES_PER_MOVE_AP)).toBe(0);
    expect(movementApCostForTiles(mover, TILES_PER_MOVE_AP + 1)).toBe(1);
  });
});

describe("movement geometry", () => {
  it("reaches eight tiles away in one selection", () => {
    const map = buildMap([openRow(12)], [{ team: "player", x: 0, y: 0 }]);
    const mover = map.units[0];
    const field = computeMovementField(map, mover);
    const path = movementPath(field, 8, 0);
    expect(path).toHaveLength(8);
    expect(path[path.length - 1]).toEqual({ x: 8, y: 0 });
    expect(movementPath(field, 9, 0)).toEqual([]);
  });

  it("walks diagonally, so a corner destination costs one step per rank", () => {
    const map = buildMap([
      openRow(6),
      openRow(6),
      openRow(6),
      openRow(6),
    ], [{ team: "player", x: 0, y: 0 }]);
    const mover = map.units[0];
    expect(canStep(map, mover, 0, 0, 1, 1)).toBe(true);
    const field = computeMovementField(map, mover);
    expect(movementPath(field, 3, 3)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(field.nodes.get("3,1")!.steps).toBe(3);
  });

  it("covers a full eight-tile radius on open ground", () => {
    const map = buildMap(Array.from({ length: 17 }, () => openRow(17)), [
      { team: "player", x: 8, y: 8 },
    ]);
    const mover = map.units[0];
    const destinations = movementDestinations(mover, computeMovementField(map, mover));
    // Eight-way movement makes the reachable set a 17x17 square minus the
    // origin: every tile within a Chebyshev distance of eight.
    expect(destinations).toHaveLength(17 * 17 - 1);
    expect(destinations.every(({ x, y }) => Math.max(Math.abs(x - 8), Math.abs(y - 8)) <= 8)).toBe(true);
  });

  it("refuses to squeeze a diagonal between two blocked tiles", () => {
    const map = buildMap([
      "..#",
      ".#.",
      "...",
    ], [{ team: "player", x: 1, y: 0 }]);
    const mover = map.units[0];
    // (2,1) sits between the wall at (2,0) and the wall at (1,1).
    expect(canStep(map, mover, 1, 0, 2, 1)).toBe(false);
    const field = computeMovementField(map, mover);
    // The only route is the long way round the wall block.
    expect(movementPath(field, 2, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ]);
  });

  it("does not cut the corner of a doorway", () => {
    const map = buildMap([
      "...#...",
      "...#...",
      ".......",
    ], [{ team: "player", x: 2, y: 0 }]);
    const mover = map.units[0];
    expect(canStep(map, mover, 2, 1, 3, 2)).toBe(false);
    expect(canStep(map, mover, 2, 2, 3, 2)).toBe(true);
  });

  it("routes around half cover and never stops on it", () => {
    const map = buildMap([
      ".h.",
      ".h.",
      "...",
    ], [{ team: "player", x: 0, y: 0 }]);
    const mover = map.units[0];
    const field = computeMovementField(map, mover);
    expect(field.nodes.has("1,0")).toBe(false);
    expect(field.nodes.has("1,1")).toBe(false);
    expect(movementPath(field, 2, 0)).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
    ]);
  });

  it("blocks tiles held by other units but keeps the walk itself legal", () => {
    const map = buildMap([openRow(6)], [
      { id: "mover", team: "player", x: 0, y: 0 },
      { id: "ally", team: "player", x: 2, y: 0 },
    ]);
    const mover = map.units[0];
    const field = computeMovementField(map, mover);
    expect(field.nodes.has("2,0")).toBe(false);
    expect(movementPath(field, 3, 0)).toEqual([]);
  });

  it("stops the radius at the tiles the remaining budget can pay for", () => {
    const map = buildMap([openRow(12)], [{ team: "player", x: 0, y: 0, ap: 1 }]);
    const mover = map.units[0];
    const destinations = movementDestinations(mover, computeMovementField(map, mover));
    expect(destinations.map(({ x }) => x).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(destinations.every(({ apCost }) => apCost === 1)).toBe(true);
  });

  it("labels each destination with the action points stopping there costs", () => {
    const map = buildMap([openRow(12)], [{ team: "player", x: 0, y: 0 }]);
    const mover = map.units[0];
    const byX = new Map(
      movementDestinations(mover, computeMovementField(map, mover)).map((tile) => [tile.x, tile.apCost]),
    );
    expect([...byX.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3], [7, 4], [8, 4],
    ]);
  });

  it("returns a contiguous single-step path", () => {
    const map = buildMap([
      "...#...",
      ".......",
      ".......",
    ], [{ team: "player", x: 0, y: 0 }]);
    const mover = map.units[0];
    const path = findMovementPath(map, mover, 6, 0);
    expect(path.length).toBeGreaterThan(0);
    expect(path.length).toBeLessThanOrEqual(movementRange(mover));
    let prev = { x: mover.x, y: mover.y };
    for (const step of path) {
      expect(canStep(map, mover, prev.x, prev.y, step.x, step.y)).toBe(true);
      prev = step;
    }
    expect(prev).toEqual({ x: 6, y: 0 });
    expect(path.some(({ x, y }) => x === 3 && y === 0)).toBe(false);
  });
});
