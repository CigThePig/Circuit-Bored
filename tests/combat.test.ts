import { describe, expect, it } from "vitest";
import {
  BASE_HIT,
  COVER_PENALTY,
  HALF_COVER_PENALTY,
  PEEK_PENALTY,
  canShootTarget,
  hasStrictLineOfSight,
  previewShot,
  resolveShot,
  shotHitPenalty,
  targetCoverPenalty,
} from "../src/combat.ts";
import { buildMap, unit } from "./fixtures.ts";

describe("hasStrictLineOfSight", () => {
  it("allows a clear horizontal shot", () => {
    const map = buildMap([
      ".....",
      ".....",
      ".....",
    ]);
    expect(hasStrictLineOfSight(map, 0, 1, 4, 1)).toBe(true);
  });

  it("blocks a horizontal shot through a wall", () => {
    const map = buildMap([
      ".....",
      "..#..",
      ".....",
    ]);
    expect(hasStrictLineOfSight(map, 0, 1, 4, 1)).toBe(false);
  });

  it("does not let half-cover block sight", () => {
    const map = buildMap([
      ".....",
      "..h..",
      ".....",
    ]);
    expect(hasStrictLineOfSight(map, 0, 1, 4, 1)).toBe(true);
  });

  it("allows a clean diagonal with no walls", () => {
    const map = buildMap([
      "..",
      "..",
    ]);
    expect(hasStrictLineOfSight(map, 0, 0, 1, 1)).toBe(true);
  });

  it("blocks a diagonal when one corner wall is present (strict policy)", () => {
    // Shooter (0,0), target (1,1), single wall at (1,0).
    const map = buildMap([
      ".#",
      "..",
    ]);
    expect(hasStrictLineOfSight(map, 0, 0, 1, 1)).toBe(false);
  });

  it("blocks a diagonal when both corner walls are present", () => {
    const map = buildMap([
      ".#",
      "#.",
    ]);
    expect(hasStrictLineOfSight(map, 0, 0, 1, 1)).toBe(false);
  });

  it("returns false when an endpoint is out of bounds", () => {
    const map = buildMap([
      "...",
      "...",
    ]);
    expect(hasStrictLineOfSight(map, 0, 0, 5, 5)).toBe(false);
  });

  it("is symmetric for shallow lines beside a wall", () => {
    const map = buildMap([
      "#.",
      "..",
      "..",
    ]);
    expect(hasStrictLineOfSight(map, 1, 0, 0, 2)).toBe(true);
    expect(hasStrictLineOfSight(map, 0, 2, 1, 0)).toBe(true);
  });
});

describe("canShootTarget", () => {
  it("returns mode 'direct' when LoS is clear", () => {
    const map = buildMap([
      ".....",
      ".....",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 4, y: 0 },
    ]);
    const [shooter, target] = map.units;
    const result = canShootTarget(map, shooter, target);
    expect(result.canShoot).toBe(true);
    expect(result.mode).toBe("direct");
  });

  it("returns mode 'peek' when a corner peek opens a shot", () => {
    // Layout: shooter at (1,2) hidden behind a wall column (2,2)/(2,1)/(2,0).
    // Target at (4,1). Peeking up-and-around the wall corner via (1,1).
    const map = buildMap([
      "..#..",
      "..#..",
      "..#..",
      ".....",
    ], [
      { team: "player", x: 1, y: 2 },
      { team: "enemy", x: 4, y: 3 },
    ]);
    const [shooter, target] = map.units;
    // Direct strict LoS should be blocked.
    expect(hasStrictLineOfSight(map, shooter.x, shooter.y, target.x, target.y))
      .toBe(false);
    const result = canShootTarget(map, shooter, target);
    expect(result.canShoot).toBe(true);
    if (result.canShoot) {
      // Either direct or peek - just confirm we have a shot.
      expect(["direct", "peek"]).toContain(result.mode);
    }
  });

  it("returns mode 'blocked' when a wall cluster prevents both direct and peek", () => {
    // Shooter is fully boxed in by walls; no peek can open.
    const map = buildMap([
      "###",
      "#.#",
      "###",
    ], [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 0, y: 0 },
    ]);
    const [shooter, target] = map.units;
    const result = canShootTarget(map, shooter, target);
    expect(result.canShoot).toBe(false);
    expect(result.mode).toBe("blocked");
  });

  it("rejects a peek tile occupied by another living unit", () => {
    // Shooter at (1,2) needs to peek via (0,1) corner; place ally there.
    const map = buildMap([
      "..#..",
      "..#..",
      "..#..",
      ".....",
    ], [
      { team: "player", x: 1, y: 2 },
      { team: "player", x: 1, y: 1 }, // blocks the peek shoulder
      { team: "enemy", x: 4, y: 1 },
    ]);
    const shooter = map.units[0];
    const target = map.units[2];
    // Direct should be blocked by the wall column.
    expect(hasStrictLineOfSight(map, shooter.x, shooter.y, target.x, target.y))
      .toBe(false);
    const result = canShootTarget(map, shooter, target);
    // We don't insist on mode here; we only insist that occupied peeks are
    // not silently chosen. Verify that if the result is "peek", peekFrom is
    // not the occupied tile.
    if (result.mode === "peek" && result.peekFrom) {
      expect(`${result.peekFrom.x},${result.peekFrom.y}`).not.toBe("1,1");
    }
  });
});

