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
  highlights: { x: number; y: number; fill: string; border: string }[];
  enemyPreviews: EnemyPreview[];
  floatingTexts: FloatingText[];
  coverIndicators?: CoverIndicator[];
  threatMarkers?: ThreatMarker[];
  sightLines?: SightLine[];
};

const PALETTE = {
  BG: "#0a0d12",

  FLOOR_BASE: "#1d232c",
  FLOOR_RIM: "#2a3340",
  FLOOR_GLYPH: "rgba(140, 90, 200, 0.10)",

  WALL_BASE: "#11151c",
  WALL_BEVEL_HI: "rgba(120, 170, 210, 0.22)",
  WALL_BEVEL_LO: "rgba(0, 0, 0, 0.55)",
  WALL_PANEL: "rgba(180, 220, 255, 0.06)",
  WALL_BRACKET: "rgba(140, 200, 235, 0.30)",
  WALL_LIGHT: "#ff3a6a",

  HALFCOVER_FILL: "#5b3a1f",
  HALFCOVER_TOP: "#a87246",
  HALFCOVER_RIM: "#2c1a0a",
  HAZARD_YELLOW: "#f5c518",
  HAZARD_BLACK: "#1a1409",

  PLAYER_BODY: "#3a7bd5",
  PLAYER_BODY_SPENT: "#1f4a85",
  PLAYER_ACCENT: "#ff4ad6",
  PLAYER_HEAD: "#cfeaff",
  ENEMY_BODY: "#d54a4a",
  ENEMY_BODY_SPENT: "#7a2828",
  ENEMY_VISOR: "#1a0606",
  ENEMY_HEAD: "#f5c4c4",
  UNIT_OUTLINE: "rgba(0, 0, 0, 0.65)",
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

  SIGHT_CLEAR_OUTER: "rgba(255, 216, 58, 0.18)",
  SIGHT_CLEAR_INNER: "rgba(255, 240, 160, 0.95)",
  SIGHT_COVER_OUTER: "rgba(255, 120, 40, 0.18)",
  SIGHT_COVER_INNER: "rgba(255, 180, 90, 0.95)",

  COVER_WALL: "#7fe3ff",
  COVER_HALF: "#ffb347",
  COVER_HATCH: "rgba(10, 30, 45, 0.55)",
  COVER_OUTLINE: "rgba(8, 12, 18, 0.85)",

  THREAT_RING: "#ff4040",
  THREAT_PUPIL: "#1a0000",
  THREAT_GLINT: "#ffd0d0",
  THREAT_SHADOW: "rgba(0, 0, 0, 0.7)",

  PREVIEW_BG: "rgba(8, 12, 18, 0.85)",
  PREVIEW_BORDER_HI: "#ffd166",
  PREVIEW_BORDER_LO: "#7fe3ff",
  PREVIEW_TEXT_HI: "#ffd166",
  PREVIEW_TEXT_LO: "#cfdce8",
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

export function draw(canvas: HTMLCanvasElement, state: RenderState): void {
  const ctx = getCtx(canvas);
  const map = state.map;
  const cssW = parseFloat(canvas.style.width || `${canvas.width}`);
  const cell = cssW / map.width;
  const mapHeightPx = cell * map.height;
  const now = performance.now();

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
    drawHighlight(ctx, h.x * cell, h.y * cell, cell, h.fill, h.border);
  }

  if (state.sightLines && state.sightLines.length > 0) {
    for (const line of state.sightLines) {
      drawSightLine(ctx, cell, line);
    }
  }

  for (const u of map.units) {
    if (u.hp <= 0) continue;
    const isSelected = state.selected !== null && state.selected.id === u.id;
    drawUnit(ctx, u.x * cell, u.y * cell, cell, u, isSelected, mapHeightPx, map, now);
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
    drawEnemyPreview(ctx, p.x * cell, p.y * cell, cell, p, mapHeightPx);
  }

  for (const t of state.floatingTexts) {
    if (t.expiresAt < now) continue;
    drawFloatingText(ctx, cell, t);
  }
}

