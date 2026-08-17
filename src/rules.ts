import type { Unit } from "./map.ts";
import {
  isBraced,
  isDashing,
  isSuppressed,
  SUPPRESSED_AP_PENALTY,
  setAimed,
  setBraced,
  setDashing,
  setGuardedBy,
  setHunkered,
  statusesOf,
} from "./status.ts";

/**
 * Tiles of travel bought by one action point.
 *
 * Movement is the only action with sub-AP granularity. Shooting still costs
 * whole action points, so raising this number lengthens a turn's walk without
 * changing how many shots that same turn can contain.
 */
export const TILES_PER_MOVE_AP = 2;

/** Extra tiles per action point while Dashing. */
export const DASH_TILES_PER_AP = 1;

/**
 * Tiles of travel this unit buys with one action point right now.
 *
 * Dash raises this for the rest of the turn. Because the AP ledger below is
 * recomputed from the running tile count, a mid-walk change to this number
 * would retroactively re-price ground already paid for; Dash is therefore only
 * legal before the unit has moved (see `actions.ts`), which makes the rate
 * constant across every walk it applies to.
 */
export function tilesPerMoveAp(unit: Unit): number {
  if (!isDashing(unit)) return TILES_PER_MOVE_AP;
  return TILES_PER_MOVE_AP + DASH_TILES_PER_AP + (unit.combat?.dashTilesBonus ?? 0);
}

/** Tiles of travel this unit gets before any AP is charged at all. */
function freeTiles(unit: Unit): number {
  return unit.combat?.firstMoveFree ? tilesPerMoveAp(unit) : 0;
}

/**
 * Total AP a unit is charged for the first `tiles` tiles of travel in a turn.
 * The ledger is cumulative rather than per-step so a half-spent action point
 * keeps its remaining tile instead of silently rounding away.
 */
export function movementApSpent(unit: Unit, tiles: number): number {
  const billable = Math.max(0, tiles - freeTiles(unit));
  return Math.ceil(billable / tilesPerMoveAp(unit));
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
  return Math.max(0, budget * tilesPerMoveAp(unit) + freeTiles(unit) - moved);
}

/** True when the unit has neither AP nor a paid-for tile left to use. */
export function isSpent(unit: Unit): boolean {
  return unit.ap <= 0 && movementRange(unit) <= 0;
}

/**
 * Action points this unit starts its turn with. Suppression is deliberately
 * modelled as a smaller budget rather than as a separate movement rule: since
 * travel is bought with AP, one number reduces both shooting and walking and
 * the HUD only ever has to explain one thing.
 */
export function startingAp(unit: Unit): number {
  // Bracing is the answer to being pinned: a dug-in anchor keeps working the
  // turn after it is suppressed, though it still shoots worse.
  const penalty = isSuppressed(unit) && !isBraced(unit) ? SUPPRESSED_AP_PENALTY : 0;
  return Math.max(0, unit.maxAp - penalty);
}

/**
 * Start of this unit's own turn.
 *
 * Every state whose lifetime is "until my next turn" is cleared here, and it
 * is the single place AP is restored, so a status can never outlive its
 * documented duration by taking a path the runtime forgot about. Suppression
 * is *not* cleared here - it is what shortens this turn - it expires in
 * `endUnitTurn` once the suppressed turn has actually been played.
 */
export function beginUnitTurn(unit: Unit): void {
  // AP is computed before any state is cleared, because a Brace set last turn
  // is exactly what shields this turn's action points from a suppression
  // applied in between. Clearing first would silently cancel that.
  unit.ap = startingAp(unit);
  unit.overwatch = false;
  unit.peekExposure = null;
  unit.movesThisTurn = 0;
  unit.shotsThisTurn = 0;
  unit.killsThisTurn = 0;
  unit.resolvingOverwatch = false;
  unit.overwatchShotsUsed = 0;
  unit.relaysThisTurn = 0;
  unit.flankRefundsThisTurn = 0;
  setAimed(unit, false);
  setHunkered(unit, false);
  setBraced(unit, false);
  setDashing(unit, false);
  // Guard protects through the opposing turn and lapses when the protected
  // unit next acts, which is the same moment its guardian gets to renew it.
  setGuardedBy(unit, null);
}

/**
 * End of this unit's own turn. Suppression ticks down here so that a
 * suppression applied during the opposing turn covers exactly one full turn of
 * the suppressed unit, whichever side applied it.
 */
export function endUnitTurn(unit: Unit): void {
  const statuses = unit.statuses;
  if (!statuses) return;
  if (statuses.suppressed > 0) statuses.suppressed -= 1;
  if (statuses.marked > 0) {
    statuses.marked -= 1;
    if (statuses.marked === 0) statuses.markedBy = null;
  }
}

/**
 * Book-keeping for one completed tile of travel. Movement cancels a prepared
 * shot and drops any committed lean, and both the player runtime and the AI go
 * through here so neither can forget one of them.
 */
export function onUnitMoved(unit: Unit): void {
  unit.movesThisTurn = (unit.movesThisTurn ?? 0) + 1;
  unit.peekExposure = null;
  setAimed(unit, false);
  // An anchor that walks away is no longer an anchor.
  setBraced(unit, false);
}

/** Short status codes for HUD and tooltip text, in a stable order. */
export function statusLabels(unit: Unit): string[] {
  const statuses = statusesOf(unit);
  const out: string[] = [];
  if (statuses.aimed) out.push("AIMED");
  if (statuses.hunkered) out.push("HUNKERED");
  if (statuses.braced) out.push("BRACED");
  if (statuses.dashing) out.push("DASH");
  if (statuses.suppressed > 0) out.push("SUPPRESSED");
  if (statuses.marked > 0) out.push("MARKED");
  if (statuses.guardedBy) out.push("GUARDED");
  if (unit.overwatch) out.push("OVERWATCH");
  return out;
}
