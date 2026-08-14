import { getTile, type GameMap, type Unit } from "./map.ts";

export type UnitVisualState = {
  spent?: boolean;
  inCover?: boolean;
  peekDir?: { x: number; y: number } | null;
  aimingDir?: { x: number; y: number } | null;
  nowMs?: number;
};

const PLAYER_POSE = {
  idleBobSpeed: 3.2,
  idleBobAmount: 0.015,
  coverDrop: 0.055,
  coverScaleY: 0.92,
  peekOffset: 0.14,
  handRadius: 0.055,
  handReach: 0.24,
  handVerticalReach: 0.12,
  weaponLength: 0.18,
} as const;

function isAdjacentToCover(map: GameMap, x: number, y: number): boolean {
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const t = getTile(map, x + dx, y + dy);
    if (t === "wall" || t === "half_cover") return true;
  }
  return false;
}

function computeUnitVisualState(
  map: GameMap,
  u: Unit,
  nowMs: number,
): UnitVisualState {
  const spent = u.ap === 0;
  const inCover = isAdjacentToCover(map, u.x, u.y);
  let peekDir: { x: number; y: number } | null = null;
  if (u.peekExposure) {
    // Clamp each axis to ±1 and normalize so diagonal and straight peeks
    // both produce a unit-vector lean of magnitude PLAYER_POSE.peekOffset.
    // Without this, diagonal peeks lean by 0.14 * sqrt(2) per cell, almost
    // 0.2 cell, which reads as the sprite physically travelling toward the
    // corner instead of leaning.
    const cx = Math.max(-1, Math.min(1, u.peekExposure.x - u.x));
    const cy = Math.max(-1, Math.min(1, u.peekExposure.y - u.y));
    const len = Math.hypot(cx, cy);
    if (len > 0) {
      peekDir = { x: cx / len, y: cy / len };
    }
  }
  // TODO: aimingDir would require tracking the unit's current shot target;
  // for now we fall back to peek direction (or facing) inside the silhouette.
  return { spent, inCover, peekDir, aimingDir: null, nowMs };
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
  toX: number;
  toY: number;
  hasCover: boolean;
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
};

