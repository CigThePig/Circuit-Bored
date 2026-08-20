/**
 * The canonical visual-review matrix.
 *
 * This is the single place that decides what "look at the renderer" means. It
 * is deliberately explicit rather than a full cross-product: every entry costs
 * a screenshot an agent then has to read, so each one has to earn its place by
 * answering a question the other entries cannot.
 */
import {
  captureSlug,
  DEFAULT_CAPTURE_PARAMS,
  safeSegment,
  SEED_SCENE_ID,
  STATIC_CAPTURE_TIME_MS,
  type CaptureParams,
  type GenerationProfile,
  type InspectionParams,
  type ViewMode,
} from "./capture-params.ts";
import { LEVEL_THEME_IDS, type LevelThemeId } from "../../src/themes.ts";

export type ReviewCase = {
  /** Unique, file-name-safe identifier for this configuration. */
  id: string;
  /** Artifact sub-directory, one per scene family. */
  dir: string;
  /** Scene id understood by the Visual Lab. */
  sceneId: string;
  cell: number;
  view: ViewMode;
  /**
   * Fixed frame timestamps. One entry captures a single still; several capture
   * an animation strip plus one image per frame.
   */
  times: number[];
  overlays: boolean;
  ambient: boolean;
  /** Why this configuration is in the matrix. Shown in the report. */
  note: string;
  /** Present only for on-demand generated boards (sampling). */
  inspection?: InspectionParams;
};

type CaseInput = {
  sceneId: string;
  cell?: number;
  view?: ViewMode;
  times?: number[];
  overlays?: boolean;
  ambient?: boolean;
  note: string;
  dir?: string;
  idPrefix?: string;
  inspection?: InspectionParams;
};

/**
 * Combat effects loop over 1200 ms with per-shot phase offsets, so five evenly
 * spaced samples walk every shot through muzzle flash, travel, impact, and
 * recovery without any of them landing on the same phase.
 */
export const EFFECT_STRIP_TIMES = [0, 240, 480, 720, 960] as const;

/**
 * Ambient landmark motion runs on 1.9 s to 4.2 s cycles. Three widely spaced
 * frames are enough to prove motion exists and stays localized to landmarks.
 */
export const AMBIENT_STRIP_TIMES = [0, 1400, 2800] as const;

function makeCase(input: CaseInput): ReviewCase {
  const cell = input.cell ?? DEFAULT_CAPTURE_PARAMS.cell;
  const view = input.view ?? "normal";
  const times = input.times ?? [STATIC_CAPTURE_TIME_MS];
  const prefix = safeSegment(input.idPrefix ?? input.sceneId);
  const strip = times.length > 1;
  return {
    id: `${prefix}-${cell}px-${view}${strip ? "-strip" : ""}`,
    dir: safeSegment(input.dir ?? input.sceneId),
    sceneId: input.sceneId,
    cell,
    view,
    times: [...times],
    overlays: input.overlays ?? true,
    ambient: input.ambient ?? true,
    note: input.note,
    inspection: input.inspection,
  };
}

/**
 * The default review. Roughly forty images: enough to catch a renderer change
 * that damaged something, small enough that an agent can actually look at all
 * of them.
 */
