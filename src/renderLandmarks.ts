import {
  landmarkAmbient,
  landmarkOrientation,
  landmarkVariant,
  type LandmarkAmbient,
  type LandmarkImportance,
  type LandmarkKind,
  type LandmarkOrientation,
  type MapLandmark,
  type MapRect,
} from "./environment.ts";
import { getTile, type GameMap } from "./map.ts";
import { PALETTE, TERRAIN_PALETTES, type TerrainPalette } from "./renderPalette.ts";
import { levelThemeId } from "./themes.ts";

/**
 * Bespoke landmark artwork.
 *
 * The board renderer paints tiles; this module paints the *objects* those
 * tiles belong to. A landmark is drawn as one multi-tile machine, chamber, or
 * wreck rather than as a set of decorated squares.
 *
 * The readability contract is enforced structurally rather than by discipline:
 *
 * - Object artwork is clipped to the wall tiles inside the footprint, so it
 *   can never make walkable floor look blocked.
 * - Half-cover tiles are excluded from every clip, so a cover silhouette is
 *   never absorbed into a landmark.
 * - Floor artwork is limited to a soft contact shadow at the object's base.
 *   Regional floor treatment stays the renderer's job.
 *
 * Everything is deterministic: geometry comes from the map, and animation is a
 * pure function of the frame timestamp.
 */

export type LandmarkArtOptions = {
  /** Ambient motion is skipped for still review shots and semantic diagnostics. */
  animate?: boolean;
};

type Cluster = MapRect & { tiles: number };

type Brush = {
  ctx: CanvasRenderingContext2D;
  map: GameMap;
  cell: number;
  rect: MapRect;
  palette: TerrainPalette;
  orientation: LandmarkOrientation;
  variant: number;
  importance: LandmarkImportance;
  /** Connected wall masses inside the footprint, largest first. */
  clusters: Cluster[];
  /** Ambient value in 0..1 for this landmark's family. */
  pulse: number;
  /** True during the short "on" window of a blinking family. */
  blink: boolean;
  /** Monotonic 0..1 sawtooth for travelling detail. */
  drift: number;
  noise: (index: number) => number;
};

const AXIS_HORIZONTAL: Record<LandmarkOrientation, boolean> = { n: false, s: false, e: true, w: true };

function hashNoise(a: number, b: number): number {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A stable numeric identity so two landmarks never animate in lockstep. */
function landmarkSeed(landmark: MapLandmark): number {
  let hash = 2166136261;
  for (let index = 0; index < landmark.id.length; index++) {
    hash ^= landmark.id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 997;
}

/** Low-frequency, family-specific ambient values. */
function ambientValues(
  ambient: LandmarkAmbient,
  nowMs: number,
  seed: number,
  animate: boolean,
): { pulse: number; blink: boolean; drift: number } {
  if (!animate || ambient === "none") return { pulse: 0.55, blink: false, drift: 0 };
  const offset = seed * 37;
  const wave = (periodMs: number) =>
    0.5 + 0.5 * Math.sin(((nowMs + offset) / periodMs) * Math.PI * 2);
  const saw = (periodMs: number) => (((nowMs + offset) % periodMs) + periodMs) % periodMs / periodMs;
  switch (ambient) {
    case "furnace_pulse":
      return { pulse: 0.45 + 0.55 * wave(2600), blink: false, drift: saw(5200) };
    case "coolant_shimmer":
      return { pulse: 0.35 + 0.4 * wave(3400), blink: false, drift: saw(6400) };
    case "conveyor_drift":
      return { pulse: 0.5, blink: false, drift: saw(2400) };
    case "beacon_blink":
      return { pulse: 0.5, blink: saw(1900) < 0.16, drift: saw(1900) };
    case "server_flicker":
      return { pulse: 0.5 + 0.3 * wave(4200), blink: false, drift: saw(3600) };
    case "data_flow":
      return { pulse: 0.5 + 0.3 * wave(3000), blink: false, drift: saw(2800) };
    case "spark_burst": {
      const cycle = saw(2300);
      return { pulse: cycle < 0.09 ? 1 : 0.2, blink: cycle < 0.06, drift: cycle };
    }
    case "unstable_flicker": {
      const cycle = saw(3100);
      return { pulse: cycle < 0.12 || (cycle > 0.4 && cycle < 0.45) ? 0.9 : 0.25, blink: cycle < 0.08, drift: cycle };
    }
    default:
      return { pulse: 0.55, blink: false, drift: 0 };
  }
}

/** Connected wall masses inside a footprint, as tile-space bounding boxes. */
function solidClusters(map: GameMap, rect: MapRect): Cluster[] {
  const seen = new Set<string>();
  const clusters: Cluster[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const key = `${x},${y}`;
      if (seen.has(key) || getTile(map, x, y) !== "wall") continue;
      const queue = [{ x, y }];
      seen.add(key);
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let tiles = 0;
      while (queue.length > 0) {
        const current = queue.pop()!;
        tiles += 1;
        minX = Math.min(minX, current.x);
        maxX = Math.max(maxX, current.x);
        minY = Math.min(minY, current.y);
        maxY = Math.max(maxY, current.y);
        for (const step of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
          const next = { x: current.x + step.x, y: current.y + step.y };
          if (next.x < rect.x || next.y < rect.y) continue;
          if (next.x >= rect.x + rect.width || next.y >= rect.y + rect.height) continue;
          const nextKey = `${next.x},${next.y}`;
          if (seen.has(nextKey) || getTile(map, next.x, next.y) !== "wall") continue;
          seen.add(nextKey);
          queue.push(next);
        }
      }
      clusters.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, tiles });
    }
  }
  return clusters.sort((a, b) => b.tiles - a.tiles);
}

/**
 * Clips to the wall tiles of a footprint, minus the raised lip that the tile
 * renderer draws on every edge facing walkable space. Artwork therefore lands
 * on the *top face* of the structure: the bright player-facing lip and the
 * dark occlusion edge that make a wall read as impassable survive untouched,
 * while interior tile boundaries stay open so the object reads as one mass.
 *
 * Returns false when the footprint contains no solid tiles.
 */
function clipSolid(ctx: CanvasRenderingContext2D, map: GameMap, rect: MapRect, cell: number): boolean {
  const lip = Math.max(3, Math.round(cell * 0.12));
  let any = false;
  ctx.beginPath();
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (getTile(map, x, y) !== "wall") continue;
      const north = getTile(map, x, y - 1) === "wall" ? 0 : lip;
      const west = getTile(map, x - 1, y) === "wall" ? 0 : lip;
      const south = getTile(map, x, y + 1) === "wall" ? 0 : lip;
      const east = getTile(map, x + 1, y) === "wall" ? 0 : lip;
      ctx.rect(x * cell + west, y * cell + north, cell - west - east, cell - north - south);
      any = true;
    }
  }
  if (any) ctx.clip();
  return any;
}

/**
 * A soft contact shadow on the floor at the object's lit-away edges. This is
 * the only floor pixel the artwork owns, and it is what makes a landmark read
 * as a single raised object instead of as decorated tiles.
 */
