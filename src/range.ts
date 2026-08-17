/**
 * Weapon range bands.
 *
 * Distance used to barely matter: every shot was the same shot at any reach.
 * Three named bands are enough to give weapons an identity without turning
 * targeting into a simulation - the player reads "close / medium / long" off
 * the board, not a falloff curve.
 *
 * Distance is Chebyshev, the same metric movement uses, so a band boundary sits
 * exactly where a given number of steps sits. Bands are deliberately coarse:
 * one step rarely changes a band, so moving for range is a real decision rather
 * than a per-tile optimisation.
 */

export type RangeBand = "close" | "medium" | "long";

export const RANGE_BANDS: readonly RangeBand[] = ["close", "medium", "long"];

/** Inclusive upper bound of the close band, in eight-way steps. */
export const CLOSE_MAX = 3;
/** Inclusive upper bound of the medium band. Beyond it is long. */
export const MEDIUM_MAX = 8;

export function tileDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function rangeBandForDistance(distance: number): RangeBand {
  if (distance <= CLOSE_MAX) return "close";
  if (distance <= MEDIUM_MAX) return "medium";
  return "long";
}

export function rangeBandBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): RangeBand {
  return rangeBandForDistance(tileDistance(a, b));
}

/**
 * A unit's accuracy and damage adjustment in each band. Everything defaults to
 * zero, so a unit without a profile - a fixture, an editor unit, an old save -
 * behaves exactly as it did before ranges existed.
 */
export type RangeProfile = {
  closeAccuracy: number;
  mediumAccuracy: number;
  longAccuracy: number;
  /** Extra damage inside the close band. Used sparingly, for brawlers. */
  closeDamage: number;
  /** Extra damage at long range. Used sparingly, for dedicated shooters. */
  longDamage: number;
};

export const EMPTY_RANGE_PROFILE: RangeProfile = {
  closeAccuracy: 0,
  mediumAccuracy: 0,
  longAccuracy: 0,
  closeDamage: 0,
  longDamage: 0,
};

type RangeCarrier = Partial<RangeProfile> | undefined | null;

export function rangeAccuracy(profile: RangeCarrier, band: RangeBand): number {
  if (!profile) return 0;
  if (band === "close") return profile.closeAccuracy ?? 0;
  if (band === "medium") return profile.mediumAccuracy ?? 0;
  return profile.longAccuracy ?? 0;
}

export function rangeDamage(profile: RangeCarrier, band: RangeBand): number {
  if (!profile) return 0;
  if (band === "close") return profile.closeDamage ?? 0;
  if (band === "long") return profile.longDamage ?? 0;
  return 0;
}

/** Short label for HUD and tooltip text. */
export function rangeBandLabel(band: RangeBand): string {
  if (band === "close") return "CLOSE";
  if (band === "medium") return "MEDIUM";
  return "LONG";
}

/**
 * How a unit rates a band, for HUD text and AI preference: "strong", "weak",
 * or "even". A threshold rather than the raw number, so the player is told
 * something they can act on instead of a decimal.
 */
export type RangeRating = "strong" | "even" | "weak";

/** Accuracy swing at which a band stops being ordinary for a unit. */
export const RANGE_RATING_THRESHOLD = 0.06;

export function rangeRating(profile: RangeCarrier, band: RangeBand): RangeRating {
  const value = rangeAccuracy(profile, band) + rangeDamage(profile, band) * 0.1;
  if (value >= RANGE_RATING_THRESHOLD) return "strong";
  if (value <= -RANGE_RATING_THRESHOLD) return "weak";
  return "even";
}

/** The band a unit is happiest in, for AI positioning and HUD summaries. */
export function preferredBand(profile: RangeCarrier): RangeBand {
  let best: RangeBand = "medium";
  let bestValue = -Infinity;
  for (const band of RANGE_BANDS) {
    const value = rangeAccuracy(profile, band) + rangeDamage(profile, band) * 0.1;
    if (value > bestValue) {
      bestValue = value;
      best = band;
    }
  }
  return best;
}

/** Ideal distance in tiles for a unit that wants to fight in `band`. */
export function bandTargetDistance(band: RangeBand): number {
  if (band === "close") return 1;
  if (band === "medium") return Math.round((CLOSE_MAX + 1 + MEDIUM_MAX) / 2);
  return MEDIUM_MAX + 2;
}
