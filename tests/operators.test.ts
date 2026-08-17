import { describe, expect, it } from "vitest";
import {
  actionEligibility,
  actionsForUnit,
  BRACE_AP_COST,
  DASH_AP_COST,
  GUARD_AP_COST,
  MARK_AP_COST,
  performAction,
  RELAY_AP_COST,
  RELAY_AP_GRANTED,
  unitHasAction,
  type ActionId,
} from "../src/actions.ts";
import {
  activeGuardian,
  applySuppression,
  BRACE_DAMAGE_REDUCTION,
  checkOverwatch,
  GUARD_DAMAGE_REDUCTION,
  GUARD_RANGE,
  MARK_ACCURACY_BONUS,
  previewShot,
  protectionFor,
  resolveShot,
  settleOverwatch,
} from "../src/combat.ts";
import {
  beginUnitTurn,
  endUnitTurn,
  movementRange,
  onUnitMoved,
  startingAp,
  tilesPerMoveAp,
} from "../src/rules.ts";
import {
  guardedBy,
  isBraced,
  isDashing,
  isMarked,
  isSuppressed,
  overwatchEvasion,
} from "../src/status.ts";
import { makeArchetypeUnit } from "../src/content.ts";
import { buildMap } from "./fixtures.ts";

const always = () => 0;

/** A board with the whole squad plus one hostile, positioned by the caller. */
function squad(
  rows: string[],
  at: { rook: [number, number]; vex: [number, number]; hex: [number, number]; foe: [number, number] },
) {
  const map = buildMap(rows);
  const rook = makeArchetypeUnit("operator", "rook", at.rook[0], at.rook[1]);
  const vex = makeArchetypeUnit("runner", "vex", at.vex[0], at.vex[1]);
  const hex = makeArchetypeUnit("bulwark", "hex", at.hex[0], at.hex[1]);
  const foe = makeArchetypeUnit("rifleman", "foe", at.foe[0], at.foe[1]);
  map.units.push(rook, vex, hex, foe);
  return { map, rook, vex, hex, foe };
}

const OPEN = [
  "............",
  "............",
  "............",
];

describe("operator identity", () => {
  it("gives each operator its own abilities and nobody else's", () => {
    const { rook, vex, hex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [10, 1],
    });
    expect(actionsForUnit(rook)).toEqual(["mark", "relay", "aim", "hunker", "suppress", "overwatch"]);
    expect(actionsForUnit(vex)).toEqual(["dash", "aim", "hunker", "suppress", "overwatch"]);
    expect(actionsForUnit(hex)).toEqual(["guard", "brace", "aim", "hunker", "suppress", "overwatch"]);
    // Enemies keep the shared toolkit and none of the squad's role abilities.
    expect(actionsForUnit(foe)).toEqual(["aim", "hunker", "suppress", "overwatch"]);

    for (const [unit, owned] of [[rook, "mark"], [vex, "dash"], [hex, "guard"]] as const) {
      expect(unitHasAction(unit, owned as ActionId)).toBe(true);
      for (const other of [rook, vex, hex]) {
        if (other === unit) continue;
        expect(unitHasAction(other, owned as ActionId)).toBe(false);
      }
    }
  });

  it("refuses a role ability to an operator that does not have it", () => {
    const { map, vex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [10, 1],
    });
    const before = vex.ap;
    expect(actionEligibility(map, vex, "mark", foe))
      .toEqual({ ok: false, reason: "Not this operator's speciality." });
    expect(performAction(map, vex, "mark", foe, always).ok).toBe(false);
    expect(vex.ap).toBe(before);
    expect(isMarked(foe)).toBe(false);
  });
});

