import type { GameMap, TileType, Unit } from "./map.ts";
import { UNIT_AP, UNIT_HP, generateUnitId } from "./map.ts";

export type ValidationSeverity = "error" | "warning" | "notice" | "info";

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  at?: { x: number; y: number };
  unitId?: string;
};

export type ValidationReport = {
  issues: ValidationIssue[];
  hasErrors: boolean;
};

const VALID_TILES: ReadonlySet<TileType> = new Set<TileType>([
  "floor",
  "wall",
  "half_cover",
]);

const VALID_TEAMS: ReadonlySet<Unit["team"]> = new Set<Unit["team"]>([
  "player",
  "enemy",
]);

function isFiniteNonNegativeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

function pushError(
  issues: ValidationIssue[],
  code: string,
  message: string,
  extras?: Partial<ValidationIssue>,
): void {
  issues.push({ severity: "error", code, message, ...extras });
}

function pushWarning(
  issues: ValidationIssue[],
  code: string,
  message: string,
  extras?: Partial<ValidationIssue>,
): void {
  issues.push({ severity: "warning", code, message, ...extras });
}

export function validateMap(map: GameMap): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!isFiniteNonNegativeInt(map.width) || map.width <= 0) {
    pushError(issues, "INVALID_WIDTH", `Map width must be a positive integer (got ${String(map.width)}).`);
  }
  if (!isFiniteNonNegativeInt(map.height) || map.height <= 0) {
    pushError(issues, "INVALID_HEIGHT", `Map height must be a positive integer (got ${String(map.height)}).`);
  }
  if (!Array.isArray(map.tiles)) {
    pushError(issues, "MISSING_TILES", "Map.tiles must be an array.");
  } else if (
    isFiniteNonNegativeInt(map.width) &&
    isFiniteNonNegativeInt(map.height) &&
    map.tiles.length !== map.width * map.height
  ) {
    pushError(
      issues,
      "TILE_LENGTH_MISMATCH",
      `Tile array length (${map.tiles.length}) does not match width*height (${map.width * map.height}).`,
    );
  } else {
    for (let i = 0; i < map.tiles.length; i++) {
      const t = map.tiles[i] as unknown;
      if (typeof t !== "string" || !VALID_TILES.has(t as TileType)) {
        const x = i % map.width;
        const y = Math.floor(i / map.width);
        pushError(issues, "INVALID_TILE", `Unknown tile value '${String(t)}' at (${x}, ${y}).`, {
          at: { x, y },
        });
      }
    }
  }

  if (!Array.isArray(map.units)) {
    pushError(issues, "MISSING_UNITS", "Map.units must be an array.");
    return { issues, hasErrors: issues.some((i) => i.severity === "error") };
  }

  const seenIds = new Set<string>();
  const tileForUnit = (u: Unit): TileType | null => {
    if (!Array.isArray(map.tiles)) return null;
    if (
      !isFiniteNonNegativeInt(u.x) ||
      !isFiniteNonNegativeInt(u.y) ||
      u.x >= map.width ||
      u.y >= map.height
    ) {
      return null;
    }
    return map.tiles[u.y * map.width + u.x] ?? null;
  };

  for (const u of map.units) {
    if (!u || typeof u !== "object") {
      pushError(issues, "INVALID_UNIT", "Encountered a non-object unit entry.");
      continue;
    }
    if (typeof u.id !== "string" || u.id.length === 0) {
      pushError(issues, "INVALID_UNIT_ID", "Unit is missing a valid string id.", { unitId: String(u.id) });
    } else if (seenIds.has(u.id)) {
      pushError(issues, "DUPLICATE_UNIT_ID", `Unit id '${u.id}' is used more than once.`, { unitId: u.id });
    } else {
      seenIds.add(u.id);
    }
    if (typeof u.team !== "string" || !VALID_TEAMS.has(u.team)) {
      pushError(issues, "INVALID_UNIT_TEAM", `Unit '${u.id}' has invalid team '${String(u.team)}'.`, {
        unitId: u.id,
      });
    }
    if (
      !Number.isFinite(u.x) ||
      !Number.isFinite(u.y) ||
      !Number.isInteger(u.x) ||
      !Number.isInteger(u.y) ||
      u.x < 0 ||
      u.y < 0 ||
      u.x >= map.width ||
      u.y >= map.height
    ) {
      pushError(
        issues,
        "UNIT_OUT_OF_BOUNDS",
        `Unit '${u.id}' is outside the map at (${u.x}, ${u.y}).`,
        { unitId: u.id, at: { x: u.x, y: u.y } },
      );
    } else {
      const t = tileForUnit(u);
      if (t === "wall" || t === "half_cover") {
        pushWarning(
          issues,
          "UNIT_ON_BLOCKING_TILE",
          `Unit '${u.id}' is on a ${t} tile at (${u.x}, ${u.y}).`,
          { unitId: u.id, at: { x: u.x, y: u.y } },
        );
      }
    }
    if (
      !Number.isFinite(u.maxHp) ||
      !Number.isInteger(u.maxHp) ||
      u.maxHp <= 0
    ) {
      pushError(issues, "INVALID_UNIT_MAXHP", `Unit '${u.id}' has invalid maxHp ${String(u.maxHp)}.`, {
        unitId: u.id,
      });
    }
    if (
      !Number.isFinite(u.hp) ||
      !Number.isInteger(u.hp) ||
      u.hp < 0 ||
      (Number.isFinite(u.maxHp) && u.hp > u.maxHp)
    ) {
      pushError(issues, "INVALID_UNIT_HP", `Unit '${u.id}' has invalid hp ${String(u.hp)} (maxHp ${u.maxHp}).`, {
        unitId: u.id,
      });
    }
    if (
      !Number.isFinite(u.maxAp) ||
      !Number.isInteger(u.maxAp) ||
      u.maxAp < 0
    ) {
      pushError(issues, "INVALID_UNIT_MAXAP", `Unit '${u.id}' has invalid maxAp ${String(u.maxAp)}.`, {
        unitId: u.id,
      });
    }
    if (
      !Number.isFinite(u.ap) ||
      !Number.isInteger(u.ap) ||
      u.ap < 0 ||
      (Number.isFinite(u.maxAp) && u.ap > u.maxAp)
    ) {
      pushError(issues, "INVALID_UNIT_AP", `Unit '${u.id}' has invalid ap ${String(u.ap)} (maxAp ${u.maxAp}).`, {
        unitId: u.id,
      });
    }
    if (typeof u.overwatch !== "boolean") {
      pushError(
        issues,
        "INVALID_UNIT_OVERWATCH",
        `Unit '${u.id}' has invalid overwatch value '${String(u.overwatch)}'.`,
        { unitId: u.id },
      );
    }
  }

  // Stacked living units on the same tile.
  const tileOccupants = new Map<string, Unit[]>();
  for (const u of map.units) {
    if (!u || u.hp <= 0) continue;
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) continue;
    const k = `${u.x},${u.y}`;
    const list = tileOccupants.get(k) ?? [];
    list.push(u);
    tileOccupants.set(k, list);
  }
  for (const [, list] of tileOccupants) {
    if (list.length > 1) {
      const first = list[0];
      pushError(
        issues,
        "STACKED_UNITS",
        `Multiple living units share tile (${first.x}, ${first.y}): ${list.map((u) => u.id).join(", ")}.`,
        { at: { x: first.x, y: first.y } },
      );
    }
  }

  const livingPlayers = map.units.filter((u) => u && u.team === "player" && u.hp > 0).length;
  const livingEnemies = map.units.filter((u) => u && u.team === "enemy" && u.hp > 0).length;
  if (livingPlayers < 1) {
    pushError(issues, "NO_PLAYER_SPAWN", "Map has no living player units.");
  }
  if (livingEnemies < 1) {
    pushError(issues, "NO_ENEMY_SPAWN", "Map has no living enemy units.");
  }

  return {
    issues,
    hasErrors: issues.some((i) => i.severity === "error"),
  };
}

