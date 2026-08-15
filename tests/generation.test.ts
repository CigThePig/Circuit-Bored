import { describe, expect, it } from "vitest";
import {
  generateEncounter,
  generatedEncounterDiagnostics,
  reachableFloorCount,
  type EncounterKind,
} from "../src/generation.ts";
import { createRun } from "../src/run.ts";
import { SeededRng } from "../src/rng.ts";
import { cloneMap, getTile, makeUnit } from "../src/map.ts";
import { validateMap } from "../src/validation.ts";
import { canShootTarget } from "../src/combat.ts";
import { analyzeGeneratedMap, validateGeneratedMap } from "../src/generationAnalysis.ts";
import { LEVEL_THEME_IDS } from "../src/themes.ts";
import { beginEnemyTurn, takeEnemyAction } from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";

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

  it("survives thousands of seeds, themes, depths, and encounter kinds", () => {
    const run = createRun("BATCH");
    const kinds: EncounterKind[] = ["combat", "elite", "final"];
    const seenThemes = new Set<string>();
    const layoutsByTheme = new Map<string, Set<string>>();
    for (let seed = 0; seed < 2_400; seed++) {
      const depth = seed % 7;
      const themeId = LEVEL_THEME_IDS[seed % LEVEL_THEME_IDS.length];
      const map = generateEncounter(
        new SeededRng(seed),
        depth,
        kinds[seed % kinds.length],
        run.squad,
        [],
        { themeId },
      );
      expect(map.width).toBe(24);
      expect(map.height).toBe(24);
      expect(validateMap(map).hasErrors).toBe(false);
      expect(validateGeneratedMap(map)).toEqual([]);
      const floorCount = map.tiles.filter((tile) => tile === "floor").length;
      const reachable = reachableFloorCount(map, map.units[0].x, map.units[0].y);
      expect(reachable).toBe(floorCount);
      expect(reachable).toBeGreaterThanOrEqual(260);
      for (const unit of map.units) expect(getTile(map, unit.x, unit.y)).toBe("floor");
      const blocking = map.tiles.filter((tile) => tile !== "floor").length;
      expect(blocking).toBeGreaterThanOrEqual(120);
      const players = map.units.filter((unit) => unit.team === "player");
      const enemies = map.units.filter((unit) => unit.team === "enemy");
      const openingShots = players.reduce(
        (sum, player) => sum + enemies.filter((enemy) => canShootTarget(map, player, enemy).canShoot).length,
        0,
      );
      expect(openingShots).toBeLessThanOrEqual(2);
      const metrics = analyzeGeneratedMap(map);
      expect(metrics.landmarkCount).toBeGreaterThanOrEqual(2);
      expect(metrics.landmarkCount).toBeLessThanOrEqual(4);
      expect(metrics.majorLandmarkCount).toBeGreaterThanOrEqual(1);
      expect(metrics.largestLandmarkFootprint).toBeGreaterThanOrEqual(30);
      expect(metrics.floorQuietnessRatio).toBeGreaterThanOrEqual(0.5);
      expect(metrics.highAttentionFloorRatio).toBeLessThanOrEqual(0.1);
      expect(metrics.largestCalmRegion).toBeGreaterThanOrEqual(80);
      seenThemes.add(metrics.themeId);
      const signatures = layoutsByTheme.get(metrics.themeId) ?? new Set<string>();
      signatures.add(map.tiles.join(""));
      layoutsByTheme.set(metrics.themeId, signatures);
    }
    expect(seenThemes).toEqual(new Set(LEVEL_THEME_IDS));
    for (const themeId of LEVEL_THEME_IDS) {
      expect(layoutsByTheme.get(themeId)!.size).toBeGreaterThan(100);
    }
  }, 60_000);

  it("lets normal run RNG select every theme deterministically", () => {
    const run = createRun("THEME-COVERAGE");
    const seen = new Set<string>();
    for (let seed = 0; seed < 120; seed++) {
      const first = generateEncounter(new SeededRng(`theme-${seed}`), seed % 7, "combat", run.squad, []);
      const second = generateEncounter(new SeededRng(`theme-${seed}`), seed % 7, "combat", run.squad, []);
      expect(first).toEqual(second);
      seen.add(first.themeId!);
    }
    expect(seen).toEqual(new Set(LEVEL_THEME_IDS));
  });

  it("gives each theme a distinct structural grammar", () => {
    const run = createRun("THEME-GRAMMAR");
    const maps = Object.fromEntries(LEVEL_THEME_IDS.map((themeId) => [
      themeId,
      generateEncounter(new SeededRng(`grammar-${themeId}`), 4, "elite", run.squad, [], { themeId }),
    ]));
    const industrialKinds = new Set(maps.industrial.environment!.landmarks.map(({ kind }) => kind));
    const dataKinds = new Set(maps.data_core.environment!.landmarks.map(({ kind }) => kind));
    const derelictKinds = new Set(maps.derelict.environment!.landmarks.map(({ kind }) => kind));
    expect([...industrialKinds].some((kind) => ["furnace_block", "coolant_tanks", "processing_line"].includes(kind))).toBe(true);
    expect([...dataKinds].some((kind) => ["server_vault", "data_core"].includes(kind))).toBe(true);
    expect([...derelictKinds].some((kind) => ["collapsed_room", "scrap_heap"].includes(kind))).toBe(true);
    expect(new Set([...industrialKinds, ...dataKinds, ...derelictKinds]).size).toBeGreaterThanOrEqual(8);
    for (const map of Object.values(maps)) {
      const diagnostics = generatedEncounterDiagnostics(map)!;
      expect(diagnostics.motifs.length).toBeGreaterThanOrEqual(4);
      expect(diagnostics.zones.length).toBeGreaterThanOrEqual(3);
      expect(diagnostics.zones.length).toBeLessThanOrEqual(6);
      expect(diagnostics.metrics.floorRegionCount).toBe(1);
      expect(diagnostics.landmarks).toHaveLength(map.environment!.landmarks.length);
      expect(diagnostics.featureBudget).toEqual(map.environment!.featureBudget);
    }
  });

  it("keeps AI mobile across rooms, connectors, and long flank routes", () => {
    const run = createRun("AI-LARGE-MAPS");
    for (let seed = 0; seed < 120; seed++) {
      const themeId = LEVEL_THEME_IDS[seed % LEVEL_THEME_IDS.length];
      const map = generateEncounter(new SeededRng(`ai-map-${seed}`), seed % 7, "elite", run.squad, [], { themeId });
      const enemy = map.units.find((unit) => unit.team === "enemy")!;
      const session = createAiSession();
      beginEnemyTurn(map, enemy, session);
      const action = takeEnemyAction(map, enemy, session, () => 0.5);
      expect(action.kind).not.toBe("wait");
      if (action.kind === "move") expect(getTile(map, action.to.x, action.to.y)).toBe("floor");
      if (action.kind === "shoot") expect(action.result.canShoot).toBe(true);
    }
  });

  it("never permits a generated connected-wall mass to be shot through", () => {
    const run = createRun("WALL-MASS-STRESS");
    for (const themeId of LEVEL_THEME_IDS) {
      let checked = 0;
      for (let seed = 0; seed < 40 && checked < 20; seed++) {
        const source = generateEncounter(new SeededRng(`wall-${themeId}-${seed}`), 5, "elite", run.squad, [], { themeId });
        for (let y = 2; y < source.height - 2 && checked < 20; y++) {
          for (let x = 2; x < source.width - 2 && checked < 20; x++) {
            if (getTile(source, x, y) !== "wall") continue;
            const verticalMass = getTile(source, x, y - 1) === "wall" && getTile(source, x, y + 1) === "wall";
            const horizontalMass = getTile(source, x - 1, y) === "wall" && getTile(source, x + 1, y) === "wall";
            const endpoints = verticalMass && getTile(source, x - 1, y) === "floor" && getTile(source, x + 1, y) === "floor"
              ? [{ x: x - 1, y }, { x: x + 1, y }]
              : horizontalMass && getTile(source, x, y - 1) === "floor" && getTile(source, x, y + 1) === "floor"
                ? [{ x, y: y - 1 }, { x, y: y + 1 }]
                : null;
            if (!endpoints) continue;
            const map = cloneMap(source);
            map.units = [makeUnit("player", endpoints[0].x, endpoints[0].y), makeUnit("enemy", endpoints[1].x, endpoints[1].y)];
            expect(canShootTarget(map, map.units[0], map.units[1]).canShoot).toBe(false);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
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
