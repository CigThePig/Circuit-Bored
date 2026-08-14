import { describe, expect, it } from "vitest";
import { overwatchShouldFire } from "../src/combat.ts";
import { buildMap, unit } from "./fixtures.ts";

describe("overwatchShouldFire", () => {
  it("returns true when mover transitions from hidden to visible", () => {
    // Watcher at (0,1). Wall at (3,1) blocks LoS to (4,1) but not (2,1).
    const map = buildMap([
      ".....",
      "...#.",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 1, overwatch: true });
    const mover = unit({ team: "enemy", x: 4, y: 1 });
    const from = { x: 4, y: 1 };
    const to = { x: 2, y: 1 };
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, from, to)).toBe(true);
  });

  it("returns false when the mover was already visible at 'from'", () => {
    const map = buildMap([
      ".....",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 0, overwatch: true });
    const mover = unit({ team: "enemy", x: 2, y: 0 });
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, { x: 2, y: 0 }, { x: 3, y: 0 }))
      .toBe(false);
  });

  it("returns false when both 'from' and 'to' are blocked by walls", () => {
    // A solid wall column between watcher and mover; both endpoints hidden.
    const map = buildMap([
      ".#...",
      ".#...",
      ".#...",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 1, overwatch: true });
    const mover = unit({ team: "enemy", x: 2, y: 1 });
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, { x: 2, y: 0 }, { x: 2, y: 2 }))
      .toBe(false);
  });

  it("returns false when watcher's overwatch flag is off", () => {
    const map = buildMap([
      ".....",
      "..#..",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 0, overwatch: false });
    const mover = unit({ team: "enemy", x: 2, y: 2 });
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, { x: 2, y: 2 }, { x: 4, y: 2 }))
      .toBe(false);
  });

  it("returns false when watcher is dead", () => {
    const map = buildMap([
      ".....",
      ".....",
    ]);
    const watcher = unit({
      team: "player",
      x: 0,
      y: 0,
      overwatch: true,
      hp: 0,
    });
    const mover = unit({ team: "enemy", x: 2, y: 0 });
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, { x: 2, y: 0 }, { x: 3, y: 0 }))
      .toBe(false);
  });

  it("evaluates old-position occupancy instead of reusing the destination map", () => {
    // The wall makes (0,1) hidden because it is also the watcher's only peek
    // tile. Moving to (1,1) creates direct sight and must trigger overwatch.
    const map = buildMap([
      "#..",
      "...",
      "...",
    ]);
    const watcher = unit({ team: "player", x: 1, y: 0, overwatch: true });
    const mover = unit({ team: "enemy", x: 1, y: 1 });
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, { x: 0, y: 1 }, { x: 1, y: 1 }))
      .toBe(true);
    expect(mover).toMatchObject({ x: 1, y: 1, peekExposure: null });
  });
});
