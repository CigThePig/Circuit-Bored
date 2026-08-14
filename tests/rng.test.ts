import { describe, expect, it } from "vitest";
import { SeededRng, hashSeed } from "../src/rng.ts";

describe("SeededRng", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = new SeededRng("NEON-42");
    const b = new SeededRng("NEON-42");
    expect(Array.from({ length: 20 }, () => a.next()))
      .toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it("diverges for different seeds", () => {
    const a = new SeededRng("NEON-42");
    const b = new SeededRng("NEON-43");
    expect(Array.from({ length: 8 }, () => a.next()))
      .not.toEqual(Array.from({ length: 8 }, () => b.next()));
  });

  it("resumes exactly from a serialized state", () => {
    const original = new SeededRng("resume-me");
    original.next();
    original.next();
    const resumed = new SeededRng(original.snapshot().state);
    expect(resumed.next()).toBe(original.next());
    expect(hashSeed("resume-me")).toBe(hashSeed("resume-me"));
  });
});
