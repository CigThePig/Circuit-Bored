import { startEditor, type EditorHandle } from "./editor.ts";
import { startRuntime, type RuntimeHandle } from "./runtime.ts";
import { createTestMap, loadMap, validatePlayable, type GameMap } from "./map.ts";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;
const overlayText = document.getElementById("overlay-text") as HTMLElement;
const overlayButton = document.getElementById("overlay-button") as HTMLButtonElement;
const turnBanner = document.getElementById("turn-banner") as HTMLElement;
const modeLabel = document.getElementById("mode-label") as HTMLElement;
const modeToggle = document.getElementById("mode-toggle") as HTMLButtonElement;

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
    editor?.redraw();
  }
});

enterEditor(lastEditorMap);
