import type { GameMap, Unit } from "./map.ts";
import { getTile, inBounds, unitAt } from "./map.ts";
import {
  consumeOverwatchEvasion,
  guardedBy,
  isAimed,
  isBraced,
  isHunkered,
  isSuppressed,
  overwatchEvasion,
  setAimed,
  setSuppressed,
  statusesOf,
  SUPPRESSION_TURNS,
} from "./status.ts";
import {
  rangeAccuracy,
  rangeBandBetween,
  rangeDamage,
  tileDistance,
  type RangeBand,
} from "./range.ts";

export const BASE_HIT = 0.85;
export const COVER_PENALTY = 0.4;
export const HALF_COVER_PENALTY = 0.18;
export const PEEK_PENALTY = 0.3;
export const SHOT_DAMAGE = 3;

/**
 * Tactical tuning.
 *
 * These are calibrated against BASE_HIT and the cover penalties above rather
 * than picked in isolation: Aim is worth a little more than half a wall, a
 * hunkered wall is close to unshootable, suppression costs a target roughly a
 * third of its accuracy, and a flank is worth an extra point of damage plus a
 * small accuracy edge. `tests/scenarios.test.ts` is what keeps these honest.
 */
export const AIM_ACCURACY_BONUS = 0.25;
/** Extra cover penalty a hunkered target adds, only where cover actually applies. */
export const HUNKER_COVER_BONUS = 0.25;
/** Token benefit for hunkering with no cover, so the button is never armour. */
export const HUNKER_OPEN_BONUS = 0.05;
export const SUPPRESSED_ACCURACY_PENALTY = 0.3;
export const EXPOSED_ACCURACY_BONUS = 0.1;
export const EXPOSED_DAMAGE_BONUS = 1;
/**
 * Crossfire threshold as the cosine between two shooters' approach vectors.
 * Zero means the angle must be at least 90 degrees, so two operators standing
 * on genuinely different sides qualify and two standing shoulder to shoulder
 * never do.
 */
export const CROSSFIRE_MAX_COSINE = 0;

/**
 * Accuracy a marked target hands to the marker's squadmates.
 *
 * Calibrated against what the mark costs: one action point is half a shot, so
 * a mark that only nudged accuracy was a net loss for a squad already hitting
 * reliably. At this value plus the cover pierce below, calling a target is
 * worth it exactly when the squad concentrates on something dug in - which is
 * the coordination the action exists to reward.
 */
export const MARK_ACCURACY_BONUS = 0.15;
/** How much of a marked target's cover the mark reads through. */
export const MARK_COVER_PIERCE = 0.15;
/** Damage a Guard link absorbs while the guardian is in position. */
export const GUARD_DAMAGE_REDUCTION = 1;
/** How far a guardian can be from the unit it protects, in eight-way steps. */
export const GUARD_RANGE = 2;
/** Damage a braced unit shrugs off. */
export const BRACE_DAMAGE_REDUCTION = 1;
/** Accuracy a braced unit adds to its own overwatch reactions. */
export const BRACE_OVERWATCH_ACCURACY = 0.12;

export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

export function hasLineOfSight(
  map: GameMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  // Preserve the legacy API without preserving its permissive corner rules.
  // Every current and future caller now receives the same conservative
  // supercover geometry used by previews, AI, overwatch, and resolution.
  return hasStrictLineOfSight(map, ax, ay, bx, by);
}

type StrictLineStep = {
  x: number;
  y: number;
  /** When this step is a diagonal, the two off-diagonal corner tiles. */
  diagCorner1: { x: number; y: number } | null;
  diagCorner2: { x: number; y: number } | null;
};

/**
 * Walks a supercover line from (ax,ay) to (bx,by), yielding each tile after
 * the start (the start itself is excluded - callers add it if needed). On a
 * diagonal step the yielded record carries the two off-diagonal corner tiles
 * the line crosses; otherwise both corner fields are null.
 */
