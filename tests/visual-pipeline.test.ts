import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import {
  captureSearchParams,
  captureSlug,
  captureUrl,
  clampCellSize,
  parseCaptureParams,
  safeSegment,
  validateCaptureRequest,
  DEFAULT_CAPTURE_PARAMS,
  MAX_CAPTURE_TIME_MS,
  SEED_SCENE_ID,
  VIEW_MODES,
  type CaptureParams,
} from "../tools/visual/capture-params.ts";
import {
  buildSampleCases,
  captureRequests,
  generatedSceneId,
  requiredSceneIds,
  sampleSeed,
  stripFileName,
  VISUAL_REVIEW_CASES,
} from "../tools/visual/review-matrix.ts";
import { guidanceForCase, REVIEW_PREAMBLE } from "../tools/visual/review-guidance.ts";
import {
  composeGrid,
  createPng,
  diffImages,
  downscale,
  drawText,
  fitWithin,
  measureText,
  readPng,
  writePng,
  INK,
} from "../tools/visual/image.ts";
import { compareCaptures, rankByChange, writeComparisonIndex } from "../tools/visual/compare.ts";
import { buildManifest, renderReportHtml, writeReport, DEV_ORIGIN } from "../tools/visual/report.ts";
import { artifactLayout, relativePosix, removeDir, repositoryRoot, resolveWithin } from "../tools/visual/paths.ts";
import { parseArgs, selectCases, USAGE } from "../tools/visual/cli.ts";
import { discoverChromiumExecutables, stripLayout } from "../tools/visual/capture.ts";
import { VISUAL_BRIDGE_VERSION } from "../tools/visual/bridge.ts";
import { HARNESS_OVERLAY } from "../tools/visual/baseline.ts";
import { buildVisualScenes } from "../tools/visual-scenes.ts";

const temporaryRoots: string[] = [];

function temporaryDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "circuit-bored-visual-test-"));
  temporaryRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (temporaryRoots.length > 0) removeDir(temporaryRoots.pop()!);
});

function solidPng(width: number, height: number, color: readonly [number, number, number]): PNG {
  return createPng(width, height, color);
}

function writeSolid(file: string, width: number, height: number, color: readonly [number, number, number]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writePng(file, solidPng(width, height, color));
}

