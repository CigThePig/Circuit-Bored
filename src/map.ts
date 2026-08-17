import {
  canRunMap,
  sanitizeLoadedMap,
  type ValidationReport,
} from "./validation.ts";
import {
  DEFAULT_LEVEL_THEME_ID,
  type LevelThemeId,
} from "./themes.ts";
import { cloneEnvironment, type MapEnvironment } from "./environment.ts";
import { cloneStatuses, type UnitStatuses } from "./status.ts";
import { cloneIntent, type EnemyIntent } from "./intent.ts";
import { EMPTY_RANGE_PROFILE, type RangeProfile } from "./range.ts";

export type TileType = "floor" | "wall" | "half_cover";

export type AiBehavior = "balanced" | "assault" | "marksman" | "sentinel";

export type CombatProfile = RangeProfile & {
  accuracyBonus: number;
  damageBonus: number;
  damageReduction: number;
  coverDefenseBonus: number;
  peekPenaltyReduction: number;
  uncoveredAccuracyBonus: number;
  firstShotAccuracyBonus: number;
  stationaryAccuracyBonus: number;
  lowHealthAccuracyBonus: number;
  firstMoveFree: boolean;
  killApRefund: number;
  killHeal: number;
  overwatchAccuracyBonus: number;
  overwatchDamageBonus: number;
  /** Extra accuracy allies get against a target this unit marked. */
  markAccuracyBonus: number;
  /** Extra turns a suppression applied by this unit lasts. */
  suppressionDurationBonus: number;
  /** Extra tiles per action point while dashing. */
  dashTilesBonus: number;
  /** Extra damage reduction this unit's Guard confers. */
  guardDamageReduction: number;
  /** Action points refunded the first time this unit shoots an Exposed target. */
  flankApRefund: number;
  /** Extra damage on a shot fired out of a prepared Aim. */
  aimDamageBonus: number;
  /** Extra accuracy on any shot against an Exposed target. */
  exposedAccuracyBonus: number;
  /** Reaction shots one Overwatch grants beyond the first. */
  extraOverwatchReactions: number;
};

export const EMPTY_COMBAT_PROFILE: CombatProfile = {
  ...EMPTY_RANGE_PROFILE,
  accuracyBonus: 0,
  damageBonus: 0,
  damageReduction: 0,
  coverDefenseBonus: 0,
  peekPenaltyReduction: 0,
  uncoveredAccuracyBonus: 0,
  firstShotAccuracyBonus: 0,
  stationaryAccuracyBonus: 0,
  lowHealthAccuracyBonus: 0,
  firstMoveFree: false,
  killApRefund: 0,
  killHeal: 0,
  overwatchAccuracyBonus: 0,
  overwatchDamageBonus: 0,
  markAccuracyBonus: 0,
  suppressionDurationBonus: 0,
  dashTilesBonus: 0,
  guardDamageReduction: 0,
  flankApRefund: 0,
  aimDamageBonus: 0,
  exposedAccuracyBonus: 0,
  extraOverwatchReactions: 0,
};

export type Unit = {
  id: string;
  team: "player" | "enemy";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  overwatch: boolean;
  peekExposure: { x: number; y: number } | null;
  /**
   * Temporary tactical states. Absent means "nothing active", so units from
   * pre-status saves and hand-built fixtures need no migration.
   */
  statuses?: UnitStatuses;
  /**
   * What this enemy is currently trying to do. Written only by the AI's
   * planner and read by the HUD, so the board can never show a prediction the
   * AI did not actually make.
   */
  intent?: EnemyIntent;
  archetypeId?: string;
  displayName?: string;
  aiBehavior?: AiBehavior;
  combat?: CombatProfile;
  movesThisTurn?: number;
  shotsThisTurn?: number;
  killsThisTurn?: number;
  encounterShots?: number;
  resolvingOverwatch?: boolean;
  /** Reaction shots already spent from the current overwatch. */
  overwatchShotsUsed?: number;
  /** Relay transfers this unit has made this turn. Caps the AP shuffle. */
  relaysThisTurn?: number;
  /** Exposed-target refunds already claimed this turn. */
  flankRefundsThisTurn?: number;
};

