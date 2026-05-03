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
  BASE_HIT,
  canShootTarget,
  hasShotLineOfSight,
  overwatchShouldFire,
  resolveShot,
  shotHitPenalty,
} from "./combat.ts";
import { beginEnemyTurn, takeEnemyAction } from "./ai.ts";
import { createAiSession } from "./aiSession.ts";
import { logReport, validateMap } from "./validation.ts";

type Turn = "player" | "enemy";
type Outcome = "victory" | "defeat" | null;

export type RuntimeHandle = {
  destroy: () => void;
  resize: () => void;
};

export function startRuntime(
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
  overlay: HTMLElement,
  overlayText: HTMLElement,
  overlayButton: HTMLButtonElement,
  banner: HTMLElement,
  sourceMap: GameMap,
  onExit: () => void,
): RuntimeHandle {
  const map = cloneMap(sourceMap);
  for (const u of map.units) {
    u.hp = u.maxHp;
    u.ap = u.maxAp;
    u.overwatch = false;
    u.peekExposure = null;
  }

  const startupReport = validateMap(map);
  logReport("runtime startup", startupReport);

  const lifecycle = { cancelled: false };
  const aiSession = createAiSession();

  let selected: Unit | null = null;
  let turn: Turn = "player";
  let outcome: Outcome = null;
  let busy = false;

  const floatingTexts: FloatingText[] = [];

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

  const overwatchBtn = document.createElement("button");
  overwatchBtn.textContent = "Overwatch";

  const endTurnBtn = document.createElement("button");
  endTurnBtn.textContent = "End Turn";
  endTurnBtn.className = "primary";

  const exitBtn = document.createElement("button");
  exitBtn.textContent = "Quit";
  exitBtn.addEventListener("click", () => onExit());

  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(overwatchBtn);
  row.appendChild(endTurnBtn);
  row.appendChild(exitBtn);

  hud.innerHTML = "";
  hud.appendChild(turnLabel);
  hud.appendChild(apLabel);
  hud.appendChild(row);

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
        if (hasShotLineOfSight(map, e.x, e.y, p.x, p.y)) {
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
      if (hasShotLineOfSight(map, selected.x, selected.y, e.x, e.y)) {
        state.sightLines!.push({
          fromX: selected.x,
          fromY: selected.y,
          toX: e.x,
          toY: e.y,
          hasCover: shotHitPenalty(map, selected, e) > 0,
        });
      }
    }
  };

  const computeHighlights = () => {
    state.highlights = [];
    state.enemyPreviews = [];
    if (!selected || turn !== "player") return;
    if (selected.ap >= 1) {
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
        if (!hasShotLineOfSight(map, selected.x, selected.y, u.x, u.y)) continue;
        state.highlights.push({
          x: u.x,
          y: u.y,
          fill: "rgba(255, 80, 80, 0.55)",
          border: "rgba(255, 80, 80, 1)",
        });
        const penalty = shotHitPenalty(map, selected, u);
        const hitChance = Math.max(0, BASE_HIT - penalty);
        state.enemyPreviews.push({
          x: u.x,
          y: u.y,
          hitPct: Math.round(hitChance * 100),
          hasCover: penalty > 0,
        });
      }
    }
  };

  const updateHud = () => {
    turnLabel.textContent = turn === "player" ? "Your turn" : "Enemy turn";
    if (selected && selected.hp > 0) {
      apLabel.textContent = `Selected: HP ${selected.hp}/${selected.maxHp}  AP ${selected.ap}/${selected.maxAp}`;
    } else {
      apLabel.textContent = "No unit selected. Tap one of your units.";
    }
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
    state.selected = selected;
    computeHighlights();
    computeOverlays();
    state.floatingTexts = floatingTexts.filter((t) => t.expiresAt > performance.now());
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
    const playerAlive = map.units.some((u) => u.team === "player" && u.hp > 0);
    const enemyAlive = map.units.some((u) => u.team === "enemy" && u.hp > 0);
    if (!enemyAlive) outcome = "victory";
    else if (!playerAlive) outcome = "defeat";
    if (outcome) {
      overlayText.textContent = outcome === "victory" ? "VICTORY" : "DEFEAT";
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
      const result = resolveShot(map, selected, tappedUnit);
      if (result.hit) {
        addFloating(`HIT ${result.damage}`, tappedUnit.x, tappedUnit.y, "#ffd83a");
      } else {
        addFloating("MISS", tappedUnit.x, tappedUnit.y, "#fff");
      }
      if (selected.ap <= 0) selected = null;
      redraw();
      checkOutcome();
      redraw();
      return;
    }

    const dx = Math.abs(x - selected.x);
    const dy = Math.abs(y - selected.y);
    if (dx + dy === 1 && isPassable(map, x, y) && selected.ap > 0) {
      selected.x = x;
      selected.y = y;
      selected.ap -= 1;
      selected.peekExposure = null;
      if (selected.ap <= 0) selected = null;
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
      const result = resolveShot(map, p, enemy);
      if (result.hit) {
        addFloating(`HIT ${result.damage}`, enemy.x, enemy.y, "#ffd83a");
      } else {
        addFloating("MISS", enemy.x, enemy.y, "#fff");
      }
      p.overwatch = false;
      redraw();
      checkOutcome();
      await delay(350);
      if (lifecycle.cancelled) return;
      break;
    }
  };

  const animateEnemyTurn = async () => {
    busy = true;
    updateHud();
    await delay(500);
    if (lifecycle.cancelled) return;
    const enemies = map.units.filter((u) => u.team === "enemy" && u.hp > 0);
    for (const enemy of enemies) {
      if (lifecycle.cancelled) return;
      beginEnemyTurn(map, enemy, aiSession);
      while (enemy.ap > 0 && enemy.hp > 0 && outcome === null) {
        if (lifecycle.cancelled) return;
        const action = takeEnemyAction(map, enemy, aiSession);
        if (action.kind === "wait") break;
        if (action.kind === "shoot") {
          if (action.result.hit) {
            addFloating(`HIT ${action.result.damage}`, action.target.x, action.target.y, "#ffd83a");
          } else {
            addFloating("MISS", action.target.x, action.target.y, "#fff");
          }
          redraw();
          checkOutcome();
          if (outcome !== null) break;
          await delay(350);
          if (lifecycle.cancelled) return;
        } else if (action.kind === "move") {
          redraw();
          await delay(350);
          if (lifecycle.cancelled) return;
          await triggerOverwatchReactions(enemy, action.from, action.to);
          if (lifecycle.cancelled) return;
          if (outcome !== null) break;
        }
      }
      if (outcome !== null) break;
    }
    if (lifecycle.cancelled) return;
    if (outcome === null) {
      turn = "player";
      for (const u of map.units) {
        if (u.team === "player" && u.hp > 0) {
          u.ap = u.maxAp;
          u.overwatch = false;
          u.peekExposure = null;
        }
      }
      showTurnBanner("player");
    }
    busy = false;
    redraw();
  };

  overwatchBtn.addEventListener("click", () => {
    if (turn !== "player" || outcome !== null || busy) return;
    if (!selected || selected.team !== "player" || selected.hp <= 0) return;
    if (selected.ap <= 0 || selected.overwatch) return;
    selected.ap = 0;
    selected.overwatch = true;
    redraw();
  });

  endTurnBtn.addEventListener("click", () => {
    if (turn !== "player" || outcome !== null || busy) return;
    turn = "enemy";
    for (const u of map.units) {
      if (u.team === "enemy" && u.hp > 0) {
        u.ap = u.maxAp;
        u.peekExposure = null;
      }
    }
    selected = null;
    showTurnBanner("enemy");
    redraw();
    void animateEnemyTurn();
  });

  overlayButton.onclick = () => {
    overlay.classList.add("hidden");
    onExit();
  };

  let rafId = 0;
  const tick = () => {
    let needRedraw = false;
    if (floatingTexts.length > 0) {
      const now = performance.now();
      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        if (floatingTexts[i].expiresAt <= now) floatingTexts.splice(i, 1);
      }
      needRedraw = true;
    }
    if (
      turn === "player" &&
      outcome === null &&
      (state.threatMarkers?.length ?? 0) > 0
    ) {
      needRedraw = true;
    }
    if (needRedraw) redraw();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const initialPlayer = map.units.find((u) => u.team === "player" && u.hp > 0) ?? null;
  selected = initialPlayer;
  showTurnBanner("player");
  redraw();

  const resize = () => {
    resizeCanvasForMap(canvas, map);
    redraw();
  };

  return {
    destroy: () => {
      lifecycle.cancelled = true;
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
