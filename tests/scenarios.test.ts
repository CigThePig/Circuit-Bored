/**
 * Deterministic tactical scenarios.
 *
 * These are the balance argument for this pass. Each one plays a fixed board
 * with a fixed random stream twice - once with the naive line of play and once
 * with the tactical one - and asserts that the tactical line materially
 * changes the outcome. They are not a promise that the player wins; they are a
 * check that positioning, preparation, and control are worth their AP.
 */
import { describe, expect, it } from "vitest";
import { performAction } from "../src/actions.ts";
import {
  AIM_ACCURACY_BONUS,
  checkOverwatch,
  previewShot,
  resolveShot,
} from "../src/combat.ts";
import { beginUnitTurn, endUnitTurn, onUnitMoved } from "../src/rules.ts";
import { isSuppressed } from "../src/status.ts";
import { SeededRng } from "../src/rng.ts";
import { EMPTY_COMBAT_PROFILE, type CombatProfile, type Unit } from "../src/map.ts";
import { buildMap } from "./fixtures.ts";

/** A fresh deterministic stream. Same seed, same rolls, every run. */
function rolls(seed: string): () => number {
  const rng = new SeededRng(seed);
  return () => rng.next();
}

function profile(overrides: Partial<CombatProfile>): CombatProfile {
  return { ...EMPTY_COMBAT_PROFILE, ...overrides };
}

/** Spend a unit's whole turn firing at one target. */
function emptyClipInto(
  map: Parameters<typeof resolveShot>[0],
  shooter: Unit,
  target: Unit,
  rng: () => number,
): void {
  while (shooter.ap >= 2 && target.hp > 0) {
    shooter.ap -= 2;
    resolveShot(map, shooter, target, rng);
  }
}

/**
 * Scenarios A and B share a board: an operator beside a slab of half cover
 * that faces a stronger hostile down an open lane. Half cover rather than a
 * wall, so the cover protects without also removing the firing line.
 */
function coverStandoff() {
  const map = buildMap([
    "..........",
    "..........",
    ".ph......e",
    "..........",
    "..........",
  ], [
    { team: "player", x: 1, y: 2, hp: 12, maxHp: 12, maxAp: 4 },
    { team: "enemy", x: 9, y: 2, hp: 14, maxHp: 14, maxAp: 4 },
  ]);
  const [player, enemy] = map.units;
  // Strictly the stronger unit: more health and a heavier weapon.
  enemy.combat = profile({ damageBonus: 1 });
  return { map, player, enemy };
}

/** The same standoff with the operator standing out in the open lane instead. */
function openStandoff() {
  const board = coverStandoff();
  board.player.x = 5;
  return board;
}

describe("Scenario A: a straight damage race against a stronger enemy", () => {
  it("is lost by the weaker operator", () => {
    const { map, player, enemy } = openStandoff();
    const rng = rolls("scenario-a");
    for (let turn = 0; turn < 20 && player.hp > 0 && enemy.hp > 0; turn++) {
      beginUnitTurn(player);
      emptyClipInto(map, player, enemy, rng);
      endUnitTurn(player);
      if (enemy.hp <= 0) break;
      beginUnitTurn(enemy);
      emptyClipInto(map, enemy, player, rng);
      endUnitTurn(enemy);
    }
    expect(player.hp).toBe(0);
    expect(enemy.hp).toBeGreaterThan(0);
  });
});

