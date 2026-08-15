import type {
  EnvironmentProfile,
  FeatureBudget,
  FloorTreatmentZone,
  LandmarkOrientation,
  MapLandmark,
  MapRect,
} from "./environment.ts";
import {
  paintBreachedCorridor,
  paintCollapsedRoom,
  paintControlHub,
  paintCoolantTanks,
  paintCraneGantry,
  paintDataCore,
  paintFurnaceBlock,
  paintLoadingBay,
  paintPipeManifold,
  paintProcessingLine,
  paintReactorWreck,
  paintRelayBank,
  paintSalvageRig,
  paintScrapHeap,
  paintSecurityCheckpoint,
  paintServerRows,
  paintServerVault,
  paintWreckedMachinery,
  type LandmarkOptions,
  type LandmarkPlacement,
} from "./generationLandmarks.ts";
import {
  mirrorTilesHorizontally,
  paintChunkyMass,
  paintCompartment,
  paintCoverCluster,
  paintFunctionalCover,
  paintOffsetRemnant,
  paintParallelRuns,
  paintRect,
  paintRhythmRow,
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
  profile: EnvironmentProfile;
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

/**
 * A quiet encounter carries a single dominant feature and generous negative
 * space. A heavy encounter keeps that same anchor but surrounds it with the
 * supporting structures that explain what the place is for.
 */
function layoutProfile(budget: FeatureBudget): EnvironmentProfile {
  return budget.major + budget.secondary >= 3 ? "heavy" : "quiet";
}

function addPlacement(parts: LayoutParts, placement: LandmarkPlacement): LandmarkPlacement {
  parts.landmarks.push(placement.landmark);
  parts.floorZones.push(...placement.floorZones);
  parts.motifs.push(placement.landmark.kind);
  return placement;
}

function orientationTowards(rect: Rect, target: Point): LandmarkOrientation {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const dx = target.x - centerX;
  const dy = target.y - centerY;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}

/* ------------------------------------------------------------------ *
 * Industrial Processing Foundry
 * Long parallel runs, heavy asymmetric equipment, broad service aprons.
 * ------------------------------------------------------------------ */

function industrialLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const budget = featureBudget(depth, kind);
  const profile = layoutProfile(budget);
  const parts: LayoutParts = { landmarks: [], floorZones: [], motifs: [] };
  const variant = rng.int(0, 4);

  // The foundry always reads along one long working axis. Everything else in
  // the layout is hung off that axis, which is what makes the family feel
  // industrial rather than merely rectangular.
  const spineY = choose(rng, [5, 6, 17, 18] as const);
  paintWallRun(map, { x: 1, y: spineY }, 22, true, [3 + variant % 3, 6 + variant % 3], 3);
  parts.motifs.push("industrial_spine");

  const dominantRect: Rect = profile === "quiet"
    ? choose(rng, [
        { x: 7, y: 9, width: 11, height: 9 },
        { x: 6, y: 8, width: 11, height: 10 },
        { x: 8, y: 8, width: 10, height: 10 },
      ] as const)
    : choose(rng, [
        { x: 7, y: 9, width: 10, height: 8 },
        { x: 8, y: 8, width: 9, height: 9 },
        { x: 7, y: 9, width: 10, height: 9 },
      ] as const);
  const dominantFacing = orientationTowards(dominantRect, { x: 12, y: spineY < 12 ? 22 : 1 });
  addPlacement(parts, rng.next() < 0.55
    ? paintFurnaceBlock(map, dominantRect, { orientation: dominantFacing, variant })
    : paintCoolantTanks(map, dominantRect, { orientation: dominantFacing, variant }));

  // Supporting equipment masses give the foundry its chunky, asymmetric bulk.
  const massCount = profile === "heavy" ? 3 : 2;
  for (let index = 0; index < massCount; index++) {
    const mass: Rect = index === 0
      ? { x: 2, y: spineY < 12 ? 9 : 2, width: 4, height: 3 }
      : index === 1
        ? { x: 19, y: spineY < 12 ? 13 : 3, width: 3, height: 4 }
        : { x: 3, y: spineY < 12 ? 15 : 13, width: 4, height: 3 };
    paintChunkyMass(map, mass, index % 2 === 0 ? "e" : "w", variant + index);
  }
  parts.motifs.push("equipment_mass");

  if (budget.major > 1) {
    const lineRect: Rect = spineY < 12
      ? { x: 2, y: 19, width: 20, height: 3 }
      : { x: 2, y: 1, width: 20, height: 3 };
    addPlacement(parts, paintProcessingLine(map, lineRect, { variant, importance: "major" }));
  } else {
    paintParallelRuns(map, { x: 2, y: spineY < 12 ? 19 : 2, width: 20, height: 2 }, 1, true, variant);
  }

  const loadingRect: Rect = spineY < 12
    ? { x: variant % 2 === 0 ? 2 : 15, y: 1, width: 7, height: 4 }
    : { x: variant % 2 === 0 ? 2 : 15, y: 19, width: 7, height: 4 };
  addPlacement(parts, paintLoadingBay(map, loadingRect, {
    orientation: spineY < 12 ? "s" : "n",
    variant,
  }));

  if (budget.secondary > 1) {
    const supportRect: Rect = loadingRect.x < 10
      ? { x: 16, y: spineY < 12 ? 8 : 8, width: 6, height: 5 }
      : { x: 2, y: spineY < 12 ? 8 : 8, width: 6, height: 5 };
    addPlacement(parts, rng.next() < 0.5
      ? paintCraneGantry(map, supportRect, { variant, importance: "secondary" })
      : paintPipeManifold(map, supportRect, { variant }));
  }

  // Worker positions belong to machine edges and to the apron, not to open floor.
  paintCoverCluster(map, { x: 5, y: spineY < 12 ? 13 : 9 }, "stagger", variant);
  paintCoverCluster(map, { x: 18, y: spineY < 12 ? 18 : 6 }, "corner", variant + 1);
  paintCoverCluster(map, { x: 2, y: spineY < 12 ? 17 : 5 }, "pair", variant);
  paintFunctionalCover(map, [
    { x: 12, y: spineY < 12 ? 7 : 19 },
    { x: 15, y: spineY < 12 ? 19 : 4 },
    { x: 7, y: spineY < 12 ? 8 : 15 },
  ]);
  if (profile === "heavy") paintCoverCluster(map, { x: 11, y: spineY < 12 ? 20 : 3 }, "pocket", variant);
  parts.motifs.push("machinery_island", "offset_bulkhead");

  const playerRect: Rect = { x: 2, y: spineY < 12 ? 2 : 18, width: 5, height: 4 };
  const enemyRect: Rect = { x: 18, y: spineY < 12 ? 19 : 2, width: 4, height: 4 };
  const zones: MacroZone[] = [
    { id: "player-service-pocket", purpose: "spawn", rect: playerRect },
    { id: "upper-work-lane", purpose: "lane", rect: { x: 2, y: 2, width: 20, height: 5 } },
    { id: "processing-floor", purpose: "contested", rect: { x: 6, y: 8, width: 12, height: 10 } },
    { id: "side-service-route", purpose: "flank", rect: { x: 2, y: 8, width: 4, height: 12 } },
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
    profile,
  };
}

