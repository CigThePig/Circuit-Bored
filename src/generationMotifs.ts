import type { LandmarkKind } from "./environment.ts";
import { getTile, inBounds, setTile, type GameMap, type TileType } from "./map.ts";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Shape-language building blocks shared by every theme. */
export type StructuralMotifId =
  | "wall_with_breaches"
  | "machinery_island"
  | "paired_machinery"
  | "loading_zone"
  | "offset_bulkhead"
  | "small_chamber"
  | "large_chamber"
  | "t_junction"
  | "cross_corridor"
  | "defensive_checkpoint"
  | "broken_room"
  | "zig_zag_divider"
  | "l_room"
  | "u_defense"
  | "salvage_cluster"
  | "central_landmark"
  // Theme shape-language motifs introduced with the bespoke landmark pass.
  | "industrial_spine"
  | "equipment_mass"
  | "service_gantry"
  | "mirrored_compartments"
  | "controlled_perimeter"
  | "repeated_rhythm"
  | "broken_outline"
  | "offset_remnant"
  | "rubble_field";

export type MotifId = StructuralMotifId | LandmarkKind;

export function pointsInRect(rect: Rect): Point[] {
  const points: Point[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) points.push({ x, y });
  }
  return points;
}

export function paintRect(map: GameMap, rect: Rect, tile: TileType): void {
  for (const point of pointsInRect(rect)) setTile(map, point.x, point.y, tile);
}

export function paintBoundary(map: GameMap): void {
  for (let x = 0; x < map.width; x++) {
    setTile(map, x, 0, "wall");
    setTile(map, x, map.height - 1, "wall");
  }
  for (let y = 0; y < map.height; y++) {
    setTile(map, 0, y, "wall");
    setTile(map, map.width - 1, y, "wall");
  }
}

export function paintWallRun(
  map: GameMap,
  start: Point,
  length: number,
  horizontal: boolean,
  breaches: readonly number[] = [],
  breachWidth = 1,
): void {
  const open = new Set<number>();
  for (const breach of breaches) {
    for (let offset = 0; offset < breachWidth; offset++) open.add(breach + offset);
  }
  for (let index = 0; index < length; index++) {
    const x = start.x + (horizontal ? index : 0);
    const y = start.y + (horizontal ? 0 : index);
    if (!open.has(index)) setTile(map, x, y, "wall");
  }
}

export function paintRoomBoundary(
  map: GameMap,
  rect: Rect,
  doors: readonly Point[],
): void {
  const doorKeys = new Set(doors.map(({ x, y }) => `${x},${y}`));
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    for (const y of [rect.y, rect.y + rect.height - 1]) {
      setTile(map, x, y, doorKeys.has(`${x},${y}`) ? "floor" : "wall");
    }
  }
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (const x of [rect.x, rect.x + rect.width - 1]) {
      setTile(map, x, y, doorKeys.has(`${x},${y}`) ? "floor" : "wall");
    }
  }
}

export function paintMachineryIsland(map: GameMap, rect: Rect, coverSide: "n" | "s" | "e" | "w"): void {
  paintRect(map, rect, "wall");
  const candidates: Point[] = [];
  if (coverSide === "n" || coverSide === "s") {
    const y = coverSide === "n" ? rect.y - 1 : rect.y + rect.height;
    for (let x = rect.x; x < rect.x + rect.width; x += 2) candidates.push({ x, y });
  } else {
    const x = coverSide === "w" ? rect.x - 1 : rect.x + rect.width;
    for (let y = rect.y; y < rect.y + rect.height; y += 2) candidates.push({ x, y });
  }
  for (const point of candidates) {
    if (getTile(map, point.x, point.y) === "floor") setTile(map, point.x, point.y, "half_cover");
  }
}

export function paintCoverCluster(
  map: GameMap,
  anchor: Point,
  pattern: "pair" | "stagger" | "corner" | "pocket",
  rotation = 0,
): void {
  const patterns: Record<typeof pattern, Point[]> = {
    pair: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    stagger: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    corner: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    pocket: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
  };
  for (const source of patterns[pattern]) {
    let point = { ...source };
    for (let step = 0; step < ((rotation % 4) + 4) % 4; step++) {
      point = { x: -point.y, y: point.x };
    }
    const x = anchor.x + point.x;
    const y = anchor.y + point.y;
    if (inBounds(map, x, y) && getTile(map, x, y) === "floor") setTile(map, x, y, "half_cover");
  }
}

