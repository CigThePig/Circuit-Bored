import type { LevelThemeId } from "./themes.ts";

/**
 * Shared colour vocabulary for the board renderer and for bespoke landmark
 * artwork. Keeping it in its own module lets `renderLandmarks.ts` consume the
 * same values without importing the renderer and forming a cycle.
 */
export const PALETTE = {
  BG: "#070b10",

  FLOOR_BASE: "#101820",
  FLOOR_ALT: "#131d26",
  FLOOR_RIM: "#1d2b35",
  FLOOR_SEAM: "rgba(118, 155, 180, 0.16)",
  FLOOR_GLYPH: "rgba(101, 196, 220, 0.16)",
  FLOOR_WEAR: "rgba(3, 7, 10, 0.22)",
  FLOOR_LIGHT: "#45d8e8",

  WALL_BASE: "#111a22",
  WALL_MID: "#2b414f",
  WALL_FACE_ALT: "#263946",
  WALL_BEVEL_HI: "#8fb8c3",
  WALL_BEVEL_LO: "#05090d",
  WALL_PANEL: "rgba(210, 240, 245, 0.18)",
  WALL_BRACKET: "rgba(151, 226, 236, 0.52)",
  WALL_LIGHT: "#ff426d",
  WALL_PIPE: "#314453",
  WALL_PIPE_HI: "#6d8794",
  WALL_SCREEN: "#153d48",

  HALFCOVER_FILL: "#5a3620",
  HALFCOVER_TOP: "#be7542",
  HALFCOVER_RIM: "#24150b",
  MACHINERY_FILL: "#263643",
  MACHINERY_TOP: "#526b78",
  COOLANT: "#55e4d4",
  HAZARD_YELLOW: "#f5c518",
  HAZARD_BLACK: "#1a1409",

  PLAYER_BODY: "#287eb2",
  PLAYER_BODY_SPENT: "#1f4a85",
  PLAYER_ACCENT: "#ff4ad6",
  PLAYER_HEAD: "#bfe9ef",
  ENEMY_BODY: "#b83f46",
  ENEMY_BODY_SPENT: "#7a2828",
  ENEMY_VISOR: "#1a0606",
  ENEMY_HEAD: "#d99a91",
  UNIT_OUTLINE: "rgba(2, 5, 8, 0.88)",
  UNIT_METAL: "#23303a",
  UNIT_METAL_HI: "#75919f",
  SPENT_VEIL: "rgba(0, 0, 0, 0.40)",

  FRESH_PLAYER: "#5ad6ff",
  FRESH_ENEMY: "#ff8a3a",
  FRESH_GLOW_PLAYER: "rgba(90, 214, 255, 0.55)",
  FRESH_GLOW_ENEMY: "rgba(255, 138, 58, 0.55)",
  OVERWATCH: "#ffd166",
  SELECTED: "#5ad6ff",
  SELECTED_GLOW: "rgba(90, 214, 255, 0.45)",

  HP_CHIP_BG: "rgba(8, 12, 18, 0.78)",
  HP_CHIP_BORDER: "rgba(90, 214, 255, 0.55)",
  HP_TEXT: "#eaf6ff",

  PIP_PLAYER_FILL: "#5ad6ff",
  PIP_ENEMY_FILL: "#ff8a3a",
  PIP_EMPTY_STROKE: "rgba(220, 230, 240, 0.55)",
  PIP_OUTLINE: "rgba(0, 0, 0, 0.7)",

  HL_BRACKET_LEN: 0.22,

  // Movement radius. One diamond per walkable tile; its size and strength fall
  // off with the action points the walk would spend, from the cheapest tiles
  // on offer (NEAR) to the ones that end the turn (FAR). Radii are fractions
  // of a cell: FAR stays above two pixels at the 28 px mobile minimum.
  MOVE_RANGE: "#50c878",
  MOVE_NEAR_RADIUS: 0.32,
  MOVE_FAR_RADIUS: 0.13,
  MOVE_NEAR_FILL: 0.28,
  MOVE_FAR_FILL: 0.13,
  MOVE_NEAR_EDGE: 0.8,
  MOVE_FAR_EDGE: 0.34,

  SIGHT_CLEAR_OUTER: "rgba(90, 214, 255, 0.14)",
  SIGHT_CLEAR_INNER: "rgba(128, 229, 255, 0.72)",
  SIGHT_COVER_OUTER: "rgba(255, 177, 71, 0.12)",
  SIGHT_COVER_INNER: "rgba(255, 190, 96, 0.68)",

  COVER_WALL: "#7fe3ff",
  COVER_HALF: "#ffb347",
  COVER_HATCH: "rgba(10, 30, 45, 0.55)",
  COVER_OUTLINE: "rgba(8, 12, 18, 0.85)",

  THREAT_RING: "#ff596b",
  THREAT_PUPIL: "#21070a",
  THREAT_GLINT: "#ffe0e4",
  THREAT_SHADOW: "rgba(0, 0, 0, 0.7)",

  PREVIEW_BG: "rgba(8, 12, 18, 0.85)",
  PREVIEW_BORDER_HI: "#61e6bb",
  PREVIEW_BORDER_MID: "#ffd166",
  PREVIEW_BORDER_LO: "#ff7381",
  PREVIEW_TEXT_HI: "#86f5cf",
  PREVIEW_TEXT_MID: "#ffe09a",
  PREVIEW_TEXT_LO: "#ff9aa5",
  PREVIEW_SHIELD: "#7fe3ff",
  PREVIEW_SHIELD_OUTLINE: "rgba(0, 0, 0, 0.85)",

  FLOAT_STROKE: "rgba(0, 0, 0, 0.85)",

  // Tactical statuses. Each also has its own glyph shape in the renderer, so
  // colour is reinforcement and never the only carrier of meaning.
  STATUS_PLATE: "rgba(6, 10, 15, 0.82)",
  STATUS_PLATE_EDGE: "rgba(2, 5, 8, 0.9)",
  AIM: "#8fe4ff",
  HUNKER: "#79dfa6",
  SUPPRESSED: "#ff9a4d",
  EXPOSED: "#ff5f8d",
  /** Enemy-controlled ground shown across the selected unit's move radius. */
  WATCHED_LANE: "#ff7a52",
  WATCHED_LANE_SOFT: "rgba(255, 122, 82, 0.20)",
} as const;

