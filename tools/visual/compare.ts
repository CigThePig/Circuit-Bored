/**
 * Baseline/current comparison.
 *
 * Pairing is by relative path under `current/` and `baseline/`, which keeps
 * this stage independent of the review matrix: `npm run visual:compare` works
 * on whatever was captured last, including a hand-assembled baseline.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import {
  composeGrid,
  diffImages,
  fitWithin,
  INK,
  readPng,
  writePng,
  type DiffMetrics,
  type GridCell,
} from "./image.ts";
import { ensureFileDir, relativePosix, type ArtifactLayout } from "./paths.ts";

/** Widest comparison sheet produced; panels are downscaled to fit. */
export const COMPARISON_MAX_WIDTH = 2600;

export type ComparisonStatus =
  | "changed"
  | "identical"
  | "new"
  | "size-changed"
  | "baseline-only";

export type ComparisonEntry = {
  /** Path relative to `current/`, e.g. `terrain/terrain-40px-normal.png`. */
  relativePath: string;
  status: ComparisonStatus;
  current: string | null;
  baseline: string | null;
  diff: string | null;
  comparison: string | null;
  metrics: DiffMetrics | null;
  note?: string;
};

function listPngs(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".png")) continue;
      // Overviews are derived from the full capture; comparing both would
      // double every entry without adding information.
      if (name.endsWith("-overview.png")) continue;
      found.push(relativePosix(root, full));
    }
  };
  walk(root);
  return found;
}

function statusColor(status: ComparisonStatus): readonly [number, number, number] {
  if (status === "identical") return INK.muted;
  if (status === "new") return INK.accent;
  if (status === "size-changed") return INK.warn;
  if (status === "baseline-only") return INK.warn;
  return INK.alert;
}

function metricsCaption(metrics: DiffMetrics | null, status: ComparisonStatus): string {
  if (status === "new") return "no baseline for this capture";
  if (status === "baseline-only") return "capture missing from current run";
  if (status === "size-changed") return "dimensions changed; pixel diff skipped";
  if (!metrics) return "";
  if (metrics.changedPixels === 0) return "identical to baseline";
  return `${metrics.changedPixels} px changed (${(metrics.changedRatio * 100).toFixed(2)}%) · mean ${metrics.meanDifference.toFixed(2)} · max ${metrics.maxDifference}`;
}

/**
 * Panels share one width so BEFORE, CURRENT, and DIFF stay directly
 * comparable, and the whole row is downscaled together rather than per panel.
 */
function panelBox(images: readonly (PNG | null)[]): { width: number; height: number } {
  const widest = Math.max(...images.map((image) => image?.width ?? 1));
  const tallest = Math.max(...images.map((image) => image?.height ?? 1));
  const available = Math.floor((COMPARISON_MAX_WIDTH - 18 * 2 - 16 * 2) / 3);
  const scale = Math.min(1, available / widest);
  return { width: Math.max(1, Math.floor(widest * scale)), height: Math.max(1, Math.ceil(tallest * scale)) };
}

export function compareCaptures(
  layout: ArtifactLayout,
  options: { title?: (relativePath: string) => string } = {},
): ComparisonEntry[] {
  const currentFiles = listPngs(layout.current);
  const baselineFiles = listPngs(layout.baseline);
  const all = [...new Set([...currentFiles, ...baselineFiles])].sort();
  const entries: ComparisonEntry[] = [];

  for (const relativePath of all) {
    const currentFile = path.join(layout.current, relativePath);
    const baselineFile = path.join(layout.baseline, relativePath);
    const hasCurrent = currentFiles.includes(relativePath);
    const hasBaseline = baselineFiles.includes(relativePath);

    if (!hasCurrent) {
      entries.push({
        relativePath,
        status: "baseline-only",
        current: null,
        baseline: baselineFile,
        diff: null,
        comparison: null,
        metrics: null,
        note: "This capture exists in the baseline but was not produced by the current run.",
      });
      continue;
    }

    const currentImage = readPng(currentFile);
    const baselineImage = hasBaseline ? readPng(baselineFile) : null;

    let status: ComparisonStatus = hasBaseline ? "changed" : "new";
    let metrics: DiffMetrics | null = null;
    let diffImage: PNG | null = null;
    if (baselineImage) {
      if (baselineImage.width !== currentImage.width || baselineImage.height !== currentImage.height) {
        status = "size-changed";
      } else {
        const result = diffImages(baselineImage, currentImage);
        metrics = result.metrics;
        diffImage = result.image;
        status = result.metrics.changedPixels === 0 ? "identical" : "changed";
      }
    }

    const stem = relativePath.replace(/\.png$/, "");
    let diffFile: string | null = null;
    if (diffImage && status === "changed") {
      diffFile = ensureFileDir(path.join(layout.compare, `${stem}-diff.png`));
      writePng(diffFile, diffImage);
    }

    const box = panelBox([baselineImage, currentImage, diffImage]);
    const cells: GridCell[] = [
      {
        image: baselineImage ? fitWithin(baselineImage, box.width, box.height) : null,
        caption: "before (baseline)",
        subCaption: hasBaseline ? relativePath : "not captured",
        captionColor: INK.muted,
      },
      {
        image: fitWithin(currentImage, box.width, box.height),
        caption: "current (working tree)",
        subCaption: relativePath,
        captionColor: INK.accent,
      },
      {
        image: diffImage ? fitWithin(diffImage, box.width, box.height) : null,
        caption: "difference",
        subCaption: metricsCaption(metrics, status),
        captionColor: statusColor(status),
      },
    ];
    const comparisonFile = ensureFileDir(path.join(layout.compare, `${stem}-compare.png`));
    writePng(
      comparisonFile,
      composeGrid(cells, {
        title: options.title?.(relativePath) ?? stem,
        subtitle: `${status} · ${metricsCaption(metrics, status)}`,
        columns: 3,
        maxWidth: COMPARISON_MAX_WIDTH,
      }),
    );

    entries.push({
      relativePath,
      status,
      current: currentFile,
      baseline: hasBaseline ? baselineFile : null,
      diff: diffFile,
      comparison: comparisonFile,
      metrics,
      note: status === "size-changed"
        ? `Baseline was ${baselineImage!.width}x${baselineImage!.height}, current is ${currentImage.width}x${currentImage.height}.`
        : undefined,
    });
  }

  return entries;
}

export function writeComparisonIndex(layout: ArtifactLayout, entries: readonly ComparisonEntry[]): string {
  const file = ensureFileDir(path.join(layout.compare, "metrics.json"));
  const payload = {
    generatedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      path: entry.relativePath,
      status: entry.status,
      metrics: entry.metrics,
      note: entry.note,
    })),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

/** Cases whose pixels moved most, for a short "look here first" summary. */
export function rankByChange(entries: readonly ComparisonEntry[]): ComparisonEntry[] {
  return [...entries]
    .filter((entry) => entry.status === "changed" && entry.metrics)
    .sort((a, b) => (b.metrics!.changedRatio - a.metrics!.changedRatio));
}
