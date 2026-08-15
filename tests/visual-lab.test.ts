import { describe, expect, it } from "vitest";
import { UNIT_ARCHETYPES } from "../src/content.ts";
import { previewShot } from "../src/combat.ts";
import { validateMap } from "../src/validation.ts";
import { dominantLandmark, LANDMARK_KINDS } from "../src/environment.ts";
import { generatedEncounterDiagnostics } from "../src/generation.ts";
import { pointsInRect } from "../src/generationMotifs.ts";
import { getTile } from "../src/map.ts";
import { landmarkArtKinds } from "../src/renderLandmarks.ts";
import { buildVisualScenes } from "../tools/visual-scenes.ts";

describe("visual laboratory", () => {
  it("keeps a stable scene for every high-risk visual category", () => {
    const scenes = buildVisualScenes();
    expect(scenes.map((scene) => scene.id)).toEqual([
      "terrain",
      "units",
      "overlays",
      "effects",
      "landmarks-foundry",
      "landmarks-data-core",
      "landmarks-derelict",
      "generated-industrial-landmark",
      "generated-industrial-quiet",
      "generated-data-core-landmark",
      "generated-data-core-quiet",
      "generated-derelict-landmark",
      "generated-derelict-quiet",
    ]);
    for (const scene of scenes) {
      expect(scene.state.map.tiles).toHaveLength(scene.state.map.width * scene.state.map.height);
      expect(scene.description.length).toBeGreaterThan(20);
      expect(scene.review.length).toBeGreaterThan(20);
    }
  });

  it("covers every projectile family plus peek, hit, and miss animation states", () => {
    const state = buildVisualScenes().find((scene) => scene.id === "effects")!.state;
    const effects = state.shotEffects!;
    expect(new Set(effects.map((effect) => effect.projectile)))
      .toEqual(new Set(["pulse", "tracer", "scatter", "rail", "heavy"]));
    expect(effects.some((effect) => effect.mode === "peek")).toBe(true);
    expect(effects.some((effect) => effect.hit)).toBe(true);
    expect(effects.some((effect) => !effect.hit)).toBe(true);
    expect(effects.every((effect) => effect.loop)).toBe(true);
    expect(effects.some((effect) => effect.hit && -effect.startedAt / effect.durationMs > 0.68)).toBe(true);
    expect(effects.some((effect) => !effect.hit && -effect.startedAt / effect.durationMs > 0.68)).toBe(true);

    for (const effect of effects) {
      const shooter = state.map.units.find((unit) => unit.id === effect.shooterId)!;
      const target = state.map.units.find((unit) => unit.id === effect.targetId)!;
      expect(target.team).not.toBe(shooter.team);
      expect({ x: effect.targetX, y: effect.targetY }).toEqual({ x: target.x, y: target.y });
      // The defeated silhouette is an artwork state; restore one hit point so
      // combat geometry can verify the canonical shot independently.
      const originalHp = target.hp;
      target.hp = Math.max(1, target.hp);
      const preview = previewShot(state.map, shooter, target);
      target.hp = originalHp;
      expect(preview.shot.canShoot).toBe(true);
      expect(preview.shot.mode).toBe(effect.mode);
      expect(preview.shot.from).toEqual({ x: effect.fromX, y: effect.fromY });
      expect(preview.shot.peekShoulder?.x).toBe(effect.peekShoulderX);
      expect(preview.shot.peekShoulder?.y).toBe(effect.peekShoulderY);
      expect(preview.targetPoint).toEqual({ x: effect.toX, y: effect.toY });
    }

    expect(state.movementEffects).toHaveLength(1);
    expect(state.movementEffects![0]).toMatchObject({ loop: true, fromX: 1, toX: 4 });
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

  it("uses deterministic valid generator output for every theme", () => {
    const first = buildVisualScenes().filter((scene) => scene.id.startsWith("generated-"));
    const second = buildVisualScenes().filter((scene) => scene.id.startsWith("generated-"));
    expect(first.map((scene) => scene.state.map)).toEqual(second.map((scene) => scene.state.map));
    expect(new Set(first.map((scene) => scene.state.map.themeId)))
      .toEqual(new Set(["industrial", "data_core", "derelict"]));
    for (const scene of first) {
      expect(scene.state.map).toMatchObject({ width: 24, height: 24 });
      expect(validateMap(scene.state.map).hasErrors).toBe(false);
      expect(scene.state.map.environment?.landmarks.length).toBeGreaterThanOrEqual(2);
    }
    const landmarkHeavy = first.filter((scene) => scene.id.endsWith("-landmark"));
    const quiet = first.filter((scene) => scene.id.endsWith("-quiet"));
    expect(landmarkHeavy.every((scene) => scene.state.map.environment!.landmarks.length === 4)).toBe(true);
    expect(quiet.every((scene) => scene.state.map.environment!.landmarks.length === 2)).toBe(true);
    expect(landmarkHeavy.every((scene) => scene.state.map.environment!.profile === "heavy")).toBe(true);
    expect(quiet.every((scene) => scene.state.map.environment!.profile === "quiet")).toBe(true);
    for (const scene of first) {
      // Every review board names its anchor so the lab can answer "what is
      // this place?" without reading the tile grid.
      const dominant = dominantLandmark(scene.state.map.environment);
      expect(dominant).not.toBeNull();
      expect(scene.description).toContain(dominant!.name);
    }
  });

  it("shows every bespoke landmark family on a real painted board", () => {
    const scenes = buildVisualScenes().filter((scene) => scene.id.startsWith("landmarks-"));
    expect(scenes).toHaveLength(3);
    const covered = new Set<string>();
    for (const scene of scenes) {
      const map = scene.state.map;
      expect(validateMap(map).hasErrors).toBe(false);
      const landmarks = map.environment!.landmarks;
      expect(landmarks).toHaveLength(6);
      for (const landmark of landmarks) {
        covered.add(landmark.kind);
        // Bespoke artwork is clipped to wall tiles, so a gallery entry with no
        // solid mass would silently render nothing.
        const solid = pointsInRect(landmark.rect)
          .filter(({ x, y }) => getTile(map, x, y) === "wall").length;
        expect(solid).toBeGreaterThan(0);
        expect(scene.description).toContain(landmark.name);
      }
    }
    // The galleries are the review surface for the art registry: every kind
    // the renderer can draw has to appear on one of them.
    expect(covered).toEqual(new Set(landmarkArtKinds()));
    expect(covered.size).toBe(LANDMARK_KINDS.length);
  });

  it("reports the identity metadata a landmark review needs", () => {
    const scene = buildVisualScenes().find((candidate) => candidate.id === "generated-industrial-landmark")!;
    const diagnostics = generatedEncounterDiagnostics(scene.state.map)!;
    expect(diagnostics.profile).toBe("heavy");
    expect(diagnostics.dominantLandmark).not.toBeNull();
    expect(diagnostics.dominantLandmark!.footprint).toBeGreaterThan(0);
    expect(diagnostics.landmarks.length).toBe(scene.state.map.environment!.landmarks.length);
    expect(diagnostics.landmarks.filter(({ importance }) => importance === "dominant")).toHaveLength(1);
    expect(diagnostics.zoneRoles.length).toBeGreaterThan(0);
    expect(diagnostics.metrics.dominantFootprintRatio).toBeGreaterThan(1);
  });
});