function drawContactShadow(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  rect: MapRect,
  cell: number,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
  const depth = Math.max(1, cell * 0.16);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (getTile(map, x, y) !== "wall") continue;
      if (getTile(map, x, y + 1) === "floor") ctx.fillRect(x * cell, (y + 1) * cell, cell, depth);
      if (getTile(map, x + 1, y) === "floor") ctx.fillRect((x + 1) * cell, y * cell, depth, cell);
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Shared drawing primitives, expressed in tile units.
 * ------------------------------------------------------------------ */

function px(brush: Brush, tileX: number): number {
  return tileX * brush.cell;
}

function body(brush: Brush, area: MapRect, fill: string, inset = 0.06): void {
  const { ctx, cell } = brush;
  ctx.fillStyle = fill;
  ctx.fillRect(
    px(brush, area.x + inset),
    px(brush, area.y + inset),
    (area.width - inset * 2) * cell,
    (area.height - inset * 2) * cell,
  );
}

function outline(brush: Brush, area: MapRect, color: string, width = 0.05): void {
  const { ctx, cell } = brush;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width * cell);
  ctx.strokeRect(px(brush, area.x + 0.08), px(brush, area.y + 0.08), (area.width - 0.16) * cell, (area.height - 0.16) * cell);
}

/** Evenly spaced structural ribs across a mass. */
function ribs(brush: Brush, area: MapRect, horizontal: boolean, spacing: number, color: string, weight = 0.05): void {
  const { ctx, cell } = brush;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, weight * cell);
  ctx.beginPath();
  const span = horizontal ? area.height : area.width;
  for (let offset = spacing / 2; offset < span; offset += spacing) {
    if (horizontal) {
      ctx.moveTo(px(brush, area.x), px(brush, area.y + offset));
      ctx.lineTo(px(brush, area.x + area.width), px(brush, area.y + offset));
    } else {
      ctx.moveTo(px(brush, area.x + offset), px(brush, area.y));
      ctx.lineTo(px(brush, area.x + offset), px(brush, area.y + area.height));
    }
  }
  ctx.stroke();
}

function capsule(brush: Brush, area: MapRect, fill: string, rim: string): void {
  const { ctx, cell } = brush;
  const vertical = area.height >= area.width;
  const radius = (vertical ? area.width : area.height) * 0.5 * cell * 0.9;
  const x = px(brush, area.x + 0.12);
  const y = px(brush, area.y + 0.12);
  const w = (area.width - 0.24) * cell;
  const h = (area.height - 0.24) * cell;
  ctx.beginPath();
  const r = Math.min(radius, Math.min(w, h) / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.stroke();
}

function glowDot(brush: Brush, tileX: number, tileY: number, radius: number, color: string, intensity: number): void {
  const { ctx, cell } = brush;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, intensity));
  ctx.shadowColor = color;
  ctx.shadowBlur = cell * 0.4;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px(brush, tileX), px(brush, tileY), radius * cell, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Hazard chevrons, used on machine skirts and dock edges. */
