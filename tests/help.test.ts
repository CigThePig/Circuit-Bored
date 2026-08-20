import { describe, expect, it } from "vitest";
import { ACTION_TRAY_ORDER, COMBAT_ACTIONS, type ActionId } from "../src/actions.ts";
import { UNIT_ARCHETYPES } from "../src/content.ts";
import { helpSections, STATUS_HELP, type HelpEntry } from "../src/help.ts";
import { CLOSE_MAX, MEDIUM_MAX } from "../src/range.ts";
import { SeededRng } from "../src/rng.ts";
import { statusLabels, TILES_PER_MOVE_AP } from "../src/rules.ts";
import { generateRoute } from "../src/run.ts";
import { unit } from "./fixtures.ts";

function section(id: string) {
  const found = helpSections().find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No help section '${id}'`);
  return found;
}

function entry(sectionId: string, term: string): HelpEntry {
  const found = section(sectionId).entries.find((candidate) => candidate.term === term);
  if (!found) throw new Error(`No '${term}' entry in the ${sectionId} section`);
  return found;
}

/** Everything the manual says, as one blob, for "is this mentioned at all". */
function allText(): string {
  return helpSections()
    .flatMap((s) => [s.title, s.summary, ...s.entries.flatMap((e) => [e.term, e.meta ?? "", e.detail])])
    .join("\n");
}

describe("field manual structure", () => {
  it("gives every section a unique id, a title, a summary, and entries", () => {
    const sections = helpSections();
    expect(sections.length).toBeGreaterThan(0);
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
    expect(new Set(sections.map((s) => s.title)).size).toBe(sections.length);
    for (const s of sections) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.summary.length).toBeGreaterThan(0);
      expect(s.entries.length).toBeGreaterThan(0);
      for (const e of s.entries) {
        expect(e.term.length).toBeGreaterThan(0);
        expect(e.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("never repeats a term inside one section", () => {
    for (const s of helpSections()) {
      const terms = s.entries.map((e) => e.term);
      expect(new Set(terms).size).toBe(terms.length);
    }
  });
});

/**
 * The point of building the manual from the rule modules is that a retune
 * cannot leave it describing the old game. These are the assertions that would
 * fail if somebody started hand-writing it again.
 */
describe("field manual agrees with the rules", () => {
  it("explains every combat action at its registered cost", () => {
    const actions = section("actions");
    const ids: ActionId[] = ["shoot", ...ACTION_TRAY_ORDER];
    for (const id of ids) {
      const action = COMBAT_ACTIONS[id];
      const found = actions.entries.find((candidate) => candidate.term === action.name);
      expect(found, `${action.name} is missing from the manual`).toBeDefined();
      expect(found!.meta).toContain(`${action.apCost} AP`);
      expect(found!.detail).toBe(action.description);
    }
  });

  it("explains Intel, which is a mode rather than an action", () => {
    expect(entry("actions", "Intel").meta).toContain("free");
  });

  it("describes every operator with its real statistics and role abilities", () => {
    for (const archetype of Object.values(UNIT_ARCHETYPES)) {
      if (archetype.team !== "player") continue;
      const found = entry("squad", archetype.name);
      expect(found.meta).toContain(`${archetype.maxHp} HP`);
      expect(found.meta).toContain(`${archetype.maxAp} AP`);
      expect(found.detail).toContain(archetype.role);
      expect(found.detail).toContain(archetype.counter);
    }
    // Each operator's exclusive actions are named on its own entry, and
    // nobody else's.
    expect(entry("squad", "Rook").detail).toContain(COMBAT_ACTIONS.mark.name);
    expect(entry("squad", "Vex").detail).toContain(COMBAT_ACTIONS.dash.name);
    expect(entry("squad", "Hex").detail).toContain(COMBAT_ACTIONS.brace.name);
    expect(entry("squad", "Hex").detail).not.toContain(COMBAT_ACTIONS.dash.name);
  });

  it("describes every hostile with the reason it is dangerous and what beats it", () => {
    for (const archetype of Object.values(UNIT_ARCHETYPES)) {
      if (archetype.team !== "enemy") continue;
      const found = entry("enemies", archetype.name);
      expect(found.meta).toContain(`${archetype.maxHp} HP`);
      expect(found.detail).toContain(archetype.role);
      expect(found.detail).toContain(archetype.counter);
    }
  });

  it("prints the current band edges", () => {
    expect(entry("range", "Close").meta).toBe(`1–${CLOSE_MAX} tiles`);
    expect(entry("range", "Medium").meta).toBe(`${CLOSE_MAX + 1}–${MEDIUM_MAX} tiles`);
    expect(entry("range", "Long").meta).toBe(`${MEDIUM_MAX + 1}+ tiles`);
  });

  it("prints the current movement rate and route length", () => {
    expect(entry("turn", "Walking").meta).toBe(`${TILES_PER_MOVE_AP} tiles per AP`);
    const route = generateRoute(new SeededRng("TEST"));
    expect(entry("run", "The route").meta).toBe(`${route.length} nodes`);
  });

  it("explains every status code the HUD can print", () => {
    // A unit wearing everything at once, so the assertion is against the
    // labels `statusLabels` actually produces rather than a copy of its list.
    const decorated = unit({ team: "player", x: 0, y: 0, overwatch: true });
    decorated.statuses = {
      aimed: true,
      hunkered: true,
      braced: true,
      dashing: true,
      overwatchEvasion: 1,
      suppressed: 1,
      marked: 1,
      markedBy: "someone",
      guardedBy: "hex",
    };
    const labels = statusLabels(decorated);
    expect(labels.length).toBeGreaterThan(0);
    const states = section("states");
    for (const label of labels) {
      expect(STATUS_HELP[label], `${label} has no manual entry`).toBeDefined();
      expect(states.entries.some((e) => e.term === label)).toBe(true);
    }
    // And nothing explained that the HUD cannot print.
    expect(Object.keys(STATUS_HELP).sort()).toEqual([...labels].sort());
  });

  it("names the board marks a player has to read", () => {
    const text = allText();
    for (const mark of ["Diamonds", "Crosshairs", "hatching", "Chevrons", "Intent banners"]) {
      expect(text).toContain(mark);
    }
  });
});
