import { PathFinder, PathFindResultType } from "../pathfinding/PathFinding";
import { Game, TerrainType, Unit, UnitType } from "./Game";
import { GameMap, TileRef } from "./GameMap";

/**
 * Checks if two TileRef objects refer to the same tile.
 * @param tile1 The first tile reference.
 * @param tile2 The second tile reference.
 * @returns True if the tiles are the same, false otherwise.
 */
export function isSameTile(tile1: TileRef, tile2: TileRef): boolean {
  return tile1 === tile2;
}

/**
 * Determines if a tile is walkable (i.e., is land).
 * @param gm The GameMap instance.
 * @param tile The tile to check.
 * @returns True if the tile is land, false otherwise.
 */
export function isWalkable(gm: GameMap, tile: TileRef): boolean {
  return gm.isLand(tile);
}

/**
 * Determines if a tile is pathable for ground units (Plains, Highland, Mountain).
 * @param gm The GameMap instance.
 * @param tile The tile to check.
 * @returns True if the tile is pathable for ground units, false otherwise.
 */
export function isPathable(gm: GameMap, tile: TileRef): boolean {
  const terrain = gm.terrainType(tile);
  return (
    terrain === TerrainType.Plains ||
    terrain === TerrainType.Highland ||
    terrain === TerrainType.Mountain
  );
}

/**
 * Finds the closest units of specified types within a given range.
 * Prioritizes Fighter Jets in the sorting.
 * @param startTile The tile from which to start the search.
 * @param range The search radius.
 * @param unitTypes An array of UnitTypes to search for.
 * @param mg The Game instance.
 * @param predicate A function to filter valid units.
 * @returns An array of valid units, sorted by distance and then by priority.
 */
export function findClosest(
  startTile: TileRef,
  range: number,
  unitTypes: UnitType[],
  mg: Game, // GameImpl
  predicate: (unit: Unit) => boolean,
): Unit[] {
  const nearbyUnits = mg.nearbyUnits(startTile, range, unitTypes);
  const validUnits: Unit[] = [];

  for (const { unit } of nearbyUnits) {
    if (predicate(unit)) {
      validUnits.push(unit);
    }
  }

  // Sort by distance and then by priority (FighterJets first).
  validUnits.sort((a, b) => {
    const distA = mg.euclideanDistSquared(startTile, a.tile());
    const distB = mg.euclideanDistSquared(startTile, b.tile());

    // Prioritize FighterJets in the sorting order.
    if (a.type() === UnitType.FighterJet && b.type() !== UnitType.FighterJet) {
      return -1;
    }
    if (a.type() !== UnitType.FighterJet && b.type() === UnitType.FighterJet) {
      return 1;
    }

    return distA - distB;
  });

  return validUnits;
}

/**
 * Finds the next tile in a path from a start tile to an end tile using A* pathfinding.
 * @param startTile The starting tile.
 * @param endTile The destination tile.
 * @param mg The Game instance.
 * @param filter A function to determine if a tile is traversable.
 * @returns An object indicating if a path was found and the next node in the path.
 */
export function findClosestPath(
  startTile: TileRef,
  endTile: TileRef,
  mg: Game, // GameImpl
  filter: (gm: GameMap, tile: TileRef) => boolean,
): { found: boolean; node: TileRef } {
  // Initialize a MiniAStar pathfinder. Note: The filter is not directly passed to MiniAStar here,
  // as MiniAStar's traversability is determined by its internal GameMapAdapter.
  const pathFinder = PathFinder.Mini(mg, 1000, false, 20);
  const result = pathFinder.nextTile(startTile, endTile);

  if (result.type === PathFindResultType.Completed) {
    const path = pathFinder.reconstructPath();
    if (path && path.length > 0) {
      return { found: true, node: path[0] };
    } else {
      return { found: false, node: startTile };
    }
  } else if (result.type === PathFindResultType.NextTile) {
    return { found: true, node: result.node! };
  } else {
    return { found: false, node: startTile };
  }
}
