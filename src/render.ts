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

export type RenderState = {
  map: GameMap;
  selected: Unit | null;
  highlights: { x: number; y: number; fill: string; border: string }[];
  enemyPreviews: EnemyPreview[];
  floatingTexts: FloatingText[];
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

  for (const u of map.units) {
    if (u.hp <= 0) continue;
    const px = u.x * cell;
    const py = u.y * cell;
    const pad = Math.max(2, Math.floor(cell * 0.12));
    ctx.fillStyle = u.team === "player" ? "#3a7bd5" : "#d54a4a";
    ctx.fillRect(px + pad, py + pad, cell - pad * 2, cell - pad * 2);

    if (u.overwatch) {
      ctx.strokeStyle = "#ffe066";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + cell / 2, py + cell / 2, cell * 0.42, 0, Math.PI * 2);
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
    ctx.textBaseline = "bottom";
    ctx.fillText(`${u.hp}`, px + cell - 4, py + cell - 2);
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

  const now = performance.now();
  for (const t of state.floatingTexts) {
    if (t.expiresAt < now) continue;
    const cx = t.x * cell + cell / 2;
    const cy = t.y * cell + cell / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = `bold ${Math.floor(cell * 0.32)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.text, cx + 1, cy + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, cx, cy);
  }
}
