/**
 * The combat action model.
 *
 * Every deliberate thing a unit can spend action points on is described by one
 * definition here: what it costs, who it can be pointed at, when it is legal,
 * what the player should be told before committing, and how it resolves. The
 * runtime asks this module what a selected unit can do and hands it a target;
 * it does not carry a branch per action.
 *
 * This is intentionally a small registry rather than a scripting system. There
 * is no cost formula language and no effect DSL - an action is a plain object
 * with a few functions, and adding one means adding a definition and a button
 * label, not extending an interpreter.
 *
 * Movement is deliberately *not* an action here. It has sub-AP granularity,
 * per-tile interruption, and its own overwatch and animation handling, and
 * folding it into this shape would complicate both. `rules.ts` still owns it.
 */

import type { GameMap, Unit } from "./map.ts";
import {
  applySuppression,
  canShootTarget,
  GUARD_RANGE,
  hasAdjacentCover,
  MARK_ACCURACY_BONUS,
  previewShot,
  resolveShot,
  type ShotPreview,
  type ShotResult,
} from "./combat.ts";
import {
  DASH_OVERWATCH_EVASION,
  isAimed,
  isBraced,
  isDashing,
  isHunkered,
  isMarked,
  isSuppressed,
  MARK_TURNS,
  setAimed,
  setBraced,
  setDashing,
  setGuardedBy,
  setHunkered,
  setMarked,
} from "./status.ts";
import { tileDistance } from "./range.ts";

export type ActionId =
  | "shoot"
  | "aim"
  | "hunker"
  | "suppress"
  | "overwatch"
  | "mark"
  | "relay"
  | "dash"
  | "guard"
  | "brace";

/** What the player has to point the action at after choosing it. */
export type ActionTargeting = "self" | "enemy" | "ally";

export const SHOOT_AP_COST = 2;
export const AIM_AP_COST = 1;
export const HUNKER_AP_COST = 1;
export const SUPPRESS_AP_COST = 2;
export const OVERWATCH_AP_COST = 2;
export const MARK_AP_COST = 1;
export const RELAY_AP_COST = 1;
export const DASH_AP_COST = 1;
export const GUARD_AP_COST = 1;
export const BRACE_AP_COST = 1;

/** Action points one Relay moves from the coordinator to an ally. */
export const RELAY_AP_GRANTED = 1;
/** Relays one unit may make per turn. The cap is what stops an AP shuffle. */
export const RELAY_LIMIT_PER_TURN = 1;

/** Whether an action is legal right now, and a short reason when it is not. */
export type Eligibility = { ok: true } | { ok: false; reason: string };

const OK: Eligibility = { ok: true };

function no(reason: string): Eligibility {
  return { ok: false, reason };
}

/**
 * What the player is shown before committing. `detail` is one short sentence
 * describing the outcome; `hitChance` and `damage` are only present for
 * actions that resolve a shot, and they come from `previewShot` so the preview
 * and the resolution can never diverge.
 */
export type ActionPreview = {
  actionId: ActionId;
  detail: string;
  hitChance?: number;
  damage?: number;
  shot?: ShotPreview;
};

export type ActionResult =
  | { kind: "shot"; shot: ShotResult; targetId: string }
  | { kind: "suppress"; targetId: string; shot: ShotPreview }
  | { kind: "mark"; targetId: string }
  | { kind: "support"; targetId: string; status: "relayed" | "guarded" }
  | { kind: "status"; status: "aimed" | "hunkered" | "overwatch" | "dashing" | "braced" };

