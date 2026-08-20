import { describe, expect, it } from "vitest";
import {
  canShootTarget,
  firingPositions,
  hasStrictLineOfSight,
  previewShot,
  resolveShot,
  settleOverwatch,
} from "../src/combat.ts";
import { actionEligibility, performAction, SHOOT_AP_COST } from "../src/actions.ts";
import { beginEnemyTurn, takeEnemyAction } from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";
import { generateEncounter, type EncounterSquadMember } from "../src/generation.ts";
import {
  computeMovementField,
  movementDestinations,
  movementPath,
} from "../src/movement.ts";
import {
  beginUnitTurn,
  endUnitTurn,
  isSpent,
  movementApCost,
  movementRange,
  onUnitMoved,
} from "../src/rules.ts";
import { cloneMap, getTile, type GameMap, type Unit } from "../src/map.ts";
import { SeededRng } from "../src/rng.ts";
import { buildMap, unit } from "./fixtures.ts";

/**
 * "Enemies can take shots the player can't make."
 *
 * These are the invariants that claim has to be measured against. The firing
 * relationship itself is geometry and must be reciprocal wherever the rules say
 * it is; where it is deliberately one-way - a shooter leaning around its own
 * corner - the game's answer is committed exposure, and that answer has to
 * actually exist. Anything the AI is allowed to do has to be something the
 * player's own action pipeline would also allow, and the tiles the AI searches
 * for a firing solution have to be tiles the board can show the player.
 */

const SQUAD: readonly EncounterSquadMember[] = [
  { id: "rook", name: "Rook", archetypeId: "operator", hp: 12, maxHp: 12, baseMaxAp: 4 },
  { id: "vex", name: "Vex", archetypeId: "runner", hp: 10, maxHp: 10, baseMaxAp: 4 },
  { id: "hex", name: "Hex", archetypeId: "bulwark", hp: 14, maxHp: 14, baseMaxAp: 4 },
];

function living(map: GameMap, team: Unit["team"]): Unit[] {
  return map.units.filter((u) => u.team === team && u.hp > 0);
}

function floorTiles(map: GameMap): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (getTile(map, x, y) === "floor") out.push({ x, y });
    }
  }
  return out;
}

/** Two stateless probes, so only geometry is being measured. */
function probeUnits(map: GameMap): { map: GameMap; a: Unit; b: Unit } {
  const a = unit({ id: "probe-a", team: "player", x: 0, y: 0 });
  const b = unit({ id: "probe-b", team: "enemy", x: 0, y: 0 });
  return { map: { ...map, units: [a, b] }, a, b };
}

describe("line of sight is reciprocal", () => {
  it("gives the same verdict in both directions on every pair of tiles", () => {
    // Supercover traversal is supposed to cover the same cells whichever end it
    // starts from. A directional tie-break would show up here as a tile pair
    // that can shoot one way only, which is exactly the complaint being tested.
    const rng = new SeededRng(20260820);
    for (let board = 0; board < 40; board++) {
      const rows: string[] = [];
      for (let y = 0; y < 9; y++) {
        let row = "";
        for (let x = 0; x < 9; x++) {
          const roll = rng.next();
          row += roll < 0.25 ? "#" : roll < 0.35 ? "h" : ".";
        }
        rows.push(row);
      }
      const map = buildMap(rows);
      for (let ay = 0; ay < 9; ay++) {
        for (let ax = 0; ax < 9; ax++) {
          for (let by = 0; by < 9; by++) {
            for (let bx = 0; bx < 9; bx++) {
              if (ax === bx && ay === by) continue;
              const forward = hasStrictLineOfSight(map, ax, ay, bx, by);
              const back = hasStrictLineOfSight(map, bx, by, ax, ay);
              if (forward !== back) {
                throw new Error(
                  `line of sight is one-way between (${ax},${ay}) and (${bx},${by}) on\n${rows.join("\n")}`,
                );
              }
            }
          }
        }
      }
    }
  });

  it("only ever becomes one-way through a lean, never through a direct line", () => {
    const rng = new SeededRng(6);
    const map = generateEncounter(rng, 2, "combat", SQUAD, []);
    const { map: bare, a, b } = probeUnits(map);
    const tiles = floorTiles(map);
    let oneWay = 0;
    for (const from of tiles) {
      for (const to of tiles) {
        if (from.x === to.x && from.y === to.y) continue;
        a.x = from.x;
        a.y = from.y;
        b.x = to.x;
        b.y = to.y;
        const forward = canShootTarget(bare, a, b);
        if (!forward.canShoot) continue;
        if (canShootTarget(bare, b, a).canShoot) continue;
        oneWay += 1;
        expect(forward.mode).toBe("peek");
      }
    }
    // A generated board really does contain these; the test is meaningless if
    // the sample is empty.
    expect(oneWay).toBeGreaterThan(0);
  });
});

