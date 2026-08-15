import { describe, expect, it } from "vitest";
import { UNIT_ARCHETYPES } from "../src/content.ts";
import { validateMap } from "../src/validation.ts";
import { buildVisualScenes } from "../tools/visual-scenes.ts";

describe("visual laboratory", () => {
  it("keeps a stable scene for every high-risk visual category", () => {
    const scenes = buildVisualScenes();
    expect(scenes.map((scene) => scene.id)).toEqual(["terrain", "units", "overlays", "effects", "encounter"]);
    for (const scene of scenes) {
      expect(scene.state.map.tiles).toHaveLength(scene.state.map.width * scene.state.map.height);
      expect(scene.description.length).toBeGreaterThan(20);
      expect(scene.review.length).toBeGreaterThan(20);
    }
  });

  it("covers every projectile family plus peek, hit, and miss animation states", () => {
    const effects = buildVisualScenes().find((scene) => scene.id === "effects")!.state.shotEffects!;
    expect(new Set(effects.map((effect) => effect.projectile)))
      .toEqual(new Set(["pulse", "tracer", "scatter", "rail", "heavy"]));
    expect(effects.some((effect) => effect.mode === "peek")).toBe(true);
    expect(effects.some((effect) => effect.hit)).toBe(true);
    expect(effects.some((effect) => !effect.hit)).toBe(true);
    expect(effects.every((effect) => effect.loop)).toBe(true);
  });

  it("shows every archetype and representative combat-overlay states", () => {
    const scenes = buildVisualScenes();
    const lineup = scenes.find((scene) => scene.id === "units")!;
    expect(new Set(lineup.state.map.units.map((unit) => unit.archetypeId)))
      .toEqual(new Set(Object.keys(UNIT_ARCHETYPES)));

    const overlays = scenes.find((scene) => scene.id === "overlays")!.state;
    expect(overlays.enemyPreviews.map((preview) => preview.hitPct)).toEqual([82, 58, 31]);
    expect(overlays.sightLines).toHaveLength(3);
    expect(overlays.threatMarkers).toHaveLength(2);
    expect(overlays.coverIndicators).toHaveLength(2);
  });

  it("uses a deterministic valid generated encounter as the integration scene", () => {
    const first = buildVisualScenes().find((scene) => scene.id === "encounter")!.state.map;
    const second = buildVisualScenes().find((scene) => scene.id === "encounter")!.state.map;
    expect(first).toEqual(second);
    expect(validateMap(first).hasErrors).toBe(false);
  });
});
