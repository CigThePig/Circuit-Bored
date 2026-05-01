import type { GameMap } from "./map.ts";

export type GridPoint = { x: number; y: number };

export type TapHandler = (p: GridPoint) => void;

export function attachTapHandler(
  canvas: HTMLCanvasElement,
  getMap: () => GameMap,
  onTap: TapHandler,
): () => void {
  const handler = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const map = getMap();
    const cell = rect.width / map.width;
    const x = Math.floor(px / cell);
    const y = Math.floor(py / cell);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    onTap({ x, y });
  };

  let downX = 0;
  let downY = 0;
  let isDown = false;

  const onPointerDown = (e: PointerEvent) => {
    isDown = true;
    downX = e.clientX;
    downY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!isDown) return;
    isDown = false;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (Math.hypot(dx, dy) > 12) return;
    handler(e.clientX, e.clientY);
  };
  const onPointerCancel = () => {
    isDown = false;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
  };
}
