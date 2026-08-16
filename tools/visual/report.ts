/**
 * The review report.
 *
 * Two outputs, one for each kind of reader: `manifest.json` so an agent can
 * find every file and metric without parsing markup, and `index.html` so a
 * human (or an agent rendering it) sees the images with the scene's own review
 * objective and the art-direction questions beside them.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { captureRequests, stripFileName, type ReviewCase } from "./review-matrix.ts";
import { guidanceForCase, REVIEW_PREAMBLE, type GuidanceGroup } from "./review-guidance.ts";
import { sceneInfo } from "./scene-registry.ts";
import { captureUrl } from "./capture-params.ts";
import { ensureFileDir, relativePosix, type ArtifactLayout } from "./paths.ts";
import type { ComparisonEntry } from "./compare.ts";
import type { DiffMetrics } from "./image.ts";
import type { BaseRef, HeadRef } from "./baseline.ts";

export type ManifestImage = {
  timeMs: number | null;
  /** Repository-relative paths; null when the file was not produced. */
  current: string | null;
  currentOverview: string | null;
  baseline: string | null;
  comparison: string | null;
  diff: string | null;
  status: string;
  metrics: DiffMetrics | null;
  /** The capture URL that reproduces this exact frame in a browser. */
  captureUrl: string;
};

export type ManifestCase = {
  caseId: string;
  sceneId: string;
  title: string;
  description: string;
  review: string;
  note: string;
  cell: number;
  view: string;
  animated: boolean;
  times: number[];
  guidance: GuidanceGroup[];
  frames: ManifestImage[];
  strip: ManifestImage | null;
};

export type Manifest = {
  generatedAt: string;
  mode: string;
  artifactRoot: string;
  head: HeadRef | null;
  base: (BaseRef & { captured: boolean }) | null;
  baselineNote: string;
  preamble: string[];
  summary: {
    cases: number;
    images: number;
    changed: number;
    identical: number;
    withoutBaseline: number;
  };
  cases: ManifestCase[];
};

export type ReportInput = {
  layout: ArtifactLayout;
  mode: string;
  cases: readonly ReviewCase[];
  comparisons: readonly ComparisonEntry[];
  head: HeadRef | null;
  base: (BaseRef & { captured: boolean }) | null;
  baselineNote: string;
};

/**
 * Capture URLs in the report point at the documented dev-server origin, not at
 * the ephemeral port the run happened to use. The URL is there so a human can
 * reopen a frame after `npm run dev:visual`, and a random port would also make
 * the manifest differ between otherwise identical runs.
 */
export const DEV_ORIGIN = "http://localhost:5173";

function repoRelative(layout: ArtifactLayout, file: string | null): string | null {
  return file ? relativePosix(layout.repoRoot, file) : null;
}

function buildManifestImage(
  input: ReportInput,
  relativePath: string,
  timeMs: number | null,
  url: string,
): ManifestImage {
  const { layout } = input;
  const comparison = input.comparisons.find((entry) => entry.relativePath === relativePath) ?? null;
  const currentFile = path.join(layout.current, relativePath);
  const overviewFile = currentFile.replace(/\.png$/, "-overview.png");
  return {
    timeMs,
    current: existsSync(currentFile) ? repoRelative(layout, currentFile) : null,
    currentOverview: existsSync(overviewFile) ? repoRelative(layout, overviewFile) : null,
    baseline: comparison?.baseline ? repoRelative(layout, comparison.baseline) : null,
    comparison: comparison?.comparison ? repoRelative(layout, comparison.comparison) : null,
    diff: comparison?.diff ? repoRelative(layout, comparison.diff) : null,
    status: comparison?.status ?? (existsSync(currentFile) ? "new" : "missing"),
    metrics: comparison?.metrics ?? null,
    captureUrl: url,
  };
}

