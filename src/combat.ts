import type { GameMap, Unit } from "./map.ts";
import { getTile, inBounds } from "./map.ts";

export const BASE_HIT = 0.8;
export const COVER_PENALTY = 0.5;
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
 * Target has cover from shooter if there is a wall orthogonally adjacent to the
 * target on the side facing the shooter. Picks the dominant axis of the offset.
 */
export function targetHasCover(
  map: GameMap,
  shooter: Unit,
  target: Unit,
): boolean {
  const dx = shooter.x - target.x;
  const dy = shooter.y - target.y;
  if (dx === 0 && dy === 0) return false;

  const candidates: { x: number; y: number }[] = [];
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    candidates.push({ x: target.x + Math.sign(dx), y: target.y });
  }
  if (Math.abs(dy) >= Math.abs(dx) && dy !== 0) {
    candidates.push({ x: target.x, y: target.y + Math.sign(dy) });
  }
  for (const c of candidates) {
    if (getTile(map, c.x, c.y) === "wall") return true;
  }
  return false;
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
  const hadCover = targetHasCover(map, shooter, target);
  const hitChance = Math.max(0, BASE_HIT - (hadCover ? COVER_PENALTY : 0));
  const roll = rng();
  const hit = roll < hitChance;
  const damage = hit ? SHOT_DAMAGE : 0;
  if (hit) {
    target.hp = Math.max(0, target.hp - damage);
  }
  return { hit, damage, hitChance, hadCover };
}
