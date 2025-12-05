import { ConstructionExecution } from "../execution/ConstructionExecution";
import { Game, Player, PlayerID, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles structure construction for AI players.
 * Builds cities, factories, and ports based on density parameters.
 */
export class AIConstructionHandler {
  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {}

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  handleConstruction(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const numTiles = player.numTilesOwned();
    if (numTiles === 0) {
      return;
    }

    // Try to build structures based on density needs
    this.tryBuildCity(player, numTiles);
    this.tryBuildFactory(player, numTiles);
    this.tryBuildPort(player, numTiles);
  }

  private tryBuildCity(player: Player, numTiles: number): void {
    if (!(this.params.buildCities ?? true)) {
      return;
    }

    const tilesPerCity = this.params.tilesPerCity ?? 500;
    const desiredCount = Math.floor(numTiles / tilesPerCity);
    const currentCount = player.units(UnitType.City).length;

    if (currentCount >= desiredCount) {
      return;
    }

    const tile = this.findBuildTile(player, UnitType.City);
    if (tile !== null) {
      this.mg.addExecution(
        new ConstructionExecution(player, UnitType.City, tile),
      );
    }
  }

  private tryBuildFactory(player: Player, numTiles: number): void {
    if (!(this.params.buildFactories ?? true)) {
      return;
    }

    const tilesPerFactory = this.params.tilesPerFactory ?? 1000;
    const desiredCount = Math.floor(numTiles / tilesPerFactory);
    const currentCount = player.units(UnitType.Factory).length;

    if (currentCount >= desiredCount) {
      return;
    }

    const tile = this.findBuildTile(player, UnitType.Factory);
    if (tile !== null) {
      this.mg.addExecution(
        new ConstructionExecution(player, UnitType.Factory, tile),
      );
    }
  }

  private tryBuildPort(player: Player, numTiles: number): void {
    if (!(this.params.buildPorts ?? true)) {
      return;
    }

    const tilesPerPort = this.params.tilesPerPort ?? 2000;
    const desiredCount = Math.floor(numTiles / tilesPerPort);
    const currentCount = player.units(UnitType.Port).length;

    if (currentCount >= desiredCount) {
      return;
    }

    // Ports need ocean shore tiles
    const tile = this.findPortBuildTile(player);
    if (tile !== null) {
      this.mg.addExecution(
        new ConstructionExecution(player, UnitType.Port, tile),
      );
    }
  }

  private findBuildTile(player: Player, unitType: UnitType): TileRef | null {
    // Sample owned tiles and find a valid build location
    const ownedTiles = Array.from(player.tiles());
    if (ownedTiles.length === 0) {
      return null;
    }

    const sample = this.random.sampleArray(ownedTiles, 20);

    for (const tile of sample) {
      if (this.isValidBuildTile(player, tile, unitType)) {
        return tile;
      }
    }

    return null;
  }

  private findPortBuildTile(player: Player): TileRef | null {
    // Ports need ocean shore tiles
    const shoreTiles = Array.from(player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );

    if (shoreTiles.length === 0) {
      return null;
    }

    const sample = this.random.sampleArray(shoreTiles, 10);

    for (const tile of sample) {
      if (this.isValidBuildTile(player, tile, UnitType.Port)) {
        return tile;
      }
    }

    return null;
  }

  private isValidBuildTile(
    player: Player,
    tile: TileRef,
    unitType: UnitType,
  ): boolean {
    // Must be land
    if (!this.mg.isLand(tile)) {
      return false;
    }

    // Must be owned by player
    if (this.mg.owner(tile) !== player) {
      return false;
    }

    // Must not already have a structure
    if (this.mg.unitsAt(tile).length > 0) {
      return false;
    }

    // Ports need ocean shore
    if (unitType === UnitType.Port && !this.mg.isOceanShore(tile)) {
      return false;
    }

    return true;
  }
}