export function buildManifest(input: ReportInput): Manifest {
  const cases: ManifestCase[] = input.cases.map((entry) => {
    const info = sceneInfo(entry.sceneId, entry.inspection);
    const requests = captureRequests(entry);
    const frames = requests.map((request) =>
      buildManifestImage(
        input,
        `${entry.dir}/${request.fileName}`,
        request.timeMs,
        captureUrl(DEV_ORIGIN, request.params),
      ),
    );
    const stripName = stripFileName(entry);
    return {
      caseId: entry.id,
      sceneId: entry.sceneId,
      title: info?.title ?? entry.sceneId,
      description: info?.description ?? "",
      review: info?.review ?? "",
      note: entry.note,
      cell: entry.cell,
      view: entry.view,
      animated: entry.times.length > 1,
      times: [...entry.times],
      guidance: guidanceForCase(entry.sceneId, entry.view, entry.times.length > 1),
      frames,
      strip: stripName
        ? buildManifestImage(input, `${entry.dir}/${stripName}`, null, captureUrl(DEV_ORIGIN, requests[0].params))
        : null,
    };
  });

  const images = cases.flatMap((entry) => [...entry.frames, ...(entry.strip ? [entry.strip] : [])]);
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    artifactRoot: relativePosix(input.layout.repoRoot, input.layout.root),
    head: input.head,
    base: input.base,
    baselineNote: input.baselineNote,
    preamble: REVIEW_PREAMBLE,
    summary: {
      cases: cases.length,
      images: images.length,
      changed: images.filter((image) => image.status === "changed").length,
      identical: images.filter((image) => image.status === "identical").length,
      withoutBaseline: images.filter((image) => image.baseline === null).length,
    },
    cases,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Path from the report directory to an artifact, for use in `src`/`href`. */
function fromReport(layout: ArtifactLayout, repoRelativePath: string | null): string | null {
  if (!repoRelativePath) return null;
  return relativePosix(layout.report, path.join(layout.repoRoot, repoRelativePath));
}

function metricsText(image: ManifestImage): string {
  if (image.status === "new") return "no baseline";
  if (image.status === "identical") return "identical to baseline";
  if (image.status === "size-changed") return "dimensions changed";
  if (!image.metrics) return image.status;
  return `${image.metrics.changedPixels.toLocaleString("en-US")} px (${(image.metrics.changedRatio * 100).toFixed(2)}%) · mean ${image.metrics.meanDifference.toFixed(2)} · max ${image.metrics.maxDifference}`;
}

function imageBlock(layout: ArtifactLayout, image: ManifestImage, caption: string): string {
  const primary = fromReport(layout, image.comparison ?? image.current);
  const isComparison = Boolean(image.comparison);
  if (!primary) return `<figure class="shot"><figcaption>${escapeHtml(caption)} — not captured</figcaption></figure>`;
  const links = [
    image.current ? `<a href="${fromReport(layout, image.current)}">current</a>` : "",
    image.baseline ? `<a href="${fromReport(layout, image.baseline)}">baseline</a>` : "",
    image.diff ? `<a href="${fromReport(layout, image.diff)}">diff</a>` : "",
    image.currentOverview ? `<a href="${fromReport(layout, image.currentOverview)}">overview</a>` : "",
    `<a href="${escapeHtml(image.captureUrl)}">capture URL</a>`,
  ].filter(Boolean).join(" · ");
  return `<figure class="shot">
      <img src="${primary}" alt="${escapeHtml(caption)}" loading="lazy" />
      <figcaption>
        <strong>${escapeHtml(caption)}</strong>
        <span class="status status-${escapeHtml(image.status)}">${escapeHtml(metricsText(image))}</span>
        <span class="kind">${isComparison ? "before / current / difference" : "current capture"}</span>
        <span class="links">${links}</span>
      </figcaption>
    </figure>`;
}

function caseSection(layout: ArtifactLayout, entry: ManifestCase): string {
  const guidance = entry.guidance
    .map((group) => `<div class="guide"><h4>${escapeHtml(group.heading)}</h4><ul>${group.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul></div>`)
    .join("");
  const shots = [
    ...(entry.strip ? [imageBlock(layout, entry.strip, `${entry.caseId} · frame strip`)] : []),
    ...entry.frames.map((frame) => imageBlock(layout, frame, frame.timeMs === null ? entry.caseId : `${entry.caseId} · t = ${frame.timeMs} ms`)),
  ].join("");
  return `<section class="case" id="${escapeHtml(entry.caseId)}">
    <header>
      <h3>${escapeHtml(entry.title)}</h3>
      <p class="meta">${escapeHtml(entry.sceneId)} · ${entry.cell} px · ${escapeHtml(entry.view)} · ${entry.animated ? `${entry.times.length} fixed frames` : `t = ${entry.times[0]} ms`}</p>
      <p class="review"><strong>Review objective:</strong> ${escapeHtml(entry.review)}</p>
      <p class="note"><strong>Why this capture:</strong> ${escapeHtml(entry.note)}</p>
      <p class="description">${escapeHtml(entry.description)}</p>
    </header>
    <div class="guides">${guidance}</div>
    <div class="shots">${shots}</div>
  </section>`;
}

export function renderReportHtml(layout: ArtifactLayout, manifest: Manifest): string {
  const ranked = manifest.cases
    .flatMap((entry) => entry.frames.concat(entry.strip ? [entry.strip] : []).map((image) => ({ entry, image })))
    .filter(({ image }) => image.metrics && image.status === "changed")
    .sort((a, b) => b.image.metrics!.changedRatio - a.image.metrics!.changedRatio)
    .slice(0, 15);

  const summaryRows = ranked.length > 0
    ? ranked.map(({ entry, image }) => `<tr><td><a href="#${escapeHtml(entry.caseId)}">${escapeHtml(entry.caseId)}</a></td><td>${image.timeMs === null ? "strip" : `${image.timeMs} ms`}</td><td>${(image.metrics!.changedRatio * 100).toFixed(2)}%</td><td>${image.metrics!.changedPixels.toLocaleString("en-US")}</td><td>${image.metrics!.meanDifference.toFixed(2)}</td></tr>`).join("")
    : `<tr><td colspan="5">No pixel differences were measured${manifest.base ? "" : " (no baseline was captured)"}.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Circuit Bored · visual review</title>
<style>
  :root { color-scheme: dark; --bg:#071019; --panel:#0e1822; --line:#263b49; --text:#e7f0f4; --muted:#8da5b2; --cyan:#58e4f1; --amber:#ffd166; --red:#ff6677; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px; background:var(--bg); color:var(--text); font:15px/1.55 ui-sans-serif, system-ui, sans-serif; }
  h1 { margin:0 0 6px; font-size:30px; letter-spacing:-.02em; }
  h3 { margin:0 0 4px; font-size:19px; }
  h4 { margin:0 0 4px; color:var(--cyan); font:700 11px ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase; }
  a { color:var(--cyan); }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .lede { max-width:900px; color:var(--muted); }
  .lede li { margin-bottom:4px; }
  .facts { display:flex; flex-wrap:wrap; gap:10px 26px; margin:16px 0 24px; padding:12px 14px; border:1px solid var(--line); background:var(--panel); font:12px ui-monospace, monospace; }
  .facts b { color:var(--cyan); font-weight:700; }
  table { width:100%; border-collapse:collapse; margin-bottom:28px; font:13px ui-monospace, monospace; }
  th, td { padding:7px 10px; border-bottom:1px solid var(--line); text-align:left; }
  th { color:var(--cyan); font-size:11px; letter-spacing:.06em; text-transform:uppercase; }
  .case { margin-bottom:34px; padding:18px; border:1px solid var(--line); background:var(--panel); }
  .meta { margin:0 0 8px; color:var(--muted); font:12px ui-monospace, monospace; }
  .review { margin:0 0 6px; color:#d8e8ee; }
  .note, .description { margin:0 0 6px; color:var(--muted); font-size:13px; }
  .guides { display:flex; flex-wrap:wrap; gap:14px; margin:14px 0 18px; }
  .guide { flex:1 1 280px; padding:10px 12px; border:1px solid var(--line); background:rgba(6,12,18,.6); }
  .guide ul { margin:0; padding-left:18px; color:var(--muted); font-size:13px; }
  .shots { display:grid; gap:18px; }
  .shot { margin:0; }
  .shot img { display:block; width:100%; height:auto; border:1px solid var(--line); background:#050c12; }
  figcaption { display:flex; flex-wrap:wrap; gap:6px 16px; padding-top:7px; font:12px ui-monospace, monospace; color:var(--muted); }
  .status-changed { color:var(--red); }
  .status-identical { color:var(--muted); }
  .status-new { color:var(--cyan); }
  .status-size-changed { color:var(--amber); }
</style>
</head>
<body>
<h1>Circuit Bored · visual review</h1>
<ul class="lede">${manifest.preamble.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
<div class="facts">
  <span><b>generated</b> ${escapeHtml(manifest.generatedAt)}</span>
  <span><b>mode</b> ${escapeHtml(manifest.mode)}</span>
  <span><b>head</b> ${escapeHtml(manifest.head ? `${manifest.head.branch} @ ${manifest.head.shortSha}${manifest.head.dirty ? " (dirty)" : ""}` : "unknown")}</span>
  <span><b>baseline</b> ${escapeHtml(manifest.base ? `${manifest.base.resolvedFrom} @ ${manifest.base.shortSha} — ${manifest.base.subject}` : "none")}</span>
  <span><b>cases</b> ${manifest.summary.cases}</span>
  <span><b>images</b> ${manifest.summary.images}</span>
  <span><b>changed</b> ${manifest.summary.changed}</span>
  <span><b>identical</b> ${manifest.summary.identical}</span>
</div>
<p class="lede">${escapeHtml(manifest.baselineNote)}</p>
<h3>Largest pixel changes</h3>
<table><thead><tr><th>case</th><th>frame</th><th>changed</th><th>pixels</th><th>mean delta</th></tr></thead><tbody>${summaryRows}</tbody></table>
${manifest.cases.map((entry) => caseSection(layout, entry)).join("\n")}
</body>
</html>
`;
}

export function writeReport(input: ReportInput): { manifestFile: string; htmlFile: string; manifest: Manifest } {
  const manifest = buildManifest(input);
  const manifestFile = ensureFileDir(path.join(input.layout.report, "manifest.json"));
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const htmlFile = ensureFileDir(path.join(input.layout.report, "index.html"));
  writeFileSync(htmlFile, renderReportHtml(input.layout, manifest));
  return { manifestFile, htmlFile, manifest };
}
