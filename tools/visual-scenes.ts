import {
  makeArchetypeUnit,
  type UnitArchetypeId,
} from "../src/content.ts";
import { generateEncounter } from "../src/generation.ts";
import { setTile, type GameMap } from "../src/map.ts";
import { previewShot } from "../src/combat.ts";
import {
  projectileKindForUnit,
  type RenderState,
  type ShotEffect,
} from "../src/render.ts";
import { SeededRng } from "../src/rng.ts";

export type VisualScene = {
  id: string;
  title: string;
  description: string;
  review: string;
  state: RenderState;
};

function emptyMap(width: number, height: number): GameMap {
  return {
    width,
    height,
    tiles: new Array(width * height).fill("floor"),
    units: [],
  };
}

function emptyState(map: GameMap): RenderState {
  return {
    map,
    selected: null,
    highlights: [],
    enemyPreviews: [],
    floatingTexts: [],
    coverIndicators: [],
    threatMarkers: [],
    sightLines: [],
    shotEffects: [],
    movementEffects: [],
  };
}

function terrainScene(): VisualScene {
  const map = emptyMap(15, 9);

  // A connected wall structure deliberately includes masses, corners, narrow
  // spines, and isolated tiles. These are the cases most likely to collapse
  // into "decorated floor" when wall value or edge treatment is too weak.
  for (let y = 2; y <= 4; y++) {
    for (let x = 1; x <= 5; x++) setTile(map, x, y, "wall");
  }
  for (let x = 7; x <= 13; x++) setTile(map, x, 2, "wall");
  for (let y = 2; y <= 4; y++) setTile(map, 9, y, "wall");
  setTile(map, 12, 4, "wall");

  for (let x = 1; x <= 13; x++) setTile(map, x, 6, "half_cover");
  for (let x = 2; x <= 12; x += 2) setTile(map, x, 7, "half_cover");

  return {
    id: "terrain",
    title: "Terrain contact sheet",
    description: "Real floor, wall, and half-cover variants arranged to expose value and silhouette problems.",
    review: "Walls should form one obvious solid structure; floor details should disappear first in Squint mode.",
    state: emptyState(map),
  };
}

function unitScene(): VisualScene {
  const map = emptyMap(15, 3);
  const archetypes: UnitArchetypeId[] = [
    "operator",
    "runner",
    "bulwark",
    "scrapper",
    "rifleman",
    "marksman",
    "sentinel",
  ];
  archetypes.forEach((archetypeId, index) => {
    const unit = makeArchetypeUnit(archetypeId, `lab-${archetypeId}`, 1 + index * 2, 1);
    if (archetypeId === "runner") unit.ap = 0;
    if (archetypeId === "bulwark") unit.hp = Math.ceil(unit.maxHp * 0.45);
    if (archetypeId === "marksman") unit.peekExposure = { x: unit.x, y: unit.y - 1 };
    if (archetypeId === "sentinel") unit.overwatch = true;
    map.units.push(unit);
  });
  const state = emptyState(map);
  state.selected = map.units[0];

  return {
    id: "units",
    title: "Archetype lineup",
    description: "Every production silhouette with selected, spent, damaged, peeking, and overwatch states represented.",
    review: "Each role should remain distinguishable in grayscale and at 28 px without relying on its two-letter badge.",
    state,
  };
}

function overlayScene(): VisualScene {
  const map = emptyMap(12, 7);
  for (let x = 0; x < map.width; x++) {
    setTile(map, x, 0, "wall");
    setTile(map, x, map.height - 1, "wall");
  }
  for (let y = 0; y < map.height; y++) {
    setTile(map, 0, y, "wall");
    setTile(map, map.width - 1, y, "wall");
  }
  setTile(map, 1, 2, "wall");
  setTile(map, 7, 2, "half_cover");
  setTile(map, 9, 3, "half_cover");
  setTile(map, 4, 5, "half_cover");

  const rook = makeArchetypeUnit("operator", "lab-rook", 1, 3);
  const vex = makeArchetypeUnit("runner", "lab-vex", 2, 5);
  const clear = makeArchetypeUnit("scrapper", "lab-clear", 5, 2);
  const covered = makeArchetypeUnit("rifleman", "lab-covered", 7, 3);
  const difficult = makeArchetypeUnit("marksman", "lab-difficult", 9, 4);
  const watcher = makeArchetypeUnit("sentinel", "lab-watcher", 9, 1);
  watcher.overwatch = true;
  covered.hp = 4;
  map.units.push(rook, vex, clear, covered, difficult, watcher);

  return {
    id: "overlays",
    title: "Combat-overlay matrix",
    description: "Canonical move, target, cover, threat, firing-line, HP, AP, selection, and overwatch cues.",
    review: "No marker should cover a face or weapon; every cue should retain exactly one meaning.",
    state: {
      map,
      selected: rook,
      highlights: [
        { x: 1, y: 4, fill: "rgba(80, 200, 120, 0.55)", border: "rgba(80, 200, 120, 1)", kind: "move" },
        { x: 2, y: 3, fill: "rgba(80, 200, 120, 0.55)", border: "rgba(80, 200, 120, 1)", kind: "move" },
        { x: clear.x, y: clear.y, fill: "rgba(255, 80, 80, 0.55)", border: "rgba(255, 80, 80, 1)", kind: "target" },
        { x: covered.x, y: covered.y, fill: "rgba(255, 80, 80, 0.55)", border: "rgba(255, 80, 80, 1)", kind: "target" },
        { x: difficult.x, y: difficult.y, fill: "rgba(255, 80, 80, 0.55)", border: "rgba(255, 80, 80, 1)", kind: "target" },
      ],
      enemyPreviews: [
        { x: clear.x, y: clear.y, hitPct: 82, hasCover: false },
        { x: covered.x, y: covered.y, hitPct: 58, hasCover: true },
        { x: difficult.x, y: difficult.y, hitPct: 31, hasCover: true },
      ],
      floatingTexts: [{ text: "HIT 3", x: clear.x, y: clear.y, color: "#ffd83a", expiresAt: Number.POSITIVE_INFINITY }],
      coverIndicators: [
        { x: rook.x, y: rook.y, side: "n", kind: "wall" },
        { x: covered.x, y: covered.y, side: "n", kind: "half_cover" },
      ],
      threatMarkers: [
        { x: difficult.x, y: difficult.y },
        { x: watcher.x, y: watcher.y },
      ],
      sightLines: [
        {
          fromX: 2,
          fromY: 2,
          toX: clear.x,
          toY: clear.y,
          hasCover: false,
          shooterX: rook.x,
          shooterY: rook.y,
          mode: "peek",
        },
        {
          fromX: rook.x,
          fromY: rook.y,
          toX: covered.x,
          toY: covered.y,
          hasCover: true,
          shooterX: rook.x,
          shooterY: rook.y,
          mode: "direct",
        },
        {
          fromX: rook.x,
          fromY: rook.y,
          toX: difficult.x,
          toY: difficult.y,
          hasCover: true,
          shooterX: rook.x,
          shooterY: rook.y,
          mode: "direct",
        },
      ],
      shotEffects: [],
    },
  };
}

