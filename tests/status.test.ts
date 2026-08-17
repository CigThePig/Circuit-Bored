import { describe, expect, it } from "vitest";
import {
  createStatuses,
  isAimed,
  isHunkered,
  isSuppressed,
  sanitizeStatuses,
  isValidStatuses,
  setAimed,
  setHunkered,
  setSuppressed,
  statusesAreClear,
  SUPPRESSION_TURNS,
} from "../src/status.ts";
import {
  beginUnitTurn,
  endUnitTurn,
  movementRange,
  onUnitMoved,
  startingAp,
  statusLabels,
} from "../src/rules.ts";
import { cloneMap } from "../src/map.ts";
import { sanitizeLoadedMap, validateMap } from "../src/validation.ts";
import { buildMap, unit } from "./fixtures.ts";

describe("status shape", () => {
  it("treats a unit with no statuses object as entirely clear", () => {
    const u = unit({ team: "player", x: 0, y: 0 });
    expect(u.statuses).toBeUndefined();
    expect(isAimed(u)).toBe(false);
    expect(isHunkered(u)).toBe(false);
    expect(isSuppressed(u)).toBe(false);
  });

  it("does not allocate a statuses object when clearing an absent status", () => {
    const u = unit({ team: "player", x: 0, y: 0 });
    setAimed(u, false);
    setHunkered(u, false);
    setSuppressed(u, 0);
    expect(u.statuses).toBeUndefined();
  });

  it("never shares the frozen empty reading with a real unit", () => {
    const a = unit({ team: "player", x: 0, y: 0 });
    const b = unit({ team: "player", x: 1, y: 0 });
    setAimed(a, true);
    expect(isAimed(a)).toBe(true);
    expect(isAimed(b)).toBe(false);
  });

  it("reports labels in a stable order", () => {
    const u = unit({
      team: "player",
      x: 0,
      y: 0,
      overwatch: true,
      statuses: { aimed: true, hunkered: true, suppressed: 1 },
    });
    expect(statusLabels(u)).toEqual([
      "AIMED",
      "HUNKERED",
      "SUPPRESSED",
      "OVERWATCH",
    ]);
  });
});

describe("turn lifecycle", () => {
  it("clears aim, hunker, overwatch, and lean at the start of a turn", () => {
    const u = unit({
      team: "player",
      x: 0,
      y: 0,
      ap: 0,
      overwatch: true,
      statuses: { aimed: true, hunkered: true },
    });
    u.peekExposure = { x: 1, y: 1 };
    u.movesThisTurn = 3;
    beginUnitTurn(u);
    expect(u).toMatchObject({
      ap: u.maxAp,
      overwatch: false,
      peekExposure: null,
      movesThisTurn: 0,
    });
    expect(isAimed(u)).toBe(false);
    expect(isHunkered(u)).toBe(false);
  });

  it("keeps suppression through the turn it is meant to shorten", () => {
    const u = unit({ team: "player", x: 0, y: 0, statuses: { suppressed: 1 } });
    beginUnitTurn(u);
    expect(isSuppressed(u)).toBe(true);
    expect(u.ap).toBe(u.maxAp - 1);
  });

  it("expires suppression only once that turn has been played", () => {
    const u = unit({ team: "player", x: 0, y: 0, statuses: { suppressed: 1 } });
    beginUnitTurn(u);
    expect(isSuppressed(u)).toBe(true);
    endUnitTurn(u);
    expect(isSuppressed(u)).toBe(false);
    beginUnitTurn(u);
    expect(u.ap).toBe(u.maxAp);
  });

  it("reduces both shooting and walking budgets through one number", () => {
    const clean = unit({ team: "player", x: 0, y: 0, ap: 4, maxAp: 4 });
    const pinned = unit({
      team: "player",
      x: 0,
      y: 0,
      maxAp: 4,
      statuses: { suppressed: 1 },
    });
    beginUnitTurn(pinned);
    expect(startingAp(clean)).toBe(4);
    expect(startingAp(pinned)).toBe(3);
    expect(movementRange(pinned)).toBeLessThan(movementRange(clean));
  });

  it("never drives starting AP below zero", () => {
    const u = unit({ team: "player", x: 0, y: 0, maxAp: 0, ap: 0, statuses: { suppressed: 1 } });
    expect(startingAp(u)).toBe(0);
  });

  it("cancels aim and lean when the unit moves", () => {
    const u = unit({ team: "player", x: 0, y: 0, statuses: { aimed: true } });
    u.peekExposure = { x: 1, y: 1 };
    onUnitMoved(u);
    expect(isAimed(u)).toBe(false);
    expect(u.peekExposure).toBeNull();
    expect(u.movesThisTurn).toBe(1);
  });
});

