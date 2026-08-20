import { describe, expect, it } from "vitest";
import {
  UPGRADES,
  makeArchetypeUnit,
  maxApWithUpgrades,
  type UpgradeId,
} from "../src/content.ts";
import { generateEncounter } from "../src/generation.ts";
import { SeededRng } from "../src/rng.ts";
import {
  availableNodes,
  completeEncounter,
  createRun,
  enterNode,
} from "../src/run.ts";

function apUpgradeIds(): UpgradeId[] {
  return UPGRADES
    .filter((upgrade) => (upgrade.maxAp ?? 0) !== 0)
    .flatMap((upgrade) => Array.from({ length: upgrade.maxStacks }, () => upgrade.id));
}

function saturateRewardPoolExcept(
  run: ReturnType<typeof createRun>,
  keep: readonly UpgradeId[],
): void {
  const kept = new Set(keep);
  run.upgrades = UPGRADES.flatMap((upgrade) => {
    const stacks = kept.has(upgrade.id) ? Math.max(0, upgrade.maxStacks - 1) : upgrade.maxStacks;
    return Array.from({ length: stacks }, () => upgrade.id);
  });
}

describe("Wave 4 canonical progression stats", () => {
  it("derives generated player AP from every upgrade that declares maxAp", () => {
    const run = createRun("WAVE4-AP-CANON");
    const upgrades = apUpgradeIds();
    const map = generateEncounter(new SeededRng(44), 0, "combat", run.squad, upgrades);

    for (const member of run.squad) {
      const unit = map.units.find((candidate) => candidate.id === member.id)!;
      expect(unit.maxAp).toBe(maxApWithUpgrades(member.baseMaxAp, upgrades));
      expect(unit.ap).toBe(unit.maxAp);
    }
  });

  it("uses the same AP calculation for direct archetype construction", () => {
    const upgrades = apUpgradeIds();
    const unit = makeArchetypeUnit("runner", "vex", 1, 1, upgrades);
    expect(unit.maxAp).toBe(maxApWithUpgrades(5, upgrades));
  });
});

describe("Wave 4 future-aware rewards", () => {
  it("keeps Triage Protocol eligible while a Recovery depth is still ahead", () => {
    const run = createRun("WAVE4-TRIAGE-FUTURE");
    run.depth = 1;
    saturateRewardPoolExcept(run, ["triage_protocol", "smartlink"]);
    const combat = availableNodes(run).find((node) => node.kind === "combat")!;
    enterNode(run, combat.id);
    for (const enemy of run.activeEncounter!.map.units.filter((unit) => unit.team === "enemy")) {
      enemy.hp = 0;
    }
    // This test is about reward construction, not tactical resolution.
    completeEncounter(run, "victory", run.activeEncounter!.map);

    expect(run.pendingRewards).toContain("triage_protocol");
  });

  it("removes Triage Protocol once the only Recovery depth is behind the run", () => {
    const run = createRun("WAVE4-TRIAGE-SPENT");
    run.depth = 4;
    saturateRewardPoolExcept(run, ["triage_protocol", "smartlink"]);
    const cache = availableNodes(run).find((node) => node.kind === "cache")!;
    enterNode(run, cache.id);

    expect(run.pendingRewards).not.toContain("triage_protocol");
    expect(run.pendingRewards).toContain("smartlink");
  });
});
