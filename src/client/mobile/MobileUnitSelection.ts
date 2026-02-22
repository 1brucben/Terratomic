/**
 * MobileUnitSelection - Helper for finding selectable units near a tap position
 * Uses screen-pixel distance for forgiving touch targeting (like MobileUIMapStack)
 */

import { Cell, UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import type { GameView, UnitView } from "../../core/game/GameView";
import type { TransformHandler } from "../graphics/TransformHandler";

/** Unit types that can be selected and redirected on mobile */
export const SELECTABLE_UNIT_TYPES: UnitType[] = [
  UnitType.Warship,
  UnitType.Submarine,
  UnitType.FighterJet,
  UnitType.Artillery,
];

/** Screen-pixel hit radius for tapping near a unit icon */
const UNIT_TAP_HIT_RADIUS_PX = 40;

/** Human-readable labels for selectable unit types */
export const UNIT_LABELS: Partial<Record<UnitType, string>> = {
  [UnitType.Warship]: "Warship",
  [UnitType.Submarine]: "Submarine",
  [UnitType.FighterJet]: "Fighter Jet",
  [UnitType.Artillery]: "Artillery",
};

/**
 * Calculate squared screen distance from a screen position to a unit's rendered position
 */
function screenDistSqToUnit(
  position: { x: number; y: number },
  unit: UnitView,
  game: GameView,
  transformHandler: TransformHandler,
): number {
  const tile = unit.tile();
  const cell = new Cell(game.x(tile), game.y(tile));
  const screenPos = transformHandler.worldToScreenCoordinates(cell);
  const dx = screenPos.x - position.x;
  const dy = screenPos.y - position.y;
  return dx * dx + dy * dy;
}

export interface NearbyUnit {
  unit: UnitView;
  screenDistSq: number;
}

/**
 * Find all player-owned selectable units near a screen tap position.
 * Uses screen-pixel distance for forgiving touch targeting.
 * Returns units sorted by distance (closest first).
 */
export function findSelectableUnitsNearTap(params: {
  position: { x: number; y: number };
  game: GameView;
  transformHandler: TransformHandler;
}): NearbyUnit[] {
  const { position, game, transformHandler } = params;
  const myPlayer = game.myPlayer();
  if (!myPlayer) return [];

  const hitRadiusSq = UNIT_TAP_HIT_RADIUS_PX * UNIT_TAP_HIT_RADIUS_PX;

  const results: NearbyUnit[] = [];

  for (const unitType of SELECTABLE_UNIT_TYPES) {
    for (const unit of game.units(unitType)) {
      if (!unit.isActive()) continue;
      if (unit.owner() !== myPlayer) continue;

      const distSq = screenDistSqToUnit(position, unit, game, transformHandler);
      if (distSq <= hitRadiusSq) {
        results.push({ unit, screenDistSq: distSq });
      }
    }
  }

  // Sort by distance (closest first)
  results.sort((a, b) => a.screenDistSq - b.screenDistSq);
  return results;
}

/**
 * Check if a destination tile is valid for the given unit type
 */
export function isValidRedirectTarget(
  unitType: UnitType,
  tile: TileRef,
  game: GameView,
): boolean {
  switch (unitType) {
    case UnitType.Warship:
    case UnitType.Submarine:
      return game.isOcean(tile);
    case UnitType.Artillery:
      return !game.isOcean(tile);
    case UnitType.FighterJet:
      return true; // Can go anywhere
    default:
      return false;
  }
}