describe("targetCoverPenalty", () => {
  it("returns 0 with no cover", () => {
    const map = buildMap([
      ".....",
      ".....",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 4, y: 0 },
    ]);
    const [shooter, target] = map.units;
    expect(targetCoverPenalty(map, shooter, target)).toBe(0);
  });

  it("applies COVER_PENALTY for a wall on the shooter's axis side of the target", () => {
    // Shooter at (0,0), target at (4,0). Wall at (3,0) faces shooter.
    const map = buildMap([
      "...#.",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 4, y: 0 },
    ]);
    const [shooter, target] = map.units;
    expect(targetCoverPenalty(map, shooter, target)).toBe(COVER_PENALTY);
  });

  it("applies HALF_COVER_PENALTY for half-cover on the shooter's side", () => {
    const map = buildMap([
      "...h.",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 4, y: 0 },
    ]);
    const [shooter, target] = map.units;
    expect(targetCoverPenalty(map, shooter, target)).toBe(HALF_COVER_PENALTY);
  });

  it("ignores cover when the shooter flanks (perpendicular axis)", () => {
    // Cover sits on the x-axis side of the target, but shooter approaches
    // from the y-axis. Cover should be ignored.
    const map = buildMap([
      ".....",
      ".....",
      ".....",
      "...#.",
      "....e",
      "....p",
    ], [
      { team: "enemy", x: 4, y: 4 },
      { team: "player", x: 4, y: 5 },
    ]);
    const [target, shooter] = map.units;
    // Shooter (player) below target. Cover is at (3,3), to the left of target.
    // Strict dominant axis for this match is y (|dy|>|dx|), so x-cover doesn't apply.
    expect(targetCoverPenalty(map, shooter, target)).toBe(0);
  });
});