export type TerrainPalette = {
  floorBase: string;
  floorAlt: string;
  floorRim: string;
  floorSeam: string;
  floorGlyph: string;
  floorWear: string;
  floorLight: string;
  wallBase: string;
  wallMid: string;
  wallAlt: string;
  wallBevelHi: string;
  wallBevelLo: string;
  wallPanel: string;
  wallBracket: string;
  wallLight: string;
  wallPipe: string;
  wallPipeHi: string;
  wallScreen: string;
  coverFill: string;
  coverTop: string;
  coverRim: string;
  machineryFill: string;
  machineryTop: string;
  coolant: string;
  hazardA: string;
  hazardB: string;
};

export const TERRAIN_PALETTES: Record<LevelThemeId, TerrainPalette> = {
  industrial: {
    floorBase: PALETTE.FLOOR_BASE,
    floorAlt: PALETTE.FLOOR_ALT,
    floorRim: PALETTE.FLOOR_RIM,
    floorSeam: PALETTE.FLOOR_SEAM,
    floorGlyph: PALETTE.FLOOR_GLYPH,
    floorWear: PALETTE.FLOOR_WEAR,
    floorLight: PALETTE.FLOOR_LIGHT,
    wallBase: PALETTE.WALL_BASE,
    wallMid: PALETTE.WALL_MID,
    wallAlt: PALETTE.WALL_FACE_ALT,
    wallBevelHi: PALETTE.WALL_BEVEL_HI,
    wallBevelLo: PALETTE.WALL_BEVEL_LO,
    wallPanel: PALETTE.WALL_PANEL,
    wallBracket: PALETTE.WALL_BRACKET,
    wallLight: PALETTE.WALL_LIGHT,
    wallPipe: PALETTE.WALL_PIPE,
    wallPipeHi: PALETTE.WALL_PIPE_HI,
    wallScreen: PALETTE.WALL_SCREEN,
    coverFill: PALETTE.HALFCOVER_FILL,
    coverTop: PALETTE.HALFCOVER_TOP,
    coverRim: PALETTE.HALFCOVER_RIM,
    machineryFill: PALETTE.MACHINERY_FILL,
    machineryTop: PALETTE.MACHINERY_TOP,
    coolant: PALETTE.COOLANT,
    hazardA: PALETTE.HAZARD_YELLOW,
    hazardB: PALETTE.HAZARD_BLACK,
  },
  data_core: {
    floorBase: "#14222b",
    floorAlt: "#182934",
    floorRim: "#2a414d",
    floorSeam: "rgba(154, 209, 221, 0.20)",
    floorGlyph: "rgba(110, 235, 247, 0.23)",
    floorWear: "rgba(2, 9, 14, 0.12)",
    floorLight: "#6ef2ff",
    wallBase: "#0b1420",
    wallMid: "#344f63",
    wallAlt: "#2b4357",
    wallBevelHi: "#badce2",
    wallBevelLo: "#03070d",
    wallPanel: "rgba(220, 246, 250, 0.24)",
    wallBracket: "rgba(110, 238, 247, 0.66)",
    wallLight: "#ffcf5a",
    wallPipe: "#2a4455",
    wallPipeHi: "#7297a7",
    wallScreen: "#0d4655",
    coverFill: "#294454",
    coverTop: "#5f8797",
    coverRim: "#071019",
    machineryFill: "#203440",
    machineryTop: "#557181",
    coolant: "#70f0ff",
    hazardA: "#f1f4e8",
    hazardB: "#b9485c",
  },
  derelict: {
    floorBase: "#171816",
    floorAlt: "#1d1e1a",
    floorRim: "#34352f",
    floorSeam: "rgba(166, 157, 126, 0.18)",
    floorGlyph: "rgba(116, 185, 165, 0.15)",
    floorWear: "rgba(0, 0, 0, 0.38)",
    floorLight: "#75c8ae",
    wallBase: "#141512",
    wallMid: "#4a463b",
    wallAlt: "#393a32",
    wallBevelHi: "#9c9682",
    wallBevelLo: "#050603",
    wallPanel: "rgba(217, 204, 165, 0.16)",
    wallBracket: "rgba(181, 173, 136, 0.45)",
    wallLight: "#d96b45",
    wallPipe: "#3d443d",
    wallPipeHi: "#768176",
    wallScreen: "#254039",
    coverFill: "#51402d",
    coverTop: "#8c704c",
    coverRim: "#1b140d",
    machineryFill: "#343a36",
    machineryTop: "#626c63",
    coolant: "#76b89c",
    hazardA: "#c8a843",
    hazardB: "#252015",
  },
};
