import { describe, expect, it } from "vitest";
import { environmentVariant, resizeCanvasForMap } from "../src/render.ts";
import { createEmptyMap } from "../src/map.ts";

describe("procedural environment art", () => {
  it("keeps ordinary floor deterministic and deliberately quieter than tactical objects", () => {
    expect(environmentVariant("floor", 4, 7)).toBe(environmentVariant("floor", 4, 7));

    const coordinates = Array.from({ length: 144 }, (_, index) => ({
      x: index % 12,
      y: Math.floor(index / 12),
    }));
    const floor = new Set(coordinates.map(({ x, y }) => environmentVariant("floor", x, y, "industrial")));
    const wall = new Set(coordinates.map(({ x, y }) => environmentVariant("wall", x, y, "industrial")));
    const cover = new Set(coordinates.map(({ x, y }) => environmentVariant("half_cover", x, y, "industrial")));

    expect(floor).toEqual(new Set(["deck", "service_hatch"]));
    expect(floor.has("conduit")).toBe(false);
    expect(wall).toEqual(new Set(["bulkhead", "pipe_bank", "system_panel"]));
    expect(cover).toEqual(new Set(["cargo", "barricade", "machinery"]));
  });

  it("uses coherent, non-overlapping terrain families for each theme", () => {
    const coordinates = Array.from({ length: 576 }, (_, index) => ({ x: index % 24, y: Math.floor(index / 24) }));
    const family = (themeId: "industrial" | "data_core" | "derelict") => new Set(
      (["floor", "wall", "half_cover"] as const).flatMap((tile) =>
        coordinates.map(({ x, y }) => environmentVariant(tile, x, y, themeId))
      ),
    );
    const industrial = family("industrial");
    const dataCore = family("data_core");
    const derelict = family("derelict");
    expect(industrial.size).toBe(8);
    expect(dataCore.size).toBe(8);
    expect(derelict.size).toBe(9);
    expect([...dataCore]).not.toContain("illuminated_strip");
    expect([...derelict]).not.toContain("exposed_conduit");
    expect([...industrial].filter((variant) => dataCore.has(variant))).toEqual([]);
    expect([...dataCore].filter((variant) => derelict.has(variant))).toEqual([]);
  });

  it("keeps 24x24 encounters at the documented 28 px readable minimum", () => {
    const previousWindow = (globalThis as { window?: Window }).window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { innerWidth: 360, devicePixelRatio: 2 },
    });
    const transforms: number[][] = [];
    const canvas = {
      style: { width: "", height: "" },
      width: 0,
      height: 0,
      getContext: () => ({ setTransform: (...args: number[]) => transforms.push(args) }),
    } as unknown as HTMLCanvasElement;
    const map = createEmptyMap();
    map.width = 24;
    map.height = 24;
    map.tiles = new Array(576).fill("floor");
    try {
      expect(resizeCanvasForMap(canvas, map, 28)).toBe(28);
      expect(canvas.style.width).toBe("672px");
      expect(canvas.style.height).toBe("672px");
      expect(canvas.width).toBe(1344);
      expect(transforms.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
      else delete (globalThis as { window?: Window }).window;
    }
  });

  it("fits large editor maps instead of applying the encounter cell-size minimum", () => {
    const previousWindow = (globalThis as { window?: Window }).window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { innerWidth: 480, devicePixelRatio: 2 },
    });
    const canvas = {
      style: { width: "", height: "" },
      width: 0,
      height: 0,
      getContext: () => ({ setTransform: () => undefined }),
    } as unknown as HTMLCanvasElement;
    const map = createEmptyMap();
    map.width = 128;
    map.height = 128;
    map.tiles = new Array(128 * 128).fill("floor");
    try {
      expect(resizeCanvasForMap(canvas, map)).toBe(3);
      expect(canvas.style.width).toBe("384px");
      expect(canvas.style.height).toBe("384px");
      expect(canvas.width).toBe(768);
      expect(canvas.height).toBe(768);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
      else delete (globalThis as { window?: Window }).window;
    }
  });
});
