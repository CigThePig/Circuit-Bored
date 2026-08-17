import { describe, expect, it } from "vitest";
import {
  ACTION_TRAY_ORDER,
  actionEligibility,
  availableActions,
  AIM_AP_COST,
  getAction,
  hasAnyTarget,
  HUNKER_AP_COST,
  OVERWATCH_AP_COST,
  performAction,
  SHOOT_AP_COST,
  SUPPRESS_AP_COST,
} from "../src/actions.ts";
import {
  AIM_ACCURACY_BONUS,
  HUNKER_COVER_BONUS,
  HUNKER_OPEN_BONUS,
  previewShot,
  SUPPRESSED_ACCURACY_PENALTY,
} from "../src/combat.ts";
import { beginUnitTurn, endUnitTurn, onUnitMoved } from "../src/rules.ts";
import { createStatuses, isAimed, isHunkered, isSuppressed } from "../src/status.ts";
import { buildMap } from "./fixtures.ts";

const always = () => 0;

function duel(rows: string[], px: number, py: number, ex: number, ey: number) {
  const map = buildMap(rows, [
    { team: "player", x: px, y: py },
    { team: "enemy", x: ex, y: ey },
  ]);
  return { map, player: map.units[0], enemy: map.units[1] };
}

describe("action costs", () => {
  it("charges the advertised cost and nothing else", () => {
    const cases: [Parameters<typeof getAction>[0], number][] = [
      ["shoot", SHOOT_AP_COST],
      ["aim", AIM_AP_COST],
      ["hunker", HUNKER_AP_COST],
      ["suppress", SUPPRESS_AP_COST],
      ["overwatch", OVERWATCH_AP_COST],
    ];
    for (const [id, cost] of cases) {
      const { map, player, enemy } = duel(["......", "......"], 0, 0, 5, 0);
      const target = getAction(id).targeting === "enemy" ? enemy : null;
      const before = player.ap;
      const outcome = performAction(map, player, id, target, always);
      expect(outcome.ok, `${id} should resolve`).toBe(true);
      expect(getAction(id).apCost).toBe(cost);
      expect(before - player.ap).toBe(cost);
    }
  });

  it("keeps the remaining turn intact when entering overwatch", () => {
    const { map, player } = duel(["......", "......"], 0, 0, 5, 0);
    player.ap = 4;
    expect(performAction(map, player, "overwatch").ok).toBe(true);
    expect(player.ap).toBe(4 - OVERWATCH_AP_COST);
    expect(player.overwatch).toBe(true);
  });

  it("refuses an action the unit cannot pay for and spends nothing", () => {
    const { map, player, enemy } = duel(["......", "......"], 0, 0, 5, 0);
    player.ap = 1;
    const outcome = performAction(map, player, "suppress", enemy, always);
    expect(outcome).toEqual({ ok: false, reason: `Needs ${SUPPRESS_AP_COST} AP.` });
    expect(player.ap).toBe(1);
    expect(isSuppressed(enemy)).toBe(false);
  });
});

