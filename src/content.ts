import {
  EMPTY_COMBAT_PROFILE,
  type AiBehavior,
  type CombatProfile,
  type Unit,
} from "./map.ts";

export type UnitArchetypeId =
  | "operator"
  | "runner"
  | "bulwark"
  | "scrapper"
  | "rifleman"
  | "marksman"
  | "sentinel";

export type UnitArchetype = {
  id: UnitArchetypeId;
  name: string;
  description: string;
  team: Unit["team"];
  maxHp: number;
  maxAp: number;
  behavior: AiBehavior;
  profile?: Partial<CombatProfile>;
};

export const UNIT_ARCHETYPES: Record<UnitArchetypeId, UnitArchetype> = {
  operator: {
    id: "operator",
    name: "Rook",
    description: "Steady all-range operator.",
    team: "player",
    maxHp: 9,
    maxAp: 4,
    behavior: "balanced",
  },
  runner: {
    id: "runner",
    name: "Vex",
    description: "Fast flanker with a lighter frame.",
    team: "player",
    maxHp: 7,
    maxAp: 5,
    behavior: "assault",
    profile: { accuracyBonus: -0.05 },
  },
  bulwark: {
    id: "bulwark",
    name: "Hex",
    description: "Armoured anchor built to hold cover.",
    team: "player",
    maxHp: 11,
    maxAp: 3,
    behavior: "sentinel",
    profile: { damageReduction: 1, coverDefenseBonus: 0.05 },
  },
  scrapper: {
    id: "scrapper",
    name: "Scrapper",
    description: "Fragile, fast unit that closes aggressively.",
    team: "enemy",
    maxHp: 5,
    maxAp: 5,
    behavior: "assault",
    profile: { accuracyBonus: -0.05 },
  },
  rifleman: {
    id: "rifleman",
    name: "Rifleman",
    description: "Reliable line unit using normal tactical rules.",
    team: "enemy",
    maxHp: 8,
    maxAp: 4,
    behavior: "balanced",
  },
  marksman: {
    id: "marksman",
    name: "Marksman",
    description: "Accurate, hard-hitting shooter that values safe angles.",
    team: "enemy",
    maxHp: 6,
    maxAp: 4,
    behavior: "marksman",
    profile: { accuracyBonus: 0.1, damageBonus: 1 },
  },
  sentinel: {
    id: "sentinel",
    name: "Sentinel",
    description: "Slow armoured defender that establishes overwatch.",
    team: "enemy",
    maxHp: 10,
    maxAp: 3,
    behavior: "sentinel",
    profile: { damageReduction: 1, overwatchAccuracyBonus: 0.1 },
  },
};

export type UpgradeId =
  | "reinforced_chassis"
  | "auxiliary_cell"
  | "smartlink"
  | "hot_barrel"
  | "corner_servo"
  | "crossfire_matrix"
  | "low_profile"
  | "reactive_mesh"
  | "ghost_step"
  | "opening_volley"
  | "deadeye_bus"
  | "kill_switch"
  | "salvage_nanites"
  | "overwatch_optics"
  | "tripwire_rounds"
  | "field_repair"
  | "triage_protocol"
  | "volatile_cell";

export type UpgradeDefinition = {
  id: UpgradeId;
  name: string;
  description: string;
  tag: "position" | "offense" | "defense" | "sustain";
  maxStacks: number;
  profile?: Partial<CombatProfile>;
  maxHp?: number;
  maxAp?: number;
  postCombatHeal?: number;
  recoveryBonus?: number;
};

