import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beginEnemyTurn,
  planEnemyIntent,
  refreshEnemyIntents,
  takeEnemyAction,
} from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";
import { performAction } from "../src/actions.ts";
import { makeArchetypeUnit } from "../src/content.ts";
import { beginUnitTurn, endUnitTurn, onUnitMoved } from "../src/rules.ts";
import { isAimed, isHunkered } from "../src/status.ts";
import { buildMap } from "./fixtures.ts";

function marksmanLane() {
  const map = buildMap([
    "................",
    "................",
    "................",
  ]);
  const rook = makeArchetypeUnit("operator", "rook", 1, 1);
  const vex = makeArchetypeUnit("runner", "vex", 2, 0);
  const marksman = makeArchetypeUnit("marksman", "marksman", 14, 1);
  map.units.push(rook, vex, marksman);
  return { map, rook, vex, marksman };
}

describe("Wave 1 mechanical truth", () => {
  it("movement cancels Hunker and Overwatch as positional commitments", () => {
    const map = buildMap(["....."]);
    const unit = makeArchetypeUnit("operator", "rook", 1, 0);
    const foe = makeArchetypeUnit("rifleman", "foe", 4, 0);
    map.units.push(unit, foe);
    expect(performAction(map, unit, "hunker").ok).toBe(true);
    unit.overwatch = true;
    unit.overwatchShotsUsed = 1;
    expect(isHunkered(unit)).toBe(true);

    onUnitMoved(unit);

    expect(isHunkered(unit)).toBe(false);
    expect(unit.overwatch).toBe(false);
    expect(unit.overwatchShotsUsed).toBe(0);
  });

  it("a Marksman spends one turn locking and the next firing at that exact operator", () => {
    const { map, rook, vex, marksman } = marksmanLane();
    refreshEnemyIntents(map);
    const lockedId = marksman.intent!.targetId!;
    const locked = map.units.find((unit) => unit.id === lockedId)!;
    const before = new Map([[rook.id, rook.hp], [vex.id, vex.hp]]);
    const session = createAiSession();

    beginUnitTurn(marksman);
    beginEnemyTurn(map, marksman, session);
    const acquire = takeEnemyAction(map, marksman, session, () => 0);
    expect(acquire.kind).toBe("aim");
    expect(isAimed(marksman)).toBe(true);
    expect(marksman.ap).toBe(0);
    expect(rook.hp).toBe(before.get(rook.id));
    expect(vex.hp).toBe(before.get(vex.id));

    endUnitTurn(marksman);
    refreshEnemyIntents(map);
    expect(marksman.intent).toMatchObject({ kind: "aim", targetId: lockedId });

    beginUnitTurn(marksman);
    expect(isAimed(marksman)).toBe(true);
    beginEnemyTurn(map, marksman, session);
    const fire = takeEnemyAction(map, marksman, session, () => 0);
    expect(fire.kind).toBe("shoot");
    if (fire.kind === "shoot") {
      expect(fire.target.id).toBe(locked.id);
      expect(fire.result.usedAim).toBe(true);
    }
    expect(marksman.ap).toBe(0);
    expect(isAimed(marksman)).toBe(false);
  });

  it("does not transfer a broken Marksman lock to another visible operator", () => {
    const { map, rook, vex, marksman } = marksmanLane();
    refreshEnemyIntents(map);
    const lockedId = marksman.intent!.targetId!;
    const locked = map.units.find((unit) => unit.id === lockedId)!;
    const other = locked.id === rook.id ? vex : rook;
    const session = createAiSession();

    beginUnitTurn(marksman);
    beginEnemyTurn(map, marksman, session);
    expect(takeEnemyAction(map, marksman, session, () => 0).kind).toBe("aim");
    expect(isAimed(marksman)).toBe(true);

    locked.hp = 0;
    refreshEnemyIntents(map);
    expect(isAimed(marksman)).toBe(false);
    const otherHp = other.hp;

    beginUnitTurn(marksman);
    beginEnemyTurn(map, marksman, session);
    const replacement = takeEnemyAction(map, marksman, session, () => 0);
    expect(replacement.kind).toBe("aim");
    expect(other.hp).toBe(otherHp);
  });

  it("publishes intent from restored next-turn AP rather than exhausted AP", () => {
    const map = buildMap(["........"]);
    const player = makeArchetypeUnit("operator", "rook", 0, 0);
    const enemy = makeArchetypeUnit("rifleman", "foe", 6, 0);
    map.units.push(player, enemy);
    enemy.ap = 0;
    enemy.movesThisTurn = 6;
    enemy.shotsThisTurn = 2;

    refreshEnemyIntents(map);
    const published = structuredClone(enemy.intent);
    expect(published?.kind).toBe("engage");

    beginUnitTurn(enemy);
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(enemy.intent).toEqual(published);
  });

  it("executes HOLDING as staying on the published tile", () => {
    const map = buildMap(["p..e"], [
      { id: "rook", team: "player", x: 0, y: 0, overwatch: true },
      { id: "foe", team: "enemy", x: 3, y: 0, ap: 1, maxAp: 4 },
    ]);
    const enemy = map.units[1];
    const start = { x: enemy.x, y: enemy.y };
    const intent = planEnemyIntent(map, enemy);
    expect(intent.kind).toBe("hold");
    const session = createAiSession();
    beginEnemyTurn(map, enemy, session);
    expect(enemy.intent!.kind).toBe("hold");
    expect(takeEnemyAction(map, enemy, session)).toEqual({ kind: "wait" });
    expect(enemy).toMatchObject(start);
  });

  it("keeps ally-targeted actions armed and processes all independent reaction loops", () => {
    // This is a wiring guard until the planned browser-level runtime harness
    // can exercise the DOM and animation loop directly.
    const source = readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf8");
    expect(source).toContain('if (action.targeting !== "self")');

    const playerReactions = source.slice(
      source.indexOf("const triggerOverwatchReactions = async"),
      source.indexOf("async function triggerEnemyOverwatchReactions"),
    );
    const enemyReactions = source.slice(
      source.indexOf("async function triggerEnemyOverwatchReactions"),
      source.indexOf("const animateEnemyTurn"),
    );
    expect(playerReactions).not.toMatch(/if \(cancelled\) return;\s*break;/);
    expect(enemyReactions).not.toMatch(/if \(cancelled\) return;\s*break;/);
  });
});
