import { getTile, inBounds, unitAt, type GameMap, type Unit } from "./map.ts";
import { movementApCostForTiles, movementRange } from "./rules.ts";

/**
 * Movement geometry.
 *
 * Units walk in eight directions and a turn's travel budget is spent as a
 * whole path, so this module owns the two questions the rest of the game asks
 * about walking: which tiles can a unit reach right now, and which tiles does
 * it step through to get to one of them.
 */

export type Point = { x: number; y: number };

export const MOVE_DIRECTIONS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/** Orthogonal directions, for the adjacency rules that are not about walking. */
export const ORTHOGONAL_DIRECTIONS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export type MovementNode = {
  x: number;
  y: number;
  /** Tiles walked from the origin. Diagonal and orthogonal steps both cost 1. */
  steps: number;
  /** Key of the tile this one was reached from; null for the origin. */
  from: string | null;
};

export type MovementField = {
  origin: Point;
  maxSteps: number;
  nodes: Map<string, MovementNode>;
};

export type MovementDestination = {
  x: number;
  y: number;
  steps: number;
  /** AP the unit is charged to stop on this tile. */
  apCost: number;
};

export function movementKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Terrain a unit could stand on, ignoring who is standing there. */
export function isOpenTerrain(map: GameMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && getTile(map, x, y) === "floor";
}

/**
 * Corner rule for a diagonal step: both tiles the move squeezes between must
 * be open terrain. This matches the conservative diagonal handling in
 * line-of-sight, so a unit can never slip through a join that a bullet cannot.
 */
export function diagonalIsClear(
  map: GameMap,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 || dy === 0) return true;
  return isOpenTerrain(map, fromX + dx, fromY) && isOpenTerrain(map, fromX, fromY + dy);
}

/** True when `unit` may finish a step on (x,y): open floor and unoccupied. */
export function canOccupy(map: GameMap, unit: Unit, x: number, y: number): boolean {
  if (!isOpenTerrain(map, x, y)) return false;
  const occupant = unitAt(map, x, y);
  return !occupant || occupant.id === unit.id;
}

/** True when `unit` may take the single step from (fromX,fromY) to (toX,toY). */
export function canStep(
  map: GameMap,
  unit: Unit,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return false;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (!canOccupy(map, unit, toX, toY)) return false;
  return diagonalIsClear(map, fromX, fromY, toX, toY);
}

/**
 * Breadth-first walk of every tile `unit` can reach in at most `maxSteps`
 * steps, defaulting to the unit's remaining travel budget. Every entry records
 * the shortest step count and the tile it was reached from, so the same field
 * answers "how far can I go?" and "which way do I walk?".
 */
export function computeMovementField(
  map: GameMap,
  unit: Unit,
  maxSteps: number = movementRange(unit),
): MovementField {
  const limit = Math.max(0, Math.floor(maxSteps));
  const origin = { x: unit.x, y: unit.y };
  const nodes = new Map<string, MovementNode>();
  const originKey = movementKey(origin.x, origin.y);
  nodes.set(originKey, { x: origin.x, y: origin.y, steps: 0, from: null });

  let frontier: MovementNode[] = [nodes.get(originKey)!];
  for (let depth = 0; depth < limit && frontier.length > 0; depth++) {
    const next: MovementNode[] = [];
    for (const current of frontier) {
      for (const dir of MOVE_DIRECTIONS) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        const key = movementKey(nx, ny);
        if (nodes.has(key)) continue;
        if (!canStep(map, unit, current.x, current.y, nx, ny)) continue;
        const node: MovementNode = {
          x: nx,
          y: ny,
          steps: current.steps + 1,
          from: movementKey(current.x, current.y),
        };
        nodes.set(key, node);
        next.push(node);
      }
    }
    frontier = next;
  }

  return { origin, maxSteps: limit, nodes };
}

/**
 * Every tile in the field the unit could actually stop on, with the AP that
 * stopping there costs. The origin is excluded: staying put is not a move.
 */
export function movementDestinations(
  unit: Unit,
  field: MovementField,
): MovementDestination[] {
  const out: MovementDestination[] = [];
  for (const node of field.nodes.values()) {
    if (node.steps === 0) continue;
    out.push({
      x: node.x,
      y: node.y,
      steps: node.steps,
      apCost: movementApCostForTiles(unit, node.steps),
    });
  }
  out.sort((a, b) => a.steps - b.steps || a.y - b.y || a.x - b.x);
  return out;
}

/**
 * The tiles walked to reach (x,y), excluding the origin and including the
 * destination. Empty when the tile is not reachable in this field.
 */
export function movementPath(field: MovementField, x: number, y: number): Point[] {
  const target = field.nodes.get(movementKey(x, y));
  if (!target || target.steps === 0) return [];
  const path: Point[] = [];
  let node: MovementNode | undefined = target;
  while (node && node.from) {
    path.push({ x: node.x, y: node.y });
    node = field.nodes.get(node.from);
  }
  return path.reverse();
}

/** Convenience wrapper: the walk `unit` would take to reach (x,y) right now. */
export function findMovementPath(
  map: GameMap,
  unit: Unit,
  x: number,
  y: number,
  maxSteps: number = movementRange(unit),
): Point[] {
  return movementPath(computeMovementField(map, unit, maxSteps), x, y);
}