describe("Scenario B: the same operator using cover, Aim, and Hunker", () => {
  /** Turns the operator stays alive under a fixed stream of rolls. */
  function survive(tactical: boolean): number {
    const { map, player, enemy } = tactical ? coverStandoff() : openStandoff();
    const rng = rolls("scenario-b");
    let turns = 0;
    while (player.hp > 0 && enemy.hp > 0 && turns < 40) {
      turns += 1;
      beginUnitTurn(player);
      if (tactical) {
        // Prepare one good shot, then press into the cover for the reply.
        performAction(map, player, "aim", null, rng);
        performAction(map, player, "shoot", enemy, rng);
        performAction(map, player, "hunker", null, rng);
      } else {
        emptyClipInto(map, player, enemy, rng);
      }
      endUnitTurn(player);
      if (enemy.hp <= 0) break;
      beginUnitTurn(enemy);
      emptyClipInto(map, enemy, player, rng);
      endUnitTurn(enemy);
    }
    return turns;
  }

  it("survives materially longer than it does trading in the open", () => {
    const naive = survive(false);
    const tactical = survive(true);
    expect(tactical).toBeGreaterThan(naive);
  });

  it("makes hunkering in cover a real defensive gain and open ground almost none", () => {
    const covered = coverStandoff();
    const coverBefore = previewShot(covered.map, covered.enemy, covered.player).hitChance;
    performAction(covered.map, covered.player, "hunker", null, () => 0);
    const coverAfter = previewShot(covered.map, covered.enemy, covered.player).hitChance;

    const open = openStandoff();
    const openBefore = previewShot(open.map, open.enemy, open.player).hitChance;
    performAction(open.map, open.player, "hunker", null, () => 0);
    const openAfter = previewShot(open.map, open.enemy, open.player).hitChance;

    expect(coverBefore - coverAfter).toBeGreaterThan((openBefore - openAfter) * 4);
  });

  it("makes preparing beat firing again exactly when the shot is a bad one", () => {
    // Aim buys AIM_ACCURACY_BONUS of hit chance for 1 AP; a second shot buys a
    // whole shot for 2 AP. Preparing wins below roughly 50% and loses above it,
    // which is what keeps standing still a decision instead of a default.
    const hard = buildMap(["..h....."], [
      { team: "player", x: 7, y: 0 },
      { team: "enemy", x: 1, y: 0 },
    ]);
    const [sniper, hidden] = hard.units;
    hidden.combat = profile({ coverDefenseBonus: 0.25 });
    const hardShot = previewShot(hard, sniper, hidden);
    expect(hardShot.hitChance).toBeLessThan(0.5);
    const secondShot = hardShot.hitChance * hardShot.damage / 2;
    const prepared = AIM_ACCURACY_BONUS * hardShot.damage / 1;
    expect(prepared).toBeGreaterThan(secondShot);

    const easy = buildMap(["........"], [
      { team: "player", x: 7, y: 0 },
      { team: "enemy", x: 1, y: 0 },
    ]);
    const easyShot = previewShot(easy, easy.units[0], easy.units[1]);
    expect(easyShot.hitChance).toBeGreaterThan(0.5);
    expect(AIM_ACCURACY_BONUS * easyShot.damage)
      .toBeLessThan(easyShot.hitChance * easyShot.damage / 2);
  });
});

describe("Scenario C: two weak operators against one strong isolated enemy", () => {
  /**
   * A heavy hostile holds a position behind half cover on its western face.
   * Two light operators cannot out-trade it: it hits harder, soaks a point of
   * every hit, and has more than twice their combined health.
   */
  function isolatedHeavy(eastFlank: boolean) {
    const map = buildMap([
      "..........",
      "..........",
      "...h......",
      "..........",
      "..........",
    ], [
      { team: "player", x: 0, y: 2, hp: 7, maxHp: 7, maxAp: 4 },
      { team: "player", x: eastFlank ? 8 : 0, y: eastFlank ? 2 : 1, hp: 7, maxHp: 7, maxAp: 4 },
      { team: "enemy", x: 4, y: 2, hp: 14, maxHp: 14, maxAp: 4 },
    ]);
    const [west, second, heavy] = map.units;
    heavy.combat = profile({ damageBonus: 2, damageReduction: 2 });
    return { map, west, second, heavy };
  }

  it("loses when the pair stacks up and simply trades shots", () => {
    const { map, west, second, heavy } = isolatedHeavy(false);
    // Both operators sit on the side the hostile's cover faces, so neither
    // gets an angle and the two of them never form a crossfire.
    expect(previewShot(map, west, heavy).exposed).toBeNull();
    expect(previewShot(map, second, heavy).exposed).toBeNull();
    const rng = rolls("scenario-c");
    for (let turn = 0; turn < 20 && heavy.hp > 0; turn++) {
      for (const p of [west, second]) {
        if (p.hp <= 0) continue;
        beginUnitTurn(p);
        emptyClipInto(map, p, heavy, rng);
        endUnitTurn(p);
      }
      if (heavy.hp <= 0) break;
      beginUnitTurn(heavy);
      const victim = west.hp > 0 ? west : second;
      if (victim.hp > 0) emptyClipInto(map, heavy, victim, rng);
      endUnitTurn(heavy);
      if (west.hp <= 0 && second.hp <= 0) break;
    }
    expect(heavy.hp).toBeGreaterThan(0);
    expect(west.hp === 0 || second.hp === 0).toBe(true);
  });

  it("wins when one operator pins it and the other takes the far angle", () => {
    const { map, west, second, heavy } = isolatedHeavy(true);
    const rng = rolls("scenario-c");
    for (let turn = 0; turn < 20 && heavy.hp > 0; turn++) {
      beginUnitTurn(west);
      if (west.hp > 0) {
        performAction(map, west, "suppress", heavy, rng);
        performAction(map, west, "shoot", heavy, rng);
      }
      endUnitTurn(west);
      beginUnitTurn(second);
      if (second.hp > 0 && heavy.hp > 0) {
        performAction(map, second, "shoot", heavy, rng);
        performAction(map, second, "shoot", heavy, rng);
      }
      endUnitTurn(second);
      if (heavy.hp <= 0) break;
      beginUnitTurn(heavy);
      expect(isSuppressed(heavy)).toBe(true);
      const victim = west.hp > 0 ? west : second;
      if (victim.hp > 0) emptyClipInto(map, heavy, victim, rng);
      endUnitTurn(heavy);
      if (west.hp <= 0 && second.hp <= 0) break;
    }
    expect(heavy.hp).toBe(0);
    expect(west.hp > 0 || second.hp > 0).toBe(true);
  });

  it("gives the pair a positional bonus purely from where they stand", () => {
    const { map, west, second, heavy } = isolatedHeavy(true);
    // The eastern operator went around the cover; the western one benefits
    // from the second angle without moving at all.
    expect(previewShot(map, second, heavy).exposed).toBe("flanked");
    expect(previewShot(map, west, heavy).exposed).toBe("crossfire");
    second.hp = 0;
    expect(previewShot(map, west, heavy).exposed).toBeNull();
  });

  it("does not let suppression alone finish the fight", () => {
    // Suppression deals no damage, so a squad that only pins never wins. This
    // is what stops "suppress everything" becoming the dominant line.
    const { map, west, heavy } = isolatedHeavy(false);
    const rng = rolls("scenario-c-pin");
    for (let turn = 0; turn < 10; turn++) {
      beginUnitTurn(west);
      performAction(map, west, "suppress", heavy, rng);
      endUnitTurn(west);
      beginUnitTurn(heavy);
      endUnitTurn(heavy);
    }
    expect(heavy.hp).toBe(heavy.maxHp);
  });
});

