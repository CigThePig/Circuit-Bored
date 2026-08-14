import type { Unit } from "./map.ts";

export function movementApCost(unit: Unit): number {
  return unit.combat?.firstMoveFree && (unit.movesThisTurn ?? 0) === 0 ? 0 : 1;
}

export function resetTurnState(unit: Unit): void {
  unit.ap = unit.maxAp;
  unit.overwatch = false;
  unit.peekExposure = null;
  unit.movesThisTurn = 0;
  unit.shotsThisTurn = 0;
  unit.killsThisTurn = 0;
  unit.resolvingOverwatch = false;
}
