import {
  UNIT_ARCHETYPES,
  UPGRADES,
  buildCombatProfile,
  getUpgrade,
  isUpgradeId,
  maxApWithUpgrades,
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
import { sanitizeLoadedMap, validateMap } from "./validation.ts";

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

type EncounterRngSession = {
  rng: SeededRng;
  /** Persistent state this private cursor was forked from or last committed to. */
  committedState: number;
};

const encounterRngSessions = new WeakMap<RunState, EncounterRngSession>();

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

/** Tactical circuits tied to a role should disappear when nobody can use them. */
const ROLE_UPGRADE_REQUIREMENTS: Partial<
  Record<UpgradeId, EncounterSquadMember["archetypeId"]>
> = {
  target_designator: "operator",
  sprint_servos: "runner",
  shield_projector: "bulwark",
};

function hasFutureRouteNode(run: RunState, kind: RouteNodeKind): boolean {
  // Rewards are rolled after the current depth's node has already been chosen.
  // The unchosen sibling at this same depth is no longer reachable, so only
  // later depth layers can consume a future-only upgrade.
  return run.route
    .slice(run.depth + 1)
    .some((layer) => layer.some((node) => node.kind === kind));
}

function upgradeHasFutureConsumer(run: RunState, id: UpgradeId): boolean {
  const required = ROLE_UPGRADE_REQUIREMENTS[id];
  if (
    required &&
    !run.squad.some((member) => member.archetypeId === required && member.hp > 0)
  ) {
    return false;
  }
  if (id === "triage_protocol" && !hasFutureRouteNode(run, "recovery")) {
    return false;
  }
  return true;
}

/**
 * Lightly bias a reward toward the build the player has already begun without
 * turning a seeded roguelike into a deterministic shopping list. Existing
 * stacks and tags are useful signals that a circuit participates in an actual
 * plan; the seeded shuffle remains the tie-break, so different runs still
 * surface different combinations.
 */
function rewardContextScore(run: RunState, id: UpgradeId): number {
  const candidate = getUpgrade(id);
  let score = stackCount(run.upgrades, id) > 0 ? 2 : 0;
  for (const installedId of run.upgrades) {
    if (getUpgrade(installedId).tag === candidate.tag) score += 1;
  }
  // Tactical actions are the systems that make positioning alter the fight,
  // so they receive a small nudge rather than competing only on flat stats.
  if (candidate.tag === "tactic") score += 1;
  return score;
}

function generateRewards(run: RunState, count: number): UpgradeId[] {
  const eligible = UPGRADES.filter(
    (upgrade) =>
      stackCount(run.upgrades, upgrade.id) < upgrade.maxStacks &&
      upgradeHasFutureConsumer(run, upgrade.id),
  );
  if (eligible.length === 0) return [];

  const rng = new SeededRng(run.rngState);
  const ranked = rng.shuffle(eligible)
    .map((upgrade, tieBreak) => ({
      upgrade,
      tieBreak,
      score: rewardContextScore(run, upgrade.id),
    }))
    .sort((a, b) => b.score - a.score || a.tieBreak - b.tieBreak)
    .map(({ upgrade }) => upgrade);

  const selected: typeof ranked = [];
  const tactical = ranked.find((upgrade) => upgrade.tag === "tactic");
  if (tactical && count > 0) selected.push(tactical);
  for (const upgrade of ranked) {
    if (selected.includes(upgrade)) continue;
    selected.push(upgrade);
    if (selected.length >= Math.min(count, eligible.length)) break;
  }

  run.rngState = rng.snapshot().state;
  return selected.map((upgrade) => upgrade.id);
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
  encounterRngSessions.delete(run);
  run.activeEncounter = { nodeId: node.id, kind: node.kind, map, turn: "player" };
  run.status = "encounter";
}

function mapSnapshotsEqual(a: GameMap, b: GameMap): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function encounterRngSession(run: RunState): EncounterRngSession {
  const existing = encounterRngSessions.get(run);
  if (existing && existing.committedState === run.rngState) return existing;
  const created = { rng: new SeededRng(run.rngState), committedState: run.rngState };
  encounterRngSessions.set(run, created);
  return created;
}

/**
 * Commit pending combat randomness only when the matching battlefield snapshot
 * also commits. A freshly mounted runtime immediately reports its source map;
 * if the previous runtime was cancelled mid-animation, that identical report
 * discards abandoned random draws instead of resurrecting them on resume.
 */
function settleEncounterRandomness(run: RunState, map: GameMap, turn: EncounterTurn): void {
  const active = run.activeEncounter;
  const session = encounterRngSessions.get(run);
  if (!active || !session) return;
  const staged = session.rng.snapshot().state;
  if (staged === run.rngState) return;
  if (turn === active.turn && mapSnapshotsEqual(map, active.map)) {
    session.rng = new SeededRng(run.rngState);
    session.committedState = run.rngState;
    return;
  }
  run.rngState = staged;
  session.committedState = staged;
}

/**
 * Commit a runtime snapshot. Player actions remain individually durable, but
 * an enemy phase is one transaction: its start is saved, intermediate hostile
 * actions are deliberately ignored, and the whole resulting board + RNG cursor
 * commit when control returns to the player. Closing the app mid-phase therefore
 * replays that phase from the same board with the same random sequence instead
 * of resuming from a half-scheduled state.
 */
export function updateActiveEncounter(run: RunState, map: GameMap, turn: EncounterTurn): void {
  if (!run.activeEncounter || run.status !== "encounter") return;
  const active = run.activeEncounter;
  if (active.turn === "enemy" && turn === "enemy") {
    // The first notification from a resumed runtime is byte-for-byte the saved
    // phase start. Use it to roll back any abandoned in-memory RNG cursor, but
    // never commit an intermediate enemy action.
    if (mapSnapshotsEqual(map, active.map)) settleEncounterRandomness(run, map, turn);
    return;
  }
  settleEncounterRandomness(run, map, turn);
  active.map = cloneMap(map);
  active.turn = turn;
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
  encounterRngSessions.delete(run);
  run.depth += 1;
  run.status = run.depth >= run.route.length ? "victory" : "route";
}

export function completeEncounter(run: RunState, outcome: "victory" | "defeat", map: GameMap): void {
  const node = currentNode(run);
  if (!node || !run.activeEncounter) throw new Error("No active encounter to complete");
  syncSquad(run, map);
  run.activeEncounter = null;
  encounterRngSessions.delete(run);
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
      member.hp = upgrade.maxHp > 0
        ? Math.min(member.maxHp, member.hp + upgrade.maxHp)
        : Math.min(member.maxHp, member.hp);
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
  // Outside combat there is no animation boundary, so random state can commit
  // immediately. Encounter rolls use a private cursor until the board commits.
  if (run.status !== "encounter" || !run.activeEncounter) {
    const rng = new SeededRng(run.rngState);
    const value = rng.next();
    run.rngState = rng.snapshot().state;
    return value;
  }
  return encounterRngSession(run).rng.next();
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

function canonicalPlayerMaxAp(
  member: EncounterSquadMember,
  upgrades: readonly UpgradeId[],
): number {
  return maxApWithUpgrades(member.baseMaxAp, upgrades);
}

function activeMapStructureIsValid(rawMap: unknown): rawMap is GameMap {
  if (!isObject(rawMap) || !Array.isArray(rawMap.tiles) || !Array.isArray(rawMap.units)) return false;
  const candidate = rawMap as unknown as GameMap;
  const report = validateMap(candidate);
  const livingPlayers = candidate.units.filter((unit) =>
    isObject(unit) && unit.team === "player" && typeof unit.hp === "number" && unit.hp > 0
  ).length;
  const livingEnemies = candidate.units.filter((unit) =>
    isObject(unit) && unit.team === "enemy" && typeof unit.hp === "number" && unit.hp > 0
  ).length;
  const terminalPlayerDefeat = livingPlayers === 0 && livingEnemies > 0;
  const terminalEnemyDefeat = livingEnemies === 0 && livingPlayers > 0;
  return !report.issues.some((issue) => {
    if (issue.severity !== "error") return false;
    if (issue.code === "NO_PLAYER_SPAWN" && terminalPlayerDefeat) return false;
    if (issue.code === "NO_ENEMY_SPAWN" && terminalEnemyDefeat) return false;
    return true;
  });
}

function activeStatusesAreSemanticallyValid(map: GameMap): boolean {
  for (const unit of map.units) {
    const statuses = unit.statuses;
    if (statuses) {
      if (!statuses.dashing && statuses.overwatchEvasion > 0) return false;
      if (statuses.dashing && unit.archetypeId !== "runner") return false;
      if (statuses.braced && unit.archetypeId !== "bulwark") return false;
      if (statuses.guardedBy) {
        const guardian = map.units.find((candidate) => candidate.id === statuses.guardedBy);
        if (!guardian || guardian.id === unit.id || guardian.team !== unit.team || guardian.archetypeId !== "bulwark") {
          return false;
        }
      }
      if (statuses.markedBy) {
        const marker = map.units.find((candidate) => candidate.id === statuses.markedBy);
        if (!marker || marker.team === unit.team || marker.archetypeId !== "operator") return false;
      }
    }
    if ((unit.relaysThisTurn ?? 0) > 0 && unit.archetypeId !== "operator") return false;
    if ((unit.relaysThisTurn ?? 0) > 1 || (unit.flankRefundsThisTurn ?? 0) > 1) return false;
    const reactionLimit = 1 + Math.max(0, unit.combat?.extraOverwatchReactions ?? 0);
    if ((unit.overwatchShotsUsed ?? 0) > reactionLimit) return false;
    if (unit.overwatch && (unit.overwatchShotsUsed ?? 0) >= reactionLimit) return false;
  }
  return true;
}

function rehydrateMap(
  rawMap: unknown,
  squad: readonly EncounterSquadMember[],
  upgrades: readonly UpgradeId[],
): GameMap | null {
  // Editor-map loading remains deliberately forgiving. An active encounter is
  // historical state, so repairing it would silently rewrite the run instead.
  if (!activeMapStructureIsValid(rawMap)) return null;
  const sanitized = sanitizeLoadedMap(rawMap);
  if (!sanitized.map) return null;
  const sourceUnits = isObject(rawMap) && Array.isArray(rawMap.units) ? rawMap.units : [];

  // Every operator alive when this node was entered remains represented even
  // after dying inside it. Operators lost before the encounter are absent.
  const expectedPlayers = new Set(squad.filter((member) => member.hp > 0).map((member) => member.id));
  const actualPlayers = sanitized.map.units.filter((unit) => unit.team === "player");
  if (actualPlayers.length !== expectedPlayers.size || actualPlayers.some((unit) => !expectedPlayers.has(unit.id))) {
    return null;
  }

  const readCounter = (
    rawUnit: Record<string, unknown>,
    key:
      | "movesThisTurn"
      | "shotsThisTurn"
      | "killsThisTurn"
      | "encounterShots"
      | "overwatchShotsUsed"
      | "relaysThisTurn"
      | "flankRefundsThisTurn",
  ): number | null => {
    if (rawUnit[key] === undefined) return 0;
    const value = rawUnit[key];
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000
      ? value as number
      : null;
  };

  for (const unit of sanitized.map.units) {
    const rawUnit = sourceUnits.find((candidate) => isObject(candidate) && candidate.id === unit.id);
    if (!rawUnit || !isObject(rawUnit)) return null;
    if (rawUnit.resolvingOverwatch !== undefined && rawUnit.resolvingOverwatch !== false) return null;

    if (unit.team === "player") {
      const member = squad.find((candidate) => candidate.id === unit.id);
      if (!member) return null;
      const canonicalMaxAp = canonicalPlayerMaxAp(member, upgrades);
      if (unit.hp > member.maxHp || unit.ap > canonicalMaxAp) return null;
      unit.maxHp = member.maxHp;
      unit.maxAp = canonicalMaxAp;
      unit.archetypeId = member.archetypeId;
      unit.displayName = member.name;
      unit.aiBehavior = UNIT_ARCHETYPES[member.archetypeId].behavior;
      unit.combat = buildCombatProfile(member.archetypeId, upgrades);
    } else {
      const requested = rawUnit.archetypeId;
      let archetypeId: UnitArchetypeId;
      if (requested === undefined) {
        // Early v1 saves predate enemy archetypes. Rifleman is the old generic
        // 8 HP / 4 AP baseline, so absence remains compatible without turning
        // malformed new metadata into a different enemy.
        archetypeId = "rifleman";
      } else if (
        typeof requested === "string" &&
        UNIT_ARCHETYPES[requested as UnitArchetypeId]?.team === "enemy"
      ) {
        archetypeId = requested as UnitArchetypeId;
      } else {
        return null;
      }
      const archetype = UNIT_ARCHETYPES[archetypeId];
      if (unit.hp > archetype.maxHp || unit.ap > archetype.maxAp) return null;
      unit.maxHp = archetype.maxHp;
      unit.maxAp = archetype.maxAp;
      unit.archetypeId = archetypeId;
      unit.displayName = archetype.name;
      unit.aiBehavior = archetype.behavior;
      unit.combat = buildCombatProfile(archetypeId);
    }

    const counters = {
      movesThisTurn: readCounter(rawUnit, "movesThisTurn"),
      shotsThisTurn: readCounter(rawUnit, "shotsThisTurn"),
      killsThisTurn: readCounter(rawUnit, "killsThisTurn"),
      encounterShots: readCounter(rawUnit, "encounterShots"),
      overwatchShotsUsed: readCounter(rawUnit, "overwatchShotsUsed"),
      relaysThisTurn: readCounter(rawUnit, "relaysThisTurn"),
      flankRefundsThisTurn: readCounter(rawUnit, "flankRefundsThisTurn"),
    };
    if (Object.values(counters).some((value) => value === null)) return null;
    unit.movesThisTurn = counters.movesThisTurn!;
    unit.shotsThisTurn = counters.shotsThisTurn!;
    unit.killsThisTurn = counters.killsThisTurn!;
    unit.encounterShots = counters.encounterShots!;
    unit.resolvingOverwatch = false;
    unit.overwatchShotsUsed = counters.overwatchShotsUsed!;
    unit.relaysThisTurn = counters.relaysThisTurn!;
    unit.flankRefundsThisTurn = counters.flankRefundsThisTurn!;

    const exposure = rawUnit.peekExposure;
    if (exposure === undefined || exposure === null) {
      unit.peekExposure = null;
    } else if (isObject(exposure)) {
      const px = exposure.x;
      const py = exposure.y;
      if (
        !Number.isInteger(px) || !Number.isInteger(py) ||
        (px as number) < 0 || (py as number) < 0 ||
        (px as number) >= sanitized.map.width || (py as number) >= sanitized.map.height ||
        Math.abs((px as number) - unit.x) > 1 ||
        Math.abs((py as number) - unit.y) > 1 ||
        (px === unit.x && py === unit.y) ||
        sanitized.map.tiles[(py as number) * sanitized.map.width + (px as number)] !== "floor"
      ) {
        return null;
      }
      unit.peekExposure = { x: px as number, y: py as number };
    } else {
      return null;
    }
  }

  return activeStatusesAreSemanticallyValid(sanitized.map) ? sanitized.map : null;
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
    if (!map) return { run: null, error: "The active encounter map failed strict validation." };
    if (currentNodeId !== node.id) {
      return { run: null, error: "The active encounter does not match current route progress." };
    }
    if (rawEncounter.turn !== "player" && rawEncounter.turn !== "enemy") {
      return { run: null, error: "The active encounter has an invalid turn marker." };
    }
    activeEncounter = {
      nodeId: node.id,
      kind: node.kind,
      map,
      turn: rawEncounter.turn,
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
