export const LEVEL_THEME_IDS = ["industrial", "data_core", "derelict"] as const;

export type LevelThemeId = (typeof LEVEL_THEME_IDS)[number];

export const DEFAULT_LEVEL_THEME_ID: LevelThemeId = "industrial";

export type LevelThemeDefinition = {
  id: LevelThemeId;
  name: string;
  shortName: string;
  tacticalCharacter: string;
  preferredMotifs: readonly string[];
};

export const LEVEL_THEMES: Record<LevelThemeId, LevelThemeDefinition> = {
  industrial: {
    id: "industrial",
    name: "Industrial Processing Foundry",
    shortName: "Foundry",
    tacticalCharacter: "Broad work lanes, machinery islands, cross-passages, and staggered cargo positions.",
    preferredMotifs: [
      "wall_with_breaches",
      "machinery_island",
      "paired_machinery",
      "loading_zone",
      "offset_bulkhead",
    ],
  },
  data_core: {
    id: "data_core",
    name: "Data Core Security Complex",
    shortName: "Data Core",
    tacticalCharacter: "Orthogonal rooms, controlled doors, intersections, checkpoints, and a central chamber.",
    preferredMotifs: [
      "small_chamber",
      "large_chamber",
      "t_junction",
      "cross_corridor",
      "defensive_checkpoint",
    ],
  },
  derelict: {
    id: "derelict",
    name: "Derelict Maintenance Salvage Deck",
    shortName: "Salvage Deck",
    tacticalCharacter: "Broken rooms, offset spaces, improvised pockets, and irregular flanking angles.",
    preferredMotifs: [
      "broken_room",
      "zig_zag_divider",
      "l_room",
      "u_defense",
      "salvage_cluster",
    ],
  },
};

export function isLevelThemeId(value: unknown): value is LevelThemeId {
  return typeof value === "string" && (LEVEL_THEME_IDS as readonly string[]).includes(value);
}

export function levelThemeId(value: unknown): LevelThemeId {
  return isLevelThemeId(value) ? value : DEFAULT_LEVEL_THEME_ID;
}
