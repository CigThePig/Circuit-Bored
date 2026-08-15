import { describe, expect, it } from "vitest";
import { revealUnitInBoardViewport } from "../src/boardViewport.ts";

describe("board viewport", () => {
  it("centers a right-edge initial player spawn in the visible board viewport", () => {
    const viewport = {
      clientWidth: 360,
      clientHeight: 480,
      scrollWidth: 672,
      scrollHeight: 672,
      scrollLeft: 0,
      scrollTop: 0,
    };
    revealUnitInBoardViewport(viewport, { style: { width: "672px", height: "672px" } }, { width: 24, height: 24 }, { x: 19, y: 12 });
    expect(viewport.scrollLeft).toBe(312);
    expect(viewport.scrollTop).toBe(110);
  });

  it("reveals a bottom-edge spawn when the board has a short vertical viewport", () => {
    const viewport = {
      clientWidth: 360,
      clientHeight: 240,
      scrollWidth: 672,
      scrollHeight: 672,
      scrollLeft: 0,
      scrollTop: 0,
    };
    revealUnitInBoardViewport(viewport, { style: { width: "672px", height: "672px" } }, { width: 24, height: 24 }, { x: 19, y: 19 });
    expect(viewport.scrollLeft).toBe(312);
    expect(viewport.scrollTop).toBe(426);
  });

  it("leaves the viewport at a legal edge for an already visible spawn", () => {
    const viewport = {
      clientWidth: 480,
      clientHeight: 480,
      scrollWidth: 672,
      scrollHeight: 672,
      scrollLeft: 192,
      scrollTop: 192,
    };
    revealUnitInBoardViewport(viewport, { style: { width: "672px", height: "672px" } }, { width: 24, height: 24 }, { x: 2, y: 2 });
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0);
  });
});