const PALETTE = {
  BG: "#070b10",

  FLOOR_BASE: "#151c24",
  FLOOR_ALT: "#18222c",
  FLOOR_RIM: "#263441",
  FLOOR_SEAM: "rgba(118, 155, 180, 0.16)",
  FLOOR_GLYPH: "rgba(101, 196, 220, 0.16)",
  FLOOR_WEAR: "rgba(3, 7, 10, 0.22)",
  FLOOR_LIGHT: "#45d8e8",

  WALL_BASE: "#0c1219",
  WALL_MID: "#17232d",
  WALL_BEVEL_HI: "rgba(132, 205, 224, 0.26)",
  WALL_BEVEL_LO: "rgba(0, 0, 0, 0.55)",
  WALL_PANEL: "rgba(180, 225, 235, 0.10)",
  WALL_BRACKET: "rgba(126, 215, 230, 0.36)",
  WALL_LIGHT: "#ff426d",
  WALL_PIPE: "#314453",
  WALL_PIPE_HI: "#6d8794",
  WALL_SCREEN: "#153d48",

  HALFCOVER_FILL: "#5a3620",
  HALFCOVER_TOP: "#be7542",
  HALFCOVER_RIM: "#24150b",
  MACHINERY_FILL: "#263643",
  MACHINERY_TOP: "#526b78",
  COOLANT: "#55e4d4",
  HAZARD_YELLOW: "#f5c518",
  HAZARD_BLACK: "#1a1409",

  PLAYER_BODY: "#287eb2",
  PLAYER_BODY_SPENT: "#1f4a85",
  PLAYER_ACCENT: "#ff4ad6",
  PLAYER_HEAD: "#bfe9ef",
  ENEMY_BODY: "#b83f46",
  ENEMY_BODY_SPENT: "#7a2828",
  ENEMY_VISOR: "#1a0606",
  ENEMY_HEAD: "#d99a91",
  UNIT_OUTLINE: "rgba(2, 5, 8, 0.88)",
  UNIT_METAL: "#23303a",
  UNIT_METAL_HI: "#75919f",
  SPENT_VEIL: "rgba(0, 0, 0, 0.40)",

  FRESH_PLAYER: "#5ad6ff",
  FRESH_ENEMY: "#ff8a3a",
  FRESH_GLOW_PLAYER: "rgba(90, 214, 255, 0.55)",
  FRESH_GLOW_ENEMY: "rgba(255, 138, 58, 0.55)",
  OVERWATCH: "#ffd166",
  SELECTED: "#5ad6ff",
  SELECTED_GLOW: "rgba(90, 214, 255, 0.45)",

  HP_CHIP_BG: "rgba(8, 12, 18, 0.78)",
  HP_CHIP_BORDER: "rgba(90, 214, 255, 0.55)",
  HP_TEXT: "#eaf6ff",

  PIP_PLAYER_FILL: "#5ad6ff",
  PIP_ENEMY_FILL: "#ff8a3a",
  PIP_EMPTY_STROKE: "rgba(220, 230, 240, 0.55)",
  PIP_OUTLINE: "rgba(0, 0, 0, 0.7)",

  HL_FILL_OPACITY: 0.22,
  HL_BRACKET_LEN: 0.22,

  SIGHT_CLEAR_OUTER: "rgba(90, 214, 255, 0.14)",
  SIGHT_CLEAR_INNER: "rgba(128, 229, 255, 0.72)",
  SIGHT_COVER_OUTER: "rgba(255, 177, 71, 0.12)",
  SIGHT_COVER_INNER: "rgba(255, 190, 96, 0.68)",

  COVER_WALL: "#7fe3ff",
  COVER_HALF: "#ffb347",
  COVER_HATCH: "rgba(10, 30, 45, 0.55)",
  COVER_OUTLINE: "rgba(8, 12, 18, 0.85)",

  THREAT_RING: "#ff596b",
  THREAT_PUPIL: "#21070a",
  THREAT_GLINT: "#ffe0e4",
  THREAT_SHADOW: "rgba(0, 0, 0, 0.7)",

  PREVIEW_BG: "rgba(8, 12, 18, 0.85)",
  PREVIEW_BORDER_HI: "#61e6bb",
  PREVIEW_BORDER_MID: "#ffd166",
  PREVIEW_BORDER_LO: "#ff7381",
  PREVIEW_TEXT_HI: "#86f5cf",
  PREVIEW_TEXT_MID: "#ffe09a",
  PREVIEW_TEXT_LO: "#ff9aa5",
  PREVIEW_SHIELD: "#7fe3ff",
  PREVIEW_SHIELD_OUTLINE: "rgba(0, 0, 0, 0.85)",

  FLOAT_STROKE: "rgba(0, 0, 0, 0.85)",
} as const;

const ctxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  let ctx = ctxCache.get(canvas);
  if (!ctx) {
    ctx = canvas.getContext("2d")!;
    ctxCache.set(canvas, ctx);
  }
  return ctx;
}

export function resizeCanvasForMap(canvas: HTMLCanvasElement, map: GameMap): number {
  const cssWidth = Math.max(1, Math.min(window.innerWidth, 480));
  const cell = Math.max(1, Math.floor(cssWidth / map.width));
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
      if (t === "wall") {
        drawWallTile(ctx, px, py, cell, x, y);
      } else if (t === "half_cover") {
        drawHalfCoverTile(ctx, px, py, cell, x, y);
      } else {
        drawFloorTile(ctx, px, py, cell, x, y);
      }
    }
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
    if (u.hp <= 0) continue;
    const isSelected = state.selected !== null && state.selected.id === u.id;
    drawUnit(ctx, u.x * cell, u.y * cell, cell, u, isSelected, mapHeightPx, map, now, state.showUnitUi !== false);
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

