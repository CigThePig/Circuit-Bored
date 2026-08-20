/**
 * The field manual.
 *
 * A player who taps the question mark wants to know how the game works, and
 * the fastest way for that answer to become a lie is to hand-write it. Every
 * number and nearly every name below is therefore read out of the module that
 * owns the rule: action costs come from the action registry, unit statistics
 * and counters from the archetype table, band edges from `range.ts`, the
 * movement rate from `rules.ts`, and the accuracy swings from `combat.ts`.
 * Retuning a constant retunes the manual in the same commit.
 *
 * The section data is a plain array so it can be tested without a DOM;
 * `mountHelp` is the only part that touches the document.
 */

import {
  ACTION_TRAY_ORDER,
  COMBAT_ACTIONS,
  RELAY_AP_GRANTED,
  RELAY_LIMIT_PER_TURN,
  getAction,
  type ActionId,
  type CombatActionDefinition,
} from "./actions.ts";
import {
  AIM_ACCURACY_BONUS,
  BASE_HIT,
  BRACE_DAMAGE_REDUCTION,
  COVER_PENALTY,
  EXPOSED_ACCURACY_BONUS,
  EXPOSED_DAMAGE_BONUS,
  GUARD_DAMAGE_REDUCTION,
  GUARD_RANGE,
  HALF_COVER_PENALTY,
  HUNKER_COVER_BONUS,
  MARK_ACCURACY_BONUS,
  PEEK_PENALTY,
  SHOT_DAMAGE,
  SUPPRESSED_ACCURACY_PENALTY,
} from "./combat.ts";
import { UNIT_ARCHETYPES, type UnitArchetype, type UnitArchetypeId } from "./content.ts";
import { CLOSE_MAX, MEDIUM_MAX, preferredBand, rangeBandLabel } from "./range.ts";
import { SeededRng } from "./rng.ts";
import { TILES_PER_MOVE_AP } from "./rules.ts";
import { generateRoute } from "./run.ts";
import { MARK_TURNS, SUPPRESSED_AP_PENALTY } from "./status.ts";

/** One explained thing: a name, an optional cost or stat line, a sentence. */
export type HelpEntry = {
  term: string;
  /** Cost, targeting, or statistics. Shown beside the term, never instead of it. */
  meta?: string;
  detail: string;
};

/** One tab of the manual. */
export type HelpSection = {
  id: string;
  /** Tab label. Short: the tab strip has to wrap onto a phone. */
  title: string;
  /** One sentence answering "why would I read this tab". */
  summary: string;
  entries: HelpEntry[];
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : "−"}${pct(Math.abs(value))}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function archetypesOfTeam(team: UnitArchetype["team"]): UnitArchetype[] {
  return Object.values(UNIT_ARCHETYPES).filter((archetype) => archetype.team === team);
}

/** The actions only this archetype may take, in tray order. */
function exclusiveActions(id: UnitArchetypeId): CombatActionDefinition[] {
  return ACTION_TRAY_ORDER
    .map((actionId) => getAction(actionId))
    .filter((action) => action.archetypes?.includes(id) ?? false);
}

function targetingLabel(action: CombatActionDefinition): string {
  if (action.targeting === "self") return "self";
  if (action.targeting === "enemy") return "hostile";
  return "squadmate";
}

function actionEntry(id: ActionId): HelpEntry {
  const action = COMBAT_ACTIONS[id];
  return {
    term: action.name,
    meta: `${action.apCost} AP · ${targetingLabel(action)}`,
    detail: action.description,
  };
}

/**
 * Status codes the HUD prints, and what each one means for the unit wearing
 * it. Keyed by the exact label `statusLabels` produces, so a new status that
 * reaches the HUD without reaching the manual is a test failure rather than a
 * player's problem.
 */
