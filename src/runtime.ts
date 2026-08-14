import {
  cloneMap,
  getTile,
  isPassable,
  unitAt,
  type GameMap,
  type Unit,
} from "./map.ts";
import { attachTapHandler } from "./input.ts";
import {
  draw,
  resizeCanvasForMap,
  type FloatingText,
  type RenderState,
} from "./render.ts";
import {
  canShootTarget,
  overwatchShouldFire,
  previewShot,
  resolveShot,
  type ShotPreview,
} from "./combat.ts";
import { beginEnemyTurn, takeEnemyAction } from "./ai.ts";
import { createAiSession } from "./aiSession.ts";
import { logReport, validateMap } from "./validation.ts";
import { movementApCost, resetTurnState } from "./rules.ts";

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
  };

  resizeCanvasForMap(canvas, map);

  const turnLabel = document.createElement("div");
  turnLabel.className = "status";
  const apLabel = document.createElement("div");
  apLabel.className = "status";
  const enemyLabel = document.createElement("div");
  enemyLabel.className = "status";

  const overwatchBtn = document.createElement("button");
  overwatchBtn.textContent = "Overwatch";

  const endTurnBtn = document.createElement("button");
  endTurnBtn.textContent = "End Turn";
  endTurnBtn.className = "primary";

  const exitBtn = document.createElement("button");
  exitBtn.textContent = options.exitLabel ?? "Quit";
  exitBtn.addEventListener("click", () => onExit());

  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(overwatchBtn);
  row.appendChild(endTurnBtn);
  row.appendChild(exitBtn);

  hud.innerHTML = "";
  hud.appendChild(turnLabel);
  hud.appendChild(apLabel);
  hud.appendChild(enemyLabel);
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

  const computeOverlays = () => {
    state.coverIndicators = [];
    state.threatMarkers = [];
    state.sightLines = [];
    if (turn !== "player") return;

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

    for (const e of map.units) {
      if (e.team !== "enemy" || e.hp <= 0) continue;
      const preview = cachedPreview(selected, e);
      if (preview.shot.canShoot) {
        state.sightLines!.push({
          fromX: preview.shot.from.x,
          fromY: preview.shot.from.y,
          toX: preview.targetPoint.x,
          toY: preview.targetPoint.y,
          hasCover: preview.hadCover,
        });
      }
    }
  };

  const computeHighlights = () => {
    state.highlights = [];
    state.enemyPreviews = [];
    if (!selected || turn !== "player") return;
    const moveCost = movementApCost(selected);
    if (selected.ap >= moveCost) {
      const adj = [
        { x: selected.x + 1, y: selected.y },
        { x: selected.x - 1, y: selected.y },
        { x: selected.x, y: selected.y + 1 },
        { x: selected.x, y: selected.y - 1 },
      ];
      for (const c of adj) {
        if (isPassable(map, c.x, c.y)) {
          state.highlights.push({
            x: c.x,
            y: c.y,
            fill: "rgba(80, 200, 120, 0.55)",
            border: "rgba(80, 200, 120, 1)",
          });
        }
      }
    }
    if (selected.ap >= 2) {
      for (const u of map.units) {
        if (u.team !== "enemy" || u.hp <= 0) continue;
        const preview = cachedPreview(selected, u);
        if (!preview.shot.canShoot) continue;
        state.highlights.push({
          x: u.x,
          y: u.y,
          fill: "rgba(255, 80, 80, 0.55)",
          border: "rgba(255, 80, 80, 1)",
        });
        state.enemyPreviews.push({
          x: u.x,
          y: u.y,
          hitPct: Math.round(preview.hitChance * 100),
          hasCover: preview.hadCover,
        });
      }
    }
  };

  const updateHud = () => {
    turnLabel.textContent = turn === "player" ? "Your turn" : "Enemy turn";
    if (selected && selected.hp > 0) {
      const name = selected.displayName ? `${selected.displayName} · ` : "";
      apLabel.textContent = `${name}HP ${selected.hp}/${selected.maxHp}  AP ${selected.ap}/${selected.maxAp}`;
    } else {
      apLabel.textContent = "No unit selected. Tap one of your units.";
    }
    const enemyCounts = new Map<string, number>();
    for (const unit of map.units) {
      if (unit.team !== "enemy" || unit.hp <= 0) continue;
      const name = unit.displayName ?? "Enemy";
      enemyCounts.set(name, (enemyCounts.get(name) ?? 0) + 1);
    }
    enemyLabel.textContent = `Hostiles: ${[...enemyCounts].map(([name, count]) => `${count} ${name}`).join(" · ") || "none"}`;
    endTurnBtn.disabled = turn !== "player" || outcome !== null || busy;
    const livePlayers = map.units.filter((u) => u.team === "player" && u.hp > 0);
    const allSpent =
      livePlayers.length > 0 && livePlayers.every((u) => u.ap === 0);
    const showSpentNudge =
      turn === "player" && outcome === null && !busy && allSpent;
    endTurnBtn.textContent = showSpentNudge ? "End Turn (all spent)" : "End Turn";
    endTurnBtn.classList.toggle("pulse-attention", showSpentNudge);
    const canOverwatch =
      turn === "player" &&
      outcome === null &&
      !busy &&
      selected !== null &&
      selected.team === "player" &&
      selected.hp > 0 &&
      selected.ap > 0 &&
      !selected.overwatch;
    overwatchBtn.disabled = !canOverwatch;
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

    if (tappedUnit && tappedUnit.team === "player") {
      selected = tappedUnit;
      redraw();
      return;
    }

    if (!selected || selected.hp <= 0) {
      redraw();
      return;
    }

    if (tappedUnit && tappedUnit.team === "enemy") {
      if (selected.ap < 2) return;
      if (!canShootTarget(map, selected, tappedUnit).canShoot) {
        return;
      }
      selected.ap -= 2;
      const result = resolveShot(map, selected, tappedUnit, random);
      if (result.hit) {
        addFloating(`HIT ${result.damage}`, tappedUnit.x, tappedUnit.y, "#ffd83a");
      } else {
        addFloating("MISS", tappedUnit.x, tappedUnit.y, "#fff");
      }
      if (selected.ap <= 0) selected = null;
      redraw();
      checkOutcome();
      notifyState();
      redraw();
      return;
    }

    const dx = Math.abs(x - selected.x);
    const dy = Math.abs(y - selected.y);
    const moveCost = movementApCost(selected);
    if (dx + dy === 1 && isPassable(map, x, y) && selected.ap >= moveCost) {
      const from = { x: selected.x, y: selected.y };
      selected.x = x;
      selected.y = y;
      selected.ap -= moveCost;
      selected.movesThisTurn = (selected.movesThisTurn ?? 0) + 1;
      selected.peekExposure = null;
      triggerEnemyOverwatchReactions(selected, from, { x, y });
      if (selected.ap <= 0) selected = null;
      notifyState();
      redraw();
    }
  });

  const triggerOverwatchReactions = async (
    enemy: Unit,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    for (const p of map.units) {
      if (p.team !== "player" || p.hp <= 0) continue;
      if (!overwatchShouldFire(map, p, enemy, from, to)) continue;
      p.resolvingOverwatch = true;
      const result = resolveShot(map, p, enemy, random);
      p.resolvingOverwatch = false;
      if (result.hit) {
        addFloating(`HIT ${result.damage}`, enemy.x, enemy.y, "#ffd83a");
      } else {
        addFloating("MISS", enemy.x, enemy.y, "#fff");
      }
      p.overwatch = false;
      redraw();
      checkOutcome();
      notifyState();
      await delay(350);
      if (cancelled) return;
      break;
    }
  };

  const triggerEnemyOverwatchReactions = (
    player: Unit,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    for (const enemy of map.units) {
      if (enemy.team !== "enemy" || enemy.hp <= 0) continue;
      if (!overwatchShouldFire(map, enemy, player, from, to)) continue;
      enemy.resolvingOverwatch = true;
      const result = resolveShot(map, enemy, player, random);
      enemy.resolvingOverwatch = false;
      enemy.overwatch = false;
      addFloating(result.hit ? `HIT ${result.damage}` : "MISS", player.x, player.y, result.hit ? "#ffd83a" : "#fff");
      checkOutcome();
      break;
    }
  };

  const animateEnemyTurn = async () => {
    busy = true;
    updateHud();
    await delay(500);
    if (cancelled) return;
    const enemies = map.units.filter((u) => u.team === "enemy" && u.hp > 0);
    for (const enemy of enemies) {
      if (cancelled) return;
      beginEnemyTurn(map, enemy, aiSession);
      while (enemy.ap > 0 && enemy.hp > 0 && outcome === null) {
        if (cancelled) return;
        const action = takeEnemyAction(map, enemy, aiSession, random);
        if (action.kind === "wait") break;
        if (action.kind === "shoot") {
          if (action.result.hit) {
            addFloating(`HIT ${action.result.damage}`, action.target.x, action.target.y, "#ffd83a");
          } else {
            addFloating("MISS", action.target.x, action.target.y, "#fff");
          }
          redraw();
          checkOutcome();
          notifyState();
          if (outcome !== null) break;
          await delay(350);
          if (cancelled) return;
        } else if (action.kind === "move") {
          redraw();
          await delay(350);
          if (cancelled) return;
          await triggerOverwatchReactions(enemy, action.from, action.to);
          if (cancelled) return;
          notifyState();
          if (outcome !== null) break;
        } else if (action.kind === "overwatch") {
          addFloating("WATCH", enemy.x, enemy.y, "#ff5a5a");
          redraw();
          notifyState();
          break;
        }
      }
      if (outcome !== null) break;
    }
    if (cancelled) return;
    if (outcome === null) {
      turn = "player";
      for (const u of map.units) {
        if (u.team === "player" && u.hp > 0) {
          resetTurnState(u);
        }
      }
      showTurnBanner("player");
    }
    busy = false;
    notifyState();
    redraw();
  };

  overwatchBtn.addEventListener("click", () => {
    if (turn !== "player" || outcome !== null || busy) return;
    if (!selected || selected.team !== "player" || selected.hp <= 0) return;
    if (selected.ap <= 0 || selected.overwatch) return;
    selected.ap = 0;
    selected.overwatch = true;
    selected = null;
    notifyState();
    redraw();
  });

  endTurnBtn.addEventListener("click", () => {
    if (turn !== "player" || outcome !== null || busy) return;
    turn = "enemy";
    for (const u of map.units) {
      if (u.team === "enemy" && u.hp > 0) {
        resetTurnState(u);
      }
    }
    selected = null;
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
    // Always repaint while a match is live so the unit idle bob and other
    // time-based effects (threat pulse, peek lean) stay smooth.
    if (outcome === null) redraw();
    if (outcome === null || floatingTexts.length > 0) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  };
  rafId = requestAnimationFrame(tick);

  const initialPlayer = map.units.find((u) => u.team === "player" && u.hp > 0) ?? null;
  selected = initialPlayer;
  // A saved encounter can contain the killing blow before its completion
  // overlay was acknowledged. Restore that terminal state before accepting
  // input or starting an enemy turn.
  checkOutcome();
  if (!outcome) showTurnBanner(turn);
  redraw();
  notifyState();
  if (!outcome && turn === "enemy") void animateEnemyTurn();

  const resize = () => {
    resizeCanvasForMap(canvas, map);
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
