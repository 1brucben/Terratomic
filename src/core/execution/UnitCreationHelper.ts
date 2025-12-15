import { Game, Gold, Player, TerrainType, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { ConstructionExecution } from "./ConstructionExecution";

export class UnitCreationHelper {
  private static readonly CITY_DENSITY_PER_TILE = 1 / 6000;
  private static readonly PORT_DENSITY_PER_TILE = 1 / 12000;
  private static readonly MIN_BUILDING_DISTANCE_SQUARED = 1600; // 40 tiles squared
  private static readonly DEFENSE_POST_DENSITY_PER_BORDER_TILE = 1 / 110;
  private static readonly MAX_DISTANCE_FROM_BORDER_SQUARED = 400; // 20 tiles squared
  private static readonly MIN_DISTANCE_FROM_BORDER_SQUARED = 100; // 10 tiles squared
  private static readonly MIN_DISTANCE_BETWEEN_DEFENSE_POSTS_SQUARED = 900; // 30 tiles squared
  private static readonly MAX_PLACEMENT_ATTEMPTS = 100;
  // Spatial bucket size for proximity checks around existing buildings.
  // Using the minimum allowed distance (~40) ensures we only examine buildings
  // that could possibly violate spacing for a candidate tile.
  private static readonly BUILDING_BUCKET_SIZE = 40;

  constructor(
    private random: PseudoRandom,
    private mg: Game,
    private player: Player,
  ) {}

  // Per-handleUnits invocation caches to avoid repeated heavy work.
  // They are reset at the start of handleUnits().
  private spawnCache: Map<UnitType, TileRef | null> = new Map();
  private ownedTilesCache: TileRef[] | null = null;
  private shoreOwnedTilesCache: TileRef[] | null = null;

  // Bucketed map of existing non-defense buildings for fast radius checks.
  private buildingBuckets: Map<
    string,
    Array<{ tile: TileRef; x: number; y: number }>
  > | null = null;

  handleUnits() {
    // Reset per-tick caches – this helper may be called multiple times per tick
    // and structureSpawnTile can be expensive without caching.
    this.spawnCache.clear();
    this.ownedTilesCache = null;
    this.shoreOwnedTilesCache = null;
    this.buildingBuckets = null;

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
        new ConstructionExecution(this.player, chosenType, chosenTile),
      );
      return true;
    }

    return (
      this.maybeSpawnStructure(UnitType.Airfield, 1) ||
      this.maybeSpawnNavalUnit() ||
      this.maybeSpawnArtillery() ||
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
    this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    // Use memoized result if available within the same handleUnits() pass.
    const cached = this.spawnCache.get(type);
    if (cached !== undefined) return cached;

    // Get owned tiles (cached)
    this.ownedTilesCache ??= Array.from(this.player.tiles());

    // Restrict to shoreline for ports (cached)
    let candidateTiles: TileRef[];
    if (type === UnitType.Port) {
      // Filter once per tick; mg.isOceanShore is relatively cheap but can add up.
      this.shoreOwnedTilesCache ??= this.ownedTilesCache.filter((t) =>
        this.mg.isOceanShore(t),
      );
      candidateTiles = this.shoreOwnedTilesCache;
    } else {
      candidateTiles = this.ownedTilesCache;
    }

    if (candidateTiles.length === 0) {
      this.spawnCache.set(type, null);
      return null;
    }

    // For most structures we must keep a minimum distance from existing non-defense buildings.
    const mustRespectSpacing =
      type !== UnitType.DefensePost &&
      type !== UnitType.SAMLauncher &&
      type !== UnitType.MissileSilo;

    // Build spatial buckets of existing buildings once per tick for fast neighborhood checks.
    if (mustRespectSpacing) {
      this.buildingBuckets ??= this.buildBuildingBuckets();
    }

    const isValid = (tile: TileRef): boolean => {
      if (!mustRespectSpacing) return true;
      if (this.buildingBuckets === null) return true; // defensive
      const minDistSq = UnitCreationHelper.MIN_BUILDING_DISTANCE_SQUARED;
      const tx = this.mg.x(tile);
      const ty = this.mg.y(tile);
      const cellSize = UnitCreationHelper.BUILDING_BUCKET_SIZE;
      const cx = Math.floor(tx / cellSize);
      const cy = Math.floor(ty / cellSize);

      // Only check nearby buckets (3x3 neighborhood)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${cx + dx},${cy + dy}`;
          const bucket = this.buildingBuckets.get(key);
          if (!bucket) continue;
          for (const b of bucket) {
            // Early prune on axis if obviously far
            const ddx = tx - b.x;
            if (ddx > cellSize || ddx < -cellSize) continue;
            const ddy = ty - b.y;
            if (ddy > cellSize || ddy < -cellSize) continue;
            const dist = ddx * ddx + ddy * ddy;
            if (dist < minDistSq) return false;
          }
        }
      }
      return true;
    };

    // 1) Fast path: random rejection sampling with bounded attempts (uniform over valid tiles in expectation).
    for (let i = 0; i < UnitCreationHelper.MAX_PLACEMENT_ATTEMPTS; i++) {
      const tile = this.random.randElement(candidateTiles);
      if (isValid(tile)) {
        this.spawnCache.set(type, tile);
        return tile;
      }
    }

    // 2) Fallback: linear scan starting at a random offset to reduce bias.
    const n = candidateTiles.length;
    const start = this.random.nextInt(0, Math.max(0, n - 1));
    for (let k = 0; k < n; k++) {
      const tile = candidateTiles[(start + k) % n];
      if (isValid(tile)) {
        this.spawnCache.set(type, tile);
        return tile;
      }
    }

    this.spawnCache.set(type, null);
    return null;
  }

  private maybeSpawnNavalUnit(): boolean {
    const warshipCount = this.player.units(UnitType.Warship).length;
    const submarineCount = this.player.units(UnitType.Submarine).length;
    const navalCombatUnitCount = warshipCount + submarineCount;

    const ports = this.player.units(UnitType.Port);
    if (ports.length > 0 && navalCombatUnitCount === 0) {
      const unitToBuild = this.random.chance(50)
        ? UnitType.Submarine
        : UnitType.Warship;

      if (this.player.gold() > this.cost(unitToBuild)) {
        const port = this.random.randElement(ports);
        const targetTile = this.navalUnitSpawnTile(port.tile());
        if (targetTile === null) {
          return false;
        }
        const canBuild = this.player.canBuild(unitToBuild, targetTile);
        if (canBuild === false) {
          console.warn(`cannot spawn ${unitToBuild}`);
          return false;
        }
        this.mg.addExecution(
          new ConstructionExecution(this.player, unitToBuild, targetTile),
        );
        return true;
      }
    }
    return false;
  }

  private maybeSpawnArtillery(): boolean {
    const artilleryCount = this.player.units(UnitType.Artillery).length;

    const factories = this.player.units(UnitType.Factory);
    if (factories.length > 0 && artilleryCount === 0) {
      if (this.player.gold() > this.cost(UnitType.Artillery)) {
        const factory = this.random.randElement(factories);
        const targetTile = this.landUnitSpawnTile(factory.tile());
        if (targetTile === null) {
          return false;
        }
        const canBuild = this.player.canBuild(UnitType.Artillery, targetTile);
        if (canBuild === false) {
          return false;
        }
        this.mg.addExecution(
          new ConstructionExecution(
            this.player,
            UnitType.Artillery,
            targetTile,
          ),
        );
        return true;
      }
    }
    return false;
  }

  private landUnitSpawnTile(factoryTile: TileRef): TileRef | null {
    const radius = 100;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.mg.x(factoryTile) - radius,
        this.mg.x(factoryTile) + radius,
      );
      const randY = this.random.nextInt(
        this.mg.y(factoryTile) - radius,
        this.mg.y(factoryTile) + radius,
      );
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.mg.ref(randX, randY);
      // Must be land and not barrier
      if (
        this.mg.isOcean(tile) ||
        this.mg.terrainType(tile) === TerrainType.Barrier
      ) {
        continue;
      }
      return tile;
    }
    return null;
  }

  private navalUnitSpawnTile(portTile: TileRef): TileRef | null {
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
          new ConstructionExecution(this.player, UnitType.DefensePost, tile),
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
        new ConstructionExecution(this.player, UnitType.SAMLauncher, buildTile),
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

      // 2- distance to *any* frontline border must be ≥ 10 (squared ≥ 100)
      const farEnoughFromBorder = frontlineBorders.every(
        (b) =>
          this.mg.euclideanDistSquared(tile, b) >=
          UnitCreationHelper.MIN_DISTANCE_FROM_BORDER_SQUARED,
      );
      if (!farEnoughFromBorder) continue;

      // 3- stay ≥ 30 tiles away from every existing defence post
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

  // Build buckets of existing buildings (excluding DefensePost and SAMLauncher)
  // grouped by coarse grid cells for near-neighbor queries.
  private buildBuildingBuckets(): Map<
    string,
    Array<{ tile: TileRef; x: number; y: number }>
  > {
    const buckets = new Map<
      string,
      Array<{ tile: TileRef; x: number; y: number }>
    >();
    const cellSize = UnitCreationHelper.BUILDING_BUCKET_SIZE;

    const existingBuildings = this.player
      .units()
      .filter(
        (unit) =>
          unit.type() !== UnitType.DefensePost &&
          unit.type() !== UnitType.SAMLauncher,
      );

    for (const b of existingBuildings) {
      const tile = b.tile();
      const x = this.mg.x(tile);
      const y = this.mg.y(tile);
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const key = `${cx},${cy}`;
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push({ tile, x, y });
    }

    return buckets;
  }
}
