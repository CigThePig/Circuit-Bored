import { getTile, setTile, type GameMap } from "./map.ts";
import { SeededRng } from "./rng.ts";
import type { LevelThemeId } from "./themes.ts";
import {
  paintBrokenRoom,
  paintCoverCluster,
  paintMachineryIsland,
  paintRect,
  paintRoomBoundary,
  paintUDefense,
  paintWallRun,
  paintZigZagDivider,
  pointsInRect,
  type MotifId,
  type Point,
  type Rect,
} from "./generationMotifs.ts";

export type LayoutEncounterKind = "combat" | "elite" | "final";

export type MacroZone = {
  id: string;
  purpose: "spawn" | "lane" | "room" | "connector" | "contested" | "flank";
  rect: Rect;
};

export type ThemeLayout = {
  playerCandidates: Point[];
  enemyCandidates: Point[];
  contestedPoints: Point[];
  zones: MacroZone[];
  motifs: MotifId[];
};

function choose<T>(rng: SeededRng, items: readonly T[]): T {
  return items[rng.int(0, items.length)];
}

function addFinalLandmark(map: GameMap, themeId: LevelThemeId, motifs: MotifId[]): void {
  motifs.push("central_landmark");
  if (themeId === "industrial") {
    paintRect(map, { x: 10, y: 9, width: 4, height: 6 }, "floor");
    paintMachineryIsland(map, { x: 10, y: 10, width: 4, height: 4 }, "e");
    paintCoverCluster(map, { x: 8, y: 10 }, "pair");
    paintCoverCluster(map, { x: 15, y: 12 }, "pair", 2);
  } else if (themeId === "data_core") {
    paintRect(map, { x: 9, y: 8, width: 6, height: 8 }, "floor");
    paintRoomBoundary(map, { x: 9, y: 8, width: 6, height: 8 }, [
      { x: 11, y: 8 }, { x: 12, y: 8 },
      { x: 11, y: 15 }, { x: 12, y: 15 },
      { x: 9, y: 11 }, { x: 14, y: 12 },
    ]);
    paintRect(map, { x: 11, y: 10, width: 2, height: 4 }, "wall");
  } else {
    paintRect(map, { x: 8, y: 8, width: 8, height: 8 }, "floor");
    paintUDefense(map, { x: 9, y: 9 }, 6, 6, "s");
    setTile(map, 9, 11, "floor");
    setTile(map, 14, 13, "floor");
    paintCoverCluster(map, { x: 10, y: 7 }, "stagger");
  }
}

function industrialLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const motifs: MotifId[] = ["wall_with_breaches", "machinery_island", "loading_zone"];
  const upperDivider = choose(rng, [7, 8] as const);
  const lowerDivider = choose(rng, [15, 16] as const);
  const firstBreaches = rng.shuffle([3, 7, 12, 16]).slice(0, 2).sort((a, b) => a - b);
  const secondBreaches = rng.shuffle([2, 8, 13, 17]).slice(0, 2).sort((a, b) => a - b);
  paintWallRun(map, { x: 2, y: upperDivider }, 20, true, firstBreaches, 2);
  paintWallRun(map, { x: 2, y: lowerDivider }, 20, true, secondBreaches, 2);

  const islands: Array<{ rect: Rect; side: "n" | "s" | "e" | "w" }> = [
    { rect: { x: choose(rng, [6, 7]), y: 2, width: 3, height: 3 }, side: "s" },
    { rect: { x: choose(rng, [12, 13]), y: upperDivider + 2, width: 3, height: 3 }, side: "w" },
    { rect: { x: choose(rng, [7, 8]), y: lowerDivider + 2, width: 4, height: 2 }, side: "n" },
  ];
  if (depth >= 3 || kind !== "combat") {
    motifs.push("paired_machinery");
    islands.push({ rect: { x: 16, y: upperDivider + 3, width: 2, height: 3 }, side: "e" });
  }
  for (const island of islands) paintMachineryIsland(map, island.rect, island.side);

  paintCoverCluster(map, { x: 4, y: upperDivider + 3 }, "stagger", rng.int(0, 4));
  paintCoverCluster(map, { x: 17, y: lowerDivider - 3 }, "corner", rng.int(0, 4));
  paintCoverCluster(map, { x: 10, y: lowerDivider + 3 }, "pair", rng.int(0, 4));
  if (kind !== "combat") {
    motifs.push("offset_bulkhead");
    paintWallRun(map, { x: 5, y: 11 }, 6, true, [2], 2);
    paintCoverCluster(map, { x: 5, y: 12 }, "pair", 3);
  }
  if (kind === "final") addFinalLandmark(map, "industrial", motifs);

  const zones: MacroZone[] = [
    { id: "player-pocket", purpose: "spawn", rect: { x: 2, y: 2, width: 4, height: Math.max(4, upperDivider - 3) } },
    { id: "upper-work-lane", purpose: "lane", rect: { x: 6, y: 1, width: 16, height: upperDivider - 1 } },
    { id: "processing-lane", purpose: "contested", rect: { x: 2, y: upperDivider + 1, width: 20, height: lowerDivider - upperDivider - 1 } },
    { id: "lower-flank", purpose: "flank", rect: { x: 2, y: lowerDivider + 1, width: 16, height: 22 - lowerDivider } },
    { id: "enemy-loading", purpose: "spawn", rect: { x: 18, y: lowerDivider + 1, width: 4, height: 22 - lowerDivider } },
  ];
  return {
    playerCandidates: pointsInRect(zones[0].rect),
    enemyCandidates: pointsInRect(zones[4].rect),
    contestedPoints: pointsInRect(zones[2].rect),
    zones,
    motifs,
  };
}

function dataCoreLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const motifs: MotifId[] = ["small_chamber", "cross_corridor", "defensive_checkpoint"];
  const leftPartition = choose(rng, [7, 8]);
  const rightPartition = choose(rng, [15, 16]);
  const crossPartition = choose(rng, [11, 12]);
  const leftDoors = rng.shuffle([3, 8, 16, 19]).slice(0, 3).sort((a, b) => a - b);
  const rightDoors = rng.shuffle([4, 9, 15, 19]).slice(0, 3).sort((a, b) => a - b);
  paintWallRun(map, { x: leftPartition, y: 1 }, 22, false, leftDoors, 2);
  paintWallRun(map, { x: rightPartition, y: 1 }, 22, false, rightDoors, 2);
  const crossDoors = [
    choose(rng, [2, 3]),
    choose(rng, [leftPartition + 2, leftPartition + 4]),
    choose(rng, [rightPartition + 2, rightPartition + 4]),
  ];
  paintWallRun(map, { x: 1, y: crossPartition }, 22, true, crossDoors, 2);

  // Repeated room-edge equipment creates ordered defensive positions without
  // filling the deliberately exposed corridor crossings.
  paintCoverCluster(map, { x: 3, y: 4 }, "corner", 0);
  paintCoverCluster(map, { x: leftPartition + 3, y: 3 }, "pair", 0);
  paintCoverCluster(map, { x: rightPartition + 3, y: 7 }, "pair", 2);
  paintCoverCluster(map, { x: 3, y: crossPartition + 4 }, "pair", 1);
  paintCoverCluster(map, { x: leftPartition + 4, y: crossPartition + 5 }, "corner", 2);
  paintCoverCluster(map, { x: rightPartition + 3, y: crossPartition + 4 }, "pair", 3);

  if (depth >= 2) {
    motifs.push("t_junction");
    paintWallRun(map, { x: leftPartition + 3, y: 6 }, rightPartition - leftPartition - 5, true, [2], 2);
  }
  if (kind !== "combat") {
    motifs.push("large_chamber");
    paintWallRun(map, { x: 10, y: crossPartition + 3 }, 6, false, [2], 2);
    paintCoverCluster(map, { x: 11, y: crossPartition + 5 }, "pocket", 1);
  }
  if (kind === "final") addFinalLandmark(map, "data_core", motifs);

  const playerTop = rng.next() < 0.5;
  const playerRect: Rect = playerTop
    ? { x: 2, y: 2, width: leftPartition - 3, height: 7 }
    : { x: 2, y: crossPartition + 2, width: leftPartition - 3, height: 8 };
  const enemyRect: Rect = playerTop
    ? { x: rightPartition + 2, y: crossPartition + 2, width: 21 - rightPartition, height: 8 }
    : { x: rightPartition + 2, y: 2, width: 21 - rightPartition, height: 7 };
  const zones: MacroZone[] = [
    { id: "player-room", purpose: "spawn", rect: playerRect },
    { id: "north-rooms", purpose: "room", rect: { x: leftPartition + 1, y: 1, width: rightPartition - leftPartition - 1, height: crossPartition - 1 } },
    { id: "cross-corridor", purpose: "connector", rect: { x: 1, y: crossPartition - 1, width: 22, height: 3 } },
    { id: "core-chamber", purpose: "contested", rect: { x: leftPartition + 1, y: crossPartition + 1, width: rightPartition - leftPartition - 1, height: 21 - crossPartition } },
    { id: "south-flank", purpose: "flank", rect: { x: 2, y: crossPartition + 1, width: leftPartition - 2, height: 21 - crossPartition } },
    { id: "enemy-room", purpose: "spawn", rect: enemyRect },
  ];
  return {
    playerCandidates: pointsInRect(playerRect),
    enemyCandidates: pointsInRect(enemyRect),
    contestedPoints: pointsInRect(zones[3].rect),
    zones,
    motifs,
  };
}

function derelictLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const motifs: MotifId[] = ["broken_room", "zig_zag_divider", "u_defense", "salvage_cluster"];
  paintBrokenRoom(map, { x: 3, y: 2, width: 7, height: 7 }, choose(rng, ["s", "e"] as const));
  paintBrokenRoom(map, { x: 15, y: 15, width: 6, height: 7 }, choose(rng, ["n", "w"] as const));
  paintUDefense(map, { x: 11, y: 3 }, 5, 5, choose(rng, ["n", "s"] as const));
  paintZigZagDivider(map, { x: 7, y: 10 }, 6, 3, 2);
  paintWallRun(map, { x: 3, y: 12 }, 6, true, [2], 2);
  paintWallRun(map, { x: 18, y: 6 }, 6, false, [2], 2);
  motifs.push("offset_bulkhead", "l_room");

  const clusters: Array<{ point: Point; pattern: "pair" | "stagger" | "corner" | "pocket" }> = [
    { point: { x: 4, y: 9 }, pattern: "stagger" },
    { point: { x: 11, y: 10 }, pattern: "pocket" },
    { point: { x: 16, y: 4 }, pattern: "corner" },
    { point: { x: 5, y: 17 }, pattern: "stagger" },
    { point: { x: 18, y: 13 }, pattern: "pair" },
    { point: { x: 12, y: 19 }, pattern: "corner" },
  ];
  for (const cluster of clusters) paintCoverCluster(map, cluster.point, cluster.pattern, rng.int(0, 4));
  if (depth >= 3 || kind !== "combat") {
    paintBrokenRoom(map, { x: 2, y: 15, width: 7, height: 6 }, "e");
    paintCoverCluster(map, { x: 9, y: 15 }, "pocket", rng.int(0, 4));
  }
  if (kind === "final") addFinalLandmark(map, "derelict", motifs);

  const playerRect: Rect = { x: 2, y: 14, width: 5, height: 8 };
  const enemyRect: Rect = { x: 18, y: 2, width: 4, height: 7 };
  const zones: MacroZone[] = [
    { id: "player-salvage-pocket", purpose: "spawn", rect: playerRect },
    { id: "broken-workshop", purpose: "room", rect: { x: 2, y: 2, width: 9, height: 8 } },
    { id: "crooked-crossing", purpose: "contested", rect: { x: 7, y: 9, width: 10, height: 8 } },
    { id: "maintenance-flank", purpose: "flank", rect: { x: 9, y: 16, width: 12, height: 6 } },
    { id: "enemy-scrap-fort", purpose: "spawn", rect: enemyRect },
  ];
  return {
    playerCandidates: pointsInRect(playerRect),
    enemyCandidates: pointsInRect(enemyRect),
    contestedPoints: pointsInRect(zones[2].rect),
    zones,
    motifs,
  };
}

function transformPoint(point: Point, size: number, rotations: number, mirror: boolean): Point {
  let transformed = { ...point };
  for (let rotation = 0; rotation < rotations; rotation++) {
    transformed = { x: size - 1 - transformed.y, y: transformed.x };
  }
  if (mirror) transformed.x = size - 1 - transformed.x;
  return transformed;
}

function transformLayout(map: GameMap, layout: ThemeLayout, rotations: number, mirror: boolean): ThemeLayout {
  if (rotations === 0 && !mirror) return layout;
  const original = [...map.tiles];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const target = transformPoint({ x, y }, map.width, rotations, mirror);
      map.tiles[target.y * map.width + target.x] = original[y * map.width + x];
    }
  }
  const transformPoints = (points: Point[]) => points.map((point) => transformPoint(point, map.width, rotations, mirror));
  return {
    ...layout,
    playerCandidates: transformPoints(layout.playerCandidates),
    enemyCandidates: transformPoints(layout.enemyCandidates),
    contestedPoints: transformPoints(layout.contestedPoints),
  };
}

export function buildThemeLayout(
  map: GameMap,
  themeId: LevelThemeId,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  let layout = themeId === "industrial"
    ? industrialLayout(map, rng, depth, kind)
    : themeId === "data_core"
      ? dataCoreLayout(map, rng, depth, kind)
      : derelictLayout(map, rng, depth, kind);
  const rotations = rng.int(0, 4);
  const mirror = rng.next() < 0.5;
  layout = transformLayout(map, layout, rotations, mirror);
  // Remove transformed candidates that no longer describe walkable space.
  layout.playerCandidates = layout.playerCandidates.filter(({ x, y }) => getTile(map, x, y) === "floor");
  layout.enemyCandidates = layout.enemyCandidates.filter(({ x, y }) => getTile(map, x, y) === "floor");
  layout.contestedPoints = layout.contestedPoints.filter(({ x, y }) => getTile(map, x, y) === "floor");
  return layout;
}
