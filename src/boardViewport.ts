import type { GameMap, Unit } from "./map.ts";

/**
 * Centers an initial selection in the board scroller without coupling combat
 * state to the DOM. Call this after the canvas has been sized for its map.
 */
export function revealUnitInBoardViewport(
  viewport: Pick<HTMLElement, "clientWidth" | "clientHeight" | "scrollWidth" | "scrollHeight" | "scrollLeft" | "scrollTop">,
  canvas: { style: Pick<CSSStyleDeclaration, "width" | "height"> },
  map: Pick<GameMap, "width" | "height">,
  unit: Pick<Unit, "x" | "y">,
): void {
  const canvasWidth = Number.parseFloat(canvas.style.width);
  const canvasHeight = Number.parseFloat(canvas.style.height);
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || map.width <= 0 || map.height <= 0) return;

  const unitCenterX = (unit.x + 0.5) * (canvasWidth / map.width);
  const unitCenterY = (unit.y + 0.5) * (canvasHeight / map.height);
  viewport.scrollLeft = clamp(unitCenterX - viewport.clientWidth / 2, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth));
  viewport.scrollTop = clamp(unitCenterY - viewport.clientHeight / 2, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
