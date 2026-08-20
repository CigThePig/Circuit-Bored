import {
  cloneMap,
  getTile,
  unitAt,
  type GameMap,
  type Unit,
} from "./map.ts";
import {
  computeMovementField,
  movementDestinations,
  movementPath,
  type MovementField,
} from "./movement.ts";
import { attachTapHandler } from "./input.ts";
import {
  draw,
  projectileKindForUnit,
  resizeCanvasForMap,
  type FloatingText,
  type MovementEffect,
  type RenderState,
  type ShotEffect,
} from "./render.ts";
import {
  previewShot,
  resolveShot,
  settleOverwatch,
  watchedTiles,
  type ShotPreview,
  type ShotResult,
} from "./combat.ts";
import {
  actionEligibility,
  actionsForUnit,
  availableActions,
  getAction,
  isCandidateSide,
  performAction,
  SHOOT_AP_COST,
  type ActionId,
} from "./actions.ts";
import { beginEnemyTurn, refreshEnemyIntents, takeEnemyAction } from "./ai.ts";
import { createAiSession } from "./aiSession.ts";
import { logReport, validateMap } from "./validation.ts";
import {
  beginUnitTurn,
  endUnitTurn,
  isSpent,
  movementApCost,
  movementRange,
  onUnitMoved,
  statusLabels,
} from "./rules.ts";
import { isSuppressed } from "./status.ts";
import { activeGuardian } from "./combat.ts";
import { intentCounterHint, intentLabel } from "./intent.ts";
import { rangeBandLabel, rangeRating } from "./range.ts";
import { UNIT_ARCHETYPES, type UnitArchetypeId } from "./content.ts";

/** Animation length of a move that covers a single tile. */
const SINGLE_STEP_MS = 280;
/** Per-tile animation length inside a multi-tile walk, so long routes read as one move. */
const MULTI_STEP_MS = 150;

export type Turn = "player" | "enemy";
export type EncounterOutcome = "victory" | "defeat";
type Outcome = EncounterOutcome | null;

export type RuntimeOptions = {
  preserveUnitState?: boolean;
  initialTurn?: Turn;
  random?: () => number;
  onStateChange?: (map: GameMap, turn: Turn) => void;
  onComplete?: (outcome: EncounterOutcome, map: GameMap) => void;
  exitLabel?: string;
  completionLabel?: string | ((outcome: EncounterOutcome) => string);
  minimumCellSize?: number;
};

export type RuntimeHandle = {
  destroy: () => void;
  resize: () => void;
};

export function encounterOutcome(map: GameMap): EncounterOutcome | null {
  const playerAlive = map.units.some((unit) => unit.team === "player" && unit.hp > 0);
  const enemyAlive = map.units.some((unit) => unit.team === "enemy" && unit.hp > 0);
  if (!enemyAlive) return "victory";
  if (!playerAlive) return "defeat";
  return null;
}

