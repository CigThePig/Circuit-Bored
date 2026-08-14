import { beforeEach, describe, expect, it } from "vitest";
import { getUpgrade } from "../src/content.ts";
import {
  RUN_STORAGE_KEY,
  availableNodes,
  chooseRecovery,
  chooseUpgrade,
  completeEncounter,
  createRun,
  deleteRun,
  enterNode,
  generateRoute,
  loadRunWithReport,
  saveRun,
  updateActiveEncounter,
} from "../src/run.ts";
import { SeededRng } from "../src/rng.ts";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

function enterFirstCombat(seed = "RUN-TEST") {
  const run = createRun(seed);
  enterNode(run, availableNodes(run)[0].id);
  if (!run.activeEncounter) throw new Error("Expected an encounter");
  return run;
}

describe("route generation", () => {
  it("is deterministic, branched, and always reaches a final encounter", () => {
    const a = generateRoute(new SeededRng("ROUTE"));
    const b = generateRoute(new SeededRng("ROUTE"));
    expect(a).toEqual(b);
    expect(a).toHaveLength(7);
    expect(a.filter((column) => column.length > 1).length).toBeGreaterThanOrEqual(4);
    expect(a.at(-1)).toHaveLength(1);
    expect(a.at(-1)?.[0].kind).toBe("final");
  });

  it("changes route choices for different seeds", () => {
    expect(generateRoute(new SeededRng("A"))).not.toEqual(generateRoute(new SeededRng("B")));
  });
});

describe("run lifecycle", () => {
  it("carries damage and death forward while refreshing encounter AP", () => {
    const run = enterFirstCombat();
    const map = run.activeEncounter!.map;
    const [rook, vex] = map.units.filter((unit) => unit.team === "player");
    rook.hp = 4;
    rook.ap = 0;
    vex.hp = 0;
    for (const enemy of map.units.filter((unit) => unit.team === "enemy")) enemy.hp = 0;
    completeEncounter(run, "victory", map);
    expect(run.squad.find((member) => member.id === rook.id)?.hp).toBe(4);
    expect(run.squad.find((member) => member.id === vex.id)?.hp).toBe(0);
    chooseUpgrade(run, run.pendingRewards[0]);
    enterNode(run, availableNodes(run)[0].id);
    const nextMap = run.activeEncounter!.map;
    expect(nextMap.units.find((unit) => unit.id === rook.id)?.hp).toBeGreaterThanOrEqual(4);
    expect(nextMap.units.find((unit) => unit.id === rook.id)?.ap)
      .toBe(nextMap.units.find((unit) => unit.id === rook.id)?.maxAp);
    expect(nextMap.units.some((unit) => unit.id === vex.id)).toBe(false);
  });

  it("offers deterministic legal rewards and applies exactly one", () => {
    const a = enterFirstCombat("REWARD");
    const b = enterFirstCombat("REWARD");
    for (const run of [a, b]) {
      for (const enemy of run.activeEncounter!.map.units.filter((unit) => unit.team === "enemy")) enemy.hp = 0;
      completeEncounter(run, "victory", run.activeEncounter!.map);
    }
    expect(a.pendingRewards).toEqual(b.pendingRewards);
    expect(new Set(a.pendingRewards).size).toBe(a.pendingRewards.length);
    const chosen = a.pendingRewards[0];
    chooseUpgrade(a, chosen);
    expect(a.upgrades).toEqual([chosen]);
    expect(a.stats.upgradesTaken).toBe(1);
    expect(a.status).toBe("route");
    expect(getUpgrade(chosen)).toBeDefined();
  });

  it("applies recovery without reviving dead operators", () => {
    const run = createRun("RECOVERY");
    run.depth = 2;
    run.squad[0].hp = 1;
    run.squad[1].hp = 0;
    const recovery = availableNodes(run).find((node) => node.kind === "recovery")!;
    enterNode(run, recovery.id);
    chooseRecovery(run, run.squad[0].id);
    expect(run.squad[0].hp).toBe(5);
    expect(run.squad[1].hp).toBe(0);
    expect(run.depth).toBe(3);
  });

  it("ends immediately in defeat when the squad is destroyed", () => {
    const run = enterFirstCombat("DEFEAT");
    for (const player of run.activeEncounter!.map.units.filter((unit) => unit.team === "player")) player.hp = 0;
    completeEncounter(run, "defeat", run.activeEncounter!.map);
    expect(run.status).toBe("defeat");
    expect(run.squad.every((member) => member.hp === 0)).toBe(true);
  });

  it("reaches victory after completing the final node", () => {
    const run = createRun("VICTORY");
    run.depth = run.route.length - 1;
    const final = availableNodes(run)[0];
    enterNode(run, final.id);
    for (const enemy of run.activeEncounter!.map.units.filter((unit) => unit.team === "enemy")) enemy.hp = 0;
    completeEncounter(run, "victory", run.activeEncounter!.map);
    expect(run.status).toBe("victory");
    expect(run.depth).toBe(run.route.length);
  });
});

describe("run persistence", () => {
  it("round-trips an active encounter including turn and tactical state", () => {
    const run = enterFirstCombat("SAVE-ME");
    const map = run.activeEncounter!.map;
    const player = map.units.find((unit) => unit.team === "player")!;
    player.hp -= 3;
    player.x += 1;
    player.ap = 1;
    player.peekExposure = { x: player.x, y: player.y + 1 };
    updateActiveEncounter(run, map, "enemy");
    expect(saveRun(run)).toBe(true);
    const loaded = loadRunWithReport();
    expect(loaded.error).toBeNull();
    expect(loaded.run?.activeEncounter?.turn).toBe("enemy");
    expect(loaded.run?.activeEncounter?.map.units.find((unit) => unit.id === player.id))
      .toMatchObject({ hp: player.hp, x: player.x, ap: 1, peekExposure: player.peekExposure });
  });

  it("fails safely for corrupt and incompatible saves", () => {
    localStorage.setItem(RUN_STORAGE_KEY, "{broken");
    expect(loadRunWithReport()).toMatchObject({ run: null });
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: 999 }));
    expect(loadRunWithReport().error).toContain("unsupported");
  });

  it("rejects reward selections that were not offered", () => {
    const run = enterFirstCombat("BAD-REWARD");
    for (const enemy of run.activeEncounter!.map.units.filter((unit) => unit.team === "enemy")) enemy.hp = 0;
    completeEncounter(run, "victory", run.activeEncounter!.map);
    const invalid = getUpgrade("reinforced_chassis").id;
    if (!run.pendingRewards.includes(invalid)) {
      expect(() => chooseUpgrade(run, invalid)).toThrow(/not an available reward/);
    }
  });

  it("reports unavailable storage without throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => { throw new DOMException("blocked", "SecurityError"); },
        setItem: () => { throw new DOMException("blocked", "SecurityError"); },
        removeItem: () => { throw new DOMException("blocked", "SecurityError"); },
      },
    });
    expect(() => loadRunWithReport()).not.toThrow();
    expect(saveRun(createRun("NO-STORAGE"))).toBe(false);
    expect(deleteRun()).toBe(false);
  });
});
