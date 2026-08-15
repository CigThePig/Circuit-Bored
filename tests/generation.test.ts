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
import { analyzeGeneratedMap, validateGeneratedMap, type GeneratedMapMetrics } from "../src/generationAnalysis.ts";
import { LANDMARK_AMBIENTS, LANDMARK_ORIENTATIONS, MAX_LANDMARK_VARIANT } from "../src/environment.ts";
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
      // Exactly one feature anchors the board, and it stays clearly larger
      // than whatever supports it.
      const environment = map.environment!;
      expect(environment.landmarks.filter(({ importance }) => importance === "dominant")).toHaveLength(1);
      expect(metrics.dominantFootprintRatio).toBeGreaterThanOrEqual(1.25);
      expect(metrics.dominantFootprint).toBeGreaterThanOrEqual(60);
      expect(metrics.landmarkAdjacentCoverRatio).toBeGreaterThanOrEqual(0.45);
      expect(["quiet", "heavy"]).toContain(environment.profile);
      for (const landmark of environment.landmarks) {
        expect(LANDMARK_ORIENTATIONS).toContain(landmark.orientation);
        expect(LANDMARK_AMBIENTS).toContain(landmark.ambient);
        expect(landmark.variant).toBeGreaterThanOrEqual(0);
        expect(landmark.variant).toBeLessThanOrEqual(MAX_LANDMARK_VARIANT);
      }
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
    expect([...derelictKinds].some((kind) => ["collapsed_room", "scrap_heap", "reactor_wreck"].includes(kind))).toBe(true);
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

  it("gives each theme a shape language that survives grayscale and semantic review", () => {
    const run = createRun("SHAPE-LANGUAGE");
    const samples: Record<string, GeneratedMapMetrics[]> = { industrial: [], data_core: [], derelict: [] };
    for (let seed = 0; seed < 60; seed++) {
      for (const themeId of LEVEL_THEME_IDS) {
        const map = generateEncounter(new SeededRng(`shape-${seed}`), seed % 7, "elite", run.squad, [], { themeId });
        samples[themeId].push(analyzeGeneratedMap(map));
      }
    }
    const worst = (themeId: string, key: keyof GeneratedMapMetrics) =>
      Math.min(...samples[themeId].map((metrics) => metrics[key] as number));
    const best = (themeId: string, key: keyof GeneratedMapMetrics) =>
      Math.max(...samples[themeId].map((metrics) => metrics[key] as number));
    const mean = (themeId: string, key: keyof GeneratedMapMetrics) =>
      samples[themeId].reduce((sum, metrics) => sum + (metrics[key] as number), 0) / samples[themeId].length;

    // Foundry: long aligned industrial runs, on every single board.
    expect(worst("industrial", "longestWallRun")).toBeGreaterThanOrEqual(8);
    expect(worst("industrial", "alignedWallRatio")).toBeGreaterThanOrEqual(0.58);
    expect(mean("industrial", "alignedWallRatio")).toBeGreaterThan(mean("derelict", "alignedWallRatio") + 0.2);
    // Data Core: deliberate, near-symmetrical engineering. The gap here is
    // wide enough to hold worst-case against every other family's best case.
    expect(worst("data_core", "mirrorSymmetryRatio")).toBeGreaterThan(best("industrial", "mirrorSymmetryRatio"));
    expect(worst("data_core", "mirrorSymmetryRatio")).toBeGreaterThan(best("derelict", "mirrorSymmetryRatio"));
    // Derelict: interrupted structure that never closes cleanly.
    expect(mean("derelict", "wallEndpointRatio")).toBeGreaterThan(mean("industrial", "wallEndpointRatio") + 0.1);
    expect(mean("derelict", "alignedWallRatio")).toBeLessThan(mean("data_core", "alignedWallRatio") - 0.2);
    expect(best("derelict", "alignedWallRatio")).toBeLessThanOrEqual(0.8);
    expect(best("derelict", "mirrorSymmetryRatio")).toBeLessThan(0.88);
  }, 30_000);

  it("separates quiet and heavy compositions by environment, not only by density", () => {
    const run = createRun("PROFILE-CONTRAST");
    for (const themeId of LEVEL_THEME_IDS) {
      const quiet = generateEncounter(new SeededRng(`profile-${themeId}`), 1, "combat", run.squad, [], { themeId });
      const heavy = generateEncounter(new SeededRng(`profile-${themeId}`), 6, "final", run.squad, [], { themeId });
      expect(quiet.environment!.profile).toBe("quiet");
      expect(heavy.environment!.profile).toBe("heavy");
      // Quiet keeps a single, larger anchor and far fewer supporting nouns.
      expect(quiet.environment!.landmarks).toHaveLength(2);
      expect(heavy.environment!.landmarks).toHaveLength(4);
      const quietMetrics = analyzeGeneratedMap(quiet);
      const heavyMetrics = analyzeGeneratedMap(heavy);
      expect(quietMetrics.dominantFootprint).toBeGreaterThan(heavyMetrics.dominantFootprint);
      expect(quietMetrics.floorQuietnessRatio).toBeGreaterThan(heavyMetrics.floorQuietnessRatio);
      expect(heavyMetrics.landmarkCount).toBeGreaterThan(quietMetrics.landmarkCount);
      // Both stay tactically viable rather than one becoming an empty room.
      expect(validateGeneratedMap(quiet)).toEqual([]);
      expect(validateGeneratedMap(heavy)).toEqual([]);
      expect(quietMetrics.largestOpenSquare).toBeLessThanOrEqual(9);
    }
  });

  it("turns landmark facing with the board so bespoke art never faces a wall", () => {
    const run = createRun("ORIENTATION");
    const seen = new Set<string>();
    for (let seed = 0; seed < 90; seed++) {
      const themeId = LEVEL_THEME_IDS[seed % LEVEL_THEME_IDS.length];
      const map = generateEncounter(new SeededRng(`orient-${seed}`), 4, "elite", run.squad, [], { themeId });
      for (const landmark of map.environment!.landmarks) {
        seen.add(landmark.orientation!);
        const { rect } = landmark;
        expect(rect.x + rect.width).toBeLessThanOrEqual(map.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(map.height);
      }
    }
    // Rotation and mirroring must produce every facing, not just the authored one.
    expect(seen).toEqual(new Set(["n", "e", "s", "w"]));
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