/* ------------------------------------------------------------------ *
 * Data Core Security Complex
 * Controlled symmetry, precise compartments, repeated rack rhythm.
 * ------------------------------------------------------------------ */

function dataCoreLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const budget = featureBudget(depth, kind);
  const profile = layoutProfile(budget);
  const parts: LayoutParts = { landmarks: [], floorZones: [], motifs: [] };
  const variant = rng.int(0, 4);
  // Every structure is laid out about the board's centre line. The complex is
  // then mirrored, which is the single clearest signal that this family was
  // designed rather than grown or wrecked.
  const axis = { x: 1, y: 1, width: 22, height: 22 };

  const vaultRect: Rect = profile === "quiet"
    ? choose(rng, [
        { x: 6, y: 7, width: 12, height: 10 },
        { x: 7, y: 6, width: 10, height: 12 },
        { x: 6, y: 8, width: 12, height: 9 },
      ] as const)
    : choose(rng, [
        { x: 7, y: 8, width: 10, height: 9 },
        { x: 7, y: 7, width: 10, height: 10 },
        { x: 6, y: 8, width: 12, height: 8 },
      ] as const);
  const vaultFacing: LandmarkOrientation = variant % 2 === 0 ? "s" : "n";
  addPlacement(parts, rng.next() < 0.6
    ? paintServerVault(map, vaultRect, { orientation: vaultFacing, variant })
    : paintDataCore(map, vaultRect, { orientation: vaultFacing, variant }));

  // Mirrored side compartments: identical proportions, identical door logic.
  const compartment: Rect = { x: 1, y: variant % 2 === 0 ? 3 : 12, width: 5, height: 8 };
  paintCompartment(map, compartment, ["e"]);
  paintCompartment(map, { x: 1, y: variant % 2 === 0 ? 13 : 2, width: 5, height: 7 }, ["e", "n"]);
  parts.motifs.push("mirrored_compartments", "controlled_perimeter");

  const checkpointRect: Rect = vaultFacing === "s"
    ? { x: 4, y: 19, width: 16, height: 2 }
    : { x: 4, y: 3, width: 16, height: 2 };
  addPlacement(parts, paintSecurityCheckpoint(map, checkpointRect, {
    orientation: vaultFacing,
    variant,
    importance: "secondary",
  }));

  if (budget.major > 1) {
    addPlacement(parts, paintControlHub(map, {
      x: 9, y: vaultFacing === "s" ? 5 : 16, width: 6, height: 3,
    }, { orientation: vaultFacing === "s" ? "n" : "s", variant, importance: "major" }));
  }
  if (budget.secondary > 1) {
    const rowsRect: Rect = { x: 1, y: 8, width: 3, height: 8 };
    addPlacement(parts, rng.next() < 0.5
      ? paintServerRows(map, rowsRect, { variant })
      : paintRelayBank(map, rowsRect, { variant }));
  } else {
    paintRhythmRow(map, { x: 2, y: 8, width: 4, height: 6 }, false, 3, 2);
    parts.motifs.push("repeated_rhythm");
  }

  // Controlled access positions: paired, aligned, and always on the threshold.
  paintFunctionalCover(map, [
    { x: 4, y: 6 }, { x: 4, y: 17 }, { x: 7, y: 5 }, { x: 7, y: 18 },
    { x: 2, y: 11 }, { x: 2, y: 12 }, { x: 5, y: 2 }, { x: 5, y: 21 },
    ...(profile === "heavy" ? [{ x: 7, y: 12 }, { x: 7, y: 11 }, { x: 9, y: 6 }] : []),
  ]);
  mirrorTilesHorizontally(map, axis);
  parts.motifs.push("small_chamber", "cross_corridor");

  const playerTop = variant < 2;
  const playerRect: Rect = playerTop
    ? { x: 2, y: 6, width: 4, height: 4 }
    : { x: 2, y: 14, width: 4, height: 4 };
  const enemyRect: Rect = playerTop
    ? { x: 18, y: 14, width: 4, height: 4 }
    : { x: 18, y: 6, width: 4, height: 4 };
  // Spawn rooms are cleared after mirroring so both teams get a real staging
  // pocket rather than whatever the mirror happened to place there.
  paintRect(map, playerRect, "floor");
  paintRect(map, enemyRect, "floor");

  const zones: MacroZone[] = [
    { id: "player-room", purpose: "spawn", rect: playerRect },
    { id: "west-compartments", purpose: "room", rect: { x: 1, y: 2, width: 6, height: 20 } },
    { id: "vault-chamber", purpose: "landmark", rect: vaultRect },
    { id: "controlled-crossing", purpose: "contested", rect: { x: 6, y: 5, width: 12, height: 14 } },
    { id: "east-compartments", purpose: "flank", rect: { x: 17, y: 2, width: 6, height: 20 } },
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
    profile,
  };
}