describe("status persistence", () => {
  it("gives a cloned map its own statuses objects", () => {
    const map = buildMap(["..."], [{ team: "player", x: 0, y: 0, statuses: { aimed: true } }]);
    map.units.push(unit({ team: "enemy", x: 2, y: 0 }));
    const copy = cloneMap(map);
    setAimed(copy.units[0], false);
    setHunkered(copy.units[0], true);
    expect(isAimed(map.units[0])).toBe(true);
    expect(isHunkered(map.units[0])).toBe(false);
  });

  it("round-trips statuses through a save", () => {
    const map = buildMap(
      ["..."],
      [
        { team: "player", x: 0, y: 0, statuses: { aimed: true, hunkered: true } },
        { team: "enemy", x: 2, y: 0, statuses: { suppressed: 1 } },
      ],
    );
    const result = sanitizeLoadedMap(JSON.parse(JSON.stringify(map)));
    expect(result.report.hasErrors).toBe(false);
    expect(result.map!.units[0].statuses).toEqual({
      aimed: true,
      hunkered: true,
      suppressed: 0,
    });
    expect(isSuppressed(result.map!.units[1])).toBe(true);
  });

  it("loads a pre-status save without statuses rather than failing", () => {
    const map = buildMap(["..."], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 2, y: 0 },
    ]);
    const raw = JSON.parse(JSON.stringify(map)) as { units: Record<string, unknown>[] };
    for (const u of raw.units) delete u.statuses;
    const result = sanitizeLoadedMap(raw);
    expect(result.report.hasErrors).toBe(false);
    expect(result.map!.units[0].statuses).toBeUndefined();
  });

  it("drops malformed saved statuses instead of loading them", () => {
    const map = buildMap(["..."], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 2, y: 0 },
    ]);
    const raw = JSON.parse(JSON.stringify(map)) as { units: Record<string, unknown>[] };
    raw.units[0].statuses = { aimed: "yes", hunkered: 3, suppressed: -9 };
    raw.units[1].statuses = "hunkered";
    const result = sanitizeLoadedMap(raw);
    expect(result.report.hasErrors).toBe(false);
    expect(result.map!.units[0].statuses).toBeUndefined();
    expect(result.map!.units[1].statuses).toBeUndefined();
  });

  it("clamps a saved suppression that outlasts its documented duration", () => {
    expect(sanitizeStatuses({ aimed: false, hunkered: false, suppressed: 99 }))
      .toEqual({ aimed: false, hunkered: false, suppressed: SUPPRESSION_TURNS });
  });

  it("rejects a malformed statuses object during validation", () => {
    const map = buildMap(["..."], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 2, y: 0 },
    ]);
    (map.units[0] as { statuses?: unknown }).statuses = { aimed: 1 };
    const report = validateMap(map);
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === "INVALID_UNIT_STATUSES")).toBe(true);
  });

  it("accepts an absent statuses field during validation", () => {
    const map = buildMap(["..."], [
      { team: "player", x: 0, y: 0 },
      { team: "enemy", x: 2, y: 0 },
    ]);
    expect(validateMap(map).hasErrors).toBe(false);
    expect(isValidStatuses(undefined)).toBe(true);
    expect(statusesAreClear(createStatuses())).toBe(true);
  });
});
