/**
 * Headless capture.
 *
 * One Chromium instance, one page, one Vite server, and one navigation. After
 * the lab has built its scenes the runner drives it through the in-page
 * capture bridge, so forty screenshots cost forty renders instead of forty
 * page loads. Every frame still corresponds to a real capture URL, which is
 * what a human opens when a capture looks wrong.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";
import { PNG } from "pngjs";
import "./bridge.ts";
import {
  captureSearchParams,
  captureUrl,
  type CaptureParams,
} from "./capture-params.ts";
import { captureRequests, stripFileName, type ReviewCase } from "./review-matrix.ts";
import { composeGrid, downscale, fitWithin, readPng, writePng, type GridCell } from "./image.ts";
import { ensureFileDir, resolveWithin } from "./paths.ts";

/** Native captures wider or taller than this also get a downscaled overview. */
export const OVERVIEW_THRESHOLD_PX = 1200;
export const OVERVIEW_MAX_PX = 900;

const READY_TIMEOUT_MS = 30_000;

export type CapturedFrame = {
  caseId: string;
  sceneId: string;
  timeMs: number;
  /** Absolute path of the written PNG. */
  file: string;
  /** Absolute path of the downscaled overview, when one was needed. */
  overviewFile: string | null;
  width: number;
  height: number;
  url: string;
};

export type CapturedCase = {
  entry: ReviewCase;
  frames: CapturedFrame[];
  /** Absolute path of the composed animation strip, for multi-frame cases. */
  stripFile: string | null;
};

export type CaptureRunOptions = {
  origin: string;
  outDir: string;
  cases: readonly ReviewCase[];
  /** "current" or "baseline"; used in log lines and strip titles. */
  label: string;
  onProgress?: (message: string) => void;
};

export type PageDiagnostic = {
  kind: "console" | "pageerror" | "requestfailed";
  text: string;
};

function formatContext(params: CaptureParams, url: string): string {
  return [
    `scene: ${params.sceneId}`,
    `cell: ${params.cell}px`,
    `view: ${params.view}`,
    `time: ${params.timeMs}ms`,
    `url: ${url}`,
  ].join("\n  ");
}

/** Console noise that says nothing about the renderer. */
function isIgnorableDiagnostic(text: string): boolean {
  return /favicon|Download the React DevTools|\[vite\] connect/i.test(text);
}

/**
 * Find a usable Chromium.
 *
 * Playwright's own managed browser is preferred. Environments that
 * pre-install Chromium at a pinned revision (CI images, sandboxes) are handled
 * by falling back to whatever lives under PLAYWRIGHT_BROWSERS_PATH, so the
 * pipeline does not force a browser download it cannot perform.
 */
export function discoverChromiumExecutables(): string[] {
  const candidates: string[] = [];
  const explicit = process.env.CIRCUIT_BORED_CHROMIUM;
  if (explicit) candidates.push(explicit);
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const suffixes = [
      ["chrome-linux", "chrome"],
      ["chrome-linux64", "chrome"],
      ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
      ["chrome-win", "chrome.exe"],
    ];
    const entries = ["", ...readdirSync(root).filter((name) => name.startsWith("chromium"))];
    for (const entry of entries) {
      const base = entry ? path.join(root, entry) : path.join(root, "chromium");
      if (entry === "" && existsSync(base)) candidates.push(base);
      for (const suffix of suffixes) {
        const candidate = path.join(base, ...suffix);
        if (existsSync(candidate)) candidates.push(candidate);
      }
    }
  }
  return [...new Set(candidates)];
}