export const UPGRADES: readonly UpgradeDefinition[] = [
  { id: "reinforced_chassis", name: "Reinforced Chassis", description: "+2 maximum HP; heal 2 immediately.", tag: "defense", maxStacks: 2, maxHp: 2 },
  { id: "auxiliary_cell", name: "Auxiliary Cell", description: "+1 maximum AP every turn.", tag: "position", maxStacks: 1, maxAp: 1 },
  { id: "smartlink", name: "Smartlink", description: "+10% accuracy on every shot.", tag: "offense", maxStacks: 2, profile: { accuracyBonus: 0.1 } },
  { id: "hot_barrel", name: "Hot Barrel", description: "+1 damage, but -10% accuracy. High risk, fast kills.", tag: "offense", maxStacks: 1, profile: { damageBonus: 1, accuracyBonus: -0.1 } },
  { id: "corner_servo", name: "Corner Servo", description: "Reduce the accuracy penalty for peek shots by 15%.", tag: "position", maxStacks: 2, profile: { peekPenaltyReduction: 0.15 } },
  { id: "crossfire_matrix", name: "Crossfire Matrix", description: "+15% accuracy against targets without cover.", tag: "position", maxStacks: 1, profile: { uncoveredAccuracyBonus: 0.15 } },
  { id: "low_profile", name: "Low Profile", description: "Cover protecting your squad imposes 12% more accuracy penalty.", tag: "defense", maxStacks: 1, profile: { coverDefenseBonus: 0.12 } },
  { id: "reactive_mesh", name: "Reactive Mesh", description: "Reduce incoming hit damage by 1, to a minimum of 1.", tag: "defense", maxStacks: 1, profile: { damageReduction: 1 } },
  { id: "ghost_step", name: "Ghost Step", description: "The first move each player turn costs 0 AP.", tag: "position", maxStacks: 1, profile: { firstMoveFree: true } },
  { id: "opening_volley", name: "Opening Volley", description: "Each operator's first shot per encounter gains +20% accuracy.", tag: "offense", maxStacks: 1, profile: { firstShotAccuracyBonus: 0.2 } },
  { id: "deadeye_bus", name: "Deadeye Bus", description: "+12% accuracy while the shooter has not moved this turn.", tag: "position", maxStacks: 1, profile: { stationaryAccuracyBonus: 0.12 } },
  { id: "kill_switch", name: "Kill Switch", description: "The first kill each turn refunds 1 AP.", tag: "offense", maxStacks: 1, profile: { killApRefund: 1 } },
  { id: "salvage_nanites", name: "Salvage Nanites", description: "The first kill each turn repairs 1 HP on the shooter.", tag: "sustain", maxStacks: 1, profile: { killHeal: 1 } },
  { id: "overwatch_optics", name: "Overwatch Optics", description: "Overwatch shots gain +20% accuracy.", tag: "position", maxStacks: 1, profile: { overwatchAccuracyBonus: 0.2 } },
  { id: "tripwire_rounds", name: "Tripwire Rounds", description: "Overwatch hits deal +1 damage.", tag: "offense", maxStacks: 1, profile: { overwatchDamageBonus: 1 } },
  { id: "field_repair", name: "Field Repair", description: "Every survivor repairs 1 HP after each combat.", tag: "sustain", maxStacks: 2, postCombatHeal: 1 },
  { id: "triage_protocol", name: "Triage Protocol", description: "Recovery nodes restore 3 additional HP.", tag: "sustain", maxStacks: 2, recoveryBonus: 3 },
  { id: "volatile_cell", name: "Volatile Cell", description: "+2 maximum AP, but -2 maximum HP. Commit to aggression.", tag: "offense", maxStacks: 1, maxAp: 2, maxHp: -2 },
] as const;

const upgradeMap = new Map(UPGRADES.map((upgrade) => [upgrade.id, upgrade]));

export function getUpgrade(id: UpgradeId): UpgradeDefinition {
  const upgrade = upgradeMap.get(id);
  if (!upgrade) throw new Error(`Unknown upgrade '${id}'`);
  return upgrade;
}

export function isUpgradeId(value: unknown): value is UpgradeId {
  return typeof value === "string" && upgradeMap.has(value as UpgradeId);
}

export function stackCount(upgrades: readonly UpgradeId[], id: UpgradeId): number {
  return upgrades.filter((upgrade) => upgrade === id).length;
}

export function buildCombatProfile(
  archetypeId: UnitArchetypeId,
  upgradeIds: readonly UpgradeId[] = [],
): CombatProfile {
  const profile: CombatProfile = { ...EMPTY_COMBAT_PROFILE };
  const apply = (partial: Partial<CombatProfile> | undefined) => {
    if (!partial) return;
    for (const key of Object.keys(partial) as Array<keyof CombatProfile>) {
      const value = partial[key];
      if (typeof value === "number") {
        (profile[key] as number) += value;
      } else if (typeof value === "boolean") {
        (profile[key] as boolean) ||= value;
      }
    }
  };
  apply(UNIT_ARCHETYPES[archetypeId].profile);
  for (const id of upgradeIds) apply(getUpgrade(id).profile);
  return profile;
}

export function makeArchetypeUnit(
  archetypeId: UnitArchetypeId,
  id: string,
  x: number,
  y: number,
  upgradeIds: readonly UpgradeId[] = [],
): Unit {
  const archetype = UNIT_ARCHETYPES[archetypeId];
  const maxHpDelta = upgradeIds.reduce((sum, upgradeId) => sum + (getUpgrade(upgradeId).maxHp ?? 0), 0);
  const maxApDelta = upgradeIds.reduce((sum, upgradeId) => sum + (getUpgrade(upgradeId).maxAp ?? 0), 0);
  const maxHp = Math.max(1, archetype.maxHp + maxHpDelta);
  const maxAp = Math.max(1, archetype.maxAp + maxApDelta);
  return {
    id,
    team: archetype.team,
    x,
    y,
    hp: maxHp,
    maxHp,
    ap: maxAp,
    maxAp,
    overwatch: false,
    peekExposure: null,
    archetypeId,
    displayName: archetype.name,
    aiBehavior: archetype.behavior,
    combat: buildCombatProfile(archetypeId, upgradeIds),
    movesThisTurn: 0,
    shotsThisTurn: 0,
    killsThisTurn: 0,
    encounterShots: 0,
    resolvingOverwatch: false,
  };
}

export function postCombatHealing(upgrades: readonly UpgradeId[]): number {
  return upgrades.reduce((sum, id) => sum + (getUpgrade(id).postCombatHeal ?? 0), 0);
}

export function recoveryHealing(upgrades: readonly UpgradeId[]): number {
  return 4 + upgrades.reduce((sum, id) => sum + (getUpgrade(id).recoveryBonus ?? 0), 0);
}