function* strictLineSteps(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Generator<StrictLineStep> {
  if (ax === bx && ay === by) return;
  const nx = Math.abs(bx - ax);
  const ny = Math.abs(by - ay);
  const sx = Math.sign(bx - ax);
  const sy = Math.sign(by - ay);
  let ix = 0;
  let iy = 0;
  let x = ax;
  let y = ay;
  while (ix < nx || iy < ny) {
    // Compare the next vertical and horizontal grid-boundary crossings.
    // Unlike directional Bresenham tie-breaking, this traversal produces
    // the same covered cells in either direction.
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    let corner1: { x: number; y: number } | null = null;
    let corner2: { x: number; y: number } | null = null;
    if (decision === 0) {
      corner1 = { x: x + sx, y: y };
      corner2 = { x: x, y: y + sy };
      x += sx;
      y += sy;
      ix += 1;
      iy += 1;
    } else if (decision < 0) {
      x += sx;
      ix += 1;
    } else {
      y += sy;
      iy += 1;
    }
    yield { x, y, diagCorner1: corner1, diagCorner2: corner2 };
  }
}

/**
 * Returns the tiles traversed by a strict line from (ax,ay) to (bx,by),
 * including the start and end points. Tiles are listed in order.
 */
export function getLineTilesStrict(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [{ x: ax, y: ay }];
  for (const step of strictLineSteps(ax, ay, bx, by)) {
    points.push({ x: step.x, y: step.y });
  }
  return points;
}

/**
 * Strict line-of-sight: walks a supercover line from (ax,ay) to (bx,by).
 * Walls block; out-of-bounds blocks; half-cover does not block.
 * On a diagonal step, BOTH off-diagonal corner tiles are checked - if
 * EITHER is a wall, vision is blocked. (S W / . T case is blocked.)
 * Endpoints themselves never block.
 */
export function hasStrictLineOfSight(
  map: GameMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (!inBounds(map, ax, ay) || !inBounds(map, bx, by)) return false;
  if (ax === bx && ay === by) return true;
  for (const step of strictLineSteps(ax, ay, bx, by)) {
    if (step.diagCorner1) {
      const c1 = step.diagCorner1;
      const c2 = step.diagCorner2!;
      if (
        !inBounds(map, c1.x, c1.y) ||
        !inBounds(map, c2.x, c2.y) ||
        getTile(map, c1.x, c1.y) === "wall" ||
        getTile(map, c2.x, c2.y) === "wall"
      ) {
        return false;
      }
    }
    if (step.x === bx && step.y === by) break;
    if (!inBounds(map, step.x, step.y)) return false;
    if (getTile(map, step.x, step.y) === "wall") return false;
  }
  return true;
}

/**
 * Returns the first 1-2 wall (or out-of-bounds) tiles that block strict LoS,
 * in path order. Empty if the line is unblocked.
 */
export function firstBlockingTilesStrict(
  map: GameMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number }[] {
  if (!inBounds(map, ax, ay) || !inBounds(map, bx, by)) return [];
  if (ax === bx && ay === by) return [];
  for (const step of strictLineSteps(ax, ay, bx, by)) {
    if (step.diagCorner1) {
      const c1 = step.diagCorner1;
      const c2 = step.diagCorner2!;
      const blockers: { x: number; y: number }[] = [];
      if (!inBounds(map, c1.x, c1.y) || getTile(map, c1.x, c1.y) === "wall") {
        blockers.push(c1);
      }
      if (!inBounds(map, c2.x, c2.y) || getTile(map, c2.x, c2.y) === "wall") {
        blockers.push(c2);
      }
      if (blockers.length > 0) return blockers;
    }
    if (step.x === bx && step.y === by) break;
    if (!inBounds(map, step.x, step.y) || getTile(map, step.x, step.y) === "wall") {
      return [{ x: step.x, y: step.y }];
    }
  }
  return [];
}

type PeekPosition = {
  x: number;
  y: number;
  wallX: number;
  wallY: number;
  wallDx: number;
  wallDy: number;
  sideDx: number;
  sideDy: number;
};

function isWall(map: GameMap, x: number, y: number): boolean {
  return getTile(map, x, y) === "wall";
}

function isOpenForPeek(map: GameMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && !isWall(map, x, y);
}

export function getPeekPositions(
  map: GameMap,
  x: number,
  y: number,
): { x: number; y: number }[] {
  return getPeekPositionsToward(map, x, y, null, null)
    .map((p) => ({ x: p.x, y: p.y }));
}

function getPeekPositionsToward(
  map: GameMap,
  x: number,
  y: number,
  targetX: number | null,
  targetY: number | null,
): PeekPosition[] {
  const peeks: PeekPosition[] = [];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (const d of dirs) {
    const wx = x + d.dx;
    const wy = y + d.dy;
    if (!isWall(map, wx, wy)) continue;

    // The target must be on the far side of this adjacent wall.
    // Otherwise this wall is not the cover being peeked around.
    if (targetX !== null && targetY !== null) {
      const targetPastWall = (targetX - x) * d.dx + (targetY - y) * d.dy;
      if (targetPastWall <= 0) continue;
    }

    const perps = d.dx !== 0
      ? [{ px: 0, py: 1 }, { px: 0, py: -1 }]
      : [{ px: 1, py: 0 }, { px: -1, py: 0 }];

    for (const p of perps) {
      const lx = x + p.px;
      const ly = y + p.py;
      const cx = wx + p.px;
      const cy = wy + p.py;

      // The unit needs open shoulder space and an open corner square.
      // A wall on either tile blocks the lean.
      if (!isOpenForPeek(map, lx, ly)) continue;
      if (!isOpenForPeek(map, cx, cy)) continue;

      // The peek side must face the target.
      // This stops corner units from peeking both sides for one shot.
      if (targetX !== null && targetY !== null) {
        const targetOnPeekSide = (targetX - x) * p.px + (targetY - y) * p.py;
        if (targetOnPeekSide <= 0) continue;
      }

      peeks.push({
        x: cx,
        y: cy,
        wallX: wx,
        wallY: wy,
        wallDx: d.dx,
        wallDy: d.dy,
        sideDx: p.px,
        sideDy: p.py,
      });
    }
  }

  return peeks;
}

export type ShotLineMode = "direct" | "peek" | "blocked";

export type ShotLineResult = {
  canShoot: boolean;
  mode: ShotLineMode;
  from: { x: number; y: number };
  peekFrom?: { x: number; y: number };
  peekShoulder?: { x: number; y: number };
  blockingTiles?: { x: number; y: number }[];
  targetExposure?: boolean;
};

function isPeekTileShootable(
  map: GameMap,
  shooter: Unit,
  px: number,
  py: number,
): boolean {
  if (!inBounds(map, px, py)) return false;
  const t = getTile(map, px, py);
  if (t === "wall" || t === "half_cover") return false;
  const occupant = unitAt(map, px, py);
  if (occupant && occupant.id !== shooter.id) return false;
  return true;
}

function validCommittedExposure(
  map: GameMap,
  target: Unit,
): { x: number; y: number } | null {
  const exposure = target.peekExposure;
  if (!exposure) return null;
  const dx = exposure.x - target.x;
  const dy = exposure.y - target.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return null;
  if (!inBounds(map, exposure.x, exposure.y)) return null;
  if (getTile(map, exposure.x, exposure.y) !== "floor") return null;
  const occupant = unitAt(map, exposure.x, exposure.y);
  if (occupant && occupant.id !== target.id) return null;
  const legalPeeks = getPeekPositionsToward(map, target.x, target.y, null, null);
  return legalPeeks.some((peek) => peek.x === exposure.x && peek.y === exposure.y)
    ? { ...exposure }
    : null;
}

/**
 * Decides whether `shooter` can shoot `target` and from where.
 * 1) If shooter has direct strict LoS, returns mode "direct".
 * 2) Else iterates peek positions toward the target. A peek tile is valid
 *    only when in-bounds, not a wall/half_cover, not occupied by another
 *    living unit, and has strict LoS to the target.
 * 3) If the target has peekExposure, the exposed tile acts as a temporary
 *    silhouette: the shooter can shoot it directly or via their own peek.
 *    targetExposure is set true on the result; damage still applies to the
 *    real unit.
 * 4) Otherwise returns mode "blocked".
 */
export function canShootTarget(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): ShotLineResult {
  const sx = shooter.x;
  const sy = shooter.y;
  const tx = target.x;
  const ty = target.y;

  // Units and committed silhouettes must never turn impassable geometry into
  // a valid endpoint, even if a malformed/stale save places them there.
  if (
    !inBounds(map, sx, sy) ||
    !inBounds(map, tx, ty) ||
    getTile(map, sx, sy) !== "floor" ||
    getTile(map, tx, ty) !== "floor"
  ) {
    return {
      canShoot: false,
      mode: "blocked",
      from: { x: sx, y: sy },
      blockingTiles: [],
    };
  }

  if (hasStrictLineOfSight(map, sx, sy, tx, ty)) {
    return { canShoot: true, mode: "direct", from: { x: sx, y: sy } };
  }

  for (const peek of getPeekPositionsToward(map, sx, sy, tx, ty)) {
    if (!isPeekTileShootable(map, shooter, peek.x, peek.y)) continue;
    if (!hasStrictLineOfSight(map, peek.x, peek.y, tx, ty)) continue;
    return {
      canShoot: true,
      mode: "peek",
      from: { x: peek.x, y: peek.y },
      peekFrom: { x: peek.x, y: peek.y },
      peekShoulder: { x: sx + peek.sideDx, y: sy + peek.sideDy },
    };
  }

  const exposure = validCommittedExposure(map, target);
  if (exposure) {
    const ex = exposure.x;
    const ey = exposure.y;
    if (hasStrictLineOfSight(map, sx, sy, ex, ey)) {
      return {
        canShoot: true,
        mode: "direct",
        from: { x: sx, y: sy },
        targetExposure: true,
      };
    }
    for (const peek of getPeekPositionsToward(map, sx, sy, ex, ey)) {
      if (!isPeekTileShootable(map, shooter, peek.x, peek.y)) continue;
      if (!hasStrictLineOfSight(map, peek.x, peek.y, ex, ey)) continue;
      return {
        canShoot: true,
        mode: "peek",
        from: { x: peek.x, y: peek.y },
        peekFrom: { x: peek.x, y: peek.y },
        peekShoulder: { x: sx + peek.sideDx, y: sy + peek.sideDy },
        targetExposure: true,
      };
    }
  }

  const blockers = firstBlockingTilesStrict(map, sx, sy, tx, ty);
  return {
    canShoot: false,
    mode: "blocked",
    from: { x: sx, y: sy },
    blockingTiles: blockers,
  };
}

/**
 * Back-compat wrapper around canShootTarget for callers that only need a
 * yes/no. Builds throwaway Unit-shaped points for the LoS computation.
 */
export function hasShotLineOfSight(
  map: GameMap,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): boolean {
  if (hasStrictLineOfSight(map, sx, sy, tx, ty)) return true;
  for (const peek of getPeekPositionsToward(map, sx, sy, tx, ty)) {
    if (!inBounds(map, peek.x, peek.y)) continue;
    const t = getTile(map, peek.x, peek.y);
    if (t === "wall" || t === "half_cover") continue;
    const occupant = unitAt(map, peek.x, peek.y);
    if (occupant && (occupant.x !== sx || occupant.y !== sy)) continue;
    if (hasStrictLineOfSight(map, peek.x, peek.y, tx, ty)) return true;
  }
  return false;
}

export type OverwatchTrigger = "emergence" | "watched_movement";

export type OverwatchCheck = {
  fires: boolean;
  trigger: OverwatchTrigger | null;
  /** Could the watcher shoot the mover where the step started? */
  sawBefore: boolean;
  /** Can the watcher shoot the mover where the step ended? */
  seesAfter: boolean;
  /**
   * The reaction was in every way legal but the mover slipped it with a Dash
   * charge. The watch is not consumed and the charge is: the next lane still
   * costs. Callers must call `consumeOverwatchEvasion` when acting on this.
   */
  evaded: boolean;
};

/** Reaction shots one Overwatch grants this watcher. */
export function overwatchReactions(watcher: Unit): number {
  return 1 + Math.max(0, watcher.combat?.extraOverwatchReactions ?? 0);
}

/**
 * Does `watcher` get its reaction shot on a completed step from `from` to `to`?
 *
 * Overwatch is area control, not a visibility edge case. A watcher covers the
 * ground it can actually shoot into, so any step that *ends* somewhere the
 * watcher has a valid firing solution triggers the reaction:
 *
 * - `emergence`: the mover was unshootable at `from` and is shootable at `to`,
 *   which is the old trigger and still the most common one.
 * - `watched_movement`: the mover was already shootable and moved anyway,
 *   which is what turns a covered corridor into a lane the enemy has to
 *   respect rather than a threshold it only pays for once.
 *
 * The shooting relationship is the ordinary one, so every wall, corner, and
 * occupancy safeguard in `canShootTarget` applies unchanged and a watcher can
 * never react through terrain it could not shoot through.
 *
 * Peek exposure on the mover is deliberately ignored: a reaction must depend
 * on real movement and real visibility, not on a transient silhouette the
 * mover committed to on an earlier turn.
 */
export function checkOverwatch(
  map: GameMap,
  watcher: Unit,
  mover: Unit,
  from: { x: number; y: number },
  to: { x: number; y: number },
): OverwatchCheck {
  const idle: OverwatchCheck = {
    fires: false,
    trigger: null,
    sawBefore: false,
    seesAfter: false,
    evaded: false,
  };
  if (!watcher.overwatch) return idle;
  if (watcher.hp <= 0) return idle;
  if (mover.hp <= 0) return idle;
  // A suppressed watcher is keeping its head down, not covering a lane.
  if (isSuppressed(watcher)) return idle;
  // A watch that has already fired every reaction it has is spent.
  if ((watcher.overwatchShotsUsed ?? 0) >= overwatchReactions(watcher)) return idle;
  // Standing still is not movement through controlled space.
  if (from.x === to.x && from.y === to.y) return idle;

  const originalX = mover.x;
  const originalY = mover.y;
  const originalExposure = mover.peekExposure;
  try {
    // Occupancy is part of peek eligibility, so the mover must actually be
    // relocated in the map for each snapshot. A detached Unit copy leaves
    // unitAt() observing the destination during the "before" check.
    mover.peekExposure = null;
    mover.x = from.x;
    mover.y = from.y;
    const sawBefore = canShootTarget(map, watcher, mover).canShoot;
    mover.x = to.x;
    mover.y = to.y;
    const seesAfter = canShootTarget(map, watcher, mover).canShoot;
    if (!seesAfter) {
      return { fires: false, trigger: null, sawBefore, seesAfter, evaded: false };
    }
    const trigger: OverwatchTrigger = sawBefore ? "watched_movement" : "emergence";
    // A dashing unit is moving too fast for one reaction. The watch survives,
    // so the next lane - or the next step of this one, once the charge is
    // gone - still costs.
    if (overwatchEvasion(mover) > 0) {
      return { fires: false, trigger, sawBefore, seesAfter, evaded: true };
    }
    return { fires: true, trigger, sawBefore, seesAfter, evaded: false };
  } finally {
    mover.x = originalX;
    mover.y = originalY;
    mover.peekExposure = originalExposure;
  }
}

/** Boolean form of `checkOverwatch` for callers that only need yes or no. */
export function overwatchShouldFire(
  map: GameMap,
  watcher: Unit,
  mover: Unit,
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return checkOverwatch(map, watcher, mover, from, to).fires;
}

/**
 * Resolve one step against a watcher: fire, be slipped, or nothing. Spending
 * the evasion charge and the reaction is done here so no caller can read the
 * check without paying for its consequences.
 */
export function settleOverwatch(
  map: GameMap,
  watcher: Unit,
  mover: Unit,
  from: { x: number; y: number },
  to: { x: number; y: number },
): OverwatchCheck {
  const check = checkOverwatch(map, watcher, mover, from, to);
  if (check.evaded) consumeOverwatchEvasion(mover);
  if (check.fires) {
    watcher.overwatchShotsUsed = (watcher.overwatchShotsUsed ?? 0) + 1;
    if (watcher.overwatchShotsUsed >= overwatchReactions(watcher)) {
      watcher.overwatch = false;
    }
  }
  return check;
}

/**
 * Every tile in `tiles` a watcher on overwatch would react to, given the mover
 * arriving there from an adjacent tile. Used by the AI to price a route and by
 * the HUD to explain why a lane is dangerous; it never mutates the map.
 */
export function watchedTiles(
  map: GameMap,
  watcher: Unit,
  mover: Unit,
  tiles: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  if (!watcher.overwatch || watcher.hp <= 0 || isSuppressed(watcher)) return [];
  const out: { x: number; y: number }[] = [];
  const originalX = mover.x;
  const originalY = mover.y;
  const originalExposure = mover.peekExposure;
  try {
    mover.peekExposure = null;
    for (const tile of tiles) {
      mover.x = tile.x;
      mover.y = tile.y;
      if (canShootTarget(map, watcher, mover).canShoot) {
        out.push({ x: tile.x, y: tile.y });
      }
    }
  } finally {
    mover.x = originalX;
    mover.y = originalY;
    mover.peekExposure = originalExposure;
  }
  return out;
}

/**
 * Every tile in `tiles` from which `shooter` would have a firing line on at
 * least one living hostile, with the hostiles it could reach from there.
 *
 * This is the mirror of `watchedTiles`. The AI already asks this question of
 * every tile it can reach - a firing solution is the single heaviest term in
 * its movement scoring - while the board could only ever show the player the
 * shot they have from the tile they are standing on. A hostile that walks two
 * tiles to open a lane is then taking a shot the player had no way to find,
 * which is the asymmetry this exists to close: same question, same function,
 * asked on the player's behalf.
 *
 * `tiles` are candidate standing positions, so the shooter is relocated onto
 * each one for the test - occupancy is part of peek eligibility, and a
 * detached copy would leave `unitAt` observing the shooter's old tile. Its
 * committed lean is dropped for the test because walking cancels it
 * (`onUnitMoved`); a target's lean is real and still counts. The map is
 * restored exactly, and nothing here mutates it.
 */
export function firingPositions(
  map: GameMap,
  shooter: Unit,
  tiles: readonly { x: number; y: number }[],
): { x: number; y: number; targetIds: string[] }[] {
  if (shooter.hp <= 0) return [];
  const hostiles = map.units.filter(
    (unit) => unit.hp > 0 && unit.team !== shooter.team,
  );
  if (hostiles.length === 0) return [];

  const out: { x: number; y: number; targetIds: string[] }[] = [];
  const originalX = shooter.x;
  const originalY = shooter.y;
  const originalExposure = shooter.peekExposure;
  try {
    shooter.peekExposure = null;
    for (const tile of tiles) {
      shooter.x = tile.x;
      shooter.y = tile.y;
      const targetIds: string[] = [];
      for (const hostile of hostiles) {
        if (canShootTarget(map, shooter, hostile).canShoot) targetIds.push(hostile.id);
      }
      if (targetIds.length > 0) out.push({ x: tile.x, y: tile.y, targetIds });
    }
  } finally {
    shooter.x = originalX;
    shooter.y = originalY;
    shooter.peekExposure = originalExposure;
  }
  return out;
}

/**
 * The subset of `tiles` that opens a firing line the shooter does not already
 * have from where it stands, with the hostiles each one adds.
 *
 * This, rather than `firingPositions`, is what the board publishes. A unit that
 * already has a line on a hostile is told so by its sight line and hit-chance
 * pill, and re-marking every tile that re-offers the same shot buries the
 * movement radius under a lattice of identical marks. What the player cannot
 * otherwise discover is the tile that turns "no firing line" into a shot - the
 * move an enemy makes routinely and the squad had no way to see.
 */
export function openingFiringPositions(
  map: GameMap,
  shooter: Unit,
  tiles: readonly { x: number; y: number }[],
): { x: number; y: number; targetIds: string[] }[] {
  const already = new Set(
    firingPositions(map, shooter, [{ x: shooter.x, y: shooter.y }])[0]?.targetIds ?? [],
  );
  const out: { x: number; y: number; targetIds: string[] }[] = [];
  for (const position of firingPositions(map, shooter, tiles)) {
    const gained = position.targetIds.filter((id) => !already.has(id));
    if (gained.length > 0) out.push({ x: position.x, y: position.y, targetIds: gained });
  }
  return out;
}

/**
 * Returns the hit-chance penalty from cover the target gets vs this shooter.
 * Picks the adjacent tile facing the shooter on each axis where the shooter
 * actually approaches from; walls give COVER_PENALTY, half_cover gives
 * HALF_COVER_PENALTY. Penalties don't stack.
 *
 * Flank rule: on a true diagonal approach (|dx|===|dy|), the target only gets
 * cover when BOTH axis tiles are covered. Otherwise the shooter is considered
 * to be flanking the cover and the penalty is 0.
 */
export function targetCoverPenalty(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): number {
  const dx = shooter.x - target.x;
  const dy = shooter.y - target.y;
  if (dx === 0 && dy === 0) return 0;

  const xCover = dx !== 0 ? getTile(map, target.x + Math.sign(dx), target.y) : null;
  const yCover = dy !== 0 ? getTile(map, target.x, target.y + Math.sign(dy)) : null;
  const xCovers = xCover === "wall" || xCover === "half_cover";
  const yCovers = yCover === "wall" || yCover === "half_cover";

  const tileToPenalty = (t: typeof xCover): number => {
    if (t === "wall") return COVER_PENALTY;
    if (t === "half_cover") return HALF_COVER_PENALTY;
    return 0;
  };

  if (Math.abs(dx) === Math.abs(dy)) {
    // True diagonal: cover only counts if both axis tiles cover.
    if (!xCovers || !yCovers) return 0;
    return Math.max(tileToPenalty(xCover), tileToPenalty(yCover));
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    return tileToPenalty(xCover);
  }
  return tileToPenalty(yCover);
}

export function targetHasCover(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): boolean {
  return targetCoverPenalty(map, shooter, target) > 0;
}

/**
 * Why a target is Exposed to a particular shooter.
 *
 * Exposed is derived from geometry every time it is asked for rather than
 * stored on the unit, so a preview and the shot that follows it can never
 * disagree, and so no code path has to remember to clear it.
 */
export type ExposedReason = "flanked" | "crossfire" | "committed_peek";

const ADJACENT_COVER_DIRECTIONS: readonly { dx: number; dy: number }[] = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** True when the unit is standing against terrain that can protect it at all. */
export function hasAdjacentCover(map: GameMap, x: number, y: number): boolean {
  for (const d of ADJACENT_COVER_DIRECTIONS) {
    const t = getTile(map, x + d.dx, y + d.dy);
    if (t === "wall" || t === "half_cover") return true;
  }
  return false;
}

/**
 * True when `a` and `b` bear on `target` from materially different angles.
 * Purely positional: no facing, no cones, just the angle between the two
 * approach vectors measured at the target.
 */
export function isCrossfireAngle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  target: { x: number; y: number },
): boolean {
  const ax = a.x - target.x;
  const ay = a.y - target.y;
  const bx = b.x - target.x;
  const by = b.y - target.y;
  const aLen = Math.hypot(ax, ay);
  const bLen = Math.hypot(bx, by);
  if (aLen === 0 || bLen === 0) return false;
  const cosine = (ax * bx + ay * by) / (aLen * bLen);
  return cosine <= CROSSFIRE_MAX_COSINE;
}

