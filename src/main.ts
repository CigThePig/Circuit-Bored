import { getUpgrade } from "./content.ts";
import { startEditor, type EditorHandle } from "./editor.ts";
import { createTestMap, loadMap, type GameMap } from "./map.ts";
import { randomSeed } from "./rng.ts";
import {
  chooseRecovery,
  chooseUpgrade,
  completeEncounter,
  createRun,
  currentNode,
  deleteRun,
  enterNode,
  loadRunWithReport,
  nextRandom,
  saveRun,
  updateActiveEncounter,
  type RouteNode,
  type RunState,
} from "./run.ts";
import { startRuntime, type RuntimeHandle } from "./runtime.ts";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required element #${id} not found`);
  return element as T;
}

const canvas = requireElement<HTMLCanvasElement>("canvas");
const hud = requireElement<HTMLElement>("hud");
const boardShell = requireElement<HTMLElement>("board-shell");
const screen = requireElement<HTMLElement>("screen");
const overlay = requireElement<HTMLElement>("overlay");
const overlayText = requireElement<HTMLElement>("overlay-text");
const overlayButton = requireElement<HTMLButtonElement>("overlay-button");
const turnBanner = requireElement<HTMLElement>("turn-banner");
const modeLabel = requireElement<HTMLElement>("mode-label");
const seedLabel = requireElement<HTMLElement>("seed-label");
const modeToggle = requireElement<HTMLButtonElement>("mode-toggle");
const screenshotButton = requireElement<HTMLButtonElement>("screenshot");

type AppMode = "screen" | "editor" | "sandbox" | "encounter";
let mode: AppMode = "screen";
let editor: EditorHandle | null = null;
let runtime: RuntimeHandle | null = null;
let editorMap: GameMap = loadMap() ?? createTestMap();
const loaded = loadRunWithReport();
let run: RunState | null = loaded.run;
let loadError = loaded.error;

function stopControllers(): void {
  editor?.destroy();
  runtime?.destroy();
  editor = null;
  runtime = null;
}

function setTopbar(label: string, toggle: string, seed = ""): void {
  modeLabel.textContent = label;
  modeToggle.textContent = toggle;
  seedLabel.textContent = seed ? `SEED ${seed}` : "";
}

function showScreen(): void {
  stopControllers();
  mode = "screen";
  boardShell.classList.add("hidden");
  screen.classList.remove("hidden");
  screenshotButton.classList.add("hidden");
  modeToggle.classList.remove("hidden");
}

function showBoard(nextMode: Exclude<AppMode, "screen">): void {
  stopControllers();
  mode = nextMode;
  screen.classList.add("hidden");
  boardShell.classList.remove("hidden");
  screenshotButton.classList.remove("hidden");
}

function button(label: string, className = "", onClick?: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = label;
  element.className = className;
  if (onClick) element.addEventListener("click", onClick);
  return element;
}

function panel(): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "panel";
  return element;
}

function copy(text: string, className = "screen-copy"): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

function renderSquad(target: HTMLElement, state: RunState): void {
  const grid = document.createElement("div");
  grid.className = "squad-grid";
  for (const member of state.squad) {
    const card = document.createElement("div");
    card.className = `squad-card${member.hp <= 0 ? " dead" : ""}`;
    const name = document.createElement("div");
    name.className = "squad-name";
    name.textContent = member.name;
    const track = document.createElement("div");
    track.className = "health-track";
    const fill = document.createElement("div");
    fill.className = "health-fill";
    fill.style.width = `${Math.round((member.hp / member.maxHp) * 100)}%`;
    track.appendChild(fill);
    card.append(name, track, copy(member.hp > 0 ? `${member.hp}/${member.maxHp} HP` : "OFFLINE", "micro"));
    grid.appendChild(card);
  }
  target.appendChild(grid);
}

function renderUpgrades(target: HTMLElement, state: RunState): void {
  const list = document.createElement("div");
  list.className = "upgrade-list";
  if (state.upgrades.length === 0) {
    list.appendChild(copy("No upgrades installed.", "micro"));
  } else {
    for (const id of state.upgrades) {
      const chip = document.createElement("span");
      chip.className = "upgrade-chip";
      chip.textContent = getUpgrade(id).name;
      list.appendChild(chip);
    }
  }
  target.appendChild(list);
}

function persist(): void {
  if (run && !saveRun(run)) loadError = "This browser could not save the run.";
}

