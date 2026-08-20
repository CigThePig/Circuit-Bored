/**
 * First-class tactical statuses.
 *
 * Temporary combat states are gameplay truth, not presentation: they live on
 * the unit, are cloned with the map, survive a save, and are read by previews,
 * resolution, and the AI through the same helpers. Nothing here knows about
 * rendering.
 *
 * The shape is deliberately flat. Every field is a boolean or a small integer
 * so validation, sanitisation, and save migration stay trivial, and so a unit
 * loaded from a pre-status save simply has no `statuses` object at all.
 */

export type UnitStatuses = {
  /**
   * Set by Aim. Consumed by the unit's next resolved shot, cancelled by
   * movement, and cleared at the start of the unit's next turn.
   */
  aimed: boolean;
  /**
   * Set by Hunker. Cleared at the start of the unit's next turn, so it covers
   * exactly one opposing turn.
   */
  hunkered: boolean;
  /**
   * Remaining turns of Suppressed, counted in the suppressed unit's own turns.
   * Decremented when that unit's turn ends, so a suppression applied on one
   * side's turn lasts through the other side's next turn and no longer.
   */
  suppressed: number;
  /**
   * Remaining turns of Marked, counted the same way as Suppressed. A marked
   * unit is easier for the marker's squadmates to hit and its cover counts for
   * less against them.
   */
  marked: number;
  /**
   * Id of the unit that applied the mark, so the marker itself can be excluded
   * from the benefit. Mark is a coordination tool, not a personal damage buff.
   * An unresolvable id simply means nobody is excluded.
   */
  markedBy: string | null;
  /**
   * Set by Brace. A braced unit takes less damage and ignores suppression's
   * action-point penalty, but the state is cancelled by moving.
   */
  braced: boolean;
  /**
   * Set by Dash. Movement is cheaper for the rest of the turn. Cleared at the
   * unit's next turn.
   */
  dashing: boolean;
  /**
   * Reaction shots this unit can slip past before overwatch bites again.
   * Granted by Dash and consumed by the first reaction it avoids, so a dashing
   * unit crosses one watched lane rather than becoming immune to lanes.
   */
  overwatchEvasion: number;
  /**
   * Id of the ally currently protecting this unit with Guard, or null. The link
   * is resolved at damage time - the guardian must still be alive and close
   * enough - so a stale id can never grant protection.
   */
  guardedBy: string | null;
};

/** Turns of Suppressed applied by one Suppress action. */
export const SUPPRESSION_TURNS = 1;

/**
 * Longest suppression the game can produce, once upgrades are counted. Saves
 * clamp to this rather than to the base duration, so a legitimately extended
 * suppression is not silently shortened by a reload.
 */
export const MAX_SUPPRESSION_TURNS = SUPPRESSION_TURNS + 1;

/** Turns of Marked applied by one Mark action. */
export const MARK_TURNS = 1;

/** Action points a suppressed unit loses at the start of its turn. */
export const SUPPRESSED_AP_PENALTY = 1;

/** Reaction shots one Dash lets the unit slip past. */
export const DASH_OVERWATCH_EVASION = 1;

/** Upper bound on any stored unit id, so a save cannot carry unbounded text. */
const MAX_ID_LENGTH = 120;

export function createStatuses(): UnitStatuses {
  return {
    aimed: false,
    hunkered: false,
    suppressed: 0,
    marked: 0,
    markedBy: null,
    braced: false,
    dashing: false,
    overwatchEvasion: 0,
    guardedBy: null,
  };
}

/**
 * Copy a unit's statuses for a cloned map.
 *
 * An all-default object and no object at all mean the same thing, and the save
 * layer already writes the second form: `sanitizeStatuses` drops statuses that
 * carry nothing. A unit whose last status expired keeps a spent object in
 * memory, so cloning it verbatim made a live board and its own reload differ by
 * a field that means nothing. Cloning canonicalises instead, which is what makes
 * a saved encounter compare equal to the board it was written from.
 */
export function cloneStatuses(statuses: UnitStatuses | undefined): UnitStatuses | undefined {
  if (!statuses || statusesAreClear(statuses)) return undefined;
  return { ...statuses };
}

/** True when every field is at its default, so the object carries no meaning. */
export function statusesAreClear(statuses: UnitStatuses | undefined): boolean {
  if (!statuses) return true;
  return !statuses.aimed &&
    !statuses.hunkered &&
    statuses.suppressed <= 0 &&
    statuses.marked <= 0 &&
    statuses.markedBy === null &&
    !statuses.braced &&
    !statuses.dashing &&
    statuses.overwatchEvasion <= 0 &&
    statuses.guardedBy === null;
}

type StatusCarrier = { statuses?: UnitStatuses };

/** Read-only view of a unit's statuses; pre-status saves read as all-clear. */
export function statusesOf(unit: StatusCarrier): UnitStatuses {
  return unit.statuses ?? EMPTY_STATUSES;
}

const EMPTY_STATUSES: UnitStatuses = Object.freeze(createStatuses()) as UnitStatuses;

/** Writable statuses, created on demand so old units upgrade on first use. */
export function ensureStatuses(unit: StatusCarrier): UnitStatuses {
  if (!unit.statuses) unit.statuses = createStatuses();
  return unit.statuses;
}

