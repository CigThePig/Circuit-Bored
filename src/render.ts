import { getTile, type GameMap, type Unit } from "./map.ts";
import { floorTreatmentAt, type FloorTreatmentZone } from "./environment.ts";
import { drawLandmarkArt } from "./renderLandmarks.ts";
import {
  DEFAULT_LEVEL_THEME_ID,
  levelThemeId,
  type LevelThemeId,
} from "./themes.ts";
import { PALETTE, TERRAIN_PALETTES } from "./renderPalette.ts";

export type UnitVisualState = {
  spent?: boolean;
  inCover?: boolean;
  coverDir?: { x: number; y: number } | null;
  peekDir?: { x: number; y: number } | null;
  aimingDir?: { x: number; y: number } | null;
  firing?: number;
  hitReaction?: number;
  hitDir?: { x: number; y: number } | null;
  defeatedFade?: number;
  moving?: number;
  moveDir?: { x: number; y: number } | null;
  nowMs?: number;
};

const PLAYER_POSE = {
  idleBobSpeed: 3.2,
  idleBobAmount: 0.015,
  coverDrop: 0.055,
  coverScaleY: 0.92,
  peekOffset: 0.24,
  handRadius: 0.055,
  handReach: 0.24,
  handVerticalReach: 0.12,
  weaponLength: 0.18,
} as const;

function adjacentCoverDirection(map: GameMap, x: number, y: number): { x: number; y: number } | null {
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let halfCover: { x: number; y: number } | null = null;
  for (const [dx, dy] of dirs) {
    const t = getTile(map, x + dx, y + dy);
    if (t === "wall") return { x: dx, y: dy };
    if (t === "half_cover" && !halfCover) halfCover = { x: dx, y: dy };
  }
  return halfCover;
}

function computeUnitVisualState(
  map: GameMap,
  u: Unit,
  nowMs: number,
): UnitVisualState {
  const spent = u.ap === 0;
  const coverDir = adjacentCoverDirection(map, u.x, u.y);
  const inCover = coverDir !== null;
  let peekDir: { x: number; y: number } | null = null;
  if (u.peekExposure) {
    const cx = Math.max(-1, Math.min(1, u.peekExposure.x - u.x));
    const cy = Math.max(-1, Math.min(1, u.peekExposure.y - u.y));
    // A diagonal exposure consists of one wall-axis step and one open
    // shoulder step. Lean along the shoulder, not diagonally into the wall.
    if (cx !== 0 && cy !== 0 && getTile(map, u.x + cx, u.y) === "wall") {
      peekDir = { x: 0, y: cy };
    } else if (cx !== 0 && cy !== 0 && getTile(map, u.x, u.y + cy) === "wall") {
      peekDir = { x: cx, y: 0 };
    } else {
      const len = Math.hypot(cx, cy);
      if (len > 0) peekDir = { x: cx / len, y: cy / len };
    }
  }
  // TODO: aimingDir would require tracking the unit's current shot target;
  // for now we fall back to peek direction (or facing) inside the silhouette.
  return { spent, inCover, coverDir, peekDir, aimingDir: null, nowMs };
}

export type FloatingText = {
  text: string;
  x: number;
  y: number;
  color: string;
  expiresAt: number;
};

export type EnemyPreview = {
  x: number;
  y: number;
  hitPct: number;
  hasCover: boolean;
};

export type CoverIndicator = {
  x: number;
  y: number;
  side: "n" | "s" | "e" | "w";
  kind: "wall" | "half_cover";
};

export type ThreatMarker = {
  x: number;
  y: number;
};

export type SightLine = {
  fromX: number;
  fromY: number;
  peekShoulderX?: number;
  peekShoulderY?: number;
  toX: number;
  toY: number;
  hasCover: boolean;
  shooterX?: number;
  shooterY?: number;
  mode?: "direct" | "peek";
};

export type ProjectileKind = "pulse" | "tracer" | "scatter" | "rail" | "heavy";

export type ShotEffect = {
  id: string;
  shooterId: string;
  targetId: string;
  shooterTeam: Unit["team"];
  targetTeam: Unit["team"];
  shooterX: number;
  shooterY: number;
  targetX: number;
  targetY: number;
  fromX: number;
  fromY: number;
  peekShoulderX?: number;
  peekShoulderY?: number;
  toX: number;
  toY: number;
  mode: "direct" | "peek";
  projectile: ProjectileKind;
  hit: boolean;
  startedAt: number;
  durationMs: number;
  loop?: boolean;
};

export type MovementEffect = {
  id: string;
  unitId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  durationMs: number;
  loop?: boolean;
};

export type RenderState = {
  map: GameMap;
  selected: Unit | null;
  /** Hide gameplay UI while keeping the board and unit artwork visible. */
  showUnitUi?: boolean;
  highlights: {
    x: number;
    y: number;
    fill: string;
    border: string;
    kind?: "move" | "target";
  }[];
  enemyPreviews: EnemyPreview[];
  floatingTexts: FloatingText[];
  coverIndicators?: CoverIndicator[];
  threatMarkers?: ThreatMarker[];
  sightLines?: SightLine[];
  shotEffects?: ShotEffect[];
  movementEffects?: MovementEffect[];
  /** Development-only flat category view used by the visual laboratory. */
  terrainDiagnostic?: boolean;
  /**
   * Ambient landmark motion. Defaults to on; the lab turns it off to compare
   * still frames and the semantic view never uses it.
   */
  ambientAnimation?: boolean;
};

const ctxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

function shotEffectProgress(effect: ShotEffect, nowMs: number): number {
  const duration = Math.max(1, effect.durationMs);
  if (effect.loop) {
    return (((nowMs - effect.startedAt) % duration) + duration) % duration / duration;
  }
  return (nowMs - effect.startedAt) / duration;
}

function shotEffectIsActive(effect: ShotEffect, nowMs: number): boolean {
  const progress = shotEffectProgress(effect, nowMs);
  return effect.loop || (progress >= 0 && progress <= 1);
}

function movementEffectProgress(effect: MovementEffect, nowMs: number): number {
  const duration = Math.max(1, effect.durationMs);
  if (effect.loop) {
    return (((nowMs - effect.startedAt) % duration) + duration) % duration / duration;
  }
  return (nowMs - effect.startedAt) / duration;
}

function movementEffectIsActive(effect: MovementEffect, nowMs: number): boolean {
  const progress = movementEffectProgress(effect, nowMs);
  return effect.loop || (progress >= 0 && progress <= 1);
}

function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  let ctx = ctxCache.get(canvas);
  if (!ctx) {
    ctx = canvas.getContext("2d")!;
    ctxCache.set(canvas, ctx);
  }
  return ctx;
}

