import type {
  FloorTreatmentId,
  FloorTreatmentZone,
  LandmarkAmbient,
  LandmarkImportance,
  LandmarkKind,
  LandmarkOrientation,
  MapLandmark,
  ZoneRole,
} from "./environment.ts";
import { getTile, inBounds, setTile, type GameMap, type TileType } from "./map.ts";
import {
  paintBrokenOutline,
  paintChunkyMass,
  paintCompartment,
  paintFunctionalCover,
  paintOffsetRemnant,
  paintRect,
  paintRubbleField,
  paintWallRun,
  type Point,
  type Rect,
} from "./generationMotifs.ts";

export type LandmarkPlacement = {
  landmark: MapLandmark;
  /** Footprint treatment plus, for owned features, a surrounding apron. */
  floorZones: FloorTreatmentZone[];
};

export type LandmarkOptions = {
  id?: string;
  name?: string;
  importance?: LandmarkImportance;
  orientation?: LandmarkOrientation;
  variant?: number;
  /**
   * Whether the feature claims the space around it. Dominant and major
   * features own their surroundings; small supporting structures do not.
   */
  apron?: boolean;
  /**
   * "ring" claims the whole perimeter (machine service floors, debris fields).
   * "face" claims only the working approach in front of the feature, which is
   * how a controlled space such as a vault owns its threshold.
   */
  apronStyle?: "ring" | "face";
};

type LandmarkSpec = {
  id: string;
  name: string;
  kind: LandmarkKind;
  importance: LandmarkImportance;
  orientation: LandmarkOrientation;
  variant: number;
  ambient: LandmarkAmbient;
  rect: Rect;
  treatment: FloorTreatmentId;
  apronTreatment: FloorTreatmentId;
  role: ZoneRole;
  apron: boolean;
  apronStyle: "ring" | "face";
};

const OPPOSITE: Record<LandmarkOrientation, LandmarkOrientation> = { n: "s", s: "n", e: "w", w: "e" };

function clampRect(map: GameMap, rect: Rect): Rect {
  const x = Math.max(1, Math.min(rect.x, map.width - 2));
  const y = Math.max(1, Math.min(rect.y, map.height - 2));
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, map.width - 1 - x)),
    height: Math.max(1, Math.min(rect.height, map.height - 1 - y)),
  };
}

function expand(map: GameMap, rect: Rect, amount: number): Rect {
  return clampRect(map, {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  });
}

function apronRect(map: GameMap, spec: LandmarkSpec): Rect {
  if (spec.apronStyle === "ring") return expand(map, spec.rect, 1);
  const rect = spec.rect;
  const depth = 2;
  if (spec.orientation === "n") {
    return clampRect(map, { x: rect.x - 1, y: rect.y - depth, width: rect.width + 2, height: depth });
  }
  if (spec.orientation === "s") {
    return clampRect(map, { x: rect.x - 1, y: rect.y + rect.height, width: rect.width + 2, height: depth });
  }
  if (spec.orientation === "w") {
    return clampRect(map, { x: rect.x - depth, y: rect.y - 1, width: depth, height: rect.height + 2 });
  }
  return clampRect(map, { x: rect.x + rect.width, y: rect.y - 1, width: depth, height: rect.height + 2 });
}

function place(map: GameMap, spec: LandmarkSpec): LandmarkPlacement {
  const zones: FloorTreatmentZone[] = [];
  if (spec.apron) {
    zones.push({
      id: `${spec.id}-apron`,
      treatment: spec.apronTreatment,
      rect: apronRect(map, spec),
      role: spec.role,
      ownerId: spec.id,
    });
  }
  zones.push({
    id: `${spec.id}-floor`,
    treatment: spec.treatment,
    rect: { ...spec.rect },
    role: spec.role,
    ownerId: spec.id,
  });
  return {
    landmark: {
      id: spec.id,
      name: spec.name,
      kind: spec.kind,
      importance: spec.importance,
      rect: { ...spec.rect },
      orientation: spec.orientation,
      variant: spec.variant,
      ambient: spec.ambient,
    },
    floorZones: zones,
  };
}

function paintIfFloor(map: GameMap, point: Point, tile: TileType): void {
  if (getTile(map, point.x, point.y) === "floor") setTile(map, point.x, point.y, tile);
}

