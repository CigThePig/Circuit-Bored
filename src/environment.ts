export type MapRect = { x: number; y: number; width: number; height: number };

/**
 * Bespoke landmark families. Each kind names an environmental noun the player
 * should be able to recognise at a glance, and each has dedicated multi-tile
 * artwork in `renderLandmarks.ts`. Kinds are grouped by theme family, but the
 * list stays flat so saved maps only ever store a stable string.
 */
export const LANDMARK_KINDS = [
  // Industrial Processing Foundry
  "furnace_block",
  "processing_line",
  "coolant_tanks",
  "loading_bay",
  "pipe_manifold",
  "crane_gantry",
  // Data Core Security Complex
  "server_vault",
  "data_core",
  "security_checkpoint",
  "server_rows",
  "relay_bank",
  "control_hub",
  // Derelict Maintenance Salvage Deck
  "collapsed_room",
  "scrap_heap",
  "wrecked_machinery",
  "breached_corridor",
  "salvage_rig",
  "reactor_wreck",
] as const;

export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

/**
 * "dominant" is the single feature that anchors the whole board. "major" is a
 * strong supporting noun and "secondary" is a smaller structure. Older saves
 * only ever contain "major"/"secondary" and stay valid.
 */
export const LANDMARK_IMPORTANCES = ["dominant", "major", "secondary"] as const;
export type LandmarkImportance = (typeof LANDMARK_IMPORTANCES)[number];

/** The side the feature presents its working face to. */
export const LANDMARK_ORIENTATIONS = ["n", "e", "s", "w"] as const;
export type LandmarkOrientation = (typeof LANDMARK_ORIENTATIONS)[number];

/**
 * Restrained, localized ambient motion. Only landmark artwork uses these; the
 * ordinary board stays completely still.
 */
export const LANDMARK_AMBIENTS = [
  "none",
  "furnace_pulse",
  "coolant_shimmer",
  "conveyor_drift",
  "beacon_blink",
  "server_flicker",
  "data_flow",
  "spark_burst",
  "unstable_flicker",
] as const;

export type LandmarkAmbient = (typeof LANDMARK_AMBIENTS)[number];

export const MAX_LANDMARK_VARIANT = 3;

export type MapLandmark = {
  id: string;
  name: string;
  kind: LandmarkKind;
  importance: LandmarkImportance;
  rect: MapRect;
  /** Facing of the feature's working face. Legacy metadata defaults to "s". */
  orientation?: LandmarkOrientation;
  /** Stable sub-variant index (0..MAX_LANDMARK_VARIANT) for bespoke artwork. */
  variant?: number;
  /** Localized ambient animation family. Legacy metadata defaults to "none". */
  ambient?: LandmarkAmbient;
};

export const FLOOR_TREATMENT_IDS = [
  "plain",
  "service_lane",
  "machine_bay",
  "loading_apron",
  "vault_grid",
  "checkpoint_threshold",
  "server_hall",
  "collapsed_deck",
  "salvage_wear",
  "breach_scars",
] as const;

export type FloorTreatmentId = (typeof FLOOR_TREATMENT_IDS)[number];

/**
 * What a region of the board is *for*. Zone roles let the lab (and future
 * gameplay copy) describe a map as a set of purposeful areas rather than as
 * open floor plus blockers.
 */
export const ZONE_ROLES = [
  "machine_service",
  "loading_lane",
  "processing_hall",
  "checkpoint_approach",
  "server_access",
  "vault_perimeter",
  "collapsed_bay",
  "breach_corridor",
  "salvage_work",
  "control_floor",
] as const;

export type ZoneRole = (typeof ZONE_ROLES)[number];

export type FloorTreatmentZone = {
  id: string;
  treatment: FloorTreatmentId;
  rect: MapRect;
  /** Optional semantic role. Legacy zones simply have no declared role. */
  role?: ZoneRole;
  /** Landmark this region belongs to, if it is an owned apron/perimeter. */
  ownerId?: string;
};

export type FeatureBudget = {
  major: number;
  secondary: number;
  minor: number;
};

/**
 * "quiet" composes one dominant feature with generous negative space.
 * "heavy" keeps the same dominant feature but surrounds it with supporting
 * context. Legacy maps without a profile are treated as "quiet".
 */
export const ENVIRONMENT_PROFILES = ["quiet", "heavy"] as const;
export type EnvironmentProfile = (typeof ENVIRONMENT_PROFILES)[number];

