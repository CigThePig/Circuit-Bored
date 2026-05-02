import type { GameMap, Unit } from "./map.ts";
import { getTile, inBounds } from "./map.ts";

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

export function hasShotLineOfSight(
  map: GameMap,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): boolean {
  if (hasLineOfSight(map, sx, sy, tx, ty)) return true;

  // Only the shooter gets alternate peek origins.
  // The target should not donate fake peek tiles, because combining shooter
  // and target peeks can create impossible through-wall shots.
  for (const s of getPeekPositionsToward(map, sx, sy, tx, ty)) {
    if (hasLineOfSight(map, s.x, s.y, tx, ty)) return true;
  }

  return false;
}

/**
 * Returns the hit-chance penalty from cover the target gets vs this shooter.
 * Picks the dominant-axis adjacent tile on the side facing the shooter; walls
 * give COVER_PENALTY, half_cover gives HALF_COVER_PENALTY. Penalties don't stack.
 */
export function targetCoverPenalty(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): number {
  const dx = shooter.x - target.x;
  const dy = shooter.y - target.y;
  if (dx === 0 && dy === 0) return 0;

  const candidates: { x: number; y: number }[] = [];
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    candidates.push({ x: target.x + Math.sign(dx), y: target.y });
  }
  if (Math.abs(dy) >= Math.abs(dx) && dy !== 0) {
    candidates.push({ x: target.x, y: target.y + Math.sign(dy) });
  }
  let best = 0;
  for (const c of candidates) {
    const t = getTile(map, c.x, c.y);
    if (t === "wall" && COVER_PENALTY > best) best = COVER_PENALTY;
    else if (t === "half_cover" && HALF_COVER_PENALTY > best) best = HALF_COVER_PENALTY;
  }
  return best;
}

export function targetHasCover(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): boolean {
  return targetCoverPenalty(map, shooter, target) > 0;
}

/**
 * Effective hit-chance penalty for a shot, including the around-the-corner
 * bonus when the shooter has no direct LoS and must lean past a wall. The
 * peek bonus only applies when the target genuinely has cover from this
 * shooter, so adjacent enemies and same-side-of-wall shots stay unprotected.
 */
export function shotHitPenalty(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): number {
  const cover = targetCoverPenalty(map, shooter, target);
  if (cover === 0) return 0;
  const direct = hasLineOfSight(map, shooter.x, shooter.y, target.x, target.y);
  return direct ? cover : cover + PEEK_PENALTY;
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
  const penalty = shotHitPenalty(map, shooter, target);
  const hadCover = penalty > 0;
  const hitChance = Math.max(0, BASE_HIT - penalty);
  const roll = rng();
  const hit = roll < hitChance;
  const damage = hit ? SHOT_DAMAGE : 0;
  if (hit) {
    target.hp = Math.max(0, target.hp - damage);
  }
  return { hit, damage, hitChance, hadCover };
}
