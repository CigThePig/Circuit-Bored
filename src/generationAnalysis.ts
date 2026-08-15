import { canShootTarget } from "./combat.ts";
import { getTile, inBounds, setTile, type GameMap, type TileType, type Unit } from "./map.ts";
import { levelThemeId, type LevelThemeId } from "./themes.ts";
import type { Point } from "./generationMotifs.ts";
import { pointInRect } from "./environment.ts";

const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;
const COVER_NEIGHBORS = [
  ...DIRECTIONS,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
] as const;

export type GeneratedMapMetrics = {
  themeId: LevelThemeId;
  floorCount: number;
  wallCount: number;
  halfCoverCount: number;
  floorRegionCount: number;
  wallMassCount: number;
  isolatedWallCount: number;
  longestWallRun: number;
  wallJunctionCount: number;
  clusteredCoverRatio: number;
  largestOpenSquare: number;
  averageTeamPathDistance: number;
  openingFirePairs: number;
  routeBranches: number;
  corridorTileCount: number;
  mandatoryChokeCount: number;
  contestedCoverPositions: number;
  landmarkCount: number;
  majorLandmarkCount: number;
  secondaryStructureCount: number;
  largestLandmarkFootprint: number;
  floorQuietnessRatio: number;
  highAttentionFloorRatio: number;
  largestCalmRegion: number;
};

export type TacticalQualityIssue = {
  code: string;
  message: string;
};

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function tilePoints(map: GameMap, tile: TileType): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (getTile(map, x, y) === tile) points.push({ x, y });
    }
  }
  return points;
}

function components(map: GameMap, tile: TileType): Point[][] {
  const remaining = new Set(tilePoints(map, tile).map(pointKey));
  const result: Point[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const [firstX, firstY] = first.split(",").map(Number);
    const queue: Point[] = [{ x: firstX, y: firstY }];
    const component: Point[] = [];
    remaining.delete(first);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const direction of DIRECTIONS) {
        const next = { x: current.x + direction.x, y: current.y + direction.y };
        const key = pointKey(next);
        if (!remaining.has(key)) continue;
        remaining.delete(key);
        queue.push(next);
      }
    }
    result.push(component);
  }
  return result.sort((a, b) => b.length - a.length);
}

export function floorRegions(map: GameMap): Point[][] {
  return components(map, "floor");
}

export function reachableFloorCount(map: GameMap, startX: number, startY: number): number {
  if (getTile(map, startX, startY) !== "floor") return 0;
  const startKey = `${startX},${startY}`;
  const region = floorRegions(map).find((candidate) => candidate.some((point) => pointKey(point) === startKey));
  return region?.length ?? 0;
}

/**
 * Connects accidental floor pockets by removing the least expensive local
 * obstruction. Half cover is cheaper than structural wall, so repairs tend to
 * reopen a blocked doorway instead of cutting a highway through architecture.
 */
export function repairFloorConnectivity(map: GameMap, maxRepairs = 12): number {
  let repairs = 0;
  while (repairs < maxRepairs) {
    const regions = floorRegions(map);
    if (regions.length <= 1) break;
    const main = new Set(regions[0].map(pointKey));
    const source = regions[regions.length - 1];
    const distance = new Map<string, number>();
    const parent = new Map<string, string>();
    const queue: Array<{ point: Point; cost: number }> = [];
    for (const point of source) {
      const key = pointKey(point);
      distance.set(key, 0);
      queue.push({ point, cost: 0 });
    }
    let destination: string | null = null;
    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift()!;
      const currentKey = pointKey(current.point);
      if (current.cost !== distance.get(currentKey)) continue;
      if (main.has(currentKey)) {
        destination = currentKey;
        break;
      }
      for (const direction of DIRECTIONS) {
        const next = { x: current.point.x + direction.x, y: current.point.y + direction.y };
        if (!inBounds(map, next.x, next.y)) continue;
        if (next.x === 0 || next.y === 0 || next.x === map.width - 1 || next.y === map.height - 1) continue;
        const tile = getTile(map, next.x, next.y);
        const stepCost = tile === "floor" ? 0.05 : tile === "half_cover" ? 1 : 4;
        const nextCost = current.cost + stepCost;
        const nextKey = pointKey(next);
        if (nextCost >= (distance.get(nextKey) ?? Infinity)) continue;
        distance.set(nextKey, nextCost);
        parent.set(nextKey, currentKey);
        queue.push({ point: next, cost: nextCost });
      }
    }
    if (!destination) break;
    let cursor: string | undefined = destination;
    let carved = 0;
    while (cursor && !source.some((point) => pointKey(point) === cursor)) {
      const [x, y] = cursor.split(",").map(Number);
      if (getTile(map, x, y) !== "floor") {
        setTile(map, x, y, "floor");
        carved += 1;
      }
      cursor = parent.get(cursor);
    }
    if (carved === 0) break;
    repairs += carved;
  }
  return repairs;
}