export const STATUS_HELP: Record<string, string> = {
  AIMED: `The next shot this turn is ${signedPct(AIM_ACCURACY_BONUS)} accurate. Moving cancels it; firing spends it.`,
  HUNKERED: `Pressed into adjacent cover: shots at this unit lose a further ${pct(HUNKER_COVER_BONUS)}, until its next turn or until it moves. Worth almost nothing in the open.`,
  BRACED: `Set as an anchor: incoming hits are ${plural(BRACE_DAMAGE_REDUCTION, "point")} lighter, suppression cannot take an action point away, and its overwatch shoots better. Lost by moving.`,
  DASH: "Sprinting: action points buy extra ground for the rest of the turn, and the first reaction shot aimed at this unit misses it entirely.",
  SUPPRESSED: `Pinned: ${signedPct(-SUPPRESSED_ACCURACY_PENALTY)} accuracy, ${plural(SUPPRESSED_AP_PENALTY, "action point")} fewer next turn, no prepared shots, and any overwatch it held is broken.`,
  MARKED: `Called out by Rook: everyone except Rook shoots it ${signedPct(MARK_ACCURACY_BONUS)} better and reads through part of its cover, for ${plural(MARK_TURNS, "turn")}.`,
  GUARDED: `Shielded by Hex: hits land ${plural(GUARD_DAMAGE_REDUCTION, "point")} lighter while Hex stays within ${GUARD_RANGE} tiles.`,
  OVERWATCH: "Holding a lane: the first hostile that moves through ground this unit can shoot into takes a reaction shot.",
};

function runSection(): HelpSection {
  // Read from the generator rather than restated, so a longer route cannot
  // leave the manual describing the old one.
  const route = generateRoute(new SeededRng("MANUAL"));
  const branching = route.filter((depth) => depth.length > 1).length;
  return {
    id: "run",
    title: "Run",
    summary: "A run is one short, lethal route. It is meant to be replayed, not finished once.",
    entries: [
      {
        term: "The route",
        meta: `${route.length} nodes`,
        detail: `Every run is ${route.length} nodes deep and ends at the Core Breach. ${branching} of those depths offer a choice of two signals — a standard fight, an elite, a repair bay, or an upgrade cache — and taking one discards the other.`,
      },
      {
        term: "Damage persists",
        detail: "Squad HP and deaths carry between encounters. Only a repair bay gives health back, and an operator who goes offline stays offline for the rest of the run.",
      },
      {
        term: "One circuit at a time",
        detail: "Clearing a fight offers upgrades and you install exactly one. The rest are lost, so a build is the sum of the choices you refused as much as the ones you took.",
      },
      {
        term: "The seed",
        detail: "The seed in the top bar generates the whole route. Type it on the title screen to replay the same run and try a different answer to the same problem.",
      },
      {
        term: "The squad",
        meta: archetypesOfTeam("player").map((archetype) => archetype.name).join(" · "),
        detail: "Three operators, not three stat lines. Each has abilities the other two cannot use at all, so losing one removes a tool rather than a body.",
      },
    ],
  };
}

function turnSection(): HelpSection {
  const operators = archetypesOfTeam("player");
  return {
    id: "turn",
    title: "Turn",
    summary: "Your whole squad acts, then the enemy's does. Action points are the only currency.",
    entries: [
      {
        term: "Action points",
        meta: operators.map((archetype) => `${archetype.name} ${archetype.maxAp}`).join(" · "),
        detail: "Each operator refills its own action points at the start of your turn. Unspent points do not carry over, so a turn that ends with points left over is usually a turn that gave something away.",
      },
      {
        term: "Walking",
        meta: `${TILES_PER_MOVE_AP} tiles per AP`,
        detail: `Movement is the only thing that costs less than a whole action point: one point buys ${TILES_PER_MOVE_AP} tiles of eight-way travel. Select an operator to see every tile it can still reach, then tap one to walk the route a tile at a time.`,
      },
      {
        term: "Shooting",
        meta: `${COMBAT_ACTIONS.shoot.apCost} AP`,
        detail: `A shot costs ${COMBAT_ACTIONS.shoot.apCost} action points and is bound to tapping a hostile — there is no Shoot button competing with the rest of the tray.`,
      },
      {
        term: "Committing",
        detail: "Nothing is spent until you commit, and the hint line under the action tray always states the outcome first: the hit chance, the damage, or the reason the game is about to refuse.",
      },
      {
        term: "The enemy turn",
        detail: "Hostiles replan at the top of their turn. What they announced last turn is a plan they held, not a promise they owe you — break their firing line and they will do something else.",
      },
    ],
  };
}