export function environmentVariant(
  tile: "floor" | "wall" | "half_cover",
  x: number,
  y: number,
): EnvironmentVariant {
  const variant = tileHash(x, y) % 12;
  if (tile === "floor") {
    if (variant === 0) return "service_hatch";
    if (variant === 4) return "vent";
    if (variant === 8 || variant === 9) return "conduit";
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
  const peekDir = visual.peekDir ?? null;
  const nowMs = visual.nowMs ?? performance.now();
  const primary = spent ? bodyColor : profile.primary;
  const facing = u.team === "player" ? 1 : -1;
  const aim = visual.aimingDir ?? peekDir ?? { x: facing, y: 0 };
  const aimLength = Math.hypot(aim.x, aim.y) || 1;
  const aimDir = { x: aim.x / aimLength, y: aim.y / aimLength };

  const tSec = nowMs / 1000;
  const idleBob = Math.sin(tSec * PLAYER_POSE.idleBobSpeed + u.x * 0.7 + u.y) * cell * PLAYER_POSE.idleBobAmount;
  const coverDrop = inCover ? cell * PLAYER_POSE.coverDrop : 0;
  const coverScaleY = inCover ? PLAYER_POSE.coverScaleY : 1;
  const peekOffsetX = (peekDir?.x ?? 0) * cell * PLAYER_POSE.peekOffset;
  const peekOffsetY = (peekDir?.y ?? 0) * cell * PLAYER_POSE.peekOffset;

  ctx.save();
  ctx.translate(cx, cy);
  const shadow = ctx.createRadialGradient(0, cell * 0.20, 0, 0, cell * 0.20, cell * 0.35);
  shadow.addColorStop(0, "rgba(0,0,0,.58)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(-cell * 0.38, -cell * 0.02, cell * 0.76, cell * 0.48);

  ctx.save();
  ctx.translate(peekOffsetX, peekOffsetY + idleBob + coverDrop);
  ctx.scale(1, coverScaleY);

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

function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  x: number,
  y: number,
): void {
  const h = tileHash(x, y);
  const variant = environmentVariant("floor", x, y);
  ctx.fillStyle = (h & 1) === 0 ? PALETTE.FLOOR_BASE : PALETTE.FLOOR_ALT;
  ctx.fillRect(px, py, cell, cell);

  // Recessed deck seams keep the board readable without looking like a
  // featureless chess grid.
  ctx.strokeStyle = PALETTE.FLOOR_RIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
  const cx = px + cell / 2;
  const cy = py + cell / 2;
  ctx.save();
  ctx.lineWidth = 1;

  if (variant === "service_hatch") {
    const inset = cell * 0.19;
    ctx.fillStyle = "rgba(5,10,14,.24)";
    ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = PALETTE.FLOOR_GLYPH;
    ctx.strokeRect(px + inset + 0.5, py + inset + 0.5, cell - inset * 2 - 1, cell - inset * 2 - 1);
    const bracket = cell * 0.09;
    ctx.beginPath();
    ctx.moveTo(cx - bracket, cy);
    ctx.lineTo(cx + bracket, cy);
    ctx.moveTo(cx, cy - bracket);
    ctx.lineTo(cx, cy + bracket);
    ctx.stroke();
  } else if (variant === "vent") {
    const ventW = cell * 0.44;
    const ventH = cell * 0.32;
    ctx.fillStyle = "rgba(3,7,10,.46)";
    ctx.fillRect(cx - ventW / 2, cy - ventH / 2, ventW, ventH);
    ctx.strokeStyle = PALETTE.FLOOR_SEAM;
    ctx.strokeRect(cx - ventW / 2 + 0.5, cy - ventH / 2 + 0.5, ventW - 1, ventH - 1);
    for (let i = -2; i <= 2; i++) {
      const vx = cx + i * ventW * 0.16;
      ctx.beginPath();
      ctx.moveTo(vx, cy - ventH * 0.32);
      ctx.lineTo(vx, cy + ventH * 0.32);
      ctx.stroke();
    }
  } else if (variant === "conduit") {
    const vertical = (h & 2) !== 0;
    const offset = cell * 0.13;
    ctx.strokeStyle = "rgba(74,177,194,.22)";
    ctx.lineWidth = Math.max(1, cell * 0.045);
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(cx - offset, py);
      ctx.lineTo(cx - offset, py + cell);
      ctx.moveTo(cx + offset, py);
      ctx.lineTo(cx + offset, py + cell);
    } else {
      ctx.moveTo(px, cy - offset);
      ctx.lineTo(px + cell, cy - offset);
      ctx.moveTo(px, cy + offset);
      ctx.lineTo(px + cell, cy + offset);
    }
    ctx.stroke();
  } else {
    // Sparse wear and fasteners make repeated deck plates feel manufactured.
    ctx.fillStyle = PALETTE.FLOOR_SEAM;
    const rivet = Math.max(1, cell * 0.024);
    for (const [rx, ry] of [[0.14, 0.14], [0.86, 0.86]]) {
      ctx.fillRect(px + cell * rx - rivet / 2, py + cell * ry - rivet / 2, rivet, rivet);
    }
    if ((h & 7) === 3) {
      ctx.strokeStyle = PALETTE.FLOOR_WEAR;
      ctx.beginPath();
      ctx.moveTo(px + cell * 0.24, py + cell * 0.72);
      ctx.lineTo(px + cell * 0.42, py + cell * 0.60);
      ctx.lineTo(px + cell * 0.58, py + cell * 0.66);
      ctx.stroke();
    }
  }

  if ((h & 0x3f) === 0x20) {
    ctx.shadowColor = PALETTE.FLOOR_LIGHT;
    ctx.shadowBlur = cell * 0.16;
    ctx.fillStyle = PALETTE.FLOOR_LIGHT;
    ctx.fillRect(px + cell * 0.20, py + cell * 0.82, cell * 0.60, Math.max(1, cell * 0.035));
  }
  ctx.restore();
}

function drawWallTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  x: number,
  y: number,
): void {
  const variant = environmentVariant("wall", x, y);
  ctx.fillStyle = PALETTE.WALL_BASE;
  ctx.fillRect(px, py, cell, cell);

  ctx.lineWidth = 1;
  ctx.strokeStyle = PALETTE.WALL_BEVEL_HI;
  ctx.beginPath();
  ctx.moveTo(px + 0.5, py + cell - 1);
  ctx.lineTo(px + 0.5, py + 0.5);
  ctx.lineTo(px + cell - 1, py + 0.5);
  ctx.stroke();

  ctx.strokeStyle = PALETTE.WALL_BEVEL_LO;
  ctx.beginPath();
  ctx.moveTo(px + cell - 0.5, py + 1);
  ctx.lineTo(px + cell - 0.5, py + cell - 0.5);
  ctx.lineTo(px + 1, py + cell - 0.5);
  ctx.stroke();

  const h = tileHash(x, y);
  if (variant === "pipe_bank") {
    const vertical = (h & 1) === 0;
    const pipeW = Math.max(2, cell * 0.11);
    for (let i = -1; i <= 1; i++) {
      const offset = i * cell * 0.19;
      ctx.strokeStyle = i === 0 ? PALETTE.WALL_PIPE_HI : PALETTE.WALL_PIPE;
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
    ctx.fillStyle = PALETTE.WALL_BRACKET;
    if (vertical) {
      ctx.fillRect(px + cell * 0.14, py + cell * 0.22, cell * 0.72, Math.max(1, cell * 0.05));
      ctx.fillRect(px + cell * 0.14, py + cell * 0.73, cell * 0.72, Math.max(1, cell * 0.05));
    } else {
      ctx.fillRect(px + cell * 0.22, py + cell * 0.14, Math.max(1, cell * 0.05), cell * 0.72);
      ctx.fillRect(px + cell * 0.73, py + cell * 0.14, Math.max(1, cell * 0.05), cell * 0.72);
    }
  } else if (variant === "system_panel") {
    const inset = cell * 0.15;
    ctx.fillStyle = PALETTE.WALL_MID;
    ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = PALETTE.WALL_BRACKET;
    ctx.strokeRect(px + inset + 0.5, py + inset + 0.5, cell - inset * 2 - 1, cell - inset * 2 - 1);
    ctx.fillStyle = PALETTE.WALL_SCREEN;
    ctx.fillRect(px + cell * 0.24, py + cell * 0.24, cell * 0.52, cell * 0.25);
    ctx.fillStyle = PALETTE.FLOOR_LIGHT;
    ctx.fillRect(px + cell * 0.29, py + cell * 0.30, cell * 0.24, Math.max(1, cell * 0.025));
    ctx.fillStyle = PALETTE.WALL_LIGHT;
    ctx.fillRect(px + cell * 0.64, py + cell * 0.30, Math.max(1, cell * 0.05), Math.max(1, cell * 0.05));
    ctx.strokeStyle = PALETTE.WALL_PANEL;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(px + cell * 0.26, py + cell * (0.62 + i * 0.07));
      ctx.lineTo(px + cell * 0.74, py + cell * (0.62 + i * 0.07));
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = PALETTE.WALL_MID;
    ctx.fillRect(px + cell * 0.12, py + cell * 0.12, cell * 0.76, cell * 0.76);
    ctx.strokeStyle = PALETTE.WALL_PANEL;
    ctx.strokeRect(px + cell * 0.12 + 0.5, py + cell * 0.12 + 0.5, cell * 0.76 - 1, cell * 0.76 - 1);
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.12, py + cell * 0.12);
    ctx.lineTo(px + cell * 0.88, py + cell * 0.88);
    ctx.moveTo(px + cell * 0.88, py + cell * 0.12);
    ctx.lineTo(px + cell * 0.12, py + cell * 0.88);
    ctx.stroke();
    const hubR = cell * 0.09;
    ctx.fillStyle = PALETTE.WALL_BASE;
    ctx.beginPath();
    ctx.arc(px + cell / 2, py + cell / 2, hubR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.WALL_BRACKET;
    ctx.stroke();
  }

  if ((h & 0x1f) === 0) {
    const dotSize = Math.max(1, Math.floor(cell * 0.07));
    ctx.shadowColor = PALETTE.WALL_LIGHT;
    ctx.shadowBlur = cell * 0.16;
    ctx.fillStyle = PALETTE.WALL_LIGHT;
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
): void {
  drawFloorTile(ctx, px, py, cell, x, y);
  const variant = environmentVariant("half_cover", x, y);
  const inset = Math.max(2, Math.floor(cell * 0.18));
  const ox = px + inset;
  const oy = py + inset;
  const ow = cell - inset * 2;
  const oh = cell - inset * 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.65)";
  ctx.shadowBlur = cell * 0.12;
  ctx.shadowOffsetY = cell * 0.05;

  if (variant === "cargo") {
    ctx.fillStyle = PALETTE.HALFCOVER_FILL;
    ctx.fillRect(ox, oy, ow, oh);
    ctx.fillStyle = PALETTE.HALFCOVER_TOP;
    ctx.fillRect(ox, oy, ow, Math.max(2, cell * 0.08));
    ctx.strokeStyle = PALETTE.HALFCOVER_RIM;
    ctx.strokeRect(ox + 0.5, oy + 0.5, ow - 1, oh - 1);
    ctx.fillStyle = PALETTE.UNIT_METAL;
    ctx.fillRect(ox + ow * 0.14, oy, ow * 0.10, oh);
    ctx.fillRect(ox + ow * 0.76, oy, ow * 0.10, oh);
    ctx.fillStyle = "rgba(244,216,132,.72)";
    ctx.fillRect(ox + ow * 0.34, oy + oh * 0.38, ow * 0.32, oh * 0.18);
  } else if (variant === "barricade") {
    ctx.fillStyle = PALETTE.MACHINERY_FILL;
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
      ctx.fillStyle = i % 2 === 0 ? PALETTE.HAZARD_YELLOW : PALETTE.HAZARD_BLACK;
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
    ctx.fillStyle = PALETTE.MACHINERY_FILL;
    ctx.beginPath();
    ctx.ellipse(px + cell / 2, py + cell / 2, ow * 0.45, oh * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.UNIT_METAL_HI;
    ctx.lineWidth = Math.max(1, cell * 0.04);
    ctx.stroke();
    ctx.fillStyle = PALETTE.MACHINERY_TOP;
    ctx.beginPath();
    ctx.ellipse(px + cell / 2, py + cell / 2, ow * 0.31, oh * 0.31, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = PALETTE.COOLANT;
    ctx.shadowBlur = cell * 0.15;
    ctx.strokeStyle = PALETTE.COOLANT;
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
  const fromX = line.fromX * cell + cell / 2;
  const fromY = line.fromY * cell + cell / 2;
  const toX = line.toX * cell + cell / 2;
  const toY = line.toY * cell + cell / 2;

  const outerW = Math.max(2, Math.floor(cell * 0.09));
  const innerW = Math.max(1, Math.floor(cell * 0.025));

  ctx.save();
  ctx.lineCap = "round";
  ctx.setLineDash([Math.max(3, cell * 0.16), Math.max(2, cell * 0.12)]);

  ctx.strokeStyle = line.hasCover ? PALETTE.SIGHT_COVER_OUTER : PALETTE.SIGHT_CLEAR_OUTER;
  ctx.lineWidth = outerW;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.strokeStyle = line.hasCover ? PALETTE.SIGHT_COVER_INNER : PALETTE.SIGHT_CLEAR_INNER;
  ctx.lineWidth = innerW;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
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
  drawArchetypeBadge(ctx, px, py, cell, u);

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

  if (showUnitUi) {
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