describe("capture URL contract", () => {
  it("parses a complete capture request", () => {
    const { params, issues } = parseCaptureParams(
      "?capture=1&scene=terrain&cell=28&view=squint&backdrop=light&time=240&overlays=0&ambient=0&label=0",
    );
    expect(issues).toEqual([]);
    expect(params).toMatchObject({
      capture: true,
      sceneId: "terrain",
      cell: 28,
      view: "squint",
      backdrop: "light",
      timeMs: 240,
      overlays: false,
      ambient: false,
      label: false,
    });
  });

  it("defaults to a deterministic still frame", () => {
    const { params } = parseCaptureParams("?capture=1&scene=terrain");
    expect(params.timeMs).toBe(0);
    expect(params.cell).toBe(40);
    expect(params.view).toBe("normal");
    expect(params.overlays).toBe(true);
  });

  it("reports malformed parameters instead of silently substituting them", () => {
    expect(parseCaptureParams("?capture=1&scene=terrain&cell=41").issues).toEqual([
      expect.stringContaining("cell 41"),
    ]);
    expect(parseCaptureParams("?capture=1&scene=terrain&cell=abc").issues).toEqual([
      expect.stringContaining("not a number"),
    ]);
    expect(parseCaptureParams("?capture=1&scene=terrain&view=technicolor").issues).toEqual([
      expect.stringContaining("view 'technicolor'"),
    ]);
    expect(parseCaptureParams("?capture=1&scene=terrain&time=-5").issues).toEqual([
      expect.stringContaining("time '-5'"),
    ]);
    expect(parseCaptureParams(`?capture=1&scene=terrain&time=${MAX_CAPTURE_TIME_MS + 1}`).issues).toHaveLength(1);
    expect(parseCaptureParams("?capture=1&scene=terrain&inspectionTheme=nowhere").issues).toEqual([
      expect.stringContaining("inspectionTheme"),
    ]);
  });

  it("requires a scene in capture mode only", () => {
    expect(parseCaptureParams("?capture=1").issues).toEqual([expect.stringContaining("requires a 'scene'")]);
    expect(parseCaptureParams("?cell=40").issues).toEqual([]);
  });

  it("rejects scenes the lab cannot render", () => {
    const sceneIds = buildVisualScenes().map((scene) => scene.id);
    const request: CaptureParams = { ...DEFAULT_CAPTURE_PARAMS, capture: true, sceneId: "terrain" };
    expect(validateCaptureRequest(request, sceneIds)).toEqual([]);
    expect(validateCaptureRequest({ ...request, sceneId: SEED_SCENE_ID }, sceneIds)).toEqual([]);
    const missing = validateCaptureRequest({ ...request, sceneId: "terrian" }, sceneIds);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("unknown scene 'terrian'");
    // The error has to name the alternatives, or a typo costs a round trip.
    expect(missing[0]).toContain("terrain");
  });

  it("round-trips through serialization", () => {
    for (const view of VIEW_MODES) {
      const original: CaptureParams = {
        ...DEFAULT_CAPTURE_PARAMS,
        capture: true,
        sceneId: SEED_SCENE_ID,
        cell: 56,
        view,
        timeMs: 720,
        overlays: false,
        inspection: { themeId: "data_core", profile: "quiet", seed: "ROUND-TRIP" },
      };
      const { params, issues } = parseCaptureParams(captureSearchParams(original));
      expect(issues).toEqual([]);
      expect(params).toEqual(original);
    }
  });

  it("builds URLs against the lab page", () => {
    const url = captureUrl("http://localhost:5173/", {
      ...DEFAULT_CAPTURE_PARAMS,
      capture: true,
      sceneId: "units",
    });
    expect(url.startsWith("http://localhost:5173/visual-lab.html?")).toBe(true);
    expect(url).toContain("capture=1");
    expect(url).toContain("scene=units");
  });

  it("clamps cell sizes to even reviewable values", () => {
    expect(clampCellSize(41)).toBe(42);
    expect(clampCellSize(39)).toBe(40);
    expect(clampCellSize(2)).toBe(24);
    expect(clampCellSize(999)).toBe(64);
    expect(clampCellSize(Number.NaN)).toBe(40);
  });

  it("keeps slugs and path segments filesystem safe", () => {
    expect(captureSlug({ ...DEFAULT_CAPTURE_PARAMS, cell: 28, view: "squint", timeMs: 240 })).toBe("28px-squint-t240");
    expect(safeSegment("generated-data-core-landmark")).toBe("generated-data-core-landmark");
    expect(safeSegment("../../etc/passwd")).toBe("etc-passwd");
    expect(safeSegment("///")).toBe("unnamed");
  });
});