/**
 * Whether `target` is Exposed to `shooter`, and why. Returns null for the
 * ordinary case, including a target simply standing in the open: walking into
 * a room without cover is not the same achievement as manoeuvring around cover
 * that was working a moment ago.
 *
 * The three triggers are all things the player did with position:
 * - `flanked`: the target is using terrain, but not against this shooter.
 * - `crossfire`: a squadmate also bears on the target from 90 degrees or more
 *   away, so the target cannot orient against both.
 * - `committed_peek`: the target leaned out of cover to take its own shot and
 *   has not moved since.
 */
export function exposedAgainst(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): ExposedReason | null {
  if (target.hp <= 0) return null;
  if (
    hasAdjacentCover(map, target.x, target.y) &&
    targetCoverPenalty(map, shooter, target) === 0
  ) {
    return "flanked";
  }
  if (validCommittedExposure(map, target)) return "committed_peek";
  for (const ally of map.units) {
    if (ally.hp <= 0) continue;
    if (ally.id === shooter.id) continue;
    if (ally.team !== shooter.team) continue;
    if (!isCrossfireAngle(ally, shooter, target)) continue;
    if (!canShootTarget(map, ally, target).canShoot) continue;
    return "crossfire";
  }
  return null;
}

/**
 * Apply Suppressed to a unit. Breaking an established overwatch and a held aim
 * is part of the effect: suppression is how a squad buys passage through a lane
 * it does not want to walk into, and how it spoils a shooter that has settled
 * on a target. Both only work if the state is actually cleared.
 */