export const VISUAL_REVIEW_CASES: ReviewCase[] = [
  // Terrain carries the readability hierarchy, so it gets the full diagnostic
  // sweep plus both extreme cell sizes.
  makeCase({ sceneId: "terrain", note: "Intended presentation: floor recedes, walls read as one solid mass." }),
  makeCase({ sceneId: "terrain", view: "grayscale", note: "Value check: floor, half cover, and wall stay separable without hue." }),
  makeCase({ sceneId: "terrain", view: "squint", note: "Silhouette check: wall structure survives when detail is destroyed." }),
  makeCase({ sceneId: "terrain", cell: 28, note: "Minimum gameplay size: blocked versus walkable still obvious." }),
  makeCase({ sceneId: "terrain", cell: 56, note: "Detail size: wall lip, occlusion edge, and cover volume inspected closely." }),

  makeCase({ sceneId: "units", note: "Archetype silhouettes, selection, spent, damaged, peek, and overwatch states." }),
  makeCase({ sceneId: "units", cell: 28, note: "Minimum size: archetypes must stay distinguishable on mobile." }),
  makeCase({ sceneId: "units", cell: 28, view: "grayscale", note: "Hardest readability case: small and colourless at once." }),
  makeCase({ sceneId: "units", cell: 56, note: "Artwork inspection: weapon, head, and team geometry at full detail." }),

  makeCase({ sceneId: "overlays", note: "Combat cue matrix: one cue, one meaning, nothing covering a face or weapon." }),
  makeCase({ sceneId: "overlays", cell: 28, note: "Minimum size: HP, AP, target, and threat must not collide." }),
  makeCase({ sceneId: "overlays", view: "grayscale", note: "Overlay priority without hue: gameplay cues outrank decoration." }),

  // Tactical statuses are the newest gameplay cues on the board, and the ones
  // most likely to collide with the HP chip, AP pips, and target pill that
  // already occupy a unit's cell. They get the full readability sweep.
  makeCase({ sceneId: "combat-states", note: "Status chips, Exposed markers, and watched ground beside the cues they share a cell with." }),
  makeCase({ sceneId: "combat-states", cell: 28, note: "Minimum size: every status must stay identifiable and must not bury HP or AP." }),
  makeCase({ sceneId: "combat-states", cell: 28, view: "grayscale", note: "Statuses must be separable by shape and letter with no hue at all." }),
  makeCase({ sceneId: "combat-states", cell: 56, note: "Chip and marker construction inspected closely." }),
  makeCase({
    sceneId: "combat-states",
    view: "squint",
    note: "Ground cues under squint: firing positions must not outrank units, targets, or the watched lane they overlap.",
  }),

  // Operator identity has to survive the same squint the archetypes do: if
  // three roles read as one silhouette with different badges, the pass failed.
  makeCase({ sceneId: "operator-roles", note: "Mark, relay, dash, guard tether, and brace on one board." }),
  makeCase({ sceneId: "operator-roles", cell: 28, note: "Minimum size: role cues must not bury HP, AP, or the hit-chance pill." }),
  makeCase({ sceneId: "operator-roles", view: "grayscale", note: "Roles must separate by shape and letter with no hue." }),

  // Intent is the densest new text on the board and the most likely to turn it
  // into a wall of labels, so it gets both extremes plus an animation strip for
  // the locked-on pulse.
  makeCase({ sceneId: "enemy-intent", note: "Four published plans at once: readable, and not covering their own units." }),
  makeCase({ sceneId: "enemy-intent", cell: 28, note: "Minimum size: banners must stay legible without hiding the board." }),
  makeCase({ sceneId: "enemy-intent", view: "squint", note: "The locked-on Marksman must win attention when detail is destroyed." }),
  makeCase({
    sceneId: "enemy-intent",
    times: [0, 450, 900],
    idPrefix: "enemy-intent-pulse",
    note: "Pulse strip: the lock should read as urgent without flickering distractingly.",
  }),

  makeCase({
    sceneId: "effects",
    times: [...EFFECT_STRIP_TIMES],
    note: "Animation strip: muzzle flash, projectile departure, travel, impact, miss, defeat, and movement interpolation.",
  }),
  makeCase({ sceneId: "effects", cell: 28, note: "Minimum size: shots still visibly leave their weapons." }),

  makeCase({ sceneId: "landmarks-foundry", dir: "landmarks", note: "Foundry families: furnace, vessels, gantry, conveyor, manifold, dock." }),
  makeCase({ sceneId: "landmarks-foundry", dir: "landmarks", view: "squint", note: "Foundry masses must stay identifiable as objects when detail is lost." }),
  makeCase({
    sceneId: "landmarks-foundry",
    dir: "landmarks",
    times: [...AMBIENT_STRIP_TIMES],
    idPrefix: "landmarks-foundry-ambient",
    note: "Ambient strip: only landmarks move, motion stays low frequency and local.",
  }),
  makeCase({ sceneId: "landmarks-data-core", dir: "landmarks", note: "Data Core families: vault, core, hub, racks, relays, checkpoint." }),
  makeCase({ sceneId: "landmarks-data-core", dir: "landmarks", view: "squint", note: "Data Core geometry must survive as precise compartments." }),
  makeCase({ sceneId: "landmarks-derelict", dir: "landmarks", note: "Derelict families: collapse, reactor wreck, scrap, salvage rig, breach." }),
  makeCase({ sceneId: "landmarks-derelict", dir: "landmarks", view: "squint", note: "Damage must still read as damage rather than tidy geometry." }),

  // Generated boards are the real composition test. Every seed gets a normal
  // capture; the landmark-heavy ones additionally get the diagnostic sweep
  // because that is where hierarchy collapses first.
  ...generatedSceneCases(),
];

function generatedSceneCases(): ReviewCase[] {
  const cases: ReviewCase[] = [];
  for (const themeId of LEVEL_THEME_IDS) {
    for (const profile of ["landmark", "quiet"] as GenerationProfile[]) {
      const sceneId = generatedSceneId(themeId, profile);
      const heavy = profile === "landmark";
      cases.push(makeCase({
        sceneId,
        dir: "generated",
        note: heavy
          ? "Landmark-heavy encounter: one dominant feature must win the eye, supports add context not clutter."
          : "Quiet encounter: one anchor, calm ordinary floor, intentional negative space.",
      }));
      if (!heavy) continue;
      cases.push(makeCase({
        sceneId,
        dir: "generated",
        view: "grayscale",
        note: "Hierarchy without hue: the dominant mass must still dominate.",
      }));
      cases.push(makeCase({
        sceneId,
        dir: "generated",
        view: "squint",
        note: "Macro silhouette: the board should still be describable as two to four named places.",
      }));
      cases.push(makeCase({
        sceneId,
        dir: "generated",
        view: "semantic",
        note: "Generation versus decoration: flat categories plus dominant/major/secondary outlines.",
      }));
    }
  }
  cases.push(makeCase({
    sceneId: generatedSceneId("industrial", "landmark"),
    dir: "generated",
    cell: 28,
    note: "Full encounter at minimum size: composition must not turn into noise.",
  }));
  return cases;
}