export function paintBrokenRoom(map: GameMap, rect: Rect, openingSide: "n" | "s" | "e" | "w"): void {
  const horizontalGap = rect.x + Math.floor(rect.width / 2);
  const verticalGap = rect.y + Math.floor(rect.height / 2);
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    if (openingSide === "n" && Math.abs(x - horizontalGap) <= 1) continue;
    setTile(map, x, rect.y, "wall");
    if (!(openingSide === "s" && Math.abs(x - horizontalGap) <= 1)) {
      setTile(map, x, rect.y + rect.height - 1, "wall");
    }
  }
  for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) {
    if (!(openingSide === "w" && Math.abs(y - verticalGap) <= 1)) setTile(map, rect.x, y, "wall");
    if (!(openingSide === "e" && Math.abs(y - verticalGap) <= 1)) {
      setTile(map, rect.x + rect.width - 1, y, "wall");
    }
  }
  // Damage removes two corners and one short section, leaving an architectural
  // outline rather than a sealed or perfectly rectangular room.
  setTile(map, rect.x, rect.y, "floor");
  setTile(map, rect.x + rect.width - 1, rect.y + rect.height - 1, "floor");
  setTile(map, rect.x + 1, rect.y, "floor");
}

export function paintZigZagDivider(map: GameMap, start: Point, segments: number, stepX: number, stepY: number): void {
  let x = start.x;
  let y = start.y;
  for (let segment = 0; segment < segments; segment++) {
    const horizontal = segment % 2 === 0;
    const length = horizontal ? Math.abs(stepX) : Math.abs(stepY);
    for (let offset = 0; offset < length; offset++) {
      if ((segment + offset) % 7 !== 5) setTile(map, x, y, "wall");
      x += horizontal ? Math.sign(stepX) : 0;
      y += horizontal ? 0 : Math.sign(stepY);
    }
  }
}

export function paintUDefense(map: GameMap, anchor: Point, width: number, height: number, openSide: "n" | "s"): void {
  const closedY = openSide === "n" ? anchor.y + height - 1 : anchor.y;
  paintWallRun(map, { x: anchor.x, y: closedY }, width, true);
  paintWallRun(map, { x: anchor.x, y: anchor.y }, height, false);
  paintWallRun(map, { x: anchor.x + width - 1, y: anchor.y }, height, false);
  const coverY = openSide === "n" ? anchor.y + 1 : anchor.y + height - 2;
  for (let x = anchor.x + 1; x < anchor.x + width - 1; x += 2) {
    if (getTile(map, x, coverY) === "floor") setTile(map, x, coverY, "half_cover");
  }
}

/**
 * Foundry shape language: a heavy asymmetric equipment mass. A notch and a
 * stepped shoulder keep the silhouette from reading as a plain rectangle even
 * in Squint mode, while the bulk stays a single connected wall structure.
 */
export function paintChunkyMass(map: GameMap, rect: Rect, notchSide: "n" | "e" | "s" | "w", phase = 0): void {
  paintRect(map, rect, "wall");
  const notchDepth = Math.max(1, Math.floor(Math.min(rect.width, rect.height) / 3));
  const notchSpan = Math.max(2, Math.floor(Math.max(rect.width, rect.height) / 3));
  const offset = phase % 2 === 0 ? 1 : Math.max(1, rect.width - notchSpan - 1);
  if (notchSide === "n" || notchSide === "s") {
    const startY = notchSide === "n" ? rect.y : rect.y + rect.height - notchDepth;
    paintRect(map, { x: rect.x + offset, y: startY, width: Math.min(notchSpan, rect.width - offset), height: notchDepth }, "floor");
  } else {
    const startX = notchSide === "w" ? rect.x : rect.x + rect.width - notchDepth;
    const yOffset = phase % 2 === 0 ? 1 : Math.max(1, rect.height - notchSpan - 1);
    paintRect(map, { x: startX, y: rect.y + yOffset, width: notchDepth, height: Math.min(notchSpan, rect.height - yOffset) }, "floor");
  }
}

/**
 * Foundry shape language: parallel processing runs. Long, aligned, breached
 * wall lines that read as machinery rows rather than as room partitions.
 */
export function paintParallelRuns(
  map: GameMap,
  rect: Rect,
  runs: number,
  horizontal: boolean,
  phase = 0,
): void {
  const span = horizontal ? rect.height : rect.width;
  const length = horizontal ? rect.width : rect.height;
  const step = Math.max(2, Math.floor(span / Math.max(1, runs)));
  for (let index = 0; index < runs; index++) {
    const offset = index * step;
    if (offset >= span) break;
    const breachA = 2 + ((index + phase) % 3);
    const breachB = Math.max(breachA + 3, length - 4 - ((index + phase) % 3));
    const start = horizontal ? { x: rect.x, y: rect.y + offset } : { x: rect.x + offset, y: rect.y };
    paintWallRun(map, start, length, horizontal, [breachA, breachB], 2);
  }
}

/**
 * Data Core shape language: a precise compartment with deliberate openings on
 * named sides. Doors are always two tiles wide and centred so the room reads
 * as engineered rather than eroded.
 */
