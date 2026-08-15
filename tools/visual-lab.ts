import { draw, type RenderState } from "../src/render.ts";
import { generatedEncounterDiagnostics } from "../src/generation.ts";
import { isLevelThemeId } from "../src/themes.ts";
import { buildGeneratedThemeScene, buildVisualScenes, type VisualScene } from "./visual-scenes.ts";

type ViewMode = "normal" | "grayscale" | "contrast" | "squint" | "semantic";
type BackdropMode = "dark" | "light";

const scenes = buildVisualScenes();
const STATIC_RENDER_TIME_MS = 0;
const PRODUCTION_CANVAS_FILTER = "saturate(1.08) contrast(1.035)";
const canvases = new Map<string, HTMLCanvasElement>();
const sceneGrid = requiredElement<HTMLElement>("scene-grid");
const cellInput = requiredElement<HTMLInputElement>("cell-size");
const cellOutput = requiredElement<HTMLOutputElement>("cell-output");
const viewSelect = requiredElement<HTMLSelectElement>("view-mode");
const backdropSelect = requiredElement<HTMLSelectElement>("backdrop-mode");
const overlayInput = requiredElement<HTMLInputElement>("show-overlays");
const animateInput = requiredElement<HTMLInputElement>("animate");
const ambientInput = requiredElement<HTMLInputElement>("ambient");
const exportButton = requiredElement<HTMLButtonElement>("export-sheet");
const diagnosticsButton = requiredElement<HTMLButtonElement>("copy-diagnostics");
const inspectionTheme = requiredElement<HTMLSelectElement>("inspection-theme");
const inspectionSeed = requiredElement<HTMLInputElement>("inspection-seed");
const inspectionProfile = requiredElement<HTMLSelectElement>("inspection-profile");
const inspectionButton = requiredElement<HTMLButtonElement>("inspect-seed");
const status = requiredElement<HTMLElement>("status");