function chevronBand(brush: Brush, area: MapRect, horizontal: boolean, offset: number): void {
  const { ctx, cell, palette } = brush;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px(brush, area.x), px(brush, area.y), area.width * cell, area.height * cell);
  ctx.clip();
  // Warning paint is worn, not fluorescent: it must never out-value a unit.
  ctx.globalAlpha = 0.52;
  const step = 0.9;
  const span = (horizontal ? area.width : area.height) + step * 2;
  for (let index = -2; index * step < span; index++) {
    ctx.fillStyle = index % 2 === 0 ? palette.hazardA : palette.hazardB;
    const start = (horizontal ? area.x : area.y) + index * step + offset * step;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(px(brush, start), px(brush, area.y + area.height));
      ctx.lineTo(px(brush, start + step), px(brush, area.y + area.height));
      ctx.lineTo(px(brush, start + step * 1.6), px(brush, area.y));
      ctx.lineTo(px(brush, start + step * 0.6), px(brush, area.y));
    } else {
      ctx.moveTo(px(brush, area.x + area.width), px(brush, start));
      ctx.lineTo(px(brush, area.x + area.width), px(brush, start + step));
      ctx.lineTo(px(brush, area.x), px(brush, start + step * 1.6));
      ctx.lineTo(px(brush, area.x), px(brush, start + step * 0.6));
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** An irregular slab. Used everywhere the derelict family needs damage. */
function jaggedSlab(brush: Brush, area: MapRect, seed: number, fill: string, stroke: string): void {
  const { ctx } = brush;
  const points = 7;
  ctx.beginPath();
  for (let index = 0; index < points; index++) {
    const angle = (index / points) * Math.PI * 2;
    const wobble = 0.62 + hashNoise(seed, index) * 0.42;
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const tx = cx + Math.cos(angle) * (area.width / 2) * wobble;
    const ty = cy + Math.sin(angle) * (area.height / 2) * wobble;
    if (index === 0) ctx.moveTo(px(brush, tx), px(brush, ty));
    else ctx.lineTo(px(brush, tx), px(brush, ty));
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, brush.cell * 0.045);
  ctx.stroke();
}

/**
 * The solid tile closest to the centre of an area's working face. Face artwork
 * (a furnace mouth, a vault door) has to land on structure, never in the
 * doorway the layout deliberately left open. The scan walks a couple of tiles
 * inward so it also finds the face of a body that is inset from its footprint.
 */
function faceAnchor(
  map: GameMap,
  area: MapRect,
  orientation: LandmarkOrientation,
): { x: number; y: number } | null {
  const horizontal = AXIS_HORIZONTAL[orientation];
  const start = horizontal ? area.y : area.x;
  const span = horizontal ? area.height : area.width;
  const centre = start + (span - 1) / 2;
  const depthLimit = Math.min(3, horizontal ? area.width : area.height);
  for (let depth = 0; depth < depthLimit; depth++) {
    const fixed = orientation === "n" ? area.y + depth
      : orientation === "s" ? area.y + area.height - 1 - depth
      : orientation === "w" ? area.x + depth
      : area.x + area.width - 1 - depth;
    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (let offset = 0; offset < span; offset++) {
      const along = start + offset;
      const x = horizontal ? fixed : along;
      const y = horizontal ? along : fixed;
      if (getTile(map, x, y) !== "wall") continue;
      const distance = Math.abs(along - centre);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = { x: x + 0.5, y: y + 0.5 };
    }
    if (best) return best;
  }
  return null;
}

/**
 * A structural fragment that failed. Small derelict masses get their own
 * damage language — chipped corners and a split — so a two-tile remnant never
 * reads as a tidy brick.
 */
function damagedFragment(brush: Brush, cluster: Cluster, seed: number, fill: string): void {
  const { ctx } = brush;
  body(brush, cluster, fill, 0.02);
  outline(brush, cluster, "rgba(0,0,0,.6)", 0.05);
  ctx.save();
  ctx.fillStyle = "rgba(4,5,4,.85)";
  for (let notch = 0; notch < 2; notch++) {
    const corner = Math.floor(hashNoise(seed, notch) * 4);
    const size = 0.3 + hashNoise(notch, seed) * 0.4;
    const cx = corner % 2 === 0 ? cluster.x : cluster.x + cluster.width;
    const cy = corner < 2 ? cluster.y : cluster.y + cluster.height;
    ctx.beginPath();
    ctx.moveTo(px(brush, cx), px(brush, cy));
    ctx.lineTo(px(brush, cx + (corner % 2 === 0 ? size : -size)), px(brush, cy));
    ctx.lineTo(px(brush, cx), px(brush, cy + (corner < 2 ? size : -size)));
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(0,0,0,.55)";
  ctx.lineWidth = Math.max(1, brush.cell * 0.06);
  ctx.beginPath();
  const horizontal = cluster.width >= cluster.height;
  const split = 0.25 + hashNoise(seed + 3, 1) * 0.5;
  if (horizontal) {
    ctx.moveTo(px(brush, cluster.x + cluster.width * split), px(brush, cluster.y));
    ctx.lineTo(px(brush, cluster.x + cluster.width * split + 0.35), px(brush, cluster.y + cluster.height));
  } else {
    ctx.moveTo(px(brush, cluster.x), px(brush, cluster.y + cluster.height * split));
    ctx.lineTo(px(brush, cluster.x + cluster.width), px(brush, cluster.y + cluster.height * split + 0.35));
  }
  ctx.stroke();
  ctx.restore();
}

/** The face of a cluster that points at the landmark's declared orientation. */
function faceBand(cluster: Cluster, orientation: LandmarkOrientation, depth: number): MapRect {
  if (orientation === "n") return { x: cluster.x, y: cluster.y, width: cluster.width, height: depth };
  if (orientation === "s") {
    return { x: cluster.x, y: cluster.y + cluster.height - depth, width: cluster.width, height: depth };
  }
  if (orientation === "w") return { x: cluster.x, y: cluster.y, width: depth, height: cluster.height };
  return { x: cluster.x + cluster.width - depth, y: cluster.y, width: depth, height: cluster.height };
}

/* ------------------------------------------------------------------ *
 * Industrial Processing Foundry
 * ------------------------------------------------------------------ */

function drawFurnace(brush: Brush): void {
  const { palette, orientation, pulse } = brush;
  const main = brush.clusters[0];
  if (!main) return;
  const horizontal = AXIS_HORIZONTAL[orientation];
  body(brush, main, palette.machineryFill, 0.02);
  // Heavy structural ribbing: a dark groove with a lit edge, spaced widely so
  // the mass still reads as one machine at 28 px.
  ribs(brush, main, !horizontal, 1.0, "rgba(0,0,0,.5)", 0.16);
  ribs(brush, main, !horizontal, 1.0, "rgba(190,214,224,.22)", 0.035);
  outline(brush, main, "rgba(255,255,255,.12)", 0.05);

  // The hazard skirt sits a tile inside the working face, where there is
  // always solid mass to carry it.
  const skirt: MapRect = horizontal
    ? {
        x: orientation === "e" ? main.x + main.width - 0.95 : main.x + 0.35,
        y: main.y + 0.2,
        width: 0.6,
        height: main.height - 0.4,
      }
    : {
        x: main.x + 0.2,
        y: orientation === "s" ? main.y + main.height - 0.95 : main.y + 0.35,
        width: main.width - 0.4,
        height: 0.6,
      };
  brush.ctx.save();
  brush.ctx.globalAlpha = 0.5;
  chevronBand(brush, skirt, !horizontal, 0);
  brush.ctx.restore();

  // The mouth: a wide charging door that washes heat across the skirt.
  const anchor = faceAnchor(brush.map, brush.rect, orientation);
  if (anchor) {
    const inward = orientation === "n" ? 0.55 : orientation === "s" ? -0.55 : 0;
    const inwardX = orientation === "w" ? 0.55 : orientation === "e" ? -0.55 : 0;
    const cx = anchor.x + inwardX;
    const cy = anchor.y + inward;
    const width = horizontal ? 0.7 : 1.7;
    const height = horizontal ? 1.7 : 0.7;
    brush.ctx.save();
    brush.ctx.shadowColor = "#ff7a2a";
    brush.ctx.shadowBlur = brush.cell * (0.8 + pulse * 1.4);
    brush.ctx.fillStyle = `rgba(255, ${Math.round(96 + pulse * 96)}, 34, ${0.62 + pulse * 0.35})`;
    brush.ctx.fillRect(px(brush, cx - width / 2), px(brush, cy - height / 2), width * brush.cell, height * brush.cell);
    brush.ctx.fillStyle = `rgba(255, 240, 200, ${0.24 + pulse * 0.5})`;
    brush.ctx.fillRect(
      px(brush, cx - width * 0.28),
      px(brush, cy - height * 0.28),
      width * brush.cell * 0.56,
      height * brush.cell * 0.56,
    );
    brush.ctx.restore();
  }

  // Flue stacks at the back of the machine.
  const back = faceBand(main, orientation === "n" ? "s" : orientation === "s" ? "n" : orientation === "e" ? "w" : "e", 1);
  for (const fraction of [0.28, 0.72]) {
    const stack: MapRect = horizontal
      ? { x: back.x + 0.18, y: back.y + back.height * fraction - 0.35, width: 0.64, height: 0.7 }
      : { x: back.x + back.width * fraction - 0.35, y: back.y + 0.18, width: 0.7, height: 0.64 };
    capsule(brush, stack, palette.wallPipe, palette.wallPipeHi);
  }
  glowDot(brush, main.x + main.width - 0.4, main.y + 0.4, 0.08, palette.wallLight, 0.3 + pulse * 0.55);
}

function drawCoolantTanks(brush: Brush): void {
  const { palette, pulse } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    if (cluster.tiles <= 2 && cluster.width <= 1 && cluster.height <= 1) continue;
    const isPipe = cluster.width === 1 || cluster.height === 1;
    if (isPipe) {
      body(brush, cluster, palette.wallPipe, 0.26);
      ribs(brush, cluster, cluster.width > cluster.height, 1, palette.wallPipeHi, 0.03);
      continue;
    }
    capsule(brush, cluster, palette.machineryFill, palette.machineryTop);
    // Coolant level: a bright band that breathes slowly inside the vessel.
    const level = 0.42 + pulse * 0.16;
    const vertical = cluster.height >= cluster.width;
    brush.ctx.save();
    brush.ctx.globalAlpha = 0.5 + pulse * 0.3;
    brush.ctx.fillStyle = palette.coolant;
    if (vertical) {
      brush.ctx.fillRect(
        px(brush, cluster.x + 0.3),
        px(brush, cluster.y + cluster.height * (1 - level) - 0.1),
        (cluster.width - 0.6) * brush.cell,
        Math.max(2, brush.cell * 0.16),
      );
    } else {
      brush.ctx.fillRect(
        px(brush, cluster.x + cluster.width * level),
        px(brush, cluster.y + 0.3),
        Math.max(2, brush.cell * 0.16),
        (cluster.height - 0.6) * brush.cell,
      );
    }
    brush.ctx.restore();
    ribs(brush, cluster, vertical, 1.15, "rgba(0,0,0,.30)", 0.06);
    glowDot(brush, cluster.x + cluster.width - 0.42, cluster.y + 0.42, 0.075, palette.coolant, 0.35 + brush.noise(index) * 0.4);
  }
}

function drawProcessingLine(brush: Brush): void {
  const { palette, drift } = brush;
  const spine = brush.clusters[0];
  if (!spine) return;
  for (const cluster of brush.clusters) {
    const horizontal = cluster.width >= cluster.height;
    if (cluster !== spine && cluster.tiles <= 4) {
      // Machine heads: drums that sit astride the belt.
      capsule(brush, cluster, palette.machineryFill, palette.machineryTop);
      ribs(brush, cluster, !horizontal, 0.5, "rgba(0,0,0,.34)", 0.05);
      continue;
    }
    body(brush, cluster, palette.machineryFill, 0.04);
    // The belt itself, with travelling cleats that make the line read as
    // machinery in motion rather than as a wall.
    const belt: MapRect = horizontal
      ? { x: cluster.x, y: cluster.y + cluster.height * 0.28, width: cluster.width, height: cluster.height * 0.44 }
      : { x: cluster.x + cluster.width * 0.28, y: cluster.y, width: cluster.width * 0.44, height: cluster.height };
    body(brush, belt, "rgba(6,10,14,.72)", 0);
    brush.ctx.save();
    brush.ctx.strokeStyle = palette.wallPipeHi;
    brush.ctx.lineWidth = Math.max(1, brush.cell * 0.055);
    brush.ctx.globalAlpha = 0.7;
    brush.ctx.beginPath();
    const span = horizontal ? cluster.width : cluster.height;
    for (let offset = -1 + drift; offset < span; offset += 0.85) {
      if (horizontal) {
        brush.ctx.moveTo(px(brush, cluster.x + offset), px(brush, belt.y + 0.04));
        brush.ctx.lineTo(px(brush, cluster.x + offset + 0.22), px(brush, belt.y + belt.height - 0.04));
      } else {
        brush.ctx.moveTo(px(brush, belt.x + 0.04), px(brush, cluster.y + offset));
        brush.ctx.lineTo(px(brush, belt.x + belt.width - 0.04), px(brush, cluster.y + offset + 0.22));
      }
    }
    brush.ctx.stroke();
    brush.ctx.restore();
    // Roller frames at both rails.
    ribs(brush, cluster, !horizontal, 0.85, "rgba(0,0,0,.34)", 0.045);
    outline(brush, cluster, palette.wallBracket, 0.035);
  }
}

function drawLoadingBay(brush: Brush): void {
  const { palette, blink } = brush;
  for (const cluster of brush.clusters) {
    const horizontal = cluster.width >= cluster.height;
    body(brush, cluster, palette.wallMid, 0.05);
    // Dock doors: repeated shuttered panels on the back wall.
    const count = Math.max(1, Math.floor((horizontal ? cluster.width : cluster.height) / 2));
    for (let index = 0; index < count; index++) {
      const door: MapRect = horizontal
        ? { x: cluster.x + 0.25 + index * 2, y: cluster.y + 0.2, width: 1.5, height: cluster.height - 0.4 }
        : { x: cluster.x + 0.2, y: cluster.y + 0.25 + index * 2, width: cluster.width - 0.4, height: 1.5 };
      body(brush, door, "rgba(4,9,13,.55)", 0);
      ribs(brush, door, horizontal, 0.28, "rgba(190,220,230,.16)", 0.03);
      outline(brush, door, palette.wallBracket, 0.03);
    }
    // A hazard bumper runs the length of the dock face.
    chevronBand(brush, horizontal
      ? { x: cluster.x, y: cluster.y + cluster.height - 0.42, width: cluster.width, height: 0.42 }
      : { x: cluster.x + cluster.width - 0.42, y: cluster.y, width: 0.42, height: cluster.height },
      horizontal, 0);
    glowDot(
      brush,
      cluster.x + cluster.width - 0.3,
      cluster.y + 0.3,
      0.08,
      blink ? PALETTE.HAZARD_YELLOW : palette.wallLight,
      blink ? 0.95 : 0.28,
    );
  }
}

function drawPipeManifold(brush: Brush): void {
  const { palette } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    const horizontal = cluster.width >= cluster.height;
    body(brush, cluster, palette.wallPipe, 0.04);
    // Bundled runs along the length of the mass, with collar bands across it.
    ribs(brush, cluster, horizontal, 0.42, "rgba(0,0,0,.45)", 0.14);
    ribs(brush, cluster, horizontal, 0.42, palette.wallPipeHi, 0.03);
    ribs(brush, cluster, !horizontal, 1.6, palette.machineryTop, 0.09);
    // Valve wheels mark the manifold as plumbing, not as a bunker.
    const wheels = Math.max(1, Math.min(3, Math.floor(Math.max(cluster.width, cluster.height) / 2)));
    for (let wheel = 0; wheel < wheels; wheel++) {
      const fraction = (wheel + 0.5) / wheels;
      const cx = horizontal ? cluster.x + cluster.width * fraction : cluster.x + cluster.width * 0.5;
      const cy = horizontal ? cluster.y + cluster.height * 0.5 : cluster.y + cluster.height * fraction;
      brush.ctx.strokeStyle = palette.machineryTop;
      brush.ctx.lineWidth = Math.max(1, brush.cell * 0.07);
      brush.ctx.beginPath();
      brush.ctx.arc(px(brush, cx), px(brush, cy), brush.cell * 0.26, 0, Math.PI * 2);
      brush.ctx.stroke();
      brush.ctx.beginPath();
      brush.ctx.moveTo(px(brush, cx - 0.26), px(brush, cy));
      brush.ctx.lineTo(px(brush, cx + 0.26), px(brush, cy));
      brush.ctx.moveTo(px(brush, cx), px(brush, cy - 0.26));
      brush.ctx.lineTo(px(brush, cx), px(brush, cy + 0.26));
      brush.ctx.stroke();
    }
    if (index === 0) glowDot(brush, cluster.x + 0.45, cluster.y + 0.45, 0.06, palette.coolant, 0.32);
  }
}