export function resizeCanvasForMap(canvas: HTMLCanvasElement, map: GameMap, minimumCellSize = 1): number {
  const cssWidth = Math.max(1, Math.min(window.innerWidth, 480));
  // Generated encounters opt into the documented 28 px gameplay minimum and
  // let the board shell pan on smaller screens. Editor maps keep their fitted
  // cell size so a valid large map cannot allocate an oversized backing canvas.
  const cell = Math.max(1, minimumCellSize, Math.floor(cssWidth / map.width));
  const widthPx = cell * map.width;
  const heightPx = cell * map.height;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${widthPx}px`;
  canvas.style.height = `${heightPx}px`;
  canvas.width = Math.floor(widthPx * dpr);
  canvas.height = Math.floor(heightPx * dpr);
  const ctx = getCtx(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return cell;
}

export function draw(canvas: HTMLCanvasElement, state: RenderState, nowMs = performance.now()): void {
  const ctx = getCtx(canvas);
  const map = state.map;
  const cssW = parseFloat(canvas.style.width || `${canvas.width}`);
  const cell = cssW / map.width;
  const mapHeightPx = cell * map.height;
  const now = nowMs;

  ctx.fillStyle = PALETTE.BG;
  ctx.fillRect(0, 0, cssW, mapHeightPx);

  for (let y = 0; y < map.height; y++) {
    const py = y * cell;
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y * map.width + x];
      const px = x * cell;
      if (state.terrainDiagnostic) {
        drawSemanticTile(ctx, px, py, cell, t);
      } else if (t === "wall") {
        drawWallTile(ctx, px, py, cell, x, y, map, levelThemeId(map.themeId));
      } else if (t === "half_cover") {
        drawHalfCoverTile(ctx, px, py, cell, x, y, map, levelThemeId(map.themeId));
      } else {
        drawFloorTile(ctx, px, py, cell, x, y, map, levelThemeId(map.themeId));
      }
    }
  }

  if (state.terrainDiagnostic) {
    drawLandmarkFootprints(ctx, map, cell);
  } else {
    // Bespoke landmark artwork sits above terrain and below every gameplay
    // overlay, so environmental identity can never outrank tactical meaning.
    drawLandmarkArt(ctx, map, cell, now, { animate: state.ambientAnimation !== false });
  }

  for (const h of state.highlights) {
    drawHighlight(ctx, h.x * cell, h.y * cell, cell, h.fill, h.border, h.kind ?? "move");
  }

  if (state.sightLines && state.sightLines.length > 0) {
    for (const line of state.sightLines) {
      drawSightLine(ctx, cell, line);
    }
  }

  for (const u of map.units) {
    const firingEffect = state.shotEffects?.find((effect) =>
      effect.shooterId === u.id && shotEffectIsActive(effect, now)
    );
    const hitEffect = state.shotEffects?.find((effect) =>
      effect.hit && effect.targetId === u.id && shotEffectIsActive(effect, now)
    );
    // Keep a defeated unit on the board for the impact/recoil frames. Once the
    // effect expires the normal hp guard removes it.
    if (u.hp <= 0 && !hitEffect) continue;
    const movementEffect = state.movementEffects?.find((effect) =>
      effect.unitId === u.id && movementEffectIsActive(effect, now)
    );
    const isSelected = state.selected !== null && state.selected.id === u.id;
    const unitSightLines = state.sightLines?.filter((line) =>
      line.shooterX === u.x && line.shooterY === u.y
    );
    const aimingLine = unitSightLines?.find((line) => line.mode === "peek") ?? unitSightLines?.[0];
    let renderX = u.x;
    let renderY = u.y;
    if (movementEffect) {
      const progress = Math.max(0, Math.min(1, movementEffectProgress(movementEffect, now)));
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      renderX = movementEffect.fromX + (movementEffect.toX - movementEffect.fromX) * eased;
      renderY = movementEffect.fromY + (movementEffect.toY - movementEffect.fromY) * eased;
    } else if (firingEffect) {
      // A firing pose belongs to the position captured with the shot, even if
      // gameplay state has already advanced the unit to another tile.
      renderX = firingEffect.shooterX;
      renderY = firingEffect.shooterY;
    }
    drawUnit(
      ctx,
      renderX * cell,
      renderY * cell,
      cell,
      u,
      isSelected,
      mapHeightPx,
      map,
      now,
      state.showUnitUi !== false,
      firingEffect,
      hitEffect,
      aimingLine,
      movementEffect,
    );
  }

  if (state.shotEffects) {
    for (const effect of state.shotEffects) drawShotEffect(ctx, cell, effect, now);
  }

  if (state.coverIndicators && state.coverIndicators.length > 0) {
    for (const ind of state.coverIndicators) {
      drawCoverIndicator(ctx, cell, ind);
    }
  }

  if (state.threatMarkers && state.threatMarkers.length > 0) {
    const pulse = 0.6 + 0.4 * (Math.sin((now / 1200) * Math.PI * 2) * 0.5 + 0.5);
    for (const m of state.threatMarkers) {
      drawThreatMarker(ctx, cell, m, pulse);
    }
  }

  for (const p of state.enemyPreviews) {
    drawEnemyPreview(ctx, p.x * cell, p.y * cell, cell, p);
  }

  for (const t of state.floatingTexts) {
    if (t.expiresAt < now) continue;
    drawFloatingText(ctx, cell, t);
  }
}

function tileHash(x: number, y: number): number {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) & 0xff;
}

export type EnvironmentVariant =
  | "deck"
  | "service_hatch"
  | "vent"
  | "conduit"
  | "bulkhead"
  | "pipe_bank"
  | "system_panel"
  | "cargo"
  | "barricade"
  | "machinery";

type ThemedEnvironmentVariant = EnvironmentVariant
  | "clean_panel"
  | "access_grid"
  | "illuminated_strip"
  | "reinforced_bulkhead"
  | "server_bank"
  | "security_panel"
  | "console"
  | "security_barricade"
  | "server_console"
  | "worn_deck"
  | "broken_plate"
  | "maintenance_grate"
  | "exposed_conduit"
  | "damaged_bulkhead"
  | "pipe_cluster"
  | "patchwork_wall"
  | "salvage_pile"
  | "improvised_barricade"
  | "damaged_machinery";

export function environmentVariant(
  tile: "floor" | "wall" | "half_cover",
  x: number,
  y: number,
  themeId: LevelThemeId = DEFAULT_LEVEL_THEME_ID,
): ThemedEnvironmentVariant {
  const salt = themeId === "industrial" ? 0 : themeId === "data_core" ? 71 : 149;
  const variant = tileHash(x + salt, y - salt) % 12;
  if (themeId === "data_core") {
    if (tile === "floor") {
      if (variant === 0) return "access_grid";
      return "clean_panel";
    }
    if (tile === "wall") {
      if (variant === 2 || variant === 7) return "server_bank";
      if (variant === 5 || variant === 10) return "security_panel";
      return "reinforced_bulkhead";
    }
    if (variant < 4) return "console";
    if (variant < 8) return "security_barricade";
    return "server_console";
  }
  if (themeId === "derelict") {
    if (tile === "floor") {
      if (variant === 0) return "broken_plate";
      if (variant === 6) return "maintenance_grate";
      return "worn_deck";
    }
    if (tile === "wall") {
      if (variant === 2 || variant === 7) return "pipe_cluster";
      if (variant === 5 || variant === 10) return "patchwork_wall";
      return "damaged_bulkhead";
    }
    if (variant < 4) return "salvage_pile";
    if (variant < 8) return "improvised_barricade";
    return "damaged_machinery";
  }
  if (tile === "floor") {
    if (variant === 0) return "service_hatch";
    return "deck";
  }
  if (tile === "wall") {
    if (variant === 2 || variant === 7) return "pipe_bank";
    if (variant === 5) return "system_panel";
    return "bulkhead";
  }
  if (variant < 4) return "cargo";
  if (variant < 8) return "barricade";
  return "machinery";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function ellipsePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function capsulePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  roundRect(ctx, x, y, w, h, Math.min(w, h) / 2);
}

function topDownTorsoPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  const topW = w * 0.66;
  const botW = w * 0.92;
  const topY = cy - h * 0.44;
  const midY = cy + h * 0.08;
  const botY = cy + h * 0.46;
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, topY);
  ctx.quadraticCurveTo(cx, topY - h * 0.18, cx + topW / 2, topY);
  ctx.lineTo(cx + botW / 2, midY);
  ctx.quadraticCurveTo(cx + botW * 0.46, botY, cx, botY);
  ctx.quadraticCurveTo(cx - botW * 0.46, botY, cx - botW / 2, midY);
  ctx.closePath();
}

function strokeUnitLine(
  ctx: CanvasRenderingContext2D,
  stroke: string,
  width: number,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function fillAndStroke(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke = PALETTE.UNIT_OUTLINE,
  width = 1,
): void {
  ctx.fillStyle = fill;
  ctx.fill();
  strokeUnitLine(ctx, stroke, width);
}

type UnitShape = "operator" | "runner" | "bulwark" | "scrapper" | "rifleman" | "marksman" | "sentinel";

type UnitArtProfile = {
  shape: UnitShape;
  primary: string;
  secondary: string;
  glow: string;
  width: number;
  weapon: "pistol" | "carbine" | "shotgun" | "rifle" | "cannon";
};

const UNIT_ART_PROFILES: Record<UnitShape, UnitArtProfile> = {
  operator: { shape: "operator", primary: "#2389b8", secondary: "#bdebf0", glow: "#5de7ff", width: 0.46, weapon: "carbine" },
  runner: { shape: "runner", primary: "#824ac2", secondary: "#ff62cf", glow: "#ff72dc", width: 0.38, weapon: "pistol" },
  bulwark: { shape: "bulwark", primary: "#347985", secondary: "#e7b84d", glow: "#6ff1e2", width: 0.58, weapon: "cannon" },
  scrapper: { shape: "scrapper", primary: "#a8462c", secondary: "#e69a47", glow: "#ff784d", width: 0.43, weapon: "shotgun" },
  rifleman: { shape: "rifleman", primary: "#a93645", secondary: "#d97a65", glow: "#ff596b", width: 0.46, weapon: "rifle" },
  marksman: { shape: "marksman", primary: "#71314f", secondary: "#e45782", glow: "#ff4e88", width: 0.38, weapon: "rifle" },
  sentinel: { shape: "sentinel", primary: "#74363f", secondary: "#e6ae43", glow: "#ffb52e", width: 0.60, weapon: "cannon" },
};

function unitArtProfile(unit: Unit): UnitArtProfile {
  const fallback = unit.team === "player" ? UNIT_ART_PROFILES.operator : UNIT_ART_PROFILES.rifleman;
  return UNIT_ART_PROFILES[unit.archetypeId as UnitShape] ?? fallback;
}

export function projectileKindForUnit(unit: Unit): ProjectileKind {
  const weapon = unitArtProfile(unit).weapon;
  if (weapon === "pistol") return "pulse";
  if (weapon === "shotgun") return "scatter";
  if (weapon === "rifle") return unit.archetypeId === "marksman" ? "rail" : "tracer";
  if (weapon === "cannon") return "heavy";
  return "tracer";
}

function drawUnitWeapon(
  ctx: CanvasRenderingContext2D,
  cell: number,
  profile: UnitArtProfile,
  aim: { x: number; y: number },
): void {
  const angle = Math.atan2(aim.y, aim.x);
  const length = profile.weapon === "pistol" ? 0.27
    : profile.weapon === "shotgun" ? 0.38
      : profile.weapon === "carbine" ? 0.41
        : profile.weapon === "rifle" ? 0.52
          : 0.43;
  const thickness = profile.weapon === "cannon" ? 0.15 : profile.weapon === "shotgun" ? 0.11 : 0.075;
  ctx.save();
  ctx.rotate(angle);
  const start = cell * 0.04;
  const barrel = cell * length;
  roundRect(ctx, start, -cell * thickness / 2, barrel, cell * thickness, cell * 0.025);
  ctx.fillStyle = PALETTE.UNIT_METAL;
  ctx.fill();
  ctx.strokeStyle = PALETTE.UNIT_OUTLINE;
  ctx.lineWidth = Math.max(1, cell * 0.025);
  ctx.stroke();

  ctx.fillStyle = profile.secondary;
  ctx.fillRect(start + barrel * 0.24, -cell * thickness * 0.18, barrel * 0.34, Math.max(1, cell * thickness * 0.22));
  ctx.fillStyle = profile.glow;
  ctx.fillRect(start + barrel - Math.max(1.5, cell * 0.04), -cell * thickness * 0.21, Math.max(1.5, cell * 0.04), cell * thickness * 0.42);

  if (profile.weapon === "rifle") {
    ctx.fillStyle = "#0a1015";
    ctx.fillRect(start + barrel * 0.36, -cell * 0.11, barrel * 0.17, cell * 0.07);
    ctx.fillStyle = profile.glow;
    ctx.fillRect(start + barrel * 0.42, -cell * 0.105, Math.max(1, cell * 0.025), Math.max(1, cell * 0.025));
  } else if (profile.weapon === "cannon") {
    ctx.fillStyle = PALETTE.UNIT_METAL_HI;
    ctx.fillRect(start + barrel * 0.16, -cell * thickness * 0.6, barrel * 0.28, cell * thickness * 1.2);
  } else if (profile.weapon === "shotgun") {
    ctx.strokeStyle = profile.secondary;
    ctx.lineWidth = Math.max(1, cell * 0.025);
    ctx.beginPath();
    ctx.moveTo(start + barrel * 0.55, -cell * thickness * 0.48);
    ctx.lineTo(start + barrel * 0.76, cell * thickness * 0.48);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUnitSilhouette(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  u: Unit,
  bodyColor: string,
  visual: UnitVisualState,
): void {
  const cx = px + cell / 2;
  const cy = py + cell / 2;
  const profile = unitArtProfile(u);
  const detail = cell >= 18;
  const outlineW = Math.max(1, cell * 0.035);
  const spent = visual.spent ?? false;
  const inCover = visual.inCover ?? false;
  const coverDir = visual.coverDir ?? null;
  const peekDir = visual.peekDir ?? null;
  const nowMs = visual.nowMs ?? performance.now();
  const primary = spent ? bodyColor : profile.primary;
  const facing = u.team === "player" ? 1 : -1;
  const aim = visual.aimingDir ?? peekDir ?? { x: facing, y: 0 };
  const aimLength = Math.hypot(aim.x, aim.y) || 1;
  const aimDir = { x: aim.x / aimLength, y: aim.y / aimLength };

  const tSec = nowMs / 1000;
  const idleWave = Math.sin(tSec * PLAYER_POSE.idleBobSpeed + u.x * 0.7 + u.y);
  const idleBob = idleWave * cell * PLAYER_POSE.idleBobAmount * (inCover ? 0.35 : 1);
  const coverDrop = inCover ? cell * (PLAYER_POSE.coverDrop + (idleWave + 1) * 0.008) : 0;
  const coverScaleY = inCover ? PLAYER_POSE.coverScaleY : 1;
  const coverTuckX = (coverDir?.x ?? 0) * cell * 0.075;
  const coverTuckY = (coverDir?.y ?? 0) * cell * 0.075;
  const peekOffsetX = (peekDir?.x ?? 0) * cell * PLAYER_POSE.peekOffset;
  const peekOffsetY = (peekDir?.y ?? 0) * cell * PLAYER_POSE.peekOffset;
  const firing = visual.firing ?? 0;
  const kick = firing < 0.28 ? Math.sin((firing / 0.28) * Math.PI) * cell * 0.055 : 0;
  const hit = visual.hitReaction ?? 0;
  const hitDir = visual.hitDir ?? { x: 0, y: 0 };
  const hitKick = hit * cell * 0.10;
  const hitTwist = hit * (hitDir.x >= 0 ? -1 : 1) * 0.08;
  const moving = visual.moving ?? 0;
  const moveDir = visual.moveDir ?? { x: 0, y: 0 };
  const strideTilt = (moveDir.x + moveDir.y * 0.55) * moving * 0.045;
  const defeatedFade = visual.defeatedFade ?? 1;

  ctx.save();
  ctx.globalAlpha *= defeatedFade;
  ctx.translate(cx, cy);
  const shadow = ctx.createRadialGradient(0, cell * 0.20, 0, 0, cell * 0.20, cell * 0.35);
  shadow.addColorStop(0, "rgba(0,0,0,.58)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(-cell * 0.38, -cell * 0.02, cell * 0.76, cell * 0.48);

  ctx.save();
  ctx.translate(
    coverTuckX + peekOffsetX - aimDir.x * kick + hitDir.x * hitKick,
    coverTuckY + peekOffsetY + idleBob + coverDrop + hitDir.y * hitKick,
  );
  ctx.rotate(hitTwist + strideTilt);
  ctx.scale(1 + moving * 0.035, coverScaleY * (1 - moving * 0.045));

  // Archetype-specific shoulder geometry makes units legible before badges.
  const shoulderY = -cell * 0.08;
  if (profile.shape === "bulwark" || profile.shape === "sentinel") {
    for (const side of [-1, 1]) {
      roundRect(ctx, side * cell * 0.31 - cell * 0.12, shoulderY, cell * 0.24, cell * 0.30, cell * 0.04);
      fillAndStroke(ctx, primary, PALETTE.UNIT_OUTLINE, outlineW);
      ctx.fillStyle = profile.secondary;
      ctx.fillRect(side * cell * 0.31 - cell * 0.07, shoulderY + cell * 0.045, cell * 0.14, cell * 0.045);
    }
  } else if (profile.shape === "runner" || profile.shape === "marksman") {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * cell * 0.18, shoulderY);
      ctx.lineTo(side * cell * 0.34, shoulderY + cell * 0.09);
      ctx.lineTo(side * cell * 0.22, shoulderY + cell * 0.27);
      ctx.closePath();
      fillAndStroke(ctx, primary, PALETTE.UNIT_OUTLINE, outlineW);
    }
  } else {
    for (const side of [-1, 1]) {
      capsulePath(ctx, side * cell * 0.24 - cell * 0.08, shoulderY, cell * 0.16, cell * 0.31);
      fillAndStroke(ctx, primary, PALETTE.UNIT_OUTLINE, outlineW);
    }
  }

  const torsoHeight = profile.shape === "sentinel" ? 0.54 : profile.shape === "runner" ? 0.50 : 0.58;
  if (profile.shape === "sentinel") {
    roundRect(ctx, -cell * profile.width / 2, -cell * 0.12, cell * profile.width, cell * torsoHeight, cell * 0.055);
  } else {
    topDownTorsoPath(ctx, 0, cell * 0.09, cell * profile.width, cell * torsoHeight);
  }
  fillAndStroke(ctx, primary, PALETTE.UNIT_OUTLINE, outlineW);

  if (detail) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    const armorGrad = ctx.createLinearGradient(-cell * 0.24, -cell * 0.20, cell * 0.24, cell * 0.32);
    armorGrad.addColorStop(0, "#ffffff");
    armorGrad.addColorStop(0.48, "rgba(255,255,255,0)");
    ctx.fillStyle = armorGrad;
    ctx.fillRect(-cell * profile.width / 2, -cell * 0.16, cell * profile.width, cell * 0.58);
    ctx.restore();

    // Chest identity marks: speed chevrons, armor bars, or hostile slashes.
    ctx.strokeStyle = profile.secondary;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.beginPath();
    if (profile.shape === "runner" || profile.shape === "marksman") {
      ctx.moveTo(-cell * 0.12, cell * 0.03);
      ctx.lineTo(0, cell * 0.18);
      ctx.lineTo(cell * 0.12, cell * 0.03);
    } else if (profile.shape === "bulwark" || profile.shape === "sentinel") {
      ctx.moveTo(-cell * 0.16, cell * 0.07);
      ctx.lineTo(cell * 0.16, cell * 0.07);
      ctx.moveTo(-cell * 0.13, cell * 0.15);
      ctx.lineTo(cell * 0.13, cell * 0.15);
    } else {
      ctx.moveTo(-cell * 0.14, cell * 0.02);
      ctx.lineTo(cell * 0.11, cell * 0.18);
    }
    ctx.stroke();
  }

  const headY = -cell * 0.22;
  if (profile.shape === "sentinel") {
    roundRect(ctx, -cell * 0.19, headY - cell * 0.14, cell * 0.38, cell * 0.27, cell * 0.035);
  } else if (profile.shape === "scrapper") {
    ctx.beginPath();
    ctx.moveTo(-cell * 0.19, headY - cell * 0.10);
    ctx.lineTo(cell * 0.13, headY - cell * 0.15);
    ctx.lineTo(cell * 0.21, headY + cell * 0.08);
    ctx.lineTo(-cell * 0.15, headY + cell * 0.12);
    ctx.closePath();
  } else {
    ellipsePath(ctx, 0, headY, cell * (profile.shape === "bulwark" ? 0.23 : 0.20), cell * 0.17);
  }
  fillAndStroke(ctx, profile.secondary, PALETTE.UNIT_OUTLINE, outlineW);

  if (detail) {
    ctx.fillStyle = "rgba(3,8,12,.76)";
    const visorW = profile.shape === "marksman" ? 0.24 : profile.shape === "sentinel" ? 0.25 : 0.29;
    roundRect(ctx, -cell * visorW / 2, headY - cell * 0.035, cell * visorW, cell * 0.075, cell * 0.025);
    ctx.fill();
    ctx.shadowColor = profile.glow;
    ctx.shadowBlur = cell * 0.12;
    ctx.fillStyle = profile.glow;
    if (profile.shape === "marksman") {
      ctx.beginPath();
      ctx.arc(cell * 0.055, headY, cell * 0.038, 0, Math.PI * 2);
      ctx.fill();
    } else if (profile.shape === "sentinel") {
      for (const side of [-1, 1]) ctx.fillRect(side * cell * 0.055 - cell * 0.022, headY - cell * 0.018, cell * 0.044, cell * 0.036);
    } else {
      ctx.fillRect(-cell * visorW * 0.34, headY - 0.5, cell * visorW * 0.68, Math.max(1, cell * 0.022));
    }
    ctx.shadowBlur = 0;
  }

  drawUnitWeapon(ctx, cell, profile, aimDir);

  if (profile.shape === "runner" && detail) {
    ctx.fillStyle = profile.glow;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * cell * 0.12, cell * 0.27);
      ctx.lineTo(side * cell * 0.18, cell * 0.40);
      ctx.lineTo(side * cell * 0.05, cell * 0.31);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (spent) {
    ctx.fillStyle = PALETTE.SPENT_VEIL;
    ctx.fillRect(-cell * 0.39, -cell * 0.42, cell * 0.78, cell * 0.84);
  }

  ctx.restore();
  ctx.restore();
}

function drawSemanticTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  tile: "floor" | "wall" | "half_cover",
): void {
  ctx.fillStyle = tile === "floor" ? "#111820" : tile === "wall" ? "#d7e3e8" : "#78919c";
  ctx.fillRect(px, py, cell, cell);
  ctx.strokeStyle = tile === "floor" ? "#202d36" : "#071018";
  ctx.lineWidth = Math.max(1, cell * 0.045);
  ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
  if (tile === "half_cover") {
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.22, py + cell * 0.22);
    ctx.lineTo(px + cell * 0.78, py + cell * 0.78);
    ctx.moveTo(px + cell * 0.78, py + cell * 0.22);
    ctx.lineTo(px + cell * 0.22, py + cell * 0.78);
    ctx.stroke();
  }
}

/**
 * Semantic-mode hierarchy outline. Three weights make it obvious at a glance
 * whether a map has one dominant feature or a set of equal competitors.
 */
function drawLandmarkFootprints(ctx: CanvasRenderingContext2D, map: GameMap, cell: number): void {
  if (!map.environment) return;
  ctx.save();
  for (const landmark of map.environment.landmarks) {
    const { x, y, width, height } = landmark.rect;
    const inset = cell * 0.08;
    ctx.strokeStyle = landmark.importance === "dominant"
      ? "#ff9f45"
      : landmark.importance === "major"
        ? "#ffd75a"
        : "#e8f4f8";
    ctx.lineWidth = landmark.importance === "dominant"
      ? Math.max(3, cell * 0.12)
      : Math.max(2, cell * 0.07);
    ctx.setLineDash(landmark.importance === "secondary" ? [cell * 0.28, cell * 0.18] : []);
    ctx.strokeRect(x * cell + inset, y * cell + inset, width * cell - inset * 2, height * cell - inset * 2);
  }
  ctx.restore();
}

function drawRegionalFloorTreatment(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  x: number,
  y: number,
  zone: FloorTreatmentZone,
  themeId: LevelThemeId,
): void {
  const terrain = TERRAIN_PALETTES[themeId];
  const localX = x - zone.rect.x;
  const localY = y - zone.rect.y;
  const centerX = Math.floor((zone.rect.width - 1) / 2);
  const centerY = Math.floor((zone.rect.height - 1) / 2);
  ctx.save();
  ctx.strokeStyle = terrain.floorGlyph;
  ctx.fillStyle = terrain.floorSeam;
  ctx.lineWidth = Math.max(1, cell * 0.025);
  if (zone.treatment === "service_lane" || zone.treatment === "server_hall") {
    const vertical = zone.rect.height > zone.rect.width;
    if ((vertical && localX === centerX) || (!vertical && localY === centerY)) {
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(px + cell * 0.42, py);
        ctx.lineTo(px + cell * 0.42, py + cell);
        ctx.moveTo(px + cell * 0.58, py);
        ctx.lineTo(px + cell * 0.58, py + cell);
      } else {
        ctx.moveTo(px, py + cell * 0.42);
        ctx.lineTo(px + cell, py + cell * 0.42);
        ctx.moveTo(px, py + cell * 0.58);
        ctx.lineTo(px + cell, py + cell * 0.58);
      }
      ctx.stroke();
    }
  } else if (zone.treatment === "checkpoint_threshold") {
    if (localY === centerY) {
      ctx.fillRect(px, py + cell * 0.35, cell, cell * 0.08);
      ctx.fillRect(px, py + cell * 0.57, cell, cell * 0.08);
    }
  } else if (zone.treatment === "vault_grid") {
    if (localX % 3 === 0) ctx.fillRect(px + cell * 0.08, py, Math.max(1, cell * 0.035), cell);
    if (localY % 3 === 0) ctx.fillRect(px, py + cell * 0.08, cell, Math.max(1, cell * 0.035));
  } else if (zone.treatment === "loading_apron") {
    if (localY === 1 || localY === zone.rect.height - 2) {
      ctx.globalAlpha = 0.62;
      ctx.fillRect(px + (localX % 2 === 0 ? 0 : cell * 0.5), py + cell * 0.44, cell * 0.5, cell * 0.12);
    }
  } else if (zone.treatment === "machine_bay") {
    const perimeter = localX === 0 || localY === 0 || localX === zone.rect.width - 1 || localY === zone.rect.height - 1;
    if (perimeter && (localX + localY) % 3 === 0) {
      ctx.strokeRect(px + cell * 0.23, py + cell * 0.23, cell * 0.54, cell * 0.54);
    }
  } else if (zone.treatment === "collapsed_deck" || zone.treatment === "salvage_wear" || zone.treatment === "breach_scars") {
    if ((localX * 3 + localY * 5) % 11 === 0) {
      ctx.strokeStyle = terrain.floorWear;
      ctx.beginPath();
      ctx.moveTo(px + cell * 0.16, py + cell * 0.28);
      ctx.lineTo(px + cell * 0.48, py + cell * 0.52);
      ctx.lineTo(px + cell * 0.82, py + cell * 0.40);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  x: number,
  y: number,
  map: GameMap,
  themeId: LevelThemeId,
): void {
  const h = tileHash(Math.floor(x / 4), Math.floor(y / 4));
  const variant = environmentVariant("floor", x, y, themeId);
  const terrain = TERRAIN_PALETTES[themeId];
  ctx.fillStyle = (h & 1) === 0 ? terrain.floorBase : terrain.floorAlt;
  ctx.fillRect(px, py, cell, cell);
  ctx.strokeStyle = terrain.floorRim;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);

  const zone = floorTreatmentAt(map.environment, x, y);
  if (zone) {
    drawRegionalFloorTreatment(ctx, px, py, cell, x, y, zone, themeId);
    return;
  }

  // Ordinary floor is intentionally quiet. Rare recessed maintenance plates
  // use the theme family without adding isolated lights or barrier-like rails.
  if (variant === "service_hatch" || variant === "access_grid" || variant === "broken_plate" || variant === "maintenance_grate") {
    const inset = cell * 0.24;
    ctx.fillStyle = "rgba(3,8,12,.18)";
    ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = terrain.floorSeam;
    ctx.strokeRect(px + inset + 0.5, py + inset + 0.5, cell - inset * 2 - 1, cell - inset * 2 - 1);
  }
}

function drawWallTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  x: number,
  y: number,
  map: GameMap,
  themeId: LevelThemeId,
): void {
  const variant = environmentVariant("wall", x, y, themeId);
  const terrain = TERRAIN_PALETTES[themeId];
  const north = getTile(map, x, y - 1) === "wall";
  const east = getTile(map, x + 1, y) === "wall";
  const south = getTile(map, x, y + 1) === "wall";
  const west = getTile(map, x - 1, y) === "wall";
  const exposedCount = Number(!north) + Number(!east) + Number(!south) + Number(!west);
  const lip = Math.max(3, Math.round(cell * 0.12));
  const seam = Math.max(1, Math.round(cell * 0.025));
  const h = tileHash(x, y);
  const showInteriorDetail = exposedCount >= 2 || h % 11 === 0;

  // Walls are rendered as a connected raised mass. Interior tile boundaries
  // recede; only edges facing walkable space receive the strong light/dark
  // profile that makes the structure read as impassable at a glance.
  ctx.fillStyle = terrain.wallBase;
  ctx.fillRect(px, py, cell, cell);
  ctx.fillStyle = (h & 1) === 0 ? terrain.wallMid : terrain.wallAlt;
  ctx.fillRect(
    px + (west ? 0 : lip),
    py + (north ? 0 : lip),
    cell - (west ? 0 : lip) - (east ? 0 : lip),
    cell - (north ? 0 : lip) - (south ? 0 : lip),
  );

  if (!north) {
    const top = ctx.createLinearGradient(0, py, 0, py + lip);
    top.addColorStop(0, terrain.wallBevelHi);
    top.addColorStop(0.24, "#4f6f7b");
    top.addColorStop(1, terrain.wallMid);
    ctx.fillStyle = top;
    ctx.fillRect(px, py, cell, lip);
    ctx.fillStyle = "rgba(222,249,252,.72)";
    ctx.fillRect(px, py, cell, seam);
  } else {
    ctx.fillStyle = "rgba(3,8,12,.34)";
    ctx.fillRect(px, py, cell, seam);
  }
  if (!west) {
    const left = ctx.createLinearGradient(px, 0, px + lip, 0);
    left.addColorStop(0, "#648895");
    left.addColorStop(1, terrain.wallMid);
    ctx.fillStyle = left;
    ctx.fillRect(px, py, lip, cell);
    ctx.fillStyle = "rgba(192,235,241,.48)";
    ctx.fillRect(px, py, seam, cell);
  } else {
    ctx.fillStyle = "rgba(3,8,12,.28)";
    ctx.fillRect(px, py, seam, cell);
  }
  if (!south) {
    const bottom = ctx.createLinearGradient(0, py + cell - lip, 0, py + cell);
    bottom.addColorStop(0, terrain.wallMid);
    bottom.addColorStop(1, terrain.wallBevelLo);
    ctx.fillStyle = bottom;
    ctx.fillRect(px, py + cell - lip, cell, lip);
    ctx.fillStyle = "rgba(0,0,0,.88)";
    ctx.fillRect(px, py + cell - seam, cell, seam);
  }
  if (!east) {
    const right = ctx.createLinearGradient(px + cell - lip, 0, px + cell, 0);
    right.addColorStop(0, terrain.wallMid);
    right.addColorStop(1, terrain.wallBevelLo);
    ctx.fillStyle = right;
    ctx.fillRect(px + cell - lip, py, lip, cell);
    ctx.fillStyle = "rgba(0,0,0,.78)";
    ctx.fillRect(px + cell - seam, py, seam, cell);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    px + (west ? 0 : lip),
    py + (north ? 0 : lip),
    cell - (west ? 0 : lip) - (east ? 0 : lip),
    cell - (north ? 0 : lip) - (south ? 0 : lip),
  );
  ctx.clip();

  if (showInteriorDetail && (variant === "pipe_bank" || variant === "server_bank" || variant === "pipe_cluster")) {
    const vertical = (h & 1) === 0;
    const pipeW = Math.max(2, cell * 0.11);
    for (let i = -1; i <= 1; i++) {
      const offset = i * cell * 0.19;
      ctx.strokeStyle = i === 0 ? terrain.wallPipeHi : terrain.wallPipe;
      ctx.lineWidth = pipeW;
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(px + cell / 2 + offset, py + cell * 0.08);
        ctx.lineTo(px + cell / 2 + offset, py + cell * 0.92);
      } else {
        ctx.moveTo(px + cell * 0.08, py + cell / 2 + offset);
        ctx.lineTo(px + cell * 0.92, py + cell / 2 + offset);
      }
      ctx.stroke();
    }
    ctx.fillStyle = terrain.wallBracket;
    if (vertical) {
      ctx.fillRect(px + cell * 0.14, py + cell * 0.22, cell * 0.72, Math.max(1, cell * 0.05));
      ctx.fillRect(px + cell * 0.14, py + cell * 0.73, cell * 0.72, Math.max(1, cell * 0.05));
    } else {
      ctx.fillRect(px + cell * 0.22, py + cell * 0.14, Math.max(1, cell * 0.05), cell * 0.72);
      ctx.fillRect(px + cell * 0.73, py + cell * 0.14, Math.max(1, cell * 0.05), cell * 0.72);
    }
  } else if (showInteriorDetail && (variant === "system_panel" || variant === "security_panel" || variant === "patchwork_wall")) {
    const inset = cell * 0.15;
    ctx.fillStyle = terrain.wallMid;
    ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = terrain.wallBracket;
    ctx.strokeRect(px + inset + 0.5, py + inset + 0.5, cell - inset * 2 - 1, cell - inset * 2 - 1);
    ctx.fillStyle = terrain.wallScreen;
    ctx.fillRect(px + cell * 0.24, py + cell * 0.24, cell * 0.52, cell * 0.25);
    ctx.fillStyle = terrain.floorLight;
    ctx.fillRect(px + cell * 0.29, py + cell * 0.30, cell * 0.24, Math.max(1, cell * 0.025));
    ctx.fillStyle = terrain.wallLight;
    ctx.fillRect(px + cell * 0.64, py + cell * 0.30, Math.max(1, cell * 0.05), Math.max(1, cell * 0.05));
    ctx.strokeStyle = terrain.wallPanel;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(px + cell * 0.26, py + cell * (0.62 + i * 0.07));
      ctx.lineTo(px + cell * 0.74, py + cell * (0.62 + i * 0.07));
      ctx.stroke();
    }
  } else if (showInteriorDetail) {
    // Braces follow the wall run so neighboring tiles combine into one piece,
    // rather than repeating the square-with-an-X language of floor hatches.
    ctx.strokeStyle = terrain.wallPanel;
    ctx.lineWidth = Math.max(1, cell * 0.045);
    ctx.beginPath();
    if ((west || east) && !(north || south)) {
      ctx.moveTo(px, py + cell * 0.37);
      ctx.lineTo(px + cell, py + cell * 0.37);
      ctx.moveTo(px, py + cell * 0.63);
      ctx.lineTo(px + cell, py + cell * 0.63);
    } else if ((north || south) && !(west || east)) {
      ctx.moveTo(px + cell * 0.37, py);
      ctx.lineTo(px + cell * 0.37, py + cell);
      ctx.moveTo(px + cell * 0.63, py);
      ctx.lineTo(px + cell * 0.63, py + cell);
    } else {
      ctx.moveTo(px + cell * 0.18, py + cell * 0.50);
      ctx.lineTo(px + cell * 0.82, py + cell * 0.50);
      ctx.moveTo(px + cell * 0.50, py + cell * 0.18);
      ctx.lineTo(px + cell * 0.50, py + cell * 0.82);
    }
    ctx.stroke();
    const hubR = cell * 0.075;
    ctx.fillStyle = terrain.wallBase;
    ctx.beginPath();
    ctx.arc(px + cell / 2, py + cell / 2, hubR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = terrain.wallBracket;
    ctx.stroke();
  }
  ctx.restore();

  // Exposed corners get compact structural fasteners. They remain visible at
  // 28 px without turning every wall tile into an icon.
  if (exposedCount >= 2) {
    const bolt = Math.max(1.5, cell * 0.035);
    ctx.fillStyle = "rgba(205,238,242,.70)";
    if (!north && !west) ctx.fillRect(px + lip * 0.42, py + lip * 0.42, bolt, bolt);
    if (!north && !east) ctx.fillRect(px + cell - lip * 0.58 - bolt, py + lip * 0.42, bolt, bolt);
    if (!south && !west) ctx.fillRect(px + lip * 0.42, py + cell - lip * 0.58 - bolt, bolt, bolt);
    if (!south && !east) ctx.fillRect(px + cell - lip * 0.58 - bolt, py + cell - lip * 0.58 - bolt, bolt, bolt);
  }

  if (exposedCount >= 2 && (h & 0x1f) === 0) {
    const dotSize = Math.max(1, Math.floor(cell * 0.07));
    ctx.shadowColor = terrain.wallLight;
    ctx.shadowBlur = cell * 0.16;
    ctx.fillStyle = terrain.wallLight;
    ctx.fillRect(px + cell - dotSize - 3, py + 3, dotSize, dotSize);
    ctx.shadowBlur = 0;
  }
}

function drawHalfCoverTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  x: number,
  y: number,
  map: GameMap,
  themeId: LevelThemeId,
): void {
  drawFloorTile(ctx, px, py, cell, x, y, map, themeId);
  const variant = environmentVariant("half_cover", x, y, themeId);
  const terrain = TERRAIN_PALETTES[themeId];
  const inset = Math.max(2, Math.floor(cell * 0.13));
  const ox = px + inset;
  const oy = py + inset;
  const ow = cell - inset * 2;
  const oh = cell - inset * 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.65)";
  ctx.shadowBlur = cell * 0.12;
  ctx.shadowOffsetY = cell * 0.05;

  if (variant === "cargo" || variant === "salvage_pile" || variant === "console") {
    ctx.fillStyle = terrain.coverFill;
    ctx.fillRect(ox, oy, ow, oh);
    ctx.fillStyle = terrain.coverTop;
    ctx.fillRect(ox, oy, ow, Math.max(2, cell * 0.08));
    ctx.strokeStyle = terrain.coverRim;
    ctx.strokeRect(ox + 0.5, oy + 0.5, ow - 1, oh - 1);
    ctx.fillStyle = PALETTE.UNIT_METAL;
    ctx.fillRect(ox + ow * 0.14, oy, ow * 0.10, oh);
    ctx.fillRect(ox + ow * 0.76, oy, ow * 0.10, oh);
    ctx.fillStyle = themeId === "data_core" ? terrain.floorLight : "rgba(244,216,132,.72)";
    ctx.fillRect(ox + ow * 0.34, oy + oh * 0.38, ow * 0.32, oh * 0.18);
  } else if (variant === "barricade" || variant === "security_barricade" || variant === "improvised_barricade") {
    ctx.fillStyle = terrain.machineryFill;
    ctx.fillRect(ox, oy + oh * 0.12, ow, oh * 0.76);
    ctx.strokeStyle = PALETTE.UNIT_METAL_HI;
    ctx.strokeRect(ox + 0.5, oy + oh * 0.12 + 0.5, ow - 1, oh * 0.76 - 1);
    const stripes = 5;
    const stripeW = ow / stripes;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy + oh * 0.25, ow, oh * 0.28);
    ctx.clip();
    for (let i = -1; i <= stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? terrain.hazardA : terrain.hazardB;
      ctx.beginPath();
      ctx.moveTo(ox + i * stripeW, oy + oh * 0.53);
      ctx.lineTo(ox + (i + 1) * stripeW, oy + oh * 0.53);
      ctx.lineTo(ox + (i + 2) * stripeW, oy + oh * 0.25);
      ctx.lineTo(ox + (i + 1) * stripeW, oy + oh * 0.25);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = PALETTE.UNIT_METAL_HI;
    ctx.fillRect(ox + ow * 0.08, oy, ow * 0.12, oh);
    ctx.fillRect(ox + ow * 0.80, oy, ow * 0.12, oh);
  } else {
    // A compact reactor/coolant unit: still unmistakably half cover, but it
    // breaks up the repeated crate language of the original renderer.
    ctx.fillStyle = terrain.machineryFill;
    ctx.beginPath();
    ctx.ellipse(px + cell / 2, py + cell / 2, ow * 0.45, oh * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.UNIT_METAL_HI;
    ctx.lineWidth = Math.max(1, cell * 0.04);
    ctx.stroke();
    ctx.fillStyle = terrain.machineryTop;
    ctx.beginPath();
    ctx.ellipse(px + cell / 2, py + cell / 2, ow * 0.31, oh * 0.31, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = terrain.coolant;
    ctx.shadowBlur = cell * 0.15;
    ctx.strokeStyle = terrain.coolant;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.beginPath();
    ctx.arc(px + cell / 2, py + cell / 2, ow * 0.19, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.UNIT_METAL_HI;
    ctx.fillRect(ox, py + cell / 2 - cell * 0.035, ow, cell * 0.07);
  }
  ctx.restore();
}

function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  len: number,
  inset: number,
): void {
  ctx.beginPath();
  ctx.moveTo(px + inset, py + inset + len);
  ctx.lineTo(px + inset, py + inset);
  ctx.lineTo(px + inset + len, py + inset);
  ctx.moveTo(px + cell - inset - len, py + inset);
  ctx.lineTo(px + cell - inset, py + inset);
  ctx.lineTo(px + cell - inset, py + inset + len);
  ctx.moveTo(px + inset, py + cell - inset - len);
  ctx.lineTo(px + inset, py + cell - inset);
  ctx.lineTo(px + inset + len, py + cell - inset);
  ctx.moveTo(px + cell - inset - len, py + cell - inset);
  ctx.lineTo(px + cell - inset, py + cell - inset);
  ctx.lineTo(px + cell - inset, py + cell - inset - len);
  ctx.stroke();
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  fill: string,
  border: string,
  kind: "move" | "target",
): void {
  ctx.save();
  ctx.globalAlpha = kind === "target" ? 0.08 : PALETTE.HL_FILL_OPACITY;
  ctx.fillStyle = fill;
  const inset = kind === "target" ? cell * 0.14 : cell * 0.20;
  if (kind === "target") {
    ctx.beginPath();
    ctx.ellipse(px + cell / 2, py + cell * 0.66, cell * 0.34, cell * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(px + cell / 2, py + inset);
    ctx.lineTo(px + cell - inset, py + cell / 2);
    ctx.lineTo(px + cell / 2, py + cell - inset);
    ctx.lineTo(px + inset, py + cell / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (kind === "move") {
    ctx.strokeStyle = border;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.beginPath();
    ctx.moveTo(px + cell / 2, py + inset);
    ctx.lineTo(px + cell - inset, py + cell / 2);
    ctx.lineTo(px + cell / 2, py + cell - inset);
    ctx.lineTo(px + inset, py + cell / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawSightLine(
  ctx: CanvasRenderingContext2D,
  cell: number,
  line: SightLine,
): void {
  const originX = line.fromX * cell + cell / 2;
  const originY = line.fromY * cell + cell / 2;
  const toX = line.toX * cell + cell / 2;
  const toY = line.toY * cell + cell / 2;
  const isPeek = line.mode === "peek" && line.shooterX !== undefined && line.shooterY !== undefined;
  const shooterX = (line.shooterX ?? line.fromX) * cell + cell / 2;
  const shooterY = (line.shooterY ?? line.fromY) * cell + cell / 2;
  const shoulderX = (line.peekShoulderX ?? line.fromX) * cell + cell / 2;
  const shoulderY = (line.peekShoulderY ?? line.fromY) * cell + cell / 2;
  const peekDx = shoulderX - shooterX;
  const peekDy = shoulderY - shooterY;
  const peekLength = Math.hypot(peekDx, peekDy) || 1;
  const startX = isPeek ? shooterX + (peekDx / peekLength) * cell * 0.34 : originX;
  const startY = isPeek ? shooterY + (peekDy / peekLength) * cell * 0.34 : originY;

  const outerW = Math.max(2, Math.floor(cell * 0.09));
  const innerW = Math.max(1, Math.floor(cell * 0.025));
  const tracePath = () => {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    if (isPeek) ctx.lineTo(originX, originY);
    ctx.lineTo(toX, toY);
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([Math.max(3, cell * 0.16), Math.max(2, cell * 0.12)]);

  ctx.strokeStyle = line.hasCover ? PALETTE.SIGHT_COVER_OUTER : PALETTE.SIGHT_CLEAR_OUTER;
  ctx.lineWidth = outerW;
  tracePath();
  ctx.stroke();

  ctx.strokeStyle = line.hasCover ? PALETTE.SIGHT_COVER_INNER : PALETTE.SIGHT_CLEAR_INNER;
  ctx.lineWidth = innerW;
  tracePath();
  ctx.stroke();

  ctx.setLineDash([]);
  if (isPeek) {
    const marker = Math.max(3, cell * 0.10);
    ctx.shadowColor = PALETTE.SIGHT_CLEAR_INNER;
    ctx.shadowBlur = cell * 0.12;
    ctx.fillStyle = "#071018";
    ctx.strokeStyle = PALETTE.SIGHT_CLEAR_INNER;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.beginPath();
    ctx.arc(originX, originY, marker, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(originX - (peekDx / peekLength) * marker * 0.45, originY - (peekDy / peekLength) * marker * 0.45);
    ctx.lineTo(originX + (peekDx / peekLength) * marker * 0.55, originY + (peekDy / peekLength) * marker * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMuzzleSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  angle: number,
  color: string,
  strength: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = strength;
  ctx.shadowColor = color;
  ctx.shadowBlur = cell * 0.22;
  ctx.fillStyle = "#fff6d5";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(cell * 0.24, -cell * 0.07);
  ctx.lineTo(cell * 0.15, 0);
  ctx.lineTo(cell * 0.24, cell * 0.07);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, cell * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawImpactSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  effect: ShotEffect,
  progress: number,
): void {
  if (progress <= 0 || progress >= 1) return;
  const teamColor = effect.targetTeam === "player" ? "#62e7ff" : "#ff6b72";
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 1 - progress;
  if (!effect.hit) {
    ctx.strokeStyle = "#dcebf0";
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.setLineDash([cell * 0.08, cell * 0.06]);
    ctx.beginPath();
    ctx.moveTo(-cell * 0.13, -cell * 0.13);
    ctx.lineTo(cell * 0.13, cell * 0.13);
    ctx.moveTo(cell * 0.13, -cell * 0.13);
    ctx.lineTo(-cell * 0.13, cell * 0.13);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const radius = cell * (0.10 + progress * 0.34);
  ctx.shadowColor = teamColor;
  ctx.shadowBlur = cell * 0.18 * (1 - progress);
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = Math.max(1, cell * 0.055 * (1 - progress));
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#fff4c2";
  for (let i = 0; i < 7; i++) {
    const angle = i * (Math.PI * 2 / 7) + 0.35;
    const distance = cell * (0.10 + progress * (0.22 + (i % 3) * 0.04));
    const size = Math.max(1.5, cell * (0.045 - progress * 0.022));
    ctx.save();
    ctx.rotate(angle);
    ctx.translate(distance, 0);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

function projectileMuzzleReach(projectile: ProjectileKind): number {
  if (projectile === "pulse") return 0.31;
  if (projectile === "scatter") return 0.42;
  if (projectile === "rail") return 0.56;
  if (projectile === "heavy") return 0.47;
  return 0.45;
}

/**
 * Combat uses the exposure tile as the legal line-of-fire origin. Artwork uses
 * the recorded shooter tile plus the character's lean and barrel length so a
 * peek shot visibly leaves the gun instead of materialising one cell away.
 */
function shotVisualOrigin(
  effect: ShotEffect,
  cell: number,
): { x: number; y: number } {
  const shooterX = effect.shooterX * cell + cell / 2;
  const shooterY = effect.shooterY * cell + cell / 2;
  const aimX = effect.toX - effect.fromX;
  const aimY = effect.toY - effect.fromY;
  const aimLength = Math.hypot(aimX, aimY) || 1;
  const aimDir = { x: aimX / aimLength, y: aimY / aimLength };

  let leanX = 0;
  let leanY = 0;
  if (effect.mode === "peek") {
    const hasShoulder = effect.peekShoulderX !== undefined && effect.peekShoulderY !== undefined;
    const peekX = (hasShoulder ? effect.peekShoulderX! : effect.fromX) - effect.shooterX;
    const peekY = (hasShoulder ? effect.peekShoulderY! : effect.fromY) - effect.shooterY;
    const peekLength = Math.hypot(peekX, peekY) || 1;
    leanX = (peekX / peekLength) * cell * PLAYER_POSE.peekOffset;
    leanY = (peekY / peekLength) * cell * PLAYER_POSE.peekOffset;
  }

  const reach = projectileMuzzleReach(effect.projectile) * cell;
  return {
    x: shooterX + leanX + aimDir.x * reach,
    y: shooterY + leanY + aimDir.y * reach,
  };
}

/**
 * A target may be legally exposed from the adjacent peek tile while its body
 * remains rendered as a short lean from its home tile. Keep combat's exposure
 * coordinate in the effect, but terminate the artwork on that rendered body.
 */
function shotVisualEndpoint(
  effect: ShotEffect,
  cell: number,
): { x: number; y: number } {
  const targetX = effect.targetX * cell + cell / 2;
  const targetY = effect.targetY * cell + cell / 2;
  const exposureX = effect.toX - effect.targetX;
  const exposureY = effect.toY - effect.targetY;
  const exposureLength = Math.hypot(exposureX, exposureY);
  if (exposureLength === 0) return { x: targetX, y: targetY };
  return {
    x: targetX + (exposureX / exposureLength) * cell * PLAYER_POSE.peekOffset,
    y: targetY + (exposureY / exposureLength) * cell * PLAYER_POSE.peekOffset,
  };
}

function effectHash(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function missedEndpoint(
  effect: ShotEffect,
  from: { x: number; y: number },
  target: { x: number; y: number },
  cell: number,
): { x: number; y: number } {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const hash = effectHash(effect.id);
  const side = (hash & 1) === 0 ? -1 : 1;
  const lateral = cell * (0.44 + ((hash >>> 8) & 0x3) * 0.045) * side;
  const forward = cell * (((hash >>> 4) & 0x3) - 1.5) * 0.045;
  return {
    x: target.x - uy * lateral + ux * forward,
    y: target.y + ux * lateral + uy * forward,
  };
}

type EffectPathPoint = { x: number; y: number };

function shotEffectPath(
  effect: ShotEffect,
  cell: number,
  origin: EffectPathPoint,
  endpoint: EffectPathPoint,
): EffectPathPoint[] {
  if (
    effect.mode !== "peek" ||
    effect.peekShoulderX === undefined ||
    effect.peekShoulderY === undefined
  ) {
    return [origin, endpoint];
  }

  const shooter = {
    x: effect.shooterX * cell + cell / 2,
    y: effect.shooterY * cell + cell / 2,
  };
  const shoulder = {
    x: effect.peekShoulderX * cell + cell / 2,
    y: effect.peekShoulderY * cell + cell / 2,
  };
  const exposure = {
    x: effect.fromX * cell + cell / 2,
    y: effect.fromY * cell + cell / 2,
  };
  const sideX = Math.sign(shoulder.x - shooter.x);
  const sideY = Math.sign(shoulder.y - shooter.y);
  const wallX = Math.sign(exposure.x - shoulder.x);
  const wallY = Math.sign(exposure.y - shoulder.y);
  // This point sits just beyond the wall corner on the open shoulder side.
  // Routing through it prevents a legal peek tracer from being painted as a
  // straight line across the connected wall that the shooter is using.
  const clearance = {
    x: shooter.x + sideX * cell * 0.52 + wallX * cell * 0.48,
    y: shooter.y + sideY * cell * 0.52 + wallY * cell * 0.48,
  };
  return [origin, clearance, exposure, endpoint];
}

function pointAlongEffectPath(
  points: EffectPathPoint[],
  progress: number,
): { x: number; y: number; ux: number; uy: number } {
  const segments = points.slice(1).map((point, index) => {
    const start = points[index];
    return { start, end: point, length: Math.hypot(point.x - start.x, point.y - start.y) };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0) || 1;
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (const segment of segments) {
    if (remaining <= segment.length || segment === segments[segments.length - 1]) {
      const ratio = segment.length > 0 ? Math.min(1, remaining / segment.length) : 1;
      const ux = segment.length > 0 ? (segment.end.x - segment.start.x) / segment.length : 1;
      const uy = segment.length > 0 ? (segment.end.y - segment.start.y) / segment.length : 0;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
        ux,
        uy,
      };
    }
    remaining -= segment.length;
  }
  const end = points[points.length - 1];
  return { x: end.x, y: end.y, ux: 1, uy: 0 };
}

function traceEffectPath(
  ctx: CanvasRenderingContext2D,
  points: EffectPathPoint[],
  progress: number,
): void {
  const head = pointAlongEffectPath(points, progress);
  const segments = points.slice(1).map((point, index) => ({
    start: points[index],
    end: point,
    length: Math.hypot(point.x - points[index].x, point.y - points[index].y),
  }));
  const total = segments.reduce((sum, segment) => sum + segment.length, 0) || 1;
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const segment of segments) {
    if (remaining >= segment.length) {
      ctx.lineTo(segment.end.x, segment.end.y);
      remaining -= segment.length;
      continue;
    }
    ctx.lineTo(head.x, head.y);
    break;
  }
}

function drawShotEffect(
  ctx: CanvasRenderingContext2D,
  cell: number,
  effect: ShotEffect,
  nowMs: number,
): void {
  const progress = shotEffectProgress(effect, nowMs);
  if (progress < 0 || progress > 1) return;
  const visualOrigin = shotVisualOrigin(effect, cell);
  const fromX = visualOrigin.x;
  const fromY = visualOrigin.y;
  const targetEndpoint = shotVisualEndpoint(effect, cell);
  const visualEndpoint = effect.hit
    ? targetEndpoint
    : missedEndpoint(effect, visualOrigin, targetEndpoint, cell);
  const toX = visualEndpoint.x;
  const toY = visualEndpoint.y;
  const path = shotEffectPath(effect, cell, visualOrigin, visualEndpoint);
  const initialDx = path[1].x - path[0].x;
  const initialDy = path[1].y - path[0].y;
  const initialLength = Math.hypot(initialDx, initialDy) || 1;
  let ux = initialDx / initialLength;
  let uy = initialDy / initialLength;
  const angle = Math.atan2(initialDy, initialDx);
  const travel = Math.min(1, progress / 0.70);
  const easedTravel = 1 - Math.pow(1 - travel, 2);
  const head = pointAlongEffectPath(path, easedTravel);
  const headX = head.x;
  const headY = head.y;
  ux = head.ux;
  uy = head.uy;
  const headPx = -uy;
  const headPy = ux;
  const playerShot = effect.shooterTeam === "player";
  const baseColor = playerShot ? "#69e9ff" : "#ff765c";

  if (progress < 0.18) {
    drawMuzzleSprite(ctx, fromX, fromY, cell, angle, baseColor, 1 - progress / 0.18);
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = baseColor;
  ctx.shadowBlur = cell * 0.16;

  if (effect.projectile === "scatter") {
    for (let i = -2; i <= 2; i++) {
      const spread = i * cell * 0.055 * travel;
      const pelletX = headX + headPx * spread;
      const pelletY = headY + headPy * spread;
      ctx.strokeStyle = i === 0 ? "#fff3bd" : "#ffb45f";
      ctx.lineWidth = Math.max(1, cell * 0.035);
      ctx.beginPath();
      ctx.moveTo(pelletX - ux * cell * 0.11, pelletY - uy * cell * 0.11);
      ctx.lineTo(pelletX, pelletY);
      ctx.stroke();
    }
  } else if (effect.projectile === "heavy") {
    const radius = cell * (0.10 + Math.sin(progress * Math.PI * 10) * 0.018);
    ctx.fillStyle = "#fff0a3";
    ctx.beginPath();
    ctx.arc(headX, headY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ff9d43";
    ctx.lineWidth = Math.max(1, cell * 0.045);
    ctx.beginPath();
    ctx.arc(headX, headY, radius * 1.55, 0, Math.PI * 2);
    ctx.stroke();
  } else if (effect.projectile === "rail") {
    ctx.globalAlpha = Math.max(0, 1 - progress * 0.72);
    ctx.strokeStyle = "#9b7cff";
    ctx.lineWidth = Math.max(2, cell * 0.075);
    traceEffectPath(ctx, path, easedTravel);
    ctx.stroke();
    ctx.strokeStyle = "#f2ecff";
    ctx.lineWidth = Math.max(1, cell * 0.022);
    ctx.stroke();
  } else {
    const length = effect.projectile === "pulse" ? cell * 0.18 : cell * 0.32;
    ctx.strokeStyle = effect.projectile === "pulse" ? "#ff7de3" : baseColor;
    ctx.lineWidth = Math.max(2, cell * (effect.projectile === "pulse" ? 0.085 : 0.045));
    ctx.beginPath();
    ctx.moveTo(headX - ux * length, headY - uy * length);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    ctx.strokeStyle = "#eaffff";
    ctx.lineWidth = Math.max(1, cell * 0.022);
    ctx.stroke();
  }
  ctx.restore();

  drawImpactSprite(ctx, toX, toY, cell, effect, Math.max(0, (progress - 0.68) / 0.32));
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  u: Unit,
  isSelected: boolean,
  mapHeightPx: number,
  map: GameMap,
  nowMs: number,
  showUnitUi: boolean,
  firingEffect?: ShotEffect,
  hitEffect?: ShotEffect,
  aimingLine?: SightLine,
  movementEffect?: MovementEffect,
): void {
  const cx = px + cell / 2;
  const cy = py + cell / 2;
  const fresh = u.ap === u.maxAp;
  const spent = u.ap === 0;

  const bodyColor =
    u.team === "player"
      ? spent
        ? PALETTE.PLAYER_BODY_SPENT
        : PALETTE.PLAYER_BODY
      : spent
        ? PALETTE.ENEMY_BODY_SPENT
        : PALETTE.ENEMY_BODY;

  const visual = computeUnitVisualState(map, u, nowMs);
  if (aimingLine) {
    const aimX = aimingLine.toX - aimingLine.fromX;
    const aimY = aimingLine.toY - aimingLine.fromY;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    visual.aimingDir = { x: aimX / aimLength, y: aimY / aimLength };
    if (aimingLine.mode === "peek") {
      const peekX = (aimingLine.peekShoulderX ?? aimingLine.fromX) - (aimingLine.shooterX ?? u.x);
      const peekY = (aimingLine.peekShoulderY ?? aimingLine.fromY) - (aimingLine.shooterY ?? u.y);
      const peekLength = Math.hypot(peekX, peekY) || 1;
      visual.peekDir = { x: peekX / peekLength, y: peekY / peekLength };
    }
  }
  if (firingEffect) {
    visual.firing = Math.max(0, Math.min(1, shotEffectProgress(firingEffect, nowMs)));
    const aimX = firingEffect.toX - firingEffect.fromX;
    const aimY = firingEffect.toY - firingEffect.fromY;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    visual.aimingDir = { x: aimX / aimLength, y: aimY / aimLength };
    if (firingEffect.mode === "peek") {
      const peekX = (firingEffect.peekShoulderX ?? firingEffect.fromX) - firingEffect.shooterX;
      const peekY = (firingEffect.peekShoulderY ?? firingEffect.fromY) - firingEffect.shooterY;
      const peekLength = Math.hypot(peekX, peekY) || 1;
      visual.peekDir = { x: peekX / peekLength, y: peekY / peekLength };
    }
  }
  if (hitEffect) {
    const progress = Math.max(0, Math.min(1, shotEffectProgress(hitEffect, nowMs)));
    visual.hitReaction = progress < 0.64 ? 0 : Math.sin(((progress - 0.64) / 0.36) * Math.PI);
    const hitX = hitEffect.toX - hitEffect.fromX;
    const hitY = hitEffect.toY - hitEffect.fromY;
    const hitLength = Math.hypot(hitX, hitY) || 1;
    visual.hitDir = { x: hitX / hitLength, y: hitY / hitLength };
    if (u.hp <= 0) {
      const fadeProgress = Math.max(0, Math.min(1, (progress - 0.74) / 0.26));
      visual.defeatedFade = 1 - fadeProgress * 0.92;
    }
  }
  if (movementEffect) {
    const progress = Math.max(0, Math.min(1, movementEffectProgress(movementEffect, nowMs)));
    visual.moving = Math.sin(progress * Math.PI);
    const moveX = movementEffect.toX - movementEffect.fromX;
    const moveY = movementEffect.toY - movementEffect.fromY;
    const moveLength = Math.hypot(moveX, moveY) || 1;
    visual.moveDir = { x: moveX / moveLength, y: moveY / moveLength };
    if (!firingEffect && !aimingLine) visual.aimingDir = visual.moveDir;
  }

  if (showUnitUi && fresh && !spent && u.team === "player") {
    ctx.save();
    ctx.shadowColor = PALETTE.FRESH_GLOW_PLAYER;
    ctx.shadowBlur = Math.max(3, Math.floor(cell * 0.12));
    ctx.strokeStyle = PALETTE.FRESH_PLAYER;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = Math.max(1, Math.floor(cell * 0.035));
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy + cell * 0.22,
      cell * 0.30,
      cell * 0.12,
      0,
      Math.PI * 0.12,
      Math.PI * 0.88,
    );
    ctx.stroke();
    ctx.restore();
  }

  drawUnitSilhouette(ctx, px, py, cell, u, bodyColor, visual);
  if (u.hp > 0) drawArchetypeBadge(ctx, px, py, cell, u);

  if (showUnitUi && u.overwatch) {
    const ringR = cell * 0.38;
    ctx.save();
    ctx.shadowColor = PALETTE.OVERWATCH;
    ctx.shadowBlur = cell * 0.10;
    ctx.strokeStyle = PALETTE.OVERWATCH;
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = Math.max(1.5, cell * 0.04);
    ctx.setLineDash([cell * 0.13, cell * 0.09]);
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, Math.PI * 0.14, Math.PI * 1.86);
    ctx.stroke();
    ctx.setLineDash([]);
    const badgeSize = Math.max(7, Math.floor(cell * 0.18));
    ctx.font = `900 ${badgeSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.OVERWATCH;
    ctx.fillText("OW", px + cell * 0.20, py + cell * 0.78);
    ctx.restore();
  }

  if (showUnitUi && isSelected) {
    ctx.save();
    ctx.shadowColor = PALETTE.SELECTED_GLOW;
    ctx.shadowBlur = cell * 0.16;
    ctx.fillStyle = "rgba(90,214,255,.11)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + cell * 0.20, cell * 0.35, cell * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.SELECTED;
    ctx.lineWidth = Math.max(1.5, cell * 0.045);
    drawCornerBrackets(ctx, px, py, cell, Math.max(4, Math.floor(cell * 0.18)), cell * 0.06);
    ctx.restore();
  }

  if (showUnitUi && u.hp > 0) {
    drawHpChip(ctx, px, py, cell, u);
    drawApPips(ctx, px, py, cell, u, mapHeightPx);
  }
}