describe("Rook: Mark Target", () => {
  it("costs 1 AP and helps the squadmates rather than the marker", () => {
    const { map, rook, vex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    const rookBefore = previewShot(map, rook, foe).hitChance;
    const vexBefore = previewShot(map, vex, foe).hitChance;

    const before = rook.ap;
    expect(performAction(map, rook, "mark", foe, always).ok).toBe(true);
    expect(before - rook.ap).toBe(MARK_AP_COST);
    expect(isMarked(foe)).toBe(true);

    // The whole point: the caller gains nothing, the squad does.
    expect(previewShot(map, rook, foe).hitChance).toBeCloseTo(rookBefore, 6);
    expect(previewShot(map, rook, foe).usesMark).toBe(false);
    const vexAfter = previewShot(map, vex, foe);
    expect(vexAfter.usesMark).toBe(true);
    expect(vexAfter.hitChance - vexBefore).toBeCloseTo(MARK_ACCURACY_BONUS, 6);
  });

  it("reads through part of the target's cover", () => {
    // Half cover on the hostile's west face, with the squad due west.
    const { map, rook, vex, foe } = squad([
      "............",
      ".......h....",
      "............",
    ], { rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1] });
    const covered = previewShot(map, vex, foe);
    expect(covered.hadCover).toBe(true);
    performAction(map, rook, "mark", foe, always);
    const marked = previewShot(map, vex, foe);
    // Cover still counts for something; it just counts for less.
    expect(marked.hitChance).toBeGreaterThan(covered.hitChance + MARK_ACCURACY_BONUS);
    expect(marked.hadCover).toBe(true);
  });

  it("expires after the marked unit's next turn", () => {
    const { map, rook, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    performAction(map, rook, "mark", foe, always);
    endUnitTurn(rook);
    expect(isMarked(foe)).toBe(true);
    beginUnitTurn(foe);
    expect(isMarked(foe)).toBe(true);
    endUnitTurn(foe);
    expect(isMarked(foe)).toBe(false);
  });

  it("refuses a target it cannot see", () => {
    const { map, rook, foe } = squad([
      "....#.......",
      "....#.......",
      "....#.......",
    ], { rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1] });
    expect(performAction(map, rook, "mark", foe, always))
      .toEqual({ ok: false, reason: "Not in sight." });
    expect(isMarked(foe)).toBe(false);
  });
});