function drawCraneGantry(brush: Brush): void {
  const { palette, drift, blink } = brush;
  for (const cluster of brush.clusters) {
    const horizontal = cluster.width >= cluster.height;
    const isRail = Math.min(cluster.width, cluster.height) === 1 && Math.max(cluster.width, cluster.height) >= 4;
    body(brush, cluster, isRail ? palette.wallPipe : palette.machineryFill, 0.08);
    if (isRail) {
      // Rail with a trolley that creeps along it.
      ribs(brush, cluster, !horizontal, 0.55, "rgba(0,0,0,.4)", 0.05);
      const travel = horizontal
        ? { x: cluster.x + 0.4 + drift * Math.max(0, cluster.width - 1.8), y: cluster.y + 0.15, width: 1, height: 0.7 }
        : { x: cluster.x + 0.15, y: cluster.y + 0.4 + drift * Math.max(0, cluster.height - 1.8), width: 0.7, height: 1 };
      body(brush, travel, palette.machineryTop, 0.04);
      outline(brush, travel, "rgba(0,0,0,.6)", 0.04);
      glowDot(brush, travel.x + travel.width / 2, travel.y + travel.height / 2, 0.06,
        blink ? PALETTE.HAZARD_YELLOW : palette.wallLight, blink ? 0.95 : 0.25);
    } else {
      // Lattice legs.
      outline(brush, cluster, palette.machineryTop, 0.05);
      brush.ctx.save();
      brush.ctx.strokeStyle = "rgba(0,0,0,.45)";
      brush.ctx.lineWidth = Math.max(1, brush.cell * 0.07);
      brush.ctx.beginPath();
      const span = horizontal ? cluster.width : cluster.height;
      for (let offset = 0; offset < span; offset += 0.7) {
        if (horizontal) {
          brush.ctx.moveTo(px(brush, cluster.x + offset), px(brush, cluster.y));
          brush.ctx.lineTo(px(brush, cluster.x + offset + 0.7), px(brush, cluster.y + cluster.height));
          brush.ctx.moveTo(px(brush, cluster.x + offset + 0.7), px(brush, cluster.y));
          brush.ctx.lineTo(px(brush, cluster.x + offset), px(brush, cluster.y + cluster.height));
        } else {
          brush.ctx.moveTo(px(brush, cluster.x), px(brush, cluster.y + offset));
          brush.ctx.lineTo(px(brush, cluster.x + cluster.width), px(brush, cluster.y + offset + 0.7));
          brush.ctx.moveTo(px(brush, cluster.x), px(brush, cluster.y + offset + 0.7));
          brush.ctx.lineTo(px(brush, cluster.x + cluster.width), px(brush, cluster.y + offset));
        }
      }
      brush.ctx.stroke();
      brush.ctx.restore();
    }
  }
}