/** Tiles immediately outside the rect on the named side, inset from corners. */
function frontRow(map: GameMap, rect: Rect, side: LandmarkOrientation, distance = 1): Point[] {
  const points: Point[] = [];
  if (side === "n" || side === "s") {
    const y = side === "n" ? rect.y - distance : rect.y + rect.height - 1 + distance;
    for (let x = rect.x + 1; x < rect.x + rect.width - 1; x++) points.push({ x, y });
  } else {
    const x = side === "w" ? rect.x - distance : rect.x + rect.width - 1 + distance;
    for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) points.push({ x, y });
  }
  return points.filter((point) => inBounds(map, point.x, point.y));
}

/** The inner band of a rect on the named side, `depth` tiles deep. */
function innerBand(rect: Rect, side: LandmarkOrientation, depth: number): Rect {
  if (side === "n") return { x: rect.x, y: rect.y, width: rect.width, height: Math.min(depth, rect.height) };
  if (side === "s") {
    const height = Math.min(depth, rect.height);
    return { x: rect.x, y: rect.y + rect.height - height, width: rect.width, height };
  }
  if (side === "w") return { x: rect.x, y: rect.y, width: Math.min(depth, rect.width), height: rect.height };
  const width = Math.min(depth, rect.width);
  return { x: rect.x + rect.width - width, y: rect.y, width, height: rect.height };
}

/* ------------------------------------------------------------------ *
 * Industrial Processing Foundry
 * Heavy asymmetric machine masses, long parallel runs, broad aprons.
 * ------------------------------------------------------------------ */