describe("Rook: Relay", () => {
  it("moves one action point and creates none", () => {
    const { map, rook, vex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    vex.ap -= 2;
    const totalBefore = rook.ap + vex.ap;
    expect(performAction(map, rook, "relay", vex, always).ok).toBe(true);
    expect(rook.ap + vex.ap).toBe(totalBefore - RELAY_AP_COST + RELAY_AP_GRANTED);
    expect(rook.ap + vex.ap).toBe(totalBefore);
  });

  it("cannot be looped: once per turn, and never above the recipient's cap", () => {
    const { map, rook, vex, hex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    vex.ap -= 2;
    hex.ap -= 2;
    expect(performAction(map, rook, "relay", vex, always).ok).toBe(true);
    // A second transfer this turn is refused, so AP cannot be shuffled around
    // the squad indefinitely.
    expect(performAction(map, rook, "relay", hex, always))
      .toEqual({ ok: false, reason: "Already relayed this turn." });
    // And a full squadmate is not a valid sink, so a point is never destroyed
    // to look like it was spent usefully.
    beginUnitTurn(rook);
    expect(performAction(map, rook, "relay", vex, always).ok).toBe(true);
    beginUnitTurn(rook);
    hex.ap = hex.maxAp;
    expect(performAction(map, rook, "relay", hex, always))
      .toEqual({ ok: false, reason: "Squadmate is at full AP." });
  });

  it("refuses to relay to itself or to a hostile", () => {
    const { map, rook, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    expect(performAction(map, rook, "relay", rook, always).ok).toBe(false);
    expect(performAction(map, rook, "relay", foe, always).ok).toBe(false);
    expect(rook.ap).toBe(rook.maxAp);
  });

  it("never lets the squad end a turn with more AP than it started", () => {
    const { map, rook, vex, hex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    for (const u of [rook, vex, hex]) beginUnitTurn(u);
    const start = rook.ap + vex.ap + hex.ap;
    vex.ap -= 2;
    hex.ap -= 1;
    for (let i = 0; i < 10; i++) {
      performAction(map, rook, "relay", vex, always);
      performAction(map, rook, "relay", hex, always);
    }
    expect(rook.ap + vex.ap + hex.ap).toBeLessThanOrEqual(start);
  });
});

describe("Vex: Dash", () => {
  it("costs 1 AP and buys more ground per action point", () => {
    const { map, vex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [10, 1],
    });
    const plainRate = tilesPerMoveAp(vex);
    const before = vex.ap;
    const reachBefore = movementRange(vex);
    expect(performAction(map, vex, "dash", null, always).ok).toBe(true);
    expect(before - vex.ap).toBe(DASH_AP_COST);
    expect(isDashing(vex)).toBe(true);
    expect(tilesPerMoveAp(vex)).toBeGreaterThan(plainRate);
    // One point poorer but still covering more ground than it would have.
    expect(movementRange(vex)).toBeGreaterThan(reachBefore - plainRate);
  });

  it("must be committed to before moving, so no walk is ever re-priced", () => {
    const { map, vex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [10, 1],
    });
    onUnitMoved(vex);
    expect(actionEligibility(map, vex, "dash"))
      .toEqual({ ok: false, reason: "Already moved this turn." });
  });

  it("slips exactly one reaction shot and no more", () => {
    const map = buildMap([
      "............",
      "............",
    ]);
    const vex = makeArchetypeUnit("runner", "vex", 1, 1);
    const watcher = makeArchetypeUnit("sentinel", "watcher", 10, 1);
    watcher.overwatch = true;
    map.units.push(vex, watcher);

    performAction(map, vex, "dash", null, always);
    expect(overwatchEvasion(vex)).toBe(1);

    // First watched step is slipped: no reaction, and the watch survives.
    const first = settleOverwatch(map, watcher, vex, { x: 1, y: 1 }, { x: 2, y: 1 });
    expect(first.evaded).toBe(true);
    expect(first.fires).toBe(false);
    expect(watcher.overwatch).toBe(true);
    expect(overwatchEvasion(vex)).toBe(0);

    // The next one costs, which is what keeps a lane dangerous.
    vex.x = 2;
    const second = settleOverwatch(map, watcher, vex, { x: 2, y: 1 }, { x: 3, y: 1 });
    expect(second.evaded).toBe(false);
    expect(second.fires).toBe(true);
  });

  it("expires at the start of the next turn", () => {
    const { map, vex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [10, 1],
    });
    performAction(map, vex, "dash", null, always);
    endUnitTurn(vex);
    beginUnitTurn(vex);
    expect(isDashing(vex)).toBe(false);
    expect(overwatchEvasion(vex)).toBe(0);
    expect(tilesPerMoveAp(vex)).toBe(2);
  });

  it("pays Vex extra for the flank it went to get", () => {
    // Vex's profile rewards Exposed targets more than anyone else's does.
    const flank = buildMap([
      "...h..",
      "...e..",
      "......",
      "...p..",
    ]);
    const vex = makeArchetypeUnit("runner", "vex", 3, 3);
    const foe = makeArchetypeUnit("rifleman", "foe", 3, 1);
    flank.units.push(vex, foe);
    const rookMap = buildMap([
      "...h..",
      "...e..",
      "......",
      "...p..",
    ]);
    const rook = makeArchetypeUnit("operator", "rook", 3, 3);
    const foe2 = makeArchetypeUnit("rifleman", "foe2", 3, 1);
    rookMap.units.push(rook, foe2);

    const vexShot = previewShot(flank, vex, foe);
    const rookShot = previewShot(rookMap, rook, foe2);
    expect(vexShot.exposed).toBe("flanked");
    expect(rookShot.exposed).toBe("flanked");
    // Same flank, same distance: Vex gets more out of it.
    expect(vexShot.hitChance).toBeGreaterThan(rookShot.hitChance);
  });
});

describe("Hex: Guard", () => {
  it("costs 1 AP and softens hits on the squadmate it shields", () => {
    const { map, hex, vex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    const before = previewShot(map, foe, vex).damage;
    const ap = hex.ap;
    expect(performAction(map, hex, "guard", vex, always).ok).toBe(true);
    expect(ap - hex.ap).toBe(GUARD_AP_COST);
    expect(guardedBy(vex)).toBe(hex.id);
    expect(activeGuardian(map, vex)?.id).toBe(hex.id);
    expect(previewShot(map, foe, vex).damage).toBe(before - GUARD_DAMAGE_REDUCTION);
  });

  it("refuses a squadmate out of reach, and lapses if the guardian walks away", () => {
    const { map, hex, vex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    vex.x = 3 + GUARD_RANGE + 1;
    expect(performAction(map, hex, "guard", vex, always))
      .toEqual({ ok: false, reason: "Too far to shield." });

    vex.x = 3 + GUARD_RANGE;
    expect(performAction(map, hex, "guard", vex, always).ok).toBe(true);
    expect(activeGuardian(map, vex)?.id).toBe(hex.id);
    // The link is resolved against live positions, so stepping out of position
    // ends the protection without any bookkeeping.
    hex.x = 0;
    expect(activeGuardian(map, vex)).toBeNull();
    expect(protectionFor(map, vex)).toBe(0);
  });

  it("lapses when the guardian dies", () => {
    const { map, hex, vex } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    performAction(map, hex, "guard", vex, always);
    hex.hp = 0;
    expect(activeGuardian(map, vex)).toBeNull();
  });

  it("never reduces a hit below one point of damage", () => {
    const { map, hex, vex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    performAction(map, hex, "guard", vex, always);
    vex.combat = { ...vex.combat!, damageReduction: 99 };
    const result = resolveShot(map, foe, vex, always);
    expect(result.hit).toBe(true);
    expect(result.damage).toBe(1);
  });
});

describe("Hex: Brace", () => {
  it("costs 1 AP, softens hits, and is cancelled by moving", () => {
    const { map, hex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    const before = previewShot(map, foe, hex).damage;
    const ap = hex.ap;
    expect(performAction(map, hex, "brace", null, always).ok).toBe(true);
    expect(ap - hex.ap).toBe(BRACE_AP_COST);
    expect(isBraced(hex)).toBe(true);
    expect(previewShot(map, foe, hex).damage).toBe(before - BRACE_DAMAGE_REDUCTION);

    onUnitMoved(hex);
    expect(isBraced(hex)).toBe(false);
    expect(previewShot(map, foe, hex).damage).toBe(before);
  });

  it("shrugs off suppression's action-point cost but not its accuracy cost", () => {
    const { map, hex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    performAction(map, hex, "brace", null, always);
    applySuppression(hex);
    expect(isSuppressed(hex)).toBe(true);
    // An anchor keeps its whole turn.
    expect(startingAp(hex)).toBe(hex.maxAp);
    // It still shoots badly, so bracing is resistance rather than immunity.
    expect(previewShot(map, hex, foe).shooterSuppressed).toBe(true);
  });

  it("sharpens the overwatch it holds", () => {
    const map = buildMap(["............"]);
    const hex = makeArchetypeUnit("bulwark", "hex", 1, 0);
    const foe = makeArchetypeUnit("rifleman", "foe", 7, 0);
    map.units.push(hex, foe);
    hex.resolvingOverwatch = true;
    const plain = previewShot(map, hex, foe).hitChance;
    hex.resolvingOverwatch = false;
    performAction(map, hex, "brace", null, always);
    hex.resolvingOverwatch = true;
    expect(previewShot(map, hex, foe).hitChance).toBeGreaterThan(plain);
  });

  it("stacks with Guard on the same target without going below one damage", () => {
    const { map, hex, vex, foe } = squad(OPEN, {
      rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1],
    });
    performAction(map, hex, "guard", vex, always);
    performAction(map, vex, "hunker", null, always);
    expect(protectionFor(map, vex)).toBe(GUARD_DAMAGE_REDUCTION);
    expect(previewShot(map, foe, vex).damage).toBeGreaterThanOrEqual(1);
  });
});

describe("no illegal outcomes", () => {
  it("never resolves a role ability through a wall", () => {
    const { map, rook, foe } = squad([
      "....#.......",
      "....#.......",
      "....#.......",
    ], { rook: [1, 1], vex: [2, 1], hex: [3, 1], foe: [8, 1] });
    for (const id of ["mark", "suppress", "shoot"] as ActionId[]) {
      const before = rook.ap;
      expect(performAction(map, rook, id, foe, always).ok, id).toBe(false);
      expect(rook.ap, id).toBe(before);
    }
    expect(foe.hp).toBe(foe.maxHp);
    expect(isMarked(foe)).toBe(false);
    expect(isSuppressed(foe)).toBe(false);
  });

  it("keeps an overwatch reaction from firing at a dashing unit it cannot see", () => {
    const map = buildMap([
      "....#.......",
      "............",
    ]);
    const vex = makeArchetypeUnit("runner", "vex", 1, 1);
    const watcher = makeArchetypeUnit("sentinel", "watcher", 8, 0);
    watcher.overwatch = true;
    map.units.push(vex, watcher);
    performAction(map, vex, "dash", null, always);
    // Behind the wall: no line, so no reaction and no evasion charge spent.
    const check = checkOverwatch(map, watcher, vex, { x: 1, y: 1 }, { x: 2, y: 0 });
    expect(check.seesAfter).toBe(false);
    expect(check.fires).toBe(false);
    expect(check.evaded).toBe(false);
    expect(overwatchEvasion(vex)).toBe(1);
  });
});
