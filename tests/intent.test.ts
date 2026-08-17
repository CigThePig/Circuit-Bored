import { describe, expect, it } from "vitest";
import {
  beginEnemyTurn,
  planEnemyIntent,
  refreshEnemyIntents,
  takeEnemyAction,
} from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";
import {
  intentCounterHint,
  intentLabel,
  intentsEqual,
  isValidIntent,
  makeIntent,
  sanitizeIntent,
} from "../src/intent.ts";
import { applySuppression, previewShot } from "../src/combat.ts";
import { performAction } from "../src/actions.ts";
import { beginUnitTurn } from "../src/rules.ts";
import { isAimed } from "../src/status.ts";
import { cloneMap, setTile } from "../src/map.ts";
import { sanitizeLoadedMap, validateMap } from "../src/validation.ts";
import { makeArchetypeUnit, type UnitArchetypeId } from "../src/content.ts";
import { buildMap } from "./fixtures.ts";

/** A long open lane with one hostile of the given type facing one operator. */
function lane(enemyId: UnitArchetypeId, gap = 12) {
  const map = buildMap([
    ".".repeat(gap + 4),
    ".".repeat(gap + 4),
    ".".repeat(gap + 4),
  ]);
  const player = makeArchetypeUnit("operator", "rook", 1, 1);
  const enemy = makeArchetypeUnit(enemyId, "foe", 1 + gap, 1);
  map.units.push(player, enemy);
  return { map, player, enemy };
}

describe("intent shape", () => {
  it("renders a label and a counter for every plan it can hold", () => {
    const kinds = ["engage", "aim", "close", "reposition", "overwatch", "suppress", "hold"] as const;
    for (const kind of kinds) {
      const intent = makeIntent(kind, "u", { x: 1, y: 1 });
      expect(intentLabel(intent, "VEX"), kind).toBeTruthy();
      expect(intentCounterHint(intent), kind).toBeTruthy();
    }
    // An idle plan is nothing to report, so it renders as nothing at all.
    expect(intentLabel(makeIntent("idle"), null)).toBeNull();
    expect(intentLabel(undefined, null)).toBeNull();
  });

  it("keeps banner text short enough not to swamp the board", () => {
    const kinds = ["engage", "aim", "close", "reposition", "overwatch", "suppress", "hold"] as const;
    for (const kind of kinds) {
      const label = intentLabel(makeIntent(kind, "u"), "MARKSMAN")!;
      expect(label.length, label).toBeLessThanOrEqual(22);
    }
  });

  it("compares plans by value", () => {
    expect(intentsEqual(makeIntent("aim", "a", { x: 1, y: 2 }), makeIntent("aim", "a", { x: 1, y: 2 }))).toBe(true);
    expect(intentsEqual(makeIntent("aim", "a"), makeIntent("aim", "b"))).toBe(false);
    expect(intentsEqual(undefined, undefined)).toBe(true);
    expect(intentsEqual(makeIntent("aim"), undefined)).toBe(false);
  });

  it("drops a malformed saved plan rather than showing a wrong one", () => {
    expect(sanitizeIntent({ kind: "not-a-plan" })).toBeUndefined();
    expect(sanitizeIntent("aim")).toBeUndefined();
    expect(sanitizeIntent(null)).toBeUndefined();
    expect(sanitizeIntent({ kind: "aim", targetId: 7, at: { x: "a", y: 1 } }))
      .toEqual({ kind: "aim", targetId: null, at: null });
    expect(isValidIntent(undefined)).toBe(true);
    expect(isValidIntent({ kind: "aim", targetId: null, at: null })).toBe(true);
    expect(isValidIntent({ kind: "nope", targetId: null, at: null })).toBe(false);
  });

  it("survives a clone and a save round trip", () => {
    const { map, enemy } = lane("marksman");
    map.units.push(makeArchetypeUnit("rifleman", "extra", 3, 2));
    refreshEnemyIntents(map);
    const copy = cloneMap(map);
    const copied = copy.units.find((u) => u.id === enemy.id)!;
    expect(copied.intent).toEqual(enemy.intent);
    // A clone must not share the plan object with its source.
    copied.intent!.kind = "hold";
    expect(enemy.intent!.kind).not.toBe("hold");

    expect(validateMap(map).hasErrors).toBe(false);
    const loaded = sanitizeLoadedMap(JSON.parse(JSON.stringify(map)));
    expect(loaded.report.hasErrors).toBe(false);
    expect(loaded.map!.units.find((u) => u.id === enemy.id)!.intent).toEqual(enemy.intent);
  });

  it("rejects a malformed intent during validation", () => {
    const { map, enemy } = lane("rifleman");
    (enemy as { intent?: unknown }).intent = { kind: "wat", targetId: null, at: null };
    const report = validateMap(map);
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === "INVALID_UNIT_INTENT")).toBe(true);
  });
});

