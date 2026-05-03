import { describe, expect, it } from "vitest";
import {
  canRunMap,
  sanitizeLoadedMap,
  validateMap,
} from "../src/validation.ts";
import {
  UNIT_AP,
  UNIT_HP,
  createTestMap,
  type GameMap,
} from "../src/map.ts";
import { buildMap } from "./fixtures.ts";

const validUnit = (
  id: string,
  team: "player" | "enemy",
  x: number,
  y: number,
) => ({
  id,
  team,
  x,
  y,
  hp: UNIT_HP,
  maxHp: UNIT_HP,
  ap: UNIT_AP,
  maxAp: UNIT_AP,
  overwatch: false,
  peekExposure: null,
});

describe("validateMap", () => {
  it("accepts the demo map without errors", () => {
    const report = validateMap(createTestMap());
    expect(report.hasErrors).toBe(false);
  });

  it("flags TILE_LENGTH_MISMATCH when tiles array length is wrong", () => {
    const map: GameMap = {
      width: 4,
      height: 4,
      tiles: new Array(10).fill("floor"),
      units: [validUnit("p", "player", 0, 0), validUnit("e", "enemy", 3, 3)],
    };
    const report = validateMap(map);
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === "TILE_LENGTH_MISMATCH")).toBe(true);
  });

  it("flags INVALID_TILE for unknown tile values", () => {
    const map = buildMap([
      "....",
      "....",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    (map.tiles as unknown[])[2] = "lava";
    const report = validateMap(map);
    expect(report.issues.some((i) => i.code === "INVALID_TILE")).toBe(true);
  });

  it("flags DUPLICATE_UNIT_ID", () => {
    const map = buildMap([
      "....",
      "....",
    ], [
      { team: "player", x: 0, y: 0, id: "dup" },
      { team: "enemy", x: 3, y: 0, id: "dup" },
    ]);
    const report = validateMap(map);
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === "DUPLICATE_UNIT_ID")).toBe(true);
  });

  it("flags STACKED_UNITS when two living units share a tile", () => {
    const map = buildMap([
      "....",
      "....",
    ], [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 1, y: 1 },
    ]);
    const report = validateMap(map);
    expect(report.issues.some((i) => i.code === "STACKED_UNITS")).toBe(true);
  });

  it("flags UNIT_OUT_OF_BOUNDS for off-map units", () => {
    const map = buildMap([
      "....",
      "....",
    ], [
      { team: "player", x: 99, y: 99 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    const report = validateMap(map);
    expect(report.issues.some((i) => i.code === "UNIT_OUT_OF_BOUNDS")).toBe(true);
  });

  it("warns UNIT_ON_BLOCKING_TILE for units placed on a wall", () => {
    const map = buildMap([
      "....",
      "..#.",
    ], [
      { team: "player", x: 2, y: 1 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    const report = validateMap(map);
    const hit = report.issues.find((i) => i.code === "UNIT_ON_BLOCKING_TILE");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warning");
    // Warning level means errors should still be false (assuming no other errs).
    expect(report.hasErrors).toBe(false);
  });

  it("flags NO_PLAYER_SPAWN when no player units exist", () => {
    const map = buildMap([
      "....",
    ], [
      { team: "enemy", x: 3, y: 0 },
    ]);
    const report = validateMap(map);
    expect(report.issues.some((i) => i.code === "NO_PLAYER_SPAWN")).toBe(true);
  });

  it("flags NO_ENEMY_SPAWN when no enemy units exist", () => {
    const map = buildMap([
      "....",
    ], [
      { team: "player", x: 0, y: 0 },
    ]);
    const report = validateMap(map);
    expect(report.issues.some((i) => i.code === "NO_ENEMY_SPAWN")).toBe(true);
  });

  it("canRunMap returns ok=false when errors exist", () => {
    const map = buildMap([
      "....",
    ], [
      { team: "player", x: 0, y: 0 },
    ]);
    const result = canRunMap(map);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

describe("sanitizeLoadedMap", () => {
  it("returns null on hard structural errors (bad tile length)", () => {
    const raw = {
      width: 4,
      height: 4,
      tiles: new Array(10).fill("floor"),
      units: [],
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.map).toBeNull();
    expect(result.report.hasErrors).toBe(true);
  });

  it("regenerates duplicate unit ids and demotes to a warning", () => {
    const raw = {
      width: 4,
      height: 4,
      tiles: new Array(16).fill("floor"),
      units: [
        { ...validUnit("dup", "player", 0, 0) },
        { ...validUnit("dup", "enemy", 3, 3) },
      ],
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.map).not.toBeNull();
    if (!result.map) return;
    const ids = new Set(result.map.units.map((u) => u.id));
    expect(ids.size).toBe(2);
    expect(result.report.issues.some((i) => i.code === "DUPLICATE_UNIT_ID")).toBe(true);
  });

  it("coerces unknown tile values to floor and warns", () => {
    const raw = {
      width: 2,
      height: 2,
      tiles: ["floor", "lava", "floor", "floor"],
      units: [validUnit("p", "player", 0, 0), validUnit("e", "enemy", 1, 1)],
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.map).not.toBeNull();
    if (!result.map) return;
    expect(result.map.tiles[1]).toBe("floor");
    expect(result.report.issues.some((i) => i.code === "INVALID_TILE")).toBe(true);
  });
});
