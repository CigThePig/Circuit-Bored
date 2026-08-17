import type { GameMap, Unit } from "./map.ts";
import { isPassable, unitAt } from "./map.ts";
import {
  canStep,
  computeMovementField,
  diagonalIsClear,
  isOpenTerrain,
  MOVE_DIRECTIONS,
  ORTHOGONAL_DIRECTIONS,
} from "./movement.ts";
import { movementApCost, movementApCostForTiles, movementRange } from "./rules.ts";
import {
  BASE_HIT,
  canShootTarget,
  exposedAgainst,
  hasAdjacentCover,
  hasStrictLineOfSight,
  previewShot,
  resolveShot,
  shotHitPenalty,
  targetCoverPenalty,
  type ShotResult,
} from "./combat.ts";
import {
  HUNKER_AP_COST,
  OVERWATCH_AP_COST,
  performAction,
  SHOOT_AP_COST,
} from "./actions.ts";
import { isHunkered, isSuppressed } from "./status.ts";
import { onUnitMoved } from "./rules.ts";
import type { AiSession } from "./aiSession.ts";

export type AiAction =
  | { kind: "shoot"; target: Unit; result: ShotResult }
  | { kind: "move"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "overwatch" }
  | { kind: "hunker" }
  | { kind: "wait" };

export { SHOOT_AP_COST };

export const AI_SCORE_HAS_SHOT = 200;
export const AI_SCORE_HIT_CHANCE = 100;
export const AI_SCORE_COVER = 30;
export const AI_SCORE_ADJACENT_ALLY = -5;
export const AI_SCORE_DISTANCE = -1;
export const AI_SCORE_EXPOSED = -20;
export const AI_SCORE_PEEK_EXPOSURE_RISK = -70;
/**
 * Standing where a player on overwatch can shoot is worth about as much as
 * losing the shot the move was made for. It is a weight rather than a ban so
 * an enemy still walks a watched lane when the position on the far side is
 * clearly worth the reaction shot.
 */
export const AI_SCORE_OVERWATCH_LANE = -110;
/** Bonus for a destination that turns the target's own cover against it. */
export const AI_SCORE_EXPOSES_TARGET = 45;

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Steps of eight-way movement between two tiles on open ground. */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function livingPlayers(map: GameMap): Unit[] {
  const out: Unit[] = [];
  for (const u of map.units) {
    if (u.team === "player" && u.hp > 0) out.push(u);
  }
  return out;
}

function closestPlayer(map: GameMap, enemy: Unit): Unit | null {
  let best: Unit | null = null;
  let bestDist = Infinity;
  for (const u of livingPlayers(map)) {
    // Larger compartmentalized maps can make the Manhattan-nearest unit much
    // farther away in real movement terms. Prefer reachable route distance so
    // enemies do not press against the wrong side of a bulkhead.
    const d = aStarRoute(map, enemy.x, enemy.y, u.x, u.y)?.distance
      ?? manhattan(enemy.x, enemy.y, u.x, u.y) + map.width * map.height;
    if (d < bestDist) {
      bestDist = d;
      best = u;
    }
  }
  return best;
}

