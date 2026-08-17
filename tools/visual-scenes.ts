import {
  makeArchetypeUnit,
  type UnitArchetypeId,
} from "../src/content.ts";
import { generateEncounter } from "../src/generation.ts";
import {
  paintBreachedCorridor,
  paintCollapsedRoom,
  paintControlHub,
  paintCoolantTanks,
  paintCraneGantry,
  paintDataCore,
  paintFurnaceBlock,
  paintLoadingBay,
  paintPipeManifold,
  paintProcessingLine,
  paintReactorWreck,
  paintRelayBank,
  paintSalvageRig,
  paintScrapHeap,
  paintSecurityCheckpoint,
  paintServerRows,
  paintServerVault,
  paintWreckedMachinery,
  type LandmarkPlacement,
} from "../src/generationLandmarks.ts";
import { paintBoundary } from "../src/generationMotifs.ts";
import { dominantLandmark, environmentProfile, type MapRect } from "../src/environment.ts";
import { setTile, type GameMap } from "../src/map.ts";
import { computeMovementField, movementDestinations } from "../src/movement.ts";
import { applySuppression, previewShot, watchedTiles } from "../src/combat.ts";
import { performAction } from "../src/actions.ts";
import { beginUnitTurn } from "../src/rules.ts";
import { refreshEnemyIntents } from "../src/ai.ts";
import { intentLabel } from "../src/intent.ts";
import {
  projectileKindForUnit,
  type RenderState,
  type ShotEffect,
} from "../src/render.ts";
import { SeededRng } from "../src/rng.ts";
import { LEVEL_THEMES, type LevelThemeId } from "../src/themes.ts";

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

type GalleryEntry = {
  slot: MapRect;
  paint: (map: GameMap, rect: MapRect) => LandmarkPlacement;
};

/**
 * A themed landmark gallery. Every board here is painted by the production
 * landmark painters and rendered by the production renderer, so the lab can
 * answer "does this actually look like a furnace?" without playing a run.
 */
function landmarkGalleryScene(
  id: string,
  themeId: LevelThemeId,
  entries: readonly GalleryEntry[],
  lanes: readonly { x: number; y: number }[],
  review: string,
): VisualScene {
  const map = emptyMap(32, 22);
  map.themeId = themeId;
  paintBoundary(map);
  const landmarks = [];
  const floorZones = [];
  for (const entry of entries) {
    const placement = entry.paint(map, entry.slot);
    landmarks.push(placement.landmark);
    floorZones.push(...placement.floorZones);
  }
  map.environment = { landmarks, floorZones, featureBudget: { major: 2, secondary: 2, minor: 2 }, profile: "heavy" };
  // Two units give the gallery a scale reference and keep the board a legal
  // map, so the same validation that guards encounters guards the lab too.
  for (const lane of lanes) {
    for (const offset of [-1, 0, 1]) {
      setTile(map, lane.x + offset, lane.y, "floor");
      setTile(map, lane.x, lane.y + offset, "floor");
    }
  }
  map.units.push(
    makeArchetypeUnit("operator", `${id}-player`, lanes[0].x, lanes[0].y),
    makeArchetypeUnit("rifleman", `${id}-enemy`, lanes[1].x, lanes[1].y),
  );
  return {
    id,
    title: `${LEVEL_THEMES[themeId].shortName} · landmark gallery`,
    description: `Every ${LEVEL_THEMES[themeId].shortName} landmark family drawn by the production renderer: ` +
      `${landmarks.map(({ name }) => name).join(", ")}.`,
    review,
    state: emptyState(map),
  };
}

