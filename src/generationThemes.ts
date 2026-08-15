import type { FeatureBudget, FloorTreatmentZone, MapLandmark, MapRect } from "./environment.ts";
import {
  paintBreachedCorridor,
  paintCollapsedRoom,
  paintCoolantTanks,
  paintDataCore,
  paintFurnaceBlock,
  paintLoadingBay,
  paintProcessingLine,
  paintScrapHeap,
  paintSecurityCheckpoint,
  paintServerRows,
  paintServerVault,
  paintWreckedMachinery,
  type LandmarkPlacement,
} from "./generationLandmarks.ts";
import {
  paintCoverCluster,
  paintWallRun,
  pointsInRect,
  type MotifId,
  type Point,
  type Rect,
} from "./generationMotifs.ts";
import { getTile, type GameMap } from "./map.ts";
import { SeededRng } from "./rng.ts";
import type { LevelThemeId } from "./themes.ts";

export type LayoutEncounterKind = "combat" | "elite" | "final";

export type MacroZone = {
  id: string;
  purpose: "spawn" | "lane" | "room" | "connector" | "contested" | "flank" | "landmark";
  rect: Rect;
};

export type ThemeLayout = {
  playerCandidates: Point[];
  enemyCandidates: Point[];
  contestedPoints: Point[];
  zones: MacroZone[];
  motifs: MotifId[];
  landmarks: MapLandmark[];
  floorZones: FloorTreatmentZone[];
  featureBudget: FeatureBudget;
};

type LayoutParts = {
  landmarks: MapLandmark[];
  floorZones: FloorTreatmentZone[];
  motifs: MotifId[];
};

function choose<T>(rng: SeededRng, items: readonly T[]): T {
  return items[rng.int(0, items.length)];
}

function featureBudget(depth: number, kind: LayoutEncounterKind): FeatureBudget {
  if (kind === "final") return { major: 2, secondary: 2, minor: 2 };
  if (kind === "elite" || depth >= 3) return { major: 2, secondary: 1, minor: 2 };
  return { major: 1, secondary: 1, minor: 2 };
}

function addPlacement(parts: LayoutParts, placement: LandmarkPlacement): void {
  parts.landmarks.push(placement.landmark);
  parts.floorZones.push(placement.floorZone);
  parts.motifs.push(placement.landmark.kind);
}

function industrialLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const budget = featureBudget(depth, kind);
  const parts: LayoutParts = { landmarks: [], floorZones: [], motifs: [] };
  const primaryRect = choose(rng, [
    { x: 8, y: 8, width: 7, height: 7 },
    { x: 9, y: 7, width: 7, height: 8 },
    { x: 8, y: 9, width: 8, height: 7 },
  ] as const);
  addPlacement(parts, rng.next() < 0.55
    ? paintFurnaceBlock(map, primaryRect)
    : paintCoolantTanks(map, primaryRect));

  const loadingY = choose(rng, [15, 16] as const);
  const loadingRect = rng.next() < 0.5
    ? { x: 2, y: loadingY, width: 8, height: 6 }
    : { x: 14, y: loadingY, width: 8, height: 6 };
  addPlacement(parts, paintLoadingBay(map, loadingRect));

  if (budget.major > 1) {
    addPlacement(parts, paintProcessingLine(map, { x: 3, y: 3, width: 18, height: 5 }));
  } else {
    parts.motifs.push("wall_with_breaches");
    paintWallRun(map, { x: 3, y: 5 }, 18, true, [5, 13], 2);
  }

  if (budget.secondary > 1) {
    const secondary = primaryRect.x < 9
      ? { x: 17, y: 8, width: 5, height: 6 }
      : { x: 2, y: 8, width: 5, height: 6 };
    addPlacement(parts, paintLoadingBay(map, secondary, "service-dock", "Service Dock"));
  }

  paintCoverCluster(map, { x: 4, y: 12 }, "stagger", rng.int(0, 4));
  paintCoverCluster(map, { x: 17, y: 13 }, "corner", rng.int(0, 4));
  parts.motifs.push("machinery_island", "offset_bulkhead");

  const playerRect: Rect = { x: 2, y: 2, width: 5, height: 4 };
  const enemyRect: Rect = { x: 18, y: 18, width: 4, height: 4 };
  const zones: MacroZone[] = [
    { id: "player-service-pocket", purpose: "spawn", rect: playerRect },
    { id: "upper-work-lane", purpose: "lane", rect: { x: 2, y: 2, width: 20, height: 6 } },
    { id: "processing-floor", purpose: "contested", rect: { x: 6, y: 7, width: 12, height: 10 } },
    { id: "side-service-route", purpose: "flank", rect: { x: 2, y: 8, width: 5, height: 11 } },
    { id: "loading-approach", purpose: "landmark", rect: loadingRect },
    { id: "enemy-staging", purpose: "spawn", rect: enemyRect },
  ];
  return {
    playerCandidates: pointsInRect(playerRect),
    enemyCandidates: pointsInRect(enemyRect),
    contestedPoints: pointsInRect(zones[2].rect),
    zones,
    motifs: parts.motifs,
    landmarks: parts.landmarks,
    floorZones: parts.floorZones,
    featureBudget: budget,
  };
}

function dataCoreLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const budget = featureBudget(depth, kind);
  const parts: LayoutParts = { landmarks: [], floorZones: [], motifs: [] };
  const vaultRect = choose(rng, [
    { x: 8, y: 7, width: 8, height: 10 },
    { x: 9, y: 7, width: 7, height: 10 },
    { x: 8, y: 8, width: 9, height: 8 },
  ] as const);
  addPlacement(parts, rng.next() < 0.6
    ? paintServerVault(map, vaultRect)
    : paintDataCore(map, vaultRect));

  const checkpointRect = rng.next() < 0.5
    ? { x: 2, y: 15, width: 9, height: 4 }
    : { x: 13, y: 4, width: 9, height: 4 };
  addPlacement(parts, paintSecurityCheckpoint(map, checkpointRect));

  if (budget.major > 1) {
    const coreRect = vaultRect.x < 9
      ? { x: 17, y: 14, width: 5, height: 7 }
      : { x: 2, y: 3, width: 6, height: 7 };
    addPlacement(parts, paintDataCore(map, coreRect, "auxiliary-core"));
  }
  if (budget.secondary > 1) {
    const rowsRect = checkpointRect.x < 10
      ? { x: 17, y: 3, width: 5, height: 10 }
      : { x: 2, y: 9, width: 5, height: 10 };
    addPlacement(parts, paintServerRows(map, rowsRect));
  }

  paintCoverCluster(map, { x: 4, y: 7 }, "pair", rng.int(0, 4));
  paintCoverCluster(map, { x: 18, y: 16 }, "corner", rng.int(0, 4));
  paintCoverCluster(map, { x: 11, y: 19 }, "pair", rng.int(0, 4));
  parts.motifs.push("small_chamber", "cross_corridor");

  const playerTop = rng.next() < 0.5;
  const playerRect: Rect = playerTop
    ? { x: 2, y: 2, width: 5, height: 4 }
    : { x: 2, y: 18, width: 5, height: 4 };
  const enemyRect: Rect = playerTop
    ? { x: 18, y: 18, width: 4, height: 4 }
    : { x: 18, y: 2, width: 4, height: 4 };
  const zones: MacroZone[] = [
    { id: "player-room", purpose: "spawn", rect: playerRect },
    { id: "west-rooms", purpose: "room", rect: { x: 2, y: 6, width: 6, height: 11 } },
    { id: "vault-chamber", purpose: "landmark", rect: vaultRect },
    { id: "controlled-crossing", purpose: "contested", rect: { x: 7, y: 5, width: 11, height: 14 } },
    { id: "east-service-route", purpose: "flank", rect: { x: 17, y: 7, width: 5, height: 10 } },
    { id: "enemy-room", purpose: "spawn", rect: enemyRect },
  ];
  return {
    playerCandidates: pointsInRect(playerRect),
    enemyCandidates: pointsInRect(enemyRect),
    contestedPoints: pointsInRect(zones[3].rect),
    zones,
    motifs: parts.motifs,
    landmarks: parts.landmarks,
    floorZones: parts.floorZones,
    featureBudget: budget,
  };
}

function derelictLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const budget = featureBudget(depth, kind);
  const parts: LayoutParts = { landmarks: [], floorZones: [], motifs: [] };
  const collapsedRect = choose(rng, [
    { x: 3, y: 3, width: 8, height: 8 },
    { x: 4, y: 2, width: 9, height: 8 },
    { x: 2, y: 5, width: 9, height: 7 },
  ] as const);
  addPlacement(parts, paintCollapsedRoom(map, collapsedRect));

  const wreckRect = choose(rng, [
    { x: 13, y: 12, width: 8, height: 6 },
    { x: 14, y: 10, width: 7, height: 7 },
  ] as const);
  addPlacement(parts, rng.next() < 0.55
    ? paintWreckedMachinery(map, wreckRect)
    : paintBreachedCorridor(map, wreckRect));

  if (budget.major > 1) {
    const scrapRect = choose(rng, [
      { x: 14, y: 3, width: 7, height: 7 },
      { x: 13, y: 3, width: 7, height: 7 },
      { x: 14, y: 4, width: 7, height: 7 },
    ] as const);
    addPlacement(parts, paintScrapHeap(map, scrapRect));
  }
  if (budget.secondary > 1) {
    addPlacement(parts, paintWreckedMachinery(map, { x: 3, y: 14, width: 7, height: 6 }, "salvage-crane", "Salvage Crane"));
  }

  paintWallRun(map, { x: 8, y: 11 }, 8, true, [3], 2);
  paintCoverCluster(map, { x: 7, y: 10 }, "corner", 0);
  paintCoverCluster(map, { x: 15, y: 18 }, "pocket", 0);
  parts.motifs.push("offset_bulkhead", "salvage_cluster");

  const playerRect: Rect = { x: 2, y: 18, width: 5, height: 4 };
  const enemyRect: Rect = { x: 18, y: 2, width: 4, height: 4 };
  const zones: MacroZone[] = [
    { id: "player-maintenance-pocket", purpose: "spawn", rect: playerRect },
    { id: "collapsed-bay", purpose: "landmark", rect: collapsedRect },
    { id: "broken-crossing", purpose: "contested", rect: { x: 7, y: 8, width: 11, height: 10 } },
    { id: "maintenance-spine", purpose: "connector", rect: { x: 2, y: 11, width: 20, height: 4 } },
    { id: "outer-salvage-route", purpose: "flank", rect: { x: 12, y: 2, width: 10, height: 8 } },
    { id: "enemy-scrap-pocket", purpose: "spawn", rect: enemyRect },
  ];
  return {
    playerCandidates: pointsInRect(playerRect),
    enemyCandidates: pointsInRect(enemyRect),
    contestedPoints: pointsInRect(zones[2].rect),
    zones,
    motifs: parts.motifs,
    landmarks: parts.landmarks,
    floorZones: parts.floorZones,
    featureBudget: budget,
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

function transformRect(rect: MapRect, size: number, rotations: number, mirror: boolean): MapRect {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width - 1, y: rect.y },
    { x: rect.x, y: rect.y + rect.height - 1 },
    { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 },
  ].map((point) => transformPoint(point, size, rotations, mirror));
  const minX = Math.min(...corners.map(({ x }) => x));
  const maxX = Math.max(...corners.map(({ x }) => x));
  const minY = Math.min(...corners.map(({ y }) => y));
  const maxY = Math.max(...corners.map(({ y }) => y));
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
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
    zones: layout.zones.map((zone) => ({ ...zone, rect: transformRect(zone.rect, map.width, rotations, mirror) })),
    landmarks: layout.landmarks.map((item) => ({ ...item, rect: transformRect(item.rect, map.width, rotations, mirror) })),
    floorZones: layout.floorZones.map((zone) => ({ ...zone, rect: transformRect(zone.rect, map.width, rotations, mirror) })),
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
  layout.playerCandidates = layout.playerCandidates.filter(({ x, y }) => getTile(map, x, y) === "floor");
  layout.enemyCandidates = layout.enemyCandidates.filter(({ x, y }) => getTile(map, x, y) === "floor");
  layout.contestedPoints = layout.contestedPoints.filter(({ x, y }) => getTile(map, x, y) === "floor");
  map.environment = {
    featureBudget: { ...layout.featureBudget },
    landmarks: layout.landmarks.map((item) => ({ ...item, rect: { ...item.rect } })),
    floorZones: layout.floorZones.map((zone) => ({ ...zone, rect: { ...zone.rect } })),
  };
  return layout;
}