let animationFrame = 0;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Visual lab element '#${id}' is missing`);
  return element as T;
}

function clampCellSize(value: number): number {
  if (!Number.isFinite(value)) return 40;
  return Math.max(24, Math.min(64, Math.round(value / 2) * 2));
}

function isViewMode(value: string | null): value is ViewMode {
  return value === "normal" || value === "grayscale" || value === "contrast" || value === "squint" || value === "semantic";
}

function isBackdropMode(value: string | null): value is BackdropMode {
  return value === "dark" || value === "light";
}

function initializeFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const requestedCell = params.get("cell");
  const cell = requestedCell === null ? 40 : clampCellSize(Number(requestedCell));
  const requestedView = params.get("view");
  const requestedBackdrop = params.get("backdrop");
  const view = isViewMode(requestedView) ? requestedView : "normal";
  const backdrop = isBackdropMode(requestedBackdrop) ? requestedBackdrop : "dark";
  cellInput.value = String(cell);
  viewSelect.value = view;
  backdropSelect.value = backdrop;
  overlayInput.checked = params.get("overlays") !== "0";
  animateInput.checked = params.get("animate") === "1";
  ambientInput.checked = params.get("ambient") !== "0";
  const profile = params.get("inspectionProfile");
  inspectionProfile.value = profile === "quiet" ? "quiet" : "landmark";
  const theme = params.get("inspectionTheme");
  if (isLevelThemeId(theme)) inspectionTheme.value = theme;
  inspectionSeed.value = params.get("inspectionSeed")?.slice(0, 80) || "REVIEW-SEED-1";
}

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set("cell", cellInput.value);
  params.set("view", viewSelect.value);
  params.set("backdrop", backdropSelect.value);
  params.set("overlays", overlayInput.checked ? "1" : "0");
  params.set("animate", animateInput.checked ? "1" : "0");
  params.set("ambient", ambientInput.checked ? "1" : "0");
  params.set("inspectionProfile", inspectionProfile.value);
  params.set("inspectionTheme", inspectionTheme.value);
  params.set("inspectionSeed", inspectionSeed.value.trim() || "REVIEW-SEED-1");
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function sceneState(scene: VisualScene): RenderState {
  const diagnostic = viewSelect.value === "semantic";
  const ambientAnimation = ambientInput.checked;
  if (overlayInput.checked) return { ...scene.state, terrainDiagnostic: diagnostic, ambientAnimation };
  return {
    ...scene.state,
    terrainDiagnostic: diagnostic,
    ambientAnimation,
    selected: null,
    showUnitUi: false,
    highlights: [],
    enemyPreviews: [],
    floatingTexts: [],
    coverIndicators: [],
    threatMarkers: [],
    sightLines: [],
    shotEffects: [],
    movementEffects: [],
  };
}

function sizeCanvas(canvas: HTMLCanvasElement, state: RenderState, cell: number): void {
  const cssWidth = state.map.width * cell;
  const cssHeight = state.map.height * cell;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.dataset.cssWidth = String(cssWidth);
  canvas.dataset.cssHeight = String(cssHeight);
  canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawScene(scene: VisualScene, resize: boolean, nowMs = motionEnabled() ? performance.now() : STATIC_RENDER_TIME_MS): void {
  const canvas = canvases.get(scene.id);
  if (!canvas) return;
  if (resize) sizeCanvas(canvas, scene.state, Number(cellInput.value));
  draw(canvas, sceneState(scene), nowMs);
}

function renderAll(resize = true): void {
  const cell = clampCellSize(Number(cellInput.value));
  cellInput.value = String(cell);
  cellOutput.value = `${cell} px`;
  document.body.dataset.view = viewSelect.value;
  document.body.dataset.backdrop = backdropSelect.value;
  for (const scene of scenes) drawScene(scene, resize);
  syncUrl();
  updateAnimation();
}

function motionEnabled(): boolean {
  return (animateInput.checked || ambientInput.checked) && viewSelect.value !== "semantic";
}

function animationLoop(): void {
  if (!motionEnabled() || document.hidden) {
    animationFrame = 0;
    return;
  }
  const nowMs = performance.now();
  for (const scene of scenes) drawScene(scene, false, nowMs);
  animationFrame = requestAnimationFrame(animationLoop);
}

function updateAnimation(): void {
  if (motionEnabled() && !document.hidden && animationFrame === 0) {
    animationFrame = requestAnimationFrame(animationLoop);
  } else if ((!motionEnabled() || document.hidden) && animationFrame !== 0) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
}

function filterForView(): string {
  if (viewSelect.value === "grayscale") return `${PRODUCTION_CANVAS_FILTER} grayscale(1)`;
  if (viewSelect.value === "contrast") return `${PRODUCTION_CANVAS_FILTER} grayscale(1) contrast(1.85)`;
  if (viewSelect.value === "squint") return `${PRODUCTION_CANVAS_FILTER} grayscale(1) contrast(1.3) blur(3px)`;
  if (viewSelect.value === "semantic") return "none";
  return PRODUCTION_CANVAS_FILTER;
}

function processedCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const width = Number(source.dataset.cssWidth);
  const height = Number(source.dataset.cssHeight);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("Canvas export context is unavailable");
  ctx.fillStyle = backdropSelect.value === "light" ? "#dbe5e8" : "#071018";
  ctx.fillRect(0, 0, width, height);
  ctx.filter = filterForView();
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
  ctx.filter = "none";
  return output;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) {
      setStatus("PNG export failed.", true);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${filename}`);
  }, "image/png");
}

