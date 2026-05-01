import type { GameMap, Unit } from "./map.ts";
import { isPassable } from "./map.ts";
import { hasLineOfSight, resolveShot, type ShotResult } from "./combat.ts";

export type AiAction =
  | { kind: "shoot"; target: Unit; result: ShotResult }
  | { kind: "move"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "wait" };

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function closestPlayer(map: GameMap, enemy: Unit): Unit | null {
  let best: Unit | null = null;
  let bestDist = Infinity;
  for (const u of map.units) {
    if (u.team !== "player" || u.hp <= 0) continue;
    const d = manhattan(enemy.x, enemy.y, u.x, u.y);
    if (d < bestDist) {
      bestDist = d;
      best = u;
    }
  }
  return best;
}

export function takeEnemyAction(
  map: GameMap,
  enemy: Unit,
  canShoot: boolean = true,
): AiAction {
  if (enemy.hp <= 0 || enemy.ap <= 0) return { kind: "wait" };

  const target = closestPlayer(map, enemy);
  if (!target) return { kind: "wait" };

  if (canShoot && hasLineOfSight(map, enemy.x, enemy.y, target.x, target.y)) {
    enemy.ap -= 1;
    const result = resolveShot(map, enemy, target);
    return { kind: "shoot", target, result };
  }

  let best: { dx: number; dy: number; dist: number } | null = null;
  for (const d of DIRS) {
    const nx = enemy.x + d.dx;
    const ny = enemy.y + d.dy;
    if (!isPassable(map, nx, ny)) continue;
    const dist = manhattan(nx, ny, target.x, target.y);
    if (best === null || dist < best.dist) {
      best = { dx: d.dx, dy: d.dy, dist };
    }
  }

  if (best === null) return { kind: "wait" };

  const from = { x: enemy.x, y: enemy.y };
  enemy.x += best.dx;
  enemy.y += best.dy;
  enemy.ap -= 1;
  return { kind: "move", from, to: { x: enemy.x, y: enemy.y } };
}