/* ------------------------------------------------------------------ *
 * Data Core Security Complex
 * ------------------------------------------------------------------ */

function drawRackCluster(brush: Brush, cluster: Cluster, index: number, density: number): void {
  const { palette, pulse } = brush;
  const horizontal = cluster.width >= cluster.height;
  body(brush, cluster, palette.machineryFill, 0.1);
  outline(brush, cluster, palette.wallBracket, 0.035);
  const count = Math.max(2, Math.round((horizontal ? cluster.width : cluster.height) * density));
  for (let led = 0; led < count; led++) {
    const fraction = (led + 0.5) / count;
    const lit = hashNoise(index * 31 + led, Math.floor(brush.drift * 6)) > 0.45;
    const tx = horizontal ? cluster.x + cluster.width * fraction : cluster.x + cluster.width * 0.5;
    const ty = horizontal ? cluster.y + cluster.height * 0.5 : cluster.y + cluster.height * fraction;
    brush.ctx.save();
    brush.ctx.globalAlpha = lit ? 0.5 + pulse * 0.45 : 0.16;
    brush.ctx.fillStyle = palette.floorLight;
    const w = horizontal ? 0.12 : 0.44;
    const h = horizontal ? 0.44 : 0.12;
    brush.ctx.fillRect(px(brush, tx - w / 2), px(brush, ty - h / 2), w * brush.cell, h * brush.cell);
    brush.ctx.restore();
  }
}

function drawServerVault(brush: Brush): void {
  const { palette, orientation, pulse } = brush;
  // A doored compartment splits into several boundary masses, so "the shell"
  // is every large piece, not just the biggest one.
  const shellTiles = Math.max(4, Math.round(brush.clusters[0]?.tiles ?? 0) / 3);
  for (const [index, cluster] of brush.clusters.entries()) {
    if (cluster.tiles >= shellTiles) continue;
    drawRackCluster(brush, cluster, index, 0.9);
  }
  for (const cluster of brush.clusters) {
    if (cluster.tiles < shellTiles) continue;
    // Armoured containment: doubled plate with a fine structural grid.
    body(brush, cluster, palette.wallMid, 0.04);
    outline(brush, cluster, "rgba(215,242,248,.30)", 0.06);
    ribs(brush, cluster, true, 1.0, "rgba(0,0,0,.3)", 0.035);
    ribs(brush, cluster, false, 1.0, "rgba(0,0,0,.3)", 0.035);
  }
  // A blast door on the working face, always landing on solid structure. The
  // opening itself must stay walkable, so the door reads as a retracted leaf
  // beside the threshold rather than as a slab across it.
  const anchor = faceAnchor(brush.map, brush.rect, orientation);
  if (!anchor) return;
  const cx = anchor.x;
  const cy = anchor.y;
  brush.ctx.save();
  brush.ctx.fillStyle = palette.wallBase;
  brush.ctx.beginPath();
  brush.ctx.arc(px(brush, cx), px(brush, cy), brush.cell * 0.62, 0, Math.PI * 2);
  brush.ctx.fill();
  brush.ctx.strokeStyle = palette.wallBracket;
  brush.ctx.lineWidth = Math.max(1, brush.cell * 0.09);
  brush.ctx.stroke();
  brush.ctx.lineWidth = Math.max(1, brush.cell * 0.05);
  for (let spoke = 0; spoke < 6; spoke++) {
    const angle = (spoke / 6) * Math.PI * 2 + 0.3;
    brush.ctx.beginPath();
    brush.ctx.moveTo(px(brush, cx) + Math.cos(angle) * brush.cell * 0.2, px(brush, cy) + Math.sin(angle) * brush.cell * 0.2);
    brush.ctx.lineTo(px(brush, cx) + Math.cos(angle) * brush.cell * 0.55, px(brush, cy) + Math.sin(angle) * brush.cell * 0.55);
    brush.ctx.stroke();
  }
  brush.ctx.restore();
  glowDot(brush, cx, cy, 0.11, palette.floorLight, 0.35 + pulse * 0.45);
}

function drawDataCore(brush: Brush): void {
  const { palette, pulse, drift } = brush;
  // The containment ring breaks into cardinal segments, so the core is found
  // by position and compactness rather than by being the second mass.
  const centreX = brush.rect.x + brush.rect.width / 2;
  const centreY = brush.rect.y + brush.rect.height / 2;
  const core = brush.clusters
    .filter((cluster) => cluster.width <= 3 && cluster.height <= 3)
    .sort((a, b) =>
      Math.hypot(a.x + a.width / 2 - centreX, a.y + a.height / 2 - centreY) -
      Math.hypot(b.x + b.width / 2 - centreX, b.y + b.height / 2 - centreY)
    )[0];
  for (const cluster of brush.clusters) {
    if (cluster === core) continue;
    body(brush, cluster, palette.wallMid, 0.06);
    outline(brush, cluster, "rgba(215,242,248,.24)", 0.04);
    ribs(brush, cluster, cluster.width >= cluster.height, 1.0, "rgba(0,0,0,.34)", 0.04);
  }
  if (!core) return;
  // The core pillar: concentric rings with a slow data pulse travelling out.
  const cx = core.x + core.width / 2;
  const cy = core.y + core.height / 2;
  body(brush, core, palette.wallBase, 0.05);
  const reach = Math.max(0.5, Math.min(core.width, core.height) / 2 - 0.15);
  brush.ctx.save();
  for (let index = 0; index < 3; index++) {
    const phase = (drift + index / 3) % 1;
    brush.ctx.globalAlpha = 0.6 * (1 - phase);
    brush.ctx.strokeStyle = palette.coolant;
    brush.ctx.lineWidth = Math.max(1, brush.cell * 0.08);
    brush.ctx.beginPath();
    brush.ctx.arc(px(brush, cx), px(brush, cy), brush.cell * (0.18 + phase * reach), 0, Math.PI * 2);
    brush.ctx.stroke();
  }
  brush.ctx.restore();
  glowDot(brush, cx, cy, 0.28, palette.coolant, 0.45 + pulse * 0.4);
  glowDot(brush, cx, cy, 0.13, "#ffffff", 0.35 + pulse * 0.35);
}