function tileHash(x: number, y: number): number {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) & 0xff;
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
  const facing = u.team === "player" ? 1 : -1;
  const detail = cell >= 18;

  const outlineW = Math.max(1, cell * 0.035);
  const accent = u.team === "player" ? PALETTE.PLAYER_ACCENT : PALETTE.ENEMY_VISOR;
  const headColor = u.team === "player" ? PALETTE.PLAYER_HEAD : PALETTE.ENEMY_HEAD;
  const coreGlow = u.team === "player" ? PALETTE.FRESH_PLAYER : PALETTE.FRESH_ENEMY;

  const spent = visual.spent ?? false;
  const inCover = visual.inCover ?? false;
  const peekDir = visual.peekDir ?? null;
  const aimingDir = visual.aimingDir ?? null;
  const nowMs = visual.nowMs ?? performance.now();

  const tSec = nowMs / 1000;
  const idleBob = Math.sin(tSec * PLAYER_POSE.idleBobSpeed) * cell * PLAYER_POSE.idleBobAmount;
  const coverDrop = inCover ? cell * PLAYER_POSE.coverDrop : 0;
  const coverScaleY = inCover ? PLAYER_POSE.coverScaleY : 1;
  const peekOffsetX = (peekDir?.x ?? 0) * cell * PLAYER_POSE.peekOffset;
  const peekOffsetY = (peekDir?.y ?? 0) * cell * PLAYER_POSE.peekOffset;

  ctx.save();
  ctx.translate(cx, cy);

  // Anchored ground shadow stays put on the tile and never animates.
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.beginPath();
  ctx.ellipse(0, cell * 0.24, cell * 0.30, cell * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();

  // Animated body transform: idle bob + cover crouch + peek lean.
  ctx.save();
  ctx.translate(peekOffsetX, peekOffsetY + idleBob + coverDrop);
  ctx.scale(1, coverScaleY);

  const armY = cell * 0.02;
  const armW = cell * 0.16;
  const armH = cell * 0.33;
  const shoulderY = -cell * 0.05;

  capsulePath(ctx, -cell * 0.31, shoulderY, armW, armH);
  fillAndStroke(ctx, bodyColor, PALETTE.UNIT_OUTLINE, outlineW);

  capsulePath(ctx, cell * 0.15, shoulderY, armW, armH);
  fillAndStroke(ctx, bodyColor, PALETTE.UNIT_OUTLINE, outlineW);

  if (detail) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-cell * 0.27, shoulderY + cell * 0.04, armW * 0.22, armH * 0.70);
    ctx.fillRect(cell * 0.19, shoulderY + cell * 0.04, armW * 0.22, armH * 0.70);
    ctx.restore();
  }

  topDownTorsoPath(ctx, 0, cell * 0.08, cell * 0.44, cell * 0.58);
  fillAndStroke(ctx, bodyColor, PALETTE.UNIT_OUTLINE, outlineW);

  if (detail) {
    ctx.save();
    topDownTorsoPath(ctx, 0, cell * 0.08, cell * 0.44, cell * 0.58);
    ctx.clip();
    ctx.globalAlpha = 0.24;
    const grad = ctx.createLinearGradient(
      -cell * 0.18,
      -cell * 0.18,
      cell * 0.20,
      cell * 0.34,
    );
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.55, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(-cell * 0.24, -cell * 0.28, cell * 0.48, cell * 0.72);
    ctx.restore();

    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.beginPath();
    ctx.moveTo(-cell * 0.13, cell * 0.05);
    ctx.lineTo(0, cell * 0.22);
    ctx.lineTo(cell * 0.13, cell * 0.05);
    ctx.stroke();
  }

  const headY = -cell * 0.24;
  ellipsePath(ctx, 0, headY, cell * 0.22, cell * 0.19);
  fillAndStroke(ctx, headColor, PALETTE.UNIT_OUTLINE, outlineW);

  if (detail) {
    ctx.save();
    ellipsePath(ctx, 0, headY, cell * 0.22, cell * 0.19);
    ctx.clip();
    ctx.fillStyle =
      u.team === "player"
        ? "rgba(8, 28, 55, 0.45)"
        : "rgba(20, 0, 0, 0.62)";
    roundRect(
      ctx,
      -cell * 0.15,
      headY - cell * 0.03,
      cell * 0.30,
      cell * 0.08,
      cell * 0.04,
    );
    ctx.fill();

    ctx.fillStyle = coreGlow;
    ctx.globalAlpha = u.team === "player" ? 0.9 : 0.75;
    ctx.fillRect(
      -cell * 0.09,
      headY - cell * 0.015,
      cell * 0.18,
      Math.max(1, cell * 0.018),
    );
    ctx.restore();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.40)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      -cell * 0.06,
      headY - cell * 0.05,
      cell * 0.06,
      Math.PI * 1.15,
      Math.PI * 1.75,
    );
    ctx.stroke();
  }

  if (detail) {
    const aim = aimingDir ?? peekDir ?? { x: facing, y: 0 };
    const len = Math.hypot(aim.x, aim.y) || 1;
    const ax = aim.x / len;
    const ay = aim.y / len;

    // Use isotropic reach so diagonal peek aim doesn't elongate the gun
    // disproportionately on the X axis. Upward aim still uses the dampened
    // vertical reach so the muzzle doesn't poke through the head.
    const reach = cell * PLAYER_POSE.handReach;
    const upScale = ay < 0 ? PLAYER_POSE.handVerticalReach / PLAYER_POSE.handReach : 1;
    const handX = ax * reach;
    const handY = armY + ay * reach * upScale;
    const muzzleLen = cell * PLAYER_POSE.weaponLength;
    const muzzleX = handX + ax * muzzleLen;
    const muzzleY = handY + ay * muzzleLen * upScale;

    ctx.fillStyle = PALETTE.UNIT_OUTLINE;
    ctx.beginPath();
    ctx.arc(handX, handY, cell * PLAYER_POSE.handRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(5, 7, 10, 0.92)";
    ctx.lineWidth = Math.max(2, cell * 0.07);
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(muzzleX, muzzleY);
    ctx.stroke();

    ctx.strokeStyle = coreGlow;
    ctx.lineWidth = Math.max(1, cell * 0.025);
    ctx.beginPath();
    ctx.moveTo(handX + ax * cell * 0.04, handY + ay * cell * 0.04);
    ctx.lineTo(muzzleX, muzzleY);
    ctx.stroke();
  }

  if (spent) {
    ctx.fillStyle = PALETTE.SPENT_VEIL;
    ctx.fillRect(-cell * 0.38, -cell * 0.43, cell * 0.76, cell * 0.82);
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
  ctx.fillStyle = PALETTE.FLOOR_BASE;
  ctx.fillRect(px, py, cell, cell);
  ctx.strokeStyle = PALETTE.FLOOR_RIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);

  if ((x + y) % 3 !== 0) return;

  const h = tileHash(x, y);
  const variant = (h >> 3) & 3;
  const cx = px + cell / 2;
  const cy = py + cell / 2;
  ctx.save();
  ctx.strokeStyle = PALETTE.FLOOR_GLYPH;
  ctx.fillStyle = PALETTE.FLOOR_GLYPH;
  ctx.lineWidth = 1;
  if (variant === 0) {
    const arm = cell * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.stroke();
  } else if (variant === 1) {
    const arm = cell * 0.14;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy - arm);
    ctx.lineTo(cx + arm, cy + arm);
    ctx.moveTo(cx + arm, cy - arm);
    ctx.lineTo(cx - arm, cy + arm);
    ctx.stroke();
  } else if (variant === 2) {
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const step = cell * 0.12;
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(cx - 0.5, cy + i * step - 0.5, 1, 1);
    }
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

  ctx.strokeStyle = PALETTE.WALL_PANEL;
  ctx.beginPath();
  const seamX = Math.floor(px + cell / 2) + 0.5;
  ctx.moveTo(seamX, py + cell * 0.18);
  ctx.lineTo(seamX, py + cell * 0.82);
  ctx.stroke();

  if (cell >= 22) {
    const len = Math.max(2, Math.floor(cell * 0.12));
    ctx.strokeStyle = PALETTE.WALL_BRACKET;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 1, py + 1 + len);
    ctx.lineTo(px + 1, py + 1);
    ctx.lineTo(px + 1 + len, py + 1);
    ctx.moveTo(px + cell - 1 - len, py + cell - 1);
    ctx.lineTo(px + cell - 1, py + cell - 1);
    ctx.lineTo(px + cell - 1, py + cell - 1 - len);
    ctx.stroke();
  }

  const h = tileHash(x, y);
  if ((h & 0x1f) === 0) {
    const dotSize = Math.max(1, Math.floor(cell * 0.07));
    ctx.fillStyle = PALETTE.WALL_LIGHT;
    ctx.fillRect(px + cell - dotSize - 3, py + 3, dotSize, dotSize);
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
  const inset = Math.max(2, Math.floor(cell * 0.18));
  const ox = px + inset;
  const oy = py + inset;
  const ow = cell - inset * 2;
  const oh = cell - inset * 2;

  ctx.fillStyle = PALETTE.HALFCOVER_FILL;
  ctx.fillRect(ox, oy, ow, oh);

  const topBand = Math.max(2, Math.floor(cell * 0.07));
  ctx.fillStyle = PALETTE.HALFCOVER_TOP;
  ctx.fillRect(ox, oy, ow, topBand);

  ctx.strokeStyle = PALETTE.HALFCOVER_RIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, ow - 1, oh - 1);

  if (cell >= 22) {
    const stripeH = Math.max(2, Math.floor(cell * 0.09));
    const stripeY = oy + topBand;
    const pillCount = 3;
    const totalGap = ow * 0.10;
    const pillW = (ow - totalGap) / pillCount;
    const gap = totalGap / (pillCount + 1);
    for (let i = 0; i < pillCount; i++) {
      const startX = ox + gap + i * (pillW + gap);
      ctx.fillStyle = i % 2 === 0 ? PALETTE.HAZARD_YELLOW : PALETTE.HAZARD_BLACK;
      ctx.fillRect(startX, stripeY, pillW, stripeH);
    }
  } else {
    ctx.fillStyle = PALETTE.HAZARD_YELLOW;
    ctx.fillRect(ox, oy + topBand, ow, 1);
  }
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
): void {
  ctx.save();
  ctx.globalAlpha = PALETTE.HL_FILL_OPACITY;
  ctx.fillStyle = fill;
  ctx.fillRect(px, py, cell, cell);
  ctx.restore();

  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  drawCornerBrackets(ctx, px, py, cell, Math.max(3, Math.floor(cell * PALETTE.HL_BRACKET_LEN)), 1.5);
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

  const outerW = Math.max(3, Math.floor(cell * 0.22));
  const innerW = Math.max(1, Math.floor(cell * 0.06));

  ctx.save();
  ctx.lineCap = "round";

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

  if (fresh && !spent) {
    const ringColor = u.team === "player" ? PALETTE.FRESH_PLAYER : PALETTE.FRESH_ENEMY;
    const glowColor =
      u.team === "player" ? PALETTE.FRESH_GLOW_PLAYER : PALETTE.FRESH_GLOW_ENEMY;

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = Math.max(4, Math.floor(cell * 0.18));
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = Math.max(2, Math.floor(cell * 0.055));
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy + cell * 0.03,
      cell * 0.39,
      cell * 0.34,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();
  }

  drawUnitSilhouette(ctx, px, py, cell, u, bodyColor, visual);

  if (u.overwatch) {
    const ringR = cell * 0.42;
    ctx.strokeStyle = PALETTE.OVERWATCH;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();

    const tickLen = Math.max(2, Math.floor(cell * 0.06));
    ctx.lineWidth = 2;
    const dirs: [number, number][] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];

    ctx.beginPath();
    for (const [dx, dy] of dirs) {
      const ix = cx + dx * (ringR - 2);
      const iy = cy + dy * (ringR - 2);
      const ox = cx + dx * (ringR + tickLen);
      const oy = cy + dy * (ringR + tickLen);
      ctx.moveTo(ix, iy);
      ctx.lineTo(ox, oy);
    }
    ctx.stroke();
  }

  if (isSelected) {
    ctx.save();
    ctx.shadowColor = PALETTE.SELECTED_GLOW;
    ctx.shadowBlur = 4;
    ctx.strokeStyle = PALETTE.SELECTED;
    ctx.lineWidth = 2;
    drawCornerBrackets(ctx, px, py, cell, Math.max(4, Math.floor(cell * 0.22)), 2);
    ctx.restore();
  }

  drawHpChip(ctx, px, py, cell, u);
  drawApPips(ctx, px, py, cell, u, mapHeightPx);
}

