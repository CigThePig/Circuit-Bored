import { describe, expect, it } from "vitest";
import { performAction } from "../src/actions.ts";
import {
  GUARD_DAMAGE_REDUCTION,
  overwatchReactions,
  previewShot,
  protectionFor,
  settleOverwatch,
} from "../src/combat.ts";
import { beginUnitTurn, endUnitTurn, tilesPerMoveAp } from "../src/rules.ts";
import { isSuppressed } from "../src/status.ts";
import { rangeAccuracy, rangeRating, type RangeBand } from "../src/range.ts";
import { buildMap } from "./fixtures.ts";
import {
  buildCombatProfile,
  makeArchetypeUnit,
  UNIT_ARCHETYPES,
  UPGRADES,
  type UnitArchetypeId,
  type UpgradeId,
} from "../src/content.ts";
import { resolveShot } from "../src/combat.ts";
import { movementApCost, TILES_PER_MOVE_AP } from "../src/rules.ts";

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

describe("tactical upgrades", () => {
  const always = () => 0;

  /** One operator of the given archetype with the given circuits installed. */
  function operator(archetypeId: UnitArchetypeId, upgrades: UpgradeId[]) {
    const map = buildMap([
      "..............",
      "..............",
      "..............",
    ]);
    const unit = makeArchetypeUnit(archetypeId, "op", 1, 1, upgrades);
    const foe = makeArchetypeUnit("rifleman", "foe", 8, 1, []);
    map.units.push(unit, foe);
    return { map, unit, foe };
  }

  it("keeps the pool weighted toward tactics rather than only numbers", () => {
    const tactical = UPGRADES.filter((u) => u.tag === "tactic" || u.tag === "position");
    expect(tactical.length).toBeGreaterThanOrEqual(UPGRADES.length / 3);
  });

  it("every upgrade still builds a legal profile at every stack count", () => {
    for (const upgrade of UPGRADES) {
      const stacked = new Array(upgrade.maxStacks).fill(upgrade.id) as UpgradeId[];
      const profile = buildCombatProfile("operator", stacked);
      for (const [key, value] of Object.entries(profile)) {
        if (typeof value === "number") expect(Number.isFinite(value), key).toBe(true);
      }
    }
  });

  it("Target Designator sharpens the mark without helping the marker", () => {
    const plain = operator("operator", []);
    const upgraded = operator("operator", ["target_designator"]);
    const ally = makeArchetypeUnit("runner", "ally", 2, 2, []);
    const allyUp = makeArchetypeUnit("runner", "ally", 2, 2, []);
    plain.map.units.push(ally);
    upgraded.map.units.push(allyUp);

    performAction(plain.map, plain.unit, "mark", plain.foe, always);
    performAction(upgraded.map, upgraded.unit, "mark", upgraded.foe, always);
    expect(previewShot(upgraded.map, allyUp, upgraded.foe).hitChance)
      .toBeGreaterThan(previewShot(plain.map, ally, plain.foe).hitChance);
    // Still nothing for Rook itself: an upgrade must not turn a coordination
    // tool into a personal buff.
    expect(previewShot(upgraded.map, upgraded.unit, upgraded.foe).usesMark).toBe(false);
  });

  it("Command Uplink buys a second reaction without making overwatch endless", () => {
    const { map, unit, foe } = operator("operator", ["command_uplink"]);
    expect(overwatchReactions(unit)).toBe(2);
    performAction(map, unit, "overwatch", null, always);
    expect(settleOverwatch(map, unit, foe, { x: 8, y: 1 }, { x: 7, y: 1 }).fires).toBe(true);
    expect(unit.overwatch).toBe(true);
    foe.x = 7;
    expect(settleOverwatch(map, unit, foe, { x: 7, y: 1 }, { x: 6, y: 1 }).fires).toBe(true);
    // Two reactions and no more: the watch is spent.
    expect(unit.overwatch).toBe(false);
    foe.x = 6;
    expect(settleOverwatch(map, unit, foe, { x: 6, y: 1 }, { x: 5, y: 1 }).fires).toBe(false);
  });

  it("Sprint Servos lengthens a dash without changing an ordinary walk", () => {
    const plain = operator("runner", []);
    const upgraded = operator("runner", ["sprint_servos"]);
    expect(tilesPerMoveAp(upgraded.unit)).toBe(tilesPerMoveAp(plain.unit));
    performAction(plain.map, plain.unit, "dash", null, always);
    performAction(upgraded.map, upgraded.unit, "dash", null, always);
    expect(tilesPerMoveAp(upgraded.unit)).toBeGreaterThan(tilesPerMoveAp(plain.unit));
  });

  it("Flank Protocol refunds once per turn and never generates a loop", () => {
    const map = buildMap([
      "...h..",
      "...e..",
      "......",
      "...p..",
    ]);
    const unit = makeArchetypeUnit("runner", "op", 3, 3, ["flank_protocol"]);
    const foe = makeArchetypeUnit("rifleman", "foe", 3, 1, []);
    map.units.push(unit, foe);
    foe.hp = 99;
    foe.maxHp = 99;

    beginUnitTurn(unit);
    const start = unit.ap;
    performAction(map, unit, "shoot", foe, always);
    expect(unit.ap).toBe(start - 2 + 1);
    // The second Exposed shot this turn pays full price, so a flank can never
    // fund an unlimited turn of shooting.
    const after = unit.ap;
    performAction(map, unit, "shoot", foe, always);
    expect(unit.ap).toBe(after - 2);
    expect(unit.ap).toBeLessThan(start);
  });

  it("Shield Projector deepens Guard, and Sustained Fire lengthens suppression", () => {
    const map = buildMap([".............."]);
    const hex = makeArchetypeUnit("bulwark", "hex", 1, 0, ["shield_projector"]);
    const ally = makeArchetypeUnit("runner", "ally", 2, 0, []);
    const foe = makeArchetypeUnit("rifleman", "foe", 8, 0, []);
    map.units.push(hex, ally, foe);
    performAction(map, hex, "guard", ally, always);
    expect(protectionFor(map, ally)).toBe(GUARD_DAMAGE_REDUCTION + 1);

    const gunner = makeArchetypeUnit("operator", "gunner", 3, 0, ["sustained_fire"]);
    map.units.push(gunner);
    performAction(map, gunner, "suppress", foe, always);
    // Still suppressed after the turn that suppression was meant to cover.
    endUnitTurn(foe);
    expect(isSuppressed(foe)).toBe(true);
    endUnitTurn(foe);
    expect(isSuppressed(foe)).toBe(false);
  });

  it("Steady Hands and the range circuits change shots without breaking them", () => {
    const plain = operator("operator", []);
    const steady = operator("operator", ["steady_hands"]);
    performAction(plain.map, plain.unit, "aim", null, always);
    performAction(steady.map, steady.unit, "aim", null, always);
    expect(previewShot(steady.map, steady.unit, steady.foe).damage)
      .toBe(previewShot(plain.map, plain.unit, plain.foe).damage + 1);

    const close = makeArchetypeUnit("operator", "c", 1, 1, ["close_quarters"]);
    const long = makeArchetypeUnit("operator", "l", 1, 1, ["long_barrel"]);
    expect(rangeAccuracy(close.combat, "close"))
      .toBeGreaterThan(rangeAccuracy(makeArchetypeUnit("operator", "b", 1, 1).combat, "close"));
    expect(rangeAccuracy(long.combat, "long"))
      .toBeGreaterThan(rangeAccuracy(makeArchetypeUnit("operator", "b", 1, 1).combat, "long"));
  });

  it("no upgrade lets a unit end a turn with more AP than its ceiling", () => {
    const map = buildMap([
      "...h..",
      "...e..",
      "......",
      "...p..",
    ]);
    const unit = makeArchetypeUnit("runner", "op", 3, 3, ["flank_protocol", "kill_switch"]);
    const foe = makeArchetypeUnit("rifleman", "foe", 3, 1, []);
    map.units.push(unit, foe);
    beginUnitTurn(unit);
    for (let i = 0; i < 8; i++) {
      if (foe.hp <= 0) break;
      performAction(map, unit, "shoot", foe, always);
    }
    expect(unit.ap).toBeLessThanOrEqual(unit.maxAp);
    expect(unit.ap).toBeGreaterThanOrEqual(0);
  });
});

describe("archetype dossier metadata", () => {
  it("gives every archetype a role and a named weakness the HUD can show", () => {
    for (const [id, archetype] of Object.entries(UNIT_ARCHETYPES)) {
      expect(archetype.role.length, id).toBeGreaterThan(15);
      expect(archetype.counter.length, id).toBeGreaterThan(15);
      // The dossier is read on a phone, so each line has to stay one line.
      expect(archetype.role.length, id).toBeLessThan(90);
      expect(archetype.counter.length, id).toBeLessThan(90);
    }
  });

  it("describes each enemy's range identity consistently with its profile", () => {
    // The band ratings the dossier prints must come from the same profile the
    // shot model reads, so the text can never promise a matchup the rules
    // would not honour.
    const cases: [UnitArchetypeId, RangeBand, "strong" | "weak"][] = [
      ["scrapper", "close", "strong"],
      ["scrapper", "long", "weak"],
      ["marksman", "long", "strong"],
      ["marksman", "close", "weak"],
    ];
    for (const [id, band, expected] of cases) {
      expect(rangeRating(UNIT_ARCHETYPES[id].profile, band), `${id} ${band}`).toBe(expected);
    }
  });
});
