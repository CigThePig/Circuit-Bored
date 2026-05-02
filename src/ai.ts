import type { GameMap, Unit } from "./map.ts";
import { getTile, inBounds, isPassable, unitAt } from "./map.ts";
import {
  BASE_HIT,
  canShootTarget,
  hasStrictLineOfSight,
  resolveShot,
  shotHitPenalty,
  targetCoverPenalty,
  type ShotResult,
} from "./combat.ts";
import type { AiSession } from "./aiSession.ts";

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

const SHOOT_AP_COST = 2;

export const AI_SCORE_HAS_SHOT = 200;
export const AI_SCORE_HIT_CHANCE = 100;
export const AI_SCORE_COVER = 30;
export const AI_SCORE_ADJACENT_ALLY = -5;
export const AI_SCORE_DISTANCE = -1;
export const AI_SCORE_EXPOSED = -20;

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

function visiblePlayers(map: GameMap, enemy: Unit): Unit[] {
  const out: Unit[] = [];
  for (const u of map.units) {
    if (u.team !== "player" || u.hp <= 0) continue;
    if (canShootTarget(map, enemy, u).canShoot) out.push(u);
  }
  return out;
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
    const t = getTile(map, x, y);
    if (t === "wall" || t === "half_cover") return false;
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

/**
 * BFS over passable tiles within `maxSteps` Manhattan steps from (sx,sy).
 * Returns each reachable tile and the number of steps to reach it. The
 * starting tile is included with steps=0. Other living units block.
 */
function reachableTiles(
  map: GameMap,
  enemy: Unit,
  maxSteps: number,
): Array<{ x: number; y: number; steps: number }> {
  const out: Array<{ x: number; y: number; steps: number }> = [];
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number; steps: number }> = [
    { x: enemy.x, y: enemy.y, steps: 0 },
  ];
  visited.add(`${enemy.x},${enemy.y}`);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    out.push(cur);
    if (cur.steps >= maxSteps) continue;
    for (const d of DIRS) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      if (!inBounds(map, nx, ny)) continue;
      const t = getTile(map, nx, ny);
      if (t === "wall" || t === "half_cover") continue;
      const occupant = unitAt(map, nx, ny);
      if (occupant && occupant.id !== enemy.id) continue;
      visited.add(k);
      queue.push({ x: nx, y: ny, steps: cur.steps + 1 });
    }
  }
  return out;
}

function adjacentAllyCount(map: GameMap, enemy: Unit, cx: number, cy: number): number {
  let count = 0;
  for (const d of DIRS) {
    const nx = cx + d.dx;
    const ny = cy + d.dy;
    const u = unitAt(map, nx, ny);
    if (u && u.team === enemy.team && u.id !== enemy.id) count += 1;
  }
  return count;
}

/**
 * Score a candidate destination tile for `enemy` heading toward `target`.
 * Higher is better. Uses a temporarily-relocated enemy to evaluate LoS, then
 * restores the original position before returning.
 */
function scoreCandidate(
  map: GameMap,
  enemy: Unit,
  target: Unit,
  candidate: { x: number; y: number; steps: number },
): number {
  const origX = enemy.x;
  const origY = enemy.y;
  enemy.x = candidate.x;
  enemy.y = candidate.y;
  try {
    let score = 0;
    const remainingAp = enemy.ap - candidate.steps;
    const shot = canShootTarget(map, enemy, target);
    const canFire = shot.canShoot && remainingAp >= SHOOT_AP_COST;
    if (canFire) {
      score += AI_SCORE_HAS_SHOT;
      const penalty = shotHitPenalty(map, enemy, target);
      const hitChance = penalty === Infinity ? 0 : Math.max(0, BASE_HIT - penalty);
      score += Math.round(hitChance * AI_SCORE_HIT_CHANCE);
    }
    const coverFromTarget = targetCoverPenalty(map, target, enemy);
    if (coverFromTarget > 0) score += AI_SCORE_COVER;
    score += AI_SCORE_DISTANCE * manhattan(candidate.x, candidate.y, target.x, target.y);
    score += AI_SCORE_ADJACENT_ALLY * adjacentAllyCount(map, enemy, candidate.x, candidate.y);

    let exposed = false;
    for (const p of map.units) {
      if (p.team !== "player" || p.hp <= 0) continue;
      if (!hasStrictLineOfSight(map, p.x, p.y, candidate.x, candidate.y)) continue;
      const coverFromP = targetCoverPenalty(map, p, enemy);
      if (coverFromP === 0) {
        exposed = true;
        break;
      }
    }
    if (exposed) score += AI_SCORE_EXPOSED;

    return score;
  } finally {
    enemy.x = origX;
    enemy.y = origY;
  }
}