export function applySuppression(target: Unit, extraTurns = 0): void {
  setSuppressed(target, SUPPRESSION_TURNS + Math.max(0, Math.floor(extraTurns)));
  target.overwatch = false;
  target.peekExposure = null;
  // Nobody holds a bead through incoming fire. This is the counter to a
  // telegraphed Marksman lock.
  setAimed(target, false);
}

/**
 * True when `shooter` benefits from a mark on `target`.
 *
 * The marker itself is excluded. Mark exists to make a squad shoot better
 * together, and letting Rook mark for its own shot would quietly turn a
 * coordination tool into a personal damage button.
 */
export function markBenefits(shooter: Unit, target: Unit): boolean {
  const statuses = statusesOf(target);
  if (statuses.marked <= 0) return false;
  if (shooter.team === target.team) return false;
  return statuses.markedBy === null || statuses.markedBy !== shooter.id;
}

/**
 * The unit that called this target, if it is still on the board. The mark's
 * strength belongs to whoever made the call, not to whoever is shooting, so
 * an upgraded designator improves every squadmate's shot rather than only the
 * shots of squadmates who happen to carry the same circuit.
 */
export function markerOf(map: GameMap, target: Unit): Unit | null {
  const markerId = statusesOf(target).markedBy;
  if (!markerId) return null;
  return map.units.find((u) => u.id === markerId && u.hp > 0) ?? null;
}