function exportContactSheet(): void {
  const rendered = scenes.map((scene) => ({ scene, canvas: processedCanvas(canvases.get(scene.id)!) }));
  const padding = 24;
  const labelHeight = 42;
  const width = Math.max(...rendered.map(({ canvas }) => canvas.width)) + padding * 2;
  const height = padding + rendered.reduce((sum, { canvas }) => sum + labelHeight + canvas.height + padding, 0);
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("Contact-sheet context is unavailable");
  ctx.fillStyle = backdropSelect.value === "light" ? "#dbe5e8" : "#071018";
  ctx.fillRect(0, 0, width, height);
  let y = padding;
  for (const { scene, canvas } of rendered) {
    ctx.fillStyle = backdropSelect.value === "light" ? "#10202a" : "#dcebf0";
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.textBaseline = "top";
    ctx.fillText(scene.title, padding, y + 6);
    y += labelHeight;
    ctx.drawImage(canvas, padding, y);
    y += canvas.height + padding;
  }
  downloadCanvas(sheet, `circuit-bored-visual-${cellInput.value}px-${viewSelect.value}.png`);
}

async function copyDiagnostics(): Promise<void> {
  const payload = {
    page: location.href,
    cellSize: Number(cellInput.value),
    view: viewSelect.value,
    backdrop: backdropSelect.value,
    overlays: overlayInput.checked,
    animation: animateInput.checked,
    ambientAnimation: ambientInput.checked,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scenes: scenes.map(({ id, state }) => ({
      id,
      width: state.map.width,
      height: state.map.height,
      generation: generatedEncounterDiagnostics(state.map),
    })),
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setStatus("Copied visual-lab diagnostics.");
  } catch {
    setStatus("Clipboard access was unavailable.", true);
  }
}

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.style.color = error ? "var(--red)" : "var(--cyan)";
}

/**
 * Design-review facts for a generated board: which noun anchors it, what
 * supports it, how the composition was budgeted, and what roles the space has.
 */
function sceneFacts(scene: VisualScene): [string, string][] {
  const diagnostics = generatedEncounterDiagnostics(scene.state.map);
  const environment = scene.state.map.environment;
  if (!diagnostics) {
    if (!environment) return [];
    return [["Landmarks", environment.landmarks.map(({ name }) => name).join(", ")]];
  }
  const supporting = diagnostics.landmarks.filter((landmark) => landmark.importance !== "dominant");
  const metrics = diagnostics.metrics;
  return [
    ["Dominant feature", diagnostics.dominantLandmark
      ? `${diagnostics.dominantLandmark.name} (${diagnostics.dominantLandmark.footprint} tiles, facing ${diagnostics.dominantLandmark.orientation}, ${diagnostics.dominantLandmark.ambient})`
      : "none"],
    ["Supporting features", supporting.length > 0
      ? supporting.map((landmark) => `${landmark.name} [${landmark.importance}]`).join(", ")
      : "none"],
    ["Composition", `${diagnostics.profile} · budget ${diagnostics.featureBudget.major}/${diagnostics.featureBudget.secondary}/${diagnostics.featureBudget.minor} · dominance ×${metrics.dominantFootprintRatio.toFixed(2)}`],
    ["Zone roles", diagnostics.zoneRoles.length > 0 ? diagnostics.zoneRoles.join(", ") : "none"],
    ["Shape language", `aligned ${(metrics.alignedWallRatio * 100).toFixed(0)}% · symmetry ${(metrics.mirrorSymmetryRatio * 100).toFixed(0)}% · broken ends ${(metrics.wallEndpointRatio * 100).toFixed(0)}%`],
    ["Restraint", `quiet floor ${(metrics.floorQuietnessRatio * 100).toFixed(0)}% · calm region ${metrics.largestCalmRegion} · cover owned ${(metrics.landmarkAdjacentCoverRatio * 100).toFixed(0)}%`],
  ];
}