export function isAimed(unit: StatusCarrier): boolean {
  return statusesOf(unit).aimed === true;
}

export function isHunkered(unit: StatusCarrier): boolean {
  return statusesOf(unit).hunkered === true;
}

export function isSuppressed(unit: StatusCarrier): boolean {
  return statusesOf(unit).suppressed > 0;
}

export function setAimed(unit: StatusCarrier, value: boolean): void {
  if (!value && !unit.statuses) return;
  ensureStatuses(unit).aimed = value;
}

export function setHunkered(unit: StatusCarrier, value: boolean): void {
  if (!value && !unit.statuses) return;
  ensureStatuses(unit).hunkered = value;
}

export function setSuppressed(unit: StatusCarrier, turns: number): void {
  const clamped = Math.max(0, Math.floor(turns));
  if (clamped === 0 && !unit.statuses) return;
  ensureStatuses(unit).suppressed = clamped;
}

export function isMarked(unit: StatusCarrier): boolean {
  return statusesOf(unit).marked > 0;
}

export function setMarked(
  unit: StatusCarrier,
  turns: number,
  markerId: string | null = null,
): void {
  const clamped = Math.max(0, Math.floor(turns));
  if (clamped === 0 && !unit.statuses) return;
  const statuses = ensureStatuses(unit);
  statuses.marked = clamped;
  statuses.markedBy = clamped > 0 ? markerId : null;
}

export function isBraced(unit: StatusCarrier): boolean {
  return statusesOf(unit).braced === true;
}

export function setBraced(unit: StatusCarrier, value: boolean): void {
  if (!value && !unit.statuses) return;
  ensureStatuses(unit).braced = value;
}

export function isDashing(unit: StatusCarrier): boolean {
  return statusesOf(unit).dashing === true;
}

export function setDashing(unit: StatusCarrier, value: boolean, evasion = 0): void {
  if (!value && !unit.statuses) return;
  const statuses = ensureStatuses(unit);
  statuses.dashing = value;
  statuses.overwatchEvasion = value ? Math.max(0, Math.floor(evasion)) : 0;
}

/** Remaining reaction shots this unit can slip past. */
export function overwatchEvasion(unit: StatusCarrier): number {
  return Math.max(0, statusesOf(unit).overwatchEvasion);
}

/** Spend one evasion charge. Returns true when one was available. */
export function consumeOverwatchEvasion(unit: StatusCarrier): boolean {
  const statuses = unit.statuses;
  if (!statuses || statuses.overwatchEvasion <= 0) return false;
  statuses.overwatchEvasion -= 1;
  return true;
}

export function guardedBy(unit: StatusCarrier): string | null {
  return statusesOf(unit).guardedBy;
}

export function setGuardedBy(unit: StatusCarrier, guardianId: string | null): void {
  if (guardianId === null && !unit.statuses) return;
  ensureStatuses(unit).guardedBy = guardianId;
}

/**
 * Coerce arbitrary saved data into statuses. Returns undefined when the value
 * carries nothing, so a clean unit never gains a redundant object and an old
 * save degrades to "no statuses" rather than failing to load.
 */
function sanitizeTurns(raw: unknown, max: number): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? Math.min(raw, max)
    : 0;
}

function sanitizeId(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0
    ? raw.slice(0, MAX_ID_LENGTH)
    : null;
}

export function sanitizeStatuses(raw: unknown): UnitStatuses | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Partial<Record<keyof UnitStatuses, unknown>>;
  const marked = sanitizeTurns(value.marked, MARK_TURNS);
  const statuses: UnitStatuses = {
    aimed: value.aimed === true,
    hunkered: value.hunkered === true,
    suppressed: sanitizeTurns(value.suppressed, MAX_SUPPRESSION_TURNS),
    marked,
    // A marker id without a live mark carries no meaning, so it is dropped
    // rather than kept as dangling text in the save.
    markedBy: marked > 0 ? sanitizeId(value.markedBy) : null,
    braced: value.braced === true,
    dashing: value.dashing === true,
    overwatchEvasion: sanitizeTurns(value.overwatchEvasion, DASH_OVERWATCH_EVASION),
    guardedBy: sanitizeId(value.guardedBy),
  };
  return statusesAreClear(statuses) ? undefined : statuses;
}

function validTurns(raw: unknown, max: number): boolean {
  return typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= 0 &&
    raw <= max;
}

function validId(raw: unknown): boolean {
  return raw === null ||
    (typeof raw === "string" && raw.length > 0 && raw.length <= MAX_ID_LENGTH);
}

/** True when the value is a well-formed statuses object (or absent). */
export function isValidStatuses(raw: unknown): boolean {
  if (raw === undefined) return true;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const value = raw as Partial<Record<keyof UnitStatuses, unknown>>;
  if (typeof value.aimed !== "boolean") return false;
  if (typeof value.hunkered !== "boolean") return false;
  if (typeof value.braced !== "boolean") return false;
  if (typeof value.dashing !== "boolean") return false;
  if (!validTurns(value.suppressed, MAX_SUPPRESSION_TURNS)) return false;
  if (!validTurns(value.marked, MARK_TURNS)) return false;
  if (!validTurns(value.overwatchEvasion, DASH_OVERWATCH_EVASION)) return false;
  if (!validId(value.markedBy)) return false;
  if (!validId(value.guardedBy)) return false;
  return true;
}