function visiblePlayers(map: GameMap, enemy: Unit): Unit[] {
  const out: Unit[] = [];
  for (const u of livingPlayers(map)) {
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

type AStarRoute = {
  next: { x: number; y: number };
  distance: number;
};

function aStarRoute(
  map: GameMap,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): AStarRoute | null {
  if (sx === tx && sy === ty) return null;

  const passable = (x: number, y: number): boolean => {
    if (!isOpenTerrain(map, x, y)) return false;
    // The destination may hold the unit being routed toward; the route ends
    // beside it, never on it, but it still has to be expandable as a goal.
    if (x === tx && y === ty) return true;
    if (unitAt(map, x, y)) return false;
    return true;
  };

  const key = (x: number, y: number) => `${x},${y}`;
  const start: AStarNode = {
    x: sx,
    y: sy,
    g: 0,
    f: chebyshev(sx, sy, tx, ty),
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
      return { next: { x: n.x, y: n.y }, distance: cur.g };
    }

    for (const d of MOVE_DIRECTIONS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      const k = key(nx, ny);
      if (closed.has(k)) continue;
      if (!passable(nx, ny)) continue;
      if (!diagonalIsClear(map, cur.x, cur.y, nx, ny)) continue;
      const g = cur.g + 1;
      const existing = openMap.get(k);
      if (existing && existing.g <= g) continue;
      const node: AStarNode = {
        x: nx,
        y: ny,
        g,
        f: g + chebyshev(nx, ny, tx, ty),
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
 * Every tile the enemy can walk to this turn, including its current tile at
 * steps=0. Uses the same eight-way field the player's movement radius is drawn
 * from, so both sides plan against identical geometry.
 */
function reachableTiles(
  map: GameMap,
  enemy: Unit,
): Array<{ x: number; y: number; steps: number }> {
  const field = computeMovementField(map, enemy, movementRange(enemy));
  return [...field.nodes.values()].map(({ x, y, steps }) => ({ x, y, steps }));
}

function adjacentAllyCount(map: GameMap, enemy: Unit, cx: number, cy: number): number {
  let count = 0;
  for (const d of ORTHOGONAL_DIRECTIONS) {
    const nx = cx + d.x;
    const ny = cy + d.y;
    const u = unitAt(map, nx, ny);
    if (u && u.team === enemy.team && u.id !== enemy.id) count += 1;
  }
  return count;
}

/**
 * True when some living player is holding overwatch that could take a reaction
 * shot at `enemy` where it currently stands. Callers relocate the enemy first,
 * so this reads the same geometry the reaction itself will use.
 */
function tileIsWatched(map: GameMap, enemy: Unit): boolean {
  for (const p of livingPlayers(map)) {
    if (!p.overwatch) continue;
    if (isSuppressed(p)) continue;
    if (canShootTarget(map, p, enemy).canShoot) return true;
  }
  return false;
}

/** Would a step to (x,y) put `enemy` inside a player's overwatch? */
function stepIsWatched(map: GameMap, enemy: Unit, x: number, y: number): boolean {
  const origX = enemy.x;
  const origY = enemy.y;
  enemy.x = x;
  enemy.y = y;
  try {
    return tileIsWatched(map, enemy);
  } finally {
    enemy.x = origX;
    enemy.y = origY;
  }
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
    const remainingAp = enemy.ap - movementApCostForTiles(enemy, candidate.steps);
    const shot = canShootTarget(map, enemy, target);
    const canFire = shot.canShoot && remainingAp >= SHOOT_AP_COST;
    if (canFire) {
      score += AI_SCORE_HAS_SHOT;
      const penalty = shotHitPenalty(map, enemy, target);
      const hitChance = penalty === Infinity ? 0 : Math.max(0, BASE_HIT - penalty);
      score += Math.round(hitChance * AI_SCORE_HIT_CHANCE);
      if (shot.mode === "peek") {
        score += AI_SCORE_PEEK_EXPOSURE_RISK;
      }
      // Going around a target's cover is worth more than the accuracy it
      // restores, and it is the answer to a hunkered defender: hunkering only
      // deepens cover that still faces the shooter.
      if (exposedAgainst(map, enemy, target)) {
        score += AI_SCORE_EXPOSES_TARGET;
      }
    }
    // Walking into ground a watcher already covers now costs the enemy, and it
    // costs for every step of the walk rather than only for crossing a
    // visibility threshold, because that is how overwatch now triggers.
    if (candidate.steps > 0 && tileIsWatched(map, enemy)) {
      score += AI_SCORE_OVERWATCH_LANE;
    }
    const coverFromTarget = targetCoverPenalty(map, target, enemy);
    const coverWeight = enemy.aiBehavior === "sentinel" || enemy.aiBehavior === "marksman"
      ? AI_SCORE_COVER * 2
      : AI_SCORE_COVER;
    if (coverFromTarget > 0) score += coverWeight;
    const distanceWeight = enemy.aiBehavior === "assault" ? -3 : AI_SCORE_DISTANCE;
    const routeDistance = aStarRoute(map, candidate.x, candidate.y, target.x, target.y)?.distance
      ?? manhattan(candidate.x, candidate.y, target.x, target.y) + map.width * map.height;
    score += distanceWeight * routeDistance;
    score += AI_SCORE_ADJACENT_ALLY * adjacentAllyCount(map, enemy, candidate.x, candidate.y);

    let exposed = false;
    for (const p of livingPlayers(map)) {
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

/**
 * Expected damage from shooting `target` right now. Reads the same preview the
 * player's HUD does, so every new modifier - Aim, Hunker, Suppressed, Exposed -
 * reaches the AI's target choice without being restated here.
 */
function shotValue(map: GameMap, enemy: Unit, target: Unit): number {
  const preview = previewShot(map, enemy, target);
  if (!preview.shot.canShoot) return -Infinity;
  const expected = preview.hitChance * preview.damage;
  // Finishing a wounded operator beats chipping a healthy one for the same
  // expected damage.
  const finisher = preview.damage >= target.hp ? preview.hitChance * 2 : 0;
  return expected + finisher;
}

export function beginEnemyTurn(
  map: GameMap,
  enemy: Unit,
  session: AiSession,
): void {
  enemy.peekExposure = null;
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
  rng: () => number = Math.random,
): AiAction {
  if (enemy.hp <= 0) return { kind: "wait" };
  if (enemy.ap <= 0 && movementRange(enemy) <= 0) return { kind: "wait" };

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
    const visible = visiblePlayers(map, enemy);
    if (visible.length > 0) {
      // Prefer the persisted target if it's still visible; otherwise pick the
      // visible player the shot is actually worth taking against. Expected
      // damage rather than raw accuracy, so a hunkered defender behind a wall
      // stops soaking fire that a flanked squadmate would take much harder.
      let best = visible.includes(target) ? target : visible[0];
      let bestValue = shotValue(map, enemy, best);
      for (const p of visible) {
        if (p === best) continue;
        const value = shotValue(map, enemy, p);
        if (value > bestValue) {
          bestValue = value;
          best = p;
        }
      }
      enemy.ap -= SHOOT_AP_COST;
      const result = resolveShot(map, enemy, best, rng);
      if (!result.canShoot) {
        // Geometry changed between target selection and resolution. Refuse to
        // emit a shot through blocked terrain and restore the spent AP.
        enemy.ap += SHOOT_AP_COST;
        return { kind: "wait" };
      }
      return { kind: "shoot", target: best, result };
    }
  }

  // No shot now: pick the best reachable tile, then take one step toward it.
  const reachable = reachableTiles(map, enemy);
  let bestCandidate: { x: number; y: number; steps: number } | null = null;
  let bestScore = -Infinity;
  for (const c of reachable) {
    const s = scoreCandidate(map, enemy, target, c);
    if (s > bestScore) {
      bestScore = s;
      bestCandidate = c;
    }
  }

  const holdingPosition = bestCandidate !== null &&
    bestCandidate.x === enemy.x &&
    bestCandidate.y === enemy.y;

  // Overwatch is now a fixed 2 AP commitment that leaves the rest of the turn
  // intact, so a sentinel that sets one is no longer spending its whole turn.
  if (
    enemy.aiBehavior === "sentinel" &&
    holdingPosition &&
    !enemy.overwatch &&
    !isSuppressed(enemy) &&
    enemy.ap >= OVERWATCH_AP_COST
  ) {
    const outcome = performAction(map, enemy, "overwatch");
    if (outcome.ok) return { kind: "overwatch" };
  }

  // A defender that is going nowhere, is being looked at, and has terrain to
  // press into should use it. Deliberately narrow: this is the AI knowing what
  // Hunker is for, not the AI acquiring a full action repertoire.
  if (
    holdingPosition &&
    (enemy.aiBehavior === "sentinel" || enemy.aiBehavior === "marksman") &&
    !isHunkered(enemy) &&
    enemy.ap >= HUNKER_AP_COST &&
    hasAdjacentCover(map, enemy.x, enemy.y) &&
    livingPlayers(map).some((p) => canShootTarget(map, p, enemy).canShoot)
  ) {
    const outcome = performAction(map, enemy, "hunker");
    if (outcome.ok) return { kind: "hunker" };
  }

  // A unit that has committed to watching a lane stays on it. Without this the
  // fallback route below would walk a sentinel straight off the position it
  // just spent two action points to hold.
  if (holdingPosition && enemy.overwatch) return { kind: "wait" };

  // If the best candidate is the current tile, fall back to A* toward an open
  // tile adjacent to the target (never the target's own tile).
  let stepTarget = bestCandidate;
  let plannedStep: { x: number; y: number } | null = null;
  if (!stepTarget || (stepTarget.x === enemy.x && stepTarget.y === enemy.y)) {
    const adjacents = MOVE_DIRECTIONS
      .map((d) => ({ x: target.x + d.x, y: target.y + d.y }))
      .filter((p) => isPassable(map, p.x, p.y));
    let bestRoute: AStarRoute | null = null;
    let bestWatched = true;
    for (const a of adjacents) {
      const route = aStarRoute(map, enemy.x, enemy.y, a.x, a.y);
      if (!route) continue;
      // Prefer any approach whose first step stays out of a watched lane; only
      // accept a watched opening when every route starts inside one, so the
      // squad advances instead of freezing in front of a single watcher.
      const watched = stepIsWatched(map, enemy, route.next.x, route.next.y);
      const better = bestRoute === null ||
        (bestWatched && !watched) ||
        (bestWatched === watched && route.distance < bestRoute.distance);
      if (better) {
        bestRoute = route;
        bestWatched = watched;
      }
    }
    if (!bestRoute) return { kind: "wait" };
    plannedStep = bestRoute.next;
    stepTarget = { x: plannedStep.x, y: plannedStep.y, steps: 1 };
  }

  if (stepTarget.x === enemy.x && stepTarget.y === enemy.y) {
    return { kind: "wait" };
  }

  const step = plannedStep ?? aStarRoute(
    map,
    enemy.x,
    enemy.y,
    stepTarget.x,
    stepTarget.y,
  )?.next;
  if (!step) return { kind: "wait" };
  if (!canStep(map, enemy, enemy.x, enemy.y, step.x, step.y)) return { kind: "wait" };
  // A tile of travel only bills an action point every other step, so an enemy
  // covers the same doubled distance a player does.
  const stepCost = movementApCost(enemy);
  if (enemy.ap < stepCost) return { kind: "wait" };

  const from = { x: enemy.x, y: enemy.y };
  enemy.x = step.x;
  enemy.y = step.y;
  enemy.ap -= stepCost;
  onUnitMoved(enemy);
  return { kind: "move", from, to: { x: enemy.x, y: enemy.y } };
}
