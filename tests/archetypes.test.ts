/**
 * Archetype counterplay.
 *
 * Each enemy type should be dangerous for a reason the player can name, and
 * beatable by a plan that follows from that reason. These scenarios play fixed
 * boards with fixed dice and compare the naive line against the plan the
 * archetype's weakness suggests. The goal is not a balance number; it is proof
 * that knowing what you are fighting changes what you should do.
 */
import { describe, expect, it } from "vitest";
import { performAction } from "../src/actions.ts";
import {
  applySuppression,
  previewShot,
  resolveShot,
  settleOverwatch,
} from "../src/combat.ts";
import {
  beginEnemyTurn,
  planEnemyIntent,
  refreshEnemyIntents,
  takeEnemyAction,
} from "../src/ai.ts";
import { createAiSession } from "../src/aiSession.ts";
import { beginUnitTurn, endUnitTurn } from "../src/rules.ts";
import { isSuppressed } from "../src/status.ts";
import { rangeBandBetween } from "../src/range.ts";
import { setTile, type GameMap, type Unit } from "../src/map.ts";
import { SeededRng } from "../src/rng.ts";
import { makeArchetypeUnit, type UnitArchetypeId } from "../src/content.ts";
import { buildMap } from "./fixtures.ts";

function rolls(seed: string): () => number {
  const rng = new SeededRng(seed);
  return () => rng.next();
}

const hit = () => 0;

function place(
  map: GameMap,
  id: UnitArchetypeId,
  name: string,
  x: number,
  y: number,
): Unit {
  const unit = makeArchetypeUnit(id, name, x, y);
  map.units.push(unit);
  return unit;
}

/** Spend a unit's whole turn shooting one target. */
function emptyClipInto(map: GameMap, shooter: Unit, target: Unit, rng: () => number): void {
  while (shooter.ap >= 2 && target.hp > 0) {
    shooter.ap -= 2;
    resolveShot(map, shooter, target, rng);
  }
}

// ---------------------------------------------------------------------------

describe("Scenario 1: Rook makes focus fire beat three unrelated attacks", () => {
  /**
   * Three dug-in hostiles. The squad has exactly enough fire to kill one of
   * them if it concentrates, and enough to wound all three if it does not.
   * Spread damage removes nobody from the fight; a kill removes a whole turn
   * of incoming fire.
   */
  function board() {
    const map = buildMap([
      "..............",
      "........h.....",
      "........h.....",
      "........h.....",
      "..............",
    ]);
    const rook = place(map, "operator", "rook", 1, 2);
    const vex = place(map, "runner", "vex", 1, 1);
    const hex = place(map, "bulwark", "hex", 1, 3);
    const foes = [
      place(map, "rifleman", "foe-a", 9, 1),
      place(map, "rifleman", "foe-b", 9, 2),
      place(map, "rifleman", "foe-c", 9, 3),
    ];
    for (const foe of foes) {
      foe.hp = 7;
      foe.maxHp = 7;
    }
    return { map, rook, vex, hex, foes };
  }

  const killed = (foes: Unit[]) => foes.filter((f) => f.hp <= 0).length;

  it("concentrating on one called target removes it; spreading fire removes nobody", () => {
    // Naive: everyone picks their own hostile.
    const spread = board();
    const spreadRng = rolls("scenario-1");
    [spread.rook, spread.vex, spread.hex].forEach((unit, i) => {
      emptyClipInto(spread.map, unit, spread.foes[i], spreadRng);
    });

    // Coordinated: Rook calls one target and the squad concentrates on it.
    const focused = board();
    const focusRng = rolls("scenario-1");
    performAction(focused.map, focused.rook, "mark", focused.foes[1], focusRng);
    for (const unit of [focused.rook, focused.vex, focused.hex]) {
      emptyClipInto(focused.map, unit, focused.foes[1], focusRng);
    }

    expect(killed(spread.foes)).toBe(0);
    expect(killed(focused.foes)).toBeGreaterThan(0);
  });

  it("the mark itself is what closes the gap, not just the concentration", () => {
    // Same concentration, no mark: Rook keeps both its shots instead.
    const unmarked = board();
    const rngA = rolls("scenario-1b");
    for (const unit of [unmarked.rook, unmarked.vex, unmarked.hex]) {
      emptyClipInto(unmarked.map, unit, unmarked.foes[1], rngA);
    }

    const marked = board();
    const rngB = rolls("scenario-1b");
    performAction(marked.map, marked.rook, "mark", marked.foes[1], rngB);
    for (const unit of [marked.rook, marked.vex, marked.hex]) {
      emptyClipInto(marked.map, unit, marked.foes[1], rngB);
    }

    // Rook trades one of its own shots for accuracy on everyone else's, and
    // comes out ahead against a target that is actually using cover.
    expect(marked.foes[1].hp).toBeLessThanOrEqual(unmarked.foes[1].hp);
  });

  it("pays only the squad, so Rook alone gains nothing from calling a target", () => {
    const { map, rook, vex, foes } = board();
    const rookBefore = previewShot(map, rook, foes[1]).hitChance;
    performAction(map, rook, "mark", foes[1], hit);
    expect(previewShot(map, rook, foes[1]).hitChance).toBeCloseTo(rookBefore, 6);
    expect(previewShot(map, vex, foes[1]).usesMark).toBe(true);
  });

  it("moves an action point to whoever can use it", () => {
    const { map, rook, vex, foes } = board();
    vex.ap = 1;
    expect(performAction(map, vex, "shoot", foes[1], hit).ok).toBe(false);
    expect(performAction(map, rook, "relay", vex, hit).ok).toBe(true);
    expect(performAction(map, vex, "shoot", foes[1], hit).ok).toBe(true);
  });
});

