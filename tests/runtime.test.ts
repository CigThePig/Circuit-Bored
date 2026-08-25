import { describe, expect, it } from "vitest";
import { encounterOutcome, shouldShowShotPrediction } from "../src/runtime.ts";
import { buildMap } from "./fixtures.ts";

describe("encounter outcome restoration", () => {
  it("detects a persisted terminal encounter before runtime input begins", () => {
    const map = buildMap(["..."]);
    map.units = [
      { id: "player", team: "player", x: 0, y: 0, hp: 5, maxHp: 5, ap: 2, maxAp: 2, overwatch: false, peekExposure: null },
      { id: "enemy", team: "enemy", x: 2, y: 0, hp: 0, maxHp: 5, ap: 2, maxAp: 2, overwatch: false, peekExposure: null },
    ];
    expect(encounterOutcome(map)).toBe("victory");
  });
});

describe("target preview ownership", () => {
  it("shows shot numbers only when the pending target interaction is a shot", () => {
    expect(shouldShowShotPrediction("shoot")).toBe(true);
    expect(shouldShowShotPrediction("suppress")).toBe(false);
    expect(shouldShowShotPrediction("mark")).toBe(false);
    expect(shouldShowShotPrediction("guard")).toBe(false);
  });
});
