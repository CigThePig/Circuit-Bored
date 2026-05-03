import {
  canRunMap,
  sanitizeLoadedMap,
  type ValidationReport,
} from "./validation.ts";

export type TileType = "floor" | "wall" | "half_cover";

export type Unit = {
  id: string;
  team: "player" | "enemy";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  overwatch: boolean;
  peekExposure: { x: number; y: number } | null;
};

export type GameMap = {
  width: number;
  height: number;
  tiles: TileType[];
  units: Unit[];
};

export const MAP_W = 16;
export const MAP_H = 16;
export const UNIT_HP = 8;
export const UNIT_AP = 4;

const STORAGE_KEY = "circuit-bored.map.v1";

export function createEmptyMap(): GameMap {
  const tiles: TileType[] = new Array(MAP_W * MAP_H).fill("floor");
  return { width: MAP_W, height: MAP_H, tiles, units: [] };
}

export function idx(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function getTile(map: GameMap, x: number, y: number): TileType | null {
  if (!inBounds(map, x, y)) return null;
  return map.tiles[idx(map, x, y)];
}

export function setTile(map: GameMap, x: number, y: number, t: TileType): void {
  if (!inBounds(map, x, y)) return;
  map.tiles[idx(map, x, y)] = t;
}

export function unitAt(map: GameMap, x: number, y: number): Unit | null {
  for (const u of map.units) {
    if (u.x === x && u.y === y && u.hp > 0) return u;
  }
  return null;
}

export function isPassable(map: GameMap, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  if (getTile(map, x, y) !== "floor") return false;
  if (unitAt(map, x, y)) return false;
  return true;
}

export function generateUnitId(team: "player" | "enemy"): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const base =
    cryptoRef && typeof cryptoRef.randomUUID === "function"
      ? cryptoRef.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${team}-${base}`;
}

export function makeUnit(team: "player" | "enemy", x: number, y: number): Unit {
  return {
    id: generateUnitId(team),
    team,
    x,
    y,
    hp: UNIT_HP,
    maxHp: UNIT_HP,
    ap: UNIT_AP,
    maxAp: UNIT_AP,
    overwatch: false,
    peekExposure: null,
  };
}

export function cloneMap(map: GameMap): GameMap {
  return {
    width: map.width,
    height: map.height,
    tiles: [...map.tiles],
    units: map.units.map((u) => ({ ...u })),
  };
}

export function saveMap(map: GameMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function loadMap(): GameMap | null {
  const result = loadMapWithReport();
  return result.map;
}

export function loadMapWithReport(): {
  map: GameMap | null;
  report: ValidationReport;
} {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { map: null, report: { issues: [], hasErrors: false } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      map: null,
      report: {
        issues: [
          {
            severity: "error",
            code: "INVALID_JSON",
            message: "Saved map could not be parsed as JSON.",
          },
        ],
        hasErrors: true,
      },
    };
  }
  const result = sanitizeLoadedMap(parsed);
  if (result.report.hasErrors) {
    return { map: null, report: result.report };
  }
  return result;
}

export function createTestMap(): GameMap {
  const map = createEmptyMap();
  setTile(map, 4, 8, "half_cover");
  setTile(map, 4, 9, "half_cover");
  setTile(map, 11, 8, "half_cover");
  setTile(map, 11, 9, "half_cover");
  setTile(map, 7, 2, "wall");
  setTile(map, 8, 13, "wall");
  map.units.push(makeUnit("player", 3, 8));
  map.units.push(makeUnit("enemy", 12, 8));
  return map;
}

export function validatePlayable(map: GameMap): string | null {
  const result = canRunMap(map);
  return result.ok ? null : result.reason ?? "Map cannot be run.";
}
