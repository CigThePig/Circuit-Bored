import { describe, expect, it } from "vitest";
import {
  EXPOSED_ACCURACY_BONUS,
  EXPOSED_DAMAGE_BONUS,
  SHOT_DAMAGE,
  canShootTarget,
  exposedAgainst,
  hasAdjacentCover,
  isCrossfireAngle,
  previewShot,
  resolveShot,
} from "../src/combat.ts";
import { EMPTY_COMBAT_PROFILE } from "../src/map.ts";
import { buildMap } from "./fixtures.ts";

const alwaysHit = () => 0;

describe("Exposed geometry", () => {
  it("does not treat a unit merely standing in the open as Exposed", () => {
    // No terrain anywhere near the target: nothing was outmanoeuvred.
    const map = buildMap([
      "......",
      "......",
      "......",
    ], [
      { team: "player", x: 0, y: 1 },
      { team: "enemy", x: 5, y: 1 },
    ]);
    const [player, enemy] = map.units;
    expect(hasAdjacentCover(map, enemy.x, enemy.y)).toBe(false);
    expect(exposedAgainst(map, player, enemy)).toBeNull();
    expect(previewShot(map, player, enemy).exposed).toBeNull();
  });

  it("does not report Exposed while the target's cover still faces the shooter", () => {
    // Half cover on the target's west side; the shooter is due west.
    const map = buildMap([
      "..h...",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    const [player, enemy] = map.units;
    expect(exposedAgainst(map, player, enemy)).toBeNull();
  });

  it("reports 'flanked' once the shooter goes around that same cover", () => {
    // Identical board; the shooter now bears from the south, where the target
    // has nothing.
    const map = buildMap([
      "...h..",
      "......",
      "...e..",
      "......",
    ], [
      { team: "player", x: 3, y: 3 },
      { team: "enemy", x: 3, y: 2 },
    ]);
    const [player, enemy] = map.units;
    expect(hasAdjacentCover(map, enemy.x, enemy.y)).toBe(false);
    // Move the enemy up against its cover to make the flank meaningful.
    enemy.y = 1;
    expect(hasAdjacentCover(map, enemy.x, enemy.y)).toBe(true);
    expect(exposedAgainst(map, player, enemy)).toBe("flanked");
  });

  it("reports 'committed_peek' against a target that leaned out", () => {
    const map = buildMap([
      "..#..",
      "..#..",
      "..#..",
      ".....",
    ], [
      { team: "player", x: 1, y: 2 },
      { team: "enemy", x: 4, y: 3 },
    ]);
    const [player, enemy] = map.units;
    // The player peek-shoots, committing a silhouette at the corner.
    resolveShot(map, player, enemy, alwaysHit);
    expect(player.peekExposure).not.toBeNull();
    expect(exposedAgainst(map, enemy, player)).toBe("committed_peek");
  });

  it("ignores a committed lean whose tile is not a legal peek any more", () => {
    const map = buildMap([
      ".....",
      ".....",
    ], [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 4, y: 1 },
    ]);
    const [player, enemy] = map.units;
    player.peekExposure = { x: 2, y: 0 };
    expect(exposedAgainst(map, enemy, player)).toBeNull();
  });
});

describe("Crossfire", () => {
  it("measures the angle between two shooters at the target", () => {
    const target = { x: 5, y: 5 };
    expect(isCrossfireAngle({ x: 0, y: 5 }, { x: 10, y: 5 }, target)).toBe(true);
    expect(isCrossfireAngle({ x: 0, y: 5 }, { x: 5, y: 0 }, target)).toBe(true);
    // Shoulder to shoulder on the same side is not a crossfire.
    expect(isCrossfireAngle({ x: 0, y: 5 }, { x: 0, y: 6 }, target)).toBe(false);
    expect(isCrossfireAngle({ x: 5, y: 5 }, { x: 0, y: 5 }, target)).toBe(false);
  });

  it("Exposes a target caught between two squadmates on different sides", () => {
    const map = buildMap([
      ".......",
      ".......",
      ".......",
    ], [
      { team: "player", x: 0, y: 1 },
      { team: "player", x: 6, y: 1 },
      { team: "enemy", x: 3, y: 1 },
    ]);
    const [west, east, enemy] = map.units;
    expect(exposedAgainst(map, west, enemy)).toBe("crossfire");
    expect(exposedAgainst(map, east, enemy)).toBe("crossfire");
  });

  it("does not Expose a target when both squadmates stand on the same side", () => {
    const map = buildMap([
      ".......",
      ".......",
      ".......",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "player", x: 0, y: 2 },
      { team: "enemy", x: 5, y: 1 },
    ]);
    const [, , enemy] = map.units;
    expect(exposedAgainst(map, map.units[0], enemy)).toBeNull();
  });

  it("does not count a squadmate with no firing line of its own", () => {
    // The western operator's line to the enemy runs into a wall, and it has no
    // adjacent wall to lean around, so it contributes no angle.
    const map = buildMap([
      ".......",
      "..#....",
      ".......",
      ".......",
    ], [
      { team: "player", x: 4, y: 3 },
      { team: "player", x: 0, y: 1 },
      { team: "enemy", x: 4, y: 1 },
    ]);
    const [south, blocked, enemy] = map.units;
    expect(isCrossfireAngle(blocked, south, enemy)).toBe(true);
    expect(canShootTarget(map, blocked, enemy).canShoot).toBe(false);
    expect(exposedAgainst(map, south, enemy)).toBeNull();
  });

  it("does not count a dead squadmate", () => {
    const map = buildMap([
      ".......",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "player", x: 6, y: 0, hp: 0 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    const [west, , enemy] = map.units;
    expect(exposedAgainst(map, west, enemy)).toBeNull();
  });
});

describe("Exposed payoff", () => {
  it("adds accuracy and a point of damage rather than only restoring accuracy", () => {
    const flanked = buildMap([
      "...h..",
      "...e..",
      "......",
      "...p..",
    ], [
      { team: "player", x: 3, y: 3 },
      { team: "enemy", x: 3, y: 1 },
    ]);
    const [player, enemy] = flanked.units;
    const preview = previewShot(flanked, player, enemy);
    expect(preview.exposed).toBe("flanked");
    expect(preview.hadCover).toBe(false);
    expect(preview.bonusDamage).toBe(EXPOSED_DAMAGE_BONUS);
    expect(preview.damage).toBe(SHOT_DAMAGE + EXPOSED_DAMAGE_BONUS);

    // The same shot against a target with no cover at all gets neither bonus:
    // baseline accuracy is what an ordinary open shot already had.
    const open = buildMap([
      "......",
      "...e..",
      "......",
      "...p..",
    ], [
      { team: "player", x: 3, y: 3 },
      { team: "enemy", x: 3, y: 1 },
    ]);
    const plain = previewShot(open, open.units[0], open.units[1]);
    expect(plain.exposed).toBeNull();
    expect(preview.hitChance - plain.hitChance).toBeCloseTo(EXPOSED_ACCURACY_BONUS, 6);
    expect(preview.damage - plain.damage).toBe(EXPOSED_DAMAGE_BONUS);
  });

  it("deals the previewed damage when the shot resolves", () => {
    const map = buildMap([
      "...h..",
      "...e..",
      "......",
      "...p..",
    ], [
      { team: "player", x: 3, y: 3 },
      { team: "enemy", x: 3, y: 1 },
    ]);
    const [player, enemy] = map.units;
    const preview = previewShot(map, player, enemy);
    const before = enemy.hp;
    const result = resolveShot(map, player, enemy, alwaysHit);
    expect(result.hit).toBe(true);
    expect(result.exposed).toBe(preview.exposed);
    expect(result.damage).toBe(preview.damage);
    expect(before - enemy.hp).toBe(preview.damage);
  });

  it("still respects the target's damage reduction", () => {
    const map = buildMap([
      "...h..",
      "...e..",
      "......",
      "...p..",
    ], [
      { team: "player", x: 3, y: 3 },
      { team: "enemy", x: 3, y: 1 },
    ]);
    const [player, enemy] = map.units;
    enemy.combat = { ...EMPTY_COMBAT_PROFILE, damageReduction: 2 };
    const preview = previewShot(map, player, enemy);
    expect(preview.damage).toBe(SHOT_DAMAGE + EXPOSED_DAMAGE_BONUS - 2);
  });
});