function drawHpChip(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  u: Unit,
): void {
  const fontSize = Math.max(8, Math.floor(cell * 0.30));
  const text = `${u.hp}`;
  ctx.font = `bold ${fontSize}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const textW = ctx.measureText(text).width;
  const padX = 3;
  const chipW = textW + padX * 2;
  const chipH = fontSize + 2;
  const chipX = px + cell / 2 - chipW / 2;
  const aboveY = py - chipH - 1;
  const chipY = aboveY >= 0 ? aboveY : py + 1;

  roundRect(ctx, chipX, chipY, chipW, chipH, 2);
  ctx.fillStyle = PALETTE.HP_CHIP_BG;
  ctx.fill();
  ctx.strokeStyle = PALETTE.HP_CHIP_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = PALETTE.HP_TEXT;
  ctx.fillText(text, chipX + chipW / 2, chipY + 1);
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
  const pipR = Math.max(1.5, cell * 0.05);
  const gap = Math.max(1, pipR * 1.1);
  const totalW = pipCount * pipR * 2 + (pipCount - 1) * gap;
  const startX = cx - totalW / 2 + pipR;
  const belowY = py + cell + pipR + 1;
  const pipY = belowY + pipR <= mapHeightPx ? belowY : py + cell - pipR - 2;
  const fillColor = u.team === "player" ? PALETTE.PIP_PLAYER_FILL : PALETTE.PIP_ENEMY_FILL;
  for (let i = 0; i < pipCount; i++) {
    const pcx = startX + i * (pipR * 2 + gap);
    ctx.beginPath();
    ctx.arc(pcx, pipY, pipR, 0, Math.PI * 2);
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
  const ecx = px + cell / 2;
  const ecyDesired = py - cell * 0.05;
  const ecy = Math.max(ecyDesired, cell * 0.20);
  const r = cell * 0.18;

  ctx.save();
  ctx.globalAlpha = pulse;

  ctx.fillStyle = PALETTE.THREAT_SHADOW;
  ctx.beginPath();
  ctx.arc(ecx, ecy + 1, r + 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = PALETTE.THREAT_RING;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ecx, ecy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = PALETTE.THREAT_PUPIL;
  ctx.beginPath();
  ctx.arc(ecx, ecy, r * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.THREAT_GLINT;
  ctx.beginPath();
  ctx.arc(ecx + r * 0.18, ecy - r * 0.22, Math.max(0.8, cell * 0.025), 0, Math.PI * 2);
  ctx.fill();

  const tickLen = Math.max(2, Math.floor(cell * 0.06));
  ctx.strokeStyle = PALETTE.THREAT_RING;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ecx, ecy - r - 1);
  ctx.lineTo(ecx, ecy - r - 1 - tickLen);
  ctx.moveTo(ecx, ecy + r + 1);
  ctx.lineTo(ecx, ecy + r + 1 + tickLen);
  ctx.moveTo(ecx - r - 1, ecy);
  ctx.lineTo(ecx - r - 1 - tickLen, ecy);
  ctx.moveTo(ecx + r + 1, ecy);
  ctx.lineTo(ecx + r + 1 + tickLen, ecy);
  ctx.stroke();

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
  mapHeightPx: number,
): void {
  const text = `${p.hitPct}%`;
  const fontSize = Math.max(8, Math.floor(cell * 0.28));
  ctx.font = `bold ${fontSize}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const textW = ctx.measureText(text).width;
  const padX = 4;
  const pillH = fontSize + 4;
  const pillW = textW + padX * 2;
  const pillX = px + cell / 2 - pillW / 2;
  const hpFontSize = Math.max(8, Math.floor(cell * 0.30));
  const hpChipH = hpFontSize + 2;
  const stackedY = py - hpChipH - pillH - 3;
  const belowY = py + cell + 2;
  let pillY: number;
  if (stackedY >= 0) {
    pillY = stackedY;
  } else if (belowY + pillH <= mapHeightPx) {
    pillY = belowY;
  } else {
    pillY = py + 2;
  }

  roundRect(ctx, pillX, pillY, pillW, pillH, 3);
  ctx.fillStyle = PALETTE.PREVIEW_BG;
  ctx.fill();
  ctx.strokeStyle =
    p.hitPct >= 60 ? PALETTE.PREVIEW_BORDER_HI : PALETTE.PREVIEW_BORDER_LO;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = p.hitPct >= 60 ? PALETTE.PREVIEW_TEXT_HI : PALETTE.PREVIEW_TEXT_LO;
  ctx.fillText(text, px + cell / 2, pillY + 2);

  if (p.hasCover) {
    const shieldH = Math.max(8, Math.floor(cell * 0.30));
    drawShieldIcon(
      ctx,
      px + 3,
      py + cell - shieldH - 3,
      shieldH,
      PALETTE.PREVIEW_SHIELD,
      PALETTE.PREVIEW_SHIELD_OUTLINE,
    );
  }
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
