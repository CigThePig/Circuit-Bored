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
  if (ax === bx && ay === by) return true;
  const line = bresenhamLine(ax, ay, bx, by);
  for (let i = 1; i < line.length - 1; i++) {
    const p = line[i];
    if (!inBounds(map, p.x, p.y)) return false;
    if (getTile(map, p.x, p.y) === "wall") return false;
  }
  return true;
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
  const points: { x: number; y: number }[] = [];
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  points.push({ x, y });
  while (x !== bx || y !== by) {
    const e2 = 2 * err;
    if (e2 >= dy && e2 <= dx) {
      err += dy;
      x += sx;
      err += dx;
      y += sy;
    } else if (e2 >= dy) {
      err += dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
    points.push({ x, y });
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
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  while (x !== bx || y !== by) {
    const e2 = 2 * err;
    if (e2 >= dy && e2 <= dx) {
      // Diagonal step: the line crosses the shared corner of four tiles.
      // Strict policy: any wall at either off-diagonal corner blocks.
      const cx1 = x + sx;
      const cy1 = y;
      const cx2 = x;
      const cy2 = y + sy;
      const cornerBlocks =
        !inBounds(map, cx1, cy1) ||
        !inBounds(map, cx2, cy2) ||
        getTile(map, cx1, cy1) === "wall" ||
        getTile(map, cx2, cy2) === "wall";
      if (cornerBlocks) return false;
      err += dy;
      x += sx;
      err += dx;
      y += sy;
    } else if (e2 >= dy) {
      err += dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
    if (x === bx && y === by) break;
    if (!inBounds(map, x, y)) return false;
    if (getTile(map, x, y) === "wall") return false;
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
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  while (x !== bx || y !== by) {
    const e2 = 2 * err;
    if (e2 >= dy && e2 <= dx) {
      const cx1 = x + sx;
      const cy1 = y;
      const cx2 = x;
      const cy2 = y + sy;
      const blockers: { x: number; y: number }[] = [];
      if (!inBounds(map, cx1, cy1) || getTile(map, cx1, cy1) === "wall") {
        blockers.push({ x: cx1, y: cy1 });
      }
      if (!inBounds(map, cx2, cy2) || getTile(map, cx2, cy2) === "wall") {
        blockers.push({ x: cx2, y: cy2 });
      }
      if (blockers.length > 0) return blockers;
      err += dy;
      x += sx;
      err += dx;
      y += sy;
    } else if (e2 >= dy) {
      err += dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
    if (x === bx && y === by) break;
    if (!inBounds(map, x, y) || getTile(map, x, y) === "wall") {
      return [{ x, y }];
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
    };
  }

  const exposure = target.peekExposure;
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
  const moverFrom: Unit = { ...mover, x: from.x, y: from.y, peekExposure: null };
  const moverTo: Unit = { ...mover, x: to.x, y: to.y, peekExposure: null };
  const sawBefore = canShootTarget(map, watcher, moverFrom).canShoot;
  const seesNow = canShootTarget(map, watcher, moverTo).canShoot;
  return !sawBefore && seesNow;
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
  const shot = canShootTarget(map, shooter, target);
  if (!shot.canShoot) return Infinity;
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
  return shot.mode === "peek" ? cover + PEEK_PENALTY : cover;
}

export type ShotResult = {
  hit: boolean;
  damage: number;
  hitChance: number;
  hadCover: boolean;
};

export function resolveShot(
  map: GameMap,
  shooter: Unit,
  target: Unit,
  rng: () => number = Math.random,
): ShotResult {
  const shot = canShootTarget(map, shooter, target);
  const cover = shot.canShoot && shot.targetExposure && target.peekExposure
    ? targetCoverPenalty(map, shooter, {
        ...target,
        x: target.peekExposure.x,
        y: target.peekExposure.y,
      })
    : targetCoverPenalty(map, shooter, target);
  const penalty = shot.canShoot
    ? (shot.mode === "peek" ? cover + PEEK_PENALTY : cover)
    : Infinity;
  const hadCover = penalty > 0;
  const hitChance = Math.max(0, BASE_HIT - penalty);
  const roll = rng();
  const hit = roll < hitChance;
  const damage = hit ? SHOT_DAMAGE : 0;
  if (hit) {
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0) {
      target.peekExposure = null;
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
  return { hit, damage, hitChance, hadCover };
}
