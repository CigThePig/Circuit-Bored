import { describe, expect, it } from "vitest";
import { environmentVariant } from "../src/render.ts";

describe("procedural environment art", () => {
  it("is deterministic and supplies multiple readable variants per tile role", () => {
    expect(environmentVariant("floor", 4, 7)).toBe(environmentVariant("floor", 4, 7));

    const coordinates = Array.from({ length: 144 }, (_, index) => ({
      x: index % 12,
      y: Math.floor(index / 12),
    }));
    const floor = new Set(coordinates.map(({ x, y }) => environmentVariant("floor", x, y)));
    const wall = new Set(coordinates.map(({ x, y }) => environmentVariant("wall", x, y)));
    const cover = new Set(coordinates.map(({ x, y }) => environmentVariant("half_cover", x, y)));

    expect(floor).toEqual(new Set(["deck", "service_hatch", "vent", "conduit"]));
    expect(wall).toEqual(new Set(["bulkhead", "pipe_bank", "system_panel"]));
    expect(cover).toEqual(new Set(["cargo", "barricade", "machinery"]));
  });
});
