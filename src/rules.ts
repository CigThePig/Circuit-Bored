import type { Unit } from "./map.ts";

/**
 * Tiles of travel bought by one action point.
 *
 * Movement is the only action with sub-AP granularity. Shooting still costs
 * whole action points, so raising this number lengthens a turn's walk without
 * changing how many shots that same turn can contain.
 */
export const TILES_PER_MOVE_AP = 2;

/** Tiles of travel this unit gets before any AP is charged at all. */
function freeTiles(unit: Unit): number {
  return unit.combat?.firstMoveFree ? TILES_PER_MOVE_AP : 0;
}

/**
 * Total AP a unit is charged for the first `tiles` tiles of travel in a turn.
 * The ledger is cumulative rather than per-step so a half-spent action point
 * keeps its remaining tile instead of silently rounding away.
 */
export function movementApSpent(unit: Unit, tiles: number): number {
  const billable = Math.max(0, tiles - freeTiles(unit));
  return Math.ceil(billable / TILES_PER_MOVE_AP);
}

/** AP charged for travelling `tiles` further tiles from the unit's current state. */
export function movementApCostForTiles(unit: Unit, tiles: number): number {
  const moved = unit.movesThisTurn ?? 0;
  return movementApSpent(unit, moved + tiles) - movementApSpent(unit, moved);
}

/** AP charged for this unit's next single tile of travel. */
export function movementApCost(unit: Unit): number {
  return movementApCostForTiles(unit, 1);
}

/**
 * How many more tiles the unit can travel this turn. Includes any tile already
 * paid for by a partially-spent action point, so a unit at 0 AP that stopped
 * mid-action point can still finish that step.
 */
export function movementRange(unit: Unit): number {
  const moved = unit.movesThisTurn ?? 0;
  const budget = movementApSpent(unit, moved) + Math.max(0, unit.ap);
  return Math.max(0, budget * TILES_PER_MOVE_AP + freeTiles(unit) - moved);
}

/** True when the unit has neither AP nor a paid-for tile left to use. */
export function isSpent(unit: Unit): boolean {
  return unit.ap <= 0 && movementRange(unit) <= 0;
}

export function resetTurnState(unit: Unit): void {
  unit.ap = unit.maxAp;
  unit.overwatch = false;
  unit.peekExposure = null;
  unit.movesThisTurn = 0;
  unit.shotsThisTurn = 0;
  unit.killsThisTurn = 0;
  unit.resolvingOverwatch = false;
}