describe("Scenario 2: Vex exploits a flank nobody else can", () => {
  /** A hostile behind cover, with the flank two tiles beyond a watched gap. */
  function board() {
    const map = buildMap([
      "..............",
      "...........h..",
      "..............",
      "..............",
      "..............",
      "..............",
    ]);
    const foe = place(map, "rifleman", "foe", 11, 2);
    const vex = place(map, "runner", "vex", 0, 5);
    const hex = place(map, "bulwark", "hex", 1, 5);
    return { map, foe, vex, hex };
  }

  it("reaches the flanking tile in one turn where the anchor cannot", () => {
    const { vex, hex } = board();
    // The flank is south of the hostile, whose cover faces north.
    const flank = { x: 11, y: 4 };
    const vexReach = Math.max(Math.abs(vex.x - flank.x), Math.abs(vex.y - flank.y));
    const hexReach = Math.max(Math.abs(hex.x - flank.x), Math.abs(hex.y - flank.y));
    // Dash is what turns a two-turn walk into a one-turn one.
    const { map } = board();
    const dashVex = map.units.find((u) => u.displayName === "Vex")!;
    performAction(map, dashVex, "dash", null, hit);
    const dashed = (dashVex.ap) * 3;
    const hexBudget = hex.ap * 2;
    expect(vexReach).toBeLessThanOrEqual(dashed);
    expect(hexReach).toBeGreaterThan(hexBudget);
  });

  it("gets more out of the flank than another operator standing there would", () => {
    const asVex = board();
    asVex.vex.x = 11;
    asVex.vex.y = 4;
    const vexShot = previewShot(asVex.map, asVex.vex, asVex.foe);

    const asHex = board();
    asHex.hex.x = 11;
    asHex.hex.y = 4;
    const hexShot = previewShot(asHex.map, asHex.hex, asHex.foe);

    expect(vexShot.exposed).toBe("flanked");
    expect(hexShot.exposed).toBe("flanked");
    expect(rangeBandBetween(asVex.vex, asVex.foe)).toBe("close");
    // Same tile, same target: Vex's close-range profile and flank bonus make
    // the angle worth more in its hands.
    expect(vexShot.hitChance * vexShot.damage)
      .toBeGreaterThan(hexShot.hitChance * hexShot.damage);
  });
});

describe("Scenario 3: Hex holds a lane and buys somebody else time", () => {
  function board() {
    const map = buildMap([
      "..........",
      ".h........",
      "..........",
      "..........",
    ]);
    const hex = place(map, "bulwark", "hex", 1, 2);
    const vex = place(map, "runner", "vex", 2, 2);
    const foe = place(map, "rifleman", "foe", 8, 2);
    foe.hp = 12;
    foe.maxHp = 12;
    return { map, hex, vex, foe };
  }

  it("keeps a squadmate standing through fire that would otherwise drop it", () => {
    const play = (guard: boolean): number => {
      const b = board();
      const rng = rolls("scenario-3");
      if (guard) performAction(b.map, b.hex, "guard", b.vex, rng);
      for (let turn = 0; turn < 1 && b.vex.hp > 0; turn++) {
        beginUnitTurn(b.foe);
        emptyClipInto(b.map, b.foe, b.vex, rng);
        endUnitTurn(b.foe);
      }
      return b.vex.hp;
    };
    expect(play(true)).toBeGreaterThan(play(false));
  });

  it("an anchored Hex keeps working through suppression that would slow anyone else", () => {
    const { map, hex, vex } = board();
    performAction(map, hex, "brace", null, hit);
    applySuppression(hex);
    applySuppression(vex);
    beginUnitTurn(hex);
    beginUnitTurn(vex);
    expect(hex.ap).toBe(hex.maxAp);
    expect(vex.ap).toBe(vex.maxAp - 1);
  });
});

