import type { GameMap, Unit } from "./map.ts";
import { getTile, inBounds, unitAt } from "./map.ts";

export const BASE_HIT = 0.85;
export const COVER_PENALTY = 0.4;
export const HALF_COVER_PENALTY = 0.18;
export const PEEK_PENALTY = 0.3;
export const SHOT_DAMAGE = 3;

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

/**
 * Overwatch reaction predicate: was the mover hidden at `from` and visible
 * at `to` from the watcher's perspective using strict LoS / peek rules?
 *
 * Peek exposure on the mover is intentionally ignored here - overwatch must
 * depend only on movement and real visibility, not on a transient silhouette.
 */
export function overwatchShouldFire(
  map: GameMap,
  watcher: Unit,
  mover: Unit,
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  if (!watcher.overwatch) return false;
  if (watcher.hp <= 0) return false;
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
    const seesNow = canShootTarget(map, watcher, mover).canShoot;
    return !sawBefore && seesNow;
  } finally {
    mover.x = originalX;
    mover.y = originalY;
    mover.peekExposure = originalExposure;
  }
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
};

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
  const defendedCover = cover > 0
    ? cover + (targetProfile?.coverDefenseBonus ?? 0)
    : 0;
  const peekPenalty = shot.mode === "peek"
    ? Math.max(0, PEEK_PENALTY - (profile?.peekPenaltyReduction ?? 0))
    : 0;
  const penalty = shot.canShoot
    ? defendedCover + peekPenalty
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
  }
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
  const rawDamage = SHOT_DAMAGE + (shooter.combat?.damageBonus ?? 0) +
    (shooter.resolvingOverwatch ? shooter.combat?.overwatchDamageBonus ?? 0 : 0);
  const damage = hit
    ? Math.max(1, rawDamage - (target.combat?.damageReduction ?? 0))
    : 0;
  if (shot.canShoot) {
    shooter.shotsThisTurn = (shooter.shotsThisTurn ?? 0) + 1;
    shooter.encounterShots = (shooter.encounterShots ?? 0) + 1;
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
  };
}
