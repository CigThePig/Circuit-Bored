import {
  cloneMap,
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
  COVER_PENALTY,
  hasLineOfSight,
  resolveShot,
  targetHasCover,
} from "./combat.ts";
import { takeEnemyAction } from "./ai.ts";

type Turn = "player" | "enemy";
type Outcome = "victory" | "defeat" | null;

export type RuntimeHandle = {
  destroy: () => void;
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
  }

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
        if (!hasLineOfSight(map, selected.x, selected.y, u.x, u.y)) continue;
        state.highlights.push({
          x: u.x,
          y: u.y,
          fill: "rgba(255, 80, 80, 0.55)",
          border: "rgba(255, 80, 80, 1)",
        });
        const hasCover = targetHasCover(map, selected, u);
        const hitChance = Math.max(0, BASE_HIT - (hasCover ? COVER_PENALTY : 0));
        state.enemyPreviews.push({
          x: u.x,
          y: u.y,
          hitPct: Math.round(hitChance * 100),
          hasCover,
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
    state.floatingTexts = floatingTexts.filter((t) => t.expiresAt > performance.now());
    draw(canvas, state);
    updateHud();
  };

  let bannerFadeTimer = 0;
  let bannerHideTimer = 0;
  const showTurnBanner = (text: string) => {
    clearTimeout(bannerFadeTimer);
    clearTimeout(bannerHideTimer);
    banner.textContent = text;
    banner.classList.remove("hidden", "fade");
    bannerFadeTimer = window.setTimeout(() => {
      banner.classList.add("fade");
    }, 600);
    bannerHideTimer = window.setTimeout(() => {
      banner.classList.add("hidden");
    }, 1100);
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
      overlay.classList.remove("hidden");
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
      if (!hasLineOfSight(map, selected.x, selected.y, tappedUnit.x, tappedUnit.y)) {
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
      if (selected.ap <= 0) selected = null;
      redraw();
    }
  });

  const enemySeesAnyPlayer = (enemy: Unit): boolean => {
    for (const p of map.units) {
      if (p.team !== "player" || p.hp <= 0) continue;
      if (hasLineOfSight(map, enemy.x, enemy.y, p.x, p.y)) return true;
    }
    return false;
  };

  const triggerOverwatchReactions = async (
    enemy: Unit,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    for (const p of map.units) {
      if (p.team !== "player" || p.hp <= 0 || !p.overwatch) continue;
      const sawBefore = hasLineOfSight(map, p.x, p.y, from.x, from.y);
      const seesNow = hasLineOfSight(map, p.x, p.y, to.x, to.y);
      if (sawBefore || !seesNow) continue;
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
      break;
    }
  };

  const animateEnemyTurn = async () => {
    busy = true;
    updateHud();
    const canShootThisTurn = new Map<string, boolean>();
    for (const enemy of map.units) {
      if (enemy.team !== "enemy" || enemy.hp <= 0) continue;
      canShootThisTurn.set(enemy.id, enemySeesAnyPlayer(enemy));
    }
    await delay(500);
    const enemies = map.units.filter((u) => u.team === "enemy" && u.hp > 0);
    for (const enemy of enemies) {
      while (enemy.ap > 0 && enemy.hp > 0 && outcome === null) {
        const canShoot = canShootThisTurn.get(enemy.id) ?? false;
        const action = takeEnemyAction(map, enemy, canShoot);
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
        } else if (action.kind === "move") {
          redraw();
          await delay(350);
          await triggerOverwatchReactions(enemy, action.from, action.to);
          if (outcome !== null) break;
        }
      }
      if (outcome !== null) break;
    }
    if (outcome === null) {
      turn = "player";
      for (const u of map.units) {
        if (u.team === "player" && u.hp > 0) {
          u.ap = u.maxAp;
          u.overwatch = false;
        }
      }
      showTurnBanner("PLAYER TURN");
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
      if (u.team === "enemy" && u.hp > 0) u.ap = u.maxAp;
    }
    selected = null;
    showTurnBanner("ENEMY TURN");
    redraw();
    void animateEnemyTurn();
  });

  overlayButton.onclick = () => {
    overlay.classList.add("hidden");
    onExit();
  };

  let rafId = 0;
  const tick = () => {
    if (floatingTexts.length > 0) {
      const now = performance.now();
      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        if (floatingTexts[i].expiresAt <= now) floatingTexts.splice(i, 1);
      }
      redraw();
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const initialPlayer = map.units.find((u) => u.team === "player" && u.hp > 0) ?? null;
  selected = initialPlayer;
  showTurnBanner("PLAYER TURN");
  redraw();

  return {
    destroy: () => {
      detachTap();
      cancelAnimationFrame(rafId);
      clearTimeout(bannerFadeTimer);
      clearTimeout(bannerHideTimer);
      banner.classList.add("hidden");
      banner.classList.remove("fade");
      hud.innerHTML = "";
      overlay.classList.add("hidden");
      overlayButton.onclick = null;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
