export type MapRect = { x: number; y: number; width: number; height: number };

export const LANDMARK_KINDS = [
  "furnace_block",
  "processing_line",
  "coolant_tanks",
  "loading_bay",
  "server_vault",
  "data_core",
  "security_checkpoint",
  "server_rows",
  "collapsed_room",
  "scrap_heap",
  "wrecked_machinery",
  "breached_corridor",
] as const;

export type LandmarkKind = (typeof LANDMARK_KINDS)[number];
export type LandmarkImportance = "major" | "secondary";

export type MapLandmark = {
  id: string;
  name: string;
  kind: LandmarkKind;
  importance: LandmarkImportance;
  rect: MapRect;
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

export type FloorTreatmentZone = {
  id: string;
  treatment: FloorTreatmentId;
  rect: MapRect;
};

export type FeatureBudget = {
  major: number;
  secondary: number;
  minor: number;
};

export type MapEnvironment = {
  landmarks: MapLandmark[];
  floorZones: FloorTreatmentZone[];
  featureBudget: FeatureBudget;
};

export function isLandmarkKind(value: unknown): value is LandmarkKind {
  return typeof value === "string" && (LANDMARK_KINDS as readonly string[]).includes(value);
}

export function isFloorTreatmentId(value: unknown): value is FloorTreatmentId {
  return typeof value === "string" && (FLOOR_TREATMENT_IDS as readonly string[]).includes(value);
}

export function pointInRect(x: number, y: number, rect: MapRect): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
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