export function beginEnemyTurn(
  map: GameMap,
  enemy: Unit,
  session: AiSession,
): void {
  const target = closestPlayer(map, enemy);
  if (target) {
    session.turnTargets.set(enemy.id, target.id);
  } else {
    session.turnTargets.delete(enemy.id);
  }
}

export function takeEnemyAction(
  map: GameMap,
  enemy: Unit,
  session: AiSession,
): AiAction {
  if (enemy.hp <= 0 || enemy.ap <= 0) return { kind: "wait" };

  const targetId = session.turnTargets.get(enemy.id);
  let target: Unit | null = null;
  if (targetId) {
    target = map.units.find((u) => u.id === targetId && u.hp > 0) ?? null;
  }
  if (!target) {
    target = closestPlayer(map, enemy);
    if (target) session.turnTargets.set(enemy.id, target.id);
  }
  if (!target) return { kind: "wait" };

  // Re-check shoot now using current LoS and current AP.
  if (enemy.ap >= SHOOT_AP_COST) {
    if (canShootTarget(map, enemy, target).canShoot) {
      enemy.ap -= SHOOT_AP_COST;
      const result = resolveShot(map, enemy, target);
      return { kind: "shoot", target, result };
    }
    const visible = visiblePlayers(map, enemy);
    if (visible.length > 0) {
      // Pick the visible player with the best hit chance.
      let best = visible[0];
      let bestPenalty = shotHitPenalty(map, enemy, best);
      for (let i = 1; i < visible.length; i++) {
        const p = shotHitPenalty(map, enemy, visible[i]);
        if (p < bestPenalty) {
          bestPenalty = p;
          best = visible[i];
        }
      }
      enemy.ap -= SHOOT_AP_COST;
      const result = resolveShot(map, enemy, best);
      return { kind: "shoot", target: best, result };
    }
  }

  // No shot now: pick the best reachable tile, then take one step toward it.
  const reachable = reachableTiles(map, enemy, enemy.ap);
  let bestCandidate: { x: number; y: number; steps: number } | null = null;
  let bestScore = -Infinity;
  for (const c of reachable) {
    const s = scoreCandidate(map, enemy, target, c);
    if (s > bestScore) {
      bestScore = s;
      bestCandidate = c;
    }
  }

  // If the best candidate is the current tile, fall back to A* toward an open
  // tile adjacent to the target (never the target's own tile).
  let stepTarget = bestCandidate;
  if (!stepTarget || (stepTarget.x === enemy.x && stepTarget.y === enemy.y)) {
    const adjacents = DIRS
      .map((d) => ({ x: target.x + d.dx, y: target.y + d.dy }))
      .filter((p) => isPassable(map, p.x, p.y));
    let bestAdj: { x: number; y: number } | null = null;
    let bestAdjDist = Infinity;
    for (const a of adjacents) {
      const d = manhattan(enemy.x, enemy.y, a.x, a.y);
      if (d < bestAdjDist) {
        bestAdjDist = d;
        bestAdj = a;
      }
    }
    if (!bestAdj) return { kind: "wait" };
    stepTarget = { x: bestAdj.x, y: bestAdj.y, steps: bestAdjDist };
  }

  if (stepTarget.x === enemy.x && stepTarget.y === enemy.y) {
    return { kind: "wait" };
  }

  const step = aStarNextStep(map, enemy.x, enemy.y, stepTarget.x, stepTarget.y);
  if (!step) return { kind: "wait" };
  if (!isPassable(map, step.x, step.y)) return { kind: "wait" };

  const from = { x: enemy.x, y: enemy.y };
  enemy.x = step.x;
  enemy.y = step.y;
  enemy.ap -= 1;
  return { kind: "move", from, to: { x: enemy.x, y: enemy.y } };
}