/**
 * The ally currently protecting `unit` with Guard, or null. Resolved against
 * live board state every time: the guardian has to still exist, still be
 * alive, still be on the same side, and still be close enough. A stale id in a
 * save therefore protects nobody.
 */
export function activeGuardian(map: GameMap, unit: Unit): Unit | null {
  const guardianId = guardedBy(unit);
  if (!guardianId) return null;
  for (const candidate of map.units) {
    if (candidate.id !== guardianId) continue;
    if (candidate.hp <= 0) return null;
    if (candidate.team !== unit.team) return null;
    if (candidate.id === unit.id) return null;
    if (tileDistance(candidate, unit) > GUARD_RANGE) return null;
    return candidate;
  }
  return null;
}

/** Damage a hit on `target` loses to Guard and Brace, on top of its own armour. */
export function protectionFor(map: GameMap, target: Unit): number {
  let reduction = 0;
  const guardian = activeGuardian(map, target);
  if (guardian) {
    reduction += GUARD_DAMAGE_REDUCTION + (guardian.combat?.guardDamageReduction ?? 0);
  }
  if (isBraced(target)) reduction += BRACE_DAMAGE_REDUCTION;
  return reduction;
}

/**
 * Effective hit-chance penalty for a shot. Uses canShootTarget for the
 * geometry: if blocked, returns Infinity (caller should clamp via resolveShot).
 * For a direct shot, the penalty is just the target's cover penalty. For a
 * peek shot, PEEK_PENALTY is added on top of the target's cover penalty -
 * including when the target has no cover - because the shooter is leaning
 * around their own cover and that always degrades aim.
 */
