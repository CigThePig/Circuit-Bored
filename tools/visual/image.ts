/**
 * Deterministic PNG composition and comparison.
 *
 * Everything here runs in plain Node with `pngjs` and `pixelmatch`: no native
 * canvas, no headless browser. That keeps the compare and report stages usable
 * on their own (`npm run visual:compare`) after a capture has already happened.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { eachTextPixel, measureText, textHeight } from "./font.ts";

export type Rgb = readonly [number, number, number];

export const INK = {
  background: [7, 16, 24] as Rgb,
  panel: [12, 24, 33] as Rgb,
  text: [214, 233, 240] as Rgb,
  muted: [141, 165, 178] as Rgb,
  accent: [88, 228, 241] as Rgb,
  warn: [255, 209, 102] as Rgb,
  alert: [255, 102, 119] as Rgb,
  rule: [38, 59, 73] as Rgb,
} as const;

export function readPng(file: string): PNG {
  return PNG.sync.read(readFileSync(file));
}

export function writePng(file: string, image: PNG): void {
  writeFileSync(file, PNG.sync.write(image));
}

export function createPng(width: number, height: number, fill: Rgb = INK.background): PNG {
  const image = new PNG({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) });
  fillRect(image, 0, 0, image.width, image.height, fill);
  return image;
}

export function fillRect(image: PNG, x: number, y: number, width: number, height: number, color: Rgb): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(image.width, Math.round(x + width));
  const y1 = Math.min(image.height, Math.round(y + height));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const index = (py * image.width + px) * 4;
      image.data[index] = color[0];
      image.data[index + 1] = color[1];
      image.data[index + 2] = color[2];
      image.data[index + 3] = 255;
    }
  }
}

/** Copy `source` into `target` at the given offset, ignoring out-of-bounds pixels. */
export function blit(target: PNG, source: PNG, offsetX: number, offsetY: number): void {
  const x0 = Math.round(offsetX);
  const y0 = Math.round(offsetY);
  for (let y = 0; y < source.height; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < source.width; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= target.width) continue;
      const from = (y * source.width + x) * 4;
      const to = (ty * target.width + tx) * 4;
      target.data[to] = source.data[from];
      target.data[to + 1] = source.data[from + 1];
      target.data[to + 2] = source.data[from + 2];
      target.data[to + 3] = 255;
    }
  }
}

export function drawText(image: PNG, x: number, y: number, text: string, color: Rgb, scale = 2): void {
  eachTextPixel(text, Math.round(x), Math.round(y), scale, (px, py, size) => {
    fillRect(image, px, py, size, size, color);
  });
}

export { measureText, textHeight };

/**
 * Truncate `text` so it fits `maxWidth` device pixels, marking the cut so a
 * reader never mistakes a clipped label for the whole value.
 */