// Gallery slots are sized like the footprints the generator actually hands
// each family, so a conveyor gets a long run and a vault gets a chamber.
function foundryGalleryScene(): VisualScene {
  return landmarkGalleryScene("landmarks-foundry", "industrial", [
    { slot: { x: 2, y: 2, width: 9, height: 9 }, paint: (map, rect) => paintFurnaceBlock(map, rect, { orientation: "s", variant: 0 }) },
    { slot: { x: 12, y: 2, width: 8, height: 9 }, paint: (map, rect) => paintCoolantTanks(map, rect, { id: "gallery-coolant", orientation: "s", variant: 1 }) },
    { slot: { x: 21, y: 2, width: 9, height: 9 }, paint: (map, rect) => paintCraneGantry(map, rect, { id: "gallery-crane", variant: 0 }) },
    { slot: { x: 2, y: 13, width: 18, height: 3 }, paint: (map, rect) => paintProcessingLine(map, rect, { id: "gallery-line", variant: 0 }) },
    { slot: { x: 21, y: 13, width: 9, height: 4 }, paint: (map, rect) => paintPipeManifold(map, rect, { id: "gallery-manifold", variant: 1 }) },
    { slot: { x: 2, y: 18, width: 12, height: 3 }, paint: (map, rect) => paintLoadingBay(map, rect, { id: "gallery-bay", orientation: "s", variant: 2 }) },
  ], [{ x: 15, y: 19 }, { x: 25, y: 19 }],
  "Each mass should read as a specific machine: furnace mouth, pressure vessels, gantry, conveyor, manifold, dock.");
}

function dataCoreGalleryScene(): VisualScene {
  return landmarkGalleryScene("landmarks-data-core", "data_core", [
    { slot: { x: 2, y: 2, width: 10, height: 10 }, paint: (map, rect) => paintServerVault(map, rect, { orientation: "s", variant: 0 }) },
    { slot: { x: 13, y: 2, width: 9, height: 10 }, paint: (map, rect) => paintDataCore(map, rect, { id: "gallery-core", variant: 1 }) },
    { slot: { x: 23, y: 2, width: 7, height: 6 }, paint: (map, rect) => paintControlHub(map, rect, { id: "gallery-hub", orientation: "s", variant: 2 }) },
    { slot: { x: 2, y: 14, width: 5, height: 7 }, paint: (map, rect) => paintServerRows(map, rect, { id: "gallery-rows", variant: 1 }) },
    { slot: { x: 8, y: 14, width: 8, height: 5 }, paint: (map, rect) => paintRelayBank(map, rect, { id: "gallery-relay", variant: 0 }) },
    { slot: { x: 17, y: 14, width: 13, height: 3 }, paint: (map, rect) => paintSecurityCheckpoint(map, rect, { id: "gallery-checkpoint", variant: 0 }) },
  ], [{ x: 25, y: 11 }, { x: 25, y: 20 }],
  "Vault door, core pillar, console horseshoe, rack rhythm, cable trays, and gate posts should each be identifiable.");
}