function drawSecurityCheckpoint(brush: Brush): void {
  const { palette, blink } = brush;
  for (const cluster of brush.clusters) {
    const horizontal = cluster.width >= cluster.height;
    const isPost = cluster.tiles <= 3;
    body(brush, cluster, isPost ? palette.machineryFill : palette.wallMid, 0.06);
    outline(brush, cluster, palette.wallBracket, 0.04);
    if (isPost) {
      // Guard posts carry the beacon; the gate line carries scanner banding.
      glowDot(
        brush,
        cluster.x + cluster.width / 2,
        cluster.y + cluster.height / 2,
        0.13,
        blink ? "#ff5a6e" : palette.wallLight,
        blink ? 1 : 0.22,
      );
    } else {
      ribs(brush, cluster, !horizontal, 0.9, "rgba(0,0,0,.36)", 0.05);
      chevronBand(brush, horizontal
        ? { x: cluster.x, y: cluster.y + cluster.height - 0.3, width: cluster.width, height: 0.3 }
        : { x: cluster.x + cluster.width - 0.3, y: cluster.y, width: 0.3, height: cluster.height },
        horizontal, 0);
      // Scanner slots facing the approach.
      brush.ctx.save();
      brush.ctx.globalAlpha = 0.6;
      brush.ctx.fillStyle = palette.wallScreen;
      const count = Math.max(1, Math.floor((horizontal ? cluster.width : cluster.height) / 2));
      for (let index = 0; index < count; index++) {
        const fraction = (index + 0.5) / count;
        if (horizontal) {
          brush.ctx.fillRect(px(brush, cluster.x + cluster.width * fraction - 0.3), px(brush, cluster.y + 0.22), 0.6 * brush.cell, 0.24 * brush.cell);
        } else {
          brush.ctx.fillRect(px(brush, cluster.x + 0.22), px(brush, cluster.y + cluster.height * fraction - 0.3), 0.24 * brush.cell, 0.6 * brush.cell);
        }
      }
      brush.ctx.restore();
    }
  }
}

function drawServerRows(brush: Brush): void {
  for (const [index, cluster] of brush.clusters.entries()) drawRackCluster(brush, cluster, index, 1.1);
}

function drawRelayBank(brush: Brush): void {
  const { palette } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    drawRackCluster(brush, cluster, index, 0.7);
    // A cable tray runs across the top of every cabinet.
    const horizontal = cluster.width >= cluster.height;
    const tray: MapRect = horizontal
      ? { x: cluster.x, y: cluster.y + 0.12, width: cluster.width, height: 0.26 }
      : { x: cluster.x + 0.12, y: cluster.y, width: 0.26, height: cluster.height };
    body(brush, tray, palette.wallPipe, 0);
    ribs(brush, tray, !horizontal, 0.3, palette.wallPipeHi, 0.025);
  }
}

function drawControlHub(brush: Brush): void {
  const { palette, pulse } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    const horizontal = cluster.width >= cluster.height;
    body(brush, cluster, palette.machineryFill, 0.08);
    outline(brush, cluster, palette.wallBracket, 0.04);
    // Console screens face the operations floor.
    const count = Math.max(1, Math.round(horizontal ? cluster.width : cluster.height));
    for (let screen = 0; screen < count; screen++) {
      const fraction = (screen + 0.5) / count;
      const sx = horizontal ? cluster.x + cluster.width * fraction : cluster.x + cluster.width * 0.5;
      const sy = horizontal ? cluster.y + cluster.height * 0.5 : cluster.y + cluster.height * fraction;
      brush.ctx.save();
      brush.ctx.fillStyle = palette.wallScreen;
      brush.ctx.fillRect(px(brush, sx - 0.3), px(brush, sy - 0.22), 0.6 * brush.cell, 0.44 * brush.cell);
      brush.ctx.globalAlpha = 0.4 + pulse * 0.4;
      brush.ctx.fillStyle = palette.floorLight;
      for (let line = 0; line < 3; line++) {
        if (hashNoise(index * 17 + screen, line + Math.floor(brush.drift * 4)) < 0.35) continue;
        brush.ctx.fillRect(px(brush, sx - 0.22), px(brush, sy - 0.14 + line * 0.13), 0.44 * brush.cell, Math.max(1, brush.cell * 0.035));
      }
      brush.ctx.restore();
    }
  }
}

/* ------------------------------------------------------------------ *
 * Derelict Maintenance Salvage Deck
 * ------------------------------------------------------------------ */

function drawCollapsedRoom(brush: Brush): void {
  const { palette, variant, pulse } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    const isSlab = cluster.tiles >= 4;
    if (isSlab) {
      // Failed ceiling slabs, tipped off the structural grid. The slab is
      // deliberately oversized so its broken edge crosses tile boundaries.
      body(brush, cluster, palette.wallBase, 0);
      jaggedSlab(brush, {
        x: cluster.x - 0.35,
        y: cluster.y - 0.35,
        width: cluster.width + 0.7,
        height: cluster.height + 0.7,
      }, variant * 13 + index, palette.wallMid, "rgba(0,0,0,.7)");
      brush.ctx.save();
      brush.ctx.strokeStyle = "rgba(0,0,0,.5)";
      brush.ctx.lineWidth = Math.max(1, brush.cell * 0.06);
      brush.ctx.beginPath();
      for (let crack = 0; crack < 3; crack++) {
        const sx = cluster.x + cluster.width * (0.2 + hashNoise(index, crack) * 0.6);
        const sy = cluster.y + cluster.height * (0.15 + hashNoise(crack, index) * 0.7);
        brush.ctx.moveTo(px(brush, sx), px(brush, sy));
        brush.ctx.lineTo(px(brush, sx + 0.5 - hashNoise(index + 5, crack)), px(brush, sy + 0.75));
      }
      brush.ctx.stroke();
      brush.ctx.restore();
      // Exposed reinforcement bars poking out of the break.
      brush.ctx.save();
      brush.ctx.strokeStyle = palette.wallPipeHi;
      brush.ctx.lineWidth = Math.max(1, brush.cell * 0.04);
      brush.ctx.beginPath();
      for (let bar = 0; bar < 4; bar++) {
        const bx = cluster.x + cluster.width * (0.15 + bar * 0.24);
        brush.ctx.moveTo(px(brush, bx), px(brush, cluster.y + cluster.height - 0.1));
        brush.ctx.lineTo(px(brush, bx + 0.18 - hashNoise(bar, index) * 0.36), px(brush, cluster.y + cluster.height * 0.45));
      }
      brush.ctx.stroke();
      brush.ctx.restore();
    } else {
      damagedFragment(brush, cluster, variant * 19 + index, palette.wallAlt);
    }
  }
  const anchor = brush.clusters[0];
  if (anchor) {
    glowDot(brush, anchor.x + anchor.width * 0.7, anchor.y + anchor.height * 0.3, 0.06, palette.wallLight, pulse * 0.7);
  }
}