export function paintCompartment(
  map: GameMap,
  rect: Rect,
  openSides: readonly ("n" | "e" | "s" | "w")[],
): void {
  const doors: Point[] = [];
  const midX = rect.x + Math.floor((rect.width - 1) / 2);
  const midY = rect.y + Math.floor((rect.height - 1) / 2);
  for (const side of openSides) {
    if (side === "n") doors.push({ x: midX, y: rect.y }, { x: midX + 1, y: rect.y });
    if (side === "s") doors.push({ x: midX, y: rect.y + rect.height - 1 }, { x: midX + 1, y: rect.y + rect.height - 1 });
    if (side === "w") doors.push({ x: rect.x, y: midY }, { x: rect.x, y: midY + 1 });
    if (side === "e") doors.push({ x: rect.x + rect.width - 1, y: midY }, { x: rect.x + rect.width - 1, y: midY + 1 });
  }
  paintRoomBoundary(map, rect, doors);
}

/**
 * Data Core shape language: repeated equipment rhythm. Evenly spaced stubs of
 * identical length read as a designed, rack-filled hall.
 */
export function paintRhythmRow(
  map: GameMap,
  rect: Rect,
  horizontal: boolean,
  spacing: number,
  length: number,
): void {
  const span = horizontal ? rect.width : rect.height;
  for (let offset = 0; offset < span; offset += spacing) {
    const start = horizontal ? { x: rect.x + offset, y: rect.y } : { x: rect.x, y: rect.y + offset };
    paintWallRun(map, start, length, !horizontal);
  }
}

/**
 * Derelict shape language: a structural outline that never closes. Segments
 * drop out on an irregular cadence so the remnant looks damaged instead of
 * merely doored.
 */
export function paintBrokenOutline(map: GameMap, rect: Rect, phase = 0): void {
  const perimeter: Point[] = [];
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    perimeter.push({ x, y: rect.y });
  }
  for (let y = rect.y + 1; y < rect.y + rect.height; y++) {
    perimeter.push({ x: rect.x + rect.width - 1, y });
  }
  for (let x = rect.x + rect.width - 2; x >= rect.x; x--) {
    perimeter.push({ x, y: rect.y + rect.height - 1 });
  }
  for (let y = rect.y + rect.height - 2; y > rect.y; y--) {
    perimeter.push({ x: rect.x, y });
  }
  for (const [index, point] of perimeter.entries()) {
    const cadence = (index * 5 + phase * 3) % 17;
    if (cadence < 4 || cadence === 9) continue;
    setTile(map, point.x, point.y, "wall");
  }
}

/**
 * Derelict shape language: offset remnant masses. Two or three blocks slip out
 * of alignment with each other, which is the clearest grayscale signal that a
 * structure failed rather than that it was laid out.
 */
export function paintOffsetRemnant(map: GameMap, rect: Rect, phase = 0): void {
  const slabW = Math.max(2, Math.floor(rect.width / 2));
  const slabH = Math.max(2, Math.floor(rect.height / 2));
  const slip = 1 + (phase % 2);
  paintRect(map, { x: rect.x, y: rect.y, width: slabW, height: slabH }, "wall");
  paintRect(map, {
    x: Math.min(rect.x + slabW - 1 + slip, rect.x + rect.width - 2),
    y: rect.y + Math.max(1, slabH - slip),
    width: Math.max(2, rect.width - slabW - slip),
    height: Math.max(2, rect.height - slabH),
  }, "wall");
}

/**
 * Derelict shape language: debris that clusters around a damaged mass. Rubble
 * always touches existing structure, and the count is capped so a wreck reads
 * as a damaged place rather than as a field of scattered tactical props.
 */
export function paintRubbleField(map: GameMap, rect: Rect, phase = 0, density = 5, limit = 4): void {
  let placed = 0;
  for (const point of pointsInRect(rect)) {
    if (placed >= limit) return;
    if (getTile(map, point.x, point.y) !== "floor") continue;
    const near = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ].some((direction) => getTile(map, point.x + direction.x, point.y + direction.y) === "wall");
    if (!near) continue;
    if ((point.x * 7 + point.y * 11 + phase * 3) % density !== 0) continue;
    setTile(map, point.x, point.y, "half_cover");
    placed += 1;
  }
}

/**
 * Places purposeful cover. Unlike a generic cluster this takes explicit
 * positions so a layout can say "barricades at the checkpoint" or "crates on
 * the loading apron" instead of scattering tactical objects.
 */
export function paintFunctionalCover(map: GameMap, points: readonly Point[]): number {
  let placed = 0;
  for (const point of points) {
    if (!inBounds(map, point.x, point.y)) continue;
    if (getTile(map, point.x, point.y) !== "floor") continue;
    setTile(map, point.x, point.y, "half_cover");
    placed += 1;
  }
  return placed;
}

/**
 * Copies the left half of a tile band onto the right half. Data Core layouts
 * use this to obtain the near-symmetry that separates an engineered complex
 * from a foundry or a wreck, even in a simplified semantic view.
 */
export function mirrorTilesHorizontally(map: GameMap, band: Rect): void {
  const right = band.x + band.width - 1;
  for (let y = band.y; y < band.y + band.height; y++) {
    for (let offset = 0; offset < Math.floor(band.width / 2); offset++) {
      const source = getTile(map, band.x + offset, y);
      if (source === null) continue;
      setTile(map, right - offset, y, source);
    }
  }
}