export function shotHitPenalty(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): number {
  const preview = previewShot(map, shooter, target);
  return preview.shot.canShoot ? BASE_HIT - preview.hitChance : Infinity;
}

function coverPenaltyForShot(
  map: GameMap,
  shooter: Unit,
  target: Unit,
  shot: ShotLineResult,
): number {
  let cover: number;
  if (shot.targetExposure && target.peekExposure) {
    // The target leaned out: cover is evaluated against the silhouette tile.
    const silhouette: Unit = {
      ...target,
      x: target.peekExposure.x,
      y: target.peekExposure.y,
    };
    cover = targetCoverPenalty(map, shooter, silhouette);
  } else {
    cover = targetCoverPenalty(map, shooter, target);
  }
  return cover;
}

export type ShotPreview = {
  shot: ShotLineResult;
  hitChance: number;
  hadCover: boolean;
  targetPoint: { x: number; y: number };
  /** Why the target is Exposed to this shooter, or null. */
  exposed: ExposedReason | null;
  /** Extra damage this shot would deal on top of the shooter's base damage. */
  bonusDamage: number;
  /** Damage this shot deals if it hits, after the target's reduction. */
  damage: number;
  /** True when the shooter's prepared Aim would be spent on this shot. */
  usesAim: boolean;
  /** True when the target's Hunker is contributing to the defence. */
  targetHunkered: boolean;
  /** True when the shooter is firing under Suppressed. */
  shooterSuppressed: boolean;
  /** Range band this shot is taken at. */
  band: RangeBand;
  /** Tiles between shooter and target. */
  distance: number;
  /** True when the shooter is benefiting from an ally's mark on the target. */
  usesMark: boolean;
  /** Damage the target's Guard and Brace are absorbing from this shot. */
  protection: number;
};