function renderTitle(): void {
  showScreen();
  setTopbar("Circuit Bored", "Editor");
  screen.innerHTML = "";
  const kicker = document.createElement("div");
  kicker.className = "screen-kicker";
  kicker.textContent = "Run-based tactical roguelike";
  const title = document.createElement("h1");
  title.className = "screen-title";
  title.textContent = "Circuit Bored";
  screen.append(kicker, title, copy("Build a squad circuit across a short, lethal route. Damage persists. Positioning matters. Failure is a reason to reroute."));
  if (loadError) {
    screen.appendChild(copy(loadError, "warning"));
    loadError = null;
  }

  const actions = panel();
  actions.classList.add("action-stack");
  if (run && run.status !== "victory" && run.status !== "defeat") {
    actions.appendChild(button(`Continue · ${run.seed}`, "primary", dispatchRun));
  } else if (run) {
    actions.appendChild(button(
      run.status === "victory" ? "View Completed Run" : "View Failed Run",
      "primary",
      dispatchRun,
    ));
  }
  const seedRow = document.createElement("div");
  seedRow.className = "seed-row";
  const seedInput = document.createElement("input");
  seedInput.placeholder = "OPTIONAL SEED";
  seedInput.maxLength = 80;
  const newRunButton = button(run ? "New Run · Replace Save" : "New Run", "primary", () => {
    run = createRun(seedInput.value.trim() || randomSeed());
    persist();
    renderRoute();
  });
  seedRow.append(seedInput, newRunButton);
  actions.appendChild(seedRow);
  actions.appendChild(button("Map Editor · Dev Tool", "", enterEditor));
  screen.appendChild(actions);

  const explainer = panel();
  explainer.innerHTML = "<h3>FAST. TACTICAL. PERSISTENT.</h3>";
  explainer.appendChild(copy("Choose a signal, clear the board, install one upgrade, and keep your surviving operators alive until the Core Breach."));
  screen.appendChild(explainer);
}

function nodeClass(node: RouteNode, state: RunState): string {
  if (state.chosenNodeIds.includes(node.id)) return `route-node ${node.kind} chosen`;
  if (node.depth < state.depth) return `route-node ${node.kind} skipped`;
  if (node.depth === state.depth) return `route-node ${node.kind} current`;
  return `route-node ${node.kind}`;
}

function renderRoute(): void {
  if (!run) return renderTitle();
  showScreen();
  setTopbar(`Route ${Math.min(run.depth + 1, run.route.length)}/${run.route.length}`, "Title", run.seed);
  screen.innerHTML = "";
  const kicker = document.createElement("div");
  kicker.className = "screen-kicker";
  kicker.textContent = "Choose the next signal";
  const title = document.createElement("h1");
  title.className = "screen-title";
  title.textContent = "Run Route";
  screen.append(kicker, title);

  const squadPanel = panel();
  squadPanel.innerHTML = "<h3>SQUAD CONDITION</h3>";
  renderSquad(squadPanel, run);
  screen.appendChild(squadPanel);

  const routeElement = document.createElement("div");
  routeElement.className = "route";
  for (let depth = 0; depth < run.route.length; depth++) {
    const column = document.createElement("div");
    column.className = "route-column";
    const label = document.createElement("div");
    label.className = "route-depth";
    label.textContent = depth === run.route.length - 1 ? "FINAL" : `0${depth + 1}`;
    column.appendChild(label);
    for (const node of run.route[depth]) {
      const nodeButton = button(node.title, nodeClass(node, run));
      const detail = document.createElement("small");
      detail.textContent = node.description;
      nodeButton.appendChild(detail);
      nodeButton.disabled = depth !== run.depth;
      if (depth === run.depth) {
        nodeButton.addEventListener("click", () => {
          enterNode(run!, node.id);
          persist();
          dispatchRun();
        });
      }
      column.appendChild(nodeButton);
    }
    routeElement.appendChild(column);
  }
  screen.appendChild(routeElement);

  const upgrades = panel();
  upgrades.innerHTML = "<h3>INSTALLED CIRCUITS</h3>";
  renderUpgrades(upgrades, run);
  screen.append(upgrades, abandonButton());
}

function renderReward(): void {
  if (!run) return renderTitle();
  showScreen();
  const node = currentNode(run);
  setTopbar(node?.kind === "cache" ? "Cache" : "Reward", "Title", run.seed);
  screen.innerHTML = "";
  const title = document.createElement("h1");
  title.className = "screen-title";
  title.textContent = node?.kind === "cache" ? "Crack The Cache" : "Install One";
  screen.append(title, copy(node?.kind === "elite" ? "Elite signal cleared. Four circuits surfaced; install one." : "Choose one circuit. The others are lost when you move on."));
  const choices = document.createElement("div");
  choices.className = "choice-grid";
  for (const id of run.pendingRewards) {
    const upgrade = getUpgrade(id);
    const choice = button("", "choice-card");
    const name = document.createElement("strong");
    name.textContent = upgrade.name;
    const description = document.createElement("span");
    description.textContent = upgrade.description;
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = upgrade.tag;
    choice.append(name, description, tag);
    choice.addEventListener("click", () => {
      chooseUpgrade(run!, id);
      persist();
      dispatchRun();
    });
    choices.appendChild(choice);
  }
  screen.appendChild(choices);
  const squadPanel = panel();
  squadPanel.innerHTML = "<h3>CURRENT BUILD</h3>";
  renderSquad(squadPanel, run);
  renderUpgrades(squadPanel, run);
  screen.append(squadPanel, abandonButton());
}