export async function launchChromium(): Promise<Browser> {
  const failures: string[] = [];
  try {
    return await chromium.launch();
  } catch (error) {
    failures.push(`managed browser: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  for (const executablePath of discoverChromiumExecutables()) {
    try {
      return await chromium.launch({ executablePath });
    } catch (error) {
      failures.push(`${executablePath}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  throw new Error(
    "No usable Chromium was found for visual capture.\n" +
      "Install one with `npx playwright install chromium`, or point CIRCUIT_BORED_CHROMIUM at an existing binary.\n" +
      `Attempts:\n  ${failures.join("\n  ")}`,
  );
}

type CaptureSession = {
  page: Page;
  diagnostics: PageDiagnostic[];
  navigated: boolean;
};

async function applyParams(session: CaptureSession, origin: string, params: CaptureParams): Promise<string> {
  const url = captureUrl(origin, params);
  const search = `?${captureSearchParams(params)}`;
  session.diagnostics.length = 0;
  if (!session.navigated) {
    await session.page.goto(url, { waitUntil: "domcontentloaded" });
    session.navigated = true;
  } else {
    await session.page.evaluate((nextSearch) => {
      const bridge = window.__CIRCUIT_BORED_VISUAL__;
      if (!bridge) throw new Error("Visual lab capture bridge is missing");
      bridge.applyCapture(nextSearch);
    }, search);
  }
  return url;
}

async function waitForReady(session: CaptureSession, params: CaptureParams, url: string): Promise<void> {
  try {
    await session.page.waitForFunction(
      () => {
        const bridge = window.__CIRCUIT_BORED_VISUAL__;
        if (!bridge) return false;
        if (bridge.error) return true;
        return bridge.ready && document.fonts.status === "loaded";
      },
      undefined,
      { timeout: READY_TIMEOUT_MS },
    );
  } catch (error) {
    throw new Error(
      `Visual lab never reached its ready state.\n  ${formatContext(params, url)}\n  ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }${describeDiagnostics(session.diagnostics)}`,
    );
  }
  const failure = await session.page.evaluate(() => window.__CIRCUIT_BORED_VISUAL__?.error ?? null);
  if (failure) {
    throw new Error(`Visual lab reported a capture failure.\n  ${formatContext(params, url)}\n  ${failure}${describeDiagnostics(session.diagnostics)}`);
  }
  const problems = session.diagnostics.filter((entry) => !isIgnorableDiagnostic(entry.text));
  if (problems.length > 0) {
    throw new Error(`The Visual Lab logged errors while rendering.\n  ${formatContext(params, url)}${describeDiagnostics(problems)}`);
  }
}

function describeDiagnostics(diagnostics: readonly PageDiagnostic[]): string {
  const problems = diagnostics.filter((entry) => !isIgnorableDiagnostic(entry.text));
  if (problems.length === 0) return "";
  return `\n  browser output:\n    ${problems.map((entry) => `[${entry.kind}] ${entry.text}`).join("\n    ")}`;
}

/**
 * Every scene id the lab served from `origin` knows how to render.
 *
 * Read straight off the capture bridge, which is installed before the lab
 * tries to honour any request - so this answers "what does this build know
 * about?" even when the request that opened the page names a scene it has
 * never heard of. A baseline built from an older commit is exactly that case.
 */
export async function readSceneIds(browser: Browser, origin: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/visual-lab.html?capture=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => Boolean(window.__CIRCUIT_BORED_VISUAL__),
      undefined,
      { timeout: READY_TIMEOUT_MS },
    );
    return await page.evaluate(() => [...(window.__CIRCUIT_BORED_VISUAL__?.sceneIds ?? [])]);
  } finally {
    await context.close();
  }
}