describe("Scenario 4 and 5: the Marksman, ignored and interrupted", () => {
  function board() {
    const map = buildMap([
      "..............",
      "..............",
      "..............",
    ]);
    const rook = place(map, "operator", "rook", 1, 1);
    const marksman = place(map, "marksman", "marksman", 12, 1);
    return { map, rook, marksman };
  }

  it("is very dangerous when its lock is ignored", () => {
    const { map, rook, marksman } = board();
    refreshEnemyIntents(map);
    expect(marksman.intent!.kind).toBe("aim");

    const cold = previewShot(map, marksman, rook);
    performAction(map, marksman, "aim", null, hit);
    const locked = previewShot(map, marksman, rook);
    // The telegraphed shot is a different order of threat from an ordinary one.
    expect(locked.damage).toBeGreaterThan(cold.damage);
    expect(locked.hitChance * locked.damage)
      .toBeGreaterThan(cold.hitChance * cold.damage * 1.3);
  });

  it("breaking the line drops its threat to nothing", () => {
    const { map, rook, marksman } = board();
    performAction(map, marksman, "aim", null, hit);
    for (const y of [0, 1, 2]) setTile(map, 7, y, "wall");
    expect(previewShot(map, marksman, rook).shot.canShoot).toBe(false);
    refreshEnemyIntents(map);
    expect(marksman.intent!.kind).not.toBe("aim");
  });

  it("suppressing it costs it the lock and most of its accuracy", () => {
    const { map, rook, marksman } = board();
    performAction(map, marksman, "aim", null, hit);
    const locked = previewShot(map, marksman, rook);
    applySuppression(marksman);
    const spoiled = previewShot(map, marksman, rook);
    expect(spoiled.usesAim).toBe(false);
    expect(spoiled.hitChance * spoiled.damage)
      .toBeLessThan(locked.hitChance * locked.damage * 0.6);
  });

  it("rushing it is the other answer: close range guts its shot", () => {
    const { map, rook, marksman } = board();
    const far = previewShot(map, marksman, rook);
    rook.x = marksman.x - 2;
    const near = previewShot(map, marksman, rook);
    expect(near.hitChance).toBeLessThan(far.hitChance - 0.25);
    expect(near.damage).toBeLessThan(far.damage);
    // And it stops preparing, because a lock is not what this fight needs.
    refreshEnemyIntents(map);
    expect(marksman.intent!.kind).not.toBe("aim");
  });
});