function drawArchetypeBadge(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  unit: Unit,
): void {
  if (!unit.archetypeId) return;
  const codes: Record<string, string> = {
    operator: "RK",
    runner: "VX",
    bulwark: "HX",
    scrapper: "SC",
    rifleman: "RF",
    marksman: "MK",
    sentinel: "SN",
  };
  const code = codes[unit.archetypeId];
  if (!code) return;
  const size = Math.max(7, Math.floor(cell * 0.18));
  ctx.save();
  ctx.font = `800 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = unit.team === "player" ? PALETTE.PLAYER_BODY : PALETTE.ENEMY_BODY;
  ctx.fillText(code, px + 2, py + 2);
  ctx.restore();
}

function drawHpChip(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  u: Unit,
): void {
  const fontSize = Math.max(7, Math.floor(cell * 0.22));
  const text = `${u.hp}`;
  ctx.font = `800 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(text).width;
  const padX = Math.max(3, cell * 0.06);
  const chipW = textW + padX * 2;
  const chipH = fontSize + Math.max(4, cell * 0.09);
  const chipX = px + cell / 2 - chipW / 2;
  const aboveY = py - chipH - 1;
  const chipY = aboveY >= 0 ? aboveY : py + 1;
  const healthRatio = Math.max(0, Math.min(1, u.hp / u.maxHp));
  const healthColor = healthRatio > 0.66 ? "#61e6bb" : healthRatio > 0.33 ? "#ffd166" : "#ff6677";

  ctx.save();
  roundRect(ctx, chipX, chipY, chipW, chipH, 3);
  ctx.fillStyle = PALETTE.HP_CHIP_BG;
  ctx.fill();
  ctx.strokeStyle = u.team === "player" ? PALETTE.HP_CHIP_BORDER : "rgba(255,115,129,.58)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = PALETTE.HP_TEXT;
  ctx.fillText(text, chipX + chipW / 2, chipY + chipH * 0.42);
  const barInset = 2;
  const barH = Math.max(1.5, cell * 0.035);
  ctx.fillStyle = "rgba(255,255,255,.10)";
  ctx.fillRect(chipX + barInset, chipY + chipH - barH - barInset, chipW - barInset * 2, barH);
  ctx.fillStyle = healthColor;
  ctx.fillRect(chipX + barInset, chipY + chipH - barH - barInset, (chipW - barInset * 2) * healthRatio, barH);
  ctx.restore();
}

