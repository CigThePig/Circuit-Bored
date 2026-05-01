export type TileType = "floor" | "wall";

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
};

export type GameMap = {
  width: number;
  height: number;
  tiles: TileType[];
  units: Unit[];
};

export const MAP_W = 8;
export const MAP_H = 8;
export const UNIT_HP = 8;
export const UNIT_AP = 2;

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

export function makeUnit(team: "player" | "enemy", x: number, y: number): Unit {
  return {
    id: `${team}-${Math.random().toString(36).slice(2, 8)}`,
    team,
    x,
    y,
    hp: UNIT_HP,
    maxHp: UNIT_HP,
    ap: UNIT_AP,
    maxAp: UNIT_AP,
    overwatch: false,
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
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameMap;
    if (!parsed.tiles || parsed.tiles.length !== parsed.width * parsed.height) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function validatePlayable(map: GameMap): string | null {
  const players = map.units.filter((u) => u.team === "player");
  const enemies = map.units.filter((u) => u.team === "enemy");
  if (players.length !== 1) return "Map must have exactly 1 player spawn.";
  if (enemies.length < 1) return "Map must have at least 1 enemy.";
  return null;
}