function drawScrapHeap(brush: Brush): void {
  const { palette, variant } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    // A mound built from overlapping junk, not a single tidy silhouette.
    body(brush, cluster, palette.wallBase, 0);
    jaggedSlab(brush, {
      x: cluster.x - 0.3,
      y: cluster.y - 0.3,
      width: cluster.width + 0.6,
      height: cluster.height + 0.6,
    }, variant * 7 + index, palette.wallAlt, "rgba(0,0,0,.6)");
    const chunks = Math.max(2, Math.round(cluster.tiles / 3));
    for (let chunk = 0; chunk < chunks; chunk++) {
      const cx = cluster.x + cluster.width * (0.15 + hashNoise(index * 11 + chunk, 3) * 0.7);
      const cy = cluster.y + cluster.height * (0.15 + hashNoise(chunk, index * 11 + 5) * 0.7);
      const size = 0.4 + hashNoise(chunk + 9, index) * 0.6;
      jaggedSlab(
        brush,
        { x: cx - size / 2, y: cy - size / 2, width: size, height: size },
        variant * 29 + chunk + index * 3,
        chunk % 2 === 0 ? palette.machineryFill : palette.wallMid,
        "rgba(0,0,0,.55)",
      );
    }
    // Structural beams protrude at angles.
    brush.ctx.save();
    brush.ctx.strokeStyle = palette.machineryTop;
    brush.ctx.lineWidth = Math.max(1, brush.cell * 0.09);
    brush.ctx.beginPath();
    for (let beam = 0; beam < 3; beam++) {
      const bx = cluster.x + cluster.width * (0.2 + hashNoise(beam, index) * 0.6);
      const by = cluster.y + cluster.height * (0.2 + hashNoise(index, beam) * 0.6);
      const angle = hashNoise(beam + 3, index + 2) * Math.PI;
      brush.ctx.moveTo(px(brush, bx), px(brush, by));
      brush.ctx.lineTo(px(brush, bx + Math.cos(angle) * 1.3), px(brush, by + Math.sin(angle) * 1.3));
    }
    brush.ctx.stroke();
    brush.ctx.restore();
  }
}

function drawWreckedMachinery(brush: Brush): void {
  const { palette, variant, pulse, blink } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    if (cluster.tiles <= 2) {
      damagedFragment(brush, cluster, variant * 41 + index, palette.machineryFill);
      continue;
    }
    body(brush, cluster, palette.machineryFill, 0.07);
    outline(brush, cluster, "rgba(0,0,0,.6)", 0.05);
    // Torn casing: a ragged opening with the machine's innards behind it.
    const tear: MapRect = {
      x: cluster.x + cluster.width * 0.25,
      y: cluster.y + cluster.height * 0.25,
      width: Math.max(0.7, cluster.width * 0.5),
      height: Math.max(0.7, cluster.height * 0.5),
    };
    jaggedSlab(brush, tear, variant * 5 + index, "rgba(3,6,9,.85)", "rgba(140,150,140,.35)");
    brush.ctx.save();
    brush.ctx.strokeStyle = palette.wallPipeHi;
    brush.ctx.lineWidth = Math.max(1, brush.cell * 0.045);
    brush.ctx.beginPath();
    for (let wire = 0; wire < 4; wire++) {
      const wx = tear.x + tear.width * (0.15 + wire * 0.24);
      brush.ctx.moveTo(px(brush, wx), px(brush, tear.y + tear.height * 0.15));
      brush.ctx.lineTo(px(brush, wx + 0.2 - hashNoise(wire, index) * 0.4), px(brush, tear.y + tear.height * 0.85));
    }
    brush.ctx.stroke();
    brush.ctx.restore();
    ribs(brush, cluster, cluster.width >= cluster.height, 1.2, "rgba(0,0,0,.35)", 0.06);
    if (index === 0) {
      // A short-circuit that arcs occasionally instead of glowing constantly.
      glowDot(brush, tear.x + tear.width * 0.5, tear.y + tear.height * 0.5, blink ? 0.15 : 0.05,
        blink ? "#eaf4ff" : palette.wallLight, blink ? 0.95 : pulse * 0.3);
    }
  }
}

function drawBreachedCorridor(brush: Brush): void {
  const { palette, variant } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    const horizontal = cluster.width >= cluster.height;
    damagedFragment(brush, cluster, variant * 11 + index, palette.wallMid);
    ribs(brush, cluster, !horizontal, 1.0, "rgba(0,0,0,.35)", 0.05);
    // Blast scorch fades away from the torn end of the run.
    const torn: MapRect = horizontal
      ? { x: index % 2 === 0 ? cluster.x : cluster.x + cluster.width - 1.4, y: cluster.y, width: 1.4, height: cluster.height }
      : { x: cluster.x, y: index % 2 === 0 ? cluster.y : cluster.y + cluster.height - 1.4, width: cluster.width, height: 1.4 };
    brush.ctx.save();
    brush.ctx.globalAlpha = 0.62;
    jaggedSlab(brush, torn, variant * 3 + index, "rgba(6,7,6,.9)", "rgba(120,110,90,.35)");
    brush.ctx.restore();
    brush.ctx.save();
    brush.ctx.strokeStyle = palette.wallPipeHi;
    brush.ctx.lineWidth = Math.max(1, brush.cell * 0.04);
    brush.ctx.beginPath();
    for (let shard = 0; shard < 3; shard++) {
      const sx = torn.x + torn.width * (0.2 + hashNoise(shard, index) * 0.6);
      const sy = torn.y + torn.height * (0.2 + hashNoise(index, shard) * 0.6);
      brush.ctx.moveTo(px(brush, sx), px(brush, sy));
      brush.ctx.lineTo(px(brush, sx + 0.35 - hashNoise(shard + 4, index) * 0.7), px(brush, sy + 0.4));
    }
    brush.ctx.stroke();
    brush.ctx.restore();
  }
}