function buildSceneCard(scene: VisualScene, index: number): void {
    const article = document.createElement("article");
    article.className = "scene";
    article.id = `scene-${scene.id}`;

    const head = document.createElement("div");
    head.className = "scene-head";
    const copy = document.createElement("div");
    const kicker = document.createElement("div");
    kicker.className = "scene-kicker";
    const diagnostics = generatedEncounterDiagnostics(scene.state.map);
    const budget = diagnostics?.featureBudget;
    kicker.textContent = `Scene ${index + 1} · ${scene.state.map.width}×${scene.state.map.height}` +
      (diagnostics ? ` · ${diagnostics.profile}` : "") +
      (budget ? ` · budget ${budget.major}/${budget.secondary}/${budget.minor}` : "");
    const title = document.createElement("h2");
    title.textContent = scene.title;
    const description = document.createElement("p");
    description.textContent = scene.description;
    const review = document.createElement("p");
    review.className = "review";
    review.textContent = `Review: ${scene.review}`;
    copy.append(kicker, title, description, review);
    const facts = sceneFacts(scene);
    if (facts.length > 0) {
      const list = document.createElement("dl");
      list.className = "scene-facts";
      for (const [label, value] of facts) {
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        list.append(term, detail);
      }
      copy.append(list);
    }

    const exportScene = document.createElement("button");
    exportScene.textContent = "Export PNG";
    exportScene.addEventListener("click", () => {
      const source = canvases.get(scene.id);
      if (source) downloadCanvas(processedCanvas(source), `circuit-bored-${scene.id}-${cellInput.value}px-${viewSelect.value}.png`);
    });
    head.append(copy, exportScene);

    const stage = document.createElement("div");
    stage.className = "canvas-stage";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", scene.title);
    stage.appendChild(canvas);
    article.append(head, stage);
    sceneGrid.appendChild(article);
    canvases.set(scene.id, canvas);
}

function buildSceneCards(): void {
  for (const [index, scene] of scenes.entries()) buildSceneCard(scene, index);
}

function inspectSeed(): void {
  const themeId = isLevelThemeId(inspectionTheme.value) ? inspectionTheme.value : "industrial";
  const seed = inspectionSeed.value.trim() || "REVIEW-SEED-1";
  const profile = inspectionProfile.value === "quiet" ? "quiet" : "landmark";
  const generated = buildGeneratedThemeScene(themeId, seed, profile);
  const scene: VisualScene = {
    ...generated,
    id: "seed-inspection",
    title: `Seed inspection · ${generated.title}`,
  };
  const existing = scenes.findIndex((candidate) => candidate.id === scene.id);
  if (existing >= 0) {
    scenes[existing] = scene;
    document.getElementById(`scene-${scene.id}`)?.remove();
    canvases.delete(scene.id);
  } else {
    scenes.push(scene);
  }
  buildSceneCard(scene, existing >= 0 ? existing : scenes.length - 1);
  drawScene(scene, true);
  syncUrl();
  document.getElementById(`scene-${scene.id}`)?.scrollIntoView({ behavior: "smooth" });
  setStatus(`Generated ${themeId} ${profile} seed ${seed}.`);
}

function handleShortcut(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (/^[1-9]$/.test(event.key)) {
    scenes[Number(event.key) - 1]?.id && document.getElementById(`scene-${scenes[Number(event.key) - 1].id}`)?.scrollIntoView({ behavior: "smooth" });
  } else if (event.key.toLowerCase() === "g") {
    viewSelect.value = viewSelect.value === "grayscale" ? "normal" : "grayscale";
    renderAll(false);
  } else if (event.key.toLowerCase() === "s") {
    viewSelect.value = viewSelect.value === "squint" ? "normal" : "squint";
    renderAll(false);
  } else if (event.key.toLowerCase() === "e") {
    exportContactSheet();
  }
}

initializeFromUrl();
buildSceneCards();
renderAll();

cellInput.addEventListener("input", () => renderAll(true));
viewSelect.addEventListener("change", () => renderAll(false));
backdropSelect.addEventListener("change", () => renderAll(false));
overlayInput.addEventListener("change", () => renderAll(false));
animateInput.addEventListener("change", () => renderAll(false));
ambientInput.addEventListener("change", () => renderAll(false));
inspectionProfile.addEventListener("change", syncUrl);
exportButton.addEventListener("click", exportContactSheet);
diagnosticsButton.addEventListener("click", () => void copyDiagnostics());
inspectionButton.addEventListener("click", inspectSeed);
document.addEventListener("visibilitychange", updateAnimation);
window.addEventListener("keydown", handleShortcut);
