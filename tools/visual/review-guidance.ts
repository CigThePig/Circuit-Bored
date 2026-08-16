/**
 * What the reviewing agent should actually look for.
 *
 * The screenshots are only half of the feedback loop; without the questions
 * from `docs/ART_DIRECTION.md` sitting next to them, an agent tends to report
 * "the image renders" instead of "half cover reads as floor decoration here".
 */
import type { ViewMode } from "./capture-params.ts";

export type GuidanceGroup = { heading: string; questions: string[] };

const TERRAIN: GuidanceGroup = {
  heading: "Terrain",
  questions: [
    "Does floor visually recede rather than compete for attention?",
    "Do walls read as solid impassable mass before their decoration is read?",
    "Does half cover read between floor and wall in occupied volume?",
    "Do connected walls read as one structure rather than decorated squares?",
  ],
};

const UNITS: GuidanceGroup = {
  heading: "Units",
  questions: [
    "Can archetypes still be told apart at 28 px?",
    "Do silhouettes stay readable without relying on colour or the badge?",
    "Does combat UI obscure faces, weapons, HP, or AP?",
  ],
};

const COMBAT: GuidanceGroup = {
  heading: "Combat",
  questions: [
    "Can a peek shot clearly be understood as a lean-and-fire?",
    "Does the projectile originate from the exposed shooting position?",
    "Are hits and misses visually distinct?",
    "Is movement interpolation visible as travel rather than teleporting?",
    "Are HP, AP, target, and threat indicators fighting each other?",
  ],
};

const ENVIRONMENT: GuidanceGroup = {
  heading: "Environment",
  questions: [
    "Can the environment family be identified without reading its label?",
    "Does exactly one dominant feature win the eye?",
    "Do supporting features stay secondary to the anchor?",
    "Does quiet floor remain quiet, with at least half the usable floor untreated?",
    "Does heavy mean richer context rather than more clutter?",
    "Are Foundry, Data Core, and Derelict separable by shape before colour?",
  ],
};

const AMBIENT: GuidanceGroup = {
  heading: "Ambient motion",
  questions: [
    "Does motion belong to landmarks only, with ordinary floor and walls still?",
    "Is the motion low frequency and localized rather than a flickering board?",
    "Does any ambient cue accidentally look like gameplay state?",
  ],
};

const DIAGNOSTIC: Record<Exclude<ViewMode, "normal">, GuidanceGroup> = {
  grayscale: {
    heading: "Grayscale acceptance",
    questions: [
      "Does the readability hierarchy survive with hue removed?",
      "Does any category disappear, meaning it depended on colour alone?",
    ],
  },
  contrast: {
    heading: "Value contrast acceptance",
    questions: [
      "Do the value bands separate floor, cover, wall, and units cleanly?",
      "Does anything collapse into a single flat value?",
    ],
  },
  squint: {
    heading: "Squint acceptance",
    questions: [
      "Do the major silhouettes stay distinct when detail is destroyed?",
      "Is the board still describable as two to four named places?",
    ],
  },
  semantic: {
    heading: "Semantic acceptance",
    questions: [
      "Is a problem visible here a generation/layout problem rather than a decorative-art one?",
      "Do the dominant (orange), major (yellow), and secondary (dashed) outlines match what the normal view suggests?",
    ],
  },
};

/**
 * Guidance for a scene, chosen from its id and the diagnostic view in use.
 * Scene ids are stable (`tools/visual-scenes.ts`), so prefix matching is safe
 * and new scenes fall back to the universal hierarchy questions.
 */
export function guidanceForCase(sceneId: string, view: ViewMode, animated: boolean): GuidanceGroup[] {
  const groups: GuidanceGroup[] = [];
  if (sceneId === "terrain") groups.push(TERRAIN);
  else if (sceneId === "units") groups.push(UNITS);
  else if (sceneId === "overlays") groups.push(COMBAT, UNITS);
  else if (sceneId === "effects") groups.push(COMBAT);
  else if (sceneId.startsWith("landmarks-")) groups.push(ENVIRONMENT);
  else if (sceneId.startsWith("generated-") || sceneId === "seed-inspection") groups.push(ENVIRONMENT, TERRAIN);
  else groups.push(TERRAIN);
  if (animated) groups.push(AMBIENT);
  if (view !== "normal") groups.push(DIAGNOSTIC[view]);
  return groups;
}

/** The standing reminder printed at the top of every report. */
export const REVIEW_PREAMBLE = [
  "Passing renderer tests does not prove visual quality. Judge these images, not the code.",
  "Read the board in hierarchy order: walkable versus blocked, then teams and units, then immediate actions, then tactical context, then atmosphere.",
  "Lower levels must never obscure higher levels.",
  "A pixel difference is not automatically a regression. The diff exists to direct attention, not to decide taste.",
];