describe("a one-way shot is answerable", () => {
  it("leaves every peek shooter exposed to the unit it shot at", () => {
    // This is the whole bargain of corner peeking: the extra firing position is
    // bought by committing to a silhouette the target can shoot back at. If any
    // one-way line survived the shot that took it, the enemy really would have
    // shots the squad could not answer.
    const rng = new SeededRng(6);
    const map = generateEncounter(rng, 2, "combat", SQUAD, []);
    const { map: bare, a, b } = probeUnits(map);
    const tiles = floorTiles(map);
    let checked = 0;
    for (const from of tiles) {
      for (const to of tiles) {
        if (from.x === to.x && from.y === to.y) continue;
        a.peekExposure = null;
        a.x = from.x;
        a.y = from.y;
        b.x = to.x;
        b.y = to.y;
        const shot = canShootTarget(bare, a, b);
        if (!shot.canShoot || canShootTarget(bare, b, a).canShoot) continue;
        // Take the shot: resolveShot records the lean the same way.
        expect(shot.peekFrom).toBeDefined();
        a.peekExposure = { x: shot.peekFrom!.x, y: shot.peekFrom!.y };
        const answer = canShootTarget(bare, b, a);
        if (!answer.canShoot) {
          throw new Error(
            `(${from.x},${from.y}) shot (${to.x},${to.y}) from a lean at ` +
              `(${shot.from.x},${shot.from.y}) that cannot be shot back at`,
          );
        }
        checked += 1;
        a.peekExposure = null;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("records the lean on the shooter when a peek shot resolves", () => {
    // The exposure above is only real if the shot itself writes it.
    const map = buildMap([
      "....",
      ".#..",
      "....",
    ]);
    const shooter = unit({ team: "enemy", x: 0, y: 1 });
    const target = unit({ team: "player", x: 2, y: 2 });
    map.units = [shooter, target];
    const shot = canShootTarget(map, shooter, target);
    expect(shot.mode).toBe("peek");
    resolveShot(map, shooter, target, () => 0.99);
    expect(shooter.peekExposure).toEqual(shot.peekFrom);
    expect(canShootTarget(map, target, shooter).canShoot).toBe(true);
  });
});

describe("the AI shoots under the player's rules", () => {
  it("never takes a shot the player's own action pipeline would refuse", () => {
    // The AI resolves shots directly rather than through performAction, so this
    // replays each one through the pipeline a tapped hostile goes through, with
    // the teams swapped so the shot is judged exactly as a player shot.
    const refused: string[] = [];
    let shots = 0;

    for (let seed = 1; seed <= 6; seed++) {
      const rng = new SeededRng(seed);
      const map = generateEncounter(rng, 1 + (seed % 5), "combat", SQUAD, []);
      const roll = () => rng.next();
      const session = createAiSession();
      for (const u of map.units) beginUnitTurn(u);

      for (let round = 0; round < 8; round++) {
        if (living(map, "player").length === 0) break;
        if (living(map, "enemy").length === 0) break;
        for (const player of living(map, "player")) playPlayerUnit(map, player, roll);
        for (const u of map.units) if (u.hp > 0 && u.team === "player") endUnitTurn(u);
        for (const u of map.units) if (u.hp > 0 && u.team === "enemy") beginUnitTurn(u);

        for (const enemy of living(map, "enemy")) {
          beginEnemyTurn(map, enemy, session);
          let guard = 0;
          while (!isSpent(enemy) && enemy.hp > 0 && guard++ < 40) {
            const before = cloneMap(map);
            const action = takeEnemyAction(map, enemy, session, roll);
            if (action.kind === "wait") break;
            if (action.kind === "shoot") {
              shots += 1;
              const verdict = judgeAsPlayerShot(before, enemy.id, action.target.id);
              if (!verdict.ok) {
                refused.push(`seed ${seed}: ${enemy.displayName ?? enemy.id} - ${verdict.reason}`);
              }
            }
            if (action.kind === "move") {
              resolveWatchers(map, enemy, action.from, action.to, roll);
            }
            if (living(map, "player").length === 0) break;
          }
        }
        for (const u of map.units) if (u.hp > 0 && u.team === "enemy") endUnitTurn(u);
        for (const u of map.units) if (u.hp > 0 && u.team === "player") beginUnitTurn(u);
      }
    }

    expect(shots).toBeGreaterThan(0);
    expect(refused).toEqual([]);
  });
});

/** Judge one shot exactly as the tap handler would judge a player's. */
function judgeAsPlayerShot(
  board: GameMap,
  shooterId: string,
  targetId: string,
): { ok: true } | { ok: false; reason: string } {
  const mirror = cloneMap(board);
  for (const u of mirror.units) u.team = u.team === "player" ? "enemy" : "player";
  const shooter = mirror.units.find((u) => u.id === shooterId)!;
  const target = mirror.units.find((u) => u.id === targetId)!;
  return actionEligibility(mirror, shooter, "shoot", target);
}

function resolveWatchers(
  map: GameMap,
  mover: Unit,
  from: { x: number; y: number },
  to: { x: number; y: number },
  roll: () => number,
): void {
  for (const watcher of map.units) {
    if (watcher.team === mover.team || watcher.hp <= 0 || mover.hp <= 0) continue;
    if (!settleOverwatch(map, watcher, mover, from, to).fires) continue;
    watcher.resolvingOverwatch = true;
    resolveShot(map, watcher, mover, roll);
    watcher.resolvingOverwatch = false;
  }
}

/** A deliberately plain squad policy: shoot what you can see, else close in. */
function playPlayerUnit(map: GameMap, player: Unit, roll: () => number): void {
  let guard = 0;
  while (!isSpent(player) && player.hp > 0 && guard++ < 40) {
    const hostiles = living(map, "enemy");
    if (hostiles.length === 0) return;
    if (player.ap >= SHOOT_AP_COST) {
      let best: Unit | null = null;
      let bestValue = -Infinity;
      for (const hostile of hostiles) {
        const preview = previewShot(map, player, hostile);
        if (!preview.shot.canShoot) continue;
        const value = preview.hitChance * preview.damage;
        if (value > bestValue) {
          bestValue = value;
          best = hostile;
        }
      }
      if (best) {
        performAction(map, player, "shoot", best, roll);
        continue;
      }
    }
    const range = movementRange(player);
    if (range <= 0) return;
    const field = computeMovementField(map, player, range);
    const destinations = movementDestinations(player, field);
    if (destinations.length === 0) return;
    const gap = (a: { x: number; y: number }) =>
      Math.min(...hostiles.map((h) => Math.max(Math.abs(a.x - h.x), Math.abs(a.y - h.y))));
    destinations.sort((a, b) => gap(a) - gap(b) || a.apCost - b.apCost);
    const path = movementPath(field, destinations[0].x, destinations[0].y);
    if (path.length === 0) return;
    for (const step of path) {
      if (player.hp <= 0) return;
      const cost = movementApCost(player);
      if (player.ap < cost) break;
      const from = { x: player.x, y: player.y };
      player.x = step.x;
      player.y = step.y;
      player.ap -= cost;
      onUnitMoved(player);
      resolveWatchers(map, player, from, step, roll);
    }
  }
}

describe("firingPositions", () => {
  it("reports the tile a step opens a firing line from", () => {
    // The operator is behind the wall's blind side. One step down the column
    // clears it - the kind of move the AI makes constantly and the board could
    // not previously show.
    const map = buildMap([
      "..#..",
      "..#..",
      "..#..",
      ".....",
    ]);
    const shooter = unit({ team: "player", x: 1, y: 0 });
    const hostile = unit({ team: "enemy", x: 4, y: 3 });
    map.units = [shooter, hostile];
    expect(canShootTarget(map, shooter, hostile).canShoot).toBe(false);

    const found = firingPositions(map, shooter, [
      { x: 1, y: 1 },
      { x: 1, y: 3 },
    ]);
    expect(found.map((tile) => `${tile.x},${tile.y}`)).toEqual(["1,3"]);
    expect(found[0].targetIds).toEqual([hostile.id]);
  });

  it("names every hostile a tile opens a line on", () => {
    const map = buildMap([
      ".....",
      ".....",
    ]);
    const shooter = unit({ team: "player", x: 0, y: 0 });
    const first = unit({ id: "e1", team: "enemy", x: 4, y: 0 });
    const second = unit({ id: "e2", team: "enemy", x: 4, y: 1 });
    map.units = [shooter, first, second];
    const found = firingPositions(map, shooter, [{ x: 1, y: 0 }]);
    expect(found).toHaveLength(1);
    expect(found[0].targetIds.sort()).toEqual(["e1", "e2"]);
  });

  it("leaves the board exactly as it found it", () => {
    const map = buildMap([
      "..#..",
      ".....",
    ]);
    const shooter = unit({ team: "player", x: 0, y: 0 });
    const hostile = unit({ team: "enemy", x: 4, y: 0 });
    map.units = [shooter, hostile];
    shooter.peekExposure = { x: 1, y: 1 };
    const before = JSON.stringify(map);
    firingPositions(map, shooter, [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    expect(JSON.stringify(map)).toBe(before);
  });

  it("ignores a lean the walk to that tile would have cancelled", () => {
    // Committed exposure is dropped by movement, so a tile must not qualify on
    // the strength of a lean the unit would no longer be holding when it
    // arrived. The target's own lean is real and still counts.
    const map = buildMap([
      "..#..",
      ".....",
    ]);
    const shooter = unit({ team: "player", x: 0, y: 0 });
    const hostile = unit({ team: "enemy", x: 4, y: 0 });
    map.units = [shooter, hostile];
    shooter.peekExposure = { x: 1, y: 1 };
    const withLean = firingPositions(map, shooter, [{ x: 0, y: 0 }]);
    shooter.peekExposure = null;
    const withoutLean = firingPositions(map, shooter, [{ x: 0, y: 0 }]);
    expect(withLean).toEqual(withoutLean);
  });

  it("finds nothing for a downed unit or an empty board", () => {
    const map = buildMap([".....", "....."]);
    const shooter = unit({ team: "player", x: 0, y: 0, hp: 0 });
    const hostile = unit({ team: "enemy", x: 4, y: 0 });
    map.units = [shooter, hostile];
    expect(firingPositions(map, shooter, [{ x: 1, y: 0 }])).toEqual([]);
    shooter.hp = 5;
    hostile.hp = 0;
    expect(firingPositions(map, shooter, [{ x: 1, y: 0 }])).toEqual([]);
  });

  it("agrees with the firing solution the AI scores from the same tile", () => {
    // The point of publishing these tiles is that the player is answering the
    // same question the AI already answers for itself. If the two ever
    // disagreed, the overlay would be a second opinion rather than the truth.
    const rng = new SeededRng(11);
    const map = generateEncounter(rng, 3, "combat", SQUAD, []);
    let compared = 0;
    for (const player of living(map, "player")) {
      const field = computeMovementField(map, player, movementRange(player));
      const tiles = movementDestinations(player, field);
      const reported = new Set(
        firingPositions(map, player, tiles).map((tile) => `${tile.x},${tile.y}`),
      );
      const originX = player.x;
      const originY = player.y;
      const exposure = player.peekExposure;
      player.peekExposure = null;
      try {
        for (const tile of tiles) {
          player.x = tile.x;
          player.y = tile.y;
          const hasShot = living(map, "enemy").some(
            (hostile) => canShootTarget(map, player, hostile).canShoot,
          );
          expect(reported.has(`${tile.x},${tile.y}`)).toBe(hasShot);
          compared += 1;
        }
      } finally {
        player.x = originX;
        player.y = originY;
        player.peekExposure = exposure;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