function derelictGalleryScene(): VisualScene {
  return landmarkGalleryScene("landmarks-derelict", "derelict", [
    { slot: { x: 2, y: 2, width: 10, height: 10 }, paint: (map, rect) => paintCollapsedRoom(map, rect, { variant: 0 }) },
    { slot: { x: 13, y: 2, width: 9, height: 10 }, paint: (map, rect) => paintReactorWreck(map, rect, { id: "gallery-reactor", variant: 2 }) },
    { slot: { x: 23, y: 2, width: 7, height: 8 }, paint: (map, rect) => paintScrapHeap(map, rect, { id: "gallery-scrap", variant: 1 }) },
    { slot: { x: 2, y: 14, width: 9, height: 7 }, paint: (map, rect) => paintWreckedMachinery(map, rect, { id: "gallery-wreck", variant: 1 }) },
    { slot: { x: 12, y: 14, width: 8, height: 7 }, paint: (map, rect) => paintSalvageRig(map, rect, { id: "gallery-rig", variant: 3 }) },
    { slot: { x: 21, y: 14, width: 9, height: 6 }, paint: (map, rect) => paintBreachedCorridor(map, rect, { id: "gallery-breach", variant: 0 }) },
  ], [{ x: 26, y: 12 }, { x: 17, y: 12 }],
  "Collapse, failed reactor, scrap mound, torn machine, improvised rig, and blast breach should all read as damage, not as tidy geometry.");
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
    intentMarkers: [],
    guardLinks: [],
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
    description: "Canonical movement radius, target, cover, threat, firing-line, HP, AP, selection, and overwatch cues.",
    review: "The movement radius should read as walkable ground with a legible outer edge and AP bands, without burying units, cover, or targets; no marker should cover a face or weapon, and every cue should retain exactly one meaning.",
    state: {
      map,
      selected: rook,
      moveRange: {
        originX: rook.x,
        originY: rook.y,
        // Built from the production movement rules so the review looks at the
        // radius the game actually offers, not a hand-drawn approximation.
        tiles: movementDestinations(rook, computeMovementField(map, rook)),
      },
      highlights: [
        { x: clear.x, y: clear.y, fill: "rgba(255, 80, 80, 0.55)", border: "rgba(255, 80, 80, 1)" },
        { x: covered.x, y: covered.y, fill: "rgba(255, 80, 80, 0.55)", border: "rgba(255, 80, 80, 1)" },
        { x: difficult.x, y: difficult.y, fill: "rgba(255, 80, 80, 0.55)", border: "rgba(255, 80, 80, 1)" },
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
          peekShoulderX: 2,
          peekShoulderY: 3,
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

/**
 * Every tactical status the combat rules can put on a unit, plus the two
 * positional cues that belong to a target rather than to a unit.
 *
 * The statuses are set through the production rule layer rather than written
 * onto the units by hand, and the Exposed markers come from `previewShot`, so
 * this board cannot drift away from what the game actually computes. Nothing
 * here is a hand-authored overlay pretending to be gameplay truth.
 */
function combatStatesScene(): VisualScene {
  const map = emptyMap(15, 9);
  for (let x = 0; x < map.width; x++) {
    setTile(map, x, 0, "wall");
    setTile(map, x, map.height - 1, "wall");
  }
  for (let y = 0; y < map.height; y++) {
    setTile(map, 0, y, "wall");
    setTile(map, map.width - 1, y, "wall");
  }

  // Row 2: the four self-applied states, side by side at the same scale.
  setTile(map, 2, 1, "half_cover");
  setTile(map, 5, 1, "half_cover");
  const aimed = makeArchetypeUnit("operator", "states-aimed", 2, 2);
  const hunkered = makeArchetypeUnit("bulwark", "states-hunkered", 5, 2);
  const watching = makeArchetypeUnit("runner", "states-watching", 8, 2);
  const pinned = makeArchetypeUnit("rifleman", "states-pinned", 11, 2);
  map.units.push(aimed, hunkered, watching, pinned);
  performAction(map, aimed, "aim");
  performAction(map, hunkered, "hunker");
  performAction(map, watching, "overwatch");
  applySuppression(pinned);
  // Start the pinned unit's turn so the board shows what a suppressed unit
  // actually looks like when it acts: one fewer action point in its pips.
  beginUnitTurn(pinned);

  // A short spine so the hostile watch below covers only part of the movement
  // radius. Without it the watcher sees every reachable tile and the review
  // cannot judge watched ground against unwatched ground.
  for (let y = 3; y <= 5; y++) setTile(map, 7, y, "wall");

  // Row 6: one hostile flanked by geometry and one caught in a crossfire, so
  // the Exposed marker can be judged against a target that is merely covered.
  setTile(map, 5, 5, "half_cover");
  const flanked = makeArchetypeUnit("marksman", "states-flanked", 5, 6);
  const crossfired = makeArchetypeUnit("sentinel", "states-crossfire", 10, 6);
  const shooter = makeArchetypeUnit("operator", "states-shooter", 5, 7);
  const partner = makeArchetypeUnit("runner", "states-partner", 12, 6);
  const anchor = makeArchetypeUnit("bulwark", "states-anchor", 8, 6);
  map.units.push(flanked, crossfired, shooter, partner, anchor);
  // A hostile also holds a watch, so the watched-lane cue has something real
  // to sit on inside the selected operator's movement radius.
  performAction(map, crossfired, "overwatch");

  const state = emptyState(map);
  state.selected = shooter;
  const field = computeMovementField(map, shooter);
  state.moveRange = {
    originX: shooter.x,
    originY: shooter.y,
    tiles: movementDestinations(shooter, field),
  };
  state.watchedTiles = watchedTiles(
    map,
    crossfired,
    shooter,
    state.moveRange.tiles,
  );

  for (const target of [flanked, crossfired]) {
    const preview = previewShot(map, shooter, target);
    if (!preview.shot.canShoot) {
      throw new Error(`Combat-state target ${target.id} has no production firing line`);
    }
    state.highlights.push({
      x: target.x,
      y: target.y,
      fill: "rgba(255, 80, 80, 0.55)",
      border: "rgba(255, 80, 80, 1)",
    });
    state.enemyPreviews.push({
      x: target.x,
      y: target.y,
      hitPct: Math.round(preview.hitChance * 100),
      hasCover: preview.hadCover,
      exposed: preview.exposed !== null,
      damage: preview.damage,
    });
    state.sightLines!.push({
      fromX: preview.shot.from.x,
      fromY: preview.shot.from.y,
      toX: preview.targetPoint.x,
      toY: preview.targetPoint.y,
      hasCover: preview.hadCover,
      shooterX: shooter.x,
      shooterY: shooter.y,
      mode: preview.shot.mode === "peek" ? "peek" : "direct",
    });
  }

  return {
    id: "combat-states",
    title: "Tactical state matrix",
    description:
      "Aimed, hunkered, overwatching, and suppressed units beside a flanked target, " +
      "a crossfired target, and the enemy-watched tiles inside a movement radius.",
    review:
      "Each status chip should be identifiable at 28 px and in grayscale without reading its colour, " +
      "the Exposed arrows should read as 'caught between angles' rather than as another badge, " +
      "watched ground should stay legible as walkable, and no cue may cover a face, weapon, HP, or AP.",
    state,
  };
}

/**
 * The three operators doing their distinct jobs at once.
 *
 * Every state is applied through the production action registry, so the board
 * shows what Mark, Relay, Dash, Guard, and Brace actually do rather than an
 * approximation of them. The review question is whether a glance tells you
 * which operator is which kind of tool.
 */
function operatorRolesScene(): VisualScene {
  const map = emptyMap(16, 9);
  for (let x = 0; x < map.width; x++) {
    setTile(map, x, 0, "wall");
    setTile(map, x, map.height - 1, "wall");
  }
  for (let y = 0; y < map.height; y++) {
    setTile(map, 0, y, "wall");
    setTile(map, map.width - 1, y, "wall");
  }
  setTile(map, 4, 5, "half_cover");
  setTile(map, 10, 3, "half_cover");

  const rook = makeArchetypeUnit("operator", "roles-rook", 3, 4);
  // Within Hex's guard reach, which is what makes the tether legal.
  const vex = makeArchetypeUnit("runner", "roles-vex", 6, 6);
  const hex = makeArchetypeUnit("bulwark", "roles-hex", 4, 6);
  const marked = makeArchetypeUnit("rifleman", "roles-marked", 10, 4);
  const other = makeArchetypeUnit("scrapper", "roles-scrapper", 12, 6);
  map.units.push(rook, vex, hex, marked, other);

  // Rook coordinates: it calls a target and hands a point to Vex.
  performAction(map, rook, "mark", marked);
  performAction(map, rook, "relay", vex);
  // Vex commits to a sprint; Hex anchors and shields the operator beside it.
  performAction(map, vex, "dash");
  performAction(map, hex, "guard", vex);
  performAction(map, hex, "brace");

  const state = emptyState(map);
  state.selected = rook;
  state.guardLinks = [{ fromX: hex.x, fromY: hex.y, toX: vex.x, toY: vex.y }];

  // The mark is a coordination tool, so the scene previews the shot it buys
  // for a squadmate rather than for Rook.
  const preview = previewShot(map, vex, marked);
  if (!preview.shot.canShoot) {
    throw new Error("Operator-roles scene has no production firing line for the marked target");
  }
  state.highlights.push({
    x: marked.x,
    y: marked.y,
    fill: "rgba(255, 80, 80, 0.55)",
    border: "rgba(255, 80, 80, 1)",
  });
  state.enemyPreviews.push({
    x: marked.x,
    y: marked.y,
    hitPct: Math.round(preview.hitChance * 100),
    hasCover: preview.hadCover,
    exposed: preview.exposed !== null,
    damage: preview.damage,
  });

  return {
    id: "operator-roles",
    title: "Operator role matrix",
    description:
      "Rook's mark and relay, Vex mid-dash, and Hex braced with a guard link to Vex, " +
      "all applied through the production action registry.",
    review:
      "Each operator should read as a different kind of tool at a glance. The guard tether must " +
      "connect two units without covering either, the mark chip must be legible on the hostile " +
      "beside its hit-chance pill, and no role cue may outrank HP or AP.",
    state,
  };
}

/**
 * Enemy intent: every archetype publishing what it means to do next.
 *
 * The banners come from the AI's own planner through `planEnemyIntent`, so the
 * lab cannot show a plan the game would not. If the planner changes its mind
 * about these boards, this scene changes with it.
 */
function enemyIntentScene(): VisualScene {
  const map = emptyMap(20, 11);
  for (let x = 0; x < map.width; x++) {
    setTile(map, x, 0, "wall");
    setTile(map, x, map.height - 1, "wall");
  }
  for (let y = 0; y < map.height; y++) {
    setTile(map, 0, y, "wall");
    setTile(map, map.width - 1, y, "wall");
  }
  // A spine with a gap on row 5: it gives the Sentinel a lane worth holding
  // and the Scrapper ground it has to cross, while leaving the Marksman the
  // long open line its lock depends on.
  for (const y of [2, 3, 4, 6, 7, 8]) setTile(map, 9, y, "wall");
  setTile(map, 5, 8, "half_cover");
  setTile(map, 15, 2, "half_cover");

  const vex = makeArchetypeUnit("runner", "intent-vex", 3, 5);
  const rook = makeArchetypeUnit("operator", "intent-rook", 4, 8);
  const marksman = makeArchetypeUnit("marksman", "intent-marksman", 16, 5);
  const sentinel = makeArchetypeUnit("sentinel", "intent-sentinel", 11, 2);
  const scrapper = makeArchetypeUnit("scrapper", "intent-scrapper", 12, 9);
  const rifleman = makeArchetypeUnit("rifleman", "intent-rifleman", 15, 8);
  map.units.push(vex, rook, marksman, sentinel, scrapper, rifleman);

  // The Marksman has already settled on a target: that is the telegraph the
  // player is meant to answer.
  performAction(map, marksman, "aim");

  refreshEnemyIntents(map);
  // The lock is the plan this scene exists to review, so the board must
  // actually be one the planner locks on from. Everything else is whatever the
  // planner honestly decided.
  if (marksman.intent?.kind !== "aim") {
    throw new Error("Enemy-intent scene expected the marksman to hold its lock");
  }

  const state = emptyState(map);
  state.selected = vex;
  for (const enemy of [marksman, sentinel, scrapper, rifleman]) {
    const label = intentLabel(
      enemy.intent,
      map.units.find((u) => u.id === enemy.intent?.targetId)?.displayName ?? null,
    );
    if (!label) continue;
    const focus = map.units.find((u) => u.id === enemy.intent?.targetId);
    state.intentMarkers!.push({
      x: enemy.x,
      y: enemy.y,
      label,
      urgent: enemy.intent?.kind === "aim",
      toX: focus?.x,
      toY: focus?.y,
    });
  }

  return {
    id: "enemy-intent",
    title: "Enemy intent overlays",
    description:
      "Four hostiles publishing four different plans - a locked-on Marksman, a Scrapper " +
      "already engaging, and two units manoeuvring - every banner generated by the " +
      "production AI planner rather than written for the lab.",
    review:
      "Intent must be readable without hiding the unit it belongs to. The locked-on Marksman " +
      "should be the one plan that draws the eye, its thread should be traceable to its target, " +
      "and four simultaneous banners must not turn the board into a wall of text.",
    state,
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
    const targetArchetype: UnitArchetypeId = shooter.team === "player" ? "rifleman" : "operator";
    const target = makeArchetypeUnit(targetArchetype, `effects-target-${index}`, 12, index === 1 ? y + 1 : y);
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
      targetX: target.x,
      targetY: target.y,
      fromX: preview.shot.from.x,
      fromY: preview.shot.from.y,
      peekShoulderX: preview.shot.peekShoulder?.x,
      peekShoulderY: preview.shot.peekShoulder?.y,
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

export function buildGeneratedThemeScene(
  themeId: LevelThemeId,
  seed: string,
  profile: "landmark" | "quiet" = "landmark",
): VisualScene {
  const map = generateEncounter(
    new SeededRng(seed),
    profile === "landmark" ? 5 : 1,
    profile === "landmark" ? "final" : "combat",
    [
      { id: "lab-rook", name: "Rook", archetypeId: "operator", hp: 9, maxHp: 9, baseMaxAp: 4 },
      { id: "lab-vex", name: "Vex", archetypeId: "runner", hp: 5, maxHp: 7, baseMaxAp: 5 },
      { id: "lab-hex", name: "Hex", archetypeId: "bulwark", hp: 11, maxHp: 11, baseMaxAp: 3 },
    ],
    ["smartlink", "ghost_step"],
    { themeId },
  );
  const state = emptyState(map);
  state.selected = map.units.find((unit) => unit.team === "player") ?? null;
  const dominant = dominantLandmark(map.environment);
  const supporting = (map.environment?.landmarks ?? [])
    .filter((landmark) => landmark !== dominant)
    .map(({ name }) => name);
  const composition = environmentProfile(map.environment);

  return {
    id: `generated-${themeId.replace("_", "-")}-${profile}`,
    title: `${LEVEL_THEMES[themeId].shortName} · ${profile === "landmark" ? "landmark-heavy" : "quiet"}`,
    description: `Fixed seed ${seed}. Dominant feature: ${dominant?.name ?? "none"}. ` +
      `Supporting: ${supporting.length > 0 ? supporting.join(", ") : "none"}. ` +
      `Composition: ${composition}. ${LEVEL_THEMES[themeId].tacticalCharacter}`,
    review: profile === "landmark"
      ? "The dominant feature should still win the eye while supporting structures add context rather than competing with it."
      : "Confirm one feature clearly anchors the board and that broad ordinary floor stays calm and unmistakably walkable.",
    state,
  };
}

export function buildVisualScenes(): VisualScene[] {
  return [
    terrainScene(),
    unitScene(),
    overlayScene(),
    combatStatesScene(),
    operatorRolesScene(),
    enemyIntentScene(),
    effectsScene(),
    foundryGalleryScene(),
    dataCoreGalleryScene(),
    derelictGalleryScene(),
    buildGeneratedThemeScene("industrial", "FOUNDRY-LANDMARK-41", "landmark"),
    buildGeneratedThemeScene("industrial", "FOUNDRY-QUIET-12", "quiet"),
    buildGeneratedThemeScene("data_core", "DATA-VAULT-17", "landmark"),
    buildGeneratedThemeScene("data_core", "DATA-QUIET-08", "quiet"),
    buildGeneratedThemeScene("derelict", "SALVAGE-LANDMARK-29", "landmark"),
    buildGeneratedThemeScene("derelict", "SALVAGE-QUIET-06", "quiet"),
  ];
}