describe("Scenario 6: the Sentinel is a bad trade and a good target for control", () => {
  function board() {
    // Half cover on the sentinel's west face, with Rook due west of it: a
    // head-on approach into terrain that is working.
    const map = buildMap([
      "..........",
      "..........",
      "..h.......",
      "..........",
      "..........",
    ]);
    const sentinel = place(map, "sentinel", "sentinel", 3, 2);
    const rook = place(map, "operator", "rook", 0, 2);
    const vex = place(map, "runner", "vex", 6, 2);
    return { map, sentinel, rook, vex };
  }

  it("is inefficient to attack head-on from the side its cover faces", () => {
    const { map, sentinel, rook, vex } = board();
    // One operator, due west, into terrain that is working: no flank, no
    // second angle, just a trade against armour.
    vex.hp = 0;
    const headOn = previewShot(map, rook, sentinel);
    expect(headOn.exposed).toBeNull();
    expect(headOn.damage).toBeLessThan(3);
  });

  it("collapses when the squad creates a positional disadvantage instead", () => {
    const { map, sentinel, rook } = board();
    // Vex is on the far side, so the pair is a crossfire.
    const crossfire = previewShot(map, rook, sentinel);
    expect(crossfire.exposed).toBe("crossfire");

    const alone = board();
    alone.vex.hp = 0;
    const solo = previewShot(alone.map, alone.rook, alone.sentinel);
    expect(solo.exposed).toBeNull();
    expect(crossfire.hitChance * crossfire.damage)
      .toBeGreaterThan(solo.hitChance * solo.damage * 1.4);
  });

  it("suppression takes its watch away rather than out-damaging it", () => {
    const { map, sentinel, vex } = board();
    performAction(map, sentinel, "overwatch", null, hit);
    expect(sentinel.overwatch).toBe(true);
    const before = settleOverwatch(map, sentinel, vex, { x: 6, y: 2 }, { x: 6, y: 3 });
    expect(before.fires).toBe(true);

    const second = board();
    performAction(second.map, second.sentinel, "overwatch", null, hit);
    applySuppression(second.sentinel);
    expect(second.sentinel.overwatch).toBe(false);
    const after = settleOverwatch(
      second.map, second.sentinel, second.vex, { x: 6, y: 2 }, { x: 6, y: 3 },
    );
    expect(after.fires).toBe(false);
  });

  it("uses suppression itself against a target it cannot easily shoot", () => {
    const map = buildMap([
      "..........",
      "..........",
      "..........",
    ]);
    const sentinel = place(map, "sentinel", "sentinel", 6, 1);
    const rook = place(map, "operator", "rook", 1, 1);
    rook.overwatch = true;
    const intent = planEnemyIntent(map, sentinel);
    // A watching operator is exactly what a lane-control enemy wants pinned.
    expect(intent.kind).toBe("suppress");
    expect(intent.targetId).toBe(rook.id);

    const session = createAiSession();
    beginEnemyTurn(map, sentinel, session);
    const action = takeEnemyAction(map, sentinel, session, () => 0.5);
    expect(action.kind).toBe("suppress");
    expect(isSuppressed(rook)).toBe(true);
    expect(rook.overwatch).toBe(false);
  });
});

describe("Scenario 7: the Scrapper gets worse the further away it is kept", () => {
  function board(gap: number) {
    const map = buildMap([
      ".".repeat(gap + 4),
      ".".repeat(gap + 4),
      ".".repeat(gap + 4),
    ]);
    const rook = place(map, "operator", "rook", 1, 1);
    const scrapper = place(map, "scrapper", "scrapper", 1 + gap, 1);
    return { map, rook, scrapper };
  }

  it("becomes dramatically more threatening as it closes", () => {
    const threats = [11, 6, 2].map((gap) => {
      const { map, rook, scrapper } = board(gap);
      const preview = previewShot(map, scrapper, rook);
      return preview.hitChance * preview.damage;
    });
    // Strictly increasing as the gap shrinks.
    expect(threats[1]).toBeGreaterThan(threats[0]);
    expect(threats[2]).toBeGreaterThan(threats[1]);
    expect(threats[2]).toBeGreaterThan(threats[0] * 1.8);
  });

  it("announces that it is coming, and for whom", () => {
    const { map, rook, scrapper } = board(11);
    // With no shot available, closing the distance is the whole plan.
    for (const y of [0, 1, 2]) setTile(map, 7, y, "wall");
    refreshEnemyIntents(map);
    expect(scrapper.intent!.kind).toBe("close");
    expect(scrapper.intent!.targetId).toBe(rook.id);
  });

  it("actually walks toward its preferred band when left alone", () => {
    const { map, rook, scrapper } = board(11);
    const session = createAiSession();
    const startGap = Math.abs(scrapper.x - rook.x);
    for (let turn = 0; turn < 3; turn++) {
      beginUnitTurn(scrapper);
      beginEnemyTurn(map, scrapper, session);
      for (let step = 0; step < 12; step++) {
        const action = takeEnemyAction(map, scrapper, session, () => 0.5);
        if (action.kind === "wait") break;
      }
      endUnitTurn(scrapper);
    }
    expect(Math.abs(scrapper.x - rook.x)).toBeLessThan(startGap);
  });

  it("is answered by controlling the ground it has to cross", () => {
    const { map, rook, scrapper } = board(8);
    performAction(map, rook, "overwatch", null, hit);
    // Every step of the approach is now inside a covered lane.
    const check = settleOverwatch(map, rook, scrapper, { x: 9, y: 1 }, { x: 8, y: 1 });
    expect(check.fires).toBe(true);
    // And it is fragile: one reaction is a large share of its health.
    const reaction = previewShot(map, rook, scrapper);
    expect(reaction.damage / scrapper.maxHp).toBeGreaterThan(0.4);
  });
});
