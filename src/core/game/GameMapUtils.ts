import { PathFinder, PathFindResultType } from "../pathfinding/PathFinding";
import { Game, TerrainType, Unit, UnitType } from "./Game";
import { GameMap, TileRef } from "./GameMap";

export function isSameTile(tile1: TileRef, tile2: TileRef): boolean {
  return tile1 === tile2;
}

export function isWalkable(gm: GameMap, tile: TileRef): boolean {
  return gm.isLand(tile);
}

export function isPathable(gm: GameMap, tile: TileRef): boolean {
  const terrain = gm.terrainType(tile);
  return (
    terrain === TerrainType.Plains ||
    terrain === TerrainType.Highland ||
    terrain === TerrainType.Mountain
  );
}

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

  // Sort by distance and then by priority (FighterJets first)
  validUnits.sort((a, b) => {
    const distA = mg.euclideanDistSquared(startTile, a.tile());
    const distB = mg.euclideanDistSquared(startTile, b.tile());

    // Prioritize FighterJets
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

export function findClosestPath(
  startTile: TileRef,
  endTile: TileRef,
  mg: Game, // GameImpl
  filter: (gm: GameMap, tile: TileRef) => boolean,
): { found: boolean; node: TileRef } {
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