describe("action eligibility", () => {
  it("refuses a shot with no firing line without charging AP", () => {
    const { map, player, enemy } = duel([
      "..#..",
      "..#..",
    ], 0, 0, 4, 0);
    const before = player.ap;
    expect(actionEligibility(map, player, "shoot", enemy).ok).toBe(false);
    expect(performAction(map, player, "shoot", enemy, always).ok).toBe(false);
    expect(player.ap).toBe(before);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it("refuses to suppress through a wall", () => {
    const { map, player, enemy } = duel([
      "..#..",
      "..#..",
    ], 0, 0, 4, 0);
    expect(performAction(map, player, "suppress", enemy, always).ok).toBe(false);
    expect(isSuppressed(enemy)).toBe(false);
    expect(player.ap).toBe(player.maxAp);
  });

  it("refuses a targeted action with no target selected", () => {
    const { map, player } = duel(["......"], 0, 0, 5, 0);
    expect(performAction(map, player, "suppress", null, always))
      .toEqual({ ok: false, reason: "Select a hostile." });
  });

  it("refuses to target a friendly unit", () => {
    const map = buildMap(["......"], [
      { team: "player", x: 0, y: 0 },
      { team: "player", x: 2, y: 0 },
      { team: "enemy", x: 5, y: 0 },
    ]);
    const [a, b] = map.units;
    expect(performAction(map, a, "suppress", b, always).ok).toBe(false);
  });

  it("refuses to aim, suppress, or watch while suppressed", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    player.statuses = { ...createStatuses(), suppressed: 1 };
    expect(actionEligibility(map, player, "aim").ok).toBe(false);
    expect(actionEligibility(map, player, "suppress", enemy).ok).toBe(false);
    expect(actionEligibility(map, player, "overwatch").ok).toBe(false);
    // Hunkering down is exactly what a pinned unit can still do.
    expect(actionEligibility(map, player, "hunker").ok).toBe(true);
    // And it can still return fire, just badly.
    expect(actionEligibility(map, player, "shoot", enemy).ok).toBe(true);
  });

  it("refuses to repeat a status the unit already carries", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    expect(performAction(map, player, "aim", null, always).ok).toBe(true);
    expect(actionEligibility(map, player, "aim").ok).toBe(false);
    expect(performAction(map, player, "suppress", enemy, always).ok).toBe(true);
    expect(actionEligibility(map, player, "suppress", enemy).ok).toBe(false);
  });

  it("reports the tray with cost, availability, and a reason for each entry", () => {
    const { map, player } = duel(["......"], 0, 0, 5, 0);
    player.ap = 1;
    const tray = availableActions(map, player);
    // A unit with no archetype gets the shared toolkit and none of the role
    // abilities, which is what keeps an operator's tray about its own job.
    expect(tray.map((entry) => entry.action.id))
      .toEqual(ACTION_TRAY_ORDER.filter((id) => !getAction(id).archetypes));
    for (const entry of tray) {
      expect(entry.action.apCost).toBeGreaterThan(0);
      expect(entry.preview.detail.length).toBeGreaterThan(0);
      expect(entry.action.description.length).toBeGreaterThan(0);
      if (!entry.eligibility.ok) expect(entry.eligibility.reason.length).toBeGreaterThan(0);
    }
    const suppress = tray.find((entry) => entry.action.id === "suppress")!;
    expect(suppress.eligibility).toEqual({ ok: false, reason: "Needs 2 AP." });
  });

  it("marks a targeted action unavailable when nothing can be targeted", () => {
    const { map, player } = duel([
      "..#..",
      "..#..",
    ], 0, 0, 4, 0);
    expect(hasAnyTarget(map, player, "suppress")).toBe(false);
    const suppress = availableActions(map, player)
      .find((entry) => entry.action.id === "suppress")!;
    expect(suppress.eligibility).toEqual({ ok: false, reason: "No valid target." });
    expect(hasAnyTarget(map, player, "aim")).toBe(true);
  });
});

describe("Aim", () => {
  it("raises the hit chance of the next shot by the aim bonus", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    const before = previewShot(map, player, enemy).hitChance;
    performAction(map, player, "aim", null, always);
    const after = previewShot(map, player, enemy);
    expect(after.usesAim).toBe(true);
    expect(after.hitChance).toBeCloseTo(Math.min(0.98, before + AIM_ACCURACY_BONUS), 6);
  });

  it("is consumed by the shot it prepared", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    performAction(map, player, "aim", null, always);
    expect(isAimed(player)).toBe(true);
    performAction(map, player, "shoot", enemy, always);
    expect(isAimed(player)).toBe(false);
    expect(previewShot(map, player, enemy).usesAim).toBe(false);
  });

  it("is consumed even when the prepared shot misses", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    performAction(map, player, "aim", null, always);
    const outcome = performAction(map, player, "shoot", enemy, () => 0.999);
    expect(outcome.ok).toBe(true);
    expect(isAimed(player)).toBe(false);
  });

  it("is cancelled by moving", () => {
    const { map, player } = duel(["......"], 0, 0, 5, 0);
    performAction(map, player, "aim", null, always);
    onUnitMoved(player);
    expect(isAimed(player)).toBe(false);
  });

  it("expires at the start of the unit's next turn if unused", () => {
    const { map, player } = duel(["......"], 0, 0, 5, 0);
    performAction(map, player, "aim", null, always);
    endUnitTurn(player);
    beginUnitTurn(player);
    expect(isAimed(player)).toBe(false);
  });

  it("survives an unrelated shot taken by somebody else", () => {
    const map = buildMap(["......"], [
      { team: "player", x: 0, y: 0 },
      { team: "player", x: 1, y: 0 },
      { team: "enemy", x: 5, y: 0 },
    ]);
    const [aimer, other, enemy] = map.units;
    performAction(map, aimer, "aim", null, always);
    performAction(map, other, "shoot", enemy, always);
    expect(isAimed(aimer)).toBe(true);
  });
});