/** The scene id the lab uses for a canonical generated board. */
export function generatedSceneId(themeId: LevelThemeId, profile: GenerationProfile): string {
  return `generated-${themeId.replace("_", "-")}-${profile}`;
}

/**
 * Deterministic seeds for the deeper procedural sample. The canonical showcase
 * seeds stay untouched; this exists so visual work cannot quietly overfit six
 * curated boards.
 */
export function sampleSeed(themeId: LevelThemeId, profile: GenerationProfile, index: number): string {
  return `SAMPLE-${themeId.toUpperCase().replace("_", "-")}-${profile.toUpperCase()}-${index + 1}`;
}

export function buildSampleCases(seedsPerCombination: number): ReviewCase[] {
  const count = Math.max(1, Math.min(24, Math.round(seedsPerCombination)));
  const cases: ReviewCase[] = [];
  for (const themeId of LEVEL_THEME_IDS) {
    for (const profile of ["landmark", "quiet"] as GenerationProfile[]) {
      for (let index = 0; index < count; index++) {
        const seed = sampleSeed(themeId, profile, index);
        const family = safeSegment(`${themeId}-${profile}`);
        cases.push(makeCase({
          sceneId: SEED_SCENE_ID,
          dir: `sample-${family}`,
          idPrefix: `sample-${family}-${index + 1}`,
          note: `Uncurated ${themeId} ${profile} seed ${seed}: hierarchy, restraint, and theme shape language must survive outside the showcase seeds.`,
          inspection: { themeId, profile, seed },
        }));
      }
    }
  }
  return cases;
}

/** Every distinct lab scene the given cases require. */
export function requiredSceneIds(cases: readonly ReviewCase[]): string[] {
  return [...new Set(cases.map((entry) => entry.sceneId))].filter((id) => id !== SEED_SCENE_ID);
}

/**
 * Split cases into the ones an older build can render and the scenes it has
 * never heard of.
 *
 * A branch that adds a lab scene asks the baseline commit to render something
 * that did not exist there, which the lab treats as a hard error. Rendering a
 * "before" image for a brand-new scene is meaningless anyway, so those cases
 * are set aside and reported instead of crashing the run - the review is
 * supposed to inform a judgement, not gate a merge on one.
 */
export function partitionByKnownScenes(
  cases: readonly ReviewCase[],
  knownSceneIds: readonly string[],
): { renderable: ReviewCase[]; newSceneIds: string[] } {
  const known = new Set(knownSceneIds);
  const renderable: ReviewCase[] = [];
  const newSceneIds: string[] = [];
  for (const entry of cases) {
    if (known.has(entry.sceneId)) {
      renderable.push(entry);
    } else if (!newSceneIds.includes(entry.sceneId)) {
      newSceneIds.push(entry.sceneId);
    }
  }
  return { renderable, newSceneIds };
}

/** Expand one case into the concrete capture requests it produces. */
export function captureRequests(entry: ReviewCase): { params: CaptureParams; fileName: string; timeMs: number }[] {
  const strip = entry.times.length > 1;
  return entry.times.map((timeMs) => {
    const params: CaptureParams = {
      ...DEFAULT_CAPTURE_PARAMS,
      capture: true,
      sceneId: entry.sceneId,
      cell: entry.cell,
      view: entry.view,
      timeMs,
      overlays: entry.overlays,
      ambient: entry.ambient,
      inspection: entry.inspection ?? DEFAULT_CAPTURE_PARAMS.inspection,
    };
    const fileName = strip
      ? `${entry.id.replace(/-strip$/, "")}-t${String(timeMs).padStart(4, "0")}.png`
      : `${entry.id}.png`;
    return { params, fileName, timeMs };
  });
}

/** File name of the composed strip for an animated case. */
export function stripFileName(entry: ReviewCase): string | null {
  return entry.times.length > 1 ? `${entry.id}.png` : null;
}

/** Human-readable capture slug, used in labels and log lines. */
export function caseSlug(entry: ReviewCase, timeMs: number): string {
  return captureSlug({ ...DEFAULT_CAPTURE_PARAMS, cell: entry.cell, view: entry.view, timeMs });
}
