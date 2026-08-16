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

  it("draws the movement radius as shaded cells inside one bright rim", () => {
    const map = createEmptyMap();
    map.width = 5;
    map.height = 5;
    map.tiles = new Array(25).fill("floor");
    const cell = 40;
    const { ctx, calls } = recordingContext();
    const canvas = {
      style: { width: `${map.width * cell}px`, height: `${map.height * cell}px` },
      width: map.width * cell,
      height: map.height * cell,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const tiles = [
      { x: 2, y: 1, steps: 1, apCost: 1 },
      { x: 1, y: 2, steps: 1, apCost: 1 },
      { x: 3, y: 2, steps: 1, apCost: 1 },
      { x: 2, y: 3, steps: 1, apCost: 1 },
      { x: 2, y: 0, steps: 2, apCost: 1 },
      { x: 0, y: 2, steps: 3, apCost: 2 },
    ];
    draw(canvas, {
      map,
      selected: null,
      moveRange: { originX: 2, originY: 2, tiles },
      highlights: [],
      enemyPreviews: [],
      floatingTexts: [],
    }, 0);

    // One shaded cell per walkable tile: the region is a grid the player can
    // read tile by tile, not a single blurred blob.
    const fills = calls.filter((call) => call.startsWith("fillRect(") && call.endsWith(",32.8,32.8)"));
    expect(fills).toHaveLength(tiles.length);
    // Cheaper tiles are painted more strongly than the ones deeper into the turn.
    const alphas = calls.filter((call) => call.startsWith("globalAlpha="));
    expect(alphas).toContain(`globalAlpha=${PALETTE.MOVE_RANGE_BAND_OPACITY[0]}`);
    expect(alphas).toContain(`globalAlpha=${PALETTE.MOVE_RANGE_BAND_OPACITY[1]}`);
    // The rim and the AP seam are separate strokes with separate weights.
    expect(calls).toContain(`strokeStyle=${PALETTE.MOVE_RANGE_EDGE}`);
    expect(calls).toContain(`strokeStyle=${PALETTE.MOVE_RANGE_BAND_EDGE}`);
    const rimIndex = calls.indexOf(`strokeStyle=${PALETTE.MOVE_RANGE_EDGE}`);
    const seamIndex = calls.indexOf(`strokeStyle=${PALETTE.MOVE_RANGE_BAND_EDGE}`);
    expect(seamIndex).toBeLessThan(rimIndex);
    // The unit's own tile is not part of the region, and its four shared edges
    // with the region are therefore not drawn as rim.
    expect(calls).not.toContain("moveTo(80,80)");
  });

  it("rims only the edge of the turn's reach, never units or cover inside it", () => {
    const map = createEmptyMap();
    map.width = 5;
    map.height = 5;
    map.tiles = new Array(25).fill("floor");
    for (let i = 0; i < 5; i++) {
      setTile(map, i, 0, "wall");
      setTile(map, i, 4, "wall");
      setTile(map, 0, i, "wall");
      setTile(map, 4, i, "wall");
    }
    setTile(map, 2, 2, "half_cover");
    map.units = [
      { id: "mover", team: "player", x: 1, y: 1, hp: 5, maxHp: 5, ap: 4, maxAp: 4, overwatch: false, peekExposure: null },
      { id: "foe", team: "enemy", x: 3, y: 3, hp: 5, maxHp: 5, ap: 4, maxAp: 4, overwatch: false, peekExposure: null },
    ];
    const { ctx, calls } = recordingContext();
    const canvas = {
      style: { width: "200px", height: "200px" },
      width: 200,
      height: 200,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    // Every tile the unit could stand on is inside the region, so the only
    // things bordering it are walls, half cover, and the enemy.
    draw(canvas, {
      map,
      selected: map.units[0],
      moveRange: {
        originX: 1,
        originY: 1,
        tiles: [
          { x: 2, y: 1, steps: 1, apCost: 1 },
          { x: 3, y: 1, steps: 2, apCost: 1 },
          { x: 1, y: 2, steps: 1, apCost: 1 },
          { x: 3, y: 2, steps: 2, apCost: 1 },
          { x: 1, y: 3, steps: 2, apCost: 1 },
          { x: 2, y: 3, steps: 3, apCost: 2 },
        ],
      },
      highlights: [],
      enemyPreviews: [],
      floatingTexts: [],
    }, 0);

    const rimIndex = calls.indexOf(`strokeStyle=${PALETTE.MOVE_RANGE_EDGE}`);
    expect(rimIndex).toBeGreaterThan(-1);
    const rimPath = calls.slice(rimIndex, calls.indexOf("stroke()", rimIndex));
    expect(rimPath.filter((call) => call.startsWith("moveTo("))).toEqual([]);
    // The AP seam between the one- and two-point bands is still drawn.
    const seamIndex = calls.indexOf(`strokeStyle=${PALETTE.MOVE_RANGE_BAND_EDGE}`);
    const seamPath = calls.slice(seamIndex, calls.indexOf("stroke()", seamIndex));
    expect(seamPath.filter((call) => call.startsWith("moveTo(")).length).toBeGreaterThan(0);
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
    expect(calls).not.toContain(`strokeStyle=${PALETTE.MOVE_RANGE_EDGE}`);
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
