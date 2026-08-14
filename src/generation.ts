import {
  makeArchetypeUnit,
  type UnitArchetypeId,
  type UpgradeId,
} from "./content.ts";
import { createEmptyMap, getTile, inBounds, setTile, type GameMap } from "./map.ts";
import { SeededRng } from "./rng.ts";
import { validateMap } from "./validation.ts";

export type EncounterKind = "combat" | "elite" | "final";

export type EncounterSquadMember = {
  id: string;
  name: string;
  archetypeId: "operator" | "runner" | "bulwark";
  hp: number;
  maxHp: number;
  baseMaxAp: number;
};

export const ENCOUNTER_WIDTH = 12;
export const ENCOUNTER_HEIGHT = 12;

const playerSpawns = [
  { x: 1, y: 3 },
  { x: 1, y: 6 },
  { x: 1, y: 8 },
];

const enemySpawns = [
  { x: 10, y: 3 },
  { x: 10, y: 6 },
  { x: 10, y: 8 },
  { x: 9, y: 5 },
  { x: 9, y: 9 },
  { x: 10, y: 1 },
];

function freshMap(): GameMap {
  const map = createEmptyMap();
  map.width = ENCOUNTER_WIDTH;
  map.height = ENCOUNTER_HEIGHT;
  map.tiles = new Array(map.width * map.height).fill("floor");
  map.units = [];
  for (let x = 0; x < map.width; x++) {
    setTile(map, x, 0, "wall");
    setTile(map, x, map.height - 1, "wall");
  }
  for (let y = 0; y < map.height; y++) {
    setTile(map, 0, y, "wall");
    setTile(map, map.width - 1, y, "wall");
  }
  return map;
}

function paintLaneTemplate(map: GameMap, rng: SeededRng): void {
  const gapsA = new Set(rng.shuffle([2, 4, 6, 8, 9]).slice(0, 2));
  const gapsB = new Set(rng.shuffle([2, 3, 5, 7, 9]).slice(0, 2));
  for (let y = 1; y < map.height - 1; y++) {
    if (!gapsA.has(y)) setTile(map, 4, y, y % 3 === 0 ? "half_cover" : "wall");
    if (!gapsB.has(y)) setTile(map, 7, y, y % 2 === 0 ? "half_cover" : "wall");
  }
}

function paintBunkerTemplate(map: GameMap, rng: SeededRng): void {
  for (let x = 4; x <= 7; x++) {
    setTile(map, x, 3, "wall");
    setTile(map, x, 8, "wall");
  }
  for (let y = 4; y <= 7; y++) {
    setTile(map, 4, y, "wall");
    setTile(map, 7, y, "wall");
  }
  const doors = rng.shuffle([
    { x: 5, y: 3 }, { x: 6, y: 8 }, { x: 4, y: 6 }, { x: 7, y: 5 },
  ]).slice(0, 3);
  for (const door of doors) setTile(map, door.x, door.y, "floor");
  setTile(map, 5, 5, "half_cover");
  setTile(map, 6, 6, "half_cover");
}

function paintStaggerTemplate(map: GameMap, rng: SeededRng): void {
  const offset = rng.int(0, 2);
  for (let x = 3; x <= 8; x += 2) {
    for (let y = 2 + ((x + offset) % 3); y <= 9; y += 4) {
      setTile(map, x, y, "wall");
      if (inBounds(map, x, y + 1)) setTile(map, x, y + 1, "half_cover");
    }
  }
}

function addCoverPods(map: GameMap, rng: SeededRng, depth: number): void {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 2; y < map.height - 2; y++) {
    for (let x = 2; x < map.width - 2; x++) {
      if (getTile(map, x, y) !== "floor") continue;
      if (playerSpawns.some((spawn) => Math.abs(spawn.x - x) + Math.abs(spawn.y - y) < 2)) continue;
      if (enemySpawns.some((spawn) => Math.abs(spawn.x - x) + Math.abs(spawn.y - y) < 2)) continue;
      candidates.push({ x, y });
    }
  }
  const count = Math.min(5 + Math.floor(depth / 2), 8);
  for (const point of rng.shuffle(candidates).slice(0, count)) {
    setTile(map, point.x, point.y, rng.next() < 0.7 ? "half_cover" : "wall");
  }
}

