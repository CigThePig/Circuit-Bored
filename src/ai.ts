import type { GameMap, Unit } from "./map.ts";
import { getTile, inBounds, isPassable, unitAt } from "./map.ts";
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

const turnTargets = new Map<string, string>();

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

function closestVisiblePlayer(map: GameMap, enemy: Unit): Unit | null {
  let best: Unit | null = null;
  let bestDist = Infinity;
  for (const u of map.units) {
    if (u.team !== "player" || u.hp <= 0) continue;
    if (!hasLineOfSight(map, enemy.x, enemy.y, u.x, u.y)) continue;
    const d = manhattan(enemy.x, enemy.y, u.x, u.y);
    if (d < bestDist) {
      bestDist = d;
      best = u;
    }
  }
  return best;
}

type AStarNode = {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: AStarNode | null;
};

function aStarNextStep(
  map: GameMap,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): { x: number; y: number } | null {
  if (sx === tx && sy === ty) return null;

  const passable = (x: number, y: number): boolean => {
    if (!inBounds(map, x, y)) return false;
    if (getTile(map, x, y) === "wall") return false;
    if (x === tx && y === ty) return true;
    if (unitAt(map, x, y)) return false;
    return true;
  };

  const key = (x: number, y: number) => `${x},${y}`;
  const start: AStarNode = {
    x: sx,
    y: sy,
    g: 0,
    f: manhattan(sx, sy, tx, ty),
    parent: null,
  };
  const open: AStarNode[] = [start];
  const openMap = new Map<string, AStarNode>();
  openMap.set(key(sx, sy), start);
  const closed = new Set<string>();

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open.splice(bestIdx, 1)[0];
    openMap.delete(key(cur.x, cur.y));
    closed.add(key(cur.x, cur.y));

    if (cur.x === tx && cur.y === ty) {
      let n: AStarNode = cur;
      while (n.parent && n.parent.parent) n = n.parent;
      if (!n.parent) return null;
      return { x: n.x, y: n.y };
    }

    for (const d of DIRS) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      const k = key(nx, ny);
      if (closed.has(k)) continue;
      if (!passable(nx, ny)) continue;
      const g = cur.g + 1;
      const existing = openMap.get(k);
      if (existing && existing.g <= g) continue;
      const node: AStarNode = {
        x: nx,
        y: ny,
        g,
        f: g + manhattan(nx, ny, tx, ty),
        parent: cur,
      };
      if (existing) {
        const idx = open.indexOf(existing);
        if (idx >= 0) open.splice(idx, 1);
      }
      open.push(node);
      openMap.set(k, node);
    }
  }

  return null;
}

export function beginEnemyTurn(map: GameMap, enemy: Unit): void {
  const target = closestPlayer(map, enemy);
  if (target) {
    turnTargets.set(enemy.id, target.id);
  } else {
    turnTargets.delete(enemy.id);
  }
}

export function takeEnemyAction(
  map: GameMap,
  enemy: Unit,
  canShoot: boolean = true,
): AiAction {
  if (enemy.hp <= 0 || enemy.ap <= 0) return { kind: "wait" };

  const targetId = turnTargets.get(enemy.id);
  let target: Unit | null = null;
  if (targetId) {
    target = map.units.find((u) => u.id === targetId && u.hp > 0) ?? null;
  }
  if (!target) return { kind: "wait" };

  if (canShoot && enemy.ap >= 2) {
    if (hasLineOfSight(map, enemy.x, enemy.y, target.x, target.y)) {
      enemy.ap -= 2;
      const result = resolveShot(map, enemy, target);
      return { kind: "shoot", target, result };
    }
    const opportunist = closestVisiblePlayer(map, enemy);
    if (opportunist) {
      enemy.ap -= 2;
      const result = resolveShot(map, enemy, opportunist);
      return { kind: "shoot", target: opportunist, result };
    }
  }

  const step = aStarNextStep(map, enemy.x, enemy.y, target.x, target.y);
  if (!step) return { kind: "wait" };
  if (!isPassable(map, step.x, step.y)) return { kind: "wait" };

  const from = { x: enemy.x, y: enemy.y };
  enemy.x = step.x;
  enemy.y = step.y;
  enemy.ap -= 1;
  return { kind: "move", from, to: { x: enemy.x, y: enemy.y } };
}
