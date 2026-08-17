import { describe, expect, it } from "vitest";
import { makeArchetypeUnit } from "../src/content.ts";
import { previewShot, resolveShot } from "../src/combat.ts";
import { movementApCost, beginUnitTurn, TILES_PER_MOVE_AP } from "../src/rules.ts";
import { buildMap } from "./fixtures.ts";

describe("combat upgrade integration", () => {
  it("uses one modified calculation for preview and resolution", () => {
    const map = buildMap(["....."]);
    const shooter = makeArchetypeUnit("operator", "p", 0, 0, ["smartlink", "hot_barrel"]);
    const target = makeArchetypeUnit("rifleman", "e", 4, 0);
    map.units = [shooter, target];
    const preview = previewShot(map, shooter, target);
    const result = resolveShot(map, shooter, target, () => preview.hitChance - 0.001);
    expect(result.hitChance).toBe(preview.hitChance);
    expect(result.hit).toBe(true);
    expect(result.damage).toBe(4);
  });

  it("applies defense and conditional uncovered accuracy transparently", () => {
    const map = buildMap(["....."]);
    const shooter = makeArchetypeUnit("operator", "p", 0, 0, ["crossfire_matrix"]);
    const target = makeArchetypeUnit("rifleman", "e", 4, 0);
    target.combat!.damageReduction = 1;
    map.units = [shooter, target];
    expect(previewShot(map, shooter, target).hitChance).toBeCloseTo(0.98);
    expect(resolveShot(map, shooter, target, () => 0).damage).toBe(2);
  });

  it("makes only the first move each turn free", () => {
    const unit = makeArchetypeUnit("operator", "p", 0, 0, ["ghost_step"]);
    // The free move is one action point of travel, which is TILES_PER_MOVE_AP
    // tiles - not one tile.
    expect(movementApCost(unit)).toBe(0);
    unit.movesThisTurn = TILES_PER_MOVE_AP - 1;
    expect(movementApCost(unit)).toBe(0);
    unit.movesThisTurn = TILES_PER_MOVE_AP;
    expect(movementApCost(unit)).toBe(1);
    beginUnitTurn(unit);
    expect(movementApCost(unit)).toBe(0);
  });

  it("applies overwatch bonuses only during an overwatch shot", () => {
    const map = buildMap(["....."]);
    const shooter = makeArchetypeUnit("operator", "p", 0, 0, ["overwatch_optics", "tripwire_rounds"]);
    const target = makeArchetypeUnit("rifleman", "e", 4, 0);
    map.units = [shooter, target];
    const normal = previewShot(map, shooter, target).hitChance;
    shooter.resolvingOverwatch = true;
    const watch = previewShot(map, shooter, target).hitChance;
    const result = resolveShot(map, shooter, target, () => 0);
    expect(watch).toBeGreaterThan(normal);
    expect(result.damage).toBe(4);
  });

  it("refunds and repairs only the first kill each turn", () => {
    const map = buildMap(["......"]);
    const shooter = makeArchetypeUnit("operator", "p", 0, 0, ["kill_switch", "salvage_nanites"]);
    shooter.ap = 1;
    shooter.hp = 4;
    const first = makeArchetypeUnit("scrapper", "e1", 2, 0);
    const second = makeArchetypeUnit("scrapper", "e2", 4, 0);
    first.hp = 1;
    second.hp = 1;
    map.units = [shooter, first, second];
    resolveShot(map, shooter, first, () => 0);
    expect(shooter).toMatchObject({ ap: 2, hp: 5, killsThisTurn: 1 });
    resolveShot(map, shooter, second, () => 0);
    expect(shooter).toMatchObject({ ap: 2, hp: 5, killsThisTurn: 2 });
  });
});