/** Damage a hit from `shooter` deals to `target`, before Exposed bonuses. */
function baseShotDamage(shooter: Unit, band: RangeBand): number {
  return SHOT_DAMAGE + (shooter.combat?.damageBonus ?? 0) +
    rangeDamage(shooter.combat, band) +
    (shooter.resolvingOverwatch ? shooter.combat?.overwatchDamageBonus ?? 0 : 0);
}

/** Single source of truth for UI previews and actual shot resolution. */
export function previewShot(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): ShotPreview {
  const shot = canShootTarget(map, shooter, target);
  const cover = shot.canShoot
    ? coverPenaltyForShot(map, shooter, target, shot)
    : 0;
  const profile = shooter.combat;
  const targetProfile = target.combat;
  const hunkered = isHunkered(target);
  // Hunkering buys depth in real terrain. With no cover to deepen it is worth
  // almost nothing, which is what stops it becoming an armour button.
  const hunkerBonus = hunkered
    ? (cover > 0 ? HUNKER_COVER_BONUS : HUNKER_OPEN_BONUS)
    : 0;
  // A mark reads through part of whatever the target is hiding behind, which
  // is what lets a squad shoot a dug-in defender without first dislodging it.
  const usesMark = shot.canShoot && markBenefits(shooter, target);
  const markPierce = usesMark ? Math.min(cover, MARK_COVER_PIERCE) : 0;
  const defendedCover = cover > 0
    ? Math.max(0, cover + (targetProfile?.coverDefenseBonus ?? 0) - markPierce)
    : 0;
  const peekPenalty = shot.mode === "peek"
    ? Math.max(0, PEEK_PENALTY - (profile?.peekPenaltyReduction ?? 0))
    : 0;
  const penalty = shot.canShoot
    ? defendedCover + peekPenalty + hunkerBonus
    : Infinity;
  let accuracyBonus = profile?.accuracyBonus ?? 0;
  if (cover === 0) accuracyBonus += profile?.uncoveredAccuracyBonus ?? 0;
  if ((shooter.encounterShots ?? 0) === 0) {
    accuracyBonus += profile?.firstShotAccuracyBonus ?? 0;
  }
  if ((shooter.movesThisTurn ?? 0) === 0) {
    accuracyBonus += profile?.stationaryAccuracyBonus ?? 0;
  }
  if (shooter.hp * 2 <= shooter.maxHp) {
    accuracyBonus += profile?.lowHealthAccuracyBonus ?? 0;
  }
  if (shooter.resolvingOverwatch) {
    accuracyBonus += profile?.overwatchAccuracyBonus ?? 0;
    // A braced anchor covers its lane better than it shoots on its own turn.
    if (isBraced(shooter)) accuracyBonus += BRACE_OVERWATCH_ACCURACY;
  }
  const usesAim = shot.canShoot && isAimed(shooter);
  if (usesAim) accuracyBonus += AIM_ACCURACY_BONUS;
  const shooterSuppressed = isSuppressed(shooter);
  if (shooterSuppressed) accuracyBonus -= SUPPRESSED_ACCURACY_PENALTY;
  const exposed = shot.canShoot ? exposedAgainst(map, shooter, target) : null;
  if (exposed) {
    accuracyBonus += EXPOSED_ACCURACY_BONUS + (profile?.exposedAccuracyBonus ?? 0);
  }
  if (usesMark) {
    accuracyBonus += MARK_ACCURACY_BONUS +
      (markerOf(map, target)?.combat?.markAccuracyBonus ?? 0);
  }
  // Reach is a property of the weapon, so it applies to the shooter's accuracy
  // the same way its other traits do.
  const distance = tileDistance(shooter, target);
  const band = rangeBandBetween(shooter, target);
  accuracyBonus += rangeAccuracy(profile, band);

  const bonusDamage = (exposed ? EXPOSED_DAMAGE_BONUS : 0) +
    (usesAim ? profile?.aimDamageBonus ?? 0 : 0);
  const protection = shot.canShoot ? protectionFor(map, target) : 0;
  const targetPoint = shot.targetExposure && target.peekExposure
    ? { ...target.peekExposure }
    : { x: target.x, y: target.y };
  return {
    shot,
    hitChance: shot.canShoot
      ? Math.max(0, Math.min(0.98, BASE_HIT + accuracyBonus - penalty))
      : 0,
    hadCover: shot.canShoot && cover > 0,
    targetPoint,
    exposed,
    bonusDamage,
    damage: Math.max(
      1,
      baseShotDamage(shooter, band) + bonusDamage -
        (target.combat?.damageReduction ?? 0) - protection,
    ),
    usesAim,
    targetHunkered: hunkered && cover > 0,
    shooterSuppressed,
    band,
    distance,
    usesMark,
    protection,
  };
}