describe("intent is the AI's own plan", () => {
  it("publishes a plan for every living hostile and none for the dead", () => {
    const { map, enemy } = lane("rifleman");
    const dead = makeArchetypeUnit("scrapper", "dead", 5, 2);
    dead.hp = 0;
    map.units.push(dead);
    refreshEnemyIntents(map);
    expect(enemy.intent).toBeDefined();
    expect(dead.intent).toBeUndefined();
  });

  it("matches what the planner would say when asked again", () => {
    const { map } = lane("sentinel");
    refreshEnemyIntents(map);
    for (const unit of map.units) {
      if (unit.team !== "enemy") continue;
      expect(planEnemyIntent(map, unit)).toEqual(unit.intent);
    }
  });

  it("does not consume randomness, so inspecting an enemy leaks no die roll", () => {
    const { map, enemy } = lane("marksman");
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0.5;
    };
    // Planning takes no rng at all; only resolution does.
    planEnemyIntent(map, enemy);
    expect(draws).toBe(0);
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    takeEnemyAction(map, enemy, session, counting);
    expect(enemy.intent).toBeDefined();
  });

  it("acts on the plan it published", () => {
    const { map, enemy } = lane("marksman");
    refreshEnemyIntents(map);
    expect(enemy.intent!.kind).toBe("aim");
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    const action = takeEnemyAction(map, enemy, session, () => 0.5);
    expect(action.kind).toBe("aim");
    expect(isAimed(enemy)).toBe(true);
  });
});

describe("Marksman telegraph", () => {
  it("locks on instead of firing, and names who it is aiming at", () => {
    const { map, player, enemy } = lane("marksman");
    refreshEnemyIntents(map);
    expect(enemy.intent).toMatchObject({ kind: "aim", targetId: player.id });
    expect(intentLabel(enemy.intent, player.displayName ?? null)).toBe("AIMING AT ROOK");
    // It has not fired: the whole turn was the telegraph.
    expect(player.hp).toBe(player.maxHp);
  });

  it("becomes far more dangerous on the turn after, if ignored", () => {
    const { map, player, enemy } = lane("marksman");
    const cold = previewShot(map, enemy, player);
    performAction(map, enemy, "aim", null, () => 0);
    const locked = previewShot(map, enemy, player);
    expect(locked.usesAim).toBe(true);
    expect(locked.hitChance * locked.damage)
      .toBeGreaterThan(cold.hitChance * cold.damage * 1.2);
  });

  it("loses the lock when the line is broken, and says so", () => {
    const { map, player, enemy } = lane("marksman");
    refreshEnemyIntents(map);
    expect(enemy.intent!.kind).toBe("aim");
    performAction(map, enemy, "aim", null, () => 0);

    // The player drops behind a wall. The plan is now impossible.
    setTile(map, 6, 1, "wall");
    setTile(map, 6, 0, "wall");
    setTile(map, 6, 2, "wall");
    refreshEnemyIntents(map);
    expect(enemy.intent!.kind).not.toBe("aim");
    expect(previewShot(map, enemy, player).shot.canShoot).toBe(false);
  });

  it("loses the lock to suppression", () => {
    const { map, enemy } = lane("marksman");
    performAction(map, enemy, "aim", null, () => 0);
    expect(isAimed(enemy)).toBe(true);
    applySuppression(enemy);
    expect(isAimed(enemy)).toBe(false);
    refreshEnemyIntents(map);
    expect(enemy.intent!.kind).not.toBe("aim");
  });

  it("loses the lock if it is forced to move", () => {
    const { map, enemy } = lane("marksman");
    performAction(map, enemy, "aim", null, () => 0);
    beginUnitTurn(enemy);
    expect(isAimed(enemy)).toBe(false);
  });

  it("does not lock on from inside the range it hates", () => {
    // Rushed to knife range, it stops preparing and deals with the problem.
    const { map, enemy } = lane("marksman", 2);
    refreshEnemyIntents(map);
    expect(enemy.intent!.kind).not.toBe("aim");
  });
});

describe("replanning", () => {
  it("changes the plan when the target it named dies", () => {
    const { map, player, enemy } = lane("rifleman", 6);
    const second = makeArchetypeUnit("runner", "vex", 3, 2);
    map.units.push(second);
    refreshEnemyIntents(map);
    expect(enemy.intent!.targetId).toBeTruthy();
    player.hp = 0;
    refreshEnemyIntents(map);
    expect(enemy.intent!.targetId).not.toBe(player.id);
  });

  it("stops planning entirely once no operator is left", () => {
    const { map, player, enemy } = lane("rifleman", 6);
    player.hp = 0;
    refreshEnemyIntents(map);
    expect(enemy.intent).toEqual(makeIntent("idle"));
    expect(intentLabel(enemy.intent, null)).toBeNull();
  });

  it("replans at the top of its turn rather than obeying a stale banner", () => {
    const { map, player, enemy } = lane("rifleman", 6);
    refreshEnemyIntents(map);
    const published = enemy.intent!;
    expect(published.kind).toBe("engage");

    // The player breaks the line between the banner and the turn.
    setTile(map, 4, 1, "wall");
    setTile(map, 4, 0, "wall");
    setTile(map, 4, 2, "wall");
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(enemy.intent!.kind).not.toBe("engage");
    expect(player.hp).toBe(player.maxHp);
  });
});