/**
 * Scenarios D and E share a board: two rooms joined by a single gap at (4,2).
 * A hostile in the northern room watches along row 1.
 */
function watchedCorridor() {
  const map = buildMap([
    "..........",
    "..........",
    "####.#####",
    "..........",
    "..........",
  ], [
    { team: "player", x: 4, y: 4 },
    { team: "player", x: 1, y: 1 },
    { team: "enemy", x: 9, y: 1, overwatch: true },
  ]);
  const [mover, support, watcher] = map.units;
  return { map, mover, support, watcher };
}

describe("Scenario D: crossing an overwatched lane carelessly", () => {
  it("draws a reaction the moment the walk enters the watched room", () => {
    const { map, mover, watcher } = watchedCorridor();
    const route = [{ x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }];
    const triggers: string[] = [];
    let from = { x: mover.x, y: mover.y };
    for (const to of route) {
      const check = checkOverwatch(map, watcher, mover, from, to);
      if (check.fires) triggers.push(check.trigger!);
      mover.x = to.x;
      mover.y = to.y;
      onUnitMoved(mover);
      from = to;
    }
    expect(triggers).toEqual(["emergence"]);
  });

  it("keeps reacting to movement already inside the lane", () => {
    const { map, mover, watcher } = watchedCorridor();
    mover.x = 4;
    mover.y = 1;
    const check = checkOverwatch(map, watcher, mover, { x: 4, y: 1 }, { x: 5, y: 1 });
    expect(check.sawBefore).toBe(true);
    expect(check.fires).toBe(true);
    expect(check.trigger).toBe("watched_movement");
  });

  it("does not react to a route that stays behind the wall", () => {
    const { map, mover, watcher } = watchedCorridor();
    let from = { x: mover.x, y: mover.y };
    for (const to of [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 4 }]) {
      expect(checkOverwatch(map, watcher, mover, from, to).fires).toBe(false);
      mover.x = to.x;
      mover.y = to.y;
      from = to;
    }
  });

  it("never resolves a reaction through the dividing wall", () => {
    const { map, mover, watcher } = watchedCorridor();
    mover.x = 2;
    mover.y = 3;
    expect(previewShot(map, watcher, mover).shot.canShoot).toBe(false);
    expect(checkOverwatch(map, watcher, mover, { x: 1, y: 3 }, { x: 2, y: 3 }).fires)
      .toBe(false);
  });
});

describe("Scenario E: buying safe passage past that overwatch", () => {
  it("lets a squadmate suppress the watcher so the lane opens", () => {
    const { map, mover, support, watcher } = watchedCorridor();
    expect(previewShot(map, support, watcher).shot.canShoot).toBe(true);
    const before = checkOverwatch(map, watcher, mover, { x: 4, y: 2 }, { x: 4, y: 1 });
    expect(before.fires).toBe(true);

    expect(performAction(map, support, "suppress", watcher, () => 0).ok).toBe(true);
    expect(watcher.overwatch).toBe(false);

    const after = checkOverwatch(map, watcher, mover, { x: 4, y: 2 }, { x: 4, y: 1 });
    expect(after.fires).toBe(false);
  });

  it("costs the same action points the overwatch it removes did", () => {
    const { map, support, watcher } = watchedCorridor();
    const before = support.ap;
    performAction(map, support, "suppress", watcher, () => 0);
    expect(before - support.ap).toBe(2);
    expect(isSuppressed(watcher)).toBe(true);
  });

  it("leaves bypassing available as the alternative that costs nothing", () => {
    const { map, mover, watcher } = watchedCorridor();
    expect(checkOverwatch(map, watcher, mover, { x: 4, y: 4 }, { x: 3, y: 3 }).fires)
      .toBe(false);
  });
});
