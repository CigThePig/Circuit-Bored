import { startEditor, type EditorHandle } from "./editor.ts";
import { startRuntime, type RuntimeHandle } from "./runtime.ts";
import { createTestMap, loadMap, validatePlayable, type GameMap } from "./map.ts";

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Required element #${id} not found`);
  return el as T;
}

const canvas = requireElement<HTMLCanvasElement>("canvas");
const hud = requireElement<HTMLElement>("hud");
const overlay = requireElement<HTMLElement>("overlay");
const overlayText = requireElement<HTMLElement>("overlay-text");
const overlayButton = requireElement<HTMLButtonElement>("overlay-button");
const turnBanner = requireElement<HTMLElement>("turn-banner");
const modeLabel = requireElement<HTMLElement>("mode-label");
const modeToggle = requireElement<HTMLButtonElement>("mode-toggle");
const screenshotButton = requireElement<HTMLButtonElement>("screenshot");

type Mode = "editor" | "runtime";
let mode: Mode = "editor";
let editor: EditorHandle | null = null;
let runtime: RuntimeHandle | null = null;
let lastEditorMap: GameMap | null = loadMap() ?? createTestMap();

const enterEditor = (map: GameMap | null) => {
  runtime?.destroy();
  runtime = null;
  mode = "editor";
  modeLabel.textContent = "Editor";
  modeToggle.textContent = "Play";
  modeToggle.disabled = false;
  editor = startEditor(canvas, hud, map ?? lastEditorMap, (m) => {
    lastEditorMap = m;
    enterRuntime(m);
  });
};

const enterRuntime = (map: GameMap) => {
  editor?.destroy();
  editor = null;
  mode = "runtime";
  modeLabel.textContent = "Runtime";
  modeToggle.textContent = "Editor";
  runtime = startRuntime(canvas, hud, overlay, overlayText, overlayButton, turnBanner, map, () => {
    enterEditor(lastEditorMap);
  });
};

screenshotButton.addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `circuit-bored-${mode}-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
});

modeToggle.addEventListener("click", () => {
  if (mode === "editor") {
    if (!editor) return;
    const m = editor.getMap();
    const err = validatePlayable(m);
    if (err) {
      alert(err);
      return;
    }
    lastEditorMap = m;
    enterRuntime(m);
  } else {
    enterEditor(lastEditorMap);
  }
});

window.addEventListener("resize", () => {
  if (mode === "editor") {
    editor?.resize();
  } else {
    runtime?.resize();
  }
});

enterEditor(lastEditorMap);