export type MapEnvironment = {
  landmarks: MapLandmark[];
  floorZones: FloorTreatmentZone[];
  featureBudget: FeatureBudget;
  /** Composition profile. Optional so pre-existing saves keep loading. */
  profile?: EnvironmentProfile;
};

export function isLandmarkKind(value: unknown): value is LandmarkKind {
  return typeof value === "string" && (LANDMARK_KINDS as readonly string[]).includes(value);
}

export function isLandmarkImportance(value: unknown): value is LandmarkImportance {
  return typeof value === "string" && (LANDMARK_IMPORTANCES as readonly string[]).includes(value);
}

export function isLandmarkOrientation(value: unknown): value is LandmarkOrientation {
  return typeof value === "string" && (LANDMARK_ORIENTATIONS as readonly string[]).includes(value);
}

export function isLandmarkAmbient(value: unknown): value is LandmarkAmbient {
  return typeof value === "string" && (LANDMARK_AMBIENTS as readonly string[]).includes(value);
}

export function isFloorTreatmentId(value: unknown): value is FloorTreatmentId {
  return typeof value === "string" && (FLOOR_TREATMENT_IDS as readonly string[]).includes(value);
}

export function isZoneRole(value: unknown): value is ZoneRole {
  return typeof value === "string" && (ZONE_ROLES as readonly string[]).includes(value);
}

export function isEnvironmentProfile(value: unknown): value is EnvironmentProfile {
  return typeof value === "string" && (ENVIRONMENT_PROFILES as readonly string[]).includes(value);
}

export function isLandmarkVariant(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_LANDMARK_VARIANT;
}

/** Legacy-safe accessors. Old saved maps omit the identity fields entirely. */
export function landmarkOrientation(landmark: MapLandmark): LandmarkOrientation {
  return isLandmarkOrientation(landmark.orientation) ? landmark.orientation : "s";
}

export function landmarkVariant(landmark: MapLandmark): number {
  return isLandmarkVariant(landmark.variant) ? landmark.variant : 0;
}

export function landmarkAmbient(landmark: MapLandmark): LandmarkAmbient {
  return isLandmarkAmbient(landmark.ambient) ? landmark.ambient : "none";
}

export function environmentProfile(environment: MapEnvironment | undefined): EnvironmentProfile {
  return isEnvironmentProfile(environment?.profile) ? environment!.profile! : "quiet";
}

/** "dominant" and "major" both read as primary structure for older data. */
export function isPrimaryLandmark(landmark: MapLandmark): boolean {
  return landmark.importance === "dominant" || landmark.importance === "major";
}

export function dominantLandmark(environment: MapEnvironment | undefined): MapLandmark | null {
  if (!environment || environment.landmarks.length === 0) return null;
  const explicit = environment.landmarks.find(({ importance }) => importance === "dominant");
  if (explicit) return explicit;
  // Legacy fallback: the largest major footprint is the de-facto anchor.
  const majors = environment.landmarks.filter(isPrimaryLandmark);
  const pool = majors.length > 0 ? majors : environment.landmarks;
  return pool.reduce((best, item) =>
    item.rect.width * item.rect.height > best.rect.width * best.rect.height ? item : best
  );
}

export function cloneLandmark(landmark: MapLandmark): MapLandmark {
  return { ...landmark, rect: { ...landmark.rect } };
}

export function cloneFloorZone(zone: FloorTreatmentZone): FloorTreatmentZone {
  return { ...zone, rect: { ...zone.rect } };
}

export function cloneEnvironment(environment: MapEnvironment): MapEnvironment {
  return {
    featureBudget: { ...environment.featureBudget },
    landmarks: environment.landmarks.map(cloneLandmark),
    floorZones: environment.floorZones.map(cloneFloorZone),
    ...(environment.profile === undefined ? {} : { profile: environment.profile }),
  };
}

export function pointInRect(x: number, y: number, rect: MapRect): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

export function rectsOverlap(a: MapRect, b: MapRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function floorTreatmentAt(environment: MapEnvironment | undefined, x: number, y: number): FloorTreatmentZone | null {
  if (!environment) return null;
  // Later, smaller zones deliberately override broad room treatments.
  for (let index = environment.floorZones.length - 1; index >= 0; index--) {
    const zone = environment.floorZones[index];
    if (pointInRect(x, y, zone.rect)) return zone;
  }
  return null;
}

export function landmarkAt(environment: MapEnvironment | undefined, x: number, y: number): MapLandmark | null {
  if (!environment) return null;
  for (const landmark of environment.landmarks) {
    if (pointInRect(x, y, landmark.rect)) return landmark;
  }
  return null;
}