function actionsSection(): HelpSection {
  return {
    id: "actions",
    title: "Actions",
    summary: "Everything a unit can spend points on, and what each one is for.",
    entries: [
      actionEntry("shoot"),
      ...ACTION_TRAY_ORDER.map(actionEntry),
      {
        term: "Intel",
        meta: "free · hostile",
        detail: "Not an action: a mode. Turn it on and tapping a hostile reads its role, its weakness, and the plan it is currently running instead of shooting it.",
      },
      {
        term: "Relay's limit",
        detail: `Relay moves ${plural(RELAY_AP_GRANTED, "action point")} and never creates one — ${plural(RELAY_LIMIT_PER_TURN, "relay")} per turn, and never above the recipient's own ceiling.`,
      },
    ],
  };
}

function squadSection(): HelpSection {
  return {
    id: "squad",
    title: "Squad",
    summary: "Who to select for which problem.",
    entries: archetypesOfTeam("player").map((archetype) => {
      const abilities = exclusiveActions(archetype.id);
      const band = rangeBandLabel(preferredBand(archetype.profile)).toLowerCase();
      return {
        term: archetype.name,
        meta: `${archetype.maxHp} HP · ${archetype.maxAp} AP · ${band} range`,
        detail: `${archetype.role} ${archetype.counter}${
          abilities.length > 0
            ? ` Only ${archetype.name} can use ${abilities.map((action) => action.name).join(" and ")}.`
            : ""
        }`,
      };
    }),
  };
}

function enemiesSection(): HelpSection {
  return {
    id: "enemies",
    title: "Enemies",
    summary: "Each hostile is dangerous for a reason you can name, and beaten by a plan that follows from it.",
    entries: archetypesOfTeam("enemy").map((archetype) => ({
      term: archetype.name,
      meta: `${archetype.maxHp} HP · ${archetype.maxAp} AP`,
      detail: `${archetype.role} ${archetype.counter}`,
    })),
  };
}

function shootingSection(): HelpSection {
  return {
    id: "shooting",
    title: "Shots",
    summary: "Why a shot hits, and what manoeuvre is worth.",
    entries: [
      {
        term: "The base shot",
        meta: `${pct(BASE_HIT)} · ${SHOT_DAMAGE} damage`,
        detail: `A clean firing line at an uncovered target starts at ${pct(BASE_HIT)} to hit for ${SHOT_DAMAGE}. Everything below is added to or taken off that number, and the preview you are shown is the same calculation that resolves the shot.`,
      },
      {
        term: "Cover",
        meta: `${signedPct(-COVER_PENALTY)} / ${signedPct(-HALF_COVER_PENALTY)}`,
        detail: "Cover only counts on the side it faces. A wall between you and a target is worth a full penalty, half cover roughly half of that, and neither does anything for a target you are shooting at from the other side.",
      },
      {
        term: "Exposed",
        meta: `${signedPct(EXPOSED_ACCURACY_BONUS)} · +${EXPOSED_DAMAGE_BONUS} damage`,
        detail: "A target is Exposed when its cover faces the wrong way, when a squadmate bears on it from 90 degrees or more away — crossfire — or when it has leaned out and not yet moved. Standing in the open is not Exposed; being outmanoeuvred is.",
      },
      {
        term: "Corner peeks",
        meta: signedPct(-PEEK_PENALTY),
        detail: "You may lean around a corner to take a shot that is not there from where you stand. It costs accuracy and leaves you leaning out until you move, which is exactly what makes you Exposed to the reply.",
      },
      {
        term: "Line of sight is reciprocal",
        detail: "If you can shoot it, it can shoot you. The single exception is a corner peek, and the peeker pays for it with a silhouette its target can answer.",
      },
      {
        term: "Suppression trades damage for time",
        detail: `Suppress deals nothing at all. It costs the target ${pct(SUPPRESSED_ACCURACY_PENALTY)} accuracy and ${plural(SUPPRESSED_AP_PENALTY, "action point")} on its next turn, stops it preparing a shot, and breaks any overwatch it held.`,
      },
    ],
  };
}