function drawSalvageRig(brush: Brush): void {
  const { palette, variant, blink } = brush;
  for (const [index, cluster] of brush.clusters.entries()) {
    const horizontal = cluster.width >= cluster.height;
    damagedFragment(brush, cluster, variant * 31 + index, palette.wallAlt);
    outline(brush, cluster, palette.machineryTop, 0.05);
    // Improvised plating: mismatched patches bolted over the frame.
    const patches = Math.max(1, Math.round(cluster.tiles / 2));
    for (let patch = 0; patch < patches; patch++) {
      const pxPos = cluster.x + cluster.width * hashNoise(index * 13 + patch, 1);
      const pyPos = cluster.y + cluster.height * hashNoise(1, index * 13 + patch);
      const size = 0.45 + hashNoise(patch, index) * 0.4;
      brush.ctx.save();
      brush.ctx.globalAlpha = 0.75;
      brush.ctx.fillStyle = patch % 2 === 0 ? palette.machineryFill : palette.wallMid;
      brush.ctx.fillRect(px(brush, pxPos), px(brush, pyPos), size * brush.cell, size * brush.cell);
      brush.ctx.strokeStyle = "rgba(0,0,0,.6)";
      brush.ctx.lineWidth = Math.max(1, brush.cell * 0.035);
      brush.ctx.strokeRect(px(brush, pxPos), px(brush, pyPos), size * brush.cell, size * brush.cell);
      brush.ctx.restore();
    }
    // Slack cables sag between the scaffold poles.
    brush.ctx.save();
    brush.ctx.strokeStyle = "rgba(15,18,15,.8)";
    brush.ctx.lineWidth = Math.max(1, brush.cell * 0.05);
    brush.ctx.beginPath();
    if (horizontal) {
      brush.ctx.moveTo(px(brush, cluster.x), px(brush, cluster.y + 0.3));
      brush.ctx.quadraticCurveTo(
        px(brush, cluster.x + cluster.width / 2),
        px(brush, cluster.y + cluster.height * 0.85),
        px(brush, cluster.x + cluster.width),
        px(brush, cluster.y + 0.3),
      );
    } else {
      brush.ctx.moveTo(px(brush, cluster.x + 0.3), px(brush, cluster.y));
      brush.ctx.quadraticCurveTo(
        px(brush, cluster.x + cluster.width * 0.85),
        px(brush, cluster.y + cluster.height / 2),
        px(brush, cluster.x + 0.3),
        px(brush, cluster.y + cluster.height),
      );
    }
    brush.ctx.stroke();
    brush.ctx.restore();
    if (index === 0) {
      glowDot(brush, cluster.x + cluster.width * 0.5, cluster.y + cluster.height * 0.2, blink ? 0.13 : 0.05,
        blink ? "#ffe3b0" : palette.wallLight, blink ? 0.9 : 0.2);
    }
  }
}

function drawReactorWreck(brush: Brush): void {
  const { palette, variant, pulse } = brush;
  const core = brush.clusters.find((cluster) => cluster.tiles <= 12 && cluster.width <= 3 && cluster.height <= 3);
  for (const [index, cluster] of brush.clusters.entries()) {
    if (cluster === core) continue;
    // The shell survives in fragments, each one cracked along its length.
    damagedFragment(brush, cluster, variant * 23 + index, palette.wallMid);
    brush.ctx.save();
    brush.ctx.strokeStyle = "rgba(0,0,0,.55)";
    brush.ctx.lineWidth = Math.max(1, brush.cell * 0.07);
    brush.ctx.beginPath();
    const horizontal = cluster.width >= cluster.height;
    for (let crack = 0; crack < Math.max(2, Math.round(cluster.tiles / 3)); crack++) {
      const t = (crack + 0.5) / Math.max(2, Math.round(cluster.tiles / 3));
      if (horizontal) {
        const cx = cluster.x + cluster.width * t;
        brush.ctx.moveTo(px(brush, cx), px(brush, cluster.y));
        brush.ctx.lineTo(px(brush, cx + 0.3 - hashNoise(crack, index) * 0.6), px(brush, cluster.y + cluster.height));
      } else {
        const cy = cluster.y + cluster.height * t;
        brush.ctx.moveTo(px(brush, cluster.x), px(brush, cy));
        brush.ctx.lineTo(px(brush, cluster.x + cluster.width), px(brush, cy + 0.3 - hashNoise(index, crack) * 0.6));
      }
    }
    brush.ctx.stroke();
    brush.ctx.restore();
  }
  if (!core) return;
  const cx = core.x + core.width / 2;
  const cy = core.y + core.height / 2;
  jaggedSlab(brush, core, variant * 17, palette.wallBase, "rgba(0,0,0,.7)");
  // A failing core: it leaks light in irregular bursts rather than pulsing.
  glowDot(brush, cx, cy, 0.3, palette.wallLight, pulse * 0.5);
  glowDot(brush, cx, cy, 0.12, "#ffd9b0", pulse * 0.85);
}

const LANDMARK_ART: Record<LandmarkKind, (brush: Brush) => void> = {
  furnace_block: drawFurnace,
  processing_line: drawProcessingLine,
  coolant_tanks: drawCoolantTanks,
  loading_bay: drawLoadingBay,
  pipe_manifold: drawPipeManifold,
  crane_gantry: drawCraneGantry,
  server_vault: drawServerVault,
  data_core: drawDataCore,
  security_checkpoint: drawSecurityCheckpoint,
  server_rows: drawServerRows,
  relay_bank: drawRelayBank,
  control_hub: drawControlHub,
  collapsed_room: drawCollapsedRoom,
  scrap_heap: drawScrapHeap,
  wrecked_machinery: drawWreckedMachinery,
  breached_corridor: drawBreachedCorridor,
  salvage_rig: drawSalvageRig,
  reactor_wreck: drawReactorWreck,
};

/** Names every landmark kind that has dedicated artwork. Used by tests. */
export function landmarkArtKinds(): LandmarkKind[] {
  return Object.keys(LANDMARK_ART) as LandmarkKind[];
}

/**
 * Paints every landmark in the map's environment as a multi-tile object.
 * Called after the tile pass and before overlays, highlights, and units, so
 * gameplay information always sits on top of environmental art.
 */
export function drawLandmarkArt(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  cell: number,
  nowMs: number,
  options: LandmarkArtOptions = {},
): void {
  const environment = map.environment;
  if (!environment || environment.landmarks.length === 0) return;
  const palette = TERRAIN_PALETTES[levelThemeId(map.themeId)];
  const animate = options.animate !== false;
  for (const landmark of environment.landmarks) {
    const draw = LANDMARK_ART[landmark.kind];
    if (!draw) continue;
    const clusters = solidClusters(map, landmark.rect);
    if (clusters.length === 0) continue;
    const seed = landmarkSeed(landmark);
    const ambient = ambientValues(landmarkAmbient(landmark), nowMs, seed, animate);
    // A secondary structure never animates as strongly as the feature the map
    // is composed around.
    const attenuation = landmark.importance === "secondary" ? 0.55 : 1;
    const brush: Brush = {
      ctx,
      map,
      cell,
      rect: landmark.rect,
      palette,
      orientation: landmarkOrientation(landmark),
      variant: landmarkVariant(landmark),
      importance: landmark.importance,
      clusters,
      pulse: 0.5 + (ambient.pulse - 0.5) * attenuation,
      blink: ambient.blink && landmark.importance !== "secondary",
      drift: ambient.drift,
      noise: (index: number) => hashNoise(seed + index, landmark.rect.x * 31 + landmark.rect.y),
    };
    drawContactShadow(ctx, map, landmark.rect, cell);
    ctx.save();
    if (clipSolid(ctx, map, landmark.rect, cell)) draw(brush);
    ctx.restore();
  }
}
