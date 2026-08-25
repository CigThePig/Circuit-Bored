/**
 * Enemy intent.
 *
 * The player used to learn what an enemy was doing only after it had done it.
 * Intent publishes the enemy's current plan so the player can break it instead
 * of absorbing it.
 *
 * The rule this module exists to enforce: **intent is produced by the AI's own
 * planning, never by the UI guessing**. `planEnemyIntent` is the one function
 * that decides what an enemy is trying to do; the renderer reads its stored
 * output, and `takeEnemyAction` executes against the same plan. When the board
 * changes so that the plan no longer works, the AI replans and the stored
 * intent changes with it - intent is information about a plan, not a promise.
 *
 * This module owns the intent *shape* and its persistence. The planner lives in
 * `ai.ts`, because planning is the AI's job and putting it here would split one
 * decision across two files.
 */

export type IntentKind =
  /** Has a shot it means to take. */
  | "engage"
  /** Holding a bead on a target; will fire hard next turn if undisturbed. */
  | "aim"
  /** Moving to get within its preferred range of a target. */
  | "close"
  /** Moving to somewhere it can shoot from. */
  | "reposition"
  /** Committing to watch ground. */
  | "overwatch"
  /** Pinning a target with fire. */
  | "suppress"
  /** Staying put behind cover. */
  | "hold"
  /** Nothing useful available. */
  | "idle";

export type EnemyIntent = {
  kind: IntentKind;
  /** Unit this intent is aimed at, when it has one. */
  targetId: string | null;
  /** Tile the enemy means to reach or watch, when the plan has one. */
  at: { x: number; y: number } | null;
};

/** Upper bound on a stored unit id, matching the status module. */
const MAX_ID_LENGTH = 120;

const INTENT_KINDS: ReadonlySet<string> = new Set<IntentKind>([
  "engage",
  "aim",
  "close",
  "reposition",
  "overwatch",
  "suppress",
  "hold",
  "idle",
]);

export function isIntentKind(value: unknown): value is IntentKind {
  return typeof value === "string" && INTENT_KINDS.has(value);
}

export function makeIntent(
  kind: IntentKind,
  targetId: string | null = null,
  at: { x: number; y: number } | null = null,
): EnemyIntent {
  return { kind, targetId, at: at ? { x: at.x, y: at.y } : null };
}

export function cloneIntent(intent: EnemyIntent | undefined): EnemyIntent | undefined {
  if (!intent) return undefined;
  return {
    kind: intent.kind,
    targetId: intent.targetId,
    at: intent.at ? { ...intent.at } : null,
  };
}

export function intentsEqual(
  a: EnemyIntent | undefined,
  b: EnemyIntent | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind || a.targetId !== b.targetId) return false;
  if (!a.at || !b.at) return a.at === b.at;
  return a.at.x === b.at.x && a.at.y === b.at.y;
}

/**
 * Coerce saved data into an intent. An intent is a cached plan, so anything
 * malformed is simply dropped: the next planning pass regenerates it, and a
 * missing intent renders as nothing rather than as a wrong prediction.
 */
export function sanitizeIntent(raw: unknown): EnemyIntent | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (!isIntentKind(value.kind)) return undefined;
  const targetId = typeof value.targetId === "string" && value.targetId.length > 0
    ? value.targetId.slice(0, MAX_ID_LENGTH)
    : null;
  let at: { x: number; y: number } | null = null;
  const rawAt = value.at;
  if (rawAt && typeof rawAt === "object" && !Array.isArray(rawAt)) {
    const point = rawAt as Record<string, unknown>;
    if (
      typeof point.x === "number" && Number.isInteger(point.x) && point.x >= 0 &&
      typeof point.y === "number" && Number.isInteger(point.y) && point.y >= 0
    ) {
      at = { x: point.x, y: point.y };
    }
  }
  return { kind: value.kind, targetId, at };
}

/** True when the value is a well-formed intent (or absent). */
export function isValidIntent(raw: unknown): boolean {
  if (raw === undefined) return true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (!isIntentKind(value.kind)) return false;
  if (
    value.targetId !== null &&
    (typeof value.targetId !== "string" ||
      value.targetId.length === 0 ||
      value.targetId.length > MAX_ID_LENGTH)
  ) {
    return false;
  }
  if (value.at !== null) {
    if (!value.at || typeof value.at !== "object" || Array.isArray(value.at)) return false;
    const point = value.at as Record<string, unknown>;
    if (typeof point.x !== "number" || !Number.isInteger(point.x) || point.x < 0) return false;
    if (typeof point.y !== "number" || !Number.isInteger(point.y) || point.y < 0) return false;
  }
  return true;
}

/**
 * The banner text shown above an enemy.
 *
 * Deliberately terse. These are drawn over the board at a 28 px cell size and
 * several can be on screen at once, so a long phrase spans five cells and turns
 * a squad of hostiles into a wall of text. `targetName` is resolved by the
 * caller so this module needs no map.
 */
export function intentLabel(
  intent: EnemyIntent | undefined,
  targetName: string | null,
): string | null {
  if (!intent) return null;
  const at = targetName ?? "TARGET";
  switch (intent.kind) {
    case "aim":
      return `AIMING AT ${at.toUpperCase()}`;
    case "engage":
      return `ENGAGING ${at.toUpperCase()}`;
    case "suppress":
      return `SUPPRESSING ${at.toUpperCase()}`;
    case "close":
      return `CLOSING ON ${at.toUpperCase()}`;
    case "reposition":
      return "REPOSITIONING";
    case "overwatch":
      return "SETTING WATCH";
    case "hold":
      return "HOLDING";
    case "idle":
      return null;
  }
}

/**
 * One sentence naming the counter-play, shown when the player inspects an
 * enemy. The point of publishing intent is that the player can act on it, so
 * the UI says what acting on it looks like.
 */
export function intentCounterHint(intent: EnemyIntent | undefined): string | null {
  if (!intent) return null;
  switch (intent.kind) {
    case "aim":
      return "Break line of sight, suppress it, or force it to move before it fires.";
    case "engage":
      return "Break the firing line, or make the shot expensive with cover.";
    case "suppress":
      return "Move the target out of its firing line, or remove the shooter.";
    case "close":
      return "Control the approach: overwatch the lane, or hold it at range.";
    case "reposition":
      return "Cover the ground it wants, or take the position first.";
    case "overwatch":
      return "Suppress it to break the watch, or route around the ground it covers.";
    case "hold":
      return "It will not come to you. Flank it or force it out.";
    case "idle":
      return null;
  }
}
