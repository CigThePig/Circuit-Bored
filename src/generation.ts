import {
  makeArchetypeUnit,
  type UnitArchetypeId,
  type UpgradeId,
} from "./content.ts";
import { hasStrictLineOfSight } from "./combat.ts";
import {
  analyzeGeneratedMap,
  passableNeighborCount,
  repairFloorConnectivity,
  repairIsolatedWalls,
  validateGeneratedMap,
  reachableFloorCount,
  type GeneratedMapMetrics,
  type TacticalQualityIssue,
} from "./generationAnalysis.ts";
import { paintBoundary, type MotifId, type Point } from "./generationMotifs.ts";
import { buildThemeLayout, type MacroZone, type ThemeLayout } from "./generationThemes.ts";
import { createEmptyMap, getTile, type GameMap } from "./map.ts";
import { SeededRng } from "./rng.ts";
import { LEVEL_THEME_IDS, type LevelThemeId } from "./themes.ts";
import { validateMap } from "./validation.ts";

export type EncounterKind = "combat" | "elite" | "final";

export type EncounterSquadMember = {
  id: string;
  name: string;
  archetypeId: "operator" | "runner" | "bulwark";
  hp: number;
  maxHp: number;
  baseMaxAp: number;
};

export type GenerateEncounterOptions = {
  /** Development/visual-lab override. Normal runs choose through encounter RNG. */
  themeId?: LevelThemeId;
};

export const ENCOUNTER_WIDTH = 24;
export const ENCOUNTER_HEIGHT = 24;
const MAX_LAYOUT_ATTEMPTS = 8;

export type EncounterGenerationDiagnostics = {
  themeId: LevelThemeId;
  attempt: number;
  repairCount: number;
  motifs: readonly MotifId[];
  zones: readonly Pick<MacroZone, "id" | "purpose">[];
  metrics: GeneratedMapMetrics;
};

const encounterDiagnostics = new WeakMap<GameMap, EncounterGenerationDiagnostics>();

export function generatedEncounterDiagnostics(map: GameMap): EncounterGenerationDiagnostics | undefined {
  return encounterDiagnostics.get(map);
}

function freshMap(themeId: LevelThemeId): GameMap {
  const map = createEmptyMap();
  map.width = ENCOUNTER_WIDTH;
  map.height = ENCOUNTER_HEIGHT;
  map.tiles = new Array(map.width * map.height).fill("floor");
  map.units = [];
  map.themeId = themeId;
  paintBoundary(map);
  return map;
}

function enemyPool(depth: number, kind: EncounterKind): UnitArchetypeId[] {
  const pool: UnitArchetypeId[] = ["scrapper", "rifleman"];
  if (depth >= 2) pool.push("marksman");
  if (depth >= 3 || kind !== "combat") pool.push("sentinel");
  return pool;
}

function enemyCount(depth: number, kind: EncounterKind): number {
  if (kind === "final") return 6;
  const base = 2 + Math.floor(depth / 3);
  return Math.min(5, base + (kind === "elite" ? 1 : 0));
}

function openingSightCount(map: GameMap, point: Point, opponents: readonly Point[]): number {
  return opponents.filter((opponent) => hasStrictLineOfSight(map, point.x, point.y, opponent.x, opponent.y)).length;
}

function selectSpawnPoints(
  map: GameMap,
  rng: SeededRng,
  candidates: readonly Point[],
  count: number,
  opponents: readonly Point[] = [],
): Point[] {
  const shuffled = rng.shuffle(candidates).filter((point) =>
    getTile(map, point.x, point.y) === "floor" && passableNeighborCount(map, point.x, point.y) >= 2
  );
  shuffled.sort((a, b) => {
    const sightDifference = openingSightCount(map, a, opponents) - openingSightCount(map, b, opponents);
    if (sightDifference !== 0) return sightDifference;
    return passableNeighborCount(map, b.x, b.y) - passableNeighborCount(map, a.x, a.y);
  });

  const selected: Point[] = [];
  for (const point of shuffled) {
    if (selected.some((other) => Math.abs(other.x - point.x) + Math.abs(other.y - point.y) < 2)) continue;
    selected.push(point);
    if (selected.length === count) return selected;
  }
  for (const point of shuffled) {
    if (selected.some((other) => other.x === point.x && other.y === point.y)) continue;
    selected.push(point);
    if (selected.length === count) return selected;
  }
  throw new Error(`Theme layout supplied only ${selected.length} valid spawn tiles for ${count} units`);
}

