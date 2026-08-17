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
  /** What this unit is for, in one line. Shown when the player inspects it. */
  role: string;
  /** The shape of the plan that beats it, or its own limitation. */
  counter: string;
  team: Unit["team"];
  maxHp: number;
  maxAp: number;
  behavior: AiBehavior;
  profile?: Partial<CombatProfile>;
};

/**
 * Every archetype's identity in one table.
 *
 * `role` and `counter` are player-facing: the HUD shows them when a unit is
 * inspected, so "why is that dangerous and what beats it" is answerable from
 * the board instead of from the source. Range profiles are what make the
 * answer positional - each unit has a band it wants the fight to happen in.
 */
export const UNIT_ARCHETYPES: Record<UnitArchetypeId, UnitArchetype> = {
  operator: {
    id: "operator",
    name: "Rook",
    description: "Squad coordinator. Marks targets and moves action points.",
    role: "Coordinator. Makes the rest of the squad shoot better than it can alone.",
    counter: "Reliable at medium range; nothing special up close or far out.",
    team: "player",
    maxHp: 9,
    maxAp: 4,
    behavior: "balanced",
    profile: {
      closeAccuracy: -0.05,
      mediumAccuracy: 0.08,
      longAccuracy: -0.05,
    },
  },
  runner: {
    id: "runner",
    name: "Vex",
    description: "Fast flanker. Dashes past reaction fire to take the angle.",
    role: "Infiltrator. Breaks stalemates by reaching angles nobody else can.",
    counter: "Deadly close, poor at long range, and thinly armoured.",
    team: "player",
    maxHp: 7,
    maxAp: 5,
    behavior: "assault",
    profile: {
      accuracyBonus: -0.05,
      closeAccuracy: 0.18,
      longAccuracy: -0.2,
      // Flanking is Vex's job, so Vex is the one who gets paid extra for it.
      exposedAccuracyBonus: 0.08,
    },
  },
  bulwark: {
    id: "bulwark",
    name: "Hex",
    description: "Armoured anchor. Shields squadmates and holds a lane.",
    role: "Anchor. Holds one part of the map while somebody else manoeuvres.",
    counter: "Strong on a medium lane; slow, and weak if forced into a brawl.",
    team: "player",
    maxHp: 11,
    maxAp: 3,
    behavior: "sentinel",
    profile: {
      damageReduction: 1,
      coverDefenseBonus: 0.05,
      closeAccuracy: -0.1,
      mediumAccuracy: 0.1,
      longAccuracy: -0.02,
    },
  },
  scrapper: {
    id: "scrapper",
    name: "Scrapper",
    description: "Fragile rusher that is lethal once it arrives.",
    role: "Closes hard and hits hard at knife range.",
    counter: "Almost harmless at distance. Control the lane it must cross.",
    team: "enemy",
    maxHp: 5,
    maxAp: 5,
    behavior: "assault",
    profile: {
      accuracyBonus: -0.05,
      closeAccuracy: 0.22,
      closeDamage: 1,
      mediumAccuracy: -0.05,
      longAccuracy: -0.25,
    },
  },
  rifleman: {
    id: "rifleman",
    name: "Rifleman",
    description: "Reliable line unit using normal tactical rules.",
    role: "Baseline. No tricks, no bad matchups, no free wins.",
    counter: "Nothing special beats it. Ordinary cover and focus fire do.",
    team: "enemy",
    maxHp: 8,
    maxAp: 4,
    behavior: "balanced",
    // Deliberately flat: the Rifleman is the ruler everything else is measured
    // against, so it gets no range identity at all.
  },
  marksman: {
    id: "marksman",
    name: "Marksman",
    description: "Long-range shooter that locks onto a target before firing.",
    role: "Telegraphs a devastating long-range shot one turn ahead.",
    counter: "Break its line, suppress it, or rush it before the shot lands.",
    team: "enemy",
    maxHp: 6,
    maxAp: 4,
    behavior: "marksman",
    profile: {
      accuracyBonus: 0.1,
      damageBonus: 1,
      closeAccuracy: -0.25,
      longAccuracy: 0.15,
      longDamage: 1,
      // The lock has to pay off in damage, not only in accuracy. Down a long
      // open lane a Marksman is already at the accuracy ceiling, so an
      // accuracy-only Aim would make its telegraph free to ignore - which is
      // the opposite of the point.
      aimDamageBonus: 2,
    },
  },
  sentinel: {
    id: "sentinel",
    name: "Sentinel",
    description: "Slow armoured defender that locks down ground.",
    role: "Holds a lane with overwatch and suppressing fire. Hard to shift.",
    counter: "Inefficient head-on. Flank it, cross it up, or pull it out of position.",
    team: "enemy",
    maxHp: 10,
    maxAp: 3,
    behavior: "sentinel",
    profile: {
      damageReduction: 1,
      overwatchAccuracyBonus: 0.1,
      closeAccuracy: -0.05,
      mediumAccuracy: 0.1,
      longAccuracy: -0.05,
    },
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
  | "volatile_cell"
  | "target_designator"
  | "command_uplink"
  | "sprint_servos"
  | "flank_protocol"
  | "shield_projector"
  | "sustained_fire"
  | "spotter_optics"
  | "steady_hands"
  | "close_quarters"
  | "long_barrel";

export type UpgradeDefinition = {
  id: UpgradeId;
  name: string;
  description: string;
  /**
   * `tactic` upgrades change what an action does rather than what a number is.
   * The pool leans on these now: a run should be able to change how the squad
   * plays, not only how hard it hits.
   */
  tag: "position" | "offense" | "defense" | "sustain" | "tactic";
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

  // Tactical upgrades. Each one changes how an action behaves rather than
  // adding another flat number, so a run can shift the squad's whole plan.
  { id: "target_designator", name: "Target Designator", description: "Marked targets are 10% easier for the rest of the squad to hit.", tag: "tactic", maxStacks: 2, profile: { markAccuracyBonus: 0.1 } },
  { id: "command_uplink", name: "Command Uplink", description: "Overwatch grants one extra reaction shot.", tag: "tactic", maxStacks: 1, profile: { extraOverwatchReactions: 1 } },
  { id: "sprint_servos", name: "Sprint Servos", description: "Dash buys one more tile per action point.", tag: "tactic", maxStacks: 1, profile: { dashTilesBonus: 1 } },
  { id: "flank_protocol", name: "Flank Protocol", description: "The first shot each turn at an Exposed target refunds 1 AP.", tag: "tactic", maxStacks: 1, profile: { flankApRefund: 1 } },
  { id: "shield_projector", name: "Shield Projector", description: "Guard absorbs 1 more damage.", tag: "tactic", maxStacks: 2, profile: { guardDamageReduction: 1 } },
  { id: "sustained_fire", name: "Sustained Fire", description: "Suppression lasts one turn longer.", tag: "tactic", maxStacks: 1, profile: { suppressionDurationBonus: 1 } },
  { id: "spotter_optics", name: "Spotter Optics", description: "+10% accuracy against Exposed targets.", tag: "tactic", maxStacks: 2, profile: { exposedAccuracyBonus: 0.1 } },
  { id: "steady_hands", name: "Steady Hands", description: "A shot fired out of Aim deals +1 damage.", tag: "tactic", maxStacks: 1, profile: { aimDamageBonus: 1 } },
  { id: "close_quarters", name: "Close Quarters", description: "+12% accuracy inside close range.", tag: "position", maxStacks: 1, profile: { closeAccuracy: 0.12 } },
  { id: "long_barrel", name: "Long Barrel", description: "+12% accuracy at long range.", tag: "position", maxStacks: 1, profile: { longAccuracy: 0.12 } },
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
