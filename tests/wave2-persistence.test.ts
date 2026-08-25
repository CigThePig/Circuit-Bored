import { beforeEach, describe, expect, it } from "vitest";
import { cloneMap } from "../src/map.ts";
import { getPeekPositions } from "../src/combat.ts";
import { SeededRng } from "../src/rng.ts";
import { setAimed } from "../src/status.ts";
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

  it("rejects forged squad ceilings that would redefine canonical HP and AP", () => {
    const run = encounter("FORGED-SQUAD-STATS");
    const raw = serialized(run);
    const member = raw.squad[0];
    const player = raw.activeEncounter.map.units.find(
      (unit: { id: string }) => unit.id === member.id,
    );
    Object.assign(member, { hp: 100, maxHp: 100, baseMaxAp: 20 });
    Object.assign(player, { hp: 100, maxHp: 100, ap: 20, maxAp: 20 });
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });

  it("rejects an encounter node that does not belong to the saved route depth", () => {
    const run = encounter("SKIPPED-ROUTE");
    const raw = serialized(run);
    const finalNode = raw.route.at(-1)[0];
    raw.currentNodeId = finalNode.id;
    raw.activeEncounter.nodeId = finalNode.id;
    raw.activeEncounter.kind = "final";
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });

  it("rejects duplicated or out-of-order route history instead of canonicalizing it", () => {
    const run = createRun("FORGED-HISTORY");
    const raw = serialized(run);
    raw.depth = 2;
    raw.chosenNodeIds = [raw.route[0][0].id, raw.route[0][0].id];
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });

  it("rejects upgrades and statistics that were not earned by completed nodes", () => {
    const raw = serialized(createRun("FORGED-PROGRESSION-VALUES"));
    raw.upgrades = ["smartlink"];
    raw.stats.upgradesTaken = 1;
    raw.stats.combatsWon = 7;
    store(raw);

    expect(loadRunWithReport().run).toBeNull();
  });

  it("round-trips a geometrically legal committed peek exposure", () => {
    const run = encounter("LEGAL-PEEK-SNAPSHOT");
    const map = run.activeEncounter!.map;
    const player = map.units.find((unit) => unit.team === "player")!;
    const occupied = new Set(
      map.units
        .filter((unit) => unit.hp > 0 && unit.id !== player.id)
        .map((unit) => `${unit.x},${unit.y}`),
    );
    let placement: { x: number; y: number; exposure: { x: number; y: number } } | null = null;
    for (let y = 0; y < map.height && !placement; y++) {
      for (let x = 0; x < map.width && !placement; x++) {
        if (map.tiles[y * map.width + x] !== "floor" || occupied.has(`${x},${y}`)) continue;
        const exposure = getPeekPositions(map, x, y).find((point) =>
          map.tiles[point.y * map.width + point.x] === "floor" &&
          !occupied.has(`${point.x},${point.y}`)
        );
        if (exposure) placement = { x, y, exposure };
      }
    }
    expect(placement).not.toBeNull();
    player.x = placement!.x;
    player.y = placement!.y;
    player.peekExposure = placement!.exposure;
    updateActiveEncounter(run, map, "player");
    expect(saveRun(run)).toBe(true);

    const loaded = loadRunWithReport();
    expect(loaded.error).toBeNull();
    expect(loaded.run!.activeEncounter!.map.units.find((unit) => unit.id === player.id)!.peekExposure)
      .toEqual(placement!.exposure);
  });

  it("rejects a cardinal adjacent tile as a committed peek exposure", () => {
    const run = encounter("ILLEGAL-PEEK-SNAPSHOT");
    const raw = serialized(run);
    const player = raw.activeEncounter.map.units.find(
      (unit: { team: string }) => unit.team === "player",
    );
    const occupied = new Set(
      raw.activeEncounter.map.units
        .filter((unit: { hp: number; id: string }) => unit.hp > 0 && unit.id !== player.id)
        .map((unit: { x: number; y: number }) => `${unit.x},${unit.y}`),
    );
    const cardinal = [
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ].find((point) =>
      point.x >= 0 && point.y >= 0 &&
      point.x < raw.activeEncounter.map.width && point.y < raw.activeEncounter.map.height &&
      raw.activeEncounter.map.tiles[point.y * raw.activeEncounter.map.width + point.x] === "floor" &&
      !occupied.has(`${point.x},${point.y}`)
    );
    expect(cardinal).toBeDefined();
    player.peekExposure = cardinal;
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

  it("still recognises its own phase start after the run has been reloaded", () => {
    // The board a save is opened with and the board a runtime clones are built
    // by different literals. Recognising the phase start has to depend on the
    // state they describe, not on the order their fields happen to be written
    // in, or a resumed encounter never rolls its abandoned draws back.
    const run = encounter("RNG-RELOAD-ROLLBACK");
    updateActiveEncounter(run, cloneMap(run.activeEncounter!.map), "enemy");
    expect(saveRun(run)).toBe(true);

    const resumed = loadRunWithReport().run!;
    expect(resumed.activeEncounter!.turn).toBe("enemy");
    const before = resumed.rngState;
    const expectedFirstRoll = new SeededRng(before).next();
    expect(nextRandom(resumed)).toBe(expectedFirstRoll);

    // The abandoned runtime is replaced; the new one reports the same phase
    // start it was mounted on, which must discard the draw above.
    updateActiveEncounter(resumed, cloneMap(resumed.activeEncounter!.map), "enemy");
    expect(nextRandom(resumed)).toBe(expectedFirstRoll);
    expect(resumed.rngState).toBe(before);
  });

  it("round-trips a board whose last tactical status has already expired", () => {
    // A unit that used Aim and then spent it keeps an all-default status object
    // in memory, while the save format stores "nothing active" as no object at
    // all. Both mean the same thing, so a reload has to produce the same board.
    const run = encounter("EXPIRED-STATUS");
    const live = run.activeEncounter!.map;
    const unit = live.units.find((candidate) => candidate.team === "player")!;
    setAimed(unit, true);
    setAimed(unit, false);
    expect(unit.statuses).toBeDefined();

    updateActiveEncounter(run, live, "player");
    const committed = run.activeEncounter!.map;
    expect(saveRun(run)).toBe(true);

    const loaded = loadRunWithReport();
    expect(loaded.error).toBeNull();
    expect(loaded.run!.activeEncounter!.map).toEqual(committed);
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
