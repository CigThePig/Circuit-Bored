import {
  UNIT_ARCHETYPES,
  UPGRADES,
  buildCombatProfile,
  getUpgrade,
  isUpgradeId,
  recoveryHealing,
  postCombatHealing,
  stackCount,
  type UnitArchetypeId,
  type UpgradeId,
} from "./content.ts";
import {
  generateEncounter,
  type EncounterKind,
  type EncounterSquadMember,
} from "./generation.ts";
import { cloneMap, type GameMap } from "./map.ts";
import { SeededRng } from "./rng.ts";
import { sanitizeLoadedMap } from "./validation.ts";

export const RUN_SAVE_VERSION = 1;
export const RUN_STORAGE_KEY = "circuit-bored.run.v1";

export type RouteNodeKind = EncounterKind | "recovery" | "cache";

export type RouteNode = {
  id: string;
  depth: number;
  kind: RouteNodeKind;
  title: string;
  description: string;
};

export type RunStatus = "route" | "encounter" | "reward" | "recovery" | "victory" | "defeat";
export type EncounterTurn = "player" | "enemy";

export type ActiveEncounter = {
  nodeId: string;
  kind: EncounterKind;
  map: GameMap;
  turn: EncounterTurn;
};

export type RunStats = {
  combatsWon: number;
  elitesWon: number;
  unitsLost: number;
  upgradesTaken: number;
};

export type RunState = {
  version: typeof RUN_SAVE_VERSION;
  seed: string;
  rngState: number;
  status: RunStatus;
  depth: number;
  route: RouteNode[][];
  chosenNodeIds: string[];
  currentNodeId: string | null;
  squad: EncounterSquadMember[];
  upgrades: UpgradeId[];
  pendingRewards: UpgradeId[];
  activeEncounter: ActiveEncounter | null;
  stats: RunStats;
};

const nodeText: Record<RouteNodeKind, { title: string; description: string }> = {
  combat: { title: "Contact", description: "Standard tactical engagement." },
  elite: { title: "Elite Signal", description: "Harder opposition; choose from four upgrades." },
  recovery: { title: "Repair Bay", description: "Restore one surviving operator." },
  cache: { title: "Encrypted Cache", description: "Choose an upgrade without a fight." },
  final: { title: "Core Breach", description: "The run's final, most dangerous encounter." },
};

function makeNode(depth: number, slot: number, kind: RouteNodeKind): RouteNode {
  return {
    id: `node-${depth}-${slot}-${kind}`,
    depth,
    kind,
    ...nodeText[kind],
  };
}

export function generateRoute(rng: SeededRng): RouteNode[][] {
  const choosePair = (depth: number, kinds: readonly RouteNodeKind[]): RouteNode[] =>
    rng.shuffle(kinds).map((kind, slot) => makeNode(depth, slot, kind));
  return [
    [makeNode(0, 0, "combat")],
    choosePair(1, ["combat", "elite"]),
    choosePair(2, ["combat", "recovery"]),
    choosePair(3, ["combat", "elite"]),
    choosePair(4, ["combat", "cache"]),
    choosePair(5, ["combat", "elite"]),
    [makeNode(6, 0, "final")],
  ];
}

function initialSquadMember(
  id: string,
  archetypeId: EncounterSquadMember["archetypeId"],
): EncounterSquadMember {
  const archetype = UNIT_ARCHETYPES[archetypeId];
  return {
    id,
    name: archetype.name,
    archetypeId,
    hp: archetype.maxHp,
    maxHp: archetype.maxHp,
    baseMaxAp: archetype.maxAp,
  };
}

export function createRun(seed: string): RunState {
  const normalized = seed.trim() || "CIRCUIT";
  const rng = new SeededRng(normalized);
  const route = generateRoute(rng);
  return {
    version: RUN_SAVE_VERSION,
    seed: normalized,
    rngState: rng.snapshot().state,
    status: "route",
    depth: 0,
    route,
    chosenNodeIds: [],
    currentNodeId: null,
    squad: [
      initialSquadMember("squad-rook", "operator"),
      initialSquadMember("squad-vex", "runner"),
      initialSquadMember("squad-hex", "bulwark"),
    ],
    upgrades: [],
    pendingRewards: [],
    activeEncounter: null,
    stats: { combatsWon: 0, elitesWon: 0, unitsLost: 0, upgradesTaken: 0 },
  };
}

export function availableNodes(run: RunState): RouteNode[] {
  return run.route[run.depth] ?? [];
}

export function currentNode(run: RunState): RouteNode | null {
  if (!run.currentNodeId) return null;
  return run.route.flat().find((node) => node.id === run.currentNodeId) ?? null;
}