export function canRunMap(map: GameMap): { ok: boolean; reason?: string } {
  const report = validateMap(map);
  if (!report.hasErrors) return { ok: true };
  const first = report.issues.find((i) => i.severity === "error");
  return { ok: false, reason: first?.message };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function sanitizeLoadedMap(raw: unknown): {
  map: GameMap | null;
  report: ValidationReport;
} {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    pushError(issues, "NOT_A_MAP", "Saved data is not a map object.");
    return { map: null, report: { issues, hasErrors: true } };
  }

  const width = raw.width;
  const height = raw.height;
  if (!isFiniteNonNegativeInt(width) || width <= 0) {
    pushError(issues, "INVALID_WIDTH", `Saved map has invalid width ${String(width)}.`);
    return { map: null, report: { issues, hasErrors: true } };
  }
  if (!isFiniteNonNegativeInt(height) || height <= 0) {
    pushError(issues, "INVALID_HEIGHT", `Saved map has invalid height ${String(height)}.`);
    return { map: null, report: { issues, hasErrors: true } };
  }
  if (!Array.isArray(raw.tiles)) {
    pushError(issues, "MISSING_TILES", "Saved map is missing a tiles array.");
    return { map: null, report: { issues, hasErrors: true } };
  }
  if (raw.tiles.length !== width * height) {
    pushError(
      issues,
      "TILE_LENGTH_MISMATCH",
      `Saved tile array length ${raw.tiles.length} does not match ${width * height}.`,
    );
    return { map: null, report: { issues, hasErrors: true } };
  }

  const tiles: TileType[] = new Array(width * height);
  for (let i = 0; i < tiles.length; i++) {
    const t = raw.tiles[i];
    if (typeof t === "string" && VALID_TILES.has(t as TileType)) {
      tiles[i] = t as TileType;
    } else {
      const x = i % width;
      const y = Math.floor(i / width);
      pushWarning(issues, "INVALID_TILE", `Coerced unknown tile '${String(t)}' at (${x}, ${y}) to floor.`, {
        at: { x, y },
      });
      tiles[i] = "floor";
    }
  }

  const rawUnits = Array.isArray(raw.units) ? raw.units : [];
  if (!Array.isArray(raw.units)) {
    pushWarning(issues, "MISSING_UNITS", "Saved map missing units array; using empty list.");
  }

  const seenIds = new Set<string>();
  const cleanedUnits: Unit[] = [];
  for (const u of rawUnits as unknown[]) {
    if (!isPlainObject(u)) {
      pushWarning(issues, "INVALID_UNIT", "Dropped a non-object unit entry.");
      continue;
    }
    const team = u.team;
    if (typeof team !== "string" || !VALID_TEAMS.has(team as Unit["team"])) {
      pushWarning(
        issues,
        "INVALID_UNIT_TEAM",
        `Dropped unit with invalid team '${String(team)}'.`,
      );
      continue;
    }
    const x = u.x;
    const y = u.y;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      (x as number) < 0 ||
      (y as number) < 0 ||
      (x as number) >= width ||
      (y as number) >= height
    ) {
      pushWarning(
        issues,
        "UNIT_OUT_OF_BOUNDS",
        `Dropped unit with out-of-bounds position (${String(x)}, ${String(y)}).`,
      );
      continue;
    }
    const ix = x as number;
    const iy = y as number;

    let id = typeof u.id === "string" && u.id.length > 0 ? u.id : "";
    if (!id) {
      id = generateUnitId(team as Unit["team"]);
      pushWarning(issues, "MISSING_UNIT_ID", `Generated id '${id}' for a unit missing one.`, {
        unitId: id,
      });
    } else if (seenIds.has(id)) {
      const replacement = generateUnitId(team as Unit["team"]);
      pushWarning(
        issues,
        "DUPLICATE_UNIT_ID",
        `Regenerated id for duplicate '${id}' as '${replacement}'.`,
        { unitId: replacement },
      );
      id = replacement;
    }
    seenIds.add(id);

    const maxHp =
      Number.isFinite(u.maxHp) && Number.isInteger(u.maxHp) && (u.maxHp as number) > 0
        ? (u.maxHp as number)
        : UNIT_HP;
    let hp =
      Number.isFinite(u.hp) && Number.isInteger(u.hp)
        ? (u.hp as number)
        : maxHp;
    if (hp < 0) hp = 0;
    if (hp > maxHp) hp = maxHp;

    const maxAp =
      Number.isFinite(u.maxAp) && Number.isInteger(u.maxAp) && (u.maxAp as number) >= 0
        ? (u.maxAp as number)
        : UNIT_AP;
    let ap =
      Number.isFinite(u.ap) && Number.isInteger(u.ap)
        ? (u.ap as number)
        : maxAp;
    if (ap < 0) ap = 0;
    if (ap > maxAp) ap = maxAp;

    const overwatch = typeof u.overwatch === "boolean" ? u.overwatch : false;

    cleanedUnits.push({
      id,
      team: team as Unit["team"],
      x: ix,
      y: iy,
      hp,
      maxHp,
      ap,
      maxAp,
      overwatch,
    });
  }

  const cleaned: GameMap = { width, height, tiles, units: cleanedUnits };

  const report = validateMap(cleaned);
  return {
    map: cleaned,
    report: {
      issues: [...issues, ...report.issues],
      hasErrors: report.hasErrors,
    },
  };
}

export function summarizeReport(report: ValidationReport): string | null {
  if (report.issues.length === 0) return null;
  const order: ValidationSeverity[] = ["error", "warning", "notice", "info"];
  for (const sev of order) {
    const i = report.issues.find((x) => x.severity === sev);
    if (i) return `${sev.toUpperCase()}: ${i.message}`;
  }
  return null;
}

export function logReport(label: string, report: ValidationReport): void {
  if (report.issues.length === 0) return;
  const groupLabel = `[Circuit Bored] ${label}: ${report.issues.length} validation issue(s)`;
  const start = (typeof console.groupCollapsed === "function" ? console.groupCollapsed : console.log).bind(console);
  const end = (typeof console.groupEnd === "function" ? console.groupEnd : () => {}).bind(console);
  start(groupLabel);
  for (const issue of report.issues) {
    const fn =
      issue.severity === "error" ? console.error
      : issue.severity === "warning" ? console.warn
      : console.log;
    const where =
      issue.at !== undefined ? ` @(${issue.at.x},${issue.at.y})`
      : issue.unitId !== undefined ? ` [${issue.unitId}]`
      : "";
    fn.call(console, `[${issue.severity}] ${issue.code}${where} - ${issue.message}`);
  }
  end();
}
