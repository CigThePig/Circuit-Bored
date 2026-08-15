import { describe, expect, it } from "vitest";
import { attachTapHandler } from "../src/input.ts";
import { createEmptyMap } from "../src/map.ts";

describe("large-board pointer input", () => {
  it("maps taps across a panned 24x24 canvas to the correct edge tile", () => {
    const listeners = new Map<string, (event: PointerEvent) => void>();
    const captured = new Set<number>();
    const canvas = {
      addEventListener: (name: string, listener: (event: PointerEvent) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 672, height: 672 }),
      setPointerCapture: (id: number) => captured.add(id),
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => captured.delete(id),
    } as unknown as HTMLCanvasElement;
    const map = createEmptyMap();
    map.width = 24;
    map.height = 24;
    map.tiles = new Array(576).fill("floor");
    const taps: Array<{ x: number; y: number }> = [];
    const detach = attachTapHandler(canvas, () => map, (point) => taps.push(point));
    const event = { pointerId: 7, clientX: 10 + 23.5 * 28, clientY: 20 + 22.5 * 28 } as PointerEvent;
    listeners.get("pointerdown")!(event);
    listeners.get("pointerup")!(event);
    expect(taps).toEqual([{ x: 23, y: 22 }]);
    detach();
    expect(listeners.size).toBe(0);
  });
});