export type ShotResult = {
  canShoot: boolean;
  hit: boolean;
  damage: number;
  hitChance: number;
  hadCover: boolean;
  mode: Exclude<ShotLineMode, "blocked">;
  from: { x: number; y: number };
  targetPoint: { x: number; y: number };
  peekShoulder?: { x: number; y: number };
  /** Why the target was Exposed, or null. Mirrors the preview exactly. */
  exposed: ExposedReason | null;
  /** True when a prepared Aim was spent on this shot. */
  usedAim: boolean;
};

export function resolveShot(
  map: GameMap,
  shooter: Unit,
  target: Unit,
  rng: () => number = Math.random,
): ShotResult {
  const preview = previewShot(map, shooter, target);
  const { shot, hitChance, hadCover } = preview;
  const roll = shot.canShoot ? rng() : 1;
  const hit = shot.canShoot && roll < hitChance;
  const damage = hit ? preview.damage : 0;
  if (shot.canShoot) {
    shooter.shotsThisTurn = (shooter.shotsThisTurn ?? 0) + 1;
    shooter.encounterShots = (shooter.encounterShots ?? 0) + 1;
    // Aim is a prepared shot, so it is spent whether or not the shot lands.
    if (preview.usesAim) setAimed(shooter, false);
    // Reward for shooting from the angle you manoeuvred to get, capped at once
    // per turn so it pays for the reposition rather than funding a whole extra
    // turn of shooting.
    const refund = shooter.combat?.flankApRefund ?? 0;
    if (refund > 0 && preview.exposed && (shooter.flankRefundsThisTurn ?? 0) === 0) {
      shooter.flankRefundsThisTurn = 1;
      shooter.ap = Math.min(shooter.maxAp, shooter.ap + refund);
    }
  }
  if (hit) {
    const wasAlive = target.hp > 0;
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0) {
      target.peekExposure = null;
      if (wasAlive) {
        const firstKill = (shooter.killsThisTurn ?? 0) === 0;
        shooter.killsThisTurn = (shooter.killsThisTurn ?? 0) + 1;
        if (firstKill) {
          shooter.ap = Math.min(
            shooter.maxAp,
            shooter.ap + (shooter.combat?.killApRefund ?? 0),
          );
          shooter.hp = Math.min(
            shooter.maxHp,
            shooter.hp + (shooter.combat?.killHeal ?? 0),
          );
        }
      }
    }
  }
  if (shot.canShoot && shot.mode === "peek" && shot.peekFrom) {
    // Geometry guarantees peekFrom is one diagonal step from the shooter;
    // clamp defensively so a future regression in peek-tile selection can't
    // push the rendered lean past one cell.
    const ddx = Math.max(-1, Math.min(1, shot.peekFrom.x - shooter.x));
    const ddy = Math.max(-1, Math.min(1, shot.peekFrom.y - shooter.y));
    shooter.peekExposure = { x: shooter.x + ddx, y: shooter.y + ddy };
  }
  return {
    canShoot: shot.canShoot,
    hit,
    damage,
    hitChance,
    hadCover,
    mode: shot.mode === "peek" ? "peek" : "direct",
    from: { ...shot.from },
    targetPoint: { ...preview.targetPoint },
    peekShoulder: shot.peekShoulder ? { ...shot.peekShoulder } : undefined,
    exposed: preview.exposed,
    usedAim: preview.usesAim,
  };
}