export function startRuntime(
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
  overlay: HTMLElement,
  overlayText: HTMLElement,
  overlayButton: HTMLButtonElement,
  banner: HTMLElement,
  sourceMap: GameMap,
  onExit: () => void,
  options: RuntimeOptions = {},
): RuntimeHandle {
  const map = cloneMap(sourceMap);
  for (const u of map.units) {
    if (!options.preserveUnitState) {
      u.hp = u.maxHp;
      u.ap = u.maxAp;
      u.overwatch = false;
      u.peekExposure = null;
      u.movesThisTurn = 0;
      u.shotsThisTurn = 0;
      u.killsThisTurn = 0;
      u.encounterShots = 0;
    }
    u.resolvingOverwatch = false;
  }

  const startupReport = validateMap(map);
  logReport("runtime startup", startupReport);

  let cancelled = false;
  const aiSession = createAiSession();

  let selected: Unit | null = null;
  let turn: Turn = options.initialTurn ?? "player";
  let outcome: Outcome = null;
  let busy = false;

  const floatingTexts: FloatingText[] = [];
  const shotEffects: ShotEffect[] = [];
  const movementEffects: MovementEffect[] = [];
  let shotEffectSequence = 0;
  let movementEffectSequence = 0;
  const random = options.random ?? Math.random;
  const notifyState = () => options.onStateChange?.(cloneMap(map), turn);

  const state: RenderState = {
    map,
    selected,
    highlights: [],
    enemyPreviews: [],
    floatingTexts,
    coverIndicators: [],
    threatMarkers: [],
    sightLines: [],
    shotEffects,
    movementEffects,
  };

  resizeCanvasForMap(canvas, map, options.minimumCellSize);

  // Turn and remaining hostiles share one line. The action tray adds a row to
  // the panel, and on a phone the End Turn button has to stay reachable, so
  // the two least-changing pieces of status are combined rather than stacked.
  const turnLabel = document.createElement("div");
  turnLabel.className = "status";
  const apLabel = document.createElement("div");
  apLabel.className = "status";
  // One line of prose that always answers "what happens if I commit to this".
  // Every action, available or not, explains itself here rather than relying
  // on a disabled button and a colour.
  const hintLabel = document.createElement("div");
  hintLabel.className = "status action-hint";

  /**
   * A targeted action the player has armed but not yet pointed at anybody.
   * Tapping a hostile resolves it; tapping the button again cancels it. This
   * is the only piece of action state the UI owns, and it is a selection, not
   * a rule.
   */
  let pendingAction: ActionId | null = null;

  /**
   * While on, tapping a hostile reads its dossier instead of shooting it.
   * Inspection needs its own mode because the enemies worth understanding are
   * exactly the ones the player can also shoot, so sharing the tap would make
   * the interesting cases unreadable.
   */
  let intelMode = false;
  /** The hostile whose dossier is currently open, if any. */
  let inspected: Unit | null = null;

  const actionRow = document.createElement("div");
  actionRow.className = "row action-tray";
  // The tray is rebuilt per selected operator: each one shows its own role
  // abilities plus the shared toolkit, rather than a fixed grid where most
  // buttons are permanently greyed out for most units.
  const actionButtons = new Map<ActionId, HTMLButtonElement>();
  let trayUnitKey = "";

  const makeActionButton = (id: ActionId): HTMLButtonElement => {
    const action = getAction(id);
    const button = document.createElement("button");
    button.className = "action-button";
    // Name and cost are both in the label: cost must never be something the
    // player has to hover to discover.
    button.innerHTML =
      `<span class="action-name"></span><span class="action-cost"></span>`;
    button.querySelector(".action-name")!.textContent = action.shortLabel;
    button.querySelector(".action-cost")!.textContent = `${action.apCost} AP`;
    button.addEventListener("click", () => onActionButton(id));
    return button;
  };

  const intelBtn = document.createElement("button");
  intelBtn.className = "action-button intel-button";
  intelBtn.innerHTML =
    `<span class="action-name">Intel</span><span class="action-cost">free</span>`;
  intelBtn.title =
    "Intel — free\nTarget: a hostile.\nRead its role, its weakness, and what it is planning.";
  intelBtn.addEventListener("click", () => {
    intelMode = !intelMode;
    if (intelMode) pendingAction = null;
    else inspected = null;
    redraw();
  });

  const rebuildTray = (unit: Unit | null) => {
    const key = unit ? `${unit.id}:${unit.archetypeId ?? ""}` : "";
    if (key === trayUnitKey) return;
    trayUnitKey = key;
    actionButtons.clear();
    actionRow.innerHTML = "";
    for (const id of unit ? actionsForUnit(unit) : []) {
      const button = makeActionButton(id);
      actionButtons.set(id, button);
      actionRow.appendChild(button);
    }
    actionRow.appendChild(intelBtn);
  };

  const endTurnBtn = document.createElement("button");
  endTurnBtn.textContent = "End Turn";
  endTurnBtn.className = "primary";

  const exitBtn = document.createElement("button");
  exitBtn.textContent = options.exitLabel ?? "Quit";
  exitBtn.addEventListener("click", () => onExit());

  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(endTurnBtn);
  row.appendChild(exitBtn);

  hud.innerHTML = "";
  hud.appendChild(turnLabel);
  hud.appendChild(apLabel);
  hud.appendChild(actionRow);
  hud.appendChild(hintLabel);
  hud.appendChild(row);

  // Cleared at the start of every redraw so targeting overlays and combat
  // resolution share the same cover, peek, and exposure rules.
  const previewCache = new Map<string, ShotPreview>();
  const cachedPreview = (shooter: Unit, target: Unit): ShotPreview => {
    const key = `${shooter.id}|${target.id}`;
    let v = previewCache.get(key);
    if (!v) {
      v = previewShot(map, shooter, target);
      previewCache.set(key, v);
    }
    return v;
  };

  /** Display name for a unit id, for intent banners and dossier text. */
  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    const unit = map.units.find((u) => u.id === id);
    return unit?.displayName ?? null;
  };

  const computeOverlays = () => {
    state.coverIndicators = [];
    state.threatMarkers = [];
    state.sightLines = [];
    state.intentMarkers = [];
    state.guardLinks = [];
    if (turn !== "player" || busy) return;

    // Published enemy plans. Read straight off the units, where the AI's
    // planner wrote them; the renderer never predicts anything itself.
    for (const e of map.units) {
      if (e.team !== "enemy" || e.hp <= 0 || !e.intent) continue;
      const label = intentLabel(e.intent, nameOf(e.intent.targetId));
      if (!label) continue;
      const focus = e.intent.targetId
        ? map.units.find((u) => u.id === e.intent!.targetId && u.hp > 0)
        : undefined;
      state.intentMarkers!.push({
        x: e.x,
        y: e.y,
        label,
        urgent: e.intent.kind === "aim",
        toX: focus?.x,
        toY: focus?.y,
      });
    }

    // Guard tethers, resolved through the same rule the damage step uses, so a
    // drawn link always means real protection.
    for (const u of map.units) {
      if (u.hp <= 0) continue;
      const guardian = activeGuardian(map, u);
      if (!guardian) continue;
      state.guardLinks!.push({
        fromX: guardian.x,
        fromY: guardian.y,
        toX: u.x,
        toY: u.y,
      });
    }

    for (const e of map.units) {
      if (e.team !== "enemy" || e.hp <= 0) continue;
      let seesAny = false;
      for (const p of map.units) {
        if (p.team !== "player" || p.hp <= 0) continue;
        if (cachedPreview(e, p).shot.canShoot) {
          seesAny = true;
          break;
        }
      }
      if (seesAny) state.threatMarkers!.push({ x: e.x, y: e.y });
    }

    if (!selected || selected.hp <= 0) return;

    const adjs: { side: "n" | "s" | "e" | "w"; x: number; y: number }[] = [
      { side: "n", x: selected.x, y: selected.y - 1 },
      { side: "s", x: selected.x, y: selected.y + 1 },
      { side: "w", x: selected.x - 1, y: selected.y },
      { side: "e", x: selected.x + 1, y: selected.y },
    ];
    for (const a of adjs) {
      const t = getTile(map, a.x, a.y);
      if (t === "wall") {
        state.coverIndicators!.push({
          x: selected.x,
          y: selected.y,
          side: a.side,
          kind: "wall",
        });
      } else if (t === "half_cover") {
        state.coverIndicators!.push({
          x: selected.x,
          y: selected.y,
          side: a.side,
          kind: "half_cover",
        });
      }
    }

    if (selected.ap >= SHOOT_AP_COST || pendingAction !== null) {
      for (const e of map.units) {
        if (e.team !== "enemy" || e.hp <= 0) continue;
        const preview = cachedPreview(selected, e);
        if (preview.shot.canShoot) {
          state.sightLines!.push({
            fromX: preview.shot.from.x,
            fromY: preview.shot.from.y,
            peekShoulderX: preview.shot.peekShoulder?.x,
            peekShoulderY: preview.shot.peekShoulder?.y,
            toX: preview.targetPoint.x,
            toY: preview.targetPoint.y,
            hasCover: preview.hadCover,
            shooterX: selected.x,
            shooterY: selected.y,
            mode: preview.shot.mode === "peek" ? "peek" : "direct",
          });
        }
      }
    }
  };

  // Rebuilt on every redraw, then reused by the tap handler so the tile a
  // player taps is resolved against exactly the region they were shown.
  let moveField: MovementField | null = null;

  const computeHighlights = () => {
    state.highlights = [];
    state.enemyPreviews = [];
    state.moveRange = null;
    state.watchedTiles = [];
    moveField = null;
    if (!selected || turn !== "player" || busy) return;
    const range = movementRange(selected);
    if (range > 0) {
      moveField = computeMovementField(map, selected, range);
      const tiles = movementDestinations(selected, moveField);
      if (tiles.length > 0) {
        state.moveRange = { originX: selected.x, originY: selected.y, tiles };
        // Overwatch now controls ground rather than a visibility threshold, so
        // the radius has to show which of its tiles a hostile already covers.
        const watched = new Map<string, { x: number; y: number }>();
        for (const e of map.units) {
          if (e.team !== "enemy" || e.hp <= 0 || !e.overwatch) continue;
          for (const tile of watchedTiles(map, e, selected, tiles)) {
            watched.set(`${tile.x},${tile.y}`, tile);
          }
        }
        state.watchedTiles = [...watched.values()];
      }
    }
    // While a targeted action is armed the board previews that action's
    // targets, not the shot's: the same enemies would otherwise be highlighted
    // with a hit chance the player is not about to roll. An ally-targeted
    // ability highlights squadmates instead, on the same rules.
    const previewAction: ActionId = pendingAction ?? "shoot";
    const armedAlly = pendingAction !== null &&
      getAction(pendingAction).targeting === "ally";
    for (const u of map.units) {
      if (u.hp <= 0) continue;
      if (!isCandidateSide(selected, u, previewAction)) continue;
      if (!actionEligibility(map, selected, previewAction, u).ok) continue;
      state.highlights.push({
        x: u.x,
        y: u.y,
        fill: armedAlly
          ? "rgba(143, 208, 255, 0.42)"
          : pendingAction
            ? "rgba(255, 154, 77, 0.5)"
            : "rgba(255, 80, 80, 0.55)",
        border: armedAlly
          ? "rgba(143, 208, 255, 1)"
          : pendingAction
            ? "rgba(255, 154, 77, 1)"
            : "rgba(255, 80, 80, 1)",
      });
      // Only a shot has a hit chance worth previewing; a support ability does
      // not, and showing one would be a number the player cannot act on.
      if (armedAlly) continue;
      const preview = cachedPreview(selected, u);
      state.enemyPreviews.push({
        x: u.x,
        y: u.y,
        hitPct: Math.round(preview.hitChance * 100),
        hasCover: preview.hadCover,
        exposed: preview.exposed !== null,
        damage: preview.damage,
      });
    }
  };

  const updateHud = () => {
    const enemyCounts = new Map<string, number>();
    for (const unit of map.units) {
      if (unit.team !== "enemy" || unit.hp <= 0) continue;
      const name = unit.displayName ?? "Enemy";
      enemyCounts.set(name, (enemyCounts.get(name) ?? 0) + 1);
    }
    const hostiles = [...enemyCounts].map(([name, count]) => `${count} ${name}`).join(" · ") || "none";
    turnLabel.textContent =
      `${turn === "player" ? "Your turn" : "Enemy turn"}  ·  Hostiles: ${hostiles}`;
    if (selected && selected.hp > 0) {
      const name = selected.displayName ? `${selected.displayName} · ` : "";
      const states = statusLabels(selected);
      const suffix = states.length > 0 ? `  [${states.join(" ")}]` : "";
      apLabel.textContent = `${name}HP ${selected.hp}/${selected.maxHp}  AP ${selected.ap}/${selected.maxAp}  MOVE ${movementRange(selected)}${suffix}`;
    } else {
      apLabel.textContent = "No unit selected. Tap one of your units.";
    }
    endTurnBtn.disabled = turn !== "player" || outcome !== null || busy;
    const livePlayers = map.units.filter((u) => u.team === "player" && u.hp > 0);
    const allSpent = livePlayers.length > 0 && livePlayers.every(isSpent);
    const showSpentNudge =
      turn === "player" && outcome === null && !busy && allSpent;
    endTurnBtn.textContent = showSpentNudge ? "End Turn (all spent)" : "End Turn";
    endTurnBtn.classList.toggle("pulse-attention", showSpentNudge);
    updateActionTray();
  };

  /**
   * Rebuild the action tray from the rule layer. Availability, cost, target
   * type, and effect text all come from the action definitions, so a button
   * can never advertise something the rules would refuse.
   */
  /**
   * The dossier for an inspected hostile: what it is for, what beats it, and
   * what it is currently planning. This is the "look at an enemy and know the
   * shape of the plan that beats it" surface.
   */
  const dossierText = (enemy: Unit): string => {
    const archetype = enemy.archetypeId
      ? UNIT_ARCHETYPES[enemy.archetypeId as UnitArchetypeId]
      : undefined;
    const lines: string[] = [];
    lines.push(`${enemy.displayName ?? "Hostile"} · HP ${enemy.hp}/${enemy.maxHp}`);
    if (archetype) {
      lines.push(archetype.role);
      lines.push(`Weakness: ${archetype.counter}`);
      const bands = (["close", "medium", "long"] as const)
        .map((band) => `${rangeBandLabel(band)} ${rangeRating(enemy.combat, band)}`)
        .join(" · ");
      lines.push(bands);
    }
    const plan = intentLabel(enemy.intent, nameOf(enemy.intent?.targetId ?? null));
    if (plan) {
      lines.push(`Plan: ${plan}`);
      const counter = intentCounterHint(enemy.intent);
      if (counter) lines.push(counter);
    }
    const states = statusLabels(enemy);
    if (states.length > 0) lines.push(`[${states.join(" ")}]`);
    return lines.join("  ·  ");
  };

  const updateActionTray = () => {
    const canAct = turn === "player" && outcome === null && !busy &&
      selected !== null && selected.team === "player" && selected.hp > 0;
    rebuildTray(canAct ? selected : null);
    intelBtn.disabled = turn !== "player" || outcome !== null || busy;
    intelBtn.classList.toggle("active", intelMode);

    if (intelMode && inspected && inspected.hp > 0) {
      hintLabel.textContent = dossierText(inspected);
      for (const button of actionButtons.values()) button.disabled = true;
      return;
    }
    if (!canAct || !selected) {
      for (const [id, button] of actionButtons) {
        const action = getAction(id);
        button.disabled = true;
        button.classList.remove("active");
        button.title = `${action.name} — ${action.apCost} AP. ${action.description}`;
      }
      hintLabel.textContent = turn === "player" && outcome === null && !busy
        ? intelMode
          ? "Intel: tap a hostile to read its role, weakness, and plan."
          : "Select an operator to see its actions."
        : "";
      return;
    }
    const unit = selected;
    for (const entry of availableActions(map, unit)) {
      const button = actionButtons.get(entry.action.id);
      if (!button) continue;
      const armed = pendingAction === entry.action.id;
      button.disabled = intelMode || (!entry.eligibility.ok && !armed);
      button.classList.toggle("active", armed);
      const targetText = entry.action.targeting === "enemy"
        ? "Target: a hostile you can shoot."
        : entry.action.targeting === "ally"
          ? "Target: a squadmate."
          : "Target: this operator.";
      const availability = entry.eligibility.ok
        ? "Available."
        : `Unavailable: ${entry.eligibility.reason}`;
      button.title =
        `${entry.action.name} — ${entry.action.apCost} AP\n${targetText}\n` +
        `${entry.action.description}\n${availability}`;
    }
    if (intelMode) {
      hintLabel.textContent = "Intel: tap a hostile to read its role, weakness, and plan.";
      return;
    }
    if (pendingAction) {
      const action = getAction(pendingAction);
      const who = action.targeting === "ally" ? "squadmate" : "hostile";
      hintLabel.textContent =
        `${action.name} armed (${action.apCost} AP). Tap a highlighted ${who}, or tap ${action.shortLabel} again to cancel.`;
      return;
    }
    if (isSuppressed(unit)) {
      hintLabel.textContent =
        "Suppressed: reduced accuracy and one fewer action point. Cannot aim, suppress, or set overwatch.";
      return;
    }
    // While a shot is on the table, say which band it is at and how this
    // operator's weapon feels about that. Range only matters if the player can
    // see it, and this is the moment it matters.
    const shotNote = bestShotNote(unit);
    hintLabel.textContent = unit.ap >= SHOOT_AP_COST
      ? `Tap a hostile to shoot (${SHOOT_AP_COST} AP), tap ground to move, or choose an action.${shotNote}`
      : `Not enough AP to shoot. Tap ground to move, or choose an action.${shotNote}`;
  };

  /** Range commentary for the best shot the selected operator currently has. */
  const bestShotNote = (unit: Unit): string => {
    let best: { preview: ShotPreview; target: Unit } | null = null;
    for (const e of map.units) {
      if (e.team !== "enemy" || e.hp <= 0) continue;
      const preview = cachedPreview(unit, e);
      if (!preview.shot.canShoot) continue;
      if (!best || preview.hitChance > best.preview.hitChance) {
        best = { preview, target: e };
      }
    }
    if (!best) return "";
    const rating = rangeRating(unit.combat, best.preview.band);
    const verdict = rating === "strong"
      ? "your range"
      : rating === "weak"
        ? "outside your range"
        : "workable";
    return `  Best line: ${best.target.displayName ?? "hostile"} at ` +
      `${rangeBandLabel(best.preview.band)} — ${verdict}.`;
  };

  const onActionButton = (id: ActionId) => {
    if (turn !== "player" || outcome !== null || busy) return;
    if (!selected || selected.team !== "player" || selected.hp <= 0) return;
    if (pendingAction === id) {
      pendingAction = null;
      redraw();
      return;
    }
    const action = getAction(id);
    if (!actionEligibility(map, selected, id).ok) return;
    if (action.targeting !== "self") {
      // Every targeted action owns the next board tap. Enemy-targeted actions
      // resolve on hostiles; ally-targeted role abilities resolve on squadmates.
      pendingAction = id;
      redraw();
      return;
    }
    pendingAction = null;
    const outcomeResult = performAction(map, selected, id, null, random);
    if (!outcomeResult.ok) {
      redraw();
      return;
    }
    addFloating(action.shortLabel.toUpperCase(), selected.x, selected.y, actionFloatColor(id));
    refreshEnemyIntents(map);
    if (isSpent(selected)) selected = null;
    notifyState();
    redraw();
  };

  const redraw = () => {
    previewCache.clear();
    state.selected = selected;
    computeHighlights();
    computeOverlays();
    draw(canvas, state);
    updateHud();
  };

  let bannerFadeTimer = 0;
  let bannerHideTimer = 0;
  const showTurnBanner = (kind: "player" | "enemy") => {
    clearTimeout(bannerFadeTimer);
    clearTimeout(bannerHideTimer);
    banner.textContent = kind === "player" ? "YOUR TURN" : "ENEMY TURN";
    banner.classList.remove("hidden", "fade", "your-turn", "enemy-turn");
    banner.classList.add(kind === "player" ? "your-turn" : "enemy-turn");
    bannerFadeTimer = window.setTimeout(() => {
      banner.classList.add("fade");
    }, 700);
    bannerHideTimer = window.setTimeout(() => {
      banner.classList.add("hidden");
    }, 1300);
  };

  const addFloating = (text: string, x: number, y: number, color: string) => {
    floatingTexts.push({
      text,
      x,
      y,
      color,
      expiresAt: performance.now() + 1200,
    });
  };

  const addShotEffect = (shooter: Unit, target: Unit, result: ShotResult): ShotEffect | null => {
    if (!result.canShoot) return null;
    const effect: ShotEffect = {
      id: `shot-${shotEffectSequence++}`,
      shooterId: shooter.id,
      targetId: target.id,
      shooterTeam: shooter.team,
      targetTeam: target.team,
      shooterX: shooter.x,
      shooterY: shooter.y,
      targetX: target.x,
      targetY: target.y,
      fromX: result.from.x,
      fromY: result.from.y,
      peekShoulderX: result.peekShoulder?.x,
      peekShoulderY: result.peekShoulder?.y,
      toX: result.targetPoint.x,
      toY: result.targetPoint.y,
      mode: result.mode,
      projectile: projectileKindForUnit(shooter),
      hit: result.hit,
      startedAt: performance.now(),
      durationMs: result.mode === "peek" ? 560 : 460,
    };
    shotEffects.push(effect);
    return effect;
  };

  /**
   * Suppression is a burst of fire that deals no damage, so it reuses the shot
   * effect with `hit: false`: the tracer leaves the same weapon along the same
   * validated firing line, and nothing on the target reacts as if wounded.
   */
  const addSuppressionEffect = (
    shooter: Unit,
    target: Unit,
    preview: ShotPreview,
  ): ShotEffect | null => {
    if (!preview.shot.canShoot) return null;
    const effect: ShotEffect = {
      id: `shot-${shotEffectSequence++}`,
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
      mode: preview.shot.mode === "peek" ? "peek" : "direct",
      projectile: projectileKindForUnit(shooter),
      hit: false,
      startedAt: performance.now(),
      durationMs: preview.shot.mode === "peek" ? 560 : 460,
    };
    shotEffects.push(effect);
    return effect;
  };

  const addMovementEffect = (
    unit: Unit,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = SINGLE_STEP_MS,
  ): MovementEffect => {
    const effect: MovementEffect = {
      id: `move-${movementEffectSequence++}`,
      unitId: unit.id,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      startedAt: performance.now(),
      durationMs,
    };
    movementEffects.push(effect);
    return effect;
  };

  const checkOutcome = () => {
    outcome = encounterOutcome(map);
    if (outcome) {
      overlayText.textContent = outcome === "victory" ? "VICTORY" : "DEFEAT";
      overlayButton.textContent = typeof options.completionLabel === "function"
        ? options.completionLabel(outcome)
        : options.completionLabel ?? (outcome === "victory" ? "Continue" : "Run Report");
      overlay.classList.remove("hidden", "victory", "defeat");
      overlay.classList.add(outcome === "victory" ? "victory" : "defeat");
    }
  };

  const detachTap = attachTapHandler(canvas, () => map, ({ x, y }) => {
    if (turn !== "player" || outcome !== null || busy) return;
    const tappedUnit = unitAt(map, x, y);

    // Intel is a read-only mode, so it answers every tap before anything can
    // spend an action point.
    if (intelMode) {
      if (tappedUnit && tappedUnit.team === "enemy" && tappedUnit.hp > 0) {
        inspected = tappedUnit;
      } else {
        inspected = null;
      }
      redraw();
      return;
    }

    if (tappedUnit && tappedUnit.team === "player" && tappedUnit.hp > 0) {
      // An armed ally ability claims the tap; otherwise tapping a squadmate
      // selects it, which is the behaviour the player already knows.
      if (
        selected &&
        pendingAction &&
        getAction(pendingAction).targeting === "ally" &&
        tappedUnit.id !== selected.id
      ) {
        const actor = selected;
        const actionId = pendingAction;
        pendingAction = null;
        const support = performAction(map, actor, actionId, tappedUnit, random);
        if (support.ok) {
          addFloating(
            getAction(actionId).shortLabel.toUpperCase(),
            tappedUnit.x,
            tappedUnit.y,
            actionFloatColor(actionId),
          );
          if (isSpent(actor)) selected = null;
          refreshEnemyIntents(map);
          notifyState();
        }
        redraw();
        return;
      }
      selected = tappedUnit;
      pendingAction = null;
      redraw();
      return;
    }

    if (!selected || selected.hp <= 0) {
      redraw();
      return;
    }

    if (tappedUnit && tappedUnit.team === "enemy") {
      // Shooting is the default board verb; an armed tray action replaces it
      // for exactly one tap.
      const actionId: ActionId = pendingAction ?? "shoot";
      const shooter = selected;
      const outcomeResult = performAction(map, shooter, actionId, tappedUnit, random);
      pendingAction = null;
      if (!outcomeResult.ok) {
        redraw();
        return;
      }
      const result = outcomeResult.result;
      let durationMs = 0;
      if (result.kind === "shot") {
        const effect = addShotEffect(shooter, tappedUnit, result.shot);
        if (!effect) {
          // performAction already refuses to resolve an illegal shot, so this
          // only guards a future effect-layer failure.
          shooter.ap += getAction(actionId).apCost;
          redraw();
          return;
        }
        durationMs = effect.durationMs;
        if (result.shot.hit) {
          const flankNote = result.shot.exposed ? " !" : "";
          addFloating(
            `HIT ${result.shot.damage}${flankNote}`,
            tappedUnit.x,
            tappedUnit.y,
            result.shot.exposed ? "#ff8fb0" : "#ffd83a",
          );
        } else {
          addFloating("MISS", tappedUnit.x, tappedUnit.y, "#fff");
        }
      } else if (result.kind === "suppress") {
        const effect = addSuppressionEffect(shooter, tappedUnit, result.shot);
        durationMs = effect?.durationMs ?? 0;
        addFloating("SUPPRESSED", tappedUnit.x, tappedUnit.y, "#ff9a4d");
      } else if (result.kind === "mark") {
        addFloating("MARKED", tappedUnit.x, tappedUnit.y, "#ffe066");
      }
      // The board just changed in ways that can invalidate an enemy's plan -
      // a broken aim, a dead target, a cleared watch - so republish.
      refreshEnemyIntents(map);
      if (isSpent(shooter)) selected = null;
      busy = true;
      redraw();
      checkOutcome();
      notifyState();
      redraw();
      void (async () => {
        await delay(durationMs);
        if (cancelled) return;
        busy = false;
        redraw();
      })();
      return;
    }

    // Tapping empty ground with an action armed cancels it rather than
    // silently walking somewhere the player did not intend.
    if (pendingAction) {
      pendingAction = null;
      redraw();
      return;
    }

    // Anywhere inside the shown movement radius is a legal destination; the
    // unit walks the shortest route there one tile at a time.
    const path = moveField ? movementPath(moveField, x, y) : [];
    if (path.length > 0) {
      const mover = selected;
      busy = true;
      redraw();
      void (async () => {
        await walkPath(mover, path);
        if (cancelled) return;
        if (isSpent(mover) || mover.hp <= 0) selected = null;
        busy = false;
        notifyState();
        redraw();
      })();
    }
  });

  /**
   * Walks `mover` along an already-validated path, one tile per animation
   * step. AP is charged tile by tile rather than up front so an interrupted
   * walk never bills the unit for ground it did not cover, and every step is
   * a separate overwatch trigger just as a single-tile move used to be.
   */
  const walkPath = async (mover: Unit, path: { x: number; y: number }[]) => {
    const stepMs = path.length > 1 ? MULTI_STEP_MS : SINGLE_STEP_MS;
    for (const step of path) {
      if (cancelled || mover.hp <= 0) return;
      const cost = movementApCost(mover);
      if (mover.ap < cost) return;
      const occupant = unitAt(map, step.x, step.y);
      if (occupant && occupant.id !== mover.id) return;
      const from = { x: mover.x, y: mover.y };
      mover.x = step.x;
      mover.y = step.y;
      mover.ap -= cost;
      // Moving cancels a prepared shot and drops any committed lean. The rule
      // layer owns that so a walk cannot silently keep an Aim alive.
      onUnitMoved(mover);
      const effect = addMovementEffect(mover, from, step, stepMs);
      redraw();
      await delay(effect.durationMs);
      if (cancelled) return;
      await triggerEnemyOverwatchReactions(mover, from, step);
      if (cancelled) return;
      // Each completed tile is its own persistence boundary, so quitting
      // mid-walk saves the encounter exactly where the unit stands.
      refreshEnemyIntents(map);
      notifyState();
      if (mover.hp <= 0) return;
    }
  };

  const triggerOverwatchReactions = async (
    enemy: Unit,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    for (const p of map.units) {
      if (p.team !== "player" || p.hp <= 0) continue;
      // settleOverwatch spends the reaction and any evasion charge, so the
      // watch's remaining shots and a dashing mover's slip are accounted for
      // exactly once, here, rather than by each caller remembering to.
      const check = settleOverwatch(map, p, enemy, from, to);
      if (check.evaded) {
        addFloating("SLIPPED", enemy.x, enemy.y, "#7ff0c4");
        redraw();
        continue;
      }
      if (!check.fires) continue;
      p.resolvingOverwatch = true;
      const result = resolveShot(map, p, enemy, random);
      const effect = addShotEffect(p, enemy, result);
      p.resolvingOverwatch = false;
      if (!effect) continue;
      if (result.hit) {
        addFloating(`HIT ${result.damage}`, enemy.x, enemy.y, "#ffd83a");
      } else {
        addFloating("MISS", enemy.x, enemy.y, "#fff");
      }
      redraw();
      checkOutcome();
      // The caller persists only after this reaction completes. If the player
      // exits during the animation, the saved encounter still represents the
      // pre-move state instead of a destination with an unconsumed watch.
      await delay(effect.durationMs);
      if (cancelled) return;
      // Independent watchers are independent reactions. Continue through the
      // squad unless this shot actually ended the mover's turn by killing it.
      if (enemy.hp <= 0) return;
    }
  };

  async function triggerEnemyOverwatchReactions(
    player: Unit,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    for (const enemy of map.units) {
      if (enemy.team !== "enemy" || enemy.hp <= 0) continue;
      const check = settleOverwatch(map, enemy, player, from, to);
      if (check.evaded) {
        // Vex's sprint carried it through. The watch survives for the next one.
        addFloating("SLIPPED", player.x, player.y, "#7ff0c4");
        redraw();
        continue;
      }
      if (!check.fires) continue;
      enemy.resolvingOverwatch = true;
      const result = resolveShot(map, enemy, player, random);
      const effect = addShotEffect(enemy, player, result);
      enemy.resolvingOverwatch = false;
      if (!effect) continue;
      addFloating(result.hit ? `HIT ${result.damage}` : "MISS", player.x, player.y, result.hit ? "#ffd83a" : "#fff");
      redraw();
      checkOutcome();
      // Keep the move and its overwatch result as one persistence boundary;
      // see the player-move continuation that calls notifyState() below.
      await delay(effect.durationMs);
      if (cancelled) return;
      // A movement step can cross several separately-covered lanes. Let every
      // eligible watcher react unless the mover has already been dropped.
      if (player.hp <= 0) return;
    }
  }

  const animateEnemyTurn = async () => {
    busy = true;
    updateHud();
    await delay(500);
    if (cancelled) return;
    const enemies = map.units.filter((u) => u.team === "enemy" && u.hp > 0);
    for (const enemy of enemies) {
      if (cancelled) return;
      beginEnemyTurn(map, enemy, aiSession);
      while (!isSpent(enemy) && enemy.hp > 0 && outcome === null) {
        if (cancelled) return;
        const action = takeEnemyAction(map, enemy, aiSession, random);
        if (action.kind === "wait") break;
        if (action.kind === "shoot") {
          const effect = addShotEffect(enemy, action.target, action.result);
          if (!effect) break;
          if (action.result.hit) {
            addFloating(`HIT ${action.result.damage}`, action.target.x, action.target.y, "#ffd83a");
          } else {
            addFloating("MISS", action.target.x, action.target.y, "#fff");
          }
          redraw();
          checkOutcome();
          notifyState();
          await delay(effect.durationMs);
          if (cancelled) return;
          if (outcome !== null) break;
        } else if (action.kind === "move") {
          // Enemies also walk several tiles per turn now, so each tile gets the
          // shorter per-step timing instead of a full single-move animation.
          const effect = addMovementEffect(enemy, action.from, action.to, MULTI_STEP_MS);
          redraw();
          await delay(effect.durationMs);
          if (cancelled) return;
          await triggerOverwatchReactions(enemy, action.from, action.to);
          if (cancelled) return;
          notifyState();
          if (outcome !== null) break;
        } else if (action.kind === "overwatch") {
          addFloating("WATCH", enemy.x, enemy.y, "#ffd166");
          redraw();
          notifyState();
          continue;
        } else if (action.kind === "hunker") {
          addFloating("HUNKER", enemy.x, enemy.y, "#79dfa6");
          redraw();
          notifyState();
          continue;
        } else if (action.kind === "aim") {
          // The telegraph. The player gets this turn to break it.
          addFloating("LOCKING ON", enemy.x, enemy.y, "#ff5f6d");
          redraw();
          notifyState();
          continue;
        } else if (action.kind === "suppress") {
          const effect = addSuppressionEffect(
            enemy,
            action.target,
            previewShot(map, enemy, action.target),
          );
          addFloating("SUPPRESSED", action.target.x, action.target.y, "#ff9a4d");
          redraw();
          notifyState();
          if (effect) {
            await delay(effect.durationMs);
            if (cancelled) return;
          }
          continue;
        }
      }
      if (outcome !== null) break;
    }
    if (cancelled) return;
    if (outcome === null) {
      turn = "player";
      for (const u of map.units) {
        if (u.team === "enemy" && u.hp > 0) endUnitTurn(u);
      }
      for (const u of map.units) {
        if (u.team === "player" && u.hp > 0) beginUnitTurn(u);
      }
      // Publish what every surviving hostile means to do next, so the player
      // plans against the enemy's plan rather than against last turn's damage.
      refreshEnemyIntents(map);
      showTurnBanner("player");
    }
    busy = false;
    notifyState();
    redraw();
  };

  endTurnBtn.addEventListener("click", () => {
    if (turn !== "player" || outcome !== null || busy) return;
    turn = "enemy";
    // Statuses whose duration is counted in the owner's turns expire when that
    // turn actually ends, so a suppression applied to the enemy on this turn
    // still covers the enemy turn that follows.
    for (const u of map.units) {
      if (u.team === "player" && u.hp > 0) endUnitTurn(u);
    }
    for (const u of map.units) {
      if (u.team === "enemy" && u.hp > 0) beginUnitTurn(u);
    }
    selected = null;
    pendingAction = null;
    inspected = null;
    showTurnBanner("enemy");
    redraw();
    notifyState();
    void animateEnemyTurn();
  });

  overlayButton.onclick = () => {
    overlay.classList.add("hidden");
    if (outcome && options.onComplete) options.onComplete(outcome, cloneMap(map));
    else onExit();
  };

  let rafId = 0;
  const tick = () => {
    if (cancelled) return;
    if (floatingTexts.length > 0) {
      const now = performance.now();
      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        if (floatingTexts[i].expiresAt <= now) floatingTexts.splice(i, 1);
      }
    }
    if (shotEffects.length > 0) {
      const now = performance.now();
      for (let i = shotEffects.length - 1; i >= 0; i--) {
        if (!shotEffects[i].loop && shotEffects[i].startedAt + shotEffects[i].durationMs <= now) {
          shotEffects.splice(i, 1);
        }
      }
    }
    if (movementEffects.length > 0) {
      const now = performance.now();
      for (let i = movementEffects.length - 1; i >= 0; i--) {
        if (!movementEffects[i].loop && movementEffects[i].startedAt + movementEffects[i].durationMs <= now) {
          movementEffects.splice(i, 1);
        }
      }
    }
    // Always repaint while a match is live so the unit idle bob and other
    // time-based effects (threat pulse, peek lean) stay smooth.
    const hasTransientEffects = floatingTexts.length > 0 || shotEffects.length > 0 || movementEffects.length > 0;
    if (outcome === null || hasTransientEffects) redraw();
    if (outcome === null || hasTransientEffects) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  };
  rafId = requestAnimationFrame(tick);

  const initialPlayer = map.units.find((u) => u.team === "player" && u.hp > 0) ?? null;
  selected = initialPlayer;
  if (turn === "player") refreshEnemyIntents(map);
  // A saved encounter can contain the killing blow before its completion
  // overlay was acknowledged. Restore that terminal state before accepting
  // input or starting an enemy turn.
  checkOutcome();
  if (!outcome) showTurnBanner(turn);
  redraw();
  notifyState();
  if (!outcome && turn === "enemy") void animateEnemyTurn();

  const resize = () => {
    resizeCanvasForMap(canvas, map, options.minimumCellSize);
    redraw();
  };

  return {
    destroy: () => {
      cancelled = true;
      detachTap();
      cancelAnimationFrame(rafId);
      clearTimeout(bannerFadeTimer);
      clearTimeout(bannerHideTimer);
      banner.classList.add("hidden");
      banner.classList.remove("fade", "your-turn", "enemy-turn");
      hud.innerHTML = "";
      overlay.classList.add("hidden");
      overlay.classList.remove("victory", "defeat");
      overlayButton.onclick = null;
    },
    resize,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Floating-text colour for a self action, matching its board status chip. */
function actionFloatColor(id: ActionId): string {
  if (id === "aim") return "#8fe4ff";
  if (id === "hunker") return "#79dfa6";
  if (id === "overwatch") return "#ffd166";
  return "#ff9a4d";
}