describe("review matrix", () => {
  it("only references scenes the lab actually has", () => {
    const known = new Set(buildVisualScenes().map((scene) => scene.id));
    for (const sceneId of requiredSceneIds(VISUAL_REVIEW_CASES)) {
      expect(known.has(sceneId), `unknown scene '${sceneId}' in the review matrix`).toBe(true);
    }
  });

  it("gives every case a unique id and a unique output file", () => {
    const ids = VISUAL_REVIEW_CASES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const files = VISUAL_REVIEW_CASES.flatMap((entry) => [
      ...captureRequests(entry).map((request) => `${entry.dir}/${request.fileName}`),
      ...(stripFileName(entry) ? [`${entry.dir}/${stripFileName(entry)}`] : []),
    ]);
    expect(new Set(files).size).toBe(files.length);
  });

  it("keeps every case inside the parameters the lab accepts", () => {
    for (const entry of VISUAL_REVIEW_CASES) {
      expect(clampCellSize(entry.cell)).toBe(entry.cell);
      expect(VIEW_MODES).toContain(entry.view);
      expect(entry.times.length).toBeGreaterThan(0);
      expect(new Set(entry.times).size).toBe(entry.times.length);
      for (const time of entry.times) {
        expect(time).toBeGreaterThanOrEqual(0);
        expect(time).toBeLessThanOrEqual(MAX_CAPTURE_TIME_MS);
      }
      expect(entry.note.length).toBeGreaterThan(20);
      const requests = captureRequests(entry);
      expect(requests.every((request) => request.params.capture)).toBe(true);
      expect(requests.every((request) => request.params.sceneId === entry.sceneId)).toBe(true);
    }
  });

  it("covers the review sizes and diagnostic modes the art direction requires", () => {
    const views = new Set(VISUAL_REVIEW_CASES.map((entry) => entry.view));
    expect(views).toEqual(new Set(["normal", "grayscale", "squint", "semantic"]));
    const cells = new Set(VISUAL_REVIEW_CASES.map((entry) => entry.cell));
    expect(cells).toEqual(new Set([28, 40, 56]));

    // Every high-risk scene family has to appear, or a renderer change could
    // pass review without anyone seeing it.
    const scenes = new Set(VISUAL_REVIEW_CASES.map((entry) => entry.sceneId));
    for (const required of ["terrain", "units", "overlays", "effects", "landmarks-foundry", "landmarks-data-core", "landmarks-derelict"]) {
      expect(scenes.has(required), `${required} is missing from the review matrix`).toBe(true);
    }
    for (const themeId of ["industrial", "data_core", "derelict"] as const) {
      for (const profile of ["landmark", "quiet"] as const) {
        expect(scenes.has(generatedSceneId(themeId, profile))).toBe(true);
      }
    }
    // Readability at the minimum gameplay size is checked on the scenes where
    // it actually breaks.
    const smallScenes = new Set(VISUAL_REVIEW_CASES.filter((entry) => entry.cell === 28).map((entry) => entry.sceneId));
    expect(smallScenes.has("units")).toBe(true);
    expect(smallScenes.has("terrain")).toBe(true);
    expect(smallScenes.has("overlays")).toBe(true);
  });

  it("captures animation as several fixed frames plus a strip", () => {
    const animated = VISUAL_REVIEW_CASES.filter((entry) => entry.times.length > 1);
    expect(animated.length).toBeGreaterThanOrEqual(2);
    expect(animated.some((entry) => entry.sceneId === "effects")).toBe(true);
    for (const entry of animated) {
      const requests = captureRequests(entry);
      expect(requests).toHaveLength(entry.times.length);
      expect(new Set(requests.map((request) => request.fileName)).size).toBe(entry.times.length);
      expect(requests.map((request) => request.params.timeMs)).toEqual(entry.times);
      expect(stripFileName(entry)).toBe(`${entry.id}.png`);
      // Zero-padded frame names keep the strip and directory listing in order.
      expect(requests[0].fileName).toMatch(/-t\d{4}\.png$/);
    }
    for (const entry of VISUAL_REVIEW_CASES.filter((candidate) => candidate.times.length === 1)) {
      expect(stripFileName(entry)).toBeNull();
    }
  });

  it("keeps the default review small enough to actually look at", () => {
    const images = VISUAL_REVIEW_CASES.reduce((sum, entry) => sum + entry.times.length + (entry.times.length > 1 ? 1 : 0), 0);
    expect(images).toBeGreaterThan(30);
    expect(images).toBeLessThanOrEqual(80);
  });

  it("samples uncurated seeds deterministically across every theme and profile", () => {
    const first = buildSampleCases(2);
    const second = buildSampleCases(2);
    expect(first).toEqual(second);
    expect(first).toHaveLength(12);
    expect(new Set(first.map((entry) => entry.id)).size).toBe(first.length);
    expect(first.every((entry) => entry.sceneId === SEED_SCENE_ID)).toBe(true);
    expect(new Set(first.map((entry) => entry.inspection!.seed)).size).toBe(first.length);
    expect(first[0].inspection!.seed).toBe(sampleSeed("industrial", "landmark", 0));
    // Sampling must not silently render hundreds of boards.
    expect(buildSampleCases(1000)).toHaveLength(24 * 6);
  });
});