/* ------------------------------------------------------------------ *
 * Derelict Maintenance Salvage Deck
 * Broken outlines, offset masses, remnants that never close.
 * ------------------------------------------------------------------ */

function derelictLayout(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: LayoutEncounterKind,
): ThemeLayout {
  const budget = featureBudget(depth, kind);
  const profile = layoutProfile(budget);
  const parts: LayoutParts = { landmarks: [], floorZones: [], motifs: [] };
  const variant = rng.int(0, 4);

  const dominantRect: Rect = profile === "quiet"
    ? choose(rng, [
        { x: 3, y: 3, width: 11, height: 10 },
        { x: 4, y: 2, width: 11, height: 11 },
        { x: 2, y: 4, width: 12, height: 10 },
      ] as const)
    : choose(rng, [
        { x: 3, y: 3, width: 9, height: 9 },
        { x: 4, y: 2, width: 9, height: 9 },
        { x: 2, y: 4, width: 10, height: 8 },
      ] as const);
  const dominantOptions: LandmarkOptions = { variant, importance: "dominant" };
  const dominantRoll = rng.next();
  addPlacement(parts, dominantRoll < 0.45
    ? paintCollapsedRoom(map, dominantRect, dominantOptions)
    : dominantRoll < 0.75
      ? paintReactorWreck(map, dominantRect, dominantOptions)
      : paintScrapHeap(map, dominantRect, dominantOptions));

  const wreckRect: Rect = choose(rng, [
    { x: 14, y: 14, width: 8, height: 6 },
    { x: 15, y: 12, width: 7, height: 7 },
    { x: 14, y: 14, width: 7, height: 6 },
  ] as const);
  addPlacement(parts, rng.next() < 0.55
    ? paintWreckedMachinery(map, wreckRect, { variant, importance: budget.major > 1 ? "major" : "secondary" })
    : paintSalvageRig(map, wreckRect, { variant, importance: budget.major > 1 ? "major" : "secondary" }));

  if (budget.major > 1) {
    addPlacement(parts, paintBreachedCorridor(map, { x: 15, y: 2, width: 7, height: 5 }, { variant, importance: "secondary" }));
  } else {
    paintOffsetRemnant(map, { x: 15, y: 3, width: 6, height: 5 }, variant);
    parts.motifs.push("offset_remnant");
  }
  if (budget.secondary > 1) {
    addPlacement(parts, paintSalvageRig(map, { x: 3, y: 16, width: 7, height: 5 }, {
      id: "salvage-crane",
      name: "Salvage Crane",
      variant,
      importance: "secondary",
    }));
  } else {
    paintOffsetRemnant(map, { x: 4, y: 16, width: 6, height: 5 }, variant + 1);
  }

  // Nothing in a wreck lines up. A slipped divider keeps the middle broken.
  paintOffsetRemnant(map, { x: 8, y: 12, width: 6, height: 4 }, variant + 2);
  paintWallRun(map, { x: 11, y: 16 }, 6, true, [2], 2);
  paintCoverCluster(map, { x: 12, y: 10 }, "pocket", variant);
  paintCoverCluster(map, { x: 7, y: 19 }, "corner", variant + 1);
  if (profile === "heavy") paintCoverCluster(map, { x: 17, y: 9 }, "stagger", variant);
  parts.motifs.push("broken_outline", "salvage_cluster");

  const playerRect: Rect = { x: 2, y: 18, width: 5, height: 4 };
  const enemyRect: Rect = { x: 18, y: 2, width: 4, height: 4 };
  const zones: MacroZone[] = [
    { id: "player-maintenance-pocket", purpose: "spawn", rect: playerRect },
    { id: "collapsed-bay", purpose: "landmark", rect: dominantRect },
    { id: "broken-crossing", purpose: "contested", rect: { x: 7, y: 8, width: 11, height: 10 } },
    { id: "maintenance-spine", purpose: "connector", rect: { x: 2, y: 12, width: 20, height: 3 } },
    { id: "outer-salvage-route", purpose: "flank", rect: { x: 13, y: 2, width: 9, height: 8 } },
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
    profile,
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

const ROTATED_ORIENTATION: Record<LandmarkOrientation, LandmarkOrientation> = { n: "e", e: "s", s: "w", w: "n" };
const MIRRORED_ORIENTATION: Record<LandmarkOrientation, LandmarkOrientation> = { n: "n", s: "s", e: "w", w: "e" };

/** Landmark facing has to follow the board transform or the art faces a wall. */
function transformOrientation(
  orientation: LandmarkOrientation | undefined,
  rotations: number,
  mirror: boolean,
): LandmarkOrientation {
  let value: LandmarkOrientation = orientation ?? "s";
  for (let rotation = 0; rotation < rotations; rotation++) value = ROTATED_ORIENTATION[value];
  return mirror ? MIRRORED_ORIENTATION[value] : value;
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
    landmarks: layout.landmarks.map((item) => ({
      ...item,
      rect: transformRect(item.rect, map.width, rotations, mirror),
      orientation: transformOrientation(item.orientation, rotations, mirror),
    })),
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
    profile: layout.profile,
    landmarks: layout.landmarks.map((item) => ({ ...item, rect: { ...item.rect } })),
    floorZones: layout.floorZones.map((zone) => ({ ...zone, rect: { ...zone.rect } })),
  };
  return layout;
}