function generateRewards(run: RunState, count: number): UpgradeId[] {
  const eligible = UPGRADES.filter(
    (upgrade) => stackCount(run.upgrades, upgrade.id) < upgrade.maxStacks,
  );
  if (eligible.length === 0) return [];
  const rng = new SeededRng(run.rngState);
  const rewards = rng.shuffle(eligible).slice(0, Math.min(count, eligible.length)).map((upgrade) => upgrade.id);
  run.rngState = rng.snapshot().state;
  return rewards;
}

export function enterNode(run: RunState, nodeId: string): void {
  if (run.status !== "route") throw new Error("A route node can only be entered from the route screen");
  const node = availableNodes(run).find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Node '${nodeId}' is not available`);
  run.currentNodeId = node.id;
  if (node.kind === "recovery") {
    run.status = "recovery";
    return;
  }
  if (node.kind === "cache") {
    run.pendingRewards = generateRewards(run, 3);
    run.status = "reward";
    return;
  }

  const rng = new SeededRng(run.rngState);
  const map = generateEncounter(rng, node.depth, node.kind, run.squad, run.upgrades);
  run.rngState = rng.snapshot().state;
  run.activeEncounter = { nodeId: node.id, kind: node.kind, map, turn: "player" };
  run.status = "encounter";
}

export function updateActiveEncounter(run: RunState, map: GameMap, turn: EncounterTurn): void {
  if (!run.activeEncounter || run.status !== "encounter") return;
  run.activeEncounter.map = cloneMap(map);
  run.activeEncounter.turn = turn;
}

function syncSquad(run: RunState, map: GameMap): void {
  for (const member of run.squad) {
    const unit = map.units.find((candidate) => candidate.id === member.id);
    if (!unit) continue;
    const wasAlive = member.hp > 0;
    member.hp = Math.max(0, Math.min(member.maxHp, unit.hp));
    if (wasAlive && member.hp === 0) run.stats.unitsLost += 1;
  }
}

function finishNode(run: RunState): void {
  if (run.currentNodeId) run.chosenNodeIds.push(run.currentNodeId);
  run.currentNodeId = null;
  run.pendingRewards = [];
  run.activeEncounter = null;
  run.depth += 1;
  run.status = run.depth >= run.route.length ? "victory" : "route";
}

export function completeEncounter(run: RunState, outcome: "victory" | "defeat", map: GameMap): void {
  const node = currentNode(run);
  if (!node || !run.activeEncounter) throw new Error("No active encounter to complete");
  syncSquad(run, map);
  run.activeEncounter = null;
  if (outcome === "defeat" || run.squad.every((member) => member.hp <= 0)) {
    run.status = "defeat";
    return;
  }

  run.stats.combatsWon += 1;
  if (node.kind === "elite") run.stats.elitesWon += 1;
  const healing = postCombatHealing(run.upgrades);
  if (healing > 0) {
    for (const member of run.squad) {
      if (member.hp > 0) member.hp = Math.min(member.maxHp, member.hp + healing);
    }
  }
  if (node.kind === "final") {
    finishNode(run);
    run.status = "victory";
    return;
  }
  run.pendingRewards = generateRewards(run, node.kind === "elite" ? 4 : 3);
  run.status = "reward";
}

export function chooseUpgrade(run: RunState, upgradeId: UpgradeId): void {
  if (run.status !== "reward" || !run.pendingRewards.includes(upgradeId)) {
    throw new Error(`Upgrade '${upgradeId}' is not an available reward`);
  }
  const upgrade = getUpgrade(upgradeId);
  if (stackCount(run.upgrades, upgradeId) >= upgrade.maxStacks) {
    throw new Error(`Upgrade '${upgradeId}' is already at maximum stacks`);
  }
  run.upgrades.push(upgradeId);
  run.stats.upgradesTaken += 1;
  if (upgrade.maxHp) {
    for (const member of run.squad) {
      if (member.hp <= 0) continue;
      member.maxHp = Math.max(1, member.maxHp + upgrade.maxHp);
      member.hp = Math.max(1, Math.min(member.maxHp, member.hp + upgrade.maxHp));
    }
  }
  finishNode(run);
}

export function chooseRecovery(run: RunState, memberId: string): void {
  if (run.status !== "recovery") throw new Error("Recovery is not currently available");
  const member = run.squad.find((candidate) => candidate.id === memberId && candidate.hp > 0);
  if (!member) throw new Error(`Living squad member '${memberId}' was not found`);
  member.hp = Math.min(member.maxHp, member.hp + recoveryHealing(run.upgrades));
  finishNode(run);
}

export function nextRandom(run: RunState): number {
  const rng = new SeededRng(run.rngState);
  const value = rng.next();
  run.rngState = rng.snapshot().state;
  return value;
}

export function saveRun(run: RunState): boolean {
  try {
    globalThis.localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function deleteRun(): boolean {
  try {
    globalThis.localStorage.removeItem(RUN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

type RunLoadResult = { run: RunState | null; error: string | null };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validArchetype(value: unknown): value is EncounterSquadMember["archetypeId"] {
  return value === "operator" || value === "runner" || value === "bulwark";
}

function sanitizeSquad(value: unknown): EncounterSquadMember[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return null;
  const seen = new Set<string>();
  const squad: EncounterSquadMember[] = [];
  for (const raw of value) {
    if (!isObject(raw) || typeof raw.id !== "string" || seen.has(raw.id)) return null;
    if (typeof raw.name !== "string" || !validArchetype(raw.archetypeId)) return null;
    if (!Number.isInteger(raw.hp) || !Number.isInteger(raw.maxHp) || !Number.isInteger(raw.baseMaxAp)) return null;
    const hp = raw.hp as number;
    const maxHp = raw.maxHp as number;
    const baseMaxAp = raw.baseMaxAp as number;
    if (maxHp < 1 || maxHp > 100 || hp < 0 || hp > maxHp || baseMaxAp < 1 || baseMaxAp > 20) return null;
    seen.add(raw.id);
    squad.push({ id: raw.id, name: raw.name, archetypeId: raw.archetypeId, hp, maxHp, baseMaxAp });
  }
  return squad;
}

function sanitizeUpgrades(value: unknown): UpgradeId[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const out: UpgradeId[] = [];
  for (const id of value) {
    if (!isUpgradeId(id)) return null;
    if (stackCount(out, id) >= getUpgrade(id).maxStacks) return null;
    out.push(id);
  }
  return out;
}

function rehydrateMap(
  rawMap: unknown,
  squad: readonly EncounterSquadMember[],
  upgrades: readonly UpgradeId[],
): GameMap | null {
  const sanitized = sanitizeLoadedMap(rawMap);
  if (!sanitized.map) return null;
  const sourceUnits = isObject(rawMap) && Array.isArray(rawMap.units) ? rawMap.units : [];
  for (const unit of sanitized.map.units) {
    const rawUnit = sourceUnits.find((candidate) => isObject(candidate) && candidate.id === unit.id);
    if (unit.team === "player") {
      const member = squad.find((candidate) => candidate.id === unit.id);
      if (!member) return null;
      unit.archetypeId = member.archetypeId;
      unit.displayName = member.name;
      unit.aiBehavior = UNIT_ARCHETYPES[member.archetypeId].behavior;
      unit.combat = buildCombatProfile(member.archetypeId, upgrades);
    } else {
      const requested = isObject(rawUnit) && typeof rawUnit.archetypeId === "string"
        ? rawUnit.archetypeId as UnitArchetypeId
        : "rifleman";
      const archetypeId = UNIT_ARCHETYPES[requested]?.team === "enemy" ? requested : "rifleman";
      unit.archetypeId = archetypeId;
      unit.displayName = UNIT_ARCHETYPES[archetypeId].name;
      unit.aiBehavior = UNIT_ARCHETYPES[archetypeId].behavior;
      unit.combat = buildCombatProfile(archetypeId);
    }
    const counter = (key: "movesThisTurn" | "shotsThisTurn" | "killsThisTurn" | "encounterShots") => {
      const value = isObject(rawUnit) ? rawUnit[key] : 0;
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000 ? value as number : 0;
    };
    unit.movesThisTurn = counter("movesThisTurn");
    unit.shotsThisTurn = counter("shotsThisTurn");
    unit.killsThisTurn = counter("killsThisTurn");
    unit.encounterShots = counter("encounterShots");
    unit.resolvingOverwatch = false;
    if (isObject(rawUnit) && isObject(rawUnit.peekExposure)) {
      const px = rawUnit.peekExposure.x;
      const py = rawUnit.peekExposure.y;
      if (
        Number.isInteger(px) && Number.isInteger(py) &&
        (px as number) >= 0 && (py as number) >= 0 &&
        (px as number) < sanitized.map.width && (py as number) < sanitized.map.height &&
        Math.abs((px as number) - unit.x) <= 1 &&
        Math.abs((py as number) - unit.y) <= 1 &&
        (px !== unit.x || py !== unit.y)
      ) {
        unit.peekExposure = { x: px as number, y: py as number };
      }
    }
  }
  return sanitized.map;
}

export function loadRunWithReport(): RunLoadResult {
  let rawText: string | null;
  try {
    rawText = globalThis.localStorage.getItem(RUN_STORAGE_KEY);
  } catch {
    return { run: null, error: "Run storage is unavailable in this browser." };
  }
  if (!rawText) return { run: null, error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { run: null, error: "The saved run is corrupt and could not be parsed." };
  }
  if (!isObject(raw) || raw.version !== RUN_SAVE_VERSION) {
    return { run: null, error: "The saved run uses an unsupported version." };
  }
  if (typeof raw.seed !== "string" || raw.seed.length === 0 || raw.seed.length > 80) {
    return { run: null, error: "The saved run has an invalid seed." };
  }
  const squad = sanitizeSquad(raw.squad);
  const upgrades = sanitizeUpgrades(raw.upgrades);
  const statuses: RunStatus[] = ["route", "encounter", "reward", "recovery", "victory", "defeat"];
  if (!squad || !upgrades || !statuses.includes(raw.status as RunStatus)) {
    return { run: null, error: "The saved run failed validation." };
  }
  if (!Number.isInteger(raw.rngState) || (raw.rngState as number) < 0 || (raw.rngState as number) > 0xffffffff) {
    return { run: null, error: "The saved run has invalid random state." };
  }
  const route = generateRoute(new SeededRng(raw.seed));
  if (!Number.isInteger(raw.depth) || (raw.depth as number) < 0 || (raw.depth as number) > route.length) {
    return { run: null, error: "The saved run has invalid route progress." };
  }
  const nodeIds = new Set(route.flat().map((node) => node.id));
  const currentNodeId = raw.currentNodeId === null
    ? null
    : typeof raw.currentNodeId === "string" && nodeIds.has(raw.currentNodeId)
      ? raw.currentNodeId
      : undefined;
  if (currentNodeId === undefined) return { run: null, error: "The saved run references an invalid node." };
  const chosenNodeIds = Array.isArray(raw.chosenNodeIds)
    ? raw.chosenNodeIds.filter((id): id is string => typeof id === "string" && nodeIds.has(id))
    : [];
  const pendingRewards = Array.isArray(raw.pendingRewards)
    ? raw.pendingRewards.filter(isUpgradeId)
    : [];
  const rawRewardCount = Array.isArray(raw.pendingRewards) ? raw.pendingRewards.length : -1;
  if (
    raw.status === "reward" && (
      pendingRewards.length === 0 ||
      pendingRewards.length !== rawRewardCount ||
      new Set(pendingRewards).size !== pendingRewards.length ||
      pendingRewards.some((id) => stackCount(upgrades, id) >= getUpgrade(id).maxStacks)
    )
  ) {
    return { run: null, error: "The saved reward choices failed validation." };
  }
  const rawStats = isObject(raw.stats) ? raw.stats : {};
  const stat = (key: keyof RunStats): number => {
    const value = rawStats[key];
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 10000 ? value as number : 0;
  };
  let activeEncounter: ActiveEncounter | null = null;
  if (raw.status === "encounter") {
    if (!isObject(raw.activeEncounter) || typeof raw.activeEncounter.nodeId !== "string") {
      return { run: null, error: "The active encounter save is incomplete." };
    }
    const rawEncounter = raw.activeEncounter;
    const node = route.flat().find((candidate) => candidate.id === rawEncounter.nodeId);
    if (!node || (node.kind !== "combat" && node.kind !== "elite" && node.kind !== "final")) {
      return { run: null, error: "The active encounter references an invalid node." };
    }
    const map = rehydrateMap(rawEncounter.map, squad, upgrades);
    if (!map) return { run: null, error: "The active encounter map failed validation." };
    if (currentNodeId !== node.id) {
      return { run: null, error: "The active encounter does not match current route progress." };
    }
    activeEncounter = {
      nodeId: node.id,
      kind: node.kind,
      map,
      turn: rawEncounter.turn === "enemy" ? "enemy" : "player",
    };
  }
  const selectedNode = currentNodeId
    ? route.flat().find((node) => node.id === currentNodeId) ?? null
    : null;
  if (raw.status === "route" && selectedNode !== null) {
    return { run: null, error: "The saved route has an unexpected active node." };
  }
  if (raw.status === "recovery" && selectedNode?.kind !== "recovery") {
    return { run: null, error: "The saved recovery choice references the wrong node." };
  }
  if (raw.status === "reward" && selectedNode === null) {
    return { run: null, error: "The saved reward has no source node." };
  }
  return {
    run: {
      version: RUN_SAVE_VERSION,
      seed: raw.seed,
      rngState: raw.rngState as number,
      status: raw.status as RunStatus,
      depth: raw.depth as number,
      route,
      chosenNodeIds,
      currentNodeId,
      squad,
      upgrades,
      pendingRewards,
      activeEncounter,
      stats: {
        combatsWon: stat("combatsWon"),
        elitesWon: stat("elitesWon"),
        unitsLost: stat("unitsLost"),
        upgradesTaken: stat("upgradesTaken"),
      },
    },
    error: null,
  };
}
