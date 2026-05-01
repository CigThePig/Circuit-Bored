import type { GameMap, Unit } from "./map.ts";

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

export function resizeCanvasForMap(canvas: HTMLCanvasElement, map: GameMap): number {
  const cssWidth = Math.min(window.innerWidth, 480);
  const cell = Math.floor(cssWidth / map.width);
  const sizePx = cell * map.width;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  canvas.width = Math.floor(sizePx * dpr);
  canvas.height = Math.floor(sizePx * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return cell;
}

export function draw(canvas: HTMLCanvasElement, state: RenderState): void {
  const ctx = canvas.getContext("2d")!;
  const map = state.map;
  const cssW = parseFloat(canvas.style.width || `${canvas.width}`);
  const cell = cssW / map.width;
  const now = performance.now();

  ctx.clearRect(0, 0, cssW, cssW);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y * map.width + x];
      if (t === "wall") {
        ctx.fillStyle = "#3a3a3a";
      } else {
        ctx.fillStyle = "#bbbbbb";
      }
      ctx.fillRect(x * cell, y * cell, cell, cell);
      if (t === "half_cover") {
        const inset = Math.max(2, Math.floor(cell * 0.18));
        ctx.fillStyle = "#8a6f4a";
        ctx.fillRect(x * cell + inset, y * cell + inset, cell - inset * 2, cell - inset * 2);
        ctx.strokeStyle = "#5a4628";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          x * cell + inset + 0.5,
          y * cell + inset + 0.5,
          cell - inset * 2 - 1,
          cell - inset * 2 - 1,
        );
      }
      ctx.strokeStyle = t === "wall" ? "#222" : "#999";
      ctx.lineWidth = 1;
      ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    }
  }

  for (const h of state.highlights) {
    ctx.fillStyle = h.fill;
    ctx.fillRect(h.x * cell, h.y * cell, cell, cell);
    ctx.strokeStyle = h.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(h.x * cell + 1, h.y * cell + 1, cell - 2, cell - 2);
  }

  if (state.sightLines && state.sightLines.length > 0) {
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.floor(cell * 0.08));
    ctx.lineCap = "round";
    for (const line of state.sightLines) {
      ctx.strokeStyle = line.hasCover
        ? "rgba(255, 154, 31, 0.55)"
        : "rgba(255, 216, 58, 0.55)";
      ctx.beginPath();
      ctx.moveTo(line.fromX * cell + cell / 2, line.fromY * cell + cell / 2);
      ctx.lineTo(line.toX * cell + cell / 2, line.toY * cell + cell / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const u of map.units) {
    if (u.hp <= 0) continue;
    const px = u.x * cell;
    const py = u.y * cell;
    const pad = Math.max(2, Math.floor(cell * 0.12));
    const cx = px + cell / 2;
    const cy = py + cell / 2;
    const fresh = u.ap === u.maxAp;
    const spent = u.ap === 0;

    let bodyColor: string;
    if (u.team === "player") {
      bodyColor = spent ? "#1f4a85" : "#3a7bd5";
    } else {
      bodyColor = spent ? "#7a2828" : "#d54a4a";
    }
    ctx.fillStyle = bodyColor;
    ctx.fillRect(px + pad, py + pad, cell - pad * 2, cell - pad * 2);

    if (spent) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillRect(px + pad, py + pad, cell - pad * 2, cell - pad * 2);
      const dotR = Math.max(2, Math.floor(cell * 0.07));
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(px + pad + dotR + 2, py + pad + dotR + 2, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (fresh) {
      const ringColor = u.team === "player" ? "#5ad6ff" : "#ff8a3a";
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = Math.max(2, Math.floor(cell * 0.06));
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.46, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (u.overwatch) {
      ctx.strokeStyle = "#ffe066";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (state.selected && state.selected.id === u.id) {
      ctx.strokeStyle = "#ffd83a";
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
    }

    ctx.fillStyle = "#fff";
    ctx.font = `${Math.floor(cell * 0.32)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${u.hp}`, px + cell - 4, py + 2);

    const pipCount = u.maxAp;
    if (pipCount > 0) {
      const pipR = Math.max(1.5, cell * 0.05);
      const gap = Math.max(1, pipR * 1.1);
      const totalW = pipCount * pipR * 2 + (pipCount - 1) * gap;
      const startX = cx - totalW / 2 + pipR;
      const pipY = py + cell - pipR - 2;
      for (let i = 0; i < pipCount; i++) {
        const pcx = startX + i * (pipR * 2 + gap);
        ctx.beginPath();
        ctx.arc(pcx, pipY, pipR, 0, Math.PI * 2);
        if (i < u.ap) {
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  if (state.coverIndicators && state.coverIndicators.length > 0) {
    const thickness = Math.max(3, Math.floor(cell * 0.1));
    const halfInset = Math.max(2, Math.floor(cell * 0.18));
    const edgeOffset = Math.max(1, Math.floor(cell * 0.04));
    const hatchSpacing = Math.max(3, Math.floor(cell * 0.18));
    for (const ind of state.coverIndicators) {
      const px = ind.x * cell;
      const py = ind.y * cell;
      const isWall = ind.kind === "wall";
      const fillColor = isWall ? "#9bdcff" : "#ff9a1f";
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

      ctx.fillStyle = fillColor;
      ctx.fillRect(bx, by, bw, bh);

      if (isWall) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(bx, by, bw, bh);
        ctx.clip();
        ctx.strokeStyle = "rgba(26, 51, 64, 0.55)";
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

      ctx.strokeStyle = "rgba(20, 20, 20, 0.85)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
  }

  if (state.threatMarkers && state.threatMarkers.length > 0) {
    const pulse = 0.6 + 0.4 * (Math.sin((now / 1200) * Math.PI * 2) * 0.5 + 0.5);
    for (const m of state.threatMarkers) {
      const px = m.x * cell;
      const py = m.y * cell;
      const ecx = px + cell / 2;
      const ecyDesired = py - cell * 0.05;
      const ecy = Math.max(ecyDesired, cell * 0.12);
      const rx = cell * 0.18;
      const ry = cell * 0.1;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, rx + 1, ry + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff4040";
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(ecx, ecy, Math.max(1, cell * 0.05), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (const p of state.enemyPreviews) {
    const px = p.x * cell;
    const py = p.y * cell;
    const pctText = `${p.hitPct}%`;
    const pctFontSize = Math.floor(cell * 0.28);
    ctx.font = `bold ${pctFontSize}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const textWidth = ctx.measureText(pctText).width;
    const padX = 4;
    const pillH = pctFontSize + 4;
    const pillW = textWidth + padX * 2;
    const pillX = px + cell / 2 - pillW / 2;
    const pillY = py + 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.fillStyle = p.hitPct >= 60 ? "#ffd83a" : "#ffffff";
    ctx.fillText(pctText, px + cell / 2, pillY + 2);

    if (p.hasCover) {
      const shieldSize = Math.floor(cell * 0.32);
      ctx.font = `${shieldSize}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillText("\u{1F6E1}", px + 3, py + 3);
      ctx.fillStyle = "#9bdcff";
      ctx.fillText("\u{1F6E1}", px + 2, py + 2);
    }
  }

  for (const t of state.floatingTexts) {
    if (t.expiresAt < now) continue;
    const tcx = t.x * cell + cell / 2;
    const tcy = t.y * cell + cell / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = `bold ${Math.floor(cell * 0.32)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.text, tcx + 1, tcy + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, tcx, tcy);
  }
}
