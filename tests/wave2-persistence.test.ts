import { beforeEach, describe, expect, it } from "vitest";
import { cloneMap } from "../src/map.ts";
import { SeededRng } from "../src/rng.ts";
import {
  RUN_STORAGE_KEY,
  availableNodes,
  createRun,
  enterNode,
  loadRunWithReport,
  nextRandom,
  saveRun,
  updateActiveEncounter,
} from "../src/run.ts";

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

function encounter(seed: string) {
  const run = createRun(seed);
  enterNode(run, availableNodes(run)[0].id);
  if (!run.activeEncounter) throw new Error("Expected an active encounter");
  return run;
}

function serialized(run: ReturnType<typeof createRun>): any {
  return JSON.parse(JSON.stringify(run));
}

function store(raw: unknown): void {
  localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(raw));
}

describe("Wave 2 strict active snapshots", () => {
  it("rejects terrain corruption instead of repairing it into floor", () => {
    const run = encounter("STRICT-TILE");
    const raw = serialized(run);
    raw.activeEncounter.map.tiles[0] = "lava";
    store(raw);

    const loaded = loadRunWithReport();
    expect(loaded.run).toBeNull();
    expect(loaded.error).toContain("strict validation");
  });

  it("rejects an encounter that silently loses an operator who entered it", () => {
    const run = encounter("STRICT-SQUAD");
    const raw = serialized(run);
    const playerIndex = raw.activeEncounter.map.units.findIndex(
      (unit: { team: string }) => unit.team === "player",
    );
    raw.activeEncounter.map.units.splice(playerIndex, 1);
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });

  it("accepts a legitimate terminal snapshot before its victory overlay is acknowledged", () => {
    const run = encounter("TERMINAL-SNAPSHOT");
    for (const enemy of run.activeEncounter!.map.units.filter((unit) => unit.team === "enemy")) {
      enemy.hp = 0;
    }
    expect(saveRun(run)).toBe(true);

    const loaded = loadRunWithReport();
    expect(loaded.error).toBeNull();
    expect(
      loaded.run!.activeEncounter!.map.units
        .filter((unit) => unit.team === "enemy")
        .every((unit) => unit.hp === 0),
    ).toBe(true);
  });

  it("rebuilds canonical max HP and AP instead of trusting serialized ceilings", () => {
    const run = encounter("CANONICAL-STATS");
    const raw = serialized(run);
    const player = raw.activeEncounter.map.units.find(
      (unit: { team: string }) => unit.team === "player",
    );
    const member = raw.squad.find((candidate: { id: string }) => candidate.id === player.id);
    player.maxHp = 999999;
    player.maxAp = 999999;
    player.hp = Math.min(player.hp, member.maxHp);
    player.ap = 1;
    store(raw);

    const loaded = loadRunWithReport();
    expect(loaded.error).toBeNull();
    const restored = loaded.run!.activeEncounter!.map.units.find((unit) => unit.id === player.id)!;
    expect(restored.maxHp).toBe(member.maxHp);
    expect(restored.maxAp).toBe(member.baseMaxAp);
  });

  it("rejects current AP that exceeds the canonical action economy", () => {
    const run = encounter("CANONICAL-AP-FAIL");
    const raw = serialized(run);
    const player = raw.activeEncounter.map.units.find(
      (unit: { team: string }) => unit.team === "player",
    );
    player.maxAp = 999999;
    player.ap = 500000;
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });

  it("rejects structurally valid but impossible role/status combinations", () => {
    const run = encounter("STATUS-SEMANTICS");
    const raw = serialized(run);
    const rook = raw.activeEncounter.map.units.find(
      (unit: { archetypeId?: string }) => unit.archetypeId === "operator",
    );
    rook.statuses = {
      aimed: false,
      hunkered: false,
      suppressed: 0,
      marked: 0,
      markedBy: null,
      braced: false,
      dashing: false,
      overwatchEvasion: 1,
      guardedBy: null,
    };
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });

  it("rejects malformed turn-local counters instead of silently zeroing them", () => {
    const run = encounter("COUNTER-STRICTNESS");
    const raw = serialized(run);
    const player = raw.activeEncounter.map.units.find(
      (unit: { team: string }) => unit.team === "player",
    );
    player.movesThisTurn = "many";
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });
});

describe("Wave 2 atomic encounter persistence", () => {
  it("keeps an enemy phase at its saved start until the whole phase finishes", () => {
    const run = encounter("ATOMIC-ENEMY");
    const phaseStart = cloneMap(run.activeEncounter!.map);

    updateActiveEncounter(run, phaseStart, "enemy");
    expect(run.activeEncounter!.turn).toBe("enemy");
    const savedStart = cloneMap(run.activeEncounter!.map);

    const partial = cloneMap(phaseStart);
    const enemy = partial.units.find((unit) => unit.team === "enemy")!;
    enemy.ap = Math.max(0, enemy.ap - 1);
    updateActiveEncounter(run, partial, "enemy");

    expect(run.activeEncounter!.map).toEqual(savedStart);
    expect(run.activeEncounter!.turn).toBe("enemy");

    updateActiveEncounter(run, partial, "player");
    expect(run.activeEncounter!.map).toEqual(partial);
    expect(run.activeEncounter!.turn).toBe("player");
  });

  it("keeps encounter RNG private until the battlefield snapshot commits", () => {
    const run = encounter("RNG-TRANSACTION");
    const before = run.rngState;
    const changed = cloneMap(run.activeEncounter!.map);
    changed.units[0].ap = Math.max(0, changed.units[0].ap - 1);

    nextRandom(run);
    nextRandom(run);
    expect(run.rngState).toBe(before);

    updateActiveEncounter(run, changed, "player");
    expect(run.rngState).not.toBe(before);
  });

  it("discards abandoned enemy-phase draws when the same saved phase is resumed", () => {
    const run = encounter("RNG-ROLLBACK");
    const phaseStart = cloneMap(run.activeEncounter!.map);
    updateActiveEncounter(run, phaseStart, "enemy");
    const before = run.rngState;
    const control = new SeededRng(before);
    const expectedFirstRoll = control.next();

    const abandonedFirstRoll = nextRandom(run);
    expect(abandonedFirstRoll).toBe(expectedFirstRoll);
    expect(run.rngState).toBe(before);

    const partial = cloneMap(phaseStart);
    partial.units.find((unit) => unit.team === "enemy")!.ap -= 1;
    updateActiveEncounter(run, partial, "enemy");
    expect(run.activeEncounter!.map).toEqual(phaseStart);
    expect(run.rngState).toBe(before);

    // A newly mounted runtime first reports exactly the persisted phase start.
    // That boundary discards the abandoned private cursor.
    updateActiveEncounter(run, cloneMap(run.activeEncounter!.map), "enemy");
    expect(nextRandom(run)).toBe(expectedFirstRoll);
    expect(run.rngState).toBe(before);
  });

  it("commits the whole enemy result and its random cursor together", () => {
    const run = encounter("RNG-ENEMY-COMMIT");
    const phaseStart = cloneMap(run.activeEncounter!.map);
    updateActiveEncounter(run, phaseStart, "enemy");
    const before = run.rngState;

    nextRandom(run);
    const final = cloneMap(phaseStart);
    final.units.find((unit) => unit.team === "player")!.hp -= 1;
    updateActiveEncounter(run, final, "player");

    expect(run.activeEncounter!.map).toEqual(final);
    expect(run.activeEncounter!.turn).toBe("player");
    expect(run.rngState).not.toBe(before);
  });
});