function carveGuaranteedRoutes(map: GameMap): void {
  for (const y of [3, 6, 8]) {
    for (let x = 1; x <= 10; x++) setTile(map, x, y, "floor");
  }
  for (const x of [2, 5, 9]) {
    for (let y = 1; y <= 10; y++) setTile(map, x, y, "floor");
  }
  for (const spawn of [...playerSpawns, ...enemySpawns]) {
    setTile(map, spawn.x, spawn.y, "floor");
  }
  // Break the three obvious spawn-to-spawn firing lanes. Each blocker has a
  // nearby vertical route, so it creates an angle to solve rather than a seal.
  setTile(map, 6, 3, "wall");
  setTile(map, 7, 6, "half_cover");
  setTile(map, 4, 8, "wall");
}

function enemyPool(depth: number, kind: EncounterKind): UnitArchetypeId[] {
  const pool: UnitArchetypeId[] = ["scrapper", "rifleman"];
  if (depth >= 2) pool.push("marksman");
  if (depth >= 3 || kind !== "combat") pool.push("sentinel");
  return pool;
}

function enemyCount(depth: number, kind: EncounterKind): number {
  if (kind === "final") return 6;
  const base = 2 + Math.floor(depth / 3);
  return Math.min(5, base + (kind === "elite" ? 1 : 0));
}

export function generateEncounter(
  rng: SeededRng,
  depth: number,
  kind: EncounterKind,
  squad: readonly EncounterSquadMember[],
  upgrades: readonly UpgradeId[],
): GameMap {
  const map = freshMap();
  const templates = [paintLaneTemplate, paintBunkerTemplate, paintStaggerTemplate] as const;
  rng.pick(templates)(map, rng);
  addCoverPods(map, rng, depth);
  carveGuaranteedRoutes(map);

  const living = squad.filter((member) => member.hp > 0);
  for (let i = 0; i < living.length; i++) {
    const member = living[i];
    const spawn = playerSpawns[i];
    const unit = makeArchetypeUnit(member.archetypeId, member.id, spawn.x, spawn.y, upgrades);
    unit.displayName = member.name;
    unit.maxHp = member.maxHp;
    unit.hp = Math.min(member.hp, member.maxHp);
    unit.maxAp = Math.max(1, member.baseMaxAp + upgrades.reduce((sum, id) => {
      if (id === "auxiliary_cell") return sum + 1;
      if (id === "volatile_cell") return sum + 2;
      return sum;
    }, 0));
    unit.ap = unit.maxAp;
    map.units.push(unit);
  }

  const count = enemyCount(depth, kind);
  const pool = enemyPool(depth, kind);
  const forcedFinal: UnitArchetypeId[] = kind === "final"
    ? ["sentinel", "marksman"]
    : kind === "elite"
      ? [rng.pick(["marksman", "sentinel"] as const)]
      : [];
  const types = [...forcedFinal];
  while (types.length < count) types.push(rng.pick(pool));
  for (let i = 0; i < count; i++) {
    const spawn = enemySpawns[i];
    const unit = makeArchetypeUnit(types[i], `enemy-${depth}-${i}`, spawn.x, spawn.y);
    map.units.push(unit);
  }

  const report = validateMap(map);
  if (report.hasErrors) {
    const first = report.issues.find((issue) => issue.severity === "error");
    throw new Error(`Generated invalid encounter: ${first?.code ?? "UNKNOWN"}`);
  }
  return map;
}

export function reachableFloorCount(map: GameMap, startX: number, startY: number): number {
  if (getTile(map, startX, startY) !== "floor") return 0;
  const queue = [{ x: startX, y: startY }];
  const seen = new Set([`${startX},${startY}`]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [dx, dy] of directions) {
      const x = current.x + dx;
      const y = current.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key) || getTile(map, x, y) !== "floor") continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen.size;
}
