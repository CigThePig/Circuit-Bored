import type { GameMap, Unit } from "./map.ts";
import { cloneMap, isPassable, unitAt } from "./map.ts";
import {
  canStep,
  computeMovementField,
  diagonalIsClear,
  isOpenTerrain,
  movementPath,
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
  overwatchReactions,
  previewShot,
  resolveShot,
  shotHitPenalty,
  targetCoverPenalty,
  watchedTiles,
  type ShotResult,
} from "./combat.ts";
import {
  actionEligibility,
  AIM_AP_COST,
  HUNKER_AP_COST,
  OVERWATCH_AP_COST,
  performAction,
  SHOOT_AP_COST,
  SUPPRESS_AP_COST,
} from "./actions.ts";
import { isAimed, isHunkered, isSuppressed, setAimed } from "./status.ts";
import { beginUnitTurn, onUnitMoved } from "./rules.ts";
import {
  bandTargetDistance,
  preferredBand,
  rangeBandBetween,
  rangeRating,
  tileDistance,
  type RangeBand,
} from "./range.ts";
import { makeIntent, type EnemyIntent } from "./intent.ts";
import type { AiSession } from "./aiSession.ts";

export type AiAction =
  | { kind: "shoot"; target: Unit; result: ShotResult }
  | { kind: "move"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "overwatch" }
  | { kind: "hunker" }
  | { kind: "aim"; target: Unit }
  | { kind: "suppress"; target: Unit }
  | { kind: "wait" };

export { SHOOT_AP_COST };

export const AI_SCORE_HAS_SHOT = 200;
export const AI_SCORE_HIT_CHANCE = 100;
export const AI_SCORE_COVER = 30;
export const AI_SCORE_ADJACENT_ALLY = -5;
export const AI_SCORE_DISTANCE = -1;
export const AI_SCORE_EXPOSED = -20;
export const AI_SCORE_PEEK_EXPOSURE_RISK = -70;
export const AI_SCORE_OVERWATCH_LANE = -110;
export const AI_SCORE_EXPOSES_TARGET = 45;
export const AI_SCORE_PREFERRED_BAND = 55;
export const AI_SCORE_BAND_DRIFT = -4;

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function livingPlayers(map: GameMap): Unit[] {
  return map.units.filter((unit) => unit.team === "player" && unit.hp > 0);
}

function closestPlayer(map: GameMap, enemy: Unit): Unit | null {
  let best: Unit | null = null;
  let bestDist = Infinity;
  for (const player of livingPlayers(map)) {
    const distance = aStarRoute(map, enemy.x, enemy.y, player.x, player.y)?.distance
      ?? manhattan(enemy.x, enemy.y, player.x, player.y) + map.width * map.height;
    if (distance < bestDist) {
      bestDist = distance;
      best = player;
    }
  }
  return best;
}

function visiblePlayers(map: GameMap, enemy: Unit): Unit[] {
  return livingPlayers(map).filter((player) => canShootTarget(map, enemy, player).canShoot);
}

type Point = { x: number; y: number };

type AStarNode = {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: AStarNode | null;
};