export type CombatActionDefinition = {
  id: ActionId;
  /** Full name, used in tooltips and the action hint line. */
  name: string;
  /** Compact button label. Kept short enough for a phone-width action tray. */
  shortLabel: string;
  apCost: number;
  targeting: ActionTargeting;
  /** One sentence describing what the action does, for tooltips and help. */
  description: string;
  /**
   * Archetypes that may use this action. Absent means everybody can. This is
   * what makes an operator a distinct tool rather than a stat line: Rook's
   * coordination and Hex's protection are not options the others have.
   */
  archetypes?: readonly string[];
  /**
   * Whether this unit could use the action at all right now, ignoring any
   * particular target. Cost is checked by `actionEligibility`, not here.
   */
  activation: (map: GameMap, unit: Unit) => Eligibility;
  /** Whether the action is legal against this specific target. */
  targetEligibility?: (map: GameMap, unit: Unit, target: Unit) => Eligibility;
  preview: (map: GameMap, unit: Unit, target: Unit | null) => ActionPreview;
  /**
   * Resolve the action. AP is charged by `performAction`, never here, so no
   * definition can quietly disagree with the cost the UI displayed.
   */
  execute: (
    map: GameMap,
    unit: Unit,
    target: Unit | null,
    rng: () => number,
  ) => ActionResult | null;
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function livingEnemyTarget(unit: Unit, target: Unit | null): Eligibility {
  if (!target) return no("Select a hostile.");
  if (target.hp <= 0) return no("Target is down.");
  if (target.team === unit.team) return no("Target is friendly.");
  return OK;
}

const shootAction: CombatActionDefinition = {
  id: "shoot",
  name: "Shoot",
  shortLabel: "Shoot",
  apCost: SHOOT_AP_COST,
  targeting: "enemy",
  description: "Fire on a hostile you have a firing line to.",
  activation: () => OK,
  targetEligibility: (map, unit, target) => {
    const living = livingEnemyTarget(unit, target);
    if (!living.ok) return living;
    if (!canShootTarget(map, unit, target).canShoot) return no("No firing line.");
    return OK;
  },
  preview: (map, unit, target) => {
    if (!target) {
      return { actionId: "shoot", detail: "Select a hostile to fire on." };
    }
    const shot = previewShot(map, unit, target);
    const notes: string[] = [];
    if (shot.usesAim) notes.push("aimed");
    if (shot.exposed) notes.push(shot.exposed === "crossfire" ? "crossfire" : "exposed");
    if (shot.targetHunkered) notes.push("target hunkered");
    if (shot.shooterSuppressed) notes.push("suppressed");
    const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
    return {
      actionId: "shoot",
      detail: shot.shot.canShoot
        ? `${pct(shot.hitChance)} to hit for ${shot.damage}${suffix}`
        : "No firing line.",
      hitChance: shot.hitChance,
      damage: shot.damage,
      shot,
    };
  },
  execute: (map, unit, target, rng) => {
    if (!target) return null;
    const shot = resolveShot(map, unit, target, rng);
    if (!shot.canShoot) return null;
    return { kind: "shot", shot, targetId: target.id };
  },
};

const aimAction: CombatActionDefinition = {
  id: "aim",
  name: "Aim",
  shortLabel: "Aim",
  apCost: AIM_AP_COST,
  targeting: "self",
  description:
    "Steady this operator. The next shot gains accuracy. Moving cancels it.",
  activation: (_map, unit) => {
    if (isAimed(unit)) return no("Already aimed.");
    // Preparing a shot is an aggressive action, and a unit eating suppressing
    // fire is not doing it.
    if (isSuppressed(unit)) return no("Suppressed.");
    return OK;
  },
  preview: () => ({
    actionId: "aim",
    detail: "Next shot this turn gains accuracy. Cancelled by moving.",
  }),
  execute: (_map, unit) => {
    setAimed(unit, true);
    return { kind: "status", status: "aimed" };
  },
};

const hunkerAction: CombatActionDefinition = {
  id: "hunker",
  name: "Hunker",
  shortLabel: "Hunker",
  apCost: HUNKER_AP_COST,
  targeting: "self",
  description:
    "Press into adjacent cover until your next turn. Worth little in the open.",
  activation: (_map, unit) => {
    if (isHunkered(unit)) return no("Already hunkered.");
    return OK;
  },
  preview: (map, unit) => ({
    actionId: "hunker",
    detail: hasAdjacentCover(map, unit.x, unit.y)
      ? "Deepens adjacent cover until your next turn, and drops your lean."
      : "No adjacent cover: this would give almost no protection here.",
  }),
  execute: (_map, unit) => {
    setHunkered(unit, true);
    // Hunkering is the opposite of leaning out; a committed silhouette cannot
    // survive it.
    unit.peekExposure = null;
    return { kind: "status", status: "hunkered" };
  },
};

const suppressAction: CombatActionDefinition = {
  id: "suppress",
  name: "Suppress",
  shortLabel: "Suppress",
  apCost: SUPPRESS_AP_COST,
  targeting: "enemy",
  description:
    "Pin a hostile with fire. It loses accuracy and an action point on its " +
    "next turn, cannot prepare shots, and any overwatch it holds is broken. " +
    "Deals no damage.",
  activation: (_map, unit) => {
    if (isSuppressed(unit)) return no("Suppressed.");
    return OK;
  },
  targetEligibility: (map, unit, target) => {
    const living = livingEnemyTarget(unit, target);
    if (!living.ok) return living;
    // Suppression uses exactly the shooting relationship, so it inherits every
    // wall, corner, and peek safeguard rather than inventing a second one.
    if (!canShootTarget(map, unit, target).canShoot) return no("No firing line.");
    if (isSuppressed(target)) return no("Already suppressed.");
    return OK;
  },
  preview: (map, unit, target) => {
    if (!target) {
      return { actionId: "suppress", detail: "Select a hostile to pin down." };
    }
    const shot = previewShot(map, unit, target);
    const breaks = target.overwatch ? " and breaks its overwatch" : "";
    return {
      actionId: "suppress",
      detail: shot.shot.canShoot
        ? `Pins ${target.displayName ?? "target"} for its next turn${breaks}. No damage.`
        : "No firing line.",
      shot,
    };
  },
  execute: (map, unit, target) => {
    if (!target) return null;
    const shot = previewShot(map, unit, target);
    if (!shot.shot.canShoot) return null;
    applySuppression(target, unit.combat?.suppressionDurationBonus ?? 0);
    // Laying down suppressing fire from behind cover means leaning out, on the
    // same terms an ordinary peek shot does.
    if (shot.shot.mode === "peek" && shot.shot.peekFrom) {
      const ddx = Math.max(-1, Math.min(1, shot.shot.peekFrom.x - unit.x));
      const ddy = Math.max(-1, Math.min(1, shot.shot.peekFrom.y - unit.y));
      unit.peekExposure = { x: unit.x + ddx, y: unit.y + ddy };
    }
    return { kind: "suppress", targetId: target.id, shot };
  },
};

const overwatchAction: CombatActionDefinition = {
  id: "overwatch",
  name: "Overwatch",
  shortLabel: "Watch",
  apCost: OVERWATCH_AP_COST,
  targeting: "self",
  description:
    "Cover the ground you can shoot into. The first hostile that moves " +
    "through it takes one reaction shot. Remaining AP is kept.",
  activation: (_map, unit) => {
    if (unit.overwatch) return no("Already watching.");
    if (isSuppressed(unit)) return no("Suppressed.");
    return OK;
  },
  preview: () => ({
    actionId: "overwatch",
    detail: "One reaction shot at the first hostile that moves in your firing arc.",
  }),
  execute: (_map, unit) => {
    unit.overwatch = true;
    // Watching a lane means holding a firing position, not staying leaned out
    // around a corner from an earlier shot.
    unit.peekExposure = null;
    return { kind: "status", status: "overwatch" };
  },
};

function livingAllyTarget(unit: Unit, target: Unit | null): Eligibility {
  if (!target) return no("Select a squadmate.");
  if (target.hp <= 0) return no("Squadmate is down.");
  if (target.team !== unit.team) return no("Target is hostile.");
  if (target.id === unit.id) return no("Pick a different operator.");
  return OK;
}

// ---- Rook: coordination ---------------------------------------------------

const markAction: CombatActionDefinition = {
  id: "mark",
  name: "Mark Target",
  shortLabel: "Mark",
  apCost: MARK_AP_COST,
  targeting: "enemy",
  archetypes: ["operator"],
  description:
    "Call a hostile out. Your squadmates - not you - gain accuracy against it " +
    "and read through part of its cover until it next acts.",
  activation: (_map, unit) => {
    if (isSuppressed(unit)) return no("Suppressed.");
    return OK;
  },
  targetEligibility: (map, unit, target) => {
    const living = livingEnemyTarget(unit, target);
    if (!living.ok) return living;
    // Marking uses the ordinary firing relationship, so it inherits every wall
    // and corner rule instead of inventing a second kind of visibility.
    if (!canShootTarget(map, unit, target).canShoot) return no("Not in sight.");
    if (isMarked(target)) return no("Already marked.");
    return OK;
  },
  preview: (_map, unit, target) => {
    if (!target) {
      return { actionId: "mark", detail: "Select a hostile for the squad to focus." };
    }
    const bonus = MARK_ACCURACY_BONUS + (unit.combat?.markAccuracyBonus ?? 0);
    return {
      actionId: "mark",
      detail:
        `Squadmates gain ${pct(bonus)} accuracy against ` +
        `${target.displayName ?? "the target"} and cut through its cover. You do not.`,
    };
  },
  execute: (map, unit, target) => {
    if (!target) return null;
    if (!canShootTarget(map, unit, target).canShoot) return null;
    setMarked(target, MARK_TURNS, unit.id);
    return { kind: "mark", targetId: target.id };
  },
};

const relayAction: CombatActionDefinition = {
  id: "relay",
  name: "Relay",
  shortLabel: "Relay",
  apCost: RELAY_AP_COST,
  targeting: "ally",
  archetypes: ["operator"],
  description:
    "Hand one action point to a squadmate. Once per turn, and never more than " +
    "you spend, so the squad can move a point to whoever needs it without " +
    "creating one.",
  activation: (_map, unit) => {
    if (isSuppressed(unit)) return no("Suppressed.");
    if ((unit.relaysThisTurn ?? 0) >= RELAY_LIMIT_PER_TURN) {
      return no("Already relayed this turn.");
    }
    return OK;
  },
  targetEligibility: (_map, unit, target) => {
    const living = livingAllyTarget(unit, target);
    if (!living.ok) return living;
    // Granting a point a unit cannot hold would destroy it, which reads as the
    // action doing nothing. Refuse instead.
    if (target.ap >= target.maxAp) return no("Squadmate is at full AP.");
    return OK;
  },
  preview: (_map, _unit, target) => ({
    actionId: "relay",
    detail: target
      ? `Gives ${target.displayName ?? "the squadmate"} ${RELAY_AP_GRANTED} AP. Once per turn.`
      : "Give a squadmate one of your action points. Once per turn.",
  }),
  execute: (_map, unit, target) => {
    if (!target) return null;
    if (target.ap >= target.maxAp) return null;
    unit.relaysThisTurn = (unit.relaysThisTurn ?? 0) + 1;
    // Clamped to the recipient's own ceiling: one point out, at most one point
    // in, and never above a cap the rest of the game already respects.
    target.ap = Math.min(target.maxAp, target.ap + RELAY_AP_GRANTED);
    return { kind: "support", targetId: target.id, status: "relayed" };
  },
};

// ---- Vex: mobility --------------------------------------------------------

const dashAction: CombatActionDefinition = {
  id: "dash",
  name: "Dash",
  shortLabel: "Dash",
  apCost: DASH_AP_COST,
  targeting: "self",
  archetypes: ["runner"],
  description:
    "Sprint. Your action points buy more ground for the rest of the turn, and " +
    "you slip the first reaction shot aimed at you. Only one.",
  activation: (_map, unit) => {
    if (isDashing(unit)) return no("Already dashing.");
    if (isSuppressed(unit)) return no("Suppressed.");
    // Movement is billed from a running tile count, so changing the rate after
    // a walk has started would re-price ground already paid for. Committing to
    // the sprint before setting off keeps the rate constant for the whole walk.
    if ((unit.movesThisTurn ?? 0) > 0) return no("Already moved this turn.");
    return OK;
  },
  preview: () => ({
    actionId: "dash",
    detail:
      "More ground per action point this turn, and one reaction shot slips past you. " +
      "Must be used before moving.",
  }),
  execute: (_map, unit) => {
    setDashing(unit, true, DASH_OVERWATCH_EVASION);
    return { kind: "status", status: "dashing" };
  },
};

// ---- Hex: protection ------------------------------------------------------

const guardAction: CombatActionDefinition = {
  id: "guard",
  name: "Guard",
  shortLabel: "Guard",
  apCost: GUARD_AP_COST,
  targeting: "ally",
  archetypes: ["bulwark"],
  description:
    `Shield a squadmate within ${GUARD_RANGE} tiles. Hits on them are softened ` +
    "while you stay in position, until their next turn.",
  activation: (_map, unit) => {
    if (isSuppressed(unit)) return no("Suppressed.");
    return OK;
  },
  targetEligibility: (_map, unit, target) => {
    const living = livingAllyTarget(unit, target);
    if (!living.ok) return living;
    if (tileDistance(unit, target) > GUARD_RANGE) return no("Too far to shield.");
    return OK;
  },
  preview: (_map, _unit, target) => ({
    actionId: "guard",
    detail: target
      ? `Softens hits on ${target.displayName ?? "the squadmate"} while you stay within ${GUARD_RANGE} tiles.`
      : `Shield a squadmate within ${GUARD_RANGE} tiles.`,
  }),
  execute: (_map, unit, target) => {
    if (!target) return null;
    if (tileDistance(unit, target) > GUARD_RANGE) return null;
    setGuardedBy(target, unit.id);
    return { kind: "support", targetId: target.id, status: "guarded" };
  },
};

const braceAction: CombatActionDefinition = {
  id: "brace",
  name: "Brace",
  shortLabel: "Brace",
  apCost: BRACE_AP_COST,
  targeting: "self",
  archetypes: ["bulwark"],
  description:
    "Set yourself as an anchor. Incoming hits are softened, suppression cannot " +
    "cost you an action point, and your overwatch covers its lane better. " +
    "Cancelled by moving.",
  activation: (_map, unit) => {
    if (isBraced(unit)) return no("Already braced.");
    return OK;
  },
  preview: () => ({
    actionId: "brace",
    detail:
      "Softens incoming hits, shrugs off suppression's action-point cost, and " +
      "sharpens your overwatch. Lost if you move.",
  }),
  execute: (_map, unit) => {
    setBraced(unit, true);
    return { kind: "status", status: "braced" };
  },
};

export const COMBAT_ACTIONS: Record<ActionId, CombatActionDefinition> = {
  shoot: shootAction,
  aim: aimAction,
  hunker: hunkerAction,
  suppress: suppressAction,
  overwatch: overwatchAction,
  mark: markAction,
  relay: relayAction,
  dash: dashAction,
  guard: guardAction,
  brace: braceAction,
};

/**
 * The order actions appear in the HUD tray. Shoot is excluded: it is bound to
 * tapping a hostile and does not need a button competing with the rest.
 *
 * Role abilities lead, because they are the reason to have selected this
 * operator rather than another one; the shared toolkit follows.
 */
export const ACTION_TRAY_ORDER: readonly ActionId[] = [
  "mark",
  "relay",
  "dash",
  "guard",
  "brace",
  "aim",
  "hunker",
  "suppress",
  "overwatch",
];

export function getAction(id: ActionId): CombatActionDefinition {
  return COMBAT_ACTIONS[id];
}

/** True when this unit's archetype is allowed to use the action at all. */
export function unitHasAction(unit: Unit, id: ActionId): boolean {
  const allowed = getAction(id).archetypes;
  if (!allowed) return true;
  return unit.archetypeId !== undefined && allowed.includes(unit.archetypeId);
}

/** The actions this unit can ever take, in tray order. Excludes Shoot. */
export function actionsForUnit(unit: Unit): ActionId[] {
  return ACTION_TRAY_ORDER.filter((id) => unitHasAction(unit, id));
}

/**
 * Full eligibility for an action, including AP. `target` may be null for a
 * self action or when the player has not picked one yet; a targeted action
 * with no target reports the availability of the *mode*, so the button can be
 * enabled before a target exists.
 */
export function actionEligibility(
  map: GameMap,
  unit: Unit,
  id: ActionId,
  target: Unit | null = null,
): Eligibility {
  const action = getAction(id);
  if (unit.hp <= 0) return no("Unit is down.");
  if (!unitHasAction(unit, id)) return no("Not this operator's speciality.");
  if (unit.ap < action.apCost) {
    return no(`Needs ${action.apCost} AP.`);
  }
  const activation = action.activation(map, unit);
  if (!activation.ok) return activation;
  if (action.targeting !== "self" && target) {
    const targeted = action.targetEligibility?.(map, unit, target) ?? OK;
    if (!targeted.ok) return targeted;
  }
  return OK;
}

/** True when this action needs the player to point it at another unit. */
export function isTargetedAction(id: ActionId): boolean {
  return getAction(id).targeting !== "self";
}

/** Whether `candidate` is the right side of the board for this action. */
export function isCandidateSide(
  unit: Unit,
  candidate: Unit,
  id: ActionId,
): boolean {
  const targeting = getAction(id).targeting;
  if (targeting === "enemy") return candidate.team !== unit.team;
  if (targeting === "ally") {
    return candidate.team === unit.team && candidate.id !== unit.id;
  }
  return false;
}

/**
 * True when a targeted action has at least one legal target on the board. The
 * tray uses this so Suppress is not offered when nothing can be pinned and
 * Guard is not offered when no squadmate is in reach.
 */
export function hasAnyTarget(map: GameMap, unit: Unit, id: ActionId): boolean {
  if (!isTargetedAction(id)) return true;
  for (const candidate of map.units) {
    if (candidate.hp <= 0) continue;
    if (!isCandidateSide(unit, candidate, id)) continue;
    if (actionEligibility(map, unit, id, candidate).ok) return true;
  }
  return false;
}

export type ActionAvailability = {
  action: CombatActionDefinition;
  eligibility: Eligibility;
  /** For targeted actions, whether any legal target exists right now. */
  hasTarget: boolean;
  preview: ActionPreview;
};

/**
 * Everything the HUD needs to draw the action tray for `unit`. Defaults to the
 * actions this operator actually has, so the tray shows a role rather than a
 * uniform grid of mostly-disabled buttons.
 */
export function availableActions(
  map: GameMap,
  unit: Unit,
  ids: readonly ActionId[] = actionsForUnit(unit),
): ActionAvailability[] {
  return ids.map((id) => {
    const action = getAction(id);
    const eligibility = actionEligibility(map, unit, id);
    const hasTarget = eligibility.ok ? hasAnyTarget(map, unit, id) : false;
    return {
      action,
      eligibility: eligibility.ok && !hasTarget
        ? no("No valid target.")
        : eligibility,
      hasTarget,
      preview: action.preview(map, unit, null),
    };
  });
}

export type PerformOutcome =
  | { ok: true; result: ActionResult; apSpent: number }
  | { ok: false; reason: string };

/**
 * Charge and resolve an action. This is the only place AP is deducted for a
 * non-movement action, and a definition that refuses to resolve gets its AP
 * back rather than leaving the unit billed for nothing.
 */
export function performAction(
  map: GameMap,
  unit: Unit,
  id: ActionId,
  target: Unit | null = null,
  rng: () => number = Math.random,
): PerformOutcome {
  const action = getAction(id);
  const eligibility = actionEligibility(map, unit, id, target);
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };
  if (action.targeting !== "self" && !target) {
    return {
      ok: false,
      reason: action.targeting === "ally" ? "Select a squadmate." : "Select a hostile.",
    };
  }
  unit.ap -= action.apCost;
  const result = action.execute(map, unit, target, rng);
  if (!result) {
    unit.ap += action.apCost;
    return { ok: false, reason: "Action could not resolve." };
  }
  return { ok: true, result, apSpent: action.apCost };
}