function rangeSection(): HelpSection {
  return {
    id: "range",
    title: "Range",
    summary: "Three bands, measured with the same eight-way distance movement uses.",
    entries: [
      { term: "Close", meta: `1–${CLOSE_MAX} tiles`, detail: "Knife range. Rushers and Vex want the fight here; dedicated shooters are badly off." },
      { term: "Medium", meta: `${CLOSE_MAX + 1}–${MEDIUM_MAX} tiles`, detail: "The ordinary band, and where Rook, Hex, and most hostiles are at their best." },
      { term: "Long", meta: `${MEDIUM_MAX + 1}+ tiles`, detail: "Marksman country. Most units lose accuracy out here rather than becoming useless." },
      {
        term: "Bands are coarse on purpose",
        detail: "One step rarely changes a band, so moving for range is a decision about where the fight happens rather than a per-tile optimisation.",
      },
    ],
  };
}

function boardSection(): HelpSection {
  return {
    id: "board",
    title: "Board",
    summary: "Every mark on the board has one meaning, and its shape carries it — never its colour alone.",
    entries: [
      {
        term: "Diamonds",
        detail: "Ground the selected operator can still reach this turn. They shrink as the walk gets further, so the smallest diamonds are the tiles that cost your last action point.",
      },
      {
        term: "Crosshairs",
        detail: "Tiles inside that same radius that would open a firing line the operator does not have from where it stands — and only lines it could still afford to shoot after walking there.",
      },
      {
        term: "Diagonal hatching",
        detail: "Ground a hostile watcher already covers. Walking onto a hatched tile invites its reaction shot.",
      },
      {
        term: "Chevrons",
        detail: "A hostile has a firing solution on that unit right now.",
      },
      {
        term: "Intent banners",
        detail: "Every hostile publishes its plan over its head — AIMING AT VEX, CLOSING ON ROOK, SETTING WATCH. A locked-on shot inverts to a bright plate with a thread to its target, because it is the plan you have to answer this turn.",
      },
      {
        term: "Status codes",
        detail: "The HUD prints short codes for temporary states. The States tab lists what each one means.",
      },
    ],
  };
}

function statesSection(): HelpSection {
  return {
    id: "states",
    title: "States",
    summary: "The short codes on the HUD, and what each one is doing to the unit wearing it.",
    entries: Object.entries(STATUS_HELP).map(([term, detail]) => ({ term, detail })),
  };
}

/** The whole manual, built fresh from the rule modules on every call. */
export function helpSections(): HelpSection[] {
  return [
    runSection(),
    turnSection(),
    actionsSection(),
    squadSection(),
    enemiesSection(),
    shootingSection(),
    rangeSection(),
    boardSection(),
    statesSection(),
  ];
}

// ---- The dialog -----------------------------------------------------------

export type HelpHandle = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  /** Remove the dialog and every listener it installed. */
  destroy: () => void;
};

/**
 * Build the manual as a modal over the whole app.
 *
 * It is a modal rather than another screen because the question it answers is
 * usually asked mid-decision: a player looking at a hostile they do not
 * understand should be able to read about it and come back to the same board,
 * with the same operator selected and the same action armed. Nothing here
 * touches game state, so opening it during a turn cannot cost anything.
 *
 * One tab is shown at a time. The alternative - one long scroll - buries the
 * enemy list six screens down on a phone, which is where it is needed most.
 */