type AStarRoute = {
  next: Point;
  distance: number;
  path: Point[];
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
    if (x === tx && y === ty) return true;
    return unitAt(map, x, y) === null;
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
  const openMap = new Map<string, AStarNode>([[key(sx, sy), start]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    openMap.delete(key(current.x, current.y));
    closed.add(key(current.x, current.y));

    if (current.x === tx && current.y === ty) {
      const path: Point[] = [];
      let node: AStarNode | null = current;
      while (node?.parent) {
        path.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      path.reverse();
      return path.length > 0 ? { next: path[0], distance: current.g, path } : null;
    }

    for (const direction of MOVE_DIRECTIONS) {
      const nx = current.x + direction.x;
      const ny = current.y + direction.y;
      const nodeKey = key(nx, ny);
      if (closed.has(nodeKey) || !passable(nx, ny)) continue;
      if (!diagonalIsClear(map, current.x, current.y, nx, ny)) continue;
      const g = current.g + 1;
      const existing = openMap.get(nodeKey);
      if (existing && existing.g <= g) continue;
      const node: AStarNode = {
        x: nx,
        y: ny,
        g,
        f: g + chebyshev(nx, ny, tx, ty),
        parent: current,
      };
      if (existing) {
        const index = open.indexOf(existing);
        if (index >= 0) open.splice(index, 1);
      }
      open.push(node);
      openMap.set(nodeKey, node);
    }
  }
  return null;
}

function routeDistanceField(
  map: GameMap,
  origin: Point,
  mover: Unit,
): Map<string, number> {
  const key = (x: number, y: number) => `${x},${y}`;
  const distances = new Map<string, number>([[key(origin.x, origin.y), 0]]);
  let frontier: Point[] = [{ ...origin }];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: Point[] = [];
    for (const current of frontier) {
      for (const direction of MOVE_DIRECTIONS) {
        const nx = current.x + direction.x;
        const ny = current.y + direction.y;
        const nodeKey = key(nx, ny);
        if (distances.has(nodeKey) || !isOpenTerrain(map, nx, ny)) continue;
        if (!diagonalIsClear(map, current.x, current.y, nx, ny)) continue;
        const occupant = unitAt(map, nx, ny);
        if (occupant && occupant.id !== mover.id) continue;
        distances.set(nodeKey, depth);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return distances;
}

type ReachableCandidate = Point & {
  steps: number;
  path: Point[];
};

function reachableTiles(map: GameMap, enemy: Unit): ReachableCandidate[] {
  const field = computeMovementField(map, enemy, movementRange(enemy));
  return [...field.nodes.values()].map(({ x, y, steps }) => ({
    x,
    y,
    steps,
    path: steps === 0 ? [] : movementPath(field, x, y),
  }));
}

function adjacentAllyCount(map: GameMap, enemy: Unit, cx: number, cy: number): number {
  let count = 0;
  for (const direction of ORTHOGONAL_DIRECTIONS) {
    const unit = unitAt(map, cx + direction.x, cy + direction.y);
    if (unit && unit.team === enemy.team && unit.id !== enemy.id) count += 1;
  }
  return count;
}

function rangeBandForCandidate(distance: number): RangeBand {
  return rangeBandBetween({ x: 0, y: 0 }, { x: distance, y: 0 });
}

type OverwatchCoverage = {
  coveredBy: Map<string, string[]>;
  budgets: Map<string, number>;
};

/** Build watcher visibility once, then reuse it for every candidate route. */
function buildOverwatchCoverage(
  map: GameMap,
  enemy: Unit,
  tiles: readonly Point[],
): OverwatchCoverage {
  const coveredBy = new Map<string, string[]>();
  const budgets = new Map<string, number>();
  const watchers = livingPlayers(map).filter((player) =>
    player.overwatch &&
    !isSuppressed(player) &&
    (player.overwatchShotsUsed ?? 0) < overwatchReactions(player)
  );
  for (const watcher of watchers) {
    budgets.set(watcher.id, overwatchReactions(watcher) - (watcher.overwatchShotsUsed ?? 0));
    for (const tile of watchedTiles(map, watcher, enemy, tiles)) {
      const tileKey = `${tile.x},${tile.y}`;
      const ids = coveredBy.get(tileKey) ?? [];
      ids.push(watcher.id);
      coveredBy.set(tileKey, ids);
    }
  }
  return { coveredBy, budgets };
}

function reactionsForPath(path: readonly Point[], coverage: OverwatchCoverage): number {
  const remaining = new Map(coverage.budgets);
  let reactions = 0;
  for (const step of path) {
    for (const watcherId of coverage.coveredBy.get(`${step.x},${step.y}`) ?? []) {
      const left = remaining.get(watcherId) ?? 0;
      if (left <= 0) continue;
      reactions += 1;
      remaining.set(watcherId, left - 1);
    }
  }
  return reactions;
}

/** How many actual reaction shots this path is expected to consume. */
export function overwatchRouteReactions(
  map: GameMap,
  enemy: Unit,
  path: readonly Point[],
): number {
  if (path.length === 0) return 0;
  return reactionsForPath(path, buildOverwatchCoverage(map, enemy, path));
}

function scoreCandidate(
  map: GameMap,
  enemy: Unit,
  target: Unit,
  candidate: ReachableCandidate,
  routeDistances: Map<string, number>,
  routeReactions: number,
): number {
  const origX = enemy.x;
  const origY = enemy.y;
  enemy.x = candidate.x;
  enemy.y = candidate.y;
  try {
    let score = routeReactions * AI_SCORE_OVERWATCH_LANE;
    const remainingAp = enemy.ap - movementApCostForTiles(enemy, candidate.steps);
    const shot = canShootTarget(map, enemy, target);
    const canFire = shot.canShoot && remainingAp >= SHOOT_AP_COST;
    if (canFire) {
      score += AI_SCORE_HAS_SHOT;
      const penalty = shotHitPenalty(map, enemy, target);
      const hitChance = penalty === Infinity ? 0 : Math.max(0, BASE_HIT - penalty);
      score += Math.round(hitChance * AI_SCORE_HIT_CHANCE);
      if (shot.mode === "peek") score += AI_SCORE_PEEK_EXPOSURE_RISK;
      if (exposedAgainst(map, enemy, target)) score += AI_SCORE_EXPOSES_TARGET;
    }

    const wanted = preferredBand(enemy.combat);
    const hasRangeIdentity = rangeRating(enemy.combat, wanted) === "strong";
    const distance = tileDistance(candidate, target);
    if (hasRangeIdentity) {
      if (rangeBandForCandidate(distance) === wanted) score += AI_SCORE_PREFERRED_BAND;
      score += AI_SCORE_BAND_DRIFT * Math.abs(distance - bandTargetDistance(wanted));
    }

    const coverFromTarget = targetCoverPenalty(map, target, enemy);
    const coverWeight = enemy.aiBehavior === "sentinel" || enemy.aiBehavior === "marksman"
      ? AI_SCORE_COVER * 2
      : AI_SCORE_COVER;
    if (coverFromTarget > 0) score += coverWeight;
    const distanceWeight = enemy.aiBehavior === "assault" ? -3 : AI_SCORE_DISTANCE;
    const routeDistance = routeDistances.get(`${candidate.x},${candidate.y}`)
      ?? manhattan(candidate.x, candidate.y, target.x, target.y) + map.width * map.height;
    score += distanceWeight * routeDistance;
    score += AI_SCORE_ADJACENT_ALLY * adjacentAllyCount(map, enemy, candidate.x, candidate.y);

    let exposed = false;
    for (const player of livingPlayers(map)) {
      if (!hasStrictLineOfSight(map, player.x, player.y, candidate.x, candidate.y)) continue;
      if (targetCoverPenalty(map, player, enemy) === 0) {
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

function shotValue(map: GameMap, enemy: Unit, target: Unit): number {
  const preview = previewShot(map, enemy, target);
  if (!preview.shot.canShoot) return -Infinity;
  const expected = preview.hitChance * preview.damage;
  const finisher = preview.damage >= target.hp ? preview.hitChance * 2 : 0;
  return expected + finisher;
}

function bestVisibleTarget(map: GameMap, enemy: Unit): Unit | null {
  let best: Unit | null = null;
  let bestValue = -Infinity;
  for (const player of visiblePlayers(map, enemy)) {
    const value = shotValue(map, enemy, player);
    if (value > bestValue) {
      bestValue = value;
      best = player;
    }
  }
  return best;
}

function shouldAimBeforeShot(map: GameMap, enemy: Unit, target: Unit): boolean {
  if (enemy.aiBehavior === "marksman") return false;
  if (isAimed(enemy) || isSuppressed(enemy)) return false;
  if (enemy.ap < AIM_AP_COST + SHOOT_AP_COST) return false;
  if (!actionEligibility(map, enemy, "aim").ok) return false;

  const normalValue = shotValue(map, enemy, target);
  if (!Number.isFinite(normalValue)) return false;
  const normalShots = Math.floor(enemy.ap / SHOOT_AP_COST);
  const shotsAfterAim = Math.floor((enemy.ap - AIM_AP_COST) / SHOOT_AP_COST);
  if (shotsAfterAim <= 0) return false;

  const aimedMap = cloneMap(map);
  const aimedEnemy = aimedMap.units.find((unit) => unit.id === enemy.id);
  const aimedTarget = aimedMap.units.find((unit) => unit.id === target.id);
  if (!aimedEnemy || !aimedTarget) return false;
  setAimed(aimedEnemy, true);
  const aimedValue = shotValue(aimedMap, aimedEnemy, aimedTarget);
  const fireNowValue = normalValue * normalShots;
  const prepareValue = aimedValue + normalValue * Math.max(0, shotsAfterAim - 1);
  return prepareValue > fireNowValue + 0.05;
}

function marksmanLockedTarget(map: GameMap, enemy: Unit): Unit | null {
  if (enemy.aiBehavior !== "marksman" || !isAimed(enemy)) return null;
  if (enemy.intent?.kind !== "aim" || !enemy.intent.targetId) return null;
  if (isSuppressed(enemy)) return null;
  const target = map.units.find((unit) =>
    unit.id === enemy.intent!.targetId && unit.team === "player" && unit.hp > 0
  ) ?? null;
  if (!target) return null;
  return canShootTarget(map, enemy, target).canShoot ? target : null;
}

function validateMarksmanLock(map: GameMap, enemy: Unit): Unit | null {
  if (enemy.aiBehavior !== "marksman" || !isAimed(enemy)) return null;
  const target = marksmanLockedTarget(map, enemy);
  if (!target) setAimed(enemy, false);
  return target;
}

export function planEnemyIntent(map: GameMap, enemy: Unit): EnemyIntent {
  return planEnemyTurn(map, enemy).intent;
}

type PlannedDestination = Point & { path: Point[] };

type EnemyPlan = {
  intent: EnemyIntent;
  target: Unit | null;
  destination: PlannedDestination | null;
};

function movementIntentKind(enemy: Unit, target: Unit, destination: Point): "close" | "reposition" {
  return tileDistance(destination, target) < tileDistance(enemy, target)
    ? "close"
    : "reposition";
}

function planEnemyTurn(map: GameMap, enemy: Unit): EnemyPlan {
  const idle: EnemyPlan = { intent: makeIntent("idle"), target: null, destination: null };
  if (enemy.hp <= 0 || livingPlayers(map).length === 0) return idle;
  const behavior = enemy.aiBehavior ?? "balanced";
  const wanted = preferredBand(enemy.combat);
  const shooting = (intent: EnemyIntent, target: Unit): EnemyPlan =>
    ({ intent, target, destination: null });

  const locked = behavior === "marksman" ? marksmanLockedTarget(map, enemy) : null;
  if (locked) return shooting(makeIntent("aim", locked.id, { x: locked.x, y: locked.y }), locked);

  const visible = bestVisibleTarget(map, enemy);
  if (visible) {
    const band = rangeBandBetween(enemy, visible);
    if (
      behavior === "marksman" &&
      band === wanted &&
      !isSuppressed(enemy) &&
      enemy.ap >= AIM_AP_COST + SHOOT_AP_COST
    ) {
      return shooting(makeIntent("aim", visible.id, { x: visible.x, y: visible.y }), visible);
    }
    if (
      behavior === "sentinel" &&
      enemy.ap >= SUPPRESS_AP_COST &&
      actionEligibility(map, enemy, "suppress", visible).ok &&
      shouldSuppress(map, enemy, visible)
    ) {
      return shooting(makeIntent("suppress", visible.id, { x: visible.x, y: visible.y }), visible);
    }
    if (
      band !== wanted &&
      rangeRating(enemy.combat, wanted) === "strong" &&
      movementRange(enemy) > 0
    ) {
      const destination = bestDestination(map, enemy, visible);
      if (destination && (destination.x !== enemy.x || destination.y !== enemy.y)) {
        return {
          intent: makeIntent(
            movementIntentKind(enemy, visible, destination),
            visible.id,
            { x: destination.x, y: destination.y },
          ),
          target: visible,
          destination,
        };
      }
    }
    if (enemy.ap >= SHOOT_AP_COST) {
      return shooting(makeIntent("engage", visible.id, { x: visible.x, y: visible.y }), visible);
    }
  }

  const anchor = closestPlayer(map, enemy);
  if (!anchor) return idle;
  const destination = bestDestination(map, enemy, anchor);
  const holding = destination === null ||
    (destination.x === enemy.x && destination.y === enemy.y);
  if (holding) {
    if (
      behavior === "sentinel" &&
      !enemy.overwatch &&
      !isSuppressed(enemy) &&
      enemy.ap >= OVERWATCH_AP_COST
    ) {
      return {
        intent: makeIntent("overwatch", anchor.id, { x: enemy.x, y: enemy.y }),
        target: anchor,
        destination,
      };
    }
    return {
      intent: makeIntent("hold", anchor.id, { x: enemy.x, y: enemy.y }),
      target: anchor,
      destination,
    };
  }
  return {
    intent: makeIntent(
      movementIntentKind(enemy, anchor, destination),
      anchor.id,
      { x: destination.x, y: destination.y },
    ),
    target: anchor,
    destination,
  };
}

function shouldSuppress(map: GameMap, enemy: Unit, target: Unit): boolean {
  if (isSuppressed(target)) return false;
  if (target.overwatch) return true;
  const preview = previewShot(map, enemy, target);
  return preview.shot.canShoot && preview.hitChance < 0.5;
}

function bestDestination(
  map: GameMap,
  enemy: Unit,
  target: Unit,
): PlannedDestination | null {
  const routeDistances = routeDistanceField(map, target, enemy);
  const candidates = reachableTiles(map, enemy);
  const coverage = buildOverwatchCoverage(map, enemy, candidates);
  let best: PlannedDestination | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidate(
      map,
      enemy,
      target,
      candidate,
      routeDistances,
      reactionsForPath(candidate.path, coverage),
    );
    if (score > bestScore) {
      bestScore = score;
      best = { x: candidate.x, y: candidate.y, path: candidate.path };
    }
  }
  return best;
}

function forecastEnemyIntent(map: GameMap, enemy: Unit): EnemyIntent {
  const forecastMap = cloneMap(map);
  const forecastEnemy = forecastMap.units.find((unit) => unit.id === enemy.id);
  if (!forecastEnemy) return makeIntent("idle");
  beginUnitTurn(forecastEnemy);
  validateMarksmanLock(forecastMap, forecastEnemy);
  return planEnemyIntent(forecastMap, forecastEnemy);
}

export function refreshEnemyIntents(map: GameMap): void {
  for (const unit of map.units) {
    if (unit.team !== "enemy") continue;
    if (unit.hp <= 0) {
      unit.intent = undefined;
      continue;
    }
    validateMarksmanLock(map, unit);
    unit.intent = forecastEnemyIntent(map, unit);
  }
}

export function beginEnemyTurn(
  map: GameMap,
  enemy: Unit,
  session: AiSession,
): void {
  enemy.peekExposure = null;
  validateMarksmanLock(map, enemy);
  enemy.intent = planEnemyIntent(map, enemy);
  const target = enemy.intent.targetId
    ? map.units.find((unit) => unit.id === enemy.intent!.targetId && unit.hp > 0) ?? null
    : null;
  const anchor = target ?? closestPlayer(map, enemy);
  if (anchor) session.turnTargets.set(enemy.id, anchor.id);
  else session.turnTargets.delete(enemy.id);
}

export function takeEnemyAction(
  map: GameMap,
  enemy: Unit,
  session: AiSession,
  rng: () => number = Math.random,
): AiAction {
  if (enemy.hp <= 0) return { kind: "wait" };
  if (enemy.ap <= 0 && movementRange(enemy) <= 0) return { kind: "wait" };

  const plan = planEnemyTurn(map, enemy);
  const intent = plan.intent;
  enemy.intent = intent;
  const intentTarget = plan.target;

  if (intent.kind === "aim" && intentTarget && !isAimed(enemy)) {
    const outcome = performAction(map, enemy, "aim");
    if (outcome.ok) {
      enemy.ap = 0;
      return { kind: "aim", target: intentTarget };
    }
  }
  if (intent.kind === "suppress" && intentTarget) {
    const outcome = performAction(map, enemy, "suppress", intentTarget, rng);
    if (outcome.ok) return { kind: "suppress", target: intentTarget };
  }

  let target: Unit | null = intentTarget;
  if (!target) {
    const targetId = session.turnTargets.get(enemy.id);
    if (targetId) target = map.units.find((unit) => unit.id === targetId && unit.hp > 0) ?? null;
  }
  if (!target) target = closestPlayer(map, enemy);
  if (!target) return { kind: "wait" };
  session.turnTargets.set(enemy.id, target.id);

  if (enemy.aiBehavior === "marksman" && isAimed(enemy)) {
    const locked = marksmanLockedTarget(map, enemy);
    if (!locked || enemy.ap < SHOOT_AP_COST) return { kind: "wait" };
    enemy.ap -= SHOOT_AP_COST;
    const result = resolveShot(map, enemy, locked, rng);
    if (!result.canShoot) {
      enemy.ap += SHOOT_AP_COST;
      setAimed(enemy, false);
      return { kind: "wait" };
    }
    enemy.ap = 0;
    session.turnTargets.set(enemy.id, locked.id);
    return { kind: "shoot", target: locked, result };
  }

  if (intent.kind === "engage" && enemy.ap >= SHOOT_AP_COST) {
    const visible = visiblePlayers(map, enemy);
    if (visible.length > 0) {
      let best = visible.includes(target) ? target : visible[0];
      let bestValue = shotValue(map, enemy, best);
      for (const player of visible) {
        if (player === best) continue;
        const value = shotValue(map, enemy, player);
        if (value > bestValue) {
          bestValue = value;
          best = player;
        }
      }
      if (shouldAimBeforeShot(map, enemy, best)) performAction(map, enemy, "aim");
      if (enemy.ap < SHOOT_AP_COST) return { kind: "wait" };
      enemy.ap -= SHOOT_AP_COST;
      const result = resolveShot(map, enemy, best, rng);
      if (!result.canShoot) {
        enemy.ap += SHOOT_AP_COST;
        return { kind: "wait" };
      }
      return { kind: "shoot", target: best, result };
    }
  }

  const bestCandidate = plan.destination ?? bestDestination(map, enemy, target);
  const holdingPosition = bestCandidate !== null &&
    bestCandidate.x === enemy.x && bestCandidate.y === enemy.y;

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
  if (
    holdingPosition &&
    (enemy.aiBehavior === "sentinel" || enemy.aiBehavior === "marksman") &&
    !isHunkered(enemy) &&
    enemy.ap >= HUNKER_AP_COST &&
    hasAdjacentCover(map, enemy.x, enemy.y) &&
    livingPlayers(map).some((player) => canShootTarget(map, player, enemy).canShoot)
  ) {
    const outcome = performAction(map, enemy, "hunker");
    if (outcome.ok) return { kind: "hunker" };
  }

  if (intent.kind === "hold") return { kind: "wait" };
  if (holdingPosition && enemy.overwatch) return { kind: "wait" };

  let stepTarget: Point | null = bestCandidate;
  let plannedStep: Point | null = bestCandidate?.path[0] ?? null;
  if (!stepTarget || (stepTarget.x === enemy.x && stepTarget.y === enemy.y)) {
    const adjacents = MOVE_DIRECTIONS
      .map((direction) => ({ x: target.x + direction.x, y: target.y + direction.y }))
      .filter((point) => isPassable(map, point.x, point.y));
    let bestRoute: AStarRoute | null = null;
    let bestRisk = Infinity;
    for (const adjacent of adjacents) {
      const route = aStarRoute(map, enemy.x, enemy.y, adjacent.x, adjacent.y);
      if (!route) continue;
      const risk = overwatchRouteReactions(
        map,
        enemy,
        route.path.slice(0, movementRange(enemy)),
      );
      const better = bestRoute === null ||
        risk < bestRisk ||
        (risk === bestRisk && route.distance < bestRoute.distance);
      if (better) {
        bestRoute = route;
        bestRisk = risk;
      }
    }
    if (!bestRoute) return { kind: "wait" };
    plannedStep = bestRoute.next;
    stepTarget = plannedStep;
  }

  if (!stepTarget || (stepTarget.x === enemy.x && stepTarget.y === enemy.y)) {
    return { kind: "wait" };
  }
  const step = plannedStep ?? aStarRoute(
    map,
    enemy.x,
    enemy.y,
    stepTarget.x,
    stepTarget.y,
  )?.next;
  if (!step || !canStep(map, enemy, enemy.x, enemy.y, step.x, step.y)) {
    return { kind: "wait" };
  }
  const stepCost = movementApCost(enemy);
  if (enemy.ap < stepCost) return { kind: "wait" };

  const from = { x: enemy.x, y: enemy.y };
  enemy.x = step.x;
  enemy.y = step.y;
  enemy.ap -= stepCost;
  onUnitMoved(enemy);
  return { kind: "move", from, to: { x: enemy.x, y: enemy.y } };
}
