import { getTile, inBounds, setTile, type GameMap, type TileType } from "./map.ts";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type MotifId =
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
  | "central_landmark";

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