/** Run every case, writing PNGs under `outDir`. */
export async function captureCases(browser: Browser, options: CaptureRunOptions): Promise<CapturedCase[]> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const diagnostics: PageDiagnostic[] = [];
  const session: CaptureSession = { page, diagnostics, navigated: false };
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    // Network console errors carry no URL in their text, so the source has to
    // be appended before the noise filter can tell a missing favicon from a
    // missing module.
    const location = message.location().url;
    diagnostics.push({ kind: "console", text: location ? `${message.text()} (${location})` : message.text() });
  });
  page.on("pageerror", (error) => diagnostics.push({ kind: "pageerror", text: error.stack ?? error.message }));
  page.on("requestfailed", (request) => {
    diagnostics.push({ kind: "requestfailed", text: `${request.url()} ${request.failure()?.errorText ?? ""}` });
  });

  const results: CapturedCase[] = [];
  try {
    for (const entry of options.cases) {
      const frames: CapturedFrame[] = [];
      for (const request of captureRequests(entry)) {
        const url = await applyParams(session, options.origin, request.params);
        await waitForReady(session, request.params, url);

        const size = await page.evaluate(() => window.__CIRCUIT_BORED_VISUAL__!.captureSize());
        if (size.width <= 0 || size.height <= 0) {
          throw new Error(`Capture stage measured ${size.width}x${size.height}.\n  ${formatContext(request.params, url)}`);
        }
        const viewport = page.viewportSize();
        if (!viewport || viewport.width < size.width + 8 || viewport.height < size.height + 8) {
          await page.setViewportSize({
            width: Math.max(640, size.width + 8),
            height: Math.max(480, size.height + 8),
          });
        }

        const file = resolveWithin(options.outDir, entry.dir, request.fileName);
        ensureFileDir(file);
        const buffer = await page.locator("#capture-stage").screenshot({ scale: "css", animations: "disabled" });
        const image = PNG.sync.read(buffer);
        if (image.width !== size.width || image.height !== size.height) {
          throw new Error(
            `Screenshot was ${image.width}x${image.height} but the stage measured ${size.width}x${size.height}.\n  ${formatContext(request.params, url)}`,
          );
        }
        writePng(file, image);

        let overviewFile: string | null = null;
        if (Math.max(image.width, image.height) > OVERVIEW_THRESHOLD_PX) {
          overviewFile = file.replace(/\.png$/, "-overview.png");
          writePng(overviewFile, downscale(image, OVERVIEW_MAX_PX));
        }

        frames.push({
          caseId: entry.id,
          sceneId: entry.sceneId,
          timeMs: request.timeMs,
          file,
          overviewFile,
          width: image.width,
          height: image.height,
          url,
        });
        options.onProgress?.(`${options.label}: ${path.posix.join(entry.dir, request.fileName)} (${image.width}x${image.height})`);
      }

      results.push({ entry, frames, stripFile: writeStrip(entry, frames, options) });
    }
  } finally {
    await context.close();
  }
  return results;
}

/** Widest strip produced, and the smallest panel worth putting in one. */
const STRIP_MAX_WIDTH = 2400;
const STRIP_MIN_PANEL_PX = 600;
const STRIP_PADDING = 18;
const STRIP_GAP = 16;

/**
 * Choose how many frames sit side by side.
 *
 * A strip exists so frames can be compared against each other, so it has to
 * stay a row (or a few rows), not a tall column. Wide boards are downscaled
 * into the panel width rather than being allowed to force a single column.
 */
export function stripLayout(frameCount: number, nativeWidth: number): { columns: number; panelWidth: number } {
  const floor = Math.min(nativeWidth, STRIP_MIN_PANEL_PX);
  for (let columns = frameCount; columns > 1; columns--) {
    const panelWidth = Math.floor((STRIP_MAX_WIDTH - STRIP_PADDING * 2 - STRIP_GAP * (columns - 1)) / columns);
    if (panelWidth >= floor) return { columns, panelWidth };
  }
  return { columns: 1, panelWidth: STRIP_MAX_WIDTH - STRIP_PADDING * 2 };
}

function writeStrip(entry: ReviewCase, frames: readonly CapturedFrame[], options: CaptureRunOptions): string | null {
  const name = stripFileName(entry);
  if (!name || frames.length < 2) return null;
  const native = frames[0].width;
  const layout = stripLayout(frames.length, native);
  const cells: GridCell[] = frames.map((frame) => ({
    image: fitWithin(readPng(frame.file), layout.panelWidth, Number.MAX_SAFE_INTEGER),
    caption: `t = ${frame.timeMs} ms`,
  }));
  const scaled = layout.panelWidth < native;
  // The strip deliberately carries no "current"/"baseline" marker: the run
  // label would be the one pixel difference between two otherwise identical
  // strips, and every comparison of an animated scene would report a change.
  const strip = composeGrid(cells, {
    title: `${entry.sceneId} · ${entry.cell}px · ${entry.view}`,
    subtitle: `fixed-timestamp frames${scaled ? ` · panels scaled to ${layout.panelWidth}px, see the frames for native pixels` : ""} · ${entry.note}`,
    columns: layout.columns,
    maxWidth: STRIP_MAX_WIDTH,
    padding: STRIP_PADDING,
    gap: STRIP_GAP,
  });
  const file = resolveWithin(options.outDir, entry.dir, name);
  ensureFileDir(file);
  writePng(file, strip);
  options.onProgress?.(`${options.label}: ${path.posix.join(entry.dir, name)} (strip of ${cells.length})`);
  return file;
}
