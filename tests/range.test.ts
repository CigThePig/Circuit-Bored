import { describe, expect, it } from "vitest";
import {
  CLOSE_MAX,
  MEDIUM_MAX,
  bandTargetDistance,
  preferredBand,
  rangeAccuracy,
  rangeBandBetween,
  rangeBandForDistance,
  rangeDamage,
  rangeRating,
  tileDistance,
} from "../src/range.ts";
import { previewShot, resolveShot, SHOT_DAMAGE } from "../src/combat.ts";
import { UNIT_ARCHETYPES } from "../src/content.ts";
import { buildMap } from "./fixtures.ts";
import { makeArchetypeUnit, type UnitArchetypeId } from "../src/content.ts";

describe("range bands", () => {
  it("uses the same eight-way metric movement does", () => {
    expect(tileDistance({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(3);
    expect(tileDistance({ x: 0, y: 0 }, { x: 2, y: 5 })).toBe(5);
  });

  it("splits the board into three bands on documented boundaries", () => {
    expect(rangeBandForDistance(1)).toBe("close");
    expect(rangeBandForDistance(CLOSE_MAX)).toBe("close");
    expect(rangeBandForDistance(CLOSE_MAX + 1)).toBe("medium");
    expect(rangeBandForDistance(MEDIUM_MAX)).toBe("medium");
    expect(rangeBandForDistance(MEDIUM_MAX + 1)).toBe("long");
  });

  it("reads a profile's modifiers per band and nowhere else", () => {
    const profile = {
      closeAccuracy: 0.2,
      mediumAccuracy: 0,
      longAccuracy: -0.3,
      closeDamage: 1,
      longDamage: 0,
    };
    expect(rangeAccuracy(profile, "close")).toBe(0.2);
    expect(rangeAccuracy(profile, "long")).toBe(-0.3);
    expect(rangeDamage(profile, "close")).toBe(1);
    // Medium never carries a damage modifier: it is the neutral band.
    expect(rangeDamage(profile, "medium")).toBe(0);
  });

  it("treats a unit with no profile as unaffected by distance", () => {
    for (const band of ["close", "medium", "long"] as const) {
      expect(rangeAccuracy(undefined, band)).toBe(0);
      expect(rangeDamage(undefined, band)).toBe(0);
      expect(rangeRating(undefined, band)).toBe("even");
    }
  });

  it("names the band each archetype wants the fight to happen in", () => {
    expect(preferredBand(UNIT_ARCHETYPES.runner.profile)).toBe("close");
    expect(preferredBand(UNIT_ARCHETYPES.scrapper.profile)).toBe("close");
    expect(preferredBand(UNIT_ARCHETYPES.marksman.profile)).toBe("long");
    expect(preferredBand(UNIT_ARCHETYPES.operator.profile)).toBe("medium");
    expect(preferredBand(UNIT_ARCHETYPES.bulwark.profile)).toBe("medium");
    expect(preferredBand(UNIT_ARCHETYPES.sentinel.profile)).toBe("medium");
  });

  it("keeps the Rifleman a flat benchmark with no range identity at all", () => {
    for (const band of ["close", "medium", "long"] as const) {
      expect(rangeRating(UNIT_ARCHETYPES.rifleman.profile, band)).toBe("even");
    }
  });

  it("puts each band's ideal distance inside that band", () => {
    for (const band of ["close", "medium", "long"] as const) {
      expect(rangeBandForDistance(bandTargetDistance(band))).toBe(band);
    }
  });
});

/** Two units of the given archetypes `distance` tiles apart on open ground. */
function lane(
  shooterId: UnitArchetypeId,
  targetId: UnitArchetypeId,
  distance: number,
) {
  const width = distance + 3;
  const map = buildMap([".".repeat(width)]);
  const shooter = makeArchetypeUnit(shooterId, "shooter", 1, 0);
  const target = makeArchetypeUnit(targetId, "target", 1 + distance, 0);
  map.units.push(shooter, target);
  return { map, shooter, target };
}

describe("range in the shot model", () => {
  it("reports the band and distance of every shot", () => {
    const { map, shooter, target } = lane("operator", "rifleman", 6);
    const preview = previewShot(map, shooter, target);
    expect(preview.distance).toBe(6);
    expect(preview.band).toBe("medium");
    expect(rangeBandBetween(shooter, target)).toBe("medium");
  });

  it("makes Vex lethal up close and poor at long range", () => {
    const close = lane("runner", "rifleman", 2);
    const long = lane("runner", "rifleman", 11);
    const closeHit = previewShot(close.map, close.shooter, close.target).hitChance;
    const longHit = previewShot(long.map, long.shooter, long.target).hitChance;
    expect(closeHit).toBeGreaterThan(longHit + 0.3);
  });

  it("makes the Marksman the mirror image of that", () => {
    const close = lane("marksman", "operator", 2);
    const long = lane("marksman", "operator", 11);
    const closePreview = previewShot(close.map, close.shooter, close.target);
    const longPreview = previewShot(long.map, long.shooter, long.target);
    // 0.70 up close against 0.98 down a lane: the accuracy ceiling caps the
    // gap, so the claim is a large swing rather than an exact one.
    expect(longPreview.hitChance).toBeGreaterThan(closePreview.hitChance + 0.25);
    // And it hits harder out there, which is what makes a long lane its lane.
    expect(longPreview.damage).toBeGreaterThan(closePreview.damage);
  });

  it("gives the Scrapper extra damage only inside close range", () => {
    const close = lane("scrapper", "operator", 2);
    const medium = lane("scrapper", "operator", 6);
    expect(previewShot(close.map, close.shooter, close.target).damage)
      .toBeGreaterThan(previewShot(medium.map, medium.shooter, medium.target).damage);
  });

  it("leaves the Rifleman's shot identical at every distance", () => {
    const hits = [2, 6, 11].map((d) => {
      const { map, shooter, target } = lane("rifleman", "operator", d);
      const preview = previewShot(map, shooter, target);
      return { hit: preview.hitChance, damage: preview.damage };
    });
    expect(new Set(hits.map((h) => h.hit)).size).toBe(1);
    expect(new Set(hits.map((h) => h.damage)).size).toBe(1);
    expect(hits[0].damage).toBe(SHOT_DAMAGE);
  });

  it("never makes an operator useless outside its band", () => {
    // A weak band should cost accuracy, not remove the option. Every archetype
    // must keep a real chance to hit at every distance.
    for (const id of Object.keys(UNIT_ARCHETYPES) as UnitArchetypeId[]) {
      for (const distance of [2, 6, 11]) {
        const { map, shooter, target } = lane(id, "rifleman", distance);
        const preview = previewShot(map, shooter, target);
        expect(preview.shot.canShoot, `${id} at ${distance}`).toBe(true);
        expect(preview.hitChance, `${id} at ${distance}`).toBeGreaterThan(0.3);
        expect(preview.damage, `${id} at ${distance}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("resolves the same damage the preview promised at every band", () => {
    for (const distance of [2, 6, 11]) {
      const { map, shooter, target } = lane("marksman", "operator", distance);
      const preview = previewShot(map, shooter, target);
      const before = target.hp;
      const result = resolveShot(map, shooter, target, () => 0);
      expect(result.hit).toBe(true);
      expect(result.damage).toBe(preview.damage);
      expect(before - target.hp).toBe(preview.damage);
    }
  });
});