describe("review guidance", () => {
  it("gives every review case something specific to look for", () => {
    for (const entry of VISUAL_REVIEW_CASES) {
      const groups = guidanceForCase(entry.sceneId, entry.view, entry.times.length > 1);
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.every((group) => group.questions.length > 0)).toBe(true);
      if (entry.view !== "normal") {
        expect(groups.some((group) => group.heading.includes("acceptance"))).toBe(true);
      }
      if (entry.times.length > 1) {
        expect(groups.some((group) => group.heading === "Ambient motion")).toBe(true);
      }
    }
    expect(REVIEW_PREAMBLE.join(" ")).toContain("Passing renderer tests does not prove visual quality");
  });
});

describe("image utilities", () => {
  it("writes and reads back exact pixels", () => {
    const dir = temporaryDir();
    const file = path.join(dir, "solid.png");
    writeSolid(file, 8, 4, [10, 20, 30]);
    const image = readPng(file);
    expect([image.width, image.height]).toEqual([8, 4]);
    expect([...image.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
  });

  it("rasterizes label text into the pixels it measured", () => {
    const image = createPng(measureText("AB", 2) + 4, 20, [0, 0, 0]);
    drawText(image, 0, 0, "AB", [255, 255, 255], 2);
    let lit = 0;
    for (let index = 0; index < image.width * image.height; index++) {
      if (image.data[index * 4] === 255) lit++;
    }
    expect(lit).toBeGreaterThan(0);
    // Text must stay inside the width the caller reserved for it.
    for (let y = 0; y < image.height; y++) {
      const index = (y * image.width + image.width - 1) * 4;
      expect(image.data[index]).toBe(0);
    }
  });

  it("reports no difference for identical captures", () => {
    const { metrics } = diffImages(solidPng(20, 10, [40, 50, 60]), solidPng(20, 10, [40, 50, 60]));
    expect(metrics).toMatchObject({ changedPixels: 0, changedRatio: 0, meanDifference: 0, maxDifference: 0 });
    expect(metrics.totalPixels).toBe(200);
  });

  it("localizes a single changed pixel", () => {
    const baseline = solidPng(20, 10, [0, 0, 0]);
    const current = solidPng(20, 10, [0, 0, 0]);
    const offset = (3 * 20 + 5) * 4;
    current.data[offset] = 255;
    current.data[offset + 1] = 255;
    current.data[offset + 2] = 255;
    const { metrics, image } = diffImages(baseline, current);
    expect(metrics.changedPixels).toBe(1);
    expect(metrics.maxDifference).toBe(255);
    expect(metrics.changedRatio).toBeCloseTo(1 / 200, 6);
    expect([image.width, image.height]).toEqual([20, 10]);
  });

  it("refuses to diff captures of different sizes", () => {
    expect(() => diffImages(solidPng(10, 10, [0, 0, 0]), solidPng(12, 10, [0, 0, 0])))
      .toThrow(/different sizes/);
  });

  it("downscales large boards without upscaling small ones", () => {
    const large = downscale(solidPng(1600, 800, [90, 90, 90]), 800);
    expect([large.width, large.height]).toEqual([800, 400]);
    expect([...large.data.subarray(0, 3)]).toEqual([90, 90, 90]);
    const small = downscale(solidPng(100, 50, [1, 2, 3]), 800);
    expect([small.width, small.height]).toEqual([100, 50]);
    expect(fitWithin(solidPng(300, 100, [0, 0, 0]), 150, 500).width).toBe(150);
  });

  it("composes a labelled grid that contains every panel", () => {
    const cells = [
      { image: solidPng(60, 40, [255, 0, 0]), caption: "before" },
      { image: solidPng(60, 40, [0, 255, 0]), caption: "current" },
      { image: null, caption: "difference" },
    ];
    // A missing panel still reserves a slot, so the three columns stay aligned
    // and "difference" cannot be mistaken for "current".
    const sheet = composeGrid(cells, { title: "case", columns: 3, padding: 10, gap: 10 });
    const panelWidth = 220;
    expect(sheet.width).toBe(10 * 2 + panelWidth * 3 + 10 * 2);
    const colors = new Set<string>();
    for (let index = 0; index < sheet.width * sheet.height; index++) {
      const offset = index * 4;
      colors.add(`${sheet.data[offset]},${sheet.data[offset + 1]},${sheet.data[offset + 2]}`);
    }
    expect(colors.has("255,0,0")).toBe(true);
    expect(colors.has("0,255,0")).toBe(true);
    expect(colors.has(INK.background.join(","))).toBe(true);
  });

  it("wraps a wide strip instead of producing an unreadable ribbon", () => {
    const cells = Array.from({ length: 5 }, (_, index) => ({
      image: solidPng(700, 200, [index * 10, 0, 0]),
      caption: `t = ${index}`,
    }));
    const sheet = composeGrid(cells, { columns: 5, maxWidth: 2400 });
    expect(sheet.width).toBeLessThanOrEqual(2400);
  });
});

describe("path safety", () => {
  it("keeps artifact writes inside the artifact root", () => {
    const root = temporaryDir();
    expect(resolveWithin(root, "terrain", "shot.png")).toBe(path.join(root, "terrain", "shot.png"));
    expect(() => resolveWithin(root, "..", "escape.png")).toThrow(/Refusing to write outside/);
    expect(() => resolveWithin(root, path.resolve(os.tmpdir(), "elsewhere.png"))).toThrow(/Refusing to write outside/);
  });

  it("lays artifacts out predictably and relative to the repository", () => {
    const layout = artifactLayout("/repo");
    expect(relativePosix(layout.repoRoot, layout.current)).toBe("artifacts/visual-review/current");
    expect(relativePosix(layout.repoRoot, layout.baseline)).toBe("artifacts/visual-review/baseline");
    expect(relativePosix(layout.repoRoot, layout.compare)).toBe("artifacts/visual-review/compare");
    expect(relativePosix(layout.repoRoot, layout.report)).toBe("artifacts/visual-review/report");
    expect(relativePosix(layout.repoRoot, artifactLayout("/repo", "custom/out").current)).toBe("custom/out/current");
  });

  it("keeps the repository root out of the artifact directory", () => {
    // `artifacts` is gitignored; a pipeline that wrote anywhere else would
    // pollute source control on every review.
    const ignored = readFileSync(path.join(repositoryRoot(), ".gitignore"), "utf8");
    expect(ignored.split("\n")).toContain("artifacts");
  });
});

describe("comparison", () => {
  function layoutWithCaptures(): ReturnType<typeof artifactLayout> {
    const root = temporaryDir();
    const layout = artifactLayout(root, "out");
    writeSolid(path.join(layout.current, "terrain", "same.png"), 20, 10, [30, 30, 30]);
    writeSolid(path.join(layout.baseline, "terrain", "same.png"), 20, 10, [30, 30, 30]);
    writeSolid(path.join(layout.current, "terrain", "moved.png"), 20, 10, [30, 30, 30]);
    writeSolid(path.join(layout.baseline, "terrain", "moved.png"), 20, 10, [200, 30, 30]);
    writeSolid(path.join(layout.current, "terrain", "added.png"), 20, 10, [10, 10, 10]);
    writeSolid(path.join(layout.current, "terrain", "resized.png"), 24, 10, [10, 10, 10]);
    writeSolid(path.join(layout.baseline, "terrain", "resized.png"), 20, 10, [10, 10, 10]);
    writeSolid(path.join(layout.baseline, "terrain", "removed.png"), 20, 10, [10, 10, 10]);
    // Overviews are derived images and must not become comparison entries.
    writeSolid(path.join(layout.current, "terrain", "same-overview.png"), 10, 5, [30, 30, 30]);
    return layout;
  }

  it("classifies every pairing and writes the artifacts each one needs", () => {
    const layout = layoutWithCaptures();
    const entries = compareCaptures(layout);
    const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
    expect([...byPath.keys()].sort()).toEqual([
      "terrain/added.png",
      "terrain/moved.png",
      "terrain/removed.png",
      "terrain/resized.png",
      "terrain/same.png",
    ]);

    expect(byPath.get("terrain/same.png")!.status).toBe("identical");
    expect(byPath.get("terrain/same.png")!.metrics!.changedPixels).toBe(0);
    // An identical capture needs no diff image; a comparison sheet is still
    // written so the report can show before and after side by side.
    expect(byPath.get("terrain/same.png")!.diff).toBeNull();
    expect(existsSync(byPath.get("terrain/same.png")!.comparison!)).toBe(true);

    const changed = byPath.get("terrain/moved.png")!;
    expect(changed.status).toBe("changed");
    expect(changed.metrics!.changedPixels).toBe(200);
    expect(existsSync(changed.diff!)).toBe(true);
    expect(existsSync(changed.comparison!)).toBe(true);

    const added = byPath.get("terrain/added.png")!;
    expect(added.status).toBe("new");
    expect(added.baseline).toBeNull();
    expect(added.metrics).toBeNull();
    expect(existsSync(added.comparison!)).toBe(true);

    const resized = byPath.get("terrain/resized.png")!;
    expect(resized.status).toBe("size-changed");
    expect(resized.metrics).toBeNull();
    expect(resized.note).toContain("20x10");

    const removed = byPath.get("terrain/removed.png")!;
    expect(removed.status).toBe("baseline-only");
    expect(removed.current).toBeNull();
  });

  it("produces comparison sheets wide enough for three labelled panels", () => {
    const layout = layoutWithCaptures();
    const entries = compareCaptures(layout);
    const sheet = readPng(entries.find((entry) => entry.relativePath === "terrain/moved.png")!.comparison!);
    expect(sheet.width).toBeGreaterThan(20 * 3);
    expect(sheet.height).toBeGreaterThan(10);
  });

  it("writes a machine-readable metrics index and ranks the biggest changes", () => {
    const layout = layoutWithCaptures();
    const entries = compareCaptures(layout);
    const file = writeComparisonIndex(layout, entries);
    const payload = JSON.parse(readFileSync(file, "utf8"));
    expect(payload.entries).toHaveLength(entries.length);
    expect(payload.entries.find((entry: { path: string }) => entry.path === "terrain/moved.png").metrics.changedPixels).toBe(200);
    const ranked = rankByChange(entries);
    expect(ranked.map((entry) => entry.relativePath)).toEqual(["terrain/moved.png"]);
  });

  it("handles a completely missing baseline", () => {
    const root = temporaryDir();
    const layout = artifactLayout(root, "out");
    writeSolid(path.join(layout.current, "units", "units-40px-normal.png"), 16, 8, [5, 5, 5]);
    const entries = compareCaptures(layout);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("new");
    expect(rankByChange(entries)).toEqual([]);
  });
});

describe("report", () => {
  function reportFixture() {
    const root = temporaryDir();
    const layout = artifactLayout(root, "out");
    const cases = VISUAL_REVIEW_CASES.filter((entry) => entry.sceneId === "terrain" || entry.sceneId === "effects");
    for (const entry of cases) {
      for (const request of captureRequests(entry)) {
        writeSolid(path.join(layout.current, entry.dir, request.fileName), 20, 10, [12, 12, 12]);
        writeSolid(path.join(layout.baseline, entry.dir, request.fileName), 20, 10, [12, 12, 12]);
      }
      const strip = stripFileName(entry);
      if (strip) {
        writeSolid(path.join(layout.current, entry.dir, strip), 40, 10, [12, 12, 12]);
        writeSolid(path.join(layout.baseline, entry.dir, strip), 40, 10, [12, 12, 12]);
      }
    }
    const comparisons = compareCaptures(layout);
    return { layout, cases, comparisons, root };
  }

  it("pairs every matrix case with the files that were captured for it", () => {
    const { layout, cases, comparisons } = reportFixture();
    const manifest = buildManifest({
      layout,
      mode: "review",
      cases,
      comparisons,
      head: null,
      base: null,
      baselineNote: "test",
    });
    expect(manifest.cases).toHaveLength(cases.length);
    expect(manifest.summary.images).toBe(
      cases.reduce((sum, entry) => sum + entry.times.length + (stripFileName(entry) ? 1 : 0), 0),
    );
    for (const entry of manifest.cases) {
      expect(entry.review.length).toBeGreaterThan(20);
      expect(entry.guidance.length).toBeGreaterThan(0);
      for (const frame of [...entry.frames, ...(entry.strip ? [entry.strip] : [])]) {
        expect(frame.current).not.toBeNull();
        expect(frame.baseline).not.toBeNull();
        expect(frame.comparison).not.toBeNull();
        expect(frame.status).toBe("identical");
        // Manifest paths are repository-relative so they survive being read on
        // another machine or pasted into a report.
        expect(path.isAbsolute(frame.current!)).toBe(false);
        expect(frame.current!.startsWith("out/current/")).toBe(true);
        expect(frame.captureUrl.startsWith(DEV_ORIGIN)).toBe(true);
        expect(frame.captureUrl).toContain(`scene=${entry.sceneId}`);
      }
      expect(entry.animated).toBe(entry.times.length > 1);
      expect(entry.strip === null).toBe(entry.times.length === 1);
    }
  });

  it("marks captures that have no baseline instead of inventing one", () => {
    const { layout, cases } = reportFixture();
    removeDir(layout.baseline);
    const manifest = buildManifest({
      layout,
      mode: "capture",
      cases,
      comparisons: compareCaptures(layout),
      head: null,
      base: null,
      baselineNote: "no baseline",
    });
    expect(manifest.summary.withoutBaseline).toBe(manifest.summary.images);
    expect(manifest.summary.changed).toBe(0);
    for (const entry of manifest.cases) {
      for (const frame of entry.frames) {
        expect(frame.baseline).toBeNull();
        expect(frame.diff).toBeNull();
        expect(frame.status).toBe("new");
      }
    }
  });

  it("writes an HTML report that states what to look for", () => {
    const { layout, cases, comparisons } = reportFixture();
    const { manifest, htmlFile, manifestFile } = writeReport({
      layout,
      mode: "review",
      cases,
      comparisons,
      head: null,
      base: null,
      baselineNote: "test baseline note",
    });
    expect(existsSync(htmlFile)).toBe(true);
    expect(existsSync(manifestFile)).toBe(true);
    const html = readFileSync(htmlFile, "utf8");
    expect(html).toContain("Passing renderer tests does not prove visual quality");
    expect(html).toContain("test baseline note");
    for (const entry of manifest.cases) {
      expect(html).toContain(`id="${entry.caseId}"`);
      expect(html).toContain(entry.note);
    }
    // Images are referenced relative to the report directory so the folder can
    // be zipped and opened anywhere.
    expect(html).toContain('src="../compare/');
    expect(html).toContain('href="../current/');
    expect(html).toContain('href="../baseline/');
    expect(html).not.toContain(layout.repoRoot);
    const parsed = JSON.parse(readFileSync(manifestFile, "utf8"));
    expect(parsed.cases).toHaveLength(cases.length);
    expect(parsed.artifactRoot).toBe("out");
  });

  it("escapes scene text rather than injecting it into the report markup", () => {
    const { layout, cases, comparisons } = reportFixture();
    const manifest = buildManifest({ layout, mode: "review", cases, comparisons, head: null, base: null, baselineNote: "" });
    manifest.cases[0].review = '<script>alert("x")</script>';
    const html = renderReportHtml(layout, manifest);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("command line", () => {
  it("defaults to a full review", () => {
    expect(parseArgs([])).toMatchObject({ command: "review", useBaseline: true, sceneFilter: [], seeds: 3 });
  });

  it("parses every command and option", () => {
    expect(parseArgs(["capture"]).command).toBe("capture");
    expect(parseArgs(["sample", "--seeds", "5"])).toMatchObject({ command: "sample", seeds: 5 });
    expect(parseArgs(["review", "--base", "main"]).base).toBe("main");
    expect(parseArgs(["review", "--no-baseline"]).useBaseline).toBe(false);
    expect(parseArgs(["review", "--refresh-baseline"]).refreshBaseline).toBe(true);
    expect(parseArgs(["review", "--scene", "terrain,units"]).sceneFilter).toEqual(["terrain", "units"]);
    expect(parseArgs(["review", "--out", "tmp/out"]).outDir).toBe("tmp/out");
    expect(parseArgs(["review", "--quiet"]).quiet).toBe(true);
  });

  it("rejects unusable input with usage text", () => {
    expect(() => parseArgs(["render"])).toThrow(/Unknown command 'render'/);
    expect(() => parseArgs(["review", "--nope"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["review", "--base"])).toThrow(/--base expects a value/);
    expect(() => parseArgs(["sample", "--seeds", "0"])).toThrow(/positive number/);
    expect(USAGE).toContain("visual-review.mjs");
  });

  it("filters cases by scene, case id, or directory", () => {
    expect(selectCases(VISUAL_REVIEW_CASES, []).length).toBe(VISUAL_REVIEW_CASES.length);
    const terrain = selectCases(VISUAL_REVIEW_CASES, ["terrain"]);
    expect(terrain.length).toBeGreaterThan(0);
    expect(terrain.every((entry) => entry.sceneId === "terrain")).toBe(true);
    expect(selectCases(VISUAL_REVIEW_CASES, ["generated"]).every((entry) => entry.dir === "generated")).toBe(true);
    expect(selectCases(VISUAL_REVIEW_CASES, ["terrain-28px-normal"])).toHaveLength(1);
    expect(() => selectCases(VISUAL_REVIEW_CASES, ["nonexistent"])).toThrow(/No review cases matched/);
  });
});

describe("capture runner wiring", () => {
  it("looks for a browser without throwing when none is installed", () => {
    expect(Array.isArray(discoverChromiumExecutables())).toBe(true);
  });

  it("declares the bridge version the lab publishes", () => {
    expect(VISUAL_BRIDGE_VERSION).toBe(1);
    const lab = readFileSync(path.join(repositoryRoot(), "tools", "visual-lab.ts"), "utf8");
    expect(lab).toContain("VISUAL_BRIDGE_VERSION");
    // The ready flag and the error channel are the runner's only synchronisation
    // points; renaming them silently would hang every capture.
    expect(lab).toContain("dataset.visualReady");
    expect(lab).toContain("__CIRCUIT_BORED_VISUAL__");
  });

  it("only overlays the capture harness onto a baseline worktree", () => {
    expect(HARNESS_OVERLAY).toContain("visual-lab.html");
    expect(HARNESS_OVERLAY).toContain("tools/visual-lab.ts");
    expect(HARNESS_OVERLAY).toContain("tools/visual");
    // Copying src/ would compare the working tree against itself.
    expect(HARNESS_OVERLAY.some((entry) => entry.startsWith("src"))).toBe(false);
  });

  it("keeps the capture stage addressable from the lab page", () => {
    const html = readFileSync(path.join(repositoryRoot(), "visual-lab.html"), "utf8");
    expect(html).toContain('id="capture-stage"');
    expect(html).toContain('id="capture-label"');
    expect(html).toContain('body[data-capture="1"] .shell');
  });
});

describe("animation strip layout", () => {
  it("keeps frames side by side instead of stacking them into a column", () => {
    // A strip exists so frames can be compared against each other. Falling back
    // to one column produces a very tall image nobody can compare across.
    expect(stripLayout(5, 632)).toMatchObject({ columns: 3 });
    expect(stripLayout(3, 1312).columns).toBe(3);
    expect(stripLayout(2, 900).columns).toBe(2);
  });

  it("never asks a panel to be wider than the strip", () => {
    for (const frames of [2, 3, 4, 5, 6]) {
      for (const native of [300, 632, 1312, 2600]) {
        const layout = stripLayout(frames, native);
        expect(layout.columns).toBeGreaterThanOrEqual(1);
        expect(layout.columns).toBeLessThanOrEqual(frames);
        expect(layout.panelWidth * layout.columns).toBeLessThanOrEqual(2400);
      }
    }
  });

  it("only downscales panels that are genuinely too wide", () => {
    // 632 px effect frames fit natively; a 1312 px gallery board does not.
    expect(stripLayout(5, 632).panelWidth).toBeGreaterThanOrEqual(632);
    expect(stripLayout(3, 1312).panelWidth).toBeLessThan(1312);
  });
});
