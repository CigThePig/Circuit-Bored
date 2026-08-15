import { describe, expect, it } from "vitest";
import {
  availableNodes,
  chooseRecovery,
  chooseUpgrade,
  completeEncounter,
  createRun,
  enterNode,
} from "../src/run.ts";

describe("procedural run simulation", () => {
  it("completes 1,000 seeded routes without invalid transitions or rewards", () => {
    for (let seed = 0; seed < 1_000; seed++) {
      const run = createRun(`SIM-${seed}`);
      let transitions = 0;
      while (run.status !== "victory") {
        transitions += 1;
        expect(transitions).toBeLessThan(30);
        if (run.status === "route") {
          const nodes = availableNodes(run);
          expect(nodes.length).toBeGreaterThan(0);
          enterNode(run, nodes[seed % nodes.length].id);
        } else if (run.status === "encounter") {
          expect(run.activeEncounter).not.toBeNull();
          for (const enemy of run.activeEncounter!.map.units.filter((unit) => unit.team === "enemy")) {
            enemy.hp = 0;
          }
          completeEncounter(run, "victory", run.activeEncounter!.map);
        } else if (run.status === "reward") {
          expect(run.pendingRewards.length).toBeGreaterThanOrEqual(3);
          chooseUpgrade(run, run.pendingRewards[seed % run.pendingRewards.length]);
        } else if (run.status === "recovery") {
          const survivor = run.squad.find((member) => member.hp > 0);
          expect(survivor).toBeDefined();
          chooseRecovery(run, survivor!.id);
        } else {
          throw new Error(`Unexpected simulated status ${run.status}`);
        }
      }
      expect(run.depth).toBe(run.route.length);
      expect(run.stats.combatsWon).toBeGreaterThanOrEqual(5);
    }
  }, 60_000);
});