function renderRecovery(): void {
  if (!run) return renderTitle();
  showScreen();
  setTopbar("Repair Bay", "Title", run.seed);
  screen.innerHTML = "";
  const title = document.createElement("h1");
  title.className = "screen-title";
  title.textContent = "Choose Repair";
  screen.append(title, copy("Restore one surviving operator. Offline squad members cannot be recovered during this run."));
  const choices = document.createElement("div");
  choices.className = "choice-grid";
  for (const member of run.squad.filter((candidate) => candidate.hp > 0)) {
    const bonus = run.upgrades.filter((id) => id === "triage_protocol").length * 3;
    const amount = Math.min(member.maxHp - member.hp, 4 + bonus);
    choices.appendChild(button(`${member.name} · ${member.hp}/${member.maxHp} HP · Repair ${amount}`, "choice-card", () => {
      chooseRecovery(run!, member.id);
      persist();
      dispatchRun();
    }));
  }
  screen.append(choices, abandonButton());
}

function renderOutcome(victory: boolean): void {
  if (!run) return renderTitle();
  showScreen();
  setTopbar(victory ? "Run Complete" : "Signal Lost", "Title", run.seed);
  screen.innerHTML = "";
  const kicker = document.createElement("div");
  kicker.className = "screen-kicker";
  kicker.textContent = victory ? "Core breached" : "Squad destroyed";
  const title = document.createElement("h1");
  title.className = "screen-title";
  title.textContent = victory ? "Circuit Closed" : "Run Failed";
  screen.append(kicker, title, copy(victory ? "The route is secure. Bank the seed or cut a completely new circuit." : "The route ends here. Its seed remains visible if you want another answer to the same problem."));
  const stats = document.createElement("div");
  stats.className = "stat-grid";
  const values: Array<[string, number]> = [
    ["Combats", run.stats.combatsWon], ["Elites", run.stats.elitesWon],
    ["Upgrades", run.stats.upgradesTaken], ["Lost", run.stats.unitsLost],
  ];
  for (const [label, value] of values) {
    const stat = document.createElement("div");
    stat.className = "stat";
    stat.innerHTML = `<strong>${value}</strong><span class="micro">${label}</span>`;
    stats.appendChild(stat);
  }
  screen.appendChild(stats);
  const actions = panel();
  actions.classList.add("action-stack");
  actions.appendChild(button("Start Different Run", "primary", () => {
    run = createRun(randomSeed());
    persist();
    renderRoute();
  }));
  actions.appendChild(button(`Retry Seed ${run.seed}`, "", () => {
    run = createRun(run!.seed);
    persist();
    renderRoute();
  }));
  actions.appendChild(button("Return to Title", "", renderTitle));
  screen.appendChild(actions);
}

function abandonButton(): HTMLButtonElement {
  const abandon = button("Abandon Run", "danger");
  let armed = false;
  abandon.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      abandon.textContent = "Confirm Abandon · Cannot Undo";
      return;
    }
    deleteRun();
    run = null;
    renderTitle();
  });
  return abandon;
}

function enterEncounter(): void {
  if (!run?.activeEncounter) return renderRoute();
  showBoard("encounter");
  const node = currentNode(run);
  setTopbar(node?.title ?? "Encounter", "Exit", run.seed);
  const active = run.activeEncounter;
  runtime = startRuntime(canvas, hud, overlay, overlayText, overlayButton, turnBanner, active.map, renderTitle, {
    preserveUnitState: true,
    initialTurn: active.turn,
    exitLabel: "Exit",
    completionLabel: active.kind === "final" ? "Finish Run" : "Claim Reward",
    random: () => {
      return nextRandom(run!);
    },
    onStateChange: (map, turn) => {
      updateActiveEncounter(run!, map, turn);
      persist();
    },
    onComplete: (outcome, map) => {
      stopControllers();
      completeEncounter(run!, outcome, map);
      persist();
      dispatchRun();
    },
  });
}

function dispatchRun(): void {
  if (!run) return renderTitle();
  if (run.status === "route") return renderRoute();
  if (run.status === "reward") return renderReward();
  if (run.status === "recovery") return renderRecovery();
  if (run.status === "encounter") return enterEncounter();
  return renderOutcome(run.status === "victory");
}

function enterEditor(map: GameMap = editorMap): void {
  showBoard("editor");
  setTopbar("Map Editor · Dev", "Title");
  editor = startEditor(canvas, hud, map, (nextMap) => {
    editorMap = nextMap;
    enterSandbox(nextMap);
  });
}

function enterSandbox(map: GameMap): void {
  showBoard("sandbox");
  setTopbar("Sandbox", "Editor");
  runtime = startRuntime(canvas, hud, overlay, overlayText, overlayButton, turnBanner, map, () => enterEditor(editorMap), {
    exitLabel: "Editor",
    completionLabel: "Back to Editor",
  });
}

screenshotButton.addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `circuit-bored-${mode}-${timestamp}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
});

modeToggle.addEventListener("click", () => {
  if (mode === "screen" && modeToggle.textContent === "Editor") return enterEditor();
  if (mode === "sandbox") return enterEditor(editorMap);
  renderTitle();
});

window.addEventListener("resize", () => {
  editor?.resize();
  runtime?.resize();
});

renderTitle();
