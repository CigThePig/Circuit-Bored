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
};

/** Turns of Suppressed applied by one Suppress action. */
export const SUPPRESSION_TURNS = 1;

/** Action points a suppressed unit loses at the start of its turn. */
export const SUPPRESSED_AP_PENALTY = 1;

export function createStatuses(): UnitStatuses {
  return { aimed: false, hunkered: false, suppressed: 0 };
}

export function cloneStatuses(statuses: UnitStatuses | undefined): UnitStatuses | undefined {
  return statuses ? { ...statuses } : undefined;
}

/** True when every field is at its default, so the object carries no meaning. */
export function statusesAreClear(statuses: UnitStatuses | undefined): boolean {
  if (!statuses) return true;
  return !statuses.aimed && !statuses.hunkered && statuses.suppressed <= 0;
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

/**
 * Coerce arbitrary saved data into statuses. Returns undefined when the value
 * carries nothing, so a clean unit never gains a redundant object and an old
 * save degrades to "no statuses" rather than failing to load.
 */
export function sanitizeStatuses(raw: unknown): UnitStatuses | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Partial<Record<keyof UnitStatuses, unknown>>;
  const suppressed =
    typeof value.suppressed === "number" &&
    Number.isInteger(value.suppressed) &&
    value.suppressed > 0
      ? Math.min(value.suppressed, SUPPRESSION_TURNS)
      : 0;
  const statuses: UnitStatuses = {
    aimed: value.aimed === true,
    hunkered: value.hunkered === true,
    suppressed,
  };
  return statusesAreClear(statuses) ? undefined : statuses;
}

/** True when the value is a well-formed statuses object (or absent). */
export function isValidStatuses(raw: unknown): boolean {
  if (raw === undefined) return true;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const value = raw as Partial<Record<keyof UnitStatuses, unknown>>;
  if (typeof value.aimed !== "boolean") return false;
  if (typeof value.hunkered !== "boolean") return false;
  if (
    typeof value.suppressed !== "number" ||
    !Number.isInteger(value.suppressed) ||
    value.suppressed < 0 ||
    value.suppressed > SUPPRESSION_TURNS
  ) {
    return false;
  }
  return true;
}