export function repairIsolatedWalls(map: GameMap): number {
  let repaired = 0;
  for (const mass of components(map, "wall")) {
    if (mass.length !== 1) continue;
    const point = mass[0];
    if (point.x === 0 || point.y === 0 || point.x === map.width - 1 || point.y === map.height - 1) continue;
    setTile(map, point.x, point.y, "half_cover");
    repaired += 1;
  }
  return repaired;
}

export function passableNeighborCount(map: GameMap, x: number, y: number): number {
  return DIRECTIONS.filter((direction) => getTile(map, x + direction.x, y + direction.y) === "floor").length;
}

function longestWallRun(map: GameMap): number {
  let longest = 0;
  for (let y = 1; y < map.height - 1; y++) {
    let run = 0;
    for (let x = 1; x < map.width - 1; x++) {
      run = getTile(map, x, y) === "wall" ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  for (let x = 1; x < map.width - 1; x++) {
    let run = 0;
    for (let y = 1; y < map.height - 1; y++) {
      run = getTile(map, x, y) === "wall" ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  return longest;
}

function wallJunctionCount(map: GameMap): number {
  let count = 0;
  for (const point of tilePoints(map, "wall")) {
    const north = getTile(map, point.x, point.y - 1) === "wall";
    const south = getTile(map, point.x, point.y + 1) === "wall";
    const east = getTile(map, point.x + 1, point.y) === "wall";
    const west = getTile(map, point.x - 1, point.y) === "wall";
    if ((north || south) && (east || west)) count += 1;
  }
  return count;
}

function clusteredCoverRatio(map: GameMap): number {
  const cover = tilePoints(map, "half_cover");
  if (cover.length === 0) return 0;
  const clustered = cover.filter((point) => COVER_NEIGHBORS.some((direction) => {
    const tile = getTile(map, point.x + direction.x, point.y + direction.y);
    return tile === "wall" || tile === "half_cover";
  })).length;
  return clustered / cover.length;
}

function largestOpenSquare(map: GameMap): number {
  const row = new Array(map.width).fill(0);
  let largest = 0;
  for (let y = 0; y < map.height; y++) {
    let previous = 0;
    for (let x = 0; x < map.width; x++) {
      const above = row[x];
      if (getTile(map, x, y) !== "floor") {
        row[x] = 0;
      } else if (x === 0 || y === 0) {
        row[x] = 1;
      } else {
        row[x] = 1 + Math.min(row[x], row[x - 1], previous);
      }
      previous = above;
      largest = Math.max(largest, row[x]);
    }
  }
  return largest;
}

function distanceGrid(map: GameMap, start: Point, blockedKey?: string): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: Point[] = [start];
  distances.set(pointKey(start), 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const distance = distances.get(pointKey(current))!;
    for (const direction of DIRECTIONS) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = pointKey(next);
      if (key === blockedKey || distances.has(key) || getTile(map, next.x, next.y) !== "floor") continue;
      distances.set(key, distance + 1);
      queue.push(next);
    }
  }
  return distances;
}

export function floorPathDistance(map: GameMap, from: Point, to: Point): number {
  return distanceGrid(map, from).get(pointKey(to)) ?? Infinity;
}

function averageTeamPathDistance(map: GameMap): number {
  const players = map.units.filter((unit) => unit.team === "player" && unit.hp > 0);
  const enemies = map.units.filter((unit) => unit.team === "enemy" && unit.hp > 0);
  if (players.length === 0 || enemies.length === 0) return 0;
  const distances: number[] = [];
  for (const player of players) {
    const grid = distanceGrid(map, player);
    const nearest = Math.min(...enemies.map((enemy) => grid.get(pointKey(enemy)) ?? Infinity));
    if (Number.isFinite(nearest)) distances.push(nearest);
  }
  return distances.length === 0 ? 0 : distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
}

function openingFirePairs(map: GameMap): number {
  const players = map.units.filter((unit) => unit.team === "player" && unit.hp > 0);
  const enemies = map.units.filter((unit) => unit.team === "enemy" && unit.hp > 0);
  let pairs = 0;
  for (const player of players) {
    for (const enemy of enemies) {
      if (canShootTarget(map, player, enemy).canShoot) pairs += 1;
    }
  }
  return pairs;
}

function routeBranches(map: GameMap): number {
  const player = map.units.find((unit) => unit.team === "player" && unit.hp > 0);
  const enemies = map.units.filter((unit) => unit.team === "enemy" && unit.hp > 0);
  if (!player || enemies.length === 0) return 0;
  const startKey = pointKey(player);
  let branches = 0;
  for (const direction of DIRECTIONS) {
    const next = { x: player.x + direction.x, y: player.y + direction.y };
    if (getTile(map, next.x, next.y) !== "floor") continue;
    const distances = distanceGrid(map, next, startKey);
    if (enemies.some((enemy) => distances.has(pointKey(enemy)))) branches += 1;
  }
  return branches;
}

function corridorTileCount(map: GameMap): number {
  return tilePoints(map, "floor").filter((point) => {
    const north = getTile(map, point.x, point.y - 1) === "floor";
    const south = getTile(map, point.x, point.y + 1) === "floor";
    const east = getTile(map, point.x + 1, point.y) === "floor";
    const west = getTile(map, point.x - 1, point.y) === "floor";
    return (north && south && !east && !west) || (east && west && !north && !south);
  }).length;
}

function mandatoryChokeCount(map: GameMap): number {
  const floors = tilePoints(map, "floor");
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string>();
  const subtreeSize = new Map<string, number>();
  const articulation = new Set<string>();
  const meaningfulSide = Math.max(24, Math.floor(floors.length * 0.07));
  let time = 0;
  const visit = (point: Point): void => {
    const key = pointKey(point);
    time += 1;
    discovery.set(key, time);
    low.set(key, time);
    let children = 0;
    let size = 1;
    for (const direction of DIRECTIONS) {
      const next = { x: point.x + direction.x, y: point.y + direction.y };
      if (getTile(map, next.x, next.y) !== "floor") continue;
      const nextKey = pointKey(next);
      if (!discovery.has(nextKey)) {
        children += 1;
        parent.set(nextKey, key);
        visit(next);
        size += subtreeSize.get(nextKey)!;
        low.set(key, Math.min(low.get(key)!, low.get(nextKey)!));
        const separated = subtreeSize.get(nextKey)!;
        const remainder = floors.length - separated - 1;
        if (low.get(nextKey)! >= discovery.get(key)! && Math.min(separated, remainder) >= meaningfulSide) {
          articulation.add(key);
        }
      } else if (parent.get(key) !== nextKey) {
        low.set(key, Math.min(low.get(key)!, discovery.get(nextKey)!));
      }
    }
    subtreeSize.set(key, size);
  };
  for (const point of floors) {
    if (!discovery.has(pointKey(point))) visit(point);
  }
  return articulation.size;
}

function contestedCoverPositions(map: GameMap, contestedPoints: readonly Point[]): number {
  return contestedPoints.filter((point) => getTile(map, point.x, point.y) === "floor" && DIRECTIONS.some((direction) => {
    const tile = getTile(map, point.x + direction.x, point.y + direction.y);
    return tile === "wall" || tile === "half_cover";
  })).length;
}

function environmentHierarchy(map: GameMap): Pick<GeneratedMapMetrics,
  "landmarkCount" | "majorLandmarkCount" | "secondaryStructureCount" |
  "largestLandmarkFootprint" | "floorQuietnessRatio" | "highAttentionFloorRatio" | "largestCalmRegion"
> {
  const environment = map.environment;
  const floors = tilePoints(map, "floor");
  if (!environment || floors.length === 0) {
    return {
      landmarkCount: 0,
      majorLandmarkCount: 0,
      secondaryStructureCount: 0,
      largestLandmarkFootprint: 0,
      floorQuietnessRatio: 1,
      highAttentionFloorRatio: 0,
      largestCalmRegion: floors.length,
    };
  }
  const treated = new Set<string>();
  const attention = new Set<string>();
  for (const point of floors) {
    for (const zone of environment.floorZones) {
      if (!pointInRect(point.x, point.y, zone.rect)) continue;
      const localX = point.x - zone.rect.x;
      const localY = point.y - zone.rect.y;
      treated.add(pointKey(point));
      const centerX = Math.floor((zone.rect.width - 1) / 2);
      const centerY = Math.floor((zone.rect.height - 1) / 2);
      const vertical = zone.rect.height > zone.rect.width;
      const highAttention =
        ((zone.treatment === "service_lane" || zone.treatment === "server_hall") &&
          ((vertical && localX === centerX) || (!vertical && localY === centerY))) ||
        (zone.treatment === "checkpoint_threshold" && localY === centerY) ||
        (zone.treatment === "loading_apron" && (localY === 1 || localY === zone.rect.height - 2));
      if (highAttention) attention.add(pointKey(point));
    }
  }
  const quiet = floors.filter((point) => !treated.has(pointKey(point)));
  const quietKeys = new Set(quiet.map(pointKey));
  let largestCalmRegion = 0;
  while (quietKeys.size > 0) {
    const start = quietKeys.values().next().value as string;
    quietKeys.delete(start);
    const queue = [start];
    let size = 0;
    while (queue.length > 0) {
      const key = queue.shift()!;
      size += 1;
      const [x, y] = key.split(",").map(Number);
      for (const direction of DIRECTIONS) {
        const next = `${x + direction.x},${y + direction.y}`;
        if (!quietKeys.delete(next)) continue;
        queue.push(next);
      }
    }
    largestCalmRegion = Math.max(largestCalmRegion, size);
  }
  return {
    landmarkCount: environment.landmarks.length,
    majorLandmarkCount: environment.landmarks.filter(({ importance }) => importance === "major").length,
    secondaryStructureCount: environment.landmarks.filter(({ importance }) => importance === "secondary").length,
    largestLandmarkFootprint: Math.max(0, ...environment.landmarks.map(({ rect }) => rect.width * rect.height)),
    floorQuietnessRatio: quiet.length / floors.length,
    highAttentionFloorRatio: attention.size / floors.length,
    largestCalmRegion,
  };
}

export function analyzeGeneratedMap(map: GameMap, contestedPoints: readonly Point[] = []): GeneratedMapMetrics {
  const walls = components(map, "wall");
  const isolatedWallCount = walls.filter((mass) => mass.length === 1).length;
  return {
    themeId: levelThemeId(map.themeId),
    floorCount: tilePoints(map, "floor").length,
    wallCount: tilePoints(map, "wall").length,
    halfCoverCount: tilePoints(map, "half_cover").length,
    floorRegionCount: floorRegions(map).length,
    wallMassCount: walls.length,
    isolatedWallCount,
    longestWallRun: longestWallRun(map),
    wallJunctionCount: wallJunctionCount(map),
    clusteredCoverRatio: clusteredCoverRatio(map),
    largestOpenSquare: largestOpenSquare(map),
    averageTeamPathDistance: averageTeamPathDistance(map),
    openingFirePairs: openingFirePairs(map),
    routeBranches: routeBranches(map),
    corridorTileCount: corridorTileCount(map),
    mandatoryChokeCount: mandatoryChokeCount(map),
    contestedCoverPositions: contestedCoverPositions(map, contestedPoints),
    ...environmentHierarchy(map),
  };
}

function livingUnits(map: GameMap): Unit[] {
  return map.units.filter((unit) => unit.hp > 0);
}

export function validateGeneratedMap(
  map: GameMap,
  contestedPoints: readonly Point[] = [],
  precomputedMetrics?: GeneratedMapMetrics,
): TacticalQualityIssue[] {
  const metrics = precomputedMetrics ?? analyzeGeneratedMap(map, contestedPoints);
  const issues: TacticalQualityIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (metrics.floorRegionCount !== 1) add("SEALED_FLOOR_REGION", `Expected one floor region; found ${metrics.floorRegionCount}.`);
  if (metrics.floorCount < 260) add("INSUFFICIENT_FLOOR", `Only ${metrics.floorCount} floor tiles are usable.`);
  if (metrics.wallCount < 105) add("INSUFFICIENT_STRUCTURE", `Only ${metrics.wallCount} wall tiles form structure.`);
  if (metrics.halfCoverCount < 10) add("INSUFFICIENT_COVER", `Only ${metrics.halfCoverCount} half-cover tiles were placed.`);
  if (metrics.isolatedWallCount > 2) add("WALL_CONFETTI", `${metrics.isolatedWallCount} isolated walls remain.`);
  if (metrics.largestOpenSquare > 9) add("EMPTY_DANCE_FLOOR", `A ${metrics.largestOpenSquare}x${metrics.largestOpenSquare} empty square remains.`);
  if (metrics.clusteredCoverRatio < 0.5) add("LONELY_COVER", "Too much cover is isolated from structures or cover clusters.");
  if (metrics.openingFirePairs > 2) add("OPENING_FIRE", `${metrics.openingFirePairs} player/enemy pairs can fire immediately.`);
  if (metrics.averageTeamPathDistance < 12) add("SPAWNS_TOO_CLOSE", "Opposing spawn zones are too close by walking distance.");
  if (metrics.routeBranches < 2) add("SINGLE_OPENING_ROUTE", "The player spawn has fewer than two viable opening branches.");
  const allowedChokes = metrics.themeId === "data_core" ? 6 : 2;
  if (metrics.mandatoryChokeCount > allowedChokes) {
    add("MANDATORY_CHOKE", `${metrics.mandatoryChokeCount} floor tiles are accidental mandatory articulation points.`);
  }
  if (contestedPoints.length > 0 && metrics.contestedCoverPositions < 4) {
    add("UNSUPPORTED_CONTESTED_ZONE", "The main contested zone lacks enough wall- or cover-adjacent positions.");
  }
  for (const unit of livingUnits(map)) {
    if (getTile(map, unit.x, unit.y) !== "floor") add("ILLEGAL_SPAWN", `Unit '${unit.id}' is not on floor.`);
    if (passableNeighborCount(map, unit.x, unit.y) < 2) add("CRAMPED_SPAWN", `Unit '${unit.id}' has fewer than two local moves.`);
  }
  const kinds = new Set(map.environment?.landmarks.map(({ kind }) => kind) ?? []);
  if (metrics.themeId === "industrial" && !kinds.has("furnace_block") && !kinds.has("coolant_tanks") && !kinds.has("processing_line")) {
    add("WEAK_INDUSTRIAL_GRAMMAR", "Industrial layout lacks a major processing landmark.");
  }
  if (metrics.themeId === "data_core" && !kinds.has("server_vault") && !kinds.has("data_core")) {
    add("WEAK_DATA_CORE_GRAMMAR", "Data Core layout lacks a controlled core or vault landmark.");
  }
  if (metrics.themeId === "derelict" && !kinds.has("collapsed_room") && !kinds.has("scrap_heap")) {
    add("WEAK_DERELICT_GRAMMAR", "Derelict layout lacks a damaged architectural landmark.");
  }
  if (metrics.landmarkCount < 2 || metrics.landmarkCount > 4) {
    add("WEAK_FEATURE_HIERARCHY", `Expected 2–4 named landmarks; found ${metrics.landmarkCount}.`);
  }
  if (metrics.majorLandmarkCount < 1 || metrics.largestLandmarkFootprint < 30) {
    add("MISSING_MAJOR_LANDMARK", "The map lacks a major landmark with a readable multi-tile footprint.");
  }
  if (metrics.floorQuietnessRatio < 0.5) {
    add("FLOOR_TOO_BUSY", `Only ${Math.round(metrics.floorQuietnessRatio * 100)}% of floor remains untreated quiet space.`);
  }
  if (metrics.highAttentionFloorRatio > 0.1) {
    add("EXCESSIVE_FLOOR_ACCENTS", `${Math.round(metrics.highAttentionFloorRatio * 100)}% of floor uses high-attention regional accents.`);
  }
  if (metrics.largestCalmRegion < 80) {
    add("NO_CALM_REGION", `The largest connected quiet floor region contains only ${metrics.largestCalmRegion} tiles.`);
  }
  return issues;
}