function addSquads(
  map: GameMap,
  rng: SeededRng,
  depth: number,
  kind: EncounterKind,
  squad: readonly EncounterSquadMember[],
  upgrades: readonly UpgradeId[],
  layout: ThemeLayout,
): void {
  const living = squad.filter((member) => member.hp > 0);
  const playerSpawns = selectSpawnPoints(map, rng, layout.playerCandidates, living.length);
  for (let index = 0; index < living.length; index++) {
    const member = living[index];
    const spawn = playerSpawns[index];
    const unit = makeArchetypeUnit(member.archetypeId, member.id, spawn.x, spawn.y, upgrades);
    unit.displayName = member.name;
    unit.maxHp = member.maxHp;
    unit.hp = Math.min(member.hp, member.maxHp);
    unit.maxAp = Math.max(1, member.baseMaxAp + upgrades.reduce((sum, id) => {
      if (id === "auxiliary_cell") return sum + 1;
      if (id === "volatile_cell") return sum + 2;
      return sum;
    }, 0));
    unit.ap = unit.maxAp;
    map.units.push(unit);
  }

  const count = enemyCount(depth, kind);
  const enemySpawns = selectSpawnPoints(map, rng, layout.enemyCandidates, count, playerSpawns);
  const pool = enemyPool(depth, kind);
  const forced: UnitArchetypeId[] = kind === "final"
    ? ["sentinel", "marksman"]
    : kind === "elite"
      ? [rng.pick(["marksman", "sentinel"] as const)]
      : [];
  const types = [...forced];
  while (types.length < count) types.push(rng.pick(pool));
  for (let index = 0; index < count; index++) {
    const spawn = enemySpawns[index];
    map.units.push(makeArchetypeUnit(types[index], `enemy-${depth}-${index}`, spawn.x, spawn.y));
  }
}

type Candidate = {
  map: GameMap;
  issues: TacticalQualityIssue[];
  layout: ThemeLayout;
  attempt: number;
  repairCount: number;
};

function candidateScore(candidate: Candidate): number {
  const metrics = analyzeGeneratedMap(candidate.map);
  return candidate.issues.length * 100 + metrics.openingFirePairs * 8 + metrics.floorRegionCount * 20;
}

function rememberDiagnostics(candidate: Candidate): GameMap {
  encounterDiagnostics.set(candidate.map, {
    themeId: candidate.map.themeId!,
    attempt: candidate.attempt,
    repairCount: candidate.repairCount,
    motifs: [...candidate.layout.motifs],
    zones: candidate.layout.zones.map(({ id, purpose }) => ({ id, purpose })),
    metrics: analyzeGeneratedMap(candidate.map, candidate.layout.contestedPoints),
  });
  return candidate.map;
}

export function generateEncounter(
  rng: SeededRng,
  depth: number,
  kind: EncounterKind,
  squad: readonly EncounterSquadMember[],
  upgrades: readonly UpgradeId[],
  options: GenerateEncounterOptions = {},
): GameMap {
  const themeId = options.themeId ?? rng.pick(LEVEL_THEME_IDS);
  let best: Candidate | null = null;

  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
    const map = freshMap(themeId);
    try {
      const layout = buildThemeLayout(map, themeId, rng, depth, kind);
      const repairCount = repairIsolatedWalls(map) + repairFloorConnectivity(map);
      addSquads(map, rng, depth, kind, squad, upgrades, layout);
      const baseReport = validateMap(map);
      if (baseReport.hasErrors) {
        const first = baseReport.issues.find((issue) => issue.severity === "error");
        throw new Error(`Generated invalid encounter: ${first?.code ?? "UNKNOWN"}`);
      }
      const candidate = {
        map,
        issues: validateGeneratedMap(map, layout.contestedPoints),
        layout,
        attempt,
        repairCount,
      };
      if (candidate.issues.length === 0) return rememberDiagnostics(candidate);
      if (!best || candidateScore(candidate) < candidateScore(best)) best = candidate;
    } catch (error) {
      if (attempt === MAX_LAYOUT_ATTEMPTS - 1 && !best) throw error;
    }
  }

  // Bounded deterministic fallback: retain the best valid architecture even
  // if a soft tactical target could not be met. Hard map validity and floor
  // connectivity were already enforced above, so a seed can never hang.
  if (best) return rememberDiagnostics(best);
  throw new Error("Unable to produce a valid encounter within the bounded attempt limit");
}

export { reachableFloorCount };
