import { Game, Gold, Player, TerrainType, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { ConstructionExecution } from "./ConstructionExecution";
import { BotPersonality } from "./FakeHumanExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";

export class UnitCreationHelper {
  private static readonly CITY_DENSITY_PER_TILE = 1 / 6000;
  private static readonly PORT_DENSITY_PER_TILE = 1 / 12000;
  private static readonly FACTORY_DENSITY_PER_TILE = 1 / 8000;
  private static readonly AIRFIELD_DENSITY_PER_TILE = 1 / 10000;
  private static readonly MISSILE_SILO_DENSITY_PER_TILE = 1 / 15000;
  private static readonly SAM_LAUNCHER_DENSITY_PER_TILE = 1 / 15000;
  private static readonly ACADEMY_DENSITY_PER_TILE = 1 / 30000;
  private static readonly HOSPITAL_DENSITY_PER_TILE = 1 / 20000;
  private static readonly DEFENSE_POST_DENSITY_PER_BORDER_TILE = 1 / 110;
  private static readonly MIN_BUILDING_DISTANCE_SQUARED = 1600; // 40 tiles squared

  // Max caps for structures (regardless of density)
  private static readonly MAX_ACADEMY = 4;
  private static readonly MAX_HOSPITAL = 4;
  private static readonly MAX_CITY_STACK = 25;

  // Mobile unit base ratios (1 unit per X production buildings)
  private static readonly WARSHIP_PER_PORTS = 5;
  private static readonly SUBMARINE_PER_PORTS = 5;
  private static readonly FIGHTER_JET_PER_AIRFIELDS = 5;
  private static readonly ARTILLERY_PER_FACTORIES = 5;

  // Max caps for mobile units
  private static readonly MAX_WARSHIP = 10;
  private static readonly MAX_SUBMARINE = 8;
  private static readonly MAX_FIGHTER_JET = 8;
  private static readonly MAX_ARTILLERY = 8;
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
    private personality: BotPersonality = BotPersonality.Balanced,
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

  /**
   * Returns the personality multiplier for a given structure type.
   * Multiplier adjusts the base density (higher = builds more frequently).
   */
  private getPersonalityMultiplier(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.City:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 1.2;
          case BotPersonality.AirSupremacy:
            return 0.8;
          case BotPersonality.NavalPower:
            return 0.8;
          case BotPersonality.Nuclear:
            return 0.9;
          default:
            return 1.0;
        }
      case UnitType.Port:
        switch (this.personality) {
          case BotPersonality.Balanced:
            return 0.5;
          case BotPersonality.NavalPower:
            return 2.0;
          default:
            return 1.0;
        }
      case UnitType.Factory:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 1.5;
          case BotPersonality.NavalPower:
            return 0.5;
          case BotPersonality.Nuclear:
            return 0.75;
          default:
            return 1.0;
        }
      case UnitType.DefensePost:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 1.0;
          case BotPersonality.Balanced:
            return 0.75;
          default:
            return 0.5;
        }
      case UnitType.Airfield:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 0.8;
          case BotPersonality.AirSupremacy:
            return 1.5;
          case BotPersonality.NavalPower:
            return 0.5;
          case BotPersonality.Nuclear:
            return 0.7;
          default:
            return 1.0;
        }
      case UnitType.MissileSilo:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 1.2;
          case BotPersonality.AirSupremacy:
            return 0.7;
          case BotPersonality.NavalPower:
            return 0.7;
          case BotPersonality.Nuclear:
            return 2.0;
          default:
            return 1.0;
        }
      case UnitType.SAMLauncher:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 1.2;
          case BotPersonality.AirSupremacy:
            return 0.7;
          case BotPersonality.NavalPower:
            return 0.6;
          case BotPersonality.Nuclear:
            return 2.0;
          default:
            return 1.0;
        }
      case UnitType.Academy:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 1.5;
          case BotPersonality.AirSupremacy:
            return 0.5;
          case BotPersonality.NavalPower:
            return 0.5;
          case BotPersonality.Nuclear:
            return 0.0;
          default:
            return 1.0;
        }
      case UnitType.Hospital:
        switch (this.personality) {
          case BotPersonality.LandWarfare:
            return 1.5;
          case BotPersonality.AirSupremacy:
            return 0.8;
          case BotPersonality.NavalPower:
            return 0.5;
          default:
            return 1.0;
        }
      case UnitType.Warship:
        switch (this.personality) {
          case BotPersonality.Balanced:
            return 0.8;
          case BotPersonality.LandWarfare:
            return 0.3;
          case BotPersonality.AirSupremacy:
            return 0.4;
          case BotPersonality.NavalPower:
            return 1.5;
          case BotPersonality.Nuclear:
            return 0.5;
          default:
            return 1.0;
        }
      case UnitType.Submarine:
        switch (this.personality) {
          case BotPersonality.Balanced:
            return 0.5;
          case BotPersonality.LandWarfare:
            return 0.3;
          case BotPersonality.AirSupremacy:
            return 0.4;
          case BotPersonality.NavalPower:
            return 1.5;
          case BotPersonality.Nuclear:
            return 0.9;
          default:
            return 1.0;
        }
      case UnitType.FighterJet:
        switch (this.personality) {
          case BotPersonality.Balanced:
            return 0.8;
          case BotPersonality.LandWarfare:
            return 0.5;
          case BotPersonality.AirSupremacy:
            return 1.5;
          case BotPersonality.NavalPower:
            return 0.3;
          case BotPersonality.Nuclear:
            return 0.8;
          default:
            return 1.0;
        }
      case UnitType.Artillery:
        switch (this.personality) {
          case BotPersonality.Balanced:
            return 0.8;
          case BotPersonality.LandWarfare:
            return 1.5;
          case BotPersonality.AirSupremacy:
            return 0.8;
          case BotPersonality.NavalPower:
            return 0.5;
          case BotPersonality.Nuclear:
            return 1.0;
          default:
            return 1.0;
        }
      default:
        return 1.0;
    }
  }

  /**
   * Returns personality-specific building priority order.
   * All personalities start with City (economic foundation), then specialize.
   */
  private getBuildingPriorityOrder(): UnitType[] {
    const common = [UnitType.Academy, UnitType.Hospital];

    switch (this.personality) {
      case BotPersonality.Nuclear:
        return [
          UnitType.City,
          UnitType.MissileSilo,
          UnitType.SAMLauncher,
          ...common,
          UnitType.Port,
          UnitType.Factory,
          UnitType.Airfield,
          UnitType.DefensePost,
          UnitType.Warship,
          UnitType.Submarine,
          UnitType.FighterJet,
          UnitType.Artillery,
        ];
      case BotPersonality.NavalPower:
        return [
          UnitType.City,
          UnitType.Port,
          UnitType.Warship,
          UnitType.Submarine,
          ...common,
          UnitType.Factory,
          UnitType.Airfield,
          UnitType.SAMLauncher,
          UnitType.MissileSilo,
          UnitType.DefensePost,
          UnitType.FighterJet,
          UnitType.Artillery,
        ];
      case BotPersonality.LandWarfare:
        return [
          UnitType.City,
          UnitType.Factory,
          UnitType.DefensePost,
          UnitType.Artillery,
          ...common,
          UnitType.Port,
          UnitType.Airfield,
          UnitType.SAMLauncher,
          UnitType.MissileSilo,
          UnitType.Warship,
          UnitType.Submarine,
          UnitType.FighterJet,
        ];
      case BotPersonality.AirSupremacy:
        return [
          UnitType.City,
          UnitType.Airfield,
          UnitType.FighterJet,
          UnitType.SAMLauncher,
          ...common,
          UnitType.Port,
          UnitType.Factory,
          UnitType.MissileSilo,
          UnitType.DefensePost,
          UnitType.Warship,
          UnitType.Submarine,
          UnitType.Artillery,
        ];
      case BotPersonality.Balanced:
      default:
        return [
          UnitType.City,
          UnitType.Port,
          UnitType.Factory,
          UnitType.Airfield,
          UnitType.DefensePost,
          ...common,
          UnitType.MissileSilo,
          UnitType.SAMLauncher,
          UnitType.Warship,
          UnitType.Submarine,
          UnitType.FighterJet,
          UnitType.Artillery,
        ];
    }
  }

  handleUnits() {
    // Reset per-tick caches
    this.spawnCache.clear();
    this.ownedTilesCache = null;
    this.shoreOwnedTilesCache = null;
    this.buildingBuckets = null;

    // Get personality-specific building priority order
    const structureTypes = this.getBuildingPriorityOrder();

    // Check each structure type and build the one with best priority-weighted density gap
    let bestType: UnitType | null = null;
    let bestWeightedGap = 0;
    let bestTile: TileRef | null = null;

    for (let i = 0; i < structureTypes.length; i++) {
      const type = structureTypes[i];
      const multiplier = this.getPersonalityMultiplier(type);
      if (multiplier === 0) continue; // Skip structures this personality doesn't build

      const info = this.getDensityInfo(type);
      if (info.canBuild && info.densityGap > 0) {
        // Priority weight: 1.0 for first item, decreasing linearly to ~0 for last
        const priorityWeight = 1.0 - i / structureTypes.length;
        const weightedGap = info.densityGap * priorityWeight;

        if (weightedGap > bestWeightedGap) {
          bestWeightedGap = weightedGap;
          bestType = type;
          bestTile = info.tile;
        }
      }
    }

    // Build the structure with the biggest density gap
    if (bestType !== null && bestTile !== null) {
      this.mg.addExecution(
        new ConstructionExecution(this.player, bestType, bestTile),
      );
      return true;
    }

    // Fallback: If saturated, stack cities up to MAX_CITY_STACK
    const cities = this.player.units(UnitType.City);
    if (cities.length > 0) {
      // Find city with lowest stack count that's below the cap
      let lowestStackCity: Unit | null = null;
      let lowestStackCount = UnitCreationHelper.MAX_CITY_STACK + 1;

      for (const city of cities) {
        const stackCount = city.stackCount();
        if (
          stackCount < UnitCreationHelper.MAX_CITY_STACK &&
          stackCount < lowestStackCount
        ) {
          lowestStackCount = stackCount;
          lowestStackCity = city;
        }
      }

      if (lowestStackCity !== null) {
        // Use UpgradeStructureExecution to stack the city
        this.mg.addExecution(
          new UpgradeStructureExecution(this.player, lowestStackCity),
        );
        return true;
      }
    }

    return false;
  }

  private getDensityInfo(type: UnitType): {
    canBuild: boolean;
    cost: Gold;
    densityGap: number;
    tile: TileRef | null;
  } {
    // Check max cap first (before expensive calculations)
    const currentCount = this.player.unitsOwned(type);
    if (
      type === UnitType.Academy &&
      currentCount >= UnitCreationHelper.MAX_ACADEMY
    ) {
      return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
    }
    if (
      type === UnitType.Hospital &&
      currentCount >= UnitCreationHelper.MAX_HOSPITAL
    ) {
      return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
    }
    if (
      type === UnitType.Warship &&
      currentCount >= UnitCreationHelper.MAX_WARSHIP
    ) {
      return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
    }
    if (
      type === UnitType.Submarine &&
      currentCount >= UnitCreationHelper.MAX_SUBMARINE
    ) {
      return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
    }
    if (
      type === UnitType.FighterJet &&
      currentCount >= UnitCreationHelper.MAX_FIGHTER_JET
    ) {
      return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
    }
    if (
      type === UnitType.Artillery &&
      currentCount >= UnitCreationHelper.MAX_ARTILLERY
    ) {
      return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
    }

    // Mobile units use production building count instead of tile count
    const isMobileUnit =
      type === UnitType.Warship ||
      type === UnitType.Submarine ||
      type === UnitType.FighterJet ||
      type === UnitType.Artillery;

    let baseCount: number;

    if (isMobileUnit) {
      // Mobile units scale with production buildings
      if (type === UnitType.Warship || type === UnitType.Submarine) {
        baseCount = this.player.units(UnitType.Port).length;
      } else if (type === UnitType.FighterJet) {
        baseCount = this.player.units(UnitType.Airfield).length;
      } else {
        // Artillery
        baseCount = this.player.units(UnitType.Factory).length;
      }

      if (baseCount === 0) {
        return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
      }
    } else {
      // Structures use tiles (border tiles for DefensePost)
      const usesBorderTiles = type === UnitType.DefensePost;

      if (usesBorderTiles) {
        const frontlineBorders = Array.from(this.player.borderTiles()).filter(
          (t) => this.touchesEnemyLand(t),
        );
        baseCount = frontlineBorders.length;
      } else {
        baseCount = this.player.tiles().size;
      }

      if (baseCount === 0) {
        return { canBuild: false, cost: 0n, densityGap: 0, tile: null };
      }
    }

    // Get base density threshold
    let baseDensity: number;
    switch (type) {
      case UnitType.City:
        baseDensity = UnitCreationHelper.CITY_DENSITY_PER_TILE;
        break;
      case UnitType.Port:
        baseDensity = UnitCreationHelper.PORT_DENSITY_PER_TILE;
        break;
      case UnitType.Factory:
        baseDensity = UnitCreationHelper.FACTORY_DENSITY_PER_TILE;
        break;
      case UnitType.DefensePost:
        baseDensity = UnitCreationHelper.DEFENSE_POST_DENSITY_PER_BORDER_TILE;
        break;
      case UnitType.Airfield:
        baseDensity = UnitCreationHelper.AIRFIELD_DENSITY_PER_TILE;
        break;
      case UnitType.MissileSilo:
        baseDensity = UnitCreationHelper.MISSILE_SILO_DENSITY_PER_TILE;
        break;
      case UnitType.SAMLauncher:
        baseDensity = UnitCreationHelper.SAM_LAUNCHER_DENSITY_PER_TILE;
        break;
      case UnitType.Academy:
        baseDensity = UnitCreationHelper.ACADEMY_DENSITY_PER_TILE;
        break;
      case UnitType.Hospital:
        baseDensity = UnitCreationHelper.HOSPITAL_DENSITY_PER_TILE;
        break;
      case UnitType.Warship:
        baseDensity = 1 / UnitCreationHelper.WARSHIP_PER_PORTS;
        break;
      case UnitType.Submarine:
        baseDensity = 1 / UnitCreationHelper.SUBMARINE_PER_PORTS;
        break;
      case UnitType.FighterJet:
        baseDensity = 1 / UnitCreationHelper.FIGHTER_JET_PER_AIRFIELDS;
        break;
      case UnitType.Artillery:
        baseDensity = 1 / UnitCreationHelper.ARTILLERY_PER_FACTORIES;
        break;
      default:
        throw new Error(`Unsupported unit type: ${type}`);
    }

    // Apply personality multiplier
    const multiplier = this.getPersonalityMultiplier(type);
    const densityThreshold = baseDensity * multiplier;

    const currentDensity = currentCount / baseCount;
    const cost: Gold = this.cost(type);
    const densityGap = (densityThreshold - currentDensity) / densityThreshold;

    if (currentDensity < densityThreshold && this.player.gold() >= cost) {
      let tile: TileRef | null;

      // Different tile finding logic based on unit type
      if (type === UnitType.DefensePost) {
        const frontlineBorders = Array.from(this.player.borderTiles()).filter(
          (t) => this.touchesEnemyLand(t),
        );
        tile = this.findSuitableDefensePostTile(frontlineBorders);
      } else if (type === UnitType.Warship || type === UnitType.Submarine) {
        const ports = this.player.units(UnitType.Port);
        if (ports.length > 0) {
          const port = this.random.randElement(ports);
          tile = this.navalUnitSpawnTile(port.tile());
        } else {
          tile = null;
        }
      } else if (type === UnitType.FighterJet) {
        const airfields = this.player.units(UnitType.Airfield);
        if (airfields.length > 0) {
          const airfield = this.random.randElement(airfields);
          tile = airfield.tile(); // FighterJets spawn at airfield
        } else {
          tile = null;
        }
      } else if (type === UnitType.Artillery) {
        const factories = this.player.units(UnitType.Factory);
        if (factories.length > 0) {
          const factory = this.random.randElement(factories);
          tile = this.landUnitSpawnTile(factory.tile());
        } else {
          tile = null;
        }
      } else {
        tile = this.structureSpawnTile(type);
      }

      if (tile !== null && this.player.canBuild(type, tile)) {
        return { canBuild: true, cost, densityGap, tile };
      }
    }
    return { canBuild: false, cost, densityGap, tile: null };
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

  private landUnitSpawnTile(factoryTile: TileRef): TileRef | null {
    const radius = 40;
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
      // Must be owned land and not barrier
      if (
        this.mg.isOcean(tile) ||
        this.mg.terrainType(tile) === TerrainType.Barrier ||
        this.mg.owner(tile) !== this.player
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
