/**
 * Scene metadata for the report.
 *
 * `VisualScene.review` already states what each scene is supposed to prove.
 * The report's job is to put that sentence next to the pixels, so the reviewing
 * agent is told what to look for rather than left to invent criteria.
 */
import { buildGeneratedThemeScene, buildVisualScenes } from "../visual-scenes.ts";
import { SEED_SCENE_ID, type InspectionParams } from "./capture-params.ts";

export type SceneInfo = {
  id: string;
  title: string;
  description: string;
  review: string;
  width: number;
  height: number;
};

let cache: Map<string, SceneInfo> | null = null;

function registry(): Map<string, SceneInfo> {
  if (cache) return cache;
  cache = new Map();
  for (const scene of buildVisualScenes()) {
    cache.set(scene.id, {
      id: scene.id,
      title: scene.title,
      description: scene.description,
      review: scene.review,
      width: scene.state.map.width,
      height: scene.state.map.height,
    });
  }
  return cache;
}

export function knownSceneIds(): string[] {
  return [...registry().keys()];
}

/** Metadata for a scene, generating on demand for sampled seeds. */
export function sceneInfo(sceneId: string, inspection?: InspectionParams): SceneInfo | null {
  if (sceneId === SEED_SCENE_ID) {
    if (!inspection) return null;
    const scene = buildGeneratedThemeScene(inspection.themeId, inspection.seed, inspection.profile);
    return {
      id: SEED_SCENE_ID,
      title: `Sampled seed · ${scene.title}`,
      description: scene.description,
      review: scene.review,
      width: scene.state.map.width,
      height: scene.state.map.height,
    };
  }
  return registry().get(sceneId) ?? null;
}
