import type { GameMap, Unit } from "./map.ts";
import { getTile, inBounds } from "./map.ts";

export const BASE_HIT = 0.85;
export const COVER_PENALTY = 0.35;
export const HALF_COVER_PENALTY = 0.18;
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
  const penalty = targetCoverPenalty(map, shooter, target);
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