describe("Hunker", () => {
  it("deepens cover that actually faces the shooter", () => {
    // Enemy due east; the half cover on the target's east side is real cover
    // against it, and unlike a wall it does not also block the firing line.
    const { map, player, enemy } = duel([
      ".h....",
    ], 0, 0, 3, 0);
    const before = previewShot(map, enemy, player).hitChance;
    performAction(map, player, "hunker", null, always);
    const after = previewShot(map, enemy, player);
    expect(after.targetHunkered).toBe(true);
    expect(before - after.hitChance).toBeCloseTo(HUNKER_COVER_BONUS, 6);
  });

  it("is nearly worthless with no cover at all", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    const before = previewShot(map, enemy, player).hitChance;
    performAction(map, player, "hunker", null, always);
    const after = previewShot(map, enemy, player);
    expect(after.targetHunkered).toBe(false);
    expect(before - after.hitChance).toBeCloseTo(HUNKER_OPEN_BONUS, 6);
    expect(HUNKER_OPEN_BONUS).toBeLessThan(HUNKER_COVER_BONUS / 2);
  });

  it("gives no extra protection against a shooter who flanked the cover", () => {
    // Cover to the north; the shooter comes from due south, so it is beaten.
    const { map, player, enemy } = duel([
      "#.....",
      "......",
      "......",
    ], 0, 1, 0, 2);
    performAction(map, player, "hunker", null, always);
    const flanking = previewShot(map, enemy, player);
    expect(flanking.hadCover).toBe(false);
    expect(flanking.targetHunkered).toBe(false);
  });

  it("clears a committed lean", () => {
    const { map, player } = duel(["......"], 0, 0, 5, 0);
    player.peekExposure = { x: 1, y: 1 };
    performAction(map, player, "hunker", null, always);
    expect(player.peekExposure).toBeNull();
  });

  it("lasts through the opposing turn and clears at the unit's next turn", () => {
    const { map, player } = duel([".h...."], 0, 0, 3, 0);
    performAction(map, player, "hunker", null, always);
    expect(isHunkered(player)).toBe(true);
    endUnitTurn(player);
    expect(isHunkered(player)).toBe(true);
    beginUnitTurn(player);
    expect(isHunkered(player)).toBe(false);
  });
});

describe("Suppress", () => {
  it("applies the status without dealing damage", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    const outcome = performAction(map, player, "suppress", enemy, always);
    expect(outcome.ok).toBe(true);
    expect(isSuppressed(enemy)).toBe(true);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it("costs the target accuracy on its shots", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    const before = previewShot(map, enemy, player).hitChance;
    performAction(map, player, "suppress", enemy, always);
    const after = previewShot(map, enemy, player);
    expect(after.shooterSuppressed).toBe(true);
    expect(before - after.hitChance).toBeCloseTo(SUPPRESSED_ACCURACY_PENALTY, 6);
  });

  it("costs the target an action point on its next turn", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    performAction(map, player, "suppress", enemy, always);
    beginUnitTurn(enemy);
    expect(enemy.ap).toBe(enemy.maxAp - 1);
  });

  it("breaks an overwatch the target was holding", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    enemy.overwatch = true;
    performAction(map, player, "suppress", enemy, always);
    expect(enemy.overwatch).toBe(false);
  });

  it("lasts exactly one turn of the suppressed unit", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    performAction(map, player, "suppress", enemy, always);
    // The player's own turn ending must not consume the enemy's suppression.
    endUnitTurn(player);
    expect(isSuppressed(enemy)).toBe(true);
    beginUnitTurn(enemy);
    expect(isSuppressed(enemy)).toBe(true);
    endUnitTurn(enemy);
    expect(isSuppressed(enemy)).toBe(false);
    beginUnitTurn(enemy);
    expect(enemy.ap).toBe(enemy.maxAp);
  });

  it("works at the rule layer with the roles reversed", () => {
    const { map, player, enemy } = duel(["......"], 0, 0, 5, 0);
    const outcome = performAction(map, enemy, "suppress", player, always);
    expect(outcome.ok).toBe(true);
    expect(isSuppressed(player)).toBe(true);
  });

  it("commits the suppressor's lean when it fires from a peek", () => {
    // Shooter tucked behind a wall column; the only line is around the corner.
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
    const outcome = performAction(map, player, "suppress", enemy, always);
    expect(outcome.ok).toBe(true);
    expect(player.peekExposure).not.toBeNull();
    expect(Math.abs(player.peekExposure!.x - player.x)).toBe(1);
    expect(Math.abs(player.peekExposure!.y - player.y)).toBe(1);
  });
});
