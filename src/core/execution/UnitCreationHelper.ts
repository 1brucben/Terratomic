import { Game, Gold, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { ConstructionExecution } from "./ConstructionExecution";

export class UnitCreationHelper {
  private static readonly CITY_DENSITY_PER_TILE = 1 / 5000;
  private static readonly PORT_DENSITY_PER_TILE = 1 / 10000;
  private static readonly MIN_BUILDING_DISTANCE_SQUARED = 1600; // 40 tiles squared
  private static readonly DEFENSE_POST_DENSITY_PER_BORDER_TILE = 1 / 80;
  private static readonly MAX_DISTANCE_FROM_BORDER_SQUARED = 400; // 20 tiles squared
  private static readonly MIN_DISTANCE_BETWEEN_DEFENSE_POSTS_SQUARED = 900; // 30 tiles squared
  private static readonly MAX_PLACEMENT_ATTEMPTS = 100;

  constructor(
    private random: PseudoRandom,
    private mg: Game,
    private player: Player,
  ) {}

  handleUnits() {
    const cityInfo = this.getDensityBasedStructureInfo(UnitType.City);
    const portInfo = this.getDensityBasedStructureInfo(UnitType.Port);

    let chosenType: UnitType | null = null;
    let chosenTile: TileRef | null = null;

    if (cityInfo.canBuild && portInfo.canBuild) {
      if (cityInfo.cost < portInfo.cost) {
        chosenType = UnitType.City;
        chosenTile = cityInfo.tile;
      } else if (portInfo.cost < cityInfo.cost) {
        chosenType = UnitType.Port;
        chosenTile = portInfo.tile;
      } else {
        // Costs are equal, choose based on density gap
        if (cityInfo.densityGap > portInfo.densityGap) {
          chosenType = UnitType.City;
          chosenTile = cityInfo.tile;
        } else {
          chosenType = UnitType.Port;
          chosenTile = portInfo.tile;
        }
      }
    } else if (cityInfo.canBuild) {
      chosenType = UnitType.City;
      chosenTile = cityInfo.tile;
    } else if (portInfo.canBuild) {
      chosenType = UnitType.Port;
      chosenTile = portInfo.tile;
    }

    if (chosenType !== null && chosenTile !== null) {
      this.mg.addExecution(
        new ConstructionExecution(this.player, chosenTile, chosenType),
      );
      return true;
    }

    return (
      this.maybeSpawnStructure(UnitType.Airfield, 1) ||
      this.maybeSpawnWarship() ||
      this.maybeSpawnSAMLauncher() ||
      this.maybeSpawnStructure(UnitType.MissileSilo, 1) ||
      this.maybeSpawnDefensePost()
    );
  }

  private getDensityBasedStructureInfo(type: UnitType): {
    canBuild: boolean;
    cost: Gold;
    densityGap: number;
    tile: TileRef | null;
  } {
    const tilesOwned = this.player.tiles().size;
    if (tilesOwned === 0) {
      return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
    }

    const densityThreshold =
      type === UnitType.City
        ? UnitCreationHelper.CITY_DENSITY_PER_TILE
        : UnitCreationHelper.PORT_DENSITY_PER_TILE;

    const currentDensity = this.player.unitsOwned(type) / tilesOwned;
    const cost: Gold = this.cost(type);
    const densityGap = (densityThreshold - currentDensity) / densityThreshold;

    if (currentDensity < densityThreshold && this.player.gold() >= cost) {
      const tile = this.structureSpawnTile(type);
      if (tile !== null && this.player.canBuild(type, tile)) {
        return { canBuild: true, cost, densityGap, tile };
      }
    }
    return { canBuild: false, cost, densityGap, tile: null };
  }

  private maybeSpawnStructure(type: UnitType, maxNum: number): boolean {
    if (this.player.unitsOwned(type) >= maxNum) {
      return false;
    }
    if (this.player.gold() < this.cost(type)) {
      return false;
    }
    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    this.mg.addExecution(new ConstructionExecution(this.player, tile, type));
    return true;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    let tiles = Array.from(this.player.tiles());

    if (type === UnitType.Port) {
      tiles = tiles.filter((t) => this.mg.isOceanShore(t));
    }

    if (
      type !== UnitType.DefensePost &&
      type !== UnitType.SAMLauncher &&
      type !== UnitType.MissileSilo
    ) {
      const existingBuildings = this.player
        .units()
        .filter(
          (unit) =>
            unit.type() !== UnitType.DefensePost &&
            unit.type() !== UnitType.SAMLauncher,
        );
      tiles = tiles.filter((tile) => {
        for (const building of existingBuildings) {
          if (
            this.mg.euclideanDistSquared(tile, building.tile()) <
            UnitCreationHelper.MIN_BUILDING_DISTANCE_SQUARED
          ) {
            return false;
          }
        }
        return true;
      });
    }

    if (tiles.length === 0) return null;
    return this.random.randElement(tiles);
  }

  private maybeSpawnWarship(): boolean {
    if (!this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.gold() > this.cost(UnitType.Warship)
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile());
      if (targetTile === null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild === false) {
        console.warn("cannot spawn destroyer");
        return false;
      }
      this.mg.addExecution(
        new ConstructionExecution(this.player, targetTile, UnitType.Warship),
      );
      return true;
    }
    return false;
  }

  private warshipSpawnTile(portTile: TileRef): TileRef | null {
    const radius = 250;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.mg.x(portTile) - radius,
        this.mg.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.mg.y(portTile) - radius,
        this.mg.y(portTile) + radius,
      );
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.mg.ref(randX, randY);
      // Sanity check
      if (!this.mg.isOcean(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  private maybeSpawnDefensePost(): boolean {
    // keep only those border tiles that touch enemy land
    const frontlineBorders = Array.from(this.player.borderTiles()).filter((t) =>
      this.touchesEnemyLand(t),
    );
    if (frontlineBorders.length === 0) return false; // nothing worth guarding

    const currentDensity =
      this.player.unitsOwned(UnitType.DefensePost) / frontlineBorders.length;
    const cost = this.cost(UnitType.DefensePost);

    if (
      currentDensity <
        UnitCreationHelper.DEFENSE_POST_DENSITY_PER_BORDER_TILE &&
      this.player.gold() >= cost
    ) {
      const tile = this.findSuitableDefensePostTile(frontlineBorders);
      if (tile && this.player.canBuild(UnitType.DefensePost, tile)) {
        this.mg.addExecution(
          new ConstructionExecution(this.player, tile, UnitType.DefensePost),
        );
        return true;
      }
    }
    return false;
  }
  private maybeSpawnSAMLauncher(): boolean {
    // Build 1 SAM for every silo / airfield that has none within 40 tiles.
    const sams = this.player.units(UnitType.SAMLauncher);
    const silos = this.player.units(UnitType.MissileSilo);
    const airfields = this.player.units(UnitType.Airfield);
    const samRadiusSq = 40 * 40; // 40-tile protection radius
    const cost = this.cost(UnitType.SAMLauncher);
    if (this.player.gold() < cost) return false;

    // iterate over all “protected” buildings
    for (const b of [...silos, ...airfields]) {
      const alreadyCovered = sams.some(
        (s) => this.mg.euclideanDistSquared(b.tile(), s.tile()) <= samRadiusSq,
      );
      if (alreadyCovered) continue;

      // find an own land tile ≤ 40 away
      const candidateTiles = Array.from(this.player.tiles()).filter(
        (t) =>
          this.mg.isLand(t) &&
          this.mg.euclideanDistSquared(t, b.tile()) <= samRadiusSq,
      );
      if (candidateTiles.length === 0) continue;

      const buildTile = this.random.randElement(candidateTiles);
      if (!this.player.canBuild(UnitType.SAMLauncher, buildTile)) continue;

      this.mg.addExecution(
        new ConstructionExecution(this.player, buildTile, UnitType.SAMLauncher),
      );
      return true; // build one SAM per tick at most
    }
    return false;
  }

  private touchesEnemyLand(tile: TileRef): boolean {
    for (const n of this.adjacentTiles(tile)) {
      if (this.mg.isLand(n) && this.mg.owner(n) !== this.player) {
        return true; // enemy LAND neighbour – frontline
      }
    }
    return false; // pure coastline or internal border
  }
  private findSuitableDefensePostTile(
    frontlineBorders: TileRef[],
  ): TileRef | null {
    const ownedTiles = Array.from(this.player.tiles());
    const existingPosts = this.player.units(UnitType.DefensePost);

    if (ownedTiles.length === 0) return null;

    for (let i = 0; i < UnitCreationHelper.MAX_PLACEMENT_ATTEMPTS; i++) {
      const tile = this.random.randElement(ownedTiles);

      // 1- distance to *any* frontline border must be ≤ 20 (squared ≤ 400)
      const nearFront = frontlineBorders.some(
        (b) =>
          this.mg.euclideanDistSquared(tile, b) <=
          UnitCreationHelper.MAX_DISTANCE_FROM_BORDER_SQUARED,
      );
      if (!nearFront) continue;

      // 2- stay ≥ 30 tiles away from every existing defence post
      const overlaps = existingPosts.some(
        (p) =>
          this.mg.euclideanDistSquared(tile, p.tile()) <=
          UnitCreationHelper.MIN_DISTANCE_BETWEEN_DEFENSE_POSTS_SQUARED,
      );
      if (overlaps) continue;

      return tile; // found a good slot
    }
    return null;
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.player);
  }

  /** Returns the 8 adjacent tiles of a tile, skipping out-of-bounds ones. */
  private adjacentTiles(tile: TileRef): TileRef[] {
    const cx = this.mg.x(tile);
    const cy = this.mg.y(tile);
    const result: TileRef[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.mg.isValidCoord(nx, ny)) continue;
        result.push(this.mg.ref(nx, ny));
      }
    }

    return result;
  }
}