function drawApPips(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  u: Unit,
  mapHeightPx: number,
): void {
  const pipCount = u.maxAp;
  if (pipCount <= 0) return;
  const cx = px + cell / 2;
  const pipR = Math.max(1.5, cell * 0.042);
  const gap = Math.max(1.5, pipR * 1.5);
  const totalW = pipCount * pipR * 2 + (pipCount - 1) * gap;
  const startX = cx - totalW / 2 + pipR;
  const belowY = py + cell + pipR + 1;
  const pipY = belowY + pipR <= mapHeightPx ? belowY : py + cell - pipR - 2;
  const fillColor = u.team === "player" ? PALETTE.PIP_PLAYER_FILL : PALETTE.PIP_ENEMY_FILL;
  ctx.save();
  for (let i = 0; i < pipCount; i++) {
    const pcx = startX + i * (pipR * 2 + gap);
    ctx.beginPath();
    ctx.moveTo(pcx, pipY - pipR);
    ctx.lineTo(pcx + pipR, pipY);
    ctx.lineTo(pcx, pipY + pipR);
    ctx.lineTo(pcx - pipR, pipY);
    ctx.closePath();
    if (i < u.ap) {
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = PALETTE.PIP_OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.strokeStyle = PALETTE.PIP_EMPTY_STROKE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCoverIndicator(
  ctx: CanvasRenderingContext2D,
  cell: number,
  ind: CoverIndicator,
): void {
  const px = ind.x * cell;
  const py = ind.y * cell;
  const isWall = ind.kind === "wall";
  const fillColor = isWall ? PALETTE.COVER_WALL : PALETTE.COVER_HALF;
  const thickness = Math.max(3, Math.floor(cell * 0.1));
  const halfInset = Math.max(2, Math.floor(cell * 0.18));
  const edgeOffset = Math.max(1, Math.floor(cell * 0.04));
  const hatchSpacing = Math.max(3, Math.floor(cell * 0.18));
  const inset = isWall ? 0 : halfInset;

  let bx = 0;
  let by = 0;
  let bw = 0;
  let bh = 0;
  if (ind.side === "n") {
    bx = px + inset;
    by = py + edgeOffset;
    bw = cell - inset * 2;
    bh = thickness;
  } else if (ind.side === "s") {
    bx = px + inset;
    by = py + cell - edgeOffset - thickness;
    bw = cell - inset * 2;
    bh = thickness;
  } else if (ind.side === "w") {
    bx = px + edgeOffset;
    by = py + inset;
    bw = thickness;
    bh = cell - inset * 2;
  } else {
    bx = px + cell - edgeOffset - thickness;
    by = py + inset;
    bw = thickness;
    bh = cell - inset * 2;
  }

  const radius = Math.max(1, Math.floor(thickness * 0.3));
  roundRect(ctx, bx, by, bw, bh, radius);
  ctx.fillStyle = fillColor;
  ctx.fill();

  if (isWall) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    ctx.strokeStyle = PALETTE.COVER_HATCH;
    ctx.lineWidth = 1;
    const start = -bh;
    const end = bw + bh;
    for (let d = start; d <= end; d += hatchSpacing) {
      ctx.beginPath();
      ctx.moveTo(bx + d, by);
      ctx.lineTo(bx + d - bh, by + bh);
      ctx.stroke();
    }
    ctx.restore();
  }

  roundRect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, radius);
  ctx.strokeStyle = PALETTE.COVER_OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawThreatMarker(
  ctx: CanvasRenderingContext2D,
  cell: number,
  m: ThreatMarker,
  pulse: number,
): void {
  const px = m.x * cell;
  const py = m.y * cell;
  const ecx = px + cell * 0.83;
  const ecy = py + cell * 0.20;
  const r = cell * 0.105;

  ctx.save();
  ctx.globalAlpha = 0.72 + pulse * 0.24;
  ctx.shadowColor = PALETTE.THREAT_RING;
  ctx.shadowBlur = cell * 0.10 * pulse;

  // A compact warning chevron means "this enemy has a firing solution".
  // It replaces the old eye/crosshair, which looked like a player targeting
  // reticle and competed with the actual hit-chance preview.
  ctx.beginPath();
  ctx.moveTo(ecx, ecy - r);
  ctx.lineTo(ecx + r, ecy + r * 0.72);
  ctx.lineTo(ecx, ecy + r * 0.42);
  ctx.lineTo(ecx - r, ecy + r * 0.72);
  ctx.closePath();
  ctx.fillStyle = PALETTE.THREAT_PUPIL;
  ctx.fill();
  ctx.strokeStyle = PALETTE.THREAT_RING;
  ctx.lineWidth = Math.max(1, cell * 0.03);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = PALETTE.THREAT_GLINT;
  ctx.font = `900 ${Math.max(6, Math.floor(cell * 0.14))}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", ecx, ecy + cell * 0.005);

  ctx.restore();
}

function drawShieldIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  fill: string,
  outline: string,
): void {
  const w = h * 0.80;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x + w, y + h * 0.18);
  ctx.quadraticCurveTo(x + w, y + h * 0.35, x + w * 0.92, y + h * 0.55);
  ctx.lineTo(x + w * 0.5, y + h);
  ctx.lineTo(x + w * 0.08, y + h * 0.55);
  ctx.quadraticCurveTo(x, y + h * 0.35, x, y + h * 0.18);
  ctx.lineTo(x + w * 0.5, y);
  ctx.closePath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.20, y + h * 0.16);
  ctx.lineTo(x + w * 0.42, y + h * 0.09);
  ctx.stroke();
}

function drawEnemyPreview(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  p: EnemyPreview,
): void {
  const text = `${p.hitPct}%`;
  const chanceColor = p.hitPct >= 70
    ? PALETTE.PREVIEW_BORDER_HI
    : p.hitPct >= 45
      ? PALETTE.PREVIEW_BORDER_MID
      : PALETTE.PREVIEW_BORDER_LO;
  const textColor = p.hitPct >= 70
    ? PALETTE.PREVIEW_TEXT_HI
    : p.hitPct >= 45
      ? PALETTE.PREVIEW_TEXT_MID
      : PALETTE.PREVIEW_TEXT_LO;

  ctx.save();
  ctx.shadowColor = chanceColor;
  ctx.shadowBlur = cell * 0.08;
  ctx.strokeStyle = chanceColor;
  ctx.lineWidth = Math.max(1.5, cell * 0.04);
  drawCornerBrackets(
    ctx,
    px + cell * 0.045,
    py + cell * 0.045,
    cell * 0.91,
    Math.max(4, cell * 0.15),
    0,
  );
  ctx.shadowBlur = 0;

  const fontSize = Math.max(7, Math.floor(cell * 0.22));
  ctx.font = `800 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(text).width;
  const padX = Math.max(3, cell * 0.07);
  const pillH = fontSize + Math.max(3, cell * 0.07);
  const pillW = textW + padX * 2;
  const pillX = px + cell - pillW - cell * 0.055;
  const pillY = py + cell - pillH - cell * 0.055;

  roundRect(ctx, pillX, pillY, pillW, pillH, 3);
  ctx.fillStyle = PALETTE.PREVIEW_BG;
  ctx.fill();
  ctx.strokeStyle = chanceColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2 + 0.5);

  if (p.hasCover) {
    const shieldH = Math.max(7, Math.floor(cell * 0.22));
    drawShieldIcon(
      ctx,
      px + cell * 0.07,
      py + cell - shieldH - cell * 0.07,
      shieldH,
      PALETTE.PREVIEW_SHIELD,
      PALETTE.PREVIEW_SHIELD_OUTLINE,
    );
  }
  ctx.restore();
}

function drawFloatingText(
  ctx: CanvasRenderingContext2D,
  cell: number,
  t: FloatingText,
): void {
  const tcx = t.x * cell + cell / 2;
  const tcy = t.y * cell + cell / 2;
  const fontSize = Math.max(10, Math.floor(cell * 0.32));
  ctx.save();
  ctx.font = `bold ${fontSize}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = PALETTE.FLOAT_STROKE;
  ctx.strokeText(t.text, tcx, tcy);
  ctx.fillStyle = t.color;
  ctx.fillText(t.text, tcx, tcy);
  ctx.restore();
}
