import {
  createEmptyMap,
  loadMap,
  makeUnit,
  saveMap,
  setTile,
  unitAt,
  validatePlayable,
  type GameMap,
} from "./map.ts";
import { attachTapHandler } from "./input.ts";
import { draw, resizeCanvasForMap, type RenderState } from "./render.ts";

type Tool = "floor" | "wall" | "half_cover" | "player" | "enemy";

export type EditorHandle = {
  getMap: () => GameMap;
  destroy: () => void;
  redraw: () => void;
};

export function startEditor(
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
  initialMap: GameMap | null,
  onPlay: (map: GameMap) => void,
): EditorHandle {
  let map = initialMap ?? createEmptyMap();
  let tool: Tool = "wall";

  const state: RenderState = {
    map,
    selected: null,
    highlights: [],
    enemyPreviews: [],
    floatingTexts: [],
  };

  const redraw = () => {
    state.map = map;
    draw(canvas, state);
  };

  resizeCanvasForMap(canvas, map);

  const detachTap = attachTapHandler(canvas, () => map, ({ x, y }) => {
    if (tool === "floor") {
      setTile(map, x, y, "floor");
    } else if (tool === "wall") {
      const u = unitAt(map, x, y);
      if (u) return;
      setTile(map, x, y, "wall");
    } else if (tool === "half_cover") {
      const u = unitAt(map, x, y);
      if (u) return;
      setTile(map, x, y, "half_cover");
    } else if (tool === "player") {
      const t = map.tiles[y * map.width + x];
      if (t === "wall" || t === "half_cover") return;
      const existing = unitAt(map, x, y);
      if (existing && existing.team === "player") {
        map.units = map.units.filter((u) => u !== existing);
      } else if (!existing) {
        map.units.push(makeUnit("player", x, y));
      }
    } else if (tool === "enemy") {
      const t = map.tiles[y * map.width + x];
      if (t === "wall" || t === "half_cover") return;
      const existing = unitAt(map, x, y);
      if (existing && existing.team === "enemy") {
        map.units = map.units.filter((u) => u !== existing);
      } else if (!existing) {
        map.units.push(makeUnit("enemy", x, y));
      }
    }
    redraw();
  });

  hud.innerHTML = "";
  const toolRow = document.createElement("div");
  toolRow.className = "row";
  const tools: { key: Tool; label: string }[] = [
    { key: "floor", label: "Floor" },
    { key: "wall", label: "Wall" },
    { key: "half_cover", label: "Half" },
    { key: "player", label: "Player" },
    { key: "enemy", label: "Enemy" },
  ];
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const t of tools) {
    const btn = document.createElement("button");
    btn.textContent = t.label;
    btn.addEventListener("click", () => {
      tool = t.key;
      for (const [k, b] of toolButtons) {
        b.classList.toggle("active", k === tool);
      }
    });
    toolButtons.set(t.key, btn);
    toolRow.appendChild(btn);
  }
  toolButtons.get(tool)!.classList.add("active");
  hud.appendChild(toolRow);

  const buttonRow = document.createElement("div");
  buttonRow.className = "row";

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  clearBtn.className = "danger";
  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear the map?")) return;
    map = createEmptyMap();
    resizeCanvasForMap(canvas, map);
    redraw();
  });

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    saveMap(map);
    status.textContent = "Saved.";
  });

  const loadBtn = document.createElement("button");
  loadBtn.textContent = "Load";
  loadBtn.addEventListener("click", () => {
    const loaded = loadMap();
    if (!loaded) {
      status.textContent = "No saved map.";
      return;
    }
    map = loaded;
    resizeCanvasForMap(canvas, map);
    redraw();
    status.textContent = "Loaded.";
  });

  const playBtn = document.createElement("button");
  playBtn.textContent = "Play";
  playBtn.className = "primary";
  playBtn.addEventListener("click", () => {
    const err = validatePlayable(map);
    if (err) {
      status.textContent = err;
      return;
    }
    onPlay(map);
  });

  buttonRow.appendChild(clearBtn);
  buttonRow.appendChild(saveBtn);
  buttonRow.appendChild(loadBtn);
  buttonRow.appendChild(playBtn);
  hud.appendChild(buttonRow);

  const status = document.createElement("div");
  status.className = "status";
  status.textContent = "Tap to paint. Tap a unit with its tool to remove it.";
  hud.appendChild(status);

  redraw();

  return {
    getMap: () => map,
    destroy: () => {
      detachTap();
      hud.innerHTML = "";
    },
    redraw,
  };
}