export function mountHelp(trigger: HTMLElement, host: HTMLElement = document.body): HelpHandle {
  const sections = helpSections();

  const backdrop = document.createElement("div");
  backdrop.className = "help-backdrop hidden";

  const dialog = document.createElement("div");
  dialog.className = "help-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "help-title");

  const head = document.createElement("div");
  head.className = "help-head";
  const heading = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "screen-kicker";
  kicker.textContent = "Field manual";
  const title = document.createElement("h2");
  title.id = "help-title";
  title.className = "help-title";
  title.textContent = "How This Works";
  heading.append(kicker, title);
  const closeButton = document.createElement("button");
  closeButton.className = "help-close";
  closeButton.setAttribute("aria-label", "Close the field manual");
  closeButton.textContent = "✕";
  head.append(heading, closeButton);

  const tabs = document.createElement("div");
  tabs.className = "help-tabs";
  tabs.setAttribute("role", "tablist");

  const body = document.createElement("div");
  body.className = "help-body";

  const tabButtons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];

  sections.forEach((section, index) => {
    const tab = document.createElement("button");
    tab.className = "help-tab";
    tab.type = "button";
    tab.id = `help-tab-${section.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `help-panel-${section.id}`);
    tab.textContent = section.title;
    tab.addEventListener("click", () => select(index));
    tabs.appendChild(tab);
    tabButtons.push(tab);

    const panel = document.createElement("section");
    panel.className = "help-panel";
    panel.id = `help-panel-${section.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    const summary = document.createElement("p");
    summary.className = "help-summary";
    summary.textContent = section.summary;
    panel.appendChild(summary);
    for (const entry of section.entries) {
      const item = document.createElement("div");
      item.className = "help-entry";
      const term = document.createElement("div");
      term.className = "help-term";
      term.textContent = entry.term;
      if (entry.meta) {
        const meta = document.createElement("span");
        meta.className = "help-meta";
        meta.textContent = entry.meta;
        term.appendChild(meta);
      }
      const detail = document.createElement("p");
      detail.className = "help-detail";
      detail.textContent = entry.detail;
      item.append(term, detail);
      panel.appendChild(item);
    }
    body.appendChild(panel);
    panels.push(panel);
  });

  let active = 0;

  function select(index: number): void {
    active = index;
    tabButtons.forEach((tab, i) => {
      const on = i === index;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      // Only the selected tab stays in the tab order; the arrow keys move
      // between them, which is what a tab strip is supposed to do.
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach((panel, i) => panel.classList.toggle("hidden", i !== index));
    // A new tab starts at its own beginning rather than inheriting how far
    // down the previous one was read.
    body.scrollTop = 0;
  }

  tabs.addEventListener("keydown", (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (active + step + tabButtons.length) % tabButtons.length;
    select(next);
    tabButtons[next].focus();
  });

  dialog.append(head, tabs, body);
  backdrop.appendChild(dialog);
  host.appendChild(backdrop);
  select(0);

  /** Where focus was before the manual took it, so it can be handed back. */
  let restoreFocus: HTMLElement | null = null;

  const isOpen = (): boolean => !backdrop.classList.contains("hidden");

  const open = (): void => {
    if (isOpen()) return;
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backdrop.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    closeButton.focus();
  };

  const close = (): void => {
    if (!isOpen()) return;
    backdrop.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
    restoreFocus?.focus();
    restoreFocus = null;
  };

  const toggle = (): void => (isOpen() ? close() : open());

  closeButton.addEventListener("click", close);
  // Tapping the darkened board behind the manual is the gesture a phone player
  // reaches for first, so it closes; a tap inside must not.
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  trigger.addEventListener("click", toggle);
  trigger.setAttribute("aria-expanded", "false");


  return {
    open,
    close,
    toggle,
    isOpen,
    destroy: () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger.removeEventListener("click", toggle);
      backdrop.remove();
    },
  };
}