/** A furnace hall: one huge machine body with a charging floor at its mouth. */
export function paintFurnaceBlock(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const orientation = options.orientation ?? "s";
  const variant = options.variant ?? 0;
  const body = clampRect(map, { x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 });
  paintChunkyMass(map, body, orientation, variant);
  // The mouth is a wide recess in the facing wall, and the charging floor in
  // front of it is deliberately kept open so the feature stays approachable.
  const mouth = innerBand(body, orientation, 1);
  const mouthSpan = Math.max(2, Math.floor((orientation === "n" || orientation === "s" ? body.width : body.height) / 2));
  const mouthRect = orientation === "n" || orientation === "s"
    ? { x: mouth.x + Math.floor((mouth.width - mouthSpan) / 2), y: mouth.y, width: mouthSpan, height: 1 }
    : { x: mouth.x, y: mouth.y + Math.floor((mouth.height - mouthSpan) / 2), width: 1, height: mouthSpan };
  paintRect(map, mouthRect, "floor");
  // Support machinery flanks the mouth; it is cover, and it explains the zone.
  const front = frontRow(map, body, orientation);
  paintFunctionalCover(map, [front[0], front[front.length - 1]].filter(Boolean));
  // Slag pipes vent from the opposite face.
  for (const point of frontRow(map, body, OPPOSITE[orientation])) {
    if ((point.x + point.y + variant) % 3 === 0) paintIfFloor(map, point, "half_cover");
  }
  return place(map, {
    id: options.id ?? "furnace",
    name: options.name ?? "Furnace Hall",
    kind: "furnace_block",
    importance: options.importance ?? "dominant",
    orientation,
    variant,
    ambient: "furnace_pulse",
    rect,
    treatment: "machine_bay",
    apronTreatment: "machine_bay",
    role: "machine_service",
    apron: options.apron ?? true,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A cluster of pressure vessels linked by a service pipe. */
export function paintCoolantTanks(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const orientation = options.orientation ?? "s";
  const variant = options.variant ?? 0;
  const along = rect.width >= rect.height;
  const span = along ? rect.width : rect.height;
  const tankSize = Math.max(2, Math.floor((span - 2) / 3));
  const cross = along ? rect.height : rect.width;
  const tankDepth = Math.max(2, cross - 2);
  for (let index = 0; index < 3; index++) {
    const offset = 1 + index * (tankSize + 1);
    if (offset + tankSize > span - 1) break;
    const tank = along
      ? { x: rect.x + offset, y: rect.y + 1 + (index % 2 === variant % 2 ? 0 : 1), width: tankSize, height: Math.max(2, tankDepth - 1) }
      : { x: rect.x + 1 + (index % 2 === variant % 2 ? 0 : 1), y: rect.y + offset, width: Math.max(2, tankDepth - 1), height: tankSize };
    paintRect(map, clampRect(map, tank), "wall");
  }
  // A single service pipe threads the cluster and reads as one machine group.
  if (along) paintWallRun(map, { x: rect.x + 1, y: rect.y + rect.height - 2 }, rect.width - 2, true, [2, rect.width - 6], 2);
  else paintWallRun(map, { x: rect.x + rect.width - 2, y: rect.y + 1 }, rect.height - 2, false, [2, rect.height - 6], 2);
  paintFunctionalCover(map, frontRow(map, rect, orientation).filter((_, index) => index % 3 === 1));
  return place(map, {
    id: options.id ?? "coolant-tanks",
    name: options.name ?? "Coolant Tank Cluster",
    kind: "coolant_tanks",
    importance: options.importance ?? "dominant",
    orientation,
    variant,
    ambient: "coolant_shimmer",
    rect,
    treatment: "machine_bay",
    apronTreatment: "machine_bay",
    role: "machine_service",
    apron: options.apron ?? true,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A conveyor spine with periodic machine heads along its length. */
export function paintProcessingLine(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const horizontal = rect.width >= rect.height;
  const variant = options.variant ?? 0;
  const orientation = options.orientation ?? (horizontal ? "s" : "e");
  const length = horizontal ? rect.width : rect.height;
  const spine = horizontal
    ? { x: rect.x, y: rect.y + Math.floor(rect.height / 2) }
    : { x: rect.x + Math.floor(rect.width / 2), y: rect.y };
  paintWallRun(map, spine, length, horizontal, [3 + (variant % 2), length - 5 - (variant % 2)], 2);
  // Machine heads make the run read as processing equipment, not a partition.
  for (let offset = 1; offset < length - 2; offset += 5) {
    const head = horizontal
      ? { x: rect.x + offset, y: spine.y - 1, width: 2, height: 1 }
      : { x: spine.x - 1, y: rect.y + offset, width: 1, height: 2 };
    paintRect(map, clampRect(map, head), "wall");
  }
  // Staging positions sit on the working side of the line.
  const stagingSide = horizontal ? spine.y + 1 : spine.y;
  for (let offset = 2; offset < length - 2; offset += 4) {
    paintIfFloor(map, horizontal ? { x: rect.x + offset, y: stagingSide } : { x: spine.x + 1, y: rect.y + offset }, "half_cover");
  }
  return place(map, {
    id: options.id ?? "processing-line",
    name: options.name ?? "Conveyor Line",
    kind: "processing_line",
    importance: options.importance ?? "major",
    orientation,
    variant,
    ambient: "conveyor_drift",
    rect,
    treatment: "service_lane",
    apronTreatment: "service_lane",
    role: "processing_hall",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A dock face with pallet staging on the apron in front of it. */
export function paintLoadingBay(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const orientation = options.orientation ?? "s";
  const variant = options.variant ?? 0;
  const back = innerBand(rect, OPPOSITE[orientation], 1);
  const horizontal = back.height === 1;
  paintWallRun(
    map,
    { x: back.x, y: back.y },
    horizontal ? back.width : back.height,
    horizontal,
    [2, (horizontal ? back.width : back.height) - 4],
    2,
  );
  // Pallet stacks are laid out on a dock grid, not scattered.
  const staging: Point[] = [];
  for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 2) {
    for (let x = rect.x + 1; x < rect.x + rect.width - 1; x += 3) {
      if ((x + y + variant) % 2 === 0) staging.push({ x, y });
    }
  }
  paintFunctionalCover(map, staging);
  return place(map, {
    id: options.id ?? "loading-bay",
    name: options.name ?? "Loading Bay",
    kind: "loading_bay",
    importance: options.importance ?? "secondary",
    orientation,
    variant,
    ambient: "beacon_blink",
    rect,
    treatment: "loading_apron",
    apronTreatment: "loading_apron",
    role: "loading_lane",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A bundled pipe run with a valve junction block. */
export function paintPipeManifold(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const horizontal = rect.width >= rect.height;
  const variant = options.variant ?? 0;
  const length = horizontal ? rect.width : rect.height;
  for (let index = 0; index < 2; index++) {
    const start = horizontal
      ? { x: rect.x, y: rect.y + 1 + index * 2 }
      : { x: rect.x + 1 + index * 2, y: rect.y };
    paintWallRun(map, start, length, horizontal, [2 + index + variant % 2, length - 4], 2);
  }
  const junction = horizontal
    ? { x: rect.x + Math.floor(rect.width / 2), y: rect.y + 1, width: 2, height: Math.min(4, rect.height - 1) }
    : { x: rect.x + 1, y: rect.y + Math.floor(rect.height / 2), width: Math.min(4, rect.width - 1), height: 2 };
  paintRect(map, clampRect(map, junction), "wall");
  return place(map, {
    id: options.id ?? "pipe-manifold",
    name: options.name ?? "Pipe Manifold",
    kind: "pipe_manifold",
    importance: options.importance ?? "secondary",
    orientation: options.orientation ?? (horizontal ? "s" : "e"),
    variant,
    ambient: "none",
    rect,
    treatment: "machine_bay",
    apronTreatment: "machine_bay",
    role: "machine_service",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A service crane: two leg masses spanned by a rail, open underneath. */
export function paintCraneGantry(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const horizontal = rect.width >= rect.height;
  const variant = options.variant ?? 0;
  const legSize = 2;
  const legs: Rect[] = horizontal
    ? [
        { x: rect.x, y: rect.y, width: legSize, height: rect.height },
        { x: rect.x + rect.width - legSize, y: rect.y, width: legSize, height: rect.height },
      ]
    : [
        { x: rect.x, y: rect.y, width: rect.width, height: legSize },
        { x: rect.x, y: rect.y + rect.height - legSize, width: rect.width, height: legSize },
      ];
  for (const leg of legs) paintRect(map, clampRect(map, leg), "wall");
  // The rail is a single thin run so the bay underneath stays walkable.
  const railOffset = variant % 2 === 0 ? 0 : (horizontal ? rect.height - 1 : rect.width - 1);
  if (horizontal) paintWallRun(map, { x: rect.x, y: rect.y + railOffset }, rect.width, true, [3, rect.width - 5], 2);
  else paintWallRun(map, { x: rect.x + railOffset, y: rect.y }, rect.height, false, [3, rect.height - 5], 2);
  paintRubbleField(map, rect, variant, 6, 3);
  return place(map, {
    id: options.id ?? "crane-gantry",
    name: options.name ?? "Service Crane",
    kind: "crane_gantry",
    importance: options.importance ?? "major",
    orientation: options.orientation ?? (horizontal ? "s" : "e"),
    variant,
    ambient: "beacon_blink",
    rect,
    treatment: "loading_apron",
    apronTreatment: "loading_apron",
    role: "loading_lane",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/* ------------------------------------------------------------------ *
 * Data Core Security Complex
 * Precise compartments, controlled thresholds, repeated rack rhythm.
 * ------------------------------------------------------------------ */

/** A sealed vault: a controlled chamber with a single working face. */
export function paintServerVault(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const orientation = options.orientation ?? "s";
  const variant = options.variant ?? 0;
  paintCompartment(map, rect, [orientation, OPPOSITE[orientation]]);
  // Interior rack rhythm keeps the chamber from reading as an empty box.
  const inner = { x: rect.x + 2, y: rect.y + 2, width: rect.width - 4, height: rect.height - 4 };
  // Racks are placed as mirrored pairs against both walls with a service aisle
  // left down the middle. A single alternating row would survive the Data Core
  // board mirror as one merged bar across the chamber instead of as a rhythm.
  const vertical = inner.height >= inner.width;
  const across = vertical ? inner.width : inner.height;
  const rackSpan = Math.max(1, Math.min(3, Math.floor((across - 2) / 2)));
  for (let offset = 0; offset < (vertical ? inner.height : inner.width); offset += 2) {
    for (const nearSide of [true, false]) {
      const rack = vertical
        ? { x: nearSide ? inner.x : inner.x + inner.width - rackSpan, y: inner.y + offset, width: rackSpan, height: 1 }
        : { x: inner.x + offset, y: nearSide ? inner.y : inner.y + inner.height - rackSpan, width: 1, height: rackSpan };
      paintRect(map, clampRect(map, rack), "wall");
    }
  }
  // Defensive positions guard the vault approach.
  const approach = frontRow(map, rect, orientation, 2);
  paintFunctionalCover(map, [approach[1], approach[approach.length - 2]].filter(Boolean));
  return place(map, {
    id: options.id ?? "server-vault",
    name: options.name ?? "Server Vault",
    kind: "server_vault",
    importance: options.importance ?? "dominant",
    orientation,
    variant,
    ambient: "server_flicker",
    rect,
    treatment: "vault_grid",
    apronTreatment: "vault_grid",
    role: "vault_perimeter",
    apron: options.apron ?? true,
    apronStyle: options.apronStyle ?? "face",
  });
}

/** A processing core: a central pillar inside a broken containment ring. */
export function paintDataCore(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const variant = options.variant ?? 0;
  const orientation = options.orientation ?? "s";
  const midX = rect.x + Math.floor((rect.width - 1) / 2);
  const midY = rect.y + Math.floor((rect.height - 1) / 2);
  // Containment ring with four cardinal access gaps.
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    for (const y of [rect.y, rect.y + rect.height - 1]) {
      if (Math.abs(x - midX) <= 1) continue;
      setTile(map, x, y, "wall");
    }
  }
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (const x of [rect.x, rect.x + rect.width - 1]) {
      if (Math.abs(y - midY) <= 1) continue;
      setTile(map, x, y, "wall");
    }
  }
  const core = clampRect(map, {
    x: midX - 1,
    y: midY - 1,
    width: Math.min(3, rect.width - 4),
    height: Math.min(3, rect.height - 4),
  });
  paintRect(map, core, "wall");
  // Console positions read as the operator ring around the core.
  paintFunctionalCover(map, [
    { x: core.x - 1, y: core.y - 1 },
    { x: core.x + core.width, y: core.y + core.height },
  ]);
  return place(map, {
    id: options.id ?? "data-core",
    name: options.name ?? "Processing Core",
    kind: "data_core",
    importance: options.importance ?? "dominant",
    orientation,
    variant,
    ambient: "data_flow",
    rect,
    treatment: "vault_grid",
    apronTreatment: "vault_grid",
    role: "control_floor",
    apron: options.apron ?? true,
    apronStyle: options.apronStyle ?? "face",
  });
}

/** A gate line with guard posts and a barricaded approach. */
export function paintSecurityCheckpoint(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const horizontal = rect.width >= rect.height;
  const variant = options.variant ?? 0;
  const orientation = options.orientation ?? (horizontal ? "s" : "e");
  const gateLine = horizontal
    ? { x: rect.x, y: rect.y + Math.floor(rect.height / 2) }
    : { x: rect.x + Math.floor(rect.width / 2), y: rect.y };
  const length = horizontal ? rect.width : rect.height;
  const gate = Math.max(2, Math.floor(length / 2) - 1);
  paintWallRun(map, gateLine, length, horizontal, [gate], 2);
  // Guard posts pinch the gate without sealing it.
  const posts: Rect[] = horizontal
    ? [
        { x: rect.x + gate - 1, y: gateLine.y - 1, width: 1, height: 2 },
        { x: rect.x + gate + 2, y: gateLine.y, width: 1, height: 2 },
      ]
    : [
        { x: gateLine.x - 1, y: rect.y + gate - 1, width: 2, height: 1 },
        { x: gateLine.x, y: rect.y + gate + 2, width: 2, height: 1 },
      ];
  for (const post of posts) paintRect(map, clampRect(map, post), "wall");
  // Barricades belong to a checkpoint; they are placed on the approach side.
  const approach = horizontal
    ? [
        { x: rect.x + gate - 2, y: gateLine.y + (variant % 2 === 0 ? 2 : -2) },
        { x: rect.x + gate + 3, y: gateLine.y + (variant % 2 === 0 ? 2 : -2) },
      ]
    : [
        { x: gateLine.x + (variant % 2 === 0 ? 2 : -2), y: rect.y + gate - 2 },
        { x: gateLine.x + (variant % 2 === 0 ? 2 : -2), y: rect.y + gate + 3 },
      ];
  paintFunctionalCover(map, approach);
  return place(map, {
    id: options.id ?? "checkpoint",
    name: options.name ?? "Security Checkpoint",
    kind: "security_checkpoint",
    importance: options.importance ?? "major",
    orientation,
    variant,
    ambient: "beacon_blink",
    rect,
    treatment: "checkpoint_threshold",
    apronTreatment: "checkpoint_threshold",
    role: "checkpoint_approach",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A rack hall: identical stubs on an exact repeating cadence. */
export function paintServerRows(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const vertical = rect.height >= rect.width;
  const variant = options.variant ?? 0;
  const span = vertical ? rect.height : rect.width;
  const depth = Math.max(2, Math.min(3, (vertical ? rect.width : rect.height) - 2));
  for (let offset = 1; offset < span - 1; offset += 3) {
    const fromStart = ((offset - 1) / 3 + variant) % 2 === 0;
    const rack = vertical
      ? { x: fromStart ? rect.x : rect.x + rect.width - depth, y: rect.y + offset, width: depth, height: 1 }
      : { x: rect.x + offset, y: fromStart ? rect.y : rect.y + rect.height - depth, width: 1, height: depth };
    paintRect(map, clampRect(map, rack), "wall");
  }
  return place(map, {
    id: options.id ?? "server-rows",
    name: options.name ?? "Server Hall",
    kind: "server_rows",
    importance: options.importance ?? "secondary",
    orientation: options.orientation ?? (vertical ? "e" : "s"),
    variant,
    ambient: "server_flicker",
    rect,
    treatment: "server_hall",
    apronTreatment: "server_hall",
    role: "server_access",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A relay bank: paired cabinets threaded by a cable tray. */
export function paintRelayBank(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const horizontal = rect.width >= rect.height;
  const variant = options.variant ?? 0;
  const span = horizontal ? rect.width : rect.height;
  for (let offset = 1; offset + 2 <= span - 1; offset += 3) {
    const cabinet = horizontal
      ? { x: rect.x + offset, y: rect.y + 1, width: 2, height: Math.max(2, rect.height - 2) }
      : { x: rect.x + 1, y: rect.y + offset, width: Math.max(2, rect.width - 2), height: 2 };
    paintRect(map, clampRect(map, cabinet), "wall");
  }
  paintFunctionalCover(map, frontRow(map, rect, variant % 2 === 0 ? "s" : "n").filter((_, index) => index % 4 === 1));
  return place(map, {
    id: options.id ?? "relay-bank",
    name: options.name ?? "Relay Bank",
    kind: "relay_bank",
    importance: options.importance ?? "secondary",
    orientation: options.orientation ?? (horizontal ? "s" : "e"),
    variant,
    ambient: "data_flow",
    rect,
    treatment: "server_hall",
    apronTreatment: "server_hall",
    role: "server_access",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A control hub: a console horseshoe facing an operations floor. */
export function paintControlHub(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const orientation = options.orientation ?? "s";
  const variant = options.variant ?? 0;
  const back = innerBand(rect, OPPOSITE[orientation], 1);
  const horizontal = back.height === 1;
  paintWallRun(map, { x: back.x, y: back.y }, horizontal ? back.width : back.height, horizontal);
  const armLength = Math.max(2, Math.floor((horizontal ? rect.height : rect.width) * 0.6));
  const arms: Rect[] = horizontal
    ? [
        { x: rect.x, y: Math.min(back.y, rect.y), width: 1, height: armLength },
        { x: rect.x + rect.width - 1, y: Math.min(back.y, rect.y), width: 1, height: armLength },
      ]
    : [
        { x: Math.min(back.x, rect.x), y: rect.y, width: armLength, height: 1 },
        { x: Math.min(back.x, rect.x), y: rect.y + rect.height - 1, width: armLength, height: 1 },
      ];
  for (const arm of arms) {
    const anchored = orientation === "n" || orientation === "w"
      ? arm
      : horizontal
        ? { ...arm, y: rect.y + rect.height - armLength }
        : { ...arm, x: rect.x + rect.width - armLength };
    paintRect(map, clampRect(map, anchored), "wall");
  }
  // Consoles are the working surfaces inside the horseshoe.
  const consoles: Point[] = [];
  for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 2) {
    for (let x = rect.x + 1; x < rect.x + rect.width - 1; x += 2) {
      if ((x + y + variant) % 3 === 0) consoles.push({ x, y });
    }
  }
  paintFunctionalCover(map, consoles);
  return place(map, {
    id: options.id ?? "control-hub",
    name: options.name ?? "Control Hub",
    kind: "control_hub",
    importance: options.importance ?? "major",
    orientation,
    variant,
    ambient: "data_flow",
    rect,
    treatment: "vault_grid",
    apronTreatment: "vault_grid",
    role: "control_floor",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/* ------------------------------------------------------------------ *
 * Derelict Maintenance Salvage Deck
 * Broken outlines, offset masses, debris that owns its own perimeter.
 * ------------------------------------------------------------------ */

/** A collapsed bay: a failed room with its ceiling mass slumped inside it. */
export function paintCollapsedRoom(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const variant = options.variant ?? 0;
  const orientation = options.orientation ?? "s";
  paintBrokenOutline(map, rect, variant);
  // The collapse itself: an off-centre slab mass, never a centred block.
  const slab = clampRect(map, {
    x: rect.x + 1 + (variant % 2),
    y: rect.y + 2 + ((variant + 1) % 2),
    width: Math.max(2, Math.floor(rect.width / 2)),
    height: Math.max(2, Math.floor(rect.height / 3)),
  });
  paintRect(map, slab, "wall");
  paintRubbleField(map, rect, variant, 4, 4);
  return place(map, {
    id: options.id ?? "collapsed-room",
    name: options.name ?? "Collapsed Bay",
    kind: "collapsed_room",
    importance: options.importance ?? "dominant",
    orientation,
    variant,
    ambient: "unstable_flicker",
    rect,
    treatment: "collapsed_deck",
    apronTreatment: "collapsed_deck",
    role: "collapsed_bay",
    apron: options.apron ?? true,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A scrap heap: an irregular mound with debris spilling off its edges. */
export function paintScrapHeap(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const variant = options.variant ?? 0;
  const cx = rect.x + Math.floor(rect.width / 2) + (variant % 2 === 0 ? -1 : 1);
  const cy = rect.y + Math.floor(rect.height / 2);
  // A lopsided mound. The falloff is stretched along one axis and the radius
  // is generous, so the mass reads as a heap rather than as a small cross.
  const stretch = variant % 2 === 0 ? 1 : 1.6;
  const radius = Math.max(3, Math.floor(Math.min(rect.width, rect.height) * 0.62));
  for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) {
    for (let x = rect.x + 1; x < rect.x + rect.width - 1; x++) {
      const distance = Math.abs(x - cx) + Math.abs(y - cy) * stretch;
      if (distance <= radius) setTile(map, x, y, "wall");
      else if (distance <= radius + 1.5 && (x * 3 + y * 5 + variant) % 4 === 0) paintIfFloor(map, { x, y }, "half_cover");
    }
  }
  return place(map, {
    id: options.id ?? "scrap-heap",
    name: options.name ?? "Scrap Heap",
    kind: "scrap_heap",
    importance: options.importance ?? "dominant",
    orientation: options.orientation ?? "s",
    variant,
    ambient: "none",
    rect,
    treatment: "salvage_wear",
    apronTreatment: "salvage_wear",
    role: "salvage_work",
    apron: options.apron ?? true,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** Wrecked machinery: torn masses that no longer line up with each other. */
export function paintWreckedMachinery(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const variant = options.variant ?? 0;
  paintOffsetRemnant(map, rect, variant);
  paintRubbleField(map, rect, variant + 1, 3, 4);
  return place(map, {
    id: options.id ?? "wrecked-machine",
    name: options.name ?? "Wrecked Machinery",
    kind: "wrecked_machinery",
    importance: options.importance ?? "major",
    orientation: options.orientation ?? "s",
    variant,
    ambient: "spark_burst",
    rect,
    treatment: "salvage_wear",
    apronTreatment: "salvage_wear",
    role: "salvage_work",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A breached corridor: two failed walls with a blown-open crossing. */
export function paintBreachedCorridor(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const horizontal = rect.width >= rect.height;
  const variant = options.variant ?? 0;
  const length = horizontal ? rect.width : rect.height;
  const breach = Math.max(2, Math.floor(length / 2) - 1 + (variant % 2));
  if (horizontal) {
    paintWallRun(map, { x: rect.x, y: rect.y }, length, true, [breach, length - 4], 3);
    paintWallRun(map, { x: rect.x, y: rect.y + rect.height - 1 }, length, true, [breach - 1, 2], 3);
  } else {
    paintWallRun(map, { x: rect.x, y: rect.y }, length, false, [breach, length - 4], 3);
    paintWallRun(map, { x: rect.x + rect.width - 1, y: rect.y }, length, false, [breach - 1, 2], 3);
  }
  paintRubbleField(map, rect, variant, 4, 4);
  return place(map, {
    id: options.id ?? "breached-corridor",
    name: options.name ?? "Breached Corridor",
    kind: "breached_corridor",
    importance: options.importance ?? "secondary",
    orientation: options.orientation ?? (horizontal ? "s" : "e"),
    variant,
    ambient: "unstable_flicker",
    rect,
    treatment: "breach_scars",
    apronTreatment: "breach_scars",
    role: "breach_corridor",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A salvage rig: improvised scaffolding braced against a working pile. */
export function paintSalvageRig(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const horizontal = rect.width >= rect.height;
  const variant = options.variant ?? 0;
  const posts: Rect[] = horizontal
    ? [
        { x: rect.x, y: rect.y + 1, width: 1, height: Math.max(2, rect.height - 2) },
        { x: rect.x + rect.width - 1, y: rect.y, width: 1, height: Math.max(2, rect.height - 3) },
      ]
    : [
        { x: rect.x + 1, y: rect.y, width: Math.max(2, rect.width - 2), height: 1 },
        { x: rect.x, y: rect.y + rect.height - 1, width: Math.max(2, rect.width - 3), height: 1 },
      ];
  for (const post of posts) paintRect(map, clampRect(map, post), "wall");
  // The improvised boom leans off-axis rather than spanning cleanly.
  const boom = horizontal
    ? { x: rect.x + 1 + (variant % 2), y: rect.y + Math.floor(rect.height / 2), width: Math.max(2, rect.width - 3), height: 1 }
    : { x: rect.x + Math.floor(rect.width / 2), y: rect.y + 1 + (variant % 2), width: 1, height: Math.max(2, rect.height - 3) };
  paintRect(map, clampRect(map, boom), "wall");
  paintRubbleField(map, rect, variant, 3, 4);
  return place(map, {
    id: options.id ?? "salvage-rig",
    name: options.name ?? "Salvage Rig",
    kind: "salvage_rig",
    importance: options.importance ?? "major",
    orientation: options.orientation ?? (horizontal ? "s" : "e"),
    variant,
    ambient: "spark_burst",
    rect,
    treatment: "salvage_wear",
    apronTreatment: "salvage_wear",
    role: "salvage_work",
    apron: options.apron ?? false,
    apronStyle: options.apronStyle ?? "ring",
  });
}

/** A reactor wreck: a containment shell that lost a quadrant. */
export function paintReactorWreck(map: GameMap, rect: Rect, options: LandmarkOptions = {}): LandmarkPlacement {
  const variant = options.variant ?? 0;
  paintBrokenOutline(map, rect, variant + 2);
  const core = clampRect(map, {
    x: rect.x + Math.floor(rect.width / 2) - 1,
    y: rect.y + Math.floor(rect.height / 2) - 1,
    width: Math.min(3, rect.width - 3),
    height: Math.min(3, rect.height - 3),
  });
  paintRect(map, core, "wall");
  // One quadrant of the shell is simply gone.
  const gone = clampRect(map, {
    x: variant % 2 === 0 ? rect.x : rect.x + Math.floor(rect.width / 2),
    y: variant < 2 ? rect.y : rect.y + Math.floor(rect.height / 2),
    width: Math.max(2, Math.floor(rect.width / 2)),
    height: 1,
  });
  paintRect(map, gone, "floor");
  paintRubbleField(map, rect, variant, 4, 4);
  return place(map, {
    id: options.id ?? "reactor-wreck",
    name: options.name ?? "Reactor Wreck",
    kind: "reactor_wreck",
    importance: options.importance ?? "dominant",
    orientation: options.orientation ?? "s",
    variant,
    ambient: "unstable_flicker",
    rect,
    treatment: "collapsed_deck",
    apronTreatment: "collapsed_deck",
    role: "collapsed_bay",
    apron: options.apron ?? true,
    apronStyle: options.apronStyle ?? "ring",
  });
}
