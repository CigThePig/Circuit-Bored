import { describe, expect, it } from "vitest";
import { generateEncounter, reachableFloorCount, type EncounterKind } from "../src/generation.ts";
import { createRun } from "../src/run.ts";
import { SeededRng } from "../src/rng.ts";
import { getTile } from "../src/map.ts";
import { validateMap } from "../src/validation.ts";
import { canShootTarget } from "../src/combat.ts";

describe("procedural encounters", () => {
  it("generates the same map and composition from the same state", () => {
    const run = createRun("MAP-REPEAT");
    const a = generateEncounter(new SeededRng(123456), 3, "elite", run.squad, run.upgrades);
    const b = generateEncounter(new SeededRng(123456), 3, "elite", run.squad, run.upgrades);
    expect(a).toEqual(b);
  });

  it("varies maps across different seeds", () => {
    const run = createRun("MAP-VARY");
    const a = generateEncounter(new SeededRng(1), 2, "combat", run.squad, []);
    const b = generateEncounter(new SeededRng(2), 2, "combat", run.squad, []);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it("survives a broad batch of seeds without invalid or sealed maps", () => {
    const run = createRun("BATCH");
    const kinds: EncounterKind[] = ["combat", "elite", "final"];
    for (let seed = 0; seed < 600; seed++) {
      const depth = seed % 7;
      const map = generateEncounter(new SeededRng(seed), depth, kinds[seed % kinds.length], run.squad, []);
      expect(map.width).toBe(12);
      expect(map.height).toBe(12);
      expect(validateMap(map).hasErrors).toBe(false);
      const floorCount = map.tiles.filter((tile) => tile === "floor").length;
      const reachable = reachableFloorCount(map, map.units[0].x, map.units[0].y);
      expect(reachable).toBe(floorCount);
      expect(reachable).toBeGreaterThanOrEqual(60);
      for (const unit of map.units) expect(getTile(map, unit.x, unit.y)).toBe("floor");
      const blocking = map.tiles.filter((tile) => tile !== "floor").length;
      expect(blocking).toBeGreaterThanOrEqual(20);
      const players = map.units.filter((unit) => unit.team === "player");
      const enemies = map.units.filter((unit) => unit.team === "enemy");
      const openingShots = players.reduce(
        (sum, player) => sum + enemies.filter((enemy) => canShootTarget(map, player, enemy).canShoot).length,
        0,
      );
      expect(openingShots).toBeLessThan(players.length * enemies.length);
    }
  });

  it("escalates composition without relying only on hit points", () => {
    const run = createRun("ESCALATE");
    const early = generateEncounter(new SeededRng(8), 0, "combat", run.squad, []);
    const final = generateEncounter(new SeededRng(8), 6, "final", run.squad, []);
    const earlyEnemies = early.units.filter((unit) => unit.team === "enemy");
    const finalEnemies = final.units.filter((unit) => unit.team === "enemy");
    expect(finalEnemies.length).toBeGreaterThan(earlyEnemies.length);
    expect(finalEnemies.some((unit) => unit.aiBehavior === "sentinel")).toBe(true);
    expect(finalEnemies.some((unit) => unit.aiBehavior === "marksman")).toBe(true);
  });
});
