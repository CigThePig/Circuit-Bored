import {
  UNIT_AP,
  UNIT_HP,
  type GameMap,
  type TileType,
  type Unit,
} from "../src/map.ts";

const TILE_GLYPHS: Record<string, TileType> = {
  ".": "floor",
  "#": "wall",
  "h": "half_cover",
  "p": "floor",
  "e": "floor",
};

export type UnitInput = {
  id?: string;
  team: "player" | "enemy";
  x: number;
  y: number;
  hp?: number;
  maxHp?: number;
  ap?: number;
  maxAp?: number;
  overwatch?: boolean;
};

export function buildMap(rows: string[], units: UnitInput[] = []): GameMap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  for (const r of rows) {
    if (r.length !== width) {
      throw new Error(`Row width mismatch: '${r}'`);
    }
  }
  const tiles: TileType[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      const t = TILE_GLYPHS[ch];
      if (!t) throw new Error(`Unknown tile glyph '${ch}' at (${x},${y})`);
      tiles[y * width + x] = t;
    }
  }
  const realized: Unit[] = units.map((u, i) => ({
    id: u.id ?? `${u.team}-test-${i}`,
    team: u.team,
    x: u.x,
    y: u.y,
    hp: u.hp ?? UNIT_HP,
    maxHp: u.maxHp ?? UNIT_HP,
    ap: u.ap ?? UNIT_AP,
    maxAp: u.maxAp ?? UNIT_AP,
    overwatch: u.overwatch ?? false,
    peekExposure: null,
  }));
  return { width, height, tiles, units: realized };
}

export function unit(input: UnitInput): Unit {
  return {
    id: input.id ?? `${input.team}-test`,
    team: input.team,
    x: input.x,
    y: input.y,
    hp: input.hp ?? UNIT_HP,
    maxHp: input.maxHp ?? UNIT_HP,
    ap: input.ap ?? UNIT_AP,
    maxAp: input.maxAp ?? UNIT_AP,
    overwatch: input.overwatch ?? false,
    peekExposure: null,
  };
}