export function fitText(text: string, maxWidth: number, scale = 2): string {
  if (measureText(text, scale) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && measureText(`${result}...`, scale) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

/**
 * Area-average downscale. Used to turn a large native board capture into an
 * overview a vision model can take in at once without losing the composition.
 */
export function downscale(image: PNG, maxDimension: number): PNG {
  return fitWithin(image, maxDimension, maxDimension);
}

/** Area-average downscale that fits inside a width/height box, never upscaling. */
export function fitWithin(image: PNG, maxWidth: number, maxHeight: number): PNG {
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  if (scale >= 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sourceY0 = Math.floor((y * image.height) / height);
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sourceX0 = Math.floor((x * image.width) / width);
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor(((x + 1) * image.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let sy = sourceY0; sy < sourceY1; sy++) {
        for (let sx = sourceX0; sx < sourceX1; sx++) {
          const index = (sy * image.width + sx) * 4;
          r += image.data[index];
          g += image.data[index + 1];
          b += image.data[index + 2];
          count++;
        }
      }
      const target = (y * width + x) * 4;
      output.data[target] = Math.round(r / count);
      output.data[target + 1] = Math.round(g / count);
      output.data[target + 2] = Math.round(b / count);
      output.data[target + 3] = 255;
    }
  }
  return output;
}

export type DiffMetrics = {
  width: number;
  height: number;
  totalPixels: number;
  changedPixels: number;
  changedRatio: number;
  meanDifference: number;
  maxDifference: number;
};

export type DiffResult = {
  image: PNG;
  metrics: DiffMetrics;
};

/**
 * Compare two equally sized captures.
 *
 * `changedPixels` uses pixelmatch's perceptual threshold so anti-aliasing
 * noise does not dominate, while `meanDifference` and `maxDifference` are raw
 * channel deltas that answer "did this change everything a little or one thing
 * a lot?". None of these numbers decide whether a change is good.
 */
export function diffImages(baseline: PNG, current: PNG, threshold = 0.1): DiffResult {
  if (baseline.width !== current.width || baseline.height !== current.height) {
    throw new Error(
      `Cannot diff images of different sizes: ${baseline.width}x${baseline.height} vs ${current.width}x${current.height}`,
    );
  }
  const output = new PNG({ width: current.width, height: current.height });
  const changedPixels = pixelmatch(
    baseline.data,
    current.data,
    output.data,
    current.width,
    current.height,
    { threshold, alpha: 0.18, includeAA: false, diffColor: [255, 64, 96] },
  );
  let sum = 0;
  let max = 0;
  const totalPixels = current.width * current.height;
  for (let index = 0; index < totalPixels; index++) {
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(baseline.data[offset + channel] - current.data[offset + channel]);
      sum += delta;
      if (delta > max) max = delta;
    }
  }
  return {
    image: output,
    metrics: {
      width: current.width,
      height: current.height,
      totalPixels,
      changedPixels,
      changedRatio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
      meanDifference: totalPixels === 0 ? 0 : sum / (totalPixels * 3),
      maxDifference: max,
    },
  };
}

export type GridCell = {
  image: PNG | null;
  caption: string;
  /** Optional second caption line, e.g. a metric summary. */
  subCaption?: string;
  captionColor?: Rgb;
};

export type GridOptions = {
  title?: string;
  subtitle?: string;
  columns?: number;
  /** Wrap into more rows once a single row would exceed this width. */
  maxWidth?: number;
  padding?: number;
  gap?: number;
  captionScale?: number;
};

const MISSING_CELL_SIZE = 220;

/**
 * Lay images out in a labelled grid. Used for BEFORE/CURRENT/DIFF sheets and
 * for animation frame strips, so both read the same way.
 */
export function composeGrid(cells: readonly GridCell[], options: GridOptions = {}): PNG {
  const padding = options.padding ?? 18;
  const gap = options.gap ?? 16;
  const captionScale = options.captionScale ?? 2;
  const captionLine = textHeight(captionScale);
  const captionBand = captionLine * 2 + 12;
  const titleScale = 3;
  const titleBand = options.title ? textHeight(titleScale) + (options.subtitle ? textHeight(2) + 8 : 0) + 18 : 0;

  const cellWidth = Math.max(...cells.map((cell) => cell.image?.width ?? MISSING_CELL_SIZE));
  const cellHeight = Math.max(...cells.map((cell) => cell.image?.height ?? MISSING_CELL_SIZE));

  let columns = options.columns ?? cells.length;
  const maxWidth = options.maxWidth ?? 2400;
  while (columns > 1 && padding * 2 + columns * cellWidth + (columns - 1) * gap > maxWidth) {
    columns--;
  }
  const rows = Math.ceil(cells.length / columns);

  const width = padding * 2 + columns * cellWidth + (columns - 1) * gap;
  const height = padding * 2 + titleBand + rows * (captionBand + cellHeight) + (rows - 1) * gap;
  const sheet = createPng(width, height, INK.background);

  let cursorY = padding;
  if (options.title) {
    drawText(sheet, padding, cursorY, options.title.toUpperCase(), INK.accent, titleScale);
    cursorY += textHeight(titleScale) + 8;
    if (options.subtitle) {
      drawText(sheet, padding, cursorY, fitText(options.subtitle.toUpperCase(), width - padding * 2, 2), INK.muted, 2);
      cursorY += textHeight(2) + 8;
    }
    fillRect(sheet, padding, cursorY, width - padding * 2, 1, INK.rule);
    cursorY += 10;
  }

  cells.forEach((cell, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = padding + column * (cellWidth + gap);
    const y = cursorY + row * (captionBand + cellHeight + gap);
    const captionColor = cell.captionColor ?? INK.text;
    drawText(sheet, x, y, fitText(cell.caption.toUpperCase(), cellWidth, captionScale), captionColor, captionScale);
    if (cell.subCaption) {
      drawText(sheet, x, y + captionLine + 4, fitText(cell.subCaption.toUpperCase(), cellWidth, captionScale), INK.muted, captionScale);
    }
    const imageY = y + captionBand;
    if (cell.image) {
      fillRect(sheet, x, imageY, cell.image.width, cell.image.height, INK.panel);
      blit(sheet, cell.image, x, imageY);
    } else {
      fillRect(sheet, x, imageY, cellWidth, cellHeight, INK.panel);
      drawText(sheet, x + 14, imageY + 14, "NOT AVAILABLE", INK.muted, captionScale);
    }
  });

  return sheet;
}
