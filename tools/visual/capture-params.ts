/**
 * The capture contract shared by the browser-side Visual Lab and the Node
 * capture runner.
 *
 * Both halves of the pipeline have to agree on exactly one thing: what a
 * capture URL means. Keeping the parser, the serializer, and the file-name
 * slug in one browser-safe module means a runner can never ask for a frame the
 * lab would interpret differently, and a stale slug can never silently pair a
 * baseline with a different current image.
 */
import { isLevelThemeId, type LevelThemeId } from "../../src/themes.ts";

export const VIEW_MODES = ["normal", "grayscale", "contrast", "squint", "semantic"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const BACKDROP_MODES = ["dark", "light"] as const;
export type BackdropMode = (typeof BACKDROP_MODES)[number];

export const GENERATION_PROFILES = ["landmark", "quiet"] as const;
export type GenerationProfile = (typeof GENERATION_PROFILES)[number];

/** The scene id reserved for on-demand generated boards (seed sampling). */
export const SEED_SCENE_ID = "seed-inspection";

export const MIN_CELL = 24;
export const MAX_CELL = 64;
export const DEFAULT_CELL = 40;
export const DEFAULT_SEED = "REVIEW-SEED-1";
/** Every non-animated capture renders at this frame timestamp. */
export const STATIC_CAPTURE_TIME_MS = 0;
/** Largest capture timestamp accepted, so a typo cannot request an hour of animation. */
export const MAX_CAPTURE_TIME_MS = 600_000;

export type InspectionParams = {
  themeId: LevelThemeId;
  profile: GenerationProfile;
  seed: string;
};

export type CaptureParams = {
  /** True when the lab should present a single scene for automation. */
  capture: boolean;
  /** Requested scene id. Always present in capture mode. */
  sceneId: string | null;
  cell: number;
  view: ViewMode;
  backdrop: BackdropMode;
  timeMs: number;
  overlays: boolean;
  ambient: boolean;
  /** Draw the compact deterministic caption under the board. */
  label: boolean;
  inspection: InspectionParams;
};

export type ParsedCaptureParams = {
  params: CaptureParams;
  /** Human-readable problems. Non-empty means the request was malformed. */
  issues: string[];
};

export const DEFAULT_CAPTURE_PARAMS: CaptureParams = {
  capture: false,
  sceneId: null,
  cell: DEFAULT_CELL,
  view: "normal",
  backdrop: "dark",
  timeMs: STATIC_CAPTURE_TIME_MS,
  overlays: true,
  ambient: true,
  label: true,
  inspection: { themeId: "industrial", profile: "landmark", seed: DEFAULT_SEED },
};

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === "string" && (VIEW_MODES as readonly string[]).includes(value);
}

export function isBackdropMode(value: unknown): value is BackdropMode {
  return typeof value === "string" && (BACKDROP_MODES as readonly string[]).includes(value);
}

export function isGenerationProfile(value: unknown): value is GenerationProfile {
  return typeof value === "string" && (GENERATION_PROFILES as readonly string[]).includes(value);
}

/** Cell sizes are even and inside the reviewable range the lab slider exposes. */
export function clampCellSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CELL;
  return Math.max(MIN_CELL, Math.min(MAX_CELL, Math.round(value / 2) * 2));
}

function toSearchParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : search;
}

function readBoolean(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw !== "0" && raw !== "false";
}

/**
 * Parse a capture URL. Interactive use stays forgiving so a hand-edited URL
 * still opens the lab, but every correction is reported so capture mode can
 * refuse to produce a screenshot that does not match what was requested.
 */