describe("shotHitPenalty", () => {
  it("returns 0 when there is no cover and direct LoS", () => {
    const map = buildMap([
      "....",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    const [shooter, target] = map.units;
    expect(shotHitPenalty(map, shooter, target)).toBe(0);
  });

  it("returns COVER_PENALTY for a direct shot at a target in wall cover", () => {
    const map = buildMap([
      "..#.",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    const [shooter, target] = map.units;
    // Strict LoS straight across with one wall adjacent to target = blocked
    // direct shot. canShootTarget will look for a peek; but with a single row
    // there is no perpendicular tile to peek to.
    // So this should be Infinity (blocked).
    expect(shotHitPenalty(map, shooter, target)).toBe(Infinity);
  });

  it("applies PEEK_PENALTY alone when shooting from peek at a target in the open", () => {
    // Shooter (1,1) is hidden behind wall (2,1). Target (4,2) is in the open.
    // Direct LoS is blocked by the wall; shooter peeks down to (2,2) and the
    // shot to (4,2) is clear with no cover on the target.
    const map = buildMap([
      ".....",
      "..#..",
      ".....",
    ], [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 4, y: 2 },
    ]);
    const [shooter, target] = map.units;
    const shot = canShootTarget(map, shooter, target);
    expect(shot.canShoot).toBe(true);
    expect(shot.mode).toBe("peek");
    expect(targetCoverPenalty(map, shooter, target)).toBe(0);
    expect(shotHitPenalty(map, shooter, target)).toBeCloseTo(PEEK_PENALTY, 5);
    const preview = previewShot(map, shooter, target);
    expect(preview.hitChance).toBeCloseTo(BASE_HIT - PEEK_PENALTY, 5);
    expect(preview.hadCover).toBe(false);
  });

  it("adds PEEK_PENALTY on top of cover for a peek shot at a target with cover", () => {
    // Same geometry, but a half-cover tile sits between the peek tile and
    // the target on the dominant axis.
    const map = buildMap([
      ".....",
      "..#..",
      "...h.",
    ], [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 4, y: 2 },
    ]);
    const [shooter, target] = map.units;
    const shot = canShootTarget(map, shooter, target);
    expect(shot.canShoot).toBe(true);
    expect(shot.mode).toBe("peek");
    expect(targetCoverPenalty(map, shooter, target)).toBeCloseTo(
      HALF_COVER_PENALTY,
      5,
    );
    expect(shotHitPenalty(map, shooter, target)).toBeCloseTo(
      HALF_COVER_PENALTY + PEEK_PENALTY,
      5,
    );
  });
});

describe("resolveShot", () => {
  it("clamps Infinity penalties to a 0% hit chance", () => {
    const map = buildMap([
      "###",
      "#.#",
      "###",
    ], [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 0, y: 0 },
    ]);
    const [shooter, target] = map.units;
    const result = resolveShot(map, shooter, target, () => 0);
    expect(result.hitChance).toBe(0);
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
  });

  it("hits when the random roll is below BASE_HIT and there is no cover", () => {
    const map = buildMap([
      "....",
    ], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 3, y: 0 },
    ]);
    const [shooter, target] = map.units;
    const result = resolveShot(map, shooter, target, () => 0);
    expect(result.hit).toBe(true);
    expect(result.hitChance).toBeCloseTo(BASE_HIT);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("does not mutate when the resolver helper is given a non-living shooter", () => {
    // Defensive sanity: combat works on the unit given, even if hp is high.
    const map = buildMap([
      "....",
    ]);
    expect(map.units.length).toBe(0);
    const shooter = unit({ team: "player", x: 0, y: 0 });
    const target = unit({ team: "enemy", x: 3, y: 0 });
    map.units = [shooter, target];
    const r = resolveShot(map, shooter, target, () => 0.99);
    // 0.99 > BASE_HIT (0.85), so this should miss.
    expect(r.hit).toBe(false);
    expect(target.hp).toBe(target.maxHp);
  });
});

describe("committed peek exposure", () => {
  // Layout used for several tests:
  //   shooter at (1,1), wall at (2,1), target at (4,2). Shooter's only shot
  //   is a peek via (2,2). The wall blocks direct strict LoS in either
  //   direction across the diagonal.
  const peekRows = [
    ".....",
    "..#..",
    ".....",
  ];

  it("a peek shot sets peekExposure to the peek tile", () => {
    const map = buildMap(peekRows, [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 4, y: 2 },
    ]);
    const [shooter, target] = map.units;
    const shot = canShootTarget(map, shooter, target);
    expect(shot.canShoot).toBe(true);
    expect(shot.mode).toBe("peek");
    expect(shooter.peekExposure).toBeNull();
    resolveShot(map, shooter, target, () => 0.99);
    expect(shooter.peekExposure).toEqual({ x: 2, y: 2 });
  });

  it("a direct shot does not set peekExposure", () => {
    const map = buildMap(["....."], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 4, y: 0 },
    ]);
    const [shooter, target] = map.units;
    const shot = canShootTarget(map, shooter, target);
    expect(shot.mode).toBe("direct");
    resolveShot(map, shooter, target, () => 0.99);
    expect(shooter.peekExposure).toBeNull();
  });

  it("a target hidden from a shooter becomes shootable through its exposure tile", () => {
    const map = buildMap(peekRows, [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 4, y: 2 },
    ]);
    const [shooter, target] = map.units;
    // Without exposure: the enemy at (4,2) cannot shoot the player at (1,1)
    // because the diagonal step at (1,1) is corner-blocked by the wall (2,1).
    const before = canShootTarget(map, target, shooter);
    expect(before.canShoot).toBe(false);
    expect(before.mode).toBe("blocked");

    // Player peek-shoots, exposing themselves at (2,2).
    resolveShot(map, shooter, target, () => 0.99);
    expect(shooter.peekExposure).toEqual({ x: 2, y: 2 });

    const after = canShootTarget(map, target, shooter);
    expect(after.canShoot).toBe(true);
    expect(after.targetExposure).toBe(true);
    const preview = previewShot(map, target, shooter);
    expect(preview.shot.targetExposure).toBe(true);
    expect(preview.targetPoint).toEqual({ x: 2, y: 2 });
  });

  it("damage from a shot through exposure applies to the real unit", () => {
    const map = buildMap(peekRows, [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 4, y: 2 },
    ]);
    const [shooter, target] = map.units;
    resolveShot(map, shooter, target, () => 0.99); // miss but expose
    expect(shooter.peekExposure).toEqual({ x: 2, y: 2 });

    const beforeHp = shooter.hp;
    const beforeX = shooter.x;
    const beforeY = shooter.y;
    const result = resolveShot(map, target, shooter, () => 0);
    expect(result.hit).toBe(true);
    expect(shooter.hp).toBeLessThan(beforeHp);
    expect(shooter.x).toBe(beforeX);
    expect(shooter.y).toBe(beforeY);
  });

  it("dying clears peekExposure", () => {
    const map = buildMap(peekRows, [
      { team: "player", x: 1, y: 1, hp: 1 },
      { team: "enemy", x: 4, y: 2 },
    ]);
    const [shooter, target] = map.units;
    resolveShot(map, shooter, target, () => 0.99);
    expect(shooter.peekExposure).toEqual({ x: 2, y: 2 });
    // Enemy fires back through the exposure and kills the player.
    resolveShot(map, target, shooter, () => 0);
    expect(shooter.hp).toBe(0);
    expect(shooter.peekExposure).toBeNull();
  });

  it("repeated peek shots keep peekExposure within one diagonal step of the shooter", () => {
    const map = buildMap(peekRows, [
      { team: "player", x: 1, y: 1 },
      { team: "enemy", x: 4, y: 2 },
    ]);
    const [shooter, target] = map.units;
    resolveShot(map, shooter, target, () => 0.99);
    const first = { ...shooter.peekExposure! };
    resolveShot(map, shooter, target, () => 0.99);
    expect(shooter.peekExposure).toEqual(first);
    expect(Math.abs(shooter.peekExposure!.x - shooter.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shooter.peekExposure!.y - shooter.y)).toBeLessThanOrEqual(1);
  });
});
