import { describe, expect, it } from "vitest";
import { checkOverwatch, overwatchShouldFire, watchedTiles } from "../src/combat.ts";
import { buildMap, unit } from "./fixtures.ts";

describe("overwatch trigger", () => {
  it("fires when a mover emerges from blocked line of sight", () => {
    // Watcher at (0,1). Wall at (3,1) blocks LoS to (4,1) but not (2,1).
    const map = buildMap([
      ".....",
      "...#.",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 1, overwatch: true });
    const mover = unit({ team: "enemy", x: 4, y: 1 });
    map.units = [watcher, mover];
    const check = checkOverwatch(map, watcher, mover, { x: 4, y: 1 }, { x: 2, y: 1 });
    expect(check.fires).toBe(true);
    expect(check.trigger).toBe("emergence");
  });

  it("fires on movement inside ground the watcher already covers", () => {
    // The old rule only reacted to an unseen-to-seen transition, so crossing an
    // open lane in full view of a watcher was free. Overwatch is area control:
    // moving through a covered lane is what triggers it.
    const map = buildMap([
      ".....",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 0, overwatch: true });
    const mover = unit({ team: "enemy", x: 2, y: 0 });
    map.units = [watcher, mover];
    const check = checkOverwatch(map, watcher, mover, { x: 2, y: 0 }, { x: 3, y: 0 });
    expect(check.fires).toBe(true);
    expect(check.trigger).toBe("watched_movement");
    expect(check.sawBefore).toBe(true);
  });

  it("does not fire when the destination is behind a wall", () => {
    // Moving out of the watched lane into cover must not draw a reaction, and
    // the reaction must never be resolved through the wall.
    const map = buildMap([
      "..#..",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 0, overwatch: true });
    const mover = unit({ team: "enemy", x: 3, y: 1 });
    map.units = [watcher, mover];
    const check = checkOverwatch(map, watcher, mover, { x: 3, y: 1 }, { x: 3, y: 0 });
    expect(check.seesAfter).toBe(false);
    expect(check.fires).toBe(false);
  });

  it("never fires through a solid wall in either position", () => {
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

  it("does not fire when the mover did not actually change tile", () => {
    const map = buildMap([
      ".....",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 0, overwatch: true });
    const mover = unit({ team: "enemy", x: 2, y: 0 });
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, { x: 2, y: 0 }, { x: 2, y: 0 }))
      .toBe(false);
  });

  it("returns false when the watcher's overwatch flag is off", () => {
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

  it("returns false when the watcher is dead", () => {
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

  it("returns false when the watcher is suppressed", () => {
    const map = buildMap([
      ".....",
      ".....",
    ]);
    const watcher = unit({
      team: "player",
      x: 0,
      y: 0,
      overwatch: true,
      statuses: { suppressed: 1 },
    });
    const mover = unit({ team: "enemy", x: 2, y: 0 });
    map.units = [watcher, mover];
    expect(overwatchShouldFire(map, watcher, mover, { x: 2, y: 0 }, { x: 3, y: 0 }))
      .toBe(false);
  });

  it("evaluates old-position occupancy instead of reusing the destination map", () => {
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

  it("restores the mover's own peek exposure after evaluating a trigger", () => {
    const map = buildMap([
      ".....",
      ".....",
    ]);
    const watcher = unit({ team: "player", x: 0, y: 0, overwatch: true });
    const mover = unit({ team: "enemy", x: 2, y: 0 });
    mover.peekExposure = { x: 3, y: 1 };
    map.units = [watcher, mover];
    overwatchShouldFire(map, watcher, mover, { x: 2, y: 0 }, { x: 3, y: 0 });
    expect(mover.peekExposure).toEqual({ x: 3, y: 1 });
    expect(mover).toMatchObject({ x: 2, y: 0 });
  });
});

describe("watchedTiles", () => {
  it("reports exactly the candidate tiles the watcher could shoot into", () => {
    const map = buildMap([
      "..#..",
      ".....",
    ]);
    const watcher = unit({ team: "enemy", x: 0, y: 0, overwatch: true });
    const mover = unit({ team: "player", x: 0, y: 1 });
    map.units = [watcher, mover];
    const candidates = [
      { x: 1, y: 1 },
      { x: 3, y: 0 },
      { x: 4, y: 1 },
    ];
    const watched = watchedTiles(map, watcher, mover, candidates);
    // (3,0) sits behind the wall at (2,0) on the watcher's row.
    expect(watched).toContainEqual({ x: 1, y: 1 });
    expect(watched).not.toContainEqual({ x: 3, y: 0 });
    expect(mover).toMatchObject({ x: 0, y: 1 });
  });

  it("reports nothing for a watcher that is not watching", () => {
    const map = buildMap([".....", "....."]);
    const watcher = unit({ team: "enemy", x: 0, y: 0, overwatch: false });
    const mover = unit({ team: "player", x: 0, y: 1 });
    map.units = [watcher, mover];
    expect(watchedTiles(map, watcher, mover, [{ x: 1, y: 1 }])).toEqual([]);
  });

  it("reports nothing for a suppressed watcher", () => {
    const map = buildMap([".....", "....."]);
    const watcher = unit({
      team: "enemy",
      x: 0,
      y: 0,
      overwatch: true,
      statuses: { suppressed: 1 },
    });
    const mover = unit({ team: "player", x: 0, y: 1 });
    map.units = [watcher, mover];
    expect(watchedTiles(map, watcher, mover, [{ x: 1, y: 1 }])).toEqual([]);
  });
});