export function parseCaptureParams(search: string | URLSearchParams): ParsedCaptureParams {
  const params = toSearchParams(search);
  const issues: string[] = [];
  const capture = readBoolean(params, "capture", false);

  const rawCell = params.get("cell");
  let cell = DEFAULT_CELL;
  if (rawCell !== null) {
    const numeric = Number(rawCell);
    cell = clampCellSize(numeric);
    if (!Number.isFinite(numeric)) issues.push(`cell '${rawCell}' is not a number`);
    else if (numeric !== cell) issues.push(`cell ${numeric} is not an even size between ${MIN_CELL} and ${MAX_CELL}`);
  }

  const rawView = params.get("view");
  const view: ViewMode = isViewMode(rawView) ? rawView : "normal";
  if (rawView !== null && !isViewMode(rawView)) issues.push(`view '${rawView}' is not one of ${VIEW_MODES.join(", ")}`);

  const rawBackdrop = params.get("backdrop");
  const backdrop: BackdropMode = isBackdropMode(rawBackdrop) ? rawBackdrop : "dark";
  if (rawBackdrop !== null && !isBackdropMode(rawBackdrop)) issues.push(`backdrop '${rawBackdrop}' is not one of ${BACKDROP_MODES.join(", ")}`);

  const rawTime = params.get("time");
  let timeMs = STATIC_CAPTURE_TIME_MS;
  if (rawTime !== null) {
    const numeric = Number(rawTime);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > MAX_CAPTURE_TIME_MS) {
      issues.push(`time '${rawTime}' must be between 0 and ${MAX_CAPTURE_TIME_MS} ms`);
    } else {
      timeMs = Math.round(numeric);
    }
  }

  const rawTheme = params.get("inspectionTheme");
  const themeId: LevelThemeId = isLevelThemeId(rawTheme) ? rawTheme : "industrial";
  if (rawTheme !== null && !isLevelThemeId(rawTheme)) issues.push(`inspectionTheme '${rawTheme}' is not a level theme`);

  const rawProfile = params.get("inspectionProfile");
  const profile: GenerationProfile = isGenerationProfile(rawProfile) ? rawProfile : "landmark";
  if (rawProfile !== null && !isGenerationProfile(rawProfile)) issues.push(`inspectionProfile '${rawProfile}' is not landmark or quiet`);

  const seed = (params.get("inspectionSeed") ?? DEFAULT_SEED).trim().slice(0, 80) || DEFAULT_SEED;

  const sceneId = params.get("scene");
  if (capture && !sceneId) issues.push("capture mode requires a 'scene' parameter");

  return {
    params: {
      capture,
      sceneId: sceneId && sceneId.length > 0 ? sceneId : null,
      cell,
      view,
      backdrop,
      timeMs,
      overlays: readBoolean(params, "overlays", true),
      ambient: readBoolean(params, "ambient", true),
      label: readBoolean(params, "label", true),
      inspection: { themeId, profile, seed },
    },
    issues,
  };
}

/**
 * Validate a parsed request against the scenes that actually exist. A capture
 * that names a missing scene must fail loudly instead of screenshotting
 * whatever happened to be on the page.
 */
export function validateCaptureRequest(
  params: CaptureParams,
  knownSceneIds: readonly string[],
): string[] {
  const issues: string[] = [];
  if (!params.capture) return issues;
  if (!params.sceneId) {
    issues.push("capture mode requires a 'scene' parameter");
    return issues;
  }
  if (params.sceneId !== SEED_SCENE_ID && !knownSceneIds.includes(params.sceneId)) {
    issues.push(
      `unknown scene '${params.sceneId}'. Known scenes: ${[...knownSceneIds, SEED_SCENE_ID].join(", ")}`,
    );
  }
  return issues;
}

/** Serialize capture params back into the canonical URL query order. */
export function captureSearchParams(params: CaptureParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params.capture) search.set("capture", "1");
  if (params.sceneId) search.set("scene", params.sceneId);
  search.set("cell", String(params.cell));
  search.set("view", params.view);
  search.set("backdrop", params.backdrop);
  search.set("time", String(params.timeMs));
  search.set("overlays", params.overlays ? "1" : "0");
  search.set("ambient", params.ambient ? "1" : "0");
  if (!params.label) search.set("label", "0");
  if (params.sceneId === SEED_SCENE_ID) {
    search.set("inspectionTheme", params.inspection.themeId);
    search.set("inspectionProfile", params.inspection.profile);
    search.set("inspectionSeed", params.inspection.seed);
  }
  return search;
}

export function captureUrl(origin: string, params: CaptureParams): string {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${base}/visual-lab.html?${captureSearchParams(params)}`;
}

/** File-name-safe fragment identifying a capture configuration. */
export function captureSlug(params: CaptureParams): string {
  return `${params.cell}px-${params.view}-t${params.timeMs}`;
}

/**
 * Only characters that are safe in a path segment on every platform. Used by
 * both the matrix and the runner so a scene id can never escape the artifact
 * directory or collide after sanitizing.
 */
export function safeSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "unnamed";
}
