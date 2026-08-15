import { describe, expect, it } from "vitest";
import {
  environmentProfile,
  landmarkAmbient,
  landmarkOrientation,
} from "../src/environment.ts";
import {
  canRunMap,
  sanitizeLoadedMap,
  validateMap,
} from "../src/validation.ts";
import {
  UNIT_AP,
  UNIT_HP,
  cloneMap,
  createTestMap,
  loadMapWithReport,
  saveMap,
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

  it("rejects units placed on a blocking tile", () => {
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
    expect(hit?.severity).toBe("error");
    expect(report.hasErrors).toBe(true);
    expect(canRunMap(map).ok).toBe(false);
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
  it("defaults old maps without theme metadata to the foundry", () => {
    const raw = {
      width: 2,
      height: 2,
      tiles: new Array(4).fill("floor"),
      units: [validUnit("p", "player", 0, 0), validUnit("e", "enemy", 1, 1)],
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.map?.themeId).toBe("industrial");
    expect(result.report.hasErrors).toBe(false);
  });

  it("sanitizes unknown theme metadata without rejecting an old save", () => {
    const raw = {
      width: 2,
      height: 2,
      themeId: "disco_void",
      tiles: new Array(4).fill("floor"),
      units: [validUnit("p", "player", 0, 0), validUnit("e", "enemy", 1, 1)],
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.map?.themeId).toBe("industrial");
    expect(result.report.issues.some((issue) => issue.code === "INVALID_THEME")).toBe(true);
    expect(result.report.hasErrors).toBe(false);
  });

  it("sanitizes generated landmark metadata without breaking older maps", () => {
    const raw = {
      width: 6,
      height: 6,
      themeId: "data_core",
      tiles: new Array(36).fill("floor"),
      units: [validUnit("p", "player", 0, 0), validUnit("e", "enemy", 5, 5)],
      environment: {
        featureBudget: { major: 1, secondary: 1, minor: 2 },
        landmarks: [
          { id: "vault", name: "Server Vault", kind: "server_vault", importance: "major", rect: { x: 1, y: 1, width: 4, height: 4 } },
          { id: "bad", name: "Outside", kind: "data_core", importance: "secondary", rect: { x: 5, y: 5, width: 2, height: 2 } },
        ],
        floorZones: [
          { id: "vault-floor", treatment: "vault_grid", rect: { x: 1, y: 1, width: 4, height: 4 } },
        ],
      },
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.report.hasErrors).toBe(false);
    expect(result.map?.environment?.landmarks.map(({ id }) => id)).toEqual(["vault"]);
    expect(result.report.issues.some((issue) => issue.code === "INVALID_LANDMARK")).toBe(true);
    // Pre-landmark-art saves omit identity fields entirely and must survive.
    const legacy = result.map!.environment!.landmarks[0];
    expect(legacy.orientation).toBeUndefined();
    expect(legacy.ambient).toBeUndefined();
    expect(landmarkOrientation(legacy)).toBe("s");
    expect(landmarkAmbient(legacy)).toBe("none");
    expect(environmentProfile(result.map!.environment)).toBe("quiet");
  });

  it("keeps landmark identity, zone roles, and the composition profile when they are valid", () => {
    const raw = {
      width: 8,
      height: 8,
      themeId: "industrial",
      tiles: new Array(64).fill("floor"),
      units: [validUnit("p", "player", 0, 0), validUnit("e", "enemy", 7, 7)],
      environment: {
        featureBudget: { major: 1, secondary: 1, minor: 2 },
        profile: "heavy",
        landmarks: [{
          id: "furnace",
          name: "Furnace Hall",
          kind: "furnace_block",
          importance: "dominant",
          rect: { x: 1, y: 1, width: 5, height: 5 },
          orientation: "e",
          variant: 2,
          ambient: "furnace_pulse",
        }],
        floorZones: [
          { id: "furnace-apron", treatment: "machine_bay", rect: { x: 0, y: 0, width: 7, height: 7 }, role: "machine_service", ownerId: "furnace" },
          { id: "orphan", treatment: "machine_bay", rect: { x: 0, y: 0, width: 2, height: 2 }, role: "salvage_work", ownerId: "missing-feature" },
        ],
      },
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.report.hasErrors).toBe(false);
    const environment = result.map!.environment!;
    expect(environment.profile).toBe("heavy");
    expect(environment.landmarks[0]).toMatchObject({ orientation: "e", variant: 2, ambient: "furnace_pulse", importance: "dominant" });
    expect(environment.floorZones[0]).toMatchObject({ role: "machine_service", ownerId: "furnace" });
    // A zone may not claim a landmark that did not survive sanitization.
    expect(environment.floorZones[1].ownerId).toBeUndefined();
    expect(environment.floorZones[1].role).toBe("salvage_work");
  });

  it("drops unusable landmark identity fields instead of rejecting the map", () => {
    const raw = {
      width: 8,
      height: 8,
      tiles: new Array(64).fill("floor"),
      units: [validUnit("p", "player", 0, 0), validUnit("e", "enemy", 7, 7)],
      environment: {
        featureBudget: { major: 1, secondary: 0, minor: 0 },
        profile: "chaotic",
        landmarks: [{
          id: "core",
          name: "Processing Core",
          kind: "data_core",
          importance: "major",
          rect: { x: 1, y: 1, width: 4, height: 4 },
          orientation: "up",
          variant: 99,
          ambient: "disco",
        }],
        floorZones: [{ id: "z", treatment: "vault_grid", rect: { x: 1, y: 1, width: 4, height: 4 }, role: "nowhere" }],
      },
    };
    const result = sanitizeLoadedMap(raw);
    expect(result.report.hasErrors).toBe(false);
    const environment = result.map!.environment!;
    expect(environment.profile).toBeUndefined();
    expect(environment.landmarks[0].orientation).toBeUndefined();
    expect(environment.landmarks[0].variant).toBeUndefined();
    expect(environment.landmarks[0].ambient).toBeUndefined();
    expect(environment.floorZones[0].role).toBeUndefined();
  });
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

  it("rejects oversized maps before allocating their tile array", () => {
    const raw = {
      width: Number.MAX_SAFE_INTEGER,
      height: Number.MAX_SAFE_INTEGER,
      tiles: [],
      units: [],
    };
    expect(() => sanitizeLoadedMap(raw)).not.toThrow();
    const result = sanitizeLoadedMap(raw);
    expect(result.map).toBeNull();
    expect(result.report.issues.some((i) => i.code === "MAP_TOO_LARGE")).toBe(true);
  });
});

describe("cloneMap", () => {
  it("deep-clones transient peek exposure coordinates", () => {
    const source = createTestMap();
    source.units[0].peekExposure = { x: 4, y: 9 };
    const copy = cloneMap(source);
    copy.units[0].peekExposure!.x = 99;
    expect(source.units[0].peekExposure).toEqual({ x: 4, y: 9 });
  });

  it("preserves stable theme metadata", () => {
    const source = createTestMap();
    source.themeId = "derelict";
    expect(cloneMap(source).themeId).toBe("derelict");
  });

  it("deep-clones generated environment metadata", () => {
    const source = createTestMap();
    source.environment = {
      featureBudget: { major: 1, secondary: 1, minor: 2 },
      profile: "heavy",
      landmarks: [{
        id: "furnace",
        name: "Furnace Hall",
        kind: "furnace_block",
        importance: "dominant",
        rect: { x: 1, y: 1, width: 4, height: 4 },
        orientation: "e",
        variant: 1,
        ambient: "furnace_pulse",
      }],
      floorZones: [{ id: "bay", treatment: "machine_bay", rect: { x: 1, y: 1, width: 4, height: 4 }, role: "machine_service", ownerId: "furnace" }],
    };
    const copy = cloneMap(source);
    expect(copy.environment).toEqual(source.environment);
    copy.environment!.landmarks[0].rect.x = 9;
    copy.environment!.landmarks[0].orientation = "w";
    copy.environment!.floorZones[0].rect.y = 7;
    copy.environment!.featureBudget.major = 4;
    copy.environment!.profile = "quiet";
    expect(source.environment.landmarks[0].rect.x).toBe(1);
    expect(source.environment.landmarks[0].orientation).toBe("e");
    expect(source.environment.floorZones[0].rect.y).toBe(1);
    expect(source.environment.featureBudget.major).toBe(1);
    expect(source.environment.profile).toBe("heavy");
  });
});

describe("browser storage failures", () => {
  it("reports unavailable storage instead of throwing during load and save", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => { throw new DOMException("blocked", "SecurityError"); },
        setItem: () => { throw new DOMException("blocked", "SecurityError"); },
      },
    });
    try {
      expect(() => loadMapWithReport()).not.toThrow();
      const loaded = loadMapWithReport();
      expect(loaded.map).toBeNull();
      expect(loaded.report.issues[0]?.code).toBe("STORAGE_UNAVAILABLE");
      expect(saveMap(createTestMap())).toBe(false);
    } finally {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
