import { describe, expect, it } from "vitest";
import { draw, environmentVariant, resizeCanvasForMap, type RenderState } from "../src/render.ts";
import {
  accentIntensity,
  drawLandmarkArt,
  landmarkArtKinds,
  MAX_ACCENT_INTENSITY,
} from "../src/renderLandmarks.ts";
import { LANDMARK_KINDS, type MapEnvironment } from "../src/environment.ts";
import { PALETTE } from "../src/renderPalette.ts";
import { createEmptyMap, setTile, type GameMap } from "../src/map.ts";
import { generateEncounter } from "../src/generation.ts";
import { createRun } from "../src/run.ts";
import { SeededRng } from "../src/rng.ts";
import { LEVEL_THEME_IDS } from "../src/themes.ts";

/**
 * A canvas stub that records both the drawing calls and the style changes the
 * renderer makes, plus the clip regions it establishes. The point is to prove
 * *where* artwork can land and that it is a pure function of the timestamp,
 * not to compare rasterized images.
 */
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  clipGroups: { x: number; y: number; w: number; h: number }[][];
} {
  const calls: string[] = [];
  const clipGroups: { x: number; y: number; w: number; h: number }[][] = [];
  let pending: { x: number; y: number; w: number; h: number }[] = [];
  const style: Record<string, unknown> = {
    globalAlpha: 1,
    lineWidth: 1,
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  const gradient = { addColorStop: () => undefined };
  const overrides: Record<string, unknown> = {
    canvas: { width: 0, height: 0 },
    beginPath: () => { pending = []; },
    rect: (x: number, y: number, w: number, h: number) => {
      pending.push({ x, y, w, h });
      calls.push(`rect(${x},${y},${w},${h})`);
    },
    clip: () => { clipGroups.push([...pending]); calls.push("clip()"); },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy({}, {
    get(_target, property) {
      const key = String(property);
      if (key in overrides) return overrides[key];
      if (key in style) return style[key];
      return (...args: unknown[]) => {
        calls.push(`${key}(${args.map((value) => String(value)).join(",")})`);
      };
    },
    set(_target, property, value) {
      style[String(property)] = value;
      calls.push(`${String(property)}=${String(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, clipGroups };
}

type CapturedDiamond = {
  centre: { x: number; y: number };
  radius: number;
  fill: number;
  edge: number;
};

/**
 * Draws a movement radius onto a bare floor board and reads back the diamond
 * each tile produced, in draw order.
 */
function captureMoveDiamonds(
  tiles: { x: number; y: number; steps: number; apCost: number }[],
  cell: number,
): CapturedDiamond[] {
  const width = Math.max(...tiles.map((tile) => tile.x)) + 2;
  const height = Math.max(...tiles.map((tile) => tile.y)) + 2;
  const map = createEmptyMap();
  map.width = width;
  map.height = height;
  map.tiles = new Array(width * height).fill("floor");
  const { ctx, calls } = recordingContext();
  const canvas = {
    style: { width: `${width * cell}px`, height: `${height * cell}px` },
    width: width * cell,
    height: height * cell,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  draw(canvas, {
    map,
    selected: null,
    moveRange: { originX: 0, originY: 0, tiles },
    highlights: [],
    enemyPreviews: [],
    floatingTexts: [],
  }, 0);

  const start = calls.indexOf(`fillStyle=${PALETTE.MOVE_RANGE}`);
  expect(start).toBeGreaterThan(-1);
  const number = "(-?[\\d.]+)";
  const out: CapturedDiamond[] = [];
  for (let i = start; i < calls.length; i++) {
    const top = new RegExp(`^moveTo\\(${number},${number}\\)$`).exec(calls[i]);
    const right = new RegExp(`^lineTo\\(${number},${number}\\)$`).exec(calls[i + 1] ?? "");
    if (!top || !right) continue;
    const alphas = calls
      .slice(i, i + 12)
      .filter((call) => call.startsWith("globalAlpha="))
      .map((call) => Number(call.slice("globalAlpha=".length)));
    out.push({
      centre: { x: Number(top[1]), y: Number(right[2]) },
      radius: Number(right[1]) - Number(top[1]),
      fill: alphas[0],
      edge: alphas[1],
    });
  }
  return out;
}

function landmarkFixture(kindIndex: number): { map: GameMap; environment: MapEnvironment } {
  const map = createEmptyMap();
  map.width = 8;
  map.height = 8;
  map.tiles = new Array(64).fill("floor");
  map.themeId = "industrial";
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 5; x++) setTile(map, x, y, "wall");
  }
  setTile(map, 3, 5, "half_cover");
  const environment: MapEnvironment = {
    featureBudget: { major: 1, secondary: 0, minor: 0 },
    profile: "heavy",
    landmarks: [{
      id: "fixture",
      name: "Fixture",
      kind: LANDMARK_KINDS[kindIndex],
      importance: "dominant",
      rect: { x: 1, y: 1, width: 6, height: 6 },
      orientation: "s",
      variant: kindIndex % 4,
      ambient: "furnace_pulse",
    }],
    floorZones: [],
  };
  map.environment = environment;
  return { map, environment };
}

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

  it("draws bespoke artwork for every landmark family", () => {
    expect(new Set(landmarkArtKinds())).toEqual(new Set(LANDMARK_KINDS));
    for (let index = 0; index < LANDMARK_KINDS.length; index++) {
      const { map } = landmarkFixture(index);
      const { ctx, calls } = recordingContext();
      drawLandmarkArt(ctx, map, 40, 0);
      expect(calls.length, `${LANDMARK_KINDS[index]} drew nothing`).toBeGreaterThan(0);
    }
  });

  it("confines landmark artwork to tiles that already block movement", () => {
    for (let index = 0; index < LANDMARK_KINDS.length; index++) {
      const { map } = landmarkFixture(index);
      const { ctx, clipGroups } = recordingContext();
      drawLandmarkArt(ctx, map, 40, 0);
      // The first clip is the footprint mask. Every later clip can only
      // narrow it, so this single check bounds all of the artwork.
      expect(clipGroups.length).toBeGreaterThan(0);
      for (const rect of clipGroups[0]) {
        const tileX = Math.round(rect.x / 40);
        const tileY = Math.round(rect.y / 40);
        // Artwork may only claim wall tiles: never floor, never half cover.
        expect(map.tiles[tileY * map.width + tileX]).toBe("wall");
      }
    }
  });

  it("caps ambient accents below the value of a unit", () => {
    // Visual review measured an uncapped furnace mouth and core glow rendering
    // brighter than the brightest unit pixel, which inverts the readability
    // hierarchy at squint. Every glow now goes through one clamp.
    expect(MAX_ACCENT_INTENSITY).toBeLessThanOrEqual(0.5);
    expect(accentIntensity(0.95)).toBe(MAX_ACCENT_INTENSITY);
    expect(accentIntensity(1)).toBe(MAX_ACCENT_INTENSITY);
    expect(accentIntensity(0.3)).toBeCloseTo(0.3);
    expect(accentIntensity(-2)).toBe(0);
    expect(accentIntensity(Number.NaN)).toBe(0);

    // No landmark family may set a canvas alpha above the ceiling while it is
    // drawing, whatever ambient phase it happens to be in.
    for (let index = 0; index < LANDMARK_KINDS.length; index++) {
      const { map } = landmarkFixture(index);
      for (const time of [0, 480, 960, 1900, 2600]) {
        const { ctx, calls } = recordingContext();
        drawLandmarkArt(ctx, map, 40, time);
        const alphas = calls
          .filter((call) => call.startsWith("globalAlpha="))
          .map((call) => Number(call.slice("globalAlpha=".length)));
        for (const alpha of alphas) {
          expect(alpha, `${LANDMARK_KINDS[index]} set globalAlpha ${alpha} at t=${time}`)
            .toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keeps landmark artwork deterministic and free of ambient drift when frozen", () => {
    const { map } = landmarkFixture(0);
    const first = recordingContext();
    const second = recordingContext();
    drawLandmarkArt(first.ctx, map, 40, 0, { animate: false });
    drawLandmarkArt(second.ctx, map, 40, 9_999_999, { animate: false });
    expect(second.calls).toEqual(first.calls);

    // With ambient motion enabled the same landmark must still be a pure
    // function of the timestamp.
    const a = recordingContext();
    const b = recordingContext();
    drawLandmarkArt(a.ctx, map, 40, 1234);
    drawLandmarkArt(b.ctx, map, 40, 1234);
    expect(b.calls).toEqual(a.calls);
    const later = recordingContext();
    drawLandmarkArt(later.ctx, map, 40, 1234 + 900);
    expect(later.calls).not.toEqual(a.calls);
  });

  it("skips landmark artwork entirely in the semantic diagnostic view", () => {
    const run = createRun("RENDER-SEMANTIC");
    const map = generateEncounter(new SeededRng("render-semantic"), 5, "final", run.squad, [], { themeId: "industrial" });
    const base: RenderState = {
      map,
      selected: null,
      highlights: [],
      enemyPreviews: [],
      floatingTexts: [],
    };
    const semantic = recordingContext();
    const canvas = {
      style: { width: `${map.width * 40}px`, height: `${map.height * 40}px` },
      width: map.width * 40,
      height: map.height * 40,
      getContext: () => semantic.ctx,
    } as unknown as HTMLCanvasElement;
    draw(canvas, { ...base, terrainDiagnostic: true }, 0);
    // The semantic view is a category readout: it must never clip to landmark
    // masses, because that is the artwork path.
    expect(semantic.clipGroups).toHaveLength(0);
  });

  it("renders landmark art for every generated theme without touching legacy maps", () => {
    const run = createRun("RENDER-THEMES");
    for (const themeId of LEVEL_THEME_IDS) {
      const map = generateEncounter(new SeededRng(`render-${themeId}`), 5, "final", run.squad, [], { themeId });
      const { ctx, calls } = recordingContext();
      drawLandmarkArt(ctx, map, 40, 0);
      expect(calls.length).toBeGreaterThan(0);
    }
    // A map saved before this pass has no environment at all and must simply
    // draw nothing rather than throw.
    const legacy = createEmptyMap();
    const { ctx, calls } = recordingContext();
    expect(() => drawLandmarkArt(ctx, legacy, 40, 0)).not.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("draws one move diamond per reachable tile, shrinking as the walk costs more", () => {
    const cell = 40;
    const tiles = [
      { x: 2, y: 1, steps: 1, apCost: 1 },
      { x: 1, y: 2, steps: 1, apCost: 1 },
      { x: 3, y: 2, steps: 2, apCost: 1 },
      { x: 2, y: 3, steps: 3, apCost: 2 },
      { x: 0, y: 2, steps: 5, apCost: 3 },
    ];
    const diamonds = captureMoveDiamonds(tiles, cell);

    expect(diamonds).toHaveLength(tiles.length);
    // The diamond keeps its shape and its tile centre; only its size changes.
    for (const diamond of diamonds) {
      const tile = tiles[diamonds.indexOf(diamond)];
      expect(diamond.centre).toEqual({ x: tile.x * cell + cell / 2, y: tile.y * cell + cell / 2 });
    }
    const radiusFor = (apCost: number) =>
      diamonds[tiles.findIndex((tile) => tile.apCost === apCost)].radius;
    expect(radiusFor(1)).toBeGreaterThan(radiusFor(2));
    expect(radiusFor(2)).toBeGreaterThan(radiusFor(3));
    expect(radiusFor(1)).toBeCloseTo(cell * PALETTE.MOVE_NEAR_RADIUS, 5);
    expect(radiusFor(3)).toBeCloseTo(cell * PALETTE.MOVE_FAR_RADIUS, 5);
    // Fill and outline fade along the same ramp the size follows.
    const fillFor = (apCost: number) =>
      diamonds[tiles.findIndex((tile) => tile.apCost === apCost)].fill;
    expect(fillFor(1)).toBeGreaterThan(fillFor(2));
    expect(fillFor(2)).toBeGreaterThan(fillFor(3));
  });

  it("keeps the ramp legible whether a unit has few action points or many", () => {
    const cell = 28;
    const ramps = [3, 5, 8].map((maxAp) => {
      const tiles = Array.from({ length: maxAp }, (_, i) => ({
        x: i + 1,
        y: 1,
        steps: (i + 1) * 2,
        apCost: i + 1,
      }));
      return captureMoveDiamonds(tiles, cell).map((diamond) => diamond.radius);
    });

    for (const radii of ramps) {
      // Every ramp spans the same range, so the cheapest tile always reads as
      // the biggest diamond and the last one stays visible at the 28 px
      // mobile minimum instead of collapsing to a dot.
      expect(radii[0]).toBeCloseTo(cell * PALETTE.MOVE_NEAR_RADIUS, 5);
      expect(radii[radii.length - 1]).toBeCloseTo(cell * PALETTE.MOVE_FAR_RADIUS, 5);
      expect(radii[radii.length - 1]).toBeGreaterThan(2);
      for (let i = 1; i < radii.length; i++) {
        expect(radii[i]).toBeLessThan(radii[i - 1]);
      }
    }
  });

  it("gives a free first move the full-strength diamond", () => {
    // ghost_step makes the opening tiles cost nothing; they must read as the
    // cheapest band rather than sharing a size with one-point tiles.
    const diamonds = captureMoveDiamonds([
      { x: 1, y: 1, steps: 1, apCost: 0 },
      { x: 2, y: 1, steps: 3, apCost: 1 },
    ], 40);
    expect(diamonds[0].radius).toBeGreaterThan(diamonds[1].radius);
    expect(diamonds[0].radius).toBeCloseTo(40 * PALETTE.MOVE_NEAR_RADIUS, 5);
  });

  it("leaves the board untouched when there is no movement radius", () => {
    const map = createEmptyMap();
    map.width = 3;
    map.height = 3;
    map.tiles = new Array(9).fill("floor");
    const { ctx, calls } = recordingContext();
    const canvas = {
      style: { width: "120px", height: "120px" },
      width: 120,
      height: 120,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    draw(canvas, {
      map,
      selected: null,
      moveRange: { originX: 1, originY: 1, tiles: [] },
      highlights: [],
      enemyPreviews: [],
      floatingTexts: [],
    }, 0);
    expect(calls).not.toContain(`fillStyle=${PALETTE.MOVE_RANGE}`);
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