export type GameMap = {
  width: number;
  height: number;
  tiles: TileType[];
  units: Unit[];
  /** Stable encounter identity. Older editor maps and saves default to the foundry. */
  themeId?: LevelThemeId;
  /** Optional generated-space identity used by landmarks and regional terrain art. */
  environment?: MapEnvironment;
};

export const MAP_W = 16;
export const MAP_H = 16;
export const UNIT_HP = 8;
export const UNIT_AP = 4;

const STORAGE_KEY = "circuit-bored.map.v1";

export function createEmptyMap(): GameMap {
  const tiles: TileType[] = new Array(MAP_W * MAP_H).fill("floor");
  return { width: MAP_W, height: MAP_H, tiles, units: [], themeId: DEFAULT_LEVEL_THEME_ID };
}

export function idx(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function getTile(map: GameMap, x: number, y: number): TileType | null {
  if (!inBounds(map, x, y)) return null;
  return map.tiles[idx(map, x, y)] ?? null;
}

export function setTile(map: GameMap, x: number, y: number, t: TileType): void {
  if (!inBounds(map, x, y)) return;
  map.tiles[idx(map, x, y)] = t;
}

export function unitAt(map: GameMap, x: number, y: number): Unit | null {
  for (const u of map.units) {
    if (u.x === x && u.y === y && u.hp > 0) return u;
  }
  return null;
}

export function isPassable(map: GameMap, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  if (getTile(map, x, y) !== "floor") return false;
  if (unitAt(map, x, y)) return false;
  return true;
}

export function generateUnitId(team: "player" | "enemy"): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const base =
    cryptoRef && typeof cryptoRef.randomUUID === "function"
      ? cryptoRef.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${team}-${base}`;
}

export function makeUnit(team: "player" | "enemy", x: number, y: number): Unit {
  return {
    id: generateUnitId(team),
    team,
    x,
    y,
    hp: UNIT_HP,
    maxHp: UNIT_HP,
    ap: UNIT_AP,
    maxAp: UNIT_AP,
    overwatch: false,
    peekExposure: null,
  };
}

export function cloneMap(map: GameMap): GameMap {
  return {
    width: map.width,
    height: map.height,
    tiles: [...map.tiles],
    themeId: map.themeId ?? DEFAULT_LEVEL_THEME_ID,
    environment: map.environment ? cloneEnvironment(map.environment) : undefined,
    units: map.units.map((u) => ({
      ...u,
      peekExposure: u.peekExposure ? { ...u.peekExposure } : null,
      // Statuses are gameplay state, so a cloned map must never share them
      // with its source - the runtime clones the encounter every save.
      statuses: cloneStatuses(u.statuses),
      intent: cloneIntent(u.intent),
      combat: u.combat ? { ...u.combat } : undefined,
    })),
  };
}

export function saveMap(map: GameMap): boolean {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function loadMap(): GameMap | null {
  const result = loadMapWithReport();
  return result.map;
}

export function loadMapWithReport(): {
  map: GameMap | null;
  report: ValidationReport;
} {
  let raw: string | null;
  try {
    raw = globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      map: null,
      report: {
        issues: [{
          severity: "error",
          code: "STORAGE_UNAVAILABLE",
          message: "Saved maps are unavailable in this browser context.",
        }],
        hasErrors: true,
      },
    };
  }
  if (!raw) {
    return { map: null, report: { issues: [], hasErrors: false } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      map: null,
      report: {
        issues: [
          {
            severity: "error",
            code: "INVALID_JSON",
            message: "Saved map could not be parsed as JSON.",
          },
        ],
        hasErrors: true,
      },
    };
  }
  const result = sanitizeLoadedMap(parsed);
  if (result.report.hasErrors) {
    return { map: null, report: result.report };
  }
  return result;
}

export function createTestMap(): GameMap {
  const map = createEmptyMap();
  setTile(map, 4, 8, "half_cover");
  setTile(map, 4, 9, "half_cover");
  setTile(map, 11, 8, "half_cover");
  setTile(map, 11, 9, "half_cover");
  setTile(map, 7, 2, "wall");
  setTile(map, 8, 13, "wall");
  map.units.push(makeUnit("player", 3, 8));
  map.units.push(makeUnit("enemy", 12, 8));
  return map;
}

export function validatePlayable(map: GameMap): string | null {
  const result = canRunMap(map);
  return result.ok ? null : result.reason ?? "Map cannot be run.";
}