function effectsScene(): VisualScene {
  const map = emptyMap(15, 13);
  const archetypes: UnitArchetypeId[] = ["runner", "operator", "scrapper", "marksman", "sentinel"];
  const shotEffects: ShotEffect[] = [];
  const staticPhases = [0.12, 0.36, 0.58, 0.80, 0.88];

  archetypes.forEach((archetypeId, index) => {
    const y = 1 + index * 2;
    const shooter = makeArchetypeUnit(archetypeId, `effects-${archetypeId}`, 1, y);
    const target = makeArchetypeUnit("rifleman", `effects-target-${index}`, 12, index === 1 ? y + 1 : y);
    target.hp = Math.max(1, target.maxHp - index);
    map.units.push(shooter, target);
    if (index === 1) {
      setTile(map, 2, y, "wall");
      setTile(map, 2, y - 1, "wall");
    }
    const preview = previewShot(map, shooter, target);
    if (!preview.shot.canShoot || preview.shot.mode === "blocked") {
      throw new Error(`Visual effects shot ${index} is not legal production geometry`);
    }
    if (preview.shot.mode === "peek") shooter.peekExposure = { ...preview.shot.from };
    if (index === 4) target.hp = 0;
    const durationMs = 1200;
    shotEffects.push({
      id: `effects-shot-${index}`,
      shooterId: shooter.id,
      targetId: target.id,
      shooterTeam: shooter.team,
      targetTeam: target.team,
      shooterX: shooter.x,
      shooterY: shooter.y,
      fromX: preview.shot.from.x,
      fromY: preview.shot.from.y,
      toX: preview.targetPoint.x,
      toY: preview.targetPoint.y,
      mode: preview.shot.mode,
      projectile: projectileKindForUnit(shooter),
      hit: index !== 3,
      startedAt: -durationMs * staticPhases[index],
      durationMs,
      loop: true,
    });
  });

  const state = emptyState(map);
  state.shotEffects = shotEffects;
  const mover = makeArchetypeUnit("runner", "effects-mover", 4, 11);
  map.units.push(mover);
  state.movementEffects = [{
    id: "effects-move",
    unitId: mover.id,
    fromX: 1,
    fromY: 11,
    toX: mover.x,
    toY: mover.y,
    startedAt: -600,
    durationMs: 1200,
    loop: true,
  }];
  return {
    id: "effects",
    title: "Weapon and impact sprites",
    description: "Every projectile family, muzzle flash, legal peek shot, impact, defeat fade, and tile movement in a repeatable scene.",
    review: "Shots should leave their weapons, impacts and movement should read clearly, and cover leans must remain visible at 28 px.",
    state,
  };
}

function generatedScene(): VisualScene {
  const map = generateEncounter(
    new SeededRng("VISUAL-LAB-CANONICAL"),
    4,
    "elite",
    [
      { id: "lab-rook", name: "Rook", archetypeId: "operator", hp: 9, maxHp: 9, baseMaxAp: 4 },
      { id: "lab-vex", name: "Vex", archetypeId: "runner", hp: 5, maxHp: 7, baseMaxAp: 5 },
      { id: "lab-hex", name: "Hex", archetypeId: "bulwark", hp: 11, maxHp: 11, baseMaxAp: 3 },
    ],
    ["smartlink", "ghost_step"],
  );
  const state = emptyState(map);
  state.selected = map.units.find((unit) => unit.team === "player") ?? null;

  return {
    id: "encounter",
    title: "Canonical generated encounter",
    description: "A stable seeded elite map that catches interactions hidden by isolated contact sheets.",
    review: "Terrain hierarchy should survive a realistic composition without units or HUD markers disappearing into it.",
    state,
  };
}

export function buildVisualScenes(): VisualScene[] {
  return [terrainScene(), unitScene(), overlayScene(), effectsScene(), generatedScene()];
}
